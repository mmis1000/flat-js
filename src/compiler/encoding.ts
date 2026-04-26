import * as ts from 'typescript'

import { TEXT_DADA_MASK, FunctionTypes, LiteralPoolKind, OpCode, isSmallNumber, literalPoolWordMask } from './shared'
import type { VariableRoot } from './analysis'
import { getJumpTargetAnchor, headOf, isJumpLabel, op, resolveJumpTargetOffset } from './codegen/helpers'
import type { JumpTarget, Op, Segment } from './codegen/types'

export function genOffset(nodes: Segment) {
    let offset = 0
    for (const seg of nodes) {
        seg.offset = offset
        offset += seg.length
    }
}

/** True for all 2-word Literal-family opcodes (base + aliases). MUST SYNC with runtime. */
export function isLiteralFamily(op: number): boolean {
    return op === OpCode.Literal || op === OpCode.LiteralAlias1 || op === OpCode.LiteralAlias2
}

const OPCODE_ALIASES: Partial<Record<OpCode, OpCode[]>> = {
    [OpCode.Literal]: [OpCode.LiteralAlias1, OpCode.LiteralAlias2],
    [OpCode.Get]: [OpCode.GetAlias1],
    [OpCode.Set]: [OpCode.SetAlias1],
    [OpCode.Pop]: [OpCode.PopAlias1],
    [OpCode.Jump]: [OpCode.JumpAlias1],
    [OpCode.JumpIfNot]: [OpCode.JumpIfNotAlias1],
    [OpCode.GetRecord]: [OpCode.GetRecordAlias1],
    [OpCode.Duplicate]: [OpCode.DuplicateAlias1],
}

function maybeAlias(baseOp: OpCode, rng: () => number): OpCode {
    const aliases = OPCODE_ALIASES[baseOp]
    if (!aliases) {
        return baseOp
    }
    const pool = [baseOp, ...aliases]
    return pool[Math.floor(rng() * pool.length)]!
}

function inverseModMul(c: number): number {
    c = c | 0
    let x = 1
    for (let i = 0; i < 5; i++) {
        x = Math.imul(x, 2 - Math.imul(c, x))
    }
    return x >>> 0
}

const INV_MUL_A = inverseModMul(0x85ebca6b)
const INV_MUL_B = inverseModMul(0xc2b2ae35)

/** Forward 32-bit transform: word -> ciphertext. MUST SYNC with runtime. */
export function blockTransform(word: number, key: number): number {
    let x = (word ^ key) | 0
    x ^= x >>> 16
    x = Math.imul(x, 0x85ebca6b)
    x ^= x >>> 13
    x = Math.imul(x, 0xc2b2ae35)
    x ^= x >>> 16
    return x >>> 0
}

/** Exact inverse of blockTransform. MUST SYNC with runtime. */
export function blockInverseTransform(word: number, key: number): number {
    let x = word | 0
    x ^= x >>> 16
    x = Math.imul(x, INV_MUL_B)
    x ^= x >>> 13
    x ^= x >>> 26
    x = Math.imul(x, INV_MUL_A)
    x ^= x >>> 16
    x = (x ^ key) | 0
    return x >>> 0
}

/** Position-dependent stream mask. MUST SYNC with runtime. */
export function opcodeStreamMask(pos: number, seed: number): number {
    let x = (pos * 0x9e3779b9 + seed) | 0
    x = (((x >>> 16) ^ x) * 0x45d9f3b) | 0
    x = (((x >>> 16) ^ x) * 0x45d9f3b) | 0
    return ((x >>> 16) ^ x) | 0
}

/** Derived key combining block seed and position. MUST SYNC with runtime. */
export function getDerivedKey(activeSeed: number, pos: number, globalSeed: number): number {
    return (activeSeed ^ opcodeStreamMask(pos, globalSeed)) >>> 0
}

export const OPCODE_SEED_MASK = 0x5A3C96E1

function opcodeShufflePrng(seed: number): () => number {
    let s = seed | 0
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) | 0
        return s >>> 0
    }
}

/** Fisher-Yates permutation over [0, _COUNT). MUST SYNC with runtime. */
export function generateOpcodePermutation(seed: number): number[] {
    const n = OpCode._COUNT
    const perm = Array.from({ length: n }, (_unused, index) => index)
    const next = opcodeShufflePrng(seed)
    for (let index = n - 1; index > 0; index--) {
        const other = next() % (index + 1)
        const tmp = perm[index]!
        perm[index] = perm[other]!
        perm[other] = tmp
    }
    return perm
}

function generateInvalidOp(rng: () => number): Op {
    const junkValue = OpCode._COUNT + Math.floor(rng() * 100)
    return {
        op: junkValue as OpCode,
        length: 1,
        preData: [],
        data: [],
        internal: true,
        raw: true,
        offset: -1
    }
}

function generateJunkOps(count: number, rng: () => number): Op[] {
    const result: Op[] = []
    for (let index = 0; index < count; index++) {
        result.push(generateInvalidOp(rng))
    }
    return result
}

function generateDeadBranch(rng: () => number): Op[] {
    const deadCodeLen = 1 + Math.floor(rng() * 4)
    const deadOps = generateJunkOps(deadCodeLen, rng)
    const after: Op = { op: OpCode.Nop, length: 1, preData: [], data: [], internal: true, offset: -1 }
    const nodeOffset = op(OpCode.NodeOffset, 2, [after])
    nodeOffset.internal = true
    const jump = op(OpCode.Jump)
    jump.internal = true
    nodeOffset.jumpConsumerRef = jump
    return [
        nodeOffset,
        jump,
        ...deadOps,
        after
    ]
}

export function injectGarbage(segment: Segment, rng: () => number): Segment {
    const jumpTargetAnchors = new Set<Op>()
    for (const op of segment) {
        if (op.op === OpCode.NodeOffset) {
            const anchor = getJumpTargetAnchor(op.preData[0] as JumpTarget | undefined)
            if (anchor !== undefined) {
                jumpTargetAnchors.add(anchor)
            }
        }
    }

    const out: Op[] = []
    for (let index = 0; index < segment.length; index++) {
        const op = segment[index]!
        const followsTransparentLabel = index > 0 && segment[index - 1]!.length === 0
        const isJumpTarget = jumpTargetAnchors.has(op)
        if (!op.internal && op.length > 0 && !followsTransparentLabel && !isJumpTarget && rng() < 0.05) {
            out.push(generateInvalidOp(rng))
        }
        if (!op.internal && op.length > 0 && !followsTransparentLabel && !isJumpTarget && rng() < 0.2) {
            out.push(...generateDeadBranch(rng))
        }
        out.push(op)
    }
    return out
}

const CONDITIONAL_JUMPS = new Set<OpCode>([
    OpCode.JumpIfNot,
    OpCode.JumpIf,
    OpCode.JumpIfAndKeep,
    OpCode.JumpIfNotAndKeep,
    OpCode.JumpIfNotAlias1,
])

function getJumpTargetSeedId(targetOp: Op, segments: Segment[]): number | undefined {
    let effectiveSeedId = targetOp.seedId
    if (effectiveSeedId === undefined && targetOp.length === 0) {
        for (const segment of segments) {
            const index = segment.indexOf(targetOp)
            if (index >= 0) {
                for (let lookahead = index + 1; lookahead < segment.length; lookahead++) {
                    if (segment[lookahead]!.seedId !== undefined) {
                        effectiveSeedId = segment[lookahead]!.seedId
                        break
                    }
                    if (segment[lookahead]!.length > 0) {
                        break
                    }
                }
                break
            }
        }
    }

    return effectiveSeedId
}

export function injectReseedTags(segments: Segment[]): void {
    const jumpTargets = new Set<Op>()

    for (const segment of segments) {
        for (const op of segment) {
            if (op.op === OpCode.NodeOffset) {
                const target = getJumpTargetAnchor(op.preData[0] as JumpTarget | undefined)
                if (target !== undefined) {
                    jumpTargets.add(target)
                }
            }
        }
    }

    for (const segment of segments) {
        for (let index = 0; index < segment.length - 1; index++) {
            const op = segment[index]!
            if (jumpTargets.has(op) && op.length === 0) {
                jumpTargets.delete(op)
                jumpTargets.add(segment[index + 1]!)
            }
        }
    }

    let nextId = 1
    for (const segment of segments) {
        for (let index = 0; index < segment.length; index++) {
            const op = segment[index]!
            if (jumpTargets.has(op) && op.seedId === undefined) {
                op.seedId = nextId++
            }
            if (CONDITIONAL_JUMPS.has(op.op) && index + 1 < segment.length) {
                const fallthrough = segment[index + 1]!
                if (fallthrough.length === 0 && index + 2 < segment.length) {
                    const realFallthrough = segment[index + 2]!
                    if (realFallthrough.seedId === undefined) {
                        realFallthrough.seedId = nextId++
                    }
                } else if (fallthrough.seedId === undefined) {
                    fallthrough.seedId = nextId++
                }
            }
        }
    }

    for (const segment of segments) {
        for (let index = 0; index < segment.length - 1; index++) {
            const op = segment[index]!
            if (op.op !== OpCode.NodeOffset) {
                continue
            }
            const targetOp = getJumpTargetAnchor(op.preData[0] as JumpTarget | undefined)
            if (targetOp === undefined) {
                continue
            }
            const effectiveSeedId = getJumpTargetSeedId(targetOp, segments)
            if (effectiveSeedId === undefined) {
                continue
            }
            if (op.jumpConsumerRef !== undefined) {
                op.jumpConsumerRef.seedId = effectiveSeedId
                continue
            }
            for (let lookahead = index + 1; lookahead < segment.length; lookahead++) {
                const candidate = segment[lookahead]!
                if (candidate.op === OpCode.NodeOffset && candidate.jumpConsumerRef !== undefined) {
                    const junkConsumerIndex = segment.indexOf(candidate.jumpConsumerRef, lookahead + 1)
                    if (junkConsumerIndex >= 0) {
                        lookahead = junkConsumerIndex
                        continue
                    }
                }
                if (
                    candidate.op === OpCode.Jump
                    || CONDITIONAL_JUMPS.has(candidate.op)
                    || candidate.op === OpCode.JumpAlias1
                ) {
                    candidate.seedId = effectiveSeedId
                    break
                }
                if (candidate.op === OpCode.NodeOffset) {
                    break
                }
            }
        }
    }
}

export function expandReseeds(segments: Segment[], rng: () => number): void {
    const seedIds = new Set<number>()
    for (const segment of segments) {
        for (const op of segment) {
            if (op.seedId !== undefined) {
                seedIds.add(op.seedId)
            }
        }
    }

    const seedKeys = new Map<number, number>()
    for (const id of seedIds) {
        seedKeys.set(id, (rng() * 0x80000000) >>> 0)
    }

    const insertedLiterals = new Map<Op, Op>()

    for (const segment of segments) {
        const newSegment: Op[] = []
        let currentSeedId: number | undefined

        for (const op of segment) {
            if (op.seedId !== undefined && op.seedId !== currentSeedId) {
                const key = seedKeys.get(op.seedId)!
                const literalOp: Op = {
                    op: OpCode.Literal,
                    length: 2,
                    preData: [key],
                    data: [],
                    internal: true,
                    offset: -1
                }
                newSegment.push(literalOp)
                newSegment.push({
                    op: OpCode.Reseed,
                    length: 1,
                    preData: [],
                    data: [],
                    internal: true,
                    offset: -1
                })
                insertedLiterals.set(op, literalOp)
                currentSeedId = op.seedId
            }
            newSegment.push(op)
        }

        segment.length = 0
        segment.push(...newSegment)
    }

    for (const segment of segments) {
        for (const op of segment) {
            if (op.op === OpCode.NodeOffset && op.preData.length > 0) {
                const target = op.preData[0] as JumpTarget | undefined
                if (isJumpLabel(target)) {
                    const literal = insertedLiterals.get(target.anchor)
                    if (literal) {
                        target.entryOp = literal
                    }
                }
            }
        }
    }
}

export type EncKeyPlaceholder = {
    /** Index in programData of the operand word (the 0 placeholder). */
    operandPos: number
    /** Offset of the target segment's first word (its encKey = activeSeed there). */
    segmentStartOffset: number
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
        if (isLiteralFamily(programData[index]!)) {
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
    programData: number[],
    literalValues: any[],
    rng: () => number,
    encKeyPlaceholders: EncKeyPlaceholder[] = []
) {
    for (const op of seg) {
        if (op.length === 0) {
            continue
        }

        if (op.raw) {
            programData.push(op.op)
            if (op.length > 1) {
                for (const data of op.preData) {
                    programData.push(data as number)
                }
            }
            continue
        }

        if (op.op === OpCode.Reseed) {
            programData.push(OpCode.Reseed)
            continue
        }

        if (op.op === OpCode.NodeOffset) {
            const ptr = op.preData[0] as JumpTarget
            programData.push(maybeAlias(OpCode.Literal, rng))
            programData.push(resolveJumpTargetOffset(ptr, fnRootToSegment))
            continue
        }

        if (op.op === OpCode.NodeFunctionType) {
            const func: VariableRoot = op.preData[0]
            const emitEncKeyPlaceholder = op.defineConsumerRef !== undefined
            programData.push(maybeAlias(OpCode.Literal, rng))

            const hasAsterisk = (ts.isFunctionDeclaration(func) || ts.isFunctionExpression(func) || ts.isMethodDeclaration(func))
                && (func as any).asteriskToken != null
            const hasAsync = ((func as ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration | ts.ArrowFunction).modifiers?.some(
                (modifier: ts.Modifier | ts.ModifierLike) => modifier.kind === ts.SyntaxKind.AsyncKeyword
            ) ?? false)

            let resolvedType: FunctionTypes
            if (hasAsterisk) {
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

            if (emitEncKeyPlaceholder) {
                programData.push(maybeAlias(OpCode.Literal, rng))
                const operandPos = programData.length
                programData.push(0)
                const funcSeg = fnRootToSegment.get(func)!
                encKeyPlaceholders.push({ operandPos, segmentStartOffset: headOf(funcSeg).offset })
            }
            continue
        }

        if (op.nodeOffsetRef !== undefined) {
            programData.push(maybeAlias(OpCode.Literal, rng))
            const operandPos = programData.length
            programData.push(0)
            const handlerTarget = op.nodeOffsetRef.preData[0] as JumpTarget
            encKeyPlaceholders.push({
                operandPos,
                segmentStartOffset: resolveJumpTargetOffset(handlerTarget, fnRootToSegment)
            })
            continue
        }

        if (op.length === 1) {
            programData.push(maybeAlias(op.op, rng))
            continue
        }

        programData.push(maybeAlias(op.op, rng))
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
                throw new Error(`Unhandled multi-word op ${op.op}`)
        }
    }
}

export function applyEncodingLayers(
    programData: number[],
    codeLength: number,
    perm: number[],
    globalSeed: number,
    segmentStartOffsets: number[],
    encKeyPlaceholders: EncKeyPlaceholder[],
): {
    segmentEncKeys: Map<number, number>
    placeholderActiveSeed: Map<number, number>
    activeSeedAtPos: Map<number, number>
} {
    const segmentEncKeys = new Map<number, number>()
    const placeholderActiveSeed = new Map<number, number>()
    const activeSeedAtPos = new Map<number, number>()

    const segOffsetSet = new Set(segmentStartOffsets)
    const placeholderPosSet = new Set(encKeyPlaceholders.map((placeholder) => placeholder.operandPos))

    let activeSeed = 0
    let pendingSeed: number | null = null

    let index = 0
    while (index < codeLength) {
        if (segOffsetSet.has(index)) {
            segmentEncKeys.set(index, activeSeed)
        }

        activeSeedAtPos.set(index, activeSeed)
        const rawOp = programData[index]!
        const key = getDerivedKey(activeSeed, index, globalSeed)
        const permuted = rawOp >= 0 && rawOp < perm.length ? perm[rawOp]! : rawOp
        programData[index] = blockTransform(permuted >>> 0, key)

        if (rawOp === OpCode.Reseed) {
            activeSeed = (pendingSeed ?? 0) >>> 0
            pendingSeed = null
            index += 1
        } else if (isLiteralFamily(rawOp)) {
            const rawOperand = programData[index + 1]!
            if (placeholderPosSet.has(index + 1)) {
                placeholderActiveSeed.set(index + 1, activeSeed)
            }
            programData[index + 1] = blockTransform(rawOperand >>> 0, getDerivedKey(activeSeed, index + 1, globalSeed))
            pendingSeed = rawOperand
            index += 2
        } else {
            pendingSeed = null
            index += 1
        }
    }

    return { segmentEncKeys, placeholderActiveSeed, activeSeedAtPos }
}

export function collectUsedOpcodes(programData: number[], codeLength: number): number[] {
    const used = new Set<number>()
    const isEncodedProgram = programData.length > codeLength

    if (!isEncodedProgram) {
        let index = 0
        while (index < codeLength) {
            const word = programData[index]!
            if (isLiteralFamily(word)) {
                used.add(word)
                index += 2
            } else {
                used.add(word)
                index += 1
            }
        }
        return Array.from(used)
    }

    const permSeed = programData[programData.length - 1]! >>> 0
    const globalSeed = (permSeed ^ OPCODE_SEED_MASK) >>> 0
    const perm = generateOpcodePermutation(permSeed)
    const inversePerm = new Array(perm.length)
    for (let index = 0; index < perm.length; index++) {
        inversePerm[perm[index]!] = index
    }

    let activeSeed = 0
    let pendingSeed: number | null = null
    let index = 0
    while (index < codeLength) {
        const decoded = blockInverseTransform(
            programData[index]! >>> 0,
            getDerivedKey(activeSeed, index, globalSeed)
        ) >>> 0
        const word = inversePerm[decoded] ?? decoded
        used.add(word)

        if (word === OpCode.Reseed) {
            activeSeed = (pendingSeed ?? 0) >>> 0
            pendingSeed = null
            index += 1
            continue
        }

        if (isLiteralFamily(word)) {
            pendingSeed = blockInverseTransform(
                programData[index + 1]! >>> 0,
                getDerivedKey(activeSeed, index + 1, globalSeed)
            ) >>> 0
            index += 2
            continue
        }

        pendingSeed = null
        index += 1
    }

    return Array.from(used)
}
