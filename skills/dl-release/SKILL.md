---
name: dl-release
description: >-
  Clean delivery preparation (Stage 10 / Gate E) and controlled Git, CI/CD, PR, release, and deployment execution (Stage 11 / Gate F). Separates code completion from publication and enforces independent human authorization for commit, push, PR, merge, release, and deploy actions. Use when preparing final delivery or executing authorized release workflows.
---

# `dl-release` — Clean Delivery & Controlled Release Execution

Execute **Stage 10 (Deliver / Gate E)** and, only when explicitly in scope and authorized, **Stage 11 (Release / Gate F)**.

---

## 1. Activation Conditions

Activate `dl-release` when:
- Implementation, verification (`Gate C`), review (`Gate D`), and final integration (`Stage 9`) are complete and the task is ready for final delivery (`Stage 10`).
- The user invokes `/dl-release` or explicitly asks to prepare a release, optimize CI/CD checks, create a commit/PR, or deploy verified changes.

---

## 2. Inputs

- **Verified Workspace State**: Working tree passing Gate C, Gate D, and Stage 9.
- **Verification Evidence & Review Findings**: Collected evidence from earlier stages.
- **Explicit User Authorization Scope**: Which specific operations (if any) are authorized among `commit`, `push`, `pr`, `merge`, `release`, `deploy`.

---

## 3. Delivery & Release Procedure

### Part A: Stage 10 — Clean Delivery & Gate E (Always Executed)
1. **Clean Repository Audit (`P12`)**:
   - Run `git status` and `git diff` (or `node "<plugin-root>/scripts/lifecycle-check.mjs" "<workspace-path>"`).
   - Remove any temporary scratch files, debug outputs, or test artifacts created during the task.
   - Verify no `.env`, credentials, or secret files are staged or untracked in the repo.
   - Confirm intentional pre-existing user changes are preserved intact.
2. **Definition of Done (10-Point Verification)**:
   Verify all 10 criteria before setting state to `DONE`:
   1. Required acceptance criteria satisfied.
   2. Implementation within authorized scope.
   3. Applicable quality checks `PASS`.
   4. Relevant regressions assessed.
   5. Zero unresolved blocking defects.
   6. Relevant documentation updated (only where meaningful).
   7. Temporary task artifacts cleaned up.
   8. Final changes coherent and reviewable.
   9. Verification evidence available.
   10. Remaining limitations and `SKIPPED`/`NOT_RUN` checks transparently disclosed.
3. **Produce the Structured `Delivery Record`**:
   - Summarize task outcome, execution profile, changed components, acceptance criteria status, Gate A–F statuses, **Outcome & Efficiency Metrics**, known limitations, release state (`DONE` / `READY_FOR_RELEASE`), and recommended next action.
   - **Stop here** if Git publication or deployment was not requested by the user.

### Part B: Stage 11 — Controlled Release & Gate F (Only When In Scope & Authorized)
Enforce **P10 (Human-Controlled Operations)**: treat each operation below as a separate gate requiring explicit user authorization:

| Action | Prerequisite Check | Required Authorization | Completion State Transition |
| :--- | :--- | :--- | :--- |
| **1. `commit`** | Gate E `PASS`; staged diff verified free of secrets/temp files | User requested or approved commit | `DONE` / `READY_FOR_RELEASE` |
| **2. `push`** | Local commit verified on target branch | Explicit user authorization to push (`git.create` / `git.update` permission) | `READY_FOR_RELEASE` |
| **3. `pr`** | Branch pushed; PR title/body includes `Delivery Record` summary | Explicit user authorization (`gh.create` permission with `-R ORG/REPO`) | `READY_FOR_RELEASE` |
| **4. `merge`** | Current `HEAD` revision CI status checks `PASS`; branch protection satisfied | Explicit user authorization (`gh.merge` permission) | `READY_FOR_RELEASE` |
| **5. `release`** | Target ref verified; changelog/version tags checked | Explicit user authorization | `RELEASED` |
| **6. `deploy`** | **Gate F**: Current-revision CI green, env/secrets verified, DB migration & rollback plan ready | Explicit user authorization for target environment (`staging` vs `production`) | `RELEASED` $\rightarrow$ `PRODUCTION_VERIFIED` (after post-deploy checks) |

### Step 4: Post-Deployment Verification
- Never claim a deployment succeeded unless the deployment command actually ran and exited `0`.
- Transition to `PRODUCTION_VERIFIED` **only** after executing post-deployment health, smoke, or endpoint verification checks and recording the evidence.
- If post-deployment checks fail, immediately enter incident triage: report evidence and recommend targeted repair or rollback.

---

## 4. Expected Outputs

- **Delivery Record**: Complete walkthrough/delivery report with traceability matrix, Gate A–F results, and Engineering Metrics.
- **Release Execution Evidence** (when Stage 11 is executed): Commit SHA, branch/PR URL, CI run status for current revision, deployment status, and post-deploy verification output.

---

## 5. Completion Conditions

`dl-release` completes when **Gate E** is `PASS` and the `Delivery Record` is delivered (`DONE`), or—when release actions are authorized—when the authorized Git/CI/deployment operations finish and reach `READY_FOR_RELEASE`, `RELEASED`, or `PRODUCTION_VERIFIED`.

---

## 6. Safety Boundaries

- Never chain `commit` $\rightarrow$ `push` $\rightarrow$ `merge` $\rightarrow$ `deploy` automatically unless the user explicitly authorized the entire chain upfront.
- Never reuse stale CI results from an older commit SHA to justify merging or deploying a newer commit.
- Never use `--no-verify` or force-push (`--force`) unless the user explicitly instructs and authorizes it.
