import { collectUsedOpcodes, compile, OpCode } from '../compiler'
import { run } from '../runtime'

function expectOpcodeUsage(code: string, opcode: OpCode, expected: boolean) {
    const [program, info] = compile(code)
    const used = new Set(collectUsedOpcodes(program, info.codeLength))
    expect(used.has(opcode)).toBe(expected)
}

test('emits GetStatic when closure lookup is eval-free', () => {
    expectOpcodeUsage(`
function outer() {
    let a = 1
    function inner() {
        return a + 1
    }
    return inner()
}
outer()
`, OpCode.GetStatic, true)
})

test('emits unchecked static lookup for var closures', () => {
    expectOpcodeUsage(`
function outer() {
    var a = 1
    function inner() {
        return a + 1
    }
    return inner()
}
outer()
`, OpCode.GetStaticUnchecked, true)
})

test('direct eval disables static resolution in the same function', () => {
    expectOpcodeUsage(`
function outer() {
    let a = 1
    eval('a')
    return a
}
outer()
`, OpCode.GetStatic, false)
})

test('direct eval taints enclosing layers too', () => {
    expectOpcodeUsage(`
function outer() {
    let a = 1
    function inner() {
        eval('a')
        return a
    }
    return inner() + a
}
outer()
`, OpCode.GetStatic, false)
})

test('script globals stay dynamic for nested closures', () => {
    expectOpcodeUsage(`
let a = 1
function inner() {
    return a + 1
}
inner()
`, OpCode.GetStatic, false)
})

test('direct eval can still read outer closure names', () => {
    const out: any[] = []
    const [program] = compile(`
function outer() {
    let a = 42
    function inner() {
        print(eval('a'))
    }
    inner()
}
outer()
`)
    run(program, 0, globalThis, [{ print: (...args: any[]) => out.push(...args) }], undefined, [], compile)
    expect(out).toEqual([42])
})

test('direct eval can introduce vars for later reads in the same function', () => {
    const out: any[] = []
    const [program] = compile(`
function outer() {
    eval('var late = 7')
    print(late)
}
outer()
`)
    run(program, 0, globalThis, [{ print: (...args: any[]) => out.push(...args) }], undefined, [], compile)
    expect(out).toEqual([7])
})
