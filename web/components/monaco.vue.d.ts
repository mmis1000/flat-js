import * as monaco from 'monaco-editor';
declare const _default: import("vue").DefineComponent<import("vue").ExtractPropTypes<{
    modelValue: {
        type: StringConstructor;
        default: string;
    };
    readonly: {
        type: BooleanConstructor;
        default: boolean;
    };
    highlights: {
        type: () => [number, number, number, number][];
        default(): never[];
    };
    breakpoints: {
        type: () => number[];
        default(): never[];
    };
}>, {}, {
    editor: monaco.editor.IStandaloneCodeEditor;
    currentDecorations: string[];
}, {
    highlightSerialized(): string;
    breakpointSerialized(): string;
}, {
    applyDecorations(): void;
    revealHighlight(): void;
}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<import("vue").ExtractPropTypes<{
    modelValue: {
        type: StringConstructor;
        default: string;
    };
    readonly: {
        type: BooleanConstructor;
        default: boolean;
    };
    highlights: {
        type: () => [number, number, number, number][];
        default(): never[];
    };
    breakpoints: {
        type: () => number[];
        default(): never[];
    };
}>> & Readonly<{}>, {
    modelValue: string;
    highlights: [number, number, number, number][];
    breakpoints: number[];
    readonly: boolean;
}, {}, {}, {}, string, import("vue").ComponentProvideOptions, true, {}, any>;
export default _default;
