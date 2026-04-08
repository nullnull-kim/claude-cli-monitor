#!/usr/bin/env node

/**
 * CLI Entry Point for claude-cli-monitor
 *
 * Usage:
 *   claude-cli-monitor [options]
 *
 * Options:
 *   --session <id>     Analyze a specific session by ID
 *   --project <path>   Path to Claude project directory
 *   --latest           Analyze the latest session (default)
 *   --all              Analyze all sessions in the project
 *   --output <path>    Write report to file instead of stdout
 *   --json             Output raw JSON instead of markdown
 *   --list             List available sessions
 *   --help             Show this help message
 */

import { existsSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseSession, findSessionFiles, findClaudeProjectsDir } from './parser.js';
import { buildAgentTree, getMaxDepth, countAgents, filterEmptyAgents } from './chain.js';
import { generateReport } from './report.js';
import { renderTerminalReport, renderSessionList } from './terminal.js';
import { startWatch } from './watch.js';
import { runInit, runUninstall } from './init.js';
import { runConfigCommand } from './config-cli.js';
import type { SessionReport } from './types.js';

function printHelp(): void {
  console.log(`
claude-cli-monitor — Analyze Claude Code subagent token usage

USAGE:
  claude-cli-monitor [options]

OPTIONS:
  --session <id>     Analyze a specific session by ID (UUID prefix match)
  --project <path>   Path to Claude project directory
                     (default: auto-detect from ~/.claude/projects/)
  --latest           Analyze the most recent session (default)
  --all              Analyze all sessions with subagents
  --output <path>    Write report to file instead of stdout
  --json             Output raw JSON data instead of markdown
  --watch            Real-time agent monitoring (live updating)
  --list             List available sessions with agent counts
  --init             Run setup (register hooks, statusLine, skills)
  --uninstall        Remove hooks & statusLine from settings.json
  config [cmd]       Configure settings (model, rows, color, colors)
  --help             Show this help message

EXAMPLES:
  claude-cli-monitor --list
  claude-cli-monitor --latest
  claude-cli-monitor --session 8cc714b0
  claude-cli-monitor --all --output reports/
  claude-cli-monitor --project ~/.claude/projects/my-project --latest
`);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') { args.help = true; }
    else if (arg === '--latest') { args.latest = true; }
    else if (arg === '--all') { args.all = true; }
    else if (arg === '--json') { args.json = true; }
    else if (arg === '--list') { args.list = true; }
    else if (arg === '--show-empty') { args['show-empty'] = true; }
    else if (arg === '--watch') { args.watch = true; }
    else if (arg === '--verbose') { args.verbose = true; }
    else if (arg === '--init') { args.init = true; }
    else if (arg === '--uninstall') { args.uninstall = true; }
    else if (arg === 'config') { args.config = true; args._configArgs = argv.slice(i + 1).join(' '); break; }
    else if (arg === '--session' && argv[i + 1]) { args.session = argv[++i]; }
    else if (arg === '--project' && argv[i + 1]) { args.project = argv[++i]; }
    else if (arg === '--output' && argv[i + 1]) { args.output = argv[++i]; }
    else { console.error(`Unknown option: ${arg}`); process.exit(1); }
  }
  return args;
}

function findProjectDirs(baseDir: string): string[] {
  if (!existsSync(baseDir)) return [];
  return readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => join(baseDir, d.name));
}

/**
 * Find sessions that have subagent directories (worth analyzing).
 */
function findSessionsWithAgents(projectDir: string): Array<{ path: string; sessionId: string; hasSubagents: boolean; mtime: Date }> {
  const sessionFiles = findSessionFiles(projectDir);
  const results: Array<{ path: string; sessionId: string; hasSubagents: boolean; mtime: Date }> = [];

  for (const file of sessionFiles) {
    const sessionId = basename(file, '.jsonl');
    const subagentsDir = join(file.replace(/\.jsonl$/, ''), 'subagents');
    const hasSubagents = existsSync(subagentsDir);
    const stat = statSync(file);
    results.push({ path: file, sessionId, hasSubagents, mtime: stat.mtime });
  }

  return results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

interface AnalysisResult {
  report: SessionReport;
  mainUsage: import('./types.js').TokenUsage;
}

function analyzeSession(sessionPath: string, showEmpty = false): AnalysisResult | null {
  const sessionId = basename(sessionPath, '.jsonl');
  const { messages, agents, mainModel, mainUsage } = parseSession(sessionPath);

  if (agents.size === 0) return null;

  const rawTree = buildAgentTree(sessionPath, messages, agents);
  const tree = showEmpty ? rawTree : filterEmptyAgents(rawTree);
  const maxDepth = getMaxDepth(tree);
  const agentCount = countAgents(tree);

  // Find earliest timestamp
  const firstMsg = messages.find(m => m.timestamp);
  const timestamp = firstMsg?.timestamp ?? 'unknown';

  const report: SessionReport = {
    sessionId,
    sessionDir: sessionPath.replace(/\.jsonl$/, ''),
    timestamp,
    mainModel,
    totalTokens: Array.from(agents.values()).reduce((sum, a) => sum + a.totalTokens, 0),
    totalDurationMs: Array.from(agents.values()).reduce((sum, a) => sum + a.totalDurationMs, 0),
    agents: tree,
    agentCount,
    maxDepth,
  };

  return { report, mainUsage };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  // --init: setup hooks, statusLine, skills
  if (args.init) {
    await runInit();
    return;
  }

  // --uninstall: remove hooks & statusLine
  if (args.uninstall) {
    runUninstall();
    return;
  }

  // config subcommand
  if (args.config) {
    const configArgs = (args._configArgs as string || '').split(/\s+/).filter(Boolean);
    await runConfigCommand(configArgs);
    return;
  }

  // --watch mode: real-time agent monitoring
  if (args.watch) {
    startWatch(args.session as string | undefined);
    return;
  }

  // Determine project directories to scan
  let projectDirs: string[];
  if (args.project) {
    projectDirs = [args.project as string];
  } else {
    const baseDir = findClaudeProjectsDir();
    projectDirs = findProjectDirs(baseDir);
  }

  if (projectDirs.length === 0) {
    console.error('No Claude project directories found.');
    console.error(`Looked in: ${findClaudeProjectsDir()}`);
    process.exit(1);
  }

  // Collect all sessions with agents
  const allSessions: Array<{ path: string; sessionId: string; hasSubagents: boolean; mtime: Date; projectDir: string }> = [];
  for (const dir of projectDirs) {
    const sessions = findSessionsWithAgents(dir);
    for (const s of sessions) {
      allSessions.push({ ...s, projectDir: dir });
    }
  }

  // --list mode
  if (args.list) {
    const withAgents = allSessions.filter(s => s.hasSubagents);
    if (withAgents.length === 0) {
      console.log('No sessions with subagents found.');
      return;
    }
    console.log(renderSessionList(
      withAgents.map(s => ({
        sessionId: s.sessionId,
        mtime: s.mtime,
        projectDir: s.projectDir,
      })),
    ));
    return;
  }

  // Determine which sessions to analyze
  let sessionsToAnalyze: typeof allSessions = [];

  if (args.session) {
    const prefix = args.session as string;
    sessionsToAnalyze = allSessions.filter(s => s.sessionId.startsWith(prefix));
    if (sessionsToAnalyze.length === 0) {
      console.error(`No session found matching: ${prefix}`);
      process.exit(1);
    }
  } else if (args.all) {
    sessionsToAnalyze = allSessions.filter(s => s.hasSubagents);
  } else {
    // Default: latest session with subagents
    const latest = allSessions.find(s => s.hasSubagents);
    if (latest) sessionsToAnalyze = [latest];
  }

  if (sessionsToAnalyze.length === 0) {
    console.error('No sessions with subagents found to analyze.');
    process.exit(1);
  }

  // Analyze
  for (const session of sessionsToAnalyze) {
    const result = analyzeSession(session.path, !!args['show-empty']);
    if (!result) {
      console.error(`No agents found in session: ${session.sessionId}`);
      continue;
    }

    const { report, mainUsage } = result;

    if (args.json) {
      const output = JSON.stringify(report, null, 2);
      if (args.output) {
        const outPath = args.output as string;
        const filePath = outPath.endsWith('/') || existsSync(outPath)
          ? join(outPath, `${session.sessionId.slice(0, 8)}-agents.json`)
          : outPath;
        writeFileSync(filePath, output);
        console.log(`Written: ${filePath}`);
      } else {
        console.log(output);
      }
    } else if (args.output) {
      // File output: markdown
      const md = generateReport(report, mainUsage);
      const outPath = args.output as string;
      const filePath = outPath.endsWith('/') || existsSync(outPath)
        ? join(outPath, `${session.sessionId.slice(0, 8)}-agents.md`)
        : outPath;
      writeFileSync(filePath, md);
      console.log(`Written: ${filePath}`);
    } else {
      // Terminal output: pretty-printed
      console.log(renderTerminalReport(report, mainUsage, !!args.verbose));
    }
  }
}

main();
