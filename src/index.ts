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

const pinGlobalValueProperties = (global: any) => {
    for (const name of ['Infinity', 'NaN', 'undefined']) {
        if (Reflect.getOwnPropertyDescriptor(global, name) !== undefined) {
            continue
        }

        const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, name)
        if (descriptor !== undefined) {
            Reflect.defineProperty(global, name, descriptor)
        }
    }
}

export function compileAndRun(src: string, global: any = globalThis) {
    pinGlobalErrorConstructors(global)
    pinGlobalValueProperties(global)
    const [programData] = compile(src, { evalMode: true })
    return run(programData, 0, global, [], undefined, [], compile)
}
