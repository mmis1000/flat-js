import * as fs from 'fs'
import * as path from 'path'
import * as compiler from '../compiler'
import * as runtime from '../runtime'
import * as vm from 'vm'

const files = fs.readdirSync(path.resolve(__dirname, './fixures'))

for (let file of files) {
    if (/\.js$/.test(file)) {
        const data = fs.readFileSync(path.resolve(__dirname, './fixures', file), { encoding: 'utf-8' })

        test('Example: ' + file, () => {
            expect(() => {
                compiler.compile(data)
            }).not.toThrow()
        })
    }
}



test('Example: crc location', () => {
    const code = fs.readFileSync(path.resolve(__dirname, './fixures/crc-location-href.js'), { encoding: 'utf-8' })

    let href = 'AAAAA'
    let result: any

    const context = {
        location: {
            href
        },
        console: {
            log(res: any) {
                result = res
                expect(result).toBeDefined()
            }
        }
    }

    vm.createContext(context); // Contextify the object.
    vm.runInContext(code, context);

    const [program, text] = compiler.compile(code)

    const context2 = {
        location: {
            href
        },
        console: {
            log(res: any) {
                expect(res).toEqual(result)
            }
        }
    }

    runtime.run(program, text, 0, [globalThis, context2])
})

function testRuntime(
    testName: string,
    code: string,
    expectResults: any[],
    ctxProvider: (results: any[]) => Record<string, any>,
    resultTransform: (results: any[]) => any[] = (a: any[]) => a,
) {

    test('Runtime: ' + testName, () => {
        const [program, text] = compiler.compile(code)
        const results: any[] = []
        const context = ctxProvider(results)


        runtime.run(program, text, 0, [globalThis, context])

        expect(resultTransform(results)).toEqual(expectResults)
    })
}

function testRuntimeThrows(
    testName: string,
    code: string,
    error: any = undefined,
    ctxProvider: (results: any[]) => Record<string, any> = () => ({})
) {

    test('Runtime: ' + testName, () => {
        const [program, text] = compiler.compile(code)
        const results: any[] = []
        const context = ctxProvider(results)

        expect(() => {
            runtime.run(program, text, 0, [globalThis, context])
        }).toThrowError(error)
    })
}

const printProvider = (result: any[]) => ({
    print(...args: any[]) { result.push(...args) }
})

testRuntime('primitive 0', 'print(0)', [0], printProvider)
testRuntime('primitive 1', 'print(1)', [1], printProvider)
testRuntime('primitive -1', 'print(-1)', [-1], printProvider)
testRuntime('primitive "0"', 'print("0")', ["0"], printProvider)
testRuntime('primitive "1"', 'print("1")', ["1"], printProvider)
testRuntime('primitive true', 'print(true)', [true], printProvider)
testRuntime('primitive false', 'print(false)', [false], printProvider)
testRuntime('primitive null', 'print(null)', [null], printProvider)
testRuntime('primitive undefined', 'print(undefined)', [undefined], printProvider)

testRuntime('object {}', 'print({})', [{}], printProvider)
testRuntime('object { a: 1 }', 'print({ a: 1 })', [{ a: 1 }], printProvider)
testRuntime('object shorthand { a }', 'const a = 1 ;print({ a })', [{ a: 1 }], printProvider)
testRuntime('object computed name { [a]: 1 }', 'const a = "a"; print({ [a]: 1 })', [{ a: 1 }], printProvider)
testRuntime('object method { a () {} }', 'print(({ a () {} }).a)', ['function'], printProvider, (l) => l.map(i => typeof i))

testRuntime('array []', 'print([])', [[]], printProvider)
testRuntime('array [1]', 'print([1])', [[1]], printProvider)
testRuntime('array [,1]', 'print([,1])', [[, 1]], printProvider)

testRuntime('condition expression true', 'print(true ? 1 : 0)', [1], printProvider)
testRuntime('condition expression falsy', 'print(false ? 1 : 0)', [0], printProvider)

testRuntime('if statement true', 'if (true) { print(1) } else { print(0) }', [1], printProvider)
testRuntime('if statement falsy', 'if (false) { print(1) } else { print(0) }', [0], printProvider)

testRuntime('compare 1 > 0', 'if (1 > 0) { print(1) } else { print(0) }', [1], printProvider)
testRuntime('compare 1 > 1', 'if (1 > 1) { print(1) } else { print(0) }', [0], printProvider)
testRuntime('compare 0 > 1', 'if (0 > 0) { print(1) } else { print(0) }', [0], printProvider)

testRuntime('compare 1 >= 0', 'if (1 >= 0) { print(1) } else { print(0) }', [1], printProvider)
testRuntime('compare 1 >= 1', 'if (1 >= 1) { print(1) } else { print(0) }', [1], printProvider)
testRuntime('compare 0 >= 1', 'if (0 >= 1) { print(1) } else { print(0) }', [0], printProvider)

testRuntime('compare 1 < 0', 'if (1 < 0) { print(1) } else { print(0) }', [0], printProvider)
testRuntime('compare 1 < 1', 'if (1 < 1) { print(1) } else { print(0) }', [0], printProvider)
testRuntime('compare 0 < 1', 'if (0 < 1) { print(1) } else { print(0) }', [1], printProvider)

testRuntime('compare 1 <= 0', 'if (1 <= 0) { print(1) } else { print(0) }', [0], printProvider)
testRuntime('compare 1 <= 1', 'if (1 <= 1) { print(1) } else { print(0) }', [1], printProvider)
testRuntime('compare 0 <= 1', 'if (0 <= 1) { print(1) } else { print(0) }', [1], printProvider)

testRuntime('1 + 2', 'print(1 + 2)', [3], printProvider)
testRuntime('1 - 2', 'print(1 - 2)', [-1], printProvider)
testRuntime('1 * 2', 'print(1 * 2)', [2], printProvider)
testRuntime('1 / 2', 'print(1 / 2)', [0.5], printProvider)
testRuntime('3 % 2', 'print(3 % 2)', [1], printProvider)
testRuntime('1 != "1"', 'print(1 != "1")', [false], printProvider)
testRuntime('1 !== "1"', 'print(1 !== "1")', [true], printProvider)
testRuntime('"a" in { a: 0 }', 'print("a" in { a: 0 })', [true], printProvider)
testRuntime('1 & 2', 'print(1 & 2)', [0], printProvider)
testRuntime('1 | 2', 'print(1 | 2)', [3], printProvider)
testRuntime('1 ^ 2', 'print(1 ^ 2)', [3], printProvider)
testRuntime('2 >> 1', 'print(2 >> 1)', [1], printProvider)
testRuntime('2 >>> 1', 'print(2 >>> 1)', [1], printProvider)
testRuntime('2 << 1', 'print(2 << 1)', [4], printProvider)
testRuntime('1 == 1', 'print(1 == 1)', [true], printProvider)
testRuntime('1 == "1"', 'print(1 == "1")', [true], printProvider)
testRuntime('1 == "2"', 'print(1 == "2")', [false], printProvider)
testRuntime('1 === 1', 'print(1 === 1)', [true], printProvider)
testRuntime('1 === "1"', 'print(1 === "1")', [false], printProvider)
testRuntime('1 === "2"', 'print(1 === "2")', [false], printProvider)

testRuntime('||', 'false || print(1)', [1], printProvider)
testRuntime('shortcut ||', 'true || print(1)', [], printProvider)

testRuntime('&&', 'true && print(1)', [1], printProvider)
testRuntime('shortcut &&', 'false && print(1)', [], printProvider)

testRuntime('true ? : ', 'true ?  print(1) : 0', [1], printProvider)
testRuntime('false ? : ', 'false ? 0 : print(1) ', [1], printProvider)
testRuntime('shortcut true ? : ', 'true ? 0 : print(1)', [], printProvider)
testRuntime('shortcut false ? : ', 'false ? print(1) : 0', [], printProvider)
testRuntime('i++', 'let i = 0; i++; print(i)', [1], printProvider)
testRuntime('i++', 'let i = { a: 0 }; i.a++; print(i.a)', [1], printProvider)
testRuntime('i++ before', 'let i = 0; print(i++); print(i)', [0, 1], printProvider)
testRuntime('i++ before', 'let i = { a: 0 }; print(i.a++); print(i.a)', [0, 1], printProvider)
testRuntime('i--', 'let i = 1; i--; print(i)', [0], printProvider)
testRuntime('i--', 'let i = { a: 1 }; i.a--; print(i.a)', [0], printProvider)
testRuntime('i-- before', 'let i = 1; print(i--); print(i)', [1, 0], printProvider)
testRuntime('i-- before', 'let i = { a: 1 }; print(i.a--); print(i.a)', [1, 0], printProvider)
testRuntimeThrows('undefined i++', 'i++;', ReferenceError, printProvider)
testRuntimeThrows('undefined i--', 'i--;', ReferenceError, printProvider)
testRuntimeThrows('bad left hand print(0) = 1', 'print(0) = 1', ReferenceError, printProvider)

testRuntime(
    'prefix unary expressions', `
        const a = '1'
        print(+a)
        print(-a)
        print(!a)
        print(~a)
    `,
    [1, -1, false, -2],
    printProvider
)

testRuntime('for let', `
const fns = []
for (let i = 0; i < 2; i++) {
    fns.push(() => i)
}
print(fns[0](), fns[1]())
`, [0, 1], printProvider)

testRuntime('for const', `
const fns = []
for (const i = { v: 0 }; i.v < 2; i.v++) {
    const v = i.v
    fns.push(() => v)
}
print(fns[0](), fns[1]())
`, [0, 1], printProvider)

testRuntime(
    'function return value',
    `
const fn = () => 0
run(fn)
`,
    [0],
    (results) => ({
        run(fn: (...args: any[]) => any) {
            results.push(fn())
        }
    })
)

testRuntime(
    'local function return value',
    `
const fn = () => 0
print(fn())
`,
    [0],
    printProvider
)

testRuntime(
    'function return bare',
    `
const fn = () => { return }
run(fn)
`,
    [undefined],
    (results) => ({
        run(fn: (...args: any[]) => any) {
            results.push(fn())
        }
    })
)

testRuntime(
    'local function return bare',
    `
const fn = () => { return }
print(fn())
`,
    [undefined],
    printProvider
)

testRuntime(
    'function without return',
    `
const fn = () => {}
run(fn)
`,
    [undefined],
    (results) => ({
        run(fn: (...args: any[]) => any) {
            results.push(fn())
        }
    })
)
testRuntime(
    'new function',
    `
function fn () {
    this.a = 0
}
run(fn)
`,
    [{a: 0}],
    (results) => ({
        run(fn: new (...args: any[]) => any) {
            results.push(JSON.parse(JSON.stringify(new fn())))
        }
    })
)
testRuntime(
    'local function without return',
    `
const fn = () => {}
print(fn())
`,
    [undefined],
    printProvider
)

testRuntime(
    'call value directly',
    `((a) => { print(a)})(0)`,
    [0], 
    printProvider
)

testRuntimeThrows('variable not exist', 'a', ReferenceError)

testRuntime('variable let', 'let a = 0; print(a);', [0], printProvider)
testRuntimeThrows('variable let TDZ get', ' print(a); let a = 0;', ReferenceError)
testRuntimeThrows('variable let TDZ set', ' a = 1; let a = 0;', ReferenceError)

testRuntime('variable const', 'const a = 0; print(a);', [0], printProvider)
testRuntimeThrows('variable const TDZ get', 'print(a); const a = 0;', ReferenceError)
testRuntimeThrows('variable const TDZ set', 'a = 1; const a = 0;', ReferenceError)
testRuntimeThrows('variable const immutable', ' const a = 0; a = 0', TypeError)

testRuntime('empty statement', ';', [], printProvider)
testRuntime('function statement', 'print(a()); function a () { return 0 }', [0], printProvider)
testRuntime('function statement covered by ParenthesizedExpression', 'print((a)()); function a () { return 0 }', [0], printProvider)
testRuntime('function expression', 'const a = function a () { return 0 }; print(a());', [0], printProvider)
testRuntime('arrow function', 'const a = () => 0; print(a());', [0], printProvider)
testRuntime('object method', 'const a = { b () { return 0 } }; print(a.b());', [0], printProvider)
testRuntime('object method covered by ParenthesizedExpression', 'const a = { b () { return 0 } }; print((a.b)());', [0], printProvider)
testRuntime('this reference get', 'const a = { a: 0, b () { return this.a } }; print(a.b());', [0], printProvider)
testRuntime('this reference set', 'const a = { a: 0, b () { this.a = 1 } }; a.b() print(a.a);', [1], printProvider)

testRuntime(
    'scope shadowing',
    `
    let a = 0
    {
        let a = 1
        print(a)
    }
    print(a)
    `,
    [1, 0],

    printProvider
)
testRuntime(
    'try catch - return bare',
    `
    try {
        throw 1
    } catch (err) {
        print(err)
    }
    `,
    [1],
    printProvider
)
testRuntime(
    'try catch - return try',
    `
    const a = () => {
        try {
            return 1
        } catch (err) {}
    }
    print(a())
    `,
    [1],
    printProvider
)
testRuntime(
    'try catch - return catch',
    `
    const a = () => {
        try {
            throw 0
        } catch (err) {
            return 1
        }
    }
    print(a())
    `,
    [1],
    printProvider
)
testRuntimeThrows(
    'try catch - throw catch',
    `
    const a = () => {
        try {
            throw 0
        } catch (err) {
            throw Reflect.construct(Error, ['a'])
        }
    }
    print(a())
    `,
    'a',
    printProvider
)
testRuntime(
    'try catch - return in finally',
    `
    const a = () => {
        try {
            throw (print(1), 1)
        } catch (err) {
            print(err + 1)
        } finally {
            return 3
        }
    }

    print(a())
    `,
    [1, 2, 3],
    printProvider
)
testRuntime(
    'try catch - exit finally',
    `
    try {
        throw 1
    } catch (err) {
        print(err)
    } finally {
        print(0)
    }
    `,
    [1, 0],
    printProvider
)
testRuntimeThrows(
    'try catch - throw in finally',
    `
    try {
        throw 1
    } catch (err) {
        print(err)
    } finally {
        throw Reflect.construct(Error, ['a'])
    }
    `,
    'a',
    printProvider
)
testRuntime(
    'try catch - exit from finally from throw in catch',
    `
    try {
        try {
            print(0)
            throw 1
        } catch (err) {
            throw 2
        } finally {
            print(1)
        }
    } catch (err) {
        print(err)
    }
    `,
    [0, 1, 2],
    printProvider
)
testRuntime(
    'try catch - exit from finally from return in catch',
    `
    const a = () => {
        try {
            print(0)
            throw 1
        } catch (err) {
            return 2
        } finally {
            print(1)
        }
    }

    print(a())
    `,
    [0, 1, 2],
    printProvider
)
testRuntimeThrows(
    'try catch - throw bare',
    'throw "FQ"',
    "FQ",
    printProvider
)
testRuntime(
    'try no catch',
    `
    try {
        try {
            throw 2
        } finally {
            print(1)
        }
    } catch (err) {
        print(err)
    }
    `,
    [1, 2],
    printProvider
)

testRuntime(
    'try break',
    `
    do {
        try {
            throw 'FQ'
        } finally {
            break
        }
    } while (false)
    print(0)
    `,
    [0],
    printProvider
)

testRuntime('call', `
const fn = function (b) {
    return this.a + b
}
const obj = {
    a: 1
}
print(fn.call(obj, 1))
`, [2], printProvider)

testRuntime('call recursive', `
const call = Function.prototype.call
call.call(call, call, call, function () { print(this.a) }, { a: 1 })
`, [1], printProvider)

testRuntime('apply', `
const fn = function (b) {
    return this.a + b
}
const obj = {
    a: 1
}
print(fn.apply(obj, [1]))
`, [2], printProvider)

testRuntimeThrows('call throws', `
const call = Function.prototype.call
call(null)
`, TypeError)

testRuntimeThrows('apply throws', `
const apply = Function.prototype.apply
apply(null, [])
`, TypeError)

testRuntime('bind', `
const a = function (b, c) {
    print(this.a, b, c)
}
const b = a.bind({ a: 0 }, 1)
b(2)
`, [0, 1, 2], printProvider)

testRuntime('bind external', `
const a = function (b, c) {
    return [this.a, b, c]
}
const b = a.bind({ a: 0 }, 1)
run(b)
`, [0, 1, 2],
(results) => ({
    run(fn: (...args: any[]) => any) {
        results.push(...fn(2))
    }
}))


testRuntime('switch miss', `
var a = 1
switch (a) {
    case 2: 
        a = 2
}
print(a)
`, [1], printProvider)

testRuntime('switch hit', `
var a = 1
switch (a) {
    case 1: 
        a = 2
}
print(a)
`, [2], printProvider)

testRuntime('switch default', `
var a = 1
switch (a) {
    default:
        a = 2
}
print(a)
`, [2], printProvider)


testRuntime('switch full', `
var flag = 2
var a = 0
var b = 0
var c = 0
var d = 0
switch (flag) {
    case 1: 
        a = 1
    case 2: 
        b = 1
    case 3: 
        c = 1
    default:
        d = 1
}
print(a)
print(b)
print(c)
print(d)
`, [0, 1, 1, 1], printProvider)


testRuntime('switch break', `
var a = 0
switch (1) {
    case 1: 
        a = 1
        break
    default:
        a = 2
}
print(a)
`, [1], printProvider)



testRuntime('switch nested break', `
var a = 0
switch (1) {
    case 1: 
        a = 1
        if (true) {
            break
        }
    default:
        a = 2
}
print(a)
`, [1], printProvider)

testRuntime('switch nested break 2', `
var a = 0
switch (1) {
    case 1: 
        let b = a
        a = b + 1
        if (true) {
            break
        }
    default:
        a = 2
}
print(a)
`, [1], printProvider)


testRuntime('for break', `
var a = 0

for (;;) {
    a++
    if (a === 3) {
        break
    }
}

print(a)
`, [3], printProvider)

testRuntime('for break nested', `
for (let i = 0; i < 5; i++) {
    let a = i
    if (a > 3) {
        break
    }
    print(a)
}
`, [0, 1, 2, 3], printProvider)

testRuntime('for continue', `

for (let i = 0; i < 5; i++) {
    if (i < 3) {
        continue
    }
    print(i)
}
`, [3, 4], printProvider)

testRuntime('for continue nested', `
for (let i = 0; i < 5; i++) {
    let a = i
    if (a < 3) {
        continue
    }
    print(a)
}
`, [3, 4], printProvider)

testRuntime('for continue nested', `
let i;
for (i = 0; i < 5; i++) {
    let a = i
    if (a < 3) {
        continue
    }
    print(a)
}
`, [3, 4], printProvider)



testRuntime('new', `
function a () {
    this.b = 10
}

print((new a()).b)
`, [10], printProvider)

testRuntime('new with bind', `
function a (val) {
    this.b = val
}

var b = a.bind(null, 10)

print((new b()).b)
`, [10], printProvider)

testRuntime('new with try catch', `
function a () {
    this.b = 10
    try {
        return
    } catch (err) {}
}

print((new a()).b)
`, [10], printProvider)


testRuntimeThrows('new method cause error', `
new ({ a () {} }).a
`, TypeError)


testRuntime('instance of', `
function A () {}
function B () {}

print(new A instanceof A)
print(new B instanceof B)
print(new A instanceof Object)
print(new B instanceof Object)
print(new A instanceof B)
`, [true, true, true, true, false], printProvider)


testRuntime('typeof', `
print(typeof 'string')
print(typeof 0)
print(typeof true)
print(typeof notExist)
`, ['string', 'number', 'boolean', 'undefined'], printProvider)


testRuntimeThrows('typeof TDZ', `
print(typeof val)
let val
`, ReferenceError)


testRuntime('for in', `
var a = { a: 1, b: 2}
for (var k in a) {
    print(k)
}
`, ['a', 'b'], printProvider)

testRuntime('for in let', `
var a = { a: 1, b: 2}
var fns = []
for (let k in a) {
    fns.push(() => k)
}

fns.forEach(it => print(it()))
`, ['a', 'b'], printProvider)

testRuntimeThrows('for in const', `
var a = { a: 1, b: 2}
for (const k in a) {
    k = 0
}
`, TypeError)

testRuntime('for in', `
for (var k in undefined) {
}
`, [], printProvider)

testRuntime('regexp', `
print(/aaa\\ubbb/g.source)
print(/aaa\\ubbb/g.flags)
`, ['aaa\\ubbb', 'g'], printProvider)


testRuntime('+=', `
var a = 0
a += 2

print(a)

var b = {}
Object.defineProperty(b, 'a', {
    set (v) {},
    get () { return 0}
})

print(b.a += 2)
`, [2, 2], printProvider)

testRuntime('-=', `
var a = 0
a -= 2
print(a)

var b = {}
Object.defineProperty(b, 'a', {
    set (v) {},
    get () { return 0}
})

print(b.a -= 2)
`, [-2, -2], printProvider)

testRuntime('++variable', `
var a = 0
print(++a, a)
`, [1, 1], printProvider)

testRuntime('--variable', `
var a = 1
print(--a, a)
`, [0, 0], printProvider)

testRuntime('delete', `
var a = { b: 1, c: 1 }
print('b' in a, 'c' in a)
delete a.b
delete a['c']
print('b' in a, 'c' in a)
`, [true, true, false, false], printProvider)


testRuntime('while', `
let i = 0

print(-1)
while (i < 3) {
    print(i)
    i++
}
print(-2)
`, [-1, 0, 1, 2, -2], printProvider)

testRuntime('while continue', `
let i = 0

print(-1)
while (i < 5) {
    i++
    if (i % 2 === 0) {
        continue
    }
    print(i)
}
print(-2)
`, [-1, 1, 3, 5, -2], printProvider)

testRuntime('while break', `
let i = 0

print(-1)
while (true) {
    i++
    print(i)
    break
}
print(-2)
`, [-1, 1, -2], printProvider)

testRuntime('do while', `
let i = 0

print(-1)
do {
    print(i)
    i++
} while (i < 0)
print(-2)
`, [-1, 0, -2], printProvider)

testRuntime('do while continue', `
let i = 0

print(-1)
do {
    print(i++)
    if (i < 5) continue
} while (false)
print(-2)
`, [-1, 0, 1, 2, 3, 4, -2], printProvider)

testRuntime('do while break', `
let i = 0

print(-1)
do {
    print(i++)
    if (i >= 5) break
} while (true)
print(-2)
`, [-1, 0, 1, 2, 3, 4, -2], printProvider)


testRuntime('tdz removed after only variable initialized successfully', `
let b

const success = () => {
    return 1
}

const a = () => {
    b = () => badVal
    let badVal = success()
}

try {
    a()
} catch (err) {}

print(b())
`, [1], printProvider)

testRuntimeThrows('tdz removed after only variable initialized successfully', `
let b

const panic = () => {
    throw 0
}

const a = () => {
    b = () => badVal
    let badVal = panic()
}

try {
    a()
} catch (err) {}

b()
`, ReferenceError)