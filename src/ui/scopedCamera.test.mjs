import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationController } from './navigationController.js';

function fixture() {
  let releases = 0;
  const viewer = {
    camera: {
      cancelFlight() {
        releases++;
      },
      lookAtTransform() {},
    },
  };
  const navigation = new NavigationController({
    viewer,
    tracking: Object.fromEntries(
      [
        'flightsLayer',
        'militaryFlightsLayer',
        'satellitesLayer',
        'aisLiveVesselsLayer',
        'militaryAwarenessLayer',
        'rocketLaunchesLayer',
      ].map((key) => [key, {}]),
    ),
    isCockpitActive: () => false,
    clearLocation() {},
    cancelShareSelection: () => false,
    getDataManager: () => null,
    stopOrbit() {},
    interruptCameraMotion() {},
    showToast() {},
  });
  return { navigation, viewer, releases: () => releases };
}

test('lease uses the existing generation and is synchronously revoked before newer navigation', () => {
  const f = fixture(),
    lease = f.navigation.claimScopedCamera();
  assert.equal(lease.isCurrent(), true);
  let cleanup = false;
  lease.signal.addEventListener('abort', () => {
    cleanup = true;
  });
  f.navigation._runExplicitNavigation('scene', () => {
    assert.equal(cleanup, true);
    assert.equal(lease.isCurrent(), false);
  });
  lease.release();
  f.navigation.stop();
});

test('blocked entry is inert and stop aborts an active lease even without generation change', () => {
  const f = fixture();
  f.viewer.trackedEntity = {};
  assert.equal(f.navigation.claimScopedCamera(), null);
  assert.equal(f.releases(), 0);
  f.viewer.trackedEntity = undefined;
  assert.equal(f.navigation.claimScopedCamera({ isBusy: () => true }), null);
  assert.equal(f.releases(), 0);
  const lease = f.navigation.claimScopedCamera();
  f.navigation.stop();
  assert.equal(lease.signal.aborted, true);
  assert.equal(lease.isCurrent(), false);
  assert.equal(f.navigation.claimScopedCamera(), null);
});

test('reentrant newer intent during claim cannot grant a stale lease', () => {
  const f = fixture();
  let first = true;
  const unsubscribe = f.navigation.subscribeCameraHandoff(() => {
    if (first) {
      first = false;
      f.navigation._beginDeferredNavigation('shared view');
    }
  });
  assert.equal(f.navigation.claimScopedCamera(), null);
  unsubscribe();
  f.navigation.stop();
});
