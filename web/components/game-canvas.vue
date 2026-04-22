<template>
    <div ref="wrapper" class="game-canvas-wrapper" :data-view-mode="viewMode">
        <div v-if="!isReady" class="loading-overlay">
            <div class="spinner"></div>
            <div>Waiting for bot signal...</div>
        </div>

        <div ref="container" v-show="viewMode === 'follow3d'" class="webgl-container"></div>

        <canvas
            v-show="isReady && viewMode === 'map2d'"
            ref="mapCanvas"
            class="map-canvas"
        ></canvas>

        <canvas
            v-show="isReady && viewMode === 'follow3d'"
            ref="hudCanvas"
            class="hud-canvas"
        ></canvas>

        <div v-if="isWon" class="win-overlay">
            <div class="win-title">WIN</div>
            <div class="win-ticks">{{ tickCount }} ticks</div>
        </div>
    </div>
</template>

<script lang="ts">
import Vue from 'vue'
import * as THREE from 'three'
import {
    ActiveIntent,
    ARENA_H,
    ARENA_W,
    Bot,
    BOT_R,
    Disc,
    DISC_R,
    HitType,
    Rect,
    ScanRayVisual,
    Sim,
    Target,
} from '../game/sim'

type ViewMode = 'follow3d' | 'map2d'

type WallMeshEntry = {
    mesh: THREE.Mesh
    baseMaterial: THREE.Material
    box: THREE.Box3
}

type CanvasSurface = {
    ctx: CanvasRenderingContext2D
    width: number
    height: number
}

function withNonReactive<TData>(data: TData) {
    return <TNonReactive>() => data as TData & TNonReactive
}

function getEffectiveDevicePixelRatio() {
    return Math.max(1, window.devicePixelRatio || 1)
}

const BORDER_WALL_THICKNESS = 20
const WALL_HEIGHT = 40
const CAMERA_BACK_OFFSET = 92
const CAMERA_UP_OFFSET = 68
const INTENT_ARROW_LENGTH = 45
const BOT_MODEL_HEIGHT = 12
const BOT_HITBOX_HEIGHT = 16
const HUD_WIDTH = 150
const HUD_HEIGHT = 100

function createRoundedRectShape(halfW: number, halfH: number, cornerR: number) {
    const shape = new THREE.Shape()
    const r = Math.min(cornerR, halfW, halfH)
    if (r <= 0 || halfW <= 0 || halfH <= 0) {
        shape.moveTo(-halfW, -halfH)
        shape.lineTo(halfW, -halfH)
        shape.lineTo(halfW, halfH)
        shape.lineTo(-halfW, halfH)
        shape.lineTo(-halfW, -halfH)
        return shape
    }
    shape.moveTo(-halfW + r, -halfH)
    shape.lineTo(halfW - r, -halfH)
    shape.absarc(halfW - r, -halfH + r, r, -Math.PI / 2, 0, false)
    shape.lineTo(halfW, halfH - r)
    shape.absarc(halfW - r, halfH - r, r, 0, Math.PI / 2, false)
    shape.lineTo(-halfW + r, halfH)
    shape.absarc(-halfW + r, halfH - r, r, Math.PI / 2, Math.PI, false)
    shape.lineTo(-halfW, -halfH + r)
    shape.absarc(-halfW + r, -halfH + r, r, Math.PI, Math.PI * 1.5, false)
    return shape
}

function rayColor(hitType: ScanRayVisual['hitType']) {
    switch (hitType) {
        case 'target':
            return { hex: 0x22ff88, stroke: 'rgba(34, 255, 136, 0.9)', alpha: 0.9 }
        case 'disc':
            return { hex: 0xffd54a, stroke: 'rgba(255, 213, 74, 0.88)', alpha: 0.88 }
        case 'wall':
        case 'obstacle':
            return { hex: 0xff5a36, stroke: 'rgba(255, 90, 54, 0.88)', alpha: 0.88 }
        default:
            return { hex: 0x7adfff, stroke: 'rgba(122, 223, 255, 0.32)', alpha: 0.32 }
    }
}

function clearGroup(group: THREE.Group, disposeMaterial = false) {
    while (group.children.length > 0) {
        const child = group.children[0] as THREE.Mesh | THREE.Line | THREE.LineSegments
        const geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
        geometry?.dispose()
        if (disposeMaterial) {
            const material = (child as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
            if (Array.isArray(material)) {
                material.forEach(item => item.dispose())
            } else {
                material?.dispose()
            }
        }
        group.remove(child)
    }
}

function borderWalls(): Rect[] {
    return [
        { x: -BORDER_WALL_THICKNESS, y: -BORDER_WALL_THICKNESS, w: ARENA_W + BORDER_WALL_THICKNESS * 2, h: BORDER_WALL_THICKNESS },
        { x: -BORDER_WALL_THICKNESS, y: ARENA_H, w: ARENA_W + BORDER_WALL_THICKNESS * 2, h: BORDER_WALL_THICKNESS },
        { x: -BORDER_WALL_THICKNESS, y: 0, w: BORDER_WALL_THICKNESS, h: ARENA_H },
        { x: ARENA_W, y: 0, w: BORDER_WALL_THICKNESS, h: ARENA_H },
    ]
}

export default Vue.extend({
    name: 'GameCanvas',
    props: {
        sim: {
            type: Object as () => Sim | null,
            required: false,
            default: null,
        },
        viewMode: {
            type: String as () => ViewMode,
            default: 'follow3d',
        },
        showHitboxes: {
            type: Boolean,
            default: false,
        },
    },
    data() {
        return withNonReactive({
            isWon: false,
            tickCount: 0,
            scene: null as THREE.Scene | null,
            camera: null as THREE.PerspectiveCamera | null,
            renderer: null as THREE.WebGLRenderer | null,
            playerLight: null as THREE.PointLight | null,
            resizeObserver: null as ResizeObserver | null,
            animationFrameId: 0,
            lastPixelRatio: 1,
            raycaster: new THREE.Raycaster(),
            floorGrid: null as THREE.GridHelper | null,
            arenaBoundsLine: null as THREE.Line | null,
            wallGroup: new THREE.Group(),
            targetGroup: new THREE.Group(),
            discGroup: new THREE.Group(),
            scanRayGroup: new THREE.Group(),
            obstacleHitboxGroup: new THREE.Group(),
            targetHitboxGroup: new THREE.Group(),
            wallMeshes: [] as WallMeshEntry[],
            activeOccluders: new Set<THREE.Mesh>(),
            lastObstacleKey: '',
            lastTargetKey: '',
            obstacleWallMaterial: new THREE.MeshStandardMaterial({
                color: 0x0b8bd7,
                roughness: 0.28,
                metalness: 0.18,
            }),
            borderWallMaterial: new THREE.MeshStandardMaterial({
                color: 0x0f557b,
                roughness: 0.4,
                metalness: 0.12,
            }),
            wallHologramMaterial: new THREE.MeshStandardMaterial({
                color: 0x67ebff,
                transparent: true,
                opacity: 0.2,
                depthWrite: false,
                roughness: 0.2,
                metalness: 0,
                side: THREE.DoubleSide,
            }),
            targetGeo: new THREE.OctahedronGeometry(12),
            targetMat: new THREE.MeshStandardMaterial({
                color: 0x00ff88,
                emissive: 0x00ff88,
                emissiveIntensity: 0.72,
                roughness: 0.12,
            }),
            discGeo: new THREE.CylinderGeometry(DISC_R * 1.14, DISC_R * 1.14, Math.max(1.8, DISC_R * 0.52), 28),
            discMat: new THREE.MeshStandardMaterial({
                color: 0xffc347,
                emissive: 0xd16f10,
                emissiveIntensity: 0.64,
                roughness: 0.22,
                metalness: 0.28,
            }),
            targetHitboxMaterial: new THREE.LineBasicMaterial({
                color: 0x22ff88,
                transparent: true,
                opacity: 0.72,
                depthTest: false,
            }),
            obstacleHitboxMaterial: new THREE.LineBasicMaterial({
                color: 0xff5a36,
                transparent: true,
                opacity: 0.78,
                depthTest: false,
            }),
            botHitboxMaterial: new THREE.LineBasicMaterial({
                color: 0x67ebff,
                transparent: true,
                opacity: 0.8,
                depthTest: false,
            }),
            botGroup: null as THREE.Group | null,
            botHitbox: null as THREE.LineSegments | null,
            moveIntentGroup: null as THREE.Group | null,
            rotateIntentArrow: null as THREE.ArrowHelper | null,
            moveIntentRingMaterial: new THREE.MeshBasicMaterial({
                color: 0x67ebff,
                transparent: true,
                opacity: 0.78,
                depthWrite: false,
                depthTest: false,
                side: THREE.DoubleSide,
            }),
            moveIntentLineMaterial: new THREE.LineBasicMaterial({
                color: 0x67ebff,
                transparent: true,
                opacity: 0.9,
                depthTest: false,
            }),
        })()
    },
    computed: {
        isReady(): boolean {
            return !!(this.sim && this.sim.view.bot)
        },
    },
    watch: {
        viewMode() {
            this.clearOccludedWalls()
        },
    },
    mounted() {
        this.init3D()
        this.animate()
    },
    beforeDestroy() {
        this.destroy3D()
    },
    methods: {
        init3D() {
            const container = this.$refs.container as HTMLDivElement | undefined
            const wrapper = this.$refs.wrapper as HTMLDivElement | undefined
            if (!container || !wrapper) {
                return
            }

            const scene = this.scene = new THREE.Scene()
            scene.background = new THREE.Color(0x06131d)
            scene.fog = new THREE.FogExp2(0x06131d, 0.0028)

            const camera = this.camera = new THREE.PerspectiveCamera(68, 1, 0.1, 1600)
            const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true })
            this.lastPixelRatio = getEffectiveDevicePixelRatio()
            renderer.setPixelRatio(this.lastPixelRatio)
            renderer.setClearColor(0x06131d)
            renderer.domElement.style.display = 'block'
            renderer.domElement.style.width = '100%'
            renderer.domElement.style.height = '100%'
            container.appendChild(renderer.domElement)

            scene.add(new THREE.AmbientLight(0xffffff, 0.54))
            const hemi = new THREE.HemisphereLight(0x95dfff, 0x07111a, 0.92)
            scene.add(hemi)
            const rim = new THREE.DirectionalLight(0x8edfff, 0.7)
            rim.position.set(180, 240, 120)
            scene.add(rim)
            this.playerLight = new THREE.PointLight(0x9ff6ff, 1.35, 340)
            scene.add(this.playerLight)

            const floor = new THREE.Mesh(
                new THREE.PlaneGeometry(ARENA_W, ARENA_H),
                new THREE.MeshStandardMaterial({ color: 0x071019, roughness: 0.92 })
            )
            floor.rotation.x = -Math.PI / 2
            floor.position.set(ARENA_W / 2, 0, ARENA_H / 2)
            scene.add(floor)

            this.floorGrid = new THREE.GridHelper(Math.max(ARENA_W, ARENA_H), 30, 0x0e4863, 0x07212f)
            this.floorGrid.position.set(ARENA_W / 2, 0.04, ARENA_H / 2)
            scene.add(this.floorGrid)

            const boundsPoints = [
                new THREE.Vector3(0, 0.06, 0),
                new THREE.Vector3(ARENA_W, 0.06, 0),
                new THREE.Vector3(ARENA_W, 0.06, ARENA_H),
                new THREE.Vector3(0, 0.06, ARENA_H),
                new THREE.Vector3(0, 0.06, 0),
            ]
            this.arenaBoundsLine = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(boundsPoints),
                new THREE.LineBasicMaterial({
                    color: 0x5fddff,
                    transparent: true,
                    opacity: 0.18,
                    depthWrite: false,
                })
            )
            scene.add(this.arenaBoundsLine)

            scene.add(this.wallGroup)
            scene.add(this.targetGroup)
            scene.add(this.discGroup)
            scene.add(this.scanRayGroup)
            scene.add(this.obstacleHitboxGroup)
            scene.add(this.targetHitboxGroup)

            const botGroup = this.botGroup = new THREE.Group()
            const chassis = new THREE.Mesh(
                new THREE.CylinderGeometry(BOT_R * 1.02, BOT_R * 1.05, 6.4, 40),
                new THREE.MeshStandardMaterial({
                    color: 0x86f2ff,
                    emissive: 0x0f5368,
                    emissiveIntensity: 0.24,
                    roughness: 0.34,
                    metalness: 0.16,
                })
            )
            chassis.position.y = 3.2
            botGroup.add(chassis)

            const lid = new THREE.Mesh(
                new THREE.CylinderGeometry(BOT_R * 0.84, BOT_R * 0.88, 1.6, 36),
                new THREE.MeshStandardMaterial({
                    color: 0xe8fdff,
                    emissive: 0x1b5168,
                    emissiveIntensity: 0.18,
                    roughness: 0.14,
                    metalness: 0.08,
                })
            )
            lid.position.y = 6.5
            botGroup.add(lid)

            const lidarBase = new THREE.Mesh(
                new THREE.CylinderGeometry(BOT_R * 0.28, BOT_R * 0.31, 1.8, 24),
                new THREE.MeshStandardMaterial({
                    color: 0x0c1d28,
                    emissive: 0x12364a,
                    emissiveIntensity: 0.18,
                    roughness: 0.4,
                    metalness: 0.42,
                })
            )
            lidarBase.position.y = 8
            botGroup.add(lidarBase)

            const lidarCap = new THREE.Mesh(
                new THREE.CylinderGeometry(BOT_R * 0.16, BOT_R * 0.16, 1.1, 18),
                new THREE.MeshStandardMaterial({
                    color: 0xfff2bc,
                    emissive: 0xa68618,
                    emissiveIntensity: 0.48,
                    roughness: 0.18,
                    metalness: 0.12,
                })
            )
            lidarCap.position.y = 9.3
            botGroup.add(lidarCap)

            const frontSensor = new THREE.Mesh(
                new THREE.BoxGeometry(8.8, 1.45, 3.4),
                new THREE.MeshStandardMaterial({
                    color: 0x0d2030,
                    emissive: 0x1a5c74,
                    emissiveIntensity: 0.26,
                    roughness: 0.28,
                    metalness: 0.34,
                })
            )
            frontSensor.position.set(BOT_R * 0.74, 4.2, 0)
            frontSensor.rotation.y = Math.PI / 2
            botGroup.add(frontSensor)

            const wheelMaterial = new THREE.MeshStandardMaterial({
                color: 0x091119,
                roughness: 0.78,
                metalness: 0.05,
            })
            for (const side of [-1, 1]) {
                const wheel = new THREE.Mesh(
                    new THREE.CylinderGeometry(2.7, 2.7, 3.2, 16),
                    wheelMaterial
                )
                wheel.rotation.z = Math.PI / 2
                wheel.position.set(0, 2.5, side * (BOT_R * 0.88))
                botGroup.add(wheel)
            }

            const brushMaterial = new THREE.LineBasicMaterial({
                color: 0xa8efff,
                transparent: true,
                opacity: 0.7,
            })
            const leftBrush = new THREE.LineSegments(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(BOT_R * 0.72, 0.3, -BOT_R * 0.42),
                    new THREE.Vector3(BOT_R * 1.02, 0.3, -BOT_R * 0.72),
                    new THREE.Vector3(BOT_R * 0.76, 0.3, -BOT_R * 0.34),
                    new THREE.Vector3(BOT_R * 1.1, 0.3, -BOT_R * 0.42),
                ]),
                brushMaterial
            )
            botGroup.add(leftBrush)

            const rightBrush = new THREE.LineSegments(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(BOT_R * 0.72, 0.3, BOT_R * 0.42),
                    new THREE.Vector3(BOT_R * 1.02, 0.3, BOT_R * 0.72),
                    new THREE.Vector3(BOT_R * 0.76, 0.3, BOT_R * 0.34),
                    new THREE.Vector3(BOT_R * 1.1, 0.3, BOT_R * 0.42),
                ]),
                brushMaterial
            )
            botGroup.add(rightBrush)

            scene.add(botGroup)

            this.botHitbox = new THREE.LineSegments(
                new THREE.EdgesGeometry(new THREE.CylinderGeometry(BOT_R, BOT_R, BOT_HITBOX_HEIGHT, 28, 1, true)),
                this.botHitboxMaterial
            )
            this.botHitbox.position.y = BOT_HITBOX_HEIGHT / 2
            this.botHitbox.visible = false
            scene.add(this.botHitbox)

            const moveIntentGroup = this.moveIntentGroup = new THREE.Group()
            const ring = new THREE.Mesh(new THREE.RingGeometry(8, 11, 32), this.moveIntentRingMaterial)
            ring.rotation.x = -Math.PI / 2
            moveIntentGroup.add(ring)
            const cross = new THREE.LineSegments(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(-14, 0, 0),
                    new THREE.Vector3(14, 0, 0),
                    new THREE.Vector3(0, 0, -14),
                    new THREE.Vector3(0, 0, 14),
                ]),
                this.moveIntentLineMaterial
            )
            moveIntentGroup.add(cross)
            moveIntentGroup.visible = false
            moveIntentGroup.position.y = 0.24
            scene.add(moveIntentGroup)

            this.rotateIntentArrow = new THREE.ArrowHelper(
                new THREE.Vector3(1, 0, 0),
                new THREE.Vector3(),
                INTENT_ARROW_LENGTH,
                0xffbf3c,
                10,
                6
            )
            ;(this.rotateIntentArrow.line.material as THREE.Material).depthTest = false
            ;(this.rotateIntentArrow.cone.material as THREE.Material).depthTest = false
            this.rotateIntentArrow.visible = false
            scene.add(this.rotateIntentArrow)

            this.resizeObserver = new ResizeObserver(() => {
                this.resizeSurfaces()
            })
            this.resizeObserver.observe(wrapper)
            this.resizeSurfaces()
        },

        destroy3D() {
            cancelAnimationFrame(this.animationFrameId)
            this.clearOccludedWalls()

            const wrapper = this.$refs.wrapper as HTMLDivElement | undefined
            if (this.resizeObserver && wrapper) {
                this.resizeObserver.unobserve(wrapper)
            }
            this.resizeObserver = null

            clearGroup(this.wallGroup)
            clearGroup(this.obstacleHitboxGroup)
            clearGroup(this.targetHitboxGroup)
            clearGroup(this.scanRayGroup, true)

            this.targetGroup.clear()
            this.discGroup.clear()

            this.renderer?.dispose()
            this.renderer = null
            this.scene = null
            this.camera = null

            this.obstacleWallMaterial.dispose()
            this.borderWallMaterial.dispose()
            this.wallHologramMaterial.dispose()
            this.targetGeo.dispose()
            this.targetMat.dispose()
            this.discGeo.dispose()
            this.discMat.dispose()
            this.targetHitboxMaterial.dispose()
            this.obstacleHitboxMaterial.dispose()
            this.botHitboxMaterial.dispose()
            this.moveIntentRingMaterial.dispose()
            this.moveIntentLineMaterial.dispose()
            this.arenaBoundsLine?.geometry.dispose()
            ;(this.arenaBoundsLine?.material as THREE.Material | undefined)?.dispose()
        },

        resizeSurfaces() {
            const wrapper = this.$refs.wrapper as HTMLDivElement | undefined
            if (!wrapper) {
                return
            }

            const width = Math.max(1, Math.round(wrapper.clientWidth))
            const height = Math.max(1, Math.round(wrapper.clientHeight))
            const dpr = getEffectiveDevicePixelRatio()
            this.lastPixelRatio = dpr

            if (this.renderer && this.camera) {
                this.renderer.setPixelRatio(dpr)
                this.renderer.setSize(width, height, true)
                this.camera.aspect = width / height
                this.camera.updateProjectionMatrix()
            }

            const mapCanvas = this.$refs.mapCanvas as HTMLCanvasElement | undefined
            if (mapCanvas) {
                mapCanvas.width = Math.max(1, Math.round(width * dpr))
                mapCanvas.height = Math.max(1, Math.round(height * dpr))
            }

            const hudCanvas = this.$refs.hudCanvas as HTMLCanvasElement | undefined
            if (hudCanvas) {
                hudCanvas.width = Math.max(1, Math.round(HUD_WIDTH * dpr))
                hudCanvas.height = Math.max(1, Math.round(HUD_HEIGHT * dpr))
            }
        },

        getCanvasSurface(canvas: HTMLCanvasElement | undefined): CanvasSurface | null {
            if (!canvas) {
                return null
            }
            const ctx = canvas.getContext('2d')
            if (!ctx) {
                return null
            }
            const dpr = window.devicePixelRatio || 1
            const width = canvas.width / dpr
            const height = canvas.height / dpr
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            ctx.clearRect(0, 0, width, height)
            return { ctx, width, height }
        },

        updateWorldVisuals() {
            const sim = this.sim
            if (!sim) {
                return
            }
            const view = sim.view
            if (!view.bot) {
                return
            }

            this.isWon = view.won
            this.tickCount = view.tick

            const obstacleKey = view.obstacles.map(o => `${o.x}|${o.y}|${o.w}|${o.h}`).join(';')
            if (obstacleKey !== this.lastObstacleKey) {
                this.lastObstacleKey = obstacleKey
                this.rebuildWallMeshes(view.obstacles as Rect[])
                this.rebuildObstacleHitboxes(view.obstacles as Rect[])
            }

            const targetKey = view.targets.map(t => `${t.x}|${t.y}|${t.w}|${t.h}`).join(';')
            if (targetKey !== this.lastTargetKey) {
                this.lastTargetKey = targetKey
                this.rebuildTargets(view.targets as Target[])
            }

            this.updateBot(view.bot)
            this.updateTargetVisibility(view.targets as Target[])
            this.updateDiscs(view.discs as Disc[])
            this.updateScanRays((view.currentScanRays ?? []) as ScanRayVisual[])
            this.updateIntentMarkers(view.activeIntent)
            this.updateHitboxVisibility(view.targets as Target[])
        },

        rebuildWallMeshes(obstacles: Rect[]) {
            clearGroup(this.wallGroup)
            this.clearOccludedWalls()
            this.wallMeshes = []

            for (const rect of [...obstacles, ...borderWalls()]) {
                const isBorder = rect.x < 0 || rect.y < 0 || rect.x + rect.w > ARENA_W || rect.y + rect.h > ARENA_H
                const material = isBorder ? this.borderWallMaterial : this.obstacleWallMaterial
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(rect.w, WALL_HEIGHT, rect.h), material)
                const center = new THREE.Vector3(rect.x + rect.w / 2, WALL_HEIGHT / 2, rect.y + rect.h / 2)
                mesh.position.copy(center)
                mesh.castShadow = false
                mesh.receiveShadow = true
                this.wallGroup.add(mesh)
                this.wallMeshes.push({
                    mesh,
                    baseMaterial: material,
                    box: new THREE.Box3().setFromCenterAndSize(
                        center,
                        new THREE.Vector3(rect.w, WALL_HEIGHT, rect.h)
                    ),
                })
            }
        },

        rebuildObstacleHitboxes(obstacles: Rect[]) {
            clearGroup(this.obstacleHitboxGroup)

            for (const rect of obstacles) {
                const lines = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.BoxGeometry(rect.w, WALL_HEIGHT, rect.h)),
                    this.obstacleHitboxMaterial
                )
                lines.position.set(rect.x + rect.w / 2, WALL_HEIGHT / 2, rect.y + rect.h / 2)
                this.obstacleHitboxGroup.add(lines)
            }
        },

        rebuildTargets(targets: Target[]) {
            clearGroup(this.targetHitboxGroup)
            this.targetGroup.clear()

            for (const target of targets) {
                const crystal = new THREE.Mesh(this.targetGeo, this.targetMat)
                crystal.position.set(target.x + target.w / 2, BOT_MODEL_HEIGHT, target.y + target.h / 2)
                this.targetGroup.add(crystal)

                const hitbox = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.BoxGeometry(target.w, BOT_MODEL_HEIGHT * 1.5, target.h)),
                    this.targetHitboxMaterial
                )
                hitbox.position.set(target.x + target.w / 2, BOT_MODEL_HEIGHT * 0.75, target.y + target.h / 2)
                this.targetHitboxGroup.add(hitbox)
            }
        },

        updateBot(bot: Bot) {
            if (!this.botGroup) {
                return
            }
            this.botGroup.position.set(bot.x, 0, bot.y)
            this.botGroup.rotation.y = -bot.heading

            if (this.botHitbox) {
                this.botHitbox.position.set(bot.x, BOT_HITBOX_HEIGHT / 2, bot.y)
            }
        },

        updateTargetVisibility(targets: Target[]) {
            this.targetGroup.children.forEach((child, index) => {
                const target = targets[index]
                child.visible = !!target && !target.hit
                if (child.visible) {
                    child.rotation.y += 0.03
                    child.rotation.x += 0.018
                }
            })
        },

        updateDiscs(discs: Disc[]) {
            const activeDiscs = discs.filter(d => d.alive)
            while (this.discGroup.children.length < activeDiscs.length) {
                this.discGroup.add(new THREE.Mesh(this.discGeo, this.discMat))
            }
            this.discGroup.children.forEach((child, index) => {
                const disc = activeDiscs[index]
                child.visible = !!disc
                if (disc) {
                    child.position.set(disc.x, disc.r, disc.y)
                    child.rotation.y += 0.28
                }
            })
        },

        updateHitboxVisibility(targets: Target[]) {
            const visible = this.showHitboxes
            if (this.botHitbox) {
                this.botHitbox.visible = visible
            }
            this.obstacleHitboxGroup.visible = visible
            this.targetHitboxGroup.visible = visible
            this.targetHitboxGroup.children.forEach((child, index) => {
                child.visible = visible && !targets[index]?.hit
            })
        },

        updateScanRays(rays: ScanRayVisual[]) {
            while (this.scanRayGroup.children.length < rays.length) {
                const geometry = new THREE.BufferGeometry()
                geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
                const material = new THREE.LineBasicMaterial({
                    color: 0x7adfff,
                    transparent: true,
                    opacity: 0.3,
                    depthWrite: false,
                    depthTest: false,
                })
                const line = new THREE.Line(geometry, material)
                // Ray endpoints are mutated in place, so stale bounds can incorrectly cull them.
                line.frustumCulled = false
                line.renderOrder = 12
                this.scanRayGroup.add(line)
            }

            this.scanRayGroup.children.forEach((child, index) => {
                const line = child as THREE.Line
                const ray = rays[index]
                line.visible = !!ray
                if (!ray) {
                    return
                }
                const position = line.geometry.getAttribute('position') as THREE.BufferAttribute
                position.setXYZ(0, ray.x1, BOT_MODEL_HEIGHT * 0.65, ray.y1)
                position.setXYZ(1, ray.x2, BOT_MODEL_HEIGHT * 0.65, ray.y2)
                position.needsUpdate = true
                const material = line.material as THREE.LineBasicMaterial
                const palette = rayColor(ray.hitType)
                material.color.setHex(palette.hex)
                material.opacity = palette.alpha
            })
        },

        updateIntentMarkers(intent: ActiveIntent | null) {
            if (this.moveIntentGroup) {
                this.moveIntentGroup.visible = intent?.kind === 'move'
                if (intent?.kind === 'move') {
                    this.moveIntentGroup.position.set(intent.endX, 0.24, intent.endY)
                }
            }

            if (this.rotateIntentArrow) {
                this.rotateIntentArrow.visible = intent?.kind === 'rotate'
                if (intent?.kind === 'rotate') {
                    const dir = new THREE.Vector3(Math.cos(intent.endHeading), 0, Math.sin(intent.endHeading)).normalize()
                    this.rotateIntentArrow.position.set(intent.startX, BOT_MODEL_HEIGHT * 0.65, intent.startY)
                    this.rotateIntentArrow.setDirection(dir)
                    this.rotateIntentArrow.setLength(INTENT_ARROW_LENGTH, 10, 6)
                }
            }
        },

        updateCamera(bot: Bot) {
            if (!this.camera || !this.playerLight) {
                return
            }

            const dir = new THREE.Vector3(Math.cos(bot.heading), 0, Math.sin(bot.heading))
            const botPos = new THREE.Vector3(bot.x, BOT_MODEL_HEIGHT * 0.78, bot.y)
            const cameraPos = botPos.clone().add(new THREE.Vector3(
                -dir.x * CAMERA_BACK_OFFSET,
                CAMERA_UP_OFFSET,
                -dir.z * CAMERA_BACK_OFFSET
            ))
            const focusTarget = botPos.clone()

            this.camera.position.copy(cameraPos)
            this.camera.lookAt(focusTarget)
            this.playerLight.position.copy(botPos).add(new THREE.Vector3(0, 72, 0))

            this.updateWallOcclusion(botPos, cameraPos)
        },

        updateWallOcclusion(botPos: THREE.Vector3, cameraPos: THREE.Vector3) {
            if (this.wallMeshes.length === 0) {
                this.clearOccludedWalls()
                return
            }

            const direction = botPos.clone().sub(cameraPos)
            const distance = direction.length()
            if (distance <= 0.001) {
                this.clearOccludedWalls()
                return
            }

            this.raycaster.set(cameraPos, direction.normalize())
            this.raycaster.far = distance
            const hits = this.raycaster.intersectObjects(this.wallMeshes.map(entry => entry.mesh), false)
            const nextOccluders = new Set(hits.map(hit => hit.object as THREE.Mesh))
            for (const entry of this.wallMeshes) {
                if (entry.box.distanceToPoint(cameraPos) <= 0.001) {
                    nextOccluders.add(entry.mesh)
                }
            }

            for (const mesh of this.activeOccluders) {
                if (!nextOccluders.has(mesh)) {
                    const entry = this.wallMeshes.find(item => item.mesh === mesh)
                    if (entry) {
                        entry.mesh.material = entry.baseMaterial
                    }
                }
            }

            for (const mesh of nextOccluders) {
                if (!this.activeOccluders.has(mesh)) {
                    mesh.material = this.wallHologramMaterial
                }
            }

            this.activeOccluders = nextOccluders
        },

        clearOccludedWalls() {
            for (const entry of this.wallMeshes) {
                entry.mesh.material = entry.baseMaterial
            }
            this.activeOccluders.clear()
        },

        drawTacticalMap(canvas: HTMLCanvasElement | undefined, compact: boolean) {
            const sim = this.sim
            if (!sim) {
                return
            }
            const view = sim.view
            if (!view.bot) {
                return
            }

            const surface = this.getCanvasSurface(canvas)
            if (!surface) {
                return
            }

            const { ctx, width, height } = surface
            ctx.fillStyle = compact ? 'rgba(3, 12, 17, 0.72)' : '#041019'
            ctx.fillRect(0, 0, width, height)

            const padding = compact ? 8 : 24
            const scale = Math.min((width - padding * 2) / ARENA_W, (height - padding * 2) / ARENA_H)
            const arenaWidth = ARENA_W * scale
            const arenaHeight = ARENA_H * scale
            const offsetX = (width - arenaWidth) / 2
            const offsetY = (height - arenaHeight) / 2
            const toX = (x: number) => offsetX + x * scale
            const toY = (y: number) => offsetY + y * scale

            ctx.fillStyle = compact ? 'rgba(6, 19, 29, 0.84)' : '#071521'
            ctx.fillRect(offsetX, offsetY, arenaWidth, arenaHeight)

            ctx.strokeStyle = compact ? 'rgba(95, 221, 255, 0.9)' : 'rgba(95, 221, 255, 0.75)'
            ctx.lineWidth = compact ? 1.4 : 2
            ctx.strokeRect(offsetX, offsetY, arenaWidth, arenaHeight)

            ctx.save()
            ctx.strokeStyle = compact ? 'rgba(15, 72, 99, 0.3)' : 'rgba(15, 72, 99, 0.36)'
            ctx.lineWidth = 1
            for (let x = 60; x < ARENA_W; x += 60) {
                ctx.beginPath()
                ctx.moveTo(toX(x), offsetY)
                ctx.lineTo(toX(x), offsetY + arenaHeight)
                ctx.stroke()
            }
            for (let y = 40; y < ARENA_H; y += 40) {
                ctx.beginPath()
                ctx.moveTo(offsetX, toY(y))
                ctx.lineTo(offsetX + arenaWidth, toY(y))
                ctx.stroke()
            }
            ctx.restore()

            for (const ray of view.currentScanRays ?? []) {
                const palette = rayColor(ray.hitType)
                ctx.strokeStyle = palette.stroke
                ctx.lineWidth = compact ? 1 : 2
                ctx.beginPath()
                ctx.moveTo(toX(ray.x1), toY(ray.y1))
                ctx.lineTo(toX(ray.x2), toY(ray.y2))
                ctx.stroke()
            }

            ctx.fillStyle = 'rgba(11, 139, 215, 0.88)'
            for (const obstacle of view.obstacles) {
                ctx.fillRect(toX(obstacle.x), toY(obstacle.y), obstacle.w * scale, obstacle.h * scale)
            }

            if (this.showHitboxes) {
                ctx.lineWidth = compact ? 1.2 : 2
                ctx.strokeStyle = 'rgba(255, 90, 54, 0.92)'
                for (const obstacle of view.obstacles) {
                    ctx.strokeRect(toX(obstacle.x), toY(obstacle.y), obstacle.w * scale, obstacle.h * scale)
                }
                ctx.strokeStyle = 'rgba(34, 255, 136, 0.92)'
                for (const target of view.targets) {
                    if (!target.hit) {
                        ctx.strokeRect(toX(target.x), toY(target.y), target.w * scale, target.h * scale)
                    }
                }
            }

            ctx.fillStyle = '#22ff88'
            for (const target of view.targets) {
                if (!target.hit) {
                    ctx.fillRect(toX(target.x), toY(target.y), target.w * scale, target.h * scale)
                }
            }

            ctx.fillStyle = '#ffd54a'
            for (const disc of view.discs) {
                if (!disc.alive) {
                    continue
                }
                ctx.beginPath()
                ctx.arc(toX(disc.x), toY(disc.y), Math.max(1.5, disc.r * scale), 0, Math.PI * 2)
                ctx.fill()
            }

            if (view.botPath.length >= 2) {
                ctx.strokeStyle = compact ? 'rgba(103, 235, 255, 0.48)' : 'rgba(103, 235, 255, 0.56)'
                ctx.lineWidth = compact ? 1.4 : 2.2
                ctx.lineJoin = 'round'
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(toX(view.botPath[0].x), toY(view.botPath[0].y))
                for (let i = 1; i < view.botPath.length; i++) {
                    ctx.lineTo(toX(view.botPath[i].x), toY(view.botPath[i].y))
                }
                ctx.stroke()
            }

            if (view.activeIntent?.kind === 'move') {
                ctx.strokeStyle = 'rgba(103, 235, 255, 0.95)'
                ctx.lineWidth = compact ? 1.5 : 2.4
                ctx.beginPath()
                ctx.arc(toX(view.activeIntent.endX), toY(view.activeIntent.endY), compact ? 7 : 10, 0, Math.PI * 2)
                ctx.stroke()
                ctx.beginPath()
                ctx.moveTo(toX(view.activeIntent.endX) - 11, toY(view.activeIntent.endY))
                ctx.lineTo(toX(view.activeIntent.endX) + 11, toY(view.activeIntent.endY))
                ctx.moveTo(toX(view.activeIntent.endX), toY(view.activeIntent.endY) - 11)
                ctx.lineTo(toX(view.activeIntent.endX), toY(view.activeIntent.endY) + 11)
                ctx.stroke()
            } else if (view.activeIntent?.kind === 'rotate') {
                const tipX = view.activeIntent.startX + Math.cos(view.activeIntent.endHeading) * INTENT_ARROW_LENGTH
                const tipY = view.activeIntent.startY + Math.sin(view.activeIntent.endHeading) * INTENT_ARROW_LENGTH
                ctx.strokeStyle = 'rgba(255, 191, 60, 0.95)'
                ctx.fillStyle = 'rgba(255, 191, 60, 0.95)'
                ctx.lineWidth = compact ? 1.6 : 2.4
                ctx.beginPath()
                ctx.moveTo(toX(view.activeIntent.startX), toY(view.activeIntent.startY))
                ctx.lineTo(toX(tipX), toY(tipY))
                ctx.stroke()
                const arrowAngle = Math.atan2(tipY - view.activeIntent.startY, tipX - view.activeIntent.startX)
                const arrowSize = compact ? 7 : 10
                ctx.beginPath()
                ctx.moveTo(toX(tipX), toY(tipY))
                ctx.lineTo(
                    toX(tipX) - Math.cos(arrowAngle - Math.PI / 6) * arrowSize,
                    toY(tipY) - Math.sin(arrowAngle - Math.PI / 6) * arrowSize
                )
                ctx.lineTo(
                    toX(tipX) - Math.cos(arrowAngle + Math.PI / 6) * arrowSize,
                    toY(tipY) - Math.sin(arrowAngle + Math.PI / 6) * arrowSize
                )
                ctx.closePath()
                ctx.fill()
            }

            if (this.showHitboxes) {
                ctx.strokeStyle = 'rgba(103, 235, 255, 0.95)'
                ctx.lineWidth = compact ? 1.3 : 2
                ctx.beginPath()
                ctx.arc(toX(view.bot.x), toY(view.bot.y), view.bot.r * scale, 0, Math.PI * 2)
                ctx.stroke()
            }

            ctx.fillStyle = '#56d8ff'
            ctx.beginPath()
            ctx.arc(toX(view.bot.x), toY(view.bot.y), Math.max(4, view.bot.r * scale), 0, Math.PI * 2)
            ctx.fill()

            const dx = Math.cos(view.bot.heading)
            const dy = Math.sin(view.bot.heading)
            ctx.strokeStyle = '#fff7c0'
            ctx.lineWidth = compact ? 1.4 : 2.4
            ctx.beginPath()
            ctx.moveTo(toX(view.bot.x), toY(view.bot.y))
            ctx.lineTo(toX(view.bot.x + dx * view.bot.r * 1.8), toY(view.bot.y + dy * view.bot.r * 1.8))
            ctx.stroke()
        },

        animate() {
            this.animationFrameId = requestAnimationFrame(() => this.animate())

            if (Math.abs(getEffectiveDevicePixelRatio() - this.lastPixelRatio) > 0.01) {
                this.resizeSurfaces()
            }

            if (!this.isReady) {
                return
            }

            const sim = this.sim!
            const bot = sim.view.bot
            this.updateWorldVisuals()

            if (this.viewMode === 'follow3d' && this.camera && this.renderer && bot) {
                this.updateCamera(bot)
                this.renderer.render(this.scene!, this.camera)
                this.drawTacticalMap(this.$refs.hudCanvas as HTMLCanvasElement | undefined, true)
            } else {
                this.clearOccludedWalls()
                this.drawTacticalMap(this.$refs.mapCanvas as HTMLCanvasElement | undefined, false)
            }
        },
    },
})
</script>

<style scoped>
.game-canvas-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    background: radial-gradient(circle at top, rgba(26, 71, 93, 0.9), rgba(2, 8, 12, 0.98));
    border-radius: 12px;
    overflow: hidden;
    box-shadow: inset 0 0 0 1px rgba(95, 221, 255, 0.14), 0 14px 30px rgba(0, 0, 0, 0.38);
}

.webgl-container,
.map-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
}

.map-canvas {
    pointer-events: none;
}

.hud-canvas {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 150px;
    height: 100px;
    pointer-events: none;
    border-radius: 6px;
    box-shadow: 0 0 0 1px rgba(95, 221, 255, 0.25);
    z-index: 5;
}

.loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 18px;
    color: #33ff88;
    font-family: monospace;
    font-size: 20px;
    z-index: 10;
    background: rgba(0, 0, 0, 0.84);
}

.spinner {
    width: 40px;
    height: 40px;
    border: 4px solid rgba(51, 255, 136, 0.2);
    border-top-color: #33ff88;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

.win-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: rgba(0, 0, 0, 0.44);
    z-index: 20;
    pointer-events: none;
    animation: fadeIn 0.5s ease-out;
}

.win-title {
    color: #ffffff;
    font-size: 48px;
    font-family: sans-serif;
    font-weight: bold;
    text-shadow: 0 0 15px rgba(102, 255, 102, 0.8);
    margin-bottom: 8px;
}

.win-ticks {
    color: #dddddd;
    font-size: 16px;
    font-family: sans-serif;
}

@media (max-width: 680px) {
    .hud-canvas {
        width: 120px;
        height: 80px;
        top: 10px;
        right: 10px;
    }
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: scale(0.95);
    }
    to {
        opacity: 1;
        transform: scale(1);
    }
}
</style>
