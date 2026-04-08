/**
 * M4: Agent State File Manager
 *
 * Manages per-agent state files for real-time monitoring.
 * State directory: ~/.claude-cli-monitor/state/{sessionId}/
 * Each agent gets its own file: agent-{agentId}.json
 *
 * Design constraints (from feasibility):
 * - Per-agent individual files to avoid write contention with background agents
 * - File I/O only, no network calls
 * - All operations must complete within 100ms
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

export function atomicWriteFileSync(targetPath: string, data: string): void {
  const tmpPath = targetPath + '.tmp-' + randomBytes(4).toString('hex');
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, targetPath);
}

// ── Types ──

export interface AgentState {
  agentId: string;
  sessionId: string;
  status: 'active' | 'stopped' | 'unknown';
  subagentType: string | null;
  model: string | null;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  /** Best-effort token count from PostToolUse <usage> parsing */
  approxTokens: number;
  approxInputTokens: number;
  approxOutputTokens: number;
  toolUseCount: number;
  lastUpdated: string;
  /** Turn number when this agent was created (for cleanup scoping) */
  turnNumber?: number;
  /** Total execution duration in ms from PostToolUse totalDurationMs (foreground agents only) */
  durationMs?: number;
  /** Whether this agent was launched with run_in_background */
  isBackground?: boolean;
  /** Last assistant message from the agent (captured at SubagentStop) */
  lastAssistantMessage?: string;
}

/** Threshold (ms) after which a non-updated active agent is considered stale */
export const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Returns true if the agent is active but lastUpdated is older than STALE_THRESHOLD_MS.
 * Stale agents are likely aborted/killed agents whose SubagentStop was never fired.
 */
export function isStaleAgent(agent: AgentState, thresholdMs?: number): boolean {
  if (agent.status !== 'active') return false;
  const last = new Date(agent.lastUpdated).getTime();
  return Date.now() - last > (thresholdMs ?? STALE_THRESHOLD_MS);
}

export interface SessionState {
  sessionId: string;
  agents: AgentState[];
  activeCount: number;
  totalCount: number;
  totalApproxTokens: number;
  /** Current turn number (from turn-marker.json). 0 or 1 = new session start */
  currentTurn: number;
}

// ── Paths ──

function validateAgentId(agentId: string): void {
  if (!agentId || agentId.length > 100 || !/^[a-f0-9]+$/.test(agentId)) {
    throw new Error(`Invalid agentId: ${agentId}`);
  }
}

function validateSessionId(sessionId: string): void {
  if (!sessionId || sessionId.length > 100 || !/^[a-f0-9-]+$/.test(sessionId)) {
    throw new Error(`Invalid sessionId: ${sessionId}`);
  }
}

export function getStateBaseDir(): string {
  return join(homedir(), '.claude-cli-monitor', 'state');
}

export function getSessionStateDir(sessionId: string): string {
  validateSessionId(sessionId);
  return join(getStateBaseDir(), sessionId);
}

function getAgentStatePath(sessionId: string, agentId: string): string {
  validateAgentId(agentId);
  return join(getSessionStateDir(sessionId), `agent-${agentId}.json`);
}

// ── Backward-compat mirror (legacy .claude-agent-monitor) ──
//
// User-requested compatibility for installs that still have the legacy
// ~/.claude-agent-monitor/state/ directory from before the rename to
// claude-cli-monitor. State writes and deletes are mirrored there only when
// the legacy directory already exists; reads remain canonical
// (.claude-cli-monitor). Mirror failures are silently ignored — they must
// never break the canonical write path.

const LEGACY_MIRROR_BASE = '.claude-agent-monitor';

function getMirrorSessionDir(sessionId: string): string | null {
  const base = join(homedir(), LEGACY_MIRROR_BASE, 'state');
  if (!existsSync(base)) return null;
  validateSessionId(sessionId);
  return join(base, sessionId);
}

// ── Turn Tracking ──

/**
 * Read the current turn number for a session.
 * Returns 0 if no turn marker exists.
 */
export function getCurrentTurn(sessionId: string): number {
  const dir = getSessionStateDir(sessionId);
  const markerPath = join(dir, 'turn-marker.json');
  if (!existsSync(markerPath)) return 0;
  try {
    const data = JSON.parse(readFileSync(markerPath, 'utf-8'));
    return data.turnNumber ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Advance the turn number for a session.
 * Called on UserPromptSubmit to mark a new utterance boundary.
 */
export function advanceTurn(sessionId: string): number {
  const dir = getSessionStateDir(sessionId);
  ensureDir(dir);
  const markerPath = join(dir, 'turn-marker.json');
  const current = getCurrentTurn(sessionId);
  const next = current + 1;
  const data = JSON.stringify({ turnNumber: next, advancedAt: new Date().toISOString() });
  atomicWriteFileSync(markerPath, data);

  const mirrorDir = getMirrorSessionDir(sessionId);
  if (mirrorDir) {
    try {
      ensureDir(mirrorDir);
      atomicWriteFileSync(join(mirrorDir, 'turn-marker.json'), data);
    } catch {
      // Mirror failure must not break the canonical write path.
    }
  }

  return next;
}

// ── Write Operations ──

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function writeAgentState(state: AgentState): void {
  const dir = getSessionStateDir(state.sessionId);
  ensureDir(dir);
  const filePath = getAgentStatePath(state.sessionId, state.agentId);
  const data = JSON.stringify(state, null, 2);
  atomicWriteFileSync(filePath, data);

  const mirrorDir = getMirrorSessionDir(state.sessionId);
  if (mirrorDir) {
    try {
      ensureDir(mirrorDir);
      atomicWriteFileSync(join(mirrorDir, `agent-${state.agentId}.json`), data);
    } catch {
      // Mirror failure must not break the canonical write path.
    }
  }
}

export function updateAgentState(
  sessionId: string,
  agentId: string,
  updates: Partial<AgentState>,
): AgentState {
  const existing = readAgentState(sessionId, agentId);
  const now = new Date().toISOString();
  const turn = getCurrentTurn(sessionId);
  const base: AgentState = {
    agentId,
    sessionId,
    status: 'unknown',
    subagentType: null,
    model: null,
    description: null,
    startedAt: now,
    stoppedAt: null,
    approxTokens: 0,
    approxInputTokens: 0,
    approxOutputTokens: 0,
    toolUseCount: 0,
    lastUpdated: now,
    turnNumber: turn,
    ...existing,
    ...updates,
  };
  base.lastUpdated = now;
  // Only stamp turnNumber on first creation (don't overwrite on subsequent updates)
  if (!existing) {
    base.turnNumber = turn;
  }
  const merged = base;
  writeAgentState(merged);
  return merged;
}

// ── Read Operations ──

export function readAgentState(sessionId: string, agentId: string): AgentState | null {
  const filePath = getAgentStatePath(sessionId, agentId);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function readSessionState(sessionId: string): SessionState {
  const dir = getSessionStateDir(sessionId);
  const agents: AgentState[] = [];

  if (existsSync(dir)) {
    const files = readdirSync(dir).filter(f => f.startsWith('agent-') && f.endsWith('.json'));
    for (const file of files) {
      try {
        const state: AgentState = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
        agents.push(state);
      } catch {
        // Skip corrupted files
      }
    }
  }

  // Sort by startedAt for deterministic output
  agents.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const activeCount = agents.filter(a => a.status === 'active').length;

  return {
    sessionId,
    agents,
    activeCount,
    totalCount: agents.length,
    totalApproxTokens: agents.reduce((sum, a) => sum + a.approxTokens, 0),
    currentTurn: getCurrentTurn(sessionId),
  };
}

/**
 * Read state for the most recently active session.
 * Finds the session directory with the newest modification time.
 */
export function readLatestSessionState(): SessionState | null {
  const baseDir = getStateBaseDir();
  if (!existsSync(baseDir)) return null;

  const dirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({
      name: d.name,
      path: join(baseDir, d.name),
    }));

  if (dirs.length === 0) return null;

  // Find the directory with the most recently modified file
  let latest: { name: string; mtime: number } | null = null;

  for (const dir of dirs) {
    const files = readdirSync(dir.path).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const stat = statSync(join(dir.path, file));
        if (!latest || stat.mtimeMs > latest.mtime) {
          latest = { name: dir.name, mtime: stat.mtimeMs };
        }
      } catch { /* skip */ }
    }
  }

  if (!latest) return null;
  return readSessionState(latest.name);
}

/**
 * Remove completed (stopped) agent state files from previous turns.
 * Called on UserPromptSubmit AFTER advanceTurn() — so the current turn
 * number has already been incremented. Agents whose turnNumber < currentTurn
 * are from a previous utterance and safe to remove.
 *
 * Agents that stopped in the current turn are preserved so the statusline
 * can display them as "✓ done(Ns)" until the next user prompt.
 */
export function cleanStoppedAgents(sessionId: string): number {
  const dir = getSessionStateDir(sessionId);
  let removed = 0;
  if (!existsSync(dir)) return removed;

  const currentTurn = getCurrentTurn(sessionId);
  const mirrorDir = getMirrorSessionDir(sessionId);

  const files = readdirSync(dir).filter(f => f.startsWith('agent-') && f.endsWith('.json'));
  for (const file of files) {
    try {
      const state: AgentState = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      // Only remove stopped agents from previous turns.
      // Agents from the current turn (or with no turnNumber for backward compat)
      // are kept so they remain visible in the statusline.
      const agentTurn = state.turnNumber ?? 0;
      if (state.status === 'stopped' && agentTurn < currentTurn) {
        unlinkSync(join(dir, file));
        removed++;
        if (mirrorDir) {
          try { unlinkSync(join(mirrorDir, file)); } catch { /* ignore mirror */ }
        }
      }
    } catch {
      // Corrupted file — remove the canonical only. The mirror is left alone
      // because we don't actually know if it's also corrupted (the parse may
      // have failed for transient reasons), and the mirror is supposed to
      // shadow canonical, not second-guess it. The next legitimate clean pass
      // will reach the mirror file via the normal stopped-agent branch.
      try { unlinkSync(join(dir, file)); } catch { /* ignore */ }
    }
  }
  return removed;
}

/**
 * Remove all agent state files for a session (active + stopped).
 * Called on context clear.
 */
export function cleanAllAgents(sessionId: string): number {
  const dir = getSessionStateDir(sessionId);
  let removed = 0;
  if (!existsSync(dir)) return removed;

  const mirrorDir = getMirrorSessionDir(sessionId);

  const files = readdirSync(dir).filter(f => f.startsWith('agent-') && f.endsWith('.json'));
  for (const file of files) {
    try { unlinkSync(join(dir, file)); removed++; } catch { /* ignore */ }
    if (mirrorDir) {
      try { unlinkSync(join(mirrorDir, file)); } catch { /* ignore mirror */ }
    }
  }
  return removed;
}

// ── Cleanup ──

export function cleanSessionState(sessionId: string): void {
  const dir = getSessionStateDir(sessionId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }

  const mirrorDir = getMirrorSessionDir(sessionId);
  if (mirrorDir && existsSync(mirrorDir)) {
    try {
      rmSync(mirrorDir, { recursive: true, force: true });
    } catch {
      // Mirror cleanup failure must not break the canonical path.
    }
  }
}

export function cleanAllState(): void {
  const baseDir = getStateBaseDir();
  if (existsSync(baseDir)) {
    rmSync(baseDir, { recursive: true, force: true });
  }
}
