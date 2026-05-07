import { compile } from '../compiler'
import { Fields, getExecution } from '../runtime'
import {
    appendExecutionSnapshotCheckpoint,
    createHostRegistry,
    createSnapshotHistory,
    serializeExecutionSnapshot,
    serializeSnapshotHistory,
    snapshotExecution,
    type SnapshotHistory,
} from '../serialization'
import {
    deleteSnapshotCheckpointBranch,
    parsePlaygroundSnapshotDocument,
    relabelSnapshotCheckpoint,
} from '../serialization-playground'

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

const createPausedExecution = () => {
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
    return execution
}

const createSerializedHistoryDocument = () => {
    const execution = createPausedExecution()
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
    const execution = createPausedExecution()
    const serialized = serializeExecutionSnapshot(snapshotExecution(execution, {
        hostRegistry: createHostRegistry([['globalThis', globalThis]]),
    }))
    const parsed = parsePlaygroundSnapshotDocument(serialized)
    expect(parsed.kind).toBe('execution')
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
