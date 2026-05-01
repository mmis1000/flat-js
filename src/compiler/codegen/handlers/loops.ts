import * as ts from 'typescript'

import { extractVariable } from '../../analysis'
import { OpCode, SetFlag, SpecialVariable, VariableType } from '../../shared'
import { generateAssignmentPattern, generateBindingInitialization } from '../binding-patterns'
import { abort, headOf, markInternals, op, generateEnterScope, generateLeaveScope } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

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
            const copiedNames: string[] = []

            for (const item of initializer.declarations) {
                for (const name of extractVariable(item.name)) {
                    copiedNames.push(name.text)
                    update0.push(
                        op(OpCode.Literal, 2, [name.text]),
                        op(OpCode.GetRecord),
                        op(OpCode.Literal, 2, [name.text]),
                        op(OpCode.Get),
                        op(OpCode.Literal, 2, [SetFlag.DeTDZ | ((initializer.flags & ts.NodeFlags.Const) ? SetFlag.Freeze : 0)])
                    )
                }
            }

            update0.push(
                op(OpCode.Literal, 2, [copiedNames.length]),
                ...generateLeaveScope(),
                ...generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName),
                op(OpCode.GetRecord),
                op(OpCode.SetMultiple)
            )
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
                op(OpCode.SetInitialized),
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

        const continueOrLeave = hasVariable ? [
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.Get),

            op(OpCode.Literal, 2, [SetFlag.DeTDZ]),

            ...variableNames.flatMap((name) => [
                op(OpCode.Literal, 2, [name]),
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [name]),
                op(OpCode.Get),
                op(OpCode.Literal, 2, [SetFlag.DeTDZ]),
            ]),

            op(OpCode.Literal, 2, [1 + variableNames.length]),
            ...generateLeaveScope(),
            ...generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName),
            op(OpCode.GetRecord),
            op(OpCode.SetMultiple),

            op(OpCode.NodeOffset, 2, [headOf(condition)]),
            op(OpCode.Jump)
        ] : [
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.Get),

            op(OpCode.Literal, 2, [SetFlag.DeTDZ]),
            op(OpCode.Literal, 2, [1]),
            ...generateLeaveScope(),
            ...generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName),
            op(OpCode.GetRecord),
            op(OpCode.SetMultiple),

            op(OpCode.NodeOffset, 2, [headOf(condition)]),
            op(OpCode.Jump)
        ]

        return [
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
                op(OpCode.Literal, 2, ['value']),
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
                op(OpCode.SetInitialized),
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
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, ['Symbol']),
                op(OpCode.Get),
                op(OpCode.Literal, 2, ['iterator']),
                op(OpCode.Get),
                op(OpCode.Literal, 2, [0]),
                op(OpCode.Call),
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
                        op(OpCode.Literal, 2, ['next']),
                        op(OpCode.Literal, 2, [0]),
                        op(OpCode.Call),
                    ],
                    op(OpCode.Set),
                ],
                op(OpCode.Literal, 2, ['done']),
                op(OpCode.Get),
            ],
            op(OpCode.JumpIf),
            ...generateEntryBinding(),
        ]

        const body = ctx.generate(node.statement, flag)

        const continueOrLeave = hasVariable ? [
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.Get),
            op(OpCode.Literal, 2, [SetFlag.DeTDZ]),

            ...variableNames.flatMap((name) => [
                op(OpCode.Literal, 2, [name]),
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [name]),
                op(OpCode.Get),
                op(OpCode.Literal, 2, [SetFlag.DeTDZ]),
            ]),

            op(OpCode.Literal, 2, [1 + variableNames.length]),
            ...generateLeaveScope(),
            ...generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName),
            op(OpCode.GetRecord),
            op(OpCode.SetMultiple),

            op(OpCode.NodeOffset, 2, [headOf(condition)]),
            op(OpCode.Jump)
        ] : [
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.Get),
            op(OpCode.Literal, 2, [SetFlag.DeTDZ]),

            op(OpCode.Literal, 2, [1]),
            ...generateLeaveScope(),
            ...generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName),
            op(OpCode.GetRecord),
            op(OpCode.SetMultiple),

            op(OpCode.NodeOffset, 2, [headOf(condition)]),
            op(OpCode.Jump)
        ]

        return [
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
}
