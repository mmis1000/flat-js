# Opcode Obfuscation — Multi-Layer Static Analysis Resistance

## Problem

Program data uses fixed, sequential opcode values from `const enum OpCode` (0–92).
Even after terser minification, the dispatch switch retains the same numeric case arms.
An attacker cross-references program bytes against switch cases to read the instruction
stream without executing anything.

Additionally, opcode words occupy a tiny value range `[0, 92]` while operands and data
span the full 32-bit range, making opcodes trivially identifiable via entropy /
value-range analysis.

---

## Solution: Four Encoding Layers

Each layer independently raises the cost of static analysis. Combined, they produce
output that requires a custom trace-based emulator to decode.

### Layer Summary

| # | Layer | Defeats |
|---|-------|---------|
| 1 | False-branch & inline junk injection | Instruction counting, boundary detection, signature matching |
| 2 | Opcode aliasing | Frequency analysis |
| 3 | Path & position dependent 32-bit cipher | Static single-pass decoding; requires sequential tracing |
| 4 | Global seeded shuffle | Cross-program correlation, case-arm matching |

### Encoding Pipeline (compile time)

```
Source
  |
  v
1. Generate Segments (with Aliases)                         <- Layer 2
  |
  v
2. Inject False-Branch & Inline Junk                        <- Layer 1
   (JumpIfNot over valid-code; junk opcodes in real path)
  |
  v
3. Inject Reseed ops at jump targets + fn entries           <- Layer 3
  |
  v
4. Flatten Segments -> genOffset -> generateData
   -> finalizeLiteralPool
  |
  v
5. Snapshot used opcodes (pre-encoding)
  |
  v
6. Apply combined 32-bit cipher                             <- Layer 3
   (blockSeed starts at 0; first segment's Reseed sets it.
    Key = activeBlockSeed ^ positionMask. Every word is transformed.)
   Returns opcode positions for Layer 4.
  |
  v
7. Apply global Fisher-Yates shuffle                        <- Layer 4
   (Reuses opcode positions from step 6.)
  |
  v
8. Append XOR-masked global seed to programData
  |
  v
Output: number[]
```

### Decoding Pipeline (runtime)

```
read raw word from program[ptr++]
  |
  v
Layer 3 Un-cipher:                                          <- Layer 3 (Path + Pos)
  val = blockInverseTransform(val, blockSeed ^ streamMask(pos))
  |
  v
Layer 4 Un-shuffle: val = inversePerm[val]                  <- Domain: [0, _COUNT)
  |
  +-- Reseed?                                               <- Layer 3 (Seeded Seed)
  |   |
  |   +-- rawNextSeed = read() // Decoded via Layer 3
  |      blockSeed = rawNextSeed
  |      continue
  |
  v
Dispatch via switch                                         <- Layer 2 (Aliases)
  +-- known opcode / alias -> execute handler
  +-- default -> 1-word NOP (break)                         <- Layer 1 (Inline Junk)
```

---

## Layer 1: Junk & False-Branch Injection

This layer pollutes the instruction stream with two types of garbage to defeat
instruction counting and pattern matching.

### 1. False-Branch Dead Code
Insert blocks of dead code using **existing VM control flow** — a `JumpIfNot` with
a guaranteed-falsy condition that jumps over the garbage. The garbage consists of
**valid opcodes** (to look like real code). No new opcodes needed.

### 2. Inline Garbage Injection (The "Needle in Haystack")
Insert **invalid opcodes** directly into the real execution path. The runtime's
`default` dispatch arm treats these as 1-word NOPs, skipping them silently.

### Why This Works
- After all encoding layers, **False Branches** look like real conditional logic.
- The **Real Path** is littered with noise that doesn't exist in the runtime's
  handler table.
- An attacker cannot tell if a sequence of bytes is a `Literal(0x1234)` or a
  `JunkOp` followed by a `RealOp`.

### Compiler: inject garbage

After generating each segment but **before** expansion:

```ts
function injectGarbage(segment: Segment): Segment {
    const out: Op[] = []
    for (const o of segment) {
        // 5% chance to inject an inline invalid opcode
        if (Math.random() < 0.05) {
            out.push(generateInvalidOp())
        }

        // 20% chance to insert a dead branch before real ops
        if (!o.internal && Math.random() < 0.2) {
            out.push(...generateDeadBranch())
        }
        out.push(o)
    }
    return out
}
```

### Dead branch generation

```ts
function generateDeadBranch(): Op[] {
    // Generate valid-but-useless instructions as dead code
    const deadCodeLen = 1 + Math.floor(Math.random() * 4)
    const deadOps = generateJunkOps(deadCodeLen)

    // after: the NOP that JumpIfNot targets
    const after = op(OpCode.Nop, 0)

    // The jump target can be pushed as a plain Literal(offset) or as an
    // arithmetic sequence (e.g. Literal(a), Literal(b), Add) — any ops
    // that leave the correct number on the stack work.
    return [
        op(OpCode.NodeOffset, 2, [after]),        // emits as Literal(offset)
        randomFalsyOp(),                          // push falsy value
        op(OpCode.JumpIfNot),                     // always taken -> jump to after
        ...deadOps,                               // dead code — never executed
        after                                     // jump lands here
    ]
}
```

### Dead code ops

Dead code is never executed, so its content is completely irrelevant — it only
needs correct `length` values so `genOffset` and encoding walks handle alignment
correctly. Values can be truly random or fake literals pointing nowhere.

**Emit pipeline constraint:** `generateData` currently throws on unknown multi-word
ops (the `default` branch at the end of its `switch (op.op)`). Two options:

1. **Keep dead code as valid `Op` objects** but restrict to types `generateData`
   already handles — `Literal` (with random `preData`) for 2-word, any 1-word opcode
   for single-word. Simple, no pipeline changes needed.
2. **Add a raw-emit path** in `generateData`: ops with an `internal` flag or a new
   `RawWord` pseudo-opcode bypass the switch and emit `op.op` (+ `op.preData[0]` if
   `length === 2`) directly. This allows truly arbitrary values but requires a small
   `generateData` change.

Option 2 is preferred — it makes dead code maximally noisy and decouples junk
generation from the set of real opcodes.

```ts
// In generateData, add before the existing else branch:
} else if (op.raw) {
    // Raw emit for junk ops — bypass opcode-specific serialization
    programData.push(op.op)
    for (let j = 0; j < op.length - 1; j++) {
        programData.push(op.preData[j] as number)
    }
}

function generateJunkOps(count: number): Op[] {
    const result: Op[] = []
    for (let i = 0; i < count; i++) {
        if (Math.random() < 0.3) {
            // 2-word: fake literal with arbitrary random operand
            result.push({
                op: OpCode.Literal,
                length: 2,
                preData: [(Math.random() * 0x100000000) | 0],
                data: [],
                internal: true,
                raw: true,
                offset: -1
            })
        } else {
            // 1-word: any random value (never executed)
            result.push({
                op: (Math.floor(Math.random() * OpCode._COUNT)) as OpCode,
                length: 1,
                preData: [],
                data: [],
                internal: true,
                raw: true,
                offset: -1
            })
        }
    }
    return result
}

function randomFalsyOp(): Op {
    const choices = [
        () => op(OpCode.NullLiteral),
        () => op(OpCode.UndefinedLiteral),
        () => op(OpCode.Literal, 2, [0]),
        () => op(OpCode.Literal, 2, [false]),
        () => op(OpCode.Literal, 2, ['']),
    ]
    return choices[Math.floor(Math.random() * choices.length)]!()
}
```

### Inline junk generation

Inline junk uses opcode values outside the known dispatch range. The runtime's
`default` arm treats them as 1-word NOPs.

```ts
function generateInvalidOp(): Op {
    // Value in [_COUNT, 0xFFFF] — won't match any case arm after decoding
    const junkValue = OpCode._COUNT + Math.floor(Math.random() * 100)
    return {
        op: junkValue as OpCode,
        length: 1,
        preData: [],
        data: [],
        internal: true,
        offset: -1
    }
}
```

### Runtime: default case as safety net

The runtime's dispatch switch gains a `default` arm for unknown opcodes:

```ts
command: switch (command) {
    // ...all existing cases...
    default:
        // Unknown opcode — treat as 1-word NOP
        break
}
```

This handles both inline junk (which does execute) and serves as a safety net
for dead code (which never actually executes thanks to `JumpIfNot`).

### Why This Works

After all encoding layers, the dead branch pattern:
```
[Literal/null] [JumpIfNot] [garbage ops...] [after:]
```
looks **identical** to any real conditional branch:
```
[condition_expr] [JumpIfNot] [then_body ops...] [after:]
```

The attacker cannot distinguish dead branches from real ones without tracing
execution — which requires decoding all four layers first.

---

## Layer 2: Opcode Aliasing

Multiple enum values map to the same handler. The compiler randomly selects among
them. After shuffling, frequency analysis cannot identify hot opcodes.

### New OpCode entries

```ts
export const enum OpCode {
    // ...existing through ArraySpread (=92)...

    /** Reseed for Layer 3 */
    Reseed = 93,

    // Aliases — same semantics as their base opcode
    LiteralAlias1,        // 94
    LiteralAlias2,        // 95
    GetAlias1,            // 96
    SetAlias1,            // 97
    PopAlias1,            // 98
    JumpAlias1,           // 99
    JumpIfNotAlias1,      // 100
    GetRecordAlias1,      // 101
    DuplicateAlias1,      // 102

    /** Sentinel — must remain last. Domain size for shuffle. */
    _COUNT                // 103
}
```

### Compiler: random alias selection

```ts
const OPCODE_ALIASES: Partial<Record<OpCode, OpCode[]>> = {
    [OpCode.Literal]:    [OpCode.LiteralAlias1, OpCode.LiteralAlias2],
    [OpCode.Get]:        [OpCode.GetAlias1],
    [OpCode.Set]:        [OpCode.SetAlias1],
    [OpCode.Pop]:        [OpCode.PopAlias1],
    [OpCode.Jump]:       [OpCode.JumpAlias1],
    [OpCode.JumpIfNot]:  [OpCode.JumpIfNotAlias1],
    [OpCode.GetRecord]:  [OpCode.GetRecordAlias1],
    [OpCode.Duplicate]:  [OpCode.DuplicateAlias1],
}
```

Applied during `generateData` when emitting opcode words. Alias ops have the same
`length` as the original (2 for Literal aliases, 1 for the rest).

### Runtime: case fallthrough

```ts
case OpCode.Literal:
case OpCode.LiteralAlias1:
case OpCode.LiteralAlias2: {
    const value = read()
    // ...same handler...
}

case OpCode.Get:
case OpCode.GetAlias1: {
    // ...same handler...
}

// etc. for all aliases
```

### Multi-word instruction detection

All code that scans for multi-word instructions must recognize aliases:

```ts
const isLiteralFamily = (op: number): boolean =>
    op === OpCode.Literal ||
    op === OpCode.LiteralAlias1 ||
    op === OpCode.LiteralAlias2
```

Used in `collectUsedOpcodes`, `finalizeLiteralPool`, `remapProgramOpcodes`,
and `applyBlockKeying`.

---

## Layer 3: Path & Position Dependent 32-bit Cipher

This layer combines block-level state (`blockSeed`) with position-level state
(`streamMask(pos)`) into a single high-entropy 32-bit key.

This ensures that:
1. Every executable block is path-dependent (requires following the `Reseed` chain).
2. Every word within a block is unique (repeated opcodes have different ciphertext).
3. The entropy is spread across the full 32-bit spectrum (opcodes are no longer
   distinguishable from operands by value range).

### Derived Key Algorithm

```ts
function getDerivedKey(activeSeed: number, pos: number, globalSeed: number): number {
    return (activeSeed ^ opcodeStreamMask(pos, globalSeed)) >>> 0
}
```

Encryption and decryption use `getDerivedKey()` to parameterize the block mixer.
This makes the cipher both temporally (path) and spatially (position) sensitive.

### Reversible 32-bit Transformation

Every word in the program is transformed using the derived key. Instead of simple
modular addition, we use a seed-dependent 32-bit mixer for stronger diffusion:

```ts
/** Reversible 32-bit transform parameterized by key */
function blockTransform(word: number, key: number): number {
    let x = (word ^ key) | 0
    x ^= (x >>> 16)
    x = Math.imul(x, 0x85ebca6b)
    x ^= (x >>> 13)
    x = Math.imul(x, 0xc2b2ae35)
    x ^= (x >>> 16)
    return x >>> 0
}

/** Inverse of blockTransform — reverses the mix steps */
function blockInverseTransform(word: number, key: number): number {
    let x = word | 0
    // Reverse: undo x ^= (x >>> 16)
    x ^= (x >>> 16)
    // Reverse: undo x = Math.imul(x, 0xc2b2ae35)
    x = Math.imul(x, inverseModMul(0xc2b2ae35))
    // Reverse: undo x ^= (x >>> 13)
    x ^= (x >>> 13)
    x ^= (x >>> 26)
    // Reverse: undo x = Math.imul(x, 0x85ebca6b)
    x = Math.imul(x, inverseModMul(0x85ebca6b))
    // Reverse: undo x ^= (x >>> 16)
    x ^= (x >>> 16)
    // Reverse: undo x ^ key
    x = (x ^ key) | 0
    return x >>> 0
}
```

> Note: `inverseModMul(c)` computes the modular multiplicative inverse of `c`
> mod 2^32. These are constants that can be precomputed.

### Tagging (Compiler Stage)

The `Op` structure is updated to include a `seedId`:

```ts
type Op<Code extends OpCode = OpCode> = {
    op: Code
    length: number
    preData: unknown[]
    data: number[]
    // ...
    seedId?: number     // Unique ID marking this Op as a transition target
}
```

- **Jump Targets**: Marked with a `seedId`.
- **Function Entries**: Marked with a `seedId`.

### Expansion (Expansion Stage)

A dedicated pass `expandReseeds(segments: Segment[])` runs before flattening. It:
- Generates unique random keys for every unique `seedId`.
- At every source exit (before a Jump or at a Fallthrough), it inserts:
  `[Literal(targetKey), Reseed]`.
- Note: Both the `Reseed` opcode and the `targetKey` operand are fully keyed.

### How block keying works

```
Block A (Seed_A) Exiting to Block B (Seed_B):
  [Reseed]        <-- encoded: blockTransform(Reseed, derivedKey_A)
  [Value: Seed_B] <-- encoded: blockTransform(Seed_B, derivedKey_A)

  // Handover: next instructions use Seed_B
  [Literal: Off]  <-- encoded: blockTransform(Literal, derivedKey_B)
  [Jump]          <-- encoded: blockTransform(Jump, derivedKey_B)
```

The Reseed instruction and its operand are themselves encrypted using the current
block's derived key. This ensures the handover itself is opaque ("seeded seed").

### Dead code interaction

Dead code from Layer 1 sits between a `JumpIfNot` and a jump target. The encoding
walk traverses it normally because dead code consists of valid Ops with correct
`length`. Block keying is applied to the dead opcodes too, but since they are never
executed, the keyed values are irrelevant — they just add noise.

### Compiler: assign seedIds, insert Reseeds at jump sources

Reseeds are inserted at the **source** (before the jump), not at the target.
This is because multiple sources may jump to the same target — each source
independently sets up the target's seed before arriving. Modifying the target
would break code semantics.

Jump targets are known from `NodeOffset` ops at compile time. `NodeOffset`
is a pseudo-op — `generateData` emits it as `Literal(offset)`, so it becomes
an ordinary Literal in the output stream, fully subject to aliasing and the
cipher like any other instruction. It could also be emitted as an arithmetic
sequence (e.g. `Literal(a), Literal(b), Add`) since the jump only needs the
correct number on the stack — this makes jump targets indistinguishable from
general computation in the encoded output.

Before flattening:

```ts
function injectReseedTags(segments: Segment[]): void {
    // 1. Collect all jump-target Op references
    //    (NodeOffset.preData[0] holds a reference to the target Op)
    const jumpTargets = new Set<Op>()
    for (const seg of segments) {
        for (const o of seg) {
            if (o.op === OpCode.NodeOffset) {
                const target = o.preData[0]
                if (target.kind === undefined) jumpTargets.add(target as Op)
            }
        }
    }

    // 2. Assign seedIds to function entries and jump targets
    let nextId = 1
    for (const seg of segments) {
        seg[0].seedId = nextId++ // Function entry
        for (const o of seg) {
            if (jumpTargets.has(o)) o.seedId = nextId++
        }
    }

    // 3. Retag jump instructions with the TARGET's seedId.
    //
    //    expandReseeds will insert [Literal(key), Reseed] before the
    //    jump. After Reseed executes, blockSeed switches to the target's
    //    key. The jump instruction itself runs AFTER the Reseed, so it
    //    must be encoded with the new seed:
    //
    //      Literal<offset(B)>   seedId=A   // NodeOffset emitted as Literal
    //      Literal<KeyB>        seedId=A   // (inserted by expandReseeds)
    //      Reseed               seedId=A   // (inserted by expandReseeds)
    //      Jump                 seedId=B   // retagged — encoded with KeyB
    //
    //    Without retagging, Jump would be encoded with KeyA but the
    //    runtime decodes with KeyB after Reseed -> crash.
    //
    for (const seg of segments) {
        for (let i = 0; i < seg.length; i++) {
            const o = seg[i]
            if (o.op === OpCode.NodeOffset) {
                const target = o.preData[0]
                if (target.kind === undefined) {
                    const targetOp = target as Op
                    // Find the jump op that consumes this address
                    // and retag it with the target's seedId
                    const jumpOp = findConsumingJump(seg, i)
                    if (jumpOp && targetOp.seedId) {
                        jumpOp.seedId = targetOp.seedId
                    }
                }
            }
        }
    }
}

function expandReseeds(segments: Segment[]): void {
    const keys = new Map<number, number>()
    // Walk each segment linearly. At every seedId transition:
    //   - Insert [Literal(targetKey), Reseed] before the op with the new seedId
    //   - The Reseed and its operand keep the OLD seedId (encoded with old key)
    //   - The op with the new seedId (e.g. the retagged Jump) is encoded with new key
}
```

### Compiler: apply combined cipher (after generateData + finalizeLiteralPool)

This pass applies the 32-bit cipher to every word in the code region,
and records opcode positions for Layer 4 to reuse.

```ts
function applyBlockKeying(
    programData: number[], codeLength: number, globalSeed: number
): number[] {
    let activeSeed = 0
    let i = 0
    const opcodePositions: number[] = []

    while (i < codeLength) {
        opcodePositions.push(i)
        const opWord = programData[i]
        const derivedKey = getDerivedKey(activeSeed, i, globalSeed)
        programData[i] = blockTransform(opWord, derivedKey)

        if (getUnkeyedOp(opWord) === OpCode.Reseed) {
            const targetSeed = programData[i + 1]
            const seedKey = getDerivedKey(activeSeed, i + 1, globalSeed)
            programData[i + 1] = blockTransform(targetSeed, seedKey)
            activeSeed = targetSeed
            i += 2
        } else if (isLiteralFamily(getUnkeyedOp(opWord))) {
            const operandKey = getDerivedKey(activeSeed, i + 1, globalSeed)
            programData[i + 1] = blockTransform(programData[i + 1], operandKey)
            i += 2
        } else {
            i += 1
        }
    }
    return opcodePositions
}
```

### Runtime: decode with derived key

Handled inside the unified `decodeOp()` function (see Combined Encoding & Decoding).

---

## Layer 4: Global Seeded Shuffle

A per-program Fisher-Yates permutation over the full opcode domain `[0, _COUNT)`.
Applied **after** the Layer 3 cipher, using the opcode positions recorded by Layer 3.

### Shared PRNG (MUST SYNC between compiler and runtime)

```ts
const OPCODE_SEED_MASK = 0x5A3C96E1

function opcodeShufflePrng(seed: number): () => number {
    let s = seed | 0
    return () => { s = (s * 1664525 + 1013904223) | 0; return s >>> 0 }
}

function generateOpcodePermutation(seed: number): number[] {
    const n = OpCode._COUNT
    const perm = Array.from({ length: n }, (_, i) => i)
    const next = opcodeShufflePrng(seed)
    for (let i = n - 1; i > 0; i--) {
        const j = next() % (i + 1)
        const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp
    }
    return perm   // perm[original] = shuffled
}
```

### Stream mask function (used by Layer 3's derived key)

```ts
const opcodeStreamMask = (pos: number, seed: number): number => {
    let x = (pos * 0x9e3779b9 + seed) | 0
    x = ((x >>> 16) ^ x) * 0x45d9f3b | 0
    x = ((x >>> 16) ^ x) * 0x45d9f3b | 0
    return ((x >>> 16) ^ x) | 0
}
```

Uses splitmix32-style integer hashing. Deterministic from (position, seed),
full 32-bit output, no correlation between adjacent positions.

### Compiler: remap opcode positions

The shuffle uses opcode positions recorded by `applyBlockKeying` (Layer 3).
This avoids the alignment detection problem — after keying, the keyed opcode
values may no longer be recognizable as Literal-family members.

```ts
function remapProgramOpcodes(
    programData: number[], opcodePositions: number[], perm: number[]
): void {
    for (const pos of opcodePositions) {
        programData[pos] = perm[programData[pos]]
    }
}
```

### Runtime: inverse permutation (cached per program array)

```ts
const inversePermCache = new WeakMap<number[], number[]>()

function getInversePerm(program: number[]): number[] {
    let cached = inversePermCache.get(program)
    if (!cached) {
        const seed = (program[program.length - 1] ^ OPCODE_SEED_MASK) >>> 0
        const perm = generateOpcodePermutation(seed)
        cached = new Array(perm.length)
        for (let i = 0; i < perm.length; i++) cached[perm[i]] = i
        inversePermCache.set(program, cached)
    }
    return cached
}
```

### Seed Storage

The **Global Seed** (which defines both the shuffle permutation and the position
masks) is appended **after the literal pool** as the very last word of
`programData`, XOR-masked. The program layout is:

```
[ code region (0..codeLength) | literal pool | masked seed ]
                                               ^
                                    program[program.length - 1]
```

```ts
const OPCODE_SEED_MASK = 0x5A3C96E1
// Appended after finalizeLiteralPool and all encoding passes
programData.push((globalSeed ^ OPCODE_SEED_MASK) | 0)
```

The runtime reads it via `program[program.length - 1]`, which always locates
the seed regardless of literal pool size.

No special bootstrap header is needed. The block seed starts at 0, and the
first segment already begins with a normal `Reseed` instruction (every function
entry gets one from `injectReseedTags`). The runtime just starts decoding from
`ptr = 0` using the normal pipeline.

---

## Combined Encoding & Decoding

### Full `compile()` integration

```ts
// 1. Generate segments (L2 Aliases applied inside generateData)

// 2. Inject garbage — false branches + inline junk (L1)
for (const seg of allSegments) {
    const withGarbage = injectGarbage(seg)
    seg.length = 0; seg.push(...withGarbage)
}

// 3. injectReseedTags + expandReseeds (L3)
injectReseedTags(allSegments)
expandReseeds(allSegments)

// 4. Flatten + assign offsets
const flattened = allSegments.flat()
genOffset(flattened)

// 5. Serialize
generateData(flattened, fnRootToSegment, programData, literalValues)
const codeLength = programData.length
finalizeLiteralPool(programData, literalValues)

// 6. Snapshot used opcodes (pre-encoding)
const usedOpcodes = collectUsedOpcodes(programData, codeLength)

// 7. Layer 3: combined 32-bit cipher (returns opcode positions)
//    blockSeed starts at 0; first segment's Reseed sets it normally
const globalSeed = options.shuffleSeed
    ?? ((Math.random() * 0x100000000) | 0)
const opcodePositions = applyBlockKeying(programData, codeLength, globalSeed)

// 8. Layer 4: global shuffle (reuses positions from step 7)
const perm = generateOpcodePermutation(globalSeed)
remapProgramOpcodes(programData, opcodePositions, perm)

// 9. Append masked seed
programData.push((globalSeed ^ OPCODE_SEED_MASK) | 0)

return [programData, { sourceMap, internals, codeLength, usedOpcodes }]
```

### Full runtime decode

```ts
// Setup (once per execution context):
const globalSeed = (program[program.length - 1] ^ OPCODE_SEED_MASK) >>> 0
const inversePerm = getInversePerm(program)
let blockSeed = 0   // First segment's Reseed sets the real seed
let ptr = 0

// Auto-decrypting read:
const read = (): number => {
    const pos = ptr
    const raw = currentProgram[ptr++]
    const derivedKey = getDerivedKey(blockSeed, pos, globalSeed)
    return blockInverseTransform(raw, derivedKey)
}

// Unified opcode decoder (Layer 4 -> Layer 3):
const decodeOp = (): OpCode => {
    while (true) {
        let val = read()                            // Layer 3: un-cipher

        // Layer 4: un-shuffle
        val = inversePerm[val]

        if (val === OpCode.Reseed) {                // Layer 3: seed handover
            const rawNextSeed = read()
            blockSeed = rawNextSeed
            continue
        }
        return val as OpCode
    }
}

// In step():
const command = decodeOp()
command: switch (command) {
    case OpCode.Literal:
    case OpCode.LiteralAlias1:
    case OpCode.LiteralAlias2: {
        const value = read()     // auto-decrypted operand
        // ...same handler...
    }
    // ...all existing cases + alias fallthrough cases...

    default:
        // Unknown opcode — 1-word NOP (inline junk from Layer 1)
        break
}
```

### Entropy result

| Word type | Before cipher | After cipher |
|-----------|---------------|--------------|
| Opcode (e.g. Get=23) | `23` — tiny, obvious | `0xA7F3209B` — random |
| Literal operand (small int) | `42` — tiny | `0x3E1C8A4F` — random |
| Literal operand (pool ref) | `0x80000005` — high bit | `0xD7E921B4` — random |
| Dead code op (NullLiteral) | `2` — tiny | `0x6C4938AA` — random |
| Inline junk op | value > `_COUNT` | `0x1F2B3C4D` — random |
| Jump target address | `156` — small | `0x8F4C31A7` — random |
| Reseed block key | `57` — small | `0x5B2E91C4` — random |

All words in the code region become uniformly distributed 32-bit values via the
position-dependent Layer 3 mixer.

---

## Files Changed

### compiler.ts

- Add to `OpCode` enum: `Reseed`, 9 alias entries, `_COUNT` sentinel
- Add `OPCODE_ALIASES` map, `maybeAlias()`, `isLiteralFamily()`
- Add `generateDeadBranch()`, `generateJunkOps()`, `randomFalsyOp()`,
  `generateInvalidOp()`, `injectGarbage()`
- Add `reseedOp()`, `injectReseedTags()`, `expandReseeds()`
- Add `blockTransform()`, `getDerivedKey()`, `applyBlockKeying()` (returns opcode positions)
- Add `opcodeShufflePrng()`, `generateOpcodePermutation()`, `opcodeStreamMask()`
- Add `remapProgramOpcodes()`
- Update `generateData()` to handle Reseed ops and apply aliases
- Update `finalizeLiteralPool()` and `collectUsedOpcodes()` for Literal-family
- Update `compile()` with full encoding pipeline
- Update `DebugInfo` with `usedOpcodes`; `CompileOptions` with optional `shuffleSeed`

### runtime.ts

- Add matching `blockInverseTransform()`, `getDerivedKey()`, `opcodeStreamMask()` (MUST SYNC)
- Add `opcodeShufflePrng()`, `generateOpcodePermutation()` (MUST SYNC)
- Add `OPCODE_SEED_MASK` constant
- Add `inversePermCache` WeakMap and `getInversePerm()`
- Replace `read()` with auto-decrypting version using `blockInverseTransform`
- Add `decodeOp()` combining all decode layers
- Add `case` arms for all alias opcodes (fallthrough to base handler)
- Add `default: break` to dispatch switch
- Modify `step()` to use `decodeOp()` instead of raw `read()` for opcode fetch

### cli.ts

- Use `compileInfo.usedOpcodes` instead of `collectUsedOpcodes()` on encoded data

### strip-runtime-opcodes.ts

- No changes: still matches original case-arm numbers in JS source

---

## Design Notes

### Needle in a Haystack (Inline Garbage)
By injecting values that the runtime treats as 1-word NOPs directly into the real path,
we force an analyzer to guess whether a word is an opcode, an operand, or noise.
Combined with false branches (valid-code), the real logic is deeply obscured.

### Seeded Seed
The `Reseed` opcode and `targetSeed` are themselves encrypted using the current
block's derived key. This ensures the handover itself is opaque.

### Combined cipher vs. separate layers
V1 of this plan used separate Layer 3 (modular addition) and Layer 5 (XOR stream
cipher). V2 merges them into a single `blockTransform` with a derived key that
incorporates both the block seed and position. This is stronger (full 32-bit diffusion
vs. modular addition in a small domain) and simpler (one cipher pass, not two).

### Unknown opcode = 1-word NOP

The `default: break` in the dispatch switch means:

- Any decoded value not matching a known case is silently skipped
- Handles inline junk from Layer 1 during normal execution
- Acts as safety net for any decoding edge cases
- Simplifies extensibility — new opcodes in future won't crash old runtimes

### Opcode position tracking across encoding layers

After Layer 3 (block cipher), the transformed opcode values are full 32-bit numbers
that bear no resemblance to the original enum values. Layer 4 (shuffle) cannot
re-detect instruction boundaries by checking opcode values.

Solution: `applyBlockKeying` returns an array of opcode positions. Layer 4
iterates over these positions directly instead of re-walking.

### Reseed at source, not target

Reseeds are inserted at jump **sources**, not at targets. This is critical
because multiple sources may jump to the same target (e.g. `if/else` arms
converging, loop continues). If a Reseed were at the target, it would need
to know which source is arriving — impossible without modifying control flow.

Instead, each source independently seeds the target's key before jumping:
```
Source A:  [Literal<KeyT>, Reseed, Jump<T>]   // A sets KeyT then jumps
Source B:  [Literal<KeyT>, Reseed, Jump<T>]   // B sets KeyT then jumps
Target T:  [first real op...]                  // already in KeyT context
```

The jump instruction itself is retagged with the target's `seedId` because
it executes after the Reseed (see `injectReseedTags` step 3).

Since ops are tagged with `seedId`, validation only needs to check:
1. Every `seedId` transition in the linear stream has a Reseed before it
2. Every jump source's retagged `seedId` matches its target's `seedId`

### Jump target computation as tamper resistance

Jump target addresses don't have to be plain literals. The compiler can emit
arbitrary arithmetic that derives the offset from runtime obfuscation state —
current block seed, instruction position, values already on the stack, etc.
For example:

```
Literal(currentPos + 3)       // some value derived from compile-time pos
Literal(blockSeedAtEmit ^ X)  // some value derived from the block seed
BXor                          // reconstruct the real offset at runtime
```

This creates deep coupling between the encoding state and control flow:
patching a single word changes the block seed chain, which changes derived
keys, which changes decoded jump addresses — cascading into broken control
flow everywhere downstream. An attacker cannot locally modify the program
without understanding and recomputing the full encoding state.

### Dead code injection rate

The 20% dead-branch and 5% inline-junk injection probabilities are tunable.
Consider making them configurable via `CompileOptions`.

---

## Verification Plan

### Automated tests

- `npm test` — all existing tests pass (obfuscation is semantically transparent)
- `npm run build` — TypeScript compiles without errors
- New test: same source + different seeds -> different program bytes, same result
- New test: fixed `shuffleSeed` -> deterministic output
- New test: assert every jump target position is preceded by a Reseed
- New test: entropy analysis — verify uniform bit distribution across code region
  (no statistically significant deviation from 32 bits/word)

### Manual verification

- `npm run build-example` — inspect output; confirm program data is not
  correlatable with switch-case numeric values
- Hex-dump compiled program — confirm no recognizable low-value opcode clusters
- Attempt manual static disassembly — should require custom tooling that
  replicates the full 4-layer decode pipeline
