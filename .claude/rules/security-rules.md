---
paths:
  - "src/**"
---

# Security rules

> Auto-loaded when working on `src/**`. These are hard rules — violations block merge.

## Secrets

- Never read, write, log, or commit secret material: API keys, tokens, passwords, private keys, session cookies.
- Secrets enter the process only via environment variables loaded from a developer-managed `.env` (gitignored).
- If you spot a secret in code, history, or output: stop, tell the user, do not continue without instruction.
- `.env`, `.npmrc`, `*.pem`, `*.key` are gitignored. Do not add exceptions.

## Input validation (boundary rule)

Validate at every system boundary. Trust internal code.

| Boundary | What to validate |
|---------|------------------|
| CLI args | Type, range, allowed values, file existence |
| Hook input (stdin JSON) | Schema (zod or manual), required fields, no extra trust |
| File parsing (JSONL transcript, state files) | Per-line JSON.parse in try/catch, schema-shape check |
| External process output | Treat as `unknown` until validated |

Internal function calls do not need defensive validation. That is noise.

## Path safety

- Always `path.resolve` user-supplied paths.
- Verify resolved path stays inside an allowed root before reading or writing. Reject `..` traversal.
- Never construct shell commands by interpolating untrusted strings. Use array form (`spawn(cmd, [arg, arg])`), never `exec(string)`.

## Code execution

- No `eval`, no `new Function(...)`, no dynamic `require` from user-supplied paths.
- No `child_process.exec` with interpolated strings. Use `spawn` / `execFile` with arg arrays.
- No loading config files via `import()` from user-supplied paths.

## File operations

- Validate destination before write/delete.
- Prefer atomic writes (write to temp, rename) for state files.
- Never `rm -rf` or recursive delete from a path containing user input.

## Dependencies

- Pin exact versions for runtime deps in `package.json` (no `^` or `~` for runtime).
- Before adding any new dep: run `npm view <pkg>` to check publisher, age, weekly downloads, and license. Reject suspicious packages.
- Run `npm audit` after every dep change. Address high/critical findings before commit.
- Prefer zero-dep solutions for small needs. Vendor a small util before adding a new dep.

## Network and telemetry

- This project is an offline analysis tool. **No outbound network calls** except where the user explicitly invokes them (e.g., `gh` CLI, future explicit fetch).
- No telemetry, no analytics, no crash reporting beacons. Do not add any "phone home" feature.

## Logging

- Never log secrets, even partial.
- Never log full file paths from `~/.claude` or `~/.claude-agent-monitor` to remote sinks.
- Local debug logs (`.claude/.stop-hook-debug.log` etc.) are gitignored — keep it that way.

## When in doubt

Stop and ask the user. A blocked task is cheaper than a leaked credential.
