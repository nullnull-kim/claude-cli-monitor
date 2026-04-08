---
name: audit-code
description: Run static audits on the project source — conventions, dead code, and architecture. Produces a severity-classified report without modifying any file. Use before releases, when inheriting a codebase, or when you suspect drift.
argument-hint: "[conventions|dead-code|architecture|all]"
disable-model-invocation: false
allowed-tools: Bash, Read, Glob, Grep
---

# audit-code

Read-only static audit. Runs the `code-auditor` subagent in one or more modes and returns a consolidated report. Does **not** edit files — that is the job of `auto-refactor`.

## When to invoke

- Before a release (part of `release-check` flow).
- After inheriting a codebase or large merge.
- When `harness-evolution.md` suggests repeated drift is happening.
- On user request ("audit the code", "any dead code?", "any architecture issues?").

## Arguments

| Arg | Behavior |
|-----|----------|
| `conventions` | Run convention audit only |
| `dead-code` | Run dead-code audit only |
| `architecture` | Run architecture audit only |
| `all` or empty | Run all three modes in sequence |

## Step-by-step

### Step 1 — Confirm scope with user

Tell the user:
- Which modes will run.
- That the audit is **read-only** and will not change any files.
- That findings will be reported with severity, not automatically fixed.

Wait for confirmation if this is a user-initiated audit. Skip confirmation if called from `release-check` or `auto-refactor`.

### Step 2 — Verify working tree is clean

```
git -C "<project path>" status
```

A dirty working tree makes "dead code" findings unreliable — recent edits may not have been re-referenced yet. Ask the user to commit or stash before proceeding.

### Step 3 — Build first (optional but recommended)

```
npm run build
```

A clean build ensures the TypeScript source is in a known-compilable state. Some audit checks (especially architecture circular-import detection) depend on a valid module graph.

### Step 4 — Assemble the context package

Per `subagent-context-package.md`, prepare the package for the `code-auditor` agent. Include:

- **Task**: "Run the `<mode>` audit on the project source."
- **In-scope**: `src/**`, `test/**` (read access), `package.json`, `tsconfig.json`.
- **Out-of-scope**: all default no-touch zones.
- **Rules**: `coding-conventions.md`, `security-rules.md` (for mode 1), `claude-code-reference.md`.
- **Output format**: per code-auditor spec (severity-classified markdown).
- **Success criteria**: full source walked, findings reported with severity.
- **Non-goals**: no edits, no fix proposals beyond one-line hints.

### Step 5 — Invoke code-auditor for each requested mode

Use the Agent tool with `subagent_type: code-auditor`. One invocation per mode — do not batch modes into one call (per agent spec).

For `all`: three separate invocations, in order: conventions → dead-code → architecture.

### Step 6 — Consolidate findings

Merge the outputs into one report:

```
# Audit report — <date>
# Modes run: <list>
# Total findings: <n> critical, <n> high, <n> medium, <n> low

## Mode: conventions
<auditor output>

## Mode: dead-code
<auditor output>

## Mode: architecture
<auditor output>
```

### Step 7 — Report to user

Present the consolidated report. Group findings by severity across all modes so the user sees Criticals first.

For each Critical and High finding, ask the user:
- **Fix now**: invoke `auto-refactor` for the safe ones, start a manual fix task for the rest.
- **Defer**: open a follow-up task.
- **Waive**: document the reason.

Do not propose fixes automatically — that crosses into `auto-refactor` territory.

### Step 8 — Retrospective

Per `harness-evolution.md`, ask:
- Are the same findings appearing repeatedly across audits? That's a signal the rule or the author process needs updating.
- Is a mode producing mostly noise? Tighten the audit criteria in `code-auditor.md`.

## Hard stops

Stop and tell the user if:

- The build fails before audit can run.
- The working tree is dirty and the user declines to commit/stash.
- A mode returns zero findings for a repo that has known issues — this suggests the auditor is broken, not that the code is perfect.
- Any audit mode fails to execute (tool error, agent refusal).

## What this skill does not do

- It does not fix anything. That is `auto-refactor`'s job.
- It does not trigger reviews or tests. Those run independently.
- It does not write to the repo. It reads and reports.
