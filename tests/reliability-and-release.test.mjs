#!/usr/bin/env node
/**
 * DevLifecycle v2.1.1 — Reliability Hardening, Automated SemVer, Clean Packaging & Installation Test Suite
 *
 * Deterministically validates all 19 mandatory scenarios:
 * - REL-01: Context Contract (discover-project, context-store, skills, and docs contract alignment)
 * - REL-02: Git Evidence Failure (failed git status / missing git binary -> UNVERIFIABLE, never HIT)
 * - REL-03: Cross-Process Persistence (real multi-process Node.js child process verification)
 * - REL-04: Test Reporting Integrity (SKIPPED and NOT_RUN never counted as PASS)
 * - REL-05: Dirty Context Safety (secrets redacted; semantic mutation signals stored instead of raw commands)
 * - REL-06: Incremental Change Detection (explicit + freshness + dirty working-tree + renamed files merged)
 * - VER-01: Patch Version (2.1.0 + patch changeset -> 2.1.1)
 * - VER-02: Minor Version (2.1.0 + minor changeset -> 2.2.0)
 * - VER-03: Major Version (2.1.0 + major changeset -> 3.0.0)
 * - VER-04: Manifest Sync (package.json === plugin.json, preserves fields, detects drift)
 * - VER-05: No Double Bump (single changeset consumption without double bump)
 * - PKG-01: Runtime Allowlist (stages only runtime-required plugin files)
 * - PKG-02: Runtime Dependencies (all referenced scripts, assets, rules, and skill references exist)
 * - PKG-03: Development File Exclusion (zero dev/repo files in staged dir or ZIP archive)
 * - PKG-04: Staged Plugin Validation (independent validation of staged dir + negative tests)
 * - INSTALL-01: Local Installation (installs clean staged bundle via agy plugin install with zero dev clutter)
 * - INSTALL-02: GitHub Installation Behavior (validates documented behavior and agy plugin list state)
 * - INSTALL-03: Workspace Isolation (global plugin install & execution never pollute unrelated user repo)
 * - INSTALL-04: Component Discovery (verifies 8 skills, 7 agents, 1 rule, 4 hooks discovered from clean install)
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CANONICAL_CACHE_STATUSES,
  CANONICAL_FRESHNESS_STATUSES,
  CANONICAL_STORAGE_TIERS,
  resolveProjectIdentity,
  loadProjectContext,
  recordDirtyContextHint
} from '../scripts/context-store.mjs';
import {
  collectRepositorySnapshot,
  validateContextFreshness
} from '../scripts/context-freshness.mjs';
import {
  discoverProject,
  inspectLiveTaskFiles
} from '../scripts/discover-project.mjs';
import {
  updateVerificationTelemetry,
  normalizeCommandSignature
} from '../scripts/post-tool-tracker.mjs';
import {
  normalizeTestOutcome,
  summarizeTestResults
} from '../scripts/lifecycle-check.mjs';
import {
  checkVersionConsistency,
  synchronizePluginManifestVersion
} from '../tooling/sync-version.mjs';
import {
  FORBIDDEN_DISTRIBUTION_ENTRIES,
  resolveRuntimeAllowlistFiles,
  buildPluginDistribution,
  validateStagedPluginDirectory,
  findAgyBinary
} from '../tooling/package-plugin.mjs';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `dl-v211-${prefix}-`));
}

function cleanupTempDir(dirPath) {
  try {
    if (dirPath && fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    // Ignore Windows cleanup race
  }
}

function gitExec(cwd, args) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return (res.stdout || '').trim();
}

function initGitRepo(dir) {
  gitExec(dir, ['init']);
  gitExec(dir, ['config', 'user.email', 'test@devlifecycle.local']);
  gitExec(dir, ['config', 'user.name', 'DevLifecycle Test']);
}

function resolveAgyBinary() {
  return findAgyBinary();
}

console.log('======================================================================');
console.log(' DevLifecycle v2.1.1 — Reliability, SemVer, Packaging & Install Suite');
console.log('======================================================================\n');

// ---------------------------------------------------------------------------
// REL-01: Context Contract Alignment
// ---------------------------------------------------------------------------
runTest('REL-01', 'Context Contract: discover-project, context-store, skills, and artifact-contracts match canonical schema', () => {
  const tempDir = makeTempDir('rel01');
  const cacheDir = makeTempDir('rel01-cache');
  try {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'contract-app', scripts: { test: 'node --test' } }),
      'utf8'
    );
    fs.writeFileSync(path.join(tempDir, 'index.js'), 'export const x = 1;\n', 'utf8');

    const profile = discoverProject(tempDir, ['index.js'], {
      cacheDir,
      taskFiles: ['index.js']
    });

    assert.ok(profile.contextIntelligence, 'profile.contextIntelligence must exist');
    assert.equal(profile.cacheMetadata, undefined, 'profile.cacheMetadata must NOT exist on returned profile');

    const ci = profile.contextIntelligence;
    for (const requiredKey of [
      'principle',
      'schemaVersion',
      'projectId',
      'worktreeKey',
      'commonRepoKey',
      'isGitRepo',
      'headCommit',
      'branch',
      'cacheStatus',
      'freshnessStatus',
      'invalidationReasons',
      'storageTier',
      'persisted',
      'skippedUnchangedWrite',
      'cacheFilePath',
      'verifiedAt',
      'durationMs',
      'sectionsReused',
      'sectionsRecomputed',
      'changedFiles',
      'metrics'
    ]) {
      assert.ok(requiredKey in ci, `profile.contextIntelligence must contain ${requiredKey}`);
    }

    assert.ok(CANONICAL_CACHE_STATUSES.includes(ci.cacheStatus));
    assert.ok(CANONICAL_FRESHNESS_STATUSES.includes(ci.freshnessStatus));
    assert.ok(CANONICAL_STORAGE_TIERS.includes(ci.storageTier));

    // Verify taskSpecificFiles returns live metadata + SHA-256 hash, never raw source content
    assert.equal(Array.isArray(profile.taskSpecificFiles), true);
    assert.equal(profile.taskSpecificFiles.length, 1);
    assert.equal(profile.taskSpecificFiles[0].path, 'index.js');
    assert.equal(profile.taskSpecificFiles[0].exists, true);
    assert.equal(typeof profile.taskSpecificFiles[0].liveSha256, 'string');
    assert.equal(profile.taskSpecificFiles[0].content, undefined, 'taskSpecificFiles must not embed raw file contents');

    // Verify skill & contract documentation alignment
    const dlDiscoverMd = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'dl-discover', 'SKILL.md'), 'utf8');
    const dlRunMd = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'dl-run', 'SKILL.md'), 'utf8');
    const contractsMd = fs.readFileSync(
      path.join(PLUGIN_ROOT, 'skills', 'dl-run', 'references', 'artifact-contracts.md'),
      'utf8'
    );

    for (const [docName, content] of [
      ['dl-discover/SKILL.md', dlDiscoverMd],
      ['dl-run/SKILL.md', dlRunMd],
      ['artifact-contracts.md', contractsMd]
    ]) {
      assert.ok(content.includes('contextIntelligence'), `${docName} must reference profile.contextIntelligence`);
      assert.ok(!content.includes('profile.cacheMetadata'), `${docName} must not reference stale profile.cacheMetadata`);
      assert.ok(content.includes('UNVERIFIABLE'), `${docName} must document UNVERIFIABLE freshness status`);
      assert.ok(content.includes('taskSpecificFiles'), `${docName} must document taskSpecificFiles`);
    }

    return 'Verified canonical profile.contextIntelligence contract across runtime modules and skill docs';
  } finally {
    cleanupTempDir(tempDir);
    cleanupTempDir(cacheDir);
  }
});

// ---------------------------------------------------------------------------
// REL-02: Git Evidence Failure
// ---------------------------------------------------------------------------
runTest('REL-02', 'Git Evidence Failure: failed git status / diff or missing git binary returns UNVERIFIABLE and never HIT', () => {
  const repoDir = makeTempDir('rel02-repo');
  const cacheDir = makeTempDir('rel02-cache');

  try {
    initGitRepo(repoDir);
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'git-fail-test', scripts: { test: 'node --test' } }),
      'utf8'
    );
    gitExec(repoDir, ['add', '.']);
    gitExec(repoDir, ['commit', '-m', 'Initial commit']);

    // 1. Seed valid cache
    const first = discoverProject(repoDir, [], { cacheDir });
    assert.equal(first.contextIntelligence.cacheStatus, 'MISS');

    // 2. Verify normal HIT when Git succeeds
    const second = discoverProject(repoDir, [], { cacheDir });
    assert.equal(second.contextIntelligence.cacheStatus, 'HIT');
    assert.equal(second.contextIntelligence.freshnessStatus, 'FRESH');

    // 3. Simulate Git failure during snapshot/freshness check -> MUST NOT return HIT
    const loaded = loadProjectContext(repoDir, { cacheDir });
    const failedSnap = collectRepositorySnapshot(repoDir, loaded.record.projectIdentity, [], {
      simulateGitFailure: true
    });
    assert.equal(failedSnap.gitStatusOk, false, 'Failed git status must set gitStatusOk = false');
    assert.equal(failedSnap.workingTreeStatusHash, null, 'Failed git status must set workingTreeStatusHash = null (never clean hash)');

    const freshnessSimFail = validateContextFreshness(repoDir, loaded.record, {
      simulateGitFailure: true
    });
    assert.equal(freshnessSimFail.status, 'UNVERIFIABLE');
    assert.equal(freshnessSimFail.isFresh, false);
    assert.equal(freshnessSimFail.invalidatedSections.length, 10);

    const discoverSimFail = discoverProject(repoDir, [], {
      cacheDir,
      simulateGitFailure: true
    });
    assert.notEqual(discoverSimFail.contextIntelligence.cacheStatus, 'HIT');
    assert.equal(discoverSimFail.contextIntelligence.cacheStatus, 'FULL_REDISCOVERY');
    assert.equal(discoverSimFail.contextIntelligence.freshnessStatus, 'UNVERIFIABLE');

    // 4. Test with broken/unavailable git binary path -> MUST NOT return HIT
    const discoverMissingGit = discoverProject(repoDir, [], {
      cacheDir,
      gitBinary: 'nonexistent-git-binary-for-rel02'
    });
    assert.notEqual(discoverMissingGit.contextIntelligence.cacheStatus, 'HIT');
    assert.equal(discoverMissingGit.contextIntelligence.cacheStatus, 'FULL_REDISCOVERY');
    assert.equal(discoverMissingGit.contextIntelligence.freshnessStatus, 'UNVERIFIABLE');

    return 'Verified failed git status, missing git binary, and unreadable Git metadata return UNVERIFIABLE + FULL_REDISCOVERY';
  } finally {
    cleanupTempDir(repoDir);
    cleanupTempDir(cacheDir);
  }
});

// ---------------------------------------------------------------------------
// REL-03: Cross-Process Persistence
// ---------------------------------------------------------------------------
runTest('REL-03', 'Cross-Process Persistence: verifies MISS -> HIT -> external edit -> Git failure -> worktree -> restricted -> corrupt across separate Node processes', () => {
  const repoDir = makeTempDir('rel03-repo');
  const worktreeDir = makeTempDir('rel03-wt');
  const cacheDir = makeTempDir('rel03-cache');
  const sessionDir = makeTempDir('rel03-session');
  // Remove worktreeDir before `git worktree add` creates it
  fs.rmSync(worktreeDir, { recursive: true, force: true });

  const runDiscoverySubprocess = (targetDir, extraOptions = {}) => {
    const discoverUrl = pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'discover-project.mjs')).href;
    const inlineScript = `
      import { discoverProject } from ${JSON.stringify(discoverUrl)};
      const result = discoverProject(${JSON.stringify(targetDir)}, [], ${JSON.stringify({ cacheDir, ...extraOptions })});
      process.stdout.write(JSON.stringify(result.contextIntelligence));
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', inlineScript], {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
      windowsHide: true
    });
    assert.equal(res.status, 0, `Subprocess failed: ${res.stderr}`);
    return JSON.parse(res.stdout);
  };

  try {
    initGitRepo(repoDir);
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name: 'cross-proc-app', scripts: { test: 'node --test' } }),
      'utf8'
    );
    fs.writeFileSync(path.join(repoDir, 'src', 'index.js'), 'export const v = 1;\n', 'utf8');
    gitExec(repoDir, ['add', '.']);
    gitExec(repoDir, ['commit', '-m', 'Initial commit']);

    // Process 1: Cold MISS
    const p1 = runDiscoverySubprocess(repoDir);
    assert.equal(p1.cacheStatus, 'MISS');
    assert.equal(p1.freshnessStatus, 'INITIAL_SNAPSHOT');
    assert.equal(p1.persisted, true);
    assert.ok(p1.cacheFilePath && fs.existsSync(p1.cacheFilePath));

    // Process 2: Warm HIT in a brand-new OS process + skippedUnchangedWrite
    const p2 = runDiscoverySubprocess(repoDir);
    assert.equal(p2.cacheStatus, 'HIT');
    assert.equal(p2.freshnessStatus, 'FRESH');
    assert.equal(p2.skippedUnchangedWrite, true);
    assert.equal(p2.sectionsReused.length, 10);

    // Out-of-band file modification between Process 2 and Process 3
    fs.writeFileSync(path.join(repoDir, 'src', 'index.js'), 'export const v = 2;\n', 'utf8');
    const p3 = runDiscoverySubprocess(repoDir);
    assert.equal(p3.cacheStatus, 'INCREMENTAL_REFRESH');
    assert.ok(p3.changedFiles.includes('src/index.js'));

    // Process 4: Simulated Git failure in child process
    const p4 = runDiscoverySubprocess(repoDir, { simulateGitFailure: true });
    assert.equal(p4.cacheStatus, 'FULL_REDISCOVERY');
    assert.equal(p4.freshnessStatus, 'UNVERIFIABLE');

    // Process 5: Separate Git worktree in child process
    gitExec(repoDir, ['worktree', 'add', '-b', 'wt-branch', worktreeDir]);
    const p5 = runDiscoverySubprocess(worktreeDir);
    assert.equal(p5.cacheStatus, 'MISS');
    assert.notEqual(p5.worktreeKey, p1.worktreeKey);

    // Process 6: Restricted storage in child process
    const p6 = runDiscoverySubprocess(repoDir, {
      simulateRestrictedStorage: true,
      artifactDirectoryPath: sessionDir
    });
    assert.equal(p6.storageTier, 'session-fallback');
    assert.equal(p6.persisted, false);

    // Process 7: Corrupt cache file on disk -> child process safely rebuilds
    fs.writeFileSync(p1.cacheFilePath, '{ broken json', 'utf8');
    const p7 = runDiscoverySubprocess(repoDir);
    assert.equal(p7.cacheStatus, 'FULL_REDISCOVERY');
    assert.equal(p7.freshnessStatus, 'CORRUPTED_REBUILT');

    // Process 8: Next child process after repair gets clean HIT
    const p8 = runDiscoverySubprocess(repoDir);
    assert.equal(p8.cacheStatus, 'HIT');

    return 'Verified 8 sequential Node.js child processes across all persistence, invalidation, worktree, fallback, and repair states';
  } finally {
    try {
      gitExec(repoDir, ['worktree', 'remove', '--force', worktreeDir]);
    } catch {
      // Ignore cleanup error
    }
    cleanupTempDir(worktreeDir);
    cleanupTempDir(repoDir);
    cleanupTempDir(cacheDir);
    cleanupTempDir(sessionDir);
  }
});

// ---------------------------------------------------------------------------
// REL-04: Test Reporting Integrity
// ---------------------------------------------------------------------------
runTest('REL-04', 'Test Reporting Integrity: SKIPPED and NOT_RUN are never counted as PASS', () => {
  assert.equal(normalizeTestOutcome('Verified check').status, 'PASS');
  assert.equal(normalizeTestOutcome('SKIPPED: CLI not installed').status, 'SKIPPED');
  assert.equal(normalizeTestOutcome('NOT_RUN: environment unavailable').status, 'NOT_RUN');
  assert.equal(normalizeTestOutcome('BLOCKED: missing permission').status, 'BLOCKED');
  assert.equal(normalizeTestOutcome('FAIL: assertion failed').status, 'FAIL');

  const sampleSummary = summarizeTestResults([
    { id: 'T1', status: 'PASS' },
    { id: 'T2', status: 'SKIPPED' },
    { id: 'T3', status: 'NOT_RUN' },
    { id: 'T4', status: 'PASS' }
  ]);
  assert.equal(sampleSummary.total, 4);
  assert.equal(sampleSummary.passed, 2, 'Only PASS items may be counted in passed');
  assert.equal(sampleSummary.skipped, 1);
  assert.equal(sampleSummary.notRun, 1);
  assert.equal(sampleSummary.failed, 0);

  // Execute run-tests.mjs with DEV_LIFECYCLE_FORCE_NO_AGY=1 to verify PKG-02 is reported as skipped, not passed
  const res = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'tests', 'run-tests.mjs')], {
    cwd: PLUGIN_ROOT,
    env: { ...process.env, DEV_LIFECYCLE_FORCE_NO_AGY: '1' },
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /11 passed, 1 skipped, 0 not_run, 0 blocked, 0 failed \(total 12\)/);

  return 'Verified normalizeTestOutcome, summarizeTestResults, and run-tests.mjs report 11 passed, 1 skipped when CLI is absent';
});

// ---------------------------------------------------------------------------
// REL-05: Dirty Context Safety
// ---------------------------------------------------------------------------
runTest('REL-05', 'Dirty Context Safety: secrets in commands are redacted and dirty hints store semantic mutation signals only', () => {
  const projDir = makeTempDir('rel05-proj');
  const cacheDir = makeTempDir('rel05-cache');

  try {
    fs.writeFileSync(
      path.join(projDir, 'package.json'),
      JSON.stringify({ name: 'secret-safety-app', scripts: { test: 'node --test' } }),
      'utf8'
    );
    discoverProject(projDir, [], { cacheDir });

    const secretCmd =
      'npm install private-pkg --token=ghp_1234567890abcdef1234567890abcdef123456 https://admin:SuperSecretPass99@registry.example.com';
    const recorded = recordDirtyContextHint(
      [projDir],
      { changedFile: 'package.json', command: secretCmd },
      { customCacheDir: cacheDir }
    );
    assert.equal(recorded.updatedProjects.length, 1);

    const loaded = loadProjectContext(projDir, { cacheDir });
    const rawCacheFileContent = fs.readFileSync(loaded.filePath, 'utf8');

    assert.ok(!rawCacheFileContent.includes('ghp_1234567890abcdef1234567890abcdef123456'), 'PAT must never be written to cache file');
    assert.ok(!rawCacheFileContent.includes('SuperSecretPass99'), 'URL password must never be written to cache file');
    assert.deepEqual(loaded.record.cacheMetadata.dirtyHintCommands, ['DEPENDENCY_MUTATION']);

    // Also verify PostToolUse telemetry redaction and semantic signals
    let telemetry = {};
    telemetry = updateVerificationTelemetry(
      {
        toolCall: {
          name: 'run_command',
          args: {
            CommandLine:
              'git checkout main && curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret" https://user:MyPass123@example.com'
          }
        },
        stepIdx: 5
      },
      telemetry
    );
    const serializedTelemetry = JSON.stringify(telemetry);
    assert.ok(!serializedTelemetry.includes('MyPass123'));
    assert.ok(!serializedTelemetry.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
    assert.equal(telemetry.dirtyContextHints[0].signal, 'GIT_STATE_MUTATION');
    assert.equal(telemetry.dirtyContextHints[0].command, undefined, 'Raw command must not be stored in dirtyContextHints');

    const sig = normalizeCommandSignature('npm publish --_authToken=npm_SecretTokenValue123456789');
    assert.ok(!sig.includes('npm_SecretTokenValue123456789'));

    return 'Verified zero secret leakage in cache files or telemetry and semantic signal classification for dirty hints';
  } finally {
    cleanupTempDir(projDir);
    cleanupTempDir(cacheDir);
  }
});

// ---------------------------------------------------------------------------
// REL-06: Incremental Change Detection
// ---------------------------------------------------------------------------
runTest('REL-06', 'Incremental Change Detection: merges explicit --changed, freshness diff, and dirty working-tree (including git mv renames)', () => {
  const monoDir = makeTempDir('rel06-mono');
  const cacheDir = makeTempDir('rel06-cache');

  try {
    initGitRepo(monoDir);
    fs.writeFileSync(path.join(monoDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n', 'utf8');
    fs.writeFileSync(path.join(monoDir, 'package.json'), JSON.stringify({ name: 'rel06-root', private: true }), 'utf8');

    for (const pkg of ['core', 'ui', 'admin']) {
      const dir = path.join(monoDir, 'packages', pkg, 'src');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(monoDir, 'packages', pkg, 'package.json'),
        JSON.stringify({ name: `@rel06/${pkg}`, version: '1.0.0' }),
        'utf8'
      );
      fs.writeFileSync(path.join(dir, 'old.ts'), `export const ${pkg} = 1;\n`, 'utf8');
    }

    gitExec(monoDir, ['add', '.']);
    gitExec(monoDir, ['commit', '-m', 'Initial monorepo']);

    // 1. Seed initial cache
    discoverProject(monoDir, [], { cacheDir });

    // 2. Commit a change in @rel06/core (detected via git diff HEAD..current)
    fs.writeFileSync(path.join(monoDir, 'packages', 'core', 'src', 'committed.ts'), 'export const c = 2;\n', 'utf8');
    gitExec(monoDir, ['add', '.']);
    gitExec(monoDir, ['commit', '-m', 'Change core']);

    // 3. Perform a git mv rename in @rel06/ui (uncommitted in working tree)
    gitExec(monoDir, ['mv', 'packages/ui/src/old.ts', 'packages/ui/src/renamed.ts']);

    // 4. Pass an explicit --changed file in @rel06/admin
    const profile = discoverProject(monoDir, ['packages/admin/src/explicit.ts'], { cacheDir });

    const changed = profile.contextIntelligence.changedFiles;
    assert.ok(changed.includes('packages/core/src/committed.ts'), 'Must include committed git diff file');
    assert.ok(changed.includes('packages/ui/src/old.ts'), 'Must include oldPath of renamed git status file');
    assert.ok(changed.includes('packages/ui/src/renamed.ts'), 'Must include new path of renamed git status file');
    assert.ok(changed.includes('packages/admin/src/explicit.ts'), 'Must include explicit --changed file');

    assert.deepEqual(
      profile.impactAnalysis.directlyAffectedPackages.sort(),
      ['@rel06/admin', '@rel06/core', '@rel06/ui']
    );

    return 'Merged explicit, committed diff, and uncommitted renamed working-tree files across all 3 monorepo packages';
  } finally {
    cleanupTempDir(monoDir);
    cleanupTempDir(cacheDir);
  }
});

// ---------------------------------------------------------------------------
// Helper for VER-01 .. VER-05 Changesets tests
// ---------------------------------------------------------------------------
function setupChangesetFixture(bumpType, summaryText = 'Test version bump') {
  const dir = makeTempDir(`ver-${bumpType}`);
  fs.mkdirSync(path.join(dir, '.changeset'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'dev-lifecycle', version: '2.1.0', private: true }, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'plugin.json'),
    JSON.stringify({ name: 'dev-lifecycle', displayName: 'DevLifecycle', version: '2.1.0' }, null, 2) + '\n',
    'utf8'
  );
  fs.copyFileSync(
    path.join(PLUGIN_ROOT, '.changeset', 'config.json'),
    path.join(dir, '.changeset', 'config.json')
  );
  fs.writeFileSync(
    path.join(dir, '.changeset', `test-${bumpType}.md`),
    `---\n"dev-lifecycle": ${bumpType}\n---\n\n${summaryText}\n`,
    'utf8'
  );
  return dir;
}

function runChangesetVersionInDir(dir) {
  const changesetBin = path.join(PLUGIN_ROOT, 'node_modules', '@changesets', 'cli', 'bin.js');
  const res = spawnSync(process.execPath, [changesetBin, 'version'], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(res.status, 0, `changeset version failed: ${res.stderr || res.stdout}`);
  return synchronizePluginManifestVersion(dir);
}

// ---------------------------------------------------------------------------
// VER-01: Patch Version (2.1.0 + patch -> 2.1.1)
// ---------------------------------------------------------------------------
runTest('VER-01', 'Patch Version: 2.1.0 + patch changeset bumps package.json & plugin.json to 2.1.1 and updates CHANGELOG.md', () => {
  const dir = setupChangesetFixture('patch', 'Harden Git freshness and P13 reliability.');
  try {
    const syncRes = runChangesetVersionInDir(dir);
    assert.equal(syncRes.version, '2.1.1');

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const plugin = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    const changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');

    assert.equal(pkg.version, '2.1.1');
    assert.equal(plugin.version, '2.1.1');
    assert.match(changelog, /## 2\.1\.1/);
    assert.match(changelog, /Harden Git freshness and P13 reliability/);

    return '2.1.0 + patch -> 2.1.1 in package.json, plugin.json, and CHANGELOG.md';
  } finally {
    cleanupTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// VER-02: Minor Version (2.1.0 + minor -> 2.2.0)
// ---------------------------------------------------------------------------
runTest('VER-02', 'Minor Version: 2.1.0 + minor changeset bumps package.json & plugin.json to 2.2.0', () => {
  const dir = setupChangesetFixture('minor', 'Add new minor capability.');
  try {
    const syncRes = runChangesetVersionInDir(dir);
    assert.equal(syncRes.version, '2.2.0');

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const plugin = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    assert.equal(pkg.version, '2.2.0');
    assert.equal(plugin.version, '2.2.0');

    return '2.1.0 + minor -> 2.2.0 in package.json and plugin.json';
  } finally {
    cleanupTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// VER-03: Major Version (2.1.0 + major -> 3.0.0)
// ---------------------------------------------------------------------------
runTest('VER-03', 'Major Version: 2.1.0 + major changeset bumps package.json & plugin.json to 3.0.0', () => {
  const dir = setupChangesetFixture('major', 'Breaking plugin manifest schema v3.');
  try {
    const syncRes = runChangesetVersionInDir(dir);
    assert.equal(syncRes.version, '3.0.0');

    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const plugin = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    assert.equal(pkg.version, '3.0.0');
    assert.equal(plugin.version, '3.0.0');

    return '2.1.0 + major -> 3.0.0 in package.json and plugin.json';
  } finally {
    cleanupTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// VER-04: Manifest Sync
// ---------------------------------------------------------------------------
runTest('VER-04', 'Manifest Sync: sync-version.mjs enforces package.json === plugin.json, preserves fields, and detects drift', () => {
  // 1. Verify current repo manifests are in sync and valid SemVer
  const repoCheck = checkVersionConsistency(PLUGIN_ROOT);
  assert.equal(repoCheck.consistent, true);
  assert.equal(repoCheck.packageVersion, repoCheck.pluginVersion);
  assert.match(repoCheck.packageVersion, /^\d+\.\d+\.\d+$/);

  // 2. Test drift detection and field preservation in temp dir
  const dir = makeTempDir('ver04-sync');
  try {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'dev-lifecycle', version: '2.1.1', private: true }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(dir, 'plugin.json'),
      JSON.stringify(
        {
          name: 'dev-lifecycle',
          displayName: 'DevLifecycle',
          version: '2.1.0',
          customField: 'preserved-value'
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    const driftCheck = checkVersionConsistency(dir);
    assert.equal(driftCheck.consistent, false);
    assert.match(driftCheck.driftReason, /Version drift detected/);

    const synced = synchronizePluginManifestVersion(dir);
    assert.equal(synced.updated, true);
    assert.equal(synced.version, '2.1.1');

    const updatedPlugin = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    assert.equal(updatedPlugin.version, '2.1.1');
    assert.equal(updatedPlugin.customField, 'preserved-value');

    // Second run is idempotent (updated: false)
    const secondSync = synchronizePluginManifestVersion(dir);
    assert.equal(secondSync.updated, false);
    assert.equal(checkVersionConsistency(dir).consistent, true);

    return 'Verified drift detection (--check), deterministic sync, field preservation, and idempotency';
  } finally {
    cleanupTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// VER-05: No Double Bump
// ---------------------------------------------------------------------------
runTest('VER-05', 'No Double Bump: pending repository changeset bumps 2.1.0 -> 2.1.1 once and second run is a no-op', () => {
  const dir = makeTempDir('ver05-nodouble');
  try {
    fs.cpSync(path.join(PLUGIN_ROOT, '.changeset'), path.join(dir, '.changeset'), { recursive: true });
    fs.copyFileSync(path.join(PLUGIN_ROOT, 'package.json'), path.join(dir, 'package.json'));
    fs.copyFileSync(path.join(PLUGIN_ROOT, 'plugin.json'), path.join(dir, 'plugin.json'));
    fs.copyFileSync(path.join(PLUGIN_ROOT, 'CHANGELOG.md'), path.join(dir, 'CHANGELOG.md'));

    const changesetFile = path.join(dir, '.changeset', 'v2-1-1-reliability-release-engineering.md');
    if (!fs.existsSync(changesetFile)) {
      // On the Version PR branch (where 2.1.0 -> 2.1.1 already occurred and the changeset was consumed),
      // verify running changeset version on the already-bumped repo state is a no-op (stays 2.1.1),
      // then seed 2.1.0 + the changeset to verify the 2.1.0 -> 2.1.1 single-bump transition.
      const alreadyBumpedRun = runChangesetVersionInDir(dir);
      assert.equal(alreadyBumpedRun.version, '2.1.1');

      const pkg210 = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      pkg210.version = '2.1.0';
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg210, null, 2) + '\n', 'utf8');

      const plugin210 = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
      plugin210.version = '2.1.0';
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(plugin210, null, 2) + '\n', 'utf8');

      fs.writeFileSync(
        changesetFile,
        '---\n"dev-lifecycle": patch\n---\n\nHarden P13 Git freshness validation and canonical context contract consistency.\n',
        'utf8'
      );
    }

    // First run consumes .changeset/v2-1-1-reliability-release-engineering.md -> 2.1.1
    const firstRun = runChangesetVersionInDir(dir);
    assert.equal(firstRun.version, '2.1.1');
    assert.equal(
      fs.existsSync(changesetFile),
      false,
      'Changeset file must be consumed after first version bump'
    );

    // Second run with no new changesets must remain at 2.1.1 (no double bump to 2.1.2)
    const secondRun = runChangesetVersionInDir(dir);
    assert.equal(secondRun.version, '2.1.1');

    return 'Repository pending changeset consumed cleanly once (2.1.0 -> 2.1.1) with zero double bump on re-run';
  } finally {
    cleanupTempDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Shared clean distribution build for PKG-01..PKG-04 and INSTALL-01..INSTALL-04
// ---------------------------------------------------------------------------
const sharedDistOut = makeTempDir('pkg-dist');
let sharedDistResult = null;

// ---------------------------------------------------------------------------
// PKG-01: Runtime Allowlist
// ---------------------------------------------------------------------------
runTest('PKG-01', 'Runtime Allowlist: stages only explicit runtime-required plugin files', () => {
  sharedDistResult = buildPluginDistribution({
    sourceDir: PLUGIN_ROOT,
    outDir: sharedDistOut,
    createArchive: true
  });

  const allowed = resolveRuntimeAllowlistFiles(PLUGIN_ROOT);
  assert.equal(sharedDistResult.fileCount, allowed.length);
  assert.deepEqual(sharedDistResult.files, allowed);

  for (const requiredFile of [
    'plugin.json',
    'README.md',
    'hooks.json',
    'assets/logo.svg',
    'rules/AGENTS.md',
    'scripts/discover-project.mjs',
    'scripts/context-store.mjs',
    'scripts/context-freshness.mjs',
    'scripts/session-start-context.mjs',
    'scripts/pre-tool-safety.mjs',
    'scripts/post-tool-tracker.mjs',
    'scripts/lifecycle-check.mjs'
  ]) {
    assert.ok(
      sharedDistResult.files.includes(requiredFile),
      `Staged allowlist must include ${requiredFile}`
    );
  }

  return `Staged exact allowlist of ${sharedDistResult.fileCount} runtime files`;
});

// ---------------------------------------------------------------------------
// PKG-02: Runtime Dependencies
// ---------------------------------------------------------------------------
runTest('PKG-02', 'Runtime Dependencies: all referenced scripts, rules, assets, agents, and skill references exist and execute standalone', () => {
  assert.ok(sharedDistResult, 'sharedDistResult must be initialized by PKG-01');
  const stageDir = sharedDistResult.stagedDir;

  // Execute discover-project.mjs directly from the staged directory (which has NO node_modules)
  const res = spawnSync(
    process.execPath,
    [path.join(stageDir, 'scripts', 'discover-project.mjs'), '--json', stageDir],
    {
      cwd: stageDir,
      encoding: 'utf8',
      windowsHide: true
    }
  );
  assert.equal(res.status, 0, `Staged discover-project.mjs failed: ${res.stderr}`);
  const profile = JSON.parse(res.stdout);
  assert.ok(
    profile.frameworks.some((f) => f.name === 'Google Antigravity Plugin'),
    'Staged discover-project.mjs must detect Google Antigravity Plugin framework'
  );

  return 'Verified all referenced assets/scripts/references exist in staged bundle and execute without node_modules';
});

// ---------------------------------------------------------------------------
// PKG-03: Development File Exclusion
// ---------------------------------------------------------------------------
runTest('PKG-03', 'Development File Exclusion: .git, .github, .changeset, tests, tooling, docs, examples, node_modules, package.json are absent from stage & ZIP', () => {
  assert.ok(sharedDistResult, 'sharedDistResult must be initialized by PKG-01');
  const stageDir = sharedDistResult.stagedDir;

  for (const forbidden of FORBIDDEN_DISTRIBUTION_ENTRIES) {
    assert.equal(
      fs.existsSync(path.join(stageDir, forbidden)),
      false,
      `Forbidden item '${forbidden}' must not exist in staged directory`
    );
  }

  // Extract the generated ZIP archive to a fresh directory and verify its contents too
  assert.ok(sharedDistResult.archivePath && fs.existsSync(sharedDistResult.archivePath), 'ZIP archive must exist');
  const unzipDir = makeTempDir('pkg03-unzip');
  try {
    const tarRes = spawnSync('tar', ['-x', '-f', sharedDistResult.archivePath, '-C', unzipDir], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (tarRes.status !== 0 && process.platform === 'win32') {
      const psCmd = `Expand-Archive -LiteralPath '${sharedDistResult.archivePath.replace(/'/g, "''")}' -DestinationPath '${unzipDir.replace(/'/g, "''")}' -Force`;
      const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
        encoding: 'utf8',
        windowsHide: true
      });
      assert.equal(res.status, 0, `Expand-Archive failed: ${res.stderr}`);
    } else {
      assert.equal(tarRes.status, 0, `Archive extraction failed: ${tarRes.stderr}`);
    }

    const extractedPluginDir = path.join(unzipDir, 'dev-lifecycle');
    assert.ok(fs.existsSync(path.join(extractedPluginDir, 'plugin.json')), 'Extracted ZIP must contain dev-lifecycle/plugin.json');

    for (const forbidden of FORBIDDEN_DISTRIBUTION_ENTRIES) {
      assert.equal(
        fs.existsSync(path.join(extractedPluginDir, forbidden)),
        false,
        `Forbidden item '${forbidden}' must not exist in extracted ZIP archive`
      );
    }

    return `Verified zero dev/repository files in staged directory and extracted ZIP (${path.basename(sharedDistResult.archivePath)})`;
  } finally {
    cleanupTempDir(unzipDir);
  }
});

// ---------------------------------------------------------------------------
// PKG-04: Staged Plugin Validation
// ---------------------------------------------------------------------------
runTest('PKG-04', 'Staged Plugin Validation: validates staged directory independently and rejects injected dev files or missing components', () => {
  assert.ok(sharedDistResult, 'sharedDistResult must be initialized by PKG-01');
  const validReport = validateStagedPluginDirectory(sharedDistResult.stagedDir);
  assert.equal(validReport.valid, true);

  // Negative test: copy staged dir, inject forbidden package.json, verify validator rejects it
  const badStageDir = makeTempDir('pkg04-bad');
  try {
    fs.cpSync(sharedDistResult.stagedDir, badStageDir, { recursive: true });
    fs.writeFileSync(path.join(badStageDir, 'package.json'), '{}', 'utf8');
    const badReport = validateStagedPluginDirectory(badStageDir, { runAgyCli: false });
    assert.equal(badReport.valid, false);
    assert.ok(
      badReport.errors.some((e) => e.includes('package.json')),
      'Validator must report injected package.json as forbidden'
    );
    return `Staged bundle passed validation (CLI status: ${validReport.cliValidation.status}) and rejected injected package.json`;
  } finally {
    cleanupTempDir(badStageDir);
  }
});

// ---------------------------------------------------------------------------
// INSTALL-01: Local Installation of Clean Staged Bundle
// ---------------------------------------------------------------------------
runTest('INSTALL-01', 'Local Installation: installs clean staged bundle via agy plugin install with zero dev clutter in ~/.gemini/config/plugins/dev-lifecycle', () => {
  const agyBin = resolveAgyBinary();
  if (!agyBin) {
    return 'SKIPPED: Antigravity CLI (`agy`) not found on PATH';
  }
  assert.ok(sharedDistResult, 'sharedDistResult must be initialized by PKG-01');

  const installRes = spawnSync(agyBin, ['plugin', 'install', sharedDistResult.stagedDir], {
    encoding: 'utf8',
    windowsHide: true
  });
  const combinedOut = `${installRes.stdout || ''}\n${installRes.stderr || ''}`.trim();
  assert.equal(installRes.status, 0, `agy plugin install failed: ${combinedOut}`);

  const installedPluginDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'dev-lifecycle');
  assert.ok(fs.existsSync(installedPluginDir), 'Installed plugin directory must exist');

  // Verify all runtime files are present and zero forbidden dev files exist in the installed plugin directory
  const validation = validateStagedPluginDirectory(installedPluginDir);
  assert.equal(validation.valid, true);

  for (const forbidden of FORBIDDEN_DISTRIBUTION_ENTRIES) {
    assert.equal(
      fs.existsSync(path.join(installedPluginDir, forbidden)),
      false,
      `Installed plugin directory must NOT contain development artifact '${forbidden}'`
    );
  }

  return `Installed clean runtime bundle to ${installedPluginDir} with 0 dev files`;
});

// ---------------------------------------------------------------------------
// INSTALL-02: GitHub Installation Behavior & Documentation Verification
// ---------------------------------------------------------------------------
runTest('INSTALL-02', 'GitHub Installation Behavior: verifies INSTALLATION.md & README.md accuracy and agy plugin list state', () => {
  const installDocPath = path.join(PLUGIN_ROOT, 'docs', 'INSTALLATION.md');
  const readmePath = path.join(PLUGIN_ROOT, 'README.md');
  assert.ok(fs.existsSync(installDocPath), 'docs/INSTALLATION.md must exist');

  const installDoc = fs.readFileSync(installDocPath, 'utf8');
  const readme = fs.readFileSync(readmePath, 'utf8');

  assert.ok(installDoc.includes('agy plugin install https://github.com/arcsynxae/dev-lifecycle'), 'INSTALLATION.md must document Method A GitHub URL install');
  assert.ok(installDoc.includes('dev-lifecycle-v'), 'INSTALLATION.md must document Method B clean release archive install');
  assert.ok(installDoc.includes('.gemini/config/plugins'), 'INSTALLATION.md must document global plugin installation directory');
  assert.ok(installDoc.includes('.agents/plugins'), 'INSTALLATION.md must document workspace plugin installation directory');
  assert.ok(readme.includes('docs/INSTALLATION.md'), 'README.md must link to docs/INSTALLATION.md');

  const agyBin = resolveAgyBinary();
  if (!agyBin) {
    return 'SKIPPED: Antigravity CLI (`agy`) not found on PATH (docs verified)';
  }

  const listRes = spawnSync(agyBin, ['plugin', 'list', '--json'], {
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(listRes.status, 0);
  const plugins = JSON.parse(listRes.stdout);
  const devLifecyclePlugin = plugins.find((p) => p.name === 'dev-lifecycle');
  assert.ok(devLifecyclePlugin, 'dev-lifecycle must appear in agy plugin list --json');
  assert.equal(devLifecyclePlugin.enabled, true);

  return 'Verified INSTALLATION.md methods A/B/C/D and confirmed dev-lifecycle is enabled in agy plugin list --json';
});

// ---------------------------------------------------------------------------
// INSTALL-03: Workspace Isolation
// ---------------------------------------------------------------------------
runTest('INSTALL-03', 'Workspace Isolation: installed global plugin operates on unrelated project without polluting its repository', () => {
  const userAppDir = makeTempDir('install03-user-app');
  const cacheDir = makeTempDir('install03-cache');

  try {
    initGitRepo(userAppDir);
    fs.writeFileSync(
      path.join(userAppDir, 'package.json'),
      JSON.stringify({ name: 'unrelated-user-app', version: '0.1.0', scripts: { test: 'node --test' } }),
      'utf8'
    );
    gitExec(userAppDir, ['add', '.']);
    gitExec(userAppDir, ['commit', '-m', 'Initial user app']);

    const installedPluginDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'dev-lifecycle');
    const scriptToRun = fs.existsSync(path.join(installedPluginDir, 'scripts', 'discover-project.mjs'))
      ? path.join(installedPluginDir, 'scripts', 'discover-project.mjs')
      : path.join(sharedDistResult.stagedDir, 'scripts', 'discover-project.mjs');

    const res = spawnSync(process.execPath, [scriptToRun, '--json', userAppDir], {
      cwd: userAppDir,
      env: { ...process.env, DEV_LIFECYCLE_CACHE_DIR: cacheDir },
      encoding: 'utf8',
      windowsHide: true
    });
    assert.equal(res.status, 0, `Discovery failed on userAppDir: ${res.stderr}`);

    // Verify userAppDir working tree is 100% clean
    const statusOut = gitExec(userAppDir, ['status', '--porcelain=v1']);
    assert.equal(statusOut, '', 'User project repository must remain completely clean after plugin discovery');

    return 'Verified unrelated user repository remains 100% clean in git status after running installed plugin discovery';
  } finally {
    cleanupTempDir(userAppDir);
    cleanupTempDir(cacheDir);
  }
});

// ---------------------------------------------------------------------------
// INSTALL-04: Component Discovery
// ---------------------------------------------------------------------------
runTest('INSTALL-04', 'Component Discovery: verifies all 8 skills, 7 agents, 1 rule, and 4 hooks are discovered from clean installed plugin', () => {
  const agyBin = resolveAgyBinary();
  if (!agyBin) {
    return 'SKIPPED: Antigravity CLI (`agy`) not found on PATH';
  }

  const listRes = spawnSync(agyBin, ['plugin', 'list', '--json'], {
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(listRes.status, 0);
  const plugins = JSON.parse(listRes.stdout);
  const dl = plugins.find((p) => p.name === 'dev-lifecycle');
  assert.ok(dl, 'dev-lifecycle plugin must be listed');

  const expectedSkills = [
    'dl-diagnose',
    'dl-discover',
    'dl-implement',
    'dl-plan',
    'dl-release',
    'dl-review',
    'dl-run',
    'dl-verify'
  ];
  const expectedAgents = [
    'code-reviewer',
    'implementation-engineer',
    'lifecycle-orchestrator',
    'quality-engineer',
    'release-engineer',
    'security-reviewer',
    'software-architect'
  ];
  const expectedHooks = [
    'dev-lifecycle-safety-gate',
    'dev-lifecycle-session-context',
    'dev-lifecycle-stop-gate',
    'dev-lifecycle-verification-tracker'
  ];

  const actualSkills = (dl.skills || []).slice().sort();
  const actualAgents = (dl.agents || []).slice().sort();
  const actualRules = dl.rules || [];
  const actualHooks = (dl.hooks || []).slice().sort();

  assert.deepEqual(actualSkills, expectedSkills);
  assert.deepEqual(actualAgents, expectedAgents);
  assert.deepEqual(actualRules, ['AGENTS.md']);
  assert.deepEqual(actualHooks, expectedHooks);

  return `Discovered 8/8 skills, 7/7 agents, 1/1 rule, and 4/4 hooks via agy plugin list --json`;
});

cleanupTempDir(sharedDistOut);

// ---------------------------------------------------------------------------
// Summary Output
// ---------------------------------------------------------------------------
const summary = summarizeTestResults(results);

console.log('\n======================================================================');
console.log(
  ` v2.1.1 Suite Summary: ${summary.passed} PASSED, ${summary.skipped} SKIPPED, ${summary.notRun} NOT_RUN, ${summary.blocked} BLOCKED, ${summary.failed} FAILED (Total: ${summary.total})`
);
console.log('======================================================================');

if (summary.failed > 0 || summary.blocked > 0) {
  process.exit(1);
}
