# DevLifecycle (`dev-lifecycle`) v2.1.0

**Universal, Framework-Agnostic, Project-Aware, Adaptive, Measurable & Quality-Driven Agentic Software Development Lifecycle Plugin for Google Antigravity — with P13 Persistent Project Context Intelligence.**

> **Primary Principle**: *DevLifecycle must adapt to the project, not force the project to adapt to DevLifecycle.*

---

## 1. Overview

**DevLifecycle** (`dev-lifecycle` v2.1.0) packages a complete, adaptive Agentic Software Development Lifecycle into a native Google Antigravity plugin. It helps engineering teams and AI agents consistently produce:

- Correct, maintainable, well-structured software with minimal, reviewable diffs.
- Persistent, freshness-validated project intelligence across tasks and Antigravity sessions (`P13 — Context Freshness & Integrity`) with targeted incremental rediscovery.
- Evidence-based automated verification scaled proportionally to change risk.
- Traceable engineering decisions from requirements (`Task Contract`) to final delivery (`Delivery Record`).
- Strict human-controlled permission boundaries for destructive, sensitive, or production-impacting operations.
- Measurable engineering outcomes and efficiency metrics without external SaaS dependencies or repository bloat.

---

## 2. Plugin Architecture & Components

```text
dev-lifecycle/
├── plugin.json                               # Official Antigravity v1 plugin manifest (v2.1.0)
├── README.md                                 # Installation, usage, and architecture reference
├── hooks.json                                # SessionStart, PreToolUse, PostToolUse, and Stop hooks
├── assets/
│   └── logo.svg                              # High-contrast square SVG plugin icon
├── rules/
│   └── AGENTS.md                             # Persistent Core Principles (P01-P13), Gates, DoR & DoD
├── skills/
│   ├── dl-run/                               # End-to-end adaptive lifecycle execution
│   │   ├── SKILL.md
│   │   └── references/artifact-contracts.md
│   ├── dl-discover/                          # Universal repo, monorepo & P13 context intelligence
│   │   ├── SKILL.md
│   │   └── references/monorepo-and-stack-heuristics.md
│   ├── dl-plan/                              # Task Contract, Gate A (DoR), risk classification & slicing
│   │   ├── SKILL.md
│   │   └── references/risk-and-slicing-matrix.md
│   ├── dl-implement/                         # Focused, minimal-diff slice implementation (Gate B)
│   │   └── SKILL.md
│   ├── dl-verify/                            # Evidence-based verification (Gate C & Stage 9)
│   │   │   └── SKILL.md
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
│   ├── session-start-context.mjs             # SessionStart hook: lightweight P13 cache status check
│   ├── pre-tool-safety.mjs                   # PreToolUse hook: allow / ask / force_ask / deny gate
│   ├── post-tool-tracker.mjs                 # PostToolUse hook: verification telemetry & P13 dirty hints
│   ├── stop-gate.mjs                         # Stop hook: clean delivery termination check
│   ├── context-store.mjs                     # P13 project identity, storage tiers, atomic I/O & metrics
│   ├── context-freshness.mjs                 # P13 deterministic freshness & granular invalidation engine
│   ├── discover-project.mjs                  # Universal Project, Monorepo & Incremental Rediscovery CLI
│   ├── classify-task.mjs                     # 8-factor risk classifier & bounded recovery engine
│   └── lifecycle-check.mjs                   # DoR, 10-point DoD, Clean Repo & Metrics evaluator
├── tooling/
│   ├── sync-version.mjs                      # Deterministic package.json -> plugin.json version sync
│   └── package-plugin.mjs                    # Clean runtime-only plugin distribution packager (dist/)
├── tests/
│   ├── run-all.mjs                           # Unified runner for all 45 verification scenarios
│   ├── run-tests.mjs                         # Executable validation + Scenarios A-J acceptance suite
│   ├── context-intelligence.test.mjs         # P13 Persistent Context Intelligence suite (P13-01..P13-14)
│   └── reliability-and-release.test.mjs      # v2.1.1 Reliability, SemVer, Packaging & Install suite (19 tests)
├── docs/
│   ├── INSTALLATION.md                       # Complete installation, verification & troubleshooting guide
│   ├── RESEARCH_AND_COMPATIBILITY.md         # Antigravity runtime capability & compatibility matrix
│   └── ARCHITECTURE.md                       # Detailed design rationale, P13 freshness & gate specs
└── examples/
    └── WORKFLOW_SCENARIOS.md                 # Walkthroughs of Scenarios A-J
```

---

## 3. Installation, Verification, Lifecycle Management & Quick Start

This section provides the complete installation and usage guide directly on the repository front page (also available as a standalone reference in **[`docs/INSTALLATION.md`](docs/INSTALLATION.md)**, verified on **Antigravity IDE `1.23.2` / CLI `2.0.51173`**).

### 3.1 Prerequisites

| Requirement | Minimum / Verified Version | Purpose |
| :--- | :--- | :--- |
| **Google Antigravity** | App `>= 1.22` / CLI `>= 2.0` | Host IDE, agent runtime, and `agy plugin` CLI |
| **Node.js** | `>= 20.0.0` (CI verified on **Node.js v26 Latest LTS**) | Executes zero-dependency `.mjs` lifecycle & P13 context scripts |
| **Git** *(Recommended)* | `>= 2.30` (`git` on `PATH`) | Enables commit/branch/worktree P13 freshness validation (non-Git projects also work via selective file fingerprinting) |

> **Zero Runtime npm Dependencies**: Installed DevLifecycle runtime bundles use only built-in Node.js standard library modules (`node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:os`). End users **never** need to run `npm install` to use the plugin.

---

### 3.2 Installation Methods (Ordered by Priority)

#### Method A — Direct GitHub Installation (Fastest One-Command Setup)

Install directly from the GitHub repository URL using the Antigravity CLI:

```bash
agy plugin install https://github.com/arcsynxae/dev-lifecycle
```

- **How it works**: Clones the repository into your global Antigravity plugins directory (`~/.gemini/config/plugins/dev-lifecycle` on macOS/Linux or `%USERPROFILE%\.gemini\config\plugins\dev-lifecycle` on Windows) and enables `"dev-lifecycle": true` in `~/.gemini/config/settings.json`.
- **Note**: Because `agy plugin install <github-url>` performs a direct Git clone without filtering repository files, the global plugin folder will also include repository development files (`tests/`, `docs/`, `tooling/`, `.github/`). This never pollutes your own application repositories, but if you want a strictly runtime-only plugin directory, use **Method B**.

#### Method B — Clean Runtime-Only Distribution Bundle (Zero Dev Clutter — Recommended for Production)

Every release (or local build via `npm run package:plugin`) produces a clean, runtime-only bundle containing **only** the 33 runtime plugin files (`plugin.json`, `README.md`, `hooks.json`, `assets/logo.svg`, `rules/AGENTS.md`, `agents/*.md`, `skills/*`, and `scripts/*.mjs`) with zero development, test, CI, or Changeset files.

**Option B1: From a Downloaded Release Archive (`dev-lifecycle-v<version>.zip`)**

- **Windows (PowerShell)**:
  ```powershell
  Expand-Archive -LiteralPath .\dev-lifecycle-v2.1.1.zip -DestinationPath .\dev-lifecycle-bundle -Force
  agy plugin install .\dev-lifecycle-bundle\dev-lifecycle
  Remove-Item -Recurse -Force .\dev-lifecycle-bundle
  ```
- **macOS / Linux (Bash / Zsh)**:
  ```bash
  unzip -q ./dev-lifecycle-v2.1.1.zip -d ./dev-lifecycle-bundle
  agy plugin install ./dev-lifecycle-bundle/dev-lifecycle
  rm -rf ./dev-lifecycle-bundle
  ```

**Option B2: Build & Install Clean Bundle from a Local Clone**

```bash
git clone https://github.com/arcsynxae/dev-lifecycle.git
cd dev-lifecycle
npm ci
npm run package:plugin
agy plugin install ./dist/plugin/dev-lifecycle
```

#### Method C — Manual Global Directory Placement

Antigravity discovers global user plugins from:

- **Windows**: `%USERPROFILE%\.gemini\config\plugins\dev-lifecycle`
- **macOS / Linux**: `~/.gemini/config/plugins/dev-lifecycle`

Extract `dev-lifecycle-v<version>.zip` directly into `~/.gemini/config/plugins/` so that `~/.gemini/config/plugins/dev-lifecycle/plugin.json` exists, then enable `"dev-lifecycle": true` under `"plugins"` in `~/.gemini/config/settings.json` (or toggle it on in the Antigravity **Plugins Manager** UI).

#### Method D — Workspace-Scoped Installation (`.agents/plugins/dev-lifecycle`)

To scope DevLifecycle to a single project repository (for example, to standardize engineering lifecycle gates across a team without requiring global installation):

1. Copy the clean runtime folder (`dist/plugin/dev-lifecycle` or extracted `dev-lifecycle/` from `dev-lifecycle-v<version>.zip`) into your project's `.agents/plugins/` directory:
   ```text
   <your-project-root>/.agents/plugins/dev-lifecycle/plugin.json
   ```
2. Antigravity's customization discovery priority is **Workspace (`.agents/plugins/`) > Global (`~/.gemini/config/plugins/`) > Built-in**, so the workspace copy takes precedence for that repository.

---

### 3.3 Verifying Your Installation

Run the official Antigravity CLI commands to confirm that DevLifecycle is installed, valid, and enabled:

```bash
# 1. List installed plugins and discovered components
agy plugin list

# 2. Inspect structured JSON discovery output
agy plugin list --json

# 3. Run strict schema and component validation
agy plugin validate --strict ~/.gemini/config/plugins/dev-lifecycle
```

**Expected Discovered Components (`agy plugin list`):**
- **Manifest**: `dev-lifecycle` (**DevLifecycle**)
- **Rules (1)**: `AGENTS.md` (`rules/AGENTS.md`)
- **Skills (8)**: `dl-run`, `dl-discover`, `dl-plan`, `dl-implement`, `dl-verify`, `dl-diagnose`, `dl-review`, `dl-release`
- **Subagents (7)**: `lifecycle-orchestrator`, `software-architect`, `implementation-engineer`, `quality-engineer`, `code-reviewer`, `security-reviewer`, `release-engineer`
- **Hooks (4)**: `dev-lifecycle-session-context` (`SessionStart`), `dev-lifecycle-safety-gate` (`PreToolUse`), `dev-lifecycle-verification-tracker` (`PostToolUse`), `dev-lifecycle-stop-gate` (`Stop`)

---

### 3.4 Updating, Enabling/Disabling, and Uninstalling

- **Update to a Newer Version**:
  ```bash
  agy plugin install https://github.com/arcsynxae/dev-lifecycle
  # or from a clean staged bundle:
  agy plugin install ./dist/plugin/dev-lifecycle
  ```
- **Enable / Disable**:
  - **UI**: Open **Plugins Manager** in Google Antigravity and toggle **DevLifecycle** on or off.
  - **Config File**: Edit `~/.gemini/config/settings.json`:
    ```json
    {
      "plugins": {
        "dev-lifecycle": true
      }
    }
    ```
- **Uninstall**:
  ```bash
  agy plugin uninstall dev-lifecycle
  ```
  *(If installed at workspace scope via Method D, delete `<your-project-root>/.agents/plugins/dev-lifecycle`.)*

---

### 3.5 Quick Start & Usage in Antigravity

Once installed and enabled, DevLifecycle operates both **automatically** and **on-demand**:

1. **Automatic Lifecycle & P13 Context Intelligence**:
   - **Rule (`rules/AGENTS.md`)**: Automatically enforces Principles `P01`–`P13`, adaptive execution profiles (`Quick`, `Standard`, `Deep`), and quality gates (`Gate A`–`Gate F`).
   - **`SessionStart` Hook**: Preloads verified P13 project context metadata at session startup without polluting your repository.
   - **`PreToolUse` Hook**: Blocks catastrophic commands (`deny`), requires explicit confirmation for `git push`, `gh pr merge`, `npm publish`, deploys, or `.env`/secret edits (`force_ask`), and prompts on `git commit` (`ask`).
   - **`PostToolUse` & `Stop` Hooks**: Track verification evidence and mark cached context dirty when files or dependencies change.
2. **Example Quick Start Prompts**:
   - **End-to-End Lifecycle (`dl-run`)**:
     > *"Run DevLifecycle (`dl-run`) to implement [feature / bug fix] with adaptive verification and produce a Delivery Record."*
   - **Repository & Monorepo Discovery (`dl-discover`)**:
     > *"Discover this repository architecture, workspace boundaries, and CI pipeline using `dl-discover` and generate a Project Context Profile."*
   - **Risk Classification & Slice Planning (`dl-plan`)**:
     > *"Create a Task Contract, classify the execution profile (`Quick`, `Standard`, or `Deep`), and design an incremental Execution Plan using `dl-plan`."*
   - **Verification & Quality Gates (`dl-verify`)**:
     > *"Run `dl-verify` on the current changes, execute applicable checks, and verify the 10-point Definition of Done."*

---

### 3.6 Troubleshooting & Developer Verification Commands

- **`agy` is not recognized on Windows PowerShell**:
  If `agy` is not yet on your user `PATH`, invoke it via its default installation path:
  ```powershell
  & "$env:LOCALAPPDATA\Programs\Antigravity\bin\agy.cmd" plugin list
  ```
- **Resetting or Clearing the P13 Persistent Context Cache**:
  DevLifecycle stores persistent project context outside your repository in your OS user cache directory (`%LOCALAPPDATA%\dev-lifecycle\Cache\project-context` on Windows, `~/Library/Caches/dev-lifecycle/project-context` on macOS, `~/.cache/dev-lifecycle/project-context` on Linux):
  ```bash
  # Force a fresh discovery and overwrite cache for the current repository
  node ~/.gemini/config/plugins/dev-lifecycle/scripts/discover-project.mjs --refresh .

  # Delete cached context for the current repository
  node ~/.gemini/config/plugins/dev-lifecycle/scripts/discover-project.mjs --clear-cache .
  ```
- **Repository Contributors — Run Executable Verification Suites (45 Scenarios) & Changesets**:
  ```bash
  # Run all 3 test suites (45 scenarios: baseline + P13 + v2.1.1 reliability/release)
  npm test

  # Stage & validate clean runtime-only plugin bundle in ./dist/plugin/dev-lifecycle
  npm run package:plugin

  # Add a changeset entry for a PR & check manifest version synchronization
  npm run changeset
  npm run version:check
  ```

---

## 4. Adaptive Lifecycle Model & Execution Profiles

DevLifecycle adapts its workflow across the P13-aware entry flow and 11 logical stages:

`Identify Project → Load Context → Validate Freshness → Refresh if Needed → Task-Specific Discovery → Define → Classify → Plan → Build → Verify → (Diagnose & Recover) → Review → Integrate → Deliver → Release`

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
