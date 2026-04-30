---
name: flat-js-loader-output-audit
description: Use when checking rebuilt Flat JS generated loader output, especially `example/opcode-kitchen-sink-loader.js`, for runtime-internal property names emitted as string properties, leaked bookkeeping fields, or cleanup regressions after runtime/compiler changes.
---

# Flat JS Loader Output Audit

Use this skill when the task is to verify generated Flat JS loader output, not just source files.

## Rule

- Open/read the generated loader itself. Do not conclude from source-only grep.
- Remember `example/opcode-kitchen-sink-loader.js` is one minified line and ignored by Git; line-based previews can hide misses.
- Treat runtime-internal bookkeeping names as suspects until each direct occurrence is explained or removed.

## Workflow

1. Rebuild the loader:

   ```powershell
   npm run build-example:opcode-kitchen-sink
   ```

2. Run the bundled audit script against the generated file:

   ```powershell
   node .codex\skills\flat-js-loader-output-audit\scripts\audit-loader-output.js example\opcode-kitchen-sink-loader.js
   ```

3. Directly inspect any reported suspect snippets in the generated output.

4. Fix real leaks at the source runtime/compiler path, not by editing ignored generated output.

5. Rebuild and rerun the audit until known internal leaks are gone.

6. Validate affected runtime behavior with focused tests, usually:

   ```powershell
   npm run build:tsc
   npm test -- src/__tests__/es6-runtime.test.ts src/__tests__/scope-debug.test.ts
   ```

## Known Leak Patterns

These should normally be removed from stripped loader output:

- `.names`, `.flags`, `.values`
- `names:[]`, `flags:[]`, `values:[]`
- `__pos__`
- quoted runtime-only `Fields` names such as `"valueStack"`, `"programSection"`, `"variableEnvironment"`, `"delegateIterator"`

## Known Reviewed Surface

- `A.pos = ...` on thrown errors is diagnostic error metadata.
- `{ _$_: run }` is the CLI bootstrap binding for generated-loader execution.
- `value` and `done` are normal iterator-result surface names.
- `name`, `length`, `prototype`, `constructor`, `get`, `set`, `return`, `throw`, and `next` are normal JavaScript surface names.

## Completion Gate

- Report the direct generated-file audit result, including remaining reviewed surface.
- Mention that the generated loader is ignored by Git if it does not appear in status.
- Stage only source/skill files unless the user explicitly asks to force-add ignored generated output.
