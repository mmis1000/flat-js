import { type ProgramScopeDebugMap } from './shared';
export type CompileOptions = {
    /** prints debug info to stdout */
    debug?: boolean;
    /** generate sourcemap */
    range?: boolean;
    /** generate with eval result op inserted */
    evalMode?: boolean;
    /** force strict-mode source semantics for direct eval / synthetic entry points */
    withStrict?: boolean;
};
export type DebugInfo = {
    sourceMap: [number, number, number, number][];
    internals: boolean[];
    scopeDebugMap: ProgramScopeDebugMap;
    /** Byte length of executable code (words before literal pool tail). */
    codeLength: number;
};
export declare function compile(src: string, { debug, range, evalMode, withStrict }?: CompileOptions): [number[], DebugInfo];
