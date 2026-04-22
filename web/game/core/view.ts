import {
    ActiveIntent,
    Bot,
    DeepReadonly,
    Disc,
    Point,
    Rect,
    ScanRayVisual,
    SimView,
    Target,
    WorldState,
} from './types'
import { getAliveProjectiles, getObstacleObjects, getPrimaryActor, getTargets } from './world'

function clonePoints(points: Point[]) {
    return points.map(point => ({ ...point }))
}

function cloneScanRays(rays?: ScanRayVisual[]) {
    return rays?.map(ray => ({ ...ray }))
}

function cloneBot(world: WorldState): Bot | null {
    const actor = getPrimaryActor(world)
    if (!actor) return null
    return {
        id: actor.id,
        kind: actor.kind,
        controllerId: actor.controllerId,
        teamId: actor.teamId,
        x: actor.x,
        y: actor.y,
        r: actor.r,
        heading: actor.heading,
    }
}

function cloneDiscs(world: WorldState): Disc[] {
    return getAliveProjectiles(world).map(projectile => ({
        id: projectile.id,
        kind: projectile.kind,
        ownerActorId: projectile.ownerActorId,
        x: projectile.x,
        y: projectile.y,
        vx: projectile.vx,
        vy: projectile.vy,
        r: projectile.r,
        alive: projectile.alive,
    }))
}

function cloneTargets(world: WorldState): Target[] {
    return getTargets(world).map(target => ({
        id: target.id,
        kind: target.kind,
        x: target.x,
        y: target.y,
        w: target.w,
        h: target.h,
        hit: target.hit,
    }))
}

function cloneObstacles(world: WorldState): Rect[] {
    return getObstacleObjects(world).map(object => ({
        x: object.x,
        y: object.y,
        w: object.w,
        h: object.h,
    }))
}

function cloneActiveIntent(world: WorldState): ActiveIntent | null {
    const actor = getPrimaryActor(world)
    const activeAction = actor?.activeAction
    if (!activeAction || (activeAction.kind !== 'move' && activeAction.kind !== 'rotate')) {
        return null
    }
    return { ...activeAction.intent }
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
    if (value == null || typeof value !== 'object' || Object.isFrozen(value)) {
        return value as DeepReadonly<T>
    }
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) {
        deepFreeze(nested)
    }
    return value as DeepReadonly<T>
}

export function projectSimView(world: WorldState, freeze = true): SimView {
    const actor = getPrimaryActor(world)
    const view = {
        tick: world.tick,
        bot: cloneBot(world),
        discs: cloneDiscs(world),
        obstacles: cloneObstacles(world),
        targets: cloneTargets(world),
        won: world.won,
        currentScanRays: actor && world.scanState?.actorId === actor.id
            ? cloneScanRays(world.scanState.visuals)
            : undefined,
        activeIntent: cloneActiveIntent(world),
        lastMoveReturnedDistance: actor?.lastMoveReturnedDistance ?? 0,
        botPath: clonePoints(actor?.path ?? []),
    }
    return freeze ? deepFreeze(view) as SimView : view as SimView
}

