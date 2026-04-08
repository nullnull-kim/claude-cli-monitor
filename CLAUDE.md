# claude-agent-monitor — project rules

> This file is the **router**. It is intentionally short. It tells you what exists and where to read in detail. **Do not put detailed rules here** — put them in `.claude/rules/*.md` and link from the Rules Index below.

## 0. Inheritance from root rules

- The root `~/CLAUDE.md` "session-start GitHub issue monitoring" rule is **disabled** in this project.
- All other root rules (tool-use rules, general-purpose subagents) remain in effect.

## 1. Project overview

| | |
|---|---|
| **Name** | claude-agent-monitor |
| **Purpose** | CLI tool that analyzes Claude Code subagent token usage and visualizes agent chain trees |
| **Stack** | TypeScript (ES2022, Node16 modules), Node.js 18+ |
| **Distribution** | npm package `claude-agent-monitor`, global install or `npx` |
| **License** | MIT |

Core capabilities:
- Parse transcript JSONL → extract per-agent token usage
- Reconstruct agent chain tree (parent-child relationships)
- Per-agent cost estimation
- Terminal tree visualization + markdown report generation
- Real-time monitoring (hook-based statusline)

## 2. Build and run

```bash
npm run build          # tsc → dist/
npm run dev            # tsc --watch
npm start              # node dist/cli.js
npm test               # node --test test/*.test.js
```

## 3. Directory layout

```
src/                 # TypeScript source
test/                # Tests + fixtures
dist/                # Build output (gitignored)
.claude/
  agents/            # STF agent definitions (7 roles + validator)
  rules/             # Project rules — auto-loaded by path or pulled by reference
  skills/            # Invocable skill workflows
sessions/            # Session logs (gitignored)
reports/             # Design docs, bug reports (gitignored)
study/               # Korean translation / reference mirror — NEVER read by agents (gitignored)
```

There is no `tasks/` ceremony. Subagents return their findings directly to the session master in conversation. Per-task artifact files were retired in the 2026-04 harness redesign.

## 4. Rules Index

Every detailed rule lives in its own file. Read it when the trigger applies. Auto-load rules load themselves via `paths:` frontmatter — you don't need to remember to read them.

### 4.1 Discipline rules (read proactively)

| File | Trigger | What it covers |
|------|---------|----------------|
| `.claude/rules/intent-classification.md` | **pulled at the start of every user turn (step 0)** | Classify user utterance, clarification protocol, ambiguity handling |
| `.claude/rules/separation-of-duties.md` | pulled before any verification step | Writer ≠ verifier. Main session cannot self-review. |
| `.claude/rules/test-loop.md` | pulled when implementing any behavior change with a test | Write→test→fix loop, iteration limit, convergence check |
| `.claude/rules/subagent-context-package.md` | pulled before invoking any subagent | 7 required fields for every delegation |
| `.claude/rules/auto-refactor-protocol.md` | pulled when running auto-refactor | Category rules, PR workflow, scope limits |
| `.claude/rules/harness-evolution.md` | pulled when something fails (rule miss, agent miss, etc.) | Failure → rule update feedback loop |

### 4.2 Code and security rules (auto-load)

| File | Trigger | What it covers |
|------|---------|----------------|
| `.claude/rules/coding-conventions.md` | auto-load on `src/**`, `test/**` | TypeScript style, naming, errors, async, comments |
| `.claude/rules/security-rules.md` | auto-load on `src/**` | Secrets, input validation, path safety, deps, network, logging |
| `.claude/rules/claude-code-reference.md` | auto-load on `src/**` | Reverse-engineered Claude Code source guide for hook + parser work |

### 4.3 Scope and boundary rules

| File | Trigger | What it covers |
|------|---------|----------------|
| `.claude/rules/no-touch-zones.md` | pulled at session start, before any non-`src/` write | Hard-deny and soft-deny paths |
| `.claude/rules/agent-access-scope.md` | pulled at session start | What the agent can read / write / execute / network |

### 4.4 Git and gate rules

| File | Trigger | What it covers |
|------|---------|----------------|
| `.claude/rules/git-flow.md` | pulled before any git operation | Branch model, commit format, atomicity, forbidden ops |
| `.claude/rules/pre-commit-checklist.md` | pulled before every `git commit` | Per-commit gate checklist |
| `.claude/rules/definition-of-done.md` | pulled before declaring a task done | Mandatory + conditional gates for closing a task |
| `.claude/rules/review-checklist.md` | pulled by `code-reviewer` agent and any manual review | 11-point review walk + severity classification |
| `.claude/rules/bug-incident-response.md` | pulled the moment a bug is reported or discovered | 10-step root-cause-fix protocol |
| `.claude/rules/ci-cd-gates.md` | pulled when planning a release or interpreting a failed gate | L1–L7 gate model |

### 4.5 Skills

Skills in `.claude/skills/` are invocable workflows — they run a checklist for you:

| Skill | When to invoke |
|-------|---------------|
| `start-task` | Beginning of a non-trivial work item |
| `complete-task` | Closing a work item — runs DoD + pre-commit |
| `release-check` | Before `npm publish` or pushing to `main` |
| `audit-code` | Run static audits (conventions / dead-code / architecture). Read-only. |
| `auto-refactor` | Audit + apply safe fixes + open PR. Never auto-merges. |

## 5. Memory: two coexisting systems

This project uses **both** memory systems intentionally. They serve different purposes:

| System | Owner | Location | Used for |
|--------|-------|----------|---------|
| **Auto-memory** | Claude itself | `~/.claude/projects/<this project>/memory/MEMORY.md` + per-topic `.md` | User preferences, feedback corrections, project-specific facts that should be in every session prompt. Index auto-loads. |
| **claude-mem** | claude-mem system | `~/.claude-mem/` (SQLite + Chroma) | Cross-session transcript summaries, captured automatically by hooks. Searched on demand via mem-search skill / MCP tools. |

Rules:
- Auto-memory is **active**. Read and update it per the system memory protocol. Do not bulk-edit, do not disable.
- claude-mem is **active**. Query via mem-search when you need historical context that isn't in auto-memory.
- If a fact belongs in both, write it to auto-memory (durable, prompt-loaded) and let claude-mem capture context naturally.
- See `no-touch-zones.md` for the access constraints on each store.

## 6. Core algorithm — agent spawn extraction + tree reconstruction

Agent data processing has 2 stages. **This section must survive compaction** — it's the load-bearing knowledge for the entire parser.

### 6.1 Spawn extraction (`parser.ts` `extractAgentSpawns()`) — 3-pass

1. **Pass 1 — collect progress events**: from `agent_progress` type progress messages, build `{agentId → parentToolUseID}` map
2. **Pass 2 — match Agent tool_use**: match assistant message Agent `tool_use` blocks against the Pass 1 map to confirm `{agentId → AgentNode}`
3. **Pass 3 — backfill**: when progress events are absent, use `toolUseResult.sourceToolAssistantUUID` to link result→spawn

### 6.2 Tree build (`chain.ts` `buildAgentTree()`)

- Build assistant UUID → agentId map, then link parent-child using `parentAssistantUUID` and compute depth.

**Caution**: do not confuse `sourceToolAssistantUUID` (result→spawn link, parser.ts) with `parentAssistantUUID` (child→parent link, chain.ts).

## 7. Data sources

- **Transcript JSONL**: `~/.claude/projects/{project}/sessions/{sessionId}/transcript.jsonl`
  - `toolUseResult` field contains per-agent `totalTokens`, `totalDurationMs`, `totalToolUseCount`, detailed `usage`
- **Subagent directory**: `sessions/{sessionId}/subagents/agent-{id}.jsonl` (subagents have `isSidechain: true`)
- **State file**: `~/.claude-agent-monitor/state/{sessionId}/agent-{agentId}.json`
  - Turn tracking via `turn-marker.json` managing `turnNumber`; `cleanStoppedAgents()` performs turn-based cleanup

## 8. Terminology

| Term | Meaning |
|------|---------|
| **main session** / `session (main)` | Root Claude session. Identified internally as `__main__`. |
| **AgentNode** | Parsed subagent unit. The `AgentNode` interface in `types.ts`. |
| **SessionReport** | Whole-session analysis output. Agent array + aggregate stats. |
| **chain tree** | Parent-child reconstructed agent hierarchy. |
| **statusline** | Bottom Claude Code status bar showing live agent info. |
| **STF** | Special Task Force. The 7-role subagent review formation. |

## 9. Subagent roles (STF)

Registered roles live in `.claude/agents/` and are invoked via `subagent_type`.

| Role | Model | Responsibility |
|------|-------|---------------|
| **project-lead** | opus | Decisions, priorities, design direction |
| **code-reviewer** | opus | Code review, security check, type soundness |
| **hook-engineer** | sonnet | Hook design/impl, Claude Code hook API integration |
| **behavioral-designer** | sonnet | UX, init/config dialogs, display formatting |
| **test-engineer** | sonnet | Test authoring/execution, fixture management |
| **git-master** | sonnet | Commit planning (file list + message), invoked when 5+ files change |
| **devils-advocate** | opus | Red-team review, bias detection, fact check, counter-arguments |
| **code-auditor** | sonnet | Static audit (conventions / dead-code / architecture). Read-only. One mode per call. |
| **artifact-validator** | haiku | Output rule conformance check |

**Calling rules**:
- Omit the `model` parameter when invoking — the agent definition's model is used. Manual override is forbidden.
- Subagents return findings **directly in conversation** to the session master. There are no per-task artifact files.
- One level of delegation only. A subagent does not invoke further subagents — it returns to the master, who decides next.

## 10. Workflow

### 10.0 Intent classification (step 0 of every user turn)

Before anything else, classify the user's utterance per `.claude/rules/intent-classification.md`. The 6 classes (A code work, B investigation, C question, D meta/config, E design/planning, F ambiguous) determine whether you act, investigate, answer, or ask a clarifying question.

- **Class A (code work)** → proceed to 10.1.
- **Class B/C/D/E** → respond without editing files unless the user explicitly asks.
- **Class F (ambiguous)** → ask at most 3 clarifying questions per the protocol before proceeding.

Never skip step 0. A misclassified utterance is the root cause of most scope-creep bugs.

### 10.1 Session master role

The session master receives user requests, decomposes them, delegates to appropriate agents.

- Receive request → split into work items → list multiple items, process first one
- **The session master does not implement directly** when the work item exceeds the delegation threshold (10+ tool calls). Implementation is delegated to the role agent that owns the relevant area.
- The session master is the **context manager** for every delegation — see `subagent-context-package.md`.

### 10.2 Delegation rules

- **Tasks expected to use 10+ tool calls** must be delegated to a subagent.
- Delegate: multi-file edits, code generation, test authoring/execution, codebase exploration, review.
- Do not delegate: single-file read/edit, config changes, short analyses.
- When invoking STF for review, run **each role as a separate subagent**. Do not collapse multiple reviewers into one.
- **Every** Agent tool invocation must carry a full context package per `.claude/rules/subagent-context-package.md` (task, in-scope files as absolute paths, out-of-scope, rules, expected output, success criteria, non-goals). A subagent entitled to return "insufficient context" if any field is missing — and will.

### 10.3 Workflow patterns

**Feature implementation:**
```
user request → session master (decompose, name scope)
  → hook-engineer / behavioral-designer (implement)
  → code-reviewer (review-checklist.md)
  → test-engineer (test + run)
  → git-master if 5+ files (commit plan, master executes)
  → user report
```

**Design review / STF:**
```
user request → session master (form STF)
  → project-lead + code-reviewer + hook-engineer + behavioral-designer + devils-advocate run in parallel
  → session master synthesizes individual reports → user report
```

**Bug fix:** see `bug-incident-response.md` (10-step protocol).

**Issue reporting (anthropics/claude-code):**
```
discover → draft note → user approval → gh issue create → record number in section 14
```

### 10.4 User confirmation rule

Confirm with the user only in these cases:
1. A worker reported "cannot do this".
2. A worker reported "needs change".
3. A design decision is needed (trade-off, direction).
4. After investigating / reviewing / analyzing, before starting modifications.

Outside of these 4 cases, proceed without asking.

### 10.5 Team voice convention

When forwarding subagent output to the user, prefix with `[team claude-agent-monitor, <role>]` so the user knows which voice produced what.

### 10.6 Separation of duties (writer ≠ verifier)

Per `.claude/rules/separation-of-duties.md`: **the agent that wrote code may not be the agent that verifies it.** Non-negotiable for anything above the trivial-edit exemption.

- If the **main session** writes code, the review must be delegated to a subagent (`code-reviewer` by default).
- If a subagent writes code, the reviewer must be a **different** agent.
- The `complete-task` skill enforces this gate — it refuses to close a work item when the writer and reviewer are the same identity.
- `code-auditor` is inherently a verifier (read-only) and cannot be both writer and auditor of the same change.

### 10.7 Test loop discipline

Per `.claude/rules/test-loop.md`: when implementing a behavior change covered by a test, run the write→test→fix loop until tests pass or the loop is aborted for non-convergence.

- Iteration cap: **5**.
- Convergence check after each iteration. Same failure twice → stop. Oscillating failures → stop. New regression in an unrelated test → revert and stop.
- Never modify the test to make it pass. Tests only change when the spec itself changes, and only with user approval.
- Loop is for intentional implementation work. `auto-refactor` fixups do **not** enter the loop — a regressing refactor is a wrong finding and must be reverted.

## 11. Source change recording

- Every source change must produce a git commit. No exceptions for size.
- Commits are made without per-commit user permission, **provided** the changes are within an authorized work item.
- Commit per 1–3 file logical change, immediately after Write/Edit. Do not batch up the whole task.
- See `git-flow.md` and `pre-commit-checklist.md` for the rules each commit must pass.

## 12. Session logging

- At session end, write to `sessions/YYYY-MM-DD-NNN-session.md`.
- `NNN` is the next number for the day.
- This is gitignored — local-only running log.

## 13. Session start protocol

- Read the latest `sessions/` file to recover prior session state.
- `git -C "<project path>" log --oneline -10` to confirm recent commits.
- Read `MEMORY.md` (auto-loaded by system) — index of project memory.
- If a referenced work item is in flight, continue it.

## 14. Claude Code source reference

Reference source: `C:\Users\kimty\CLAUDE\claude-code` (reverse-engineered, may diverge from actual Claude Code). Use as cross-check, never as ground truth.

Detailed reference guide is in `.claude/rules/claude-code-reference.md` (auto-loads on `src/`).

## 15. Outstanding upstream issues

| Problem | Status |
|--------|--------|
| `/clear` leaves agent UI artifacts | **#43918 filed** |
| `SubagentStart` missing `model` field | **not filed** |
| `PostToolUse` missing `description` field | **not filed** |

## 16. Project limitations

- Post-session analysis tool primarily; statusline gives partial real-time.
- Depth-3+ chains limited because `parent_agent_id` is not exposed.
- Compacted sessions may have incomplete agent token data.
- Teammate / swarm agents not tracked.
- Cost estimation is approximate (public list price).

## Compaction directives

When auto-compacting, preserve the following intact:
- Section 4 (Rules Index) — agents need to know what rules exist and how they load. Especially the discipline rules in 4.1.
- Section 5 (Memory: two coexisting systems) — auto-memory + claude-mem coexistence is non-obvious.
- Section 6 (Core algorithm) — load-bearing parser knowledge.
- Section 8 (Terminology) — `__main__` identifier and STF definition.
- Section 9 (Subagent roles) — 9 roles + calling rules + "direct return, no artifacts".
- Section 10 (Workflow) — **especially** 10.0 intent classification, 10.2 context package requirement, 10.6 separation of duties, 10.7 test loop discipline.
- Section 11 (Source change recording).
- Section 15 (Outstanding upstream issues) — issue numbers and filing status.
- The fact that `node_modules/claude-diet/` is **not** this project's rules.
- The fact that `study/` is **never read by agents** — Korean translation / reference mirror for the human only.
- The existence and purpose of these discipline rules (do not lose the pointers): `intent-classification.md`, `separation-of-duties.md`, `test-loop.md`, `subagent-context-package.md`, `auto-refactor-protocol.md`, `harness-evolution.md`.
- Any work item the user is awaiting confirmation on.
