<template>
    <div>
        <div class="header">
            Scopes
        </div>
        <div class="area">
            <div v-for="scope in scopes" :key="getKey(scope)" :key1="getKey(scope)">
                <debuggerValue displayKey="Scope" :initialExpand="!isGlobalThis(scope)" :refreshKey="refreshKey + refreshKeyInternal" :value="scope" :forcedProp="true" :scopeValue="true" :scopeDebugNames="getScopeDebugNames(scope)"/>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import Vue from 'vue'
import { DebugInfo } from '../../src/compiler'
import { Fields, getScopeDebugPtr, Scope, Stack } from '../../src/runtime'
import DebuggerValue from './debugger-value.vue'

let id = 0
let map = new WeakMap<any, number>()

const getKey = (obj: any) => {
    if (!map.has(obj)) {
        const newId = id++
        map.set(obj, newId)
    }

    return map.get(obj)!
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
        },
        debugInfo: {
            type: Object as () => DebugInfo,
            default (): DebugInfo {
                return {
                    sourceMap: [],
                    internals: [],
                    scopeDebugMap: new Map(),
                    codeLength: 0
                }
            }
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
        getKey,
        getScopeDebugNames (scope: Scope) {
            const ptr = getScopeDebugPtr(scope)
            return ptr === undefined ? [] : [...(this.debugInfo.scopeDebugMap.get(ptr) ?? [])]
        },
        isGlobalThis (v: any) {
            return v === globalThis
        }
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
