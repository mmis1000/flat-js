import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'

import {
    collectEvalTaintedFunctions,
    linkScopes,
    markParent,
    resolveScopes,
    searchFunctionAndScope,
    type Functions,
    type ParentMap,
    type ScopeChild,
    type Scopes,
} from '../compiler/analysis'
import { generateSegment } from '../compiler/codegen'
import { genOffset, generateData, isLiteralFamily } from '../compiler/encoding'
import { HOT_OPCODE_FAMILIES, getCanonicalOpcodeFamily, getOpcodeFamilyMembers, getOpcodeSafetyClass, getOpcodeWordArity, getProjectedRuntimeOpcodeKeepSet, isPrivilegedOpcodeFamily } from '../compiler/opcode-families'
import { OpCode } from '../compiler/shared'

const FIXTURES_DIR = path.join(__dirname, 'fixures')
const SHARED_PATH = path.join(__dirname, '..', 'compiler', 'shared.ts')
const HOT_FAMILY_SET = new Set<number>(HOT_OPCODE_FAMILIES)

type HistogramRow = {
    family: number
    name: string
    count: number
    pct: number
}

type WindowSummary = {
    windowSize: number
    samples: number
    dominantShareMedian: number
    dominantShareMax: number
    hotCoverageMedian: number
}

type FixtureHistogram = {
    totalOps: number
    uniqueFamilies: number
    top12Coverage: number
    hotCoverage: number
    tailCountLeq5: number
    oneWordRatio: number
    twoWordRatio: number
    window32: WindowSummary
    window64: WindowSummary
    rows: HistogramRow[]
}

const fixtureHistogramCache = new Map<string, FixtureHistogram>()

function getOpcodeNames(): string[] {
    const shared = fs.readFileSync(SHARED_PATH, 'utf8')
    const sourceFile = ts.createSourceFile(SHARED_PATH, shared, ts.ScriptTarget.Latest, true)
    const opCodeEnum = sourceFile.statements.find(
        (statement): statement is ts.EnumDeclaration => ts.isEnumDeclaration(statement) && statement.name.text === 'OpCode'
    )

    if (!opCodeEnum) {
        throw new Error('OpCode enum not found in compiler/shared.ts')
    }

    return opCodeEnum.members
        .map((member) => {
            if (!ts.isIdentifier(member.name)) {
                throw new Error('Unexpected non-identifier OpCode member name')
            }

            return member.name.text
        })
        .filter((name) => name !== '_COUNT')
}

const OPCODE_NAMES = getOpcodeNames()

function median(values: number[]): number {
    if (values.length === 0) {
        return 0
    }

    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.floor(sorted.length / 2)]!
}

function summarizeSlidingWindows(sequence: readonly number[], windowSize: number): WindowSummary {
    if (sequence.length < windowSize) {
        return {
            windowSize,
            samples: 0,
            dominantShareMedian: 0,
            dominantShareMax: 0,
            hotCoverageMedian: 0,
        }
    }

    const dominantShares: number[] = []
    const hotCoverageShares: number[] = []

    for (let start = 0; start <= sequence.length - windowSize; start++) {
        const counts = new Map<number, number>()
        let hotCount = 0
        let topCount = 0

        for (let offset = 0; offset < windowSize; offset++) {
            const family = sequence[start + offset]!
            const nextCount = (counts.get(family) ?? 0) + 1
            counts.set(family, nextCount)
            topCount = Math.max(topCount, nextCount)
            if (HOT_FAMILY_SET.has(family)) {
                hotCount++
            }
        }

        dominantShares.push(topCount / windowSize)
        hotCoverageShares.push(hotCount / windowSize)
    }

    return {
        windowSize,
        samples: dominantShares.length,
        dominantShareMedian: median(dominantShares),
        dominantShareMax: Math.max(...dominantShares),
        hotCoverageMedian: median(hotCoverageShares),
    }
}

function collectPreObfuscationProgramData(source: string, evalMode: boolean): number[] {
    const parentMap: ParentMap = new Map()
    const scopes: Scopes = new Map()
    const functions: Functions = new Set()
    const scopeChild: ScopeChild = new Map()

    const sourceNode = ts.createSourceFile('output.ts', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)

    markParent(sourceNode, parentMap)
    searchFunctionAndScope(sourceNode, parentMap, functions, scopes)
    resolveScopes(sourceNode, parentMap, functions, scopes)
    linkScopes(sourceNode, parentMap, scopes, scopeChild)

    const evalTaintedFunctions = collectEvalTaintedFunctions(sourceNode, parentMap, functions)
    const program = []
    const functionToSegment = new Map<ts.Node, ReturnType<typeof generateSegment>>()

    for (const item of functions) {
        const generated = generateSegment(item, scopes, parentMap, functions, evalTaintedFunctions, {
            withPos: false,
            withEval: item.kind === ts.SyntaxKind.SourceFile && evalMode,
        })
        program.push(generated)
        functionToSegment.set(item, generated)
    }

    const flattened = program.flat()
    genOffset(flattened)

    const programData: number[] = []
    const literalValues: any[] = []
    generateData(flattened, functionToSegment, programData, literalValues, () => 0, [])
    return programData
}

function analyzeFixture(fixtureName: string): FixtureHistogram {
    const cached = fixtureHistogramCache.get(fixtureName)
    if (cached) {
        return cached
    }

    const source = fs.readFileSync(path.join(FIXTURES_DIR, fixtureName), 'utf8')
    const programData = collectPreObfuscationProgramData(source, false)
    const counts = new Map<number, number>()
    const familySequence: number[] = []
    let oneWordCount = 0
    let twoWordCount = 0

    let index = 0
    let totalOps = 0
    while (index < programData.length) {
        const opcode = programData[index]!
        const family = getCanonicalOpcodeFamily(opcode)
        counts.set(family, (counts.get(family) ?? 0) + 1)
        familySequence.push(family)
        totalOps++
        if (isLiteralFamily(opcode)) {
            twoWordCount++
            index += 2
        } else {
            oneWordCount++
            index += 1
        }
    }

    const rows = [...counts.entries()]
        .map(([family, count]) => ({
            family,
            name: OPCODE_NAMES[family] ?? `#${family}`,
            count,
            pct: count / totalOps,
        }))
        .sort((left, right) => right.count - left.count)

    const histogram = {
        totalOps,
        uniqueFamilies: rows.length,
        top12Coverage: rows.slice(0, 12).reduce((sum, row) => sum + row.pct, 0),
        hotCoverage: rows
            .filter((row) => HOT_FAMILY_SET.has(row.family))
            .reduce((sum, row) => sum + row.pct, 0),
        tailCountLeq5: rows.filter((row) => row.count <= 5).length,
        oneWordRatio: oneWordCount / totalOps,
        twoWordRatio: twoWordCount / totalOps,
        window32: summarizeSlidingWindows(familySequence, 32),
        window64: summarizeSlidingWindows(familySequence, 64),
        rows,
    }

    fixtureHistogramCache.set(fixtureName, histogram)
    return histogram
}

test('opcode family helpers collapse aliases onto canonical base opcodes', () => {
    expect(getCanonicalOpcodeFamily(OpCode.LiteralAlias1)).toBe(OpCode.Literal)
    expect(getCanonicalOpcodeFamily(OpCode.ProtectedLiteralAlias1)).toBe(OpCode.ProtectedLiteral)
    expect(getCanonicalOpcodeFamily(OpCode.GetAlias1)).toBe(OpCode.Get)
    expect(getCanonicalOpcodeFamily(OpCode.PopAlias1)).toBe(OpCode.Pop)
    expect(getOpcodeFamilyMembers(OpCode.Jump)).toEqual([OpCode.Jump, OpCode.JumpAlias1])
    expect(getOpcodeSafetyClass(OpCode.Literal)).toBe('hot')
    expect(getOpcodeSafetyClass(OpCode.ProtectedLiteral)).toBe('hot')
    expect(getOpcodeWordArity(OpCode.ProtectedLiteral)).toBe(3)
    expect(getOpcodeSafetyClass(OpCode.ReturnInTryCatchFinally)).toBe('privileged')
    expect(isPrivilegedOpcodeFamily(OpCode.Reseed)).toBe(true)
    expect(getProjectedRuntimeOpcodeKeepSet().includes(OpCode.UndefinedLiteral)).toBe(true)
    expect(getProjectedRuntimeOpcodeKeepSet().includes(OpCode.ProtectedLiteral)).toBe(false)
})

test('fixture corpus prior helper analyzes the initial baseline set', () => {
    for (const fixtureName of ['jquery.js', 'loader.js', 'bad-code.js', 'opcode-kitchen-sink.js']) {
        const histogram = analyzeFixture(fixtureName)
        expect(histogram.totalOps).toBeGreaterThan(0)
        expect(histogram.uniqueFamilies).toBeGreaterThan(0)
        expect(histogram.oneWordRatio + histogram.twoWordRatio).toBeCloseTo(1)
    }
})

test('jquery fixture establishes a skewed hot-family prior baseline with realistic local windows', () => {
    const histogram = analyzeFixture('jquery.js')

    expect(histogram.rows[0]!.name).toBe('Literal')
    expect(histogram.rows[0]!.pct).toBeGreaterThan(0.5)
    expect(histogram.top12Coverage).toBeGreaterThan(0.85)
    expect(histogram.hotCoverage).toBeGreaterThan(0.8)
    expect(histogram.tailCountLeq5).toBeGreaterThan(10)
    expect(histogram.twoWordRatio).toBeGreaterThan(0.35)
    expect(histogram.oneWordRatio).toBeGreaterThan(0.2)
    expect(histogram.window32.samples).toBeGreaterThan(100)
    expect(histogram.window64.samples).toBeGreaterThan(100)
    expect(histogram.window32.hotCoverageMedian).toBeGreaterThan(0.75)
    expect(histogram.window64.hotCoverageMedian).toBeGreaterThan(0.75)
    expect(histogram.window32.dominantShareMedian).toBeGreaterThan(0.3)
})
