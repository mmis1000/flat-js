import { resolveStageDefinition } from './core/stage'
import {
    advanceWorldOneTick,
    armLastMoveDistanceBarrier,
    armScanBarrier,
    deliverLastMoveDistanceResult,
    deliverScanResult,
    enqueueMove,
    enqueueRotateRadians,
    enqueueShoot,
    getPrimaryActorId,
    vmBarrierBlocksExecution,
} from './core/systems'
import { createWorldState } from './core/world'
import { projectSimView } from './core/view'
import type { ScanHit } from './core/types'

export type {
    ActiveIntent,
    Bot,
    DeepReadonly,
    Disc,
    EntityId,
    HitType,
    Point,
    Rect,
    ScanHit,
    ScanRayHitType,
    ScanRayVisual,
    SimOptions,
    SimView,
    Snapshot,
    StageActorDefinition,
    StageDefinition,
    StageObjectDefinition,
    Target,
    VmBarrierState,
    SimulationTestHooks,
} from './core/types'

export {
    ARENA_H,
    ARENA_W,
    BOT_MOVE_PER_TICK,
    BOT_R,
    BOT_ROTATE_DEG_PER_TICK,
    DISC_R,
    DISC_SPEED,
    LAYOUT_BOT_CLEARANCE,
    LAYOUT_MIN_GAP,
    LAYOUT_WALL_MARGIN,
    SCAN_RANGE,
    SCAN_TICKS_PER_RAY,
    SHOOT_COOLDOWN_TICKS,
    TARGET_H,
    TARGET_W,
    TICKS_PER_SECOND,
} from './core/types'

export { DEFAULT_OBSTACLES, DEFAULT_STAGE, DEFAULT_TARGETS } from './core/stage'

import type { SimOptions, SimView, SimulationTestHooks, WorldState } from './core/types'

export type Sim = {
    readonly view: SimView
    beginMove: (signedDist: number) => void
    beginRotateRadians: (rad: number) => void
    beginShoot: () => void
    armScanBarrier: (rays: number) => void
    deliverScanResult: (cb: (res: ScanHit[][]) => void) => void
    armLastMoveDistanceBarrier: () => void
    deliverLastMoveDistanceResult: (cb: (distance: number) => void) => void
    vmBarrierBlocksExecution: () => boolean
}

export type SimulationRunner = {
    stepOneTick: () => void
}

export type SimulationSession = {
    sim: Sim
    runner: SimulationRunner
}

export type SimulationTestHarness = SimulationSession & {
    stepUntil: (predicate: (view: SimView) => boolean, maxTicks?: number) => void
}

function createSession(options?: SimOptions, hooks?: SimulationTestHooks): SimulationSession {
    const stage = resolveStageDefinition(options)
    const world = createWorldState(stage, hooks)
    let view = projectSimView(world)
    const primaryActorId = getPrimaryActorId(world)

    const refreshView = () => {
        view = projectSimView(world)
    }

    const sim: Sim = {
        get view() {
            return view
        },
        beginMove(signedDist: number) {
            enqueueMove(world, primaryActorId, signedDist)
            refreshView()
        },
        beginRotateRadians(rad: number) {
            enqueueRotateRadians(world, primaryActorId, rad)
            refreshView()
        },
        beginShoot() {
            enqueueShoot(world, primaryActorId)
            refreshView()
        },
        armScanBarrier(rays: number) {
            armScanBarrier(world, primaryActorId, Number(rays) || 36)
            refreshView()
        },
        deliverScanResult(cb: (res: ScanHit[][]) => void) {
            deliverScanResult(world, primaryActorId, cb)
            refreshView()
        },
        armLastMoveDistanceBarrier() {
            armLastMoveDistanceBarrier(world, primaryActorId)
            refreshView()
        },
        deliverLastMoveDistanceResult(cb: (distance: number) => void) {
            deliverLastMoveDistanceResult(world, primaryActorId, cb)
            refreshView()
        },
        vmBarrierBlocksExecution() {
            return vmBarrierBlocksExecution(world)
        },
    }

    const runner: SimulationRunner = {
        stepOneTick() {
            advanceWorldOneTick(world)
            refreshView()
        },
    }

    return { sim, runner }
}

export function createSimulationSession(options?: SimOptions): SimulationSession {
    return createSession(options)
}

export function createSimulationTestHarness(options?: SimOptions & { hooks?: SimulationTestHooks }): SimulationTestHarness {
    const session = createSession(options, options?.hooks)
    return {
        ...session,
        stepUntil(predicate: (view: SimView) => boolean, maxTicks = 6000) {
            for (let i = 0; i < maxTicks; i++) {
                if (predicate(session.sim.view)) {
                    return
                }
                session.runner.stepOneTick()
            }
            throw new Error('condition not reached within tick budget')
        },
    }
}

