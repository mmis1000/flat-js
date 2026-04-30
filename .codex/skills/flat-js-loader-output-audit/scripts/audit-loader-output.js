const fs = require('fs')

const filename = process.argv[2] || 'example/opcode-kitchen-sink-loader.js'
const text = fs.readFileSync(filename, 'utf8')

const countNeedle = (needle) => {
    const positions = []
    let at = 0
    while ((at = text.indexOf(needle, at)) !== -1) {
        positions.push(at)
        at += needle.length
    }
    return positions
}

const snippet = (idx) =>
    text.slice(Math.max(0, idx - 180), Math.min(text.length, idx + 220)).replace(/\s+/g, ' ')

const knownLeaks = [
    'names:[]',
    'flags:[]',
    'values:[]',
    '.names',
    '.flags',
    '.values',
    '__pos__',
]

const internalQuotedNames = [
    'savedScopes',
    'scopes',
    'valueStack',
    'tdz',
    'immutable',
    'offset',
    'state',
    'resolveType',
    'invokeType',
    'ptr',
    'stack',
    'setDebugFunction',
    'step',
    'programSection',
    'evalResult',
    'newTarget',
    'globalThis',
    'strict',
    'delegate',
    'pushValue',
    'setPendingThrow',
    'generator',
    'variableEnvironment',
    'bodyOffset',
    'completed',
    'started',
    'pendingAction',
    'baseFrame',
    'execution',
    'delegateIterator',
    'delegatePhase',
    'delegateMode',
    'debugCallback',
    'scopeDebugNames',
]

const quoteHits = []
for (const name of internalQuotedNames) {
    const re = new RegExp(`(["'\`])${name}\\1`, 'g')
    const matches = [...text.matchAll(re)]
    if (matches.length) {
        quoteHits.push([name, matches.map((match) => match.index)])
    }
}

let failed = false
console.log(`Auditing ${filename}`)
console.log(`length: ${text.length}`)

for (const needle of knownLeaks) {
    const positions = countNeedle(needle)
    console.log(`${needle}: ${positions.length}`)
    if (positions.length > 0) {
        failed = true
        for (const idx of positions.slice(0, 3)) {
            console.log(`  @${idx}: ${snippet(idx)}`)
        }
    }
}

console.log('quoted internal names:')
if (quoteHits.length === 0) {
    console.log('  none')
} else {
    failed = true
    for (const [name, positions] of quoteHits) {
        console.log(`  ${name}: ${positions.length}`)
        for (const idx of positions.slice(0, 3)) {
            console.log(`    @${idx}: ${snippet(idx)}`)
        }
    }
}

for (const reviewed of ['.pos', '_$_:']) {
    const positions = countNeedle(reviewed)
    console.log(`reviewed ${reviewed}: ${positions.length}`)
    for (const idx of positions.slice(0, 2)) {
        console.log(`  @${idx}: ${snippet(idx)}`)
    }
}

if (failed) {
    process.exitCode = 1
}
