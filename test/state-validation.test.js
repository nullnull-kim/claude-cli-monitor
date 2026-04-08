import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSessionStateDir, readAgentState } from '../dist/state.js';

// ── sessionId validation (via getSessionStateDir) ──

test('1. 유효한 sessionId (UUID 형식) 통과', () => {
  const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  assert.doesNotThrow(() => getSessionStateDir(uuid));
});

test('2. 유효한 sessionId (hex only) 통과', () => {
  assert.doesNotThrow(() => getSessionStateDir('abcdef0123456789'));
});

test('3. 빈 sessionId 거부', () => {
  assert.throws(() => getSessionStateDir(''), /Invalid sessionId/);
});

test('4. sessionId 길이 초과(101자) 거부', () => {
  const long = 'a'.repeat(101);
  assert.throws(() => getSessionStateDir(long), /Invalid sessionId/);
});

test('5. sessionId 경로 순회 시도 (../etc/passwd) 거부', () => {
  assert.throws(() => getSessionStateDir('../etc/passwd'), /Invalid sessionId/);
});

test('6. sessionId 특수 문자 포함 거부', () => {
  assert.throws(() => getSessionStateDir('abc/def'), /Invalid sessionId/);
});

test('7. sessionId 특수 문자 포함 거부 (null byte)', () => {
  assert.throws(() => getSessionStateDir('abc\0def'), /Invalid sessionId/);
});

// ── agentId validation (via readAgentState which calls getAgentStatePath internally) ──

test('8. 유효한 agentId (hex 문자열) 통과', () => {
  const uuid = 'a1b2c3d4e5f67890abcdef1234567890';
  // readAgentState with valid IDs should not throw on validation (returns null if file missing)
  assert.doesNotThrow(() => readAgentState('a1b2c3d4-e5f6-7890-abcd-ef1234567890', uuid));
});

test('9. 빈 agentId 거부', () => {
  assert.throws(() => readAgentState('a1b2c3d4-e5f6-7890-abcd-ef1234567890', ''), /Invalid agentId/);
});

test('10. agentId 길이 초과(101자) 거부', () => {
  const long = 'a'.repeat(101);
  assert.throws(() => readAgentState('a1b2c3d4-e5f6-7890-abcd-ef1234567890', long), /Invalid agentId/);
});

test('11. agentId 경로 순회 시도 거부', () => {
  assert.throws(
    () => readAgentState('a1b2c3d4-e5f6-7890-abcd-ef1234567890', '../etc/passwd'),
    /Invalid agentId/,
  );
});

test('12. agentId 특수 문자 포함 거부', () => {
  assert.throws(
    () => readAgentState('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'abc-def'),
    /Invalid agentId/,
  );
});
