import * as ts from 'typescript'

export const TEXT_DADA_MASK = 0x80000000
export const isSmallNumber = (a: any): a is number => {
    return typeof a === 'number' && ((a | 0) === a) && ((a & TEXT_DADA_MASK) === 0)
}

export const enum VariableType {
    Var = 1,
    Let = 2,
    Const = 3,
    Parameter = 4,
    Function = 5,
}

export const enum SetFlag {
    DeTDZ = 1,
    Freeze = 2
}

type VariableDeclaration = {
    type: Exclude<VariableType, VariableType.Function>
} | {
    type: VariableType.Function
    node: ts.Node
}

type VariableRoot = ts.SourceFile |
    ts.FunctionDeclaration |
    ts.FunctionExpression |
    ts.MethodDeclaration |
    ts.ConstructorDeclaration |
    ts.AccessorDeclaration |
    ts.ArrowFunction

type ParentMap = Map<ts.Node, { key: string, node: ts.Node }>
type Scopes = Map<ts.Node, Map<string, VariableDeclaration>>
type ScopeChild = Map<ts.Node, Set<ts.Node>>
type Functions = Set<VariableRoot>

export const enum OpCode {
    Nop,
    Literal,
    // StringLiteral = 2,
    // NumberLiteral = 3,
    // BooleanLiteral = 4,
    NullLiteral,
    UndefinedLiteral,

    NodeOffset,
    NodeFunctionType,
    /**
     * ```txt
     * Stack:
     *   offset
     *   condition
     * ```
     */
    JumpIfNot,
    Jump,

    /**
     * ```txt
     * Stack:
     *   offset
     *   condition
     * Result
     *   condition
     * ```
     */
    JumpIfAndKeep,
    /**
     * ```txt
     * Stack:
     *   offset
     *   condition
     * Result
     *   condition
     * ```
     */
    JumpIfNotAndKeep,

    // setup arguments, this, and so on
    /** 
     * ```txt
     * Stack:
     *   this
     *   parameter * O
     *   parameter count: O
     *   parameter name * N - reversed
     *   parameter name count: N
     *   [
     *     variable name
     *     variable type
     *   ] * M
     *   variable count: M
     *   function type
     * ```
    */
    EnterFunction,

    // only variable, like `{ let a = 1 }`
    /**
     * ```txt
     * Stack:
     *   [
     *     variable name
     *     variable type
     *   ] * M
     *   variable count: M
     * ```
    */
    EnterScope,
    LeaveScope,

    // stack ops
    Pop,


    /**
     * ```txt
     * Stack:
     *   item
     * Result:
     *   item
     *   item
     */
    Duplicate,

    // variable related
    /** RTL, foo = bar, var foo = bar */
    GetRecord,
    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     *   value
     * Result:
     *   value
     * ```
     */
    Set,
    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     *   value
     * Result:
     *   env or object
     * ```
     */
    SetKeepCtx,
    /**
     * ```txt
     * Stack:
     *   [
     *     name
     *     value
     *     setFlag
     *   ] * M
     *   itemCount - M
     *   env or object
     * Result:
     *   env or object
     * ```
     */
    SetMultiple,
    /**
     * ```txt
     * Stack:
     *   object
     *   name
     *   value
     * Result:
     *   env or object
     * ```
     */
    DefineKeepCtx,
    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     * ```
    */
    Get,
    /**
     * ```txt
     * Stack:
     *   env or object // no consume
     *   name // no consume
     * ```
    */
    DeTDZ,
    /**
     * ```txt
     * Stack:
     *   env or object // no consume
     *   name // no consume
     * ```
    */
    FreezeVariable,

    /**
     * ```tst
     * Stack:
     *   name
     *   nodeOffset
     *   nodeFunctionType
     * ```
     */
    DefineFunction,
    Return,
    ReturnBare,

    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     *   argument * M
     *   argument count - M
     * ```
     */
    Call,

    /**
     * ```txt
     * Stack:
     * ```
     */
    ArrayLiteral,
    /**
     * ```txt
     * Stack:
     * ```
     */
    ObjectLiteral,

    // Binary Operations
    /** + */
    BPlus,
    /** - */
    BMinus,
    /** ^ */
    BCaret,
    /** & */
    BAmpersand,
    /** | */
    BBar,
    /** > */
    BGreaterThan,
    /** >> */
    BGreaterThanGreaterThan,
    /** >>> */
    BGreaterThanGreaterThanGreaterThan,
    /** >= */
    BGreaterThanEquals,
    /** < */
    BLessThan,
    /** << */
    BLessThanLessThan,
    /** <= */
    BLessThanEquals,
    /** == */
    BEqualsEquals,
    /** === */
    BEqualsEqualsEquals,
    /** 
     * ```txt
     * a--
     * Stack:
     *   env or object
     *   name
     * ```
     * 
    */
    PostFixMinusMinus,
    /**
     * ```txt
     * a++
     * Stack:
     *   env or object
     *   name
     * ```
     */
    PostFixPlusPLus,
    /**
     * debugger;
     */
    Debugger,
}

type Op<Code extends OpCode = OpCode> = {
    op: Code
    /** A length of 0 prevent emit of opcode itself */
    length: number
    preData: any[]
    data: number[]
    offset: number
}

type Segment = Op[]

function findAncient(node: ts.Node, parentMap: ParentMap, predicate: (node: ts.Node) => boolean): ts.Node | undefined
function findAncient<T extends ts.Node = ts.Node>(node: ts.Node, parentMap: ParentMap, predicate: (node: ts.Node) => node is T): T | undefined
function findAncient(node: ts.Node, parentMap: ParentMap, predicate: (node: ts.Node) => boolean): ts.Node | undefined {
    let parent: ts.Node | undefined = parentMap.get(node)?.node
    while (parent !== undefined) {
        if (predicate(parent)) {
            return parent
        }

        parent = parentMap.get(parent)?.node
    }
}

function markParent(node: ts.Node, parentMap: ParentMap) {
    function findFunction(node: ts.Node) {
        for (let [key, v] of Object.entries(node)) {
            if (Array.isArray(v)) {
                for (let item of v) {
                    if (item !== null && typeof item === 'object' && typeof item.kind == 'number') {
                        parentMap.set(item, { key, node })
                    }
                }
            } else if (v !== null && typeof v === 'object' && typeof v.kind == 'number') {
                parentMap.set(v, { key, node })
            }
        }
        node.forEachChild(findFunction)
    }
    findFunction(node)
}


function isScopeRoot(node: ts.Node): node is VariableRoot {
    return ts.isSourceFile(node) ||
        (
            ts.isFunctionLike(node)
            && !ts.isCallSignatureDeclaration(node)
            && !ts.isConstructSignatureDeclaration(node)
            && !ts.isMethodSignature(node)
            && !ts.isIndexSignatureDeclaration(node)
            && !ts.isTypeNode(node)
        )
}

function extractVariable(node: ts.Identifier | ts.ObjectBindingPattern | ts.ArrayBindingPattern | ts.Node): ts.Identifier[] {
    if (ts.isIdentifier(node)) {
        return [node]
    }

    if (ts.isArrayBindingPattern(node)) {
        const n = node
        let list: ts.Identifier[] = []
        for (const el of n.elements) {
            if (ts.isIdentifier(el)) {
                list.push(el)
            }
            if (ts.isObjectBindingPattern(el) || ts.isArrayBindingPattern(el)) {
                list = [...list, ...extractVariable(el)]
            }
        }

        return list
    }

    if (ts.isObjectBindingPattern(node)) {
        const n = node
        let list: ts.Identifier[] = []
        for (const el of n.elements) {
            // includes { ...a }
            if (ts.isIdentifier(el.name)) {
                if (el.propertyName === undefined) {
                    list.push(el.name)
                }
            }

            if (el.propertyName) {
                if (ts.isIdentifier(el.name)) {
                    list.push(el.name)
                }

                if (ts.isObjectBindingPattern(el.name) || ts.isArrayBindingPattern(el.name)) {
                    list = [...list, ...extractVariable(el.name)]
                }
            }
        }

        return list
    }

    return []
}

function searchFunctionAndScope(node: ts.Node, parentMap: ParentMap, functions: Functions, scopes: Scopes) {
    function findFunction(node: ts.Node) {
        if (isScopeRoot(node)) {
            functions.add(node)
            scopes.set(node, new Map())
        }

        switch (node.kind) {
            case ts.SyntaxKind.Block:
                let pair = parentMap.get(node)
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
                    break // this is the body of function, method, constructor
                }
            case ts.SyntaxKind.ForStatement:
            case ts.SyntaxKind.CaseBlock:
                scopes.set(node, new Map())
        }
        node.forEachChild(findFunction)
    }
    findFunction(node)
}

function resolveScopes(node: ts.Node, parentMap: ParentMap, functions: Functions, scopes: Scopes) {
    function findFunction(node: ts.Node) {
        if (ts.isVariableDeclarationList(node)) {
            const variables = node.declarations.map(d => extractVariable(d.name)).flat()
            const blockScoped = node.flags & ts.NodeFlags.BlockScoped

            let block

            if (blockScoped) {
                block = findAncient(node, parentMap, node => scopes.has(node))
            } else {
                block = findAncient(node, parentMap, node => functions.has(node as any))
            }

            if (block === undefined) {
                throw new Error('unresolvable variable')
            }

            for (const v of variables) {
                scopes.get(block)!.set(
                    v.text,
                    {
                        type: node.flags & ts.NodeFlags.Const ? VariableType.Const :
                            node.flags & ts.NodeFlags.Let ? VariableType.Let :
                                VariableType.Var
                    }
                )
            }
        }

        if (ts.isFunctionDeclaration(node)) {
            const parentFn = findAncient(node, parentMap, node => (functions as Set<ts.Node>).has(node))

            if (parentFn === undefined) {
                throw new Error('unresolvable variable')
            }

            scopes.get(parentFn)!.set(node.name!.text, {
                type: VariableType.Function,
                node: node
            })
        }

        if (ts.isFunctionLike(node)) {
            for (const el of node.parameters) {
                const variables = extractVariable(el.name)
                const scope = scopes.get(node)

                if (scope === undefined) {
                    throw new Error('unresolvable variable')
                }
                for (const v of variables) {
                    scope.set(
                        v.text,
                        {
                            type: VariableType.Parameter
                        }
                    )
                }
            }
        }

        node.forEachChild(findFunction)
    }
    findFunction(node)
}

function linkScopes(node: ts.Node, parentMap: ParentMap, scopes: Scopes, scopeChild: ScopeChild) {
    function findFunction(node: ts.Node) {
        const item = scopes.get(node)

        if (item && item.size > 0) {
            const parent = findAncient(node, parentMap, node => (scopes.get(node)?.size ?? 0) > 0)
            if (parent) {
                scopeChild.set(parent, new Set([node, ...(scopeChild.get(parent) ?? new Set())]))
            }
        }

        node.forEachChild(findFunction)
    }
    findFunction(node)
}

/* istanbul ignore next */
const mapVariables = (scopes: Scopes, scopeChild: ScopeChild) => {
    const hasParent: Set<ts.Node> = new Set()
    for (let v of scopeChild.values()) {
        for (let v1 of v)
            hasParent.add(v1)
    }

    const roots: Set<ts.Node> = new Set()

    for (let k of scopeChild.keys()) {
        if (!hasParent.has(k)) {
            roots.add(k)
        }
    }

    interface Res {
        names: string[]
        children: Res[]
    }

    function map(node: ts.Node): Res {
        const scope = scopes.get(node)!
        const names = [...scope.entries()].map(([k, v]) => k + ':' + v.type)

        const children: Res[] = []

        if (scopeChild.has(node)) {
            for (const node1 of scopeChild.get(node)!) {
                children.push(map(node1))
            }
        }

        return {
            names,
            children
        }
    }

    return [...roots].map(map)
}


function headOf<T>(arr: T[]): T {
    if (arr.length === 0) {
        throw new Error('empty array')
    }
    return arr[0]!
}

function tailOf<T>(arr: T[]): T {
    if (arr.length === 0) {
        throw new Error('empty array')
    }
    return arr[arr.length - 1]!
}

export function getNameOfKind(kind: ts.SyntaxKind): string {
    let name = ts.SyntaxKind[kind]

    if (name.match(/^First|^Last/)) {
        for (let [k, v] of Object.entries(ts.SyntaxKind)) {
            if (v === kind && k !== name) {
                return k
            }
        }
    }

    return name
}

function op(op: OpCode, length: number = 1, preData: any[] = []): Op<OpCode> {
    return {
        op,
        length,
        preData,
        data: [],
        offset: -1
    }
}

function generateVariableList(node: ts.Node, scopes: Scopes): Op[] {
    const variables = scopes.get(node)!

    return [...variables].map(([name, type]) => [
        op(OpCode.Literal, 2, [name]),
        op(OpCode.Literal, 2, [type.type])
    ]).flat().concat([
        op(OpCode.Literal, 2, [variables.size])
    ])
}

function generateEnterScope(node: ts.Node, scopes: Scopes): Op<OpCode>[] {
    return [
        ...generateVariableList(node, scopes),
        op(OpCode.EnterScope)
    ]
}

function generateLeaveScope(node: ts.Node): Op<OpCode>[] {
    return [
        op(OpCode.LeaveScope)
    ]
}

function generateSegment(node: VariableRoot, scopes: Scopes): Segment {
    let functionDeclarations: ts.FunctionDeclaration[] = []

    function generateLeft(node: ts.Node): Segment {
        if (ts.isIdentifier(node)) {
            return [
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [node.text])
            ]
        }
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
            return [
                ...generate(node.expression),
                op(OpCode.Literal, 2, [node.name.text])
            ]
        }
        if (ts.isElementAccessExpression(node)) {
            return [
                ...generate(node.expression),
                ...generate(node.argumentExpression)
            ]
        }

        throw new Error('not support')
    }
    function generate(node: ts.Node): Segment {
        switch (node.kind) {
            case ts.SyntaxKind.TrueKeyword:
                return [op(OpCode.Literal, 2, [true])]
            case ts.SyntaxKind.FalseKeyword:
                return [op(OpCode.Literal, 2, [false])]
            case ts.SyntaxKind.NullKeyword:
                return [op(OpCode.NullLiteral)]
            case ts.SyntaxKind.EmptyStatement:
                return [op(OpCode.Nop, 0)]
        }

        if (ts.isIdentifier(node) && node.text === 'undefined') {
            return [op(OpCode.UndefinedLiteral)]
        }

        if (ts.isVariableDeclarationList(node)) {
            const ops: Segment = []

            for (let declaration of node.declarations) {
                if (!ts.isIdentifier(declaration.name)) {
                    throw new Error('not support pattern yet')
                }

                if (declaration.initializer) {
                    ops.push(...generateLeft(declaration.name))

                    if (node.flags & ts.NodeFlags.BlockScoped) {
                        ops.push(op(OpCode.DeTDZ))
                    }

                    ops.push(...generate(declaration.initializer))

                    ops.push(op(OpCode.Set))
                    ops.push(op(OpCode.Pop))
                    if (node.flags & ts.NodeFlags.Const) {
                        ops.push(
                            ...generateLeft(declaration.name),
                            op(OpCode.FreezeVariable),
                            op(OpCode.Pop),
                            op(OpCode.Pop)
                        )
                    }
                } else if (node.flags & ts.NodeFlags.Let) {
                    // unblock without doing anything
                    ops.push(
                        ...generateLeft(declaration.name),
                        op(OpCode.DeTDZ),
                        op(OpCode.Pop),
                        op(OpCode.Pop)
                    )
                } else {
                    // a var without value effectively does nothing
                    // the variable already handled by the scope step
                }
            }

            return ops
        }

        if (ts.isVariableStatement(node)) {
            return generate(node.declarationList)
        }

        if (ts.isStringLiteral(node)) {
            return [op(OpCode.Literal, 2, [node.text])]
        }

        if (ts.isExpressionStatement(node)) {
            return [
                ...generate(node.expression),
                op(OpCode.Pop)
            ]
        }

        if (ts.isNumericLiteral(node)) {
            return [op(OpCode.Literal, 2, [Number(node.text)])]
        }

        if (
            ts.isArrowFunction(node)
        ) {
            return [
                op(OpCode.Literal, 2, ['']), // TODO: Fix it
                op(OpCode.NodeOffset, 2, [node]),
                op(OpCode.NodeFunctionType, 2, [node]),
                op(OpCode.DefineFunction)
            ]
        }

        if (
            ts.isConditionalExpression(node)
        ) {
            const condition = generate(node.condition)
            const positive = [op(OpCode.Nop, 0), ...generate(node.whenTrue)]
            const negative = [op(OpCode.Nop, 0), ...generate(node.whenFalse)]
            const end = [op(OpCode.Nop, 0)]

            return [
                op(OpCode.NodeOffset, 2, [headOf(negative)]),
                ...condition,
                op(OpCode.JumpIfNot),

                ...positive,
                op(OpCode.NodeOffset, 2, [headOf(end)]),
                op(OpCode.Jump),

                ...negative,

                ...end
            ]
        }

        if (
            ts.isFunctionExpression(node)
        ) {
            return [
                op(OpCode.Literal, 2, [node.name?.text ?? '']),
                op(OpCode.NodeOffset, 2, [node]),
                op(OpCode.NodeFunctionType, 2, [node]),
                op(OpCode.DefineFunction)
            ]
        }

        // hoist it
        if (
            ts.isFunctionDeclaration(node)
        ) {
            functionDeclarations.push(node)
            return []
        }

        if (ts.isBlock(node)) {
            return [
                ...generateEnterScope(node, scopes),
                ...node.statements.map(generate).flat(),
                ...generateLeaveScope(node)
            ]
        }

        if (ts.isIdentifier(node)) {
            return [
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [node.text]),
                op(OpCode.Get)
            ]
        }
        if (ts.isReturnStatement(node)) {
            if (node.expression !== undefined) {
                return [
                    ...generate(node.expression),
                    op(OpCode.Return)
                ]
            } else {
                return [
                    op(OpCode.ReturnBare)
                ]
            }
        }


        if (ts.isPrefixUnaryExpression(node)) {
            if (ts.isNumericLiteral(node.operand)) {
                if (node.operator === ts.SyntaxKind.MinusToken) {
                    return [
                        op(OpCode.Literal, 2, [-Number(node.operand.text)]),
                    ]
                }
                if (node.operator === ts.SyntaxKind.PlusToken) {
                    return [
                        op(OpCode.Literal, 2, [+Number(node.operand.text)]),
                    ]
                }
            }
        }

        if (ts.isCallExpression(node)) {
            const self = node.expression
            const args = node.arguments.map(generate).flat()

            if (ts.isElementAccessExpression(self) || ts.isPropertyAccessExpression(self) || ts.isIdentifier(self)) {
                const leftOps = generateLeft(self)

                return [
                    ...leftOps,
                    ...args,
                    op(OpCode.Literal, 2, [node.arguments.length]),
                    op(OpCode.Call)
                ]
            } else {
                throw new Error('not support call value yet')
            }
        }

        if (ts.isArrayLiteralExpression(node)) {
            const res = [
                op(OpCode.ArrayLiteral)
            ]
            const list = node.elements
            for (let [index, el] of list.entries()) {
                if (ts.isSpreadElement(el)) {
                    throw new Error('no spread support yet')
                }

                if (el.kind !== ts.SyntaxKind.OmittedExpression) {
                    res.push(op(OpCode.Literal, 2, [index]))
                    res.push(...generate(el))
                    res.push(op(OpCode.SetKeepCtx))
                }
            }

            return res
        }

        if (ts.isObjectLiteralExpression(node)) {
            const res = [
                op(OpCode.ObjectLiteral)
            ]
            const list = node.properties

            for (let item of list) {
                if (ts.isShorthandPropertyAssignment(item)) {
                    res.push(op(OpCode.Literal, 2, [item.name.text]))
                    res.push(...generate(item.name))
                    res.push(op(OpCode.DefineKeepCtx))
                } else {
                    if (!item.name) {
                        throw new Error('property must have name')
                    }

                    if (ts.isComputedPropertyName(item.name)) {
                        res.push(...generate(item.name.expression))
                    } else if (ts.isIdentifier(item.name)) {
                        res.push(op(OpCode.Literal, 2, [item.name.text]))
                    } else if (
                        ts.isStringLiteral(item.name)
                        || ts.isNumericLiteral(item.name)
                    ) {
                        res.push(...generate(item.name))
                    } else {
                        throw new Error('not supported')
                    }

                    if (ts.isMethodDeclaration(item)) {
                        res.push(op(OpCode.Duplicate))
                        res.push(op(OpCode.NodeOffset, 2, [item]))
                        res.push(op(OpCode.NodeFunctionType, 2, [item]))
                        res.push(op(OpCode.DefineFunction))
                        res.push(op(OpCode.DefineKeepCtx))
                    } else if (ts.isPropertyAssignment(item)) {
                        res.push(...generate(item.initializer))
                        res.push(op(OpCode.DefineKeepCtx))
                    } else {
                        throw new Error('not supported')
                    }
                }
            }

            return res
        }

        if (ts.isForStatement(node)) {
            let initializer = node.initializer
            let condition = node.condition
            let incrementor = node.incrementor

            let hasScope = scopes.has(node) && scopes.get(node)!.size > 0


            /**
             *    entry
             * |- condition <-
             * |  body       |
             * |  update ----|
             * -> exit
             */

            var entry0 = hasScope
                ? generateEnterScope(node, scopes)
                : [op(OpCode.Nop, 0)]

            var entry1 = initializer
                ? generate(initializer)
                : [op(OpCode.Nop, 0)]

            var exit = hasScope
                ? [op(OpCode.LeaveScope)]
                : [op(OpCode.Nop, 0)]

            var conditionS = condition
                ? [
                    op(OpCode.NodeOffset, 2, [headOf(exit)]),
                    ...generate(condition),
                    op(OpCode.JumpIfNot)
                ]
                : [
                    op(OpCode.Nop, 0)
                ]

            var update0 = []

            if (hasScope && ts.isVariableDeclarationList(initializer!)) {
                for (let item of initializer.declarations) {
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
                    op(OpCode.LeaveScope),
                    ...generateEnterScope(node, scopes),
                    op(OpCode.GetRecord),
                    op(OpCode.SetMultiple)
                )

                for (let item of initializer.declarations) {
                    if (!ts.isIdentifier(item.name)) {
                        throw new Error('not support')
                    }
                }
            }

            var update1 = incrementor
                ? [
                    ...generate(incrementor),
                    op(OpCode.Pop),
                    op(OpCode.NodeOffset, 2, [headOf(conditionS)]),
                    op(OpCode.Jump)
                ]
                : [
                    op(OpCode.NodeOffset, 2, [headOf(conditionS)]),
                    op(OpCode.Jump)
                ]

            var body = generate(node.statement)

            return [
                ...entry0,
                ...entry1,
                ...conditionS,
                ...body,
                ...update0,
                ...update1,
                ...exit
            ]
        }

        if (ts.isIfStatement(node)) {
            /**
             * |--condition
             * |  whenTrue --|
             * -->whenFalsy  |
             *    exit     <-|
             */

            const exit = [
                op(OpCode.Nop, 0)
            ]

            const whenTrue = [
                op(OpCode.Nop, 0),
                ...generate(node.thenStatement),
                op(OpCode.NodeOffset, 2, [headOf(exit)]),
                op(OpCode.Jump),
            ]

            const whenFalsy = [
                op(OpCode.Nop, 0),
                ...(node.elseStatement !== undefined ? generate(node.elseStatement) : [])
            ]

            const condition = [
                op(OpCode.NodeOffset, 2, [headOf(whenFalsy)]),
                ...generate(node.expression),
                op(OpCode.JumpIfNot)
            ]

            return [...condition, ...whenTrue, ...whenFalsy, ...exit]
        }

        // &&
        if (ts.isBinaryExpression(node)) {
            switch (node.operatorToken.kind) {
                case ts.SyntaxKind.AmpersandAmpersandToken:
                    const left = generate(node.left)
                    const right = generate(node.right)
                    const exit = [op(OpCode.Nop, 0)]
                    /**
                     *   push evaluate left
                     *   if not peak() goto Exit
                     *     pop
                     *     push evaluate right
                     *     goto Exit
                     *   Else:
                     *     push res
                     *   Exit:
                     */
                    return [
                        op(OpCode.NodeOffset, 2, [headOf(exit)]),
                        ...left,
                        op(OpCode.JumpIfNotAndKeep),

                        op(OpCode.Pop),
                        ...right,

                        ...exit
                    ]
                default:
                    // let next block do it
            }
        }

        // ||
        if (ts.isBinaryExpression(node)) {
            switch (node.operatorToken.kind) {
                case ts.SyntaxKind.BarBarToken:
                    const left = generate(node.left)
                    const right = generate(node.right)
                    const exit = [op(OpCode.Nop, 0)]
                    /**
                     *   push evaluate left
                     *   if peak() goto Exit
                     *     pop
                     *     push evaluate right
                     *     goto Exit
                     *   Else:
                     *     push res
                     *   Exit:
                     */
                    return [
                        op(OpCode.NodeOffset, 2, [headOf(exit)]),
                        ...left,
                        op(OpCode.JumpIfAndKeep),

                        op(OpCode.Pop),
                        ...right,

                        ...exit
                    ]
                default:
                    // let next block do it
            }
        }

        // Comma
        if (ts.isBinaryExpression(node)) {
            switch (node.operatorToken.kind) {
                case ts.SyntaxKind.CommaToken:
                    return [
                        ...generate(node.left),
                        op(OpCode.Pop),
                        ...generate(node.right)
                    ]
                default:
                    // let next block do it
            }
        }

        // Assignments
        if (ts.isBinaryExpression(node)) {
            switch (node.operatorToken.kind) {
                case ts.SyntaxKind.EqualsToken:
                    return [
                        ...generateLeft(node.left),
                        ...generate(node.right),
                        op(OpCode.Set)
                    ]
                default:
                    // let next block do it
            }
        }

        if (ts.isBinaryExpression(node)) {
            const ops = [
                ...generate(node.left),
                ...generate(node.right),
            ]

            switch (node.operatorToken.kind) {
                case ts.SyntaxKind.PlusToken:
                    ops.push(op(OpCode.BPlus)); break;
                case ts.SyntaxKind.MinusToken:
                    ops.push(op(OpCode.BMinus)); break;
                case ts.SyntaxKind.CaretToken:
                    ops.push(op(OpCode.BCaret)); break;
                case ts.SyntaxKind.AmpersandToken:
                    ops.push(op(OpCode.BAmpersand)); break;
                case ts.SyntaxKind.BarToken:
                    ops.push(op(OpCode.BBar)); break;
                case ts.SyntaxKind.GreaterThanToken:
                    ops.push(op(OpCode.BGreaterThan)); break;
                case ts.SyntaxKind.GreaterThanGreaterThanToken:
                    ops.push(op(OpCode.BGreaterThanGreaterThan)); break;
                case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
                    ops.push(op(OpCode.BGreaterThanGreaterThanGreaterThan)); break;
                case ts.SyntaxKind.GreaterThanEqualsToken:
                    ops.push(op(OpCode.BGreaterThanEquals)); break;
                case ts.SyntaxKind.LessThanToken:
                    ops.push(op(OpCode.BLessThan)); break;
                case ts.SyntaxKind.LessThanLessThanToken:
                    ops.push(op(OpCode.BLessThanLessThan)); break;
                case ts.SyntaxKind.LessThanEqualsToken:
                    ops.push(op(OpCode.BLessThanEquals)); break;
                case ts.SyntaxKind.EqualsEqualsToken:
                    ops.push(op(OpCode.BEqualsEquals)); break;
                case ts.SyntaxKind.EqualsEqualsEqualsToken:
                    ops.push(op(OpCode.BEqualsEqualsEquals)); break;
                default:
                    const remain = node.operatorToken.kind
                    throw new Error('unknown token')
            }

            return ops
        }

        if (ts.isPostfixUnaryExpression(node)) {
            switch (node.operator) {
                case ts.SyntaxKind.PlusPlusToken:
                    return [
                        ...generateLeft(node.operand),
                        op(OpCode.PostFixPlusPLus)
                    ]
                case ts.SyntaxKind.MinusMinusToken:
                    return [
                        ...generateLeft(node.operand),
                        op(OpCode.PostFixMinusMinus)
                    ]
                default:
                    const nothing = node.operator
            }
        }

        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            return [
                ...generateLeft(node),
                op(OpCode.Get)
            ]
        }

        if (ts.isParenthesizedExpression(node)) {
            return generate(node.expression)
        }

        if (ts.isDebuggerStatement(node)) {
            return [op(OpCode.Debugger)]
        }

        throw new Error(`Unknown node ${getNameOfKind(node.kind)}`)
    }

    let bodyNodes: Op<OpCode>[]

    if (ts.isSourceFile(node)) {
        const statements = [...node.statements]
        bodyNodes = statements.map(generate).flat().concat(op(OpCode.ReturnBare))
    } else if (node.body != undefined && ts.isBlock(node.body)) {
        const statements = [...node.body.statements]
        bodyNodes = statements.map(generate).flat().concat(op(OpCode.ReturnBare))
    } else {
        bodyNodes = [
            ...generate(node.body!),
            op(OpCode.Return)
        ]
    }

    const functionDeclarationNodes = functionDeclarations.map(n => [
        op(OpCode.GetRecord),
        op(OpCode.Literal, 2, [n.name?.text]),
        op(OpCode.Literal, 2, [n.name?.text]),
        op(OpCode.NodeOffset, 2, [n]),
        op(OpCode.NodeFunctionType, 2, [n]),
        op(OpCode.DefineFunction),
        op(OpCode.Set),
        op(OpCode.Pop)
    ]).flat()

    const entry: Op[] = []

    if (ts.isSourceFile(node)) {
        entry.push(op(OpCode.Literal, 2, [0]))
    } else {
        for (let item of [...node.parameters].reverse()) {
            if (!ts.isIdentifier(item.name) || item.dotDotDotToken != null) {
                throw new Error('not support yet')
            }

            entry.push(op(OpCode.Literal, 2, [item.name.text]))
        }
        entry.push(op(OpCode.Literal, 2, [node.parameters.length]))
    }

    entry.push(...generateVariableList(node, scopes))
    entry.push(op(OpCode.NodeFunctionType, 2, [node]))
    entry.push(op(OpCode.EnterFunction))


    return [
        ...entry,
        ...functionDeclarationNodes,
        ...bodyNodes
    ]
}

function genOffset(nodes: Segment) {
    let offset = 0
    for (let seg of nodes) {
        seg.offset = offset
        offset += seg.length
    }
}

function generateData(seg: Segment, fnRootToSegment: Map<ts.Node, Segment>, programData: number[], textData: any[]) {
    for (const op of seg) {
        if (op.length === 0) {
            // not generate anything
        } else if (op.length === 1) {
            programData.push(op.op)
        } else if (op.op === OpCode.NodeOffset) {
            const ptr: any = op.preData[0]
            programData.push(OpCode.Literal)
            if (ptr.kind !== undefined) {
                const nodePtr: ts.Node = ptr
                programData.push(headOf(fnRootToSegment.get(nodePtr)!).offset)
            } else {
                const opPtr: Op = ptr
                programData.push(opPtr.offset)
            }
        } else if (op.op === OpCode.NodeFunctionType) {
            const func: VariableRoot = op.preData[0]
            programData.push(OpCode.Literal)
            programData.push(func.kind)
        } else {
            programData.push(op.op)

            switch (op.op) {
                case OpCode.Literal:
                    if (isSmallNumber(op.preData[0])) {
                        programData.push(op.preData[0])
                    } else {
                        const oldIndex = textData.indexOf(op.preData[0])
                        if (oldIndex >= 0) {
                            programData.push(TEXT_DADA_MASK | oldIndex)
                        } else {
                            programData.push(TEXT_DADA_MASK | (textData.push(op.preData[0]) - 1))
                        }
                    }
                    break;
                default:
                    throw new Error(`Unhandled ${op.op}`)
            }
        }
    }
}

export function compile(src: string, debug = false) {
    const parentMap: ParentMap = new Map()
    const scopes: Scopes = new Map()
    const functions: Functions = new Set()
    const scopeChild: ScopeChild = new Map()

    let sourceNode = ts.createSourceFile('aaa.ts', src, ts.ScriptTarget.ESNext, undefined, ts.ScriptKind.TS)


    markParent(sourceNode, parentMap)
    searchFunctionAndScope(sourceNode, parentMap, functions, scopes)
    resolveScopes(sourceNode, parentMap, functions, scopes)
    linkScopes(sourceNode, parentMap, scopes, scopeChild)

    const program: Segment[] = []

    const functionToSegment = new Map<ts.Node, Segment>()

    for (let item of functions) {
        const generated = generateSegment(item, scopes)
        program.push(generated)
        functionToSegment.set(item, generated)
    }

    const flattened = program.flat()

    genOffset(flattened)

    // @ts-expect-error
    if (debug && typeof OpCode !== 'undefined') {
        console.error(flattened.map(it => {
            // @ts-expect-error
            let res = `${it.offset < 10 ? '00' + it.offset : it.offset < 100 ? '0' + it.offset : it.offset} ${OpCode[it.op]} `
            res += it.preData[0]
                ? it.preData[0].kind
                    ? getNameOfKind(it.preData[0].kind)
                    : JSON.stringify(it.preData[0])
                : JSON.stringify(it.preData[0])
            return res
        }).join('\r\n'))
    }

    const textData: any[] = []
    const programData: number[] = []

    generateData(flattened, functionToSegment, programData, textData)

    return [programData, textData] as [number[], any[]]
}