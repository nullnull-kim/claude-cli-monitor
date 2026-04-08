/**
 * M7: Terminal Formatter
 *
 * Pretty-prints agent reports in the terminal with ANSI colors,
 * box-drawing borders, aligned columns, and visual token bars.
 *
 * Used for stdout output. Markdown (report.ts) is kept for --output files.
 */

import type { AgentNode, SessionReport, TokenUsage } from './types.js';
import { flattenTree } from './chain.js';
import { resolveAgentDisplayName, isGenericAgent, hasMultipleModels, getModelSuffix } from './resolver.js';
import { loadConfig } from './config.js';
import { getTranslations, t } from './i18n/index.js';

// ── ANSI Color Helpers ──

const _noColor = 'NO_COLOR' in process.env;

const c = {
  reset:   _noColor ? '' : '\x1b[0m',
  bold:    _noColor ? '' : '\x1b[1m',
  dim:     _noColor ? '' : '\x1b[2m',
  white:   _noColor ? '' : '\x1b[37m',
  cyan:    _noColor ? '' : '\x1b[36m',
  green:   _noColor ? '' : '\x1b[32m',
  yellow:  _noColor ? '' : '\x1b[33m',
  red:     _noColor ? '' : '\x1b[31m',
  magenta: _noColor ? '' : '\x1b[35m',
  blue:    _noColor ? '' : '\x1b[34m',
  bgDim:   _noColor ? '' : '\x1b[48;5;236m',
  gray:    _noColor ? '' : '\x1b[90m',
  orange:  _noColor ? '' : '\x1b[38;5;208m',
};

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function visualLen(s: string): number {
  // Strip ANSI, then count: ASCII = 1, CJK/fullwidth = 2
  const plain = strip(s);
  let len = 0;
  for (const ch of plain) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x115F) ||
      (code >= 0x2E80 && code <= 0xA4CF && code !== 0x303F) ||
      (code >= 0xAC00 && code <= 0xD7AF) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE10 && code <= 0xFE6F) ||
      (code >= 0xFF01 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x20000 && code <= 0x2FA1F)
    ) {
      len += 2;
    } else {
      len += 1;
    }
  }
  return len;
}

function padRight(s: string, width: number): string {
  const diff = width - visualLen(s);
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

function padLeft(s: string, width: number): string {
  const diff = width - visualLen(s);
  return diff > 0 ? ' '.repeat(diff) + s : s;
}

// ── Formatting Helpers ──

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function truncate(s: string | null, maxLen: number): string {
  if (!s) return '';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '\u2026';
}

// ── Cost Rates ──

const COST_RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':   { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5':  { input: 0.8, output: 4 },
  default:              { input: 3, output: 15 },
};

function getCostRate(model: string | null) {
  if (!model) return COST_RATES.default;
  if (model.includes('opus')) return COST_RATES['claude-opus-4-6'];
  if (model.includes('haiku')) return COST_RATES['claude-haiku-4-5'];
  if (model.includes('sonnet')) return COST_RATES['claude-sonnet-4-6'];
  return COST_RATES.default;
}

function estimateCost(node: AgentNode): number {
  const rate = getCostRate(node.model);
  const inputCost = (node.inputTokens / 1_000_000) * rate.input;
  const cacheCreateCost = (node.cacheCreationTokens / 1_000_000) * rate.input * 1.25;
  const cacheReadCost = (node.cacheReadTokens / 1_000_000) * rate.input * 0.1;
  const outputCost = (node.outputTokens / 1_000_000) * rate.output;
  return inputCost + cacheCreateCost + cacheReadCost + outputCost;
}

// ── Bar Chart ──

function tokenBar(pct: number, width: number = 20): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  if (pct >= 50) return `${c.cyan}${bar}${c.reset}`;
  if (pct >= 10) return `${c.blue}${bar}${c.reset}`;
  return `${c.dim}${bar}${c.reset}`;
}

// ── Box Drawing ──

const box = {
  tl: '\u250C', tr: '\u2510', bl: '\u2514', br: '\u2518',
  h: '\u2500', v: '\u2502',
  lj: '\u251C', rj: '\u2524', tj: '\u252C', bj: '\u2534', cross: '\u253C',
};

function hLine(widths: number[], left: string, mid: string, right: string): string {
  return left + widths.map(w => box.h.repeat(w + 2)).join(mid) + right;
}

function tableRow(cells: string[], widths: number[], aligns: ('l' | 'r')[]): string {
  const parts = cells.map((cell, i) => {
    const pad = aligns[i] === 'r' ? padLeft : padRight;
    return ` ${pad(cell, widths[i])} `;
  });
  return `${box.v}${parts.join(box.v)}${box.v}`;
}

// ── Icon Helpers ──

/** Agent icon: ◉ Built-in / ● Custom / ✓ Completed (post-session, all completed) */
function agentIcon(node: AgentNode): string {
  const generic = isGenericAgent(node);
  const typeIcon = generic ? '\u25C9' : '\u25CF';
  return `\u2713${typeIcon}`;
}

/**
 * Status icon for tree view: ◉ (built-in) / ● (custom)
 * Since terminal.ts is post-session analysis, all agents are completed.
 */
function treeIcon(node: AgentNode): string {
  const generic = isGenericAgent(node);
  if (generic) return `${c.dim}\u2713${c.reset}${c.orange}\u25C9${c.reset}`;
  return `${c.dim}\u2713${c.reset}${c.cyan}\u25CF${c.reset}`;
}

// ── Tree Visualization ──

function renderTerminalTree(roots: AgentNode[], mainSessionLabel: string): string[] {
  const lines: string[] = [];
  lines.push(`  ${c.bold}${c.cyan}\u25C9 session${c.reset} ${c.dim}(${mainSessionLabel})${c.reset}`);

  function walk(node: AgentNode, prefix: string, isLast: boolean): void {
    const conn = isLast ? '\u2514\u2500 ' : '\u251C\u2500 ';
    const icon = treeIcon(node);
    const displayName = resolveAgentDisplayName(node);
    const nodeTypeColor = displayName === 'built-in' ? c.orange
      : displayName.includes('guide') ? c.magenta
      : displayName === 'agent' ? c.dim
      : c.cyan;
    const typeLabel = displayName === 'agent'
      ? `${c.dim}agent${c.reset}`
      : `${nodeTypeColor}${displayName}${c.reset}`;
    const modelLabel = node.model ? ` ${c.gray}(${node.model})${c.reset}` : '';
    const desc = node.description ? ` ${c.white}${truncate(node.description, 28)}${c.reset}` : '';
    const tokens = ` ${c.cyan}${formatTokens(node.totalTokens)}${c.reset}`;
    const dur = ` ${c.dim}${formatDuration(node.totalDurationMs)}${c.reset}`;

    lines.push(`  ${prefix}${conn}${icon} ${typeLabel}${modelLabel}${desc}${tokens}${dur}`);

    const childPrefix = prefix + (isLast ? '   ' : '\u2502  ');
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i], childPrefix, i === node.children.length - 1);
    }
  }

  for (let i = 0; i < roots.length; i++) {
    walk(roots[i], '', i === roots.length - 1);
  }

  return lines;
}

// ── Main Terminal Report ──

export function renderTerminalReport(report: SessionReport, mainUsage: TokenUsage, verbose?: boolean): string {
  const config = loadConfig();
  const tr = getTranslations();
  const r = tr.report;

  const lines: string[] = [];
  const flat = flattenTree(report.agents);

  // ── Header ──
  lines.push('');
  lines.push(`  ${c.bold}${c.cyan}${r.title}${c.reset}`);
  lines.push(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
  lines.push(`  ${c.gray}${r.session.padEnd(10)}${c.reset}${report.sessionId.slice(0, 8)}...`);
  lines.push(`  ${c.gray}${r.model.padEnd(10)}${c.reset}${report.mainModel ?? 'unknown'}`);
  lines.push(`  ${c.gray}${r.agents.padEnd(10)}${c.reset}${report.agentCount} ${c.dim}(${r.maxDepth}: ${report.maxDepth})${c.reset}`);
  lines.push(`  ${c.gray}${r.time.padEnd(10)}${c.reset}${report.timestamp.slice(0, 19).replace('T', ' ')}`);
  lines.push('');

  // ── Agent Tree ──
  lines.push(`  ${c.bold}${r.agentChainTree}${c.reset}`);
  lines.push(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);
  lines.push(...renderTerminalTree(report.agents, r.mainSession));
  lines.push('');

  // ── Token Attribution Table ──
  lines.push(`  ${c.bold}${r.tokenAttribution}${c.reset}`);
  lines.push(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);

  // Calculate totals
  const totalAgentTokens = flat.reduce((sum, a) => sum + a.totalTokens, 0);
  const mainTokens = mainUsage.input_tokens + mainUsage.output_tokens +
    (mainUsage.cache_creation_input_tokens ?? 0) + (mainUsage.cache_read_input_tokens ?? 0);
  const grandTotal = mainTokens + totalAgentTokens;

  const mainRate = getCostRate(report.mainModel);
  const mainCost =
    (mainUsage.input_tokens / 1_000_000) * mainRate.input +
    ((mainUsage.cache_creation_input_tokens ?? 0) / 1_000_000) * mainRate.input * 1.25 +
    ((mainUsage.cache_read_input_tokens ?? 0) / 1_000_000) * mainRate.input * 0.1 +
    (mainUsage.output_tokens / 1_000_000) * mainRate.output;

  // Build table data
  // verbose=true: include Model column (index 3); verbose=false (default): omit Model
  const headers = verbose
    ? [r.colNum, r.colTask, r.colAgent, r.colModel, r.colUsed, r.colPercent, r.colBar, r.colCost, r.colTime, r.colTools]
    : [r.colNum, r.colTask, r.colAgent, r.colUsed, r.colPercent, r.colBar, r.colCost, r.colTime, r.colTools];
  const aligns: ('l' | 'r')[] = verbose
    ? ['r', 'l', 'l', 'l', 'r', 'r', 'l', 'r', 'r', 'r']
    : ['r', 'l', 'l', 'r', 'r', 'l', 'r', 'r', 'r'];

  const rows: string[][] = [];

  // Main session row
  const mainPct = grandTotal > 0 ? (mainTokens / grandTotal) * 100 : 0;
  rows.push([
    `${c.dim}-${c.reset}`,
    `${c.bold}${r.mainSession}${c.reset}`,
    `${c.dim}-${c.reset}`,
    ...(verbose ? [`${c.dim}-${c.reset}`] : []),
    formatTokens(mainTokens),
    `${mainPct.toFixed(1)}%`,
    '', // bar added separately
    formatCost(mainCost),
    `${c.dim}-${c.reset}`,
    `${c.dim}-${c.reset}`,
  ]);

  // Detect model mix for suffix in non-verbose mode
  const showModelSuffix = !verbose && hasMultipleModels(flat);

  // Agent rows
  flat.forEach((agent, idx) => {
    const pct = grandTotal > 0 ? (agent.totalTokens / grandTotal) * 100 : 0;
    const cost = estimateCost(agent);
    const displayName = resolveAgentDisplayName(agent);
    const modelSuffix = showModelSuffix ? getModelSuffix(agent.model) : '';
    // Icon: ● for named agent type, ○ for ad-hoc/fallback
    const icon = displayName !== 'agent' ? '\u25CF' : '\u25CB';
    const agentLabel = `${c.dim}\u2713${c.reset}${icon} ${truncate(displayName, 10)}${modelSuffix ? `${c.dim}${modelSuffix}${c.reset}` : ''}`;
    rows.push([
      `${c.dim}${idx + 1}${c.reset}`,
      truncate(agent.description, 24) || `${c.dim}(unnamed)${c.reset}`,
      agentLabel,
      ...(verbose ? [truncate(agent.model, 20)] : []),
      formatTokens(agent.totalTokens),
      `${pct.toFixed(1)}%`,
      '', // bar
      formatCost(cost),
      formatDuration(agent.totalDurationMs),
      String(agent.toolUseCount),
    ]);
  });

  // Total row
  const totalCost = flat.reduce((sum, a) => sum + estimateCost(a), 0) + mainCost;
  rows.push([
    '',
    `${c.bold}${r.total}${c.reset}`,
    '',
    ...(verbose ? [''] : []),
    `${c.bold}${formatTokens(grandTotal)}${c.reset}`,
    `${c.bold}100%${c.reset}`,
    '',
    `${c.bold}${formatCost(totalCost)}${c.reset}`,
    '',
    '',
  ]);

  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const headerLen = visualLen(h);
    const maxDataLen = rows.reduce((max, row) => Math.max(max, visualLen(row[i])), 0);
    return Math.max(headerLen, maxDataLen);
  });

  // Bar column: fixed width (index 5 default, index 6 verbose)
  const barWidth = 16;
  const barIdx = verbose ? 6 : 5;
  colWidths[barIdx] = barWidth;

  // Render table
  lines.push('  ' + hLine(colWidths, box.tl, box.tj, box.tr));

  // Header row
  const headerCells = headers.map(h => `${c.bold}${h}${c.reset}`);
  lines.push('  ' + tableRow(headerCells, colWidths, aligns));
  lines.push('  ' + hLine(colWidths, box.lj, box.cross, box.rj));

  // Data rows
  for (let row_i = 0; row_i < rows.length; row_i++) {
    const row = [...rows[row_i]];
    // Insert bar
    if (row_i === 0) {
      row[barIdx] = tokenBar(grandTotal > 0 ? (mainTokens / grandTotal) * 100 : 0, barWidth);
    } else if (row_i < rows.length - 1) {
      const agent = flat[row_i - 1];
      const pct = grandTotal > 0 ? (agent.totalTokens / grandTotal) * 100 : 0;
      row[barIdx] = tokenBar(pct, barWidth);
    } else {
      row[barIdx] = ''; // total row
    }

    lines.push('  ' + tableRow(row, colWidths, aligns));

    // Separator before total
    if (row_i === rows.length - 2) {
      lines.push('  ' + hLine(colWidths, box.lj, box.cross, box.rj));
    }
  }

  lines.push('  ' + hLine(colWidths, box.bl, box.bj, box.br));

  // ── Warnings ──
  const warnings: string[] = [];
  const zeroTokenAgents = flat.filter(a => a.totalTokens === 0);
  if (zeroTokenAgents.length > 0) {
    warnings.push(`${c.yellow}\u26A0${c.reset}  ${t(r.zeroTokenWarning, zeroTokenAgents.length)}`);
  }

  if (warnings.length > 0) {
    lines.push('');
    for (const w of warnings) lines.push(`  ${w}`);
  }

  lines.push('');
  lines.push(`  ${c.dim}${r.generatedBy}${c.reset}`);
  lines.push('');

  return lines.join('\n');
}

// ── List Sessions (Terminal) ──

export function renderSessionList(
  sessions: Array<{ sessionId: string; mtime: Date; projectDir: string; agentCount?: number }>,
): string {
  const config = loadConfig();
  const tr = getTranslations();
  const r = tr.report;

  const lines: string[] = [];
  lines.push('');
  lines.push(`  ${c.bold}${c.cyan}${r.sessionsWithSubagents}${c.reset} ${c.dim}(${sessions.length})${c.reset}`);
  lines.push(`  ${c.dim}${'─'.repeat(50)}${c.reset}`);

  const headers = [r.colNum, r.colSession, r.colDate, r.colProject];
  const aligns: ('l' | 'r')[] = ['r', 'l', 'l', 'l'];
  const rows: string[][] = [];

  for (let i = 0; i < Math.min(sessions.length, 30); i++) {
    const s = sessions[i];
    rows.push([
      `${c.dim}${i + 1}${c.reset}`,
      s.sessionId.slice(0, 8),
      s.mtime.toISOString().slice(0, 16).replace('T', ' '),
      s.projectDir.split(/[\\/]/).pop() ?? '',
    ]);
  }

  const colWidths = headers.map((h, i) => {
    const headerLen = visualLen(h);
    const maxDataLen = rows.reduce((max, row) => Math.max(max, visualLen(row[i])), 0);
    return Math.max(headerLen, maxDataLen);
  });

  lines.push('  ' + hLine(colWidths, box.tl, box.tj, box.tr));
  const headerCells = headers.map(h => `${c.bold}${h}${c.reset}`);
  lines.push('  ' + tableRow(headerCells, colWidths, aligns));
  lines.push('  ' + hLine(colWidths, box.lj, box.cross, box.rj));

  for (const row of rows) {
    lines.push('  ' + tableRow(row, colWidths, aligns));
  }

  lines.push('  ' + hLine(colWidths, box.bl, box.bj, box.br));

  if (sessions.length > 30) {
    lines.push(`  ${c.dim}${t(r.andMore, sessions.length - 30)}${c.reset}`);
  }
  lines.push('');

  return lines.join('\n');
}
