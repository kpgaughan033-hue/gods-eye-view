# Repository agent instructions

These instructions apply to coding agents working in this repository. Follow the user's task instructions when they are more specific, while respecting safety, security, and repository constraints.

## Project context

God's Eye View is an existing geographic 3D visualization application. The long-term exploration is a hierarchical 3D AI workspace: globe → building → floor → office → desk → interactive application, with customizable widgets and persistent AI agents.

This is a direction for incremental experimentation, **not** a mandate to implement the whole vision or replace the current architecture. Consult `docs/architecture/baseline-audit.md` when it is available on the working branch; treat its proposals as hypotheses and plans, not implemented features.

## Working practices

- Preserve existing application behavior unless the task explicitly requests a change. Do not remove geographic layers, voice tools, provider integrations, or UI features just to simplify a prototype.
- Prefer small, reviewable changes over broad rewrites. Use a task-specific branch and pull request; do not merge without explicit approval.
- Before editing, inspect the relevant modules, tests, and documentation. State assumptions and ask for clarification when a decision would materially affect architecture, security, cost, or user experience.
- Keep changes scoped to the task. Avoid unrelated formatting, dependency upgrades, generated assets, and configuration changes.
- Report what changed, why, how it was tested, and what remains unverified. Distinguish source-confirmed findings from measured results, hypotheses, and recommendations.
- Add or update targeted tests for behavioral changes. Run relevant checks, and report failures accurately; never imply a browser/GPU test or live-provider validation happened if it did not.
- Do not commit credentials, tokens, private data, or secrets. Keep paid API calls and external provider dependencies opt-in and documented.

## Architectural guardrails

- Model spatial identity and navigation separately from a particular renderer. Geographic placement and local building/room transforms may need different precision and coordinate conventions.
- Preserve one clear authority for camera transitions. Reuse existing cancellation/generation mechanisms where possible; do not introduce competing camera controllers without a deliberate design.
- Keep **persistent agent/workflow execution**, **scene/rendering resources**, and **UI/widget presentation** as distinct lifetimes. Hiding or unmounting a visual scope must not implicitly terminate durable work.
- Prefer explicit ownership, disposal, and cancellation for subscriptions, listeners, timers, scene objects, and asynchronous work.
- Extend existing composition and tool-catalog seams where practical. Treat tool schema validation as distinct from authorization and scoped permissions.
- Keep UI themes/layout state separate from geographic post-processing effects. Avoid introducing more global DOM IDs, module-level singletons, or page-wide events for new independently mounted widgets.
- Do not assume a separate interior renderer, a React rewrite, or a new agent framework is necessary until a small prototype and evidence justify it.
- Profile performance before optimizing. Record representative cold/warm zoom, layer-switch, and scene-transition measurements; do not present inferred bottlenecks as measured ones.

## Validation and handoff

- Check `package.json` for the current Node engine requirements and available scripts before running commands.
- Prefer relevant targeted tests first, followed by applicable repository checks (such as `npm test`, `npm run build`, `npm run doctor`, `npm run format:check`, and `npm run check:boundaries`) when practical.
- For pull requests, summarize scope, files changed, tests/checks run, known limitations, and any follow-up decisions needed.
- Documentation-only tasks should not alter application source or configuration unless explicitly requested.
