const SEED = 0x9e3779b1
let state = SEED >>> 0

/** Reset before each VM run so `Math.random` replays the same sequence. */
export function resetVmMathRandom() {
    state = SEED >>> 0
}

export function vmMathRandom() {
    let t = (state = (state + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const res = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    return res
}
