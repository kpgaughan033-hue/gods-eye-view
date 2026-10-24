import { createWorkspaceFixture } from './fixture.js';
import { createCesiumWorkspaceAdapter } from './cesiumAdapter.js';
import {
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';
import { createWorkspaceNavigation } from './navigation.js';
import { createWorkspaceCameraAdapter } from './cameraAdapter.js';
import { Cartographic } from 'cesium';

/** Called only by the explicit development entry; borrows the existing viewer. */
export function createWorkspacePrototypeAdapter({ viewer }) {
  // Static geometry needs one-shot renders, never a continuous-render hold.
  return createCesiumWorkspaceAdapter({
    viewer,
    document: createWorkspaceFixture(),
    requestRender: governorRequestRender,
  });
}

export function createWorkspacePrototypeNavigation({
  viewer,
  session,
  debug,
  signal,
  cancelStartupCamera,
  initialPose,
}) {
  const document = createWorkspaceFixture();
  const directorBusy = () =>
    debug.sceneDirector?.cameraBusy === true ||
    // Replay has a separate camera loop, with no public ownership reader.
    // Conservatively refuse while this layer is active; never stop its replay.
    debug.getRenderGovernorDiagnostics?.().holds.includes('rocket-launches') ===
      true;
  const supported = () => {
    // Conservative capability gate: never clip external 3D tiles or switch maps.
    if (viewer.scene.globe.show === false) return false;
    const primitives = viewer.scene.primitives;
    for (let i = 0; i < primitives.length; i++) {
      const primitive = primitives.get(i);
      if (primitive.isCesium3DTileset && primitive.show !== false) return false;
    }
    const anchor = document.nodes.find(
      (node) => node.kind === 'building',
    ).anchor;
    const ground = viewer.scene.globe.getHeight(
      Cartographic.fromDegrees(anchor.longitudeDeg, anchor.latitudeDeg),
    );
    return !Number.isFinite(ground) || ground < anchor.ellipsoidalHeightM;
  };
  const owner = createWorkspaceNavigation({
    document,
    session,
    signal,
    initialPose,
    supported,
    camera: createWorkspaceCameraAdapter({
      viewer,
      document,
      requestRender: governorRequestRender,
      holdRender: holdContinuousRender,
      releaseRender: releaseContinuousRender,
    }),
    claim: () => {
      const lease = debug.styleManager.claimScopedCamera({
        isBusy: directorBusy,
      });
      if (lease) cancelStartupCamera?.();
      return lease;
    },
    diagnostics: () => ({
      map: debug.mapStackController.getState().activeId,
      layers: debug.dataManager
        .getAll()
        .map(({ id, enabled }) => ({ id, enabled })),
    }),
    listenInput: (listener) => {
      // Include UI gestures (e.g. keyboard/click activation of a replay button),
      // not only the canvas. This listener is instance-owned and development-only.
      const canvas = viewer.scene.canvas.ownerDocument || viewer.scene.canvas;
      const events = ['pointerdown', 'touchstart', 'wheel', 'keydown'];
      for (const event of events)
        canvas.addEventListener(event, listener, {
          capture: true,
          passive: true,
        });
      return () => {
        for (const event of events)
          canvas.removeEventListener(event, listener, true);
      };
    },
  });
  return owner;
}
