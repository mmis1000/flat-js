import { compile } from './compiler'
export { compile } from './compiler'
import { run } from './runtime'
export { run, getExecution } from './runtime'

const findPropertyDescriptor = (target: any, name: string) => {
    let current = target
    while (current != null) {
        const descriptor = Reflect.getOwnPropertyDescriptor(current, name)
        if (descriptor !== undefined) {
            return descriptor
        }
        current = Reflect.getPrototypeOf(current)
    }
    return undefined
}

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
        if (Reflect.has(global, name)) {
            continue
        }

        if (typeof (globalThis as any)[name] === 'function') {
            Reflect.defineProperty(global, name, {
                configurable: true,
                writable: true,
                value: (globalThis as any)[name],
            })
        }
    }
}

const pinGlobalConstructorProperties = (global: any) => {
    for (const name of ['Array']) {
        if (Reflect.getOwnPropertyDescriptor(global, name) !== undefined) {
            continue
        }

        const descriptor = findPropertyDescriptor(global, name)
            ?? Reflect.getOwnPropertyDescriptor(globalThis, name)
        if (descriptor !== undefined) {
            Reflect.defineProperty(global, name, descriptor)
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
    pinGlobalConstructorProperties(global)
    pinGlobalValueProperties(global)
    const [programData] = compile(src, { evalMode: true })
    return run(programData, 0, global, [], undefined, [], compile)
}
