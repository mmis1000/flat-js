import * as ts from 'typescript'

import { OpCode, SetFlag, SpecialVariable, VariableType } from '../../shared'
import { abort, attachJumpConsumer, headOf, markInternals, op, generateEnterScope, generateLeaveScope } from '../helpers'
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
            ? generateEnterScope(node, ctx.scopes)
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

        const conditionJumpIfNot = op(OpCode.JumpIfNot)

        const conditionS = condition
            ? [
                attachJumpConsumer(op(OpCode.NodeOffset, 2, [headOf(exit)]), conditionJumpIfNot),
                ...ctx.generate(condition, flag),
                conditionJumpIfNot
            ]
            : [
                op(OpCode.Nop, 0)
            ]

        const update0: Segment = []

        if (hasScope && initializer && ts.isVariableDeclarationList(initializer)) {
            for (const item of initializer.declarations) {
                if (!ts.isIdentifier(item.name)) {
                    throw new Error('not support')
                }

                update0.push(
                    op(OpCode.Literal, 2, [item.name.text]),
                    op(OpCode.GetRecord),
                    op(OpCode.Literal, 2, [item.name.text]),
                    op(OpCode.Get),
                    op(OpCode.Literal, 2, [SetFlag.DeTDZ | ((initializer.flags & ts.NodeFlags.Const) ? SetFlag.Freeze : 0)])
                )
            }

            update0.push(
                op(OpCode.Literal, 2, [initializer.declarations.length]),
                ...generateLeaveScope(),
                ...generateEnterScope(node, ctx.scopes),
                op(OpCode.GetRecord),
                op(OpCode.SetMultiple)
            )

            for (const item of initializer.declarations) {
                if (!ts.isIdentifier(item.name)) {
                    throw new Error('not support')
                }
            }
        }

        const updateJump = op(OpCode.Jump)

        const update1 = incrementor
            ? [
                ...ctx.generate(incrementor, flag),
                op(OpCode.Pop),
                attachJumpConsumer(op(OpCode.NodeOffset, 2, [headOf(conditionS)]), updateJump),
                updateJump
            ]
            : [
                attachJumpConsumer(op(OpCode.NodeOffset, 2, [headOf(conditionS)]), updateJump),
                updateJump
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
        const headJumpIfNot = op(OpCode.JumpIfNot)
        const head = [
            attachJumpConsumer(op(OpCode.NodeOffset, 2, [exit[0]]), headJumpIfNot),
            ...ctx.generate(node.expression, flag),
            headJumpIfNot
        ]
        const bodyJump = op(OpCode.Jump)
        const body = [
            ...ctx.generate(node.statement, flag),
            attachJumpConsumer(op(OpCode.NodeOffset, 2, [head[0]]), bodyJump),
            bodyJump
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
        const tailJumpIf = op(OpCode.JumpIf)
        const tail = [
            attachJumpConsumer(op(OpCode.NodeOffset, 2, [body[0]]), tailJumpIf),
            ...ctx.generate(node.expression, flag),
            tailJumpIf
        ]

        return [
            continueOp,
            ...body,
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
        const variableName =
            ts.isVariableDeclarationList(node.initializer)
                ? ts.isIdentifier(node.initializer.declarations[0].name)
                    ? node.initializer.declarations[0].name.text
                    : abort('Not a identifier')
                : ''

        const enter = generateEnterScope(node, ctx.scopes)
        const leave = generateLeaveScope()

        const getLhs = () => {
            if (ts.isVariableDeclarationList(node.initializer)) {
                return ctx.generateLeft(node.initializer.declarations[0].name, flag)
            }
            return ctx.generateLeft(node.initializer, flag)
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

        const conditionJumpIf = op(OpCode.JumpIf)

        const condition = [
            attachJumpConsumer(op(OpCode.NodeOffset, 2, [leave[0]]), conditionJumpIf),
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
            conditionJumpIf,

            ...getLhs(),

            ...[
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [SpecialVariable.IteratorEntry]),
                op(OpCode.Get),
                op(OpCode.EntryGetValue),
            ],

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

        const body = ctx.generate(node.statement, flag)
        const continueJump = op(OpCode.Jump)

        const continueOrLeave = hasVariable ? [
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.Get),

            op(OpCode.Literal, 2, [SetFlag.DeTDZ]),

            op(OpCode.Literal, 2, [variableName]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [variableName]),
            op(OpCode.Get),

            op(OpCode.Literal, 2, [SetFlag.DeTDZ]),

            op(OpCode.Literal, 2, [2]),
            ...generateLeaveScope(),
            ...generateEnterScope(node, ctx.scopes),
            op(OpCode.GetRecord),
            op(OpCode.SetMultiple),

            attachJumpConsumer(op(OpCode.NodeOffset, 2, [headOf(condition)]), continueJump),
            continueJump
        ] : [
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.Get),

            op(OpCode.Literal, 2, [SetFlag.DeTDZ]),
            op(OpCode.Literal, 2, [1]),
            ...generateLeaveScope(),
            ...generateEnterScope(node, ctx.scopes),
            op(OpCode.GetRecord),
            op(OpCode.SetMultiple),

            attachJumpConsumer(op(OpCode.NodeOffset, 2, [headOf(condition)]), continueJump),
            continueJump
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
        const variableName =
            ts.isVariableDeclarationList(node.initializer)
                ? ts.isIdentifier(node.initializer.declarations[0].name)
                    ? node.initializer.declarations[0].name.text
                    : abort('Not a identifier')
                : ''

        const enter = generateEnterScope(node, ctx.scopes)
        const leave = generateLeaveScope()

        const getLhs = () => {
            if (ts.isVariableDeclarationList(node.initializer)) {
                return ctx.generateLeft(node.initializer.declarations[0].name, flag)
            }
            return ctx.generateLeft(node.initializer, flag)
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

        const conditionJumpIf = op(OpCode.JumpIf)

        const condition = [
            attachJumpConsumer(op(OpCode.NodeOffset, 2, [leave[0]]), conditionJumpIf),
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
            conditionJumpIf,

            ...getLhs(),
            ...[
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [SpecialVariable.IteratorEntry]),
                op(OpCode.Get),
                op(OpCode.Literal, 2, ['value']),
                op(OpCode.Get),
            ],
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

        const body = ctx.generate(node.statement, flag)
        const continueJump = op(OpCode.Jump)

        const continueOrLeave = hasVariable ? [
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.Get),
            op(OpCode.Literal, 2, [SetFlag.DeTDZ]),

            op(OpCode.Literal, 2, [variableName]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [variableName]),
            op(OpCode.Get),
            op(OpCode.Literal, 2, [SetFlag.DeTDZ]),

            op(OpCode.Literal, 2, [2]),
            ...generateLeaveScope(),
            ...generateEnterScope(node, ctx.scopes),
            op(OpCode.GetRecord),
            op(OpCode.SetMultiple),

            attachJumpConsumer(op(OpCode.NodeOffset, 2, [headOf(condition)]), continueJump),
            continueJump
        ] : [
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.LoopIterator]),
            op(OpCode.Get),
            op(OpCode.Literal, 2, [SetFlag.DeTDZ]),

            op(OpCode.Literal, 2, [1]),
            ...generateLeaveScope(),
            ...generateEnterScope(node, ctx.scopes),
            op(OpCode.GetRecord),
            op(OpCode.SetMultiple),

            attachJumpConsumer(op(OpCode.NodeOffset, 2, [headOf(condition)]), continueJump),
            continueJump
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
