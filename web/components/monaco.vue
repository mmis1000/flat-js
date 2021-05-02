<template>
    <div ref="editor"></div>
</template>

<script lang="ts">
import * as monaco from 'monaco-editor';
import Vue from 'vue'
function withNonReactive<TData>(data: TData) {
    return <TNonReactive>() => data as TData & TNonReactive;
}

export default Vue.extend({
    props: {
        value: {
            type: String,
            default: ''
        },
        readonly: {
            type: Boolean,
            default: false
        },
        highlights: {
            type: Array as () => [number, number, number, number][],
            default () {
                return []
            }
        }
    },
    data () {
        return withNonReactive({})<{
            editor: monaco.editor.IStandaloneCodeEditor,
            currentDecorations: string[]
        }>()
    },
    computed: {
        highlightSerialized (): string {
            return JSON.stringify(this.highlights)
        }
    },
    watch: {
        value (newVal) {
            const editor = this .editor
            const current = editor.getValue()
            if (current !== newVal) {
                editor.setValue(newVal)
            }
        },
        readonly (newVal) {
            this.editor.updateOptions({
                readOnly: newVal
            })
        },
        highlightSerialized () {
            this.currentDecorations = this.editor.deltaDecorations(
                this.currentDecorations,
                this.highlights.map(([r1, c1, r2, c2]) => ({
                    range: new monaco.Range(r1, c1, r2, c2), 
                    options: { inlineClassName: 'inline-highlight' }
                }))
            )
        }
    },
    mounted () {
        this.currentDecorations = []
        const editor = this.editor = monaco.editor.create(this.$refs.editor as any, {
            value: this.value,
            language: 'javascript',
            scrollBeyondLastLine: false,
            automaticLayout: true
        });

        editor.onDidChangeModelContent(ev => {
            const value = editor.getValue()
            if (value !== this.value) {
                this.$emit('input', editor.getValue())
            }
        })

        if (this.readonly) {
            this.editor.updateOptions({
                readOnly: true
            })
        }

        if (this.highlights.length > 0) {
            this.currentDecorations = this.editor.deltaDecorations(
                this.currentDecorations,
                this.highlights.map(([r1, c1, r2, c2]) => ({
                    range: new monaco.Range(r1, c1, r2, c2), 
                    options: { inlineClassName: 'inline-highlight' }
                }))
            )
        }
    }
})
</script>

<style scoped>
::v-deep .inline-highlight {
    background: rgb(251, 255, 0);
}
</style>