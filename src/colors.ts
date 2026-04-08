/**
 * Agent Color System
 *
 * 17-color ANSI palette. Two configurable slots: main (session) and agents (all sub-agents).
 */

import { type ColorName, type MonitorConfig, VALID_COLORS, COLOR_ANSI } from './config.js';

/**
 * Get the color for an agent type. All sub-agents use config.colors.agents.
 */
export function getAgentColor(config: MonitorConfig, agentType: string): ColorName {
  return config.colors.agents;
}

/**
 * Assign colors to a list of agent types.
 * All agents get config.colors.agents.
 * Returns a map of agentType -> ColorName.
 */
export function assignColors(
  agentTypes: string[],
  config: MonitorConfig,
): Map<string, ColorName> {
  const result = new Map<string, ColorName>();
  for (const agentType of agentTypes) {
    result.set(agentType, config.colors.agents);
  }
  return result;
}

/**
 * Returns true if NO_COLOR environment variable is set (any value).
 * See https://no-color.org/
 */
export function noColor(): boolean {
  return 'NO_COLOR' in process.env;
}

/**
 * Get the ANSI foreground escape sequence for a color.
 * Returns empty string when NO_COLOR is set.
 */
export function colorAnsi(color: ColorName): string {
  if (noColor()) return '';
  if (color === 'orange') return '\x1b[38;5;208m';
  return `\x1b[${COLOR_ANSI[color]}m`;
}

/**
 * Render a colored block character for display.
 * Returns plain block character when NO_COLOR is set.
 */
export function colorBlock(color: ColorName): string {
  if (noColor()) return '\u25A0';
  return `${colorAnsi(color)}\u25A0\x1b[0m`;
}
