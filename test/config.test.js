/**
 * Tests for config.ts — new schema (rows: number, colors: {main, agents}, no lang/mainColor)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  VALID_COLORS,
  BUILTIN_COLORS,
  COLOR_ANSI,
  colorEscape,
  getDefaultConfig,
  loadConfig,
  saveConfig,
  getConfigPath,
} from '../dist/config.js';

// ── Helper ──

function withTempHome(fn) {
  return async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const tempDir = join(tmpdir(), `ccm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;
    try {
      await fn(tempDir);
    } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function writeConfig(tempDir, data) {
  const configDir = join(tempDir, '.claude-cli-monitor');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(data));
}

// ── VALID_COLORS ──

test('VALID_COLORS: 17개 색상을 포함한다', () => {
  assert.equal(VALID_COLORS.length, 17);
});

test('VALID_COLORS: 기본 8색 포함', () => {
  for (const c of ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray']) {
    assert.ok(VALID_COLORS.includes(c), `${c} missing`);
  }
});

test('VALID_COLORS: orange, dim 포함', () => {
  assert.ok(VALID_COLORS.includes('orange'));
  assert.ok(VALID_COLORS.includes('dim'));
});

// ── COLOR_ANSI ──

test('COLOR_ANSI: 모든 VALID_COLORS에 ANSI 코드 존재', () => {
  for (const color of VALID_COLORS) {
    assert.ok(color in COLOR_ANSI, `missing ANSI for ${color}`);
    assert.equal(typeof COLOR_ANSI[color], 'number');
  }
});

test('COLOR_ANSI: orange=208, red=31', () => {
  assert.equal(COLOR_ANSI['orange'], 208);
  assert.equal(COLOR_ANSI['red'], 31);
});

// ── colorEscape ──

test('colorEscape: red → \\x1b[31m', () => {
  assert.equal(colorEscape('red'), '\x1b[31m');
});

test('colorEscape: orange → 256색 시퀀스', () => {
  assert.equal(colorEscape('orange'), '\x1b[38;5;208m');
});

// ── BUILTIN_COLORS ──

test('BUILTIN_COLORS: 모든 값이 VALID_COLORS', () => {
  for (const [key, val] of Object.entries(BUILTIN_COLORS)) {
    assert.ok(VALID_COLORS.includes(val), `${key}=${val} invalid`);
  }
});

// ── getDefaultConfig ──

test('getDefaultConfig: 새 스키마 기본값', () => {
  const cfg = getDefaultConfig();
  assert.equal(cfg.version, 1);
  assert.equal(cfg.model.display, 'full');
  assert.equal(cfg.rows, 5);
  assert.deepStrictEqual(cfg.colors, { main: 'red', agents: 'orange', builtin: 'red' });
  assert.equal(cfg.liveColor, 'bright-green');
  assert.equal(cfg.cost.enabled, false);
  assert.equal(cfg.report.autoSave, false);
  assert.equal(cfg.staleThresholdMs, 900_000);
});

test('getDefaultConfig: lang 필드 없음', () => {
  const cfg = getDefaultConfig();
  assert.equal('lang' in cfg, false);
});

test('getDefaultConfig: mainColor 필드 없음', () => {
  const cfg = getDefaultConfig();
  assert.equal('mainColor' in cfg, false);
});

test('getDefaultConfig: 호출마다 독립적인 객체', () => {
  const a = getDefaultConfig();
  const b = getDefaultConfig();
  a.rows = 99;
  assert.equal(b.rows, 5);
  a.colors.main = 'blue';
  assert.equal(b.colors.main, 'red');
});

// ── loadConfig: 파일 없음 ──

test('loadConfig: 파일 없으면 기본값', withTempHome((tempDir) => {
  const cfg = loadConfig();
  assert.equal(cfg.version, 1);
  assert.equal(cfg.rows, 5);
  assert.deepStrictEqual(cfg.colors, { main: 'red', agents: 'orange', builtin: 'red' });
}));

// ── loadConfig: 유효한 새 포맷 ──

test('loadConfig: 새 포맷 정상 로드', withTempHome((tempDir) => {
  writeConfig(tempDir, {
    version: 1,
    model: { display: 'short' },
    rows: 10,
    colors: { main: 'blue', agents: 'green' },
    liveColor: 'bright-cyan',
    cost: { enabled: true },
    report: { autoSave: true },
    staleThresholdMs: 300_000,
  });
  const cfg = loadConfig();
  assert.equal(cfg.model.display, 'short');
  assert.equal(cfg.rows, 10);
  assert.equal(cfg.colors.main, 'blue');
  assert.equal(cfg.colors.agents, 'green');
  assert.equal(cfg.liveColor, 'bright-cyan');
  assert.equal(cfg.cost.enabled, true);
  assert.equal(cfg.report.autoSave, true);
  assert.equal(cfg.staleThresholdMs, 300_000);
}));

// ── loadConfig: 구 포맷 하위호환 ──

test('loadConfig: 구 rows 포맷 {mode, value} → number 변환', withTempHome((tempDir) => {
  writeConfig(tempDir, { rows: { mode: 'fixed', value: 8 } });
  const cfg = loadConfig();
  assert.equal(cfg.rows, 8);
}));

test('loadConfig: 구 mainColor → colors.main 마이그레이션', withTempHome((tempDir) => {
  writeConfig(tempDir, { mainColor: 'magenta' });
  const cfg = loadConfig();
  assert.equal(cfg.colors.main, 'magenta');
}));

test('loadConfig: 새 colors.main이 구 mainColor보다 우선', withTempHome((tempDir) => {
  writeConfig(tempDir, {
    mainColor: 'magenta',
    colors: { main: 'yellow', agents: 'green' },
  });
  const cfg = loadConfig();
  assert.equal(cfg.colors.main, 'yellow');
}));

test('loadConfig: 구 Record<string,ColorName> colors → 무시, 기본값 사용', withTempHome((tempDir) => {
  writeConfig(tempDir, {
    colors: { 'Explore': 'red', 'Plan': 'blue' },
  });
  const cfg = loadConfig();
  // 구 포맷(main/agents 키 없음)이므로 기본값
  assert.equal(cfg.colors.main, 'red');  // default
  assert.equal(cfg.colors.agents, 'orange');  // default
}));

// ── loadConfig: 유효하지 않은 값 → 기본값 대체 ──

test('loadConfig: 잘못된 model.display → full', withTempHome((tempDir) => {
  writeConfig(tempDir, { model: { display: 'invalid' } });
  assert.equal(loadConfig().model.display, 'full');
}));

test('loadConfig: rows 범위 초과 → clamp', withTempHome((tempDir) => {
  writeConfig(tempDir, { rows: 999 });
  assert.equal(loadConfig().rows, 50);
}));

test('loadConfig: rows 0 → clamp to 1', withTempHome((tempDir) => {
  writeConfig(tempDir, { rows: 0 });
  assert.equal(loadConfig().rows, 1);
}));

test('loadConfig: rows 음수 → clamp to 1', withTempHome((tempDir) => {
  writeConfig(tempDir, { rows: -5 });
  assert.equal(loadConfig().rows, 1);
}));

test('loadConfig: 유효하지 않은 colors.main → 기본값', withTempHome((tempDir) => {
  writeConfig(tempDir, { colors: { main: 'nope', agents: 'orange' } });
  const cfg = loadConfig();
  assert.equal(cfg.colors.main, 'red');
}));

test('loadConfig: 유효하지 않은 colors.agents → 기본값', withTempHome((tempDir) => {
  writeConfig(tempDir, { colors: { main: 'red', agents: 'nope' } });
  const cfg = loadConfig();
  assert.equal(cfg.colors.agents, 'orange');
}));

test('loadConfig: 유효하지 않은 liveColor → bright-green', withTempHome((tempDir) => {
  writeConfig(tempDir, { liveColor: 'bad' });
  assert.equal(loadConfig().liveColor, 'bright-green');
}));

test('loadConfig: liveColor neon-cycle 유효', withTempHome((tempDir) => {
  writeConfig(tempDir, { liveColor: 'neon-cycle' });
  assert.equal(loadConfig().liveColor, 'neon-cycle');
}));

test('loadConfig: cost.enabled 비boolean → false', withTempHome((tempDir) => {
  writeConfig(tempDir, { cost: { enabled: 'yes' } });
  assert.equal(loadConfig().cost.enabled, false);
}));

test('loadConfig: report.autoSave 비boolean → false', withTempHome((tempDir) => {
  writeConfig(tempDir, { report: { autoSave: 1 } });
  assert.equal(loadConfig().report.autoSave, false);
}));

test('loadConfig: staleThresholdMs 하한 clamp (10 → 60000)', withTempHome((tempDir) => {
  writeConfig(tempDir, { staleThresholdMs: 10 });
  assert.equal(loadConfig().staleThresholdMs, 60_000);
}));

test('loadConfig: staleThresholdMs 상한 clamp (9999999 → 3600000)', withTempHome((tempDir) => {
  writeConfig(tempDir, { staleThresholdMs: 9_999_999 });
  assert.equal(loadConfig().staleThresholdMs, 3_600_000);
}));

// ── loadConfig: 깨진 파일 ──

test('loadConfig: 깨진 JSON → 기본값', withTempHome((tempDir) => {
  const configDir = join(tempDir, '.claude-cli-monitor');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), '{broken json{{');
  const cfg = loadConfig();
  assert.equal(cfg.version, 1);
  assert.equal(cfg.rows, 5);
}));

test('loadConfig: null JSON → 기본값', withTempHome((tempDir) => {
  const configDir = join(tempDir, '.claude-cli-monitor');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), 'null');
  assert.equal(loadConfig().version, 1);
}));

test('loadConfig: 빈 객체 → 기본값', withTempHome((tempDir) => {
  writeConfig(tempDir, {});
  const cfg = loadConfig();
  assert.equal(cfg.rows, 5);
  assert.deepStrictEqual(cfg.colors, { main: 'red', agents: 'orange', builtin: 'red' });
}));

// ── saveConfig ──

test('saveConfig: 저장 후 loadConfig로 동일 데이터 복원', withTempHome((tempDir) => {
  const cfg = getDefaultConfig();
  cfg.rows = 15;
  cfg.colors.main = 'magenta';
  cfg.colors.agents = 'orange';
  saveConfig(cfg);

  const loaded = loadConfig();
  assert.equal(loaded.rows, 15);
  assert.equal(loaded.colors.main, 'magenta');
  assert.equal(loaded.colors.agents, 'orange');
}));

test('saveConfig: 디렉토리 자동 생성', withTempHome((tempDir) => {
  const configPath = getConfigPath();
  assert.equal(existsSync(configPath), false);
  saveConfig(getDefaultConfig());
  assert.ok(existsSync(configPath));
}));

test('saveConfig: JSON 형식으로 저장됨', withTempHome((tempDir) => {
  saveConfig(getDefaultConfig());
  const raw = readFileSync(getConfigPath(), 'utf-8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  assert.equal(typeof parsed.rows, 'number');
  assert.equal(typeof parsed.colors, 'object');
  assert.ok('main' in parsed.colors);
  assert.ok('agents' in parsed.colors);
}));
