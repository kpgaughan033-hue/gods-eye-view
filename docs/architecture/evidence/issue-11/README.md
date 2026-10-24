# Milestone 4 / issue #11 evidence

These are unedited screenshots of the real existing Cesium viewer and native
HTML checklist in the development-only prototype, captured 2026-10-24. No stock
render, textured HTML, external model, image editing or second renderer is used.
The fixture remains fictional Austin (-97.7431°, 30.2672°, **200 m WGS84
ellipsoidal height**); it describes no actual building/interior.

Environment: Node 24.19.0; Chromium 154.0.8037.57 on Linux, headless software
WebGL with the reported renderer **ANGLE / Vulkan 1.3.0 / SwiftShader Device
(Subzero)**, DPR 1. External browser traffic and local `/api/` requests were
blocked in the final offline routes, so no widget/provider dependency is needed.
OSM fallback has unloaded imagery. Firefox is not installed here. Hardware GPU
performance, live providers and the owner's older-Mac Firefox/Codespaces
interaction/accessibility signoff remain unverified.

| View                                  | 1280 × 900                               | 800 × 900                                      |
| ------------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Desk, focused screen launcher         | [Desk](desk-1280.png)                    | [Narrow desk](desk-800.png)                    |
| Native transition, paused at 350 ms   | [Transition](transition-paused-1280.png) | [Narrow transition](transition-paused-800.png) |
| Full-viewport checklist after editing | [Checklist](checklist-1280.png)          | [Narrow checklist](checklist-800.png)          |

The transition pictures use **separate visual-only pages** with the real native
animation and browser clock paused at 350 ms. They use the same scoped launcher
path and actual projected 3D screen corners; they are not synthetic images or
claims about frame rate, timing or animation smoothness. Normal behavioral
checks use the normal browser clock and real pointer clicks on the 3D screen.
The final checklist is readable DOM, the globe HUD is suppressed, and Back/Exit
remain available. See [transition capture results](transition-capture-results.json).

## Scope and source review

- `src/workspace/geometry.js` exports the existing screen dimensions. Only this
  part has a stable pick ID in `cesiumAdapter.js`; picking also requires the
  private acquired screen primitive. All other geometry remains non-pickable.
- `cameraAdapter.js` adds one screen-facing application pose in the parent desk
  frame. `screenProjection.js` projects the real front face using existing
  ECEF frames/camera/frustum and maps it to a DOM quadrilateral. There are no
  field-of-view changes or unleased camera writes.
- `navigation.js` admits only the validated checklist application child and
  waits for visual settlement as well as the existing camera flight. It checks
  cancellation after publication/await boundaries. Existing source-pose history,
  generation/lease, Back/Exit, exact globe capture and rollback remain in use.
- `developmentEntry.js` and `prototype.js` share instance-owned screen membership,
  wire the UI through the existing lifetime, and exclude owned widget input from
  the existing manual takeover listeners. Default opt-in/startup gating is intact.
- `ui.js`, `uiStyles.js`, `widget.js` own scoped DOM, focus, keyboard, animation,
  pick listeners, one-shot resize/render callbacks, temporary HUD attributes
  and restoration. They use existing
  `UiLifetime` / `createSurfaceKeyboard`. HUD state/styles are never replayed.
- `checklistStore.js` owns bounded versioned local data independently of view
  lifetime. Storage failures retain an editable in-memory fallback. Task strings
  use `textContent`. `realtimeInputPolicy.js` has a narrow marker guard so Space
  on this surface's buttons cannot start voice. Three existing locale catalogs
  receive the new labels; unrelated voice/UI/provider behavior is unchanged.

## Checks executed

```bash
node --test src/workspace/*.test.mjs src/ui/scopedCamera.test.mjs \
  src/ui/stateOwners.test.mjs src/navigationPolicy*.test.mjs \
  src/cameraGroundGuard.test.mjs src/cameraHandoff.test.mjs \
  src/director/playback.test.mjs src/ui/surfaceKeyboard.test.mjs \
  src/voice/gevRealtime.test.mjs src/i18n/catalog.test.mjs
npm test
npm run build
npm run doctor -- --json
npm run format:check
npm run check:boundaries
```

- Focused command: **441 passed**, zero failures/skips. New contracts cover
  app history, cancellation/late visual arrivals, reentrant takeover before
  presentation, exact prior desk return and semantic parent ascent; unique
  pick ownership and real Cesium primitive/matrix compatibility; projected quad
  homography and screen-facing pose at multiple nonpolar anchors; malformed,
  oversized and quota/denied storage, version/ID/text/task limits; literal task
  rendering, native editing, focus/Tab/Escape/composition/Space ownership;
  HUD updates/restoration, delayed animation acquisition, destruction and 20 UI
  cycles with bounded DOM/listeners. Existing precise-return and lifecycle
  regressions remain included.
- Full `npm test`: **8,689 passed, one skipped, zero failures**. Ordinary suite:
  8,674 passed / one skipped; serialized allocation probes: 1 + 14 passed. The
  skip is the Windows-only native DACL test on Linux.
- Build passed, retaining the existing large-chunk warning. Doctor reports
  `ready: true`. Formatting passed for 1,490 source files. Import/package
  boundary checks passed (1,031 modules, 79 portable entries). Targeted Prettier
  and Git whitespace checks also passed.
- Production JS contains no workspace entry/fixture/surface implementation
  identifiers. A separate production-preview browser check initialized the
  existing viewer with `?workspacePrototype=1&welcome=0`, exposed neither a
  workspace handle nor DOM, and reported the flag ignored. Translated message
  strings and the small scoped voice-input guard may remain in shared code.

Browser commands (using a dev server with the repository Vite plugins and a
separate temporary optimizer cache, not a changed application configuration):

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/qa-workspace-checklist.mjs \
  --url http://127.0.0.1:4175 --software --behavior-only \
  --evidence-dir /tmp/issue11-aligned-proof
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/qa-workspace-checklist.mjs \
  --url http://127.0.0.1:4175 --software --visual-only \
  --evidence-dir /tmp/issue11-aligned-mid
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/qa-workspace-navigation.mjs \
  --url http://127.0.0.1:4175 --software
```

Early smoke attempts were not passes: one was interrupted by source HMR, one
paused the behavioral page's clock and then timed out, and an offline attempt
hit the delayed first-run welcome dialog instead of the monitor. The corrected
fixtures use the app's **existing `welcome=0` support flag**, block provider API
traffic, and isolate paused visual captures from normal-clock behavioral pages.
Normal welcome/startup policy and application configuration were not changed.
Final screenshot review caught a stale highlight after resize: it read the old
frustum before Cesium resized. A disposable one-shot post-render refresh fixed
this, with a targeted regression and the browser SDK-coordinate comparison.
The camera/projection math, field of view and global navigation were unchanged
by that fix; the final checks were rerun afterward.

## Observed browser results

The [normal-clock checklist result](browser-results.json) passed actual screen
clicks at both widths, add/toggle/delete/empty state, native keyboard/Space,
Back and launcher focus, reopen and reload persistence, desktop/frame/scene
misses, rapid entry/Back/Exit, search authority takeover, outside input and
application destruction. Twenty reduced-motion application open/Back cycles
kept DOM, suppression and primitive counts bounded. Explicit globe exit measured
**0 m ECEF position error and 0° direction/up error**, with original camera
settings and collection counts restored. Scene-error arrays before/after reload
and page-error arrays were empty. No provider API request was allowed through. At both widths, displayed screen
outline corners and the fresh projection agreed with Cesium’s own window-
coordinate API within the 0.1 px gate (maximum measured coordinate difference
less than 0.000001 px). This checks coordinate agreement, not GPU pixel accuracy.

The [existing navigation smoke gate](navigation-browser-results.json) also
passed, including 20 full enter/exit cycles, Back/ancestor navigation, exact
0 m/0° globe return, settings/collection/hold restoration, search/manual
handoff and active-flight teardown, with zero scene/page errors. The
[production check](production-browser-results.json) reports no handle or DOM.
The paused capture command saved both real in-between views and no page errors.

Local storage is per browser/origin; there is no cross-tab merge, remote backup
or shared persistence. The fixed fixture has one checklist; this does not add an
arbitrary widget framework. Animation smoothness, native Firefox matrix
interpolation, touch behavior and assistive-technology usability still need the
owner's manual review on target hardware.

## Remaining review gates

Do not merge or request final approval until CI and code review pass and the
owner completes the [Firefox/Codespaces manual procedure](../../workspace-navigation-smoke.md#required-manual-firefox--github-codespaces-gate).
Check actual Firefox matrix interpolation, focus/screen-reader behavior,
keyboard/touch picking, reduced motion and DevTools resizing. A paused software
screenshot establishes rendered geometry/DOM, not smoothness or target hardware
performance. No paid API, backend/agent, hardware-GPU, target Firefox or GitHub
Actions signoff is claimed.
