---
name: dl-diagnose
description: >-
  Structured failure characterization, root-cause analysis, failure taxonomy classification, and bounded recovery (Stage 7). Enforces a strict maximum of 3 focused repair attempts per root cause before transparent escalation. Use when tests, builds, typechecks, linters, or runtime executions fail.
---

# `dl-diagnose` — Root-Cause Analysis & Bounded Recovery

Execute **Stage 7 (Diagnose and Recover)**: systematically isolate the root cause of verification or runtime failures, apply minimal targeted repairs within bounded retries, and escalate transparently when blocked.

---

## 1. Activation Conditions

Activate `dl-diagnose` when:
- Any check in `dl-verify` (typecheck, lint, unit/integration test, build) returns `FAIL` or `BLOCKED`.
- The user invokes `/dl-diagnose` to debug a bug, failing test, build error, or CI failure.
- A runtime error or regression occurs during slice implementation.

---

## 2. Inputs

- **Failure Evidence**: Exact command executed, exit code, stdout/stderr logs, stack trace, and failing file/line locations.
- **Recent Diff / Slice Context**: Changes made since the last passing state.
- **Repair Attempt Counter**: Current attempt number ($1, 2, \text{or } 3$) for this specific failure signature.

---

## 3. Diagnostic & Recovery Procedure

### Step 1: Reproduce & Characterize the Failure
1. Read the complete error message, stack trace, and failing test/source lines before forming a hypothesis (`P01`, `P07`).
2. Classify the failure into one of the **7 DevLifecycle Failure Categories**:
   - **`IMPLEMENTATION_DEFECT`**: Bug, type mismatch, or broken assertion caused by the current task's code changes.
   - **`BASELINE_FAILURE`**: Pre-existing failure in untouched repository code that already failed prior to the task's changes.
   - **`MISSING_DEPENDENCY`**: Uninstalled package, out-of-sync lockfile, or unbuilt upstream workspace package in a monorepo.
   - **`EXTERNAL_SERVICE_UNAVAILABLE`**: Network timeout, unreachable third-party API, or down local container/DB.
   - **`PERMISSION_RESTRICTION`**: Sandbox block, OS file permission, or ungranted GitHub/cloud credential.
   - **`ENVIRONMENT_CONFIG`**: Missing environment variable, wrong runtime version, or OS path separator mismatch.
   - **`UNSUPPORTED_CAPABILITY`**: Platform or runtime feature not available in the current environment.

### Step 2: Route by Failure Category
- If **`PERMISSION_RESTRICTION`**, **`EXTERNAL_SERVICE_UNAVAILABLE`**, or **`UNSUPPORTED_CAPABILITY`**:
  - Do **not** waste repair iterations changing application code.
  - Transition immediately to `BLOCKED` (or request the required permission once if appropriate) and report the exact blocker and remediation steps.
- If **`BASELINE_FAILURE`**:
  - Verify via `git diff` / `git stash` inspection or scope analysis that the failure is unrelated to the current change.
  - Document it as `BASELINE` in `Verification Evidence` and ask the user whether bringing the baseline fix into scope is desired.
- If **`IMPLEMENTATION_DEFECT`**, **`MISSING_DEPENDENCY`**, or fixable **`ENVIRONMENT_CONFIG`**:
  - Proceed to **Step 3 (Bounded Repair Loop)**.

### Step 3: Bounded Repair Loop (Default Max = 3 Focused Attempts)
For each attempt ($k \in \{1, 2, 3\}$):
1. **State Hypothesis & Evidence**: Identify the single most likely root cause supported by stack trace / code inspection.
2. **Apply Focused Correction**: Make the smallest code or config fix addressing that root cause (`P04`). Never make shotgun/speculative edits across multiple unrelated files.
3. **Re-Verify Targeted Check**: Run the specific failing check first, followed by impacted slice checks (`dl-verify`).
4. **Evaluate Outcome**:
   - If `PASS`: Record `Repair Iterations = k` and return to the normal lifecycle flow.
   - If `FAIL` with the same root cause and $k = 3$: **STOP immediately.** Do not attempt a 4th speculative fix.

### Step 4: Transparent Escalation When Blocked
When the 3-attempt bound is reached or an unrecoverable blocker is hit:
1. Ensure the working tree is left in a safe, non-corrupted state (revert ineffective speculative edits from failed attempts while preserving verified slices).
2. Set lifecycle state to `BLOCKED` or `VERIFICATION_FAILED`.
3. Produce a **Diagnostic Escalation Report** containing:
   - **Failure Category & Root Cause Summary**
   - **Reproducible Command & Error Output**
   - **Attempts Made ($1..3$) & What Each Attempt Proved**
   - **Recommended Next Action / Decision Needed from User**

---

## 4. Expected Outputs

- **Resolved Case**: Minimal root-cause fix, passing verification output, and updated `Repair Iterations` metric.
- **Escalated / Blocked Case**: Structured **Diagnostic Escalation Report** with lifecycle state `BLOCKED` or `VERIFICATION_FAILED`.

---

## 5. Completion Conditions

`dl-diagnose` completes when the failing check passes verification (`PASS`) OR when the task cleanly escalates (`BLOCKED` / `VERIFICATION_FAILED`) with complete diagnostic evidence.

---

## 6. Safety Boundaries

- **Never delete, comment out, or weaken assertions in a legitimate test just to make verification pass.**
- **Never loop past 3 unsuccessful repair attempts** on the same failure without user guidance.
