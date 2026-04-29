import { compileAndRun } from '../index'

describe('Async/Await', () => {
    test('basic async function returning a value', async () => {
        const result = await compileAndRun(`
            async function f() {
                return 42;
            }
            f();
        `)
        expect(result).toBe(42)
    })

    test('awaiting a literal', async () => {
        const result = await compileAndRun(`
            async function f() {
                const x = await 10;
                return x + 5;
            }
            f();
        `)
        expect(result).toBe(15)
    })

    test('awaiting a promise', async () => {
        const result = await compileAndRun(`
            async function f() {
                const p = Promise.resolve(100);
                const x = await p;
                return x + 1;
            }
            f();
        `)
        expect(result).toBe(101)
    })

    test('sequential awaits', async () => {
        const result = await compileAndRun(`
            async function f() {
                const a = await 1;
                const b = await 2;
                const c = await 3;
                return a + b + c;
            }
            f();
        `)
        expect(result).toBe(6)
    })

    test('async function as an expression', async () => {
        const result = await compileAndRun(`
            const f = async function() {
                return 'hello';
            };
            f();
        `)
        expect(result).toBe('hello')
    })

    test('async arrow function', async () => {
        const result = await compileAndRun(`
            const f = async () => 'arrow';
            f();
        `)
        expect(result).toBe('arrow')
    })

    test('try-catch with await (success)', async () => {
        const result = await compileAndRun(`
            async function f() {
                try {
                    return await 1;
                } catch (e) {
                    return 2;
                }
            }
            f();
        `)
        expect(result).toBe(1)
    })

    test('try-catch with await (failure)', async () => {
        const result = await compileAndRun(`
            async function f() {
                try {
                    await Promise.reject('error');
                    return 1;
                } catch (e) {
                    return e;
                }
            }
            f();
        `)
        expect(result).toBe('error')
    })

    test('try-finally with await', async () => {
        const result = await compileAndRun(`
            let x = 0;
            async function f() {
                try {
                    return await 1;
                } finally {
                    x = 10;
                }
            }
            f().then(res => [res, x]);
        `)
        expect(result).toEqual([1, 10])
    })

    test('nested async calls', async () => {
        const result = await compileAndRun(`
            async function g(x) {
                return x * 2;
            }
            async function f() {
                const a = await g(10);
                const b = await g(20);
                return a + b;
            }
            f();
        `)
        expect(result).toBe(60)
    })

    test('async methods in classes', async () => {
        const result = await compileAndRun(`
            class C {
                async m(x) {
                    return await x + 1;
                }
            }
            const c = new C();
            c.m(10);
        `)
        expect(result).toBe(11)
    })

    test('async method with this context', async () => {
        const result = await compileAndRun(`
            class C {
                constructor(val) {
                    this.val = val;
                }
                async getVal() {
                    return await this.val;
                }
            }
            const c = new C(42);
            c.getVal();
        `)
        expect(result).toBe(42)
    })

    test('async generator next returns a promise and runs destructured parameters', async () => {
        const result = await compileAndRun(`
            let callCount = 0;
            const fn = async function*([x, y, z]) {
                callCount = x + y + z;
            };

            const iter = fn([1, 2, 3]);
            const first = iter.next();
            first.then((step) => [typeof first.then, callCount, step.value, step.done]);
        `)
        expect(result).toEqual(['function', 6, undefined, true])
    })

    test('complex microtask interleaving', async () => {
        const result = await compileAndRun(`
            let log = '';
            async function a() {
                log += 'a1';
                await 0;
                log += 'a2';
            }
            async function b() {
                log += 'b1';
                await 0;
                log += 'b2';
            }
            const p1 = a();
            const p2 = b();
            // We need to wait for both to finish in the host environment
            // Since they are initiated in the same tick, they should interleave
            Promise.all([p1, p2]).then(() => log);
        `)
        // The compileAndRun returns the result of the LAST expression.
        // But the last expression is a Promise.
        // compileAndRun will return the promise.
        expect(result).toBe('a1b1a2b2')
    })
})
