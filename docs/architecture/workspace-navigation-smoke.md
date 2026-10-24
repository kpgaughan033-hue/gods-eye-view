# Milestone 3: scoped navigation and exact return

Implements [issue #7](https://github.com/kpgaughan033-hue/gods-eye-view/issues/7)
under the [first vertical slice](first-vertical-slice.md). This is an opt-in
development-console prototype, not a new navigation UI or widget.

## Contract and boundaries

- Normal startup and production preview have no workspace entry. In development,
  `?workspacePrototype=1` exposes `window.__godsEyeView.workspacePrototype`.
  Import/acquisition remain lazy. Existing milestone 2 geometry-only methods
  (`acquire`, `activate`, `deactivate`, `dispose`, `getState`) remain available.
- Navigation methods are `enter()`, `enterChild()`, `goTo(nodeId)`, `back()` and
  `exit()`. Inspect `getNavigationState()` for committed `scopeId`, in-flight
  `targetId`, phase, generation, ancestor IDs, diagnostics and console error.
  The application/widget node cannot be entered in this milestone.
- `src/workspace/navigation.js` owns committed scope separately from in-flight
  work. History contains only the bounded ancestor path and is updated only on
  success. Back during an uncommitted child entry cancels it and returns to the
  committed source; repeated Back while ascending continues toward the globe.
- `NavigationController.claimScopedCamera()` grants a lease on its existing
  generation. New search, tracking, share restoration or director claims abort
  it synchronously. Reentrant publication cannot adopt a successor's generation.
  No competing camera loop or new global authority event is introduced.
- Entry refuses cockpit, tracked entities and director running/pending/authored
  camera work. Rocket replay has an independent loop without a public ownership
  reader: this prototype conservatively refuses while the rocket-launches render
  hold is active, even if that layer is only displaying missions. It never stops
  a replay to enter the workspace. This capability restriction needs review
  before expanding supported modes.
- Visible photorealistic/3D tiles or terrain at/above the synthetic building base
  are unsupported. Entry reports this instead of selecting maps, clipping tiles,
  fetching elevations or changing providers. An unloaded height is not proof of
  surveyed ground alignment. The fixture remains explicitly fictional.
- Presets use local meter coordinates converted by milestone 1 frames directly
  to double-precision ECEF. They do not use the geographic view/share codec or
  its altitude clamp. Exit restores captured ECEF position, direction and up,
  not a preset globe pose or rounded geographic representation.
- Scoped camera constraints disable ordinary input/collision adjustment and set
  a small near plane only while this lease is held. Pointer, touch, wheel or
  keyboard input (including existing UI actions) yields immediately, restores
  settings and releases geometry before that action proceeds. This slice uses
  fixed poses, not free interior walking. No global clearance constant changes.
- External handoff/manual takeover never restores an old camera pose. Explicit
  exit restores it only while still authoritative. Map/layer diagnostics are
  captured once and are never replayed over user edits. The first ECEF return
  pose is captured synchronously before lazy loading, so startup motion during
  that import cannot shift the promised return destination.
- Failed acquisition/flight rolls back to the committed pose only while still
  authoritative. Flight timeout is bounded; abort clears the owned flight,
  timer and unique render hold. The installed SDK re-enables inputs after its
  flight completion callback: guarded microtask settlement retains the scoped
  constraint until release, without overwriting a successor's settings.
  Teardown releases resources/settings and does
  not move the camera. Late code loads and resource arrivals cannot claim it.

The existing tools composition already supplied `signal`, `defer`, the viewer
and debug services. The development installer uses that seam. Controls retain
the startup flight's existing cancellation function so accepted workspace entry
can cancel its delayed timer; without entry the original startup is unchanged.
Director exposes a read-only `cameraBusy` getter covering LOAD and authored
motion as well as playback. Existing normal navigation routes are unchanged.

## Manual development smoke test

1. Run `npm run doctor`, then `npm run dev`. Verify normal startup has no
   workspace entry. Load the same development URL with `?workspacePrototype=1`.
   No navigation or geometry occurs until an explicit console action.
2. Allow startup to settle. Use a keyless 3D globe stack with no external 3D tiles.
   Ensure cockpit, tracking, director and rocket replay/mission layer are off.
   No credentials or paid provider calls are needed.
3. Capture the current free-camera state and primitive/settings counts:

   ```js
   const d = window.__godsEyeView;
   const w = d.workspacePrototype;
   const v = d.viewer;
   const original = {
     position: v.camera.positionWC.clone(),
     direction: v.camera.directionWC.clone(),
     up: v.camera.upWC.clone(),
   };
   const primitiveCount = v.scene.primitives.length;
   const controls = v.scene.screenSpaceCameraController;
   const settings = [controls.enableInputs, controls.enableCollisionDetection,
     v.camera.frustum.near];
   ```

4. Await each action: `await w.enter()` reaches the building, then three
   `await w.enterChild()` calls reach floor, office and desk. Each returns true;
   `w.getNavigationState().scopeId` ends at `demo-desk-001`. Inspect the synthetic
   wireframes, slab and desk. There is no application widget. Requests without
   awaiting use latest-intent semantics, not a queued cinematic sequence.
5. `await w.back()` returns to office. `await w.goTo('demo-building-001')` visits
   that ancestor. `await w.exit()` restores the captured globe camera. Check
   Euclidean position error <=0.01 m and angular error of direction/up <=0.1°,
   restored primitive count/settings, and absence of workspace-flight holds.
6. Repeat enter/back/exit quickly without awaiting, including during first lazy
   acquisition. Only the newest accepted intent may settle; history must never
   commit a canceled target. After failure, inspect the error and retry/exit.
7. While moving or stable, use existing globe search, tracking, director, or a
   shared-view navigation. Workspace must yield with no later camera snap-back.
   Physical pointer/wheel/keyboard takeover also exits logical workspace scope;
   it leaves the current camera to the user. After these handoffs, `exit()` must
   not restore a stale pre-entry pose. Map/layer edits must not be reverted.
8. Confirm refused entry leaves existing cockpit/tracking/director/replay alone.
   Test a photorealistic stack: entry must report unsupported and not switch it.
   Test reduced-motion OS/browser preference; transitions should be immediate.
9. Repeated cycles must not accumulate primitives, input listeners, timers,
   render holds or ancestor history. `w.dispose()` is final. Application destroy
   removes the entry and cleans up before the scene; reload afterward. In the
   console, import the exact loaded module URL (including any Vite timestamp):
   `const mainUrl = [...document.scripts].find(s => s.src && new URL(s.src).pathname === '/src/main.js').src;
   await (await import(mainUrl)).application.destroy();` A bare second entry URL
   after HMR can intentionally trip the application's singleton guard.
10. Build and run `npm run preview`. The same query flag must expose no workspace
    entry. Existing map, layer, share, provider and voice UI remain present.

## Reproducible automated browser route

Start a separate development server, then use the existing Puppeteer dependency:

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/qa-workspace-navigation.mjs \
  --url http://127.0.0.1:4175 --software \
  --screenshot /tmp/workspace-desk.png
```

Use your installed browser path, or Puppeteer's managed browser if installed.
`--software` explicitly selects SwiftShader; omitting it does not establish that
hardware acceleration was available. The script reports the actual renderer.
It blocks external browser requests, drives the real viewer through desk, Back,
ancestor and captured return, measures precision, checks settings/collection
cleanup, search/manual handoff and destruction, and fails on scene/page errors.
It does not test live providers or public location-search results.

Do not run against a developer's unrelated active browser task. If parallel
test/build tooling invalidates Vite's dependency cache (`Outdated Optimize Dep`),
restart the smoke-test server with an isolated temporary `cacheDir`, preserving
the repository Vite configuration. Do not change production configuration to
make a smoke test pass.

## Validation evidence and review gate

Fake/contract tests cover refusal, partial/delayed acquisition, rapid Back/Exit,
stale completion, reentrant claim, history commit, failure recovery, destruction,
camera-setting restoration and repeated resource release. Camera-adapter tests
also exercise real Cesium coordinate math in CPU simulation, reduced motion,
timeout and retained completion callbacks. These are not GPU evidence.

The browser fixture route was executed with Chromium 154, headless WebGL 2.0,
ANGLE/Vulkan SwiftShader, 1280 × 900 at DPR 1. The app used OSM fallback with
external browser requests blocked. It reached desk and returned with measured
position error 0 m and direction/up error 0° (below 1 cm/0.1°).
Geometry counts/settings restored; search and manual takeover and teardown
passed, with zero scene/page errors. The desk screenshot was inspected; the
existing UI remained and the close desk/floor geometry was visible. This is
software-WebGL evidence, not a hardware performance benchmark or visual signoff.

During development, tests exposed and fixed reentrant-generation adoption and
unmarked console diagnostics. Browser testing also exposed lazy-import return
pose drift and the SDK's post-callback input reset; both have focused regression
tests. The harness waits for a free-camera startup baseline instead of relying
on wall time alone. Early harness attempts hit a stale Vite optimizer cache,
an unstable-startup settings assertion, a timestamped-entry singleton guard and
a software-renderer screenshot timeout. The final stable-source harness passed,
including destruction during an active flight and owned-collection disposal.
Hardware-GPU performance, live
tracking/provider sessions, cross-device usability and GitHub Actions results
require separate verification/review.

Review camera authority, cancellation, precision, conservative unsupported-mode
gates and compatibility with global navigation before merging. Opening a PR or
passing local checks does not grant merge approval.

Final local checks for this implementation: the focused workspace/navigation,
handoff, ground-guard, playback and i18n command passed 225 tests; `npm test`
passed 8,639 tests with one skip and zero failures (including the serialized
allocation probes). `npm run build`, `npm run doctor -- --json`,
`npm run format:check`, `npm run check:boundaries`, targeted Prettier and Git
whitespace checks passed. The build retained its existing large-chunk warning.
Production JS contained no workspace-entry/fixture identifiers, and production
preview ignored the query flag. GitHub Actions was not verified locally and is
a required review gate on the eventual PR.
