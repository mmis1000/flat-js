import * as ts from 'typescript'

import { FunctionTypes, OpCode, SpecialVariable } from '../../shared'
import { op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

type ArrayLikeElement = ts.Expression | ts.SpreadElement | ts.OmittedExpression

function appendArrayElements(
    res: Segment,
    elements: readonly ArrayLikeElement[],
    flag: number,
    ctx: CodegenContext,
    nextIndex: number = 0
) {
    let postSpread = false

    for (const element of elements) {
        if (element.kind === ts.SyntaxKind.OmittedExpression) {
            nextIndex++
            continue
        }

        if (ts.isSpreadElement(element)) {
            res.push(...ctx.generate(element.expression, flag))
            res.push(op(OpCode.ArraySpread))
            postSpread = true
            continue
        }

        if (postSpread) {
            res.push(op(OpCode.Duplicate))
            res.push(op(OpCode.Literal, 2, ['length']))
            res.push(op(OpCode.Get))
            res.push(...ctx.generate(element, flag))
            res.push(op(OpCode.SetKeepCtx))
        } else {
            res.push(op(OpCode.Literal, 2, [nextIndex++]))
            res.push(...ctx.generate(element, flag))
            res.push(op(OpCode.SetKeepCtx))
        }
    }
}

function generateArgumentArray(args: readonly ts.Expression[], flag: number, ctx: CodegenContext): Segment {
    const res: Segment = [op(OpCode.ArrayLiteral)]
    appendArrayElements(res, args, flag, ctx)
    return res
}

function generateArgumentArrayWithThis(args: readonly ts.Expression[], flag: number, ctx: CodegenContext): Segment {
    const res: Segment = [
        op(OpCode.ArrayLiteral),
        op(OpCode.Literal, 2, [0]),
        op(OpCode.GetRecord),
        op(OpCode.Literal, 2, [SpecialVariable.This]),
        op(OpCode.Get),
        op(OpCode.SetKeepCtx),
    ]
    appendArrayElements(res, args, flag, ctx, 1)
    return res
}

export function generateDirectCall(
    self: ts.Node,
    args: Segment,
    argCount: number,
    flag: number,
    ctx: CodegenContext
): Segment {
    if (self.kind === ts.SyntaxKind.SuperKeyword) {
        const res: Segment = []

        res.push(op(OpCode.GetRecord))
        res.push(op(OpCode.Literal, 2, [SpecialVariable.This]))

        res.push(op(OpCode.GetRecord))
        res.push(op(OpCode.Literal, 2, [SpecialVariable.NewTarget]))
        res.push(op(OpCode.Get))

        res.push(op(OpCode.GetRecord))
        res.push(op(OpCode.Literal, 2, [SpecialVariable.Super]))
        res.push(op(OpCode.Get))

        res.push(...args)
        res.push(op(OpCode.Literal, 2, [argCount]))

        res.push(op(OpCode.SuperCall))

        res.push(op(OpCode.SetInitialized))
        res.push(op(OpCode.Pop))
        res.push(op(OpCode.UndefinedLiteral))

        return res
    }

    if (ts.isPropertyAccessExpression(self) && self.expression.kind === ts.SyntaxKind.SuperKeyword) {
        return [
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.Super]),
            op(OpCode.Get),
            op(OpCode.Literal, 2, ['prototype']),
            op(OpCode.Get),
            op(OpCode.Literal, 2, [self.name.text]),
            op(OpCode.Get),

            op(OpCode.Literal, 2, ['call']),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.This]),
            op(OpCode.Get),
            ...args,
            op(OpCode.Literal, 2, [argCount + 1]),
            op(OpCode.Call)
        ]
    }

    if (ts.isElementAccessExpression(self) || ts.isPropertyAccessExpression(self) || ts.isIdentifier(self)) {
        if (ts.isIdentifier(self) && self.text !== 'eval') {
            const staticAccess = ctx.tryResolveStaticAccess(self, self.text)
            if (staticAccess) {
                return [
                    ...ctx.generateStaticAccessOps(staticAccess),
                    op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.GetStaticUnchecked : OpCode.GetStatic),
                    ...args,
                    op(OpCode.Literal, 2, [argCount]),
                    op(OpCode.CallValue)
                ]
            }
        }

        const leftOps = ctx.generateLeft(self, flag)
        const isEval = ts.isIdentifier(self) && self.text === 'eval'

        return [
            ...leftOps,
            ...args,
            op(OpCode.Literal, 2, [argCount]),
            isEval ? op(OpCode.CallAsEval) : op(OpCode.Call)
        ]
    }

    const leftValue = ctx.generate(self, flag)
    return [
        ...leftValue,
        ...args,
        op(OpCode.Literal, 2, [argCount]),
        op(OpCode.CallValue)
    ]
}

export function generateCallsAndAccess(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined {
    if (ts.isCallExpression(node)) {
        const self = ctx.extractQuote(node.expression)
        const hasSpread = node.arguments.some((arg) => ts.isSpreadElement(arg))

        if (hasSpread) {
            if (self.kind === ts.SyntaxKind.SuperKeyword) {
                return [
                    op(OpCode.GetRecord),
                    op(OpCode.Literal, 2, [SpecialVariable.This]),

                    op(OpCode.GetRecord),
                    op(OpCode.Literal, 2, [SpecialVariable.NewTarget]),
                    op(OpCode.Get),

                    op(OpCode.GetRecord),
                    op(OpCode.Literal, 2, [SpecialVariable.Super]),
                    op(OpCode.Get),

                    ...generateArgumentArray(node.arguments, flag, ctx),
                    op(OpCode.ExpandArgumentArray),
                    op(OpCode.SuperCall),

                    op(OpCode.SetInitialized),
                    op(OpCode.Pop),
                    op(OpCode.UndefinedLiteral),
                ]
            }

            if (ts.isPropertyAccessExpression(self) && self.expression.kind === ts.SyntaxKind.SuperKeyword) {
                return [
                    op(OpCode.GetRecord),
                    op(OpCode.Literal, 2, [SpecialVariable.Super]),
                    op(OpCode.Get),
                    op(OpCode.Literal, 2, ['prototype']),
                    op(OpCode.Get),
                    op(OpCode.Literal, 2, [self.name.text]),
                    op(OpCode.Get),

                    op(OpCode.Literal, 2, ['call']),
                    ...generateArgumentArrayWithThis(node.arguments, flag, ctx),
                    op(OpCode.ExpandArgumentArray),
                    op(OpCode.Call)
                ]
            }

            if (ts.isIdentifier(self) && self.text !== 'eval') {
                const staticAccess = ctx.tryResolveStaticAccess(self, self.text)
                if (staticAccess) {
                    return [
                        ...ctx.generateStaticAccessOps(staticAccess),
                        op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.GetStaticUnchecked : OpCode.GetStatic),
                        ...generateArgumentArray(node.arguments, flag, ctx),
                        op(OpCode.ExpandArgumentArray),
                        op(OpCode.CallValue)
                    ]
                }
            }

            if (ts.isElementAccessExpression(self) || ts.isPropertyAccessExpression(self) || ts.isIdentifier(self)) {
                const leftOps = ctx.generateLeft(self, flag)
                const isEval = ts.isIdentifier(self) && self.text === 'eval'

                return [
                    ...leftOps,
                    ...generateArgumentArray(node.arguments, flag, ctx),
                    op(OpCode.ExpandArgumentArray),
                    isEval ? op(OpCode.CallAsEval) : op(OpCode.Call)
                ]
            }

            const leftValue = ctx.generate(self, flag)
            return [
                ...leftValue,
                ...generateArgumentArray(node.arguments, flag, ctx),
                op(OpCode.ExpandArgumentArray),
                op(OpCode.CallValue)
            ]
        }

        const args = node.arguments.map((arg) => ctx.generate(arg, flag)).flat()
        return generateDirectCall(self, args, node.arguments.length, flag, ctx)
    }

    if (ts.isNewExpression(node)) {
        const self = ctx.extractQuote(node.expression)
        const hasSpread = node.arguments?.some((arg) => ts.isSpreadElement(arg)) ?? false

        if (hasSpread) {
            return [
                ...ctx.generate(self, flag),
                ...generateArgumentArray(node.arguments ?? [], flag, ctx),
                op(OpCode.ExpandArgumentArray),
                op(OpCode.New)
            ]
        }

        const args = node.arguments?.map((arg) => ctx.generate(arg, flag)).flat() ?? []

        return [
            ...ctx.generate(self, flag),
            ...args,
            op(OpCode.Literal, 2, [node.arguments?.length ?? 0]),
            op(OpCode.New)
        ]
    }

    if (ts.isArrayLiteralExpression(node)) {
        const res: Segment = [
            op(OpCode.ArrayLiteral)
        ]
        appendArrayElements(res, [...node.elements], flag, ctx)
        return res
    }

    if (ts.isObjectLiteralExpression(node)) {
        const res: Segment = [
            op(OpCode.ObjectLiteral)
        ]

        for (const item of node.properties) {
            if (ts.isShorthandPropertyAssignment(item)) {
                res.push(op(OpCode.Literal, 2, [item.name.text]))
                res.push(...ctx.generate(item.name, flag))
                res.push(op(OpCode.DefineKeepCtx))
                continue
            }

            if (!item.name) {
                throw new Error('property must have name')
            }

            if (ts.isComputedPropertyName(item.name)) {
                res.push(...ctx.generate(item.name.expression, flag))
            } else if (ts.isIdentifier(item.name)) {
                res.push(op(OpCode.Literal, 2, [item.name.text]))
            } else if (ts.isStringLiteral(item.name) || ts.isNumericLiteral(item.name)) {
                res.push(...ctx.generate(item.name, flag))
            } else {
                throw new Error('not supported')
            }

            if (ts.isMethodDeclaration(item)) {
                res.push(op(OpCode.Duplicate))
                res.push(op(OpCode.NodeOffset, 2, [item]))
                res.push(op(OpCode.NodeFunctionType, 2, [item]))
                res.push(op(OpCode.DefineFunction))
                res.push(op(OpCode.DefineKeepCtx))
            } else if (ts.isGetAccessorDeclaration(item)) {
                res.push(op(OpCode.Duplicate))
                res.push(op(OpCode.NodeOffset, 2, [item]))
                res.push(op(OpCode.NodeFunctionType, 2, [item]))
                res.push(op(OpCode.DefineFunction))
                res.push(op(OpCode.DefineGetter))
            } else if (ts.isSetAccessorDeclaration(item)) {
                res.push(op(OpCode.Duplicate))
                res.push(op(OpCode.NodeOffset, 2, [item]))
                res.push(op(OpCode.NodeFunctionType, 2, [item]))
                res.push(op(OpCode.DefineFunction))
                res.push(op(OpCode.DefineSetter))
            } else if (ts.isPropertyAssignment(item)) {
                res.push(...ctx.generate(item.initializer, flag))
                res.push(op(OpCode.DefineKeepCtx))
            } else {
                throw new Error('not supported')
            }
        }

        return res
    }

    if (ts.isRegularExpressionLiteral(node)) {
        const source = node.text.replace(/^\/(.*)\/(\w*)$/, '$1')
        const flags = node.text.replace(/^\/(.*)\/(\w*)$/, '$2')
        return [
            op(OpCode.Literal, 2, [source]),
            op(OpCode.Literal, 2, [flags]),
            op(OpCode.RegexpLiteral)
        ]
    }

    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword) {
        return [
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.Super]),
            op(OpCode.Get),
            op(OpCode.Literal, 2, ['prototype']),
            op(OpCode.Get),
            op(OpCode.Literal, 2, [node.name.text]),
            op(OpCode.Get),
        ]
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        return [
            ...ctx.generateLeft(node, flag),
            op(OpCode.Get)
        ]
    }

    if (ts.isDeleteExpression(node)) {
        const unwrapped = ctx.extractQuote(node.expression)
        if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
            return [
                ...ctx.generateLeft(node.expression, flag),
                op(OpCode.Delete)
            ]
        }

        return [
            ...ctx.generate(node.expression, flag),
            op(OpCode.Pop),
            op(OpCode.Literal, 2, [true])
        ]
    }
}
