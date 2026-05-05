---
name: flat-js-vm-serialization
description: "Use when planning or implementing Flat JS VM state serialization, execution snapshots, snapshot restore, host capability registries, serializable runtime records, iterator/collection/function/generator/async serialization support, serialization playground work, or updates to `plan/vm-state-serialization-plan.md`. Guides phased work, runtime boundaries, unsupported-state policy, and validation gates."
---

# Flat JS VM Serialization

## Core Contract

- Treat serialization as a guaranteed subset: `snapshotExecution` must either produce a complete snapshot or throw `UnsupportedSerializationError`.
- Keep the serializer optional. Do not export it from the default runtime, inline runtime, loader output, or generated self-contained loaders unless the plan explicitly changes.
- Preserve normal runtime behavior. Add checkpointable-mode checks only where a phase needs them.
- Prefer VM-owned records, captured intrinsics, and narrow runtime internals over broad host membranes.
- Keep async/promise state unsupported until there is a deterministic scheduler and host-promise boundary model.

## Phase Workflow

1. Re-read `plan/vm-state-serialization-plan.md` and pick one phase or sub-phase. Do not mix unrelated surfaces such as host overlays, iterators, collections, and async state in one patch.
2. Write acceptance criteria before editing runtime code:
   - supported round-trip cases,
   - explicit unsupported-state rejections,
   - restore continuation behavior,
   - loader/default-export guardrails.
3. Add focused tests first in `src/__tests__/serialization.test.ts` or a nearby serialization-specific test. Cover both positive and negative behavior.
4. Implement the smallest runtime shape that satisfies the phase. Prefer `src/runtime/serialization.ts` and narrow helpers from `src/runtime/shared.ts` / `src/runtime/execution.ts`.
5. Preserve identity and observability: cycles, descriptors, prototypes, side-table metadata, frame state, host capability ids, and eval result must either round-trip or reject.
6. Update the plan status for the phase just changed, including any new unsupported cases that remain by design.

## Phase Order

1. Harden V1 correctness first: loops, prototype graphs, sparse arrays, accessors, symbol descriptors, non-extensible objects, and restore-after-REPL state.
2. Finish the host boundary before admitting more native objects: registered host refs, descriptor overlays, deletion semantics, and unknown-host rejection.
3. Add iterator state next: VM-managed `for...in` records, then redirected VM-owned built-in iterator records for common `for...of` flows.
4. Add collections in layers: `Map`/`Set` records before `WeakMap`/`WeakSet` reachable-key probing.
5. Expand function families only after their dependencies are ready: classes after ordinary function metadata is proven, bound wrappers after host overlays, generators after iterator records.
6. Add strict checkpointable ingress after the supported state set is broad enough to be useful.
7. Leave async/promise serialization last. Begin with negative tests and a scheduler design, not with native `Promise` object capture.

## Validation Gate

- Run the focused serialization Jest tests for every phase.
- Run `npm run build:tsc` when runtime or public types change.
- Run `npm run build-example:serialization-playground` when the playground, serialization exports, or bundled optional API shape changes.
- Check that `src/runtime-inline.ts`, default runtime exports, CLI self-contained loader output, and generated inline runtime still do not include optional serializer APIs unless intentionally changed.
- Use `$flat-js-branch-working-status` before calling broad compiler/runtime serialization work green.
