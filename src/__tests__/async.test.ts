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

    test('async functions use VM realm promises and no own caller property', async () => {
        const result = await compileAndRun(`
            async function declaration() {}
            const expression = async function() {};
            const declarationPromise = declaration();
            const expressionPromise = expression();
            Promise.all([
                declarationPromise instanceof Promise,
                expressionPromise instanceof Promise,
                declaration.hasOwnProperty('caller'),
                expression.hasOwnProperty('caller')
            ]);
        `)
        expect(result).toEqual([true, true, false, false])
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

    test('awaiting native promises bypasses patched own then', async () => {
        const result = await compileAndRun(`
            let thenCallCount = 0;
            const patched = Promise.resolve(42);
            patched.then = function(...args) {
                thenCallCount++;
                return Promise.prototype.then.apply(this, args);
            };

            async function f() {
                return await patched;
            }

            f().then((value) => [value, thenCallCount]);
        `)

        expect(result).toEqual([42, 0])
    })

    test('async methods allow lexical new.target in returned async arrows', async () => {
        const result = await compileAndRun(`
            var obj = {
                async method() {
                    return async () => new.target;
                }
            };

            class C {
                async method() {
                    return async () => new.target;
                }
            }

            Promise.all([
                obj.method().then((fn) => fn()),
                new C().method().then((fn) => fn()),
            ]);
        `)

        expect(result).toEqual([undefined, undefined])
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

    test('async generator next starts execution synchronously', async () => {
        const result = await compileAndRun(`
            let callCount = 0;
            async function* gen() {
                callCount += 1;
                yield 1;
                return 2;
            }
            const iter = gen();
            const first = iter.next();
            const afterFirst = callCount;
            const second = iter.next();
            Promise.all([first, second]).then(([a, b]) => [
                afterFirst,
                callCount,
                a.value,
                a.done,
                b.value,
                b.done
            ]);
        `)
        expect(result).toEqual([1, 1, 1, false, 2, true])
    })

    test('async generator closes when yielded promise rejects', async () => {
        const result = await compileAndRun(`
            const error = new Error('boom');
            async function* gen() {
                yield Promise.reject(error);
                yield 'unreachable';
            }
            const iter = gen();
            iter.next().then(
                () => ['resolved'],
                (reason) => iter.next().then((step) => [
                    reason === error,
                    step.value,
                    step.done
                ])
            );
        `)
        expect(result).toEqual([true, undefined, true])
    })

    test('async generator yield star supports async and sync iterables', async () => {
        const result = await compileAndRun(`
            async function* asyncSource() {
                yield 'a1';
                return 'a2';
            }
            function* syncSource() {
                yield Promise.resolve('s1');
                return 's2';
            }
            async function* gen() {
                const asyncReturn = yield* asyncSource();
                const syncReturn = yield* syncSource();
                return [asyncReturn, syncReturn];
            }
            const iter = gen();
            Promise.all([
                iter.next(),
                iter.next('resume-sync'),
                iter.next(),
            ]).then(([a, b, c]) => [
                a.value,
                a.done,
                b.value,
                b.done,
                c.value[0],
                c.value[1],
                c.done,
            ]);
        `)
        expect(result).toEqual(['a1', false, 's1', false, 'a2', 's2', true])
    })

    test('async generator yield star preserves manual async iterator promise values', async () => {
        const result = await compileAndRun(`
            const inner = Promise.resolve('value');
            const asyncIter = {
                [Symbol.asyncIterator]() {
                    return this;
                },
                next() {
                    return { done: false, value: inner };
                }
            };
            async function* gen() {
                yield* asyncIter;
            }
            gen().next().then((step) => [step.value === inner, step.done]);
        `)
        expect(result).toEqual([true, false])
    })

    test('async generator explicit return awaits before resolving request', async () => {
        const result = await compileAndRun(`
            const actual = [];
            async function* g1() {}
            async function* g2() { return; }
            async function* g3() { return undefined; }
            async function* g4() { return void 0; }

            const done = Promise.resolve(0)
                .then(() => actual.push('tick 1'))
                .then(() => actual.push('tick 2'))
                .then(() => actual.slice());

            g1().next().then(() => actual.push('g1 ret'));
            g2().next().then(() => actual.push('g2 ret'));
            g3().next().then(() => actual.push('g3 ret'));
            g4().next().then(() => actual.push('g4 ret'));
            done;
        `)
        expect(result).toEqual(['tick 1', 'g1 ret', 'g2 ret', 'tick 2', 'g3 ret', 'g4 ret'])
    })

    test('for await consumes async generator rejections through async iterator path', async () => {
        const result = await compileAndRun(`
            const error = new Error('boom');
            async function* readFile() {
                yield Promise.reject(error);
                yield 'unreachable';
            }
            async function* gen() {
                for await (let line of readFile()) {
                    yield line;
                }
            }
            const iter = gen();
            iter.next().then(
                () => ['resolved'],
                (reason) => iter.next().then((step) => [reason === error, step.value, step.done])
            );
        `)
        expect(result).toEqual([true, undefined, true])
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
