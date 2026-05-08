import { compile } from './compiler'
import {
    createHostRegistry,
    createSerializableHostObjectRedirects,
    createVmAsyncSession,
    snapshotVmAsyncSession,
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

export type SerializationPlaygroundExampleBuild = {
    snapshotText: string
    debugPausePtr: number
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
