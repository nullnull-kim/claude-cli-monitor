/**
 * M8: Real-time Watch Mode
 *
 * Polls agent state files and renders a live-updating terminal display.
 * Shows active/stopped agents, token counts, elapsed time.
 *
 * Usage: claude-cli-monitor --watch [--session <id>]
 */

import { readSessionState, readLatestSessionState, isStaleAgent } from './state.js';
import type { AgentState, SessionState } from './state.js';
import { resolveAgentDisplayName, isGenericAgent, hasMultipleModels, getModelSuffix } from './resolver.js';
import { loadConfig } from './config.js';

// ── ANSI ──

const _noColor = 'NO_COLOR' in process.env;

const c = {
  reset:   _noColor ? '' : '\x1b[0m',
  bold:    _noColor ? '' : '\x1b[1m',
  dim:     _noColor ? '' : '\x1b[2m',
  white:   _noColor ? '' : '\x1b[37m',
  cyan:    _noColor ? '' : '\x1b[36m',
  green:   _noColor ? '' : '\x1b[32m',
  yellow:  _noColor ? '' : '\x1b[33m',
  orange:  _noColor ? '' : '\x1b[38;5;208m',
  red:     _noColor ? '' : '\x1b[31m',
  magenta: _noColor ? '' : '\x1b[35m',
  blue:    _noColor ? '' : '\x1b[34m',
  gray:    _noColor ? '' : '\x1b[90m',
  bgGreen: _noColor ? '' : '\x1b[42m\x1b[30m',
  bgYellow: _noColor ? '' : '\x1b[43m\x1b[30m',
  bgRed:   _noColor ? '' : '\x1b[41m\x1b[37m',
  clearScreen: '\x1b[2J\x1b[H',
  hideCursor: _noColor ? '' : '\x1b[?25l',
  showCursor: _noColor ? '' : '\x1b[?25h',
};

// ── Helpers ──

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function elapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  return formatDuration(Math.max(0, ms));
}

function spinner(tick: number): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return frames[tick % frames.length];
}

/** Icon for agent status: ◉ Built-in / ● Custom / ✓ Completed / ⚠ Stale */
function statusIcon(agent: AgentState, staleThresholdMs?: number): string {
  const stale = isStaleAgent(agent, staleThresholdMs);
  if (stale) return `${c.yellow}\u26A0${c.reset}`;
  const generic = isGenericAgent(agent);
  if (agent.status === 'stopped' || agent.stoppedAt) {
    return generic ? `${c.dim}\u25C9${c.reset}` : `${c.dim}\u2713${c.reset}`;
  }
  // Active: built-in (◉ orange) vs custom (● green)
  return generic ? `${c.orange}\u25C9${c.reset}` : `${c.green}\u25CF${c.reset}`;
}

function typeColor(type: string | null): string {
  if (!type || type === 'agent') return `${c.dim}agent${c.reset}`;
  if (type === 'built-in') return `${c.orange}${type}${c.reset}`;
  if (type.includes('guide')) return `${c.magenta}${type}${c.reset}`;
  if (type === 'Explore') return `${c.blue}${type}${c.reset}`;
  if (type === 'Plan') return `${c.yellow}${type}${c.reset}`;
  return `${c.cyan}${type}${c.reset}`;
}

function truncate(s: string | null, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '\u2026';
}

// ── Box Drawing ──

const box = {
  tl: '\u250C', tr: '\u2510', bl: '\u2514', br: '\u2518',
  h: '\u2500', v: '\u2502',
  lj: '\u251C', rj: '\u2524',
};

function hLine(width: number, left: string, right: string): string {
  return left + box.h.repeat(width) + right;
}

// ── Render Frame ──

function renderFrame(state: SessionState | null, tick: number, staleThresholdMs?: number): string {
  const lines: string[] = [];
  const now = new Date().toLocaleTimeString();
  const width = Math.min(process.stdout.columns || 80, 100);
  const innerWidth = width - 4;

  lines.push(c.clearScreen);

  // Header
  lines.push(`  ${c.bold}${c.cyan}Agent Monitor${c.reset} ${c.dim}${now}${c.reset}`);
  lines.push(`  ${hLine(innerWidth, box.tl, box.tr)}`);

  if (!state || state.totalCount === 0) {
    lines.push(`  ${box.v} ${c.dim}Waiting for agents...${c.reset}${' '.repeat(Math.max(0, innerWidth - 23))}${box.v}`);
    lines.push(`  ${box.v}${' '.repeat(innerWidth)}${box.v}`);
    lines.push(`  ${box.v} ${c.dim}Hooks must be configured in Claude Code settings.json${c.reset}${' '.repeat(Math.max(0, innerWidth - 55))}${box.v}`);
    lines.push(`  ${box.v} ${c.dim}Then start a session that uses the Agent tool.${c.reset}${' '.repeat(Math.max(0, innerWidth - 49))}${box.v}`);
    lines.push(`  ${hLine(innerWidth, box.bl, box.br)}`);
    lines.push('');
    lines.push(`  ${c.dim}Press Ctrl+C to exit${c.reset}`);
    return lines.join('\n');
  }

  // Session summary
  const { activeCount, totalCount, totalApproxTokens } = state;
  const summaryLeft = ` Session: ${c.white}${state.sessionId.slice(0, 8)}${c.reset}`;
  const activeLabel = activeCount > 0
    ? `${c.green}${spinner(tick)} ${activeCount} active${c.reset}`
    : `${c.dim}all done${c.reset}`;
  const summaryLine = ` ${activeLabel}  ${c.dim}|${c.reset}  ${c.cyan}${totalCount}${c.reset} total  ${c.dim}|${c.reset}  ${c.cyan}${formatTokens(totalApproxTokens)}${c.reset} tokens`;

  lines.push(`  ${box.v}${summaryLeft}${' '.repeat(Math.max(0, innerWidth - stripLen(summaryLeft)))}${box.v}`);
  lines.push(`  ${box.v}${summaryLine}${' '.repeat(Math.max(0, innerWidth - stripLen(summaryLine)))}${box.v}`);
  lines.push(`  ${hLine(innerWidth, box.lj, box.rj)}`);

  // Detect model mix for suffix display
  const showModelSuffix = hasMultipleModels(state.agents);

  // Agent rows
  for (const agent of state.agents) {
    const icon = statusIcon(agent, staleThresholdMs);
    const stale = isStaleAgent(agent, staleThresholdMs);
    const completed = agent.status === 'stopped' || !!agent.stoppedAt;
    const suffix = showModelSuffix ? getModelSuffix(agent.model) : '';
    const type = typeColor(resolveAgentDisplayName(agent)) + (suffix ? `${c.dim}${suffix}${c.reset}` : '');
    const desc = agent.description
      ? ` ${c.white}${truncate(agent.description, 30)}${c.reset}`
      : '';
    const time = agent.status === 'active'
      ? `${c.yellow}${elapsed(agent.startedAt)}${c.reset}`
      : agent.stoppedAt
        ? `${c.dim}${formatDuration(new Date(agent.stoppedAt).getTime() - new Date(agent.startedAt).getTime())}${c.reset}`
        : '';
    const tokens = agent.approxTokens > 0
      ? `${c.cyan}${formatTokens(agent.approxTokens)}${c.reset}`
      : '';
    const tools = agent.toolUseCount > 0
      ? `${c.dim}${agent.toolUseCount} tools${c.reset}`
      : '';

    const agentLine = ` ${icon} ${type}${desc}`;
    const statsLine = `   ${[tokens, tools, time].filter(Boolean).join('  ')}`;

    // Dim completed rows, yellow for stale
    const rowPrefix = completed ? c.dim : stale ? c.yellow : '';
    const rowSuffix = (completed || stale) ? c.reset : '';

    lines.push(`  ${box.v}${rowPrefix}${agentLine}${' '.repeat(Math.max(0, innerWidth - stripLen(agentLine)))}${rowSuffix}${box.v}`);
    if (stripLen(statsLine) > 3) {
      lines.push(`  ${box.v}${rowPrefix}${statsLine}${' '.repeat(Math.max(0, innerWidth - stripLen(statsLine)))}${rowSuffix}${box.v}`);
    }

    // Separator between agents
    if (agent !== state.agents[state.agents.length - 1]) {
      lines.push(`  ${box.v}${c.dim}${' '.repeat(innerWidth)}${c.reset}${box.v}`);
    }
  }

  lines.push(`  ${hLine(innerWidth, box.bl, box.br)}`);
  lines.push('');
  lines.push(`  ${c.dim}Refreshing every 500ms  |  Ctrl+C to exit${c.reset}`);

  return lines.join('\n');
}

function stripLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// ── Watch Loop ──

export function startWatch(sessionId?: string): void {
  let tick = 0;
  const cfg = loadConfig();
  const staleThresholdMs = cfg.staleThresholdMs;

  process.stdout.write(c.hideCursor);

  // Graceful exit
  const cleanup = () => {
    process.stdout.write(c.showCursor);
    process.stdout.write(c.clearScreen);
    console.log('  Agent Monitor stopped.');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const render = () => {
    const state = sessionId
      ? readSessionState(sessionId)
      : readLatestSessionState();
    process.stdout.write(renderFrame(state, tick, staleThresholdMs));
    tick++;
  };

  // Initial render
  render();

  // Poll loop
  setInterval(render, 500);
}
