import {
    ARENA_H,
    ARENA_W,
    BOT_R,
    LAYOUT_BOT_CLEARANCE,
    LAYOUT_MIN_GAP,
    LAYOUT_WALL_MARGIN,
    PRIMARY_CONTROLLER_ID,
    PRIMARY_TEAM_ID,
    Rect,
    SimOptions,
    StageActorDefinition,
    StageDefinition,
    StageMode,
    StageObjectDefinition,
    TARGET_H,
    TARGET_W,
} from './types'
import { botCenterClearOfRects, circleHitsRect, rayAabb, rectFitsArenaInset, rectsSeparatedByGap } from './geometry'

export const DEFAULT_OBSTACLES: StageObjectDefinition[] = [
    { kind: 'obstacle', x: 150, y: 150, w: 100, h: 30 },
    { kind: 'obstacle', x: 280, y: 240, w: 90, h: 30 },
    { kind: 'obstacle', x: 420, y: 120, w: 30, h: 140 },
    { kind: 'obstacle', x: 120, y: 310, w: 80, h: 30 },
]

export const DEFAULT_TARGETS: StageObjectDefinition[] = [
    { kind: 'target', x: 530, y: 30, w: TARGET_W, h: TARGET_H, hit: false },
    { kind: 'target', x: 30, y: 30, w: TARGET_W, h: TARGET_H, hit: false },
    { kind: 'target', x: 520, y: 330, w: TARGET_W, h: TARGET_H, hit: false },
]

export const DEFAULT_STAGE: StageDefinition = {
    actors: [
        {
            kind: 'bot',
            x: 40,
            y: ARENA_H - 40,
            r: BOT_R,
            heading: -Math.PI / 2,
            controllerId: PRIMARY_CONTROLLER_ID,
            teamId: PRIMARY_TEAM_ID,
            primary: true,
        },
    ],
    objects: [
        ...DEFAULT_OBSTACLES.map(item => ({ ...item })),
        ...DEFAULT_TARGETS.map(item => ({ ...item })),
    ],
}

const RANDOM_STAGE_ATTEMPTS = 220
const HARD_RANDOM_STAGE_ATTEMPTS = 320
const HARD_STAGE_HEADING_SAMPLES = 24
const HARD_STAGE_GRID_STEP = 24
const HARD_STAGE_MIN_PATH_DISTANCE = 96
const HARD_STAGE_START_LINK_DISTANCE = HARD_STAGE_GRID_STEP * 2
const PATH_SAMPLE_STEP = 6
const DEFAULT_RANDOM_OBSTACLE_COUNT = 4
const HARD_RANDOM_OBSTACLE_COUNT = 5

type StageTargetRect = Rect & { index: number }
type HardStageTargetSolution = {
    targetIndex: number
    x: number
    y: number
    heading: number
    pathDistance: number
}

export type HardStageAnalysis = {
    spawnHasDirectTargetShot: boolean
    reachableCellCount: number
    targetSolutions: HardStageTargetSolution[]
    score: number
}

function mulberry32(seed: number) {
    return () => {
        let t = (seed += 0x6d2b79f5)
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function cloneStage(stage: StageDefinition): StageDefinition {
    return {
        actors: stage.actors.map(actor => ({ ...actor })),
        objects: stage.objects.map(item => ({ ...item })),
    }
}

function getRequestedStageMode(options?: SimOptions): StageMode {
    if (options?.stageMode) {
        return options.stageMode
    }
    return options?.randomizedStage ? 'random' : 'default'
}

function splitStageObjects(stage: StageDefinition) {
    const actor = stage.actors[0]
    const obstacles: Rect[] = []
    const targets: StageTargetRect[] = []

    for (const object of stage.objects) {
        if (object.kind === 'target') {
            targets.push({
                index: targets.length,
                x: object.x,
                y: object.y,
                w: object.w,
                h: object.h,
            })
        } else {
            obstacles.push({
                x: object.x,
                y: object.y,
                w: object.w,
                h: object.h,
            })
        }
    }

    return { actor, obstacles, targets }
}

function isBotCenterWalkable(x: number, y: number, actorRadius: number, obstacles: Rect[]) {
    if (x - actorRadius < 0 || x + actorRadius > ARENA_W || y - actorRadius < 0 || y + actorRadius > ARENA_H) {
        return false
    }
    for (const obstacle of obstacles) {
        if (circleHitsRect(x, y, actorRadius, obstacle)) {
            return false
        }
    }
    return true
}

function isSegmentWalkable(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    actorRadius: number,
    obstacles: Rect[]
) {
    const dist = Math.hypot(x2 - x1, y2 - y1)
    const samples = Math.max(1, Math.ceil(dist / PATH_SAMPLE_STEP))
    for (let step = 0; step <= samples; step++) {
        const t = samples === 0 ? 1 : step / samples
        const x = x1 + (x2 - x1) * t
        const y = y1 + (y2 - y1) * t
        if (!isBotCenterWalkable(x, y, actorRadius, obstacles)) {
            return false
        }
    }
    return true
}

function getFirstHit(
    ox: number,
    oy: number,
    angle: number,
    actorRadius: number,
    obstacles: Rect[],
    targets: StageTargetRect[]
) {
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const hits: Array<{ type: 'wall' | 'obstacle' | 'target', distance: number, targetIndex?: number }> = []
    const wall = rayAabb(ox, oy, dx, dy, 0, 0, ARENA_W, ARENA_H, true)
    if (wall != null) {
        hits.push({ distance: wall, type: 'wall' })
    }
    for (const obstacle of obstacles) {
        const distance = rayAabb(ox, oy, dx, dy, obstacle.x, obstacle.y, obstacle.x + obstacle.w, obstacle.y + obstacle.h, false)
        if (distance != null && distance > actorRadius) {
            hits.push({ distance: distance - actorRadius, type: 'obstacle' })
        }
    }
    for (const target of targets) {
        const distance = rayAabb(ox, oy, dx, dy, target.x, target.y, target.x + target.w, target.y + target.h, false)
        if (distance != null && distance > actorRadius) {
            hits.push({ distance: distance - actorRadius, type: 'target', targetIndex: target.index })
        }
    }
    hits.sort((a, b) => a.distance - b.distance)
    return hits[0] ?? null
}

function hasDirectSpawnTargetShot(actor: StageActorDefinition, obstacles: Rect[], targets: StageTargetRect[]) {
    const actorRadius = actor.r ?? BOT_R
    for (let index = 0; index < HARD_STAGE_HEADING_SAMPLES; index++) {
        const angle = index * (2 * Math.PI / HARD_STAGE_HEADING_SAMPLES)
        const firstHit = getFirstHit(actor.x, actor.y, angle, actorRadius, obstacles, targets)
        if (firstHit?.type === 'target') {
            return true
        }
    }
    return false
}

function keyForGridCell(x: number, y: number) {
    return `${x}|${y}`
}

function computeReachableGrid(actor: StageActorDefinition, obstacles: Rect[]) {
    const actorRadius = actor.r ?? BOT_R
    const cells: Array<{ x: number, y: number }> = []
    const indexByKey = new Map<string, number>()

    for (let y = BOT_R; y <= ARENA_H - BOT_R + 1e-9; y += HARD_STAGE_GRID_STEP) {
        for (let x = BOT_R; x <= ARENA_W - BOT_R + 1e-9; x += HARD_STAGE_GRID_STEP) {
            if (!isBotCenterWalkable(x, y, actorRadius, obstacles)) {
                continue
            }
            const index = cells.length
            cells.push({ x, y })
            indexByKey.set(keyForGridCell(x, y), index)
        }
    }

    const neighbors: Array<Array<{ index: number, cost: number }>> = cells.map(() => [])
    const offsets = [-1, 0, 1]
    for (let index = 0; index < cells.length; index++) {
        const cell = cells[index]
        for (const dy of offsets) {
            for (const dx of offsets) {
                if (dx === 0 && dy === 0) continue
                const nextX = cell.x + dx * HARD_STAGE_GRID_STEP
                const nextY = cell.y + dy * HARD_STAGE_GRID_STEP
                const nextIndex = indexByKey.get(keyForGridCell(nextX, nextY))
                if (nextIndex == null) continue
                if (!isSegmentWalkable(cell.x, cell.y, nextX, nextY, actorRadius, obstacles)) {
                    continue
                }
                neighbors[index].push({
                    index: nextIndex,
                    cost: Math.hypot(dx, dy) * HARD_STAGE_GRID_STEP,
                })
            }
        }
    }

    const distances = new Array<number>(cells.length).fill(Infinity)
    for (let index = 0; index < cells.length; index++) {
        const cell = cells[index]
        const directDistance = Math.hypot(cell.x - actor.x, cell.y - actor.y)
        if (directDistance > HARD_STAGE_START_LINK_DISTANCE) {
            continue
        }
        if (!isSegmentWalkable(actor.x, actor.y, cell.x, cell.y, actorRadius, obstacles)) {
            continue
        }
        distances[index] = directDistance
    }

    const visited = new Array<boolean>(cells.length).fill(false)
    for (let pass = 0; pass < cells.length; pass++) {
        let current = -1
        let currentDistance = Infinity
        for (let index = 0; index < cells.length; index++) {
            if (!visited[index] && distances[index] < currentDistance) {
                currentDistance = distances[index]
                current = index
            }
        }
        if (current === -1) {
            break
        }
        visited[current] = true
        for (const edge of neighbors[current]) {
            if (visited[edge.index]) continue
            const nextDistance = currentDistance + edge.cost
            if (nextDistance < distances[edge.index]) {
                distances[edge.index] = nextDistance
            }
        }
    }

    return {
        cells,
        distances,
        reachableCellCount: distances.filter(Number.isFinite).length,
    }
}

export function analyzeHardStageDefinition(stage: StageDefinition): HardStageAnalysis | null {
    if (stage.actors.length === 0) {
        return null
    }

    const { actor, obstacles, targets } = splitStageObjects(stage)
    if (!actor || targets.length === 0) {
        return null
    }

    if (hasDirectSpawnTargetShot(actor, obstacles, targets)) {
        return null
    }

    const actorRadius = actor.r ?? BOT_R
    const reachable = computeReachableGrid(actor, obstacles)
    const solutions = new Array<HardStageTargetSolution | undefined>(targets.length).fill(undefined)

    for (let cellIndex = 0; cellIndex < reachable.cells.length; cellIndex++) {
        const pathDistance = reachable.distances[cellIndex]
        if (!Number.isFinite(pathDistance) || pathDistance < HARD_STAGE_MIN_PATH_DISTANCE) {
            continue
        }
        const cell = reachable.cells[cellIndex]
        for (let headingIndex = 0; headingIndex < HARD_STAGE_HEADING_SAMPLES; headingIndex++) {
            const heading = headingIndex * (2 * Math.PI / HARD_STAGE_HEADING_SAMPLES)
            const firstHit = getFirstHit(cell.x, cell.y, heading, actorRadius, obstacles, targets)
            if (firstHit?.type !== 'target' || firstHit.targetIndex == null) {
                continue
            }
            const existing = solutions[firstHit.targetIndex]
            if (!existing || pathDistance < existing.pathDistance) {
                solutions[firstHit.targetIndex] = {
                    targetIndex: firstHit.targetIndex,
                    x: cell.x,
                    y: cell.y,
                    heading,
                    pathDistance,
                }
            }
        }
    }

    if (solutions.some(solution => solution == null)) {
        return null
    }

    const targetSolutions = solutions as HardStageTargetSolution[]
    return {
        spawnHasDirectTargetShot: false,
        reachableCellCount: reachable.reachableCellCount,
        targetSolutions,
        score: targetSolutions.reduce((sum, solution) => sum + solution.pathDistance, 0) + reachable.reachableCellCount * 0.01,
    }
}

function tryCreateRandomStage(seed: number, obstacleCount = DEFAULT_RANDOM_OBSTACLE_COUNT): StageDefinition | null {
    const rng = mulberry32(seed)
    const wm = LAYOUT_WALL_MARGIN
    const gap = LAYOUT_MIN_GAP
    const clearance = LAYOUT_BOT_CLEARANCE

    const targets: StageObjectDefinition[] = []
    for (let ti = 0; ti < 3; ti++) {
        let added = false
        for (let attempt = 0; attempt < 70; attempt++) {
            const rect = {
                kind: 'target' as const,
                x: wm + rng() * (ARENA_W - 2 * wm - TARGET_W),
                y: wm + rng() * (ARENA_H - 2 * wm - TARGET_H),
                w: TARGET_W,
                h: TARGET_H,
                hit: false,
            }
            if (!rectFitsArenaInset(rect, wm)) continue
            let ok = true
            for (const other of targets) {
                if (!rectsSeparatedByGap(rect, other, gap)) {
                    ok = false
                    break
                }
            }
            if (ok) {
                targets.push(rect)
                added = true
                break
            }
        }
        if (!added) return null
    }

    const obstacles: StageObjectDefinition[] = []
    for (let oi = 0; oi < obstacleCount; oi++) {
        let added = false
        for (let attempt = 0; attempt < 90; attempt++) {
            const rw = obstacleCount > DEFAULT_RANDOM_OBSTACLE_COUNT
                ? 40 + Math.floor(rng() * 70)
                : 48 + Math.floor(rng() * 78)
            const rh = obstacleCount > DEFAULT_RANDOM_OBSTACLE_COUNT
                ? 20 + Math.floor(rng() * 44)
                : 22 + Math.floor(rng() * 48)
            const rect = {
                kind: 'obstacle' as const,
                x: wm + rng() * Math.max(0.1, ARENA_W - 2 * wm - rw),
                y: wm + rng() * Math.max(0.1, ARENA_H - 2 * wm - rh),
                w: rw,
                h: rh,
            }
            if (!rectFitsArenaInset(rect, wm)) continue
            let ok = true
            for (const target of targets) {
                if (!rectsSeparatedByGap(rect, target, gap)) {
                    ok = false
                    break
                }
            }
            for (const other of obstacles) {
                if (!rectsSeparatedByGap(rect, other, gap)) {
                    ok = false
                    break
                }
            }
            if (ok) {
                obstacles.push(rect)
                added = true
                break
            }
        }
        if (!added) return null
    }

    const allRects = [...targets, ...obstacles]
    for (let attempt = 0; attempt < 120; attempt++) {
        const bx = BOT_R + wm + rng() * (ARENA_W - 2 * (BOT_R + wm))
        const by = BOT_R + wm + rng() * (ARENA_H - 2 * (BOT_R + wm))
        if (!botCenterClearOfRects(bx, by, allRects, clearance)) continue
        return {
            actors: [
                {
                    kind: 'bot',
                    x: bx,
                    y: by,
                    r: BOT_R,
                    heading: -Math.PI / 2 + (rng() - 0.5) * 0.6,
                    controllerId: PRIMARY_CONTROLLER_ID,
                    teamId: PRIMARY_TEAM_ID,
                    primary: true,
                },
            ],
            objects: [...obstacles, ...targets],
        }
    }

    return null
}

export function resolveStageDefinition(options?: SimOptions): StageDefinition {
    if (options?.stage) {
        return cloneStage(options.stage)
    }

    const mode = getRequestedStageMode(options)
    if (mode !== 'default') {
        const base = options?.seed ?? (Date.now() ^ (Math.floor(Math.random() * 0x7fffffff) << 16))
        if (mode === 'hardRandom') {
            let best: { stage: StageDefinition, score: number } | null = null
            for (let attempt = 0; attempt < HARD_RANDOM_STAGE_ATTEMPTS; attempt++) {
                const stage = tryCreateRandomStage((base + attempt * 0x9e3779b9) >>> 0, HARD_RANDOM_OBSTACLE_COUNT)
                if (!stage) {
                    continue
                }
                const analysis = analyzeHardStageDefinition(stage)
                if (!analysis) {
                    continue
                }
                if (!best || analysis.score > best.score) {
                    best = {
                        stage,
                        score: analysis.score,
                    }
                }
            }
            if (best) {
                return cloneStage(best.stage)
            }
        } else {
            for (let attempt = 0; attempt < RANDOM_STAGE_ATTEMPTS; attempt++) {
                const stage = tryCreateRandomStage((base + attempt * 0x9e3779b9) >>> 0)
                if (stage) {
                    return stage
                }
            }
        }
    }
    return cloneStage(DEFAULT_STAGE)
}
