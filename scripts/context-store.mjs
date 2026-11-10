#!/usr/bin/env node
/**
 * DevLifecycle v2.1 — P13: Persistent Project Context Store & Identity Engine
 *
 * Responsibilities:
 * 1. Project Identity & Isolation (Section 5):
 *    - Supports standalone Git repos, multiple Git worktrees, monorepos, non-Git repos,
 *      multi-folder workspaces, branch switching, and safe repository relocation detection.
 *    - Derives unique local identity from canonical path + Git worktree/common-dir metadata.
 * 2. Lightweight Context Persistence & Storage Safety (Section 1 & Section 6):
 *    - Uses `process.env.PLUGIN_DATA` only when actually provided by the runtime.
 *    - Evaluates conventional OS-specific user cache locations when `PLUGIN_DATA` is absent
 *      (without treating OS paths as an official Antigravity API).
 *    - Gracefully falls back to session-scoped storage or in-memory reuse when persistent
 *      storage is unavailable or unwritable.
 *    - Never writes inside the plugin installation root or the user's project repository.
 *    - Never stores secrets, tokens, private keys, or raw source file contents.
 *    - Uses atomic writes (.tmp + rename) and strict schema validation (v2.1.0).
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_INSTALL_ROOT = path.resolve(__dirname, '..');

export const CONTEXT_SCHEMA_VERSION = '2.1.0';

export const CONTEXT_SECTION_KEYS = Object.freeze([
  'topology',
  'languages',
  'frameworks',
  'packageManagers',
  'workspacePackages',
  'dependencyGraph',
  'verificationCommands',
  'projectInstructions',
  'ciCd',
  'deployment'
]);

// In-memory session fallback store when disk storage is completely restricted/unwritable
const memoryFallbackStore = new Map();
const memoryMetricsStore = new Map();
const rootCommitCache = new Map();

/**
 * Fast filesystem walk to locate enclosing `.git` directory or worktree `.git` file
 * without spawning a subprocess when a directory is not a Git repository.
 * @param {string} startDir
 * @returns {{ rootDir: string, dotGitPath: string, isFile: boolean } | null}
 */
function findEnclosingGitMarker(startDir) {
  let curr = path.resolve(startDir);
  while (true) {
    const dotGit = path.join(curr, '.git');
    try {
      if (fs.existsSync(dotGit)) {
        const st = fs.statSync(dotGit);
        if (st.isDirectory() || st.isFile()) {
          return { rootDir: curr, dotGitPath: dotGit, isFile: st.isFile() };
        }
      }
    } catch {
      // Ignore permission errors on ancestor directories
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

/**
 * Resolve ref commit SHA directly from gitDir / gitCommonDir or packed-refs.
 */
function resolveGitRefFast(gitDir, gitCommonDir, refName) {
  for (const base of [gitDir, gitCommonDir].filter(Boolean)) {
    const refFile = path.join(base, refName);
    try {
      if (fs.existsSync(refFile) && fs.statSync(refFile).isFile()) {
        const sha = fs.readFileSync(refFile, 'utf8').trim();
        if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
      }
    } catch {
      // Ignore
    }
    const packedFile = path.join(base, 'packed-refs');
    try {
      if (fs.existsSync(packedFile)) {
        const lines = fs.readFileSync(packedFile, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          if (!line || line.startsWith('#') || line.startsWith('^')) continue;
          const [sha, ref] = line.trim().split(/\s+/);
          if (ref === refName && /^[0-9a-f]{40}$/i.test(sha)) {
            return sha;
          }
        }
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

/**
 * Compute SHA-256 hex digest of a string or buffer.
 * @param {string|Buffer} input
 * @param {number} [len=64]
 * @returns {string}
 */
export function sha256(input, len = 64) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, len);
}

/**
 * Canonicalize a filesystem path safely across Windows/macOS/Linux.
 * @param {string} targetPath
 * @returns {string}
 */
export function canonicalizePath(targetPath) {
  const raw = String(targetPath || process.cwd()).trim();
  if (raw.includes('\0')) {
    throw new Error('Unsafe path containing null byte rejected.');
  }
  let resolved = path.resolve(raw);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    try {
      resolved = fs.realpathSync(resolved);
    } catch {
      // Keep path.resolve if path does not exist yet
    }
  }
  let norm = resolved.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/^[A-Z]:\//.test(norm)) {
    norm = norm[0].toLowerCase() + norm.slice(1);
  }
  return norm || '/';
}

/**
 * Execute a read-only Git command safely in a specific working directory.
 * @param {string} cwd
 * @param {string[]} args
 * @returns {{ ok: boolean, stdout: string, stderr: string }}
 */
export function runGitSafe(cwd, args) {
  try {
    const res = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true
    });
    if (res.status === 0) {
      return { ok: true, stdout: String(res.stdout || '').trim(), stderr: '' };
    }
    return { ok: false, stdout: '', stderr: String(res.stderr || '').trim() };
  } catch (err) {
    return { ok: false, stdout: '', stderr: err.message };
  }
}

/**
 * Resolve deterministic project identity for a workspace directory.
 * Supports standalone Git repos, multiple Git worktrees, monorepos, non-Git dirs,
 * and repository relocation via rootCommit / manifest lineage fingerprint.
 *
 * @param {string} workspaceDir
 * @returns {object}
 */
export function resolveProjectIdentity(workspaceDir) {
  const canonicalTarget = canonicalizePath(workspaceDir);
  const gitMarker = findEnclosingGitMarker(canonicalTarget);

  let isGitRepo = false;
  let canonicalRoot = canonicalTarget;
  let relativeSubdir = '';
  let gitDir = null;
  let gitCommonDir = null;
  let isLinkedWorktree = false;
  let headCommit = null;
  let branch = null;
  let isDetachedHead = false;
  let rootCommit = null;

  if (gitMarker) {
    isGitRepo = true;
    canonicalRoot = canonicalizePath(gitMarker.rootDir);
    const rel = path.posix.relative(canonicalRoot, canonicalTarget);
    relativeSubdir = rel && rel !== '.' ? rel : '';

    if (gitMarker.isFile) {
      try {
        const gitFileContent = fs.readFileSync(gitMarker.dotGitPath, 'utf8').trim();
        const m = gitFileContent.match(/^gitdir:\s*(.+)$/i);
        if (m && m[1]) {
          gitDir = canonicalizePath(path.resolve(canonicalRoot, m[1].trim()));
        }
      } catch {
        // Fallback below
      }
    } else {
      gitDir = canonicalizePath(gitMarker.dotGitPath);
    }

    if (!gitDir) {
      const gitDirRes = runGitSafe(canonicalRoot, ['rev-parse', '--git-dir']);
      if (gitDirRes.ok && gitDirRes.stdout) {
        gitDir = canonicalizePath(path.resolve(canonicalRoot, gitDirRes.stdout));
      }
    }

    if (gitDir) {
      const commonDirFile = path.join(gitDir, 'commondir');
      if (fs.existsSync(commonDirFile)) {
        try {
          const relCommon = fs.readFileSync(commonDirFile, 'utf8').trim();
          gitCommonDir = canonicalizePath(path.resolve(gitDir, relCommon));
        } catch {
          gitCommonDir = gitDir;
        }
      } else {
        gitCommonDir = gitDir;
      }
    }

    if (gitDir && gitCommonDir && gitDir !== gitCommonDir) {
      isLinkedWorktree = true;
    }

    // Read HEAD and branch directly from gitDir/HEAD when possible
    const headFile = gitDir ? path.join(gitDir, 'HEAD') : null;
    if (headFile && fs.existsSync(headFile)) {
      try {
        const headRaw = fs.readFileSync(headFile, 'utf8').trim();
        if (headRaw.startsWith('ref:')) {
          const refTarget = headRaw.slice(4).trim();
          branch = refTarget.startsWith('refs/heads/')
            ? refTarget.slice('refs/heads/'.length)
            : refTarget;
          isDetachedHead = false;
          headCommit = resolveGitRefFast(gitDir, gitCommonDir, refTarget) || 'UNBORN';
        } else if (/^[0-9a-f]{40}$/i.test(headRaw)) {
          headCommit = headRaw;
          branch = 'DETACHED';
          isDetachedHead = true;
        }
      } catch {
        // Fallback below
      }
    }

    if (!headCommit) {
      const headRes = runGitSafe(canonicalRoot, ['rev-parse', '--verify', 'HEAD']);
      headCommit = headRes.ok && headRes.stdout ? headRes.stdout : 'UNBORN';
    }

    if (headCommit && headCommit !== 'UNBORN') {
      const cacheKey = gitCommonDir || canonicalRoot;
      if (rootCommitCache.has(cacheKey)) {
        rootCommit = rootCommitCache.get(cacheKey);
      } else {
        const rootCommitRes = runGitSafe(canonicalRoot, ['rev-list', '--max-parents=0', 'HEAD', '-n', '1']);
        if (rootCommitRes.ok && rootCommitRes.stdout) {
          rootCommit = rootCommitRes.stdout.split(/\r?\n/)[0].trim();
          rootCommitCache.set(cacheKey, rootCommit);
        }
      }
    }
  }

  // Compute root manifest fingerprint for relocation identification
  let rootManifestHash = null;
  for (const manifestName of ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'plugin.json', 'Makefile']) {
    const manifestPath = path.join(canonicalRoot, manifestName);
    try {
      if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
        const content = fs.readFileSync(manifestPath);
        rootManifestHash = `${manifestName}:${sha256(content, 24)}`;
        break;
      }
    } catch {
      // Ignore read errors
    }
  }

  // Unique per-worktree/per-directory key so independent worktrees or clones never collide
  const worktreeKey = sha256(
    JSON.stringify({
      canonicalRoot,
      gitDir: gitDir || 'non-git'
    }),
    24
  );

  // Shared lineage key for safe relocation detection
  const lineageFingerprint =
    rootCommit || rootManifestHash
      ? sha256(
          JSON.stringify({
            rootCommit: rootCommit || null,
            rootManifestHash: rootManifestHash || null,
            dirBasename: path.posix.basename(canonicalRoot)
          }),
          24
        )
      : null;

  const commonRepoKey = sha256(
    JSON.stringify({
      gitCommonDir: gitCommonDir || canonicalRoot,
      rootCommit: rootCommit || null
    }),
    24
  );

  return {
    projectId: `dl-proj-${worktreeKey}`,
    projectKey: commonRepoKey,
    worktreeKey,
    commonRepoKey,
    lineageFingerprint,
    canonicalRoot,
    canonicalRootPath: canonicalRoot,
    canonicalTarget,
    relativeSubdir,
    isGitRepo,
    isLinkedWorktree,
    gitDir,
    gitCommonDir,
    headCommit,
    branch,
    isDetachedHead,
    rootCommit
  };
}

/**
 * Compute the conventional OS-specific user cache directory.
 * Note: This is standard OS user cache storage via Node.js APIs, NOT an official Antigravity API.
 * @returns {string}
 */
export function getOsUserCacheDir() {
  const home = os.homedir();
  const userTag = sha256(home || 'default-user', 12);
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(localAppData, 'dev-lifecycle', 'Cache', `u-${userTag}`, 'context-v2.1');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'dev-lifecycle', `u-${userTag}`, 'context-v2.1');
  }
  const xdgCache = process.env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(xdgCache, 'dev-lifecycle', `u-${userTag}`, 'context-v2.1');
}

/**
 * Check if a candidate cache directory is safe (not inside plugin root or target workspace)
 * and writable.
 * @param {string} dirPath
 * @param {string} [workspaceRoot]
 * @returns {boolean}
 */
function isSafeWritableCacheDir(dirPath, workspaceRoot) {
  if (!dirPath || typeof dirPath !== 'string' || dirPath.includes('\0')) {
    return false;
  }
  try {
    const absDir = canonicalizePath(dirPath);
    const absPluginRoot = canonicalizePath(PLUGIN_INSTALL_ROOT);

    // Never write cache files inside the installed plugin directory
    if (absDir === absPluginRoot || absDir.startsWith(`${absPluginRoot}/`)) {
      return false;
    }

    // Never pollute the user's source repository
    if (workspaceRoot) {
      const absWs = canonicalizePath(workspaceRoot);
      if (absDir === absWs || absDir.startsWith(`${absWs}/`)) {
        return false;
      }
    }

    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    const probeFile = path.join(dirPath, `.probe-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(probeFile, 'ok', { encoding: 'utf8', mode: 0o600 });
    fs.unlinkSync(probeFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the storage directory and tier for project context persistence.
 * Priority:
 * 1. Explicit `options.cacheDir` or `process.env.DEV_LIFECYCLE_CACHE_DIR` (if set, strict mode: no fallback to OS cache if unwritable, goes to session/memory fallback).
 * 2. Documented `process.env.PLUGIN_DATA` when present and writable (`plugin-data`).
 * 3. Conventional OS user cache directory (`os-user-cache`).
 * 4. Session-scoped scratch directory (`session-fallback`).
 * 5. In-memory session map (`memory-only`).
 *
 * @param {object} [options={}]
 * @returns {{ cacheDir: string|null, mirrorDirs: string[], storageTier: string, persistent: boolean }}
 */
export function resolveCacheStorage(options = {}) {
  const workspaceRoot = options.workspaceRoot || null;
  const sessionDirOption =
    options.sessionDir ||
    (options.artifactDirectoryPath ? path.join(options.artifactDirectoryPath, 'scratch', 'context-cache') : null);

  // Simulate restricted storage when explicitly requested in tests
  if (options.simulateRestrictedStorage === true) {
    if (sessionDirOption && isSafeWritableCacheDir(sessionDirOption, workspaceRoot)) {
      return {
        cacheDir: path.resolve(sessionDirOption),
        mirrorDirs: [],
        storageTier: 'session-fallback',
        tier: 'session-fallback',
        persistent: false
      };
    }
    return {
      cacheDir: null,
      mirrorDirs: [],
      storageTier: 'memory-only',
      tier: 'memory-only',
      persistent: false
    };
  }

  const explicitDir = options.cacheDir || options.customCacheDir || process.env.DEV_LIFECYCLE_CACHE_DIR || null;
  if (explicitDir) {
    if (isSafeWritableCacheDir(explicitDir, workspaceRoot)) {
      return {
        cacheDir: path.resolve(explicitDir),
        mirrorDirs: [],
        storageTier: 'explicit-cache-dir',
        tier: 'explicit-cache-dir',
        persistent: true
      };
    }
    // Explicit cache dir is unwritable -> fall back to sessionDir or memory-only
    if (sessionDirOption && isSafeWritableCacheDir(sessionDirOption, workspaceRoot)) {
      return {
        cacheDir: path.resolve(sessionDirOption),
        mirrorDirs: [],
        storageTier: 'session-fallback',
        tier: 'session-fallback',
        persistent: false
      };
    }
    return {
      cacheDir: null,
      mirrorDirs: [],
      storageTier: 'memory-only',
      tier: 'memory-only',
      persistent: false
    };
  }

  const pluginDataEnv = process.env.PLUGIN_DATA
    ? path.join(process.env.PLUGIN_DATA, 'context-cache')
    : null;
  const osCacheDir = getOsUserCacheDir();

  const pluginDataOk = pluginDataEnv ? isSafeWritableCacheDir(pluginDataEnv, workspaceRoot) : false;
  const osCacheOk = isSafeWritableCacheDir(osCacheDir, workspaceRoot);

  if (pluginDataOk) {
    return {
      cacheDir: path.resolve(pluginDataEnv),
      mirrorDirs: osCacheOk && path.resolve(osCacheDir) !== path.resolve(pluginDataEnv) ? [path.resolve(osCacheDir)] : [],
      storageTier: 'plugin-data',
      persistent: true
    };
  }

  if (osCacheOk) {
    return {
      cacheDir: path.resolve(osCacheDir),
      mirrorDirs: [],
      storageTier: 'os-user-cache',
      persistent: true
    };
  }

  // Fallback to session artifact scratch directory if available
  const sessionFallbackCandidate =
    options.sessionDir ||
    (process.env.ANTIGRAVITY_APP_DATA_DIR && process.env.ANTIGRAVITY_CONVERSATION_ID
      ? path.join(
          process.env.ANTIGRAVITY_APP_DATA_DIR,
          'brain',
          process.env.ANTIGRAVITY_CONVERSATION_ID,
          'scratch',
          'context-cache'
        )
      : null);

  if (sessionFallbackCandidate && isSafeWritableCacheDir(sessionFallbackCandidate, workspaceRoot)) {
    return {
      cacheDir: path.resolve(sessionFallbackCandidate),
      mirrorDirs: [],
      storageTier: 'session-fallback',
      persistent: false
    };
  }

  return {
    cacheDir: null,
    mirrorDirs: [],
    storageTier: 'memory-only',
    persistent: false
  };
}

/**
 * Redact any accidental secret patterns from strings before persisting to cache (P13 #10).
 * @param {any} value
 * @returns {any}
 */
export function sanitizeForCache(value) {
  if (typeof value === 'string') {
    return value
      .replace(/\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,})\b/g, '[REDACTED_TOKEN]')
      .replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[:=]\s*)(['"]?)[^\s'"]+\2/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForCache(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/^(secret|password|privateKey|accessToken|authToken|envContent)$/i.test(k)) {
        continue;
      }
      out[k] = sanitizeForCache(v);
    }
    return out;
  }
  return value;
}

/**
 * Validate a safe cache file path inside cacheDir.
 */
function resolveSafeCacheFilePath(cacheDir, fileName) {
  if (!/^[a-zA-Z0-9_.-]+\.json$/.test(fileName) || fileName.includes('..')) {
    throw new Error(`Invalid cache filename rejected: ${fileName}`);
  }
  const resolvedBase = path.resolve(cacheDir);
  const target = path.resolve(resolvedBase, fileName);
  const rel = path.relative(resolvedBase, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Unsafe path traversal in cache file resolution.');
  }
  return target;
}

/**
 * Write JSON atomically using temporary file + rename.
 */
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2, 8)}.tmp`;
  const serialized = JSON.stringify(sanitizeForCache(data), null, 2) + '\n';
  fs.writeFileSync(tmpFile, serialized, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpFile, filePath);
}

/**
 * Validate the structural integrity of a loaded cache record.
 * @param {any} record
 * @returns {{ valid: boolean, status: 'VALID' | 'SCHEMA_MISMATCH' | 'CORRUPTED', reason?: string }}
 */
export function validateCacheRecordSchema(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, status: 'CORRUPTED', reason: 'Cache record is not a JSON object.' };
  }
  if (record.schemaVersion !== CONTEXT_SCHEMA_VERSION) {
    return {
      valid: false,
      status: 'SCHEMA_MISMATCH',
      reason: `Expected schemaVersion "${CONTEXT_SCHEMA_VERSION}", found "${record.schemaVersion ?? 'none'}".`
    };
  }
  if (
    !record.projectIdentity ||
    typeof record.projectIdentity.projectId !== 'string' ||
    typeof record.projectIdentity.canonicalRoot !== 'string'
  ) {
    return { valid: false, status: 'CORRUPTED', reason: 'Missing or invalid projectIdentity.' };
  }
  if (!record.snapshot || typeof record.snapshot !== 'object' || !record.snapshot.fileFingerprints) {
    return { valid: false, status: 'CORRUPTED', reason: 'Missing or invalid snapshot metadata.' };
  }
  if (!record.contextSections || typeof record.contextSections !== 'object') {
    return { valid: false, status: 'CORRUPTED', reason: 'Missing contextSections object.' };
  }
  for (const key of CONTEXT_SECTION_KEYS) {
    if (!record.contextSections[key] || !('value' in record.contextSections[key])) {
      return { valid: false, status: 'CORRUPTED', reason: `Missing required context section "${key}".` };
    }
  }
  if (!record.evidence || typeof record.evidence !== 'object') {
    return { valid: false, status: 'CORRUPTED', reason: 'Missing evidence map.' };
  }
  return { valid: true, status: 'VALID' };
}

/**
 * Load a cached project context profile for the given workspace directory.
 * Also supports safe relocation detection if a repository moved paths.
 *
 * @param {string} workspaceDir
 * @param {object} [options={}]
 * @returns {{ status: 'FOUND' | 'MISSING' | 'CORRUPTED' | 'SCHEMA_MISMATCH' | 'RELOCATED', record: object|null, identity: object, storage: object, loadDurationMs: number, reason?: string }}
 */
export function loadProjectContext(workspaceDirOrIdentity, options = {}) {
  const start = performance.now();
  const identity =
    workspaceDirOrIdentity && typeof workspaceDirOrIdentity === 'object' && workspaceDirOrIdentity.projectId
      ? workspaceDirOrIdentity
      : options.identity || resolveProjectIdentity(workspaceDirOrIdentity);
  const storage = resolveCacheStorage({ ...options, workspaceRoot: identity.canonicalRoot });
  const fileName = `${identity.projectId}.json`;

  // 1. Check in-memory fallback store if disk storage is unavailable
  if (!storage.cacheDir) {
    const memRecord = memoryFallbackStore.get(identity.projectId) || null;
    const loadDurationMs = Number((performance.now() - start).toFixed(2));
    if (!memRecord) {
      return { status: 'MISSING', record: null, identity, storage, loadDurationMs };
    }
    const schemaCheck = validateCacheRecordSchema(memRecord);
    if (!schemaCheck.valid) {
      memoryFallbackStore.delete(identity.projectId);
      return { status: schemaCheck.status, record: null, identity, storage, loadDurationMs, reason: schemaCheck.reason };
    }
    return { status: 'FOUND', record: structuredClone(memRecord), identity, storage, loadDurationMs };
  }

  // 2. Check primary disk cache directory (and mirrorDirs if not in primary)
  const searchDirs = [storage.cacheDir, ...(storage.mirrorDirs || [])];
  for (const dir of searchDirs) {
    let filePath;
    try {
      filePath = resolveSafeCacheFilePath(dir, fileName);
    } catch (err) {
      return {
        status: 'CORRUPTED',
        record: null,
        identity,
        storage,
        loadDurationMs: Number((performance.now() - start).toFixed(2)),
        reason: err.message
      };
    }

    if (fs.existsSync(filePath)) {
      let parsed;
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        parsed = JSON.parse(raw);
      } catch (err) {
        return {
          status: 'CORRUPTED',
          record: null,
          identity,
          storage,
          loadDurationMs: Number((performance.now() - start).toFixed(2)),
          reason: `Malformed JSON in cache file: ${err.message}`
        };
      }

      const schemaCheck = validateCacheRecordSchema(parsed);
      if (!schemaCheck.valid) {
        return {
          status: schemaCheck.status,
          record: null,
          identity,
          storage,
          loadDurationMs: Number((performance.now() - start).toFixed(2)),
          reason: schemaCheck.reason
        };
      }

      // Verify canonicalRoot matches to prevent hash collision cross-contamination
      if (parsed.projectIdentity.canonicalRoot !== identity.canonicalRoot) {
        return {
          status: 'CORRUPTED',
          record: null,
          identity,
          storage,
          loadDurationMs: Number((performance.now() - start).toFixed(2)),
          reason: 'Canonical root mismatch in cached project identity.'
        };
      }

      return {
        status: 'FOUND',
        filePath,
        record: parsed,
        identity,
        storage,
        loadDurationMs: Number((performance.now() - start).toFixed(2))
      };
    }
  }

  // 3. Check for relocated repository if lineageFingerprint is available
  if (identity.lineageFingerprint && storage.cacheDir) {
    try {
      const files = fs.readdirSync(storage.cacheDir);
      for (const f of files) {
        if (!f.startsWith('dl-proj-') || !f.endsWith('.json')) continue;
        const candidatePath = resolveSafeCacheFilePath(storage.cacheDir, f);
        const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
        if (
          validateCacheRecordSchema(candidate).valid &&
          candidate.projectIdentity?.lineageFingerprint === identity.lineageFingerprint &&
          !fs.existsSync(candidate.projectIdentity.canonicalRoot)
        ) {
          return {
            status: 'RELOCATED',
            record: candidate,
            identity,
            storage,
            loadDurationMs: Number((performance.now() - start).toFixed(2)),
            reason: `Relocated from ${candidate.projectIdentity.canonicalRoot} to ${identity.canonicalRoot}`
          };
        }
      }
    } catch {
      // Ignore relocation scan errors
    }
  }

  return {
    status: 'MISSING',
    record: null,
    identity,
    storage,
    loadDurationMs: Number((performance.now() - start).toFixed(2))
  };
}

/**
 * Save a validated Project Context record to persistent or session fallback storage.
 * @param {string} workspaceDir
 * @param {object} record
 * @param {object} [options={}]
 * @returns {{ saved: boolean, persistent: boolean, storageTier: string, cacheFilePath: string|null }}
 */
export function saveProjectContext(workspaceDir, record, options = {}) {
  const identity = record?.projectIdentity || resolveProjectIdentity(workspaceDir);
  const storage = resolveCacheStorage({ ...options, workspaceRoot: identity.canonicalRoot });
  const fileName = `${identity.projectId}.json`;

  const sanitized = sanitizeForCache({
    ...record,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    cacheMetadata: {
      ...(record.cacheMetadata || {}),
      storageTier: storage.storageTier,
      persisted: storage.persistent,
      updatedAt: new Date().toISOString()
    }
  });

  if (!storage.cacheDir) {
    memoryFallbackStore.set(identity.projectId, sanitized);
    return {
      saved: true,
      persistent: false,
      storageTier: storage.storageTier,
      cacheFilePath: null
    };
  }

  try {
    const primaryPath = resolveSafeCacheFilePath(storage.cacheDir, fileName);
    writeJsonAtomic(primaryPath, sanitized);

    for (const mirrorDir of storage.mirrorDirs || []) {
      try {
        const mirrorPath = resolveSafeCacheFilePath(mirrorDir, fileName);
        writeJsonAtomic(mirrorPath, sanitized);
      } catch {
        // Ignore mirror write errors
      }
    }

    return {
      saved: true,
      persistent: storage.persistent,
      storageTier: storage.storageTier,
      cacheFilePath: primaryPath
    };
  } catch {
    // Graceful fallback to in-memory session store if atomic write fails
    memoryFallbackStore.set(identity.projectId, sanitized);
    return {
      saved: true,
      persistent: false,
      storageTier: 'memory-only',
      cacheFilePath: null
    };
  }
}

/**
 * Clear cached context for a specific workspace or all cached contexts.
 * @param {string|null} workspaceDir
 * @param {object} [options={}]
 * @returns {{ cleared: boolean, removedFiles: string[] }}
 */
export function clearProjectContext(workspaceDir = null, options = {}) {
  const removedFiles = [];
  if (workspaceDir) {
    const identity = resolveProjectIdentity(workspaceDir);
    memoryFallbackStore.delete(identity.projectId);
    memoryMetricsStore.delete(identity.projectId);
    const storage = resolveCacheStorage({ ...options, workspaceRoot: identity.canonicalRoot });
    const dirs = [storage.cacheDir, ...(storage.mirrorDirs || [])].filter(Boolean);
    for (const d of dirs) {
      try {
        const fp = resolveSafeCacheFilePath(d, `${identity.projectId}.json`);
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
          removedFiles.push(fp);
        }
      } catch {
        // Ignore
      }
    }
    return { cleared: true, removedFiles };
  }

  memoryFallbackStore.clear();
  memoryMetricsStore.clear();
  const storage = resolveCacheStorage(options);
  const dirs = [storage.cacheDir, ...(storage.mirrorDirs || [])].filter(Boolean);
  for (const d of dirs) {
    try {
      for (const f of fs.readdirSync(d)) {
        if (f.startsWith('dl-proj-') && f.endsWith('.json')) {
          const fp = resolveSafeCacheFilePath(d, f);
          fs.unlinkSync(fp);
          removedFiles.push(fp);
        }
      }
    } catch {
      // Ignore
    }
  }
  return { cleared: true, removedFiles };
}

/**
 * Record a supplementary dirty hint from PostToolUse when a file mutation or command executes.
 * Never performs a full repository scan.
 *
 * @param {string[]} workspacePaths
 * @param {object} hint - { toolName, targetPath, command }
 * @param {object} [options={}]
 * @returns {{ updatedProjects: string[] }}
 */
export function recordDirtyContextHint(workspacePaths = [], hint = {}, options = {}) {
  const updatedProjects = [];
  const roots = Array.isArray(workspacePaths)
    ? workspacePaths
    : typeof workspacePaths === 'string' && workspacePaths
    ? [workspacePaths]
    : [];
  const targetPath = hint.targetPath || hint.filePath || null;

  // If targetPath is absolute and no workspacePaths matched, try resolving its parent directory
  const candidates = [...roots];
  if (targetPath && path.isAbsolute(targetPath)) {
    const targetDir = path.dirname(targetPath);
    if (!candidates.some((r) => canonicalizePath(targetPath).startsWith(canonicalizePath(r)))) {
      candidates.push(targetDir);
    }
  }

  for (const rawRoot of candidates.slice(0, 5)) {
    try {
      const loaded = loadProjectContext(rawRoot, options);
      if (loaded.status !== 'FOUND' || !loaded.record) continue;

      const record = loaded.record;
      const dirtyFiles = new Set(record.cacheMetadata?.dirtyHintFiles || []);
      const dirtyCommands = new Set(record.cacheMetadata?.dirtyHintCommands || []);

      if (targetPath) {
        const absTarget = path.isAbsolute(targetPath)
          ? canonicalizePath(targetPath)
          : canonicalizePath(path.resolve(record.projectIdentity.canonicalRoot, targetPath));
        const absRoot = record.projectIdentity.canonicalRoot;
        const relPath = absTarget.startsWith(`${absRoot}/`)
          ? absTarget.slice(absRoot.length + 1)
          : String(targetPath).replace(/\\/g, '/').replace(/^\.\//, '');
        dirtyFiles.add(relPath);
      }

      if (hint.command) {
        dirtyCommands.add(String(hint.command).slice(0, 120));
      }

      record.cacheMetadata = {
        ...(record.cacheMetadata || {}),
        dirtyHintFiles: Array.from(dirtyFiles).slice(-50),
        dirtyHintCommands: Array.from(dirtyCommands).slice(-20),
        lastDirtySignalAt: new Date().toISOString()
      };

      saveProjectContext(rawRoot, record, options);
      updatedProjects.push(record.projectIdentity.projectId);
    } catch {
      // Fail-open: never break hook execution
    }
  }

  return { updatedProjects };
}

/**
 * Update and retrieve measurable P13 context efficiency metrics for a project.
 * @param {string} projectId
 * @param {object} [event=null]
 * @param {object} [storage=null]
 * @returns {object}
 */
export function recordAndGetContextMetrics(projectId, event = null, storage = null) {
  let current = memoryMetricsStore.get(projectId) || {
    eligibleLookups: 0,
    cacheHits: 0,
    incrementalRefreshes: 0,
    fullDiscoveries: 0,
    fullDiscoveryAvoidedCount: 0,
    staleContextIncidents: 0,
    staleContextPreventedCount: 0,
    lastLookupDurationMs: 0,
    lastFullDiscoveryDurationMs: null,
    lastProfileSizeBytes: 0,
    lastInvalidatedSections: [],
    lastReusedSections: []
  };

  // Try loading persisted metrics file if storage is available
  if (storage?.cacheDir) {
    try {
      const mPath = resolveSafeCacheFilePath(storage.cacheDir, `metrics-${projectId}.json`);
      if (fs.existsSync(mPath)) {
        current = { ...current, ...JSON.parse(fs.readFileSync(mPath, 'utf8')) };
      }
    } catch {
      // Ignore
    }
  }

  if (event) {
    if (event.type === 'INITIAL_DISCOVERY' || event.type === 'FULL_REDISCOVERY') {
      current.fullDiscoveries += 1;
      if (event.type === 'FULL_REDISCOVERY') {
        current.eligibleLookups += 1;
        current.staleContextPreventedCount += 1;
      }
      if (typeof event.durationMs === 'number') {
        current.lastFullDiscoveryDurationMs = event.durationMs;
      }
    } else if (event.type === 'CACHE_HIT') {
      current.eligibleLookups += 1;
      current.cacheHits += 1;
      current.fullDiscoveryAvoidedCount += 1;
    } else if (event.type === 'INCREMENTAL_REFRESH') {
      current.eligibleLookups += 1;
      current.incrementalRefreshes += 1;
      current.fullDiscoveryAvoidedCount += 1;
      current.staleContextPreventedCount += 1;
    }

    if (typeof event.durationMs === 'number') {
      current.lastLookupDurationMs = event.durationMs;
    }
    if (typeof event.profileSizeBytes === 'number') {
      current.lastProfileSizeBytes = event.profileSizeBytes;
    }
    if (Array.isArray(event.invalidatedSections)) {
      current.lastInvalidatedSections = event.invalidatedSections;
    }
    if (Array.isArray(event.reusedSections)) {
      current.lastReusedSections = event.reusedSections;
    }
  }

  const eligible = current.eligibleLookups;
  const computed = {
    ...current,
    cacheHitRate: eligible > 0 ? Number(((current.cacheHits + current.incrementalRefreshes) / eligible).toFixed(2)) : 0,
    strictUnchangedHitRate: eligible > 0 ? Number((current.cacheHits / eligible).toFixed(2)) : 0,
    incrementalRefreshRate: eligible > 0 ? Number((current.incrementalRefreshes / eligible).toFixed(2)) : 0,
    invalidationAccuracy: {
      invalidatedSectionsCount: current.lastInvalidatedSections.length,
      reusedSectionsCount: current.lastReusedSections.length,
      staleContextIncidents: current.staleContextIncidents,
      staleContextPreventedCount: current.staleContextPreventedCount
    },
    contextLoadCost: {
      lastLookupDurationMs: current.lastLookupDurationMs,
      lastFullDiscoveryDurationMs: current.lastFullDiscoveryDurationMs,
      profileSizeBytes: current.lastProfileSizeBytes
    }
  };

  memoryMetricsStore.set(projectId, computed);
  if (storage?.cacheDir) {
    try {
      const mPath = resolveSafeCacheFilePath(storage.cacheDir, `metrics-${projectId}.json`);
      writeJsonAtomic(mPath, computed);
    } catch {
      // Ignore
    }
  }

  return computed;
}
