"use strict"
import { FunctionTypes, InvokeType, LiteralPoolKind, OpCode, ResolveType, SetFlag, SpecialVariable, TryCatchFinallyState, VariableType } from "./compiler"


// [START_HERE]
// MUST SYNC WITH COMPILER
const TEXT_DADA_MASK = 0x80000000
// MUST SYNC WITH COMPILER
const isSmallNumber = (a: any): a is number => {
    return typeof a === 'number' && ((a | 0) === a) && ((a & TEXT_DADA_MASK) === 0)
}
// MUST SYNC WITH COMPILER literalPoolWordMask
const literalPoolWordMask = (i: number): number => {
    const x = (i * 0x9e3779b9 | 0) ^ (i >>> 1) ^ (i << 3)
    return (x ^ (x >>> 15) ^ (x << 15)) | 0
}

const decodeLiteralFromProgram = (program: number[], pos: number): any => {
    const label = (program[pos] ^ literalPoolWordMask(pos)) | 0
    const length = (program[pos + 1] ^ literalPoolWordMask(pos + 1)) | 0
    if (label === LiteralPoolKind.Boolean) {
        return ((program[pos + 2] ^ literalPoolWordMask(pos + 2)) | 0) !== 0
    }
    if (label === LiteralPoolKind.Number) {
        const buf = new ArrayBuffer(8)
        const u = new Uint32Array(buf)
        u[0] = (program[pos + 2] ^ literalPoolWordMask(pos + 2)) >>> 0
        u[1] = (program[pos + 3] ^ literalPoolWordMask(pos + 3)) >>> 0
        return new Float64Array(buf)[0]
    }
    if (label === LiteralPoolKind.String) {
        let s = ''
        for (let i = 0; i < length; i++) {
            const w = (program[pos + 2 + i] ^ literalPoolWordMask(pos + 2 + i)) | 0
            s += String.fromCharCode(w & 0xffff)
        }
        return s
    }
    throw new Error('bad literal pool entry')
}

/** Pool entry starts at `pos` (`label` word). Same buffer shares one map so literals decode once per program. */
const literalPoolCache = new WeakMap<number[], Map<number, any>>()

const getLiteralFromPool = (program: number[], pos: number): any => {
    let byPos = literalPoolCache.get(program)
    if (!byPos) {
        byPos = new Map()
        literalPoolCache.set(program, byPos)
    }
    if (!byPos.has(pos)) {
        byPos.set(pos, decodeLiteralFromProgram(program, pos))
    }
    return byPos.get(pos)
}

const CALL = Function.prototype.call
const APPLY = Function.prototype.apply
const BIND = Function.prototype.bind
const REGEXP = RegExp

export const enum FrameType {
    Function,
    Try
}

export type Scope = Record<string, any>

export const enum Fields {
    type,
    savedScopes,
    scopes,
    valueStack,
    return,
    catch,
    finally,
    variable,
    name,
    tdz,
    immutable,
    value,
    offset,
    state,
    resolveType,
    exit,

    function,
    self,
    arguments,
    invokeType,

    ptr,
    stack,
    setDebugFunction,
    step,

    programSection,
    evalResult,
    newTarget,
    break,
    depth,

    globalThis,
    done,
    yield,
    await,
    delegate,
    pushValue,
    setPendingThrow,
    error,
    generator,
}

interface BaseFrame {
    [Fields.type]: FrameType
    [Fields.programSection]: number[]
    [Fields.scopes]: Scope[],
    [Fields.globalThis]: any
    [Fields.valueStack]: any[]
    [Fields.generator]?: any
}

interface FunctionFrame extends BaseFrame {
    [Fields.type]: FrameType.Function
    [Fields.return]: number,
    [Fields.invokeType]: InvokeType
}

interface TryFrame extends BaseFrame {
    [Fields.type]: FrameType.Try,
    // scope snapshot
    [Fields.savedScopes]: Scope[],
    [Fields.scopes]: Scope[],
    // ref to frame's valueStack
    [Fields.valueStack]: any[]

    [Fields.state]: TryCatchFinallyState
    [Fields.resolveType]: ResolveType
    [Fields.value]: any

    /** address */
    [Fields.catch]: number,

    /** address */
    [Fields.finally]: number,

    /** address */
    [Fields.exit]: number,

    /** address */
    [Fields.break]: number,
    /** how deep did it break out, jump to the break address on reach 0 */
    [Fields.depth]: number,

    [Fields.variable]: string
}

export type Frame = FunctionFrame | TryFrame

export type Stack = Frame[]

type VariableRecord = {
    [Fields.type]: VariableType
    [Fields.name]: string
}

type VariableDescriptor = {
    [Fields.tdz]: boolean,
    [Fields.immutable]: boolean,
    [Fields.value]: any
}

const is_not_defined = ' is not defined'
const is_a_constant = ' is a constant'
const getEmptyObject = Object.create.bind(Object, null, {})

export type ResultStep = {
    [Fields.done]: false,
    [Fields.yield]?: undefined,
    [Fields.await]?: undefined,
}

export type ResultDone = {
    [Fields.done]: true,
    [Fields.value]: unknown,
    [Fields.evalResult]: unknown,
    [Fields.yield]?: undefined,
    [Fields.await]?: undefined,
}

export type ResultYield = {
    [Fields.done]: false,
    [Fields.yield]: true,
    [Fields.await]?: undefined,
    [Fields.value]: unknown,
    [Fields.delegate]?: Iterator<unknown>,
}

export type ResultAwait = {
    [Fields.done]: false,
    [Fields.await]: true,
    [Fields.yield]?: undefined,
    [Fields.value]: unknown,
}

export type Result = ResultStep | ResultDone | ResultYield | ResultAwait

const isResultYield = (r: Result): r is ResultYield =>
    r[Fields.done] === false && r[Fields.yield] === true

const isResultDone = (r: Result): r is ResultDone => r[Fields.done] === true

const isIteratorYieldDone = (x: unknown): x is { value: unknown, done: boolean } =>
    x !== null && typeof x === 'object' && 'value' in x && 'done' in x

/** ECMA-262 GetIterator / IteratorRecord: @@iterator must be present and callable; result must be an object with a callable next. */
const getIterator = (iterable: unknown) => {
    if (iterable == null) {
        throw new TypeError('Cannot convert undefined or null to object')
    }
    const method = (iterable as any)[Symbol.iterator]
    if (typeof method !== 'function') {
        throw new TypeError('object is not iterable')
    }
    const iterator = method.call(iterable)
    if (iterator == null || typeof iterator !== 'object') {
        throw new TypeError('iterator must be an object')
    }
    return iterator
}

const iteratorNext = (iterator: { next: unknown }, value?: unknown) => {
    const next = iterator.next
    if (typeof next !== 'function') {
        throw new TypeError('iterator must have next method')
    }
    const result = value === undefined ? next.call(iterator) : next.call(iterator, value)
    if (result == null || typeof result !== 'object') {
        throw new TypeError('iterator result must be an object')
    }
    return result
}

const iteratorComplete = (result: { done?: unknown }) => Boolean(result.done)

const assertIteratorResult = (result: unknown) => {
    if (result == null || typeof result !== 'object') {
        throw new TypeError('iterator result must be an object')
    }
    return result
}

type RefinedEnvSet = Omit<WeakSet<Frame>, 'has'> & {
    has (value: Frame): boolean
    has (value: any): value is Frame
}

type Context = Record<string, any> | Frame

type Execution = {
    [Fields.ptr]: number
    readonly [Fields.stack]: Stack
    readonly [Fields.scopes]: Scope[]
    [Fields.step]: (debug?: boolean) => Result
    [Fields.pushValue](value: unknown): void
    [Fields.setPendingThrow](error: unknown): void
}

type FunctionDescriptor = {
    [Fields.name]: string,
    [Fields.type]: FunctionTypes,
    [Fields.offset]: number,
    [Fields.scopes]: Scope[],
    [Fields.programSection]: number[],
    [Fields.globalThis]: any
}

const isGeneratorType = (t: FunctionTypes) =>
    t === FunctionTypes.GeneratorDeclaration ||
    t === FunctionTypes.GeneratorExpression ||
    t === FunctionTypes.GeneratorMethod

const isAsyncType = (t: FunctionTypes) =>
    t === FunctionTypes.AsyncFunctionDeclaration ||
    t === FunctionTypes.AsyncFunctionExpression ||
    t === FunctionTypes.AsyncArrowFunction ||
    t === FunctionTypes.AsyncMethod

const functionDescriptors = new WeakMap<any, FunctionDescriptor>()

const environments = new WeakSet() as unknown as RefinedEnvSet

const bindInfo = new WeakMap<any, { [Fields.function]: any, [Fields.self]: any, [Fields.arguments]: any[] }>()

const variableDescriptors = new WeakMap<Scope, Map<string, VariableDescriptor>>()

type GeneratorState = {
    stack: Stack,
    ptr: number,
    completed: boolean,
    started: boolean,
    pendingAction: null | { type: 'throw' | 'return', value: any },
    baseFrame: Frame | null,
    gen: any,
    execution: Execution
}
const generatorStates = new WeakMap<any, GeneratorState>()


type InvokeParamApply = {
    [Fields.type]: InvokeType.Apply,
    [Fields.function]: unknown,
    [Fields.name]: string,
    [Fields.self]: unknown,
}
type InvokeParamConstruct = {
    [Fields.type]: InvokeType.Construct,
    [Fields.function]: unknown,
    [Fields.name]: string,
    [Fields.newTarget]: unknown
}

export type InvokeParam = InvokeParamApply | InvokeParamConstruct

const getExecution = (
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
    compileFunction: typeof import('./compiler').compile = (...args: any[]) => { throw new Error('not supported') },
    functionRedirects: WeakMap<Function, Function> = new WeakMap()
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
        [Fields.return]: -1,
        [Fields.programSection]: currentProgram,
        [Fields.globalThis]: globalThis
    }

    environments.add(initialFrame)

    const stack: Stack = [initialFrame]
    let ptr: number = entryPoint

    const read = () => currentProgram[ptr++]
    const getCurrentFrame = () => stack[stack.length - 1]
    const peak = <T>(arr: T[], offset = 1): T => arr[arr.length - offset]

    const defineVariableInternal = (scope: Scope, name: string, tdz: boolean, immutable: boolean) => {
        if (!variableDescriptors.has(scope)) {
            variableDescriptors.set(scope, new Map())
        }

        const descriptor = {
            [Fields.tdz]: tdz,
            [Fields.immutable]: immutable,
            [Fields.value]: undefined
        }

        variableDescriptors.get(scope)!.set(name, descriptor)

        Reflect.defineProperty(scope, name, {
            configurable: true,
            get() {
                if (descriptor[Fields.tdz]) {
                    throw new ReferenceError(name + is_not_defined)
                }
                return descriptor[Fields.value]
            },
            set(v) {
                if (descriptor[Fields.tdz]) {
                    throw new ReferenceError(name + is_not_defined)
                }
                if (descriptor[Fields.immutable]) {
                    throw new TypeError(name + is_a_constant)
                }
                descriptor[Fields.value] = v
            }
        })
    }

    const defineVariable = (scope: Scope, name: string, type: VariableType) => {
        switch (type) {
            case VariableType.Const:
                // seal it later
                return defineVariableInternal(scope, name, true, false)
            case VariableType.Let:
                return defineVariableInternal(scope, name, true, false)
            case VariableType.Function:
            case VariableType.Parameter:
            case VariableType.Var:
                //don't have tdz
                return defineVariableInternal(scope, name, false, false)
        }
    }
    const getVariableDescriptor = (scope: Scope, name: string) => {
        const map = variableDescriptors.get(scope)
        if (map) {
            return map.get(name)
        }
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
        scopes: Scope[], invokeData: InvokeParam, args: unknown[]
    ): IterableIterator<unknown> & { return(value?: unknown): IteratorResult<unknown>; throw(error?: unknown): IteratorResult<unknown> } => {
        // Build an initial frame via a throwaway execution; do NOT run it. The generator
        // always executes inside the caller's VM via handover (OpCode.Call & OpCode.Yield).
        const scratchExecution: Execution = getExecution(pr, offset, gt, scopes, invokeData, args, getDebugFunction, compileFunction, functionRedirects)
        const baseFrames: Stack = scratchExecution[Fields.stack].slice()

        const state: GeneratorState = {
            stack: baseFrames,
            ptr: offset,
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

    const defineFunction = (globalThis: any, scopes: Scope[], name: string, type: FunctionTypes, offset: number) => {
        // TODO: types
        const scopeClone = [...scopes]

        const pr = currentProgram

        const des: FunctionDescriptor = {
            [Fields.name]: name,
            [Fields.type]: type,
            [Fields.offset]: offset,
            [Fields.scopes]: scopeClone,
            [Fields.programSection]: pr,
            [Fields.globalThis]: globalThis
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
                    pr, offset, des[Fields.globalThis],
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

        Object.defineProperty(fn, 'name', { value: name, configurable: true })

        ;(fn as any).__pos__ = offset

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
        for (let i = ctx[Fields.scopes].length - 1; i >= 0; i--) {
            const scope = ctx[Fields.scopes][i]
            if (variableDescriptors.get(scope)?.has(name) || name in scope) {
                return scope
            }
        }

        const globalScope = ctx[Fields.globalThis]
        if (variableDescriptors.get(globalScope)?.has(name) || name in globalScope) {
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
                const descriptor = variableDescriptors.get(scope)?.get(name)
                if (descriptor && descriptor[Fields.tdz]) {
                    throw new ReferenceError(`Cannot access '${name}' before initialization`)
                }
                return scope[name]
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
            return (ctx[name] = value)
        } else {
            const env: Frame = ctx
            const scope = findScope(env, name)

            if (scope) {
                const descriptor = variableDescriptors.get(scope)?.get(name)
                if (descriptor) {
                    if (descriptor[Fields.tdz]) {
                        throw new ReferenceError(`Cannot access '${name}' before initialization`)
                    }
                    if (descriptor[Fields.immutable]) {
                        throw new TypeError(is_a_constant)
                    }
                }
                return (scope[name] = value)
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

    const emulateEval = (str: string, includesLocalScope: boolean) => {
        str = String(str)

        const [programData] = compileFunction(str, { evalMode: true })

        const result = run(
            programData,
            0,
            getCurrentFrame()[Fields.globalThis],
            includesLocalScope ? [...getCurrentFrame()[Fields.scopes]] : [],
            undefined,
            [],
            compileFunction,
            functionRedirects,
            getDebugFunction
        )

        return result
    }

    const step = (debug: boolean = false): Result => {
        if (stack.length > 0) {
            currentProgram = peak(stack)[Fields.programSection]
        }
        if (ptr >= currentProgram.length) {
             return { [Fields.done]: true, [Fields.value]: undefined, [Fields.evalResult]: undefined }
        }
        const opCode = currentProgram[ptr];
        let returnsExternal = false
        let returnValue: unknown = null

        const addCatchScope = (frame: TryFrame, name: string, value: any) => {
            const newScope: Scope = {}
            defineVariable(newScope, name, VariableType.Var)
            newScope[name] = value
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
                            || ( value !== null && typeof value === 'object')
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
            const currentFrame = getCurrentFrame()

            if (currentFrame[Fields.programSection].length !== currentProgram.length) {
                debugger
            }

            const popCurrentFrameStack = <T = unknown>(): T => {
                const val = currentFrame[Fields.valueStack].pop()
                return val
            }

            const pushCurrentFrameStack = (arg: any): number => {
                const res = currentFrame[Fields.valueStack].push(arg)
                return res
            }

            command: switch (command) {
                case OpCode.Literal: {
                    const value = read()
                    if (isSmallNumber(value)) {
                        pushCurrentFrameStack(value)
                    } else {
                        const pos = value ^ TEXT_DADA_MASK
                        pushCurrentFrameStack(getLiteralFromPool(currentProgram, pos))
                    }
                }
                    break;
                case OpCode.Pop:
                    popCurrentFrameStack()
                    break
                case OpCode.SetEvalResult:
                    evalResult = peak(currentFrame[Fields.valueStack])
                    break
                case OpCode.Duplicate:
                    pushCurrentFrameStack(peak(currentFrame[Fields.valueStack]))
                    break
                case OpCode.GetRecord:
                    pushCurrentFrameStack(currentFrame)
                    break
                case OpCode.NullLiteral:
                    pushCurrentFrameStack(null)
                    break
                case OpCode.UndefinedLiteral:
                    pushCurrentFrameStack(undefined)
                    break
                case OpCode.RegexpLiteral: {
                    const flags = popCurrentFrameStack<string>()
                    const source = popCurrentFrameStack<string>()
                    pushCurrentFrameStack(new REGEXP(source, flags))
                }
                    break
                case OpCode.Set:
                case OpCode.SetKeepCtx: {
                    const value = popCurrentFrameStack()
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Context>()

                    if (!environments.has(ctx)) {
                        ctx[name] = value
                    } else {
                        const scope = findScope(ctx, name)
                        if (scope) {
                            scope[name] = value
                        } else {
                            throw new ReferenceError(name + is_not_defined)
                        }
                    }

                    if (command === OpCode.Set) {
                        pushCurrentFrameStack(value)
                    } else /* if (command === OpCode.SetKeepCtx) */ {
                        pushCurrentFrameStack(ctx)
                    }
                }
                    break;
                case OpCode.SetInitialized: {
                    const value = popCurrentFrameStack()
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Frame>()
                    
                    const scope = findScope(ctx, name)!
                    
                    const desc = variableDescriptors.get(scope)!.get(name)!
                    desc[Fields.tdz] = false
                    desc[Fields.value] = value

                    pushCurrentFrameStack(value)
                }
                    break
                // Assign and update
                case OpCode.BPlusEqual:
                case OpCode.BMinusEqual: 
                case OpCode.BSlashEqual:
                case OpCode.BAsteriskEqual: {
                    const rightVal = popCurrentFrameStack()
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Context>()

                    const leftValue = getValue(ctx, name)
                    const commandCurrent = command
               
                    const exprs: Record<typeof commandCurrent, (a: any, b:any) => any> = {
                        [OpCode.BPlusEqual]: (a, b) => a + b,
                        [OpCode.BMinusEqual]: (a, b) => a - b,
                        [OpCode.BSlashEqual]: (a, b) => a / b,
                        [OpCode.BAsteriskEqual]: (a, b) => a * b
                    }

                    const r = exprs[command](leftValue, rightVal)
                    setValue(ctx, name, r)

                    pushCurrentFrameStack(r)
                }
                    break;
                case OpCode.DefineKeepCtx: {
                    const value = popCurrentFrameStack()
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Record<string, any>>()

                    Reflect.defineProperty(ctx, name, {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: value
                    })

                    ctx[name] = value

                    pushCurrentFrameStack(ctx)
                }
                    break;
                case OpCode.Get: {
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Context>()

                    pushCurrentFrameStack(getValue(ctx, name))
                }
                    break;
                case OpCode.SetMultiple: {
                    const ctx: Frame = popCurrentFrameStack()
                    const length = popCurrentFrameStack<number>()
                    for (let i = 0; i < length; i++) {
                        const flag = popCurrentFrameStack<number>()
                        const value = popCurrentFrameStack()
                        const name = popCurrentFrameStack<string>()
                        let hit = false

                        const scope = findScope(ctx, name)
                        if (scope) {
                            hit = true
                            const desc = getVariableDescriptor(scope, name)
                            if (desc && (flag & SetFlag.DeTDZ)) desc[Fields.tdz] = false
                            scope[name] = value
                            if (desc && (flag & SetFlag.Freeze)) desc[Fields.immutable] = true
                        }

                        if (!hit) {
                            throw new ReferenceError(name + is_not_defined)
                        }
                    }
                }
                    break;
                case OpCode.Jump: {
                    const pos = popCurrentFrameStack<number>()
                    ptr = pos
                }
                    break;
                case OpCode.JumpIfNot: {
                    const value = popCurrentFrameStack()
                    const pos = popCurrentFrameStack<number>()
                    if (value) {
                        // intentional blank
                    } else {
                        ptr = pos
                    }
                }
                    break
                case OpCode.JumpIf: {
                    const value = popCurrentFrameStack()
                    const pos = popCurrentFrameStack<number>()
                    if (value) {
                        ptr = pos
                    } else {
                        // intentional blank
                    }
                }
                    break
                case OpCode.JumpIfAndKeep: {
                    const value = popCurrentFrameStack()
                    const pos = popCurrentFrameStack<number>()
                    pushCurrentFrameStack(value)
                    if (value) {
                        ptr = pos
                    } else {
                        // intentional blank
                    }
                }
                    break;
                case OpCode.JumpIfNotAndKeep: {
                    const value = popCurrentFrameStack()
                    const pos = popCurrentFrameStack<number>()
                    pushCurrentFrameStack(value)
                    if (value) {
                        // intentional blank
                    } else {
                        ptr = pos
                    }
                }
                    break;
                case OpCode.EnterFunction: {
                    // TODO: arguments and this/self reference
                    const functionType: FunctionTypes = popCurrentFrameStack()
                    const variableCount: number = popCurrentFrameStack()
                    const variables: VariableRecord[] = []
                    for (let i = 0; i < variableCount; i++) {
                        variables.push({
                            [Fields.type]: popCurrentFrameStack(),
                            [Fields.name]: popCurrentFrameStack()
                        })
                    }
                    const argumentNameCount: number = popCurrentFrameStack()
                    const argumentNames: string[] = []
                    for (let i = 0; i < argumentNameCount; i++) {
                        argumentNames.push(popCurrentFrameStack())
                    }
                    const parameterCount: number = popCurrentFrameStack()
                    const parameters: any[] = []
                    for (let i = 0; i < parameterCount; i++) {
                        parameters.unshift(popCurrentFrameStack())
                    }

                    const invokeType = popCurrentFrameStack()

                    const getArgumentObject = (scope: Record<any, any>, callee: any) => {
                        const obj: Record<string, any> = createArgumentObject()
                        const bindingLength = Math.min(argumentNameCount, parameterCount)

                        for (let i = 0; i < parameterCount; i++) {
                            if (i < bindingLength) {
                                Object.defineProperty(obj, i, {
                                    enumerable: true,
                                    configurable: true,
                                    get () {
                                        return scope[argumentNames[i]]
                                    },
                                    set (v) {
                                        scope[argumentNames[i]] = v
                                    }
                                })
                            } else {
                                obj[i] = parameters[i]
                            }
                        }

                        Object.defineProperty(obj, 'length', {
                            enumerable: false,
                            configurable: true,
                            value: parameterCount
                        })
                        Object.defineProperty(obj, 'callee', {
                            enumerable: false,
                            configurable: true,
                            value: callee
                        })

                        return obj
                    }

                    if (invokeType === InvokeType.Apply) {
                        // TODO: arguments and this/self reference
                        const name = popCurrentFrameStack<string>()
                        const fn = popCurrentFrameStack()
                        const self = popCurrentFrameStack()

                        let scope: Scope

                        if (functionType === FunctionTypes.SourceFileInPlace) {
                            scope = peak(currentFrame[Fields.scopes]) || currentFrame[Fields.globalThis]
                        } else {
                            scope = getEmptyObject()
                            currentFrame[Fields.scopes].push(scope)
                        }

                        switch (functionType) {
                            case FunctionTypes.FunctionDeclaration:
                            case FunctionTypes.FunctionExpression:
                            case FunctionTypes.MethodDeclaration:
                            case FunctionTypes.GeneratorDeclaration:
                            case FunctionTypes.GeneratorExpression:
                            case FunctionTypes.GeneratorMethod:
                            case FunctionTypes.AsyncFunctionDeclaration:
                            case FunctionTypes.AsyncFunctionExpression:
                            case FunctionTypes.AsyncMethod:
                            case FunctionTypes.GetAccessor:
                            case FunctionTypes.SetAccessor:
                            case FunctionTypes.Constructor:
                            case FunctionTypes.DerivedConstructor:
                                defineVariable(scope, SpecialVariable.This, VariableType.Var)
                                scope[SpecialVariable.This] = self
                                defineVariable(scope, SpecialVariable.NewTarget, VariableType.Var)
                                scope[SpecialVariable.NewTarget] = undefined
                                scope['arguments'] = getArgumentObject(scope, fn)
                        }

                        switch (functionType) {
                            case FunctionTypes.FunctionExpression:
                            case FunctionTypes.MethodDeclaration:
                            case FunctionTypes.GeneratorExpression:
                            case FunctionTypes.GeneratorMethod:
                            case FunctionTypes.AsyncFunctionExpression:
                            case FunctionTypes.AsyncMethod:
                                if (name !== '') {
                                    scope[name] = fn
                                }
                        }

                        for (let v of variables) {
                            defineVariable(scope, v[Fields.name], v[Fields.type])
                        }

                        for (let [index, name] of argumentNames.entries()) {
                            scope[name] = parameters[index]
                        }
                    } else if (invokeType === InvokeType.Construct) {
                        const name = popCurrentFrameStack<string>()
                        const fn = popCurrentFrameStack()
                        const newTarget = popCurrentFrameStack<{ new(...args: any[]): any } >()

                        const scope: Scope = getEmptyObject()
                        currentFrame[Fields.scopes].push(scope)

                        switch (functionType) {
                            case FunctionTypes.MethodDeclaration:
                            case FunctionTypes.GeneratorMethod:
                            case FunctionTypes.AsyncMethod:
                            case FunctionTypes.GetAccessor:
                            case FunctionTypes.SetAccessor:
                                throw new TypeError('- not a constructor')
                            case FunctionTypes.FunctionDeclaration:
                            case FunctionTypes.FunctionExpression:
                            case FunctionTypes.Constructor:
                                defineVariable(scope, SpecialVariable.This, VariableType.Var)
                                scope[SpecialVariable.This] = Object.create(newTarget.prototype)
                                defineVariable(scope, SpecialVariable.NewTarget, VariableType.Var)
                                scope[SpecialVariable.NewTarget] = newTarget
                                scope['arguments'] = getArgumentObject(scope, fn)
                                break
                            case FunctionTypes.DerivedConstructor:
                                defineVariable(scope, SpecialVariable.This, VariableType.Let)
                                defineVariable(scope, SpecialVariable.NewTarget, VariableType.Var)
                                scope[SpecialVariable.NewTarget] = newTarget
                                scope['arguments'] = getArgumentObject(scope, fn)
                                break
                        }

                        switch (functionType) {
                            case FunctionTypes.FunctionExpression:
                                scope[name] = fn
                        }

                        for (let v of variables) {
                            defineVariable(scope, v[Fields.name], v[Fields.type])
                        }

                        for (let [index, name] of argumentNames.entries()) {
                            scope[name] = parameters[index]
                        }
                    }
                }
                    break
                case OpCode.EnterScope: {
                    const variableCount: number = popCurrentFrameStack()
                    const variables: VariableRecord[] = []
                    for (let i = 0; i < variableCount; i++) {
                        variables.push({
                            [Fields.type]: popCurrentFrameStack(),
                            [Fields.name]: popCurrentFrameStack()
                        })
                    }

                    const scope: Scope = getEmptyObject()
                    currentFrame[Fields.scopes].push(scope)

                    for (let v of variables) {
                        defineVariable(scope, v[Fields.name], v[Fields.type])
                    }
                }
                    break
                case OpCode.LeaveScope: {
                    currentFrame[Fields.scopes].pop()
                }
                    break
                case OpCode.DeTDZ: {
                    const env: Frame = peak(currentFrame[Fields.valueStack], 2)
                    const name = peak(currentFrame[Fields.valueStack])
                    const scope = findScope(env, name)
                    if (scope) {
                        const desc = getVariableDescriptor(scope, name)
                        if (desc) desc[Fields.tdz] = false
                    }
                }
                    break
                case OpCode.FreezeVariable: {
                    const env: Frame = peak(currentFrame[Fields.valueStack], 2)
                    const name = peak(currentFrame[Fields.valueStack])
                    const scope = findScope(env, name)
                    if (scope) {
                        const desc = getVariableDescriptor(scope, name)
                        if (desc) desc[Fields.immutable] = true
                    }
                }
                    break
                case OpCode.DefineFunction: {
                    const type = popCurrentFrameStack<FunctionTypes>()
                    const offset = popCurrentFrameStack<number>()
                    const name = popCurrentFrameStack<string>()
                    pushCurrentFrameStack(defineFunction(currentFrame[Fields.globalThis], currentFrame[Fields.scopes], name, type, offset))
                }
                    break
                case OpCode.CallValue:

                case OpCode.Call: 
                case OpCode.CallAsEval: {
                    const parameterCount: number = popCurrentFrameStack()
                    let parameters: any[] = []
                    for (let i = 0; i < parameterCount; i++) {
                        parameters.unshift(popCurrentFrameStack())
                    }

                    let fn, envOrRecord, name = ''

                    if (command === OpCode.Call || command === OpCode.CallAsEval) {
                        name = popCurrentFrameStack()
                        envOrRecord = popCurrentFrameStack()
                        fn = getValue(envOrRecord, name)
                    } else /** if (command === OpCode.CallValue) */ {
                        envOrRecord = undefined
                        fn = popCurrentFrameStack()
                    }

                    while (fn === CALL || fn === APPLY || bindInfo.has(fn)) {
                        let newFn, newSelf, newParameters
                        if (fn === CALL) {
                            newFn = envOrRecord
                            newSelf = parameters[0]
                            newParameters = parameters.slice(1)
                        } else if (fn === APPLY) {
                            newFn = envOrRecord
                            newSelf = parameters[0]
                            const parameterArrayLike = parameters != null ? parameters[1] : []
                            const parameterLength = parameterArrayLike.length
                            newParameters = []
                            for (let i = 0; i < parameterLength; i++) {
                                newParameters.push(parameterArrayLike[i])
                            }
                        } else /* if (bindInfo.has(fn))*/ {
                            const info0 = bindInfo.get(fn)
                            const info = info0!
                            newSelf = info[Fields.self]
                            newParameters = [...info[Fields.arguments], ...parameters]
                            newFn = info[Fields.function]
                        }

                        fn = environments.has(newFn) ? undefined : newFn
                        envOrRecord = newSelf
                        parameters = newParameters
                    }

                    let self = undefined

                    if (!environments.has(envOrRecord)) {
                        self = envOrRecord
                    }

                    const fnTarget = functionRedirects.has(fn) ? functionRedirects.get(fn) : fn

                    if (fn === BIND) {
                        const bound = bindInternal(self, parameters[0], parameters.slice(1))
                        pushCurrentFrameStack(bound)
                    } else if (
                        !functionDescriptors.has(fnTarget) ||
                        isAsyncType(functionDescriptors.get(fnTarget)![Fields.type])
                    ) {
                        // extern or async wrapper
                        if (typeof fnTarget !== 'function') {
                            if (command === OpCode.Call || command === OpCode.CallAsEval) {
                                throw new TypeError(`(intermediate value).${name} is not a function`)
                            } else /* if (command === OpCode.CallValue) */ {
                                throw new TypeError(`(intermediate value) is not a function`)
                            }
                        } else {
                            if (fnTarget === EVAL_FUNCTION) {
                                if (command === OpCode.CallAsEval) {
                                    pushCurrentFrameStack(emulateEval(String(parameters[0]), true))
                                } else {
                                    pushCurrentFrameStack(emulateEval(String(parameters[0]), false))
                                }
                            } else {
                                const state: GeneratorState | undefined = generatorStates.get(fnTarget)
                                if (state) {
                                    const val = parameters[0]

                                    if (state.completed) {
                                        if (fnTarget === state.gen.throw) {
                                            throw val
                                        }
                                        pushCurrentFrameStack({ value: undefined, done: true })
                                        break command
                                    }

                                    // Initial-state: .throw completes immediately with the error,
                                    // .return completes immediately with { value, done: true }.
                                    if (!state.started) {
                                        if (fnTarget === state.gen.throw) {
                                            state.completed = true
                                            state.stack = []
                                            throw val
                                        }
                                        if (fnTarget === state.gen.return) {
                                            state.completed = true
                                            state.stack = []
                                            pushCurrentFrameStack({ value: val, done: true })
                                            break command
                                        }
                                    }

                                    // Determine which method was called and set pending action accordingly.
                                    if (fnTarget === state.gen.throw) {
                                        state.pendingAction = { type: 'throw', value: val }
                                    } else if (fnTarget === state.gen.return) {
                                        state.pendingAction = { type: 'return', value: val }
                                    } else {
                                        state.pendingAction = null
                                    }

                                    const wasStarted = state.started
                                    state.started = true

                                    // Resuming handover: set base frame's return address to caller's ptr.
                                    ;(state.stack[0] as any)[Fields.return] = ptr

                                    stack.push(...state.stack)
                                    state.stack = []

                                    // On resume after a prior yield, the input value seeds the yield expression.
                                    // On the very first .next(), there is no pending yield so we push nothing.
                                    if (wasStarted) {
                                        peak(stack)[Fields.valueStack].push(val)
                                    }

                                    ptr = state.ptr
                                    currentProgram = peak(stack)[Fields.programSection]
                                    return { [Fields.done]: false }
                                } else {
                                    pushCurrentFrameStack(Reflect.apply(fnTarget, self, parameters))
                                }
                            }
                        }
                    } else if (isGeneratorType(functionDescriptors.get(fnTarget)![Fields.type])) {
                        const des = functionDescriptors.get(fnTarget)!
                        const iterator = createGeneratorFromExecution(
                            des[Fields.programSection],
                            des[Fields.offset],
                            des[Fields.globalThis],
                            [...des[Fields.scopes]],
                            {
                                [Fields.type]: InvokeType.Apply,
                                [Fields.function]: fnTarget,
                                [Fields.name]: des[Fields.name],
                                [Fields.self]: self
                            },
                            parameters
                        )
                        pushCurrentFrameStack(iterator)
                    } else {
                        const des = functionDescriptors.get(fnTarget)!
                        const newFrame: Frame = {
                            [Fields.type]: FrameType.Function,
                            [Fields.scopes]: [...des[Fields.scopes]],
                            [Fields.return]: ptr,
                            [Fields.valueStack]: [
                                self,
                                fnTarget,
                                des[Fields.name],
                                InvokeType.Apply,
                                ...parameters,
                                parameters.length
                            ],
                            [Fields.invokeType]: InvokeType.Apply,
                            [Fields.programSection]: des[Fields.programSection],
                            [Fields.globalThis]: des[Fields.globalThis],
                            [Fields.generator]: currentFrame[Fields.generator]
                        }
                        environments.add(newFrame)

                        stack.push(newFrame)
                        ptr = des[Fields.offset]
                        currentProgram = des[Fields.programSection]
                    }
                }
                    break
                case OpCode.SuperCall: {
                    const parameterCount: number = popCurrentFrameStack()
                    let parameters: any[] = []

                    for (let i = 0; i < parameterCount; i++) {
                        parameters.unshift(popCurrentFrameStack())
                    }

                    let fn = popCurrentFrameStack<(...args: any[]) => any>()
                    let newTarget = popCurrentFrameStack<any>()

                    if (!functionDescriptors.has(fn)) {
                        // extern
                        const instance = Reflect.construct(fn, parameters, newTarget)
                        pushCurrentFrameStack(instance)
                    } else {
                        const des = functionDescriptors.get(fn)!
                        const newFrame: Frame = {
                            [Fields.type]: FrameType.Function,
                            [Fields.scopes]: [...des[Fields.scopes]],
                            [Fields.return]: ptr,
                            [Fields.valueStack]: [
                                newTarget,
                                fn,
                                des[Fields.name],
                                InvokeType.Construct,
                                ...parameters,
                                parameters.length
                            ],
                            [Fields.invokeType]: InvokeType.Construct,
                            [Fields.programSection]: des[Fields.programSection],
                            [Fields.globalThis]: des[Fields.globalThis],
                            [Fields.generator]: currentFrame[Fields.generator]
                        }
                        environments.add(newFrame)

                        stack.push(newFrame)
                        ptr = des[Fields.offset]
                        currentProgram = des[Fields.programSection]
                    }
                }
                    break
                case OpCode.New: {
                    const parameterCount: number = popCurrentFrameStack()
                    let parameters: any[] = []

                    for (let i = 0; i < parameterCount; i++) {
                        parameters.unshift(popCurrentFrameStack())
                    }

                    let fn = popCurrentFrameStack<(...args: any[]) => any>()

                    while (bindInfo.has(fn)) {
                        let newFn, newParameters

                        const info0 = bindInfo.get(fn)
                        const info = info0!
                        newParameters = [...info[Fields.arguments], ...parameters]
                        newFn = info[Fields.function]

                        fn = environments.has(newFn) ? undefined : newFn
                        parameters = newParameters
                    }

                    if (!functionDescriptors.has(fn)) {
                        // extern
                        pushCurrentFrameStack(Reflect.construct(fn, parameters, fn))
                    } else {
                        const des = functionDescriptors.get(fn)!
                        const newFrame: Frame = {
                            [Fields.type]: FrameType.Function,
                            [Fields.scopes]: [...des[Fields.scopes]],
                            [Fields.return]: ptr,
                            [Fields.valueStack]: [
                                fn,
                                fn,
                                des[Fields.name],
                                InvokeType.Construct,
                                ...parameters,
                                parameters.length
                            ],
                            [Fields.invokeType]: InvokeType.Construct,
                            [Fields.programSection]: des[Fields.programSection],
                            [Fields.globalThis]: des[Fields.globalThis],
                            [Fields.generator]: currentFrame[Fields.generator]
                        }
                        environments.add(newFrame)

                        stack.push(newFrame)
                        ptr = des[Fields.offset]
                        currentProgram = des[Fields.programSection]
                    }
                }
                    break
                case OpCode.Return: {
                    const result = popCurrentFrameStack()
                    // valueStack is per-frame, so the invariant is about the frame we actually
                    // just popped from. Capture it now; check it below once we know the frame's
                    // function-ness and gen-ness.
                    const topResidue = currentFrame[Fields.valueStack].length
                    const topWasFunction = currentFrame[Fields.type] === FrameType.Function

                    // remove all try frames
                    while (peak(stack)[Fields.type] !== FrameType.Function) {
                        stack.pop()
                    }

                    const functionFrame = peak(stack) as FunctionFrame
                    const returnAddr = functionFrame[Fields.return]
                    const genState = functionFrame[Fields.generator] as GeneratorState | undefined
                    const isGenBase = !!(genState && genState.baseFrame === functionFrame)

                    // Sanity check: normal functions must return with an empty valueStack — any
                    // residue indicates compiler/opcode bookkeeping corruption. Only meaningful
                    // when Return ran directly on the function frame (a try-frame residue is
                    // legal transient state that gets discarded with the frame). Generators are
                    // exempt: yield/yield*/handover can legitimately leave values behind.
                    if (
                        topWasFunction
                        && !functionFrame[Fields.generator]
                        && topResidue > 0
                    ) {
                        throw new Error('bad return')
                    }

                    if (isGenBase) {
                        // Generator completing. Produce IteratorResult for the caller.
                        genState!.completed = true
                        genState!.stack = []
                        stack.pop()

                        if (returnAddr < 0) {
                            // No VM caller — host-side completion.
                            returnsExternal = true
                            returnValue = { value: result, done: true }
                            break command
                        }

                        const prevFrame = peak(stack)
                        prevFrame[Fields.valueStack].push({ value: result, done: true })
                        ptr = returnAddr
                        currentProgram = prevFrame[Fields.programSection]
                        break command
                    }

                    if (returnAddr < 0) {
                        // leave the whole function
                        if (functionFrame[Fields.invokeType] === InvokeType.Apply) {
                            returnsExternal = true
                            returnValue = result
                            break command
                        } else {
                            if (result !== null && (typeof result === 'function' || typeof result === 'object')) {
                                returnsExternal = true
                                returnValue = result
                                break command
                            } else {
                                returnsExternal = true
                                returnValue = getValue(functionFrame, SpecialVariable.This)
                                break command
                            }
                        }
                    }

                    stack.pop()

                    const prevFrame = peak(stack)

                    if (functionFrame[Fields.invokeType] === InvokeType.Apply) {
                        prevFrame[Fields.valueStack].push(result)
                    } else {
                        if (result !== null && (typeof result === 'function' || typeof result === 'object')) {
                            prevFrame[Fields.valueStack].push(result)
                        } else {
                            prevFrame[Fields.valueStack].push(getValue(functionFrame, SpecialVariable.This))
                        }
                    }

                    ptr = returnAddr
                    currentProgram = prevFrame[Fields.programSection]
                }
                    break
                case OpCode.Throw: {
                    const err = popCurrentFrameStack()
                    throw err
                }
                case OpCode.ThrowReferenceError: {
                    const msg = popCurrentFrameStack<string>()
                    throw new ReferenceError(msg)
                }
                case OpCode.ArrayLiteral:
                    pushCurrentFrameStack([])
                    break
                case OpCode.ArraySpread: {
                    const iterable = popCurrentFrameStack()
                    const arr = popCurrentFrameStack<any[]>()
                    if (!Array.isArray(arr)) {
                        throw new TypeError('ArraySpread expects an array')
                    }
                    const iterator = getIterator(iterable)
                    while (true) {
                        const result = iteratorNext(iterator)
                        if (iteratorComplete(result)) {
                            break
                        }
                        arr.push(result.value)
                    }
                    pushCurrentFrameStack(arr)
                }
                    break
                case OpCode.ObjectLiteral:
                    pushCurrentFrameStack({})
                    break
                case OpCode.InitTryCatch: {
                    const catchName = popCurrentFrameStack<string>()
                    const finallyAddr = popCurrentFrameStack<number>()
                    const catchAddr = popCurrentFrameStack<number>()
                    const exitAddr = popCurrentFrameStack<number>()

                    const frame: TryFrame = {
                        [Fields.type]: FrameType.Try,
                        [Fields.savedScopes]: currentFrame[Fields.scopes],
                        [Fields.scopes]: currentFrame[Fields.scopes].slice(0),
                        [Fields.valueStack]: [],
                        [Fields.state]: TryCatchFinallyState.Try,
                        [Fields.resolveType]: ResolveType.normal,
                        [Fields.value]: undefined,
                        [Fields.catch]: catchAddr,
                        [Fields.finally]: finallyAddr,
                        [Fields.break]: 0,
                        [Fields.depth]: 0,
                        [Fields.variable]: catchName,
                        [Fields.exit]: exitAddr,
                        [Fields.programSection]: currentProgram,
                        [Fields.globalThis]: currentFrame[Fields.globalThis],
                        [Fields.generator]: currentFrame[Fields.generator]
                    }

                    environments.add(frame)

                    stack.push(frame)
                }
                    break
                case OpCode.ReturnInTryCatchFinally:
                    initiateReturn()

                    break;
                case OpCode.ThrowInTryCatchFinally:
                    initiateThrow()

                    break
                case OpCode.BreakInTryCatchFinally:
                    initiateBreak()

                    break
                case OpCode.ExitTryCatchFinally: {
                    const frame = currentFrame as TryFrame
                    const prevState = frame[Fields.state]
                    const prevResolveType = frame[Fields.resolveType]
                    const prevValue = frame[Fields.value]
                    const exit = frame[Fields.exit]
                    const finallyPtr = frame[Fields.finally]

                    // restore scopes
                    frame[Fields.scopes] = frame[Fields.savedScopes].slice(0)

                    switch (prevState) {
                        case TryCatchFinallyState.Finally:
                            switch (prevResolveType) {
                                case ResolveType.normal:
                                    ptr = exit
                                    break command
                                case ResolveType.throw:
                                    executeThrow(prevValue)
                                    break command
                                case ResolveType.return:
                                    executeReturn(prevValue)
                                    break command
                                case ResolveType.break:
                                    executeBreak()
                                    break command
                            }
                        case TryCatchFinallyState.Try:
                        case TryCatchFinallyState.Catch:
                            if (frame[Fields.finally] >= 0) {
                                frame[Fields.state] = TryCatchFinallyState.Finally
                                frame[Fields.resolveType] = ResolveType.normal
                                frame[Fields.value] = undefined

                                ptr = finallyPtr
                                break command
                            } else {
                                ptr = exit
                                break command
                            }
                        default:
                            const nothing: never = prevState;
                    }
                }
                    break;
                case OpCode.Typeof: {
                    const value = popCurrentFrameStack()
                    pushCurrentFrameStack(typeof value)
                }
                    break
                case OpCode.TypeofReference: {
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Context>()
                    if (environments.has(ctx)) {
                        const frame: Frame = ctx
                        for (let i = frame[Fields.scopes].length - 1; i >= 0; i--) {
                            if (Reflect.getOwnPropertyDescriptor(frame[Fields.scopes][i], name)) {
                                pushCurrentFrameStack(typeof frame[Fields.scopes][i][name]) 
                                break command;
                            }
                        }
                        pushCurrentFrameStack('undefined') 
                    } else {
                        pushCurrentFrameStack(typeof ctx[name])
                    }
                }
                    break
                case OpCode.GetPropertyIterator: {
                    const value = popCurrentFrameStack()
                    const iterator = (function * (value: any) {
                        for (const key in value) {
                            yield key
                        }
                    })(value)
                    pushCurrentFrameStack(iterator)
                }
                    break
                case OpCode.NextEntry: {
                    const iterator: Iterator<any> = popCurrentFrameStack()
                    pushCurrentFrameStack(iterator.next())
                }
                    break
                case OpCode.EntryIsDone: {
                    const entry: IteratorResult<any> = popCurrentFrameStack()
                    pushCurrentFrameStack(entry.done)
                }
                    break
                case OpCode.EntryGetValue: {
                    const entry: IteratorResult<any> = popCurrentFrameStack()
                    pushCurrentFrameStack(entry.value)
                }
                    break
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
                case OpCode.BEqualsEquals:
                case OpCode.BEqualsEqualsEquals:
                case OpCode.BExclamationEquals:
                case OpCode.BExclamationEqualsEquals:
                case OpCode.BMinus:
                case OpCode.BPlus:
                case OpCode.BIn:
                case OpCode.BAsterisk:
                case OpCode.BSlash: 
                case OpCode.BPercent: {
                    const right = popCurrentFrameStack()
                    const left = popCurrentFrameStack()
                    const ops = {
                        [OpCode.BAmpersand]: (left: any, right: any) => left & right,
                        [OpCode.BBar]: (left: any, right: any) => left | right,
                        [OpCode.BCaret]: (left: any, right: any) => left ^ right,
                        [OpCode.BEqualsEquals]: (left: any, right: any) => left == right,
                        [OpCode.BEqualsEqualsEquals]: (left: any, right: any) => left === right,
                        [OpCode.BExclamationEquals]: (left: any, right: any) => left != right,
                        [OpCode.BExclamationEqualsEquals]: (left: any, right: any) => left !== right,
                        [OpCode.BGreaterThan]: (left: any, right: any) => left > right,
                        [OpCode.BGreaterThanGreaterThan]: (left: any, right: any) => left >> right,
                        [OpCode.BGreaterThanGreaterThanGreaterThan]: (left: any, right: any) => left >>> right,
                        [OpCode.BGreaterThanEquals]: (left: any, right: any) => left >= right,
                        [OpCode.BLessThan]: (left: any, right: any) => left < right,
                        [OpCode.BLessThanLessThan]: (left: any, right: any) => left << right,
                        [OpCode.BLessThanEquals]: (left: any, right: any) => left <= right,
                        [OpCode.BPlus]: (left: any, right: any) => left + right,
                        [OpCode.BMinus]: (left: any, right: any) => left - right,
                        [OpCode.InstanceOf]: (left: any, right: any) => left instanceof right,
                        [OpCode.BIn]: (left: any, right: any) => left in right,
                        [OpCode.BAsterisk]: (left: any, right: any) => left * right,
                        [OpCode.BSlash]: (left: any, right: any) => left / right,
                        [OpCode.BPercent]: (left: any, right: any) => left % right
                    }
                    const result = ops[command](left, right)
                    pushCurrentFrameStack(result)
                }
                    break;
                case OpCode.PostFixPlusPLus:
                case OpCode.PostFixMinusMinus: {
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Context>()
                    if (environments.has(ctx)) {
                        const env: Frame = ctx
                        const scope = findScope(env, name)

                        if (scope) {
                            const old = scope[name]
                            const newVal = command === OpCode.PostFixPlusPLus ? old + 1 : old - 1
                            scope[name] = newVal
                            pushCurrentFrameStack(old)
                        } else {
                            throw new ReferenceError(name + is_not_defined)
                        }
                    } else {
                        const self = ctx
                        const old = self[name]
                        const newVal = command === OpCode.PostFixPlusPLus ? old + 1 : old - 1
                        self[name] = newVal
                        pushCurrentFrameStack(old)
                    }
                }
                    break;
                case OpCode.PrefixUnaryPlus:
                case OpCode.PrefixUnaryMinus: 
                case OpCode.PrefixExclamation:
                case OpCode.PrefixTilde: {
                    const value = popCurrentFrameStack<any>()
                    let result
                    switch (command) {
                        case OpCode.PrefixUnaryPlus:
                            result = +value
                            break
                        case OpCode.PrefixUnaryMinus:
                            result = -value
                            break
                        case OpCode.PrefixExclamation:
                            result = !value
                            break
                        case OpCode.PrefixTilde:
                            result = ~value
                            break
                    }
                    pushCurrentFrameStack(result)
                }
                    break
                // Prefix updates
                case OpCode.PrefixPlusPlus:
                case OpCode.PrefixMinusMinus: {
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack()

                    const currentValue = getValue(ctx, name)
                    const newVal = command === OpCode.PrefixPlusPlus ? currentValue + 1 : currentValue - 1
                    setValue(ctx, name, newVal)

                    // Just don't care and push the new value
                    pushCurrentFrameStack(newVal)
                }
                    break;
                case OpCode.Delete: {
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Record<string, any>>()
                    if (!environments.has(ctx)) {
                        pushCurrentFrameStack(delete ctx[name])
                    } else {
                        const env: Frame = ctx
                        const scope = findScope(env, name)

                        if (scope) {
                            pushCurrentFrameStack(delete scope[name])
                        } else {
                            pushCurrentFrameStack(true)
                        }
                    }
                }
                    break
                case OpCode.Debugger: {
                    const debugFn = getDebugFunction()

                    if (debugFn) {
                        debugFn()
                    } else {
                        debugger
                    }
                }
                    break;
                case OpCode.CreateClass: {
                    const name = popCurrentFrameStack<string>()
                    const superClass = popCurrentFrameStack<any>()
                    const ctorFn = popCurrentFrameStack<any>()

                    let classFn: any
                    if (ctorFn === undefined) {
                        // Default constructor
                        if (superClass !== null) {
                            // Default derived: constructor(...args) { super(...args) }
                            classFn = function (this: any, ...args: any[]) {
                                return Reflect.construct(superClass, args, new.target)
                            }
                        } else {
                            // Default base: constructor() {}
                            classFn = function () {}
                        }
                        Object.defineProperty(classFn, 'name', { value: name, configurable: true })
                    } else {
                        classFn = ctorFn
                    }

                    if (superClass !== null) {
                        // Set up prototype chain
                        classFn.prototype = Object.create(superClass.prototype)
                        Object.defineProperty(classFn.prototype, 'constructor', {
                            value: classFn,
                            writable: true,
                            configurable: true,
                            enumerable: false
                        })
                        // Static inheritance
                        Object.setPrototypeOf(classFn, superClass)
                    }

                    pushCurrentFrameStack(classFn)
                }
                    break;
                case OpCode.DefineMethod: {
                    const fn = popCurrentFrameStack()
                    const name = popCurrentFrameStack<string>()
                    const obj = popCurrentFrameStack<Record<string, any>>()

                    Object.defineProperty(obj, name, {
                        value: fn,
                        writable: true,
                        configurable: true,
                        enumerable: false
                    })

                    pushCurrentFrameStack(obj)
                }
                    break;
                case OpCode.DefineGetter: {
                    const fn = popCurrentFrameStack()
                    const name = popCurrentFrameStack<string>()
                    const obj = popCurrentFrameStack<Record<string, any>>()

                    const existing = Object.getOwnPropertyDescriptor(obj, name) || {}
                    Object.defineProperty(obj, name, {
                        get: fn as () => any,
                        set: existing.set,
                        configurable: true,
                        enumerable: false
                    })

                    pushCurrentFrameStack(obj)
                }
                    break;
                case OpCode.DefineSetter: {
                    const fn = popCurrentFrameStack()
                    const name = popCurrentFrameStack<string>()
                    const obj = popCurrentFrameStack<Record<string, any>>()

                    const existing = Object.getOwnPropertyDescriptor(obj, name) || {}
                    Object.defineProperty(obj, name, {
                        get: existing.get,
                        set: fn as (v: any) => void,
                        configurable: true,
                        enumerable: false
                    })

                    pushCurrentFrameStack(obj)
                }
                    break;
                case OpCode.Yield: {
                    const value = popCurrentFrameStack()
                    const state = currentFrame[Fields.generator] as GeneratorState | undefined
                    if (!state) {
                        throw new Error('yield outside of generator')
                    }

                    // Save the resume point (the next instruction — YieldResume).
                    state.ptr = ptr

                    // Scan from top: find nearest frame whose owner is NOT this gen — that's the split.
                    let genStart = stack.length
                    while (genStart > 0 && stack[genStart - 1][Fields.generator] === state) {
                        genStart--
                    }
                    const genFrames = stack.splice(genStart)
                    state.stack = genFrames

                    if (stack.length > 0) {
                        // Hand control back to the VM caller (it.next()/throw/return via Call opcode).
                        ptr = (genFrames[0] as any)[Fields.return]
                        const callerFrame = peak(stack)
                        currentProgram = callerFrame[Fields.programSection]
                        callerFrame[Fields.valueStack].push({ value, done: false })
                        return { [Fields.done]: false }
                    }

                    // No VM caller — host-side suspension.
                    return {
                        [Fields.done]: false,
                        [Fields.yield]: true as const,
                        [Fields.value]: value
                    }
                }
                case OpCode.YieldResume: {
                    const state = currentFrame[Fields.generator] as GeneratorState | undefined
                    if (state && state.pendingAction) {
                        const action = state.pendingAction
                        state.pendingAction = null
                        // Discard the value pushed by the resuming Call opcode; the action supersedes it.
                        popCurrentFrameStack()
                        if (action.type === 'throw') {
                            throw action.value
                        }
                        // action.type === 'return' — unwind through try/finally.
                        executeReturn(action.value)
                        break command
                    }
                    // Normal resume: input value already on stack becomes the yield expression's result.
                    break
                }
                case OpCode.YieldStar: {
                    const frame = currentFrame as any
                    const outerState = frame[Fields.generator] as GeneratorState | undefined
                    let delegate = frame[Fields.delegate] as { iter: any, phase: number } | undefined

                    // Helper: outer yields `value` to its caller; on resume we re-enter YieldStar.
                    const relayYield = (value: any): Result => {
                        if (!outerState) {
                            ptr = commandPtr // stay at YieldStar for host-side re-entry
                            return {
                                [Fields.done]: false,
                                [Fields.yield]: true as const,
                                [Fields.value]: value
                            }
                        }
                        outerState.ptr = commandPtr
                        let genStart = stack.length
                        while (genStart > 0 && stack[genStart - 1][Fields.generator] === outerState) {
                            genStart--
                        }
                        const genFrames = stack.splice(genStart)
                        outerState.stack = genFrames
                        if (stack.length > 0) {
                            ptr = (genFrames[0] as any)[Fields.return]
                            const cFrame = peak(stack)
                            currentProgram = cFrame[Fields.programSection]
                            cFrame[Fields.valueStack].push({ value, done: false })
                            return { [Fields.done]: false }
                        }
                        return {
                            [Fields.done]: false,
                            [Fields.yield]: true as const,
                            [Fields.value]: value
                        }
                    }

                    // Phase 1: sub-iterator just produced a result (yield or return) and handed control back.
                    if (delegate && delegate.phase === 1) {
                        const subResult = popCurrentFrameStack<any>()
                        if (subResult && subResult.done) {
                            const lastMode = (delegate as any).pendingMode
                            frame[Fields.delegate] = null
                            if (lastMode === 'return') {
                                // yield* forwarded a .return to sub; when sub completes, outer returns too.
                                executeReturn(subResult.value)
                                break command
                            }
                            pushCurrentFrameStack(subResult.value)
                            break command
                        }
                        delegate.phase = 2
                        return relayYield(subResult.value)
                    }

                    // Phase 0 (initial) / Phase 2 (resumed by outer caller): need to invoke iter's method.
                    let iter: any
                    let sentVal: any
                    let mode: 'next' | 'throw' | 'return' = 'next'

                    if (!delegate) {
                        const iterable = popCurrentFrameStack<any>()
                        iter = getIterator(iterable)
                        delegate = { iter, phase: 0 }
                        frame[Fields.delegate] = delegate
                        sentVal = undefined
                        // First iter.next is always plain 'next' with undefined seed.
                    } else {
                        iter = delegate.iter
                        // Resuming from outer yield. Outer's pendingAction governs the method to dispatch.
                        sentVal = popCurrentFrameStack()
                        if (outerState && outerState.pendingAction) {
                            mode = outerState.pendingAction.type
                            sentVal = outerState.pendingAction.value
                            outerState.pendingAction = null
                        }
                    }

                    // Dispatch. For VM gens, reuse state-based handover. For host iterators, call directly.
                    const methodFn = mode === 'next' ? iter.next
                        : mode === 'throw' ? iter.throw
                        : iter.return
                    const subState = methodFn ? generatorStates.get(methodFn) : undefined

                    if (subState) {
                        // VM generator
                        if (subState.completed) {
                            frame[Fields.delegate] = null
                            if (mode === 'throw') throw sentVal
                            if (mode === 'return') {
                                executeReturn(sentVal)
                                break command
                            }
                            pushCurrentFrameStack(undefined)
                            break command
                        }

                        if (!subState.started) {
                            if (mode === 'throw') {
                                subState.completed = true
                                subState.stack = []
                                frame[Fields.delegate] = null
                                throw sentVal
                            }
                            if (mode === 'return') {
                                subState.completed = true
                                subState.stack = []
                                frame[Fields.delegate] = null
                                executeReturn(sentVal)
                                break command
                            }
                        }

                        if (mode === 'throw') subState.pendingAction = { type: 'throw', value: sentVal }
                        else if (mode === 'return') subState.pendingAction = { type: 'return', value: sentVal }
                        else subState.pendingAction = null

                        const wasStarted = subState.started
                        subState.started = true

                        ;(subState.stack[0] as any)[Fields.return] = commandPtr
                        stack.push(...subState.stack)
                        subState.stack = []

                        if (wasStarted) {
                            peak(stack)[Fields.valueStack].push(sentVal)
                        }

                        delegate.phase = 1
                        ;(delegate as any).pendingMode = mode
                        ptr = subState.ptr
                        currentProgram = peak(stack)[Fields.programSection]
                        return { [Fields.done]: false }
                    }

                    // Host iterator (ES6 Iterator interface: next/throw/return return IteratorResult objects)
                    let result: { done?: unknown, value?: unknown }
                    if (mode === 'throw') {
                        if (!iter.throw) {
                            if (iter.return) { try { iter.return() } catch (_) {} }
                            frame[Fields.delegate] = null
                            throw sentVal
                        }
                        result = assertIteratorResult(iter.throw(sentVal))
                    } else if (mode === 'return') {
                        if (!iter.return) {
                            frame[Fields.delegate] = null
                            executeReturn(sentVal)
                            break command
                        }
                        result = assertIteratorResult(iter.return(sentVal))
                        if (iteratorComplete(result)) {
                            frame[Fields.delegate] = null
                            executeReturn(result.value)
                            break command
                        }
                    } else {
                        result = iteratorNext(iter, sentVal)
                    }

                    if (iteratorComplete(result)) {
                        frame[Fields.delegate] = null
                        pushCurrentFrameStack(result.value)
                        break command
                    }

                    delegate.phase = 2
                    return relayYield(result.value)
                }
                case OpCode.Await: {
                    const value = popCurrentFrameStack()
                    return {
                        [Fields.done]: false,
                        [Fields.await]: true as const,
                        [Fields.value]: value
                    }
                }
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
    compileFunction: typeof import('./compiler').compile | undefined = undefined,
    functionRedirects: WeakMap<Function, Function> = new WeakMap()
) => {
    const execution = getExecution(program, entryPoint, globalThis, scopes, invokeData, args, getDebugFunction, compileFunction, functionRedirects)

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

const run = (
    program: number[],
    entryPoint: number = 0,
    globalThis: object,
    scopes: Scope[] = [],
    self: undefined = undefined,
    args: any[] = [],
    compileFunction: typeof import('./compiler').compile | undefined = undefined,
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

export {
    getExecution,
    run
}