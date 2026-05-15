---
name: diagnose
description: Structured debugging loop for hard bugs or performance regressions. Use when a bug is hard to fix, has multiple possible causes, or requires systematic investigation.
---

# Diagnose

## Philosophy

Debugging is a science. Don't guess; verify. The goal is to move from "something is broken" to "I have a reproducible, minimal case that proves exactly why it's broken."

## Workflow

### 1. Reproduce

Before changing any code, you must be able to trigger the bug reliably.

- [ ] Create a script, test case, or curl command that fails
- [ ] Confirm it fails 100% of the time (or has a known probability)
- [ ] Document the exact environment and inputs

If you can't reproduce it, you can't prove you fixed it.

### 2. Minimise

A giant codebase is a noisy place to debug. Strip away everything that isn't the bug.

- [ ] Reduce the input data to the smallest possible set
- [ ] Remove unrelated code paths
- [ ] Try to reproduce in a standalone script or unit test

**Target**: A "pure" reproduction that involves the minimum number of moving parts.

### 3. Hypothesise

List possible causes. Don't just pick one; list them all.

- [ ] "Is it a race condition?"
- [ ] "Is it an unhandled null?"
- [ ] "Is it a dependency version mismatch?"

Rank them by likelihood.

### 4. Instrument

Add logging, assertions, or use a debugger to verify your hypothesis.

- [ ] "If hypothesis A is true, I should see X in the logs here."
- [ ] Add `console.log` or `DEBUG` statements
- [ ] Use `command_status` to inspect state if running in background

**Rule**: Never change implementation code to fix the bug in this step. Only add observability.

### 5. Fix

Once you've proven the cause, apply the minimal fix.

- [ ] Address the root cause, not the symptom
- [ ] Ensure the fix doesn't break other behaviors (refer to existing tests)

### 6. Regression Test

Prove the bug is gone and stays gone.

- [ ] Run your reproduction case from Step 1 → it should now pass
- [ ] Convert the reproduction into a permanent automated test
- [ ] Run the full test suite

## Checklist

```
[ ] Bug is reliably reproducible
[ ] Reproduction case is minimal
[ ] Hypothesis was verified by data, not gut feel
[ ] Fix addresses root cause
[ ] Regression test is added to the suite
```
