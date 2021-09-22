import { getExecution } from '../src';
import Vue from 'vue';
import { Stack } from '../src/runtime';
import { DebugInfo } from '../src/compiler';
declare type State = 'play' | 'paused' | 'idle';
declare const _default: import("vue/types/vue").ExtendedVue<Vue, {
    text: string;
    result: string;
    replText: string;
    stackContainer: {
        stack: Stack;
    };
    state: State;
    refreshKey: number;
    debugInfo: DebugInfo;
    highlights: [number, number, number, number][];
} & {
    execution: ReturnType<typeof getExecution>;
    program: number[];
}, {
    printError(err: any): void;
    stepExecution(stepIn?: boolean): void;
    runExecution(): Promise<void>;
    run(): void;
    runAndPause(): void;
    pause(): void;
    resume(): void;
    stop(): void;
    runRepl(): void;
}, unknown, Record<never, any>>;
export default _default;
