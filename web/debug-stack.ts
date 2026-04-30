import { Fields, FrameType } from '../src/runtime'
import type { Frame, Stack } from '../src/runtime'

type FunctionDebugFrame = Frame & {
    [Fields.type]: FrameType.Function
    [Fields.return]: number
    [Fields.function]: unknown
    [Fields.name]: string
}

export type LogicalDebugFrame = {
    functionFrame: FunctionDebugFrame
    scopeFrame: Frame
    functionStackIndex: number
    scopeStackIndex: number
    parkedPtr: number | undefined
    functionName: string
    active: boolean
    selectable: boolean
}

export type DebugFrameSourcePointer = {
    programSection: number[]
    ptr: number
}

const isFunctionFrame = (frame: Frame): frame is FunctionDebugFrame =>
    frame[Fields.type] === FrameType.Function

const getCallInstructionPtr = (frame: FunctionDebugFrame): number | undefined => {
    const returnPtr = frame[Fields.return]
    return returnPtr > 0 ? returnPtr - 1 : undefined
}

const getFunctionFrameName = (frame: FunctionDebugFrame): string => {
    const storedName = frame[Fields.name]
    if (storedName) {
        return storedName
    }
    const fn = frame[Fields.function]
    return typeof fn === 'function' ? fn.name : ''
}

export const resolveDebugFrameIndex = (
    frames: readonly LogicalDebugFrame[],
    selectedFrameIndex: number | null
): number => {
    if (frames.length === 0) {
        return -1
    }
    if (
        selectedFrameIndex != null
        && selectedFrameIndex >= 0
        && selectedFrameIndex < frames.length
        && frames[selectedFrameIndex].selectable
    ) {
        return selectedFrameIndex
    }

    return frames.findIndex(frame => frame.selectable)
}

export const getLogicalDebugFrames = (
    stack: Stack,
    disabledProgramSections: ReadonlySet<number[]> = new Set()
): LogicalDebugFrame[] => {
    const oldestFirst: Omit<LogicalDebugFrame, 'parkedPtr' | 'functionName' | 'active' | 'selectable'>[] = []
    let current: Omit<LogicalDebugFrame, 'parkedPtr' | 'functionName' | 'active' | 'selectable'> | null = null

    for (let index = 0; index < stack.length; index++) {
        const frame = stack[index]
        if (isFunctionFrame(frame)) {
            current = {
                functionFrame: frame,
                scopeFrame: frame,
                functionStackIndex: index,
                scopeStackIndex: index,
            }
            oldestFirst.push(current)
        } else if (current) {
            current.scopeFrame = frame
            current.scopeStackIndex = index
        }
    }

    const withDebugInfo = oldestFirst.map((frame, index) => ({
        ...frame,
        active: index === oldestFirst.length - 1,
        selectable: !disabledProgramSections.has(frame.functionFrame[Fields.programSection]),
        functionName: getFunctionFrameName(frame.functionFrame),
        parkedPtr: index === oldestFirst.length - 1
            ? undefined
            : getCallInstructionPtr(oldestFirst[index + 1].functionFrame),
    }))
    return withDebugInfo.reverse()
}

export const getSelectedDebugFrameSourcePointer = (
    stack: Stack,
    selectedFrameIndex: number | null,
    currentPtr: number,
    disabledProgramSections: ReadonlySet<number[]> = new Set()
): DebugFrameSourcePointer | undefined => {
    const frames = getLogicalDebugFrames(stack, disabledProgramSections)
    const index = resolveDebugFrameIndex(frames, selectedFrameIndex)
    if (index < 0) {
        return undefined
    }

    const frame = frames[index]
    const ptr = frame.active ? currentPtr : frame.parkedPtr
    if (ptr == null || ptr < 0) {
        return undefined
    }

    return {
        programSection: frame.scopeFrame[Fields.programSection],
        ptr,
    }
}
