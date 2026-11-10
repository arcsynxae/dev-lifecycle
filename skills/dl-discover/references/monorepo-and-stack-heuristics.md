# Monorepo & Multi-Stack Discovery Heuristics

Use these evidence rules to identify stacks, package managers, and monorepo boundaries accurately without false positives.

---

## 1. Package Manager & Lockfile Precedence

Never assume `npm` merely because `package.json` exists. Determine the authoritative package manager from lockfiles and `packageManager` fields:

| Ecosystem | Authoritative Evidence (Priority Order) | Workspace Config Evidence |
| :--- | :--- | :--- |
| **Node / JS / TS** | `package.json#packageManager` -> `pnpm-lock.yaml` (`pnpm`) -> `bun.lock` / `bun.lockb` (`bun`) -> `yarn.lock` (`yarn`) -> `package-lock.json` (`npm`) | `pnpm-workspace.yaml`, `package.json#workspaces`, `turbo.json`, `nx.json`, `lerna.json` |
| **Python** | `uv.lock` (`uv`) -> `poetry.lock` (`poetry`) -> `Pipfile.lock` (`pipenv`) -> `pdm.lock` (`pdm`) -> `pyproject.toml` -> `requirements*.txt` (`pip`) | `[tool.uv.workspace]`, `[tool.hatch.envs]`, multiple `pyproject.toml` |
| **Rust** | `Cargo.lock` + `Cargo.toml` (`cargo`) | `[workspace]` with `members = [...]` in root `Cargo.toml` |
| **Go** | `go.sum` + `go.mod` (`go`) | `go.work` (`use (...)`) |
| **PHP** | `composer.lock` + `composer.json` (`composer`) | Path repositories in `composer.json` |
| **JVM (Java/Kotlin)** | `gradlew` / `build.gradle*` (`gradle`) -> `mvnw` / `pom.xml` (`maven`) | `settings.gradle(.kts)` `include(...)`, `pom.xml` `<modules>` |
| **C/C++ / Polyglot / Custom** | `CMakeLists.txt`, `Makefile`, `BUILD.bazel` (`bazel`), `justfile`, `Taskfile.yml`, custom `./scripts/*` | Subdirectory `BUILD` / `CMakeLists.txt` targets |

---

## 2. Multi-Signal Framework Identification Rules

Do **not** classify a project's primary framework from a single transitive or utility dependency. Require at least two signals (Dependency + Config/Directory Structure):

- **Astro**: `astro` in `package.json` + `astro.config.{mjs,ts,js}` + `src/pages/` or `src/content/`.
- **Next.js**: `next` in `package.json` + `next.config.{js,mjs,ts}` + `app/` or `pages/`.
- **Nuxt**: `nuxt` in `package.json` + `nuxt.config.{ts,js}`.
- **SvelteKit / Svelte**: `@sveltejs/kit` or `svelte` + `svelte.config.js`.
- **Remix / React Router v7**: `@remix-run/*` or `@react-router/dev` + `vite.config.*` / `react-router.config.*`.
- **Hono / Express / Fastify / NestJS**: Framework dependency in `package.json` + server entry point importing router/app factory.
- **Laravel**: `laravel/framework` in `composer.json` + `artisan` + `app/Http/` or `routes/`.
- **Django / FastAPI / Flask**: Dependency in `pyproject.toml`/`requirements.txt` + `manage.py` (Django) or ASGI/WSGI app initialization.
- **Cloudflare Workers**: `wrangler.toml` or `wrangler.jsonc` + `wrangler` CLI / Worker entry script.
- **Unknown or Custom Frameworks (e.g., Void, bespoke internal runtimes)**:
  - Record exact manifest name, custom config files (e.g., `void.config.*` or custom schema), and scripts defined in the repository.
  - Read local documentation in the repo or installed package directory before writing code.
  - Set confidence to `HIGH` for verified local scripts/conventions, and explicitly list any unverified behavior under `Unresolved Assumptions`.

---

## 3. Monorepo Impact & Verification Scope Strategy

When a repository is a monorepo with packages $P_1, P_2, \dots, P_n$:

1. **Direct Impact Set ($D$)**: Packages containing modified or target files.
2. **Transitive Dependent Set ($T$)**: Packages that depend (directly or transitively) on any package in $D$.
3. **Root / Shared Infrastructure Changes**:
   - If root configs (`tsconfig.base.json`, root lockfile, CI workflow, shared linter config) change, or if dependency edges cannot be resolved with `HIGH` confidence:
     - Expand verification scope to **workspace-wide** checks and document why.
4. **Focused Package Verification**:
   - During **Stage 6 (Verify)** of individual slices: Run lint, typecheck, and unit tests for $D$.
   - During **Stage 9 (Final Integration Verification)**: Run verification across $D \cup T$ (using native workspace filters such as `pnpm --filter <pkg>...`, `turbo run test --filter=...`, `nx affected -t test`, `cargo test -p <pkg>`, or package-specific scripts).
