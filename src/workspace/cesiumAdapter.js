import {
  BoxGeometry,
  BoxOutlineGeometry,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  Matrix3,
  Matrix4,
  PerInstanceColorAppearance,
  Primitive,
  PrimitiveCollection,
} from 'cesium';
import { createCoordinateFrames } from './coordinates.js';
import { validateSpatialDocument } from './spatialModel.js';

function createBox({
  nodeId,
  outline,
  dimensionsM,
  centerEcef,
  axesEcef,
  color,
}) {
  const rotation = Matrix3.fromColumnMajorArray(axesEcef.flat());
  const modelMatrix = Matrix4.fromRotationTranslation(
    rotation,
    new Cartesian3(...centerEcef),
  );
  const dimensions = new Cartesian3(...dimensionsM);
  const geometry = outline
    ? BoxOutlineGeometry.fromDimensions({ dimensions })
    : BoxGeometry.fromDimensions({
        dimensions,
        vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
      });
  return new Primitive({
    geometryInstances: new GeometryInstance({
      id: nodeId,
      geometry,
      modelMatrix,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(
          Color.fromCssColorString(color),
        ),
      },
    }),
    appearance: new PerInstanceColorAppearance({
      flat: true,
      translucent: false,
    }),
    asynchronous: false,
    allowPicking: false,
  });
}

/** Borrow the viewer; own only a private collection and four static primitives. */
export function createCesiumWorkspaceAdapter({
  viewer,
  document,
  requestRender,
  createCollection = () => new PrimitiveCollection(),
  createPrimitive = createBox,
}) {
  validateSpatialDocument(document);
  const frames = createCoordinateFrames(document);
  // Snapshot geometry data before any acquisition; later caller edits are inert.
  const boxes = document.nodes
    .filter((node) =>
      ['building', 'floor', 'office', 'desk'].includes(node.kind),
    )
    .map((node) => {
      const min = [...node.bounds.minM],
        max = [...node.bounds.maxM];
      if (node.kind === 'floor')
        max[2] = min[2] + Math.min(0.1, max[2] - min[2]);
      const center = min.map((v, i) => (v + max[i]) / 2);
      return {
        nodeId: node.id,
        outline: node.kind === 'building' || node.kind === 'office',
        dimensionsM: max.map((v, i) => v - min[i]),
        centerEcef: frames.localToEcef(node.id, center),
        axesEcef: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ].map((axis) => frames.localDirectionToEcef(node.id, axis)),
        color: {
          building: '#00d4ff',
          floor: '#42566b',
          office: '#ffcc66',
          desk: '#66ddaa',
        }[node.kind],
      };
    });
  return Object.freeze({
    acquire({ signal, defer }) {
      signal.throwIfAborted();
      if (viewer.isDestroyed())
        throw new Error('Workspace viewer is destroyed');
      const collection = createCollection();
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        const errors = [];
        if (!collection.isDestroyed()) {
          try {
            // remove destroys by the parent collection's policy; otherwise destroy ours.
            if (!viewer.isDestroyed())
              viewer.scene.primitives.remove(collection);
          } catch (error) {
            errors.push(error);
          }
          try {
            if (!collection.isDestroyed()) collection.destroy();
          } catch (error) {
            errors.push(error);
          }
        }
        if (!viewer.isDestroyed()) requestRender('workspace-dispose');
        if (errors.length)
          throw new AggregateError(errors, 'Workspace geometry release failed');
      };
      // Register before add/build, so partial construction is always owned.
      defer(dispose);
      signal.throwIfAborted();
      collection.show = false;
      viewer.scene.primitives.add(collection);
      for (const box of boxes) {
        signal.throwIfAborted();
        const primitive = createPrimitive(box);
        defer(() => {
          if (!primitive.isDestroyed()) {
            try {
              if (!collection.isDestroyed()) collection.remove(primitive);
            } finally {
              if (!primitive.isDestroyed()) primitive.destroy();
            }
          }
        });
        signal.throwIfAborted();
        collection.add(primitive);
      }
      return {
        dispose,
        activate() {
          signal.throwIfAborted();
          if (disposed || viewer.isDestroyed())
            throw new Error('Workspace presentation is disposed');
          collection.show = true;
          requestRender('workspace-activate');
        },
      };
    },
  });
}
