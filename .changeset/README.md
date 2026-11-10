# Changesets — DevLifecycle SemVer & Manifest Synchronization

This repository uses [Changesets](https://changesets.dev/) to manage Semantic Versioning and `CHANGELOG.md` generation for the **DevLifecycle** (`dev-lifecycle`) Google Antigravity plugin.

## Key Principles

1. **Private Non-npm Plugin (`private: true`)**:
   - `dev-lifecycle` is a native Google Antigravity plugin, **not** a public npm package.
   - `.changeset/config.json` sets `"privatePackages": { "version": true, "tag": false }` so `changeset version` computes the next SemVer version in `package.json` and updates `CHANGELOG.md` without ever publishing to npm.
2. **Single Source of Version Truth (`package.json.version === plugin.json.version`)**:
   - Running `npm run version-packages` executes `changeset version && node ./tooling/sync-version.mjs`, which deterministically synchronizes `plugin.json` with the version calculated by Changesets.
   - Contributors should **never** manually bump `plugin.json` or `package.json` in feature/fix Pull Requests; instead, add a changeset file in `.changeset/<name>.md`.
3. **Adding a Changeset**:
   ```bash
   npx changeset
   ```
   Choose `patch` (backward-compatible bug/reliability fixes), `minor` (backward-compatible features), or `major` (breaking changes).
