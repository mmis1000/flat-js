<template>
    <main class="serialization-app" :class="{ paused: state === 'paused' }">
        <header class="topbar">
            <div class="title-group">
                <h1>Serialization Playground</h1>
                <nav aria-label="Project links">
                    <a href="./">Examples</a>
                    <a href="../">Web debugger</a>
                </nav>
            </div>
            <div class="toolbar">
                <button type="button" :disabled="state === 'running'" @click="start">Start</button>
                <button type="button" :disabled="state !== 'paused'" @click="continueExecution">Continue</button>
                <button type="button" :disabled="state !== 'paused'" @click="stepExecution(false)">Step</button>
                <button type="button" :disabled="state !== 'paused'" @click="stepExecution(true)">Step In</button>
                <button type="button" :disabled="state !== 'paused'" @click="save">Save</button>
                <button type="button" :disabled="state === 'running' || (state !== 'paused' && !snapshotText.trim())" @click="saveUrl">Save URL</button>
                <button type="button" :disabled="state === 'running' || !snapshotText.trim()" @click="load">Load</button>
                <button type="button" :disabled="state === 'running' || !snapshotUrl" @click="loadUrl">Load URL</button>
                <button type="button" :disabled="state === 'running'" @click="reset">Reset</button>
            </div>
        </header>

        <p class="status">{{ statusText }}</p>

        <section class="workspace">
            <section class="pane code-pane">
                <div class="pane-title">Source</div>
                <monaco
                    ref="editor"
                    v-model="text"
                    class="pane-body"
                    :readonly="state === 'running'"
                    :highlights="highlights"
                />
            </section>

            <section class="pane debug-pane">
                <div class="pane-title">Debug</div>
                <debugger
                    class="pane-body debug-body"
                    :refreshKey="refreshKey"
                    :stack-container="stackContainer"
                    :debug-info="debugInfo"
                    :selected-frame-index="selectedDebugFrameIndex"
                    :selectable-program-sections="selectableDebugProgramSections"
                    @select-frame="selectDebugFrame"
                />
            </section>

            <section class="pane io-pane">
                <div class="pane-title">Log</div>
                <pre class="log-output pane-body-small">{{ logs.join('\n') }}</pre>

                <form class="repl-form" @submit.prevent="runRepl">
                    <input
                        v-model="replText"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="REPL"
                        :disabled="state !== 'paused'"
                    >
                    <button type="submit" :disabled="state !== 'paused' || replText.trim() === ''">Run</button>
                </form>

                <div class="pane-title">REPL</div>
                <pre class="repl-output pane-body-small">{{ replOutput }}</pre>

                <div class="pane-title">Snapshot</div>
                <textarea v-model="snapshotText" class="snapshot" spellcheck="false"></textarea>

                <div class="pane-title">URL</div>
                <textarea v-model="snapshotUrl" class="snapshot-url" readonly spellcheck="false"></textarea>
            </section>
        </section>
    </main>
</template>

<script lang="ts">
import { ComponentPublicInstance, defineComponent, markRaw } from 'vue'
import Monaco from '../web/components/monaco.vue'
import Debugger from '../web/components/debugger.vue'
import { compile, type DebugInfo } from '../src/compiler'
import {
    Fields,
    FrameType,
    getExecution,
    materializeScopeStaticBindings,
    run,
    type Result,
    type Stack,
} from '../src/runtime'
import {
    createHostRegistry,
    parseExecutionSnapshot,
    restoreExecution,
    serializeExecutionSnapshot,
    snapshotExecution,
} from '../src/serialization'
import {
    getLogicalDebugFrames,
    getSelectedDebugFrameSourcePointers,
    resolveDebugFrameIndex,
} from '../web/debug-stack'

type VmStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

const defaultSource = `function greet(name) {
    const state = { name, count: 1 }
    log('hello ' + state.name)
    debugger
    return function checkpoint() {
        state.count += 1
        log(state.name + ' checkpoint ' + state.count)
        return state.count
    }
}

const name = input()
const next = greet(name)
next()
debugger
log('done ' + next())
`

function emptyDebugInfo(): DebugInfo {
    return {
        sourceMap: [],
        internals: [],
        scopeDebugMap: new Map(),
        codeLength: 0,
    }
}

function sameSourceMapPos(
    a: [number, number, number, number] | undefined,
    b: [number, number, number, number] | undefined
) {
    return a === b || (
        a !== undefined
        && b !== undefined
        && a[0] === b[0]
        && a[1] === b[1]
        && a[2] === b[2]
        && a[3] === b[3]
    )
}

const SNAPSHOT_HASH_PREFIX = '#snapshot='

function encodeSnapshotForUrl(text: string) {
    const bytes = new TextEncoder().encode(text)
    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
}

function decodeSnapshotFromUrl(text: string) {
    const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index)
    }
    return new TextDecoder().decode(bytes)
}

function readSnapshotTextFromHash() {
    if (!window.location.hash.startsWith(SNAPSHOT_HASH_PREFIX)) {
        return ''
    }
    const encoded = window.location.hash.slice(SNAPSHOT_HASH_PREFIX.length)
    return encoded ? decodeSnapshotFromUrl(encoded) : ''
}

function createSnapshotUrl(text: string) {
    const url = new URL(window.location.href)
    url.hash = `snapshot=${encodeSnapshotForUrl(text)}`
    return url.toString()
}

function makeGlobalThis() {
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
let activeApp: null | { appendLog(value: unknown): void } = null

const hostLog = (value: unknown) => {
    activeApp?.appendLog(value)
}

const hostInput = () => window.prompt('input()') ?? ''

const hostRegistry = createHostRegistry([
    ['vmGlobal', vmGlobal],
    ['log', hostLog],
    ['input', hostInput],
])

function withNonReactive<TData>(data: TData) {
    return <TNonReactive>() => data as TData & TNonReactive
}

export default defineComponent({
    components: {
        Monaco,
        Debugger,
    },
    data() {
        return withNonReactive({
            text: defaultSource,
            logs: [] as string[],
            replText: '',
            replOutput: '',
            snapshotText: '',
            snapshotUrl: '',
            state: 'idle' as VmStatus,
            statusText: 'Idle',
            execution: null as ReturnType<typeof getExecution> | null,
            program: [] as number[],
            debugInfo: emptyDebugInfo(),
            stackContainer: { stack: [] as Stack },
            refreshKey: Math.random(),
            highlights: [] as [number, number, number, number][],
            selectedDebugFrameIndex: null as number | null,
            debugPausePtr: null as number | null,
        })<{
            highlightRafId: number
        }>()
    },
    computed: {
        selectableDebugProgramSections(): ReadonlySet<number[]> {
            return this.program.length === 0 ? new Set() : new Set([this.program])
        },
    },
    mounted() {
        activeApp = this
        this.highlightRafId = 0
        this.refreshSnapshotUrl()
        this.loadInitialSnapshotUrl()
        window.addEventListener('hashchange', this.onHashChange)
        this.flushDebugHighlightSync()
    },
    beforeUnmount() {
        if (activeApp === this) {
            activeApp = null
        }
        window.removeEventListener('hashchange', this.onHashChange)
        this.cancelDebugHighlightRaf()
    },
    methods: {
        refreshSnapshotUrl() {
            this.snapshotUrl = window.location.hash.startsWith(SNAPSHOT_HASH_PREFIX)
                ? window.location.href
                : ''
        },
        loadInitialSnapshotUrl() {
            const snapshotText = readSnapshotTextFromHash()
            if (snapshotText) {
                this.loadSnapshotText(snapshotText, 'Snapshot URL loaded')
            }
        },
        onHashChange() {
            this.refreshSnapshotUrl()
            if (this.state === 'running') {
                return
            }
            this.loadInitialSnapshotUrl()
        },
        appendLog(value: unknown) {
            this.logs.push(String(value))
        },
        setError(error: unknown) {
            this.state = 'error'
            this.statusText = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
            this.cancelDebugHighlightRaf()
            this.flushDebugHighlightSync()
        },
        resetDebugState() {
            this.cancelDebugHighlightRaf()
            this.execution = null
            this.program = []
            this.debugInfo = emptyDebugInfo()
            this.stackContainer = { stack: [] as Stack }
            this.highlights = []
            this.selectedDebugFrameIndex = null
            this.debugPausePtr = null
            this.refreshKey = Math.random()
        },
        getSourceMapForProgramPtr(programSection: number[] | undefined, ptr: number): [number, number, number, number] | undefined {
            return programSection === this.program ? this.debugInfo.sourceMap[ptr] : undefined
        },
        getSourceMapAtPtr(execution: ReturnType<typeof getExecution> | null): [number, number, number, number] | undefined {
            if (!execution || execution[Fields.stack].length === 0) {
                return undefined
            }
            const top = execution[Fields.stack][execution[Fields.stack].length - 1]
            return this.getSourceMapForProgramPtr(top[Fields.programSection], execution[Fields.ptr])
        },
        isSourcePointerInternal(programSection: number[] | undefined, ptr: number): boolean {
            return programSection !== this.program || !!this.debugInfo.internals[ptr]
        },
        findNextVisibleSourcePtr(programSection: number[] | undefined, ptr: number): number | null {
            if (programSection !== this.program) {
                return null
            }
            for (let index = ptr; index < this.debugInfo.sourceMap.length; index++) {
                if (this.debugInfo.sourceMap[index] && !this.debugInfo.internals[index]) {
                    return index
                }
            }
            return null
        },
        findPreviousVisibleSourcePtr(programSection: number[] | undefined, ptr: number): number | null {
            if (programSection !== this.program) {
                return null
            }
            for (let index = Math.min(ptr, this.debugInfo.sourceMap.length - 1); index >= 0; index--) {
                if (this.debugInfo.sourceMap[index] && !this.debugInfo.internals[index]) {
                    return index
                }
            }
            return null
        },
        getNextVisibleSourcePtr(execution: ReturnType<typeof getExecution>): number | null {
            const stack = execution[Fields.stack]
            if (stack.length === 0) {
                return null
            }
            const top = stack[stack.length - 1]
            const ptr = execution[Fields.ptr]
            if (this.getSourceMapForProgramPtr(top[Fields.programSection], ptr) && !this.isSourcePointerInternal(top[Fields.programSection], ptr)) {
                return ptr
            }
            return this.findNextVisibleSourcePtr(top[Fields.programSection], ptr)
        },
        isExecutionAtVisibleUserCode(execution: ReturnType<typeof getExecution>): boolean {
            const stack = execution[Fields.stack]
            if (stack.length === 0) {
                return false
            }
            const top = stack[stack.length - 1]
            return !!this.getSourceMapForProgramPtr(top[Fields.programSection], execution[Fields.ptr])
                && !this.isSourcePointerInternal(top[Fields.programSection], execution[Fields.ptr])
        },
        getSelectedSourceMapAtPtr(execution: ReturnType<typeof getExecution> | null): [number, number, number, number] | undefined {
            if (!execution) {
                return undefined
            }
            const frames = getLogicalDebugFrames(
                execution[Fields.stack],
                new Set(),
                this.selectableDebugProgramSections
            )
            const selectedFrame = frames[resolveDebugFrameIndex(frames, this.selectedDebugFrameIndex)]
            const allowParkedFallback = !!selectedFrame && !selectedFrame.active
            const pointers = getSelectedDebugFrameSourcePointers(
                execution[Fields.stack],
                this.selectedDebugFrameIndex,
                this.debugPausePtr ?? execution[Fields.ptr],
                new Set(),
                this.selectableDebugProgramSections
            )
            for (const pointer of pointers) {
                const pos = this.getSourceMapForProgramPtr(pointer.programSection, pointer.ptr)
                if (pos && !this.isSourcePointerInternal(pointer.programSection, pointer.ptr)) {
                    return pos
                }
                if (allowParkedFallback) {
                    const parkedPtr = this.findPreviousVisibleSourcePtr(pointer.programSection, pointer.ptr)
                    const parkedPos = parkedPtr == null
                        ? undefined
                        : this.getSourceMapForProgramPtr(pointer.programSection, parkedPtr)
                    if (parkedPos) {
                        return parkedPos
                    }
                }
            }
            return undefined
        },
        getInternalsAtPtr(execution: ReturnType<typeof getExecution> | null): boolean {
            if (!execution || execution[Fields.stack].length === 0) {
                return false
            }
            const top = execution[Fields.stack][execution[Fields.stack].length - 1]
            return this.isSourcePointerInternal(top[Fields.programSection], execution[Fields.ptr])
        },
        syncSelectedDebugFrame(stack: Stack) {
            if (this.selectedDebugFrameIndex == null) {
                return
            }
            const frames = getLogicalDebugFrames(stack, new Set(), this.selectableDebugProgramSections)
            if (
                this.selectedDebugFrameIndex <= 0
                || this.selectedDebugFrameIndex >= frames.length
                || !frames[this.selectedDebugFrameIndex].selectable
            ) {
                this.selectedDebugFrameIndex = null
            }
        },
        updateDebugStackContainer(execution: ReturnType<typeof getExecution>) {
            const stack = execution[Fields.stack]
            this.syncSelectedDebugFrame(stack)
            this.stackContainer = { get stack() { return stack } }
        },
        applyDebugHighlight(execution: ReturnType<typeof getExecution>) {
            const pos = this.getSelectedSourceMapAtPtr(execution)
            this.highlights = pos
                ? [[pos[0] + 1, pos[1] + 1, pos[2] + 1, pos[3] + 1]]
                : []
        },
        cancelDebugHighlightRaf() {
            if (this.highlightRafId) {
                cancelAnimationFrame(this.highlightRafId)
                this.highlightRafId = 0
            }
        },
        scheduleDebugHighlight() {
            if (this.highlightRafId) return
            this.highlightRafId = requestAnimationFrame(() => {
                this.highlightRafId = 0
                const execution = this.execution
                if (!execution) return
                this.updateDebugStackContainer(execution)
                this.applyDebugHighlight(execution)
                this.refreshKey = Math.random()
            })
        },
        flushDebugHighlightSync() {
            this.cancelDebugHighlightRaf()
            const execution = this.execution
            if (!execution) {
                this.highlights = []
                return
            }
            this.updateDebugStackContainer(execution)
            this.applyDebugHighlight(execution)
            this.refreshKey = Math.random()
        },
        revealDebugHighlight() {
            this.$nextTick(() => {
                const editor = this.$refs.editor as ComponentPublicInstance & { revealHighlight?: () => void }
                editor.revealHighlight?.()
            })
        },
        selectDebugFrame(index: number | null) {
            this.selectedDebugFrameIndex = index
            this.flushDebugHighlightSync()
            this.revealDebugHighlight()
        },
        pause(debugPtr: number | null = null) {
            const execution = this.execution
            this.debugPausePtr = debugPtr ?? (execution ? this.getNextVisibleSourcePtr(execution) : null)
            this.state = 'paused'
            this.statusText = debugPtr == null ? 'Paused' : 'Paused at debugger'
            this.flushDebugHighlightSync()
            this.revealDebugHighlight()
        },
        getDebugPauseCallback() {
            return (ptr?: number) => {
                this.pause(typeof ptr === 'number' ? ptr : null)
            }
        },
        ensureSynchronousResult(result: Result) {
            if (!result[Fields.done] && (result[Fields.await] || result[Fields.yield])) {
                throw new Error('V1 playground only supports synchronous execution')
            }
        },
        continueExecution() {
            const execution = this.execution
            if (!execution) return

            this.debugPausePtr = null
            this.state = 'running'
            this.statusText = 'Running'
            this.updateDebugStackContainer(execution)

            try {
                let guard = 0
                while (this.state === 'running') {
                    const result = execution[Fields.step](true)
                    this.ensureSynchronousResult(result)
                    if (result[Fields.done]) {
                        this.state = 'done'
                        this.statusText = 'Done'
                        this.highlights = []
                        this.flushDebugHighlightSync()
                        break
                    }
                    if (++guard > 20000) {
                        throw new Error('Execution guard exceeded')
                    }
                }
                if (this.state === 'running') {
                    this.pause()
                }
            } catch (error) {
                this.setError(error)
            }
        },
        stepExecution(stepIn = false) {
            const execution = this.execution
            if (!execution) return

            this.debugPausePtr = null
            this.state = 'running'
            this.statusText = 'Running'
            this.updateDebugStackContainer(execution)

            try {
                const getPos = () => this.getSourceMapAtPtr(execution)
                const originalPos = getPos()
                const getCurrentStackLength = () => execution[Fields.stack].filter(frame => frame[Fields.type] === FrameType.Function).length
                let maxStack = getCurrentStackLength()
                let skipping = false
                let firstIgnored = false
                let result: Result
                let guard = 0

                do {
                    result = execution[Fields.step](true)
                    this.ensureSynchronousResult(result)

                    if (!skipping) {
                        skipping = stepIn ? false : getCurrentStackLength() > maxStack
                    } else if (!firstIgnored && getCurrentStackLength() <= maxStack) {
                        firstIgnored = true
                    } else if (firstIgnored) {
                        firstIgnored = false
                        skipping = false
                    }

                    maxStack = Math.min(maxStack, getCurrentStackLength())
                    if (++guard > 20000) {
                        throw new Error('Step guard exceeded')
                    }
                } while (
                    this.state === 'running'
                    && !result[Fields.done]
                    && (
                        sameSourceMapPos(getPos(), originalPos)
                        || this.getInternalsAtPtr(execution)
                        || skipping
                    )
                )

                if (result![Fields.done]) {
                    this.state = 'done'
                    this.statusText = 'Done'
                    this.highlights = []
                    this.flushDebugHighlightSync()
                } else if (this.state === 'running') {
                    this.pause()
                }
            } catch (error) {
                this.setError(error)
            }
        },
        start() {
            this.logs = []
            this.replOutput = ''
            this.snapshotText = ''
            this.resetDebugState()
            this.state = 'running'
            this.statusText = 'Compiling'

            try {
                const [program, debugInfo] = compile(this.text, { range: true })
                this.program = markRaw(program)
                this.debugInfo = markRaw(debugInfo)
                const scope = { log: hostLog, input: hostInput, __proto__: null } as Record<string, unknown>
                this.execution = markRaw(getExecution(
                    program,
                    0,
                    vmGlobal,
                    [scope],
                    undefined,
                    [],
                    () => this.getDebugPauseCallback(),
                    compile
                ))
                this.continueExecution()
            } catch (error) {
                this.setError(error)
            }
        },
        save() {
            try {
                this.snapshotText = this.createSnapshotText()
                this.statusText = 'Snapshot saved'
            } catch (error) {
                this.setError(error)
            }
        },
        createSnapshotText() {
            const execution = this.execution
            if (this.state === 'paused' && execution) {
                const snapshot = snapshotExecution(execution, { hostRegistry })
                return serializeExecutionSnapshot(snapshot)
            }
            const text = this.snapshotText.trim()
            if (text) {
                return text
            }
            throw new Error('No paused execution or snapshot text to serialize')
        },
        saveUrl() {
            try {
                this.snapshotText = this.createSnapshotText()
                this.snapshotUrl = createSnapshotUrl(this.snapshotText)
                window.history.replaceState(null, '', this.snapshotUrl)
                this.statusText = 'Snapshot URL saved'
            } catch (error) {
                this.setError(error)
            }
        },
        loadSnapshotText(snapshotText: string, statusText = 'Snapshot loaded') {
            const snapshot = parseExecutionSnapshot(snapshotText)
            const [, debugInfo] = compile(snapshot.source, { range: true })
            const execution = restoreExecution(snapshot, {
                hostRegistry,
                compileFunction: compile,
                getDebugFunction: () => this.getDebugPauseCallback(),
            })
            this.snapshotText = snapshotText
            this.text = snapshot.source
            this.execution = markRaw(execution)
            this.program = markRaw(execution[Fields.stack][0]?.[Fields.programSection] ?? [])
            this.debugInfo = markRaw(debugInfo)
            this.state = 'paused'
            this.statusText = statusText
            this.debugPausePtr = this.getNextVisibleSourcePtr(execution)
            this.flushDebugHighlightSync()
            this.revealDebugHighlight()
        },
        load() {
            try {
                this.loadSnapshotText(this.snapshotText)
            } catch (error) {
                this.setError(error)
            }
        },
        loadUrl() {
            try {
                const snapshotText = readSnapshotTextFromHash()
                if (!snapshotText) {
                    throw new Error('No snapshot URL to load')
                }
                this.loadSnapshotText(snapshotText, 'Snapshot URL loaded')
            } catch (error) {
                this.setError(error)
            }
        },
        reset() {
            this.resetDebugState()
            this.logs = []
            this.replText = ''
            this.replOutput = ''
            this.snapshotText = ''
            this.refreshSnapshotUrl()
            this.state = 'idle'
            this.statusText = 'Idle'
        },
        materializeReplScopes(scopes: Record<string, unknown>[]) {
            return scopes.map(scope => materializeScopeStaticBindings(scope))
        },
        runRepl() {
            const text = this.replText
            this.replText = ''
            if (!text.trim()) return

            this.replOutput += `> ${text}\n`

            try {
                const execution = this.execution
                if (!execution) {
                    this.replOutput += '(no VM)\n'
                    return
                }
                const [programData] = compile(text, { evalMode: true })
                const replScopes = [...execution[Fields.scopes]]
                const frame = execution[Fields.stack][execution[Fields.stack].length - 1]
                const variableEnvironmentScope = frame?.[Fields.variableEnvironment] ?? null
                const cleanupMaterializedScopes = this.materializeReplScopes(replScopes)
                let result
                try {
                    result = run(
                        programData,
                        0,
                        vmGlobal,
                        replScopes,
                        undefined,
                        [],
                        compile,
                        new WeakMap(),
                        () => this.getDebugPauseCallback(),
                        variableEnvironmentScope
                    )
                } finally {
                    for (let index = cleanupMaterializedScopes.length - 1; index >= 0; index--) {
                        cleanupMaterializedScopes[index]()
                    }
                    this.flushDebugHighlightSync()
                }
                this.replOutput += `${String(result)}\n`
            } catch (error) {
                this.replOutput += `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`
                this.flushDebugHighlightSync()
            }
        },
    },
})
</script>

<style scoped>
.serialization-app {
    --border: #cbd6e2;
    --ink: #152333;
    --muted: #637386;
    --panel: #ffffff;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 12px;
    width: 100%;
    height: 100%;
    padding: 18px;
    box-sizing: border-box;
    color: var(--ink);
    background: #f6f8fb;
    font-family: "Aptos", "Segoe UI Variable", "Segoe UI", sans-serif;
}
.topbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
}
.title-group {
    display: flex;
    align-items: baseline;
    gap: 14px;
    min-width: 0;
}
h1 {
    margin: 0;
    font-size: 1.35rem;
    line-height: 1.2;
}
nav {
    display: flex;
    gap: 12px;
    white-space: nowrap;
}
a {
    color: #075e9f;
}
.toolbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
}
button {
    border: 1px solid #9db1c7;
    background: #fff;
    color: var(--ink);
    border-radius: 6px;
    padding: 7px 11px;
    font: inherit;
    cursor: pointer;
}
button:disabled {
    color: #7b8796;
    background: #eef3f8;
    cursor: default;
}
.status {
    min-height: 34px;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    color: #334155;
    box-sizing: border-box;
}
.workspace {
    display: grid;
    grid-template-columns: minmax(360px, 1fr) minmax(280px, 0.54fr) minmax(320px, 0.62fr);
    gap: 12px;
    min-width: 0;
    min-height: 0;
}
.pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
}
.pane-title {
    flex: 0 0 auto;
    padding: 8px 10px;
    border-bottom: 1px solid #dbe4ee;
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 650;
    text-transform: uppercase;
}
.pane-body {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
}
.debug-body {
    overflow: auto;
}
.pane-body-small {
    flex: 0 0 auto;
    min-width: 0;
    min-height: 108px;
    max-height: 24vh;
    margin: 0;
    padding: 10px;
    overflow: auto;
    white-space: pre-wrap;
    font: 13px/1.45 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
.repl-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    padding: 10px;
    border-top: 1px solid #dbe4ee;
}
.repl-form input {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 9px;
    color: var(--ink);
    font: 13px/1.45 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
.repl-form input:disabled {
    background: #eef3f8;
    color: #7b8796;
}
.snapshot {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    border: 0;
    padding: 10px;
    resize: none;
    outline: 0;
    color: var(--ink);
    font: 12px/1.42 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
.snapshot-url {
    flex: 0 0 86px;
    min-width: 0;
    border: 0;
    border-top: 1px solid #dbe4ee;
    padding: 10px;
    resize: none;
    outline: 0;
    color: var(--ink);
    background: #f8fafc;
    font: 12px/1.42 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
@media (max-width: 1120px) {
    .serialization-app {
        overflow: auto;
        height: auto;
        min-height: 100%;
    }
    .topbar {
        flex-direction: column;
    }
    .toolbar {
        justify-content: flex-start;
    }
    .workspace {
        grid-template-columns: minmax(0, 1fr);
        grid-auto-rows: minmax(320px, 58vh);
    }
}
@media (max-width: 640px) {
    .serialization-app {
        padding: 12px;
    }
    .title-group {
        flex-direction: column;
        gap: 6px;
    }
    .toolbar {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        width: 100%;
    }
}
</style>
