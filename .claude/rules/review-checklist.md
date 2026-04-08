# Code review checklist

> Pulled by `code-reviewer` agent and any session master conducting manual review. Referenced from CLAUDE.md "Rules Index".

Reviews that "look fine" without using this checklist are not reviews. Walk every applicable item.

## 1. Correctness

- [ ] The change does what the task asked for. Re-read the task description, then the diff.
- [ ] Edge cases: empty input, single element, duplicates, very large input, malformed input, missing fields.
- [ ] Off-by-one: indexes, slice ranges, loop bounds.
- [ ] Async ordering: are awaits where they need to be? Any race conditions?
- [ ] Error paths: every `throw` has a caller that handles it appropriately.

## 2. Type safety

- [ ] No new `any`. No new unchecked `as` casts. No new `@ts-ignore`.
- [ ] Generics narrow correctly at call sites.
- [ ] Discriminated unions used where multiple variants exist.
- [ ] Public exported types match actual runtime shape (especially for parsed JSON).

## 3. Boundary validation

- [ ] CLI args validated.
- [ ] File reads handle missing files, malformed content, partial reads.
- [ ] JSON.parse wrapped in try/catch at every untrusted source.
- [ ] Hook input validated against schema.

## 4. Conventions (cross-reference `coding-conventions.md`)

- [ ] Naming conventions followed.
- [ ] Imports use `.js` extension for relative paths.
- [ ] No barrel re-exports added gratuitously.
- [ ] Functions are small and single-purpose.
- [ ] Comments explain why, not what.

## 5. Security (cross-reference `security-rules.md`)

- [ ] No secrets in code, tests, fixtures, logs, or commit message.
- [ ] No path traversal risk.
- [ ] No shell command interpolation.
- [ ] No new outbound network calls.
- [ ] New deps audited.

## 6. Tests

- [ ] New code has new tests.
- [ ] Tests assert behavior, not implementation. (Avoid "the function called X then Y" assertions.)
- [ ] Tests cover edge cases listed in section 1.
- [ ] No skipped or commented-out tests.
- [ ] Test names describe the case, not the function.

## 7. Performance

- [ ] No obvious O(n²) or worse on hot paths.
- [ ] No reads of large files into memory when streaming would do.
- [ ] No unnecessary repeated work inside loops.

## 8. Side effects and state

- [ ] State writes go through dedicated state modules, not scattered.
- [ ] No hidden global mutation.
- [ ] File writes are atomic where corruption matters.

## 9. Dead code

- [ ] No commented-out code.
- [ ] No unused imports, variables, parameters, exports.
- [ ] No TODOs without an issue reference.
- [ ] No duplicated logic that should be a shared helper (or, conversely, no extracted helper used only once).

## 10. No-touch zones (cross-reference `no-touch-zones.md`)

- [ ] No edits in `dist/`, `node_modules/`, `study/`, `~/.claude-mem/`, etc.
- [ ] If a soft-deny path was edited, the change is necessary and authorized.

## 11. Documentation

- [ ] User-visible changes reflected in README / `--help`.
- [ ] New conventions reflected in `.claude/rules/`.
- [ ] Commit message accurate and informative.

## Severity classification

Findings must be classified:

| Level | Definition | Action |
|-------|-----------|--------|
| **Critical** | Security flaw, data loss, broken build, crash on common input | Block merge. Must fix. |
| **High** | Wrong behavior in real scenario, type unsoundness, missing test for new code | Block merge. Must fix. |
| **Medium** | Convention drift, suboptimal but correct, missing edge-case test | Should fix; may waive with reason. |
| **Low** | Style nit, optional improvement | May waive freely. |

A review is **complete** when every Critical and High has been resolved or explicitly waived by the session master with a reason.

## Output format

When reporting review findings to the session master, use:

```
[review] {filename}:{line} {severity}: {finding}
  → suggested fix: {one-line suggestion}
```

Group by severity, Critical first.
