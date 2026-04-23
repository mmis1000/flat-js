import { compile, run } from '../index'
import { CODE_SNIPPETS, CodeSnippet } from '../../web/game/code-snippets'
import { createSimulationSession } from '../../web/game/sim'

const rotateSweepSnippet = CODE_SNIPPETS.find(snippet => snippet.id === 'rotate-sweep')

if (!rotateSweepSnippet) {
    throw new Error('rotate-sweep snippet is missing')
}

function getRotateSweepSnippet(): CodeSnippet {
    if (!rotateSweepSnippet) {
        throw new Error('rotate-sweep snippet is missing')
    }
    return rotateSweepSnippet
}

function runSnippetOnRandomSeed(seed: number, maxTicks = 400000) {
    const { sim, runner } = createSimulationSession({
        stageMode: 'random',
        seed,
    })

    let ticks = 0
    const stepWorld = () => {
        runner.stepOneTick()
        ticks += 1
        if (ticks > maxTicks) {
            throw new Error(`tick budget exceeded for seed ${seed}`)
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

    const [program] = compile(getRotateSweepSnippet().code)
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

test.each([
    424242,
    7331,
])('rotate-sweep wins fixed random seed %s without stalling', (seed) => {
    const result = runSnippetOnRandomSeed(seed)

    expect(result.won).toBe(true)
    expect(result.ticks).toBeGreaterThan(0)
})
