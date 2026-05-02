import type { ScanHit } from './core/types';
export type { ActiveIntent, Bot, DeepReadonly, Disc, EntityId, HitType, Point, Rect, ScanHit, ScanRayHitType, ScanRayVisual, StageMode, SimOptions, SimView, Snapshot, StageActorDefinition, StageDefinition, StageObjectDefinition, Target, VmBarrierState, SimulationTestHooks, } from './core/types';
export { ARENA_H, ARENA_W, BOT_MOVE_PER_TICK, BOT_R, BOT_ROTATE_DEG_PER_TICK, DISC_R, DISC_SPEED, LAYOUT_BOT_CLEARANCE, LAYOUT_MIN_GAP, LAYOUT_WALL_MARGIN, SCAN_RANGE, SCAN_TICKS_PER_RAY, SHOOT_COOLDOWN_TICKS, TARGET_H, TARGET_W, TICKS_PER_SECOND, } from './core/types';
export { DEFAULT_OBSTACLES, DEFAULT_STAGE, DEFAULT_TARGETS } from './core/stage';
import type { SimOptions, SimView, SimulationTestHooks } from './core/types';
export type Sim = {
    readonly view: SimView;
    beginMove: (signedDist: number) => void;
    beginRotateRadians: (rad: number) => void;
    beginShoot: () => void;
    armScanBarrier: (rays: number) => void;
    deliverScanResult: (cb: (res: ScanHit[][]) => void) => void;
    armLastMoveDistanceBarrier: () => void;
    deliverLastMoveDistanceResult: (cb: (distance: number) => void) => void;
    vmBarrierBlocksExecution: () => boolean;
};
export type SimulationRunner = {
    stepOneTick: () => void;
};
export type SimulationSession = {
    sim: Sim;
    runner: SimulationRunner;
};
export type SimulationTestHarness = SimulationSession & {
    stepUntil: (predicate: (view: SimView) => boolean, maxTicks?: number) => void;
};
export declare function createSimulationSession(options?: SimOptions): SimulationSession;
export declare function createSimulationTestHarness(options?: SimOptions & {
    hooks?: SimulationTestHooks;
}): SimulationTestHarness;
