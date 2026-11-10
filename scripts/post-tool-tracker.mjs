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
import {
  classifyCommandMutationSignal,
  recordDirtyContextHint,
  sanitizeForCache
} from './context-store.mjs';

const VERIFICATION_CMD_REGEX =
  /\b(npm\s+(test|run\s+(test|lint|typecheck|check|build|format))|pnpm\s+(test|run\s+)?(test|lint|typecheck|check|build)|yarn\s+(test|lint|typecheck|build)|bun\s+(test|run\s+(test|lint|typecheck|build))|npx\s+(tsc|vitest|jest|eslint|prettier|playwright|astro\s+check)|node\s+--test|pytest|mypy|ruff\s+check|cargo\s+(test|check|clippy)|go\s+(test|vet)|gradle(w)?\s+(test|check)|mvn(w)?\s+test)\b/i;

const CONTEXT_MUTATION_CMD_REGEX =
  /\b(npm\s+(install|i|ci|uninstall|remove|update)|pnpm\s+(install|i|add|remove|up)|yarn\s+(install|add|remove)|bun\s+(install|add|remove)|pip\s+install|uv\s+(add|remove|sync)|cargo\s+add|go\s+get|git\s+(checkout|switch|pull|merge|rebase|reset|clean|worktree)|mv\b|rm\b|Remove-Item\b|Move-Item\b)\b/i;

const FILE_MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content'
]);

/**
 * Extract target file path from a file-mutation tool call.
 * @param {object} args
 * @returns {string | null}
 */
export function extractMutatedFilePath(args = {}) {
  const candidate =
    args.Path ||
    args.path ||
    args.TargetFile ||
    args.targetFile ||
    args.file_path ||
    args.filePath ||
    null;
  return candidate ? String(candidate) : null;
}

/**
 * Normalize a command string to a stable signature for deduplication and retry counting.
 * @param {string} cmd
 * @returns {string}
 */
export function normalizeCommandSignature(cmd) {
  return sanitizeForCache(String(cmd || '').trim().replace(/\s+/g, ' '));
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
  if (FILE_MUTATION_TOOLS.has(toolName)) {
    const mutatedFile = extractMutatedFilePath(toolCall.args);
    state.lastCommandSignature = null;
    state.dirtyContextHints = Array.isArray(currentState.dirtyContextHints)
      ? [...currentState.dirtyContextHints]
      : [];
    if (mutatedFile) {
      state.dirtyContextHints.push({
        type: 'file_mutation',
        toolName,
        filePath: mutatedFile.replace(/\\/g, '/'),
        stepIdx: payload.stepIdx ?? null
      });
      if (state.dirtyContextHints.length > 50) {
        state.dirtyContextHints = state.dirtyContextHints.slice(-50);
      }
    }
    return state;
  }

  if (toolName !== 'run_command') {
    return state;
  }

  const rawCmd = String(toolCall.args?.CommandLine || toolCall.args?.command || '');
  const sig = normalizeCommandSignature(rawCmd);
  if (!sig || !VERIFICATION_CMD_REGEX.test(sig)) {
    // Non-verification command: reset lastCommandSignature if it might mutate state
    state.lastCommandSignature = null;
    if (sig && CONTEXT_MUTATION_CMD_REGEX.test(sig)) {
      const semanticSignal = classifyCommandMutationSignal(rawCmd) || 'COMMAND_MUTATION';
      state.dirtyContextHints = Array.isArray(currentState.dirtyContextHints)
        ? [...currentState.dirtyContextHints]
        : [];
      state.dirtyContextHints.push({
        type: 'command_mutation',
        toolName: 'run_command',
        signal: semanticSignal,
        stepIdx: payload.stepIdx ?? null
      });
      if (state.dirtyContextHints.length > 50) {
        state.dirtyContextHints = state.dirtyContextHints.slice(-50);
      }
    }
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
    const toolCall = payload?.toolCall || {};
    const toolName = String(toolCall.name || '').toLowerCase();
    const workspaceRoot =
      Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0
        ? payload.workspacePaths[0]
        : process.cwd();

    // P13: Record dirty context hint when files or project state are mutated
    if (FILE_MUTATION_TOOLS.has(toolName)) {
      const targetPath = extractMutatedFilePath(toolCall.args);
      if (targetPath) {
        let relPath = targetPath;
        try {
          if (path.isAbsolute(targetPath) && workspaceRoot) {
            relPath = path.relative(workspaceRoot, targetPath);
          }
        } catch {
          // keep targetPath
        }
        recordDirtyContextHint(
          workspaceRoot,
          { type: 'file_mutation', toolName, filePath: relPath.replace(/\\/g, '/') },
          { artifactDirectoryPath: payload.artifactDirectoryPath || null }
        );
      }
    } else if (toolName === 'run_command') {
      const rawCmd = String(toolCall.args?.CommandLine || toolCall.args?.command || '');
      if (rawCmd && CONTEXT_MUTATION_CMD_REGEX.test(rawCmd)) {
        const semanticSignal = classifyCommandMutationSignal(rawCmd) || 'COMMAND_MUTATION';
        recordDirtyContextHint(
          workspaceRoot,
          { type: 'command_mutation', toolName, signal: semanticSignal },
          { artifactDirectoryPath: payload.artifactDirectoryPath || null }
        );
      }
    }

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
