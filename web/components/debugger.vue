<template>
    <div>
        <div class="header">
            Stack
        </div>
        <div class="stack-area">
            <button
                v-for="(frame, index) in stackFrames"
                :key="getKey(frame.functionFrame)"
                type="button"
                class="stack-frame"
                :class="{ active: activeFrameIndex === index, disabled: !frame.selectable }"
                :disabled="!frame.selectable"
                @click="selectFrame(index)"
            >
                <span>{{ getFrameLabel(index) }}</span>
            </button>
        </div>
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
import { defineComponent, PropType } from 'vue'
import { DebugInfo } from '../../src/compiler'
import { Fields, getScopeDebugPtr, Scope, Stack } from '../../src/runtime'
import { getLogicalDebugFrames, LogicalDebugFrame, resolveDebugFrameIndex } from '../debug-stack'
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

export default defineComponent({
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
        selectedFrameIndex: {
            type: Number as PropType<number | null>,
            default: null
        },
        disabledProgramSections: {
            type: Object as () => ReadonlySet<number[]>,
            default (): ReadonlySet<number[]> {
                return new Set()
            }
        },
        selectableProgramSections: {
            type: Object as () => ReadonlySet<number[]> | undefined,
            default: undefined
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
        stackFrames (): LogicalDebugFrame[] {
            return getLogicalDebugFrames(
                this.stackContainer.stack,
                this.disabledProgramSections,
                this.selectableProgramSections
            )
        },
        activeFrameIndex (): number {
            return resolveDebugFrameIndex(this.stackFrames, this.selectedFrameIndex)
        },
        scopes (): Scope[] {
            const frame = this.stackFrames[this.activeFrameIndex]
            return frame ? frame.scopeFrame[Fields.scopes].slice(0).reverse() : []
        }
    },
    methods: {
        getKey,
        getFrameLabel (index: number) {
            if (index === this.stackFrames.length - 1) {
                return 'entry'
            }

            const name = this.stackFrames[index]?.functionName || 'anonymous'
            return index === 0 ? `Current: ${name}` : name
        },
        selectFrame (index: number) {
            if (!this.stackFrames[index]?.selectable) {
                return
            }
            this.$emit('select-frame', index === 0 ? null : index)
        },
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
.stack-area {
    display: flex;
    flex-direction: column;
    gap: 0.35em;
    padding: 0.5em 1em;
}
.stack-frame {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 2em;
    border: 1px solid rgba(120, 180, 205, 0.28);
    background: rgba(12, 22, 30, 0.82);
    color: #d8edf8;
    border-radius: 6px;
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.stack-frame.active {
    border-color: rgba(255, 235, 120, 0.68);
    background: rgba(74, 66, 22, 0.55);
    color: #fff8d2;
}
.stack-frame.disabled {
    cursor: default;
    opacity: 0.55;
}
.header, .area, .stack-area {
    border-bottom: 1px solid rgba(127, 127, 127, 0.5);
}
</style>
