export type Rect = { x: number, y: number, w: number, h: number }
export type Target = Rect & { hit: boolean }
export type Disc = { x: number, y: number, vx: number, vy: number, r: number, alive: boolean }
export type Bot = { x: number, y: number, r: number, heading: number }
export type HitType = 'wall' | 'obstacle' | 'target' | 'disc'
export type ScanHit = { distance: number, type: HitType }

export type Snapshot = {
    tick: number
    bot: Bot
    discs: Disc[]
    targets: Target[]
    won: boolean
    scanRays?: { x1: number, y1: number, x2: number, y2: number }[]
}

// The only knob for "compute expensiveness". Higher = more code statements
// execute per world-action in the same wallclock time. All per-tick costs
// below are derived so that action wallclock duration stays constant.
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
const BOT_ROTATE_RAD_PER_TICK = BOT_ROTATE_DEG_PER_TICK * Math.PI / 180
export const DISC_SPEED = DISC_PX_PER_SEC / TICKS_PER_SECOND
export const SHOOT_COOLDOWN_TICKS = Math.round(SHOOT_COOLDOWN_SEC * TICKS_PER_SECOND)
export const SCAN_TICKS_PER_RAY = Math.max(1, Math.round(SCAN_SEC_PER_RAY * TICKS_PER_SECOND))

/**
 * World time advances only via `advanceOneTick()`, which the host must call
 * once per real wall-clock tick (after awaiting the same pacing timer). Nothing
 * else should advance `tick` or physics.
 */
export class Sim {
    tick = 0
    bot: Bot = { x: 40, y: ARENA_H - 40, r: BOT_R, heading: -Math.PI / 2 }
    discs: Disc[] = []
    obstacles: Rect[] = [
        { x: 150, y: 150, w: 100, h: 30 },
        { x: 280, y: 240, w: 90, h: 30 },
        { x: 420, y: 120, w: 30, h: 140 },
        { x: 120, y: 310, w: 80, h: 30 },
    ]
    targets: Target[] = [
        { x: 530, y: 30, w: 40, h: 40, hit: false },
        { x: 30, y: 30, w: 40, h: 40, hit: false },
        { x: 520, y: 330, w: 40, h: 40, hit: false },
    ]
    won = false
    shootCooldown = 0
    snapshots: Snapshot[] = []
    currentScanRays?: Snapshot['scanRays']

    private pendingMoveRemaining = 0
    private pendingMoveMoved = 0
    private moveActive = false

    private pendingRotateRemaining = 0
    private rotateActive = false

    private pendingScanTicks = 0
    private pendingScanHits: ScanHit[][] | null = null

    private shootActive = false
    private shootPhase: 'cooldown' | 'fire_next' | 'postfire' | null = null

    lastMoveReturnedDistance = 0

    constructor() {
        this.pushSnapshot()
    }

    private pushSnapshot() {
        this.snapshots.push({
            tick: this.tick,
            bot: { ...this.bot },
            discs: this.discs.filter(d => d.alive).map(d => ({ ...d })),
            targets: this.targets.map(t => ({ ...t })),
            won: this.won,
            scanRays: this.currentScanRays,
        })
    }

    isMovePending() {
        return this.moveActive
    }

    isRotatePending() {
        return this.rotateActive
    }

    isScanPending() {
        return this.pendingScanTicks > 0
    }

    isShootPending() {
        return this.shootActive
    }

    /** True while a bot API still has world ticks to consume before the VM may run again. */
    isBotVmBlocking() {
        return this.isMovePending() || this.isRotatePending() || this.isScanPending() || this.isShootPending()
    }

    beginMove(signedDist: number) {
        this.moveActive = true
        this.pendingMoveRemaining = signedDist
        this.pendingMoveMoved = 0
        this.lastMoveReturnedDistance = 0
    }

    beginRotateRadians(rad: number) {
        this.rotateActive = true
        this.pendingRotateRemaining = rad
    }

    /** Raycast + visualization; scan duration ticks counted in advanceOneTick until cleared. */
    prepareScan(rays: number): ScanHit[][] {
        rays = Math.max(1, Math.min(90, Math.floor(rays)))
        const result: ScanHit[][] = []
        const half = Math.PI / 4
        const rayVis: NonNullable<Snapshot['scanRays']> = []
        for (let i = 0; i < rays; i++) {
            const t = rays === 1 ? 0.5 : i / (rays - 1)
            const angle = this.bot.heading - half + t * (2 * half)
            const hits = this.castRay(this.bot.x, this.bot.y, angle)
            result.push(hits)
            const first = hits.length > 0 ? hits[0].distance : SCAN_RANGE
            rayVis.push({
                x1: this.bot.x,
                y1: this.bot.y,
                x2: this.bot.x + Math.cos(angle) * first,
                y2: this.bot.y + Math.sin(angle) * first,
            })
        }
        this.currentScanRays = rayVis
        this.pendingScanHits = result
        this.pendingScanTicks = Math.max(1, rays * SCAN_TICKS_PER_RAY)
        return result
    }

    beginShoot() {
        this.shootActive = true
        this.shootPhase = this.shootCooldown > 0 ? 'cooldown' : 'fire_next'
    }

    /** One world tick: pending bot work, then discs. */
    advanceOneTick() {
        this.tick++
        if (this.shootCooldown > 0) this.shootCooldown--

        this.stepPendingShoot()
        this.stepPendingRotate()
        this.stepPendingMove()
        this.stepPendingScan()

        for (const d of this.discs) {
            if (!d.alive) continue
            d.x += d.vx
            d.y += d.vy
            if (d.x < 0 || d.x > ARENA_W || d.y < 0 || d.y > ARENA_H) { d.alive = false; continue }
            let hitTarget = false
            for (const t of this.targets) {
                if (!t.hit && rectHitsCircle(t, d.x, d.y, d.r)) {
                    t.hit = true
                    d.alive = false
                    hitTarget = true
                    break
                }
            }
            if (hitTarget) {
                if (this.targets.every(t => t.hit)) this.won = true
                continue
            }
            for (const o of this.obstacles) {
                if (rectHitsCircle(o, d.x, d.y, d.r)) { d.alive = false; break }
            }
        }
        this.pushSnapshot()
    }

    private tryBotMoveStep(dx: number, dy: number): boolean {
        const nx = this.bot.x + dx
        const ny = this.bot.y + dy
        let blocked = false
        if (nx - this.bot.r < 0 || nx + this.bot.r > ARENA_W || ny - this.bot.r < 0 || ny + this.bot.r > ARENA_H) {
            blocked = true
        }
        if (!blocked) {
            for (const o of this.obstacles) {
                if (circleHitsRect(nx, ny, this.bot.r, o)) { blocked = true; break }
            }
        }
        if (!blocked) {
            this.bot.x = nx
            this.bot.y = ny
        }
        return blocked
    }

    private stepPendingMove() {
        if (!this.moveActive) return
        const rem = this.pendingMoveRemaining
        if (Math.abs(rem) < 1e-9) {
            this.lastMoveReturnedDistance = this.pendingMoveMoved
            this.moveActive = false
            this.pendingMoveRemaining = 0
            this.pendingMoveMoved = 0
            return
        }
        const step = Math.min(BOT_MOVE_PER_TICK, Math.abs(rem))
        const s = Math.sign(rem)
        const dx = Math.cos(this.bot.heading) * step * s
        const dy = Math.sin(this.bot.heading) * step * s
        const blocked = this.tryBotMoveStep(dx, dy)
        if (blocked) {
            this.lastMoveReturnedDistance = this.pendingMoveMoved
            this.moveActive = false
            this.pendingMoveRemaining = 0
            this.pendingMoveMoved = 0
            return
        }
        this.pendingMoveMoved += step
        this.pendingMoveRemaining = rem - step * s
        if (Math.abs(this.pendingMoveRemaining) < 1e-9) {
            this.lastMoveReturnedDistance = this.pendingMoveMoved
            this.moveActive = false
            this.pendingMoveRemaining = 0
            this.pendingMoveMoved = 0
        }
    }

    private stepPendingRotate() {
        if (!this.rotateActive) return
        const rem = this.pendingRotateRemaining
        if (Math.abs(rem) < 1e-12) {
            this.rotateActive = false
            this.pendingRotateRemaining = 0
            return
        }
        const step = Math.min(BOT_ROTATE_RAD_PER_TICK, Math.abs(rem))
        const s = Math.sign(rem)
        this.bot.heading += step * s
        this.pendingRotateRemaining = rem - step * s
        if (Math.abs(this.pendingRotateRemaining) < 1e-12) {
            this.rotateActive = false
            this.pendingRotateRemaining = 0
        }
    }

    private stepPendingScan() {
        if (this.pendingScanTicks <= 0) return
        this.pendingScanTicks--
        if (this.pendingScanTicks === 0) {
            this.pendingScanHits = null
            this.clearScanRays()
        }
    }

    private stepPendingShoot() {
        if (!this.shootActive) return
        const ph = this.shootPhase
        if (ph === 'cooldown') {
            if (this.shootCooldown === 0) {
                this.fireDisc()
                this.shootPhase = 'postfire'
            }
            return
        }
        if (ph === 'fire_next') {
            this.fireDisc()
            this.shootPhase = 'postfire'
            return
        }
        if (ph === 'postfire') {
            if (this.shootCooldown === 0) {
                this.shootActive = false
                this.shootPhase = null
            }
        }
    }

    fireDisc() {
        const d: Disc = {
            x: this.bot.x + Math.cos(this.bot.heading) * (this.bot.r + DISC_R + 1),
            y: this.bot.y + Math.sin(this.bot.heading) * (this.bot.r + DISC_R + 1),
            vx: Math.cos(this.bot.heading) * DISC_SPEED,
            vy: Math.sin(this.bot.heading) * DISC_SPEED,
            r: DISC_R,
            alive: true,
        }
        this.discs.push(d)
        this.shootCooldown = SHOOT_COOLDOWN_TICKS
    }

    clearScanRays() {
        this.currentScanRays = undefined
    }

    private castRay(ox: number, oy: number, angle: number): ScanHit[] {
        const dx = Math.cos(angle), dy = Math.sin(angle)
        const hits: ScanHit[] = []
        const wall = rayAabb(ox, oy, dx, dy, 0, 0, ARENA_W, ARENA_H, true)
        if (wall != null) hits.push({ distance: wall, type: 'wall' })
        for (const o of this.obstacles) {
            const d = rayAabb(ox, oy, dx, dy, o.x, o.y, o.x + o.w, o.y + o.h, false)
            if (d != null && d > this.bot.r) hits.push({ distance: d - this.bot.r, type: 'obstacle' })
        }
        for (const t of this.targets) {
            if (t.hit) continue
            const d = rayAabb(ox, oy, dx, dy, t.x, t.y, t.x + t.w, t.y + t.h, false)
            if (d != null && d > this.bot.r) hits.push({ distance: d - this.bot.r, type: 'target' })
        }
        for (const dc of this.discs) {
            if (!dc.alive) continue
            const d = rayCircle(ox, oy, dx, dy, dc.x, dc.y, dc.r)
            if (d != null && d > this.bot.r) hits.push({ distance: d - this.bot.r, type: 'disc' })
        }
        hits.sort((a, b) => a.distance - b.distance)
        return hits
    }
}

function rectHitsCircle(r: Rect, cx: number, cy: number, cr: number): boolean {
    const nx = Math.max(r.x, Math.min(cx, r.x + r.w))
    const ny = Math.max(r.y, Math.min(cy, r.y + r.h))
    const dx = cx - nx, dy = cy - ny
    return dx * dx + dy * dy <= cr * cr
}
function circleHitsRect(cx: number, cy: number, cr: number, r: Rect): boolean {
    return rectHitsCircle(r, cx, cy, cr)
}

function rayAabb(ox: number, oy: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number, interior: boolean): number | null {
    let tmin = -Infinity, tmax = Infinity
    if (dx !== 0) {
        const t1 = (x0 - ox) / dx
        const t2 = (x1 - ox) / dx
        tmin = Math.max(tmin, Math.min(t1, t2))
        tmax = Math.min(tmax, Math.max(t1, t2))
    } else if (ox < x0 || ox > x1) return null
    if (dy !== 0) {
        const t1 = (y0 - oy) / dy
        const t2 = (y1 - oy) / dy
        tmin = Math.max(tmin, Math.min(t1, t2))
        tmax = Math.min(tmax, Math.max(t1, t2))
    } else if (oy < y0 || oy > y1) return null
    if (tmax < 0 || tmin > tmax) return null
    if (interior) return tmax > 0 ? tmax : null
    return tmin >= 0 ? tmin : null
}

function rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, cr: number): number | null {
    const fx = ox - cx, fy = oy - cy
    const b = fx * dx + fy * dy
    const c = fx * fx + fy * fy - cr * cr
    const disc = b * b - c
    if (disc < 0) return null
    const s = Math.sqrt(disc)
    const t1 = -b - s
    const t2 = -b + s
    if (t1 >= 0) return t1
    if (t2 >= 0) return 0
    return null
}
