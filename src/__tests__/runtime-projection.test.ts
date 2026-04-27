import { TEXT_DADA_MASK, compile, InvokeType, OpCode, getProtectedProgramCodeLength, isProtectedModeProgram } from '../compiler'
import {
    getCanonicalOpcodeFamily,
    getOpcodeSafetyClass,
    getOpcodeWordArity,
    getProjectedLiteralOperand,
    getProjectedRuntimeOpcode,
    getProjectedRuntimeOpcodeKeepSet,
} from '../compiler/opcode-families'
import { Fields, getExecution, run } from '../runtime'

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

test('projected literal operands stay deterministic and map to valid small ints or pool positions', () => {
    const literalPoolPositions = [96, 140, 288]

    for (let sample = 0; sample < 256; sample++) {
        const decodedOpcodeWord = Math.imul(sample + 3, 0x7feb352d) >>> 0
        const salt = Math.imul(sample + 13, 0x846ca68b) >>> 0
        const decodedOperandWord = Math.imul(sample + 29, 0x45d9f3b) >>> 0
        const operand = getProjectedLiteralOperand(decodedOpcodeWord, salt, decodedOperandWord, sample, literalPoolPositions)

        expect(operand).toBe(getProjectedLiteralOperand(decodedOpcodeWord, salt, decodedOperandWord, sample, literalPoolPositions))
        if ((operand & TEXT_DADA_MASK) !== 0) {
            expect(literalPoolPositions).toContain((operand ^ TEXT_DADA_MASK) >>> 0)
        } else {
            expect(operand).toBeGreaterThanOrEqual(0)
            expect(operand).toBeLessThan(TEXT_DADA_MASK)
        }
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
