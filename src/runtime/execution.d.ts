import { InvokeParam, Result, Scope, Stack } from "./shared";
import { type DebugCallback } from "./opcodes/types";
export declare const getExecution: (program: number[], entryPoint: number | undefined, globalThis: object, scopes?: Scope[], invokeData?: InvokeParam, args?: any[], getDebugFunction?: () => null | DebugCallback, compileFunction?: typeof import("../compiler").compile, functionRedirects?: WeakMap<Function, Function>, variableEnvironmentScope?: Scope | null) => {
    20: number;
    readonly 21: Stack;
    readonly 2: Scope[];
    23: (debug?: boolean) => Result;
    35(value: unknown): void;
    36(error: unknown): void;
};
export declare const run: (program: number[], entryPoint: number | undefined, globalThis: object, scopes?: Scope[], self?: undefined, args?: any[], compileFunction?: typeof import("../compiler").compile | undefined, functionRedirects?: WeakMap<Function, Function>, getDebugFunction?: () => null | DebugCallback, variableEnvironmentScope?: Scope | null) => any;
