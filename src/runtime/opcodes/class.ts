import { FunctionTypes, OpCode } from "../../compiler"
import { bindInfo, defaultClassConstructors, Fields, formatFunctionName, functionDescriptors, markVmOwned } from "../shared"
import { OpcodeContextField, type RuntimeOpcodeContext } from "./types"

const isClassVmConstructible = (fn: any) => {
    const bound = bindInfo.get(fn)
    if (bound) {
        return isClassVmConstructible(bound[Fields.function])
    }

    const descriptor = functionDescriptors.get(fn)
    if (!descriptor) {
        if (typeof fn !== 'function') {
            return false
        }
        try {
            new (new Proxy(fn, {
                construct() {
                    return {}
                }
            }))()
            return true
        } catch {
            return false
        }
    }

    switch (descriptor[Fields.type]) {
        case FunctionTypes.FunctionDeclaration:
        case FunctionTypes.FunctionExpression:
        case FunctionTypes.Constructor:
        case FunctionTypes.DerivedConstructor:
            return true
        default:
            return false
    }
}

export const handleClassOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): void => {
    switch (command) {
        case OpCode.CreateClass: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<PropertyKey | undefined>()
            const superClass = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
            const ctorFn = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
            const hasHeritage = superClass !== undefined
            const vmGlobal = ctx[OpcodeContextField.currentFrame][Fields.globalThis]
            const className = formatFunctionName(
                name === undefined
                    ? ctx[OpcodeContextField.peak]<PropertyKey>(ctx[OpcodeContextField.currentFrameStack])
                    : name
            )

            let classFn: any
            if (ctorFn === undefined) {
                if (hasHeritage) {
                    classFn = function (this: any, ...args: any[]) {
                        if (!new.target) {
                            throw new TypeError('Class constructor cannot be invoked without new')
                        }
                        return Reflect.construct(superClass, args, new.target)
                    }
                } else {
                    classFn = function () {
                        if (!new.target) {
                            throw new TypeError('Class constructor cannot be invoked without new')
                        }
                    }
                }
                Object.defineProperty(classFn, 'name', { value: className, configurable: true })
                markVmOwned(classFn)
                defaultClassConstructors.set(classFn, {
                    name: className,
                    ...(hasHeritage ? { superClass } : {}),
                })
            } else {
                classFn = ctorFn
            }

            let prototypeParent = vmGlobal?.Object?.prototype ?? Object.prototype
            let constructorParent = vmGlobal?.Function?.prototype ?? Function.prototype
            if (hasHeritage) {
                if (superClass === null) {
                    prototypeParent = null
                } else {
                    if (!isClassVmConstructible(superClass)) {
                        throw new TypeError('Class extends value is not a constructor or null')
                    }
                    prototypeParent = superClass.prototype
                    if (
                        prototypeParent !== null
                        && (typeof prototypeParent !== 'object' && typeof prototypeParent !== 'function')
                    ) {
                        throw new TypeError('Class extends value has invalid prototype property')
                    }
                    constructorParent = superClass
                }
            }

            if (Object.getPrototypeOf(classFn) !== constructorParent) {
                Object.setPrototypeOf(classFn, constructorParent)
            }

            const classPrototype = markVmOwned(Object.create(prototypeParent))
            Object.defineProperty(classPrototype, 'constructor', {
                value: classFn,
                writable: true,
                configurable: true,
                enumerable: false,
            })
            Object.defineProperty(classFn, 'prototype', {
                value: classPrototype,
                writable: false,
                configurable: false,
                enumerable: false,
            })

            const descriptor = functionDescriptors.get(classFn)
            if (descriptor) {
                descriptor[Fields.homeObject] = classFn.prototype
            }

            ctx[OpcodeContextField.pushCurrentFrameStack](classFn)
        }
            break
        case OpCode.DefineMethod: {
            const enumerable = !!ctx[OpcodeContextField.popCurrentFrameStack]()
            const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<PropertyKey>()
            const obj = ctx[OpcodeContextField.popCurrentFrameStack]<Record<PropertyKey, any>>()
            const descriptor = functionDescriptors.get(fn)
            if (descriptor) {
                descriptor[Fields.homeObject] = obj
            }

            Object.defineProperty(obj, name, {
                value: fn,
                writable: true,
                configurable: true,
                enumerable,
            })

            ctx[OpcodeContextField.pushCurrentFrameStack](obj)
        }
            break
        case OpCode.DefineGetter: {
            const enumerable = !!ctx[OpcodeContextField.popCurrentFrameStack]()
            const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<PropertyKey>()
            const obj = ctx[OpcodeContextField.popCurrentFrameStack]<Record<PropertyKey, any>>()
            const fnDescriptor = functionDescriptors.get(fn)
            if (fnDescriptor) {
                fnDescriptor[Fields.homeObject] = obj
            }

            const existing = Object.getOwnPropertyDescriptor(obj, name) || {}
            Object.defineProperty(obj, name, {
                get: fn as () => any,
                set: existing.set,
                configurable: true,
                enumerable,
            })

            ctx[OpcodeContextField.pushCurrentFrameStack](obj)
        }
            break
        case OpCode.DefineSetter: {
            const enumerable = !!ctx[OpcodeContextField.popCurrentFrameStack]()
            const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<PropertyKey>()
            const obj = ctx[OpcodeContextField.popCurrentFrameStack]<Record<PropertyKey, any>>()
            const fnDescriptor = functionDescriptors.get(fn)
            if (fnDescriptor) {
                fnDescriptor[Fields.homeObject] = obj
            }

            const existing = Object.getOwnPropertyDescriptor(obj, name) || {}
            Object.defineProperty(obj, name, {
                get: existing.get,
                set: fn as (v: any) => void,
                configurable: true,
                enumerable,
            })

            ctx[OpcodeContextField.pushCurrentFrameStack](obj)
        }
            break
    }
}
