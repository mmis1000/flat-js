<template>
    <canvas ref="canvas" class="game-canvas" :width="width" :height="height"></canvas>
</template>

<script lang="ts">
import Vue from 'vue'
import type { Sim, Rect } from '../game/sim'
import { ARENA_W, ARENA_H } from '../game/sim'

export default Vue.extend({
    props: {
        sim: {
            type: Object as () => Sim | null | undefined,
            default: null,
        },
    },
    data() {
        return {
            width: ARENA_W,
            height: ARENA_H,
            rafId: 0,
        }
    },
    mounted() {
        const loop = () => {
            this.draw()
            this.rafId = requestAnimationFrame(loop)
        }
        this.rafId = requestAnimationFrame(loop)
    },
    beforeDestroy() {
        cancelAnimationFrame(this.rafId)
    },
    methods: {
        draw() {
            const canvas = this.$refs.canvas as HTMLCanvasElement | undefined
            if (!canvas) return
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            ctx.fillStyle = '#111'
            ctx.fillRect(0, 0, this.width, this.height)

            const sim = this.sim
            if (!sim) return

            const snap = sim.lastSnapshot
            const obstacles: Rect[] = sim.obstacles

            // targets
            if (snap) {
                for (const t of snap.targets) {
                    ctx.fillStyle = t.hit ? '#234' : (snap.won ? '#6f6' : '#3a6')
                    ctx.fillRect(t.x, t.y, t.w, t.h)
                }
            }

            ctx.fillStyle = '#555'
            for (const o of obstacles) ctx.fillRect(o.x, o.y, o.w, o.h)

            if (!snap) return

            const path = sim.botPath
            if (path.length >= 2) {
                ctx.strokeStyle = 'rgba(105, 153, 255, 0.5)'
                ctx.lineWidth = 2
                ctx.lineJoin = 'round'
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(path[0].x, path[0].y)
                for (let i = 1; i < path.length; i++) {
                    ctx.lineTo(path[i].x, path[i].y)
                }
                ctx.stroke()
            }

            if (snap.scanRays) {
                ctx.strokeStyle = 'rgba(255,255,0,0.3)'
                ctx.lineWidth = 1
                ctx.beginPath()
                for (const r of snap.scanRays) {
                    ctx.moveTo(r.x1, r.y1)
                    ctx.lineTo(r.x2, r.y2)
                }
                ctx.stroke()
            }

            ctx.fillStyle = '#fc6'
            for (const d of snap.discs) {
                ctx.beginPath()
                ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
                ctx.fill()
            }

            const b = snap.bot
            ctx.fillStyle = '#69f'
            ctx.beginPath()
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#fff'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(b.x, b.y)
            ctx.lineTo(b.x + Math.cos(b.heading) * b.r, b.y + Math.sin(b.heading) * b.r)
            ctx.stroke()

            if (snap.won) {
                ctx.fillStyle = '#fff'
                ctx.font = '24px sans-serif'
                ctx.textAlign = 'center'
                ctx.fillText('WIN', this.width / 2, this.height / 2 - 8)
                ctx.font = '14px sans-serif'
                ctx.fillText(snap.tick + ' ticks', this.width / 2, this.height / 2 + 14)
                ctx.textAlign = 'start'
            }
        },
    },
})
</script>

<style scoped>
.game-canvas {
    display: block;
    background: #111;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    image-rendering: pixelated;
}
</style>
