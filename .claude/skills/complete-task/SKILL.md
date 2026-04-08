---
name: complete-task
description: Close a work item by running the Definition of Done checklist, executing pre-commit checks, committing, and recording the task. Use whenever you believe a task is finished.
argument-hint: "[task summary]"
disable-model-invocation: false
allowed-tools: Bash, Read, Glob, Grep
---

# complete-task

Run this skill before declaring any work item done. It mechanizes `definition-of-done.md` and `pre-commit-checklist.md` so you can't accidentally skip a gate.

## Step-by-step

### Step 1 — Read the gate rules

- `Read` `.claude/rules/definition-of-done.md`.
- `Read` `.claude/rules/pre-commit-checklist.md`.

Don't skim. Read each item.

### Step 2 — Run the build and tests

If `src/` was touched:
```
npm run build
```

If `src/` or `test/` was touched:
```
npm test
```

Both must exit 0. **Stop and fix** if either fails. Do not continue.

### Step 3 — Walk the DoD mandatory gates

For each item in `definition-of-done.md` "Mandatory gates" section, confirm it is satisfied:
- Build green ✓ (from step 2)
- Tests green ✓ (from step 2)
- Type check clean (no new `any`, no `@ts-ignore`)
- Diff is what you intend
- No-touch zones respected
- Conventions respected
- Security rules respected
- Pre-commit checklist will run in step 5

For each conditional gate that applies, confirm.

### Step 4 — Walk the review gate (when applicable)

If the task is non-trivial:
- Invoke `code-reviewer` agent with the changed files.
- Apply `review-checklist.md`.
- All Critical and High findings must be resolved or explicitly waived with reason.

If the task is risky / cross-cutting:
- Also invoke `devils-advocate` agent.
- Critical findings must be resolved.

### Step 5 — Run the per-commit gate(s)

For each commit in this task (often 1–3 commits, may be more for split work):

1. `Read` `.claude/rules/pre-commit-checklist.md`.
2. Stage the relevant files explicitly by name (no `git add -A`).
3. `git -C "<project path>" status` — confirm intended files are staged.
4. `git -C "<project path>" diff --cached` — read every line.
5. Walk the pre-commit checklist sections 1–8.
6. If everything passes:
   ```
   git -C "<project path>" commit -m "$(cat <<'EOF'
   <conventional commit message>

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
7. `git -C "<project path>" status` and `git -C "<project path>" log -1` to confirm the commit landed.

If the commit fails (hook rejection): do NOT amend. Fix the cause and create a new commit.

### Step 6 — Update the session log

Append to `sessions/YYYY-MM-DD-NNN-session.md`:
- What was done in 1–3 sentences.
- Any decisions taken without user input (so they can be reviewed).
- Any items intentionally deferred.
- Commit hashes touched (`git log -<n> --oneline`).

If there is no session log file for today, create one.

### Step 7 — Report to user

Tell the user:
- What changed (1 sentence).
- Which gates passed (build, tests, review).
- Commit hash(es).
- Any follow-up items (deferred, surfaced bugs, related work).

### Step 8 — Run the harness retrospective

Per `harness-evolution.md` "Per task" cadence:
- Was there friction in this task?
- Did any rule fail to load when it should have?
- Did any rule fire wrongly?
- Did the user have to correct anything?

If yes to any: walk the failure response steps in `harness-evolution.md`. Apply the change in this task or open a follow-up.

## Hard stops

Stop the skill and tell the user if any of the following:
- Build is broken.
- Tests are red.
- Critical/High review finding is unresolved.
- A no-touch zone was modified without authorization.
- The diff contains anything you cannot explain.
