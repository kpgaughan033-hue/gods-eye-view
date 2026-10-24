import { Cartesian3, Matrix4 } from 'cesium';
import { MONITOR_SCREEN } from './geometry.js';
import { createCoordinateFrames } from './coordinates.js';

const plain = (v) => [v.x, v.y, v.z];
const vector = (v) => new Cartesian3(...v);

/** Local presets, not geographic share poses. No global clearance changes. */
const PRESETS = {
  building: { eye: [26, -38, 26], target: [0, 0, 2] },
  floor: { eye: [14, -21, 20], target: [0, 0, 0.5] },
  office: { eye: [10, -9, 10], target: [3, 2.5, 1] },
  desk: { eye: [3.1, -3.2, 2.5], target: [0.8, 0.4, 0.7] },
};

export function createWorkspaceCameraAdapter({
  viewer,
  document,
  requestRender,
  holdRender,
  releaseRender,
  reducedMotion = () =>
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ===
    true,
  duration = 0.7,
  timeoutMs = 10000,
}) {
  const frames = createCoordinateFrames(document);
  const owner = `workspace-flight-${globalThis.crypto.randomUUID()}`;
  let moving = null;
  const capture = () => ({
    position: plain(viewer.camera.positionWC),
    direction: plain(viewer.camera.directionWC),
    up: plain(viewer.camera.upWC),
  });
  function snap(pose, current) {
    if (!current() || viewer.isDestroyed()) return false;
    viewer.camera.setView({
      destination: vector(pose.position),
      orientation: { direction: vector(pose.direction), up: vector(pose.up) },
      endTransform: Matrix4.IDENTITY,
    });
    requestRender('workspace-pose');
    return true;
  }
  function pose(node) {
    // Application metadata remains unchanged. The camera approaches the actual
    // monitor front in the parent desk frame, not the logical widget bounds.
    const screen = MONITOR_SCREEN;
    const center = screen.minM.map((v, i) => (v + screen.maxM[i]) / 2);
    const preset =
      node.kind === 'application'
        ? {
            eye: [center[0], center[1] - 0.71, center[2]],
            target: [center[0], screen.minM[1], center[2]],
          }
        : PRESETS[node.kind];
    const frameId = node.kind === 'application' ? node.parentId : node.id;
    if (!preset) throw new TypeError('No workspace camera preset');
    const position = frames.localToEcef(frameId, preset.eye);
    const target = frames.localToEcef(frameId, preset.target);
    const direction = Cartesian3.normalize(
      Cartesian3.subtract(vector(target), vector(position), new Cartesian3()),
      new Cartesian3(),
    );
    const vertical = vector(frames.localDirectionToEcef(frameId, [0, 0, 1]));
    const right = Cartesian3.normalize(
      Cartesian3.cross(direction, vertical, new Cartesian3()),
      new Cartesian3(),
    );
    const up = Cartesian3.normalize(
      Cartesian3.cross(right, direction, new Cartesian3()),
      new Cartesian3(),
    );
    return { position, direction: plain(direction), up: plain(up) };
  }
  function constrain() {
    const controller = viewer.scene.screenSpaceCameraController,
      frustum = viewer.camera.frustum;
    const before = {
      inputs: controller.enableInputs,
      collision: controller.enableCollisionDetection,
      near: frustum.near,
    };
    // Only while the lease is held. A physical input revokes the lease in capture
    // phase and restores ordinary controls before Cesium handles that input.
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      if (viewer.isDestroyed()) return;
      controller.enableInputs = before.inputs;
      controller.enableCollisionDetection = before.collision;
      frustum.near = before.near;
    };
    try {
      controller.enableInputs = false;
      controller.enableCollisionDetection = false;
      frustum.near = 0.05;
    } catch (error) {
      restore();
      throw error;
    }
    return restore;
  }
  function move(destination, { signal, current }) {
    if (signal.aborted || !current() || viewer.isDestroyed())
      return Promise.resolve(false);
    if (reducedMotion()) return Promise.resolve(snap(destination, current));
    return new Promise((resolve, reject) => {
      let settled = false,
        timer;
      const token = {};
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (moving === token) moving = null;
        releaseRender(owner);
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => {
        // Abort dispatch runs synchronously before a new owner starts its flight.
        if (moving === token && !viewer.isDestroyed())
          viewer.camera.cancelFlight();
        finish(false);
      };
      moving = token;
      signal.addEventListener('abort', abort, { once: true });
      holdRender(owner);
      timer = setTimeout(() => {
        abort();
      }, timeoutMs);
      try {
        viewer.camera.flyTo({
          destination: vector(destination.position),
          orientation: {
            direction: vector(destination.direction),
            up: vector(destination.up),
          },
          endTransform: Matrix4.IDENTITY,
          duration,
          complete: () => {
            if (settled) return;
            // Cesium re-enables inputs AFTER invoking complete. Settle in a
            // microtask so its wrapper cannot overwrite our scoped constraint.
            queueMicrotask(() => {
              if (settled) return;
              try {
                const valid = !signal.aborted && current();
                if (valid)
                  viewer.scene.screenSpaceCameraController.enableInputs = false;
                finish(valid && snap(destination, current));
              } catch (error) {
                finish(false, error);
              }
            });
          },
          cancel: () => finish(false),
        });
      } catch (error) {
        finish(false, error);
      }
    });
  }
  return Object.freeze({ capture, pose, constrain, move, snap });
}
