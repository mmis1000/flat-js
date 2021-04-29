import { compile } from './compiler'
export { compile } from './compiler'
import { run } from './runtime'
export { run, getExecution } from './runtime'

export function compileAndRun(src: string) {
    const [programData, textData] = compile(src)
    run(programData, textData, 0, [globalThis])
}