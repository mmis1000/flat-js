import { OpCode } from "../../compiler"
import { OpcodeContextField, type RuntimeOpcodeContext } from "./types"

export const handleClassOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): void => {
    switch (command) {
        case OpCode.CreateClass: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const superClass = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
            const ctorFn = ctx[OpcodeContextField.popCurrentFrameStack]<any>()

            let classFn: any
            if (ctorFn === undefined) {
                if (superClass !== null) {
                    classFn = function (this: any, ...args: any[]) {
                        return Reflect.construct(superClass, args, new.target)
                    }
                } else {
                    classFn = function () {}
                }
                Object.defineProperty(classFn, 'name', { value: name, configurable: true })
            } else {
                classFn = ctorFn
            }

            if (superClass !== null) {
                classFn.prototype = Object.create(superClass.prototype)
                Object.defineProperty(classFn.prototype, 'constructor', {
                    value: classFn,
                    writable: true,
                    configurable: true,
                    enumerable: false,
                })
                Object.setPrototypeOf(classFn, superClass)
            }

            ctx[OpcodeContextField.pushCurrentFrameStack](classFn)
        }
            break
        case OpCode.DefineMethod: {
            const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const obj = ctx[OpcodeContextField.popCurrentFrameStack]<Record<string, any>>()

            Object.defineProperty(obj, name, {
                value: fn,
                writable: true,
                configurable: true,
                enumerable: false,
            })

            ctx[OpcodeContextField.pushCurrentFrameStack](obj)
        }
            break
        case OpCode.DefineGetter: {
            const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const obj = ctx[OpcodeContextField.popCurrentFrameStack]<Record<string, any>>()

            const existing = Object.getOwnPropertyDescriptor(obj, name) || {}
            Object.defineProperty(obj, name, {
                get: fn as () => any,
                set: existing.set,
                configurable: true,
                enumerable: false,
            })

            ctx[OpcodeContextField.pushCurrentFrameStack](obj)
        }
            break
        case OpCode.DefineSetter: {
            const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const obj = ctx[OpcodeContextField.popCurrentFrameStack]<Record<string, any>>()

            const existing = Object.getOwnPropertyDescriptor(obj, name) || {}
            Object.defineProperty(obj, name, {
                get: existing.get,
                set: fn as (v: any) => void,
                configurable: true,
                enumerable: false,
            })

            ctx[OpcodeContextField.pushCurrentFrameStack](obj)
        }
            break
    }
}
