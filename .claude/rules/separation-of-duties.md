# Separation of duties — writer ≠ verifier

> Pulled before any verification step (review, test run, audit). Hard rule in the workflow. Referenced from CLAUDE.md "Workflow" section.

## The rule

**The agent that wrote a piece of code must not be the agent that verifies it.**

Concretely:
- If the **main session** (session master) wrote code with Edit/Write, the main session **cannot** review it, audit it, or declare it tested. Verification must be delegated to a different agent.
- If a **subagent** wrote code, verification must be delegated to a **different** subagent. Not the author.
- Self-verification is forbidden regardless of agent type or role.

## Why

Writers have blind spots on their own code:
- **Confirmation bias**: the writer tends to re-read the code they intended to write, not the code they actually wrote.
- **Assumed invariants**: the writer trusts the mental model they had at write time. A fresh reader does not.
- **Typo-class bugs**: the writer's eyes skip over the same characters the same way on every re-read.
- **Scope creep**: the writer tends to rationalize "small" scope expansions; a reviewer flags them.

The cost of a dedicated second pass by a different agent is one agent call. The cost of shipping a self-reviewed bug is everything that comes after.

## Who writes

A "writer" is any agent that called `Edit`, `Write`, `NotebookEdit`, or equivalent file-mutation tools in the current task. The main session counts as an agent for this rule.

## Who verifies

A "verifier" is any agent that:
- Runs `review-checklist.md` (code review).
- Runs the test suite and interprets results.
- Runs `code-auditor` in any mode.
- Runs `devils-advocate` red team.
- Signs off on `definition-of-done.md` gates.

The writer may **run** the test command (because it's mechanical), but interpretation and sign-off belong to a separate verifier.

## Mapping

| Writer | Allowed verifiers | Forbidden verifiers |
|--------|-------------------|--------------------|
| main session | code-reviewer, test-engineer, devils-advocate, code-auditor, any subagent that did not write in this task | main session itself |
| hook-engineer | code-reviewer, test-engineer, devils-advocate, code-auditor, main session (if main did not write) | hook-engineer itself |
| behavioral-designer | code-reviewer, test-engineer, devils-advocate, code-auditor | behavioral-designer itself |
| any subagent | any other agent that did not write | itself |

## Workflow integration

When closing a task:
1. Identify every agent that wrote code in this task.
2. For review: delegate to an agent that is **not** in that set.
3. For test interpretation: delegate to an agent that is **not** in that set.
4. For red team: delegate to `devils-advocate` unless `devils-advocate` was the writer (rare).
5. Record the writer and verifier in the task report so the user can audit the split.

If there is no eligible verifier (e.g., every agent wrote something), split the verification: delegate review of module A to the writer of module B and vice versa.

## Main-session exception handling

The main session frequently writes code because some tasks don't warrant delegation. When the main session is the writer:

- **Must delegate** review and test interpretation to a subagent (code-reviewer + test-engineer).
- **Must not** skip verification "because the change is small". The rule has no size exception.
- **Must not** delegate verification to itself via a "think out loud" self-review step. That is still self-review.
- **May** include the subagent's findings verbatim in the user report so the user sees what the verifier actually said.

## Exception: trivial edits

The following are exempt from formal verification (but must still pass the build and tests):

- **Typo fixes** ≤ 3 characters changed.
- **Comment-only** edits that do not change code behavior.
- **Import reordering** by an automatic sort (never manual).
- **Whitespace-only** changes made by a formatter run.

Any edit that changes program behavior, even by one character (e.g., `==` → `===`, `<` → `<=`), is **not** exempt. It requires a separate verifier.

## What this rule does not say

- It does not say "all work must be delegated to subagents". Small code changes can be written by the main session. Only verification must be split.
- It does not forbid the main session from reading its own code. Reading is fine; the forbidden act is declaring the code correct without a second agent confirming.
- It does not require three agents. One writer + one verifier is enough.

## Anti-patterns

| Anti-pattern | Why bad |
|-------------|---------|
| Main session writes + main session reviews + main session commits | Self-certification. Classic blind-spot trap. |
| "I'll just quickly verify it myself" | The word "just" is the warning sign. |
| Delegating review to a subagent but ignoring its findings | Self-override. Undoes the separation. |
| Delegating to a subagent that was given the writer's reasoning as context | Bias injection. Give the verifier only the code + rules, not the writer's justification. |
| Claiming trivial-edit exemption for a behavior change | No. If it changes behavior, it's not trivial. |

## Enforcement

The `complete-task` skill refuses to close a task if the writer set and the verifier set overlap. If you are running `complete-task` and the skill objects, re-delegate verification to an eligible agent rather than overriding the rule.
