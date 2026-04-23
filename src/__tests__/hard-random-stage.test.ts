import { BOT_R, LAYOUT_MIN_GAP, Rect, StageDefinition } from '../../web/game/sim'
import { analyzeHardStageDefinition, resolveStageDefinition } from '../../web/game/core/stage'

const slowTest = process.env.RUN_SLOW_TESTS === '1' ? test : test.skip

function makeCustomStage(): StageDefinition {
    return {
        actors: [
            {
                kind: 'bot',
                x: 80,
                y: 320,
                r: BOT_R,
                heading: 0,
                primary: true,
            },
        ],
        objects: [
            { kind: 'obstacle', x: 220, y: 120, w: 80, h: 40 },
            { kind: 'target', x: 500, y: 40, w: 40, h: 40, hit: false },
        ],
    }
}

test('resolveStageDefinition prefers explicit stage over randomized modes', () => {
    const stage = makeCustomStage()

    const resolved = resolveStageDefinition({
        stage,
        stageMode: 'hardRandom',
        randomizedStage: true,
        seed: 12345,
    })

    expect(resolved).toEqual(stage)
    expect(resolved).not.toBe(stage)
    expect(resolved.actors[0]).not.toBe(stage.actors[0])
    expect(resolved.objects[0]).not.toBe(stage.objects[0])
})

test('legacy randomizedStage matches stageMode random for the same seed', () => {
    const fromLegacy = resolveStageDefinition({
        randomizedStage: true,
        seed: 424242,
    })
    const fromStageMode = resolveStageDefinition({
        stageMode: 'random',
        seed: 424242,
    })

    expect(fromLegacy).toEqual(fromStageMode)
})

function rectDistance(a: Rect, b: Rect) {
    const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
    const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
    return Math.hypot(dx, dy)
}

slowTest('hardRandom resolves deterministically to a validated stage', () => {
    const first = resolveStageDefinition({
        stageMode: 'hardRandom',
        seed: 424242,
    })
    const second = resolveStageDefinition({
        stageMode: 'hardRandom',
        seed: 424242,
    })

    expect(first).toEqual(second)

    const analysis = analyzeHardStageDefinition(first)
    expect(analysis).not.toBeNull()
    expect(analysis!.spawnHasDirectTargetShot).toBe(false)
    expect(analysis!.targetSolutions).toHaveLength(3)
    expect(analysis!.targetSolutions.every(solution => solution.pathDistance > 0)).toBe(true)
    expect(analysis!.obstacleCount).toBeGreaterThanOrEqual(7)
    expect(analysis!.obstacleCount).toBeLessThanOrEqual(10)
    expect(first.objects.filter(object => object.kind === 'obstacle')).toHaveLength(analysis!.obstacleCount)
    expect(first.objects.filter(object => object.kind === 'target')).toHaveLength(3)
})

slowTest.each([
    424242,
    7331,
    9001,
])('hardRandom keeps every obstacle box at least layout gap from every other box for seed %s', (seed) => {
    const stage = resolveStageDefinition({
        stageMode: 'hardRandom',
        seed,
    })
    const obstacles = stage.objects.filter((object): object is Rect & { kind: 'obstacle' } => object.kind === 'obstacle')
    const others: Rect[] = stage.objects.map(object => object)

    expect(obstacles.length).toBeGreaterThanOrEqual(7)

    for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex++) {
        const obstacle = obstacles[obstacleIndex]
        for (const other of others) {
            if (other === obstacle) {
                continue
            }
            expect(rectDistance(obstacle, other)).toBeGreaterThanOrEqual(LAYOUT_MIN_GAP)
        }
    }
})
