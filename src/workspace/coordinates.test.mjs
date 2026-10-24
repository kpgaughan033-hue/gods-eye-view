import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoordinateFrames } from './coordinates.js';
import { createWorkspaceFixture } from './fixture.js';

const near = (actual, expected, tolerance = 1e-8) => {
  const error = Math.hypot(...actual.map((value, i) => value - expected[i]));
  assert.ok(error < tolerance, `error ${error} m exceeds ${tolerance} m`);
};
const zeroAnchor = (document) => {
  document.nodes[1].anchor = {
    longitudeDeg: 0,
    latitudeDeg: 0,
    ellipsoidalHeightM: 0,
  };
};
const qz90 = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

test('WGS84 equator anchor and ENU axes have independent known ECEF values', () => {
  const document = createWorkspaceFixture();
  zeroAnchor(document);
  const frames = createCoordinateFrames(document);
  const id = document.nodes[1].id;
  near(frames.localToEcef(id, [0, 0, 0]), [6378137, 0, 0]);
  near(frames.localToEcef(id, [2, 3, 4]), [6378141, 2, 3]);
  near(frames.localDirectionToEcef(id, [2, 3, 4]), [4, 2, 3]);
  near(frames.ecefDirectionToLocal(id, [4, 2, 3]), [2, 3, 4]);
});

test('ellipsoidal height and east/north/up orientation at longitude 90 degrees', () => {
  const document = createWorkspaceFixture();
  document.nodes[1].anchor = {
    longitudeDeg: 90,
    latitudeDeg: 0,
    ellipsoidalHeightM: 200,
  };
  const frames = createCoordinateFrames(document);
  const id = document.nodes[1].id;
  near(frames.localToEcef(id, [0, 0, 0]), [0, 6378337, 0]);
  near(frames.localDirectionToEcef(id, [1, 0, 0]), [-1, 0, 0]);
  near(frames.localDirectionToEcef(id, [0, 1, 0]), [0, 0, 1]);
  near(frames.localDirectionToEcef(id, [0, 0, 1]), [0, 1, 0]);
});

test('parent rotation rotates child translation; transforms compose child to parent', () => {
  const document = createWorkspaceFixture();
  zeroAnchor(document);
  document.nodes[1].transform = {
    translationM: [10, 0, 0],
    rotationXYZW: qz90,
  };
  document.nodes[2].transform = { translationM: [2, 0, 0], rotationXYZW: qz90 };
  const frames = createCoordinateFrames(document);
  near(frames.localToEcef(document.nodes[2].id, [1, 0, 0]), [6378137, 9, 2]);
  // Two +90° rotations turn east into west; translation is excluded.
  near(
    frames.localDirectionToEcef(document.nodes[2].id, [1, 0, 0]),
    [0, -1, 0],
  );
  const matrix = frames.nodeToAnchorMatrix(document.nodes[2].id);
  near(matrix.slice(12, 15), [10, 2, 0]);
  assert.equal(matrix.length, 16);
});

test('quaternion XYZW order, non-Z rotation, and sign equivalence', () => {
  const document = createWorkspaceFixture();
  zeroAnchor(document);
  document.nodes[1].transform.rotationXYZW = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  const id = document.nodes[1].id;
  const first = createCoordinateFrames(document);
  near(first.localDirectionToEcef(id, [0, 1, 0]), [1, 0, 0]);
  document.nodes[1].transform.rotationXYZW =
    document.nodes[1].transform.rotationXYZW.map((v) => -v);
  near(
    createCoordinateFrames(document).localToEcef(id, [1, 2, 3]),
    first.localToEcef(id, [1, 2, 3]),
  );
});

test('fixture descendants compose local offsets without mutating or retaining input', () => {
  const document = createWorkspaceFixture();
  const before = JSON.stringify(document);
  const frames = createCoordinateFrames(document);
  const id = document.nodes[5].id;
  near(frames.nodeToAnchorMatrix(id).slice(12, 15), [-0.2, 0.4, 1]);
  assert.equal(JSON.stringify(document), before);
  const expected = frames.localToEcef(id, [0, 0, 0]);
  document.nodes[1].anchor.latitudeDeg = 0;
  document.nodes[4].transform.translationM[0] = 100;
  near(frames.localToEcef(id, [0, 0, 0]), expected);
  frames.nodeToAnchorMatrix(id)[12] = 100;
  near(frames.localToEcef(id, [0, 0, 0]), expected);
});

test('frame composition does not depend on node order', () => {
  const document = createWorkspaceFixture();
  const id = document.nodes[5].id;
  const expected = createCoordinateFrames(document).localToEcef(id, [1, 2, 3]);
  document.nodes.reverse();
  near(createCoordinateFrames(document).localToEcef(id, [1, 2, 3]), expected);
});

test('accepted quaternion decimal roundoff is normalized only inside the adapter', () => {
  const document = createWorkspaceFixture();
  document.nodes[1].transform.rotationXYZW = qz90.map(
    (value) => value * (1 + 1e-12),
  );
  const before = JSON.stringify(document);
  const frames = createCoordinateFrames(document);
  const id = document.nodes[5].id;
  near(
    frames.ecefToLocal(id, frames.localToEcef(id, [1, 2, 3])),
    [1, 2, 3],
    1e-6,
  );
  assert.equal(JSON.stringify(document), before);
});

for (const [longitudeDeg, latitudeDeg, ellipsoidalHeightM] of [
  [-97.7431, 30.2672, 200],
  [151.2093, -33.8688, 50],
  [179.999, 65, -20],
  [-179.999, -60, 1000],
  [0, 0, 0],
]) {
  test(`submillimeter fixture-scale round trips at ${longitudeDeg}, ${latitudeDeg}`, () => {
    const document = createWorkspaceFixture();
    document.nodes[1].anchor = {
      longitudeDeg,
      latitudeDeg,
      ellipsoidalHeightM,
    };
    document.nodes[1].transform.rotationXYZW = qz90;
    document.nodes[3].transform.rotationXYZW = [
      Math.sin(0.31),
      0,
      0,
      Math.cos(0.31),
    ];
    const frames = createCoordinateFrames(document);
    // 1 micrometer tolerance is stricter than the milestone's <1 mm gate.
    for (const node of document.nodes.slice(1)) {
      for (const point of [
        [0, 0, 0],
        node.bounds.minM,
        node.bounds.maxM,
        [0.0001, -0.0002, 0.0003],
        [10.123456, -8.654321, 3.25],
      ]) {
        const ecef = frames.localToEcef(node.id, point);
        const local = frames.ecefToLocal(node.id, ecef);
        near(local, point, 1e-6);
        near(frames.localToEcef(node.id, local), ecef, 1e-6);
      }
    }
    const id = document.nodes[5].id;
    const a = frames.localToEcef(id, [0, 0, 0]);
    const b = frames.localToEcef(id, [0.0001, 0, 0]);
    assert.ok(
      Math.abs(Math.hypot(...a.map((v, i) => b[i] - v)) - 0.0001) < 1e-8,
    );
  });
}

test('invalid documents, unknown/globe frames and malformed coordinates fail explicitly', () => {
  assert.throws(() => createCoordinateFrames({}), /required/);
  const frames = createCoordinateFrames(createWorkspaceFixture());
  for (const id of ['absent', 'demo-globe-001'])
    assert.throws(() => frames.localToEcef(id, [0, 0, 0]), /no local frame/);
  for (const point of [[NaN, 0, 0], [0, 0], ['1', 0, 0], Array(3)])
    assert.throws(
      () => frames.ecefToLocal('demo-building-001', point),
      /finite/,
    );
});
