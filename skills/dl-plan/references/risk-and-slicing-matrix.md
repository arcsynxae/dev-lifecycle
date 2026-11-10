# Risk Classification & Slicing Matrix

## 1. Eight-Factor Risk Evaluation Matrix

Score each dimension from `0` (None/Low), `1` (Moderate), to `3` (High/Critical):

| Risk Factor | `0` (Low) | `1` (Moderate) | `3` (High — Safety Floor Trigger) |
| :--- | :--- | :--- | :--- |
| **1. Security Sensitivity** | UI copy, internal pure helper, docs | Input validation, non-sensitive API route | AuthN/AuthZ, crypto, tokens, secrets, permissions, CORS/CSP, raw shell/SQL |
| **2. Database / Persistence** | Stateless logic | New non-breaking query or index | Schema migration, destructive DDL, data backfill, state format change |
| **3. Production Impact** | Local dev / test-only | Non-critical config or build script | Production deployment config, CI/CD release pipeline, infra-as-code, runtime env |
| **4. Affected Components** | 1–2 files in 1 module | 3–8 files across 1–2 modules/packages | >8 files, >2 monorepo packages, or shared foundational core library |
| **5. Dependency Complexity** | Zero dependency changes | Minor/patch bump or internal wiring | New external dependency, major version upgrade, lockfile/workspace overhaul |
| **6. Backward Compatibility** | Internal implementation detail | Additive optional parameter/endpoint | Breaking public API, CLI flag removal, wire/event contract change |
| **7. Destructive Potential** | Purely additive / reversible | Overwriting internal module logic | File/data deletion, force-push, state reset, irreversible external mutation |
| **8. Technical Uncertainty** | Well-known pattern in repo | Minor new module following repo patterns | Unknown framework behavior, complex concurrency, unverified external integration |

### Profile Selection Rules
- **Safety Floor Rule**: If **any** factor scores `3`:
  - Profile cannot be `Quick`.
  - If total score $\ge 6$ or $\ge 2$ factors score `3` $\rightarrow$ **`Deep`**.
  - Otherwise $\rightarrow$ **`Standard`** (with mandatory domain review, e.g. `security-reviewer` if Factor 1 = 3).
- **Total Score $0 - 1$** (and zero `3`s): **`Quick`**
- **Total Score $2 - 5$** (and zero `3`s): **`Standard`**
- **Total Score $\ge 6$**: **`Deep`**

---

## 2. Slicing Guidelines by Profile

| Aspect | `Quick` | `Standard` | `Deep` |
| :--- | :--- | :--- | :--- |
| **Recommended Slices** | 1 direct change | 1–3 logical slices | 2–6 dependency-ordered slices |
| **Artifact Output** | Inline summary only | Session `implementation_plan.md` | Session `implementation_plan.md` + impact/rollback matrix |
| **Subagent Delegation** | None (single primary agent) | Optional `code-reviewer` at Gate D | `software-architect` (design), `code-reviewer` + `security-reviewer` (Gate D) |
| **Verification Scope** | Targeted test / typecheck on touched file | Affected module unit + integration + lint + typecheck | Full affected package graph ($D \cup T$) + build + security + regression suite |
