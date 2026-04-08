/**
 * M3: Report Generator
 *
 * Generates markdown reports from parsed session data with:
 * - Per-agent token attribution table
 * - Agent chain tree visualization
 * - Cost estimation
 */

import type { AgentNode, SessionReport, TokenUsage } from './types.js';
import { flattenTree } from './chain.js';
import { getTranslations, t } from './i18n/index.js';
import type { Translations } from './i18n/index.js';

// ── Cost rates (per 1M tokens, USD) ──
// Approximate rates for Claude models as of 2026-04
const COST_RATES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':   { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5':  { input: 0.8, output: 4 },
  // Fallback
  default:              { input: 3, output: 15 },
};

function getCostRate(model: string | null) {
  if (!model) return COST_RATES.default;
  for (const [key, rate] of Object.entries(COST_RATES)) {
    if (key === 'default') continue;
    if (model.includes(key.replace('claude-', '').split('-').slice(0, 2).join('-'))) {
      return rate;
    }
  }
  // Try partial match
  if (model.includes('opus')) return COST_RATES['claude-opus-4-6'];
  if (model.includes('haiku')) return COST_RATES['claude-haiku-4-5'];
  if (model.includes('sonnet')) return COST_RATES['claude-sonnet-4-6'];
  return COST_RATES.default;
}

/** Escape pipe characters in markdown table cells to prevent column misalignment */
function escapeMdTableCell(s: string | null): string {
  if (!s) return '-';
  return s.replace(/\|/g, '\\|');
}

function estimateCost(node: AgentNode): number {
  const rate = getCostRate(node.model);
  // cache_creation: 25% more than base input price
  // cache_read: 90% discount from base input price
  const inputCost = (node.inputTokens / 1_000_000) * rate.input;
  const cacheCreateCost = (node.cacheCreationTokens / 1_000_000) * rate.input * 1.25;
  const cacheReadCost = (node.cacheReadTokens / 1_000_000) * rate.input * 0.1;
  const outputCost = (node.outputTokens / 1_000_000) * rate.output;
  return inputCost + cacheCreateCost + cacheReadCost + outputCost;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function truncate(s: string | null, maxLen: number): string {
  if (!s) return '-';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

// ── Tree Visualization ──

function renderTreeLine(node: AgentNode, prefix: string, isLast: boolean): string[] {
  const connector = isLast ? '└── ' : '├── ';
  const typeLabel = node.subagentType ? `[${node.subagentType}]` : '[agent]';
  const modelLabel = node.model ? ` (${node.model})` : '';
  const tokenLabel = ` ${formatTokens(node.totalTokens)} tok`;
  const durationLabel = ` ${formatDuration(node.totalDurationMs)}`;
  const desc = node.description ? ` "${truncate(node.description, 30)}"` : '';

  const line = `${prefix}${connector}${typeLabel}${modelLabel}${desc}${tokenLabel}${durationLabel}`;
  const lines = [line];

  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  for (let i = 0; i < node.children.length; i++) {
    const childLines = renderTreeLine(
      node.children[i],
      childPrefix,
      i === node.children.length - 1,
    );
    lines.push(...childLines);
  }

  return lines;
}

export function renderTree(roots: AgentNode[], tr: Translations): string {
  if (roots.length === 0) return tr.report.noAgentsFound;

  const lines: string[] = ['```'];
  lines.push(`session (${tr.report.mainSession})`);

  for (let i = 0; i < roots.length; i++) {
    const rootLines = renderTreeLine(roots[i], '', i === roots.length - 1);
    lines.push(...rootLines);
  }

  lines.push('```');
  return lines.join('\n');
}

// ── Token Attribution Table ──

function renderTokenTable(agents: AgentNode[], mainUsage: TokenUsage, tr: Translations): string {
  const flat = flattenTree(agents);
  const totalAgentTokens = flat.reduce((sum, a) => sum + a.totalTokens, 0);
  const mainTokens = mainUsage.input_tokens + mainUsage.output_tokens +
    (mainUsage.cache_creation_input_tokens ?? 0) + (mainUsage.cache_read_input_tokens ?? 0);
  const grandTotal = mainTokens + totalAgentTokens;

  const lines: string[] = [];

  const { colNum, colTask, colAgent, colModel, colUsed, colPercent, colCost, colTime, colTools } = tr.report;
  lines.push(`| ${colNum} | ${colTask} | ${colAgent} | ${colModel} | ${colUsed} | ${colPercent} | ${colCost} | ${colTime} | ${colTools} |`);
  lines.push('|---|------|-------|-------|------|---|------|----------|-------|');

  // Main session row
  const mainPct = grandTotal > 0 ? ((mainTokens / grandTotal) * 100).toFixed(1) : '0';
  const mainRate = getCostRate(null);
  const mainCost =
    (mainUsage.input_tokens / 1_000_000) * mainRate.input +
    ((mainUsage.cache_creation_input_tokens ?? 0) / 1_000_000) * mainRate.input * 1.25 +
    ((mainUsage.cache_read_input_tokens ?? 0) / 1_000_000) * mainRate.input * 0.1 +
    (mainUsage.output_tokens / 1_000_000) * mainRate.output;
  lines.push(`| - | **${tr.report.mainSession}** | - | - | ${formatTokens(mainTokens)} | ${mainPct}% | ${formatCost(mainCost)} | - | - |`);

  // Agent rows
  flat.forEach((agent, idx) => {
    const indent = '  '.repeat(agent.depth - 1);
    const pct = grandTotal > 0 ? ((agent.totalTokens / grandTotal) * 100).toFixed(1) : '0';
    const cost = estimateCost(agent);
    lines.push(
      `| ${idx + 1} | ${indent}${escapeMdTableCell(truncate(agent.description, 25))} | ${escapeMdTableCell(agent.subagentType)} | ${escapeMdTableCell(agent.model)} | ${formatTokens(agent.totalTokens)} | ${pct}% | ${formatCost(cost)} | ${formatDuration(agent.totalDurationMs)} | ${agent.toolUseCount} |`,
    );
  });

  // Total row
  const totalCost = flat.reduce((sum, a) => sum + estimateCost(a), 0) + mainCost;
  lines.push(`| | **${tr.report.total}** | | | **${formatTokens(grandTotal)}** | **100%** | **${formatCost(totalCost)}** | | |`);

  return lines.join('\n');
}

// ── Full Report ──

export function generateReport(report: SessionReport, mainUsage: TokenUsage): string {
  const tr = getTranslations();

  const lines: string[] = [];

  lines.push(`# ${tr.report.title}`);
  lines.push('');
  lines.push(`> **${tr.report.session}**: \`${report.sessionId}\``);
  lines.push(`> **${tr.report.directory}**: \`${report.sessionDir}\``);
  lines.push(`> **${tr.report.date}**: ${report.timestamp}`);
  lines.push(`> **${tr.report.mainModel}**: ${report.mainModel ?? 'unknown'}`);
  lines.push(`> **${tr.report.agents}**: ${report.agentCount} (${tr.report.maxDepth}: ${report.maxDepth})`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Section 1: Agent Chain Tree
  lines.push(`## ${tr.report.agentChainTree}`);
  lines.push('');
  lines.push(renderTree(report.agents, tr));
  lines.push('');

  // Section 2: Token Attribution
  lines.push(`## ${tr.report.tokenAttribution}`);
  lines.push('');
  lines.push(renderTokenTable(report.agents, mainUsage, tr));
  lines.push('');

  // Section 3: Warnings
  const warnings: string[] = [];

  // Check for compaction
  const hasCompaction = report.agents.some(a => a.agentId.includes('compact'));
  if (hasCompaction) {
    warnings.push(`- ${tr.report.compactionWarning}`);
  }

  // Check for agents with 0 tokens
  const zeroTokenAgents = flattenTree(report.agents).filter(a => a.totalTokens === 0);
  if (zeroTokenAgents.length > 0) {
    warnings.push(`- ${t(tr.report.zeroTokenWarning, zeroTokenAgents.length)}`);
  }

  if (warnings.length > 0) {
    lines.push(`## ${tr.report.warnings}`);
    lines.push('');
    lines.push(...warnings);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*${tr.report.generatedBy}*`);

  return lines.join('\n');
}
