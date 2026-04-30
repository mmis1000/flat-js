<template>
    <div ref="editor" class="monaco-host"></div>
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
        },
        breakpoints: {
            type: Array as () => number[],
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
        },
        breakpointSerialized (): string {
            return JSON.stringify(this.breakpoints)
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
            this.applyDecorations()
        },
        breakpointSerialized () {
            this.applyDecorations()
        }
    },
    methods: {
        applyDecorations () {
            this.currentDecorations = this.editor.deltaDecorations(
                this.currentDecorations,
                [
                    ...this.breakpoints.map((lineNumber) => ({
                        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                        options: {
                            isWholeLine: true,
                            glyphMarginClassName: 'breakpoint-glyph',
                            glyphMarginHoverMessage: { value: 'Pause on this line' },
                        }
                    })),
                    ...this.highlights.map(([r1, c1, r2, c2]) => ({
                        range: new monaco.Range(r1, c1, r2, c2),
                        options: { inlineClassName: 'inline-highlight' }
                    }))
                ]
            )
        },
        revealHighlight () {
            const highlight = this.highlights[0]
            if (!highlight) {
                return
            }
            const [r1, c1, r2, c2] = highlight
            this.editor.revealRangeInCenterIfOutsideViewport(
                new monaco.Range(r1, c1, r2, c2),
                monaco.editor.ScrollType.Immediate
            )
        }
    },
    mounted () {
        this.currentDecorations = []
        const editor = this.editor = monaco.editor.create(this.$refs.editor as any, {
            value: this.value,
            language: 'javascript',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            glyphMargin: true,
        });

        editor.onDidChangeModelContent(ev => {
            const value = editor.getValue()
            if (value !== this.value) {
                this.$emit('input', editor.getValue())
            }
        })

        editor.onMouseDown((ev: monaco.editor.IEditorMouseEvent) => {
            if (!ev.event.leftButton) return
            const lineNumber = ev.target.position?.lineNumber
            if (!lineNumber) return
            if (
                ev.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
                || ev.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
            ) {
                ev.event.preventDefault()
                this.$emit('toggle-breakpoint', lineNumber)
            }
        })

        if (this.readonly) {
            this.editor.updateOptions({
                readOnly: true
            })
        }

        this.applyDecorations()
    }
})
</script>

<style scoped>
.monaco-host {
    height: 100%;
    min-width: 0;
    min-height: 0;
}
::v-deep .inline-highlight {
    position: relative;
    background: rgb(251, 255, 0);
    outline: 1px solid rgba(255, 0, 0, 0.3);
}

::v-deep .inline-highlight ~ .inline-highlight::before{
    position: absolute;
    display: block;
    content: "";
    left: -1px;
    top: 0.5px;
    bottom: 0.5px;
    width: 2px;
    background: rgb(251, 255, 0);
}

::v-deep .breakpoint-glyph {
    width: 12px !important;
    height: 12px !important;
    margin-left: 4px;
    margin-top: 4px;
    border-radius: 999px;
    background: #ff6868;
    box-shadow: 0 0 0 1px rgba(33, 10, 10, 0.45), 0 0 10px rgba(255, 104, 104, 0.4);
}
</style>
