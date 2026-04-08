#!/usr/bin/env node

/**
 * Hook Entry Point
 *
 * Lightweight CLI for Claude Code hooks. Reads event JSON from stdin,
 * dispatches to the appropriate handler, and exits.
 *
 * Usage in Claude Code settings.json hooks:
 *   {
 *     "hooks": {
 *       "SubagentStart": [{ "command": "claude-cli-monitor-hook SubagentStart" }],
 *       "SubagentStop":  [{ "command": "claude-cli-monitor-hook SubagentStop" }],
 *       "PostToolUse":   [{ "matcher": "Agent", "command": "claude-cli-monitor-hook PostToolUse" }]
 *     }
 *   }
 *
 * Stdin: JSON payload from Claude Code hook system
 * Exit: 0 on success, 1 on error (silent — never blocks the main process)
 */

import { appendFileSync, mkdirSync, existsSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { dispatchHookEvent } from './hooks.js';
import type { HookEventType } from './hooks.js';

const VALID_EVENTS = new Set<HookEventType>(['SubagentStart', 'SubagentStop', 'PostToolUse', 'UserPromptSubmit', 'Stop']);

const MAX_DEBUG_LOG_BYTES = 5 * 1024 * 1024; // 5MB

// Debug: dump raw payloads to log file (rotates at 5MB)
function debugLog(eventType: string, raw: string): void {
  const dir = join(homedir(), '.claude-cli-monitor', 'debug');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const logPath = join(dir, 'hook-payloads.jsonl');

  // Rotate if over 5MB
  try {
    if (existsSync(logPath)) {
      const { size } = statSync(logPath);
      if (size > MAX_DEBUG_LOG_BYTES) {
        const oldPath = logPath.replace('.jsonl', '.old.jsonl');
        // Remove previous .old if exists, then rename current
        try { unlinkSync(oldPath); } catch {}
        renameSync(logPath, oldPath);
      }
    }
  } catch {
    // Rotation failure is non-fatal
  }

  const line = JSON.stringify({ ts: new Date().toISOString(), event: eventType, payload: raw }) + '\n';
  appendFileSync(logPath, line);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    }, 50); // 50ms timeout — don't block

    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    process.stdin.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // If stdin is already ended (piped empty)
    if (process.stdin.readableEnded) {
      clearTimeout(timeout);
      resolve('');
    }
  });
}

async function main(): Promise<void> {
  const eventType = process.argv[2] as HookEventType;

  if (!eventType || !VALID_EVENTS.has(eventType)) {
    process.stderr.write(
      `Usage: claude-cli-monitor-hook <SubagentStart|SubagentStop|PostToolUse|UserPromptSubmit|Stop>\n`,
    );
    process.exit(1);
  }

  try {
    const input = await readStdin();
    debugLog(eventType, input.trim() || '(empty)');
    if (!input.trim()) {
      process.exit(0); // No input, nothing to do
    }

    const payload = JSON.parse(input);
    const result = dispatchHookEvent(eventType, payload);

    // Output hook JSON for Claude Code UI integration
    if (eventType === 'SubagentStart' || eventType === 'SubagentStop') {
      const agentId = payload.agent_id ?? 'unknown';
      const agentType = payload.agent_type ?? '';
      const status = eventType === 'SubagentStart' ? '● LIVE' : '✓ done';
      const hookOutput = {
        continue: true,
        hookSpecificOutput: {
          hookEventName: eventType,
          additionalContext: `[agent-monitor] ${status} ${agentType || agentId}`,
        },
      };
      process.stdout.write(JSON.stringify(hookOutput));
    }
  } catch {
    // Silent failure — never block the main Claude Code process
    process.exit(0);
  }
}

main();
