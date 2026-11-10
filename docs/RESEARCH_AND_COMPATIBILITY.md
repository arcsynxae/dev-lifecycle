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
   - `PreToolUse` and `PostToolUse` require a `matcher` regex wrapper (`"matcher": "run_command|write_file|edit_file"`); `SessionStart`, `PreInvocation`, `PostInvocation`, and `Stop` use flat handler arrays.
   - Payloads use camelCase protojson on `stdin` and expect JSON on `stdout` (`PreToolUse`: `{"decision": "allow"|"ask"|"force_ask"|"deny", "reason": "..."}`; `PostToolUse`: `{}`; `Stop`: `{"decision": "continue"|"allow", "reason": "..."}`).
   - Hook commands execute in the plugin root directory and receive `PLUGIN_ROOT` and `PLUGIN_DATA` environment variables.
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
