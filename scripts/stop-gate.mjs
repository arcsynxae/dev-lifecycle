#!/usr/bin/env node
/**
 * DevLifecycle v2 — Stop Lifecycle Hook
 *
 * Evaluates clean termination conditions when the agent execution loop stops.
 * Per the Antigravity Stop hook contract:
 * - Returning { "decision": "continue", "reason": "..." } prevents premature stop
 *   when an explicit active verification/cleanup gate lock is present.
 * - Any other decision value (e.g. "allow") allows the agent to stop cleanly.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Evaluate Stop hook payload.
 * @param {object} payload
 * @param {object|null} lockState
 * @returns {{ decision: 'allow' | 'continue', reason?: string }}
 */
export function evaluateStopGate(payload, lockState = null) {
  if (!payload || typeof payload !== 'object') {
    return { decision: 'allow' };
  }

  const reason = String(payload.terminationReason || '');

  // Never block user cancellations, errors, or budget/invocation limits
  if (
    reason === 'USER_CANCELED' ||
    reason === 'ERROR' ||
    reason === 'MAX_INVOCATIONS' ||
    reason === 'MAX_FORCED_INVOCATIONS' ||
    reason === 'MAX_TOKEN_BUDGET_EXCEEDED'
  ) {
    return { decision: 'allow' };
  }

  // If an explicit gate lock indicates required verification or cleanup is still pending
  if (lockState && lockState.requireContinue === true && !lockState.PromptedOnce) {
    return {
      decision: 'continue',
      reason:
        lockState.reason ||
        'DevLifecycle Gate E (Delivery Integrity): Pending verification or temporary artifact cleanup must be completed before marking the task DONE.'
    };
  }

  return { decision: 'allow' };
}

async function main() {
  try {
    let rawInput = '';
    const argIdx = process.argv.indexOf('--payload');
    if (argIdx !== -1 && process.argv[argIdx + 1]) {
      rawInput = process.argv[argIdx + 1];
    } else if (!process.stdin.isTTY) {
      rawInput = fs.readFileSync(0, 'utf8');
    }

    const payload = rawInput.trim() ? JSON.parse(rawInput) : {};
    let lockState = null;

    if (payload.artifactDirectoryPath) {
      const lockFile = path.join(payload.artifactDirectoryPath, 'scratch', 'dl-stop-lock.json');
      if (fs.existsSync(lockFile)) {
        try {
          lockState = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
          if (lockState && lockState.requireContinue && !lockState.PromptedOnce) {
            lockState.PromptedOnce = true;
            fs.writeFileSync(lockFile, JSON.stringify(lockState, null, 2), 'utf8');
          }
        } catch {
          lockState = null;
        }
      }
    }

    const result = evaluateStopGate(payload, lockState);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('stop-gate.mjs')) {
  main();
}
