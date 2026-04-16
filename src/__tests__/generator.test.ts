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

    test('try/finally runs on .return()', () => {
        const result = compileAndRun(`
            const log = [];
            function* g() {
                try {
                    log.push('T1');
                    yield 1;
                    log.push('T2');
                } finally {
                    log.push('F');
                }
            }
            const it = g();
            log.push('v=' + it.next().value);
            const r = it.return('R');
            log.push('ret=' + r.value + ',done=' + r.done);
            log;
        `)
        expect(result).toEqual(['T1', 'v=1', 'F', 'ret=R,done=true'])
    })

    test('.return() forwards through yield* and unwinds both finallies', () => {
        const result = compileAndRun(`
            const log = [];
            function* A() {
                try { log.push('A:' + (yield 1)); }
                finally { log.push('AE'); }
            }
            function* B() {
                log.push('B0');
                try {
                    log.push('B1:' + (yield* A()));
                    log.push('B2:' + (yield 2));
                } finally { log.push('BE'); }
            }
            const t = B();
            log.push('v=' + t.next().value);
            const r = t.return();
            log.push('done=' + r.done);
            log;
        `)
        expect(result).toEqual(['B0', 'v=1', 'AE', 'BE', 'done=true'])
    })

    test('yield* forwards .throw() into delegated generator', () => {
        const result = compileAndRun(`
            const log = [];
            function* A() {
                try { log.push('A:' + (yield 1)); }
                catch (e) { log.push('caughtInA:' + e); yield 'caught'; }
                finally { log.push('AE'); }
            }
            function* B() {
                log.push('B0');
                const r = yield* A();
                log.push('after=' + r);
            }
            const t = B();
            log.push('v1=' + t.next().value);
            log.push('v2=' + t.throw('boom').value);
            log.push('v3=' + t.next().value);
            log.push('done=' + t.next().done);
            log;
        `)
        expect(result).toEqual([
            'B0',
            'v1=1',
            'caughtInA:boom',
            'v2=caught',
            'AE',
            'after=undefined',
            'v3=undefined',
            'done=true'
        ])
    })

    test('uncaught throw in delegated gen unwinds to outer catch', () => {
        const result = compileAndRun(`
            const log = [];
            function* A() {
                try { log.push('A:' + (yield 1)); }
                finally { log.push('AE'); }
            }
            function* B() {
                try {
                    log.push('B0');
                    yield* A();
                    log.push('Bafter');
                } catch (e) {
                    log.push('caughtInB:' + e);
                } finally {
                    log.push('BE');
                }
            }
            const t = B();
            log.push('v1=' + t.next().value);
            const r = t.throw('boom');
            log.push('done=' + r.done);
            log;
        `)
        expect(result).toEqual([
            'B0',
            'v1=1',
            'AE',
            'caughtInB:boom',
            'BE',
            'done=true'
        ])
    })

    test('initial-state .return() skips body and completes', () => {
        const result = compileAndRun(`
            const log = [];
            function* g() {
                log.push('ran');
                yield 1;
            }
            const it = g();
            const r = it.return('R');
            [log.length, r.value, r.done];
        `)
        expect(result).toEqual([0, 'R', true])
    })

    test('initial-state .throw() skips body and propagates', () => {
        const result = compileAndRun(`
            const log = [];
            function* g() {
                log.push('ran');
                yield 1;
            }
            const it = g();
            let caught;
            try { it.throw('boom'); } catch (e) { caught = e; }
            [log.length, caught];
        `)
        expect(result).toEqual([0, 'boom'])
    })

    test('nested gen with try/finally: .return() runs both finallies in order', () => {
        const result = compileAndRun(`
            const log = [];
            function* A() {
                try {
                    log.push('A: start');
                    yield 1;
                    log.push('A: end');
                } finally {
                    log.push('A: finally');
                }
            }
            function* B() {
                try {
                    log.push('B: start');
                    yield* A();
                    log.push('B: end');
                } finally {
                    log.push('B: finally');
                }
            }
            const it = B();
            log.push('v=' + it.next().value);
            log.push('ret=' + it.return('R').value);
            log;
        `)
        expect(result).toEqual([
            'B: start',
            'A: start',
            'v=1',
            'A: finally',
            'B: finally',
            'ret=R'
        ])
    })

    test('return works as expected', () => {
        const result = compileAndRun(`
            function* A () {
                yield 1
                yield 2
                yield 3
                return 4
            }

            const iter = A()
            const A1 = iter.next()
            const A2 = iter.next()
            const A3 = iter.next()
            const A4 = iter.next();
            [A1.value, A2.value, A3.value, A4.value]
        `)
        expect(result).toEqual([1, 2, 3, 4])
    })
})
