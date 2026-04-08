# Auto-refactor protocol

> Pulled by the `auto-refactor` skill and any agent running code-modifying refactor work driven by audit findings. Referenced from CLAUDE.md "Rules Index".

## What "auto-refactor" means here

Auto-refactor is **not** "the agent decides what to improve and edits freely". It is a structured workflow:

1. An audit (convention, dead code, or architecture) produces a **list of findings**.
2. Each finding has a **category** (safe, user-confirm, flag-only).
3. The workflow applies **safe** fixes automatically, **surfaces** the rest for user decision, and **never** ships a fix without the separation-of-duties gate.
4. The output is a **PR**, not a direct commit to `dev` or `main`.

The user is always the merger. Auto-refactor never merges its own PRs.

## Categories

Findings are categorized **before** any code is changed.

### Category 1 — Safe auto-fix

Mechanical transforms with zero behavior change.

Examples:
- Remove unused import.
- Rename a variable to match the naming convention (when the new name is not already used).
- Sort imports.
- Replace `any` with `unknown` in a type position where the cast is trivially valid.
- Replace `==` with `===` (if tests still pass).
- Delete a commented-out code block.

Handling: apply, run tests, commit per auto-refactor commit convention (below).

### Category 2 — User-confirm

Likely correct but has judgment content.

Examples:
- Delete an unused exported symbol (might be used by downstream consumers).
- Extract a repeated block into a helper (is three the right threshold?).
- Rename a public API function (downstream breakage).
- Remove a "dead" code path that may be for a rare case.

Handling: **stop**, present the finding to the user with proposed fix, wait for approval.

### Category 3 — Flag only, never auto-fix

Architectural or cross-cutting issues.

Examples:
- Circular import detected.
- Layer violation (e.g., UI module reaching into state module directly).
- Public API surface growing beyond the module boundary.
- Coupling between modules that should be independent.

Handling: **report only**. Do not attempt to fix. Ask the user to resolve manually or in a dedicated design task.

## Scope limits

Auto-refactor is bounded:

- **Per run**: max 10 findings addressed. More and the PR becomes unreviewable.
- **Per file**: all changes to a single file must be in the same commit (not spread across commits).
- **Per category**: fixes for different categories go in separate commits within the PR. (e.g., "remove unused imports" and "sort imports" are different commits.)
- **No mixed PRs**: one PR per refactor class. A "remove unused code + rename variables" mixed PR is two PRs.
- **No test changes** unless the test itself is obviously broken (typo in assertion). Test changes require user approval per `test-loop.md`.

## PR workflow

### Step 1 — Fresh branch

```
git -C "<project path>" checkout -b refactor/<category>-<short-slug>
```

Branch name pattern: `refactor/conventions-<slug>`, `refactor/dead-code-<slug>`, etc.

### Step 2 — Apply findings in categories

For each finding, in order:

1. Verify the finding is still valid (re-audit the file — files may have changed since audit).
2. Apply the smallest possible change.
3. Run the full test suite.
4. If tests pass: commit.
5. If tests fail: **revert** the change, mark the finding as "blocked by tests", continue with the next finding.

### Step 3 — Separation of duties

After all safe fixes applied, before creating the PR:

- Delegate a review pass to a **different agent** (per `separation-of-duties.md`).
- The reviewer runs `review-checklist.md` on the diff.
- The reviewer's findings must be addressed or explicitly waived in the PR description.

### Step 4 — PR creation

```
git -C "<project path>" push -u origin refactor/<category>-<slug>
gh pr create \
  --base dev \
  --title "refactor(<category>): <short summary>" \
  --body "$(cat <<'EOF'
## Summary
<1–2 bullets describing what the refactor accomplishes>

## Findings applied
- [file:line] <finding>
- [file:line] <finding>

## Findings deferred
- [file:line] <finding> — reason: <reason>

## Findings blocked
- [file:line] <finding> — reason: tests regressed

## Verification
- Full test suite: <pass count> / <total>
- Build: pass
- Reviewer: <agent name>
- Reviewer findings: <critical/high/medium/low counts>

## Waivers
- <waived finding> — reason: <user agreement or deferred>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Step 5 — Never auto-merge

Report the PR URL to the user. **Stop**. The user reviews and merges.

Do not:
- Auto-merge.
- Request review from other humans.
- Close the PR if the user doesn't respond immediately — leave it open.

## Commit message format within the PR

One commit per category of change. Subject lines:

```
refactor(conventions): replace 3 uses of any with unknown
refactor(imports): sort imports in src/parser.ts
refactor(dead-code): delete unused export extractParentMap
```

Commit bodies optional but helpful:

```
refactor(dead-code): delete unused export extractParentMap

No references remain in src/ or test/ per grep. Removing to
reduce surface area per coding-conventions.md "dead code" rule.
```

## Interaction with other rules

- `separation-of-duties.md`: the agent running auto-refactor is the **writer**. Review must be by a different agent.
- `test-loop.md`: if a fix causes tests to regress, the refactor follows test-loop protocol (iteration limit, convergence check). If 3 iterations don't fix it, revert the finding.
- `pre-commit-checklist.md`: applies to every commit in the refactor PR.
- `git-flow.md`: PR base is `dev`, never `main`.
- `harness-evolution.md`: if auto-refactor keeps producing the same class of finding, that is a signal the authoring rules are insufficient. Update the rule, not just the code.

## When to abort

Stop the auto-refactor and escalate to the user if:

- Any single finding has more than 2 iterations of test failure.
- The diff grows beyond 10 files or 200 lines.
- Reviewer reports any Critical finding.
- A Category 3 (architectural) finding is discovered mid-refactor — that is now a design question.
- The user sends any new instruction while the refactor is running.

## Anti-patterns

| Anti-pattern | Why bad |
|-------------|---------|
| Mixing categories in one PR | Unreviewable. Splits focus. |
| Auto-merging | Violates "user is the merger". |
| Skipping the test run between findings | A regression gets blamed on the wrong finding. |
| Self-reviewing (writer is the reviewer) | Violates `separation-of-duties.md`. |
| Applying category 2 findings without user approval | Assumptions become bugs. |
| Attempting to auto-fix category 3 | Architectural fixes need design, not diff. |
| Auto-refactor across branches without a dedicated refactor branch | Pollutes `dev`. |
