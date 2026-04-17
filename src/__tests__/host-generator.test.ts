import { compile } from '../compiler'
import { run } from '../runtime'

describe('Host-side generator entry', () => {
    test('host calls next() on VM generator without VM caller', () => {
        const [program] = compile(`
            function* g() {
                yield 1;
                yield 2;
                return 3;
            }
        `, { evalMode: true })
        const globalObj: { g?: () => Generator<number> } = {}
        run(program, 0, globalObj, [])
        const it = globalObj.g!()
        expect(it.next()).toEqual({ value: 1, done: false })
        expect(it.next()).toEqual({ value: 2, done: false })
        expect(it.next()).toEqual({ value: 3, done: true })
    })

    test('host passes resume values into yield', () => {
        const [program] = compile(`
            function* g() {
                const x = yield 1;
                yield x + 1;
            }
        `, { evalMode: true })
        const globalObj: { g?: () => Generator<number> } = {}
        run(program, 0, globalObj, [])
        const it = globalObj.g!()
        expect(it.next()).toEqual({ value: 1, done: false })
        expect(it.next(10)).toEqual({ value: 11, done: false })
        expect(it.next()).toEqual({ value: undefined, done: true })
    })

    test('initial-state throw() from host propagates', () => {
        const [program] = compile(`
            function* g() {
                yield 1;
            }
        `, { evalMode: true })
        const globalObj: { g?: () => Generator<number> } = {}
        run(program, 0, globalObj, [])
        const it = globalObj.g!()
        expect(() => it.throw(new Error('e'))).toThrow('e')
    })

    test('host return() before start completes without running body', () => {
        const [program] = compile(`
            function* g() {
                yield 1;
            }
        `, { evalMode: true })
        const globalObj: { g?: () => Generator<number> } = {}
        run(program, 0, globalObj, [])
        const it = globalObj.g!()
        expect(it.return('R')).toEqual({ value: 'R', done: true })
        expect(it.next()).toEqual({ value: undefined, done: true })
    })
})
