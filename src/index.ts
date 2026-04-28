import { compile } from './compiler'
export { compile } from './compiler'
import { run } from './runtime'
export { run, getExecution } from './runtime'

const pinGlobalErrorConstructors = (global: any) => {
    for (const name of [
        'Error',
        'EvalError',
        'RangeError',
        'ReferenceError',
        'SyntaxError',
        'TypeError',
        'URIError',
        'AggregateError',
    ]) {
        if (typeof (globalThis as any)[name] === 'function') {
            Reflect.defineProperty(global, name, {
                configurable: true,
                writable: true,
                value: (globalThis as any)[name],
            })
        }
    }
}

export function compileAndRun(src: string, global: any = globalThis) {
    pinGlobalErrorConstructors(global)
    const [programData] = compile(src, { evalMode: true })
    return run(programData, 0, global, [], undefined, [], compile)
}
