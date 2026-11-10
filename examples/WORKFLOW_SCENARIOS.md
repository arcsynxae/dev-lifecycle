# DevLifecycle v2 — Workflow Scenarios (Scenarios A–J)

Each scenario below is backed by executable tests in [`tests/run-tests.mjs`](../tests/run-tests.mjs).

---

## Scenario A — Small Bug Fix (`Quick` Mode)
- **User Request**: *"Fix the off-by-one formatting bug in `src/utils/duration.ts` where `formatDuration(60)` returns `0m 60s` instead of `1m 0s`."*
- **Discovery & Classification**:
  - `classify-task.mjs` scores `0` across all 8 risk dimensions (1 file, no security/DB/prod impact) $\rightarrow$ selects **`Quick`** mode.
- **Execution**:
  - Implicit Definition of Ready (`Gate A: PASS`).
  - Single primary agent edits `src/utils/duration.ts` and adds a unit test case in `src/utils/duration.test.ts` (`Gate B: PASS`).
  - Runs targeted unit test `npx vitest run src/utils/duration.test.ts` (`PASS`); marks full E2E browser suite `SKIPPED (Pure formatting helper fix)`.
  - Produces a concise inline completion report (`State: DONE`, `Agent Delegation: single-agent-optimal`).

---

## Scenario B — Standard Feature (`Standard` Mode)
- **User Request**: *"Add pagination (`?page` and `?limit`) to `GET /api/projects` and wire pagination controls into `ProjectTable.tsx`."*
- **Discovery & Classification**:
  - Affects 5 files across 2 packages (`packages/api`, `packages/web`) $\rightarrow$ selects **`Standard`** mode.
- **Execution**:
  - Documents `Task Contract` (`AC-1`: API query validation & paginated response; `AC-2`: UI pagination controls) and 2-slice `Execution Plan` in session artifacts.
  - Builds Slice 1 (API route + integration tests) $\rightarrow$ verifies `api` package (`PASS`).
  - Builds Slice 2 (UI component + component test) $\rightarrow$ verifies `web` package (`PASS`).
  - Runs `dl-review` (`Gate D: PASS` after resolving 1 `MEDIUM` finding), runs Stage 9 Final Integration check across `api` + `web`, verifies 10-point DoD (`Gate E: PASS`), and emits structured `Delivery Record` (`State: DONE`).

---

## Scenario C — Complex Architectural Change (`Deep` Mode + Safety Floor)
- **User Request**: *"Migrate JWT session storage and database schema to support multi-tenant RBAC permissions (do this in Quick mode)."*
- **Classification & Safety Floor**:
  - Triggers high-risk factors (`securitySensitivity: 3`, `databaseChanges: 3`, `productionImpact: 3`, `breakingContract: 3`, 4 packages).
  - Even though the user requested `Quick` mode, `classify-task.mjs` enforces `safetyFloorEnforced: true` and selects **`Deep`** mode.
- **Execution**:
  - Consults read-only `software-architect` to map dependency-ordered slices and DB migration rollback procedures.
  - Delegates independent read-only review to `code-reviewer` and `security-reviewer` at Gate D.
  - Requires explicit human approval (`force_ask`) before any migration deployment.

---

## Scenario D — Monorepo Affected-Package Intelligence
- **Context**: `pnpm` + `Turborepo` monorepo with `@acme/core`, `@acme/ui` (depends on `@acme/core`), and `@acme/web` (depends on `@acme/ui`).
- **Behavior**:
  1. **Leaf Change (`apps/web/src/App.tsx`)**: `discover-project.mjs` sets `verificationScope: "package-focused"` (`['@acme/web']`).
  2. **Shared Package Change (`packages/core/src/index.ts`)**: `discover-project.mjs` traverses internal dependency edges and sets `verificationScope: "affected-and-dependents"` (`['@acme/core', '@acme/ui', '@acme/web']`).
  3. **Root Config Change (`tsconfig.base.json`)**: Expands `verificationScope` to `"workspace-wide"`.

---

## Scenario E — Unknown / Custom Framework (`Void`)
- **Context**: Repository contains `void.config.mjs`, `@void-engine/core` in `package.json`, `AGENTS.md` instructions, and a single unused `express` utility dependency without any Express server config.
- **Behavior**:
  - `discover-project.mjs` reads `AGENTS.md`, identifies `void (@void-engine/core)` as a custom framework with `HIGH` confidence, extracts `npm test` (`void-cli verify --suite unit`), and **refuses** to misclassify the project as `Express` from a single dependency alone (recording it under `assumptions`).

---

## Scenario F — Repeated Verification Failure & Bounded Recovery
- **Context**: A unit test fails repeatedly after slice implementation.
- **Behavior**:
  - `dl-diagnose` (`evaluateBoundedRecovery` & `post-tool-tracker.mjs`) allows focused root-cause repair on attempts 1, 2, and 3.
  - Upon the 3rd consecutive failure of the same check, `escalationRequired` becomes `true` and state transitions to `BLOCKED` (`ESCALATE_BOUND_REACHED`), halting speculative edits and reporting diagnostic evidence to the user.

---

## Scenario G — Redundant CI & Check Deduplication
- **Context**: `.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, `npm test`, and `npm run build` twice across jobs without dependency caching.
- **Behavior**:
  - `analyzeCiWorkflows` identifies the duplicate `lint`, `test`, and `build` executions and missing dependency cache, recommending artifact reuse and setup-node caching while preserving mandatory branch-protection status checks.
  - Locally, `post-tool-tracker.mjs` flags immediate duplicate executions of already-passing checks (`redundantCheckExecutions`).

---

## Scenario H — Sensitive Operations & Permission Boundaries
- **Behavior**:
  - `rm -rf /`, `git push --force origin main`, `git commit --no-verify` $\rightarrow$ **`deny`**
  - `wrangler deploy --env production`, `npx prisma migrate deploy`, `gh pr merge`, editing `.env.production` $\rightarrow$ **`force_ask`**
  - `git push origin feat/x`, `gh pr create`, `git reset --hard` $\rightarrow$ **`ask`**
  - `npm test`, `git status`, editing `src/index.ts` $\rightarrow$ **`allow`**

---

## Scenario I — Clean Delivery & Definition of Done
- **Behavior**:
  - `checkCleanRepository` detects task-created `debug-output.log` and `.env.production` while preserving pre-existing intentional user files (`src/user-notes.bak`).
  - `evaluateLifecycleDelivery` blocks `DONE` if any applicable check is left `NOT_RUN` or `FAIL`, transitioning to `DONE` only when all 10 DoD criteria hold.

---

## Scenario J — Missing Optional Integrations
- **Behavior**:
  - On a bare C/Makefile project with no `package.json`, no GitHub Actions, no MCP servers, and no `/swarm` or `/teamwork`, `discover-project.mjs`, `classify-task.mjs`, `lifecycle-check.mjs`, and all hooks execute cleanly without errors.
