import {
    ActiveIntent,
    ActorActionRequest,
    ActorInstance,
    BOT_MOVE_PER_TICK,
    BOT_ROTATE_RAD_PER_TICK,
    DISC_R,
    DISC_SPEED,
    EntityId,
    HitType,
    ObjectInstance,
    PRIMARY_CONTROLLER_ID,
    SCAN_RANGE,
    SCAN_TICKS_PER_RAY,
    ScanHit,
    ScanRayVisual,
    SHOOT_COOLDOWN_TICKS,
    VmBarrierState,
    WorldState,
} from './types'
import { circleHitsRect, rayAabb, rayCircle, rectHitsCircle } from './geometry'
import {
    clearDestroyedProjectiles,
    createProjectile,
    getActor,
    getAliveProjectiles,
    getObstacleObjects,
    getPrimaryActor,
    getTargets,
    setScanState,
} from './world'

function getRequiredActor(world: WorldState, actorId: EntityId) {
    const actor = getActor(world, actorId)
    if (!actor) {
        throw new Error(`unknown actor ${actorId}`)
    }
    return actor
}

function isActorActionIdle(actor: ActorInstance) {
    return actor.activeAction === null && actor.actionQueue.length === 0
}

function appendActorPathPoint(actor: ActorInstance, x: number, y: number) {
    const last = actor.path[actor.path.length - 1]
    if (!last || (x - last.x) ** 2 + (y - last.y) ** 2 >= 9) {
        actor.path.push({ x, y })
    }
}

function isActorPositionBlocked(world: WorldState, actor: ActorInstance, x: number, y: number) {
    if (x - actor.r < 0 || x + actor.r > 600 || y - actor.r < 0 || y + actor.r > 400) {
        return true
    }
    for (const obstacle of getObstacleObjects(world)) {
        if (circleHitsRect(x, y, actor.r, obstacle)) {
            return true
        }
    }
    return false
}

function tryActorMoveStep(world: WorldState, actor: ActorInstance, dx: number, dy: number) {
    const nextX = actor.x + dx
    const nextY = actor.y + dy
    const blocked = isActorPositionBlocked(world, actor, nextX, nextY)
    if (!blocked) {
        actor.x = nextX
        actor.y = nextY
        appendActorPathPoint(actor, nextX, nextY)
    }
    return blocked
}

function previewMoveDestination(world: WorldState, actor: ActorInstance, signedDist: number) {
    let previewX = actor.x
    let previewY = actor.y
    let remaining = signedDist
    const dirX = Math.cos(actor.heading)
    const dirY = Math.sin(actor.heading)

    while (Math.abs(remaining) >= 1e-9) {
        const step = Math.min(BOT_MOVE_PER_TICK, Math.abs(remaining))
        const sign = Math.sign(remaining)
        const nextX = previewX + dirX * step * sign
        const nextY = previewY + dirY * step * sign
        if (isActorPositionBlocked(world, actor, nextX, nextY)) {
            break
        }
        previewX = nextX
        previewY = nextY
        remaining -= step * sign
    }

    return { x: previewX, y: previewY }
}

function buildMoveIntent(world: WorldState, actor: ActorInstance, signedDist: number): ActiveIntent {
    const destination = previewMoveDestination(world, actor, signedDist)
    return {
        kind: 'move',
        startX: actor.x,
        startY: actor.y,
        startHeading: actor.heading,
        endX: destination.x,
        endY: destination.y,
        endHeading: actor.heading,
    }
}

function buildRotateIntent(actor: ActorInstance, rad: number): ActiveIntent {
    return {
        kind: 'rotate',
        startX: actor.x,
        startY: actor.y,
        startHeading: actor.heading,
        endX: actor.x,
        endY: actor.y,
        endHeading: actor.heading + rad,
    }
}

function startAction(world: WorldState, actor: ActorInstance, request: ActorActionRequest) {
    if (request.type === 'move') {
        actor.lastMoveReturnedDistance = 0
        actor.activeAction = {
            kind: 'move',
            remaining: request.signedDist,
            moved: 0,
            intent: buildMoveIntent(world, actor, request.signedDist),
        }
        return
    }
    if (request.type === 'rotate') {
        actor.activeAction = {
            kind: 'rotate',
            remaining: request.rad,
            intent: buildRotateIntent(actor, request.rad),
        }
        return
    }
    actor.activeAction = {
        kind: 'shoot',
        phase: actor.shootCooldown > 0 ? 'cooldown' : 'fire_next',
    }
}

function tryStartNextActorAction(world: WorldState, actor: ActorInstance) {
    if (actor.activeAction) return
    while (actor.actionQueue.length > 0) {
        const next = actor.actionQueue.shift()!
        if (next.type === 'move' && Math.abs(next.signedDist) < 1e-9) {
            continue
        }
        if (next.type === 'rotate' && Math.abs(next.rad) < 1e-12) {
            continue
        }
        startAction(world, actor, next)
        return
    }
}

function finishActorAction(world: WorldState, actor: ActorInstance) {
    actor.activeAction = null
    tryStartNextActorAction(world, actor)
}

function fireProjectile(world: WorldState, actor: ActorInstance) {
    createProjectile(world, {
        kind: 'disc',
        ownerActorId: actor.id,
        teamId: actor.teamId,
        x: actor.x + Math.cos(actor.heading) * (actor.r + DISC_R + 1),
        y: actor.y + Math.sin(actor.heading) * (actor.r + DISC_R + 1),
        vx: Math.cos(actor.heading) * DISC_SPEED,
        vy: Math.sin(actor.heading) * DISC_SPEED,
        r: DISC_R,
        alive: true,
    })
    actor.shootCooldown = SHOOT_COOLDOWN_TICKS
}

function stepShootAction(world: WorldState, actor: ActorInstance) {
    const action = actor.activeAction
    if (!action || action.kind !== 'shoot') return
    if (action.phase === 'cooldown') {
        if (actor.shootCooldown === 0) {
            fireProjectile(world, actor)
            action.phase = 'postfire'
        }
        return
    }
    if (action.phase === 'fire_next') {
        fireProjectile(world, actor)
        action.phase = 'postfire'
        return
    }
    if (actor.shootCooldown === 0) {
        finishActorAction(world, actor)
    }
}

function stepRotateAction(world: WorldState, actor: ActorInstance) {
    const action = actor.activeAction
    if (!action || action.kind !== 'rotate') return
    const remaining = action.remaining
    if (Math.abs(remaining) < 1e-12) {
        finishActorAction(world, actor)
        return
    }
    const step = Math.min(BOT_ROTATE_RAD_PER_TICK, Math.abs(remaining))
    const sign = Math.sign(remaining)
    actor.heading += step * sign
    action.remaining = remaining - step * sign
    if (Math.abs(action.remaining) < 1e-12) {
        finishActorAction(world, actor)
    }
}

function stepMoveAction(world: WorldState, actor: ActorInstance) {
    const action = actor.activeAction
    if (!action || action.kind !== 'move') return
    const remaining = action.remaining
    if (Math.abs(remaining) < 1e-9) {
        actor.lastMoveReturnedDistance = action.moved
        finishActorAction(world, actor)
        return
    }
    const step = Math.min(BOT_MOVE_PER_TICK, Math.abs(remaining))
    const sign = Math.sign(remaining)
    const dx = Math.cos(actor.heading) * step * sign
    const dy = Math.sin(actor.heading) * step * sign
    const blocked = tryActorMoveStep(world, actor, dx, dy)
    if (blocked) {
        actor.lastMoveReturnedDistance = action.moved
        finishActorAction(world, actor)
        return
    }
    action.moved += step
    action.remaining = remaining - step * sign
    if (Math.abs(action.remaining) < 1e-9) {
        actor.lastMoveReturnedDistance = action.moved
        finishActorAction(world, actor)
    }
}

function castRayDefault(world: WorldState, actor: ActorInstance, ox: number, oy: number, angle: number): ScanHit[] {
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const hits: ScanHit[] = []
    const wall = rayAabb(ox, oy, dx, dy, 0, 0, 600, 400, true)
    if (wall != null) {
        hits.push({ distance: wall, type: 'wall' })
    }
    for (const obstacle of getObstacleObjects(world)) {
        const distance = rayAabb(ox, oy, dx, dy, obstacle.x, obstacle.y, obstacle.x + obstacle.w, obstacle.y + obstacle.h, false)
        if (distance != null && distance > actor.r) {
            hits.push({ distance: distance - actor.r, type: 'obstacle' })
        }
    }
    for (const target of getTargets(world)) {
        if (target.hit) continue
        const distance = rayAabb(ox, oy, dx, dy, target.x, target.y, target.x + target.w, target.y + target.h, false)
        if (distance != null && distance > actor.r) {
            hits.push({ distance: distance - actor.r, type: 'target' })
        }
    }
    for (const projectile of getAliveProjectiles(world)) {
        const distance = rayCircle(ox, oy, dx, dy, projectile.x, projectile.y, projectile.r)
        if (distance != null && distance > actor.r) {
            hits.push({ distance: distance - actor.r, type: 'disc' })
        }
    }
    hits.sort((a, b) => a.distance - b.distance)
    return hits
}

function prepareScan(world: WorldState, actor: ActorInstance, rays: number) {
    const normalizedRays = Math.max(1, Math.min(90, Math.floor(rays)))
    const half = Math.PI / 4
    const visuals: ScanRayVisual[] = []
    const hitsByRay: ScanHit[][] = []

    for (let index = 0; index < normalizedRays; index++) {
        const t = normalizedRays === 1 ? 0.5 : index / (normalizedRays - 1)
        const angle = actor.heading - half + t * (2 * half)
        const hooked = world.hooks?.castRay?.({
            ox: actor.x,
            oy: actor.y,
            angle,
            actorRadius: actor.r,
        })
        const hits = hooked ?? castRayDefault(world, actor, actor.x, actor.y, angle)
        hitsByRay.push(hits)
        const firstHit = hits[0]
        const distance = firstHit?.distance ?? SCAN_RANGE
        visuals.push({
            x1: actor.x,
            y1: actor.y,
            x2: actor.x + Math.cos(angle) * distance,
            y2: actor.y + Math.sin(angle) * distance,
            distance,
            hitType: firstHit?.type ?? 'miss',
        })
    }

    setScanState(world, {
        actorId: actor.id,
        pendingTicks: Math.max(1, normalizedRays * SCAN_TICKS_PER_RAY),
        pendingHits: hitsByRay,
        visuals,
    })
}

function stepPendingScan(world: WorldState) {
    const scanState = world.scanState
    if (!scanState || scanState.pendingTicks <= 0) return
    scanState.pendingTicks -= 1
    if (scanState.pendingTicks > 0) return

    const barrier = world.vmBarrier
    let serialized: ScanHit[][] | undefined
    if (
        barrier
        && barrier.kind === 'scan'
        && barrier.phase === 'timing'
        && scanState.pendingHits
        && barrier.actorId === scanState.actorId
    ) {
        serialized = scanState.pendingHits.map(ray => ray.map(hit => ({ distance: hit.distance, type: hit.type })))
    }
    setScanState(world, null)
    if (serialized && barrier?.kind === 'scan') {
        world.vmBarrier = {
            actorId: barrier.actorId,
            kind: 'scan',
            phase: 'ready',
            rays: barrier.rays,
            result: serialized,
        }
    }
}

function processVmBarrierBeforeScanStep(world: WorldState) {
    const barrier = world.vmBarrier
    if (!barrier) return
    const actor = getActor(world, barrier.actorId)
    if (!actor) return
    if (barrier.kind === 'scan' && barrier.phase === 'drain' && isActorActionIdle(actor)) {
        prepareScan(world, actor, barrier.rays)
        world.vmBarrier = {
            actorId: barrier.actorId,
            kind: 'scan',
            phase: 'timing',
            rays: barrier.rays,
        }
    } else if (barrier.kind === 'lastMoveDist' && barrier.phase === 'drain' && isActorActionIdle(actor)) {
        world.vmBarrier = {
            actorId: barrier.actorId,
            kind: 'lastMoveDist',
            phase: 'ready',
        }
    }
}

function updateVictory(world: WorldState) {
    const targets = getTargets(world)
    world.won = targets.length > 0 && targets.every(target => target.hit)
}

function stepProjectiles(world: WorldState) {
    for (const projectile of world.projectiles.values()) {
        if (!projectile.alive) continue
        projectile.x += projectile.vx
        projectile.y += projectile.vy
        if (projectile.x < 0 || projectile.x > 600 || projectile.y < 0 || projectile.y > 400) {
            projectile.alive = false
            continue
        }
        let hitTarget = false
        for (const target of getTargets(world)) {
            if (!target.hit && rectHitsCircle(target, projectile.x, projectile.y, projectile.r)) {
                target.hit = true
                projectile.alive = false
                hitTarget = true
                break
            }
        }
        if (hitTarget) {
            updateVictory(world)
            continue
        }
        for (const obstacle of getObstacleObjects(world)) {
            if (rectHitsCircle(obstacle, projectile.x, projectile.y, projectile.r)) {
                projectile.alive = false
                break
            }
        }
    }
    clearDestroyedProjectiles(world)
}

export function enqueueMove(world: WorldState, actorId: EntityId, signedDist: number) {
    if (Math.abs(signedDist) < 1e-9) return
    const actor = getRequiredActor(world, actorId)
    if (isActorActionIdle(actor)) {
        startAction(world, actor, { type: 'move', signedDist })
    } else {
        actor.actionQueue.push({ type: 'move', signedDist })
    }
}

export function enqueueRotateRadians(world: WorldState, actorId: EntityId, rad: number) {
    if (Math.abs(rad) < 1e-12) return
    const actor = getRequiredActor(world, actorId)
    if (isActorActionIdle(actor)) {
        startAction(world, actor, { type: 'rotate', rad })
    } else {
        actor.actionQueue.push({ type: 'rotate', rad })
    }
}

export function enqueueShoot(world: WorldState, actorId: EntityId) {
    const actor = getRequiredActor(world, actorId)
    if (isActorActionIdle(actor)) {
        startAction(world, actor, { type: 'shoot' })
    } else {
        actor.actionQueue.push({ type: 'shoot' })
    }
}

export function armScanBarrier(world: WorldState, actorId: EntityId, rays: number) {
    if (world.vmBarrier != null) {
        throw new Error('VM read barrier already active')
    }
    if (world.scanState != null) {
        throw new Error('Scan already in progress')
    }
    world.vmBarrier = {
        actorId,
        kind: 'scan',
        phase: 'drain',
        rays: Math.max(1, Math.min(90, Math.floor(rays))),
    }
}

export function armLastMoveDistanceBarrier(world: WorldState, actorId: EntityId) {
    if (world.vmBarrier != null) {
        throw new Error('VM read barrier already active')
    }
    world.vmBarrier = {
        actorId,
        kind: 'lastMoveDist',
        phase: 'drain',
    }
}

export function deliverScanResult(world: WorldState, actorId: EntityId, cb: (res: ScanHit[][]) => void) {
    const barrier = world.vmBarrier
    if (!barrier || barrier.actorId !== actorId || barrier.kind !== 'scan' || barrier.phase !== 'ready' || barrier.result == null) {
        throw new Error('scan result not ready')
    }
    cb(barrier.result.map(ray => ray.map(hit => ({ distance: hit.distance, type: hit.type }))))
    world.vmBarrier = null
}

export function deliverLastMoveDistanceResult(world: WorldState, actorId: EntityId, cb: (distance: number) => void) {
    const barrier = world.vmBarrier
    if (!barrier || barrier.actorId !== actorId || barrier.kind !== 'lastMoveDist' || barrier.phase !== 'ready') {
        throw new Error('lastMoveDistance not ready')
    }
    const actor = getRequiredActor(world, actorId)
    cb(actor.lastMoveReturnedDistance)
    world.vmBarrier = null
}

export function vmBarrierBlocksExecution(world: WorldState) {
    const barrier = world.vmBarrier
    if (!barrier) return false
    if (barrier.kind === 'scan') return barrier.phase !== 'ready'
    return barrier.phase !== 'ready'
}

export function advanceWorldOneTick(world: WorldState) {
    world.tick += 1

    for (const actor of world.actors.values()) {
        if (actor.shootCooldown > 0) {
            actor.shootCooldown -= 1
        }
    }

    for (const actor of world.actors.values()) {
        stepShootAction(world, actor)
        stepRotateAction(world, actor)
        stepMoveAction(world, actor)
    }

    processVmBarrierBeforeScanStep(world)
    stepPendingScan(world)
    stepProjectiles(world)
}

export function getPrimaryActorId(world: WorldState) {
    const actor = getPrimaryActor(world)
    if (!actor) {
        throw new Error('primary actor missing')
    }
    return actor.id
}

export function createScanMissWorldBarrier(actorId: EntityId): VmBarrierState {
    return {
        actorId,
        kind: 'scan',
        phase: 'drain',
        rays: 1,
    }
}

export function getPrimaryControllerId() {
    return PRIMARY_CONTROLLER_ID
}

