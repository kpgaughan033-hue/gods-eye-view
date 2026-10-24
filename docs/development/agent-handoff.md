# Development automation: agent handoff and merge policy

This repository already has GitHub Actions CI at `.github/workflows/ci.yml`. Preserve it. The current pipeline runs cross-version Node verification, browser fixture tests, and Windows onboarding. This handoff standardizes task definition and review; it does **not** install a Codex runner or auto-merge PRs.

## Current workflow (manual agent start; automated GitHub checks)

1. A human and/or planning assistant creates an **Agent implementation milestone** GitHub issue with outcome, exact scope, exclusions, tests, and architecture links. The issue is the durable source of truth, replacing repeated copy/paste of large prompts.
2. The owner approves the scope and starts Codex on **latest main**, pointing it to the issue URL and `AGENTS.md`. Browser Codex execution is currently manual; creating an issue alone does not launch an agent.
3. Codex implements on a task-specific branch and publishes a PR targeting `main`. If API permissions prevent PR creation, it pushes the branch and supplies a GitHub compare/create-PR link for the owner.
4. GitHub Actions automatically checks the PR. Codex provides its own targeted test report and explicitly distinguishes source review, CPU tests, software WebGL, hardware GPU, and live-provider verification.
5. A reviewer inspects the diff, test evidence, lifecycle and camera implications, and CI results. Request corrections on the **same** PR if needed. An AI review is advisory; the repository owner retains merge authority.
6. Merge only after explicit owner approval and successful required checks. A planning assistant may perform a merge only after the owner has explicitly authorized that merge. If checks are unavailable, failed, or not configured as required, stop and explain before merging.
7. Start the next approved issue from updated `main`; never stack milestones on an unmerged feature branch by default.

## Codex task starter (short prompt)

> Implement GitHub issue #ISSUE_NUMBER in this repository from latest main. Read AGENTS.md and all documents linked by the issue. Follow its scope, exclusions, and acceptance criteria. Run relevant targeted checks and report exactly what ran, including browser/GPU limitations. Push a focused branch and open a PR targeting main (or provide a compare link if API permissions prevent PR creation). Do not merge.

## Safeguards and administration

- PR template checkboxes are review aids, **not enforced GitHub checks**.
- CI workflows run automatically, but a green run alone does not authorize a merge. Verify checks correspond to the current PR head.
- For enforceable required checks and review rules, configure a `main` branch ruleset/protection in GitHub Settings when the repository plan and permissions support it. Select stable existing CI job names, require them to pass, and prevent bypass where appropriate. Confirm the ruleset actually applies before describing it as enforced.
- Keep `GITHUB_TOKEN` read-only in ordinary CI. Never add write permissions, automatic PR approval, or auto-merge as part of this initial handoff.
- Do not place credentials in issues, prompts, PR bodies, screenshots, or CI logs.
- Codex task launching, agent authentication, PR publication rights, and auto-merge require separate integration/permission verification. This PR deliberately does not pretend those steps are automated.
- Prefer a dedicated follow-up to evaluate a supported agent runner with minimal permissions, fork safety, usage limits, audit logs, and a human approval gate.
- The existing CI may require maintenance independently; don't silently alter its tests, dependency versions, or job names in a documentation-only handoff.

## Architecture-specific review gates

For workspace milestones, inspect spatial identity and coordinate conventions; viewer and render-governor ownership; abort and stale-completion behavior; single camera authority and clearance rules; widget versus persistent-agent lifetimes; and any normal-startup behavior. Request real browser evidence for rendering/navigation changes. Tests using fakes are not substitutes for visual verification.

## CI activation note

If GitHub Actions is enabled on a fork after a PR was opened, existing PRs may show no checks. Push a new commit to the PR branch to trigger the existing pull_request workflow, then verify actual runs and results before merging.

## Suggested next milestone

Milestone 3 is navigation and return transitions from globe to synthetic building/floor/office/desk and back. Treat camera authority, precision, cancellation, and restore behavior as an explicit approval gate before implementation.
