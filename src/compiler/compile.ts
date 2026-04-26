import * as ts from 'typescript'

import { collectEvalTaintedFunctions, linkScopes, markParent, resolveScopes, searchFunctionAndScope, type Functions, type ParentMap, type ScopeChild, type Scopes } from './analysis'
import { generateSegment, type Segment } from './codegen'
import { headOf, resolveJumpTargetOffset } from './codegen/helpers'
import { OPCODE_SEED_MASK, applyEncodingLayers, blockTransform, collectUsedOpcodes, expandReseeds, finalizeLiteralPool, genOffset, generateData, generateOpcodePermutation, getDerivedKey, injectGarbage, injectReseedTags } from './encoding'
import { OpCode, type ProgramScopeDebugMap } from './shared'

export type CompileOptions = {
    /** prints debug info to stdout */
    debug?: boolean
    /** generate sourcemap */
    range?: boolean
    /** generate with eval result op inserted */
    evalMode?: boolean
    /** seed for Layer 4 Fisher-Yates opcode shuffle; random if omitted */
    shuffleSeed?: number
}

export type DebugInfo = {
    sourceMap: [number, number, number, number][]
    internals: boolean[]
    scopeDebugMap: ProgramScopeDebugMap
    /** Byte length of executable code (words before literal pool tail). */
    codeLength: number
    usedOpcodes: number[]
    globalSeed: number
    activeSeedAtPos: Map<number, number>
}

function createLocationMap(src: string) {
    const locationMap = new Map<number, [number, number]>()
    let row = 0
    let col = 0
    for (let i = 0; i < src.length + 1; i++) {
        locationMap.set(i, [row, col])
        if (src[i] === '\n') {
            row += 1
            col = 0
        } else {
            col++
        }
    }
    return locationMap
}

function validateSyntax(sourceNode: ts.SourceFile, locationMap: Map<number, [number, number]>) {
    const servicesHost: ts.CompilerHost = (<Partial<ts.CompilerHost>>{
        getScriptFileNames: () => ['output.ts'],
        getScriptKind: () => ts.ScriptKind.TS,
        getScriptVersion: () => '0',
        useCaseSensitiveFileNames: () => true,
        getDefaultLibFileName: () => 'lib.d.ts',
        getCurrentDirectory: () => '/fake',
        getCanonicalFileName: (str: string) => str,
        getSourceFile: () => sourceNode,
        readFile(fileName) {
            if (fileName === 'lib.d.ts') {
                return ''
            }
            return undefined
        },
        fileExists(fileName) {
            return fileName === 'lib.d.ts'
        },
    }) as ts.CompilerHost

    const program = ts.createProgram(['output.ts'], {}, servicesHost)
    const diagnostics = program.getSyntacticDiagnostics(sourceNode)

    if (diagnostics.length > 0) {
        const errorMessages = diagnostics.map((diagnostic) => {
            const pos = locationMap.get(diagnostic.start ?? -1)
            return `at ${pos?.map((value) => value + 1)?.join(', ') ?? 'unknown'} TS${diagnostic.code} ${diagnostic.messageText}`
        }).join('\r\n')
        throw new SyntaxError(errorMessages)
    }
}

function toSourceRange(locationMap: Map<number, [number, number]>, start: number, end: number): [number, number, number, number] {
    const startPos = locationMap.get(start)!
    const endPos = locationMap.get(end)!
    return [startPos[0], startPos[1], endPos[0], endPos[1]]
}

function mulberry32(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0
        return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
    }
}

function backfillMissingSources(flattened: Segment, sourceNode: ts.SourceFile) {
    let nextKnown = { start: sourceNode.pos, end: sourceNode.end }
    for (let index = flattened.length - 1; index >= 0; index--) {
        const op = flattened[index]!
        if (op.source) {
            nextKnown = op.source
        } else {
            op.source = nextKnown
        }
    }

    let prevKnown = { start: sourceNode.pos, end: sourceNode.end }
    for (const op of flattened) {
        if (op.source) {
            prevKnown = op.source
        } else {
            op.source = prevKnown
        }
    }
}

export function compile(src: string, { debug = false, range = false, evalMode = false, shuffleSeed }: CompileOptions = {}): [number[], DebugInfo] {
    const isJestRun = typeof process !== 'undefined' && process.env?.JEST_WORKER_ID !== undefined
    const envTestSeed = typeof process !== 'undefined' && process.env?.FLATJS_TEST_SEED !== undefined
        ? Number(process.env.FLATJS_TEST_SEED) >>> 0
        : undefined
    const rngSeed = shuffleSeed !== undefined
        ? shuffleSeed
        : envTestSeed !== undefined
            ? envTestSeed
            : isJestRun
                ? 1
                : ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0)
    const rng = mulberry32(rngSeed)

    const parentMap: ParentMap = new Map()
    const scopes: Scopes = new Map()
    const functions: Functions = new Set()
    const scopeChild: ScopeChild = new Map()

    const sourceNode = ts.createSourceFile('output.ts', src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
    const locationMap = createLocationMap(src)

    validateSyntax(sourceNode, locationMap)

    markParent(sourceNode, parentMap)
    searchFunctionAndScope(sourceNode, parentMap, functions, scopes)
    resolveScopes(sourceNode, parentMap, functions, scopes)
    linkScopes(sourceNode, parentMap, scopes, scopeChild)
    const evalTaintedFunctions = collectEvalTaintedFunctions(sourceNode, parentMap, functions)

    const program: Segment[] = []
    const functionToSegment = new Map<ts.Node, Segment>()

    for (const item of functions) {
        const generated = generateSegment(item, scopes, parentMap, functions, evalTaintedFunctions, {
            withPos: range,
            withEval: (item.kind === ts.SyntaxKind.SourceFile) && evalMode
        })
        program.push(generated)
        functionToSegment.set(item, generated)
    }

    const functionsArray = [...functions]
    for (let index = 0; index < program.length; index++) {
        const newSegment = injectGarbage(program[index]!, rng)
        program[index] = newSegment
        functionToSegment.set(functionsArray[index]!, newSegment)
    }

    injectReseedTags(program)
    expandReseeds(program, rng)

    const flattened = program.flat()

    genOffset(flattened)

    if (debug) {
        /*
        console.error(flattened.map(it => {
            let res = `${it.offset < 10 ? '00' + it.offset : it.offset < 100 ? '0' + it.offset : it.offset} ${OpCode[it.op]} `
            return res
        }).join('\r\n'))
        */
    }

    const literalValues: any[] = []
    const programData: number[] = []
    const scopeDebugMap: ProgramScopeDebugMap = new Map()
    const sourceMap: [number, number, number, number][] = []
    const internals: boolean[] = []

    if (range || debug) {
        for (const item of flattened) {
            if (item.scopeDebugNames && item.scopeDebugNames.length > 0) {
                scopeDebugMap.set(item.offset, [...item.scopeDebugNames])
            }
        }
    }

    if (range) {
        backfillMissingSources(flattened, sourceNode)
        for (const item of flattened) {
            const start = item.offset
            const end = item.offset + item.length
            for (let index = start; index < end; index++) {
                sourceMap[index] = toSourceRange(locationMap, item.source!.start, item.source!.end)
                internals[index] = item.internal
                    || item.op === OpCode.DeTDZ
                    || item.op === OpCode.FreezeVariable
                    || item.op === OpCode.NodeFunctionType
                    || item.op === OpCode.NextEntry
                    || item.op === OpCode.Pop
                    || item.op === OpCode.Jump
                    || item.op === OpCode.JumpIf
                    || item.op === OpCode.JumpIfAndKeep
                    || item.op === OpCode.JumpIfNot
                    || item.op === OpCode.JumpIfNotAndKeep
                    || item.op === OpCode.NodeOffset
            }
        }
    }

    const segmentStartOffsets = program.map((segment) => headOf(segment).offset)
    const encKeyPlaceholders: { operandPos: number, segmentStartOffset: number }[] = []
    generateData(flattened, functionToSegment, programData, literalValues, rng, encKeyPlaceholders)

    const codeLength = programData.length
    const usedOpcodes = collectUsedOpcodes(programData, codeLength)

    finalizeLiteralPool(programData, literalValues)

    const globalSeed = (shuffleSeed !== undefined ? shuffleSeed : (rng() * 0x100000000) | 0) >>> 0
    const perm = generateOpcodePermutation((globalSeed ^ OPCODE_SEED_MASK) >>> 0)
    const handlerStartOffsets: number[] = []
    for (const segment of program) {
        for (const op of segment) {
            if (op.nodeOffsetRef !== undefined) {
                const handlerTarget = op.nodeOffsetRef.preData[0]
                handlerStartOffsets.push(resolveJumpTargetOffset(handlerTarget, functionToSegment))
            }
        }
    }
    const allSegmentStartOffsets = [...segmentStartOffsets, ...handlerStartOffsets]
    const { segmentEncKeys, placeholderActiveSeed, activeSeedAtPos } = applyEncodingLayers(
        programData,
        codeLength,
        perm,
        globalSeed,
        allSegmentStartOffsets,
        encKeyPlaceholders
    )

    for (const placeholder of encKeyPlaceholders) {
        const activeSeed = placeholderActiveSeed.get(placeholder.operandPos) ?? 0
        const encKey = segmentEncKeys.get(placeholder.segmentStartOffset) ?? 0
        programData[placeholder.operandPos] = blockTransform(encKey >>> 0, getDerivedKey(activeSeed, placeholder.operandPos, globalSeed))
    }

    programData.push((globalSeed ^ OPCODE_SEED_MASK) | 0)

    return [programData, { sourceMap, internals, scopeDebugMap, codeLength, usedOpcodes, globalSeed, activeSeedAtPos }]
}
