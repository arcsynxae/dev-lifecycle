#!/usr/bin/env node
/**
 * DevLifecycle — Deterministic SemVer Synchronization & Drift Validator (PART IV)
 *
 * Ensures `package.json.version === plugin.json.version` after Changesets runs
 * `changeset version`, preserving all unrelated fields and stable 2-space formatting
 * in `plugin.json`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

export const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Validate whether a string is a strict Semantic Version.
 * @param {string} version
 * @returns {boolean}
 */
export function isValidSemVer(version) {
  return typeof version === 'string' && SEMVER_REGEX.test(version.trim());
}

/**
 * Inspect `package.json` and `plugin.json` in `rootDir` and check version consistency.
 * @param {string} [rootDir=DEFAULT_ROOT]
 * @returns {{ consistent: boolean, packageVersion: string, pluginVersion: string, validPackageSemVer: boolean, validPluginSemVer: boolean, driftReason: string|null }}
 */
export function checkVersionConsistency(rootDir = DEFAULT_ROOT) {
  const pkgPath = path.join(rootDir, 'package.json');
  const pluginPath = path.join(rootDir, 'plugin.json');

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing package.json at ${pkgPath}`);
  }
  if (!fs.existsSync(pluginPath)) {
    throw new Error(`Missing plugin.json at ${pluginPath}`);
  }

  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const pluginJson = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));

  const packageVersion = String(pkgJson.version || '').trim();
  const pluginVersion = String(pluginJson.version || '').trim();
  const validPackageSemVer = isValidSemVer(packageVersion);
  const validPluginSemVer = isValidSemVer(pluginVersion);

  let driftReason = null;
  if (!validPackageSemVer) {
    driftReason = `Invalid SemVer in package.json: "${packageVersion}"`;
  } else if (!validPluginSemVer) {
    driftReason = `Invalid SemVer in plugin.json: "${pluginVersion}"`;
  } else if (packageVersion !== pluginVersion) {
    driftReason = `Version drift detected: package.json is "${packageVersion}" but plugin.json is "${pluginVersion}"`;
  }

  return {
    consistent: validPackageSemVer && validPluginSemVer && packageVersion === pluginVersion,
    packageVersion,
    pluginVersion,
    validPackageSemVer,
    validPluginSemVer,
    driftReason
  };
}

/**
 * Synchronize `plugin.json.version` with `package.json.version` deterministically.
 * Does not modify `plugin.json` if versions are already identical.
 *
 * @param {string} [rootDir=DEFAULT_ROOT]
 * @param {object} [options={}]
 * @param {boolean} [options.dryRun=false]
 * @returns {{ updated: boolean, version: string, previousVersion: string, pluginPath: string }}
 */
export function synchronizePluginManifestVersion(rootDir = DEFAULT_ROOT, options = {}) {
  const pkgPath = path.join(rootDir, 'package.json');
  const pluginPath = path.join(rootDir, 'plugin.json');

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing package.json at ${pkgPath}`);
  }
  if (!fs.existsSync(pluginPath)) {
    throw new Error(`Missing plugin.json at ${pluginPath}`);
  }

  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkgJson.private !== true) {
    throw new Error('package.json must have "private": true to prevent accidental npm publication.');
  }

  const targetVersion = String(pkgJson.version || '').trim();
  if (!isValidSemVer(targetVersion)) {
    throw new Error(`Invalid SemVer in package.json: "${targetVersion}"`);
  }

  const rawPluginText = fs.readFileSync(pluginPath, 'utf8');
  const pluginJson = JSON.parse(rawPluginText);
  const previousVersion = String(pluginJson.version || '').trim();

  if (previousVersion === targetVersion) {
    return {
      updated: false,
      version: targetVersion,
      previousVersion,
      pluginPath
    };
  }

  const updatedPlugin = {};
  for (const [k, v] of Object.entries(pluginJson)) {
    updatedPlugin[k] = k === 'version' ? targetVersion : v;
  }
  if (!('version' in updatedPlugin)) {
    updatedPlugin.version = targetVersion;
  }

  const formatted = JSON.stringify(updatedPlugin, null, 2) + '\n';
  if (!options.dryRun && formatted !== rawPluginText) {
    fs.writeFileSync(pluginPath, formatted, 'utf8');
  }

  return {
    updated: true,
    version: targetVersion,
    previousVersion,
    pluginPath
  };
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const rootIdx = args.indexOf('--root');
  const rootDir = rootIdx !== -1 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : DEFAULT_ROOT;

  if (checkOnly) {
    const check = checkVersionConsistency(rootDir);
    if (!check.consistent) {
      console.error(`✖ Version consistency check failed: ${check.driftReason}`);
      process.exit(1);
    }
    console.log(`✔ Version consistency verified: package.json === plugin.json (${check.packageVersion})`);
    return;
  }

  const res = synchronizePluginManifestVersion(rootDir);
  if (res.updated) {
    console.log(`✔ Synchronized plugin.json version: ${res.previousVersion} -> ${res.version}`);
  } else {
    console.log(`✔ plugin.json version already synchronized (${res.version})`);
  }
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('sync-version.mjs')
) {
  main();
}
