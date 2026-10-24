import test from 'node:test';
import assert from 'node:assert/strict';
import { createCesiumWorkspaceAdapter } from './cesiumAdapter.js';
import { workspaceBoxParts } from './geometry.js';
import { createWorkspaceFixture } from './fixture.js';
import { createWorkspaceSession } from './session.js';
import { createCoordinateFrames } from './coordinates.js';
import {
  BoxGeometry,
  BoxOutlineGeometry,
  Cartesian3,
  Matrix4,
  PrimitiveCollection,
  PrimitiveType,
} from 'cesium';
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

test('hidden acquisition builds bounded cutaway parts; release leaves shared resources untouched', async () => {
  const f = fixture();
  assert.equal(f.parent.children.length, 1);
  await f.session.acquire();
  assert.equal(f.collection.show, false);
  const expected = createWorkspaceFixture()
    .nodes.filter((n) => n.bounds && n.kind !== 'application')
    .flatMap((n) => workspaceBoxParts(n));
  assert.equal(f.collection.children.length, expected.length);
  assert.ok(expected.length <= 40);
  assert.deepEqual(
    [...new Set(f.specs.map((s) => s.nodeId))],
    ['demo-building-001', 'demo-floor-001', 'demo-office-001', 'demo-desk-001'],
  );
  const desktop = f.specs.find((s) => s.part === 'desktop');
  assert.deepEqual(desktop.dimensionsM.slice(0, 2), [1.6, 0.8]);
  assert.ok(Math.abs(desktop.dimensionsM[2] - 0.06) < 1e-12);
  await f.session.activate();
  assert.equal(f.collection.show, true);
  f.session.deactivate();
  f.session.dispose();
  assert.deepEqual(f.log, [
    ...f.specs.map((s) => s.nodeId).reverse(),
    'collection',
  ]);
  assert.deepEqual(f.parent.children, [f.shared]);
  assert.equal(f.shared.isDestroyed(), false);
  assert.equal(f.parent.isDestroyed(), false);
  assert.deepEqual(f.renders, ['workspace-activate', 'workspace-dispose']);
});

for (const failAt of [0, 2, 23, 33]) {
  test(`partial geometry failure at part ${failAt} releases earlier acquisitions and collection`, async () => {
    const f = fixture({ failAt });
    await assert.rejects(f.session.activate(), /box failed/);
    assert.deepEqual(f.log, [
      ...f.specs.map((s) => s.nodeId).reverse(),
      'collection',
    ]);
    assert.deepEqual(f.parent.children, [f.shared]);
    assert.equal(f.session.getState(), 'idle');
  });
}

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
  assert.equal(parent.children[0].length, 34);
  session.dispose();
  assert.equal(parent.children.length, 0);
});

test('outline geometry attributes match the flat position-only appearance', async () => {
  const parent = new PrimitiveCollection();
  const viewer = { isDestroyed: () => false, scene: { primitives: parent } };
  const adapter = createCesiumWorkspaceAdapter({
    viewer,
    document: createWorkspaceFixture(),
    requestRender() {},
  });
  const session = createWorkspaceSession({ acquire: adapter.acquire });
  try {
    await session.acquire();
    const collection = parent.get(0);
    for (let i = 0; i < collection.length; i++) {
      const primitive = collection.get(i);
      const instance = primitive.geometryInstances;
      const outline = instance.geometry instanceof BoxOutlineGeometry;
      const geometry = outline
        ? BoxOutlineGeometry.createGeometry(instance.geometry)
        : BoxGeometry.createGeometry(instance.geometry);
      assert.equal(primitive.appearance.flat, true);
      assert.equal(primitive.appearance.vertexFormat.position, true);
      assert.equal(primitive.appearance.vertexFormat.normal, false);
      assert.ok(geometry.attributes.position);
      if (outline) {
        assert.equal(geometry.attributes.normal, undefined);
        assert.equal(geometry.primitiveType, PrimitiveType.LINES);
      } else assert.equal(geometry.primitiveType, PrimitiveType.TRIANGLES);
      assert.equal(instance.attributes.color.value.length, 4);
    }
  } finally {
    session.dispose();
    parent.destroy();
  }
});

test('real instance model matrices map rotated box vertices through milestone 1 frames', async () => {
  const document = createWorkspaceFixture();
  document.nodes[1].transform.rotationXYZW = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  document.nodes[3].transform.rotationXYZW = [
    Math.sin(0.3),
    0,
    0,
    Math.cos(0.3),
  ];
  const frames = createCoordinateFrames(document);
  const parent = new PrimitiveCollection();
  const viewer = { isDestroyed: () => false, scene: { primitives: parent } };
  const adapter = createCesiumWorkspaceAdapter({
    viewer,
    document,
    requestRender() {},
  });
  const session = createWorkspaceSession({ acquire: adapter.acquire });
  try {
    await session.acquire();
    const collection = parent.get(0);
    for (let i = 0; i < collection.length; i++) {
      const instance = collection.get(i).geometryInstances;
      const node = document.nodes.find((n) => n.id === instance.id);
      const part =
        workspaceBoxParts(node)[
          Array.from({ length: i }, (_, j) => collection.get(j)).filter(
            (p) => p.geometryInstances.id === node.id,
          ).length
        ];
      const min = part.minM,
        max = part.maxM;
      const center = min.map((v, axis) => (v + max[axis]) / 2);
      const geometry =
        instance.geometry instanceof BoxOutlineGeometry
          ? BoxOutlineGeometry.createGeometry(instance.geometry)
          : BoxGeometry.createGeometry(instance.geometry);
      const positions = geometry.attributes.position.values;
      for (let j = 0; j < positions.length; j += 3) {
        const vertex = Array.from(positions.slice(j, j + 3));
        const local = vertex.map((v, axis) => v + center[axis]);
        for (let axis = 0; axis < 3; axis++)
          assert.ok(
            Math.min(
              Math.abs(local[axis] - min[axis]),
              Math.abs(local[axis] - max[axis]),
            ) < 1e-10,
          );
        const expected = frames.localToEcef(node.id, local);
        const actual = Matrix4.multiplyByPoint(
          instance.modelMatrix,
          new Cartesian3(...vertex),
          new Cartesian3(),
        );
        assert.ok(
          Math.hypot(
            actual.x - expected[0],
            actual.y - expected[1],
            actual.z - expected[2],
          ) < 1e-6,
        );
      }
    }
  } finally {
    session.dispose();
    parent.destroy();
  }
});

for (const destroyPrimitives of [true, false]) {
  test(`real private collection cleanup preserves shared siblings (parent destroyPrimitives=${destroyPrimitives})`, async () => {
    const parent = new PrimitiveCollection({ destroyPrimitives });
    const sibling = parent.add(new PrimitiveCollection());
    const viewer = { isDestroyed: () => false, scene: { primitives: parent } };
    const adapter = createCesiumWorkspaceAdapter({
      viewer,
      document: createWorkspaceFixture(),
      requestRender() {},
    });
    const session = createWorkspaceSession({ acquire: adapter.acquire });
    await session.acquire();
    const owned = parent.get(1),
      primitives = Array.from({ length: owned.length }, (_, i) => owned.get(i));
    const releases = [];
    primitives.forEach((primitive, i) => {
      const destroy = primitive.destroy.bind(primitive);
      primitive.destroy = () => {
        releases.push(i);
        return destroy();
      };
    });
    session.dispose();
    session.dispose();
    assert.deepEqual(releases, primitives.map((_, i) => i).reverse());
    assert.equal(owned.isDestroyed(), true);
    assert.ok(primitives.every((primitive) => primitive.isDestroyed()));
    assert.equal(parent.length, 1);
    assert.equal(parent.get(0), sibling);
    assert.equal(sibling.isDestroyed(), false);
    parent.remove(sibling);
    if (!sibling.isDestroyed()) sibling.destroy();
    parent.destroy();
  });
}

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
