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
}

export type Segment = Op[]

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
