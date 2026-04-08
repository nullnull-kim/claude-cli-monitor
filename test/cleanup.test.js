import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  writeAgentState,
  advanceTurn,
  getCurrentTurn,
  cleanStoppedAgents,
  readSessionState,
  cleanSessionState,
} from '../dist/state.js';
import { handleUserPromptSubmit } from '../dist/hooks.js';

// ── Helpers ──

function uniqueSessionId() {
  // sessionId validation requires [a-f0-9-] only
  const hex = Math.random().toString(16).slice(2, 10);
  const hex2 = Date.now().toString(16);
  return `${hex2}-${hex}-c1ea`;
}

function makeAgent(sessionId, agentId, overrides = {}) {
  const now = new Date().toISOString();
  return {
    agentId,
    sessionId,
    status: 'active',
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
    turnNumber: 0,
    ...overrides,
  };
}

// ── Tests ──

describe('cleanup: turn-based agent cleanup', () => {
  const sessions = [];

  afterEach(() => {
    for (const sid of sessions) {
      try { cleanSessionState(sid); } catch { /* ignore */ }
    }
    sessions.length = 0;
  });

  it('1. Turn-based cleanup: agent stopped in turn 1 is cleaned at turn 2', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);

    // Turn 0 (initial). Create and stop an agent with turnNumber=1.
    advanceTurn(sid); // now turn 1
    const agent = makeAgent(sid, 'aabbccdd00112233', { status: 'stopped', stoppedAt: new Date().toISOString(), turnNumber: 1 });
    writeAgentState(agent);

    // Verify agent exists before cleanup
    let state = readSessionState(sid);
    assert.equal(state.agents.length, 1, 'agent should exist before cleanup');

    // Advance to turn 2 and clean
    advanceTurn(sid); // now turn 2
    const removed = cleanStoppedAgents(sid);

    assert.equal(removed, 1, 'should remove 1 stopped agent from turn 1');
    state = readSessionState(sid);
    assert.equal(state.agents.length, 0, 'no agents should remain after cleanup');
  });

  it('2. Same-turn preservation: agent stopped in current turn is NOT cleaned', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);

    advanceTurn(sid); // turn 1
    const agent = makeAgent(sid, 'aabbccdd00112234', { status: 'stopped', stoppedAt: new Date().toISOString(), turnNumber: 1 });
    writeAgentState(agent);

    // Clean in the same turn (turn 1) — agent should NOT be removed
    const removed = cleanStoppedAgents(sid);

    assert.equal(removed, 0, 'should NOT remove agent stopped in current turn');
    const state = readSessionState(sid);
    assert.equal(state.agents.length, 1, 'agent should still exist in same turn');
    assert.equal(state.agents[0].status, 'stopped');
  });

  it('3. task-notification skip: handleUserPromptSubmit with <task-notification> does NOT advance turn', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);

    advanceTurn(sid); // turn 1
    const turnBefore = getCurrentTurn(sid);
    assert.equal(turnBefore, 1);

    // Create a stopped agent in turn 1
    const agent = makeAgent(sid, 'aabbccdd00112235', { status: 'stopped', stoppedAt: new Date().toISOString(), turnNumber: 1 });
    writeAgentState(agent);

    // Send task-notification prompt
    const removed = handleUserPromptSubmit({
      session_id: sid,
      hook_event_name: 'UserPromptSubmit',
      prompt: '<task-notification>Agent completed background work</task-notification>',
    });

    assert.equal(removed, 0, 'task-notification should return 0 (no cleanup)');
    assert.equal(getCurrentTurn(sid), 1, 'turn should NOT advance');

    // Agent should still be there
    const state = readSessionState(sid);
    assert.equal(state.agents.length, 1, 'agent should NOT be cleaned by task-notification');
  });

  it('4. Active agent preservation: active agent is NOT cleaned even in later turns', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);

    advanceTurn(sid); // turn 1
    const agent = makeAgent(sid, 'aabbccdd00112236', { status: 'active', turnNumber: 1 });
    writeAgentState(agent);

    // Advance to turn 2 and clean
    advanceTurn(sid); // turn 2
    const removed = cleanStoppedAgents(sid);

    assert.equal(removed, 0, 'should NOT remove active agent');
    const state = readSessionState(sid);
    assert.equal(state.agents.length, 1, 'active agent should still exist');
    assert.equal(state.agents[0].status, 'active');
  });

  it('5. Multiple turns: only correct agents are cleaned at each step', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);

    // Turn 1: create agent A (stopped)
    advanceTurn(sid); // turn 1
    writeAgentState(makeAgent(sid, 'aa00000000000001', { status: 'stopped', stoppedAt: new Date().toISOString(), turnNumber: 1 }));

    // Turn 2: create agent B (stopped) and agent C (active)
    advanceTurn(sid); // turn 2
    writeAgentState(makeAgent(sid, 'bb00000000000002', { status: 'stopped', stoppedAt: new Date().toISOString(), turnNumber: 2 }));
    writeAgentState(makeAgent(sid, 'cc00000000000003', { status: 'active', turnNumber: 2 }));

    // Clean at turn 2: agent A (turn 1, stopped) should be cleaned. B (turn 2, stopped) stays. C (active) stays.
    let removed = cleanStoppedAgents(sid);
    assert.equal(removed, 1, 'turn 2 cleanup: only agent A from turn 1 should be removed');

    let state = readSessionState(sid);
    assert.equal(state.agents.length, 2, '2 agents should remain (B and C)');
    const ids = state.agents.map(a => a.agentId).sort();
    assert.deepEqual(ids, ['bb00000000000002', 'cc00000000000003']);

    // Turn 3: clean again — agent B (turn 2, stopped) should be cleaned. C (active) stays.
    advanceTurn(sid); // turn 3
    removed = cleanStoppedAgents(sid);
    assert.equal(removed, 1, 'turn 3 cleanup: only agent B from turn 2 should be removed');

    state = readSessionState(sid);
    assert.equal(state.agents.length, 1, '1 agent should remain (C)');
    assert.equal(state.agents[0].agentId, 'cc00000000000003');
    assert.equal(state.agents[0].status, 'active');
  });

  it('6. handleUserPromptSubmit integrates advanceTurn + cleanStoppedAgents', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);

    // Set up: turn 1 with a stopped agent
    advanceTurn(sid); // turn 1
    writeAgentState(makeAgent(sid, 'dd00000000000004', { status: 'stopped', stoppedAt: new Date().toISOString(), turnNumber: 1 }));

    // handleUserPromptSubmit should advance to turn 2 and clean turn 1 agents
    const removed = handleUserPromptSubmit({
      session_id: sid,
      hook_event_name: 'UserPromptSubmit',
      prompt: '/continue',
    });

    assert.equal(removed, 1, 'handleUserPromptSubmit should clean 1 stopped agent');
    assert.equal(getCurrentTurn(sid), 2, 'turn should be 2 after prompt');
    const state = readSessionState(sid);
    assert.equal(state.agents.length, 0, 'no agents should remain');
  });

  it('7. task-notification with leading whitespace still skipped', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);

    advanceTurn(sid); // turn 1
    writeAgentState(makeAgent(sid, 'ee00000000000005', { status: 'stopped', stoppedAt: new Date().toISOString(), turnNumber: 1 }));

    // Prompt with leading whitespace before <task-notification>
    const removed = handleUserPromptSubmit({
      session_id: sid,
      hook_event_name: 'UserPromptSubmit',
      prompt: '  <task-notification>done</task-notification>',
    });

    assert.equal(removed, 0, 'whitespace-prefixed task-notification should return 0');
    assert.equal(getCurrentTurn(sid), 1, 'turn should NOT advance');
  });

  it('8. Empty session cleanup returns 0', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);

    advanceTurn(sid); // turn 1
    advanceTurn(sid); // turn 2

    const removed = cleanStoppedAgents(sid);
    assert.equal(removed, 0, 'cleanup of empty session should return 0');
  });
});
