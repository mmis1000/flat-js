import { FunctionTypes, InvokeType, LiteralPoolKind, ResolveType, TryCatchFinallyState, VariableType } from "../compiler"
import { TEXT_DADA_MASK, isSmallNumber, literalPoolWordMask } from "../compiler/shared"

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
    if (label === LiteralPoolKind.BigInt) {
        let s = ''
        for (let i = 0; i < length; i++) {
            const w = (program[pos + 2 + i] ^ literalPoolWordMask(pos + 2 + i)) | 0
            s += String.fromCharCode(w & 0xffff)
        }
        return BigInt(s)
    }
    throw new Error('bad literal pool entry')
}

/** Pool entry starts at `pos` (`label` word). Same buffer shares one sparse cache so literals decode once per program. */
const literalPoolCache = new WeakMap<number[], any[]>()

const getLiteralFromPool = (program: number[], pos: number): any => {
    let byPos = literalPoolCache.get(program)
    if (!byPos) {
        byPos = []
        literalPoolCache.set(program, byPos)
    }
    const cached = byPos[pos]
    if (cached !== undefined) {
        return cached
    }
    const value = decodeLiteralFromProgram(program, pos)
    byPos[pos] = value
    return value
}

const CALL = Function.prototype.call
const APPLY = Function.prototype.apply
const BIND = Function.prototype.bind
const REGEXP = RegExp
/** Intrinsic `Function` from this realm; used to detect `Function(...)` / `new Function(...)` like `eval`. */
const HOST_FUNCTION = Object.getPrototypeOf(function () {}).constructor

const isPrimitive = (value: unknown) =>
    value === null || (typeof value !== 'object' && typeof value !== 'function')

const toPrimitive = (value: unknown, hint: 'number' | 'string') => {
    if (isPrimitive(value)) {
        return value
    }

    const object = value as Record<PropertyKey, any>
    const exoticToPrim = object[Symbol.toPrimitive]
    if (exoticToPrim !== undefined) {
        if (typeof exoticToPrim !== 'function') {
            throw new TypeError('@@toPrimitive must be a function')
        }
        const result = exoticToPrim.call(value, hint)
        if (isPrimitive(result)) {
            return result
        }
        throw new TypeError('Cannot convert object to primitive value')
    }

    const methodNames = hint === 'string'
        ? ['toString', 'valueOf']
        : ['valueOf', 'toString']

    for (const methodName of methodNames) {
        const method = object[methodName]
        if (typeof method === 'function') {
            const result = method.call(value)
            if (isPrimitive(result)) {
                return result
            }
        }
    }

    throw new TypeError('Cannot convert object to primitive value')
}

const toPropertyKey = (value: unknown): PropertyKey => {
    const key = toPrimitive(value, 'string')
    return typeof key === 'symbol' ? key : String(key)
}

const toNumeric = (value: unknown): number | bigint => {
    const numeric = toPrimitive(value, 'number')
    return typeof numeric === 'bigint' ? numeric : Number(numeric)
}

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
    strict,
    done,
    yield,
    await,
    delegate,
    pushValue,
    setPendingThrow,
    error,
    generator,
    variableEnvironment,
    bodyOffset,
    completed,
    started,
    pendingAction,
    baseFrame,
    gen,
    execution,
    delegateIterator,
    delegatePhase,
    delegateMode,
}

interface BaseFrame {
    [Fields.type]: FrameType
    [Fields.programSection]: number[]
    [Fields.scopes]: Scope[],
    [Fields.globalThis]: any
    [Fields.strict]?: boolean
    [Fields.valueStack]: any[]
    [Fields.generator]?: any
    [Fields.variableEnvironment]?: Scope | null
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

export const enum VariableFlags {
    None = 0,
    Immutable = 1 << 0,
}

type StaticVariableStore = {
    names: string[],
    flags: number[],
    values: any[]
}

const SCOPE_FLAGS = Symbol()
const SCOPE_STATIC_SLOTS = Symbol()
const SCOPE_STATIC_STORE = Symbol()
const SCOPE_DEBUG_PTR = Symbol()
const SCOPE_WITH_OBJECT = Symbol()
const IDENTIFIER_REFERENCE_FRAME = Symbol()
const IDENTIFIER_REFERENCE_SCOPE = Symbol()
type IdentifierReference = {
    [IDENTIFIER_REFERENCE_FRAME]: Frame
    [IDENTIFIER_REFERENCE_SCOPE]: Scope | null
}

type ScopeWithInternals = Scope & {
    [SCOPE_FLAGS]?: Record<string, number>
    [SCOPE_STATIC_SLOTS]?: Record<string, number>
    [SCOPE_STATIC_STORE]?: StaticVariableStore
    [SCOPE_DEBUG_PTR]?: number
    [SCOPE_WITH_OBJECT]?: object
}

const is_not_defined = ' is not defined'
const is_a_constant = ' is a constant'
const getEmptyObject = Object.create.bind(Object, null, {})
const TDZ_VALUE = Symbol()

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

export type ScopeDebugEntry = [string, unknown, boolean]

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
    [Fields.bodyOffset]: number,
    [Fields.scopes]: Scope[],
    [Fields.programSection]: number[],
    [Fields.globalThis]: any
}

const isGeneratorType = (t: FunctionTypes) =>
    t === FunctionTypes.GeneratorDeclaration ||
    t === FunctionTypes.GeneratorExpression ||
    t === FunctionTypes.GeneratorMethod

const isAsyncGeneratorType = (t: FunctionTypes) =>
    t === FunctionTypes.AsyncGeneratorDeclaration ||
    t === FunctionTypes.AsyncGeneratorExpression ||
    t === FunctionTypes.AsyncGeneratorMethod

const isAsyncType = (t: FunctionTypes) =>
    t === FunctionTypes.AsyncFunctionDeclaration ||
    t === FunctionTypes.AsyncFunctionExpression ||
    t === FunctionTypes.AsyncArrowFunction ||
    t === FunctionTypes.AsyncMethod

const formatFunctionNameKey = (name: PropertyKey): string => {
    if (typeof name !== 'symbol') {
        return String(name)
    }

    return name.description === undefined ? '' : `[${name.description}]`
}

const formatFunctionName = (name: PropertyKey, type?: FunctionTypes): string => {
    const formattedName = formatFunctionNameKey(name)
    if (type === FunctionTypes.GetAccessor) {
        return `get ${formattedName}`
    }
    if (type === FunctionTypes.SetAccessor) {
        return `set ${formattedName}`
    }
    return formattedName
}

const functionDescriptors = new WeakMap<any, FunctionDescriptor>()

const environments = new WeakSet() as unknown as RefinedEnvSet

const bindInfo = new WeakMap<any, { [Fields.function]: any, [Fields.self]: any, [Fields.arguments]: any[] }>()

type PendingAction = {
    [Fields.type]: 'throw' | 'return',
    [Fields.value]: any,
}

type GeneratorDelegateState = {
    [Fields.delegateIterator]: any,
    [Fields.delegatePhase]: number,
    [Fields.delegateMode]?: 'next' | 'throw' | 'return',
}

type GeneratorState = {
    [Fields.stack]: Stack,
    [Fields.ptr]: number,
    [Fields.completed]: boolean,
    [Fields.started]: boolean,
    [Fields.pendingAction]: null | PendingAction,
    [Fields.baseFrame]: Frame | null,
    [Fields.gen]: any,
    [Fields.execution]: Execution
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


export {
    APPLY,
    assertIteratorResult,
    BIND,
    bindInfo,
    CALL,
    decodeLiteralFromProgram,
    environments,
    functionDescriptors,
    formatFunctionName,
    formatFunctionNameKey,
    generatorStates,
    getEmptyObject,
    getIterator,
    getLiteralFromPool,
    HOST_FUNCTION,
    isAsyncType,
    isAsyncGeneratorType,
    is_a_constant,
    isGeneratorType,
    is_not_defined,
    isIteratorYieldDone,
    isResultDone,
    isResultYield,
    isSmallNumber,
    iteratorComplete,
    iteratorNext,
    literalPoolCache,
    literalPoolWordMask,
    REGEXP,
    SCOPE_DEBUG_PTR,
    SCOPE_FLAGS,
    SCOPE_STATIC_SLOTS,
    SCOPE_STATIC_STORE,
    SCOPE_WITH_OBJECT,
    TDZ_VALUE,
    TEXT_DADA_MASK,
    IDENTIFIER_REFERENCE_FRAME,
    IDENTIFIER_REFERENCE_SCOPE,
    toNumeric,
    toPropertyKey,
}

export type {
    BaseFrame,
    Context,
    Execution,
    FunctionDescriptor,
    GeneratorDelegateState,
    FunctionFrame,
    GeneratorState,
    InvokeParamApply,
    InvokeParamConstruct,
    PendingAction,
    RefinedEnvSet,
    ScopeWithInternals,
    StaticVariableStore,
    TryFrame,
    IdentifierReference,
    VariableRecord,
}
