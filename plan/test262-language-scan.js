const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const rootDir = process.cwd()
const defaultLanguageDir = path.join(rootDir, 'node_modules', 'test262', 'test', 'language')
const languageDir = process.env.TEST262_SCAN_ROOT
    ? path.resolve(rootDir, process.env.TEST262_SCAN_ROOT)
    : defaultLanguageDir
const summaryPath = process.env.TEST262_SCAN_SUMMARY
    ? path.resolve(rootDir, process.env.TEST262_SCAN_SUMMARY)
    : path.join(rootDir, 'plan', 'test262-language-summary.md')
const scanStatePath = process.env.TEST262_SCAN_STATE
    ? path.resolve(rootDir, process.env.TEST262_SCAN_STATE)
    : `${summaryPath}.state.json`
const freshScan = process.env.TEST262_SCAN_FRESH === '1'
const maxFilesPerChunk = 350
const chunkConcurrency = Math.max(2, Math.min(16, Number(process.env.TEST262_SCAN_CONCURRENCY || 12), os.cpus().length || 1))
const maxExplicitChunkArgs = 48
const maxExplicitChunkCommandLength = 7000
const scanStateVersion = 1

const outOfScopePrefixes = [
    'language/import/',
    'language/export/',
    'language/module-code/',
    'language/expressions/dynamic-import/',
    'language/expressions/import.meta/',
    'language/statements/for-await-of/',
    'language/statements/await-using/',
    'language/statements/using/',
]

const outOfScopeFeatures = new Set([
    'dynamic-import',
    'import-attributes',
    'import-defer',
    'import.meta',
    'json-modules',
    'source-phase-imports',
    'top-level-await',
    'explicit-resource-management',
    'arbitrary-module-namespace-names',
    'class-fields-public',
    'class-fields-private',
    'class-fields-private-in',
    'class-methods-private',
    'class-static-fields-public',
    'class-static-fields-private',
    'class-static-methods-private',
    'private-methods',
    'private-fields-in',
    'class-static-block',
    'decorators',
])

const outOfScopeNodeNames = new Set([
    'ImportDeclaration',
    'ExportDeclaration',
    'ExportAssignment',
    'PropertyDeclaration',
    'PrivateIdentifier',
    'ClassStaticBlockDeclaration',
    'ImportKeyword',
])

const webCompatHostBehaviorFiles = new Set([
    'language/expressions/assignmenttargettype/direct-callexpression-in-compound-assignment.js',
    'language/expressions/assignmenttargettype/direct-callexpression.js',
    'language/expressions/assignmenttargettype/parenthesized-callexpression-in-compound-assignment.js',
    'language/expressions/assignmenttargettype/parenthesized-callexpression.js',
])

const nativeHarnessFailureFiles = new Set([
    'language/expressions/optional-chaining/member-expression-async-identifier.js',
    'language/statements/async-function/evaluation-body.js',
])

const typescriptCompilerCrashFiles = new Set([
    // TS 6 recurses in semantic diagnostics for this valid script shape:
    // a computed generator method name containing `yield` inside a generator.
    // Treat as an upstream TypeScript checker crash, not a Flat JS workaround target.
    'language/expressions/object/method-definition/generator-prop-name-yield-expr.js',
])

const test262StressTimeoutFiles = new Set([
    // Exhaustive Sputnik-era loops that run 65,536 dynamic eval compilations.
    // Representative samples pass; keep these out of semantic cleanup targets.
    'language/comments/S7.4_A5.js',
    'language/comments/S7.4_A6.js',
    'language/literals/regexp/S7.8.5_A1.1_T2.js',
    'language/literals/regexp/S7.8.5_A1.4_T2.js',
    'language/literals/regexp/S7.8.5_A2.1_T2.js',
    'language/literals/regexp/S7.8.5_A2.4_T2.js',
])

function isParserDelegationRegExpFile(file) {
    return file.startsWith('language/literals/regexp/early-err-')
        || file.startsWith('language/literals/regexp/named-groups/invalid-')
}

function toPosix(value) {
    return value.split(path.sep).join('/')
}

function relativeFromRoot(absPath) {
    return toPosix(path.relative(rootDir, absPath))
}

function relativeLanguagePath(filePath) {
    return toPosix(filePath)
        .replace(/^node_modules\/test262\/test\//, '')
        .replace(/^\.\/node_modules\/test262\/test\//, '')
}

function quoteForCmd(value) {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
        return value
    }
    return `"${String(value).replace(/"/g, '""')}"`
}

function listDirectEntries(absDir) {
    return fs.readdirSync(absDir, { withFileTypes: true })
}

function listDirectFiles(absDir) {
    return listDirectEntries(absDir)
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => path.join(absDir, entry.name))
}

function listDirectDirs(absDir) {
    return listDirectEntries(absDir)
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(absDir, entry.name))
}

function countJsFilesRecursive(absDir) {
    let count = 0
    for (const entry of listDirectEntries(absDir)) {
        const entryPath = path.join(absDir, entry.name)
        if (entry.isDirectory()) {
            count += countJsFilesRecursive(entryPath)
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            count += 1
        }
    }
    return count
}

function createInitialChunks(absDir) {
    const total = countJsFilesRecursive(absDir)
    if (total <= maxFilesPerChunk) {
        return [{ kind: 'dir', dir: absDir }]
    }

    const chunks = []
    const directFiles = listDirectFiles(absDir)
    if (directFiles.length > 0) {
        chunks.push(...createFileChunks(directFiles))
    }
    for (const subdir of listDirectDirs(absDir)) {
        chunks.push(...createInitialChunks(subdir))
    }
    return chunks
}

function createFileChunks(files) {
    const chunks = []
    let current = []
    let currentLength = 0

    for (const file of files) {
        const target = `./${relativeFromRoot(file)}`
        const targetLength = target.length + 3

        if (
            current.length > 0
            && (
                current.length >= maxExplicitChunkArgs
                || currentLength + targetLength > maxExplicitChunkCommandLength
            )
        ) {
            chunks.push({ kind: 'files', files: current })
            current = []
            currentLength = 0
        }

        current.push(file)
        currentLength += targetLength
    }

    if (current.length > 0) {
        chunks.push({ kind: 'files', files: current })
    }

    return chunks
}

function describeChunk(chunk) {
    if (chunk.kind === 'dir') {
        return `dir:${relativeFromRoot(chunk.dir)}`
    }
    if (chunk.kind === 'files') {
        if (chunk.files.length === 1) {
            return `file:${relativeFromRoot(chunk.files[0])}`
        }
        return `files:${relativeFromRoot(path.dirname(chunk.files[0]))} (${chunk.files.length})`
    }
    return chunk.kind
}

function chunkTargets(chunk) {
    if (chunk.kind === 'dir') {
        return [`./${relativeFromRoot(chunk.dir)}/**/*.js`]
    }
    if (chunk.kind === 'files') {
        return chunk.files.map((file) => `./${relativeFromRoot(file)}`)
    }
    throw new Error(`unknown chunk kind ${chunk.kind}`)
}

function serializeChunk(chunk) {
    if (chunk.kind === 'dir') {
        return {
            kind: 'dir',
            dir: relativeFromRoot(chunk.dir),
        }
    }

    if (chunk.kind === 'files') {
        return {
            kind: 'files',
            files: chunk.files.map((file) => relativeFromRoot(file)),
        }
    }

    throw new Error(`unknown chunk kind ${chunk.kind}`)
}

function deserializeChunk(chunk) {
    if (chunk.kind === 'dir') {
        return {
            kind: 'dir',
            dir: path.resolve(rootDir, chunk.dir),
        }
    }

    if (chunk.kind === 'files') {
        return {
            kind: 'files',
            files: chunk.files.map((file) => path.resolve(rootDir, file)),
        }
    }

    throw new Error(`unknown saved chunk kind ${chunk.kind}`)
}

function serializeResults(resultsByFile) {
    return [...resultsByFile.entries()]
}

function deserializeResults(entries) {
    return new Map(Array.isArray(entries) ? entries : [])
}

const retryableFileOperationCodes = new Set(['EPERM', 'EACCES', 'EBUSY'])
const fileRetryBuffer = new SharedArrayBuffer(4)
const fileRetryView = new Int32Array(fileRetryBuffer)

function waitForFileRetry(ms) {
    Atomics.wait(fileRetryView, 0, 0, ms)
}

function retryFileOperation(operation) {
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            operation()
            return
        } catch (error) {
            if (!retryableFileOperationCodes.has(error?.code) || attempt === 9) {
                throw error
            }

            waitForFileRetry(Math.min(1000, 25 * (2 ** attempt)))
        }
    }
}

function replaceFileSync(tempPath, targetPath) {
    retryFileOperation(() => fs.renameSync(tempPath, targetPath))
}

function removeFileIfExistsSync(filePath) {
    if (!fs.existsSync(filePath)) {
        return
    }

    retryFileOperation(() => {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { force: true })
        }
    })
}

function saveScanState({ queue, activeChunks, resultsByFile, scanNotes, processed, completed }) {
    const state = {
        version: scanStateVersion,
        languageDir: relativeFromRoot(languageDir),
        summaryPath: relativeFromRoot(summaryPath),
        savedAt: new Date().toISOString(),
        processed,
        completed,
        queue: queue.map(serializeChunk),
        activeChunks: [...activeChunks.values()].map(serializeChunk),
        resultsByFile: serializeResults(resultsByFile),
        scanNotes,
    }

    fs.mkdirSync(path.dirname(scanStatePath), { recursive: true })
    const tempPath = `${scanStatePath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2))
    replaceFileSync(tempPath, scanStatePath)
}

function loadScanState() {
    if (freshScan) {
        removeFileIfExistsSync(scanStatePath)
        return null
    }

    if (!fs.existsSync(scanStatePath)) {
        return null
    }

    const state = JSON.parse(fs.readFileSync(scanStatePath, 'utf8'))
    const expectedLanguageDir = relativeFromRoot(languageDir)
    const expectedSummaryPath = relativeFromRoot(summaryPath)

    if (
        state.version !== scanStateVersion
        || state.languageDir !== expectedLanguageDir
        || state.summaryPath !== expectedSummaryPath
    ) {
        throw new Error(
            `Scan state ${relativeFromRoot(scanStatePath)} does not match this run. `
            + 'Set TEST262_SCAN_FRESH=1 to start over, or set TEST262_SCAN_STATE to a different file.'
        )
    }

    return {
        queue: [
            ...(state.activeChunks ?? []),
            ...(state.queue ?? []),
        ].map(deserializeChunk),
        resultsByFile: deserializeResults(state.resultsByFile),
        scanNotes: Array.isArray(state.scanNotes) ? state.scanNotes : [],
        processed: Number(state.processed) || 0,
        completed: Number(state.completed) || 0,
        savedAt: state.savedAt,
    }
}

function extractJsonPrefix(rawOutput) {
    let index = 0
    while (index < rawOutput.length && /\s/.test(rawOutput[index])) {
        index += 1
    }
    if (rawOutput[index] !== '[') {
        return null
    }

    let depth = 0
    let inString = false
    let escaping = false
    for (let i = index; i < rawOutput.length; i += 1) {
        const ch = rawOutput[i]
        if (inString) {
            if (escaping) {
                escaping = false
            } else if (ch === '\\') {
                escaping = true
            } else if (ch === '"') {
                inString = false
            }
            continue
        }

        if (ch === '"') {
            inString = true
            continue
        }

        if (ch === '[') {
            depth += 1
            continue
        }

        if (ch === ']') {
            depth -= 1
            if (depth === 0) {
                return {
                    jsonText: rawOutput.slice(index, i + 1),
                    trailing: rawOutput.slice(i + 1).trim(),
                }
            }
        }
    }

    return null
}

function runHarness(chunk) {
    const command = [
        'node',
        './node_modules/test262-harness/bin/run.js',
        '--threads',
        '1',
        '--reporter',
        'json',
        '--reporter-keys',
        'file,result,scenario,attrs',
        '--preprocessor',
        './scripts/test262-preprocessor.js',
        '--test262-dir',
        './node_modules/test262',
        ...chunkTargets(chunk),
    ].map(quoteForCmd).join(' ')

    return new Promise((resolve) => {
        let stdout = ''
        let stderr = ''
        let settled = false

        const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
            cwd: rootDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunkText) => { stdout += chunkText })
        child.stderr.on('data', (chunkText) => { stderr += chunkText })

        child.on('error', (error) => {
            if (settled) {
                return
            }
            settled = true
            resolve({
                ok: false,
                reason: 'spawn-error',
                rawOutput: `${stdout}${stderr}`,
                status: null,
                error,
            })
        })

        child.on('close', (status) => {
            if (settled) {
                return
            }
            settled = true

            const rawOutput = `${stdout}${stderr}`
            const prefix = extractJsonPrefix(rawOutput)

            if (!prefix) {
                resolve({
                    ok: false,
                    reason: 'non-json-output',
                    rawOutput,
                    status,
                    error: null,
                })
                return
            }

            let parsed
            try {
                parsed = JSON.parse(prefix.jsonText)
            } catch (error) {
                resolve({
                    ok: false,
                    reason: 'invalid-json-output',
                    rawOutput,
                    status,
                    error,
                })
                return
            }

            if (prefix.trailing.length > 0) {
                resolve({
                    ok: false,
                    reason: 'trailing-output-after-json',
                    rawOutput,
                    jsonFailures: parsed,
                    trailing: prefix.trailing,
                    status,
                    error: null,
                })
                return
            }

            resolve({
                ok: true,
                failures: parsed,
                rawOutput,
                status,
            })
        })
    })
}

function splitChunk(chunk) {
    if (chunk.kind === 'dir') {
        const chunks = []
        const directFiles = listDirectFiles(chunk.dir)
        if (directFiles.length > 0) {
            chunks.push(...createFileChunks(directFiles))
        }
        for (const subdir of listDirectDirs(chunk.dir)) {
            chunks.push(...createInitialChunks(subdir))
        }
        return chunks
    }

    if (chunk.kind === 'files' && chunk.files.length > 1) {
        return chunk.files.map((file) => ({ kind: 'files', files: [file] }))
    }

    return []
}

function listFilesForChunk(chunk) {
    if (chunk.kind === 'files') {
        return [...chunk.files]
    }

    if (chunk.kind === 'dir') {
        const files = []
        const walk = (absDir) => {
            for (const entry of listDirectEntries(absDir)) {
                const entryPath = path.join(absDir, entry.name)
                if (entry.isDirectory()) {
                    walk(entryPath)
                } else if (entry.isFile() && entry.name.endsWith('.js')) {
                    files.push(entryPath)
                }
            }
        }
        walk(chunk.dir)
        return files
    }

    return []
}

function getHarnessIssueType(file) {
    if (typescriptCompilerCrashFiles.has(file)) {
        return 'TypeScript compiler crash'
    }
    if (test262StressTimeoutFiles.has(file)) {
        return 'Test262 stress timeout'
    }
    return 'harness issue'
}

function recordHarnessIssue(resultsByFile, absFile, detail) {
    const relFile = relativeLanguagePath(`./${relativeFromRoot(absFile)}`)
    resultsByFile.set(relFile, {
        file: relFile,
        scope: isOutOfScope(relFile, null, [detail]) ? 'out-of-scope' : 'intended',
        type: getHarnessIssueType(relFile),
        messages: [detail],
        scenarios: [],
        features: [],
        negativePhase: null,
    })
}

function normalizeFeatures(value) {
    if (!Array.isArray(value)) {
        return []
    }
    return value.filter((item) => typeof item === 'string')
}

function isOutOfScope(file, attrs, messages) {
    if (webCompatHostBehaviorFiles.has(file)) {
        return true
    }

    if (nativeHarnessFailureFiles.has(file)) {
        return true
    }

    if (typescriptCompilerCrashFiles.has(file)) {
        return true
    }

    if (test262StressTimeoutFiles.has(file)) {
        return true
    }

    if (isParserDelegationRegExpFile(file)) {
        return true
    }

    if (outOfScopePrefixes.some((prefix) => file.startsWith(prefix))) {
        return true
    }

    if (attrs?.flags?.module === true) {
        return true
    }

    const features = normalizeFeatures(attrs?.features)
    if (features.some((feature) => outOfScopeFeatures.has(feature))) {
        return true
    }

    const combined = messages.join(' || ')
    for (const nodeName of outOfScopeNodeNames) {
        if (combined.includes(`Unknown node ${nodeName}`)) {
            return true
        }
    }

    return false
}

function classifyFailure(file, attrsList, messages) {
    const primaryAttrs = attrsList.find(Boolean) ?? null
    const scope = isOutOfScope(file, primaryAttrs, messages) ? 'out-of-scope' : 'intended'
    const combined = messages.join(' || ')
    const features = normalizeFeatures(primaryAttrs?.features)
    const parseNegative = attrsList.some((attrs) => attrs?.negative?.phase === 'parse')

    if (nativeHarnessFailureFiles.has(file)) {
        return { scope, type: 'native harness issue', features, negativePhase: parseNegative ? 'parse' : null }
    }

    if (typescriptCompilerCrashFiles.has(file)) {
        return { scope, type: 'TypeScript compiler crash', features, negativePhase: parseNegative ? 'parse' : null }
    }

    if (test262StressTimeoutFiles.has(file) && /Test timed out/i.test(combined)) {
        return { scope, type: 'Test262 stress timeout', features, negativePhase: parseNegative ? 'parse' : null }
    }

    if (/Maximum call stack size exceeded|Error running test:/i.test(combined)) {
        return { scope, type: 'harness issue', features, negativePhase: parseNegative ? 'parse' : null }
    }

    if (scope === 'out-of-scope') {
        if (isParserDelegationRegExpFile(file)) {
            return { scope, type: 'not intended / parser syntax unsupported', features, negativePhase: parseNegative ? 'parse' : null }
        }
        if (/Unknown node |not support yet|not supported|unsupported/i.test(combined)) {
            return { scope, type: 'not intended / unsupported syntax', features, negativePhase: parseNegative ? 'parse' : null }
        }
        if (/TS\d{4}|Declaration or statement expected|Expression expected|Unexpected token/i.test(combined)) {
            return { scope, type: 'not intended / parser syntax unsupported', features, negativePhase: parseNegative ? 'parse' : null }
        }
        return { scope, type: 'not intended / unsupported behavior', features, negativePhase: parseNegative ? 'parse' : null }
    }

    if (/Unknown node |not support yet|not supported|unsupported/i.test(combined)) {
        if (/TS\d{4}|Declaration or statement expected|Expression expected|Unexpected token/i.test(combined)) {
            return { scope, type: 'not supported parser syntax', features, negativePhase: parseNegative ? 'parse' : null }
        }
        return { scope, type: 'not supported', features, negativePhase: parseNegative ? 'parse' : null }
    }

    if (/TS\d{4}|Declaration or statement expected|Expression expected|Unexpected token/i.test(combined)) {
        return { scope, type: 'not supported parser syntax', features, negativePhase: parseNegative ? 'parse' : null }
    }

    if (/Expected test to throw error of type /i.test(combined)) {
        return { scope, type: parseNegative ? 'broken early error semantics' : 'broken semantics', features, negativePhase: parseNegative ? 'parse' : null }
    }

    if (/Expected no error, got /i.test(combined)) {
        return { scope, type: 'broken semantics', features, negativePhase: parseNegative ? 'parse' : null }
    }

    if (/AssertionError|Expected .* got /i.test(combined)) {
        return { scope, type: 'broken semantics', features, negativePhase: parseNegative ? 'parse' : null }
    }

    return { scope, type: 'broken / needs inspection', features, negativePhase: parseNegative ? 'parse' : null }
}

function summarizeFailures(resultsByFile) {
    const groups = new Map()
    for (const record of resultsByFile.values()) {
        const key = `${record.scope}::${record.type}`
        const bucket = groups.get(key) ?? []
        bucket.push(record)
        groups.set(key, bucket)
    }
    for (const bucket of groups.values()) {
        bucket.sort((a, b) => a.file.localeCompare(b.file))
    }
    return groups
}

function unique(values) {
    return [...new Set(values)]
}

function renderSummary(resultsByFile, scanNotes) {
    const groups = summarizeFailures(resultsByFile)
    const records = [...resultsByFile.values()].sort((a, b) => a.file.localeCompare(b.file))
    const intended = records.filter((record) => record.scope === 'intended')
    const outOfScope = records.filter((record) => record.scope === 'out-of-scope')

    const lines = []
    lines.push('# Test262 Language Failure Summary')
    lines.push('')
    lines.push(`Generated: ${new Date().toISOString()}`)
    lines.push('')
    lines.push('## Scan Method')
    lines.push('')
    lines.push(`- Ran \`test262-harness\` with the JSON reporter against \`${relativeFromRoot(languageDir)}\` in recursively split chunks.`)
    lines.push(`- Started with directory chunks of at most about ${maxFilesPerChunk} tests, then fell back to smaller units when the harness emitted partial JSON or crashed.`)
    lines.push('- Classified failures per file after combining default/strict scenarios.')
    lines.push('- Marked a failure as `out-of-scope` when the repo currently has no implementation path for that syntax or runtime model, such as modules, dynamic import, explicit resource management, or unsupported modern class element forms.')
    lines.push('')
    lines.push('## Scope Heuristics')
    lines.push('')
    lines.push('- Intended support includes current script-mode compiler/runtime features already present in `src/compiler/**` and `src/runtime/**`, such as classes with constructors/methods/accessors, generators, async functions, spread calls, tagged templates, `for-of`, and `new.target`.')
    lines.push('- Out-of-scope buckets currently include module syntax and evaluation (`import`, `export`, `module-code`, `dynamic import`, `import.meta`), explicit resource management (`using`, `await using`), and class element features that the compiler does not model yet (`PropertyDeclaration`, `PrivateIdentifier`, `ClassStaticBlockDeclaration`).')
    lines.push('')
    lines.push('## Totals')
    lines.push('')
    lines.push(`- Failing files in intended scope: ${intended.length}`)
    lines.push(`- Failing files in out-of-scope areas: ${outOfScope.length}`)
    lines.push(`- Total failing files recorded: ${records.length}`)
    if (scanNotes.length > 0) {
        lines.push(`- Scanner notes: ${scanNotes.length}`)
    }
    lines.push('')
    lines.push('## Counts By Bucket')
    lines.push('')
    for (const scope of ['intended', 'out-of-scope']) {
        const scopedRecords = records.filter((record) => record.scope === scope)
        const counts = new Map()
        for (const record of scopedRecords) {
            counts.set(record.type, (counts.get(record.type) ?? 0) + 1)
        }
        lines.push(`### ${scope}`)
        lines.push('')
        if (counts.size === 0) {
            lines.push('- none')
            lines.push('')
            continue
        }
        for (const [type, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            lines.push(`- ${type}: ${count}`)
        }
        lines.push('')
    }

    if (scanNotes.length > 0) {
        lines.push('## Scanner Notes')
        lines.push('')
        for (const note of scanNotes) {
            lines.push(`- ${note}`)
        }
        lines.push('')
    }

    lines.push('## Detailed Failures')
    lines.push('')
    for (const scope of ['intended', 'out-of-scope']) {
        lines.push(`### ${scope}`)
        lines.push('')
        const typeGroups = [...groups.entries()]
            .filter(([key]) => key.startsWith(`${scope}::`))
            .sort((a, b) => a[0].localeCompare(b[0]))

        if (typeGroups.length === 0) {
            lines.push('- none')
            lines.push('')
            continue
        }

        for (const [key, bucket] of typeGroups) {
            const type = key.split('::')[1]
            lines.push(`#### ${type} (${bucket.length})`)
            lines.push('')
            for (const record of bucket) {
                const featureText = record.features.length > 0 ? ` | features: ${record.features.join(', ')}` : ''
                const scenarioText = record.scenarios.length > 0 ? ` | scenarios: ${record.scenarios.join(', ')}` : ''
                lines.push(`- \`${record.file}\` - ${record.messages[0]}${featureText}${scenarioText}`)
            }
            lines.push('')
        }
    }

    return `${lines.join('\n')}\n`
}

function countChunkFiles(chunk) {
    if (chunk.kind === 'files') {
        return chunk.files.length
    }
    return countJsFilesRecursive(chunk.dir)
}

async function main() {
    const initialChunks = createInitialChunks(languageDir)
    const savedState = loadScanState()
    const queue = savedState?.queue ?? [...initialChunks]
    const resultsByFile = savedState?.resultsByFile ?? new Map()
    const scanNotes = savedState?.scanNotes ?? []
    const activeChunks = new Map()

    console.log(`Initial chunks: ${initialChunks.length}`)
    console.log(`Chunk concurrency: ${chunkConcurrency}`)
    console.log(`Scan state: ${relativeFromRoot(scanStatePath)}`)
    if (savedState != null) {
        console.log(`Resuming scan state from ${savedState.savedAt ?? 'unknown time'} | completed=${savedState.completed} | queued=${queue.length}`)
    } else if (freshScan) {
        console.log('Starting fresh scan; existing state was ignored.')
    }

    let processed = savedState?.processed ?? 0
    let completed = savedState?.completed ?? 0
    let active = 0

    const saveProgress = () => {
        saveScanState({
            queue,
            activeChunks,
            resultsByFile,
            scanNotes,
            processed,
            completed,
        })
    }

    const onInterrupted = (signal) => {
        saveProgress()
        console.log(`Saved ${relativeFromRoot(scanStatePath)} after ${signal}; rerun the same command to resume.`)
        process.exitCode = signal === 'SIGINT' ? 130 : 143
        process.exit()
    }

    process.once('SIGINT', () => onInterrupted('SIGINT'))
    process.once('SIGTERM', () => onInterrupted('SIGTERM'))

    saveProgress()

    if (queue.length > 0) {
        await new Promise((resolve, reject) => {
            const pump = () => {
                while (active < chunkConcurrency && queue.length > 0) {
                    const chunk = queue.shift()
                    const activeKey = `${processed}:${describeChunk(chunk)}`
                    activeChunks.set(activeKey, chunk)
                    active += 1
                    processed += 1
                    saveProgress()

                    if (processed === 1 || processed % 25 === 0) {
                        console.log(`[${processed}] ${describeChunk(chunk)} | remaining=${queue.length} | active=${active}`)
                    }

                    runHarness(chunk).then((run) => {
                        if (run.ok) {
                            for (const failure of run.failures) {
                                if (failure.result?.pass !== false) {
                                    continue
                                }
                                const relFile = relativeLanguagePath(toPosix(failure.file))
                                const existing = resultsByFile.get(relFile) ?? {
                                    file: relFile,
                                    messages: [],
                                    scenarios: [],
                                    attrsList: [],
                                }
                                existing.messages.push(String(failure.result?.message ?? 'unknown failure'))
                                existing.scenarios.push(String(failure.scenario ?? 'default'))
                                existing.attrsList.push(failure.attrs ?? null)
                                resultsByFile.set(relFile, existing)
                            }
                        } else {
                            const smaller = splitChunk(chunk)
                            if (smaller.length > 0) {
                                scanNotes.push(`Split ${describeChunk(chunk)} after ${run.reason}.`)
                                console.log(`split ${describeChunk(chunk)} -> ${smaller.length} smaller chunks (${run.reason})`)
                                queue.unshift(...smaller)
                            } else {
                                const rawSnippet = String(run.trailing ?? run.rawOutput ?? run.error ?? 'unknown harness failure')
                                    .replace(/\s+/g, ' ')
                                    .trim()
                                    .slice(0, 220)

                                for (const absFile of listFilesForChunk(chunk)) {
                                    recordHarnessIssue(resultsByFile, absFile, rawSnippet)
                                }
                            }
                        }
                        completed += 1
                    }).catch(reject).finally(() => {
                        active -= 1
                        activeChunks.delete(activeKey)
                        saveProgress()
                        if (queue.length === 0 && active === 0) {
                            resolve()
                            return
                        }
                        pump()
                    })
                }
            }
            pump()
        })
    }

    for (const [file, record] of [...resultsByFile.entries()]) {
        if (record.type === 'harness issue') {
            continue
        }
        const dedupedMessages = unique(record.messages)
        const dedupedScenarios = unique(record.scenarios)
        const classified = classifyFailure(file, record.attrsList ?? [], dedupedMessages)
        resultsByFile.set(file, {
            file,
            scope: classified.scope,
            type: classified.type,
            messages: dedupedMessages,
            scenarios: dedupedScenarios,
            features: unique(classified.features),
            negativePhase: classified.negativePhase,
        })
    }

    const markdown = renderSummary(resultsByFile, scanNotes)
    fs.writeFileSync(summaryPath, markdown)
    removeFileIfExistsSync(scanStatePath)
    console.log(`Wrote ${relativeFromRoot(summaryPath)}`)
    console.log(`Failing files recorded: ${resultsByFile.size}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
