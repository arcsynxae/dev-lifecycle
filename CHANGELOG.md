# dev-lifecycle

## 2.1.1

### Patch Changes

- 457769b: Harden P13 Git freshness validation and canonical context contract consistency, prevent skipped CLI checks from inflating pass counts, sanitize dirty-context telemetry signals, introduce Changesets SemVer automation with `plugin.json` synchronization, and add a deterministic runtime-only plugin distribution packager (`package:plugin`).

## 2.1.0

### Minor Changes

- Implement Principle **P13 — Context Freshness & Integrity** with persistent Project Context Profiles (`scripts/context-store.mjs`), deterministic 10-section freshness validation (`scripts/context-freshness.mjs`), targeted incremental rediscovery (`scripts/discover-project.mjs`), and `SessionStart` / `PostToolUse` hook integration.

## 2.0.0

### Major Changes

- Initial release of **DevLifecycle** (`dev-lifecycle`) v2.0.0 for Google Antigravity: 12 Core Engineering Principles (`P01`–`P12`), 8 lifecycle skills (`dl-run`, `dl-discover`, `dl-plan`, `dl-implement`, `dl-verify`, `dl-review`, `dl-release`, `dl-diagnose`), 7 specialized subagents, progressive quality gates (`Gate A`–`Gate F`), and deterministic `PreToolUse` / `PostToolUse` / `Stop` safety hooks.
