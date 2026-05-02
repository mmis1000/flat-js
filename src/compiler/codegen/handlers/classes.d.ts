import * as ts from 'typescript';
import type { CodegenContext } from '../context';
import type { Segment } from '../types';
export declare function generateClassValue(node: ts.ClassDeclaration | ts.ClassExpression, flag: number, ctx: CodegenContext, nameOverride?: string, nameFromStack?: boolean): Segment;
export declare function generateClasses(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined;
