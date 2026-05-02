import { Fields, FrameType } from '../src/runtime';
import type { Frame, Stack } from '../src/runtime';
type FunctionDebugFrame = Frame & {
    [Fields.type]: FrameType.Function;
    [Fields.return]: number;
    [Fields.function]: unknown;
    [Fields.name]: string;
};
export type LogicalDebugFrame = {
    functionFrame: FunctionDebugFrame;
    scopeFrame: Frame;
    functionStackIndex: number;
    scopeStackIndex: number;
    parkedPtr: number | undefined;
    functionName: string;
    active: boolean;
    selectable: boolean;
};
export type DebugFrameSourcePointer = {
    programSection: number[];
    ptr: number;
};
export declare const resolveDebugFrameIndex: (frames: readonly LogicalDebugFrame[], selectedFrameIndex: number | null) => number;
export declare const getLogicalDebugFrames: (stack: Stack, disabledProgramSections?: ReadonlySet<number[]>, selectableProgramSections?: ReadonlySet<number[]>) => LogicalDebugFrame[];
export declare const getSelectedDebugFrameSourcePointer: (stack: Stack, selectedFrameIndex: number | null, currentPtr: number, disabledProgramSections?: ReadonlySet<number[]>, selectableProgramSections?: ReadonlySet<number[]>) => DebugFrameSourcePointer | undefined;
export declare const getSelectedDebugFrameSourcePointers: (stack: Stack, selectedFrameIndex: number | null, currentPtr: number, disabledProgramSections?: ReadonlySet<number[]>, selectableProgramSections?: ReadonlySet<number[]>) => DebugFrameSourcePointer[];
export {};
