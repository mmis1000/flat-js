import { performance } from 'perf_hooks'

import { compile, DebugInfo } from '../compiler'
import { Fields, getExecution } from '../runtime'

const benchmarkTest = process.env.RUN_BENCHMARK_TESTS === '1' ? test : test.skip

const BENCHMARK_SOURCE = `
let acc = 0
let i = 0
while (i < 1000000000) {
    acc = acc + 1
    acc = acc ^ i
    acc = acc + 3
    i = i + 1
}
acc
`

function sameSourceMapPos(
    a: [number, number, number, number] | undefined,
    b: [number, number, number, number] | undefined
) {
    return a === b || (
        a !== undefined
        && b !== undefined
        && a[0] === b[0]
        && a[1] === b[1]
        && a[2] === b[2]
        && a[3] === b[3]
    )
}

function createBenchmarkExecution() {
    const [program, debugInfo] = compile(BENCHMARK_SOURCE, { range: true })
    const execution = getExecution(program, 0, globalThis, [], undefined, [], undefined, compile)

    return {
        execution,
        debugInfo,
    }
}

function getSourceMapAtPtr(
    execution: ReturnType<typeof getExecution>,
    debugInfo: DebugInfo
) {
    return debugInfo.sourceMap[execution[Fields.ptr]]
}

function isInternalPtr(
    execution: ReturnType<typeof getExecution>,
    debugInfo: DebugInfo
) {
    return !!debugInfo.internals[execution[Fields.ptr]]
}

function advanceToNextVisualStep(
    execution: ReturnType<typeof getExecution>,
    debugInfo: DebugInfo
) {
    const originalPos = getSourceMapAtPtr(execution, debugInfo)
    let rawSteps = 0
    let done = false

    do {
        const result = execution[Fields.step](true)
        rawSteps += 1
        done = result[Fields.done]
    } while (
        !done
        && (
            sameSourceMapPos(getSourceMapAtPtr(execution, debugInfo), originalPos)
            || isInternalPtr(execution, debugInfo)
        )
    )

    return { rawSteps, done }
}

function measureVisualStepThroughput(durationMs = 250, warmupVisualSteps = 5000) {
    const { execution, debugInfo } = createBenchmarkExecution()

    for (let i = 0; i < warmupVisualSteps; i++) {
        const result = advanceToNextVisualStep(execution, debugInfo)
        if (result.done) {
            break
        }
    }

    let visualSteps = 0
    let rawSteps = 0
    const start = performance.now()
    const deadline = start + durationMs

    while (performance.now() < deadline) {
        const result = advanceToNextVisualStep(execution, debugInfo)
        rawSteps += result.rawSteps
        if (result.done) {
            break
        }
        visualSteps += 1
    }

    const elapsedMs = performance.now() - start
    const visualStepsPerSecond = visualSteps * 1000 / elapsedMs
    const visualStepsPer60FpsFrame = visualStepsPerSecond / 60
    const rawStepsPerVisibleStep = visualSteps > 0 ? rawSteps / visualSteps : 0

    return {
        elapsedMs,
        rawSteps,
        visualSteps,
        visualStepsPerSecond,
        visualStepsPer60FpsFrame,
        rawStepsPerVisibleStep,
    }
}

benchmarkTest('visual-step benchmark reports debugger-step throughput', () => {
    const result = measureVisualStepThroughput()

    console.log(
        `[visual-step benchmark] ${Math.round(result.visualStepsPerSecond).toLocaleString()} visible steps/sec `
        + `(~${Math.round(result.visualStepsPer60FpsFrame).toLocaleString()} visible steps per 60 FPS frame, `
        + `${result.rawStepsPerVisibleStep.toFixed(1)} raw VM steps per visible step, `
        + `${result.elapsedMs.toFixed(1)} ms sample)`
    )

    expect(result.visualSteps).toBeGreaterThan(0)
    expect(result.rawSteps).toBeGreaterThan(result.visualSteps)
})
