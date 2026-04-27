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

### 7.1 Shape both layers to a corpus prior, not a flat prior

The interaction between family density and junk should be calibrated against real
compiled programs, not against a uniform synthetic target.

The current `src/__tests__/fixures/jquery.js` fixture is a useful baseline for that.
Its pre-obfuscation emitted stream is heavily skewed rather than flat. A compile-time
histogram on that fixture shows roughly:

- `Literal` at about 58%
- `GetStaticUnchecked` at about 10.5%
- `Pop` at about 4.9%
- `Get` at about 4.2%
- `Call`, `Jump`, `JumpIfNot`, `Return`, `GetRecord`, and `Set*` make up most of the
  next tier
- the top 12 opcodes account for about 90% of the stream
- 18 opcodes occur 5 times or fewer

That suggests a concrete rule:

- dense projection should be **weighted toward hot families** that already dominate real
  code
- inline junk should perturb those same hot families within a bounded range, not create
  a separate flat-looking distribution
- dead-branch junk can sample a wider cold-family set because it only has to remain
  structurally plausible, not dominate executed local windows
- rare or privileged families such as `Reseed`, function-entry setup, and
  try/finally-control opcodes should stay specially gated and should almost never appear
  from generic wrong-seed projection

A practical interaction model is:

- maintain a per-family prior derived from real fixtures such as `jquery.js`
- project wrong-seed decode into families by weighted sampling from that prior, with
  local modulation by position and consumer shape
- spend junk budget as a bounded delta from that same prior instead of as an
  independent random channel
- validate plausibility over short windows, not only whole-program totals, so an
  attacker cannot use a local histogram spike as a repair oracle

In short:

- opcode-family density should explain why wrong decode still looks like code
- junk injection should explain why even correct decode contains local noise
- both layers should share the same corpus-shaped prior so neither becomes a standalone
  correctness oracle

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
6. Weight those families by real-program priors instead of a flat family mapping.
7. Calibrate junk injection against the same priors, using `src/__tests__/fixures/jquery.js`
   as an initial baseline for hot-family skew and long-tail rarity.
8. Keep rare or privileged families specially gated so generic wrong-seed decode mostly
   lands in hot or warm families, not control-sensitive ones.
9. Reduce literal-operand repair oracles so wrong operands still look plausible for the
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

## Application Plan

The previous sections describe the target behavior. This section describes how to apply
it to the current codebase without breaking correct execution on the way there.

### Phase 0: Lock a measurement baseline first

Before changing runtime semantics, add a small measurement helper that can inspect the
pre-garbage / pre-encoding opcode stream and produce:

- whole-program opcode histograms
- opcode-family histograms
- short-window histograms such as 32-op and 64-op sliding windows
- 1-word vs 2-word family ratios

Initial fixture set:

- `src/__tests__/fixures/jquery.js` as the hot-path prior baseline
- `src/__tests__/fixures/loader.js` as a smaller realistic sample
- `src/__tests__/fixures/bad-code.js` as a small control sample
- `src/__tests__/fixures/opcode-kitchen-sink.js` as the coverage ceiling, not the
  weighting baseline

Implementation touch points:

- add the measurement helper under `src/__tests__` or `scripts`
- keep the first checked-in prior intentionally simple and derived mainly from
  `jquery.js`, then cross-check it against the other fixtures

### Phase 1: Make opcode families explicit

The current code knows individual opcodes and a small alias map, but not a first-class
family model. Add one shared definition that classifies:

- opcode -> family
- family -> allowed concrete opcodes / aliases
- family -> arity class such as 1-word vs 2-word
- family -> safety class such as hot, warm, cold, or privileged

Privileged families should initially include at least:

- `Reseed`
- function-entry / function-definition setup
- try/catch/finally control flow
- any other family whose accidental execution gives a strong local oracle

Implementation touch points:

- add the family table near `src/compiler/encoding.ts` and `src/runtime/execution.ts`,
  ideally in a shared module instead of duplicating ad hoc lists
- extend existing alias handling so dense projection chooses among families first and
  concrete representatives second

### Phase 2: Rewrite inline junk before changing runtime fallback

This is the most important sequencing constraint.

Right now, inline junk in `src/compiler/encoding.ts` is safe only because the runtime
default case in `src/runtime/execution.ts` treats unknown opcodes as 1-word NOPs. Once
wrong-seed decode stops collapsing to "unknown -> skip 1 word", that junk format is no
longer safe for correct execution.

So the first code change should be:

- stop depending on out-of-domain runtime fallback for executed inline junk

Split junk into two classes:

- **inline executed noise**
  Must remain safe on the real execution path under the correct seed. The initial
  version should only project to safe 1-word families.
- **dead-branch noise**
  Can use a wider family set, including rarer or operand-bearing families, because it is
  never executed on the correct path.

Practical rule for the first landing:

- keep inline noise intentionally conservative
- if `Nop` alone is too distinctive, add extra `Nop`-equivalent aliases instead of
  borrowing side-effecting families
- allow broader fake structure in dead branches, not in executed inline noise

Implementation touch points:

- replace `generateInvalidOp()` / executed-path usage in `src/compiler/encoding.ts`
- keep the existing branch-target and transparent-label exclusions

### Phase 3: Replace runtime "unknown opcode = NOP" with dense family projection

After inline junk is safe on its own, change runtime decode behavior.

The runtime should separate:

- exact in-domain decode
- projected decode for non-direct words

The projection should remain:

- full-width
- deterministic from the decoded 32-bit word plus position / seed state
- weighted by the corpus prior rather than flat over all families

The first runtime version should bias strongly toward hot 1-word families and should
explicitly gate privileged families out of generic projection.

Important nuance:

- projecting to 2-word families changes alignment and operand consumption

That is acceptable for wrong-seed or attacker-misdecoded execution, but not for the
compiler's intentional inline noise on the correct path. That is why Phase 2 must land
before this phase.

Implementation touch points:

- factor the decode logic in `src/runtime/execution.ts`
- replace the current outer `default:` behavior with family projection
- keep dev-time instrumentation that can report whether an executed opcode was exact or
  projected, without making production behavior itself more oracle-like

### Phase 4: Keep stripped runtimes compatible with projected families

The runtime-strip path is another hidden dependency.

Today, `src/cli.ts` and `src/strip-runtime-opcodes.ts` keep only handlers for
`compileInfo.usedOpcodes`. That works when unknown opcodes fall through to a NOP-like
default. It is no longer enough once the runtime may project a non-direct word into a
family whose handler was stripped out.

So the implementation must also add a keepalive set for projected families.

Preferred direction:

- extend compile/debug info with a projection keep-set, not just exact used opcodes
- make `stripRuntimeCommandSwitch()` preserve every opcode family that generic
  projection may emit in protected builds
- keep privileged families out of that set unless they are actually emitted by the real
  program

Implementation touch points:

- `src/compiler/compile.ts`
- `src/cli.ts`
- `src/strip-runtime-opcodes.ts`

### Phase 5: Add consumer-shaped operand projection

Once opcode-family projection is in place, operand plausibility becomes the next local
oracle to remove.

Recommended sequencing:

1. Start with 1-word projected families.
2. Add 2-word literal-like families only after operand shaping exists.
3. Leave `Reseed` and other control-sensitive families specially gated until both opcode
   and operand projection have been validated together.

Implementation touch points:

- operand decoding helpers in `src/runtime`
- literal-pool / literal decoding paths
- any future target / seed reconstruction helpers

### Phase 6: Validate, tune, and only then widen

Add tests and diagnostics for three separate properties:

- correct execution still matches the current branch on the normal test suite
- wrong-seed execution no longer produces a trivially recognizable NOP-heavy trace
- local windows stay inside plausible corpus-shaped bounds even after junk injection

Concrete checks worth adding:

- compile-time histogram tests against the fixture corpus
- a runtime trace test that compares wrong-seed execution before vs after the change
- a strip-runtime test proving the projected-family keep-set preserves needed handlers
- a correctness test for executed inline noise on the real path

Suggested landing order:

1. measurement helper + checked-in prior
2. family table + privileged-family gates
3. inline-junk rewrite
4. runtime projection behind a protected-build flag
5. strip-runtime keepalive changes
6. operand shaping
7. tuning of hot/warm/cold weights and window thresholds

## Implementation Status

The current branch now has an end-to-end first implementation of that landing order:

- Phase 0 landed with fixture-backed prior tests under `src/__tests__/opcode-family-prior.test.ts`,
  including whole-program histograms, 32-op / 64-op window summaries, and 1-word vs
  2-word ratios derived from `jquery.js`, `loader.js`, `bad-code.js`, and
  `opcode-kitchen-sink.js`.
- Phase 1 landed in `src/compiler/opcode-families.ts`, which now owns alias collapse,
  family membership, arity, safety classes, privileged-family gates, and the shared
  projection keep-set.
- Phase 2 landed in `src/compiler/encoding.ts` by making executed inline junk safe
  without depending on "unknown opcode = skip 1 word" runtime behavior.
- Phase 3 landed in `src/runtime/execution.ts` behind protected-build metadata, with
  exact vs projected decode split and a dev-time instruction hook that can report
  whether an opcode was projected.
- Phase 4 landed through `src/compiler/compile.ts`, `src/cli.ts`, and
  `src/strip-runtime-opcodes.ts`, so stripped runtimes keep handlers for every family
  the protected runtime may project.
- Phase 5 landed by adding protected-build code-length metadata plus consumer-shaped
  `Literal` projection that maps wrong-seed operands into plausible inline integers or
  real literal-pool entries instead of malformed local garbage.
- Phase 6 landed with protected-mode correctness tests, wrong-seed trace tests, strip
  compatibility checks, the normal Jest suite, `npm run build:tsc`, and
  `npm run build`.

## Guardrails

- Do not let protection features depend on unstable host quirks.
- Do not introduce a production mechanism that clearly signals "this exact patch was
  wrong."
- Do not weaken the branch by collapsing opcode identity to a tiny bit slice.
- Do not let "decoded into a valid-looking opcode" become a strong oracle by itself.
- Do not let junk injection create a flat or otherwise obviously synthetic local opcode
  distribution.
- Do not let obviously malformed literal operands become a separate local oracle.
- Do not give up compiler-side metadata just because emitted bytecode should look
  non-local and opaque.

## Open Design Questions

- How dense should opcode-family projection be when a decoded word is not a direct base
  opcode?
- How should literal operands be mapped so wrong reconstruction still looks plausible
  without making the VM too forgiving?
- Which opcode families should remain rare or specially gated, especially `Reseed` and
  `Literal`-family instructions?
- Which fixture set and local-window size should define the corpus prior used for family
  weighting and junk-budget validation?
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
- local opcode histograms stay within plausible corpus-shaped bounds even with junk
  injection
- local literal operands do not provide an obvious "correct vs incorrect" signal
- local attacker edits do not yield a clean "correct vs incorrect" oracle
- the system remains deterministic and debuggable in dev builds
