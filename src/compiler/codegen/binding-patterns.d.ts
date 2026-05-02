import * as ts from 'typescript';
import type { CodegenContext } from './context';
import type { Segment } from './types';
type BindingInitOptions = {
    freezeConst?: boolean;
    initializer?: ts.Expression;
};
export declare function generateBindingInitialization(pattern: ts.BindingName, sourceOps: Segment, flag: number, ctx: CodegenContext, options?: BindingInitOptions): Segment;
type AssignmentInitOptions = {
    initializer?: ts.Expression;
    preserveResult?: boolean;
};
export declare function generateAssignmentPattern(pattern: ts.Expression, sourceOps: Segment, flag: number, ctx: CodegenContext, options?: AssignmentInitOptions): Segment;
export {};
