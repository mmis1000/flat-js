type TickWaiterOptions = {
    scaledWaitMs: () => number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    fastWakeSlackMs?: number
    maxFastWakeStreak?: number
    forcedTimeoutMs?: number
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function createTickWaiter(options: TickWaiterOptions) {
    const now = options.now ?? (() => performance.now())
    const sleep = options.sleep ?? defaultSleep
    const fastWakeSlackMs = options.fastWakeSlackMs ?? 0.25
    const maxFastWakeStreak = options.maxFastWakeStreak ?? 3
    const forcedTimeoutMs = options.forcedTimeoutMs ?? 1

    let nextWakeAt = now()
    let fastWakeStreak = 0

    return async () => {
        const currentNow = now()
        if (nextWakeAt < currentNow - fastWakeSlackMs) {
            nextWakeAt = currentNow
            fastWakeStreak = 0
        }

        nextWakeAt += Math.max(0, options.scaledWaitMs())
        const delay = nextWakeAt - currentNow

        if (delay > fastWakeSlackMs) {
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
