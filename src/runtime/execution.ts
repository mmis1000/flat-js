import { FunctionTypes, InvokeType, OpCode, ResolveType, SetFlag, SpecialVariable, TryCatchFinallyState, VariableType } from "../compiler"
import { getProgramSeedWord, getProjectedLiteralOperand, getProjectedRuntimeOpcode, isProtectedModeProgram } from "./inline-compiler-helpers"
import {
    APPLY,
    assertIteratorResult,
    BIND,
    bindInfo,
    CALL,
    Context,
    environments,
    Execution,
    Fields,
    Frame,
    FrameType,
    FunctionFrame,
    functionDescriptors,
    FunctionDescriptor,
    generatorStates,
    GeneratorState,
    getEmptyObject,
    getIterator,
    getLiteralFromPool,
    HOST_FUNCTION,
    InvokeParam,
    isAsyncType,
    is_a_constant,
    isGeneratorType,
    is_not_defined,
    isIteratorYieldDone,
    isResultDone,
    isResultYield,
    iteratorComplete,
    iteratorNext,
    Result,
    ResultAwait,
    ResultDone,
    Scope,
    ScopeWithInternals,
    SCOPE_DEBUG_PTR,
    SCOPE_FLAGS,
    SCOPE_STATIC_SLOTS,
    SCOPE_STATIC_STORE,
    Stack,
    TDZ_VALUE,
    TryFrame,
    VariableFlags,
    VariableRecord,
} from "./shared"
import { handleBasicOpcode } from "./opcodes/basic"
import { handleClassOpcode } from "./opcodes/class"
import { handleControlOpcode } from "./opcodes/control"
import { handleFunctionOpcode } from "./opcodes/function"
import { handleGeneratorOpcode } from "./opcodes/generator"
import { BREAK_COMMAND, OpcodeContextField, type RuntimeOpcodeContext } from "./opcodes/types"
import { handleValueOpcode } from "./opcodes/value"

const OPCODE_SEED_MASK = 0x5A3C96E1

const inverseModMul = (c: number): number => {
    c = c | 0
    let x = 1
    for (let i = 0; i < 5; i++) {
        x = Math.imul(x, 2 - Math.imul(c, x))
    }
    return x >>> 0
}

const INV_MUL_B_RT = inverseModMul(0xc2b2ae35)
const INV_MUL_A_RT = inverseModMul(0x85ebca6b)

const blockInverseTransform = (word: number, key: number): number => {
    let x = word | 0
    x ^= x >>> 16
    x = Math.imul(x, INV_MUL_B_RT)
    x ^= x >>> 13
    x ^= x >>> 26
    x = Math.imul(x, INV_MUL_A_RT)
    x ^= x >>> 16
    return (x ^ key) >>> 0
}

const opcodeStreamMask = (pos: number, seed: number): number => {
    let x = (pos * 0x9e3779b9 + seed) | 0
    x = (((x >>> 16) ^ x) * 0x45d9f3b) | 0
    x = (((x >>> 16) ^ x) * 0x45d9f3b) | 0
    return ((x >>> 16) ^ x) | 0
}

const getDerivedKey = (activeSeed: number, pos: number, globalSeed: number): number =>
    (activeSeed ^ opcodeStreamMask(pos, globalSeed)) >>> 0

const opcodeShufflePrng = (seed: number) => {
    let s = seed | 0
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) | 0
        return s >>> 0
    }
}

const generateOpcodePermutation = (seed: number): number[] => {
    const n = OpCode._COUNT
    const perm = Array.from({ length: n }, (_unused, index) => index)
    const next = opcodeShufflePrng(seed)
    for (let index = n - 1; index > 0; index--) {
        const other = next() % (index + 1)
        const tmp = perm[index]!
        perm[index] = perm[other]!
        perm[other] = tmp
    }
    return perm
}

const inversePermCache = new WeakMap<number[], number[]>()

type PendingProjectedRead = readonly [decodedOpcodeWord: number, projectionSalt: number] | null

const UNSUPPORTED_COMPILE: typeof import('../compiler').compile = (..._args: any[]) => {
    throw new Error('not supported')
}

const getInversePerm = (program: number[]): number[] => {
    let cached = inversePermCache.get(program)
    if (!cached) {
        const seed = getProgramSeedWord(program)
        const perm = generateOpcodePermutation(seed)
        cached = new Array(perm.length)
        for (let index = 0; index < perm.length; index++) {
            cached[perm[index]!] = index
        }
        inversePermCache.set(program, cached)
    }
    return cached
}

const decodeOpcodeAt = (program: number[], pos: number, blockSeed: number): number => {
    const globalSeed = (getProgramSeedWord(program) ^ OPCODE_SEED_MASK) >>> 0
    const inversePerm = getInversePerm(program)
    const decoded = blockInverseTransform(program[pos]! >>> 0, getDerivedKey(blockSeed, pos, globalSeed)) >>> 0
    return inversePerm[decoded] ?? decoded
}

const normalizeFunctionEntryOffset = (program: number[], offset: number, encKey: number): number => {
    if (offset < 0 || offset + 1 >= program.length) {
        return offset
    }

    if (
        decodeOpcodeAt(program, offset, encKey) === OpCode.UndefinedLiteral
        && decodeOpcodeAt(program, offset + 1, encKey) === OpCode.Return
    ) {
        return offset + 2
    }

    return offset
}

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
    getDebugFunction: () => null | (() => void) = () => null,
    compileFunction: typeof import('../compiler').compile = UNSUPPORTED_COMPILE,
    functionRedirects: WeakMap<Function, Function> = new WeakMap(),
    onInstruction: ((ptr: number, opcode: number, blockSeed: number, projected: boolean) => void) | null = null,
    initialBlockSeed: number = 0
) => {
    let currentProgram = program
    let globalSeed = 0
    let inversePerm: number[] = []
    let blockSeed = initialBlockSeed >>> 0
    let projectionEnabled = false
    let pendingProjectedRead: PendingProjectedRead = null

    const setCurrentProgram = (nextProgram: number[]) => {
        currentProgram = nextProgram
        globalSeed = (getProgramSeedWord(nextProgram) ^ OPCODE_SEED_MASK) >>> 0
        inversePerm = getInversePerm(nextProgram)
        projectionEnabled = isProtectedModeProgram(nextProgram)
        pendingProjectedRead = null
    }

    setCurrentProgram(program)

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
        [Fields.return]: -1,
        [Fields.savedSeed]: 0,
        [Fields.programSection]: currentProgram,
        [Fields.globalThis]: globalThis
    }

    environments.add(initialFrame)

    const stack: Stack = [initialFrame]
    let ptr: number = entryPoint
    let lastReadPos = -1

    const read = () => {
        const pos = ptr++
        lastReadPos = pos
        const decoded = blockInverseTransform(currentProgram[pos]! >>> 0, getDerivedKey(blockSeed, pos, globalSeed)) | 0
        if (pendingProjectedRead !== null) {
            const shaped = getProjectedLiteralOperand(
                pendingProjectedRead[0],
                pendingProjectedRead[1],
                decoded >>> 0,
                pos
            )
            pendingProjectedRead = null
            return shaped | 0
        }
        return decoded
    }
    const decodeOp = (stackDepth: number): { opcode: OpCode, projected: boolean } => {
        const pos = ptr++
        const projectionSalt = getDerivedKey(blockSeed, pos, globalSeed)
        const decoded = blockInverseTransform(currentProgram[pos]! >>> 0, projectionSalt) >>> 0
        const exact = inversePerm[decoded]
        if (exact !== undefined) {
            pendingProjectedRead = null
            return { opcode: exact as OpCode, projected: false }
        }
        if (!projectionEnabled) {
            pendingProjectedRead = null
            return { opcode: decoded as OpCode, projected: false }
        }
        const opcode = getProjectedRuntimeOpcode(decoded, projectionSalt, stackDepth)
        pendingProjectedRead = opcode === OpCode.Literal ? [decoded, projectionSalt] : null
        return { opcode, projected: true }
    }
    const getCurrentFrame = () => stack[stack.length - 1]
    const peak = <T>(arr: T[], offset = 1): T => arr[arr.length - offset]
    const setScopeDebugPtr = (scopePtr: number, scope: Scope) => {
        getScopeInternal(scope)[SCOPE_DEBUG_PTR] = scopePtr
    }

    /** Native property ops run in the host realm; VM bytecode compares errors to vmGlobal's constructors (e.g. test262 eshost). */
    const rethrowNativeErrorInRealm = (e: unknown, vmGlobal: any): never => {
        if (e === null || typeof e !== 'object') throw e
        const ctor = e.constructor
        if (typeof ctor !== 'function') throw e
        const ctorName = ctor.name
        if (!ctorName) throw e
        const local = vmGlobal[ctorName]
        if (typeof local === 'function' && ctor !== local) {
            const msg = Reflect.get(e, 'message')
            throw new local(typeof msg === 'string' ? msg : '')
        }
        throw e
    }

    const getScopeInternal = (scope: Scope) => scope as ScopeWithInternals

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
            store = { names: [], flags: [], values: [] }
            internal[SCOPE_STATIC_STORE] = store
        }
        return store
    }

    const getVariableFlag = (scope: Scope, name: string) =>
        getScopeInternal(scope)[SCOPE_FLAGS]?.[name]

    const setVariableFlag = (scope: Scope, name: string, flags: number) => {
        getVariableFlagMap(scope)[name] = flags
        const slotIndex = getScopeInternal(scope)[SCOPE_STATIC_SLOTS]?.[name]
        if (slotIndex !== undefined) {
            getStaticVariableStore(scope).flags[slotIndex] = flags
        }
    }

    const hasBinding = (scope: Scope, name: string) =>
        getScopeInternal(scope)[SCOPE_FLAGS]?.[name] !== undefined || name in scope

    const readBindingValue = (scope: Scope, name: string) => {
        const slotIndex = getScopeInternal(scope)[SCOPE_STATIC_SLOTS]?.[name]
        if (slotIndex !== undefined) {
            return getStaticVariableStore(scope).values[slotIndex]
        }
        return scope[name]
    }

    const writeBindingValue = (scope: Scope, name: string, value: any) => {
        scope[name] = value
        const slotIndex = getScopeInternal(scope)[SCOPE_STATIC_SLOTS]?.[name]
        if (slotIndex !== undefined) {
            getStaticVariableStore(scope).values[slotIndex] = value
        }
        return value
    }

    const writeScopeDebugProperty = (scope: Scope, name: string, value: any) => {
        scope[name] = value
        return value
    }

    const getBindingValueChecked = (scope: Scope, name: string) => {
        const value = readBindingValue(scope, name)
        if (value === TDZ_VALUE) {
            throw new ReferenceError(`Cannot access '${name}' before initialization`)
        }
        return value
    }

    const setBindingValueChecked = (scope: Scope, name: string, value: any) => {
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
        if (readBindingValue(scope, name) === TDZ_VALUE) {
            writeBindingValue(scope, name, undefined)
        }
    }

    const freezeBinding = (scope: Scope, name: string) => {
        setVariableFlag(scope, name, (getVariableFlag(scope, name) ?? VariableFlags.None) | VariableFlags.Immutable)
    }

    const defineVariableInternal = (scope: Scope, name: string, tdz: boolean, immutable: boolean, trackStaticSlot: boolean) => {
        const initialValue = tdz ? TDZ_VALUE : undefined
        const flags = immutable ? VariableFlags.Immutable : VariableFlags.None

        getVariableFlagMap(scope)[name] = flags
        if (trackStaticSlot) {
            const slotMap = getStaticVariableSlotMap(scope)
            const store = getStaticVariableStore(scope)
            const slotIndex = store.values.length
            slotMap[name] = slotIndex
            store.names.push(name)
            store.flags.push(flags)
            store.values.push(initialValue)
        }

        Reflect.defineProperty(scope, name, {
            configurable: true,
            writable: true,
            value: initialValue
        })
    }

    const defineVariable = (scope: Scope, name: string, type: VariableType, trackStaticSlot: boolean = true) => {
        switch (type) {
            case VariableType.Const:
                // seal it later
                return defineVariableInternal(scope, name, true, false, trackStaticSlot)
            case VariableType.Let:
                return defineVariableInternal(scope, name, true, false, trackStaticSlot)
            case VariableType.Function:
            case VariableType.Parameter:
            case VariableType.Var:
                //don't have tdz
                return defineVariableInternal(scope, name, false, false, trackStaticSlot)
        }
    }
    const getStaticVariableScope = (frame: Frame, depth: number) =>
        frame[Fields.scopes][frame[Fields.scopes].length - 1 - depth]!

    const getStaticVariableStoreAt = (scope: Scope) =>
        getScopeInternal(scope)[SCOPE_STATIC_STORE]!

    const getStaticVariableValue = (frame: Frame, depth: number, index: number) => {
        const scope = getStaticVariableScope(frame, depth)
        const store = getStaticVariableStoreAt(scope)
        return store.values[index]
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
        store.values[index] = value
        scope[store.names[index]] = value
        return value
    }

    const setStaticVariableValueChecked = (frame: Frame, depth: number, index: number, value: any) => {
        const scope = getStaticVariableScope(frame, depth)
        const store = getStaticVariableStoreAt(scope)
        if (store.values[index] === TDZ_VALUE) {
            throw new ReferenceError('Cannot access lexical binding before initialization')
        }
        if (store.flags[index] & VariableFlags.Immutable) {
            throw new TypeError(is_a_constant)
        }
        store.values[index] = value
        scope[store.names[index]] = value
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
        pr: number[], offset: number, gt: object,
        scopes: Scope[], invokeData: InvokeParam, args: unknown[],
        encKey: number
    ): IterableIterator<unknown> & { return(value?: unknown): IteratorResult<unknown>; throw(error?: unknown): IteratorResult<unknown> } => {
        // Build an initial frame via a throwaway execution; do NOT run it. The generator
        // always executes inside the caller's VM via handover (OpCode.Call & OpCode.Yield).
        const scratchExecution: Execution = getExecution(pr, offset, gt, scopes, invokeData, args, getDebugFunction, compileFunction, functionRedirects, null, encKey)
        const baseFrames: Stack = scratchExecution[Fields.stack].slice()

        const state: GeneratorState = {
            stack: baseFrames,
            ptr: offset,
            blockSeed: encKey,
            completed: false,
            started: false,
            pendingAction: null,
            baseFrame: baseFrames[0],
            gen: null,
            execution: scratchExecution
        }

        for (const f of baseFrames) {
            f[Fields.generator] = state
        }

        const runHost = (
            method: 'next' | 'throw' | 'return',
            val?: unknown
        ): IteratorResult<unknown> => {
            const exec = state.execution
            const stk = exec[Fields.stack]

            if (!state.started) {
                if (method === 'throw') {
                    state.completed = true
                    state.stack = []
                    throw val
                }
                if (method === 'return') {
                    state.completed = true
                    state.stack = []
                    return { value: val, done: true }
                }
            }

            if (method === 'throw') {
                state.pendingAction = { type: 'throw', value: val }
            } else if (method === 'return') {
                state.pendingAction = { type: 'return', value: val }
            } else {
                state.pendingAction = null
            }

            stk.length = 0
            stk.push(...state.stack)
            exec[Fields.ptr] = state.ptr
            exec[Fields.blockSeed] = state.blockSeed

            const wasStarted = state.started
            state.started = true

            if (wasStarted && method === 'next') {
                exec[Fields.pushValue](val)
            }

            const res = runUntilYieldOrDone(exec)

            if (isResultYield(res)) {
                return { value: res[Fields.value], done: false }
            }
            if (isResultDone(res)) {
                state.completed = true
                state.stack = []
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
                if (state.completed) return { value: undefined, done: true }
                return runHost('next', _value)
            },
            throw(error?: unknown): IteratorResult<unknown> {
                if (state.completed) throw error
                return runHost('throw', error)
            },
            return(value?: unknown): IteratorResult<unknown> {
                if (state.completed) return { value, done: true }
                return runHost('return', value)
            },
            [Symbol.iterator]() { return gen }
        }

        state.gen = gen

        generatorStates.set(gen.next, state)
        generatorStates.set(gen.throw, state)
        generatorStates.set(gen.return, state)

        return gen
    }

    const createAsyncFromExecution = (
        pr: number[], offset: number, gt: object,
        scopes: Scope[], invokeData: InvokeParam, args: unknown[],
        encKey: number
    ): Promise<unknown> => {
        const execution: Execution = getExecution(pr, offset, gt, scopes, invokeData, args, getDebugFunction, compileFunction, functionRedirects, null, encKey)

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

    const defineFunction = (globalThis: any, scopes: Scope[], name: string, type: FunctionTypes, offset: number, encKey: number) => {
        // TODO: types
        const scopeClone = [...scopes]

        const pr = currentProgram
        const entryOffset = normalizeFunctionEntryOffset(pr, offset, encKey)

        const des: FunctionDescriptor = {
            [Fields.name]: name,
            [Fields.type]: type,
            [Fields.offset]: entryOffset,
            [Fields.scopes]: scopeClone,
            [Fields.programSection]: pr,
            [Fields.globalThis]: globalThis,
            [Fields.encKey]: encKey,
        }

        const fn = function (this: any, ...args: any[]) {
            const invokeData: InvokeParam = new.target
                ? {
                    [Fields.type]: InvokeType.Construct,
                    [Fields.function]: fn,
                    [Fields.name]: name,
                    [Fields.newTarget]: new.target
                }
                : {
                    [Fields.type]: InvokeType.Apply,
                    [Fields.function]: fn,
                    [Fields.name]: name,
                    [Fields.self]: this
                }

            if (isGeneratorType(type)) {
                return createGeneratorFromExecution(
                    pr, entryOffset, des[Fields.globalThis],
                    [...scopeClone], invokeData, args, encKey
                )
            }

            if (isAsyncType(type)) {
                return createAsyncFromExecution(
                    pr, entryOffset, des[Fields.globalThis],
                    [...scopeClone], invokeData, args, encKey
                )
            }

            return run_(
                pr, entryOffset, des[Fields.globalThis],
                [...scopeClone], invokeData, args, getDebugFunction, false, compileFunction, functionRedirects, null, encKey
            )
        }

        Object.defineProperty(fn, 'name', { value: name, configurable: true })

        ;(fn as any).__pos__ = entryOffset

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

    const getValue = (ctx: any, name: string) => {
        if (!environments.has(ctx)) {
            return ctx[name]
        } else {
            const env: Frame = ctx
            const scope = findScope(env, name)

            if (scope) {
                return getBindingValueChecked(scope, name)
            } else {
                const currentGlobal = env[Fields.globalThis]
                if (name === SpecialVariable.This) {
                    return currentGlobal
                } else if (name in currentGlobal) {
                    return (currentGlobal as any)[name]
                } else {
                    throw new ReferenceError(name + is_not_defined)
                }
            }
        }
    }

    const setValue = (ctx: any, name: string, value: any) => {
        if (!environments.has(ctx)) {
            try {
                return (ctx[name] = value)
            } catch (e) {
                rethrowNativeErrorInRealm(e, getCurrentFrame()[Fields.globalThis])
            }
        } else {
            const env: Frame = ctx
            const scope = findScope(env, name)

            if (scope) {
                return setBindingValueChecked(scope, name, value)
            } else {
                throw new ReferenceError(name + is_not_defined)
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
    const FUNCTION_CONSTRUCTOR = Object.getPrototypeOf(function () { }).constructor

    const runCompiledProgram = (programData: number[], scopes: Scope[]) => run_(
        programData,
        0,
        getCurrentFrame()[Fields.globalThis],
        scopes,
        {
            [Fields.type]: InvokeType.Apply,
            [Fields.function]: undefined,
            [Fields.name]: '',
            [Fields.self]: undefined
        },
        [],
        getDebugFunction,
        true,
        compileFunction,
        functionRedirects
    )

    const emulateEval = (str: string, includesLocalScope: boolean) => {
        str = String(str)

        if (compileFunction === UNSUPPORTED_COMPILE) {
            // Stripped standalone runtimes do not embed the compiler. Fall back to
            // host eval so browser examples can still execute library code that
            // reaches eval/Function at runtime.
            return EVAL_FUNCTION(str)
        }

        const [programData] = compileFunction(str, { evalMode: true })

        const result = runCompiledProgram(
            programData,
            includesLocalScope ? [...getCurrentFrame()[Fields.scopes]] : [],
        )

        return result
    }

    const emulateFunctionConstructor = (parameterValues: any[]) => {
        const parameterStrings = parameterValues.map((v) => String(v))
        if (parameterStrings.length === 0) {
            parameterStrings.push('')
        }

        if (compileFunction === UNSUPPORTED_COMPILE) {
            const hostFunction = Reflect.get(getCurrentFrame()[Fields.globalThis], 'Function')
            const FunctionCtor = typeof hostFunction === 'function' ? hostFunction : FUNCTION_CONSTRUCTOR
            return FunctionCtor(...parameterStrings)
        }

        const body = parameterStrings[parameterStrings.length - 1]
        const paramNames = parameterStrings.slice(0, -1)
        const src =
            paramNames.length === 0
                ? `(function(){${body}})`
                : `(function(${paramNames.join(',')}){${body}})`
        const [programData] = compileFunction(src, { evalMode: true })
        return runCompiledProgram(programData, [])
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
                const isGenBase = !!(genState && genState.baseFrame === frame)

                // exit
                const returnAddr = frame[Fields.return]

                if (isGenBase) {
                    genState!.completed = true
                    genState!.stack = []
                    stack.pop()
                    if (returnAddr < 0) {
                        returnsExternal = true
                        returnValue = { value, done: true }
                        return value
                    }
                    blockSeed = frame[Fields.savedSeed]
                    ptr = returnAddr
                    setCurrentProgram(peak(stack)[Fields.programSection])
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
                    blockSeed = frame[Fields.savedSeed]
                    ptr = returnAddr
                    setCurrentProgram(peak(stack)[Fields.programSection])

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
                    blockSeed = frame[Fields.finallyEncKey]
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
                    if (gs && gs.baseFrame === fframe) {
                        // Error escapes the generator — mark completed and continue
                        // unwinding so it surfaces in the VM caller.
                        gs.completed = true
                        gs.stack = []
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

                    blockSeed = frame[Fields.catchEncKey]
                    ptr = catchAddr
                    setCurrentProgram(frame[Fields.programSection])
                } else if (finallyAddr >= 0) {
                    frame[Fields.state] = TryCatchFinallyState.Finally
                    blockSeed = frame[Fields.finallyEncKey]
                    ptr = finallyAddr
                    setCurrentProgram(frame[Fields.programSection])
                } else {
                    blockSeed = frame[Fields.exitEncKey]
                    ptr = exitAddr
                    setCurrentProgram(frame[Fields.programSection])
                }
            }
                break;
            case TryCatchFinallyState.Catch: {
                frame[Fields.state] = TryCatchFinallyState.Finally
                frame[Fields.resolveType] = ResolveType.throw
                frame[Fields.value] = value

                if (finallyAddr >= 0) {
                    blockSeed = frame[Fields.finallyEncKey]
                    ptr = finallyAddr
                    setCurrentProgram(frame[Fields.programSection])
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
                blockSeed = frame[Fields.breakEncKey]
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
                            nextFrame[Fields.breakEncKey] = frame[Fields.breakEncKey]
                            blockSeed = nextFrame[Fields.finallyEncKey]
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
        const breakEncKey: number = frame[Fields.valueStack].pop()
        const breakAddr: number = frame[Fields.valueStack].pop()
        const depth: number = frame[Fields.valueStack].pop()
        const finallyAddr = frame[Fields.finally]

        frame[Fields.break] = breakAddr
        frame[Fields.breakEncKey] = breakEncKey
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
                    blockSeed = frame[Fields.finallyEncKey]
                    ptr = finallyAddr
                    setCurrentProgram(frame[Fields.programSection])
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
                setCurrentProgram(value)
            }
        },
        [OpcodeContextField.ptr]: {
            get: () => ptr,
            set: (value: number) => {
                ptr = value
            }
        },
        [OpcodeContextField.blockSeed]: {
            get: () => blockSeed,
            set: (value: number) => {
                blockSeed = value >>> 0
            }
        },
        [OpcodeContextField.globalSeed]: {
            get: () => globalSeed,
        },
        [OpcodeContextField.lastReadPos]: {
            get: () => lastReadPos,
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
            setCurrentProgram(peak(stack)[Fields.programSection])
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
            currentFrame = getCurrentFrame()
            currentFrameStack = currentFrame[Fields.valueStack]
            const currentPtr = commandPtr = ptr
            const { opcode: command, projected } = decodeOp(currentFrameStack.length)
            onInstruction?.(currentPtr, command, blockSeed, projected)

            if (debug && currentFrame[Fields.programSection].length !== currentProgram.length) {
                debugger
            }

            command: switch (command) {
                case OpCode.Nop:
                case OpCode.Literal:
                case OpCode.LiteralAlias1:
                case OpCode.LiteralAlias2:
                case OpCode.ProtectedLiteral:
                case OpCode.ProtectedLiteralAlias1:
                case OpCode.ProtectedLiteralAlias2:
                case OpCode.Pop:
                case OpCode.PopAlias1:
                case OpCode.SetEvalResult:
                case OpCode.Duplicate:
                case OpCode.DuplicateAlias1:
                case OpCode.GetRecord:
                case OpCode.GetRecordAlias1:
                case OpCode.GetStatic:
                case OpCode.GetStaticUnchecked:
                case OpCode.NullLiteral:
                case OpCode.UndefinedLiteral:
                case OpCode.RegexpLiteral:
                case OpCode.Set:
                case OpCode.SetAlias1:
                case OpCode.SetKeepCtx:
                case OpCode.SetStatic:
                case OpCode.SetStaticUnchecked:
                case OpCode.SetInitialized:
                case OpCode.SetInitializedStatic:
                case OpCode.BPlusEqual:
                case OpCode.BMinusEqual:
                case OpCode.BSlashEqual:
                case OpCode.BAsteriskEqual:
                case OpCode.BPlusEqualStatic:
                case OpCode.BMinusEqualStatic:
                case OpCode.BSlashEqualStatic:
                case OpCode.BAsteriskEqualStatic:
                case OpCode.BPlusEqualStaticUnchecked:
                case OpCode.BMinusEqualStaticUnchecked:
                case OpCode.BSlashEqualStaticUnchecked:
                case OpCode.BAsteriskEqualStaticUnchecked:
                case OpCode.DefineKeepCtx:
                case OpCode.Get:
                case OpCode.GetAlias1:
                case OpCode.SetMultiple:
                case OpCode.Jump:
                case OpCode.JumpAlias1:
                case OpCode.JumpIfNot:
                case OpCode.JumpIfNotAlias1:
                case OpCode.JumpIf:
                case OpCode.JumpIfAndKeep:
                case OpCode.JumpIfNotAndKeep:
                case OpCode.EnterScope:
                case OpCode.LeaveScope:
                case OpCode.DeTDZ:
                case OpCode.DeTDZStatic:
                case OpCode.FreezeVariable:
                case OpCode.FreezeVariableStatic:
                case OpCode.Reseed:
                    handleBasicOpcode(command, opcodeContext)
                    break
                case OpCode.EnterFunction:
                case OpCode.DefineFunction:
                case OpCode.CallValue:
                case OpCode.Call:
                case OpCode.CallAsEval:
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
                case OpCode.ObjectLiteral:
                case OpCode.Typeof:
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
                    break
            }

            if (returnsExternal) {
                return {
                    [Fields.done]: true,
                    [Fields.value]: returnValue,
                    [Fields.evalResult]: evalResult
                }
            }

        } catch (err: any) {
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
            return commandPtr
        },
        set [Fields.ptr] (v: number) {
            commandPtr = v
            ptr = v
        },
        get [Fields.blockSeed] () {
            return blockSeed
        },
        set [Fields.blockSeed] (v: number) {
            blockSeed = v >>> 0
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
    getDebugFunction: () => null | (() => void),
    evalResultInstead = false,
    compileFunction: typeof import('../compiler').compile | undefined = undefined,
    functionRedirects: WeakMap<Function, Function> = new WeakMap(),
    onInstruction: ((ptr: number, opcode: number, blockSeed: number, projected: boolean) => void) | null = null,
    initialBlockSeed: number = 0
) => {
    const execution = getExecution(program, entryPoint, globalThis, scopes, invokeData, args, getDebugFunction, compileFunction, functionRedirects, onInstruction, initialBlockSeed)

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
    getDebugFunction: () => null | (() => void) = () => null
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
        functionRedirects
    )
}
