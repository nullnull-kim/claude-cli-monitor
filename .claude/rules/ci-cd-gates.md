# CI/CD gates

> Pulled when planning a release, modifying CI workflows, or interpreting a failed gate. Referenced from CLAUDE.md "Rules Index".

## Gate philosophy

Every change passes through a layered set of gates. Each layer is cheaper than the next and catches a different class of failure. **Do not skip layers — they cost almost nothing locally and save real time later.**

```
[ Local edit ]
     ↓
[ L1: type-check on save (npm run dev) ]
     ↓
[ L2: pre-commit checklist (manual) ]
     ↓
[ L3: build + tests (npm run build && npm test) ]
     ↓
[ L4: review-checklist + DoD (when closing a task) ]
     ↓
[ L5: release-check skill (when publishing) ]
     ↓
[ L6: GitHub Actions CI (on push) ]
     ↓
[ L7: post-publish smoke test (npm install + dry run) ]
```

## L1 — Type check (continuous)

- Runs via `npm run dev` (`tsc --watch`).
- Catches: type errors, missing imports, syntax.
- Cost: < 1 s incremental.
- **Never silence** with `// @ts-ignore` or `any`. Fix the cause.

## L2 — Pre-commit checklist (every commit)

- Runs the checklist in `pre-commit-checklist.md`.
- Catches: stray debug code, unrelated changes, secrets, missing tests for changed code, wrong commit scope.
- Cost: ~30 s per commit.
- **Required** before any commit.

## L3 — Build + tests (every commit touching src or test)

- `npm run build` — full TS compile, no errors, no new warnings.
- `npm test` — all tests pass.
- Catches: integration errors across modules, test regression, build-config drift.
- Cost: depends on project size; currently < 30 s.
- **Required** before declaring a task done.
- **Hard rule**: never commit with a broken build or red test.

## L4 — Review + DoD (every closed task)

- Run `definition-of-done.md` checklist.
- For non-trivial changes: invoke `code-reviewer` agent and apply `review-checklist.md`.
- For risky / cross-cutting changes: invoke `devils-advocate` agent.
- Catches: convention drift, missing docs, missed edge cases, security gaps, logic errors a single author wouldn't see.
- Cost: 1–5 min agent time.
- **Required** before declaring a task done.

## L5 — Release check (every release)

- Run the `release-check` skill.
- Verifies: version bump, CHANGELOG, README sync, `dist/` clean rebuild, `npm publish --dry-run`, no `study/` artifacts in tarball, no secrets in tarball.
- Catches: shipping uncompiled code, shipping secrets, version mismatch, broken `npm install` for downstream users.
- Cost: 1–2 min.
- **Required** before `npm publish` and before pushing to `main`.

## L6 — GitHub Actions CI (on push to dev/main)

> Currently planned, not yet enabled. Open a task before any release to set this up.

Required jobs (when implemented):
- `build` — checkout, install, `npm ci`, `npm run build`.
- `test` — `npm test` on the latest LTS Node and Node 18 minimum.
- `lint` — typecheck-only run (`tsc --noEmit`).
- `audit` — `npm audit --audit-level=high` (warn-only initially, gate later).
- `release` (on tag push only) — `npm publish` with `NODE_AUTH_TOKEN`.

CI rules:
- No secrets except `NODE_AUTH_TOKEN` in repository secrets, scoped to release job.
- No deploy steps that depend on user input.
- No `continue-on-error: true` on a required gate.
- Fail loudly: required gates block merge.

## L7 — Post-publish smoke test

After `npm publish`:
- In a clean directory: `npm install -g claude-agent-monitor@latest`.
- Run `claude-agent-monitor --version` and one trivial command.
- If a downstream user could not install or run the new version, you broke main.

## Failure handling

When a gate fails:

1. **Read the actual error**, do not skim. Most agent failures here are from skipping the actual error message.
2. **Fix the cause, not the gate.** Lowering gate strictness is forbidden.
3. **Add a regression test** if the failure is a logic bug.
4. **Update a rule** if the failure was a process gap (`harness-evolution.md` step 3).

## Hard rules

- Never bypass a gate to "unblock" yourself. The gate exists to block exactly this.
- Never disable a test to make a build pass.
- Never run `npm publish --force`. Investigate why force is being asked for.
- Never commit during a red test run, even with `--no-verify`.
- Never push to `main` without L5 having passed in the same session.
