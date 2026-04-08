/**
 * M6: Statusline Formatter
 *
 * Reads agent state files and produces formatted strings for
 * claude-diet statusline integration.
 *
 * Output formats:
 *   [agents: 2/3]           — 2 active out of 3 total
 *   [agents: 0/3 ~45.2k]   — all done, ~45.2k tokens used
 *   [agents: idle]          — no agents in current session
 */

import { readSessionState, readLatestSessionState } from './state.js';
import type { SessionState } from './state.js';
import { resolveAgentDisplayName, hasMultipleModels, getModelSuffix } from './resolver.js';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Format a session state as a compact statusline string.
 * 🤖 prefix always shown as the monitor's identity marker.
 */
export function formatStatusline(state: SessionState | null): string {
  if (!state || state.totalCount === 0) {
    return '\uD83E\uDD16 [agents: idle]';
  }

  const { activeCount, totalCount, totalApproxTokens } = state;

  let line = `\uD83E\uDD16 [agents: ${activeCount}/${totalCount}`;

  // Show token count when agents have completed
  if (totalApproxTokens > 0) {
    line += ` ${formatTokens(totalApproxTokens)}`;
  }

  line += ']';
  return line;
}

/**
 * Format statusline for a specific session.
 */
export function getSessionStatusline(sessionId: string): string {
  const state = readSessionState(sessionId);
  return formatStatusline(state);
}

/**
 * Format statusline for the most recently active session.
 */
export function getLatestStatusline(): string {
  const state = readLatestSessionState();
  return formatStatusline(state);
}

/**
 * Get detailed agent list for expanded view.
 * Each line: "  [active] agent-type "description" ~12.3k tokens"
 */
export function formatAgentList(state: SessionState | null): string[] {
  if (!state || state.agents.length === 0) return ['  (no agents)'];

  const showModelSuffix = hasMultipleModels(state.agents);

  return state.agents.map(agent => {
    const statusIcon = agent.status === 'active' ? '>' : ' ';
    const suffix = showModelSuffix ? getModelSuffix(agent.model) : '';
    const typeLabel = resolveAgentDisplayName(agent) + suffix;
    const desc = agent.description
      ? ` "${agent.description.length > 30 ? agent.description.slice(0, 27) + '...' : agent.description}"`
      : '';
    const tokens = agent.approxTokens > 0 ? ` ${formatTokens(agent.approxTokens)}` : '';
    return `${statusIcon} [${typeLabel}]${desc}${tokens}`;
  });
}
