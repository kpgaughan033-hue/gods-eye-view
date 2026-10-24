# Issue #9: actual browser evidence

These are unedited screenshots from the real development application and its
existing Cesium viewer, not illustrations. Captured 2026-10-24 with Chromium
154.0.8037.57, headless software WebGL / ANGLE Vulkan SwiftShader on Linux, DPR 1.
External browser requests were blocked; OSM fallback has blank/unloaded imagery.
The white globe background in overview captures is not a new workspace plane.
Existing HUD and panels remain present. No credentials or live paid services
were used. The fictional Austin anchor remains -97.7431°, 30.2672°, 200 m above
the WGS84 ellipsoid; these shapes describe no real building/interior.

| Committed scope ID  | 1280 × 900                    | 800 × 900                            |
| ------------------- | ----------------------------- | ------------------------------------ |
| `demo-building-001` | [Building](building-1280.png) | [Building, narrow](building-800.png) |
| `demo-floor-001`    | [Floor](floor-1280.png)       | [Floor, narrow](floor-800.png)       |
| `demo-office-001`   | [Office](office-1280.png)     | [Office, narrow](office-800.png)     |
| `demo-desk-001`     | [Desk](desk-1280.png)         | [Desk, narrow](desk-800.png)         |

Observed appearance: open-front blue building with roof rails and amber door
frame; slate floor with perimeter and approach aisle; warm office walls,
threshold and doorway; wood desktop, dark legs, cyan monitor and pale keyboard.
The four views are distinguishable. At narrow width, the unchanged right-side
panels overlap some of the office overview; the central desk stays readable.
The desk's passive monitor extends above the existing semantic desktop bounds;
it adds no spatial node, interactive application or widget behavior.

The 800-pixel canvas approximates space left by docked DevTools. Firefox on the
user's older Mac was **not available**. These captures are software-WebGL visual
evidence, not Firefox signoff, hardware performance measurements or live-map
validation. OS display scaling, smaller viewports, expanded panels and other HUD
styles require user review. No global UI layout changes are proposed here.

Reproduce with the [smoke guide](../../workspace-navigation-smoke.md), or run:

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/qa-workspace-navigation.mjs \
  --url http://127.0.0.1:4175 --software \
  --evidence-dir /tmp/workspace-evidence
```

The dev server must use the repository's normal Vite configuration/plugins.
An isolated temporary cache is optional. A first local attempt accidentally
spread the exported Vite config function instead of invoking it; it lacked the
HTML/plugins and was stopped. The corrected wrapper invokes the original config
and changes only its cache directory. No repository configuration was changed.

CI, human visual review and explicit approval are required before merge.

## Executed validation

The [browser result](browser-results.json) records four checked scope IDs, both
viewport sizes, 20 enter/exit cycles, **0 m / 0°** captured-return error,
restored private collection counts and camera settings, search/manual takeover,
application destruction during flight, and zero scene/page errors. Default
development startup exposed no workspace entry. A separate production-preview
browser run with `?workspacePrototype=1` also exposed no entry while the existing
viewer/UI initialized. Production JS contained none of `workspacePrototype`,
`demo-building-001` or `roof-front`.

Commands run (Node 24.19.0; no dependency changes):

```bash
node --test src/workspace/*.test.mjs src/ui/scopedCamera.test.mjs \
  src/ui/stateOwners.test.mjs src/navigationPolicy*.test.mjs \
  src/cameraGroundGuard.test.mjs src/cameraHandoff.test.mjs \
  src/director/playback.test.mjs src/i18n/catalog.test.mjs
npm test
npm run build
npm run doctor -- --json
npm run format:check
npm run check:boundaries
```

- Focused command: **238 passed**, zero failures/skips. New coverage checks
  bounded part counts, positive dimensions, open roof/doorway, desk components,
  partial construction failure at parts 0/2/23/33, actual Cesium model matrices,
  reverse release, and CPU projection of each subject including the monitor at
  both viewport aspects. Existing cancellation and exact-return regressions pass.
- Build passed; existing large-chunk warning remains. Doctor reports ready;
  formatting checked 1,484 source files; import/package boundaries passed.
  Targeted Prettier and Git whitespace checks passed.
- The first `npm test` attempt: 8,636 passed, one skipped, one failure in the
  unchanged `src/tools/tool-schema-codepoints.test.mjs` 200 ms timing assertion.
  It ran concurrently with software WebGL and build/check work. Isolated retries
  initially failed too (including once just after browser closure); a later
  unchanged retry passed at about 61 ms. The same test/schema copied from
  `origin/main` passed at about 73 ms. Timing/load sensitivity is a hypothesis;
  this visual pass changes neither file nor threshold.
- Full `npm test` retry, with browser/build work stopped: **8,652 passed, one
  skipped, zero failures**, including all serialized allocation probes. Ordinary
  tests: 8,637 passed/one skipped; allocation probes: 1 + 14 passed. The skip
  is the Windows-only native DACL test on Linux. The tool-schema timing test
  passed unchanged at about 96 ms in this full retry.
- The runner stopped before allocation probes on that failure. These were then
  invoked separately with `node --expose-gc --test --test-concurrency=1` for
  `src/data/focusAllocations.test.mjs` and
  `src/overlays/worldOverlayAllocation.test.mjs`: **1 and 14 passed**, respectively.

Not tested: target Firefox/older-Mac hardware, hardware GPU frame times,
live imagery/provider correctness, paid services, other devices/styles and
GitHub Actions status. The browser screenshot route uses software WebGL;
CPU projection tests alone would not establish visual rendering.
