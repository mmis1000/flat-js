import {
    ARENA_H,
    ARENA_W,
    BOT_R,
    LAYOUT_BOT_CLEARANCE,
    LAYOUT_MIN_GAP,
    LAYOUT_WALL_MARGIN,
    PRIMARY_CONTROLLER_ID,
    PRIMARY_TEAM_ID,
    SimOptions,
    StageDefinition,
    StageObjectDefinition,
    TARGET_H,
    TARGET_W,
} from './types'
import { botCenterClearOfRects, rectFitsArenaInset, rectsSeparatedByGap } from './geometry'

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

function tryCreateRandomStage(seed: number): StageDefinition | null {
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
    for (let oi = 0; oi < 4; oi++) {
        let added = false
        for (let attempt = 0; attempt < 90; attempt++) {
            const rw = 48 + Math.floor(rng() * 78)
            const rh = 22 + Math.floor(rng() * 48)
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
    if (options?.randomizedStage) {
        const base = options.seed ?? (Date.now() ^ (Math.floor(Math.random() * 0x7fffffff) << 16))
        for (let attempt = 0; attempt < 220; attempt++) {
            const stage = tryCreateRandomStage((base + attempt * 0x9e3779b9) >>> 0)
            if (stage) {
                return stage
            }
        }
    }
    return cloneStage(DEFAULT_STAGE)
}

