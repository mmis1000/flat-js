import { gzipSync, gunzipSync } from 'zlib'
import * as vm from 'vm'
import { compile, collectUsedOpcodes } from '../compiler'
import { compileAndRun } from '../index'

test('collectUsedOpcodes: codeLength excludes literal pool tail when present', () => {
    const [programData, info] = compile('"x".repeat(3)')
    expect(info.codeLength).toBeLessThanOrEqual(programData.length)
    expect(collectUsedOpcodes(programData, info.codeLength).length).toBeGreaterThan(0)
})

test('gzip roundtrip matches raw VM program bytes', () => {
    const [programData] = compile('1+1')
    const raw = Buffer.from(new Uint32Array(programData).buffer)
    expect(gunzipSync(gzipSync(raw)).equals(raw)).toBe(true)
})

test('compileAndRun: ', () => {
    expect(compileAndRun('42')).toBe(42)
})

test('compileAndRun: only ExpressionStatement affects result ', () => {
    expect(compileAndRun('var a = 42')).toBe(undefined)
})

test('compileAndRun: loop statements with empty completion reset eval result ', () => {
    expect(compileAndRun('42; for (let i = 0; i < 5; i++);')).toBe(undefined)
})

test('compileAndRun: finally does not affects result ', () => {
    expect(compileAndRun('try { throw 0 } catch (err) { 42 } finally { 43 }')).toBe(42)
})

test('compileAndRun: finally does not affects result ', () => {
    expect(compileAndRun('try { 42 } catch (err) {} finally { 43 }')).toBe(42)
})

test('compileAndRun: global object assignment updates source-file binding', () => {
    const logs: string[] = []
    const vmGlobal = Object.create(globalThis) as typeof globalThis & { print(...args: any[]): void }
    Reflect.defineProperty(vmGlobal, 'globalThis', {
        value: vmGlobal,
        configurable: true,
        writable: true,
    })
    vmGlobal.print = (...args: any[]) => logs.push(...args.map(String))

    compileAndRun(`
function $DONE() {
    print('old')
}
globalThis.$DONE = function () {
    print('new')
}
$DONE()
`, vmGlobal)

    expect(logs).toEqual(['new'])
})

test('compileAndRun: cross-context errors use the provided global constructors', () => {
    const context = vm.createContext({
        console,
        require,
        result: [] as boolean[],
    })

    vm.runInContext(`
        const { compileAndRun } = require(${JSON.stringify(require.resolve('../index', { paths: [__dirname] }))});
        const vmGlobal = Object.create(globalThis);
        vmGlobal.globalThis = vmGlobal;
        vmGlobal.print = function (value) {
            result.push(value);
        };
        compileAndRun(\`
            'use strict';
            try {
                missingName;
            } catch (e) {
                print(e.constructor === ReferenceError);
            }
        \`, vmGlobal);
    `, context)

    expect(context.result).toEqual([true])
})

test('compileAndRun: cross-context native errors keep inherited realm constructors', () => {
    const context = vm.createContext({
        console,
        require,
        result: [] as boolean[],
    })

    vm.runInContext(`
        const { compileAndRun } = require(${JSON.stringify(require.resolve('../index', { paths: [__dirname] }))});
        const vmGlobal = Object.create(globalThis);
        vmGlobal.globalThis = vmGlobal;
        vmGlobal.print = function (value) {
            result.push(value);
        };
        compileAndRun(\`
            try {
                Array.prototype.values.call(null);
            } catch (e) {
                print(e.constructor === TypeError);
            }
        \`, vmGlobal);
    `, context)

    expect(context.result).toEqual([true])
})
