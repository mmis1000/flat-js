import { compile, run } from '../index'
import { CODE_SNIPPETS, CodeSnippet } from '../../web/game/code-snippets'
import { BOT_R, createSimulationSession, StageDefinition } from '../../web/game/sim'

const slowTest = process.env.RUN_SLOW_TESTS === '1' ? test : test.skip

const scanMemorySnippet = CODE_SNIPPETS.find(snippet => snippet.id === 'scan-memory-explorer')

if (!scanMemorySnippet) {
    throw new Error('scan-memory-explorer snippet is missing')
}

function getScanMemorySnippet(): CodeSnippet {
    if (!scanMemorySnippet) {
        throw new Error('scan-memory-explorer snippet is missing')
    }
    return scanMemorySnippet
}

function runSnippet(options: { stageMode?: 'hardRandom', seed?: number, stage?: StageDefinition }, maxTicks = 600000) {
    const { sim, runner } = createSimulationSession(options)
    const label = options.seed != null ? `seed ${options.seed}` : 'custom stage'

    let ticks = 0
    const stepWorld = () => {
        runner.stepOneTick()
        ticks += 1
        if (ticks > maxTicks) {
            throw new Error(`tick budget exceeded for ${label}`)
        }
    }

    const rotate = (deg: number) => {
        const amount = Number(deg) || 0
        if (amount !== 0) {
            sim.beginRotateRadians((amount * Math.PI) / 180)
        }
    }

    const move = (dist: number) => {
        const amount = Number(dist) || 0
        if (amount !== 0) {
            sim.beginMove(amount)
        }
        return 0
    }

    const shoot = () => {
        sim.beginShoot()
    }

    const scan = (rays: number) => {
        sim.armScanBarrier(Number(rays) || 36)
        while (sim.vmBarrierBlocksExecution()) {
            stepWorld()
        }
        let result: { distance: number, type: string }[][] = []
        sim.deliverScanResult(res => {
            result = res
        })
        return result
    }

    const lastMoveDistance = () => {
        sim.armLastMoveDistanceBarrier()
        while (sim.vmBarrierBlocksExecution()) {
            stepWorld()
        }
        let result = 0
        sim.deliverLastMoveDistanceResult(distance => {
            result = distance
        })
        return result
    }

    const [program] = compile(getScanMemorySnippet().code)
    run(
        program,
        0,
        globalThis,
        [{
            print: () => undefined,
            clear: () => undefined,
            rotate,
            move,
            lastMoveDistance,
            shoot,
            scan,
            won: () => sim.view.won,
            __proto__: null,
        }],
        undefined,
        [],
        compile
    )

    return { won: sim.view.won, ticks }
}

function runSnippetOnHardRandomSeed(seed: number, maxTicks = 600000) {
    return runSnippet({
        stageMode: 'hardRandom',
        seed,
    }, maxTicks)
}

slowTest.each([
    7331,
])('scan-memory explorer wins fixed hard-random seed %s', (seed) => {
    const result = runSnippetOnHardRandomSeed(seed)

    expect(result.won).toBe(true)
    expect(result.ticks).toBeGreaterThan(0)
})

test('scan-memory explorer escapes a corner trap near obstacle edges', () => {
    const stage: StageDefinition = {
        actors: [
            {
                kind: 'bot',
                x: 105,
                y: 232,
                r: BOT_R,
                heading: 0,
                primary: true,
            },
        ],
        objects: [
            { kind: 'obstacle', x: 118, y: 236, w: 110, h: 56 },
            { kind: 'obstacle', x: 48, y: 152, w: 72, h: 56 },
            { kind: 'target', x: 292, y: 214, w: 40, h: 40, hit: false },
        ],
    }

    const result = runSnippet({ stage }, 450000)

    expect(result.won).toBe(true)
    expect(result.ticks).toBeGreaterThan(0)
})
