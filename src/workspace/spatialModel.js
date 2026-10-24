/**
 * Version 1 spatial records: right-handed local meters, +Z up; active XYZW
 * rotations map child axes into parent axes. IDs are assigned identities,
 * never derived from labels, coordinates, order, or ancestry. No renderer state.
 */
export const SPATIAL_DOCUMENT_VERSION = 1;
export const SPATIAL_LIMITS = Object.freeze({ nodes: 64, text: 128 });
export const QUATERNION_UNIT_TOLERANCE = 1e-10;
const KINDS = ['globe', 'building', 'floor', 'office', 'desk', 'application'];
const own = (value, key) => Object.hasOwn(value, key);
const fail = (path, reason) => {
  throw new TypeError(`${path}: ${reason}`);
};

function record(value, path, required, optional = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(path, 'expected a plain record');
  for (const key of Reflect.ownKeys(value)) {
    if (!required.includes(key) && !optional.includes(key))
      fail(path, 'unsupported field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!own(descriptor, 'value') || !descriptor.enumerable)
      fail(path, 'expected enumerable data fields');
  }
  for (const key of required)
    if (!own(value, key)) fail(`${path}.${key}`, 'required');
}

function text(value, path) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > SPATIAL_LIMITS.text
  )
    fail(path, 'expected bounded nonempty text');
}

function finite(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(path, 'expected a finite number');
}

function plainArray(value, path) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    fail(path, 'expected a plain array');
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (
      typeof key !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(key) ||
      Number(key) >= value.length
    )
      fail(path, 'unsupported array field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!own(descriptor, 'value') || !descriptor.enumerable)
      fail(path, 'expected array data fields');
  }
}

function tuple(value, length, path) {
  plainArray(value, path);
  if (value.length !== length) fail(path, `expected ${length} numbers`);
  for (let i = 0; i < length; i++) finite(value[i], `${path}[${i}]`);
}

/**
 * Validate and return the original document; throws TypeError with a field
 * path on failure. No mutation/normalization or renderer handles. Bounds are
 * local AABBs, not a containment/collision policy. Version 1 permits branches
 * along globe -> building -> floor -> office -> desk -> application, with one
 * anchored building. It does not require every branch to reach application.
 * @param {{version:number, workspaceId:string, rootId:string, nodes:Object[]}} document
 */
export function validateSpatialDocument(document) {
  record(document, 'document', ['version', 'workspaceId', 'rootId', 'nodes']);
  if (document.version !== SPATIAL_DOCUMENT_VERSION)
    fail('document.version', 'unsupported version');
  text(document.workspaceId, 'document.workspaceId');
  text(document.rootId, 'document.rootId');
  if (
    !Array.isArray(document.nodes) ||
    !document.nodes.length ||
    document.nodes.length > SPATIAL_LIMITS.nodes
  )
    fail('document.nodes', 'expected a bounded nonempty node array');
  plainArray(document.nodes, 'document.nodes');
  const nodes = new Map();
  for (let i = 0; i < document.nodes.length; i++) {
    const node = document.nodes[i];
    const path = `document.nodes[${i}]`;
    record(
      node,
      path,
      ['id', 'parentId', 'kind', 'label', 'transform', 'bounds'],
      ['anchor', 'widget'],
    );
    text(node.id, `${path}.id`);
    text(node.label, `${path}.label`);
    if (nodes.has(node.id)) fail(`${path}.id`, 'duplicate ID');
    if (!KINDS.includes(node.kind)) fail(`${path}.kind`, 'unsupported kind');
    if (node.parentId !== null) text(node.parentId, `${path}.parentId`);
    record(node.transform, `${path}.transform`, [
      'translationM',
      'rotationXYZW',
    ]);
    tuple(node.transform.translationM, 3, `${path}.transform.translationM`);
    tuple(node.transform.rotationXYZW, 4, `${path}.transform.rotationXYZW`);
    if (
      Math.abs(Math.hypot(...node.transform.rotationXYZW) - 1) >
      QUATERNION_UNIT_TOLERANCE
    )
      fail(
        `${path}.transform.rotationXYZW`,
        'expected a normalized quaternion',
      );
    if (node.kind === 'globe') {
      const { translationM: t, rotationXYZW: q } = node.transform;
      if (
        node.bounds !== null ||
        t.some((n) => n !== 0) ||
        q.slice(0, 3).some((n) => n !== 0) ||
        Math.abs(q[3]) !== 1
      )
        fail(path, 'globe requires null bounds and identity transform');
    } else {
      record(node.bounds, `${path}.bounds`, ['minM', 'maxM']);
      tuple(node.bounds.minM, 3, `${path}.bounds.minM`);
      tuple(node.bounds.maxM, 3, `${path}.bounds.maxM`);
      if (node.bounds.minM.some((min, axis) => min >= node.bounds.maxM[axis]))
        fail(`${path}.bounds`, 'expected nonempty local bounds');
    }
    if (node.kind === 'building') {
      record(node.anchor, `${path}.anchor`, [
        'longitudeDeg',
        'latitudeDeg',
        'ellipsoidalHeightM',
      ]);
      for (const key of ['longitudeDeg', 'latitudeDeg', 'ellipsoidalHeightM'])
        finite(node.anchor[key], `${path}.anchor.${key}`);
      if (
        Math.abs(node.anchor.longitudeDeg) > 180 ||
        Math.abs(node.anchor.latitudeDeg) > 90
      )
        fail(`${path}.anchor`, 'longitude/latitude out of range');
    } else if (own(node, 'anchor'))
      fail(`${path}.anchor`, 'only the building may have an anchor');
    if (own(node, 'widget')) {
      if (node.kind !== 'application')
        fail(`${path}.widget`, 'only applications may have widgets');
      record(node.widget, `${path}.widget`, ['type', 'stateKey']);
      if (node.widget.type !== 'task-checklist')
        fail(`${path}.widget.type`, 'unsupported widget');
      text(node.widget.stateKey, `${path}.widget.stateKey`);
    }
    nodes.set(node.id, node);
  }
  const root = nodes.get(document.rootId);
  if (!root || root.kind !== 'globe' || root.parentId !== null)
    fail('document.rootId', 'expected the parentless globe');
  if (
    [...nodes.values()].filter((node) => node.kind === 'building').length !== 1
  )
    fail('document.nodes', 'expected exactly one geographic building');
  for (const node of nodes.values()) {
    const seen = new Set();
    let cursor = node;
    while (cursor.parentId !== null) {
      if (seen.has(cursor.id)) fail('document.nodes', 'cycle in parent links');
      seen.add(cursor.id);
      cursor = nodes.get(cursor.parentId);
      if (!cursor) fail('document.nodes', 'missing parent');
    }
    if (cursor !== root) fail('document.nodes', 'disconnected root');
    if (node !== root) {
      const parent = nodes.get(node.parentId);
      if (KINDS.indexOf(node.kind) !== KINDS.indexOf(parent.kind) + 1)
        fail('document.nodes', 'illegal parent/child hierarchy');
    }
  }
  return document;
}
