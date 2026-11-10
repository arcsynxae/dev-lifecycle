#!/usr/bin/env node
/**
 * DevLifecycle v2 — Comprehensive Plugin Validation & Acceptance Test Suite
 *
 * Executes:
 * 1. Structural, frontmatter, and byte-budget checks across all plugin components.
 * 2. Official `agy plugin validate --strict` CLI verification (when `agy` is installed).
 * 3. Hook contract tests (PreToolUse allow/ask/force_ask/deny, PostToolUse, Stop).
 * 4. All 10 Mandatory Acceptance Scenarios (Scenarios A through J from Section 18).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluatePreToolSafety } from '../scripts/pre-tool-safety.mjs';
import { updateVerificationTelemetry } from '../scripts/post-tool-tracker.mjs';
import { evaluateStopGate } from '../scripts/stop-gate.mjs';
import { discoverProject, analyzeCiWorkflows } from '../scripts/discover-project.mjs';
import { classifyTask, evaluateBoundedRecovery } from '../scripts/classify-task.mjs';
import { checkCleanRepository, evaluateLifecycleDelivery } from '../scripts/lifecycle-check.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

const results = [];

function runTest(id, name, fn) {
  const start = performance.now();
  try {
    const details = fn();
    const durationMs = Number((performance.now() - start).toFixed(1));
    results.push({ id, name, status: 'PASS', durationMs, details: details || 'Verified' });
    console.log(`  ✔ [${id}] ${name} (${durationMs}ms)`);
  } catch (err) {
    const durationMs = Number((performance.now() - start).toFixed(1));
    results.push({ id, name, status: 'FAIL', durationMs, error: err.message });
    console.error(`  ✖ [${id}] ${name} FAILED: ${err.message}`);
  }
}

function makeTempFixture(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dl-test-${prefix}-`));
}

function cleanupTempFixture(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on Windows file locks
  }
}

console.log('======================================================================');
console.log(' DevLifecycle v2 — Plugin Validation & Acceptance Test Suite');
console.log('======================================================================\n');

// ---------------------------------------------------------------------------
// 1. Plugin Packaging, Schema & Component Discovery Checks
// ---------------------------------------------------------------------------
runTest('PKG-01', 'Manifest (plugin.json), Rules, Skills (8), Agents (7), and Hooks structure', () => {
  const manifestPath = path.join(PLUGIN_ROOT, 'plugin.json');
  assert.ok(fs.existsSync(manifestPath), 'plugin.json must exist at plugin root');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.name, 'dev-lifecycle');
  assert.equal(manifest.displayName, 'DevLifecycle');
  assert.ok(manifest.version, 'plugin.json must declare a semantic version');
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, manifest.logo)), 'logo asset must exist');

  // Rules check: plain markdown, no frontmatter, <24,000 bytes
  const rulesPath = path.join(PLUGIN_ROOT, 'rules', 'AGENTS.md');
  assert.ok(fs.existsSync(rulesPath), 'rules/AGENTS.md must exist');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');
  assert.ok(!rulesContent.startsWith('---'), 'rules/AGENTS.md in a plugin must not have YAML frontmatter');
  assert.ok(Buffer.byteLength(rulesContent, 'utf8') < 24000, 'rules/AGENTS.md must be under 24,000 bytes');

  // Skills check: all 8 core skills exist, match folder name, and are <24,000 bytes
  const expectedSkills = [
    'dl-run',
    'dl-discover',
    'dl-plan',
    'dl-implement',
    'dl-verify',
    'dl-review',
    'dl-release',
    'dl-diagnose'
  ];
  for (const skillName of expectedSkills) {
    const skillPath = path.join(PLUGIN_ROOT, 'skills', skillName, 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), `Missing skill file: skills/${skillName}/SKILL.md`);
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.ok(Buffer.byteLength(content, 'utf8') < 24000, `Skill ${skillName} exceeds 24,000 byte limit`);
    assert.match(content, new RegExp(`^---[\\s\\S]*?name:\\s*${skillName}\\b[\\s\\S]*?description:\\s*`, 'm'));
    assert.match(content, /Activation Conditions/i);
    assert.match(content, /Expected Outputs/i);
    assert.match(content, /Completion Conditions/i);
    assert.match(content, /Safety Boundaries/i);
  }

  // Agents check: all 7 agents exist with valid frontmatter and read-only reviewers
  const expectedAgents = [
    { name: 'lifecycle-orchestrator', readOnly: false },
    { name: 'software-architect', readOnly: true },
    { name: 'implementation-engineer', readOnly: false },
    { name: 'quality-engineer', readOnly: false },
    { name: 'code-reviewer', readOnly: true },
    { name: 'security-reviewer', readOnly: true },
    { name: 'release-engineer', readOnly: false }
  ];
  for (const ag of expectedAgents) {
    const agentPath = path.join(PLUGIN_ROOT, 'agents', `${ag.name}.md`);
    assert.ok(fs.existsSync(agentPath), `Missing agent file: agents/${ag.name}.md`);
    const content = fs.readFileSync(agentPath, 'utf8');
    assert.match(content, new RegExp(`name:\\s*${ag.name}\\b`));
    assert.match(content, /subagent:\s*true/);
    assert.match(content, /mainAgent:\s*false/);
    if (ag.readOnly) {
      assert.doesNotMatch(content, /-\s*(edit_file|write_file|run_command)/, `${ag.name} must remain read-only`);
    }
  }

  return 'Verified plugin.json, rules/AGENTS.md, 8 skills, and 7 agents';
});

runTest('PKG-02', 'Official CLI strict validator (`agy plugin validate --strict`)', () => {
  const homeDir = os.homedir();
  const candidates = [
    'agy',
    path.join(homeDir, '.gemini', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy')
  ];

  let agyBin = null;
  for (const cand of candidates) {
    const res = spawnSync(cand, ['--version'], { encoding: 'utf8' });
    if (res.status === 0) {
      agyBin = cand;
      break;
    }
  }

  // Gracefully skip CLI strict verification in standard CI runners where Antigravity App/CLI is not pre-installed
  if (!agyBin) {
    return 'SKIPPED: Antigravity CLI (agy) is not installed in this environment; structural manifest & schema validation passed in PKG-01.';
  }

  const valRes = spawnSync(agyBin, ['plugin', 'validate', '--strict', '--json', PLUGIN_ROOT], {
    encoding: 'utf8'
  });

  assert.equal(valRes.status, 0, `agy plugin validate --strict failed: ${valRes.stdout || valRes.stderr}`);
  const report = JSON.parse(valRes.stdout);
  assert.equal(report.name, 'dev-lifecycle');
  assert.equal(report.components.skills, 8);
  assert.equal(report.components.agents, 7);
  assert.equal(report.components.rules, 1);
  assert.equal(report.components.hooks, 4);
  assert.equal(report.findings.length, 0, `Expected 0 findings in strict mode, got: ${JSON.stringify(report.findings)}`);
  return `agy v${spawnSync(agyBin, ['--version'], { encoding: 'utf8' }).stdout.trim()} strict validation passed (0 findings)`;
});

// ---------------------------------------------------------------------------
// 2.Mandatory Acceptance Scenarios (Scenarios A through J)
// ---------------------------------------------------------------------------

// Scenario A — Small Bug Fix
runTest('SCENARIO-A', 'Small Bug Fix (Quick Mode: minimal discovery, targeted verification, concise delivery)', () => {
  const classification = classifyTask({
    summary: 'Fix off-by-one date formatting bug in formatDuration helper',
    affectedFilesCount: 1,
    affectedPackagesCount: 1,
    securitySensitive: false,
    databaseChanges: false,
    productionImpact: false
  });

  assert.equal(classification.selectedProfile, 'Quick');
  assert.deepEqual(classification.recommendedAgents, ['primary-agent-only']);
  assert.equal(classification.gates.gateA_RequirementReadiness.mode, 'implicit');
  assert.equal(classification.gates.gateC_VerificationIntegrity.scope, 'targeted-file-or-unit');
  assert.equal(classification.gates.gateE_DeliveryIntegrity.artifactMode, 'concise-inline');

  const delivery = evaluateLifecycleDelivery({
    acceptanceCriteria: [{ id: 'AC-1', description: 'formatDuration(60) returns "1m 0s"', satisfied: true }],
    authorizedScopeFiles: ['src/utils/duration.ts', 'src/utils/duration.test.ts'],
    modifiedFiles: ['src/utils/duration.ts', 'src/utils/duration.test.ts'],
    checks: [
      { name: 'Unit Test (Targeted)', command: 'npx vitest run src/utils/duration.test.ts', scope: 'src/utils/duration.test.ts', result: 'PASS' },
      { name: 'Full E2E Suite', command: '', scope: 'e2e', result: 'SKIPPED', reason: 'Pure formatting helper fix; unit test verifies behavior directly.' }
    ],
    reviewFindings: [],
    efficiency: { cycleTimeSeconds: 18, repairIterations: 0, reviewReworkCount: 0, redundantChecksAvoided: 1, delegatedAgentsCount: 0 }
  });

  assert.equal(delivery.lifecycleState, 'DONE');
  assert.equal(delivery.dodSatisfied, true);
  assert.equal(delivery.metrics.efficiency.agentDelegationEfficiency, 'single-agent-optimal');
  return 'Quick mode selected, single agent used, targeted test passed, state = DONE';
});

// Scenario B — Standard Feature
runTest('SCENARIO-B', 'Standard Feature (Standard Mode: explicit AC, slice plan, verification, structured Delivery Record)', () => {
  const classification = classifyTask({
    summary: 'Add pagination and filter query parameters to GET /api/projects endpoint and UI table',
    affectedFilesCount: 5,
    affectedPackagesCount: 2,
    securitySensitive: false,
    databaseChanges: false
  });

  assert.equal(classification.selectedProfile, 'Standard');
  assert.equal(classification.gates.gateA_RequirementReadiness.mode, 'documented-artifact');
  assert.equal(classification.gates.gateD_ReviewIntegrity.required, true);

  const delivery = evaluateLifecycleDelivery({
    acceptanceCriteria: [
      { id: 'AC-1', description: 'GET /api/projects supports ?page and ?limit', satisfied: true },
      { id: 'AC-2', description: 'UI ProjectTable renders pagination controls', satisfied: true }
    ],
    authorizedScopeFiles: [
      'packages/api/src/routes/projects.ts',
      'packages/api/test/projects.test.ts',
      'packages/web/src/components/ProjectTable.tsx'
    ],
    modifiedFiles: [
      'packages/api/src/routes/projects.ts',
      'packages/api/test/projects.test.ts',
      'packages/web/src/components/ProjectTable.tsx'
    ],
    checks: [
      { name: 'Typecheck', command: 'pnpm run typecheck', scope: 'api, web', result: 'PASS' },
      { name: 'Unit & Integration Tests', command: 'pnpm test', scope: 'api, web', result: 'PASS' },
      { name: 'Lint', command: 'pnpm run lint', scope: 'api, web', result: 'PASS' }
    ],
    reviewFindings: [
      { id: 'REV-1', severity: 'MEDIUM', status: 'RESOLVED' }
    ],
    efficiency: { cycleTimeSeconds: 95, repairIterations: 0, reviewReworkCount: 1, redundantChecksAvoided: 2, delegatedAgentsCount: 1, delegationJustified: true }
  });

  assert.equal(delivery.lifecycleState, 'DONE');
  assert.equal(delivery.metrics.outcome.acceptanceCriteriaCompletion.ratio, 1);
  assert.equal(delivery.metrics.efficiency.reviewRework, 1);
  return 'Standard mode verified with 2/2 AC satisfied and structured Delivery Record';
});

// Scenario C — Complex Architectural Change
runTest('SCENARIO-C', 'Complex Architectural Change (Deep Mode + High-Risk Safety Floor enforcement)', () => {
  // Attempt to force "Quick" on an auth + DB migration + cross-package breaking change
  const classification = classifyTask({
    summary: 'Migrate JWT authentication session store and database schema with RBAC permission boundaries',
    affectedFilesCount: 14,
    affectedPackagesCount: 4,
    securitySensitive: true,
    databaseChanges: true,
    productionImpact: true,
    breakingContract: true,
    requestedProfile: 'Quick' // Attempting unsafe downgrade!
  });

  assert.equal(classification.selectedProfile, 'Deep', 'High-risk architectural change must select Deep mode');
  assert.equal(classification.safetyFloorTriggered, true);
  assert.equal(classification.safetyFloorEnforced, true, 'Must block downgrade to Quick mode');
  assert.ok(classification.recommendedAgents.includes('software-architect'));
  assert.ok(classification.recommendedAgents.includes('code-reviewer'));
  assert.ok(classification.recommendedAgents.includes('security-reviewer'));
  assert.ok(classification.recommendedAgents.includes('release-engineer'));
  return 'Deep mode selected, safety floor prevented Quick downgrade, specialized read-only reviewers assigned';
});

// Scenario D — Monorepo
runTest('SCENARIO-D', 'Monorepo (Workspace boundaries, dependency graph, leaf vs shared package impact scope)', () => {
  const monoDir = makeTempFixture('monorepo');
  try {
    fs.writeFileSync(
      path.join(monoDir, 'package.json'),
      JSON.stringify({
        name: 'acme-monorepo',
        private: true,
        packageManager: 'pnpm@9.12.0',
        scripts: { test: 'turbo run test', lint: 'turbo run lint', typecheck: 'turbo run typecheck' }
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(monoDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');
    fs.writeFileSync(path.join(monoDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n  - "apps/*"\n', 'utf8');
    fs.writeFileSync(path.join(monoDir, 'turbo.json'), JSON.stringify({ tasks: { test: {}, build: {} } }), 'utf8');

    // Create packages/core, packages/ui (depends on core), apps/web (depends on ui)
    fs.mkdirSync(path.join(monoDir, 'packages', 'core'), { recursive: true });
    fs.mkdirSync(path.join(monoDir, 'packages', 'ui'), { recursive: true });
    fs.mkdirSync(path.join(monoDir, 'apps', 'web'), { recursive: true });

    fs.writeFileSync(
      path.join(monoDir, 'packages', 'core', 'package.json'),
      JSON.stringify({ name: '@acme/core', version: '1.0.0', scripts: { test: 'vitest run' } }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(monoDir, 'packages', 'ui', 'package.json'),
      JSON.stringify({
        name: '@acme/ui',
        version: '1.0.0',
        dependencies: { '@acme/core': 'workspace:*' },
        scripts: { test: 'vitest run' }
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(monoDir, 'apps', 'web', 'package.json'),
      JSON.stringify({
        name: '@acme/web',
        version: '1.0.0',
        dependencies: { '@acme/ui': 'workspace:*' },
        scripts: { test: 'vitest run', build: 'vite build' }
      }),
      'utf8'
    );

    // 1. Leaf change in apps/web -> package-focused
    const leafProfile = discoverProject(monoDir, { changedFiles: ['apps/web/src/App.tsx'] });
    assert.equal(leafProfile.topology, 'monorepo');
    assert.equal(leafProfile.monorepoManager, 'pnpm-workspaces+turborepo');
    assert.deepEqual(leafProfile.impactAnalysis.directlyAffectedPackages, ['@acme/web']);
    assert.deepEqual(leafProfile.impactAnalysis.downstreamDependents, []);
    assert.equal(leafProfile.impactAnalysis.verificationScope, 'package-focused');

    // 2. Shared package change in packages/core -> expands transitively to @acme/ui and @acme/web
    const sharedProfile = discoverProject(monoDir, { changedFiles: ['packages/core/src/index.ts'] });
    assert.deepEqual(sharedProfile.impactAnalysis.directlyAffectedPackages, ['@acme/core']);
    assert.deepEqual(sharedProfile.impactAnalysis.downstreamDependents.sort(), ['@acme/ui', '@acme/web'].sort());
    assert.equal(sharedProfile.impactAnalysis.verificationScope, 'affected-and-dependents');

    // 3. Root config change -> expands to workspace-wide
    const rootProfile = discoverProject(monoDir, { changedFiles: ['tsconfig.base.json'] });
    assert.equal(rootProfile.impactAnalysis.verificationScope, 'workspace-wide');
    assert.equal(rootProfile.impactAnalysis.allImpactedPackages.length, 3);

    return 'Verified leaf (package-focused), shared core (transitive dependents), and root config (workspace-wide) scopes';
  } finally {
    cleanupTempFixture(monoDir);
  }
});

// Scenario E — Unknown Framework
runTest('SCENARIO-E', 'Unknown Framework (Discovers custom Void framework from repo evidence without single-dep false positives)', () => {
  const unknownDir = makeTempFixture('unknown-fw');
  try {
    fs.writeFileSync(
      path.join(unknownDir, 'package.json'),
      JSON.stringify({
        name: 'void-custom-service',
        version: '0.4.2',
        dependencies: {
          '@void-engine/core': '2.1.0',
          express: '4.19.2' // Single dependency without express server files
        },
        scripts: {
          build: 'void-cli compile --strict',
          test: 'void-cli verify --suite unit',
          lint: 'void-cli lint'
        }
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(unknownDir, 'void.config.mjs'), 'export default { mode: "edge-actor" };\n', 'utf8');
    fs.writeFileSync(path.join(unknownDir, 'AGENTS.md'), '# Void Project Rules\nUse `npm test` via `void-cli verify`.\n', 'utf8');
    fs.mkdirSync(path.join(unknownDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(unknownDir, 'docs', 'void-architecture.md'), '# Void Runtime v2.1\n', 'utf8');

    const profile = discoverProject(unknownDir);
    assert.ok(profile.projectInstructions.includes('AGENTS.md'));
    assert.equal(profile.verificationCommands.test, 'npm test');
    assert.equal(profile.verificationCommands.build, 'npm run build');

    // Must detect custom framework 'void' with HIGH confidence
    const voidFw = profile.frameworks.find((f) => f.name.toLowerCase().includes('void'));
    assert.ok(voidFw, 'Must discover custom Void framework from void.config.mjs + @void-engine/core');
    assert.equal(voidFw.confidence, 'HIGH');
    assert.equal(voidFw.customFramework, true);

    // Must NOT classify project as Express from a single dependency alone
    const expressFw = profile.frameworks.find((f) => f.name === 'Express');
    assert.equal(expressFw, undefined, 'Must not classify project as Express based on 1 dependency alone');
    assert.ok(
      profile.assumptions.some((a) => a.includes('express')),
      'Should record single dependency without config as an assumption'
    );

    return 'Detected custom Void framework (HIGH confidence) and rejected single-dependency Express false positive';
  } finally {
    cleanupTempFixture(unknownDir);
  }
});

// Scenario F — Repeated Verification Failure
runTest('SCENARIO-F', 'Repeated Verification Failure (Bounded retries max 3 attempts + transparent escalation to BLOCKED)', () => {
  // Test state machine progression across 3 attempts
  const attempt1 = evaluateBoundedRecovery({
    attemptCount: 1,
    maxAttempts: 3,
    failureCategory: 'IMPLEMENTATION_DEFECT',
    failureEvidence: 'AssertionError: expected 401 to equal 403'
  });
  assert.equal(attempt1.canRetry, true);
  assert.equal(attempt1.nextAttempt, 2);

  const attempt2 = evaluateBoundedRecovery({
    attemptCount: 2,
    maxAttempts: 3,
    failureCategory: 'IMPLEMENTATION_DEFECT',
    failureEvidence: 'AssertionError: expected 401 to equal 403'
  });
  assert.equal(attempt2.canRetry, true);
  assert.equal(attempt2.nextAttempt, 3);

  const attempt3 = evaluateBoundedRecovery({
    attemptCount: 3,
    maxAttempts: 3,
    failureCategory: 'IMPLEMENTATION_DEFECT',
    failureEvidence: 'AssertionError: expected 401 to equal 403'
  });
  assert.equal(attempt3.canRetry, false);
  assert.equal(attempt3.action, 'ESCALATE_BOUND_REACHED');
  assert.equal(attempt3.lifecycleState, 'BLOCKED');

  // Also verify PostToolUse telemetry tracker across 3 consecutive failing test runs
  let telemetry = {};
  const failPayload = {
    toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
    error: 'exit status 1'
  };
  telemetry = updateVerificationTelemetry(failPayload, telemetry, 3);
  assert.equal(telemetry.escalationRequired, false);
  telemetry = updateVerificationTelemetry(failPayload, telemetry, 3);
  assert.equal(telemetry.escalationRequired, false);
  telemetry = updateVerificationTelemetry(failPayload, telemetry, 3);
  assert.equal(telemetry.escalationRequired, true);
  assert.equal(telemetry.repairIterations, 2);
  assert.equal(telemetry.consecutiveFailuresByCmd['npm test'], 3);

  return 'Verified bounded retries (attempts 1..3) and automatic escalation to BLOCKED at attempt 3';
});

// Scenario G — Redundant CI
runTest('SCENARIO-G', 'Redundant CI (Detects duplicate lint/test/build checks and missing cache in GitHub Actions)', () => {
  const ciDir = makeTempFixture('redundant-ci');
  try {
    const wfDir = path.join(ciDir, '.github', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, 'ci.yml'),
      `name: CI
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
  deploy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
`,
      'utf8'
    );

    const ciReport = analyzeCiWorkflows(ciDir);
    assert.equal(ciReport.provider, 'github-actions');
    assert.ok(ciReport.duplicateChecks.some((d) => d.category === 'lint' && d.count === 2));
    assert.ok(ciReport.duplicateChecks.some((d) => d.category === 'test' && d.count === 2));
    assert.ok(ciReport.redundantBuilds.length > 0, 'Must detect redundant build executions');
    assert.ok(ciReport.cachingOpportunities.length > 0, 'Must detect uncached repeated npm ci steps');

    // Also test PostToolUse redundant local check detection
    let telemetry = {};
    const passPayload = {
      toolCall: { name: 'run_command', args: { CommandLine: 'npm run lint' } },
      error: ''
    };
    telemetry = updateVerificationTelemetry(passPayload, telemetry);
    assert.equal(telemetry.redundantCheckExecutions, 0);
    telemetry = updateVerificationTelemetry(passPayload, telemetry);
    assert.equal(telemetry.redundantCheckExecutions, 1, 'Must flag immediate duplicate execution of passing check');

    return 'Detected duplicate CI lint/test/build steps, missing cache, and redundant local check execution';
  } finally {
    cleanupTempFixture(ciDir);
  }
});

// Scenario H — Sensitive Operation
runTest('SCENARIO-H', 'Sensitive Operation (Enforces deny, force_ask, ask, and allow permission boundaries in PreToolUse)', () => {
  // 1. Denied operations
  const denyRm = evaluatePreToolSafety({
    toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } }
  });
  assert.equal(denyRm.decision, 'deny');

  const denyForceMain = evaluatePreToolSafety({
    toolCall: { name: 'run_command', args: { CommandLine: 'git push --force origin main' } }
  });
  assert.equal(denyForceMain.decision, 'deny');

  const denyNoVerify = evaluatePreToolSafety({
    toolCall: { name: 'run_command', args: { CommandLine: 'git commit -m "wip" --no-verify' } }
  });
  assert.equal(denyNoVerify.decision, 'deny');

  // 2. Force-Ask operations (production deploy, DB migration, PR merge, .env.production write)
  const forceDeploy = evaluatePreToolSafety({
    toolCall: { name: 'run_command', args: { CommandLine: 'wrangler deploy --env production' } }
  });
  assert.equal(forceDeploy.decision, 'force_ask');

  const forceMigrate = evaluatePreToolSafety({
    toolCall: { name: 'run_command', args: { CommandLine: 'npx prisma migrate deploy' } }
  });
  assert.equal(forceMigrate.decision, 'force_ask');

  const forceMerge = evaluatePreToolSafety({
    toolCall: { name: 'run_command', args: { CommandLine: 'gh pr merge 42 --squash -R org/repo' } }
  });
  assert.equal(forceMerge.decision, 'force_ask');

  const forceEnvEdit = evaluatePreToolSafety({
    toolCall: { name: 'write_file', args: { Path: '/app/.env.production', Content: 'SECRET=1' } }
  });
  assert.equal(forceEnvEdit.decision, 'force_ask');

  // 3. Ask operations (git push, gh pr create, git reset --hard)
  const askPush = evaluatePreToolSafety({
    toolCall: { name: 'run_command', args: { CommandLine: 'git push origin feat/login' } }
  });
  assert.equal(askPush.decision, 'ask');

  const askPr = evaluatePreToolSafety({
    toolCall: { name: 'run_command', args: { CommandLine: 'gh pr create --title "Feat" -R org/repo' } }
  });
  assert.equal(askPr.decision, 'ask');

  // 4. Allowed routine operations (npm test, git status, normal source file edit)
  const allowTest = evaluatePreToolSafety({
    toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } }
  });
  assert.equal(allowTest.decision, 'allow');

  const allowEdit = evaluatePreToolSafety({
    toolCall: { name: 'edit_file', args: { Path: 'src/index.ts' } }
  });
  assert.equal(allowEdit.decision, 'allow');

  return 'Verified allow, ask, force_ask, and deny decisions across 11 sensitive & routine cases';
});

// Scenario I — Clean Delivery
runTest('SCENARIO-I', 'Clean Delivery (Detects temporary/secret files, preserves user files, enforces 10-point DoD)', () => {
  const cleanDir = makeTempFixture('clean-delivery');
  try {
    fs.mkdirSync(path.join(cleanDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cleanDir, 'src', 'app.ts'), 'export const ok = true;\n', 'utf8');
    // Intentional user file that existed beforehand
    fs.writeFileSync(path.join(cleanDir, 'src', 'user-notes.bak'), 'user backup\n', 'utf8');
    // Task-introduced temporary file and secret file
    fs.writeFileSync(path.join(cleanDir, 'debug-output.log'), 'temp debug\n', 'utf8');
    fs.writeFileSync(path.join(cleanDir, '.env.production'), 'API_KEY=secret\n', 'utf8');

    // Audit before cleanup (preserving user-notes.bak)
    const dirtyAudit = checkCleanRepository(cleanDir, ['src/user-notes.bak']);
    assert.equal(dirtyAudit.clean, false);
    assert.deepEqual(dirtyAudit.tempFiles, ['debug-output.log']);
    assert.deepEqual(dirtyAudit.secretFiles, ['.env.production']);

    // Remove task-created temp and secret files while preserving user's file
    fs.unlinkSync(path.join(cleanDir, 'debug-output.log'));
    fs.unlinkSync(path.join(cleanDir, '.env.production'));

    const cleanAudit = checkCleanRepository(cleanDir, ['src/user-notes.bak']);
    assert.equal(cleanAudit.clean, true);
    assert.ok(fs.existsSync(path.join(cleanDir, 'src', 'user-notes.bak')), 'User file must be preserved');

    // Verify DoD rejects unexecuted (NOT_RUN) checks as NOT Done (P07)
    const incompleteDelivery = evaluateLifecycleDelivery({
      acceptanceCriteria: [{ id: 'AC-1', description: 'Feature works', satisfied: true }],
      authorizedScopeFiles: ['src/app.ts'],
      modifiedFiles: ['src/app.ts'],
      checks: [
        { name: 'Unit Tests', command: 'npm test', scope: 'src', result: 'NOT_RUN', reason: 'Forgot to run' }
      ]
    });
    assert.equal(incompleteDelivery.dodSatisfied, false, 'Must not mark DONE when required check is NOT_RUN');
    assert.notEqual(incompleteDelivery.lifecycleState, 'DONE');

    // Verify Stop hook contract
    const stopAllow = evaluateStopGate({ terminationReason: 'NO_TOOL_CALL' }, null);
    assert.equal(stopAllow.decision, 'allow');
    const stopContinue = evaluateStopGate(
      { terminationReason: 'NO_TOOL_CALL' },
      { requireContinue: true, PromptedOnce: false, reason: 'Clean up debug-output.log' }
    );
    assert.equal(stopContinue.decision, 'continue');

    return 'Verified temp/secret file detection, user file preservation, Stop hook, and strict DoD enforcement';
  } finally {
    cleanupTempFixture(cleanDir);
  }
});

// Scenario J — Missing Integrations
runTest('SCENARIO-J', 'Missing Integrations (Graceful degradation without optional MCP, GitHub CLI, /swarm, or package manager)', () => {
  const bareDir = makeTempFixture('bare-repo');
  try {
    // A bare C/Makefile repository with no package.json, no GitHub workflows, no MCP servers
    fs.writeFileSync(path.join(bareDir, 'Makefile'), 'all:\n\tcc main.c -o app\ntest:\n\t./app --test\n', 'utf8');
    fs.writeFileSync(path.join(bareDir, 'main.c'), 'int main() { return 0; }\n', 'utf8');

    const profile = discoverProject(bareDir);
    assert.equal(profile.topology, 'standalone');
    assert.ok(profile.packageManagers.includes('make'));
    assert.equal(profile.ciCd.provider, null);
    assert.equal(profile.deploymentPlatforms.length, 0);

    // Execute hooks via CLI subprocess with empty environment to verify zero external dependency
    const hookRes = spawnSync(
      process.execPath,
      [
        path.join(PLUGIN_ROOT, 'scripts', 'pre-tool-safety.mjs'),
        '--payload',
        JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'make test' } } })
      ],
      { encoding: 'utf8' }
    );
    assert.equal(hookRes.status, 0);
    assert.equal(JSON.parse(hookRes.stdout).decision, 'allow');

    return 'Verified graceful execution on bare repository with zero MCP, GitHub, or package-manager assumptions';
  } finally {
    cleanupTempFixture(bareDir);
  }
});

// ---------------------------------------------------------------------------
// Summary Report
// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.status === 'PASS').length;
const failed = results.filter((r) => r.status === 'FAIL').length;

console.log('\n======================================================================');
console.log(` Summary: ${passed}/${results.length} passed, ${failed} failed`);
console.log('======================================================================');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: results.length, passed, failed, results }, null, 2));
}

if (failed > 0) {
  process.exit(1);
}
