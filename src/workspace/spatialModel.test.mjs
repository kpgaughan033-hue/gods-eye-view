import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpatialDocument, SPATIAL_LIMITS } from './spatialModel.js';
import { createWorkspaceFixture } from './fixture.js';

test('fixture is independent plain JSON, with assigned identities and a fictional anchor', () => {
  const fixture = createWorkspaceFixture();
  const before = JSON.stringify(fixture);
  assert.equal(validateSpatialDocument(fixture), fixture);
  assert.deepEqual(JSON.parse(before), fixture);
  assert.equal(JSON.stringify(fixture), before);
  assert.deepEqual(
    fixture.nodes.map((node) => node.kind),
    ['globe', 'building', 'floor', 'office', 'desk', 'application'],
  );
  assert.deepEqual(fixture.nodes[1].anchor, {
    longitudeDeg: -97.7431,
    latitudeDeg: 30.2672,
    ellipsoidalHeightM: 200,
  });
  fixture.nodes[1].transform.translationM[0] = 5;
  assert.equal(createWorkspaceFixture().nodes[1].transform.translationM[0], 0);
});

const invalid = [
  [
    'future version',
    (d) => {
      d.version = 2;
    },
    /version/,
  ],
  [
    'missing field',
    (d) => {
      delete d.workspaceId;
    },
    /required/,
  ],
  [
    'unknown document field',
    (d) => {
      d.renderer = 'cesium';
    },
    /unsupported field/,
  ],
  [
    'empty identity',
    (d) => {
      d.workspaceId = ' ';
    },
    /nonempty/,
  ],
  [
    'oversized identity',
    (d) => {
      d.nodes[0].id = 'x'.repeat(129);
    },
    /bounded/,
  ],
  [
    'empty nodes',
    (d) => {
      d.nodes = [];
    },
    /node array/,
  ],
  [
    'oversized nodes',
    (d) => {
      d.nodes = Array(SPATIAL_LIMITS.nodes + 1).fill(d.nodes[0]);
    },
    /bounded/,
  ],
  [
    'duplicate ID',
    (d) => {
      d.nodes[2].id = d.nodes[1].id;
    },
    /duplicate/,
  ],
  [
    'missing root',
    (d) => {
      d.rootId = 'absent';
    },
    /parentless globe/,
  ],
  [
    'wrong root kind',
    (d) => {
      d.rootId = d.nodes[1].id;
    },
    /parentless globe/,
  ],
  [
    'missing parent',
    (d) => {
      d.nodes[3].parentId = 'absent';
    },
    /missing parent/,
  ],
  [
    'self cycle',
    (d) => {
      d.nodes[3].parentId = d.nodes[3].id;
    },
    /cycle/,
  ],
  [
    'long cycle',
    (d) => {
      d.nodes[2].parentId = d.nodes[4].id;
    },
    /cycle/,
  ],
  [
    'disconnected node',
    (d) => {
      d.nodes[3].parentId = null;
    },
    /disconnected/,
  ],
  [
    'second globe',
    (d) => {
      const n = structuredClone(d.nodes[0]);
      n.id = 'another-root';
      d.nodes.push(n);
    },
    /disconnected/,
  ],
  [
    'skipped level',
    (d) => {
      d.nodes[4].parentId = d.nodes[2].id;
    },
    /illegal/,
  ],
  [
    'unknown kind',
    (d) => {
      d.nodes[3].kind = 'room';
    },
    /unsupported kind/,
  ],
  [
    'missing building',
    (d) => {
      d.nodes.splice(1, 1);
    },
    /one geographic building/,
  ],
  [
    'second building',
    (d) => {
      const n = structuredClone(d.nodes[1]);
      n.id = 'second';
      d.nodes.push(n);
    },
    /one geographic building/,
  ],
  [
    'missing anchor',
    (d) => {
      delete d.nodes[1].anchor;
    },
    /anchor/,
  ],
  [
    'extra anchor',
    (d) => {
      d.nodes[3].anchor = d.nodes[1].anchor;
    },
    /only the building/,
  ],
  [
    'bad longitude',
    (d) => {
      d.nodes[1].anchor.longitudeDeg = 181;
    },
    /out of range/,
  ],
  [
    'bad latitude',
    (d) => {
      d.nodes[1].anchor.latitudeDeg = -91;
    },
    /out of range/,
  ],
  [
    'nonfinite height',
    (d) => {
      d.nodes[1].anchor.ellipsoidalHeightM = Infinity;
    },
    /finite/,
  ],
  [
    'unknown anchor datum',
    (d) => {
      d.nodes[1].anchor.height = 200;
    },
    /unsupported field/,
  ],
  [
    'nonfinite translation',
    (d) => {
      d.nodes[3].transform.translationM[0] = NaN;
    },
    /finite/,
  ],
  [
    'string coordinate',
    (d) => {
      d.nodes[3].transform.translationM[0] = '1';
    },
    /finite/,
  ],
  [
    'sparse translation',
    (d) => {
      delete d.nodes[3].transform.translationM[1];
    },
    /finite/,
  ],
  [
    'array callback',
    (d) => {
      d.nodes[3].transform.translationM.callback = () => {};
    },
    /array field/,
  ],
  [
    'array accessor',
    (d) => {
      Object.defineProperty(d.nodes[3].transform.translationM, '0', {
        get() {
          throw Error('must not execute');
        },
        enumerable: true,
      });
    },
    /data fields/,
  ],
  [
    'wrong tuple length',
    (d) => {
      d.nodes[3].transform.translationM.push(1);
    },
    /3 numbers/,
  ],
  [
    'scale',
    (d) => {
      d.nodes[3].transform.scale = 2;
    },
    /unsupported field/,
  ],
  [
    'zero quaternion',
    (d) => {
      d.nodes[3].transform.rotationXYZW = [0, 0, 0, 0];
    },
    /normalized/,
  ],
  [
    'unnormalized quaternion',
    (d) => {
      d.nodes[3].transform.rotationXYZW = [0, 0, 1, 1];
    },
    /normalized/,
  ],
  [
    'nonfinite quaternion',
    (d) => {
      d.nodes[3].transform.rotationXYZW[0] = Infinity;
    },
    /finite/,
  ],
  [
    'translated globe',
    (d) => {
      d.nodes[0].transform.translationM[0] = 1;
    },
    /identity/,
  ],
  [
    'rotated globe',
    (d) => {
      d.nodes[0].transform.rotationXYZW = [0, 0, 1, 0];
    },
    /identity/,
  ],
  [
    'globe bounds',
    (d) => {
      d.nodes[0].bounds = d.nodes[1].bounds;
    },
    /null bounds/,
  ],
  [
    'missing local bounds',
    (d) => {
      d.nodes[4].bounds = null;
    },
    /plain record/,
  ],
  [
    'inverted bounds',
    (d) => {
      d.nodes[4].bounds.maxM[0] = -1;
    },
    /nonempty/,
  ],
  [
    'empty bounds',
    (d) => {
      d.nodes[4].bounds.maxM[0] = 0;
    },
    /nonempty/,
  ],
  [
    'nonfinite bounds',
    (d) => {
      d.nodes[4].bounds.minM[0] = -Infinity;
    },
    /finite/,
  ],
  [
    'widget on desk',
    (d) => {
      d.nodes[4].widget = d.nodes[5].widget;
    },
    /only applications/,
  ],
  [
    'unknown widget',
    (d) => {
      d.nodes[5].widget.type = 'remote';
    },
    /unsupported/,
  ],
  [
    'empty widget key',
    (d) => {
      d.nodes[5].widget.stateKey = '';
    },
    /nonempty/,
  ],
  [
    'renderer instance',
    (d) => {
      d.nodes[4].transform = new Date();
    },
    /plain record/,
  ],
  [
    'accessor',
    (d) => {
      Object.defineProperty(d.nodes[3], 'label', {
        get() {
          throw Error('must not execute');
        },
        enumerable: true,
      });
    },
    /data fields/,
  ],
];
for (const [name, mutate, pattern] of invalid) {
  test(`rejects ${name}`, () => {
    const document = createWorkspaceFixture();
    mutate(document);
    assert.throws(() => validateSpatialDocument(document), pattern);
  });
}

test('ordering and labels do not determine identity; legal branches retain assigned IDs', () => {
  const document = createWorkspaceFixture();
  const office = structuredClone(document.nodes[3]);
  office.id = 'second-office';
  document.nodes.push(office);
  document.nodes[4].parentId = office.id;
  const ids = document.nodes.map((node) => node.id).sort();
  document.nodes.reverse();
  document.nodes.forEach((node) => {
    node.label = 'Same label';
  });
  validateSpatialDocument(document);
  assert.deepEqual(document.nodes.map((node) => node.id).sort(), ids);
});

test('equivalent identity quaternion sign and finite negative ellipsoidal height are valid', () => {
  const document = createWorkspaceFixture();
  document.nodes[0].transform.rotationXYZW = [0, 0, 0, -1];
  document.nodes[1].anchor.ellipsoidalHeightM = -10;
  validateSpatialDocument(document);
});
