# VM State Serialization Plan

Status (updated 2026-05-05): optional serialization exists behind `src/serialization.ts` and `src/runtime/serialization.ts`; it is not exported from the default runtime, inline runtime, or loader output. Snapshots pause synchronous executions at `Fields.step()` boundaries, embed the source/program buffers, preserve ordinary object/array/function identity, restore runnable `Execution` objects, serialize registered host descriptor overlays, preserve VM-managed iterator state, support `Map`, `Set`, `WeakMap`, `WeakSet`, and synchronous VM generator records, and can opt into strict checkpointable admission checks. Phase 7 is now scoped as VM-owned async scheduling first, with host/native pending promises still rejected. The browser proof-of-concept lives in `example/serialization-playground.vue` and is built by CI through `npm run build-example:serialization-playground`.

Current assumption check (2026-05-05): the overall direction below still matches the runtime shape. The serializer now lives inside `src/runtime` and uses narrow runtime internals for side-table reconstruction. The next work is a deterministic VM-owned async scheduler/session, without pulling serialization into the default loader or turning normal runtime execution into a full host membrane.

Goal: support pausing a Flat JS execution, serializing its observable state to a string-friendly snapshot, restoring it in another runtime instance, and continuing execution from the same VM point.

## Working Workflow

Project skill: use `$flat-js-vm-serialization` before starting implementation work in this area.

Advance serialization one phase at a time:

1. Pick one phase or sub-phase from section 12 and write its acceptance criteria before runtime edits.
2. Add focused positive and negative serialization tests first.
3. Implement the smallest runtime record/restore shape that satisfies those tests.
4. Keep unknown or unmodeled state rejected with `UnsupportedSerializationError`.
5. Preserve optional-extension boundaries: no default runtime export, inline runtime export, generated loader inclusion, or normal-mode host membrane unless the phase explicitly requires it.
6. Update this plan with the new status, remaining unsupported cases, and validation commands.

Recommended next sequence:

1. Phase 1A: harden V1 edge cases and rejection coverage. Implemented 2026-05-05.
2. Phase 2A: specify host descriptor overlay semantics before implementation. Implemented 2026-05-05.
3. Phase 2B: implement registered host descriptor overlays. Implemented 2026-05-05.
4. Phase 3A: replace `for...in` checkpoint state with a VM-managed record. Implemented 2026-05-05.
5. Phase 3B: redirect selected built-in iterator factories to VM-owned iterator records. Implemented for VM-authored iterators and unpatched array iterators 2026-05-05.
6. Phase 4A: add `Map` and `Set` records. Implemented 2026-05-05.
7. Phase 4B: add `WeakMap` and `WeakSet` reachable-key probing. Implemented 2026-05-05.
8. Phase 5: expand class, bound-function, and generator support after their prerequisite phases. Implemented for classes, bound functions, and synchronous VM generators 2026-05-05.
9. Phase 6: add strict checkpointable ingress checks. Implemented as opt-in admission callbacks 2026-05-05.
10. Phase 7A-7E: add VM-owned async scheduler/session support, then serialize that session. Host/native pending promises stay unsupported until a later host-boundary phase.

## 0. Follow-Up Path From Current V1

Current support:

- Optional public API: `snapshotExecution`, `restoreExecution`, `serializeExecutionSnapshot`, `parseExecutionSnapshot`, `createHostRegistry`, `createSerializableHostObjectRedirects`, `createCheckpointableAdmission`, and `UnsupportedSerializationError`.
- Snapshot roots: execution pointer, eval result, frame stack, frame scopes, value stacks, globals reachable through frames, program buffers, static scope internals, TDZ sentinel, VM function descriptors, and active/suspended synchronous generator state.
- Graph support: primitive tags, ordinary object/array/function/frame records, descriptors, prototypes, well-known/internal symbol keys, cycles, shared references, and embedded program source.
- Host support: stable host refs by registry id; registered host descriptor additions/changes/deletions are serialized as overlays, while host prototype/extensibility overlays remain rejected. Selected safe host factory returns can be admitted by optional `functionRedirects` from `createSerializableHostObjectRedirects`; strict checkpointable execution can reject unsupported initial scopes, host returns, and host property/object-spread ingress before snapshot time.
- Iterator/collection support: `for...in` uses VM-managed key/index records, VM-authored iterator records are VM-owned, unpatched array iterators use VM-owned index records, and `Map`/`Set`/`WeakMap`/`WeakSet` have brand-specific snapshot records.
- Function-family support: classes, default constructors, method/accessor `homeObject`, bound VM functions, synchronous generator functions, generator method references, suspended generator stacks, active generator frames, and VM generator `yield*` delegate state round-trip.
- Playground support: Monaco/debugger/scope inspection/REPL, `log`, modal `input`, save/load text snapshots, save/load snapshot URLs, and home-page example link.
- Guardrails: serializer remains outside `src/index.ts`, `src/runtime.ts`, `src/runtime-inline.ts`, CLI self-contained loader output, and generated inline runtime.

Follow-up stages:

1. **Close V1 correctness gaps**
   - Implemented coverage for plain loops, prototype-shared graphs, `JSON.parse`/`Object.fromEntries` adoption, `Object.create(null)`, accessors, symbol-keyed properties, sparse arrays, non-extensible objects, and restore-after-REPL state.
   - Implemented negative coverage for native iterator objects, unregistered host functions, accessors that close over unsupported host state, and unsupported local symbol-keyed properties.
   - Keep the snapshot format same-runtime-only unless a versioned compatibility policy is explicitly added.

2. **Host object boundary**
   - Expand `createSerializableHostObjectRedirects` only for host functions whose object returns are ordinary data containers or descriptor containers.
   - Keep rejecting unknown host/native objects by default.
   - Registered host descriptor overlays are implemented for added, changed, and deleted own descriptors.
   - Strict checkpointable admission is implemented as an optional runtime callback, with a serialization helper that applies the same supported-state rules at initial scopes, property reads, value-stack ingress, host call/construct returns, iterator values, and object spread/rest ingress.
   - Keep rejecting registered host prototype and extensibility overlays.

3. **Iterator and loop coverage**
   - VM-authored iterator records and unpatched array iterator records are VM-owned and serializable.
   - Native `GetPropertyIterator` / `for...in` state is replaced with a VM-managed record.
   - Continue rejecting unknown native iterators until their internal state has a serializable representation.

4. **Collection support**
   - `Map` and `Set` records are implemented using captured intrinsics and explicit entry traversal.
   - `WeakMap` and `WeakSet` records are implemented through reachable-key probing and fixed-point traversal.
   - Keep `Date`, `RegExp`, `ArrayBuffer`, and typed arrays as separate opt-in additions with brand-specific records.

5. **Function-family expansion**
   - Implemented class restore for explicit/default constructors, derived default constructors, methods, accessors, and `super` home-object metadata.
   - Implemented bound VM function metadata restore after host-overlay rules were clear.
   - Implemented synchronous generator state records, generator method side-table records, active generator frame links, and VM `yield*` delegate state.

6. **Async/promise state**
   - Start with VM-owned promises only: session `Promise`, `vmSleep`, `.then` jobs, async-function continuations, and global debugger pause.
   - Keep pending native `Promise`, host thenables, and broad Promise interop unsupported in snapshots for the first async version.
   - Route all async boundary decisions through a narrow host-promise policy hook so future rejected-on-restore or host-resume policies do not require a scheduler rewrite.

7. **Tooling and CI**
   - Add a Playwright smoke test for save URL -> reset/load -> continue in the serialization playground.
   - Keep the runtime-inline/loader-size guard in tests and CI.
   - Update README status once the current V1/V1.1 API has settled enough to document as a supported optional extension.

## 1. Product Contract

State serialization should be a guaranteed subset, not best effort.

- Normal VM mode may stay permissive and fast.
- Checkpointable VM mode may throw if user code creates or imports state outside the supported range.
- `snapshotExecution(execution)` must either produce a complete snapshot or throw a typed unsupported-state error.
- `restoreExecution(snapshot, options)` must rebuild a runnable `Execution` object with the required host capabilities supplied by the caller.
- The runtime should not silently drop reachable, observable state.

The practical contract:

> In checkpointable mode, every value reachable from the VM execution roots must be serializable, VM-owned, or represented by an explicit host capability id.

## 2. Existing Runtime Shape

The VM is already pauseable. `getExecution(...)` returns an `Execution` object, and the web debugger resumes by repeatedly calling `execution[Fields.step]()`.

Core execution state:

- `Fields.ptr`: current instruction pointer.
- `Fields.stack`: frame stack.
- frame `Fields.scopes`: lexical/object environment chain.
- frame `Fields.valueStack`: operand stack.
- frame `Fields.programSection`: active bytecode buffer.
- frame `Fields.globalThis`: VM global object.
- frame `Fields.variableEnvironment`: active function variable environment for eval/parameter semantics.
- closure-local execution state such as pending injected throws, current/eval result bookkeeping, `compileFunction`, `getDebugFunction`, and `functionRedirects`.
- generator state, function descriptors, and bound-function metadata held in runtime side tables.
- scope-internal symbol fields such as static slots/stores, debug scope pointers, with-object wrappers, and eval/arguments rejection markers.

Relevant files:

- `src/runtime/shared.ts`
- `src/runtime/execution.ts`
- `src/runtime/opcodes/basic.ts`
- `src/runtime/opcodes/function.ts`
- `src/runtime/opcodes/value.ts`
- `src/runtime/opcodes/generator.ts`
- `web/index.vue`
- `web/vm-host-redirects.ts`

## 3. Snapshot Roots

The serializer should start from explicit roots, then perform graph traversal with object identity preservation.

Primary roots:

- execution pointer and frame stack
- all frame scopes
- all frame value stacks
- global object reachable from frames
- active generator states reachable from frames or generator methods
- registered host capability overlays
- program buffers referenced by frames

Graph traversal must preserve:

- object identity
- cycles
- shared references
- property descriptors
- symbol keys when supported
- array holes and length
- prototypes when the prototype is VM-owned or registered

## 4. Runtime Side Tables

The runtime's internal `WeakMap` and `WeakSet` tables are not iterable, but they can be probed for each reachable object.

Known side tables:

- `functionDescriptors`: metadata for VM-created functions.
- `bindInfo`: metadata for VM-created bound wrappers.
- `generatorStates`: metadata for VM generator methods.
- `environments`: membership marker for VM frames and environment records.

Related runtime caches/factories:

- `literalPoolCache` is derived from program buffers and can be rebuilt rather than serialized as authoritative state.
- generator-function intrinsic caches and dynamic generator constructor factories are realm/factory registration state; restore should either rebuild them from restored globals or re-register the needed dynamic factories when VM-created generator constructors are restored.

Snapshot algorithm:

1. Walk reachable objects from execution roots.
2. For each reachable object/function, probe known side tables:
   - `functionDescriptors.has(obj)`
   - `bindInfo.has(obj)`
   - `generatorStates.has(obj)`
   - `environments.has(obj)`
3. Serialize the side-table metadata using object ids.
4. Continue graph traversal through metadata values.
5. Repeat until a fixed point.

Restore algorithm:

1. Allocate placeholder objects/functions/frames by snapshot id.
2. Rebuild descriptors, scopes, frames, and value stacks.
3. Re-register VM side-table metadata.
4. Re-add restored frames/environment objects to `environments`.
5. Return a new `Execution` object that closes over the restored stack and pointer.

This logic should live inside `src/runtime`, or runtime should expose narrow internal helpers. External code cannot safely reconstruct these side tables.

## 5. User WeakMap And WeakSet

Native `WeakMap` and `WeakSet` entries are not enumerable, but the observable subset can be recovered by probing known reachable candidate keys.

For each reachable `WeakMap`:

1. Keep a list of all reachable object/function candidates.
2. Call captured intrinsic `WeakMap.prototype.has` for each candidate.
3. If present, call captured intrinsic `WeakMap.prototype.get`.
4. Serialize the key/value pair.
5. Traverse recovered values and repeat to a fixed point.

For each reachable `WeakSet`:

1. Probe each reachable object/function candidate with captured `WeakSet.prototype.has`.
2. Serialize present keys.

If a key is not reachable from the VM, then user code cannot use that key to recover the entry. Dropping that entry preserves the VM-observable state, assuming no future host interaction reintroduces the same key.

Checkpointable host rule:

- If host code may later return a previously hidden object key, that host object/function must be represented by a registered host capability or the operation is unsupported.

## 6. Host Capabilities

The VM currently does not distinguish host objects and VM-created objects once they are on the stack, except around VM function calls and redirects. Host mutation is therefore part of the hard boundary problem.

Example:

```js
Math.random.a = {}
```

Without a boundary, this mutates the real host function. The snapshotter cannot know whether `a` is VM-created state unless host objects are registered or compared to a baseline.

Recommended initial approach:

- Use a host capability registry.
- At VM creation, register host objects/functions that are allowed to be reachable.
- Capture baseline own descriptors for each registered host object/function.
- At snapshot, serialize descriptor overlays:
  - added properties
  - changed properties
  - deleted configurable properties when representable
- Restore host objects by stable id, then apply the overlay to the VM-visible capability.
- Reject unknown host objects/functions during snapshot.

This has minimal runtime overhead because most work happens at snapshot time.

Possible later approach:

- Add targeted wrappers for selected host capabilities.
- Writes go into VM-owned overlays.
- Calls forward to the host target.
- Avoid `Proxy` unless necessary; symbol-tagged wrapper objects and explicit call handling are likely cheaper and easier to debug.

Full membrane/isolation is possible but much larger. It would require wrapping/unwrapping across property reads, writes, calls, constructors, prototype checks, `instanceof`, `in`, and host returns.

## 7. Unknown Host Objects

Definition:

> An unknown host object is any reachable object/function that is not VM-owned, not a VM internal frame/scope/function, not a supported built-in value, and not present in the host capability registry.

Two enforcement levels:

- Snapshot-time rejection: cheapest. Unknown host values may exist while running, but checkpointing fails if they are reachable.
- Checkpointable-mode ingress rejection: stricter. Calls to host/native APIs throw when an unsupported host object would enter VM state.

Recommended progression:

1. Start with snapshot-time rejection.
2. Add checkpointable-mode `admitValue(value, path)` checks at host/native boundaries.

Potential `admitValue` boundaries:

- initial `globalThis` and scope objects
- native property reads from registered host objects
- native function return values
- `Reflect.construct` results
- host callback returns
- host iterator results

## 8. Built-In Type Detection

Do not trust prototypes, constructors, `constructor.name`, or `Object.prototype.toString`. User code can patch those.

Use captured intrinsics and internal-slot probes.

Examples:

```ts
const arrayIsArray = Array.isArray
const mapSizeGet = Reflect.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!
const setSizeGet = Reflect.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!
const dateGetTime = Date.prototype.getTime
const weakMapHas = WeakMap.prototype.has
```

Brand checks should call captured operations that require the right internal slots.

Current supported built-ins are intentionally conservative:

- primitives, including `undefined`, `NaN`, `Infinity`, `-0`, and `BigInt`
- plain objects and arrays
- VM functions, including classes, bound wrappers, and synchronous generator descriptors/state
- selected host-created ordinary objects only when admitted by optional serialization redirects
- `Map` and `Set` through brand-specific records
- `WeakMap` and `WeakSet` through reachable-key probing
- unpatched array iterator records

Future built-in additions should use brand-specific records:

- `Date`
- `RegExp`
- `ArrayBuffer` and typed arrays

Current rejected built-ins:

- native `Promise` with pending host async state
- host thenables and async state outside a `VmAsyncSession`
- async generators and async/promise-backed execution state outside the planned VM-owned scheduler
- unknown native iterators other than unpatched array iterators
- `Proxy`
- DOM nodes
- module namespace objects
- host/native functions without a VM descriptor or host capability id

## 9. Iterators

For `for...of`, the compiler already emits normal property lookup and call:

```js
iterable[Symbol.iterator]()
iterator.next()
```

That means patched or VM-authored iterators naturally go through the VM call machinery.

Recommended checkpointable path:

- Use existing host redirects/polyfills for common built-in iterators.
- Redirect native `Array.prototype[Symbol.iterator]` / `values` and similar methods to VM polyfills when checkpointable mode is active.
- Have those polyfills return VM-owned iterator objects with explicit serializable state.
- Preserve user-patched iterators by letting normal property lookup call the user function.

`for...in` is different. The current runtime `GetPropertyIterator` creates a native host generator. Redirects do not help there.

Change `GetPropertyIterator` in checkpointable mode to create a VM-managed record, for example:

```ts
{
  kind: 'forInIterator',
  keys: string[],
  index: number,
}
```

Then `NextEntry` can advance that record without native iterator internal slots.

Unsupported iterator rule:

- VM-authored iterators are supported.
- Redirected built-in iterators are supported.
- Unknown native host iterators are rejected in checkpointable mode if reachable at snapshot or admitted into VM state.

## 10. Serializer Data Model

Use a custom tagged graph format rather than raw JSON of objects.

Suggested record categories:

- primitive records
- object records
- array records
- property descriptor records
- symbol records for supported symbols
- frame records
- scope records
- function descriptor records
- bound function records
- generator state records
- host reference records
- host overlay records
- program reference records
- built-in collection records

Important value tags:

- `undefined`
- `null`
- booleans
- strings
- finite numbers
- `NaN`
- `Infinity`
- `-Infinity`
- `-0`
- `BigInt`
- runtime TDZ sentinel

## 11. Runtime API Sketch

Possible public API:

```ts
type SnapshotOptions = {
  hostRegistry?: HostCapabilityRegistry
}

type RestoreOptions = {
  hostRegistry: HostCapabilityRegistry
  compileFunction?: typeof import('../compiler').compile
  functionRedirects?: WeakMap<Function, Function>
  getDebugFunction?: () => null | (() => void)
}

type CheckpointableOptions = {
  checkpointable?: boolean
  hostRegistry?: HostCapabilityRegistry
}

type CheckpointableAdmission = (value: unknown, path?: string) => void

snapshotExecution(execution, options?: SnapshotOptions): string
restoreExecution(snapshot: string, options: RestoreOptions): Execution
createCheckpointableAdmission(options?: SnapshotOptions): CheckpointableAdmission
```

The actual implementation keeps snapshots as objects internally, exposes stringification separately, and wires strict checkpointable mode through an optional runtime `admitValue` callback.

## 12. Implementation Phases

### Phase 1: Optional V1 Snapshot Shape And Synchronous VM State

Status: implemented as an optional extension; edge-case coverage hardened 2026-05-05.

- Internal object-id graph traversal exists.
- Frames, scopes, value stacks, `ptr`, eval result, program buffers/source, and VM-created ordinary objects/functions are serialized.
- Runtime side tables needed for ordinary VM functions and environments are rebuilt.
- Unknown host objects and unsupported built-ins reject with `UnsupportedSerializationError`.
- Focused Jest coverage exists for pause, snapshot, restore, continue, source embedding, object identity/cycles, static slots, closures, try/finally, host refs, and unsupported-state rejection.

Current boundary: snapshots are guaranteed only at paused synchronous `Fields.step()` boundaries.

### Phase 2: Host Boundary And Capability Registry

Status: descriptor overlays implemented.

- Stable registered host refs round-trip by id.
- Added/changed/deleted own descriptors on registered host capabilities round-trip as overlays.
- Selected safe host-created ordinary objects can be admitted with optional serialization redirects.
- Host prototype and extensibility overlays remain unsupported.
- Unknown host/native objects remain rejected unless admitted by a registry or a specific redirect.

### Phase 3: Iteration Support

Status: implemented for `for...in`, VM-authored iterators, and unpatched array iterators.

- `for...in` uses VM-managed key/index records.
- VM-authored `for...of` iterator records are VM-owned.
- Unpatched array `for...of` uses VM-owned index records.
- Unknown native iterator objects and other built-in iterator families remain rejected.

### Phase 4: Collections And Weak Collections

Status: implemented for `Map`, `Set`, `WeakMap`, and `WeakSet`.

- `Map` and `Set` use captured intrinsic entry/value traversal.
- `WeakMap` and `WeakSet` use reachable-key probing and fixed-point traversal.
- `Date`, `RegExp`, `ArrayBuffer`, and typed arrays remain unsupported.

### Phase 5: Functions, Classes, And Generators

Status: ordinary VM function descriptors, classes, default class constructors, method/accessor `homeObject` metadata, bound VM function metadata, and synchronous VM generator state are implemented.

- Class support includes explicit constructors, default constructors, derived default constructors, methods, accessors, and `super` via restored `homeObject` metadata.
- Bound function support includes apply and construct metadata using the runtime `bindInfo` side table.
- Generator support includes generator function descriptors, suspended stacks, active generator frame links, generator method references, patched generator object methods, `return`/`throw` pending-action metadata, and VM `yield*` delegate records.
- Keep active async/promise state rejected unless explicitly supported.

### Phase 6: Strict Checkpointable Mode

Status: implemented as opt-in admission callbacks.

- `getExecution` / `run` can receive an optional `admitValue` callback without importing serializer APIs into the default runtime.
- `createCheckpointableAdmission({ hostRegistry })` builds an admission callback from the snapshot writer's supported-state rules.
- Admission checks cover initial scopes, function arguments, property reads, value-stack ingress, host call/construct returns that flow through the VM stack, iterator values, object spread/rest ingress, and `with` object ingress.
- Unsupported state throws `UnsupportedSerializationError` before snapshot time when strict admission is enabled.
- Keep normal mode permissive.

### Phase 7: VM-Owned Async Scheduler And Session Snapshots

Status: planned; implement in small committed sub-phases. First version is VM-owned only. Native pending promises and host thenables remain unsupported in snapshots.

Current runtime shape to account for:

- Ordinary VM calls push frames into the current `Execution`, but async functions currently create fresh executions through `createAsyncFromExecution`.
- Promise callbacks passed to native `.then` are retained by the host Promise implementation and later call VM function wrappers as standalone executions.
- The web debugger currently stores one `this.execution`, so a `debugger` inside a promise reaction or async continuation cannot become a global VM pause owner.

Target model:

- Add a `VmAsyncSession` that owns the main execution, active job execution, paused execution, VM promise records, queued reaction jobs, deterministic timer records, virtual time, and host-promise boundary policy.
- In session mode, VM Promise reactions and async continuations become scheduler jobs. Jobs are outside the main execution flow, but they are still session roots and must pause, resume, and serialize with the session.
- `debugger` inside any session execution sets a global session pause. While paused, no queued job, async continuation, or due timer may run.
- Keep `snapshotExecution` synchronous and conservative. Add session-specific optional APIs for async snapshots instead of changing the existing sync snapshot contract.

Sub-phases:

1. **Phase 7A: scheduler core**
   - Add `VmAsyncSession`, VM promise records, FIFO reaction jobs, deterministic timers, and `vmSleep(ticks)`.
   - Install the VM-owned `Promise` and `vmSleep` only through the session/checkpointable path.
   - Acceptance test: `vmSleep(1).then(() => { debugger }).then(() => log('end'))` pauses in the first reaction job; `end` logs only after resume.
   - Commit before continuing.

2. **Phase 7B: async/await integration**
   - In session mode, route async functions through VM promise capabilities instead of native `PromiseCtor`.
   - `OpCode.Await` suspends the async execution and registers a continuation job on the awaited VM promise.
   - Acceptance test:
     ```js
     async function main() {
       vmSleep(2).then(() => log('later'))
       await vmSleep(1)
       debugger
       log('first')
     }
     main()
     ```
     The session pauses at `debugger`; while paused, the `vmSleep(2)` reaction cannot run. After resume, `first` logs before `later`.
   - Commit before continuing.

3. **Phase 7C: global debugger pause in web/runtime stepping**
   - Expose helpers that return the session's current debug execution: paused job execution first, otherwise active job, otherwise main execution.
   - Update web run/resume/step/debug-stack/REPL code to read from the session execution instead of assuming `this.execution` is the only paused VM.
   - Acceptance test: a debugger pause inside a promise job shows the callback stack/scope and resume continues the same job.
   - Commit before continuing.

4. **Phase 7D: session snapshot and restore**
   - Add optional APIs from `src/serialization.ts`: `snapshotVmAsyncSession`, `restoreVmAsyncSession`, `serializeVmAsyncSessionSnapshot`, and `parseVmAsyncSessionSnapshot`.
   - Snapshot roots include main execution, paused execution/job, queued jobs, timer records, VM promise records/reactions, suspended async executions, virtual time, and existing graph roots.
   - Restore rebuilds jobs and promise records so both target examples can be snapshotted while paused, restored, resumed, and completed deterministically.
   - Commit before continuing.

5. **Phase 7E: host boundary guardrails**
   - Keep native pending promises, host thenables, async generators, and unsupported Promise combinators rejected by session snapshots.
   - Add a narrow host-promise policy interface for future phases, but leave the first policy strict unsupported.
   - Negative tests should cover native `Promise.resolve().then(vmFunc)`, host pending promises, host thenables, and async generators.
   - Commit before continuing.

Validation for every Phase 7 sub-phase:

- Focused scheduler/serialization Jest tests for the sub-phase.
- Existing `src/__tests__/async.test.ts` and `src/__tests__/serialization.test.ts` when runtime or serializer behavior changes.
- `npm run build:tsc` for runtime or public type changes.
- `npm run typecheck:web` when debugger/session UI code changes.
- `npm run build-example:serialization-playground` when optional serialization exports or playground behavior changes.

## 13. Runtime Performance Guidance

Lowest runtime overhead:

- host registry plus baseline diff at snapshot time
- no extra checks on every VM property read/write in normal mode

Moderate overhead:

- checkpointable-mode `admitValue` checks at host boundaries
- targeted host wrappers for selected capabilities

Highest overhead:

- full membrane for all host objects/functions

Recommended default:

- Do not add hot-path wrapping in normal mode.
- In checkpointable mode, pay checks only at boundaries needed to preserve the guarantee.
- Prefer redirects/polyfills over runtime special cases when existing call machinery can handle the behavior.

## 14. Open Questions

- Should snapshot format be stable across versions, or only within the same runtime build?
- How should program buffers be identified across processes: inline bytes, hash, caller-provided id, or registry?
- Should restore recreate VM-owned prototypes exactly, or require prototypes to be reachable and serializable?
- How much host overlay mutation should be allowed on non-configurable host properties?
- Should checkpointable mode be exposed in the web UI or only as a library API first?
- After VM-owned async is implemented, should host/native pending promises reject on restore, remain unsupported, or require caller-provided resumable host capabilities?
