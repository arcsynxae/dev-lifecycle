---
name: dl-run
description: >-
  Adaptive end-to-end execution of the DevLifecycle v2 workflow (Discover -> Define -> Classify -> Plan -> Build -> Verify -> Review -> Integrate -> Deliver -> Release). Use when the user asks to execute a complete engineering task, implement a feature, fix a bug, or run DevLifecycle end-to-end.
---

# `dl-run` — Adaptive End-to-End Lifecycle Execution

Execute the **DevLifecycle v2** workflow proportionally to task complexity and risk, maximizing verified engineering outcomes while minimizing redundant work, execution time, and artifact bloat.

---

## 1. Activation Conditions

Activate `dl-run` when:
- The user invokes `/dl-run` or asks to run **DevLifecycle** on a task.
- A task spans multiple lifecycle phases (discovery, planning, coding, verification, review, and delivery).
- The user wants adaptive quality gates (`Gate A` through `Gate F`) and measurable engineering outcomes.

---

## 2. Inputs

- **User Request**: Feature specification, bug report, refactoring goal, or release task.
- **Target Repository / Workspace**: Active workspace directory.
- **Optional Execution Profile Override**: Explicit user request for `Quick`, `Standard`, or `Deep` mode (subject to the high-risk safety floor).
- **Optional Authorization Grants**: Explicit user permissions for Git (`commit`, `push`, `PR`, `merge`) or `release`/`deploy` actions.

---

## 3. Adaptive Workflow Responsibilities

### Phase 1: Discover & Define (Stages 1–2 | Gate A)
1. **Discover (`Stage 1`)**:
   - Check if a valid `Project Context Profile` already exists in the current session (`<appDataDir>/brain/<conversation-id>`).
   - If absent or invalidated by dependency/config edits, run discovery (`node ./scripts/discover-project.mjs <workspace-path>` or follow `dl-discover`) to identify languages, frameworks, versions, package/workspace managers, monorepo boundaries, commands, CI/CD, and repo instructions.
2. **Define (`Stage 2`)**:
   - Formulate the `Task Contract`: intended outcome, functional/nonfunctional requirements, authorized scope, constraints, testable acceptance criteria, assumptions, and out-of-scope items.
   - Evaluate **Gate A (Requirement Readiness / Definition of Ready)**:
     - Resolve minor ambiguities from repository evidence (`P01`).
     - Ask the user (`ask_question` or direct prompt) **only** when a missing decision materially affects correctness, security, cost, or architecture.

### Phase 2: Classify & Plan (Stages 3–4)
1. **Classify (`Stage 3`)**:
   - Run `node ./scripts/classify-task.mjs` (or apply the `dl-plan` risk matrix) across 8 risk factors: security sensitivity, DB/schema changes, production impact, affected component count, dependency complexity, backward compatibility, destructive potential, and unknown technical constraints.
   - Select profile:
     - **`Quick`**: Small, low-risk, localized changes (1–2 files, no security/DB/prod risk). Implicit DoR, inline plan, single agent, targeted check, concise inline report.
     - **`Standard`**: Typical feature or multi-file fix. Session artifact plan, slice execution, automated tests, targeted review, structured `Delivery Record`.
     - **`Deep`**: Architectural, cross-package, security-sensitive, DB migration, or production-critical work. Detailed dependency/impact plan, justified read-only subagent review (`software-architect`, `code-reviewer`, `security-reviewer`), broader regression checks, migration/rollback analysis.
   - **Safety Floor**: Never downgrade a task with high security, DB migration, production, or destructive risk to `Quick` mode, even if requested.
2. **Plan (`Stage 4`)**:
   - For `Quick`: State a concise 2–4 bullet approach inline.
   - For `Standard` / `Deep`: Write or update the session `Execution Plan` artifact with independently verifiable slices (Objective, Dependencies, Expected Changes, Acceptance Criteria, Verification Strategy, Risks). See [artifact-contracts.md](./references/artifact-contracts.md).

### Phase 3: Build, Verify, Diagnose & Review Loop (Stages 5–8 | Gates B, C, D)
For each slice in the `Execution Plan`:
1. **Build (`Stage 5` | `Gate B — Implementation Integrity`)**:
   - Implement one logical slice at a time (follow `dl-implement`), keeping diffs minimal, preserving existing user changes, and adding/updating tests where valuable.
2. **Targeted Verification (`Stage 6` | `Gate C — Verification Integrity`)**:
   - Run applicable project-defined checks for the affected scope (`dl-verify`).
   - Differentiate baseline failures from newly introduced regressions.
   - Avoid re-running identical checks when neither code, config, nor environment changed (`P09`).
3. **Diagnose & Recover (`Stage 7`)**:
   - If verification fails, follow `dl-diagnose`: reproduce, identify root cause, and apply a focused fix.
   - Enforce a **bounded retry limit of 3 attempts** per root cause. If still failing after 3 attempts, transition state to `BLOCKED` (or `VERIFICATION_FAILED`), record evidence, and escalate to the user.
4. **Review (`Stage 8` | `Gate D — Review Integrity`)**:
   - For `Quick`: Perform a fast self-audit of the diff against acceptance criteria.
   - For `Standard` / `Deep`: Execute `dl-review` (delegating to read-only `code-reviewer` and `security-reviewer` subagents when independent verification adds value).
   - Fix all `CRITICAL` and `HIGH` findings before advancing. Do not treat stylistic `NIT` items as blocking unless required by project linters.

### Phase 4: Final Integration, Delivery & Optional Release (Stages 9–11 | Gates E, F)
1. **Final Integration Verification (`Stage 9`)**:
   - After all slices complete, verify cross-component compatibility, shared contracts, downstream monorepo dependents, and full acceptance criteria compliance.
2. **Deliver (`Stage 10` | `Gate E — Delivery Integrity`)**:
   - Run `git status` and `git diff` (or `node ./scripts/lifecycle-check.mjs`) to verify the Clean Repository Policy (`P12`) and the 10-point **Definition of Done**.
   - Produce the evidence-based `Delivery Record` including **Outcome Metrics** and **Efficiency Metrics**.
   - Stop at `DONE` unless Git/PR/Release operations were explicitly requested and authorized.
3. **Release (`Stage 11` | `Gate F — Release Integrity`, Optional)**:
   - Only when in scope and explicitly authorized, execute `dl-release` for separated `commit`, `push`, `PR`, `merge`, `release`, or `deploy` actions.

---

## 4. Expected Outputs

- **Quick Mode**: Clean code diff, executed verification command output, and a concise inline completion summary with state (`DONE` / `BLOCKED`).
- **Standard / Deep Mode**: Session artifacts in `<appDataDir>/brain/<conversation-id>` following [artifact-contracts.md](./references/artifact-contracts.md) (`Project Context Profile`, `Task Contract`, `Execution Plan`, `Verification Evidence`, `Review Findings`, `Delivery Record`) plus a concise user-facing summary.

---

## 5. Completion Conditions

`dl-run` completes when:
- Task reaches `DONE` (all 10 Definition of Done criteria verified with evidence), OR
- Task reaches `READY_FOR_RELEASE` / `RELEASED` / `PRODUCTION_VERIFIED` (when Stage 11 is in scope and authorized), OR
- Task transitions to `BLOCKED` / `VERIFICATION_FAILED` with full diagnostic evidence and escalation report after bounded retries or an external/permission blocker.

---

## 6. Safety Boundaries

- Never fabricate test outputs, execution timings, token counts, or coverage percentages.
- Never write temporary lifecycle tracking markdown files into the user's repository tree.
- Never execute `git push`, `gh pr merge`, destructive file deletions, or production deployments without explicit user authorization.
