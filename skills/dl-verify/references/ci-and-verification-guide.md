# Proportional Verification Matrix & CI/CD Optimization Guide

---

## 1. Check Selection Matrix by Execution Profile

| Check Category | `Quick` Mode | `Standard` Mode | `Deep` Mode |
| :--- | :--- | :--- | :--- |
| **Syntax / Typecheck** | Touched files / package | Affected package(s) | All affected + downstream packages ($D \cup T$) |
| **Linter / Formatter** | Touched files | Affected package(s) | Workspace-wide or $D \cup T$ |
| **Unit Tests** | Targeted test file(s) | Affected module/package test suite | Full affected + dependent package suites |
| **Integration / Contract Tests** | `SKIPPED` (unless bug is in integration layer) | Run for affected API/DB/service boundaries | Mandatory across all impacted service boundaries |
| **Build Verification** | `SKIPPED` (unless build/export touched) | Run for affected app/package | Full affected build graph verification |
| **Security / Audit Checks** | `SKIPPED` (safety floor prevents security tasks in Quick) | Run when inputs, dependencies, or routes change | Mandatory (`security-reviewer` + static/dep checks) |
| **Browser / A11y Checks** | Only if visual UI bug fix | Run when UI components/pages change | Full interactive flow + accessibility verification |

---

## 2. CI/CD Efficiency & Duplicate Check Detection (Section 14)

When inspecting CI pipelines (such as `.github/workflows/*.yml`), check for these common inefficiencies:

1. **Duplicate Quality Checks**:
   - The same `npm run lint`, `tsc --noEmit`, or `npm test` executed identically across multiple jobs or workflows triggered on the same event (`push` + `pull_request` on the same branch without branch/event deduplication).
2. **Repeated Dependency Installations & Missing Caches**:
   - Multiple jobs running `npm ci` / `pnpm install` / `pip install` without `actions/setup-node` (`cache: 'pnpm'|'npm'`) or `actions/cache`.
3. **Redundant Full Builds**:
   - Rebuilding the same production bundle in `lint`, `test`, and `deploy` jobs instead of building once or sharing build artifacts (`actions/upload-artifact` / `actions/download-artifact`) or using Turborepo/Nx remote caching.
4. **Unscoped Monorepo CI**:
   - Running every package's full test and build suite on a single-package documentation or leaf-package change when path filters or affected-graph runners (`turbo`, `nx affected`, `pnpm --filter ...[origin/main]`) are supported.

### Quality Evidence Reuse Rules
- Local or CI verification evidence may be reused **only** when:
  1. Git `HEAD` commit SHA and working-tree diff hash are identical.
  2. Relevant environment variables, lockfiles, and tool configurations are unchanged.
- **Never** bypass required GitHub branch-protection status checks or claim local passing tests substitute for mandatory remote CI gates during merge/release.
