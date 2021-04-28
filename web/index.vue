<template>
    <div class="app">
        <div class="pane">
            <div class="pane-title">
                Code
            </div>
            <monaco class="pane-content" v-model="text"></monaco>
            <button class="run-button pane-footer" @click="run">Run</button>
        </div>
        <div class="pane">
            <div class="pane-title">
                Result
            </div>
            <div class="result-pane pane-content">
                <pre class="result">{{ result }}</pre>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { compile, run } from '../src'
import Vue from 'vue'
import Monaco from './components/monaco.vue'

export default Vue.extend({
    components: {
        Monaco
    },
    data() {
        return {
            text: `clear()
const start = Date.now()
let a = 0
for (let i = 0; i < 1000; i++) {
  a = a + i
}
print(a)
print('total time: ' + (Date.now() - start) + 'ms')
alert('CSP just can\\'t stop me')
debugger`,
            result: ''
        }
    },
    methods: {
        run() {
            const clear = (val: any) => {
                this.result = ''
            }

            const print = (val: any) => {
                this.result += JSON.stringify(val, undefined, 2) + '\n'
            }

            const [programData, textData] = compile(this.text)
            run(programData, textData, 0, [globalThis, { print, clear }])
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

.app {
    height: 100vh;
    width: 100vw;
}
.pane {
    height: 50vh;
    display: flex;
    flex-direction: column;
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
}
.result {
    padding: 1em;
    line-height: 2em;
}
</style>