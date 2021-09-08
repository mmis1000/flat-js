<template>
    <div class="app" :class="{ running: state !== 'idle' }">
        <div v-show="state !== 'idle'" class="area-debug pane">
            <div class="pane-title">
                debug
            </div>
            <div class="pane-content">
                <debugger :refreshKey="refreshKey" :stack-container="stackContainer" />
            </div>
        </div>
        <div class="area-code pane">
            <div class="pane-title">
                Code
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
        <div class="area-result pane">
            <div class="pane-title">
                Result
            </div>
            <div ref="result" class="result-pane pane-content">
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
import { FrameType, Result, Stack } from '../src/runtime'
import { Fields } from '../src/runtime'
import { DebugInfo } from '../src/compiler'

type State = 'play' | 'paused' | 'idle'

function withNonReactive<TData>(data: TData) {
    return <TNonReactive>() => data as TData & TNonReactive;
}

export default Vue.extend({
    components: {
        Monaco,
        Debugger
    },
    data() {
        return withNonReactive({
            text: `clear()
const start = Date.now()
let a = 0

const fn = (b) => {
  print(b)
}

for (let i = 0; i < 50; i++) {
  a = a + 1
  fn(a)
}

print(a)

do {
  try {
    print(1)
    throw new Error('')
  } finally {
    break
  }
} while (false)

debugger
print('total time: ' + (Date.now() - start) + 'ms')

`,
            result: '',
            replText: '',
            stackContainer: {
                stack: [] as Stack
            },
            state: 'idle' as State,
            refreshKey: Math.random(),
            debugInfo: <DebugInfo>{ sourceMap: [], internals: [] },
            highlights: <[number, number, number, number][]>[]
        })<{
            execution: ReturnType<typeof getExecution>,
            program: number[]
        }>()
    },
    watch: {
        async result () {
            const container = this.$refs.result as HTMLDivElement
            await this.$nextTick()
            if (container.scrollHeight - container.offsetHeight > container.scrollTop) {
                container.scrollTop = container.scrollHeight - container.offsetHeight
            }
        }
    },
    methods: {
        stepExecution(stepIn = false) {
            const execution = this.execution

            let stack = execution[Fields.stack]
            this.stackContainer = {
                get stack () {
                    return stack
                }
            }

            let result: Result

            try {
                const getPos = () => {
                    const currentPosition = execution[Fields.ptr]
                    return this.debugInfo.sourceMap[currentPosition]
                }

                const originalPos = getPos().join(',')
                const getCurrentStackLength = () => execution[Fields.stack].filter(it => it[Fields.type] === FrameType.Function).length
                let maxStack = getCurrentStackLength()
                let skipping = false
                let firstIgnored = false

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
                        getPos().join(',') === originalPos ||
                        this.debugInfo.internals[execution[Fields.ptr]] ||
                        skipping
                    )
                    && !result.done
                )

                this.refreshKey = Math.random()

                const [r1, c1, r2, c2] = getPos()
                this.highlights = [[r1 + 1, c1 + 1, r2 + 1, c2 + 1]]
                
                if (result.done) {
                    this.state = 'idle'
                }
                if (this.state === 'idle') {
                    this.highlights = []
                }

            } catch (err) {
                this.result += err ? err.stack || err.message || String(err): String(err) + '\n'
                this.state = 'idle'
                this.highlights = []
            }
        },
        async runExecution() {
            this.state = 'play'
            const execution = this.execution

            let stack = this.execution[Fields.stack]
            this.stackContainer = {
                get stack () {
                    return stack
                }
            }

            let result: Result

            const getPos = () => {
                const currentPosition = execution[Fields.ptr]
                return this.debugInfo.sourceMap[currentPosition]
            }

            let prevPos = getPos().join('')

            try {
                do {
                    result = execution[Fields.step](true)

                    if (getPos().join('') !== prevPos && !this.debugInfo.internals[execution[Fields.ptr]]) {
                        let stack = execution[Fields.stack]
                        this.stackContainer = {
                            get stack () {
                                return stack
                            }
                        }
                        this.refreshKey = Math.random()

                        const [r1, c1, r2, c2] = getPos()
                        this.highlights = [[r1 + 1, c1 + 1, r2 + 1, c2 + 1]]

                        await new Promise(r => setTimeout(r, 200))
                    }

                    prevPos = getPos().join('')
                } while (this.state === 'play' && !result.done)

                if (<State>this.state === 'paused') {
                    const [r1, c1, r2, c2] = getPos()
                    this.highlights = [[r1 + 1, c1 + 1, r2 + 1, c2 + 1]]
                }

                if (result.done) {
                    this.state = 'idle'
                }
                if (this.state === 'idle') {
                    this.highlights = []
                }

            } catch (err) {
                this.result += err ? err.stack || err.message || String(err): String(err) + '\n'
                this.state = 'idle'
                this.highlights = []
            }
        },
        run() {
            const clear = (val: any) => {
                this.result = ''
            }

            const print = (val: any) => {
                this.result += JSON.stringify(val, undefined, 2) + '\n'
            }

            const [programData, textData, debugInfo] = compile(this.text, { range: true })

            this.debugInfo = debugInfo
            this.program = programData
            this.execution = getExecution(
                programData,
                textData,
                0,
                [globalThis, { print, clear }],
                undefined,
                [],
                () => () => this.pause()
            )

            this.runExecution()
        },
        runAndPause() {
            const clear = (val: any) => {
                this.result = ''
            }

            const print = (val: any) => {
                this.result += JSON.stringify(val, undefined, 2) + '\n'
            }

            const [programData, textData, debugInfo] = compile(this.text, { range: true })

            this.debugInfo = debugInfo
            this.program = programData
            this.execution = getExecution(
                programData,
                textData,
                0,
                [globalThis, { print, clear }],
                undefined,
                [],
                () => () => this.pause()
            )

            this.pause()
        },
        pause() {
            this.state = 'paused'
            // force non reactive
            let stack = this.execution[Fields.stack]
            this.stackContainer = {
                get stack () {
                    return stack
                }
            }
            this.refreshKey = Math.random()
        },
        resume() {
            this.runExecution()
        },
        stop() {
            this.highlights = []
            this.state = 'idle'
        },
        runRepl() {
            const text = this.replText
            this.replText = ''

            const [programData, textData] = compile(text, { evalMode: true })

            try {
                this.result += '> ' + text + '\n'
                const result = run(programData, textData, 0, [...this.execution[Fields.scopes]])
                this.result += result + '\n'
            } catch (err) {
                this.result += String(err) + '\n'
            }
        }
    }
})
</script>

<style>
body,
html {
    background: black;
    margin: 0;
    padding: 0;
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
    width: 100vw;
    display: grid;
    grid-template-areas: "code"
                   "result";
    grid-template-rows: 1fr 1fr;
}
.app.running {
    grid-template-areas: "debug code"
                   "debug result";
    grid-template-rows: 1fr 1fr;
    grid-template-columns: 400px 1fr;
}
.area-debug {
    grid-area: debug;
    border-right: 1px solid rgba(127, 127, 127, 0.5);
}
.area-debug .pane-content {
    overflow-y: auto;
}
.area-code {
    grid-area: code;
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
.area-result {
    grid-area: result;
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
.pane-content {
    flex-grow: 1;
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
.result-pane {
    overflow-y: auto;
    position: relative;
}
.result {
    padding: 1em;
    line-height: 2em;
}
.repl {
    width: 100%;
    width: available;
    border: 0;
    padding: 1em;
    outline: 0;
    background: #333;
    color: white;
}
.repl::placeholder {
    color: #777;
}
</style>