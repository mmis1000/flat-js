import {
    BOT_R,
    EntityId,
    ObjectInstance,
    PRIMARY_CONTROLLER_ID,
    PRIMARY_TEAM_ID,
    ProjectileInstance,
    ScanRuntimeState,
    StageDefinition,
    TargetObjectInstance,
    WorldState,
} from './types'

function nextEntityId(world: WorldState) {
    const id = world.nextEntityId
    world.nextEntityId += 1
    return id
}

export function createWorldState(stage: StageDefinition, hooks?: WorldState['hooks']): WorldState {
    const world: WorldState = {
        tick: 0,
        nextEntityId: 1,
        actors: new Map(),
        projectiles: new Map(),
        objects: new Map(),
        primaryActorId: null,
        won: false,
        vmBarrier: null,
        scanState: null,
        hooks,
    }

    for (const actorDef of stage.actors) {
        const id = nextEntityId(world)
        world.actors.set(id, {
            id,
            kind: 'bot',
            controllerId: actorDef.controllerId ?? PRIMARY_CONTROLLER_ID,
            teamId: actorDef.teamId ?? PRIMARY_TEAM_ID,
            x: actorDef.x,
            y: actorDef.y,
            r: actorDef.r ?? BOT_R,
            heading: actorDef.heading,
            actionQueue: [],
            activeAction: null,
            shootCooldown: 0,
            lastMoveReturnedDistance: 0,
            path: [{ x: actorDef.x, y: actorDef.y }],
        })
        if (world.primaryActorId == null || actorDef.primary) {
            world.primaryActorId = id
        }
    }

    for (const objectDef of stage.objects) {
        const id = nextEntityId(world)
        if (objectDef.kind === 'target') {
            const target: TargetObjectInstance = {
                id,
                kind: 'target',
                x: objectDef.x,
                y: objectDef.y,
                w: objectDef.w,
                h: objectDef.h,
                hit: !!objectDef.hit,
            }
            world.objects.set(id, target)
        } else {
            const obstacle: ObjectInstance = {
                id,
                kind: 'obstacle',
                x: objectDef.x,
                y: objectDef.y,
                w: objectDef.w,
                h: objectDef.h,
            }
            world.objects.set(id, obstacle)
        }
    }

    world.won = getTargets(world).length > 0 && getTargets(world).every(target => target.hit)
    return world
}

export function getPrimaryActor(world: WorldState) {
    return world.primaryActorId == null ? null : world.actors.get(world.primaryActorId) ?? null
}

export function getActor(world: WorldState, actorId: EntityId) {
    return world.actors.get(actorId) ?? null
}

export function getObstacleObjects(world: WorldState) {
    const obstacles: ObjectInstance[] = []
    for (const object of world.objects.values()) {
        if (object.kind === 'obstacle') {
            obstacles.push(object)
        }
    }
    return obstacles
}

export function getTargets(world: WorldState) {
    const targets: TargetObjectInstance[] = []
    for (const object of world.objects.values()) {
        if (object.kind === 'target') {
            targets.push(object)
        }
    }
    return targets
}

export function getAliveProjectiles(world: WorldState) {
    const projectiles: ProjectileInstance[] = []
    for (const projectile of world.projectiles.values()) {
        if (projectile.alive) {
            projectiles.push(projectile)
        }
    }
    return projectiles
}

export function setScanState(world: WorldState, scanState: ScanRuntimeState | null) {
    world.scanState = scanState
}

export function clearDestroyedProjectiles(world: WorldState) {
    for (const [id, projectile] of world.projectiles) {
        if (!projectile.alive) {
            world.projectiles.delete(id)
        }
    }
}

export function createProjectile(
    world: WorldState,
    projectile: Omit<ProjectileInstance, 'id'>
) {
    const id = nextEntityId(world)
    world.projectiles.set(id, { id, ...projectile })
    return id
}

