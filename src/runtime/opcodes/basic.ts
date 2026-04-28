import { OpCode, SetFlag } from "../../compiler"
import {
    Context,
    Fields,
    Frame,
    REGEXP,
    Scope,
    TDZ_VALUE,
    TEXT_DADA_MASK,
    VariableFlags,
    VariableRecord,
    getEmptyObject,
    getLiteralFromPool,
    isSmallNumber,
    is_a_constant,
    is_not_defined,
} from "../shared"
import { OpcodeContextField, type RuntimeOpcodeContext } from "./types"

export const handleBasicOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): void => {
    switch (command) {
        case OpCode.Literal: {
            const value = ctx[OpcodeContextField.read]()
            if (isSmallNumber(value)) {
                ctx[OpcodeContextField.pushCurrentFrameStack](value)
            } else {
                const pos = value ^ TEXT_DADA_MASK
                ctx[OpcodeContextField.pushCurrentFrameStack](getLiteralFromPool(ctx[OpcodeContextField.currentProgram], pos))
            }
        }
            break
        case OpCode.Pop:
            ctx[OpcodeContextField.popCurrentFrameStack]()
            break
        case OpCode.SetEvalResult:
            ctx[OpcodeContextField.evalResult] = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.valueStack])
            break
        case OpCode.Duplicate:
            ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.valueStack]))
            break
        case OpCode.GetRecord:
            ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.currentFrame])
            break
        case OpCode.GetStatic: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.getStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index))
        }
            break
        case OpCode.GetStaticUnchecked: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.getStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index))
        }
            break
        case OpCode.NullLiteral:
            ctx[OpcodeContextField.pushCurrentFrameStack](null)
            break
        case OpCode.UndefinedLiteral:
            ctx[OpcodeContextField.pushCurrentFrameStack](undefined)
            break
        case OpCode.RegexpLiteral: {
            const flags = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const source = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            ctx[OpcodeContextField.pushCurrentFrameStack](new REGEXP(source, flags))
        }
            break
        case OpCode.Set:
        case OpCode.SetKeepCtx: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()

            ctx[OpcodeContextField.setValue](target, name, value)

            if (command === OpCode.Set) {
                ctx[OpcodeContextField.pushCurrentFrameStack](value)
            } else {
                ctx[OpcodeContextField.pushCurrentFrameStack](target)
            }
        }
            break
        case OpCode.SetStatic: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.setStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index, value))
        }
            break
        case OpCode.SetStaticUnchecked: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.setStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index, value))
        }
            break
        case OpCode.SetInitialized: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const env = ctx[OpcodeContextField.popCurrentFrameStack]<Frame>()
            const scope = ctx[OpcodeContextField.findScope](env, name)!
            ctx[OpcodeContextField.initializeBindingValue](scope, name, value)
            ctx[OpcodeContextField.pushCurrentFrameStack](value)
        }
            break
        case OpCode.SetInitializedStatic: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const scope = ctx[OpcodeContextField.getStaticVariableScope](ctx[OpcodeContextField.currentFrame], depth)
            const store = ctx[OpcodeContextField.getStaticVariableStoreAt](scope)
            store.values[index] = value
            scope[store.names[index]] = value
            ctx[OpcodeContextField.pushCurrentFrameStack](value)
        }
            break
        case OpCode.BPlusEqual:
        case OpCode.BMinusEqual:
        case OpCode.BSlashEqual:
        case OpCode.BAsteriskEqual:
        case OpCode.BGreaterThanGreaterThanGreaterThanEqual: {
            const rightVal = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()
            const leftValue = ctx[OpcodeContextField.getValue](target, name)
            const exprs: Record<typeof command, (a: any, b: any) => any> = {
                [OpCode.BPlusEqual]: (a, b) => a + b,
                [OpCode.BMinusEqual]: (a, b) => a - b,
                [OpCode.BSlashEqual]: (a, b) => a / b,
                [OpCode.BAsteriskEqual]: (a, b) => a * b,
                [OpCode.BGreaterThanGreaterThanGreaterThanEqual]: (a, b) => a >>> b,
            }
            const result = exprs[command](leftValue, rightVal)
            ctx[OpcodeContextField.setValue](target, name, result)
            ctx[OpcodeContextField.pushCurrentFrameStack](result)
        }
            break
        case OpCode.BPlusEqualStatic:
        case OpCode.BMinusEqualStatic:
        case OpCode.BSlashEqualStatic:
        case OpCode.BAsteriskEqualStatic:
        case OpCode.BGreaterThanGreaterThanGreaterThanEqualStatic: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const rightVal = ctx[OpcodeContextField.popCurrentFrameStack]()
            const leftValue = ctx[OpcodeContextField.getStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index)
            const exprs: Record<typeof command, (a: any, b: any) => any> = {
                [OpCode.BPlusEqualStatic]: (a, b) => a + b,
                [OpCode.BMinusEqualStatic]: (a, b) => a - b,
                [OpCode.BSlashEqualStatic]: (a, b) => a / b,
                [OpCode.BAsteriskEqualStatic]: (a, b) => a * b,
                [OpCode.BGreaterThanGreaterThanGreaterThanEqualStatic]: (a, b) => a >>> b,
            }
            const result = exprs[command](leftValue, rightVal)
            ctx[OpcodeContextField.setStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index, result)
            ctx[OpcodeContextField.pushCurrentFrameStack](result)
        }
            break
        case OpCode.BPlusEqualStaticUnchecked:
        case OpCode.BMinusEqualStaticUnchecked:
        case OpCode.BSlashEqualStaticUnchecked:
        case OpCode.BAsteriskEqualStaticUnchecked:
        case OpCode.BGreaterThanGreaterThanGreaterThanEqualStaticUnchecked: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const rightVal = ctx[OpcodeContextField.popCurrentFrameStack]()
            const leftValue = ctx[OpcodeContextField.getStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index)
            const exprs: Record<typeof command, (a: any, b: any) => any> = {
                [OpCode.BPlusEqualStaticUnchecked]: (a, b) => a + b,
                [OpCode.BMinusEqualStaticUnchecked]: (a, b) => a - b,
                [OpCode.BSlashEqualStaticUnchecked]: (a, b) => a / b,
                [OpCode.BAsteriskEqualStaticUnchecked]: (a, b) => a * b,
                [OpCode.BGreaterThanGreaterThanGreaterThanEqualStaticUnchecked]: (a, b) => a >>> b,
            }
            const result = exprs[command](leftValue, rightVal)
            ctx[OpcodeContextField.setStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index, result)
            ctx[OpcodeContextField.pushCurrentFrameStack](result)
        }
            break
        case OpCode.DefineKeepCtx: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Record<string, any>>()

            Reflect.defineProperty(target, name, {
                configurable: true,
                enumerable: true,
                writable: true,
                value,
            })

            target[name] = value
            ctx[OpcodeContextField.pushCurrentFrameStack](target)
        }
            break
        case OpCode.Get: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()
            ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.getValue](target, name))
        }
            break
        case OpCode.SetMultiple: {
            const env = ctx[OpcodeContextField.popCurrentFrameStack]<Frame>()
            const length = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            for (let i = 0; i < length; i++) {
                const flag = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
                const value = ctx[OpcodeContextField.popCurrentFrameStack]()
                const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
                let hit = false

                const scope = ctx[OpcodeContextField.findScope](env, name)
                if (scope) {
                    hit = true
                    if (flag & SetFlag.DeTDZ) {
                        ctx[OpcodeContextField.clearBindingTDZ](scope, name)
                    }
                    if (!(flag & SetFlag.DeTDZ) && ctx[OpcodeContextField.readBindingValue](scope, name) === TDZ_VALUE) {
                        throw new ReferenceError(`Cannot access '${name}' before initialization`)
                    }
                    if ((ctx[OpcodeContextField.getVariableFlag](scope, name) ?? VariableFlags.None) & VariableFlags.Immutable) {
                        throw new TypeError(name + is_a_constant)
                    }
                    ctx[OpcodeContextField.writeBindingValue](scope, name, value)
                    if (flag & SetFlag.Freeze) {
                        ctx[OpcodeContextField.freezeBinding](scope, name)
                    }
                }

                if (!hit) {
                    throw new ReferenceError(name + is_not_defined)
                }
            }
        }
            break
        case OpCode.Jump: {
            const pos = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            ctx[OpcodeContextField.ptr] = pos
        }
            break
        case OpCode.JumpIfNot: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const pos = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            if (!value) {
                ctx[OpcodeContextField.ptr] = pos
            }
        }
            break
        case OpCode.JumpIf: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const pos = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            if (value) {
                ctx[OpcodeContextField.ptr] = pos
            }
        }
            break
        case OpCode.JumpIfAndKeep: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const pos = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            ctx[OpcodeContextField.pushCurrentFrameStack](value)
            if (value) {
                ctx[OpcodeContextField.ptr] = pos
            }
        }
            break
        case OpCode.JumpIfNotAndKeep: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const pos = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            ctx[OpcodeContextField.pushCurrentFrameStack](value)
            if (!value) {
                ctx[OpcodeContextField.ptr] = pos
            }
        }
            break
        case OpCode.EnterScope: {
            const variableCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const variables: VariableRecord[] = []
            for (let i = 0; i < variableCount; i++) {
                variables.push({
                    [Fields.type]: ctx[OpcodeContextField.popCurrentFrameStack](),
                    [Fields.name]: ctx[OpcodeContextField.popCurrentFrameStack](),
                })
            }

            const scope: Scope = getEmptyObject()
            ctx[OpcodeContextField.currentFrame][Fields.scopes].push(scope)
            ctx[OpcodeContextField.setScopeDebugPtr](ctx[OpcodeContextField.commandPtr], scope)

            for (const variable of variables) {
                ctx[OpcodeContextField.defineVariable](scope, variable[Fields.name], variable[Fields.type])
            }
        }
            break
        case OpCode.LeaveScope:
            ctx[OpcodeContextField.currentFrame][Fields.scopes].pop()
            break
        case OpCode.DeTDZ: {
            const env = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.valueStack], 2) as Frame
            const name = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.valueStack]) as string
            const scope = ctx[OpcodeContextField.findScope](env, name)
            if (scope) {
                ctx[OpcodeContextField.clearBindingTDZ](scope, name)
            }
        }
            break
        case OpCode.DeTDZStatic: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const scope = ctx[OpcodeContextField.getStaticVariableScope](ctx[OpcodeContextField.currentFrame], depth)
            const store = ctx[OpcodeContextField.getStaticVariableStoreAt](scope)
            if (store.values[index] === TDZ_VALUE) {
                store.values[index] = undefined
                scope[store.names[index]] = undefined
            }
        }
            break
        case OpCode.FreezeVariable: {
            const env = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.valueStack], 2) as Frame
            const name = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.valueStack]) as string
            const scope = ctx[OpcodeContextField.findScope](env, name)
            if (scope) {
                ctx[OpcodeContextField.freezeBinding](scope, name)
            }
        }
            break
        case OpCode.FreezeVariableStatic: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const scope = ctx[OpcodeContextField.getStaticVariableScope](ctx[OpcodeContextField.currentFrame], depth)
            const store = ctx[OpcodeContextField.getStaticVariableStoreAt](scope)
            store.flags[index] |= VariableFlags.Immutable
            ctx[OpcodeContextField.setVariableFlag](scope, store.names[index], store.flags[index])
        }
            break
    }
}
