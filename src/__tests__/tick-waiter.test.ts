import { createTickWaiter } from '../../web/game/tick-waiter'

test('waiter uses the scheduled delay when there is real time left to wait', async () => {
    let now = 100
    const sleeps: number[] = []
    const waitTick = createTickWaiter({
        scaledWaitMs: () => 5,
        now: () => now,
        sleep: async (ms: number) => {
            sleeps.push(ms)
            now += ms
        },
    })

    await waitTick()

    expect(sleeps).toEqual([5])
})

test('waiter accumulates tiny waits before using a real timeout', async () => {
    let now = 100
    const sleeps: number[] = []
    const waitTick = createTickWaiter({
        scaledWaitMs: () => 0.25,
        now: () => now,
        sleep: async (ms: number) => {
            sleeps.push(ms)
            now += ms
        },
        minRealTimeoutMs: 4,
        maxFastWakeStreak: 32,
    })

    for (let i = 0; i < 15; i++) {
        await waitTick()
    }
    expect(sleeps).toEqual([])

    await waitTick()

    expect(sleeps).toEqual([4])
})

test('waiter reschedules from current time when the client falls behind', async () => {
    let now = 100
    const sleeps: number[] = []
    const waitTick = createTickWaiter({
        scaledWaitMs: () => 5,
        now: () => now,
        sleep: async (ms: number) => {
            sleeps.push(ms)
            now += ms
        },
    })

    await waitTick()
    now = 130
    await waitTick()

    expect(sleeps).toEqual([5, 5])
})

test('waiter forces a real timeout after several fast wakes', async () => {
    let now = 100
    const sleeps: number[] = []
    const waitTick = createTickWaiter({
        scaledWaitMs: () => 0.05,
        now: () => now,
        sleep: async (ms: number) => {
            sleeps.push(ms)
            now += ms
        },
        minRealTimeoutMs: 4,
        maxFastWakeStreak: 3,
        forcedTimeoutMs: 0,
    })

    await waitTick()
    await waitTick()
    await waitTick()

    expect(sleeps).toEqual([0])
})
