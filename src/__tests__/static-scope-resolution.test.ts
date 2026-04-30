import { collectUsedOpcodes, compile, OpCode, type CompileOptions } from '../compiler'
import { LiteralPoolKind, literalPoolWordMask } from '../compiler/shared'
import { run } from '../runtime'

function expectOpcodeUsage(code: string, opcode: OpCode, expected: boolean) {
    const [program, info] = compile(code)
    const used = new Set(collectUsedOpcodes(program, info.codeLength))
    expect(used.has(opcode)).toBe(expected)
}

function collectStringLiterals(code: string, options?: CompileOptions) {
    const [program, info] = compile(code, options)
    const strings: string[] = []
    let pos = info.codeLength

    while (pos < program.length) {
        const kind = (program[pos] ^ literalPoolWordMask(pos)) | 0
        const length = (program[pos + 1] ^ literalPoolWordMask(pos + 1)) | 0
        if (kind === LiteralPoolKind.String) {
            let value = ''
            for (let i = 0; i < length; i++) {
                value += String.fromCharCode(((program[pos + 2 + i] ^ literalPoolWordMask(pos + 2 + i)) | 0) & 0xffff)
            }
            strings.push(value)
        }
        pos += 2 + length
    }

    return strings
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

test('synthetic static temp scopes do not emit named aliases', () => {
    const strings = collectStringLiterals(`
let first
let { value = 1 } = {}
;({ value: first } = { value: 2 })
`)

    expect(strings.some((value) => value.startsWith('[binding.') || value.startsWith('[assign.'))).toBe(false)
})

test('non-debug static local slots omit runtime binding names', () => {
    const code = `
function outer() {
    let slotOnly = 1
    slotOnly += 2
    print(slotOnly)
}
outer()
`
    const strings = collectStringLiterals(code)
    const [program] = compile(code)
    const out: any[] = []

    expect(strings).not.toContain('slotOnly')
    run(program, 0, globalThis, [{ print: (...args: any[]) => out.push(...args) }])
    expect(out).toEqual([3])
})

test('var redeclarations keep simple parameter static storage', () => {
    const out: any[] = []
    const [program] = compile(`
function f1(x) {
    var x
    return typeof x
}
function f2(x) {
    var x
    return x
}
print(f1(1), f2(1))
`)

    run(program, 0, globalThis, [{ print: (...args: any[]) => out.push(...args) }])
    expect(out).toEqual(['number', 1])
})

test('static destructuring parameter writes through synthetic temp scope', () => {
    const out: any[] = []
    const [program] = compile(`
function read({ a, b, ...rest }) {
    return [a, b, rest.x].join(':')
}
print(read({ a: 1, b: 2, x: 3 }))
`)

    run(program, 0, globalThis, [{ print: (...args: any[]) => out.push(...args) }])
    expect(out).toEqual(['1:2:3'])
})

test('for-in var declaration target keeps name for dynamic loop binding', () => {
    const out: any[] = []
    const code = `
function read(obj) {
    var seen = ''
    for (var loopSlot in obj) {
        seen = loopSlot
    }
    return seen
}
print(read({ answer: 1 }))
`
    const strings = collectStringLiterals(code)
    const [program] = compile(code)

    expect(strings).toContain('loopSlot')
    run(program, 0, globalThis, [{ print: (...args: any[]) => out.push(...args) }])
    expect(out).toEqual(['answer'])
})

test('range builds preserve static local names for scope materialization', () => {
    const strings = collectStringLiterals(`
function outer() {
    let slotOnly = 1
    return slotOnly
}
outer()
`, { range: true })

    expect(strings).toContain('slotOnly')
})

test('dynamic scope roots preserve names required by with lookup', () => {
    const out: any[] = []
    const [program] = compile(`
function outer() {
    let slotOnly = 7
    with ({}) {
        print(slotOnly)
    }
}
outer()
`)

    run(program, 0, globalThis, [{ print: (...args: any[]) => out.push(...args) }], undefined, [], compile)
    expect(out).toEqual([7])
})
