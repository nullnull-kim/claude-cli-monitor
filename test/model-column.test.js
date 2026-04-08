import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTerminalReport } from '../dist/terminal.js';

// Minimal stub data for testing
const stubReport = {
  sessionId: 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee',
  sessionDir: '/tmp/test-session',
  timestamp: '2026-04-06T00:00:00.000Z',
  mainModel: 'claude-sonnet-4-6',
  totalTokens: 1000,
  totalDurationMs: 5000,
  agents: [],
  agentCount: 0,
  maxDepth: 0,
};

const stubMainUsage = {
  input_tokens: 500,
  output_tokens: 500,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

// Strip ANSI codes for clean text comparison
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// Count table columns by counting │ separators in the header row.
// The header row is the first line that starts with │ (box-drawing character).
function countTableColumns(output) {
  const stripped = stripAnsi(output);
  const lines = stripped.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('\u2502') && trimmed.endsWith('\u2502')) {
      // Count the number of cell-separator │ characters (excluding edges)
      const inner = trimmed.slice(1, -1);
      return inner.split('\u2502').length;
    }
  }
  return 0;
}

test('1. 기본 호출(verbose 미지정) 시 테이블에 Model 컬럼 미포함', () => {
  const output = renderTerminalReport(stubReport, stubMainUsage);
  const cols = countTableColumns(output);
  // non-verbose: 9 columns (#, Task, Agent, Used, %, Bar, Cost, Time, Tools)
  assert.ok(cols === 9, `Default output should have 9 columns, got ${cols}`);
});

test('2. verbose=false 시 테이블에 Model 컬럼 미포함', () => {
  const output = renderTerminalReport(stubReport, stubMainUsage, false);
  const cols = countTableColumns(output);
  assert.ok(cols === 9, `verbose=false output should have 9 columns, got ${cols}`);
});

test('3. verbose=true 시 테이블에 Model 컬럼 포함', () => {
  const output = renderTerminalReport(stubReport, stubMainUsage, true);
  const cols = countTableColumns(output);
  // verbose: 10 columns (#, Task, Agent, Model, Used, %, Bar, Cost, Time, Tools)
  assert.ok(cols === 10, `verbose=true output should have 10 columns, got ${cols}`);
});

test('4. verbose=true와 verbose=false 결과는 다름', () => {
  const defaultOutput = renderTerminalReport(stubReport, stubMainUsage);
  const verboseOutput = renderTerminalReport(stubReport, stubMainUsage, true);
  assert.notEqual(defaultOutput, verboseOutput, 'verbose=true and default outputs should differ');
});
