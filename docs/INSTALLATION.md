# Installing DevLifecycle in Google Antigravity

This guide covers all officially supported ways to install, verify, update, and uninstall the **DevLifecycle** (`dev-lifecycle`) plugin in Google Antigravity, along with exact behaviors verified on **Antigravity IDE `1.23.2` / CLI `2.0.51173`**.

---

## 1. Prerequisites

| Requirement | Minimum Version | Purpose |
| :--- | :--- | :--- |
| **Google Antigravity** | App `>= 1.22` / CLI `>= 2.0` | Host IDE, agent runtime, and `agy plugin` CLI |
| **Node.js** | `>= 20.0.0` (CI verified on **Node.js v26 Latest LTS**) | Executes zero-dependency `.mjs` lifecycle & P13 context scripts |
| **Git** *(Recommended)* | `>= 2.30` (`git` on `PATH`) | Enables commit/branch/worktree P13 freshness validation (non-Git projects also work via selective file fingerprinting) |

> [!NOTE]
> **Zero Runtime npm Dependencies**: Installed DevLifecycle runtime bundles use only built-in Node.js standard library modules (`node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:os`). End users **never** need to run `npm install` to use the plugin.

---

## 2. Supported Installation Methods

### Method A — Direct GitHub Installation (Fastest One-Command Setup)

Install directly from the GitHub repository URL using the Antigravity CLI:

```bash
agy plugin install https://github.com/arcsynxae/dev-lifecycle
```

**What happens under the hood:**
- `agy plugin install <github-url>` clones the repository into your global Antigravity plugins directory (`~/.gemini/config/plugins/dev-lifecycle` on macOS/Linux or `%USERPROFILE%\.gemini\config\plugins\dev-lifecycle` on Windows) and enables `"dev-lifecycle": true` in `~/.gemini/config/settings.json`.
- **Important nuance**: Because `agy plugin install <github-url>` performs a direct Git clone without filtering repository files, the global plugin folder will also contain repository development files (`tests/`, `docs/`, `tooling/`, `.github/`). This **never** affects or pollutes your own application repositories, but if you want a strictly runtime-only plugin directory, use **Method B**.

---

### Method B — Clean Runtime-Only Distribution Archive (Recommended for Production)

Every release (or local build via `npm run package:plugin`) produces a clean, runtime-only archive (`dev-lifecycle-v<version>.zip`) containing **only** the 33 runtime plugin files (`plugin.json`, `README.md`, `hooks.json`, `assets/logo.svg`, `rules/AGENTS.md`, `agents/*.md`, `skills/*`, and `scripts/*.mjs`) with zero development, test, CI, or Changeset files.

#### Option B1: From a Downloaded Release Archive (`dev-lifecycle-v<version>.zip`)

**Windows (PowerShell):**
```powershell
Expand-Archive -LiteralPath .\dev-lifecycle-v2.1.1.zip -DestinationPath .\dev-lifecycle-bundle -Force
agy plugin install .\dev-lifecycle-bundle\dev-lifecycle
Remove-Item -Recurse -Force .\dev-lifecycle-bundle
```

**macOS / Linux (Bash / Zsh):**
```bash
unzip -q ./dev-lifecycle-v2.1.1.zip -d ./dev-lifecycle-bundle
agy plugin install ./dev-lifecycle-bundle/dev-lifecycle
rm -rf ./dev-lifecycle-bundle
```

#### Option B2: Build & Install Clean Bundle from a Local Clone

If you cloned this repository locally for development or auditing:

**Windows (PowerShell) & macOS / Linux:**
```bash
npm ci
npm run package:plugin
agy plugin install ./dist/plugin/dev-lifecycle
```

---

### Method C — Manual Global Directory Placement

Antigravity discovers global user plugins from:

- **Windows**: `%USERPROFILE%\.gemini\config\plugins\dev-lifecycle`
- **macOS / Linux**: `~/.gemini/config/plugins/dev-lifecycle`

You can extract `dev-lifecycle-v<version>.zip` directly into `~/.gemini/config/plugins/` so that `~/.gemini/config/plugins/dev-lifecycle/plugin.json` exists, then enable `"dev-lifecycle": true` under `"plugins"` in `~/.gemini/config/settings.json` (or toggle it on in the Antigravity Plugins Manager UI).

---

### Method D — Workspace-Scoped Installation (`.agents/plugins/dev-lifecycle`)

To scope DevLifecycle to a single project repository (for example, to standardize engineering lifecycle gates across a team without requiring global installation):

1. Copy the clean runtime folder (`dist/plugin/dev-lifecycle` or extracted `dev-lifecycle/` from `dev-lifecycle-v<version>.zip`) into your project's `.agents/plugins/` directory:
   ```text
   <your-project-root>/.agents/plugins/dev-lifecycle/plugin.json
   ```
2. Antigravity's customization discovery priority is **Workspace (`.agents/plugins/`) > Global (`~/.gemini/config/plugins/`) > Built-in**, so the workspace copy takes precedence for that repository.

---

## 3. Verifying Your Installation

Run the official Antigravity CLI commands to confirm that DevLifecycle is installed, valid, and enabled:

```bash
# 1. List installed plugins and discovered components
agy plugin list

# 2. Inspect structured JSON discovery output
agy plugin list --json

# 3. Run strict schema and component validation
agy plugin validate --strict ~/.gemini/config/plugins/dev-lifecycle
```

**Expected Discovered Components (`agy plugin list`):**
- **Manifest**: `dev-lifecycle` (**DevLifecycle**)
- **Rules (1)**: `AGENTS` (`rules/AGENTS.md`)
- **Skills (8)**: `dl-run`, `dl-discover`, `dl-plan`, `dl-implement`, `dl-verify`, `dl-diagnose`, `dl-review`, `dl-release`
- **Subagents (7)**: `lifecycle-orchestrator`, `software-architect`, `implementation-engineer`, `quality-engineer`, `code-reviewer`, `security-reviewer`, `release-engineer`
- **Hooks (4)**: `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`

---

## 4. Updating, Enabling/Disabling, and Uninstalling

### Updating to a Newer Version
Re-run `agy plugin install` pointing to the new release archive directory or GitHub URL:

```bash
agy plugin install ./dist/plugin/dev-lifecycle
# or
agy plugin install https://github.com/arcsynxae/dev-lifecycle
```

`agy plugin install` replaces the existing `~/.gemini/config/plugins/dev-lifecycle` directory with the new version and preserves your enabled state.

### Enabling or Disabling
- **UI**: Open the **Plugins Manager** in Google Antigravity and toggle **DevLifecycle** on or off.
- **Config File**: Edit `~/.gemini/config/settings.json`:
  ```json
  {
    "plugins": {
      "dev-lifecycle": true
    }
  }
  ```

### Uninstalling
```bash
agy plugin uninstall dev-lifecycle
```
*(If installed at workspace scope via Method D, remove `<workspace>/.agents/plugins/dev-lifecycle`.)*

---

## 5. Using DevLifecycle in Antigravity

Once installed and enabled, DevLifecycle operates both **automatically** and **on-demand**:

1. **Automatic Lifecycle & P13 Context Intelligence**:
   - **Rule (`rules/AGENTS.md`)**: Automatically enforces Principles `P01`–`P13`, adaptive execution profiles (`Quick`, `Standard`, `Deep`), and quality gates (`Gate A`–`Gate F`).
   - **`SessionStart` Hook**: Preloads verified P13 project context metadata at session startup without polluting your repository.
   - **`PreToolUse` Hook**: Blocks catastrophic commands (`deny`), requires explicit confirmation for `git push`, `gh pr merge`, `npm publish`, deploys, or `.env`/secret edits (`force_ask`), and prompts on `git commit` (`ask`).
   - **`PostToolUse` & `Stop` Hooks**: Track verification evidence and mark cached context dirty when files or dependencies change.
2. **On-Demand Skills**:
   - Ask Antigravity to use `dl-run` for end-to-end tasks, or invoke targeted stage skills (`dl-discover`, `dl-plan`, `dl-implement`, `dl-verify`, `dl-diagnose`, `dl-review`, `dl-release`).

---

## 6. Troubleshooting

### `agy` is not recognized on Windows PowerShell
If `agy` is not yet on your user `PATH`, invoke it via its default installation path or add the `bin` folder to `PATH`:
```powershell
& "$env:LOCALAPPDATA\Programs\Antigravity\bin\agy.cmd" plugin list
```

### Resetting or Inspecting the P13 Persistent Context Cache
DevLifecycle stores persistent project context outside your repository in your OS user cache directory (`%LOCALAPPDATA%\dev-lifecycle\Cache\project-context` on Windows, `~/Library/Caches/dev-lifecycle/project-context` on macOS, `~/.cache/dev-lifecycle/project-context` on Linux). To force a fresh discovery or clear cached context for the current project:

```bash
# Force a fresh discovery and overwrite cache
node ~/.gemini/config/plugins/dev-lifecycle/scripts/discover-project.mjs --refresh .

# Delete cached context for the current repository
node ~/.gemini/config/plugins/dev-lifecycle/scripts/discover-project.mjs --clear-cache .
```
