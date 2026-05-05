import { compile } from '../compiler'
import { getLogicalDebugFrames } from '../../web/debug-stack'
import { Fields } from '../runtime'
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

test('async await continuation pause blocks later timer jobs globally', () => {
    const [program] = compile(`
async function main() {
    vmSleep(2).then(() => {
        log('later')
    })
    await vmSleep(1)
    debugger
    log('first')
}
main()
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
    expect(logs).toEqual([])

    session.advanceTime(1)
    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(logs).toEqual([])

    expect(session.advanceTime(10).settledTimers).toBe(0)
    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(logs).toEqual([])

    expect(session.resume().paused).toBe(false)
    expect(logs).toEqual(['first'])

    expect(session.advanceTime(1).settledTimers).toBe(1)
    expect(session.runUntilIdleOrPause().paused).toBe(false)
    expect(logs).toEqual(['first', 'later'])
})

test('debug execution points at a paused promise reaction job', () => {
    const [program] = compile(`
vmSleep(1).then(function reactionJob() {
    const local = 'job'
    debugger
    log(local)
})
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

    session.runUntilIdleOrPause()
    session.advanceTime(1)

    expect(session.runUntilIdleOrPause().paused).toBe(true)
    expect(session.debugExecution).toBe(session.pausedExecution)
    expect(session.debugExecution).not.toBe(session.mainExecution)
    expect(getLogicalDebugFrames(session.debugExecution[Fields.stack])[0].functionName).toBe('reactionJob')

    expect(session.resume().paused).toBe(false)
    expect(logs).toEqual(['job'])
})
