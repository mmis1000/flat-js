<template>
    <div ref="editor"></div>
</template>

<script lang="ts">
import * as monaco from 'monaco-editor';
import Vue from 'vue'
export default Vue.extend({
    props: {
        value: {
            type: String,
            default: ''
        }
    },
    watch: {
        value (newVal) {
            const editor = ((this as any).editor as monaco.editor.IStandaloneCodeEditor)
            const current = editor.getValue()
            if (current !== newVal) {
                editor.setValue(newVal)
            }
        }
    },
    mounted () {
        const editor = (this as any).editor = monaco.editor.create(this.$refs.editor as any, {
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
    }
})
</script>

<style>

</style>