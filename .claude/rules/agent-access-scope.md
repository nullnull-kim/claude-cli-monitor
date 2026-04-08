# Agent access scope

> Pulled at session start. Referenced from CLAUDE.md "Rules Index". Defines what an AI agent in this project may read, write, and execute. Anything not listed here is **out of scope** and requires explicit user authorization before access.

The principle is **least privilege** with **explicit allow-lists**. When in doubt, ask before acting.

## Read scope (allowed without asking)

| Scope | Examples | Notes |
|-------|---------|-------|
| Project source | `src/**`, `test/**`, `package.json`, `tsconfig.json`, `README.md`, `LICENSE` | Primary work area. |
| Project rules / skills | `.claude/rules/**`, `.claude/skills/**`, `.claude/agents/**`, `CLAUDE.md` | Self-knowledge. |
| Project gitignored work | `tasks/**`, `sessions/**`, `reports/**` (only if they exist) | Internal notes. |
| Git metadata via tools | `git -C <path> log/status/diff/show` | Use git CLI, not direct `.git/` reads. |
| Reference source | `C:\Users\kimty\CLAUDE\claude-code\**` | Read-only reverse-engineered Claude Code source for cross-checking. |
| Auto-memory | `~/.claude/projects/<this project>/memory/**` | Owned by Claude. Read at session start. |

## Read scope — restricted (ask first)

| Scope | Why restricted |
|-------|---------------|
| Sibling projects under `C:\Users\kimty\CLAUDE\_projects\` (other than this one) | Out of project boundary. Each project is its own context. |
| Anything under `~/Documents`, `~/Desktop`, `~/Downloads` | User personal files. |
| `~/.claude-mem/**` (raw DB) | Owned by claude-mem. Use mem-search skill or MCP tools, not direct DB reads. |
| `~/.claude-agent-monitor/state/**` | Runtime state. Read only via the project's own state.ts code, not directly. |
| Other users' home directories | Always forbidden. |

## Write scope (allowed without asking)

| Scope | Examples |
|-------|---------|
| Project source | `src/**`, `test/**` |
| Project docs | `README.md`, `CHANGELOG.md` |
| Project rules / skills | `.claude/rules/**`, `.claude/skills/start-task/**`, `.claude/skills/complete-task/**`, `.claude/skills/release-check/**` |
| Project root config | `CLAUDE.md`, `package.json` (within scope), `tsconfig.json` (within scope), `.gitignore` |
| Korean study mirror | `study/**` (write-only, when explicitly asked to refresh translation; agents must **never read** this directory) |
| Auto-memory | `~/.claude/projects/<this project>/memory/**` (per memory protocol only) |
| Task notes | `tasks/**`, `sessions/**`, `reports/**` (if used) |

## Write scope — restricted (ask first)

| Scope | Why restricted |
|-------|---------------|
| `LICENSE` | Legal text — only on license switch. |
| `.github/workflows/**` | Shared CI infra. |
| `package-lock.json` | Only via `npm install`, never hand-edit. |
| `.claude/agents/**` | Agent definitions are stable contracts. |
| `.claude/settings.local.json` | Per-developer config. |

## Write scope — forbidden (hard deny)

See `no-touch-zones.md` for the full list. Highlights:

- `node_modules/**` — vendor.
- `dist/**` — build output.
- `~/.claude-mem/**` — claude-mem internal.
- `.git/**` — git metadata (use git CLI).
- Any path outside the project unless explicitly listed above.

## Execute scope (Bash tool)

Allowed commands in `.claude/settings.local.json` (current allow-list):

**Always allowed:**
- `npm`, `npx`, `node`, `tsc` — build / test / run.
- `git`, `git -C`, `gh` — version control and GitHub.
- `ls`, `pwd`, `stat`, `file`, `which`, `type`, `test` — read-only inspection (prefer dedicated tools when available).
- `mkdir`, `cp`, `mv`, `chmod` — file management.
- Selected `curl -sL` to specific GitHub raw README URLs.

**Forbidden (deny-list):**
- `rm -rf:*` — recursive delete.
- `git push --force:*` — force push.
- `git reset --hard:*` — destructive reset.

**Dedicated-tool replacements (do not use Bash for these):**
- File search → use `Glob`, not `find` / `ls`.
- Content search → use `Grep`, not `grep` / `rg`.
- Read files → use `Read`, not `cat` / `head` / `tail`.
- Edit files → use `Edit`, not `sed` / `awk`.
- Write files → use `Write`, not `cat <<EOF` / `echo >`.

**Compound command rule:**
- No `&&`, `;`, `|` in Bash invocations. Split into individual calls or use a dedicated tool.

## Network scope

- **No outbound network calls** by default.
- Allowed: `gh` CLI for GitHub operations, `npm` for package operations, `WebFetch` to specific allowed domains in `settings.local.json` (`github.com`, `api.github.com`, `docs.anthropic.com`).
- Forbidden: arbitrary HTTP fetches, telemetry, package fetching from non-npm sources without user confirmation.

## Subagent scope

Subagents inherit this access scope **except** they should not invoke other subagents (one-level delegation only). If a subagent needs nested delegation, return to the session master and let the master orchestrate.

## When the rule blocks legitimate work

If you hit a scope restriction during work:

1. Explain to the user **what** you need to access and **why**.
2. Wait for explicit authorization.
3. Authorization is **session-scoped** by default. The same access in a future session needs new authorization unless the user adds it to a rule file.
4. If a class of access is needed repeatedly, propose updating this rule (per `harness-evolution.md`).

## Authorization rules

- "User said yes once" ≠ "user said yes always". Re-confirm scope when crossing into new territory.
- A subagent's authorization does not extend to the session master and vice versa. Each chain confirms its own.
- When authorization is granted, repeat back the exact scope so the user can correct misunderstandings.
