import test from 'node:test';
import assert from 'node:assert/strict';
import { createCesiumWorkspaceAdapter } from './cesiumAdapter.js';
import { createWorkspaceFixture } from './fixture.js';
import { createWorkspaceSession } from './session.js';
import {
  installRenderGovernor,
  uninstallRenderGovernor,
  holdContinuousRender,
  releaseContinuousRender,
  governorRequestRender,
  getRenderGovernorDiagnostics,
} from '../renderGovernor.js';

function fakeCollection(log, name) {
  const children = [];
  let destroyed = false;
  return {
    children,
    show: true,
    add(child) {
      children.push(child);
      return child;
    },
    remove(child) {
      const i = children.indexOf(child);
      if (i < 0) return false;
      children.splice(i, 1);
      if (!child.isDestroyed()) child.destroy();
      return true;
    },
    isDestroyed: () => destroyed,
    destroy() {
      assert.equal(destroyed, false);
      destroyed = true;
      children.splice(0).forEach((child) => {
        if (!child.isDestroyed()) child.destroy();
      });
      log.push(name);
    },
  };
}
function fixture({ failAt = -1 } = {}) {
  const log = [],
    specs = [],
    renders = [];
  const parent = fakeCollection(log, 'SHARED parent');
  const shared = fakeCollection(log, 'SHARED sibling');
  parent.add(shared);
  let privateCollection,
    destroyedViewer = false;
  const viewer = {
    isDestroyed: () => destroyedViewer,
    scene: { primitives: parent },
    destroy: () => {
      assert.fail('borrowed viewer destruction');
    },
  };
  const adapter = createCesiumWorkspaceAdapter({
    viewer,
    document: createWorkspaceFixture(),
    requestRender: (reason) => renders.push(reason),
    createCollection: () =>
      (privateCollection = fakeCollection(log, 'collection')),
    createPrimitive(spec) {
      if (specs.length === failAt) throw Error('box failed');
      specs.push(spec);
      return fakeCollection(log, spec.nodeId);
    },
  });
  const session = createWorkspaceSession({ acquire: adapter.acquire });
  return {
    log,
    specs,
    renders,
    parent,
    shared,
    viewer,
    session,
    get collection() {
      return privateCollection;
    },
    destroyViewer() {
      destroyedViewer = true;
      parent.destroy();
    },
  };
}

test('hidden acquisition builds only four fixture boxes; release leaves shared resources untouched', async () => {
  const f = fixture();
  assert.equal(f.parent.children.length, 1);
  await f.session.acquire();
  assert.equal(f.collection.show, false);
  assert.equal(f.collection.children.length, 4);
  assert.deepEqual(
    f.specs.map((s) => s.nodeId),
    ['demo-building-001', 'demo-floor-001', 'demo-office-001', 'demo-desk-001'],
  );
  assert.deepEqual(f.specs[1].dimensionsM, [18, 14, 0.1]);
  assert.deepEqual(f.specs[3].dimensionsM, [1.6, 0.8, 0.75]);
  assert.deepEqual(
    f.specs.map((s) => s.outline),
    [true, false, true, false],
  );
  await f.session.activate();
  assert.equal(f.collection.show, true);
  f.session.deactivate();
  f.session.dispose();
  assert.deepEqual(f.log, [
    'demo-desk-001',
    'demo-office-001',
    'demo-floor-001',
    'demo-building-001',
    'collection',
  ]);
  assert.deepEqual(f.parent.children, [f.shared]);
  assert.equal(f.shared.isDestroyed(), false);
  assert.equal(f.parent.isDestroyed(), false);
  assert.deepEqual(f.renders, ['workspace-activate', 'workspace-dispose']);
});

test('partial geometry failure releases earlier acquisitions and collection', async () => {
  const f = fixture({ failAt: 2 });
  await assert.rejects(f.session.activate(), /box failed/);
  assert.deepEqual(f.log, [
    'demo-floor-001',
    'demo-building-001',
    'collection',
  ]);
  assert.deepEqual(f.parent.children, [f.shared]);
  assert.equal(f.session.getState(), 'idle');
});

test('failure while attaching the collection still releases its ownership', async () => {
  const f = fixture();
  f.parent.add = () => {
    throw Error('attach failed');
  };
  await assert.rejects(f.session.acquire(), /attach failed/);
  assert.equal(f.collection.isDestroyed(), true);
  assert.deepEqual(f.parent.children, [f.shared]);
  assert.deepEqual(f.log, ['collection']);
});

test('independent sessions on one viewer release only their own collections', async () => {
  const log = [];
  const parent = fakeCollection(log, 'shared parent');
  const viewer = { isDestroyed: () => false, scene: { primitives: parent } };
  const makeSession = () => {
    const adapter = createCesiumWorkspaceAdapter({
      viewer,
      document: createWorkspaceFixture(),
      requestRender() {},
    });
    return createWorkspaceSession({ acquire: adapter.acquire });
  };
  const a = makeSession(),
    b = makeSession();
  await a.activate();
  await b.activate();
  const second = parent.children[1];
  a.dispose();
  assert.deepEqual(parent.children, [second]);
  assert.equal(second.isDestroyed(), false);
  assert.equal(b.getState(), 'active');
  b.dispose();
  assert.equal(parent.children.length, 0);
});

test('viewer destroyed before workspace cleanup never double-destroys geometry', async () => {
  const f = fixture();
  await f.session.activate();
  f.destroyViewer();
  const count = f.log.length;
  f.session.dispose();
  assert.equal(f.log.length, count);
});

test('real Cesium CPU geometry constructors work without constructing a Viewer', async () => {
  const log = [];
  const parent = fakeCollection(log, 'shared');
  const viewer = { isDestroyed: () => false, scene: { primitives: parent } };
  const adapter = createCesiumWorkspaceAdapter({
    viewer,
    document: createWorkspaceFixture(),
    requestRender() {},
  });
  const session = createWorkspaceSession({ acquire: adapter.acquire });
  await session.activate();
  assert.equal(parent.children[0].length, 4);
  session.dispose();
  assert.equal(parent.children.length, 0);
});

test('static prototype one-shot requests preserve unrelated render holds', async () => {
  const f = fixture();
  f.viewer.scene.requestRender = () => {};
  installRenderGovernor(f.viewer);
  holdContinuousRender('unrelated-owner');
  try {
    const adapter = createCesiumWorkspaceAdapter({
      viewer: f.viewer,
      document: createWorkspaceFixture(),
      requestRender: governorRequestRender,
    });
    const session = createWorkspaceSession({ acquire: adapter.acquire });
    await session.activate();
    session.dispose();
    assert.deepEqual(getRenderGovernorDiagnostics().holds, ['unrelated-owner']);
  } finally {
    releaseContinuousRender('unrelated-owner');
    uninstallRenderGovernor(f.viewer);
  }
});
