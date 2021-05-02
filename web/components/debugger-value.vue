<template>
    <div class="debugger-value">
        <span v-if="displayKey !== null">{{ displayKey }}:</span>
        <span v-if="type === 'number'" class="number">{{serialized}}</span>
        <span v-if="type === 'string'" class="string">{{serialized}}</span>
        <span v-if="type === 'boolean'" class="boolean">{{serialized}}</span>
        <span v-if="type === 'null'" class="null">{{serialized}}</span>
        <span v-if="type === 'undefined'" class="undefined">{{serialized}}</span>
        <span v-if="type === 'object'" class="object" @click="expand = !expand">
            {{serialized}} {{ expand ? '[-] Collapse' : '[+] Expand' }}
        </span>
        <span v-if="type === 'function'" class="function" @click="expand = !expand">
            {{serialized}} {{ expand ? '[-] Collapse' : '[+] Expand' }}
        </span>
        <div v-if="expand" class="properties">
            <div v-for="entry of childEntries" :key="JSON.stringify([entry[0], entry[1]])" :key1="JSON.stringify([entry[0], entry[1]])">
                <debugger-value :refreshKey="refreshKey" :displayKey="entry[1]" :value="entry[2]" />
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import Vue from 'vue'

enum EntryType {
    stringKeyProp,
    stringKeyGetSet,
    symbolKeyProp,
    symbolKeyGetSet,
    prototype
}

export default Vue.extend({
    name: 'DebuggerValue',
    props: {
        initialExpand: {
            type: Boolean,
            default: false
        },
        displayKey: {
            type: String,
            default: null
        },
        forcedProp: {
            type: Boolean,
            default: false
        },
        refreshKey: {
            type: Number,
            default: 0
        },
        value: {}
    },
    data () {
        return {
            expand: this.initialExpand,
            EntryType
        }
    },
    computed: {
        type (): string {
            this.refreshKey
            return this.value === null ? 'null' : typeof this.value
        },
        serialized (): string {
            this.refreshKey
            if (this.value === undefined) return 'undefined'
            if (this.value === null) return 'null'
            if (typeof this.value === 'object') return 'Object {}'
            if (typeof this.value === 'function') return 'function'
            return JSON.stringify(this.value)
        },
        childEntries (): [EntryType, string | symbol, unknown | PropertyDescriptor][] {
            this.refreshKey
            if (this.type !== 'object' && this.type !== 'function') {
                return []
            }

            const keys = Reflect.ownKeys(this.value as any)

            const entries: [EntryType, string | symbol, unknown | PropertyDescriptor][] = []

            for (let key of keys) {
                const desc = Reflect.getOwnPropertyDescriptor(this.value as any, key)!
                if (typeof key === 'string') {
                    if ('value' in desc || this.forcedProp) {
                        entries.push([EntryType.stringKeyProp, this.wrapIdentifier(key), (this.value as any)[key]])
                    } else {
                        entries.push([EntryType.stringKeyGetSet, 'get/set ' + this.wrapIdentifier(key), desc])
                    }
                } else {
                    if ('value' in desc || this.forcedProp) {
                        entries.push([EntryType.symbolKeyProp, this.wrapIdentifier(key.toString()), (this.value as any)[key]])
                    } else {
                        entries.push([EntryType.stringKeyGetSet, 'get/set ' + this.wrapIdentifier(key.toString()), desc])
                    }
                }
            }

            const proto = Reflect.getPrototypeOf(this.value as any)
            if (proto != null) {
                entries.push([EntryType.prototype, '[[prototype]]', proto])
            }

            return entries
        }
    },
    methods: {
        wrapIdentifier (str: string) {
            if (!/["'\(\)\r\n]/.test(str)) {
                return str
            }

            return JSON.stringify(str)
        }
    }
})
</script>

<style scoped>
.debugger-value {
    font-family: monospace;
}
.properties {
    margin-left: 1em;
}

.number {
    color: #ff4800;
}

.boolean {
    color: #64a100;
}

.null {
    color: #76a100;
}
.undefined {
    color: #a1001b;
}
.string {
    color: #d400ff;
}
.object {
    color: #36c000;
}
.function {
    color: #4e5cd6;
}
</style>