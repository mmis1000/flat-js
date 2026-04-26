# `feat/encryption` — Obfuscation and Anti-Analysis Plan

## Scope

This note is **for the `feat/encryption` branch**, not for `master` runtime behavior.
It captures follow-up design direction from the recent obfuscation discussion and is
meant to complement the branch's existing opcode-obfuscation work.

## Primary Goal

The branch should optimize for this property:

- **Correct and incorrect attacker edits should be hard to distinguish.**

In practice, that means avoiding local repair oracles where an attacker can patch one
step, run once, and learn immediately whether that exact patch was correct.

## Core Conclusions

### 1. Keep jump targets non-local in emitted bytecode

The current stack shape is good for obfuscation:

- push / derive jump target first
- produce the condition later
- let `Jump` / `JumpIf` / `JumpIfNot` consume both

This keeps the target away from the jump site in the emitted program, which makes CFG
recovery require stack and value-flow analysis instead of local byte scanning.

This is also a good foundation for a future "virtual `NodeOffset`" that expands into a
longer math sequence instead of lowering directly to a plain literal.

### 2. Keep explicit branch-edge metadata in compiler IR

What is good for emitted bytecode is not automatically good for late compiler passes.
For the `feat/encryption` branch, we should preserve the semantic branch edge in IR even
when the emitted bytecode hides it.

Current branch machinery such as `jumpConsumerRef` is the right direction:

- compiler IR knows which jump consumes a given offset producer
- emitted bytecode can still make the target look far away and computation-like

The desired combination is:

- **explicit control-flow metadata in compiler IR**
- **non-local / obfuscated target computation in emitted bytecode**

### 3. Use computed targets and reseeds, not plain literals

Jump targets and reseed values should not stay as obvious `Literal(...)` words if we
want stronger anti-analysis properties.

Prefer computed reconstruction that can depend on:

- immutable program-buffer data
- current instruction position
- current block seed
- per-build global seed

This is stronger than plain constant arithmetic because it couples control flow and
decode state. A partial emulator or local byte patch becomes much easier to break.

Avoid using brittle host-derived sources such as `function.toString()` for correctness-
critical control flow. Those are usually too environment-sensitive to be a reliable
foundation.

### 4. Preserve dev-time validation, but avoid production repair oracles

For development, strong validation is still useful:

- jump target is inside the code region
- target lands on a legal instruction boundary
- reseed / decode transitions are structurally valid

For protected builds, the goal is different. A crisp runtime error like "bad target" or
an explicit production `tainted` mode gives the attacker a repair oracle.

Preferred direction:

- **dev builds:** validate loudly and precisely
- **protected builds:** avoid local, specific failure signals

Protected builds should fail through ordinary poisoned decode / seed / control-flow
state instead of switching into an obviously separate "bad mode."

### 5. The current wrong-seed behavior is too recognizable

A major weakness in the current `feat/encryption` design is that a wrong seed is likely
to decode into values outside the real opcode domain, and the runtime currently treats
those as 1-word NOPs.

That creates a recognizable failure signature:

- wrong seed
- many unknown opcodes
- many silent 1-word skips
- very little plausible instruction structure

This makes incorrect decode state too easy to identify, which weakens the branch's
anti-analysis goal.

### 6. Do not solve that weakness with low-bit-only opcode decoding

Decoding opcode identity from only the last few bits is probably the wrong fix.

Problems with that approach:

- it throws away too much entropy
- it weakens full-width opacity from the 32-bit word
- it makes collisions much easier
- it can help attackers recover plausible structure without fully recovering seed state

The better direction is:

- keep full-width keyed decode
- use all bits in the decode path
- project the decoded result into plausible opcode families more densely than the
  current sparse-domain-plus-NOP behavior

That should make wrong seeds look less obviously wrong without giving up 32-bit mixing.

This can still allow many 32-bit representatives for the same logical opcode family.
For example, the goal is closer to:

- many different full-width words can decode to the same logical family
- a wrong seed can still land on something that looks instruction-like
- but attackers should not be able to recover that family with a trivial mask such as
  `word & 0xff`

### 7. Combine dense opcode families with junk injection

Dense opcode-family projection becomes much stronger when combined with junk injection.

If the branch only adds more valid-looking opcode representatives, an attacker may still
use "did this decode into something instruction-like?" as a local signal. That becomes
far less useful when the real stream already expects noise.

The desired effect is:

- extra decoded ops may be real
- extra decoded ops may be junk
- missing decoded ops may be bad reconstruction
- missing decoded ops may just be noise filtering

In that design, "this word did or did not become an opcode" stops being a meaningful
correctness oracle. The attacker has to reason about longer-range semantics such as:

- stack coherence
- branch consistency
- reseed consistency
- end-to-end behavioral traces

That does not make correct and incorrect decoding literally impossible to distinguish.
It does make local syntax and patch-and-run feedback much less trustworthy, which is the
actual goal for `feat/encryption`.

### 8. Literal operands can also become a repair oracle

Opcode identity is not the only local signal. Literal operands can leak correctness too.

If a wrong seed or wrong reconstruction produces operands that are obviously implausible,
the attacker gets another local oracle even when opcode decoding itself is ambiguous.
Examples include:

- impossible or out-of-range literal-pool references
- obviously broken jump offsets
- reseed values that immediately collapse decode state
- operand distributions that look unlike normal program data

So the protection goal should be extended:

- not only should wrong opcode decode look plausible
- wrong operand decode should also look plausible for the consuming opcode family

The desired direction is to make operand decoding more **consumer-shaped**:

- a wrong decoded operand for a literal-like opcode should still often look like a
  plausible literal payload
- a wrong decoded operand for a pool-referencing instruction should still often land in
  a plausible pool domain
- a wrong decoded operand for control flow should avoid creating an immediate,
  perfectly-local correctness signal

Ways to move in that direction:

- keep operand reconstruction full-width and keyed, not simple masked extraction
- allow many encodings for the same logical operand value
- use extra indirection or permutation for literal-pool references
- couple operand interpretation to opcode family, position, and current seed
- prefer failure that becomes semantically wrong later over obviously malformed
  structure immediately

This has the same caveat as opcode ambiguity: it should reduce cheap local oracles, not
accidentally make incorrect execution stable or self-healing.

## Proposed Direction for `feat/encryption`

### Near-term

1. Keep the current non-local jump-target model.
2. Keep and extend explicit branch metadata such as `jumpConsumerRef`.
3. Preserve `NodeOffset` as a compiler hook that can later lower to opaque target math.
4. Continue separating dev-time structural validation from protected-build failure
   behavior.

### Mid-term

1. Replace obvious `Literal(target)` / `Literal(seed)` forms with computed sequences.
2. Couple those sequences to immutable program bytes, position, and current seed.
3. Ensure the design avoids circular dependencies during decoding and jumping.
4. Redesign wrong-seed behavior so it does not collapse into an obvious NOP storm.
5. Explore dense full-width opcode families that preserve ambiguity without reducing
   opcode identity to a low-bit slice.
6. Shape junk injection and opcode-family density together so instruction presence alone
   is not a useful local correctness signal.
7. Reduce literal-operand repair oracles so wrong operands still look plausible for the
   opcode family that consumes them.

### Long-term

1. Treat control-flow edges and seed handoff as first-class compiler metadata until the
   final lowering pass.
2. Make static analysis require recovering:
   - control flow
   - stack/value flow
   - seed state
   - buffer-coupled reconstruction state
3. Make dynamic analysis require faithful execution rather than light byte patching or
   partial emulation.

## Guardrails

- Do not let protection features depend on unstable host quirks.
- Do not introduce a production mechanism that clearly signals "this exact patch was
  wrong."
- Do not weaken the branch by collapsing opcode identity to a tiny bit slice.
- Do not let "decoded into a valid-looking opcode" become a strong oracle by itself.
- Do not let obviously malformed literal operands become a separate local oracle.
- Do not give up compiler-side metadata just because emitted bytecode should look
  non-local and opaque.

## Open Design Questions

- How dense should opcode-family projection be when a decoded word is not a direct base
  opcode?
- How should opcode-family density interact with junk injection so neither becomes a
  standalone correctness oracle?
- How should literal operands be mapped so wrong reconstruction still looks plausible
  without making the VM too forgiving?
- Which opcode families should remain rare or specially gated, especially `Reseed` and
  `Literal`-family instructions?
- How much target / seed reconstruction should depend on program-buffer hashing versus
  cheaper local mixing?
- What protected-build failure shape gives the least useful feedback without making the
  branch impossible to debug during development?

## Success Criteria

The `feat/encryption` branch is moving in the right direction if:

- jump targets are hard to recover from local byte adjacency
- compiler passes still know exact branch edges through IR metadata
- wrong seed state does not produce a trivially recognizable NOP-heavy signature
- local instruction presence or absence is not a reliable correctness signal
- local literal operands do not provide an obvious "correct vs incorrect" signal
- local attacker edits do not yield a clean "correct vs incorrect" oracle
- the system remains deterministic and debuggable in dev builds
