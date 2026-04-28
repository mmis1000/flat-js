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
