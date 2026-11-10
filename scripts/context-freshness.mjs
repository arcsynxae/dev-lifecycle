#!/usr/bin/env node
/**
 * DevLifecycle v2.1 — P13: Deterministic Context Freshness & Invalidation Engine
 *
 * Implements Section 7 (Context Freshness Engine):
 * - Validates cached Project Context Profiles against live repository state.
 * - Uses Git HEAD, branch, worktree identity, tracked/staged/untracked status,
 *   and revision diffs when Git is available (with conservative fallback when
 *   commit history cannot be compared).
 * - Uses selective file fingerprinting and directory structure checks for Non-Git
 *   repositories without hashing the entire source tree uncontrollably.
 * - Maps detected changes to the 10 granular context sections so only affected
 *   sections are invalidated and refreshed.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CONTEXT_SECTION_KEYS,
  canonicalizePath,
  resolveProjectIdentity,
  runGitSafe,
  sha256
} from './context-store.mjs';

const ROOT_MANIFEST_FILES = [
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'composer.json',
  'Makefile',
  'justfile',
  'plugin.json'
];

const LOCKFILES = [
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'uv.lock',
  'poetry.lock',
  'Cargo.lock',
  'go.sum',
  'composer.lock'
];

const WORKSPACE_CONFIG_FILES = [
  'pnpm-workspace.yaml',
  'turbo.json',
  'nx.json',
  'lerna.json',
  'go.work'
];

const INSTRUCTION_FILES = [
  'AGENTS.md',
  'GEMINI.md',
  'CLAUDE.md',
  'README.md',
  'CONTRIBUTING.md',
  'ARCHITECTURE.md',
  'rules/AGENTS.md'
];

const DEPLOYMENT_FILES = [
  'wrangler.toml',
  'wrangler.jsonc',
  'vercel.json',
  'netlify.toml',
  'Dockerfile',
  'docker-compose.yml',
  'compose.yaml',
  'fly.toml',
  'railway.json',
  'railway.toml'
];

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.astro',
  '.svelte-kit',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  'coverage',
  '.turbo',
  '.nx'
]);

/**
 * Compute file fingerprint (sha256, size, mtimeMs) safely.
 */
function fingerprintFile(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return null;
    const content = fs.readFileSync(absPath);
    return {
      sha256: sha256(content, 32),
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs)
    };
  } catch {
    return null;
  }
}

/**
 * List directory entries safely.
 */
function listDirEntries(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Collect selective source file metadata for Non-Git projects (bounded to maxFiles).
 */
function collectSelectiveSourceSnapshot(rootDir, maxFiles = 200) {
  const sourceFingerprints = {};
  let totalSourceFiles = 0;
  let capExceeded = false;

  function walk(dir, relPrefix = '', depth = 0) {
    if (depth > 4 || capExceeded) return;
    for (const entry of listDirEntries(dir)) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const absPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(absPath, relPath, depth + 1);
      } else if (entry.isFile()) {
        totalSourceFiles += 1;
        if (totalSourceFiles > maxFiles) {
          capExceeded = true;
          return;
        }
        try {
          const st = fs.statSync(absPath);
          if (st.size <= 256 * 1024) {
            const buf = fs.readFileSync(absPath);
            sourceFingerprints[relPath] = `${st.size}:${sha256(buf, 16)}`;
          } else {
            sourceFingerprints[relPath] = `${st.size}:${Math.trunc(st.mtimeMs)}`;
          }
        } catch {
          // Ignore unreadable file
        }
      }
    }
  }

  walk(rootDir);
  return {
    sourceFingerprints,
    totalSourceFiles,
    capExceeded
  };
}

/**
 * Collect current repository snapshot metadata and evidence fingerprints.
 * @param {string} workspaceDir
 * @param {object} [identity]
 * @param {Array<{name: string, path: string}>} [knownPackages=[]]
 * @returns {object}
 */
export function collectRepositorySnapshot(workspaceDir, identity = null, knownPackages = []) {
  const projIdentity = identity || resolveProjectIdentity(workspaceDir);
  const rootDir = projIdentity.canonicalRoot;
  const rootEntries = listDirEntries(rootDir);

  const fileFingerprints = {};
  const recordIfPresent = (relPath) => {
    const normRel = relPath.replace(/\\/g, '/');
    const fp = fingerprintFile(path.join(rootDir, normRel));
    if (fp) {
      fileFingerprints[normRel] = fp;
    }
  };

  // 1. Fingerprint root manifests, lockfiles, workspace configs, instructions, deployment files
  for (const rel of [
    ...ROOT_MANIFEST_FILES,
    ...LOCKFILES,
    ...WORKSPACE_CONFIG_FILES,
    ...INSTRUCTION_FILES,
    ...DEPLOYMENT_FILES,
    'tsconfig.json',
    'tsconfig.base.json',
    'hooks.json',
    '.gitlab-ci.yml'
  ]) {
    recordIfPresent(rel);
  }

  // 2. Fingerprint any *.config.* at repository root
  for (const entry of rootEntries) {
    if (entry.isFile() && /\.config\.(js|mjs|cjs|ts|json|toml|yaml)$/i.test(entry.name)) {
      recordIfPresent(entry.name);
    }
  }

  // 3. Fingerprint CI workflow files in .github/workflows
  const wfDir = path.join(rootDir, '.github', 'workflows');
  for (const entry of listDirEntries(wfDir)) {
    if (entry.isFile() && /\.(ya?ml)$/i.test(entry.name)) {
      recordIfPresent(`.github/workflows/${entry.name}`);
    }
  }

  // 4. Discover and fingerprint workspace package directories and their manifests
  const workspacePackageDirs = new Set();
  for (const pkg of knownPackages || []) {
    if (pkg?.path) workspacePackageDirs.add(pkg.path.replace(/\\/g, '/'));
  }
  for (const container of ['packages', 'apps', 'services', 'crates', 'libs']) {
    const containerAbs = path.join(rootDir, container);
    for (const sub of listDirEntries(containerAbs)) {
      if (sub.isDirectory() && !sub.name.startsWith('.')) {
        workspacePackageDirs.add(`${container}/${sub.name}`);
      }
    }
  }

  const sortedPkgDirs = Array.from(workspacePackageDirs).sort();
  for (const pkgDir of sortedPkgDirs) {
    for (const mFile of ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod']) {
      recordIfPresent(`${pkgDir}/${mFile}`);
    }
  }

  // 5. Compute directory structure hash (top-level entries + workspace package directories)
  const topLevelListing = rootEntries
    .filter((e) => !e.name.startsWith('.tmp') && e.name !== '.git')
    .map((e) => `${e.isDirectory() ? 'd' : 'f'}:${e.name}`)
    .sort();
  const directoryStructureHash = sha256(
    JSON.stringify({ topLevelListing, workspacePackages: sortedPkgDirs }),
    32
  );

  // 6. Git working tree status or Non-Git selective source snapshot
  let gitStatusFiles = [];
  let workingTreeStatusHash = null;
  let nonGitSourceSnapshot = null;

  if (projIdentity.isGitRepo) {
    const statusRes = runGitSafe(rootDir, ['status', '--porcelain=v1', '-uall']);
    const lines = statusRes.ok && statusRes.stdout
      ? statusRes.stdout.split(/\r?\n/).filter(Boolean)
      : [];

    const dirtyContentHashes = [];
    for (const line of lines) {
      const m = line.match(/^\s*([MADRCU?!]{1,2})\s+(.*)$/);
      const statusCode = m ? m[1] : line.slice(0, 2).trim();
      const rawPath = (m ? m[2] : line.slice(3)).trim().replace(/^"(.*)"$/, '$1');
      const finalPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop().trim() : rawPath;
      const normPath = finalPath.replace(/\\/g, '/');
      gitStatusFiles.push({ status: statusCode, path: normPath });

      // Include content hash for dirty files so subsequent edits to an already-dirty file are caught
      const fp = fingerprintFile(path.join(rootDir, normPath));
      dirtyContentHashes.push(`${statusCode}:${normPath}:${fp ? fp.sha256 : 'deleted'}`);
    }
    workingTreeStatusHash = sha256(JSON.stringify(dirtyContentHashes), 32);
  } else {
    nonGitSourceSnapshot = collectSelectiveSourceSnapshot(rootDir);
  }

  return {
    headCommit: projIdentity.headCommit,
    branch: projIdentity.branch,
    isDetachedHead: projIdentity.isDetachedHead,
    isGitRepo: projIdentity.isGitRepo,
    workingTreeStatusHash,
    gitStatusFiles,
    fileFingerprints,
    workspacePackageDirs: sortedPkgDirs,
    directoryStructureHash,
    nonGitSourceSnapshot,
    capturedAt: new Date().toISOString()
  };
}

/**
 * Classify a relative file path into one or more invalidation categories.
 * @param {string} relPath
 * @returns {string[]}
 */
export function classifyChangedFile(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const base = path.posix.basename(norm);
  const categories = [];

  if (WORKSPACE_CONFIG_FILES.includes(norm) || WORKSPACE_CONFIG_FILES.includes(base)) {
    categories.push('WORKSPACE_CONFIG_CHANGED');
  }
  if (ROOT_MANIFEST_FILES.includes(norm)) {
    categories.push('ROOT_MANIFEST_CHANGED');
    if (norm === 'package.json' || norm === 'Cargo.toml' || norm === 'pyproject.toml') {
      categories.push('PACKAGE_MANIFEST_CHANGED');
    }
  } else if (/\/(package\.json|Cargo\.toml|pyproject\.toml|go\.mod)$/.test(norm)) {
    categories.push('PACKAGE_MANIFEST_CHANGED');
  }

  if (LOCKFILES.includes(norm) || LOCKFILES.includes(base)) {
    categories.push('LOCKFILE_CHANGED');
  }

  if (
    /\.config\.(js|mjs|cjs|ts|json|toml|yaml)$/i.test(base) ||
    /^tsconfig(\..+)?\.json$/i.test(base) ||
    norm === 'plugin.json'
  ) {
    categories.push('FRAMEWORK_OR_BUILD_CONFIG_CHANGED');
  }

  if (/^\.github\/workflows\/.+\.ya?ml$/i.test(norm) || norm === '.gitlab-ci.yml') {
    categories.push('CI_WORKFLOW_CHANGED');
  }

  if (DEPLOYMENT_FILES.includes(norm) || DEPLOYMENT_FILES.includes(base)) {
    categories.push('DEPLOYMENT_CONFIG_CHANGED');
  }

  if (INSTRUCTION_FILES.includes(norm) || /^\.agents\/rules\/.+\.md$/i.test(norm)) {
    categories.push('INSTRUCTIONS_CHANGED');
  }

  if (categories.length === 0) {
    categories.push('SOURCE_FILE_CHANGED');
  }

  return categories;
}

/**
 * Determine which of the 10 contextSections are invalidated given change categories.
 * @param {string[]} categories
 * @returns {{ invalidatedSections: string[], validSections: string[], taskImpactInvalidated: boolean }}
 */
export function determineInvalidatedSections(categories = []) {
  const catSet = new Set(categories);
  const invalidated = new Set();
  let taskImpactInvalidated = false;

  if (catSet.has('FULL_INVALIDATION')) {
    return {
      invalidatedSections: [...CONTEXT_SECTION_KEYS],
      validSections: [],
      taskImpactInvalidated: true
    };
  }

  if (catSet.has('SOURCE_FILE_CHANGED')) {
    taskImpactInvalidated = true;
  }

  if (catSet.has('ROOT_MANIFEST_CHANGED') || catSet.has('PACKAGE_MANIFEST_CHANGED')) {
    invalidated.add('languages');
    invalidated.add('frameworks');
    invalidated.add('packageManagers');
    invalidated.add('verificationCommands');
    invalidated.add('workspacePackages');
    invalidated.add('dependencyGraph');
    if (catSet.has('ROOT_MANIFEST_CHANGED')) {
      invalidated.add('topology');
    }
    taskImpactInvalidated = true;
  }

  if (catSet.has('LOCKFILE_CHANGED')) {
    invalidated.add('packageManagers');
    invalidated.add('frameworks');
    invalidated.add('dependencyGraph');
    taskImpactInvalidated = true;
  }

  if (catSet.has('FRAMEWORK_OR_BUILD_CONFIG_CHANGED')) {
    invalidated.add('frameworks');
    invalidated.add('languages');
    invalidated.add('verificationCommands');
    taskImpactInvalidated = true;
  }

  if (catSet.has('WORKSPACE_CONFIG_CHANGED') || catSet.has('PACKAGE_TOPOLOGY_CHANGED')) {
    invalidated.add('topology');
    invalidated.add('workspacePackages');
    invalidated.add('dependencyGraph');
    invalidated.add('verificationCommands');
    taskImpactInvalidated = true;
  }

  if (catSet.has('CI_WORKFLOW_CHANGED')) {
    invalidated.add('ciCd');
  }

  if (catSet.has('DEPLOYMENT_CONFIG_CHANGED')) {
    invalidated.add('deployment');
  }

  if (catSet.has('INSTRUCTIONS_CHANGED')) {
    invalidated.add('projectInstructions');
  }

  const invalidatedSections = CONTEXT_SECTION_KEYS.filter((k) => invalidated.has(k));
  const validSections = CONTEXT_SECTION_KEYS.filter((k) => !invalidated.has(k));

  return {
    invalidatedSections,
    validSections,
    taskImpactInvalidated
  };
}

/**
 * Build the per-section evidence map for a discovered profile and snapshot.
 */
export function buildContextEvidence(profile, snapshot, identity) {
  const fpMap = snapshot.fileFingerprints || {};
  const now = new Date().toISOString();
  const rev = identity.headCommit || 'non-git';

  const makeEntry = (files, sourceType, confidence = 'HIGH') => {
    const matched = files.filter((f) => Boolean(fpMap[f]));
    const fingerprintHash = sha256(
      JSON.stringify(matched.map((f) => [f, fpMap[f]?.sha256])),
      24
    );
    return {
      files: matched,
      fingerprintHash,
      sourceType,
      confidence,
      gitRevision: rev,
      lastValidatedAt: now
    };
  };

  const allFpKeys = Object.keys(fpMap);
  const pkgManifestKeys = allFpKeys.filter((k) => /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod)$/.test(k));
  const configKeys = allFpKeys.filter((k) => /\.config\.|tsconfig|plugin\.json/.test(k));
  const wfKeys = allFpKeys.filter((k) => k.startsWith('.github/workflows/') || k === '.gitlab-ci.yml');
  const deployKeys = allFpKeys.filter((k) => DEPLOYMENT_FILES.includes(k));
  const instrKeys = allFpKeys.filter((k) => INSTRUCTION_FILES.includes(k));

  return {
    topology: makeEntry([...WORKSPACE_CONFIG_FILES, ...ROOT_MANIFEST_FILES], 'workspace-topology', profile.confidence),
    languages: makeEntry([...ROOT_MANIFEST_FILES, 'tsconfig.json', 'tsconfig.base.json'], 'language-evidence', profile.confidence),
    frameworks: makeEntry([...ROOT_MANIFEST_FILES, ...configKeys], 'multi-signal-framework', profile.confidence),
    packageManagers: makeEntry([...ROOT_MANIFEST_FILES, ...LOCKFILES], 'lockfile-and-manifest', profile.confidence),
    workspacePackages: makeEntry([...WORKSPACE_CONFIG_FILES, ...pkgManifestKeys], 'workspace-manifests', profile.confidence),
    dependencyGraph: makeEntry([...pkgManifestKeys, ...LOCKFILES], 'internal-dependency-graph', profile.confidence),
    verificationCommands: makeEntry([...ROOT_MANIFEST_FILES, ...configKeys], 'manifest-scripts', profile.confidence),
    projectInstructions: makeEntry(instrKeys, 'repository-instructions', 'HIGH'),
    ciCd: makeEntry(wfKeys, 'ci-workflows', 'HIGH'),
    deployment: makeEntry(deployKeys, 'deployment-configs', 'HIGH')
  };
}

/**
 * Validate cached Project Context freshness against the live repository state.
 *
 * @param {string} workspaceDir
 * @param {object} cachedRecord
 * @param {object} [options={}]
 * @returns {object}
 */
export function validateContextFreshness(workspaceDir, cachedRecord, options = {}) {
  const identity = options.identity || resolveProjectIdentity(workspaceDir);

  if (!cachedRecord || !cachedRecord.snapshot || !cachedRecord.contextSections) {
    return {
      status: 'MISSING',
      isFresh: false,
      invalidatedSections: [...CONTEXT_SECTION_KEYS],
      validSections: [],
      changedFiles: [],
      changedCategories: ['FULL_INVALIDATION'],
      reasons: ['No valid cached project context record present.'],
      currentSnapshot: collectRepositorySnapshot(workspaceDir, identity)
    };
  }

  const cachedSnap = cachedRecord.snapshot;
  const knownPackages = cachedRecord.contextSections?.workspacePackages?.value?.packages || [];
  const currentSnap = collectRepositorySnapshot(workspaceDir, identity, knownPackages);

  const changedFilesSet = new Set();
  const changedCategoriesSet = new Set();
  const reasons = [];

  // 0. Check if relocated from another path
  if (cachedRecord.projectIdentity?.canonicalRoot !== identity.canonicalRoot) {
    reasons.push(
      `Repository path relocated from "${cachedRecord.projectIdentity?.canonicalRoot}" to "${identity.canonicalRoot}"; validating all evidence fingerprints.`
    );
  }

  // 1. Check supplementary PostToolUse dirty hints recorded since last verification
  const dirtyHintFiles = cachedRecord.cacheMetadata?.dirtyHintFiles || [];
  for (const df of dirtyHintFiles) {
    changedFilesSet.add(df);
  }
  if ((cachedRecord.cacheMetadata?.dirtyHintCommands || []).length > 0) {
    reasons.push('PostToolUse recorded state-changing command hint; verifying fingerprints.');
  }

  // 2. Compare workspace package directory list (detects added or deleted packages)
  const prevPkgDirs = JSON.stringify(cachedSnap.workspacePackageDirs || []);
  const currPkgDirs = JSON.stringify(currentSnap.workspacePackageDirs || []);
  if (prevPkgDirs !== currPkgDirs) {
    changedCategoriesSet.add('PACKAGE_TOPOLOGY_CHANGED');
    reasons.push('Workspace package directory structure changed (package added or removed).');
  }

  // 3. Compare all tracked config / manifest / instruction / CI / deployment file fingerprints
  const allTrackedFiles = new Set([
    ...Object.keys(cachedSnap.fileFingerprints || {}),
    ...Object.keys(currentSnap.fileFingerprints || {})
  ]);

  for (const relFile of allTrackedFiles) {
    const prevFp = cachedSnap.fileFingerprints?.[relFile];
    const currFp = currentSnap.fileFingerprints?.[relFile];
    if (!prevFp || !currFp || prevFp.sha256 !== currFp.sha256) {
      changedFilesSet.add(relFile);
      for (const cat of classifyChangedFile(relFile)) {
        changedCategoriesSet.add(cat);
      }
      reasons.push(`Tracked configuration/evidence file "${relFile}" ${!prevFp ? 'added' : !currFp ? 'removed' : 'modified'}.`);
    }
  }

  // 4. Git-specific freshness checks (HEAD, branch, working tree status, commit diff)
  if (identity.isGitRepo) {
    const branchChanged = cachedSnap.branch !== currentSnap.branch;
    const headChanged = cachedSnap.headCommit !== currentSnap.headCommit;

    if (branchChanged) {
      reasons.push(`Git branch switched from "${cachedSnap.branch}" to "${currentSnap.branch}".`);
    }

    if (headChanged) {
      reasons.push(`Git HEAD changed from "${cachedSnap.headCommit}" to "${currentSnap.headCommit}".`);
      if (
        cachedSnap.headCommit &&
        cachedSnap.headCommit !== 'UNBORN' &&
        currentSnap.headCommit &&
        currentSnap.headCommit !== 'UNBORN'
      ) {
        const diffRes = runGitSafe(identity.canonicalRoot, [
          'diff',
          '--name-only',
          cachedSnap.headCommit,
          currentSnap.headCommit
        ]);
        if (diffRes.ok) {
          const diffFiles = diffRes.stdout
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          for (const df of diffFiles) {
            changedFilesSet.add(df);
            for (const cat of classifyChangedFile(df)) {
              changedCategoriesSet.add(cat);
            }
          }
        } else {
          // Conservative fallback when commit history cannot be compared
          changedCategoriesSet.add('FULL_INVALIDATION');
          reasons.push('Git commit diff between cached and current HEAD unavailable; triggering full rediscovery.');
        }
      } else {
        changedCategoriesSet.add('FULL_INVALIDATION');
      }
    }

    // Even if HEAD and branch match, check live working tree changes
    if (cachedSnap.workingTreeStatusHash !== currentSnap.workingTreeStatusHash) {
      reasons.push('Git working tree / staged / untracked status changed.');
      for (const item of currentSnap.gitStatusFiles || []) {
        changedFilesSet.add(item.path);
        for (const cat of classifyChangedFile(item.path)) {
          changedCategoriesSet.add(cat);
        }
      }
    }
  } else {
    // 5. Non-Git repository freshness checks
    const prevSource = cachedSnap.nonGitSourceSnapshot;
    const currSource = currentSnap.nonGitSourceSnapshot;

    if (!prevSource || !currSource || currSource.capExceeded) {
      changedCategoriesSet.add('FULL_INVALIDATION');
      reasons.push('Non-Git source tree exceeds selective fingerprint cap or lacks baseline; running full discovery.');
    } else {
      const allSourcePaths = new Set([
        ...Object.keys(prevSource.sourceFingerprints || {}),
        ...Object.keys(currSource.sourceFingerprints || {})
      ]);
      for (const relPath of allSourcePaths) {
        if (prevSource.sourceFingerprints[relPath] !== currSource.sourceFingerprints[relPath]) {
          changedFilesSet.add(relPath);
          for (const cat of classifyChangedFile(relPath)) {
            changedCategoriesSet.add(cat);
          }
          reasons.push(`Non-Git file "${relPath}" changed.`);
        }
      }
    }

    if (cachedSnap.directoryStructureHash !== currentSnap.directoryStructureHash) {
      changedCategoriesSet.add('PACKAGE_TOPOLOGY_CHANGED');
      reasons.push('Non-Git directory structure changed.');
    }
  }

  // Classify anydirtyHintFiles that were added earlier
  for (const f of changedFilesSet) {
    for (const cat of classifyChangedFile(f)) {
      changedCategoriesSet.add(cat);
    }
  }

  const changedFiles = Array.from(changedFilesSet);
  const changedCategories = Array.from(changedCategoriesSet);
  const { invalidatedSections, validSections, taskImpactInvalidated } =
    determineInvalidatedSections(changedCategories);

  let status = 'FRESH';
  if (invalidatedSections.length === CONTEXT_SECTION_KEYS.length) {
    status = 'STALE';
  } else if (invalidatedSections.length > 0 || taskImpactInvalidated || changedFiles.length > 0) {
    status = 'PARTIAL_STALE';
  }

  return {
    status,
    isFresh: status === 'FRESH',
    invalidatedSections,
    validSections,
    taskImpactInvalidated,
    changedFiles,
    changedCategories,
    reasons,
    currentSnapshot: currentSnap
  };
}
