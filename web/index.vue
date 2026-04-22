<template>
    <div
        class="app"
        :class="{ running: state !== 'idle' }"
        :data-mobile-top="mobileTopTab"
        :data-mobile-bottom="mobileBottomTab"
    >
        <div class="mobile-tab-bar mobile-tab-bar-top">
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
        <div v-show="state !== 'idle'" class="area-debug pane">
            <div class="pane-title">
                debug
            </div>
            <div class="pane-content">
                <debugger :refreshKey="refreshKey" :stack-container="stackContainer" :debug-info="debugInfo" />
            </div>
        </div>
        <div class="area-code pane">
            <div class="pane-title code-pane-title">
                <span>Code</span>
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
            </div>
            <monaco
                class="pane-content"
                v-model="text"
                :readonly="state !== 'idle'"
                :highlights="highlights"
            ></monaco>
            <div class="pane-footer">
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
                <div class="game-pane-controls">
                    <label class="game-random-label">
                        <input
                            v-model="randomizedStage"
                            type="checkbox"
                            :disabled="state !== 'idle'"
                        >
                        Random stage
                    </label>
                    <label class="game-continuous-label">
                        <input
                            v-model="continuousRun"
                            type="checkbox"
                        >
                        Continuous
                    </label>
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
                    <span
                        class="game-avg-ticks"
                        title="Mean world ticks over completed runs (win or program finished). Kill does not count."
                    >
                        Avg {{ avgTicksLabel }}
                        <span class="game-run-count">({{ scoreHistory.length }} runs)</span>
                    </span>
                    <button
                        type="button"
                        class="game-clear-avg"
                        :disabled="scoreHistory.length === 0"
                        @click="clearRunAverage"
                    >
                        Clear avg
                    </button>
                </div>
            </div>
            <div class="game-pane">
                <game-canvas :sim="sim" />
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
import { Sim, TICKS_PER_SECOND } from './game/sim'

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

type CodeSnippet = { id: string, label: string, code: string }

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

const CODE_SNIPPETS: CodeSnippet[] = [
    {
        id: 'scan-aim',
        label: 'Scan & aim',
        code: `// Robot controls:
//   rotate(deg)      turn (deg), positive = clockwise
//   move(distance)   enqueue forward motion (FIFO with rotate/shoot); VM keeps running
//   lastMoveDistance()  after prior moves finish: pixels moved for last completed segment (less if blocked)
//   shoot()          enqueue a shot (FIFO)
//   scan(rays)       1..90 rays across a 90-deg forward arc; waits for queued world actions + scan timing
//                    returns array of per-ray hit lists (length === rays)
//                    each hit: { distance, type }
//                    type: 'wall' | 'obstacle' | 'target' | 'disc'
//   won()            true once a disc has hit the green target
// Win by hitting the green target with a disc.
// Note: scan rays only see line-of-sight; the disc can still clip obstacles off-center,
// so after shooting we strafe sideways to break "aim OK but disc always blocked" loops.

clear()

let unstuck = 0

while (!won()) {
  // Fewer rays => shorter scan (fewer world ticks per loop); 9 is enough for ~11° steps on the arc.
  const rays = 9
  const sweep = scan(rays)

  // Find a ray whose FIRST hit is the target (nothing in the way).
  let bestIdx = -1, bestDist = Infinity
  for (let i = 0; i < sweep.length; i++) {
    const hits = sweep[i]
    if (hits.length > 0 && hits[0].type === 'target' && hits[0].distance < bestDist) {
      bestDist = hits[0].distance
      bestIdx = i
    }
  }

  if (bestIdx >= 0) {
    unstuck = 0
    const t = bestIdx / (rays - 1)
    const deg = -45 + t * 90
    rotate(deg)
    shoot()
    // Side-step: same LOS as scan can still mean a blocked disc path; strafe for a new firing point.
    if (Math.random() > 0.5) {
      move(5)
      rotate(90)
      move(8)
      rotate(-90)
    } else {
      move(5)
      rotate(-90)
      move(8)
      rotate(90)
    }
  } else {
    const want = 24
    if (unstuck !== 0) {
      move(want)
      if (lastMoveDistance() >= want - 0.5) {
        unstuck = 0
      } else {
        rotate(unstuck)
      }
    } else {
      move(want)
      if (lastMoveDistance() < want - 0.5) {
        unstuck = -90 + Math.random() * 180
        rotate(unstuck)
      }
    }
  }
}
print('win!')

`,
    },
    {
        id: 'rotate-sweep',
        label: 'Rotate sweep',
        code: `// Same API as other snippet (move/rotate/shoot queue in parallel with VM; scan and
// lastMoveDistance wait for the world). Strategy: small turns each loop, fewer rays,
// shoot as soon as any ray sees the target first; otherwise creep and turn on block.

clear()

let unstuck = 0

while (!won()) {
  if (unstuck === 0) {
    rotate(10)
  }
  const rays = 11
  const sweep = scan(rays)

  let hitIdx = -1
  for (let i = 0; i < sweep.length; i++) {
    const h = sweep[i]
    if (h.length > 0 && h[0].type === 'target') {
      hitIdx = i
      break
    }
  }

  if (hitIdx >= 0) {
    unstuck = 0
    const t = hitIdx / (rays - 1)
    const deg = -45 + t * 90
    rotate(deg)
    shoot()
    print('shot ~' + deg.toFixed(0) + 'deg')
    if (Math.random() > 0.5) {
      move(5)
      rotate(90)
      move(8)
      rotate(-90)
    } else {
      move(5)
      rotate(-90)
      move(8)
      rotate(90)
    }
  } else {
    const want = 14
    if (unstuck !== 0) {
      move(want)
      if (lastMoveDistance() >= want - 0.5) {
        unstuck = 0
      } else {
        rotate(unstuck)
      }
    } else {
      move(want)
      if (lastMoveDistance() < want - 0.5) {
        unstuck = -90 + Math.random() * 180
        rotate(unstuck)
      }
    }
  }
}
print('win!')

`,
    },
]

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
            sim: null as Sim | null,
            /** Coalesce Monaco/debug updates to one paint per frame (avoids freezing at high tick rates). */
            highlightRafId: 0,
            /** >1 shortens wait between sim/VM steps (wall-clock); scales runExecution waitTick delays. */
            gameSpeedMultiplier: 1,
            /** Random obstacles/targets/bot (margins only; not forced winnable from spawn). */
            randomizedStage: false,
            /** Chain Run → new sim + VM until unchecked or Kill. */
            continuousRun: false,
            /** Ticks at end of each completed run (not counted on Kill). */
            scoreHistory: [] as number[],
            execution: null as ReturnType<typeof getExecution> | null,
            program: [] as number[],
            /** Last `createVmHostRedirects` map (Math.random + forEach); used by REPL `run`. */
            vmHostRedirects: null as WeakMap<Function, Function> | null,
            mobileTopTab: 'code' as 'code' | 'debug',
            mobileBottomTab: 'game' as 'game' | 'output',
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
                const getPos = () => {
                    return this.getSourceMapAtPtr(execution)
                }

                const originalPos = getPos()
                const getCurrentStackLength = () => execution[Fields.stack].filter(it => it[Fields.type] === FrameType.Function).length
                let maxStack = getCurrentStackLength()
                let skipping = false
                let firstIgnored = false
                const sim = this.sim

                do {
                    result = execution[Fields.step](true)

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
                    && !(sim && sim.vmBarrierBlocksExecution())
                )

                if (!result[Fields.done]) {
                    this.scheduleDebugHighlight()
                }
                if (result[Fields.done]) {
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
            this.state = 'play'
            const execution = this.execution
            const sim = this.sim
            if (!sim || !execution) {
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
            const TICK_MS = 1000 / TICKS_PER_SECOND
            // Browsers clamp setTimeout to ~4ms; below that, batch multiple sim ticks per wake.
            const MIN_TIMER_MS = 4
            const ticksPerTimer = TICK_MS >= MIN_TIMER_MS
                ? 1
                : Math.max(1, Math.ceil(MIN_TIMER_MS / TICK_MS))
            const waitDurationMs = TICK_MS >= MIN_TIMER_MS
                ? TICK_MS
                : Math.max(MIN_TIMER_MS, ticksPerTimer * TICK_MS)

            let nextWakeAt = performance.now()
            const scaledWaitMs = () => {
                const s = Math.max(0.1, Math.min(128, this.gameSpeedMultiplier))
                return waitDurationMs / s
            }
            const waitTick = async () => {
                nextWakeAt += scaledWaitMs()
                const now = performance.now()
                if (now < nextWakeAt) {
                    await new Promise(r => setTimeout(r, nextWakeAt - now))
                }
            }

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
                        sim.advanceOneTick()
                        if (sim.won) {
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
                                prevPos = pos
                                highlightChanged = true
                                highlightChangedBatch = true
                                this.scheduleDebugHighlight()
                            }
                            if (guardSteps > 200000) break
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

                if (result[Fields.done] || sim.won) {
                    this.state = 'idle'
                    this.scoreHistory.push(sim.tick)
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

            const sim = new Sim({ randomizedStage: this.randomizedStage })
            this.sim = sim

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
            const won = () => sim.won

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
}
pre {
    margin: 0;
}
</style>
<style scoped>
.app {
    height: 100vh;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    display: grid;
    /* Code left (wide), game on top-right, output on bottom-right */
    grid-template-areas:
        "code game"
        "code output";
    grid-template-columns: minmax(0, 1fr) minmax(280px, 400px);
    grid-template-rows: minmax(0, 1.15fr) minmax(0, 1fr);
}
.app.running {
    grid-template-areas:
        "debug code game"
        "debug code output";
    grid-template-columns: minmax(0, 400px) minmax(0, 1fr) minmax(280px, 400px);
    grid-template-rows: minmax(0, 1.15fr) minmax(0, 1fr);
}
.area-debug {
    grid-area: debug;
    border-right: 1px solid rgba(127, 127, 127, 0.5);
    min-width: 0;
}
.area-debug .pane-content {
    overflow-y: auto;
}
.area-code {
    grid-area: code;
    min-width: 0;
}
.area-game {
    grid-area: game;
    min-width: 0;
    min-height: 0;
    border-bottom: 1px solid rgba(127, 127, 127, 0.5);
}
.area-output {
    grid-area: output;
    min-width: 0;
    min-height: 0;
}
.mobile-tab-bar {
    display: none;
}
.code-pane-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75em;
    min-width: 0;
}
.snippet-label {
    display: flex;
    align-items: center;
    gap: 0.35em;
    font-size: 0.85em;
    color: #bbb;
}
.snippet-select {
    background: #333;
    color: #eee;
    border: 1px solid #555;
    padding: 0.2em 0.35em;
    border-radius: 2px;
    min-width: 0;
}
.area-code .pane-footer {
    display: flex;
    align-items: stretch;
    justify-content: stretch;
}
.area-code .pane-footer > * {
    flex: 1 1 0;
    position: relative;
}
.area-code .pane-footer > *:not(:first-child)::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255, 255, 255, 0.5);
}
.pane {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    overflow: clip;
}
.pane-title {
    padding: 1em;
    flex-grow: 0;
    border-bottom: 1px solid rgba(127, 127, 127, 0.5);
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
.game-random-label {
    display: flex;
    align-items: center;
    gap: 0.35em;
    font-size: 0.85em;
    color: #bbb;
    cursor: pointer;
    user-select: none;
}
.game-random-label input {
    cursor: pointer;
}
.game-speed-label {
    display: flex;
    align-items: center;
    gap: 0.35em;
    font-size: 0.85em;
    color: #bbb;
}
.game-speed-select {
    background: #333;
    color: #eee;
    border: 1px solid #555;
    padding: 0.2em 0.35em;
    border-radius: 2px;
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
    padding: 0.2em 0.5em;
    background: #333;
    color: #ccc;
    border: 1px solid #555;
    border-radius: 2px;
    cursor: pointer;
}
.game-clear-avg:disabled {
    opacity: 0.45;
    cursor: default;
}
.pane-content {
    flex-grow: 1;
    flex-basis: 0;
    min-width: 0;
    overflow: hidden;
    overflow: clip;
}
.pane-footer {
    flex-grow: 0;
}
.run-button {
    border: 0;
    background: #777;
    padding: 1em;
    color: white;
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
    padding: 8px;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #000;
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
    .mobile-tab-bar {
        display: flex;
        background: #1a1a1a;
        border-bottom: 1px solid rgba(127, 127, 127, 0.5);
    }
    .mobile-tab-bar-top {
        grid-area: tabtop;
    }
    .mobile-tab-bar-bottom {
        grid-area: tabbot;
        border-top: 1px solid rgba(127, 127, 127, 0.5);
    }
    .mobile-tab-bar button {
        flex: 1 1 0;
        border: 0;
        background: transparent;
        color: #bbb;
        padding: 0.75em 1em;
        font: inherit;
        cursor: pointer;
        border-bottom: 2px solid transparent;
    }
    .mobile-tab-bar button.active {
        color: #fff;
        border-bottom-color: #9cf;
    }
    .mobile-tab-bar button:disabled {
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
}
</style>
