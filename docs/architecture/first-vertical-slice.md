# First vertical slice: hierarchical 3D workspace

Status: proposed design; no application behavior is implemented by this document.

Base: latest fetched `main`, `995df8efb2412c5e9aef1498d7632d1aaac7578c`, at design time. See [repository instructions](../../AGENTS.md) and [baseline audit](baseline-audit.md). The audit describes source-confirmed behavior separately from proposed extensions; the same distinction applies here.

## 1. Outcome, scope, and constraints

Deliver an explicitly entered demo path:

**Globe → one georeferenced building → one floor → one office → one desk → one interactive application widget → back through parents or directly to the prior globe view.**

Use one existing Cesium viewer, a small bundled synthetic fixture, existing dependencies, and one local DOM application widget. The building is placed geographically but is not a claim about a real building's interior. It needs no paid provider or AI call. The initial widget is a task checklist, not an agent. Do not add a second renderer, framework, database, agent runtime, remote application embedding, or multi-agent behavior.

The demo is opt-in and absent from normal startup. Existing geographic layers, provider settings, voice, maps, scene director, and UI remain available. Existing global singletons stay in place for this single-viewer slice; new workspace code is instance-owned. Avoid rewriting the shell, layer manager, share codec, or scene director.

### Source evidence

| Confirmed existing behavior | Design implication |
| --- | --- |
| `src/app/application.js` provides staged startup, abort, and deferred cleanup. | Register one workspace owner at the application composition seam. |
| `src/ui/navigationController.js` and `src/navigationPolicy.js` coordinate navigation generations and tracking handoff. | Integrate workspace camera authority there; do not add an independent camera loop. |
| `src/view/index.js` rounds geographic positions and imposes a 50 m minimum altitude. | Store local workspace poses separately; do not use that public codec for interiors. |
| `src/cameraGroundGuard.js` defaults to 120 m arrival clearance. | Scope camera policy; do not lower exterior clearance globally. |
| `src/services/groundFloor.js` represents coarse outdoor terrain floors. | Do not reuse its geographic grid as an interior floor/collision model. |
| `src/maps/controller.js` owns map generations and provider caches. | Keep map ownership there and avoid disposing its providers on room exit. |
| `src/renderGovernor.js` and `src/overlays/worldOverlay.js` have page-wide owners. | Reuse the existing viewer; introduce no second singleton. |
| `src/ui/uiLifetime.js`, `src/app/stateChannel.js`, and `src/director/packs/session.js` provide ownership and cancellation patterns. | Reuse contracts where appropriate without coupling runtime spatial state to a shot timeline. |
| `src/voice/session.js` is a browser-session lifetime; `src/tools/catalog.js` validates tool inputs. | Neither provides durable agent execution or scoped authorization by itself. |

This proposal is based on source inspection, not measured browser performance. The original audit's historical performance references are not new measurements.

## 2. Minimal spatial model

Keep authored identity/geometry metadata separate from navigation state, renderer objects, and widget data. Plain JSON records must contain no Cesium classes, DOM nodes, callbacks, credentials, or mutable renderer handles.

Proposed contract (notation only, no TypeScript dependency):

```text
SpatialDocument {
  version: 1,
  workspaceId: string,
  rootId: string,
  nodes: SpatialNode[]
}
SpatialNode {
  id: string,
  parentId: string | null,
  kind: globe | building | floor | office | desk | application,
  label: string,
  transform: { translationM: [x,y,z], rotationXYZW: [x,y,z,w] },
  bounds: { minM: [x,y,z], maxM: [x,y,z] } | null,
  anchor?: { longitudeDeg, latitudeDeg, ellipsoidalHeightM },
  widget?: { type: "task-checklist", stateKey: string }
}
LocalCameraPose {
  frameNodeId: string,
  eyeM: [x,y,z], targetM: [x,y,z], up: [x,y,z]
}
```

All local frames are right-handed, meters, with +Z up. At the unrotated building anchor +X is east and +Y north. Quaternions are active rotations from child axes into parent axes, in XYZW order. No scale in version 1; geometry is authored in meters. A node's transform maps its local coordinates into its parent's frame. Bounds are axis-aligned in the node's own frame, not silently in world coordinates.

The globe is a logical root: `parentId: null`, identity transform, and `bounds: null`. Exactly one building is its child and has the sole geographic anchor; its transform applies within the anchor ENU frame. Descendants have no geographic anchors. Every non-root node has finite, nonempty local bounds. An application node's bounds represent its desk interaction target; the actual widget uses DOM layout.

Use assigned, immutable fixture IDs such as `demo-building-001`, `demo-floor-001`, and `demo-desk-001`. IDs are opaque and unique within a workspace, never labels, array indices, coordinate hashes, or encoded ancestry. Reparenting does not change identity. Runtime keys are `(workspaceId, nodeId)`; widget state uses the workspace and immutable application/state key. No ID generation service is needed for a bundled fixture.

Validate version, kinds, unique IDs, one root, parent existence, acyclicity, connectivity, legal kind sequence, finite numbers, normalized nonzero quaternions, non-inverted bounds, and anchor longitude/latitude ranges. Set small document/node limits. Camera eye/target must differ and the up vector must not be parallel to the viewing direction. Reject unsupported fields rather than silently treating future formats as version 1.

Fixture example: an approximately 20 × 16 m building, one floor, a 6 × 5 m office, a 1.6 × 0.8 m desk, and its checklist application. Parent-relative offsets place the floor above the base, office within the floor, desk within the office, and application target above the desktop. Explicit geometry and camera presets define the playable volume; this is not a general building editor or BIM format.

## 3. Geographic-to-local bridge

Use WGS84 longitude/latitude and **ellipsoidal** anchor height. The building frame is an east-north-up tangent frame. The spatial model and pose records remain renderer-independent; only the Cesium adapter performs conversion.

With column-vector conventions:

```text
W_building = ENU_to_ECEF(anchor) × T_building
W_node     = W_parent × T_node
p_ECEF     = W_node × [p_local, 1]
p_local    = inverse(W_node) × [p_ECEF, 1]
```

The adapter uses existing Cesium `Cartesian3.fromDegrees`, `Transforms.eastNorthUpToFixedFrame`, matrix/quaternion utilities, and camera APIs. Directions use rotation only (homogeneous w=0), never point translation. Normalize camera basis vectors after conversion. Convert local bounds to oriented world bounds for display/picking; do not pretend a rotated local AABB stays axis-aligned in ECEF.

Keep CPU calculations in JavaScript double precision and retain meter-scale source coordinates. Do not repeatedly round-trip through geographic share links or copy ECEF positions into float32 local geometry. Supply a building model matrix and local geometry through supported Cesium APIs. Precision and near-plane behavior must be browser-tested at desk scale.

For the keyless fixture, choose a documented public demo anchor and explicit ellipsoidal base height during implementation. Do not infer a real interior layout or continuously resnap the building as terrain arrives. If a ground source supplies orthometric height, convert through the existing datum-aware surface services once and record the convention; never silently mix height datums. Coordinate round-trip tests can use a fixed synthetic anchor independently of map availability.

Interior visibility is deliberate: only the current room's simple shell, floor, desk, and path context are rendered. Use an open roof/cutaway wall fixture rather than implementing clipping of external photorealistic tiles. If external geometry obstructs the fixture, report that stack as unsupported for entry and leave the user on the globe; an automatic map switch requires approval. No public view/share or director-document format changes are necessary for the first slice.

## 4. Navigation state machine and camera authority

Use an instance-owned workspace coordinator with immutable snapshots through `createStateChannel`. Separate committed state from an in-flight destination:

```text
committed: { nodeId, localPose?, ancestorReturnPoses[] }
transition: null | { generation, sourceId, targetId, phase, signal }
authority: none | workspace(generation)
```

| State/phase | Event | Action and next state |
| --- | --- | --- |
| Inactive/globe | Enter demo | Validate preconditions; request existing navigation authority; capture return view; prepare building. |
| Preparing | Resources ready | Verify both workspace generation and existing navigation authority; begin movement. |
| Moving | Flight completed | Verify authority; settle target visuals and local constraints. |
| Settling | Ready | Commit target/history atomically; release temporary transition work; stable node. |
| Stable node | Enter child / parent / breadcrumb | Start a new transaction using current committed state. |
| Any transition | Newer destination / Back / Exit | Invalidate old generation synchronously, abort acquisition, cancel only its owned flight, dispose late results; resolve newest intent. |
| Any workspace state | Explicit globe search, tracking, share restoration, or director playback | Revoke workspace authority and detach its presentation before existing navigation proceeds. Never let cleanup write the camera afterward. |
| Any acquisition/settle phase | Error | Release provisional resources; keep last committed scope; show retry/exit. |
| Any state | Application destroy | Abort and dispose; perform no camera restoration into a dying viewer. |
```

Only the existing navigation owner grants camera writes. Workspace generation is an additional stale-resource guard, not a second competing authority system. Extend the navigation seam with a scoped lease/abort notification as needed, and check it after every await. Register abort and cleanup before starting acquisition. A stale promise completing after cancellation must dispose its own result and cannot mount UI, commit history, or move the camera.

Preserve current cockpit refusal and existing navigation semantics. Entry while tracking or director playback owns the camera is refused with an explanation; the user exits those modes first. Do not auto-stop a scene or silently replace tracking. While inside, deliberate existing navigation exits the demo through the same authority handoff. Voice navigation follows existing authority; no new AI tools are needed.

On first entry capture the free-camera ECEF position and orientation plus an immutable diagnostic snapshot of map/layer state. Because the slice does not change map selection, layer enablement, or style, it need not replay those controls on return or overwrite edits made during the demo. Pause only the demo presentation when hidden. Existing geographic data continues under its existing lifecycle; globally suspending it is a separate approved policy decision.

Back goes to the semantic parent, using its recorded local camera pose where available; a breadcrumb may target any ancestor. Exit goes directly to the captured globe pose. Store one finite route stack, not a growing event log. Append/replace history only on successful commit. Back during an uncommitted enter cancels that enter and returns to its committed source; repeated Back may then ascend. Browser Back is unchanged in this slice; no URL/history interception.

Pointer/wheel input during movement cancels the owned flight and returns logical state to the committed scope while leaving the actual camera where the user took over. A subsequent action starts from the current pose. If failure happens after movement begins, restore the committed preset only while the same authority is still held; otherwise leave camera control to the new owner. Exit remains available after any failure. Settle has a bounded timeout and fixture readiness checks, not a wait for every live globe tile to finish.

Local camera presets show building, floor, office, and desk in turn. Reuse existing movement completion/cancellation behavior; authored local poses convert at the adapter boundary. Scope-specific controls constrain the interior camera to the fixture's playable volume. Do not globally disable collision, change exterior clearance constants, or mutate shared view-codec limits. Use reduced-motion preference for short/no-animation transitions. Test and restore any temporarily overridden camera-controller settings on exit, cancellation, and disposal.

## 5. Resource and execution lifetimes

| Owner | Acquires | Releases / retains |
| --- | --- | --- |
| Application/globe | Existing viewer, map controller, geographic layers, voice and shell; one workspace coordinator registered through `defer`. | Existing application destruction remains authoritative. Room exit never destroys the viewer or provider caches. |
| Workspace demo | Validated immutable fixture, committed route, temporary return pose, in-memory checklist store. | Exit removes active presentations; small plain widget state may survive re-entry until application destruction. No new disk persistence. |
| Building session | Model matrix, bounded simple geometry, local camera policies, picking registration. | Last descendant exit/disposal destroys its scene objects and restores owned settings. No shared provider ownership. |
| Floor/office presentation | Visible room primitives, interaction targets, UI anchor subscription. | Leaving the office removes listeners and primitives immediately after safe handoff; ancestor identity is plain data. |
| Desk/widget presentation | DOM root, focus hooks, resize/render subscriptions, event handlers, transient render requests. | Unmount aborts async work, removes observers/handlers/DOM, and restores focus. It does not delete checklist state. |
| Transition | Abort controller, provisional resources, owned camera flight, temporary render hold. | Commit/cancel/error releases hold and provisional handles exactly once. |
| Future persistent agent | Durable execution record, scoped permissions, workflow state owned by a backend service. | Explicit stop/delete policy, not room visibility, widget unmount, or voice disconnect. Not implemented here. |

Use idempotent `dispose()` handles and reverse acquisition cleanup. Share immutable fixture data; do not share mutable scene handles between owners. Avoid a general cache or scheduler rewrite. Request a render for discrete changes; use a unique workspace owner token for continuous holds only during actual animation. Release only holds acquired by this instance, leaving existing globe holds untouched.

Future agent UI would hold a detachable subscription to execution state, never the execution itself. Adding a persistent runtime, identity/authorization, billing, storage retention, or background provider calls requires a separate approved design. There are no placeholder agents or simulated claims of persistence in this slice.

## 6. Minimal interactive widget and existing UI

The application node opens a bundled **Task checklist**: add plain-text task, toggle complete, remove task, and show counts. Its local in-memory state is keyed by workspace/application identity and survives office exit/re-entry within the page. Reload resets it, stated in the UI. No network, file access, OpenAI call, arbitrary HTML, iframe, external application, or plugin loader.

Create the widget with an injected host element and narrow callbacks, returning `dispose()`. Render user text through `textContent`; impose modest item/text limits. Use existing shared control styles and CSS variables scoped under a workspace root. Do not add global DOM IDs, body classes, page-wide events, or changes to post-processing presets.

The desk has a 3D interaction target, but the application is an accessible DOM surface, not a web page painted onto a texture. Project its anchor through a single disposable scene subscription and update only when the camera/viewport changes. Hide it when behind the camera or outside the viewport; do not display an interior widget on the globe. Clamp its panel to a safe viewport region without covering existing controls. On small screens use a bounded compact sheet; if no safe area exists, offer a compact launcher/explicit open action instead of displacing current panels. Validate against existing rail and HUD layouts before broadening layout registration APIs.

Keyboard focus enters the widget only on explicit open and returns to its desk/launcher on close. Pointer interaction inside the DOM does not drag the globe. While an input is focused, existing voice push-to-talk and globe shortcuts must respect text-input ownership; adapt only the narrow existing input-policy seam if testing shows a conflict. Escape closes the focused widget before a workspace-level exit action, without capturing keys globally over existing dialogs. Provide semantic breadcrumbs and a labeled Exit workspace button with keyboard access and visible focus.

The globe's existing UI is neither removed nor restyled. No automatic theme switching, panel rearrangement, provider setup, or live layer toggling occurs. New widget presentation is independent of geographic effects and uses injected callbacks to request navigation.

## 7. Incremental implementation PRs (future work)

All paths marked **new** are proposals. Each PR remains independently reviewable, defaults to existing behavior, and adds no dependency. Do not start these implementation PRs under this documentation task.

| PR | Scope and source touchpoints | Tests and acceptance | Principal risk |
| --- | --- | --- | --- |
| 1. Contract + fixture | New `src/workspace/spatialModel.js`, `fixture.js`, `coordinates.js`; adapter uses existing Cesium math. Consult `src/director/camera.js` and `src/app/surfaceServices.js`, without changing their formats. | New pure tests reject cycles/duplicates/bad transforms; local→ECEF→local round-trip error <1 mm for fixture-scale points at several non-polar anchors; rotation composition and bounds tested. No renderer on normal startup. | Units, axis order, height datum. |
| 2. Scope owner + hidden prototype | New `src/workspace/session.js`, `cesiumAdapter.js`; attach narrowly in `src/app/tools.js` with its existing `defer` cleanup. Reuse `src/ui/uiLifetime.js` patterns and `src/renderGovernor.js` callbacks. | Fake resource tests cover partial acquisition, late arrivals, destroy-during-load, idempotent disposal; an explicit development entry mounts and releases synthetic geometry using one viewer. Existing default startup unchanged. | Resource ownership and accidental global-state mutation. |
| 3. Navigation + return | New `src/workspace/navigation.js`; narrow integration in `src/ui/navigationController.js` / `src/navigationPolicy.js`. Consult `src/cameraGroundGuard.js`, `src/cameraVerbs.js`, `src/ui/shareRestoration.js`, `src/scenes/director.js` for handoff coverage; do not rewrite them. | Tests for rapid enter/back/exit, newer globe search, delayed acquisition, cockpit refusal, director/track handoff, bounded failure recovery, exact successful history commit, settings restoration. One automated fixture route reaches desk and returns within 1 cm / 0.1° of saved free-camera pose. | A camera writer bypassing authority or indoor clearance affecting exterior navigation. |
| 4. Checklist widget + access | New `src/workspace/widget.js`, `ui.js`, narrowly scoped styles; inspect `src/ui/panelLayoutController.js`, `panelMeasurement.js`, `shellElements.js`, and `src/voice/realtimeInputPolicy.js`. Keep existing panels intact. | DOM tests cover editing, limits, disposal, focus, input ownership, state across re-entry, reset on reload. Browser checks at desktop/mobile widths verify usable widget, existing rails/HUD, keyboard navigation, and no globe drag while editing. | UI overlap and shortcut conflicts. |
| 5. Regression + opt-in availability | New focused QA script/fixture using existing browser tooling; inspect `scripts/qa-street-level.mjs`, `scripts/qaChrome.mjs` if present, and existing QA conventions before selecting a harness. Small explicit demo-entry integration through application composition. | Repeated full route and cancellation stress; existing map/layer/share/director/voice interaction checks; record cold/warm timing, frame times, heap, resource counts, holds. Run applicable build, boundaries, formatting, and unit checks. | Provider-dependent results mistaken for fixture behavior; insufficient hardware coverage. |

PR 1–2 may be implemented behind an inert development entry while approval-gated product choices remain unresolved. PR 3–5 require the applicable decisions below to be approved. No broad singleton removal, public URL migration, durable backend, or full plugin registry is a prerequisite.

### End-to-end acceptance and measurement plan

- Starting without credentials, explicitly enter each of the six nodes, edit a checklist, ascend via parents, and exit directly to the saved globe view. Re-entry retains session-local task state. Normal startup never opens the demo.
- Run 20 enter/exit cycles and rapid supersession tests. Active demo primitives, handlers, observers, frames, timers, and render holds return to their pre-entry counts after teardown; no disposed object receives late updates. Heap trends are diagnostic because garbage collection is nondeterministic.
- Existing map selection, enabled layers, style, provider configuration, share-link decoding, and director projects are not silently changed. Normal geographic navigation and optional voice continue to work after exit.
- Use fixture-only readiness for deterministic correctness. Record existing live-layer load and map stack separately when profiling. Compare default globe route against workspace route under the same viewport, device-pixel ratio, focus, hardware, and warm/cold conditions.
- Collect p50/p95 frame time and transition duration, tile/request activity, heap, DOM/primitive counts, and render-owner diagnostics. A provisional target is no sustained >10% regression in the comparable default globe path, verified over multiple runs; agree final hardware/performance gates after the baseline. This is a proposed target, not a measured result or promise.
- Browser acceptance must specifically test desk-scale jitter, near-plane clipping, picking, resize, reduced motion, input focus, and recovery from lost/aborted transitions. Unit tests alone cannot establish these properties.

## 8. Cesium-only recommendation and decision gates

**Recommendation:** use Cesium alone plus a DOM widget for this slice. Existing georeferencing, scene ownership, camera policies, and dependencies make it the smallest experiment. Simple local geometry and a single adapter avoid committing the domain model to renderer APIs.

**Confirmed evidence:** one viewer already supports terrain/tiles, custom primitives, request-driven rendering, managed navigation, and DOM overlays. The baseline identifies global owners and globe-oriented camera serialization. These constrain integration; they do not prove that Cesium cannot render an office.

**Hypotheses to test:** desk-scale camera precision and near-plane behavior are adequate; simple cutaway interiors render/pick correctly; DOM anchoring remains usable; existing visual effects remain acceptable. No performance or usability claim is established by this document.

Consider a separate interior renderer only after recorded failures persist through small adapter-level corrections, or requirements expand to unsupported interaction/rendering needs. Any such proposal must compare precision, input, accessibility, memory, two-context costs, visual continuity, and synchronization of return/navigation state. It requires explicit approval and must not change spatial IDs or local-coordinate contracts.

### Decisions requiring explicit approval before their implementation

| Decision | Recommended default | Approval boundary |
| --- | --- | --- |
| Product entry and geography | Explicit opt-in demo; synthetic interior at a documented public anchor; no real interior claims. | Confirm anchor/site representation and how users discover entry before product exposure. |
| Interior controls and current camera modes | Keep cockpit/director entry refusal; allow existing explicit navigation to exit the demo; local camera constraints only inside. | Approve interaction/handoff behavior before PR 3 changes navigation policy. |
| Globe visibility and provider behavior | No automatic map/layer/style changes; cutaway synthetic geometry; unsupported stack entry fails gracefully. | Any automatic stack switch, layer suspension, tile clipping, or changed rendering settings needs separate approval. |
| Widget storage and application integration | Bundled checklist with in-memory page-session state; no external permissions. | Durable storage, remote applications, iframe execution, arbitrary widgets, or network capabilities require approval. |
| Public formats and browser navigation | Existing globe URLs, share codec, director formats, and browser Back unchanged. | Deep links, schema migrations, saved workspace documents, or browser-history interception require approval. |
| Renderer and dependencies | Existing Cesium and DOM only. | A second renderer, new dependency/framework, or broad refactor needs evidence and approval. |
| Persistent agents/workflows | Lifecycle contract documented, no implementation. | Backend, authentication/authorization, persistence, billing, background execution, and multi-agent behavior need a separate design and approval. |

These are future implementation gates, not requests to approve this documentation PR or assumptions that approval has been granted.

## 9. Design validation and remaining uncertainty

Read latest-main `AGENTS.md` and `docs/architecture/baseline-audit.md`, inspected relevant composition, navigation, lifetime, surface, and UI seams, and checked package scripts/Node requirements. Publication checks must verify whitespace and documentation-only scope. No application behavior changes, installation, build, browser run, GPU profiling, or live-provider calls are part of this task.

The baseline's 78 passing targeted tests are historical audit evidence, not new validation of this proposed design. Tests in the implementation plan are future acceptance work. Open uncertainties include desk-scale rendering, camera collision details, compatibility across map stacks, mobile placement, and performance under representative live-layer load.
