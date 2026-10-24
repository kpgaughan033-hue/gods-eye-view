/**
 * Cesium math adapter only: no Viewer, scene, DOM, provider, or network.
 * Authored records and public results remain plain data. Column-vector
 * convention: ECEF = ENU(anchor) * T_building * ... * T_node * local.
 */
import { Cartesian3, Matrix3, Matrix4, Quaternion, Transforms } from 'cesium';
import { validateSpatialDocument } from './spatialModel.js';

const array = (v) => [v.x, v.y, v.z];
function vector(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    ![0, 1, 2].every((i) => Number.isFinite(value[i]))
  )
    throw new TypeError('Expected three finite coordinates');
  return new Cartesian3(...value);
}
function transform({ translationM, rotationXYZW }) {
  // Validation tolerates decimal roundoff; use a rigid rotation internally.
  const quaternion = Quaternion.normalize(
    new Quaternion(...rotationXYZW),
    new Quaternion(),
  );
  const rotation = Matrix3.fromQuaternion(quaternion, new Matrix3());
  return Matrix4.fromRotationTranslation(
    rotation,
    vector(translationM),
    new Matrix4(),
  );
}

/**
 * Snapshot validated transforms. Later edits to input records cannot alter the
 * frame set; construct a new set after editing. The logical globe has no local
 * Cartesian frame. Matrices returned to callers are new column-major arrays.
 * nodeToAnchorMatrix includes the building's local transform but excludes ENU
 * georeferencing. Direction conversions preserve magnitude and omit translation.
 */
export function createCoordinateFrames(document) {
  validateSpatialDocument(document);
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const building = document.nodes.find((node) => node.kind === 'building');
  const { longitudeDeg, latitudeDeg, ellipsoidalHeightM } = building.anchor;
  const enu = Transforms.eastNorthUpToFixedFrame(
    Cartesian3.fromDegrees(longitudeDeg, latitudeDeg, ellipsoidalHeightM),
  );
  const local = new Map();
  const world = new Map();
  const inverse = new Map();
  function compose(node) {
    if (local.has(node.id)) return local.get(node.id);
    const matrix = transform(node.transform);
    if (node !== building)
      Matrix4.multiply(compose(nodes.get(node.parentId)), matrix, matrix);
    if (!Array.from(matrix).every(Number.isFinite))
      throw new RangeError('Composed transform is not finite');
    local.set(node.id, matrix);
    const ecef = Matrix4.multiply(enu, matrix, new Matrix4());
    if (!Array.from(ecef).every(Number.isFinite))
      throw new RangeError('ECEF transform is not finite');
    world.set(node.id, ecef);
    inverse.set(node.id, Matrix4.inverseTransformation(ecef, new Matrix4()));
    return matrix;
  }
  for (const node of document.nodes) if (node.kind !== 'globe') compose(node);
  function get(map, id) {
    if (!map.has(id))
      throw new RangeError('Unknown node or logical globe has no local frame');
    return map.get(id);
  }
  function convert(map, id, value, direction) {
    const operation = direction
      ? Matrix4.multiplyByPointAsVector
      : Matrix4.multiplyByPoint;
    const result = array(
      operation(get(map, id), vector(value), new Cartesian3()),
    );
    if (!result.every(Number.isFinite))
      throw new RangeError('Converted coordinates are not finite');
    return result;
  }
  return Object.freeze({
    nodeToAnchorMatrix: (id) => Matrix4.toArray(get(local, id)),
    localToEcef: (id, point) => convert(world, id, point, false),
    ecefToLocal: (id, point) => convert(inverse, id, point, false),
    localDirectionToEcef: (id, direction) =>
      convert(world, id, direction, true),
    ecefDirectionToLocal: (id, direction) =>
      convert(inverse, id, direction, true),
  });
}
