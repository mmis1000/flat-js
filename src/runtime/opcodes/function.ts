import { FunctionTypes, InvokeType, OpCode, SpecialVariable, VariableType } from "../../compiler"
import {
    APPLY,
    BIND,
    CALL,
    Fields,
    Frame,
    FrameType,
    FunctionFrame,
    GeneratorState,
    HOST_FUNCTION,
    IDENTIFIER_REFERENCE_FRAME,
    IDENTIFIER_REFERENCE_SCOPE,
    Scope,
    SCOPE_REJECT_EVAL_ARGUMENTS_VAR,
    SCOPE_WITH_OBJECT,
    SUPER_REFERENCE_THIS,
    VariableRecord,
    VariableFlags,
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

const isObjectEnvironmentScope = (scope: Scope) =>
    (scope as any)[SCOPE_WITH_OBJECT] !== undefined

const isObjectLike = (value: unknown): value is object =>
    (typeof value === 'object' && value !== null) || typeof value === 'function'

const getActiveFunctionFrame = (ctx: RuntimeOpcodeContext): FunctionFrame | undefined => {
    for (let i = ctx[OpcodeContextField.stack].length - 1; i >= 0; i--) {
        const frame = ctx[OpcodeContextField.stack][i]
        if (frame[Fields.type] === FrameType.Function) {
            return frame as FunctionFrame
        }
    }
    return undefined
}

type ConstructTarget = { new(...args: any[]): any, prototype?: unknown }

const createConstructThis = (newTarget: ConstructTarget, globalThis: any) => {
    const newTargetPrototype = (newTarget as { prototype?: unknown }).prototype
    const prototype = isObjectLike(newTargetPrototype)
        ? newTargetPrototype
        : getDefaultPrototypeFromConstructor(newTarget, globalThis)
    return Object.create(prototype)
}

const getDefaultPrototypeFromConstructor = (newTarget: ConstructTarget, globalThis: any) => {
    const descriptor = functionDescriptors.get(newTarget)
    if (descriptor) {
        return descriptor[Fields.globalThis]?.Object?.prototype ?? Object.prototype
    }

    const objectCtor = globalThis?.Object ?? Object
    try {
        return Reflect.getPrototypeOf(Reflect.construct(objectCtor, [], newTarget))
    } catch {
        return globalThis?.Object?.prototype ?? Object.prototype
    }
}

const isSourceFileInPlace = (functionType: FunctionTypes) =>
    functionType === FunctionTypes.SourceFileInPlace
    || functionType === FunctionTypes.EvalSourceFileInPlace

const isEvalSourceFileInPlace = (functionType: FunctionTypes) =>
    functionType === FunctionTypes.EvalSourceFileInPlace

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
                    ctx[OpcodeContextField.setVariableFlag](
                        scope,
                        name,
                        (ctx[OpcodeContextField.getVariableFlag](scope, name) ?? VariableFlags.None)
                            | VariableFlags.SloppySilentImmutable
                    )
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

            const getThisBindingValue = (thisValue: any) => {
                if (strict || (thisValue == null && functionType === FunctionTypes.DerivedConstructor)) {
                    return thisValue
                }
                if (thisValue == null) {
                    return ctx[OpcodeContextField.currentFrame][Fields.globalThis]
                }
                if (typeof thisValue !== 'object' && typeof thisValue !== 'function') {
                    const objectCtor = ctx[OpcodeContextField.currentFrame][Fields.globalThis]?.Object
                    return typeof objectCtor === 'function' ? objectCtor(thisValue) : Object(thisValue)
                }
                return thisValue
            }

            const createRealmArray = (values: any[]) => {
                const arr = [...values]
                const vmArray = Reflect.get(ctx[OpcodeContextField.currentFrame][Fields.globalThis], 'Array')
                const prototype = vmArray?.prototype
                if (prototype && Object.getPrototypeOf(arr) !== prototype) {
                    Object.setPrototypeOf(arr, prototype)
                }
                return arr
            }

            const getArgumentObject = (scope: Record<any, any>, callee: any) => {
                const obj = ctx[OpcodeContextField.createArgumentObject](
                    ctx[OpcodeContextField.currentFrame][Fields.globalThis]
                )
                const bindingLength = Math.min(argumentNameCount, parameterCount)
                const mapsArguments = simpleParameterList && !strict
                const mappedParameters = new Map<PropertyKey, string>()
                const isAccessorDescriptor = (descriptor: PropertyDescriptor) =>
                    'get' in descriptor || 'set' in descriptor
                const getMappedParameter = (property: PropertyKey) =>
                    typeof property === 'string' ? mappedParameters.get(property) : undefined

                for (let i = 0; i < parameterCount; i++) {
                    Object.defineProperty(obj, i, {
                        enumerable: true,
                        configurable: true,
                        writable: true,
                        value: parameters[i],
                    })
                }

                if (mapsArguments) {
                    const mappedNames = new Set<string>()
                    for (let i = bindingLength - 1; i >= 0; i--) {
                        const parameterName = argumentNames[i]
                        if (!mappedNames.has(parameterName)) {
                            mappedNames.add(parameterName)
                            mappedParameters.set(String(i), parameterName)
                        }
                    }
                }

                Object.defineProperty(obj, 'length', {
                    enumerable: false,
                    configurable: true,
                    writable: true,
                    value: parameterCount,
                })

                if (strict) {
                    const throwTypeError = () => {
                        const TypeErrorCtor = ctx[OpcodeContextField.currentFrame][Fields.globalThis]?.TypeError
                        throw typeof TypeErrorCtor === 'function'
                            ? new TypeErrorCtor('Invalid arguments object callee access')
                            : new TypeError('Invalid arguments object callee access')
                    }
                    Object.defineProperty(obj, 'callee', {
                        enumerable: false,
                        configurable: false,
                        get: throwTypeError,
                        set: throwTypeError,
                    })
                } else {
                    Object.defineProperty(obj, 'callee', {
                        enumerable: false,
                        configurable: true,
                        writable: true,
                        value: callee,
                    })
                }

                if (!mapsArguments) {
                    return obj
                }

                return new Proxy(obj, {
                    get(target, property, receiver) {
                        const mappedName = getMappedParameter(property)
                        if (mappedName !== undefined) {
                            return ctx[OpcodeContextField.readBindingValue](scope, mappedName)
                        }
                        return Reflect.get(target, property, receiver)
                    },
                    set(target, property, value, receiver) {
                        const mappedName = getMappedParameter(property)
                        if (mappedName === undefined) {
                            return Reflect.set(target, property, value, receiver)
                        }

                        const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
                        if (descriptor && 'writable' in descriptor && descriptor.writable === false) {
                            return false
                        }

                        ctx[OpcodeContextField.writeBindingValue](scope, mappedName, value)
                        if (descriptor && 'value' in descriptor) {
                            return Reflect.defineProperty(target, property, { ...descriptor, value })
                        }
                        return Reflect.set(target, property, value, receiver)
                    },
                    getOwnPropertyDescriptor(target, property) {
                        const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
                        const mappedName = getMappedParameter(property)
                        if (descriptor && mappedName !== undefined && 'value' in descriptor) {
                            return {
                                ...descriptor,
                                value: ctx[OpcodeContextField.readBindingValue](scope, mappedName),
                            }
                        }
                        return descriptor
                    },
                    defineProperty(target, property, descriptor) {
                        const mappedName = getMappedParameter(property)
                        const accessorDescriptor = isAccessorDescriptor(descriptor)
                        let nextDescriptor = descriptor

                        if (mappedName !== undefined && !accessorDescriptor) {
                            if ('value' in descriptor) {
                                ctx[OpcodeContextField.writeBindingValue](scope, mappedName, descriptor.value)
                            } else if (descriptor.writable === false) {
                                nextDescriptor = {
                                    ...descriptor,
                                    value: ctx[OpcodeContextField.readBindingValue](scope, mappedName),
                                }
                            }
                        }

                        const success = Reflect.defineProperty(target, property, nextDescriptor)
                        if (success && mappedName !== undefined && (accessorDescriptor || descriptor.writable === false)) {
                            mappedParameters.delete(property)
                        }
                        return success
                    },
                    deleteProperty(target, property) {
                        const success = Reflect.deleteProperty(target, property)
                        if (success) {
                            mappedParameters.delete(property)
                        }
                        return success
                    },
                })
            }

            const initializeVariableBindings = (
                activationScope: Scope,
                bindingScope: Scope,
                name: string,
                fn: any,
                thisValue: any,
                newTargetValue: any,
                validateEvalDeclarations = false
            ) => {
                let argumentsObject: any
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
                            ctx[OpcodeContextField.initializeBindingValue](
                                activationScope,
                                SpecialVariable.This,
                                getThisBindingValue(thisValue)
                            )
                        }
                        ctx[OpcodeContextField.defineVariable](activationScope, SpecialVariable.NewTarget, VariableType.Var, false)
                        ctx[OpcodeContextField.initializeBindingValue](activationScope, SpecialVariable.NewTarget, newTargetValue)
                        const homeObject = functionDescriptors.get(fn)?.[Fields.homeObject]
                        if (homeObject !== undefined) {
                            ctx[OpcodeContextField.defineVariable](activationScope, SpecialVariable.SuperHomeObject, VariableType.Var, false)
                            ctx[OpcodeContextField.initializeBindingValue](activationScope, SpecialVariable.SuperHomeObject, homeObject)
                        }
                        argumentsObject = getArgumentObject(bindingScope, fn)
                        ctx[OpcodeContextField.writeScopeDebugProperty](activationScope, 'arguments', argumentsObject)
                        if (hasParameterExpressions) {
                            const activationInternals = activationScope as Scope & { [SCOPE_REJECT_EVAL_ARGUMENTS_VAR]?: boolean }
                            activationInternals[SCOPE_REJECT_EVAL_ARGUMENTS_VAR] = true
                        }
                }

                const evalSourceFile = validateEvalDeclarations && isEvalSourceFileInPlace(functionType)
                const evalVariableDeclarations = evalSourceFile
                    ? variables.filter((variable) =>
                        variable[Fields.type] === VariableType.Var
                        || variable[Fields.type] === VariableType.Function
                    )
                    : []

                if (validateEvalDeclarations && !strict) {
                    validateSloppyEvalVarDeclarations(activationScope, evalVariableDeclarations)
                }

                if (
                    functionType === FunctionTypes.SourceFileInPlace
                    && isGlobalVariableEnvironment(activationScope)
                    && activationScope !== globalThis
                ) {
                    validateGlobalScriptDeclarations(activationScope, variables)
                }

                for (const variable of variables) {
                    const variableType = hasParameterExpressions && variable[Fields.type] === VariableType.Parameter
                        ? VariableType.Let
                        : variable[Fields.type]
                    if (
                        evalSourceFile
                        && (variableType === VariableType.Var || variableType === VariableType.Function)
                    ) {
                        defineEvalVarBinding(activationScope, variable[Fields.name], variableType)
                    } else {
                        ctx[OpcodeContextField.defineVariable](bindingScope, variable[Fields.name], variableType)
                    }
                    if (
                        variable[Fields.name] === 'arguments'
                        && variable[Fields.type] === VariableType.Var
                        && bindingScope === activationScope
                        && argumentsObject !== undefined
                    ) {
                        ctx[OpcodeContextField.initializeBindingValue](bindingScope, variable[Fields.name], argumentsObject)
                    }
                }

                bindFunctionSelfName(functionType, bindingScope, name, fn, ctx)

                const restValues = hasRestParameter ? createRealmArray(parameters.slice(restParameterIndex)) : null
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

            const getEvalDeclarationNames = (declarations: readonly VariableRecord[]) =>
                declarations.map((declaration) => declaration[Fields.name])

            const isGlobalVariableEnvironment = (scope: Scope) =>
                scope === ctx[OpcodeContextField.currentFrame][Fields.globalThis]

            const canDeclareGlobalVar = (name: string) =>
                Object.prototype.hasOwnProperty.call(ctx[OpcodeContextField.currentFrame][Fields.globalThis], name)
                || Object.isExtensible(ctx[OpcodeContextField.currentFrame][Fields.globalThis])

            const canDeclareGlobalFunction = (name: string) => {
                const globalThis = ctx[OpcodeContextField.currentFrame][Fields.globalThis]
                const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, name)
                if (descriptor == null) {
                    return Object.isExtensible(globalThis)
                }
                if (descriptor.configurable) {
                    return true
                }
                return 'value' in descriptor
                    && descriptor.writable === true
                    && descriptor.enumerable === true
            }

            const validateGlobalScriptDeclarations = (globalScope: Scope, declarations: readonly VariableRecord[]) => {
                const lexicalNames = new Set<string>()
                const functionNames = new Set<string>()
                const varNames = new Set<string>()

                for (let index = declarations.length - 1; index >= 0; index--) {
                    const declaration = declarations[index]!
                    if (declaration[Fields.type] === VariableType.Function) {
                        functionNames.add(declaration[Fields.name])
                    }
                }

                for (const declaration of declarations) {
                    const name = declaration[Fields.name]
                    switch (declaration[Fields.type]) {
                        case VariableType.Const:
                        case VariableType.Let:
                            lexicalNames.add(name)
                            break
                        case VariableType.Var:
                            if (!functionNames.has(name)) {
                                varNames.add(name)
                            }
                            break
                    }
                }

                for (const name of lexicalNames) {
                    const flags = ctx[OpcodeContextField.getVariableFlag](globalScope, name)
                    if (flags !== undefined && (flags & VariableFlags.Lexical)) {
                        throw new SyntaxError(`Identifier '${name}' has already been declared`)
                    }

                    const descriptor = Reflect.getOwnPropertyDescriptor(globalScope, name)
                    if (descriptor != null && descriptor.configurable === false) {
                        throw new SyntaxError(`Identifier '${name}' has already been declared`)
                    }
                }

                for (const name of [...functionNames, ...varNames]) {
                    const flags = ctx[OpcodeContextField.getVariableFlag](globalScope, name)
                    if (flags !== undefined && (flags & VariableFlags.Lexical)) {
                        throw new SyntaxError(`Identifier '${name}' has already been declared`)
                    }
                }

                for (const name of functionNames) {
                    if (!canDeclareGlobalFunction(name)) {
                        throw new TypeError(`Cannot declare global function '${name}'`)
                    }
                }

                for (const name of varNames) {
                    if (!canDeclareGlobalVar(name)) {
                        throw new TypeError(`Cannot declare global variable '${name}'`)
                    }
                }
            }

            const validateSloppyEvalVarDeclarations = (varEnv: Scope, declarations: readonly VariableRecord[]) => {
                if (declarations.length === 0) {
                    return
                }

                const names = getEvalDeclarationNames(declarations)
                const varEnvInternals = varEnv as Scope & { [SCOPE_REJECT_EVAL_ARGUMENTS_VAR]?: boolean }
                if (names.includes('arguments') && varEnvInternals[SCOPE_REJECT_EVAL_ARGUMENTS_VAR]) {
                    throw new SyntaxError(`Identifier 'arguments' has already been declared`)
                }

                if (isGlobalVariableEnvironment(varEnv)) {
                    for (const declaration of declarations) {
                        const name = declaration[Fields.name]
                        const canDeclare = declaration[Fields.type] === VariableType.Function
                            ? canDeclareGlobalFunction(name)
                            : canDeclareGlobalVar(name)
                        if (!canDeclare) {
                            throw new TypeError(`Cannot declare global variable '${name}'`)
                        }
                    }
                }

                const checkScope = (scope: Scope) => {
                    if (isObjectEnvironmentScope(scope)) {
                        return
                    }

                    for (const name of names) {
                        if ((ctx[OpcodeContextField.getVariableFlag](scope, name) ?? VariableFlags.None) & VariableFlags.Lexical) {
                            throw new SyntaxError(`Identifier '${name}' has already been declared`)
                        }
                    }
                }

                const scopes = ctx[OpcodeContextField.currentFrame][Fields.scopes]
                for (let index = scopes.length - 1; index >= 0; index--) {
                    const scope = scopes[index]!
                    if (scope === varEnv) {
                        break
                    }
                    checkScope(scope)
                }
                checkScope(varEnv)
            }

            const defineEvalVarBinding = (scope: Scope, name: string, type: VariableType) => {
                if (isGlobalVariableEnvironment(scope)) {
                    if (type === VariableType.Var && Reflect.has(scope, name)) {
                        return
                    }
                    if (type === VariableType.Function) {
                        const descriptor = Reflect.getOwnPropertyDescriptor(scope, name)
                        if (descriptor && !descriptor.configurable) {
                            return
                        }
                    }
                } else if (ctx[OpcodeContextField.hasBinding](scope, name)) {
                    return
                }

                ctx[OpcodeContextField.defineVariable](
                    scope,
                    name,
                    type,
                    false,
                    true,
                    VariableFlags.Deletable
                )
            }

            if (invokeType === InvokeType.Apply) {
                const name = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
                const fn = ctx[OpcodeContextField.popCurrentFrameStack]()
                const self = ctx[OpcodeContextField.popCurrentFrameStack]()

                if (
                    functionType === FunctionTypes.Constructor
                    || functionType === FunctionTypes.DerivedConstructor
                ) {
                    throw new TypeError('Class constructor cannot be invoked without new')
                }

                let activationScope: Scope
                let bindingScope: Scope

                if (isSourceFileInPlace(functionType)) {
                    const evalVariableEnvironment = ctx[OpcodeContextField.currentFrame][Fields.variableEnvironment]
                    const validateEvalDeclarations = functionType === FunctionTypes.EvalSourceFileInPlace
                        && evalVariableEnvironment != null
                    activationScope = evalVariableEnvironment
                        ?? ctx[OpcodeContextField.peak](ctx[OpcodeContextField.currentFrame][Fields.scopes])
                        ?? ctx[OpcodeContextField.currentFrame][Fields.globalThis]
                    if (validateEvalDeclarations) {
                        bindingScope = getEmptyObject()
                        ctx[OpcodeContextField.currentFrame][Fields.scopes].push(bindingScope)
                    } else {
                        bindingScope = activationScope
                    }
                    ctx[OpcodeContextField.currentFrame][Fields.variableEnvironment] = activationScope
                    ctx[OpcodeContextField.setScopeDebugPtr](ctx[OpcodeContextField.commandPtr], bindingScope)
                    initializeVariableBindings(activationScope, bindingScope, name, fn, self, undefined, validateEvalDeclarations)
                    break
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
                const newTarget = ctx[OpcodeContextField.popCurrentFrameStack]<ConstructTarget>()

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
                    functionType === FunctionTypes.DerivedConstructor
                        ? undefined
                        : createConstructThis(newTarget, ctx[OpcodeContextField.currentFrame][Fields.globalThis]),
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
            const name = ctx[OpcodeContextField.popCurrentFrameStack]<PropertyKey>()
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
            const isSuperReference = envOrRecord != null
                && typeof envOrRecord === 'object'
                && SUPER_REFERENCE_THIS in envOrRecord
            if (isIdentifierReference) {
                const scope = (envOrRecord as any)[IDENTIFIER_REFERENCE_SCOPE]
                if (scope != null && (scope as any)[SCOPE_WITH_OBJECT] !== undefined) {
                    self = (scope as any)[SCOPE_WITH_OBJECT]
                }
            } else if (isSuperReference) {
                self = (envOrRecord as any)[SUPER_REFERENCE_THIS]
            } else if (!environments.has(envOrRecord)) {
                self = envOrRecord
            }

            const fnTarget = ctx[OpcodeContextField.functionRedirects].has(fn) ? ctx[OpcodeContextField.functionRedirects].get(fn) : fn
            const vmGlobal = ctx[OpcodeContextField.currentFrame][Fields.globalThis]
            const realmEval = Reflect.get(vmGlobal, 'eval')
            const descriptor = functionDescriptors.get(fnTarget)

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
                    [Fields.function]: fnTarget,
                    [Fields.name]: descriptor[Fields.name],
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

            let fn = ctx[OpcodeContextField.popCurrentFrameStack]<(...args: any[]) => any>()
            const newTarget = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
            const activeFunction = getActiveFunctionFrame(ctx)?.[Fields.function]
            if (activeFunction != null && (typeof activeFunction === 'object' || typeof activeFunction === 'function')) {
                fn = Reflect.getPrototypeOf(activeFunction) as (...args: any[]) => any
            }

            if (!functionDescriptors.has(fn)) {
                const instance = Reflect.construct(fn, parameters, newTarget)
                ctx[OpcodeContextField.pushCurrentFrameStack](instance)
            } else {
                const descriptor = functionDescriptors.get(fn)!
                if (!isVmConstructible(fn)) {
                    throw new TypeError('target is not a constructor')
                }
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
                    [Fields.function]: fn,
                    [Fields.name]: descriptor[Fields.name],
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
                if (!isVmConstructible(fn)) {
                    throw new TypeError('target is not a constructor')
                }
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
                    [Fields.function]: fn,
                    [Fields.name]: descriptor[Fields.name],
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
