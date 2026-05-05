import { compile } from '../compiler'
import { getLogicalDebugFrames } from '../../web/debug-stack'
import { Fields } from '../runtime'
import {
    createHostRegistry,
    createVmAsyncSession,
    parseVmAsyncSessionSnapshot,
    restoreVmAsyncSession,
    serializeVmAsyncSessionSnapshot,
    snapshotVmAsyncSession,
    UnsupportedSerializationError,
} from '../serialization'

test('VM sleep promise reactions pause and resume as scheduler jobs', () => {
    const [program] = compile(`
vmSleep(1).then(() => {
    debugger
}).then(() => {
    log('end')
})
`, { range: true })
    const logs: string[] = []
    const pausePtrs: Array<number | undefined> = []
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            log: (value: unknown) => logs.push(String(value)),
            __proto__: null,
        }],
        compileFunction: compile,
        onPause: ({ ptr }) => {
            pausePtrs.push(ptr)
        },
    })

    expect(session.runUntilIdleOrPause().paused).toBe(false)
    expect(logs).toEqual([])

    session.advanceTime(1)
    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(pausePtrs).toHaveLength(1)
    expect(logs).toEqual([])

    session.advanceTime(10)
    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(logs).toEqual([])

    expect(session.resume().paused).toBe(false)
    expect(logs).toEqual(['end'])
})

test('VM Promise.resolve reactions drain after the main execution', () => {
    const [program] = compile(`
Promise.resolve('async').then(log)
log('sync')
`, { range: true })
    const logs: string[] = []
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            log: (value: unknown) => logs.push(String(value)),
            __proto__: null,
        }],
        compileFunction: compile,
    })

    expect(session.runUntilIdleOrPause().paused).toBe(false)
    expect(logs).toEqual(['sync', 'async'])
})

test('async await continuation pause blocks later timer jobs globally', () => {
    const [program] = compile(`
async function main() {
    vmSleep(2).then(() => {
        log('later')
    })
    await vmSleep(1)
    debugger
    log('first')
}
main()
`, { range: true })
    const logs: string[] = []
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            log: (value: unknown) => logs.push(String(value)),
            __proto__: null,
        }],
        compileFunction: compile,
    })

    expect(session.runUntilIdleOrPause().paused).toBe(false)
    expect(logs).toEqual([])

    session.advanceTime(1)
    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(logs).toEqual([])

    expect(session.advanceTime(10).settledTimers).toBe(0)
    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(logs).toEqual([])

    expect(session.resume().paused).toBe(false)
    expect(logs).toEqual(['first'])

    expect(session.advanceTime(1).settledTimers).toBe(1)
    expect(session.runUntilIdleOrPause().paused).toBe(false)
    expect(logs).toEqual(['first', 'later'])
})

test('debug execution points at a paused promise reaction job', () => {
    const [program] = compile(`
vmSleep(1).then(function reactionJob() {
    const local = 'job'
    debugger
    log(local)
})
`, { range: true })
    const logs: string[] = []
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            log: (value: unknown) => logs.push(String(value)),
            __proto__: null,
        }],
        compileFunction: compile,
    })

    session.runUntilIdleOrPause()
    session.advanceTime(1)

    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(session.debugExecution).toBe(session.pausedExecution)
    expect(session.debugExecution).not.toBe(session.mainExecution)
    expect(getLogicalDebugFrames(session.debugExecution[Fields.stack])[0].functionName).toBe('reactionJob')

    expect(session.resume().paused).toBe(false)
    expect(logs).toEqual(['job'])
})

test('snapshot and restore a paused VM promise reaction job', () => {
    const [program] = compile(`
vmSleep(1).then(() => {
    debugger
    return 'end'
}).then(log)
`, { range: true })
    const logs: string[] = []
    const log = (value: unknown) => logs.push(String(value))
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            log,
            __proto__: null,
        }],
        compileFunction: compile,
    })
    const hostRegistry = createHostRegistry([
        ['globalThis', globalThis],
        ['log', log],
    ])

    session.runUntilIdleOrPause()
    session.advanceTime(1)
    expect(session.runUntilIdleOrPause().paused).toBe(true)

    const snapshotText = serializeVmAsyncSessionSnapshot(snapshotVmAsyncSession(session, { hostRegistry }))
    const restored = restoreVmAsyncSession(parseVmAsyncSessionSnapshot(snapshotText), {
        hostRegistry,
        compileFunction: compile,
    })

    expect(restored.paused).toBe(true)
    expect(restored.resume().paused).toBe(false)
    expect(logs).toEqual(['end'])
})

test('snapshot and restore a paused async continuation with later timers blocked', () => {
    const [program] = compile(`
async function main() {
    vmSleep(2).then(() => {
        log('later')
    })
    await vmSleep(1)
    debugger
    log('first')
}
main()
`, { range: true })
    const logs: string[] = []
    const log = (value: unknown) => logs.push(String(value))
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            log,
            __proto__: null,
        }],
        compileFunction: compile,
    })
    const hostRegistry = createHostRegistry([
        ['globalThis', globalThis],
        ['log', log],
    ])

    session.runUntilIdleOrPause()
    session.advanceTime(1)
    expect(session.runUntilIdleOrPause().paused).toBe(true)

    const snapshotText = serializeVmAsyncSessionSnapshot(snapshotVmAsyncSession(session, { hostRegistry }))
    const restored = restoreVmAsyncSession(parseVmAsyncSessionSnapshot(snapshotText), {
        hostRegistry,
        compileFunction: compile,
    })

    expect(restored.advanceTime(10).settledTimers).toBe(0)
    expect(restored.runUntilIdleOrPause().paused).toBe(true)
    expect(logs).toEqual([])

    expect(restored.resume().paused).toBe(false)
    expect(logs).toEqual(['first'])

    expect(restored.advanceTime(1).settledTimers).toBe(1)
    expect(restored.runUntilIdleOrPause().paused).toBe(false)
    expect(logs).toEqual(['first', 'later'])
})

test('session snapshots reject native Promise.resolve().then results', () => {
    const NativePromise = Promise
    const [program] = compile(`
const p = NativePromise.resolve('native').then(() => 1)
debugger
p
`, { range: true })
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            NativePromise,
            __proto__: null,
        }],
        compileFunction: compile,
    })
    const hostRegistry = createHostRegistry([
        ['globalThis', globalThis],
        ['NativePromise', NativePromise],
    ])

    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(() => snapshotVmAsyncSession(session, { hostRegistry })).toThrow(UnsupportedSerializationError)
})

test('session snapshots reject registered native pending promises', () => {
    const nativePending = new Promise(() => {})
    const [program] = compile(`
const p = nativePending
debugger
p
`, { range: true })
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            nativePending,
            __proto__: null,
        }],
        compileFunction: compile,
    })
    const hostRegistry = createHostRegistry([
        ['globalThis', globalThis],
        ['nativePending', nativePending],
    ])

    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(() => snapshotVmAsyncSession(session, { hostRegistry })).toThrow(UnsupportedSerializationError)
})

test('session snapshots reject registered host thenables without invoking then getters', () => {
    let thenGetterCalls = 0
    const thenable = {}
    Object.defineProperty(thenable, 'then', {
        configurable: true,
        enumerable: true,
        get() {
            thenGetterCalls++
            return () => {}
        },
    })
    const [program] = compile(`
const value = thenable
debugger
value
`, { range: true })
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            thenable,
            __proto__: null,
        }],
        compileFunction: compile,
    })
    const hostRegistry = createHostRegistry([
        ['globalThis', globalThis],
        ['thenable', thenable],
    ])

    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(() => snapshotVmAsyncSession(session, { hostRegistry })).toThrow(UnsupportedSerializationError)
    expect(thenGetterCalls).toBe(0)
})

test('session snapshots keep async generators unsupported', () => {
    const [program] = compile(`
async function* gen() {
    yield 1
}
const g = gen()
debugger
g
`, { range: true })
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [],
        compileFunction: compile,
    })
    const hostRegistry = createHostRegistry([
        ['globalThis', globalThis],
    ])

    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(() => snapshotVmAsyncSession(session, { hostRegistry })).toThrow(UnsupportedSerializationError)
})
