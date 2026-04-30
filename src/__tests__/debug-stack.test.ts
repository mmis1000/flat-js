import { compile } from '../compiler'
import { Fields, getExecution, getScopeDebugEntries, getScopeDebugPtr, run } from '../runtime'
import { getLogicalDebugFrames, getSelectedDebugFrameSourcePointer } from '../../web/debug-stack'

type SourceRange = [number, number, number, number]

function readRange(source: string, [r1, c1, r2, c2]: SourceRange): string {
    const lines = source.split('\n')
    if (r1 === r2) {
        return lines[r1].slice(c1, c2)
    }

    return [
        lines[r1].slice(c1),
        ...lines.slice(r1 + 1, r2),
        lines[r2].slice(0, c2),
    ].join('\n')
}

test('logical debug frames fold try scopes into caller frame and expose parked source', () => {
    const source = `
function callee(value) {
    debugger
    return value
}
function caller(seed) {
    const functionLocal = seed + 1
    try {
        {
            const blockLocal = functionLocal + 1
            return callee(blockLocal)
        }
    } catch (err) {
        return err
    }
}
caller(4)
`

    const [program, info] = compile(source, { range: true })
    let reachedDebugger = false
    let debuggerPtr: number | undefined
    let execution: ReturnType<typeof getExecution>
    execution = getExecution(program, 0, globalThis, [], undefined, [], () => (ptr?: number) => {
        reachedDebugger = true
        debuggerPtr = ptr
    }, compile)

    while (!reachedDebugger) {
        const result = execution[Fields.step](true)
        if (result[Fields.done]) {
            throw new Error('debugger statement was not reached')
        }
    }

    const frames = getLogicalDebugFrames(execution[Fields.stack])
    expect(frames.length).toBeGreaterThanOrEqual(3)

    const current = frames[0]
    expect(current.functionName).toBe('callee')
    expect(debuggerPtr).toBeDefined()
    expect(readRange(source, info.sourceMap[debuggerPtr!])).toContain('debugger')
    expect(getSelectedDebugFrameSourcePointer(
        execution[Fields.stack],
        null,
        debuggerPtr!
    )).toEqual({
        programSection: current.scopeFrame[Fields.programSection],
        ptr: debuggerPtr,
    })

    const caller = frames[1]
    expect(caller.functionName).toBe('caller')
    const callerNames = caller.scopeFrame[Fields.scopes].flatMap((scope) =>
        getScopeDebugEntries(scope, info.scopeDebugMap.get(getScopeDebugPtr(scope)!) ?? [])
            .map(([name]) => name)
    )

    expect(callerNames).toEqual(expect.arrayContaining([
        'seed',
        'functionLocal',
        'blockLocal',
    ]))

    const callerPointer = getSelectedDebugFrameSourcePointer(
        execution[Fields.stack],
        1,
        execution[Fields.ptr]
    )

    expect(callerPointer).toBeDefined()
    expect(callerPointer!.programSection).toBe(program)
    expect(callerPointer!.ptr).toBe(frames[0].functionFrame[Fields.return] - 1)
    expect(readRange(source, info.sourceMap[callerPointer!.ptr])).toContain('callee(blockLocal)')
})

test('logical debug frames show injected polyfill frames without allowing selection', () => {
    const polyfillSource = `
function vmArrayForEach(callback) {
    callback(1)
}
vmArrayForEach
`
    const [polyfillProgram] = compile(polyfillSource, { range: true, evalMode: true })
    const polyfillFn = run(polyfillProgram, 0, globalThis, [{}], undefined, [], compile) as Function

    const source = `
function caller() {
    [1].forEach(function userCallback(value) {
        debugger
        return value
    })
}
caller()
`
    const [program, info] = compile(source, { range: true })
    const redirects = new WeakMap<Function, Function>([
        [Array.prototype.forEach, polyfillFn],
    ])
    let reachedDebugger = false
    let debuggerPtr: number | undefined
    let execution: ReturnType<typeof getExecution>
    execution = getExecution(program, 0, globalThis, [], undefined, [], () => (ptr?: number) => {
        reachedDebugger = true
        debuggerPtr = ptr
    }, compile, redirects)

    while (!reachedDebugger) {
        const result = execution[Fields.step](true)
        if (result[Fields.done]) {
            throw new Error('debugger statement was not reached')
        }
    }

    const disabledProgramSections = new Set([polyfillProgram])
    const frames = getLogicalDebugFrames(execution[Fields.stack], disabledProgramSections)
    expect(frames[0].functionName).toBe('userCallback')
    expect(frames[0].selectable).toBe(true)
    expect(frames[1].functionName).toBe('vmArrayForEach')
    expect(frames[1].selectable).toBe(false)
    expect(frames[2].functionName).toBe('caller')
    expect(frames[2].selectable).toBe(true)

    expect(getSelectedDebugFrameSourcePointer(
        execution[Fields.stack],
        null,
        debuggerPtr!,
        disabledProgramSections
    )).toEqual({
        programSection: frames[0].scopeFrame[Fields.programSection],
        ptr: debuggerPtr,
    })

    const callerPointer = getSelectedDebugFrameSourcePointer(
        execution[Fields.stack],
        2,
        execution[Fields.ptr],
        disabledProgramSections
    )

    expect(callerPointer).toBeDefined()
    expect(callerPointer!.programSection).toBe(program)
    expect(readRange(source, info.sourceMap[callerPointer!.ptr])).toContain('.forEach')

    expect(getSelectedDebugFrameSourcePointer(
        execution[Fields.stack],
        1,
        execution[Fields.ptr],
        disabledProgramSections
    )).toEqual({
        programSection: frames[0].scopeFrame[Fields.programSection],
        ptr: execution[Fields.ptr],
    })
})
