export type DeepReadonly<T> =
    T extends (...args: any[]) => any
        ? T
        : T extends readonly (infer U)[]
            ? ReadonlyArray<DeepReadonly<U>>
            : T extends object
                ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
                : T

export type EntityId = number

export type Point = { x: number, y: number }

export type Rect = { x: number, y: number, w: number, h: number }

export type HitType = 'wall' | 'obstacle' | 'target' | 'disc'

export type ScanHit = { distance: number, type: HitType }

export type ScanRayHitType = HitType | 'miss'

export type ScanRayVisual = {
    x1: number
    y1: number
    x2: number
    y2: number
    distance: number
    hitType: ScanRayHitType
}

export type ActiveIntent = {
    kind: 'move' | 'rotate'
    startX: number
    startY: number
    startHeading: number
    endX: number
    endY: number
    endHeading: number
}

export type Bot = {
    id: EntityId
    kind: 'bot'
    controllerId: string
    teamId: string
    x: number
    y: number
    r: number
    heading: number
}

export type Disc = {
    id: EntityId
    kind: 'disc'
    ownerActorId: EntityId
    x: number
    y: number
    vx: number
    vy: number
    r: number
    alive: boolean
}

export type Target = Rect & {
    id: EntityId
    kind: 'target'
    hit: boolean
}

export type Snapshot = {
    tick: number
    bot: Bot | null
    discs: Disc[]
    targets: Target[]
    won: boolean
    scanRays?: ScanRayVisual[]
}

export type SimView = DeepReadonly<{
    tick: number
    bot: Bot | null
    discs: Disc[]
    obstacles: Rect[]
    targets: Target[]
    won: boolean
    currentScanRays?: ScanRayVisual[]
    activeIntent: ActiveIntent | null
    lastMoveReturnedDistance: number
    botPath: Point[]
}>

export type ActorActionRequest =
    | { type: 'move', signedDist: number }
    | { type: 'rotate', rad: number }
    | { type: 'shoot' }

export type ActiveActionRuntime =
    | {
        kind: 'move'
        remaining: number
        moved: number
        intent: ActiveIntent
    }
    | {
        kind: 'rotate'
        remaining: number
        intent: ActiveIntent
    }
    | {
        kind: 'shoot'
        phase: 'cooldown' | 'fire_next' | 'postfire'
    }

export type ActorInstance = Bot & {
    actionQueue: ActorActionRequest[]
    activeAction: ActiveActionRuntime | null
    shootCooldown: number
    lastMoveReturnedDistance: number
    path: Point[]
}

export type ProjectileInstance = Disc & {
    teamId: string
}

export type ObstacleObjectInstance = Rect & {
    id: EntityId
    kind: 'obstacle'
}

export type TargetObjectInstance = Target

export type ObjectInstance = ObstacleObjectInstance | TargetObjectInstance

export type VmBarrierState =
    | { actorId: EntityId, kind: 'scan', phase: 'drain' | 'timing' | 'ready', rays: number, result?: ScanHit[][] }
    | { actorId: EntityId, kind: 'lastMoveDist', phase: 'drain' | 'ready' }

export type ScanRuntimeState = {
    actorId: EntityId
    pendingTicks: number
    pendingHits: ScanHit[][] | null
    visuals?: ScanRayVisual[]
}

export type SimulationTestHooks = {
    castRay?: (args: {
        ox: number
        oy: number
        angle: number
        actorRadius: number
    }) => ScanHit[] | null
}

export type WorldState = {
    tick: number
    nextEntityId: number
    actors: Map<EntityId, ActorInstance>
    projectiles: Map<EntityId, ProjectileInstance>
    objects: Map<EntityId, ObjectInstance>
    primaryActorId: EntityId | null
    won: boolean
    vmBarrier: VmBarrierState | null
    scanState: ScanRuntimeState | null
    hooks?: SimulationTestHooks
}

export type StageActorDefinition = {
    kind: 'bot'
    x: number
    y: number
    heading: number
    r?: number
    controllerId?: string
    teamId?: string
    primary?: boolean
}

export type StageObjectDefinition =
    | ({ kind: 'obstacle' } & Rect)
    | ({ kind: 'target', hit?: boolean } & Rect)

export type StageDefinition = {
    actors: StageActorDefinition[]
    objects: StageObjectDefinition[]
}

export type StageMode = 'default' | 'random' | 'hardRandom'

export type SimOptions = {
    stage?: StageDefinition
    stageMode?: StageMode
    randomizedStage?: boolean
    seed?: number
}

export const TICKS_PER_SECOND = 3000

export const ARENA_W = 600
export const ARENA_H = 400
export const BOT_R = 15
export const DISC_R = 4
export const SCAN_RANGE = 1000

const BOT_MOVE_PX_PER_SEC = 90
const BOT_ROTATE_DEG_PER_SEC = 90
const DISC_PX_PER_SEC = 180
const SHOOT_COOLDOWN_SEC = 1 / 3
const SCAN_SEC_PER_RAY = 1 / 100

export const BOT_MOVE_PER_TICK = BOT_MOVE_PX_PER_SEC / TICKS_PER_SECOND
export const BOT_ROTATE_DEG_PER_TICK = BOT_ROTATE_DEG_PER_SEC / TICKS_PER_SECOND
export const BOT_ROTATE_RAD_PER_TICK = BOT_ROTATE_DEG_PER_TICK * Math.PI / 180
export const DISC_SPEED = DISC_PX_PER_SEC / TICKS_PER_SECOND
export const SHOOT_COOLDOWN_TICKS = Math.round(SHOOT_COOLDOWN_SEC * TICKS_PER_SECOND)
export const SCAN_TICKS_PER_RAY = Math.max(1, Math.round(SCAN_SEC_PER_RAY * TICKS_PER_SECOND))

export const LAYOUT_WALL_MARGIN = 26
export const LAYOUT_MIN_GAP = 2 * BOT_R + 4
export const LAYOUT_BOT_CLEARANCE = 10

export const TARGET_W = 40
export const TARGET_H = 40

export const PRIMARY_CONTROLLER_ID = 'player-1'
export const PRIMARY_TEAM_ID = 'team-1'
