import { OpCode } from "../../compiler"
import {
    Fields,
    FrameType,
    GeneratorDelegateState,
    GeneratorState,
    assertIteratorResult,
    generatorStates,
    getIterator,
    iteratorComplete,
    iteratorNext,
} from "../shared"
import { BREAK_COMMAND, OpcodeContextField, type OpcodeHandlerResult, type RuntimeOpcodeContext } from "./types"

export const handleGeneratorOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): OpcodeHandlerResult => {
    switch (command) {
        case OpCode.Yield: {
            const value = ctx[OpcodeContextField.popCurrentFrameStack]()
            const state = ctx[OpcodeContextField.currentFrame][Fields.generator] as GeneratorState | undefined
            if (!state) {
                throw new Error('yield outside of generator')
            }

            state[Fields.ptr] = ctx[OpcodeContextField.ptr]

            let genStart = ctx[OpcodeContextField.stack].length
            while (genStart > 0 && ctx[OpcodeContextField.stack][genStart - 1][Fields.generator] === state) {
                genStart--
            }
            const genFrames = ctx[OpcodeContextField.stack].splice(genStart)
            state[Fields.stack] = genFrames

            if (ctx[OpcodeContextField.stack].length > 0) {
                ctx[OpcodeContextField.ptr] = (genFrames[0] as any)[Fields.return]
                const callerFrame = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])
                ctx[OpcodeContextField.currentProgram] = callerFrame[Fields.programSection]
                callerFrame[Fields.valueStack].push({ value, done: false })
                return { [Fields.done]: false }
            }

            return {
                [Fields.done]: false,
                [Fields.yield]: true as const,
                [Fields.value]: value,
            }
        }
        case OpCode.YieldResume: {
            const state = ctx[OpcodeContextField.currentFrame][Fields.generator] as GeneratorState | undefined
            if (state && state[Fields.pendingAction]) {
                const action = state[Fields.pendingAction]
                state[Fields.pendingAction] = null
                if (action[Fields.type] === 'throw') {
                    if (ctx[OpcodeContextField.currentFrame][Fields.type] === FrameType.Try) {
                        ctx[OpcodeContextField.pushCurrentFrameStack](action[Fields.value])
                        ctx[OpcodeContextField.initiateThrow]()
                        return BREAK_COMMAND
                    }
                    throw action[Fields.value]
                }
                if (ctx[OpcodeContextField.currentFrame][Fields.type] === FrameType.Try) {
                    ctx[OpcodeContextField.pushCurrentFrameStack](action[Fields.value])
                    ctx[OpcodeContextField.initiateReturn]()
                    return BREAK_COMMAND
                }
                ctx[OpcodeContextField.executeReturn](action[Fields.value])
                return BREAK_COMMAND
            }
            break
        }
        case OpCode.YieldStar: {
            const frame = ctx[OpcodeContextField.currentFrame] as any
            const outerState = frame[Fields.generator] as GeneratorState | undefined
            let delegate = frame[Fields.delegate] as GeneratorDelegateState | undefined

            const relayYield = (value: any): OpcodeHandlerResult => {
                if (!outerState) {
                    ctx[OpcodeContextField.ptr] = ctx[OpcodeContextField.commandPtr]
                    return {
                        [Fields.done]: false,
                        [Fields.yield]: true as const,
                        [Fields.value]: value,
                    }
                }

                outerState[Fields.ptr] = ctx[OpcodeContextField.commandPtr]
                let genStart = ctx[OpcodeContextField.stack].length
                while (genStart > 0 && ctx[OpcodeContextField.stack][genStart - 1][Fields.generator] === outerState) {
                    genStart--
                }
                const genFrames = ctx[OpcodeContextField.stack].splice(genStart)
                outerState[Fields.stack] = genFrames
                if (ctx[OpcodeContextField.stack].length > 0) {
                    ctx[OpcodeContextField.ptr] = (genFrames[0] as any)[Fields.return]
                    const callerFrame = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])
                    ctx[OpcodeContextField.currentProgram] = callerFrame[Fields.programSection]
                    callerFrame[Fields.valueStack].push({ value, done: false })
                    return { [Fields.done]: false }
                }

                return {
                    [Fields.done]: false,
                    [Fields.yield]: true as const,
                    [Fields.value]: value,
                }
            }

            if (delegate && delegate[Fields.delegatePhase] === 1) {
                const subResult = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
                if (subResult && subResult.done) {
                    const lastMode = delegate[Fields.delegateMode]
                    frame[Fields.delegate] = null
                    if (lastMode === 'return') {
                        ctx[OpcodeContextField.executeReturn](subResult.value)
                        return BREAK_COMMAND
                    }
                    ctx[OpcodeContextField.pushCurrentFrameStack](subResult.value)
                    return BREAK_COMMAND
                }
                delegate[Fields.delegatePhase] = 2
                return relayYield(subResult.value)
            }

            let iter: any
            let sentVal: any
            let mode: 'next' | 'throw' | 'return' = 'next'

            if (!delegate) {
                const iterable = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
                iter = getIterator(iterable)
                delegate = { [Fields.delegateIterator]: iter, [Fields.delegatePhase]: 0 }
                frame[Fields.delegate] = delegate
                sentVal = undefined
            } else {
                iter = delegate[Fields.delegateIterator]
                sentVal = ctx[OpcodeContextField.popCurrentFrameStack]()
                if (outerState && outerState[Fields.pendingAction]) {
                    mode = outerState[Fields.pendingAction]![Fields.type]
                    sentVal = outerState[Fields.pendingAction]![Fields.value]
                    outerState[Fields.pendingAction] = null
                }
            }

            const methodFn = mode === 'next' ? iter.next : mode === 'throw' ? iter.throw : iter.return
            const subState = methodFn ? generatorStates.get(methodFn) : undefined

            if (subState) {
                if (subState[Fields.completed]) {
                    frame[Fields.delegate] = null
                    if (mode === 'throw') {
                        throw sentVal
                    }
                    if (mode === 'return') {
                        ctx[OpcodeContextField.executeReturn](sentVal)
                        return BREAK_COMMAND
                    }
                    ctx[OpcodeContextField.pushCurrentFrameStack](undefined)
                    return BREAK_COMMAND
                }

                if (!subState[Fields.started]) {
                    if (mode === 'throw') {
                        subState[Fields.completed] = true
                        subState[Fields.stack] = []
                        frame[Fields.delegate] = null
                        throw sentVal
                    }
                    if (mode === 'return') {
                        subState[Fields.completed] = true
                        subState[Fields.stack] = []
                        frame[Fields.delegate] = null
                        ctx[OpcodeContextField.executeReturn](sentVal)
                        return BREAK_COMMAND
                    }
                }

                if (mode === 'throw') {
                    subState[Fields.pendingAction] = { [Fields.type]: 'throw', [Fields.value]: sentVal }
                } else if (mode === 'return') {
                    subState[Fields.pendingAction] = { [Fields.type]: 'return', [Fields.value]: sentVal }
                } else {
                    subState[Fields.pendingAction] = null
                }

                const wasStarted = subState[Fields.started]
                subState[Fields.started] = true

                ;(subState[Fields.stack][0] as any)[Fields.return] = ctx[OpcodeContextField.commandPtr]
                ctx[OpcodeContextField.stack].push(...subState[Fields.stack])
                subState[Fields.stack] = []

                if (wasStarted) {
                    ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])[Fields.valueStack].push(sentVal)
                }

                delegate[Fields.delegatePhase] = 1
                delegate[Fields.delegateMode] = mode
                ctx[OpcodeContextField.ptr] = subState[Fields.ptr]
                ctx[OpcodeContextField.currentProgram] = ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])[Fields.programSection]
                return { [Fields.done]: false }
            }

            let result: { done?: unknown, value?: unknown }
            if (mode === 'throw') {
                if (!iter.throw) {
                    if (iter.return) {
                        try {
                            iter.return()
                        } catch (_) {
                            // ignore close error during delegated throw fallback
                        }
                    }
                    frame[Fields.delegate] = null
                    throw sentVal
                }
                result = assertIteratorResult(iter.throw(sentVal))
            } else if (mode === 'return') {
                if (!iter.return) {
                    frame[Fields.delegate] = null
                    ctx[OpcodeContextField.executeReturn](sentVal)
                    return BREAK_COMMAND
                }
                result = assertIteratorResult(iter.return(sentVal))
                if (iteratorComplete(result)) {
                    frame[Fields.delegate] = null
                    ctx[OpcodeContextField.executeReturn](result.value)
                    return BREAK_COMMAND
                }
            } else {
                result = iteratorNext(iter, sentVal)
            }

            if (iteratorComplete(result)) {
                frame[Fields.delegate] = null
                ctx[OpcodeContextField.pushCurrentFrameStack](result.value)
                return BREAK_COMMAND
            }

            delegate[Fields.delegatePhase] = 2
            return relayYield(result.value)
        }
    }
}
