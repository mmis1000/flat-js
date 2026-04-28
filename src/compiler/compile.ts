import * as ts from 'typescript'

import { collectEvalTaintedFunctions, linkScopes, markParent, resolveScopes, searchFunctionAndScope, type Functions, type ParentMap, type ScopeChild, type Scopes } from './analysis'
import { generateSegment, type Segment } from './codegen'
import { finalizeLiteralPool, genOffset, generateData } from './encoding'
import { OpCode, type ProgramScopeDebugMap } from './shared'

export type CompileOptions = {
    /** prints debug info to stdout */
    debug?: boolean
    /** generate sourcemap */
    range?: boolean
    /** generate with eval result op inserted */
    evalMode?: boolean
}

export type DebugInfo = {
    sourceMap: [number, number, number, number][]
    internals: boolean[]
    scopeDebugMap: ProgramScopeDebugMap
    /** Byte length of executable code (words before literal pool tail). */
    codeLength: number
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

function normalizeAmbiguousLabeledLetAsi(src: string) {
    // TypeScript parses `label: let // ASI\n...` as a lexical declaration even though,
    // in sloppy script code, ASI makes it `label: let;` followed by the next statement.
    // Replacing the spacer before the line comment with `;` preserves source length while
    // steering the parser to the correct JavaScript statement split.
    return src.replace(/(:\s*let)([ \t]+)(?=\/\/[^\r\n]*(?:\r\n?|\n))/g, (_, prefix: string, whitespace: string) => {
        return `${prefix};${whitespace.slice(1)}`
    })
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

export function compile(src: string, { debug = false, range = false, evalMode = false }: CompileOptions = {}): [number[], DebugInfo] {
    const parentMap: ParentMap = new Map()
    const scopes: Scopes = new Map()
    const functions: Functions = new Set()
    const scopeChild: ScopeChild = new Map()

    const normalizedSrc = normalizeAmbiguousLabeledLetAsi(src)
    const sourceNode = ts.createSourceFile('output.ts', normalizedSrc, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
    const locationMap = createLocationMap(normalizedSrc)

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

    generateData(flattened, functionToSegment, programData, literalValues)

    const codeLength = programData.length

    finalizeLiteralPool(programData, literalValues)

    return [programData, { sourceMap, internals, scopeDebugMap, codeLength }]
}
