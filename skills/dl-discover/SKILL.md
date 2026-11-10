---
name: dl-discover
description: >-
  Universal, framework-agnostic repository and monorepo architecture discovery. Produces a verified Project Context Profile covering languages, frameworks, versions, package/workspace managers, affected package boundaries, verification commands, CI/CD pipelines, and confidence levels. Use at the start of a task or when inspecting an unfamiliar codebase.
---

# `dl-discover` — Universal Project & Monorepo Intelligence

Establish verified technical context (`P01 — Context Before Action`) before planning or modifying any repository. Never assume a stack from a single dependency, never assume a package manager exists, and never create a permanent discovery database in the project repository.

---

## 1. Activation Conditions

Activate `dl-discover` when:
- Starting work in a repository that has no current session `Project Context Profile`.
- Dependencies, workspace configuration, build scripts, or CI/CD workflows have changed since the last discovery pass.
- The user invokes `/dl-discover` or asks to analyze repository architecture, monorepo structure, or available verification commands.

---

## 2. Inputs

- **Workspace Root Path**: Target repository or subdirectory.
- **Optional Scope Hint**: Specific package, service, or git diff range under investigation.

---

## 3. Discovery Procedure

### Step 1: Run Automated Evidence Collection
When Node.js is available, run the bundled deterministic discovery helper from the plugin root (or inspect equivalent files directly with `read_file`):
```bash
node "<plugin-root>/scripts/discover-project.mjs" "<workspace-path>"
```
This script inspects manifests, lockfiles, workspace declarations, CI/CD files, and git state without modifying the repository.

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
1. Repository Topology (`standalone` | `monorepo` | `multi-package`)
2. Verified Technology Stack with Installed Versions & Confidence Levels (`HIGH` | `MEDIUM` | `LOW`)
3. Application & Package Boundaries + Dependency Graph
4. Exact Development & Verification Commands
5. Coding Conventions & Architectural Constraints
6. CI/CD & Deployment Configuration
7. Unresolved Assumptions

---

## 5. Completion Conditions

`dl-discover` is complete when sufficient verified technical context exists to determine a safe, convention-compliant implementation and verification approach (`Stage 1 Success Condition`).

---

## 6. Safety Boundaries

- **Read-Only Discovery**: Never modify repository files, install packages, or run mutating build commands during discovery.
- **Session Caching (`P09`)**: Reuse the generated `Project Context Profile` across subsequent lifecycle stages; re-run discovery only for segments invalidated by config, dependency, or structural changes.
