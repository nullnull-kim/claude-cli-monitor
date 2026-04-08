/**
 * /monitor config — Interactive + One-liner dual mode
 *
 * Commands:
 *   config              Show all settings
 *   config model        Interactive model select | config model short/full
 *   config rows         Interactive rows select  | config rows N
 *   config color        Interactive color flow   | config color main/agents <color>
 *   config colors       Show available color palette
 */

import * as readline from 'node:readline';
import { type MonitorConfig, type ModelDisplay, type ColorName, loadConfig, saveConfig, VALID_COLORS, colorEscape } from './config.js';
import { getTranslations, t, type Translations } from './i18n/index.js';
import { colorBlock } from './colors.js';

const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const G = '\x1b[32m';

// ── Input helpers ──

function sanitizeInput(raw: string): string {
  return raw.slice(0, 10).replace(/[^\x20-\x7E]/g, '').trim();
}

function parseIntSafe(s: string, min: number, max: number): number | null {
  const n = parseInt(s, 10);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

// ── Display current config ──

function showConfig(config: MonitorConfig, tr: Translations): void {
  console.log(`\n${B}${tr.config.title}${R}`);
  console.log(`${D}${'─'.repeat(40)}${R}`);
  console.log(`  Model:         ${config.model.display}`);
  console.log(`  Max rows:      ${config.rows}`);
  console.log(`  Cost column:   ${config.cost.enabled ? 'on' : 'off'}`);
  console.log(`  Auto-save:     ${config.report.autoSave ? 'on' : 'off'}`);
  console.log(`\n  ${B}Colors:${R}`);
  console.log(`    main:    ${colorBlock(config.colors.main)} ${config.colors.main}`);
  console.log(`    agents:  ${colorBlock(config.colors.agents)} ${config.colors.agents}`);
  console.log(`    builtin: ${colorBlock(config.colors.builtin)} ${config.colors.builtin}`);
  console.log('');
}

// ── One-liner handlers ──

async function handleModelOneliner(arg: string, config: MonitorConfig, tr: Translations): Promise<void> {
  if (arg !== 'short' && arg !== 'full') {
    console.log(`  ${tr.config.invalidValue} (short | full)`);
    return;
  }
  config.model.display = arg as ModelDisplay;
  saveConfig(config);
  console.log(`  ${G}✓${R} model.display = ${arg}`);
}

async function handleRowsOneliner(arg: string, config: MonitorConfig, tr: Translations): Promise<void> {
  const n = parseIntSafe(arg, 1, 50);
  if (n === null) {
    console.log(`  ${tr.config.invalidValue} (1-50)`);
    return;
  }
  config.rows = n;
  saveConfig(config);
  console.log(`  ${G}✓${R} rows = ${n}`);
}

async function handleColorOneliner(args: string[], config: MonitorConfig, tr: Translations): Promise<void> {
  if (args.length < 2) {
    console.log(`  Usage: config color main <color>  |  config color agents <color>`);
    return;
  }
  const target = args[0];
  if (target !== 'main' && target !== 'agents' && target !== 'builtin') {
    console.log(`  ${tr.config.invalidValue} Target must be 'main', 'agents', or 'builtin'.`);
    return;
  }
  const colorName = args[1] as ColorName;
  if (!VALID_COLORS.includes(colorName)) {
    console.log(`  ${tr.config.invalidValue} Valid: ${VALID_COLORS.join(', ')}`);
    return;
  }
  config.colors[target] = colorName;
  saveConfig(config);
  console.log(`  ${G}✓${R} colors.${target} = ${colorBlock(colorName)} ${colorName}`);
}

// ── Arrow-key select ──

function arrowSelect(title: string, options: string[], defaultIndex: number = 0): Promise<number> {
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
      } else if (s === '\x03' || s === 'q') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        resolve(-1); // cancelled
      }
    };

    process.stdin.on('data', onData);
  });
}

// ── Interactive color flow ──

async function handleColorInteractive(config: MonitorConfig, tr: Translations): Promise<void> {
  const targets: Array<{ key: 'main' | 'agents' | 'builtin'; label: string }> = [
    { key: 'main', label: 'main' },
    { key: 'agents', label: 'agents' },
    { key: 'builtin', label: 'builtin' },
  ];

  // Step 1: arrow-key select target (main / agents)
  const targetOptions = targets.map(t => {
    const color = config.colors[t.key];
    return `${t.label.padEnd(12)} ${colorBlock(color)} ${color}`;
  });

  const targetIdx = await arrowSelect('Colors', targetOptions);
  if (targetIdx < 0) {
    console.log(`  ${tr.config.quit}`);
    return;
  }

  const target = targets[targetIdx];
  const currentColor = config.colors[target.key];

  // Step 2: show color palette, arrow-key select color
  console.log(`\n  ${B}${target.label}${R}  ${tr.config.currentColor} ${colorBlock(currentColor)} ${currentColor}`);

  const colorOptions = VALID_COLORS.map(c => `${colorBlock(c)} ${c}`);
  const currentIdx = VALID_COLORS.indexOf(currentColor);

  const colorIdx = await arrowSelect(tr.config.availableColors, colorOptions, currentIdx >= 0 ? currentIdx : 0);
  if (colorIdx < 0) {
    console.log(`  ${tr.config.quit}`);
    return;
  }

  const newColor = VALID_COLORS[colorIdx];
  console.log(`\n  ${target.label}: ${colorBlock(currentColor)} ${currentColor} → ${colorBlock(newColor)} ${newColor}`);

  config.colors[target.key] = newColor;
  saveConfig(config);
  console.log(`  ${G}✓${R} ${tr.init.applied}`);
}

// ── Color palette display ──

function showColorPalette(): void {
  const half = Math.ceil(VALID_COLORS.length / 2);
  for (let i = 0; i < half; i++) {
    const c1 = VALID_COLORS[i];
    const num1 = String(i + 1).padStart(3);
    const label1 = `${colorBlock(c1)} ${c1}`;
    const j = i + half;
    if (j < VALID_COLORS.length) {
      const c2 = VALID_COLORS[j];
      const num2 = String(j + 1).padStart(3);
      console.log(`  ${num1}. ${label1.padEnd(28)} ${num2}. ${colorBlock(c2)} ${c2}`);
    } else {
      console.log(`  ${num1}. ${label1}`);
    }
  }
}

function handleColorsCommand(): void {
  console.log(`\n${B}Available Colors (${VALID_COLORS.length})${R}\n`);
  showColorPalette();
  console.log('');
}

// ── Main entry ──

export async function runConfigCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const tr = getTranslations();

  if (args.length === 0) {
    showConfig(config, tr);
    return;
  }

  const subCommand = args[0];
  const subArgs = args.slice(1);

  switch (subCommand) {
    case 'model':
      if (subArgs.length > 0) {
        await handleModelOneliner(subArgs[0], config, tr);
      } else {
        // Interactive: simple prompt
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const input = sanitizeInput(await question(rl, `  Model display (short/full) [${config.model.display}]: `));
        rl.close();
        if (input) await handleModelOneliner(input, config, tr);
      }
      break;

    case 'rows':
      if (subArgs.length > 0) {
        await handleRowsOneliner(subArgs[0], config, tr);
      } else {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const input = sanitizeInput(await question(rl, `  ${tr.init.rowsPrompt} [${config.rows}]: `));
        rl.close();
        if (input) await handleRowsOneliner(input, config, tr);
      }
      break;

    case 'color':
      if (subArgs.length >= 2) {
        await handleColorOneliner(subArgs, config, tr);
      } else {
        await handleColorInteractive(config, tr);
      }
      break;

    case 'colors':
      handleColorsCommand();
      break;

    default:
      console.log(`  Unknown config command: ${subCommand}`);
      console.log(`  Available: model, rows, color, colors`);
  }
}
