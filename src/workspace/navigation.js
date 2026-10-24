import { createStateChannel } from '../app/stateChannel.js';
import { validateSpatialDocument } from './spatialModel.js';

/** Scope/history owner only. All camera writes require the existing navigation lease. */
export function createWorkspaceNavigation({
  document,
  session,
  camera,
  claim,
  supported = () => true,
  diagnostics = () => ({}),
  listenInput = () => () => {},
  signal,
  initialPose,
}) {
  validateSpatialDocument(document);
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const root = document.rootId;
  let committed = root,
    phase = 'idle',
    pending = null,
    lease = null,
    restoreSettings = null;
  let returnPose = null,
    snapshot = null,
    generation = 0,
    disposed = false,
    error = null;
  const history = new Map();
  let entryPose = initialPose ? structuredClone(initialPose) : null;
  const channel = createStateChannel(() => ({
    scopeId: committed,
    targetId: pending?.targetId || null,
    phase,
    generation,
    error,
    ancestors: [...history.keys()],
    diagnostics: snapshot,
  }));
  const publish = () => channel.publish();
  function cancelPending() {
    const old = pending;
    pending = null;
    generation++;
    old?.controller.abort();
    return old;
  }
  function revoke() {
    const owned = lease;
    lease = null;
    owned?.signal.removeEventListener('abort', revoke);
    cancelPending();
    const errors = [];
    for (const release of [
      () => session.deactivate(),
      () => restoreSettings?.(),
      () => owned?.release(),
    ]) {
      try {
        release();
      } catch (failure) {
        errors.push(failure);
      }
    }
    restoreSettings = null;
    returnPose = null;
    snapshot = null;
    history.clear();
    committed = root;
    phase = disposed ? 'disposed' : 'idle';
    if (errors.length)
      error = errors.map((failure) => failure.message).join('; ');
    publish();
    if (errors.length)
      throw new AggregateError(errors, 'Workspace navigation cleanup failed');
  }
  function alive(run) {
    return (
      !disposed &&
      pending === run &&
      !run.controller.signal.aborted &&
      lease?.isCurrent() === true
    );
  }
  function validTarget(target) {
    if (target === committed) return true;
    if (
      nodes.get(target)?.parentId === committed &&
      nodes.get(target)?.kind !== 'application'
    )
      return true;
    let cursor = nodes.get(committed);
    while (cursor?.parentId) {
      if (cursor.parentId === target) return true;
      cursor = nodes.get(cursor.parentId);
    }
    return false;
  }
  async function goTo(targetId, overridePose) {
    const firstPose = entryPose;
    entryPose = null;
    if (disposed || !nodes.has(targetId) || !validTarget(targetId))
      return false;
    if (targetId === root && !lease) return false;
    if (targetId !== root && !supported()) {
      // i18n-ignore: development-console diagnostic, not displayed in the UI.
      error = 'Unsupported map surface for fictional workspace';
      publish();
      return false;
    }
    const previous = cancelPending();
    error = null;
    if (!lease) {
      const captured = firstPose || camera.capture();
      const diagnostic = diagnostics();
      lease = claim();
      if (!lease?.isCurrent()) {
        lease = null;
        // i18n-ignore: development-console diagnostic, not displayed in the UI.
        error = 'Camera is owned by cockpit, tracking or director';
        phase = 'idle';
        publish();
        return false;
      }
      returnPose = captured;
      snapshot = structuredClone(diagnostic);
      lease.signal.addEventListener('abort', revoke, { once: true });
      try {
        restoreSettings = camera.constrain();
      } catch (failure) {
        error = failure.message;
        revoke();
        return false;
      }
    }
    const run = {
      targetId,
      controller: new AbortController(),
      sourcePose: previous?.sourcePose || camera.capture(),
    };
    pending = run;
    phase = 'preparing';
    publish();
    const current = () => alive(run);
    const cancelled = new Promise((resolve) =>
      run.controller.signal.addEventListener(
        'abort',
        () => {
          if (!run.completed) resolve(false);
        },
        { once: true },
      ),
    );
    const work = (async () => {
      try {
        if (!current()) return false;
        if (targetId !== root) {
          const active = await session.activate();
          if (!current()) return false;
          if (!active) throw Error('Workspace geometry acquisition cancelled');
          if (!supported())
            throw Error('Unsupported map surface for fictional workspace');
        }
        if (!current()) return false;
        const destination =
          overridePose ||
          (targetId === root
            ? returnPose
            : history.get(targetId) || camera.pose(nodes.get(targetId)));
        phase = 'moving';
        publish();
        const moved = await camera.move(destination, {
          signal: run.controller.signal,
          current,
        });
        if (!current()) return false;
        if (!moved) throw Error('Workspace flight cancelled or timed out');
        phase = 'settling';
        publish();
        if (!current()) return false;
        if (targetId === root) {
          run.completed = true;
          revoke();
          return true;
        }
        if (committed !== targetId) history.set(committed, run.sourcePose);
        const ancestors = new Set();
        let cursor = nodes.get(targetId);
        while (cursor.parentId) {
          ancestors.add(cursor.parentId);
          cursor = nodes.get(cursor.parentId);
        }
        for (const id of history.keys())
          if (!ancestors.has(id)) history.delete(id);
        committed = targetId;
        pending = null;
        phase = 'stable';
        publish();
        return true;
      } catch (failure) {
        if (!current()) return false;
        // Roll back only while still authoritative; never undo an external handoff.
        try {
          camera.snap(run.sourcePose, current);
        } catch (rollbackError) {
          // i18n-ignore: development-console diagnostic, not displayed in the UI.
          error = `${failure.message}; rollback failed: ${rollbackError.message}`;
          revoke();
          return false;
        }
        error = failure.message;
        pending = null;
        phase = committed === root ? 'idle' : 'stable';
        if (committed === root) revoke();
        else publish();
        return false;
      }
    })();
    return Promise.race([work, cancelled]);
  }
  function back() {
    if (pending) {
      const old = cancelPending();
      if (nodes.get(old.targetId).parentId === committed)
        return goTo(
          committed,
          committed === root ? returnPose : old.sourcePose,
        );
      // Repeated Back while already ascending continues toward the root.
      return goTo(nodes.get(old.targetId).parentId || root);
    }
    return goTo(nodes.get(committed).parentId || root);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    removeInput();
    try {
      revoke();
    } finally {
      channel.destroy();
    }
  }
  const removeInput = listenInput(() => {
    if (lease) revoke();
  });
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();
  return Object.freeze({
    enter: () =>
      goTo(document.nodes.find((node) => node.kind === 'building').id),
    enterChild: () => {
      const child = document.nodes.find(
        (node) => node.parentId === committed && node.kind !== 'application',
      );
      return child ? goTo(child.id) : Promise.resolve(false);
    },
    goTo,
    back,
    exit: () => goTo(root),
    revoke,
    dispose,
    getState: channel.getSnapshot,
    subscribe: channel.subscribe,
  });
}
