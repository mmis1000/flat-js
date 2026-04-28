import { OpCode, SpecialVariable } from "../../compiler"
import {
    Context,
    Fields,
    Frame,
    getIterator,
    is_not_defined,
    iteratorComplete,
    iteratorNext,
    environments,
} from "../shared"
import { BREAK_COMMAND, OpcodeContextField, type OpcodeHandlerResult, type RuntimeOpcodeContext } from "./types"

const templateObjectCache = new WeakMap<number[], WeakMap<object, any[]>>()

export const handleValueOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): OpcodeHandlerResult => {
    switch (command) {
        case OpCode.ArrayLiteral:
            ctx[OpcodeContextField.pushCurrentFrameStack]([])
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
                siteCache = []
                realmCache.set(realm, siteCache)
            }

            const site = ctx[OpcodeContextField.commandPtr]
            let templateObject = siteCache[site]
            if (templateObject === undefined) {
                const raw = Object.freeze([...rawParts])
                templateObject = [...cookedParts]
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
            ctx[OpcodeContextField.pushCurrentFrameStack]({})
            break
        case OpCode.Typeof: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](typeof value)
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
                [OpCode.BSlash]: (lhs: any, rhs: any) => lhs / rhs,
                [OpCode.BPercent]: (lhs: any, rhs: any) => lhs % rhs,
            }
            ctx[OpcodeContextField.pushCurrentFrameStack](ops[command](left, right))
        }
            break
        case OpCode.PostFixPlusPLus:
        case OpCode.PostFixMinusMinus: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()
            if (environments.has(target)) {
                const env = target as Frame
                const scope = ctx[OpcodeContextField.findScope](env, name)
                if (!scope) {
                    throw new ReferenceError(name + is_not_defined)
                }
                const old = ctx[OpcodeContextField.getBindingValueChecked](scope, name)
                const newVal = command === OpCode.PostFixPlusPLus ? old + 1 : old - 1
                ctx[OpcodeContextField.setBindingValueChecked](scope, name, newVal)
                ctx[OpcodeContextField.pushCurrentFrameStack](old)
            } else {
                try {
                    const old = target[name]
                    const newVal = command === OpCode.PostFixPlusPLus ? old + 1 : old - 1
                    target[name] = newVal
                    ctx[OpcodeContextField.pushCurrentFrameStack](old)
                } catch (error) {
                    ctx[OpcodeContextField.rethrowNativeErrorInRealm](error, ctx[OpcodeContextField.currentFrame][Fields.globalThis])
                }
            }
        }
            break
        case OpCode.PostFixPlusPLusStatic:
        case OpCode.PostFixMinusMinusStatic: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const old = ctx[OpcodeContextField.getStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index)
            const newVal = command === OpCode.PostFixPlusPLusStatic ? old + 1 : old - 1
            ctx[OpcodeContextField.setStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index, newVal)
            ctx[OpcodeContextField.pushCurrentFrameStack](old)
        }
            break
        case OpCode.PostFixPlusPLusStaticUnchecked:
        case OpCode.PostFixMinusMinusStaticUnchecked: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const old = ctx[OpcodeContextField.getStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index)
            const newVal = command === OpCode.PostFixPlusPLusStaticUnchecked ? old + 1 : old - 1
            ctx[OpcodeContextField.setStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index, newVal)
            ctx[OpcodeContextField.pushCurrentFrameStack](old)
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
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]()
            const currentValue = ctx[OpcodeContextField.getValue](target, name)
            const newVal = command === OpCode.PrefixPlusPlus ? currentValue + 1 : currentValue - 1
            ctx[OpcodeContextField.setValue](target, name, newVal)
            ctx[OpcodeContextField.pushCurrentFrameStack](newVal)
        }
            break
        case OpCode.PrefixPlusPlusStatic:
        case OpCode.PrefixMinusMinusStatic: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const currentValue = ctx[OpcodeContextField.getStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index)
            const newVal = command === OpCode.PrefixPlusPlusStatic ? currentValue + 1 : currentValue - 1
            ctx[OpcodeContextField.setStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index, newVal)
            ctx[OpcodeContextField.pushCurrentFrameStack](newVal)
        }
            break
        case OpCode.PrefixPlusPlusStaticUnchecked:
        case OpCode.PrefixMinusMinusStaticUnchecked: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const currentValue = ctx[OpcodeContextField.getStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index)
            const newVal = command === OpCode.PrefixPlusPlusStaticUnchecked ? currentValue + 1 : currentValue - 1
            ctx[OpcodeContextField.setStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index, newVal)
            ctx[OpcodeContextField.pushCurrentFrameStack](newVal)
        }
            break
        case OpCode.Delete: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Record<string, any>>()
            if (!environments.has(target)) {
                try {
                    ctx[OpcodeContextField.pushCurrentFrameStack](delete target[name])
                } catch (error) {
                    ctx[OpcodeContextField.rethrowNativeErrorInRealm](error, ctx[OpcodeContextField.currentFrame][Fields.globalThis])
                }
            } else {
                const env = target as Frame
                const scope = ctx[OpcodeContextField.findScope](env, name)
                if (scope) {
                    ctx[OpcodeContextField.pushCurrentFrameStack](delete scope[name])
                } else {
                    ctx[OpcodeContextField.pushCurrentFrameStack](true)
                }
            }
        }
            break
    }
}
