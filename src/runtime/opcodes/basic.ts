import { OpCode, SetFlag, SpecialVariable } from "../../compiler"
import { STATIC_SLOT_NAMELESS } from "../../compiler/shared"
import {
    Context,
    Fields,
    Frame,
    IDENTIFIER_REFERENCE_SCOPE,
    REGEXP,
    Scope,
    SUPER_REFERENCE_BASE,
    SUPER_REFERENCE_THIS,
    TDZ_VALUE,
    TEXT_DADA_MASK,
    VariableFlags,
    VariableRecord,
    getEmptyObject,
    getLiteralFromPool,
    environments,
    isSmallNumber,
    is_a_constant,
    is_not_defined,
    markVmOwned,
    toPropertyKey,
} from "../shared"
import { OpcodeContextField, type RuntimeOpcodeContext } from "./types"

export const handleBasicOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): void => {
    const writeStaticAliasIfNeeded = (scope: Scope, name: string, flags: VariableFlags, value: unknown) => {
        const isGlobalLexical = scope === ctx[OpcodeContextField.currentFrame][Fields.globalThis]
            && (flags & VariableFlags.Lexical) !== 0
        if (
            name !== STATIC_SLOT_NAMELESS
            && !isGlobalLexical
            && (
                scope === ctx[OpcodeContextField.currentFrame][Fields.globalThis]
                || Object.prototype.hasOwnProperty.call(scope, name)
            )
        ) {
            scope[name] = value
        }
    }
    const getResolvedBindingScope = (value: unknown): Scope | null => {
        if (value == null || typeof value !== 'object' || !(IDENTIFIER_REFERENCE_SCOPE in value)) {
            return null
        }
        return (value as { [IDENTIFIER_REFERENCE_SCOPE]: Scope | null })[IDENTIFIER_REFERENCE_SCOPE]
    }
    const toReferencePropertyKey = (target: unknown, name: unknown) => {
        if (!environments.has(target) && target == null) {
            throw new TypeError('Cannot convert undefined or null to object')
        }
        return toPropertyKey(name)
    }

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
        case OpCode.DuplicateSecond: {
            const top = ctx[OpcodeContextField.popCurrentFrameStack]()
            const second = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.valueStack])
            ctx[OpcodeContextField.pushCurrentFrameStack](top)
            ctx[OpcodeContextField.pushCurrentFrameStack](second)
        }
            break
        case OpCode.Swap: {
            const top = ctx[OpcodeContextField.popCurrentFrameStack]()
            const second = ctx[OpcodeContextField.popCurrentFrameStack]()
            ctx[OpcodeContextField.pushCurrentFrameStack](top)
            ctx[OpcodeContextField.pushCurrentFrameStack](second)
        }
            break
        case OpCode.MakeSuperReference: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]()
            const actualThis = ctx[OpcodeContextField.popCurrentFrameStack]()
            const homeObject = ctx[OpcodeContextField.getValue](
                ctx[OpcodeContextField.currentFrame],
                SpecialVariable.SuperHomeObject
            )
            const base = Reflect.getPrototypeOf(homeObject)

            ctx[OpcodeContextField.pushCurrentFrameStack](markVmOwned({
                [SUPER_REFERENCE_BASE]: base,
                [SUPER_REFERENCE_THIS]: actualThis,
            }))
            ctx[OpcodeContextField.pushCurrentFrameStack](name)
        }
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
        case OpCode.GetStaticKeepCtx: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const value = ctx[OpcodeContextField.getStaticVariableValueChecked](ctx[OpcodeContextField.currentFrame], depth, index)
            ctx[OpcodeContextField.pushCurrentFrameStack](depth)
            ctx[OpcodeContextField.pushCurrentFrameStack](index)
            ctx[OpcodeContextField.pushCurrentFrameStack](value)
        }
            break
        case OpCode.GetStaticUnchecked: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.getStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index))
        }
            break
        case OpCode.GetStaticUncheckedKeepCtx: {
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const value = ctx[OpcodeContextField.getStaticVariableValue](ctx[OpcodeContextField.currentFrame], depth, index)
            ctx[OpcodeContextField.pushCurrentFrameStack](depth)
            ctx[OpcodeContextField.pushCurrentFrameStack](index)
            ctx[OpcodeContextField.pushCurrentFrameStack](value)
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
            const RegExpCtor = (Reflect.get(
                ctx[OpcodeContextField.currentFrame][Fields.globalThis],
                'RegExp'
            ) ?? REGEXP) as typeof RegExp
            ctx[OpcodeContextField.pushCurrentFrameStack](new RegExpCtor(source, flags))
        }
            break
        case OpCode.Set:
        case OpCode.SetKeepCtx: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<PropertyKey>()
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
            const env = ctx[OpcodeContextField.popCurrentFrameStack]<Frame | object>()
            const scope = getResolvedBindingScope(env)
                ?? ctx[OpcodeContextField.findScope](env as Frame, name)!
            if (
                name === SpecialVariable.This
                && ctx[OpcodeContextField.readBindingValue](scope, name) !== TDZ_VALUE
            ) {
                throw new ReferenceError('this has already been initialized')
            }
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
            store[Fields.values][index] = value
            writeStaticAliasIfNeeded(scope, store[Fields.names][index], store[Fields.flags][index] ?? VariableFlags.None, value)
            ctx[OpcodeContextField.pushCurrentFrameStack](value)
        }
            break
        case OpCode.BPlusEqual:
        case OpCode.BMinusEqual:
        case OpCode.BSlashEqual:
        case OpCode.BAsteriskEqual:
        case OpCode.BGreaterThanGreaterThanGreaterThanEqual: {
            const rightVal = ctx[OpcodeContextField.popCurrentFrameStack]()
            const leftValue = ctx[OpcodeContextField.popCurrentFrameStack]()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<PropertyKey>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()
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
            const rightVal = ctx[OpcodeContextField.popCurrentFrameStack]()
            const leftValue = ctx[OpcodeContextField.popCurrentFrameStack]()
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
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
            const rightVal = ctx[OpcodeContextField.popCurrentFrameStack]()
            const leftValue = ctx[OpcodeContextField.popCurrentFrameStack]()
            const index = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const depth = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
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
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<PropertyKey>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Record<PropertyKey, any>>()

            Reflect.defineProperty(target, name, {
                configurable: true,
                enumerable: true,
                writable: true,
                value,
            })

            ctx[OpcodeContextField.pushCurrentFrameStack](target)
        }
            break
        case OpCode.SetPrototypeKeepCtx: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<object>()

            if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
                Reflect.setPrototypeOf(target, value)
            } else if (value === null) {
                Reflect.setPrototypeOf(target, null)
            }

            ctx[OpcodeContextField.pushCurrentFrameStack](target)
        }
            break
        case OpCode.Get: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<PropertyKey>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()
            ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.getValue](target, name))
        }
            break
        case OpCode.GetKeepCtx: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()
            const propertyKey = toReferencePropertyKey(target, name)
            const value = ctx[OpcodeContextField.getValue](target, propertyKey)
            ctx[OpcodeContextField.pushCurrentFrameStack](target)
            ctx[OpcodeContextField.pushCurrentFrameStack](propertyKey)
            ctx[OpcodeContextField.pushCurrentFrameStack](value)
        }
            break
        case OpCode.ResolveScope: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const target = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()

            if (environments.has(target)) {
                const env = target as Frame
                const scope = ctx[OpcodeContextField.findScope](env, name)
                ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.createIdentifierReference](env, scope))
                ctx[OpcodeContextField.pushCurrentFrameStack](name)
                break
            }

            ctx[OpcodeContextField.pushCurrentFrameStack](target)
            ctx[OpcodeContextField.pushCurrentFrameStack](name)
        }
            break
        case OpCode.ResolveScopeGetValue: {
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const sourceTarget = ctx[OpcodeContextField.popCurrentFrameStack]<Context>()

            let target = sourceTarget
            if (environments.has(sourceTarget)) {
                const env = sourceTarget as Frame
                const scope = ctx[OpcodeContextField.findScope](env, name)
                target = ctx[OpcodeContextField.createIdentifierReference](env, scope)
            }

            const leftValue = ctx[OpcodeContextField.getValue](target, name)
            ctx[OpcodeContextField.pushCurrentFrameStack](target)
            ctx[OpcodeContextField.pushCurrentFrameStack](name)
            ctx[OpcodeContextField.pushCurrentFrameStack](leftValue)
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
        case OpCode.EnterScope:
        case OpCode.EnterBodyScope: {
            const variableCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const variables: VariableRecord[] = []
            for (let i = 0; i < variableCount; i++) {
                variables.push({
                    [Fields.type]: ctx[OpcodeContextField.popCurrentFrameStack](),
                    [Fields.name]: ctx[OpcodeContextField.popCurrentFrameStack](),
                })
            }

            const scope: Scope = getEmptyObject()
            if (command === OpCode.EnterBodyScope) {
                ctx[OpcodeContextField.currentFrame][Fields.variableEnvironment] = scope
            }
            ctx[OpcodeContextField.currentFrame][Fields.scopes].push(scope)
            ctx[OpcodeContextField.setScopeDebugPtr](ctx[OpcodeContextField.commandPtr], scope)

            for (const variable of variables) {
                ctx[OpcodeContextField.defineVariable](scope, variable[Fields.name], variable[Fields.type])
            }
        }
            break
        case OpCode.EnterWith: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const scope = ctx[OpcodeContextField.createWithScope](value)
            ctx[OpcodeContextField.currentFrame][Fields.scopes].push(scope)
            ctx[OpcodeContextField.setScopeDebugPtr](ctx[OpcodeContextField.commandPtr], scope)
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
            if (store[Fields.values][index] === TDZ_VALUE) {
                store[Fields.values][index] = undefined
                writeStaticAliasIfNeeded(scope, store[Fields.names][index], store[Fields.flags][index] ?? VariableFlags.None, undefined)
            }
        }
            break
        case OpCode.FreezeVariable: {
            const env = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.valueStack], 2) as Frame | object
            const name = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.valueStack]) as string
            const scope = getResolvedBindingScope(env)
                ?? ctx[OpcodeContextField.findScope](env as Frame, name)
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
            store[Fields.flags][index] |= VariableFlags.Immutable
            const name = store[Fields.names][index]
            if (name !== STATIC_SLOT_NAMELESS) {
                ctx[OpcodeContextField.setVariableFlag](scope, name, store[Fields.flags][index])
            }
        }
            break
    }
}
