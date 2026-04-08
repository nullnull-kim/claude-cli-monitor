---
name: start-task
description: Begin a non-trivial work item — recover prior state, confirm scope, surface relevant rules. Use at the beginning of any task expected to take 10+ tool calls or any code-modifying task.
argument-hint: "[brief task description]"
disable-model-invocation: false
allowed-tools: Bash, Read, Glob, Grep
---

# start-task

Run this skill at the beginning of any non-trivial work item. It costs ~30 seconds and prevents the most common failure mode: starting work without recovering prior state.

## What it does

1. **Read prior session state** so you don't redo work or contradict prior decisions.
2. **Confirm scope** with the user — what is in, what is out.
3. **Surface relevant rules** so you read them before editing.

## Step-by-step

### Step 1 — Read recent state

Run these in sequence (each in its own Bash call, no compound commands):

```
git -C "<project path>" log --oneline -10
git -C "<project path>" status
git -C "<project path>" branch --show-current
```

Then read the latest session log:
- Use `Glob` to find `sessions/*.md` sorted by mtime.
- `Read` the most recent one.

If `MEMORY.md` was not auto-loaded this session (rare), read it now.

### Step 2 — Surface rules

For the work area the task touches, list the rules that will auto-load and the rules you should pull manually. Tell the user:

- "I will be working in `src/` so `coding-conventions.md`, `security-rules.md`, and `claude-code-reference.md` will auto-load."
- "I will commit, so before each commit I will pull `pre-commit-checklist.md` and `git-flow.md`."
- "I will close the task with the `complete-task` skill which runs `definition-of-done.md`."

This isn't ceremony — it's a sanity check that the right rules are wired up.

### Step 3 — Confirm scope

Restate the task in one sentence and list:
- **In scope**: what files/areas you will touch.
- **Out of scope**: what you will not touch.
- **Acceptance criteria**: what "done" looks like in concrete terms.
- **Risks / unknowns**: anything that might require user input mid-task.

Wait for user confirmation. Do not start editing until confirmed.

### Step 4 — Decide delegation

- If the task will use 10+ tool calls, plan delegation to the appropriate STF agent (see CLAUDE.md section 9).
- If it's a single-file edit, the session master handles it directly.
- Note your delegation plan in the conversation so the user can correct it.

## When NOT to use this skill

- Pure questions (no edits planned).
- Single-line typo fixes.
- "Show me where X is" exploration tasks — use the Explore agent instead.

## Common mistakes this skill prevents

| Mistake | What this skill does about it |
|--------|------------------------------|
| Starting work without reading prior session | Step 1 forces it |
| Editing src/ without coding-conventions in context | Step 2 confirms auto-load |
| Misunderstanding scope and over-editing | Step 3 forces explicit scope |
| Forgetting to delegate large work | Step 4 forces a delegation plan |
