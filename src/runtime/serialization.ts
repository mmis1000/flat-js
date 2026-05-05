import { FunctionTypes, InvokeType } from "../compiler"
import { getProgramSource, setProgramSource } from "../compiler/shared"
import {
    bindInfo,
    environments,
    Execution,
    Fields,
    Frame,
    FunctionDescriptor,
    functionDescriptors,
    generatorStates,
    InvokeParam,
    markVmOwned,
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
import { getExecution } from "./execution"
import type { DebugCallback } from "./opcodes/types"

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

type SnapshotRecord = {
    id: number
    kind: 'object' | 'array' | 'function' | 'frame' | 'map' | 'set' | 'weakMap' | 'weakSet'
    extensible: boolean
    prototype: SnapshotValue
    descriptors: SnapshotDescriptor[]
    programSource?: string
    functionDescriptor?: SnapshotFunctionDescriptor
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

type SerializableHostObjectRedirectOptions = {
    globalThis?: any
    functionRedirects?: WeakMap<Function, Function>
}

type RestoreOptions = {
    hostRegistry?: HostCapabilityRegistry
    compileFunction?: typeof import('../compiler').compile
    functionRedirects?: WeakMap<Function, Function>
    getDebugFunction?: () => null | DebugCallback
}

const SNAPSHOT_VERSION = 1

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
    JSON.stringify(snapshot)

export const parseExecutionSnapshot = (text: string): ExecutionSnapshot => {
    const parsed = JSON.parse(text)
    if (parsed == null || typeof parsed !== 'object' || parsed.version !== SNAPSHOT_VERSION) {
        throw new Error('Unsupported execution snapshot version')
    }
    if (typeof parsed.source !== 'string') {
        throw new Error('Execution snapshot is missing JS source')
    }
    return parsed as ExecutionSnapshot
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

const isSupportedFunctionType = (type: FunctionTypes) => {
    switch (type) {
        case FunctionTypes.FunctionDeclaration:
        case FunctionTypes.FunctionExpression:
        case FunctionTypes.ArrowFunction:
            return true
        default:
            return false
    }
}

const assertSupportedFunctionDescriptor = (descriptor: FunctionDescriptor, path: string) => {
    if (!isSupportedFunctionType(descriptor[Fields.type])) {
        throw new UnsupportedSerializationError('Unsupported VM function type', path)
    }
    if (descriptor[Fields.homeObject] !== undefined) {
        throw new UnsupportedSerializationError('VM methods/classes with home object are unsupported', path)
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

class SnapshotWriter {
    private readonly ids = new Map<object, number>()
    private readonly records: SnapshotRecord[] = []
    private readonly hostOverlays: SnapshotHostOverlay[] = []
    private readonly serializedHostOverlays = new Set<string>()
    private readonly weakCollections: Array<{ value: WeakMap<object, unknown> | WeakSet<object>, record: SnapshotRecord, path: string }> = []
    private readonly weakCollectionKeyIds = new WeakMap<SnapshotRecord, Set<number>>()

    constructor(private readonly hostRegistry?: HostCapabilityRegistry) {}

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
            ptr: execution[Fields.ptr],
            evalResult: this.value(execution[Fields.evalResult], '$.evalResult'),
            stack: this.value(execution[Fields.stack], '$.stack'),
            records: this.records,
            hostOverlays: this.hostOverlays,
        }
        this.finalizeWeakCollections()
        return snapshot
    }

    private unsupported(reason: string, path: string): never {
        throw new UnsupportedSerializationError(reason, path)
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
            if (bindInfo.has(value)) {
                return this.unsupported('Bound VM functions are unsupported', path)
            }
            if (generatorStates.has(value)) {
                return this.unsupported('Generators are unsupported', path)
            }
            const descriptor = functionDescriptors.get(value)
            if (!descriptor) {
                return this.unsupported('Unregistered host/native function', path)
            }
            assertSupportedFunctionDescriptor(descriptor, path)
            return this.object(value, 'function', path)
        }

        if (typeof value === 'object') {
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

        record.prototype = this.value(Object.getPrototypeOf(value), `${path}[[Prototype]]`)

        const descriptors = Object.getOwnPropertyDescriptors(value)
        for (const key of Reflect.ownKeys(descriptors)) {
            record.descriptors.push(this.descriptor(
                key,
                (descriptors as Record<PropertyKey, PropertyDescriptor>)[key],
                `${path}.${String(key)}`
            ))
        }

        if (typeof value === 'function') {
            const descriptor = functionDescriptors.get(value)
            if (!descriptor) {
                return this.unsupported('Missing VM function descriptor', path)
            }
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
        holder.options.functionRedirects ?? new WeakMap()
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

class SnapshotReader {
    private readonly refs = new Map<number, any>()
    private readonly holders = new Map<number, FunctionHolder>()

    constructor(
        private readonly snapshot: ExecutionSnapshot,
        private readonly options: RestoreOptions
    ) {}

    restore(): Execution {
        if (this.snapshot.version !== SNAPSHOT_VERSION) {
            throw new Error('Unsupported execution snapshot version')
        }
        if (typeof this.snapshot.source !== 'string') {
            throw new Error('Execution snapshot is missing JS source')
        }

        for (const record of this.snapshot.records) {
            this.allocate(record)
        }
        for (const record of this.snapshot.records) {
            this.fill(record)
        }
        this.applyHostOverlays()

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
            this.options.functionRedirects ?? new WeakMap()
        )
        execution[Fields.stack].length = 0
        execution[Fields.stack].push(...stack)
        execution[Fields.ptr] = this.snapshot.ptr
        execution[Fields.evalResult] = this.value(this.snapshot.evalResult)
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
            value = hasOwnPrototype(record)
                ? markVmOwned(function (this: unknown, ...args: unknown[]) {
                    return runRestoredFunction(holder, this, args, new.target)
                })
                : markVmOwned((...args: unknown[]) => runRestoredFunction(holder, undefined, args, undefined))
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
        }
    }
}

export const snapshotExecution = (
    execution: Execution,
    options: SnapshotOptions = {}
): ExecutionSnapshot => new SnapshotWriter(options.hostRegistry).snapshot(execution)

export const restoreExecution = (
    snapshot: ExecutionSnapshot,
    options: RestoreOptions = {}
): Execution => new SnapshotReader(snapshot, options).restore()
