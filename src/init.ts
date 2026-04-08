/**
 * Init Flow — Minimal setup
 *
 * Saves defaults, registers hooks/statusLine/skills.
 */

import * as readline from 'node:readline';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type MonitorConfig, type ColorName, loadConfig, saveConfig, getDefaultConfig } from './config.js';
import { getTranslations, type Translations } from './i18n/index.js';

const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const C = '\x1b[36m';
const G = '\x1b[32m';

// ── Terminal UI primitives ──

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Arrow-key selection. Returns selected index.
 */
function selectPrompt(
  rl: readline.Interface,
  title: string,
  options: string[],
  defaultIndex: number = 0,
): Promise<number> {
  return new Promise((resolve) => {
    let cursor = defaultIndex;

    const render = () => {
      if (cursor >= 0) {
        process.stdout.write(`\x1b[${options.length}A`);
      }
      for (let i = 0; i < options.length; i++) {
        const prefix = i === cursor ? `${G}❯${R}` : ' ';
        process.stdout.write(`\x1b[2K  ${prefix} ${options[i]}\n`);
      }
    };

    console.log(`\n${B}${title}${R}`);
    for (let i = 0; i < options.length; i++) {
      const prefix = i === cursor ? `${G}❯${R}` : ' ';
      console.log(`  ${prefix} ${options[i]}`);
    }

    if (!process.stdin.isTTY) {
      resolve(defaultIndex);
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (key: Buffer) => {
      const s = key.toString();
      if (s === '\x1b[A') {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (s === '\x1b[B') {
        cursor = (cursor + 1) % options.length;
        render();
      } else if (s === '\r' || s === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        resolve(cursor);
      } else if (s === '\x03') {
        process.stdin.setRawMode(false);
        process.exit(0);
      }
    };

    process.stdin.on('data', onData);
  });
}

// ── Skill Registration ──

const SKILL_MARKER = 'ccm-';

/** Package root: dist/init.js → ../ */
function getPackageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** Skill names shipped with the package */
function getShippedSkills(): string[] {
  const skillsDir = join(getPackageRoot(), 'skills');
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith(SKILL_MARKER))
    .map(d => d.name);
}

interface SkillsResult {
  installed: number;
  skipped: number;
}

/**
 * Copy skills from package's skills/ to CWD/.claude/skills/.
 * Only overwrites if source is newer (by always overwriting for simplicity).
 */
function registerSkills(): SkillsResult {
  const skillNames = getShippedSkills();
  if (skillNames.length === 0) return { installed: 0, skipped: 0 };

  const srcBase = join(getPackageRoot(), 'skills');
  const destBase = join(process.cwd(), '.claude', 'skills');

  let installed = 0;
  let skipped = 0;

  for (const name of skillNames) {
    const src = join(srcBase, name);
    const dest = join(destBase, name);
    const destSkillMd = join(dest, 'SKILL.md');

    if (existsSync(destSkillMd)) {
      // Already installed — overwrite to keep in sync with package version
      cpSync(src, dest, { recursive: true });
      skipped++;
    } else {
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
      installed++;
    }
  }

  return { installed, skipped };
}

/**
 * Remove skills installed by claude-cli-monitor from CWD/.claude/skills/.
 */
function unregisterSkills(): number {
  const skillsDir = join(process.cwd(), '.claude', 'skills');
  if (!existsSync(skillsDir)) return 0;

  let removed = 0;
  const entries = readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(SKILL_MARKER)) {
      rmSync(join(skillsDir, entry.name), { recursive: true, force: true });
      removed++;
    }
  }

  // Clean up empty skills/ directory
  try {
    const remaining = readdirSync(skillsDir);
    if (remaining.length === 0) {
      rmSync(skillsDir, { recursive: true, force: true });
    }
  } catch { /* ignore */ }

  return removed;
}

// ── Hook Registration ──

const HOOK_EVENTS = [
  { event: 'SubagentStart', matcher: undefined },
  { event: 'SubagentStop', matcher: undefined },
  { event: 'PostToolUse', matcher: 'Agent' },
  { event: 'UserPromptSubmit', matcher: undefined },
  { event: 'Stop', matcher: undefined },
] as const;

const HOOK_MARKER = 'claude-cli-monitor-hook';
const STATUSLINE_MARKER = 'claude-cli-monitor-statusline';

interface RegisterResult {
  added: number;
  skipped: number;
  statusLineSet: boolean;
  statusLineSkipped: boolean;
  settingsPath: string;
}

/**
 * Register hooks and statusLine in the project-local .claude/settings.json.
 * Uses CWD (not global ~/.claude/) so each project gets its own configuration.
 * If .claude/ directory doesn't exist, creates it.
 */
function registerSettings(): RegisterResult {
  const claudeDir = join(process.cwd(), '.claude');
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  const settingsPath = join(claudeDir, 'settings.json');

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      // Corrupt file — start fresh
    }
  }

  // ── Hooks ──

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, unknown[]>;

  let added = 0;
  let skipped = 0;

  for (const { event, matcher } of HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = [];
    }

    const existing = hooks[event] as Array<Record<string, unknown>>;
    const alreadyRegistered = existing.some((entry) => {
      const innerHooks = entry.hooks as Array<Record<string, string>> | undefined;
      if (!innerHooks) return false;
      return innerHooks.some((h) => h.command?.includes(HOOK_MARKER));
    });

    if (alreadyRegistered) {
      skipped++;
      continue;
    }

    const hookEntry: Record<string, unknown> = {
      hooks: [
        {
          type: 'command',
          command: `claude-cli-monitor-hook ${event}`,
        },
      ],
    };
    if (matcher) {
      hookEntry.matcher = matcher;
    }

    existing.push(hookEntry);
    added++;
  }

  // ── StatusLine ──

  let statusLineSet = false;
  let statusLineSkipped = false;

  const existingStatusLine = settings.statusLine as Record<string, unknown> | undefined;
  if (existingStatusLine && typeof existingStatusLine === 'object') {
    const cmd = (existingStatusLine as Record<string, string>).command ?? '';
    if (cmd.includes(STATUSLINE_MARKER)) {
      statusLineSkipped = true;
    } else {
      // Another statusLine already exists — don't overwrite
      statusLineSkipped = true;
    }
  } else {
    settings.statusLine = {
      type: 'command',
      command: 'claude-cli-monitor-statusline',
    };
    statusLineSet = true;
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return { added, skipped, statusLineSet, statusLineSkipped, settingsPath };
}

// ── Uninstall ──

function isMonitorHook(command: string): boolean {
  return command.includes(HOOK_MARKER);
}

function isMonitorStatusLine(command: string): boolean {
  return command.includes(STATUSLINE_MARKER);
}

interface UnregisterResult {
  file: string;
  hooksRemoved: number;
  statusLineRemoved: boolean;
  fileDeleted: boolean;
}

/**
 * Remove claude-cli-monitor hooks and statusLine from a settings.json file.
 * Handles both formats: `claude-cli-monitor-hook` (npm) and absolute path (old).
 * If the file becomes effectively empty after removal, deletes it.
 */
function unregisterFromFile(settingsPath: string): UnregisterResult | null {
  if (!existsSync(settingsPath)) return null;

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {
    return null;
  }

  let hooksRemoved = 0;
  let statusLineRemoved = false;

  // Remove hooks
  if (settings.hooks && typeof settings.hooks === 'object') {
    const hooks = settings.hooks as Record<string, unknown[]>;
    for (const event of Object.keys(hooks)) {
      if (!Array.isArray(hooks[event])) continue;
      const before = hooks[event].length;
      hooks[event] = hooks[event].filter((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return true;
        const innerHooks = (entry as Record<string, unknown>).hooks as Array<Record<string, string>> | undefined;
        if (!innerHooks) return true;
        return !innerHooks.some(h => h.command && isMonitorHook(h.command));
      });
      hooksRemoved += before - hooks[event].length;
      // Clean up empty event arrays
      if (hooks[event].length === 0) {
        delete hooks[event];
      }
    }
    // Clean up empty hooks object
    if (Object.keys(hooks).length === 0) {
      delete settings.hooks;
    }
  }

  // Remove statusLine
  if (settings.statusLine && typeof settings.statusLine === 'object') {
    const cmd = (settings.statusLine as Record<string, string>).command ?? '';
    if (isMonitorStatusLine(cmd)) {
      delete settings.statusLine;
      statusLineRemoved = true;
    }
  }

  if (hooksRemoved === 0 && !statusLineRemoved) return null;

  // Check if file is now effectively empty (only {} or whitespace keys)
  const remainingKeys = Object.keys(settings);
  if (remainingKeys.length === 0) {
    unlinkSync(settingsPath);
    return { file: settingsPath, hooksRemoved, statusLineRemoved, fileDeleted: true };
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return { file: settingsPath, hooksRemoved, statusLineRemoved, fileDeleted: false };
}

/**
 * Uninstall claude-cli-monitor from CWD/.claude/ only.
 * init writes to CWD scope — uninstall removes from the same scope.
 */
export function runUninstall(): void {
  const localPath = join(process.cwd(), '.claude', 'settings.json');

  const result = unregisterFromFile(localPath);
  const skillsRemoved = unregisterSkills();

  if (!result && skillsRemoved === 0) {
    console.log('Nothing to remove — no claude-cli-monitor settings found in this project.');
    return;
  }

  if (result) {
    const parts: string[] = [];
    if (result.hooksRemoved > 0) parts.push(`${result.hooksRemoved} hooks`);
    if (result.statusLineRemoved) parts.push('statusLine');
    const action = result.fileDeleted ? '(file deleted — was empty)' : '';
    console.log(`${G}✓${R} Removed ${parts.join(' + ')} from ${result.file} ${action}`);
  }
  if (skillsRemoved > 0) {
    console.log(`${G}✓${R} Removed ${skillsRemoved} skills from .claude/skills/`);
  }
}

// ── Main init flow ──

export async function runInit(): Promise<MonitorConfig> {
  const def = getDefaultConfig();
  const tr = getTranslations();

  console.log(`\n${C}${B}${tr.init.welcome}${R}`);
  console.log(`${D}${'─'.repeat(40)}${R}`);

  saveConfig(def);

  // Register hooks + statusLine in project-local settings.json
  const reg = registerSettings();
  if (reg.added > 0) console.log(`${G}✓${R} ${reg.added} hooks registered.`);
  if (reg.skipped > 0) console.log(`${D}  ${reg.skipped} hooks already registered.${R}`);
  if (reg.statusLineSet) console.log(`${G}✓${R} statusLine registered.`);
  console.log(`${D}  → ${reg.settingsPath}${R}`);

  // Register skills in .claude/skills/
  const skills = registerSkills();
  if (skills.installed > 0) console.log(`${G}✓${R} ${skills.installed} skills installed.`);
  if (skills.skipped > 0) console.log(`${D}  ${skills.skipped} skills updated.${R}`);

  console.log(`\n${G}✓${R} ${tr.init.done}`);

  return def;
}
