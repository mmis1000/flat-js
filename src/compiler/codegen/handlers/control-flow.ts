import * as ts from 'typescript'

import { extractVariable, findAncient, isLexicalSwitchFunctionDeclaration } from '../../analysis'
import { OpCode, SpecialVariable, StatementFlag, VariableType } from '../../shared'
import { generateBindingInitialization } from '../binding-patterns'
import { headOf, op, generateEnterScope, generateIteratorClose, generateLeaveScope } from '../helpers'
import { generateFunctionDefinitionWithStackName } from './functions'
import type { CodegenContext } from '../context'
import type { Op, Segment } from '../types'

function unwrapLabeledIterationTarget(statement: ts.Statement): ts.IterationStatement | null {
    let current: ts.Statement = statement

    while (ts.isLabeledStatement(current)) {
        current = current.statement
    }

    if (
        ts.isForStatement(current)
        || ts.isForInStatement(current)
        || ts.isForOfStatement(current)
        || ts.isWhileStatement(current)
        || ts.isDoStatement(current)
    ) {
        return current
    }

    return null
}

function unwrapLabeledStatementItem(statement: ts.Statement): ts.Statement {
    let current = statement

    while (ts.isLabeledStatement(current)) {
        current = current.statement
    }

    return current
}

function isAsyncModifier(modifier: ts.ModifierLike): boolean {
    return modifier.kind === ts.SyntaxKind.AsyncKeyword
}

function hasSyntheticRuntimeScope(node: ts.Node): boolean {
    return ts.isSwitchStatement(node) || ts.isWithStatement(node)
}

function shouldCloseContainingForOf(node: ts.Node, ctx: CodegenContext): boolean {
    return findAncient(node, ctx.parentMap, (ancestor) => {
        if (ts.isTryStatement(ancestor) || ctx.functions.has(ancestor as any)) {
            return true
        }
        return ts.isForOfStatement(ancestor)
    })?.kind === ts.SyntaxKind.ForOfStatement
}

function hasUseStrictDirective(statements: readonly ts.Statement[]): boolean {
    for (const statement of statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
            return false
        }

        const raw = statement.expression.getText()
        if (raw === "'use strict'" || raw === '"use strict"') {
            return true
        }
    }

    return false
}

function isStrictContext(node: ts.Node, ctx: CodegenContext): boolean {
    if (ctx.withStrict) {
        return true
    }

    let current: ts.Node | undefined = node

    while (current != null) {
        if (ts.isClassLike(current)) {
            return true
        }

        if (ts.isSourceFile(current)) {
            return ts.isExternalModule(current) || hasUseStrictDirective(current.statements)
        }

        if (ts.isBlock(current)) {
            const owner = ctx.parentMap.get(current)?.node
            if (owner != null && ts.isFunctionLike(owner)) {
                if (
                    ts.isMethodDeclaration(owner)
                    || ts.isGetAccessorDeclaration(owner)
                    || ts.isSetAccessorDeclaration(owner)
                    || ts.isConstructorDeclaration(owner)
                ) {
                    return true
                }

                if (hasUseStrictDirective(current.statements)) {
                    return true
                }
            }
        }

        current = ctx.parentMap.get(current)?.node
    }

    return false
}

function isInvalidLabeledStatementItem(statement: ts.Statement, withStrict: boolean): boolean {
    const item = unwrapLabeledStatementItem(statement)

    if (ts.isVariableStatement(item)) {
        return !!(item.declarationList.flags & ts.NodeFlags.BlockScoped)
    }

    if (ts.isClassDeclaration(item)) {
        return true
    }

    if (ts.isFunctionDeclaration(item)) {
        const isAsync = item.modifiers?.some(isAsyncModifier) ?? false
        if (item.asteriskToken || isAsync) {
            return true
        }

        return withStrict
    }

    return false
}

function isInvalidWithStatementItem(statement: ts.Statement): boolean {
    const item = unwrapLabeledStatementItem(statement)

    if (ts.isVariableStatement(item)) {
        return !!(item.declarationList.flags & ts.NodeFlags.BlockScoped)
    }

    return ts.isClassDeclaration(item) || ts.isFunctionDeclaration(item)
}

function generateNamedScope(names: string[]): Segment {
    if (names.length === 0) {
        return []
    }

    return [
        ...names.flatMap((name) => [
            op(OpCode.Literal, 2, [name]),
            op(OpCode.Literal, 2, [VariableType.Var]),
        ]),
        op(OpCode.Literal, 2, [names.length]),
        op(OpCode.EnterScope),
    ]
}

const generateEvalResultReset = (flag: number): Segment =>
    flag & StatementFlag.Eval
        ? [op(OpCode.UndefinedLiteral), op(OpCode.SetEvalResult), op(OpCode.Pop)]
        : []

export function generateControlFlow(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined {
    if (ts.isIfStatement(node)) {
        const resetEvalResult = generateEvalResultReset(flag)
        const exit = [op(OpCode.Nop, 0)]
        const whenTrue = [
            op(OpCode.Nop, 0),
            ...ctx.generate(node.thenStatement, flag),
            op(OpCode.NodeOffset, 2, [headOf(exit)]),
            op(OpCode.Jump),
        ]
        const whenFalsy = [
            op(OpCode.Nop, 0),
            ...(node.elseStatement !== undefined ? ctx.generate(node.elseStatement, flag) : [])
        ]
        const condition = [
            op(OpCode.NodeOffset, 2, [headOf(whenFalsy)]),
            ...ctx.generate(node.expression, flag),
            op(OpCode.JumpIfNot)
        ]

        return [...resetEvalResult, ...condition, ...whenTrue, ...whenFalsy, ...exit]
    }

    if (ts.isThrowStatement(node)) {
        const ops: Segment = []
        ops.push(...ctx.generate(node.expression, flag))
        if (shouldCloseContainingForOf(node, ctx)) {
            ops.push(...generateIteratorClose(true))
        }

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

        const catchBinding = node.catchClause?.variableDeclaration?.name
        const catchBindingNames = catchBinding ? extractVariable(catchBinding).map((name) => name.text) : []
        const catchTempName = catchBinding != null && !ts.isIdentifier(catchBinding)
            ? ctx.allocateInternalName('catch')
            : undefined
        const catchStatement = node.catchClause
            ? catchTempName == null
                ? [
                    ...generateEvalResultReset(flag),
                    ...ctx.generate(node.catchClause.block, (flag ^ (flag & StatementFlag.TryCatchFlags)) | StatementFlag.Catch),
                ]
                : [
                    ...generateNamedScope(catchBindingNames),
                    ...generateBindingInitialization(
                        catchBinding!,
                        [
                            op(OpCode.GetRecord),
                            op(OpCode.Literal, 2, [catchTempName]),
                            op(OpCode.Get),
                        ],
                        flag,
                        ctx
                    ),
                    ...generateEvalResultReset(flag),
                    ...ctx.generate(node.catchClause.block, (flag ^ (flag & StatementFlag.TryCatchFlags)) | StatementFlag.Catch),
                    ...generateLeaveScope(),
                ]
            : [op(OpCode.Nop, 0)]
        const exitCatch = [
            op(OpCode.ExitTryCatchFinally)
        ]

        const finallyStatement = node.finallyBlock
            ? [
                ...generateEvalResultReset(flag),
                ...ctx.generate(node.finallyBlock, (flag ^ (flag & StatementFlag.TryCatchFlags)) | StatementFlag.Finally),
            ]
            : [op(OpCode.Nop, 0)]
        const exitFinally = [
            op(OpCode.ExitTryCatchFinally)
        ]

        const exitAll = [op(OpCode.Nop, 0)]
        const catchIdentifier = node.catchClause?.variableDeclaration?.name

        const init = [
            op(OpCode.NodeOffset, 2, [headOf(exitAll)]),
            node.catchClause
                ? op(OpCode.NodeOffset, 2, [headOf(catchStatement)])
                : op(OpCode.Literal, 2, [-1]),
            node.finallyBlock
                ? op(OpCode.NodeOffset, 2, [headOf(finallyStatement)])
                : op(OpCode.Literal, 2, [-1]),
            node.catchClause?.variableDeclaration
                ? op(OpCode.Literal, 2, [catchTempName ?? (catchIdentifier != null && ts.isIdentifier(catchIdentifier) ? catchIdentifier.text : '')])
                : op(OpCode.UndefinedLiteral),
            op(OpCode.InitTryCatch)
        ]

        return [
            ...generateEvalResultReset(flag),
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
        const connectedBodyHead = hasVariables ? generateEnterScope(node.caseBlock, ctx.scopes, ctx.getVariableRuntimeName) : []
        const connectedBodyRules: Op[] = []
        const connectedBody: Op[] = []
        const connectedBodyExit = op(OpCode.Nop, 0)
        const connectedBodyEnd = hasVariables ? generateLeaveScope() : [op(OpCode.Nop, 0)]
        const resetEvalResult = generateEvalResultReset(flag)
        const lexicalFunctionInitializers = node.caseBlock.clauses
            .flatMap((clause) => clause.statements)
            .filter((statement): statement is ts.FunctionDeclaration =>
                ts.isFunctionDeclaration(statement) && isLexicalSwitchFunctionDeclaration(statement, ctx.parentMap)
            )
            .flatMap((declaration) => [
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [declaration.name?.text ?? '']),
                op(OpCode.Literal, 2, [declaration.name?.text ?? '']),
                ...generateFunctionDefinitionWithStackName(declaration),
                op(OpCode.Set),
                op(OpCode.Pop),
            ])

        let defaultSegment: Op | undefined
        for (const item of bodies) {
            const nextSegment = item.body[0]

            if (item.rule != null) {
                connectedBodyRules.push(op(OpCode.NodeOffset, 2, [nextSegment]))
                connectedBodyRules.push(...item.rule)
                connectedBodyRules.push(op(OpCode.JumpIf))
            } else {
                defaultSegment = nextSegment
            }

            connectedBody.push(...item.body)
        }

        connectedBodyRules.push(op(OpCode.NodeOffset, 2, [defaultSegment ?? connectedBodyExit]))
        connectedBodyRules.push(op(OpCode.Jump))

        const switchTail = [
            op(OpCode.LeaveScope)
        ]

        return [
            ...switchHead,
            ...resetEvalResult,
            ...connectedBodyHead,
            ...lexicalFunctionInitializers,
            ...connectedBodyRules,
            ...connectedBody,
            connectedBodyExit,
            ...connectedBodyEnd,
            ...switchTail,
            nextOp
        ]
    }

    if (ts.isWithStatement(node)) {
        if (isStrictContext(node, ctx)) {
            throw new SyntaxError('with statements are not allowed in strict mode')
        }

        if (isInvalidWithStatementItem(node.statement)) {
            throw new SyntaxError('invalid with statement item')
        }

        return [
            ...(flag & StatementFlag.Eval
                ? [op(OpCode.UndefinedLiteral), op(OpCode.SetEvalResult), op(OpCode.Pop)]
                : []),
            ...ctx.generate(node.expression, flag),
            op(OpCode.EnterWith),
            ...ctx.generate(node.statement, flag),
            ...generateLeaveScope(),
        ]
    }

    if (ts.isLabeledStatement(node)) {
        const strictContext = isStrictContext(node, ctx)

        if (strictContext && node.label.text === 'yield') {
            throw new SyntaxError('yield is not a valid label in strict mode')
        }

        if (isInvalidLabeledStatementItem(node.statement, strictContext)) {
            throw new SyntaxError('invalid labeled statement item')
        }

        const nextOp = op(OpCode.Nop, 0)
        ctx.nextOps.set(node, nextOp)

        return [
            ...ctx.generate(node.statement, flag),
            nextOp
        ]
    }

    if (ts.isBreakStatement(node) && node.label != null) {
        let crossedTryCatch = 0
        let scopeCount = 0
        let closesForOf = false
        const target = findAncient(node, ctx.parentMap, (ancestor) => {
            if ((ctx.scopes.get(ancestor)?.size ?? 0) > 0) {
                scopeCount++
            }

            if (hasSyntheticRuntimeScope(ancestor)) {
                scopeCount++
            }

            if (ts.isForOfStatement(ancestor)) {
                closesForOf = true
            }

            if (ts.isLabeledStatement(ancestor) && ancestor.label.text === node.label!.text) {
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

        if (target == null || !ts.isLabeledStatement(target)) {
            throw new SyntaxError('cannot find break target')
        }

        const nextNode = ctx.nextOps.get(target)
        if (nextNode == null) {
            throw new Error('did not get nextNode')
        }

        if (crossedTryCatch === 0) {
            return [
                ...(closesForOf ? generateIteratorClose(false) : []),
                ...new Array(scopeCount).fill(0).map(() => op(OpCode.LeaveScope)),
                op(OpCode.NodeOffset, 2, [nextNode]),
                op(OpCode.Jump)
            ]
        }

        const exitStub: Op[] = [
            op(OpCode.Nop, 0),
            ...(closesForOf ? generateIteratorClose(false) : []),
            ...new Array(scopeCount).fill(0).map(() => op(OpCode.LeaveScope)),
            op(OpCode.NodeOffset, 2, [nextNode]),
            op(OpCode.Jump)
        ]
        const breakCommand: Op[] = [
            op(OpCode.Literal, 2, [crossedTryCatch]),
            op(OpCode.NodeOffset, 2, [exitStub[0]]),
            op(OpCode.BreakInTryCatchFinally)
        ]
        return [
            ...breakCommand,
            ...exitStub
        ]
    }

    if (ts.isBreakStatement(node) && node.label == null) {
        let crossedTryCatch = 0
        let scopeCount = 0
        let closesForOf = false
        const target = findAncient(node, ctx.parentMap, (ancestor) => {
            if ((ctx.scopes.get(ancestor)?.size ?? 0) > 0) {
                scopeCount++
            }

            if (hasSyntheticRuntimeScope(ancestor)) {
                scopeCount++
            }

            if (ts.isForOfStatement(ancestor)) {
                closesForOf = true
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
            throw new SyntaxError('cannot find break target')
        }

        const nextNode = ctx.nextOps.get(target)
        if (nextNode == null) {
            throw new Error('did not get nextNode')
        }

        if (crossedTryCatch === 0) {
            return [
                ...(closesForOf ? generateIteratorClose(false) : []),
                ...new Array(scopeCount).fill(0).map(() => op(OpCode.LeaveScope)),
                op(OpCode.NodeOffset, 2, [nextNode]),
                op(OpCode.Jump)
            ]
        }

        const exitStub: Op[] = [
            op(OpCode.Nop, 0),
            ...(closesForOf ? generateIteratorClose(false) : []),
            ...new Array(scopeCount).fill(0).map(() => op(OpCode.LeaveScope)),
            op(OpCode.NodeOffset, 2, [nextNode]),
            op(OpCode.Jump)
        ]
        const breakCommand: Op[] = [
            op(OpCode.Literal, 2, [crossedTryCatch]),
            op(OpCode.NodeOffset, 2, [exitStub[0]]),
            op(OpCode.BreakInTryCatchFinally)
        ]
        return [
            ...breakCommand,
            ...exitStub
        ]
    }

    if (ts.isContinueStatement(node) && node.label != null) {
        let crossedTryCatch = 0
        let scopeCount = 0
        let crossedForOf: ts.ForOfStatement | null = null
        const target = findAncient(node, ctx.parentMap, (ancestor) => {
            if ((ctx.scopes.get(ancestor)?.size ?? 0) > 0) {
                scopeCount++
            }

            if (hasSyntheticRuntimeScope(ancestor)) {
                scopeCount++
            }

            if (ts.isForOfStatement(ancestor) && crossedForOf == null) {
                crossedForOf = ancestor
            }

            if (ts.isLabeledStatement(ancestor) && ancestor.label.text === node.label!.text) {
                return true
            }

            if (ts.isTryStatement(ancestor)) {
                crossedTryCatch++
                scopeCount = 0
            }

            return false
        })

        if (target == null || !ts.isLabeledStatement(target)) {
            throw new SyntaxError('cannot find continue target')
        }

        const loopTarget = unwrapLabeledIterationTarget(target.statement)
        if (loopTarget == null) {
            throw new SyntaxError('cannot find continue target')
        }

        const nextNode = ctx.continueOps.get(loopTarget)
        if (nextNode == null) {
            throw new Error('did not get nextNode')
        }

        const loopHasScope = (ctx.scopes.get(loopTarget)?.size ?? 0) !== 0
        const closesForOf = crossedForOf != null && loopTarget !== crossedForOf

        const continueOps: Segment = [
            ...(closesForOf ? generateIteratorClose(false) : []),
            ...new Array(loopHasScope ? scopeCount - 1 : scopeCount).fill(0).map(() => op(OpCode.LeaveScope)),
            op(OpCode.NodeOffset, 2, [nextNode]),
            op(OpCode.Jump)
        ]

        if (crossedTryCatch === 0) {
            return continueOps
        }

        const exitStub: Op[] = [
            op(OpCode.Nop, 0),
            ...continueOps,
        ]
        return [
            op(OpCode.Literal, 2, [crossedTryCatch]),
            op(OpCode.NodeOffset, 2, [exitStub[0]]),
            op(OpCode.BreakInTryCatchFinally),
            ...exitStub,
        ]
    }

    if (ts.isContinueStatement(node) && node.label == null) {
        let crossedTryCatch = 0
        let scopeCount = 0
        let crossedForOf: ts.ForOfStatement | null = null
        const target = findAncient(node, ctx.parentMap, (ancestor) => {
            if ((ctx.scopes.get(ancestor)?.size ?? 0) > 0) {
                scopeCount++
            }

            if (hasSyntheticRuntimeScope(ancestor)) {
                scopeCount++
            }

            if (ts.isForOfStatement(ancestor) && crossedForOf == null) {
                crossedForOf = ancestor
            }

            if (ctx.continueOps.has(ancestor)) {
                return true
            }

            if (ts.isTryStatement(ancestor)) {
                crossedTryCatch++
                scopeCount = 0
            }

            return false
        })

        if (target == null) {
            throw new SyntaxError('cannot find continue target')
        }

        const nextNode = ctx.continueOps.get(target)
        if (nextNode == null) {
            throw new Error('did not get nextNode')
        }

        const forHasScope = (ctx.scopes.get(target)?.size ?? 0) !== 0
        const closesForOf = crossedForOf != null && target !== crossedForOf

        const continueOps: Segment = [
            ...(closesForOf ? generateIteratorClose(false) : []),
            ...new Array(forHasScope ? scopeCount - 1 : scopeCount).fill(0).map(() => op(OpCode.LeaveScope)),
            op(OpCode.NodeOffset, 2, [nextNode]),
            op(OpCode.Jump)
        ]

        if (crossedTryCatch === 0) {
            return continueOps
        }

        const exitStub: Op[] = [
            op(OpCode.Nop, 0),
            ...continueOps,
        ]
        return [
            op(OpCode.Literal, 2, [crossedTryCatch]),
            op(OpCode.NodeOffset, 2, [exitStub[0]]),
            op(OpCode.BreakInTryCatchFinally),
            ...exitStub,
        ]
    }
}
