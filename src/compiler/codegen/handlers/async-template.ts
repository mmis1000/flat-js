import * as ts from 'typescript'

import { OpCode } from '../../shared'
import { op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'
import { generateDirectCall } from './calls-access'

function pushTemplatePart(ops: Segment, value: string | undefined) {
    if (value === undefined) {
        ops.push(op(OpCode.UndefinedLiteral))
    } else {
        ops.push(op(OpCode.Literal, 2, [value]))
    }
}

type TemplatePart = ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail
const TEMPLATE_CONTAINS_INVALID_ESCAPE = 2048

function getTemplateFlags(part: TemplatePart) {
    return (part as TemplatePart & { templateFlags?: ts.TokenFlags }).templateFlags ?? ts.TokenFlags.None
}

function getCookedTemplateText(part: TemplatePart) {
    return (getTemplateFlags(part) & TEMPLATE_CONTAINS_INVALID_ESCAPE) !== 0
        ? undefined
        : part.text
}

function getRawTemplateText(part: TemplatePart) {
    return (part.rawText ?? part.text).replace(/\r\n?/g, '\n')
}

function getTemplateParts(template: ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression) {
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
        return {
            cooked: [getCookedTemplateText(template)],
            raw: [getRawTemplateText(template)],
        }
    }

    return {
        cooked: [
            getCookedTemplateText(template.head),
            ...template.templateSpans.map((span) => getCookedTemplateText(span.literal)),
        ],
        raw: [
            getRawTemplateText(template.head),
            ...template.templateSpans.map((span) => getRawTemplateText(span.literal)),
        ],
    }
}

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
        const { cooked, raw } = getTemplateParts(node.template)
        const substitutions = ts.isNoSubstitutionTemplateLiteral(node.template)
            ? []
            : node.template.templateSpans.map((span: ts.TemplateSpan) => span.expression)
        const args: Segment = []

        for (const part of raw) {
            args.push(op(OpCode.Literal, 2, [part]))
        }
        for (const part of cooked) {
            pushTemplatePart(args, part)
        }
        args.push(op(OpCode.Literal, 2, [cooked.length]))
        args.push(op(OpCode.TemplateObject))

        for (const substitution of substitutions) {
            args.push(...ctx.generate(substitution, flag))
        }

        return generateDirectCall(node.tag, args, substitutions.length + 1, flag, ctx)
    }
}
