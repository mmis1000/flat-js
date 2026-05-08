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
                <button type="button" :disabled="state === 'running' || (state !== 'paused' && !snapshotText.trim())" @click="exportJson">Export JSON</button>
                <button type="button" :disabled="state === 'running'" @click="openJsonImport">Import JSON</button>
                <button type="button" :disabled="state === 'running' || !snapshotText.trim()" @click="load">Load</button>
                <button type="button" :disabled="state === 'running' || !snapshotUrl" @click="loadUrl">Load URL</button>
                <button type="button" :disabled="state === 'running'" @click="reset">Reset</button>
                <input
                    ref="jsonImport"
                    class="hidden-file-input"
                    type="file"
                    accept="application/json,.json"
                    @change="importJson"
                >
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

                <div class="pane-title history-pane-title">History</div>
                <div class="history-controls">
                    <input
                        v-model="checkpointLabel"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="Checkpoint label"
                        :disabled="state === 'running'"
                    >
                    <button type="button" :disabled="state !== 'paused'" @click="saveCheckpoint">Checkpoint</button>
                    <button type="button" :disabled="!selectedCheckpointId || state === 'running'" @click="loadSelectedCheckpoint">Load Checkpoint</button>
                    <button type="button" :disabled="!selectedCheckpointId || state === 'running'" @click="renameSelectedCheckpoint">Rename</button>
                    <button type="button" :disabled="!selectedCheckpointId || state === 'running'" @click="deleteSelectedCheckpoint">Delete Branch</button>
                </div>
                <select v-model="selectedCheckpointId" class="history-list" size="8" :disabled="historyCheckpointItems.length === 0" @change="syncCheckpointLabelFromSelection">
                    <option
                        v-for="checkpoint in historyCheckpointItems"
                        :key="checkpoint.id"
                        :value="checkpoint.id"
                    >
                        {{ `${'  '.repeat(checkpoint.depth)}${checkpoint.summary}${checkpoint.id === snapshotHistory?.headId ? ' • head' : ''}` }}
                    </option>
                </select>

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
    appendExecutionSnapshotCheckpoint,
    appendVmAsyncSessionSnapshotCheckpoint,
    createVmAsyncSession,
    createHostRegistry,
    createSerializableHostObjectRedirects,
    createSnapshotHistory,
    restoreExecution,
    restoreExecutionCheckpoint,
    restoreVmAsyncSession,
    restoreVmAsyncSessionCheckpoint,
    serializeExecutionSnapshot,
    serializeSnapshotHistory,
    serializeVmAsyncSessionSnapshot,
    snapshotExecution,
    snapshotVmAsyncSession,
    type SnapshotCheckpoint,
    type SnapshotHistory,
    type VmAsyncSession,
} from '../src/serialization'
import {
    getLogicalDebugFrames,
    getSelectedDebugFrameSourcePointers,
    resolveDebugFrameIndex,
} from '../web/debug-stack'
import {
    continueVmAsyncSession,
    deleteSnapshotCheckpointBranch,
    parsePlaygroundSnapshotDocument,
    relabelSnapshotCheckpoint,
    serializePlaygroundSnapshotDocument,
} from '../src/serialization-playground'

type VmStatus = 'idle' | 'running' | 'paused' | 'done' | 'error'

type VmExecution = ReturnType<typeof getExecution>

const defaultSource = `const events = []

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
const SNAPSHOT_FILE_QUERY_KEYS = ['snapshotFile', 'snapshot-file'] as const

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

function readSnapshotFilePathFromQuery() {
    const url = new URL(window.location.href)
    for (const key of SNAPSHOT_FILE_QUERY_KEYS) {
        const value = url.searchParams.get(key)
        if (value) {
            return value
        }
    }
    return ''
}

function resolveSnapshotFileUrl(pathText: string) {
    const resolved = new URL(pathText, window.location.href)
    if (resolved.origin !== window.location.origin) {
        throw new Error('Snapshot file must resolve to the current origin')
    }
    return resolved
}

async function fetchSnapshotTextFromRelativePath(pathText: string) {
    const response = await fetch(resolveSnapshotFileUrl(pathText).toString())
    if (!response.ok) {
        throw new Error(`Snapshot file request failed (${response.status} ${response.statusText})`)
    }
    return await response.text()
}

function shouldUseAsyncSession(source: string) {
    return /\basync\b|\bvmSleep\b/.test(source)
}

type HistoryCheckpointListItem = SnapshotCheckpoint & {
    depth: number
    summary: string
}

function createSnapshotUrl(text: string) {
    const url = new URL(window.location.href)
    url.hash = `snapshot=${encodeSnapshotForUrl(text)}`
    return url.toString()
}

function buildCheckpointChildrenMap(history: SnapshotHistory) {
    const children = new Map<string, SnapshotCheckpoint[]>()
    for (const checkpoint of history.checkpoints) {
        if (!checkpoint.parentId) continue
        const siblings = children.get(checkpoint.parentId)
        if (siblings) {
            siblings.push(checkpoint)
        } else {
            children.set(checkpoint.parentId, [checkpoint])
        }
    }
    return children
}

function buildHistoryCheckpointList(history: SnapshotHistory): HistoryCheckpointListItem[] {
    const byId = new Map(history.checkpoints.map(checkpoint => [checkpoint.id, checkpoint]))
    const children = buildCheckpointChildrenMap(history)
    const ordered: HistoryCheckpointListItem[] = []
    const visit = (checkpoint: SnapshotCheckpoint, depth: number) => {
        ordered.push({
            ...checkpoint,
            depth,
            summary: checkpoint.label ?? checkpoint.id,
        })
        for (const child of children.get(checkpoint.id) ?? []) {
            visit(child, depth + 1)
        }
    }
    for (const rootId of history.rootIds) {
        const root = byId.get(rootId)
        if (root) {
            visit(root, 0)
        }
    }
    return ordered
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
const functionRedirects = createSerializableHostObjectRedirects({ globalThis: vmGlobal })

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
            snapshotHistory: null as SnapshotHistory | null,
            historyRuntimeDirty: false,
            selectedCheckpointId: '',
            checkpointLabel: '',
            state: 'idle' as VmStatus,
            statusText: 'Idle',
            execution: null as VmExecution | null,
            asyncSession: null as VmAsyncSession | null,
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
        historyCheckpointItems(): HistoryCheckpointListItem[] {
            return this.snapshotHistory ? buildHistoryCheckpointList(this.snapshotHistory) : []
        },
        selectedHistoryCheckpoint(): HistoryCheckpointListItem | null {
            return this.historyCheckpointItems.find(checkpoint => checkpoint.id === this.selectedCheckpointId) ?? null
        },
    },
    mounted() {
        activeApp = this
        this.highlightRafId = 0
        this.refreshSnapshotUrl()
        void this.loadInitialSnapshotUrl().catch(error => {
            this.setError(error)
        })
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
        setSnapshotHistory(history: SnapshotHistory | null) {
            this.snapshotHistory = history
            this.historyRuntimeDirty = false
            if (!history || history.checkpoints.length === 0) {
                this.selectedCheckpointId = ''
                this.checkpointLabel = ''
                return
            }
            const nextSelectedId = history.checkpoints.some(checkpoint => checkpoint.id === this.selectedCheckpointId)
                ? this.selectedCheckpointId
                : history.headId ?? history.checkpoints[history.checkpoints.length - 1]?.id ?? ''
            this.selectedCheckpointId = nextSelectedId
            const selected = history.checkpoints.find(checkpoint => checkpoint.id === nextSelectedId)
            this.checkpointLabel = selected?.label ?? ''
        },
        syncCheckpointLabelFromSelection() {
            this.checkpointLabel = this.selectedHistoryCheckpoint?.label ?? ''
        },
        async loadInitialSnapshotUrl() {
            const snapshotText = readSnapshotTextFromHash()
            if (snapshotText) {
                this.loadSnapshotText(snapshotText, 'Snapshot URL loaded')
                return
            }
            const snapshotFilePath = readSnapshotFilePathFromQuery()
            if (!snapshotFilePath) {
                return
            }
            const snapshotFileUrl = resolveSnapshotFileUrl(snapshotFilePath)
            const loadedSnapshotText = await fetchSnapshotTextFromRelativePath(snapshotFilePath)
            this.loadSnapshotText(loadedSnapshotText, `Snapshot file loaded: ${snapshotFileUrl.pathname}`)
        },
        async onHashChange() {
            this.refreshSnapshotUrl()
            if (this.state === 'running') {
                return
            }
            try {
                await this.loadInitialSnapshotUrl()
            } catch (error) {
                this.setError(error)
            }
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
            this.asyncSession = null
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
        getDebugExecution(): VmExecution | null {
            return this.asyncSession?.debugExecution ?? this.execution
        },
        getSourceMapAtPtr(execution: VmExecution | null): [number, number, number, number] | undefined {
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
        getNextVisibleSourcePtr(execution: VmExecution): number | null {
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
        isExecutionAtVisibleUserCode(execution: VmExecution): boolean {
            const stack = execution[Fields.stack]
            if (stack.length === 0) {
                return false
            }
            const top = stack[stack.length - 1]
            return !!this.getSourceMapForProgramPtr(top[Fields.programSection], execution[Fields.ptr])
                && !this.isSourcePointerInternal(top[Fields.programSection], execution[Fields.ptr])
        },
        getSelectedSourceMapAtPtr(execution: VmExecution | null): [number, number, number, number] | undefined {
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
        getInternalsAtPtr(execution: VmExecution | null): boolean {
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
        updateDebugStackContainer(execution: VmExecution) {
            const stack = execution[Fields.stack]
            this.syncSelectedDebugFrame(stack)
            this.stackContainer = { get stack() { return stack } }
        },
        applyDebugHighlight(execution: VmExecution) {
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
                const execution = this.getDebugExecution()
                if (!execution) return
                this.updateDebugStackContainer(execution)
                this.applyDebugHighlight(execution)
                this.refreshKey = Math.random()
            })
        },
        flushDebugHighlightSync() {
            this.cancelDebugHighlightRaf()
            const execution = this.getDebugExecution()
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
            const execution = this.getDebugExecution()
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
            if (this.snapshotHistory) {
                this.historyRuntimeDirty = true
            }
            this.debugPausePtr = null
            this.state = 'running'
            this.statusText = 'Running'
            this.updateDebugStackContainer(this.getDebugExecution() ?? execution)

            try {
                const session = this.asyncSession
                let guard = 0
                while (this.state === 'running') {
                    if (session) {
                        const result = continueVmAsyncSession(session)
                        if (result.paused) {
                            return
                        }
                        if (result.mainDone && result.queuedJobs === 0 && result.pendingTimers === 0) {
                            this.state = 'done'
                            this.statusText = 'Done'
                            this.highlights = []
                            this.flushDebugHighlightSync()
                            break
                        }
                        if (result.pendingTimers > 0) {
                            session.advanceTime(1)
                        }
                        if (++guard > 20000) {
                            throw new Error('Async session guard exceeded')
                        }
                        continue
                    }

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
            if (this.asyncSession) {
                this.continueExecution()
                return
            }

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
            this.replText = ''
            this.replOutput = ''
            this.snapshotText = ''
            this.snapshotUrl = ''
            this.setSnapshotHistory(null)
            this.resetDebugState()
            this.state = 'running'
            this.statusText = 'Compiling'

            try {
                const [program, debugInfo] = compile(this.text, { range: true })
                this.program = markRaw(program)
                this.debugInfo = markRaw(debugInfo)
                const scope = { log: hostLog, input: hostInput, __proto__: null } as Record<string, unknown>
                if (shouldUseAsyncSession(this.text)) {
                    const session = markRaw(createVmAsyncSession(program, {
                        globalThis: Object.create(vmGlobal),
                        scopes: [scope],
                        compileFunction: compile,
                        functionRedirects,
                        onPause: ({ ptr }) => {
                            this.pause(typeof ptr === 'number' ? ptr : null)
                        },
                    }))
                    this.asyncSession = session
                    this.execution = markRaw(session.mainExecution)
                } else {
                    this.execution = markRaw(getExecution(
                        program,
                        0,
                        vmGlobal,
                        [scope],
                        undefined,
                        [],
                        () => this.getDebugPauseCallback(),
                        compile,
                        functionRedirects
                    ))
                }
                this.continueExecution()
            } catch (error) {
                this.setError(error)
            }
        },
        save() {
            try {
                this.snapshotText = this.createSnapshotText()
                const savedHistory = this.snapshotHistory && !this.historyRuntimeDirty
                this.statusText = savedHistory ? 'Snapshot history saved' : 'Snapshot saved'
            } catch (error) {
                this.setError(error)
            }
        },
        createSnapshotText() {
            if (this.snapshotHistory && !this.historyRuntimeDirty) {
                return serializeSnapshotHistory(this.snapshotHistory)
            }
            if (this.asyncSession && this.state === 'paused') {
                const snapshot = snapshotVmAsyncSession(this.asyncSession, { hostRegistry })
                return serializePlaygroundSnapshotDocument({
                    kind: 'vmAsyncSession',
                    snapshot,
                    ...(this.debugPausePtr == null ? {} : { debugPausePtr: this.debugPausePtr }),
                })
            }
            const execution = this.execution
            if (this.state === 'paused' && execution) {
                const snapshot = snapshotExecution(execution, { hostRegistry })
                return serializePlaygroundSnapshotDocument({
                    kind: 'execution',
                    snapshot,
                    ...(this.debugPausePtr == null ? {} : { debugPausePtr: this.debugPausePtr }),
                })
            }
            const text = this.snapshotText.trim()
            if (text) {
                return text
            }
            throw new Error('No paused execution, snapshot history, or snapshot text to serialize')
        },
        saveCheckpoint() {
            try {
                if (this.state !== 'paused') {
                    throw new Error('Pause execution before creating a checkpoint')
                }
                const trimmedLabel = this.checkpointLabel.trim()
                const parentId = this.selectedCheckpointId || this.snapshotHistory?.headId
                const checkpointOptions = {
                    ...(parentId ? { parentId } : {}),
                    ...(trimmedLabel ? { label: trimmedLabel } : {}),
                    ...(this.debugPausePtr == null ? {} : { debugPausePtr: this.debugPausePtr }),
                }
                const history = this.snapshotHistory ?? createSnapshotHistory()
                const updatedHistory = this.asyncSession
                    ? appendVmAsyncSessionSnapshotCheckpoint(history, this.asyncSession, { hostRegistry }, checkpointOptions)
                    : this.execution
                        ? appendExecutionSnapshotCheckpoint(history, this.execution, { hostRegistry }, checkpointOptions)
                        : null
                if (!updatedHistory) {
                    throw new Error('No paused execution available for checkpointing')
                }
                this.snapshotText = serializeSnapshotHistory(updatedHistory)
                this.setSnapshotHistory(updatedHistory)
                this.statusText = `Checkpoint saved: ${updatedHistory.headId}`
            } catch (error) {
                this.setError(error)
            }
        },
        saveUrl() {
            try {
                this.snapshotText = this.createSnapshotText()
                this.snapshotUrl = createSnapshotUrl(this.snapshotText)
                window.history.replaceState(null, '', this.snapshotUrl)
                const savedHistory = this.snapshotHistory && !this.historyRuntimeDirty
                this.statusText = savedHistory ? 'Snapshot history URL saved' : 'Snapshot URL saved'
            } catch (error) {
                this.setError(error)
            }
        },
        exportJson() {
            try {
                this.snapshotText = this.createSnapshotText()
                const blob = new Blob([this.snapshotText], { type: 'application/json' })
                const objectUrl = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                const savedHistory = this.snapshotHistory && !this.historyRuntimeDirty
                anchor.href = objectUrl
                anchor.download = savedHistory ? 'flat-js-snapshot-history.json' : 'flat-js-snapshot.json'
                anchor.click()
                URL.revokeObjectURL(objectUrl)
                this.statusText = savedHistory ? 'Snapshot history JSON exported' : 'Snapshot JSON exported'
            } catch (error) {
                this.setError(error)
            }
        },
        openJsonImport() {
            try {
                const input = this.$refs.jsonImport as HTMLInputElement | undefined
                if (!input) {
                    throw new Error('Import control unavailable')
                }
                input.value = ''
                input.click()
            } catch (error) {
                this.setError(error)
            }
        },
        async importJson(event: Event) {
            const input = event.target as HTMLInputElement | null
            const file = input?.files?.[0]
            if (!file) {
                return
            }
            try {
                const snapshotText = await file.text()
                this.loadSnapshotText(snapshotText, `Snapshot document imported: ${file.name}`)
            } catch (error) {
                this.setError(error)
            } finally {
                if (input) {
                    input.value = ''
                }
            }
        },
        loadSnapshotText(snapshotText: string, statusText = 'Snapshot loaded') {
            const document = parsePlaygroundSnapshotDocument(snapshotText)
            if (document.kind === 'history') {
                this.snapshotText = snapshotText
                this.setSnapshotHistory(document.history)
                if (!this.snapshotHistory?.headId) {
                    this.resetDebugState()
                    this.state = 'idle'
                    this.statusText = statusText
                    return
                }
                this.loadSelectedCheckpoint(statusText)
                return
            }
            this.setSnapshotHistory(null)
            if (document.kind === 'vmAsyncSession') {
                const snapshot = document.snapshot
                const [, debugInfo] = compile(snapshot.source, { range: true })
                const session = markRaw(restoreVmAsyncSession(snapshot, {
                    hostRegistry,
                    compileFunction: compile,
                    functionRedirects,
                    onPause: ({ ptr }) => {
                        this.pause(typeof ptr === 'number' ? ptr : null)
                    },
                }))
                this.snapshotText = snapshotText
                this.text = snapshot.source
                this.asyncSession = session
                this.execution = markRaw(session.mainExecution)
                this.program = markRaw(session.debugExecution[Fields.stack][0]?.[Fields.programSection] ?? [])
                this.debugInfo = markRaw(debugInfo)
                this.state = 'paused'
                this.statusText = statusText
                this.debugPausePtr = document.debugPausePtr ?? this.getNextVisibleSourcePtr(session.debugExecution)
                this.flushDebugHighlightSync()
                this.revealDebugHighlight()
                return
            }
            const snapshot = document.snapshot
            const [, debugInfo] = compile(snapshot.source, { range: true })
            const execution = restoreExecution(snapshot, {
                hostRegistry,
                compileFunction: compile,
                functionRedirects,
                getDebugFunction: () => this.getDebugPauseCallback(),
            })
            this.snapshotText = snapshotText
            this.text = snapshot.source
            this.asyncSession = null
            this.execution = markRaw(execution)
            this.program = markRaw(execution[Fields.stack][0]?.[Fields.programSection] ?? [])
            this.debugInfo = markRaw(debugInfo)
            this.state = 'paused'
            this.statusText = statusText
            this.debugPausePtr = document.debugPausePtr ?? this.getNextVisibleSourcePtr(execution)
            this.flushDebugHighlightSync()
            this.revealDebugHighlight()
        },
        loadSelectedCheckpoint(statusText = 'Snapshot checkpoint loaded') {
            try {
                const history = this.snapshotHistory
                const checkpointId = this.selectedCheckpointId
                if (!history || !checkpointId) {
                    throw new Error('No snapshot checkpoint selected')
                }
                const checkpoint = history.checkpoints.find(entry => entry.id === checkpointId)
                if (!checkpoint) {
                    throw new Error(`Unknown snapshot checkpoint '${checkpointId}'`)
                }
                const serializedHistory = serializeSnapshotHistory(history)
                if (checkpoint.kind === 'vmAsyncSession') {
                    const session = markRaw(restoreVmAsyncSessionCheckpoint(history, checkpointId, {
                        hostRegistry,
                        compileFunction: compile,
                        functionRedirects,
                        onPause: ({ ptr }) => {
                            this.pause(typeof ptr === 'number' ? ptr : null)
                        },
                    }))
                    const source = checkpoint.snapshot.source
                    const [, debugInfo] = compile(source, { range: true })
                    this.snapshotText = serializedHistory
                    this.text = source
                    this.asyncSession = session
                    this.execution = markRaw(session.mainExecution)
                    this.program = markRaw(session.debugExecution[Fields.stack][0]?.[Fields.programSection] ?? [])
                    this.debugInfo = markRaw(debugInfo)
                    this.state = 'paused'
                    this.statusText = statusText
                    this.historyRuntimeDirty = checkpointId !== history.headId
                    this.debugPausePtr = checkpoint.debugPausePtr ?? this.getNextVisibleSourcePtr(session.debugExecution)
                    this.flushDebugHighlightSync()
                    this.revealDebugHighlight()
                    this.syncCheckpointLabelFromSelection()
                    return
                }
                const execution = restoreExecutionCheckpoint(history, checkpointId, {
                    hostRegistry,
                    compileFunction: compile,
                    functionRedirects,
                    getDebugFunction: () => this.getDebugPauseCallback(),
                })
                const source = checkpoint.snapshot.source
                const [, debugInfo] = compile(source, { range: true })
                this.snapshotText = serializedHistory
                this.text = source
                this.asyncSession = null
                this.execution = markRaw(execution)
                this.program = markRaw(execution[Fields.stack][0]?.[Fields.programSection] ?? [])
                this.debugInfo = markRaw(debugInfo)
                this.state = 'paused'
                this.statusText = statusText
                this.historyRuntimeDirty = checkpointId !== history.headId
                this.debugPausePtr = checkpoint.debugPausePtr ?? this.getNextVisibleSourcePtr(execution)
                this.flushDebugHighlightSync()
                this.revealDebugHighlight()
                this.syncCheckpointLabelFromSelection()
            } catch (error) {
                this.setError(error)
            }
        },
        renameSelectedCheckpoint() {
            try {
                if (!this.snapshotHistory || !this.selectedCheckpointId) {
                    throw new Error('No snapshot checkpoint selected')
                }
                const updatedHistory = relabelSnapshotCheckpoint(this.snapshotHistory, this.selectedCheckpointId, this.checkpointLabel)
                this.snapshotText = serializeSnapshotHistory(updatedHistory)
                this.setSnapshotHistory(updatedHistory)
                this.statusText = `Checkpoint renamed: ${this.selectedCheckpointId}`
            } catch (error) {
                this.setError(error)
            }
        },
        deleteSelectedCheckpoint() {
            try {
                if (!this.snapshotHistory || !this.selectedCheckpointId) {
                    throw new Error('No snapshot checkpoint selected')
                }
                const deletedCheckpointId = this.selectedCheckpointId
                const updatedHistory = deleteSnapshotCheckpointBranch(this.snapshotHistory, deletedCheckpointId)
                this.snapshotText = updatedHistory.checkpoints.length > 0 ? serializeSnapshotHistory(updatedHistory) : ''
                this.setSnapshotHistory(updatedHistory.checkpoints.length > 0 ? updatedHistory : null)
                if (this.snapshotHistory?.headId) {
                    this.loadSelectedCheckpoint(`Checkpoint branch deleted: ${deletedCheckpointId}`)
                } else {
                    this.resetDebugState()
                    this.state = 'idle'
                    this.statusText = `Checkpoint branch deleted: ${deletedCheckpointId}`
                }
            } catch (error) {
                this.setError(error)
            }
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
            this.snapshotUrl = ''
            this.setSnapshotHistory(null)
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
            if (this.snapshotHistory) {
                this.historyRuntimeDirty = true
            }

            this.replOutput += `> ${text}\n`

            try {
                const execution = this.getDebugExecution()
                if (!execution) {
                    this.replOutput += '(no VM)\n'
                    return
                }
                const [programData] = compile(text, { evalMode: true })
                const replScopes = [...execution[Fields.scopes]]
                const frame = execution[Fields.stack][execution[Fields.stack].length - 1]
                const variableEnvironmentScope = frame?.[Fields.variableEnvironment] ?? null
                const replGlobal = frame?.[Fields.globalThis] ?? vmGlobal
                const cleanupMaterializedScopes = this.materializeReplScopes(replScopes)
                let result
                try {
                    result = run(
                        programData,
                        0,
                        replGlobal,
                        replScopes,
                        undefined,
                        [],
                        compile,
                        functionRedirects,
                        () => this.getDebugPauseCallback(),
                        variableEnvironmentScope,
                        undefined,
                        this.asyncSession
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
    min-height: 100dvh;
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
.hidden-file-input {
    display: none;
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
.history-pane-title {
    border-top: 1px solid #dbe4ee;
}
.history-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px;
    border-bottom: 1px solid #dbe4ee;
}
.history-controls input {
    flex: 1 1 180px;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 9px;
    color: var(--ink);
    font: 13px/1.45 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
.history-list {
    min-width: 0;
    min-height: 132px;
    max-height: 220px;
    border: 0;
    padding: 8px 10px;
    color: var(--ink);
    background: #fff;
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
        min-height: 100dvh;
        padding-bottom: calc(18px + env(safe-area-inset-bottom, 0px));
    }
    .topbar {
        flex-direction: column;
    }
    .toolbar {
        justify-content: flex-start;
    }
    .workspace {
        grid-template-columns: minmax(0, 1fr);
        grid-auto-rows: auto;
    }
    .code-pane,
    .debug-pane {
        min-height: min(420px, 58dvh);
    }
    .io-pane {
        min-height: 0;
    }
    .snapshot {
        min-height: 220px;
    }
}
@media (max-width: 640px) {
    .serialization-app {
        padding: 12px;
        padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    }
    .title-group {
        flex-direction: column;
        gap: 6px;
    }
    nav {
        flex-wrap: wrap;
        white-space: normal;
    }
    .toolbar {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        width: 100%;
    }
    button {
        min-height: 48px;
    }
    .pane-body-small {
        max-height: none;
        min-height: 120px;
    }
    .repl-form {
        grid-template-columns: minmax(0, 1fr);
    }
    .snapshot {
        min-height: 260px;
    }
    .snapshot-url {
        min-height: 96px;
    }
}
</style>
