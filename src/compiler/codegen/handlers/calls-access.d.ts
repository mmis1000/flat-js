import * as ts from 'typescript';
import type { CodegenContext } from '../context';
import type { Segment } from '../types';
export declare function generateDirectCall(self: ts.Node, args: Segment, argCount: number, flag: number, ctx: CodegenContext): Segment;
export declare function generateCallsAndAccess(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined;
