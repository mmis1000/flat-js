import { FunctionTypes, InvokeType, OpCode, SpecialVariable, VariableType } from "../../compiler"
import {
    APPLY,
    BIND,
    CALL,
    Fields,
    Frame,
    FrameType,
    FunctionDescriptor,
    GeneratorState,
    HOST_FUNCTION,
    InvokeParam,
    Scope,
    VariableRecord,
    bindInfo,
    environments,
    functionDescriptors,
    generatorStates,
    getEmptyObject,
    isAsyncType,
    isGeneratorType,
} from "../shared"
import { BREAK_COMMAND, OpcodeContextField, type OpcodeHandlerResult, type RuntimeOpcodeContext } from "./types"

const EVAL_FUNCTION = eval

const bindFunctionSelfName = (
    functionType: FunctionTypes,
    scope: Scope,
    name: string,
    fn: any,
    ctx: RuntimeOpcodeContext
) => {
    switch (functionType) {
        case FunctionTypes.FunctionExpression:
        case FunctionTypes.MethodDeclaration:
        case FunctionTypes.GeneratorExpression:
        case FunctionTypes.GeneratorMethod:
        case FunctionTypes.AsyncFunctionExpression:
        case FunctionTypes.AsyncMethod:
            if (name !== '') {
                if (ctx[OpcodeContextField.hasBinding](scope, name)) {
                    ctx[OpcodeContextField.initializeBindingValue](scope, name, fn)
                } else {
                    ctx[OpcodeContextField.writeScopeDebugProperty](scope, name, fn)
                }
            }
    }
}

export const handleFunctionOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): OpcodeHandlerResult => {
    switch (command) {
        case OpCode.EnterFunction: {
            const functionType: FunctionTypes = ctx[OpcodeContextField.popCurrentFrameStack]()
            const variableCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const variables: VariableRecord[] = []
            for (let i = 0; i < variableCount; i++) {
                variables.push({
                    [Fields.type]: ctx[OpcodeContextField.popCurrentFrameStack](),
                    [Fields.name]: ctx[OpcodeContextField.popCurrentFrameStack](),
                })
            }
            const argumentNameCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const argumentNames: string[] = []
            for (let i = 0; i < argumentNameCount; i++) {
                argumentNames.push(ctx[OpcodeContextField.popCurrentFrameStack]())
            }
            const parameterCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const parameters: any[] = []
            for (let i = 0; i < parameterCount; i++) {
                parameters.unshift(ctx[OpcodeContextField.popCurrentFrameStack]())
            }

            const invokeType = ctx[OpcodeContextField.popCurrentFrameStack]<InvokeType>()

            const getArgumentObject = (scope: Record<any, any>, callee: any) => {
                const obj = ctx[OpcodeContextField.createArgumentObject]()
                const bindingLength = Math.min(argumentNameCount, parameterCount)

                for (let i = 0; i < parameterCount; i++) {
                    if (i < bindingLength) {
                        Object.defineProperty(obj, i, {
                            enumerable: true,
                            configurable: true,
                            get() {
                                return ctx[OpcodeContextField.readBindingValue](scope, argumentNames[i])
                            },
                            set(v) {
                                ctx[OpcodeContextField.writeBindingValue](scope, argumentNames[i], v)
                            },
                        })
                    } else {
                        obj[i] = parameters[i]
                    }
                }

                Object.defineProperty(obj, 'length', {
                    enumerable: false,
                    configurable: true,
                    value: parameterCount,
                })
                Object.defineProperty(obj, 'callee', {
                    enumerable: false,
                    configurable: true,
                    value: callee,
                })

                return obj
            }

            if (invokeType === InvokeType.Apply) {
                const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
                const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
                const self = ctx[OpcodeContextField.popCurrentFrameStack]()

                let scope: Scope

                if (functionType === FunctionTypes.SourceFileInPlace) {
                    scope = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.scopes]) || ctx[OpcodeContextField.currentFrame][Fields.globalThis]
                } else {
                    scope = getEmptyObject()
                    ctx[OpcodeContextField.currentFrame][Fields.scopes].push(scope)
                }
                ctx[OpcodeContextField.setScopeDebugPtr](ctx[OpcodeContextField.commandPtr], scope)

                switch (functionType) {
                    case FunctionTypes.FunctionDeclaration:
                    case FunctionTypes.FunctionExpression:
                    case FunctionTypes.MethodDeclaration:
                    case FunctionTypes.GeneratorDeclaration:
                    case FunctionTypes.GeneratorExpression:
                    case FunctionTypes.GeneratorMethod:
                    case FunctionTypes.AsyncFunctionDeclaration:
                    case FunctionTypes.AsyncFunctionExpression:
                    case FunctionTypes.AsyncMethod:
                    case FunctionTypes.GetAccessor:
                    case FunctionTypes.SetAccessor:
                    case FunctionTypes.Constructor:
                    case FunctionTypes.DerivedConstructor:
                        ctx[OpcodeContextField.defineVariable](scope, SpecialVariable.This, VariableType.Var, false)
                        ctx[OpcodeContextField.initializeBindingValue](scope, SpecialVariable.This, self)
                        ctx[OpcodeContextField.defineVariable](scope, SpecialVariable.NewTarget, VariableType.Var, false)
                        ctx[OpcodeContextField.initializeBindingValue](scope, SpecialVariable.NewTarget, undefined)
                        ctx[OpcodeContextField.writeScopeDebugProperty](scope, 'arguments', getArgumentObject(scope, fn))
                }

                for (const variable of variables) {
                    ctx[OpcodeContextField.defineVariable](scope, variable[Fields.name], variable[Fields.type])
                }

                bindFunctionSelfName(functionType, scope, name, fn, ctx)

                for (const [index, name] of argumentNames.entries()) {
                    ctx[OpcodeContextField.initializeBindingValue](scope, name, parameters[index])
                }
            } else if (invokeType === InvokeType.Construct) {
                const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
                const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
                const newTarget = ctx[OpcodeContextField.popCurrentFrameStack]<{ new(...args: any[]): any }>()

                const scope: Scope = getEmptyObject()
                ctx[OpcodeContextField.currentFrame][Fields.scopes].push(scope)
                ctx[OpcodeContextField.setScopeDebugPtr](ctx[OpcodeContextField.commandPtr], scope)

                switch (functionType) {
                    case FunctionTypes.MethodDeclaration:
                    case FunctionTypes.GeneratorMethod:
                    case FunctionTypes.AsyncMethod:
                    case FunctionTypes.GetAccessor:
                    case FunctionTypes.SetAccessor:
                        throw new TypeError('- not a constructor')
                    case FunctionTypes.FunctionDeclaration:
                    case FunctionTypes.FunctionExpression:
                    case FunctionTypes.Constructor:
                        ctx[OpcodeContextField.defineVariable](scope, SpecialVariable.This, VariableType.Var, false)
                        ctx[OpcodeContextField.initializeBindingValue](scope, SpecialVariable.This, Object.create(newTarget.prototype))
                        ctx[OpcodeContextField.defineVariable](scope, SpecialVariable.NewTarget, VariableType.Var, false)
                        ctx[OpcodeContextField.initializeBindingValue](scope, SpecialVariable.NewTarget, newTarget)
                        ctx[OpcodeContextField.writeScopeDebugProperty](scope, 'arguments', getArgumentObject(scope, fn))
                        break
                    case FunctionTypes.DerivedConstructor:
                        ctx[OpcodeContextField.defineVariable](scope, SpecialVariable.This, VariableType.Let, false)
                        ctx[OpcodeContextField.defineVariable](scope, SpecialVariable.NewTarget, VariableType.Var, false)
                        ctx[OpcodeContextField.initializeBindingValue](scope, SpecialVariable.NewTarget, newTarget)
                        ctx[OpcodeContextField.writeScopeDebugProperty](scope, 'arguments', getArgumentObject(scope, fn))
                        break
                }

                for (const variable of variables) {
                    ctx[OpcodeContextField.defineVariable](scope, variable[Fields.name], variable[Fields.type])
                }

                bindFunctionSelfName(functionType, scope, name, fn, ctx)

                for (const [index, name] of argumentNames.entries()) {
                    ctx[OpcodeContextField.initializeBindingValue](scope, name, parameters[index])
                }
            }
        }
            break
        case OpCode.DefineFunction: {
            const type = ctx[OpcodeContextField.popCurrentFrameStack]<FunctionTypes>()
            const offset = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.defineFunction](ctx[OpcodeContextField.currentFrame][Fields.globalThis], ctx[OpcodeContextField.currentFrame][Fields.scopes], name, type, offset))
        }
            break
        case OpCode.CallValue:
        case OpCode.Call:
        case OpCode.CallAsEval: {
            const parameterCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            let parameters: any[] = []
            for (let i = 0; i < parameterCount; i++) {
                parameters.unshift(ctx[OpcodeContextField.popCurrentFrameStack]())
            }

            let fn
            let envOrRecord
            let name = ''

            if (command === OpCode.Call || command === OpCode.CallAsEval) {
                name = ctx[OpcodeContextField.popCurrentFrameStack]()
                envOrRecord = ctx[OpcodeContextField.popCurrentFrameStack]()
                fn = ctx[OpcodeContextField.getValue](envOrRecord, name)
            } else {
                envOrRecord = undefined
                fn = ctx[OpcodeContextField.popCurrentFrameStack]()
            }

            while (fn === CALL || fn === APPLY || bindInfo.has(fn)) {
                let newFn
                let newSelf
                let newParameters
                if (fn === CALL) {
                    newFn = envOrRecord
                    newSelf = parameters[0]
                    newParameters = parameters.slice(1)
                } else if (fn === APPLY) {
                    newFn = envOrRecord
                    newSelf = parameters[0]
                    const parameterArrayLike = parameters != null ? parameters[1] : []
                    const parameterLength = parameterArrayLike.length
                    newParameters = []
                    for (let i = 0; i < parameterLength; i++) {
                        newParameters.push(parameterArrayLike[i])
                    }
                } else {
                    const info = bindInfo.get(fn)! as {
                        [Fields.function]: any
                        [Fields.self]: any
                        [Fields.arguments]: any[]
                    }
                    newSelf = info[Fields.self]
                    newParameters = [...info[Fields.arguments], ...parameters]
                    newFn = info[Fields.function]
                }

                fn = environments.has(newFn) ? undefined : newFn
                envOrRecord = newSelf
                parameters = newParameters
            }

            let self = undefined
            if (!environments.has(envOrRecord)) {
                self = envOrRecord
            }

            const fnTarget = ctx[OpcodeContextField.functionRedirects].has(fn) ? ctx[OpcodeContextField.functionRedirects].get(fn) : fn
            const vmGlobal = ctx[OpcodeContextField.currentFrame][Fields.globalThis]

            if (fn === BIND) {
                const bound = ctx[OpcodeContextField.bindInternal](self, parameters[0], parameters.slice(1))
                ctx[OpcodeContextField.pushCurrentFrameStack](bound)
            } else if (
                !functionDescriptors.has(fnTarget) ||
                isAsyncType(functionDescriptors.get(fnTarget)![Fields.type])
            ) {
                if (typeof fnTarget !== 'function') {
                    if (command === OpCode.Call || command === OpCode.CallAsEval) {
                        throw new TypeError(`(intermediate value).${name} is not a function`)
                    }
                    throw new TypeError(`(intermediate value) is not a function`)
                }

                if (fnTarget === EVAL_FUNCTION) {
                    if (command === OpCode.CallAsEval) {
                        ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.emulateEval](String(parameters[0]), true))
                    } else {
                        ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.emulateEval](String(parameters[0]), false))
                    }
                } else if (
                    fnTarget === Reflect.get(vmGlobal, 'Function') || fnTarget === HOST_FUNCTION
                ) {
                    ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.emulateFunctionConstructor](parameters))
                } else {
                    const state: GeneratorState | undefined = generatorStates.get(fnTarget)
                    if (state) {
                        const value = parameters[0]

                        if (state.completed) {
                            if (fnTarget === state.gen.throw) {
                                throw value
                            }
                            ctx[OpcodeContextField.pushCurrentFrameStack]({ value: undefined, done: true })
                            return BREAK_COMMAND
                        }

                        if (!state.started) {
                            if (fnTarget === state.gen.throw) {
                                state.completed = true
                                state.stack = []
                                throw value
                            }
                            if (fnTarget === state.gen.return) {
                                state.completed = true
                                state.stack = []
                                ctx[OpcodeContextField.pushCurrentFrameStack]({ value, done: true })
                                return BREAK_COMMAND
                            }
                        }

                        if (fnTarget === state.gen.throw) {
                            state.pendingAction = { type: 'throw', value }
                        } else if (fnTarget === state.gen.return) {
                            state.pendingAction = { type: 'return', value }
                        } else {
                            state.pendingAction = null
                        }

                        const wasStarted = state.started
                        state.started = true

                        ;(state.stack[0] as any)[Fields.return] = ctx[OpcodeContextField.ptr]
                        ctx[OpcodeContextField.stack].push(...state.stack)
                        state.stack = []

                        if (wasStarted) {
                            ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])[Fields.valueStack].push(value)
                        }

                        ctx[OpcodeContextField.ptr] = state.ptr
                        ctx[OpcodeContextField.currentProgram] = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])[Fields.programSection]
                        return { [Fields.done]: false }
                    }

                    ctx[OpcodeContextField.pushCurrentFrameStack](Reflect.apply(fnTarget, self, parameters))
                }
            } else if (isGeneratorType(functionDescriptors.get(fnTarget)![Fields.type])) {
                const descriptor = functionDescriptors.get(fnTarget)!
                const iterator = ctx[OpcodeContextField.createGeneratorFromExecution](
                    descriptor[Fields.programSection],
                    descriptor[Fields.offset],
                    descriptor[Fields.globalThis],
                    [...descriptor[Fields.scopes]],
                    {
                        [Fields.type]: InvokeType.Apply,
                        [Fields.function]: fnTarget,
                        [Fields.name]: descriptor[Fields.name],
                        [Fields.self]: self,
                    },
                    parameters
                )
                ctx[OpcodeContextField.pushCurrentFrameStack](iterator)
            } else {
                const descriptor = functionDescriptors.get(fnTarget)!
                const newFrame: Frame = {
                    [Fields.type]: FrameType.Function,
                    [Fields.scopes]: [...descriptor[Fields.scopes]],
                    [Fields.return]: ctx[OpcodeContextField.ptr],
                    [Fields.valueStack]: [
                        self,
                        fnTarget,
                        descriptor[Fields.name],
                        InvokeType.Apply,
                        ...parameters,
                        parameters.length,
                    ],
                    [Fields.invokeType]: InvokeType.Apply,
                    [Fields.programSection]: descriptor[Fields.programSection],
                    [Fields.globalThis]: descriptor[Fields.globalThis],
                    [Fields.generator]: ctx[OpcodeContextField.currentFrame][Fields.generator],
                }

                environments.add(newFrame)
                ctx[OpcodeContextField.stack].push(newFrame)
                ctx[OpcodeContextField.ptr] = descriptor[Fields.offset]
                ctx[OpcodeContextField.currentProgram] = descriptor[Fields.programSection]
            }
        }
            break
        case OpCode.SuperCall: {
            const parameterCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const parameters: any[] = []
            for (let i = 0; i < parameterCount; i++) {
                parameters.unshift(ctx[OpcodeContextField.popCurrentFrameStack]())
            }

            const fn = ctx[OpcodeContextField.popCurrentFrameStack]<(...args: any[]) => any>()
            const newTarget = ctx[OpcodeContextField.popCurrentFrameStack]<any>()

            if (!functionDescriptors.has(fn)) {
                const instance = Reflect.construct(fn, parameters, newTarget)
                ctx[OpcodeContextField.pushCurrentFrameStack](instance)
            } else {
                const descriptor = functionDescriptors.get(fn)!
                const newFrame: Frame = {
                    [Fields.type]: FrameType.Function,
                    [Fields.scopes]: [...descriptor[Fields.scopes]],
                    [Fields.return]: ctx[OpcodeContextField.ptr],
                    [Fields.valueStack]: [
                        newTarget,
                        fn,
                        descriptor[Fields.name],
                        InvokeType.Construct,
                        ...parameters,
                        parameters.length,
                    ],
                    [Fields.invokeType]: InvokeType.Construct,
                    [Fields.programSection]: descriptor[Fields.programSection],
                    [Fields.globalThis]: descriptor[Fields.globalThis],
                    [Fields.generator]: ctx[OpcodeContextField.currentFrame][Fields.generator],
                }

                environments.add(newFrame)
                ctx[OpcodeContextField.stack].push(newFrame)
                ctx[OpcodeContextField.ptr] = descriptor[Fields.offset]
                ctx[OpcodeContextField.currentProgram] = descriptor[Fields.programSection]
            }
        }
            break
        case OpCode.New: {
            const parameterCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const parameters: any[] = []
            for (let i = 0; i < parameterCount; i++) {
                parameters.unshift(ctx[OpcodeContextField.popCurrentFrameStack]())
            }

            let fn = ctx[OpcodeContextField.popCurrentFrameStack]<(...args: any[]) => any>()

            while (bindInfo.has(fn)) {
                const info = bindInfo.get(fn)! as {
                    [Fields.function]: any
                    [Fields.arguments]: any[]
                }
                parameters.unshift(...info[Fields.arguments])
                const nextFn = info[Fields.function]
                fn = environments.has(nextFn) ? undefined : nextFn
            }

            if (!functionDescriptors.has(fn)) {
                const vmGlobal = ctx[OpcodeContextField.currentFrame][Fields.globalThis]
                if (typeof fn === 'function' && (fn === Reflect.get(vmGlobal, 'Function') || fn === HOST_FUNCTION)) {
                    ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.emulateFunctionConstructor](parameters))
                } else {
                    ctx[OpcodeContextField.pushCurrentFrameStack](Reflect.construct(fn, parameters, fn))
                }
            } else {
                const descriptor = functionDescriptors.get(fn)!
                const newFrame: Frame = {
                    [Fields.type]: FrameType.Function,
                    [Fields.scopes]: [...descriptor[Fields.scopes]],
                    [Fields.return]: ctx[OpcodeContextField.ptr],
                    [Fields.valueStack]: [
                        fn,
                        fn,
                        descriptor[Fields.name],
                        InvokeType.Construct,
                        ...parameters,
                        parameters.length,
                    ],
                    [Fields.invokeType]: InvokeType.Construct,
                    [Fields.programSection]: descriptor[Fields.programSection],
                    [Fields.globalThis]: descriptor[Fields.globalThis],
                    [Fields.generator]: ctx[OpcodeContextField.currentFrame][Fields.generator],
                }

                environments.add(newFrame)
                ctx[OpcodeContextField.stack].push(newFrame)
                ctx[OpcodeContextField.ptr] = descriptor[Fields.offset]
                ctx[OpcodeContextField.currentProgram] = descriptor[Fields.programSection]
            }
        }
            break
    }
}
