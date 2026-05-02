import type { FunctionTypes, VariableType } from "../../compiler";
import type { Execution, Frame, IdentifierReference, Result, Scope, Stack, StaticVariableStore, VariableRecord } from "../shared";
export declare const BREAK_COMMAND: unique symbol;
export type DebugCallback = (ptr?: number) => void;
export type OpcodeHandlerResult = Result | typeof BREAK_COMMAND | void;
export declare const enum OpcodeContextField {
    currentProgram = 0,
    ptr = 1,
    commandPtr = 2,
    currentFrame = 3,
    currentFrameStack = 4,
    evalResult = 5,
    returnsExternal = 6,
    returnValue = 7,
    stack = 8,
    functionRedirects = 9,
    read = 10,
    peak = 11,
    popCurrentFrameStack = 12,
    pushCurrentFrameStack = 13,
    getDebugCallback = 14,
    setScopeDebugPtr = 15,
    rethrowNativeErrorInRealm = 16,
    hasBinding = 17,
    getVariableFlag = 18,
    setVariableFlag = 19,
    readBindingValue = 20,
    writeBindingValue = 21,
    getBindingValueChecked = 22,
    setBindingValueChecked = 23,
    clearBindingTDZ = 24,
    freezeBinding = 25,
    defineVariable = 26,
    initializeBindingValue = 27,
    createWithScope = 28,
    createIdentifierReference = 29,
    deleteBinding = 30,
    writeScopeDebugProperty = 31,
    getStaticVariableScope = 32,
    getStaticVariableStoreAt = 33,
    getStaticVariableValue = 34,
    getStaticVariableValueChecked = 35,
    setStaticVariableValue = 36,
    setStaticVariableValueChecked = 37,
    createArgumentObject = 38,
    defineFunction = 39,
    createGeneratorFromExecution = 40,
    createAsyncGeneratorFromExecution = 41,
    bindInternal = 42,
    emulateEval = 43,
    emulateFunctionConstructor = 44,
    findScope = 45,
    getValue = 46,
    setValue = 47,
    executeReturn = 48,
    executeThrow = 49,
    executeBreak = 50,
    initiateReturn = 51,
    initiateThrow = 52,
    initiateBreak = 53
}
export interface RuntimeOpcodeContext {
    [OpcodeContextField.currentProgram]: number[];
    [OpcodeContextField.ptr]: number;
    [OpcodeContextField.commandPtr]: number;
    [OpcodeContextField.currentFrame]: Frame;
    [OpcodeContextField.currentFrameStack]: any[];
    [OpcodeContextField.evalResult]: unknown;
    [OpcodeContextField.returnsExternal]: boolean;
    [OpcodeContextField.returnValue]: unknown;
    readonly [OpcodeContextField.stack]: Stack;
    readonly [OpcodeContextField.functionRedirects]: WeakMap<Function, Function>;
    [OpcodeContextField.read](): number;
    [OpcodeContextField.peak]<T>(arr: T[], offset?: number): T;
    [OpcodeContextField.popCurrentFrameStack]<T = unknown>(): T;
    [OpcodeContextField.pushCurrentFrameStack](arg: any): number;
    [OpcodeContextField.getDebugCallback](): null | DebugCallback;
    [OpcodeContextField.setScopeDebugPtr](scopePtr: number, scope: Scope): void;
    [OpcodeContextField.rethrowNativeErrorInRealm](error: unknown, vmGlobal: any): never;
    [OpcodeContextField.hasBinding](scope: Scope, name: string): boolean;
    [OpcodeContextField.getVariableFlag](scope: Scope, name: string): number | undefined;
    [OpcodeContextField.setVariableFlag](scope: Scope, name: string, flags: number): void;
    [OpcodeContextField.readBindingValue](scope: Scope, name: string): any;
    [OpcodeContextField.writeBindingValue](scope: Scope, name: string, value: any): any;
    [OpcodeContextField.getBindingValueChecked](scope: Scope, name: string): any;
    [OpcodeContextField.setBindingValueChecked](scope: Scope, name: string, value: any): any;
    [OpcodeContextField.clearBindingTDZ](scope: Scope, name: string): void;
    [OpcodeContextField.freezeBinding](scope: Scope, name: string): void;
    [OpcodeContextField.defineVariable](scope: Scope, name: string, type: VariableType, trackStaticSlot?: boolean): void;
    [OpcodeContextField.initializeBindingValue](scope: Scope, name: string, value: any): any;
    [OpcodeContextField.createWithScope](value: unknown): Scope;
    [OpcodeContextField.createIdentifierReference](frame: Frame, scope: Scope | null): IdentifierReference;
    [OpcodeContextField.deleteBinding](scope: Scope, name: string): boolean;
    [OpcodeContextField.writeScopeDebugProperty](scope: Scope, name: string, value: any): any;
    [OpcodeContextField.getStaticVariableScope](frame: Frame, depth: number): Scope;
    [OpcodeContextField.getStaticVariableStoreAt](scope: Scope): StaticVariableStore;
    [OpcodeContextField.getStaticVariableValue](frame: Frame, depth: number, index: number): any;
    [OpcodeContextField.getStaticVariableValueChecked](frame: Frame, depth: number, index: number): any;
    [OpcodeContextField.setStaticVariableValue](frame: Frame, depth: number, index: number, value: any): any;
    [OpcodeContextField.setStaticVariableValueChecked](frame: Frame, depth: number, index: number, value: any): any;
    [OpcodeContextField.createArgumentObject](): Record<string, any>;
    [OpcodeContextField.defineFunction](globalThis: any, scopes: Scope[], name: PropertyKey, type: FunctionTypes, offset: number, bodyOffset: number): any;
    [OpcodeContextField.createGeneratorFromExecution](program: number[], offset: number, bodyOffset: number, globalThis: object, scopes: Scope[], invokeData: any, args: unknown[]): IterableIterator<unknown> & {
        return(value?: unknown): IteratorResult<unknown>;
        throw(error?: unknown): IteratorResult<unknown>;
    };
    [OpcodeContextField.createAsyncGeneratorFromExecution](program: number[], offset: number, bodyOffset: number, globalThis: object, scopes: Scope[], invokeData: any, args: unknown[]): AsyncIterableIterator<unknown> & {
        return(value?: unknown): Promise<IteratorResult<unknown>>;
        throw(error?: unknown): Promise<IteratorResult<unknown>>;
    };
    [OpcodeContextField.bindInternal](fn: any, self: any, args: any[]): any;
    [OpcodeContextField.emulateEval](value: unknown, includesLocalScope: boolean): any;
    [OpcodeContextField.emulateFunctionConstructor](parameterValues: any[]): any;
    [OpcodeContextField.findScope](ctx: Frame, name: string): Scope | null;
    [OpcodeContextField.getValue](ctx: any, name: PropertyKey): any;
    [OpcodeContextField.setValue](ctx: any, name: PropertyKey, value: any): any;
    [OpcodeContextField.executeReturn](value: any): any;
    [OpcodeContextField.executeThrow](value: any): any;
    [OpcodeContextField.executeBreak](): void;
    [OpcodeContextField.initiateReturn](): void;
    [OpcodeContextField.initiateThrow](): void;
    [OpcodeContextField.initiateBreak](): void;
}
export type VariableRecordList = VariableRecord[];
export type RuntimeExecution = Execution;
