/**
 * M5: Hook Event Handlers
 *
 * Processes Claude Code hook events for real-time agent monitoring.
 *
 * Supported hooks:
 * - SubagentStart: Agent creation → write state file (status: active)
 * - SubagentStop:  Agent termination → update state file (status: stopped)
 * - PostToolUse(Agent): Parse <usage> tag → update approx token counts
 *
 * All handlers MUST complete within 100ms (SubagentStart is synchronous).
 * File I/O only, no network calls.
 */

import { updateAgentState, cleanStoppedAgents, advanceTurn, readSessionState, readAgentState, atomicWriteFileSync } from './state.js';
import type { AgentState } from './state.js';
import { sanitizeDisplayString } from './sanitize.js';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Transcript Token Extractor ──

interface TranscriptTokens {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Extract token usage from a subagent transcript JSONL.
 * Sums up all assistant message usage fields (input_tokens, output_tokens,
 * cache_creation_input_tokens, cache_read_input_tokens).
 * Returns null on any failure (missing file, parse error, no usage data).
 */
function extractTokensFromTranscript(transcriptPath: string): TranscriptTokens | null {
  try {
    if (!existsSync(transcriptPath)) return null;
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n');

    let inputTokens = 0;
    let outputTokens = 0;
    let foundUsage = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (
        entry == null ||
        typeof entry !== 'object' ||
        (entry as Record<string, unknown>)['type'] !== 'assistant'
      ) continue;

      const msg = (entry as Record<string, unknown>)['message'];
      if (msg == null || typeof msg !== 'object') continue;
      const usage = (msg as Record<string, unknown>)['usage'];
      if (usage == null || typeof usage !== 'object') continue;

      const u = usage as Record<string, unknown>;
      const safeNum = (v: unknown): number => {
        const n = typeof v === 'number' ? v : 0;
        return Number.isFinite(n) && n >= 0 ? n : 0;
      };

      inputTokens += safeNum(u['input_tokens'])
        + safeNum(u['cache_creation_input_tokens'])
        + safeNum(u['cache_read_input_tokens']);
      outputTokens += safeNum(u['output_tokens']);
      foundUsage = true;
    }

    if (!foundUsage) return null;
    return {
      totalTokens: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
    };
  } catch {
    return null;
  }
}

// ── Hook Event Types (verified from actual Claude Code hook payloads) ──

export interface SubagentStartEvent {
  session_id: string;
  agent_id: string;
  agent_type?: string;       // "general-purpose", etc.
  hook_event_name: string;
  cwd?: string;
  transcript_path?: string;
}

export interface SubagentStopEvent {
  session_id: string;
  agent_id: string;
  agent_type?: string;
  last_assistant_message?: string;
  agent_transcript_path?: string;
  hook_event_name: string;
}

export interface PostToolUseEvent {
  session_id: string;
  tool_name: string;
  tool_input?: {
    description?: string;
    prompt?: string;
    subagent_type?: string;
    model?: string;
    run_in_background?: boolean;
  };
  tool_response?: {          // JSON object, not string
    agentId?: string;
    description?: string;
    prompt?: string;
    isAsync?: boolean;
    status?: string;
    // Synchronous agent results have text content instead
    [key: string]: unknown;
  } | string;
  hook_event_name: string;
}

// ── Usage Tag Parser ──

interface ParsedUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  toolUseCount: number;
  durationMs: number;
}

/**
 * Write a warning line to stderr (non-fatal, best-effort).
 * hook-entry.ts captures stderr in the debug log via the hook runner.
 * Used when usage parsing fails or returns unexpected values.
 */
function warnLog(message: string, detail?: unknown): void {
  try {
    process.stderr.write(
      `[claude-cli-monitor] WARN: ${message}${detail !== undefined ? ' ' + JSON.stringify(detail) : ''}\n`,
    );
  } catch { /* never crash the hook */ }
}

/**
 * Safely extract a non-negative integer from a regex match.
 * Returns 0 (and logs a warning) if the value is NaN or negative.
 */
function safeExtract(content: string, key: string): number {
  const m = content.match(new RegExp(`${key}\\s*[:=]\\s*([\\d.]+)`));
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 0) {
    warnLog(`<usage> tag: unexpected value for "${key}"`, m[1]);
    return 0;
  }
  return n;
}

/**
 * Parse <usage> XML-like tag from PostToolUse(Agent) tool_response.
 * This is best-effort — format may change without notice.
 * On parse failure, returns null and logs a debug warning.
 *
 * Example format:
 *   <usage>
 *     total_tokens: 12345
 *     input_tokens: 10000
 *     output_tokens: 2345
 *     tool_uses: 5
 *     duration_ms: 30000
 *   </usage>
 */
export function parseUsageTag(response: string): ParsedUsage | null {
  if (typeof response !== 'string') {
    warnLog('<usage> parse skipped: response is not a string', typeof response);
    return null;
  }

  let match: RegExpMatchArray | null = null;
  try {
    match = response.match(/<usage>([\s\S]*?)<\/usage>/);
  } catch (err) {
    warnLog('<usage> regex failed', String(err));
    return null;
  }

  if (!match) return null;

  const content = match[1];
  if (typeof content !== 'string') {
    warnLog('<usage> tag body missing or malformed');
    return null;
  }

  let result: ParsedUsage;
  try {
    result = {
      totalTokens: safeExtract(content, 'total_tokens'),
      inputTokens: safeExtract(content, 'input_tokens'),
      outputTokens: safeExtract(content, 'output_tokens'),
      toolUseCount: safeExtract(content, 'tool_uses') || safeExtract(content, 'tool_use_count'),
      durationMs: safeExtract(content, 'duration_ms'),
    };
  } catch (err) {
    warnLog('<usage> field extraction failed', String(err));
    return null;
  }

  // If totalTokens is 0 but we have input/output, sum them
  if (result.totalTokens === 0 && (result.inputTokens > 0 || result.outputTokens > 0)) {
    result.totalTokens = result.inputTokens + result.outputTokens;
  }

  if (result.totalTokens === 0 && result.toolUseCount === 0) {
    warnLog('<usage> tag found but all token fields are 0 or missing — format may have changed', content.slice(0, 200));
    return null;
  }

  return result;
}

// ── Event Handlers ──

export function handleSubagentStart(event: SubagentStartEvent): AgentState {
  // SubagentStart only has agent_id and agent_type.
  // description/model come from PostToolUse which fires around the same time.
  return updateAgentState(event.session_id, event.agent_id, {
    status: 'active',
    subagentType: event.agent_type != null ? sanitizeDisplayString(event.agent_type) : null,
    startedAt: new Date().toISOString(),
  });
}

export function handleSubagentStop(event: SubagentStopEvent): AgentState {
  // Update state for the reported session only.
  // No cross-session scanning — that was the root cause of the cross-session
  // agent display bug. If the agent isn't found in event.session_id, we still
  // create/update it there. The Stop handler's force-stop logic handles orphaned
  // agents from aborted sessions.
  const updates: Partial<AgentState> = {
    status: 'stopped',
    stoppedAt: new Date().toISOString(),
  };
  if (event.last_assistant_message) {
    updates.lastAssistantMessage = sanitizeDisplayString(event.last_assistant_message);
  }

  // For background agents, PostToolUse may not carry token data.
  // Parse agent_transcript_path to fill in token counts if not already set.
  if (event.agent_transcript_path) {
    const transcriptTokens = extractTokensFromTranscript(event.agent_transcript_path);
    if (transcriptTokens !== null && transcriptTokens.totalTokens > 0) {
      // Only fill if approxTokens is not already populated by PostToolUse.
      const existing = readAgentState(event.session_id, event.agent_id);
      if (!existing || existing.approxTokens === 0) {
        updates.approxTokens = transcriptTokens.totalTokens;
        updates.approxInputTokens = transcriptTokens.inputTokens;
        updates.approxOutputTokens = transcriptTokens.outputTokens;
      }
    }
  }

  return updateAgentState(event.session_id, event.agent_id, updates);
}

/**
 * Handle PostToolUse for Agent tool.
 *
 * PostToolUse fires with tool_input (description, model, prompt) and
 * tool_response (agentId as JSON object, not string).
 * This is the primary source for description/model enrichment.
 */
export function handlePostToolUse(event: PostToolUseEvent): AgentState | null {
  if (event.tool_name !== 'Agent') return null;

  const resp = event.tool_response;
  if (!resp) return null;

  // tool_response is a JSON object with agentId
  let agentId: string | null = null;
  if (typeof resp === 'object' && resp.agentId) {
    agentId = resp.agentId;

    // Synchronous agent completion: tool_response includes token data inline
    if (resp.totalTokens) {
      const rawTokens = resp.totalTokens;
      const totalTokens = typeof rawTokens === 'number' && Number.isFinite(rawTokens) && rawTokens >= 0
        ? rawTokens
        : 0;
      if (totalTokens === 0 && rawTokens !== 0) {
        warnLog('PostToolUse: resp.totalTokens is not a valid number — falling back to 0', rawTokens);
      }

      const rawUsage = resp.usage;
      const usage = rawUsage != null && typeof rawUsage === 'object' && !Array.isArray(rawUsage)
        ? (rawUsage as Record<string, unknown>)
        : undefined;
      if (rawUsage != null && usage === undefined) {
        warnLog('PostToolUse: resp.usage is not an object — skipping token breakdown', typeof rawUsage);
      }

      const safeNum = (v: unknown): number => {
        const n = typeof v === 'number' ? v : 0;
        return Number.isFinite(n) && n >= 0 ? n : 0;
      };

      const enrichment: Partial<AgentState> = {
        description: event.tool_input?.description != null ? sanitizeDisplayString(event.tool_input.description) : null,
        model: event.tool_input?.model != null ? sanitizeDisplayString(event.tool_input.model) : null,
        approxTokens: totalTokens,
        approxInputTokens: usage
          ? (safeNum(usage['input_tokens']) + safeNum(usage['cache_creation_input_tokens']) + safeNum(usage['cache_read_input_tokens']))
          : 0,
        approxOutputTokens: usage ? safeNum(usage['output_tokens']) : 0,
        toolUseCount: safeNum(resp.totalToolUseCount),
        durationMs: typeof resp.totalDurationMs === 'number' && Number.isFinite(resp.totalDurationMs) && resp.totalDurationMs > 0
          ? resp.totalDurationMs
          : undefined,
      };
      if (event.tool_input?.subagent_type) {
        enrichment.subagentType = sanitizeDisplayString(event.tool_input.subagent_type);
      }
      if (event.tool_input?.run_in_background != null) {
        enrichment.isBackground = !!event.tool_input.run_in_background;
      }
      return updateAgentState(event.session_id, agentId, enrichment);
    }
  } else if (typeof resp === 'string') {
    // Fallback: try parsing as string (for sync agent results with <usage> tag)
    const idMatch = resp.match(/agentId['":\s]+([a-f0-9]+)/i);
    if (idMatch) agentId = idMatch[1];

    // Try <usage> tag parsing for completed sync agents
    const usage = parseUsageTag(resp);
    if (usage && agentId) {
      const usageUpdate: Partial<AgentState> = {
        description: event.tool_input?.description != null ? sanitizeDisplayString(event.tool_input.description) : null,
        model: event.tool_input?.model != null ? sanitizeDisplayString(event.tool_input.model) : null,
        approxTokens: usage.totalTokens,
        approxInputTokens: usage.inputTokens,
        approxOutputTokens: usage.outputTokens,
        toolUseCount: usage.toolUseCount,
        durationMs: usage.durationMs > 0 ? usage.durationMs : undefined,
      };
      if (event.tool_input?.subagent_type) {
        usageUpdate.subagentType = sanitizeDisplayString(event.tool_input.subagent_type);
      }
      if (event.tool_input?.run_in_background != null) {
        usageUpdate.isBackground = !!event.tool_input.run_in_background;
      }
      return updateAgentState(event.session_id, agentId, usageUpdate);
    }
  }

  if (!agentId) return null;

  // Enrich agent state with description/model from tool_input.
  // Only update subagentType if PostToolUse provides it — custom agents
  // don't include subagent_type in tool_input, so we must not overwrite
  // the value already set by SubagentStart (e.g. "general-purpose").
  const enrichment: Partial<AgentState> = {
    description: event.tool_input?.description != null ? sanitizeDisplayString(event.tool_input.description) : null,
    model: event.tool_input?.model != null ? sanitizeDisplayString(event.tool_input.model) : null,
  };
  if (event.tool_input?.subagent_type) {
    enrichment.subagentType = sanitizeDisplayString(event.tool_input.subagent_type);
  }
  if (event.tool_input?.run_in_background != null) {
    enrichment.isBackground = !!event.tool_input.run_in_background;
  }
  return updateAgentState(event.session_id, agentId, enrichment);
}

// ── UserPromptSubmit Handler ──

export interface UserPromptSubmitEvent {
  session_id: string;
  hook_event_name: string;
  prompt?: string;
}

/**
 * Clean up completed agents from previous turns when a new user message starts.
 * First advances the turn counter, then removes stopped agents from prior turns.
 * Agents that completed in the previous turn are now safe to remove because
 * the user has already seen them in the statusline.
 *
 * Skip: <task-notification> prompts are background system events fired when
 * async agents complete. They must not advance the turn counter or trigger
 * cleanup — doing so would prematurely delete agents before the user sees them.
 */
export function handleUserPromptSubmit(event: UserPromptSubmitEvent): number {
  if (event.prompt?.trimStart().startsWith('<task-notification>')) {
    return 0;
  }
  advanceTurn(event.session_id);
  return cleanStoppedAgents(event.session_id);
}

// ── Stop Handler (Session End) ──

export interface StopEvent {
  session_id: string;
  hook_event_name: string;
}

/**
 * On session end, auto-save a session report if config.report.autoSave is true.
 * Report: ~/.claude-cli-monitor/reports/session-{id}-{date}.md
 *
 * Fix 2: Force-stop any active agents in this session.
 * Abort/kill scenarios leave active agents with no SubagentStop.
 */
export function handleStop(event: StopEvent): string | null {
  // Fix 2: Force-stop active agents that were not stopped normally
  const sessionState = readSessionState(event.session_id);
  const now = new Date().toISOString();
  for (const agent of sessionState.agents) {
    if (agent.status === 'active') {
      updateAgentState(event.session_id, agent.agentId, {
        status: 'stopped',
        stoppedAt: now,
      });
    }
  }

  // Check config
  const home = homedir();
  const configPath = join(home, '.claude-cli-monitor', 'config.json');
  let autoSave = false;
  try {
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
      autoSave = cfg?.report?.autoSave === true;
    }
  } catch { /* ignore */ }

  // GC: remove state directories older than 7 days (except current session)
  try {
    const stateBase = join(home, '.claude-cli-monitor', 'state');
    if (existsSync(stateBase)) {
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const dirs = readdirSync(stateBase, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const dir of dirs) {
        if (dir.name === event.session_id) continue; // skip current session
        const dirPath = join(stateBase, dir.name);
        try {
          const stat = statSync(dirPath);
          if (nowMs - stat.mtimeMs > SEVEN_DAYS_MS) {
            rmSync(dirPath, { recursive: true, force: true });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* GC failure is non-fatal */ }

  if (!autoSave) return null;

  const state = readSessionState(event.session_id);
  if (state.totalCount === 0) return null;

  const reportsDir = join(home, '.claude-cli-monitor', 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const shortId = event.session_id.slice(0, 8);
  const filePath = join(reportsDir, `session-${shortId}-${date}.md`);

  const lines: string[] = [
    `# Session Report`,
    ``,
    `- **Session**: ${event.session_id}`,
    `- **Date**: ${new Date().toISOString()}`,
    `- **Agents**: ${state.totalCount}`,
    `- **Total tokens**: ~${state.totalApproxTokens.toLocaleString()}`,
    ``,
    `## Agents`,
    ``,
    `| # | Agent | Model | Task | Used | Duration |`,
    `|---|-------|-------|------|------|----------|`,
  ];

  for (let i = 0; i < state.agents.length; i++) {
    const a = state.agents[i];
    const dur = a.stoppedAt && a.startedAt
      ? `${Math.round((new Date(a.stoppedAt).getTime() - new Date(a.startedAt).getTime()) / 1000)}s`
      : '-';
    const esc = (s: string | null) => s ? s.replace(/\|/g, '\\|') : '-';
    lines.push(`| ${i + 1} | ${esc(a.subagentType)} | ${esc(a.model)} | ${esc(a.description)} | ${a.approxTokens.toLocaleString()} | ${dur} |`);
  }

  lines.push('');
  atomicWriteFileSync(filePath, lines.join('\n') + '\n');
  return filePath;
}

// ── Dispatcher ──

export type HookEventType = 'SubagentStart' | 'SubagentStop' | 'PostToolUse' | 'UserPromptSubmit' | 'Stop';

export function dispatchHookEvent(eventType: HookEventType, payload: unknown): AgentState | number | string | null {
  switch (eventType) {
    case 'SubagentStart':
      return handleSubagentStart(payload as SubagentStartEvent);
    case 'SubagentStop':
      return handleSubagentStop(payload as SubagentStopEvent);
    case 'PostToolUse':
      return handlePostToolUse(payload as PostToolUseEvent);
    case 'UserPromptSubmit':
      return handleUserPromptSubmit(payload as UserPromptSubmitEvent);
    case 'Stop':
      return handleStop(payload as StopEvent);
    default:
      return null;
  }
}
