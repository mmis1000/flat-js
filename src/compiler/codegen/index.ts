import * as ts from 'typescript'

import { getFunctionBodyScopeNode, hasParameterExpressions, type Functions, type ParentMap, type Scopes, type VariableRoot } from '../analysis'
import { FunctionTypes, OpCode, StatementFlag } from '../shared'
import { generateBindingInitialization } from './binding-patterns'
import { createCodegenContext } from './context'
import { getExpectedArgumentCount } from './handlers/functions'
import { generateVariableList, getScopeDebugNames, markInternal, markInternals, op } from './helpers'
import type { Op, Segment, SegmentOptions } from './types'

export type { Op, Segment, SegmentOptions, StaticAccess } from './types'
export type { CodegenContext } from './context'

function hasUseStrictDirective(statements: readonly ts.Statement[]): boolean {
    for (const statement of statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
            return false
        }

        if (statement.expression.text === 'use strict') {
            return true
        }
    }

    return false
}

function isStrictRoot(node: VariableRoot, parentMap: ParentMap, withStrict: boolean): boolean {
    if (withStrict) {
        return true
    }

    let current: ts.Node | undefined = node

    while (current != null) {
        if (ts.isClassLike(current)) {
            return true
        }

        if (ts.isFunctionLike(current) && 'body' in current && current.body != null && ts.isBlock(current.body)) {
            if (
                ts.isMethodDeclaration(current)
                || ts.isGetAccessorDeclaration(current)
                || ts.isSetAccessorDeclaration(current)
                || ts.isConstructorDeclaration(current)
            ) {
                return true
            }

            if (hasUseStrictDirective(current.body.statements)) {
                return true
            }
        }

        if (ts.isSourceFile(current)) {
            return ts.isExternalModule(current) || hasUseStrictDirective(current.statements)
        }

        if (ts.isBlock(current)) {
            const owner = parentMap.get(current)?.node
            if (owner != null && ts.isFunctionLike(owner)) {
                if (hasUseStrictDirective(current.statements)) {
                    return true
                }
            }
        }

        current = parentMap.get(current)?.node
    }

    return false
}

export function generateSegment(
    node: VariableRoot,
    scopes: Scopes,
    parentMap: ParentMap,
    functions: Functions,
    evalTaintedFunctions: Set<VariableRoot>,
    { withPos = false, withEval = false, withStrict = false }: SegmentOptions = {}
): Segment {
    const ctx = createCodegenContext(node, scopes, parentMap, functions, evalTaintedFunctions, {
        withPos,
        withEval,
        withStrict
    })

    let bodyNodes: Op<OpCode>[]

    const functionNode = ts.isSourceFile(node) ? null : node
    const hasParameterExpr = functionNode != null && hasParameterExpressions(functionNode)
    const bodyScopeNode = functionNode == null ? null : getFunctionBodyScopeNode(functionNode)
    const restParameterIndex = functionNode?.parameters.findIndex((parameter) => parameter.dotDotDotToken != null) ?? -1
    const simpleParameterList = functionNode == null
        ? true
        : functionNode.parameters.every((parameter) =>
            ts.isIdentifier(parameter.name)
            && parameter.initializer == null
            && parameter.dotDotDotToken == null
        )
    const strictRoot = isStrictRoot(node, parentMap, withStrict)

    if (functionNode && restParameterIndex >= 0) {
        const restParameter = functionNode.parameters[restParameterIndex]!
        if (restParameterIndex !== functionNode.parameters.length - 1) {
            throw new Error('not support yet')
        }
    }

    const parameterRuntimeNames = functionNode == null
        ? []
        : functionNode.parameters.map((parameter) =>
            simpleParameterList && ts.isIdentifier(parameter.name)
                ? parameter.name.text
                : ctx.allocateInternalName('param')
        )

    const parameterPrologue = functionNode == null
        ? []
        : functionNode.parameters.flatMap((parameter, index) => {
            if (
                simpleParameterList
                && ts.isIdentifier(parameter.name)
                && parameter.initializer == null
            ) {
                return []
            }

            return generateBindingInitialization(
                parameter.name,
                [
                    op(OpCode.GetRecord),
                    op(OpCode.Literal, 2, [parameterRuntimeNames[index]]),
                    op(OpCode.Get),
                ],
                0,
                ctx,
                {
                    initializer: parameter.initializer,
                }
            )
        })

    if (ts.isSourceFile(node)) {
        const statements = [...node.statements]
        bodyNodes = statements.map((statement) => ctx.generate(statement, withEval ? StatementFlag.Eval : 0)).flat()
            .concat(markInternals([op(OpCode.UndefinedLiteral), op(OpCode.Return)]))
    } else if (node.body != undefined && ts.isBlock(node.body)) {
        const statements = [...node.body.statements]
        bodyNodes = statements.map((statement) => ctx.generate(statement, 0)).flat()
            .concat(markInternals([op(OpCode.UndefinedLiteral), op(OpCode.Return)]))
    } else {
        bodyNodes = [
            ...ctx.generate(node.body!, 0),
            markInternal(op(OpCode.Return))
        ]
    }

    const bodyStart = markInternal(op(OpCode.Nop, 0)) as Op<OpCode> & { bodyStartMarker?: boolean }
    bodyStart.bodyStartMarker = true

    const bodyScopeEnter = hasParameterExpr
        ? markInternal(op(OpCode.EnterBodyScope))
        : null
    if (bodyScopeEnter != null && bodyScopeNode != null) {
        bodyScopeEnter.scopeDebugNames = getScopeDebugNames(bodyScopeNode, scopes)
    }

    const bodyActivationNodes = bodyScopeEnter == null
        ? []
        : markInternals([
            ...(bodyScopeNode != null ? generateVariableList(bodyScopeNode, scopes) : [op(OpCode.Literal, 2, [0])]),
            bodyScopeEnter,
        ])

    const functionDeclarationNodes = ctx.functionDeclarations.map((declaration) => [
        op(OpCode.GetRecord),
        op(OpCode.Literal, 2, [declaration.name?.text]),
        op(OpCode.Literal, 2, [declaration.name?.text]),
        op(OpCode.Literal, 2, [getExpectedArgumentCount(declaration)]),
        op(OpCode.NodeOffset, 2, [declaration]),
        op(OpCode.NodeOffset, 2, [declaration, 'bodyStart']),
        op(OpCode.NodeFunctionType, 2, [declaration]),
        op(OpCode.DefineFunction),
        op(OpCode.Set),
        op(OpCode.Pop)
    ]).flat()

    const entry: Op[] = []

    if (ts.isSourceFile(node)) {
        entry.push(op(OpCode.Literal, 2, [0]))
        entry.push(op(OpCode.Literal, 2, [1]))
        entry.push(op(OpCode.Literal, 2, [0]))
        entry.push(op(OpCode.Literal, 2, [-1]))
    } else {
        for (let index = node.parameters.length - 1; index >= 0; index--) {
            entry.push(op(OpCode.Literal, 2, [parameterRuntimeNames[index]]))
        }
        entry.push(op(OpCode.Literal, 2, [node.parameters.length]))
        entry.push(op(OpCode.Literal, 2, [simpleParameterList ? 1 : 0]))
        entry.push(op(OpCode.Literal, 2, [hasParameterExpr ? 1 : 0]))
        entry.push(op(OpCode.Literal, 2, [restParameterIndex]))
    }

    entry.push(...generateVariableList(node, scopes))
    if (ts.isSourceFile(node) && !withStrict) {
        entry.push(op(OpCode.Literal, 2, [FunctionTypes.SourceFileInPlace]))
    } else {
        entry.push(op(OpCode.NodeFunctionType, 2, [node]))
    }
    entry.push(op(OpCode.Literal, 2, [strictRoot ? 1 : 0]))
    const enterFunction = op(OpCode.EnterFunction)
    enterFunction.scopeDebugNames = getScopeDebugNames(node, scopes)
    entry.push(enterFunction)

    markInternals(entry)

    const results = [
        ...entry,
        ...parameterPrologue,
        ...bodyActivationNodes,
        ...functionDeclarationNodes,
        bodyStart,
        ...bodyNodes
    ]

    if (withPos) {
        for (const op of results) {
            if (
                op.source == null
                || op.source.end - op.source.start > node.end - node.pos
            ) {
                op.source = {
                    start: node.pos,
                    end: node.end
                }
            }
        }
    }

    return results
}
