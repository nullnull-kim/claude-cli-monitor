# Intent classification and clarification

> Pulled at the **start of every user turn**, before any action. This is step 0 of every response. Referenced from CLAUDE.md "Workflow" section.

## Why this exists

Every user turn must be classified before work begins. Skipping this step is the most frequent cause of "wasted turn" — the agent starts coding when the user only asked a question, or starts answering when the user wanted action, or dives into implementation when the request was actually ambiguous.

Classification is mandatory. It takes seconds. It prevents tens of minutes of wrong work.

## Taxonomy — 6 classes

| Class | Description | Example |
|-------|-------------|---------|
| **A. Code work** | Modify, create, or delete code/files in the project. Has an imperative verb + a clear target. | "Add a `--json` flag to the CLI" |
| **B. Investigation** | Read-only exploration of the codebase. Answer is extracted from files, not invented. | "Where is the statusline renderer?" |
| **C. Question / explanation** | Explain something. No code change. Answer is reasoning, not exploration. | "How does the 3-pass spawn extraction work?" |
| **D. Meta / config / harness** | Configure the tool, update rules, change settings, discuss workflow. | "Add a rule about X" |
| **E. Design / planning** | Architectural decision, trade-off discussion, direction selection. Report findings, wait for user choice. | "Should we cache parsed transcripts?" |
| **F. Ambiguous** | Not enough information to classify as A–E with confidence. Must ask clarifying questions. | "Make it faster" |

## Decision flow

Run these questions in order. Stop at the first **yes**.

1. **Does the message contain an imperative that targets code/files AND is the target clear AND are the acceptance criteria clear?**
   → Class **A** (code work). Proceed to `start-task` skill.

2. **Does the message ask "where", "which file", "find", "show me" about the codebase?**
   → Class **B** (investigation). Read-only tools only. Report findings, do not modify.

3. **Does the message ask "how", "why", "what does", or request an explanation of existing behavior?**
   → Class **C** (question). Answer directly. No file modifications.

4. **Does the message target configuration, rules, CLAUDE.md, skills, agents, settings, or workflow itself?**
   → Class **D** (meta). Proceed, but record any rule change per `harness-evolution.md`.

5. **Does the message ask "should we", "which approach", "A or B", or request an architectural decision?**
   → Class **E** (design). Investigate → report trade-offs → present options → wait for user choice. Do not implement until chosen.

6. **None of the above, OR you stopped at a "yes" but are < 90% sure the target/criteria are clear.**
   → Class **F** (ambiguous). Go to the clarification protocol below.

## Handling per class

| Class | Entry action | Output expected |
|-------|-------------|------------------|
| A | `start-task` skill | Scope confirmation → implementation → `complete-task` |
| B | Read, Grep, Glob only | Report findings. Do not touch code. |
| C | Direct answer from knowledge + files | Prose answer. No tool use unless needed to verify. |
| D | Direct handling or skill invocation | Rule/config change + explanation. Follow `harness-evolution.md` if adding a rule. |
| E | Investigate → present options | Trade-off table + recommendation. Wait for explicit choice. |
| F | Clarification protocol (below) | 1–3 questions. Then re-classify. |

## Clarification protocol (for class F)

When a request is ambiguous, do **not** guess. Ask the user clarifying questions.

### Rules

- **Maximum 3 questions per round.** More than 3 feels like an interrogation.
- **Each question must be answerable with a short phrase.** Not open-ended essays.
- **Provide options when possible.** "Do you want A or B?" is faster to answer than "What do you want?"
- **One concept per question.** Never chain two concepts with "and".
- **Do not ask about things you can determine from the files.** Read first, then ask.
- **Do not ask for permission to proceed.** Ask for information you need, not approval to continue.
- **Do not ask about things the user has already stated.** Re-read the message before asking.

### What to ask

Prioritize in this order:
1. **Scope**: which files/areas? If the user said "it", what is "it"?
2. **Direction**: option A or B, when multiple are plausible?
3. **Acceptance criteria**: what does "done" look like to you?
4. **Constraints**: anything that limits the approach? (Breaking changes OK? Perf budget? Deadline?)
5. **Blockers**: are there prerequisites the user hasn't mentioned?

### Format

Use `AskUserQuestion` when the question has discrete choices. Use plain prose when the question is short-answer.

Good:
> "The CLI already has a `--format` flag with values `tree` and `json`. Do you want the new behavior under a new value (e.g., `--format=flat`) or a separate flag (e.g., `--flat`)?"

Bad:
> "Can you clarify what you want?" (too vague)
> "What's the use case for this feature and who benefits and how should it interact with existing features and...?" (too many concepts)

### After clarification

Once the user answers, **re-classify**. Ambiguity is resolved → usually the message is now class A or E. Proceed normally from there.

## Anti-patterns

| Anti-pattern | Why bad |
|-------------|---------|
| Skipping classification and jumping to code | You will implement the wrong thing. |
| Classifying silently and not confirming | The user can't correct a classification you didn't tell them about. Surface your classification briefly ("reading this as class A — add a flag to `src/cli.ts`"). |
| Asking clarifying questions when the answer is in the files | Read first. |
| Asking more than 3 questions at once | Feels like an interrogation. Two rounds of 2 questions is fine. |
| Asking clarifying questions for class C (pure question) | If the answer exists, give it. Only clarify when you genuinely need more input. |
| Rushing past class E because "we want to ship" | Design decisions you made without the user will be reverted later. Slow down. |

## Stating your classification

For non-trivial turns, include a short classification marker in your response so the user sees what you concluded:

> "[class A — code work] Adding a `--json` flag to the CLI. I'll..."

> "[class B — investigation] Reading `src/statusline.ts` and related files..."

> "[class F — ambiguous] I need two things before I start: ..."

This is a small cost that catches many misclassifications before they become wasted work.
