import { PropType } from 'vue';
import { DebugInfo } from '../../src/compiler';
import { Scope, Stack } from '../../src/runtime';
import { LogicalDebugFrame } from '../debug-stack';
declare const _default: import("vue").DefineComponent<import("vue").ExtractPropTypes<{
    stackContainer: {
        type: () => {
            stack: Stack;
        };
        default(): {
            stack: Stack;
        };
    };
    refreshKey: {
        type: NumberConstructor;
        default: number;
    };
    selectedFrameIndex: {
        type: PropType<number | null>;
        default: null;
    };
    disabledProgramSections: {
        type: () => ReadonlySet<number[]>;
        default(): ReadonlySet<number[]>;
    };
    selectableProgramSections: {
        type: () => ReadonlySet<number[]> | undefined;
        default: undefined;
    };
    debugInfo: {
        type: () => DebugInfo;
        default(): DebugInfo;
    };
}>, {}, {
    refreshKeyInternal: number;
}, {
    stackFrames(): LogicalDebugFrame[];
    activeFrameIndex(): number;
    scopes(): Scope[];
}, {
    getKey: (obj: any) => number;
    getFrameLabel(index: number): string;
    selectFrame(index: number): void;
    getScopeDebugNames(scope: Scope): string[];
    isGlobalThis(v: any): boolean;
}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<import("vue").ExtractPropTypes<{
    stackContainer: {
        type: () => {
            stack: Stack;
        };
        default(): {
            stack: Stack;
        };
    };
    refreshKey: {
        type: NumberConstructor;
        default: number;
    };
    selectedFrameIndex: {
        type: PropType<number | null>;
        default: null;
    };
    disabledProgramSections: {
        type: () => ReadonlySet<number[]>;
        default(): ReadonlySet<number[]>;
    };
    selectableProgramSections: {
        type: () => ReadonlySet<number[]> | undefined;
        default: undefined;
    };
    debugInfo: {
        type: () => DebugInfo;
        default(): DebugInfo;
    };
}>> & Readonly<{}>, {
    refreshKey: number;
    stackContainer: {
        stack: Stack;
    };
    selectedFrameIndex: number | null;
    disabledProgramSections: ReadonlySet<number[]>;
    selectableProgramSections: ReadonlySet<number[]> | undefined;
    debugInfo: DebugInfo;
}, {}, {
    DebuggerValue: import("vue").DefineComponent<{}, {}, any, import("vue").ComputedOptions, import("vue").MethodOptions, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<import("vue").ExtractPropTypes<{}>>, {}, {}, {}, {}, string, import("vue").ComponentProvideOptions, true, {}, any>;
}, {}, string, import("vue").ComponentProvideOptions, true, {}, any>;
export default _default;
