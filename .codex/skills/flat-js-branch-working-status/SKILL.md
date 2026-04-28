---
name: flat-js-branch-working-status
description: Use when confirming a Flat JS branch is truly working, green, ready, or target complete after compiler, runtime, protected-mode, loader, example, or browser-facing changes. Provides the checklist and completion gates to satisfy before claiming the branch is done.
---

# Flat JS Branch Working Status

Use this skill when the user asks whether a Flat JS branch, fix, or port is "working", "green", "ready", or "fully fixed".

## Goal

Do not claim the branch is working until the changed surfaces have been checked end-to-end.

## Minimum Checklist

- Inspect `git diff --stat` or the touched files first, and map them to validation scope.
- Run TypeScript compile with the local binary when shell PATH is unreliable:
  - `node .\node_modules\typescript\bin\tsc --project .\src\tsconfig.json`
- Run focused Jest suites with the local binary:
  - `node .\node_modules\jest\bin\jest.js --runInBand ...`
- If compiler, runtime, protected-mode, opcode-family, or stripped-runtime behavior changed, include:
  - `src/__tests__/runtime-projection.test.ts`
  - `src/__tests__/opcode-family-prior.test.ts`
  - `src/__tests__/basic-programs.test.ts`
- If standalone runtime fallback changed, include the directly affected regression tests too.
- If example assets or loader behavior changed, run:
  - `npm run build-example`
- If another generated example changed, rebuild that artifact too.
- If compiler/runtime semantics changed and there is a relevant Test262 harness slice for the area, run it and treat failures as blocking, not advisory.

## Browser And Example Checks

Run these when changes touched `example/loader.js`, stripped runtime bundling, jQuery, browser-only behavior, `eval` or `Function` fallback, or example assets.

- Load the page with a cache-busting URL or a fresh script injection.
- Do not trust stale console history. Inspect only new console entries after the fresh load.
- Verify the expected globals exist after load, for example `window.jQuery` and `window.$` when the example depends on them.
- Re-run the concrete failing browser path from the bug, not just page load.
  - Examples from this repo:
  - `jQuery.Deferred().always(...)`
  - `d.done([fn])`
  - `$(el).animate({ left: '40%' })`
- Confirm the new console error count is zero before saying the example is fixed.

## Target Complete Requirements

Only call the target complete when all relevant checked surfaces are green.

- No known CI failures remain for the touched area.
- No relevant local test failures remain.
- No relevant browser or example regressions remain.
- No relevant Test262 harness failures remain.
- The original repro path or user-facing behavior has been rechecked.

If one of those surfaces was not run or is still unknown, say that explicitly and do not present the work as fully target complete.

## Branch Port Checks

When porting a fix to another branch:

- Re-read that branch's `src/compiler/compile.ts` and related runtime API before reusing tests or commands.
- Adapt regressions if the older branch lacks newer options such as `protectedMode` or `shuffleSeed`.
- Validate on that branch before claiming the port is done.

## Reporting Rules

Before saying the branch is working, report:

- what was validated
- which commands passed
- which checks were not run
- whether the worktree is clean or intentionally dirty

Do not say "fixed" or "working" if only unit tests passed but the original repro path was not rechecked.
