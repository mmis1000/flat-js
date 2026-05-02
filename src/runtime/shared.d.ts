import { FunctionTypes, InvokeType, ResolveType, TryCatchFinallyState, VariableType } from "../compiler";
import { TEXT_DADA_MASK, isSmallNumber, literalPoolWordMask } from "../compiler/shared";
declare const decodeLiteralFromProgram: (program: number[], pos: number) => any;
/** Pool entry starts at `pos` (`label` word). Same buffer shares one sparse cache so literals decode once per program. */
declare const literalPoolCache: WeakMap<number[], any[]>;
declare const getLiteralFromPool: (program: number[], pos: number) => any;
declare const CALL: (this: Function, thisArg: any, ...argArray: any[]) => any;
declare const APPLY: (this: Function, thisArg: any, argArray?: any) => any;
declare const BIND: (this: Function, thisArg: any, ...argArray: any[]) => any;
declare const REGEXP: RegExpConstructor;
/** Intrinsic `Function` from this realm; used to detect `Function(...)` / `new Function(...)` like `eval`. */
declare const HOST_FUNCTION: any;
declare const toPropertyKey: (value: unknown) => PropertyKey;
declare const toNumeric: (value: unknown) => number | bigint;
export declare const enum FrameType {
    Function = 0,
    Try = 1
}
export type Scope = Record<string, any>;
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
    evalResult = 25,
    newTarget = 26,
    break = 27,
    depth = 28,
    globalThis = 29,
    strict = 30,
    done = 31,
    yield = 32,
    await = 33,
    delegate = 34,
    pushValue = 35,
    setPendingThrow = 36,
    error = 37,
    generator = 38,
    variableEnvironment = 39,
    bodyOffset = 40,
    completed = 41,
    started = 42,
    pendingAction = 43,
    baseFrame = 44,
    gen = 45,
    execution = 46,
    delegateIterator = 47,
    delegatePhase = 48,
    delegateMode = 49,
    names = 50,
    flags = 51,
    values = 52,
    savedEvalResult = 53
}
interface BaseFrame {
    [Fields.type]: FrameType;
    [Fields.programSection]: number[];
    [Fields.scopes]: Scope[];
    [Fields.globalThis]: any;
    [Fields.strict]?: boolean;
    [Fields.valueStack]: any[];
    [Fields.generator]?: any;
    [Fields.variableEnvironment]?: Scope | null;
}
interface FunctionFrame extends BaseFrame {
    [Fields.type]: FrameType.Function;
    [Fields.return]: number;
    [Fields.invokeType]: InvokeType;
    [Fields.function]: unknown;
    [Fields.name]: string;
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
    /** address */
    [Fields.break]: number;
    /** how deep did it break out, jump to the break address on reach 0 */
    [Fields.depth]: number;
    [Fields.variable]: string;
    [Fields.savedEvalResult]: unknown;
}
export type Frame = FunctionFrame | TryFrame;
export type Stack = Frame[];
type VariableRecord = {
    [Fields.type]: VariableType;
    [Fields.name]: string;
};
export declare const enum VariableFlags {
    None = 0,
    Immutable = 1
}
type StaticVariableStore = {
    [Fields.names]: string[];
    [Fields.flags]: number[];
    [Fields.values]: any[];
};
declare const SCOPE_FLAGS: unique symbol;
declare const SCOPE_STATIC_SLOTS: unique symbol;
declare const SCOPE_STATIC_STORE: unique symbol;
declare const SCOPE_DEBUG_PTR: unique symbol;
declare const SCOPE_WITH_OBJECT: unique symbol;
declare const IDENTIFIER_REFERENCE_FRAME: unique symbol;
declare const IDENTIFIER_REFERENCE_SCOPE: unique symbol;
type IdentifierReference = {
    [IDENTIFIER_REFERENCE_FRAME]: Frame;
    [IDENTIFIER_REFERENCE_SCOPE]: Scope | null;
};
type ScopeWithInternals = Scope & {
    [SCOPE_FLAGS]?: Record<string, number>;
    [SCOPE_STATIC_SLOTS]?: Record<string, number>;
    [SCOPE_STATIC_STORE]?: StaticVariableStore;
    [SCOPE_DEBUG_PTR]?: number;
    [SCOPE_WITH_OBJECT]?: object;
};
declare const is_not_defined = " is not defined";
declare const is_a_constant = " is a constant";
declare const getEmptyObject: () => any;
declare const TDZ_VALUE: unique symbol;
export type ResultStep = {
    [Fields.done]: false;
    [Fields.yield]?: undefined;
    [Fields.await]?: undefined;
};
export type ResultDone = {
    [Fields.done]: true;
    [Fields.value]: unknown;
    [Fields.evalResult]: unknown;
    [Fields.yield]?: undefined;
    [Fields.await]?: undefined;
};
export type ResultYield = {
    [Fields.done]: false;
    [Fields.yield]: true;
    [Fields.await]?: undefined;
    [Fields.value]: unknown;
    [Fields.delegate]?: Iterator<unknown>;
};
export type ResultAwait = {
    [Fields.done]: false;
    [Fields.await]: true;
    [Fields.yield]?: undefined;
    [Fields.value]: unknown;
};
export type Result = ResultStep | ResultDone | ResultYield | ResultAwait;
declare const isResultYield: (r: Result) => r is ResultYield;
declare const isResultDone: (r: Result) => r is ResultDone;
declare const isIteratorYieldDone: (x: unknown) => x is {
    value: unknown;
    done: boolean;
};
/** ECMA-262 GetIterator: @@iterator must be present and callable; result must be an object. */
declare const getIterator: (iterable: unknown) => any;
/** ECMA-262 IteratorRecord creation captures the `next` method once. */
declare const getIteratorRecord: (iterable: unknown) => IteratorRecord;
declare const iteratorNext: (iterator: {
    next: unknown;
}, value?: unknown) => any;
declare const iteratorRecordNext: (record: IteratorRecord, value?: unknown) => any;
declare const iteratorClose: (record: IteratorRecord, suppressErrors: boolean) => void;
declare const iteratorComplete: (result: {
    done?: unknown;
}) => boolean;
declare const assertIteratorResult: (result: unknown) => object;
type RefinedEnvSet = Omit<WeakSet<Frame>, 'has'> & {
    has(value: Frame): boolean;
    has(value: any): value is Frame;
};
type Context = Record<string, any> | Frame;
type IteratorRecord = {
    iterator: Iterator<unknown>;
    next: Function;
    done: boolean;
};
export type ScopeDebugEntry = [string, unknown, boolean];
type Execution = {
    [Fields.ptr]: number;
    readonly [Fields.stack]: Stack;
    readonly [Fields.scopes]: Scope[];
    [Fields.step]: (debug?: boolean) => Result;
    [Fields.pushValue](value: unknown): void;
    [Fields.setPendingThrow](error: unknown): void;
};
type FunctionDescriptor = {
    [Fields.name]: string;
    [Fields.type]: FunctionTypes;
    [Fields.offset]: number;
    [Fields.bodyOffset]: number;
    [Fields.scopes]: Scope[];
    [Fields.programSection]: number[];
    [Fields.globalThis]: any;
};
declare const isGeneratorType: (t: FunctionTypes) => t is FunctionTypes.GeneratorDeclaration | FunctionTypes.GeneratorExpression | FunctionTypes.GeneratorMethod;
declare const isAsyncGeneratorType: (t: FunctionTypes) => t is FunctionTypes.AsyncGeneratorDeclaration | FunctionTypes.AsyncGeneratorExpression | FunctionTypes.AsyncGeneratorMethod;
declare const isAsyncType: (t: FunctionTypes) => t is FunctionTypes.AsyncFunctionDeclaration | FunctionTypes.AsyncFunctionExpression | FunctionTypes.AsyncArrowFunction | FunctionTypes.AsyncMethod;
declare const formatFunctionNameKey: (name: PropertyKey) => string;
declare const formatFunctionName: (name: PropertyKey, type?: FunctionTypes) => string;
declare const functionDescriptors: WeakMap<any, FunctionDescriptor>;
declare const environments: RefinedEnvSet;
declare const bindInfo: WeakMap<any, {
    16: any;
    17: any;
    18: any[];
}>;
type PendingAction = {
    [Fields.type]: 'throw' | 'return';
    [Fields.value]: any;
};
type GeneratorDelegateState = {
    [Fields.delegateIterator]: any;
    [Fields.delegatePhase]: number;
    [Fields.delegateMode]?: 'next' | 'throw' | 'return';
};
type GeneratorState = {
    [Fields.stack]: Stack;
    [Fields.ptr]: number;
    [Fields.completed]: boolean;
    [Fields.started]: boolean;
    [Fields.pendingAction]: null | PendingAction;
    [Fields.baseFrame]: Frame | null;
    [Fields.gen]: any;
    [Fields.execution]: Execution;
};
declare const generatorStates: WeakMap<any, GeneratorState>;
type InvokeParamApply = {
    [Fields.type]: InvokeType.Apply;
    [Fields.function]: unknown;
    [Fields.name]: string;
    [Fields.self]: unknown;
};
type InvokeParamConstruct = {
    [Fields.type]: InvokeType.Construct;
    [Fields.function]: unknown;
    [Fields.name]: string;
    [Fields.newTarget]: unknown;
};
export type InvokeParam = InvokeParamApply | InvokeParamConstruct;
export { APPLY, assertIteratorResult, BIND, bindInfo, CALL, decodeLiteralFromProgram, environments, functionDescriptors, formatFunctionName, formatFunctionNameKey, generatorStates, getEmptyObject, getIterator, getIteratorRecord, getLiteralFromPool, HOST_FUNCTION, isAsyncType, isAsyncGeneratorType, is_a_constant, isGeneratorType, is_not_defined, isIteratorYieldDone, isResultDone, isResultYield, isSmallNumber, iteratorComplete, iteratorClose, iteratorNext, iteratorRecordNext, literalPoolCache, literalPoolWordMask, REGEXP, SCOPE_DEBUG_PTR, SCOPE_FLAGS, SCOPE_STATIC_SLOTS, SCOPE_STATIC_STORE, SCOPE_WITH_OBJECT, TDZ_VALUE, TEXT_DADA_MASK, IDENTIFIER_REFERENCE_FRAME, IDENTIFIER_REFERENCE_SCOPE, toNumeric, toPropertyKey, };
export type { BaseFrame, Context, Execution, FunctionDescriptor, GeneratorDelegateState, FunctionFrame, GeneratorState, IteratorRecord, InvokeParamApply, InvokeParamConstruct, PendingAction, RefinedEnvSet, ScopeWithInternals, StaticVariableStore, TryFrame, IdentifierReference, VariableRecord, };
