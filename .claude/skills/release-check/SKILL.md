---
name: release-check
description: Run all release gates before publishing to npm or pushing to main. Verifies version bump, build, tests, secrets, package contents, and dry-run publish. Required by CLAUDE.md release flow.
argument-hint: "[target version]"
disable-model-invocation: false
allowed-tools: Bash, Read, Glob, Grep
---

# release-check

Run this skill **before every** `npm publish` and **before every** push to `main`. Skipping it has historically caused: shipping uncompiled code, shipping `study/` Korean source files, shipping debug logs, version mismatches that break `npm install`.

## Step-by-step

### Step 1 — Read the gate rules

- `Read` `.claude/rules/ci-cd-gates.md` (specifically L5 — Release check).
- `Read` `.claude/rules/definition-of-done.md` (sanity check).

### Step 2 — Confirm release scope with user

Ask the user:
- **Target version**: what version are we releasing? (semver: major / minor / patch)
- **What changed since the last release** (in 1–3 bullets the user will see in CHANGELOG).
- **Breaking changes**: any? If yes, this must be a major bump.
- **Blockers**: anything outstanding the user wants in this release that isn't merged?

Do not proceed without explicit user authorization for this specific version number.

### Step 3 — Working tree clean

```
git -C "<project path>" status
```

Working tree must be clean. No uncommitted changes. No untracked files (other than gitignored).

### Step 4 — On the right branch

```
git -C "<project path>" branch --show-current
```

Releases come from `dev`. After publish, `dev` is synced to `main`. If you are not on `dev`, stop.

### Step 5 — Version bump

- `Read` `package.json` to confirm current version.
- Confirm the user-requested version matches a clean semver bump from current.
- Update `package.json` `version` field.
- If a `CHANGELOG.md` exists: prepend an entry with the new version, date, and bullets the user provided in step 2.
- If no `CHANGELOG.md` and the project has no convention yet: skip this; do not invent one mid-release.
- Commit:
  ```
  git -C "<project path>" add package.json
  git -C "<project path>" add CHANGELOG.md   # if present
  git -C "<project path>" commit -m "chore(release): vX.Y.Z"
  ```

### Step 6 — Clean rebuild

Delete and rebuild `dist/`:

```
npm run build
```

The build must complete with **no errors and no warnings**. If there are warnings the build script does not fail on, stop and investigate before publishing.

### Step 7 — Full test suite

```
npm test
```

Every test must pass. No skips. No `.only`.

### Step 8 — Audit

```
npm audit --audit-level=high
```

No high or critical findings. Address any before publishing.

### Step 9 — Inspect what npm will ship

```
npm pack --dry-run
```

Walk the file list. Look for:
- `dist/**/*.js` and `dist/**/*.d.ts` — should be present.
- `src/**` — should NOT be present (we ship compiled output).
- `study/**` — must NOT be present (Korean study mirror is human-only).
- `tasks/**`, `sessions/**`, `reports/**` — must NOT be present (gitignored, internal).
- `.env*` — must NOT be present.
- `*.test.js`, `test/**` — usually NOT present in published package; confirm against `package.json` `files` field.
- `node_modules/**` — must NOT be present.
- README, LICENSE, package.json — must be present.

If anything looks wrong, fix `package.json` `files` field or `.npmignore` before continuing.

### Step 10 — Secret sweep on the tarball contents

`npm pack --dry-run` lists files but doesn't show contents. Spot-check the dist files:

- `Grep` for `password`, `secret`, `token`, `api[_-]?key`, `BEGIN PRIVATE`, `BEGIN RSA` across `dist/**`.
- Any hit is a hard stop.

### Step 11 — Dry-run publish

```
npm publish --dry-run
```

No errors. Confirms registry auth is in place and package metadata is valid.

### Step 12 — Final user confirmation

Show the user:
- Version being published.
- File count and total size from `npm pack --dry-run`.
- Test summary (X passed).
- Commit hash that will be tagged.

Ask: **"Proceed with `npm publish`?"** Wait for explicit yes.

### Step 13 — Publish

Only after explicit yes:

```
npm publish
```

### Step 14 — Tag and push

```
git -C "<project path>" tag vX.Y.Z
git -C "<project path>" push origin dev
git -C "<project path>" push origin vX.Y.Z
```

If the release flow includes syncing `main` to `dev` (per project memory), confirm with the user before:

```
git -C "<project path>" checkout main
git -C "<project path>" reset --hard dev
git -C "<project path>" push --force-with-lease origin main
git -C "<project path>" checkout dev
```

`reset --hard` and `push --force-with-lease` are destructive. **Always confirm with the user first**, even if the project memory says this is the standard flow.

### Step 15 — Smoke test (L7)

After publish settles (~30 s):

```
cd /tmp
mkdir release-smoke-vX.Y.Z
cd release-smoke-vX.Y.Z
npm install -g claude-agent-monitor@X.Y.Z
claude-agent-monitor --version
```

Version output must match. A trivial command must run.

If this fails, the release is broken from the user's perspective even though it's on the registry. Open an incident immediately and consider deprecating the broken version with `npm deprecate`.

### Step 16 — Report

Tell the user:
- Version published.
- Tag pushed.
- Smoke test result.
- Anything noteworthy.

## Hard stops

Stop the skill and tell the user if any of the following:
- Working tree is dirty.
- Build has errors or warnings.
- Any test fails.
- `npm audit` finds high/critical.
- `npm pack` includes unexpected files.
- Secret sweep finds anything.
- `npm publish --dry-run` errors.
- User has not explicitly authorized this version.
