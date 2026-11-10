---
name: dl-verify
description: >-
  Risk-proportional, evidence-based verification (Stage 6 / Gate C) and Final Integration Verification (Stage 9). Selects applicable project-defined checks, differentiates baseline failures from newly introduced regressions, avoids redundant check executions, and evaluates CI/CD efficiency. Use after implementation or before delivery/release.
---

# `dl-verify` — Proportional, Evidence-Based Verification

Enforce **Gate C (Verification Integrity)** and **Stage 9 (Final Integration Verification)** (`P07 — Evidence Over Assumption`, `P08 — Risk-Based Verification`, `P09 — Eliminate Redundant Work`).

---

## 1. Activation Conditions

Activate `dl-verify` when:
- A slice implementation (`dl-implement`) or repair attempt (`dl-diagnose`) is ready for verification.
- All slices are complete and require **Stage 9 (Final Integration Verification)**.
- Evaluating Definition of Done (`Gate E`) or CI/CD duplicate check efficiency (`Stage 11`).
- The user invokes `/dl-verify` to test and validate current changes.

---

## 2. Inputs

- **Project Context Profile**: Discovered test, lint, typecheck, and build commands + monorepo dependency graph.
- **Task Contract & Execution Profile**: `Quick`, `Standard`, or `Deep` mode + acceptance criteria.
- **Modified Scope**: Files and packages touched in the current slice or overall task.

---

## 3. Verification Procedure

### Step 1: Select Risk-Proportional Checks (`P08`)
Choose from the repository's actual configured checks (never invent unconfigured tools):
1. **Formatting & Linting** (`prettier`, `eslint`, `biome`, `ruff`, `clippy`, `golangci-lint`, etc.)
2. **Type Checking** (`tsc --noEmit`, `astro check`, `vue-tsc`, `mypy`, `pyright`, `cargo check`)
3. **Unit Tests** (targeted to modified files/packages in `Quick`/`Standard` slice verification)
4. **Integration & Contract Tests** (for API, DB, cross-module, or service boundary changes)
5. **Build Verification** (when module exports, bundling, SSR/SSG, or build configs are affected)
6. **Security / Dependency Checks** (when auth, inputs, dependencies, or security configs change)
7. **Accessibility & Browser Verification** (when UI/HTML/CSS/client-side interactions change — delegate interactive visual verification to the `browser` subagent or use `a11y-debugging` / `chrome-devtools` when appropriate)
8. **Performance Tests** (when hot paths, queries, or bundle sizes are in scope)

See [ci-and-verification-guide.md](./references/ci-and-verification-guide.md) for profile-to-check mapping and monorepo scoping.

### Step 2: Eliminate Redundant Executions (`P09`)
Before running a command:
- Check if the **exact same command** has already been executed against the **exact same working-tree diff, configuration, and environment** in the current session.
- If inputs are unchanged, reuse the recorded verification evidence rather than re-running the check.
- In monorepos, run package-scoped checks (`--filter`, `-p`, target paths) for isolated slice verification; expand to downstream dependents ($D \cup T$) during **Stage 9 (Final Integration Verification)** or when shared core packages change.

### Step 3: Execute Checks & Differentiate Baseline Failures
Run each selected command and record the exact exit code and output summary:
- **`PASS`**: Command executed and exited `0` with assertions passing.
- **`FAIL`**: Command exited non-zero. Immediately determine whether the failure is:
  - **`NEW` (Regression)**: Caused by or related to the current task's changes $\rightarrow$ blocks Gate C; route to `dl-diagnose`.
  - **`BASELINE` (Pre-existing)**: Verified to exist on untouched code/branch outside the task scope $\rightarrow$ document evidence clearly and report to user without falsely claiming the check passed.
- **`SKIPPED`**: Check exists in repo but is intentionally skipped as inapplicable to the change (e.g., E2E browser suite for a pure backend CLI doc fix). **Must include explicit reason.**
- **`NOT_RUN`**: Check is applicable but has not yet been executed. **Cannot mark task `DONE` while required checks remain `NOT_RUN`.**
- **`BLOCKED`**: Check cannot run due to missing credentials, unavailable external service, sandbox restriction, or missing environment binary. **Must include blocker evidence.**

### Step 4: Final Integration Verification (`Stage 9`)
When all slices are complete:
1. Verify cross-component and cross-package contracts (exports, types, schemas, API payloads).
2. Run impacted integration/regression tests across affected packages and their dependents.
3. Verify every acceptance criterion (`AC-1..AC-n`) has direct verification evidence.
4. Run `node "<plugin-root>/scripts/lifecycle-check.mjs" "<workspace-path>"` (when available) to audit repository cleanliness and DoD readiness.

---

## 4. Expected Outputs

Produce a structured **Verification Evidence** table (inline for `Quick` mode; saved to session artifact `verification-evidence.md` for `Standard`/`Deep` mode) containing:
- **Gate C & Stage 9 Verdict**: `PASS` | `FAIL` | `BLOCKED`
- **Per-Check Status**: `PASS` | `FAIL` | `SKIPPED` | `NOT_RUN` | `BLOCKED` with command, scope, origin (`NEW` vs `BASELINE`), and reason/evidence.
- **Metrics**: Verification Coverage summary and Redundant Check Executions avoided.

---

## 5. Completion Conditions

`dl-verify` completes when all applicable checks for the current stage have been executed (or explicitly recorded as `SKIPPED`/`BLOCKED` with justification) and **Gate C** / **Stage 9** status is determined.

---

## 6. Safety Boundaries

- **Never claim a test passed without running it.** Unexecuted checks are `NOT_RUN` or `SKIPPED`, never `PASS`.
- Never hide a material `FAIL` or `BLOCKED` check behind an overall green summary.
