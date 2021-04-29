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
        }
    },
    data () {
        return withNonReactive({})<{
            editor: monaco.editor.IStandaloneCodeEditor
        }>()
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
        }
    },
    mounted () {
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
    }
})
</script>

<style>

</style>