/**
 * Tests for resolveAgentDisplayName (dist/resolver.js)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentDisplayName, isGenericAgent, getModelSuffix, hasMultipleModels, parseRoleFromDescription, parseTaskFromDescription } from '../dist/resolver.js';

// Test 1: subagentType이 있으면 반환
test('subagentType이 있으면 그대로 반환', () => {
  const agent = { subagentType: 'hook-engineer', description: null };
  assert.equal(resolveAgentDisplayName(agent), 'hook-engineer');
});

// Test 2: subagentType이 'general-purpose'이면 description 콜론 파싱 적용
test("subagentType이 'general-purpose'이고 description에 콜론 패턴 → role 반환", () => {
  const agent = { subagentType: 'general-purpose', description: 'hook-engineer: implement X' };
  assert.equal(resolveAgentDisplayName(agent), 'hook-engineer');
});

// Test 3: subagentType null → description 콜론 파싱 적용
test('subagentType null이고 description에 콜론 패턴 → role 반환', () => {
  const agent = { subagentType: null, description: 'hook-engineer: implement X' };
  assert.equal(resolveAgentDisplayName(agent), 'hook-engineer');
});

// Test 4: subagentType도 description도 없으면 built-in
test('subagentType도 description도 없으면 built-in', () => {
  const agent = { subagentType: null, description: null };
  assert.equal(resolveAgentDisplayName(agent), 'built-in');
});

// Test 5: named agent type은 그대로 반환
test('Explore 등 named type은 그대로 반환', () => {
  assert.equal(resolveAgentDisplayName({ subagentType: 'Explore', description: null }), 'Explore');
  assert.equal(resolveAgentDisplayName({ subagentType: 'Plan', description: null }), 'Plan');
  assert.equal(resolveAgentDisplayName({ subagentType: 'claude-code-guide', description: null }), 'claude-code-guide');
});

// Test 6: isGenericAgent 판별
// BUILTIN_AGENT_TYPES = { general-purpose, Explore, Plan, claude-code-guide, statusline-setup }
// 이 집합에 속하거나 subagentType이 null이면 true
test('isGenericAgent: general-purpose/null은 true', () => {
  assert.equal(isGenericAgent({ subagentType: 'general-purpose', description: null }), true);
  assert.equal(isGenericAgent({ subagentType: null, description: null }), true);
});

test('isGenericAgent: Explore/Plan도 빌트인 집합에 속하므로 true', () => {
  assert.equal(isGenericAgent({ subagentType: 'Explore', description: null }), true);
  assert.equal(isGenericAgent({ subagentType: 'Plan', description: null }), true);
});

test('isGenericAgent: 커스텀 에이전트(hook-engineer 등)는 false', () => {
  assert.equal(isGenericAgent({ subagentType: 'hook-engineer', description: null }), false);
  assert.equal(isGenericAgent({ subagentType: 'test-engineer', description: null }), false);
  assert.equal(isGenericAgent({ subagentType: 'devils-advocate', description: null }), false);
});

// ── getModelSuffix ──

test('getModelSuffix: haiku → (H)', () => {
  assert.equal(getModelSuffix('claude-haiku-3-5'), '(H)');
  assert.equal(getModelSuffix('claude-3-haiku-20240307'), '(H)');
});

test('getModelSuffix: sonnet → (S)', () => {
  assert.equal(getModelSuffix('claude-sonnet-4-5'), '(S)');
  assert.equal(getModelSuffix('claude-3-5-sonnet-20241022'), '(S)');
});

test('getModelSuffix: opus → (O)', () => {
  assert.equal(getModelSuffix('claude-opus-4'), '(O)');
  assert.equal(getModelSuffix('claude-3-opus-20240229'), '(O)');
});

test('getModelSuffix: null → 빈 문자열', () => {
  assert.equal(getModelSuffix(null), '');
});

test('getModelSuffix: 알 수 없는 모델 → 빈 문자열', () => {
  assert.equal(getModelSuffix('gpt-4'), '');
  assert.equal(getModelSuffix(''), '');
});

test('getModelSuffix: 대소문자 무시', () => {
  assert.equal(getModelSuffix('Claude-Haiku-3'), '(H)');
  assert.equal(getModelSuffix('CLAUDE-SONNET'), '(S)');
  assert.equal(getModelSuffix('OPUS'), '(O)');
});

// ── hasMultipleModels ──

test('hasMultipleModels: 빈 배열 → false', () => {
  assert.equal(hasMultipleModels([]), false);
});

test('hasMultipleModels: 동일 모델 패밀리만 있으면 false', () => {
  assert.equal(hasMultipleModels([
    { model: 'claude-sonnet-4-5' },
    { model: 'claude-3-5-sonnet-20241022' },
  ]), false);
});

test('hasMultipleModels: 2개 다른 패밀리 → true', () => {
  assert.equal(hasMultipleModels([
    { model: 'claude-sonnet-4-5' },
    { model: 'claude-haiku-3-5' },
  ]), true);
});

test('hasMultipleModels: null 모델은 무시', () => {
  assert.equal(hasMultipleModels([
    { model: null },
    { model: 'claude-sonnet-4-5' },
  ]), false);
});

test('hasMultipleModels: null 포함 + 다른 패밀리 혼재 → true', () => {
  assert.equal(hasMultipleModels([
    { model: null },
    { model: 'claude-sonnet-4-5' },
    { model: 'claude-opus-4' },
  ]), true);
});

test('hasMultipleModels: 3개 패밀리 → true', () => {
  assert.equal(hasMultipleModels([
    { model: 'claude-haiku-3-5' },
    { model: 'claude-sonnet-4-5' },
    { model: 'claude-opus-4' },
  ]), true);
});

// ── parseRoleFromDescription ──

test('parseRoleFromDescription: "hook-engineer: Column fix" → "hook-engineer"', () => {
  assert.equal(parseRoleFromDescription('hook-engineer: Column fix'), 'hook-engineer');
});

test('parseRoleFromDescription: "project-lead: STF 의견" → "project-lead"', () => {
  assert.equal(parseRoleFromDescription('project-lead: STF 의견'), 'project-lead');
});

test('parseRoleFromDescription: fullwidth colon "역할： 작업" → "역할"', () => {
  assert.equal(parseRoleFromDescription('역할\uFF1A 작업'), '역할');
});

test('parseRoleFromDescription: role > 20 chars → null', () => {
  assert.equal(parseRoleFromDescription('this-role-is-way-too-long-to-be-valid: task'), null);
});

test('parseRoleFromDescription: no colon → null', () => {
  assert.equal(parseRoleFromDescription('no colon here at all'), null);
});

test('parseRoleFromDescription: role with 3+ spaces → null', () => {
  assert.equal(parseRoleFromDescription('one two three four: task'), null);
});

test('parseRoleFromDescription: empty task after colon → null', () => {
  assert.equal(parseRoleFromDescription('hook-engineer: '), null);
});

// ── parseTaskFromDescription ──

test('parseTaskFromDescription: "hook-engineer: Column fix" → "Column fix"', () => {
  assert.equal(parseTaskFromDescription('hook-engineer: Column fix'), 'Column fix');
});

test('parseTaskFromDescription: no pattern → returns original', () => {
  assert.equal(parseTaskFromDescription('no colon here'), 'no colon here');
});

// ── prefix promotion: "STF: code-reviewer 품질검증" → role "code-reviewer" ──

test('parseRoleFromDescription: "STF: code-reviewer 품질검증" → "code-reviewer"', () => {
  assert.equal(parseRoleFromDescription('STF: code-reviewer 품질검증'), 'code-reviewer');
});

test('parseRoleFromDescription: "STF: project-lead 의견" → "project-lead"', () => {
  assert.equal(parseRoleFromDescription('STF: project-lead 의견'), 'project-lead');
});

test('parseTaskFromDescription: "STF: code-reviewer 품질검증" → "품질검증"', () => {
  assert.equal(parseTaskFromDescription('STF: code-reviewer 품질검증'), '품질검증');
});

test('parseTaskFromDescription: "STF: devils-advocate 반론" → "반론"', () => {
  assert.equal(parseTaskFromDescription('STF: devils-advocate 반론'), '반론');
});

test('parseRoleFromDescription: hyphenated role stays as-is (no promotion)', () => {
  assert.equal(parseRoleFromDescription('hook-engineer: statusline 검증'), 'hook-engineer');
});

test('parseTaskFromDescription: hyphenated role stays (task unchanged)', () => {
  assert.equal(parseTaskFromDescription('hook-engineer: statusline 검증'), 'statusline 검증');
});

test('parseRoleFromDescription: prefix with no hyphenated task word → keeps prefix', () => {
  assert.equal(parseRoleFromDescription('STF: 전체 검증'), 'STF');
});

// ── resolveAgentDisplayName with colon parsing ──

test('resolveAgentDisplayName: generic + "hook-engineer: task" → "hook-engineer"', () => {
  assert.equal(resolveAgentDisplayName({ subagentType: null, description: 'hook-engineer: fix columns' }), 'hook-engineer');
});

test('resolveAgentDisplayName: generic + no colon → "built-in"', () => {
  assert.equal(resolveAgentDisplayName({ subagentType: null, description: 'no colon here' }), 'built-in');
});

test('resolveAgentDisplayName: non-generic subagentType takes priority over description', () => {
  assert.equal(resolveAgentDisplayName({ subagentType: 'code-reviewer', description: 'hook-engineer: something' }), 'code-reviewer');
});

// ── built-in vs custom 구분 ──

test('resolveAgentDisplayName: general-purpose + no parseable desc → "built-in"', () => {
  assert.equal(resolveAgentDisplayName({ subagentType: 'general-purpose', description: 'search files' }), 'built-in');
  assert.equal(resolveAgentDisplayName({ subagentType: 'general-purpose', description: null }), 'built-in');
});

test('resolveAgentDisplayName: null subagentType + no parseable desc → "built-in"', () => {
  assert.equal(resolveAgentDisplayName({ subagentType: null, description: 'do something' }), 'built-in');
});

test('resolveAgentDisplayName: Explore/Plan은 subagentType 그대로 반환 (built-in이 아님)', () => {
  assert.equal(resolveAgentDisplayName({ subagentType: 'Explore', description: 'find files' }), 'Explore');
  assert.equal(resolveAgentDisplayName({ subagentType: 'Plan', description: 'design plan' }), 'Plan');
});

test('resolveAgentDisplayName: custom agent → subagentType 그대로 반환', () => {
  assert.equal(resolveAgentDisplayName({ subagentType: 'hook-engineer', description: null }), 'hook-engineer');
  assert.equal(resolveAgentDisplayName({ subagentType: 'test-engineer', description: null }), 'test-engineer');
  assert.equal(resolveAgentDisplayName({ subagentType: 'devils-advocate', description: null }), 'devils-advocate');
  assert.equal(resolveAgentDisplayName({ subagentType: 'project-lead', description: null }), 'project-lead');
});

test('isGenericAgent + resolveAgentDisplayName 일관성: generic이면 built-in 또는 named built-in', () => {
  const builtinAgent = { subagentType: 'general-purpose', description: null };
  assert.equal(isGenericAgent(builtinAgent), true);
  assert.equal(resolveAgentDisplayName(builtinAgent), 'built-in');

  const customAgent = { subagentType: 'code-reviewer', description: null };
  assert.equal(isGenericAgent(customAgent), false);
  assert.equal(resolveAgentDisplayName(customAgent), 'code-reviewer');
});
