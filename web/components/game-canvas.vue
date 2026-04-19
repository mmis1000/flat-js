<template>
    <div class="game-canvas-wrapper">
      <!-- 等待連線的畫面 -->
      <div v-if="!isReady" class="loading-overlay">
        <div class="spinner"></div>
        <div>Waiting for bot signal...</div>
      </div>
  
      <!-- 3D WebGL 容器 -->
      <div ref="container" class="webgl-container"></div>
      
      <!-- 2D HUD 雷達小地圖 -->
      <canvas 
        v-show="isReady" 
        ref="hudCanvas" 
        width="150" 
        height="100" 
        class="hud-canvas"
      ></canvas>
    </div>
  </template>
  
  <script lang="ts">
  import { defineComponent, ref, computed, onMounted, onBeforeUnmount, PropType } from 'vue'
  import * as THREE from 'three'
  import { Sim } from '../game/sim'
  
  // 為了嚴格型別，將所需的結構定義在這邊，避免引發 any 警告
  type Rect = { x: number, y: number, w: number, h: number }
  type Target = Rect & { hit: boolean }
  type Disc = { x: number, y: number, vx: number, vy: number, r: number, alive: boolean }
  
  export default defineComponent({
    name: 'GameCanvas',
    props: {
      sim: {
        type: Object as PropType<Sim | null>,
        required: false,
        default: null
      }
    },
    setup(props) {
      const container = ref<HTMLDivElement | null>(null)
      const hudCanvas = ref<HTMLCanvasElement | null>(null)
      
      // 判斷 Sim 是否已經準備好 (確保 bot 物件存在)
      const isReady = computed<boolean>(() => {
        return !!(props.sim && props.sim.bot)
      })
  
      // Three.js 核心物件
      let scene: THREE.Scene
      let camera: THREE.PerspectiveCamera
      let renderer: THREE.WebGLRenderer
      let playerLight: THREE.PointLight
      
      // 場景群組與資源
      const wallGroup = new THREE.Group()
      const targetGroup = new THREE.Group()
      const discGroup = new THREE.Group()
      let currentWallCount = -1
      let instancedWalls: THREE.InstancedMesh | null = null
  
      // 共用幾何體與材質
      // 牆壁基底為 1x1x1，藉由 scale 調整成任意矩形大小
      const wallGeo = new THREE.BoxGeometry(1, 1, 1)
      wallGeo.translate(0, 0.5, 0)
      const wallMat = new THREE.MeshStandardMaterial({ 
        color: 0x0077aa, 
        roughness: 0.3,
        metalness: 0.2
      })
  
      // Target 標靶物件 (發光的八面體晶體)
      const targetGeo = new THREE.OctahedronGeometry(12)
      const targetMat = new THREE.MeshStandardMaterial({ 
        color: 0x00ff88, 
        emissive: 0x00ff88, 
        emissiveIntensity: 0.6,
        roughness: 0.1
      })
  
      // 發射的圓盤 (Disc)
      const discGeo = new THREE.SphereGeometry(4, 16, 16)
      const discMat = new THREE.MeshStandardMaterial({ 
        color: 0xffaa00,
        emissive: 0xcc5500,
        emissiveIntensity: 0.8,
        roughness: 0.2
      })
  
      let animationFrameId: number
      let resizeObserver: ResizeObserver
  
      // === 初始化 3D 場景 ===
      const init3D = () => {
        if (!container.value) return
  
        scene = new THREE.Scene()
        scene.background = new THREE.Color(0x0a0a1a)
        scene.fog = new THREE.FogExp2(0x0a0a1a, 0.003) // 調整霧的濃度以適應 600x400 的場景
  
        const aspect = container.value.clientWidth / container.value.clientHeight
        // 設定遠視距到 1500，確保看得到競技場邊界
        camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 1500)
  
        renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setSize(container.value.clientWidth, container.value.clientHeight)
        renderer.setPixelRatio(window.devicePixelRatio)
        container.value.appendChild(renderer.domElement)
  
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
        scene.add(ambientLight)
  
        playerLight = new THREE.PointLight(0xffffff, 1.2, 300)
        scene.add(playerLight)
  
        // ARENA_W = 600, ARENA_H = 400，以此建立地板
        const floorGeo = new THREE.PlaneGeometry(600, 400)
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x111111 })
        const floor = new THREE.Mesh(floorGeo, floorMat)
        floor.rotation.x = -Math.PI / 2
        floor.position.set(300, 0, 200) // 原點在左上角，因此中心在 (300, 0, 200)
        scene.add(floor)
  
        // 網格線輔助
        const gridHelper = new THREE.GridHelper(600, 60, 0x004466, 0x001122)
        gridHelper.position.set(300, 0.1, 200)
        scene.add(gridHelper)
  
        scene.add(wallGroup)
        scene.add(targetGroup)
        scene.add(discGroup)
  
        resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width, height } = entry.contentRect
            renderer.setSize(width, height)
            camera.aspect = width / height
            camera.updateProjectionMatrix()
          }
        })
        resizeObserver.observe(container.value)
      }
  
      // === 同步遊戲狀態到 3D 畫面 ===
      const updateScene = () => {
        const sim = props.sim
        if (!sim || !sim.bot) return
  
        // --- 1. 更新玩家視角 ---
        const bot = sim.bot
        const eyeHeight = bot.r // 高度根據機器人半徑 (BOT_R = 15) 設定
        
        camera.position.set(bot.x, eyeHeight, bot.y)
        playerLight.position.set(bot.x, eyeHeight + 5, bot.y)
  
        const dirX = Math.cos(bot.heading)
        const dirZ = Math.sin(bot.heading)
        // 目標點設在遠方
        camera.lookAt(bot.x + dirX * 100, eyeHeight, bot.y + dirZ * 100)
  
        // --- 2. 渲染障礙物 (obstacles) ---
        const obstacles = sim.obstacles || []
        if (obstacles.length !== currentWallCount) {
          wallGroup.clear()
          if (instancedWalls) instancedWalls.dispose()
          
          if (obstacles.length > 0) {
            instancedWalls = new THREE.InstancedMesh(wallGeo, wallMat, obstacles.length)
            const dummy = new THREE.Object3D()
            
            obstacles.forEach((obs: Rect, i: number) => {
              // 牆壁大小依據 Rect，高度固定為 40
              dummy.scale.set(obs.w, 40, obs.h)
              // 將牆壁中心點放置正確 (原點 x,y 加上寬高的半徑)
              dummy.position.set(obs.x + obs.w / 2, 0, obs.y + obs.h / 2)
              dummy.updateMatrix()
              instancedWalls!.setMatrixAt(i, dummy.matrix)
            })
            instancedWalls.instanceMatrix.needsUpdate = true
            wallGroup.add(instancedWalls)
          }
          currentWallCount = obstacles.length
        }
  
        // --- 3. 渲染未被擊中的目標 (targets) ---
        const activeTargets = (sim.targets || []).filter(t => !t.hit)
        while (targetGroup.children.length < activeTargets.length) {
          targetGroup.add(new THREE.Mesh(targetGeo, targetMat))
        }
        targetGroup.children.forEach((mesh: THREE.Object3D, i: number) => {
          if (i < activeTargets.length) {
            mesh.visible = true
            const t: Target = activeTargets[i]
            // 把目標放在方塊正中央浮空
            mesh.position.set(t.x + t.w / 2, eyeHeight, t.y + t.h / 2)
            mesh.rotation.y += 0.03
            mesh.rotation.x += 0.02
          } else {
            mesh.visible = false
          }
        })
  
        // --- 4. 渲染圓盤武器 (discs) ---
        const activeDiscs = (sim.discs || []).filter(d => d.alive)
        while (discGroup.children.length < activeDiscs.length) {
          discGroup.add(new THREE.Mesh(discGeo, discMat))
        }
        discGroup.children.forEach((mesh: THREE.Object3D, i: number) => {
          if (i < activeDiscs.length) {
            mesh.visible = true
            const d: Disc = activeDiscs[i]
            mesh.position.set(d.x, d.r, d.y)
          } else {
            mesh.visible = false
          }
        })
      }
  
      // === 繪製小地圖 (HUD) ===
      const drawHUD = () => {
        const sim = props.sim
        if (!hudCanvas.value || !sim || !sim.bot) return
        
        const ctx = hudCanvas.value.getContext('2d')
        if (!ctx) return
  
        const width = hudCanvas.value.width
        const height = hudCanvas.value.height
        ctx.clearRect(0, 0, width, height)
  
        // 背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
        ctx.fillRect(0, 0, width, height)
        ctx.strokeStyle = '#00ffff'
        ctx.lineWidth = 2
        ctx.strokeRect(0, 0, width, height)
  
        // ARENA_W = 600, 縮放到 width = 150 (比例為 0.25)
        const scale = width / 600
        
        // 繪製掃描雷射 (如果有)
        if (sim.currentScanRays) {
          ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)'
          ctx.lineWidth = 1
          ctx.beginPath()
          for (const ray of sim.currentScanRays) {
            ctx.moveTo(ray.x1 * scale, ray.y1 * scale)
            ctx.lineTo(ray.x2 * scale, ray.y2 * scale)
          }
          ctx.stroke()
        }
  
        // 障礙物
        ctx.fillStyle = 'rgba(0, 150, 255, 0.8)'
        for (const obs of (sim.obstacles || [])) {
            ctx.fillRect(obs.x * scale, obs.y * scale, obs.w * scale, obs.h * scale)
        }
  
        // 目標
        ctx.fillStyle = '#00ff88'
        for (const target of (sim.targets || [])) {
          if (!target.hit) {
            ctx.fillRect(target.x * scale, target.y * scale, target.w * scale, target.h * scale)
          }
        }
  
        // 子彈 (Discs)
        ctx.fillStyle = '#ffaa00'
        for (const disc of (sim.discs || [])) {
          if (disc.alive) {
            ctx.beginPath()
            ctx.arc(disc.x * scale, disc.y * scale, Math.max(1, disc.r * scale), 0, Math.PI * 2)
            ctx.fill()
          }
        }
  
        // 玩家
        const bot = sim.bot
        ctx.fillStyle = '#ffff00'
        ctx.beginPath()
        ctx.arc(bot.x * scale, bot.y * scale, bot.r * scale, 0, Math.PI * 2)
        ctx.fill()
  
        // 玩家朝向指標
        const dx = Math.cos(bot.heading)
        const dy = Math.sin(bot.heading)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(bot.x * scale, bot.y * scale)
        ctx.lineTo((bot.x + dx * bot.r * 1.5) * scale, (bot.y + dy * bot.r * 1.5) * scale)
        ctx.stroke()
      }
  
      // === 主循環 ===
      const animate = () => {
        animationFrameId = requestAnimationFrame(animate)
        if (isReady.value) {
          updateScene()
          renderer.render(scene, camera)
          drawHUD()
        }
      }
  
      onMounted(() => {
        init3D()
        animate()
      })
  
      onBeforeUnmount(() => {
        cancelAnimationFrame(animationFrameId)
        if (resizeObserver && container.value) {
          resizeObserver.unobserve(container.value)
        }
        if (renderer) renderer.dispose()
        wallGeo.dispose()
        wallMat.dispose()
        targetGeo.dispose()
        targetMat.dispose()
        discGeo.dispose()
        discMat.dispose()
      })
  
      return {
        container,
        hudCanvas,
        isReady
      }
    }
  })
  </script>
  
  <style scoped>
  .game-canvas-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    background-color: #000;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 0 20px rgba(0, 255, 255, 0.1);
  }
  
  .webgl-container {
    width: 100%;
    height: 100%;
    display: block;
  }
  
  .hud-canvas {
    position: absolute;
    top: 15px;
    right: 15px;
    pointer-events: none; /* 讓滑鼠點擊可以穿透小地圖 */
    border-radius: 4px;
  }
  
  .loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: #00ff00;
    font-family: monospace;
    font-size: 20px;
    z-index: 10;
    background-color: rgba(0, 0, 0, 0.8);
  }
  
  .spinner {
    width: 40px;
    height: 40px;
    border: 4px solid rgba(0, 255, 0, 0.2);
    border-top-color: #00ff00;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 20px;
  }
  
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  </style>