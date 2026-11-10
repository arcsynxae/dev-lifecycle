#!/usr/bin/env node
/**
 * DevLifecycle v2.1 — SessionStart Lightweight Context Check Hook (P13)
 *
 * Inspects workspace roots on SessionStart to check whether a persistent
 * cached Project Context Profile is available, records lightweight availability
 * metadata in the session scratch directory, and outputs `{}` on stdout.
 * Does NOT run full repository discovery during SessionStart.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectIdentity, loadProjectContext } from './context-store.mjs';

/**
 * Evaluate SessionStart payload and inspect cached project context availability.
 * @param {object} payload
 * @param {object} [options]
 * @returns {object}
 */
export function handleSessionStartContext(payload = {}, options = {}) {
  const startMs = performance.now();
  const workspacePaths = Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0
    ? payload.workspacePaths
    : [process.cwd()];

  const workspaces = [];
  for (const wsPath of workspacePaths) {
    try {
      if (!wsPath || !fs.existsSync(wsPath)) continue;
      const identity = resolveProjectIdentity(wsPath);
      const loaded = loadProjectContext(identity, {
        artifactDirectoryPath: payload.artifactDirectoryPath || options.artifactDirectoryPath || null,
        customCacheDir: options.customCacheDir || null,
        simulateRestrictedStorage: Boolean(options.simulateRestrictedStorage)
      });

      workspaces.push({
        workspaceRoot: identity.canonicalRoot,
        projectId: identity.projectId,
        projectKey: identity.projectKey,
        worktreeKey: identity.worktreeKey,
        cacheAvailable: loaded.status === 'FOUND' || loaded.status === 'RELOCATED',
        cacheStatus: loaded.status,
        storageTier: loaded.storage?.storageTier || 'unknown',
        persistent: Boolean(loaded.storage?.persistent),
        dirtyHintCount: Array.isArray(loaded.record?.cacheMetadata?.dirtyHintFiles)
          ? loaded.record.cacheMetadata.dirtyHintFiles.length
          : 0,
        lastValidatedAt: loaded.record?.verifiedAt || null
      });
    } catch {
      // Fail-safe per workspace
    }
  }

  const summary = {
    checkedAt: new Date().toISOString(),
    source: payload.source || 'startup',
    durationMs: Number((performance.now() - startMs).toFixed(2)),
    workspaces
  };

  const artifactDir = payload.artifactDirectoryPath || options.artifactDirectoryPath || null;
  if (artifactDir) {
    try {
      const scratchDir = path.join(artifactDir, 'scratch');
      fs.mkdirSync(scratchDir, { recursive: true });
      fs.writeFileSync(
        path.join(scratchDir, 'dl-session-context.json'),
        JSON.stringify(summary, null, 2),
        'utf8'
      );
    } catch {
      // Ignore write failures in restricted environments
    }
  }

  return summary;
}

async function main() {
  try {
    let rawInput = '';
    const argIdx = process.argv.indexOf('--payload');
    if (argIdx !== -1 && process.argv[argIdx + 1]) {
      rawInput = process.argv[argIdx + 1];
    } else if (!process.stdin.isTTY) {
      rawInput = fs.readFileSync(0, 'utf8');
    }

    const payload = rawInput.trim() ? JSON.parse(rawInput) : {};
    handleSessionStartContext(payload);
  } catch {
    // Fail-safe: never block SessionStart
  }

  process.stdout.write('{}\n');
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('session-start-context.mjs')
) {
  main();
}
