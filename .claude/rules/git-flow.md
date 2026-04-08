# Git flow

> Pulled when planning, staging, or executing any git operation. Referenced from CLAUDE.md "Rules Index". Read in full before any commit or branch operation.

## Branch model

- `main` and `dev` have **unrelated histories** by design. Do not merge across.
- `dev` is the working branch for day-to-day development.
- `main` holds the public-facing distribution (npm-published artifacts, README, LICENSE).
- Sync from `dev` to `main` via `git -C <path> reset --hard dev` followed by `git push --force-with-lease` (only when explicitly authorized for a release).

## Commit format (Conventional Commits)

```
<type>(<scope>): <short summary in imperative present tense>

<optional body — explain why, not what>

<optional footer — Co-Authored-By, refs, breaking changes>
```

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `perf`, `style`.

Examples:
- `fix(parser): handle empty toolUseResult in pass 3 backfill`
- `refactor(state): collapse cleanStoppedAgents into single pass`
- `docs(readme): drop windows-only disclaimer`

Subject rules:
- Imperative mood ("add", not "added" or "adds").
- Lowercase after the type.
- No trailing period.
- ≤ 72 characters.

## Atomic commits

- One logical change per commit. Aim for **1–3 files** per commit.
- A "fix and refactor" is two commits, never one.
- Test changes that accompany a code change live in the same commit.
- A failing build between commits is acceptable temporarily; a failing build at HEAD is not.

## Forbidden operations

| Forbidden | Why |
|----------|-----|
| `--no-verify` | Hooks exist for a reason. If a hook blocks you, fix the cause. |
| `--amend` after push | Rewrites public history. Make a new commit instead. |
| Force push to `main` | Loses work and breaks downstream. Use only with `--force-with-lease` and explicit user authorization. |
| `git reset --hard` on shared branches | Destructive. Allowed only on local feature branches. |
| `git rebase -i` (interactive) | Not supported in non-TTY agent sessions. |
| `git add -A` / `git add .` | Risks committing secrets or junk. Stage by explicit filename. |
| Compound shell commands (`&&`, `;`, `|`) in Bash tool | Project rule. Use individual calls or `git -C` form. |

## Command form

- Always `git -C "<absolute project path>" <subcommand>`. Never `cd && git`.
- One command per Bash invocation. No `&&` chaining.

## Co-authorship trailer

Every commit Claude makes ends with:

```
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

(Or whatever model is currently driving the session — keep the model name accurate.)

## When to commit

- After every 1–3 file logical change. Do not batch.
- Immediately after a green test run for a completed unit of work.
- Before switching branches.
- Before risky operations (large refactors, deletions).

## When NOT to commit

- Build is broken in your working tree.
- Tests you touched are failing.
- Diff contains secrets, debug `console.log`, or unrelated changes.
- You haven't read the actual diff (`git -C <path> diff --cached`).

## Pull-request rules

- PR title follows the same conventional-commits format as a commit subject.
- PR body has two sections: **Summary** (1–3 bullets) and **Test plan** (checklist).
- Never open a PR from `main`. Always `dev` → `main` (or feature → `dev`).
- Never create a PR before the user asks for one.

## Recovery

- If a commit goes wrong before push: `git -C <path> commit --amend` is OK on unpushed commits only.
- If a commit goes wrong after push: make a new commit that fixes the issue. Do not rewrite history.
- If you lose work: `git -C <path> reflog` is your friend.
