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
- [x] `with-statement`
  - Why this batch: direct intended-support compiler/runtime gap with a clear root signature and a bounded focused slice.
  - Primary signature:
    - `Expected no error, got Error: Unknown node WithStatement`
  - Expected areas:
    - `language/statements/with/**`
    - adjacent direct-eval / object-environment semantics exercised through `with`
  - Exit criteria:
    - `with` statements compile in sloppy script code
    - strict-mode `with` early errors fire
    - `with` scope lookup / assignment / delete behavior matches object-environment semantics
    - focused `language/statements/with/**` rerun is green or reduced to unrelated failures
  - Result:
    - focused `language/statements/with/**` rerun is fully green: `182 passed, 0 failed`
    - fixed areas included:
      - `with` statement codegen and early errors for invalid statement-position declarations
      - `break` / `continue` scope unwinding through synthetic `with` scopes
      - direct-eval interception across alternate realms plus inherited strictness
      - object-environment `@@unscopables`, `HasProperty`, and strict binding re-check semantics
      - statement-completion handling for `with` bodies in eval mode
      - `do...while` `continue` targeting, which the `with` slice exposed through completion tests

## Next Batches

- [ ] `parameter-and-binding-patterns`
  - Primary signatures:
    - `Expected no error, got Error: not support yet`
    - `Expected no error, got Error: not support pattern yet`
    - `Expected no error, got Error: Not a identifier`
    - `Expected no error, got Error: not supported left node: ArrayLiteralExpression`
    - `Expected no error, got Error: not supported left node: ObjectLiteralExpression`
    - `Expected no error, got Error: not support non identifier binding`
  - Current diagnosis split:
    - `binding declarations / params / catch`
      - shared binding-pattern codegen was missing for declaration names, parameter bindings, and `catch` bindings
      - status: partially fixed in compiler/runtime
    - `binding runtime semantics`
      - remaining array-pattern failures cluster around iterator closing, generator-family call timing, and anonymous function/class naming in default initializers
      - status: in progress
    - `assignment patterns`
      - plain destructuring assignment and loop heads that use assignment targets still fail on `ArrayLiteralExpression` / `ObjectLiteralExpression`
      - status: not started
    - `early errors`
      - residual `Expected test to throw error of type SyntaxError, but did not throw error`
      - status: not started

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
- 2026-04-28: Implemented `with` statement codegen and object-environment runtime support across [control-flow.ts](</M:/Playground/flat-js/src/compiler/codegen/handlers/control-flow.ts:1>), [operators.ts](</M:/Playground/flat-js/src/compiler/codegen/handlers/operators.ts:1>), [loops.ts](</M:/Playground/flat-js/src/compiler/codegen/handlers/loops.ts:1>), [compile.ts](</M:/Playground/flat-js/src/compiler/compile.ts:1>), [execution.ts](</M:/Playground/flat-js/src/runtime/execution.ts:1>), and the relevant opcode handlers.
- 2026-04-28: Added focused regressions for `with` semantics, strict object-environment re-checks, alternate-realm direct eval, and corrected `do...while` `continue` behavior in [basic-programs.test.ts](</M:/Playground/flat-js/src/__tests__/basic-programs.test.ts:1>).
- 2026-04-28: Verified the `with` batch with:
  - `npm run build:tsc`
  - `npm run build`
  - `npx jest --runInBand --no-cache src/__tests__/syntaxes.test.ts`
  - `npx jest --runInBand --no-cache src/__tests__/basic-programs.test.ts -t "with statement|strict with|delete identifier|do while continue"`
  - focused Test262 slice: `language/statements/with/**`
- 2026-04-28: Focused Test262 rerun for `language/statements/with/**` is fully green (`182 passed, 0 failed`).
- 2026-04-28: Full `language` rescan updated [test262-language-summary.md](</M:/Playground/flat-js/plan/test262-language-summary.md:1>) with these totals:
  - intended scope failing files: `10181 -> 9874`
  - out-of-scope failing files: `7610 -> 7609`
  - total failing files: `17791 -> 17483`
- 2026-04-28: Started `parameter-and-binding-patterns` and wired a shared binding-pattern initialization helper through:
  - declaration destructuring in [basics.ts](</M:/Playground/flat-js/src/compiler/codegen/handlers/basics.ts:1>)
  - `for` / `for-in` / `for-of` declaration heads and per-iteration closure copying in [loops.ts](</M:/Playground/flat-js/src/compiler/codegen/handlers/loops.ts:1>)
  - destructured/default/rest parameters in [index.ts](</M:/Playground/flat-js/src/compiler/codegen/index.ts:1>) plus [function.ts](</M:/Playground/flat-js/src/runtime/opcodes/function.ts:1>)
  - destructured `catch` bindings in [control-flow.ts](</M:/Playground/flat-js/src/compiler/codegen/handlers/control-flow.ts:1>)
- 2026-04-28: Fixed binding-name extraction for array/object binding patterns in [analysis.ts](</M:/Playground/flat-js/src/compiler/analysis.ts:1>), which was previously missing names nested under `BindingElement`.
- 2026-04-28: Added focused regressions in [es6-runtime.test.ts](</M:/Playground/flat-js/src/__tests__/es6-runtime.test.ts:1>), [for-of-and-spread.test.ts](</M:/Playground/flat-js/src/__tests__/for-of-and-spread.test.ts:1>), and [syntaxes.test.ts](</M:/Playground/flat-js/src/__tests__/syntaxes.test.ts:1>) for destructuring declarations, parameters, `catch`, and `for-of` closure capture.
- 2026-04-28: Fixed a root runtime realm leak in [value.ts](</M:/Playground/flat-js/src/runtime/opcodes/value.ts:1>) so `ArrayLiteral` / `ObjectLiteral` and tagged-template backing arrays use the provided VM realm prototypes instead of host-realm prototypes.
  - This directly fixes binding tests that mutate `Array.prototype` in an alternate realm before destructuring.
  - Added an alternate-realm regression in [es6-runtime.test.ts](</M:/Playground/flat-js/src/__tests__/es6-runtime.test.ts:1>) to cover the realm-sensitive array/object literal path.
- 2026-04-28: Focused validation for this batch currently shows:
  - local targeted Jest for destructuring/runtime regressions is green
  - `iter-get-err-array-prototype` is now green for plain declarations, plain functions, plain methods, loop declarations, and `catch`
  - residual `iter-get-err-array-prototype` failures are concentrated in generator / async-generator call paths, which indicates generator-family parameter instantiation timing is still wrong there
  - `iter-close` still fails broadly, which confirms iterator closing is a separate remaining runtime contract
