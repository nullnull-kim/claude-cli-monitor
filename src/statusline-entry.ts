#!/usr/bin/env node

/**
 * Statusline Entry Point — Agent Table Only
 *
 * Reads Claude Code statusLine JSON from stdin, extracts session_id,
 * renders the agent monitoring table, and outputs to stdout.
 *
 * This is intentionally minimal: it only renders the agent table.
 * Users may have their own statusline setup for model/ctx/cost/rate-limits;
 * this command does not interfere with those.
 *
 * Usage in Claude Code settings.json:
 *   {
 *     "statusLine": {
 *       "type": "command",
 *       "command": "claude-cli-monitor-statusline"
 *     }
 *   }
 *
 * If the user already has a statusLine command, they can call this
 * from their own script and append the output.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig, colorEscape, COLOR_ANSI, VALID_COLORS, type ColorName } from './config.js';
import { readSessionState } from './state.js';
import type { AgentState, SessionState } from './state.js';
import { resolveAgentDisplayName, parseRoleFromDescription, parseTaskFromDescription, isGenericAgent, hasMultipleModels, getModelSuffix } from './resolver.js';

// ── ANSI codes ──

const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const Y = '\x1b[33m';
// P (prefix color) is resolved per-session via sessionPrefixColor()

// Box-drawing characters
const V = '\u2502';
const H = '\u2500';
const LJ = '\u251c';
const RJ = '\u2524';
const BL = '\u2514';
const BJ = '\u2534';
const BR = '\u2518';
const CR = '\u253c';

// ── Terminal width (PowerShell cache for Windows hook context with no TTY) ──

function getTermCols(): number {
  const cachePath = join(homedir(), '.claude-cli-monitor', '.term-width');
  const TTL = 60_000;

  try {
    if (existsSync(cachePath)) {
      const stat = statSync(cachePath);
      if (Date.now() - stat.mtimeMs < TTL) {
        const v = parseInt(readFileSync(cachePath, 'utf-8'), 10);
        if (v > 0) return v;
      }
    }
  } catch { /* cache miss */ }

  // Cache miss: call PowerShell (Windows only)
  if (process.platform === 'win32') {
    try {
      const r = execSync(
        'powershell.exe -NoProfile -NonInteractive -Command "(Get-Host).UI.RawUI.WindowSize.Width"',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 3000 },
      );
      const v = parseInt(r.trim(), 10);
      if (v > 0) {
        try { writeFileSync(cachePath, String(v)); } catch { /* non-fatal */ }
        return v;
      }
    } catch { /* fallback */ }
  }

  // Unix: try stdout columns
  if (process.stdout.columns && process.stdout.columns > 0) {
    return process.stdout.columns;
  }

  return 120;
}

// ── Visual width (CJK-aware) ──

function visualWidth(s: string): number {
  const clean = s.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of clean) {
    const p = ch.codePointAt(0)!;
    w += isWideChar(p) ? 2 : 1;
  }
  return w;
}

function isWideChar(p: number): boolean {
  return (
    (p >= 0x1100 && p <= 0x115F) ||   // Hangul Jamo
    (p >= 0x2E80 && p <= 0x303E) ||   // CJK Radicals, Kangxi, Ideographic Description
    (p >= 0x3040 && p <= 0x33BF) ||   // Hiragana, Katakana, Bopomofo, Hangul Compat Jamo
    (p >= 0x3400 && p <= 0x4DBF) ||   // CJK Unified Ideographs Extension A
    (p >= 0x4E00 && p <= 0x9FFF) ||   // CJK Unified Ideographs
    (p >= 0xA960 && p <= 0xA97F) ||   // Hangul Jamo Extended-A
    (p >= 0xAC00 && p <= 0xD7AF) ||   // Hangul Syllables
    (p >= 0xF900 && p <= 0xFAFF) ||   // CJK Compatibility Ideographs
    (p >= 0xFE10 && p <= 0xFE19) ||   // Vertical Forms
    (p >= 0xFE30 && p <= 0xFE6F) ||   // CJK Compatibility Forms
    (p >= 0xFF01 && p <= 0xFF60) ||   // Fullwidth Forms
    (p >= 0x1F1E0 && p <= 0x1F1FF) || // Regional Indicator Symbols (flags)
    (p >= 0x1F300 && p <= 0x1F64F) || // Misc Symbols/Pictographs + Emoticons
    (p >= 0x1F680 && p <= 0x1F6FF) || // Transport & Map Symbols
    (p >= 0x1F900 && p <= 0x1FAFF) || // Supplemental Symbols & Pictographs
    (p >= 0x20000 && p <= 0x2FA1F)    // CJK Extension B-F, Compat Supplement
  );
}

function pad(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - visualWidth(s)));
}

function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  let w = 0;
  for (let i = 0; i < chars.length; i++) {
    const p = chars[i].codePointAt(0)!;
    const cw = isWideChar(p) ? 2 : 1;
    if (w + cw > max - 1) return chars.slice(0, i).join('') + '\u2026';
    w += cw;
  }
  return s;
}

// ── Token formatting ──

function fmtTokens(n: number): string {
  if (!n || n === 0) return '-';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

// ── Time formatting ──

function fmtTime(startedAt: string | null, stoppedAt: string | null): string {
  if (!startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm' + String(sec % 60).padStart(2, '0') + 's';
  return Math.floor(sec / 3600) + 'h' + String(Math.floor((sec % 3600) / 60)).padStart(2, '0') + 'm';
}

// ── Color helpers ──

/** Vibrant colors for header prefix — excludes dim, gray, white (hard to read) */
const PREFIX_POOL: ColorName[] = VALID_COLORS.filter(
  c => c !== 'dim' && c !== 'gray' && c !== 'white',
);

/** Simple hash → index for deterministic per-session color */
function hashToIndex(s: string, len: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return ((h % len) + len) % len;
}

/** Per-session random prefix color for the "Agents" header */
function sessionPrefixColor(sessionId: string): string {
  return colorEscape(PREFIX_POOL[hashToIndex(sessionId, PREFIX_POOL.length)]);
}

function agentColor(cfg: ReturnType<typeof loadConfig>): string {
  const agentsColor = cfg.colors?.agents;
  if (agentsColor) {
    return colorEscape(agentsColor);
  }
  return '\x1b[38;5;208m'; // fallback orange
}

function builtinColor(cfg: ReturnType<typeof loadConfig>): string {
  const c = cfg.colors?.builtin;
  if (c) return colorEscape(c);
  return colorEscape('red'); // fallback
}

// ── Model abbreviation ──

function modAbbr(model: string | null): string {
  if (!model) return '-';
  const l = model.toLowerCase();
  if (l.includes('opus')) return 'Opus';
  if (l.includes('sonnet')) return 'Snnt';
  if (l.includes('haiku')) return 'Haik';
  return model.replace(/^claude-/, '').slice(0, 5);
}

// ── Live color ──

function getLiveColor(cfg: ReturnType<typeof loadConfig>): string {
  const liveColorCfg = cfg.liveColor ?? 'bright-green';
  if (liveColorCfg === 'neon-cycle') return '\x1b[1;92m';
  const cn = COLOR_ANSI[liveColorCfg as keyof typeof COLOR_ANSI];
  return cn ? '\x1b[1;' + cn + 'm' : '\x1b[1;92m';
}

// ── Main rendering ──

function renderAgentTable(sessionId: string, termCols: number, sessionModel?: string): string[] {
  const cfg = loadConfig();
  const state = readSessionState(sessionId);
  if (!state || state.totalCount === 0) return [];

  const P = sessionPrefixColor(sessionId);

  const agents = [...state.agents];
  const staleTh = cfg.staleThresholdMs ?? 900_000;
  const maxRows = (typeof cfg.rows === 'number' ? cfg.rows : (cfg.rows as unknown as Record<string, number>)?.value) ?? 5;
  const neonColor = getLiveColor(cfg);
  const MC = colorEscape((cfg.colors?.main) ?? 'red');
  const BC = builtinColor(cfg);
  const AC = agentColor(cfg);

  const hasActive = agents.some(a =>
    a.status === 'active' && !(a.lastUpdated && (Date.now() - new Date(a.lastUpdated).getTime() > staleTh)),
  );

  // Sort: active first
  agents.sort((a, b) => a.status === 'active' ? -1 : b.status === 'active' ? 1 : 0);

  // Responsive breakpoints: 120+ → 5col(+Model), 80-119 → 4col, <60 → compact
  const showModel = termCols >= 120;
  const showTask = termCols >= 80;

  // Compact mode for very narrow terminals
  if (termCols < 60) {
    const activeCount = agents.filter(a =>
      a.status === 'active' && !(a.lastUpdated && (Date.now() - new Date(a.lastUpdated).getTime() > staleTh)),
    ).length;
    const stoppedCount = agents.length - activeCount;
    const pfx = (hasActive
      ? ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][Math.floor(Date.now() / 100) % 10]
      : '\uD83E\uDD16') + ' ';
    return [`${P}${pfx}Agents: ${activeCount} active${stoppedCount ? `, ${stoppedCount} done` : ''}${R}`];
  }

  // Detect model mix for suffix display
  const modelFamilies = new Set<string>();
  for (const a of agents) {
    const ml = (a.model ?? '').toLowerCase();
    if (ml.includes('haiku')) modelFamilies.add('H');
    else if (ml.includes('sonnet')) modelFamilies.add('S');
    else if (ml.includes('opus')) modelFamilies.add('O');
    else if (ml) modelFamilies.add(ml);
  }
  const showSuffix = modelFamilies.size >= 2;
  const getSuffix = (model: string | null): string => {
    if (!showSuffix || !model) return '';
    return getModelSuffix(model);
  };

  // Headers and column caps
  const hdrs = showModel
    ? ['Status', 'Agent', 'Model', 'Task', 'Used']
    : ['Status', 'Agent', 'Task', 'Used'];
  const maxCap = showModel ? [30, 20, 8, 80, 8] : [30, 20, 80, 8];
  const taskIdx = showModel ? 3 : 2;

  // Build row data
  interface RowData { cells: string[]; active: boolean; tokens: number }
  const dataRows: RowData[] = [];

  for (const a of agents) {
    const isStale = a.status === 'active' && a.lastUpdated &&
      (Date.now() - new Date(a.lastUpdated).getTime() > staleTh);
    const generic = isGenericAgent(a);

    // Status column
    let st: string;
    if (isStale) {
      st = `${Y}\u26a0 stale${R}`;
    } else if (a.status === 'active') {
      st = `${neonColor}◉ LIVE${R}`;
    } else if (a.stoppedAt) {
      const dur = fmtTime(a.startedAt, a.stoppedAt);
      st = `${D}\u2713 done(${dur})`;
    } else {
      st = `${D}\u2713 done`;
    }

    // Agent + Task columns (parse role:task from description)
    const rawType = a.subagentType ?? '-';
    const rawDesc = a.description ?? '-';
    const sfx = showModel ? '' : getSuffix(a.model ?? sessionModel ?? null);
    const sfxVw = sfx ? 3 : 0;

    let tp: string;
    let desc: string;

    if (generic) {
      // All built-in agents show "built-in" uniformly
      tp = BC + 'built-in' + R + sfx;
      const parsedRole = a.description ? parseRoleFromDescription(a.description) : null;
      if (parsedRole) {
        desc = truncate(parseTaskFromDescription(a.description!), maxCap[taskIdx]);
      } else {
        desc = truncate(rawDesc, maxCap[taskIdx]);
      }
    } else {
      // Custom agent type
      const parsedRole = a.description ? parseRoleFromDescription(a.description) : null;
      const displayType = parsedRole ?? rawType;
      tp = AC + truncate(displayType, maxCap[1] - sfxVw) + R + sfx;
      desc = truncate(
        a.description ? parseTaskFromDescription(a.description) : '-',
        maxCap[taskIdx],
      );
    }

    const tok = fmtTokens(a.approxTokens ?? 0);

    if (showModel) {
      const mdl = modAbbr(a.model ?? sessionModel ?? null);
      dataRows.push({ cells: [st, tp, mdl, desc, tok], active: a.status === 'active' && !isStale, tokens: a.approxTokens ?? 0 });
    } else {
      dataRows.push({ cells: [st, tp, desc, tok], active: a.status === 'active' && !isStale, tokens: a.approxTokens ?? 0 });
    }
  }

  // Apply row limit
  const overflow = dataRows.length > maxRows ? dataRows.length - maxRows : 0;
  const visibleRows = overflow > 0 ? dataRows.slice(0, maxRows) : dataRows;

  // Dynamic column widths
  const cw = new Array(hdrs.length).fill(0);
  for (let c = 0; c < hdrs.length; c++) {
    cw[c] = Math.max(visualWidth(hdrs[c]), ...visibleRows.map(r => visualWidth(r.cells[c])));
  }

  // Flex-expand Task column
  const boxOH = cw.length * 3 + 1;
  const usedW = cw.reduce((s: number, w: number) => s + w, 0) + boxOH;
  const flexRemain = termCols - usedW;
  if (flexRemain > 0) cw[taskIdx] += flexRemain;

  const tblW = cw.reduce((a: number, w: number) => a + w + 3, 0) + 1;

  // Render helpers
  const row = (cells: string[]): string =>
    V + cells.map((c, i) => ' ' + pad(c, cw[i]) + ' ').join(V) + V;
  const dimRow = (cells: string[]): string =>
    V + cells.map((c, i) => ' ' + D + pad(c, cw[i]) + R + ' ').join(V) + V;
  const hln = (l: string, m: string, r: string): string =>
    l + cw.map((w: number) => H.repeat(w + 2)).join(m) + r;

  // Build output lines
  const lines: string[] = [];
  const spin = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][Math.floor(Date.now() / 100) % 10];
  const pfx = (hasActive ? spin : '\uD83E\uDD16') + ' Agents ';
  const lineW = Math.max(0, tblW - visualWidth(pfx));

  lines.push(`${P}${pfx}${R}${H.repeat(lineW)}`);
  lines.push(row(hdrs.map(hd => `${B}${hd}${R}`)));
  lines.push(hln(LJ, CR, RJ));

  for (const r of visibleRows) {
    if (r.active) lines.push(row(r.cells));
    else lines.push(dimRow(r.cells));
  }

  if (overflow > 0) {
    const hiddenTok = dataRows.slice(maxRows).reduce((s, r) => s + (r.tokens ?? 0), 0);
    lines.push(`${D}  ... ${overflow} more (${fmtTokens(hiddenTok)})${R}`);
  }

  lines.push(hln(BL, BJ, BR));

  return lines;
}

// ── Stdin reader ──

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    }, 50);

    process.stdin.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    process.stdin.on('error', () => {
      clearTimeout(timeout);
      resolve('');
    });

    if (process.stdin.readableEnded) {
      clearTimeout(timeout);
      resolve('');
    }
  });
}

// ── Main ──

async function main(): Promise<void> {
  try {
    const input = await readStdin();
    if (!input.trim()) {
      process.exit(0);
    }

    const data = JSON.parse(input);
    const sessionId: string | undefined = data.session_id;
    if (!sessionId) {
      process.exit(0);
    }

    // Skip if context was just cleared (0-1% = fresh session, no agents yet)
    const usedPct = Math.round(data.context_window?.used_percentage ?? 0);
    if (usedPct <= 1) {
      process.exit(0);
    }

    const termCols = getTermCols();
    const sessionModel: string | undefined = data.model?.display_name;
    const lines = renderAgentTable(sessionId, termCols, sessionModel);

    for (const line of lines) {
      console.log(line);
    }
  } catch {
    // Silent failure — never block Claude Code
    process.exit(0);
  }
}

main();
