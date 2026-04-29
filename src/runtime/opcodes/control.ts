import { InvokeType, OpCode, ResolveType, SpecialVariable, TryCatchFinallyState } from "../../compiler"
import {
    Fields,
    FrameType,
    FunctionFrame,
    GeneratorState,
    TryFrame,
    environments,
} from "../shared"
import { BREAK_COMMAND, OpcodeContextField, type OpcodeHandlerResult, type RuntimeOpcodeContext } from "./types"

export const handleControlOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): OpcodeHandlerResult => {
    switch (command) {
        case OpCode.Return: {
            const result = ctx[OpcodeContextField.popCurrentFrameStack]()
            const topResidue = ctx[OpcodeContextField.currentFrame][Fields.valueStack].length
            const topWasFunction = ctx[OpcodeContextField.currentFrame][Fields.type] === FrameType.Function

            while (ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])[Fields.type] !== FrameType.Function) {
                ctx[OpcodeContextField.stack].pop()
            }

            const functionFrame = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack]) as FunctionFrame
            const returnAddr = functionFrame[Fields.return]
            const genState = functionFrame[Fields.generator] as GeneratorState | undefined
            const isGenBase = !!(genState && genState[Fields.baseFrame] === functionFrame)

            if (topWasFunction && !functionFrame[Fields.generator] && topResidue > 0) {
                throw new Error('bad return')
            }

            if (isGenBase) {
                genState![Fields.completed] = true
                genState![Fields.stack] = []
                ctx[OpcodeContextField.stack].pop()

                if (returnAddr < 0) {
                    ctx[OpcodeContextField.returnsExternal] = true
                    ctx[OpcodeContextField.returnValue] = { value: result, done: true }
                    return BREAK_COMMAND
                }

                const prevFrame = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])
                prevFrame[Fields.valueStack].push({ value: result, done: true })
                ctx[OpcodeContextField.ptr] = returnAddr
                ctx[OpcodeContextField.currentProgram] = prevFrame[Fields.programSection]
                return BREAK_COMMAND
            }

            if (returnAddr < 0) {
                if (functionFrame[Fields.invokeType] === InvokeType.Apply) {
                    ctx[OpcodeContextField.returnsExternal] = true
                    ctx[OpcodeContextField.returnValue] = result
                    return BREAK_COMMAND
                }

                if (result !== null && (typeof result === 'function' || typeof result === 'object')) {
                    ctx[OpcodeContextField.returnsExternal] = true
                    ctx[OpcodeContextField.returnValue] = result
                    return BREAK_COMMAND
                }

                ctx[OpcodeContextField.returnsExternal] = true
                ctx[OpcodeContextField.returnValue] = ctx[OpcodeContextField.getValue](functionFrame, SpecialVariable.This)
                return BREAK_COMMAND
            }

            ctx[OpcodeContextField.stack].pop()

            const prevFrame = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])
            if (functionFrame[Fields.invokeType] === InvokeType.Apply) {
                prevFrame[Fields.valueStack].push(result)
            } else if (result !== null && (typeof result === 'function' || typeof result === 'object')) {
                prevFrame[Fields.valueStack].push(result)
            } else {
                prevFrame[Fields.valueStack].push(ctx[OpcodeContextField.getValue](functionFrame, SpecialVariable.This))
            }

            ctx[OpcodeContextField.ptr] = returnAddr
            ctx[OpcodeContextField.currentProgram] = prevFrame[Fields.programSection]
        }
            break
        case OpCode.Throw: {
            throw ctx[OpcodeContextField.popCurrentFrameStack]()
        }
        case OpCode.ThrowReferenceError: {
            const msg = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            throw new ReferenceError(msg)
        }
        case OpCode.InitTryCatch: {
            const catchName = ctx[OpcodeContextField.popCurrentFrameStack]<string>()
            const finallyAddr = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const catchAddr = ctx[OpcodeContextField.popCurrentFrameStack]<number>()
            const exitAddr = ctx[OpcodeContextField.popCurrentFrameStack]<number>()

            const frame: TryFrame = {
                [Fields.type]: FrameType.Try,
                [Fields.savedScopes]: ctx[OpcodeContextField.currentFrame][Fields.scopes],
                [Fields.scopes]: ctx[OpcodeContextField.currentFrame][Fields.scopes].slice(0),
                [Fields.valueStack]: [],
                [Fields.state]: TryCatchFinallyState.Try,
                [Fields.resolveType]: ResolveType.normal,
                [Fields.value]: undefined,
                [Fields.catch]: catchAddr,
                [Fields.finally]: finallyAddr,
                [Fields.break]: 0,
                [Fields.depth]: 0,
                [Fields.variable]: catchName,
                [Fields.exit]: exitAddr,
                [Fields.programSection]: ctx[OpcodeContextField.currentProgram],
                [Fields.globalThis]: ctx[OpcodeContextField.currentFrame][Fields.globalThis],
                [Fields.strict]: ctx[OpcodeContextField.currentFrame][Fields.strict],
                [Fields.generator]: ctx[OpcodeContextField.currentFrame][Fields.generator],
            }

            environments.add(frame)
            ctx[OpcodeContextField.stack].push(frame)
        }
            break
        case OpCode.ReturnInTryCatchFinally:
            ctx[OpcodeContextField.initiateReturn]()
            break
        case OpCode.ThrowInTryCatchFinally:
            ctx[OpcodeContextField.initiateThrow]()
            break
        case OpCode.BreakInTryCatchFinally:
            ctx[OpcodeContextField.initiateBreak]()
            break
        case OpCode.ExitTryCatchFinally: {
            const frame = ctx[OpcodeContextField.currentFrame] as TryFrame
            const prevState = frame[Fields.state]
            const prevResolveType = frame[Fields.resolveType]
            const prevValue = frame[Fields.value]
            const exit = frame[Fields.exit]
            const finallyPtr = frame[Fields.finally]

            frame[Fields.scopes] = frame[Fields.savedScopes].slice(0)

            switch (prevState) {
                case TryCatchFinallyState.Finally:
                    switch (prevResolveType) {
                        case ResolveType.normal:
                            ctx[OpcodeContextField.stack].pop()
                            ctx[OpcodeContextField.ptr] = exit
                            return BREAK_COMMAND
                        case ResolveType.throw:
                            ctx[OpcodeContextField.stack].pop()
                            ctx[OpcodeContextField.executeThrow](prevValue)
                            return BREAK_COMMAND
                        case ResolveType.return:
                            ctx[OpcodeContextField.stack].pop()
                            ctx[OpcodeContextField.executeReturn](prevValue)
                            return BREAK_COMMAND
                        case ResolveType.break:
                            ctx[OpcodeContextField.executeBreak]()
                            return BREAK_COMMAND
                    }
                    break
                case TryCatchFinallyState.Try:
                case TryCatchFinallyState.Catch:
                    if (frame[Fields.finally] >= 0) {
                        frame[Fields.state] = TryCatchFinallyState.Finally
                        frame[Fields.resolveType] = ResolveType.normal
                        frame[Fields.value] = undefined
                        ctx[OpcodeContextField.ptr] = finallyPtr
                        return BREAK_COMMAND
                    }

                    ctx[OpcodeContextField.stack].pop()
                    ctx[OpcodeContextField.ptr] = exit
                    return BREAK_COMMAND
                default:
                    {
                        const nothing: never = prevState
                        return nothing
                    }
            }
        }
        case OpCode.Debugger: {
            const debugFn = ctx[OpcodeContextField.getDebugCallback]()
            if (debugFn) {
                debugFn()
            } else {
                debugger
            }
        }
            break
        case OpCode.Await: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            return {
                [Fields.done]: false,
                [Fields.await]: true as const,
                [Fields.value]: value,
            }
        }
    }
}
