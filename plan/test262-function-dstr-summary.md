# Test262 Language Failure Summary

Generated: 2026-04-29T03:13:27.140Z

## Scan Method

- Ran `test262-harness` with the JSON reporter against `node_modules/test262/test/language/expressions/function/dstr` in recursively split chunks.
- Started with directory chunks of at most about 350 tests, then fell back to smaller units when the harness emitted partial JSON or crashed.
- Classified failures per file after combining default/strict scenarios.
- Marked a failure as `out-of-scope` when the repo currently has no implementation path for that syntax or runtime model, such as modules, dynamic import, explicit resource management, or unsupported modern class element forms.

## Scope Heuristics

- Intended support includes current script-mode compiler/runtime features already present in `src/compiler/**` and `src/runtime/**`, such as classes with constructors/methods/accessors, generators, async functions, spread calls, tagged templates, `for-of`, and `new.target`.
- Out-of-scope buckets currently include module syntax and evaluation (`import`, `export`, `module-code`, `dynamic import`, `import.meta`), explicit resource management (`using`, `await using`), and class element features that the compiler does not model yet (`PropertyDeclaration`, `PrivateIdentifier`, `ClassStaticBlockDeclaration`).

## Totals

- Failing files in intended scope: 0
- Failing files in out-of-scope areas: 0
- Total failing files recorded: 0
- Scanner notes: 1

## Counts By Bucket

### intended

- none

### out-of-scope

- none

## Scanner Notes

- Split dir:node_modules/test262/test/language/expressions/function/dstr after non-json-output.

## Detailed Failures

### intended

- none

### out-of-scope

- none

