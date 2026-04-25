import * as ts from 'typescript'

import { OpCode } from '../../shared'
import { op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

export function generateFunctions(node: ts.Node, _flag: number, ctx: CodegenContext): Segment | undefined {
    if (ts.isArrowFunction(node)) {
        return [
            op(OpCode.Literal, 2, ['']),
            op(OpCode.NodeOffset, 2, [node]),
            op(OpCode.NodeFunctionType, 2, [node]),
            op(OpCode.DefineFunction)
        ]
    }

    if (ts.isFunctionExpression(node)) {
        return [
            op(OpCode.Literal, 2, [node.name?.text ?? '']),
            op(OpCode.NodeOffset, 2, [node]),
            op(OpCode.NodeFunctionType, 2, [node]),
            op(OpCode.DefineFunction)
        ]
    }

    if (ts.isFunctionDeclaration(node)) {
        ctx.functionDeclarations.push(node)
        return []
    }
}
