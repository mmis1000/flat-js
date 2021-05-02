"use strict"
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

export type Scope = Record<string, any>

export const enum Fields {
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
    invokeType,

    ptr,
    stack,
    setDebugFunction,
    step,

    programSection,
    textSection,
    evalResult,
    newTarget
}

interface BaseFrame {
    [Fields.type]: FrameType
    [Fields.programSection]: number[]
    [Fields.textSection]: any[]
    [Fields.scopes]: Scope[]
    [Fields.valueStack]: any[]
}

interface FunctionFrame extends BaseFrame {
    [Fields.type]: FrameType.Function
    [Fields.return]: number,
    [Fields.invokeType]: InvokeType
}

interface TryFrame extends BaseFrame {
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

export type Frame = FunctionFrame | TryFrame

export type Stack = Frame[]

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
const getEmptyObject = Object.create.bind(Object, null, {})

export type Result = {
    done: false,
} | {
    done: true,
    value: unknown,
    evalValue: unknown
}

type RefinedEnvSet = Omit<WeakSet<Frame>, 'has'> & {
    has (value: Frame): boolean
    has (value: any): value is Frame
}

type Context = Record<string, any> | Frame

type FunctionDescriptor = {
    [Fields.name]: string,
    [Fields.type]: FunctionTypes,
    [Fields.offset]: number,
    [Fields.scopes]: Scope[],
    [Fields.programSection]: number[],
    [Fields.textSection]: any[]
}

const functionDescriptors = new WeakMap<any, FunctionDescriptor>()

const environments = new WeakSet() as unknown as RefinedEnvSet

const bindInfo = new WeakMap<any, { [Fields.function]: any, [Fields.self]: any, [Fields.arguments]: any[] }>()

const variableDescriptors = new WeakMap<Scope, Map<string, VariableDescriptor>>()

type InvokeParamApply = {
    [Fields.type]: InvokeType.Apply,
    [Fields.function]: unknown,
    [Fields.name]: string,
    [Fields.self]: unknown,
}
type InvokeParamConstruct = {
    [Fields.type]: InvokeType.Construct,
    [Fields.function]: unknown,
    [Fields.name]: string,
    [Fields.newTarget]: unknown
}

export type InvokeParam = InvokeParamApply | InvokeParamConstruct

const getExecution = (
    program: number[],
    textData: any[],
    entryPoint: number = 0,
    scopes: Scope[] = [],
    invokeData: InvokeParam = {
        [Fields.type]: InvokeType.Apply,
        [Fields.function]: undefined,
        [Fields.name]: '',
        [Fields.self]: undefined
    },
    args: any[] = [],
    getDebugFunction: () => null | (() => void) = () => null
) => {
    let currentProgram = program
    let currentTextData = textData

    const initialFrame: Frame = {
        [Fields.type]: FrameType.Function,
        [Fields.scopes]: scopes,
        [Fields.valueStack]: [
            // @ts-expect-error
            invokeData[Fields.type] === InvokeType.Apply ? invokeData[Fields.self] : invokeData[Fields.newTarget],
            invokeData[Fields.function],
            invokeData[Fields.name],
            invokeData[Fields.type],
            ...args,
            args.length
        ],
        [Fields.invokeType]: invokeData[Fields.type],
        [Fields.return]: -1,
        [Fields.programSection]: currentProgram,
        [Fields.textSection]: currentTextData
    }

    environments.add(initialFrame)

    const stack: Stack = [initialFrame]
    let ptr: number = entryPoint

    const read = () => currentProgram[ptr++]
    const getCurrentFrame = () => stack[stack.length - 1]
    const peak = <T>(arr: T[], offset = 1): T => arr[arr.length - offset]

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

    const MyArgument: { new(): {} } = function MyArgument () {} as any

    const createArgumentObject = () => {
        const obj = new MyArgument()
        Reflect.setPrototypeOf(obj, Object.prototype)
        return obj
    }
    const defineFunction = (scopes: Scope[], name: string, type: FunctionTypes, offset: number) => {
        // TODO: types
        const scopeClone = [...scopes]

        const pr = currentProgram
        const txt = currentTextData

        const des: FunctionDescriptor = {
            [Fields.name]: name,
            [Fields.type]: type,
            [Fields.offset]: offset,
            [Fields.scopes]: scopeClone,
            [Fields.programSection]: pr,
            [Fields.textSection]: txt
        }

        const fn = function externalFn (this: any, ...args: any[]) {
            return run_(
                pr,
                txt,
                offset,
                [...scopeClone], 
                new.target
                    ? {
                        [Fields.type]: InvokeType.Construct,
                        [Fields.function]: fn,
                        [Fields.name]: name,
                        [Fields.newTarget]: new.target
                    }
                    : {
                        [Fields.type]: InvokeType.Apply,
                        [Fields.function]: fn,
                        [Fields.name]: name,
                        [Fields.self]: this
                    }, 
                args, 
                getDebugFunction
            )
        }

        ;(fn as any).__pos__ = offset

        functionDescriptors.set(fn, des)

        return fn
    }

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

    let evalResult: any = undefined;

    let commandPtr = 0
    const step = (debug: boolean = false): Result => {
        const currentPtr = commandPtr = ptr
        const command: OpCode = read()
        const currentFrame = getCurrentFrame()

        if (currentFrame[Fields.programSection].length !== currentProgram.length) {
            debugger
        }

        if (currentFrame[Fields.scopes].length > 50) {
            debugger
        }

        let returnsExternal = false
        let returnValue: unknown = null

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
                        returnsExternal = true
                        returnValue = value
                        return value
                    } else {
                        stack.pop()
                        ptr = returnAddr
                        currentProgram = peak(stack)[Fields.programSection]
                        currentTextData = peak(stack)[Fields.textSection]

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

                            // as if we throw on upper try catch
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
                        currentProgram = frame[Fields.programSection]
                        currentTextData = frame[Fields.textSection]
                    } else {
                        ptr = exitAddr
                        currentProgram = frame[Fields.programSection]
                        currentTextData = frame[Fields.textSection]
                    }
                }
                    break;
                case TryCatchFinallyState.Catch: {
                    if (finallyAddr >= 0) {
                        frame[Fields.state] = TryCatchFinallyState.Finally
                        frame[Fields.resolveType] = ResolveType.throw
                        frame[Fields.value] = value
                        ptr = finallyAddr
                        currentProgram = frame[Fields.programSection]
                        currentTextData = frame[Fields.textSection]
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

        const popCurrentFrameStack = <T = unknown>(): T => {
            return currentFrame[Fields.valueStack].pop()
        }

        const pushCurrentFrameStack = (arg: any): number => {
            return currentFrame[Fields.valueStack].push(arg)
        }

        try {
            command: switch (command) {
                case OpCode.Literal: {
                    const value = read()
                    if (isSmallNumber(value)) {
                        pushCurrentFrameStack(value)
                    } else {
                        pushCurrentFrameStack(currentTextData[value ^ TEXT_DADA_MASK])
                    }
                }
                    break;
                case OpCode.Pop:
                    popCurrentFrameStack()
                    break
                case OpCode.SetEvalResult:
                    evalResult = peak(currentFrame[Fields.valueStack])
                    break
                case OpCode.Duplicate:
                    pushCurrentFrameStack(peak(currentFrame[Fields.valueStack]))
                    break
                case OpCode.GetRecord:
                    pushCurrentFrameStack(currentFrame)
                    break
                case OpCode.NullLiteral:
                    pushCurrentFrameStack(null)
                    break
                case OpCode.UndefinedLiteral:
                    pushCurrentFrameStack(undefined)
                    break
                case OpCode.RegexpLiteral: {
                    const flags = popCurrentFrameStack<string>()
                    const source = popCurrentFrameStack<string>()
                    pushCurrentFrameStack(new REGEXP(source, flags))
                }
                    break
                case OpCode.Set:
                case OpCode.SetKeepCtx: {
                    const value = popCurrentFrameStack()
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Context>()

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
                        pushCurrentFrameStack(value)
                    } else /* if (command === OpCode.SetKeepCtx) */ {
                        pushCurrentFrameStack(ctx)
                    }
                }
                    break;
                // Assign and update
                case OpCode.BPlusEqual:
                case OpCode.BMinusEqual: 
                case OpCode.BSlashEqual:
                case OpCode.BAsteriskEqual: {
                    const rightVal = popCurrentFrameStack()
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Context>()

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

                    pushCurrentFrameStack(r)
                }
                    break;
                case OpCode.DefineKeepCtx: {
                    const value = popCurrentFrameStack()
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Record<string, any>>()

                    Reflect.defineProperty(ctx, name, {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: value
                    })

                    ctx[name] = value

                    pushCurrentFrameStack(ctx)
                }
                    break;
                case OpCode.Get: {
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Context>()

                    pushCurrentFrameStack(getValue(ctx, name))
                }
                    break;
                case OpCode.SetMultiple: {
                    const ctx: Frame = popCurrentFrameStack()
                    const length = popCurrentFrameStack<number>()
                    for (let i = 0; i < length; i++) {
                        const flag = popCurrentFrameStack<number>()
                        const value = popCurrentFrameStack()
                        const name = popCurrentFrameStack<string>()
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
                    const pos = popCurrentFrameStack<number>()
                    ptr = pos
                }
                    break;
                case OpCode.JumpIfNot: {
                    const value = popCurrentFrameStack()
                    const pos = popCurrentFrameStack<number>()
                    if (value) {
                        // intentional blank
                    } else {
                        ptr = pos
                    }
                }
                    break
                case OpCode.JumpIf: {
                    const value = popCurrentFrameStack()
                    const pos = popCurrentFrameStack<number>()
                    if (value) {
                        ptr = pos
                    } else {
                        // intentional blank
                    }
                }
                    break
                case OpCode.JumpIfAndKeep: {
                    const value = popCurrentFrameStack()
                    const pos = popCurrentFrameStack<number>()
                    pushCurrentFrameStack(value)
                    if (value) {
                        ptr = pos
                    } else {
                        // intentional blank
                    }
                }
                    break;
                case OpCode.JumpIfNotAndKeep: {
                    const value = popCurrentFrameStack()
                    const pos = popCurrentFrameStack<number>()
                    pushCurrentFrameStack(value)
                    if (value) {
                        // intentional blank
                    } else {
                        ptr = pos
                    }
                }
                    break;
                case OpCode.EnterFunction: {
                    // TODO: arguments and this/self reference
                    const functionType: FunctionTypes = popCurrentFrameStack()
                    const variableCount: number = popCurrentFrameStack()
                    const variables: VariableRecord[] = []
                    for (let i = 0; i < variableCount; i++) {
                        variables.push({
                            [Fields.type]: popCurrentFrameStack(),
                            [Fields.name]: popCurrentFrameStack()
                        })
                    }
                    const argumentNameCount: number = popCurrentFrameStack()
                    const argumentNames: string[] = []
                    for (let i = 0; i < argumentNameCount; i++) {
                        argumentNames.push(popCurrentFrameStack())
                    }
                    const parameterCount: number = popCurrentFrameStack()
                    const parameters: any[] = []
                    for (let i = 0; i < parameterCount; i++) {
                        parameters.unshift(popCurrentFrameStack())
                    }

                    const invokeType = popCurrentFrameStack()

                    const getArgumentObject = (scope: Record<any, any>, callee: any) => {
                        const obj: Record<string, any> = createArgumentObject()
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
                        const name = popCurrentFrameStack<string>()
                        const fn = popCurrentFrameStack()
                        const self = popCurrentFrameStack()

                        const scope: Scope = getEmptyObject()
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
                        switch (functionType) {
                            case FunctionTypes.FunctionExpression:
                            case FunctionTypes.MethodDeclaration:
                                if (name !== '') {
                                    scope[name] = fn
                                }
                        }

                        for (let v of variables) {
                            defineVariable(scope, v[Fields.name], v[Fields.type])
                        }

                        for (let [index, name] of argumentNames.entries()) {
                            scope[name] = parameters[index]
                        }
                    } else if (invokeType === InvokeType.Construct) {
                        const name = popCurrentFrameStack<string>()
                        const fn = popCurrentFrameStack()
                        const newTarget = popCurrentFrameStack<{ new(...args: any[]): any } >()

                        const scope: Scope = getEmptyObject()
                        currentFrame[Fields.scopes].push(scope)

                        switch (functionType) {
                            case FunctionTypes.MethodDeclaration:
                            case FunctionTypes.GetAccessor:
                            case FunctionTypes.SetAccessor:
                                throw new TypeError('- not a constructor')
                            case FunctionTypes.FunctionDeclaration:
                            case FunctionTypes.FunctionExpression:
                                defineVariable(scope, SpecialVariable.This, VariableType.Var)
                                scope[SpecialVariable.This] = Object.create(newTarget.prototype)
                                scope['arguments'] = getArgumentObject(scope, fn)
                        }

                        switch (functionType) {
                            case FunctionTypes.FunctionExpression:
                                scope[name] = fn
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
                    const variableCount: number = popCurrentFrameStack()
                    const variables: VariableRecord[] = []
                    for (let i = 0; i < variableCount; i++) {
                        variables.push({
                            [Fields.type]: popCurrentFrameStack(),
                            [Fields.name]: popCurrentFrameStack()
                        })
                    }

                    const scope: Scope = getEmptyObject()
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
                    const type = popCurrentFrameStack<FunctionTypes>()
                    const offset = popCurrentFrameStack<number>()
                    const name = popCurrentFrameStack<string>()
                    pushCurrentFrameStack(defineFunction(currentFrame[Fields.scopes], name, type, offset))
                }
                    break
                case OpCode.CallValue:
                case OpCode.Call: {
                    const parameterCount: number = popCurrentFrameStack()
                    let parameters: any[] = []
                    for (let i = 0; i < parameterCount; i++) {
                        parameters.unshift(popCurrentFrameStack())
                    }

                    let fn, envOrRecord, name = ''

                    if (command === OpCode.Call) {
                        name = popCurrentFrameStack()
                        envOrRecord = popCurrentFrameStack()
                        fn = getValue(envOrRecord, name)
                    } else /** if (command === OpCode.CallValue) */ {
                        envOrRecord = undefined
                        fn = popCurrentFrameStack()
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
                            const parameterArrayLike = parameters != null ? parameters[1] : []
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
                        pushCurrentFrameStack(bound)
                    } else if (!functionDescriptors.has(fn)) {
                        // extern
                        if (typeof fn !== 'function') {
                            if (command === OpCode.Call) {
                                throw new TypeError(`(intermediate value).${name} is not a function`)
                            } else /* if (command === OpCode.CallValue) */ {
                                throw new TypeError(`(intermediate value) is not a function`)
                            }
                        } else {
                            pushCurrentFrameStack(Reflect.apply(fn, self, parameters))
                        }
                        
                    } else {
                        const des = functionDescriptors.get(fn)!
                        const newFrame: Frame = {
                            [Fields.type]: FrameType.Function,
                            [Fields.scopes]: [...des[Fields.scopes]],
                            [Fields.return]: ptr,
                            [Fields.valueStack]: [
                                self,
                                fn,
                                des[Fields.name],
                                InvokeType.Apply,
                                ...parameters,
                                parameters.length
                            ],
                            [Fields.invokeType]: InvokeType.Apply,
                            [Fields.programSection]: des[Fields.programSection],
                            [Fields.textSection]: des[Fields.textSection]
                        }
                        environments.add(newFrame)

                        stack.push(newFrame)
                        ptr = des[Fields.offset]
                        currentTextData = des[Fields.textSection]
                        currentProgram = des[Fields.programSection]
                    }
                }
                    break
                case OpCode.New: {
                    const parameterCount: number = popCurrentFrameStack()
                    let parameters: any[] = []

                    for (let i = 0; i < parameterCount; i++) {
                        parameters.unshift(popCurrentFrameStack())
                    }

                    let fn = popCurrentFrameStack<(...args: any[]) => any>()

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
                        pushCurrentFrameStack(Reflect.construct(fn, parameters, fn))
                    } else {
                        const des = functionDescriptors.get(fn)!
                        const newFrame: Frame = {
                            [Fields.type]: FrameType.Function,
                            [Fields.scopes]: [...des[Fields.scopes]],
                            [Fields.return]: ptr,
                            [Fields.valueStack]: [
                                fn,
                                fn,
                                des[Fields.name],
                                InvokeType.Construct,
                                ...parameters,
                                parameters.length
                            ],
                            [Fields.invokeType]: InvokeType.Construct,
                            [Fields.programSection]: des[Fields.programSection],
                            [Fields.textSection]: des[Fields.textSection]
                        }
                        environments.add(newFrame)

                        stack.push(newFrame)
                        ptr = des[Fields.offset]
                        currentTextData = des[Fields.textSection]
                        currentProgram = des[Fields.programSection]
                    }
                }
                    break
                case OpCode.Return: {
                    const result = popCurrentFrameStack()
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
                            returnsExternal = true
                            returnValue = result
                            break command
                        } else {
                            if (typeof result === 'function' || typeof result === 'object') {
                                returnsExternal = true
                                returnValue = result
                                break command
                            } else {
                                returnsExternal = true
                                returnValue = getValue(functionFrame, SpecialVariable.This)
                                break command
                            }
                        }
                    }

                    stack.pop()

                    const prevFrame = peak(stack)

                    if (functionFrame[Fields.invokeType] === InvokeType.Apply) {
                        prevFrame[Fields.valueStack].push(result)
                    } else {
                        if (typeof result === 'function' || typeof result === 'object') {
                            prevFrame[Fields.valueStack].push(result)
                        } else {
                            prevFrame[Fields.valueStack].push(getValue(functionFrame, SpecialVariable.This))
                        }
                    }

                    ptr = returnAddr
                    currentProgram = prevFrame[Fields.programSection]
                    currentTextData = prevFrame[Fields.textSection]
                }
                    break
                case OpCode.Throw: {
                    const err = popCurrentFrameStack()
                    throw err
                }
                case OpCode.ThrowReferenceError: {
                    const msg = popCurrentFrameStack<string>()
                    throw new ReferenceError(msg)
                }
                case OpCode.ArrayLiteral:
                    pushCurrentFrameStack([])
                    break
                case OpCode.ObjectLiteral:
                    pushCurrentFrameStack({})
                    break
                case OpCode.InitTryCatch: {
                    const catchName = popCurrentFrameStack<string>()
                    const finallyAddr = popCurrentFrameStack<number>()
                    const catchAddr = popCurrentFrameStack<number>()
                    const exitAddr = popCurrentFrameStack<number>()

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
                        [Fields.exit]: exitAddr,
                        [Fields.textSection]: currentTextData,
                        [Fields.programSection]: currentProgram
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
                    const value = popCurrentFrameStack()
                    pushCurrentFrameStack(typeof value)
                }
                    break
                case OpCode.TypeofReference: {
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Context>()
                    if (environments.has(ctx)) {
                        const frame: Frame = ctx
                        for (let i = frame[Fields.scopes].length - 1; i >= 0; i--) {
                            if (Reflect.getOwnPropertyDescriptor(frame[Fields.scopes][i], name)) {
                                pushCurrentFrameStack(typeof frame[Fields.scopes][i][name]) 
                                break command;
                            }
                        }
                        pushCurrentFrameStack('undefined') 
                    } else {
                        pushCurrentFrameStack(typeof ctx[name])
                    }
                }
                    break
                case OpCode.GetPropertyIterator: {
                    const value = popCurrentFrameStack()
                    const iterator = (function * (value: any) {
                        for (const key in value) {
                            yield key
                        }
                    })(value)
                    pushCurrentFrameStack(iterator)
                }
                    break
                case OpCode.NextEntry: {
                    const iterator: Iterator<any> = popCurrentFrameStack()
                    pushCurrentFrameStack(iterator.next())
                }
                    break
                case OpCode.EntryIsDone: {
                    const entry: IteratorResult<any> = popCurrentFrameStack()
                    pushCurrentFrameStack(entry.done)
                }
                    break
                case OpCode.EntryGetValue: {
                    const entry: IteratorResult<any> = popCurrentFrameStack()
                    pushCurrentFrameStack(entry.value)
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
                    const right = popCurrentFrameStack()
                    const left = popCurrentFrameStack()
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
                    pushCurrentFrameStack(result)
                }
                    break;
                case OpCode.PostFixPlusPLus:
                case OpCode.PostFixMinusMinus: {
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Context>()
                    if (environments.has(ctx)) {
                        const env: Frame = ctx
                        const scope = findScope(env, name)

                        if (scope) {
                            const old = scope[name]
                            const newVal = command === OpCode.PostFixPlusPLus ? old + 1 : old - 1
                            scope[name] = newVal
                            pushCurrentFrameStack(old)
                        } else {
                            throw new ReferenceError(name + is_not_defined)
                        }
                    } else {
                        const self = ctx
                        const old = self[name]
                        const newVal = command === OpCode.PostFixPlusPLus ? old + 1 : old - 1
                        self[name] = newVal
                        pushCurrentFrameStack(old)
                    }
                }
                    break;
                case OpCode.PrefixUnaryPlus:
                case OpCode.PrefixUnaryMinus: 
                case OpCode.PrefixExclamation:
                case OpCode.PrefixTilde: {
                    const value = popCurrentFrameStack<any>()
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
                    pushCurrentFrameStack(result)
                }
                    break
                // Prefix updates
                case OpCode.PrefixPlusPlus:
                case OpCode.PrefixMinusMinus: {
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack()

                    const currentValue = getValue(ctx, name)
                    const newVal = command === OpCode.PrefixPlusPlus ? currentValue + 1 : currentValue - 1
                    setValue(ctx, name, newVal)

                    // Just don't care and push the new value
                    pushCurrentFrameStack(newVal)
                }
                    break;
                case OpCode.Delete: {
                    const name = popCurrentFrameStack<string>()
                    const ctx = popCurrentFrameStack<Record<string, any>>()
                    pushCurrentFrameStack(delete ctx[name])
                }
                    break
                case OpCode.Debugger: {
                    const debugFn = getDebugFunction()

                    if (debugFn) {
                        if (debug) {
                            debugFn()
                        } else {
                            console.warn('Custom debug function did not work when called from native function')
                        }
                    } else {
                        debugger
                    }
                }
                    break;
                default:
                    type NonRuntimeCommands = OpCode.NodeFunctionType | OpCode.NodeOffset | OpCode.Nop
                    const nothing: NonRuntimeCommands = command
                    throw new Error('Um?')
            }

            if (returnsExternal) {
                return {
                    done: true,
                    value: returnValue,
                    evalValue: evalResult
                }
            }

        } catch (err) {
            if (err != null && typeof err === 'object') {
                err.pos = currentPtr
            }
            throwsConditional(err)
        }

        return {
            done: false
        }
    }

    return {
        get [Fields.ptr] () {
            return commandPtr
        },
        get [Fields.stack] () {
            return stack
        },
        get [Fields.scopes] () {
            return peak(stack)[Fields.scopes]
        },
        [Fields.step]: step
    }
}

const run_ = (
    program: number[],
    textData: any[],
    entryPoint: number,
    scopes: Scope[],
    invokeData: InvokeParam,
    args: any[],
    getDebugFunction: () => null | (() => void),
    evalResultInstead = false
) => {
    const execution = getExecution(program, textData, entryPoint, scopes, invokeData, args, getDebugFunction)

    let res

    do {
        res = execution[Fields.step]()
    } while (!res.done)

    if (!evalResultInstead) {
        return res.value
    } else {
        return res.evalValue
    }
}

const run = (
    program: number[],
    textData: any[],
    entryPoint: number = 0,
    scopes: Scope[] = [],
    self: undefined = undefined,
    args: any[] = []
) => {
    // The debug function is always null because it did not work in one shot
    return run_(
        program,
        textData,
        entryPoint,
        scopes,
        {
            [Fields.type]: InvokeType.Apply,
            [Fields.function]: undefined,
            [Fields.name]: '',
            [Fields.self]: self
        },
        args,
        () => null,
        true
    )
}

export {
    getExecution,
    run
}