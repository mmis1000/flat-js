import { FunctionTypes, InvokeType, OpCode, SpecialVariable, VariableType } from "../../compiler"
import {
    APPLY,
    BIND,
    CALL,
    Fields,
    Frame,
    FrameType,
    GeneratorState,
    HOST_FUNCTION,
    IDENTIFIER_REFERENCE_FRAME,
    IDENTIFIER_REFERENCE_SCOPE,
    Scope,
    SCOPE_WITH_OBJECT,
    VariableRecord,
    bindInfo,
    environments,
    functionDescriptors,
    generatorStates,
    getEmptyObject,
    isAsyncGeneratorType,
    isAsyncType,
    isGeneratorType
} from "../shared"
import { BREAK_COMMAND, OpcodeContextField, type OpcodeHandlerResult, type RuntimeOpcodeContext } from "./types"

const EVAL_FUNCTION = eval

const isVmConstructible = (fn: any) => {
    const descriptor = functionDescriptors.get(fn)
    if (!descriptor) {
        return true
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
        case FunctionTypes.AsyncGeneratorExpression:
        case FunctionTypes.AsyncGeneratorMethod:
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
            const strict = !!ctx[OpcodeContextField.popCurrentFrameStack]()
            const functionType: FunctionTypes = ctx[OpcodeContextField.popCurrentFrameStack]()
            const variableCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const variables: VariableRecord[] = []
            for (let i = 0; i < variableCount; i++) {
                variables.push({
                    [Fields.type]: ctx[OpcodeContextField.popCurrentFrameStack](),
                    [Fields.name]: ctx[OpcodeContextField.popCurrentFrameStack](),
                })
            }
            const restParameterIndex = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const hasParameterExpressions = !!ctx[OpcodeContextField.popCurrentFrameStack]()
            const simpleParameterList = !!ctx[OpcodeContextField.popCurrentFrameStack]()
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
            const hasRestParameter = restParameterIndex >= 0
            ctx[OpcodeContextField.currentFrame][Fields.strict] = strict

            const getArgumentObject = (scope: Record<any, any>, callee: any) => {
                const obj = ctx[OpcodeContextField.createArgumentObject]()
                const bindingLength = Math.min(argumentNameCount, parameterCount)
                const mapsArguments = simpleParameterList

                for (let i = 0; i < parameterCount; i++) {
                    if (mapsArguments && i < bindingLength) {
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

            const initializeVariableBindings = (
                activationScope: Scope,
                bindingScope: Scope,
                name: string,
                fn: any,
                thisValue: any,
                newTargetValue: any
            ) => {
                switch (functionType) {
                    case FunctionTypes.FunctionDeclaration:
                    case FunctionTypes.FunctionExpression:
                    case FunctionTypes.MethodDeclaration:
                    case FunctionTypes.GeneratorDeclaration:
                    case FunctionTypes.GeneratorExpression:
                    case FunctionTypes.GeneratorMethod:
                    case FunctionTypes.AsyncGeneratorDeclaration:
                    case FunctionTypes.AsyncGeneratorExpression:
                    case FunctionTypes.AsyncGeneratorMethod:
                    case FunctionTypes.AsyncFunctionDeclaration:
                    case FunctionTypes.AsyncFunctionExpression:
                    case FunctionTypes.AsyncMethod:
                    case FunctionTypes.GetAccessor:
                    case FunctionTypes.SetAccessor:
                    case FunctionTypes.Constructor:
                    case FunctionTypes.DerivedConstructor:
                        ctx[OpcodeContextField.defineVariable](
                            activationScope,
                            SpecialVariable.This,
                            functionType === FunctionTypes.DerivedConstructor ? VariableType.Let : VariableType.Var,
                            false
                        )
                        if (functionType !== FunctionTypes.DerivedConstructor || thisValue !== undefined) {
                            ctx[OpcodeContextField.initializeBindingValue](activationScope, SpecialVariable.This, thisValue)
                        }
                        ctx[OpcodeContextField.defineVariable](activationScope, SpecialVariable.NewTarget, VariableType.Var, false)
                        ctx[OpcodeContextField.initializeBindingValue](activationScope, SpecialVariable.NewTarget, newTargetValue)
                        ctx[OpcodeContextField.writeScopeDebugProperty](activationScope, 'arguments', getArgumentObject(bindingScope, fn))
                }

                for (const variable of variables) {
                    ctx[OpcodeContextField.defineVariable](bindingScope, variable[Fields.name], variable[Fields.type])
                }

                bindFunctionSelfName(functionType, bindingScope, name, fn, ctx)

                const restValues = hasRestParameter ? parameters.slice(restParameterIndex) : null
                for (const [index, parameterName] of argumentNames.entries()) {
                    ctx[OpcodeContextField.initializeBindingValue](
                        bindingScope,
                        parameterName,
                        hasRestParameter && index === restParameterIndex
                            ? restValues
                            : parameters[index]
                    )
                }
            }

            if (invokeType === InvokeType.Apply) {
                const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
                const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
                const self = ctx[OpcodeContextField.popCurrentFrameStack]()

                let activationScope: Scope
                let bindingScope: Scope

                if (functionType === FunctionTypes.SourceFileInPlace) {
                    activationScope = ctx[OpcodeContextField.currentFrame][Fields.variableEnvironment]
                        ?? ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.scopes])
                        ?? ctx[OpcodeContextField.currentFrame][Fields.globalThis]
                    bindingScope = activationScope
                    ctx[OpcodeContextField.currentFrame][Fields.variableEnvironment] = activationScope
                } else {
                    if (hasParameterExpressions) {
                        activationScope = getEmptyObject()
                        bindingScope = getEmptyObject()
                        ctx[OpcodeContextField.currentFrame][Fields.scopes].push(activationScope)
                        ctx[OpcodeContextField.currentFrame][Fields.scopes].push(bindingScope)
                        ctx[OpcodeContextField.currentFrame][Fields.variableEnvironment] = activationScope
                    } else {
                        activationScope = getEmptyObject()
                        bindingScope = activationScope
                        ctx[OpcodeContextField.currentFrame][Fields.scopes].push(activationScope)
                        ctx[OpcodeContextField.currentFrame][Fields.variableEnvironment] = activationScope
                    }
                }
                ctx[OpcodeContextField.setScopeDebugPtr](ctx[OpcodeContextField.commandPtr], bindingScope)
                initializeVariableBindings(activationScope, bindingScope, name, fn, self, undefined)
            } else if (invokeType === InvokeType.Construct) {
                const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
                const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
                const newTarget = ctx[OpcodeContextField.popCurrentFrameStack]<{ new(...args: any[]): any }>()

                let activationScope: Scope
                let bindingScope: Scope
                if (hasParameterExpressions) {
                    activationScope = getEmptyObject()
                    bindingScope = getEmptyObject()
                    ctx[OpcodeContextField.currentFrame][Fields.scopes].push(activationScope)
                    ctx[OpcodeContextField.currentFrame][Fields.scopes].push(bindingScope)
                    ctx[OpcodeContextField.currentFrame][Fields.variableEnvironment] = activationScope
                } else {
                    activationScope = getEmptyObject()
                    bindingScope = activationScope
                    ctx[OpcodeContextField.currentFrame][Fields.scopes].push(activationScope)
                    ctx[OpcodeContextField.currentFrame][Fields.variableEnvironment] = activationScope
                }
                ctx[OpcodeContextField.setScopeDebugPtr](ctx[OpcodeContextField.commandPtr], bindingScope)

                switch (functionType) {
                    case FunctionTypes.MethodDeclaration:
                    case FunctionTypes.GeneratorMethod:
                    case FunctionTypes.AsyncGeneratorMethod:
                    case FunctionTypes.AsyncMethod:
                    case FunctionTypes.GetAccessor:
                    case FunctionTypes.SetAccessor:
                        throw new TypeError('- not a constructor')
                }
                initializeVariableBindings(
                    activationScope,
                    bindingScope,
                    name,
                    fn,
                    functionType === FunctionTypes.DerivedConstructor ? undefined : Object.create(newTarget.prototype),
                    newTarget
                )
            }
        }
            break
        case OpCode.DefineFunction: {
            const type = ctx[OpcodeContextField.popCurrentFrameStack]<FunctionTypes>()
            const bodyOffset = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const offset = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const expectedArgumentCount = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const fn = ctx[OpcodeContextField.defineFunction](
                ctx[OpcodeContextField.currentFrame][Fields.globalThis],
                ctx[OpcodeContextField.currentFrame][Fields.scopes],
                name,
                type,
                offset,
                bodyOffset
            )
            Object.defineProperty(fn, 'length', {
                value: expectedArgumentCount,
                configurable: true,
            })
            ctx[OpcodeContextField.pushCurrentFrameStack](fn)
        }
            break
        case OpCode.ExpandArgumentArray: {
            const argArray = ctx[OpcodeContextField.popCurrentFrameStack]<any[]>()
            if (!Array.isArray(argArray)) {
                throw new TypeError('ExpandArgumentArray expects an array')
            }

            for (let i = 0; i < argArray.length; i++) {
                ctx[OpcodeContextField.pushCurrentFrameStack](argArray[i])
            }
            ctx[OpcodeContextField.pushCurrentFrameStack](argArray.length)
        }
            break
        case OpCode.CallValue:
        case OpCode.Call:
        case OpCode.CallResolved:
        case OpCode.CallAsEval:
        case OpCode.CallAsEvalResolved: {
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
            } else if (command === OpCode.CallResolved || command === OpCode.CallAsEvalResolved) {
                fn = ctx[OpcodeContextField.popCurrentFrameStack]()
                name = ctx[OpcodeContextField.popCurrentFrameStack]()
                envOrRecord = ctx[OpcodeContextField.popCurrentFrameStack]()
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
            const isIdentifierReference = envOrRecord != null
                && typeof envOrRecord === 'object'
                && IDENTIFIER_REFERENCE_FRAME in envOrRecord
                && IDENTIFIER_REFERENCE_SCOPE in envOrRecord
            if (isIdentifierReference) {
                const scope = (envOrRecord as any)[IDENTIFIER_REFERENCE_SCOPE]
                if (scope != null && (scope as any)[SCOPE_WITH_OBJECT] !== undefined) {
                    self = (scope as any)[SCOPE_WITH_OBJECT]
                }
            } else if (!environments.has(envOrRecord)) {
                self = envOrRecord
            }

            const fnTarget = ctx[OpcodeContextField.functionRedirects].has(fn) ? ctx[OpcodeContextField.functionRedirects].get(fn) : fn
            const vmGlobal = ctx[OpcodeContextField.currentFrame][Fields.globalThis]
            const realmEval = Reflect.get(vmGlobal, 'eval')
            const descriptor = functionDescriptors.get(fnTarget)

            if (
                self == null
                && descriptor
                && descriptor[Fields.type] !== FunctionTypes.ArrowFunction
                && descriptor[Fields.type] !== FunctionTypes.AsyncArrowFunction
            ) {
                self = descriptor[Fields.globalThis]
            }

            if (fn === BIND) {
                const bound = ctx[OpcodeContextField.bindInternal](self, parameters[0], parameters.slice(1))
                ctx[OpcodeContextField.pushCurrentFrameStack](bound)
            } else if (
                !descriptor ||
                isAsyncType(descriptor[Fields.type])
            ) {
                if (typeof fnTarget !== 'function') {
                    if (command === OpCode.Call || command === OpCode.CallAsEval) {
                        throw new TypeError(`(intermediate value).${name} is not a function`)
                    }
                    throw new TypeError(`(intermediate value) is not a function`)
                }

                if (fnTarget === EVAL_FUNCTION || fnTarget === realmEval) {
                    if (command === OpCode.CallAsEval || command === OpCode.CallAsEvalResolved) {
                        ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.emulateEval](parameters[0], true))
                    } else {
                        ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.emulateEval](parameters[0], false))
                    }
                } else if (self === Reflect.get(vmGlobal, 'Reflect') && name === 'construct') {
                    const target = parameters[0]
                    const newTarget = parameters[2] === undefined ? target : parameters[2]

                    if (!isVmConstructible(target) || !isVmConstructible(newTarget)) {
                        throw new TypeError('target is not a constructor')
                    }

                    ctx[OpcodeContextField.pushCurrentFrameStack](Reflect.construct(target, parameters[1], newTarget))
                } else if (
                    fnTarget === Reflect.get(vmGlobal, 'Function') || fnTarget === HOST_FUNCTION
                ) {
                    ctx[OpcodeContextField.pushCurrentFrameStack](ctx[OpcodeContextField.emulateFunctionConstructor](parameters))
                } else {
                    const state: GeneratorState | undefined = generatorStates.get(fnTarget)
                    if (state) {
                        const value = parameters[0]

                        if (state[Fields.completed]) {
                            if (fnTarget === state[Fields.gen].throw) {
                                throw value
                            }
                            ctx[OpcodeContextField.pushCurrentFrameStack]({ value: undefined, done: true })
                            return BREAK_COMMAND
                        }

                        if (!state[Fields.started]) {
                            if (fnTarget === state[Fields.gen].throw) {
                                state[Fields.completed] = true
                                state[Fields.stack] = []
                                throw value
                            }
                            if (fnTarget === state[Fields.gen].return) {
                                state[Fields.completed] = true
                                state[Fields.stack] = []
                                ctx[OpcodeContextField.pushCurrentFrameStack]({ value, done: true })
                                return BREAK_COMMAND
                            }
                        }

                        if (fnTarget === state[Fields.gen].throw) {
                            state[Fields.pendingAction] = { [Fields.type]: 'throw', [Fields.value]: value }
                        } else if (fnTarget === state[Fields.gen].return) {
                            state[Fields.pendingAction] = { [Fields.type]: 'return', [Fields.value]: value }
                        } else {
                            state[Fields.pendingAction] = null
                        }

                        const wasStarted = state[Fields.started]
                        state[Fields.started] = true

                        ;(state[Fields.stack][0] as any)[Fields.return] = ctx[OpcodeContextField.ptr]
                        ctx[OpcodeContextField.stack].push(...state[Fields.stack])
                        state[Fields.stack] = []

                        if (wasStarted) {
                            ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])[Fields.valueStack].push(value)
                        }

                        ctx[OpcodeContextField.ptr] = state[Fields.ptr]
                        ctx[OpcodeContextField.currentProgram] = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])[Fields.programSection]
                        return { [Fields.done]: false }
                    }

                    ctx[OpcodeContextField.pushCurrentFrameStack](Reflect.apply(fnTarget, self, parameters))
                }
            } else if (isAsyncGeneratorType(descriptor[Fields.type])) {
                const iterator = ctx[OpcodeContextField.createAsyncGeneratorFromExecution](
                    descriptor[Fields.programSection],
                    descriptor[Fields.offset],
                    descriptor[Fields.bodyOffset],
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
            } else if (isGeneratorType(descriptor[Fields.type])) {
                const iterator = ctx[OpcodeContextField.createGeneratorFromExecution](
                    descriptor[Fields.programSection],
                    descriptor[Fields.offset],
                    descriptor[Fields.bodyOffset],
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
