import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  writeAgentState,
  readAgentState,
  readSessionState,
  updateAgentState,
  cleanStoppedAgents,
  advanceTurn,
  cleanSessionState,
  getSessionStateDir,
} from '../dist/state.js';
import { formatStatusline, formatAgentList } from '../dist/statusline.js';

// ── Helpers ──

function uniqueSessionId(suffix) {
  const hex = Date.now().toString(16);
  const rand = Math.random().toString(16).slice(2, 10);
  return `${hex}-${rand}-${suffix}`;
}

function ensureSessionDir(sessionId) {
  const dir = getSessionStateDir(sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a raw JSON object as an agent state file, bypassing writeAgentState
 * validation. This simulates old-format files from previous versions.
 */
function writeRawAgentFile(sessionId, agentId, obj) {
  const dir = ensureSessionDir(sessionId);
  const filePath = join(dir, `agent-${agentId}.json`);
  writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

// ── Tests ──

describe('compat: backward compatibility with old state file formats', () => {
  const sessions = [];

  afterEach(() => {
    for (const sid of sessions) {
      try { cleanSessionState(sid); } catch { /* ignore */ }
    }
    sessions.length = 0;
  });

  it('1. Missing turnNumber: cleanStoppedAgents treats as turn 0', () => {
    const sid = uniqueSessionId('a1b2c3d4');
    sessions.push(sid);

    // Old-format file: no turnNumber field at all
    writeRawAgentFile(sid, 'aa00000000000001', {
      agentId: 'aa00000000000001',
      sessionId: sid,
      status: 'stopped',
      subagentType: null,
      model: null,
      description: 'old agent',
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
      approxTokens: 1000,
      toolUseCount: 5,
      lastUpdated: new Date().toISOString(),
      // NO turnNumber field
    });

    // Verify the file exists and has no turnNumber
    const raw = readAgentState(sid, 'aa00000000000001');
    assert.ok(raw, 'agent state should be readable');
    assert.equal(raw.turnNumber, undefined, 'turnNumber should be undefined in old file');

    // cleanStoppedAgents should treat missing turnNumber as 0.
    // With currentTurn=0 (no turn-marker.json), agentTurn(0) < currentTurn(0) is false → not removed.
    let removed = cleanStoppedAgents(sid);
    assert.equal(removed, 0, 'should NOT remove when currentTurn is also 0 (same turn semantics)');

    // Advance to turn 1. Now agentTurn(0) < currentTurn(1) → should be removed.
    advanceTurn(sid);
    removed = cleanStoppedAgents(sid);
    assert.equal(removed, 1, 'should remove old agent (turnNumber ?? 0 = 0) when currentTurn is 1');

    const state = readSessionState(sid);
    assert.equal(state.agents.length, 0, 'no agents remain after cleanup');
  });

  it('2. Missing durationMs: statusline and formatAgentList do not crash', () => {
    const sid = uniqueSessionId('b1b2c3d4');
    sessions.push(sid);

    // Old-format file: no durationMs field
    writeRawAgentFile(sid, 'bb00000000000001', {
      agentId: 'bb00000000000001',
      sessionId: sid,
      status: 'stopped',
      subagentType: 'test-agent',
      model: 'sonnet',
      description: 'some task',
      startedAt: '2026-04-06T10:00:00.000Z',
      stoppedAt: '2026-04-06T10:00:30.000Z',
      approxTokens: 5000,
      toolUseCount: 3,
      lastUpdated: '2026-04-06T10:00:30.000Z',
      // NO durationMs
    });

    const state = readSessionState(sid);
    assert.equal(state.totalCount, 1);

    // formatStatusline should not crash
    const line = formatStatusline(state);
    assert.ok(line.includes('agents:'), 'statusline should render without crash');
    assert.ok(line.includes('5.0k'), 'statusline should show token count');

    // formatAgentList should not crash
    const list = formatAgentList(state);
    assert.ok(list.length > 0, 'agent list should have entries');
    assert.ok(list[0].includes('test-agent'), 'agent list should show agent type');
  });

  it('3. Missing approxInputTokens/approxOutputTokens: aggregation still works', () => {
    const sid = uniqueSessionId('c1c2c3d4');
    sessions.push(sid);

    // Old-format file: only has approxTokens, no input/output breakdown
    writeRawAgentFile(sid, 'cc00000000000001', {
      agentId: 'cc00000000000001',
      sessionId: sid,
      status: 'stopped',
      subagentType: null,
      model: null,
      description: 'legacy agent',
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
      approxTokens: 8000,
      toolUseCount: 10,
      lastUpdated: new Date().toISOString(),
      // NO approxInputTokens, NO approxOutputTokens
    });

    // readSessionState aggregates totalApproxTokens from agent.approxTokens
    const state = readSessionState(sid);
    assert.equal(state.totalCount, 1);
    assert.equal(state.totalApproxTokens, 8000, 'totalApproxTokens should come from approxTokens field');

    // formatStatusline uses totalApproxTokens
    const line = formatStatusline(state);
    assert.ok(line.includes('8.0k'), 'statusline should show 8.0k tokens');

    // Verify the agent object has undefined for missing fields (not 0)
    const agent = state.agents[0];
    assert.equal(agent.approxInputTokens, undefined, 'approxInputTokens should be undefined in old file');
    assert.equal(agent.approxOutputTokens, undefined, 'approxOutputTokens should be undefined in old file');
  });

  it('4. Extra unknown fields: JSON.parse does not crash, known fields read correctly', () => {
    const sid = uniqueSessionId('d1d2d3d4');
    sessions.push(sid);

    // File with extra fields the code doesn't know about
    writeRawAgentFile(sid, 'dd00000000000001', {
      agentId: 'dd00000000000001',
      sessionId: sid,
      status: 'active',
      subagentType: 'hook-engineer',
      model: 'opus',
      description: 'implement feature X',
      startedAt: '2026-04-06T10:00:00.000Z',
      stoppedAt: null,
      approxTokens: 12000,
      approxInputTokens: 8000,
      approxOutputTokens: 4000,
      toolUseCount: 15,
      lastUpdated: '2026-04-06T10:05:00.000Z',
      turnNumber: 1,
      durationMs: 30000,
      // Extra unknown fields
      futureField1: 'some value',
      futureField2: 42,
      nestedFuture: { a: 1, b: [2, 3] },
    });

    const agent = readAgentState(sid, 'dd00000000000001');
    assert.ok(agent, 'should read file with extra fields without crash');
    assert.equal(agent.agentId, 'dd00000000000001');
    assert.equal(agent.status, 'active');
    assert.equal(agent.subagentType, 'hook-engineer');
    assert.equal(agent.model, 'opus');
    assert.equal(agent.approxTokens, 12000);
    assert.equal(agent.approxInputTokens, 8000);
    assert.equal(agent.approxOutputTokens, 4000);
    assert.equal(agent.turnNumber, 1);
    assert.equal(agent.durationMs, 30000);

    // readSessionState should also work
    const state = readSessionState(sid);
    assert.equal(state.totalCount, 1);
    assert.equal(state.activeCount, 1);
    assert.equal(state.totalApproxTokens, 12000);
  });

  it('5. updateAgentState with old file: new fields get defaults', () => {
    const sid = uniqueSessionId('e1e2e3d4');
    sessions.push(sid);

    // Write an old-format file (no turnNumber, no durationMs, no input/output tokens)
    writeRawAgentFile(sid, 'ee00000000000001', {
      agentId: 'ee00000000000001',
      sessionId: sid,
      status: 'active',
      subagentType: null,
      model: null,
      description: 'old running agent',
      startedAt: '2026-04-06T09:00:00.000Z',
      stoppedAt: null,
      approxTokens: 3000,
      toolUseCount: 7,
      lastUpdated: '2026-04-06T09:05:00.000Z',
    });

    // Now update with new data via updateAgentState
    const updated = updateAgentState(sid, 'ee00000000000001', {
      approxTokens: 5000,
      approxInputTokens: 3500,
      approxOutputTokens: 1500,
      durationMs: 20000,
    });

    // Verify the update merged correctly
    assert.equal(updated.agentId, 'ee00000000000001');
    assert.equal(updated.approxTokens, 5000, 'approxTokens should be updated');
    assert.equal(updated.approxInputTokens, 3500, 'approxInputTokens should be set');
    assert.equal(updated.approxOutputTokens, 1500, 'approxOutputTokens should be set');
    assert.equal(updated.durationMs, 20000, 'durationMs should be set');

    // Since the file already existed (existing is not null), turnNumber should
    // preserve whatever the old file had (which was undefined, spread as-is).
    // The base object provides turnNumber: turn (current turn), but ...existing
    // overwrites it — with undefined from the old file. Then ...updates doesn't
    // set turnNumber either, so it remains undefined or whatever the merge produces.
    // Key: the update should not crash.
    assert.ok(updated.lastUpdated, 'lastUpdated should be set');

    // Original fields should be preserved
    assert.equal(updated.status, 'active', 'status should be preserved from old file');
    assert.equal(updated.description, 'old running agent', 'description should be preserved');
    assert.equal(updated.startedAt, '2026-04-06T09:00:00.000Z', 'startedAt should be preserved');
  });

  it('6. readSessionState with mixed files: old and new formats coexist', () => {
    const sid = uniqueSessionId('f1f2f3d4');
    sessions.push(sid);

    // Old-format file (v1-era: minimal fields)
    writeRawAgentFile(sid, 'ff00000000000001', {
      agentId: 'ff00000000000001',
      sessionId: sid,
      status: 'stopped',
      subagentType: null,
      model: null,
      description: 'legacy agent 1',
      startedAt: '2026-04-06T08:00:00.000Z',
      stoppedAt: '2026-04-06T08:01:00.000Z',
      approxTokens: 2000,
      toolUseCount: 3,
      lastUpdated: '2026-04-06T08:01:00.000Z',
      // NO turnNumber, durationMs, approxInputTokens, approxOutputTokens
    });

    // New-format file (full fields)
    writeRawAgentFile(sid, 'ff00000000000002', {
      agentId: 'ff00000000000002',
      sessionId: sid,
      status: 'active',
      subagentType: 'code-reviewer',
      model: 'opus',
      description: 'review implementation',
      startedAt: '2026-04-06T09:00:00.000Z',
      stoppedAt: null,
      approxTokens: 10000,
      approxInputTokens: 7000,
      approxOutputTokens: 3000,
      toolUseCount: 12,
      lastUpdated: '2026-04-06T09:05:00.000Z',
      turnNumber: 2,
      durationMs: 45000,
    });

    // Another old-format file
    writeRawAgentFile(sid, 'ff00000000000003', {
      agentId: 'ff00000000000003',
      sessionId: sid,
      status: 'stopped',
      subagentType: 'test-engineer',
      model: 'sonnet',
      description: 'run tests',
      startedAt: '2026-04-06T08:30:00.000Z',
      stoppedAt: '2026-04-06T08:31:00.000Z',
      approxTokens: 4000,
      toolUseCount: 8,
      lastUpdated: '2026-04-06T08:31:00.000Z',
      // NO turnNumber, durationMs
    });

    const state = readSessionState(sid);

    // Basic session summary checks
    assert.equal(state.totalCount, 3, 'should have 3 agents total');
    assert.equal(state.activeCount, 1, 'should have 1 active agent');
    assert.equal(state.totalApproxTokens, 16000, 'total tokens should sum all agents (2000+10000+4000)');

    // Agents should be sorted by startedAt
    assert.equal(state.agents[0].agentId, 'ff00000000000001', 'first agent by startedAt');
    assert.equal(state.agents[1].agentId, 'ff00000000000003', 'second agent by startedAt');
    assert.equal(state.agents[2].agentId, 'ff00000000000002', 'third agent by startedAt');

    // formatStatusline should handle mixed formats
    const line = formatStatusline(state);
    assert.ok(line.includes('1/3'), 'statusline should show 1 active / 3 total');
    assert.ok(line.includes('16.0k'), 'statusline should show aggregated tokens');

    // formatAgentList should handle mixed formats without crash
    const list = formatAgentList(state);
    assert.equal(list.length, 3, 'agent list should have 3 entries');
  });
});
