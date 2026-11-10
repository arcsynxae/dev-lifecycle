# Phase 1 — Research & Runtime Compatibility Findings

This document records the official Google Antigravity documentation research and local runtime inspection conducted prior to implementing **DevLifecycle v2 (`dev-lifecycle`)**.

---

## 1. Local Environment & Installed Runtime Verification

| Component / Runtime | Verified Version / Value | Discovery Evidence |
| :--- | :--- | :--- |
| **Antigravity Desktop Application** | `44.9.1` | `C:\Users\MyBook SAGA\AppData\Local\Programs\antigravity\version` |
| **Antigravity Language Server** | `hub-2.31.0` | `ANTIGRAVITY_LS_VERSION` environment variable & Connect RPC endpoint |
| **Antigravity CLI (`agy`)** | `1.5.4` | `C:\Users\MyBook SAGA\.gemini\bin\agy.exe --version` (`agy.version.json`) |
| **Node.js Runtime** | `v26.12.1` | `node --version` |
| **Python Runtime** | `3.12.10` | `python --version` |
| **Git CLI** | `2.53.0.windows.1` | `git --version` |
| **Operating System / Shell** | Windows (`NT 10.0.26100`) / PowerShell `5.1` | `$PSVersionTable.PSVersion` |

---

## 2. Official Antigravity Feature & Capability Classification

To ensure **DevLifecycle v2** relies strictly on real, supported platform mechanics without inventing APIs, schemas, or hook events, capabilities were audited across official documentation (`antigravity.google/docs/*`) and local builtin reference skills (`plugin`, `agy-customizations`, `antigravity-guide`, `native_swarm`, `permissioned-github`):

### A. Stable & Production-Ready Capabilities (Used as Core Foundation)

1. **Plugin Bundle Manifest (`plugin.json`)**:
   - Schema: `https://antigravity.google/schemas/v1/plugin.json`
   - Supported top-level fields verified against `agy plugin validate --strict`:
     `$schema`, `name`, `displayName`, `version`, `description`, `logo`, `suggestedPrompts`, `author`, `homepage`, `repository`, `disabled`.
   - Unknown top-level fields trigger strict validator warnings and are silently ignored by the loader.
2. **Agent Skills (`skills/<skill-name>/SKILL.md`)**:
   - Progressive disclosure: Only `name` and `description` from YAML frontmatter are injected at startup; full `SKILL.md` body is loaded on demand.
   - Strict constraints verified with `agy plugin validate --strict`:
     - Folder name `<skill-name>` **must** match frontmatter `name` exactly.
     - `SKILL.md` body is capped at **24,000 bytes** (`24 KB`); auxiliary tables and deep templates belong in `skills/<skill-name>/references/`.
3. **Bundled Subagents (`agents/<agent-name>.md`)**:
   - Configured via YAML frontmatter: `name`, `description`, `subagent: true`, `mainAgent: false`, `tools: [...]`.
   - Invoked via native `invoke_subagent` (supporting `Workspace: "inherit" | "share" | "branch"` and `Model: "inherit" | "flash_lite" | "flash" | "pro"`) and `send_message`.
   - Omitting `tools` restricts a subagent to a minimal read-only default; explicitly listing `tools: [read_file, search_web]` enforces read-only isolation for reviewer/architect agents.
4. **Plugin Rules (`rules/AGENTS.md`)**:
   - Loaded automatically when the plugin is enabled.
   - Inside a plugin, `rules/AGENTS.md` is plain Markdown **without YAML frontmatter** and is capped at **24,000 bytes** per file (sharing a 20,000-token aggregate rules budget).
5. **Lifecycle Hooks (`hooks.json`)**:
   - Must reside at the plugin root (`<plugin_dir>/hooks.json`) for native plugins.
   - Supported events: `SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`.
   - `PreToolUse` and `PostToolUse` require a `matcher` regex wrapper (`"matcher": "run_command|write_file|edit_file|write_to_file|replace_file_content|multi_replace_file_content"`); `SessionStart`, `PreInvocation`, `PostInvocation`, and `Stop` use flat handler arrays.
   - Payloads use camelCase protojson on `stdin` and expect JSON on `stdout` (`SessionStart`: `{}`; `PreToolUse`: `{"decision": "allow"|"ask"|"force_ask"|"deny", "reason": "..."}`; `PostToolUse`: `{}`; `Stop`: `{"decision": "continue"|"allow", "reason": "..."}`).
   - Hook commands execute in the plugin root directory and receive `PLUGIN_ROOT` and `PLUGIN_DATA` environment variables.
   - **Critical `PLUGIN_DATA` Scope Finding (v2.1 P13)**: While `PLUGIN_DATA` (`C:\Users\MyBook SAGA\.gemini\antigravity\plugin_data\dev-lifecycle`) is injected into installed plugin hook subprocesses and MCP servers, standalone CLI helper scripts invoked via `run_command` do **not** receive `PLUGIN_DATA` in their environment automatically. Therefore, `scripts/context-store.mjs` uses `process.env.PLUGIN_DATA` when present and mirrors records to the conventional OS user cache directory (`%LOCALAPPDATA%\dev-lifecycle\Cache\u-<hash>\context-v2.1` on Windows), falling back gracefully to session scratch (`<artifactDirectoryPath>/scratch/context-cache`) or memory-only mode when persistent storage is restricted.
   - **`PreInvocation` Hook Deliberate Exclusion (v2.1 P13)**: `PreInvocation` fires before every model call on every turn. Running repository discovery or injecting context messages on `PreInvocation` would add per-turn latency and context bloat; therefore, DevLifecycle uses `SessionStart` (`session-start-context.mjs`), `PostToolUse` dirty hints (`post-tool-tracker.mjs`), and on-demand skill validation (`dl-discover` / `dl-run`).
6. **Native Session Artifacts & Scratch Storage**:
   - Conversation artifacts live in `<appDataDir>/brain/<conversation-id>/` (`implementation_plan.md`, `walkthrough.md`, custom `.md` artifacts) with `ArtifactMetadata`.
   - Temporary scratch files live in `<appDataDir>/brain/<conversation-id>/scratch/`, keeping the user's git repository clean.
7. **Unified Permission Engine & GitHub Permissions**:
   - Precedence: `Deny > Ask > Allow`.
   - GitHub operations (`gh` CLI with `-R ORG/REPO` and `git` over HTTPS) use scoped `gh.*`, `git.*`, and `workflow.*` permissions.

### B. Preview / Quota-Heavy Capabilities (Treated as Optional Enhancements)

- **Native Swarm (`/swarm`, `swarm` tool)**:
  - Marked `(Preview & Quota Heavy)` in `native_swarm/SKILL.md`. Useful when large tasks split into independent parallel lanes across a shared message board, but never required for core DevLifecycle operation.
- **Teamwork (`/teamwork`)**:
  - Multi-agent milestone orchestration slash command; recommended only when the user explicitly wants multi-agent milestone teams.

### C. Deprecated or Unsupported Features (Explicitly Avoided)

- **Legacy `.agent/workflows`**: Superseded by `skills/<name>/SKILL.md`.
- **`ephemeralMessage` in Hook `injectSteps`**: Deprecated in favor of `systemMessage: { systemMessage: "..." }`.
- **Legacy MCP HTTP+SSE Transport (`/sse`, 2024-11-05 spec)**: Unsupported; Antigravity uses Streamable HTTP (`/mcp`) or `stdio`. `dev-lifecycle` requires zero MCP servers by default (`mcpServers: 0`) so it works offline and across all environments.
- **Direct Language Server State Mutation RPCs from `run_command`**: `JetboxWriteState`, `DeletePlugin`, and `InstallCustomization` are restricted in `run_command` subprocesses; plugin management uses `agy plugin` CLI or `customization://<dir>` UI links.

---

## 3. v2.1.1 Plugin Packaging, Distribution & Installation Findings

1. **GitHub URL vs. Clean Local Directory Installation (`agy plugin install`)**:
   - Empirically verified on `agy` CLI `1.5.4`: running `agy plugin install https://github.com/arcsynxae/dev-lifecycle` clones the entire Git repository into `~/.gemini/config/plugins/dev-lifecycle` without filtering `.git/`, `.github/`, `tests/`, `tooling/`, `docs/`, or `examples/`.
   - Antigravity does **not** currently support an `.agyignore` or `files` allowlist inside `plugin.json` during GitHub URL cloning, nor does it support `#subdirectory` or release asset ZIP URLs directly in `agy plugin install`.
   - Therefore, `tooling/package-plugin.mjs` builds a clean staged directory (`dist/plugin/dev-lifecycle`) and versioned archive (`dist/dev-lifecycle-v<version>.zip`) containing **only** the 33 runtime files. Installing from `./dist/plugin/dev-lifecycle` (or an extracted release ZIP) results in a 100% clean `~/.gemini/config/plugins/dev-lifecycle` installation with zero development or repository clutter.
2. **Global vs. Workspace Plugin Scope**:
   - **Global Scope (`~/.gemini/config/plugins/dev-lifecycle`)**: Installed via `agy plugin install <target>` and enabled in `~/.gemini/config/settings.json` (`"plugins": { "dev-lifecycle": true }`). Available across all workspaces without modifying any user project repository.
   - **Workspace Scope (`<workspace>/.agents/plugins/dev-lifecycle`)**: Project-local plugin directory with higher discovery precedence (**Workspace > Global > Built-in**).
3. **Zero Runtime npm Dependency Guarantee**:
   - `@changesets/cli` is used strictly at development/CI release time (`devDependencies` in private root `package.json`).
   - All 9 runtime scripts (`scripts/*.mjs`) import only Node.js built-in `node:*` modules, so installed plugins execute immediately on any machine with Node.js `>= 20` without `node_modules`.
