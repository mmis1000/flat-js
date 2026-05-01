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

    test('destructuring bindings in for-of keep per-iteration values', () => {
        const result = compileAndRun(`
            const fns = [];
            for (let [a, b] of [[1, 2], [3, 4]]) {
                fns.push(() => a + b);
            }
            [fns[0](), fns[1]()];
        `)
        expect(result).toEqual([3, 7])
    })

    test('assignment-pattern heads in for-of destructure each entry', () => {
        const result = compileAndRun(`
            var a = 0;
            var b = 0;
            var total = 0;

            for ([a, b] of [[1, 2], [3, 4]]) {
                total += a + b;
            }

            [a, b, total];
        `)
        expect(result).toEqual([3, 4, 10])
    })

    test('member assignment heads receive each entry', () => {
        const result = compileAndRun(`
            var x = {};
            var count = 0;
            for (x.y of [23]) {
                count += 1;
            }
            [x.y, count];
        `)
        expect(result).toEqual([23, 1])
    })

    test('arguments objects are iterable', () => {
        const result = compileAndRun(`
            var out = [];
            (function() {
                for (var value of arguments) {
                    out.push(value);
                }
            }(0, 'a', true));
            out;
        `)
        expect(result).toEqual([0, 'a', true])
    })

    test('strict arguments iteration is unmapped', () => {
        const result = compileAndRun(`
            var out = [];
            (function(a, b, c) {
                'use strict';
                for (var value of arguments) {
                    a = b;
                    b = c;
                    c = 0;
                    out.push(value);
                }
            }(1, 2, 3));
            out;
        `)
        expect(result).toEqual([1, 2, 3])
    })

    test('iterator next method is captured during loop prologue', () => {
        const result = compileAndRun(`
            var calls = 0;
            var iterator = {
                next: function() {
                    calls += 1;
                    if (calls === 1) {
                        iterator.next = function() {
                            throw new Error('next was read again');
                        };
                        return { done: false, value: 7 };
                    }
                    return { done: true };
                }
            };
            var iterable = {};
            iterable[Symbol.iterator] = function() {
                return iterator;
            };

            var total = 0;
            for (var value of iterable) {
                total += value;
            }
            [total, calls];
        `)
        expect(result).toEqual([7, 2])
    })

    test('iterator next must return an object', () => {
        expect(() => compileAndRun(`
            var iterable = {};
            iterable[Symbol.iterator] = function() {
                return {
                    next: function() {
                        return 1;
                    }
                };
            };
            for (var value of iterable) {}
        `)).toThrow(TypeError)
    })

    test('iterator result proxies only expose done and value', () => {
        const result = compileAndRun(`
            var iterable = {};
            var first = true;
            iterable[Symbol.iterator] = function() {
                return {
                    next: function() {
                        if (first) {
                            first = false;
                            return new Proxy({}, {
                                get: function(target, name) {
                                    if (name === 'done') return false;
                                    if (name === 'value') return 23;
                                    throw new Error('unexpected property');
                                }
                            });
                        }
                        return { done: true };
                    }
                };
            };
            var seen = 0;
            for (var value of iterable) {
                seen = value;
            }
            seen;
        `)
        expect(result).toBe(23)
    })

    test('direct eval for-of completion values follow the loop body', () => {
        expect(compileAndRun(`eval('1; for (var a of []) { 2; }')`)).toBe(undefined)
        expect(compileAndRun(`eval('1; for (var a of [0]) { }')`)).toBe(undefined)
        expect(compileAndRun(`eval('1; for (var a of [0]) { 2; }')`)).toBe(2)
        expect(compileAndRun(`eval('1; for (var a of [0]) { 2; break; }')`)).toBe(2)
    })

    test('abrupt for-of exits close iterators', () => {
        const result = compileAndRun(`
            var closes = 0;
            function makeIterable() {
                return {
                    next: function() {
                        return { done: false, value: 1 };
                    },
                    return: function() {
                        closes += 1;
                        return {};
                    },
                    [Symbol.iterator]: function() {
                        return this;
                    }
                };
            }

            for (var a of makeIterable()) {
                break;
            }
            outer: do {
                for (var b of makeIterable()) {
                    continue outer;
                }
            } while (false);
            (function() {
                for (var c of makeIterable()) {
                    return;
                }
            }());
            try {
                for (var d of makeIterable()) {
                    throw 0;
                }
            } catch (err) {}
            closes;
        `)
        expect(result).toBe(4)
    })

    test('for-of continue works through try states', () => {
        const result = compileAndRun(`
            function* values() {
                yield 1;
                yield 1;
            }
            var hits = 0;

            for (var a of values()) {
                try {
                    hits += 1;
                    continue;
                } catch (err) {}
                hits += 100;
            }
            for (var b of values()) {
                try {
                    throw 0;
                } catch (err) {
                    hits += 1;
                    continue;
                }
                hits += 100;
            }
            for (var c of values()) {
                try {
                    throw 0;
                } catch (err) {
                } finally {
                    hits += 1;
                    continue;
                }
                hits += 100;
            }

            hits;
        `)
        expect(result).toBe(6)
    })

    test('outer continue through try closes for-of iterator after finally', () => {
        const result = compileAndRun(`
            var closes = 0;
            var finallyRuns = 0;
            var iterable = {
                next: function() {
                    return { done: false, value: 1 };
                },
                return: function() {
                    closes += 1;
                    return {};
                },
                [Symbol.iterator]: function() {
                    return this;
                }
            };
            var loop = true;

            outer:
            while (loop) {
                loop = false;
                for (var value of iterable) {
                    try {
                        continue outer;
                    } finally {
                        finallyRuns += 1;
                    }
                }
            }

            [finallyRuns, closes];
        `)
        expect(result).toEqual([1, 1])
    })

    test('for-of lexical head keeps TDZ and iteration closures distinct', () => {
        const result = compileAndRun(`
            var probeBefore = function() { return x; };
            let x = 'outside';
            var probeExpr, probeDecl, probeBody;

            for (
                let [x, _, __ = probeDecl = function() { return x; }]
                of
                [['inside', probeExpr = function() { typeof x; }]]
            )
                probeBody = function() { return x; };

            [
                probeBefore(),
                (function() {
                    try {
                        probeExpr();
                        return 'no error';
                    } catch (err) {
                        return err.constructor.name;
                    }
                }()),
                probeDecl(),
                probeBody(),
                x
            ];
        `)
        expect(result).toEqual(['outside', 'ReferenceError', 'inside', 'inside', 'outside'])
    })

    test('for-of head expression closures capture the TDZ scope', () => {
        const result = compileAndRun(`
            let x = 'outside';
            var probeDecl, probeExpr, probeBody;

            for (
                let [x, _ = probeDecl = function() { return x; }]
                of
                (probeExpr = function() { typeof x; }, [['inside']])
            )
                probeBody = function() { return x; };

            [
                (function() {
                    try {
                        probeExpr();
                        return 'no error';
                    } catch (err) {
                        return err.constructor.name;
                    }
                }()),
                probeDecl(),
                probeBody(),
                x
            ];
        `)
        expect(result).toEqual(['ReferenceError', 'inside', 'inside', 'outside'])
    })

    test('for-of close errors replace non-throw completions only', () => {
        expect(() => compileAndRun(`
            var iterable = {
                next: function() { return { done: false, value: 1 }; },
                return: function() { return 0; },
                [Symbol.iterator]: function() { return this; }
            };
            for (var value of iterable) {
                break;
            }
        `)).toThrow(TypeError)

        expect(() => compileAndRun(`
            var iterable = {
                next: function() { return { done: false, value: 1 }; },
                return: 1,
                [Symbol.iterator]: function() { return this; }
            };
            for (var value of iterable) {
                throw new SyntaxError('body');
            }
        `)).toThrow(SyntaxError)
    })

    test('for-of closes iterator when head assignment throws', () => {
        const result = compileAndRun(`
            var closes = 0;
            var target = {
                set value(_) {
                    throw new SyntaxError('setter');
                }
            };
            var iterable = {
                next: function() { return { done: false, value: 1 }; },
                return: function() {
                    closes += 1;
                    return {};
                },
                [Symbol.iterator]: function() { return this; }
            };
            try {
                for (target.value of iterable) {}
            } catch (err) {}
            closes;
        `)
        expect(result).toBe(1)
    })

    test('for-of closes iterator when destructuring head assignment throws', () => {
        const result = compileAndRun(`
            var closes = 0;
            var target = {
                set value(_) {
                    throw new SyntaxError('setter');
                }
            };
            var iterable = {
                next: function() { return { done: false, value: [1] }; },
                return: function() {
                    closes += 1;
                    return {};
                },
                [Symbol.iterator]: function() { return this; }
            };
            try {
                for ([target.value] of iterable) {}
            } catch (err) {}
            closes;
        `)
        expect(result).toBe(1)
    })

    test('for-of does not close iterator when reading next value throws', () => {
        const result = compileAndRun(`
            var closes = 0;
            var iterable = {
                next: function() {
                    return {
                        done: false,
                        get value() {
                            throw new SyntaxError('value');
                        }
                    };
                },
                return: function() {
                    closes += 1;
                    return {};
                },
                [Symbol.iterator]: function() { return this; }
            };
            try {
                for (var value of iterable) {}
            } catch (err) {}
            closes;
        `)
        expect(result).toBe(0)
    })

    test('invalid for-of statement forms are syntax errors', () => {
        expect(() => compile(`for (var x of []) function f() {}`)).toThrow(SyntaxError)
        expect(() => compile(`for (var x of []) label: function f() {}`)).toThrow(SyntaxError)
        expect(() => compile(`for (var x of []) let y;`)).toThrow(SyntaxError)
        expect(() => compile(`for (this of []) {}`)).toThrow(SyntaxError)
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
