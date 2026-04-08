/**
 * M2: Agent Chain Reconstruction Engine
 *
 * Builds parent-child relationships between agents using sourceToolAssistantUUID
 * and subagent directory structure. Produces a tree of AgentNodes.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { AgentNode, TranscriptMessage } from './types.js';
import { parseJsonl } from './parser.js';

/**
 * Build a map: assistantUUID -> agentId
 * This tells us "which agent produced this assistant message?"
 *
 * For the main session, assistant messages belong to the "main" agent.
 * For subagent transcripts, we can determine the agent from the filename.
 */
function buildAssistantToAgentMap(
  sessionJsonlPath: string,
  mainMessages: TranscriptMessage[],
): Map<string, string> {
  const map = new Map<string, string>();

  // Main session assistant messages belong to "main"
  for (const msg of mainMessages) {
    if (msg.type === 'assistant') {
      map.set(msg.uuid, '__main__');
    }
  }

  // Subagent transcripts: filename is agent-{agentId}.jsonl
  const sessionDir = sessionJsonlPath.replace(/\.jsonl$/, '');
  const subagentsDir = join(sessionDir, 'subagents');

  if (existsSync(subagentsDir)) {
    const subFiles = readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl') && !f.includes('compact'));
    for (const subFile of subFiles) {
      // Extract agentId from filename: "agent-a42384712ff4eda9b.jsonl"
      const match = subFile.match(/^agent-(.+)\.jsonl$/);
      if (!match) continue;
      const fileAgentId = match[1];

      const subPath = join(subagentsDir, subFile);
      const subMessages = parseJsonl(subPath);

      for (const msg of subMessages) {
        if (msg.type === 'assistant') {
          map.set(msg.uuid, fileAgentId);
        }
      }
    }
  }

  return map;
}

/**
 * Resolve parent-child relationships and build the agent tree.
 *
 * Logic:
 * 1. Each agent has a sourceToolAssistantUUID (or parentAssistantUUID)
 *    pointing to the assistant message that spawned it.
 * 2. We look up which agent "owns" that assistant message.
 * 3. That agent is the parent.
 */
export function buildAgentTree(
  sessionJsonlPath: string,
  mainMessages: TranscriptMessage[],
  agents: Map<string, AgentNode>,
): AgentNode[] {
  const assistantToAgent = buildAssistantToAgentMap(sessionJsonlPath, mainMessages);

  // Resolve parent for each agent
  for (const [agentId, node] of agents) {
    if (!node.parentAssistantUUID) continue;

    const parentAgentId = assistantToAgent.get(node.parentAssistantUUID);
    if (parentAgentId && parentAgentId !== '__main__') {
      node.parentAgentId = parentAgentId;
    }
    // If parentAgentId is '__main__', it's a top-level agent (depth 1)
  }

  // Build tree: add children
  const rootAgents: AgentNode[] = [];

  for (const [agentId, node] of agents) {
    if (node.parentAgentId) {
      const parent = agents.get(node.parentAgentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent not found, treat as root
        rootAgents.push(node);
      }
    } else {
      rootAgents.push(node);
    }
  }

  // Assign depths (with circular reference protection)
  function assignDepth(node: AgentNode, depth: number, visited = new Set<string>()): void {
    if (visited.has(node.agentId)) return;
    visited.add(node.agentId);
    node.depth = depth;
    for (const child of node.children) {
      assignDepth(child, depth + 1, visited);
    }
  }

  for (const root of rootAgents) {
    assignDepth(root, 1);
  }

  // Sort children by agentId for deterministic output
  function sortChildren(node: AgentNode): void {
    node.children.sort((a, b) => (a.agentId ?? '').localeCompare(b.agentId ?? ''));
    for (const child of node.children) {
      sortChildren(child);
    }
  }

  rootAgents.sort((a, b) => (a.agentId ?? '').localeCompare(b.agentId ?? ''));
  for (const root of rootAgents) {
    sortChildren(root);
  }

  return rootAgents;
}

/**
 * Calculate the maximum depth of the agent tree.
 */
export function getMaxDepth(roots: AgentNode[]): number {
  let max = 0;
  function walk(node: AgentNode): void {
    if (node.depth > max) max = node.depth;
    for (const child of node.children) walk(child);
  }
  for (const root of roots) walk(root);
  return max;
}

/**
 * Count total agents in the tree (including nested).
 */
export function countAgents(roots: AgentNode[]): number {
  let count = 0;
  function walk(node: AgentNode): void {
    count++;
    for (const child of node.children) walk(child);
  }
  for (const root of roots) walk(root);
  return count;
}

/**
 * Filter out agents with 0 tokens (incomplete/cancelled/failed).
 */
export function filterEmptyAgents(roots: AgentNode[]): AgentNode[] {
  function filterNode(node: AgentNode): AgentNode | null {
    const filteredChildren = node.children
      .map(filterNode)
      .filter((n): n is AgentNode => n !== null);

    if (node.totalTokens === 0 && filteredChildren.length === 0) {
      return null;
    }

    return { ...node, children: filteredChildren };
  }

  return roots
    .map(filterNode)
    .filter((n): n is AgentNode => n !== null);
}

/**
 * Flatten the tree into a list (pre-order traversal).
 */
export function flattenTree(roots: AgentNode[]): AgentNode[] {
  const result: AgentNode[] = [];
  const visited = new Set<string>();
  function walk(node: AgentNode): void {
    if (visited.has(node.agentId)) return;
    visited.add(node.agentId);
    result.push(node);
    for (const child of node.children) walk(child);
  }
  for (const root of roots) walk(root);
  return result;
}
