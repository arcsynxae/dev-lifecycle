#!/usr/bin/env node
/**
 * DevLifecycle v2 — Adaptive Risk Classifier, Profile Selector & Bounded Recovery Engine
 *
 * Implements:
 * - Section 4 (Stages 3, 4, 7 — Classify, Plan, Diagnose and Recover)
 * - Section 7 (Progressive Quality Gates A-F)
 * - Section 8 (Adaptive Execution Profiles: Quick, Standard, Deep + High-Risk Safety Floor)
 * - Section 11 (Agent Orchestration Policy)
 */

/**
 * Classify a task across the 8 risk dimensions and select Quick, Standard, or Deep profile.
 * High-risk tasks NEVER silently downgrade to Quick mode, even if requestedProfile === 'Quick'.
 *
 * @param {object} input
 * @returns {object}
 */
export function classifyTask(input = {}) {
  const {
    summary = '',
    affectedFilesCount = 1,
    affectedPackagesCount = 1,
    securitySensitive = false,
    databaseChanges = false,
    productionImpact = false,
    dependencyChanges = 'none', // 'none' | 'minor' | 'major-or-new'
    breakingContract = false,
    destructivePotential = false,
    unknownConstraints = false,
    releaseInScope = false,
    requestedProfile = null // 'Quick' | 'Standard' | 'Deep' | null
  } = input;

  const text = String(summary).toLowerCase();

  // Infer risk signals from summary text as well as explicit flags
  const isSecurity =
    securitySensitive ||
    /\b(auth|authentication|authorization|rbac|jwt|oauth|crypto|password|secret|token|permission|xss|csrf|sql\s+injection)\b/i.test(text);
  const isDb =
    databaseChanges ||
    /\b(migration|schema|database|prisma|drizzle|alembic|table|column|index|backfill)\b/i.test(text);
  const isProd =
    productionImpact ||
    /\b(production|deploy|release\s+pipeline|terraform|kubernetes|k8s|wrangler|dockerfile)\b/i.test(text);
  const isBreaking =
    breakingContract ||
    /\b(breaking\s+change|deprecate|remove\s+endpoint|contract\s+change|major\s+version|architecture\s+redesign)\b/i.test(text);
  const isDestructive =
    destructivePotential ||
    /\b(delete|drop|purge|reset|force-push|truncate)\b/i.test(text);

  const scores = {
    securitySensitivity: isSecurity ? 3 : 0,
    databaseChanges: isDb ? 3 : 0,
    productionImpact: isProd ? 3 : 0,
    affectedComponents:
      affectedPackagesCount > 2 || affectedFilesCount > 8
        ? 3
        : affectedPackagesCount > 1 || affectedFilesCount > 2
        ? 1
        : 0,
    dependencyComplexity:
      dependencyChanges === 'major-or-new' ? 3 : dependencyChanges === 'minor' ? 1 : 0,
    backwardCompatibility: isBreaking ? 3 : 0,
    destructivePotential: isDestructive ? 3 : 0,
    unknownConstraints: unknownConstraints ? 2 : 0
  };

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const highRiskFactors = Object.entries(scores)
    .filter(([, val]) => val >= 3)
    .map(([key]) => key);

  const safetyFloorTriggered = highRiskFactors.length > 0;

  // Determine base profile
  let computedProfile = 'Quick';
  if (totalScore >= 6 || highRiskFactors.length >= 2) {
    computedProfile = 'Deep';
  } else if (totalScore >= 2 || safetyFloorTriggered) {
    computedProfile = 'Standard';
  }

  // Apply user override subject to Safety Floor
  let selectedProfile = computedProfile;
  let overrideApplied = false;
  let safetyFloorEnforced = false;

  if (requestedProfile) {
    const normReq =
      requestedProfile.charAt(0).toUpperCase() + requestedProfile.slice(1).toLowerCase();
    if (normReq === 'Quick' && safetyFloorTriggered) {
      // High-risk operations MUST NOT downgrade to Quick mode
      selectedProfile = computedProfile === 'Quick' ? 'Standard' : computedProfile;
      safetyFloorEnforced = true;
    } else if (['Quick', 'Standard', 'Deep'].includes(normReq)) {
      selectedProfile = normReq;
      overrideApplied = true;
    }
  }

  // Determine proportional agent delegation (P09 & Section 11)
  const recommendedAgents = [];
  if (selectedProfile === 'Quick') {
    recommendedAgents.push('primary-agent-only');
  } else if (selectedProfile === 'Standard') {
    recommendedAgents.push('primary-agent');
    if (affectedFilesCount > 4 || isSecurity) {
      recommendedAgents.push(isSecurity ? 'security-reviewer' : 'code-reviewer');
    }
  } else {
    recommendedAgents.push('software-architect', 'implementation-engineer', 'quality-engineer', 'code-reviewer');
    if (isSecurity) recommendedAgents.push('security-reviewer');
    if (releaseInScope || isProd) recommendedAgents.push('release-engineer');
  }

  // Progressive Quality Gates configuration
  const gates = {
    gateA_RequirementReadiness: {
      required: true,
      mode: selectedProfile === 'Quick' ? 'implicit' : 'documented-artifact'
    },
    gateB_ImplementationIntegrity: {
      required: true,
      mode: 'scoped-minimal-diff'
    },
    gateC_VerificationIntegrity: {
      required: true,
      scope:
        selectedProfile === 'Quick'
          ? 'targeted-file-or-unit'
          : selectedProfile === 'Standard'
          ? 'affected-package-suite'
          : 'full-affected-graph-and-regression'
    },
    gateD_ReviewIntegrity: {
      required: selectedProfile !== 'Quick' || safetyFloorTriggered,
      reviewer:
        selectedProfile === 'Deep'
          ? isSecurity
            ? 'code-reviewer + security-reviewer'
            : 'code-reviewer'
          : selectedProfile === 'Standard'
          ? 'structured-self-or-code-reviewer'
          : 'lightweight-self-check'
    },
    gateE_DeliveryIntegrity: {
      required: true,
      artifactMode: selectedProfile === 'Quick' ? 'concise-inline' : 'structured-delivery-record'
    },
    gateF_ReleaseIntegrity: {
      required: Boolean(releaseInScope),
      status: releaseInScope ? 'REQUIRED' : 'SKIPPED (Release not in scope)'
    }
  };

  return {
    selectedProfile,
    computedProfile,
    totalScore,
    scores,
    highRiskFactors,
    safetyFloorTriggered,
    safetyFloorEnforced,
    overrideApplied,
    recommendedAgents,
    gates
  };
}

/**
 * Evaluate bounded recovery state during Stage 7 (Diagnose and Recover).
 * @param {object} params
 * @param {number} params.attemptCount - Number of failed repair attempts so far for the same failure
 * @param {number} [params.maxAttempts=3] - Bounded retry limit (default 3)
 * @param {string} [params.failureCategory='IMPLEMENTATION_DEFECT']
 * @returns {object}
 */
export function evaluateBoundedRecovery({
  attemptCount = 0,
  maxAttempts = 3,
  failureCategory = 'IMPLEMENTATION_DEFECT',
  failureEvidence = ''
} = {}) {
  const nonRetryableCategories = new Set([
    'PERMISSION_RESTRICTION',
    'EXTERNAL_SERVICE_UNAVAILABLE',
    'UNSUPPORTED_CAPABILITY'
  ]);

  if (nonRetryableCategories.has(failureCategory)) {
    return {
      action: 'ESCALATE_IMMEDIATELY',
      lifecycleState: 'BLOCKED',
      canRetry: false,
      attemptCount,
      maxAttempts,
      reason: `Failure category "${failureCategory}" cannot be resolved by speculative code edits; escalating immediately with evidence.`,
      evidence: failureEvidence
    };
  }

  if (failureCategory === 'BASELINE_FAILURE') {
    return {
      action: 'RECORD_BASELINE_AND_CONTINUE_OR_ASK',
      lifecycleState: 'IN_PROGRESS',
      canRetry: false,
      attemptCount,
      maxAttempts,
      reason: 'Failure is verified as pre-existing in baseline code outside current task scope.',
      evidence: failureEvidence
    };
  }

  if (attemptCount >= maxAttempts) {
    return {
      action: 'ESCALATE_BOUND_REACHED',
      lifecycleState: 'BLOCKED',
      canRetry: false,
      attemptCount,
      maxAttempts,
      reason: `Reached bounded recovery limit (${attemptCount}/${maxAttempts} focused attempts). Stopping speculative edits and escalating transparently.`,
      evidence: failureEvidence
    };
  }

  return {
    action: 'APPLY_FOCUSED_REPAIR',
    lifecycleState: 'IN_PROGRESS',
    canRetry: true,
    nextAttempt: attemptCount + 1,
    maxAttempts,
    reason: `Attempt ${attemptCount + 1} of ${maxAttempts} permitted for root-cause fix.`
  };
}

async function main() {
  const argIdx = process.argv.indexOf('--input');
  const raw = argIdx !== -1 && process.argv[argIdx + 1] ? process.argv[argIdx + 1] : '{}';
  const input = JSON.parse(raw);
  const result = classifyTask(input);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('classify-task.mjs')) {
  main();
}
