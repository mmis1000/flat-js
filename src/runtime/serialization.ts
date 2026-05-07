import { FunctionTypes, InvokeType } from "../compiler"
import { getProgramSource, setProgramSource } from "../compiler/shared"
import {
    createRestoredVmAsyncSession,
    VmAsyncSession,
    type VmAsyncSessionBuiltinId,
    type VmAsyncSessionRestoreShellOptions,
    type VmAsyncSessionSerializableState,
    type VmAsyncTask,
    type VmJob,
    type VmPromiseReaction,
    type VmPromiseRecord,
    type VmPromiseState,
    type VmThenJob,
    type VmTimerRecord,
} from "./async-session"
import {
    bindInfo,
    defaultClassConstructors,
    DefaultClassConstructorInfo,
    environments,
    Execution,
    Fields,
    Frame,
    FrameType,
    FunctionDescriptor,
    functionDescriptors,
    GeneratorResumeKind,
    GeneratorState,
    generatorMethodKinds,
    generatorObjectStates,
    generatorSelfMethods,
    generatorStates,
    InvokeParam,
    isGeneratorType,
    isAsyncType,
    isIteratorYieldDone,
    isResultDone,
    isResultYield,
    markVmOwned,
    RuntimeAdmitValue,
    RuntimeAsyncHost,
    Scope,
    Stack,
    TDZ_VALUE,
    SCOPE_DEBUG_PTR,
    SCOPE_FLAGS,
    SCOPE_REJECT_EVAL_ARGUMENTS_VAR,
    SCOPE_STATIC_SLOTS,
    SCOPE_STATIC_STORE,
    SCOPE_WITH_OBJECT,
    IDENTIFIER_REFERENCE_FRAME,
    IDENTIFIER_REFERENCE_SCOPE,
    SUPER_REFERENCE_BASE,
    SUPER_REFERENCE_THIS,
    vmOwnedObjects,
} from "./shared"
import { getExecution, getGeneratorFunctionIntrinsicsForSerialization } from "./execution"
import type { DebugCallback } from "./opcodes/types"
import { applyCompactJsonDelta, createCompactJsonDelta, type CompactJsonDelta, type CompactJsonValue } from "./snapshot-history-delta"

type PrimitiveSnapshotValue =
    | { t: 'undefined' }
    | { t: 'null' }
    | { t: 'boolean', v: boolean }
    | { t: 'string', v: string }
    | { t: 'number', v: number | 'NaN' | 'Infinity' | '-Infinity' | '-0' }
    | { t: 'bigint', v: string }
    | { t: 'tdz' }
    | { t: 'symbol', v: WellKnownSymbolName }

type SnapshotValue =
    | PrimitiveSnapshotValue
    | { t: 'ref', id: number }
    | { t: 'host', id: string }
    | { t: 'builtin', id: BuiltinRefId }
    | { t: 'vmAsyncBuiltin', id: VmAsyncSessionBuiltinId }

type SnapshotKey =
    | { t: 'string', v: string }
    | { t: 'internal', v: InternalSymbolName }
    | { t: 'symbol', v: WellKnownSymbolName }

type SnapshotDescriptor =
    & {
        key: SnapshotKey
        configurable?: boolean
        enumerable?: boolean
    }
    & (
        | { kind: 'data', writable?: boolean, value: SnapshotValue }
        | { kind: 'accessor', get?: SnapshotValue, set?: SnapshotValue }
    )

type SnapshotFunctionDescriptor = {
    name: string
    type: FunctionTypes
    offset: number
    bodyOffset: number
    scopes: SnapshotValue
    programSection: SnapshotValue
    globalThis: SnapshotValue
    homeObject?: SnapshotValue
}

type SnapshotDefaultClassConstructor = {
    name: string
    superClass?: SnapshotValue
}

type SnapshotBoundFunction = {
    function: SnapshotValue
    self: SnapshotValue
    arguments: SnapshotValue[]
}

type SnapshotGeneratorPendingAction = {
    type: GeneratorResumeKind.Throw | GeneratorResumeKind.Return
    value: SnapshotValue
}

type SnapshotGeneratorState = {
    stack: SnapshotValue
    ptr: number
    completed: boolean
    started: boolean
    pendingAction: SnapshotGeneratorPendingAction | null
    baseFrame: SnapshotValue
}

type SnapshotGeneratorMethodName = 'next' | 'throw' | 'return' | 'iterator'

type SnapshotGeneratorMethod = {
    generator: SnapshotValue
    method: SnapshotGeneratorMethodName
}

type SnapshotRecord = {
    id: number
    kind: 'object' | 'array' | 'function' | 'frame' | 'map' | 'set' | 'weakMap' | 'weakSet'
    extensible: boolean
    prototype: SnapshotValue
    descriptors: SnapshotDescriptor[]
    programSource?: string
    functionDescriptor?: SnapshotFunctionDescriptor
    defaultClassConstructor?: SnapshotDefaultClassConstructor
    boundFunction?: SnapshotBoundFunction
    generatorState?: SnapshotGeneratorState
    generatorMethod?: SnapshotGeneratorMethod
    frameGenerator?: SnapshotValue
    entries?: Array<[SnapshotValue, SnapshotValue]>
    values?: SnapshotValue[]
}

type SnapshotHostOverlay = {
    id: string
    descriptors: SnapshotDescriptor[]
    deleted: SnapshotKey[]
}

export type ExecutionSnapshot = {
    version: 1
    source: string
    ptr: number
    evalResult: SnapshotValue
    stack: SnapshotValue
    records: SnapshotRecord[]
    hostOverlays?: SnapshotHostOverlay[]
}

type SnapshotExecutionState = {
    ptr: number
    evalResult: SnapshotValue
    stack: SnapshotValue
}

type SnapshotVmPromiseReaction =
    | {
        type: 'then'
        kind: 'fulfilled' | 'rejected'
        handler: SnapshotValue
        result: number
    }
    | {
        type: 'await'
        kind: 'fulfilled' | 'rejected'
        task: number
    }

type SnapshotVmPromiseRecord = {
    id: number
    promise: SnapshotValue
    state: VmPromiseState
    value: SnapshotValue
    fulfillReactions: SnapshotVmPromiseReaction[]
    rejectReactions: SnapshotVmPromiseReaction[]
}

type SnapshotVmJob =
    | {
        id: number
        type: 'then'
        reaction: SnapshotVmPromiseReaction & { type: 'then' }
        argument: SnapshotValue
        execution?: number
    }
    | {
        id: number
        type: 'asyncContinuation'
        task: number
        kind: 'fulfilled' | 'rejected'
        argument: SnapshotValue
    }
    | {
        id: number
        type: 'asyncStart'
        task: number
    }

type SnapshotVmAsyncTask = {
    id: number
    execution: number
    promise: number
}

type SnapshotVmTimerRecord = {
    id: number
    dueTick: number
    promise: number
    value: SnapshotValue
}

type SnapshotVmExecutionRecord = {
    id: number
    state: SnapshotExecutionState
}

export type VmAsyncSessionSnapshot = {
    version: 1
    source: string
    program: SnapshotValue
    globalThis: SnapshotValue
    mainExecution: number
    executions: SnapshotVmExecutionRecord[]
    promises: SnapshotVmPromiseRecord[]
    asyncTasks: SnapshotVmAsyncTask[]
    jobs: SnapshotVmJob[]
    timers: SnapshotVmTimerRecord[]
    activeJob: SnapshotVmJob | null
    currentTick: number
    nextPromiseId: number
    nextJobId: number
    nextTimerId: number
    nextAsyncTaskId: number
    mainDone: boolean
    paused: boolean
    pausedPtr?: number
    pausedExecution?: number
    records: SnapshotRecord[]
    hostOverlays?: SnapshotHostOverlay[]
}

export type HostCapabilityDescriptorOverlay = {
    descriptors: Array<[PropertyKey, PropertyDescriptor]>
    deleted: PropertyKey[]
}

export type HostCapabilityRegistry = {
    getId(value: unknown): string | undefined
    getValue(id: string): unknown
    getMutationReason?(value: unknown): string | undefined
    getDescriptorOverlay?(value: unknown): HostCapabilityDescriptorOverlay | undefined
}

type SnapshotOptions = {
    hostRegistry?: HostCapabilityRegistry
}

export type CheckpointableAdmission = (value: unknown, path?: string) => void

type SerializableHostObjectRedirectOptions = {
    globalThis?: any
    functionRedirects?: WeakMap<Function, Function>
}

type RestoreOptions = {
    hostRegistry?: HostCapabilityRegistry
    compileFunction?: typeof import('../compiler').compile
    functionRedirects?: WeakMap<Function, Function>
    getDebugFunction?: () => null | DebugCallback
    admitValue?: RuntimeAdmitValue
    asyncHost?: RuntimeAsyncHost | null
    vmAsyncSession?: VmAsyncSession
}

const SNAPSHOT_VERSION = 1

const COMPACT_EXECUTION_SNAPSHOT_FORMAT = 'flat-js/execution-snapshot'
const COMPACT_VM_ASYNC_SESSION_SNAPSHOT_FORMAT = 'flat-js/vm-async-session-snapshot'
const COMPACT_SNAPSHOT_VERSION = 2
const SNAPSHOT_HISTORY_FORMAT = 'flat-js/snapshot-history'
const SNAPSHOT_HISTORY_VERSION = 1
const COMPACT_ARRAY_HOLE = 0 as const

type CompactSnapshotValue =
    | ['u']
    | ['n']
    | ['b', boolean]
    | ['s', string]
    | ['d', number | 'NaN' | 'Infinity' | '-Infinity' | '-0']
    | ['i', string]
    | ['z']
    | ['y', WellKnownSymbolName]
    | ['r', number]
    | ['h', string]
    | ['B', BuiltinRefId]
    | ['A', VmAsyncSessionBuiltinId]

type CompactSnapshotKey = string | ['i', InternalSymbolName] | ['s', WellKnownSymbolName]

type CompactSnapshotDescriptor =
    | [CompactSnapshotKey, CompactSnapshotValue]
    | [CompactSnapshotKey, CompactSnapshotValue, string]
    | [CompactSnapshotKey, CompactSnapshotValue | null, CompactSnapshotValue | null, string]

type CompactSnapshotArrayItem = CompactSnapshotValue | typeof COMPACT_ARRAY_HOLE

type CompactSnapshotArrayLayout = {
    length: number
    items?: CompactSnapshotArrayItem[]
    sparse?: Array<[number, CompactSnapshotValue]>
    lengthWritable?: false
}

type CompactSnapshotFunctionDescriptor = {
    name: string
    type: FunctionTypes
    offset: number
    bodyOffset: number
    scopes: CompactSnapshotValue
    programSection: CompactSnapshotValue
    globalThis: CompactSnapshotValue
    homeObject?: CompactSnapshotValue
}

type CompactSnapshotDefaultClassConstructor = {
    name: string
    superClass?: CompactSnapshotValue
}

type CompactSnapshotBoundFunction = {
    function: CompactSnapshotValue
    self: CompactSnapshotValue
    arguments: CompactSnapshotValue[]
}

type CompactSnapshotGeneratorPendingAction = {
    type: GeneratorResumeKind.Throw | GeneratorResumeKind.Return
    value: CompactSnapshotValue
}

type CompactSnapshotGeneratorState = {
    stack: CompactSnapshotValue
    ptr: number
    completed: boolean
    started: boolean
    pendingAction: CompactSnapshotGeneratorPendingAction | null
    baseFrame: CompactSnapshotValue
}

type CompactSnapshotGeneratorMethod = {
    generator: CompactSnapshotValue
    method: SnapshotGeneratorMethodName
}

type CompactSnapshotRecord = {
    id: number
    kind: SnapshotRecord['kind']
    extensible?: false
    prototype: CompactSnapshotValue
    descriptors?: CompactSnapshotDescriptor[]
    array?: CompactSnapshotArrayLayout
    programSource?: string
    functionDescriptor?: CompactSnapshotFunctionDescriptor
    defaultClassConstructor?: CompactSnapshotDefaultClassConstructor
    boundFunction?: CompactSnapshotBoundFunction
    generatorState?: CompactSnapshotGeneratorState
    generatorMethod?: CompactSnapshotGeneratorMethod
    frameGenerator?: CompactSnapshotValue
    entries?: Array<[CompactSnapshotValue, CompactSnapshotValue]>
    values?: CompactSnapshotValue[]
}

type CompactSnapshotHostOverlay = {
    id: string
    descriptors?: CompactSnapshotDescriptor[]
    deleted?: CompactSnapshotKey[]
}

type CompactExecutionSnapshotEnvelope = {
    format: typeof COMPACT_EXECUTION_SNAPSHOT_FORMAT
    version: typeof COMPACT_SNAPSHOT_VERSION
    source: string
    ptr: number
    evalResult: CompactSnapshotValue
    stack: CompactSnapshotValue
    records: CompactSnapshotRecord[]
    hostOverlays?: CompactSnapshotHostOverlay[]
}

type CompactSnapshotExecutionState = {
    ptr: number
    evalResult: CompactSnapshotValue
    stack: CompactSnapshotValue
}

type CompactSnapshotVmPromiseReaction =
    | {
        type: 'then'
        kind: 'fulfilled' | 'rejected'
        handler: CompactSnapshotValue
        result: number
    }
    | {
        type: 'await'
        kind: 'fulfilled' | 'rejected'
        task: number
    }

type CompactSnapshotVmPromiseRecord = {
    id: number
    promise: CompactSnapshotValue
    state: VmPromiseState
    value: CompactSnapshotValue
    fulfillReactions: CompactSnapshotVmPromiseReaction[]
    rejectReactions: CompactSnapshotVmPromiseReaction[]
}

type CompactSnapshotVmJob =
    | {
        id: number
        type: 'then'
        reaction: CompactSnapshotVmPromiseReaction & { type: 'then' }
        argument: CompactSnapshotValue
        execution?: number
    }
    | {
        id: number
        type: 'asyncContinuation'
        task: number
        kind: 'fulfilled' | 'rejected'
        argument: CompactSnapshotValue
    }
    | {
        id: number
        type: 'asyncStart'
        task: number
    }

type CompactSnapshotVmAsyncTask = {
    id: number
    execution: number
    promise: number
}

type CompactSnapshotVmTimerRecord = {
    id: number
    dueTick: number
    promise: number
    value: CompactSnapshotValue
}

type CompactSnapshotVmExecutionRecord = {
    id: number
    state: CompactSnapshotExecutionState
}

type CompactVmAsyncSessionSnapshotEnvelope = {
    format: typeof COMPACT_VM_ASYNC_SESSION_SNAPSHOT_FORMAT
    version: typeof COMPACT_SNAPSHOT_VERSION
    source: string
    program: CompactSnapshotValue
    globalThis: CompactSnapshotValue
    mainExecution: number
    executions: CompactSnapshotVmExecutionRecord[]
    promises: CompactSnapshotVmPromiseRecord[]
    asyncTasks: CompactSnapshotVmAsyncTask[]
    jobs: CompactSnapshotVmJob[]
    timers: CompactSnapshotVmTimerRecord[]
    activeJob: CompactSnapshotVmJob | null
    currentTick: number
    nextPromiseId: number
    nextJobId: number
    nextTimerId: number
    nextAsyncTaskId: number
    mainDone: boolean
    paused: boolean
    pausedPtr?: number
    pausedExecution?: number
    records: CompactSnapshotRecord[]
    hostOverlays?: CompactSnapshotHostOverlay[]
}

export type SnapshotCheckpointKind = 'execution' | 'vmAsyncSession'

type SnapshotCheckpointOptions = {
    id?: string
    parentId?: string
    label?: string
    createdAt?: string
}

export type ExecutionSnapshotCheckpoint = {
    id: string
    parentId?: string
    label?: string
    createdAt?: string
    kind: 'execution'
    snapshot: ExecutionSnapshot
}

export type VmAsyncSessionSnapshotCheckpoint = {
    id: string
    parentId?: string
    label?: string
    createdAt?: string
    kind: 'vmAsyncSession'
    snapshot: VmAsyncSessionSnapshot
}

export type SnapshotCheckpoint = ExecutionSnapshotCheckpoint | VmAsyncSessionSnapshotCheckpoint

export type SnapshotHistory = {
    version: typeof SNAPSHOT_HISTORY_VERSION
    rootIds: string[]
    headId?: string
    checkpoints: SnapshotCheckpoint[]
}

export type SnapshotHistoryRetentionPolicy = {
    maxCheckpoints: number
    preserveHeadLineage?: boolean
}

type CompactSnapshotCheckpointEnvelope = CompactExecutionSnapshotEnvelope | CompactVmAsyncSessionSnapshotEnvelope

type CompactSnapshotHistoryCheckpointBase = {
    id: string
    parentId?: string
    label?: string
    createdAt?: string
    kind: SnapshotCheckpointKind
}

type CompactSnapshotHistoryFullCheckpoint = CompactSnapshotHistoryCheckpointBase & {
    snapshot: CompactSnapshotCheckpointEnvelope
}

type CompactSnapshotHistoryDeltaCheckpoint = CompactSnapshotHistoryCheckpointBase & {
    deltaFrom: string
    snapshotDelta: CompactJsonDelta
}

type CompactSnapshotHistoryCheckpoint = CompactSnapshotHistoryFullCheckpoint | CompactSnapshotHistoryDeltaCheckpoint

type CompactSnapshotHistoryDocument = {
    format: typeof SNAPSHOT_HISTORY_FORMAT
    version: typeof SNAPSHOT_HISTORY_VERSION
    rootIds: string[]
    headId?: string
    checkpoints: CompactSnapshotHistoryCheckpoint[]
}

const isCanonicalArrayIndexKey = (key: string) => {
    if (key === '') {
        return false
    }
    const index = Number(key)
    return Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === key
}

const encodeCompactValue = (value: SnapshotValue): CompactSnapshotValue => {
    switch (value.t) {
        case 'undefined':
            return ['u']
        case 'null':
            return ['n']
        case 'boolean':
            return ['b', value.v]
        case 'string':
            return ['s', value.v]
        case 'number':
            return ['d', value.v]
        case 'bigint':
            return ['i', value.v]
        case 'tdz':
            return ['z']
        case 'symbol':
            return ['y', value.v]
        case 'ref':
            return ['r', value.id]
        case 'host':
            return ['h', value.id]
        case 'builtin':
            return ['B', value.id]
        case 'vmAsyncBuiltin':
            return ['A', value.id]
    }
}

const decodeCompactValue = (value: CompactSnapshotValue): SnapshotValue => {
    switch (value[0]) {
        case 'u':
            return { t: 'undefined' }
        case 'n':
            return { t: 'null' }
        case 'b':
            return { t: 'boolean', v: value[1] }
        case 's':
            return { t: 'string', v: value[1] }
        case 'd':
            return { t: 'number', v: value[1] }
        case 'i':
            return { t: 'bigint', v: value[1] }
        case 'z':
            return { t: 'tdz' }
        case 'y':
            return { t: 'symbol', v: value[1] }
        case 'r':
            return { t: 'ref', id: value[1] }
        case 'h':
            return { t: 'host', id: value[1] }
        case 'B':
            return { t: 'builtin', id: value[1] }
        case 'A':
            return { t: 'vmAsyncBuiltin', id: value[1] }
    }
}

const encodeCompactKey = (key: SnapshotKey): CompactSnapshotKey => {
    switch (key.t) {
        case 'string':
            return key.v
        case 'internal':
            return ['i', key.v]
        case 'symbol':
            return ['s', key.v]
    }
}

const decodeCompactKey = (key: CompactSnapshotKey): SnapshotKey => {
    if (typeof key === 'string') {
        return { t: 'string', v: key }
    }
    if (key[0] === 'i') {
        return { t: 'internal', v: key[1] }
    }
    return { t: 'symbol', v: key[1] }
}

const encodeCompactDescriptor = (descriptor: SnapshotDescriptor): CompactSnapshotDescriptor => {
    const key = encodeCompactKey(descriptor.key)
    if (descriptor.kind === 'data') {
        const flags = [
            descriptor.configurable === false ? 'c' : '',
            descriptor.enumerable === false ? 'e' : '',
            descriptor.writable === false ? 'w' : '',
        ].join('')
        return flags.length === 0
            ? [key, encodeCompactValue(descriptor.value)]
            : [key, encodeCompactValue(descriptor.value), flags]
    }
    return [
        key,
        descriptor.get === undefined ? null : encodeCompactValue(descriptor.get),
        descriptor.set === undefined ? null : encodeCompactValue(descriptor.set),
        `a${[
            descriptor.configurable === false ? 'c' : '',
            descriptor.enumerable === false ? 'e' : '',
        ].join('')}`,
    ]
}

const decodeCompactDescriptor = (descriptor: CompactSnapshotDescriptor): SnapshotDescriptor => {
    if (descriptor.length === 4) {
        const flags = descriptor[3].slice(1)
        return {
            key: decodeCompactKey(descriptor[0]),
            kind: 'accessor',
            configurable: !flags.includes('c'),
            enumerable: !flags.includes('e'),
            get: descriptor[1] === null ? undefined : decodeCompactValue(descriptor[1]),
            set: descriptor[2] === null ? undefined : decodeCompactValue(descriptor[2]),
        }
    }
    const flags = descriptor.length === 3 ? descriptor[2] : ''
    return {
        key: decodeCompactKey(descriptor[0]),
        kind: 'data',
        configurable: !flags.includes('c'),
        enumerable: !flags.includes('e'),
        writable: !flags.includes('w'),
        value: decodeCompactValue(descriptor[1]),
    }
}

const snapshotArrayLength = (descriptor: SnapshotDescriptor) =>
    descriptor.kind === 'data'
    && descriptor.key.t === 'string'
    && descriptor.key.v === 'length'
    && descriptor.value.t === 'number'
    && typeof descriptor.value.v === 'number'
    && Number.isInteger(descriptor.value.v)
    && descriptor.value.v >= 0
        ? descriptor.value.v
        : undefined

const isCompactArrayIndexDescriptor = (descriptor: SnapshotDescriptor) =>
    descriptor.kind === 'data'
    && descriptor.key.t === 'string'
    && isCanonicalArrayIndexKey(descriptor.key.v)
    && descriptor.configurable === true
    && descriptor.enumerable === true
    && descriptor.writable === true

const encodeCompactArrayLayout = (record: SnapshotRecord): { array?: CompactSnapshotArrayLayout, descriptors?: CompactSnapshotDescriptor[] } => {
    const extras: CompactSnapshotDescriptor[] = []
    const sparse: Array<[number, CompactSnapshotValue]> = []
    let length: number | undefined
    let lengthWritable = true
    for (const descriptor of record.descriptors) {
        const maybeLength = snapshotArrayLength(descriptor)
        if (maybeLength !== undefined) {
            length = maybeLength
            lengthWritable = descriptor.kind === 'data' && descriptor.writable !== false
            continue
        }
        if (descriptor.kind === 'data' && isCompactArrayIndexDescriptor(descriptor)) {
            sparse.push([Number(descriptor.key.v), encodeCompactValue(descriptor.value)])
            continue
        }
        extras.push(encodeCompactDescriptor(descriptor))
    }
    if (length === undefined) {
        return {
            descriptors: record.descriptors.map(encodeCompactDescriptor),
        }
    }
    sparse.sort((left, right) => left[0] - right[0])
    const maxIndex = sparse.length === 0 ? -1 : sparse[sparse.length - 1][0]
    const dense = sparse.length > 0 && maxIndex + 1 <= sparse.length * 2
    const array: CompactSnapshotArrayLayout = {
        length,
        ...(lengthWritable ? {} : { lengthWritable: false }),
    }
    if (dense) {
        const items = Array.from({ length: maxIndex + 1 }, () => COMPACT_ARRAY_HOLE as CompactSnapshotArrayItem)
        for (const [index, value] of sparse) {
            items[index] = value
        }
        array.items = items
    } else if (sparse.length > 0) {
        array.sparse = sparse
    }
    return extras.length === 0 ? { array } : { array, descriptors: extras }
}

const decodeCompactArrayLayout = (
    layout: CompactSnapshotArrayLayout | undefined,
    descriptors: CompactSnapshotDescriptor[] | undefined
): SnapshotDescriptor[] => {
    const restored = descriptors === undefined ? [] : descriptors.map(decodeCompactDescriptor)
    if (!layout) {
        return restored
    }
    if (layout.items) {
        for (let index = 0; index < layout.items.length; index++) {
            const value = layout.items[index]
            if (value === COMPACT_ARRAY_HOLE) {
                continue
            }
            restored.push({
                key: { t: 'string', v: String(index) },
                kind: 'data',
                configurable: true,
                enumerable: true,
                writable: true,
                value: decodeCompactValue(value),
            })
        }
    }
    for (const [index, value] of layout.sparse ?? []) {
        restored.push({
            key: { t: 'string', v: String(index) },
            kind: 'data',
            configurable: true,
            enumerable: true,
            writable: true,
            value: decodeCompactValue(value),
        })
    }
    restored.push({
        key: { t: 'string', v: 'length' },
        kind: 'data',
        configurable: false,
        enumerable: false,
        writable: layout.lengthWritable !== false,
        value: { t: 'number', v: layout.length },
    })
    return restored
}

const encodeCompactFunctionDescriptor = (descriptor: SnapshotFunctionDescriptor): CompactSnapshotFunctionDescriptor => ({
    name: descriptor.name,
    type: descriptor.type,
    offset: descriptor.offset,
    bodyOffset: descriptor.bodyOffset,
    scopes: encodeCompactValue(descriptor.scopes),
    programSection: encodeCompactValue(descriptor.programSection),
    globalThis: encodeCompactValue(descriptor.globalThis),
    ...(descriptor.homeObject === undefined ? {} : { homeObject: encodeCompactValue(descriptor.homeObject) }),
})

const decodeCompactFunctionDescriptor = (descriptor: CompactSnapshotFunctionDescriptor): SnapshotFunctionDescriptor => ({
    name: descriptor.name,
    type: descriptor.type,
    offset: descriptor.offset,
    bodyOffset: descriptor.bodyOffset,
    scopes: decodeCompactValue(descriptor.scopes),
    programSection: decodeCompactValue(descriptor.programSection),
    globalThis: decodeCompactValue(descriptor.globalThis),
    ...(descriptor.homeObject === undefined ? {} : { homeObject: decodeCompactValue(descriptor.homeObject) }),
})

const encodeCompactRecord = (record: SnapshotRecord): CompactSnapshotRecord => {
    const compact: CompactSnapshotRecord = {
        id: record.id,
        kind: record.kind,
        ...(record.extensible ? {} : { extensible: false }),
        prototype: encodeCompactValue(record.prototype),
    }
    if (record.kind === 'array') {
        const encodedArray = encodeCompactArrayLayout(record)
        if (encodedArray.array) {
            compact.array = encodedArray.array
        }
        if (encodedArray.descriptors && encodedArray.descriptors.length > 0) {
            compact.descriptors = encodedArray.descriptors
        }
    } else if (record.descriptors.length > 0) {
        compact.descriptors = record.descriptors.map(encodeCompactDescriptor)
    }
    if (record.programSource !== undefined) {
        compact.programSource = record.programSource
    }
    if (record.functionDescriptor) {
        compact.functionDescriptor = encodeCompactFunctionDescriptor(record.functionDescriptor)
    }
    if (record.defaultClassConstructor) {
        compact.defaultClassConstructor = {
            name: record.defaultClassConstructor.name,
            ...(record.defaultClassConstructor.superClass === undefined
                ? {}
                : { superClass: encodeCompactValue(record.defaultClassConstructor.superClass) }),
        }
    }
    if (record.boundFunction) {
        compact.boundFunction = {
            function: encodeCompactValue(record.boundFunction.function),
            self: encodeCompactValue(record.boundFunction.self),
            arguments: record.boundFunction.arguments.map(encodeCompactValue),
        }
    }
    if (record.generatorState) {
        compact.generatorState = {
            stack: encodeCompactValue(record.generatorState.stack),
            ptr: record.generatorState.ptr,
            completed: record.generatorState.completed,
            started: record.generatorState.started,
            pendingAction: record.generatorState.pendingAction === null
                ? null
                : {
                    type: record.generatorState.pendingAction.type,
                    value: encodeCompactValue(record.generatorState.pendingAction.value),
                },
            baseFrame: encodeCompactValue(record.generatorState.baseFrame),
        }
    }
    if (record.generatorMethod) {
        compact.generatorMethod = {
            generator: encodeCompactValue(record.generatorMethod.generator),
            method: record.generatorMethod.method,
        }
    }
    if (record.frameGenerator !== undefined) {
        compact.frameGenerator = encodeCompactValue(record.frameGenerator)
    }
    if (record.entries) {
        compact.entries = record.entries.map(([key, value]) => [encodeCompactValue(key), encodeCompactValue(value)])
    }
    if (record.values) {
        compact.values = record.values.map(encodeCompactValue)
    }
    return compact
}

const decodeCompactRecord = (record: CompactSnapshotRecord): SnapshotRecord => ({
    id: record.id,
    kind: record.kind,
    extensible: record.extensible !== false,
    prototype: decodeCompactValue(record.prototype),
    descriptors: record.kind === 'array'
        ? decodeCompactArrayLayout(record.array, record.descriptors)
        : (record.descriptors ?? []).map(decodeCompactDescriptor),
    ...(record.programSource === undefined ? {} : { programSource: record.programSource }),
    ...(record.functionDescriptor === undefined ? {} : { functionDescriptor: decodeCompactFunctionDescriptor(record.functionDescriptor) }),
    ...(record.defaultClassConstructor === undefined
        ? {}
        : {
            defaultClassConstructor: {
                name: record.defaultClassConstructor.name,
                ...(record.defaultClassConstructor.superClass === undefined
                    ? {}
                    : { superClass: decodeCompactValue(record.defaultClassConstructor.superClass) }),
            },
        }),
    ...(record.boundFunction === undefined
        ? {}
        : {
            boundFunction: {
                function: decodeCompactValue(record.boundFunction.function),
                self: decodeCompactValue(record.boundFunction.self),
                arguments: record.boundFunction.arguments.map(decodeCompactValue),
            },
        }),
    ...(record.generatorState === undefined
        ? {}
        : {
            generatorState: {
                stack: decodeCompactValue(record.generatorState.stack),
                ptr: record.generatorState.ptr,
                completed: record.generatorState.completed,
                started: record.generatorState.started,
                pendingAction: record.generatorState.pendingAction === null
                    ? null
                    : {
                        type: record.generatorState.pendingAction.type,
                        value: decodeCompactValue(record.generatorState.pendingAction.value),
                    },
                baseFrame: decodeCompactValue(record.generatorState.baseFrame),
            },
        }),
    ...(record.generatorMethod === undefined
        ? {}
        : {
            generatorMethod: {
                generator: decodeCompactValue(record.generatorMethod.generator),
                method: record.generatorMethod.method,
            },
        }),
    ...(record.frameGenerator === undefined ? {} : { frameGenerator: decodeCompactValue(record.frameGenerator) }),
    ...(record.entries === undefined ? {} : { entries: record.entries.map(([key, value]) => [decodeCompactValue(key), decodeCompactValue(value)] as [SnapshotValue, SnapshotValue]) }),
    ...(record.values === undefined ? {} : { values: record.values.map(decodeCompactValue) }),
})

const encodeCompactHostOverlay = (overlay: SnapshotHostOverlay): CompactSnapshotHostOverlay => ({
    id: overlay.id,
    ...(overlay.descriptors.length === 0 ? {} : { descriptors: overlay.descriptors.map(encodeCompactDescriptor) }),
    ...(overlay.deleted.length === 0 ? {} : { deleted: overlay.deleted.map(encodeCompactKey) }),
})

const decodeCompactHostOverlay = (overlay: CompactSnapshotHostOverlay): SnapshotHostOverlay => ({
    id: overlay.id,
    descriptors: (overlay.descriptors ?? []).map(decodeCompactDescriptor),
    deleted: (overlay.deleted ?? []).map(decodeCompactKey),
})

const encodeCompactExecutionSnapshot = (snapshot: ExecutionSnapshot): CompactExecutionSnapshotEnvelope => ({
    format: COMPACT_EXECUTION_SNAPSHOT_FORMAT,
    version: COMPACT_SNAPSHOT_VERSION,
    source: snapshot.source,
    ptr: snapshot.ptr,
    evalResult: encodeCompactValue(snapshot.evalResult),
    stack: encodeCompactValue(snapshot.stack),
    records: snapshot.records.map(encodeCompactRecord),
    ...(snapshot.hostOverlays && snapshot.hostOverlays.length > 0
        ? { hostOverlays: snapshot.hostOverlays.map(encodeCompactHostOverlay) }
        : {}),
})

const decodeCompactExecutionSnapshot = (snapshot: CompactExecutionSnapshotEnvelope): ExecutionSnapshot => ({
    version: SNAPSHOT_VERSION,
    source: snapshot.source,
    ptr: snapshot.ptr,
    evalResult: decodeCompactValue(snapshot.evalResult),
    stack: decodeCompactValue(snapshot.stack),
    records: snapshot.records.map(decodeCompactRecord),
    ...(snapshot.hostOverlays === undefined ? {} : { hostOverlays: snapshot.hostOverlays.map(decodeCompactHostOverlay) }),
})

const encodeCompactExecutionState = (state: SnapshotExecutionState): CompactSnapshotExecutionState => ({
    ptr: state.ptr,
    evalResult: encodeCompactValue(state.evalResult),
    stack: encodeCompactValue(state.stack),
})

const decodeCompactExecutionState = (state: CompactSnapshotExecutionState): SnapshotExecutionState => ({
    ptr: state.ptr,
    evalResult: decodeCompactValue(state.evalResult),
    stack: decodeCompactValue(state.stack),
})

const encodeCompactVmPromiseReaction = (reaction: SnapshotVmPromiseReaction): CompactSnapshotVmPromiseReaction =>
    reaction.type === 'then'
        ? {
            type: 'then',
            kind: reaction.kind,
            handler: encodeCompactValue(reaction.handler),
            result: reaction.result,
        }
        : {
            type: 'await',
            kind: reaction.kind,
            task: reaction.task,
        }

const decodeCompactVmPromiseReaction = (reaction: CompactSnapshotVmPromiseReaction): SnapshotVmPromiseReaction =>
    reaction.type === 'then'
        ? {
            type: 'then',
            kind: reaction.kind,
            handler: decodeCompactValue(reaction.handler),
            result: reaction.result,
        }
        : {
            type: 'await',
            kind: reaction.kind,
            task: reaction.task,
        }

const encodeCompactVmJob = (job: SnapshotVmJob): CompactSnapshotVmJob => {
    if (job.type === 'then') {
        return {
            id: job.id,
            type: 'then',
            reaction: encodeCompactVmPromiseReaction(job.reaction) as CompactSnapshotVmPromiseReaction & { type: 'then' },
            argument: encodeCompactValue(job.argument),
            ...(job.execution === undefined ? {} : { execution: job.execution }),
        }
    }
    if (job.type === 'asyncContinuation') {
        return {
            id: job.id,
            type: 'asyncContinuation',
            task: job.task,
            kind: job.kind,
            argument: encodeCompactValue(job.argument),
        }
    }
    return {
        id: job.id,
        type: 'asyncStart',
        task: job.task,
    }
}

const decodeCompactVmJob = (job: CompactSnapshotVmJob): SnapshotVmJob => {
    if (job.type === 'then') {
        return {
            id: job.id,
            type: 'then',
            reaction: decodeCompactVmPromiseReaction(job.reaction) as SnapshotVmPromiseReaction & { type: 'then' },
            argument: decodeCompactValue(job.argument),
            ...(job.execution === undefined ? {} : { execution: job.execution }),
        }
    }
    if (job.type === 'asyncContinuation') {
        return {
            id: job.id,
            type: 'asyncContinuation',
            task: job.task,
            kind: job.kind,
            argument: decodeCompactValue(job.argument),
        }
    }
    return {
        id: job.id,
        type: 'asyncStart',
        task: job.task,
    }
}

const encodeCompactVmAsyncSessionSnapshot = (snapshot: VmAsyncSessionSnapshot): CompactVmAsyncSessionSnapshotEnvelope => ({
    format: COMPACT_VM_ASYNC_SESSION_SNAPSHOT_FORMAT,
    version: COMPACT_SNAPSHOT_VERSION,
    source: snapshot.source,
    program: encodeCompactValue(snapshot.program),
    globalThis: encodeCompactValue(snapshot.globalThis),
    mainExecution: snapshot.mainExecution,
    executions: snapshot.executions.map(entry => ({
        id: entry.id,
        state: encodeCompactExecutionState(entry.state),
    })),
    promises: snapshot.promises.map(promise => ({
        id: promise.id,
        promise: encodeCompactValue(promise.promise),
        state: promise.state,
        value: encodeCompactValue(promise.value),
        fulfillReactions: promise.fulfillReactions.map(encodeCompactVmPromiseReaction),
        rejectReactions: promise.rejectReactions.map(encodeCompactVmPromiseReaction),
    })),
    asyncTasks: snapshot.asyncTasks.map(task => ({
        id: task.id,
        execution: task.execution,
        promise: task.promise,
    })),
    jobs: snapshot.jobs.map(encodeCompactVmJob),
    timers: snapshot.timers.map(timer => ({
        id: timer.id,
        dueTick: timer.dueTick,
        promise: timer.promise,
        value: encodeCompactValue(timer.value),
    })),
    activeJob: snapshot.activeJob === null ? null : encodeCompactVmJob(snapshot.activeJob),
    currentTick: snapshot.currentTick,
    nextPromiseId: snapshot.nextPromiseId,
    nextJobId: snapshot.nextJobId,
    nextTimerId: snapshot.nextTimerId,
    nextAsyncTaskId: snapshot.nextAsyncTaskId,
    mainDone: snapshot.mainDone,
    paused: snapshot.paused,
    ...(snapshot.pausedPtr === undefined ? {} : { pausedPtr: snapshot.pausedPtr }),
    ...(snapshot.pausedExecution === undefined ? {} : { pausedExecution: snapshot.pausedExecution }),
    records: snapshot.records.map(encodeCompactRecord),
    ...(snapshot.hostOverlays && snapshot.hostOverlays.length > 0
        ? { hostOverlays: snapshot.hostOverlays.map(encodeCompactHostOverlay) }
        : {}),
})

const decodeCompactVmAsyncSessionSnapshot = (snapshot: CompactVmAsyncSessionSnapshotEnvelope): VmAsyncSessionSnapshot => ({
    version: SNAPSHOT_VERSION,
    source: snapshot.source,
    program: decodeCompactValue(snapshot.program),
    globalThis: decodeCompactValue(snapshot.globalThis),
    mainExecution: snapshot.mainExecution,
    executions: snapshot.executions.map(entry => ({
        id: entry.id,
        state: decodeCompactExecutionState(entry.state),
    })),
    promises: snapshot.promises.map(promise => ({
        id: promise.id,
        promise: decodeCompactValue(promise.promise),
        state: promise.state,
        value: decodeCompactValue(promise.value),
        fulfillReactions: promise.fulfillReactions.map(decodeCompactVmPromiseReaction),
        rejectReactions: promise.rejectReactions.map(decodeCompactVmPromiseReaction),
    })),
    asyncTasks: snapshot.asyncTasks.map(task => ({
        id: task.id,
        execution: task.execution,
        promise: task.promise,
    })),
    jobs: snapshot.jobs.map(decodeCompactVmJob),
    timers: snapshot.timers.map(timer => ({
        id: timer.id,
        dueTick: timer.dueTick,
        promise: timer.promise,
        value: decodeCompactValue(timer.value),
    })),
    activeJob: snapshot.activeJob === null ? null : decodeCompactVmJob(snapshot.activeJob),
    currentTick: snapshot.currentTick,
    nextPromiseId: snapshot.nextPromiseId,
    nextJobId: snapshot.nextJobId,
    nextTimerId: snapshot.nextTimerId,
    nextAsyncTaskId: snapshot.nextAsyncTaskId,
    mainDone: snapshot.mainDone,
    paused: snapshot.paused,
    ...(snapshot.pausedPtr === undefined ? {} : { pausedPtr: snapshot.pausedPtr }),
    ...(snapshot.pausedExecution === undefined ? {} : { pausedExecution: snapshot.pausedExecution }),
    records: snapshot.records.map(decodeCompactRecord),
    ...(snapshot.hostOverlays === undefined ? {} : { hostOverlays: snapshot.hostOverlays.map(decodeCompactHostOverlay) }),
})

const validateExecutionSnapshot = (parsed: unknown): ExecutionSnapshot => {
    if (parsed == null || typeof parsed !== 'object' || (parsed as ExecutionSnapshot).version !== SNAPSHOT_VERSION) {
        throw new Error('Unsupported execution snapshot version')
    }
    if (typeof (parsed as ExecutionSnapshot).source !== 'string') {
        throw new Error('Execution snapshot is missing JS source')
    }
    return parsed as ExecutionSnapshot
}

const validateVmAsyncSessionSnapshot = (parsed: unknown): VmAsyncSessionSnapshot => {
    if (parsed == null || typeof parsed !== 'object' || (parsed as VmAsyncSessionSnapshot).version !== SNAPSHOT_VERSION) {
        throw new Error('Unsupported VM async session snapshot version')
    }
    if (typeof (parsed as VmAsyncSessionSnapshot).source !== 'string') {
        throw new Error('VM async session snapshot is missing JS source')
    }
    return parsed as VmAsyncSessionSnapshot
}

const buildSnapshotCheckpoint = <T extends SnapshotCheckpoint>(
    history: SnapshotHistory,
    checkpoint: T
): SnapshotHistory => {
    if (history.checkpoints.some(existing => existing.id === checkpoint.id)) {
        throw new Error(`Duplicate snapshot checkpoint id '${checkpoint.id}'`)
    }
    if (checkpoint.parentId !== undefined && !history.checkpoints.some(existing => existing.id === checkpoint.parentId)) {
        throw new Error(`Unknown snapshot checkpoint parent '${checkpoint.parentId}'`)
    }
    return {
        version: SNAPSHOT_HISTORY_VERSION,
        rootIds: checkpoint.parentId === undefined ? [...history.rootIds, checkpoint.id] : [...history.rootIds],
        headId: checkpoint.id,
        checkpoints: [...history.checkpoints, checkpoint],
    }
}

const nextSnapshotCheckpointId = (history: SnapshotHistory) => `checkpoint-${history.checkpoints.length + 1}`

const getSnapshotCheckpoint = (history: SnapshotHistory, checkpointId: string): SnapshotCheckpoint => {
    const checkpoint = history.checkpoints.find(entry => entry.id === checkpointId)
    if (!checkpoint) {
        throw new Error(`Unknown snapshot checkpoint '${checkpointId}'`)
    }
    return checkpoint
}

const collectSnapshotCheckpointLineage = (history: SnapshotHistory, checkpointId: string, keptIds: Set<string>) => {
    let currentId: string | undefined = checkpointId
    while (currentId) {
        if (keptIds.has(currentId)) {
            return
        }
        keptIds.add(currentId)
        currentId = history.checkpoints.find(checkpoint => checkpoint.id === currentId)?.parentId
    }
}

const isAutoSnapshotCheckpoint = (checkpoint: SnapshotCheckpoint) => checkpoint.label == null || checkpoint.label === ''

const getNearestRetainedSnapshotCheckpointParentId = (
    checkpointsById: ReadonlyMap<string, SnapshotCheckpoint>,
    checkpoint: SnapshotCheckpoint,
    keptIds: ReadonlySet<string>
) => {
    let parentId = checkpoint.parentId
    while (parentId) {
        if (keptIds.has(parentId)) {
            return parentId
        }
        parentId = checkpointsById.get(parentId)?.parentId
    }
    return undefined
}

export const applySnapshotHistoryRetentionPolicy = (
    history: SnapshotHistory,
    policy: SnapshotHistoryRetentionPolicy
): SnapshotHistory => {
    const maxCheckpoints = Math.max(0, Math.floor(policy.maxCheckpoints))
    if (history.checkpoints.length === 0) {
        return createSnapshotHistory()
    }

    const checkpointsById = new Map(history.checkpoints.map(checkpoint => [checkpoint.id, checkpoint]))
    const keptIds = new Set<string>()
    if (history.headId) {
        if (policy.preserveHeadLineage) {
            collectSnapshotCheckpointLineage(history, history.headId, keptIds)
        } else {
            keptIds.add(history.headId)
        }
    }
    for (const checkpoint of history.checkpoints) {
        if (checkpoint.label) {
            keptIds.add(checkpoint.id)
        }
    }

    let autoCheckpointCount = 0
    for (let index = history.checkpoints.length - 1; index >= 0 && autoCheckpointCount < maxCheckpoints; index--) {
        const checkpoint = history.checkpoints[index]
        if (keptIds.has(checkpoint.id) || !isAutoSnapshotCheckpoint(checkpoint)) {
            continue
        }
        keptIds.add(checkpoint.id)
        autoCheckpointCount += 1
    }

    const checkpoints = history.checkpoints
        .filter(checkpoint => keptIds.has(checkpoint.id))
        .map(checkpoint => {
            const parentId = getNearestRetainedSnapshotCheckpointParentId(checkpointsById, checkpoint, keptIds)
            return {
                ...checkpoint,
                ...(parentId ? { parentId } : {}),
                ...(parentId ? {} : { parentId: undefined }),
            }
        })
    const rootIds = checkpoints.filter(checkpoint => checkpoint.parentId === undefined).map(checkpoint => checkpoint.id)
    const headId = history.headId && keptIds.has(history.headId)
        ? history.headId
        : checkpoints[checkpoints.length - 1]?.id

    return {
        version: SNAPSHOT_HISTORY_VERSION,
        rootIds,
        ...(headId ? { headId } : {}),
        checkpoints,
    }
}

const unsupportedMessage = (reason: string, path: string) => `${reason} at ${path}`

const isObjectLike = (value: unknown): value is object =>
    (typeof value === 'object' && value !== null) || typeof value === 'function'

export class UnsupportedSerializationError extends Error {
    constructor(
        readonly reason: string,
        readonly path: string
    ) {
        super(unsupportedMessage(reason, path))
        this.name = 'UnsupportedSerializationError'
    }
}

type HostCapabilityBaseline = {
    prototype: object | null
    extensible: boolean
    descriptors: Record<PropertyKey, PropertyDescriptor>
}

const captureHostBaseline = (value: object): HostCapabilityBaseline => ({
    prototype: Object.getPrototypeOf(value),
    extensible: Object.isExtensible(value),
    descriptors: Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>,
})

const haveSameDescriptor = (left: PropertyDescriptor, right: PropertyDescriptor) => {
    if (left.configurable !== right.configurable || left.enumerable !== right.enumerable) {
        return false
    }
    const leftIsData = 'value' in left || 'writable' in left
    const rightIsData = 'value' in right || 'writable' in right
    if (leftIsData !== rightIsData) {
        return false
    }
    if (leftIsData) {
        return left.writable === right.writable && Object.is(left.value, right.value)
    }
    return left.get === right.get && left.set === right.set
}

const getHostMutationReason = (value: object, baseline: HostCapabilityBaseline) => {
    if (Object.getPrototypeOf(value) !== baseline.prototype) {
        return 'Registered host capability prototype overlays are unsupported'
    }
    if (Object.isExtensible(value) !== baseline.extensible) {
        return 'Registered host capability extensibility overlays are unsupported'
    }
    return undefined
}

const getHostDescriptorOverlay = (
    value: object,
    baseline: HostCapabilityBaseline
): HostCapabilityDescriptorOverlay | undefined => {
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>
    const overlay: HostCapabilityDescriptorOverlay = {
        descriptors: [],
        deleted: [],
    }
    for (const key of Reflect.ownKeys(descriptors)) {
        if (
            !Object.prototype.hasOwnProperty.call(baseline.descriptors, key)
            || !haveSameDescriptor(descriptors[key], baseline.descriptors[key])
        ) {
            overlay.descriptors.push([key, descriptors[key]])
        }
    }
    for (const key of Reflect.ownKeys(baseline.descriptors)) {
        if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
            overlay.deleted.push(key)
        }
    }
    return overlay.descriptors.length === 0 && overlay.deleted.length === 0
        ? undefined
        : overlay
}

export function createHostRegistry(entries: Iterable<[string, unknown]> | Record<string, unknown>): HostCapabilityRegistry {
    const idToValue = new Map<string, unknown>()
    const valueToId = new Map<unknown, string>()
    const baselines = new WeakMap<object, HostCapabilityBaseline>()
    const list = Symbol.iterator in Object(entries)
        ? entries as Iterable<[string, unknown]>
        : Object.entries(entries)

    for (const [id, value] of list) {
        idToValue.set(id, value)
        valueToId.set(value, id)
        if (isObjectLike(value)) {
            baselines.set(value, captureHostBaseline(value))
        }
    }

    return {
        getId(value: unknown) {
            return valueToId.get(value)
        },
        getValue(id: string) {
            if (!idToValue.has(id)) {
                throw new UnsupportedSerializationError(`Missing host capability '${id}'`, '$')
            }
            return idToValue.get(id)
        },
        getMutationReason(value: unknown) {
            if (!isObjectLike(value)) {
                return undefined
            }
            const baseline = baselines.get(value)
            return baseline === undefined ? undefined : getHostMutationReason(value, baseline)
        },
        getDescriptorOverlay(value: unknown) {
            if (!isObjectLike(value)) {
                return undefined
            }
            const baseline = baselines.get(value)
            return baseline === undefined ? undefined : getHostDescriptorOverlay(value, baseline)
        },
    }
}

export const serializeExecutionSnapshot = (snapshot: ExecutionSnapshot): string =>
    JSON.stringify(encodeCompactExecutionSnapshot(snapshot))

export const parseExecutionSnapshot = (text: string): ExecutionSnapshot => {
    const parsed = JSON.parse(text) as ExecutionSnapshot | CompactExecutionSnapshotEnvelope
    if (
        parsed != null
        && typeof parsed === 'object'
        && 'format' in parsed
        && parsed.format === COMPACT_EXECUTION_SNAPSHOT_FORMAT
        && parsed.version === COMPACT_SNAPSHOT_VERSION
    ) {
        return validateExecutionSnapshot(decodeCompactExecutionSnapshot(parsed))
    }
    return validateExecutionSnapshot(parsed)
}

export const serializeVmAsyncSessionSnapshot = (snapshot: VmAsyncSessionSnapshot): string =>
    JSON.stringify(encodeCompactVmAsyncSessionSnapshot(snapshot))

export const parseVmAsyncSessionSnapshot = (text: string): VmAsyncSessionSnapshot => {
    const parsed = JSON.parse(text) as VmAsyncSessionSnapshot | CompactVmAsyncSessionSnapshotEnvelope
    if (
        parsed != null
        && typeof parsed === 'object'
        && 'format' in parsed
        && parsed.format === COMPACT_VM_ASYNC_SESSION_SNAPSHOT_FORMAT
        && parsed.version === COMPACT_SNAPSHOT_VERSION
    ) {
        return validateVmAsyncSessionSnapshot(decodeCompactVmAsyncSessionSnapshot(parsed))
    }
    return validateVmAsyncSessionSnapshot(parsed)
}

type InternalSymbolName =
    | 'SCOPE_FLAGS'
    | 'SCOPE_STATIC_SLOTS'
    | 'SCOPE_STATIC_STORE'
    | 'SCOPE_DEBUG_PTR'
    | 'SCOPE_WITH_OBJECT'
    | 'SCOPE_REJECT_EVAL_ARGUMENTS_VAR'
    | 'IDENTIFIER_REFERENCE_FRAME'
    | 'IDENTIFIER_REFERENCE_SCOPE'
    | 'SUPER_REFERENCE_BASE'
    | 'SUPER_REFERENCE_THIS'

type WellKnownSymbolName =
    | 'iterator'
    | 'asyncIterator'
    | 'toPrimitive'
    | 'toStringTag'
    | 'unscopables'

type BuiltinRefId =
    | 'Object.prototype'
    | 'Array.prototype'
    | 'Function.prototype'
    | 'RegExp.prototype'
    | 'Date.prototype'
    | 'Map.prototype'
    | 'Set.prototype'
    | 'WeakMap.prototype'
    | 'WeakSet.prototype'
    | 'Promise.prototype'
    | 'Array.prototype[Symbol.iterator]'
    | 'String.prototype[Symbol.iterator]'
    | 'GeneratorFunction'
    | 'GeneratorFunction.prototype'
    | 'Generator.prototype'
    | 'GeneratorIterator.prototype'

const internalSymbolToName = new Map<symbol, InternalSymbolName>([
    [SCOPE_FLAGS, 'SCOPE_FLAGS'],
    [SCOPE_STATIC_SLOTS, 'SCOPE_STATIC_SLOTS'],
    [SCOPE_STATIC_STORE, 'SCOPE_STATIC_STORE'],
    [SCOPE_DEBUG_PTR, 'SCOPE_DEBUG_PTR'],
    [SCOPE_WITH_OBJECT, 'SCOPE_WITH_OBJECT'],
    [SCOPE_REJECT_EVAL_ARGUMENTS_VAR, 'SCOPE_REJECT_EVAL_ARGUMENTS_VAR'],
    [IDENTIFIER_REFERENCE_FRAME, 'IDENTIFIER_REFERENCE_FRAME'],
    [IDENTIFIER_REFERENCE_SCOPE, 'IDENTIFIER_REFERENCE_SCOPE'],
    [SUPER_REFERENCE_BASE, 'SUPER_REFERENCE_BASE'],
    [SUPER_REFERENCE_THIS, 'SUPER_REFERENCE_THIS'],
])

const nameToInternalSymbol = new Map<InternalSymbolName, symbol>(
    [...internalSymbolToName.entries()].map(([symbol, name]) => [name, symbol])
)

const wellKnownSymbolToName = new Map<symbol, WellKnownSymbolName>([
    [Symbol.iterator, 'iterator'],
    [Symbol.asyncIterator, 'asyncIterator'],
    [Symbol.toPrimitive, 'toPrimitive'],
    [Symbol.toStringTag, 'toStringTag'],
    [Symbol.unscopables, 'unscopables'],
])

const nameToWellKnownSymbol = new Map<WellKnownSymbolName, symbol>(
    [...wellKnownSymbolToName.entries()].map(([symbol, name]) => [name, symbol])
)

const builtinEntries = (): Array<[BuiltinRefId, unknown]> => [
    ['GeneratorFunction', getGeneratorFunctionIntrinsicsForSerialization(globalThis, false).constructor],
    ['GeneratorFunction.prototype', getGeneratorFunctionIntrinsicsForSerialization(globalThis, false).functionPrototype],
    ['Generator.prototype', getGeneratorFunctionIntrinsicsForSerialization(globalThis, false).prototype],
    ['GeneratorIterator.prototype', Object.getPrototypeOf(getGeneratorFunctionIntrinsicsForSerialization(globalThis, false).prototype)],
    ['Object.prototype', Object.prototype],
    ['Array.prototype', Array.prototype],
    ['Function.prototype', Function.prototype],
    ['RegExp.prototype', RegExp.prototype],
    ['Date.prototype', Date.prototype],
    ['Map.prototype', Map.prototype],
    ['Set.prototype', Set.prototype],
    ['WeakMap.prototype', WeakMap.prototype],
    ['WeakSet.prototype', WeakSet.prototype],
    ['Promise.prototype', Promise.prototype],
    ['Array.prototype[Symbol.iterator]', Array.prototype[Symbol.iterator]],
    ['String.prototype[Symbol.iterator]', String.prototype[Symbol.iterator]],
]

const getBuiltinId = (value: unknown): BuiltinRefId | undefined => {
    for (const [id, builtin] of builtinEntries()) {
        if (value === builtin) {
            return id
        }
    }
    return undefined
}

const getBuiltinValue = (id: BuiltinRefId): unknown => {
    for (const [candidateId, value] of builtinEntries()) {
        if (candidateId === id) {
            return value
        }
    }
    throw new Error(`Unsupported builtin reference '${id}'`)
}

const mapSizeGet = Reflect.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!
const setSizeGet = Reflect.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!
const mapEntries = Map.prototype.entries
const setValues = Set.prototype.values
const weakMapHas = WeakMap.prototype.has
const weakMapGet = WeakMap.prototype.get
const weakSetHas = WeakSet.prototype.has

const isMap = (value: object): value is Map<unknown, unknown> => {
    try {
        mapSizeGet.call(value)
        return true
    } catch {
        return false
    }
}

const isSet = (value: object): value is Set<unknown> => {
    try {
        setSizeGet.call(value)
        return true
    } catch {
        return false
    }
}

const isWeakMap = (value: object): value is WeakMap<object, unknown> => {
    try {
        weakMapHas.call(value, value)
        return true
    } catch {
        return false
    }
}

const isWeakSet = (value: object): value is WeakSet<object> => {
    try {
        weakSetHas.call(value, value)
        return true
    } catch {
        return false
    }
}

const hasOwnPrototype = (record: SnapshotRecord) =>
    record.descriptors.some(descriptor => descriptor.key.t === 'string' && descriptor.key.v === 'prototype')

const isSupportedFunctionType = (type: FunctionTypes, includeAsync: boolean) => {
    if (includeAsync && isAsyncType(type)) {
        return true
    }
    switch (type) {
        case FunctionTypes.FunctionDeclaration:
        case FunctionTypes.FunctionExpression:
        case FunctionTypes.ArrowFunction:
        case FunctionTypes.MethodDeclaration:
        case FunctionTypes.GetAccessor:
        case FunctionTypes.SetAccessor:
        case FunctionTypes.Constructor:
        case FunctionTypes.DerivedConstructor:
        case FunctionTypes.GeneratorDeclaration:
        case FunctionTypes.GeneratorExpression:
        case FunctionTypes.GeneratorMethod:
            return true
        default:
            return false
    }
}

const assertSupportedFunctionDescriptor = (descriptor: FunctionDescriptor, path: string, includeAsync = false) => {
    if (!isSupportedFunctionType(descriptor[Fields.type], includeAsync)) {
        throw new UnsupportedSerializationError('Unsupported VM function type', path)
    }
}

const usesConstructibleRestoredWrapper = (record: SnapshotRecord) =>
    record.defaultClassConstructor !== undefined
    || hasOwnPrototype(record)
    || record.functionDescriptor?.type === FunctionTypes.FunctionDeclaration
    || record.functionDescriptor?.type === FunctionTypes.FunctionExpression
    || record.functionDescriptor?.type === FunctionTypes.Constructor
    || record.functionDescriptor?.type === FunctionTypes.DerivedConstructor

const usesArrowRestoredWrapper = (record: SnapshotRecord) =>
    record.functionDescriptor?.type === FunctionTypes.ArrowFunction

const isAsyncGeneratorObject = (value: unknown) =>
    value != null
    && (typeof value === 'object' || typeof value === 'function')
    && Object.prototype.hasOwnProperty.call(value, Symbol.asyncIterator)

const resumeKindToGeneratorMethodName = (kind: GeneratorResumeKind): SnapshotGeneratorMethodName => {
    switch (kind) {
        case GeneratorResumeKind.Next:
            return 'next'
        case GeneratorResumeKind.Throw:
            return 'throw'
        case GeneratorResumeKind.Return:
            return 'return'
    }
}

const unsupportedBrand = (value: object) => {
    if (value instanceof Date) return 'Date is unsupported'
    if (value instanceof RegExp) return 'RegExp is unsupported'
    if (value instanceof Promise) return 'Promise is unsupported'
    if (value instanceof ArrayBuffer) return 'ArrayBuffer is unsupported'
    if (ArrayBuffer.isView(value)) return 'TypedArray/DataView is unsupported'
    return undefined
}

const serializableHostObjects = new WeakSet<object>()

const trackSerializableHostObject = <T>(value: T): T => {
    if (isObjectLike(value) && typeof value !== 'function' && unsupportedBrand(value) === undefined) {
        serializableHostObjects.add(value)
    }
    return value
}

const trackSerializableJsonGraph = <T>(value: T, seen = new WeakSet<object>()): T => {
    if (!isObjectLike(value) || typeof value === 'function' || seen.has(value)) {
        return value
    }
    seen.add(value)
    trackSerializableHostObject(value)

    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
        if (descriptor && 'value' in descriptor) {
            trackSerializableJsonGraph(descriptor.value, seen)
        }
    }
    return value
}

const trackSerializableDescriptorObject = <T>(value: T): T => {
    trackSerializableHostObject(value)
    return value
}

const trackSerializableDescriptorsObject = <T>(value: T): T => {
    trackSerializableHostObject(value)
    if (!isObjectLike(value)) {
        return value
    }
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
        if (descriptor && 'value' in descriptor) {
            trackSerializableHostObject(descriptor.value)
        }
    }
    return value
}

const redirectHostFactory = (
    redirects: WeakMap<Function, Function>,
    fn: unknown,
    track: (value: unknown) => unknown
) => {
    if (typeof fn !== 'function') {
        return
    }
    const target = redirects.get(fn) ?? fn
    redirects.set(fn, function (this: unknown, ...args: unknown[]) {
        return track(Reflect.apply(target, this, args))
    })
}

export const createSerializableHostObjectRedirects = (
    options: SerializableHostObjectRedirectOptions = {}
): WeakMap<Function, Function> => {
    const redirects = options.functionRedirects ?? new WeakMap<Function, Function>()
    const globalObject = options.globalThis ?? globalThis
    const objectCtor = globalObject?.Object ?? Object
    const jsonObject = globalObject?.JSON ?? JSON

    redirectHostFactory(redirects, jsonObject?.parse, trackSerializableJsonGraph)
    redirectHostFactory(redirects, objectCtor?.create, trackSerializableHostObject)
    redirectHostFactory(redirects, objectCtor?.fromEntries, trackSerializableHostObject)
    redirectHostFactory(redirects, objectCtor?.getOwnPropertyDescriptor, trackSerializableDescriptorObject)
    redirectHostFactory(redirects, objectCtor?.getOwnPropertyDescriptors, trackSerializableDescriptorsObject)

    return redirects
}

export const createCheckpointableAdmission = (
    options: SnapshotOptions = {}
): CheckpointableAdmission => (value, path = '$') => {
    new SnapshotWriter(options.hostRegistry).admit(value, path)
}

class SnapshotWriter {
    private readonly ids = new Map<object, number>()
    private readonly records: SnapshotRecord[] = []
    private readonly hostOverlays: SnapshotHostOverlay[] = []
    private readonly serializedHostOverlays = new Set<string>()
    private readonly weakCollections: Array<{ value: WeakMap<object, unknown> | WeakSet<object>, record: SnapshotRecord, path: string }> = []
    private readonly weakCollectionKeyIds = new WeakMap<SnapshotRecord, Set<number>>()

    constructor(
        private readonly hostRegistry?: HostCapabilityRegistry,
        private readonly vmAsyncSession?: VmAsyncSession
    ) {}

    snapshot(execution: Execution): ExecutionSnapshot {
        if (execution[Fields.stack].length === 0) {
            throw new UnsupportedSerializationError('Cannot snapshot a completed execution', '$')
        }
        const source = getProgramSource(execution[Fields.stack][0][Fields.programSection])
        if (source === undefined) {
            throw new UnsupportedSerializationError('Missing JS program source', '$.source')
        }

        const snapshot: ExecutionSnapshot = {
            version: SNAPSHOT_VERSION,
            source,
            ...this.executionState(execution, '$.execution'),
            records: this.records,
            hostOverlays: this.hostOverlays,
        }
        this.finalizeWeakCollections()
        return snapshot
    }

    snapshotVmAsyncSession(session: VmAsyncSession): VmAsyncSessionSnapshot {
        const state = session.getSerializableState()
        const source = getProgramSource(state.program)
        if (source === undefined) {
            throw new UnsupportedSerializationError('Missing JS program source', '$.source')
        }

        const executionIds = new Map<Execution, number>()
        const executions: SnapshotVmExecutionRecord[] = []
        const executionRef = (execution: Execution, path: string) => {
            const existing = executionIds.get(execution)
            if (existing !== undefined) {
                return existing
            }
            const id = executions.length + 1
            executionIds.set(execution, id)
            executions.push({
                id,
                state: this.executionState(execution, path),
            })
            return id
        }
        const reaction = (reaction: VmPromiseReaction, path: string): SnapshotVmPromiseReaction => {
            if (reaction.type === 'then') {
                return {
                    type: 'then',
                    kind: reaction.kind,
                    handler: this.value(reaction.handler, `${path}.handler`),
                    result: reaction.result.id,
                }
            }
            return {
                type: 'await',
                kind: reaction.kind,
                task: reaction.task.id,
            }
        }
        const job = (job: VmJob, path: string): SnapshotVmJob => {
            if (job.type === 'then') {
                const snapshotReaction = reaction(job.reaction, `${path}.reaction`)
                if (snapshotReaction.type !== 'then') {
                    throw new Error('Invalid VM promise reaction job snapshot')
                }
                const snapshotJob: SnapshotVmJob = {
                    id: job.id,
                    type: 'then',
                    reaction: snapshotReaction,
                    argument: this.value(job.argument, `${path}.argument`),
                }
                if (job.execution) {
                    snapshotJob.execution = executionRef(job.execution, `${path}.execution`)
                }
                return snapshotJob
            }
            if (job.type === 'asyncContinuation') {
                return {
                    id: job.id,
                    type: 'asyncContinuation',
                    task: job.task.id,
                    kind: job.kind,
                    argument: this.value(job.argument, `${path}.argument`),
                }
            }
            return {
                id: job.id,
                type: 'asyncStart',
                task: job.task.id,
            }
        }

        const snapshot: VmAsyncSessionSnapshot = {
            version: SNAPSHOT_VERSION,
            source,
            program: this.value(state.program, '$.program'),
            globalThis: this.value(state.globalThis, '$.globalThis'),
            mainExecution: executionRef(state.mainExecution, '$.mainExecution'),
            executions,
            promises: state.promises.map((promise, index) => ({
                id: promise.id,
                promise: this.value(promise.promise, `$.promises[${index}].promise`),
                state: promise.state,
                value: this.value(promise.value, `$.promises[${index}].value`),
                fulfillReactions: promise.fulfillReactions.map((entry, reactionIndex) =>
                    reaction(entry, `$.promises[${index}].fulfillReactions[${reactionIndex}]`)
                ),
                rejectReactions: promise.rejectReactions.map((entry, reactionIndex) =>
                    reaction(entry, `$.promises[${index}].rejectReactions[${reactionIndex}]`)
                ),
            })),
            asyncTasks: state.asyncTasks.map(task => ({
                id: task.id,
                execution: executionRef(task.execution, `$.asyncTasks[${task.id}].execution`),
                promise: task.promise.id,
            })),
            jobs: state.jobs.map((entry, index) => job(entry, `$.jobs[${index}]`)),
            timers: state.timers.map((timer, index) => ({
                id: timer.id,
                dueTick: timer.dueTick,
                promise: timer.promise.id,
                value: this.value(timer.value, `$.timers[${index}].value`),
            })),
            activeJob: state.activeJob === null ? null : job(state.activeJob, '$.activeJob'),
            currentTick: state.currentTick,
            nextPromiseId: state.nextPromiseId,
            nextJobId: state.nextJobId,
            nextTimerId: state.nextTimerId,
            nextAsyncTaskId: state.nextAsyncTaskId,
            mainDone: state.mainDone,
            paused: state.paused,
            pausedPtr: state.pausedPtr,
            pausedExecution: state.pausedExecution === null
                ? undefined
                : executionRef(state.pausedExecution, '$.pausedExecution'),
            records: this.records,
            hostOverlays: this.hostOverlays,
        }
        this.finalizeWeakCollections()
        return snapshot
    }

    private executionState(execution: Execution, path: string): SnapshotExecutionState {
        return {
            ptr: execution[Fields.ptr],
            evalResult: this.value(execution[Fields.evalResult], `${path}.evalResult`),
            stack: this.value(execution[Fields.stack], `${path}.stack`),
        }
    }

    private unsupported(reason: string, path: string): never {
        throw new UnsupportedSerializationError(reason, path)
    }

    admit(value: unknown, path = '$') {
        this.value(value, path)
    }

    private hasThenableShape(value: object): boolean {
        let current: object | null = value
        while (current !== null) {
            const descriptor = Reflect.getOwnPropertyDescriptor(current, 'then')
            if (descriptor) {
                if ('value' in descriptor) {
                    return typeof descriptor.value === 'function'
                }
                return descriptor.get !== undefined || descriptor.set !== undefined
            }
            current = Object.getPrototypeOf(current)
        }
        return false
    }

    private rejectUnsupportedVmAsyncBoundary(value: unknown, path: string) {
        if (!this.vmAsyncSession || !isObjectLike(value)) {
            return
        }
        if (this.vmAsyncSession.getPromiseRecordForSerialization(value)) {
            return
        }
        if (value instanceof Promise) {
            return this.unsupported('Native Promise is unsupported in VM async session snapshots', path)
        }
        if (this.hasThenableShape(value)) {
            return this.unsupported('Host thenables are unsupported in VM async session snapshots', path)
        }
    }

    private assertSyncGeneratorState(state: GeneratorState, path: string) {
        if (isAsyncGeneratorObject(state[Fields.gen]) || state[Fields.asyncYieldResumeAwaitReturn]) {
            return this.unsupported('Async generators are unsupported', path)
        }
    }

    private generatorStateObject(value: unknown): GeneratorState | undefined {
        if (!isObjectLike(value)) {
            return undefined
        }
        const state = generatorObjectStates.get((value as any)[Fields.gen])
        return state === value ? state : undefined
    }

    private generatorObjectState(value: object): GeneratorState | undefined {
        return generatorObjectStates.get(value as any)
    }

    private generatorMethod(value: Function): { state: GeneratorState, method: SnapshotGeneratorMethodName } | undefined {
        const state = generatorStates.get(value)
        if (state) {
            const kind = generatorMethodKinds.get(value)
            if (kind === undefined) {
                return undefined
            }
            return { state, method: resumeKindToGeneratorMethodName(kind) }
        }
        const selfState = generatorSelfMethods.get(value)
        if (!selfState) {
            return undefined
        }
        return { state: selfState, method: 'iterator' }
    }

    private snapshotGeneratorState(state: GeneratorState, path: string): SnapshotGeneratorState {
        this.assertSyncGeneratorState(state, path)
        const pendingAction = state[Fields.pendingAction]
        return {
            stack: this.value(state[Fields.stack], `${path}.stack`),
            ptr: state[Fields.ptr],
            completed: state[Fields.completed],
            started: state[Fields.started],
            pendingAction: pendingAction === null
                ? null
                : {
                    type: pendingAction[Fields.type],
                    value: this.value(pendingAction[Fields.value], `${path}.pendingAction.value`),
                },
            baseFrame: this.value(state[Fields.baseFrame], `${path}.baseFrame`),
        }
    }

    private key(key: PropertyKey, path: string): SnapshotKey {
        if (typeof key === 'string') {
            return { t: 'string', v: key }
        }
        if (typeof key === 'number') {
            return { t: 'string', v: String(key) }
        }
        const internalName = internalSymbolToName.get(key)
        if (internalName) {
            return { t: 'internal', v: internalName }
        }
        const symbolName = wellKnownSymbolToName.get(key)
        if (symbolName) {
            return { t: 'symbol', v: symbolName }
        }
        return this.unsupported('Unsupported symbol key', path)
    }

    private descriptor(key: PropertyKey, descriptor: PropertyDescriptor, path: string): SnapshotDescriptor {
        const base = {
            key: this.key(key, `${path}.key`),
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
        }
        if ('value' in descriptor) {
            return {
                ...base,
                kind: 'data',
                writable: descriptor.writable,
                value: this.value(descriptor.value, `${path}.value`),
            }
        }
        return {
            ...base,
            kind: 'accessor',
            get: descriptor.get === undefined ? undefined : this.value(descriptor.get, `${path}.get`),
            set: descriptor.set === undefined ? undefined : this.value(descriptor.set, `${path}.set`),
        }
    }

    private hostOverlay(value: unknown, id: string, path: string) {
        if (this.serializedHostOverlays.has(id)) {
            return
        }
        const overlay = this.hostRegistry?.getDescriptorOverlay?.(value)
        if (overlay === undefined) {
            return
        }

        this.serializedHostOverlays.add(id)
        const snapshotOverlay: SnapshotHostOverlay = {
            id,
            descriptors: [],
            deleted: [],
        }
        this.hostOverlays.push(snapshotOverlay)

        for (let index = 0; index < overlay.descriptors.length; index++) {
            const [key, descriptor] = overlay.descriptors[index]
            snapshotOverlay.descriptors.push(this.descriptor(
                key,
                descriptor,
                `${path}.hostOverlay[${index}]`
            ))
        }
        for (let index = 0; index < overlay.deleted.length; index++) {
            snapshotOverlay.deleted.push(this.key(
                overlay.deleted[index],
                `${path}.hostOverlay.deleted[${index}]`
            ))
        }
    }

    private finalizeWeakCollections() {
        let changed = true
        while (changed) {
            changed = false
            const candidates = [...this.ids.keys()]
            const collections = [...this.weakCollections]
            for (const { value, record, path } of collections) {
                const seenKeyIds = this.weakCollectionKeyIds.get(record) ?? new Set<number>()
                this.weakCollectionKeyIds.set(record, seenKeyIds)
                for (const candidate of candidates) {
                    const keyId = this.ids.get(candidate)!
                    if (seenKeyIds.has(keyId)) {
                        continue
                    }
                    if (record.kind === 'weakMap') {
                        if (!weakMapHas.call(value as WeakMap<object, unknown>, candidate)) {
                            continue
                        }
                        seenKeyIds.add(keyId)
                        record.entries ??= []
                        record.entries.push([
                            this.value(candidate, `${path}.entries[${record.entries.length}].key`),
                            this.value(weakMapGet.call(value as WeakMap<object, unknown>, candidate), `${path}.entries[${record.entries.length}].value`),
                        ])
                        changed = true
                    } else if (record.kind === 'weakSet') {
                        if (!weakSetHas.call(value as WeakSet<object>, candidate)) {
                            continue
                        }
                        seenKeyIds.add(keyId)
                        record.values ??= []
                        record.values.push(this.value(candidate, `${path}.values[${record.values.length}]`))
                        changed = true
                    }
                }
            }
        }
    }

    value(value: unknown, path: string): SnapshotValue {
        if (value === undefined) return { t: 'undefined' }
        if (value === null) return { t: 'null' }
        if (value === TDZ_VALUE) return { t: 'tdz' }
        if (typeof value === 'boolean') return { t: 'boolean', v: value }
        if (typeof value === 'string') return { t: 'string', v: value }
        if (typeof value === 'bigint') return { t: 'bigint', v: String(value) }
        if (typeof value === 'number') {
            if (Number.isNaN(value)) return { t: 'number', v: 'NaN' }
            if (value === Infinity) return { t: 'number', v: 'Infinity' }
            if (value === -Infinity) return { t: 'number', v: '-Infinity' }
            if (Object.is(value, -0)) return { t: 'number', v: '-0' }
            return { t: 'number', v: value }
        }
        if (typeof value === 'symbol') {
            const name = wellKnownSymbolToName.get(value)
            if (name) return { t: 'symbol', v: name }
            return this.unsupported('Unsupported symbol value', path)
        }

        const vmAsyncBuiltinId = this.vmAsyncSession?.getSerializationBuiltinId(value)
        if (vmAsyncBuiltinId !== undefined) {
            const mutationReason = this.vmAsyncSession?.getSerializationBuiltinMutationReason(value)
            if (mutationReason) {
                return this.unsupported(mutationReason, path)
            }
            return { t: 'vmAsyncBuiltin', id: vmAsyncBuiltinId }
        }
        this.rejectUnsupportedVmAsyncBoundary(value, path)

        const hostId = this.hostRegistry?.getId(value)
        if (hostId !== undefined) {
            const mutationReason = this.hostRegistry?.getMutationReason?.(value)
            if (mutationReason) {
                return this.unsupported(mutationReason, path)
            }
            this.hostOverlay(value, hostId, path)
            return { t: 'host', id: hostId }
        }

        const builtinId = getBuiltinId(value)
        if (builtinId !== undefined) {
            return { t: 'builtin', id: builtinId }
        }

        if (typeof value === 'function') {
            const generatorMethod = this.generatorMethod(value)
            const bound = bindInfo.get(value)
            const descriptor = functionDescriptors.get(value)
            const defaultClassConstructor = defaultClassConstructors.get(value)
            if (!generatorMethod && !bound && !descriptor && !defaultClassConstructor) {
                return this.unsupported('Unregistered host/native function', path)
            }
            if (generatorMethod) {
                this.assertSyncGeneratorState(generatorMethod.state, path)
            }
            if (descriptor) {
                assertSupportedFunctionDescriptor(descriptor, path, this.vmAsyncSession !== undefined)
            }
            return this.object(value, 'function', path)
        }

        if (typeof value === 'object') {
            if (this.generatorStateObject(value)) {
                return this.unsupported('Internal generator state is unsupported as a direct value', path)
            }
            const generatorState = this.generatorObjectState(value)
            if (generatorState) {
                this.assertSyncGeneratorState(generatorState, path)
            }
            const brandError = unsupportedBrand(value)
            if (brandError) {
                return this.unsupported(brandError, path)
            }
            if (isMap(value)) {
                return this.object(value, 'map', path)
            }
            if (isSet(value)) {
                return this.object(value, 'set', path)
            }
            if (isWeakMap(value)) {
                return this.object(value, 'weakMap', path)
            }
            if (isWeakSet(value)) {
                return this.object(value, 'weakSet', path)
            }
            if (
                !Array.isArray(value)
                && !environments.has(value)
                && !vmOwnedObjects.has(value)
                && !serializableHostObjects.has(value)
            ) {
                return this.unsupported('Unregistered host/native object', path)
            }
            return this.object(value, environments.has(value) ? 'frame' : Array.isArray(value) ? 'array' : 'object', path)
        }

        return this.unsupported(`Unsupported value type '${typeof value}'`, path)
    }

    private object(value: object, kind: SnapshotRecord['kind'], path: string): SnapshotValue {
        const existing = this.ids.get(value)
        if (existing !== undefined) {
            return { t: 'ref', id: existing }
        }

        const id = this.records.length + 1
        this.ids.set(value, id)

        const record: SnapshotRecord = {
            id,
            kind,
            extensible: Object.isExtensible(value),
            prototype: { t: 'null' },
            descriptors: [],
        }
        this.records.push(record)

        if (Array.isArray(value)) {
            const source = getProgramSource(value as number[])
            if (source !== undefined) {
                record.programSource = source
            }
        }

        const generatorState = this.generatorObjectState(value)
        if (generatorState) {
            record.generatorState = this.snapshotGeneratorState(generatorState, `${path}.generatorState`)
        }

        record.prototype = this.value(Object.getPrototypeOf(value), `${path}[[Prototype]]`)

        const descriptors = Object.getOwnPropertyDescriptors(value)
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = (descriptors as Record<PropertyKey, PropertyDescriptor>)[key]
            if (kind === 'frame' && key === String(Fields.generator) && 'value' in descriptor) {
                const state = this.generatorStateObject(descriptor.value)
                if (state) {
                    this.assertSyncGeneratorState(state, `${path}.${String(key)}`)
                    record.frameGenerator = this.value(state[Fields.gen], `${path}.generator`)
                    continue
                }
            }
            record.descriptors.push(this.descriptor(
                key,
                descriptor,
                `${path}.${String(key)}`
            ))
        }

        if (typeof value === 'function') {
            const generatorMethod = this.generatorMethod(value)
            const bound = bindInfo.get(value)
            const descriptor = functionDescriptors.get(value)
            const defaultClassConstructor = defaultClassConstructors.get(value)
            if (!generatorMethod && !bound && !descriptor && !defaultClassConstructor) {
                return this.unsupported('Missing VM function descriptor', path)
            }
            if (generatorMethod) {
                record.generatorMethod = {
                    generator: this.value(generatorMethod.state[Fields.gen], `${path}.generatorMethod.generator`),
                    method: generatorMethod.method,
                }
            }
            if (bound) {
                record.boundFunction = {
                    function: this.value(bound[Fields.function], `${path}.bound.function`),
                    self: this.value(bound[Fields.self], `${path}.bound.self`),
                    arguments: bound[Fields.arguments].map((arg, index) =>
                        this.value(arg, `${path}.bound.arguments[${index}]`)
                    ),
                }
            }
            if (descriptor) {
                record.functionDescriptor = {
                    name: descriptor[Fields.name],
                    type: descriptor[Fields.type],
                    offset: descriptor[Fields.offset],
                    bodyOffset: descriptor[Fields.bodyOffset],
                    scopes: this.value(descriptor[Fields.scopes], `${path}.descriptor.scopes`),
                    programSection: this.value(descriptor[Fields.programSection], `${path}.descriptor.programSection`),
                    globalThis: this.value(descriptor[Fields.globalThis], `${path}.descriptor.globalThis`),
                    homeObject: descriptor[Fields.homeObject] === undefined
                        ? undefined
                        : this.value(descriptor[Fields.homeObject], `${path}.descriptor.homeObject`),
                }
            }
            if (defaultClassConstructor) {
                record.defaultClassConstructor = {
                    name: defaultClassConstructor.name,
                    superClass: defaultClassConstructor.superClass === undefined
                        ? undefined
                        : this.value(defaultClassConstructor.superClass, `${path}.defaultClassConstructor.superClass`),
                }
            }
        }

        if (record.kind === 'map') {
            record.entries = []
            let index = 0
            for (const [key, entryValue] of mapEntries.call(value as Map<unknown, unknown>)) {
                record.entries.push([
                    this.value(key, `${path}.entries[${index}].key`),
                    this.value(entryValue, `${path}.entries[${index}].value`),
                ])
                index++
            }
        } else if (record.kind === 'set') {
            record.values = []
            let index = 0
            for (const entryValue of setValues.call(value as Set<unknown>)) {
                record.values.push(this.value(entryValue, `${path}.values[${index}]`))
                index++
            }
        } else if (record.kind === 'weakMap' || record.kind === 'weakSet') {
            this.weakCollections.push({
                value: value as WeakMap<object, unknown> | WeakSet<object>,
                record,
                path,
            })
        }

        return { t: 'ref', id }
    }
}

type FunctionHolder = {
    descriptor?: FunctionDescriptor
    options: RestoreOptions
}

const runRestoredFunction = (
    holder: FunctionHolder,
    self: unknown,
    args: unknown[],
    newTarget: Function | undefined
) => {
    const descriptor = holder.descriptor
    if (!descriptor) {
        throw new Error('Restored VM function descriptor is not initialized')
    }
    const fn = holderFunction.get(holder)
    const invokeData: InvokeParam = newTarget
        ? {
            [Fields.type]: InvokeType.Construct,
            [Fields.function]: fn,
            [Fields.name]: descriptor[Fields.name],
            [Fields.newTarget]: newTarget,
        }
        : {
            [Fields.type]: InvokeType.Apply,
            [Fields.function]: fn,
            [Fields.name]: descriptor[Fields.name],
            [Fields.self]: self,
        }

    const execution = getExecution(
        descriptor[Fields.programSection],
        descriptor[Fields.offset],
        descriptor[Fields.globalThis],
        [...descriptor[Fields.scopes]],
        invokeData,
        args,
        holder.options.getDebugFunction ?? (() => null),
        holder.options.compileFunction,
        holder.options.functionRedirects ?? new WeakMap(),
        null,
        holder.options.admitValue,
        holder.options.asyncHost ?? null
    )

    let result
    do {
        result = execution[Fields.step]()
        if (!result[Fields.done] && (result[Fields.await] || result[Fields.yield])) {
            throw new Error('Unhandled suspension in restored function')
        }
    } while (!result[Fields.done])

    return (result as any)[Fields.value]
}

const holderFunction = new WeakMap<FunctionHolder, Function>()

const runRestoredGeneratorUntilYieldOrDone = (execution: Execution) => {
    let result
    do {
        result = execution[Fields.step]()
        if (!result[Fields.done] && result[Fields.await]) {
            throw new Error('Unhandled async suspension in restored generator')
        }
    } while (!result[Fields.done] && !result[Fields.yield])
    return result
}

const createGeneratorExecution = (state: GeneratorState, options: RestoreOptions): Execution => {
    const frame = state[Fields.stack][0] ?? state[Fields.baseFrame]
    if (!frame) {
        return undefined as unknown as Execution
    }
    const execution = getExecution(
        frame[Fields.programSection],
        state[Fields.ptr],
        frame[Fields.globalThis],
        [],
        undefined,
        [],
        options.getDebugFunction ?? (() => null),
        options.compileFunction,
        options.functionRedirects ?? new WeakMap(),
        null,
        options.admitValue,
        options.asyncHost ?? null
    )
    execution[Fields.stack].length = 0
    return execution
}

const runRestoredGeneratorMethod = (
    state: GeneratorState,
    method: GeneratorResumeKind,
    value: unknown,
    options: RestoreOptions
): IteratorResult<unknown> => {
    if (state[Fields.completed]) {
        if (method === GeneratorResumeKind.Throw) {
            throw value
        }
        return {
            value: method === GeneratorResumeKind.Return ? value : undefined,
            done: true,
        }
    }

    if (!state[Fields.started]) {
        if (method === GeneratorResumeKind.Throw) {
            state[Fields.completed] = true
            state[Fields.stack] = []
            throw value
        }
        if (method === GeneratorResumeKind.Return) {
            state[Fields.completed] = true
            state[Fields.stack] = []
            return { value, done: true }
        }
    }

    if (method === GeneratorResumeKind.Throw) {
        state[Fields.pendingAction] = { [Fields.type]: GeneratorResumeKind.Throw, [Fields.value]: value }
    } else if (method === GeneratorResumeKind.Return) {
        state[Fields.pendingAction] = { [Fields.type]: GeneratorResumeKind.Return, [Fields.value]: value }
    } else {
        state[Fields.pendingAction] = null
    }

    if (!state[Fields.execution]) {
        state[Fields.execution] = createGeneratorExecution(state, options)
    }
    const execution = state[Fields.execution]
    const stack = execution[Fields.stack]
    stack.length = 0
    stack.push(...state[Fields.stack])
    execution[Fields.ptr] = state[Fields.ptr]

    const wasStarted = state[Fields.started]
    state[Fields.started] = true

    if (wasStarted && method === GeneratorResumeKind.Next) {
        execution[Fields.pushValue](value)
    }

    const result = runRestoredGeneratorUntilYieldOrDone(execution)
    if (isResultYield(result)) {
        if (result[Fields.delegate] !== undefined) {
            return result[Fields.value] as IteratorResult<unknown>
        }
        return { value: result[Fields.value], done: false }
    }
    if (isResultDone(result)) {
        state[Fields.completed] = true
        state[Fields.stack] = []
        const out = result[Fields.value]
        if (isIteratorYieldDone(out)) {
            return { value: out.value, done: out.done }
        }
        return { value: out, done: true }
    }
    return { value: undefined, done: true }
}

const createRestoredGeneratorObject = (
    state: GeneratorState,
    options: RestoreOptions
): IterableIterator<unknown> & { return(value?: unknown): IteratorResult<unknown>; throw(error?: unknown): IteratorResult<unknown> } => {
    const gen: any = markVmOwned({
        next(value?: unknown): IteratorResult<unknown> {
            return runRestoredGeneratorMethod(state, GeneratorResumeKind.Next, value, options)
        },
        throw(error?: unknown): IteratorResult<unknown> {
            return runRestoredGeneratorMethod(state, GeneratorResumeKind.Throw, error, options)
        },
        return(value?: unknown): IteratorResult<unknown> {
            return runRestoredGeneratorMethod(state, GeneratorResumeKind.Return, value, options)
        },
        [Symbol.iterator]() { return gen },
    })
    state[Fields.gen] = gen
    generatorObjectStates.set(gen, state)
    generatorSelfMethods.set(gen[Symbol.iterator], state)
    generatorMethodKinds.set(gen.next, GeneratorResumeKind.Next)
    generatorMethodKinds.set(gen.throw, GeneratorResumeKind.Throw)
    generatorMethodKinds.set(gen.return, GeneratorResumeKind.Return)
    generatorStates.set(gen.next, state)
    generatorStates.set(gen.throw, state)
    generatorStates.set(gen.return, state)
    return gen
}

const createRestoredGeneratorFromDescriptor = (
    holder: FunctionHolder,
    self: unknown,
    args: unknown[]
) => {
    const descriptor = holder.descriptor
    if (!descriptor) {
        throw new Error('Restored VM generator descriptor is not initialized')
    }
    const fn = holderFunction.get(holder)
    const invokeData: InvokeParam = {
        [Fields.type]: InvokeType.Apply,
        [Fields.function]: fn,
        [Fields.name]: descriptor[Fields.name],
        [Fields.self]: self,
    }
    const scratchExecution = getExecution(
        descriptor[Fields.programSection],
        descriptor[Fields.offset],
        descriptor[Fields.globalThis],
        [...descriptor[Fields.scopes]],
        invokeData,
        args,
        holder.options.getDebugFunction ?? (() => null),
        holder.options.compileFunction,
        holder.options.functionRedirects ?? new WeakMap(),
        null,
        holder.options.admitValue,
        holder.options.asyncHost ?? null
    )
    const hasNestedFunctionFrame = () => scratchExecution[Fields.stack].some(
        (frame, index) => index > 0 && frame[Fields.type] === FrameType.Function
    )
    while (
        scratchExecution[Fields.stack].length > 0
        && (
            hasNestedFunctionFrame()
            || scratchExecution[Fields.ptr] !== descriptor[Fields.bodyOffset]
        )
    ) {
        const result = scratchExecution[Fields.step]()
        if (result[Fields.done] || result[Fields.yield] || result[Fields.await]) {
            throw new Error('generator prologue suspended unexpectedly')
        }
    }

    const stack: Stack = markVmOwned(scratchExecution[Fields.stack].slice())
    const state: GeneratorState = markVmOwned({
        [Fields.stack]: stack,
        [Fields.ptr]: descriptor[Fields.bodyOffset],
        [Fields.completed]: false,
        [Fields.started]: false,
        [Fields.pendingAction]: null,
        [Fields.baseFrame]: stack[0] ?? null,
        [Fields.gen]: null,
        [Fields.execution]: scratchExecution,
    })
    for (const frame of stack) {
        frame[Fields.generator] = state
    }
    const gen = createRestoredGeneratorObject(state, holder.options)
    const ownPrototype = fn == null ? undefined : Reflect.get(fn, 'prototype')
    Object.setPrototypeOf(
        gen,
        isObjectLike(ownPrototype)
            ? ownPrototype
            : getGeneratorFunctionIntrinsicsForSerialization(descriptor[Fields.globalThis], false).prototype
    )
    return gen
}

class SnapshotReader {
    private readonly refs = new Map<number, any>()
    private readonly holders = new Map<number, FunctionHolder>()
    private readonly generatorStatesByObject = new WeakMap<object, GeneratorState>()
    private graphRestored = false

    constructor(
        private readonly snapshot: ExecutionSnapshot | VmAsyncSessionSnapshot,
        private readonly options: RestoreOptions
    ) {}

    restore(): Execution {
        if (this.snapshot.version !== SNAPSHOT_VERSION) {
            throw new Error('Unsupported execution snapshot version')
        }
        if (typeof this.snapshot.source !== 'string') {
            throw new Error('Execution snapshot is missing JS source')
        }
        if (!('stack' in this.snapshot)) {
            throw new Error('Execution snapshot root is missing')
        }

        this.restoreGraph()
        const stack = this.value(this.snapshot.stack) as Stack
        if (!Array.isArray(stack) || stack.length === 0) {
            throw new Error('Invalid execution snapshot stack')
        }

        const firstFrame = stack[0]
        if (getProgramSource(firstFrame[Fields.programSection]) === undefined) {
            setProgramSource(firstFrame[Fields.programSection], this.snapshot.source)
        }
        const execution = getExecution(
            firstFrame[Fields.programSection],
            this.snapshot.ptr,
            firstFrame[Fields.globalThis],
            [],
            undefined,
            [],
            this.options.getDebugFunction ?? (() => null),
            this.options.compileFunction,
            this.options.functionRedirects ?? new WeakMap(),
            null,
            this.options.admitValue,
            this.options.asyncHost ?? null
        )
        execution[Fields.stack].length = 0
        execution[Fields.stack].push(...stack)
        execution[Fields.ptr] = this.snapshot.ptr
        execution[Fields.evalResult] = this.value(this.snapshot.evalResult)
        return execution
    }

    restoreGraph() {
        if (this.graphRestored) {
            return
        }
        this.graphRestored = true
        for (const record of this.snapshot.records) {
            this.allocate(record)
        }
        for (const record of this.snapshot.records) {
            this.fill(record)
        }
        this.restoreGeneratorStates()
        this.restoreGeneratorSideTables()
        this.applyHostOverlays()
    }

    restoreExecutionState(
        state: SnapshotExecutionState,
        fallbackProgram: number[],
        fallbackGlobalThis: object
    ): Execution {
        this.restoreGraph()
        const stack = this.value(state.stack) as Stack
        if (!Array.isArray(stack)) {
            throw new Error('Invalid VM async execution stack')
        }
        const firstFrame = stack[0]
        const program = firstFrame?.[Fields.programSection] ?? fallbackProgram
        const globalThis = firstFrame?.[Fields.globalThis] ?? fallbackGlobalThis
        if (getProgramSource(program) === undefined) {
            setProgramSource(program, this.snapshot.source)
        }
        const execution = getExecution(
            program,
            state.ptr,
            globalThis,
            [],
            undefined,
            [],
            this.options.getDebugFunction ?? (() => null),
            this.options.compileFunction,
            this.options.functionRedirects ?? new WeakMap(),
            null,
            this.options.admitValue,
            this.options.asyncHost ?? null
        )
        execution[Fields.stack].length = 0
        execution[Fields.stack].push(...stack)
        execution[Fields.ptr] = state.ptr
        execution[Fields.evalResult] = this.value(state.evalResult)
        return execution
    }

    private allocate(record: SnapshotRecord) {
        let value: any
        if (record.kind === 'array') {
            value = markVmOwned([])
        } else if (record.kind === 'map') {
            value = markVmOwned(new Map())
        } else if (record.kind === 'set') {
            value = markVmOwned(new Set())
        } else if (record.kind === 'weakMap') {
            value = markVmOwned(new WeakMap())
        } else if (record.kind === 'weakSet') {
            value = markVmOwned(new WeakSet())
        } else if (record.kind === 'function') {
            const holder: FunctionHolder = { options: this.options }
            const reader = this
            if (record.generatorMethod) {
                if (record.generatorMethod.method === 'iterator') {
                    value = markVmOwned(function () {
                        return reader.value(record.generatorMethod!.generator)
                    })
                } else {
                    const method = record.generatorMethod.method === 'next'
                        ? GeneratorResumeKind.Next
                        : record.generatorMethod.method === 'throw'
                            ? GeneratorResumeKind.Throw
                            : GeneratorResumeKind.Return
                    value = markVmOwned(function (value?: unknown) {
                        return runRestoredGeneratorMethod(
                            reader.generatorStateForGenerator(record.generatorMethod!.generator),
                            method,
                            value,
                            reader.options
                        )
                    })
                }
            } else if (record.boundFunction) {
                const boundTarget = markVmOwned(function (this: unknown, ...args: unknown[]) {
                    const target = reader.value(record.boundFunction!.function) as Function
                    const self = reader.value(record.boundFunction!.self)
                    const boundArgs = record.boundFunction!.arguments.map(arg => reader.value(arg))
                    return new.target
                        ? Reflect.construct(target, [...boundArgs, ...args], new.target)
                        : Reflect.apply(target, self, [...boundArgs, ...args])
                })
                value = markVmOwned(Reflect.apply(Function.prototype.bind, boundTarget, [undefined]))
            } else if (record.defaultClassConstructor) {
                value = markVmOwned(function (this: unknown, ...args: unknown[]) {
                    if (!new.target) {
                        throw new TypeError('Class constructor cannot be invoked without new')
                    }
                    if (record.defaultClassConstructor!.superClass !== undefined) {
                        return Reflect.construct(
                            reader.value(record.defaultClassConstructor!.superClass) as Function,
                            args,
                            new.target
                        )
                    }
                })
            } else if (record.functionDescriptor && isGeneratorType(record.functionDescriptor.type)) {
                const name = record.functionDescriptor.name || 'restored'
                value = markVmOwned({
                    [name](this: unknown, ...args: unknown[]) {
                        return createRestoredGeneratorFromDescriptor(holder, this, args)
                    },
                }[name])
            } else if (usesConstructibleRestoredWrapper(record)) {
                value = markVmOwned(function (this: unknown, ...args: unknown[]) {
                    return runRestoredFunction(holder, this, args, new.target)
                })
            } else if (usesArrowRestoredWrapper(record)) {
                value = markVmOwned((...args: unknown[]) => runRestoredFunction(holder, undefined, args, undefined))
            } else {
                const name = record.functionDescriptor?.name || 'restored'
                value = markVmOwned({
                    [name](this: unknown, ...args: unknown[]) {
                        return runRestoredFunction(holder, this, args, undefined)
                    },
                }[name])
            }
            holderFunction.set(holder, value)
            this.holders.set(record.id, holder)
        } else {
            value = markVmOwned(Object.create(null))
        }
        this.refs.set(record.id, value)
        if (record.kind === 'frame') {
            environments.add(value as Frame)
        }
    }

    private key(key: SnapshotKey): PropertyKey {
        switch (key.t) {
            case 'string':
                return key.v
            case 'internal': {
                const symbol = nameToInternalSymbol.get(key.v)
                if (!symbol) throw new Error(`Unknown internal symbol '${key.v}'`)
                return symbol
            }
            case 'symbol': {
                const symbol = nameToWellKnownSymbol.get(key.v)
                if (!symbol) throw new Error(`Unknown well-known symbol '${key.v}'`)
                return symbol
            }
        }
    }

    private descriptor(descriptor: SnapshotDescriptor): PropertyDescriptor {
        if (descriptor.kind === 'data') {
            return {
                configurable: descriptor.configurable,
                enumerable: descriptor.enumerable,
                writable: descriptor.writable,
                value: this.value(descriptor.value),
            }
        }
        return {
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            get: descriptor.get === undefined ? undefined : this.value(descriptor.get) as (() => any),
            set: descriptor.set === undefined ? undefined : this.value(descriptor.set) as ((v: any) => void),
        }
    }

    private generatorStateForGenerator(generator: SnapshotValue): GeneratorState {
        const gen = this.value(generator)
        if (!isObjectLike(gen)) {
            throw new Error('Invalid generator snapshot reference')
        }
        const state = this.generatorStatesByObject.get(gen as object)
        if (!state) {
            throw new Error('Missing restored generator state')
        }
        return state
    }

    private restoreGeneratorStates() {
        for (const record of this.snapshot.records) {
            if (!record.generatorState) {
                continue
            }
            const target = this.refs.get(record.id)
            const stack = this.value(record.generatorState.stack) as Stack
            const baseFrame = this.value(record.generatorState.baseFrame) as Frame | null
            const pendingAction = record.generatorState.pendingAction === null
                ? null
                : {
                    [Fields.type]: record.generatorState.pendingAction.type,
                    [Fields.value]: this.value(record.generatorState.pendingAction.value),
                }
            const state: GeneratorState = markVmOwned({
                [Fields.stack]: stack,
                [Fields.ptr]: record.generatorState.ptr,
                [Fields.completed]: record.generatorState.completed,
                [Fields.started]: record.generatorState.started,
                [Fields.pendingAction]: pendingAction,
                [Fields.baseFrame]: baseFrame,
                [Fields.gen]: target,
                [Fields.execution]: createGeneratorExecution(
                    {
                        [Fields.stack]: stack,
                        [Fields.ptr]: record.generatorState.ptr,
                        [Fields.completed]: record.generatorState.completed,
                        [Fields.started]: record.generatorState.started,
                        [Fields.pendingAction]: pendingAction,
                        [Fields.baseFrame]: baseFrame,
                        [Fields.gen]: target,
                        [Fields.execution]: undefined as unknown as Execution,
                    },
                    this.options
                ),
            })
            this.generatorStatesByObject.set(target, state)
            generatorObjectStates.set(target, state)
            for (const frame of stack) {
                frame[Fields.generator] = state
            }
        }
    }

    private restoreGeneratorSideTables() {
        for (const record of this.snapshot.records) {
            if (record.generatorMethod) {
                const target = this.refs.get(record.id)
                const state = this.generatorStateForGenerator(record.generatorMethod.generator)
                if (record.generatorMethod.method === 'iterator') {
                    generatorSelfMethods.set(target, state)
                } else {
                    generatorMethodKinds.set(
                        target,
                        record.generatorMethod.method === 'next'
                            ? GeneratorResumeKind.Next
                            : record.generatorMethod.method === 'throw'
                                ? GeneratorResumeKind.Throw
                                : GeneratorResumeKind.Return
                    )
                    generatorStates.set(target, state)
                }
            }

            if (record.frameGenerator) {
                const target = this.refs.get(record.id)
                target[Fields.generator] = this.generatorStateForGenerator(record.frameGenerator)
            }
        }
    }

    private fill(record: SnapshotRecord) {
        const target = this.refs.get(record.id)
        Object.setPrototypeOf(target, this.value(record.prototype) as object | null)

        const descriptors = record.kind === 'array'
            ? [
                ...record.descriptors.filter(descriptor => !(descriptor.key.t === 'string' && descriptor.key.v === 'length')),
                ...record.descriptors.filter(descriptor => descriptor.key.t === 'string' && descriptor.key.v === 'length'),
            ]
            : record.descriptors

        for (const descriptor of descriptors) {
            Object.defineProperty(target, this.key(descriptor.key), this.descriptor(descriptor))
        }

        if (record.functionDescriptor) {
            const descriptor: FunctionDescriptor = {
                [Fields.name]: record.functionDescriptor.name,
                [Fields.type]: record.functionDescriptor.type,
                [Fields.offset]: record.functionDescriptor.offset,
                [Fields.bodyOffset]: record.functionDescriptor.bodyOffset,
                [Fields.scopes]: this.value(record.functionDescriptor.scopes) as Scope[],
                [Fields.programSection]: this.value(record.functionDescriptor.programSection) as number[],
                [Fields.globalThis]: this.value(record.functionDescriptor.globalThis),
                ...(record.functionDescriptor.homeObject === undefined
                    ? {}
                    : { [Fields.homeObject]: this.value(record.functionDescriptor.homeObject) as object }),
            }
            this.holders.get(record.id)!.descriptor = descriptor
            functionDescriptors.set(target, descriptor)
        }

        if (record.defaultClassConstructor) {
            const info: DefaultClassConstructorInfo = {
                name: record.defaultClassConstructor.name,
                ...(record.defaultClassConstructor.superClass === undefined
                    ? {}
                    : { superClass: this.value(record.defaultClassConstructor.superClass) }),
            }
            defaultClassConstructors.set(target, info)
        }

        if (record.boundFunction) {
            bindInfo.set(target, {
                [Fields.function]: this.value(record.boundFunction.function),
                [Fields.self]: this.value(record.boundFunction.self),
                [Fields.arguments]: record.boundFunction.arguments.map(arg => this.value(arg)),
            })
        }

        if (record.kind === 'map') {
            const map = target as Map<unknown, unknown>
            for (const [key, value] of record.entries ?? []) {
                map.set(this.value(key), this.value(value))
            }
        } else if (record.kind === 'weakMap') {
            const map = target as WeakMap<object, unknown>
            for (const [key, value] of record.entries ?? []) {
                map.set(this.value(key) as object, this.value(value))
            }
        } else if (record.kind === 'set') {
            const set = target as Set<unknown>
            for (const value of record.values ?? []) {
                set.add(this.value(value))
            }
        } else if (record.kind === 'weakSet') {
            const set = target as WeakSet<object>
            for (const value of record.values ?? []) {
                set.add(this.value(value) as object)
            }
        }

        if (record.frameGenerator && !Object.prototype.hasOwnProperty.call(target, Fields.generator)) {
            Object.defineProperty(target, Fields.generator, {
                configurable: true,
                enumerable: true,
                writable: true,
                value: undefined,
            })
        }

        if (record.programSource !== undefined) {
            if (!Array.isArray(target)) {
                throw new Error('Program source metadata is only valid on array records')
            }
            setProgramSource(target as number[], record.programSource)
        }

        if (!record.extensible) {
            Object.preventExtensions(target)
        }
    }

    private applyHostOverlays() {
        for (const overlay of this.snapshot.hostOverlays ?? []) {
            if (!this.options.hostRegistry) {
                throw new UnsupportedSerializationError(`Missing host registry for '${overlay.id}'`, '$')
            }
            const target = this.options.hostRegistry.getValue(overlay.id)
            if (!isObjectLike(target)) {
                throw new UnsupportedSerializationError(`Host capability '${overlay.id}' is not an object`, '$')
            }
            for (const key of overlay.deleted) {
                if (!Reflect.deleteProperty(target, this.key(key))) {
                    throw new UnsupportedSerializationError(
                        `Unable to delete host capability property for '${overlay.id}'`,
                        '$'
                    )
                }
            }
            for (const descriptor of overlay.descriptors) {
                Object.defineProperty(target, this.key(descriptor.key), this.descriptor(descriptor))
            }
        }
    }

    value(value: SnapshotValue): unknown {
        switch (value.t) {
            case 'undefined':
                return undefined
            case 'null':
                return null
            case 'boolean':
            case 'string':
                return value.v
            case 'number':
                if (value.v === 'NaN') return NaN
                if (value.v === 'Infinity') return Infinity
                if (value.v === '-Infinity') return -Infinity
                if (value.v === '-0') return -0
                return value.v
            case 'bigint':
                return BigInt(value.v)
            case 'tdz':
                return TDZ_VALUE
            case 'symbol': {
                const symbol = nameToWellKnownSymbol.get(value.v)
                if (!symbol) throw new Error(`Unknown well-known symbol '${value.v}'`)
                return symbol
            }
            case 'ref': {
                if (!this.refs.has(value.id)) {
                    throw new Error(`Invalid snapshot reference '${value.id}'`)
                }
                return this.refs.get(value.id)
            }
            case 'host':
                if (!this.options.hostRegistry) {
                    throw new UnsupportedSerializationError(`Missing host registry for '${value.id}'`, '$')
                }
                return this.options.hostRegistry.getValue(value.id)
            case 'builtin':
                return getBuiltinValue(value.id)
            case 'vmAsyncBuiltin':
                if (!this.options.vmAsyncSession) {
                    throw new UnsupportedSerializationError(`Missing VM async session for '${value.id}'`, '$')
                }
                return this.options.vmAsyncSession.getSerializationBuiltinValue(value.id)
        }
    }
}

export const createSnapshotHistory = (): SnapshotHistory => ({
    version: SNAPSHOT_HISTORY_VERSION,
    rootIds: [],
    checkpoints: [],
})

export const appendExecutionSnapshotCheckpoint = (
    history: SnapshotHistory,
    execution: Execution,
    options: SnapshotOptions = {},
    checkpoint: SnapshotCheckpointOptions = {}
): SnapshotHistory => buildSnapshotCheckpoint(history, {
    id: checkpoint.id ?? nextSnapshotCheckpointId(history),
    ...(checkpoint.parentId === undefined ? {} : { parentId: checkpoint.parentId }),
    ...(checkpoint.label === undefined ? {} : { label: checkpoint.label }),
    ...(checkpoint.createdAt === undefined ? {} : { createdAt: checkpoint.createdAt }),
    kind: 'execution',
    snapshot: snapshotExecution(execution, options),
})

export const appendVmAsyncSessionSnapshotCheckpoint = (
    history: SnapshotHistory,
    session: VmAsyncSession,
    options: VmAsyncSessionSnapshotOptions = {},
    checkpoint: SnapshotCheckpointOptions = {}
): SnapshotHistory => buildSnapshotCheckpoint(history, {
    id: checkpoint.id ?? nextSnapshotCheckpointId(history),
    ...(checkpoint.parentId === undefined ? {} : { parentId: checkpoint.parentId }),
    ...(checkpoint.label === undefined ? {} : { label: checkpoint.label }),
    ...(checkpoint.createdAt === undefined ? {} : { createdAt: checkpoint.createdAt }),
    kind: 'vmAsyncSession',
    snapshot: snapshotVmAsyncSession(session, options),
})

const encodeCompactSnapshotCheckpoint = (
    history: SnapshotHistory,
    checkpoint: SnapshotCheckpoint,
    encodedSnapshots: ReadonlyMap<string, CompactSnapshotCheckpointEnvelope>
): CompactSnapshotHistoryCheckpoint => {
    const snapshot = checkpoint.kind === 'execution'
        ? encodeCompactExecutionSnapshot(checkpoint.snapshot)
        : encodeCompactVmAsyncSessionSnapshot(checkpoint.snapshot)
    const baseCheckpoint = checkpoint.parentId === undefined
        ? undefined
        : history.checkpoints.find(entry => entry.id === checkpoint.parentId)
    const baseSnapshot = checkpoint.parentId === undefined
        ? undefined
        : encodedSnapshots.get(checkpoint.parentId)
    const baseDocument = {
        id: checkpoint.id,
        ...(checkpoint.parentId === undefined ? {} : { parentId: checkpoint.parentId }),
        ...(checkpoint.label === undefined ? {} : { label: checkpoint.label }),
        ...(checkpoint.createdAt === undefined ? {} : { createdAt: checkpoint.createdAt }),
        kind: checkpoint.kind,
    } satisfies CompactSnapshotHistoryCheckpointBase

    if (baseCheckpoint && baseSnapshot && baseCheckpoint.kind === checkpoint.kind) {
        const snapshotDelta = createCompactJsonDelta(baseSnapshot as CompactJsonValue, snapshot as CompactJsonValue)
        const deltaDocument = {
            ...baseDocument,
            deltaFrom: checkpoint.parentId!,
            snapshotDelta,
        } satisfies CompactSnapshotHistoryDeltaCheckpoint
        if (JSON.stringify(deltaDocument).length < JSON.stringify({ ...baseDocument, snapshot }).length) {
            return deltaDocument
        }
    }

    return {
        ...baseDocument,
        snapshot,
    }
}

const decodeCompactSnapshotCheckpoint = (
    checkpoints: CompactSnapshotHistoryCheckpoint[],
    checkpoint: CompactSnapshotHistoryCheckpoint,
    compactSnapshotsById: Map<string, CompactSnapshotCheckpointEnvelope>
): SnapshotCheckpoint => {
    const compactSnapshot: CompactSnapshotCheckpointEnvelope = 'snapshot' in checkpoint
        ? checkpoint.snapshot
        : (() => {
            const baseSnapshot = compactSnapshotsById.get(checkpoint.deltaFrom)
            if (!baseSnapshot) {
                throw new Error(`Unknown delta base checkpoint '${checkpoint.deltaFrom}'`)
            }
            const baseCheckpoint = checkpoints.find(entry => entry.id === checkpoint.deltaFrom)
            if (!baseCheckpoint || baseCheckpoint.kind !== checkpoint.kind) {
                throw new Error(`Snapshot delta base '${checkpoint.deltaFrom}' does not match checkpoint kind`)
            }
            return applyCompactJsonDelta(baseSnapshot as CompactJsonValue, checkpoint.snapshotDelta) as CompactSnapshotCheckpointEnvelope
        })()
    compactSnapshotsById.set(checkpoint.id, compactSnapshot)
    return checkpoint.kind === 'execution'
        ? {
            id: checkpoint.id,
            ...(checkpoint.parentId === undefined ? {} : { parentId: checkpoint.parentId }),
            ...(checkpoint.label === undefined ? {} : { label: checkpoint.label }),
            ...(checkpoint.createdAt === undefined ? {} : { createdAt: checkpoint.createdAt }),
            kind: 'execution',
            snapshot: decodeCompactExecutionSnapshot(compactSnapshot as CompactExecutionSnapshotEnvelope),
        }
        : {
            id: checkpoint.id,
            ...(checkpoint.parentId === undefined ? {} : { parentId: checkpoint.parentId }),
            ...(checkpoint.label === undefined ? {} : { label: checkpoint.label }),
            ...(checkpoint.createdAt === undefined ? {} : { createdAt: checkpoint.createdAt }),
            kind: 'vmAsyncSession',
            snapshot: decodeCompactVmAsyncSessionSnapshot(compactSnapshot as CompactVmAsyncSessionSnapshotEnvelope),
        }
}

export const serializeSnapshotHistory = (history: SnapshotHistory): string => {
    const encodedSnapshots = new Map<string, CompactSnapshotCheckpointEnvelope>()
    const checkpoints = history.checkpoints.map(checkpoint => {
        const encoded = encodeCompactSnapshotCheckpoint(history, checkpoint, encodedSnapshots)
        const compactSnapshot = 'snapshot' in encoded
            ? encoded.snapshot
            : applyCompactJsonDelta(encodedSnapshots.get(encoded.deltaFrom)! as CompactJsonValue, encoded.snapshotDelta) as CompactSnapshotCheckpointEnvelope
        encodedSnapshots.set(checkpoint.id, compactSnapshot)
        return encoded
    })
    return JSON.stringify({
        format: SNAPSHOT_HISTORY_FORMAT,
        version: SNAPSHOT_HISTORY_VERSION,
        rootIds: history.rootIds,
        ...(history.headId === undefined ? {} : { headId: history.headId }),
        checkpoints,
    } satisfies CompactSnapshotHistoryDocument)
}

export const parseSnapshotHistory = (text: string): SnapshotHistory => {
    const parsed = JSON.parse(text) as CompactSnapshotHistoryDocument
    if (
        parsed == null
        || typeof parsed !== 'object'
        || parsed.format !== SNAPSHOT_HISTORY_FORMAT
        || parsed.version !== SNAPSHOT_HISTORY_VERSION
        || !Array.isArray(parsed.rootIds)
        || !Array.isArray(parsed.checkpoints)
    ) {
        throw new Error('Unsupported snapshot history version')
    }
    const compactSnapshotsById = new Map<string, CompactSnapshotCheckpointEnvelope>()
    return {
        version: SNAPSHOT_HISTORY_VERSION,
        rootIds: [...parsed.rootIds],
        ...(parsed.headId === undefined ? {} : { headId: parsed.headId }),
        checkpoints: parsed.checkpoints.map(checkpoint =>
            decodeCompactSnapshotCheckpoint(parsed.checkpoints, checkpoint, compactSnapshotsById)
        ),
    }
}

export const restoreExecutionCheckpoint = (
    history: SnapshotHistory,
    checkpointId: string,
    options: RestoreOptions = {}
): Execution => {
    const checkpoint = getSnapshotCheckpoint(history, checkpointId)
    if (checkpoint.kind !== 'execution') {
        throw new Error(`Snapshot checkpoint '${checkpointId}' is not an execution checkpoint`)
    }
    return restoreExecution(checkpoint.snapshot, options)
}

export const restoreVmAsyncSessionCheckpoint = (
    history: SnapshotHistory,
    checkpointId: string,
    options: VmAsyncSessionRestoreOptions = {}
): VmAsyncSession => {
    const checkpoint = getSnapshotCheckpoint(history, checkpointId)
    if (checkpoint.kind !== 'vmAsyncSession') {
        throw new Error(`Snapshot checkpoint '${checkpointId}' is not a VM async session checkpoint`)
    }
    return restoreVmAsyncSession(checkpoint.snapshot, options)
}

export const snapshotExecution = (
    execution: Execution,
    options: SnapshotOptions = {}
): ExecutionSnapshot => new SnapshotWriter(options.hostRegistry).snapshot(execution)

export const restoreExecution = (
    snapshot: ExecutionSnapshot,
    options: RestoreOptions = {}
): Execution => new SnapshotReader(snapshot, options).restore()

export type VmAsyncSessionSnapshotOptions = SnapshotOptions

export type VmAsyncSessionRestoreOptions = VmAsyncSessionRestoreShellOptions & {
    hostRegistry?: HostCapabilityRegistry
}

export const snapshotVmAsyncSession = (
    session: VmAsyncSession,
    options: VmAsyncSessionSnapshotOptions = {}
): VmAsyncSessionSnapshot => new SnapshotWriter(options.hostRegistry, session).snapshotVmAsyncSession(session)

export const restoreVmAsyncSession = (
    snapshot: VmAsyncSessionSnapshot,
    options: VmAsyncSessionRestoreOptions = {}
): VmAsyncSession => {
    if (snapshot.version !== SNAPSHOT_VERSION) {
        throw new Error('Unsupported VM async session snapshot version')
    }
    if (typeof snapshot.source !== 'string') {
        throw new Error('VM async session snapshot is missing JS source')
    }

    const session = createRestoredVmAsyncSession({
        globalThis: options.globalThis,
        compileFunction: options.compileFunction,
        functionRedirects: options.functionRedirects,
        admitValue: options.admitValue,
        hostPromisePolicy: options.hostPromisePolicy,
        onPause: options.onPause,
    })
    const reader = new SnapshotReader(snapshot, {
        hostRegistry: options.hostRegistry,
        compileFunction: options.compileFunction,
        functionRedirects: options.functionRedirects,
        admitValue: options.admitValue,
        asyncHost: session,
        vmAsyncSession: session,
        getDebugFunction: session.getDebugFunctionForSerialization(),
    })
    reader.restoreGraph()

    const program = reader.value(snapshot.program) as number[]
    const restoredGlobalThis = reader.value(snapshot.globalThis) as object
    if (!Array.isArray(program)) {
        throw new Error('Invalid VM async session program')
    }
    if (!isObjectLike(restoredGlobalThis)) {
        throw new Error('Invalid VM async session global')
    }
    if (getProgramSource(program) === undefined) {
        setProgramSource(program, snapshot.source)
    }

    const executions = new Map<number, Execution>()
    for (const execution of snapshot.executions) {
        executions.set(
            execution.id,
            reader.restoreExecutionState(execution.state, program, restoredGlobalThis)
        )
    }
    const requireExecution = (id: number) => {
        const execution = executions.get(id)
        if (!execution) {
            throw new Error(`Missing VM async execution '${id}'`)
        }
        return execution
    }

    const promises = new Map<number, VmPromiseRecord>()
    const restoredPromises: VmPromiseRecord[] = []
    for (const promise of snapshot.promises) {
        const restored: VmPromiseRecord = {
            id: promise.id,
            promise: reader.value(promise.promise) as object,
            state: promise.state,
            value: reader.value(promise.value),
            fulfillReactions: [],
            rejectReactions: [],
        }
        if (!isObjectLike(restored.promise)) {
            throw new Error(`Invalid VM promise '${promise.id}'`)
        }
        promises.set(restored.id, restored)
        restoredPromises.push(restored)
    }
    const requirePromise = (id: number) => {
        const promise = promises.get(id)
        if (!promise) {
            throw new Error(`Missing VM promise '${id}'`)
        }
        return promise
    }

    const tasks = new Map<number, VmAsyncTask>()
    const restoredTasks: VmAsyncTask[] = []
    for (const task of snapshot.asyncTasks) {
        const restored: VmAsyncTask = {
            id: task.id,
            execution: requireExecution(task.execution),
            promise: requirePromise(task.promise),
        }
        tasks.set(restored.id, restored)
        restoredTasks.push(restored)
    }
    const requireTask = (id: number) => {
        const task = tasks.get(id)
        if (!task) {
            throw new Error(`Missing VM async task '${id}'`)
        }
        return task
    }

    const restoreReaction = (reaction: SnapshotVmPromiseReaction): VmPromiseReaction => {
        if (reaction.type === 'then') {
            return {
                type: 'then',
                kind: reaction.kind,
                handler: reader.value(reaction.handler),
                result: requirePromise(reaction.result),
            }
        }
        return {
            type: 'await',
            kind: reaction.kind,
            task: requireTask(reaction.task),
        }
    }
    for (const promise of snapshot.promises) {
        const restored = requirePromise(promise.id)
        restored.fulfillReactions = promise.fulfillReactions.map(restoreReaction)
        restored.rejectReactions = promise.rejectReactions.map(restoreReaction)
    }

    const restoreJob = (job: SnapshotVmJob): VmJob => {
        if (job.type === 'then') {
            const restored: VmThenJob = {
                id: job.id,
                type: 'then',
                reaction: restoreReaction(job.reaction) as VmThenJob['reaction'],
                argument: reader.value(job.argument),
            }
            if (job.execution !== undefined) {
                restored.execution = requireExecution(job.execution)
            }
            return restored
        }
        if (job.type === 'asyncContinuation') {
            return {
                id: job.id,
                type: 'asyncContinuation',
                task: requireTask(job.task),
                kind: job.kind,
                argument: reader.value(job.argument),
            }
        }
        return {
            id: job.id,
            type: 'asyncStart',
            task: requireTask(job.task),
        }
    }

    const state: VmAsyncSessionSerializableState = {
        program,
        globalThis: restoredGlobalThis,
        mainExecution: requireExecution(snapshot.mainExecution),
        promises: restoredPromises,
        asyncTasks: restoredTasks,
        jobs: snapshot.jobs.map(restoreJob),
        timers: snapshot.timers.map(timer => ({
            id: timer.id,
            dueTick: timer.dueTick,
            promise: requirePromise(timer.promise),
            value: reader.value(timer.value),
        })),
        activeJob: snapshot.activeJob === null ? null : restoreJob(snapshot.activeJob),
        currentTick: snapshot.currentTick,
        nextPromiseId: snapshot.nextPromiseId,
        nextJobId: snapshot.nextJobId,
        nextTimerId: snapshot.nextTimerId,
        nextAsyncTaskId: snapshot.nextAsyncTaskId,
        mainDone: snapshot.mainDone,
        paused: snapshot.paused,
        pausedPtr: snapshot.pausedPtr,
        pausedExecution: snapshot.pausedExecution === undefined
            ? null
            : requireExecution(snapshot.pausedExecution),
    }
    session.restoreSerializableState(state)
    return session
}
