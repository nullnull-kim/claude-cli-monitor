/**
 * cc-agent-monitor
 *
 * Analyze Claude Code subagent token usage and visualize agent chain trees.
 */

// Phase 1: Post-hoc analysis
export { parseJsonl, parseSession, findSessionFiles, findClaudeProjectsDir } from './parser.js';
export { buildAgentTree, getMaxDepth, countAgents, flattenTree, filterEmptyAgents } from './chain.js';
export { generateReport, renderTree } from './report.js';
export type { AgentNode, SessionReport, TranscriptMessage, TokenUsage, ToolUseResult } from './types.js';

// Phase 2: Real-time monitoring
export { writeAgentState, updateAgentState, readAgentState, readSessionState, readLatestSessionState, cleanSessionState, cleanAllState, getSessionStateDir, getCurrentTurn, advanceTurn } from './state.js';
export type { AgentState, SessionState } from './state.js';
export { handleSubagentStart, handleSubagentStop, handlePostToolUse, dispatchHookEvent, parseUsageTag } from './hooks.js';
export type { SubagentStartEvent, SubagentStopEvent, PostToolUseEvent, HookEventType } from './hooks.js';
export { formatStatusline, getSessionStatusline, getLatestStatusline, formatAgentList } from './statusline.js';
export { renderTerminalReport, renderSessionList } from './terminal.js';
export { startWatch } from './watch.js';

// Config & i18n
export { loadConfig, saveConfig, getDefaultConfig } from './config.js';
export type { MonitorConfig, ColorName, ModelDisplay } from './config.js';
export { getTranslations, t } from './i18n/index.js';
export type { Translations } from './i18n/types.js';
export { assignColors, colorAnsi, colorBlock } from './colors.js';
export { runInit } from './init.js';
export { runConfigCommand } from './config-cli.js';
