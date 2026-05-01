import * as ts from 'typescript'

import { extractVariable } from '../../analysis'
import { OpCode, SetFlag, SpecialVariable, StatementFlag } from '../../shared'
import { generateAssignmentPattern, generateBindingInitialization } from '../binding-patterns'
import { headOf, markInternals, op, generateEnterScope, generateIteratorClose, generateLeaveScope } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

type LoopScopeCopyItem = {
    name: string
    flags: number
}

const generateLoopEvalResultReset = (flag: number): Segment =>
    flag & StatementFlag.Eval && !(flag & StatementFlag.Finally)
        ? [op(OpCode.UndefinedLiteral), op(OpCode.SetEvalResult), op(OpCode.Pop)]
        : []

function generateProtectedForOfEntryBinding(body: Segment, ctx: CodegenContext): Segment {
    const catchName = ctx.allocateInternalName('forOf.error')
    const catchEntry = op(OpCode.Nop, 0)
    const exit = op(OpCode.Nop, 0)

    return [
        op(OpCode.NodeOffset, 2, [exit]),
        op(OpCode.NodeOffset, 2, [catchEntry]),
        op(OpCode.Literal, 2, [-1]),
        op(OpCode.Literal, 2, [catchName]),
        op(OpCode.InitTryCatch),
        ...body,
        op(OpCode.ExitTryCatchFinally),
        catchEntry,
        ...generateIteratorClose(true),
        op(OpCode.GetRecord),
        op(OpCode.Literal, 2, [catchName]),
        op(OpCode.Get),
        op(OpCode.Throw),
        exit,
    ]
}

function generateLoopScopeCopy(node: ts.Node, items: LoopScopeCopyItem[], ctx: CodegenContext): Segment {
    const staticItems = items.map((item) => ({
        ...item,
        access: ctx.tryResolveStaticAccess(node, item.name),
    }))

    if (staticItems.every((item) => item.access != null)) {
        return [
            ...staticItems.flatMap(({ access }) => [
                ...ctx.generateStaticAccessOps(access!),
                op(ctx.isStaticAccessUnchecked(access!) ? OpCode.GetStaticUnchecked : OpCode.GetStatic),
            ]),
            ...generateLeaveScope(),
            ...generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName),
            ...[...staticItems].reverse().flatMap(({ access, flags }) => [
                ...ctx.generateStaticAccessOps(access!),
                op(OpCode.SetInitializedStatic),
                op(OpCode.Pop),
                ...((flags & SetFlag.Freeze)
                    ? [
                        ...ctx.generateStaticAccessOps(access!),
                        op(OpCode.FreezeVariableStatic),
                    ]
                    : []),
            ]),
        ]
    }

    return [
        ...items.flatMap(({ name, flags }) => [
            op(OpCode.Literal, 2, [name]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [name]),
            op(OpCode.Get),
            op(OpCode.Literal, 2, [flags]),
        ]),
        op(OpCode.Literal, 2, [items.length]),
        ...generateLeaveScope(),
        ...generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName),
        op(OpCode.GetRecord),
        op(OpCode.SetMultiple),
    ]
}

function generateLoopScopeStaticAccess(node: ts.Node, name: string, ctx: CodegenContext): Segment {
    const names = [...(ctx.scopes.get(node)?.keys() ?? [])].reverse()
    const index = names.indexOf(name)
    if (index < 0) {
        throw new Error('missing loop scope binding: ' + name)
    }

    return [
        op(OpCode.Literal, 2, [0]),
        op(OpCode.Literal, 2, [index]),
    ]
}

export function generateLoops(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined {
    if (ts.isForStatement(node)) {
        const nextOp = op(OpCode.Nop, 0)
        ctx.nextOps.set(node, nextOp)

        const continueOp = op(OpCode.Nop, 0)
        ctx.continueOps.set(node, continueOp)

        const initializer = node.initializer
        const condition = node.condition
        const incrementor = node.incrementor
        const hasScope = ctx.scopes.has(node) && ctx.scopes.get(node)!.size > 0

        const entry0 = hasScope
            ? generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName)
            : [op(OpCode.Nop, 0)]

        const entry1 = initializer
            ? ts.isVariableDeclarationList(initializer)
                ? ctx.generate(initializer, flag)
                : [
                    ...ctx.generate(initializer, flag),
                    op(OpCode.Pop)
                ]
            : [op(OpCode.Nop, 0)]

        const exit = hasScope
            ? generateLeaveScope()
            : [op(OpCode.Nop, 0)]

        const conditionS = condition
            ? [
                op(OpCode.NodeOffset, 2, [headOf(exit)]),
                ...ctx.generate(condition, flag),
                op(OpCode.JumpIfNot)
            ]
            : [
                op(OpCode.Nop, 0)
            ]

        const update0: Segment = []

        if (hasScope && initializer && ts.isVariableDeclarationList(initializer)) {
            const copyItems: LoopScopeCopyItem[] = []

            for (const item of initializer.declarations) {
                for (const name of extractVariable(item.name)) {
                    copyItems.push({
                        name: name.text,
                        flags: SetFlag.DeTDZ | ((initializer.flags & ts.NodeFlags.Const) ? SetFlag.Freeze : 0),
                    })
                }
            }

            update0.push(...generateLoopScopeCopy(node, copyItems, ctx))
        }

        const update1 = incrementor
            ? [
                ...ctx.generate(incrementor, flag),
                op(OpCode.Pop),
                op(OpCode.NodeOffset, 2, [headOf(conditionS)]),
                op(OpCode.Jump)
            ]
            : [
                op(OpCode.NodeOffset, 2, [headOf(conditionS)]),
                op(OpCode.Jump)
            ]

        const body = ctx.generate(node.statement, flag)

        return [
            ...generateLoopEvalResultReset(flag),
            ...markInternals(entry0),
            ...entry1,
            ...conditionS,
            ...body,
            continueOp,
            ...markInternals(update0),
            ...update1,
            ...exit,
            nextOp
        ]
    }

    if (ts.isWhileStatement(node)) {
        const nextOp = op(OpCode.Nop, 0)
        ctx.nextOps.set(node, nextOp)

        const continueOp = op(OpCode.Nop, 0)
        ctx.continueOps.set(node, continueOp)

        const exit = [
            op(OpCode.Nop, 0)
        ]
        const head = [
            op(OpCode.NodeOffset, 2, [exit[0]]),
            ...ctx.generate(node.expression, flag),
            op(OpCode.JumpIfNot)
        ]
        const body = [
            ...ctx.generate(node.statement, flag),
            op(OpCode.NodeOffset, 2, [head[0]]),
            op(OpCode.Jump)
        ]

        return [
            ...generateLoopEvalResultReset(flag),
            continueOp,
            ...head,
            ...body,
            ...exit,
            nextOp
        ]
    }

    if (ts.isDoStatement(node)) {
        const nextOp = op(OpCode.Nop, 0)
        ctx.nextOps.set(node, nextOp)

        const continueOp = op(OpCode.Nop, 0)
        ctx.continueOps.set(node, continueOp)

        const bodyOps = ctx.generate(node.statement, flag)
        const body = bodyOps.length === 0 ? [op(OpCode.Nop, 0)] : bodyOps
        const tail = [
            op(OpCode.NodeOffset, 2, [body[0]]),
            ...ctx.generate(node.expression, flag),
            op(OpCode.JumpIf)
        ]

        return [
            ...generateLoopEvalResultReset(flag),
            ...body,
            continueOp,
            ...tail,
            nextOp
        ]
    }

    if (ts.isForInStatement(node)) {
        const nextOp = op(OpCode.Nop, 0)
        ctx.nextOps.set(node, nextOp)

        const continueOp = op(OpCode.Nop, 0)
        ctx.continueOps.set(node, continueOp)

        const hasVariable = ts.isVariableDeclarationList(node.initializer) && (node.initializer.flags & ts.NodeFlags.BlockScoped)
        const variableIsConst =
            ts.isVariableDeclarationList(node.initializer)
                ? (node.initializer.flags & ts.NodeFlags.Const)
                : 0
        const variableNames =
            ts.isVariableDeclarationList(node.initializer)
                ? extractVariable(node.initializer.declarations[0].name).map((name) => name.text)
                : []
        const declarationName =
            ts.isVariableDeclarationList(node.initializer)
                ? node.initializer.declarations[0].name
                : null

        const enter = generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName)
        const leave = generateLeaveScope()

        const getLhs = () => {
            if (ts.isVariableDeclarationList(node.initializer)) {
                return ctx.generateLeft(node.initializer.declarations[0].name, flag)
            }
            return ctx.generateLeft(node.initializer, flag)
        }

        const generateEntryBinding = () => {
            const entryValue = [
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [SpecialVariable.IteratorEntry]),
                op(OpCode.Get),
                op(OpCode.EntryGetValue),
            ]

            if (declarationName && !ts.isIdentifier(declarationName)) {
                return generateBindingInitialization(
                    declarationName,
                    entryValue,
                    flag,
                    ctx,
                    { freezeConst: !!variableIsConst }
                )
            }

            if (declarationName && ts.isIdentifier(declarationName)) {
                return ctx.generateIdentifierWrite(declarationName, entryValue, flag, {
                    mode: 'initialize',
                    freezeConst: !!variableIsConst,
                })
            }

            if (!ts.isVariableDeclarationList(node.initializer)) {
                const assignmentTarget = ctx.extractQuote(node.initializer)
                if (ts.isArrayLiteralExpression(assignmentTarget) || ts.isObjectLiteralExpression(assignmentTarget)) {
                    return generateAssignmentPattern(assignmentTarget, entryValue, flag, ctx)
                }
                if (ts.isIdentifier(assignmentTarget)) {
                    return ctx.generateIdentifierWrite(assignmentTarget, entryValue, flag, { mode: 'assign' })
                }
            }

            return [
                ...getLhs(),
                ...entryValue,
                op(OpCode.Set),
                op(OpCode.Pop),
                ...(variableIsConst
                    ? [
                        ...getLhs(),
                        op(OpCode.FreezeVariable),
                        op(OpCode.Pop),
                        op(OpCode.Pop)
                    ]
                    : []
                ),
            ]
        }

        const head = [
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            ...[
                ...ctx.generate(node.expression, flag),
                op(OpCode.GetPropertyIterator),
            ],
            op(OpCode.Set),
            op(OpCode.Pop)
        ]

        const condition = [
            op(OpCode.NodeOffset, 2, [leave[0]]),
            ...[
                ...[
                    op(OpCode.GetRecord),
                    op(OpCode.Literal, 2, [SpecialVariable.IteratorEntry]),
                    ...[
                        op(OpCode.GetRecord),
                        op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
                        op(OpCode.Get),
                        op(OpCode.NextEntry)
                    ],
                    op(OpCode.Set),
                ],
                op(OpCode.EntryIsDone),
            ],
            op(OpCode.JumpIf),
            ...generateEntryBinding(),
        ]

        const body = ctx.generate(node.statement, flag)

        const continueOrLeave = [
            ...generateLoopScopeCopy(node, [
                { name: SpecialVariable.LoopIterator, flags: SetFlag.DeTDZ },
                ...(hasVariable ? variableNames.map((name) => ({ name, flags: SetFlag.DeTDZ })) : []),
            ], ctx),
            op(OpCode.NodeOffset, 2, [headOf(condition)]),
            op(OpCode.Jump)
        ]

        return [
            ...generateLoopEvalResultReset(flag),
            ...enter,
            ...head,
            ...condition,
            ...body,
            continueOp,
            ...continueOrLeave,
            ...leave,
            nextOp
        ]
    }

    if (ts.isForOfStatement(node)) {
        const nextOp = op(OpCode.Nop, 0)
        ctx.nextOps.set(node, nextOp)

        const continueOp = op(OpCode.Nop, 0)
        ctx.continueOps.set(node, continueOp)

        const hasVariable = ts.isVariableDeclarationList(node.initializer) && !!(node.initializer.flags & ts.NodeFlags.BlockScoped)
        const variableIsConst =
            ts.isVariableDeclarationList(node.initializer)
                ? !!(node.initializer.flags & ts.NodeFlags.Const)
                : false
        const variableNames =
            ts.isVariableDeclarationList(node.initializer)
                ? extractVariable(node.initializer.declarations[0].name).map((name) => name.text)
                : []
        const declarationName =
            ts.isVariableDeclarationList(node.initializer)
                ? node.initializer.declarations[0].name
                : null

        const enter = generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName)
        const leave = generateLeaveScope()

        const getLhs = () => {
            if (ts.isVariableDeclarationList(node.initializer)) {
                return ctx.generateLeft(node.initializer.declarations[0].name, flag)
            }
            return ctx.generateLeft(node.initializer, flag)
        }

        const generateEntryBinding = () => {
            const entryValue = [
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [SpecialVariable.IteratorEntry]),
                op(OpCode.Get),
            ]

            if (declarationName && !ts.isIdentifier(declarationName)) {
                return generateBindingInitialization(
                    declarationName,
                    entryValue,
                    flag,
                    ctx,
                    { freezeConst: variableIsConst }
                )
            }

            if (declarationName && ts.isIdentifier(declarationName)) {
                return ctx.generateIdentifierWrite(declarationName, entryValue, flag, {
                    mode: 'initialize',
                    freezeConst: variableIsConst,
                })
            }

            if (!ts.isVariableDeclarationList(node.initializer)) {
                const assignmentTarget = ctx.extractQuote(node.initializer)
                if (ts.isArrayLiteralExpression(assignmentTarget) || ts.isObjectLiteralExpression(assignmentTarget)) {
                    return generateAssignmentPattern(assignmentTarget, entryValue, flag, ctx)
                }
                if (ts.isIdentifier(assignmentTarget)) {
                    return ctx.generateIdentifierWrite(assignmentTarget, entryValue, flag, { mode: 'assign' })
                }
            }

            return [
                ...getLhs(),
                ...entryValue,
                op(OpCode.Set),
                op(OpCode.Pop),
                ...(variableIsConst
                    ? [
                        ...getLhs(),
                        op(OpCode.FreezeVariable),
                        op(OpCode.Pop),
                        op(OpCode.Pop)
                    ]
                    : []
                ),
            ]
        }

        const head = hasVariable
            ? [
                ...generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName),
                ...ctx.generate(node.expression, flag),
                ...generateLeaveScope(),
                op(OpCode.GetIterator),
                ...enter,
                ...generateLoopScopeStaticAccess(node, SpecialVariable.LoopIterator, ctx),
                op(OpCode.SetInitializedStatic),
                op(OpCode.Pop)
            ]
            : [
                ...enter,
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
                ...ctx.generate(node.expression, flag),
                op(OpCode.GetIterator),
                op(OpCode.Set),
                op(OpCode.Pop)
            ]

        const condition = [
            op(OpCode.NodeOffset, 2, [leave[0]]),
            ...[
                ...[
                    op(OpCode.GetRecord),
                    op(OpCode.Literal, 2, [SpecialVariable.IteratorEntry]),
                    ...[
                        op(OpCode.GetRecord),
                        op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
                        op(OpCode.Get),
                        op(OpCode.IteratorNext),
                    ],
                    op(OpCode.Set),
                ],
                op(OpCode.EntryIsDone),
            ],
            op(OpCode.JumpIf),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.IteratorEntry]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.IteratorEntry]),
            op(OpCode.Get),
            op(OpCode.Literal, 2, ['value']),
            op(OpCode.Get),
            op(OpCode.Set),
            op(OpCode.Pop),
            ...generateProtectedForOfEntryBinding(generateEntryBinding(), ctx),
        ]

        const body = ctx.generate(node.statement, flag)

        const continueOrLeave = [
            ...generateLoopScopeCopy(node, [
                { name: SpecialVariable.LoopIterator, flags: SetFlag.DeTDZ },
                ...(hasVariable ? variableNames.map((name) => ({ name, flags: SetFlag.DeTDZ })) : []),
            ], ctx),
            op(OpCode.NodeOffset, 2, [headOf(condition)]),
            op(OpCode.Jump)
        ]

        return [
            ...generateLoopEvalResultReset(flag),
            ...head,
            ...condition,
            ...body,
            continueOp,
            ...continueOrLeave,
            ...leave,
            nextOp
        ]
    }
}
