---
name: dl-discover
description: >-
  Universal, framework-agnostic repository and monorepo architecture discovery with P13 Persistent Project Context Intelligence. Produces or incrementally refreshes a verified Project Context Profile covering languages, frameworks, versions, package/workspace managers, affected package boundaries, verification commands, CI/CD pipelines, evidence fingerprints, and confidence levels. Use at the start of a task, across sessions, or when inspecting an unfamiliar codebase.
---

# `dl-discover` — Universal Project & Persistent Context Intelligence (P01 & P13)

Establish verified technical context (`P01 — Context Before Action`) while reusing previously verified project intelligence across tasks and Antigravity sessions (`P13 — Context Freshness & Integrity`). Never assume a stack from a single dependency, never trust stale cached context without freshness validation, and never write cache files into the user's repository.

---

## 1. Activation Conditions

Activate `dl-discover` when:
- Starting work in a repository (`Identify Project → Load Context → Validate Freshness → Refresh if Needed → Task-Specific Discovery`).
- Dependencies, lockfiles, workspace configuration, build scripts, branch/HEAD, or CI/CD workflows have changed since the last discovery pass.
- The user invokes `/dl-discover` or asks to analyze, refresh, or clear cached repository architecture, monorepo structure, or verification commands.

---

## 2. Inputs

- **Workspace Root Path(s)**: Single repository root or multiple workspace roots.
- **Optional Task Files (`--task-files`)**: Comma-separated list of task-relevant source files that must be inspected in their live state (`P13 #7`).
- **Optional Changed Files (`--changed`)**: Comma-separated list of modified files for monorepo impact analysis.
- **Optional Refresh Controls**:
  - `--force-refresh`: Bypass cached sections and perform a full fresh discovery scan.
  - `--clear-cache`: Delete the persistent cache entry for the target project/worktree.

---

## 3. Discovery & P13 Freshness Procedure

### Step 1: Identify Project, Load Context & Validate Freshness
When Node.js is available, run the bundled deterministic discovery & freshness helper from the plugin root:
```bash
# Default: Load cached context, validate freshness, and reuse or incrementally refresh
node "<plugin-root>/scripts/discover-project.mjs" "<workspace-path>" --task-files "src/index.ts"

# Force full rediscovery (bypass cache)
node "<plugin-root>/scripts/discover-project.mjs" "<workspace-path>" --force-refresh

# Clear persistent project cache
node "<plugin-root>/scripts/discover-project.mjs" "<workspace-path>" --clear-cache

# Multi-folder workspace discovery (isolated per root)
node "<plugin-root>/scripts/discover-project.mjs" --multi-root "<root-a>,<root-b>"
```
The engine automatically executes the 5-step P13 entry flow:
1. **Identify Project & Worktree**: Computes stable `projectKey` (Git common dir + root commit, or canonical path hash for non-Git repos) and `worktreeKey` (isolating separate Git worktrees and branches).
2. **Load Persistent Context**: Reads from `${PLUGIN_DATA}` (when available in plugin hooks) or the OS user cache directory (`%LOCALAPPDATA%/dev-lifecycle/Cache` / `~/.cache/dev-lifecycle`), falling back gracefully to session scratch or memory-only mode if storage is restricted.
3. **Validate Freshness**: Compares `git rev-parse HEAD`, branch, `git status --porcelain`, and SHA-256 fingerprints of key manifests, lockfiles, workspace definitions, framework configs, CI workflows, and instruction files.
4. **Targeted Incremental Refresh**:
   - **`VALID` (`HIT`)**: Reuses all 10 cached context sections without re-scanning the repository.
   - **`PARTIAL_STALE` (`INCREMENTAL_REFRESH`)**: Recomputes **only** the invalidated sections (e.g., `impact` when a single source file changes, or `packageManagers`/`languages`/`frameworks`/`verificationCommands` when `package.json` changes) while preserving unaffected verified sections.
   - **`MISSING` / `INVALID` / `FULL_STALE`**: Performs full discovery and repairs the cache safely.
5. **Live Task-Specific Inspection (`P13 #7`)**: Always reads the live state and hash of task-targeted source files (`liveTaskFiles`) directly from disk—never from cached summaries.

### Step 2: Inspect Repository Instructions & Local Rules First
Check for and read existing project guidance before making architectural assumptions:
- `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, `.agents/rules/*.md`
- `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`
- Editor/linter/formatter configs (`.editorconfig`, `tsconfig.json`, `pyproject.toml`, `rustfmt.toml`, `.eslintrc*`, `biome.json`, `oxlintrc.json`)

### Step 3: Multi-Signal Stack & Framework Verification
Identify technologies using **converging evidence** (manifest dependency + config file + entry point/directory layout):
- **HIGH Confidence**: Dependency declared in manifest/lockfile AND matching configuration file or source structure verified (e.g., `astro` in `package.json` + `astro.config.mjs` + `src/pages/`).
- **MEDIUM Confidence**: Dependency or config present, but usage scope is partial or secondary.
- **LOW Confidence / Assumption**: Inferred from naming or partial files; must be labeled as an assumption until verified.
- **Unknown / Custom Frameworks**: When encountering custom architectures or unfamiliar frameworks (e.g., Void, custom internal engines, raw language builds, Makefiles, shell-based toolchains), extract the actual build/test/run entry points defined in the repository and inspect installed local documentation (`node_modules/<pkg>/README.md`, vendor docs, or official version-matched docs). Never impose a familiar framework.

### Step 4: Monorepo & Dependency Graph Analysis
For repositories containing multiple packages or workspace configs (see [monorepo-and-stack-heuristics.md](./references/monorepo-and-stack-heuristics.md)):
1. Identify workspace boundaries (`pnpm-workspace.yaml`, `package.json#workspaces`, `turbo.json`, `nx.json`, `Cargo.toml` `[workspace]`, `go.work`, `pyproject.toml` workspaces, `settings.gradle*`, `pom.xml` `<modules>`).
2. Map internal package dependencies (`workspace:*`, path dependencies, internal module imports).
3. Identify **directly affected packages** (from the user prompt or `git status` / `git diff`) and **downstream dependents**.
4. Determine whether focused package-level verification is safe, or whether changes to shared core packages / root configs require expanded verification.

### Step 5: Extract Exact Verification, CI/CD & Deployment Commands
Record the exact commands defined by the project (never invent tools not present):
- **Formatting / Linting / Typechecking**
- **Unit / Integration / Contract / E2E / Browser / Performance Tests**
- **Build / Packaging**
- **CI/CD Pipelines**: Inspect `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `bitbucket-pipelines.yml`, `.circleci/`, etc. Note required checks and any duplicate steps across jobs.
- **Deployment Targets**: Inspect only actual config evidence (`Dockerfile`, `docker-compose.yml`, `wrangler.toml`/`wrangler.jsonc`, `vercel.json`, `netlify.toml`, `fly.toml`, `railway.json`, Kubernetes/Helm/Terraform manifests). Do not assume an application is deployed if no deployment config exists.

---

## 4. Expected Outputs

Produce a **Project Context Profile** (as a session artifact in `<appDataDir>/brain/<conversation-id>/project-context-profile.md` for `Standard`/`Deep` tasks, or concise inline summary for `Quick` tasks) containing:
1. Project Identity (`projectKey`, `worktreeKey`) & Repository Topology (`standalone` | `monorepo` | `multi-package`)
2. Context Cache Status (`HIT` | `MISS` | `INCREMENTAL_REFRESH` | `FULL_REFRESH` | `FALLBACK_SESSION`), Storage Tier, Reused vs. Refreshed Sections, and Evidence Fingerprints
3. Verified Technology Stack with Installed Versions & Confidence Levels (`HIGH` | `MEDIUM` | `LOW`)
4. Application & Package Boundaries + Dependency Graph
5. Exact Development & Verification Commands
6. Coding Conventions & Architectural Constraints
7. CI/CD & Deployment Configuration
8. Live Task-Specific Files Inspected & Unresolved Assumptions

---

## 5. Completion Conditions

`dl-discover` is complete when a freshness-validated `Project Context Profile` and live task-file inspection exist to determine a safe, convention-compliant implementation and verification approach (`Stage 1 Success Condition`).

---

## 6. Safety Boundaries

- **Read-Only Repository Discovery**: Never modify repository files, install packages, or write cache files inside the user's repository or installed plugin folder.
- **High-Risk Freshness Guarantee (`P13 #8`)**: Never rely on unverified cached configuration for `Deep`-profile tasks, security/auth changes, database migrations, or release/deployment workflows.
- **Secret Hygiene (`P13 #10`)**: Never store `.env` values, credentials, private keys, tokens, or raw source files in persistent context cache records.
