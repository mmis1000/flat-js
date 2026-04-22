import {
    BOT_R,
    createSimulationSession,
    createSimulationTestHarness,
    StageDefinition,
} from '../../web/game/sim'

function makeSingleBotStage(overrides?: Partial<StageDefinition['actors'][number]>): StageDefinition {
    return {
        actors: [
            {
                kind: 'bot',
                x: 40,
                y: 200,
                r: BOT_R,
                heading: -Math.PI / 2,
                primary: true,
                ...overrides,
            },
        ],
        objects: [],
    }
}

test('sim exposes a frozen read-only view and no public tick method', () => {
    const { sim } = createSimulationSession()

    expect((sim as any).advanceOneTick).toBeUndefined()
    expect(Object.isFrozen(sim.view)).toBe(true)
    expect(Object.isFrozen(sim.view.discs)).toBe(true)
    expect(Object.isFrozen(sim.view.targets)).toBe(true)
    expect(Object.isFrozen(sim.view.bot)).toBe(true)
})

test('scan ray visuals keep the first hit type and distance', () => {
    const stage: StageDefinition = {
        actors: [
            {
                kind: 'bot',
                x: 100,
                y: 100,
                r: BOT_R,
                heading: 0,
                primary: true,
            },
        ],
        objects: [
            { kind: 'target', x: 130, y: 80, w: 40, h: 40, hit: false },
        ],
    }
    const { sim, runner } = createSimulationSession({ stage })

    sim.armScanBarrier(1)
    runner.stepOneTick()

    expect(sim.view.currentScanRays).toEqual([
        expect.objectContaining({
            distance: 15,
            hitType: 'target',
            x1: 100,
            y1: 100,
        }),
    ])
})

test('scan ray visuals can represent misses through the test harness hook', () => {
    const harness = createSimulationTestHarness({
        stage: makeSingleBotStage({ x: 120, y: 220, heading: 0 }),
        hooks: {
            castRay: () => [],
        },
    })

    harness.sim.armScanBarrier(1)
    harness.runner.stepOneTick()

    expect(harness.sim.view.currentScanRays).toEqual([
        expect.objectContaining({
            hitType: 'miss',
        }),
    ])
})

test('move intent previews the reachable stop point and clears when done', () => {
    const harness = createSimulationTestHarness({
        stage: makeSingleBotStage({ heading: Math.PI }),
    })
    const startX = harness.sim.view.bot!.x
    const startY = harness.sim.view.bot!.y

    harness.sim.beginMove(100)

    expect(harness.sim.view.activeIntent?.kind).toBe('move')
    expect(harness.sim.view.activeIntent?.startX).toBeCloseTo(startX, 5)
    expect(harness.sim.view.activeIntent?.startY).toBeCloseTo(startY, 5)
    expect(harness.sim.view.activeIntent?.endX).toBeCloseTo(BOT_R, 1)
    expect(harness.sim.view.activeIntent?.endY).toBeCloseTo(startY, 5)
    expect(harness.sim.view.activeIntent?.endHeading).toBeCloseTo(Math.PI, 5)

    harness.stepUntil(view => view.activeIntent === null)

    expect(harness.sim.view.activeIntent).toBeNull()
    expect(harness.sim.view.lastMoveReturnedDistance).toBeCloseTo(25, 1)
    expect(harness.sim.view.bot!.x).toBeCloseTo(BOT_R, 1)
})

test('rotate intent stores the future heading and is replaced by the next active job', () => {
    const harness = createSimulationTestHarness({
        stage: makeSingleBotStage({ x: 120, y: 120, heading: 0 }),
    })

    harness.sim.beginRotateRadians(Math.PI / 2)
    harness.sim.beginMove(12)

    expect(harness.sim.view.activeIntent?.kind).toBe('rotate')
    expect(harness.sim.view.activeIntent?.startHeading).toBeCloseTo(0, 5)
    expect(harness.sim.view.activeIntent?.endHeading).toBeCloseTo(Math.PI / 2, 5)
    expect(harness.sim.view.activeIntent?.endX).toBeCloseTo(harness.sim.view.bot!.x, 5)
    expect(harness.sim.view.activeIntent?.endY).toBeCloseTo(harness.sim.view.bot!.y, 5)

    harness.stepUntil(view => view.activeIntent?.kind === 'move')

    expect(harness.sim.view.activeIntent?.kind).toBe('move')
    expect(harness.sim.view.activeIntent?.startHeading).toBeCloseTo(Math.PI / 2, 4)
    expect(harness.sim.view.activeIntent?.endHeading).toBeCloseTo(Math.PI / 2, 4)

    harness.stepUntil(view => view.activeIntent === null)
    expect(harness.sim.view.activeIntent).toBeNull()
})

test('barrier state only advances when the runner steps', () => {
    const { sim, runner } = createSimulationSession({
        stage: makeSingleBotStage({ x: 120, y: 120, heading: 0 }),
    })

    sim.armScanBarrier(1)
    expect(sim.view.currentScanRays).toBeUndefined()

    runner.stepOneTick()
    expect(sim.view.currentScanRays).toBeDefined()
})

