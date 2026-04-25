import * as ts from 'typescript'

import { OpCode } from '../../shared'
import { op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

export function generateAsyncTemplate(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined {
    if (ts.isYieldExpression(node)) {
        if (node.asteriskToken) {
            return [
                ...ctx.generate(node.expression!, flag),
                op(OpCode.YieldStar),
                op(OpCode.YieldResume)
            ]
        }

        return [
            ...(node.expression ? ctx.generate(node.expression, flag) : [op(OpCode.UndefinedLiteral)]),
            op(OpCode.Yield),
            op(OpCode.YieldResume)
        ]
    }

    if (ts.isAwaitExpression(node)) {
        return [
            ...ctx.generate(node.expression, flag),
            op(OpCode.Await)
        ]
    }

    if (ts.isNoSubstitutionTemplateLiteral(node)) {
        return [op(OpCode.Literal, 2, [node.text])]
    }

    if (ts.isTemplateExpression(node)) {
        const ops: Segment = [
            op(OpCode.Literal, 2, [node.head.text])
        ]
        for (const span of node.templateSpans) {
            ops.push(...ctx.generate(span.expression, flag))
            ops.push(op(OpCode.BPlus))
            ops.push(op(OpCode.Literal, 2, [span.literal.text]))
            ops.push(op(OpCode.BPlus))
        }
        return ops
    }

    if (ts.isTaggedTemplateExpression(node)) {
        throw new Error('Tagged template expressions are not supported')
    }
}
