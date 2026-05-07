import { compile } from '../compiler'
import { getLogicalDebugFrames } from '../../web/debug-stack'
import { Fields } from '../runtime'
import { continueVmAsyncSession } from '../serialization-playground'
import {
    appendVmAsyncSessionSnapshotCheckpoint,
    createHostRegistry,
    createSnapshotHistory,
    createVmAsyncSession,
    parseSnapshotHistory,
    parseVmAsyncSessionSnapshot,
    restoreVmAsyncSession,
    restoreVmAsyncSessionCheckpoint,
    serializeSnapshotHistory,
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


test('serialization playground helper resumes restored paused async continuations', () => {
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

    expect(restored.paused).toBe(true)
    expect(restored.runUntilIdleOrPause().paused).toBe(true)
    expect(logs).toEqual([])

    expect(continueVmAsyncSession(restored).paused).toBe(false)
    expect(logs).toEqual(['first'])

    expect(restored.advanceTime(1).settledTimers).toBe(1)
    expect(continueVmAsyncSession(restored).paused).toBe(false)
    expect(logs).toEqual(['first', 'later'])
})


test('vm async session snapshots serialize compactly while remaining legacy-compatible on parse', () => {
    const [program] = compile(`
async function main() {
    const values = []
    for (let i = 0; i < 80; i++) {
        values.push(i)
    }
    await vmSleep(1)
    debugger
    log(values.length)
}
main()
`, { range: true })
    const logs: string[] = []
    const log = (value: unknown) => logs.push(String(value))
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{ log, __proto__: null }],
        compileFunction: compile,
    })
    const hostRegistry = createHostRegistry([
        ['globalThis', globalThis],
        ['log', log],
    ])

    session.runUntilIdleOrPause()
    session.advanceTime(1)
    expect(session.runUntilIdleOrPause().paused).toBe(true)

    const snapshot = snapshotVmAsyncSession(session, { hostRegistry })
    const compactText = serializeVmAsyncSessionSnapshot(snapshot)
    const legacyText = JSON.stringify(snapshot)
    expect(compactText.length).toBeLessThan(legacyText.length)

    const restoredCompact = restoreVmAsyncSession(parseVmAsyncSessionSnapshot(compactText), {
        hostRegistry,
        compileFunction: compile,
    })
    expect(continueVmAsyncSession(restoredCompact).paused).toBe(false)
    expect(logs).toEqual(['80'])

    const restoredLegacy = restoreVmAsyncSession(parseVmAsyncSessionSnapshot(legacyText), {
        hostRegistry,
        compileFunction: compile,
    })
    expect(continueVmAsyncSession(restoredLegacy).paused).toBe(false)
    expect(logs).toEqual(['80', '80'])
})

test('vm async session snapshot history supports branching serialize/parse and restore by checkpoint id', () => {
    const [program] = compile(`
async function main() {
    const values = ['root']
    await vmSleep(1)
    debugger
    log(values.join(','))
}
main()
`, { range: true })
    const logs: string[] = []
    const log = (value: unknown) => logs.push(String(value))
    const hostRegistry = createHostRegistry([
        ['globalThis', globalThis],
        ['log', log],
    ])
    const createPausedSession = (initialValues: string[]) => {
        const listLiteral = initialValues.map(value => JSON.stringify(value)).join(', ')
        const [sessionProgram] = compile(`
async function main() {
    const values = [${listLiteral}]
    await vmSleep(1)
    debugger
    log(values.join(','))
}
main()
`, { range: true })
        const session = createVmAsyncSession(sessionProgram, {
            globalThis: Object.create(globalThis),
            scopes: [{ log, __proto__: null }],
            compileFunction: compile,
        })
        session.runUntilIdleOrPause()
        session.advanceTime(1)
        expect(session.runUntilIdleOrPause().paused).toBe(true)
        return session
    }

    let history = appendVmAsyncSessionSnapshotCheckpoint(
        createSnapshotHistory(),
        createPausedSession(['root']),
        { hostRegistry },
        { id: 'root', label: 'root checkpoint' }
    )
    expect(history.rootIds).toEqual(['root'])

    history = appendVmAsyncSessionSnapshotCheckpoint(
        history,
        createPausedSession(['root', 'branch-a']),
        { hostRegistry },
        { id: 'branch-a', parentId: 'root', label: 'branch a' }
    )

    history = appendVmAsyncSessionSnapshotCheckpoint(
        history,
        createPausedSession(['root', 'branch-b']),
        { hostRegistry },
        { id: 'branch-b', parentId: 'root', label: 'branch b' }
    )

    expect(history.headId).toBe('branch-b')
    expect(history.checkpoints.map((checkpoint: { id: string }) => checkpoint.id)).toEqual(['root', 'branch-a', 'branch-b'])

    const parsedHistory = parseSnapshotHistory(serializeSnapshotHistory(history))
    const restoredBranchA = restoreVmAsyncSessionCheckpoint(parsedHistory, 'branch-a', {
        hostRegistry,
        compileFunction: compile,
    })
    expect(continueVmAsyncSession(restoredBranchA).paused).toBe(false)

    const restoredBranchB = restoreVmAsyncSessionCheckpoint(parsedHistory, 'branch-b', {
        hostRegistry,
        compileFunction: compile,
    })
    expect(continueVmAsyncSession(restoredBranchB).paused).toBe(false)

    expect(logs).toEqual(['root,branch-a', 'root,branch-b'])
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
