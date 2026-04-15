import { compileAndRun } from '../index'

describe('Generators', () => {
    test('basic generator yielding values', () => {
        const result = compileAndRun(`
            function* g() {
                yield 1;
                yield 2;
                return 3;
            }
            const it = g();
            const r1 = it.next();
            const r2 = it.next();
            const r3 = it.next();
            [r1.value, r1.done, r2.value, r2.done, r3.value, r3.done];
        `)
        expect(result).toEqual([1, false, 2, false, 3, true])
    })

    test('generator with parameters', () => {
        const result = compileAndRun(`
            function* g(start) {
                yield start;
                yield start + 1;
            }
            const it = g(10);
            [it.next().value, it.next().value];
        `)
        expect(result).toEqual([10, 11])
    })

    test('passing values to next()', () => {
        const result = compileAndRun(`
            function* g() {
                const x = yield 1;
                const y = yield (x + 1);
                return x + y;
            }
            const it = g();
            const r1 = it.next();      // yield 1, r1.value = 1
            const r2 = it.next(10);    // x = 10, yield 11, r2.value = 11
            const r3 = it.next(20);    // y = 20, return 30, r3.value = 30
            [r1.value, r2.value, r3.value];
        `)
        expect(result).toEqual([1, 11, 30])
    })

    test('generator with internal state and loops', () => {
        const result = compileAndRun(`
            function* range(n) {
                for (let i = 0; i < n; i++) {
                    yield i;
                }
            }
            const it = range(3);
            [it.next().value, it.next().value, it.next().value, it.next().done];
        `)
        expect(result).toEqual([0, 1, 2, true])
    })

    test('generator throw() handling', () => {
        const result = compileAndRun(`
            function* g() {
                try {
                    yield 1;
                } catch (e) {
                    yield e;
                }
                yield 2;
            }
            const it = g();
            it.next();
            const r2 = it.throw('error');
            const r3 = it.next();
            [r2.value, r3.value];
        `)
        expect(result).toEqual(['error', 2])
    })

    test('yield* delegation', () => {
        const result = compileAndRun(`
            function* g1() {
                yield 1;
                yield 2;
            }
            function* g2() {
                yield* g1();
                yield 3;
            }
            const it = g2();
            [it.next().value, it.next().value, it.next().value];
        `)
        expect(result).toEqual([1, 2, 3])
    })
})
