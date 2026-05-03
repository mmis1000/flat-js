import { OpCode } from "../../compiler"
import {
    Fields,
    FrameType,
    GeneratorDelegateState,
    GeneratorState,
    assertIteratorResult,
    generatorStates,
    iteratorComplete,
} from "../shared"
import { BREAK_COMMAND, OpcodeContextField, type OpcodeHandlerResult, type RuntimeOpcodeContext } from "./types"

const DELEGATE_ASYNC_FROM_SYNC = Symbol('delegate.asyncFromSync')
const DELEGATE_AWAIT_DONE = Symbol('delegate.awaitDone')
const DELEGATE_NEXT_METHOD = Symbol('delegate.nextMethod')
const ASYNC_YIELD_RESUME_AWAIT_RETURN = Symbol('asyncYieldResume.awaitReturn')

export const handleGeneratorOpcode = (command: OpCode, ctx: RuntimeOpcodeContext): OpcodeHandlerResult => {
    const isAsyncGeneratorObject = (value: any): boolean =>
        value != null && Object.prototype.hasOwnProperty.call(value, Symbol.asyncIterator)

    const completeReturn = (value: unknown): OpcodeHandlerResult => {
        if (ctx[OpcodeContextField.currentFrame][Fields.type] === FrameType.Try) {
            ctx[OpcodeContextField.pushCurrentFrameStack](value)
            ctx[OpcodeContextField.initiateReturn]()
            return BREAK_COMMAND
        }
        ctx[OpcodeContextField.executeReturn](value)
        return BREAK_COMMAND
    }

    const isAsyncGeneratorState = (state: GeneratorState | undefined): boolean =>
        !!state && isAsyncGeneratorObject(state[Fields.gen])

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
            if (state && (state as any)[ASYNC_YIELD_RESUME_AWAIT_RETURN]) {
                ;(state as any)[ASYNC_YIELD_RESUME_AWAIT_RETURN] = false
                return completeReturn(ctx[OpcodeContextField.popCurrentFrameStack]())
            }

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

                if (isAsyncGeneratorState(state)) {
                    ;(state as any)[ASYNC_YIELD_RESUME_AWAIT_RETURN] = true
                    ctx[OpcodeContextField.ptr] = ctx[OpcodeContextField.commandPtr]
                    return {
                        [Fields.done]: false,
                        [Fields.await]: true as const,
                        [Fields.value]: action[Fields.value],
                    }
                }

                return completeReturn(action[Fields.value])
            }
            break
        }
        case OpCode.YieldStar: {
            const frame = ctx[OpcodeContextField.currentFrame] as any
            const outerState = frame[Fields.generator] as GeneratorState | undefined
            let delegate = frame[Fields.delegate] as GeneratorDelegateState | undefined
            const isAsyncOuter = isAsyncGeneratorState(outerState)

            const relayYield = (value: any, awaitValue = true, rawResult = false): OpcodeHandlerResult => {
                if (!outerState) {
                    ctx[OpcodeContextField.ptr] = ctx[OpcodeContextField.commandPtr]
                    const result = {
                        [Fields.done]: false as const,
                        [Fields.yield]: true as const,
                        [Fields.value]: value,
                    }
                    if (!awaitValue || rawResult) {
                        ;(result as any)[Fields.delegate] = delegate?.[Fields.delegateIterator]
                    }
                    return result
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
                    callerFrame[Fields.valueStack].push(rawResult ? value : { value, done: false })
                    return { [Fields.done]: false }
                }

                const result = {
                    [Fields.done]: false as const,
                    [Fields.yield]: true as const,
                    [Fields.value]: value,
                }
                if (!awaitValue || rawResult) {
                    ;(result as any)[Fields.delegate] = delegate?.[Fields.delegateIterator]
                }
                return result
            }

            const awaitDelegated = (value: any, phase: number): OpcodeHandlerResult => {
                if (delegate) {
                    delegate[Fields.delegatePhase] = phase
                }
                ctx[OpcodeContextField.ptr] = ctx[OpcodeContextField.commandPtr]
                return {
                    [Fields.done]: false,
                    [Fields.await]: true as const,
                    [Fields.value]: value,
                }
            }

            const getAsyncIterator = (iterable: any) => {
                if (iterable == null) {
                    throw new TypeError('Cannot convert undefined or null to object')
                }

                const asyncMethod = iterable[Symbol.asyncIterator]
                if (asyncMethod != null) {
                    if (typeof asyncMethod !== 'function') {
                        throw new TypeError('async iterator method must be callable')
                    }
                    const iterator = asyncMethod.call(iterable)
                    if (iterator == null || typeof iterator !== 'object') {
                        throw new TypeError('async iterator must be an object')
                    }
                    const next = iterator.next
                    if (typeof next !== 'function') {
                        throw new TypeError('iterator must have next method')
                    }
                    return { iterator, next, asyncFromSync: false }
                }

                const syncMethod = iterable[Symbol.iterator]
                if (typeof syncMethod !== 'function') {
                    throw new TypeError('object is not iterable')
                }
                const iterator = syncMethod.call(iterable)
                if (iterator == null || typeof iterator !== 'object') {
                    throw new TypeError('iterator must be an object')
                }
                const next = iterator.next
                if (typeof next !== 'function') {
                    throw new TypeError('iterator must have next method')
                }
                return { iterator, next, asyncFromSync: true }
            }

            const toObjectForIteratorLookup = (value: any) => {
                if (value == null || (typeof value === 'object' || typeof value === 'function')) {
                    return value
                }
                const objectCtor = frame[Fields.globalThis]?.Object ?? Object
                return Reflect.apply(objectCtor, undefined, [value])
            }

            const getSyncIteratorRecord = (iterable: any) => {
                if (iterable == null) {
                    throw new TypeError('Cannot convert undefined or null to object')
                }
                const object = toObjectForIteratorLookup(iterable)
                const method = object[Symbol.iterator]
                if (typeof method !== 'function') {
                    throw new TypeError('object is not iterable')
                }
                const iterator = method.call(object)
                if (iterator == null || typeof iterator !== 'object') {
                    throw new TypeError('iterator must be an object')
                }
                const next = iterator.next
                if (typeof next !== 'function') {
                    throw new TypeError('iterator must have next method')
                }
                return { iterator, next }
            }

            const completeAsyncDelegateValue = (value: any): OpcodeHandlerResult => {
                const done = !!(delegate as any)[DELEGATE_AWAIT_DONE]
                const lastMode = delegate?.[Fields.delegateMode]
                if (done) {
                    frame[Fields.delegate] = null
                    if (lastMode === 'return') {
                        return completeReturn(value)
                    }
                    ctx[OpcodeContextField.pushCurrentFrameStack](value)
                    return BREAK_COMMAND
                }

                if (delegate) {
                    delegate[Fields.delegatePhase] = 2
                }
                return relayYield(value)
            }

            const processAsyncDelegateResult = (innerResult: any): OpcodeHandlerResult => {
                const result = assertIteratorResult(innerResult) as { done?: unknown, value?: unknown }
                const done = iteratorComplete(result)
                const value = result.value
                const lastMode = delegate?.[Fields.delegateMode]

                if ((delegate as any)[DELEGATE_ASYNC_FROM_SYNC]) {
                    ;(delegate as any)[DELEGATE_AWAIT_DONE] = done
                    return awaitDelegated(value, 4)
                }

                if (done) {
                    frame[Fields.delegate] = null
                    if (lastMode === 'return') {
                        return completeReturn(value)
                    }
                    ctx[OpcodeContextField.pushCurrentFrameStack](value)
                    return BREAK_COMMAND
                }

                if (delegate) {
                    delegate[Fields.delegatePhase] = 2
                }
                return relayYield(value, false)
            }

            if (isAsyncOuter) {
                if (delegate && delegate[Fields.delegatePhase] === 3) {
                    return processAsyncDelegateResult(ctx[OpcodeContextField.popCurrentFrameStack]())
                }

                if (delegate && delegate[Fields.delegatePhase] === 4) {
                    return completeAsyncDelegateValue(ctx[OpcodeContextField.popCurrentFrameStack]())
                }

                if (delegate && delegate[Fields.delegatePhase] === 6) {
                    assertIteratorResult(ctx[OpcodeContextField.popCurrentFrameStack]())
                    frame[Fields.delegate] = null
                    throw new TypeError('iterator throw method missing')
                }

                if (delegate && delegate[Fields.delegatePhase] === 7) {
                    frame[Fields.delegate] = null
                    return completeReturn(ctx[OpcodeContextField.popCurrentFrameStack]())
                }

                let iter: any
                let sentVal: any
                let mode: 'next' | 'throw' | 'return' = 'next'

                if (delegate && delegate[Fields.delegatePhase] === 5) {
                    iter = delegate[Fields.delegateIterator]
                    sentVal = ctx[OpcodeContextField.popCurrentFrameStack]()
                    mode = 'return'
                } else if (!delegate) {
                    const iterable = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
                    const iteratorRecord = getAsyncIterator(iterable)
                    iter = iteratorRecord.iterator
                    delegate = { [Fields.delegateIterator]: iter, [Fields.delegatePhase]: 0 }
                    ;(delegate as any)[DELEGATE_NEXT_METHOD] = iteratorRecord.next
                    if (iteratorRecord.asyncFromSync) {
                        ;(delegate as any)[DELEGATE_ASYNC_FROM_SYNC] = true
                    }
                    frame[Fields.delegate] = delegate
                    sentVal = undefined
                } else {
                    iter = delegate[Fields.delegateIterator]
                    sentVal = ctx[OpcodeContextField.popCurrentFrameStack]()
                    if (outerState && outerState[Fields.pendingAction]) {
                        mode = outerState[Fields.pendingAction]![Fields.type]
                        sentVal = outerState[Fields.pendingAction]![Fields.value]
                        outerState[Fields.pendingAction] = null
                        if (mode === 'return') {
                            delegate[Fields.delegateMode] = mode
                            return awaitDelegated(sentVal, 5)
                        }
                    }
                }

                const methodFn = mode === 'next' ? (delegate as any)[DELEGATE_NEXT_METHOD] : mode === 'throw' ? iter.throw : iter.return
                if (methodFn == null) {
                    if (mode === 'throw') {
                        const returnMethod = iter.return
                        if (returnMethod == null) {
                            frame[Fields.delegate] = null
                            throw new TypeError('iterator throw method missing')
                        }
                        if (typeof returnMethod !== 'function') {
                            throw new TypeError('iterator return method must be callable')
                        }
                        return awaitDelegated(returnMethod.call(iter), 6)
                    }
                    if (mode === 'return') {
                        return awaitDelegated(sentVal, 7)
                    }
                    frame[Fields.delegate] = null
                    throw new TypeError('iterator must have next method')
                }
                if (typeof methodFn !== 'function') {
                    throw new TypeError('iterator method must be callable')
                }

                delegate[Fields.delegateMode] = mode
                if ((delegate as any)[DELEGATE_ASYNC_FROM_SYNC]) {
                    return processAsyncDelegateResult(
                        methodFn.call(iter, sentVal)
                    )
                }
                return awaitDelegated(
                    methodFn.call(iter, sentVal),
                    3
                )
            }

            if (delegate && delegate[Fields.delegatePhase] === 1) {
                const subResult = ctx[OpcodeContextField.popCurrentFrameStack]<any>()
                if (subResult && subResult.done) {
                    const lastMode = delegate[Fields.delegateMode]
                    frame[Fields.delegate] = null
                    if (lastMode === 'return') {
                        return completeReturn(subResult.value)
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
                const iteratorRecord = getSyncIteratorRecord(iterable)
                iter = iteratorRecord.iterator
                delegate = { [Fields.delegateIterator]: iter, [Fields.delegatePhase]: 0 }
                ;(delegate as any)[DELEGATE_NEXT_METHOD] = iteratorRecord.next
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

            const getMethod = (name: 'throw' | 'return') => {
                const method = iter[name]
                if (method == null) {
                    return undefined
                }
                if (typeof method !== 'function') {
                    throw new TypeError(`iterator ${name} method must be callable`)
                }
                return method
            }

            const methodFn = mode === 'next'
                ? (delegate as any)[DELEGATE_NEXT_METHOD]
                : mode === 'throw'
                    ? getMethod('throw')
                    : getMethod('return')
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
                if (!methodFn) {
                    const returnMethod = getMethod('return')
                    if (returnMethod) {
                        assertIteratorResult(returnMethod.call(iter))
                    }
                    frame[Fields.delegate] = null
                    throw new TypeError('iterator throw method missing')
                }
                result = assertIteratorResult(methodFn.call(iter, sentVal))
            } else if (mode === 'return') {
                if (!methodFn) {
                    frame[Fields.delegate] = null
                    ctx[OpcodeContextField.executeReturn](sentVal)
                    return BREAK_COMMAND
                }
                result = assertIteratorResult(methodFn.call(iter, sentVal))
                if (iteratorComplete(result)) {
                    frame[Fields.delegate] = null
                    ctx[OpcodeContextField.executeReturn](result.value)
                    return BREAK_COMMAND
                }
            } else {
                result = assertIteratorResult(methodFn.call(iter, sentVal))
            }

            if (iteratorComplete(result)) {
                frame[Fields.delegate] = null
                ctx[OpcodeContextField.pushCurrentFrameStack](result.value)
                return BREAK_COMMAND
            }

            delegate[Fields.delegatePhase] = 2
            return relayYield(result, true, true)
        }
    }
}
