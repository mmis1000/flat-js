import * as ts from 'typescript'

import { extractVariable, getFunctionBodyScopeNode, hasParameterExpressions, type Functions, type ParentMap, type Scopes, type VariableRoot } from '../analysis'
import { OpCode, SpecialVariable, STATIC_SLOT_NAMELESS, VariableType } from '../shared'
import { getNameOfKind, markInternals, op } from './helpers'
import { dispatchGenerate } from './dispatch'
import type { Op, Segment, SegmentOptions, StaticAccess } from './types'

type IdentifierWriteOptions = {
    mode: 'initialize' | 'assign'
    freezeConst?: boolean
    popResult?: boolean
}

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
    generateIdentifierWrite(node: ts.Identifier, value: Segment, flag: number, options: IdentifierWriteOptions): Segment
    tryResolveStaticAccess(node: ts.Node, name: string): StaticAccess | null
    isStaticAccessUnchecked(access: StaticAccess): boolean
    getVariableRuntimeName(scopeNode: ts.Node, name: string): string
    allocateInternalName(prefix?: string): string
}

export function createCodegenContext(
    root: VariableRoot,
    scopes: Scopes,
    parentMap: ParentMap,
    functions: Functions,
    evalTaintedFunctions: Set<VariableRoot>,
    { withPos = false, withEval = false, withStrict = false, preserveRuntimeBindingNames = false }: SegmentOptions = {}
): CodegenContext {
    const functionDeclarations: ts.FunctionDeclaration[] = []
    const nextOps = new Map<ts.Node, Op>()
    const continueOps = new Map<ts.Node, Op>()
    let nextInternalNameId = 0
    const staticScopeSlotIndices = new Map<ts.Node, Map<string, number>>()
    const staticResolutionEnabled = !withEval && !evalTaintedFunctions.has(root)
    const preserveAllRuntimeBindingNames = preserveRuntimeBindingNames
        || withEval
        || evalTaintedFunctions.has(root)
        || containsWithStatement(root)
    let preservedRuntimeBindingNames: Map<ts.Node, Set<string>> | null = null
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

    function containsWithStatement(node: ts.Node) {
        let hasWith = false

        const visit = (current: ts.Node) => {
            if (hasWith) {
                return
            }
            if (ts.isWithStatement(current)) {
                hasWith = true
                return
            }
            current.forEachChild(visit)
        }

        visit(node)
        return hasWith
    }

    function addRuntimeNamePreserve(map: Map<ts.Node, Set<string>>, scopeNode: ts.Node, name: string) {
        let names = map.get(scopeNode)
        if (!names) {
            names = new Set()
            map.set(scopeNode, names)
        }
        names.add(name)
    }

    function preserveRuntimeNameEverywhere(map: Map<ts.Node, Set<string>>, name: string) {
        for (const [scopeNode, variables] of scopes) {
            if (variables.has(name)) {
                addRuntimeNamePreserve(map, scopeNode, name)
            }
        }
    }

    function preserveScopeRuntimeNames(map: Map<ts.Node, Set<string>>, scopeNode: ts.Node) {
        for (const name of scopes.get(scopeNode)?.keys() ?? []) {
            addRuntimeNamePreserve(map, scopeNode, name)
        }
    }

    function preserveVariableNames(map: Map<ts.Node, Set<string>>, name: ts.BindingName) {
        for (const variable of extractVariable(name)) {
            preserveRuntimeNameEverywhere(map, variable.text)
        }
    }

    function preserveAssignmentTargetNames(map: Map<ts.Node, Set<string>>, node: ts.Node) {
        const rawNode = extractQuote(node)

        if (ts.isIdentifier(rawNode)) {
            preserveRuntimeNameEverywhere(map, rawNode.text)
            return
        }

        if (ts.isArrayLiteralExpression(rawNode)) {
            for (const element of rawNode.elements) {
                if (ts.isSpreadElement(element)) {
                    preserveAssignmentTargetNames(map, element.expression)
                } else {
                    preserveAssignmentTargetNames(map, element)
                }
            }
            return
        }

        if (ts.isObjectLiteralExpression(rawNode)) {
            for (const property of rawNode.properties) {
                if (ts.isShorthandPropertyAssignment(property)) {
                    preserveRuntimeNameEverywhere(map, property.name.text)
                } else if (ts.isPropertyAssignment(property)) {
                    preserveAssignmentTargetNames(map, property.initializer)
                } else if (ts.isSpreadAssignment(property)) {
                    preserveAssignmentTargetNames(map, property.expression)
                }
            }
        }
    }

    function collectPreservedRuntimeBindingNames() {
        const map = new Map<ts.Node, Set<string>>()

        const visit = (current: ts.Node) => {
            if (current !== root && functions.has(current as VariableRoot)) {
                if (ts.isFunctionDeclaration(current) && current.name) {
                    preserveRuntimeNameEverywhere(map, current.name.text)
                }
                return
            }

            if (ts.isVariableDeclaration(current) && !ts.isIdentifier(current.name)) {
                preserveVariableNames(map, current.name)
            }

            if (ts.isFunctionDeclaration(current) && current.name) {
                preserveRuntimeNameEverywhere(map, current.name.text)
            }

            if (ts.isClassDeclaration(current) && current.name) {
                preserveRuntimeNameEverywhere(map, current.name.text)
            }

            if (ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current)) {
                preserveScopeRuntimeNames(map, current)
            }

            if (ts.isCatchClause(current) && current.variableDeclaration != null) {
                preserveVariableNames(map, current.variableDeclaration.name)
            }

            if (ts.isBinaryExpression(current)) {
                switch (current.operatorToken.kind) {
                    case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
                    case ts.SyntaxKind.BarBarEqualsToken:
                    case ts.SyntaxKind.QuestionQuestionEqualsToken:
                    case ts.SyntaxKind.PercentEqualsToken:
                    case ts.SyntaxKind.AmpersandEqualsToken:
                    case ts.SyntaxKind.BarEqualsToken:
                    case ts.SyntaxKind.CaretEqualsToken:
                    case ts.SyntaxKind.LessThanLessThanEqualsToken:
                    case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
                    case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
                        preserveAssignmentTargetNames(map, current.left)
                        break
                    case ts.SyntaxKind.EqualsToken:
                        if (ts.isArrayLiteralExpression(extractQuote(current.left)) || ts.isObjectLiteralExpression(extractQuote(current.left))) {
                            preserveAssignmentTargetNames(map, current.left)
                        }
                        break
                }
            }

            if (ts.isDeleteExpression(current)) {
                preserveAssignmentTargetNames(map, current.expression)
            }

            current.forEachChild(visit)
        }

        visit(root)
        return map
    }

    function getPreservedRuntimeBindingNames() {
        preservedRuntimeBindingNames ??= collectPreservedRuntimeBindingNames()
        return preservedRuntimeBindingNames
    }

    function canStaticResolveScope(scopeNode: ts.Node) {
        return !(ts.isSourceFile(scopeNode) && !withStrict)
    }

    function isStaticAccessUnchecked(access: StaticAccess) {
        return access.type === VariableType.Var
            || access.type === VariableType.Function
            || access.type === VariableType.Parameter
    }

    function bindingNameAlwaysNeeded(name: string, type: VariableType) {
        return name.startsWith('[')
            || type === VariableType.Function
            || type === VariableType.Parameter
    }

    function getVariableRuntimeName(scopeNode: ts.Node, name: string) {
        if (preserveAllRuntimeBindingNames || !canStaticResolveScope(scopeNode)) {
            return name
        }

        const declaration = scopes.get(scopeNode)?.get(name)
        if (declaration == null || bindingNameAlwaysNeeded(name, declaration.type)) {
            return name
        }

        if (getPreservedRuntimeBindingNames().get(scopeNode)?.has(name)) {
            return name
        }

        return STATIC_SLOT_NAMELESS
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

    function generateIdentifierWrite(
        node: ts.Identifier,
        value: Segment,
        flag: number,
        { mode, freezeConst = false, popResult = true }: IdentifierWriteOptions
    ): Segment {
        const access = tryResolveStaticAccess(node, node.text)
        if (access) {
            return [
                ...value,
                ...generateStaticAccessOps(access),
                op(mode === 'initialize'
                    ? OpCode.SetInitializedStatic
                    : isStaticAccessUnchecked(access)
                        ? OpCode.SetStaticUnchecked
                        : OpCode.SetStatic),
                ...(popResult ? [op(OpCode.Pop)] : []),
                ...(freezeConst
                    ? markInternals([
                        ...generateStaticAccessOps(access),
                        op(OpCode.FreezeVariableStatic),
                    ])
                    : []),
            ]
        }

        return [
            ...generateLeft(node, flag),
            ...(mode === 'assign' ? [op(OpCode.ResolveScope)] : []),
            ...value,
            op(mode === 'initialize' ? OpCode.SetInitialized : OpCode.Set),
            ...(popResult ? [op(OpCode.Pop)] : []),
            ...(freezeConst
                ? markInternals([
                    ...generateLeft(node, flag),
                    op(OpCode.FreezeVariable),
                    op(OpCode.Pop),
                    op(OpCode.Pop),
                ])
                : []),
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
        generateIdentifierWrite,
        tryResolveStaticAccess,
        isStaticAccessUnchecked,
        getVariableRuntimeName,
        allocateInternalName,
    }

    return ctx
}
