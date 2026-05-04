import { gzipSync, gunzipSync } from 'zlib'
import * as vm from 'vm'
import { compile, collectUsedOpcodes } from '../compiler'
import { finalizeLiteralPool } from '../compiler/encoding'
import { LiteralPoolKind, OpCode, TEXT_DADA_MASK, literalPoolWordMask } from '../compiler/shared'
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

test('finalizeLiteralPool appends large literal pools without spreading arguments', () => {
    const value = 'x'.repeat(150000)
    const programData = [OpCode.Literal, TEXT_DADA_MASK]

    finalizeLiteralPool(programData, [value])

    expect(programData[1]).toBe(TEXT_DADA_MASK | 2)
    expect(programData.length).toBe(2 + 2 + value.length)
    expect((programData[2] ^ literalPoolWordMask(2)) | 0).toBe(LiteralPoolKind.String)
    expect((programData[3] ^ literalPoolWordMask(3)) | 0).toBe(value.length)
})

test('finalizeLiteralPool only scans literal opcodes, not literal operands', () => {
    const strayPoolOperand = TEXT_DADA_MASK | 1
    const programData = [OpCode.Literal, OpCode.Literal, strayPoolOperand]

    finalizeLiteralPool(programData, ['x'])

    expect(programData[1]).toBe(OpCode.Literal)
    expect(programData[2]).toBe(strayPoolOperand)
})

test('finalizeLiteralPool rejects malformed literal pool placeholders', () => {
    expect(() => finalizeLiteralPool(
        [OpCode.Literal, TEXT_DADA_MASK | 1],
        ['x'],
    )).toThrow('malformed literal pool slot 1')
})

test('compile: shifted binding-pattern cleanup keeps valid jump offsets', () => {
    expect(() => compile('var [x] = [1]; x', { evalMode: true })).not.toThrow()
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

test('compileAndRun: for loop break with empty completion ignores prior iterations ', () => {
    expect(compileAndRun(`
        var count = 0
        for (count = 0;;) {
            if (count === 5) {
                break
            } else {
                count++
            }
        }
    `)).toBe(undefined)
})

test('compileAndRun: if statements with empty completion reset eval result ', () => {
    expect(compileAndRun('1; if (false) {}')).toBe(undefined)
    expect(compileAndRun('2; if (true) {}')).toBe(undefined)
    expect(compileAndRun('3; if (true) { 4; }')).toBe(4)
    expect(compileAndRun('5; if (false) {} else {}')).toBe(undefined)
    expect(compileAndRun('6; if (false) {} else { 7; }')).toBe(7)
    expect(compileAndRun('8; do { 9; if (true) { break; } 10; } while (false)')).toBe(undefined)
    expect(compileAndRun('11; do { 12; if (true) { 13; break; } 14; } while (false)')).toBe(13)
})

test('compileAndRun: try statements preserve completion values ', () => {
    expect(compileAndRun('1; try {} catch (err) {}')).toBe(undefined)
    expect(compileAndRun('2; try { 3; } catch (err) {}')).toBe(3)
    expect(compileAndRun('4; try { throw null; } catch (err) {}')).toBe(undefined)
    expect(compileAndRun('5; try { throw null; } catch (err) { 6; }')).toBe(6)
    expect(compileAndRun('7; try { 8; } finally { 9; }')).toBe(8)
    expect(compileAndRun('10; do { 11; try { 12; } finally { break; } 13; } while (false)')).toBe(undefined)
    expect(compileAndRun('14; do { 15; try { 16; } finally { 17; break; } 18; } while (false)')).toBe(17)
    expect(compileAndRun('19; do { 20; try { 21; break; } finally { 22; } 23; } while (false)')).toBe(21)
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
