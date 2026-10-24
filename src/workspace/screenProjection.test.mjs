import test from 'node:test';
import assert from 'node:assert/strict';
import { Cartesian3, PerspectiveFrustum } from 'cesium';
import { createWorkspaceFixture } from './fixture.js';
import { createCoordinateFrames } from './coordinates.js';
import { createWorkspaceCameraAdapter } from './cameraAdapter.js';
import { createScreenProjection, screenTransform } from './screenProjection.js';

test('homography maps every full-viewport corner to the actual tilted screen quad', () => {
  const points = [
      [310, 250],
      [480, 275],
      [460, 390],
      [320, 360],
    ],
    width = 1280,
    height = 900;
  const matrix = screenTransform(points, width, height)
    .slice(9, -1)
    .split(',')
    .map(Number);
  const input = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  for (let i = 0; i < 4; i++) {
    const [x, y] = input[i],
      w = matrix[3] * x + matrix[7] * y + matrix[15];
    assert.ok(
      Math.abs(
        (matrix[0] * x + matrix[4] * y + matrix[12]) / w - points[i][0],
      ) < 1e-8,
    );
    assert.ok(
      Math.abs(
        (matrix[1] * x + matrix[5] * y + matrix[13]) / w - points[i][1],
      ) < 1e-8,
    );
  }
  assert.equal(screenTransform(null, width, height), null);
  assert.equal(
    screenTransform(
      [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      width,
      height,
    ),
    null,
  );
});
for (const [longitudeDeg, latitudeDeg] of [
  [-97.7431, 30.2672],
  [151.2093, -33.8688],
  [179.99, 65],
]) {
  test(`application pose faces real screen front; projection uses CSS pixels at ${longitudeDeg},${latitudeDeg}`, () => {
    const document = createWorkspaceFixture();
    Object.assign(document.nodes[1].anchor, { longitudeDeg, latitudeDeg });
    document.nodes[4].transform.rotationXYZW = [
      0,
      0,
      Math.sin(0.17),
      Math.cos(0.17),
    ];
    const frames = createCoordinateFrames(document);
    const viewer = {
      isDestroyed: () => false,
      camera: {
        frustum: new PerspectiveFrustum({
          fov: Math.PI / 3,
          aspectRatio: 800 / 900,
          near: 0.05,
          far: 10000,
        }),
      },
      scene: {
        canvas: {
          getBoundingClientRect: () => ({
            left: 15,
            top: 20,
            width: 800,
            height: 900,
          }),
        },
      },
    };
    const adapter = createWorkspaceCameraAdapter({ viewer, document });
    const pose = adapter.pose(document.nodes[5]);
    const localEye = frames.ecefToLocal(document.nodes[4].id, pose.position);
    assert.ok(Math.abs(localEye[0] - 0.8) < 1e-8);
    assert.ok(localEye[1] < 0.55 - 0.05);
    assert.ok(Math.abs(localEye[2] - 1.16) < 1e-8);
    assert.ok(
      Cartesian3.dot(
        new Cartesian3(...pose.direction),
        new Cartesian3(
          ...frames.localDirectionToEcef(document.nodes[4].id, [0, 1, 0]),
        ),
      ) > 0.999999,
    );
    const points = createScreenProjection({ viewer, document })(pose);
    assert.ok(points.every(([x, y]) => x > 15 && x < 815 && y > 20 && y < 920));
    assert.ok(Math.abs(points[0][1] - points[1][1]) < 1e-5);
    const away = { ...pose, direction: pose.direction.map((n) => -n) };
    assert.equal(createScreenProjection({ viewer, document })(away), null);
  });
}
