#!/usr/bin/env node
/**
 * DevLifecycle v2 — PostToolUse Verification & Bounded Retry Tracker
 *
 * Implements lightweight telemetry for P07 (Evidence Over Assumption),
 * P09 (Eliminate Redundant Work), and Stage 7 (Bounded Recovery max 3 attempts).
 * Always outputs `{}` on stdout per the Antigravity PostToolUse contract.
 */

import fs from 'node:fs';
import path from 'node:path';

const VERIFICATION_CMD_REGEX =
  /\b(npm\s+(test|run\s+(test|lint|typecheck|check|build|format))|pnpm\s+(test|run\s+)?(test|lint|typecheck|check|build)|yarn\s+(test|lint|typecheck|build)|bun\s+(test|run\s+(test|lint|typecheck|build))|npx\s+(tsc|vitest|jest|eslint|prettier|playwright|astro\s+check)|node\s+--test|pytest|mypy|ruff\s+check|cargo\s+(test|check|clippy)|go\s+(test|vet)|gradle(w)?\s+(test|check)|mvn(w)?\s+test)\b/i;

/**
 * Normalize a command string to a stable signature for deduplication and retry counting.
 * @param {string} cmd
 * @returns {string}
 */
export function normalizeCommandSignature(cmd) {
  return String(cmd || '').trim().replace(/\s+/g, ' ');
}

/**
 * Update verification telemetry state given a PostToolUse payload.
 * @param {object} payload
 * @param {object} currentState
 * @param {number} maxRetries
 * @returns {object} updatedState
 */
export function updateVerificationTelemetry(payload, currentState = {}, maxRetries = 3) {
  const state = {
    totalVerificationRuns: currentState.totalVerificationRuns || 0,
    redundantCheckExecutions: currentState.redundantCheckExecutions || 0,
    repairIterations: currentState.repairIterations || 0,
    consecutiveFailuresByCmd: { ...(currentState.consecutiveFailuresByCmd || {}) },
    lastCommandSignature: currentState.lastCommandSignature || null,
    lastCommandSucceeded: Boolean(currentState.lastCommandSucceeded),
    escalationRequired: false,
    escalationCommand: null,
    history: Array.isArray(currentState.history) ? [...currentState.history] : []
  };

  const toolCall = payload?.toolCall || {};
  const toolName = String(toolCall.name || '').toLowerCase();
  if (toolName !== 'run_command') {
    return state;
  }

  const rawCmd = String(toolCall.args?.CommandLine || toolCall.args?.command || '');
  const sig = normalizeCommandSignature(rawCmd);
  if (!sig || !VERIFICATION_CMD_REGEX.test(sig)) {
    // Non-verification command: reset lastCommandSignature if it might mutate state
    state.lastCommandSignature = null;
    return state;
  }

  state.totalVerificationRuns += 1;
  const failed = Boolean(payload.error && String(payload.error).trim().length > 0);

  // Detect redundant check execution: identical verification command re-run immediately after passing
  if (!failed && state.lastCommandSignature === sig && state.lastCommandSucceeded) {
    state.redundantCheckExecutions += 1;
  }

  if (failed) {
    const prevFails = state.consecutiveFailuresByCmd[sig] || 0;
    const nextFails = prevFails + 1;
    state.consecutiveFailuresByCmd[sig] = nextFails;
    if (prevFails > 0) {
      state.repairIterations += 1;
    }
    if (nextFails >= maxRetries) {
      state.escalationRequired = true;
      state.escalationCommand = sig;
    }
  } else {
    if ((state.consecutiveFailuresByCmd[sig] || 0) > 0) {
      state.repairIterations += 1;
    }
    state.consecutiveFailuresByCmd[sig] = 0;
  }

  state.lastCommandSignature = sig;
  state.lastCommandSucceeded = !failed;
  state.history.push({
    stepIdx: payload.stepIdx ?? null,
    command: sig,
    result: failed ? 'FAIL' : 'PASS',
    error: failed ? String(payload.error) : null,
    consecutiveFailures: state.consecutiveFailuresByCmd[sig] || 0
  });

  // Keep history bounded to last 50 entries
  if (state.history.length > 50) {
    state.history = state.history.slice(-50);
  }

  return state;
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
    const storageBase =
      payload.artifactDirectoryPath
        ? path.join(payload.artifactDirectoryPath, 'scratch')
        : process.env.PLUGIN_DATA || null;

    if (storageBase) {
      try {
        fs.mkdirSync(storageBase, { recursive: true });
        const telemetryFile = path.join(storageBase, 'dl-telemetry.json');
        const existing = fs.existsSync(telemetryFile)
          ? JSON.parse(fs.readFileSync(telemetryFile, 'utf8'))
          : {};
        const updated = updateVerificationTelemetry(payload, existing);
        fs.writeFileSync(telemetryFile, JSON.stringify(updated, null, 2), 'utf8');
      } catch {
        // Ignore storage write errors in restricted environments
      }
    }
  } catch {
    // Ignore parse errors
  }

  // PostToolUse contract strictly expects `{}` on stdout
  process.stdout.write('{}\n');
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('post-tool-tracker.mjs')) {
  main();
}
