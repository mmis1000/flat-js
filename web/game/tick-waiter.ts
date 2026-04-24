type TickWaiterOptions = {
    scaledWaitMs: () => number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    fastWakeSlackMs?: number
    minRealTimeoutMs?: number
    maxFastWakeStreak?: number
    forcedTimeoutMs?: number
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function createTickWaiter(options: TickWaiterOptions) {
    const now = options.now ?? (() => performance.now())
    const sleep = options.sleep ?? defaultSleep
    const fastWakeSlackMs = options.fastWakeSlackMs ?? 0.25
    const minRealTimeoutMs = options.minRealTimeoutMs ?? 4
    const forcedTimeoutMs = options.forcedTimeoutMs ?? 0

    let nextWakeAt = now()
    let fastWakeStreak = 0

    return async () => {
        const currentNow = now()
        const targetWaitMs = Math.max(0, options.scaledWaitMs())
        const maxFastWakeStreak = options.maxFastWakeStreak ?? Math.max(
            3,
            Math.min(32, Math.ceil(minRealTimeoutMs / Math.max(targetWaitMs, 1e-9)))
        )

        if (nextWakeAt < currentNow - fastWakeSlackMs) {
            nextWakeAt = currentNow
            fastWakeStreak = 0
        }

        nextWakeAt += targetWaitMs
        const delay = nextWakeAt - currentNow

        if (delay >= minRealTimeoutMs) {
            fastWakeStreak = 0
            await sleep(delay)
            return
        }

        fastWakeStreak += 1
        if (fastWakeStreak < maxFastWakeStreak) {
            return
        }

        fastWakeStreak = 0
        await sleep(forcedTimeoutMs)
        nextWakeAt = now()
    }
}
