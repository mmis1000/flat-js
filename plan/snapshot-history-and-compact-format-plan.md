# Snapshot History And Compact Format Implementation Plan

> **For Hermes:** Execute this plan with strict TDD. Write failing tests first, run them to confirm failure, then implement the smallest runtime/public API changes that pass.

**Goal:** Add a versioned compact snapshot text format that materially shrinks array/object-heavy snapshots, and add a reusable checkpoint history tree API for both synchronous execution snapshots and VM async session snapshots.

**Architecture:** Keep the authoritative in-memory snapshot objects (`ExecutionSnapshot`, `VmAsyncSessionSnapshot`) unchanged so restore logic stays stable. Implement compact encoding/decoding only at the text serialization layer in `src/runtime/serialization.ts`, and introduce a separate history container API that stores full snapshots in a parent-linked checkpoint DAG. Parse functions must accept both legacy raw JSON snapshots and the new compact envelope/history formats.

**Tech Stack:** TypeScript, Jest, existing Flat JS serialization runtime, no new external dependencies.

---

## Acceptance Criteria

1. `serializeExecutionSnapshot()` and `serializeVmAsyncSessionSnapshot()` produce a new compact text format by default.
2. `parseExecutionSnapshot()` and `parseVmAsyncSessionSnapshot()` accept both:
   - legacy raw snapshot JSON
   - new compact envelope JSON
3. Compact text is smaller than `JSON.stringify(snapshot)` for array-heavy snapshots.
4. Round-trip behavior is unchanged after parse + restore.
5. New public history APIs support:
   - creating empty history trees
   - appending execution checkpoints
   - appending async-session checkpoints
   - branching from any parent checkpoint
   - serializing/parsing history trees
   - restoring a checkpoint by id
6. History serialization uses the compact payload encoding internally.
7. Existing optional-extension boundary remains intact: no serializer exports are added to default runtime/loader surfaces beyond `src/serialization.ts`.
8. `plan/vm-state-serialization-plan.md` is updated with the new phase status and validation commands.

---

## Files

- Modify: `src/runtime/serialization.ts`
- Modify: `src/serialization.ts`
- Modify: `src/__tests__/serialization.test.ts`
- Modify: `src/__tests__/vm-async-scheduler.test.ts`
- Modify: `plan/vm-state-serialization-plan.md`
- Create: `plan/snapshot-history-and-compact-format-plan.md`

---

## Task 1: Add failing compact-format tests

**Objective:** Prove the desired compact text and legacy-compat parsing behavior before implementation.

### Step 1: Add execution snapshot compact-format tests
Add Jest coverage in `src/__tests__/serialization.test.ts` for:
- compact serialized text round-trips through `parseExecutionSnapshot()` and `restoreExecution()`
- compact text is shorter than legacy `JSON.stringify(snapshot)` for an array-heavy paused execution
- legacy raw JSON snapshots still parse successfully

### Step 2: Add async session compact-format tests
Add Jest coverage in `src/__tests__/vm-async-scheduler.test.ts` for:
- compact serialized session snapshot round-trips through parse/restore
- legacy raw JSON session snapshots still parse successfully

### Step 3: Run focused tests and confirm failure
Run:
- `npm test -- --runInBand src/__tests__/serialization.test.ts`
- `npm test -- --runInBand src/__tests__/vm-async-scheduler.test.ts`

Expected before implementation: new compact-format expectations fail because serialization still uses raw `JSON.stringify(...)` and no history API exists.

---

## Task 2: Add failing checkpoint-history tests

**Objective:** Lock down the public history tree API before implementation.

### Step 1: Add execution checkpoint history tests
In `src/__tests__/serialization.test.ts`, add tests for:
- creating empty history
- appending a root checkpoint
- branching from an older checkpoint
- serializing/parsing history
- restoring checkpoints by id

### Step 2: Add async session checkpoint history tests
In `src/__tests__/vm-async-scheduler.test.ts`, add tests for:
- appending paused session checkpoints to a history tree
- branching from a paused checkpoint
- restoring a paused session checkpoint by id and continuing execution

### Step 3: Re-run focused tests and confirm failure
Run the same focused Jest commands. Expected: missing exported functions/types.

---

## Task 3: Implement compact encoding/decoding

**Objective:** Shrink snapshot text without changing restore semantics.

### Step 1: Add internal compact value/key/descriptor encoders
Inside `src/runtime/serialization.ts`:
- add compact tuple encoders/decoders for `SnapshotValue` and `SnapshotKey`
- add compact descriptor encoding with default-flag elision
- add array-specialized encoding that stores default writable/enumerable/configurable index values without full descriptor objects

### Step 2: Add compact envelope encoders for execution and session snapshots
Implement internal helpers that convert authoritative snapshot objects into:
- a compact execution envelope
- a compact VM async session envelope

### Step 3: Add compatible parsers
Update `parseExecutionSnapshot()` and `parseVmAsyncSessionSnapshot()` to accept:
- legacy v1 raw snapshots
- new compact envelope documents

### Step 4: Keep restore paths unchanged
Decode compact envelopes back to the existing `ExecutionSnapshot` / `VmAsyncSessionSnapshot` object shapes before calling restore logic.

---

## Task 4: Implement checkpoint history tree API

**Objective:** Add full-snapshot history trees with branching and restore support.

### Step 1: Add history types and public exports
In `src/runtime/serialization.ts` define and export:
- `SnapshotCheckpointKind`
- `ExecutionSnapshotCheckpoint`
- `VmAsyncSessionSnapshotCheckpoint`
- `SnapshotHistory`
- history metadata option types if needed

### Step 2: Add create/append helpers
Implement helpers to:
- create an empty history
- append execution checkpoints
- append async session checkpoints
- branch from any parent checkpoint by explicit `parentId`
- update `headId` and `rootIds`

### Step 3: Add restore helpers
Implement helpers to:
- restore execution checkpoint by id
- restore async session checkpoint by id
- validate kind mismatches with clear errors

### Step 4: Add history serialization/parsing
Implement:
- `serializeSnapshotHistory(history)`
- `parseSnapshotHistory(text)`

Use compact payload encoding internally for each checkpoint snapshot.

---

## Task 5: Update docs and validate broadly

**Objective:** Document the new phase and verify the touched surfaces.

### Step 1: Update `plan/vm-state-serialization-plan.md`
Record the new follow-up phase for compact text/history support, current status, and remaining limitations.

### Step 2: Run focused validation
Run:
- `npm test -- --runInBand src/__tests__/serialization.test.ts`
- `npm test -- --runInBand src/__tests__/vm-async-scheduler.test.ts`

### Step 3: Run touched-scope build validation
Run:
- `npm run build:tsc`
- `npm run build-example:serialization-playground`

### Step 4: Run repo health gate before commit
Run the branch-working-status minimum touched-scope gate:
- `npm run build`
- `npm run typecheck:web`
- `npm test`

### Step 5: Commit and push
Use a conventional commit message describing compact snapshot encoding and checkpoint history.

---

## Remaining Deliberate Non-Goals For This Patch

- No delta checkpoint storage yet; this patch adds a checkpoint tree of full snapshots.
- No browser UI tree editor in the serialization playground yet.
- No binary gzip/brotli payload format yet; this patch focuses on semantic compaction in plain JSON.
- No cross-version compatibility promise beyond parser support for legacy raw JSON and the new compact envelopes in this codebase.
