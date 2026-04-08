/**
 * Agent Display Name Resolver
 *
 * Determines the display name for an agent using a priority chain:
 * 1. subagentType (from SubagentStart hook)
 * 2. agent_type (reserved, currently not in AgentState)
 * 3. Colon parsing from description
 * 4. "agent" fallback
 */

/** Minimal interface accepted by resolveAgentDisplayName (covers AgentState and AgentNode) */
export interface AgentDisplaySource {
  subagentType: string | null;
  description: string | null;
}

/** Built-in agent types — all treated as main's sub-tasks */
const BUILTIN_AGENT_TYPES = new Set([
  'general-purpose', 'Explore', 'Plan', 'claude-code-guide', 'statusline-setup',
]);

/**
 * Returns true if the agent is a built-in type (treated as main's sub-task).
 */
export function isGenericAgent(agent: AgentDisplaySource): boolean {
  return !agent.subagentType || BUILTIN_AGENT_TYPES.has(agent.subagentType);
}

/**
 * Parse role name from "role: task" description pattern.
 * WORKAROUND: Claude Code doesn't expose subagent_type for custom agents.
 * Conditions: colon-separated, role part <= 20 chars, <= 2 spaces in role.
 * Also supports fullwidth colon (U+FF1A).
 * Returns null if pattern doesn't match.
 */
export function parseRoleFromDescription(description: string): string | null {
  // Find separator: half-width ": " or fullwidth "： "
  const i1 = description.indexOf(': ');
  const i2 = description.indexOf('\uFF1A ');
  const sepIdx = (i1 < 0 && i2 < 0) ? -1 : (i1 < 0 ? i2 : (i2 < 0 ? i1 : Math.min(i1, i2)));

  if (sepIdx < 0) return null;

  const role = description.slice(0, sepIdx).trim();
  const isWide = description[sepIdx] === '\uFF1A';
  const task = description.slice(sepIdx + (isWide ? 2 : 2)).trim();

  // Validate: role must be 1-20 chars, <= 2 spaces, and task must exist
  if (!role || !task) return null;
  if (role.length > 20) return null;
  if ((role.match(/ /g) || []).length > 2) return null;

  // If role is a short prefix (no hyphen) and task starts with a hyphenated word,
  // promote the hyphenated word to role (e.g., "STF: code-reviewer 품질검증" → "code-reviewer")
  if (!role.includes('-')) {
    const spaceIdx = task.indexOf(' ');
    const firstWord = spaceIdx > 0 ? task.slice(0, spaceIdx) : null;
    if (firstWord && firstWord.includes('-') && firstWord.length <= 20) {
      return firstWord;
    }
  }

  return role;
}

/**
 * Extract task part from "role: task" description.
 * Returns original description if pattern doesn't match.
 */
export function parseTaskFromDescription(description: string): string {
  const i1 = description.indexOf(': ');
  const i2 = description.indexOf('\uFF1A ');
  const sepIdx = (i1 < 0 && i2 < 0) ? -1 : (i1 < 0 ? i2 : (i2 < 0 ? i1 : Math.min(i1, i2)));

  if (sepIdx < 0) return description;

  const role = description.slice(0, sepIdx).trim();
  const isWide = description[sepIdx] === '\uFF1A';
  const task = description.slice(sepIdx + (isWide ? 2 : 2)).trim();

  if (!role || !task || role.length > 20 || (role.match(/ /g) || []).length > 2) {
    return description;
  }

  // If role is a short prefix (no hyphen) and task starts with a hyphenated word,
  // skip the promoted role word and return the rest as task
  if (!role.includes('-')) {
    const spaceIdx = task.indexOf(' ');
    const firstWord = spaceIdx > 0 ? task.slice(0, spaceIdx) : null;
    if (firstWord && firstWord.includes('-') && firstWord.length <= 20) {
      return task.slice(spaceIdx + 1).trim() || task;
    }
  }

  return task;
}

/**
 * Resolve agent display name using priority:
 * 1. subagentType — if not a built-in type, use as-is (custom agent)
 * 2. description colon parsing — "role: task" → "role"
 *    WORKAROUND: remove when #43456 is resolved
 * 3. generic built-in types → "built-in"
 * 4. "agent" fallback
 */
export function resolveAgentDisplayName(agent: AgentDisplaySource): string {
  // Priority 1: subagentType (custom agent)
  if (agent.subagentType && agent.subagentType !== 'general-purpose') {
    return agent.subagentType;
  }

  // Priority 2: parse colon-separated description
  // WORKAROUND: remove when #43456 is resolved
  if (isGenericAgent(agent) && agent.description) {
    const parsed = parseRoleFromDescription(agent.description);
    if (parsed) return parsed;
  }

  // Priority 3: generic → "built-in"
  if (isGenericAgent(agent)) {
    return 'built-in';
  }

  // Priority 4: fallback
  return 'agent';
}

// ── Model Suffix Helpers ──

/** Minimal interface for model-suffix checks (covers AgentState and AgentNode) */
export interface ModelSource {
  model: string | null;
}

/**
 * Returns a 1-char model suffix: "(H)" for Haiku, "(S)" for Sonnet, "(O)" for Opus.
 * Returns "" if model is null/unknown.
 */
export function getModelSuffix(model: string | null): string {
  if (!model) return '';
  const lower = model.toLowerCase();
  if (lower.includes('haiku')) return '(H)';
  if (lower.includes('sonnet')) return '(S)';
  if (lower.includes('opus')) return '(O)';
  return '';
}

/**
 * Returns true if agents use 2+ distinct non-null models.
 * When true, model suffixes should be displayed.
 */
export function hasMultipleModels(agents: ModelSource[]): boolean {
  const models = new Set<string>();
  for (const agent of agents) {
    if (agent.model) {
      const lower = agent.model.toLowerCase();
      // Normalize to family name for comparison
      if (lower.includes('haiku')) models.add('haiku');
      else if (lower.includes('sonnet')) models.add('sonnet');
      else if (lower.includes('opus')) models.add('opus');
      else models.add(lower);
    }
    if (models.size >= 2) return true;
  }
  return false;
}
