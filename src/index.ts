import { compile } from './compiler'
export { compile } from './compiler'
import { run } from './runtime'
export { run, getExecution } from './runtime'

export function compileAndRun(src: string, global: any = globalThis) {
    const [programData] = compile(src, { evalMode: true })
    return run(programData, 0, global, [], undefined, [], compile)
}