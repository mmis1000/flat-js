import { SimOptions, StageDefinition, StageObjectDefinition } from './types';
export declare const DEFAULT_OBSTACLES: StageObjectDefinition[];
export declare const DEFAULT_TARGETS: StageObjectDefinition[];
export declare const DEFAULT_STAGE: StageDefinition;
type HardStageTargetSolution = {
    targetIndex: number;
    x: number;
    y: number;
    heading: number;
    pathDistance: number;
    bendCount: number;
};
export type HardStageAnalysis = {
    spawnHasDirectTargetShot: boolean;
    reachableCellCount: number;
    targetSolutions: HardStageTargetSolution[];
    obstacleCount: number;
    score: number;
};
export declare function analyzeHardStageDefinition(stage: StageDefinition): HardStageAnalysis | null;
export declare function resolveStageDefinition(options?: SimOptions): StageDefinition;
export {};
