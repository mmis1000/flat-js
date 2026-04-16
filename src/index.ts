import { compile } from './compiler'
export { compile } from './compiler'
import { run } from './runtime'
export { run, getExecution } from './runtime'

export function compileAndRun(src: string, global: any = globalThis) {
    const [programData, textData] = compile(src, { evalMode: true })
    return run(programData, textData, 0, global, [])
}