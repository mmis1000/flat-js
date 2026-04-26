import * as ts from 'typescript'

import { OpCode, VariableType } from '../shared'

export type Op<Code extends OpCode = OpCode> = {
    op: Code
    /** A length of 0 prevent emit of opcode itself */
    length: number
    preData: any[]
    data: number[]
    offset: number
    internal: boolean
    scopeDebugNames?: string[]
    source?: { start: number, end: number }
    /** Block-key ID assigned by injectReseedTags; undefined = same block as predecessor */
    seedId?: number
    /** If true, emit op.op directly (skip aliasing in generateData). */
    raw?: boolean
    /** If set, this Literal is an encKey placeholder; points to the NodeOffset that resolves the target. */
    nodeOffsetRef?: Op
    /** For NodeOffset junk gadgets, identifies the jump that consumes this pushed target. */
    jumpConsumerRef?: Op
    /** For NodeFunctionType, identifies the DefineFunction op that consumes its emitted type. */
    defineConsumerRef?: Op
}

export type Segment = Op[]

export type JumpLabel = {
    jumpLabel: true
    anchor: Op
    entryOp?: Op
}

export type JumpTarget = ts.Node | JumpLabel
export type JumpTargetInput = ts.Node | Op | JumpLabel

export type SegmentOptions = {
    withPos?: boolean
    withEval?: boolean
    withStrict?: boolean
}

export type StaticAccess = {
    depth: number
    index: number
    type: VariableType
}

export type CodegenHandler = (node: ts.Node, flag: number, ctx: import('./context').CodegenContext) => Segment | undefined
