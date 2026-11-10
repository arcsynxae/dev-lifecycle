#!/usr/bin/env node
/**
 * DevLifecycle v2 — Universal Project & Monorepo Intelligence Engine
 *
 * Implements Section 3 (Universal Project Intelligence) & Section 14 (CI/CD Efficiency):
 * - Framework-agnostic multi-signal stack discovery (never identifies a framework from 1 dep alone).
 * - Supports standalone repositories, monorepos, polyglot workspaces, and unknown/custom frameworks.
 * - Maps workspace package boundaries, internal dependencies, directly affected packages,
 *   and transitive downstream dependents.
 * - Inspects CI/CD workflows (e.g. GitHub Actions) for duplicate checks, repeated installs,
 *   and redundant builds.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Safely read and parse JSON file.
 */
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    // Strip single-line and multi-line comments for JSONC compatibility
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

    // Identify duplicate checks across jobs/workflows
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

/**
 * Discover a project directory and produce a structured Project Context Profile.
 * @param {string} workspaceDir
 * @param {object} options
 * @param {string[]} [options.changedFiles]
 * @returns {object}
 */
export function discoverProject(workspaceDir, options = {}) {
  const rootDir = path.resolve(workspaceDir || process.cwd());
  const entries = listDirSafe(rootDir);
  const fileNames = new Set(entries.map((e) => e.name));

  const profile = {
    workspaceRoot: rootDir.replace(/\\/g, '/'),
    topology: 'standalone',
    languages: [],
    packageManagers: [],
    monorepoManager: null,
    frameworks: [],
    packages: [],
    dependencyGraph: {},
    verificationCommands: {
      format: null,
      lint: null,
      typecheck: null,
      test: null,
      integration: null,
      build: null
    },
    projectInstructions: [],
    ciCd: analyzeCiWorkflows(rootDir),
    deploymentPlatforms: [],
    impactAnalysis: null,
    assumptions: [],
    confidence: 'HIGH'
  };

  // 1. Discover project instruction files (P01)
  const instructionCandidates = [
    'AGENTS.md',
    'GEMINI.md',
    'CLAUDE.md',
    'README.md',
    'CONTRIBUTING.md',
    'ARCHITECTURE.md'
  ];
  for (const candidate of instructionCandidates) {
    if (fileNames.has(candidate)) {
      profile.projectInstructions.push(candidate);
    }
  }

  // 2. Discover Package Managers (Lockfile & packageManager field precedence)
  const pkgJson = readJsonSafe(path.join(rootDir, 'package.json'));
  if (pkgJson?.packageManager) {
    const pmName = String(pkgJson.packageManager).split('@')[0];
    profile.packageManagers.push(pmName);
  }
  if (fileNames.has('pnpm-lock.yaml') && !profile.packageManagers.includes('pnpm')) {
    profile.packageManagers.push('pnpm');
  }
  if ((fileNames.has('bun.lock') || fileNames.has('bun.lockb')) && !profile.packageManagers.includes('bun')) {
    profile.packageManagers.push('bun');
  }
  if (fileNames.has('yarn.lock') && !profile.packageManagers.includes('yarn')) {
    profile.packageManagers.push('yarn');
  }
  if (fileNames.has('package-lock.json') && !profile.packageManagers.includes('npm')) {
    profile.packageManagers.push('npm');
  }
  if (pkgJson && profile.packageManagers.length === 0) {
    profile.packageManagers.push('npm');
    profile.assumptions.push('No JS lockfile found; defaulting Node script runner to npm/node.');
  }

  if (fileNames.has('uv.lock')) profile.packageManagers.push('uv');
  else if (fileNames.has('poetry.lock')) profile.packageManagers.push('poetry');
  else if (fileNames.has('pyproject.toml') || fileNames.has('requirements.txt')) profile.packageManagers.push('pip');

  if (fileNames.has('Cargo.toml')) profile.packageManagers.push('cargo');
  if (fileNames.has('go.mod')) profile.packageManagers.push('go');
  if (fileNames.has('composer.json')) profile.packageManagers.push('composer');
  if (fileNames.has('Makefile') || fileNames.has('justfile')) profile.packageManagers.push('make');

  // 3. Languages & Runtimes
  const hasMjsOrJsScripts = listDirSafe(path.join(rootDir, 'scripts')).some((e) => /\.(m?js|cjs)$/i.test(e.name));
  if (pkgJson || fileNames.has('tsconfig.json') || hasMjsOrJsScripts) {
    if (
      fileNames.has('tsconfig.json') ||
      pkgJson?.devDependencies?.typescript ||
      pkgJson?.dependencies?.typescript
    ) {
      profile.languages.push('TypeScript');
    }
    profile.languages.push('JavaScript / Node.js');
  }
  if (fileNames.has('pyproject.toml') || fileNames.has('requirements.txt')) profile.languages.push('Python');
  if (fileNames.has('Cargo.toml')) profile.languages.push('Rust');
  if (fileNames.has('go.mod')) profile.languages.push('Go');
  if (fileNames.has('composer.json')) profile.languages.push('PHP');

  // 4. Multi-Signal Framework Detection (Never from 1 dependency alone!)
  const allDeps = {
    ...(pkgJson?.dependencies || {}),
    ...(pkgJson?.devDependencies || {})
  };

  const hasAnyFile = (candidates) => candidates.some((c) => fs.existsSync(path.join(rootDir, c)));

  // Antigravity Plugin detection
  if (fileNames.has('plugin.json') && (fileNames.has('skills') || fileNames.has('agents') || fileNames.has('rules'))) {
    profile.frameworks.push({
      name: 'Google Antigravity Plugin',
      version: readJsonSafe(path.join(rootDir, 'plugin.json'))?.version || 'unknown',
      evidence: ['plugin.json', 'skills/', 'agents/', 'rules/'].filter((f) => fs.existsSync(path.join(rootDir, f.replace(/\/$/, '')))),
      confidence: 'HIGH'
    });
  }

  // Known frameworks requiring multi-signal evidence
  const frameworkSignals = [
    {
      name: 'Astro',
      dep: 'astro',
      configs: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js']
    },
    {
      name: 'Next.js',
      dep: 'next',
      configs: ['next.config.js', 'next.config.mjs', 'next.config.ts', 'app', 'pages']
    },
    {
      name: 'Nuxt',
      dep: 'nuxt',
      configs: ['nuxt.config.ts', 'nuxt.config.js']
    },
    {
      name: 'SvelteKit',
      dep: '@sveltejs/kit',
      configs: ['svelte.config.js', 'vite.config.ts', 'vite.config.js']
    },
    {
      name: 'Vite',
      dep: 'vite',
      configs: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']
    },
    {
      name: 'Hono',
      dep: 'hono',
      configs: ['wrangler.toml', 'wrangler.jsonc', 'src/index.ts', 'src/index.js']
    },
    {
      name: 'Express',
      dep: 'express',
      configs: ['src/app.ts', 'src/app.js', 'src/server.ts', 'src/server.js', 'server.js', 'index.js']
    }
  ];

  for (const sig of frameworkSignals) {
    if (allDeps[sig.dep]) {
      const matchedConfigs = sig.configs.filter((c) => fs.existsSync(path.join(rootDir, c)));
      if (matchedConfigs.length > 0) {
        profile.frameworks.push({
          name: sig.name,
          version: allDeps[sig.dep],
          evidence: [`package.json#${sig.dep}`, ...matchedConfigs],
          confidence: 'HIGH'
        });
      } else {
        // Single dependency only -> record as LOW confidence assumption, NOT verified framework
        profile.assumptions.push(
          `Dependency "${sig.dep}" (${allDeps[sig.dep]}) is present in package.json, but no matching ${sig.name} config/structure was found; not classifying project as ${sig.name} based on a single dependency.`
        );
      }
    }
  }

  // Detect Unknown / Custom Frameworks (e.g., Void, custom config files + dependency/runtime)
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
          profile.frameworks.push({
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

  // 5. Monorepo & Workspace Discovery
  let workspacePatterns = [];
  if (fileNames.has('pnpm-workspace.yaml')) {
    profile.monorepoManager = 'pnpm-workspaces';
    workspacePatterns = parsePnpmWorkspacePatterns(readTextSafe(path.join(rootDir, 'pnpm-workspace.yaml')));
  } else if (pkgJson?.workspaces) {
    profile.monorepoManager = 'npm/yarn-workspaces';
    workspacePatterns = Array.isArray(pkgJson.workspaces)
      ? pkgJson.workspaces
      : pkgJson.workspaces.packages || [];
  }

  if (fileNames.has('turbo.json')) {
    profile.monorepoManager = profile.monorepoManager ? `${profile.monorepoManager}+turborepo` : 'turborepo';
  }
  if (fileNames.has('nx.json')) {
    profile.monorepoManager = profile.monorepoManager ? `${profile.monorepoManager}+nx` : 'nx';
  }
  if (fileNames.has('go.work')) {
    profile.monorepoManager = 'go-work';
    profile.topology = 'monorepo';
  }

  const cargoToml = readTextSafe(path.join(rootDir, 'Cargo.toml'));
  if (cargoToml && /\[workspace\]/.test(cargoToml)) {
    profile.monorepoManager = 'cargo-workspace';
    profile.topology = 'monorepo';
  }

  if (workspacePatterns.length > 0) {
    profile.topology = 'monorepo';
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
        profile.packages.push({
          name: pkgName,
          path: relDir,
          scripts: Object.keys(subPkg.scripts || {}),
          rawDeps: Object.keys(subDeps)
        });
      }
    }

    // Build internal dependency graph between workspace packages
    const internalNames = new Set(profile.packages.map((p) => p.name));
    for (const pkg of profile.packages) {
      const internalDeps = pkg.rawDeps.filter((d) => internalNames.has(d));
      pkg.internalDependencies = internalDeps;
      delete pkg.rawDeps;
      profile.dependencyGraph[pkg.name] = internalDeps;
    }
  }

  // 6. Verification Commands Discovery
  const pmRunner = profile.packageManagers[0] === 'pnpm'
    ? 'pnpm run'
    : profile.packageManagers[0] === 'bun'
    ? 'bun run'
    : profile.packageManagers[0] === 'yarn'
    ? 'yarn'
    : 'npm run';

  const scripts = pkgJson?.scripts || {};
  for (const [scriptName] of Object.entries(scripts)) {
    const lower = scriptName.toLowerCase();
    if (!profile.verificationCommands.format && /^(format|fmt|prettier)/.test(lower)) {
      profile.verificationCommands.format = `${pmRunner} ${scriptName}`;
    }
    if (!profile.verificationCommands.lint && /^(lint|check:lint|eslint|biome)/.test(lower)) {
      profile.verificationCommands.lint = `${pmRunner} ${scriptName}`;
    }
    if (!profile.verificationCommands.typecheck && /^(typecheck|type-check|types|tsc|check:types)/.test(lower)) {
      profile.verificationCommands.typecheck = `${pmRunner} ${scriptName}`;
    }
    if (!profile.verificationCommands.test && /^(test|test:unit|unit)$/.test(lower)) {
      profile.verificationCommands.test = scriptName === 'test' && pmRunner === 'npm run' ? 'npm test' : `${pmRunner} ${scriptName}`;
    }
    if (!profile.verificationCommands.integration && /^(test:integration|test:e2e|e2e|integration)/.test(lower)) {
      profile.verificationCommands.integration = `${pmRunner} ${scriptName}`;
    }
    if (!profile.verificationCommands.build && /^(build|compile)$/.test(lower)) {
      profile.verificationCommands.build = `${pmRunner} ${scriptName}`;
    }
  }

  // Fallbacks for non-Node or native plugin repositories
  if (!profile.verificationCommands.test) {
    if (fileNames.has('plugin.json') && fs.existsSync(path.join(rootDir, 'tests', 'run-tests.mjs'))) {
      profile.verificationCommands.test = 'node ./tests/run-tests.mjs';
    } else if (fileNames.has('Cargo.toml')) {
      profile.verificationCommands.test = 'cargo test';
    } else if (fileNames.has('go.mod')) {
      profile.verificationCommands.test = 'go test ./...';
    } else if (fileNames.has('pyproject.toml')) {
      profile.verificationCommands.test = 'pytest';
    }
  }

  // 7. Deployment Platform Evidence
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
      profile.deploymentPlatforms.push(sig.platform);
    }
  }

  // 8. Monorepo Impact Analysis (when changedFiles provided)
  if (profile.topology === 'monorepo' && Array.isArray(options.changedFiles) && options.changedFiles.length > 0) {
    const directlyAffected = new Set();
    let rootConfigChanged = false;

    for (const rawFile of options.changedFiles) {
      const normFile = String(rawFile).replace(/\\/g, '/').replace(/^\.\//, '');
      const matchedPkg = profile.packages.find(
        (p) => normFile === p.path || normFile.startsWith(`${p.path}/`)
      );
      if (matchedPkg) {
        directlyAffected.add(matchedPkg.name);
      } else {
        rootConfigChanged = true;
      }
    }

    // Compute transitive downstream dependents
    const downstream = new Set();
    const queue = Array.from(directlyAffected);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const pkg of profile.packages) {
        if (
          pkg.internalDependencies?.includes(current) &&
          !directlyAffected.has(pkg.name) &&
          !downstream.has(pkg.name)
        ) {
          downstream.add(pkg.name);
          queue.push(pkg.name);
        }
      }
    }

    const allImpacted = new Set([...directlyAffected, ...downstream]);
    const expandToWorkspace = rootConfigChanged || directlyAffected.size === 0;

    profile.impactAnalysis = {
      changedFiles: options.changedFiles,
      directlyAffectedPackages: Array.from(directlyAffected),
      downstreamDependents: Array.from(downstream),
      allImpactedPackages: expandToWorkspace
        ? profile.packages.map((p) => p.name)
        : Array.from(allImpacted),
      rootConfigChanged,
      verificationScope: expandToWorkspace ? 'workspace-wide' : downstream.size > 0 ? 'affected-and-dependents' : 'package-focused',
      rationale: expandToWorkspace
        ? 'Root/shared configuration changed or package boundary could not be isolated; expanding verification to workspace-wide.'
        : downstream.size > 0
        ? `Shared package(s) [${Array.from(directlyAffected).join(', ')}] changed; expanding verification to include downstream dependents [${Array.from(downstream).join(', ')}].`
        : `Leaf package(s) [${Array.from(directlyAffected).join(', ')}] changed with no downstream dependents; running focused package verification.`
    };
  }

  return profile;
}

async function main() {
  const args = process.argv.slice(2);
  let targetDir = process.cwd();
  let changedFiles = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--changed' && args[i + 1]) {
      changedFiles = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (!args[i].startsWith('--')) {
      targetDir = args[i];
    }
  }

  const profile = discoverProject(targetDir, { changedFiles });
  process.stdout.write(JSON.stringify(profile, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('discover-project.mjs')) {
  main();
}
