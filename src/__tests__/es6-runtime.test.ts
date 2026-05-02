import * as vm from 'vm'

import { compileAndRun } from '../index'

test('rest parameters create an unmapped arguments object', () => {
    const result = compileAndRun(`
        function collect(a, ...rest) {
            arguments[0] = 10
            rest[0] = 20
            return [a, arguments[0], rest[0], arguments[1], rest.length]
        }

        collect(1, 2, 3)
    `)

    expect(result).toEqual([1, 10, 20, 2, 2])
})

test('arrow rest parameters work without a synthetic prelude', () => {
    expect(compileAndRun(`
        const collect = (...args) => args.join(',')
        collect('a', 'b', 'c')
    `)).toBe('a,b,c')
})

test('nullish coalescing short-circuits only null and undefined', () => {
    expect(compileAndRun(`
        let calls = 0
        function rhs() {
            calls += 1
            return 9
        }

        [null ?? rhs(), undefined ?? rhs(), 0 ?? rhs(), false ?? rhs(), '' ?? rhs(), calls]
    `)).toEqual([9, 9, 0, false, '', 2])

    expect(() => compileAndRun('0 && 0 ?? true')).toThrow(SyntaxError)
    expect(() => compileAndRun('0 ?? 0 || true')).toThrow(SyntaxError)
    expect(compileAndRun('(0 && 0) ?? true')).toBe(0)
    expect(compileAndRun('0 ?? (0 || true)')).toBe(0)
})

test('optional property and element access short-circuit nullish bases', () => {
    expect(compileAndRun(`
        null?.prop
    `)).toBeUndefined()

    expect(compileAndRun(`
        let keyCalls = 0
        const key = () => {
            keyCalls += 1
            return 'value'
        }

        [undefined?.[key()], keyCalls]
    `)).toEqual([undefined, 0])

    expect(compileAndRun(`
        let keyCalls = 0
        const key = () => {
            keyCalls += 1
            return 'value'
        }

        [({ value: 7 })?.[key()], keyCalls]
    `)).toEqual([7, 1])

    expect(compileAndRun(`
        const slot = Symbol()
        const read = (scope, name) => scope[slot]?.[name]

        read({}, 'missing')
    `)).toBeUndefined()
})

test('logical assignment evaluates the reference once and short-circuits correctly', () => {
    expect(compileAndRun(`
        let keyCalls = 0
        let rhsCalls = 0
        const obj = { a: 0, b: 1, c: null }
        function key(name) {
            keyCalls += 1
            return name
        }
        function rhs(value) {
            rhsCalls += 1
            return value
        }

        obj[key('a')] &&= rhs(2);
        obj[key('b')] &&= rhs(3);
        obj[key('b')] ||= rhs(4);
        obj[key('a')] ||= rhs(5);
        obj[key('b')] ??= rhs(6);
        obj[key('c')] ??= rhs(7);

        [obj.a, obj.b, obj.c, keyCalls, rhsCalls]
    `)).toEqual([5, 3, 7, 6, 3])

    expect(compileAndRun(`
        var andValue = 1
        var orValue = 0
        var nullishValue

        andValue &&= function() {}
        orValue ||= class {}
        nullishValue ??= () => {}

        [andValue.name, orValue.name, nullishValue.name]
    `)).toEqual(['andValue', 'orValue', 'nullishValue'])
})

test('missing binary and compound operators evaluate through VM opcodes', () => {
    expect(compileAndRun(`
        let x = 5
        x %= 3
        x &= 3
        x |= 4
        x ^= 1
        x <<= 2
        x >>= 1
        x **= 2;

        [2 ** 3, x]
    `)).toEqual([8, 196])
})

test('spread calls preserve direct eval semantics', () => {
    expect(compileAndRun(`
        const src = ['40 + 2']
        eval(...src)
    `)).toBe(42)
})

test('spread works for new, super, and super property calls', () => {
    const result = compileAndRun(`
        class Base {
            constructor(...args) {
                this.values = args
            }

            sum(...args) {
                return this.values[0] + args[0] + args[1]
            }
        }

        class Derived extends Base {
            constructor(...args) {
                super(...args)
            }

            sumTwice(...args) {
                return super.sum(...args) * 2
            }
        }

        const derived = new Derived(...[3, 4]);
        [derived.values.join(','), derived.sumTwice(...[5, 6])]
    `)

    expect(result).toEqual(['3,4', 28])
})

test('super property references use home object and receiver semantics', () => {
    const result = compileAndRun(`
        const log = []
        const proto = {
            p: 'ok',
            get value() {
                return this.marker
            },
            method(v) {
                this.count += v
                return this.count
            },
            set saved(v) {
                this.savedThis = this
                this.savedValue = v
            }
        }
        const changedProto = { p: 'bad' }
        const obj = {
            __proto__: proto,
            marker: 'obj',
            count: 1,
            run(key) {
                log.push(super.value)
                log.push(super.method(2))
                super.saved = 7
                return () => super[key]
            }
        }
        const key = {
            toString() {
                Object.setPrototypeOf(obj, changedProto)
                return 'p'
            }
        }

        const read = obj.run(key);
        [
            log.join(','),
            obj.savedThis === obj,
            obj.savedValue,
            read(),
            Object.getPrototypeOf(obj) === changedProto
        ]
    `)

    expect(result).toEqual(['obj,3', true, 7, 'ok', true])
})

test('static super properties and object spread in super arguments keep stack shape', () => {
    const result = compileAndRun(`
        class Parent {
            static get x() {
                return 2
            }
            constructor(obj) {
                this.keyCount = Object.keys(obj).length
            }
        }
        class Child extends Parent {
            constructor() {
                super({...null})
            }
            static read() {
                return super.x
            }
        }

        const child = new Child();
        [Child.read(), child.keyCount]
    `)

    expect(result).toEqual([2, 0])
})

test('super calls bind this once and evaluate to the constructed receiver', () => {
    const result = compileAndRun(`
        const customThis = { custom: true }
        let value
        let secondSuperError
        function Parent() {
            return customThis
        }
        class Child extends Parent {
            constructor() {
                value = super()
                try {
                    super()
                } catch (err) {
                    secondSuperError = err
                }
            }
        }

        new Child();
        [value === customThis, secondSuperError instanceof ReferenceError]
    `)

    expect(result).toEqual([true, true])
})

test('super constructor lookup is dynamic after argument evaluation', () => {
    const result = compileAndRun(`
        let evaluatedArg = false
        let caught
        class C extends Object {
            constructor() {
                try {
                    super(evaluatedArg = true)
                } catch (err) {
                    caught = err
                }
            }
        }

        Object.setPrototypeOf(C, parseInt)
        try {
            new C();
        } catch (err) {}

        [evaluatedArg, caught instanceof TypeError]
    `)

    expect(result).toEqual([true, true])
})

test('extends null and sloppy object super assignment follow super reference rules', () => {
    const result = compileAndRun(`
        let nullProtoError
        class NullBase extends null {
            method() {
                try {
                    super.x
                } catch (err) {
                    nullProtoError = err
                }
            }
        }
        NullBase.prototype.method();

        const obj = {
            method() {
                super.x = 8
                Object.freeze(obj)
                super.y = 9
            }
        }
        obj.method();

        [
            nullProtoError instanceof TypeError,
            Object.prototype.hasOwnProperty.call(obj, 'x'),
            Object.prototype.hasOwnProperty.call(obj, 'y')
        ]
    `)

    expect(result).toEqual([true, true, false])
})

test('tagged templates keep cooked/raw strings, freezing, and per-site identity', () => {
    const result = compileAndRun(`
        function tag(strings) {
            return strings
        }

        function getTemplate() {
            return tag\`a\\nb\`
        }

        const first = getTemplate()
        const second = getTemplate();

        [
            first === second,
            first[0] === 'a\\nb',
            first.raw[0] === 'a\\\\nb',
            Object.isFrozen(first),
            Object.isFrozen(first.raw),
        ]
    `)

    expect(result).toEqual([true, true, true, true, true])
})

test('tagged template method calls preserve this', () => {
    expect(compileAndRun(`
        const obj = {
            value: 7,
            tag(strings) {
                return [this.value, strings[0]]
            }
        }

        obj.tag\`ok\`
    `)).toEqual([7, 'ok'])
})

test('tagged templates reuse the same object identity at one call site', () => {
    expect(compileAndRun(`
        const id = (a) => a
        const m = new Map()

        for (let i = 0; i < 10; i++) {
            m.set(id\`\`, \`\`)
        }

        [...m.keys()].length
    `)).toBe(1)
})

test('destructuring declarations initialize array and object bindings', () => {
    expect(compileAndRun(`
        const { a, b = 2 } = { a: 1 };
        let [x, , y = 4, ...rest] = [10, 20, undefined, 30, 40];

        [a, b, x, y, rest.join(',')]
    `)).toEqual([1, 2, 10, 4, '30,40'])
})

test('object binding rest copies own enumerable leftovers', () => {
    expect(compileAndRun(`
        var source = { a: 1, b: 2 };
        var { a: first, ...rest } = source;
        [first, typeof rest, Object.keys(rest).join(',')]
    `)).toEqual([1, 'object', 'b'])
})

test('object binding rest supports computed exclusions and skips non-enumerable keys', () => {
    expect(compileAndRun(`
        var key = 'a'
        var getterCalls = 0
        var source = {}
        Object.defineProperty(source, 'a', {
            enumerable: true,
            get() {
                getterCalls += 1
                return 1
            }
        })
        Object.defineProperty(source, 'hidden', {
            enumerable: false,
            value: 2
        })
        source.b = 3

        var { [key]: first, ...rest } = source;
        [first, getterCalls, Object.keys(rest).join(','), 'hidden' in rest, rest.b]
    `)).toEqual([1, 1, 'b', false, 3])
})

test('destructuring assignment patterns work for arrays and objects', () => {
    expect(compileAndRun(`
        var a = 0;
        var b = 0;
        var c = 0;
        var rest = [];

        ([a, b = 3, ...rest] = [1, undefined, 4, 5]);
        ({ a: c, b } = { a: 9, b: 2 });

        [a, b, c, rest.join(',')]
    `)).toEqual([1, 2, 9, '4,5'])
})

test('destructuring assignment supports mixed nested rest object patterns', () => {
    expect(compileAndRun(`
        let b, c;
        ([, ...{ '2': b, ...c }] = [1, 2, 3, 4]);

        [b, Array.isArray(c), c[0], c[1], c.length]
    `)).toEqual([4, false, 2, 3, undefined])
})

test('array binding closes iterators that are not exhausted', () => {
    expect(compileAndRun(`
        let doneCallCount = 0
        const iter = {
            [Symbol.iterator]() {
                return {
                    next() {
                        return { value: 1, done: false }
                    },
                    return() {
                        doneCallCount += 1
                        return {}
                    }
                }
            }
        }

        const [x] = iter
        doneCallCount
    `)).toBe(1)
})

test('array binding does not close iterators once exhausted', () => {
    expect(compileAndRun(`
        let doneCallCount = 0
        const iter = {
            [Symbol.iterator]() {
                let index = 0
                return {
                    next() {
                        index += 1
                        return index === 1
                            ? { value: 1, done: false }
                            : { value: undefined, done: true }
                    },
                    return() {
                        doneCallCount += 1
                        return {}
                    }
                }
            }
        }

        let [x, y] = iter
        doneCallCount
    `)).toBe(0)
})

test('array assignment rest closes iterators when assignment-target evaluation throws', () => {
    expect(compileAndRun(`
        var nextCount = 0
        var returnCount = 0
        var iterable = {}
        var iterator = {
            next() {
                nextCount += 1
                return { done: true }
            },
            return() {
                returnCount += 1
                return {}
            }
        }
        var thrower = function() {
            throw new Error('boom')
        }
        iterable[Symbol.iterator] = function() {
            return iterator
        }

        try {
            0, [...{}[thrower()]] = iterable
        } catch (e) {}

        [nextCount, returnCount]
    `)).toEqual([0, 1])
})

test('array assignment rest materializes undefined values from holey arrays', () => {
    expect(compileAndRun(`
        var x = null
        let length
        var vals = [,];

        [...{ 0: x, length }] = vals;

        [x === undefined, length]
    `)).toEqual([true, 1])
})

test('array iterator close requires an object return result on normal completion', () => {
    expect(() => compileAndRun(`
        const iter = {
            [Symbol.iterator]() {
                return {
                    next() {
                        return { value: 1, done: false }
                    },
                    return() {
                        return null
                    }
                }
            }
        }

        const [x] = iter
    `)).toThrow(TypeError)
})

test('destructuring assignment evaluates iterator done before coercing the property key', () => {
    expect(compileAndRun(`
        var log = [];

        function source() {
            log.push('source');
            var iterator = {
                next: function() {
                    log.push('iterator-step');
                    return {
                        get done() {
                            log.push('iterator-done');
                            return true;
                        },
                        get value() {
                            log.push('iterator-value');
                        }
                    };
                }
            };
            var source = {};
            source[Symbol.iterator] = function() {
                log.push('iterator');
                return iterator;
            };
            return source;
        }

        function target() {
            log.push('target');
            return target = {
                set q(v) {
                    log.push('set');
                }
            };
        }

        function targetKey() {
            log.push('target-key');
            return {
                toString: function() {
                    log.push('target-key-tostring');
                    return 'q';
                }
            };
        }

        ([target()[targetKey()]] = source());
        log;
    `)).toEqual([
        'source',
        'iterator',
        'target',
        'target-key',
        'iterator-step',
        'iterator-done',
        'target-key-tostring',
        'set',
    ])
})

test('generator return closes iterators during destructuring assignment suspension', () => {
    expect(compileAndRun(`
        var returnCount = 0
        var iterable = {}
        var iterator = {
            next() {
                return { done: false, value: undefined }
            },
            return() {
                returnCount += 1
                return {}
            }
        }
        iterable[Symbol.iterator] = function() {
            return iterator
        }

        function* g() {
            var vals = iterable
            var result
            result = [ {} = yield ] = vals
        }

        var result
        var iter = g()
        iter.next()
        result = iter.return(777);

        [returnCount, result.value, result.done]
    `)).toEqual([1, 777, true])
})

test('generator return close errors override the pending return result in destructuring assignment', () => {
    expect(() => compileAndRun(`
        var iterable = {}
        var iterator = {
            next() {
                return { done: false, value: undefined }
            },
            return() {
                throw new Error('close')
            }
        }
        iterable[Symbol.iterator] = function() {
            return iterator
        }

        function* g() {
            var vals = iterable
            var result
            result = [ {} = yield ] = vals
        }

        var result
        var iter = g()
        iter.next()
        result = iter.return(777);
    `)).toThrow('close')
})

test('generator throw preserves the original abrupt completion when iterator close also throws', () => {
    expect(compileAndRun(`
        var returnCount = 0
        var iterable = {}
        var iterator = {
            next() {
                return { done: false, value: undefined }
            },
            return() {
                returnCount += 1
                throw new Error('close')
            }
        }
        iterable[Symbol.iterator] = function() {
            return iterator
        }

        function* g() {
            var vals = iterable
            var result
            result = [ {} = yield ] = vals
        }

        var result
        var iter = g()
        iter.next()

        try {
            result = iter.throw(new Error('outer'));
        } catch (error) {
            [returnCount, error.message]
        }
    `)).toEqual([1, 'outer'])
})

test('destructured and default parameters keep arguments unmapped', () => {
    expect(compileAndRun(`
        function collect(a = 1, { b } = { b: a + 1 }, ...rest) {
            arguments[0] = 10
            return [a, b, arguments[0], rest.join(',')]
        }

        collect(undefined, undefined, 3, 4)
    `)).toEqual([1, 2, 10, '3,4'])
})

test('parameter defaults observe parameter TDZ before body activation', () => {
    expect(compileAndRun(`
        var callCount = 0
        try {
            (function (x = x) {
                callCount += 1
            })()
        } catch (error) {
            [error instanceof ReferenceError, callCount]
        }
    `)).toEqual([true, 0])

    expect(compileAndRun(`
        var callCount = 0
        try {
            (function (x = y, y) {
                callCount += 1
            })()
        } catch (error) {
            [error instanceof ReferenceError, callCount]
        }
    `)).toEqual([true, 0])
})

test('parameter defaults cannot see body function bindings before body activation', () => {
    expect(() => compileAndRun(`
        {
            const a = (b = __paramBodyFunction) => {
                function __paramBodyFunction() {}
                return b
            }

            a()
        }
    `)).toThrow(/__paramBodyFunction is not defined/)
})

test('parameter defaults cannot see body var bindings before body activation', () => {
    expect(() => compileAndRun(`
        {
            const a = (b = __paramBodyVar) => {
                var __paramBodyVar = 1
                return b
            }

            a()
        }
    `)).toThrow(/__paramBodyVar is not defined/)
})

test('closures created during parameter defaults do not capture future body bindings', () => {
    expect(() => compileAndRun(`
        {
            const a = (read = () => __paramClosureBodyFunction) => {
                function __paramClosureBodyFunction() {}
                return read()
            }

            a()
        }
    `)).toThrow(/__paramClosureBodyFunction is not defined/)
})

test('direct eval in parameter defaults writes var bindings into the function variable environment', () => {
    expect(compileAndRun(`
        {
            const a = function (b1 = eval('var c = 1; c')) {
                return [b1, c]
            }

            a()
        }
    `)).toEqual([1, 1])
})

test('later parameter defaults read eval-created vars before falling back to outer bindings', () => {
    expect(compileAndRun(`
        {
            const c = 3;
            const a = (b1 = eval('var c = 1; 0'), b2 = c + 1) => [b1, b2];
            const result = a();

            [result[0], result[1], c]
        }
    `)).toEqual([0, 2, 3])
})

test('closures in parameter defaults observe eval-created parameter vars', () => {
    expect(compileAndRun(`
        var x = 'outside'
        var probe1, probe2, probeBody

        ;(function(
            _ = probe1 = function() { return x },
            ...[__ = (eval('var x = "inside"'), probe2 = function() { return x })]
        ) {
            probeBody = function() { return x }
        })();

        [probe1(), probe2(), probeBody()]
    `)).toEqual(['inside', 'inside', 'inside'])
})

test('sloppy direct eval rejects var declarations over lexical eval environments', () => {
    expect(compileAndRun(`
        var callCount = 0
        try {
            (function(a = eval('var a = 42')) {
                callCount += 1
            })()
        } catch (error) {
            [error instanceof SyntaxError, callCount]
        }
    `)).toEqual([true, 0])

    expect(compileAndRun(`
        try {
            (function() {
                let x
                eval('var x')
            })()
        } catch (error) {
            error instanceof SyntaxError
        }
    `)).toBe(true)
})

test('sloppy direct eval rejects arguments var in parameter eval environments', () => {
    expect(compileAndRun(`
        var callCount = 0
        try {
            (function(p = eval('var arguments')) {
                callCount += 1
            })()
        } catch (error) {
            [error instanceof SyntaxError, callCount]
        }
    `)).toEqual([true, 0])
})

test('eval declaration instantiation uses eval lexical and variable environments', () => {
    const global = Object.create(globalThis)
    global.globalThis = global

    expect(compileAndRun(`
        var initialExisting, localInitial, localDeleted, strictFunctionType
        var __flatEvalExisting = 23

        eval('let __flatEvalLexical = 1')
        var lexicalHidden = typeof __flatEvalLexical === 'undefined'

        eval('initialExisting = __flatEvalExisting; var __flatEvalExisting = 45')
        var existingDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__flatEvalExisting')

        eval('var __flatEvalNew = 11')
        var newDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__flatEvalNew')

        ;(function () {
            eval('localInitial = __flatEvalLocal; delete __flatEvalLocal; localDeleted = function () { try { __flatEvalLocal; return false } catch (error) { return error instanceof ReferenceError } }; var __flatEvalLocal')
        })()

        ;(function () {
            eval('"use strict"; function __flatStrictEvalFunction () {}')
            strictFunctionType = typeof __flatStrictEvalFunction
        })()

        var out = [
            lexicalHidden,
            initialExisting,
            __flatEvalExisting,
            existingDescriptor.configurable,
            globalThis.__flatEvalNew,
            newDescriptor.configurable,
            localInitial,
            localDeleted(),
            strictFunctionType
        ]
        delete globalThis.__flatEvalNew
        out
    `, global)).toEqual([true, 23, 45, false, 11, true, undefined, true, 'undefined'])
})

test('parameter-expression functions resolve captured outer block bindings', () => {
    expect(compileAndRun(`
        {
            const add = (a, b) => a + b
            const seed = 5
            const expr = (value, fallback = seed) => add(value, fallback)
            const block = (value, fallback = seed) => {
                return add(value, fallback)
            }

            [expr(1), block(2)]
        }
    `)).toEqual([6, 7])

    expect(compileAndRun(`
        {
            const read = () => 1
            const parent = (unused = 0) => {
                return {
                    step(debug = false) {
                        try {
                            const tag = 1
                            switch (tag) {
                                case 1:
                                    return read()
                            }
                        } catch (error) {
                            return error && error.message || error
                        }
                    }
                }.step()
            }

            parent()
        }
    `)).toBe(1)
})

test('catch binding patterns destructure the thrown value', () => {
    expect(compileAndRun(`
        try {
            throw { a: 1, b: 2 }
        } catch ({ a, b }) {
            [a, b]
        }
    `)).toEqual([1, 2])
})

test('destructured catch parameter initializers and catch block closures use distinct lexical scopes', () => {
    expect(compileAndRun(`
        var probeParam, probeBlock
        let x = 'outside'

        try {
            throw []
        } catch ([_ = probeParam = function () { return x }]) {
            probeBlock = function () { return x }
            let x = 'inside'
        }

        [probeParam(), probeBlock()]
    `)).toEqual(['outside', 'inside'])
})

test('simple catch bindings shadow parameter-expression scopes', () => {
    expect(compileAndRun(`
        const fn = (error = false) => {
            try {
                throw 'caught'
            } catch (error) {
                return error
            }
        }

        fn()
    `)).toBe('caught')
})

test('array and object literals use the provided realm prototypes', () => {
    const context = vm.createContext({ console, require })
    const vmGlobal = vm.runInContext(`
        const g = Object.create(globalThis)
        g.globalThis = g
        g
    `, context)

    const result = compileAndRun(`
        delete Array.prototype[Symbol.iterator]

        let threwTypeError = false
        try {
            const [x] = []
        } catch (e) {
            threwTypeError = e.constructor === TypeError
        }

        [
            Object.getPrototypeOf([]) === Array.prototype,
            Object.getPrototypeOf({}) === Object.prototype,
            threwTypeError,
        ]
    `, vmGlobal)

    expect(result).toEqual([true, true, true])
})

test('object literal __proto__ data properties mutate only non-computed prototypes', () => {
    expect(compileAndRun(`
        const proto = { marker: 1 }
        const value = { own: true }
        const nullProto = { __proto__: null }
        const objectProto = { __proto__: proto }
        const primitiveProto = { __proto__: 1 }
        const computedProto = { ['__proto__']: value }
        const functionProto = { __proto__: function () {} };

        [
            Object.getPrototypeOf(nullProto) === null,
            Object.getOwnPropertyDescriptor(nullProto, '__proto__') === undefined,
            Object.getPrototypeOf(objectProto) === proto,
            Object.getOwnPropertyDescriptor(objectProto, '__proto__') === undefined,
            Object.getPrototypeOf(primitiveProto) === Object.prototype,
            Object.getOwnPropertyDescriptor(primitiveProto, '__proto__') === undefined,
            Object.prototype.hasOwnProperty.call(computedProto, '__proto__'),
            computedProto.__proto__ === value,
            Object.getPrototypeOf(functionProto).name
        ]
    `)).toEqual([true, true, true, true, true, true, true, true, ''])
})

test('duplicate non-computed __proto__ data properties are rejected', () => {
    expect(() => compileAndRun(`
        ({
            __proto__: null,
            other: null,
            '__proto__': null,
        })
    `)).toThrow(SyntaxError)

    expect(compileAndRun(`
        var __proto__ = 2
        var proto = {}
        var obj = {
            __proto__: proto,
            ['__proto__']: 1,
            __proto__,
            __proto__() {},
            get __proto__() { return 3 },
            set __proto__(value) {},
        };

        [
            Object.getPrototypeOf(obj) === proto,
            Object.getOwnPropertyDescriptor(obj, '__proto__').get() === 3
        ]
    `)).toEqual([true, true])
})

test('computed object literal keys are coerced before value evaluation', () => {
    expect(compileAndRun(`
        const log = []
        const key = {
            toString() {
                log.push('key')
                return 'id'
            }
        }

        const obj = {
            [key]: (log.push('value'), 1),
        };

        [log.join(','), Object.keys(obj).join(','), obj.id]
    `)).toEqual(['key,value', 'id', 1])
})

test('object property named evaluation covers anonymous functions and classes', () => {
    expect(compileAndRun(`
        const namedSym = Symbol('test262')
        const anonSym = Symbol()
        const obj = {
            id: function () {},
            arrow: () => {},
            gen: function* () {},
            cls: class {},
            xId: (0, function () {}),
            [anonSym]: function () {},
            [namedSym]: class {},
        };

        [
            obj.id.name,
            obj.arrow.name,
            obj.gen.name,
            obj.cls.name,
            obj.xId.name === 'xId',
            obj[anonSym].name,
            obj[namedSym].name
        ]
    `)).toEqual(['id', 'arrow', 'gen', 'cls', false, '', '[test262]'])
})

test('object method and accessor names use property keys', () => {
    expect(compileAndRun(`
        const namedSym = Symbol('desc')
        const anonSym = Symbol()
        const obj = {
            id() {},
            *gen() {},
            get value() { return 1 },
            set value(v) {},
            [namedSym]() {},
            get [anonSym]() { return 1 },
        };

        const valueDesc = Object.getOwnPropertyDescriptor(obj, 'value')
        const anonDesc = Object.getOwnPropertyDescriptor(obj, anonSym);

        [
            obj.id.name,
            obj.gen.name,
            valueDesc.get.name,
            valueDesc.set.name,
            obj[namedSym].name,
            anonDesc.get.name
        ]
    `)).toEqual(['id', 'gen', 'get value', 'set value', '[desc]', 'get '])
})

test('arrow binding initializers infer names from binding identifiers', () => {
    expect(compileAndRun(`
        const a = () => {}
        const b = () => {}

        [a.name, b.name]
    `)).toEqual(['a', 'b'])
})

test('update expressions use ToNumeric and preserve prefix/postfix results', () => {
    expect(compileAndRun(`
        (() => {
            let stringValue = '1'
            let stringOld = stringValue++
            let objectValue = { valueOf() { return 1.5 } }
            let objectOld = objectValue++
            let boolValue = false
            let boolOld = boolValue++
            let nullValue = null
            let nullOld = nullValue--
            let bigintValue = 1n
            let bigintOld = bigintValue++
            let parenthesized = '2'
            let parenthesizedOld = (parenthesized)++

            return [
                stringOld, stringValue,
                objectOld, objectValue,
                boolOld, boolValue,
                nullOld, nullValue,
                bigintOld, bigintValue,
                parenthesizedOld, parenthesized,
            ]
        })()
    `)).toEqual([1, 2, 1.5, 2.5, 0, 1, 0, -1, 1n, 2n, 2, 3])

    expect(compileAndRun(`
        (() => {
            let stringValue = '1'
            let nanValue = 'x'
            let bigintValue = 2n

            return [
                ++stringValue,
                Number.isNaN(++nanValue),
                --bigintValue,
            ]
        })()
    `)).toEqual([2, true, 1n])
})

test('computed update and delete references coerce property keys once', () => {
    expect(compileAndRun(`
        (() => {
            const log = []
            const base = { 1: 1, gone: 2 }
            const updateKey = {
                toString() {
                    log.push('update')
                    return 1
                }
            }
            const deleteKey = {
                toString() {
                    log.push('delete')
                    return 'gone'
                }
            }

            const old = base[updateKey]++
            const deleted = delete base[deleteKey]

            return [old, base[1], deleted, 'gone' in base, log.join(',')]
        })()
    `)).toEqual([1, 2, true, false, 'update,delete'])
})

test('computed assignment delays property-key coercion until after rhs evaluation', () => {
    expect(compileAndRun(`
        (() => {
            const log = []
            const base = {}
            const key = {
                toString() {
                    log.push('key')
                    return 'x'
                }
            }
            function value() {
                log.push('value')
                return 5
            }

            base[key] = value()
            return [base.x, log.join(',')]
        })()
    `)).toEqual([5, 'value,key'])

    expect(compileAndRun(`
        (() => {
            const key = {
                toString() {
                    throw new RangeError('key')
                }
            }
            function value() {
                throw new TypeError('value')
            }

            try {
                null[key] = value()
            } catch (error) {
                return error instanceof TypeError
            }
        })()
    `)).toBe(true)
})

test('nullish update bases throw before key coercion after evaluating the key expression', () => {
    expect(compileAndRun(`
        (() => {
            let called = false
            const prop = {
                toString() {
                    called = true
                    return 'x'
                }
            }

            try {
                ++null[prop]
            } catch (error) {
                return [error instanceof TypeError, called]
            }
        })()
    `)).toEqual([true, false])

    expect(compileAndRun(`
        (() => {
            let called = false
            function prop() {
                called = true
                throw new RangeError('key')
            }

            try {
                ++null[prop()]
            } catch (error) {
                return [error instanceof RangeError, called]
            }
        })()
    `)).toEqual([true, true])
})

test('destructuring assignment allows duplicate __proto__ property names', () => {
    const context = vm.createContext({ console, require })
    const vmGlobal = vm.runInContext(`
        const g = Object.create(globalThis)
        g.globalThis = g
        g
    `, context)

    expect(compileAndRun(`
        var value = Object.defineProperty({}, '__proto__', { value: 123 })
        var x
        var y

        ;({ __proto__: x, __proto__: y } = value);

        [x, y]
    `, vmGlobal)).toEqual([123, 123])
})

test('delete uses ECMAScript delete results for globals and properties', () => {
    const context = vm.createContext({ console, require })
    const vmGlobal = vm.runInContext(`
        const g = Object.create(globalThis)
        g.globalThis = g
        g
    `, context)

    expect(compileAndRun(`
        var declared = 1
        implicit = 2
        this.assigned = 3
        Object.defineProperty(this, 'fixed', {
            value: 4,
            configurable: false,
        })

        const deleteDeclared = delete declared
        const deleteDeclaredViaThis = delete this.declared
        const deleteImplicit = delete implicit
        const implicitType = typeof implicit
        const deleteAssigned = delete this.assigned
        const deleteFixed = delete this.fixed;

        [
            deleteDeclared,
            deleteDeclaredViaThis,
            deleteImplicit,
            implicitType,
            deleteAssigned,
            deleteFixed,
            'declared' in this,
            'assigned' in this,
        ]
    `, vmGlobal)).toEqual([false, false, true, 'undefined', true, false, true, false])

    expect(compileAndRun(`
        [
            delete NaN,
            delete 'Test262'[100],
        ]
    `, vmGlobal)).toEqual([false, true])

    expect(() => compileAndRun(`
        (function() {
            'use strict'
            const obj = {}
            Object.defineProperty(obj, 'x', {
                value: 1,
                configurable: false,
            })
            delete obj.x
        })()
    `)).toThrow(TypeError)
})

test('strict update re-checks unresolved globals during PutValue', () => {
    const context = vm.createContext({ console, require })
    const vmGlobal = vm.runInContext(`
        const g = Object.create(globalThis)
        g.globalThis = g
        g
    `, context)

    expect(compileAndRun(`
        Object.defineProperty(this, 'x', {
            configurable: true,
            get() {
                delete this.x
                return 2
            }
        })

        let thrown = false
        ;(function() {
            'use strict'
            try {
                ++x
            } catch (error) {
                thrown = error instanceof ReferenceError
            }
        })();

        [thrown, 'x' in this]
    `, vmGlobal)).toEqual([true, false])
})

test('sloppy writes to readonly global value properties do not throw', () => {
    const context = vm.createContext({ console, require })
    const vmGlobal = vm.runInContext(`
        const g = Object.create(globalThis)
        g.globalThis = g
        g
    `, context)

    expect(() => compileAndRun(`
        var Infinity = 1
        Infinity = 'changed'
        var NaN = 2
        NaN = 'changed'
        var undefined = 3
        undefined = 'changed'

        1
    `, vmGlobal)).not.toThrow()
})

test('strict delete and invalid update targets are early errors', () => {
    expect(() => compileAndRun(`
        'use strict'
        delete target
    `)).toThrow(SyntaxError)

    expect(() => compileAndRun(`
        this++
    `)).toThrow(SyntaxError)

    expect(() => compileAndRun(`
        function f() {
            new.target++
        }
    `)).toThrow(SyntaxError)

    expect(() => compileAndRun(`
        'use strict'
        eval++
    `)).toThrow(SyntaxError)

    expect(() => compileAndRun(`
        'use strict'
        arguments--
    `)).toThrow(SyntaxError)
})

test('semantic diagnostics for JavaScript early errors are compile errors', () => {
    for (const source of [
        `
            'use strict'
            arguments &&= 20
        `,
        `
            'use strict';
            (eval) = 20
        `,
        `
            'use strict';
            (arguments) = 20
        `,
        `
            1 ||= 20
        `,
        `
            const obj = {}
            obj?.value = 1
        `,
        `
            const tag = () => {}
            tag?.\`value\`
        `,
        `
            function f(...args,) {}
        `,
        `
            continue
        `,
        `
            break missing
        `,
        `
            return 1
        `,
        `
            switch (1) {
                default:
                    break
                default:
                    break
            }
        `,
        `
            for (var x = 1 in {}) {}
        `,
        `
            'use strict'
            function target() {}
            for (target() in {}) {}
        `,
        `
            'use strict'
            function target() {}
            for (target() of []) {}
        `,
        `
            function nonSimple(a = 1) {
                'use strict'
            }
        `,
        `
            function* g(a = yield 1) {}
        `,
        `
            class Base {
                get value(param) {
                    return param
                }
            }
        `,
        `
            class Base {
                constructor() {
                    super()
                }
            }
        `,
        `
            class DuplicateConstructor {
                constructor() {}
                constructor(value) {}
            }
        `,
        `
            function f() {
                class C {
                    x = arguments
                }
            }
        `,
        `
            function f() {
                class C {
                    x = () => arguments
                }
            }
        `,
        `
            function f() {
                class C {
                    static {
                        arguments
                    }
                }
            }
        `,
        `
            var C = class {
                x = () => arguments
            }
        `,
        `
            class C {
                static {
                    arguments
                }
            }
        `,
        `
            class C {
                x = class {
                    y = arguments
                }
            }
        `,
        `
            'use strict'
            {
                async function duplicateName() {}
                class duplicateName {}
            }
        `,
        `
            let duplicate
            let duplicate
        `,
        `
            /(?<known>.)\\k<missing>/u
        `,
    ]) {
        expect(() => compileAndRun(source)).toThrow(SyntaxError)
    }

    expect(compileAndRun(`
        if (true);
        7
    `)).toBe(7)

    expect(compileAndRun(`
        ({ value: 1, value: 2 }).value
    `)).toBe(2)

    expect(() => compileAndRun(`
        missingSemanticCheck += 1
    `)).toThrow(ReferenceError)

    expect(() => compileAndRun(`
        class C {
            x = function () {
                return arguments
            }
        }
    `)).not.toThrow()
})

test('destructuring default initializers infer names for anonymous functions and classes', () => {
    expect(compileAndRun(`
        let [a = function(){}, b = () => {}, c = class {}, d = async function(){}, e = function*(){}] = []
        let { f = function(){}, g = class {} } = {}
        var h
        var i

        ([h = function(){}] = []);
        ({ i = class {} } = {});

        function collect([j = function(){}] = []) {
            return j.name
        }

        [a.name, b.name, c.name, d.name, e.name, f.name, g.name, h.name, i.name, collect()]
    `)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
})

test('generator parameter destructuring errors throw at call time', () => {
    expect(compileAndRun(`
        const arg = []
        Object.defineProperty(arg, Symbol.iterator, {
            configurable: true,
            get() {
                throw new TypeError('boom')
            }
        })

        let generatorFnError = false
        let generatorMethodError = false
        let asyncGeneratorFnError = false
        let asyncGeneratorMethodError = false

        const fn = function*([x]) {}
        const asyncFn = async function*([x]) {}
        const obj = {
            *method([x]) {},
            async *asyncMethod([x]) {}
        }

        try {
            fn(arg)
        } catch (e) {
            generatorFnError = e.constructor === TypeError
        }

        try {
            obj.method(arg)
        } catch (e) {
            generatorMethodError = e.constructor === TypeError
        }

        try {
            asyncFn(arg)
        } catch (e) {
            asyncGeneratorFnError = e.constructor === TypeError
        }

        try {
            obj.asyncMethod(arg)
        } catch (e) {
            asyncGeneratorMethodError = e.constructor === TypeError
        }

        [generatorFnError, generatorMethodError, asyncGeneratorFnError, asyncGeneratorMethodError]
    `)).toEqual([true, true, true, true])
})
