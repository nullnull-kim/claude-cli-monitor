# Definition of Done

> Pulled before declaring any task complete. Referenced from CLAUDE.md "Rules Index" and the `complete-task` skill.

A task is **not** done until every applicable item below is satisfied. Skipping items because "the change is small" is the most common failure mode and is forbidden.

## Mandatory gates (every task)

- [ ] **Build green**: `npm run build` exits 0 with no errors and no new warnings.
- [ ] **Tests green**: `npm test` exits 0. New code has new tests. Existing tests still pass.
- [ ] **Type check clean**: no new `any`, no new `as` casts without justification, no new `@ts-ignore` / `@ts-expect-error`.
- [ ] **Diff is what you intend**: `git -C <path> diff --cached` reviewed line by line. No debug logs, no commented-out code, no unrelated changes.
- [ ] **No-touch zones respected**: see `no-touch-zones.md`. If you touched a soft-deny path, the user explicitly authorized it in this session.
- [ ] **Conventions respected**: see `coding-conventions.md`. Naming, error handling, imports.
- [ ] **Security rules respected**: see `security-rules.md`. No secrets, validated boundaries.
- [ ] **Pre-commit checklist run**: see `pre-commit-checklist.md`.

## Conditional gates

| Condition | Gate |
|-----------|------|
| Touched `src/` | Build + tests + type check above |
| Touched `test/` | Tests green; new tests cover the new path |
| Added a runtime dependency | `npm audit` clean; `package-lock.json` updated; license verified |
| Removed code | All references removed (grep before declaring done); no orphan exports |
| User-visible behavior changed | README / `--help` text reflects the new behavior |
| Hook contract changed | Backward-compat note in commit message; integration test added |
| Bug fix | Failing test added before the fix; same test passes after (see `bug-incident-response.md`) |
| Refactor | No behavior change provable by existing tests; new tests not required |
| Public API change | Major version bump in `package.json` if released |

## Review gates (when STF agents are involved)

- [ ] `code-reviewer` Critical/High findings = 0, OR every finding has been addressed in code or explicitly waived in conversation.
- [ ] `devils-advocate` (red team) Critical findings = 0, OR every finding has been addressed.
- [ ] If a `test-engineer` was invoked, its run report shows pass.

Subagents return their findings directly in the session. There are no per-task artifact files (REVIEW.md, REDTEAM.md, etc.) — those were dropped in the harness redesign.

## Documentation

- [ ] If the change affects how a user runs or configures the tool, README is updated in the same task.
- [ ] If the change affects another agent's contract (hooks, state files), CLAUDE.md or the relevant rule file is updated in the same task.
- [ ] If the change introduces a new convention, the relevant `.claude/rules/*.md` is updated in the same task.

## Communication

- [ ] User has been told what changed, in plain language, before the task is closed.
- [ ] Any decisions taken without user input are surfaced for confirmation.
- [ ] Any items intentionally deferred are clearly listed as "not done in this task".

## What "done" does not mean

- "Done" does not mean "I will fix the rest later". Either it's done now, or split a follow-up task explicitly.
- "Done" does not mean "the test I wrote passes". It means the suite passes.
- "Done" does not mean "it works on my machine". It means the gates above are green and verifiable.
