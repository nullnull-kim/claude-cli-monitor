# Bug incident response

> Pulled the moment a bug is reported or discovered. Referenced from CLAUDE.md "Rules Index". Following these steps in order is the difference between a clean fix and a recurring incident.

## Step 0 — Stop coding

Before any edit:
- Acknowledge the report.
- Resist the urge to "I think I see it" patch. Most bug reports look obvious and aren't.

## Step 1 — Reproduce

- Reproduce the bug deterministically with a minimal command or input.
- If you cannot reproduce, the report is not actionable. Ask the user for specifics: input, environment, exact steps, observed vs expected.
- Capture the reproduction in writing (a one-line shell command, a test case, or a JSON fixture).

## Step 2 — Locate, do not assume

- Read the relevant source. Do not "I bet it's in X" — open X and verify.
- Use Grep to find every reference to the symptom (function name, error string, log line).
- Read the actual call sites. The bug may be in the caller, not the callee.

## Step 3 — Identify the root cause

- Why does this fail? Walk the data flow until you find the first wrong value.
- Beware of "the symptom is in module A, the bug is in module B". Don't fix A.
- If two reasonable root causes exist, instrument and confirm before choosing.
- Write down the root cause in one sentence. If you cannot, you do not understand the bug yet.

## Step 4 — Assess blast radius

- Where else does this code path run? Could other call sites be affected by the same root cause?
- Could the same root cause have produced **other** bug reports? Search history.
- Is data on disk corrupted? (State files, transcript caches, etc.) Do affected users need cleanup?

## Step 5 — Failing test first

- Write a test that fails because of the bug.
- Run it. Confirm it fails for the right reason — not because of unrelated breakage.
- This test stays in the suite as a regression guard.

## Step 6 — Minimal fix

- Change as little as possible. The smaller the diff, the easier the review.
- Do not refactor surrounding code "while you're there". Open a separate task.
- Do not silence the symptom. Fix the root cause.

## Step 7 — Verify

- Run the failing test from step 5. It must now pass.
- Run the full test suite. Nothing else regresses.
- Run the original repro from step 1 manually if it's CLI-visible.
- If the bug had a corrupted state file involved, verify recovery works on a fresh state too.

## Step 8 — Related bugs

- Re-search for the root cause pattern elsewhere in the codebase.
- If you find another instance, decide: fix in this task (if trivial), or open a new task.

## Step 9 — Document

- Commit message: state the symptom, the root cause, and the fix in 1–3 lines.
  ```
  fix(parser): handle empty toolUseResult in pass 3 backfill

  Pass 3 indexed `result.toolUseResult.usage` without checking that
  toolUseResult existed, crashing on empty agent results. Guard with
  optional chain and skip the row when missing.
  ```
- If user-facing, mention in README / changelog.
- If it changes a documented behavior, update the doc.

## Step 10 — Communicate

- Tell the user: what was wrong, what fixed it, what they need to do (if anything — usually nothing).
- If state cleanup is required on their machine, give the exact command.
- If the bug indicates a process gap (missing test, missing rule), update the rule file in the same task.

## Anti-patterns

| Anti-pattern | Why bad |
|-------------|---------|
| "I'll add a try/catch and move on" | Hides the root cause and creates a slow rot. |
| Patching the symptom in the caller | The next caller will hit it too. |
| Skipping the failing test | Bug returns within months. |
| Bundling unrelated cleanups | Inflates diff, masks the real fix. |
| "Worked on my machine" without repro | Not done. |
| Reporting "fixed!" without running the suite | Not done. |
