# VM State Serialization Plan

Status: investigation notes and proposed implementation direction. VM state serialization is still unimplemented.

Current assumption check (2026-05-04): the overall direction below still matches the runtime shape, but a future implementation must be built from inside `src/runtime` or through narrow internal hooks. The public `Execution` object exposes `ptr`, `stack`, `scopes`, and `step`, but it does not expose all closure-local execution state, registered callbacks, or runtime side-table/cache relationships needed for a complete restore.

Goal: support pausing a Flat JS execution, serializing its observable state to a string-friendly snapshot, restoring it in another runtime instance, and continuing execution from the same VM point.

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

Initial supported built-ins should be conservative:

- primitives, including `undefined`, `NaN`, `Infinity`, `-0`, and `BigInt`
- plain objects and arrays
- `Date`
- `RegExp`
- `Map`
- `Set`
- `WeakMap` and `WeakSet` by reachable-key probing
- `ArrayBuffer` and typed arrays, if needed
- VM functions and classes
- VM generators

Initial rejected built-ins:

- `Promise` with pending native async state
- unknown native iterators
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

snapshotExecution(execution, options?: SnapshotOptions): string
restoreExecution(snapshot: string, options: RestoreOptions): Execution
```

The actual implementation may keep snapshots as objects internally and expose stringification separately.

## 12. Implementation Phases

### Phase 1: Snapshot Shape And Synchronous VM State

- Add internal object-id graph traversal.
- Serialize frames, scopes, value stacks, `ptr`, program references, and VM-created objects.
- Probe and restore runtime side tables.
- Reject unknown host objects and unsupported built-ins.
- Add tests for pause, snapshot, restore, and continue for simple synchronous code.

### Phase 2: Host Capability Registry

- Register known host capabilities by stable id.
- Capture baseline descriptors at VM setup.
- Serialize host descriptor overlays.
- Restore registered host references and overlays.
- Cover cases like `Math.random.a = {}`.

### Phase 3: Collections And Weak Collections

- Add `Map`, `Set`, `WeakMap`, and `WeakSet`.
- For weak collections, implement reachable-key probing and fixed-point traversal.
- Use captured intrinsics only.

### Phase 4: Functions, Classes, And Generators

- Rebuild VM function objects from descriptors.
- Restore bound wrapper metadata.
- Restore generator state and reconnect `.next`, `.throw`, and `.return`.
- Reject active async/promise state unless explicitly supported.

### Phase 5: Iteration Support

- Add checkpointable built-in iterator redirects/polyfills.
- Replace or augment `GetPropertyIterator` with a VM-managed for-in iterator in checkpointable mode.
- Reject unknown native iterators.

### Phase 6: Strict Checkpointable Mode

- Add `admitValue` checks at host/native ingress points.
- Throw early when unsupported state would enter reachable VM state.
- Keep normal mode permissive.

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
- How should pending async functions and promises be represented, if at all?
