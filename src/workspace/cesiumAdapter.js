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
import { workspaceBoxParts, screenPickId } from './geometry.js';
import { createCoordinateFrames } from './coordinates.js';
import { validateSpatialDocument } from './spatialModel.js';

function createBox({
  nodeId,
  pickId,
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
      id: pickId || nodeId,
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
    allowPicking: Boolean(pickId),
  });
}

/** Borrow the viewer; own only a private collection and bounded static box primitives. */
export function createCesiumWorkspaceAdapter({
  viewer,
  document,
  requestRender,
  screens = new Set(),
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
    .flatMap((node) =>
      workspaceBoxParts(node).map(({ part, minM, maxM, color, outline }) => ({
        nodeId: node.id,
        part,
        pickId:
          node.kind === 'desk' && part === 'screen'
            ? screenPickId(document)
            : null,
        outline,
        dimensionsM: maxM.map((v, i) => v - minM[i]),
        centerEcef: frames.localToEcef(
          node.id,
          minM.map((v, i) => (v + maxM[i]) / 2),
        ),
        axesEcef: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ].map((axis) => frames.localDirectionToEcef(node.id, axis)),
        color,
      })),
    );
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
          screens.delete(primitive);
          if (!primitive.isDestroyed()) {
            try {
              if (!collection.isDestroyed()) collection.remove(primitive);
            } finally {
              if (!primitive.isDestroyed()) primitive.destroy();
            }
          }
        });
        signal.throwIfAborted();
        if (box.pickId) screens.add(primitive);
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
