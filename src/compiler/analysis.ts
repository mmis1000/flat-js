import * as ts from 'typescript'

import { SpecialVariable, VariableType } from './shared'

export type VariableDeclaration = {
    type: Exclude<VariableType, VariableType.Function>
} | {
    type: VariableType.Function
    node: ts.Node
}

export type VariableRoot = ts.SourceFile |
    ts.FunctionDeclaration |
    ts.FunctionExpression |
    ts.MethodDeclaration |
    ts.ConstructorDeclaration |
    ts.AccessorDeclaration |
    ts.ArrowFunction

export type ParentMap = Map<ts.Node, { key: string, node: ts.Node }>
export type Scopes = Map<ts.Node, Map<string, VariableDeclaration>>
export type ScopeChild = Map<ts.Node, Set<ts.Node>>
export type Functions = Set<VariableRoot>

function abort(msg: string): never {
    throw new Error(msg)
}

export function findAncient(node: ts.Node, parentMap: ParentMap, predicate: (node: ts.Node) => boolean): ts.Node | undefined
export function findAncient<T extends ts.Node = ts.Node>(node: ts.Node, parentMap: ParentMap, predicate: (node: ts.Node) => node is T): T | undefined
export function findAncient(node: ts.Node, parentMap: ParentMap, predicate: (node: ts.Node) => boolean): ts.Node | undefined {
    let parent: ts.Node | undefined = parentMap.get(node)?.node
    while (parent !== undefined) {
        if (predicate(parent)) {
            return parent
        }

        parent = parentMap.get(parent)?.node
    }
}

export function markParent(node: ts.Node, parentMap: ParentMap) {
    function visit(current: ts.Node) {
        for (const [key, value] of Object.entries(current)) {
            if (key === 'parent') continue

            if (Array.isArray(value)) {
                for (const item of value) {
                    if (item !== null && typeof item === 'object' && typeof item.kind === 'number') {
                        parentMap.set(item, { key, node: current })
                    }
                }
            } else if (value !== null && typeof value === 'object' && typeof value.kind === 'number') {
                parentMap.set(value, { key, node: current })
            }
        }
        current.forEachChild(visit)
    }

    visit(node)
}

export function isScopeRoot(node: ts.Node): node is VariableRoot {
    return ts.isSourceFile(node) || (
        ts.isFunctionLike(node)
        && !ts.isCallSignatureDeclaration(node)
        && !ts.isConstructSignatureDeclaration(node)
        && !ts.isMethodSignature(node)
        && !ts.isIndexSignatureDeclaration(node)
        && !ts.isTypeNode(node)
    )
}

export function extractVariable(node: ts.Identifier | ts.ObjectBindingPattern | ts.ArrayBindingPattern | ts.Node): ts.Identifier[] {
    if (ts.isIdentifier(node)) {
        return [node]
    }

    if (ts.isArrayBindingPattern(node)) {
        let list: ts.Identifier[] = []
        for (const element of node.elements) {
            if (ts.isIdentifier(element)) {
                list.push(element)
            }
            if (ts.isObjectBindingPattern(element) || ts.isArrayBindingPattern(element)) {
                list = [...list, ...extractVariable(element)]
            }
        }
        return list
    }

    if (ts.isObjectBindingPattern(node)) {
        let list: ts.Identifier[] = []
        for (const element of node.elements) {
            if (ts.isIdentifier(element.name) && element.propertyName === undefined) {
                list.push(element.name)
            }

            if (element.propertyName) {
                if (ts.isIdentifier(element.name)) {
                    list.push(element.name)
                }

                if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
                    list = [...list, ...extractVariable(element.name)]
                }
            }
        }
        return list
    }

    return []
}

export function searchFunctionAndScope(node: ts.Node, parentMap: ParentMap, functions: Functions, scopes: Scopes) {
    function visit(current: ts.Node) {
        if (isScopeRoot(current)) {
            functions.add(current)
            scopes.set(current, new Map())
        }

        switch (current.kind) {
            case ts.SyntaxKind.Block: {
                const pair = parentMap.get(current)
                if (
                    pair
                    && pair.key === 'body'
                    && (
                        ts.isConstructorDeclaration(pair.node) ||
                        ts.isFunctionDeclaration(pair.node) ||
                        ts.isFunctionExpression(pair.node) ||
                        ts.isArrowFunction(pair.node) ||
                        ts.isMethodDeclaration(pair.node) ||
                        ts.isAccessor(pair.node)
                    )
                ) {
                    break
                }
            }
            case ts.SyntaxKind.ForStatement:
            case ts.SyntaxKind.ForInStatement:
            case ts.SyntaxKind.ForOfStatement:
            case ts.SyntaxKind.SwitchStatement:
            case ts.SyntaxKind.CaseBlock:
                scopes.set(current, new Map())
        }

        current.forEachChild(visit)
    }

    visit(node)
}

export function resolveScopes(node: ts.Node, parentMap: ParentMap, functions: Functions, scopes: Scopes) {
    function visit(current: ts.Node) {
        if (ts.isVariableDeclarationList(current)) {
            const variables = current.declarations.map((declaration) => extractVariable(declaration.name)).flat()
            const blockScoped = current.flags & ts.NodeFlags.BlockScoped

            const block = blockScoped
                ? findAncient(current, parentMap, (ancestor) => scopes.has(ancestor))
                : findAncient(current, parentMap, (ancestor) => functions.has(ancestor as VariableRoot))

            if (block === undefined) {
                throw new Error('unresolvable variable')
            }

            for (const variable of variables) {
                scopes.get(block)!.set(variable.text, {
                    type: current.flags & ts.NodeFlags.Const ? VariableType.Const :
                        current.flags & ts.NodeFlags.Let ? VariableType.Let :
                            VariableType.Var
                })
            }
        }

        if (ts.isForInStatement(current) || ts.isForOfStatement(current)) {
            scopes.get(current)!.set(SpecialVariable.LoopIterator, {
                type: VariableType.Var
            })
            scopes.get(current)!.set(SpecialVariable.IteratorEntry, {
                type: VariableType.Var
            })
        }

        if (ts.isClassDeclaration(current) && current.name) {
            const block = findAncient(current, parentMap, (ancestor) => scopes.has(ancestor))
            if (block === undefined) {
                throw new Error('unresolvable variable')
            }
            scopes.get(block)!.set(current.name.text, {
                type: VariableType.Let
            })
        }

        if (ts.isFunctionDeclaration(current)) {
            const parentFn = findAncient(current, parentMap, (ancestor) => (functions as Set<ts.Node>).has(ancestor))
            if (parentFn === undefined) {
                throw new Error('unresolvable variable')
            }
            scopes.get(parentFn)!.set(current.name!.text, {
                type: VariableType.Function,
                node: current
            })
        }

        if (ts.isFunctionExpression(current) && current.name) {
            const scope = scopes.get(current)
            if (scope === undefined) {
                throw new Error('unresolvable variable')
            }
            if (!scope.has(current.name.text)) {
                scope.set(current.name.text, {
                    type: VariableType.Function,
                    node: current
                })
            }
        }

        if (ts.isFunctionLike(current)) {
            for (const parameter of current.parameters) {
                const variables = extractVariable(parameter.name)
                const scope = scopes.get(current)
                if (scope === undefined) {
                    throw new Error('unresolvable variable')
                }
                for (const variable of variables) {
                    scope.set(variable.text, {
                        type: VariableType.Parameter
                    })
                }
            }
        }

        current.forEachChild(visit)
    }

    visit(node)
}

export function linkScopes(node: ts.Node, parentMap: ParentMap, scopes: Scopes, scopeChild: ScopeChild) {
    function visit(current: ts.Node) {
        const scope = scopes.get(current)

        if (scope && scope.size > 0) {
            const parent = findAncient(current, parentMap, (ancestor) => (scopes.get(ancestor)?.size ?? 0) > 0)
            if (parent) {
                scopeChild.set(parent, new Set([current, ...(scopeChild.get(parent) ?? new Set())]))
            }
        }

        current.forEachChild(visit)
    }

    visit(node)
}

function unwrapParenthesized(node: ts.Node): ts.Node {
    while (ts.isParenthesizedExpression(node)) {
        node = node.expression
    }
    return node
}

export function collectEvalTaintedFunctions(node: ts.Node, parentMap: ParentMap, functions: Functions) {
    const tainted = new Set<VariableRoot>()

    function visit(current: ts.Node) {
        if (ts.isCallExpression(current)) {
            const callee = unwrapParenthesized(current.expression)
            if (ts.isIdentifier(callee) && callee.text === 'eval') {
                let cursor: ts.Node | undefined = current
                while (cursor) {
                    if (functions.has(cursor as VariableRoot)) {
                        tainted.add(cursor as VariableRoot)
                    }
                    cursor = parentMap.get(cursor)?.node
                }
            }
        }

        current.forEachChild(visit)
    }

    visit(node)

    return tainted
}

/* istanbul ignore next */
function mapVariables(scopes: Scopes, scopeChild: ScopeChild) {
    const hasParent: Set<ts.Node> = new Set()
    for (const value of scopeChild.values()) {
        for (const child of value) {
            hasParent.add(child)
        }
    }

    const roots: Set<ts.Node> = new Set()
    for (const node of scopeChild.keys()) {
        if (!hasParent.has(node)) {
            roots.add(node)
        }
    }

    interface Res {
        names: string[]
        children: Res[]
    }

    function map(node: ts.Node): Res {
        const scope = scopes.get(node)
        if (scope == null) {
            return {
                names: [],
                children: []
            }
        }

        const names = [...scope.entries()].map(([key, value]) => `${key}:${value.type}`)
        const children: Res[] = []

        if (scopeChild.has(node)) {
            for (const child of scopeChild.get(node)!) {
                children.push(map(child))
            }
        }

        return { names, children }
    }

    return [...roots].map(map)
}

export { abort }
