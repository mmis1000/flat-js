import { compile } from './compiler'
import { Fields, getExecution, type Result } from './runtime'
import {
    appendExecutionSnapshotCheckpoint,
    createHostRegistry,
    createSerializableHostObjectRedirects,
    createSnapshotHistory,
    createVmAsyncSession,
    snapshotVmAsyncSession,
    serializeSnapshotHistory,
} from './serialization'
import { serializePlaygroundSnapshotDocument } from './serialization-playground'

export const SERIALIZATION_PLAYGROUND_EXAMPLE_SOURCE = `const events = []

function record(value) {
    events.push(value)
    log(events.join(' -> '))
}

async function main() {
    record('start')
    vmSleep(2).then(() => {
        record('later timer')
    })
    await vmSleep(1)
    debugger
    record('first after restore')
}

main()
`

export const SERIALIZATION_PLAYGROUND_CHECKPOINT_HISTORY_EXAMPLE_SOURCE = `const events = []

function record(value) {
    events.push(value)
    log(events.join(' -> '))
}

record('root checkpoint')
debugger
record('after first continue')
debugger
record('after second continue')
debugger
record('done')
`

export type SerializationPlaygroundExampleBuild = {
    snapshotText: string
    debugPausePtr: number
}

export type SerializationPlaygroundCheckpointHistoryExampleBuild = {
    historyText: string
    checkpointIds: [string, string, string]
    debugPausePtrs: [number, number, number]
}

export function createSerializationPlaygroundExampleVmGlobal() {
    const names = [
        'Infinity',
        'NaN',
        'undefined',
        'Math',
        'JSON',
        'Reflect',
        'isFinite',
        'isNaN',
        'parseFloat',
        'parseInt',
        'Array',
        'Boolean',
        'Date',
        'Error',
        'EvalError',
        'Function',
        'Map',
        'Number',
        'Object',
        'Promise',
        'Proxy',
        'RangeError',
        'ReferenceError',
        'RegExp',
        'Set',
        'String',
        'Symbol',
        'SyntaxError',
        'TypeError',
        'URIError',
        'WeakMap',
        'WeakSet',
        'eval',
    ] as const
    const obj: Record<string, unknown> = {}
    for (const name of names) {
        if (Reflect.has(globalThis, name)) {
            obj[name] = (globalThis as Record<string, unknown>)[name]
        }
    }
    Reflect.defineProperty(obj, 'globalThis', {
        configurable: false,
        enumerable: true,
        value: obj,
    })
    return obj
}

export function createSerializationPlaygroundExampleHostRegistry(
    log: (value: unknown) => void,
    vmGlobal = createSerializationPlaygroundExampleVmGlobal(),
) {
    return createHostRegistry([
        ['vmGlobal', vmGlobal],
        ['log', log],
    ])
}

export function createSerializationPlaygroundCheckpointHistoryExampleHostRegistry(
    log: (value: unknown) => void,
    vmGlobal = createSerializationPlaygroundExampleVmGlobal(),
) {
    return createHostRegistry([
        ['globalThis', vmGlobal],
        ['log', log],
    ])
}

type CheckpointExamplePausedExecution = {
    debugPausePtr: number
    stepResult: Result
}

function createSerializationPlaygroundCheckpointHistoryExampleExecution(log: (value: unknown) => void) {
    const [program] = compile(SERIALIZATION_PLAYGROUND_CHECKPOINT_HISTORY_EXAMPLE_SOURCE, { range: true })
    const vmGlobal = createSerializationPlaygroundExampleVmGlobal()
    const functionRedirects = createSerializableHostObjectRedirects({ globalThis: vmGlobal })

    let paused = false
    let debugPausePtr: number | undefined
    const execution = getExecution(
        program,
        0,
        vmGlobal,
        [{
            log,
            __proto__: null,
        }],
        undefined,
        [],
        () => (ptr?: number) => {
            paused = true
            debugPausePtr = ptr
        },
        compile,
        functionRedirects,
    )

    const runUntilPause = (): CheckpointExamplePausedExecution => {
        paused = false
        debugPausePtr = undefined
        for (let guard = 0; guard < 10_000; guard++) {
            const stepResult = execution[Fields.step](true)
            if (paused && typeof debugPausePtr === 'number') {
                return { debugPausePtr, stepResult }
            }
            if (stepResult[Fields.done]) {
                throw new Error('Checkpoint history example finished before reaching the next debugger statement')
            }
        }
        throw new Error('Checkpoint history example pause guard exceeded')
    }

    return {
        execution,
        vmGlobal,
        runUntilPause,
    }
}

export function buildSerializationPlaygroundExampleSnapshotDocument(): SerializationPlaygroundExampleBuild {
    const [program] = compile(SERIALIZATION_PLAYGROUND_EXAMPLE_SOURCE, { range: true })
    const vmGlobal = createSerializationPlaygroundExampleVmGlobal()
    const functionRedirects = createSerializableHostObjectRedirects({ globalThis: vmGlobal })

    let debugPausePtr: number | undefined
    const log = (_value: unknown) => {}
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(vmGlobal),
        scopes: [{
            log,
            __proto__: null,
        }],
        compileFunction: compile,
        functionRedirects,
        onPause: ({ ptr }) => {
            debugPausePtr = ptr
        },
    })

    session.runUntilIdleOrPause()
    session.advanceTime(1)
    const pauseResult = session.runUntilIdleOrPause()
    if (!pauseResult.paused || typeof debugPausePtr !== 'number') {
        throw new Error('Failed to build paused serialization playground example snapshot')
    }

    return {
        snapshotText: serializePlaygroundSnapshotDocument({
            kind: 'vmAsyncSession',
            snapshot: snapshotVmAsyncSession(session, {
                hostRegistry: createSerializationPlaygroundExampleHostRegistry(log, vmGlobal),
            }),
            debugPausePtr,
        }),
        debugPausePtr,
    }
}

export function buildSerializationPlaygroundExampleSnapshotText(): string {
    return buildSerializationPlaygroundExampleSnapshotDocument().snapshotText
}

export function buildSerializationPlaygroundCheckpointHistoryExampleDocument(): SerializationPlaygroundCheckpointHistoryExampleBuild {
    const log = (_value: unknown) => {}
    const { execution, vmGlobal, runUntilPause } = createSerializationPlaygroundCheckpointHistoryExampleExecution(log)
    const hostRegistry = createSerializationPlaygroundCheckpointHistoryExampleHostRegistry(log, vmGlobal)

    let history = createSnapshotHistory()

    const rootPause = runUntilPause()
    history = appendExecutionSnapshotCheckpoint(
        history,
        execution,
        { hostRegistry },
        {
            id: 'root-checkpoint',
            label: 'root checkpoint',
            debugPausePtr: rootPause.debugPausePtr,
        },
    )

    const firstContinuePause = runUntilPause()
    history = appendExecutionSnapshotCheckpoint(
        history,
        execution,
        { hostRegistry },
        {
            id: 'after-first-continue',
            parentId: 'root-checkpoint',
            label: 'after first continue',
            debugPausePtr: firstContinuePause.debugPausePtr,
        },
    )

    const secondContinuePause = runUntilPause()
    history = appendExecutionSnapshotCheckpoint(
        history,
        execution,
        { hostRegistry },
        {
            id: 'after-second-continue',
            parentId: 'after-first-continue',
            label: 'after second continue',
            debugPausePtr: secondContinuePause.debugPausePtr,
        },
    )

    return {
        historyText: serializeSnapshotHistory(history),
        checkpointIds: ['root-checkpoint', 'after-first-continue', 'after-second-continue'],
        debugPausePtrs: [rootPause.debugPausePtr, firstContinuePause.debugPausePtr, secondContinuePause.debugPausePtr],
    }
}

export function buildSerializationPlaygroundCheckpointHistoryExampleText(): string {
    return buildSerializationPlaygroundCheckpointHistoryExampleDocument().historyText
}
