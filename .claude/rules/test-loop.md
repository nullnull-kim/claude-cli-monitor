# Test loop — write until green

> Pulled when implementing any behavior change with a test. Referenced from CLAUDE.md "Workflow" section and the `complete-task` skill.

## The rule

When the task has a clear test acceptance criterion, the implementation loops automatically:

```
write → run test → green? → done
              ↓
              red? → analyze → fix → run test → ...
```

The loop continues until the test is green, subject to **iteration limits** and **convergence checks** below.

## Iteration limit

- **Default: 5 iterations max.** If the test is still red after 5 full write/test cycles, **stop** and escalate to the user.
- "Iteration" = one cycle of: edit source → run test → interpret result.
- The limit exists because the common cause of iteration 6+ is that the agent is patching the symptom, not fixing the root cause.

## Convergence check

After every iteration, compare the current failure mode to the previous iteration's failure mode:

| Comparison | Meaning | Action |
|-----------|---------|--------|
| Green now | Fixed | Proceed to verification per `separation-of-duties.md` |
| Different failure than before | Progress — new ground covered | Continue loop |
| Same failure, same line | Fix did not land (cache? wrong file?) | **Stop**. Investigate tooling, not code. |
| Same failure, different line | Root cause is systemic | **Stop**. Rethink approach. |
| New failure elsewhere | Regression introduced | **Revert latest edit**, rethink |
| Failures are oscillating | You're going in circles | **Stop**. Escalate. |

If any of the **Stop** conditions hit, do not continue the loop. Tell the user what you observed and ask for direction.

## Per-iteration protocol

Each iteration:

1. **Run the test**. Capture the actual error message and stack trace. Do not summarize prematurely.
2. **Read the error literally**. What did the assertion expect? What did it get?
3. **Trace the value**. Where did the wrong value come from? Walk backwards through the call stack.
4. **Identify the root cause** in one sentence. If you cannot, you are about to symptom-patch.
5. **Make the smallest fix** that addresses the root cause.
6. **Re-run only the failing test first** (faster iteration). Once it passes, run the whole suite to check for regressions.
7. **Log the iteration** (1 line): "iter N: error was X, fix was Y".

## Loop vs. rewrite

If at iteration 2 you suspect the approach is wrong (not just a small bug):

- **Do not keep patching.** Stop the loop.
- Reconsider the approach. Is the test correct? Is the interface wrong? Is the data model off?
- If the approach is wrong, revert and start over with a different approach. That is not a failure of the loop — it is the loop detecting a dead end.

## Interaction with separation of duties

- The writer runs the test **mechanically** as part of the loop. This is allowed because running a test is mechanical.
- The writer **cannot** declare "the test is good enough" or "this test is wrong so I'll change it to pass" without a separate verifier approving the test change.
- Once the test is green, the verifier (separate agent per `separation-of-duties.md`) confirms the green state before the task can be closed.

## When the test itself is wrong

Sometimes the test is the bug. Handle carefully:

1. **Diagnose** whether the test is wrong or the code is wrong. Evidence: what does the feature *actually* do that a user would consider correct?
2. If the test is wrong: **stop the loop**, explain to the user, get explicit approval before modifying the test.
3. Never modify a test to make it pass without that explicit approval. Changing tests to pass is the most insidious failure mode in this rule.
4. When the test is updated (with approval), run the full suite again. A test change can uncover coupled tests.

## Bounded retries for flaky tests

If the test appears to be flaky (green sometimes, red sometimes):

- Run it 3 times. If it's green 2/3, treat as green but **flag flakiness to the user**.
- Do not ignore flakiness. Flaky tests erode the whole gate.
- Open a follow-up task to de-flake the test.

## Anti-patterns

| Anti-pattern | Why bad |
|-------------|---------|
| Iteration without reading the error | You're guessing. Read the actual message. |
| Symptom-patching to get green | The test is green but the code is wrong. Worst possible state. |
| Changing the test to match the implementation | Defeats the purpose of the test. |
| Adding `expect(true).toBe(true)` | Obvious cheat. Caught in review. |
| Continuing past iteration 5 | You are no longer fixing; you are thrashing. |
| Silent loop (not telling the user it's running) | User should see iteration count and what each iteration changed. |
| Looping on a design issue | The loop cannot fix a wrong design. Escalate. |
| Running test without running the full suite after green | You may have introduced a regression. Always full suite before declaring done. |

## Reporting

After the loop completes (green or escalated), report to the user:

- How many iterations.
- Root cause (1 sentence).
- Final fix (1 sentence).
- Any test flakiness observed.
- Full suite status.

If the loop was escalated (hit the limit or a stop condition), include:

- What was tried (per-iteration log).
- Why you believe it failed.
- Your current best guess about the root cause (even if you couldn't confirm).
- What you think the right next step is.
