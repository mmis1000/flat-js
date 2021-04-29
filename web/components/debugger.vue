<template>
    <div>
        <div class="header">
            Scopes
        </div>
        <div class="area">
            <div v-for="(scope, index) in scopes" :key="getKey(scope)">
                <debuggerValue displayKey="Scope" :initialExpand="index !== scopes.length - 1" :refreshKey="refreshKey + refreshKeyInternal" :value="scope" :forcedProp="true"/>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import Vue from 'vue'
import { Fields, Scope, Stack } from '../../src/runtime'
import DebuggerValue from './debugger-value.vue'

let id = 0
let map = new WeakMap()

const getKey = (obj: any) => {
    if (map.has(obj)) {
        return map.get(obj)
    } else {
        const newId = id++
        map.set(obj, id)
        return newId
    }
}

export default Vue.extend({
    components: {
        DebuggerValue
    },
    props: {
        stackContainer: {
            type: Object as () => { stack: Stack },
            default (): { stack: Stack } {
                return { stack: [] }
            }
        },
        refreshKey: {
            type: Number,
            default: 0
        }
    },
    data () {
        return {
            refreshKeyInternal: Math.random()
        }
    },
    computed: {
        scopes (): Scope[] {
            const stack = this.stackContainer.stack
            const top = stack[stack.length - 1]
            return top ? top[Fields.scopes].slice(0).reverse() : []
        }
    },
    methods: {
        getKey
    }
})
</script>

<style scoped>
.header {
    padding: 0.5em 1em;
}
.area {
    padding: 0 1em;
}
.header, .area {
    border-bottom: 1px solid rgba(127, 127, 127, 0.5);
}
</style>