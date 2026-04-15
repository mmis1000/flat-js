# Flat JS

JavaScript bytecode compiler and interpreter — compiles JS source to a flat opcode stream and executes it with a tiny bundled runtime.

---

## Motivation

1. Learn how JavaScript internally works, and evaluate whether I learned it correctly.
2. Bypass the CSP `eval` restriction with minimal size overhead.
3. Obfuscate code across all functions for obfuscation purposes.
4. Learn how debuggers work and try to implement one.

![Example debugger](./example.jpg)

---

## Setup

```sh
npm install
npm run build        # compile TypeScript once
npm run watch        # compile TypeScript in watch mode
```

---

## CLI Usage

```sh
node ./lib/cli.js [flags] <input-file>
```

### Flags

| Flag | Description |
|------|-------------|
| *(none)* | Compile and emit a self-contained, minified JS file (runtime + bytecode) |
| `--json` | Emit the compiled bytecode as a JSON payload (`{ p, t }`) instead of a runnable file |
| `--debug` | Keep output readable (beautified); print the minified source to stderr |
| `--pretty` | Skip minification of the input before compiling |

### Examples

```sh
# Self-contained runnable output
node ./lib/cli.js ./src/__tests__/fixures/loader.js > ./example/loader.js

# JSON payload output
node ./lib/cli.js --json ./src/__tests__/fixures/bad-code.js > ./example/bad-code.json
node ./lib/cli.js --json ./src/__tests__/fixures/jquery.js   > ./example/jquery.json
```

Or regenerate all examples at once:

```sh
npm run build-example
```

---

## Web Debugger

A browser-based interactive debugger built with Vue 2 and Monaco Editor.

```sh
npm run dev-web      # start webpack-dev-server
npm run build-web    # production build → dist-web/
npm run serve-web    # serve the production build
```

### Debugger controls

| State | Available buttons |
|-------|-------------------|
| Idle | **Run**, **Run and pause** |
| Running | **Pause**, **Kill** |
| Paused | **Resume**, **Step**, **Step in**, **Kill** |

While paused, a REPL input bar appears at the bottom of the result pane — type any expression and press Enter to evaluate it in the current scope.

The code pane (Monaco Editor) highlights the line/column currently being executed.

---

## Testing

```sh
npm test                  # run all tests
npm run test:coverage     # run with coverage report
npm run serve-coverage    # serve the HTML coverage report
```

---

## Design

The system emulates a JavaScript interpreter that operates on the intermediate output of a TypeScript/JavaScript parser.

### Compilation pipeline

1. Read source file.
2. Parse into an AST using the TypeScript compiler API.
3. Extract all function scopes.
4. Resolve every variable reference to its declaring scope.
5. Generate instructions from the AST (offsets unknown at this stage — only lengths).
6. Resolve instruction offsets by concatenating all instruction blocks.
7. Produce the opcode (program) section and the text/data section.
8. Emit output:
   - **Standalone JS** — runtime code + base64-encoded program data, ready to run anywhere.
   - **JSON payload** — `{ p: <base64 opcodes>, t: <text data> }` for external loading.

### Runtime

The interpreter executes the flat opcode stream rather than interpreting the AST directly, so the bundled runtime is very small — no parser is needed at execution time.

Supported features include: closures, `var`/`let`/`const`, arrow functions, `try`/`catch`/`finally`, `for`/`while`/`do…while` loops, `switch`, `new`, prototype chains, `Proxy`, `eval` (compiled in-place), `debugger` statement (triggers the web debugger's pause), and source-map-backed step debugging.
