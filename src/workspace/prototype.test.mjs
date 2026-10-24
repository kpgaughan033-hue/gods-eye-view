import test from 'node:test';
import assert from 'node:assert/strict';
import { Cartesian3 } from 'cesium';
import { createWorkspacePrototypeNavigation } from './prototype.js';

test('active rocket replay layer conservatively refuses entry without releasing it', async () => {
  let acquired = 0,
    busy;
  const canvas = new EventTarget(),
    controller = new AbortController();
  const viewer = {
    camera: {
      positionWC: new Cartesian3(6378137, 0, 0),
      directionWC: new Cartesian3(0, 1, 0),
      upWC: new Cartesian3(0, 0, 1),
    },
    scene: {
      canvas,
      globe: { show: true, getHeight: () => undefined },
      primitives: { length: 0 },
    },
  };
  const owner = createWorkspacePrototypeNavigation({
    viewer,
    signal: controller.signal,
    session: {
      activate() {
        acquired++;
      },
      deactivate() {},
    },
    debug: {
      sceneDirector: { cameraBusy: false },
      getRenderGovernorDiagnostics: () => ({ holds: ['rocket-launches'] }),
      styleManager: {
        claimScopedCamera({ isBusy }) {
          busy = isBusy();
          return null;
        },
      },
      mapStackController: { getState: () => ({ activeId: 'osm' }) },
      dataManager: { getAll: () => [] },
    },
  });
  assert.equal(await owner.enter(), false);
  assert.equal(busy, true);
  assert.equal(acquired, 0);
  owner.dispose();
});
