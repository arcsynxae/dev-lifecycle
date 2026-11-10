# DevLifecycle (`dev-lifecycle`) v2.0.0

**Universal, Framework-Agnostic, Project-Aware, Adaptive, Measurable & Quality-Driven Agentic Software Development Lifecycle Plugin for Google Antigravity.**

> **Primary Principle**: *DevLifecycle must adapt to the project, not force the project to adapt to DevLifecycle.*

---

## 1. Overview

**DevLifecycle** (`dev-lifecycle`) packages a complete, adaptive Agentic Software Development Lifecycle into a native Google Antigravity plugin. It helps engineering teams and AI agents consistently produce:

- Correct, maintainable, well-structured software with minimal, reviewable diffs.
- Evidence-based automated verification scaled proportionally to change risk.
- Traceable engineering decisions from requirements (`Task Contract`) to final delivery (`Delivery Record`).
- Strict human-controlled permission boundaries for destructive, sensitive, or production-impacting operations.
- Measurable engineering outcomes and efficiency metrics without external SaaS dependencies or repository bloat.

---

## 2. Plugin Architecture & Components

```text
dev-lifecycle/
├── plugin.json                               # Official Antigravity v1 plugin manifest
├── README.md                                 # Installation, usage, and architecture reference
├── hooks.json                                # Deterministic PreToolUse, PostToolUse, and Stop hooks
├── assets/
│   └── logo.svg                              # High-contrast square SVG plugin icon
├── rules/
│   └── AGENTS.md                             # Persistent Core Principles (P01-P12), Gates, DoR & DoD
├── skills/
│   ├── dl-run/                               # End-to-end adaptive lifecycle execution
│   │   ├── SKILL.md
│   │   └── references/artifact-contracts.md
│   ├── dl-discover/                          # Universal repo, monorepo & CI/CD discovery
│   │   ├── SKILL.md
│   │   └── references/monorepo-and-stack-heuristics.md
│   ├── dl-plan/                              # Task Contract, Gate A (DoR), risk classification & slicing
│   │   ├── SKILL.md
│   │   └── references/risk-and-slicing-matrix.md
│   ├── dl-implement/                         # Focused, minimal-diff slice implementation (Gate B)
│   │   └── SKILL.md
│   ├── dl-verify/                            # Evidence-based verification (Gate C & Stage 9)
│   │   ├── SKILL.md
│   │   └── references/ci-and-verification-guide.md
│   ├── dl-review/                            # Spec, quality & security review (Gate D)
│   │   └── SKILL.md
│   ├── dl-release/                           # Clean delivery (Gate E) & controlled release (Gate F)
│   │   └── SKILL.md
│   └── dl-diagnose/                          # Root-cause diagnosis & bounded recovery (max 3 attempts)
│       └── SKILL.md
├── agents/
│   ├── lifecycle-orchestrator.md             # End-to-end multi-slice orchestrator subagent
│   ├── software-architect.md                 # Read-only architecture, dependency & slicing analyst
│   ├── implementation-engineer.md            # Focused slice builder subagent
│   ├── quality-engineer.md                   # Verification, baseline diff & CI optimization specialist
│   ├── code-reviewer.md                      # Read-only specification & code quality reviewer
│   ├── security-reviewer.md                  # Read-only threat & vulnerability reviewer
│   └── release-engineer.md                   # Delivery integrity & controlled release specialist
├── scripts/
│   ├── pre-tool-safety.mjs                   # PreToolUse hook: allow / ask / force_ask / deny gate
│   ├── post-tool-tracker.mjs                 # PostToolUse hook: verification & bounded retry telemetry
│   ├── stop-gate.mjs                         # Stop hook: clean delivery termination check
│   ├── discover-project.mjs                  # Universal Project & Monorepo Intelligence CLI/module
│   ├── classify-task.mjs                     # 8-factor risk classifier & bounded recovery engine
│   └── lifecycle-check.mjs                   # DoR, 10-point DoD, Clean Repo & Metrics evaluator
├── tests/
│   └── run-tests.mjs                         # Executable validation + Scenarios A-J acceptance suite
├── docs/
│   ├── RESEARCH_AND_COMPATIBILITY.md         # Antigravity runtime capability & compatibility matrix
│   └── ARCHITECTURE.md                       # Detailed design rationale, state model & gate specs
└── examples/
    └── WORKFLOW_SCENARIOS.md                 # Walkthroughs of Scenarios A-J
```

---

## 3. Installation & Validation

### Validate Strictly with Antigravity CLI
```bash
agy plugin validate --strict ./
```

### Install Locally into Antigravity
You can install `dev-lifecycle` globally into `~/.gemini/config/plugins/dev-lifecycle` using the Antigravity CLI:
```bash
agy plugin install ./
agy plugin list
```
Or register it per-workspace via `.agents/plugins.json`:
```json
{
  "entries": [
    { "path": "." }
  ]
}
```

### Run Executable Acceptance Tests
```bash
node ./tests/run-tests.mjs
```

---

## 4. Adaptive Lifecycle Model & Execution Profiles

DevLifecycle adapts its workflow across 11 logical stages:

`Discover → Define → Classify → Plan → Build → Verify → (Diagnose & Recover) → Review → Integrate → Deliver → Release`

| Execution Profile | Target Tasks | Planning & Artifacts | Agent Configuration | Verification & Review |
| :--- | :--- | :--- | :--- | :--- |
| **`Quick`** | Small, localized, low-risk fixes (1–2 files) | Implicit DoR; concise inline plan & report | Single primary agent | Targeted test/typecheck; fast self-audit |
| **`Standard`** | Typical features & multi-file bug fixes | Session `Task Contract`, slice `Execution Plan` & `Delivery Record` | Primary agent + optional `code-reviewer` | Affected package suite + integration check |
| **`Deep`** | Architectural, cross-package, security, DB migration, or prod changes | Full impact/dependency plan, migration/rollback analysis & `Delivery Record` | Justified delegation (`software-architect`, `code-reviewer`, `security-reviewer`) | Full affected dependency graph ($D \cup T$) + regression & security gates |

> **High-Risk Safety Floor**: Tasks involving authentication/security, database migrations, destructive operations, breaking contracts, or production deployments **never** downgrade to `Quick` mode.

---

## 5. Progressive Quality Gates & Completion States

Every applicable check records an explicit outcome: `PASS`, `FAIL`, `SKIPPED`, `NOT_RUN`, or `BLOCKED` (with mandatory justification for `SKIPPED`, `NOT_RUN`, and `BLOCKED`).

- **Gate A — Requirement Readiness**: Definition of Ready satisfied; `Task Contract` established.
- **Gate B — Implementation Integrity**: Minimal diff, within authorized scope, project conventions preserved.
- **Gate C — Verification Integrity**: Project-defined checks executed; baseline failures separated from new regressions.
- **Gate D — Review Integrity**: Zero unresolved `CRITICAL` or `HIGH` defects.
- **Gate E — Delivery Integrity**: 10-point Definition of Done satisfied; repository clean of temporary/secret files.
- **Gate F — Release Integrity**: Current-revision CI green; separated human authorization for `commit`, `push`, `PR`, `merge`, `release`, and `deploy`.

### Lifecycle Completion States
`READY` · `IN_PROGRESS` · `BLOCKED` · `VERIFICATION_FAILED` · `READY_FOR_REVIEW` · `DONE` · `READY_FOR_RELEASE` · `RELEASED` · `PRODUCTION_VERIFIED`

---

## 6. Known Limitations

1. **Synchronous Command Hooks**: Antigravity `hooks.json` currently supports `type: "command"` running synchronously (`docs/hooks.md`). DevLifecycle keeps all hook scripts lightweight (<50ms) and delegates full test execution to explicit verification stages (`dl-verify`).
2. **24 KB Rule & Skill Body Cap**: Antigravity caps individual `SKILL.md` bodies and `rules/AGENTS.md` files at 24,000 bytes. DevLifecycle uses progressive disclosure (`references/` subdirectories) so all files remain well under the cap with zero truncation warnings.
3. **Optional Orchestration Surfaces**: `/swarm` (Preview & Quota-Heavy) and `/teamwork` are treated as optional enhancements; DevLifecycle runs natively with standard tools and `invoke_subagent`, and degrades gracefully when optional integrations or MCP servers are absent.
