import * as ts from 'typescript'
import { run } from './runtime';

const source = `
var string = 'string'
let string1:string  = 'string'
function test () {}
const a = () => {}
const c = (a) => 0
console.log(1, 2)
const log = 'log'
console[log](1, 2, 'Hello World')
const b = function (f, u ,g) {
    console[log](1, 2, 'Hello World 3')
}
{
    let c = 0
    console.log(c)
    {
        let c = false ? -1 : 1
        console.log(c)
        {
            let c = true ? 2 : -1
            console.log(c)
            b()
        }
        console.log(c)
    }
    console.log(c)
}
console.log(c)
`;

let a = ts.createSourceFile('aaa.ts', source, ts.ScriptTarget.ESNext, undefined, ts.ScriptKind.TS)

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const parentMap = new Map<ts.Node, { key: string, node: ts.Node }>()

function findAncient(node: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node | undefined
function findAncient<T extends ts.Node = ts.Node>(node: ts.Node, predicate: (node: ts.Node) => node is T): T | undefined
function findAncient(node: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node | undefined {
    let parent: ts.Node | undefined = parentMap.get(node)?.node
    while (parent !== undefined) {
        if (predicate(parent)) {
            return parent
        }

        parent = parentMap.get(parent)?.node
    }
}

function markParent(node: ts.Node) {
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

export const enum VariableType {
    Var = 1,
    Let = 2,
    Const = 3,
    Parameter = 4,
    Function = 5,
}

type VariableDeclaration = {
    type: Exclude<VariableType, VariableType.Function>
} | {
    type: VariableType.Function
    node: ts.Node
}

const scopes = new Map<ts.Node, Map<string, VariableDeclaration>>()
const functions = new Set<VariableRoot>()
const scopeChild = new Map<ts.Node, Set<ts.Node>>()

type VariableRoot = ts.SourceFile|
    ts.FunctionDeclaration |
    ts.FunctionExpression |
    ts.MethodDeclaration |
    ts.ConstructorDeclaration |
    ts.AccessorDeclaration |
    ts.ArrowFunction

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

function searchFunctionAndScope(node: ts.Node) {
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
            case ts.SyntaxKind.CaseBlock:
                scopes.set(node, new Map())
        }
        node.forEachChild(findFunction)
    }
    findFunction(node)
}

function resolveScopes(node: ts.Node) {
    function findFunction(node: ts.Node) {
        if (ts.isVariableDeclarationList(node)) {
            const variables = node.declarations.map(d => extractVariable(d.name)).flat()
            const blockScoped = node.flags & ts.NodeFlags.BlockScoped

            let block

            if (blockScoped) {
                block = findAncient(node, node => scopes.has(node))
            } else {
                block = findAncient(node, node => functions.has(node as any))
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
            const parentFn = findAncient(node, node => (functions as Set<ts.Node>).has(node))

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

function linkScopes(node: ts.Node) {
    function findFunction(node: ts.Node) {
        const item = scopes.get(node)

        if (item && item.size > 0) {
            const parent = findAncient(node, node => (scopes.get(node)?.size ?? 0) > 0)
            if (parent) {
                scopeChild.set(parent, new Set([node, ...(scopeChild.get(parent) ?? new Set())]))
            }
        }

        node.forEachChild(findFunction)
    }
    findFunction(node)
}
markParent(a)
searchFunctionAndScope(a)
resolveScopes(a)
linkScopes(a)

const mapVariables = () => {
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

    function map (node: ts.Node): Res {
        const scope = scopes.get(node)!
        const names = [...scope.entries()].map(([k, v]) => k + ':' +v.type)

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

console.log(mapVariables())

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
    JumpIfNot,
    Jump,

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

    // variable related
    /** RTL, foo = bar, var foo = bar */
    GetRecord,
    /**
     * Stack:
     *   value
     *   env or object
     *   name
     */
    Set,
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
}

type Op<Code extends OpCode = OpCode> = {
    op: Code
    /** A length of 0 prevent emit of opcode itself */
    length: number
    preData: any[]
    data: number[]
    offset: number
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
type Segment = Op[]

const program: Segment[] = []

function getNameOfKind(kind: ts.SyntaxKind): string {
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
    return{
        op,
        length,
        preData,
        data: [],
        offset: -1
    }
}

function generateVariableList(node: ts.Node): Op[] {
    const variables = scopes.get(node)!

    return [...variables].map(([name, type]) => [
        op(OpCode.Literal, 2, [name]),
        op(OpCode.Literal, 2, [type.type])
    ]).flat().concat([
        op(OpCode.Literal, 2, [variables.size])
    ])
}

function generateEnterScope(node: ts.Node): Op<OpCode>[] {
    return [
        ...generateVariableList(node),
        op(OpCode.EnterScope)
    ]
}
function generateLeaveScope(node: ts.Node): Op<OpCode>[] {
    return [
        op(OpCode.LeaveScope)
    ]
}

function generateSegment (node: VariableRoot): Segment {
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
        }
        if (ts.isVariableStatement(node)) {
            const ops: Op[] = []

            for (let declaration of node.declarationList.declarations) {
                if (!ts.isIdentifier(declaration.name)) {
                    throw new Error('not support pattern yet')
                }

                if (declaration.initializer) {
                    ops.push(...generateLeft(declaration.name))

                    if (node.declarationList.flags & ts.NodeFlags.BlockScoped) {
                        ops.push(op(OpCode.DeTDZ))
                    }

                    ops.push(...generate(declaration.initializer))

                    ops.push(op(OpCode.Set))
                    ops.push(op(OpCode.Pop))
                    if (node.declarationList.flags & ts.NodeFlags.Const) {
                        ops.push(
                            ...generateLeft(declaration.name),
                            op(OpCode.FreezeVariable),
                            op(OpCode.Pop),
                            op(OpCode.Pop)
                        )
                    }
                } else if (node.declarationList.flags & ts.NodeFlags.Let) {
                    // unblock without doing anything
                    return [
                        ...generateLeft(declaration.name),
                        op(OpCode.DeTDZ),
                        op(OpCode.Pop),
                        op(OpCode.Pop)
                    ]
                } else {
                    // a var without value effectively does nothing
                    // the variable already handled by the scope step
                    return []
                }
            }

            return ops
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
            const cond = generate(node.condition)
            const positive = [op(OpCode.Nop, 0), ...generate(node.whenTrue)]
            const negative = [op(OpCode.Nop, 0), ...generate(node.whenFalse)]
            const end = [op(OpCode.Nop, 0)]

            return [
                op(OpCode.NodeOffset, 2, [headOf(negative)]),
                ...cond,
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

        if (ts.isMethodDeclaration(node)) {
            return [
                ...generate(node.name),
                op(OpCode.NodeOffset, 2, [node]),
                op(OpCode.NodeFunctionType, 2, [node]),
                op(OpCode.DefineFunction)
            ]
        }

        if (ts.isBlock(node)) {
            return [
                ...generateEnterScope(node),
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
            }
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
        op(OpCode.NodeOffset, 2, [node]),
        op(OpCode.NodeFunctionType, 2, [node]),
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

    entry.push(...generateVariableList(node))
    entry.push(op(OpCode.NodeFunctionType, 2, [node]))
    entry.push(op(OpCode.EnterFunction))


    return [
        ...entry,
        ...functionDeclarationNodes,
        ...bodyNodes
    ]
}

const map = new Map<ts.Node, Segment>()

for (let item of functions) {
    const generated = generateSegment(item)
    program.push(generated)
    map.set(item, generated)
}

const flattened = program.flat()

const genOffset = (nodes: Segment) => {
    let offset = 0
    for (let seg of nodes) {
        seg.offset = offset
        offset += seg.length
    }
}

genOffset(flattened)

// console.log(flattened.map(it => {
//     return `${it.offset} ${OpCode[it.op]} ${it.length} ${it.preData.map(it => it.kind ? getNameOfKind(it.kind) : JSON.stringify(it))}`
// }).join('\r\n'))

export const TEXT_DADA_MASK = 0x80000000
export const isSmallNumber = (a: any): a is number => {
    return typeof a === 'number' && ((a | 0) === a) && ((a & TEXT_DADA_MASK) === 0)
}

const textData: any[] = []
const programData: number[] = []

function generateData (seg: Segment) {
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
                programData.push(headOf(map.get(nodePtr)!).offset)
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

generateData(flattened)

console.log(textData, programData)

// debugger

console.time()
run(programData, textData, 0, [globalThis])
console.timeEnd()