# dev-lifecycle

## 2.1.0

### Minor Changes

- Implement Principle **P13 — Context Freshness & Integrity** with persistent Project Context Profiles (`scripts/context-store.mjs`), deterministic 10-section freshness validation (`scripts/context-freshness.mjs`), targeted incremental rediscovery (`scripts/discover-project.mjs`), and `SessionStart` / `PostToolUse` hook integration.

## 2.0.0

### Major Changes

- Initial release of **DevLifecycle** (`dev-lifecycle`) v2.0.0 for Google Antigravity: 12 Core Engineering Principles (`P01`–`P12`), 8 lifecycle skills (`dl-run`, `dl-discover`, `dl-plan`, `dl-implement`, `dl-verify`, `dl-review`, `dl-release`, `dl-diagnose`), 7 specialized subagents, progressive quality gates (`Gate A`–`Gate F`), and deterministic `PreToolUse` / `PostToolUse` / `Stop` safety hooks.
