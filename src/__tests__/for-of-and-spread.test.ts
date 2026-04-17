import { compile } from '../compiler'
import { compileAndRun } from '../index'
import { run } from '../runtime'

describe('for...of', () => {
    test('iterates array literal', () => {
        const result = compileAndRun(`
            const a = [1, 2, 3];
            let s = 0;
            for (const x of a) {
                s += x;
            }
            s;
        `)
        expect(result).toBe(6)
    })

    test('iterates VM generator', () => {
        const result = compileAndRun(`
            function* g() {
                yield 10;
                yield 20;
            }
            let s = 0;
            for (const x of g()) {
                s += x;
            }
            s;
        `)
        expect(result).toBe(30)
    })

    test('let binding in for-of', () => {
        const result = compileAndRun(`
            const out = [];
            for (const v of [7, 8]) {
                out.push(v);
            }
            out;
        `)
        expect(result).toEqual([7, 8])
    })
})

describe('array spread [...iterable]', () => {
    test('VM: spread generator', () => {
        const result = compileAndRun(`
            function* g() {
                yield 1;
                yield 2;
                yield 3;
            }
            [...g()];
        `)
        expect(result).toEqual([1, 2, 3])
    })

    test('VM: spread with leading and trailing elements', () => {
        const result = compileAndRun(`
            function* g() {
                yield 2;
            }
            [1, ...g(), 3];
        `)
        expect(result).toEqual([1, 2, 3])
    })

    test('VM: only spread', () => {
        const result = compileAndRun(`
            function* g() {
                yield 'a';
                yield 'b';
            }
            [...g()];
        `)
        expect(result).toEqual(['a', 'b'])
    })

    test('host: spread VM generator iterator', () => {
        const [program] = compile(`
            function* g() {
                yield 1;
                yield 2;
            }
        `, { evalMode: true })
        const globalObj: { g?: () => Generator<number> } = {}
        run(program, 0, globalObj, [])
        const arr = [...globalObj.g!()]
        expect(arr).toEqual([1, 2])
    })

    test('host: for...of over VM generator', () => {
        const [program] = compile(`
            function* g() {
                yield 1;
                yield 2;
                yield 3;
            }
        `, { evalMode: true })
        const globalObj: { g?: () => Generator<number> } = {}
        run(program, 0, globalObj, [])
        let sum = 0
        for (const x of globalObj.g!()) {
            sum += x
        }
        expect(sum).toBe(6)
    })
})
