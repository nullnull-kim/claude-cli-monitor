/**
 * Tests for init.ts — runInit (no skipInit parameter)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInit } from '../dist/init.js';
import { getDefaultConfig, getConfigPath } from '../dist/config.js';

function withTempEnv(fn) {
  return async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalCwd = process.cwd();
    const tempDir = join(tmpdir(), `ccm-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    process.chdir(tempDir);
    try {
      await fn(tempDir);
    } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

// ── runInit() ──

test('runInit(): 기본 설정 반환', withTempEnv(async () => {
  const cfg = await runInit();
  const def = getDefaultConfig();
  assert.deepStrictEqual(cfg, def);
}));

test('runInit(): config.json 파일 생성', withTempEnv(async () => {
  await runInit();
  const configPath = getConfigPath();
  assert.ok(existsSync(configPath));
  const written = JSON.parse(readFileSync(configPath, 'utf-8'));
  assert.equal(written.version, 1);
  assert.equal(written.rows, 5);
  assert.deepStrictEqual(written.colors, { main: 'red', agents: 'orange', builtin: 'red' });
}));

test('runInit(): lang 필드 없음', withTempEnv(async () => {
  await runInit();
  const written = JSON.parse(readFileSync(getConfigPath(), 'utf-8'));
  assert.equal('lang' in written, false);
}));

test('runInit(): .claude/settings.json에 훅 등록', withTempEnv(async (tempDir) => {
  await runInit();
  const settingsPath = join(tempDir, '.claude', 'settings.json');
  assert.ok(existsSync(settingsPath));
  const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  assert.ok(settings.hooks, 'hooks 객체 존재');
  assert.ok(Array.isArray(settings.hooks.SubagentStart), 'SubagentStart 훅 존재');
  assert.ok(Array.isArray(settings.hooks.SubagentStop), 'SubagentStop 훅 존재');
  assert.ok(Array.isArray(settings.hooks.Stop), 'Stop 훅 존재');
}));

test('runInit(): 훅 커맨드에 claude-cli-monitor 포함', withTempEnv(async (tempDir) => {
  await runInit();
  const settings = JSON.parse(readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8'));
  const startHooks = settings.hooks.SubagentStart;
  const cmd = startHooks[0]?.hooks?.[0]?.command ?? '';
  assert.ok(cmd.includes('claude-cli-monitor-hook'), `command should include claude-cli-monitor-hook, got: ${cmd}`);
}));

test('runInit(): statusLine 등록', withTempEnv(async (tempDir) => {
  await runInit();
  const settings = JSON.parse(readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8'));
  assert.ok(settings.statusLine, 'statusLine 존재');
  assert.ok(settings.statusLine.command.includes('claude-cli-monitor-statusline'));
}));

test('runInit: 재실행 시 훅 중복 등록 안 함', withTempEnv(async (tempDir) => {
  await runInit();
  await runInit();
  const settings = JSON.parse(readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8'));
  assert.equal(settings.hooks.SubagentStart.length, 1, 'SubagentStart 훅 1개');
  assert.equal(settings.hooks.SubagentStop.length, 1, 'SubagentStop 훅 1개');
}));
