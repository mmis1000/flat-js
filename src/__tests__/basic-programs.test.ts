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

        expect(expectResults).toEqual(resultTransform(results))
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
testRuntime('i++ before', 'let i = 0; print(i++); print(i)', [0, 1], printProvider)
testRuntime('i--', 'let i = 1; i--; print(i)', [0], printProvider)
testRuntime('i-- before', 'let i = 1; print(i--); print(i)', [1, 0], printProvider)
testRuntimeThrows('undefined i++', 'i++;', ReferenceError, printProvider)
testRuntimeThrows('undefined i--', 'i--;', ReferenceError, printProvider)

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
    'local function without return',
    `
const fn = () => {}
print(fn())
`,
    [undefined],
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
testRuntime('function expression', 'const a = function a () { return 0 }; print(a());', [0], printProvider)
testRuntime('arrow function', 'const a = () => 0; print(a());', [0], printProvider)
testRuntime('object method', 'const a = { b () { return 0 } }; print(a.b());', [0], printProvider)
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