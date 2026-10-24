# Initial architecture audit

## Scope and evidence

This audit evaluates God's Eye View as a foundation for a hierarchical 3D AI workspace:

**Globe → building → floor → office → desk → interactive application.**

The intended extensions include persistent AI agents, workflows, and customizable UI widgets. The repository is a strong geographic visualization foundation, with reusable lifecycle, navigation, tool-calling, and scene-playback modules. Its main architectural gap is scope: much of the application assumes one globe, one page-wide UI, and one active camera authority. The proposed hierarchy needs explicit spatial scopes, local coordinate systems, and independent resource lifetimes.

Audited commit: `8d454bf7f189bbd1264569a6b024f907a89c6017`.

The original audit was read-only. No application source or configuration was changed. This document records that audit; its publication is a separate documentation-only change. Findings below are confirmed through source inspection unless explicitly labeled as hypotheses or proposals. No browser/GPU profiling or live OpenAI validation was performed.

## 1. Cesium rendering, scenes, camera navigation, and zoom

### Confirmed findings and reusable components

- `src/app/application.js` provides ordered startup—scene, controls, data, tools—and reverse dependency-aware teardown. Constructors receive an `AbortSignal` and register cleanup through `defer()`. This is a useful foundation for workspace-scope lifetimes.
- `src/app/viewer.js` centralizes Cesium viewer creation, disables standard Cesium chrome, targets 60 FPS, and installs bounded trackpad-pinch amplification. Viewer options include four-sample MSAA and `preserveDrawingBuffer: true`.
- `src/app/scene.js` owns initial viewer, tileset, and map-stack construction and registers cleanup. It also bridges map-stack changes through a window event.
- `src/maps/controller.js` owns imagery, terrain, and tileset switching. Switch generations prevent obsolete asynchronous activations from becoming authoritative. Provider promises are cached, failed entries are evicted, and destruction disposes owned resources.
- `src/renderGovernor.js` switches between continuous and request-driven rendering using owner-keyed holds. It has no per-frame scheduling work of its own, but its viewer and hold registry are module-level singletons.
- `src/ui/navigationController.js` handles navigation generations and tracking handoffs. It directly knows about flights, military aircraft, and satellites, making its policy partly domain-specific.
- `src/cameraVerbs.js` contains substantial camera-motion logic, including route flights, orbiting, and terrain-aware movement. It also keeps module-level active-camera state.
- `src/director/playback.js` is an adapter-driven sequence of visual changes, layer changes, travel, settling, and holding. Cancellation checks and scene release make it particularly reusable.
- `src/director/camera.js` separates authored poses and interpolation from live camera state, supporting geographic anchors and shortest-angle interpolation.

### Architectural obstacles

1. `src/view/index.js` clamps public view altitude to a **50 m minimum**, rounds latitude/longitude to **four decimal places**, and restricts pitch to downward or horizontal views. That public format cannot accurately represent a desk-level camera.
2. `src/cameraGroundGuard.js` defaults to **120 m surface clearance**. Indoor transitions need a different clearance policy.
3. Director anchors are geographic positions with ellipsoidal heights, not parent-relative building/floor/room transforms.
4. `src/standalone/application.js` explicitly permits only one standalone application construction per page. Rendering, camera, and overlay singletons further constrain independent view lifetimes.

### Proposed extension points

Introduce spatial nodes with stable IDs, parent IDs, local transforms, and bounds. Keep geographic placement at the building/root boundary and use local coordinates below it. Navigation destinations should carry both `scopeId` and pose, with explicit exterior/interior collision and clearance policies.

Reuse navigation generations and the playback adapter rather than introducing competing camera writers. Preserve existing globe links through a versioned view-schema extension.

**Hypothesis:** Cesium can remain the renderer for the first indoor prototype. A separate interior renderer may eventually be useful, but the current evidence does not establish that replacement is necessary. Test precision, interaction, and resource isolation first.

## 2. Data lifecycle, scheduling, caching, and cleanup

### Confirmed findings and reusable components

- `src/data/lifecycle.js` serializes per-layer transitions, tracks visibility-intent generations, rejects stale work, normalizes status, and coordinates destruction. It is more than a toggle registry.
- Periodic refreshes use per-layer intervals. A refresh-in-progress guard prevents overlapping manager-driven updates for the same layer.
- The manager has no shared scheduling budget for prioritizing work across layers. It cannot guarantee cancellation of underlying network or rendering work when a layer does not observe cancellation.
- `src/app/constructCatalog.js` constructs a fixed application layer catalog. Registration is subsequently sealed against serialization metadata. This protects consistency but is not a general production plugin-registration mechanism.
- `src/app/sourceComposition.js` and `src/sources/sourceSlot.js` provide source composition and dependency injection seams.
- `src/services/terrainHeights.js` provides a bounded, 20,000-entry terrain cache with recency management and rounded coordinate keys.
- `src/services/groundFloor.js` reads terrain synchronously on render paths and uses coarse geographic cells. It models an outdoor terrain floor, not building floor identity or interior collision geometry.
- `src/data/localGeojsonCore.js` retains parsed features across disable/enable while releasing scene resources. Destruction clears cached features and listeners.
- `server/providers/aircraft/opensky.js` implements adaptive TTLs, request coalescing, and fallback caching. Cache policy is provider-specific rather than governed by one application-wide policy.
- `src/director/packs/session.js` models bounded asset acquisition, cancellation, disposable presentations, and cleanup of late-arriving resources.

### Architectural obstacles

A data layer currently combines visibility and lifecycle concerns around a viewer. Persistent agents, background workflows, and room-specific subscriptions need different lifetimes. Hiding an office should stop its rendering without necessarily terminating its agent.

The lifecycle manager is approximately 2,350 lines and contains substantial transaction and restoration policy. New workspace concerns should not simply accumulate in that class.

### Proposed extension points

Separate application, workspace, spatial-scope, and visible-presentation ownership. Reuse existing cancellation and disposal patterns, and gradually add a scheduler with priorities, concurrency limits, and visibility-aware suspension. Retain source adapters while making subscription ownership explicit.

Audit cache ownership and eviction per resource class. Share immutable assets where appropriate, but keep scope-local subscriptions and mutable presentation state independent.

## 3. UI components, panels, layout, styling, and themes

### Confirmed findings and reusable components

- The UI uses imperative DOM controllers. `src/ui/applicationShell.js`, approximately 1,800 lines, remains the central orchestrator for many controls and modes.
- The shell already delegates to navigation, visual settings, panel chrome, cockpit coordination, layer bindings, mobile shell, and share restoration owners.
- `src/ui/composition.js` injects application engines and layer instances into the shell. This is a useful composition seam, although its service surface is broad.
- `src/ui/uiLifetime.js` owns event listeners, animation frames, and timers and is reusable for widget teardown.
- `src/ui/panelLayoutController.js` schedules adaptive layout and uses observers. Its obstacle inventory and panel references depend on concrete DOM IDs and known panels.
- `src/ui/styles/` contains shared button, field, slider, segmented-control, status-badge, and panel styles.
- `src/ui/styles/foundation.css` exposes CSS variables for colors, typography, surfaces, and geometry.
- `src/ui/visualEffects.js` separates renderer effects from DOM controls and accepts injected timing/render callbacks. `src/ui/visualPresets.js` owns shader presets separately.

### Architectural obstacles

Panel layout is organized around the globe's existing fixed surfaces. Global DOM IDs, body classes, and page-wide events complicate independently mounted offices or widgets. CSS variables provide a customization starting point but are not a persisted, validated widget/theme system.

### Proposed extension points

Introduce widget descriptors with identity, placement, scope, state, and disposal contracts. Generalize panel measurement from hard-coded selectors to registered surfaces. Continue extracting shell responsibilities incrementally rather than undertaking a wholesale UI rewrite.

Keep **UI themes** separate from **scene post-processing styles**, so customizing office chrome does not implicitly change globe rendering. Define validated, versioned layout/theme state before allowing arbitrary widget configurations.

## 4. OpenAI, realtime voice, tools, and backend services

### Confirmed findings and reusable components

- `src/voice/realtimeBackend.js` separates token acquisition and SDP negotiation from microphone/UI ownership, with injected transports, timeouts, and cancellation.
- `server/providers/openai.js` installs Vite server/preview middleware for ephemeral credentials, OAuth flows, HUD summaries, and diagnostics. Cost-bearing endpoints use same-site gating.
- `server/providers/openai/realtime.js` constructs realtime sessions and tools with a bounded upstream request timeout. `server/providers/openai/rate-limit.js` provides request limiting.
- `src/voice/session.js` is protocol-independent. It tracks action lifetimes, emits normalized events, and suppresses stale results.
- `src/voice/realtimeTurns.js` handles substantial OpenAI-specific turn orchestration, tool outputs, narration, and response coordination.
- `src/voice/gevRealtime.js` routes application actions to the action runner and other tools through the catalog.
- `src/tools/catalog.js` provides validated definitions, service requirements, and call interceptors. `src/tools/surfaces.js` supports reuse across voice and MCP surfaces.
- `server/standalone/voiceTools.js` composes the standalone voice tools from application actions and shared catalog tools.
- `src/agent/worldPacket.js` builds a model-free snapshot from existing owners without network calls. Its vocabulary remains globe-specific.
- Cancellation does not universally undo mutations. `src/voice/realtimeController.js` explicitly documents that in-flight actions may finish after a spending cap stops new dispatches.

### Architectural obstacles

Voice sessions have interactive browser lifetimes. These modules do not by themselves provide durable agent execution, workflow recovery, persisted task state, or multi-agent authority. Browser-local scene persistence is also not a durable shared workspace backend: `src/scenes/director.js` persists projects and checkpoints through `localStorage`.

Tool visibility and schema validation are useful foundations, but should not be treated as a complete authorization model for future applications and agents.

### Proposed extension points

Retain tool catalogs and provider adapters. Add execution context containing workspace, spatial scope, actor identity, and capabilities. Put durable agent/workflow execution behind a separate service boundary. Browser voice should submit commands and observe execution state; agent survival should not require a microphone session or office panel to remain open.

Define idempotency, cancellation, retry, and compensation behavior for consequential workflow actions. Existing stale-result suppression is valuable but is not rollback or durable execution.

## 5. Performance: confirmed mechanisms versus hypotheses

No current browser/GPU measurements were collected. The following distinguishes source-backed mechanisms from bottlenecks that require profiling.

| Area | Confirmed evidence | Hypothesis to measure |
| --- | --- | --- |
| Rapid zoom | Camera changes drive tile streaming. Google token/ion routes configure 1.5 GiB cache plus 1 GiB overflow allowance in `src/maps/google3d.js`. | Tile churn, decoding, and GPU uploads may dominate cold zooms. Configured allowances are not measured usage. |
| Overlays | `src/overlays/worldOverlay.js` uses a shared post-render canvas, bounded cohorts, and UI-occlusion handling. Infrastructure layers perform throttled visibility/LOD work. | Zoom-driven cohort changes, projection, text painting, and selection solves may create CPU spikes. |
| Layer switching | Some layers retain parsed data but rebuild scene presentations on re-enable. | Repeated switching may create allocation and primitive-construction bursts despite warm network caches. |
| Scene transitions | Playback sequences visual changes, layers, travel, and settling. Pack acquisition is bounded and cancellable. | Cold asset acquisition or slow release phases may dominate transition latency. |
| Rendering effects | MSAA, retained drawing buffers, and animated post-processing exist in rendering paths. | Combined GPU cost may become significant with detailed interiors and interactive application surfaces. |
| Multiple widgets | Layout uses observers, measurements, and known obstacle rectangles. | Many independent widgets may increase layout/occlusion cost unless updates are coalesced and surfaces explicitly registered. |
| Background activity | Hidden-page handling in `src/app/tools.js` stops the default rendering loop while preserving holder/data state. | Background subscriptions may continue consuming resources; a workspace needs an explicit policy for which work remains active. |

`docs/PERFORMANCE.md` records historical hardware measurements identifying dense detection, some visual styles, cold CCTV activation, and large live populations as costly cases. It explicitly says the original capture artifacts are absent. These results are prioritization clues, not measurements reproduced by this audit.

This audit does not confirm current zoom stutter, memory leaks, or frame-time bottlenecks. Allocation tests and policy tests also do not substitute for browser frame-time and GPU measurements.

## 6. Prioritized incremental roadmap

| Priority | Refactoring step | Completion criterion |
| --- | --- | --- |
| P0 | Establish repeatable zoom, layer-switch, and scene-transition traces before architecture changes. Record frame times, heap, tile activity, render holds, and active listeners. | Comparable cold/warm traces with fixed fixtures and object counts. |
| P1 | Define versioned spatial nodes and scope-aware poses. Extend public view serialization while preserving existing globe links. | A building → floor → office → desk path round-trips with adequate local precision. |
| P1 | Generalize camera authority and clearance policies using existing navigation generations. | Rapid enter/exit navigation cannot let stale transitions reclaim the camera. |
| P1 | Introduce a scope resource owner; gradually instance-own the render governor, camera motion, and overlay host. | A scope mounts/unmounts repeatedly without affecting unrelated owners or accumulating resources. |
| P2 | Add scope-aware subscriptions and shared scheduling around existing source adapters. | Hidden scopes release visual work while explicitly retained background workflows continue. |
| P2 | Register widgets and panel surfaces; persist validated layout/theme state and continue extracting shell responsibilities. | One office supports movable widgets without new hard-coded panel IDs. |
| P2 | Add durable execution and scoped tool capabilities behind the existing catalog. | An agent survives browser disconnect and resumes with an attributable execution record. |
| P3 | Optimize measured hotspots; consider an additional interior renderer only if evidence warrants it. | Performance targets are met for the representative end-to-end hierarchy. |

The recommended first vertical slice is **one georeferenced building, one floor, one office, one desk, and one application widget**, using one viewer and explicit scope lifetimes. It exercises coordinate precision, transition authority, cleanup, UI placement, and tool context before introducing multiple renderers or a broad plugin system.

## 7. Commands, tests, and limitations

The original audit used read-only `git`, `rg`, `ls`, `cat`, `sed`, `wc`, `head`, and `tail` commands to inspect source, documentation, imports, and ownership patterns. Git checks included `git rev-parse HEAD`, `git status --short`, and `git diff --exit-code`; the checkout remained clean.

Executed during the audit:

```bash
node --test \
  src/renderGovernor.test.mjs \
  src/navigationPolicy.test.mjs \
  src/director/playback.test.mjs \
  src/voice/session.test.mjs
```

**Result: 78 passed, zero failed, zero skipped.** These tests exercise targeted render ownership, navigation handoff, playback ordering/cancellation, and voice-session lifecycle behavior.

No installation, build, full-suite rerun, live OpenAI request, or browser performance test was performed during the architectural audit. Earlier environment-onboarding validation is separate evidence and is not represented here as audit-time profiling.

The architecture proposals are recommendations, not implemented behavior. Durable agents, indoor coordinate scopes, customizable widget registration, and multi-user workspace persistence still require design and validation.
