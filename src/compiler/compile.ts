import * as ts from 'typescript'

import { collectEvalTaintedFunctions, linkScopes, markParent, resolveScopes, searchFunctionAndScope, type Functions, type ParentMap, type ScopeChild, type Scopes } from './analysis'
import { generateSegment, type Op, type Segment } from './codegen'
import { finalizeLiteralPool, genOffset, generateData } from './encoding'
import { OpCode, type ProgramScopeDebugMap } from './shared'

export type CompileOptions = {
    /** prints debug info to stdout */
    debug?: boolean
    /** generate sourcemap */
    range?: boolean
    /** generate with eval result op inserted */
    evalMode?: boolean
    /** force strict-mode source semantics for direct eval / synthetic entry points */
    withStrict?: boolean
}

export type DebugInfo = {
    sourceMap: [number, number, number, number][]
    internals: boolean[]
    scopeDebugMap: ProgramScopeDebugMap
    /** Byte length of executable code (words before literal pool tail). */
    codeLength: number
}

function createLocationMap(src: string) {
    const locationMap = new Map<number, [number, number]>()
    let row = 0
    let col = 0
    for (let i = 0; i < src.length + 1; i++) {
        locationMap.set(i, [row, col])
        if (src[i] === '\n') {
            row += 1
            col = 0
        } else {
            col++
        }
    }
    return locationMap
}

function normalizeAmbiguousLabeledLetAsi(src: string) {
    // TypeScript parses `label: let // ASI\n...` as a lexical declaration even though,
    // in sloppy script code, ASI makes it `label: let;` followed by the next statement.
    // Replacing the spacer before the line comment with `;` preserves source length while
    // steering the parser to the correct JavaScript statement split.
    return src.replace(/(:\s*let)([ \t]+)(?=\/\/[^\r\n]*(?:\r\n?|\n))/g, (_, prefix: string, whitespace: string) => {
        return `${prefix};${whitespace.slice(1)}`
    })
}

function normalizeAmbiguousWithLetAsi(src: string) {
    // TypeScript also parses `with (...) let // ASI\n...` as a lexical declaration even
    // though JavaScript treats it as `with (...) let;` followed by the next statement.
    return src.replace(/(with\s*\([^)]*\)\s*let)([ \t]+)(?=\/\/[^\r\n]*(?:\r\n?|\n))/g, (_, prefix: string, whitespace: string) => {
        return `${prefix};${whitespace.slice(1)}`
    })
}

function normalizeAmbiguousStatementLetAsi(src: string) {
    // TypeScript similarly parses `if/while/for (...) let // ASI\n...` as a lexical
    // declaration, but sloppy JavaScript treats it as an expression statement `let;`
    // followed by the next statement on the following line.
    return src.replace(/(((?:if|while|for)\s*\([^)]*\)\s*let))([ \t]+)(?=\/\/[^\r\n]*(?:\r\n?|\n))/g, (_, prefix: string, _statement: string, whitespace: string) => {
        return `${prefix};${whitespace.slice(1)}`
    })
}

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

function getStrictContext(node: ts.Node, inheritedStrict: boolean, withStrict: boolean): boolean {
    if (inheritedStrict || withStrict) {
        return true
    }

    if (ts.isClassLike(node)) {
        return true
    }

    if (ts.isSourceFile(node)) {
        return ts.isExternalModule(node) || hasUseStrictDirective(node.statements)
    }

    if (ts.isFunctionLike(node) && 'body' in node && node.body != null && ts.isBlock(node.body)) {
        if (
            ts.isMethodDeclaration(node)
            || ts.isGetAccessorDeclaration(node)
            || ts.isSetAccessorDeclaration(node)
            || ts.isConstructorDeclaration(node)
        ) {
            return true
        }

        if (hasUseStrictDirective(node.body.statements)) {
            return true
        }
    }

    return false
}

const strictModeReservedWords = new Set([
    'implements',
    'interface',
    'let',
    'package',
    'private',
    'protected',
    'public',
    'static',
    'yield',
])

const validateStrictIdentifierReference = (identifier: ts.Identifier, strictContext: boolean) => {
    if (!strictContext) {
        return
    }

    if (
        identifier.text === 'eval'
        || identifier.text === 'arguments'
        || strictModeReservedWords.has(identifier.text)
    ) {
        throwPatternSyntaxError(`invalid identifier reference: ${identifier.text}`)
    }
}

const validateStrictPatternExpression = (node: ts.Node, strictContext: boolean) => {
    if (!strictContext) {
        return
    }

    const visit = (current: ts.Node) => {
        if (ts.isFunctionLike(current) || ts.isClassLike(current)) {
            return
        }

        if (ts.isIdentifier(current)) {
            if (current.text === 'yield') {
                throwPatternSyntaxError('yield is not allowed in strict destructuring expressions')
            }
            return
        }

        if (ts.isPropertyAccessExpression(current)) {
            visit(current.expression)
            return
        }

        if (ts.isElementAccessExpression(current)) {
            visit(current.expression)
            if (current.argumentExpression != null) {
                visit(current.argumentExpression)
            }
            return
        }

        if (ts.isPropertyAssignment(current)) {
            if (ts.isComputedPropertyName(current.name)) {
                visit(current.name.expression)
            }
            visit(current.initializer)
            return
        }

        if (ts.isShorthandPropertyAssignment(current)) {
            if (current.objectAssignmentInitializer != null) {
                visit(current.objectAssignmentInitializer)
            }
            return
        }

        current.forEachChild(visit)
    }

    visit(node)
}

function validateSyntax(sourceNode: ts.SourceFile, locationMap: Map<number, [number, number]>) {
    const servicesHost: ts.CompilerHost = (<Partial<ts.CompilerHost>>{
        getScriptFileNames: () => ['output.ts'],
        getScriptKind: () => ts.ScriptKind.TS,
        getScriptVersion: () => '0',
        useCaseSensitiveFileNames: () => true,
        getDefaultLibFileName: () => 'lib.d.ts',
        getCurrentDirectory: () => '/fake',
        getCanonicalFileName: (str: string) => str,
        getSourceFile: () => sourceNode,
        readFile(fileName) {
            if (fileName === 'lib.d.ts') {
                return ''
            }
            return undefined
        },
        fileExists(fileName) {
            return fileName === 'lib.d.ts'
        },
    }) as ts.CompilerHost

    const program = ts.createProgram(['output.ts'], {}, servicesHost)
    const diagnostics = program.getSyntacticDiagnostics(sourceNode)

    if (diagnostics.length > 0) {
        const errorMessages = diagnostics.map((diagnostic) => {
            const pos = locationMap.get(diagnostic.start ?? -1)
            return `at ${pos?.map((value) => value + 1)?.join(', ') ?? 'unknown'} TS${diagnostic.code} ${diagnostic.messageText}`
        }).join('\r\n')
        throw new SyntaxError(errorMessages)
    }
}

function unwrapParenthesizedExpression(node: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(node)) {
        node = node.expression
    }
    return node
}

function splitAssignmentTarget(node: ts.Expression): { target: ts.Expression, initializer?: ts.Expression } {
    const rawNode = unwrapParenthesizedExpression(node)
    if (ts.isBinaryExpression(rawNode) && rawNode.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        return {
            target: rawNode.left as ts.Expression,
            initializer: rawNode.right,
        }
    }
    return { target: rawNode }
}

function throwPatternSyntaxError(message: string): never {
    throw new SyntaxError(message)
}

function validateBindingPattern(pattern: ts.BindingName, strictContext: boolean) {
    if (ts.isIdentifier(pattern)) {
        validateStrictIdentifierReference(pattern, strictContext)
        return
    }

    if (ts.isArrayBindingPattern(pattern)) {
        for (const [index, element] of pattern.elements.entries()) {
            if (ts.isOmittedExpression(element)) {
                continue
            }

            if (element.dotDotDotToken) {
                if (index !== pattern.elements.length - 1 || !!pattern.elements.hasTrailingComma) {
                    throwPatternSyntaxError('array rest element must be last')
                }
                if (element.initializer != null) {
                    throwPatternSyntaxError('array rest element may not have an initializer')
                }
            }

            validateBindingPattern(element.name, strictContext)
        }
        return
    }

    if (ts.isObjectBindingPattern(pattern)) {
        for (const [index, element] of pattern.elements.entries()) {
            if (element.dotDotDotToken) {
                if (index !== pattern.elements.length - 1) {
                    throwPatternSyntaxError('object rest element must be last')
                }
                if (!ts.isIdentifier(element.name) || element.propertyName != null || element.initializer != null) {
                    throwPatternSyntaxError('object rest element must be a bare identifier')
                }
                validateBindingPattern(element.name, strictContext)
                continue
            }

            validateBindingPattern(element.name, strictContext)
        }
        return
    }
}

function validateAssignmentTarget(target: ts.Expression, strictContext: boolean) {
    const rawTarget = unwrapParenthesizedExpression(target)

    if (ts.isIdentifier(rawTarget)) {
        validateStrictIdentifierReference(rawTarget, strictContext)
        return
    }

    if (ts.isPropertyAccessExpression(rawTarget) || ts.isElementAccessExpression(rawTarget)) {
        if (ts.isOptionalChain(rawTarget)) {
            throwPatternSyntaxError('invalid destructuring assignment target')
        }

        validateStrictPatternExpression(rawTarget.expression, strictContext)
        if (ts.isElementAccessExpression(rawTarget) && rawTarget.argumentExpression != null) {
            validateStrictPatternExpression(rawTarget.argumentExpression, strictContext)
        }
        return
    }

    if (ts.isArrayLiteralExpression(rawTarget) || ts.isObjectLiteralExpression(rawTarget)) {
        validateAssignmentPattern(rawTarget, strictContext)
        return
    }

    throwPatternSyntaxError('invalid destructuring assignment target')
}

function validateAssignmentPattern(pattern: ts.ArrayLiteralExpression | ts.ObjectLiteralExpression, strictContext: boolean) {
    if (ts.isArrayLiteralExpression(pattern)) {
        for (const [index, element] of pattern.elements.entries()) {
            if (ts.isOmittedExpression(element)) {
                continue
            }

            if (ts.isSpreadElement(element)) {
                if (index !== pattern.elements.length - 1 || !!pattern.elements.hasTrailingComma) {
                    throwPatternSyntaxError('array rest element must be last')
                }

                const rawExpression = unwrapParenthesizedExpression(element.expression)
                if (ts.isBinaryExpression(rawExpression) && rawExpression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
                    throwPatternSyntaxError('array rest element may not have an initializer')
                }

                validateAssignmentTarget(rawExpression, strictContext)
                continue
            }

            const { target, initializer } = splitAssignmentTarget(element)
            validateAssignmentTarget(target, strictContext)
            if (initializer != null) {
                validateStrictPatternExpression(initializer, strictContext)
            }
        }
        return
    }

    for (const [index, property] of pattern.properties.entries()) {
        if (ts.isSpreadAssignment(property)) {
            if (index !== pattern.properties.length - 1) {
                throwPatternSyntaxError('object rest element must be last')
            }
            validateAssignmentTarget(property.expression, strictContext)
            continue
        }

        if (ts.isShorthandPropertyAssignment(property)) {
            validateAssignmentTarget(property.name, strictContext)
            if (property.objectAssignmentInitializer != null) {
                validateStrictPatternExpression(property.objectAssignmentInitializer, strictContext)
            }
            continue
        }

        if (ts.isPropertyAssignment(property)) {
            if (ts.isComputedPropertyName(property.name)) {
                validateStrictPatternExpression(property.name.expression, strictContext)
            }

            const { target, initializer } = splitAssignmentTarget(property.initializer)
            validateAssignmentTarget(target, strictContext)
            if (initializer != null) {
                validateStrictPatternExpression(initializer, strictContext)
            }
            continue
        }

        throwPatternSyntaxError('invalid destructuring assignment property')
    }
}

function validateDestructuringSyntax(sourceNode: ts.SourceFile, withStrict: boolean) {
    const isForInOrOfDeclaration = (node: ts.VariableDeclaration) => {
        const list = node.parent
        const parent = list?.parent
        return ts.isVariableDeclarationList(list)
            && parent != null
            && (ts.isForInStatement(parent) || ts.isForOfStatement(parent))
            && parent.initializer === list
    }

    function visit(node: ts.Node, inheritedStrict: boolean) {
        const strictContext = getStrictContext(node, inheritedStrict, withStrict)

        if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name)) {
            validateBindingPattern(node.name, strictContext)
            if (
                !isForInOrOfDeclaration(node)
                && !ts.isCatchClause(node.parent)
                && node.initializer == null
            ) {
                throwPatternSyntaxError('destructuring declarations require an initializer')
            }
        }

        if (ts.isParameter(node) && !ts.isIdentifier(node.name)) {
            validateBindingPattern(node.name, strictContext)
        }

        if (ts.isCatchClause(node) && node.variableDeclaration != null && !ts.isIdentifier(node.variableDeclaration.name)) {
            validateBindingPattern(node.variableDeclaration.name, strictContext)
        }

        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const left = unwrapParenthesizedExpression(node.left)
            if (ts.isArrayLiteralExpression(left) || ts.isObjectLiteralExpression(left)) {
                validateAssignmentPattern(left, strictContext)
            }
        }

        if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
            const target = unwrapParenthesizedExpression(node.initializer)
            if (ts.isArrayLiteralExpression(target) || ts.isObjectLiteralExpression(target)) {
                validateAssignmentPattern(target, strictContext)
            }
        }

        node.forEachChild((child) => visit(child, strictContext))
    }

    visit(sourceNode, false)
}

function validateReferenceSyntax(sourceNode: ts.SourceFile, withStrict: boolean) {
    const validateUpdateTarget = (target: ts.Expression, strictContext: boolean) => {
        const rawTarget = unwrapParenthesizedExpression(target)

        if (rawTarget.kind === ts.SyntaxKind.ThisKeyword) {
            throwPatternSyntaxError('invalid update target')
        }

        if (ts.isMetaProperty(rawTarget)) {
            throwPatternSyntaxError('invalid update target')
        }

        if (ts.isIdentifier(rawTarget)) {
            if (strictContext && (rawTarget.text === 'eval' || rawTarget.text === 'arguments')) {
                throwPatternSyntaxError(`invalid update target: ${rawTarget.text}`)
            }
            return
        }

        if (ts.isPropertyAccessExpression(rawTarget) || ts.isElementAccessExpression(rawTarget)) {
            if (ts.isOptionalChain(rawTarget)) {
                throwPatternSyntaxError('invalid update target')
            }
            return
        }

        throwPatternSyntaxError('invalid update target')
    }

    function visit(node: ts.Node, inheritedStrict: boolean) {
        const strictContext = getStrictContext(node, inheritedStrict, withStrict)

        if (ts.isDeleteExpression(node)) {
            const expression = unwrapParenthesizedExpression(node.expression)
            if (strictContext && ts.isIdentifier(expression)) {
                throwPatternSyntaxError('delete of an unqualified identifier in strict mode')
            }
        }

        if (
            ts.isPrefixUnaryExpression(node)
            && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
        ) {
            validateUpdateTarget(node.operand, strictContext)
        }

        if (ts.isPostfixUnaryExpression(node)) {
            validateUpdateTarget(node.operand, strictContext)
        }

        node.forEachChild((child) => visit(child, strictContext))
    }

    visit(sourceNode, false)
}

function getStaticPropertyName(name: ts.PropertyName): string | null {
    if (ts.isComputedPropertyName(name)) {
        return null
    }
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        return name.text
    }
    if (ts.isNumericLiteral(name)) {
        return String(Number(name.text))
    }
    return null
}

function validateObjectLiteralSyntax(sourceNode: ts.SourceFile) {
    const containsNode = (root: ts.Node, node: ts.Node) => {
        let current: ts.Node | undefined = node
        while (current != null) {
            if (current === root) {
                return true
            }
            current = current.parent
        }
        return false
    }

    const isInsideDestructuringAssignmentPattern = (node: ts.Node) => {
        let current: ts.Node = node
        while (current.parent != null) {
            const parent = current.parent
            if (
                ts.isBinaryExpression(parent)
                && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
                && containsNode(unwrapParenthesizedExpression(parent.left), node)
            ) {
                return true
            }
            if (
                (ts.isForInStatement(parent) || ts.isForOfStatement(parent))
                && !ts.isVariableDeclarationList(parent.initializer)
                && containsNode(unwrapParenthesizedExpression(parent.initializer), node)
            ) {
                return true
            }
            current = parent
        }
        return false
    }

    const visit = (node: ts.Node) => {
        if (ts.isObjectLiteralExpression(node) && !isInsideDestructuringAssignmentPattern(node)) {
            let protoSetterCount = 0
            for (const property of node.properties) {
                if (!ts.isPropertyAssignment(property)) {
                    continue
                }
                if (getStaticPropertyName(property.name) === '__proto__') {
                    protoSetterCount += 1
                    if (protoSetterCount > 1) {
                        throw new SyntaxError('duplicate __proto__ property')
                    }
                }
            }
        }

        node.forEachChild(visit)
    }

    visit(sourceNode)
}

function validateCoalesceSyntax(sourceNode: ts.SourceFile) {
    const isLogicalAndOr = (node: ts.Node) =>
        ts.isBinaryExpression(node)
        && (
            node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
            || node.operatorToken.kind === ts.SyntaxKind.BarBarToken
        )

    const visit = (node: ts.Node) => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
            if (isLogicalAndOr(node.left) || isLogicalAndOr(node.right)) {
                throw new SyntaxError('cannot mix ?? with && or || without parentheses')
            }
        }

        node.forEachChild(visit)
    }

    visit(sourceNode)
}

function toSourceRange(locationMap: Map<number, [number, number]>, start: number, end: number): [number, number, number, number] {
    const startPos = locationMap.get(start)!
    const endPos = locationMap.get(end)!
    return [startPos[0], startPos[1], endPos[0], endPos[1]]
}

export function compile(src: string, { debug = false, range = false, evalMode = false, withStrict = false }: CompileOptions = {}): [number[], DebugInfo] {
    const parentMap: ParentMap = new Map()
    const scopes: Scopes = new Map()
    const functions: Functions = new Set()
    const scopeChild: ScopeChild = new Map()

    const normalizedSrc = normalizeAmbiguousStatementLetAsi(
        normalizeAmbiguousWithLetAsi(
            normalizeAmbiguousLabeledLetAsi(src)
        )
    )
    const sourceNode = ts.createSourceFile('output.ts', normalizedSrc, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
    const locationMap = createLocationMap(normalizedSrc)

    validateSyntax(sourceNode, locationMap)
    validateCoalesceSyntax(sourceNode)
    validateObjectLiteralSyntax(sourceNode)
    validateReferenceSyntax(sourceNode, withStrict)
    validateDestructuringSyntax(sourceNode, withStrict)

    markParent(sourceNode, parentMap)
    searchFunctionAndScope(sourceNode, parentMap, functions, scopes)
    resolveScopes(sourceNode, parentMap, functions, scopes)
    linkScopes(sourceNode, parentMap, scopes, scopeChild)
    const evalTaintedFunctions = collectEvalTaintedFunctions(sourceNode, parentMap, functions)

    const program: Segment[] = []
    const functionToSegment = new Map<ts.Node, Segment>()
    const functionToBodyStart = new Map<ts.Node, Op>()

    for (const item of functions) {
        const generated = generateSegment(item, scopes, parentMap, functions, evalTaintedFunctions, {
            withPos: range,
            withEval: (item.kind === ts.SyntaxKind.SourceFile) && evalMode,
            withStrict,
            preserveRuntimeBindingNames: debug || range
        })
        program.push(generated)
        functionToSegment.set(item, generated)
        const bodyStart = generated.find((op: any) => op.bodyStartMarker) as Op | undefined
        if (!bodyStart) {
            throw new Error('missing function body start marker')
        }
        functionToBodyStart.set(item, bodyStart)
    }

    const flattened = program.flat()

    genOffset(flattened)

    if (debug) {
        /*
        console.error(flattened.map(it => {
            let res = `${it.offset < 10 ? '00' + it.offset : it.offset < 100 ? '0' + it.offset : it.offset} ${OpCode[it.op]} `
            return res
        }).join('\r\n'))
        */
    }

    const literalValues: any[] = []
    const programData: number[] = []
    const scopeDebugMap: ProgramScopeDebugMap = new Map()
    const sourceMap: [number, number, number, number][] = []
    const internals: boolean[] = []

    if (range || debug) {
        for (const item of flattened) {
            if (item.scopeDebugNames && item.scopeDebugNames.length > 0) {
                scopeDebugMap.set(item.offset, [...item.scopeDebugNames])
            }
        }
    }

    if (range) {
        for (const item of flattened) {
            const start = item.offset
            const end = item.offset + item.length
            for (let index = start; index < end; index++) {
                sourceMap[index] = toSourceRange(locationMap, item.source!.start, item.source!.end)
                internals[index] = item.internal
                    || item.op === OpCode.DeTDZ
                    || item.op === OpCode.FreezeVariable
                    || item.op === OpCode.NodeFunctionType
                    || item.op === OpCode.NextEntry
                    || item.op === OpCode.Pop
                    || item.op === OpCode.DuplicateSecond
                    || item.op === OpCode.Swap
                    || item.op === OpCode.Jump
                    || item.op === OpCode.JumpIf
                    || item.op === OpCode.JumpIfAndKeep
                    || item.op === OpCode.JumpIfNot
                    || item.op === OpCode.JumpIfNotAndKeep
                    || item.op === OpCode.NodeOffset
            }
        }
    }

    generateData(flattened, functionToSegment, functionToBodyStart, programData, literalValues)

    const codeLength = programData.length

    finalizeLiteralPool(programData, literalValues)

    return [programData, { sourceMap, internals, scopeDebugMap, codeLength }]
}
