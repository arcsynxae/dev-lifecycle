#!/usr/bin/env node
/**
 * DevLifecycle v2.1 — Universal Project, Monorepo & P13 Context Intelligence Engine
 *
 * Implements:
 * - Section 3 (Universal Project Intelligence)
 * - Section 4, 6, 7, 8 (P13: Persistent Project Context Intelligence & Incremental Rediscovery)
 * - Section 14 (CI/CD Efficiency)
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CONTEXT_SCHEMA_VERSION,
  CONTEXT_SECTION_KEYS,
  clearProjectContext,
  loadProjectContext,
  recordAndGetContextMetrics,
  resolveProjectIdentity,
  saveProjectContext,
  sha256
} from './context-store.mjs';
import {
  buildContextEvidence,
  collectRepositorySnapshot,
  determineInvalidatedSections,
  validateContextFreshness
} from './context-freshness.mjs';

/**
 * Safely read and parse JSON/JSONC file.
 */
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const cleaned = raw.replace(/^\s*\/\/.*$/gm, '');
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Safely read text file.
 */
function readTextSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * List files in a directory one level deep.
 */
function listDirSafe(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Expand simple workspace globs like "packages/*" or "apps/*".
 */
function expandWorkspaceGlobs(rootDir, patterns) {
  const dirs = new Set();
  for (const rawPattern of patterns || []) {
    const pattern = String(rawPattern).replace(/\\/g, '/').replace(/\/+$/, '');
    if (pattern.startsWith('!')) continue;
    if (pattern.endsWith('/*') || pattern.endsWith('/**')) {
      const parentRel = pattern.replace(/\/\*\*?$/, '');
      const parentAbs = path.join(rootDir, parentRel);
      for (const entry of listDirSafe(parentAbs)) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          dirs.add(path.posix.join(parentRel, entry.name));
        }
      }
    } else {
      const targetAbs = path.join(rootDir, pattern);
      if (fs.existsSync(targetAbs) && fs.statSync(targetAbs).isDirectory()) {
        dirs.add(pattern);
      }
    }
  }
  return Array.from(dirs);
}

/**
 * Parse simple YAML list patterns from pnpm-workspace.yaml.
 */
function parsePnpmWorkspacePatterns(yamlText) {
  if (!yamlText) return [];
  const patterns = [];
  const lines = yamlText.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/);
    if (m && m[1]) {
      patterns.push(m[1].trim());
    }
  }
  return patterns;
}

/**
 * Inspect GitHub Actions workflows for duplicate checks and optimization opportunities.
 */
export function analyzeCiWorkflows(rootDir) {
  const workflowsDir = path.join(rootDir, '.github', 'workflows');
  const findings = {
    provider: null,
    workflowFiles: [],
    commandsByType: { lint: [], typecheck: [], test: [], build: [], install: [] },
    duplicateChecks: [],
    cachingOpportunities: [],
    redundantBuilds: []
  };

  if (fs.existsSync(workflowsDir)) {
    findings.provider = 'github-actions';
    for (const entry of listDirSafe(workflowsDir)) {
      if (entry.isFile() && /\.(ya?ml)$/i.test(entry.name)) {
        const relPath = `.github/workflows/${entry.name}`;
        findings.workflowFiles.push(relPath);
        const content = readTextSafe(path.join(workflowsDir, entry.name)) || '';

        const hasCache = /cache\s*:\s*['"]?(npm|pnpm|yarn|bun|pip|cargo)|actions\/cache/i.test(content);
        const installMatches = content.match(/\b(npm\s+(ci|install)|pnpm\s+install|yarn\s+install|bun\s+install|pip\s+install)\b/g) || [];
        if (installMatches.length > 0) {
          findings.commandsByType.install.push({ file: relPath, count: installMatches.length, hasCache });
          if (!hasCache || installMatches.length > 1) {
            findings.cachingOpportunities.push({
              workflow: relPath,
              installCount: installMatches.length,
              hasCache,
              recommendation: !hasCache
                ? 'Enable dependency caching in setup action or actions/cache.'
                : `Consolidate ${installMatches.length} repeated dependency installation steps.`
            });
          }
        }

        const checkPatterns = [
          { type: 'lint', regex: /\b(npm\s+run\s+lint|pnpm\s+(run\s+)?lint|yarn\s+lint|eslint\b|biome\s+check|ruff\s+check)/g },
          { type: 'typecheck', regex: /\b(npm\s+run\s+typecheck|pnpm\s+(run\s+)?typecheck|tsc\s+--noEmit|astro\s+check|mypy\b)/g },
          { type: 'test', regex: /\b(npm\s+test|npm\s+run\s+test|pnpm\s+(run\s+)?test|yarn\s+test|vitest\s+run|jest\b|pytest\b|cargo\s+test)/g },
          { type: 'build', regex: /\b(npm\s+run\s+build|pnpm\s+(run\s+)?build|yarn\s+build|cargo\s+build)/g }
        ];

        for (const { type, regex } of checkPatterns) {
          const matches = content.match(regex) || [];
          for (const cmd of matches) {
            findings.commandsByType[type].push({ workflow: relPath, command: cmd.trim() });
          }
        }
      }
    }

    for (const [type, occurrences] of Object.entries(findings.commandsByType)) {
      if (type === 'install') continue;
      if (occurrences.length > 1) {
        findings.duplicateChecks.push({
          category: type,
          count: occurrences.length,
          locations: occurrences.map((o) => `${o.workflow} (${o.command})`),
          recommendation: `Deduplicate "${type}" execution (${occurrences.length} occurrences across CI jobs/workflows) while keeping required branch-protection check intact.`
        });
      }
      if (type === 'build' && occurrences.length > 1) {
        findings.redundantBuilds.push({
          count: occurrences.length,
          locations: occurrences.map((o) => o.workflow),
          recommendation: 'Build once and share artifacts across downstream test/deploy jobs.'
        });
      }
    }
  } else if (fs.existsSync(path.join(rootDir, '.gitlab-ci.yml'))) {
    findings.provider = 'gitlab-ci';
    findings.workflowFiles.push('.gitlab-ci.yml');
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Modular Section Discovery Builders (for Incremental Rediscovery — Section 8)
// ---------------------------------------------------------------------------

function discoverInstructionsSection(fileNames) {
  const instructionCandidates = [
    'AGENTS.md',
    'GEMINI.md',
    'CLAUDE.md',
    'README.md',
    'CONTRIBUTING.md',
    'ARCHITECTURE.md'
  ];
  return instructionCandidates.filter((c) => fileNames.has(c));
}

function discoverPackageManagersSection(fileNames, pkgJson) {
  const packageManagers = [];
  const assumptions = [];

  if (pkgJson?.packageManager) {
    const pmName = String(pkgJson.packageManager).split('@')[0];
    packageManagers.push(pmName);
  }
  if (fileNames.has('pnpm-lock.yaml') && !packageManagers.includes('pnpm')) {
    packageManagers.push('pnpm');
  }
  if ((fileNames.has('bun.lock') || fileNames.has('bun.lockb')) && !packageManagers.includes('bun')) {
    packageManagers.push('bun');
  }
  if (fileNames.has('yarn.lock') && !packageManagers.includes('yarn')) {
    packageManagers.push('yarn');
  }
  if (fileNames.has('package-lock.json') && !packageManagers.includes('npm')) {
    packageManagers.push('npm');
  }
  if (pkgJson && packageManagers.length === 0) {
    packageManagers.push('npm');
    assumptions.push('No JS lockfile found; defaulting Node script runner to npm/node.');
  }

  if (fileNames.has('uv.lock')) packageManagers.push('uv');
  else if (fileNames.has('poetry.lock')) packageManagers.push('poetry');
  else if (fileNames.has('pyproject.toml') || fileNames.has('requirements.txt')) packageManagers.push('pip');

  if (fileNames.has('Cargo.toml')) packageManagers.push('cargo');
  if (fileNames.has('go.mod')) packageManagers.push('go');
  if (fileNames.has('composer.json')) packageManagers.push('composer');
  if (fileNames.has('Makefile') || fileNames.has('justfile')) packageManagers.push('make');

  return { packageManagers, assumptions };
}

function discoverLanguagesSection(rootDir, fileNames, pkgJson) {
  const languages = [];
  const hasMjsOrJsScripts = listDirSafe(path.join(rootDir, 'scripts')).some((e) => /\.(m?js|cjs)$/i.test(e.name));
  if (pkgJson || fileNames.has('tsconfig.json') || hasMjsOrJsScripts) {
    if (
      fileNames.has('tsconfig.json') ||
      pkgJson?.devDependencies?.typescript ||
      pkgJson?.dependencies?.typescript
    ) {
      languages.push('TypeScript');
    }
    languages.push('JavaScript / Node.js');
  }
  if (fileNames.has('pyproject.toml') || fileNames.has('requirements.txt')) languages.push('Python');
  if (fileNames.has('Cargo.toml')) languages.push('Rust');
  if (fileNames.has('go.mod')) languages.push('Go');
  if (fileNames.has('composer.json')) languages.push('PHP');
  return languages;
}

function discoverFrameworksSection(rootDir, entries, fileNames, pkgJson) {
  const frameworks = [];
  const assumptions = [];
  const allDeps = {
    ...(pkgJson?.dependencies || {}),
    ...(pkgJson?.devDependencies || {})
  };

  if (fileNames.has('plugin.json') && (fileNames.has('skills') || fileNames.has('agents') || fileNames.has('rules'))) {
    frameworks.push({
      name: 'Google Antigravity Plugin',
      version: readJsonSafe(path.join(rootDir, 'plugin.json'))?.version || 'unknown',
      evidence: ['plugin.json', 'skills/', 'agents/', 'rules/'].filter((f) => fs.existsSync(path.join(rootDir, f.replace(/\/$/, '')))),
      confidence: 'HIGH'
    });
  }

  const frameworkSignals = [
    { name: 'Astro', dep: 'astro', configs: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'] },
    { name: 'Next.js', dep: 'next', configs: ['next.config.js', 'next.config.mjs', 'next.config.ts', 'app', 'pages'] },
    { name: 'Nuxt', dep: 'nuxt', configs: ['nuxt.config.ts', 'nuxt.config.js'] },
    { name: 'SvelteKit', dep: '@sveltejs/kit', configs: ['svelte.config.js', 'vite.config.ts', 'vite.config.js'] },
    { name: 'Vite', dep: 'vite', configs: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'] },
    { name: 'Hono', dep: 'hono', configs: ['wrangler.toml', 'wrangler.jsonc', 'src/index.ts', 'src/index.js'] },
    { name: 'Fastify', dep: 'fastify', configs: ['src/index.ts', 'src/index.js', 'src/server.ts', 'src/app.ts', 'server.js'] },
    { name: 'Express', dep: 'express', configs: ['src/app.ts', 'src/app.js', 'src/server.ts', 'src/server.js', 'server.js', 'index.js'] }
  ];

  for (const sig of frameworkSignals) {
    if (allDeps[sig.dep]) {
      const matchedConfigs = sig.configs.filter((c) => fs.existsSync(path.join(rootDir, c)));
      if (matchedConfigs.length > 0) {
        frameworks.push({
          name: sig.name,
          version: allDeps[sig.dep],
          evidence: [`package.json#${sig.dep}`, ...matchedConfigs],
          confidence: 'HIGH'
        });
      } else {
        assumptions.push(
          `Dependency "${sig.dep}" (${allDeps[sig.dep]}) is present in package.json, but no matching ${sig.name} config/structure was found; not classifying project as ${sig.name} based on a single dependency.`
        );
      }
    }
  }

  for (const entry of entries) {
    if (entry.isFile()) {
      const m = entry.name.match(/^([a-z0-9_-]+)\.config\.(js|mjs|cjs|ts|json|toml|yaml)$/i);
      if (m) {
        const fwPrefix = m[1].toLowerCase();
        const knownPrefixes = new Set(['astro', 'next', 'nuxt', 'svelte', 'vite', 'vitest', 'jest', 'eslint', 'prettier', 'tailwind', 'postcss', 'tsup', 'rollup', 'webpack', 'babel', 'playwright', 'cypress', 'drizzle', 'prisma']);
        if (!knownPrefixes.has(fwPrefix)) {
          const fwTokenRegex = new RegExp(`(^|[@/_-])${fwPrefix}([@/_-]|$)`, 'i');
          const matchingDepKey = Object.keys(allDeps).find((k) => fwTokenRegex.test(k));
          const evidence = [entry.name];
          if (matchingDepKey) evidence.push(`package.json#${matchingDepKey}`);
          if (fs.existsSync(path.join(rootDir, 'docs'))) evidence.push('docs/');
          frameworks.push({
            name: matchingDepKey ? `${fwPrefix} (${matchingDepKey})` : `${fwPrefix} (custom/unknown framework)`,
            version: matchingDepKey ? allDeps[matchingDepKey] : 'custom',
            evidence,
            confidence: matchingDepKey ? 'HIGH' : 'MEDIUM',
            customFramework: true
          });
        }
      }
    }
  }

  return { frameworks, assumptions };
}

function discoverWorkspaceSection(rootDir, fileNames, pkgJson) {
  let topology = 'standalone';
  let monorepoManager = null;
  const packages = [];
  const dependencyGraph = {};

  let workspacePatterns = [];
  if (fileNames.has('pnpm-workspace.yaml')) {
    monorepoManager = 'pnpm-workspaces';
    workspacePatterns = parsePnpmWorkspacePatterns(readTextSafe(path.join(rootDir, 'pnpm-workspace.yaml')));
  } else if (pkgJson?.workspaces) {
    monorepoManager = 'npm/yarn-workspaces';
    workspacePatterns = Array.isArray(pkgJson.workspaces)
      ? pkgJson.workspaces
      : pkgJson.workspaces.packages || [];
  }

  if (fileNames.has('turbo.json')) {
    monorepoManager = monorepoManager ? `${monorepoManager}+turborepo` : 'turborepo';
  }
  if (fileNames.has('nx.json')) {
    monorepoManager = monorepoManager ? `${monorepoManager}+nx` : 'nx';
  }
  if (fileNames.has('go.work')) {
    monorepoManager = 'go-work';
    topology = 'monorepo';
  }

  const cargoToml = readTextSafe(path.join(rootDir, 'Cargo.toml'));
  if (cargoToml && /\[workspace\]/.test(cargoToml)) {
    monorepoManager = 'cargo-workspace';
    topology = 'monorepo';
  }

  if (workspacePatterns.length > 0) {
    topology = 'monorepo';
    const pkgDirs = expandWorkspaceGlobs(rootDir, workspacePatterns);
    for (const relDir of pkgDirs) {
      const subPkg = readJsonSafe(path.join(rootDir, relDir, 'package.json'));
      if (subPkg) {
        const pkgName = subPkg.name || relDir;
        const subDeps = {
          ...(subPkg.dependencies || {}),
          ...(subPkg.devDependencies || {}),
          ...(subPkg.peerDependencies || {})
        };
        packages.push({
          name: pkgName,
          path: relDir,
          scripts: Object.keys(subPkg.scripts || {}),
          rawDeps: Object.keys(subDeps)
        });
      }
    }

    const internalNames = new Set(packages.map((p) => p.name));
    for (const pkg of packages) {
      const internalDeps = pkg.rawDeps.filter((d) => internalNames.has(d));
      pkg.internalDependencies = internalDeps;
      delete pkg.rawDeps;
      dependencyGraph[pkg.name] = internalDeps;
    }
  }

  return { topology, monorepoManager, packages, dependencyGraph };
}

function discoverVerificationCommandsSection(rootDir, fileNames, pkgJson, packageManagers) {
  const verificationCommands = {
    format: null,
    lint: null,
    typecheck: null,
    test: null,
    integration: null,
    build: null
  };

  const pmRunner = packageManagers[0] === 'pnpm'
    ? 'pnpm run'
    : packageManagers[0] === 'bun'
    ? 'bun run'
    : packageManagers[0] === 'yarn'
    ? 'yarn'
    : 'npm run';

  const scripts = pkgJson?.scripts || {};
  for (const [scriptName] of Object.entries(scripts)) {
    const lower = scriptName.toLowerCase();
    if (!verificationCommands.format && /^(format|fmt|prettier)/.test(lower)) {
      verificationCommands.format = `${pmRunner} ${scriptName}`;
    }
    if (!verificationCommands.lint && /^(lint|check:lint|eslint|biome)/.test(lower)) {
      verificationCommands.lint = `${pmRunner} ${scriptName}`;
    }
    if (!verificationCommands.typecheck && /^(typecheck|type-check|types|tsc|check:types)/.test(lower)) {
      verificationCommands.typecheck = `${pmRunner} ${scriptName}`;
    }
    if (!verificationCommands.test && /^(test|test:unit|unit)$/.test(lower)) {
      verificationCommands.test = scriptName === 'test' && pmRunner === 'npm run' ? 'npm test' : `${pmRunner} ${scriptName}`;
    }
    if (!verificationCommands.integration && /^(test:integration|test:e2e|e2e|integration)/.test(lower)) {
      verificationCommands.integration = `${pmRunner} ${scriptName}`;
    }
    if (!verificationCommands.build && /^(build|compile)$/.test(lower)) {
      verificationCommands.build = `${pmRunner} ${scriptName}`;
    }
  }

  if (!verificationCommands.test) {
    if (fileNames.has('plugin.json') && fs.existsSync(path.join(rootDir, 'tests', 'run-tests.mjs'))) {
      verificationCommands.test = 'node ./tests/run-tests.mjs';
    } else if (fileNames.has('Cargo.toml')) {
      verificationCommands.test = 'cargo test';
      if (!verificationCommands.build) verificationCommands.build = 'cargo build';
    } else if (fileNames.has('go.mod')) {
      verificationCommands.test = 'go test ./...';
      if (!verificationCommands.build) verificationCommands.build = 'go build ./...';
    } else if (fileNames.has('pyproject.toml')) {
      verificationCommands.test = 'pytest';
    }
  }

  return verificationCommands;
}

function discoverDeploymentSection(rootDir) {
  const deploymentPlatforms = [];
  const hasAnyFile = (candidates) => candidates.some((c) => fs.existsSync(path.join(rootDir, c)));
  const deploySignals = [
    { files: ['wrangler.toml', 'wrangler.jsonc'], platform: 'Cloudflare Workers' },
    { files: ['vercel.json'], platform: 'Vercel' },
    { files: ['netlify.toml'], platform: 'Netlify' },
    { files: ['Dockerfile', 'docker-compose.yml', 'compose.yaml'], platform: 'Docker / Containers' },
    { files: ['fly.toml'], platform: 'Fly.io' },
    { files: ['railway.json', 'railway.toml'], platform: 'Railway' }
  ];
  for (const sig of deploySignals) {
    if (hasAnyFile(sig.files)) {
      deploymentPlatforms.push(sig.platform);
    }
  }
  return deploymentPlatforms;
}

/**
 * Compute monorepo impact analysis for a list of changed files.
 */
export function computeMonorepoImpact(topology, packages, changedFiles = []) {
  if (topology !== 'monorepo' || !Array.isArray(changedFiles) || changedFiles.length === 0) {
    return null;
  }

  const directlyAffected = new Set();
  let rootConfigChanged = false;

  for (const rawFile of changedFiles) {
    const normFile = String(rawFile).replace(/\\/g, '/').replace(/^\.\//, '');
    const matchedPkg = (packages || []).find(
      (p) => normFile === p.path || normFile.startsWith(`${p.path}/`)
    );
    if (matchedPkg) {
      directlyAffected.add(matchedPkg.name);
    } else {
      rootConfigChanged = true;
    }
  }

  const downstream = new Set();
  const queue = Array.from(directlyAffected);
  const visited = new Set(directlyAffected);
  while (queue.length > 0) {
    const current = queue.shift();
    for (const pkg of packages || []) {
      if (
        pkg.name !== current &&
        pkg.internalDependencies?.includes(current) &&
        !downstream.has(pkg.name)
      ) {
        downstream.add(pkg.name);
        if (!visited.has(pkg.name)) {
          visited.add(pkg.name);
          queue.push(pkg.name);
        }
      }
    }
  }

  const allImpacted = new Set([...directlyAffected, ...downstream]);
  const expandToWorkspace = rootConfigChanged || directlyAffected.size === 0;

  return {
    changedFiles,
    directlyAffectedPackages: Array.from(directlyAffected),
    downstreamDependents: Array.from(downstream),
    allImpactedPackages: expandToWorkspace
      ? (packages || []).map((p) => p.name)
      : Array.from(allImpacted),
    rootConfigChanged,
    verificationScope: expandToWorkspace
      ? 'workspace-wide'
      : downstream.size > 0
      ? 'affected-and-dependents'
      : 'package-focused',
    rationale: expandToWorkspace
      ? 'Root/shared configuration changed or package boundary could not be isolated; expanding verification to workspace-wide.'
      : downstream.size > 0
      ? `Shared package(s) [${Array.from(directlyAffected).join(', ')}] changed; expanding verification to include downstream dependents [${Array.from(downstream).join(', ')}].`
      : `Leaf package(s) [${Array.from(directlyAffected).join(', ')}] changed with no downstream dependents; running focused package verification.`
  };
}

/**
 * Inspect task-specific source files directly from the live repository (P13 #7).
 * Never caches raw source code; returns live existence, size, line count, and content hash.
 */
export function inspectLiveTaskFiles(rootDir, taskFiles = []) {
  const inspected = [];
  for (const rawRel of taskFiles || []) {
    const normRel = String(rawRel).replace(/\\/g, '/').replace(/^\.\//, '');
    const absPath = path.resolve(rootDir, normRel);
    // Reject path traversal outside rootDir
    if (path.relative(rootDir, absPath).startsWith('..')) continue;
    try {
      if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        const content = fs.readFileSync(absPath, 'utf8');
        inspected.push({
          path: normRel,
          exists: true,
          sizeBytes: Buffer.byteLength(content, 'utf8'),
          lineCount: content.split(/\r?\n/).length,
          liveSha256: sha256(content, 24),
          inspectedLiveAt: new Date().toISOString()
        });
      } else {
        inspected.push({
          path: normRel,
          exists: false,
          inspectedLiveAt: new Date().toISOString()
        });
      }
    } catch {
      inspected.push({ path: normRel, exists: false });
    }
  }
  return inspected;
}

/**
 * Assemble a flat Project Context Profile from versioned contextSections.
 */
function assembleProfileFromSections(rootDir, sections, assumptions = [], confidence = 'HIGH') {
  const wsVal = sections.workspacePackages?.value || { monorepoManager: null, packages: [] };
  return {
    workspaceRoot: rootDir.replace(/\\/g, '/'),
    topology: sections.topology?.value || 'standalone',
    languages: sections.languages?.value || [],
    packageManagers: sections.packageManagers?.value || [],
    monorepoManager: wsVal.monorepoManager || null,
    frameworks: sections.frameworks?.value || [],
    packages: wsVal.packages || [],
    dependencyGraph: sections.dependencyGraph?.value || {},
    verificationCommands: sections.verificationCommands?.value || {
      format: null,
      lint: null,
      typecheck: null,
      test: null,
      integration: null,
      build: null
    },
    projectInstructions: sections.projectInstructions?.value || [],
    ciCd: sections.ciCd?.value || {
      provider: null,
      workflowFiles: [],
      commandsByType: { lint: [], typecheck: [], test: [], build: [], install: [] },
      duplicateChecks: [],
      cachingOpportunities: [],
      redundantBuilds: []
    },
    deploymentPlatforms: sections.deployment?.value || [],
    impactAnalysis: null,
    assumptions,
    confidence
  };
}

/**
 * Refresh only the invalidated sections of an existing cached Project Context record,
 * or build all sections when performing initial/full discovery (Section 8).
 *
 * @param {string} rootDir
 * @param {object|null} cachedRecord
 * @param {string[]} sectionsToCompute
 * @returns {{ sections: object, assumptions: string[], sectionsRecomputed: string[], sectionsReused: string[] }}
 */
export function refreshProjectContext(rootDir, cachedRecord = null, sectionsToCompute = [...CONTEXT_SECTION_KEYS]) {
  const toCompute = new Set(sectionsToCompute);
  const now = new Date().toISOString();
  const prevSections = cachedRecord?.contextSections || {};
  const sections = { ...prevSections };
  const assumptions = new Set(cachedRecord?.assumptions || []);
  const sectionsRecomputed = [];
  const sectionsReused = [];

  // Only read directory entries / package.json if at least one section needs them
  const needsRootScan =
    toCompute.has('projectInstructions') ||
    toCompute.has('packageManagers') ||
    toCompute.has('languages') ||
    toCompute.has('frameworks') ||
    toCompute.has('topology') ||
    toCompute.has('workspacePackages') ||
    toCompute.has('dependencyGraph') ||
    toCompute.has('verificationCommands');

  const entries = needsRootScan ? listDirSafe(rootDir) : [];
  const fileNames = needsRootScan ? new Set(entries.map((e) => e.name)) : new Set();
  const pkgJson = needsRootScan ? readJsonSafe(path.join(rootDir, 'package.json')) : null;

  // If packageManagers or frameworks are recomputed, refresh assumptions cleanly
  if (toCompute.has('packageManagers') || toCompute.has('frameworks')) {
    assumptions.clear();
  }

  // 1. projectInstructions
  if (toCompute.has('projectInstructions') || !sections.projectInstructions) {
    sections.projectInstructions = {
      value: discoverInstructionsSection(fileNames),
      verifiedAt: now,
      confidence: 'HIGH'
    };
    sectionsRecomputed.push('projectInstructions');
  } else {
    sectionsReused.push('projectInstructions');
  }

  // 2. packageManagers
  if (toCompute.has('packageManagers') || !sections.packageManagers) {
    const pmRes = discoverPackageManagersSection(fileNames, pkgJson);
    for (const a of pmRes.assumptions) assumptions.add(a);
    sections.packageManagers = {
      value: pmRes.packageManagers,
      verifiedAt: now,
      confidence: 'HIGH'
    };
    sectionsRecomputed.push('packageManagers');
  } else {
    sectionsReused.push('packageManagers');
  }

  // 3. languages
  if (toCompute.has('languages') || !sections.languages) {
    sections.languages = {
      value: discoverLanguagesSection(rootDir, fileNames, pkgJson),
      verifiedAt: now,
      confidence: 'HIGH'
    };
    sectionsRecomputed.push('languages');
  } else {
    sectionsReused.push('languages');
  }

  // 4. frameworks
  if (toCompute.has('frameworks') || !sections.frameworks) {
    const fwRes = discoverFrameworksSection(rootDir, entries, fileNames, pkgJson);
    for (const a of fwRes.assumptions) assumptions.add(a);
    sections.frameworks = {
      value: fwRes.frameworks,
      verifiedAt: now,
      confidence: 'HIGH'
    };
    sectionsRecomputed.push('frameworks');
  } else {
    sectionsReused.push('frameworks');
  }

  // 5. topology, workspacePackages, dependencyGraph
  if (
    toCompute.has('topology') ||
    toCompute.has('workspacePackages') ||
    toCompute.has('dependencyGraph') ||
    !sections.topology ||
    !sections.workspacePackages ||
    !sections.dependencyGraph
  ) {
    const wsRes = discoverWorkspaceSection(rootDir, fileNames, pkgJson);
    sections.topology = { value: wsRes.topology, verifiedAt: now, confidence: 'HIGH' };
    sections.workspacePackages = {
      value: { monorepoManager: wsRes.monorepoManager, packages: wsRes.packages },
      verifiedAt: now,
      confidence: 'HIGH'
    };
    sections.dependencyGraph = { value: wsRes.dependencyGraph, verifiedAt: now, confidence: 'HIGH' };
    for (const k of ['topology', 'workspacePackages', 'dependencyGraph']) {
      if (toCompute.has(k) || !prevSections[k]) sectionsRecomputed.push(k);
      else sectionsReused.push(k);
    }
  } else {
    sectionsReused.push('topology', 'workspacePackages', 'dependencyGraph');
  }

  // 6. verificationCommands
  if (toCompute.has('verificationCommands') || !sections.verificationCommands) {
    const pms = sections.packageManagers?.value || [];
    sections.verificationCommands = {
      value: discoverVerificationCommandsSection(rootDir, fileNames, pkgJson, pms),
      verifiedAt: now,
      confidence: 'HIGH'
    };
    sectionsRecomputed.push('verificationCommands');
  } else {
    sectionsReused.push('verificationCommands');
  }

  // 7. ciCd
  if (toCompute.has('ciCd') || !sections.ciCd) {
    sections.ciCd = {
      value: analyzeCiWorkflows(rootDir),
      verifiedAt: now,
      confidence: 'HIGH'
    };
    sectionsRecomputed.push('ciCd');
  } else {
    sectionsReused.push('ciCd');
  }

  // 8. deployment
  if (toCompute.has('deployment') || !sections.deployment) {
    sections.deployment = {
      value: discoverDeploymentSection(rootDir),
      verifiedAt: now,
      confidence: 'HIGH'
    };
    sectionsRecomputed.push('deployment');
  } else {
    sectionsReused.push('deployment');
  }

  return {
    sections,
    assumptions: Array.from(assumptions),
    sectionsRecomputed,
    sectionsReused
  };
}

/**
 * Discover a project directory and produce a structured Project Context Profile,
 * integrating P13 Persistent Context Intelligence, Freshness Validation, and Incremental Rediscovery.
 *
 * @param {string} workspaceDir
 * @param {object} [options={}]
 * @param {string[]} [options.changedFiles]
 * @param {string[]} [options.taskFiles]
 * @param {boolean} [options.useCache=true]
 * @param {boolean} [options.forceRefresh=false]
 * @param {boolean} [options.highRiskOperation=false]
 * @param {string} [options.cacheDir]
 * @param {string} [options.sessionDir]
 * @param {boolean} [options.simulateRestrictedStorage=false]
 * @returns {object}
 */
export function discoverProject(workspaceDir, changedFilesOrOptions = [], maybeOptions = {}) {
  const start = performance.now();
  const options = Array.isArray(changedFilesOrOptions)
    ? { ...maybeOptions, changedFiles: changedFilesOrOptions }
    : { ...(changedFilesOrOptions || {}) };
  const identity = resolveProjectIdentity(workspaceDir || process.cwd(), options);
  const rootDir = identity.canonicalRoot;
  const useCache = options.useCache !== false;
  const forceRefresh = options.forceRefresh === true;

  let cacheStatus = 'MISS';
  let freshnessReport = null;
  let sectionsResult = null;
  let loadedContext = null;

  if (useCache && !forceRefresh) {
    loadedContext = loadProjectContext(rootDir, { ...options, identity });

    if (loadedContext.status === 'FOUND' || loadedContext.status === 'RELOCATED') {
      freshnessReport = validateContextFreshness(rootDir, loadedContext.record, {
        ...options,
        identity
      });

      // P13 Requirement 8: High-risk operations must never depend on unverified cached configuration
      if (options.highRiskOperation === true) {
        const highRiskSections = new Set([
          ...freshnessReport.invalidatedSections,
          'verificationCommands',
          'ciCd',
          'deployment',
          'frameworks',
          'dependencyGraph'
        ]);
        freshnessReport.invalidatedSections = CONTEXT_SECTION_KEYS.filter((k) => highRiskSections.has(k));
        freshnessReport.validSections = CONTEXT_SECTION_KEYS.filter((k) => !highRiskSections.has(k));
        freshnessReport.status = 'PARTIAL_STALE';
        freshnessReport.isFresh = false;
        freshnessReport.reasons.push('High-risk operation requested: forcing live re-verification of critical configuration sections.');
      }

      if (freshnessReport.isFresh && loadedContext.status === 'FOUND') {
        cacheStatus = 'HIT';
        sectionsResult = {
          sections: loadedContext.record.contextSections,
          assumptions: loadedContext.record.assumptions || [],
          sectionsRecomputed: [],
          sectionsReused: [...CONTEXT_SECTION_KEYS]
        };
      } else if (
        freshnessReport.status === 'PARTIAL_STALE' &&
        freshnessReport.invalidatedSections.length < CONTEXT_SECTION_KEYS.length
      ) {
        cacheStatus = 'INCREMENTAL_REFRESH';
        sectionsResult = refreshProjectContext(
          rootDir,
          loadedContext.record,
          freshnessReport.invalidatedSections
        );
      } else {
        cacheStatus = 'FULL_REDISCOVERY';
        sectionsResult = refreshProjectContext(rootDir, null, [...CONTEXT_SECTION_KEYS]);
      }
    } else if (loadedContext.status === 'CORRUPTED' || loadedContext.status === 'SCHEMA_MISMATCH') {
      cacheStatus = 'FULL_REDISCOVERY';
      sectionsResult = refreshProjectContext(rootDir, null, [...CONTEXT_SECTION_KEYS]);
    }
  }

  if (!sectionsResult) {
    cacheStatus = forceRefresh ? 'FORCED_REFRESH' : 'MISS';
    sectionsResult = refreshProjectContext(rootDir, null, [...CONTEXT_SECTION_KEYS]);
  }

  const profile = assembleProfileFromSections(
    rootDir,
    sectionsResult.sections,
    sectionsResult.assumptions,
    'HIGH'
  );

  // Snapshot current repository state (reuse freshnessReport snapshot when valid)
  const currentSnapshot =
    freshnessReport?.currentSnapshot && sectionsResult.sectionsRecomputed.length === 0
      ? freshnessReport.currentSnapshot
      : collectRepositorySnapshot(rootDir, identity, profile.packages, options);

  // Merge explicit options.changedFiles, freshness-detected changes, and live git dirty files (REL-06)
  const explicitChanged = Array.isArray(options.changedFiles) ? options.changedFiles : [];
  const detectedChanged = freshnessReport?.changedFiles || [];
  const liveDirtyChanged = (currentSnapshot.gitStatusFiles || []).flatMap((item) =>
    item.oldPath ? [item.oldPath, item.path] : [item.path]
  );
  const effectiveChangedFiles = Array.from(
    new Set(
      [...explicitChanged, ...detectedChanged, ...liveDirtyChanged]
        .filter(Boolean)
        .map((f) => String(f).replace(/\\/g, '/').replace(/^\.\//, ''))
    )
  );

  if (effectiveChangedFiles.length > 0) {
    profile.impactAnalysis = computeMonorepoImpact(
      profile.topology,
      profile.packages,
      effectiveChangedFiles
    );
  }

  // Task-specific live source file inspection (P13 Requirement 7)
  const filesToInspect = Array.isArray(options.taskFiles)
    ? options.taskFiles
    : effectiveChangedFiles.slice(0, 20);
  profile.taskSpecificFiles = inspectLiveTaskFiles(rootDir, filesToInspect);

  const verifiedAt = new Date().toISOString();
  const evidence = buildContextEvidence(profile, currentSnapshot, identity);

  const prevMeta = loadedContext?.record?.cacheMetadata || {};
  const hadDirtyHints =
    (prevMeta.dirtyHintFiles?.length || 0) > 0 || (prevMeta.dirtyHintCommands?.length || 0) > 0;

  let saveOutcome = {
    saved: false,
    skippedUnchangedWrite: false,
    persistent: false,
    storageTier: 'disabled',
    cacheFilePath: null
  };

  if (useCache) {
    if (cacheStatus === 'HIT' && loadedContext?.status === 'FOUND' && !hadDirtyHints) {
      // Avoid rewriting the full profile JSON on an unchanged cache HIT (Section 8)
      saveOutcome = {
        saved: false,
        skippedUnchangedWrite: true,
        persistent: Boolean(loadedContext.storage?.persistent),
        storageTier: loadedContext.storage?.storageTier || 'unknown',
        cacheFilePath: loadedContext.filePath || null
      };
    } else {
      const recordToSave = {
        schemaVersion: CONTEXT_SCHEMA_VERSION,
        projectIdentity: identity,
        workspaceRoots: [rootDir],
        repositoryMetadata: {
          isGitRepo: identity.isGitRepo,
          headCommit: identity.headCommit,
          branch: identity.branch,
          isDetachedHead: identity.isDetachedHead,
          hasDirtyWorkingTree: (currentSnapshot.gitStatusFiles || []).length > 0
        },
        snapshot: currentSnapshot,
        contextSections: sectionsResult.sections,
        assumptions: sectionsResult.assumptions,
        evidence,
        verifiedAt,
        invalidatedSections: sectionsResult.sectionsRecomputed,
        cacheMetadata: {
          createdAt: prevMeta.createdAt || verifiedAt,
          updatedAt: verifiedAt,
          hitCount: (prevMeta.hitCount || 0) + (cacheStatus === 'HIT' ? 1 : 0),
          incrementalRefreshCount:
            (prevMeta.incrementalRefreshCount || 0) + (cacheStatus === 'INCREMENTAL_REFRESH' ? 1 : 0),
          fullDiscoveryCount:
            (prevMeta.fullDiscoveryCount || 0) +
            (['MISS', 'FULL_REDISCOVERY', 'FORCED_REFRESH'].includes(cacheStatus) ? 1 : 0),
          dirtyHintFiles: [],
          dirtyHintCommands: []
        }
      };
      saveOutcome = {
        skippedUnchangedWrite: false,
        ...saveProjectContext(rootDir, recordToSave, { ...options, identity })
      };
    }
  }

  const durationMs = Number((performance.now() - start).toFixed(2));
  const profileSizeBytes = Buffer.byteLength(JSON.stringify(profile), 'utf8');

  const metricEventType =
    cacheStatus === 'HIT'
      ? 'CACHE_HIT'
      : cacheStatus === 'INCREMENTAL_REFRESH'
      ? 'INCREMENTAL_REFRESH'
      : cacheStatus === 'FULL_REDISCOVERY'
      ? 'FULL_REDISCOVERY'
      : 'INITIAL_DISCOVERY';

  const metrics = recordAndGetContextMetrics(
    identity.projectId,
    {
      type: metricEventType,
      durationMs,
      profileSizeBytes,
      invalidatedSections: sectionsResult.sectionsRecomputed,
      reusedSections: sectionsResult.sectionsReused
    },
    loadedContext?.storage || null
  );

  profile.schemaVersion = CONTEXT_SCHEMA_VERSION;
  profile.contextIntelligence = {
    principle: 'P13 — Context Freshness & Integrity',
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    projectId: identity.projectId,
    worktreeKey: identity.worktreeKey,
    commonRepoKey: identity.commonRepoKey,
    relativeSubdir: identity.relativeSubdir,
    isGitRepo: identity.isGitRepo,
    isLinkedWorktree: identity.isLinkedWorktree,
    headCommit: identity.headCommit,
    branch: identity.branch,
    cacheStatus,
    freshnessStatus:
      loadedContext?.status === 'CORRUPTED'
        ? 'CORRUPTED_REBUILT'
        : loadedContext?.status === 'SCHEMA_MISMATCH'
        ? 'SCHEMA_MISMATCH_REBUILT'
        : freshnessReport?.status || 'INITIAL_SNAPSHOT',
    storageTier: saveOutcome.storageTier,
    persisted: saveOutcome.persistent,
    skippedUnchangedWrite: Boolean(saveOutcome.skippedUnchangedWrite),
    cacheFilePath: saveOutcome.cacheFilePath || null,
    sectionsRecomputed: sectionsResult.sectionsRecomputed,
    sectionsReused: sectionsResult.sectionsReused,
    changedFiles: effectiveChangedFiles,
    invalidationReasons:
      loadedContext?.reason
        ? [loadedContext.reason, ...(freshnessReport?.reasons || [])]
        : freshnessReport?.reasons || [],
    verifiedAt,
    durationMs,
    metrics
  };

  return profile;
}

/**
 * Discover multiple independent workspace roots safely without cross-repository contamination (P13-13).
 *
 * @param {string[]} workspacePaths
 * @param {object} [options={}]
 * @returns {{ roots: object[], byProjectId: Record<string, object> }}
 */
export function discoverMultiRootWorkspace(workspacePaths = [], options = {}) {
  const roots = [];
  const byProjectId = {};
  for (const wsPath of workspacePaths) {
    const prof = discoverProject(wsPath, options);
    roots.push(prof);
    byProjectId[prof.contextIntelligence.projectId] = prof;
  }
  return {
    multiRoot: true,
    rootCount: roots.length,
    isolatedContexts: new Set(roots.map((r) => r.contextIntelligence.projectId)).size === roots.length,
    roots,
    byProjectId
  };
}

async function main() {
  const args = process.argv.slice(2);
  let targetDir = process.cwd();
  let changedFiles = [];
  let taskFiles = [];
  let forceRefresh = false;
  let useCache = true;
  let clearCache = false;
  let cacheDir = null;
  let multiRoots = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--changed' && args[i + 1]) {
      changedFiles = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--task-files' && args[i + 1]) {
      taskFiles = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--multi-root' && args[i + 1]) {
      multiRoots = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--cache-dir' && args[i + 1]) {
      cacheDir = args[i + 1];
      i++;
    } else if (args[i] === '--force-refresh') {
      forceRefresh = true;
    } else if (args[i] === '--no-cache') {
      useCache = false;
    } else if (args[i] === '--clear-cache') {
      clearCache = true;
    } else if (!args[i].startsWith('--')) {
      targetDir = args[i];
    }
  }

  if (clearCache) {
    const res = clearProjectContext(targetDir, { cacheDir });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  if (multiRoots.length > 0) {
    const multiRes = discoverMultiRootWorkspace(multiRoots, {
      changedFiles,
      taskFiles,
      forceRefresh,
      useCache,
      cacheDir
    });
    process.stdout.write(JSON.stringify(multiRes, null, 2) + '\n');
    return;
  }

  const profile = discoverProject(targetDir, {
    changedFiles,
    taskFiles,
    forceRefresh,
    useCache,
    cacheDir
  });
  process.stdout.write(JSON.stringify(profile, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('discover-project.mjs')) {
  main();
}
