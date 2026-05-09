import { readFileSync } from 'fs'
import { resolve } from 'path'

import { compile } from '../compiler'
import { Fields, getExecution } from '../runtime'
import {
    appendExecutionSnapshotCheckpoint,
    createHostRegistry,
    createSnapshotHistory,
    restoreExecutionCheckpoint,
    restoreVmAsyncSession,
    serializeExecutionSnapshot,
    serializeSnapshotHistory,
    snapshotExecution,
    type SnapshotHistory,
} from '../serialization'
import {
    continueVmAsyncSession,
    deleteSnapshotCheckpointBranch,
    parsePlaygroundSnapshotDocument,
    relabelSnapshotCheckpoint,
    serializePlaygroundSnapshotDocument,
} from '../serialization-playground'
import {
    buildSerializationPlaygroundCheckpointHistoryExampleDocument,
    buildSerializationPlaygroundExampleSnapshotDocument,
    createSerializationPlaygroundCheckpointHistoryExampleHostRegistry,
    createSerializationPlaygroundExampleHostRegistry,
    createSerializationPlaygroundExampleVmGlobal,
} from '../serialization-playground-example'

const executionSnapshot = {
    version: 1,
    source: 'debugger',
    ptr: 0,
    evalResult: { t: 'undefined' },
    result: { t: 'undefined' },
    stack: [],
    refs: [],
    rootRefs: [],
    frames: [],
    records: [],
    globalThis: { t: 'undefined' },
    programs: [],
} as any

const createPausedExecution = (source = 'debugger') => {
    const [program] = compile(source)
    let paused = false
    let debugPtr: number | undefined
    const execution = getExecution(
        program,
        0,
        globalThis,
        [],
        undefined,
        [],
        () => (ptr?: number) => {
            paused = true
            debugPtr = ptr
        },
        compile
    )
    for (let guard = 0; guard < 10_000 && !paused; guard++) {
        const result = execution[Fields.step]()
        if (result[Fields.done]) {
            throw new Error('debugger statement was not reached')
        }
    }
    if (!paused) {
        throw new Error('pause guard exceeded')
    }
    return { execution, debugPtr }
}

const createSerializedHistoryDocument = () => {
    const { execution } = createPausedExecution()
    const history = appendExecutionSnapshotCheckpoint(
        createSnapshotHistory(),
        execution,
        { hostRegistry: createHostRegistry([['globalThis', globalThis]]) },
        { id: 'root', label: 'root checkpoint' }
    )
    return serializeSnapshotHistory(history)
}

const createHistory = (): SnapshotHistory => ({
    ...createSnapshotHistory(),
    rootIds: ['root'],
    headId: 'branch-b',
    checkpoints: [
        {
            id: 'root',
            kind: 'execution',
            label: 'root checkpoint',
            snapshot: executionSnapshot,
        },
        {
            id: 'branch-a',
            parentId: 'root',
            kind: 'execution',
            label: 'branch a',
            snapshot: executionSnapshot,
        },
        {
            id: 'branch-b',
            parentId: 'root',
            kind: 'execution',
            label: 'branch b',
            snapshot: executionSnapshot,
        },
    ],
})

test('parsePlaygroundSnapshotDocument recognizes snapshot history documents', () => {
    const parsed = parsePlaygroundSnapshotDocument(createSerializedHistoryDocument())
    expect(parsed.kind).toBe('history')
    if (parsed.kind !== 'history') {
        throw new Error('expected history document')
    }
    expect(parsed.history.headId).toBe('root')
    expect(parsed.history.checkpoints.map(checkpoint => checkpoint.id)).toEqual(['root'])
})

test('parsePlaygroundSnapshotDocument recognizes execution snapshots', () => {
    const { execution } = createPausedExecution()
    const serialized = serializeExecutionSnapshot(snapshotExecution(execution, {
        hostRegistry: createHostRegistry([['globalThis', globalThis]]),
    }))
    const parsed = parsePlaygroundSnapshotDocument(serialized)
    expect(parsed.kind).toBe('execution')
})

test('serializePlaygroundSnapshotDocument preserves raw snapshot debug pause pointers', () => {
    const source = `const before = 1\ndebugger\nconst after = 2\n`
    const { execution, debugPtr } = createPausedExecution(source)
    expect(typeof debugPtr).toBe('number')

    const serialized = serializePlaygroundSnapshotDocument({
        kind: 'execution',
        snapshot: snapshotExecution(execution, {
            hostRegistry: createHostRegistry([['globalThis', globalThis]]),
        }),
        debugPausePtr: debugPtr,
    })
    const parsed = parsePlaygroundSnapshotDocument(serialized)
    expect(parsed.kind).toBe('execution')
    if (parsed.kind !== 'execution') {
        throw new Error('expected execution document')
    }
    expect(parsed.debugPausePtr).toBe(debugPtr)
})

test('serializeSnapshotHistory preserves checkpoint debug pause pointers', () => {
    const source = `const before = 1\ndebugger\nconst after = 2\n`
    const { execution, debugPtr } = createPausedExecution(source)
    expect(typeof debugPtr).toBe('number')

    const history = appendExecutionSnapshotCheckpoint(
        createSnapshotHistory(),
        execution,
        { hostRegistry: createHostRegistry([['globalThis', globalThis]]) },
        { id: 'root', debugPausePtr: debugPtr }
    )
    const parsed = parsePlaygroundSnapshotDocument(serializeSnapshotHistory(history))
    expect(parsed.kind).toBe('history')
    if (parsed.kind !== 'history') {
        throw new Error('expected history document')
    }
    expect(parsed.history.checkpoints[0]).toMatchObject({
        id: 'root',
        debugPausePtr: debugPtr,
    })
})

test('buildSerializationPlaygroundExampleSnapshotDocument creates a restorable paused async snapshot', () => {
    const { snapshotText, debugPausePtr } = buildSerializationPlaygroundExampleSnapshotDocument()
    expect(debugPausePtr).toBeGreaterThan(0)

    const parsed = parsePlaygroundSnapshotDocument(snapshotText)
    expect(parsed.kind).toBe('vmAsyncSession')
    if (parsed.kind !== 'vmAsyncSession') {
        throw new Error('expected vmAsyncSession document')
    }
    expect(parsed.debugPausePtr).toBe(debugPausePtr)
    expect(parsed.snapshot.paused).toBe(true)

    const logs: string[] = []
    const log = (value: unknown) => logs.push(String(value))
    const vmGlobal = createSerializationPlaygroundExampleVmGlobal()
    const restored = restoreVmAsyncSession(parsed.snapshot, {
        hostRegistry: createSerializationPlaygroundExampleHostRegistry(log, vmGlobal),
        compileFunction: compile,
    })

    expect(continueVmAsyncSession(restored).paused).toBe(false)
    expect(logs).toEqual(['start -> first after restore'])
    expect(restored.advanceTime(1).settledTimers).toBe(1)
    expect(continueVmAsyncSession(restored).paused).toBe(false)
    expect(logs).toEqual([
        'start -> first after restore',
        'start -> first after restore -> later timer',
    ])
})

test('buildSerializationPlaygroundCheckpointHistoryExampleDocument creates a restorable checkpoint history chain', () => {
    const { historyText, checkpointIds, debugPausePtrs } = buildSerializationPlaygroundCheckpointHistoryExampleDocument()
    expect(checkpointIds).toEqual(['root-checkpoint', 'after-first-continue', 'after-second-continue'])
    expect(debugPausePtrs.every(ptr => ptr > 0)).toBe(true)

    const parsed = parsePlaygroundSnapshotDocument(historyText)
    expect(parsed.kind).toBe('history')
    if (parsed.kind !== 'history') {
        throw new Error('expected history document')
    }
    expect(parsed.history.headId).toBe('after-second-continue')
    expect(parsed.history.checkpoints.map(checkpoint => checkpoint.id)).toEqual(checkpointIds)
    expect(parsed.history.checkpoints.map(checkpoint => checkpoint.label)).toEqual([
        'root checkpoint',
        'after first continue',
        'after second continue',
    ])
    expect(parsed.history.checkpoints.map(checkpoint => checkpoint.debugPausePtr)).toEqual(debugPausePtrs)

    const logs: string[] = []
    const log = (value: unknown) => logs.push(String(value))
    const vmGlobal = createSerializationPlaygroundExampleVmGlobal()
    const restoredRoot = restoreExecutionCheckpoint(parsed.history, 'root-checkpoint', {
        hostRegistry: createSerializationPlaygroundCheckpointHistoryExampleHostRegistry(log, vmGlobal),
        compileFunction: compile,
    })
    for (let guard = 0; guard < 10_000; guard++) {
        const result = restoredRoot[Fields.step](true)
        if (result[Fields.done]) {
            break
        }
    }

    expect(logs).toEqual([
        'root checkpoint -> after first continue',
        'root checkpoint -> after first continue -> after second continue',
        'root checkpoint -> after first continue -> after second continue -> done',
    ])
})

test('checkpoint history example host registry resolves globalThis alias used by the browser fixture', () => {
    const vmGlobal = createSerializationPlaygroundExampleVmGlobal()
    const hostRegistry = createSerializationPlaygroundCheckpointHistoryExampleHostRegistry(() => {}, vmGlobal)

    expect(hostRegistry.getId(vmGlobal)).toBe('globalThis')
    expect(hostRegistry.getValue('globalThis')).toBe(vmGlobal)
})

test('serialization playground checkpoint button invokes loadSelectedCheckpoint without passing PointerEvent', () => {
    const vueSource = readFileSync(resolve(__dirname, '../../example/serialization-playground.vue'), 'utf8')

    expect(vueSource).toContain('@click="loadSelectedCheckpoint()"')
    expect(vueSource).not.toContain('@click="loadSelectedCheckpoint"')
    expect(vueSource).toContain("['globalThis', vmGlobal]")
})

test('relabelSnapshotCheckpoint updates or clears checkpoint labels', () => {
    const history = createHistory()
    const renamed = relabelSnapshotCheckpoint(history, 'branch-a', ' renamed branch ')
    expect(renamed.checkpoints.find(checkpoint => checkpoint.id === 'branch-a')?.label).toBe('renamed branch')

    const cleared = relabelSnapshotCheckpoint(renamed, 'branch-a', '   ')
    expect(cleared.checkpoints.find(checkpoint => checkpoint.id === 'branch-a')?.label).toBeUndefined()
})

test('deleteSnapshotCheckpointBranch removes descendants and repairs head state', () => {
    const history = {
        ...createHistory(),
        checkpoints: [
            ...createHistory().checkpoints,
            {
                id: 'leaf',
                parentId: 'branch-a',
                kind: 'execution' as const,
                snapshot: executionSnapshot,
            },
        ],
        headId: 'leaf',
    }

    const deletedBranch = deleteSnapshotCheckpointBranch(history, 'branch-a')
    expect(deletedBranch.rootIds).toEqual(['root'])
    expect(deletedBranch.checkpoints.map(checkpoint => checkpoint.id)).toEqual(['root', 'branch-b'])
    expect(deletedBranch.headId).toBe('branch-b')

    const deletedRoot = deleteSnapshotCheckpointBranch(deletedBranch, 'root')
    expect(deletedRoot.rootIds).toEqual([])
    expect(deletedRoot.checkpoints).toEqual([])
    expect(deletedRoot.headId).toBeUndefined()
})
