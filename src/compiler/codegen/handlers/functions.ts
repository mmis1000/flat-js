import * as ts from 'typescript'

import { OpCode } from '../../shared'
import { op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

export function getExpectedArgumentCount(node: ts.SignatureDeclarationBase): number {
    let count = 0

    for (const parameter of node.parameters) {
        if (parameter.dotDotDotToken != null || parameter.initializer != null) {
            break
        }
        count += 1
    }

    return count
}

export function generateFunctionDefinitionWithStackName(node: ts.FunctionLikeDeclarationBase): Segment {
    return [
        op(OpCode.Literal, 2, [getExpectedArgumentCount(node)]),
        op(OpCode.NodeOffset, 2, [node]),
        op(OpCode.NodeOffset, 2, [node, 'bodyStart']),
        op(OpCode.NodeFunctionType, 2, [node]),
        op(OpCode.DefineFunction)
    ]
}

export function generateFunctionDefinition(node: ts.ArrowFunction | ts.FunctionExpression, name: string): Segment {
    return [
        op(OpCode.Literal, 2, [name]),
        ...generateFunctionDefinitionWithStackName(node)
    ]
}

export function generateFunctions(node: ts.Node, _flag: number, ctx: CodegenContext): Segment | undefined {
    if (ts.isArrowFunction(node)) {
        return generateFunctionDefinition(node, '')
    }

    if (ts.isFunctionExpression(node)) {
        return generateFunctionDefinition(node, node.name?.text ?? '')
    }

    if (ts.isFunctionDeclaration(node)) {
        ctx.functionDeclarations.push(node)
        return []
    }
}
