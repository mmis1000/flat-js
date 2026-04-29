import * as ts from 'typescript'

import { TEXT_DADA_MASK, FunctionTypes, LiteralPoolKind, OpCode, isSmallNumber, literalPoolWordMask } from './shared'
import type { VariableRoot } from './analysis'
import { headOf } from './codegen/helpers'
import type { Op, Segment } from './codegen'

export function genOffset(nodes: Segment) {
    let offset = 0
    for (const seg of nodes) {
        seg.offset = offset
        offset += seg.length
    }
}

function encodeLiteralPoolWords(value: any): number[] {
    if (typeof value === 'boolean') {
        return [LiteralPoolKind.Boolean, 1, value ? 1 : 0]
    }
    if (typeof value === 'number') {
        const buf = new ArrayBuffer(8)
        new Float64Array(buf)[0] = value
        const u = new Uint32Array(buf)
        return [LiteralPoolKind.Number, 2, u[0] | 0, u[1] | 0]
    }
    if (typeof value === 'string') {
        const words: number[] = [LiteralPoolKind.String, value.length]
        for (let i = 0; i < value.length; i++) {
            words.push(value.charCodeAt(i))
        }
        return words
    }
    if (typeof value === 'bigint') {
        const text = String(value)
        const words: number[] = [LiteralPoolKind.BigInt, text.length]
        for (let i = 0; i < text.length; i++) {
            words.push(text.charCodeAt(i))
        }
        return words
    }
    throw new Error('unsupported literal pool value')
}

/** Append encoded literals to the tail of `programData` and map temp slot indices to absolute positions. Only scans the code prefix `codeLen`. */
export function finalizeLiteralPool(programData: number[], literalValues: any[]) {
    const codeLen = programData.length
    let cursor = codeLen
    const slotPositions: number[] = []
    const poolWords: number[] = []
    for (let slot = 0; slot < literalValues.length; slot++) {
        slotPositions[slot] = cursor
        const encoded = encodeLiteralPoolWords(literalValues[slot])
        for (let index = 0; index < encoded.length; index++) {
            poolWords.push((encoded[index] ^ literalPoolWordMask(cursor + index)) | 0)
        }
        cursor += encoded.length
    }
    for (let index = 0; index < codeLen - 1; index++) {
        if (programData[index] === OpCode.Literal) {
            const op = programData[index + 1]
            if (isSmallNumber(op)) {
                continue
            }
            if ((op & TEXT_DADA_MASK) === 0) {
                continue
            }
            const slot = op ^ TEXT_DADA_MASK
            programData[index + 1] = TEXT_DADA_MASK | slotPositions[slot]
        }
    }
    programData.push(...poolWords)
}

export function generateData(
    seg: Segment,
    fnRootToSegment: Map<ts.Node, Segment>,
    fnRootToBodyStart: Map<ts.Node, Op>,
    programData: number[],
    literalValues: any[]
) {
    for (const op of seg) {
        if (op.length === 0) {
            continue
        }

        if (op.length === 1) {
            programData.push(op.op)
            continue
        }

        if (op.op === OpCode.NodeOffset) {
            const ptr: any = op.preData[0]
            const mode = op.preData[1]
            programData.push(OpCode.Literal)
            if (ptr.kind !== undefined) {
                const nodePtr: ts.Node = ptr
                programData.push(
                    mode === 'bodyStart'
                        ? fnRootToBodyStart.get(nodePtr)!.offset
                        : headOf(fnRootToSegment.get(nodePtr)!).offset
                )
            } else {
                const opPtr: Op = ptr
                programData.push(opPtr.offset)
            }
            continue
        }

        if (op.op === OpCode.NodeFunctionType) {
            const func: VariableRoot = op.preData[0]
            programData.push(OpCode.Literal)

            const hasAsterisk = (ts.isFunctionDeclaration(func) || ts.isFunctionExpression(func) || ts.isMethodDeclaration(func))
                && (func as any).asteriskToken != null
            const hasAsync = ((func as ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration | ts.ArrowFunction).modifiers?.some(
                (modifier: ts.Modifier | ts.ModifierLike) => modifier.kind === ts.SyntaxKind.AsyncKeyword
            ) ?? false)

            let resolvedType: FunctionTypes
            if (hasAsterisk && hasAsync) {
                switch (func.kind) {
                    case ts.SyntaxKind.FunctionDeclaration: resolvedType = FunctionTypes.AsyncGeneratorDeclaration; break
                    case ts.SyntaxKind.FunctionExpression: resolvedType = FunctionTypes.AsyncGeneratorExpression; break
                    case ts.SyntaxKind.MethodDeclaration: resolvedType = FunctionTypes.AsyncGeneratorMethod; break
                    default: throw new Error('unexpected async generator kind')
                }
            } else if (hasAsterisk) {
                switch (func.kind) {
                    case ts.SyntaxKind.FunctionDeclaration: resolvedType = FunctionTypes.GeneratorDeclaration; break
                    case ts.SyntaxKind.FunctionExpression: resolvedType = FunctionTypes.GeneratorExpression; break
                    case ts.SyntaxKind.MethodDeclaration: resolvedType = FunctionTypes.GeneratorMethod; break
                    default: throw new Error('unexpected generator kind')
                }
            } else if (hasAsync) {
                switch (func.kind) {
                    case ts.SyntaxKind.FunctionDeclaration: resolvedType = FunctionTypes.AsyncFunctionDeclaration; break
                    case ts.SyntaxKind.FunctionExpression: resolvedType = FunctionTypes.AsyncFunctionExpression; break
                    case ts.SyntaxKind.ArrowFunction: resolvedType = FunctionTypes.AsyncArrowFunction; break
                    case ts.SyntaxKind.MethodDeclaration: resolvedType = FunctionTypes.AsyncMethod; break
                    default: throw new Error('unexpected async kind')
                }
            } else {
                const typeMap: Record<number, FunctionTypes> = {
                    [ts.SyntaxKind.SourceFile]: FunctionTypes.SourceFile,
                    [ts.SyntaxKind.FunctionDeclaration]: FunctionTypes.FunctionDeclaration,
                    [ts.SyntaxKind.FunctionExpression]: FunctionTypes.FunctionExpression,
                    [ts.SyntaxKind.ArrowFunction]: FunctionTypes.ArrowFunction,
                    [ts.SyntaxKind.GetAccessor]: FunctionTypes.GetAccessor,
                    [ts.SyntaxKind.SetAccessor]: FunctionTypes.SetAccessor,
                    [ts.SyntaxKind.Constructor]: FunctionTypes.Constructor,
                    [ts.SyntaxKind.MethodDeclaration]: FunctionTypes.MethodDeclaration,
                }
                resolvedType = typeMap[func.kind]

                if (func.kind === ts.SyntaxKind.Constructor) {
                    const classNode = (func as ts.ConstructorDeclaration).parent as ts.ClassLikeDeclaration
                    if (classNode.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)) {
                        resolvedType = FunctionTypes.DerivedConstructor
                    }
                }
            }

            programData.push(resolvedType)
            continue
        }

        programData.push(op.op)

        switch (op.op) {
            case OpCode.Literal:
                if (isSmallNumber(op.preData[0])) {
                    programData.push(op.preData[0])
                } else {
                    let slot = literalValues.indexOf(op.preData[0])
                    if (slot < 0) {
                        slot = literalValues.length
                        literalValues.push(op.preData[0])
                    }
                    programData.push(TEXT_DADA_MASK | slot)
                }
                break
            default:
                throw new Error(`Unhandled ${op.op}`)
        }
    }
}

/**
 * Walks encoded program words `[0, codeLength)` and returns distinct opcode values present
 * (including {@link OpCode.Literal} where a literal opcode word appears).
 */
export function collectUsedOpcodes(programData: number[], codeLength: number): number[] {
    const used = new Set<number>()
    let index = 0
    while (index < codeLength) {
        const word = programData[index]
        if (word === OpCode.Literal) {
            used.add(OpCode.Literal)
            index += 2
        } else {
            used.add(word)
            index += 1
        }
    }
    return Array.from(used)
}
