import { ARENA_H, ARENA_W, BOT_R, Rect } from './types'

export function rectFitsArenaInset(r: Rect, inset: number) {
    return r.x >= inset && r.y >= inset && r.x + r.w <= ARENA_W - inset && r.y + r.h <= ARENA_H - inset
}

export function rectsSeparatedByGap(a: Rect, b: Rect, gap: number) {
    return a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y
}

export function rectHitsCircle(r: Rect, cx: number, cy: number, cr: number): boolean {
    const nx = Math.max(r.x, Math.min(cx, r.x + r.w))
    const ny = Math.max(r.y, Math.min(cy, r.y + r.h))
    const dx = cx - nx
    const dy = cy - ny
    return dx * dx + dy * dy <= cr * cr
}

export function circleHitsRect(cx: number, cy: number, cr: number, r: Rect): boolean {
    return rectHitsCircle(r, cx, cy, cr)
}

export function botCenterClearOfRects(bx: number, by: number, rects: Rect[], clearance: number) {
    for (const r of rects) {
        if (circleHitsRect(bx, by, BOT_R + clearance, r)) return false
    }
    return true
}

export function rayAabb(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    interior: boolean
): number | null {
    let tmin = -Infinity
    let tmax = Infinity
    if (dx !== 0) {
        const t1 = (x0 - ox) / dx
        const t2 = (x1 - ox) / dx
        tmin = Math.max(tmin, Math.min(t1, t2))
        tmax = Math.min(tmax, Math.max(t1, t2))
    } else if (ox < x0 || ox > x1) {
        return null
    }
    if (dy !== 0) {
        const t1 = (y0 - oy) / dy
        const t2 = (y1 - oy) / dy
        tmin = Math.max(tmin, Math.min(t1, t2))
        tmax = Math.min(tmax, Math.max(t1, t2))
    } else if (oy < y0 || oy > y1) {
        return null
    }
    if (tmax < 0 || tmin > tmax) return null
    if (interior) return tmax > 0 ? tmax : null
    return tmin >= 0 ? tmin : null
}

export function rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, cr: number): number | null {
    const fx = ox - cx
    const fy = oy - cy
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

