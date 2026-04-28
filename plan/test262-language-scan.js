const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const rootDir = process.cwd()
const languageDir = path.join(rootDir, 'node_modules', 'test262', 'test', 'language')
const summaryPath = path.join(rootDir, 'plan', 'test262-language-summary.md')
const maxFilesPerChunk = 350
const chunkConcurrency = Math.max(2, Math.min(8, Number(process.env.TEST262_SCAN_CONCURRENCY || 8), os.cpus().length || 1))
const maxExplicitChunkArgs = 48
const maxExplicitChunkCommandLength = 7000

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

function recordHarnessIssue(resultsByFile, absFile, detail) {
    const relFile = relativeLanguagePath(`./${relativeFromRoot(absFile)}`)
    resultsByFile.set(relFile, {
        file: relFile,
        scope: isOutOfScope(relFile, null, [detail]) ? 'out-of-scope' : 'intended',
        type: 'harness issue',
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

    if (/Maximum call stack size exceeded|Error running test:/i.test(combined)) {
        return { scope, type: 'harness issue', features, negativePhase: parseNegative ? 'parse' : null }
    }

    if (scope === 'out-of-scope') {
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
        return { scope, type: 'broken early error semantics', features, negativePhase: parseNegative ? 'parse' : null }
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
    lines.push('- Ran `test262-harness` with the JSON reporter against `node_modules/test262/test/language` in recursively split chunks.')
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
    const queue = [...initialChunks]
    const resultsByFile = new Map()
    const scanNotes = []

    console.log(`Initial chunks: ${queue.length}`)
    console.log(`Chunk concurrency: ${chunkConcurrency}`)

    let processed = 0
    let active = 0

    await new Promise((resolve, reject) => {
        const pump = () => {
            while (active < chunkConcurrency && queue.length > 0) {
                const chunk = queue.shift()
                active += 1
                processed += 1

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
                }).catch(reject).finally(() => {
                    active -= 1
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
    console.log(`Wrote ${relativeFromRoot(summaryPath)}`)
    console.log(`Failing files recorded: ${resultsByFile.size}`)
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
