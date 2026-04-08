/**
 * Config Manager
 *
 * Loads and saves ~/.claude-cli-monitor/config.json.
 * Schema version 1. Invalid values fall back to defaults, never crash.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// ── Types ──

export type ColorName =
  | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray'
  | 'bright-red' | 'bright-green' | 'bright-yellow' | 'bright-blue'
  | 'bright-magenta' | 'bright-cyan' | 'bright-white' | 'dim'
  | 'orange';

export type ModelDisplay = 'short' | 'full';

export interface MonitorConfig {
  version: 1;
  model: {
    display: ModelDisplay;
  };
  rows: number;
  colors: {
    main: ColorName;
    agents: ColorName;
    builtin: ColorName;
  };
  liveColor: 'neon-cycle' | ColorName;
  cost: {
    enabled: boolean;
  };
  report: {
    autoSave: boolean;
  };
  staleThresholdMs: number;
}

// ── Constants ──

export const VALID_COLORS: ColorName[] = [
  'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray',
  'bright-red', 'bright-green', 'bright-yellow', 'bright-blue',
  'bright-magenta', 'bright-cyan', 'bright-white', 'dim',
  'orange',
];

export const COLOR_ANSI: Record<ColorName, number> = {
  'red': 31, 'green': 32, 'yellow': 33, 'blue': 34, 'magenta': 35,
  'cyan': 36, 'white': 37, 'gray': 90, 'bright-red': 91, 'bright-green': 92,
  'bright-yellow': 93, 'bright-blue': 94, 'bright-magenta': 95,
  'bright-cyan': 96, 'bright-white': 97, 'dim': 2,
  'orange': 208, // 256-color: use as \x1b[38;5;208m
};

/** Get ANSI escape sequence for a color name */
export function colorEscape(color: ColorName): string {
  if (color === 'orange') return '\x1b[38;5;208m';
  return `\x1b[${COLOR_ANSI[color]}m`;
}

export const BUILTIN_COLORS: Record<string, ColorName> = {
  'general-purpose': 'white',
  'Explore': 'blue',
  'Plan': 'yellow',
  'claude-code-guide': 'magenta',
  'statusline-setup': 'magenta',
};

const DEFAULT_CONFIG: MonitorConfig = {
  version: 1,
  model: { display: 'full' },
  rows: 5,
  colors: { main: 'red', agents: 'orange', builtin: 'red' },
  liveColor: 'bright-green',
  cost: { enabled: false },
  report: { autoSave: false },
  staleThresholdMs: 900_000,
};

// ── Paths ──

function getBaseDir(): string {
  return join(homedir(), '.claude-cli-monitor');
}

export function getConfigPath(): string {
  return join(getBaseDir(), 'config.json');
}

// ── Validation ──

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function isValidColor(c: unknown): c is ColorName {
  return typeof c === 'string' && VALID_COLORS.includes(c as ColorName);
}

function isValidModelDisplay(d: unknown): d is ModelDisplay {
  return d === 'short' || d === 'full';
}

/**
 * Validate and sanitize a raw config object. Invalid values are replaced with defaults.
 * Handles backward compat: old rows.value, old mainColor, old Record<string,ColorName> colors.
 */
function sanitize(raw: Record<string, unknown>): MonitorConfig {
  const def = DEFAULT_CONFIG;

  const rawModel = (raw.model ?? {}) as Record<string, unknown>;
  const modelDisplay = isValidModelDisplay(rawModel.display) ? rawModel.display : def.model.display;

  // Backward compat: old format was { mode: 'fixed', value: N }
  let rows: number;
  if (typeof raw.rows === 'number') {
    rows = clamp(raw.rows, 1, 50);
  } else if (typeof raw.rows === 'object' && raw.rows !== null) {
    const oldRows = raw.rows as Record<string, unknown>;
    rows = typeof oldRows.value === 'number' ? clamp(oldRows.value, 1, 50) : def.rows;
  } else {
    rows = def.rows;
  }

  // Backward compat: migrate mainColor → colors.main, ignore old Record<string,ColorName> colors
  let colorsMain: ColorName = def.colors.main;
  let colorsAgents: ColorName = def.colors.agents;
  let colorsBuiltin: ColorName = def.colors.builtin;

  const rawColors = raw.colors;
  if (rawColors && typeof rawColors === 'object' && !Array.isArray(rawColors)) {
    const rc = rawColors as Record<string, unknown>;
    // New format: { main: ColorName, agents: ColorName }
    if (isValidColor(rc.main) && isValidColor(rc.agents)) {
      colorsMain = rc.main;
      colorsAgents = rc.agents;
    }
    // else: old Record<string, ColorName> format — ignore, use defaults
    if (isValidColor(rc.builtin)) {
      colorsBuiltin = rc.builtin;
    }
  }

  // Old mainColor field → migrate to colors.main (only if colors.main wasn't already set from new format)
  if (isValidColor(raw.mainColor) && !(rawColors && typeof rawColors === 'object' && isValidColor((rawColors as Record<string, unknown>).main))) {
    colorsMain = raw.mainColor as ColorName;
  }

  const rawCost = (raw.cost ?? {}) as Record<string, unknown>;
  const costEnabled = typeof rawCost.enabled === 'boolean' ? rawCost.enabled : def.cost.enabled;

  const rawReport = (raw.report ?? {}) as Record<string, unknown>;
  const autoSave = typeof rawReport.autoSave === 'boolean' ? rawReport.autoSave : def.report.autoSave;

  const liveColor = raw.liveColor === 'neon-cycle' || isValidColor(raw.liveColor)
    ? raw.liveColor as MonitorConfig['liveColor']
    : def.liveColor;

  const staleThresholdMs = typeof raw.staleThresholdMs === 'number'
    ? clamp(raw.staleThresholdMs, 60_000, 3_600_000)
    : def.staleThresholdMs;

  return {
    version: 1,
    model: { display: modelDisplay },
    rows,
    colors: { main: colorsMain, agents: colorsAgents, builtin: colorsBuiltin },
    liveColor,
    cost: { enabled: costEnabled },
    report: { autoSave },
    staleThresholdMs,
  };
}

// ── Load / Save ──

export function loadConfig(): MonitorConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, colors: { ...DEFAULT_CONFIG.colors } };
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_CONFIG, colors: { ...DEFAULT_CONFIG.colors } };
    return sanitize(raw as Record<string, unknown>);
  } catch {
    return { ...DEFAULT_CONFIG, colors: { ...DEFAULT_CONFIG.colors } };
  }
}

export function saveConfig(config: MonitorConfig): void {
  const configPath = getConfigPath();
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Atomic write: write to tmp, then rename
  const tmpPath = configPath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n');
  renameSync(tmpPath, configPath);
}

export function getDefaultConfig(): MonitorConfig {
  return { ...DEFAULT_CONFIG, colors: { ...DEFAULT_CONFIG.colors } };
}
