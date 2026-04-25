import * as ts from 'typescript'

import type { Functions, ParentMap, Scopes, VariableRoot } from '../analysis'
import { FunctionTypes, OpCode, StatementFlag } from '../shared'
import { createCodegenContext } from './context'
import { generateVariableList, getScopeDebugNames, markInternal, markInternals, op } from './helpers'
import type { Op, Segment, SegmentOptions } from './types'

export type { Op, Segment, SegmentOptions, StaticAccess } from './types'
export type { CodegenContext } from './context'

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

    const functionDeclarationNodes = ctx.functionDeclarations.map((declaration) => [
        op(OpCode.GetRecord),
        op(OpCode.Literal, 2, [declaration.name?.text]),
        op(OpCode.Literal, 2, [declaration.name?.text]),
        op(OpCode.NodeOffset, 2, [declaration]),
        op(OpCode.NodeFunctionType, 2, [declaration]),
        op(OpCode.DefineFunction),
        op(OpCode.Set),
        op(OpCode.Pop)
    ]).flat()

    const entry: Op[] = []

    if (ts.isSourceFile(node)) {
        entry.push(op(OpCode.Literal, 2, [0]))
    } else {
        for (const item of [...node.parameters].reverse()) {
            if (!ts.isIdentifier(item.name) || item.dotDotDotToken != null) {
                throw new Error('not support yet')
            }

            entry.push(op(OpCode.Literal, 2, [item.name.text]))
        }
        entry.push(op(OpCode.Literal, 2, [node.parameters.length]))
    }

    entry.push(...generateVariableList(node, scopes))
    if (ts.isSourceFile(node) && !withStrict) {
        entry.push(op(OpCode.Literal, 2, [FunctionTypes.SourceFileInPlace]))
    } else {
        entry.push(op(OpCode.NodeFunctionType, 2, [node]))
    }
    const enterFunction = op(OpCode.EnterFunction)
    enterFunction.scopeDebugNames = getScopeDebugNames(node, scopes)
    entry.push(enterFunction)

    markInternals(entry)

    const results = [
        ...entry,
        ...functionDeclarationNodes,
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
