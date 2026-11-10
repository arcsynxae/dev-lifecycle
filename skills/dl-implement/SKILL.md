---
name: dl-implement
description: >-
  Focused, minimal-diff implementation of planned engineering slices (Stage 5 / Gate B). Enforces simplicity first, adherence to existing project conventions, preservation of user modifications, proportional test authoring, and clean repository hygiene. Use when writing or modifying code for a defined task or slice.
---

# `dl-implement` — Focused Slice Implementation

Execute **Stage 5 (Build)** and enforce **Gate B (Implementation Integrity)**: produce the smallest, clearest, most maintainable code change that satisfies the `Task Contract` and slice acceptance criteria.

---

## 1. Activation Conditions

Activate `dl-implement` when:
- **Gate A (Requirement Readiness)** is satisfied and a slice or `Quick` task is ready to be built.
- Applying a targeted fix identified during `dl-diagnose` or `dl-review`.
- The user invokes `/dl-implement` to execute an approved implementation plan.

---

## 2. Inputs

- **Task Contract & Active Slice Specification**: Objective, authorized files/components, acceptance criteria, and verification commands.
- **Project Context Profile**: Coding conventions, framework patterns, language version, and test structure.

---

## 3. Implementation Procedure

### Step 1: Pre-Edit Inspection & User Change Preservation (`P01`, `P04`, `P12`)
1. Inspect `git status` and `git diff` (when in a Git repository) before editing to identify any existing uncommitted user modifications.
2. Read the target files and their immediate callers/callees completely around the edit region.
3. **Never overwrite, revert, or reformat unrelated user changes** in the same or adjacent files.

### Step 2: Execute Minimal, Convention-Aligned Changes (`P03`, `P04`, `P05`, `P06`)
Implement one logical slice at a time (unless independent non-overlapping slices are safely delegated to isolated subagent workspaces):
- **Simplicity First (`P03`)**: Write direct, readable code. Do not introduce wrapper classes, generic factories, or configuration layers for single-use requirements.
- **Minimal Diff (`P04`)**: Touch only the lines required for the slice. Do not reorder imports, change quote styles, or refactor untouched functions unless required by the task.
- **Zero Unauthorized Dependencies**: Do not add packages to `package.json`, `Cargo.toml`, `pyproject.toml`, etc., unless explicitly authorized in the `Task Contract`.
- **Quality & Security by Design (`P06`)**:
  - Validate untrusted inputs at boundaries.
  - Handle errors explicitly using the project's established error/result pattern.
  - Never hardcode secrets, tokens, or environment-specific credentials.
  - Preserve existing comments and docstrings that remain accurate.

### Step 3: Add or Update Proportional Automated Tests (`P08`)
- For new features or behavioral changes: Add unit, integration, or contract tests in the repository's standard test location covering the acceptance criteria and key edge/error cases.
- For bug fixes: Add a regression test that reproduces the defect and passes with the fix.
- Match existing test runner conventions (`vitest`, `jest`, `node --test`, `pytest`, `cargo test`, `go test`, `phpunit`, etc.) — never introduce a second test framework.

### Step 4: Verify Gate B — Implementation Integrity
Before handing off to `dl-verify`:
1. Confirm every modified file belongs to the authorized scope in the `Task Contract`.
2. Remove any temporary scratch files, debug `console.log`/`print` statements, or commented-out experimental blocks introduced during coding (`P12`).
3. Run a quick syntax/type/unit check on the touched files.

---

## 4. Expected Outputs

- **Focused Code & Test Diff**: Clean, minimal modifications in the workspace.
- **Slice Implementation Summary**:
  - Files modified/created and symbols updated.
  - Mapping from changes to `Task Contract` acceptance criteria (`AC-1..AC-n`).
  - Gate B (`Implementation Integrity`) status: `PASS` | `FAIL`.

---

## 5. Completion Conditions

`dl-implement` completes for a slice when the code and corresponding tests are written, **Gate B** passes, temporary debug artifacts are removed, and the slice is ready for `dl-verify`.

---

## 6. Safety Boundaries

- Never modify generated lockfiles, build outputs (`dist/`, `build/`), or migrations by hand unless that is the explicit mechanism of the project.
- Never delete existing user files without explicit authorization.
- If an unexpected architectural blocker or conflicting requirement is discovered mid-slice, stop and update the `Task Contract` / `Execution Plan` rather than forcing a brittle workaround.
