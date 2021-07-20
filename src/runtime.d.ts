import { InvokeType, ResolveType, TryCatchFinallyState } from "./compiler";
declare const enum FrameType {
    Function = 0,
    Try = 1
}
export declare type Scope = Record<string, any>;
export declare const enum Fields {
    type = 0,
    savedScopes = 1,
    scopes = 2,
    valueStack = 3,
    return = 4,
    catch = 5,
    finally = 6,
    variable = 7,
    name = 8,
    tdz = 9,
    immutable = 10,
    value = 11,
    offset = 12,
    state = 13,
    resolveType = 14,
    exit = 15,
    function = 16,
    self = 17,
    arguments = 18,
    invokeType = 19,
    ptr = 20,
    stack = 21,
    setDebugFunction = 22,
    step = 23,
    programSection = 24,
    textSection = 25,
    evalResult = 26,
    newTarget = 27
}
interface BaseFrame {
    [Fields.type]: FrameType;
    [Fields.programSection]: number[];
    [Fields.textSection]: any[];
    [Fields.scopes]: Scope[];
    [Fields.valueStack]: any[];
}
interface FunctionFrame extends BaseFrame {
    [Fields.type]: FrameType.Function;
    [Fields.return]: number;
    [Fields.invokeType]: InvokeType;
}
interface TryFrame extends BaseFrame {
    [Fields.type]: FrameType.Try;
    [Fields.savedScopes]: Scope[];
    [Fields.scopes]: Scope[];
    [Fields.valueStack]: any[];
    [Fields.state]: TryCatchFinallyState;
    [Fields.resolveType]: ResolveType;
    [Fields.value]: any;
    /** address */
    [Fields.catch]: number;
    /** address */
    [Fields.finally]: number;
    /** address */
    [Fields.exit]: number;
    [Fields.variable]: string;
}
export declare type Frame = FunctionFrame | TryFrame;
export declare type Stack = Frame[];
export declare type Result = {
    done: false;
} | {
    done: true;
    value: unknown;
    evalValue: unknown;
};
declare type InvokeParamApply = {
    [Fields.type]: InvokeType.Apply;
    [Fields.function]: unknown;
    [Fields.name]: string;
    [Fields.self]: unknown;
};
declare type InvokeParamConstruct = {
    [Fields.type]: InvokeType.Construct;
    [Fields.function]: unknown;
    [Fields.name]: string;
    [Fields.newTarget]: unknown;
};
export declare type InvokeParam = InvokeParamApply | InvokeParamConstruct;
declare const getExecution: (program: number[], textData: any[], entryPoint?: number, scopes?: Scope[], invokeData?: InvokeParam, args?: any[], getDebugFunction?: () => null | (() => void)) => {
    readonly 20: number;
    readonly 21: Stack;
    readonly 2: Scope[];
    23: (debug?: boolean) => Result;
};
declare const run: (program: number[], textData: any[], entryPoint?: number, scopes?: Scope[], self?: undefined, args?: any[]) => unknown;
export { getExecution, run };
