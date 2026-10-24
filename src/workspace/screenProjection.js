import { Cartesian3 } from 'cesium';
import { createCoordinateFrames } from './coordinates.js';
import { MONITOR_SCREEN } from './geometry.js';

/** Project the real monitor front into CSS viewport pixels, optionally at a leased destination pose. */
export function createScreenProjection({ viewer, document }) {
  const frames = createCoordinateFrames(document);
  const desk = document.nodes.find((node) => node.kind === 'desk');
  const { minM: a, maxM: b } = MONITOR_SCREEN;
  const corners = [
    [a[0], a[1], b[2]],
    [b[0], a[1], b[2]],
    [b[0], a[1], a[2]],
    [a[0], a[1], a[2]],
  ].map((p) => new Cartesian3(...frames.localToEcef(desk.id, p)));
  return (pose) => {
    if (viewer.isDestroyed()) return null;
    const rect = viewer.scene.canvas.getBoundingClientRect();
    const camera = viewer.camera;
    const eye = pose ? new Cartesian3(...pose.position) : camera.positionWC;
    const forward = pose
      ? new Cartesian3(...pose.direction)
      : camera.directionWC;
    const up = pose ? new Cartesian3(...pose.up) : camera.upWC;
    const right = Cartesian3.normalize(
      Cartesian3.cross(forward, up, new Cartesian3()),
      new Cartesian3(),
    );
    const tan = Math.tan(camera.frustum.fovy / 2);
    if (!rect.width || !rect.height || !Number.isFinite(tan)) return null;
    const projected = corners.map((p) => {
      const offset = Cartesian3.subtract(p, eye, new Cartesian3());
      const depth = Cartesian3.dot(offset, forward);
      if (depth <= camera.frustum.near) return null;
      return [
        rect.left +
          rect.width / 2 +
          ((Cartesian3.dot(offset, right) / (depth * tan)) * rect.height) / 2,
        rect.top +
          rect.height / 2 -
          ((Cartesian3.dot(offset, up) / (depth * tan)) * rect.height) / 2,
      ];
    });
    return projected.every((p) => p?.every(Number.isFinite)) ? projected : null;
  };
}

/** CSS homography maps a full viewport rectangle to the projected screen quadrilateral. */
export function screenTransform(points, width, height) {
  if (!points || width <= 0 || height <= 0) return null;
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = points;
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3;
  const denominator = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(denominator) < 1e-8) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / denominator,
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  const values = [
    (x1 - x0 + g * x1) / width,
    (y1 - y0 + g * y1) / width,
    0,
    g / width,
    (x3 - x0 + h * x3) / height,
    (y3 - y0 + h * y3) / height,
    0,
    h / height,
    0,
    0,
    1,
    0,
    x0,
    y0,
    0,
    1,
  ];
  return values.every(Number.isFinite) ? `matrix3d(${values.join(',')})` : null;
}
