import { OpCode, SpecialVariable } from "../../compiler"
import {
    Context,
    Fields,
    Frame,
    SUPER_REFERENCE_BASE,
    asyncIteratorRecordNext,
    getAsyncIteratorRecord,
    getIterator,
    getIteratorRecord,
    iteratorClose,
    iteratorRecordNext,
    iteratorComplete,
    iteratorNext,
    environments,
    markVmOwned,
    toNumeric,
    toPropertyKey,
} from "../shared"
import type { IteratorRecord } from "../shared"
import { BREAK_COMMAND, OpcodeContextField, type OpcodeHandlerResult, type RuntimeOpcodeContext } from "./types"

const templateObjectCache = new WeakMap<number[], WeakMap<object, any[]>>()

const applyUpdate = (value: unknown, delta: 1 | -1) => {
    const oldValue = toNumeric(value)
    const newValue = typeof oldValue === 'bigint'
        ? oldValue + BigInt(delta)
        : oldValue + delta
    return { oldValue, newValue }
}

const toReferencePropertyKey = (target: unknown, name: unknown) => {
    if (!environments.has(target) && target == null) {
        throw new TypeError('Cannot convert undefined or null to object')
    }
    return toPropertyKey(name)
}

const createRealmArray = (ctx: RuntimeOpcodeContext, values: any[] = []) => {
    const arr = markVmOwned([...values])
    const vmArray = Reflect.get(ctx[OpcodeContextField.currentFrame][Fields.globalThis], 'Array')
    const prototype = vmArray?.prototype
    if (prototype && Object.getPrototypeOf(arr) !== prototype) {
        Object.setPrototypeOf(arr, prototype)
    }
    return arr
}

const createRealmObject = (ctx: RuntimeOpcodeContext) => {
    const vmObject = Reflect.get(ctx[OpcodeContextField.currentFrame][Fields.globalThis], 'Object')
    const prototype = vmObject?.prototype
    return markVmOwned(prototype ? Object.create(prototype) : {})
}

export const handleValueOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): OpcodeHandlerResult => {
    switch (command) {
        case OpCode.ArrayLiteral:
            ctx[OpcodeContextField.pushCurrentFrameStack](createRealmArray(ctx))
            break
        case OpCode.ArraySpread: {
            const iterable = ctx[OpcodeContextField.popCurrentFrameStack]()
            const arr = ctx[OpcodeContextField.popCurrentFrameStack]<any[]>()
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
            ctx[OpcodeContextField.pushCurrentFrameStack](arr)
        }
            break
        case OpCode.TemplateObject: {
            const partCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const cookedParts: any[] = []
            for (let i = 0; i < partCount; i++) {
                cookedParts.unshift(ctx[OpcodeContextField.popCurrentFrameStack]())
            }
            const rawParts: string[] = []
            for (let i = 0; i < partCount; i++) {
                rawParts.unshift(ctx[OpcodeContextField.popCurrentFrameStack]())
            }

            const program = ctx[OpcodeContextField.currentProgram]
            const realm = ctx[OpcodeContextField.currentFrame][Fields.globalThis]
            let realmCache = templateObjectCache.get(program)
            if (!realmCache) {
                realmCache = new WeakMap()
                templateObjectCache.set(program, realmCache)
            }

            let siteCache = realmCache.get(realm)
            if (!siteCache) {
                siteCache = markVmOwned([] as any[])
                realmCache.set(realm, siteCache)
            }

            const site = ctx[OpcodeContextField.commandPtr]
            let templateObject = siteCache[site]
            if (templateObject === undefined) {
                const raw = Object.freeze(createRealmArray(ctx, rawParts))
                templateObject = createRealmArray(ctx, cookedParts)
                Object.defineProperty(templateObject, 'raw', {
                    configurable: false,
                    enumerable: false,
                    writable: false,
                    value: raw,
                })
                Object.freeze(templateObject)
                siteCache[site] = templateObject
            }

            ctx[OpcodeContextField.pushCurrentFrameStack](templateObject)
        }
            break
        case OpCode.ObjectLiteral:
            ctx[OpcodeContextField.pushCurrentFrameStack](createRealmObject(ctx))
            break
        case OpCode.ObjectRest: {
            const excludedKeyCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const excludedKeys: Array<string | symbol> = []
            for (let i = 0; i < excludedKeyCount; i++) {
                const key = ctx[OpcodeContextField.popCurrentFrameStack]()
                excludedKeys.unshift(typeof key === 'symbol' ? key : String(key))
            }

            const source = ctx[OpcodeContextField.popCurrentFrameStack]()
            const rest = createRealmObject(ctx)
            const from = Object(source)
            const excluded = new Set(excludedKeys)

            for (const key of Reflect.ownKeys(from)) {
                if (excluded.has(key)) {
                    continue
                }

                const descriptor = Reflect.getOwnPropertyDescriptor(from, key)
                if (!descriptor?.enumerable) {
                    continue
                }

                rest[key] = from[key]
            }

            ctx[OpcodeContextField.pushCurrentFrameStack](rest)
        }
            break
        case OpCode.ObjectSpread: {
            const source = ctx[OpcodeContextField.popCurrentFrameStack]()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Record<PropertyKey, any>>()

            if (source != null) {
                const from = Object(source)
                for (const key of Reflect.ownKeys(from)) {
                    const descriptor = Reflect.getOwnPropertyDescriptor(from, key)
                    if (!descriptor?.enumerable) {
                        continue
                    }

                    Reflect.defineProperty(target, key, {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: Reflect.get(from, key),
                    })
                }
            }

            ctx[OpcodeContextField.pushCurrentFrameStack](target)
        }
            break
        case OpCode.Typeof: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](typeof value)
        }
            break
        case OpCode.ToPropertyKey: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](toPropertyKey(value))
        }
            break
        case OpCode.TypeofReference: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()
            if (environments.has(target)) {
                const frame = target as Frame
                for (let i = frame[Fields.scopes].length - 1; i >= 0; i--) {
                    const scope = frame[Fields.scopes][i]
                    if (ctx[OpcodeContextField.hasBinding](scope, name)) {
                        ctx[OpcodeContextField.pushCurrentFrameStack](typeof ctx[OpcodeContextField.getBindingValueChecked](scope, name))
                        return BREAK_COMMAND
                    }
                }
                const globalThis = frame[Fields.globalThis]
                if (name === SpecialVariable.This) {
                    ctx[OpcodeContextField.pushCurrentFrameStack](typeof globalThis)
                } else if (ctx[OpcodeContextField.hasBinding](globalThis, name)) {
                    ctx[OpcodeContextField.pushCurrentFrameStack](typeof ctx[OpcodeContextField.getBindingValueChecked](globalThis, name))
                } else if (name in globalThis) {
                    ctx[OpcodeContextField.pushCurrentFrameStack](typeof globalThis[name])
                } else {
                    ctx[OpcodeContextField.pushCurrentFrameStack]('undefined')
                }
            } else {
                ctx[OpcodeContextField.pushCurrentFrameStack](typeof target[name])
            }
        }
            break
        case OpCode.TypeofStaticReference: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            ctx[OpcodeContextField.pushCurrentFrameStack](typeof ctx[OpcodeContextField.getStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index))
        }
            break
        case OpCode.TypeofStaticReferenceUnchecked: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            ctx[OpcodeContextField.pushCurrentFrameStack](typeof ctx[OpcodeContextField.getStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index))
        }
            break
        case OpCode.GetPropertyIterator: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const iterator = (function* (input: any) {
                for (const key in input) {
                    yield key
                }
            })(value)
            ctx[OpcodeContextField.pushCurrentFrameStack](iterator)
        }
            break
        case OpCode.GetIterator: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](getIteratorRecord(value))
        }
            break
        case OpCode.GetAsyncIterator: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](getAsyncIteratorRecord(value))
        }
            break
        case OpCode.IteratorNext: {
            const record = ctx[OpcodeContextField.popCurrentFrameStack]<IteratorRecord>()
            ctx[OpcodeContextField.pushCurrentFrameStack](iteratorRecordNext(record))
        }
            break
        case OpCode.AsyncIteratorNext: {
            const record = ctx[OpcodeContextField.popCurrentFrameStack]<IteratorRecord>()
            const PromiseCtor = Reflect.get(ctx[OpcodeContextField.currentFrame][Fields.globalThis], 'Promise') ?? Promise
            const promiseResolve = (value: unknown) => Reflect.get(PromiseCtor, 'resolve').call(PromiseCtor, value) as PromiseLike<unknown>
            ctx[OpcodeContextField.pushCurrentFrameStack](asyncIteratorRecordNext(record, promiseResolve))
        }
            break
        case OpCode.IteratorClose: {
            const suppressErrors = ctx[OpcodeContextField.popCurrentFrameStack]<boolean>()
            const record = ctx[OpcodeContextField.popCurrentFrameStack]<IteratorRecord>()
            iteratorClose(record, suppressErrors)
        }
            break
        case OpCode.NextEntry: {
            const iterator: Iterator<any> = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](iterator.next())
        }
            break
        case OpCode.EntryIsDone: {
            const entry: IteratorResult<any> = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](entry.done)
        }
            break
        case OpCode.EntryGetValue: {
            const entry: IteratorResult<any> = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](entry.value)
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
        case OpCode.BExclamationEquals:
        case OpCode.BExclamationEqualsEquals:
        case OpCode.BMinus:
        case OpCode.BPlus:
        case OpCode.BIn:
        case OpCode.BAsterisk:
        case OpCode.BAsteriskAsterisk:
        case OpCode.BSlash:
        case OpCode.BPercent: {
            const right = ctx[OpcodeContextField.popCurrentFrameStack]()
            const left = ctx[OpcodeContextField.popCurrentFrameStack]()
            const ops = {
                [OpCode.BAmpersand]: (lhs: any, rhs: any) => lhs & rhs,
                [OpCode.BBar]: (lhs: any, rhs: any) => lhs | rhs,
                [OpCode.BCaret]: (lhs: any, rhs: any) => lhs ^ rhs,
                [OpCode.BEqualsEquals]: (lhs: any, rhs: any) => lhs == rhs,
                [OpCode.BEqualsEqualsEquals]: (lhs: any, rhs: any) => lhs === rhs,
                [OpCode.BExclamationEquals]: (lhs: any, rhs: any) => lhs != rhs,
                [OpCode.BExclamationEqualsEquals]: (lhs: any, rhs: any) => lhs !== rhs,
                [OpCode.BGreaterThan]: (lhs: any, rhs: any) => lhs > rhs,
                [OpCode.BGreaterThanGreaterThan]: (lhs: any, rhs: any) => lhs >> rhs,
                [OpCode.BGreaterThanGreaterThanGreaterThan]: (lhs: any, rhs: any) => lhs >>> rhs,
                [OpCode.BGreaterThanEquals]: (lhs: any, rhs: any) => lhs >= rhs,
                [OpCode.BLessThan]: (lhs: any, rhs: any) => lhs < rhs,
                [OpCode.BLessThanLessThan]: (lhs: any, rhs: any) => lhs << rhs,
                [OpCode.BLessThanEquals]: (lhs: any, rhs: any) => lhs <= rhs,
                [OpCode.BPlus]: (lhs: any, rhs: any) => lhs + rhs,
                [OpCode.BMinus]: (lhs: any, rhs: any) => lhs - rhs,
                [OpCode.InstanceOf]: (lhs: any, rhs: any) => lhs instanceof rhs,
                [OpCode.BIn]: (lhs: any, rhs: any) => lhs in rhs,
                [OpCode.BAsterisk]: (lhs: any, rhs: any) => lhs * rhs,
                [OpCode.BAsteriskAsterisk]: (lhs: any, rhs: any) => lhs ** rhs,
                [OpCode.BSlash]: (lhs: any, rhs: any) => lhs / rhs,
                [OpCode.BPercent]: (lhs: any, rhs: any) => lhs % rhs,
            }
            ctx[OpcodeContextField.pushCurrentFrameStack](ops[command](left, right))
        }
            break
        case OpCode.PostFixPlusPLus:
        case OpCode.PostFixMinusMinus: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()
            const propertyKey = toReferencePropertyKey(target, name)
            const { oldValue, newValue } = applyUpdate(
                ctx[OpcodeContextField.getValue](target, propertyKey),
                command === OpCode.PostFixPlusPLus ? 1 : -1
            )
            ctx[OpcodeContextField.setValue](target, propertyKey, newValue)
            ctx[OpcodeContextField.pushCurrentFrameStack](oldValue)
        }
            break
        case OpCode.PostFixPlusPLusStatic:
        case OpCode.PostFixMinusMinusStatic: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const { oldValue, newValue } = applyUpdate(
                ctx[OpcodeContextField.getStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index),
                command === OpCode.PostFixPlusPLusStatic ? 1 : -1
            )
            ctx[OpcodeContextField.setStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index, newValue)
            ctx[OpcodeContextField.pushCurrentFrameStack](oldValue)
        }
            break
        case OpCode.PostFixPlusPLusStaticUnchecked:
        case OpCode.PostFixMinusMinusStaticUnchecked: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const { oldValue, newValue } = applyUpdate(
                ctx[OpcodeContextField.getStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index),
                command === OpCode.PostFixPlusPLusStaticUnchecked ? 1 : -1
            )
            ctx[OpcodeContextField.setStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index, newValue)
            ctx[OpcodeContextField.pushCurrentFrameStack](oldValue)
        }
            break
        case OpCode.PrefixUnaryPlus:
        case OpCode.PrefixUnaryMinus:
        case OpCode.PrefixExclamation:
        case OpCode.PrefixTilde: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
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
            ctx[OpcodeContextField.pushCurrentFrameStack](result)
        }
            break
        case OpCode.PrefixPlusPlus:
        case OpCode.PrefixMinusMinus: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]()
            const propertyKey = toReferencePropertyKey(target, name)
            const { newValue } = applyUpdate(
                ctx[OpcodeContextField.getValue](target, propertyKey),
                command === OpCode.PrefixPlusPlus ? 1 : -1
            )
            ctx[OpcodeContextField.setValue](target, propertyKey, newValue)
            ctx[OpcodeContextField.pushCurrentFrameStack](newValue)
        }
            break
        case OpCode.PrefixPlusPlusStatic:
        case OpCode.PrefixMinusMinusStatic: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const { newValue } = applyUpdate(
                ctx[OpcodeContextField.getStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index),
                command === OpCode.PrefixPlusPlusStatic ? 1 : -1
            )
            ctx[OpcodeContextField.setStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index, newValue)
            ctx[OpcodeContextField.pushCurrentFrameStack](newValue)
        }
            break
        case OpCode.PrefixPlusPlusStaticUnchecked:
        case OpCode.PrefixMinusMinusStaticUnchecked: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const { newValue } = applyUpdate(
                ctx[OpcodeContextField.getStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index),
                command === OpCode.PrefixPlusPlusStaticUnchecked ? 1 : -1
            )
            ctx[OpcodeContextField.setStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index, newValue)
            ctx[OpcodeContextField.pushCurrentFrameStack](newValue)
        }
            break
        case OpCode.Delete: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Record<PropertyKey, any> | null | undefined>()
            if (target != null && typeof target === 'object' && SUPER_REFERENCE_BASE in target) {
                throw new ReferenceError('Cannot delete super property')
            }
            if (!environments.has(target)) {
                if (target == null) {
                    throw new TypeError('Cannot convert undefined or null to object')
                }
                const propertyKey = toPropertyKey(name)
                const deleted = Reflect.deleteProperty(Object(target), propertyKey)
                if (!deleted && ctx[OpcodeContextField.currentFrame][Fields.strict]) {
                    throw new TypeError(`Cannot delete property '${String(propertyKey)}'`)
                }
                ctx[OpcodeContextField.pushCurrentFrameStack](deleted)
            } else {
                const env = target as Frame
                const bindingName = typeof name === 'symbol' ? null : String(name)
                const scope = bindingName == null
                    ? null
                    : ctx[OpcodeContextField.findScope](env, bindingName)
                if (scope) {
                    ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.deleteBinding](scope, bindingName!))
                } else {
                    ctx[OpcodeContextField.pushCurrentFrameStack](true)
                }
            }
        }
            break
    }
}
