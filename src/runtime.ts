"use strict"
import ts from "typescript"
import { isSmallNumber, OpCode, TEXT_DADA_MASK, VariableType } from "./main"

enum FrameType {
    Function,
    Try
}

type Scope = Record<string, any>

type FunctionFrame = {
    type: FrameType.Function,
    scopes: Scope[],
    valueStack: any[]
    return: number
}

type TryFrame = {
    type: FrameType.Try,
    // scope snapshot
    scopes: Scope[],
    // ref to frame's valueStack
    valueStack: any[]
    catch: number,
    variable: string
}

type Frame = FunctionFrame | TryFrame

type Stack = Frame[]

type VariableRecord = {
    type: VariableType
    name: string
}

export function run(program: number[], textData: any[], entryPoint: number = 0, scopes: Scope[] = [], self: undefined = undefined, args: any[] = []) {
    const environments = new WeakSet()
    const initialFrame: Frame = {
        type: FrameType.Function,
        scopes,
        valueStack: [
            self,
            ...args,
            args.length
        ],
        return: -1
    }
    environments.add(initialFrame)

    const stack: Stack = [initialFrame]
    let ptr: number = entryPoint

    const read = () => program[ptr++]
    const getCurrentFrame = () => stack[stack.length - 1]
    const peak = <T>(arr: T[], offset = 1): T => arr[arr.length - offset]

    type VariableDescriptor = {
        tdz: boolean,
        immutable: boolean,
        value: any
    }

    const variableDescriptors = new WeakMap<Scope, Map<string, VariableDescriptor>>()

    const defineVariableInternal = (scope: Scope, name: string, tdz: boolean, immutable: boolean) => {
        if (!variableDescriptors.has(scope)) {
            variableDescriptors.set(scope, new Map())
        }

        const descriptor = {
            tdz,
            immutable,
            value: undefined
        }

        variableDescriptors.get(scope)!.set(name, descriptor)

        Reflect.defineProperty(scope, name, {
            configurable: true,
            get() {
                if (descriptor.tdz) {
                    throw new ReferenceError(`${name} no defined`)
                }
                return descriptor.value
            },
            set(v) {
                if (descriptor.tdz) {
                    throw new ReferenceError(`${name} no defined`)
                }
                if (descriptor.immutable) {
                    throw new ReferenceError(`${name} is a constant`)
                }
                descriptor.value = v
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
        return variableDescriptors.get(scope)?.get(name)
    }

    type FunctionDescriptor = {
        name: string,
        type: ts.SyntaxKind,
        offset: number,
        scopes: Scope[]
    }

    const functionDescriptors = new WeakMap<any, FunctionDescriptor>()

    const defineFunction = (scopes: Scope[], name: string, type: ts.SyntaxKind, offset: number) => {
        // TODO: types
        const scopeClone = [...scopes]

        const des: FunctionDescriptor = {
            name,
            type,
            offset,
            scopes: scopeClone
        }

        const fn = function (this: any, ...args: any[]) {
            return run(program, textData, offset, scopeClone, this, args)
        }

        functionDescriptors.set(fn, des)

        return fn
    }

    const getValue = (ctx: any, name: string) => {
        if (!environments.has(ctx)) {
            return ctx[name]
        } else {
            for (let i = ctx.scopes.length - 1; i >= 0; i--) {
                if (Reflect.has(ctx.scopes[i], name)) {
                    return ctx.scopes[i][name]
                }
            }

            throw new ReferenceError(`Non exist variable ${name}`)
        }
    }

    while (ptr >= 0 && ptr < program.length) {
        const command: OpCode = read()
        const currentFrame = getCurrentFrame()
        switch (command) {
            case OpCode.Literal: {
                const value = read()
                if (isSmallNumber(value)) {
                    currentFrame.valueStack.push(value)
                } else {
                    currentFrame.valueStack.push(textData[value ^ TEXT_DADA_MASK])
                }
            }
                break;
            case OpCode.Pop:
                currentFrame.valueStack.pop()
                break
            case OpCode.GetRecord:
                currentFrame.valueStack.push(currentFrame)
                break
            case OpCode.NullLiteral:
                currentFrame.valueStack.push(null)
                break
            case OpCode.UndefinedLiteral:
                currentFrame.valueStack.push(undefined)
                break
            case OpCode.Set: {
                const value = currentFrame.valueStack.pop()
                const name = currentFrame.valueStack.pop()
                const ctx = currentFrame.valueStack.pop()

                if (!environments.has(ctx)) {
                    ctx[name] = value
                } else {
                    let hit = false

                    for (let i = currentFrame.scopes.length - 1; i >= 0; i--) {
                        if (Reflect.has(currentFrame.scopes[i], name)) {
                            hit = true
                            currentFrame.scopes[i][name] = value
                            break
                        }
                    }

                    if (!hit) {
                        throw new ReferenceError(`Non exist variable ${name}`)
                    }
                }

                currentFrame.valueStack.push(value)
            }
                break;
            case OpCode.Get: {
                const name = currentFrame.valueStack.pop()
                const ctx = currentFrame.valueStack.pop()

                currentFrame.valueStack.push(getValue(ctx, name))
            }
                break;
            case OpCode.Jump: {
                const pos = currentFrame.valueStack.pop()
                ptr = pos
            }
                break;
            case OpCode.JumpIfNot: {
                const value = currentFrame.valueStack.pop()
                const pos = currentFrame.valueStack.pop()
                if (!value) {
                    ptr = pos
                }
            }
                break
            case OpCode.EnterFunction: {
                // TODO: arguments and this/self reference
                const functionType = currentFrame.valueStack.pop()
                const variableCount: number = currentFrame.valueStack.pop()
                const variables: VariableRecord[] = []
                for (let i = 0; i < variableCount; i++) {
                    variables.push({
                        type: currentFrame.valueStack.pop(),
                        name: currentFrame.valueStack.pop()
                    })
                }
                const argumentNameCount: number = currentFrame.valueStack.pop()
                const argumentNames: string[] = []
                for (let i = 0; i < argumentNameCount; i++) {
                    argumentNames.push(currentFrame.valueStack.pop())
                }
                const parameterCount: number = currentFrame.valueStack.pop()
                const parameters: any[] = []
                for (let i = 0; i < parameterCount; i++) {
                    parameters.unshift(currentFrame.valueStack.pop())
                }

                // TODO: arguments and this/self reference
                const self = currentFrame.valueStack.pop()

                const scope: Scope = {}
                currentFrame.scopes.push(scope)

                for (let v of variables) {
                    defineVariable(scope, v.name, v.type)
                }

                for (let [index, name] of argumentNames.entries()) {
                    scope[name] = parameters[index]
                }
            }
                break
            case OpCode.EnterScope: {
                const variableCount: number = currentFrame.valueStack.pop()
                const variables: VariableRecord[] = []
                for (let i = 0; i < variableCount; i++) {
                    variables.push({
                        type: currentFrame.valueStack.pop(),
                        name: currentFrame.valueStack.pop()
                    })
                }

                const scope: Scope = {}
                currentFrame.scopes.push(scope)

                for (let v of variables) {
                    defineVariable(scope, v.name, v.type)
                }
            }
                break
            case OpCode.LeaveScope: {
                currentFrame.scopes.pop()
            }
                break
            case OpCode.DeTDZ: {
                const env = peak(currentFrame.valueStack, 2)
                const name = peak(currentFrame.valueStack)
                getVariableDescriptor(peak(env.scopes), name)!.tdz = false
            }
                break
            case OpCode.FreezeVariable: {
                const env = peak(currentFrame.valueStack, 2)
                const name = peak(currentFrame.valueStack)
                getVariableDescriptor(peak(env.scopes), name)!.immutable = true
            }
                break
            case OpCode.DefineFunction: {
                const type = currentFrame.valueStack.pop()
                const offset = currentFrame.valueStack.pop()
                const name = currentFrame.valueStack.pop()
                currentFrame.valueStack.push(defineFunction(currentFrame.scopes, name, type, offset))
            }
                break
            case OpCode.Call: {
                const parameterCount: number = currentFrame.valueStack.pop()
                const parameters: any[] = []
                for (let i = 0; i < parameterCount; i++) {
                    parameters.unshift(currentFrame.valueStack.pop())
                }

                const name = currentFrame.valueStack.pop()
                const envOrRecord = currentFrame.valueStack.pop()

                let fn = getValue(envOrRecord, name)

                let self = undefined

                if (!environments.has(envOrRecord)) {
                    self = envOrRecord
                }

                if (!functionDescriptors.has(fn)) {
                    // extern
                    currentFrame.valueStack.push(Reflect.apply(fn, self, parameters))
                } else {
                    const des = functionDescriptors.get(fn)!
                    const newFrame: Frame = {
                        type: FrameType.Function,
                        scopes: [...des.scopes],
                        return: ptr,
                        valueStack: [
                            self,
                            ...parameters,
                            parameters.length
                        ]
                    }
                    environments.add(newFrame)
                    
                    stack.push(newFrame)
                    ptr = des.offset
                }
            }
                break
            case OpCode.Return: {
                const result = currentFrame.valueStack.pop()
                if (currentFrame.valueStack.length > 0) {
                    throw new Error('bad return')
                }

                // remove all try frames
                while (peak(stack).type !== FrameType.Function) {
                    stack.pop()
                }
                
                const returnAddr = (peak(stack) as FunctionFrame).return

                if (returnAddr < 0) {
                    // leave the whole function
                    return result
                }

                stack.pop()

                peak(stack).valueStack.push(result)
                ptr = returnAddr
            }
                break
            case OpCode.ReturnBare: {
                if (currentFrame.valueStack.length > 0) {
                    throw new Error('bad return')
                }

                // remove all try frames
                while (peak(stack).type !== FrameType.Function) {
                    stack.pop()
                }
                
                const returnAddr = (peak(stack) as FunctionFrame).return

                if (returnAddr < 0) {
                    // leave the whole function
                    return undefined
                }

                stack.pop()

                peak(stack).valueStack.push(undefined)
                ptr = returnAddr
            }
                break
            case OpCode.NodeFunctionType:
            case OpCode.NodeOffset:
            case OpCode.Nop:
                break
            default:
                const nothing: never = command
                throw new Error('Unknown Op')
        }
    }
}