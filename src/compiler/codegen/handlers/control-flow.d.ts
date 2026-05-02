import * as ts from 'typescript';
import type { CodegenContext } from '../context';
import type { Segment } from '../types';
export declare function generateControlFlow(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined;
