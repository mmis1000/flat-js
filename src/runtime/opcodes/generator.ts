import { OpCode } from "../../compiler"
import {
    Fields,
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

            state.ptr = ctx[OpcodeContextField.ptr]
            state.blockSeed = ctx[OpcodeContextField.blockSeed]

            let genStart = ctx[OpcodeContextField.stack].length
            while (genStart > 0 && ctx[OpcodeContextField.stack][genStart - 1][Fields.generator] === state) {
                genStart--
            }
            const genFrames = ctx[OpcodeContextField.stack].splice(genStart)
            state.stack = genFrames

            if (ctx[OpcodeContextField.stack].length > 0) {
                ctx[OpcodeContextField.ptr] = (genFrames[0] as any)[Fields.return]
                ctx[OpcodeContextField.blockSeed] = (genFrames[0] as any)[Fields.savedSeed]
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
            if (state && state.pendingAction) {
                const action = state.pendingAction
                state.pendingAction = null
                ctx[OpcodeContextField.popCurrentFrameStack]()
                if (action.type === 'throw') {
                    throw action.value
                }
                ctx[OpcodeContextField.executeReturn](action.value)
                return BREAK_COMMAND
            }
            break
        }
        case OpCode.YieldStar: {
            const frame = ctx[OpcodeContextField.currentFrame] as any
            const outerState = frame[Fields.generator] as GeneratorState | undefined
            let delegate = frame[Fields.delegate] as { iter: any, phase: number, pendingMode?: 'next' | 'throw' | 'return' } | undefined

            const relayYield = (value: any): OpcodeHandlerResult => {
                if (!outerState) {
                    ctx[OpcodeContextField.ptr] = ctx[OpcodeContextField.commandPtr]
                    return {
                        [Fields.done]: false,
                        [Fields.yield]: true as const,
                        [Fields.value]: value,
                    }
                }

                outerState.ptr = ctx[OpcodeContextField.commandPtr]
                outerState.blockSeed = ctx[OpcodeContextField.blockSeed]
                let genStart = ctx[OpcodeContextField.stack].length
                while (genStart > 0 && ctx[OpcodeContextField.stack][genStart - 1][Fields.generator] === outerState) {
                    genStart--
                }
                const genFrames = ctx[OpcodeContextField.stack].splice(genStart)
                outerState.stack = genFrames
                if (ctx[OpcodeContextField.stack].length > 0) {
                    ctx[OpcodeContextField.ptr] = (genFrames[0] as any)[Fields.return]
                    ctx[OpcodeContextField.blockSeed] = (genFrames[0] as any)[Fields.savedSeed]
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

            if (delegate && delegate.phase === 1) {
                const subResult = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
                if (subResult && subResult.done) {
                    const lastMode = delegate.pendingMode
                    frame[Fields.delegate] = null
                    if (lastMode === 'return') {
                        ctx[OpcodeContextField.executeReturn](subResult.value)
                        return BREAK_COMMAND
                    }
                    ctx[OpcodeContextField.pushCurrentFrameStack](subResult.value)
                    return BREAK_COMMAND
                }
                delegate.phase = 2
                return relayYield(subResult.value)
            }

            let iter: any
            let sentVal: any
            let mode: 'next' | 'throw' | 'return' = 'next'

            if (!delegate) {
                const iterable = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
                iter = getIterator(iterable)
                delegate = { iter, phase: 0 }
                frame[Fields.delegate] = delegate
                sentVal = undefined
            } else {
                iter = delegate.iter
                sentVal = ctx[OpcodeContextField.popCurrentFrameStack]()
                if (outerState && outerState.pendingAction) {
                    mode = outerState.pendingAction.type
                    sentVal = outerState.pendingAction.value
                    outerState.pendingAction = null
                }
            }

            const methodFn = mode === 'next' ? iter.next : mode === 'throw' ? iter.throw : iter.return
            const subState = methodFn ? generatorStates.get(methodFn) : undefined

            if (subState) {
                if (subState.completed) {
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

                if (!subState.started) {
                    if (mode === 'throw') {
                        subState.completed = true
                        subState.stack = []
                        frame[Fields.delegate] = null
                        throw sentVal
                    }
                    if (mode === 'return') {
                        subState.completed = true
                        subState.stack = []
                        frame[Fields.delegate] = null
                        ctx[OpcodeContextField.executeReturn](sentVal)
                        return BREAK_COMMAND
                    }
                }

                if (mode === 'throw') {
                    subState.pendingAction = { type: 'throw', value: sentVal }
                } else if (mode === 'return') {
                    subState.pendingAction = { type: 'return', value: sentVal }
                } else {
                    subState.pendingAction = null
                }

                const wasStarted = subState.started
                subState.started = true

                ;(subState.stack[0] as any)[Fields.return] = ctx[OpcodeContextField.commandPtr]
                ;(subState.stack[0] as any)[Fields.savedSeed] = ctx[OpcodeContextField.blockSeed]
                ctx[OpcodeContextField.stack].push(...subState.stack)
                subState.stack = []

                if (wasStarted) {
                    ctx[OpcodeContextField.peak](ctx[OpcodeContextField.stack])[Fields.valueStack].push(sentVal)
                }

                delegate.phase = 1
                delegate.pendingMode = mode
                ctx[OpcodeContextField.ptr] = subState.ptr
                ctx[OpcodeContextField.blockSeed] = subState.blockSeed
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

            delegate.phase = 2
            return relayYield(result.value)
        }
    }
}
