/**
 * M1: Transcript JSONL Parser
 *
 * Parses Claude Code transcript JSONL files to extract agent tool use results,
 * token usage, and chain relationships.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type {
  TranscriptMessage,
  AgentNode,
  ToolUseResult,
  ContentBlock,
  TokenUsage,
} from './types.js';

interface AgentSpawnInfo {
  agentId: string;
  subagentType: string | null;
  model: string | null;
  description: string | null;
  prompt: string | null;
  parentAssistantUUID: string;
}

interface AgentResultInfo {
  agentId: string;
  toolUseResult: ToolUseResult;
  sourceToolAssistantUUID: string;
}

/**
 * Parse a single JSONL file into transcript messages.
 */
export function parseJsonl(filePath: string): TranscriptMessage[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  const messages: TranscriptMessage[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines
    }
  }
  return messages;
}

/**
 * Extract agent spawn events from assistant messages (tool_use with name="Agent").
 */
function extractAgentSpawns(messages: TranscriptMessage[]): Map<string, AgentSpawnInfo> {
  const spawns = new Map<string, AgentSpawnInfo>();

  // Build index: assistantUUID → Agent tool_use blocks in that message
  const agentBlocksByAssistantUUID = new Map<string, Array<{ block: ContentBlock; uuid: string }>>();
  for (const msg of messages) {
    if (msg.type !== 'assistant' || !msg.message?.content) continue;
    for (const block of msg.message.content) {
      if (block.type === 'tool_use' && block.name === 'Agent' && block.id) {
        let arr = agentBlocksByAssistantUUID.get(msg.uuid);
        if (!arr) {
          arr = [];
          agentBlocksByAssistantUUID.set(msg.uuid, arr);
        }
        arr.push({ block, uuid: msg.uuid });
      }
    }
  }

  // Pass 1: collect progress events that link agentId to parentToolUseID
  const agentIdByToolUseId = new Map<string, string>();
  for (const msg of messages) {
    if (msg.type === 'progress' && msg.data?.type === 'agent_progress' && msg.data.agentId) {
      const raw = msg as unknown as Record<string, unknown>;
      const parentToolUseID = raw['parentToolUseID'] as string | undefined;
      if (parentToolUseID) {
        agentIdByToolUseId.set(parentToolUseID, msg.data.agentId);
      }
    }
  }

  // Pass 2: match Agent tool_use blocks via progress events (original method)
  for (const [uuid, blocks] of agentBlocksByAssistantUUID) {
    for (const { block } of blocks) {
      const agentId = agentIdByToolUseId.get(block.id!);
      if (!agentId) continue;
      spawns.set(agentId, {
        agentId,
        subagentType: block.input?.subagent_type ?? null,
        model: block.input?.model ?? null,
        description: block.input?.description ?? null,
        prompt: block.input?.prompt ?? null,
        parentAssistantUUID: uuid,
      });
    }
  }

  // Pass 3: backfill from toolUseResult.sourceToolAssistantUUID
  // When progress events are absent, we can still match: result's sourceToolAssistantUUID
  // points to the assistant message that contains the Agent tool_use block.
  // If that message has only one Agent block, it's a direct match.
  // If multiple, we match by order of appearance vs order of results.
  const resultsByAssistantUUID = new Map<string, Array<{ agentId: string; index: number }>>();
  let resultIdx = 0;
  for (const msg of messages) {
    if (msg.toolUseResult?.agentId && msg.sourceToolAssistantUUID) {
      const key = msg.sourceToolAssistantUUID;
      let arr = resultsByAssistantUUID.get(key);
      if (!arr) {
        arr = [];
        resultsByAssistantUUID.set(key, arr);
      }
      arr.push({ agentId: msg.toolUseResult.agentId, index: resultIdx++ });
    }
  }

  for (const [assistantUUID, results] of resultsByAssistantUUID) {
    const blocks = agentBlocksByAssistantUUID.get(assistantUUID);
    if (!blocks) continue;

    for (let i = 0; i < results.length; i++) {
      const { agentId } = results[i];
      if (spawns.has(agentId)) continue; // already matched via progress

      // Match by position: i-th result corresponds to i-th Agent block
      const blockEntry = blocks[i];
      if (!blockEntry) continue;

      spawns.set(agentId, {
        agentId,
        subagentType: blockEntry.block.input?.subagent_type ?? null,
        model: blockEntry.block.input?.model ?? null,
        description: blockEntry.block.input?.description ?? null,
        prompt: blockEntry.block.input?.prompt ?? null,
        parentAssistantUUID: assistantUUID,
      });
    }
  }

  return spawns;
}

/**
 * Extract agent results from tool_result messages that contain toolUseResult.
 */
function extractAgentResults(messages: TranscriptMessage[]): AgentResultInfo[] {
  const results: AgentResultInfo[] = [];

  for (const msg of messages) {
    if (!msg.toolUseResult || !msg.sourceToolAssistantUUID) continue;

    results.push({
      agentId: msg.toolUseResult.agentId,
      toolUseResult: msg.toolUseResult,
      sourceToolAssistantUUID: msg.sourceToolAssistantUUID,
    });
  }

  return results;
}

/**
 * Extract the main model used in the session from the first assistant message.
 */
function extractMainModel(messages: TranscriptMessage[]): string | null {
  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.message?.model) {
      return msg.message.model;
    }
  }
  return null;
}

/**
 * Extract main session token usage (non-agent assistant messages).
 */
function extractMainTokenUsage(messages: TranscriptMessage[]): TokenUsage {
  const total: TokenUsage = { input_tokens: 0, output_tokens: 0 };

  for (const msg of messages) {
    if (msg.type !== 'assistant' || !msg.message?.usage) continue;
    const u = msg.message.usage;
    total.input_tokens += safeTokenNum(u.input_tokens);
    total.output_tokens += safeTokenNum(u.output_tokens);
    total.cache_creation_input_tokens = (total.cache_creation_input_tokens ?? 0) + safeTokenNum(u.cache_creation_input_tokens);
    total.cache_read_input_tokens = (total.cache_read_input_tokens ?? 0) + safeTokenNum(u.cache_read_input_tokens);
  }

  return total;
}

/**
 * Safely coerce a value to a non-negative finite number, falling back to 0.
 * Prevents NaN/Infinity from propagating into AgentNode fields when the
 * <usage> tag format changes or a field is missing/malformed.
 */
function safeTokenNum(v: unknown): number {
  if (typeof v !== 'number') return 0;
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Build an AgentNode from spawn info + result info.
 */
function buildAgentNode(
  agentId: string,
  spawn: AgentSpawnInfo | undefined,
  result: AgentResultInfo | undefined,
): AgentNode {
  const tr = result?.toolUseResult;
  const usage = tr?.usage;

  return {
    agentId,
    parentAgentId: null, // resolved later in chain builder
    parentAssistantUUID: spawn?.parentAssistantUUID ?? result?.sourceToolAssistantUUID ?? null,
    subagentType: spawn?.subagentType ?? null,
    model: spawn?.model ?? null,
    description: spawn?.description ?? null,
    prompt: spawn?.prompt ?? tr?.prompt ?? null,
    status: tr?.status ?? 'unknown',
    totalTokens: safeTokenNum(tr?.totalTokens),
    inputTokens: safeTokenNum(usage?.input_tokens),
    outputTokens: safeTokenNum(usage?.output_tokens),
    cacheCreationTokens: safeTokenNum(usage?.cache_creation_input_tokens),
    cacheReadTokens: safeTokenNum(usage?.cache_read_input_tokens),
    totalDurationMs: safeTokenNum(tr?.totalDurationMs),
    toolUseCount: safeTokenNum(tr?.totalToolUseCount),
    children: [],
    depth: 0,
  };
}

/**
 * Parse a session directory: main transcript + subagent transcripts.
 * Returns flat list of AgentNodes (chain not yet resolved).
 */
export function parseSession(sessionJsonlPath: string): {
  messages: TranscriptMessage[];
  agents: Map<string, AgentNode>;
  mainModel: string | null;
  mainUsage: TokenUsage;
} {
  const messages = parseJsonl(sessionJsonlPath);
  const spawns = extractAgentSpawns(messages);
  const results = extractAgentResults(messages);

  // Merge spawns and results
  const allAgentIds = new Set<string>();
  for (const s of spawns.values()) allAgentIds.add(s.agentId);
  for (const r of results) allAgentIds.add(r.agentId);

  const agents = new Map<string, AgentNode>();
  for (const agentId of allAgentIds) {
    if (!agentId) continue; // Skip undefined/null agentIds
    const spawn = spawns.get(agentId);
    const result = results.find(r => r.agentId === agentId);
    agents.set(agentId, buildAgentNode(agentId, spawn, result));
  }

  // Check for subagent directory and parse nested agents
  const sessionDir = sessionJsonlPath.replace(/\.jsonl$/, '');
  const subagentsDir = join(sessionDir, 'subagents');

  if (existsSync(subagentsDir)) {
    const subFiles = readdirSync(subagentsDir)
      .filter(f => f.endsWith('.jsonl') && !f.includes('compact'));
    for (const subFile of subFiles) {
      const subPath = join(subagentsDir, subFile);
      const subMessages = parseJsonl(subPath);
      const subSpawns = extractAgentSpawns(subMessages);
      const subResults = extractAgentResults(subMessages);

      // Only add nested agents that have actual results (token data)
      for (const sr of subResults) {
        if (!agents.has(sr.agentId) && sr.agentId) {
          const subSpawn = subSpawns.get(sr.agentId);
          agents.set(sr.agentId, buildAgentNode(sr.agentId, subSpawn, sr));
        }
      }
    }
  }

  return {
    messages,
    agents,
    mainModel: extractMainModel(messages),
    mainUsage: extractMainTokenUsage(messages),
  };
}

/**
 * Find all session JSONL files in a Claude projects directory.
 */
export function findSessionFiles(projectDir: string): string[] {
  if (!existsSync(projectDir)) return [];

  const files: string[] = [];
  const entries = readdirSync(projectDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent-')) {
      files.push(join(projectDir, entry.name));
    }
  }

  return files.sort();
}

/**
 * Find the Claude projects base directory.
 */
export function findClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}
