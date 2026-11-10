---
name: dl-review
description: >-
  Risk-appropriate specification, architecture, code quality, performance, and security review (Stage 8 / Gate D). Classifies findings by severity with actionable evidence and prevents endless review-rework loops. Use before final integration or delivery on Standard and Deep tasks, or when requested by the user.
---

# `dl-review` — Risk-Appropriate Specification, Code & Security Review

Execute **Stage 8 (Review)** and enforce **Gate D (Review Integrity)**: verify that the implementation satisfies the `Task Contract` cleanly, safely, and without unintended regressions.

---

## 1. Activation Conditions

Activate `dl-review` when:
- Targeted verification (`dl-verify` / Gate C) passes and the task is in `Standard` or `Deep` mode.
- A task touches security-sensitive, architectural, or cross-component code.
- The user invokes `/dl-review` or asks for a code, spec, or security review of current changes.

---

## 2. Inputs

- **Task Contract & Execution Plan**: Requirements, acceptance criteria, and authorized scope.
- **Code Diff**: `git diff` (staged and unstaged changes) and newly created files.
- **Verification Evidence**: Results from `dl-verify`.

---

## 3. Review Procedure

### Step 1: Select Proportional Review Mode (`P08`, `P09`)
- **`Quick` Mode**: Fast self-review against acceptance criteria and diff cleanliness (no subagent overhead).
- **`Standard` Mode**: Structured review across the 10 review dimensions; delegate to the read-only `code-reviewer` subagent when changes span multiple modules or complex business logic.
- **`Deep` Mode**: Mandatory independent review via read-only `code-reviewer` and (when auth, inputs, secrets, dependencies, DB, or CI/infra are touched) `security-reviewer` subagents.

### Step 2: Audit Across the 10 Review Dimensions
1. **Requirements Compliance**: Are all functional (`FR`) and nonfunctional (`NFR`) requirements and acceptance criteria (`AC`) satisfied?
2. **Functional Correctness**: Are edge cases, boundary inputs, async/concurrency semantics, and state transitions handled accurately?
3. **Architectural Consistency**: Does the change respect module boundaries, dependency direction, and existing repository patterns?
4. **Maintainability & Simplicity (`P03`)**: Is the code clear and free of speculative abstractions, dead code, or duplicated logic?
5. **Security (`P06`)**: Are inputs validated, outputs encoded, auth checks enforced, and secrets kept out of code/logs?
6. **Performance**: Are obvious $O(n^2)$ loops, N+1 queries, memory leaks, or unnecessary synchronous blocking operations avoided?
7. **Error Handling**: Are failures caught, typed/classified appropriately, and surfaced with actionable context?
8. **Test Quality**: Do tests verify real behavior and failure modes rather than tautological mocks?
9. **Unintended Regressions**: Could changes break existing callers, shared contracts, or backward compatibility?
10. **Change Scope Discipline (`P04`)**: Is the diff free of unrelated formatting, drive-by refactoring, or temporary files?

### Step 3: Classify Findings & Prevent Endless Rework Cycles
Assign each finding a strict severity:
- **`CRITICAL`** *(Blocking)*: Security vulnerability, data loss/corruption, crash, or broken core requirement.
- **`HIGH`** *(Blocking)*: Unmet acceptance criterion, functional bug, regression, missing critical error handling, or major scope violation.
- **`MEDIUM`** *(Conditional)*: Missing important edge-case test or localized maintainability defect. Fix if straightforward within scope; otherwise document in `Delivery Record`.
- **`LOW` / `NIT`** *(Non-Blocking)*: Stylistic preference or minor naming suggestion. **Never block Gate D on stylistic preferences unless enforced by project linter/standards.**

**Bounded Review Rework Policy**:
- Batch all blocking (`CRITICAL`/`HIGH`) findings into a single cohesive rework pass (`dl-implement` $\rightarrow$ `dl-verify`).
- Do not introduce new stylistic findings on subsequent passes to avoid endless review-implementation loops.

---

## 4. Expected Outputs

Produce a structured **Review Findings** report (inline summary or session artifact `review-findings.md`):
- **Gate D Status**: `PASS` (zero unresolved `CRITICAL`/`HIGH` defects) or `FAIL` (rework required).
- **Acceptance Criteria Audit Table**.
- **Categorized Findings**: `[Severity] [Component / File:Line] Issue & Evidence -> Recommended Fix -> Status`.
- **Metrics**: `Blocking Defects` count and `Review Rework` count.

---

## 5. Completion Conditions

`dl-review` completes when all 10 dimensions are evaluated, any blocking (`CRITICAL`/`HIGH`) defects are either resolved and re-verified or explicitly escalated to the user, and **Gate D** is `PASS` (or `BLOCKED`).

---

## 6. Safety Boundaries

- Reviewer subagents (`code-reviewer`, `security-reviewer`) must remain **read-only** so they never create conflicting edits with implementation agents.
- Never approve (`PASS`) a review when a known acceptance criterion is unmet or a `CRITICAL`/`HIGH` security defect remains open.
