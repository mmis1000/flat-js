import { compile } from '../compiler'
import { Fields, getExecution } from '../runtime'
import {
    createHostRegistry,
    createSnapshotHistory,
    createVmAsyncSession,
    parseSnapshotHistory,
    serializeSnapshotHistory,
    snapshotExecution,
    snapshotVmAsyncSession,
    type SnapshotHistory,
} from '../serialization'

const createPausedExecutionSnapshot = () => {
    const [program] = compile('debugger')
    let paused = false
    const execution = getExecution(
        program,
        0,
        globalThis,
        [],
        undefined,
        [],
        () => () => {
            paused = true
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
    return snapshotExecution(execution, {
        hostRegistry: createHostRegistry([['globalThis', globalThis]]),
    })
}

const createPausedVmAsyncSessionSnapshot = () => {
    const [program] = compile('async function main() { debugger } main()')
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        compileFunction: compile,
    })
    expect(session.runUntilIdleOrPause().paused).toBe(true)
    return snapshotVmAsyncSession(session, {
        hostRegistry: createHostRegistry([['globalThis', globalThis]]),
    })
}

const parseSerializedHistoryDocument = (history: SnapshotHistory) => JSON.parse(serializeSnapshotHistory(history)) as {
    checkpoints: Array<Record<string, unknown>>
}

test('serializeSnapshotHistory stores execution child checkpoints as deltas and parseSnapshotHistory restores full snapshots', () => {
    const rootSnapshot = createPausedExecutionSnapshot()
    const history: SnapshotHistory = {
        ...createSnapshotHistory(),
        rootIds: ['root'],
        headId: 'child',
        checkpoints: [
            {
                id: 'root',
                kind: 'execution',
                snapshot: rootSnapshot,
            },
            {
                id: 'child',
                parentId: 'root',
                kind: 'execution',
                snapshot: {
                    ...rootSnapshot,
                    ptr: rootSnapshot.ptr + 1,
                },
            },
        ],
    }

    const serializedDocument = parseSerializedHistoryDocument(history)
    expect(serializedDocument.checkpoints[1].deltaFrom).toBe('root')
    expect(serializedDocument.checkpoints[1].snapshotDelta).toBeDefined()

    const parsed = parseSnapshotHistory(JSON.stringify(serializedDocument))
    expect(serializeSnapshotHistory(parsed)).toBe(serializeSnapshotHistory(history))
})

test('serializeSnapshotHistory stores VM async-session child checkpoints as deltas and parseSnapshotHistory restores full snapshots', () => {
    const rootSnapshot = createPausedVmAsyncSessionSnapshot()
    const history: SnapshotHistory = {
        ...createSnapshotHistory(),
        rootIds: ['root'],
        headId: 'child',
        checkpoints: [
            {
                id: 'root',
                kind: 'vmAsyncSession',
                snapshot: rootSnapshot,
            },
            {
                id: 'child',
                parentId: 'root',
                kind: 'vmAsyncSession',
                snapshot: {
                    ...rootSnapshot,
                    currentTick: rootSnapshot.currentTick + 1,
                    nextTimerId: rootSnapshot.nextTimerId + 1,
                },
            },
        ],
    }

    const serializedDocument = parseSerializedHistoryDocument(history)
    expect(serializedDocument.checkpoints[1].deltaFrom).toBe('root')
    expect(serializedDocument.checkpoints[1].snapshotDelta).toBeDefined()

    const parsed = parseSnapshotHistory(JSON.stringify(serializedDocument))
    expect(serializeSnapshotHistory(parsed)).toBe(serializeSnapshotHistory(history))
})
