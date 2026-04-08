---
name: auto-refactor
description: Run the auto-refactor workflow — audit the code, apply safe fixes in categorized commits, open a PR, and hand off to the user for merge review. Bounded by auto-refactor-protocol.md. Never merges its own PRs.
argument-hint: "[conventions|dead-code|all]"
disable-model-invocation: false
allowed-tools: Bash, Read, Glob, Grep
---

# auto-refactor

Structured refactor workflow driven by `code-auditor` findings. Bounded by `.claude/rules/auto-refactor-protocol.md`. **Never merges its own PRs** — always hands off to the user.

## When to invoke

- After `audit-code` reports findings the user wants addressed automatically.
- Periodic housekeeping before a release.
- User request: "clean up the convention violations", "remove the dead code".

**Do not** invoke for architecture issues (category 3). Those require human design, not automated fixes.

## Step-by-step

### Step 1 — Read the protocol

`Read` `.claude/rules/auto-refactor-protocol.md` in full. Do not skim.

Also read:
- `separation-of-duties.md` (critical — writer ≠ verifier applies)
- `test-loop.md` (for handling test regressions during refactor)
- `pre-commit-checklist.md` (every commit in the PR must pass this)
- `git-flow.md` (branch/commit format)

### Step 2 — Confirm user authorization

Tell the user:
- Which modes will run (conventions, dead-code, or both — **never architecture**).
- The workflow will create a new branch, make commits, and open a PR.
- The user will be asked to approve category-2 findings before they are applied.
- The user will merge the PR (this skill does not auto-merge).

Wait for explicit authorization. Do not proceed without.

### Step 3 — Verify clean working tree + green build/tests

```
git -C "<project path>" status
git -C "<project path>" branch --show-current
npm run build
npm test
```

Requirements:
- Working tree clean.
- Currently on `dev` (not `main` — releases only come from `dev`).
- Build passes.
- All tests pass.

If any of these fail: stop. Report to user. Do not attempt refactor on a broken tree.

### Step 4 — Run the audit

Invoke the `audit-code` skill for the requested modes. Get the full findings report.

### Step 5 — Categorize findings

Per `auto-refactor-protocol.md`, classify each finding:

| Category | Handling |
|---------|----------|
| 1 (safe) | Apply automatically |
| 2 (user-confirm) | Stop, present to user, wait for approval |
| 3 (flag-only) | Report, never auto-fix |

Present the categorization to the user:

```
Findings summary:
- Category 1 (auto-apply): N findings
- Category 2 (needs approval): N findings — listed below
- Category 3 (flag only): N findings — reported, not fixed

Category 2 details:
- <file>:<line> — <finding> — proposed fix: <one line>
- ...

Proceed? Which category-2 items should I include?
```

Wait for the user's answer. The user may say "all", "none", or pick specific items by number.

### Step 6 — Create the refactor branch

```
git -C "<project path>" checkout -b refactor/<category>-<slug>
```

Branch name: use the dominant category + a short slug describing the nature of the refactor. Examples:
- `refactor/conventions-any-to-unknown`
- `refactor/dead-code-unused-exports`
- `refactor/conventions-import-order`

### Step 7 — Apply findings in category groups

For each finding group (one group per commit), in the order: safe → user-approved:

1. Delegate the **edit** to a subagent that is **not** the code-auditor (per separation of duties). The main session is an acceptable writer here; a role agent (`hook-engineer`, `behavioral-designer`) can also be the writer depending on the file area.
2. The writer applies the minimal change.
3. Run `npm run build`. Must pass.
4. Run `npm test`. Must pass.
5. If either fails:
   - If it's a clear test regression caused by the change, **revert** that one change (`git checkout -- <file>`), mark the finding as "blocked by tests" for the PR body, continue with the next finding.
   - If it's a build error from the change, also revert.
   - Do not enter a `test-loop.md` debugging session inside auto-refactor — the loop is for intentional implementation work, not for refactor fix-up. If a refactor regresses, the finding was wrong.
6. If both pass: run `pre-commit-checklist.md` and commit.

Commit message format per group:
```
refactor(<scope>): <short summary>

<optional body explaining which findings this addresses>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

### Step 8 — Separate-duties review

After all commits are made, before opening the PR:

- Delegate review to a **different agent** than the writer (per `separation-of-duties.md`).
- Suggested reviewer: `code-reviewer` agent if main session wrote; `code-reviewer` or a different role agent otherwise.
- The reviewer runs `review-checklist.md` against the branch diff.
- Reviewer findings Critical/High must be addressed in the branch (more commits) or the refactor is aborted.
- Reviewer findings Medium/Low can be listed as "waived — reason" in the PR body.

### Step 9 — Push and create PR

```
git -C "<project path>" push -u origin refactor/<category>-<slug>
```

Then create the PR via `gh` CLI with the body format from `auto-refactor-protocol.md` step 4.

### Step 10 — Hand off to user

Report to the user:
- PR URL.
- Commit count.
- Findings applied / deferred / blocked / waived.
- Reviewer findings summary.
- Any manual follow-ups suggested.

**Stop.** Do not merge. Do not auto-approve. The user decides.

### Step 11 — Cleanup on user decision

- If the user merges: pull the updated `dev` locally, delete the refactor branch.
- If the user rejects: delete the branch locally and remote, report done.
- If the user asks for changes: add commits to the same branch, re-run the separate-duties review.

### Step 12 — Retrospective

Per `harness-evolution.md`:
- Were there category-2 items that should be category-1 in the future? (Promote a finding class to "safe".)
- Were there category-1 items that broke tests? (Demote that finding class to "user-confirm".)
- Did the reviewer find something the auditor missed? (Update `code-auditor.md`.)

## Hard stops

Stop the skill and revert if:

- Build or tests break and a simple revert doesn't restore green.
- Working tree cannot be cleanly managed (conflicts with unstaged changes).
- The user withdraws authorization mid-flow.
- The separate-duties reviewer reports a Critical finding that the writer cannot cleanly address.
- More than 10 findings would be in a single PR (per protocol scope limit — split into multiple runs).
- A category-3 (architectural) finding is discovered mid-run — that's a design task, not auto-refactor.

## What this skill does not do

- Does not run in architecture mode. Architectural refactors need design discussions.
- Does not merge PRs.
- Does not modify tests (unless a test has an obvious typo that the user explicitly approves).
- Does not combine multiple refactor categories into one commit.
- Does not push to `main`.
