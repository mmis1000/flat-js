import * as ts from 'typescript'

import { getFunctionBodyScopeNode, hasParameterExpressions, type Functions, type ParentMap, type Scopes, type VariableRoot } from '../analysis'
import { OpCode, SpecialVariable, VariableType } from '../shared'
import { getNameOfKind, op } from './helpers'
import { dispatchGenerate } from './dispatch'
import type { Op, Segment, SegmentOptions, StaticAccess } from './types'

export type CodegenContext = {
    root: VariableRoot
    scopes: Scopes
    parentMap: ParentMap
    functions: Functions
    withPos: boolean
    withEval: boolean
    withStrict: boolean
    functionDeclarations: ts.FunctionDeclaration[]
    nextOps: Map<ts.Node, Op>
    continueOps: Map<ts.Node, Op>
    generate(node: ts.Node, flag: number): Segment
    generateRaw(node: ts.Node, flag: number): Segment
    generateLeft(node: ts.Node, flag: number): Segment
    extractQuote(node: ts.Node): ts.Node
    generateStaticAccessOps(access: StaticAccess): Segment
    generateIdentifierGet(node: ts.Identifier): Segment
    tryResolveStaticAccess(node: ts.Node, name: string): StaticAccess | null
    isStaticAccessUnchecked(access: StaticAccess): boolean
    allocateInternalName(prefix?: string): string
}

export function createCodegenContext(
    root: VariableRoot,
    scopes: Scopes,
    parentMap: ParentMap,
    functions: Functions,
    evalTaintedFunctions: Set<VariableRoot>,
    { withPos = false, withEval = false, withStrict = false }: SegmentOptions = {}
): CodegenContext {
    const functionDeclarations: ts.FunctionDeclaration[] = []
    const nextOps = new Map<ts.Node, Op>()
    const continueOps = new Map<ts.Node, Op>()
    let nextInternalNameId = 0
    const staticScopeSlotIndices = new Map<ts.Node, Map<string, number>>()
    const staticResolutionEnabled = !withEval && !evalTaintedFunctions.has(root)
    const rootHasParameterExpressions = !ts.isSourceFile(root) && hasParameterExpressions(root)
    const rootExpressionBody = rootHasParameterExpressions && root.body != null && !ts.isBlock(root.body)
        ? root.body
        : null

    function stampSource(ops: Segment, node: ts.Node): Segment {
        if (!withPos) {
            return ops
        }

        let start = root.pos
        let end = root.end

        if (node.pos >= 0 && node.end >= 0) {
            try {
                start = node.getStart()
                end = node.end
            } catch {
                // Synthetic lowered nodes may have text ranges but no backing source file.
            }
        }

        for (const op of ops) {
            if (
                op.source == null
                || op.source.end - op.source.start > end - start
            ) {
                op.source = {
                    start,
                    end
                }
            }
        }

        return ops
    }

    function extractQuote(node: ts.Node): ts.Node {
        while (ts.isParenthesizedExpression(node)) {
            node = node.expression
        }
        return node
    }

    function isWithinNode(node: ts.Node, ancestor: ts.Node) {
        let current: ts.Node | undefined = node
        while (current != null) {
            if (current === ancestor) {
                return true
            }
            current = parentMap.get(current)?.node
        }
        return false
    }

    function isFunctionBodyRuntimeScopeNode(node: ts.Node) {
        if (!ts.isBlock(node)) {
            return false
        }

        const pair = parentMap.get(node)
        if (pair == null || pair.key !== 'body' || !ts.isFunctionLike(pair.node) || !('body' in pair.node)) {
            return false
        }

        return getFunctionBodyScopeNode(pair.node as ts.FunctionLikeDeclarationBase) === node
    }

    function isRuntimeScopeNode(node: ts.Node) {
        return functions.has(node as VariableRoot)
            || isFunctionBodyRuntimeScopeNode(node)
            || (scopes.get(node)?.size ?? 0) > 0
    }

    function getHiddenRuntimeScopeDepth(node: ts.Node) {
        if (ts.isSwitchStatement(node)) {
            return 1
        }
        if (ts.isCatchClause(node) && node.variableDeclaration != null) {
            return 1
        }
        return 0
    }

    function canStaticResolveScope(scopeNode: ts.Node) {
        return !(ts.isSourceFile(scopeNode) && !withStrict)
    }

    function isStaticAccessUnchecked(access: StaticAccess) {
        return access.type === VariableType.Var
            || access.type === VariableType.Function
            || access.type === VariableType.Parameter
    }

    function getStaticScopeSlotIndex(scopeNode: ts.Node, name: string): number | null {
        let indexMap = staticScopeSlotIndices.get(scopeNode)
        if (!indexMap) {
            indexMap = new Map<string, number>()
            const names = [...(scopes.get(scopeNode)?.keys() ?? [])].reverse()
            for (let i = 0; i < names.length; i++) {
                indexMap.set(names[i], i)
            }
            staticScopeSlotIndices.set(scopeNode, indexMap)
        }
        return indexMap.get(name) ?? null
    }

    function tryResolveStaticAccess(node: ts.Node, name: string): StaticAccess | null {
        if (!staticResolutionEnabled) {
            return null
        }

        let current: ts.Node | undefined = node
        let depth = 0
        const hiddenExpressionBodyScopeDepth = rootExpressionBody != null && isWithinNode(node, rootExpressionBody)
        while (current) {
            const parent: ts.Node | undefined = parentMap.get(current)?.node
            if (parent != null && ts.isWithStatement(parent) && parent.statement === current) {
                return null
            }

            if (
                ts.isCatchClause(current)
                && current.variableDeclaration != null
                && ts.isIdentifier(current.variableDeclaration.name)
                && current.variableDeclaration.name.text === name
            ) {
                return { depth, index: 0, type: VariableType.Var }
            }

            if (current === root && hiddenExpressionBodyScopeDepth) {
                depth += 1
            }

            if (isRuntimeScopeNode(current)) {
                const scope = scopes.get(current)
                if (scope?.has(name)) {
                    if (!canStaticResolveScope(current)) {
                        return null
                    }
                    const declaration = scope.get(name)!
                    const index = getStaticScopeSlotIndex(current, name)
                    if (index == null) {
                        throw new Error('missing static slot for ' + name)
                    }
                    return { depth, index, type: declaration.type }
                }
                depth++
                if (!ts.isSourceFile(current) && functions.has(current as VariableRoot) && hasParameterExpressions(current as VariableRoot)) {
                    depth++
                }
            }
            depth += getHiddenRuntimeScopeDepth(current)
            current = parent
        }

        return null
    }

    function generateStaticAccessOps({ depth, index }: StaticAccess): Segment {
        return [
            op(OpCode.Literal, 2, [depth]),
            op(OpCode.Literal, 2, [index]),
        ]
    }

    function generateIdentifierGet(node: ts.Identifier): Segment {
        const access = tryResolveStaticAccess(node, node.text)
        if (access) {
            return [
                ...generateStaticAccessOps(access),
                op(isStaticAccessUnchecked(access) ? OpCode.GetStaticUnchecked : OpCode.GetStatic),
            ]
        }
        return [
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [node.text]),
            op(OpCode.Get),
        ]
    }

    function allocateInternalName(prefix: string = 'tmp') {
        return `[${prefix}:${nextInternalNameId++}]`
    }

    function generateLeft_(node: ts.Node, flag: number): Segment {
        const rawNode = extractQuote(node)

        if (rawNode.kind === ts.SyntaxKind.ThisKeyword) {
            return [
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [SpecialVariable.This])
            ]
        }

        if (ts.isIdentifier(rawNode)) {
            return [
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [rawNode.text])
            ]
        }

        if (ts.isPropertyAccessExpression(rawNode) && ts.isIdentifier(rawNode.name)) {
            return [
                ...generate(rawNode.expression, flag),
                op(OpCode.Literal, 2, [rawNode.name.text])
            ]
        }

        if (ts.isElementAccessExpression(rawNode)) {
            return [
                ...generate(rawNode.expression, flag),
                ...generate(rawNode.argumentExpression, flag)
            ]
        }

        throw new Error('not supported left node: ' + getNameOfKind(rawNode.kind))
    }

    function generateLeft(node: ts.Node, flag: number): Segment {
        return stampSource(generateLeft_(node, flag), node)
    }

    function generateRaw(node: ts.Node, flag: number): Segment {
        return dispatchGenerate(node, flag, ctx)
    }

    function generate(node: ts.Node, flag: number): Segment {
        return stampSource(generateRaw(node, flag), node)
    }

    const ctx: CodegenContext = {
        root,
        scopes,
        parentMap,
        functions,
        withPos,
        withEval,
        withStrict,
        functionDeclarations,
        nextOps,
        continueOps,
        generate,
        generateRaw,
        generateLeft,
        extractQuote,
        generateStaticAccessOps,
        generateIdentifierGet,
        tryResolveStaticAccess,
        isStaticAccessUnchecked,
        allocateInternalName,
    }

    return ctx
}
