# Harness evolution — failure-driven feedback loop

> Pulled when something fails (rule miss, agent miss, tool gap, model drift, user correction). Referenced from CLAUDE.md "Rules Index". This is the **meta-rule** that keeps the harness alive.

## Principle

**Add rules in response to actual failures, not anticipated ones.** This is the wikidocs / philschmid rule applied to ourselves: over-rule and the harness becomes brittle and noisy; under-rule and the same mistake recurs. The right level is "every failure produces exactly one durable artifact".

## Failure intake — what counts as a failure?

A failure is **anything that required the user to correct, redo, or rescue work**. Be honest. Common types:

| Class | Example |
|-------|---------|
| **Rule gap** | "We have no rule about X, and I broke X." |
| **Rule misread** | "There is a rule, but I missed it / misapplied it / it was hidden in a wall of text." |
| **Tool gap** | "I needed Y but no tool exists / the tool failed silently." |
| **Agent gap** | "The agent I delegated to didn't have the context it needed." |
| **Model drift** | "I knew the rule and broke it anyway." |
| **User-rejected output** | "The user denied a tool call or asked me to redo something." |
| **Process loop** | "I tried the same broken approach 3+ times before stopping." |
| **Doc/code drift** | "Docs said X, code did Y, neither was wrong but both went stale." |

## Step 1 — Stop and name the failure

The moment a failure is recognized:
1. Pause the current work.
2. Write down (in conversation, not in code yet) one sentence: **"What failed and what was the user-visible impact."**
3. Resist "I'll fix it and move on" — the fix without the rule update guarantees recurrence.

## Step 2 — Classify

Use the table above. Often it's two classes (e.g. rule gap + tool gap). Record both.

## Step 3 — Find the load-bearing change

Ask: **What single rule, tool, agent, or instruction would have prevented this?** Be ruthless about "single". If you need three changes, you have three failures stacked.

Avoid:
- "Be more careful." Rules are not exhortations. They are mechanical checks or pre-loaded text.
- "Read the docs better." If the docs are not loading at the right moment, the rule should change the loading, not the agent's reading habits.
- "Add validation everywhere." Validation goes at boundaries (`security-rules.md`).

## Step 4 — Decide change shape

| Shape | When |
|-------|------|
| **New rule file** in `.claude/rules/` | The failure exposes a new category of decision (e.g. "we have no rule about Z"). |
| **Edit existing rule file** | A rule is right but incomplete or unclear. |
| **Path-based auto-load** | The rule existed but did not load at the right moment. Add `paths:` frontmatter. |
| **Reference from CLAUDE.md** | The rule existed but was not discoverable. Add to Rules Index. |
| **New skill** in `.claude/skills/` | The failure was a workflow that should be invocable as a single command. |
| **New agent** in `.claude/agents/` | A type of work consistently needs a specialized perspective. |
| **Memory entry** | A user preference or project fact that should persist across sessions. |
| **Tool allow-list** | A bash command or fetch domain needed repeatedly. |
| **Delete a rule** | A rule fired wrong, blocked legitimate work, or duplicates another rule. |

**One failure → one change**, by default. Multiple changes require explicit justification.

## Step 5 — Apply the change

- Edit the relevant file.
- If a new rule file, add a Rules Index entry in `CLAUDE.md`.
- If a Korean study mirror exists (`study/`), refresh it in the same task (write-only — do not read the mirror while doing this).
- Commit immediately with a message like:
  ```
  chore(rules): add review-checklist Critical/High waiver protocol

  Failure: code-reviewer reported 4 Critical findings; session master
  silently moved on instead of demanding fixes. Adds explicit waiver-
  with-reason rule to review-checklist.md.
  ```
- The commit message **must name the failure**. This is the audit trail.

## Step 6 — Verify the change took

Before declaring the failure resolved:
- Re-read the affected file. Does it actually load when you'd need it?
- Walk a hypothetical replay: "Next time the same situation happens, what file does the agent read at what step?"
- If the answer is "the agent might still miss it", the change is insufficient.

## Step 7 — Add a regression check (when possible)

- If the failure was in code: add a test (see `bug-incident-response.md`).
- If the failure was in process: see if a `.claude/skills/` checklist can mechanically catch it next time.
- If the failure was in scope/authorization: see if `.claude/settings.local.json` can encode it.

## Anti-patterns

| Anti-pattern | Why it kills the harness |
|-------------|--------------------------|
| Adding a "be careful" rule | Rules that depend on agent willpower don't work. Convert to a mechanical check. |
| Adding 5 rules for 1 failure | Inflates the harness. Future agents drown in noise. |
| Editing CLAUDE.md without updating Rules Index | Buries the rule. It won't load when needed. |
| Skipping the commit message audit trail | Loses the "why this rule exists" history. Future maintainers will delete it. |
| Adding rules for hypothetical failures | Speculation. Wait for the actual failure. |
| Never deleting rules | The harness fossilizes. If a rule has not fired in many tasks and the failure mode no longer occurs, retire it. |
| Updating rules without telling the user | The user is the source of truth on whether the change is correct. |

## Retrospective cadence

The harness should also be reviewed **independently of any single failure**, because some failures are silent (an agent did the wrong thing and nobody noticed).

| Cadence | Trigger | Action |
|---------|--------|--------|
| **Per task** | At task close (DoD) | One sentence: "What was friction in this task?" If anything, run steps 1–6. |
| **Per session** | At session end | Read the session log; flag any moment the user had to correct. |
| **Per release** | Before `npm publish` | Re-read CLAUDE.md and Rules Index. Are there rules that haven't fired in months? Are there pain points missing rules? |
| **Per quarter** | Manual | Read every rule file. Delete dead rules. Merge overlapping rules. |

## Pruning protocol

Rules can grow stale. Apply this when reviewing:

1. Has any work referenced this rule in the last N tasks?
2. Is the failure mode this rule prevents still possible? (Did a tool change make it impossible?)
3. Does another rule already cover this?
4. Is the rule's "why" still valid?

If the answer to all four is no, **delete the rule** and document the deletion in the commit message. Design for deletion (philschmid).

## How this rule self-applies

This rule itself follows its own protocol. If `harness-evolution.md` ever fails to produce a useful change, the failure must be named and the rule edited. That's the loop closing on itself.
