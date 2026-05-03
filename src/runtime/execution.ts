import { FunctionTypes, InvokeType, OpCode, ResolveType, SpecialVariable, TryCatchFinallyState, VariableType } from "../compiler"
import { STATIC_SLOT_NAMELESS } from "../compiler/shared"
import {
    bindInfo,
    BIND,
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
    SUPER_REFERENCE_BASE,
    SUPER_REFERENCE_THIS,
    SuperReference,
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

const HOST_GLOBAL_THIS = globalThis

type GeneratorFunctionIntrinsics = {
    constructor: Function
    functionPrototype: object
    prototype: object
}

type AsyncGeneratorRequestContinuation = {
    then(
        resolve: (result: IteratorResult<unknown>) => void,
        reject: (reason?: unknown) => void
    ): void
}

type AsyncGeneratorRequestResult = IteratorResult<unknown> | AsyncGeneratorRequestContinuation

type AsyncGeneratorQueuedRequest = {
    method: 'next' | 'throw' | 'return'
    value?: unknown
    resolve: (result: IteratorResult<unknown>) => void
    reject: (reason?: unknown) => void
}

const generatorIntrinsicsByFunctionPrototype = new WeakMap<object, {
    generator: GeneratorFunctionIntrinsics
    asyncGenerator: GeneratorFunctionIntrinsics
}>()
const dynamicGeneratorConstructorFactories = new WeakMap<
    Function,
    (asyncGenerator: boolean, newTarget: Function | undefined, args: unknown[]) => Function
>()

const isObjectLikeValue = (value: unknown): value is object =>
    (typeof value === 'object' && value !== null) || typeof value === 'function'

const createGeneratorFunctionIntrinsics = (
    functionPrototype: object,
    objectPrototype: object,
    constructorName: string,
    asyncGenerator: boolean
): GeneratorFunctionIntrinsics => {
    const iteratorPrototype = Object.create(objectPrototype)
    Object.defineProperty(iteratorPrototype, asyncGenerator ? Symbol.asyncIterator : Symbol.iterator, {
        configurable: true,
        writable: true,
        value() { return this },
    })

    const prototype = Object.create(iteratorPrototype)
    const generatorFunctionPrototype = Object.create(functionPrototype)
    Object.defineProperty(generatorFunctionPrototype, 'prototype', {
        configurable: true,
        enumerable: false,
        writable: false,
        value: prototype,
    })
    let generatorFunctionConstructor: Function
    generatorFunctionConstructor = {
        [constructorName]: function (this: unknown, ...args: unknown[]) {
            const factory = dynamicGeneratorConstructorFactories.get(generatorFunctionConstructor)
            if (factory != null) {
                return factory(asyncGenerator, new.target, args)
            }

            const NativeGeneratorFunction = Object.getPrototypeOf(function* () {}).constructor
            const NativeAsyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor
            const nativeCtor = asyncGenerator ? NativeAsyncGeneratorFunction : NativeGeneratorFunction
            return Reflect.construct(nativeCtor, args, new.target ?? generatorFunctionConstructor)
        }
    }[constructorName]
    Object.defineProperty(generatorFunctionConstructor, 'prototype', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: generatorFunctionPrototype,
    })
    Object.defineProperty(generatorFunctionPrototype, 'constructor', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: generatorFunctionConstructor,
    })
    return { constructor: generatorFunctionConstructor, functionPrototype: generatorFunctionPrototype, prototype }
}

const getGeneratorFunctionIntrinsics = (
    globalThis: any,
    asyncGenerator: boolean,
    dynamicFactory?: (asyncGenerator: boolean, newTarget: Function | undefined, args: unknown[]) => Function
): GeneratorFunctionIntrinsics => {
    const functionPrototype = isObjectLikeValue(globalThis?.Function?.prototype)
        ? globalThis.Function.prototype
        : Function.prototype
    const objectPrototype = isObjectLikeValue(globalThis?.Object?.prototype)
        ? globalThis.Object.prototype
        : Object.prototype
    let cached = generatorIntrinsicsByFunctionPrototype.get(functionPrototype)
    if (!cached) {
        cached = {
            generator: createGeneratorFunctionIntrinsics(functionPrototype, objectPrototype, 'GeneratorFunction', false),
            asyncGenerator: createGeneratorFunctionIntrinsics(functionPrototype, objectPrototype, 'AsyncGeneratorFunction', true),
        }
        generatorIntrinsicsByFunctionPrototype.set(functionPrototype, cached)
    }
    if (dynamicFactory != null) {
        dynamicGeneratorConstructorFactories.set(cached.generator.constructor, dynamicFactory)
        dynamicGeneratorConstructorFactories.set(cached.asyncGenerator.constructor, dynamicFactory)
    }
    return asyncGenerator ? cached.asyncGenerator : cached.generator
}

const getGeneratorInstancePrototype = (
    globalThis: any,
    fn: unknown,
    asyncGenerator: boolean
) => {
    if (isObjectLikeValue(fn)) {
        const ownPrototype = Reflect.get(fn, 'prototype')
        if (isObjectLikeValue(ownPrototype)) {
            return ownPrototype
        }

        const functionPrototype = Object.getPrototypeOf(fn)
        const defaultPrototype = isObjectLikeValue(functionPrototype)
            ? Reflect.get(functionPrototype, 'prototype')
            : undefined
        if (isObjectLikeValue(defaultPrototype)) {
            return defaultPrototype
        }
    }

    return getGeneratorFunctionIntrinsics(globalThis, asyncGenerator).prototype
}

const hasOwnPrototype = (functionType: FunctionTypes) => {
    switch (functionType) {
        case FunctionTypes.FunctionDeclaration:
        case FunctionTypes.FunctionExpression:
        case FunctionTypes.Constructor:
        case FunctionTypes.DerivedConstructor:
        case FunctionTypes.GeneratorDeclaration:
        case FunctionTypes.GeneratorExpression:
        case FunctionTypes.GeneratorMethod:
        case FunctionTypes.AsyncGeneratorDeclaration:
        case FunctionTypes.AsyncGeneratorExpression:
        case FunctionTypes.AsyncGeneratorMethod:
            return true
        default:
            return false
    }
}

const usesOrdinaryFunctionWrapper = (functionType: FunctionTypes) =>
    functionType === FunctionTypes.FunctionDeclaration
    || functionType === FunctionTypes.FunctionExpression
    || functionType === FunctionTypes.Constructor
    || functionType === FunctionTypes.DerivedConstructor

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
        const hostCtor = (HOST_GLOBAL_THIS as any)[ctorName]
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
    const hasRuntimeBindingName = (name: string) => name !== STATIC_SLOT_NAMELESS
    const hasMaterializedBindingAlias = (scope: Scope, name: string) =>
        hasRuntimeBindingName(name) && Object.prototype.hasOwnProperty.call(scope, name)
    const shouldMaterializeBindingAlias = (scope: Scope, trackStaticSlot: boolean) =>
        !trackStaticSlot || scope === currentFrame[Fields.globalThis]
    const isWithScope = (scope: Scope) => getScopeInternal(scope)[SCOPE_WITH_OBJECT] !== undefined
    const getWithScopeObject = (scope: Scope) => getScopeInternal(scope)[SCOPE_WITH_OBJECT]!
    const isObjectLike = (value: unknown): value is object => (typeof value === 'object' && value !== null) || typeof value === 'function'
    const isIdentifierReference = (value: unknown): value is IdentifierReference =>
        isObjectLike(value)
        && IDENTIFIER_REFERENCE_FRAME in value
        && IDENTIFIER_REFERENCE_SCOPE in value
    const isSuperReference = (value: unknown): value is SuperReference =>
        isObjectLike(value)
        && SUPER_REFERENCE_BASE in value
        && SUPER_REFERENCE_THIS in value
    const createIdentifierReference = (frame: Frame, scope: Scope | null): IdentifierReference => ({
        [IDENTIFIER_REFERENCE_FRAME]: frame,
        [IDENTIFIER_REFERENCE_SCOPE]: scope,
    } as IdentifierReference)
    const isSpecialVariableName = (name: string) =>
        name === SpecialVariable.This
        || name === SpecialVariable.NewTarget
        || name === SpecialVariable.Super
        || name === SpecialVariable.SuperHomeObject
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
        if (hasRuntimeBindingName(name)) {
            getVariableFlagMap(scope)[name] = flags
        }
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
            if (
                object === currentFrame[Fields.globalThis]
                && ((getVariableFlag(currentFrame[Fields.globalThis], name) ?? VariableFlags.None) & VariableFlags.Lexical)
            ) {
                return false
            }
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
            const store = getStaticVariableStore(scope)
            const flags = store[Fields.flags][slotIndex] ?? VariableFlags.None
            if (
                scope === currentFrame[Fields.globalThis]
                && (flags & VariableFlags.Lexical) === 0
            ) {
                return scope[name]
            }
            return store[Fields.values][slotIndex]
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

        const slotIndex = getScopeInternal(scope)[SCOPE_STATIC_SLOTS]?.[name]
        const store = slotIndex !== undefined ? getStaticVariableStore(scope) : null
        const isGlobalLexicalSlot = slotIndex !== undefined
            && scope === currentFrame[Fields.globalThis]
            && ((store![Fields.flags][slotIndex] ?? VariableFlags.None) & VariableFlags.Lexical) !== 0
        if (isGlobalLexicalSlot) {
            store![Fields.values][slotIndex] = value
            return value
        }
        if (slotIndex !== undefined && scope !== currentFrame[Fields.globalThis]) {
            store![Fields.values][slotIndex] = value
            if (hasMaterializedBindingAlias(scope, name)) {
                scope[name] = value
            }
            return value
        }

        const success = Reflect.set(scope, name, value)
        if (!success && currentFrame[Fields.strict]) {
            throw new TypeError(`Cannot assign to read only property '${name}'`)
        }
        if (success && slotIndex !== undefined) {
            store![Fields.values][slotIndex] = value
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

        if (
            scope === currentFrame[Fields.globalThis] &&
            getVariableFlag(scope, name) === undefined &&
            !Reflect.has(scope, name) &&
            currentFrame[Fields.strict]
        ) {
            throw new ReferenceError(name + is_not_defined)
        }

        if (readBindingValue(scope, name) === TDZ_VALUE) {
            throw new ReferenceError(`Cannot access '${name}' before initialization`)
        }
        const flags = getVariableFlag(scope, name) ?? VariableFlags.None
        if (flags & VariableFlags.Immutable) {
            throw new TypeError(name + is_a_constant)
        }
        if (flags & VariableFlags.SloppySilentImmutable) {
            if (currentFrame[Fields.strict]) {
                throw new TypeError(name + is_a_constant)
            }
            return value
        }
        return writeBindingValue(scope, name, value)
    }

    const toObjectInCurrentRealm = (value: unknown) => {
        const objectCtor = getCurrentFrame()[Fields.globalThis]?.Object
        return typeof objectCtor === 'function' ? objectCtor(value) : Object(value)
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
        const flags = getVariableFlag(scope, name) ?? VariableFlags.None
        if (flags & VariableFlags.Deletable) {
            delete getVariableFlagMap(scope)[name]
            return Reflect.deleteProperty(scope, name)
        }
        if (scope === currentFrame[Fields.globalThis] && getVariableFlag(scope, name) === undefined) {
            return Reflect.deleteProperty(scope, name)
        }
        return false
    }

    const defineVariableInternal = (
        scope: Scope,
        name: string,
        type: VariableType,
        tdz: boolean,
        immutable: boolean,
        trackStaticSlot: boolean,
        configurable: boolean,
        extraFlags: VariableFlags = VariableFlags.None
    ) => {
        const initialValue = tdz ? TDZ_VALUE : undefined
        const flags = extraFlags | (immutable ? VariableFlags.Immutable : VariableFlags.None)
        const hasName = hasRuntimeBindingName(name)

        if (hasName) {
            getVariableFlagMap(scope)[name] = flags
        }
        let store: StaticVariableStore | null = null
        let slotIndex: number | null = null
        if (trackStaticSlot) {
            const slotMap = getStaticVariableSlotMap(scope)
            store = getStaticVariableStore(scope)
            slotIndex = store[Fields.values].length
            if (hasName) {
                slotMap[name] = slotIndex
            }
            store[Fields.names].push(name)
            store[Fields.flags].push(flags)
            store[Fields.values].push(initialValue)
        }

        if (scope === currentFrame[Fields.globalThis] && hasName) {
            if (flags & VariableFlags.Lexical) {
                return
            }
            if (type === VariableType.Var && Object.prototype.hasOwnProperty.call(scope, name)) {
                if (store !== null && slotIndex !== null) {
                    store[Fields.values][slotIndex] = scope[name]
                }
                return
            }
        }

        if (!hasName || !shouldMaterializeBindingAlias(scope, trackStaticSlot)) {
            return
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

    const defineVariable = (
        scope: Scope,
        name: string,
        type: VariableType,
        trackStaticSlot: boolean = true,
        configurableOverride?: boolean,
        extraFlags: VariableFlags = VariableFlags.None
    ) => {
        const configurable = configurableOverride ?? !(scope === currentFrame[Fields.globalThis] && (
            type === VariableType.Var ||
            type === VariableType.Function
        ))

        switch (type) {
            case VariableType.Const:
                // seal it later
                return defineVariableInternal(scope, name, type, true, false, trackStaticSlot, configurable, VariableFlags.Lexical | extraFlags)
            case VariableType.Let:
                return defineVariableInternal(scope, name, type, true, false, trackStaticSlot, configurable, VariableFlags.Lexical | extraFlags)
            case VariableType.Function:
            case VariableType.Parameter:
            case VariableType.Var:
                //don't have tdz
                return defineVariableInternal(scope, name, type, false, false, trackStaticSlot, configurable, extraFlags)
        }
    }
    const getStaticVariableScope = (frame: Frame, depth: number) =>
        frame[Fields.scopes][frame[Fields.scopes].length - 1 - depth]!

    const getStaticVariableStoreAt = (scope: Scope) =>
        getScopeInternal(scope)[SCOPE_STATIC_STORE]!

    const getStaticVariableValue = (frame: Frame, depth: number, index: number) => {
        const scope = getStaticVariableScope(frame, depth)
        const store = getStaticVariableStoreAt(scope)
        const name = store[Fields.names][index]
        const flags = store[Fields.flags][index] ?? VariableFlags.None
        if (
            hasRuntimeBindingName(name)
            && scope === frame[Fields.globalThis]
            && (flags & VariableFlags.Lexical) === 0
        ) {
            return scope[name]
        }
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
        const name = store[Fields.names][index]
        const isGlobalLexical = scope === frame[Fields.globalThis]
            && ((store[Fields.flags][index] ?? VariableFlags.None) & VariableFlags.Lexical) !== 0
        if (hasRuntimeBindingName(name) && !isGlobalLexical && (scope === frame[Fields.globalThis] || hasMaterializedBindingAlias(scope, name))) {
            scope[name] = value
        }
        return value
    }

    const setStaticVariableValueChecked = (frame: Frame, depth: number, index: number, value: any) => {
        const scope = getStaticVariableScope(frame, depth)
        const store = getStaticVariableStoreAt(scope)
        if (store[Fields.values][index] === TDZ_VALUE) {
            throw new ReferenceError('Cannot access lexical binding before initialization')
        }
        const flags = store[Fields.flags][index]
        if (flags & VariableFlags.Immutable) {
            throw new TypeError(is_a_constant)
        }
        if (flags & VariableFlags.SloppySilentImmutable) {
            if (currentFrame[Fields.strict]) {
                throw new TypeError(is_a_constant)
            }
            return value
        }
        store[Fields.values][index] = value
        const name = store[Fields.names][index]
        const isGlobalLexical = scope === frame[Fields.globalThis]
            && ((store[Fields.flags][index] ?? VariableFlags.None) & VariableFlags.Lexical) !== 0
        if (hasRuntimeBindingName(name) && !isGlobalLexical && (scope === frame[Fields.globalThis] || hasMaterializedBindingAlias(scope, name))) {
            scope[name] = value
        }
        return value
    }

    const createArgumentObject = (globalThis: any) => {
        const objectPrototype = globalThis?.Object?.prototype ?? Object.prototype
        const obj = Object.create(objectPrototype)
        const iterator = globalThis?.Array?.prototype?.[Symbol.iterator] ?? Array.prototype[Symbol.iterator]
        Object.defineProperty(obj, Symbol.iterator, {
            configurable: true,
            writable: true,
            value: iterator,
        })
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
                if (res[Fields.delegate] !== undefined) {
                    return res[Fields.value] as IteratorResult<unknown>
                }
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
        Object.setPrototypeOf(gen, getGeneratorInstancePrototype(gt, invokeData[Fields.function], false))

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

        const PromiseCtor = Reflect.get(gt, 'Promise') ?? Promise
        const promiseResolve = (value: unknown) => Reflect.get(PromiseCtor, 'resolve').call(PromiseCtor, value) as PromiseLike<unknown>
        let requestRunning = false
        const queuedRequests: AsyncGeneratorQueuedRequest[] = []
        const continueWith = (
            promise: PromiseLike<unknown>,
            onFulfilled: (value: unknown) => AsyncGeneratorRequestResult,
            onRejected: (error: unknown) => AsyncGeneratorRequestResult
        ): AsyncGeneratorRequestContinuation => ({
            then(resolve, reject) {
                const settle = (next: AsyncGeneratorRequestResult) => {
                    if (next && typeof (next as AsyncGeneratorRequestContinuation).then === 'function') {
                        ;(next as AsyncGeneratorRequestContinuation).then(resolve, reject)
                    } else {
                        resolve(next as IteratorResult<unknown>)
                    }
                }

                promise.then(
                    (value) => {
                        try {
                            settle(onFulfilled(value))
                        } catch (error) {
                            reject(error)
                        }
                    },
                    (error) => {
                        try {
                            settle(onRejected(error))
                        } catch (nextError) {
                            reject(nextError)
                        }
                    }
                )
            }
        })

        const runRequest = (
            method: 'next' | 'throw' | 'return',
            value?: unknown
        ): AsyncGeneratorRequestResult => {
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

            const runLoop = (): AsyncGeneratorRequestResult => {
                while (true) {
                    const res = exec[Fields.step]()
                    if (isResultYield(res)) {
                        if (res[Fields.delegate] !== undefined) {
                            return { value: res[Fields.value], done: false }
                        }
                        return continueWith(
                            promiseResolve(res[Fields.value]),
                            (yieldedValue) => ({ value: yieldedValue, done: false }),
                            (error) => {
                                state[Fields.completed] = true
                                state[Fields.stack] = []
                                throw error
                            }
                        )
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
                        return continueWith(
                            promiseResolve(awaited[Fields.value]),
                            (value) => {
                                exec[Fields.pushValue](value)
                                return runLoop()
                            },
                            (error) => {
                                exec[Fields.setPendingThrow](error)
                                return runLoop()
                            }
                        )
                    }
                }
            }

            return runLoop()
        }

        const runQueuedRequest = (request: AsyncGeneratorQueuedRequest) => {
            requestRunning = true
            const finish = () => {
                requestRunning = false
                drainQueue()
            }
            const resolveRequest = (result: IteratorResult<unknown>) => {
                request.resolve(result)
                finish()
            }
            const rejectRequest = (error: unknown) => {
                request.reject(error)
                finish()
            }

            try {
                const result = runRequest(request.method, request.value)
                if (result && typeof (result as AsyncGeneratorRequestContinuation).then === 'function') {
                    ;(result as AsyncGeneratorRequestContinuation).then(resolveRequest, rejectRequest)
                } else {
                    resolveRequest(result as IteratorResult<unknown>)
                }
            } catch (error) {
                rejectRequest(error)
            }
        }

        const drainQueue = () => {
            if (requestRunning) {
                return
            }
            const request = queuedRequests.shift()
            if (request) {
                runQueuedRequest(request)
            }
        }

        const enqueueRequest = (method: 'next' | 'throw' | 'return', value?: unknown): Promise<IteratorResult<unknown>> => {
            return new PromiseCtor((
                resolve: (result: IteratorResult<unknown>) => void,
                reject: (reason?: unknown) => void
            ) => {
                queuedRequests.push({ method, value, resolve, reject })
                drainQueue()
            }) as Promise<IteratorResult<unknown>>
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
        Object.setPrototypeOf(gen, getGeneratorInstancePrototype(gt, invokeData[Fields.function], true))

        state[Fields.gen] = gen

        return gen
    }

    const createAsyncFromExecution = (
        pr: number[], offset: number, gt: object,
        scopes: Scope[], invokeData: InvokeParam, args: unknown[]
    ): Promise<unknown> => {
        const execution: Execution = getExecution(pr, offset, gt, scopes, invokeData, args, getDebugFunction, compileFunction, functionRedirects)
        const PromiseCtor = Reflect.get(gt, 'Promise') ?? Promise
        const promiseResolve = (value: unknown) => Reflect.get(PromiseCtor, 'resolve').call(PromiseCtor, value) as PromiseLike<unknown>

        return new PromiseCtor((resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => {
            const continueExecution = (value: unknown, isFirst: boolean) => {
                try {
                    if (!isFirst) {
                        execution[Fields.pushValue](value)
                    }

                    const res = runUntilAwait(execution)

                    if (res[Fields.done]) {
                        resolve(res[Fields.value])
                    } else if (res[Fields.await]) {
                        promiseResolve(res[Fields.value]).then(
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
                        promiseResolve(res[Fields.value]).then(
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
        const scopeClone = scopes.filter((scope) => getVariableFlag(scope, SpecialVariable.SyntheticScope) === undefined)

        const pr = currentProgram
            const functionName = formatFunctionName(name, type)
            const dynamicGeneratorFactory = (
                asyncGenerator: boolean,
                newTarget: Function | undefined,
                args: unknown[]
            ) => emulateFunctionConstructor(
                args,
                asyncGenerator ? 'asyncGenerator' : 'generator',
                newTarget
            )

        const des: FunctionDescriptor = {
            [Fields.name]: functionName,
            [Fields.type]: type,
            [Fields.offset]: offset,
            [Fields.bodyOffset]: bodyOffset,
            [Fields.scopes]: scopeClone,
            [Fields.programSection]: pr,
            [Fields.globalThis]: globalThis
        }

        let fn: any
        const invoke = function (this: any, ...args: any[]) {
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
        fn = usesOrdinaryFunctionWrapper(type)
            ? invoke
            : {
                [functionName](this: any, ...args: any[]) {
                    return Reflect.apply(invoke, this, args)
                }
            }[functionName]

        Object.defineProperty(fn, 'name', { value: functionName, configurable: true })
        if (isGeneratorType(type) || isAsyncGeneratorType(type)) {
            const intrinsics = getGeneratorFunctionIntrinsics(
                globalThis,
                isAsyncGeneratorType(type),
                dynamicGeneratorFactory
            )
            if (hasOwnPrototype(type)) {
                Object.defineProperty(fn, 'prototype', {
                    configurable: false,
                    enumerable: false,
                    writable: true,
                    value: Object.create(intrinsics.prototype),
                })
            }
            Object.setPrototypeOf(fn, intrinsics.functionPrototype)
        } else {
            const functionPrototype = globalThis?.Function?.prototype
            if (functionPrototype && Object.getPrototypeOf(fn) !== functionPrototype) {
                Object.setPrototypeOf(fn, functionPrototype)
            }
            const objectPrototype = globalThis?.Object?.prototype
            const ownPrototype = hasOwnPrototype(type) ? Reflect.get(fn, 'prototype') : undefined
            if (
                objectPrototype
                && ownPrototype
                && (typeof ownPrototype === 'object' || typeof ownPrototype === 'function')
                && Object.getPrototypeOf(ownPrototype) !== objectPrototype
            ) {
                Object.setPrototypeOf(ownPrototype, objectPrototype)
            }
        }

        functionDescriptors.set(fn, des)

        return fn
    }

    const bindInternal = (fn: any, self: any, args: any[]) => {
        if (typeof fn !== 'function') {
            return undefined
        }

        const target = function (...additionalArgs: any[]) {
            return Reflect.apply(fn, self, [...args, ...additionalArgs])
        }
        const bindFn = Reflect.apply(BIND, target, [undefined])

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
            if (isSuperReference(ctx)) {
                const propertyKey = toPropertyKey(name)
                return Reflect.get(toObjectInCurrentRealm(ctx[SUPER_REFERENCE_BASE]), propertyKey, ctx[SUPER_REFERENCE_THIS])
            }
            if (ctx == null) {
                throw new TypeError('Cannot convert undefined or null to object')
            }
            return Reflect.get(toObjectInCurrentRealm(ctx), toPropertyKey(name), ctx)
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
            if (isSuperReference(ctx)) {
                try {
                    const propertyKey = toPropertyKey(name)
                    const success = Reflect.set(
                        toObjectInCurrentRealm(ctx[SUPER_REFERENCE_BASE]),
                        propertyKey,
                        value,
                        ctx[SUPER_REFERENCE_THIS]
                    )
                    if (!success && currentFrame[Fields.strict]) {
                        throw new TypeError(`Cannot assign to read only property '${String(propertyKey)}'`)
                    }
                    return value
                } catch (e) {
                    rethrowNativeErrorInRealm(e, getCurrentFrame()[Fields.globalThis])
                }
            }
            try {
                if (ctx == null) {
                    throw new TypeError('Cannot convert undefined or null to object')
                }
                const propertyKey = toPropertyKey(name)
                const success = Reflect.set(toObjectInCurrentRealm(ctx), propertyKey, value, ctx)
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
            runtimeEval: true,
            withStrict: includesLocalScope && !!currentFrame[Fields.strict],
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
            includesLocalScope
                ? getCurrentFrame()[Fields.variableEnvironment] ?? null
                : getCurrentFrame()[Fields.globalThis]
        )

        return result
    }

    const emulateFunctionConstructor = (
        parameterValues: any[],
        kind: 'function' | 'generator' | 'asyncGenerator' = 'function',
        newTarget?: Function
    ) => {
        const parameterStrings = parameterValues.map((v) => String(v))
        if (parameterStrings.length === 0) {
            parameterStrings.push('')
        }
        const body = parameterStrings[parameterStrings.length - 1]
        const paramNames = parameterStrings.slice(0, -1)
        const functionPrefix = kind === 'asyncGenerator'
            ? 'async function*'
            : kind === 'generator'
                ? 'function*'
                : 'function'
        const src =
            paramNames.length === 0
                ? `(${functionPrefix}(){${body}})`
                : `(${functionPrefix}(${paramNames.join(',')}){${body}})`
        const [programData] = compileFunction(src, { evalMode: true })
        const fn = run(
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

        Object.defineProperty(fn, 'name', { value: 'anonymous', configurable: true })

        if (kind !== 'function' && newTarget != null) {
            const newTargetPrototype = (newTarget as { prototype?: unknown }).prototype
            if (isObjectLikeValue(newTargetPrototype)) {
                Object.setPrototypeOf(fn, newTargetPrototype)
            }
        }

        return fn
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
                    const descriptor = functionDescriptors.get(frame[Fields.function])
                    if (
                        descriptor?.[Fields.type] === FunctionTypes.DerivedConstructor
                        && value !== undefined
                        && (value === null || (typeof value !== 'object' && typeof value !== 'function'))
                    ) {
                        throw new TypeError('Derived constructors may only return object or undefined')
                    }
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
                        const descriptor = functionDescriptors.get(frame[Fields.function])
                        if (
                            descriptor?.[Fields.type] === FunctionTypes.DerivedConstructor
                            && value !== undefined
                        ) {
                            throw new TypeError('Derived constructors may only return object or undefined')
                        }
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
                    frame[Fields.savedEvalResult] = evalResult
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
                    frame[Fields.savedEvalResult] = evalResult
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
                    frame[Fields.savedEvalResult] = evalResult
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
                            nextFrame[Fields.savedEvalResult] = evalResult
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
                    frame[Fields.savedEvalResult] = evalResult
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
                case OpCode.MakeSuperReference:
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
                case OpCode.ObjectSpread:
                case OpCode.Typeof:
                case OpCode.ToPropertyKey:
                case OpCode.TypeofReference:
                case OpCode.TypeofStaticReference:
                case OpCode.TypeofStaticReferenceUnchecked:
                case OpCode.GetPropertyIterator:
                case OpCode.GetIterator:
                case OpCode.GetAsyncIterator:
                case OpCode.IteratorNext:
                case OpCode.AsyncIteratorNext:
                case OpCode.IteratorClose:
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
                try {
                    Object.defineProperty(err, 'pos', {
                        value: commandPtr,
                        writable: true,
                        configurable: true,
                    })
                } catch {
                    // Thrown values may be sealed/frozen user objects. Preserve the original throw.
                }
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
