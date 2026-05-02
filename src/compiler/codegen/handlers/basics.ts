import * as ts from 'typescript'

import { findAncient } from '../../analysis'
import { OpCode, SpecialVariable, StatementFlag } from '../../shared'
import { generateBindingInitialization } from '../binding-patterns'
import { generateFunctionDefinition } from './functions'
import { generateEnterScope, generateIteratorClose, generateLeaveScope, markInternals, op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

function generateNamedInitializer(initializer: ts.Expression, name: string, ctx: CodegenContext): Segment | undefined {
    const rawInitializer = ctx.extractQuote(initializer)

    if (ts.isArrowFunction(rawInitializer)) {
        return generateFunctionDefinition(rawInitializer, name)
    }

    if (ts.isFunctionExpression(rawInitializer) && rawInitializer.name == null) {
        return generateFunctionDefinition(rawInitializer, name)
    }
}

function findContainingForOfWithoutInnerTry(node: ts.Node, ctx: CodegenContext): ts.ForOfStatement | null {
    const target = findAncient(node, ctx.parentMap, (ancestor) => {
        if (ts.isTryStatement(ancestor) || ctx.functions.has(ancestor as any)) {
            return true
        }
        return ts.isForOfStatement(ancestor)
    })
    return target != null && ts.isForOfStatement(target) ? target : null
}

function generateContainingForOfClose(node: ts.Node, ctx: CodegenContext, suppressErrors: boolean): Segment {
    return findContainingForOfWithoutInnerTry(node, ctx) == null
        ? []
        : generateIteratorClose(suppressErrors)
}

export function generateBasics(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined {
    switch (node.kind) {
        case ts.SyntaxKind.TrueKeyword:
            return [op(OpCode.Literal, 2, [true])]
        case ts.SyntaxKind.FalseKeyword:
            return [op(OpCode.Literal, 2, [false])]
        case ts.SyntaxKind.NullKeyword:
            return [op(OpCode.NullLiteral)]
        case ts.SyntaxKind.EmptyStatement:
            return [op(OpCode.Nop, 0)]
        case ts.SyntaxKind.ThisKeyword:
            return [
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [SpecialVariable.This]),
                op(OpCode.Get)
            ]
    }

    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.NewKeyword && node.name.text === 'target') {
        return [
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.NewTarget]),
            op(OpCode.Get)
        ]
    }

    if (ts.isIdentifier(node) && node.text === 'undefined') {
        return [op(OpCode.UndefinedLiteral)]
    }

    if (ts.isVariableDeclarationList(node)) {
        const ops: Segment = []

        for (const declaration of node.declarations) {
            if (!ts.isIdentifier(declaration.name)) {
                if (!declaration.initializer) {
                    throw new Error('not support pattern yet')
                }

                ops.push(...generateBindingInitialization(
                    declaration.name,
                    ctx.generate(declaration.initializer, flag),
                    flag,
                    ctx,
                    {
                        freezeConst: !!(node.flags & ts.NodeFlags.Const),
                    }
                ))
                continue
            }

            const staticAccess = ctx.tryResolveStaticAccess(declaration.name, declaration.name.text)

            if (declaration.initializer) {
                const initializer = generateNamedInitializer(
                    declaration.initializer,
                    declaration.name.text,
                    ctx
                ) ?? ctx.generate(declaration.initializer, flag)

                if (staticAccess) {
                    ops.push(...initializer)
                    ops.push(...ctx.generateStaticAccessOps(staticAccess))
                    ops.push(op(OpCode.SetInitializedStatic))
                } else {
                    ops.push(...ctx.generateLeft(declaration.name, flag))
                    ops.push(...initializer)
                    ops.push(op(OpCode.SetInitialized))
                }
                ops.push(op(OpCode.Pop))

                if (node.flags & ts.NodeFlags.Const) {
                    if (staticAccess) {
                        ops.push(...markInternals([
                            ...ctx.generateStaticAccessOps(staticAccess),
                            op(OpCode.FreezeVariableStatic),
                        ]))
                    } else {
                        ops.push(...markInternals([
                            ...ctx.generateLeft(declaration.name, flag),
                            op(OpCode.FreezeVariable),
                            op(OpCode.Pop),
                            op(OpCode.Pop),
                        ]))
                    }
                }
            } else if (node.flags & ts.NodeFlags.Let) {
                if (staticAccess) {
                    ops.push(...markInternals([
                        ...ctx.generateStaticAccessOps(staticAccess),
                        op(OpCode.DeTDZStatic),
                    ]))
                } else {
                    ops.push(
                        ...ctx.generateLeft(declaration.name, flag),
                        op(OpCode.DeTDZ),
                        op(OpCode.Pop),
                        op(OpCode.Pop)
                    )
                }
            }
        }

        return ops
    }

    if (ts.isVariableStatement(node)) {
        return ctx.generate(node.declarationList, flag)
    }

    if (ts.isStringLiteral(node)) {
        return [op(OpCode.Literal, 2, [node.text])]
    }

    if (ts.isExpressionStatement(node)) {
        if (flag & StatementFlag.Eval) {
            return [
                ...ctx.generate(node.expression, flag),
                op(OpCode.SetEvalResult),
                op(OpCode.Pop)
            ]
        }

        return [
            ...ctx.generate(node.expression, flag),
            op(OpCode.Pop)
        ]
    }

    if (ts.isNumericLiteral(node)) {
        return [op(OpCode.Literal, 2, [Number(node.text)])]
    }

    if (ts.isBigIntLiteral(node)) {
        return [op(OpCode.Literal, 2, [BigInt(node.text.slice(0, -1))])]
    }

    if (ts.isBlock(node)) {
        const variableCount = ctx.scopes.get(node)?.size ?? 0
        if (variableCount > 0) {
            return [
                ...generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName),
                ...node.statements.map((statement) => ctx.generate(statement, flag)).flat(),
                ...generateLeaveScope()
            ]
        }

        return [
            op(OpCode.Nop, 0),
            ...node.statements.map((statement) => ctx.generate(statement, flag)).flat()
        ]
    }

    if (ts.isIdentifier(node)) {
        return ctx.generateIdentifierGet(node)
    }

    if (ts.isReturnStatement(node)) {
        if (node.expression !== undefined) {
            return [
                ...ctx.generate(node.expression, flag),
                ...generateContainingForOfClose(node, ctx, false),
                (flag & StatementFlag.TryCatchFlags) ? op(OpCode.ReturnInTryCatchFinally) : op(OpCode.Return)
            ]
        }

        return [
            op(OpCode.UndefinedLiteral),
            ...generateContainingForOfClose(node, ctx, false),
            (flag & StatementFlag.TryCatchFlags) ? op(OpCode.ReturnInTryCatchFinally) : op(OpCode.Return)
        ]
    }

    if (ts.isParenthesizedExpression(node)) {
        return ctx.generate(node.expression, flag)
    }

    if (ts.isDebuggerStatement(node)) {
        return [op(OpCode.Debugger)]
    }
}
