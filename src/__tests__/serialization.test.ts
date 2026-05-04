import * as fs from 'fs'
import * as path from 'path'
import { compile } from '../compiler'
import { Fields, getExecution } from '../runtime'
import {
    UnsupportedSerializationError,
    createHostRegistry,
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

const createPausedHarness = (source: string, inputValue = ''): Harness => {
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
        compile
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
    })
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

test.each([
    ['Date', `const value = new Date(); debugger`],
    ['Map', `const value = new Map(); debugger`],
    ['Proxy', `const value = new Proxy({}, {}); debugger`],
    ['bound function', `function f() { return 1 } const value = f.bind(null); debugger`],
    ['generator', `function* g() { yield 1 } const value = g(); debugger`],
    ['class', `class A {} debugger`],
])('snapshot rejects unsupported %s state', (_name, source) => {
    const harness = createPausedHarness(source)

    expect(() => snapshotExecution(harness.execution, {
        hostRegistry: harness.hostRegistry,
    })).toThrow(UnsupportedSerializationError)
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
