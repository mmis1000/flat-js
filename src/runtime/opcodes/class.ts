import { OpCode } from "../../compiler"
import { Fields, formatFunctionName, functionDescriptors } from "../shared"
import { OpcodeContextField, type RuntimeOpcodeContext } from "./types"

export const handleClassOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): void => {
    switch (command) {
        case OpCode.CreateClass: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<PropertyKey | undefined>()
            const superClass = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
            const ctorFn = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
            const hasHeritage = superClass !== undefined
            const className = formatFunctionName(
                name === undefined
                    ? ctx[OpcodeContextField.peak]<PropertyKey>(ctx[OpcodeContextField.currentFrameStack])
                    : name
            )

            let classFn: any
            if (ctorFn === undefined) {
                if (hasHeritage) {
                    classFn = function (this: any, ...args: any[]) {
                        return Reflect.construct(superClass, args, new.target)
                    }
                } else {
                    classFn = function () {}
                }
                Object.defineProperty(classFn, 'name', { value: className, configurable: true })
            } else {
                classFn = ctorFn
            }

            if (hasHeritage) {
                classFn.prototype = Object.create(superClass === null ? null : superClass.prototype)
                Object.defineProperty(classFn.prototype, 'constructor', {
                    value: classFn,
                    writable: true,
                    configurable: true,
                    enumerable: false,
                })
                if (superClass !== null) {
                    Object.setPrototypeOf(classFn, superClass)
                }
            }

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
