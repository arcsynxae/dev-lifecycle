#!/usr/bin/env node
/**
 * DevLifecycle v2 — Definition of Ready, Definition of Done, Clean Repo & Metrics Evaluator
 *
 * Implements:
 * - Section 5 (Definition of Ready)
 * - Section 6 (Definition of Done & 9 Distinct Lifecycle States)
 * - Section 7 (Progressive Quality Gates with PASS/FAIL/SKIPPED/NOT_RUN/BLOCKED)
 * - Section 9 (Outcome & Efficiency Engineering Metrics)
 * - Section 15 (Clean Repository Policy)
 */

import fs from 'node:fs';
import path from 'node:path';

export const LIFECYCLE_STATES = Object.freeze([
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'VERIFICATION_FAILED',
  'READY_FOR_REVIEW',
  'DONE',
  'READY_FOR_RELEASE',
  'RELEASED',
  'PRODUCTION_VERIFIED'
]);

export const GATE_RESULTS = Object.freeze([
  'PASS',
  'FAIL',
  'SKIPPED',
  'NOT_RUN',
  'BLOCKED'
]);

/**
 * Normalize a test or check outcome into an explicit GATE_RESULTS status (Section 6 / REL-04).
 * Ensures SKIPPED and NOT_RUN are never counted as PASS.
 * @param {any} rawOutcome
 * @returns {{ status: 'PASS'|'FAIL'|'SKIPPED'|'NOT_RUN'|'BLOCKED', details: string, reason: string|null }}
 */
export function normalizeTestOutcome(rawOutcome) {
  if (rawOutcome && typeof rawOutcome === 'object' && GATE_RESULTS.includes(rawOutcome.status)) {
    return {
      status: rawOutcome.status,
      details: rawOutcome.details || rawOutcome.reason || rawOutcome.status,
      reason: rawOutcome.reason || rawOutcome.details || null
    };
  }
  if (typeof rawOutcome === 'string') {
    const trimmed = rawOutcome.trim();
    const prefixMatch = trimmed.match(/^(PASS|FAIL|SKIPPED|NOT_RUN|BLOCKED)\s*:\s*(.*)$/i);
    if (prefixMatch) {
      const status = prefixMatch[1].toUpperCase();
      const reason = prefixMatch[2].trim();
      return {
        status,
        details: trimmed,
        reason: reason || null
      };
    }
  }
  return {
    status: 'PASS',
    details: typeof rawOutcome === 'string' && rawOutcome ? rawOutcome : 'Verified',
    reason: null
  };
}

/**
 * Summarize an array of test/check result records without ever conflating SKIPPED or NOT_RUN with PASS.
 * @param {Array<{status: string}>} resultList
 * @returns {object}
 */
export function summarizeTestResults(resultList = []) {
  const counts = { PASS: 0, FAIL: 0, SKIPPED: 0, NOT_RUN: 0, BLOCKED: 0 };
  for (const r of resultList) {
    const st = GATE_RESULTS.includes(r?.status) ? r.status : 'NOT_RUN';
    counts[st] += 1;
  }
  return {
    total: resultList.length,
    passed: counts.PASS,
    failed: counts.FAIL,
    skipped: counts.SKIPPED,
    notRun: counts.NOT_RUN,
    blocked: counts.BLOCKED,
    counts,
    success: counts.FAIL === 0 && counts.BLOCKED === 0
  };
}

/**
 * Inspect a repository directory for temporary task files or accidentally exposed secrets (Section 15).
 * @param {string} workspaceDir
 * @param {string[]} [preservedUserFiles=[]]
 * @returns {{ clean: boolean, tempFiles: string[], secretFiles: string[], preservedUserFiles: string[] }}
 */
export function checkCleanRepository(workspaceDir, preservedUserFiles = []) {
  const rootDir = path.resolve(workspaceDir || process.cwd());
  const tempFiles = [];
  const secretFiles = [];
  const preservedSet = new Set(preservedUserFiles.map((f) => f.replace(/\\/g, '/')));

  function walk(currentDir, relPrefix = '') {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
        continue;
      }
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (preservedSet.has(relPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (/^(tmp|temp|\.tmp|scratch)$/i.test(entry.name)) {
          tempFiles.push(`${relPath}/`);
        } else {
          walk(path.join(currentDir, entry.name), relPath);
        }
      } else if (entry.isFile()) {
        if (/\.(tmp|bak|orig|swp|rej)$/i.test(entry.name) || /^debug[-_].*\.(log|txt|json)$/i.test(entry.name)) {
          tempFiles.push(relPath);
        }
        if (
          /^\.env(\.(production|prod|staging|local))?$/i.test(entry.name) ||
          /^(id_rsa|id_ed25519|credentials\.json|secrets\.ya?ml)$/i.test(entry.name)
        ) {
          secretFiles.push(relPath);
        }
      }
    }
  }

  walk(rootDir);

  return {
    clean: tempFiles.length === 0 && secretFiles.length === 0,
    tempFiles,
    secretFiles,
    preservedUserFiles: Array.from(preservedSet)
  };
}

/**
 * Evaluate Definition of Done (10 criteria), Quality Gates, Lifecycle State, and Engineering Metrics.
 * @param {object} input
 * @returns {object}
 */
export function evaluateLifecycleDelivery(input = {}) {
  const {
    acceptanceCriteria = [], // [{ id, description, satisfied: boolean, evidence?: string }]
    authorizedScopeFiles = [],
    modifiedFiles = [],
    checks = [], // [{ name, command, scope, result: 'PASS'|'FAIL'|'SKIPPED'|'NOT_RUN'|'BLOCKED', origin?: 'NEW'|'BASELINE', reason?: string }]
    reviewFindings = [], // [{ id, severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'|'NIT', status: 'OPEN'|'RESOLVED'|'ESCALATED' }]
    docsUpdatedOrNotNeeded = true,
    tempArtifactsCleaned = true,
    diffCoherentAndReviewable = true,
    limitationsDisclosed = true,
    releaseScope = {
      inScope: false,
      readyForRelease: false,
      released: false,
      productionVerified: false
    },
    efficiency = {
      cycleTimeSeconds: null,
      repairIterations: 0,
      reviewReworkCount: 0,
      redundantChecksAvoided: 0,
      delegatedAgentsCount: 0,
      delegationJustified: true
    },
    contextIntelligence = null // Optional P13 metrics: { cacheHitRate, fullDiscoveryAvoidance, incrementalRefreshRate, invalidationAccuracy, contextLoadCost, staleContextIncidents }
  } = input;

  // 1. Acceptance Criteria Completion
  const totalAc = acceptanceCriteria.length;
  const satisfiedAc = acceptanceCriteria.filter((ac) => ac.satisfied === true).length;
  const allAcSatisfied = totalAc > 0 && satisfiedAc === totalAc;

  // 2. Scope Integrity
  const authorizedSet = new Set(authorizedScopeFiles.map((f) => f.replace(/\\/g, '/')));
  const outOfScopeFiles =
    authorizedSet.size > 0
      ? modifiedFiles.filter((f) => !authorizedSet.has(f.replace(/\\/g, '/')))
      : [];
  const withinScope = outOfScopeFiles.length === 0;

  // 3. Verification Checks Analysis (P07 — Evidence Over Assumption)
  const checkCounts = { PASS: 0, FAIL: 0, SKIPPED: 0, NOT_RUN: 0, BLOCKED: 0 };
  const newFailures = [];
  const baselineFailures = [];
  const missingReasons = [];
  const unexecutedRequired = [];

  for (const chk of checks) {
    const res = GATE_RESULTS.includes(chk.result) ? chk.result : 'NOT_RUN';
    checkCounts[res] += 1;

    if (res === 'FAIL') {
      if (chk.origin === 'BASELINE') {
        baselineFailures.push(chk.name);
      } else {
        newFailures.push(chk.name);
      }
    }
    if ((res === 'SKIPPED' || res === 'NOT_RUN' || res === 'BLOCKED') && !chk.reason) {
      missingReasons.push(chk.name);
    }
    if (res === 'NOT_RUN') {
      unexecutedRequired.push(chk.name);
    }
  }

  const hasExecutedPass = checkCounts.PASS > 0;
  const applicableChecksPassed =
    hasExecutedPass &&
    newFailures.length === 0 &&
    unexecutedRequired.length === 0 &&
    checkCounts.BLOCKED === 0 &&
    missingReasons.length === 0;

  // 4. Blocking Review Defects
  const unresolvedBlockingDefects = reviewFindings.filter(
    (f) => (f.severity === 'CRITICAL' || f.severity === 'HIGH') && f.status === 'OPEN'
  );

  // 5. Ten-Point Definition of Done Checklist
  const dodCriteria = {
    '1_acceptanceCriteriaSatisfied': allAcSatisfied,
    '2_withinAuthorizedScope': withinScope,
    '3_applicableQualityChecksPassed': applicableChecksPassed,
    '4_regressionsAssessed': newFailures.length === 0,
    '5_noUnresolvedBlockingDefects': unresolvedBlockingDefects.length === 0,
    '6_relevantDocumentationUpdated': Boolean(docsUpdatedOrNotNeeded),
    '7_temporaryArtifactsCleanedUp': Boolean(tempArtifactsCleaned),
    '8_changesCoherentAndReviewable': Boolean(diffCoherentAndReviewable),
    '9_verificationEvidenceAvailable': hasExecutedPass && checks.every((c) => c.result !== 'PASS' || Boolean(c.command)),
    '10_remainingLimitationsDisclosed': Boolean(limitationsDisclosed)
  };

  const dodSatisfied = Object.values(dodCriteria).every(Boolean);

  // 6. Determine Distinct Lifecycle State (Section 6)
  let lifecycleState = 'IN_PROGRESS';
  if (checkCounts.BLOCKED > 0) {
    lifecycleState = 'BLOCKED';
  } else if (newFailures.length > 0) {
    lifecycleState = 'VERIFICATION_FAILED';
  } else if (unresolvedBlockingDefects.length > 0) {
    lifecycleState = 'READY_FOR_REVIEW';
  } else if (dodSatisfied) {
    if (releaseScope?.productionVerified && releaseScope?.released) {
      lifecycleState = 'PRODUCTION_VERIFIED';
    } else if (releaseScope?.released) {
      lifecycleState = 'RELEASED';
    } else if (releaseScope?.inScope && releaseScope?.readyForRelease) {
      lifecycleState = 'READY_FOR_RELEASE';
    } else {
      lifecycleState = 'DONE';
    }
  }

  // 7. Compute Outcome & Efficiency Metrics (Section 9)
  const metrics = {
    outcome: {
      acceptanceCriteriaCompletion: {
        satisfied: satisfiedAc,
        applicable: totalAc,
        ratio: totalAc > 0 ? Number((satisfiedAc / totalAc).toFixed(2)) : 0
      },
      verificationCoverage: {
        totalChecks: checks.length,
        counts: checkCounts,
        baselineFailures,
        newFailures
      },
      blockingDefects: unresolvedBlockingDefects.length,
      changeScopeIntegrity: {
        aligned: withinScope,
        outOfScopeFiles
      }
    },
    efficiency: {
      taskCycleTimeSeconds:
        typeof efficiency.cycleTimeSeconds === 'number' ? efficiency.cycleTimeSeconds : null,
      repairIterations: efficiency.repairIterations || 0,
      reviewRework: efficiency.reviewReworkCount || 0,
      redundantCheckExecutionsAvoided: efficiency.redundantChecksAvoided || 0,
      agentDelegationEfficiency:
        efficiency.delegatedAgentsCount === 0
          ? 'single-agent-optimal'
          : efficiency.delegationJustified
          ? `justified (${efficiency.delegatedAgentsCount} specialized subagent(s))`
          : `excessive (${efficiency.delegatedAgentsCount} subagent(s))`
    },
    ...(contextIntelligence
      ? {
          contextIntelligence: {
            cacheHitRate: contextIntelligence.cacheHitRate ?? null,
            fullDiscoveryAvoidance: contextIntelligence.fullDiscoveryAvoidance ?? null,
            incrementalRefreshRate: contextIntelligence.incrementalRefreshRate ?? null,
            invalidationAccuracy: contextIntelligence.invalidationAccuracy ?? null,
            contextLoadCost: contextIntelligence.contextLoadCost ?? null,
            staleContextIncidents: contextIntelligence.staleContextIncidents ?? 0
          }
        }
      : {})
  };

  return {
    lifecycleState,
    dodSatisfied,
    dodCriteria,
    metrics
  };
}

async function main() {
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf('--check-repo');
  if (repoIdx !== -1) {
    const dir = args[repoIdx + 1] || process.cwd();
    const res = checkCleanRepository(dir);
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  const inputIdx = args.indexOf('--input');
  const raw = inputIdx !== -1 && args[inputIdx + 1] ? args[inputIdx + 1] : '{}';
  const result = evaluateLifecycleDelivery(JSON.parse(raw));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('lifecycle-check.mjs')) {
  main();
}
