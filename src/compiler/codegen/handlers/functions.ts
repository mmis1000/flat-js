import * as ts from 'typescript'

import { OpCode } from '../../shared'
import { createNodeFunctionTypeDefinePair, op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

export function generateFunctions(node: ts.Node, _flag: number, ctx: CodegenContext): Segment | undefined {
    if (ts.isArrowFunction(node)) {
        const [functionType, defineFunction] = createNodeFunctionTypeDefinePair(node)
        return [
            op(OpCode.Literal, 2, ['']),
            op(OpCode.NodeOffset, 2, [node]),
            functionType,
            defineFunction
        ]
    }

    if (ts.isFunctionExpression(node)) {
        const [functionType, defineFunction] = createNodeFunctionTypeDefinePair(node)
        return [
            op(OpCode.Literal, 2, [node.name?.text ?? '']),
            op(OpCode.NodeOffset, 2, [node]),
            functionType,
            defineFunction
        ]
    }

    if (ts.isFunctionDeclaration(node)) {
        ctx.functionDeclarations.push(node)
        return []
    }
}
