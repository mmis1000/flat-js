import {
    applySnapshotHistoryRetentionPolicy,
    createSnapshotHistory,
    type SnapshotHistory,
} from '../serialization'

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

const createHistory = (): SnapshotHistory => ({
    ...createSnapshotHistory(),
    rootIds: ['root-a', 'root-b'],
    headId: 'leaf-b',
    checkpoints: [
        { id: 'root-a', kind: 'execution', snapshot: executionSnapshot },
        { id: 'branch-a', parentId: 'root-a', kind: 'execution', label: 'keep-me', snapshot: executionSnapshot },
        { id: 'leaf-a', parentId: 'branch-a', kind: 'execution', snapshot: executionSnapshot },
        { id: 'root-b', kind: 'execution', snapshot: executionSnapshot },
        { id: 'branch-b', parentId: 'root-b', kind: 'execution', snapshot: executionSnapshot },
        { id: 'leaf-b', parentId: 'branch-b', kind: 'execution', snapshot: executionSnapshot },
    ],
})

test('applySnapshotHistoryRetentionPolicy preserves labeled checkpoints and counts only extra auto checkpoints toward the budget', () => {
    const compacted = applySnapshotHistoryRetentionPolicy(createHistory(), { maxCheckpoints: 2 })

    expect(compacted.checkpoints.map(checkpoint => checkpoint.id)).toEqual([
        'branch-a',
        'root-b',
        'branch-b',
        'leaf-b',
    ])
    expect(compacted.rootIds).toEqual(['branch-a', 'root-b'])
    expect(compacted.headId).toBe('leaf-b')
})

test('applySnapshotHistoryRetentionPolicy preserves labeled checkpoints while compacting old unlabeled ancestry', () => {
    const compacted = applySnapshotHistoryRetentionPolicy(createHistory(), {
        maxCheckpoints: 3,
    })

    expect(compacted.checkpoints.map(checkpoint => checkpoint.id)).toEqual([
        'branch-a',
        'leaf-a',
        'root-b',
        'branch-b',
        'leaf-b',
    ])
    expect(compacted.rootIds).toEqual(['branch-a', 'root-b'])
    expect(compacted.headId).toBe('leaf-b')
})

test('applySnapshotHistoryRetentionPolicy keeps only labeled checkpoints and the head when auto-checkpoint budget is zero', () => {
    const compacted = applySnapshotHistoryRetentionPolicy(createHistory(), { maxCheckpoints: 0 })

    expect(compacted.checkpoints.map(checkpoint => checkpoint.id)).toEqual([
        'branch-a',
        'leaf-b',
    ])
    expect(compacted.rootIds).toEqual(['branch-a', 'leaf-b'])
    expect(compacted.headId).toBe('leaf-b')
})
