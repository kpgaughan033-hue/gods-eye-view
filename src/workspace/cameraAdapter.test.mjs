import test from 'node:test';
import assert from 'node:assert/strict';
import { Cartesian3 } from 'cesium';
import { createWorkspaceCameraAdapter } from './cameraAdapter.js';
import { createWorkspaceFixture } from './fixture.js';

function fixture({ reduced = false, timeoutMs } = {}) {
  const holds = new Set(['unrelated']),
    writes = [];
  let flight,
    cancelled = 0;
  const camera = {
    positionWC: new Cartesian3(6378137.123456, 100.987654, 200.123456),
    directionWC: new Cartesian3(0, 1, 0),
    upWC: new Cartesian3(0, 0, 1),
    frustum: { near: 1 },
    setView({ destination, orientation }) {
      writes.push(destination);
      this.positionWC = destination;
      this.directionWC = orientation.direction;
      this.upWC = orientation.up;
    },
    flyTo(options) {
      flight = options;
    },
    cancelFlight() {
      cancelled++;
      flight?.cancel();
    },
  };
  const controller = { enableInputs: true, enableCollisionDetection: true };
  const viewer = {
    camera,
    isDestroyed: () => false,
    scene: { screenSpaceCameraController: controller },
  };
  const document = createWorkspaceFixture();
  const adapter = createWorkspaceCameraAdapter({
    viewer,
    document,
    reducedMotion: () => reduced,
    requestRender() {},
    holdRender: (id) => holds.add(id),
    releaseRender: (id) => holds.delete(id),
    timeoutMs,
  });
  return {
    adapter,
    document,
    camera,
    controller,
    holds,
    writes,
    flight: () => flight,
    cancelled: () => cancelled,
  };
}

test('real math presets reach desk and round-trip precise ECEF orientation without share codecs (CPU simulation)', async () => {
  const f = fixture({ reduced: true }),
    controller = new AbortController();
  const original = f.adapter.capture(),
    restore = f.adapter.constrain();
  assert.equal(f.controller.enableInputs, false);
  assert.equal(f.controller.enableCollisionDetection, false);
  assert.equal(f.camera.frustum.near, 0.05);
  for (const node of f.document.nodes.slice(1, 5))
    assert.equal(
      await f.adapter.move(f.adapter.pose(node), {
        signal: controller.signal,
        current: () => true,
      }),
      true,
    );
  assert.equal(
    await f.adapter.move(original, {
      signal: controller.signal,
      current: () => true,
    }),
    true,
  );
  assert.deepEqual(f.adapter.capture(), original);
  restore();
  restore();
  assert.equal(f.controller.enableInputs, true);
  assert.equal(f.controller.enableCollisionDetection, true);
  assert.equal(f.camera.frustum.near, 1);
  assert.deepEqual([...f.holds], ['unrelated']);
});

test('aborted flight cancels before successor writes and retained complete callback is inert', async () => {
  const f = fixture(),
    controller = new AbortController();
  let owns = true;
  const promise = f.adapter.move(f.adapter.pose(f.document.nodes[1]), {
    signal: controller.signal,
    current: () => owns,
  });
  const complete = f.flight().complete;
  assert.equal(f.holds.size, 2);
  owns = false;
  controller.abort();
  assert.equal(await promise, false);
  assert.equal(f.cancelled(), 1);
  complete();
  assert.equal(f.writes.length, 0);
  assert.deepEqual([...f.holds], ['unrelated']);
});

test('flight completion sets exact pose only while current and releases its hold', async () => {
  const f = fixture(),
    controller = new AbortController();
  const pose = f.adapter.pose(f.document.nodes[4]);
  const promise = f.adapter.move(pose, {
    signal: controller.signal,
    current: () => true,
  });
  f.flight().complete();
  assert.equal(await promise, true);
  assert.deepEqual(f.adapter.capture(), pose);
  assert.deepEqual([...f.holds], ['unrelated']);
});

test('unresponsive flight timeout cancels and releases its hold', async () => {
  const f = fixture({ timeoutMs: 5 });
  assert.equal(
    await f.adapter.move(f.adapter.pose(f.document.nodes[1]), {
      signal: new AbortController().signal,
      current: () => true,
    }),
    false,
  );
  assert.equal(f.cancelled(), 1);
  assert.equal(f.writes.length, 0);
  assert.deepEqual([...f.holds], ['unrelated']);
});

test('Cesium completion wrapper cannot re-enable inputs while a workspace lease is held', async () => {
  const f = fixture(),
    restore = f.adapter.constrain();
  const promise = f.adapter.move(f.adapter.pose(f.document.nodes[1]), {
    signal: new AbortController().signal,
    current: () => true,
  });
  f.flight().complete();
  // CameraFlightPath.wrapCallback in the installed SDK runs this after complete.
  f.controller.enableInputs = true;
  assert.equal(await promise, true);
  assert.equal(f.controller.enableInputs, false);
  restore();
  assert.equal(f.controller.enableInputs, true);
});

test('cutaway subjects including monitor fit both documented viewport aspects (CPU projection)', async () => {
  const { createCoordinateFrames } = await import('./coordinates.js');
  const { PerspectiveFrustum } = await import('cesium');
  const f = fixture();
  const frames = createCoordinateFrames(f.document);
  for (const node of f.document.nodes.slice(1, 5)) {
    const pose = f.adapter.pose(node);
    const eye = new Cartesian3(...pose.position);
    const forward = new Cartesian3(...pose.direction);
    const up = new Cartesian3(...pose.up);
    const right = Cartesian3.cross(forward, up, new Cartesian3());
    const min = node.bounds.minM;
    const max = [...node.bounds.maxM];
    if (node.kind === 'desk') max[2] = 1.38; // Passive monitor extends above semantic desk bounds.
    for (const width of [800, 1280]) {
      const frustum = new PerspectiveFrustum({
        fov: Math.PI / 3,
        aspectRatio: width / 900,
        near: 0.05,
        far: 1000,
      });
      for (const x of [min[0], max[0]])
        for (const y of [min[1], max[1]])
          for (const z of [min[2], max[2]]) {
            const point = new Cartesian3(
              ...frames.localToEcef(node.id, [x, y, z]),
            );
            const offset = Cartesian3.subtract(point, eye, new Cartesian3());
            const depth = Cartesian3.dot(offset, forward);
            assert.ok(depth > 0.05, `${node.kind} behind near plane`);
            const vertical =
              Math.abs(Cartesian3.dot(offset, up)) /
              (depth * Math.tan(frustum.fovy / 2));
            const horizontal =
              Math.abs(Cartesian3.dot(offset, right)) /
              (depth * Math.tan(frustum.fovy / 2) * frustum.aspectRatio);
            assert.ok(
              vertical < 0.85 && horizontal < 0.85,
              `${node.kind} ${width}: ${horizontal}, ${vertical}`,
            );
          }
    }
  }
});
