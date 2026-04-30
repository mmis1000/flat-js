const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT_FILE = path.join(ROOT, 'src', 'runtime-inline.ts')
const ENTRY_FILES = [
    path.join(ROOT, 'src', 'runtime', 'execution.ts'),
    path.join(ROOT, 'src', 'runtime', 'run.ts'),
]
const COMPILER_SHARED_FILE = path.join(ROOT, 'src', 'compiler', 'shared.ts')
const INLINE_COMPILER_SOURCE = './compiler/shared'
const INLINE_COMPILER_BINDINGS = new Set(['STATIC_SLOT_NAMELESS', 'TEXT_DADA_MASK', 'isSmallNumber', 'literalPoolWordMask'])
const INLINE_EXPORTS = new Set(['run'])
const START_FLAG = '// [START_HERE]'

const ensureRelativeModule = (fromFile, resolvedFile) => {
    const fromDir = path.dirname(fromFile)
    let relative = path.relative(fromDir, resolvedFile)
    relative = relative.replace(/\\/g, '/')
    relative = relative.replace(/\.(cts|mts|tsx|ts|js|jsx)$/, '')
    relative = relative.replace(/\/index$/, '')
    if (!relative.startsWith('.')) {
        relative = './' + relative
    }
    return relative
}

const resolveImportTarget = (fromFile, specifier) => {
    const base = path.resolve(path.dirname(fromFile), specifier)
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        path.join(base, 'index.ts'),
        path.join(base, 'index.tsx'),
        path.join(base, 'index.js'),
    ]
    return candidates.find((candidate) => fs.existsSync(candidate))
}

const isRuntimeLocalImport = (fromFile, specifier) => {
    if (!specifier.startsWith('.')) {
        return false
    }
    const resolved = resolveImportTarget(fromFile, specifier)
    if (!resolved) {
        return false
    }
    const runtimeRoot = path.join(ROOT, 'src', 'runtime') + path.sep
    return resolved.startsWith(runtimeRoot)
}

const shouldKeepExport = (statement) => {
    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.some((declaration) =>
            ts.isIdentifier(declaration.name) && INLINE_EXPORTS.has(declaration.name.text)
        )
    }
    if (
        ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement)
        || ts.isEnumDeclaration(statement)
    ) {
        return statement.name ? INLINE_EXPORTS.has(statement.name.text) : false
    }
    return false
}

const stripExportModifier = (statementText) =>
    statementText.replace(/^export\s+default\s+/, '').replace(/^export\s+/, '')

const normalizeImportTypeReferences = (statementText, sourceFile) =>
    statementText.replace(/import\((['"])(\.[^'"]+)\1\)/g, (match, _quote, specifier) => {
        const resolved = resolveImportTarget(sourceFile, specifier)
        if (!resolved) {
            return match
        }
        return `import(${JSON.stringify(ensureRelativeModule(OUTPUT_FILE, resolved))})`
    })

const getOrCreateImportBucket = (importsBySource, source) => {
    let bucket = importsBySource.get(source)
    if (!bucket) {
        bucket = {
            defaultImport: null,
            namedImports: new Set(),
            namespaceImport: null,
            sideEffectOnly: false,
        }
        importsBySource.set(source, bucket)
    }
    return bucket
}

const appendImport = (importsBySource, inlineCompilerBindings, sourceFilePath, statement) => {
    const specifier = statement.moduleSpecifier.text
    const resolved = specifier.startsWith('.') ? resolveImportTarget(sourceFilePath, specifier) : undefined
    const nextSource = resolved ? ensureRelativeModule(OUTPUT_FILE, resolved) : specifier
    const importClause = statement.importClause

    if (!importClause) {
        getOrCreateImportBucket(importsBySource, nextSource).sideEffectOnly = true
        return
    }

    let bucket = null
    const addToBucket = (name) => {
        if (!bucket) {
            bucket = getOrCreateImportBucket(importsBySource, nextSource)
        }
        bucket.namedImports.add(name)
    }

    if (importClause.name) {
        bucket = getOrCreateImportBucket(importsBySource, nextSource)
        bucket.defaultImport = importClause.name.text
    }

    const bindings = importClause.namedBindings
    if (!bindings) {
        return
    }

    if (ts.isNamespaceImport(bindings)) {
        bucket = getOrCreateImportBucket(importsBySource, nextSource)
        bucket.namespaceImport = bindings.name.text
        return
    }

    for (const element of bindings.elements) {
        const importedName = element.propertyName ? element.propertyName.text : element.name.text
        if (nextSource === INLINE_COMPILER_SOURCE && INLINE_COMPILER_BINDINGS.has(importedName)) {
            inlineCompilerBindings.add(importedName)
            continue
        }
        addToBucket(element.propertyName ? `${element.propertyName.text} as ${element.name.text}` : element.name.text)
    }
}

const emitImports = (importsBySource) => {
    const blocks = []

    for (const [source, bucket] of importsBySource.entries()) {
        if (bucket.sideEffectOnly && !bucket.defaultImport && !bucket.namespaceImport && bucket.namedImports.size === 0) {
            blocks.push(`import ${JSON.stringify(source)}`)
            continue
        }

        const parts = []
        if (bucket.defaultImport) {
            parts.push(bucket.defaultImport)
        }
        if (bucket.namespaceImport) {
            parts.push(`* as ${bucket.namespaceImport}`)
        }
        if (bucket.namedImports.size > 0) {
            parts.push(`{ ${Array.from(bucket.namedImports).sort().join(', ')} }`)
        }
        if (parts.length > 0) {
            blocks.push(`import ${parts.join(', ')} from ${JSON.stringify(source)}`)
        }
    }

    return blocks
}

const getRuntimeFileOrder = () => {
    const ordered = []
    const visited = new Set()

    const visit = (file) => {
        if (visited.has(file)) {
            return
        }
        visited.add(file)

        const sourceText = fs.readFileSync(file, 'utf8')
        const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true)

        for (const statement of sourceFile.statements) {
            if (!ts.isImportDeclaration(statement)) {
                continue
            }
            const specifier = statement.moduleSpecifier.text
            if (!isRuntimeLocalImport(file, specifier)) {
                continue
            }
            const resolved = resolveImportTarget(file, specifier)
            if (resolved) {
                visit(resolved)
            }
        }

        ordered.push(file)
    }

    for (const file of ENTRY_FILES) {
        visit(file)
    }

    return ordered
}

const getInlineCompilerDeclarationMap = () => {
    const sourceText = fs.readFileSync(COMPILER_SHARED_FILE, 'utf8')
    const sourceFile = ts.createSourceFile(COMPILER_SHARED_FILE, sourceText, ts.ScriptTarget.Latest, true)
    const declarations = new Map()

    for (const statement of sourceFile.statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name) && INLINE_COMPILER_BINDINGS.has(declaration.name.text)) {
                    const prefix = sourceText.slice(statement.getFullStart(), statement.getStart(sourceFile))
                    const statementText = sourceText.slice(statement.getStart(sourceFile), statement.getEnd())
                    declarations.set(declaration.name.text, prefix + stripExportModifier(statementText))
                }
            }
            continue
        }

        if (ts.isFunctionDeclaration(statement) && statement.name && INLINE_COMPILER_BINDINGS.has(statement.name.text)) {
            const prefix = sourceText.slice(statement.getFullStart(), statement.getStart(sourceFile))
            const statementText = sourceText.slice(statement.getStart(sourceFile), statement.getEnd())
            declarations.set(statement.name.text, prefix + stripExportModifier(statementText))
        }
    }

    return declarations
}

const assembleRuntimeInline = () => {
    const importsBySource = new Map()
    const inlineCompilerBindings = new Set()
    const bodyBlocks = []
    const orderedFiles = getRuntimeFileOrder()

    for (const file of orderedFiles) {
        const sourceText = fs.readFileSync(file, 'utf8')
        const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true)

        for (const statement of sourceFile.statements) {
            if (ts.isImportDeclaration(statement)) {
                if (isRuntimeLocalImport(file, statement.moduleSpecifier.text)) {
                    continue
                }
                appendImport(importsBySource, inlineCompilerBindings, file, statement)
                continue
            }

            if (ts.isExportDeclaration(statement)) {
                continue
            }

            const prefix = sourceText.slice(statement.getFullStart(), statement.getStart(sourceFile))
            const statementText = sourceText.slice(statement.getStart(sourceFile), statement.getEnd())
            const transformedStatement = ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export && !shouldKeepExport(statement)
                ? stripExportModifier(statementText)
                : statementText
            const transformed = normalizeImportTypeReferences(transformedStatement, file)
            bodyBlocks.push(prefix + transformed)
        }
    }

    const compilerDeclarations = getInlineCompilerDeclarationMap()
    const inlinePrelude = Array.from(inlineCompilerBindings)
        .sort()
        .map((name) => {
            const declaration = compilerDeclarations.get(name)
            if (!declaration) {
                throw new Error(`Missing compiler inline declaration for ${name}`)
            }
            return declaration
        })

    const outputParts = [
        emitImports(importsBySource).join('\n'),
        START_FLAG,
        inlinePrelude.join('\n\n'),
        bodyBlocks.join('\n\n'),
    ].filter((part) => part && part.trim().length > 0)

    const output = `${outputParts.join('\n\n')}\n`
    fs.writeFileSync(OUTPUT_FILE, output)
    return OUTPUT_FILE
}

module.exports = {
    OUTPUT_FILE,
    assembleRuntimeInline,
}

if (require.main === module) {
    assembleRuntimeInline()
}
