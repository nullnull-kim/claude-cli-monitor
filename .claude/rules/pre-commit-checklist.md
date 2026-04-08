# Pre-commit checklist

> Pulled immediately before every `git commit`. Referenced from CLAUDE.md "Rules Index" and the `complete-task` skill.

This checklist runs **per commit**, not per task. A task that produces three commits runs this checklist three times.

## 1. Look at the diff

- [ ] `git -C "<project path>" status` — only the files you intend are staged. No surprise files.
- [ ] `git -C "<project path>" diff --cached` — read **every line** of the staged diff. If you didn't read it, you don't know what you're committing.
- [ ] No debug `console.log`, `print`, `dbg!`, etc.
- [ ] No commented-out code.
- [ ] No `// TODO` without an issue reference.
- [ ] No accidental `.only` / `.skip` in tests.
- [ ] No leftover `@ts-ignore` / `@ts-expect-error` from debugging.

## 2. Scope check

- [ ] Single logical change. If the diff is doing two things, split into two commits.
- [ ] Aim for **1–3 files**. More than 5 files in one commit needs justification (e.g., a coordinated rename).
- [ ] No unrelated reformatting bundled in.

## 3. Build and test

- [ ] If `src/` changed: `npm run build` is green.
- [ ] If `src/` or `test/` changed: `npm test` is green.
- [ ] If `package.json` changed: `npm install` ran cleanly and `package-lock.json` is staged.
- [ ] If a hook contract changed: tested end-to-end with a real session, not just unit tests.

## 4. Secrets and sensitive data

- [ ] Grep the diff for: `password`, `secret`, `token`, `api_key`, `apikey`, `bearer`, `private`, `BEGIN PRIVATE`, `BEGIN RSA`.
- [ ] No real user IDs, real session paths from `~/.claude/`, or real transcript content in fixtures.
- [ ] No `.env*` files staged (other than `.env.example`).

## 5. No-touch zones

- [ ] No edits in `dist/`, `node_modules/`, `study/`, `~/.claude-mem/`, `~/.claude-agent-monitor/state/`.
- [ ] No edits in `.git/`.
- [ ] If `package-lock.json` is staged, it is the result of `npm install` (not hand-edited).

## 6. Commit message

- [ ] Conventional Commits format: `type(scope): subject`.
- [ ] Imperative present tense, lowercase, ≤ 72 chars, no trailing period.
- [ ] If body exists: explains **why**, not what.
- [ ] If a bug fix: states symptom + root cause + fix (see `bug-incident-response.md` step 9).
- [ ] Co-authored-by trailer for AI commits.

## 7. Command form

- [ ] You will use `git -C "<absolute path>" commit -m ...`. Never `cd && git commit`.
- [ ] One command per Bash invocation. No `&&` chaining.
- [ ] Commit message via HEREDOC for multi-line.

## 8. Forbidden flags

- [ ] No `--no-verify`. If a hook blocks the commit, fix the cause, do not bypass.
- [ ] No `--amend` if the commit has been pushed.
- [ ] No `--no-gpg-sign` unless the user explicitly asked.

## 9. Atomicity safety net

- [ ] After the commit, you will run `git -C "<project path>" status` and `git -C "<project path>" log -1` to confirm the commit landed correctly.
- [ ] If the commit fails (hook rejection, etc.), you will fix the underlying issue and create a **new** commit, not amend.

## Hard stops

If any of the following is true, **do not commit**:

- Build is broken in your working tree.
- Tests you touched are red.
- You found a secret in the diff.
- You haven't read the actual diff line by line.
- The user has not authorized this scope of change.
- The change touches a hard-deny no-touch zone without explicit authorization.
