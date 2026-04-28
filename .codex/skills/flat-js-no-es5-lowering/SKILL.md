---
name: flat-js-no-es5-lowering
description: Use when adding or fixing ES2015+ language support in Flat JS, especially in `src/compiler/**`, `src/runtime/**`, opcode work, or syntax handlers. Enforces the project rule that newer JavaScript features must be implemented directly in compiler/runtime semantics rather than lowered into ES5-style helper code, synthetic AST rewrites, or userland compatibility shims.
---

# Flat JS No ES5 Lowering

Use this skill when the task touches newer JavaScript semantics and there is any temptation to "just rewrite it" into older JavaScript before execution.

## Rule

- Do not downlevel ES6+ user syntax into ES5-style source patterns inside codegen.
- Support the feature as first-class Flat JS behavior in bytecode, runtime metadata, opcodes, scope handling, iterator handling, or other VM semantics.
- Treat synthetic AST rewrites as a smell when they exist only to emulate a newer language feature with older JavaScript.

## Reject These Patterns

- Do not rewrite rest parameters into `[].slice.call(arguments, i)`.
- Do not rewrite spread call/new/super into `.apply(...)` helpers just to preserve syntax externally.
- Do not rewrite tagged templates into plain function calls with only cooked strings.
- Do not rewrite classes into prototype-assignment source patterns.
- Do not rewrite arrow functions into plain functions plus ad hoc `this` workarounds.
- Do not replace iterator-based semantics with array-only loops when the language feature is defined in terms of iterables.

## Preferred Approach

1. Inspect the current syntax handler and runtime path first.
2. Identify whether the existing implementation lowers by creating replacement AST or helper-style source shapes.
3. Move the behavior into direct Flat JS semantics instead:
   - function-entry metadata
   - opcode additions
   - runtime helpers
   - iterator-aware execution
   - template-object caching
   - direct `this` / `super` / `new.target` handling
4. Preserve observable semantics, especially:
   - realm-sensitive errors
   - `this`
   - `new.target`
   - `arguments`
   - iterator consumption
   - template identity and `raw`
5. Add focused regressions near the changed feature and extend opcode coverage if a new opcode was introduced.

## Files To Check First

- `src/compiler/codegen/**`
- `src/compiler/shared.ts`
- `src/compiler/encoding.ts`
- `src/runtime/execution.ts`
- `src/runtime/opcodes/**`
- targeted tests in `src/__tests__/**`

## Completion Gate

- Do not call the target complete if the implementation still relies on ES5-style lowering for the feature.
- Do not call the target complete if relevant compiler/runtime tests fail.
- When the change is broad enough to affect branch health, also use `$flat-js-branch-working-status` and satisfy its CI/web/Jest/Test262 completion gates.
