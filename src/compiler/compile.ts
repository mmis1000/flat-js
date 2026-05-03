import * as ts from 'typescript'

import { collectEvalTaintedFunctions, extractVariable, isNonAnnexBFunctionDeclaration, linkScopes, markParent, resolveScopes, searchFunctionAndScope, type Functions, type ParentMap, type ScopeChild, type Scopes } from './analysis'
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
    /** use EvalDeclarationInstantiation source-file entry semantics; internal runtime eval only */
    runtimeEval?: boolean
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

        const raw = statement.expression.getText()
        if (raw === "'use strict'" || raw === '"use strict"') {
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

const javascriptEarlyErrorSemanticDiagnosticCodes = new Set([
    1013, // Rest parameter or binding pattern cannot have a trailing comma.
    1014, // Rest parameter must be last in a parameter list.
    1042, // 'async' modifier cannot be used here.
    1048, // Rest parameter cannot have an initializer.
    1052, // Set accessor parameter cannot have an initializer.
    1054, // Get accessor cannot have parameters.
    1089, // 'async' modifier cannot appear on a constructor declaration.
    1091, // Only a single variable declaration is allowed in a for-in statement.
    1100, // Invalid use of 'eval' / 'arguments' in strict mode.
    1101, // 'with' statements are not allowed in strict mode.
    1102, // 'delete' cannot be called on an identifier in strict mode.
    1104, // Continue statement outside an enclosing iteration statement.
    1105, // Break statement outside an enclosing iteration or switch statement.
    1106, // The left-hand side of a for-of statement may not be 'async'.
    1107, // Jump target cannot cross function boundary.
    1108, // Return statement outside a function body.
    1113, // Switch statement cannot have more than one default clause.
    1114, // Duplicate label.
    1115, // Continue statement cannot jump to a non-iteration label.
    1116, // Break statement cannot jump outside an enclosing label.
    1123, // Variable declaration list cannot be empty.
    1142, // Line break not permitted here.
    1163, // Yield expression is only allowed in a generator body.
    1186, // Rest element cannot have an initializer.
    1189, // For-in variable declaration cannot have an initializer.
    1190, // For-of variable declaration cannot have an initializer.
    1198, // Unicode escape value must be in range.
    1199, // Unicode escape sequence cannot be empty.
    1200, // Line terminator not permitted before arrow.
    1210, // Class strict mode disallows this use of 'arguments'.
    1212, // Strict-mode reserved word cannot be used as an identifier.
    1213, // 'yield' is reserved in strict mode and class bodies.
    1312, // '=' after an object literal property name only belongs in destructuring.
    1341, // Class constructor may not be an accessor.
    1346, // Use strict directive cannot be used with this parameter list.
    1347, // Use strict directive cannot appear with a non-simple parameter list.
    1358, // Tagged template expressions are not permitted in an optional chain.
    1359, // 'await' is reserved in this context.
    1368, // Class constructor may not be a generator.
    1499, // Unknown regular expression flag.
    1500, // Duplicate regular expression flag.
    1504, // Invalid regular expression subpattern flags.
    1507, // Invalid regular expression repetition.
    1508, // Unexpected regular expression '{'.
    1509, // Invalid regular expression subpattern flag toggle.
    1510, // Invalid regular expression named backreference.
    1512, // Invalid regular expression control escape.
    1514, // Invalid regular expression group name.
    1515, // Invalid duplicate regular expression named capture groups.
    1516, // Invalid regular expression character class range.
    1532, // Regular expression references a missing named capture group.
    1534, // Regular expression backreference group does not exist.
    1535, // Invalid regular expression escape.
    2335, // 'super' can only be referenced in a derived class.
    2337, // Super calls are only permitted in derived constructors.
    2364, // Invalid assignment left-hand side.
    2392, // Class bodies cannot contain multiple constructor implementations.
    2451, // Block-scoped redeclaration.
    2462, // Rest element must be last in a destructuring pattern.
    2480, // 'let' cannot be a let/const declaration name.
    2481, // Var declaration conflicts with a block-scoped declaration.
    2492, // Cannot redeclare catch parameter identifier.
    2523, // 'yield' cannot be used in a parameter initializer.
    2524, // 'await' cannot be used in a parameter initializer.
    2660, // 'super' can only be referenced in valid class/object members.
    2777, // Optional property access cannot be used as an update operand.
    2779, // Optional property access cannot be used as an assignment target.
    2813, // Class declaration cannot merge with a function declaration.
    2814, // Function declaration cannot merge with a class declaration.
    2815, // 'arguments' cannot be referenced in property initializers.
    5076, // Nullish coalescing cannot be mixed with && / || without parentheses.
    17013, // 'new.target' is only allowed in functions and constructors.
])

const strictOnlySemanticDiagnosticCodes = new Set([
    1100, // Invalid use of 'eval' / 'arguments' in strict mode.
    1101, // 'with' statements are not allowed in strict mode.
    1102, // 'delete' cannot be called on an identifier in strict mode.
    1210, // Class strict mode disallows this use of 'arguments'.
    1212, // Strict-mode reserved word cannot be used as an identifier.
    1213, // 'yield' is reserved in strict mode and class bodies.
])

const nonStrictLegacyLiteralDiagnosticCodes = new Set([
    1121, // Legacy octal numeric literals are allowed in sloppy script code.
    1487, // Legacy octal string escapes are allowed in sloppy script code.
    1488, // Non-octal decimal string escapes are allowed in sloppy script code.
    1489, // Non-octal decimal integer literals are allowed in sloppy script code.
])

function findSmallestNodeContainingSpan(root: ts.SourceFile, start: number, end: number): ts.Node | null {
    let found: ts.Node | null = null

    const visit = (node: ts.Node) => {
        const nodeStart = node.getStart(root, false)
        const nodeEnd = node.getEnd()
        if (nodeStart <= start && end <= nodeEnd) {
            if (found == null || nodeEnd - nodeStart < found.getEnd() - found.getStart(root, false)) {
                found = node
            }
            node.forEachChild(visit)
        }
    }

    visit(root)
    return found
}

function isNodeInStrictContext(node: ts.Node, withStrict: boolean): boolean {
    const ancestry: ts.Node[] = []
    let current: ts.Node | undefined = node
    while (current != null) {
        ancestry.unshift(current)
        current = current.parent
    }

    let strictContext = false
    for (const item of ancestry) {
        strictContext = getStrictContext(item, strictContext, withStrict)
    }
    return strictContext
}

function isNonStrictOnlySemanticDiagnostic(sourceNode: ts.SourceFile, diagnostic: ts.Diagnostic, withStrict: boolean): boolean {
    if (!strictOnlySemanticDiagnosticCodes.has(diagnostic.code) || diagnostic.start == null) {
        return false
    }

    const node = findSmallestNodeContainingSpan(sourceNode, diagnostic.start, diagnostic.start + (diagnostic.length ?? 0))
    return node != null && !isNodeInStrictContext(node, withStrict)
}

function isNonStrictLegacyLiteralDiagnostic(sourceNode: ts.SourceFile, diagnostic: ts.Diagnostic, withStrict: boolean): boolean {
    if (!nonStrictLegacyLiteralDiagnosticCodes.has(diagnostic.code) || diagnostic.start == null) {
        return false
    }

    const node = findSmallestNodeContainingSpan(sourceNode, diagnostic.start, diagnostic.start + (diagnostic.length ?? 0))
    return node != null
        && !isNodeInStrictContext(node, withStrict)
        && (ts.isStringLiteral(node) || ts.isNumericLiteral(node))
}

function validateSyntax(sourceNode: ts.SourceFile, locationMap: Map<number, [number, number]>, withStrict: boolean) {
    const validationSourceNode = ts.createSourceFile(
        'output.ts',
        sourceNode.text,
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.TS
    )
    const servicesHost: ts.CompilerHost = (<Partial<ts.CompilerHost>>{
        getScriptFileNames: () => ['output.ts'],
        getScriptKind: () => ts.ScriptKind.TS,
        getScriptVersion: () => '0',
        useCaseSensitiveFileNames: () => true,
        getDefaultLibFileName: () => 'lib.d.ts',
        getCurrentDirectory: () => '/fake',
        getCanonicalFileName: (str: string) => str,
        getSourceFile(fileName) {
            if (fileName === 'output.ts') {
                return validationSourceNode
            }
            if (fileName === 'lib.d.ts') {
                return ts.createSourceFile(fileName, '', ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
            }
            return undefined
        },
        readFile(fileName) {
            if (fileName === 'lib.d.ts') {
                return ''
            }
            return undefined
        },
        fileExists(fileName) {
            return fileName === 'output.ts' || fileName === 'lib.d.ts'
        },
    }) as ts.CompilerHost

    const program = ts.createProgram(['output.ts'], { target: ts.ScriptTarget.ESNext, noLib: true }, servicesHost)
    const syntacticDiagnostics = program.getSyntacticDiagnostics(validationSourceNode).filter((diagnostic) => (
        !isNonStrictLegacyLiteralDiagnostic(sourceNode, diagnostic, withStrict)
    ))
    const diagnostics = syntacticDiagnostics.length > 0
        ? syntacticDiagnostics
        : program.getSemanticDiagnostics(validationSourceNode).filter((diagnostic) => (
            javascriptEarlyErrorSemanticDiagnosticCodes.has(diagnostic.code)
            && !isNonStrictOnlySemanticDiagnostic(sourceNode, diagnostic, withStrict)
            && !isWebCompatFunctionCallAssignmentDiagnostic(validationSourceNode, diagnostic)
        ))

    if (diagnostics.length > 0) {
        const errorMessages = diagnostics.map((diagnostic) => {
            const pos = locationMap.get(diagnostic.start ?? -1)
            return `at ${pos?.map((value) => value + 1)?.join(', ') ?? 'unknown'} TS${diagnostic.code} ${diagnostic.messageText}`
        }).join('\r\n')
        throw new SyntaxError(errorMessages)
    }
}

function findSmallestNodeAtSpan(root: ts.SourceFile, start: number, end: number): ts.Node | null {
    let found: ts.Node | null = null

    const visit = (node: ts.Node) => {
        if (node.getStart(root, false) === start && node.getEnd() === end) {
            found = node
        }

        node.forEachChild(visit)
    }

    visit(root)
    return found
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

function isAssignmentOperatorToken(kind: ts.SyntaxKind) {
    return kind === ts.SyntaxKind.EqualsToken
        || kind === ts.SyntaxKind.PlusEqualsToken
        || kind === ts.SyntaxKind.MinusEqualsToken
        || kind === ts.SyntaxKind.AsteriskEqualsToken
        || kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken
        || kind === ts.SyntaxKind.SlashEqualsToken
        || kind === ts.SyntaxKind.PercentEqualsToken
        || kind === ts.SyntaxKind.LessThanLessThanEqualsToken
        || kind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken
        || kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken
        || kind === ts.SyntaxKind.AmpersandEqualsToken
        || kind === ts.SyntaxKind.BarEqualsToken
        || kind === ts.SyntaxKind.CaretEqualsToken
        || kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken
        || kind === ts.SyntaxKind.BarBarEqualsToken
        || kind === ts.SyntaxKind.QuestionQuestionEqualsToken
}

function isWebCompatFunctionCallAssignmentOperator(kind: ts.SyntaxKind) {
    return isAssignmentOperatorToken(kind)
        && kind !== ts.SyntaxKind.AmpersandAmpersandEqualsToken
        && kind !== ts.SyntaxKind.BarBarEqualsToken
        && kind !== ts.SyntaxKind.QuestionQuestionEqualsToken
}

function isWebCompatFunctionCallAssignmentDiagnostic(sourceNode: ts.SourceFile, diagnostic: ts.Diagnostic) {
    if (diagnostic.code !== 2364 || diagnostic.start == null || diagnostic.length == null) {
        return false
    }

    const node = findSmallestNodeAtSpan(sourceNode, diagnostic.start, diagnostic.start + diagnostic.length)
    if (node == null || !ts.isExpression(node) || !ts.isCallExpression(unwrapParenthesizedExpression(node))) {
        return false
    }

    let target: ts.Node = node
    while (target.parent != null && ts.isParenthesizedExpression(target.parent)) {
        target = target.parent
    }

    // V8/browser-compatible hosts evaluate call-expression assignment targets and
    // throw ReferenceError at runtime. Logical assignment stays an early SyntaxError.
    return target.parent != null
        && ts.isBinaryExpression(target.parent)
        && target.parent.left === target
        && isWebCompatFunctionCallAssignmentOperator(target.parent.operatorToken.kind)
}

function throwPatternSyntaxError(message: string): never {
    throw new SyntaxError(message)
}

function isClassFieldArgumentsBoundary(node: ts.Node): boolean {
    return ts.isClassLike(node) || (ts.isFunctionLike(node) && !ts.isArrowFunction(node))
}

function containsClassFieldArgumentsReference(node: ts.Node): boolean {
    if (isClassFieldArgumentsBoundary(node)) {
        return false
    }

    let found = false

    const visit = (current: ts.Node) => {
        if (found) {
            return
        }

        if (ts.isIdentifier(current) && current.text === 'arguments') {
            found = true
            return
        }

        if (current !== node && isClassFieldArgumentsBoundary(current)) {
            return
        }

        current.forEachChild(visit)
    }

    visit(node)
    return found
}

function validateClassFieldArgumentsSyntax(sourceNode: ts.SourceFile) {
    const visit = (node: ts.Node) => {
        if (ts.isClassLike(node)) {
            for (const member of node.members) {
                if (ts.isPropertyDeclaration(member) && member.initializer != null) {
                    if (containsClassFieldArgumentsReference(member.initializer)) {
                        throwPatternSyntaxError('arguments is not allowed in class field initializer')
                    }
                }

                if (ts.isClassStaticBlockDeclaration(member)) {
                    if (containsClassFieldArgumentsReference(member)) {
                        throwPatternSyntaxError('arguments is not allowed in class static initialization block')
                    }
                }
            }
        }

        node.forEachChild(visit)
    }

    visit(sourceNode)
}

function isStaticClassElement(member: ts.ClassElement): boolean {
    return ts.canHaveModifiers(member)
        && ts.getModifiers(member)?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) === true
}

function validateClassStaticElementSyntax(sourceNode: ts.SourceFile) {
    const visit = (node: ts.Node) => {
        if (ts.isClassLike(node)) {
            for (const member of node.members) {
                if (
                    isStaticClassElement(member)
                    && (
                        ts.isMethodDeclaration(member)
                        || ts.isGetAccessorDeclaration(member)
                        || ts.isSetAccessorDeclaration(member)
                    )
                    && getStaticPropertyName(member.name) === 'prototype'
                ) {
                    throwPatternSyntaxError('static class method may not be named prototype')
                }
            }
        }

        node.forEachChild(visit)
    }

    visit(sourceNode)
}

function validateVariableDeclarationSyntax(sourceNode: ts.SourceFile) {
    const isForInOrOfDeclaration = (node: ts.VariableDeclaration) => {
        const list = node.parent
        const parent = list?.parent
        return ts.isVariableDeclarationList(list)
            && parent != null
            && (ts.isForInStatement(parent) || ts.isForOfStatement(parent))
            && parent.initializer === list
    }

    const visit = (node: ts.Node) => {
        if (
            ts.isVariableDeclaration(node)
            && ts.isVariableDeclarationList(node.parent)
            && (node.parent.flags & ts.NodeFlags.Const) !== 0
            && node.initializer == null
            && !isForInOrOfDeclaration(node)
        ) {
            throwPatternSyntaxError('const declarations require an initializer')
        }

        node.forEachChild(visit)
    }

    visit(sourceNode)
}

function validateMetaPropertySyntax(sourceNode: ts.SourceFile) {
    const visit = (node: ts.Node) => {
        if (
            ts.isMetaProperty(node)
            && node.keywordToken === ts.SyntaxKind.NewKeyword
            && node.name.text === 'target'
            && node.name.getText(sourceNode) !== 'target'
        ) {
            throwPatternSyntaxError('new.target must not contain escaped characters')
        }

        node.forEachChild(visit)
    }

    visit(sourceNode)
}

function validateScriptDeclarationSyntax(sourceNode: ts.SourceFile) {
    const restrictedGlobalLexicalNames = new Set(['undefined', 'NaN', 'Infinity'])
    const lexicalNames = new Set<string>()

    const collectDirectLexicalNames = (statement: ts.Statement): string[] => {
        if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0) {
            return statement.declarationList.declarations.flatMap((declaration) =>
                extractVariable(declaration.name).map((identifier) => identifier.text)
            )
        }

        if (ts.isClassDeclaration(statement) && statement.name != null) {
            return [statement.name.text]
        }

        return []
    }

    for (const statement of sourceNode.statements) {
        for (const name of collectDirectLexicalNames(statement)) {
            if (lexicalNames.has(name)) {
                throwPatternSyntaxError('duplicate script lexical declaration')
            }
            if (restrictedGlobalLexicalNames.has(name)) {
                throwPatternSyntaxError('restricted global lexical declaration')
            }

            lexicalNames.add(name)
        }
    }
}

function unwrapLabeledStatementItem(statement: ts.Statement): ts.Statement {
    let current = statement

    while (ts.isLabeledStatement(current)) {
        current = current.statement
    }

    return current
}

function hasLabeledStatementWrapper(statement: ts.Statement): boolean {
    return ts.isLabeledStatement(statement)
}

function isInvalidSingleStatementBody(statement: ts.Statement): boolean {
    const item = unwrapLabeledStatementItem(statement)

    if (ts.isVariableStatement(item)) {
        return !!(item.declarationList.flags & ts.NodeFlags.BlockScoped)
    }

    return ts.isClassDeclaration(item) || ts.isFunctionDeclaration(item)
}

function isInvalidIfStatementBody(statement: ts.Statement, strictContext: boolean): boolean {
    const item = unwrapLabeledStatementItem(statement)

    if (ts.isVariableStatement(item)) {
        return !!(item.declarationList.flags & ts.NodeFlags.BlockScoped)
    }

    if (ts.isClassDeclaration(item)) {
        return true
    }

    if (ts.isFunctionDeclaration(item)) {
        return strictContext || hasLabeledStatementWrapper(statement) || isNonAnnexBFunctionDeclaration(item)
    }

    return false
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

function isSimpleParameterList(node: ts.FunctionLikeDeclarationBase): boolean {
    return node.parameters.every((parameter) =>
        parameter.dotDotDotToken == null
        && parameter.initializer == null
        && ts.isIdentifier(parameter.name)
    )
}

function isAsyncFunctionLike(node: ts.FunctionLikeDeclarationBase): boolean {
    return ts.canHaveModifiers(node)
        && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true
}

function isGeneratorFunctionLike(node: ts.FunctionLikeDeclarationBase): boolean {
    return 'asteriskToken' in node && node.asteriskToken != null
}

function isRuntimeFunctionLikeDeclaration(node: ts.Node): node is ts.FunctionLikeDeclarationBase {
    return ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node)
        || ts.isMethodDeclaration(node)
        || ts.isConstructorDeclaration(node)
        || ts.isGetAccessorDeclaration(node)
        || ts.isSetAccessorDeclaration(node)
}

function validateFunctionParameterSyntax(sourceNode: ts.SourceFile, withStrict: boolean) {
    const throwForbiddenIdentifierSyntaxError = (identifier: string) => {
        throwPatternSyntaxError(`${identifier} is not allowed in this function context`)
    }

    const isIdentifierNameOnly = (node: ts.Identifier): boolean => {
        const parent = node.parent
        if (parent == null) {
            return false
        }

        return (
            (ts.isBindingElement(parent) && parent.propertyName === node)
            || (ts.isPropertyAssignment(parent) && parent.name === node)
            || (ts.isPropertyAccessExpression(parent) && parent.name === node)
            || (ts.isMethodDeclaration(parent) && parent.name === node)
            || (ts.isGetAccessorDeclaration(parent) && parent.name === node)
            || (ts.isSetAccessorDeclaration(parent) && parent.name === node)
            || (ts.isPropertyDeclaration(parent) && parent.name === node)
            || (ts.isLabeledStatement(parent) && parent.label === node)
            || (ts.isBreakStatement(parent) && parent.label === node)
            || (ts.isContinueStatement(parent) && parent.label === node)
        )
    }

    const validateBindingNameDoesNotUse = (name: ts.BindingName, identifier: string) => {
        for (const bindingIdentifier of extractVariable(name)) {
            if (bindingIdentifier.text === identifier) {
                throwForbiddenIdentifierSyntaxError(identifier)
            }
        }
    }

    const validateDeclarationIdentifierDoesNotUse = (name: ts.Identifier | undefined, identifier: string) => {
        if (name?.text === identifier) {
            throwForbiddenIdentifierSyntaxError(identifier)
        }
    }

    const validateParameterSyntaxDoesNotUse = (node: ts.Node, identifier: string): void => {
        if (ts.isArrowFunction(node)) {
            for (const parameter of node.parameters) {
                validateParameterSyntaxDoesNotUse(parameter, identifier)
            }
            return
        }

        if (ts.isFunctionLike(node)) {
            return
        }

        if (ts.isClassLike(node)) {
            validateDeclarationIdentifierDoesNotUse(node.name, identifier)
            return
        }

        if (ts.isIdentifier(node)) {
            if (node.text === identifier && !isIdentifierNameOnly(node)) {
                throwForbiddenIdentifierSyntaxError(identifier)
            }
            return
        }

        node.forEachChild((child) => validateParameterSyntaxDoesNotUse(child, identifier))
    }

    const validateBodyBindingsDoNotUse = (body: ts.Block | ts.ConciseBody, identifier: string) => {
        const visit = (node: ts.Node): void => {
            if (ts.isArrowFunction(node)) {
                for (const parameter of node.parameters) {
                    validateParameterSyntaxDoesNotUse(parameter, identifier)
                }
                return
            }

            if (ts.isFunctionDeclaration(node)) {
                validateDeclarationIdentifierDoesNotUse(node.name, identifier)
                return
            }

            if (ts.isFunctionLike(node)) {
                return
            }

            if (ts.isClassLike(node)) {
                validateDeclarationIdentifierDoesNotUse(node.name, identifier)
                return
            }

            if (ts.isVariableDeclaration(node)) {
                validateBindingNameDoesNotUse(node.name, identifier)
                if (node.initializer != null) {
                    visit(node.initializer)
                }
                return
            }

            if (ts.isCatchClause(node) && node.variableDeclaration != null) {
                validateBindingNameDoesNotUse(node.variableDeclaration.name, identifier)
                visit(node.block)
                return
            }

            node.forEachChild(visit)
        }

        visit(body)
    }

    const validateDuplicateParameterNames = (node: ts.FunctionLikeDeclarationBase, strictContext: boolean) => {
        const names = new Set<string>()
        const rejectDuplicates = ts.isArrowFunction(node)
            || strictContext
            || !isSimpleParameterList(node)
            || isAsyncFunctionLike(node)
            || isGeneratorFunctionLike(node)

        for (const parameter of node.parameters) {
            for (const identifier of extractVariable(parameter.name)) {
                if (names.has(identifier.text) && rejectDuplicates) {
                    throwPatternSyntaxError('duplicate function parameter')
                }
                names.add(identifier.text)
            }
        }
    }

    const validateGeneratorYieldIdentifiers = (node: ts.FunctionLikeDeclarationBase, strictContext: boolean) => {
        if (!isGeneratorFunctionLike(node)) {
            return
        }

        if (ts.isFunctionExpression(node) || (strictContext && ts.isFunctionDeclaration(node))) {
            validateDeclarationIdentifierDoesNotUse(node.name, 'yield')
        }

        for (const parameter of node.parameters) {
            validateParameterSyntaxDoesNotUse(parameter, 'yield')
        }

        if ('body' in node && node.body != null) {
            validateBodyBindingsDoNotUse(node.body, 'yield')
        }
    }

    const validateAsyncAwaitIdentifiers = (node: ts.FunctionLikeDeclarationBase) => {
        if (!isAsyncFunctionLike(node)) {
            return
        }

        for (const parameter of node.parameters) {
            validateParameterSyntaxDoesNotUse(parameter, 'await')
        }

        if ('body' in node && node.body != null) {
            validateBodyBindingsDoNotUse(node.body, 'await')
        }
    }

    const validateParameterBodyLexicalConflicts = (node: ts.FunctionLikeDeclarationBase) => {
        if (!('body' in node) || node.body == null || !ts.isBlock(node.body)) {
            return
        }

        const parameterNames = new Set(node.parameters.flatMap((parameter) =>
            extractVariable(parameter.name).map((identifier) => identifier.text)
        ))
        if (parameterNames.size === 0) {
            return
        }

        for (const statement of node.body.statements) {
            if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.BlockScoped) {
                for (const declaration of statement.declarationList.declarations) {
                    for (const identifier of extractVariable(declaration.name)) {
                        if (parameterNames.has(identifier.text)) {
                            throwPatternSyntaxError('function parameter conflicts with body lexical declaration')
                        }
                    }
                }
            }

            if (ts.isClassDeclaration(statement) && statement.name != null && parameterNames.has(statement.name.text)) {
                throwPatternSyntaxError('function parameter conflicts with body lexical declaration')
            }
        }
    }

    const visit = (node: ts.Node, inheritedStrict: boolean) => {
        const strictContext = getStrictContext(node, inheritedStrict, withStrict)

        if (isRuntimeFunctionLikeDeclaration(node)) {
            validateDuplicateParameterNames(node, strictContext)
            validateGeneratorYieldIdentifiers(node, strictContext)
            validateAsyncAwaitIdentifiers(node)
            validateParameterBodyLexicalConflicts(node)
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

        if (ts.isBinaryExpression(node) && isAssignmentOperatorToken(node.operatorToken.kind)) {
            const target = unwrapParenthesizedExpression(node.left)
            if (ts.isIdentifier(target)) {
                validateStrictIdentifierReference(target, strictContext)
            }
        }

        if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
            const target = unwrapParenthesizedExpression(node.initializer)
            if (strictContext && ts.isCallExpression(target)) {
                throwPatternSyntaxError('invalid strict loop assignment target')
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

function validateLoopSyntax(sourceNode: ts.SourceFile, withStrict: boolean) {
    const validateLoopAssignmentTarget = (target: ts.Expression, strictContext: boolean) => {
        const rawTarget = unwrapParenthesizedExpression(target)

        if (rawTarget.kind === ts.SyntaxKind.ThisKeyword || ts.isMetaProperty(rawTarget)) {
            throwPatternSyntaxError('invalid loop assignment target')
        }

        if (ts.isIdentifier(rawTarget)) {
            validateStrictIdentifierReference(rawTarget, strictContext)
            return
        }

        if (ts.isPropertyAccessExpression(rawTarget) || ts.isElementAccessExpression(rawTarget)) {
            if (ts.isOptionalChain(rawTarget)) {
                throwPatternSyntaxError('invalid loop assignment target')
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

        if (ts.isCallExpression(rawTarget) && !strictContext) {
            return
        }

        throwPatternSyntaxError('invalid loop assignment target')
    }

    const visit = (node: ts.Node, inheritedStrict: boolean) => {
        const strictContext = getStrictContext(node, inheritedStrict, withStrict)

        if (
            ts.isForStatement(node)
            || ts.isForInStatement(node)
            || ts.isForOfStatement(node)
            || ts.isWhileStatement(node)
            || ts.isDoStatement(node)
        ) {
            if (isInvalidSingleStatementBody(node.statement)) {
                throw new SyntaxError('invalid loop statement body')
            }
        }

        if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
            validateLoopAssignmentTarget(node.initializer, strictContext)
        }

        node.forEachChild((child) => visit(child, strictContext))
    }

    visit(sourceNode, false)
}

function validateIfStatementSyntax(sourceNode: ts.SourceFile, withStrict: boolean) {
    const visit = (node: ts.Node, inheritedStrict: boolean) => {
        const strictContext = getStrictContext(node, inheritedStrict, withStrict)

        if (ts.isIfStatement(node)) {
            if (
                isInvalidIfStatementBody(node.thenStatement, strictContext)
                || (node.elseStatement != null && isInvalidIfStatementBody(node.elseStatement, strictContext))
            ) {
                throw new SyntaxError('invalid if statement body')
            }
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
    if (ts.isBigIntLiteral(name)) {
        return BigInt(name.text.slice(0, -1).replace(/_/g, '')).toString()
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

function validateSwitchDeclarationSyntax(sourceNode: ts.SourceFile, withStrict: boolean) {
    type LexicalKind = 'lexical' | 'sloppyFunction'

    const collectVarDeclaredNames = (node: ts.Node): string[] => {
        const names: string[] = []

        const visit = (current: ts.Node) => {
            if (current !== node && (ts.isFunctionLike(current) || ts.isClassLike(current))) {
                return
            }

            if (ts.isVariableDeclarationList(current) && !(current.flags & ts.NodeFlags.BlockScoped)) {
                for (const declaration of current.declarations) {
                    names.push(...extractVariable(declaration.name).map((identifier) => identifier.text))
                }
                return
            }

            current.forEachChild(visit)
        }

        visit(node)
        return names
    }

    const collectDirectLexicalDeclarations = (statement: ts.Statement, strictContext: boolean): [string, LexicalKind][] => {
        if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.BlockScoped) {
            return statement.declarationList.declarations.flatMap((declaration) =>
                extractVariable(declaration.name).map((identifier): [string, LexicalKind] => [identifier.text, 'lexical'])
            )
        }

        if (ts.isClassDeclaration(statement) && statement.name != null) {
            return [[statement.name.text, 'lexical']]
        }

        if (ts.isFunctionDeclaration(statement) && statement.name != null) {
            return [[
                statement.name.text,
                !strictContext && !isNonAnnexBFunctionDeclaration(statement) ? 'sloppyFunction' : 'lexical',
            ]]
        }

        return []
    }

    const visit = (node: ts.Node, inheritedStrict: boolean) => {
        const strictContext = getStrictContext(node, inheritedStrict, withStrict)

        if (ts.isSwitchStatement(node)) {
            const lexicalNames = new Map<string, LexicalKind>()
            const varNames: string[] = []

            for (const clause of node.caseBlock.clauses) {
                for (const statement of clause.statements) {
                    for (const [name, kind] of collectDirectLexicalDeclarations(statement, strictContext)) {
                        const existing = lexicalNames.get(name)
                        if (existing != null && (strictContext || existing !== 'sloppyFunction' || kind !== 'sloppyFunction')) {
                            throw new SyntaxError('duplicate lexical declaration in switch')
                        }
                        lexicalNames.set(name, kind)
                    }
                    varNames.push(...collectVarDeclaredNames(statement))
                }
            }

            for (const name of varNames) {
                if (lexicalNames.has(name)) {
                    throw new SyntaxError('var declaration conflicts with switch lexical declaration')
                }
            }
        }

        node.forEachChild((child) => visit(child, strictContext))
    }

    visit(sourceNode, false)
}

function validateCatchDeclarationSyntax(sourceNode: ts.SourceFile) {
    const collectDirectLexicallyDeclaredNames = (statement: ts.Statement): string[] => {
        const item = unwrapLabeledStatementItem(statement)

        if (ts.isVariableStatement(item) && item.declarationList.flags & ts.NodeFlags.BlockScoped) {
            return item.declarationList.declarations.flatMap((declaration) =>
                extractVariable(declaration.name).map((identifier) => identifier.text)
            )
        }

        if (ts.isClassDeclaration(item) && item.name != null) {
            return [item.name.text]
        }

        if (ts.isFunctionDeclaration(item) && item.name != null) {
            return [item.name.text]
        }

        return []
    }

    const visit = (node: ts.Node) => {
        if (ts.isCatchClause(node) && node.variableDeclaration != null) {
            const catchNames = new Set(extractVariable(node.variableDeclaration.name).map((identifier) => identifier.text))
            const lexicalNames = new Set<string>()

            for (const statement of node.block.statements) {
                for (const name of collectDirectLexicallyDeclaredNames(statement)) {
                    lexicalNames.add(name)
                }
            }

            for (const name of catchNames) {
                if (lexicalNames.has(name)) {
                    throw new SyntaxError('catch parameter conflicts with lexical declaration')
                }
            }
        }

        node.forEachChild(visit)
    }

    visit(sourceNode)
}

function validateBlockDeclarationSyntax(sourceNode: ts.SourceFile, withStrict: boolean) {
    type LexicalKind = 'lexical' | 'sloppyFunction'

    const isFunctionBodyBlock = (node: ts.Block) => {
        const parent = node.parent
        return parent != null
            && ts.isFunctionLike(parent)
            && 'body' in parent
            && parent.body === node
    }

    const collectVarDeclaredNames = (node: ts.Node): string[] => {
        const names: string[] = []

        const visit = (current: ts.Node) => {
            if (current !== node && (ts.isFunctionLike(current) || ts.isClassLike(current))) {
                return
            }

            if (ts.isVariableDeclarationList(current) && !(current.flags & ts.NodeFlags.BlockScoped)) {
                for (const declaration of current.declarations) {
                    names.push(...extractVariable(declaration.name).map((identifier) => identifier.text))
                }
                return
            }

            current.forEachChild(visit)
        }

        visit(node)
        return names
    }

    const collectDirectLexicalDeclarations = (statement: ts.Statement, strictContext: boolean): [string, LexicalKind][] => {
        if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.BlockScoped) {
            return statement.declarationList.declarations.flatMap((declaration) =>
                extractVariable(declaration.name).map((identifier): [string, LexicalKind] => [identifier.text, 'lexical'])
            )
        }

        if (ts.isClassDeclaration(statement) && statement.name != null) {
            return [[statement.name.text, 'lexical']]
        }

        if (ts.isFunctionDeclaration(statement) && statement.name != null) {
            return [[
                statement.name.text,
                !strictContext && !isNonAnnexBFunctionDeclaration(statement) ? 'sloppyFunction' : 'lexical',
            ]]
        }

        return []
    }

    const validateStatements = (statements: readonly ts.Statement[], strictContext: boolean) => {
        const lexicalNames = new Map<string, LexicalKind>()
        const varNames: string[] = []

        for (const statement of statements) {
            for (const [name, kind] of collectDirectLexicalDeclarations(statement, strictContext)) {
                const existing = lexicalNames.get(name)
                if (existing != null && (strictContext || existing !== 'sloppyFunction' || kind !== 'sloppyFunction')) {
                    throw new SyntaxError('duplicate lexical declaration in block')
                }
                lexicalNames.set(name, kind)
            }
            varNames.push(...collectVarDeclaredNames(statement))
        }

        for (const name of varNames) {
            if (lexicalNames.has(name)) {
                throw new SyntaxError('var declaration conflicts with block lexical declaration')
            }
        }
    }

    const visit = (node: ts.Node, inheritedStrict: boolean) => {
        const strictContext = getStrictContext(node, inheritedStrict, withStrict)

        if (ts.isBlock(node) && !isFunctionBodyBlock(node)) {
            validateStatements(node.statements, strictContext)
        }

        node.forEachChild((child) => visit(child, strictContext))
    }

    visit(sourceNode, false)
}

function toSourceRange(locationMap: Map<number, [number, number]>, start: number, end: number): [number, number, number, number] {
    const startPos = locationMap.get(start)!
    const endPos = locationMap.get(end)!
    return [startPos[0], startPos[1], endPos[0], endPos[1]]
}

export function compile(src: string, { debug = false, range = false, evalMode = false, runtimeEval = false, withStrict = false }: CompileOptions = {}): [number[], DebugInfo] {
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

    validateSyntax(sourceNode, locationMap, withStrict)
    validateCoalesceSyntax(sourceNode)
    validateObjectLiteralSyntax(sourceNode)
    validateClassFieldArgumentsSyntax(sourceNode)
    validateClassStaticElementSyntax(sourceNode)
    validateVariableDeclarationSyntax(sourceNode)
    validateMetaPropertySyntax(sourceNode)
    validateScriptDeclarationSyntax(sourceNode)
    validateReferenceSyntax(sourceNode, withStrict)
    validateDestructuringSyntax(sourceNode, withStrict)
    validateFunctionParameterSyntax(sourceNode, withStrict)
    validateLoopSyntax(sourceNode, withStrict)
    validateIfStatementSyntax(sourceNode, withStrict)
    validateCatchDeclarationSyntax(sourceNode)
    validateBlockDeclarationSyntax(sourceNode, withStrict)
    validateSwitchDeclarationSyntax(sourceNode, withStrict)

    markParent(sourceNode, parentMap)
    searchFunctionAndScope(sourceNode, parentMap, functions, scopes)
    resolveScopes(sourceNode, parentMap, functions, scopes, withStrict)
    linkScopes(sourceNode, parentMap, scopes, scopeChild)
    const evalTaintedFunctions = collectEvalTaintedFunctions(sourceNode, parentMap, functions)

    const program: Segment[] = []
    const functionToSegment = new Map<ts.Node, Segment>()
    const functionToBodyStart = new Map<ts.Node, Op>()

    for (const item of functions) {
        const generated = generateSegment(item, scopes, parentMap, functions, evalTaintedFunctions, {
            withPos: range,
            withEval: (item.kind === ts.SyntaxKind.SourceFile) && evalMode,
            withRuntimeEval: (item.kind === ts.SyntaxKind.SourceFile) && runtimeEval,
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
