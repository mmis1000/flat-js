import * as fs from 'fs'
import * as path from 'path'

import { collectUsedOpcodes, compile, OpCode } from '../compiler'

const FIXTURE_PATH = path.join(__dirname, 'fixures', 'opcode-kitchen-sink.js')
const SHARED_PATH = path.join(__dirname, '..', 'compiler', 'shared.ts')

function getOpcodeNames(): string[] {
    const shared = fs.readFileSync(SHARED_PATH, 'utf8')
    const match = shared.match(/export const enum OpCode \{([\s\S]*?)\n\}/m)
    if (!match) {
        throw new Error('OpCode enum not found in compiler/shared.ts')
    }
    return match[1]
        .split('\n')
        .map(line => line.replace(/\/\/.*$/, '').trim())
        .filter(Boolean)
        .map(line => line.replace(/,$/, '').trim())
        .filter(Boolean)
}

test('opcode kitchen sink fixture keeps broad opcode coverage', () => {
    const source = fs.readFileSync(FIXTURE_PATH, 'utf8')

    const collect = (evalMode: boolean) => {
        const [program, info] = compile(source, { evalMode })
        return new Set(collectUsedOpcodes(program, info.codeLength))
    }

    const used = new Set<number>([
        ...collect(false),
        ...collect(true),
    ])

    const allowMissing = new Set<number>([
        OpCode.Nop,
        OpCode.NodeOffset,
        OpCode.NodeFunctionType,
        OpCode.ThrowReferenceError,
    ])

    const missing = getOpcodeNames()
        .map((name, value) => ({ name, value }))
        .filter(({ value }) => !used.has(value) && !allowMissing.has(value))

    expect(missing).toEqual([])

    expect(used.has(OpCode.SetEvalResult)).toBe(true)
    expect(used.has(OpCode.CallAsEval)).toBe(true)
    expect(used.has(OpCode.CreateClass)).toBe(true)
    expect(used.has(OpCode.YieldStar)).toBe(true)
    expect(used.has(OpCode.Await)).toBe(true)
    expect(used.has(OpCode.SuperCall)).toBe(true)
    expect(used.has(OpCode.ArraySpread)).toBe(true)
    expect(used.has(OpCode.BreakInTryCatchFinally)).toBe(true)
    expect(used.has(OpCode.TypeofStaticReference)).toBe(true)
    expect(used.has(OpCode.TypeofStaticReferenceUnchecked)).toBe(true)
})
