---
name: dl-plan
description: >-
  Requirements definition (Task Contract), Definition of Ready (Gate A) validation, risk-based execution profile classification (Quick, Standard, Deep), and dependency-aware slice planning (Execution Plan). Use before implementation to align scope, acceptance criteria, and verification strategy.
---

# `dl-plan` — Outcome Definition, Risk Classification & Slice Planning

Translate user requests and verified project context into a clear **Task Contract** (`Stage 2`), select an appropriate **Execution Profile** (`Stage 3`), and design a proportional **Execution Plan** (`Stage 4`).

---

## 1. Activation Conditions

Activate `dl-plan` when:
- Transitioning from discovery (`dl-discover`) to implementation.
- A task is ambiguous, medium/high-risk, or spans multiple components/files.
- The user invokes `/dl-plan` or asks to scope, classify, or break down a task into verifiable slices.

---

## 2. Inputs

- **User Request**: Feature, bug fix, architectural change, or refactoring objective.
- **Project Context Profile**: Output from `dl-discover`.
- **Optional User Profile Preference**: Requested mode (`Quick`, `Standard`, or `Deep`).

---

## 3. Planning Procedure

### Step 1: Define the Task Contract (`Stage 2`)
Establish:
1. **Intended Outcome**: Concrete engineering result in 1–2 sentences.
2. **Functional & Nonfunctional Requirements**: Explicit capabilities plus security, performance, reliability, compatibility, and testability expectations (`P06`).
3. **Scope Boundaries**:
   - **In Scope**: Exact modules, packages, or files authorized for change.
   - **Out of Scope**: Unrelated refactorings, unrequested features, or adjacent systems (`P04`).
4. **Testable Acceptance Criteria (`AC-1..AC-n`)**: Observable, verifiable conditions that prove completion (`P02`).
5. **Assumptions & Risks**: Clearly separate verified requirements from reasonable implementation assumptions.

### Step 2: Evaluate Gate A — Definition of Ready (DoR)
Verify all 6 readiness criteria:
- [ ] Clear intended outcome
- [ ] Identified scope
- [ ] Testable acceptance criteria
- [ ] Known relevant constraints
- [ ] Reasonable implementation assumptions documented
- [ ] High-impact risks understood

**Clarification Policy**:
- Do **not** interrupt the user for minor details that can be safely inferred from repository conventions (`P01`).
- **Stop and ask the user** when an unresolved decision materially impacts correctness, security, data integrity, external cost, or public API/architecture.

### Step 3: Classify Execution Profile (`Stage 3`)
Evaluate the 8 risk dimensions (or run `node "<plugin-root>/scripts/classify-task.mjs"` — see [risk-and-slicing-matrix.md](./references/risk-and-slicing-matrix.md)):
1. Security / authentication / authorization / secret sensitivity
2. Database schema / data migration / state persistence changes
3. Production / deployment / infrastructure impact
4. Number of affected components / packages / files
5. Dependency changes (new packages, major upgrades, shared core library changes)
6. Backward compatibility (public API, CLI contract, wire protocol)
7. Destructive / irreversible potential
8. Unknown technical constraints or unfamiliar domain behavior

Select the execution profile:
- **`Quick`**: Low risk across all dimensions, 1–2 files affected, well-understood local change.
- **`Standard`**: Moderate scope (2–8 files or 1–2 packages), clear requirements, standard feature or multi-file bug fix.
- **`Deep`**: Any high-risk dimension triggered (security, DB migration, production config, breaking contract, destructive potential, >2 packages or architectural redesign).

> **Mandatory Safety Floor**: High-risk tasks **MUST NEVER** silently downgrade to `Quick` mode, even if the diff is small (e.g., a 3-line auth bypass fix or production migration script must run at least `Standard` or `Deep` verification and review).

### Step 4: Construct the Proportional Execution Plan (`Stage 4`)
- **For `Quick` Mode**:
  - Do not create heavy planning files. State the focused change target and verification command in 2–4 concise lines.
- **For `Standard` & `Deep` Modes**:
  - Decompose work into coherent, independently verifiable slices (`Slice 1..Slice K`).
  - Avoid artificial fragmentation: never split a cohesive 20-line change into 4 slices (`P05`).
  - For each slice, specify:
    - **Objective**
    - **Dependencies** (prerequisite slices or packages)
    - **Expected Changes** (target files/symbols)
    - **Acceptance Criteria Covered** (`AC-x`)
    - **Verification Strategy** (exact project commands to run after the slice)
    - **Relevant Risks & Rollback/Mitigation**
  - For `Deep` mode, consult the read-only `software-architect` subagent when cross-package impact or contract design warrants an independent architectural check.

---

## 4. Expected Outputs

- **Gate A Verdict**: `PASS` (`READY`) or `BLOCKED` (awaiting user decision on material ambiguity).
- **Selected Execution Profile**: `Quick` | `Standard` | `Deep` with risk rationale.
- **Task Contract & Execution Plan**: Written to the native session `implementation_plan.md` artifact (for `Standard`/`Deep`) or concise inline summary (for `Quick`).

---

## 5. Completion Conditions

`dl-plan` completes when **Gate A (Requirement Readiness)** is `PASS`, the execution profile is selected, and a proportional plan with verifiable acceptance criteria is ready for `dl-implement`.

---

## 6. Safety Boundaries

- Never modify application source code during `dl-plan`.
- Never pad plans with speculative future features, unrequested abstractions, or checklist-only documentation tasks (`P03`).
