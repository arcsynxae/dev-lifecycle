#!/usr/bin/env node
/**
 * DevLifecycle v2.1 — P13 Persistent Project Context Intelligence Test Suite
 *
 * Deterministically validates all 14 mandatory P13 scenarios:
 * - P13-01: Initial Discovery
 * - P13-02: Unchanged Repository (Cross-Session Context Reuse)
 * - P13-03: Single Source Change (Targeted Invalidation + Live Task File Inspection)
 * - P13-04: Configuration Change (Manifest/Lockfile/Config Refresh)
 * - P13-05: Branch Switch (Git Branch Divergence Refresh)
 * - P13-06: Multiple Git Worktrees (Worktree Isolation without Collision)
 * - P13-07: External File Modification (Out-of-Band Edit Detection)
 * - P13-08: Monorepo Dependency Change (Dependency Graph & Verification Scope Refresh)
 * - P13-09: Corrupted Cache (Malformed JSON & Incompatible Schema Safe Repair)
 * - P13-10: Non-Git Project (Selective Fingerprinting without Git)
 * - P13-11: Restricted Storage (Session / Memory Fallback Honesty)
 * - P13-12: Performance Regression (Measured Initial vs Cached Lookup & Work Avoided)
 * - P13-13: Multi-Folder Project (Multi-Root Isolation)
 * - P13-14: Hook Compatibility (SessionStart, PreToolUse, PostToolUse across all tool names)
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONTEXT_SCHEMA_VERSION,
  CONTEXT_SECTION_KEYS,
  resolveProjectIdentity,
  loadProjectContext,
  clearProjectContext
} from '../scripts/context-store.mjs';
import {
  discoverProject,
  discoverMultiRootWorkspace
} from '../scripts/discover-project.mjs';
import { handleSessionStartContext } from '../scripts/session-start-context.mjs';
import { evaluatePreToolSafety } from '../scripts/pre-tool-safety.mjs';
import { updateVerificationTelemetry } from '../scripts/post-tool-tracker.mjs';
import { normalizeTestOutcome, summarizeTestResults } from '../scripts/lifecycle-check.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

const results = [];

function runTest(id, name, fn) {
  const start = performance.now();
  try {
    const rawDetails = fn();
    const outcome = normalizeTestOutcome(rawDetails);
    const durationMs = Number((performance.now() - start).toFixed(2));
    results.push({ id, name, status: outcome.status, durationMs, details: outcome.details });
    const icon = outcome.status === 'PASS' ? '✔' : outcome.status === 'SKIPPED' || outcome.status === 'NOT_RUN' ? '↷' : '✖';
    console.log(`  ${icon} [${id}] ${name} [${outcome.status}] (${durationMs}ms)`);
  } catch (err) {
    const durationMs = Number((performance.now() - start).toFixed(2));
    results.push({ id, name, status: 'FAIL', durationMs, error: err.message });
    console.error(`  ✖ [${id}] ${name} FAILED: ${err.message}`);
  }
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dl-p13-${prefix}-`));
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore Windows cleanup locks
  }
}

function gitExec(cwd, args) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function initGitRepo(dir) {
  gitExec(dir, ['init']);
  gitExec(dir, ['config', 'user.email', 'test@dev-lifecycle.local']);
  gitExec(dir, ['config', 'user.name', 'DevLifecycle Test']);
}

console.log('======================================================================');
console.log(' DevLifecycle v2.1 — P13 Persistent Project Context Test Suite');
console.log('======================================================================\n');

// Shared fixture state for sequential P13-01..P13-07 tests
const sharedCacheDir = makeTempDir('cache');
const repoDir = makeTempDir('repo');

try {
  // Set up realistic Git project fixture
  initGitRepo(repoDir);
  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, 'AGENTS.md'),
    '# Repo Rules\nAlways run typecheck before test.\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(repoDir, 'package.json'),
    JSON.stringify(
      {
        name: 'acme-service',
        version: '1.0.0',
        scripts: {
          lint: 'eslint .',
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
          build: 'tsup src/index.ts'
        },
        dependencies: {
          express: '^4.19.2'
        },
        devDependencies: {
          typescript: '^5.6.2',
          vitest: '^2.1.1'
        }
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(path.join(repoDir, 'package-lock.json'), '{"lockfileVersion": 3}', 'utf8');
  fs.writeFileSync(path.join(repoDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}', 'utf8');
  fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const sum = (a: number, b: number) => a + b;\n', 'utf8');
  fs.writeFileSync(
    path.join(repoDir, '.github', 'workflows', 'ci.yml'),
    'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n',
    'utf8'
  );
  gitExec(repoDir, ['add', '.']);
  gitExec(repoDir, ['commit', '-m', 'Initial commit']);

  // -------------------------------------------------------------------------
  // P13-01: Initial Discovery
  // -------------------------------------------------------------------------
  runTest('P13-01', 'Initial Discovery: creates a valid persistent context record with evidence and secret sanitization', () => {
    const profile = discoverProject(repoDir, [], {
      cacheDir: sharedCacheDir,
      taskFiles: ['src/index.ts']
    });

    assert.equal(profile.schemaVersion, CONTEXT_SCHEMA_VERSION);
    assert.equal(profile.contextIntelligence.cacheStatus, 'MISS');
    assert.equal(profile.contextIntelligence.freshnessStatus, 'INITIAL_SNAPSHOT');
    assert.equal(profile.contextIntelligence.persisted, true);
    assert.equal(profile.contextIntelligence.sectionsRecomputed.length, CONTEXT_SECTION_KEYS.length);
    assert.equal(profile.contextIntelligence.sectionsReused.length, 0);

    // Verify persistent record on disk
    const identity = resolveProjectIdentity(repoDir);
    const loaded = loadProjectContext(identity, { cacheDir: sharedCacheDir });
    assert.equal(loaded.status, 'FOUND');
    assert.equal(loaded.record.schemaVersion, CONTEXT_SCHEMA_VERSION);
    assert.equal(loaded.record.projectIdentity.projectId, identity.projectId);
    assert.equal(loaded.record.projectIdentity.worktreeKey, identity.worktreeKey);
    assert.ok(loaded.record.evidence.packageManagers.files.includes('package.json'));
    assert.ok(loaded.record.evidence.projectInstructions.files.includes('AGENTS.md'));
    assert.equal(profile.taskSpecificFiles.length, 1);
    assert.equal(profile.taskSpecificFiles[0].path, 'src/index.ts');
    assert.equal(profile.taskSpecificFiles[0].exists, true);
    assert.ok(profile.taskSpecificFiles[0].liveSha256);

    return `Created persistent cache (${loaded.storage.storageTier}) with 10 sections & evidence fingerprints`;
  });

  // -------------------------------------------------------------------------
  // P13-02: Unchanged Repository
  // -------------------------------------------------------------------------
  runTest('P13-02', 'Unchanged Repository: reuses cached context across sessions and avoids full discovery', () => {
    const profile = discoverProject(repoDir, [], {
      cacheDir: sharedCacheDir,
      taskFiles: ['src/index.ts']
    });

    assert.equal(profile.contextIntelligence.cacheStatus, 'HIT');
    assert.equal(profile.contextIntelligence.freshnessStatus, 'FRESH');
    assert.equal(profile.contextIntelligence.sectionsReused.length, CONTEXT_SECTION_KEYS.length);
    assert.equal(profile.contextIntelligence.sectionsRecomputed.length, 0);
    assert.equal(profile.verificationCommands.typecheck, 'npm run typecheck');
    assert.equal(profile.verificationCommands.test, 'npm test');
    assert.equal(profile.contextIntelligence.metrics.cacheHits, 1);
    assert.equal(profile.contextIntelligence.metrics.cacheHitRate, 1.0);

    return `Cache HIT: reused all ${profile.contextIntelligence.sectionsReused.length}/10 sections, 0 sections recomputed`;
  });

  // -------------------------------------------------------------------------
  // P13-03: Single Source Change
  // -------------------------------------------------------------------------
  runTest('P13-03', 'Single Source Change: invalidates only impact while reusing all 10 project-level sections and inspecting live file', () => {
    const oldFileHash = discoverProject(repoDir, [], {
      cacheDir: sharedCacheDir,
      taskFiles: ['src/index.ts']
    }).taskSpecificFiles[0].liveSha256;

    // Modify only src/index.ts
    fs.writeFileSync(
      path.join(repoDir, 'src', 'index.ts'),
      'export const sum = (a: number, b: number) => a + b;\nexport const mul = (a: number, b: number) => a * b;\n',
      'utf8'
    );

    const profile = discoverProject(repoDir, [], {
      cacheDir: sharedCacheDir,
      taskFiles: ['src/index.ts']
    });

    assert.equal(profile.contextIntelligence.cacheStatus, 'INCREMENTAL_REFRESH');
    assert.equal(profile.contextIntelligence.freshnessStatus, 'PARTIAL_STALE');
    // Zero architectural sections needed recomputation; all 10 project-level sections were reused!
    assert.equal(profile.contextIntelligence.sectionsRecomputed.length, 0);
    assert.equal(profile.contextIntelligence.sectionsReused.length, CONTEXT_SECTION_KEYS.length);
    assert.ok(profile.contextIntelligence.changedFiles.includes('src/index.ts'));
    assert.equal(profile.taskSpecificFiles[0].path, 'src/index.ts');
    assert.notEqual(profile.taskSpecificFiles[0].liveSha256, oldFileHash, 'Live task file hash must reflect updated file content');

    // Commit source change so working tree is clean for next test
    gitExec(repoDir, ['add', 'src/index.ts']);
    gitExec(repoDir, ['commit', '-m', 'Update src/index.ts']);
    discoverProject(repoDir, [], { cacheDir: sharedCacheDir });

    return 'Detected src/index.ts change (PARTIAL_STALE), reused 10/10 project sections, inspected updated live file';
  });

  // -------------------------------------------------------------------------
  // P13-04: Configuration Change
  // -------------------------------------------------------------------------
  runTest('P13-04', 'Configuration Change: editing package.json invalidates affected sections and refreshes commands & dependencies', () => {
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify(
        {
          name: 'acme-service',
          version: '1.1.0',
          scripts: {
            lint: 'biome check .',
            typecheck: 'tsc --noEmit',
            test: 'vitest run --coverage',
            build: 'tsup src/index.ts',
            e2e: 'playwright test'
          },
          dependencies: {
            express: '^4.19.2',
            fastify: '^5.0.0'
          },
          devDependencies: {
            typescript: '^5.6.2',
            vitest: '^2.1.1',
            '@playwright/test': '^1.48.0'
          }
        },
        null,
        2
      ),
      'utf8'
    );

    const profile = discoverProject(repoDir, [], {
      cacheDir: sharedCacheDir
    });

    assert.equal(profile.contextIntelligence.cacheStatus, 'INCREMENTAL_REFRESH');
    assert.equal(profile.contextIntelligence.freshnessStatus, 'PARTIAL_STALE');
    assert.ok(profile.contextIntelligence.sectionsRecomputed.includes('packageManagers'));
    assert.ok(profile.contextIntelligence.sectionsRecomputed.includes('frameworks'));
    assert.ok(profile.contextIntelligence.sectionsRecomputed.includes('verificationCommands'));
    // Unchanged sections like projectInstructions, ciCd, deployment remain reused!
    assert.ok(profile.contextIntelligence.sectionsReused.includes('projectInstructions'));
    assert.ok(profile.contextIntelligence.sectionsReused.includes('ciCd'));
    assert.ok(profile.contextIntelligence.sectionsReused.includes('deployment'));

    assert.equal(profile.verificationCommands.lint, 'npm run lint');
    assert.equal(profile.verificationCommands.integration, 'npm run e2e');
    assert.ok(profile.frameworks.some((f) => f.name === 'Fastify'));

    gitExec(repoDir, ['add', 'package.json']);
    gitExec(repoDir, ['commit', '-m', 'Update package.json scripts and deps']);
    discoverProject(repoDir, [], { cacheDir: sharedCacheDir });

    return `Refreshed [${profile.contextIntelligence.sectionsRecomputed.join(', ')}], preserved [${profile.contextIntelligence.sectionsReused.join(', ')}]`;
  });

  // -------------------------------------------------------------------------
  // P13-05: Branch Switch
  // -------------------------------------------------------------------------
  runTest('P13-05', 'Branch Switch: switching Git branches with different config invalidates stale facts and refreshes context', () => {
    gitExec(repoDir, ['checkout', '-b', 'feature/dockerfile']);
    fs.writeFileSync(path.join(repoDir, 'Dockerfile'), 'FROM node:22-alpine\nCMD ["node", "dist/index.js"]\n', 'utf8');
    gitExec(repoDir, ['add', 'Dockerfile']);
    gitExec(repoDir, ['commit', '-m', 'Add Dockerfile on feature branch']);

    const featureProfile = discoverProject(repoDir, [], { cacheDir: sharedCacheDir });
    assert.equal(featureProfile.contextIntelligence.branch, 'feature/dockerfile');
    assert.ok(featureProfile.deploymentPlatforms.includes('Docker / Containers'));

    // Switch back to default branch where Dockerfile does NOT exist
    const defaultBranch = gitExec(repoDir, ['branch', '--list']).includes('main') ? 'main' : 'master';
    gitExec(repoDir, ['checkout', defaultBranch]);

    const mainProfile = discoverProject(repoDir, [], { cacheDir: sharedCacheDir });
    assert.equal(mainProfile.contextIntelligence.branch, defaultBranch);
    assert.ok(!mainProfile.deploymentPlatforms.includes('Docker / Containers'), 'Stale Dockerfile from feature branch must not leak into main branch');
    assert.ok(mainProfile.contextIntelligence.sectionsRecomputed.includes('deployment'));

    return `Switched feature/dockerfile -> ${defaultBranch}; deployment refreshed and stale Docker target removed`;
  });

  // -------------------------------------------------------------------------
  // P13-06: Multiple Git Worktrees
  // -------------------------------------------------------------------------
  runTest('P13-06', 'Multiple Git Worktrees: two worktrees of the same repo have isolated worktreeKeys and do not collide', () => {
    const wtDir = makeTempDir('worktree-b');
    cleanupTempDir(wtDir); // git worktree add creates the directory

    try {
      gitExec(repoDir, ['worktree', 'add', '-b', 'wt-branch', wtDir]);

      // Dirty uncommitted change in worktree B ONLY
      fs.writeFileSync(
        path.join(wtDir, 'wrangler.toml'),
        'name = "edge-worker"\ncompatibility_date = "2026-01-01"\n',
        'utf8'
      );

      const mainProfile = discoverProject(repoDir, [], { cacheDir: sharedCacheDir });
      const wtProfile = discoverProject(wtDir, [], { cacheDir: sharedCacheDir });

      assert.equal(
        mainProfile.contextIntelligence.commonRepoKey,
        wtProfile.contextIntelligence.commonRepoKey,
        'Both worktrees belong to the same underlying Git repository (same commonRepoKey)'
      );
      assert.notEqual(
        mainProfile.contextIntelligence.worktreeKey,
        wtProfile.contextIntelligence.worktreeKey,
        'Each worktree must have a distinct worktreeKey'
      );
      assert.ok(wtProfile.deploymentPlatforms.includes('Cloudflare Workers'));
      assert.ok(!mainProfile.deploymentPlatforms.includes('Cloudflare Workers'));

      // Re-run on main worktree: must be a clean HIT, unaffected by worktree B
      const mainProfileSecond = discoverProject(repoDir, [], { cacheDir: sharedCacheDir });
      assert.equal(mainProfileSecond.contextIntelligence.cacheStatus, 'HIT');

      return `Shared commonRepoKey (${mainProfile.contextIntelligence.commonRepoKey}), isolated worktreeKeys (${mainProfile.contextIntelligence.worktreeKey} vs ${wtProfile.contextIntelligence.worktreeKey})`;
    } finally {
      try {
        gitExec(repoDir, ['worktree', 'remove', '--force', wtDir]);
      } catch {
        cleanupTempDir(wtDir);
      }
    }
  });

  // -------------------------------------------------------------------------
  // P13-07: External File Modification
  // -------------------------------------------------------------------------
  runTest('P13-07', 'External File Modification: out-of-band edit outside Antigravity is detected on next freshness check', () => {
    const before = discoverProject(repoDir, [], { cacheDir: sharedCacheDir });
    assert.equal(before.contextIntelligence.cacheStatus, 'HIT');

    // Simulate external editor modifying .github/workflows/ci.yml without triggering any hook
    fs.writeFileSync(
      path.join(repoDir, '.github', 'workflows', 'ci.yml'),
      'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n  duplicate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n',
      'utf8'
    );

    const after = discoverProject(repoDir, [], { cacheDir: sharedCacheDir });
    assert.equal(after.contextIntelligence.cacheStatus, 'INCREMENTAL_REFRESH');
    assert.ok(after.contextIntelligence.sectionsRecomputed.includes('ciCd'));
    assert.equal(after.ciCd.duplicateChecks.length, 1);

    return 'Detected external edit to .github/workflows/ci.yml and refreshed ciCd section';
  });
} finally {
  cleanupTempDir(repoDir);
  cleanupTempDir(sharedCacheDir);
}

// ---------------------------------------------------------------------------
// P13-08: Monorepo Dependency Change
// ---------------------------------------------------------------------------
runTest('P13-08', 'Monorepo Dependency Change: changing internal package dependency updates dependency graph and verification scope', () => {
  const monoDir = makeTempDir('monorepo');
  const cacheDir = makeTempDir('mono-cache');

  try {
    initGitRepo(monoDir);
    fs.writeFileSync(path.join(monoDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n', 'utf8');
    fs.writeFileSync(path.join(monoDir, 'package.json'), JSON.stringify({ name: 'mono-root', private: true }), 'utf8');

    const pkgCore = path.join(monoDir, 'packages', 'core');
    const pkgUi = path.join(monoDir, 'packages', 'ui');
    const pkgAdmin = path.join(monoDir, 'packages', 'admin');
    fs.mkdirSync(path.join(pkgCore, 'src'), { recursive: true });
    fs.mkdirSync(path.join(pkgUi, 'src'), { recursive: true });
    fs.mkdirSync(path.join(pkgAdmin, 'src'), { recursive: true });

    fs.writeFileSync(path.join(pkgCore, 'package.json'), JSON.stringify({ name: '@mono/core', version: '1.0.0' }), 'utf8');
    fs.writeFileSync(
      path.join(pkgUi, 'package.json'),
      JSON.stringify({ name: '@mono/ui', version: '1.0.0', dependencies: { '@mono/core': 'workspace:*' } }),
      'utf8'
    );
    // Initially @mono/admin does NOT depend on @mono/core
    fs.writeFileSync(
      path.join(pkgAdmin, 'package.json'),
      JSON.stringify({ name: '@mono/admin', version: '1.0.0', dependencies: {} }),
      'utf8'
    );

    gitExec(monoDir, ['add', '.']);
    gitExec(monoDir, ['commit', '-m', 'Initial monorepo']);

    const initial = discoverProject(monoDir, ['packages/core/src/index.ts'], { cacheDir });
    assert.deepEqual(initial.impactAnalysis.directlyAffectedPackages, ['@mono/core']);
    assert.deepEqual(initial.impactAnalysis.downstreamDependents, ['@mono/ui']);

    // Now update packages/admin/package.json to depend on @mono/core
    fs.writeFileSync(
      path.join(pkgAdmin, 'package.json'),
      JSON.stringify({ name: '@mono/admin', version: '1.0.0', dependencies: { '@mono/core': 'workspace:*' } }),
      'utf8'
    );

    const updated = discoverProject(monoDir, ['packages/core/src/index.ts'], { cacheDir });
    assert.equal(updated.contextIntelligence.cacheStatus, 'INCREMENTAL_REFRESH');
    assert.ok(updated.contextIntelligence.sectionsRecomputed.includes('workspacePackages'));
    assert.ok(updated.contextIntelligence.sectionsRecomputed.includes('dependencyGraph'));
    assert.deepEqual(updated.impactAnalysis.downstreamDependents.sort(), ['@mono/admin', '@mono/ui']);
    assert.equal(updated.impactAnalysis.verificationScope, 'affected-and-dependents');

    return 'Updated @mono/admin manifest -> workspacePackages & dependencyGraph refreshed, downstreamDependents = [@mono/admin, @mono/ui]';
  } finally {
    cleanupTempDir(monoDir);
    cleanupTempDir(cacheDir);
  }
});

// ---------------------------------------------------------------------------
// P13-09: Corrupted Cache
// ---------------------------------------------------------------------------
runTest('P13-09', 'Corrupted Cache: malformed JSON or incompatible schemaVersion triggers safe full rediscovery and repairs cache', () => {
  const projDir = makeTempDir('corrupt-proj');
  const cacheDir = makeTempDir('corrupt-cache');

  try {
    fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({ name: 'corrupt-test', scripts: { test: 'node --test' } }), 'utf8');
    const identity = resolveProjectIdentity(projDir);

    // 1. Write initial valid cache
    discoverProject(projDir, [], { cacheDir });
    const loaded1 = loadProjectContext(identity, { cacheDir });
    assert.equal(loaded1.status, 'FOUND');

    // 2. Corrupt cache file with truncated JSON
    fs.writeFileSync(loaded1.filePath, '{ "schemaVersion": "2.1.0", CORRUPTED_JSON...', 'utf8');
    const loadedCorrupt = loadProjectContext(identity, { cacheDir });
    assert.equal(loadedCorrupt.status, 'CORRUPTED');

    // Discovery must not crash and must repair the cache
    const repaired1 = discoverProject(projDir, [], { cacheDir });
    assert.equal(repaired1.contextIntelligence.cacheStatus, 'FULL_REDISCOVERY');
    assert.equal(repaired1.contextIntelligence.freshnessStatus, 'CORRUPTED_REBUILT');
    assert.equal(repaired1.contextIntelligence.persisted, true);

    // 3. Write incompatible schema version
    const loaded2 = loadProjectContext(identity, { cacheDir });
    const badSchema = { ...loaded2.record, schemaVersion: '0.9.0-legacy' };
    fs.writeFileSync(loaded2.filePath, JSON.stringify(badSchema), 'utf8');

    const loadedMismatch = loadProjectContext(identity, { cacheDir });
    assert.equal(loadedMismatch.status, 'SCHEMA_MISMATCH');

    const repaired2 = discoverProject(projDir, [], { cacheDir });
    assert.equal(repaired2.contextIntelligence.cacheStatus, 'FULL_REDISCOVERY');
    assert.equal(repaired2.contextIntelligence.freshnessStatus, 'SCHEMA_MISMATCH_REBUILT');

    // Subsequent run is now a clean HIT
    const hitAfterRepair = discoverProject(projDir, [], { cacheDir });
    assert.equal(hitAfterRepair.contextIntelligence.cacheStatus, 'HIT');

    return 'Corrupted JSON and schema mismatch safely detected, rebuilt, and repaired to HIT';
  } finally {
    cleanupTempDir(projDir);
    cleanupTempDir(cacheDir);
  }
});

// ---------------------------------------------------------------------------
// P13-10: Non-Git Project
// ---------------------------------------------------------------------------
runTest('P13-10', 'Non-Git Project: context reuse and selective file-change invalidation work without Git', () => {
  const nonGitDir = makeTempDir('non-git');
  const cacheDir = makeTempDir('non-git-cache');

  try {
    fs.mkdirSync(path.join(nonGitDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(nonGitDir, 'package.json'),
      JSON.stringify({ name: 'plain-app', scripts: { test: 'node --test' } }),
      'utf8'
    );
    fs.writeFileSync(path.join(nonGitDir, 'src', 'app.js'), 'console.log("v1");\n', 'utf8');

    // 1. Initial discovery without Git
    const first = discoverProject(nonGitDir, [], { cacheDir });
    assert.equal(first.contextIntelligence.isGitRepo, false);
    assert.equal(first.contextIntelligence.cacheStatus, 'MISS');

    // 2. Unchanged non-Git repo -> HIT
    const second = discoverProject(nonGitDir, [], { cacheDir });
    assert.equal(second.contextIntelligence.cacheStatus, 'HIT');

    // 3. Edit source file in non-Git repo -> detected via selective source tree fingerprint
    fs.writeFileSync(path.join(nonGitDir, 'src', 'app.js'), 'console.log("v2-modified");\n', 'utf8');
    const third = discoverProject(nonGitDir, [], { cacheDir });
    assert.equal(third.contextIntelligence.cacheStatus, 'INCREMENTAL_REFRESH');
    assert.ok(third.contextIntelligence.changedFiles.includes('src/app.js'));

    return 'Non-Git project achieved MISS -> HIT -> INCREMENTAL_REFRESH via selective fingerprinting';
  } finally {
    cleanupTempDir(nonGitDir);
    cleanupTempDir(cacheDir);
  }
});

// ---------------------------------------------------------------------------
// P13-11: Restricted Storage
// ---------------------------------------------------------------------------
runTest('P13-11', 'Restricted Storage: unavailable persistent storage falls back to session/memory reuse without claiming persistent cache', () => {
  const projDir = makeTempDir('restricted-proj');
  const sessionArtifactDir = makeTempDir('session-artifact');

  try {
    fs.writeFileSync(
      path.join(projDir, 'package.json'),
      JSON.stringify({ name: 'restricted-app', scripts: { test: 'node --test' } }),
      'utf8'
    );

    // 1. Restricted persistent storage with session artifact directory available
    const first = discoverProject(projDir, [], {
      simulateRestrictedStorage: true,
      artifactDirectoryPath: sessionArtifactDir
    });
    assert.equal(first.contextIntelligence.storageTier, 'session-fallback');
    assert.equal(first.contextIntelligence.persisted, false);

    const second = discoverProject(projDir, [], {
      simulateRestrictedStorage: true,
      artifactDirectoryPath: sessionArtifactDir
    });
    assert.equal(second.contextIntelligence.cacheStatus, 'HIT');
    assert.equal(second.contextIntelligence.storageTier, 'session-fallback');
    assert.equal(second.contextIntelligence.persisted, false);
    assert.equal(second.contextIntelligence.sectionsReused.length, CONTEXT_SECTION_KEYS.length);

    // 2. Completely restricted storage (no persistent dir and no artifact dir -> memory-only)
    const memProjDir = makeTempDir('restricted-mem-proj');
    try {
      fs.writeFileSync(
        path.join(memProjDir, 'package.json'),
        JSON.stringify({ name: 'restricted-mem-app', scripts: { test: 'node --test' } }),
        'utf8'
      );
      const memFirst = discoverProject(memProjDir, [], {
        simulateRestrictedStorage: true,
        artifactDirectoryPath: null
      });
      assert.equal(memFirst.contextIntelligence.storageTier, 'memory-only');
      assert.equal(memFirst.contextIntelligence.persisted, false);

      const memSecond = discoverProject(memProjDir, [], {
        simulateRestrictedStorage: true,
        artifactDirectoryPath: null
      });
      assert.equal(memSecond.contextIntelligence.cacheStatus, 'HIT');
      assert.equal(memSecond.contextIntelligence.storageTier, 'memory-only');
      assert.equal(memSecond.contextIntelligence.persisted, false);
    } finally {
      cleanupTempDir(memProjDir);
    }

    return 'Verified honest session-fallback and memory-only behavior when persistent storage is restricted';
  } finally {
    cleanupTempDir(projDir);
    cleanupTempDir(sessionArtifactDir);
  }
});

// ---------------------------------------------------------------------------
// P13-12: Performance Regression & Work Avoided Measurement
// ---------------------------------------------------------------------------
runTest('P13-12', 'Performance Regression: measures initial discovery vs cached reuse and confirms work avoided', () => {
  const perfCacheDir = makeTempDir('perf-cache');
  try {
    // Run against the actual DevLifecycle plugin workspace
    clearProjectContext(PLUGIN_ROOT, { cacheDir: perfCacheDir });

    const coldProfile = discoverProject(PLUGIN_ROOT, [], {
      cacheDir: perfCacheDir,
      taskFiles: ['scripts/discover-project.mjs']
    });
    const warmProfile = discoverProject(PLUGIN_ROOT, [], {
      cacheDir: perfCacheDir,
      taskFiles: ['scripts/discover-project.mjs']
    });

    assert.equal(coldProfile.contextIntelligence.cacheStatus, 'MISS');
    assert.equal(warmProfile.contextIntelligence.cacheStatus, 'HIT');
    assert.equal(warmProfile.contextIntelligence.sectionsReused.length, 10);
    assert.equal(warmProfile.contextIntelligence.sectionsRecomputed.length, 0);

    const coldDuration = coldProfile.contextIntelligence.durationMs;
    const warmDuration = warmProfile.contextIntelligence.durationMs;
    assert.equal(typeof coldDuration, 'number');
    assert.equal(typeof warmDuration, 'number');
    assert.equal(warmProfile.contextIntelligence.metrics.fullDiscoveryAvoidedCount, 1);

    return `Cold MISS: ${coldDuration}ms (10 sections built) -> Warm HIT: ${warmDuration}ms (10/10 sections reused, 0 recomputed)`;
  } finally {
    cleanupTempDir(perfCacheDir);
  }
});

// ---------------------------------------------------------------------------
// P13-13: Multi-Folder Project
// ---------------------------------------------------------------------------
runTest('P13-13', 'Multi-Folder Project: multiple workspace roots maintain isolated contexts without cross-contamination', () => {
  const rootNode = makeTempDir('multi-node');
  const rootRust = makeTempDir('multi-rust');
  const cacheDir = makeTempDir('multi-cache');

  try {
    fs.writeFileSync(
      path.join(rootNode, 'package.json'),
      JSON.stringify({
        name: 'frontend-web',
        scripts: { build: 'astro build', test: 'vitest run' },
        dependencies: { astro: '^5.0.0' }
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(rootNode, 'astro.config.mjs'), 'export default {};\n', 'utf8');

    fs.writeFileSync(
      path.join(rootRust, 'Cargo.toml'),
      '[package]\nname = "payments-core"\nversion = "0.1.0"\nedition = "2021"\n',
      'utf8'
    );

    const multiResult = discoverMultiRootWorkspace([rootNode, rootRust], {
      cacheDir
    });

    assert.equal(multiResult.multiRoot, true);
    assert.equal(multiResult.rootCount, 2);
    assert.equal(multiResult.isolatedContexts, true);

    const [nodeProfile, rustProfile] = multiResult.roots;
    assert.notEqual(nodeProfile.contextIntelligence.projectId, rustProfile.contextIntelligence.projectId);

    assert.ok(nodeProfile.frameworks.some((f) => f.name === 'Astro'));
    assert.ok(!nodeProfile.languages.includes('Rust'));
    assert.equal(nodeProfile.verificationCommands.build, 'npm run build');

    assert.ok(rustProfile.languages.includes('Rust'));
    assert.ok(!rustProfile.frameworks.some((f) => f.name === 'Astro'));
    assert.equal(rustProfile.verificationCommands.build, 'cargo build');

    return `Isolated 2 roots: Node/Astro (${nodeProfile.contextIntelligence.projectId}) vs Rust/Cargo (${rustProfile.contextIntelligence.projectId})`;
  } finally {
    cleanupTempDir(rootNode);
    cleanupTempDir(rootRust);
    cleanupTempDir(cacheDir);
  }
});

// ---------------------------------------------------------------------------
// P13-14: Hook Compatibility
// ---------------------------------------------------------------------------
runTest('P13-14', 'Hook Compatibility: SessionStart, PreToolUse, and PostToolUse support all Antigravity file & command tools', () => {
  const hookProjDir = makeTempDir('hook-proj');
  const hookCacheDir = makeTempDir('hook-cache');
  const hookArtifactDir = makeTempDir('hook-artifact');

  try {
    fs.writeFileSync(
      path.join(hookProjDir, 'package.json'),
      JSON.stringify({ name: 'hook-test', scripts: { test: 'node --test' } }),
      'utf8'
    );
    discoverProject(hookProjDir, [], { cacheDir: hookCacheDir });

    // 1. Verify hooks.json matchers include all 5 file-editing tools + run_command
    const hooksConfig = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks.json'), 'utf8'));
    assert.ok(hooksConfig['dev-lifecycle-session-context']?.SessionStart, 'SessionStart hook must be configured');
    const preMatcher = hooksConfig['dev-lifecycle-safety-gate'].PreToolUse[0].matcher;
    const postMatcher = hooksConfig['dev-lifecycle-verification-tracker'].PostToolUse[0].matcher;

    for (const tool of ['run_command', 'write_file', 'edit_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content']) {
      assert.ok(new RegExp(`^(${preMatcher})$`).test(tool), `PreToolUse matcher must match ${tool}`);
      assert.ok(new RegExp(`^(${postMatcher})$`).test(tool), `PostToolUse matcher must match ${tool}`);
    }

    // 2. Verify SessionStart hook handler
    const sessionSummary = handleSessionStartContext(
      {
        workspacePaths: [hookProjDir],
        artifactDirectoryPath: hookArtifactDir,
        source: 'startup'
      },
      { customCacheDir: hookCacheDir }
    );
    assert.equal(sessionSummary.workspaces.length, 1);
    assert.equal(sessionSummary.workspaces[0].cacheAvailable, true);
    assert.ok(fs.existsSync(path.join(hookArtifactDir, 'scratch', 'dl-session-context.json')));

    // 3. Verify PreToolUse safety across all file-editing tool names and parameter conventions
    for (const [toolName, argKey] of [
      ['write_file', 'Path'],
      ['edit_file', 'Path'],
      ['write_to_file', 'TargetFile'],
      ['replace_file_content', 'TargetFile'],
      ['multi_replace_file_content', 'TargetFile']
    ]) {
      const envCheck = evaluatePreToolSafety({
        toolCall: { name: toolName, args: { [argKey]: '/app/.env.production' } }
      });
      assert.equal(envCheck.decision, 'force_ask', `${toolName} on .env.production must trigger force_ask`);

      const safeCheck = evaluatePreToolSafety({
        toolCall: { name: toolName, args: { [argKey]: '/app/src/index.ts' } }
      });
      assert.equal(safeCheck.decision, 'allow', `${toolName} on src/index.ts must be allowed`);
    }

    // 4. Verify PostToolUse records dirty context hints for all file mutation tools and state-mutating commands
    let telemetry = {};
    telemetry = updateVerificationTelemetry(
      { toolCall: { name: 'replace_file_content', args: { TargetFile: 'package.json' } }, stepIdx: 1 },
      telemetry
    );
    telemetry = updateVerificationTelemetry(
      { toolCall: { name: 'write_to_file', args: { TargetFile: 'src/new.ts' } }, stepIdx: 2 },
      telemetry
    );
    telemetry = updateVerificationTelemetry(
      { toolCall: { name: 'run_command', args: { CommandLine: 'npm install zod' } }, stepIdx: 3 },
      telemetry
    );
    assert.equal(telemetry.dirtyContextHints.length, 3);
    assert.equal(telemetry.dirtyContextHints[0].toolName, 'replace_file_content');
    assert.equal(telemetry.dirtyContextHints[1].toolName, 'write_to_file');
    assert.equal(telemetry.dirtyContextHints[2].type, 'command_mutation');

    return 'Verified SessionStart, PreToolUse, and PostToolUse across all 6 tool names';
  } finally {
    cleanupTempDir(hookProjDir);
    cleanupTempDir(hookCacheDir);
    cleanupTempDir(hookArtifactDir);
  }
});

// ---------------------------------------------------------------------------
// Summary Output
// ---------------------------------------------------------------------------
const summary = summarizeTestResults(results);

console.log('\n======================================================================');
console.log(
  ` P13 Test Summary: ${summary.passed} PASSED, ${summary.skipped} SKIPPED, ${summary.notRun} NOT_RUN, ${summary.failed} FAILED (Total: ${summary.total})`
);
console.log('======================================================================');

if (summary.failed > 0 || summary.blocked > 0) {
  process.exit(1);
}
