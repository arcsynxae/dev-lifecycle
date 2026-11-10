#!/usr/bin/env node
/**
 * DevLifecycle — Deterministic Clean Runtime Plugin Packager & Validator (PART V)
 *
 * Stages ONLY the runtime-allowed plugin components into a clean distribution directory
 * (`dist/plugin/dev-lifecycle`), validates the staged bundle independently of the source
 * repository (structural + official `agy plugin validate --strict` when available), and
 * produces a versioned archive (`dist/dev-lifecycle-v<version>.zip`).
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersionConsistency, isValidSemVer } from './sync-version.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SOURCE_ROOT = path.resolve(__dirname, '..');

export const RUNTIME_ROOT_FILES = Object.freeze([
  'plugin.json',
  'README.md',
  'hooks.json'
]);

export const RUNTIME_ASSETS = Object.freeze([
  'assets/logo.svg'
]);

export const RUNTIME_RULES = Object.freeze([
  'rules/AGENTS.md'
]);

export const RUNTIME_AGENTS = Object.freeze([
  'agents/code-reviewer.md',
  'agents/implementation-engineer.md',
  'agents/lifecycle-orchestrator.md',
  'agents/quality-engineer.md',
  'agents/release-engineer.md',
  'agents/security-reviewer.md',
  'agents/software-architect.md'
]);

export const RUNTIME_SKILLS = Object.freeze([
  'dl-run',
  'dl-discover',
  'dl-plan',
  'dl-implement',
  'dl-verify',
  'dl-review',
  'dl-release',
  'dl-diagnose'
]);

export const RUNTIME_SCRIPTS = Object.freeze([
  'scripts/classify-task.mjs',
  'scripts/context-freshness.mjs',
  'scripts/context-store.mjs',
  'scripts/discover-project.mjs',
  'scripts/lifecycle-check.mjs',
  'scripts/post-tool-tracker.mjs',
  'scripts/pre-tool-safety.mjs',
  'scripts/session-start-context.mjs',
  'scripts/stop-gate.mjs'
]);

export const FORBIDDEN_DISTRIBUTION_ENTRIES = Object.freeze([
  '.git',
  '.github',
  '.changeset',
  'tests',
  'tooling',
  'docs',
  'examples',
  'node_modules',
  'dist',
  'coverage',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'CHANGELOG.md',
  '.gitignore',
  '.env',
  '.env.local',
  '.env.production',
  '.env.staging'
]);

/**
 * Compute the complete explicit allowlist of relative file paths for a source directory.
 * @param {string} [sourceDir=DEFAULT_SOURCE_ROOT]
 * @returns {string[]}
 */
export function resolveRuntimeAllowlistFiles(sourceDir = DEFAULT_SOURCE_ROOT) {
  const allowed = new Set([
    ...RUNTIME_ROOT_FILES,
    ...RUNTIME_ASSETS,
    ...RUNTIME_RULES,
    ...RUNTIME_AGENTS,
    ...RUNTIME_SCRIPTS
  ]);

  for (const skillName of RUNTIME_SKILLS) {
    allowed.add(`skills/${skillName}/SKILL.md`);
    const refsDir = path.join(sourceDir, 'skills', skillName, 'references');
    if (fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory()) {
      for (const entry of fs.readdirSync(refsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          allowed.add(`skills/${skillName}/references/${entry.name}`);
        }
      }
    }
  }

  return Array.from(allowed).sort();
}

/**
 * Recursively list all relative file and directory paths inside a directory.
 * @param {string} rootDir
 * @returns {{ files: string[], dirs: string[] }}
 */
export function listAllRelativeEntries(rootDir) {
  const files = [];
  const dirs = [];

  function walk(currDir, relPrefix = '') {
    for (const entry of fs.readdirSync(currDir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        dirs.push(rel);
        walk(path.join(currDir, entry.name), rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }
  return { files: files.sort(), dirs: dirs.sort() };
}

/**
 * Discover the Antigravity CLI (`agy`) binary if installed on the current machine.
 * @returns {string|null}
 */
export function findAgyBinary() {
  if (process.env.DEV_LIFECYCLE_FORCE_NO_AGY === '1') {
    return null;
  }
  const homeDir = os.homedir();
  const candidates = [
    'agy',
    path.join(homeDir, '.gemini', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy')
  ];
  for (const cand of candidates) {
    try {
      const res = spawnSync(cand, ['--version'], { encoding: 'utf8', windowsHide: true });
      if (res.status === 0) {
        return cand;
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

/**
 * Validate a staged plugin directory independently of the source repository (Section 14 / PKG-01..04).
 *
 * @param {string} stagedDir
 * @param {object} [options={}]
 * @param {boolean} [options.runAgyCli=true]
 * @returns {object}
 */
export function validateStagedPluginDirectory(stagedDir, options = {}) {
  const absStaged = path.resolve(stagedDir);
  const errors = [];

  if (!fs.existsSync(absStaged)) {
    return {
      valid: false,
      errors: [`Staged directory does not exist: ${absStaged}`],
      cliValidation: { status: 'NOT_RUN', reason: 'Staged directory missing' }
    };
  }

  const { files, dirs } = listAllRelativeEntries(absStaged);

  // 1. Check forbidden development-only files & directories (PKG-03)
  const forbiddenSet = new Set(FORBIDDEN_DISTRIBUTION_ENTRIES);
  for (const rel of [...files, ...dirs]) {
    const topSegment = rel.split('/')[0];
    const baseName = path.posix.basename(rel);
    if (forbiddenSet.has(rel) || forbiddenSet.has(topSegment) || forbiddenSet.has(baseName)) {
      errors.push(`Forbidden development/non-runtime entry present in distribution: "${rel}"`);
    }
    if (
      /^\.env(\..+)?$/i.test(baseName) ||
      /\.(pem|key|p12|pfx|tmp|bak|orig|swp)$/i.test(baseName) ||
      /^(id_rsa|id_ed25519|credentials\.json|secrets\.ya?ml)$/i.test(baseName)
    ) {
      errors.push(`Sensitive or temporary file present in distribution: "${rel}"`);
    }
  }

  // 2. Validate plugin.json manifest
  const manifestPath = path.join(absStaged, 'plugin.json');
  let manifest = null;
  if (!fs.existsSync(manifestPath)) {
    errors.push('Missing plugin.json at staged plugin root');
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name !== 'dev-lifecycle') {
        errors.push(`Expected plugin.json name "dev-lifecycle", got "${manifest.name}"`);
      }
      if (!isValidSemVer(manifest.version)) {
        errors.push(`Invalid SemVer in staged plugin.json: "${manifest.version}"`);
      }
      if (!manifest.logo || !fs.existsSync(path.join(absStaged, manifest.logo))) {
        errors.push(`Logo asset referenced in plugin.json is missing: "${manifest.logo}"`);
      }
    } catch (err) {
      errors.push(`Invalid JSON in staged plugin.json: ${err.message}`);
    }
  }

  // 3. Validate rules/AGENTS.md
  const rulesPath = path.join(absStaged, 'rules', 'AGENTS.md');
  if (!fs.existsSync(rulesPath)) {
    errors.push('Missing rules/AGENTS.md');
  } else {
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');
    if (rulesContent.startsWith('---')) {
      errors.push('rules/AGENTS.md must not contain YAML frontmatter');
    }
    if (Buffer.byteLength(rulesContent, 'utf8') >= 24000) {
      errors.push('rules/AGENTS.md exceeds 24,000 byte limit');
    }
  }

  // 4. Validate all 8 skills and their internal references (PKG-02)
  for (const skillName of RUNTIME_SKILLS) {
    const skillPath = path.join(absStaged, 'skills', skillName, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      errors.push(`Missing skill file: skills/${skillName}/SKILL.md`);
      continue;
    }
    const content = fs.readFileSync(skillPath, 'utf8');
    if (Buffer.byteLength(content, 'utf8') >= 24000) {
      errors.push(`Skill ${skillName} exceeds 24,000 byte limit`);
    }
    if (!new RegExp(`^---[\\s\\S]*?name:\\s*${skillName}\\b`, 'm').test(content)) {
      errors.push(`Skill ${skillName} frontmatter name mismatch`);
    }

    // Check markdown links to ./references/... inside SKILL.md
    const refMatches = content.matchAll(/\]\((\.\/references\/[^)#\s]+)\)/g);
    for (const match of refMatches) {
      const relRef = match[1];
      const resolvedRef = path.resolve(path.dirname(skillPath), relRef);
      if (!fs.existsSync(resolvedRef)) {
        errors.push(`Skill ${skillName} references missing file "${relRef}"`);
      }
    }
  }

  // 5. Validate all 7 agents
  for (const relAgent of RUNTIME_AGENTS) {
    if (!fs.existsSync(path.join(absStaged, relAgent))) {
      errors.push(`Missing agent file: ${relAgent}`);
    }
  }

  // 6. Validate hooks.json and referenced scripts + internal script imports (PKG-02)
  const hooksPath = path.join(absStaged, 'hooks.json');
  if (!fs.existsSync(hooksPath)) {
    errors.push('Missing hooks.json at staged plugin root');
  } else {
    try {
      const hooksJson = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      const hooksText = JSON.stringify(hooksJson);
      const scriptRefs = hooksText.matchAll(/\.\/scripts\/([a-zA-Z0-9_.-]+\.mjs)/g);
      for (const m of scriptRefs) {
        const scriptRel = `scripts/${m[1]}`;
        if (!fs.existsSync(path.join(absStaged, scriptRel))) {
          errors.push(`hooks.json references missing script "${scriptRel}"`);
        }
      }
    } catch (err) {
      errors.push(`Invalid JSON in staged hooks.json: ${err.message}`);
    }
  }

  for (const relScript of RUNTIME_SCRIPTS) {
    const absScript = path.join(absStaged, relScript);
    if (!fs.existsSync(absScript)) {
      errors.push(`Missing required runtime script: ${relScript}`);
      continue;
    }
    const scriptText = fs.readFileSync(absScript, 'utf8');
    const importMatches = scriptText.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g);
    for (const m of importMatches) {
      const importedRel = m[1];
      const resolvedImport = path.resolve(path.dirname(absScript), importedRel);
      if (!fs.existsSync(resolvedImport)) {
        errors.push(`Script ${relScript} imports missing local module "${importedRel}"`);
      }
    }
  }

  // 7. Run official `agy plugin validate --strict` when available
  let cliValidation = { status: 'NOT_RUN', reason: 'CLI validation disabled by caller' };
  if (options.runAgyCli !== false) {
    const agyBin = findAgyBinary();
    if (!agyBin) {
      cliValidation = {
        status: 'SKIPPED',
        reason: 'Antigravity CLI (agy) binary is not installed in this environment; independent structural validation executed.'
      };
    } else {
      const valRes = spawnSync(agyBin, ['plugin', 'validate', '--strict', '--json', absStaged], {
        encoding: 'utf8',
        windowsHide: true
      });
      if (valRes.status !== 0) {
        errors.push(`agy plugin validate --strict failed on staged directory: ${valRes.stdout || valRes.stderr}`);
        cliValidation = {
          status: 'FAIL',
          reason: valRes.stdout || valRes.stderr
        };
      } else {
        const report = JSON.parse(valRes.stdout);
        if ((report.findings || []).length > 0) {
          errors.push(`agy plugin validate --strict reported findings: ${JSON.stringify(report.findings)}`);
          cliValidation = { status: 'FAIL', findings: report.findings };
        } else {
          cliValidation = {
            status: 'PASS',
            components: report.components,
            findingsCount: 0
          };
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    version: manifest?.version || null,
    fileCount: files.length,
    files,
    dirs,
    cliValidation
  };
}

/**
 * Create a ZIP archive containing the `dev-lifecycle/` directory from `stagingParentDir`.
 * Uses `tar -a -c -f` (available on Windows 10/11, macOS, and Linux) with PowerShell / zip fallback.
 */
function createZipArchive(stagingParentDir, folderName, zipFilePath) {
  if (fs.existsSync(zipFilePath)) {
    fs.unlinkSync(zipFilePath);
  }

  // Attempt 1: tar -a -c -f <zipFilePath> -C <stagingParentDir> <folderName>
  const tarRes = spawnSync('tar', ['-a', '-c', '-f', zipFilePath, '-C', stagingParentDir, folderName], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (tarRes.status === 0 && fs.existsSync(zipFilePath) && fs.statSync(zipFilePath).size > 0) {
    return { method: 'tar', archivePath: zipFilePath };
  }

  // Attempt 2: PowerShell Compress-Archive on Windows
  if (process.platform === 'win32') {
    const psCmd = `Compress-Archive -Path "${path.join(stagingParentDir, folderName)}" -DestinationPath "${zipFilePath}" -Force`;
    const psRes = spawnSync('powershell', ['-NoProfile', '-Command', psCmd], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (psRes.status === 0 && fs.existsSync(zipFilePath)) {
      return { method: 'Compress-Archive', archivePath: zipFilePath };
    }
  }

  // Attempt 3: zip -r on POSIX
  const zipRes = spawnSync('zip', ['-r', '-q', zipFilePath, folderName], {
    cwd: stagingParentDir,
    encoding: 'utf8',
    windowsHide: true
  });
  if (zipRes.status === 0 && fs.existsSync(zipFilePath)) {
    return { method: 'zip', archivePath: zipFilePath };
  }

  throw new Error(`Failed to create ZIP archive at ${zipFilePath}: ${tarRes.stderr || 'no supported archive tool succeeded'}`);
}

/**
 * Build the clean runtime-only DevLifecycle plugin distribution and optional versioned ZIP archive.
 *
 * @param {object} [options={}]
 * @param {string} [options.sourceDir=DEFAULT_SOURCE_ROOT]
 * @param {string} [options.outDir]
 * @param {boolean} [options.createArchive=true]
 * @param {boolean} [options.runAgyCli=true]
 * @returns {object}
 */
export function buildPluginDistribution(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || DEFAULT_SOURCE_ROOT);
  const outDir = path.resolve(options.outDir || path.join(sourceDir, 'dist'));

  // 1. Verify version consistency if package.json is present in sourceDir
  if (fs.existsSync(path.join(sourceDir, 'package.json'))) {
    const versionCheck = checkVersionConsistency(sourceDir);
    if (!versionCheck.consistent) {
      throw new Error(`Cannot package plugin with inconsistent version state: ${versionCheck.driftReason}`);
    }
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'plugin.json'), 'utf8'));
  const version = String(manifest.version || '').trim();
  if (!isValidSemVer(version)) {
    throw new Error(`Invalid SemVer in plugin.json: "${version}"`);
  }

  const stagingParentDir = path.join(outDir, 'plugin');
  const stagedDir = path.join(stagingParentDir, 'dev-lifecycle');

  // 2. Clean previous staging output
  if (fs.existsSync(stagedDir)) {
    fs.rmSync(stagedDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagedDir, { recursive: true });

  // 3. Copy ONLY the explicit runtime allowlist files
  const allowlistFiles = resolveRuntimeAllowlistFiles(sourceDir);
  for (const relFile of allowlistFiles) {
    const srcFile = path.join(sourceDir, relFile);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`Required runtime file missing from source repository: "${relFile}"`);
    }
    const destFile = path.join(stagedDir, relFile);
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(srcFile, destFile);
    if (relFile.startsWith('scripts/') && relFile.endsWith('.mjs')) {
      try {
        fs.chmodSync(destFile, 0o755);
      } catch {
        // Ignore chmod on Windows
      }
    }
  }

  // 4. Validate the staged directory independently
  const validation = validateStagedPluginDirectory(stagedDir, {
    runAgyCli: options.runAgyCli !== false
  });
  if (!validation.valid) {
    throw new Error(`Staged plugin validation failed:\n- ${validation.errors.join('\n- ')}`);
  }

  // 5. Generate versioned ZIP distribution archive
  let archivePath = null;
  let archiveSha256 = null;
  let archiveSizeBytes = null;

  if (options.createArchive !== false) {
    const zipName = `dev-lifecycle-v${version}.zip`;
    archivePath = path.join(outDir, zipName);
    createZipArchive(stagingParentDir, 'dev-lifecycle', archivePath);
    const buf = fs.readFileSync(archivePath);
    archiveSha256 = crypto.createHash('sha256').update(buf).digest('hex');
    archiveSizeBytes = buf.length;
  }

  return {
    name: manifest.name,
    version,
    stagedDir,
    archivePath,
    archiveSha256,
    archiveSizeBytes,
    fileCount: validation.fileCount,
    files: validation.files,
    cliValidation: validation.cliValidation
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out-dir');
  const outDir = outIdx !== -1 && args[outIdx + 1] ? path.resolve(args[outIdx + 1]) : undefined;
  const noArchive = args.includes('--no-archive');
  const jsonOutput = args.includes('--json');

  const result = buildPluginDistribution({
    outDir,
    createArchive: !noArchive
  });

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(`✔ Staged clean runtime plugin (${result.fileCount} files): ${result.stagedDir}`);
    console.log(`✔ CLI validation status: ${result.cliValidation.status}`);
    if (result.archivePath) {
      console.log(`✔ Built versioned archive: ${result.archivePath} (${result.archiveSizeBytes} bytes, sha256=${result.archiveSha256.slice(0, 16)}...)`);
    }
  }
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('package-plugin.mjs')
) {
  main();
}
