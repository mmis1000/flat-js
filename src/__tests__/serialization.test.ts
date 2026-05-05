import * as fs from 'fs'
import * as path from 'path'
import { compile } from '../compiler'
import { Fields, getExecution, materializeScopeStaticBindings, run } from '../runtime'
import {
    UnsupportedSerializationError,
    createHostRegistry,
    createSerializableHostObjectRedirects,
    parseExecutionSnapshot,
    restoreExecution,
    serializeExecutionSnapshot,
    snapshotExecution,
} from '../serialization'

type Harness = {
    execution: ReturnType<typeof getExecution>
    source: string
    logs: string[]
    hostRegistry: ReturnType<typeof createHostRegistry>
    functionRedirects: WeakMap<Function, Function>
    continueToDone(): unknown
}

const runUntilPause = (execution: ReturnType<typeof getExecution>, paused: () => boolean) => {
    let guard = 0
    while (!paused()) {
        const result = execution[Fields.step]()
        if (result[Fields.done]) {
            throw new Error('debugger statement was not reached')
        }
        if (result[Fields.await] || result[Fields.yield]) {
            throw new Error('unexpected suspension before debugger')
        }
        if (++guard > 10000) {
            throw new Error('pause guard exceeded')
        }
    }
}

const continueToDone = (execution: ReturnType<typeof getExecution>) => {
    let result
    let guard = 0
    do {
        result = execution[Fields.step]()
        if (!result[Fields.done] && (result[Fields.await] || result[Fields.yield])) {
            throw new Error('unexpected suspension')
        }
        if (++guard > 10000) {
            throw new Error('continue guard exceeded')
        }
    } while (!result[Fields.done])
    return (result as any)[Fields.evalResult]
}

const createPausedHarness = (
    source: string,
    inputValue = '',
    functionRedirects = new WeakMap<Function, Function>()
): Harness => {
    const [program] = compile(source, { range: true })
    const logs: string[] = []
    let nextInput = inputValue
    const log = (value: unknown) => logs.push(String(value))
    const input = () => {
        const value = nextInput
        nextInput = ''
        return value
    }
    const scope = { log, input, __proto__: null } as Record<string, unknown>
    let paused = false
    const execution = getExecution(
        program,
        0,
        globalThis,
        [scope],
        undefined,
        [],
        () => () => {
            paused = true
        },
        compile,
        functionRedirects
    )
    const hostRegistry = createHostRegistry([
        ['globalThis', globalThis],
        ['log', log],
        ['input', input],
    ])

    runUntilPause(execution, () => paused)

    return {
        execution,
        source,
        logs,
        hostRegistry,
        functionRedirects,
        continueToDone: () => continueToDone(execution),
    }
}

const snapshotAndRestore = (harness: Harness) => {
    const snapshotText = serializeExecutionSnapshot(snapshotExecution(harness.execution, {
        hostRegistry: harness.hostRegistry,
    }))
    return restoreExecution(parseExecutionSnapshot(snapshotText), {
        hostRegistry: harness.hostRegistry,
        compileFunction: compile,
        functionRedirects: harness.functionRedirects,
    })
}

const runReplOnPausedExecution = (harness: Harness, source: string) => {
    const [program] = compile(source, { evalMode: true })
    const frame = harness.execution[Fields.stack][harness.execution[Fields.stack].length - 1]
    const replScopes = [...harness.execution[Fields.scopes]]
    const cleanupMaterializedScopes = replScopes.map(scope => materializeScopeStaticBindings(scope))
    try {
        run(
            program,
            0,
            globalThis,
            replScopes,
            undefined,
            [],
            compile,
            harness.functionRedirects,
            undefined,
            frame[Fields.variableEnvironment] ?? null
        )
    } finally {
        for (let index = cleanupMaterializedScopes.length - 1; index >= 0; index--) {
            cleanupMaterializedScopes[index]()
        }
    }
}

test('snapshot and restore preserve static slots, closures, and object identity', () => {
    const harness = createPausedHarness(`
function outer(seed) {
    let local = seed + 1
    const shared = { value: local }
    shared.self = shared
    function add(v) {
        return shared.value + v
    }
    debugger
    log(shared.self === shared)
    log(add(2))
}
outer(5)
`)

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['true', '8'])
})

test('snapshot and restore preserve active try/finally state', () => {
    const harness = createPausedHarness(`
function runner() {
    try {
        log('try')
        debugger
        return 'done'
    } finally {
        log('finally')
    }
}
runner()
`)

    expect(harness.logs).toEqual(['try'])
    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['try', 'finally'])
})

test('registered host refs round-trip through text snapshots', () => {
    const harness = createPausedHarness(`
const name = input()
debugger
log('name=' + name)
`, 'Ada')

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['name=Ada'])
})

test('snapshots embed the original JS source text', () => {
    const harness = createPausedHarness(`const name = input()
debugger
log(name + ':ok')
`, 'Ada')

    const snapshot = snapshotExecution(harness.execution, {
        hostRegistry: harness.hostRegistry,
    })
    const snapshotText = serializeExecutionSnapshot(snapshot)
    const parsed = parseExecutionSnapshot(snapshotText)

    expect(parsed.source).toBe(harness.source)
    expect(parsed.records.some(record => record.programSource === harness.source)).toBe(true)

    const restored = restoreExecution(parsed, {
        hostRegistry: harness.hostRegistry,
        compileFunction: compile,
    })
    continueToDone(restored)

    expect(harness.logs).toEqual(['Ada:ok'])
})

test('snapshot rejects untracked host-created ordinary objects', () => {
    const harness = createPausedHarness(`
const value = JSON.parse('{"nested":{"ok":true}}')
debugger
log(value.nested.ok)
`)

    expect(() => snapshotExecution(harness.execution, {
        hostRegistry: harness.hostRegistry,
    })).toThrow(UnsupportedSerializationError)
})

test('serializable host object redirects adopt safe builtin-created ordinary objects', () => {
    const functionRedirects = createSerializableHostObjectRedirects()
    const harness = createPausedHarness(`
const parsed = JSON.parse('{"nested":{"count":2}}')
const fromEntries = Object.fromEntries([['name', 'Ada']])
const noProto = Object.create(null)
noProto.value = 4
const descriptors = Object.getOwnPropertyDescriptors({ parsed })
debugger
log(parsed.nested.count)
log(fromEntries.name)
log(Object.getPrototypeOf(noProto) === null)
log(descriptors.parsed.value === parsed)
`, '', functionRedirects)

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['2', 'Ada', 'true', 'true'])
})

test('snapshot and restore preserve loop progress', () => {
    const harness = createPausedHarness(`
const values = []
for (let i = 0; i < 4; i++) {
    values.push(i)
    if (i === 1) debugger
}
log(values.join(','))
`)

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['0,1,2,3'])
})

test('snapshot and restore preserve prototype-sharing, sparse arrays, symbols, accessors, and extensibility', () => {
    const harness = createPausedHarness(`
const proto = { base: 3 }
const left = { own: 4 }
const right = { own: 5 }
Object.setPrototypeOf(left, proto)
Object.setPrototypeOf(right, proto)

const sparse = []
sparse[2] = 'two'
Object.preventExtensions(sparse)

let backing = 6
const accessor = {}
const getValue = function () { return backing }
const setValue = function (value) { backing = value }
Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get: getValue,
    set: setValue,
})
accessor[Symbol.toStringTag] = 'AccessorBox'
Object.preventExtensions(accessor)

debugger
accessor.value = 9
log(Object.getPrototypeOf(left) === Object.getPrototypeOf(right))
log(left.base + right.own)
log((0 in sparse) + ':' + (2 in sparse) + ':' + sparse.length + ':' + Object.isExtensible(sparse))
log(accessor.value + ':' + accessor[Symbol.toStringTag] + ':' + Object.isExtensible(accessor))
`)

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['true', '8', 'false:true:3:false', '9:AccessorBox:false'])
})

test('snapshot and restore preserve state changed by REPL before snapshot', () => {
    const harness = createPausedHarness(`
function runner() {
    let local = 2
    debugger
    log(local + replVar)
}
runner()
`)

    runReplOnPausedExecution(harness, 'local = 5; var replVar = 7')
    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['12'])
})

test('snapshot and restore preserve for-in iterator state', () => {
    const harness = createPausedHarness(`
const object = { a: 1, b: 2, c: 3 }
const seen = []
for (const key in object) {
    seen.push(key)
    if (key === 'b') debugger
}
log(seen.join(','))
`)

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['a,b,c'])
})

test('snapshot and restore preserve VM-authored for-of iterator state', () => {
    const harness = createPausedHarness(`
const iterable = {
    [Symbol.iterator]: function () {
        let value = 0
        return {
            next: function () {
                value++
                return { value, done: value > 3 }
            },
        }
    },
}
const seen = []
for (const value of iterable) {
    seen.push(value)
    if (value === 2) debugger
}
log(seen.join(','))
`)

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['1,2,3'])
})

test('snapshot and restore preserve array for-of iterator state', () => {
    const harness = createPausedHarness(`
const seen = []
for (const value of [4, 5, 6]) {
    seen.push(value)
    if (value === 5) debugger
}
log(seen.join(','))
`)

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['4,5,6'])
})

test('snapshot and restore preserve Map and Set entries', () => {
    const harness = createPausedHarness(`
const key = { name: 'key' }
const value = { count: 1 }
const map = new Map()
map.set(key, value)
map.set(map, 'self')
map.extra = { tag: 'extra' }

const set = new Set()
set.add(key)
set.add(set)

debugger
log(map.get(key) === value)
log(map.get(map))
log(map.extra.tag)
log(set.has(key))
log(set.has(set))
log(map.size + ':' + set.size)
`)

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['true', 'self', 'extra', 'true', 'true', '2:2'])
})

test('snapshot and restore preserve Map and Set object identity', () => {
    const harness = createPausedHarness(`
const shared = { label: 'shared' }
const map = new Map([[shared, shared]])
const set = new Set([shared])
debugger
log(map.get(shared) === shared)
log(set.has(map.get(shared)))
`)

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['true', 'true'])
})

test('snapshot and restore preserve reachable WeakMap and WeakSet entries', () => {
    const harness = createPausedHarness(`
const key = {}
const weakMap = new WeakMap()
const weakSet = new WeakSet()
{
    const hiddenKey = {}
    const firstValue = { hiddenKey }
    weakMap.set(key, firstValue)
    weakMap.set(hiddenKey, 'hidden')
    weakSet.add(key)
    weakSet.add(hiddenKey)
}
debugger
const first = weakMap.get(key)
log(first.hiddenKey !== undefined)
log(weakMap.get(first.hiddenKey))
log(weakSet.has(key))
log(weakSet.has(first.hiddenKey))
`)

    const restored = snapshotAndRestore(harness)
    continueToDone(restored)

    expect(harness.logs).toEqual(['true', 'hidden', 'true', 'true'])
})

test.each([
    ['Date', `const value = new Date(); debugger`],
    ['Proxy', `const value = new Proxy({}, {}); debugger`],
    ['bound function', `function f() { return 1 } const value = f.bind(null); debugger`],
    ['generator', `function* g() { yield 1 } const value = g(); debugger`],
    ['class', `class A {} debugger`],
    ['native iterator object', `const value = [1, 2][Symbol.iterator](); debugger`],
    ['unregistered host function', `const value = Math.max; debugger`],
    ['accessor closing over unsupported host state', `
const host = JSON.parse('{"ok":true}')
function getOk() { return host.ok }
const value = {}
Object.defineProperty(value, 'ok', { get: getOk })
debugger
`],
    ['local symbol keyed property', `
const key = Symbol('local')
const value = {}
value[key] = 1
debugger
`],
])('snapshot rejects unsupported %s state', (_name, source) => {
    const harness = createPausedHarness(source)

    expect(() => snapshotExecution(harness.execution, {
        hostRegistry: harness.hostRegistry,
    })).toThrow(UnsupportedSerializationError)
})

test('registered host descriptor overlays round-trip by host id', () => {
    const makeHost = () => {
        const host = function host() {}
        Object.defineProperty(host, 'changed', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: 'before',
        })
        Object.defineProperty(host, 'gone', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: 'remove',
        })
        return host
    }
    const host = makeHost()
    const logs: string[] = []
    const scope = {
        host,
        log: (value: unknown) => logs.push(String(value)),
        input: () => '',
        __proto__: null,
    } as Record<string, unknown>
    const hostRegistry = createHostRegistry([
        ['globalThis', globalThis],
        ['log', scope.log],
        ['input', scope.input],
        ['host', host],
    ])
    const [program] = compile(`
host.extra = { value: 1 }
host.changed = { value: 2 }
delete host.gone
const value = host
debugger
log(host.extra.value + ':' + host.changed.value + ':' + ('gone' in host))
`, { range: true })
    let paused = false
    const execution = getExecution(
        program,
        0,
        globalThis,
        [scope],
        undefined,
        [],
        () => () => {
            paused = true
        },
        compile
    )
    runUntilPause(execution, () => paused)
    const snapshotText = serializeExecutionSnapshot(snapshotExecution(execution, { hostRegistry }))

    const restoredHost = makeHost()
    const restoredLogs: string[] = []
    const restoreRegistry = createHostRegistry([
        ['globalThis', globalThis],
        ['log', (value: unknown) => restoredLogs.push(String(value))],
        ['input', () => ''],
        ['host', restoredHost],
    ])
    const restored = restoreExecution(parseExecutionSnapshot(snapshotText), {
        hostRegistry: restoreRegistry,
        compileFunction: compile,
    })
    continueToDone(restored)

    expect(restoredLogs).toEqual(['1:2:false'])
    expect((restoredHost as any).extra.value).toBe(1)
    expect((restoredHost as any).changed.value).toBe(2)
    expect('gone' in restoredHost).toBe(false)
})

test('runtime-inline does not include optional serializer API when generated', () => {
    const runtimeInlineCandidates = [
        path.resolve(__dirname, '../runtime-inline.ts'),
        path.resolve(__dirname, '../../lib/runtime-inline.js'),
    ]
    const runtimeInline = runtimeInlineCandidates.find(candidate => fs.existsSync(candidate))
    if (!runtimeInline) {
        return
    }
    const text = fs.readFileSync(runtimeInline, 'utf8')
    expect(text).not.toContain('snapshotExecution')
    expect(text).not.toContain('restoreExecution')
    expect(text).not.toContain('UnsupportedSerializationError')
})
