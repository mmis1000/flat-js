"use strict"
import ts from "typescript"
import { FunctionTypes, InvokeType, OpCode, ResolveType, SetFlag, SpecialVariable, TryCatchFinallyState, VariableType } from "./compiler"


// [START_HERE]
// MUST SYNC WITH COMPILER
const TEXT_DADA_MASK = 0x80000000
// MUST SYNC WITH COMPILER
const isSmallNumber = (a: any): a is number => {
    return typeof a === 'number' && ((a | 0) === a) && ((a & TEXT_DADA_MASK) === 0)
}

const CALL = Function.prototype.call
const APPLY = Function.prototype.apply
const BIND = Function.prototype.bind
const REGEXP = RegExp

const enum FrameType {
    Function,
    Try
}

type Scope = Record<string, any>

const enum Fields {
    type,
    savedScopes,
    scopes,
    valueStack,
    return,
    catch,
    finally,
    variable,
    name,
    tdz,
    immutable,
    value,
    offset,
    state,
    resolveType,
    exit,

    function,
    self,
    arguments,
    invokeType
}

type FunctionFrame = {
    [Fields.type]: FrameType.Function
    [Fields.scopes]: Scope[]
    [Fields.valueStack]: any[]
    [Fields.return]: number,
    [Fields.invokeType]: InvokeType
}

type TryFrame = {
    [Fields.type]: FrameType.Try,
    // scope snapshot
    [Fields.savedScopes]: Scope[],
    [Fields.scopes]: Scope[],
    // ref to frame's valueStack
    [Fields.valueStack]: any[]

    [Fields.state]: TryCatchFinallyState
    [Fields.resolveType]: ResolveType
    [Fields.value]: any

    /** address */
    [Fields.catch]: number,
    /** address */
    [Fields.finally]: number,
    /** address */
    [Fields.exit]: number,

    [Fields.variable]: string
}

type Frame = FunctionFrame | TryFrame

type Stack = Frame[]

type VariableRecord = {
    [Fields.type]: VariableType
    [Fields.name]: string
}

type VariableDescriptor = {
    [Fields.tdz]: boolean,
    [Fields.immutable]: boolean,
    [Fields.value]: any
}

const is_not_defined = ' is not defined'
const is_a_constant = ' is a constant'

export function run(program: number[], textData: any[], entryPoint: number = 0, scopes: Scope[] = [], self: undefined = undefined, args: any[] = []) {
    const environments = new WeakSet()
    const initialFrame: Frame = {
        [Fields.type]: FrameType.Function,
        [Fields.scopes]: scopes,
        [Fields.valueStack]: [
            self,
            undefined,
            InvokeType.Apply,
            ...args,
            args.length
        ],
        [Fields.invokeType]: InvokeType.Apply,
        [Fields.return]: -1
    }

    environments.add(initialFrame)

    const stack: Stack = [initialFrame]
    let ptr: number = entryPoint

    const read = () => program[ptr++]
    const getCurrentFrame = () => stack[stack.length - 1]
    const peak = <T>(arr: T[], offset = 1): T => arr[arr.length - offset]

    const variableDescriptors = new WeakMap<Scope, Map<string, VariableDescriptor>>()

    const defineVariableInternal = (scope: Scope, name: string, tdz: boolean, immutable: boolean) => {
        if (!variableDescriptors.has(scope)) {
            variableDescriptors.set(scope, new Map())
        }

        const descriptor = {
            [Fields.tdz]: tdz,
            [Fields.immutable]: immutable,
            [Fields.value]: undefined
        }

        variableDescriptors.get(scope)!.set(name, descriptor)

        Reflect.defineProperty(scope, name, {
            configurable: true,
            get() {
                if (descriptor[Fields.tdz]) {
                    throw new ReferenceError(name + is_not_defined)
                }
                return descriptor[Fields.value]
            },
            set(v) {
                if (descriptor[Fields.tdz]) {
                    throw new ReferenceError(name + is_not_defined)
                }
                if (descriptor[Fields.immutable]) {
                    throw new TypeError(name + is_a_constant)
                }
                descriptor[Fields.value] = v
            }
        })
    }

    const defineVariable = (scope: Scope, name: string, type: VariableType) => {
        switch (type) {
            case VariableType.Const:
                // seal it later
                return defineVariableInternal(scope, name, true, false)
            case VariableType.Let:
                return defineVariableInternal(scope, name, true, false)
            case VariableType.Function:
            case VariableType.Parameter:
            case VariableType.Var:
                //don't have tdz
                return defineVariableInternal(scope, name, false, false)
        }
    }
    const getVariableDescriptor = (scope: Scope, name: string) => {
        const map = variableDescriptors.get(scope)
        if (map) {
            return map.get(name)
        }
    }

    type FunctionDescriptor = {
        [Fields.name]: string,
        [Fields.type]: ts.SyntaxKind,
        [Fields.offset]: number,
        [Fields.scopes]: Scope[]
    }

    const functionDescriptors = new WeakMap<any, FunctionDescriptor>()

    const defineFunction = (scopes: Scope[], name: string, type: ts.SyntaxKind, offset: number) => {
        // TODO: types
        const scopeClone = [...scopes]

        const des: FunctionDescriptor = {
            [Fields.name]: name,
            [Fields.type]: type,
            [Fields.offset]: offset,
            [Fields.scopes]: scopeClone
        }

        const fn = function (this: any, ...args: any[]) {
            return run(program, textData, offset, scopeClone, this, args)
        }

        functionDescriptors.set(fn, des)

        return fn
    }
    const bindInfo = new WeakMap<any, { [Fields.function]: any, [Fields.self]: any, [Fields.arguments]: any[] }>()
    const bindInternal = (fn: any, self: any, args: any[]) => {
        if (typeof fn !== 'function') {
            return undefined
        }

        const bindFn = function (...additionalArgs: any[]) {
            return Reflect.apply(fn, self, [...args, ...additionalArgs])
        }

        bindInfo.set(bindFn, {
            [Fields.function]: fn,
            [Fields.self]: self,
            [Fields.arguments]: args
        })

        return bindFn
    }

    const findScope = (ctx: Frame, name: string): Scope | null => {
        for (let i = ctx[Fields.scopes].length - 1; i >= 0; i--) {
            if (Reflect.has(ctx[Fields.scopes][i], name)) {
                return ctx[Fields.scopes][i]
            }
        }

        return null
    }
    const getValue = (ctx: any, name: string) => {
        if (!environments.has(ctx)) {
            return ctx[name]
        } else {
            const env: Frame = ctx
            const scope = findScope(env, name)

            if (scope) {
                return scope[name]
            } else {
                throw new ReferenceError(name + is_not_defined)
            }
        }
    }
    const setValue = (ctx: any, name: string, value: any) => {
        if (!environments.has(ctx)) {
            return (ctx[name] = value)
        } else {
            const env: Frame = ctx
            const scope = findScope(env, name)

            if (scope) {
                return (scope[name] = value)
            } else {
                throw new ReferenceError(name + is_not_defined)
            }
        }
    }

    while (ptr >= 0 && ptr < program.length) {
        const command: OpCode = read()
        const currentFrame = getCurrentFrame()

        const addCatchScope = (frame: TryFrame, name: string, value: any) => {
            const newScope: Scope = {}
            defineVariable(newScope, name, VariableType.Var)
            newScope[name] = value
            frame[Fields.scopes].push(newScope)
        }

        const returnsValueConditional = (value: any) => {
            const currentFrame = peak(stack)
            // try to find upper try frame or return (if any and hand control to it)
            switch (currentFrame[Fields.type]) {
                case FrameType.Function: {
                    const frame = currentFrame as FunctionFrame

                    // exit
                    const returnAddr = frame[Fields.return]

                    if (returnAddr < 0) {
                        // leave the whole function
                        return value
                    } else {
                        stack.pop()
                        ptr = returnAddr
                        if (
                            frame[Fields.invokeType] === InvokeType.Apply
                            || ( value !== null && typeof value === 'object')
                            || typeof value === 'function'
                        ) {
                            peak(stack)[Fields.valueStack].push(value)
                        } else {
                            peak(stack)[Fields.valueStack].push(getValue(frame, SpecialVariable.This))
                        }
                    }
                }
                    break
                case FrameType.Try: {
                    const frame = currentFrame as TryFrame

                    // as if we return on upper try catch
                    frame[Fields.valueStack].push(value)
                    returnsTryFrame()
                }
                    break
            }
        }

        const returnsTryFrame = () => {
            const frame = peak(stack) as TryFrame
            const value = frame[Fields.valueStack].pop()
            const finallyAddr = frame[Fields.finally]

            // restore scopes
            frame[Fields.scopes] = frame[Fields.savedScopes].slice(0)

            const state = frame[Fields.state]
            switch (state) {
                case TryCatchFinallyState.Try:
                case TryCatchFinallyState.Catch: {
                    if (finallyAddr >= 0) {
                        frame[Fields.state] = TryCatchFinallyState.Finally
                        frame[Fields.resolveType] = ResolveType.return
                        frame[Fields.value] = value
                        ptr = finallyAddr
                    } else {
                        stack.pop()
                        returnsValueConditional(value)
                        return
                    }
                }
                    break;
                case TryCatchFinallyState.Finally: {
                    stack.pop()
                    returnsValueConditional(value)
                    return
                }
                    break;
                default:
                    const nothing: never = state

            }
        }

        const throwsConditional = (value: any) => {
            loop: while (true) {
                if (stack.length === 0) {
                    throw value
                }
                const currentFrame = peak(stack)
                switch (currentFrame[Fields.type]) {
                    case FrameType.Function: {
                        stack.pop()
                    }
                        break
                    case FrameType.Try: {
                        const frame = currentFrame as TryFrame

                        if (frame[Fields.state] === TryCatchFinallyState.Finally) {
                            stack.pop()
                        } else {

                            // as if we return on upper try catch
                            currentFrame[Fields.valueStack].push(value)
                            throwsTryFrame();
                            return
                        }
                    }

                }
            }

            throw value
        }

        const throwsTryFrame = () => {
            const frame = peak(stack) as TryFrame
            const value = frame[Fields.valueStack].pop()
            const exitAddr = frame[Fields.exit]
            const finallyAddr = frame[Fields.finally]
            const catchAddr = frame[Fields.catch]

            // restore scopes
            frame[Fields.scopes] = frame[Fields.savedScopes].slice(0)

            const state = frame[Fields.state]
            switch (state) {
                case TryCatchFinallyState.Try: {
                    if (catchAddr >= 0) {
                        frame[Fields.state] = TryCatchFinallyState.Catch
                        frame[Fields.resolveType] = ResolveType.throw
                        frame[Fields.value] = value

                        if (frame[Fields.variable] !== undefined) {
                            addCatchScope(frame, frame[Fields.variable], value)
                        }

                        ptr = catchAddr
                    } else {
                        ptr = exitAddr
                    }
                }
                    break;
                case TryCatchFinallyState.Catch: {
                    if (finallyAddr >= 0) {
                        frame[Fields.state] = TryCatchFinallyState.Finally
                        frame[Fields.resolveType] = ResolveType.throw
                        frame[Fields.value] = value
                        ptr = finallyAddr
                    } else {
                        stack.pop()
                        throwsConditional(value)
                    }
                    break
                }

                case TryCatchFinallyState.Finally: {
                    stack.pop()
                    throwsConditional(value)
                }
                    break
                default:
                    const nothing: never = state
            }
        }

        try {
            command: switch (command) {
                case OpCode.Literal: {
                    const value = read()
                    if (isSmallNumber(value)) {
                        currentFrame[Fields.valueStack].push(value)
                    } else {
                        currentFrame[Fields.valueStack].push(textData[value ^ TEXT_DADA_MASK])
                    }
                }
                    break;
                case OpCode.Pop:
                    currentFrame[Fields.valueStack].pop()
                    break
                case OpCode.Duplicate:
                    currentFrame[Fields.valueStack].push(peak(currentFrame[Fields.valueStack]))
                    break
                case OpCode.GetRecord:
                    currentFrame[Fields.valueStack].push(currentFrame)
                    break
                case OpCode.NullLiteral:
                    currentFrame[Fields.valueStack].push(null)
                    break
                case OpCode.UndefinedLiteral:
                    currentFrame[Fields.valueStack].push(undefined)
                    break
                case OpCode.RegexpLiteral: {
                    const flags = currentFrame[Fields.valueStack].pop()
                    const source = currentFrame[Fields.valueStack].pop()
                    currentFrame[Fields.valueStack].push(new REGEXP(source, flags))
                }
                    break
                case OpCode.Set:
                case OpCode.SetKeepCtx: {
                    const value = currentFrame[Fields.valueStack].pop()
                    const name = currentFrame[Fields.valueStack].pop()
                    const ctx = currentFrame[Fields.valueStack].pop()

                    if (!environments.has(ctx)) {
                        ctx[name] = value
                    } else {
                        const scope = findScope(ctx, name)
                        if (scope) {
                            scope[name] = value
                        } else {
                            throw new ReferenceError(name + is_not_defined)
                        }
                    }

                    if (command === OpCode.Set) {
                        currentFrame[Fields.valueStack].push(value)
                    } else /* if (command === OpCode.SetKeepCtx) */ {
                        currentFrame[Fields.valueStack].push(ctx)
                    }
                }
                    break;
                // Assign and update
                case OpCode.BPlusEqual:
                case OpCode.BMinusEqual: 
                case OpCode.BSlashEqual:
                case OpCode.BAsteriskEqual: {
                    const rightVal = currentFrame[Fields.valueStack].pop()
                    const name = currentFrame[Fields.valueStack].pop()
                    const ctx = currentFrame[Fields.valueStack].pop()

                    const leftValue = getValue(ctx, name)
                    const commandCurrent = command
               
                    const exprs: Record<typeof commandCurrent, (a: any, b:any) => any> = {
                        [OpCode.BPlusEqual]: (a, b) => a + b,
                        [OpCode.BMinusEqual]: (a, b) => a - b,
                        [OpCode.BSlashEqual]: (a, b) => a / b,
                        [OpCode.BAsteriskEqual]: (a, b) => a * b
                    }

                    const r = exprs[command](leftValue, rightVal)
                    setValue(ctx, name, r)

                    currentFrame[Fields.valueStack].push(r)
                }
                    break;
                case OpCode.DefineKeepCtx: {
                    const value = currentFrame[Fields.valueStack].pop()
                    const name = currentFrame[Fields.valueStack].pop()
                    const ctx = currentFrame[Fields.valueStack].pop()

                    Reflect.defineProperty(ctx, name, {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: value
                    })

                    ctx[name] = value

                    currentFrame[Fields.valueStack].push(ctx)
                }
                    break;
                case OpCode.Get: {
                    const name = currentFrame[Fields.valueStack].pop()
                    const ctx = currentFrame[Fields.valueStack].pop()

                    currentFrame[Fields.valueStack].push(getValue(ctx, name))
                }
                    break;
                case OpCode.SetMultiple: {
                    const ctx: Frame = currentFrame[Fields.valueStack].pop()
                    const length = currentFrame[Fields.valueStack].pop()
                    for (let i = 0; i < length; i++) {
                        const flag = currentFrame[Fields.valueStack].pop()
                        const value = currentFrame[Fields.valueStack].pop()
                        const name = currentFrame[Fields.valueStack].pop()
                        let hit = false

                        for (let i = ctx[Fields.scopes].length - 1; i >= 0; i--) {
                            if (Reflect.has(ctx[Fields.scopes][i], name)) {
                                hit = true
                                const desc = getVariableDescriptor(ctx[Fields.scopes][i], name)
                                if (desc && (flag & SetFlag.DeTDZ)) desc[Fields.tdz] = false
                                currentFrame[Fields.scopes][i][name] = value
                                if (desc && (flag & SetFlag.Freeze)) desc[Fields.immutable] = true
                                break
                            }
                        }

                        if (!hit) {
                            throw new ReferenceError(name + is_not_defined)
                        }
                    }
                }
                    break;
                case OpCode.Jump: {
                    const pos = currentFrame[Fields.valueStack].pop()
                    ptr = pos
                }
                    break;
                case OpCode.JumpIfNot: {
                    const value = currentFrame[Fields.valueStack].pop()
                    const pos = currentFrame[Fields.valueStack].pop()
                    if (value) {
                        // intentional blank
                    } else {
                        ptr = pos
                    }
                }
                    break
                case OpCode.JumpIf: {
                    const value = currentFrame[Fields.valueStack].pop()
                    const pos = currentFrame[Fields.valueStack].pop()
                    if (value) {
                        ptr = pos
                    } else {
                        // intentional blank
                    }
                }
                    break
                case OpCode.JumpIfAndKeep: {
                    const value = currentFrame[Fields.valueStack].pop()
                    const pos = currentFrame[Fields.valueStack].pop()
                    currentFrame[Fields.valueStack].push(value)
                    if (value) {
                        ptr = pos
                    } else {
                        // intentional blank
                    }
                }
                    break;
                case OpCode.JumpIfNotAndKeep: {
                    const value = currentFrame[Fields.valueStack].pop()
                    const pos = currentFrame[Fields.valueStack].pop()
                    currentFrame[Fields.valueStack].push(value)
                    if (value) {
                        // intentional blank
                    } else {
                        ptr = pos
                    }
                }
                    break;
                case OpCode.EnterFunction: {
                    // TODO: arguments and this/self reference
                    const functionType: FunctionTypes = currentFrame[Fields.valueStack].pop()
                    const variableCount: number = currentFrame[Fields.valueStack].pop()
                    const variables: VariableRecord[] = []
                    for (let i = 0; i < variableCount; i++) {
                        variables.push({
                            [Fields.type]: currentFrame[Fields.valueStack].pop(),
                            [Fields.name]: currentFrame[Fields.valueStack].pop()
                        })
                    }
                    const argumentNameCount: number = currentFrame[Fields.valueStack].pop()
                    const argumentNames: string[] = []
                    for (let i = 0; i < argumentNameCount; i++) {
                        argumentNames.push(currentFrame[Fields.valueStack].pop())
                    }
                    const parameterCount: number = currentFrame[Fields.valueStack].pop()
                    const parameters: any[] = []
                    for (let i = 0; i < parameterCount; i++) {
                        parameters.unshift(currentFrame[Fields.valueStack].pop())
                    }

                    const invokeType = currentFrame[Fields.valueStack].pop()

                    const getArgumentObject = (scope: Record<any, any>, callee: any) => {
                        const obj: Record<string, any> = {}
                        const bindingLength = Math.min(argumentNameCount, parameterCount)

                        for (let i = 0; i < parameterCount; i++) {
                            if (i < bindingLength) {
                                Object.defineProperty(obj, i, {
                                    enumerable: true,
                                    configurable: true,
                                    get () {
                                        return scope[argumentNames[i]]
                                    },
                                    set (v) {
                                        scope[argumentNames[i]] = v
                                    }
                                })
                            } else {
                                obj[i] = parameters[i]
                            }
                        }

                        Object.defineProperty(obj, 'length', {
                            enumerable: false,
                            configurable: true,
                            value: parameterCount
                        })
                        Object.defineProperty(obj, 'callee', {
                            enumerable: false,
                            configurable: true,
                            value: callee
                        })

                        return obj
                    }

                    if (invokeType === InvokeType.Apply) {
                        // TODO: arguments and this/self reference
                        const fn = currentFrame[Fields.valueStack].pop()
                        const self = currentFrame[Fields.valueStack].pop()

                        const scope: Scope = {}
                        currentFrame[Fields.scopes].push(scope)

                        switch (functionType) {
                            case FunctionTypes.FunctionDeclaration:
                            case FunctionTypes.FunctionExpression:
                            case FunctionTypes.MethodDeclaration:
                            case FunctionTypes.GetAccessor:
                            case FunctionTypes.SetAccessor:
                                defineVariable(scope, SpecialVariable.This, VariableType.Var)
                                scope[SpecialVariable.This] = self
                                scope['arguments'] = getArgumentObject(scope, fn)
                        }

                        for (let v of variables) {
                            defineVariable(scope, v[Fields.name], v[Fields.type])
                        }

                        for (let [index, name] of argumentNames.entries()) {
                            scope[name] = parameters[index]
                        }
                    } else if (invokeType === InvokeType.Construct) {
                        // FIXME:
                        const fn = currentFrame[Fields.valueStack].pop()
                        const newTarget = currentFrame[Fields.valueStack].pop()

                        const scope: Scope = {}
                        currentFrame[Fields.scopes].push(scope)

                        switch (functionType) {
                            case FunctionTypes.MethodDeclaration:
                            case FunctionTypes.GetAccessor:
                            case FunctionTypes.SetAccessor:
                                throw new TypeError('- not a constructor')
                            case FunctionTypes.FunctionDeclaration:
                            case FunctionTypes.FunctionExpression:
                                defineVariable(scope, SpecialVariable.This, VariableType.Var)
                                scope[SpecialVariable.This] = Object.create(fn.prototype)
                                scope['arguments'] = getArgumentObject(scope, fn)
                        }

                        for (let v of variables) {
                            defineVariable(scope, v[Fields.name], v[Fields.type])
                        }

                        for (let [index, name] of argumentNames.entries()) {
                            scope[name] = parameters[index]
                        }
                    }
                }
                    break
                case OpCode.EnterScope: {
                    const variableCount: number = currentFrame[Fields.valueStack].pop()
                    const variables: VariableRecord[] = []
                    for (let i = 0; i < variableCount; i++) {
                        variables.push({
                            [Fields.type]: currentFrame[Fields.valueStack].pop(),
                            [Fields.name]: currentFrame[Fields.valueStack].pop()
                        })
                    }

                    const scope: Scope = {}
                    currentFrame[Fields.scopes].push(scope)

                    for (let v of variables) {
                        defineVariable(scope, v[Fields.name], v[Fields.type])
                    }
                }
                    break
                case OpCode.LeaveScope: {
                    currentFrame[Fields.scopes].pop()
                }
                    break
                case OpCode.DeTDZ: {
                    const env: Frame = peak(currentFrame[Fields.valueStack], 2)
                    const name = peak(currentFrame[Fields.valueStack])
                    getVariableDescriptor(peak(env[Fields.scopes]), name)![Fields.tdz] = false
                }
                    break
                case OpCode.FreezeVariable: {
                    const env: Frame = peak(currentFrame[Fields.valueStack], 2)
                    const name = peak(currentFrame[Fields.valueStack])
                    getVariableDescriptor(peak(env[Fields.scopes]), name)![Fields.immutable] = true
                }
                    break
                case OpCode.DefineFunction: {
                    const type = currentFrame[Fields.valueStack].pop()
                    const offset = currentFrame[Fields.valueStack].pop()
                    const name = currentFrame[Fields.valueStack].pop()
                    currentFrame[Fields.valueStack].push(defineFunction(currentFrame[Fields.scopes], name, type, offset))
                }
                    break
                case OpCode.CallValue:
                case OpCode.Call: {
                    const parameterCount: number = currentFrame[Fields.valueStack].pop()
                    let parameters: any[] = []
                    for (let i = 0; i < parameterCount; i++) {
                        parameters.unshift(currentFrame[Fields.valueStack].pop())
                    }

                    let fn, envOrRecord

                    if (command === OpCode.Call) {
                        const name = currentFrame[Fields.valueStack].pop()
                        envOrRecord = currentFrame[Fields.valueStack].pop()
                        fn = getValue(envOrRecord, name)
                    } else /** if (command === OpCode.CallValue) */ {
                        envOrRecord = undefined
                        fn = currentFrame[Fields.valueStack].pop()
                    }

                    while (fn === CALL || fn === APPLY || bindInfo.has(fn)) {
                        let newFn, newSelf, newParameters
                        if (fn === CALL) {
                            newFn = envOrRecord
                            newSelf = parameters[0]
                            newParameters = parameters.slice(1)
                        } else if (fn === APPLY) {
                            newFn = envOrRecord
                            newSelf = parameters[0]
                            const parameterArrayLike = parameters[1]
                            const parameterLength = parameterArrayLike.length
                            newParameters = []
                            for (let i = 0; i < parameterLength; i++) {
                                newParameters.push(parameterArrayLike[i])
                            }
                        } else /* if (bindInfo.has(fn))*/ {
                            const info0 = bindInfo.get(fn)
                            const info = info0!
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

                    if (fn === BIND) {
                        const bound = bindInternal(self, parameters[0], parameters.slice(1))
                        currentFrame[Fields.valueStack].push(bound)
                    } else if (!functionDescriptors.has(fn)) {
                        // extern
                        currentFrame[Fields.valueStack].push(Reflect.apply(fn, self, parameters))
                    } else {
                        const des = functionDescriptors.get(fn)!
                        const newFrame: Frame = {
                            [Fields.type]: FrameType.Function,
                            [Fields.scopes]: [...des[Fields.scopes]],
                            [Fields.return]: ptr,
                            [Fields.valueStack]: [
                                self,
                                fn,
                                InvokeType.Apply,
                                ...parameters,
                                parameters.length
                            ],
                            [Fields.invokeType]: InvokeType.Apply
                        }
                        environments.add(newFrame)

                        stack.push(newFrame)
                        ptr = des[Fields.offset]
                    }
                }
                    break
                case OpCode.New: {
                    const parameterCount: number = currentFrame[Fields.valueStack].pop()
                    let parameters: any[] = []

                    for (let i = 0; i < parameterCount; i++) {
                        parameters.unshift(currentFrame[Fields.valueStack].pop())
                    }

                    let fn = currentFrame[Fields.valueStack].pop()

                    while (bindInfo.has(fn)) {
                        let newFn, newParameters

                        const info0 = bindInfo.get(fn)
                        const info = info0!
                        newParameters = [...info[Fields.arguments], ...parameters]
                        newFn = info[Fields.function]

                        fn = environments.has(newFn) ? undefined : newFn
                        parameters = newParameters
                    }

                    if (!functionDescriptors.has(fn)) {
                        // extern
                        currentFrame[Fields.valueStack].push(Reflect.construct(fn, parameters, fn))
                    } else {
                        const des = functionDescriptors.get(fn)!
                        const newFrame: Frame = {
                            [Fields.type]: FrameType.Function,
                            [Fields.scopes]: [...des[Fields.scopes]],
                            [Fields.return]: ptr,
                            [Fields.valueStack]: [
                                fn,
                                fn,
                                InvokeType.Construct,
                                ...parameters,
                                parameters.length
                            ],
                            [Fields.invokeType]: InvokeType.Construct
                        }
                        environments.add(newFrame)

                        stack.push(newFrame)
                        ptr = des[Fields.offset]
                    }
                }
                    break
                case OpCode.Return: {
                    const result = currentFrame[Fields.valueStack].pop()
                    if (currentFrame[Fields.valueStack].length > 0) {
                        throw new Error('bad return')
                    }

                    // remove all try frames
                    while (peak(stack)[Fields.type] !== FrameType.Function) {
                        stack.pop()
                    }

                    const returnAddr = (peak(stack) as FunctionFrame)[Fields.return]

                    const functionFrame = peak(stack) as FunctionFrame

                    if (returnAddr < 0) {
                        // leave the whole function
                        if (functionFrame[Fields.invokeType] === InvokeType.Apply) {
                            return result
                        } else {
                            if (typeof result === 'function' || typeof result === 'object') {
                                return result
                            } else {
                                return getValue(functionFrame, SpecialVariable.This)
                            }
                        }
                    }

                    stack.pop()

                    if (functionFrame[Fields.invokeType] === InvokeType.Apply) {
                        peak(stack)[Fields.valueStack].push(result)
                    } else {
                        if (typeof result === 'function' || typeof result === 'object') {
                            peak(stack)[Fields.valueStack].push(result)
                        } else {
                            peak(stack)[Fields.valueStack].push(getValue(functionFrame, SpecialVariable.This))
                        }
                    }

                    ptr = returnAddr
                }
                    break
                case OpCode.Throw: {
                    const err = currentFrame[Fields.valueStack].pop()
                    throw err
                }
                case OpCode.ThrowReferenceError: {
                    const msg = currentFrame[Fields.valueStack].pop()
                    throw new ReferenceError(msg)
                }
                case OpCode.ArrayLiteral:
                    currentFrame[Fields.valueStack].push([])
                    break
                case OpCode.ObjectLiteral:
                    currentFrame[Fields.valueStack].push({})
                    break
                case OpCode.InitTryCatch: {
                    const catchName = currentFrame[Fields.valueStack].pop()
                    const finallyAddr = currentFrame[Fields.valueStack].pop()
                    const catchAddr = currentFrame[Fields.valueStack].pop()
                    const exitAddr = currentFrame[Fields.valueStack].pop()

                    const frame: TryFrame = {
                        [Fields.type]: FrameType.Try,
                        [Fields.savedScopes]: currentFrame[Fields.scopes],
                        [Fields.scopes]: currentFrame[Fields.scopes].slice(0),
                        [Fields.valueStack]: [],
                        [Fields.state]: TryCatchFinallyState.Try,
                        [Fields.resolveType]: ResolveType.normal,
                        [Fields.value]: undefined,
                        [Fields.catch]: catchAddr,
                        [Fields.finally]: finallyAddr,
                        [Fields.variable]: catchName,
                        [Fields.exit]: exitAddr
                    }

                    environments.add(frame)

                    stack.push(frame)
                }
                    break
                case OpCode.ReturnInTryCatchFinally:
                    returnsTryFrame()

                    break;
                case OpCode.ThrowInTryCatchFinally:
                    throwsTryFrame()

                    break
                case OpCode.ExitTryCatchFinally: {
                    const frame = currentFrame as TryFrame
                    const prevState = frame[Fields.state]
                    const prevResolveType = frame[Fields.resolveType]
                    const prevValue = frame[Fields.value]
                    const exit = frame[Fields.exit]
                    const finallyPtr = frame[Fields.finally]

                    // restore scopes
                    frame[Fields.scopes] = frame[Fields.savedScopes].slice(0)

                    switch (prevState) {
                        case TryCatchFinallyState.Finally:
                            switch (prevResolveType) {
                                case ResolveType.normal:
                                    ptr = exit
                                    break command
                                case ResolveType.throw:
                                    throwsConditional(prevValue)
                                    break command
                                case ResolveType.return:
                                    returnsValueConditional(prevValue)
                                    break command
                            }
                        case TryCatchFinallyState.Try:
                        case TryCatchFinallyState.Catch:
                            if (frame[Fields.finally] >= 0) {
                                frame[Fields.state] = TryCatchFinallyState.Finally
                                frame[Fields.resolveType] = ResolveType.normal
                                frame[Fields.value] = undefined

                                ptr = finallyPtr
                                break command
                            } else {
                                ptr = exit
                                break command
                            }
                        default:
                            const nothing: never = prevState;
                    }
                }
                    break;
                case OpCode.Typeof: {
                    const value = currentFrame[Fields.valueStack].pop()
                    currentFrame[Fields.valueStack].push(typeof value)
                }
                    break
                case OpCode.TypeofReference: {
                    const name = currentFrame[Fields.valueStack].pop()
                    const ctx = currentFrame[Fields.valueStack].pop()
                    if (environments.has(ctx)) {
                        const frame: Frame = ctx
                        for (let i = frame[Fields.scopes].length - 1; i >= 0; i--) {
                            if (Reflect.getOwnPropertyDescriptor(frame[Fields.scopes][i], name)) {
                                currentFrame[Fields.valueStack].push(typeof frame[Fields.scopes][i][name]) 
                                break command;
                            }
                        }
                        currentFrame[Fields.valueStack].push('undefined') 
                    } else {
                        currentFrame[Fields.valueStack].push(typeof ctx[name])
                    }
                }
                    break
                case OpCode.GetPropertyIterator: {
                    const value = currentFrame[Fields.valueStack].pop()
                    const iterator = (function * (value: any) {
                        for (const key in value) {
                            yield key
                        }
                    })(value)
                    currentFrame[Fields.valueStack].push(iterator)
                }
                    break
                case OpCode.NextEntry: {
                    const iterator: Iterator<any> = currentFrame[Fields.valueStack].pop()
                    currentFrame[Fields.valueStack].push(iterator.next())
                }
                    break
                case OpCode.EntryIsDone: {
                    const entry: IteratorResult<any> = currentFrame[Fields.valueStack].pop()
                    currentFrame[Fields.valueStack].push(entry.done)
                }
                    break
                case OpCode.EntryGetValue: {
                    const entry: IteratorResult<any> = currentFrame[Fields.valueStack].pop()
                    currentFrame[Fields.valueStack].push(entry.value)
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
                case OpCode.BEqualsEquals:
                case OpCode.BEqualsEqualsEquals:
                case OpCode.BExclamationEquals:
                case OpCode.BExclamationEqualsEquals:
                case OpCode.BMinus:
                case OpCode.BPlus:
                case OpCode.BIn:
                case OpCode.BAsterisk:
                case OpCode.BSlash: 
                case OpCode.BPercent: {
                    const right = currentFrame[Fields.valueStack].pop()
                    const left = currentFrame[Fields.valueStack].pop()
                    const ops = {
                        [OpCode.BAmpersand]: (left: any, right: any) => left & right,
                        [OpCode.BBar]: (left: any, right: any) => left | right,
                        [OpCode.BCaret]: (left: any, right: any) => left ^ right,
                        [OpCode.BEqualsEquals]: (left: any, right: any) => left == right,
                        [OpCode.BEqualsEqualsEquals]: (left: any, right: any) => left === right,
                        [OpCode.BExclamationEquals]: (left: any, right: any) => left != right,
                        [OpCode.BExclamationEqualsEquals]: (left: any, right: any) => left !== right,
                        [OpCode.BGreaterThan]: (left: any, right: any) => left > right,
                        [OpCode.BGreaterThanGreaterThan]: (left: any, right: any) => left >> right,
                        [OpCode.BGreaterThanGreaterThanGreaterThan]: (left: any, right: any) => left >>> right,
                        [OpCode.BGreaterThanEquals]: (left: any, right: any) => left >= right,
                        [OpCode.BLessThan]: (left: any, right: any) => left < right,
                        [OpCode.BLessThanLessThan]: (left: any, right: any) => left << right,
                        [OpCode.BLessThanEquals]: (left: any, right: any) => left <= right,
                        [OpCode.BPlus]: (left: any, right: any) => left + right,
                        [OpCode.BMinus]: (left: any, right: any) => left - right,
                        [OpCode.InstanceOf]: (left: any, right: any) => left instanceof right,
                        [OpCode.BIn]: (left: any, right: any) => left in right,
                        [OpCode.BAsterisk]: (left: any, right: any) => left * right,
                        [OpCode.BSlash]: (left: any, right: any) => left / right,
                        [OpCode.BPercent]: (left: any, right: any) => left % right
                    }
                    const result = ops[command](left, right)
                    currentFrame[Fields.valueStack].push(result)
                }
                    break;
                case OpCode.PostFixPlusPLus:
                case OpCode.PostFixMinusMinus: {
                    const name = currentFrame[Fields.valueStack].pop()
                    const ctx = currentFrame[Fields.valueStack].pop()
                    if (environments.has(ctx)) {
                        const env: Frame = ctx
                        const scope = findScope(env, name)

                        if (scope) {
                            const old = scope[name]
                            const newVal = command === OpCode.PostFixPlusPLus ? old + 1 : old - 1
                            scope[name] = newVal
                            currentFrame[Fields.valueStack].push(old)
                        } else {
                            throw new ReferenceError(name + is_not_defined)
                        }
                    } else {
                        const self = ctx
                        const old = self[name]
                        const newVal = command === OpCode.PostFixPlusPLus ? old + 1 : old - 1
                        self[name] = newVal
                        currentFrame[Fields.valueStack].push(old)
                    }
                }
                    break;
                case OpCode.PrefixUnaryPlus:
                case OpCode.PrefixUnaryMinus: 
                case OpCode.PrefixExclamation:
                case OpCode.PrefixTilde: {
                    const value = currentFrame[Fields.valueStack].pop()
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
                    currentFrame[Fields.valueStack].push(result)
                }
                    break
                // Prefix updates
                case OpCode.PrefixPlusPlus:
                case OpCode.PrefixMinusMinus: {
                    const name = currentFrame[Fields.valueStack].pop()
                    const ctx = currentFrame[Fields.valueStack].pop()

                    const currentValue = getValue(ctx, name)
                    const newVal = command === OpCode.PrefixPlusPlus ? currentValue + 1 : currentValue - 1
                    setValue(ctx, name, newVal)

                    // Just don't care and push the new value
                    currentFrame[Fields.valueStack].push(newVal)
                }
                    break;
                case OpCode.Delete: {
                    const name = currentFrame[Fields.valueStack].pop()
                    const ctx = currentFrame[Fields.valueStack].pop()
                    currentFrame[Fields.valueStack].push(delete ctx[name])
                }
                    break
                case OpCode.Debugger:
                    debugger;
                    break;
                default:
                    type NonRuntimeCommands = OpCode.NodeFunctionType | OpCode.NodeOffset | OpCode.Nop
                    const nothing: NonRuntimeCommands = command
                    throw new Error('Um?')
            }

        } catch (err) {
            throwsConditional(err)
        }
    }
}