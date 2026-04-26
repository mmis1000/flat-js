import * as ts from 'typescript'

import { findAncient } from '../../analysis'
import { OpCode, SpecialVariable, StatementFlag, VariableType } from '../../shared'
import { abort, attachJumpConsumer, createNodeOffsetEncKeyPlaceholder, headOf, op, generateEnterScope, generateLeaveScope } from '../helpers'
import type { CodegenContext } from '../context'
import type { Op, Segment } from '../types'

export function generateControlFlow(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined {
    if (ts.isIfStatement(node)) {
        const exit = [op(OpCode.Nop, 0)]
        const whenTrueJump = op(OpCode.Jump)
        const whenTrueTarget = attachJumpConsumer(op(OpCode.NodeOffset, 2, [headOf(exit)]), whenTrueJump)
        const whenTrue = [
            op(OpCode.Nop, 0),
            ...ctx.generate(node.thenStatement, flag),
            whenTrueTarget,
            whenTrueJump,
        ]
        const whenFalsy = [
            op(OpCode.Nop, 0),
            ...(node.elseStatement !== undefined ? ctx.generate(node.elseStatement, flag) : [])
        ]
        const conditionJump = op(OpCode.JumpIfNot)
        const conditionTarget = attachJumpConsumer(op(OpCode.NodeOffset, 2, [headOf(whenFalsy)]), conditionJump)
        const condition = [
            conditionTarget,
            ...ctx.generate(node.expression, flag),
            conditionJump
        ]

        return [...condition, ...whenTrue, ...whenFalsy, ...exit]
    }

    if (ts.isThrowStatement(node)) {
        const ops: Segment = []
        ops.push(...ctx.generate(node.expression, flag))

        if (flag & StatementFlag.TryCatchFlags) {
            ops.push(op(OpCode.ThrowInTryCatchFinally))
        } else {
            ops.push(op(OpCode.Throw))
        }

        return ops
    }

    if (ts.isTryStatement(node)) {
        const tryStatements = ctx.generate(node.tryBlock, (flag ^ (flag & StatementFlag.TryCatchFlags)) | StatementFlag.Try)
        const exitTry = [
            op(OpCode.ExitTryCatchFinally)
        ]

        const catchStatement = node.catchClause
            ? ctx.generate(node.catchClause.block, (flag ^ (flag & StatementFlag.TryCatchFlags)) | StatementFlag.Catch)
            : [op(OpCode.Nop, 0)]
        const exitCatch = [
            op(OpCode.ExitTryCatchFinally)
        ]

        const finallyStatement = node.finallyBlock
            ? ctx.generate(node.finallyBlock, (flag ^ (flag & StatementFlag.TryCatchFlags)) | StatementFlag.Finally)
            : [op(OpCode.Nop, 0)]
        const exitFinally = [
            op(OpCode.ExitTryCatchFinally)
        ]

        const exitAll = [op(OpCode.Nop, 0)]
        const catchIdentifier = node.catchClause?.variableDeclaration?.name

        if (catchIdentifier && catchIdentifier.kind !== ts.SyntaxKind.Identifier) {
            throw new Error('not support non identifier binding')
        }

        const exitAllNodeOffset = op(OpCode.NodeOffset, 2, [headOf(exitAll)])
        const catchNodeOffset = node.catchClause
            ? op(OpCode.NodeOffset, 2, [headOf(catchStatement)])
            : op(OpCode.Literal, 2, [-1])
        const finallyNodeOffset = node.finallyBlock
            ? op(OpCode.NodeOffset, 2, [headOf(finallyStatement)])
            : op(OpCode.Literal, 2, [-1])

        const init = [
            exitAllNodeOffset,
            createNodeOffsetEncKeyPlaceholder(exitAllNodeOffset),
            catchNodeOffset,
            node.catchClause ? createNodeOffsetEncKeyPlaceholder(catchNodeOffset) : op(OpCode.Literal, 2, [-1]),
            finallyNodeOffset,
            node.finallyBlock ? createNodeOffsetEncKeyPlaceholder(finallyNodeOffset) : op(OpCode.Literal, 2, [-1]),
            node.catchClause?.variableDeclaration
                ? op(OpCode.Literal, 2, [catchIdentifier?.text])
                : op(OpCode.UndefinedLiteral),
            op(OpCode.InitTryCatch)
        ]

        return [
            ...init,
            ...tryStatements,
            ...exitTry,
            ...node.catchClause
                ? [
                    ...catchStatement,
                    ...exitCatch
                ]
                : [],
            ...node.finallyBlock
                ? [
                    ...finallyStatement,
                    ...exitFinally
                ]
                : [],
            ...exitAll
        ]
    }

    if (ts.isSwitchStatement(node)) {
        const nextOp = op(OpCode.Nop, 0)
        ctx.nextOps.set(node, nextOp)

        const switchHead = [
            op(OpCode.Literal, 2, [SpecialVariable.SwitchValue]),
            op(OpCode.Literal, 2, [VariableType.Var]),
            op(OpCode.Literal, 2, [1]),
            op(OpCode.EnterScope),
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.SwitchValue]),
            ...ctx.generate(node.expression, flag),
            op(OpCode.Set),
            op(OpCode.Pop)
        ]

        const bodies: {
            entry: Op
            rule?: Op[]
            body: Op[]
        }[] = []

        for (const clause of node.caseBlock.clauses) {
            if (ts.isCaseClause(clause)) {
                const rule = [
                    op(OpCode.GetRecord),
                    op(OpCode.Literal, 2, [SpecialVariable.SwitchValue]),
                    op(OpCode.Get),
                    ...ctx.generate(clause.expression, flag),
                    op(OpCode.BEqualsEqualsEquals)
                ]
                const body = [
                    op(OpCode.Nop, 0),
                    ...clause.statements.map((statement) => ctx.generate(statement, flag)).flat()
                ]
                bodies.push({
                    entry: op(OpCode.Nop, 0),
                    rule,
                    body
                })
            } else {
                const body = [
                    op(OpCode.Nop, 0),
                    ...clause.statements.map((statement) => ctx.generate(statement, flag)).flat()
                ]
                bodies.push({
                    entry: op(OpCode.Nop, 0),
                    body
                })
            }
        }

        const hasVariables = ctx.scopes.get(node.caseBlock)!.size > 0
        const connectedBodyHead = hasVariables ? generateEnterScope(node.caseBlock, ctx.scopes) : []
        const connectedBodyRules: Op[] = []
        const connectedBody: Op[] = []
        const connectedBodyExit = op(OpCode.Nop, 0)
        const connectedBodyEnd = hasVariables ? generateLeaveScope() : [op(OpCode.Nop, 0)]

        for (const [, item] of bodies.entries()) {
            connectedBody.push(...item.body)
        }

        for (const [index, item] of bodies.entries()) {
            const nextSegment = bodies[index].body[0]
            const jump = item.rule != null ? op(OpCode.JumpIf) : op(OpCode.Jump)
            connectedBodyRules.push(attachJumpConsumer(op(OpCode.NodeOffset, 2, [nextSegment]), jump))
            if (item.rule != null) {
                connectedBodyRules.push(...item.rule)
                connectedBodyRules.push(jump)
            } else {
                connectedBodyRules.push(jump)
            }

            connectedBody.push(...item.body)
        }

        const exitJump = op(OpCode.Jump)
        connectedBodyRules.push(attachJumpConsumer(op(OpCode.NodeOffset, 2, [connectedBodyExit]), exitJump))
        connectedBodyRules.push(exitJump)

        const switchTail = [
            op(OpCode.LeaveScope)
        ]

        return [
            ...switchHead,
            ...connectedBodyHead,
            ...connectedBodyRules,
            ...connectedBody,
            connectedBodyExit,
            ...connectedBodyEnd,
            ...switchTail,
            nextOp
        ]
    }

    if (ts.isBreakStatement(node) && node.label == null) {
        let crossedTryCatch = 0
        let scopeCount = 0
        const target = findAncient(node, ctx.parentMap, (ancestor) => {
            if ((ctx.scopes.get(ancestor)?.size ?? 0) > 0) {
                scopeCount++
            }

            if (ctx.nextOps.has(ancestor)) {
                return true
            }
            if (ctx.functions.has(ancestor as any)) {
                throw new Error('bug check')
            }

            if (ts.isTryStatement(ancestor)) {
                crossedTryCatch++
                scopeCount = 0
            }

            return false
        })

        if (target == null) {
            throw new Error('cannot find break target')
        }

        const nextNode = ctx.nextOps.get(target)
        if (nextNode == null) {
            throw new Error('did not get nextNode')
        }

        if (crossedTryCatch === 0) {
            const breakJump = op(OpCode.Jump)
            return [
                ...new Array(scopeCount).fill(0).map(() => op(OpCode.LeaveScope)),
                attachJumpConsumer(op(OpCode.NodeOffset, 2, [nextNode]), breakJump),
                breakJump
            ]
        }

        const exitStubJump = op(OpCode.Jump)
        const exitStub: Op[] = [
            op(OpCode.Nop, 0),
            ...new Array(scopeCount).fill(0).map(() => op(OpCode.LeaveScope)),
            attachJumpConsumer(op(OpCode.NodeOffset, 2, [nextNode]), exitStubJump),
            exitStubJump
        ]
        const exitStubNodeOffset = op(OpCode.NodeOffset, 2, [exitStub[0]])
        const breakCommand: Op[] = [
            op(OpCode.Literal, 2, [crossedTryCatch]),
            exitStubNodeOffset,
            createNodeOffsetEncKeyPlaceholder(exitStubNodeOffset),
            op(OpCode.BreakInTryCatchFinally)
        ]
        return [
            ...breakCommand,
            ...exitStub
        ]
    }

    if (ts.isContinueStatement(node) && node.label == null) {
        let scopeCount = 0
        const target = findAncient(node, ctx.parentMap, (ancestor) => {
            if ((ctx.scopes.get(ancestor)?.size ?? 0) > 0) {
                scopeCount++
            }

            if (ctx.continueOps.has(ancestor)) {
                return true
            }

            if (ts.isTryStatement(ancestor)) abort('Not support continue in try catch yet')

            return false
        })

        if (target == null) {
            throw new Error('cannot find continue target')
        }

        const nextNode = ctx.continueOps.get(target)
        if (nextNode == null) {
            throw new Error('did not get nextNode')
        }

        const forHasScope = (ctx.scopes.get(target)?.size ?? 0) !== 0
        const continueJump = op(OpCode.Jump)

        return [
            ...new Array(forHasScope ? scopeCount - 1 : scopeCount).fill(0).map(() => op(OpCode.LeaveScope)),
            attachJumpConsumer(op(OpCode.NodeOffset, 2, [nextNode]), continueJump),
            continueJump
        ]
    }
}
