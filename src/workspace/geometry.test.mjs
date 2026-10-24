import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceBoxParts } from './geometry.js';
import { createWorkspaceFixture } from './fixture.js';

const nodes = createWorkspaceFixture().nodes.filter((n) =>
  ['building', 'floor', 'office', 'desk'].includes(n.kind),
);
const parts = Object.fromEntries(
  nodes.map((n) => [n.kind, workspaceBoxParts(n)]),
);
test('fictional cutaway is bounded, opaque static boxes with unique part names and positive finite dimensions', () => {
  assert.equal(Object.values(parts).flat().length, 34);
  for (const boxes of Object.values(parts)) {
    assert.equal(new Set(boxes.map((b) => b.part)).size, boxes.length);
    for (const box of boxes) {
      assert.match(box.color, /^#[a-f0-9]{6}$/i);
      for (let i = 0; i < 3; i++) {
        assert.ok(Number.isFinite(box.minM[i]) && Number.isFinite(box.maxM[i]));
        assert.ok(box.maxM[i] > box.minM[i]);
      }
    }
  }
});
test('exterior has roof rails and entrance but no opaque roof or south facade; office has an open doorway', () => {
  const roof = parts.building.filter((b) => b.part.startsWith('roof'));
  assert.equal(roof.length, 3);
  assert.ok(
    roof.every(
      (b) => Math.min(b.maxM[0] - b.minM[0], b.maxM[1] - b.minM[1]) <= 0.25,
    ),
  );
  assert.ok(parts.building.some((b) => b.part === 'door-lintel'));
  // Eye-side opening at local (2.1, 0, 1.5) is not covered by a solid wall.
  assert.ok(
    !parts.office
      .filter((b) => !b.outline)
      .some((b) =>
        [2.1, 0, 1.5].every((v, i) => v >= b.minM[i] && v <= b.maxM[i]),
      ),
  );
});
test('desk is a thin top, four supports and passive monitor; no application presentation', () => {
  assert.equal(parts.desk.filter((b) => b.part.startsWith('leg-')).length, 4);
  const top = parts.desk.find((b) => b.part === 'desktop');
  assert.ok(top.maxM[2] - top.minM[2] < 0.07);
  assert.ok(parts.desk.find((b) => b.part === 'screen').minM[2] > top.maxM[2]);
  assert.deepEqual(
    workspaceBoxParts(createWorkspaceFixture().nodes.at(-1)),
    [],
  );
});
