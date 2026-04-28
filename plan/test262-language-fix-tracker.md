# Test262 Language Fix Tracker

Generated: 2026-04-28

## Goal

Reduce the `language` category failures in targeted batches:

1. Pick a small set of intended-support root-cause groups.
2. Fix one group at a time.
3. Re-run the focused slice for that group and update this file.
4. After the current target batch is done, re-run the full `language` scan and compare totals.

## Current Batch

- [x] `label-statements`
  - Why this batch: small, self-contained compiler gap with direct intended-support impact.
  - Primary signatures:
    - `Expected no error, got Error: Unknown node LabeledStatement`
    - `Expected test to throw error of type SyntaxError, got Error: Unknown node LabeledStatement`
  - Expected areas:
    - `language/statements/labeled/**`
    - some `language/asi/**` cases that currently fail only because labels are unsupported
  - Exit criteria:
    - labeled statements compile
    - labeled `break` works
    - labeled `continue` works for iteration labels
    - focused labeled Test262 slice is green or reduced to unrelated failures
  - Result:
    - focused `language/statements/labeled/**` rerun is green for intended-support cases
    - residual failures in that slice are module-only `await` label tests:
      - `value-await-module.js`
      - `value-await-module-escaped.js`
    - those remaining failures are out of scope for this batch because module parse semantics are not currently in the intended-support set

## Next Batches

- [ ] `with-statement`
  - Primary signature: `Expected no error, got Error: Unknown node WithStatement`

- [ ] `parameter-and-binding-patterns`
  - Primary signatures:
    - `Expected no error, got Error: not support yet`
    - `Expected no error, got Error: not support pattern yet`
    - `Expected no error, got Error: Not a identifier`
    - `Expected no error, got Error: not supported left node: ArrayLiteralExpression`
    - `Expected no error, got Error: not supported left node: ObjectLiteralExpression`
    - `Expected no error, got Error: not support non identifier binding`

- [ ] `missing-operators`
  - Primary signatures:
    - `Expected no error, got Error: unknown token AsteriskAsteriskToken`
    - `Expected no error, got Error: unknown token QuestionQuestionToken`
    - `Expected no error, got Error: unknown token ...EqualsToken`

- [ ] `runtime-semantic-cluster`
  - Primary signatures:
    - `M:\Playground\flat-js\lib\runtime\execution.js:623`
    - `Expected test to throw error of type SyntaxError, but did not throw error`

## Run Log

- 2026-04-28: Created tracker from [test262-language-summary.md](</M:/Playground/flat-js/plan/test262-language-summary.md:1>).
- 2026-04-28: Chose `label-statements` as the first target batch because it is small enough to finish in one iteration and should remove both direct labeled-statement failures and some ASI fallout.
- 2026-04-28: Implemented labeled statement codegen plus labeled `break`/`continue` handling in [control-flow.ts](</M:/Playground/flat-js/src/compiler/codegen/handlers/control-flow.ts:1>).
- 2026-04-28: Added strict-context early-error checks for labeled function declarations and `yield` labels, and normalized the sloppy-script `label: let // ASI` parser ambiguity in [compile.ts](</M:/Playground/flat-js/src/compiler/compile.ts:1>).
- 2026-04-28: Verified local regressions with:
  - `npm run build:tsc`
  - `npx jest --runInBand --no-cache src/__tests__/syntaxes.test.ts`
  - `npx jest --runInBand --no-cache src/__tests__/basic-programs.test.ts -t labeled`
  - `npx jest --runInBand --no-cache src/__tests__/basic-programs.test.ts -t "strict .* label"`
- 2026-04-28: Focused Test262 rerun for `language/statements/labeled/**` now only fails the four module-scenario `await` label cases, which are being tracked as out-of-scope for this batch.
- 2026-04-28: Full `language` rescan updated [test262-language-summary.md](</M:/Playground/flat-js/plan/test262-language-summary.md:1>) with these totals:
  - intended scope failing files: `10265 -> 10181`
  - out-of-scope failing files: `7616 -> 7610`
  - total failing files: `17881 -> 17791`
