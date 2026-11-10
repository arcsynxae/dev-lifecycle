# DevLifecycle v2 — Structured Engineering Artifact Contracts

Store session artifacts in `<appDataDir>/brain/<conversation-id>/` (or consolidate into the native Implementation Plan and Walkthrough artifacts). Never clutter the project repository with temporary markdown files.

---

## 1. Project Context Profile (`project-context-profile.md`)

```markdown
# Project Context Profile
- **Workspace Root**: `<path>`
- **Project Key / Worktree Key**: `<projectKey> / <worktreeKey>`
- **Git Revision / Branch**: `<sha> (<branch>)`
- **P13 Context Cache Status**: `HIT | MISS | INCREMENTAL_REFRESH | FULL_REFRESH | FALLBACK_SESSION` (Storage: `<plugin-data|os-user-cache|session-fallback|memory-only>`)
- **Sections Reused vs. Refreshed**: Reused `[...]`, Refreshed `[...]`
- **Supporting Evidence Fingerprints**: `<manifest/lockfile/config/ci hashes>`
- **Repository Topology**: `standalone | monorepo (<manager>) | multi-package`
- **Languages & Runtimes**: `<verified languages + versions>`
- **Frameworks & Libraries**: `<framework (evidence files, confidence: HIGH|MEDIUM|LOW)>`
- **Package / Build Managers**: `<npm|pnpm|yarn|bun|cargo|uv|poetry|go|gradle|maven|none>`
- **Application & Package Boundaries**:
  - `<pkg-name>` (`<path>`): depends on `[...]`
- **Verification Commands**:
  - Format: `<cmd or N/A>`
  - Lint: `<cmd or N/A>`
  - Typecheck: `<cmd or N/A>`
  - Unit Test: `<cmd or N/A>`
  - Integration / E2E: `<cmd or N/A>`
  - Build: `<cmd or N/A>`
- **CI/CD & Deployment**: `<provider, workflow files, deploy target>`
- **Coding Conventions & Local Rules**: `<summary from AGENTS.md / linter / tsconfig>`
- **Live Task-Specific Files Inspected**: `<paths + live SHA-256>`
- **Known Constraints & Unresolved Assumptions**: `<list>`
```

---

## 2. Task Contract (`task-contract.md`)

```markdown
# Task Contract
- **Intended Outcome**: `<1-2 sentence goal>`
- **Execution Profile**: `Quick | Standard | Deep` (Risk Score: `<score>`, Safety Floor Applied: `true|false`)
- **Authorized Scope**: `<files/packages/modules in scope>`
- **Out of Scope**: `<explicit exclusions>`
- **Functional Requirements**:
  - `FR-1`: `<requirement>`
- **Nonfunctional Requirements**:
  - `NFR-1`: `<security / performance / compatibility / reliability>`
- **Testable Acceptance Criteria**:
  - `AC-1`: `<verifiable condition>`
  - `AC-2`: `<verifiable condition>`
- **Assumptions & Risks**:
  - `<assumption or risk + mitigation>`
- **Definition of Ready (Gate A)**: `PASS | BLOCKED`
```

---

## 3. Execution Plan (`implementation_plan.md`)

```markdown
# Execution Plan
## Slice 1: `<Slice Title>`
- **Objective**: `<goal>`
- **Dependencies**: `<none or prior slices/packages>`
- **Expected Changes**: `<files/components>`
- **Acceptance Criteria**: `AC-1`
- **Verification Strategy**: `<exact commands>`
- **Risks**: `<slice-specific risk>`
```

---

## 4. Verification Evidence (`verification-evidence.md`)

```markdown
# Verification Evidence (Gate C & Stage 9)
- **Revision Evaluated**: `<git sha or working-tree state>`
- **Gate C Status**: `PASS | FAIL | BLOCKED`

| Check Category | Command / Procedure | Scope | Result (`PASS`/`FAIL`/`SKIPPED`/`NOT_RUN`/`BLOCKED`) | Origin (`NEW`/`BASELINE`/`N/A`) | Evidence / Reason |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Typecheck | `npm run typecheck` | `@app/core` | `PASS` | `N/A` | Exit 0 (1.2s) |
| Unit Tests | `npm test` | `@app/core` | `PASS` | `N/A` | 14/14 passing |
| E2E Browser | — | — | `SKIPPED` | `N/A` | Backend-only utility change |
```

---

## 5. Review Findings (`review-findings.md`)

```markdown
# Review Findings (Gate D)
- **Reviewer Mode**: `Self-Audit | Independent Subagent (code-reviewer / security-reviewer)`
- **Gate D Status**: `PASS | FAIL`

| ID | Severity (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`/`NIT`) | Component / `File:Line` | Finding & Evidence | Recommended Correction | Status (`RESOLVED`/`OPEN`/`ESCALATED`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
```

---

## 6. Delivery Record (`walkthrough.md` / `delivery-record.md`)

```markdown
# Delivery Record (Gate E & Gate F)
- **Task Summary**: `<concise summary>`
- **Lifecycle State**: `READY | IN_PROGRESS | BLOCKED | VERIFICATION_FAILED | READY_FOR_REVIEW | DONE | READY_FOR_RELEASE | RELEASED | PRODUCTION_VERIFIED`
- **Execution Profile**: `Quick | Standard | Deep`
- **Changed Components & Files**: `<list>`

## Acceptance Criteria Traceability
| ID | Criterion | Status (`SATISFIED`/`UNSATISFIED`/`BLOCKED`) | Verification Evidence |
| :--- | :--- | :--- | :--- |

## Progressive Quality Gates Summary
- **Gate A (Requirement Readiness)**: `PASS`
- **Gate B (Implementation Integrity)**: `PASS`
- **Gate C (Verification Integrity)**: `PASS`
- **Gate D (Review Integrity)**: `PASS`
- **Gate E (Delivery Integrity / DoD)**: `PASS`
- **Gate F (Release Integrity)**: `SKIPPED (Not in scope)`

## Engineering Metrics
- **Acceptance Criteria Completion**: `<X/Y (100%)>`
- **Verification Coverage**: `<PASS: a, FAIL: b, SKIPPED: c, NOT_RUN: d, BLOCKED: e>`
- **Blocking Defects**: `<0 unresolved>`
- **Change Scope Integrity**: `<100% within authorized scope>`
- **Task Cycle Time**: `<measured duration or N/A>`
- **Repair Iterations**: `<count>`
- **Review Rework**: `<count of actionable findings fixed>`
- **Redundant Check Executions Avoided**: `<count>`
- **Agent Delegation Efficiency**: `<single-agent | justified delegation summary>`

## Context Intelligence Metrics (P13)
- **Cache Hit Rate**: `<X% (hits / total lookups)>`
- **Full Discovery Avoidance**: `<X% (hits + incremental refreshes / total lookups)>`
- **Incremental Refresh Rate**: `<X% (targeted section refreshes / total refreshes)>`
- **Invalidation Accuracy**: `<changed signals -> exact invalidated sections>`
- **Context Load Cost**: `<measured durationMs + filesFingerprinted vs full scan>`
- **Stale Context Incidents**: `<0>`

## Remaining Issues, Limitations & Next Action
- **Remaining Issues / Limitations**: `<none or explicit list>`
- **Release Status**: `<uncommitted | committed | PR open | released | production verified>`
- **Recommended Next Action**: `<next step>`
```
