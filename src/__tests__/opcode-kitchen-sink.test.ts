import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'

import { collectUsedOpcodes, compile, OpCode } from '../compiler'

const FIXTURE_PATH = path.join(__dirname, 'fixures', 'opcode-kitchen-sink.js')
const SHARED_PATH = path.join(__dirname, '..', 'compiler', 'shared.ts')

function getOpcodeNames(): string[] {
    const shared = fs.readFileSync(SHARED_PATH, 'utf8')
    const sourceFile = ts.createSourceFile(SHARED_PATH, shared, ts.ScriptTarget.Latest, true)
    const opCodeEnum = sourceFile.statements.find(
        (statement): statement is ts.EnumDeclaration => ts.isEnumDeclaration(statement) && statement.name.text === 'OpCode'
    )

    if (!opCodeEnum) {
        throw new Error('OpCode enum not found in compiler/shared.ts')
    }

    return opCodeEnum.members.map((member) => {
        if (!ts.isIdentifier(member.name)) {
            throw new Error('Unexpected non-identifier OpCode member name')
        }

        return member.name.text
    })
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
        // Direct eval call sites now pre-read callees for spec evaluation order,
        // so the resolved eval-call opcode is the emitted coverage target.
        OpCode.CallAsEval,
    ])

    const missing = getOpcodeNames()
        .map((name, value) => ({ name, value }))
        .filter(({ value }) => !used.has(value) && !allowMissing.has(value))

    expect(missing).toEqual([])

    expect(used.has(OpCode.SetEvalResult)).toBe(true)
    expect(used.has(OpCode.CallAsEvalResolved)).toBe(true)
    expect(used.has(OpCode.CreateClass)).toBe(true)
    expect(used.has(OpCode.YieldStar)).toBe(true)
    expect(used.has(OpCode.Await)).toBe(true)
    expect(used.has(OpCode.SuperCall)).toBe(true)
    expect(used.has(OpCode.ArraySpread)).toBe(true)
    expect(used.has(OpCode.ExpandArgumentArray)).toBe(true)
    expect(used.has(OpCode.TemplateObject)).toBe(true)
    expect(used.has(OpCode.BreakInTryCatchFinally)).toBe(true)
    expect(used.has(OpCode.TypeofStaticReference)).toBe(true)
    expect(used.has(OpCode.TypeofStaticReferenceUnchecked)).toBe(true)
})
