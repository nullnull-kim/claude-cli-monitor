import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeAgentState, readAgentState, cleanSessionState } from '../dist/state.js';

const sessionId = randomBytes(8).toString('hex');
const agentId = randomBytes(8).toString('hex');

const baseState = {
  agentId,
  sessionId,
  status: 'active',
  subagentType: null,
  model: null,
  description: null,
  startedAt: new Date().toISOString(),
  stoppedAt: null,
  approxTokens: 0,
  approxInputTokens: 0,
  approxOutputTokens: 0,
  toolUseCount: 0,
  lastUpdated: new Date().toISOString(),
};

test('atomic write: new file write and read', () => {
  writeAgentState(baseState);
  const result = readAgentState(sessionId, agentId);
  assert.ok(result !== null, 'readAgentState should return a non-null value');
  assert.equal(result.agentId, agentId);
  assert.equal(result.sessionId, sessionId);
  assert.equal(result.status, 'active');
});

test('atomic write: overwrite existing file and read updated content', () => {
  const updated = { ...baseState, status: 'stopped', approxTokens: 42 };
  writeAgentState(updated);
  const result = readAgentState(sessionId, agentId);
  assert.ok(result !== null, 'readAgentState should return a non-null value after overwrite');
  assert.equal(result.status, 'stopped');
  assert.equal(result.approxTokens, 42);
});

test('cleanup: cleanSessionState removes test session directory', () => {
  cleanSessionState(sessionId);
  const result = readAgentState(sessionId, agentId);
  assert.equal(result, null, 'readAgentState should return null after cleanSessionState');
});
