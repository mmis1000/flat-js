import * as ts from 'typescript'

import { isScopeRoot, type Scopes, type VariableRoot } from '../analysis'
import { OpCode, SpecialVariable } from '../shared'
import type { JumpLabel, JumpTarget, JumpTargetInput, Op, Segment } from './types'

export function abort(msg: string): never {
    throw new Error(msg)
}

export function headOf<T>(arr: T[]): T {
    if (arr.length === 0) {
        throw new Error('empty array')
    }
    return arr[0]!
}

export function getNameOfKind(kind: ts.SyntaxKind): string {
    let name = ts.SyntaxKind[kind]

    if (name.match(/^First|^Last/)) {
        for (const [key, value] of Object.entries(ts.SyntaxKind)) {
            if (value === kind && key !== name) {
                return key
            }
        }
    }

    return name
}

export function isJumpLabel(target: JumpTargetInput | undefined): target is JumpLabel {
    return target !== undefined && (target as JumpLabel).jumpLabel === true
}

function isAstJumpTarget(target: JumpTargetInput | undefined): target is ts.Node {
    return target !== undefined && !isJumpLabel(target) && typeof (target as ts.Node).kind === 'number'
}

export function toJumpTarget(target: JumpTargetInput): JumpTarget {
    if (isJumpLabel(target) || isAstJumpTarget(target)) {
        return target
    }

    return { jumpLabel: true, anchor: target }
}

export function getJumpTargetAnchor(target: JumpTarget | undefined): Op | undefined {
    if (target === undefined || !isJumpLabel(target)) {
        return undefined
    }

    return target.anchor
}

export function resolveJumpTargetOffset(target: JumpTarget, fnRootToSegment: Map<ts.Node, Segment>): number {
    if (isJumpLabel(target)) {
        return (target.entryOp ?? target.anchor).offset
    }

    return headOf(fnRootToSegment.get(target)!).offset
}

export function op(op: OpCode.Nop, length: 0, preData?: never[]): Op<OpCode>
export function op(op: OpCode.NodeOffset, length?: number, preData?: JumpTargetInput[]): Op<OpCode>
export function op(op: Exclude<OpCode, OpCode.NodeOffset | OpCode.Nop>, length?: number, preData?: any[]): Op<OpCode>
export function op(op: OpCode, length: number = 1, preData: any[] = []): Op<OpCode> {
    const normalizedPreData = op === OpCode.NodeOffset
        ? preData.map((target) => toJumpTarget(target as JumpTargetInput))
        : preData

    return {
        op,
        length,
        preData: normalizedPreData,
        data: [],
        internal: false,
        offset: -1
    }
}

export function createNodeFunctionTypeDefinePair(func: VariableRoot): [Op, Op] {
    const nodeFunctionType = op(OpCode.NodeFunctionType, 4, [func])
    const defineFunction = op(OpCode.DefineFunction)
    nodeFunctionType.defineConsumerRef = defineFunction
    return [nodeFunctionType, defineFunction]
}

export function createNodeOffsetEncKeyPlaceholder(nodeOffsetOp: Op): Op {
    return {
        op: OpCode.Literal,
        length: 2,
        preData: [0],
        data: [],
        internal: true,
        offset: -1,
        nodeOffsetRef: nodeOffsetOp
    }
}

export function attachJumpConsumer(nodeOffsetOp: Op, jumpOp: Op): Op {
    nodeOffsetOp.jumpConsumerRef = jumpOp
    return nodeOffsetOp
}

export function markInternals(ops: Op<OpCode>[]): Op<OpCode>[] {
    for (const op of ops) {
        op.internal = true
    }

    return ops
}

export function markInternal(op: Op<OpCode>): Op<OpCode> {
    op.internal = true
    return op
}

function pushUniqueName(list: string[], name: string) {
    if (name !== '' && !list.includes(name)) {
        list.push(name)
    }
}

export function getScopeDebugNames(node: ts.Node, scopes: Scopes): string[] {
    const names: string[] = [...(scopes.get(node)?.keys() ?? [])]

    if (isScopeRoot(node) && !ts.isSourceFile(node) && !ts.isArrowFunction(node)) {
        pushUniqueName(names, SpecialVariable.This)
        pushUniqueName(names, SpecialVariable.NewTarget)
        pushUniqueName(names, 'arguments')
    }

    if (ts.isFunctionExpression(node) && node.name) {
        pushUniqueName(names, node.name.text)
    }

    return names
}

export function generateVariableList(node: ts.Node, scopes: Scopes): Op[] {
    const variables = scopes.get(node)!

    return markInternals([...variables].map(([name, type]) => [
        op(OpCode.Literal, 2, [name]),
        op(OpCode.Literal, 2, [type.type])
    ]).flat().concat([
        op(OpCode.Literal, 2, [variables.size])
    ]))
}

export function generateEnterScope(node: ts.Node, scopes: Scopes): Op<OpCode>[] {
    const enter = op(OpCode.EnterScope)
    enter.scopeDebugNames = getScopeDebugNames(node, scopes)
    const result = [
        ...generateVariableList(node, scopes),
        enter
    ]

    if (result.length <= 2) {
        throw new Error('tries to generate empty block')
    }

    return markInternals(result)
}

export function generateLeaveScope(): Op<OpCode>[] {
    return markInternals([
        op(OpCode.LeaveScope)
    ])
}
