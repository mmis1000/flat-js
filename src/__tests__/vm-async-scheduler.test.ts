import { compile } from '../compiler'
import { createVmAsyncSession } from '../serialization'

test('VM sleep promise reactions pause and resume as scheduler jobs', () => {
    const [program] = compile(`
vmSleep(1).then(() => {
    debugger
}).then(() => {
    log('end')
})
`, { range: true })
    const logs: string[] = []
    const pausePtrs: Array<number | undefined> = []
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            log: (value: unknown) => logs.push(String(value)),
            __proto__: null,
        }],
        compileFunction: compile,
        onPause: ({ ptr }) => {
            pausePtrs.push(ptr)
        },
    })

    expect(session.runUntilIdleOrPause().paused).toBe(false)
    expect(logs).toEqual([])

    session.advanceTime(1)
    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(pausePtrs).toHaveLength(1)
    expect(logs).toEqual([])

    session.advanceTime(10)
    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(logs).toEqual([])

    expect(session.resume().paused).toBe(false)
    expect(logs).toEqual(['end'])
})

test('VM Promise.resolve reactions drain after the main execution', () => {
    const [program] = compile(`
Promise.resolve('async').then(log)
log('sync')
`, { range: true })
    const logs: string[] = []
    const session = createVmAsyncSession(program, {
        globalThis: Object.create(globalThis),
        scopes: [{
            log: (value: unknown) => logs.push(String(value)),
            __proto__: null,
        }],
        compileFunction: compile,
    })

    expect(session.runUntilIdleOrPause().paused).toBe(false)
    expect(logs).toEqual(['sync', 'async'])
})
