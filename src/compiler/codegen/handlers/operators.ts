import * as ts from 'typescript'

import { OpCode } from '../../shared'
import { abort, getNameOfKind, headOf, op } from '../helpers'
import { generateAssignmentPattern } from '../binding-patterns'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

function needsResolveScope(node: ts.Node, ctx: CodegenContext): boolean {
    let current: ts.Node | undefined = node

    while (current) {
        const parent: ts.Node | undefined = ctx.parentMap.get(current)?.node
        if (parent != null && ts.isWithStatement(parent) && parent.statement === current) {
            return true
        }
        current = parent
    }

    return false
}

type CompoundAssignmentOpcode =
    OpCode.BPlusEqual |
    OpCode.BMinusEqual |
    OpCode.BSlashEqual |
    OpCode.BAsteriskEqual |
    OpCode.BGreaterThanGreaterThanGreaterThanEqual

type CompoundAssignmentBinaryOpcode =
    OpCode.BPercent |
    OpCode.BAmpersand |
    OpCode.BBar |
    OpCode.BCaret |
    OpCode.BLessThanLessThan |
    OpCode.BGreaterThanGreaterThan |
    OpCode.BAsteriskAsterisk

type StaticCompoundAssignmentOpcode =
    OpCode.BPlusEqualStatic |
    OpCode.BPlusEqualStaticUnchecked |
    OpCode.BMinusEqualStatic |
    OpCode.BMinusEqualStaticUnchecked |
    OpCode.BSlashEqualStatic |
    OpCode.BSlashEqualStaticUnchecked |
    OpCode.BAsteriskEqualStatic |
    OpCode.BAsteriskEqualStaticUnchecked |
    OpCode.BGreaterThanGreaterThanGreaterThanEqualStatic |
    OpCode.BGreaterThanGreaterThanGreaterThanEqualStaticUnchecked

const getCompoundAssignmentOpcode = (kind: ts.SyntaxKind): CompoundAssignmentOpcode | undefined => ({
    [ts.SyntaxKind.PlusEqualsToken]: OpCode.BPlusEqual,
    [ts.SyntaxKind.MinusEqualsToken]: OpCode.BMinusEqual,
    [ts.SyntaxKind.SlashEqualsToken]: OpCode.BSlashEqual,
    [ts.SyntaxKind.AsteriskEqualsToken]: OpCode.BAsteriskEqual,
    [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken]: OpCode.BGreaterThanGreaterThanGreaterThanEqual,
} as Partial<Record<ts.SyntaxKind, CompoundAssignmentOpcode>>)[kind]

const getCompoundAssignmentBinaryOpcode = (kind: ts.SyntaxKind): CompoundAssignmentBinaryOpcode | undefined => ({
    [ts.SyntaxKind.PercentEqualsToken]: OpCode.BPercent,
    [ts.SyntaxKind.AmpersandEqualsToken]: OpCode.BAmpersand,
    [ts.SyntaxKind.BarEqualsToken]: OpCode.BBar,
    [ts.SyntaxKind.CaretEqualsToken]: OpCode.BCaret,
    [ts.SyntaxKind.LessThanLessThanEqualsToken]: OpCode.BLessThanLessThan,
    [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken]: OpCode.BGreaterThanGreaterThan,
    [ts.SyntaxKind.AsteriskAsteriskEqualsToken]: OpCode.BAsteriskAsterisk,
} as Partial<Record<ts.SyntaxKind, CompoundAssignmentBinaryOpcode>>)[kind]

const getStaticCompoundAssignmentOpcode = (kind: ts.SyntaxKind, unchecked: boolean): StaticCompoundAssignmentOpcode | undefined => {
    switch (kind) {
        case ts.SyntaxKind.PlusEqualsToken:
            return unchecked ? OpCode.BPlusEqualStaticUnchecked : OpCode.BPlusEqualStatic
        case ts.SyntaxKind.MinusEqualsToken:
            return unchecked ? OpCode.BMinusEqualStaticUnchecked : OpCode.BMinusEqualStatic
        case ts.SyntaxKind.SlashEqualsToken:
            return unchecked ? OpCode.BSlashEqualStaticUnchecked : OpCode.BSlashEqualStatic
        case ts.SyntaxKind.AsteriskEqualsToken:
            return unchecked ? OpCode.BAsteriskEqualStaticUnchecked : OpCode.BAsteriskEqualStatic
        case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
            return unchecked ? OpCode.BGreaterThanGreaterThanGreaterThanEqualStaticUnchecked : OpCode.BGreaterThanGreaterThanGreaterThanEqualStatic
        default:
            return undefined
    }
}

const generateDiscardReferenceKeepValue = (): Segment => [
    op(OpCode.Swap),
    op(OpCode.Pop),
    op(OpCode.Swap),
    op(OpCode.Pop),
]

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
                const plusOperand = ctx.extractQuote(node.operand)
                if (ts.isIdentifier(plusOperand)) {
                    const staticAccess = ctx.tryResolveStaticAccess(plusOperand, plusOperand.text)
                    if (staticAccess) {
                        return [
                            ...ctx.generateStaticAccessOps(staticAccess),
                            op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.PrefixPlusPlusStaticUnchecked : OpCode.PrefixPlusPlusStatic)
                        ]
                    }
                }
                return [
                    ...ctx.generateLeft(node.operand, flag),
                    ...(ts.isIdentifier(plusOperand) && needsResolveScope(plusOperand, ctx) ? [op(OpCode.ResolveScope)] : []),
                    op(OpCode.PrefixPlusPlus)
                ]
            case ts.SyntaxKind.MinusMinusToken:
                const minusOperand = ctx.extractQuote(node.operand)
                if (ts.isIdentifier(minusOperand)) {
                    const staticAccess = ctx.tryResolveStaticAccess(minusOperand, minusOperand.text)
                    if (staticAccess) {
                        return [
                            ...ctx.generateStaticAccessOps(staticAccess),
                            op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.PrefixMinusMinusStaticUnchecked : OpCode.PrefixMinusMinusStatic)
                        ]
                    }
                }
                return [
                    ...ctx.generateLeft(node.operand, flag),
                    ...(ts.isIdentifier(minusOperand) && needsResolveScope(minusOperand, ctx) ? [op(OpCode.ResolveScope)] : []),
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
            case ts.SyntaxKind.QuestionQuestionToken: {
                const left = ctx.generate(node.left, flag)
                const right = ctx.generate(node.right, flag)
                const exit = [op(OpCode.Nop, 0)]

                return [
                    ...left,
                    op(OpCode.NodeOffset, 2, [headOf(exit)]),
                    op(OpCode.DuplicateSecond),
                    op(OpCode.NullLiteral),
                    op(OpCode.BEqualsEquals),
                    op(OpCode.JumpIfNot),

                    op(OpCode.Pop),
                    ...right,

                    ...exit
                ]
            }
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
        if (
            kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
            kind === ts.SyntaxKind.BarBarEqualsToken ||
            kind === ts.SyntaxKind.QuestionQuestionEqualsToken
        ) {
            const left = ctx.extractQuote(node.left)
            if (
                ts.isPropertyAccessExpression(left) ||
                ts.isElementAccessExpression(left) ||
                ts.isIdentifier(left) ||
                left.kind === ts.SyntaxKind.ThisKeyword
            ) {
                const shouldResolveIdentifier = ts.isIdentifier(left)
                const shortCircuit = [op(OpCode.Nop, 0), ...generateDiscardReferenceKeepValue()]
                const exit = [op(OpCode.Nop, 0)]
                const conditionOps =
                    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken
                        ? [op(OpCode.DuplicateSecond), op(OpCode.JumpIfNot)]
                        : kind === ts.SyntaxKind.BarBarEqualsToken
                            ? [op(OpCode.DuplicateSecond), op(OpCode.JumpIf)]
                            : [
                                op(OpCode.DuplicateSecond),
                                op(OpCode.NullLiteral),
                                op(OpCode.BEqualsEquals),
                                op(OpCode.JumpIfNot),
                            ]
                return [
                    ...ctx.generateLeft(node.left, flag),
                    ...(shouldResolveIdentifier ? [op(OpCode.ResolveScopeGetValue)] : [op(OpCode.GetKeepCtx)]),
                    op(OpCode.NodeOffset, 2, [headOf(shortCircuit)]),
                    ...conditionOps,
                    op(OpCode.Pop),
                    ...ctx.generate(node.right, flag),
                    op(OpCode.Set),
                    op(OpCode.NodeOffset, 2, [headOf(exit)]),
                    op(OpCode.Jump),
                    ...shortCircuit,
                    ...exit
                ]
            }

            return [
                ...ctx.generate(left, flag),
                op(OpCode.Literal, 2, ['Invalid left-hand side in assignment']),
                op(OpCode.ThrowReferenceError)
            ]
        }
    }

    if (ts.isBinaryExpression(node)) {
        const kind = node.operatorToken.kind
        const compoundAssignmentOpcode = getCompoundAssignmentOpcode(kind)
        const compoundAssignmentBinaryOpcode = getCompoundAssignmentBinaryOpcode(kind)
        switch (kind) {
            case ts.SyntaxKind.PlusEqualsToken:
            case ts.SyntaxKind.MinusEqualsToken:
            case ts.SyntaxKind.SlashEqualsToken:
            case ts.SyntaxKind.AsteriskEqualsToken:
            case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
            case ts.SyntaxKind.PercentEqualsToken:
            case ts.SyntaxKind.AmpersandEqualsToken:
            case ts.SyntaxKind.BarEqualsToken:
            case ts.SyntaxKind.CaretEqualsToken:
            case ts.SyntaxKind.LessThanLessThanEqualsToken:
            case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
            case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
            case ts.SyntaxKind.EqualsToken: {
                const left = ctx.extractQuote(node.left)
                if (kind === ts.SyntaxKind.EqualsToken && (ts.isArrayLiteralExpression(left) || ts.isObjectLiteralExpression(left))) {
                    return generateAssignmentPattern(left, ctx.generate(node.right, flag), flag, ctx, { preserveResult: true })
                }

                if (ts.isIdentifier(left)) {
                    const staticAccess = ctx.tryResolveStaticAccess(left, left.text)
                    if (staticAccess) {
                        if (kind === ts.SyntaxKind.EqualsToken) {
                            return [
                                ...ctx.generate(node.right, flag),
                                ...ctx.generateStaticAccessOps(staticAccess),
                                op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.SetStaticUnchecked : OpCode.SetStatic)
                            ]
                        }

                        const staticOpcode = getStaticCompoundAssignmentOpcode(kind, ctx.isStaticAccessUnchecked(staticAccess))
                        if (staticOpcode !== undefined) {
                            return [
                                ...ctx.generateStaticAccessOps(staticAccess),
                                op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.GetStaticUncheckedKeepCtx : OpCode.GetStaticKeepCtx),
                                ...ctx.generate(node.right, flag),
                                op(staticOpcode)
                            ]
                        }
                    }
                }

                if (
                    ts.isPropertyAccessExpression(left) ||
                    ts.isElementAccessExpression(left) ||
                    ts.isIdentifier(left) ||
                    left.kind === ts.SyntaxKind.ThisKeyword
                ) {
                    const shouldResolveIdentifier = ts.isIdentifier(left)
                    const assignmentOps =
                        kind === ts.SyntaxKind.EqualsToken
                            ? [op(OpCode.Set)]
                            : compoundAssignmentOpcode !== undefined
                                ? [op(compoundAssignmentOpcode)]
                                : [
                                    op(compoundAssignmentBinaryOpcode ?? abort('Why Am I here?')),
                                    op(OpCode.Set),
                                ]
                    return [
                        ...ctx.generateLeft(node.left, flag),
                        ...(kind === ts.SyntaxKind.EqualsToken
                            ? shouldResolveIdentifier
                                ? [op(OpCode.ResolveScope)]
                                : []
                            : shouldResolveIdentifier
                                ? [op(OpCode.ResolveScopeGetValue)]
                                : [op(OpCode.GetKeepCtx)]),
                        ...ctx.generate(node.right, flag),
                        ...assignmentOps
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
            case ts.SyntaxKind.AsteriskAsteriskToken:
                ops.push(op(OpCode.BAsteriskAsterisk)); break
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
                const plusOperand = ctx.extractQuote(node.operand)
                if (ts.isIdentifier(plusOperand)) {
                    const staticAccess = ctx.tryResolveStaticAccess(plusOperand, plusOperand.text)
                    if (staticAccess) {
                        return [
                            ...ctx.generateStaticAccessOps(staticAccess),
                            op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.PostFixPlusPLusStaticUnchecked : OpCode.PostFixPlusPLusStatic)
                        ]
                    }
                }
                return [
                    ...ctx.generateLeft(node.operand, flag),
                    ...(ts.isIdentifier(plusOperand) && needsResolveScope(plusOperand, ctx) ? [op(OpCode.ResolveScope)] : []),
                    op(OpCode.PostFixPlusPLus)
                ]
            case ts.SyntaxKind.MinusMinusToken:
                const minusOperand = ctx.extractQuote(node.operand)
                if (ts.isIdentifier(minusOperand)) {
                    const staticAccess = ctx.tryResolveStaticAccess(minusOperand, minusOperand.text)
                    if (staticAccess) {
                        return [
                            ...ctx.generateStaticAccessOps(staticAccess),
                            op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.PostFixMinusMinusStaticUnchecked : OpCode.PostFixMinusMinusStatic)
                        ]
                    }
                }
                return [
                    ...ctx.generateLeft(node.operand, flag),
                    ...(ts.isIdentifier(minusOperand) && needsResolveScope(minusOperand, ctx) ? [op(OpCode.ResolveScope)] : []),
                    op(OpCode.PostFixMinusMinus)
                ]
        }
    }
}
