import * as THREE from 'three';
import { ActiveIntent, Bot, Disc, Rect, ScanRayVisual, Sim, Target } from '../game/sim';
type ViewMode = 'follow3d' | 'map2d';
type WallMeshEntry = {
    mesh: THREE.Mesh;
    baseMaterial: THREE.Material;
    box: THREE.Box3;
};
type CanvasSurface = {
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
};
declare const _default: import("vue").DefineComponent<import("vue").ExtractPropTypes<{
    sim: {
        type: () => Sim | null;
        required: false;
        default: null;
    };
    viewMode: {
        type: () => ViewMode;
        default: string;
    };
    showHitboxes: {
        type: BooleanConstructor;
        default: boolean;
    };
}>, {}, {
    isWon: boolean;
    tickCount: number;
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    renderer: THREE.WebGLRenderer | null;
    playerLight: THREE.PointLight | null;
    resizeObserver: ResizeObserver | null;
    animationFrameId: number;
    lastPixelRatio: number;
    raycaster: THREE.Raycaster;
    floorGrid: THREE.GridHelper | null;
    arenaBoundsLine: THREE.Line | null;
    wallGroup: THREE.Group<THREE.Object3DEventMap>;
    targetGroup: THREE.Group<THREE.Object3DEventMap>;
    discGroup: THREE.Group<THREE.Object3DEventMap>;
    scanRayGroup: THREE.Group<THREE.Object3DEventMap>;
    obstacleHitboxGroup: THREE.Group<THREE.Object3DEventMap>;
    targetHitboxGroup: THREE.Group<THREE.Object3DEventMap>;
    wallMeshes: WallMeshEntry[];
    activeOccluders: Set<THREE.Mesh<THREE.BufferGeometry<THREE.NormalBufferAttributes, THREE.BufferGeometryEventMap>, THREE.Material<THREE.MaterialEventMap> | THREE.Material<THREE.MaterialEventMap>[], THREE.Object3DEventMap>>;
    lastObstacleKey: string;
    lastTargetKey: string;
    obstacleWallMaterial: THREE.MeshStandardMaterial;
    borderWallMaterial: THREE.MeshStandardMaterial;
    wallHologramMaterial: THREE.MeshStandardMaterial;
    targetGeo: THREE.OctahedronGeometry;
    targetMat: THREE.MeshStandardMaterial;
    discGeo: THREE.CylinderGeometry;
    discMat: THREE.MeshStandardMaterial;
    targetHitboxMaterial: THREE.LineBasicMaterial;
    obstacleHitboxMaterial: THREE.LineBasicMaterial;
    botHitboxMaterial: THREE.LineBasicMaterial;
    botGroup: THREE.Group | null;
    botHitbox: THREE.LineSegments | null;
    moveIntentGroup: THREE.Group | null;
    rotateIntentArrow: THREE.ArrowHelper | null;
    moveIntentRingMaterial: THREE.MeshBasicMaterial;
    moveIntentLineMaterial: THREE.LineBasicMaterial;
}, {
    isReady(): boolean;
}, {
    init3D(): void;
    destroy3D(): void;
    resizeSurfaces(): void;
    getCanvasSurface(canvas: HTMLCanvasElement | undefined): CanvasSurface | null;
    updateWorldVisuals(): void;
    rebuildWallMeshes(obstacles: Rect[]): void;
    rebuildObstacleHitboxes(obstacles: Rect[]): void;
    rebuildTargets(targets: Target[]): void;
    updateBot(bot: Bot): void;
    updateTargetVisibility(targets: Target[]): void;
    updateDiscs(discs: Disc[]): void;
    updateHitboxVisibility(targets: Target[]): void;
    updateScanRays(rays: ScanRayVisual[]): void;
    updateIntentMarkers(intent: ActiveIntent | null): void;
    updateCamera(bot: Bot): void;
    updateWallOcclusion(botPos: THREE.Vector3, cameraPos: THREE.Vector3): void;
    clearOccludedWalls(): void;
    drawTacticalMap(canvas: HTMLCanvasElement | undefined, compact: boolean): void;
    animate(): void;
}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<import("vue").ExtractPropTypes<{
    sim: {
        type: () => Sim | null;
        required: false;
        default: null;
    };
    viewMode: {
        type: () => ViewMode;
        default: string;
    };
    showHitboxes: {
        type: BooleanConstructor;
        default: boolean;
    };
}>> & Readonly<{}>, {
    sim: Sim | null;
    viewMode: ViewMode;
    showHitboxes: boolean;
}, {}, {}, {}, string, import("vue").ComponentProvideOptions, true, {}, any>;
export default _default;
