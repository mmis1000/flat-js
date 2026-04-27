import { LiteralPoolKind, TEXT_DADA_MASK, compile, InvokeType, OpCode, getProgramMetadataStart, getProtectedProgramCodeLength, isProtectedModeProgram, literalPoolWordMask } from '../compiler'
import { blockInverseTransform, generateOpcodePermutation, getDerivedKey, isLiteralFamily, isProtectedLiteralFamily, OPCODE_SEED_MASK } from '../compiler/encoding'
import {
    getCanonicalOpcodeFamily,
    getOpcodeSafetyClass,
    getOpcodeWordArity,
    getProjectedLiteralOperand,
    getProjectedRuntimeOpcode,
    getProjectedRuntimeOpcodeKeepSet,
} from '../compiler/opcode-families'
import { Fields, getExecution, run } from '../runtime'
import { getProtectedLiteralFromPool, recoverProtectedLiteralSeed } from '../runtime/shared'

type DecodedInstruction = {
    pos: number
    opcode: number
    operands: number[]
    activeSeed: number
}

function decodeProgramInstructions(program: number[], codeLength: number, globalSeed: number): DecodedInstruction[] {
    const perm = generateOpcodePermutation((globalSeed ^ OPCODE_SEED_MASK) >>> 0)
    const inversePerm = new Array(perm.length)
    for (let index = 0; index < perm.length; index++) {
        inversePerm[perm[index]!] = index
    }

    let activeSeed = 0
    let pendingSeed: number | null = null
    let index = 0
    const decoded: DecodedInstruction[] = []

    while (index < codeLength) {
        const decodedWord = blockInverseTransform(
            program[index]! >>> 0,
            getDerivedKey(activeSeed, index, globalSeed)
        ) >>> 0
        const opcode = inversePerm[decodedWord] ?? decodedWord
        const instruction: DecodedInstruction = {
            pos: index,
            opcode,
            operands: [],
            activeSeed,
        }

        if (opcode === OpCode.Reseed) {
            decoded.push(instruction)
            activeSeed = (pendingSeed ?? 0) >>> 0
            pendingSeed = null
            index += 1
            continue
        }

        if (isLiteralFamily(opcode)) {
            const operand = blockInverseTransform(
                program[index + 1]! >>> 0,
                getDerivedKey(activeSeed, index + 1, globalSeed)
            ) | 0
            instruction.operands.push(operand)
            decoded.push(instruction)
            pendingSeed = operand >>> 0
            index += 2
            continue
        }

        if (isProtectedLiteralFamily(opcode)) {
            const poolPos = blockInverseTransform(
                program[index + 1]! >>> 0,
                getDerivedKey(activeSeed, index + 1, globalSeed)
            ) | 0
            const seedDelta = blockInverseTransform(
                program[index + 2]! >>> 0,
                getDerivedKey(activeSeed, index + 2, globalSeed)
            ) | 0
            instruction.operands.push(poolPos, seedDelta)
            decoded.push(instruction)
            pendingSeed = null
            index += 3
            continue
        }

        decoded.push(instruction)
        pendingSeed = null
        index += 1
    }

    return decoded
}

function collectLegacyTailStrings(program: number[]): string[] {
    const codeLength = getProtectedProgramCodeLength(program)
    if (codeLength === null) {
        return []
    }

    const strings: string[] = []
    const metadataStart = getProgramMetadataStart(program)
    let index = codeLength
    while (index + 1 < metadataStart) {
        const kind = (program[index]! ^ literalPoolWordMask(index)) | 0
        const length = (program[index + 1]! ^ literalPoolWordMask(index + 1)) | 0
        if (
            length < 0
            || (
                kind !== LiteralPoolKind.Boolean
                && kind !== LiteralPoolKind.Number
                && kind !== LiteralPoolKind.String
            )
        ) {
            break
        }

        const entryLength = 2 + length
        if (index + entryLength > metadataStart) {
            break
        }

        if (kind === LiteralPoolKind.String) {
            let value = ''
            for (let offset = 0; offset < length; offset++) {
                const word = (program[index + 2 + offset]! ^ literalPoolWordMask(index + 2 + offset)) | 0
                value += String.fromCharCode(word & 0xffff)
            }
            strings.push(value)
        }

        index += entryLength
    }

    return strings
}

test('runtime projection stays deterministic, canonical, and non-privileged across bounded families', () => {
    for (let stackDepth = 0; stackDepth <= 4; stackDepth++) {
        for (let sample = 0; sample < 256; sample++) {
            const decodedWord = Math.imul(sample + 1, 0x9e3779b9) >>> 0
            const salt = Math.imul(sample + 7, 0x85ebca6b) >>> 0
            const projected = getProjectedRuntimeOpcode(decodedWord, salt, stackDepth)

            expect(projected).toBe(getProjectedRuntimeOpcode(decodedWord, salt, stackDepth))
            expect(projected).toBe(getCanonicalOpcodeFamily(projected))
            expect(getOpcodeSafetyClass(projected)).not.toBe('privileged')
            expect([1, 2]).toContain(getOpcodeWordArity(projected))
            if (getOpcodeWordArity(projected) === 2) {
                expect(projected).toBe(OpCode.Literal)
            }
        }
    }
})

test('runtime projection uses a corpus-shaped multi-family mix instead of a nop-only fallback', () => {
    const counts = new Map<number, number>()

    for (let sample = 0; sample < 4096; sample++) {
        const decodedWord = Math.imul(sample + 11, 0x45d9f3b) >>> 0
        const salt = Math.imul(sample + 17, 0x27d4eb2d) >>> 0
        const projected = getProjectedRuntimeOpcode(decodedWord, salt, 3)
        counts.set(projected, (counts.get(projected) ?? 0) + 1)
    }

    const rows = [...counts.entries()].sort((left, right) => right[1] - left[1])
    const top = rows[0]!
    const hotOrWarmCoverage = rows
        .filter(([opcode]) => {
            const safety = getOpcodeSafetyClass(opcode)
            return safety === 'hot' || safety === 'warm'
        })
        .reduce((sum, [, count]) => sum + count, 0) / 4096

    expect(rows.length).toBeGreaterThan(10)
    expect(top[0]).not.toBe(OpCode.Nop)
    expect(top[1] / 4096).toBeLessThan(0.25)
    expect(hotOrWarmCoverage).toBeGreaterThan(0.6)
})

test('projected literal operands stay deterministic and map to valid small ints only', () => {
    for (let sample = 0; sample < 256; sample++) {
        const decodedOpcodeWord = Math.imul(sample + 3, 0x7feb352d) >>> 0
        const salt = Math.imul(sample + 13, 0x846ca68b) >>> 0
        const decodedOperandWord = Math.imul(sample + 29, 0x45d9f3b) >>> 0
        const operand = getProjectedLiteralOperand(decodedOpcodeWord, salt, decodedOperandWord, sample)

        expect(operand).toBe(getProjectedLiteralOperand(decodedOpcodeWord, salt, decodedOperandWord, sample))
        expect(operand).toBeGreaterThanOrEqual(0)
        expect(operand).toBeLessThan(TEXT_DADA_MASK)
    }
})

test('compile info exposes the projected opcode keep-set for stripped runtimes', () => {
    const [program, info] = compile('const msg = "ok"; msg', { evalMode: true, protectedMode: true })
    expect(info.projectedOpcodes).toEqual([...getProjectedRuntimeOpcodeKeepSet()])
    expect(info.projectedOpcodes).toContain(OpCode.Literal)
    expect(info.projectedOpcodes.some((opcode) => getOpcodeWordArity(opcode) === 2)).toBe(true)
    expect(info.protectedMode).toBe(true)
    expect(isProtectedModeProgram(program)).toBe(true)
    expect(getProtectedProgramCodeLength(program)).toBe(info.codeLength)
})

test('protected builds still execute correctly on the real path with inline noise', () => {
    const [program] = compile(`
        const labels = ['alpha', 'beta', 'gamma']
        let total = 0
        for (let i = 0; i < 2; i++) {
            total = total + i
        }

        function pick(index) {
            return labels[index + 1]
        }

        pick(total)
    `, { evalMode: true, shuffleSeed: 1, protectedMode: true })

    expect(run(program, 0, globalThis, [], undefined, [], compile)).toBe('gamma')
})

test('protected conditional branches do not jump into a linear reseed shim', () => {
    const [program] = compile('false ? 1 : 2', { evalMode: true, shuffleSeed: 1, protectedMode: true })

    const projected: number[] = []
    const execution = getExecution(
        program,
        0,
        globalThis,
        [],
        {
            [Fields.type]: InvokeType.Apply,
            [Fields.function]: undefined,
            [Fields.name]: '',
            [Fields.self]: undefined,
        },
        [],
        undefined,
        compile,
        new WeakMap(),
        (ptr, _opcode, _blockSeed, isProjected) => {
            if (isProjected) {
                projected.push(ptr)
            }
        }
    )

    let result
    do {
        result = execution[Fields.step]()
    } while (!result[Fields.done])

    expect((result as any)[Fields.evalResult]).toBe(2)
    expect(projected).toEqual([])
})

test('protected pooled literals stay deduped and are not recoverable via the legacy tail walk', () => {
    const [program, info] = compile(`
        const values = ['alpha', 'alpha', 'beta']
        values.join(',')
    `, { evalMode: true, shuffleSeed: 1, protectedMode: true })

    const decoded = decodeProgramInstructions(program, info.codeLength, info.globalSeed)
    const stringRefs = decoded
        .filter((instruction) => getCanonicalOpcodeFamily(instruction.opcode) === OpCode.ProtectedLiteral)
        .map((instruction) => {
            const poolPos = instruction.operands[0]! ^ TEXT_DADA_MASK
            const literalSeed = recoverProtectedLiteralSeed(
                instruction.operands[1]! >>> 0,
                instruction.activeSeed,
                instruction.pos + 2,
                info.globalSeed,
            )
            return {
                poolPos,
                value: getProtectedLiteralFromPool(program, poolPos, literalSeed),
            }
        })
        .filter((entry): entry is { poolPos: number, value: string } => typeof entry.value === 'string')

    const alphaRefs = stringRefs.filter((entry) => entry.value === 'alpha')
    const betaRefs = stringRefs.filter((entry) => entry.value === 'beta')
    const trackedRefs = stringRefs.filter((entry) => entry.value === 'alpha' || entry.value === 'beta')
    expect(alphaRefs.length).toBeGreaterThanOrEqual(2)
    expect(betaRefs.length).toBeGreaterThanOrEqual(1)
    expect(new Set(alphaRefs.map((entry) => entry.poolPos)).size).toBe(1)
    expect(new Set(trackedRefs.map((entry) => entry.poolPos)).size).toBe(2)

    const legacyStrings = collectLegacyTailStrings(program)
    expect(legacyStrings).not.toContain('alpha')
    expect(legacyStrings).not.toContain('beta')
})

test('corrupting a protected literal seed delta fails protected literal validation', () => {
    const [program, info] = compile(`
        const values = ['alpha', 'alpha', 'beta']
        values[0]
    `, { evalMode: true, shuffleSeed: 1, protectedMode: true })

    const decoded = decodeProgramInstructions(program, info.codeLength, info.globalSeed)
    const firstProtectedLiteral = decoded.find((instruction) => getCanonicalOpcodeFamily(instruction.opcode) === OpCode.ProtectedLiteral)
    expect(firstProtectedLiteral).toBeDefined()

    const corrupted = [...program]
    corrupted[firstProtectedLiteral!.pos + 2] = (corrupted[firstProtectedLiteral!.pos + 2]! ^ 0x13579bdf) | 0

    expect(() => run(corrupted, 0, globalThis, [], undefined, [], compile)).toThrow('bad protected literal entry')
})

test('corrupted protected seed execution does not collapse into observed nop-only tracing', () => {
    const [program] = compile(`
        const labels = ['zero', 'one', 'two', 'three']
        let total = 0
        total = total + 1
        total = total + 2
        total = total + 3
        labels[total - 3]
    `, { evalMode: true, shuffleSeed: 1, protectedMode: true })

    const corrupted = [...program]
    corrupted[corrupted.length - 3] = (corrupted[corrupted.length - 3]! ^ 0x13579bdf) | 0

    const observed: number[] = []
    let projectedCount = 0
    let thrown: unknown
    const execution = getExecution(
        corrupted,
        0,
        globalThis,
        [],
        {
            [Fields.type]: InvokeType.Apply,
            [Fields.function]: undefined,
            [Fields.name]: '',
            [Fields.self]: undefined,
        },
        [],
        undefined,
        compile,
        new WeakMap(),
        (_ptr, opcode, _blockSeed, projected) => {
            observed.push(opcode)
            if (projected) {
                projectedCount++
            }
        }
    )

    try {
        for (let stepIndex = 0; stepIndex < 48; stepIndex++) {
            const result = execution[Fields.step]()
            if (result[Fields.done]) {
                break
            }
        }
    } catch (error) {
        thrown = error
    }

    expect(observed.length).toBeGreaterThan(0)
    expect(projectedCount).toBeGreaterThan(0)
    expect(observed.some((opcode) => opcode !== OpCode.Nop)).toBe(true)
    if (thrown instanceof Error) {
        expect(thrown.message).not.toBe('bad literal pool entry')
    }
})
