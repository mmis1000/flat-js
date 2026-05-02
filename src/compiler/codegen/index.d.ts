import { type Functions, type ParentMap, type Scopes, type VariableRoot } from '../analysis';
import type { Segment, SegmentOptions } from './types';
export type { Op, Segment, SegmentOptions, StaticAccess } from './types';
export type { CodegenContext } from './context';
export declare function generateSegment(node: VariableRoot, scopes: Scopes, parentMap: ParentMap, functions: Functions, evalTaintedFunctions: Set<VariableRoot>, { withPos, withEval, withStrict, preserveRuntimeBindingNames }?: SegmentOptions): Segment;
