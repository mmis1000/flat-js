import * as compiler from '../compiler'
import * as runtime from '../runtime'

test('functionRedirects: Math.random redirects to external function', () => {
    let calls = 0
    const external = () => {
        calls += 1
        return 0.125
    }
    const functionRedirects = new WeakMap<Function, Function>()
    functionRedirects.set(globalThis.Math.random, external)

    const [program, text] = compiler.compile('Math.random()', { evalMode: true })
    const result = runtime.run(
        program,
        text,
        0,
        globalThis,
        [{}],
        undefined,
        [],
        compiler.compile,
        functionRedirects
    )

    expect(calls).toBe(1)
    expect(result).toBe(0.125)
})

test('functionRedirects: Math.random redirects to VM-compiled function', () => {
    const [defineProg, defineText] = compiler.compile(
        `function vmTarget() { return 999 }
vmTarget`,
        { evalMode: true }
    )
    const vmTarget = runtime.run(
        defineProg,
        defineText,
        0,
        globalThis,
        [{}],
        undefined,
        [],
        compiler.compile
    )

    const functionRedirects = new WeakMap<Function, Function>()
    functionRedirects.set(globalThis.Math.random, vmTarget)

    const [program, text] = compiler.compile('Math.random()', { evalMode: true })
    const result = runtime.run(
        program,
        text,
        0,
        globalThis,
        [{}],
        undefined,
        [],
        compiler.compile,
        functionRedirects
    )

    expect(result).toBe(999)
})
