import * as ts from 'typescript'

import { OpCode } from '../../shared'
import { abort, getNameOfKind, headOf, op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

export function generateOperators(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined {
    if (ts.isConditionalExpression(node)) {
        const condition = ctx.generate(node.condition, flag)
        const positive = [op(OpCode.Nop, 0), ...ctx.generate(node.whenTrue, flag)]
        const negative = [op(OpCode.Nop, 0), ...ctx.generate(node.whenFalse, flag)]
        const end = [op(OpCode.Nop, 0)]

        return [
            op(OpCode.NodeOffset, 2, [headOf(negative)]),
            ...condition,
            op(OpCode.JumpIfNot),

            ...positive,
            op(OpCode.NodeOffset, 2, [headOf(end)]),
            op(OpCode.Jump),

            ...negative,

            ...end
        ]
    }

    if (ts.isPrefixUnaryExpression(node)) {
        if (ts.isNumericLiteral(node.operand)) {
            if (node.operator === ts.SyntaxKind.MinusToken) {
                return [
                    op(OpCode.Literal, 2, [-Number(node.operand.text)]),
                ]
            }
            if (node.operator === ts.SyntaxKind.PlusToken) {
                return [
                    op(OpCode.Literal, 2, [+Number(node.operand.text)]),
                ]
            }
        }

        switch (node.operator) {
            case ts.SyntaxKind.PlusPlusToken:
                if (ts.isIdentifier(node.operand)) {
                    const staticAccess = ctx.tryResolveStaticAccess(node.operand, node.operand.text)
                    if (staticAccess) {
                        return [
                            ...ctx.generateStaticAccessOps(staticAccess),
                            op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.PrefixPlusPlusStaticUnchecked : OpCode.PrefixPlusPlusStatic)
                        ]
                    }
                }
                return [
                    ...ctx.generateLeft(node.operand, flag),
                    ...(ts.isIdentifier(node.operand) ? [op(OpCode.ResolveScope)] : []),
                    op(OpCode.PrefixPlusPlus)
                ]
            case ts.SyntaxKind.MinusMinusToken:
                if (ts.isIdentifier(node.operand)) {
                    const staticAccess = ctx.tryResolveStaticAccess(node.operand, node.operand.text)
                    if (staticAccess) {
                        return [
                            ...ctx.generateStaticAccessOps(staticAccess),
                            op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.PrefixMinusMinusStaticUnchecked : OpCode.PrefixMinusMinusStatic)
                        ]
                    }
                }
                return [
                    ...ctx.generateLeft(node.operand, flag),
                    ...(ts.isIdentifier(node.operand) ? [op(OpCode.ResolveScope)] : []),
                    op(OpCode.PrefixMinusMinus)
                ]
        }

        const expr = ctx.generate(node.operand, flag)
        switch (node.operator) {
            case ts.SyntaxKind.PlusToken:
                return [...expr, op(OpCode.PrefixUnaryPlus)]
            case ts.SyntaxKind.MinusToken:
                return [...expr, op(OpCode.PrefixUnaryMinus)]
            case ts.SyntaxKind.ExclamationToken:
                return [...expr, op(OpCode.PrefixExclamation)]
            case ts.SyntaxKind.TildeToken:
                return [...expr, op(OpCode.PrefixTilde)]
            default:
                throw new Error('unsupported operator ' + ts.SyntaxKind[node.operator])
        }
    }

    if (ts.isBinaryExpression(node)) {
        switch (node.operatorToken.kind) {
            case ts.SyntaxKind.AmpersandAmpersandToken: {
                const left = ctx.generate(node.left, flag)
                const right = ctx.generate(node.right, flag)
                const exit = [op(OpCode.Nop, 0)]

                return [
                    op(OpCode.NodeOffset, 2, [headOf(exit)]),
                    ...left,
                    op(OpCode.JumpIfNotAndKeep),

                    op(OpCode.Pop),
                    ...right,

                    ...exit
                ]
            }
        }
    }

    if (ts.isBinaryExpression(node)) {
        switch (node.operatorToken.kind) {
            case ts.SyntaxKind.BarBarToken: {
                const left = ctx.generate(node.left, flag)
                const right = ctx.generate(node.right, flag)
                const exit = [op(OpCode.Nop, 0)]

                return [
                    op(OpCode.NodeOffset, 2, [headOf(exit)]),
                    ...left,
                    op(OpCode.JumpIfAndKeep),

                    op(OpCode.Pop),
                    ...right,

                    ...exit
                ]
            }
        }
    }

    if (ts.isVoidExpression(node)) {
        return [
            ...ctx.generate(node.expression, flag),
            op(OpCode.Pop),
            op(OpCode.UndefinedLiteral)
        ]
    }

    if (ts.isBinaryExpression(node)) {
        switch (node.operatorToken.kind) {
            case ts.SyntaxKind.CommaToken:
                return [
                    ...ctx.generate(node.left, flag),
                    op(OpCode.Pop),
                    ...ctx.generate(node.right, flag)
                ]
        }
    }

    if (ts.isBinaryExpression(node)) {
        const kind = node.operatorToken.kind
        switch (kind) {
            case ts.SyntaxKind.PlusEqualsToken:
            case ts.SyntaxKind.MinusEqualsToken:
            case ts.SyntaxKind.SlashEqualsToken:
            case ts.SyntaxKind.AsteriskEqualsToken:
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
            case ts.SyntaxKind.EqualsToken: {
                const left = ctx.extractQuote(node.left)
                if (ts.isIdentifier(left)) {
                    const staticAccess = ctx.tryResolveStaticAccess(left, left.text)
                    if (staticAccess) {
                        return [
                            ...ctx.generate(node.right, flag),
                            ...ctx.generateStaticAccessOps(staticAccess),
                            op(
                                kind === ts.SyntaxKind.EqualsToken
                                    ? (ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.SetStaticUnchecked : OpCode.SetStatic)
                                    : kind === ts.SyntaxKind.PlusEqualsToken
                                        ? (ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.BPlusEqualStaticUnchecked : OpCode.BPlusEqualStatic)
                                        : kind === ts.SyntaxKind.MinusEqualsToken
                                            ? (ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.BMinusEqualStaticUnchecked : OpCode.BMinusEqualStatic)
                                            : kind === ts.SyntaxKind.SlashEqualsToken
                                                ? (ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.BSlashEqualStaticUnchecked : OpCode.BSlashEqualStatic)
                                                : kind === ts.SyntaxKind.AsteriskEqualsToken
                                                    ? (ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.BAsteriskEqualStaticUnchecked : OpCode.BAsteriskEqualStatic)
                                                    : kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken
                                                        ? (ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.BGreaterThanGreaterThanGreaterThanEqualStaticUnchecked : OpCode.BGreaterThanGreaterThanGreaterThanEqualStatic)
                                                    : abort('Why Am I here?')
                            )
                        ]
                    }
                }

                if (
                    ts.isPropertyAccessExpression(left) ||
                    ts.isElementAccessExpression(left) ||
                    ts.isIdentifier(left) ||
                    left.kind === ts.SyntaxKind.ThisKeyword
                ) {
                    return [
                        ...ctx.generateLeft(node.left, flag),
                        ...(ts.isIdentifier(left) ? [op(OpCode.ResolveScope)] : []),
                        ...ctx.generate(node.right, flag),
                        op(
                                kind === ts.SyntaxKind.EqualsToken ? OpCode.Set :
                                kind === ts.SyntaxKind.PlusEqualsToken ? OpCode.BPlusEqual :
                                    kind === ts.SyntaxKind.MinusEqualsToken ? OpCode.BMinusEqual :
                                        kind === ts.SyntaxKind.SlashEqualsToken ? OpCode.BSlashEqual :
                                            kind === ts.SyntaxKind.AsteriskEqualsToken ? OpCode.BAsteriskEqual :
                                                kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ? OpCode.BGreaterThanGreaterThanGreaterThanEqual :
                                                abort('Why Am I here?')
                        )
                    ]
                }

                return [
                    ...ctx.generate(left, flag),
                    op(OpCode.Literal, 2, ['Invalid left-hand side in assignment']),
                    op(OpCode.ThrowReferenceError)
                ]
            }
        }
    }

    if (ts.isBinaryExpression(node)) {
        const ops = [
            ...ctx.generate(node.left, flag),
            ...ctx.generate(node.right, flag),
        ]

        switch (node.operatorToken.kind) {
            case ts.SyntaxKind.InstanceOfKeyword:
                ops.push(op(OpCode.InstanceOf)); break
            case ts.SyntaxKind.PlusToken:
                ops.push(op(OpCode.BPlus)); break
            case ts.SyntaxKind.MinusToken:
                ops.push(op(OpCode.BMinus)); break
            case ts.SyntaxKind.CaretToken:
                ops.push(op(OpCode.BCaret)); break
            case ts.SyntaxKind.AmpersandToken:
                ops.push(op(OpCode.BAmpersand)); break
            case ts.SyntaxKind.BarToken:
                ops.push(op(OpCode.BBar)); break
            case ts.SyntaxKind.GreaterThanToken:
                ops.push(op(OpCode.BGreaterThan)); break
            case ts.SyntaxKind.GreaterThanGreaterThanToken:
                ops.push(op(OpCode.BGreaterThanGreaterThan)); break
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
                ops.push(op(OpCode.BGreaterThanGreaterThanGreaterThan)); break
            case ts.SyntaxKind.GreaterThanEqualsToken:
                ops.push(op(OpCode.BGreaterThanEquals)); break
            case ts.SyntaxKind.LessThanToken:
                ops.push(op(OpCode.BLessThan)); break
            case ts.SyntaxKind.LessThanLessThanToken:
                ops.push(op(OpCode.BLessThanLessThan)); break
            case ts.SyntaxKind.LessThanEqualsToken:
                ops.push(op(OpCode.BLessThanEquals)); break
            case ts.SyntaxKind.EqualsEqualsToken:
                ops.push(op(OpCode.BEqualsEquals)); break
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
                ops.push(op(OpCode.BEqualsEqualsEquals)); break
            case ts.SyntaxKind.ExclamationEqualsToken:
                ops.push(op(OpCode.BExclamationEquals)); break
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
                ops.push(op(OpCode.BExclamationEqualsEquals)); break
            case ts.SyntaxKind.InKeyword:
                ops.push(op(OpCode.BIn)); break
            case ts.SyntaxKind.AsteriskToken:
                ops.push(op(OpCode.BAsterisk)); break
            case ts.SyntaxKind.SlashToken:
                ops.push(op(OpCode.BSlash)); break
            case ts.SyntaxKind.PercentToken:
                ops.push(op(OpCode.BPercent)); break
            default: {
                const remain = node.operatorToken.kind
                throw new Error('unknown token ' + getNameOfKind(remain))
            }
        }

        return ops
    }

    if (ts.isTypeOfExpression(node)) {
        const unwrapped = ctx.extractQuote(node.expression)
        if (ts.isIdentifier(unwrapped)) {
            const staticAccess = ctx.tryResolveStaticAccess(unwrapped, unwrapped.text)
            if (staticAccess) {
                return [
                    ...ctx.generateStaticAccessOps(staticAccess),
                    op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.TypeofStaticReferenceUnchecked : OpCode.TypeofStaticReference)
                ]
            }
            return [
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [unwrapped.text]),
                op(OpCode.TypeofReference)
            ]
        }

        return [
            ...ctx.generate(node.expression, flag),
            op(OpCode.Typeof)
        ]
    }

    if (ts.isPostfixUnaryExpression(node)) {
        switch (node.operator) {
            case ts.SyntaxKind.PlusPlusToken:
                if (ts.isIdentifier(node.operand)) {
                    const staticAccess = ctx.tryResolveStaticAccess(node.operand, node.operand.text)
                    if (staticAccess) {
                        return [
                            ...ctx.generateStaticAccessOps(staticAccess),
                            op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.PostFixPlusPLusStaticUnchecked : OpCode.PostFixPlusPLusStatic)
                        ]
                    }
                }
                return [
                    ...ctx.generateLeft(node.operand, flag),
                    ...(ts.isIdentifier(node.operand) ? [op(OpCode.ResolveScope)] : []),
                    op(OpCode.PostFixPlusPLus)
                ]
            case ts.SyntaxKind.MinusMinusToken:
                if (ts.isIdentifier(node.operand)) {
                    const staticAccess = ctx.tryResolveStaticAccess(node.operand, node.operand.text)
                    if (staticAccess) {
                        return [
                            ...ctx.generateStaticAccessOps(staticAccess),
                            op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.PostFixMinusMinusStaticUnchecked : OpCode.PostFixMinusMinusStatic)
                        ]
                    }
                }
                return [
                    ...ctx.generateLeft(node.operand, flag),
                    ...(ts.isIdentifier(node.operand) ? [op(OpCode.ResolveScope)] : []),
                    op(OpCode.PostFixMinusMinus)
                ]
        }
    }
}
