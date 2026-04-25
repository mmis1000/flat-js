import * as ts from 'typescript'

import { isScopeRoot, type Scopes } from '../analysis'
import { OpCode, SpecialVariable } from '../shared'
import type { Op } from './types'

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

export function op(op: OpCode.Nop, length: 0, preData?: never[]): Op<OpCode>
export function op(op: OpCode.NodeOffset, length?: number, preData?: (Op | ts.Node)[]): Op<OpCode>
export function op(op: Exclude<OpCode, OpCode.NodeOffset | OpCode.Nop>, length?: number, preData?: any[]): Op<OpCode>
export function op(op: OpCode, length: number = 1, preData: any[] = []): Op<OpCode> {
    return {
        op,
        length,
        preData,
        data: [],
        internal: false,
        offset: -1
    }
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
