import * as ts from 'typescript'

import { OpCode, SpecialVariable } from '../../shared'
import { generateClassValue } from './classes'
import { generateFunctionDefinitionWithStackName } from './functions'
import { headOf, op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

type ArrayLikeElement = ts.Expression | ts.SpreadElement | ts.OmittedExpression

type ObjectPropertyKey = {
    ops: Segment
    computed: boolean
    staticName?: string
}

function getStaticPropertyName(name: ts.Identifier | ts.StringLiteral | ts.NumericLiteral): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        return name.text
    }
    return String(Number(name.text))
}

function generateObjectPropertyKey(name: ts.PropertyName, flag: number, ctx: CodegenContext): ObjectPropertyKey {
    if (ts.isComputedPropertyName(name)) {
        return {
            ops: [
                ...ctx.generate(name.expression, flag),
                op(OpCode.ToPropertyKey),
            ],
            computed: true,
        }
    }

    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        const staticName = getStaticPropertyName(name)
        return {
            ops: [op(OpCode.Literal, 2, [staticName])],
            computed: false,
            staticName,
        }
    }

    throw new Error('not supported')
}

function unwrapParenthesizedExpression(node: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(node)) {
        node = node.expression
    }
    return node
}

function generateOptionalAccess(
    node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    flag: number,
    ctx: CodegenContext
): Segment | undefined {
    if (node.questionDotToken == null) {
        return undefined
    }

    const shortCircuit = [
        op(OpCode.Nop, 0),
        op(OpCode.Pop),
        op(OpCode.UndefinedLiteral),
    ]
    const exit = [op(OpCode.Nop, 0)]
    const nameOps = ts.isPropertyAccessExpression(node)
        ? [op(OpCode.Literal, 2, [node.name.text])]
        : node.argumentExpression == null
            ? [op(OpCode.UndefinedLiteral)]
            : ctx.generate(node.argumentExpression, flag)

    return [
        ...ctx.generate(node.expression, flag),
        op(OpCode.NodeOffset, 2, [headOf(shortCircuit)]),
        op(OpCode.DuplicateSecond),
        op(OpCode.NullLiteral),
        op(OpCode.BEqualsEquals),
        op(OpCode.JumpIf),
        ...nameOps,
        op(OpCode.Get),
        op(OpCode.NodeOffset, 2, [headOf(exit)]),
        op(OpCode.Jump),
        ...shortCircuit,
        ...exit,
    ]
}

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
            res.push(op(OpCode.Duplicate))
            res.push(op(OpCode.Literal, 2, ['length']))
            res.push(op(OpCode.GetKeepCtx))
            res.push(op(OpCode.Literal, 2, [1]))
            res.push(op(OpCode.BPlus))
            res.push(op(OpCode.SetKeepCtx))
            res.push(op(OpCode.Pop))
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
            res.push(op(OpCode.DefineKeepCtx))
        } else {
            res.push(op(OpCode.Literal, 2, [nextIndex++]))
            res.push(...ctx.generate(element, flag))
            res.push(op(OpCode.DefineKeepCtx))
        }
    }
}

function generateArgumentArray(args: readonly ts.Expression[], flag: number, ctx: CodegenContext): Segment {
    const res: Segment = [op(OpCode.ArrayLiteral)]
    appendArrayElements(res, args, flag, ctx)
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

        return res
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
        const needsResolvedCall = ts.isIdentifier(self) && needsResolveScope(self, ctx)

        return [
            ...leftOps,
            ...(needsResolvedCall ? [op(OpCode.ResolveScopeGetValue)] : [op(OpCode.GetKeepCtx)]),
            ...args,
            op(OpCode.Literal, 2, [argCount]),
            isEval
                ? op(OpCode.CallAsEvalResolved)
                : op(OpCode.CallResolved)
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
                const needsResolvedCall = ts.isIdentifier(self) && needsResolveScope(self, ctx)

                return [
                    ...leftOps,
                    ...(needsResolvedCall ? [op(OpCode.ResolveScopeGetValue)] : [op(OpCode.GetKeepCtx)]),
                    ...generateArgumentArray(node.arguments, flag, ctx),
                    op(OpCode.ExpandArgumentArray),
                    isEval
                        ? op(OpCode.CallAsEvalResolved)
                        : op(OpCode.CallResolved)
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
            if (ts.isSpreadAssignment(item)) {
                res.push(...ctx.generate(item.expression, flag))
                res.push(op(OpCode.ObjectSpread))
                continue
            }

            if (ts.isShorthandPropertyAssignment(item)) {
                res.push(op(OpCode.Literal, 2, [item.name.text]))
                res.push(...ctx.generate(item.name, flag))
                res.push(op(OpCode.DefineKeepCtx))
                continue
            }

            if (!item.name) {
                throw new Error('property must have name')
            }

            const propertyKey = generateObjectPropertyKey(item.name, flag, ctx)
            if (
                ts.isPropertyAssignment(item)
                && !propertyKey.computed
                && propertyKey.staticName === '__proto__'
            ) {
                res.push(...ctx.generate(item.initializer, flag))
                res.push(op(OpCode.SetPrototypeKeepCtx))
                continue
            }

            res.push(...propertyKey.ops)

            if (ts.isMethodDeclaration(item)) {
                res.push(op(OpCode.Duplicate))
                res.push(...generateFunctionDefinitionWithStackName(item))
                res.push(op(OpCode.Literal, 2, [1]))
                res.push(op(OpCode.DefineMethod))
            } else if (ts.isGetAccessorDeclaration(item)) {
                res.push(op(OpCode.Duplicate))
                res.push(...generateFunctionDefinitionWithStackName(item))
                res.push(op(OpCode.Literal, 2, [1]))
                res.push(op(OpCode.DefineGetter))
            } else if (ts.isSetAccessorDeclaration(item)) {
                res.push(op(OpCode.Duplicate))
                res.push(...generateFunctionDefinitionWithStackName(item))
                res.push(op(OpCode.Literal, 2, [1]))
                res.push(op(OpCode.DefineSetter))
            } else if (ts.isPropertyAssignment(item)) {
                const initializer = unwrapParenthesizedExpression(item.initializer)
                if (ts.isArrowFunction(initializer) || (ts.isFunctionExpression(initializer) && initializer.name == null)) {
                    res.push(op(OpCode.Duplicate))
                    res.push(...generateFunctionDefinitionWithStackName(initializer))
                } else if (ts.isClassExpression(initializer) && initializer.name == null) {
                    res.push(...generateClassValue(
                        initializer,
                        flag,
                        ctx,
                        propertyKey.staticName,
                        propertyKey.computed
                    ))
                } else {
                    res.push(...ctx.generate(item.initializer, flag))
                }
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

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        return generateOptionalAccess(node, flag, ctx) ?? [
            ...ctx.generateLeft(node, flag),
            op(OpCode.Get)
        ]
    }

    if (ts.isDeleteExpression(node)) {
        const unwrapped = ctx.extractQuote(node.expression)
        if (
            ts.isPropertyAccessExpression(unwrapped)
            || ts.isElementAccessExpression(unwrapped)
            || ts.isIdentifier(unwrapped)
        ) {
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
