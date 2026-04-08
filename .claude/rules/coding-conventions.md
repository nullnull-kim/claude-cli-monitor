---
paths:
  - "src/**"
  - "test/**"
---

# Coding conventions

> Auto-loaded when working on `src/**` or `test/**`. Read in full before editing or generating code in those paths.

## TypeScript baseline

- Target: **ES2022**, module: **Node16** (NodeNext-style ESM).
- `strict: true` is non-negotiable. Do not relax `strictNullChecks`, `noImplicitAny`, or `strictFunctionTypes`.
- Never use `any`. Use `unknown` at untyped boundaries and narrow with type guards.
- Avoid `as` casts. If you must cast, leave a one-line comment explaining why narrowing isn't possible.
- ESM imports require explicit `.js` extensions for relative paths (e.g. `import { foo } from './bar.js'`). The `.js` is intentional even for `.ts` source.

## Naming

| Kind | Convention | Example |
|------|-----------|---------|
| Variables, functions | camelCase | `parseTranscript`, `agentNode` |
| Types, interfaces, classes | PascalCase | `AgentNode`, `SessionReport` |
| File names | kebab-case | `parser.ts`, `state-file.ts` |
| Constants (module-level immutables) | UPPER_SNAKE_CASE | `MAX_DEPTH`, `DEFAULT_ROWS` |
| Test files | mirror source + `.test.ts` | `parser.test.ts` |

Names should match behavior. Rename rather than add a comment to compensate.

## Functions

- Prefer small, single-responsibility functions. If a function has more than ~50 lines or more than one "and" in its description, split it.
- Prefer pure functions. Side effects (file I/O, state writes) live in clearly named modules (`state.ts`, `sessionStorage.ts`).
- Return early on error/edge cases. Avoid deeply nested `if` chains.
- One return value type. Don't overload return shape based on input flags.

## Errors

- Throw typed `Error` subclasses where the caller needs to distinguish causes. Use `cause` to chain underlying errors.
- Never throw a string literal.
- Catch only at boundaries (CLI entry points, hook handlers, top-level event handlers). Internal modules let errors propagate.
- Never silently swallow errors. If an error is intentionally ignored, log it with a reason.

## Async

- Use `async`/`await`. Do not chain `.then()` for new code.
- Always `await` promises in async functions (no fire-and-forget unless explicitly justified with a comment).
- Use `Promise.all` for independent parallel work, sequential `await` only when there is a real dependency.

## Imports

- Sort imports: node built-ins → external packages → internal absolute → internal relative.
- No barrel re-exports for the sake of indirection. Import from the module that owns the symbol.
- No circular imports. If you hit one, the boundary is wrong — extract a third module.

## Comments

- Comment **why**, not **what**. The code already shows what.
- Delete commented-out code. Git history is the archive.
- No JSDoc on internal functions unless the type signature is genuinely insufficient.
- `TODO` and `FIXME` must include an issue number or owner. Untracked TODOs are forbidden.

## Dead code

- If you remove a feature, remove its code, types, tests, and config. Do not leave shims or `// removed` comments.
- Unused exports are dead code. Delete them.

## What NOT to do

- Do not add features, refactors, or "improvements" that were not requested.
- Do not add error handling, fallbacks, or validation for cases that cannot happen given the call sites. Trust internal code.
- Do not introduce one-off helper modules for single use sites. Inline first; extract only on the third repetition.
- Do not add backward-compatibility shims unless the user explicitly asks for them. This project breaks freely on major bumps.
