<template>
    <div
        class="app"
        :class="{ running: state !== 'idle', 'debug-collapsed': debugPaneCollapsed }"
        :data-mobile-top="mobileTopTab"
        :data-mobile-bottom="mobileBottomTab"
    >
        <div class="mobile-tab-bar mobile-tab-bar-top">
            <div class="mobile-tab-buttons">
                <button
                    type="button"
                    :class="{ active: mobileTopTab === 'code' }"
                    @click="mobileTopTab = 'code'"
                >Code</button>
                <button
                    type="button"
                    :class="{ active: mobileTopTab === 'debug' }"
                    :disabled="state === 'idle'"
                    @click="mobileTopTab = 'debug'"
                >Debug</button>
            </div>
        </div>
        <div v-show="state !== 'idle'" class="area-debug pane">
            <div class="pane-title debug-pane-title">
                <span class="debug-pane-heading">Debug</span>
                <button
                    type="button"
                    class="debug-rail-button"
                    @click="debugPaneCollapsed = !debugPaneCollapsed"
                >
                    {{ debugPaneCollapsed ? 'Expand' : 'Collapse' }}
                </button>
            </div>
            <div v-show="!debugPaneCollapsed" class="pane-content">
                <debugger :refreshKey="refreshKey" :stack-container="stackContainer" :debug-info="debugInfo" />
            </div>
        </div>
        <div class="area-code pane">
            <div class="pane-title code-pane-title">
                <div class="code-title-group">
                    <span>Code</span>
                    <button
                        v-if="state !== 'idle'"
                        type="button"
                        class="debug-rail-toggle"
                        :aria-pressed="!debugPaneCollapsed"
                        @click="debugPaneCollapsed = !debugPaneCollapsed"
                    >
                        {{ debugPaneCollapsed ? 'Show scopes' : 'Hide scopes' }}
                    </button>
                </div>
                <div class="code-toolbar">
                    <label class="snippet-label">
                        Snippet
                        <select
                            v-model="selectedSnippetId"
                            class="snippet-select"
                            :disabled="state !== 'idle'"
                            title="Load a starter program (only while idle)"
                            @change="applySnippet"
                        >
                            <option
                                v-for="s in snippetList"
                                :key="s.id"
                                :value="s.id"
                            >
                                {{ s.label }}
                            </option>
                        </select>
                    </label>
                    <div class="execution-controls">
                        <button v-if="state === 'idle'" class="run-button" @click="run">Run</button>
                        <button v-if="state === 'idle'" class="run-button" @click="runAndPause">Run and pause</button>
                        <button v-if="state === 'paused'" class="run-button" @click="resume">Resume</button>
                        <button v-if="state === 'paused'" class="run-button" @click="stepExecution(false)">Step</button>
                        <button v-if="state === 'paused'" class="run-button" @click="stepExecution(true)">Step in</button>
                        <button v-if="state === 'paused'" class="run-button" @click="stop">Kill</button>
                        <button v-if="state === 'play'" class="run-button" @click="pause">Pause</button>
                        <button v-if="state === 'play'" class="run-button" @click="stop">Kill</button>
                    </div>
                </div>
            </div>
            <monaco
                class="pane-content"
                v-model="text"
                :readonly="state !== 'idle'"
                :highlights="highlights"
                :breakpoints="breakpointLines"
                @toggle-breakpoint="toggleBreakpoint"
            ></monaco>
        </div>
        <div class="mobile-tab-bar mobile-tab-bar-bottom">
            <button
                type="button"
                :class="{ active: mobileBottomTab === 'game' }"
                @click="mobileBottomTab = 'game'"
            >Game</button>
            <button
                type="button"
                :class="{ active: mobileBottomTab === 'output' }"
                @click="mobileBottomTab = 'output'"
            >Output</button>
        </div>
        <div class="area-game pane">
            <div class="pane-title game-pane-title">
                <span>Game</span>
                <div
                    class="game-pane-controls"
                    :class="{ 'mobile-options-open': mobileGameOptionsOpen }"
                >
                    <div class="game-view-toggle" role="group" aria-label="Game view">
                        <button
                            type="button"
                            :class="{ active: gameViewMode === 'follow3d' }"
                            @click="gameViewMode = 'follow3d'"
                        >
                            3D
                        </button>
                        <button
                            type="button"
                            :class="{ active: gameViewMode === 'map2d' }"
                            @click="gameViewMode = 'map2d'"
                        >
                            Map
                        </button>
                    </div>
                    <label class="game-speed-label">
                        Speed
                        <select
                            v-model.number="gameSpeedMultiplier"
                            class="game-speed-select"
                            title="Wall-clock advance speed (world + VM pacing)"
                        >
                            <option :value="0.25">0.25×</option>
                            <option :value="0.5">0.5×</option>
                            <option :value="1">1×</option>
                            <option :value="2">2×</option>
                            <option :value="4">4×</option>
                            <option :value="8">8×</option>
                            <option :value="16">16×</option>
                        </select>
                    </label>
                    <button
                        type="button"
                        class="game-options-toggle"
                        :aria-label="mobileGameOptionsOpen ? 'Hide game options' : 'Show game options'"
                        :aria-expanded="mobileGameOptionsOpen ? 'true' : 'false'"
                        @click="mobileGameOptionsOpen = !mobileGameOptionsOpen"
                    >
                        {{ mobileGameOptionsOpen ? 'Hide' : 'Options' }}
                    </button>
                    <label class="game-stage-label game-advanced-control">
                        Stage
                        <select
                            v-model="stageMode"
                            class="game-stage-select"
                            :disabled="state !== 'idle'"
                        >
                            <option value="default">Default</option>
                            <option value="random">Random</option>
                            <option value="hardRandom">Hard random</option>
                        </select>
                    </label>
                    <label class="game-hitbox-label game-advanced-control">
                        <input
                            v-model="showHitboxes"
                            type="checkbox"
                        >
                        Show hitboxes
                    </label>
                    <label class="game-continuous-label game-advanced-control">
                        <input
                            v-model="continuousRun"
                            type="checkbox"
                        >
                        Continuous
                    </label>
                    <span
                        class="game-avg-ticks game-advanced-control"
                        title="Mean world ticks over completed runs (win or program finished). Kill does not count."
                    >
                        Avg {{ avgTicksLabel }}
                        <span class="game-run-count">({{ scoreHistory.length }} runs)</span>
                    </span>
                    <button
                        type="button"
                        class="game-clear-avg game-advanced-control"
                        :disabled="scoreHistory.length === 0"
                        @click="clearRunAverage"
                    >
                        Clear avg
                    </button>
                </div>
            </div>
            <div class="game-pane">
                <game-canvas :sim="sim" :view-mode="gameViewMode" :show-hitboxes="showHitboxes" />
            </div>
        </div>
        <div class="area-output pane">
            <div ref="result" class="result-pane">
                <div class="output-header">Output</div>
                <pre class="result">{{ result }}</pre>
            </div>
            <input
                v-if="state === 'paused'"
                class="pane-footer repl"
                v-model="replText"
                @keydown.enter="runRepl"
                type="text"
                placeholder="Code here..."
            >
        </div>
    </div>
</template>

<script lang="ts">
import { compile, getExecution, run } from '../src'
import Vue from 'vue'
import Monaco from './components/monaco.vue'
import Debugger from './components/debugger.vue'
import GameCanvas from './components/game-canvas.vue'
import { FrameType, Result, Stack } from '../src/runtime'
import { Fields } from '../src/runtime'
import { DebugInfo } from '../src/compiler'
import { createSimulationSession, Sim, SimulationRunner, StageMode, TICKS_PER_SECOND } from './game/sim'
import { CODE_SNIPPETS, CodeSnippet } from './game/code-snippets'
import { createTickWaiter } from './game/tick-waiter'

function emptyDebugInfo(): DebugInfo {
    return {
        sourceMap: [],
        internals: [],
        scopeDebugMap: new Map(),
        codeLength: 0
    }
}
import { resetVmMathRandom } from './vm-deterministic-math'
import { createVmHostRedirects, ensureHostPolyfillsCompiled, hostPolyfillProgramSet } from './vm-host-redirects'

ensureHostPolyfillsCompiled(compile)

type State = 'play' | 'paused' | 'idle'

function withNonReactive<TData>(data: TData) {
    return <TNonReactive>() => data as TData & TNonReactive;
}

function makeGlobalThis() {
    const names = [
        'Infinity',
        'NaN',
        'undefined',
        'Math',
        
        'isFinite',
        'isNaN',
        'parseFloat',
        'parseInt',
        'decodeURI',
        'decodeURIComponent',
        'encodeURI',
        'encodeURIComponent',
        'Array',
        'ArrayBuffer',
        'Boolean',
        'DataView',
        'Date', 
        'Error',
        'EvalError',
        'Float32Array',
        'Float64Array',
        'Function',


        'Int8Array',
        'Int16Array',
        'Int32Array',

        'Map',
        'Number',
        'Object',
        'Promise',
        'Proxy',
        'RangeError',
        'ReferenceError',
        'RegExp',
        'Set',
        'SharedArrayBuffer',
        'String',
        'Symbol',
        'SyntaxError',
        'TypeError',

        'Uint8Array',
        'Uint8ClampedArray',
        'Uint16Array',
        'Uint32Array',

        'URIError',
        'WeakMap',
        'WeakSet',
    
        'Atomics',
        'JSON',
        'Reflect',
    
        'escape',
        'unescape',
    
        'Intl',

        'eval'
    ]

    const obj: any = {}

    for (let name of names) {
        if (Reflect.has(globalThis, name)) {
            obj[name] = (globalThis as any)[name]
        }
    }

    Reflect.defineProperty(obj, 'globalThis', {
        enumerable: true,
        configurable: false,
        value: obj
    })

    return obj
}

const fakeGlobalThis = makeGlobalThis()

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

export default Vue.extend({
    components: {
        Monaco,
        Debugger,
        GameCanvas,
    },
    data() {
        return withNonReactive({
            text: CODE_SNIPPETS[0].code,
            selectedSnippetId: CODE_SNIPPETS[0].id,
            result: '',
            replText: '',
            stackContainer: {
                stack: [] as Stack
            },
            state: 'idle' as State,
            refreshKey: Math.random(),
            debugInfo: emptyDebugInfo(),
            highlights: <[number, number, number, number][]>[],
            breakpointLines: [] as number[],
            sim: null as Sim | null,
            simRunner: null as SimulationRunner | null,
            /** Coalesce Monaco/debug updates to one paint per frame (avoids freezing at high tick rates). */
            highlightRafId: 0,
            /** >1 shortens wait between sim/VM steps (wall-clock); scales runExecution waitTick delays. */
            gameSpeedMultiplier: 1,
            /** Stage preset for the current run. */
            stageMode: 'default' as StageMode,
            /** Chain Run → new sim + VM until unchecked or Kill. */
            continuousRun: false,
            /** Ticks at end of each completed run (not counted on Kill). */
            scoreHistory: [] as number[],
            execution: null as ReturnType<typeof getExecution> | null,
            program: [] as number[],
            /** Last `createVmHostRedirects` map (Math.random + forEach); used by REPL `run`. */
            vmHostRedirects: null as WeakMap<Function, Function> | null,
            debugPaneCollapsed: false,
            gameViewMode: 'follow3d' as 'follow3d' | 'map2d',
            showHitboxes: false,
            mobileTopTab: 'code' as 'code' | 'debug',
            mobileBottomTab: 'game' as 'game' | 'output',
            mobileGameOptionsOpen: false,
        })()
    },
    computed: {
        snippetList(): CodeSnippet[] {
            return CODE_SNIPPETS
        },
        avgTicksLabel(): string {
            const h = this.scoreHistory
            if (h.length === 0) return '—'
            const sum = h.reduce((a, b) => a + b, 0)
            return (sum / h.length).toFixed(1)
        },
    },
    watch: {
        state (val: State) {
            if (val === 'idle' && this.mobileTopTab === 'debug') {
                this.mobileTopTab = 'code'
            }
            if (val === 'idle') {
                this.debugPaneCollapsed = false
            }
        },
        mobileTopTab (val: 'code' | 'debug') {
            if (val === 'debug') {
                this.debugPaneCollapsed = false
            }
        },
        mobileBottomTab (val: 'game' | 'output') {
            if (val !== 'game') {
                this.mobileGameOptionsOpen = false
            }
        },
        async result () {
            const container = this.$refs.result as HTMLDivElement
            await this.$nextTick()
            if (container.scrollHeight - container.offsetHeight > container.scrollTop) {
                container.scrollTop = container.scrollHeight - container.offsetHeight
            }
        }
    },
    methods: {
        applySnippet() {
            const s = CODE_SNIPPETS.find(x => x.id === this.selectedSnippetId)
            if (s) this.text = s.code
        },
        printError(err: any) {
            this.result += String(err) + '\n'
            if (err != null && typeof err === 'object') {
                if ('stack' in err) {
                    this.result += err.stack + '\n'
                }
            }
        },
        /** `Fields.ptr` indexes the active frame's `programSection`; user code and host polyfills use different program buffers and source maps. */
        getSourceMapAtPtr(execution: ReturnType<typeof getExecution> | null): [number, number, number, number] | undefined {
            if (!execution) {
                return undefined
            }
            const stack = execution[Fields.stack]
            if (!stack.length) {
                return undefined
            }
            const top = stack[stack.length - 1]
            const prog = top[Fields.programSection]
            const ptr = execution[Fields.ptr]
            if (prog === this.program) {
                return this.debugInfo.sourceMap[ptr]
            }
            if (hostPolyfillProgramSet.has(prog)) {
                return undefined
            }
            return undefined
        },
        getInternalsAtPtr(execution: ReturnType<typeof getExecution> | null): boolean {
            if (!execution) {
                return false
            }
            const stack = execution[Fields.stack]
            if (!stack.length) {
                return false
            }
            const top = stack[stack.length - 1]
            const prog = top[Fields.programSection]
            const ptr = execution[Fields.ptr]
            if (prog === this.program) {
                return !!this.debugInfo.internals[ptr]
            }
            if (hostPolyfillProgramSet.has(prog)) {
                return true
            }
            return false
        },
        toggleBreakpoint(lineNumber: number) {
            const points = new Set(this.breakpointLines)
            if (points.has(lineNumber)) {
                points.delete(lineNumber)
            } else {
                points.add(lineNumber)
            }
            this.breakpointLines = [...points].sort((a, b) => a - b)
        },
        posHasBreakpoint(pos: [number, number, number, number] | undefined): boolean {
            if (!pos) {
                return false
            }
            const startLine = pos[0] + 1
            const endLine = pos[2] + 1
            return this.breakpointLines.some((line) => line >= startLine && line <= endLine)
        },
        getBreakpointLinesInPos(pos: [number, number, number, number] | undefined): number[] {
            if (!pos) {
                return []
            }
            const startLine = pos[0] + 1
            const endLine = pos[2] + 1
            return this.breakpointLines.filter((line) => line >= startLine && line <= endLine)
        },
        cancelDebugHighlightRaf() {
            if (this.highlightRafId) {
                cancelAnimationFrame(this.highlightRafId)
                this.highlightRafId = 0
            }
        },
        releaseVmExecution() {
            this.cancelDebugHighlightRaf()
            this.execution = null
            this.program = []
            this.debugInfo = emptyDebugInfo()
            this.vmHostRedirects = null
            this.stackContainer = { stack: [] as Stack }
            this.highlights = []
        },
        releaseVmResources() {
            this.releaseVmExecution()
            this.sim = null
            this.simRunner = null
        },
        /** At most one Monaco highlight + debugger refresh per animation frame. */
        scheduleDebugHighlight() {
            if (this.highlightRafId) return
            this.highlightRafId = requestAnimationFrame(() => {
                this.highlightRafId = 0
                const execution = this.execution
                if (!execution || this.state === 'idle') return
                const pos = this.getSourceMapAtPtr(execution)
                if (pos) {
                    const [r1, c1, r2, c2] = pos
                    this.highlights = [[r1 + 1, c1 + 1, r2 + 1, c2 + 1]]
                }
                this.refreshKey = Math.random()
                const s = execution[Fields.stack]
                this.stackContainer = { get stack () { return s } }
            })
        },
        flushDebugHighlightSync() {
            this.cancelDebugHighlightRaf()
            const execution = this.execution
            if (!execution) return
            const pos = this.getSourceMapAtPtr(execution)
            if (pos) {
                const [r1, c1, r2, c2] = pos
                this.highlights = [[r1 + 1, c1 + 1, r2 + 1, c2 + 1]]
            }
            this.refreshKey = Math.random()
            const s = execution[Fields.stack]
            this.stackContainer = { get stack () { return s } }
        },
        stepExecution(stepIn = false) {
            const execution = this.execution
            if (!execution) return

            let stack = execution[Fields.stack]
            this.stackContainer = {
                get stack () {
                    return stack
                }
            }

            let result: Result

            try {
                const sim = this.sim
                const runner = this.simRunner
                if (!sim || !runner) return

                const drainVmBarrier = () => {
                    let barrierTicks = 0
                    while (sim.vmBarrierBlocksExecution()) {
                        runner.stepOneTick()
                        barrierTicks++
                        if (sim.view.won) {
                            this.state = 'idle'
                            return
                        }
                        if (barrierTicks > 200000) {
                            break
                        }
                    }
                }

                if (sim.vmBarrierBlocksExecution()) {
                    drainVmBarrier()
                    if (this.state === 'idle') {
                        this.cancelDebugHighlightRaf()
                        this.highlights = []
                        return
                    }
                    if (sim.vmBarrierBlocksExecution()) {
                        this.flushDebugHighlightSync()
                        return
                    }
                }

                const getPos = () => {
                    return this.getSourceMapAtPtr(execution)
                }

                const originalPos = getPos()
                const getCurrentStackLength = () => execution[Fields.stack].filter(it => it[Fields.type] === FrameType.Function).length
                let maxStack = getCurrentStackLength()
                let skipping = false
                let firstIgnored = false

                do {
                    result = execution[Fields.step](true)

                    if (sim.vmBarrierBlocksExecution()) {
                        drainVmBarrier()
                        if (this.state === 'idle') {
                            break
                        }
                        if (sim.vmBarrierBlocksExecution()) {
                            this.flushDebugHighlightSync()
                            return
                        }
                    }

                    if (!skipping) {
                        skipping = stepIn ? false : getCurrentStackLength() > maxStack
                    } else /** if (skipping) */ {
                        if (!firstIgnored && getCurrentStackLength() <= maxStack) {
                            firstIgnored = true
                        } else if (firstIgnored) {
                            firstIgnored = false
                            skipping = false
                        }
                    }

                    maxStack = Math.min(maxStack, getCurrentStackLength())
                } while (
                    (
                        sameSourceMapPos(getPos(), originalPos) ||
                        this.getInternalsAtPtr(execution) ||
                        skipping
                    )
                    && !result[Fields.done]
                )

                if (!result[Fields.done]) {
                    this.scheduleDebugHighlight()
                }
                if (result[Fields.done] || sim.view.won) {
                    this.state = 'idle'
                }
                if (this.state === 'idle') {
                    this.cancelDebugHighlightRaf()
                    this.highlights = []
                }

            } catch (err) {
                this.printError(err)
                this.state = 'idle'
                this.cancelDebugHighlightRaf()
                this.highlights = []
            }
        },
        async runExecution() {
            const resumedFromPause = this.state === 'paused'
            this.state = 'play'
            const execution = this.execution
            const sim = this.sim
            const runner = this.simRunner
            if (!sim || !runner || !execution) {
                this.state = 'idle'
                return
            }

            let stack = execution[Fields.stack]
            this.stackContainer = {
                get stack () {
                    return stack
                }
            }

            let result: Result = { [Fields.done]: false } as any

            const getPos = () => {
                return this.getSourceMapAtPtr(execution)
            }

            let prevPos = getPos()
            const ignoredBreakpointLines = new Set(
                resumedFromPause ? this.getBreakpointLinesInPos(prevPos) : []
            )
            const TICK_MS = 1000 / TICKS_PER_SECOND
            // Browsers clamp setTimeout to ~4ms; below that, batch multiple sim ticks per wake.
            const MIN_TIMER_MS = 4
            const ticksPerTimer = TICK_MS >= MIN_TIMER_MS
                ? 1
                : Math.max(1, Math.ceil(MIN_TIMER_MS / TICK_MS))
            const waitDurationMs = TICK_MS >= MIN_TIMER_MS
                ? TICK_MS
                : Math.max(MIN_TIMER_MS, ticksPerTimer * TICK_MS)

            const scaledWaitMs = () => {
                const s = Math.max(0.1, Math.min(128, this.gameSpeedMultiplier))
                return waitDurationMs / s
            }
            // Browsers clamp very short native timers, so sub-threshold waits accumulate first.
            // We only force a real timeout as an escape hatch after too many immediate wakes.
            const waitTick = createTickWaiter({
                scaledWaitMs,
                minRealTimeoutMs: MIN_TIMER_MS,
                forcedTimeoutMs: 0,
            })

            try {
                while (<State>this.state === 'play') {
                    if (result[Fields.done]) break

                    await waitTick()
                    if (result[Fields.done]) break

                    // One timer wake may advance several sim ticks when TICK_MS < MIN_TIMER_MS.
                    // After each world tick, run VM until debug line changes, read barrier, or guard.
                    let wonThisBatch = false
                    let highlightChangedBatch = false
                    for (let t = 0; t < ticksPerTimer; t++) {
                        runner.stepOneTick()
                        if (sim.view.won) {
                            wonThisBatch = true
                            break
                        }

                        let highlightChanged = false
                        let guardSteps = 0
                        while (
                            <State>this.state === 'play'
                            && !result[Fields.done]
                            && !highlightChanged
                            && !sim.vmBarrierBlocksExecution()
                        ) {
                            result = execution[Fields.step]()
                            if (sim.vmBarrierBlocksExecution()) {
                                break
                            }
                            guardSteps++
                            const pos = getPos()
                            if (!sameSourceMapPos(pos, prevPos) && !this.getInternalsAtPtr(execution)) {
                                const breakpointLinesInPos = this.getBreakpointLinesInPos(pos)
                                if (
                                    ignoredBreakpointLines.size > 0
                                    && !breakpointLinesInPos.some(line => ignoredBreakpointLines.has(line))
                                ) {
                                    ignoredBreakpointLines.clear()
                                }
                                prevPos = pos
                                if (breakpointLinesInPos.some(line => !ignoredBreakpointLines.has(line))) {
                                    highlightChanged = true
                                    this.pause()
                                    break
                                }
                                highlightChanged = true
                                highlightChangedBatch = true
                                this.scheduleDebugHighlight()
                            }
                            if (guardSteps > 200000) break
                        }
                        if (<State>this.state === 'paused') {
                            break
                        }
                    }
                    if (wonThisBatch) {
                        this.state = 'idle'
                        break
                    }

                    if (highlightChangedBatch) await waitTick()
                }

                if (<State>this.state === 'paused') {
                    this.flushDebugHighlightSync()
                }

                if (result[Fields.done] || sim.view.won) {
                    this.state = 'idle'
                    this.scoreHistory.push(sim.view.tick)
                }
                if (<State>this.state === 'idle') {
                    this.releaseVmExecution()
                }

            } catch (err) {
                this.printError(err)
                this.state = 'idle'
                this.releaseVmExecution()
            }
        },
        setupExecution(): boolean {
            resetVmMathRandom()
            const clear = () => { this.result = '' }
            const print = (val: any) => {
                this.result += JSON.stringify(val, undefined, 2) + '\n'
            }

            const { sim, runner } = createSimulationSession({ stageMode: this.stageMode })
            this.sim = sim
            this.simRunner = runner

            const rotate = (deg: number) => {
                const n = Number(deg) || 0
                if (n === 0) {
                    return
                }
                sim.beginRotateRadians((n * Math.PI) / 180)
            }
            const move = (dist: number) => {
                const n = Number(dist) || 0
                if (n === 0) {
                    return 0
                }
                sim.beginMove(n)
                return 0
            }
            const shoot = () => {
                sim.beginShoot()
            }
            const waitForScan = (rays: number) => {
                sim.armScanBarrier(Number(rays) || 36)
            }
            const getScanResult = (cb: (res: { distance: number, type: string }[][]) => void) => {
                sim.deliverScanResult(cb)
            }
            const waitForLastMoveDrain = () => {
                sim.armLastMoveDistanceBarrier()
            }
            const getLastMoveDistanceResult = (cb: (d: number) => void) => {
                sim.deliverLastMoveDistanceResult(cb)
            }
            const won = () => sim.view.won

            let programData: number[], debugInfo: DebugInfo
            try {
                [programData, debugInfo] = compile(this.text, { range: true })
            } catch (err) {
                this.printError(err)
                return false
            }

            this.debugInfo = debugInfo
            this.program = programData
            const hostRedirects = createVmHostRedirects(compile, () => () => this.pause(), fakeGlobalThis)
            this.vmHostRedirects = hostRedirects.redirects

            const [scanPolyProgram] = compile(`function vmScanPoly(rays) {
  waitForScan(rays)
  let result
  getScanResult((res) => { result = res })
  return result
}
vmScanPoly`, { evalMode: true })
            hostPolyfillProgramSet.add(scanPolyProgram)
            const scan = run(
                scanPolyProgram,
                0,
                fakeGlobalThis,
                [{ waitForScan, getScanResult, __proto__: null }],
                undefined,
                [],
                compile,
                hostRedirects.redirects,
                () => () => this.pause()
            )

            const [lastMovePolyProgram] = compile(`function vmLastMovePoly() {
  waitForLastMoveDrain()
  let result
  getLastMoveDistanceResult((res) => { result = res })
  return result
}
vmLastMovePoly`, { evalMode: true })
            hostPolyfillProgramSet.add(lastMovePolyProgram)
            const lastMoveDistance = run(
                lastMovePolyProgram,
                0,
                fakeGlobalThis,
                [{ waitForLastMoveDrain, getLastMoveDistanceResult, __proto__: null }],
                undefined,
                [],
                compile,
                hostRedirects.redirects,
                () => () => this.pause()
            )

            this.execution = getExecution(
                programData,
                0,
                fakeGlobalThis,
                [{ print, clear, rotate, move, lastMoveDistance, shoot, scan, won, __proto__: null }],
                undefined,
                [],
                () => () => this.pause(),
                compile,
                hostRedirects.redirects
            )
            return true
        },
        async chainContinuousRuns() {
            while (this.continuousRun && this.state === 'idle') {
                if (!this.setupExecution()) break
                await this.runExecution()
            }
        },
        async run() {
            if (!this.setupExecution()) return
            await this.runExecution()
            await this.chainContinuousRuns()
        },
        clearRunAverage() {
            this.scoreHistory = []
        },
        runAndPause() {
            if (!this.setupExecution()) return
            this.pause()
        },
        pause() {
            this.state = 'paused'
            this.flushDebugHighlightSync()
        },
        async resume() {
            await this.runExecution()
            await this.chainContinuousRuns()
        },
        stop() {
            this.continuousRun = false
            this.state = 'idle'
            this.releaseVmExecution()
        },
        runRepl() {
            const text = this.replText
            this.replText = ''

            let programData: number[]

            this.result += '> ' + text + '\n'

            try {
                [programData] = compile(text, { evalMode: true })
            } catch (err) {
                this.printError(err)
                return
            }

            try {
                const ex = this.execution
                if (!ex) {
                    this.result += '(no VM)\n'
                    return
                }
                const redirects = this.vmHostRedirects ?? new WeakMap<Function, Function>()
                const result = run(
                    programData,
                    0,
                    fakeGlobalThis,
                    [...ex[Fields.scopes]],
                    undefined,
                    [],
                    compile,
                    redirects,
                    () => () => this.pause()
                )
                this.result += result + '\n'
            } catch (err) {
                this.printError(err)
            }
        }
    },
    beforeDestroy() {
        this.releaseVmResources()
    },
})
</script>

<style>
html {
    --ui-font-family: "Aptos", "Segoe UI Variable", "Segoe UI", "SF Pro Text", "SF Pro Display", "Helvetica Neue", "Noto Sans", "Liberation Sans", sans-serif;
}

body,
html {
    background: black;
    margin: 0;
    padding: 0;
    overflow-x: hidden;
    max-width: 100%;
}

body {
    color: #eee;
    font-family: var(--ui-font-family);
    text-rendering: optimizeLegibility;
}
pre {
    margin: 0;
}
</style>
<style scoped>
.app {
    --debug-width: 0px;
    height: 100vh;
    height: 100dvh;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    display: grid;
    grid-template-areas:
        "code game"
        "code output";
    grid-template-columns: minmax(0, 1fr) clamp(420px, 32vw, 620px);
    grid-template-rows: minmax(300px, 1.45fr) minmax(160px, 0.72fr);
    background: #000;
}
.app.running {
    --debug-width: 340px;
    grid-template-areas:
        "debug code game"
        "debug code output";
    grid-template-columns: var(--debug-width) minmax(0, 1fr) clamp(420px, 32vw, 620px);
}
.app.running.debug-collapsed {
    --debug-width: 64px;
}
.area-debug {
    grid-area: debug;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid rgba(127, 127, 127, 0.5);
    background: rgba(3, 8, 12, 0.92);
}
.area-debug .pane-content {
    overflow-y: auto;
}
.area-code {
    grid-area: code;
    min-width: 0;
    min-height: 0;
}
.area-game {
    grid-area: game;
    min-width: 0;
    min-height: 0;
    border-bottom: 1px solid rgba(127, 127, 127, 0.5);
    background: #01060a;
}
.area-output {
    grid-area: output;
    min-width: 0;
    min-height: 0;
    background: #030507;
}
.mobile-tab-bar {
    display: none;
}
.mobile-tab-buttons {
    display: contents;
}
.pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
.pane-title {
    padding: 0.9em 1em;
    flex: 0 0 auto;
    border-bottom: 1px solid rgba(127, 127, 127, 0.5);
}
.pane-content {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
.pane-footer {
    flex: 0 0 auto;
}
.debug-pane-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.78em;
    color: #d0edf8;
}
.debug-pane-heading {
    font-weight: 600;
}
.debug-rail-button,
.debug-rail-toggle,
.run-button,
.game-clear-avg,
.game-options-toggle,
.game-view-toggle button {
    border: 1px solid rgba(120, 180, 205, 0.28);
    background: linear-gradient(180deg, rgba(31, 46, 58, 0.98), rgba(15, 22, 29, 0.98));
    color: #f7fbff;
    border-radius: 999px;
    font: inherit;
    cursor: pointer;
}
.debug-rail-button,
.debug-rail-toggle,
.game-options-toggle,
.game-clear-avg {
    padding: 0.35em 0.75em;
}
.app.running.debug-collapsed .debug-pane-title {
    align-items: center;
    justify-content: flex-start;
    flex-direction: column;
    height: 100%;
    padding: 0.8em 0.4em;
}
.app.running.debug-collapsed .debug-pane-heading {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
}
.code-pane-title {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75em 1em;
    flex-wrap: wrap;
    min-width: 0;
}
.code-title-group {
    display: flex;
    align-items: center;
    gap: 0.75em;
    min-width: 0;
}
.code-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75em 1em;
    flex-wrap: wrap;
    flex: 1 1 26em;
    min-width: 0;
}
.snippet-label {
    display: flex;
    align-items: center;
    gap: 0.35em;
    font-size: 0.85em;
    color: #bbb;
}
.snippet-select,
.game-stage-select,
.game-speed-select {
    background: #333;
    color: #eee;
    border: 1px solid #555;
    padding: 0.25em 0.4em;
    border-radius: 999px;
}
.snippet-select,
.game-stage-select {
    min-width: 0;
}
.execution-controls {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.45em;
    flex-wrap: wrap;
}
.game-pane-title {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5em 0.75em;
    min-width: 0;
}
.game-pane-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.65em 1em;
    min-width: 0;
}
.game-view-toggle {
    display: inline-flex;
    align-items: center;
    border: 1px solid rgba(120, 180, 205, 0.28);
    border-radius: 999px;
    overflow: hidden;
    background: rgba(9, 16, 23, 0.9);
}
.game-view-toggle button {
    padding: 0.35em 0.8em;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #9ec7d9;
}
.game-view-toggle button.active {
    background: #67ebff;
    color: #05131b;
}
.game-stage-label,
.game-hitbox-label {
    display: flex;
    align-items: center;
    gap: 0.35em;
    font-size: 0.85em;
    color: #bbb;
}
.game-hitbox-label {
    cursor: pointer;
    user-select: none;
}
.game-hitbox-label input {
    cursor: pointer;
}
.game-speed-label {
    display: flex;
    align-items: center;
    gap: 0.35em;
    font-size: 0.85em;
    color: #bbb;
}
.game-continuous-label {
    display: flex;
    align-items: center;
    gap: 0.35em;
    font-size: 0.85em;
    color: #bbb;
    cursor: pointer;
    user-select: none;
}
.game-continuous-label input {
    cursor: pointer;
}
.game-avg-ticks {
    font-size: 0.85em;
    color: #9cf;
    white-space: nowrap;
}
.game-run-count {
    color: #888;
}
.game-clear-avg {
    font-size: 0.8em;
}
.game-options-toggle {
    display: none;
}
.game-clear-avg:disabled {
    opacity: 0.45;
    cursor: default;
}
.run-button {
    padding: 0.42em 0.82em;
    white-space: nowrap;
}
.output-header {
    flex-shrink: 0;
    padding: 0.4em 1em 0.35em;
    font-size: 0.85em;
    color: #888;
    border-bottom: 1px solid rgba(127, 127, 127, 0.35);
}
.result-pane {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
.game-pane {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    padding: 10px;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #02090d;
    overflow: hidden;
}
.result {
    flex-grow: 1;
    flex-basis: 0;
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: 0.75em 1em 1em;
    line-height: 1.5em;
    overflow: auto;
    overflow-x: auto;
}
.repl {
    flex-shrink: 0;
    min-width: 0;
    border: 0;
    padding: 1em;
    outline: 0;
    background: #333;
    color: white;
    box-sizing: border-box;
}
.repl::placeholder {
    color: #777;
}

@media (max-width: 1100px) {
    .app,
    .app.running {
        grid-template-areas:
            "tabtop"
            "top"
            "tabbot"
            "bottom";
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr) auto minmax(0, 1fr);
    }
    .app.running.debug-collapsed {
        --debug-width: 0px;
    }
    .mobile-tab-bar {
        display: flex;
        background: #1a1a1a;
        border-bottom: 1px solid rgba(127, 127, 127, 0.5);
    }
    .mobile-tab-buttons {
        display: flex;
        flex: 1 1 auto;
        min-width: 0;
    }
    .mobile-tab-bar-top {
        grid-area: tabtop;
        align-items: center;
        gap: 0.5em;
        padding-right: 0.55em;
    }
    .mobile-tab-bar-bottom {
        grid-area: tabbot;
        border-top: 1px solid rgba(127, 127, 127, 0.5);
    }
    .mobile-tab-buttons button,
    .mobile-tab-bar-bottom button {
        flex: 1 1 0;
        border: 0;
        background: transparent;
        color: #bbb;
        padding: 0.75em 1em;
        font: inherit;
        cursor: pointer;
        border-bottom: 2px solid transparent;
    }
    .mobile-tab-buttons button.active,
    .mobile-tab-bar-bottom button.active {
        color: #fff;
        border-bottom-color: #9cf;
    }
    .mobile-tab-buttons button:disabled,
    .mobile-tab-bar-bottom button:disabled {
        opacity: 0.4;
        cursor: default;
    }
    .area-debug,
    .area-code {
        grid-area: top;
        border-right: 0;
    }
    .area-game,
    .area-output {
        grid-area: bottom;
        border-bottom: 0;
    }
    .app[data-mobile-top="code"] .area-debug,
    .app[data-mobile-top="debug"] .area-code {
        display: none;
    }
    .app[data-mobile-bottom="game"] .area-output,
    .app[data-mobile-bottom="output"] .area-game {
        display: none;
    }
    .debug-rail-button,
    .debug-rail-toggle {
        display: none;
    }
    .pane-title {
        padding: 0.85em 0.9em;
    }
    .code-pane-title,
    .game-pane-title {
        flex-direction: column;
        align-items: stretch;
        gap: 0.75em;
    }
    .code-title-group,
    .code-toolbar,
    .game-pane-controls,
    .execution-controls {
        width: 100%;
    }
    .code-title-group {
        justify-content: space-between;
    }
    .code-toolbar,
    .game-pane-controls,
    .execution-controls {
        justify-content: flex-start;
    }
    .code-toolbar {
        flex: 0 0 auto;
        flex-direction: column;
        align-items: stretch;
        gap: 0.65em;
    }
    .snippet-label {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        width: 100%;
    }
    .snippet-select {
        width: 100%;
    }
    .execution-controls {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    }
    .run-button {
        width: 100%;
    }
    .game-pane-controls {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: center;
    }
    .game-stage-label,
    .game-speed-label {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
    }
    .game-stage-select,
    .game-speed-select {
        width: 100%;
    }
    .game-avg-ticks {
        white-space: normal;
        line-height: 1.35;
    }
    .game-clear-avg {
        justify-self: start;
    }
    .game-pane {
        padding: 8px;
    }
    .app.running.debug-collapsed .debug-pane-heading {
        writing-mode: initial;
        transform: none;
    }
}

@media (max-width: 640px) {
    .app,
    .app.running {
        height: 100dvh;
        max-height: 100dvh;
        min-height: 0;
        grid-template-rows: auto minmax(0, 0.85fr) auto minmax(0, 1.15fr);
        overflow: hidden;
    }
    .pane-title {
        padding: 0.6em 0.7em;
    }
    .code-pane-title,
    .game-pane-title {
        gap: 0.5em;
    }
    .game-pane-title > span {
        display: none;
    }
    .code-toolbar {
        gap: 0.45em;
    }
    .execution-controls {
        grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
        gap: 0.35em;
    }
    .run-button {
        padding-left: 0.55em;
        padding-right: 0.55em;
    }
    .game-pane-controls {
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 0.45em 0.6em;
    }
    .game-options-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 2.2em;
    }
    .game-advanced-control {
        display: none;
    }
    .game-pane-controls.mobile-options-open {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .game-pane-controls.mobile-options-open .game-view-toggle,
    .game-pane-controls.mobile-options-open .game-options-toggle {
        justify-self: start;
    }
    .game-pane-controls.mobile-options-open .game-stage-label,
    .game-pane-controls.mobile-options-open .game-hitbox-label,
    .game-pane-controls.mobile-options-open .game-continuous-label,
    .game-pane-controls.mobile-options-open .game-clear-avg {
        display: flex;
    }
    .game-pane-controls.mobile-options-open .game-stage-label {
        display: grid;
    }
    .game-pane-controls.mobile-options-open .game-avg-ticks {
        display: block;
    }
    .mobile-tab-buttons button,
    .mobile-tab-bar-bottom button {
        padding: 0.6em 0.75em;
    }
    .mobile-tab-bar-top {
        flex-wrap: nowrap;
        padding-right: 0.35em;
    }
}
</style>
