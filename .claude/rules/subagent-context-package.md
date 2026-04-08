# Subagent context package

> Pulled by the session master before invoking any subagent via the Agent tool. Referenced from CLAUDE.md "Workflow" section.

## The rule

A subagent has **no memory of the current conversation**. It sees only the prompt you give it. Therefore, every Agent tool invocation must bundle a **context package** that gives the subagent everything it needs — files to read, rules to apply, scope boundaries, and expected output.

"Figure it out" is not a context package.

## Required fields in every context package

Every `Agent` tool invocation's `prompt` parameter must contain **all** of the following. Missing any one is a bug in the delegation, and the subagent is entitled to return "insufficient context" and stop.

### 1. Task description (1–3 sentences)

Plain-language statement of what the subagent is being asked to do. No ambiguity. No nested conditionals.

**Good**:
> "Refactor `src/parser.ts` to extract the 3-pass spawn extraction into three private functions named `collectProgressEvents`, `matchAgentToolUse`, and `backfillFromResults`. Preserve behavior exactly."

**Bad**:
> "Clean up parser.ts if you think it needs it."

### 2. In-scope files (explicit absolute paths)

The exact set of files the subagent may read or edit. No globs, no "the parser area". Absolute paths.

**Good**:
```
In-scope:
- C:\Users\kimty\CLAUDE\_projects\claude_agent_monitor\src\parser.ts
- C:\Users\kimty\CLAUDE\_projects\claude_agent_monitor\src\types.ts
- C:\Users\kimty\CLAUDE\_projects\claude_agent_monitor\test\parser.test.ts
```

If the subagent needs exploratory access to figure out the scope, say so explicitly: "You may read (not edit) any file under `src/` to identify call sites."

### 3. Out-of-scope files (critical)

Files the subagent must **not** touch. Stating this explicitly prevents scope creep. Common entries:

```
Out-of-scope:
- Any file outside src/ and test/
- dist/ (build output)
- node_modules/ (vendor)
- Any other parser or chain file not listed above
```

Always include the defaults from `no-touch-zones.md` by reference.

### 4. Rules to apply (explicit file list)

The rule files the subagent must read and follow. Spell them out.

```
Rules to apply:
- .claude/rules/coding-conventions.md
- .claude/rules/security-rules.md
- .claude/rules/claude-code-reference.md (for parser work)
- .claude/rules/pre-commit-checklist.md (if you will commit)
```

Auto-load rules (`paths:` frontmatter) will still load by path, but **list them anyway** so the subagent knows what context will appear.

### 5. Expected output format

What the subagent should return to the session master. Specify structure.

**Good**:
```
Return:
1. A summary of the changes made (1–3 bullets).
2. The exact list of files changed.
3. Any test results (pass/fail count).
4. Any concerns or findings that need session master attention.
```

**Bad**:
> "Report back when done."

### 6. Success criteria

What "done" looks like in observable terms.

**Good**:
```
Success criteria:
- `npm run build` passes with no errors.
- `npm test` passes (existing 42 tests).
- `parser.ts` has 3 new private functions with the specified names.
- No behavior change detectable by the existing parser.test.ts.
```

### 7. Non-goals

Things the subagent should **not** do even if it seems helpful. Prevents scope creep.

**Good**:
```
Non-goals:
- Do not add new tests (test-engineer handles that in the next step).
- Do not change the public parser API.
- Do not add comments/docstrings to untouched functions.
- Do not refactor chain.ts even if it looks similar.
```

## Template

Copy-paste this template into every Agent tool invocation's `prompt`:

```
## Task
<1–3 sentences>

## In-scope files
- <absolute path>
- <absolute path>

## Out-of-scope files
- <explicit list>
- (Plus all default no-touch zones per .claude/rules/no-touch-zones.md)

## Rules to apply
- <rule file path>
- <rule file path>

## Expected output
<what to return to session master>

## Success criteria
- <observable criterion>
- <observable criterion>

## Non-goals
- <thing not to do>
- <thing not to do>
```

## When a subagent returns "insufficient context"

If a subagent returns without completing because the context package was incomplete:

1. Do **not** retry with the same package. That's the same bug.
2. Identify what was missing.
3. Rebuild the package with the missing information.
4. Re-invoke.

If after a second attempt the subagent still cannot proceed, the task is likely too ambiguous — escalate to the user per the clarification protocol in `intent-classification.md`.

## Session master as context manager

The session master **is** the context manager. No separate manager agent exists (yet). Responsibilities:

- Read each required rule file yourself before building the package, so you can accurately describe what the subagent will see.
- Verify the in-scope file paths actually exist before delegating.
- When the subagent returns, **review the package quality** as part of the retrospective: was any field underspecified? Add an entry to `harness-evolution.md` log if so.

If delegation overhead becomes a bottleneck, promote this role to a dedicated `context-manager` subagent via `harness-evolution.md` — but **not before** it becomes a measurable bottleneck.

## Anti-patterns

| Anti-pattern | Why bad |
|-------------|---------|
| "Look at the code and figure out what needs fixing" | Scope unbounded. Subagent will either do too much or too little. |
| Listing a directory as in-scope ("src/") instead of files | Subagent will touch files you didn't intend. |
| Omitting out-of-scope | Scope creep is guaranteed. |
| "Follow the project rules" without naming them | The subagent doesn't know which rules exist. |
| "Return a summary" without format | You'll get unusable output. |
| Delegating without reading the rules yourself first | You cannot verify the subagent followed them if you don't know them. |
| Reusing a context package from a prior task verbatim | Each task has different files, rules, non-goals. Always rebuild. |
