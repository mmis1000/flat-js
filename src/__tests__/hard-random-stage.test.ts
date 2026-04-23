import { BOT_R, StageDefinition } from '../../web/game/sim'
import { analyzeHardStageDefinition, resolveStageDefinition } from '../../web/game/core/stage'

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

test('hardRandom resolves deterministically to a validated stage', () => {
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
    expect(analysis!.targetSolutions.every(solution => solution.pathDistance >= 96)).toBe(true)
    expect(first.objects.filter(object => object.kind === 'obstacle')).toHaveLength(5)
    expect(first.objects.filter(object => object.kind === 'target')).toHaveLength(3)
})
