import { compile } from '../src/compiler'
import { Fields, getExecution } from '../src/runtime'
import {
    createHostRegistry,
    parseExecutionSnapshot,
    restoreExecution,
    serializeExecutionSnapshot,
    snapshotExecution,
} from '../src/serialization'

const sourceEl = document.getElementById('source') as HTMLTextAreaElement
const logEl = document.getElementById('log') as HTMLPreElement
const snapshotEl = document.getElementById('snapshot') as HTMLTextAreaElement
const statusEl = document.getElementById('status') as HTMLParagraphElement
const startButton = document.getElementById('start') as HTMLButtonElement
const continueButton = document.getElementById('continue') as HTMLButtonElement
const saveButton = document.getElementById('save') as HTMLButtonElement
const loadButton = document.getElementById('load') as HTMLButtonElement
const resetButton = document.getElementById('reset') as HTMLButtonElement

const defaultSource = `const name = input()
let count = 1
const state = { name, count }

log('hello ' + state.name)
debugger

state.count += 1
log(state.name + ' checkpoint ' + state.count)
debugger

state.count += 1
log('done ' + state.count)
`

type VmStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

let execution: ReturnType<typeof getExecution> | null = null
let status: VmStatus = 'idle'
let statusText = 'Idle'
let logs: string[] = []

function makeGlobalThis() {
    const names = [
        'Infinity',
        'NaN',
        'undefined',
        'isFinite',
        'isNaN',
        'parseFloat',
        'parseInt',
        'Array',
        'Boolean',
        'Error',
        'EvalError',
        'Function',
        'Number',
        'Object',
        'RangeError',
        'ReferenceError',
        'String',
        'Symbol',
        'SyntaxError',
        'TypeError',
        'URIError',
    ]
    const obj: any = {}
    for (const name of names) {
        if (Reflect.has(globalThis, name)) {
            obj[name] = (globalThis as any)[name]
        }
    }
    Reflect.defineProperty(obj, 'globalThis', {
        configurable: false,
        enumerable: true,
        value: obj,
    })
    return obj
}

const vmGlobal = makeGlobalThis()

const log = (value: unknown) => {
    logs.push(String(value))
    render()
}

const input = () => {
    return window.prompt('input()') ?? ''
}

const hostRegistry = createHostRegistry([
    ['vmGlobal', vmGlobal],
    ['log', log],
    ['input', input],
])

const getDebugFunction = () => () => {
    status = 'paused'
    statusText = 'Paused at debugger'
}

function render() {
    statusEl.textContent = statusText
    logEl.textContent = logs.join('\n')
    startButton.disabled = status === 'running'
    continueButton.disabled = execution == null || status !== 'paused'
    saveButton.disabled = execution == null || status !== 'paused'
    loadButton.disabled = status === 'running'
    resetButton.disabled = status === 'running'
}

function setError(error: unknown) {
    status = 'error'
    statusText = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    render()
}

function runUntilPauseOrDone() {
    if (!execution) {
        return
    }

    status = 'running'
    statusText = 'Running'
    render()

    try {
        let guard = 0
        while (execution && status === 'running') {
            const result = execution[Fields.step]()
            if (result[Fields.done]) {
                status = 'done'
                statusText = 'Done'
                break
            }
            if (result[Fields.await] || result[Fields.yield]) {
                throw new Error('V1 playground only supports synchronous execution')
            }
            if (++guard > 20000) {
                throw new Error('Execution guard exceeded')
            }
        }
        render()
    } catch (error) {
        setError(error)
    }
}

function start() {
    logs = []
    snapshotEl.value = ''
    status = 'idle'
    statusText = 'Compiling'
    render()

    try {
        const [program] = compile(sourceEl.value, { range: true })
        const scope = { log, input, __proto__: null } as Record<string, unknown>
        execution = getExecution(
            program,
            0,
            vmGlobal,
            [scope],
            undefined,
            [],
            getDebugFunction,
            compile
        )
        runUntilPauseOrDone()
    } catch (error) {
        execution = null
        setError(error)
    }
}

function save() {
    if (!execution) {
        return
    }
    try {
        const snapshot = snapshotExecution(execution, { hostRegistry })
        snapshotEl.value = serializeExecutionSnapshot(snapshot)
        statusText = 'Snapshot saved'
        render()
    } catch (error) {
        setError(error)
    }
}

function load() {
    try {
        const snapshot = parseExecutionSnapshot(snapshotEl.value)
        execution = restoreExecution(snapshot, {
            hostRegistry,
            compileFunction: compile,
            getDebugFunction,
        })
        sourceEl.value = snapshot.source
        status = 'paused'
        statusText = 'Snapshot loaded'
        render()
    } catch (error) {
        setError(error)
    }
}

function reset() {
    execution = null
    logs = []
    snapshotEl.value = ''
    status = 'idle'
    statusText = 'Idle'
    render()
}

sourceEl.value = defaultSource
render()

startButton.addEventListener('click', start)
continueButton.addEventListener('click', runUntilPauseOrDone)
saveButton.addEventListener('click', save)
loadButton.addEventListener('click', load)
resetButton.addEventListener('click', reset)
