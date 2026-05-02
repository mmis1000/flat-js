import * as ts from 'typescript';
import type { CodegenContext } from '../context';
import type { Segment } from '../types';
export declare function getExpectedArgumentCount(node: ts.SignatureDeclarationBase): number;
export declare function generateFunctionDefinitionWithStackName(node: ts.FunctionLikeDeclarationBase): Segment;
export declare function generateFunctionDefinition(node: ts.ArrowFunction | ts.FunctionExpression, name: string): Segment;
export declare function generateFunctions(node: ts.Node, _flag: number, ctx: CodegenContext): Segment | undefined;
