import { cancelCameraArrival } from '../data/cameraArrival.js';
import { createStateChannel } from '../app/stateChannel.js';
import * as Cesium from 'cesium';
import {
  beginDeferredNavigation,
  reassertNavigationHandoff,
  runExplicitNavigation,
} from '../navigationPolicy.js';

/** Own camera authority generations, pending search UI and tracking handoff. */
export class NavigationController {
  constructor({
    viewer,
    tracking,
    searchInput,
    interruptCameraMotion,
    interruptGlobeRotation = () => {},
    isCockpitActive,
    clearLocation,
    cancelShareSelection,
    getDataManager,
    stopOrbit,
    showToast,
    cancelOrientation = () => {},
  }) {
    Object.assign(this, {
      viewer,
      tracking,
      searchInput,
      interruptCameraMotion,
      interruptGlobeRotation,
      isCockpitActive,
      clearLocation,
      cancelShareSelection,
      getDataManager,
      stopOrbit,
      showToast,
      cancelOrientation,
    });
    this._navigationGeneration = 0;
    this._cameraHandoffs = createStateChannel(() => ({
      generation: this._navigationGeneration,
    }));
    this._activeLocationSearchGeneration = null;
    this._disposed = false;
  }
  _stampNavigation({
    cancelPendingSelection = true,
    clearSearchedLocation = true,
  } = {}) {
    this.interruptGlobeRotation('navigation-intent');
    cancelCameraArrival(this.viewer);
    this.cancelOrientation();
    const { flightsLayer, militaryFlightsLayer, satellitesLayer } =
      this.tracking;
    this._navigationGeneration += 1;
    this._cameraHandoffs?.publish();
    // A newer destination owns the camera, so the last free-text search is no
    // longer where we are. DEFERRED navigation opts out here and clears at the
    // reassert seam instead: a geocode that never resolves moves no camera, and
    // a lookup that fails must not blank a readout that is still true.
    if (clearSearchedLocation) this.clearLocation();
    if (cancelPendingSelection) {
      const passivelyClearedShareSelection = this.cancelShareSelection();
      try {
        flightsLayer.cancelPendingTrackingRestore?.();
      } catch {
        /* best effort */
      }
      try {
        militaryFlightsLayer.cancelPendingTrackingRestore?.();
      } catch {
        /* best effort */
      }
      try {
        satellitesLayer.cancelPendingTrackingRestore?.();
      } catch {
        /* best effort */
      }
      // A deliberate destination supersedes share-selected entities that have
      // not arrived yet. Active owners publish their clear when released.
      if (!passivelyClearedShareSelection && !flightsLayer.getTrackedInfo?.()) {
        this.getDataManager()?.setLayerParams(
          'flights',
          {
            selectedFlightsTrackingId: null,
          },
          { origin: 'tool' },
        );
      }
      if (
        !passivelyClearedShareSelection &&
        !militaryFlightsLayer.getTrackedInfo?.()
      ) {
        this.getDataManager()?.setLayerParams(
          'military',
          {
            selectedMilitaryTrackingId: null,
          },
          { origin: 'tool' },
        );
      }
      if (
        !passivelyClearedShareSelection &&
        !satellitesLayer.getTrackedInfo?.()
      ) {
        this.getDataManager()?.setLayerParams(
          'satellites',
          {
            selectedSatTrackingId: null,
          },
          { origin: 'tool' },
        );
      }
    }
    if (this._activeLocationSearchGeneration !== null) {
      this._settleLocationSearchUi(this._activeLocationSearchGeneration);
    }
    return this._navigationGeneration;
  }

  _settleLocationSearchUi(generation) {
    if (this._activeLocationSearchGeneration !== generation) return;
    this._activeLocationSearchGeneration = null;
    this.searchInput?.classList.remove('searching', 'expanded');
    if (this.searchInput) this.searchInput.value = '';
    this.searchInput?.blur();
  }

  _releaseFollowCamera({
    preserveVesselSelection = true,
    preserveCameraFlight = false,
    trackingOrigin = 'tool',
  } = {}) {
    const {
      flightsLayer,
      militaryFlightsLayer,
      satellitesLayer,
      aisLiveVesselsLayer,
      militaryAwarenessLayer,
      rocketLaunchesLayer,
    } = this.tracking;
    let contactSelected = false;
    try {
      contactSelected = Boolean(
        militaryAwarenessLayer.releaseCameraOwnership?.({
          preserveVesselSelection,
          origin: trackingOrigin,
        }),
      );
    } catch {
      try {
        flightsLayer.stopTracking?.({ origin: trackingOrigin });
      } catch {
        /* best-effort release */
      }
      try {
        militaryFlightsLayer.stopTracking?.({ origin: trackingOrigin });
      } catch {
        /* best-effort release */
      }
      if (!preserveVesselSelection) {
        try {
          aisLiveVesselsLayer.clearSelection?.();
        } catch {
          /* best-effort release */
        }
      }
    }
    try {
      satellitesLayer.stopTracking?.({ origin: trackingOrigin });
    } catch {
      /* best-effort release */
    }
    try {
      rocketLaunchesLayer.releaseCameraOwnership?.();
    } catch {
      /* best-effort release */
    }
    this.viewer.trackedEntity = undefined;
    this.interruptCameraMotion('explicit-navigation');
    this.stopOrbit();
    if (!preserveCameraFlight) this.viewer.camera.cancelFlight();
    try {
      this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    } catch {
      /* teardown race */
    }
    return contactSelected;
  }

  _runExplicitNavigation(noun, navigate, releaseOptions = undefined) {
    return runExplicitNavigation({
      disposed: this._disposed,
      cockpitActive: this.isCockpitActive(),
      noun,
      showToast: (text) => this.showToast(text),
      stamp: () => this._stampNavigation(),
      release: () => this._releaseFollowCamera(releaseOptions),
      navigate,
    });
  }

  /** Change the viewing angle without clearing selection or follow ownership. */
  runOrientation(noun, navigate) {
    return runExplicitNavigation({
      disposed: this._disposed,
      cockpitActive: this.isCockpitActive(),
      noun,
      showToast: (text) => this.showToast(text),
      stamp: () =>
        this._stampNavigation({
          cancelPendingSelection: false,
          clearSearchedLocation: false,
        }),
      release: () => {
        this.interruptCameraMotion('camera-orientation');
        this.stopOrbit();
        this.viewer.camera.cancelFlight();
      },
      navigate,
    });
  }

  _beginDeferredNavigation(
    noun = 'location',
    { cancelPendingSelection = true } = {},
  ) {
    return beginDeferredNavigation({
      disposed: this._disposed,
      cockpitActive: this.isCockpitActive(),
      noun,
      showToast: (text) => this.showToast(text),
      // The searched-location readout survives the STAMP; only a flight that
      // actually starts invalidates it (see the release hook below).
      stamp: () =>
        this._stampNavigation({
          cancelPendingSelection,
          clearSearchedLocation: false,
        }),
    });
  }

  _reassertNavigationHandoff(generation) {
    return reassertNavigationHandoff({
      generation,
      currentGeneration: this._navigationGeneration,
      cockpitActive: this.isCockpitActive(),
      disposed: this._disposed,
      showToast: (text) => this.showToast(text),
      // Reached only once the handoff is granted, immediately before the
      // deferred flight starts — so a lookup that failed, was superseded, or
      // was refused by the cockpit leaves the old readout standing.
      release: () => {
        this.clearLocation();
        return this._releaseFollowCamera();
      },
    });
  }
  /** Subscribe to ownership changes without claiming the camera or exposing mutable state. */
  subscribeCameraHandoff(listener) {
    return this._cameraHandoffs.subscribe(listener, { emitCurrent: false });
  }
  /** A scoped writer borrows this owner's generation; any newer intent revokes it. */
  claimScopedCamera({ isBusy = () => false } = {}) {
    if (
      this._disposed ||
      this.isCockpitActive() ||
      this.viewer.trackedEntity ||
      isBusy()
    )
      return null;
    const generation = this._navigationGeneration + 1;
    this._stampNavigation();
    // Publishing a stamp is reentrant. A listener can claim a newer generation
    // before _stampNavigation returns; never release or adopt that successor.
    if (
      this._disposed ||
      this._navigationGeneration !== generation ||
      this.viewer.trackedEntity ||
      this.isCockpitActive() ||
      isBusy()
    )
      return null;
    this._releaseFollowCamera();
    if (this._disposed || this._navigationGeneration !== generation)
      return null;
    const controller = new AbortController();
    let released = false;
    const isCurrent = () =>
      !released && !this._disposed && generation === this._navigationGeneration;
    const release = () => {
      if (released) return;
      released = true;
      unsubscribe();
      controller.abort();
    };
    const unsubscribe = this.subscribeCameraHandoff(() => {
      if (!isCurrent()) release();
    });
    if (!isCurrent()) {
      release();
      return null;
    }
    return Object.freeze({
      generation,
      signal: controller.signal,
      isCurrent,
      release,
    });
  }
  stop() {
    cancelCameraArrival(this.viewer);
    this._disposed = true;
    this._cameraHandoffs?.publish();
    this._cameraHandoffs?.destroy();
  }
  destroy() {
    this.stop();
    this._stampNavigation();
  }
}
