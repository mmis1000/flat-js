import {
    parseExecutionSnapshot,
    parseSnapshotHistory,
    parseVmAsyncSessionSnapshot,
    type ExecutionSnapshot,
    type SnapshotHistory,
    type VmAsyncSession,
    type VmAsyncSessionRunResult,
    type VmAsyncSessionSnapshot,
} from './serialization'

export type PlaygroundSnapshotDocument =
    | { kind: 'history'; history: SnapshotHistory }
    | { kind: 'vmAsyncSession'; snapshot: VmAsyncSessionSnapshot, debugPausePtr?: number }
    | { kind: 'execution'; snapshot: ExecutionSnapshot, debugPausePtr?: number }

const PLAYGROUND_SNAPSHOT_DOCUMENT_FORMAT = 'flat-js-playground-snapshot'

type SerializedPlaygroundSnapshotDocument = {
    format: typeof PLAYGROUND_SNAPSHOT_DOCUMENT_FORMAT
    kind: 'vmAsyncSession' | 'execution'
    snapshot: VmAsyncSessionSnapshot | ExecutionSnapshot
    debugPausePtr?: number
}

export function continueVmAsyncSession(session: VmAsyncSession): VmAsyncSessionRunResult {
    return session.paused ? session.resume() : session.runUntilIdleOrPause()
}

export function serializePlaygroundSnapshotDocument(document: Exclude<PlaygroundSnapshotDocument, { kind: 'history' }>): string {
    return JSON.stringify({
        format: PLAYGROUND_SNAPSHOT_DOCUMENT_FORMAT,
        kind: document.kind,
        snapshot: document.snapshot,
        ...(document.debugPausePtr === undefined ? {} : { debugPausePtr: document.debugPausePtr }),
    } satisfies SerializedPlaygroundSnapshotDocument)
}

export function parsePlaygroundSnapshotDocument(text: string): PlaygroundSnapshotDocument {
    const trimmed = text.trim()
    if (!trimmed) {
        throw new Error('Snapshot text is empty')
    }

    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    if (parsed != null && typeof parsed === 'object') {
        if (Array.isArray(parsed.checkpoints) && Array.isArray(parsed.rootIds)) {
            return { kind: 'history', history: parseSnapshotHistory(trimmed) }
        }
        if (
            parsed.format === PLAYGROUND_SNAPSHOT_DOCUMENT_FORMAT
            && (parsed.kind === 'execution' || parsed.kind === 'vmAsyncSession')
            && parsed.snapshot != null
            && typeof parsed.snapshot === 'object'
        ) {
            const snapshotText = JSON.stringify(parsed.snapshot)
            return parsed.kind === 'vmAsyncSession'
                ? {
                    kind: 'vmAsyncSession',
                    snapshot: parseVmAsyncSessionSnapshot(snapshotText),
                    ...(typeof parsed.debugPausePtr === 'number' ? { debugPausePtr: parsed.debugPausePtr } : {}),
                }
                : {
                    kind: 'execution',
                    snapshot: parseExecutionSnapshot(snapshotText),
                    ...(typeof parsed.debugPausePtr === 'number' ? { debugPausePtr: parsed.debugPausePtr } : {}),
                }
        }
        if (
            Array.isArray(parsed.executions)
            && Array.isArray(parsed.promises)
            && Array.isArray(parsed.asyncTasks)
            && Array.isArray(parsed.jobs)
            && Array.isArray(parsed.timers)
            && typeof parsed.mainExecution === 'number'
        ) {
            return { kind: 'vmAsyncSession', snapshot: parseVmAsyncSessionSnapshot(trimmed) }
        }
    }

    return { kind: 'execution', snapshot: parseExecutionSnapshot(trimmed) }
}

export function relabelSnapshotCheckpoint(history: SnapshotHistory, checkpointId: string, label?: string): SnapshotHistory {
    const normalized = label?.trim()
    let found = false
    const checkpoints = history.checkpoints.map(checkpoint => {
        if (checkpoint.id !== checkpointId) {
            return checkpoint
        }
        found = true
        return {
            ...checkpoint,
            ...(normalized ? { label: normalized } : {}),
            ...(normalized ? {} : { label: undefined }),
        }
    })

    if (!found) {
        throw new Error(`Unknown snapshot checkpoint '${checkpointId}'`)
    }

    return {
        ...history,
        checkpoints,
    }
}

export function deleteSnapshotCheckpointBranch(history: SnapshotHistory, checkpointId: string): SnapshotHistory {
    if (!history.checkpoints.some(checkpoint => checkpoint.id === checkpointId)) {
        throw new Error(`Unknown snapshot checkpoint '${checkpointId}'`)
    }

    const children = new Map<string, string[]>()
    for (const checkpoint of history.checkpoints) {
        if (!checkpoint.parentId) continue
        const siblings = children.get(checkpoint.parentId)
        if (siblings) {
            siblings.push(checkpoint.id)
        } else {
            children.set(checkpoint.parentId, [checkpoint.id])
        }
    }

    const removedIds = new Set<string>()
    const queue = [checkpointId]
    while (queue.length > 0) {
        const current = queue.shift()!
        if (removedIds.has(current)) continue
        removedIds.add(current)
        for (const childId of children.get(current) ?? []) {
            queue.push(childId)
        }
    }

    const checkpoints = history.checkpoints.filter(checkpoint => !removedIds.has(checkpoint.id))
    const rootIds = history.rootIds.filter(rootId => !removedIds.has(rootId))
    const headId = history.headId && !removedIds.has(history.headId)
        ? history.headId
        : checkpoints[checkpoints.length - 1]?.id

    return {
        version: history.version,
        rootIds,
        ...(headId ? { headId } : {}),
        checkpoints,
    }
}
