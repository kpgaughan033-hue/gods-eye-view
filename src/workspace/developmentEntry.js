import { createWorkspaceSession } from './session.js';

export function workspacePrototypeEnabled({ development, search = '' }) {
  return (
    development === true &&
    new URLSearchParams(search).get('workspacePrototype') === '1'
  );
}

/** Register ownership synchronously; load renderer code only on explicit acquire. */
export function installWorkspaceDevelopmentEntry({
  viewer,
  signal,
  defer,
  debug,
  cancelStartupCamera,
  load = () => import('./prototype.js'),
}) {
  let pending = null,
    navigation = null,
    disposed = false,
    generation = 0;
  const loadModule = () =>
    (pending ||= Promise.resolve()
      .then(load)
      .catch((error) => {
        pending = null;
        throw error;
      }));
  const session = createWorkspaceSession({
    signal,
    async acquire({ signal: acquisitionSignal, defer: own }) {
      const module = await loadModule();
      acquisitionSignal.throwIfAborted();
      return module.createWorkspacePrototypeAdapter({ viewer }).acquire({
        signal: acquisitionSignal,
        defer: own,
      });
    },
  });
  async function navigate(method, argument) {
    if (disposed || signal.aborted) return false;
    // Snapshot before the first asynchronous boundary: the startup flight may
    // still be advancing while the development module is fetched.
    const camera = viewer.camera;
    const initialPose =
      !navigation && camera?.positionWC && camera?.directionWC && camera?.upWC
        ? {
            position: [
              camera.positionWC.x,
              camera.positionWC.y,
              camera.positionWC.z,
            ],
            direction: [
              camera.directionWC.x,
              camera.directionWC.y,
              camera.directionWC.z,
            ],
            up: [camera.upWC.x, camera.upWC.y, camera.upWC.z],
          }
        : undefined;
    // Latest console intent wins even before the navigation module has loaded.
    const intent = ++generation;
    const module = await loadModule();
    if (disposed || signal.aborted || generation !== intent) return false;
    navigation ||= module.createWorkspacePrototypeNavigation({
      viewer,
      session,
      debug,
      signal,
      cancelStartupCamera,
      initialPose,
    });
    return navigation[method](argument);
  }
  const entry = Object.freeze({
    acquire: session.acquire,
    activate: session.activate,
    deactivate() {
      generation++;
      try {
        navigation?.revoke();
      } finally {
        session.deactivate();
      }
    },
    dispose,
    getState: session.getState,
    enter: () => navigate('enter'),
    enterChild: () => navigate('enterChild'),
    goTo: (id) => navigate('goTo', id),
    back: () => navigate('back'),
    exit: () => navigate('exit'),
    getNavigationState: () => navigation?.getState() || null,
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    if (debug.workspacePrototype === entry) delete debug.workspacePrototype;
    try {
      navigation?.dispose();
    } finally {
      session.dispose();
    }
  }
  defer(dispose);
  // A newer globe intent during the lazy import must invalidate that entry too.
  const unwatch = debug.styleManager?.subscribeCameraHandoff(() => {
    generation++;
  });
  if (unwatch) defer(unwatch);
  const canvas = viewer.scene?.canvas?.ownerDocument || viewer.scene?.canvas;
  const invalidateLazy = () => {
    generation++;
  };
  for (const event of ['pointerdown', 'wheel', 'touchstart', 'keydown'])
    canvas?.addEventListener(event, invalidateLazy, {
      capture: true,
      passive: true,
    });
  defer(() => {
    for (const event of ['pointerdown', 'wheel', 'touchstart', 'keydown'])
      canvas?.removeEventListener(event, invalidateLazy, true);
  });
  // Application abort removes the dev handle as well as cancelling the session.
  const abort = () => dispose();
  signal.addEventListener('abort', abort, { once: true });
  defer(() => signal.removeEventListener('abort', abort));
  if (signal.aborted) dispose();
  else debug.workspacePrototype = entry;
  return entry;
}
