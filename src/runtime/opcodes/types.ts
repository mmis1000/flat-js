import type { FunctionTypes, VariableType } from "../../compiler"
import type {
    Execution,
    Frame,
    Result,
    Scope,
    Stack,
    StaticVariableStore,
    VariableRecord,
} from "../shared"

export const BREAK_COMMAND = Symbol()

export type OpcodeHandlerResult = Result | typeof BREAK_COMMAND | void

export const enum OpcodeContextField {
    currentProgram,
    ptr,
    commandPtr,
    currentFrame,
    currentFrameStack,
    evalResult,
    returnsExternal,
    returnValue,
    stack,
    functionRedirects,
    read,
    peak,
    popCurrentFrameStack,
    pushCurrentFrameStack,
    getDebugCallback,
    setScopeDebugPtr,
    rethrowNativeErrorInRealm,
    hasBinding,
    getVariableFlag,
    setVariableFlag,
    readBindingValue,
    writeBindingValue,
    getBindingValueChecked,
    setBindingValueChecked,
    clearBindingTDZ,
    freezeBinding,
    defineVariable,
    initializeBindingValue,
    writeScopeDebugProperty,
    getStaticVariableScope,
    getStaticVariableStoreAt,
    getStaticVariableValue,
    getStaticVariableValueChecked,
    setStaticVariableValue,
    setStaticVariableValueChecked,
    createArgumentObject,
    defineFunction,
    createGeneratorFromExecution,
    bindInternal,
    emulateEval,
    emulateFunctionConstructor,
    findScope,
    getValue,
    setValue,
    executeReturn,
    executeThrow,
    executeBreak,
    initiateReturn,
    initiateThrow,
    initiateBreak,
}

export interface RuntimeOpcodeContext {
    [OpcodeContextField.currentProgram]: number[]
    [OpcodeContextField.ptr]: number
    [OpcodeContextField.commandPtr]: number
    [OpcodeContextField.currentFrame]: Frame
    [OpcodeContextField.currentFrameStack]: any[]
    [OpcodeContextField.evalResult]: unknown
    [OpcodeContextField.returnsExternal]: boolean
    [OpcodeContextField.returnValue]: unknown
    readonly [OpcodeContextField.stack]: Stack
    readonly [OpcodeContextField.functionRedirects]: WeakMap<Function, Function>

    [OpcodeContextField.read](): number
    [OpcodeContextField.peak]<T>(arr: T[], offset?: number): T
    [OpcodeContextField.popCurrentFrameStack]<T = unknown>(): T
    [OpcodeContextField.pushCurrentFrameStack](arg: any): number
    [OpcodeContextField.getDebugCallback](): null | (() => void)

    [OpcodeContextField.setScopeDebugPtr](scopePtr: number, scope: Scope): void
    [OpcodeContextField.rethrowNativeErrorInRealm](error: unknown, vmGlobal: any): never

    [OpcodeContextField.hasBinding](scope: Scope, name: string): boolean
    [OpcodeContextField.getVariableFlag](scope: Scope, name: string): number | undefined
    [OpcodeContextField.setVariableFlag](scope: Scope, name: string, flags: number): void
    [OpcodeContextField.readBindingValue](scope: Scope, name: string): any
    [OpcodeContextField.writeBindingValue](scope: Scope, name: string, value: any): any
    [OpcodeContextField.getBindingValueChecked](scope: Scope, name: string): any
    [OpcodeContextField.setBindingValueChecked](scope: Scope, name: string, value: any): any
    [OpcodeContextField.clearBindingTDZ](scope: Scope, name: string): void
    [OpcodeContextField.freezeBinding](scope: Scope, name: string): void
    [OpcodeContextField.defineVariable](scope: Scope, name: string, type: VariableType, trackStaticSlot?: boolean): void
    [OpcodeContextField.initializeBindingValue](scope: Scope, name: string, value: any): any
    [OpcodeContextField.writeScopeDebugProperty](scope: Scope, name: string, value: any): any

    [OpcodeContextField.getStaticVariableScope](frame: Frame, depth: number): Scope
    [OpcodeContextField.getStaticVariableStoreAt](scope: Scope): StaticVariableStore
    [OpcodeContextField.getStaticVariableValue](frame: Frame, depth: number, index: number): any
    [OpcodeContextField.getStaticVariableValueChecked](frame: Frame, depth: number, index: number): any
    [OpcodeContextField.setStaticVariableValue](frame: Frame, depth: number, index: number, value: any): any
    [OpcodeContextField.setStaticVariableValueChecked](frame: Frame, depth: number, index: number, value: any): any

    [OpcodeContextField.createArgumentObject](): Record<string, any>
    [OpcodeContextField.defineFunction](globalThis: any, scopes: Scope[], name: string, type: FunctionTypes, offset: number): any
    [OpcodeContextField.createGeneratorFromExecution](
        program: number[],
        offset: number,
        globalThis: object,
        scopes: Scope[],
        invokeData: any,
        args: unknown[]
    ): IterableIterator<unknown> & {
        return(value?: unknown): IteratorResult<unknown>
        throw(error?: unknown): IteratorResult<unknown>
    }
    [OpcodeContextField.bindInternal](fn: any, self: any, args: any[]): any
    [OpcodeContextField.emulateEval](str: string, includesLocalScope: boolean): any
    [OpcodeContextField.emulateFunctionConstructor](parameterValues: any[]): any

    [OpcodeContextField.findScope](ctx: Frame, name: string): Scope | null
    [OpcodeContextField.getValue](ctx: any, name: string): any
    [OpcodeContextField.setValue](ctx: any, name: string, value: any): any

    [OpcodeContextField.executeReturn](value: any): any
    [OpcodeContextField.executeThrow](value: any): any
    [OpcodeContextField.executeBreak](): void
    [OpcodeContextField.initiateReturn](): void
    [OpcodeContextField.initiateThrow](): void
    [OpcodeContextField.initiateBreak](): void
}

export type VariableRecordList = VariableRecord[]
export type RuntimeExecution = Execution
