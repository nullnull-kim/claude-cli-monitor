/**
 * Tests for colors.ts — new schema (single agents color, no per-agent mapping)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAgentColor, assignColors, noColor, colorBlock, colorAnsi } from '../dist/colors.js';
import { VALID_COLORS } from '../dist/config.js';

/** Minimal config helper (new schema) */
function makeConfig(overrides = {}) {
  return {
    version: 1,
    model: { display: 'full' },
    rows: 5,
    colors: { main: 'red', agents: 'orange', builtin: 'red' },
    liveColor: 'bright-green',
    cost: { enabled: false },
    report: { autoSave: false },
    staleThresholdMs: 900_000,
    ...overrides,
  };
}

// ── getAgentColor ──

test('getAgentColor: 모든 에이전트가 config.colors.agents 반환', () => {
  const config = makeConfig();
  assert.equal(getAgentColor(config, 'Explore'), 'orange');
  assert.equal(getAgentColor(config, 'Plan'), 'orange');
  assert.equal(getAgentColor(config, 'general-purpose'), 'orange');
  assert.equal(getAgentColor(config, 'custom-agent'), 'orange');
});

test('getAgentColor: config.colors.agents 변경 시 반영', () => {
  const config = makeConfig({ colors: { main: 'red', agents: 'orange', builtin: 'red' } });
  assert.equal(getAgentColor(config, 'Explore'), 'orange');
  assert.equal(getAgentColor(config, 'any-agent'), 'orange');
});

// ── assignColors ──

test('assignColors: 빈 배열 → 빈 맵', () => {
  const result = assignColors([], makeConfig());
  assert.equal(result.size, 0);
});

test('assignColors: 모든 에이전트에 동일한 agents 색상 배정', () => {
  const config = makeConfig({ colors: { main: 'red', agents: 'green' } });
  const result = assignColors(['Explore', 'Plan', 'custom'], config);
  assert.equal(result.size, 3);
  assert.equal(result.get('Explore'), 'green');
  assert.equal(result.get('Plan'), 'green');
  assert.equal(result.get('custom'), 'green');
});

test('assignColors: 20개 에이전트도 모두 동일 색상', () => {
  const config = makeConfig();
  const agents = Array.from({ length: 20 }, (_, i) => `agent-${i}`);
  const result = assignColors(agents, config);
  assert.equal(result.size, 20);
  for (const agent of agents) {
    assert.equal(result.get(agent), 'orange');
  }
});

test('assignColors: 중복 에이전트 → Map이므로 1개 엔트리', () => {
  const result = assignColors(['same', 'same'], makeConfig());
  assert.equal(result.size, 1);
});

// ── noColor ──

test('noColor: NO_COLOR 미설정 → false', () => {
  const saved = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  assert.equal(noColor(), false);
  if (saved !== undefined) process.env.NO_COLOR = saved;
});

test('noColor: NO_COLOR 설정 → true', () => {
  const saved = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  assert.equal(noColor(), true);
  if (saved !== undefined) process.env.NO_COLOR = saved;
  else delete process.env.NO_COLOR;
});

test('noColor: NO_COLOR 빈 문자열도 true', () => {
  const saved = process.env.NO_COLOR;
  process.env.NO_COLOR = '';
  assert.equal(noColor(), true);
  if (saved !== undefined) process.env.NO_COLOR = saved;
  else delete process.env.NO_COLOR;
});

// ── colorAnsi ──

test('colorAnsi: NO_COLOR 시 빈 문자열', () => {
  const saved = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  assert.equal(colorAnsi('red'), '');
  if (saved !== undefined) process.env.NO_COLOR = saved;
  else delete process.env.NO_COLOR;
});

// ── colorBlock ──

test('colorBlock: NO_COLOR 시 plain block 문자', () => {
  const saved = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  assert.equal(colorBlock('red'), '\u25A0');
  if (saved !== undefined) process.env.NO_COLOR = saved;
  else delete process.env.NO_COLOR;
});

test('colorBlock: 정상 시 ANSI escape 포함', () => {
  const saved = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  const block = colorBlock('red');
  assert.ok(block.includes('\x1b['), 'should contain ANSI escape');
  assert.ok(block.includes('\u25A0'), 'should contain block char');
  if (saved !== undefined) process.env.NO_COLOR = saved;
});
