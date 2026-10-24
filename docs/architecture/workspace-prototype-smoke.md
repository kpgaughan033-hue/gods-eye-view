# Milestone 2: hidden geometry prototype

For the scoped navigation/return extension, see
[Milestone 3 smoke test](workspace-navigation-smoke.md). The geometry-only
console methods documented here remain available.

This development-only prototype draws the validated milestone 1 fictional fixture
using the existing viewer. It does not navigate, change clearance, select maps,
toggle layers, add widgets, persist state, or start agents. The fixed Austin-area
anchor is synthetic: longitude -97.7431°, latitude 30.2672°, **200 m ellipsoidal**
height. It describes no real building or surveyed terrain.

## Manual browser procedure

1. Run `npm run doctor`, then `npm run dev`. Open the app in a WebGL-capable
   browser. Without a query flag, verify normal startup and that
   `window.__godsEyeView.workspacePrototype` is undefined. No workspace geometry
   or entry is installed. Existing debug handles remain unchanged.
2. Reload with `?workspacePrototype=1` appended to the development URL. The
   existing debug object now has `workspacePrototype`. Its `getState()` is
   `idle`; no geometry is acquired and no workspace renderer chunk is requested
   until `acquire()` or `activate()` is explicitly called.
3. Wait for the normal startup fly-in to settle. Using existing location controls,
   search `30.2672,-97.7431` and manually
   adjust zoom/pitch to inspect the anchor. This is ordinary user navigation,
   not a prototype camera controller. The prototype never moves the camera.
   Use an existing keyless map if desired, selected manually. Do not treat
   obstruction by photorealistic geometry or synthetic-height placement as
   evidence of terrain registration or indoor collision support.
4. In browser developer tools, run:

   ```js
   const workspace = window.__godsEyeView.workspacePrototype;
   const viewer = window.__godsEyeView.viewer;
   const before = viewer.scene.primitives.length;
   const holds = window.__godsEyeView.getRenderGovernorDiagnostics().holds;
   await workspace.acquire(); // hidden private collection, state "acquired"
   await workspace.activate(); // state "active", same existing viewer
   ```

   Inspect a cyan building wireframe, gray floor slab, amber office wireframe,
   and green desk. There is no opaque roof or application/widget geometry.
   Appearance and desk-scale GPU precision need real browser verification.
5. Run `workspace.deactivate()`. State returns to `idle`, the private collection
   and its four primitives are destroyed, and `viewer.scene.primitives.length`
   returns to `before` (assuming no unrelated layer changed). Activate and
   deactivate 20 times; counts should not grow. Existing viewer, maps, layers,
   scene director, voice and controls must continue to work.
6. Compare render-governor holds before/after under otherwise unchanged layer
   activity. This static prototype takes **no continuous hold**; it requests
   one-shot renders for showing/removing geometry and must not release other
   owners' holds. Test while another layer is animating as well as at rest.
7. Try `workspace.activate(); workspace.deactivate()` without awaiting, and
   `workspace.activate(); workspace.dispose()`. Late acquisition must not show
   geometry. Disposal is final for that handle; reload to create another one.
8. To test application teardown, use the development console:
   `const { application } = await import('/src/main.js'); await application.destroy();`
   The entry must disappear from the captured debug object, and its resources
   must release before the application's scene teardown. Do not use this on
   unrelated running work; reload afterward.
9. Build with `npm run build`, start `npm run preview`, and repeat with the query
   flag. Production/preview must have no workspace entry or prototype chunk.

## Automated checks and limits

Run `node --test src/workspace/*.test.mjs src/app/application.test.mjs
src/renderGovernor.test.mjs` as one shell command. Tests use fakes for partial
failures, async cancellation, late results, repeated activation and reverse
cleanup; a CPU-only test constructs/disposes real Cesium geometry objects.
Also run doctor, production build, formatting and package-boundary checks.

CPU/fake tests do not validate WebGL rendering, visual quality, near-plane
precision, frame times or live-provider behavior. Record browser, GPU, viewport,
map stack and observed results when executing this manual procedure; no such
measurements are implied by the procedure itself. Navigation authority,
interior camera policies and interactive widgets remain future milestones.

## PR #5 final validation observations

Validated the existing prototype with installed Chromium 154 (headless), WebGL
2.0, ANGLE/Vulkan SwiftShader software rendering, at 1280 × 900 and DPR 1.
External browser requests were blocked: the app automatically fell back from
Esri to OSM without loaded imagery. No claim of live-map correctness follows.
The test harness positioned the existing camera using milestone 1 coordinate
frames after the normal startup flight settled; the prototype itself never
changed the camera. This is an automated equivalent of the developer-console
steps above, not a test of the location-search UI or future workspace navigation.

Observed:

- Default development startup had no workspace entry; opted-in startup was idle.
- Hidden acquisition created one private collection with four primitives.
  Activation made all four primitives ready, with zero scene render errors.
- The captured image was inspected: cyan building and amber office wireframes,
  gray floor slab and green desk were visible in the existing application UI.
  The image's untextured/bright background is not a validated basemap.
- Viewer identity and camera position were unchanged by activation. Twenty
  activation/deactivation cycles restored collection counts and preserved an
  unrelated render-governor hold. Cancellation, final disposal and application
  teardown passed. Production preview ignored the development query flag.

Source review of the installed Cesium SDK confirmed that `flat: true` selects
`PerInstanceColorAppearance.FLAT_VERTEX_FORMAT` (position only), compatible with
`BoxOutlineGeometry`'s position-only line geometry. Normals on solid boxes are
allowed but unnecessary for flat shading; this is not a rendering defect.
Real-geometry tests check appearance attributes and primitive types, and compare
every box vertex transformed through the actual instance model matrix against
milestone 1 coordinate frames with rotated building and office ancestors.
Real `PrimitiveCollection` tests verify reverse-order, exactly-once primitive
destruction and sibling preservation with parent `destroyPrimitives` both true
and false. No source-confirmed production rendering defect was found, so this
validation follow-up changes tests and documentation only.

Executed: `node --test src/workspace/*.test.mjs src/app/application.test.mjs
src/renderGovernor.test.mjs` (115 passed, zero failed/skipped), `npm run doctor
-- --json`, `npm run build` (existing large-chunk warning), formatting and
boundary checks, and development/production browser smoke harnesses. The
harnesses and screenshot were temporary validation artifacts outside the
repository. Hardware-GPU performance, cross-device visual quality, live-provider
behavior and the full unit suite were not tested in this pass.
