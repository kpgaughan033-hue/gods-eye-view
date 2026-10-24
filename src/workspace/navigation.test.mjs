import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceNavigation } from './navigation.js';
import { createWorkspaceFixture } from './fixture.js';
import { createWorkspaceSession } from './session.js';
import { NavigationController } from '../ui/navigationController.js';
import { SceneDirector } from '../scenes/director.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
function fixture({ initialPose, presentation } = {}) {
  const document = createWorkspaceFixture(),
    writes = [],
    controller = new AbortController();
  const ids = document.nodes.slice(0, 5).map((node) => node.id);
  const original = {
    position: [6378137.123456789, 5000.987654321, 42.123456789],
    direction: [0, 1, 0],
    up: [0, 0, 1],
  };
  let actual = structuredClone(original),
    input,
    busy = false,
    cockpit = false,
    support = true,
    settings = 0,
    resources = 0,
    failCleanup = false,
    gate = null;
  const viewer = {
    camera: { cancelFlight() {}, lookAtTransform() {} },
    trackedEntity: undefined,
  };
  const tracking = Object.fromEntries(
    [
      'flightsLayer',
      'militaryFlightsLayer',
      'satellitesLayer',
      'aisLiveVesselsLayer',
      'militaryAwarenessLayer',
      'rocketLaunchesLayer',
    ].map((id) => [id, {}]),
  );
  const navigation = new NavigationController({
    viewer,
    tracking,
    isCockpitActive: () => cockpit,
    interruptCameraMotion() {},
    clearLocation() {},
    cancelShareSelection: () => false,
    getDataManager: () => null,
    stopOrbit() {},
    showToast() {},
  });
  const session = createWorkspaceSession({
    signal: controller.signal,
    async acquire({ defer }) {
      if (gate) await gate.promise;
      resources++;
      defer(() => resources--);
      return { activate() {}, dispose() {} };
    },
  });
  const camera = {
    capture: () => structuredClone(actual),
    pose: (node) => ({
      ...structuredClone(original),
      position: [ids.indexOf(node.id), 2, 3],
    }),
    constrain() {
      settings++;
      return () => settings--;
    },
    snap(pose, current) {
      if (!current()) return false;
      actual = structuredClone(pose);
      writes.push(actual);
      return true;
    },
    async move(pose, { current, signal }) {
      return !signal.aborted && camera.snap(pose, current);
    },
  };
  const diagnostic = { map: 'osm', layers: [{ id: 'flights', enabled: true }] };
  const owner = createWorkspaceNavigation({
    document,
    presentation,
    initialPose,
    session: {
      activate: () => session.activate(),
      deactivate() {
        session.deactivate();
        if (failCleanup) throw Error('presentation release failed');
      },
    },
    camera,
    signal: controller.signal,
    claim: () => navigation.claimScopedCamera({ isBusy: () => busy }),
    supported: () => support,
    diagnostics: () => diagnostic,
    listenInput: (fn) => {
      input = fn;
      return () => {
        input = null;
      };
    },
  });
  return {
    owner,
    camera,
    original,
    writes,
    session,
    navigation,
    viewer,
    controller,
    ids,
    diagnostic,
    input: () => input?.(),
    resources: () => resources,
    failCleanup: (value) => {
      failCleanup = value;
    },
    settings: () => settings,
    gate: (value) => {
      gate = value;
    },
    busy: (value) => {
      busy = value;
    },
    cockpit: (value) => {
      cockpit = value;
    },
    supported: (value) => {
      support = value;
    },
    actual: () => actual,
  };
}

test('full CPU-simulated route and semantic parents return the unrounded captured pose', async () => {
  const f = fixture();
  for (const id of f.ids.slice(1)) {
    assert.equal(await f.owner.goTo(id), true);
    assert.equal(f.owner.getState().scopeId, id);
    assert.ok(f.owner.getState().ancestors.length <= 4);
  }
  const deskPose = structuredClone(f.actual());
  assert.equal(await f.owner.enterChild(), true);
  assert.equal(f.owner.getState().scopeId, 'demo-application-001');
  assert.equal(await f.owner.enterChild(), false);
  assert.equal(await f.owner.back(), true);
  assert.deepEqual(f.actual(), deskPose);
  assert.equal(f.owner.getState().scopeId, f.ids[4]);
  assert.equal(await f.owner.back(), true);
  assert.equal(f.owner.getState().scopeId, f.ids[3]);
  assert.equal(await f.owner.goTo(f.ids[1]), true); // ancestor breadcrumb
  f.diagnostic.map = 'esri-imagery';
  assert.equal(f.owner.getState().diagnostics.map, 'osm');
  assert.equal(await f.owner.exit(), true);
  assert.deepEqual(f.actual(), f.original);
  assert.equal(f.diagnostic.map, 'esri-imagery'); // unrelated edits are never reverted
  assert.equal(f.settings(), 0);
  assert.equal(f.resources(), 0);
  assert.equal(f.owner.getState().scopeId, f.ids[0]);
  f.owner.dispose();
});

test('first return uses the pose captured before a delayed development import', async () => {
  const initialPose = {
    position: [6378157.123456789, 5000.987654321, 42.123456789],
    direction: [0, 1, 0],
    up: [0, 0, 1],
  };
  const f = fixture({ initialPose });
  assert.equal(await f.owner.enter(), true);
  assert.equal(await f.owner.exit(), true);
  assert.deepEqual(f.actual(), initialPose);
  f.owner.dispose();
});

for (const mode of ['cockpit', 'tracking', 'director', 'unsupported surface']) {
  test(`entry refuses ${mode} before changing camera/settings/resources`, async () => {
    const f = fixture();
    if (mode === 'cockpit') f.cockpit(true);
    if (mode === 'tracking') f.viewer.trackedEntity = {};
    if (mode === 'director') f.busy(true);
    if (mode === 'unsupported surface') f.supported(false);
    assert.equal(await f.owner.enter(), false);
    assert.equal(f.settings(), 0);
    assert.equal(f.resources(), 0);
    assert.equal(f.writes.length, 0);
    assert.ok(f.owner.getState().error);
    f.owner.dispose();
  });
}

test('Back/Exit before acquisition settles cancels entry and disposes late geometry', async () => {
  const f = fixture(),
    gate = deferred();
  f.gate(gate);
  const enter = f.owner.enter();
  await tick();
  assert.equal(f.owner.getState().scopeId, f.ids[0]);
  assert.equal(f.owner.getState().targetId, f.ids[1]);
  assert.equal(await f.owner.back(), true);
  assert.equal(await enter, false);
  gate.resolve();
  await tick();
  assert.equal(f.resources(), 0);
  assert.equal(f.settings(), 0);
  assert.deepEqual(f.actual(), f.original);
  f.owner.dispose();
});

test('history commits only on success and failed transitions restore the committed scope', async () => {
  const f = fixture();
  await f.owner.enter();
  const before = f.camera.capture(),
    history = f.owner.getState().ancestors;
  f.camera.move = async () => {
    throw Error('fixture flight failure');
  };
  assert.equal(await f.owner.enterChild(), false);
  assert.equal(f.owner.getState().scopeId, f.ids[1]);
  assert.deepEqual(f.owner.getState().ancestors, history);
  assert.deepEqual(f.actual(), before);
  assert.match(f.owner.getState().error, /fixture flight failure/);
  f.camera.move = async (pose, { current }) => f.camera.snap(pose, current);
  assert.equal(await f.owner.enterChild(), true);
  await f.owner.exit();
  f.owner.dispose();
  assert.equal(f.resources(), 0);
  assert.equal(f.settings(), 0);
});

for (const mode of [
  'search',
  'tracking',
  'director',
  'share',
  'manual input',
  'destroy',
]) {
  test(`newer ${mode} cancels pending workspace movement with no late write`, async () => {
    const f = fixture(),
      gate = deferred();
    await f.owner.enter();
    f.camera.move = async (pose, { current }) => {
      await gate.promise;
      return f.camera.snap(pose, current);
    };
    const pending = f.owner.enterChild();
    await tick();
    if (mode === 'search') f.navigation._beginDeferredNavigation('location');
    if (mode === 'share') f.navigation._beginDeferredNavigation('shared view');
    if (mode === 'tracking') {
      f.viewer.trackedEntity = {};
      f.navigation._stampNavigation({ cancelPendingSelection: false });
    }
    if (mode === 'director')
      SceneDirector.prototype._claimCameraOwnership.call({
        viewer: f.viewer,
        styleManager: {
          runImmediateNavigation: (...args) =>
            f.navigation._runExplicitNavigation(...args),
        },
        _updateStatus() {},
      });
    if (mode === 'manual input') f.input();
    if (mode === 'destroy') f.controller.abort();
    assert.equal(await pending, false);
    const writes = f.writes.length;
    gate.resolve();
    await tick();
    assert.equal(f.writes.length, writes);
    assert.equal(f.resources(), 0);
    assert.equal(f.settings(), 0);
    f.owner.dispose();
  });
}

test('rapid supersession and repeated Back follow committed state, never stale completions', async () => {
  const f = fixture();
  await f.owner.enter();
  await f.owner.enterChild();
  await f.owner.enterChild();
  const gates = [];
  f.camera.move = (pose, { current }) => {
    const gate = deferred();
    gates.push({ gate, pose, current });
    return gate.promise.then(() => f.camera.snap(pose, current));
  };
  const desk = f.owner.enterChild();
  await tick();
  const back = f.owner.back();
  await tick(); // cancel enter -> committed office
  const again = f.owner.back();
  await tick(); // now ascend toward floor
  assert.equal(await desk, false);
  assert.equal(await back, false);
  assert.equal(f.owner.getState().scopeId, f.ids[3]);
  gates.at(-1).gate.resolve();
  assert.equal(await again, true);
  assert.equal(f.owner.getState().scopeId, f.ids[2]);
  const writes = f.writes.length;
  gates.slice(0, -1).forEach(({ gate }) => gate.resolve());
  await tick();
  assert.equal(f.writes.length, writes);
  f.owner.dispose();
  assert.equal(f.resources(), 0);
  assert.equal(f.settings(), 0);
});

test('synchronous subscriber takeover during preparation cannot acquire or move', async () => {
  const f = fixture();
  const unsubscribe = f.owner.subscribe(({ state }) => {
    if (state.phase === 'preparing') f.input();
  });
  assert.equal(await f.owner.enter(), false);
  assert.equal(f.resources(), 0);
  assert.equal(f.writes.length, 0);
  unsubscribe();
  f.owner.dispose();
});

test('twenty complete cycles release settings/resources; destroyed owner is inert', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) {
    assert.equal(await f.owner.enter(), true);
    assert.equal(await f.owner.exit(), true);
    assert.equal(f.resources(), 0);
    assert.equal(f.settings(), 0);
  }
  f.owner.dispose();
  assert.equal(await f.owner.enter(), false);
});

test('a constraint acquisition failure releases the lease and permits a later retry', async () => {
  const f = fixture(),
    constrain = f.camera.constrain;
  f.camera.constrain = () => {
    throw Error('constraint unavailable');
  };
  assert.equal(await f.owner.enter(), false);
  assert.equal(f.owner.getState().scopeId, f.ids[0]);
  assert.match(f.owner.getState().error, /constraint unavailable/);
  assert.equal(f.resources(), 0);
  assert.equal(f.settings(), 0);
  f.camera.constrain = constrain;
  assert.equal(await f.owner.enter(), true);
  f.owner.dispose();
});

test('cleanup failure still releases lease and restores settings before reporting', async () => {
  const f = fixture();
  await f.owner.enter();
  f.failCleanup(true);
  assert.throws(() => f.owner.revoke(), /cleanup failed/);
  assert.equal(f.settings(), 0);
  assert.equal(f.resources(), 0);
  assert.match(f.owner.getState().error, /presentation release failed/);
  const successor = f.navigation.claimScopedCamera();
  assert.equal(successor.isCurrent(), true);
  successor.release();
  f.failCleanup(false);
  f.owner.dispose();
});

for (const action of ['back', 'exit', 'manual', 'authority', 'destroy']) {
  test(`application visual settlement cancelled by ${action}; late arrival cannot commit or write`, async () => {
    const gate = deferred();
    let context;
    const f = fixture({
      presentation: {
        transition(c) {
          if (c.to.kind === 'application') {
            context = c;
            return gate.promise;
          }
        },
      },
    });
    for (const id of f.ids.slice(1)) await f.owner.goTo(id);
    const deskPose = structuredClone(f.actual());
    const entering = f.owner.enterChild();
    await tick();
    assert.equal(f.owner.getState().scopeId, 'demo-desk-001');
    assert.equal(f.owner.getState().targetId, 'demo-application-001');
    let next;
    if (action === 'back') next = f.owner.back();
    if (action === 'exit') next = f.owner.exit();
    if (action === 'manual') f.input();
    if (action === 'authority')
      f.navigation._beginDeferredNavigation('location');
    if (action === 'destroy') f.owner.dispose();
    assert.equal(await entering, false);
    await next;
    assert.equal(context.signal.aborted, true);
    const writes = f.writes.length,
      scope = f.owner.getState().scopeId;
    gate.resolve(true);
    await tick();
    assert.equal(f.writes.length, writes);
    assert.equal(f.owner.getState().scopeId, scope);
    if (action === 'back') {
      assert.deepEqual(f.actual(), deskPose);
      assert.equal(scope, 'demo-desk-001');
      await f.owner.exit();
    }
    if (action === 'exit') assert.deepEqual(f.actual(), f.original);
    f.owner.dispose();
    assert.equal(f.resources(), 0);
    assert.equal(f.settings(), 0);
  });
}
test('application parent history returns exactly to desk then office, floor, building and original globe', async () => {
  const f = fixture();
  for (const id of f.ids.slice(1)) await f.owner.goTo(id);
  const deskPose = structuredClone(f.actual());
  await f.owner.enterChild();
  assert.deepEqual(f.owner.getState().ancestors, f.ids);
  await f.owner.back();
  assert.deepEqual(f.actual(), deskPose);
  for (const id of [...f.ids].slice(0, -1).reverse()) {
    assert.equal(await f.owner.back(), true);
    assert.equal(f.owner.getState().scopeId, id);
  }
  assert.deepEqual(f.actual(), f.original);
  f.owner.dispose();
});
test('reentrant camera takeover at moving publication cannot start any application presentation', async () => {
  let appTransitions = 0;
  const f = fixture({
    presentation: {
      transition({ to }) {
        if (to.kind === 'application') appTransitions++;
      },
    },
  });
  for (const id of f.ids.slice(1)) await f.owner.goTo(id);
  const stop = f.owner.subscribe(({ state }) => {
    if (state.phase === 'moving' && state.targetId === 'demo-application-001')
      f.input();
  });
  assert.equal(await f.owner.enterChild(), false);
  assert.equal(appTransitions, 0);
  stop();
  f.owner.dispose();
});
