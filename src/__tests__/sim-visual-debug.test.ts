import { BOT_R, Sim } from '../../web/game/sim'

function advanceUntil(sim: Sim, predicate: () => boolean, maxTicks: number = 6000) {
    for (let i = 0; i < maxTicks; i++) {
        if (predicate()) {
            return
        }
        sim.advanceOneTick()
    }
    throw new Error('condition not reached within tick budget')
}

test('scan ray visuals keep the first hit type and distance', () => {
    const sim = new Sim()
    ;(sim as any).castRay = () => [
        { distance: 12, type: 'target' },
        { distance: 24, type: 'wall' },
    ]

    sim.armScanBarrier(1)
    sim.advanceOneTick()

    expect(sim.currentScanRays).toEqual([
        expect.objectContaining({
            distance: 12,
            hitType: 'target',
            x1: sim.bot.x,
            y1: sim.bot.y,
        }),
    ])
})

test('scan ray visuals mark misses when no hit is returned', () => {
    const sim = new Sim()
    ;(sim as any).castRay = () => []

    sim.armScanBarrier(1)
    sim.advanceOneTick()

    expect(sim.currentScanRays).toEqual([
        expect.objectContaining({
            hitType: 'miss',
        }),
    ])
})

test('move intent previews the reachable stop point and clears when done', () => {
    const sim = new Sim()
    sim.bot.heading = Math.PI
    const startX = sim.bot.x
    const startY = sim.bot.y

    sim.beginMove(100)

    expect(sim.activeIntent?.kind).toBe('move')
    expect(sim.activeIntent?.startX).toBeCloseTo(startX, 5)
    expect(sim.activeIntent?.startY).toBeCloseTo(startY, 5)
    expect(sim.activeIntent?.endX).toBeCloseTo(BOT_R, 1)
    expect(sim.activeIntent?.endY).toBeCloseTo(startY, 5)
    expect(sim.activeIntent?.endHeading).toBeCloseTo(Math.PI, 5)

    advanceUntil(sim, () => sim.activeIntent === null)

    expect(sim.activeIntent).toBeNull()
    expect(sim.lastMoveReturnedDistance).toBeCloseTo(25, 1)
    expect(sim.bot.x).toBeCloseTo(BOT_R, 1)
})

test('rotate intent stores the future heading and is replaced by the next active job', () => {
    const sim = new Sim()
    sim.bot.heading = 0

    sim.beginRotateRadians(Math.PI / 2)
    sim.beginMove(12)

    expect(sim.activeIntent?.kind).toBe('rotate')
    expect(sim.activeIntent?.startHeading).toBeCloseTo(0, 5)
    expect(sim.activeIntent?.endHeading).toBeCloseTo(Math.PI / 2, 5)
    expect(sim.activeIntent?.endX).toBeCloseTo(sim.bot.x, 5)
    expect(sim.activeIntent?.endY).toBeCloseTo(sim.bot.y, 5)

    advanceUntil(sim, () => sim.activeIntent?.kind === 'move')

    expect(sim.activeIntent?.kind).toBe('move')
    expect(sim.activeIntent?.startHeading).toBeCloseTo(Math.PI / 2, 4)
    expect(sim.activeIntent?.endHeading).toBeCloseTo(Math.PI / 2, 4)

    advanceUntil(sim, () => sim.activeIntent === null)
    expect(sim.activeIntent).toBeNull()
})
