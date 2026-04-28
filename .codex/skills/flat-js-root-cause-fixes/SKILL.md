---
name: flat-js-root-cause-fixes
description: "Use when fixing Flat JS bugs, regressions, unintended test failures, or behavior that broke after a recent change, especially in `src/compiler/**`, `src/runtime/**`, opcode work, or Test262-driven fixes. Enforces root-cause fixes: remove or narrow the regression-causing change first, and do not add workaround paths, new opcodes, special-case branches, sentinels, or duplicate semantics layers just to patch a newly introduced bug."
---

# Flat JS Root-Cause Fixes

## Rule

- Fix the bug at the site where the semantics became wrong.
- If the failure was introduced by a recent change, first identify that change and try to remove or narrow it.
- Do not add a new opcode, helper path, sentinel object, special-case branch, or duplicate resolution layer merely to compensate for a bug introduced in the existing implementation.

## Required Workflow

1. Trace the failure to the exact change or helper contract that made the behavior incorrect.
2. Check whether the pre-regression path can be restored or narrowed instead of layering a second path on top.
3. Prefer the smallest fix inside the broken helper, operator, or codegen decision point.
4. Add a new abstraction only if the semantics truly require it across stable cases, not just the current regression.
5. Add regressions that cover the original bug and the closest neighboring cases that would fail for the same reason.

## Reject These Patterns

- Do not add a workaround path just because a new test exposed a bug introduced in the current branch.
- Do not keep both the broken path and a new "safe" path when the broken one should be repaired or removed.
- Do not widen compiler IR or opcode surface area unless the old shape cannot represent correct semantics.
- Do not patch one failing test while leaving the underlying helper contract unsafe for adjacent cases.

## Escalation Gate

Before adding a new opcode or runtime-only special path, be able to answer yes to both:

- Is the old path fundamentally incapable of expressing the required semantics?
- Is this solving a real general semantic need rather than hiding a regression we just introduced?

If either answer is no, fix the existing path instead.

## Completion Gate

- The regression-causing behavior is removed or narrowed.
- The fix does not leave behind workaround-only machinery.
- Focused tests for the original failure and nearby semantics pass.
- If compiler/runtime semantics changed, run the relevant repo tests and Test262 slice before calling it fixed.
