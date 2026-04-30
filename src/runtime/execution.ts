import { FunctionTypes, InvokeType, OpCode, ResolveType, SpecialVariable, TryCatchFinallyState, VariableType } from "../compiler"
import {
    bindInfo,
    environments,
    Execution,
    Fields,
    Frame,
    FrameType,
    FunctionFrame,
    functionDescriptors,
    FunctionDescriptor,
    formatFunctionName,
    generatorStates,
    GeneratorState,
    getEmptyObject,
    InvokeParam,
    isAsyncGeneratorType,
    isAsyncType,
    is_a_constant,
    isGeneratorType,
    is_not_defined,
    isIteratorYieldDone,
    isResultDone,
    isResultYield,
    Result,
    ResultAwait,
    ResultDone,
    Scope,
    ScopeWithInternals,
    StaticVariableStore,
    SCOPE_DEBUG_PTR,
    SCOPE_FLAGS,
    SCOPE_STATIC_SLOTS,
    SCOPE_STATIC_STORE,
    SCOPE_WITH_OBJECT,
    Stack,
    TDZ_VALUE,
    TryFrame,
    IDENTIFIER_REFERENCE_FRAME,
    IDENTIFIER_REFERENCE_SCOPE,
    IdentifierReference,
    VariableFlags,
    toPropertyKey,
} from "./shared"
import { handleBasicOpcode } from "./opcodes/basic"
import { handleClassOpcode } from "./opcodes/class"
import { handleControlOpcode } from "./opcodes/control"
import { handleFunctionOpcode } from "./opcodes/function"
import { handleGeneratorOpcode } from "./opcodes/generator"
import { BREAK_COMMAND, OpcodeContextField, type DebugCallback, type RuntimeOpcodeContext } from "./opcodes/types"
import { handleValueOpcode } from "./opcodes/value"

export const getExecution = (
    program: number[],
    entryPoint: number = 0,
    globalThis: object,
    scopes: Scope[] = [],
    invokeData: InvokeParam = {
        [Fields.type]: InvokeType.Apply,
        [Fields.function]: undefined,
        [Fields.name]: '',
        [Fields.self]: undefined
    },
    args: any[] = [],
    getDebugFunction: () => null | DebugCallback = () => null,
    compileFunction: typeof import('../compiler').compile = (...args: any[]) => { throw new Error('not supported') },
    functionRedirects: WeakMap<Function, Function> = new WeakMap(),
    variableEnvironmentScope: Scope | null = null
) => {
    let currentProgram = program

    const initialFrame: Frame = {
        [Fields.type]: FrameType.Function,
        [Fields.scopes]: scopes,
        [Fields.valueStack]: [
            // @ts-expect-error
            invokeData[Fields.type] === InvokeType.Apply ? invokeData[Fields.self] : invokeData[Fields.newTarget],
            invokeData[Fields.function],
            invokeData[Fields.name],
            invokeData[Fields.type],
            ...args,
            args.length
        ],
        [Fields.invokeType]: invokeData[Fields.type],
        [Fields.function]: invokeData[Fields.function],
        [Fields.name]: invokeData[Fields.name],
        [Fields.return]: -1,
        [Fields.programSection]: currentProgram,
        [Fields.globalThis]: globalThis,
        [Fields.strict]: false,
        [Fields.variableEnvironment]: variableEnvironmentScope,
    }

    environments.add(initialFrame)

    const stack: Stack = [initialFrame]
    let ptr: number = entryPoint

    const read = () => currentProgram[ptr++]
    const getCurrentFrame = () => stack[stack.length - 1]
    const peak = <T>(arr: T[], offset = 1): T => arr[arr.length - offset]
    const setScopeDebugPtr = (scopePtr: number, scope: Scope) => {
        getScopeInternal(scope)[SCOPE_DEBUG_PTR] = scopePtr
    }

    /** Native/runtime errors originate in the host realm; remap built-ins before user code observes them. */
    const remapErrorToRealm = (e: unknown, vmGlobal: any) => {
        if (e === null || typeof e !== 'object') return e
        const ctor = (e as any).constructor
        if (typeof ctor !== 'function') return e
        const ctorName = ctor.name
        if (!ctorName) return e
        const hostCtor = (globalThis as any)[ctorName]
        if (typeof hostCtor !== 'function' || ctor !== hostCtor) {
            return e
        }
        const local = vmGlobal?.[ctorName]
        if (typeof local === 'function' && ctor !== local) {
            const msg = Reflect.get(e, 'message')
            return new local(typeof msg === 'string' ? msg : '')
        }
        return e
    }

    /** Native property ops run in the host realm; VM bytecode compares errors to vmGlobal's constructors (e.g. test262 eshost). */
    const rethrowNativeErrorInRealm = (e: unknown, vmGlobal: any): never => {
        throw remapErrorToRealm(e, vmGlobal)
    }

    const getScopeInternal = (scope: Scope) => scope as ScopeWithInternals
    const isWithScope = (scope: Scope) => getScopeInternal(scope)[SCOPE_WITH_OBJECT] !== undefined
    const getWithScopeObject = (scope: Scope) => getScopeInternal(scope)[SCOPE_WITH_OBJECT]!
    const isObjectLike = (value: unknown): value is object => (typeof value === 'object' && value !== null) || typeof value === 'function'
    const isIdentifierReference = (value: unknown): value is IdentifierReference =>
        isObjectLike(value)
        && IDENTIFIER_REFERENCE_FRAME in value
        && IDENTIFIER_REFERENCE_SCOPE in value
    const createIdentifierReference = (frame: Frame, scope: Scope | null): IdentifierReference => ({
        [IDENTIFIER_REFERENCE_FRAME]: frame,
        [IDENTIFIER_REFERENCE_SCOPE]: scope,
    } as IdentifierReference)
    const isEnvironmentScopeObject = (value: unknown): value is Scope => {
        if (!isObjectLike(value) || environments.has(value) || isIdentifierReference(value)) {
            return false
        }

        const internal = getScopeInternal(value as Scope)
        return internal[SCOPE_WITH_OBJECT] !== undefined
            || internal[SCOPE_FLAGS] !== undefined
            || internal[SCOPE_STATIC_SLOTS] !== undefined
            || internal[SCOPE_STATIC_STORE] !== undefined
    }
    const isSpecialVariableName = (name: string) =>
        name === SpecialVariable.This
        || name === SpecialVariable.NewTarget
        || name === SpecialVariable.Super
        || name === SpecialVariable.SwitchValue
        || name === SpecialVariable.LoopIterator
        || name === SpecialVariable.IteratorEntry
    const createWithScope = (value: unknown): Scope => {
        if (value == null) {
            throw new TypeError('Cannot convert undefined or null to object')
        }

        const scope = getEmptyObject() as ScopeWithInternals
        scope[SCOPE_WITH_OBJECT] = Object(value)
        return scope
    }

    const getVariableFlagMap = (scope: Scope) => {
        const internal = getScopeInternal(scope)
        let map = internal[SCOPE_FLAGS]
        if (!map) {
            map = Object.create(null) as Record<string, number>
            internal[SCOPE_FLAGS] = map
        }
        return map
    }

    const getStaticVariableSlotMap = (scope: Scope) => {
        const internal = getScopeInternal(scope)
        let map = internal[SCOPE_STATIC_SLOTS]
        if (!map) {
            map = Object.create(null) as Record<string, number>
            internal[SCOPE_STATIC_SLOTS] = map
        }
        return map
    }

    const getStaticVariableStore = (scope: Scope) => {
        const internal = getScopeInternal(scope)
        let store = internal[SCOPE_STATIC_STORE]
        if (!store) {
            store = { [Fields.names]: [], [Fields.flags]: [], [Fields.values]: [] }
            internal[SCOPE_STATIC_STORE] = store
        }
        return store
    }

    const getVariableFlag = (scope: Scope, name: string) =>
        isWithScope(scope) ? undefined : getScopeInternal(scope)[SCOPE_FLAGS]?.[name]

    const setVariableFlag = (scope: Scope, name: string, flags: number) => {
        getVariableFlagMap(scope)[name] = flags
        const slotIndex = getScopeInternal(scope)[SCOPE_STATIC_SLOTS]?.[name]
        if (slotIndex !== undefined) {
            getStaticVariableStore(scope)[Fields.flags][slotIndex] = flags
        }
    }

    const hasBinding = (scope: Scope, name: string) => {
        if (isWithScope(scope)) {
            if (isSpecialVariableName(name)) {
                return false
            }

            const object = getWithScopeObject(scope) as Record<string, any>
            if (!Reflect.has(object, name)) {
                return false
            }

            const unscopables = (object as any)[Symbol.unscopables]
            if (isObjectLike(unscopables) && Boolean((unscopables as any)[name])) {
                return false
            }

            return true
        }

        return getScopeInternal(scope)[SCOPE_FLAGS]?.[name] !== undefined || name in scope
    }

    const readBindingValue = (scope: Scope, name: string) => {
        if (isWithScope(scope)) {
            return (getWithScopeObject(scope) as Record<string, any>)[name]
        }

        const slotIndex = getScopeInternal(scope)[SCOPE_STATIC_SLOTS]?.[name]
        if (slotIndex !== undefined) {
            return getStaticVariableStore(scope)[Fields.values][slotIndex]
        }
        return scope[name]
    }

    const writeBindingValue = (scope: Scope, name: string, value: any) => {
        if (isWithScope(scope)) {
            const success = Reflect.set(getWithScopeObject(scope), name, value)
            if (!success && currentFrame[Fields.strict]) {
                throw new TypeError(`Cannot assign to read only property '${name}'`)
            }
            return value
        }

        const success = Reflect.set(scope, name, value)
        if (!success && currentFrame[Fields.strict]) {
            throw new TypeError(`Cannot assign to read only property '${name}'`)
        }
        const slotIndex = getScopeInternal(scope)[SCOPE_STATIC_SLOTS]?.[name]
        if (success && slotIndex !== undefined) {
            getStaticVariableStore(scope)[Fields.values][slotIndex] = value
        }
        return value
    }

    const writeScopeDebugProperty = (scope: Scope, name: string, value: any) => {
        scope[name] = value
        return value
    }

    const getBindingValueChecked = (scope: Scope, name: string) => {
        if (isWithScope(scope)) {
            const object = getWithScopeObject(scope)
            if (!Reflect.has(object, name)) {
                if (currentFrame[Fields.strict]) {
                    throw new ReferenceError(name + is_not_defined)
                }
                return undefined
            }
        }

        const value = readBindingValue(scope, name)
        if (value === TDZ_VALUE) {
            throw new ReferenceError(`Cannot access '${name}' before initialization`)
        }
        return value
    }

    const setBindingValueChecked = (scope: Scope, name: string, value: any) => {
        if (isWithScope(scope)) {
            const object = getWithScopeObject(scope)
            if (!Reflect.has(object, name) && currentFrame[Fields.strict]) {
                throw new ReferenceError(name + is_not_defined)
            }
            return writeBindingValue(scope, name, value)
        }

        if (readBindingValue(scope, name) === TDZ_VALUE) {
            throw new ReferenceError(`Cannot access '${name}' before initialization`)
        }
        if ((getVariableFlag(scope, name) ?? VariableFlags.None) & VariableFlags.Immutable) {
            throw new TypeError(name + is_a_constant)
        }
        return writeBindingValue(scope, name, value)
    }

    const initializeBindingValue = (scope: Scope, name: string, value: any) => {
        return writeBindingValue(scope, name, value)
    }

    const clearBindingTDZ = (scope: Scope, name: string) => {
        if (isWithScope(scope)) {
            return
        }
        if (readBindingValue(scope, name) === TDZ_VALUE) {
            writeBindingValue(scope, name, undefined)
        }
    }

    const freezeBinding = (scope: Scope, name: string) => {
        if (isWithScope(scope)) {
            return
        }
        setVariableFlag(scope, name, (getVariableFlag(scope, name) ?? VariableFlags.None) | VariableFlags.Immutable)
    }

    const deleteBinding = (scope: Scope, name: string) => {
        if (isWithScope(scope)) {
            return Reflect.deleteProperty(getWithScopeObject(scope), name)
        }
        if (scope === currentFrame[Fields.globalThis] && getVariableFlag(scope, name) === undefined) {
            return Reflect.deleteProperty(scope, name)
        }
        return false
    }

    const defineVariableInternal = (scope: Scope, name: string, tdz: boolean, immutable: boolean, trackStaticSlot: boolean, configurable: boolean) => {
        const initialValue = tdz ? TDZ_VALUE : undefined
        const flags = immutable ? VariableFlags.Immutable : VariableFlags.None

        getVariableFlagMap(scope)[name] = flags
        let store: StaticVariableStore | null = null
        let slotIndex: number | null = null
        if (trackStaticSlot) {
            const slotMap = getStaticVariableSlotMap(scope)
            store = getStaticVariableStore(scope)
            slotIndex = store[Fields.values].length
            slotMap[name] = slotIndex
            store[Fields.names].push(name)
            store[Fields.flags].push(flags)
            store[Fields.values].push(initialValue)
        }

        const defined = Reflect.defineProperty(scope, name, {
            configurable,
            enumerable: scope === currentFrame[Fields.globalThis],
            writable: true,
            value: initialValue
        })
        if (!defined && store !== null && slotIndex !== null) {
            store[Fields.values][slotIndex] = scope[name]
        }
    }

    const defineVariable = (scope: Scope, name: string, type: VariableType, trackStaticSlot: boolean = true) => {
        const configurable = !(scope === currentFrame[Fields.globalThis] && (
            type === VariableType.Var ||
            type === VariableType.Function
        ))

        switch (type) {
            case VariableType.Const:
                // seal it later
                return defineVariableInternal(scope, name, true, false, trackStaticSlot, configurable)
            case VariableType.Let:
                return defineVariableInternal(scope, name, true, false, trackStaticSlot, configurable)
            case VariableType.Function:
            case VariableType.Parameter:
            case VariableType.Var:
                //don't have tdz
                return defineVariableInternal(scope, name, false, false, trackStaticSlot, configurable)
        }
    }
    const getStaticVariableScope = (frame: Frame, depth: number) =>
        frame[Fields.scopes][frame[Fields.scopes].length - 1 - depth]!

    const getStaticVariableStoreAt = (scope: Scope) =>
        getScopeInternal(scope)[SCOPE_STATIC_STORE]!

    const getStaticVariableValue = (frame: Frame, depth: number, index: number) => {
        const scope = getStaticVariableScope(frame, depth)
        const store = getStaticVariableStoreAt(scope)
        return store[Fields.values][index]
    }

    const getStaticVariableValueChecked = (frame: Frame, depth: number, index: number) => {
        const value = getStaticVariableValue(frame, depth, index)
        if (value === TDZ_VALUE) {
            throw new ReferenceError('Cannot access lexical binding before initialization')
        }
        return value
    }

    const setStaticVariableValue = (frame: Frame, depth: number, index: number, value: any) => {
        const scope = getStaticVariableScope(frame, depth)
        const store = getStaticVariableStoreAt(scope)
        store[Fields.values][index] = value
        scope[store[Fields.names][index]] = value
        return value
    }

    const setStaticVariableValueChecked = (frame: Frame, depth: number, index: number, value: any) => {
        const scope = getStaticVariableScope(frame, depth)
        const store = getStaticVariableStoreAt(scope)
        if (store[Fields.values][index] === TDZ_VALUE) {
            throw new ReferenceError('Cannot access lexical binding before initialization')
        }
        if (store[Fields.flags][index] & VariableFlags.Immutable) {
            throw new TypeError(is_a_constant)
        }
        store[Fields.values][index] = value
        scope[store[Fields.names][index]] = value
        return value
    }

    const MyArgument: { new(): {} } = function MyArgument () {} as any

    const createArgumentObject = () => {
        const obj = new MyArgument()
        Reflect.setPrototypeOf(obj, Object.prototype)
        return obj
    }
    const runUntilAwait = (execution: Execution): ResultDone | ResultAwait => {
        let res: Result
        do {
            res = execution[Fields.step]()
        } while (!res[Fields.done] && !res[Fields.await])
        return res as ResultDone | ResultAwait
    }

    const runUntilYieldOrDone = (execution: Execution): Result => {
        let res: Result
        do {
            res = execution[Fields.step]()
            if (!res[Fields.done] && res[Fields.await]) {
                throw new Error('Unhandled async suspension in generator')
            }
        } while (!res[Fields.done] && !res[Fields.yield])
        return res
    }

    const createGeneratorFromExecution = (
        pr: number[], offset: number, bodyOffset: number, gt: object,
        scopes: Scope[], invokeData: InvokeParam, args: unknown[]
    ): IterableIterator<unknown> & { return(value?: unknown): IteratorResult<unknown>; throw(error?: unknown): IteratorResult<unknown> } => {
        // Build an initial frame via a throwaway execution; do NOT run it. The generator
        // always executes inside the caller's VM via handover (OpCode.Call & OpCode.Yield).
        const scratchExecution: Execution = getExecution(pr, offset, gt, scopes, invokeData, args, getDebugFunction, compileFunction, functionRedirects)
        const hasNestedFunctionFrame = () => scratchExecution[Fields.stack].some(
            (frame, index) => index > 0 && frame[Fields.type] === FrameType.Function
        )
        while (
            scratchExecution[Fields.stack].length > 0
            && (
                hasNestedFunctionFrame()
                || scratchExecution[Fields.ptr] !== bodyOffset
            )
        ) {
            const res = scratchExecution[Fields.step]()
            if (res[Fields.done] || res[Fields.yield] || res[Fields.await]) {
                throw new Error('generator prologue suspended unexpectedly')
            }
        }

        const baseFrames: Stack = scratchExecution[Fields.stack].slice()

        const state: GeneratorState = {
            [Fields.stack]: baseFrames,
            [Fields.ptr]: bodyOffset,
            [Fields.completed]: false,
            [Fields.started]: false,
            [Fields.pendingAction]: null,
            [Fields.baseFrame]: baseFrames[0],
            [Fields.gen]: null,
            [Fields.execution]: scratchExecution
        }

        for (const f of baseFrames) {
            f[Fields.generator] = state
        }

        const runHost = (
            method: 'next' | 'throw' | 'return',
            val?: unknown
        ): IteratorResult<unknown> => {
            const exec = state[Fields.execution]
            const stk = exec[Fields.stack]

            if (!state[Fields.started]) {
                if (method === 'throw') {
                    state[Fields.completed] = true
                    state[Fields.stack] = []
                    throw val
                }
                if (method === 'return') {
                    state[Fields.completed] = true
                    state[Fields.stack] = []
                    return { value: val, done: true }
                }
            }

            if (method === 'throw') {
                state[Fields.pendingAction] = { [Fields.type]: 'throw', [Fields.value]: val }
            } else if (method === 'return') {
                state[Fields.pendingAction] = { [Fields.type]: 'return', [Fields.value]: val }
            } else {
                state[Fields.pendingAction] = null
            }

            stk.length = 0
            stk.push(...state[Fields.stack])
            exec[Fields.ptr] = state[Fields.ptr]

            const wasStarted = state[Fields.started]
            state[Fields.started] = true

            if (wasStarted && method === 'next') {
                exec[Fields.pushValue](val)
            }

            const res = runUntilYieldOrDone(exec)

            if (isResultYield(res)) {
                return { value: res[Fields.value], done: false }
            }
            if (isResultDone(res)) {
                state[Fields.completed] = true
                state[Fields.stack] = []
                const out = res[Fields.value]
                if (isIteratorYieldDone(out)) {
                    return { value: out.value, done: out.done }
                }
                return { value: out, done: true }
            }
            return { value: undefined, done: true }
        }

        const gen: any = {
            next(_value?: unknown): IteratorResult<unknown> {
                if (state[Fields.completed]) return { value: undefined, done: true }
                return runHost('next', _value)
            },
            throw(error?: unknown): IteratorResult<unknown> {
                if (state[Fields.completed]) throw error
                return runHost('throw', error)
            },
            return(value?: unknown): IteratorResult<unknown> {
                if (state[Fields.completed]) return { value, done: true }
                return runHost('return', value)
            },
            [Symbol.iterator]() { return gen }
        }

        state[Fields.gen] = gen

        generatorStates.set(gen.next, state)
        generatorStates.set(gen.throw, state)
        generatorStates.set(gen.return, state)

        return gen
    }

    const createAsyncGeneratorFromExecution = (
        pr: number[], offset: number, bodyOffset: number, gt: object,
        scopes: Scope[], invokeData: InvokeParam, args: unknown[]
    ): AsyncIterableIterator<unknown> & {
        return(value?: unknown): Promise<IteratorResult<unknown>>
        throw(error?: unknown): Promise<IteratorResult<unknown>>
    } => {
        const scratchExecution: Execution = getExecution(pr, offset, gt, scopes, invokeData, args, getDebugFunction, compileFunction, functionRedirects)
        const hasNestedFunctionFrame = () => scratchExecution[Fields.stack].some(
            (frame, index) => index > 0 && frame[Fields.type] === FrameType.Function
        )
        while (
            scratchExecution[Fields.stack].length > 0
            && (
                hasNestedFunctionFrame()
                || scratchExecution[Fields.ptr] !== bodyOffset
            )
        ) {
            const res = scratchExecution[Fields.step]()
            if (res[Fields.done] || res[Fields.yield] || res[Fields.await]) {
                throw new Error('generator prologue suspended unexpectedly')
            }
        }

        const baseFrames: Stack = scratchExecution[Fields.stack].slice()

        const state: GeneratorState = {
            [Fields.stack]: baseFrames,
            [Fields.ptr]: bodyOffset,
            [Fields.completed]: false,
            [Fields.started]: false,
            [Fields.pendingAction]: null,
            [Fields.baseFrame]: baseFrames[0],
            [Fields.gen]: null,
            [Fields.execution]: scratchExecution
        }

        for (const f of baseFrames) {
            f[Fields.generator] = state
        }

        let requestQueue = Promise.resolve()

        const enqueueRequest = (method: 'next' | 'throw' | 'return', value?: unknown): Promise<IteratorResult<unknown>> => {
            const request = requestQueue.then(async () => {
                const exec = state[Fields.execution]
                const stk = exec[Fields.stack]

                if (state[Fields.completed]) {
                    if (method === 'throw') {
                        throw value
                    }
                    if (method === 'return') {
                        return { value, done: true }
                    }
                    return { value: undefined, done: true }
                }

                if (!state[Fields.started]) {
                    if (method === 'throw') {
                        state[Fields.completed] = true
                        state[Fields.stack] = []
                        throw value
                    }
                    if (method === 'return') {
                        state[Fields.completed] = true
                        state[Fields.stack] = []
                        return { value, done: true }
                    }
                }

                if (method === 'throw') {
                    state[Fields.pendingAction] = { [Fields.type]: 'throw', [Fields.value]: value }
                } else if (method === 'return') {
                    state[Fields.pendingAction] = { [Fields.type]: 'return', [Fields.value]: value }
                } else {
                    state[Fields.pendingAction] = null
                }

                stk.length = 0
                stk.push(...state[Fields.stack])
                exec[Fields.ptr] = state[Fields.ptr]

                const wasStarted = state[Fields.started]
                state[Fields.started] = true

                if (wasStarted && method === 'next') {
                    exec[Fields.pushValue](value)
                }

                while (true) {
                    const res = exec[Fields.step]()
                    if (isResultYield(res)) {
                        return { value: res[Fields.value], done: false }
                    }
                    if (isResultDone(res)) {
                        state[Fields.completed] = true
                        state[Fields.stack] = []
                        const out = res[Fields.value]
                        if (isIteratorYieldDone(out)) {
                            return { value: out.value, done: out.done }
                        }
                        return { value: out, done: true }
                    }
                    if (res[Fields.await]) {
                        const awaited = res as ResultAwait
                        try {
                            exec[Fields.pushValue](await Promise.resolve(awaited[Fields.value]))
                        } catch (error) {
                            exec[Fields.setPendingThrow](error)
                        }
                    }
                }
            })

            requestQueue = request.then(() => undefined, () => undefined)
            return request
        }

        const gen: any = {
            next(value?: unknown): Promise<IteratorResult<unknown>> {
                return enqueueRequest('next', value)
            },
            throw(error?: unknown): Promise<IteratorResult<unknown>> {
                return enqueueRequest('throw', error)
            },
            return(value?: unknown): Promise<IteratorResult<unknown>> {
                return enqueueRequest('return', value)
            },
            [Symbol.asyncIterator]() { return gen }
        }

        state[Fields.gen] = gen

        return gen
    }

    const createAsyncFromExecution = (
        pr: number[], offset: number, gt: object,
        scopes: Scope[], invokeData: InvokeParam, args: unknown[]
    ): Promise<unknown> => {
        const execution: Execution = getExecution(pr, offset, gt, scopes, invokeData, args, getDebugFunction, compileFunction, functionRedirects)

        return new Promise<unknown>((resolve, reject) => {
            const continueExecution = (value: unknown, isFirst: boolean) => {
                try {
                    if (!isFirst) {
                        execution[Fields.pushValue](value)
                    }

                    const res = runUntilAwait(execution)

                    if (res[Fields.done]) {
                        resolve(res[Fields.value])
                    } else if (res[Fields.await]) {
                        Promise.resolve(res[Fields.value]).then(
                            (val: unknown) => continueExecution(val, false),
                            (err: unknown) => continueWithThrow(err)
                        )
                    }
                } catch (e) {
                    reject(e)
                }
            }

            const continueWithThrow = (error: unknown) => {
                try {
                    execution[Fields.setPendingThrow](error)
                    const res = runUntilAwait(execution)

                    if (res[Fields.done]) {
                        resolve(res[Fields.value])
                    } else if (res[Fields.await]) {
                        Promise.resolve(res[Fields.value]).then(
                            (val: unknown) => continueExecution(val, false),
                            (err: unknown) => continueWithThrow(err)
                        )
                    }
                } catch (e) {
                    reject(e)
                }
            }

            continueExecution(undefined, true)
        })
    }

    const defineFunction = (globalThis: any, scopes: Scope[], name: PropertyKey, type: FunctionTypes, offset: number, bodyOffset: number) => {
        // TODO: types
        const scopeClone = [...scopes]

        const pr = currentProgram
        const functionName = formatFunctionName(name, type)

        const des: FunctionDescriptor = {
            [Fields.name]: functionName,
            [Fields.type]: type,
            [Fields.offset]: offset,
            [Fields.bodyOffset]: bodyOffset,
            [Fields.scopes]: scopeClone,
            [Fields.programSection]: pr,
            [Fields.globalThis]: globalThis
        }

        const fn = function (this: any, ...args: any[]) {
            const invokeData: InvokeParam = new.target
                ? {
                    [Fields.type]: InvokeType.Construct,
                    [Fields.function]: fn,
                    [Fields.name]: functionName,
                    [Fields.newTarget]: new.target
                }
                : {
                    [Fields.type]: InvokeType.Apply,
                    [Fields.function]: fn,
                    [Fields.name]: functionName,
                    [Fields.self]: this
                }

            if (isAsyncGeneratorType(type)) {
                return createAsyncGeneratorFromExecution(
                    pr, offset, des[Fields.bodyOffset], des[Fields.globalThis],
                    [...scopeClone], invokeData, args
                )
            }

            if (isGeneratorType(type)) {
                return createGeneratorFromExecution(
                    pr, offset, des[Fields.bodyOffset], des[Fields.globalThis],
                    [...scopeClone], invokeData, args
                )
            }

            if (isAsyncType(type)) {
                return createAsyncFromExecution(
                    pr, offset, des[Fields.globalThis],
                    [...scopeClone], invokeData, args
                )
            }

            return run_(
                pr, offset, des[Fields.globalThis],
                [...scopeClone], invokeData, args, getDebugFunction, false, compileFunction, functionRedirects
            )
        }

        Object.defineProperty(fn, 'name', { value: functionName, configurable: true })

        functionDescriptors.set(fn, des)

        return fn
    }

    const bindInternal = (fn: any, self: any, args: any[]) => {
        if (typeof fn !== 'function') {
            return undefined
        }

        const bindFn = function (...additionalArgs: any[]) {
            return Reflect.apply(fn, self, [...args, ...additionalArgs])
        }

        bindInfo.set(bindFn, {
            [Fields.function]: fn,
            [Fields.self]: self,
            [Fields.arguments]: args
        })

        return bindFn
    }

    const findScope = (ctx: Frame, name: string): Scope | null => {
        if (!ctx) {
            return null;
        }
        const scopes = ctx[Fields.scopes]
        for (let i = scopes.length - 1; i >= 0; i--) {
            const scope = scopes[i]
            if (hasBinding(scope, name)) {
                return scope
            }
        }

        const globalScope = ctx[Fields.globalThis]
        if (hasBinding(globalScope, name)) {
            return globalScope
        }

        return null
    }

    const getValue = (ctx: any, name: PropertyKey) => {
        const bindingName = name as string
        if (!environments.has(ctx)) {
            if (isIdentifierReference(ctx)) {
                const scope = ctx[IDENTIFIER_REFERENCE_SCOPE]
                if (scope) {
                    return getBindingValueChecked(scope, bindingName)
                }
                const env = ctx[IDENTIFIER_REFERENCE_FRAME]
                const currentGlobal = env[Fields.globalThis]
                if (name === SpecialVariable.This) {
                    return currentGlobal
                }
                if (name in currentGlobal) {
                    return (currentGlobal as any)[name]
                }
                throw new ReferenceError(String(name) + is_not_defined)
            }
            if (isEnvironmentScopeObject(ctx)) {
                return getBindingValueChecked(ctx, bindingName)
            }
            if (ctx == null) {
                throw new TypeError('Cannot convert undefined or null to object')
            }
            return Reflect.get(Object(ctx), toPropertyKey(name))
        } else {
            const env: Frame = ctx
            const scope = findScope(env, bindingName)

            if (scope) {
                return getBindingValueChecked(scope, bindingName)
            } else {
                const currentGlobal = env[Fields.globalThis]
                if (name === SpecialVariable.This) {
                    return currentGlobal
                } else if (name in currentGlobal) {
                    return (currentGlobal as any)[name]
                } else {
                    throw new ReferenceError(String(name) + is_not_defined)
                }
            }
        }
    }

    const setValue = (ctx: any, name: PropertyKey, value: any) => {
        const bindingName = name as string
        if (!environments.has(ctx)) {
            if (isIdentifierReference(ctx)) {
                const scope = ctx[IDENTIFIER_REFERENCE_SCOPE]
                if (scope) {
                    return setBindingValueChecked(scope, bindingName, value)
                }
                const env = ctx[IDENTIFIER_REFERENCE_FRAME]
                if (env[Fields.strict]) {
                    throw new ReferenceError(String(name) + is_not_defined)
                }
                const currentGlobal = env[Fields.globalThis] as Record<PropertyKey, any>
                currentGlobal[name] = value
                return value
            }
            if (isEnvironmentScopeObject(ctx)) {
                return setBindingValueChecked(ctx, bindingName, value)
            }
            try {
                if (ctx == null) {
                    throw new TypeError('Cannot convert undefined or null to object')
                }
                const propertyKey = toPropertyKey(name)
                const success = Reflect.set(Object(ctx), propertyKey, value)
                if (!success && currentFrame[Fields.strict]) {
                    throw new TypeError(`Cannot assign to read only property '${String(propertyKey)}'`)
                }
                return value
            } catch (e) {
                rethrowNativeErrorInRealm(e, getCurrentFrame()[Fields.globalThis])
            }
        } else {
            const env: Frame = ctx
            const scope = findScope(env, bindingName)

            if (scope) {
                return setBindingValueChecked(scope, bindingName, value)
            } else {
                if (env[Fields.strict]) {
                    throw new ReferenceError(String(name) + is_not_defined)
                }
                const currentGlobal = env[Fields.globalThis] as Record<PropertyKey, any>
                currentGlobal[name] = value
                return value
            }
        }
    }

    let evalResult: any = undefined;

    let commandPtr = 0

    let pendingAction: { [Fields.error]: any } | null = null

    // redirectedFunctions.set(eval, (str: string) => {
    //     str = String(str)

    //     const [programData, textData] = compileFunction(str, { evalMode: true })

    //     const result = run(
    //         programData,
    //         textData,
    //         0,
    //         getCurrentFrame()[Fields.globalThis],
    //         [...getCurrentFrame()[Fields.scopes]]
    //     )

    //     return result
    // })

    const EVAL_FUNCTION = eval

    const emulateEval = (value: unknown, includesLocalScope: boolean) => {
        if (typeof value !== 'string') {
            return value
        }

        const [programData] = compileFunction(value, {
            evalMode: true,
            withStrict: !!currentFrame[Fields.strict],
        })

        const result = run(
            programData,
            0,
            getCurrentFrame()[Fields.globalThis],
            includesLocalScope ? [...getCurrentFrame()[Fields.scopes]] : [],
            undefined,
            [],
            compileFunction,
            functionRedirects,
            getDebugFunction,
            includesLocalScope ? getCurrentFrame()[Fields.variableEnvironment] ?? null : null
        )

        return result
    }

    const emulateFunctionConstructor = (parameterValues: any[]) => {
        const parameterStrings = parameterValues.map((v) => String(v))
        if (parameterStrings.length === 0) {
            parameterStrings.push('')
        }
        const body = parameterStrings[parameterStrings.length - 1]
        const paramNames = parameterStrings.slice(0, -1)
        const src =
            paramNames.length === 0
                ? `(function(){${body}})`
                : `(function(${paramNames.join(',')}){${body}})`
        const [programData] = compileFunction(src, { evalMode: true })
        return run(
            programData,
            0,
            getCurrentFrame()[Fields.globalThis],
            [],
            undefined,
            [],
            compileFunction,
            functionRedirects,
            getDebugFunction
        )
    }

    let returnsExternal = false
    let returnValue: unknown = null
    let currentFrame: Frame = initialFrame
    let currentFrameStack: any[] = initialFrame[Fields.valueStack]

    const addCatchScope = (frame: TryFrame, name: string, value: any) => {
        const newScope: Scope = {}
        defineVariable(newScope, name, VariableType.Var)
        initializeBindingValue(newScope, name, value)
        frame[Fields.scopes].push(newScope)
    }

    const executeReturn = (value: any) => {
        const currentFrame = peak(stack)
        // try to find upper try frame or return (if any and hand control to it)
        switch (currentFrame[Fields.type]) {
            case FrameType.Function: {
                const frame = currentFrame as FunctionFrame

                const genState = frame[Fields.generator] as GeneratorState | undefined
                const isGenBase = !!(genState && genState[Fields.baseFrame] === frame)

                // exit
                const returnAddr = frame[Fields.return]

                if (isGenBase) {
                    genState![Fields.completed] = true
                    genState![Fields.stack] = []
                    stack.pop()
                    if (returnAddr < 0) {
                        returnsExternal = true
                        returnValue = { value, done: true }
                        return value
                    }
                    ptr = returnAddr
                    currentProgram = peak(stack)[Fields.programSection]
                    peak(stack)[Fields.valueStack].push({ value, done: true })
                    return value
                }

                if (returnAddr < 0) {
                    // leave the whole function
                    returnsExternal = true
                    returnValue = value
                    return value
                } else {
                    stack.pop()
                    ptr = returnAddr
                    currentProgram = peak(stack)[Fields.programSection]

                    if (
                        frame[Fields.invokeType] === InvokeType.Apply
                        || (value !== null && typeof value === 'object')
                        || typeof value === 'function'
                    ) {
                        peak(stack)[Fields.valueStack].push(value)
                    } else {
                        peak(stack)[Fields.valueStack].push(getValue(frame, SpecialVariable.This))
                    }
                }
            }
                break
            case FrameType.Try: {
                const frame = currentFrame as TryFrame

                // as if we return on upper try catch
                frame[Fields.valueStack].push(value)
                initiateReturn()
            }
                break
        }
    }

    const initiateReturn = () => {
        const frame = peak(stack) as TryFrame
        const value = frame[Fields.valueStack].pop()
        const finallyAddr = frame[Fields.finally]

        // restore scopes
        frame[Fields.scopes] = frame[Fields.savedScopes].slice(0)

        const state = frame[Fields.state]
        switch (state) {
            case TryCatchFinallyState.Try:
            case TryCatchFinallyState.Catch: {
                if (finallyAddr >= 0) {
                    frame[Fields.state] = TryCatchFinallyState.Finally
                    frame[Fields.resolveType] = ResolveType.return
                    frame[Fields.value] = value
                    ptr = finallyAddr
                } else {
                    stack.pop()
                    executeReturn(value)
                    return
                }
            }
                break;
            case TryCatchFinallyState.Finally: {
                stack.pop()
                executeReturn(value)
                return
            }
                break;
            default:
                const nothing: never = state

        }
    }

    const executeThrow = (value: any) => {
        loop: while (true) {
            if (stack.length === 0) {
                throw value
            }
            const currentFrame = peak(stack)
            switch (currentFrame[Fields.type]) {
                case FrameType.Function: {
                    const fframe = currentFrame as FunctionFrame
                    const gs = fframe[Fields.generator] as GeneratorState | undefined
                    if (gs && gs[Fields.baseFrame] === fframe) {
                        // Error escapes the generator — mark completed and continue
                        // unwinding so it surfaces in the VM caller.
                        gs[Fields.completed] = true
                        gs[Fields.stack] = []
                    }
                    stack.pop()
                }
                    break
                case FrameType.Try: {
                    const frame = currentFrame as TryFrame

                    if (frame[Fields.state] === TryCatchFinallyState.Finally) {
                        stack.pop()
                    } else {

                        // as if we throw on upper try catch
                        currentFrame[Fields.valueStack].push(value)
                        initiateThrow();
                        return
                    }
                }

            }
        }

        throw value
    }

    const initiateThrow = () => {
        const frame = peak(stack) as TryFrame
        const value = frame[Fields.valueStack].pop()
        const exitAddr = frame[Fields.exit]
        const finallyAddr = frame[Fields.finally]
        const catchAddr = frame[Fields.catch]

        // restore scopes
        frame[Fields.scopes] = frame[Fields.savedScopes].slice(0)

        const state = frame[Fields.state]
        switch (state) {
            case TryCatchFinallyState.Try: {
                frame[Fields.resolveType] = ResolveType.throw
                frame[Fields.value] = value

                if (catchAddr >= 0) {
                    frame[Fields.state] = TryCatchFinallyState.Catch
                    if (frame[Fields.variable] !== undefined) {
                        addCatchScope(frame, frame[Fields.variable], value)
                    }

                    ptr = catchAddr
                    currentProgram = frame[Fields.programSection]
                } else if (finallyAddr >= 0) {
                    frame[Fields.state] = TryCatchFinallyState.Finally
                    ptr = finallyAddr
                    currentProgram = frame[Fields.programSection]
                } else {
                    ptr = exitAddr
                    currentProgram = frame[Fields.programSection]
                }
            }
                break;
            case TryCatchFinallyState.Catch: {
                frame[Fields.state] = TryCatchFinallyState.Finally
                frame[Fields.resolveType] = ResolveType.throw
                frame[Fields.value] = value

                if (finallyAddr >= 0) {
                    ptr = finallyAddr
                    currentProgram = frame[Fields.programSection]
                } else {
                    stack.pop()
                    executeThrow(value)
                }
                break
            }

            case TryCatchFinallyState.Finally: {
                stack.pop()
                executeThrow(value)
            }
                break
            default:
                const nothing: never = state
        }
    }

    const executeBreak = () => {
        const frame = stack.pop() as TryFrame
        let depth: number = frame[Fields.depth]
        // stack.pop()

        loop: while (true) {
            depth--
            if (depth < 0) {
                throw new Error('something went wrong')
            } if (depth === 0) {
                // actually break
                // break always happens within the same vm
                ptr = frame[Fields.break]
                break loop
            } else {
                // try to jump to next try catch
                const nextFrame = peak(stack) as TryFrame
                const finallyAddr = nextFrame[Fields.finally]
                if (finallyAddr >= 0) {
                    const state = nextFrame[Fields.state]
                    switch (state) {
                        case TryCatchFinallyState.Try:
                        case TryCatchFinallyState.Catch: {
                            nextFrame[Fields.state] = TryCatchFinallyState.Finally
                            nextFrame[Fields.resolveType] = ResolveType.break
                            nextFrame[Fields.depth] = depth
                            nextFrame[Fields.break] = frame[Fields.break]
                            ptr = finallyAddr
                            break loop
                        }
                    }
                } else {
                    stack.pop()
                }
            }
        }
    }

    const initiateBreak = () => {
        const frame = peak(stack) as TryFrame
        const breakAddr: number = frame[Fields.valueStack].pop()
        const depth: number = frame[Fields.valueStack].pop()
        const finallyAddr = frame[Fields.finally]

        frame[Fields.break] = breakAddr
        frame[Fields.depth] = depth

        // restore scopes
        frame[Fields.scopes] = frame[Fields.savedScopes].slice(0)

        const state = frame[Fields.state]
        switch (state) {
            case TryCatchFinallyState.Try:
            case TryCatchFinallyState.Catch: {
                if (finallyAddr >= 0) {
                    frame[Fields.state] = TryCatchFinallyState.Finally
                    frame[Fields.resolveType] = ResolveType.break
                    // frame[Fields.value] = value
                    ptr = finallyAddr
                    currentProgram = frame[Fields.programSection]
                } else {
                    // stack.pop()
                    executeBreak()
                }
                break
            }

            case TryCatchFinallyState.Finally: {
                // stack.pop()
                executeBreak()
            }
                break
            default:
                const nothing: never = state
        }
    }

    const popCurrentFrameStack = <T = unknown>(): T => {
        return currentFrameStack.pop() as T
    }

    const pushCurrentFrameStack = (arg: any): number => {
        return currentFrameStack.push(arg)
    }

    const opcodeContext = [] as unknown as RuntimeOpcodeContext
    const opcodeContextSlots = opcodeContext as unknown as Record<number, any>

    Object.defineProperties(opcodeContext, {
        [OpcodeContextField.currentProgram]: {
            get: () => currentProgram,
            set: (value: number[]) => {
                currentProgram = value
            }
        },
        [OpcodeContextField.ptr]: {
            get: () => ptr,
            set: (value: number) => {
                ptr = value
            }
        },
        [OpcodeContextField.commandPtr]: {
            get: () => commandPtr,
            set: (value: number) => {
                commandPtr = value
            }
        },
        [OpcodeContextField.currentFrame]: {
            get: () => currentFrame,
            set: (value: Frame) => {
                currentFrame = value
            }
        },
        [OpcodeContextField.currentFrameStack]: {
            get: () => currentFrameStack,
            set: (value: any[]) => {
                currentFrameStack = value
            }
        },
        [OpcodeContextField.evalResult]: {
            get: () => evalResult,
            set: (value: unknown) => {
                evalResult = value
            }
        },
        [OpcodeContextField.returnsExternal]: {
            get: () => returnsExternal,
            set: (value: boolean) => {
                returnsExternal = value
            }
        },
        [OpcodeContextField.returnValue]: {
            get: () => returnValue,
            set: (value: unknown) => {
                returnValue = value
            }
        }
    })

    opcodeContextSlots[OpcodeContextField.stack] = stack
    opcodeContextSlots[OpcodeContextField.functionRedirects] = functionRedirects
    opcodeContextSlots[OpcodeContextField.read] = read
    opcodeContextSlots[OpcodeContextField.peak] = peak
    opcodeContextSlots[OpcodeContextField.popCurrentFrameStack] = popCurrentFrameStack
    opcodeContextSlots[OpcodeContextField.pushCurrentFrameStack] = pushCurrentFrameStack
    opcodeContextSlots[OpcodeContextField.getDebugCallback] = getDebugFunction
    opcodeContextSlots[OpcodeContextField.setScopeDebugPtr] = setScopeDebugPtr
    opcodeContextSlots[OpcodeContextField.rethrowNativeErrorInRealm] = rethrowNativeErrorInRealm
    opcodeContextSlots[OpcodeContextField.hasBinding] = hasBinding
    opcodeContextSlots[OpcodeContextField.getVariableFlag] = getVariableFlag
    opcodeContextSlots[OpcodeContextField.setVariableFlag] = setVariableFlag
    opcodeContextSlots[OpcodeContextField.readBindingValue] = readBindingValue
    opcodeContextSlots[OpcodeContextField.writeBindingValue] = writeBindingValue
    opcodeContextSlots[OpcodeContextField.getBindingValueChecked] = getBindingValueChecked
    opcodeContextSlots[OpcodeContextField.setBindingValueChecked] = setBindingValueChecked
    opcodeContextSlots[OpcodeContextField.clearBindingTDZ] = clearBindingTDZ
    opcodeContextSlots[OpcodeContextField.freezeBinding] = freezeBinding
    opcodeContextSlots[OpcodeContextField.defineVariable] = defineVariable
    opcodeContextSlots[OpcodeContextField.initializeBindingValue] = initializeBindingValue
    opcodeContextSlots[OpcodeContextField.createWithScope] = createWithScope
    opcodeContextSlots[OpcodeContextField.createIdentifierReference] = createIdentifierReference
    opcodeContextSlots[OpcodeContextField.deleteBinding] = deleteBinding
    opcodeContextSlots[OpcodeContextField.writeScopeDebugProperty] = writeScopeDebugProperty
    opcodeContextSlots[OpcodeContextField.getStaticVariableScope] = getStaticVariableScope
    opcodeContextSlots[OpcodeContextField.getStaticVariableStoreAt] = getStaticVariableStoreAt
    opcodeContextSlots[OpcodeContextField.getStaticVariableValue] = getStaticVariableValue
    opcodeContextSlots[OpcodeContextField.getStaticVariableValueChecked] = getStaticVariableValueChecked
    opcodeContextSlots[OpcodeContextField.setStaticVariableValue] = setStaticVariableValue
    opcodeContextSlots[OpcodeContextField.setStaticVariableValueChecked] = setStaticVariableValueChecked
    opcodeContextSlots[OpcodeContextField.createArgumentObject] = createArgumentObject
    opcodeContextSlots[OpcodeContextField.defineFunction] = defineFunction
    opcodeContextSlots[OpcodeContextField.createGeneratorFromExecution] = createGeneratorFromExecution
    opcodeContextSlots[OpcodeContextField.createAsyncGeneratorFromExecution] = createAsyncGeneratorFromExecution
    opcodeContextSlots[OpcodeContextField.bindInternal] = bindInternal
    opcodeContextSlots[OpcodeContextField.emulateEval] = emulateEval
    opcodeContextSlots[OpcodeContextField.emulateFunctionConstructor] = emulateFunctionConstructor
    opcodeContextSlots[OpcodeContextField.findScope] = findScope
    opcodeContextSlots[OpcodeContextField.getValue] = getValue
    opcodeContextSlots[OpcodeContextField.setValue] = setValue
    opcodeContextSlots[OpcodeContextField.executeReturn] = executeReturn
    opcodeContextSlots[OpcodeContextField.executeThrow] = executeThrow
    opcodeContextSlots[OpcodeContextField.executeBreak] = executeBreak
    opcodeContextSlots[OpcodeContextField.initiateReturn] = initiateReturn
    opcodeContextSlots[OpcodeContextField.initiateThrow] = initiateThrow
    opcodeContextSlots[OpcodeContextField.initiateBreak] = initiateBreak

    const step = (debug: boolean = false): Result => {
        if (stack.length > 0) {
            currentProgram = peak(stack)[Fields.programSection]
        }
        if (ptr >= currentProgram.length) {
             return { [Fields.done]: true, [Fields.value]: undefined, [Fields.evalResult]: undefined }
        }
        returnsExternal = false
        returnValue = null

        try {
            // Handle pending actions (from generator .throw())
            if (pendingAction) {
                const action = pendingAction
                pendingAction = null
                throw action[Fields.error]
            }

            // console.log(ptr)
            const currentPtr = commandPtr = ptr
            const command: OpCode = read()
            currentFrame = getCurrentFrame()
            currentFrameStack = currentFrame[Fields.valueStack]

            if (debug && currentFrame[Fields.programSection].length !== currentProgram.length) {
                debugger
            }

            command: switch (command) {
                case OpCode.Literal:
                case OpCode.Pop:
                case OpCode.SetEvalResult:
                case OpCode.Duplicate:
                case OpCode.DuplicateSecond:
                case OpCode.Swap:
                case OpCode.GetRecord:
                case OpCode.GetStatic:
                case OpCode.GetStaticKeepCtx:
                case OpCode.GetStaticUnchecked:
                case OpCode.GetStaticUncheckedKeepCtx:
                case OpCode.NullLiteral:
                case OpCode.UndefinedLiteral:
                case OpCode.RegexpLiteral:
                case OpCode.Set:
                case OpCode.SetKeepCtx:
                case OpCode.SetStatic:
                case OpCode.SetStaticUnchecked:
                case OpCode.SetInitialized:
                case OpCode.SetInitializedStatic:
                case OpCode.BPlusEqual:
                case OpCode.BMinusEqual:
                case OpCode.BSlashEqual:
                case OpCode.BAsteriskEqual:
                case OpCode.BGreaterThanGreaterThanGreaterThanEqual:
                case OpCode.BPlusEqualStatic:
                case OpCode.BMinusEqualStatic:
                case OpCode.BSlashEqualStatic:
                case OpCode.BAsteriskEqualStatic:
                case OpCode.BGreaterThanGreaterThanGreaterThanEqualStatic:
                case OpCode.BPlusEqualStaticUnchecked:
                case OpCode.BMinusEqualStaticUnchecked:
                case OpCode.BSlashEqualStaticUnchecked:
                case OpCode.BAsteriskEqualStaticUnchecked:
                case OpCode.BGreaterThanGreaterThanGreaterThanEqualStaticUnchecked:
                case OpCode.DefineKeepCtx:
                case OpCode.SetPrototypeKeepCtx:
                case OpCode.Get:
                case OpCode.GetKeepCtx:
                case OpCode.ResolveScope:
                case OpCode.ResolveScopeGetValue:
                case OpCode.SetMultiple:
                case OpCode.Jump:
                case OpCode.JumpIfNot:
                case OpCode.JumpIf:
                case OpCode.JumpIfAndKeep:
                case OpCode.JumpIfNotAndKeep:
                case OpCode.EnterScope:
                case OpCode.EnterBodyScope:
                case OpCode.EnterWith:
                case OpCode.LeaveScope:
                case OpCode.DeTDZ:
                case OpCode.DeTDZStatic:
                case OpCode.FreezeVariable:
                case OpCode.FreezeVariableStatic:
                    handleBasicOpcode(command, opcodeContext)
                    break
                case OpCode.EnterFunction:
                case OpCode.DefineFunction:
                case OpCode.ExpandArgumentArray:
                case OpCode.CallValue:
                case OpCode.Call:
                case OpCode.CallResolved:
                case OpCode.CallAsEval:
                case OpCode.CallAsEvalResolved:
                case OpCode.SuperCall:
                case OpCode.New: {
                    const result = handleFunctionOpcode(command, opcodeContext)
                    if (result === BREAK_COMMAND) {
                        break command
                    }
                    if (result !== undefined) {
                        return result
                    }
                }
                    break
                case OpCode.Return:
                case OpCode.Throw:
                case OpCode.ThrowReferenceError:
                case OpCode.InitTryCatch:
                case OpCode.ReturnInTryCatchFinally:
                case OpCode.ThrowInTryCatchFinally:
                case OpCode.BreakInTryCatchFinally:
                case OpCode.ExitTryCatchFinally:
                case OpCode.Debugger:
                case OpCode.Await: {
                    const result = handleControlOpcode(command, opcodeContext)
                    if (result === BREAK_COMMAND) {
                        break command
                    }
                    if (result !== undefined) {
                        return result
                    }
                }
                    break
                case OpCode.ArrayLiteral:
                case OpCode.ArraySpread:
                case OpCode.TemplateObject:
                case OpCode.ObjectLiteral:
                case OpCode.ObjectRest:
                case OpCode.Typeof:
                case OpCode.ToPropertyKey:
                case OpCode.TypeofReference:
                case OpCode.TypeofStaticReference:
                case OpCode.TypeofStaticReferenceUnchecked:
                case OpCode.GetPropertyIterator:
                case OpCode.NextEntry:
                case OpCode.EntryIsDone:
                case OpCode.EntryGetValue:
                case OpCode.InstanceOf:
                case OpCode.BAmpersand:
                case OpCode.BBar:
                case OpCode.BCaret:
                case OpCode.BEqualsEquals:
                case OpCode.BEqualsEqualsEquals:
                case OpCode.BGreaterThan:
                case OpCode.BGreaterThanGreaterThan:
                case OpCode.BGreaterThanGreaterThanGreaterThan:
                case OpCode.BGreaterThanEquals:
                case OpCode.BLessThan:
                case OpCode.BLessThanLessThan:
                case OpCode.BLessThanEquals:
                case OpCode.BExclamationEquals:
                case OpCode.BExclamationEqualsEquals:
                case OpCode.BMinus:
                case OpCode.BPlus:
                case OpCode.BIn:
                case OpCode.BAsterisk:
                case OpCode.BAsteriskAsterisk:
                case OpCode.BSlash:
                case OpCode.BPercent:
                case OpCode.PostFixPlusPLus:
                case OpCode.PostFixMinusMinus:
                case OpCode.PostFixPlusPLusStatic:
                case OpCode.PostFixMinusMinusStatic:
                case OpCode.PostFixPlusPLusStaticUnchecked:
                case OpCode.PostFixMinusMinusStaticUnchecked:
                case OpCode.PrefixUnaryPlus:
                case OpCode.PrefixUnaryMinus:
                case OpCode.PrefixExclamation:
                case OpCode.PrefixTilde:
                case OpCode.PrefixPlusPlus:
                case OpCode.PrefixMinusMinus:
                case OpCode.PrefixPlusPlusStatic:
                case OpCode.PrefixMinusMinusStatic:
                case OpCode.PrefixPlusPlusStaticUnchecked:
                case OpCode.PrefixMinusMinusStaticUnchecked:
                case OpCode.Delete: {
                    const result = handleValueOpcode(command, opcodeContext)
                    if (result === BREAK_COMMAND) {
                        break command
                    }
                    if (result !== undefined) {
                        return result
                    }
                }
                    break
                case OpCode.CreateClass:
                case OpCode.DefineMethod:
                case OpCode.DefineGetter:
                case OpCode.DefineSetter:
                    handleClassOpcode(command, opcodeContext)
                    break
                case OpCode.Yield:
                case OpCode.YieldResume:
                case OpCode.YieldStar: {
                    const result = handleGeneratorOpcode(command, opcodeContext)
                    if (result === BREAK_COMMAND) {
                        break command
                    }
                    if (result !== undefined) {
                        return result
                    }
                }
                    break
                default:
                    type NonRuntimeCommands = OpCode.NodeFunctionType | OpCode.NodeOffset | OpCode.Nop
                    const nothing: NonRuntimeCommands = command
                    throw new Error('Um?')
            }

            if (returnsExternal) {
                return {
                    [Fields.done]: true,
                    [Fields.value]: returnValue,
                    [Fields.evalResult]: evalResult
                }
            }

        } catch (err: any) {
            const vmGlobal = getCurrentFrame()?.[Fields.globalThis] ?? initialFrame[Fields.globalThis]
            err = remapErrorToRealm(err, vmGlobal)
            if (err != null && typeof err === 'object') {
                err.pos = commandPtr
            }
            executeThrow(err)
        }

        if (returnsExternal) {
            return {
                [Fields.done]: true,
                [Fields.value]: returnValue,
                [Fields.evalResult]: evalResult
            }
        }

        return {
            [Fields.done]: false
        }
    }



    return {
        get [Fields.ptr] () {
            return ptr
        },
        set [Fields.ptr] (v: number) {
            commandPtr = v
            ptr = v
        },
        get [Fields.stack] () {
            return stack
        },
        get [Fields.scopes] () {
            return peak(stack)[Fields.scopes]
        },
        [Fields.step]: step,
        [Fields.pushValue](value: unknown) {
            const vs = getCurrentFrame()[Fields.valueStack];
            vs.push(value);
        },
        [Fields.setPendingThrow](error: unknown) {
            pendingAction = { [Fields.error]: error }
        }
    }
}

const run_ = (
    program: number[],
    entryPoint: number,
    globalThis: object,
    scopes: Scope[],
    invokeData: InvokeParam,
    args: any[],
    getDebugFunction: () => null | DebugCallback,
    evalResultInstead = false,
    compileFunction: typeof import('../compiler').compile | undefined = undefined,
    functionRedirects: WeakMap<Function, Function> = new WeakMap(),
    variableEnvironmentScope: Scope | null = null
) => {
    const execution = getExecution(
        program,
        entryPoint,
        globalThis,
        scopes,
        invokeData,
        args,
        getDebugFunction,
        compileFunction,
        functionRedirects,
        variableEnvironmentScope
    )

    let res

    do {
        res = execution[Fields.step]()
        if (!res[Fields.done] && (res[Fields.await] || res[Fields.yield])) {
            throw new Error('Unhandled suspension in sync execution')
        }
    } while (!res[Fields.done])

    if (!evalResultInstead) {
        return (res as any)[Fields.value]
    } else {
        return (res as any)[Fields.evalResult]
    }
}

export const run = (
    program: number[],
    entryPoint: number = 0,
    globalThis: object,
    scopes: Scope[] = [],
    self: undefined = undefined,
    args: any[] = [],
    compileFunction: typeof import('../compiler').compile | undefined = undefined,
    functionRedirects: WeakMap<Function, Function> = new WeakMap(),
    getDebugFunction: () => null | DebugCallback = () => null,
    variableEnvironmentScope: Scope | null = null
) => {
    return run_(
        program,
        entryPoint,
        globalThis,
        scopes,
        {
            [Fields.type]: InvokeType.Apply,
            [Fields.function]: undefined,
            [Fields.name]: '',
            [Fields.self]: self
        },
        args,
        getDebugFunction,
        true,
        compileFunction,
        functionRedirects,
        variableEnvironmentScope
    )
}
