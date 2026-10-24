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
  Milestone 3 excluded application targets; Milestone 4 below now admits only
  the existing validated checklist child.
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
   const settings = [
     controls.enableInputs,
     controls.enableCollisionDetection,
     v.camera.frustum.near,
   ];
   ```

4. Await each action: `await w.enter()` reaches the building, then three
   `await w.enterChild()` calls reach floor, office and desk. Each returns true;
   `w.getNavigationState().scopeId` ends at `demo-desk-001`. Inspect the synthetic
   cutaway exterior, floor, room and desk described below. At the desk, Milestone 4
   adds the monitor/checklist interaction described later in this guide. Requests without
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
  --evidence-dir /tmp/workspace-evidence
```

Use your installed browser path, or Puppeteer's managed browser if installed.
`--software` explicitly selects SwiftShader; omitting it does not establish that
hardware acceleration was available. The script reports the actual renderer.
It blocks external browser requests, drives the real viewer through desk, Back,
ancestor and captured return, measures precision, checks settings/collection
cleanup, 20 enter/exit cycles, search/manual handoff and destruction, and fails on scene/page errors. With `--evidence-dir`, it captures all four scopes at 1280 × 900 and 800 × 900 (DPR 1), checking scope IDs at each step. The narrower width approximates the canvas space left by docked DevTools; it does not automate Firefox DevTools.
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

## Issue #9: lightweight fictional cutaway

The same fixed Austin WGS84 anchor (-97.7431°, 30.2672°, **200 m
ellipsoidal height**) remains synthetic. These shapes do not correspond to a
real building, interior, terrain elevation or survey. Geometry is deliberately
an open-front architectural model, not an enclosed photorealistic room.

- **Building:** blue rear facade and foundation, pale corner columns, three roof
  rails and silhouette edges; amber entrance step and open door frame. There is
  no solid roof or south facade to block the interior camera.
- **Floor:** slate slab, pale perimeter, short partition and amber approach aisle.
  The building remains around it as context; this view looks down into the model.
- **Office:** warm room pad, two tall walls, low front boundary with a doorway
  and amber threshold. The south/east sides stay open for the oblique preset.
- **Desk:** wood-colored 6 cm desktop with contrasting edge, four dark legs,
  monitor with cyan passive screen, stand/base and pale keyboard. The monitor is
  was passive in issue #9; Milestone 4 below makes only its screen interactive.

`src/workspace/geometry.js` contains 34 box/outline parts in fixture-local
metres. `cesiumAdapter.js` converts those through the existing coordinate frames
and owns them in the same private collection. All parts are acquired once per
session, use opaque flat colors, synchronous tiny box geometry and disabled
picking in the issue #9 baseline (Milestone 4 enables only the screen). No
textures, external assets, extra render loop, render hold, shadows,
provider changes or clipping planes are added. The four camera presets alone
change framing; lease, transitions, cancellation, scoped settings and captured
return remain in the existing Milestone 3 owners.

### Compact Firefox walkthrough and screenshots

Keep DevTools docked before beginning. Use at least an 800 × 900 viewport when
comparing with automated evidence. Existing HUD/panels are preserved and may
cover some geometry at other sizes; do not click or scroll the scene to frame a
screenshot because physical input intentionally yields the workspace lease.
Use the browser/OS screenshot command rather than simulating input over canvas.

```js
const w = window.__godsEyeView.workspacePrototype;
await w.enter(); // building: exterior, roof rails, amber entrance
w.getNavigationState().scopeId; // demo-building-001; capture screenshot
await w.enterChild(); // floor: slab, perimeter, partition, aisle
w.getNavigationState().scopeId; // demo-floor-001; capture screenshot
await w.enterChild(); // office: warm walls, doorway, desk inside
w.getNavigationState().scopeId; // demo-office-001; capture screenshot
await w.enterChild(); // desk: entire top, legs, monitor, keyboard
w.getNavigationState().scopeId; // demo-desk-001; capture screenshot
await w.back(); // demo-office-001
await w.exit(); // demo-globe-001, original precise captured camera
```

Record browser/version, viewport, renderer, map stack and any panel occlusion
with screenshots. Test Firefox on the target older Mac separately: software
Chromium screenshots establish actual rendering in that environment, not
Firefox compatibility, hardware frame rates or target-machine visual signoff.

Actual issue #9 screenshots and executed checks are recorded in the
[evidence directory](evidence/issue-9/README.md). Historical Milestone 3
results above describe its original validation, not this visual pass.

## Milestone 4 / issue #11: enter the monitor checklist

[Issue #11](https://github.com/kpgaughan033-hue/gods-eye-view/issues/11)
extends the scoped hierarchy by one existing node, `demo-application-001`.
It explicitly supersedes the initial design's session-only persistence and
compact-sheet presentation: this opt-in widget uses bounded versioned local
storage and fills the viewport. Production and default development startup
still expose no workspace entry. Fixture IDs, bounds, anchor, globe share
formats, providers, clearance and global navigation are unchanged.

The light-blue **screen surface only** is pickable, with a stable workspace/desk/
part ID and an instance-owned primitive membership check. Desktop, legs,
keyboard, monitor frame and surrounding scene do not activate the checklist.
The screen gains a projected outline on hover or launcher focus. The keyboard
launcher and scoped Back/Exit controls are development-only.

`navigation.js` accepts the validated checklist application as a desk child and
waits for both the leased camera and disposable visual transition before
committing history. Back uses the captured source desk pose; further Back goes
office → floor → building → original globe. Explicit Exit retains the same
<=1 cm / <=0.1° globe-return contract. Manual/external handoff never restores a
stale camera. No additional camera controller or render loop is introduced.

`cameraAdapter.js` approaches the real screen front in the desk frame, leaving
the near plane safely in front of it. `screenProjection.js` projects the four
real front-face corners in CSS pixels using ECEF camera axes and the existing
frustum. A homography maps the DOM viewport onto that quadrilateral; native CSS
Web Animations expand it to the viewport while the existing camera flies. Back
projects the screen at the captured destination desk pose for the reverse
handoff. No field-of-view modification, texture-painted HTML or second renderer
is used. Reduced motion skips both animations. Unsupported animation APIs fall
back to the normal DOM surface; timers and completion callbacks are bounded and
cancelled with the navigation generation.

The final checklist is ordinary labeled HTML: add, checkbox, delete, empty
state, visible focus, and native scrolling. A scoped keyboard owner handles
Tab/Escape; IME composition is left intact. During animation, Back/Exit remain
available and Escape can cancel. Inputs inside the checklist/launcher preserve
the lease and stop bubbling globe shortcuts. The existing voice key policy has
a narrow guard for `data-workspace-input`, including Space on buttons. Input
outside the owned surface still yields normally. Repeated Back/Exit and new
search/tracking/share/director authority remove overlays and suppressions
without stale focus or camera completion.

Screen highlighting after resize waits for a disposable one-shot post-render
callback, because Cesium updates its aspect/frustum after window resize dispatch.
It uses the governor for one render request, not a continuous loop. The callback
is removed after drawing or when the desk presentation leaves. Browser checks
compare outline/projected corners with Cesium window coordinates at both widths.

Globe chrome is hidden with an **owned temporary attribute and CSS**, not by
replaying HUD/layer settings or replacing inline styles. Newly mounted chrome
is covered by a disposable observer. Removing only this owner's attributes
preserves unrelated visibility/layer edits. Keyboard/pick hooks are scope-owned;
exit removes the DOM root and active chrome suppression. The instance may reuse
its detached DOM and checklist store on re-entry; application destruction
removes listeners, observer, animations, timers, DOM and renderer ownership.

Tasks use `gev:workspace-checklist:v1:<workspaceId>:<stateKey>` in localStorage,
not geographic/share state. Limits are 100 tasks, 240 UTF-16 code units per task,
128 characters per task ID and a 262,144-code-unit serialized parse ceiling. Version, duplicate IDs,
record shapes and field types are validated atomically; corrupt data is ignored.
Edits save synchronously before any presentation unmount. Storage denial/quota
failures retain editable in-memory state and show a page-only notice. No backend,
authentication, agent, workflow, remote widget or provider call is added.

### Required manual Firefox / GitHub Codespaces gate

1. On the Codespace development port, load `?workspacePrototype=1&welcome=0`
   (the existing `welcome=0` support flag avoids a delayed first-run launcher
   covering the monitor). Alternatively dismiss the welcome launcher after
   startup has fully settled. Confirm the
   ordinary URL has no entry. Use the existing keyless globe stack, wait for
   startup, and leave tracking/cockpit/director/rocket replay off.
2. Open DevTools **before** navigation. Record Firefox version, Mac/OS, viewport,
   renderer and map stack. Keep roughly 800 × 900 of page space for the narrow
   case; repeat with a wider viewport. Capture the original ECEF pose/settings
   as in the Milestone 3 procedure above.
3. Run `const w = window.__godsEyeView.workspacePrototype; await w.enter();`
   followed by three awaited `w.enterChild()` calls. Confirm `demo-desk-001`.
   Hover the cyan screen: the outline/cursor should indicate interactivity.
   Capture the desk. Avoid wheel/scene gestures while inspecting; those yield
   ownership by design.
4. Click/tap **inside the light-blue screen**, not its frame. Watch the camera
   approach and the projected screen expand into the page. Capture/record the
   transition if practical. The endpoint must be readable normal HTML with no
   globe HUD covering it and scope `demo-application-001`. Check clipping,
   skew/interpolation and focus specifically in Firefox.
5. Add text containing spaces and ordinary globe shortcut letters (`h o v f d c`),
   press Enter, toggle a task with mouse and Space, delete a task, and verify the
   empty state. Tab/Shift+Tab should stay in visible controls. Screen-reader
   labels, focus rings, IME composition and Escape must behave sensibly.
   Holding Space on a checklist button must not start voice.
6. Use **Back to desk** or Escape. Verify exact prior desk framing and focus on
   **Open checklist**. Press Enter/Space there to reopen and verify task state.
   Back again, then Back through office/floor/building/globe. Explicit Exit from
   the app must also restore the captured globe pose/settings within tolerance.
7. Reload, return to desk and reopen: saved tasks should remain. Deny site storage
   (or test in a restricted context) and confirm editable page-only fallback with
   a visible notice. Do not use real sensitive tasks for this prototype.
8. Test rapid entry/Back/Exit during animation, reduced motion in OS/Firefox,
   resize/DevTools docking, and deliberate outside wheel/keyboard/pointer input.
   New existing search/tracking/share/director intents must cancel without later
   snap-back. Confirm HUD/settings return without overwriting unrelated changes.
9. From separate fresh desk visits, click the desktop, monitor frame and nearby
   scene. None may enter the application; ordinary outside input may yield the
   entire workspace. Re-enter using the existing console route when needed.
10. Repeat 20 open/Back cycles and several full Exit/re-entry cycles. Confirm no
    root/attribute/primitive/hold growth or console errors. Destroy during entry
    using the exact loaded `/src/main.js` URL procedure above; no checklist,
    chrome suppression or owned geometry should survive. Production preview
    with the same query flag must still have no workspace entry.

Do not merge or request final approval until CI, code review and this manual
Firefox/Codespaces gate have completed. Software Chromium screenshots and CPU
contract tests do not grant Firefox visual/accessibility signoff.

### Automated checklist route and evidence

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/qa-workspace-checklist.mjs \
  --url http://127.0.0.1:4175 --software \
  --evidence-dir /tmp/workspace-checklist
```

The behavioral route uses the normal browser clock and actual monitor clicks,
keyboard controls, task editing, persistence/reload, exact return, cancellation,
misses, 20 reduced-motion app cycles and destruction. External browser requests
and `/api/` requests are blocked to keep provider traffic out of this fixture.
`--behavior-only` runs just that normal-clock gate. The existing `welcome=0`
support flag suppresses onboarding only in the QA URL; it changes no default
startup policy. Optional paused transition captures run on **separate visual-only pages** using
the same native animation at 350 ms; they are screenshots of real browser output,
not timing/performance evidence. `--visual-only` repeats only these captures.
The existing `qa-workspace-navigation.mjs` remains a separate required gate.

Executed results, actual screenshots and known limitations are linked in
[evidence/issue-11](evidence/issue-11/README.md).
