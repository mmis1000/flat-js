# Static Scope Name Elision Tracker

Generated: 2026-05-01

## Goal

Reduce runtime binding-name materialization for statically resolved slots without weakening eval, `with`, debug scope materialization, REPL attachment, or loop binding semantics.

## Current Batch

- [x] `static-aware-loop-identifier-binding`
  - Why this batch: simple `for-in` / `for-of` identifier targets were the remaining name-preserving path that used dynamic `SetInitialized` even when the compiler had static slot information.
  - Expected areas:
    - `src/compiler/codegen/context.ts`
    - `src/compiler/codegen/handlers/loops.ts`
    - `src/__tests__/static-scope-resolution.test.ts`
  - Exit criteria:
    - `for (var x in obj)` and `for (var x of values)` use static slot writes when available.
    - non-declaration `for (x in/of ...)` keeps assignment semantics.
    - `const` loop declarations still freeze after initialization.
    - generated non-debug output does not keep unnecessary runtime names for static `var` loop targets.
  - Result:
    - simple `for-in` / `for-of` identifier declaration targets now use static writes when resolution is available.
    - non-declaration identifier loop targets now use assignment semantics.
    - `const` loop declarations still freeze after initialization.
    - generated self-contained demo output runs and does not contain the checked source local names or `compiler_1`.

## Deferred Work

- [ ] Staticize per-iteration block-scope copying.
  - Current reason deferred: `SetMultiple` is name-based and still needs runtime names for loop-scope locals.
  - Target outcome: copy block-scoped loop bindings by static slot metadata where possible, then narrow loop-scope name preservation.
- [ ] Revisit the `generateLeft` split.
  - Current reason deferred: existing callers depend on `generateLeft` producing a dynamic reference tuple.
  - Target outcome: keep dynamic references explicit and route simple identifier writes through clearer helpers.
- [ ] Consider migrating stable identifier write emitters.
  - Current reason deferred: assignment, compound assignment, update, and destructuring paths already have static variants.
  - Target outcome: reduce duplicated static/dynamic write decisions only where it improves maintainability without changing behavior.

## Activity Log

- 2026-05-01: Created tracker for static scope name-elision follow-up work.
- 2026-05-01: Completed `static-aware-loop-identifier-binding` with:
  - `npm run build:tsc`
  - `npm run typecheck:web`
  - `npx jest --runInBand --no-cache src/__tests__/static-scope-resolution.test.ts`
  - `npm test`
  - `npm run build-example:self-contained-vm`
  - `node example/self-contained-vm-demo.js`
  - `rg -n "maybeConfig|keyCalls|skipped|accent|score|state|lines|heading|body|root|currentProgram|compiler_1|compiledProgram|runtimeSource|currentExports" example/self-contained-vm-demo.js example/self-contained-vm-demo-inner.js`
  - `npm run build-example:opcode-kitchen-sink`
  - `node .codex\skills\flat-js-loader-output-audit\scripts\audit-loader-output.js example\opcode-kitchen-sink-loader.js`
  - `$env:TEST262_SCAN_CONCURRENCY='12'; $env:TEST262_SCAN_SUMMARY='C:\tmp\test262-language-summary-static-loop.md'; node plan\test262-language-scan.js`
- 2026-05-01: A first full Test262 scan attempt at concurrency `16` reached the final chunks but failed with `spawn EPERM`; reran the chunked scan at concurrency `12` successfully.
- 2026-05-01: Full Test262 language scan summary at `C:\tmp\test262-language-summary-static-loop.md` recorded:
  - intended-scope failing files: `3074`
  - out-of-scope failing files: `6619`
  - total failing files: `9693`
