#!/usr/bin/env node
/**
 * DevLifecycle v2 — PreToolUse Safety & Permission Boundary Hook
 *
 * Enforces P10 (Human-Controlled Operations) and Section 13 (Hooks, Rules, and Safety):
 * - Denies catastrophic/destructive commands and hook-bypass flags.
 * - Requires explicit human confirmation (force_ask / ask) for sensitive files,
 *   Git publication (push, PR, merge, release, tag), destructive resets, and
 *   production deployments or database migrations.
 * - Allows routine development, discovery, build, and test operations.
 */

import fs from 'node:fs';

/**
 * Evaluate a PreToolUse payload and return { decision, reason }.
 * @param {object} payload
 * @returns {{ decision: 'allow' | 'ask' | 'force_ask' | 'deny', reason?: string }}
 */
export function evaluatePreToolSafety(payload) {
  if (!payload || typeof payload !== 'object') {
    return { decision: 'allow' };
  }

  const toolCall = payload.toolCall || {};
  const toolName = String(toolCall.name || '').toLowerCase();
  const args = toolCall.args || {};

  // 1. Evaluate file mutation tools (write_file, edit_file, write_to_file, replace_file_content, multi_replace_file_content)
  if (
    toolName === 'write_file' ||
    toolName === 'edit_file' ||
    toolName === 'write_to_file' ||
    toolName === 'replace_file_content' ||
    toolName === 'multi_replace_file_content'
  ) {
    const rawTarget =
      args.Path ||
      args.path ||
      args.TargetFile ||
      args.targetFile ||
      args.file_path ||
      args.filePath ||
      '';
    const targetPath = String(rawTarget).replace(/\\/g, '/');
    const baseName = targetPath.split('/').pop() || '';

    // Block path traversal outside normal paths or writing raw private keys
    if (
      /(^|\/)\.env(\.(production|prod|staging|local))?$/i.test(targetPath) ||
      /\.(pem|key|p12|pfx)$/i.test(baseName) ||
      /^(id_rsa|id_ed25519|credentials\.json|secrets\.ya?ml|\.npmrc|\.pypirc)$/i.test(baseName)
    ) {
      return {
        decision: 'force_ask',
        reason: `DevLifecycle Safety Gate (P10): Modifying sensitive credential or environment file "${baseName}" requires explicit user authorization.`
      };
    }

    // Warn/ask when editing production CI/CD release/deploy workflows
    if (/\.github\/workflows\/.*\b(release|deploy|prod)\b.*\.ya?ml$/i.test(targetPath)) {
      return {
        decision: 'ask',
        reason: `DevLifecycle Safety Gate (P10): Modifying release/deployment workflow "${baseName}" requires user authorization.`
      };
    }

    return { decision: 'allow' };
  }

  // 2. Evaluate terminal execution tool (run_command)
  if (toolName === 'run_command') {
    const rawCmd = String(args.CommandLine || args.command || '').trim();
    if (!rawCmd) {
      return { decision: 'allow' };
    }

    // Normalize whitespace for pattern matching
    const cmd = rawCmd.replace(/\s+/g, ' ');

    // --- HARD DENY: Catastrophic / Irreversible / Bypass Operations ---
    const denyPatterns = [
      {
        regex: /(^|[;&|]\s*)rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\/|~|\$HOME|\*|\.\.)(\s|$)/i,
        reason: 'DevLifecycle Safety Gate (P10): Catastrophic recursive deletion of root, home, or wildcard directory is strictly denied.'
      },
      {
        regex: /\b(Format-Volume|mkfs(\.[a-z0-9]+)?|dd\s+if=.*of=\/dev\/(sd|nvme|hd|disk))\b/i,
        reason: 'DevLifecycle Safety Gate (P10): Disk formatting or raw block device overwrite is strictly denied.'
      },
      {
        regex: /\bgit\s+push\b(?=.*(--force|-f\b))(?=.*\b(main|master|production|prod)\b)/i,
        reason: 'DevLifecycle Safety Gate (P10): Force-pushing to a protected/default branch (main/master/production) is denied.'
      },
      {
        regex: /\bgit\s+(commit|push|merge)\b.*--no-verify\b/i,
        reason: 'DevLifecycle Safety Gate (P10): Bypassing repository verification hooks (--no-verify) violates Verification Integrity (Gate C).'
      },
      {
        regex: /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b.*(\.env|id_rsa|id_ed25519|credentials\.json|\.pem\b)/i,
        reason: 'DevLifecycle Safety Gate (P10): Potential credential or secret file exfiltration over network is denied.'
      }
    ];

    for (const rule of denyPatterns) {
      if (rule.regex.test(cmd)) {
        return { decision: 'deny', reason: rule.reason };
      }
    }

    // --- FORCE_ASK: High-Risk Production / DB / Secret / Irreversible Operations ---
    const forceAskPatterns = [
      {
        regex: /\b(wrangler\s+(deploy|publish)|vercel(\s+deploy)?\s+.*--prod|netlify\s+deploy\s+.*--prod|fly(ctl)?\s+deploy|railway\s+up|terraform\s+(apply|destroy)|kubectl\s+(apply|delete|patch)|helm\s+(upgrade|uninstall|delete)|npm\s+publish|pnpm\s+publish|yarn\s+publish|cargo\s+publish|twine\s+upload)\b/i,
        reason: 'DevLifecycle Gate F (Release Integrity): Production deployment, package publication, or infrastructure mutation requires explicit human authorization.'
      },
      {
        regex: /\b(prisma\s+(migrate\s+deploy|migrate\s+reset|db\s+push\s+.*--force-reset)|drizzle-kit\s+(push|drop)|alembic\s+downgrade|flyway\s+clean|DROP\s+(DATABASE|TABLE|SCHEMA)|TRUNCATE\s+TABLE)\b/i,
        reason: 'DevLifecycle Safety Gate (P10): Database schema migration, reset, or destructive SQL operation requires explicit human authorization.'
      },
      {
        regex: /\b(gh\s+pr\s+merge|gh\s+release\s+(create|delete)|git\s+push\s+.*--force(-with-lease)?|git\s+push\s+.*--delete)\b/i,
        reason: 'DevLifecycle Gate F (P10): Merging pull requests, publishing releases, force-pushing, or deleting remote branches requires explicit human authorization.'
      }
    ];

    for (const rule of forceAskPatterns) {
      if (rule.regex.test(cmd)) {
        return { decision: 'force_ask', reason: rule.reason };
      }
    }

    // --- ASK: Separated Git Publication & Destructive Working-Tree Operations ---
    const askPatterns = [
      {
        regex: /\bgit\s+push\b/i,
        reason: 'DevLifecycle P10 (Separated Git Operations): Pushing commits to a remote repository requires explicit user authorization.'
      },
      {
        regex: /\bgh\s+pr\s+(create|edit|close|reopen)\b/i,
        reason: 'DevLifecycle P10 (Separated Git Operations): Creating or modifying a Pull Request requires explicit user authorization.'
      },
      {
        regex: /\bgit\s+tag\s+(-a|-s|-d|-f)\b/i,
        reason: 'DevLifecycle P10 (Separated Git Operations): Creating or deleting release tags requires user authorization.'
      },
      {
        regex: /\bgit\s+(reset\s+--hard|clean\s+-[a-zA-Z]*f|checkout\s+--\s+\.|restore\s+\.)\b/i,
        reason: 'DevLifecycle P12 (Clean Repository Policy): Discarding uncommitted working-tree changes or untracked files requires user authorization.'
      }
    ];

    for (const rule of askPatterns) {
      if (rule.regex.test(cmd)) {
        return { decision: 'ask', reason: rule.reason };
      }
    }
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
    const result = evaluatePreToolSafety(payload);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    // Fail-safe: return valid JSON so the hook contract never crashes the agent loop
    process.stdout.write(JSON.stringify({ decision: 'allow' }) + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('pre-tool-safety.mjs')) {
  main();
}
