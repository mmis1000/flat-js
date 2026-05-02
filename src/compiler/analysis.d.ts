import * as ts from 'typescript';
import { VariableType } from './shared';
export type VariableDeclaration = {
    type: Exclude<VariableType, VariableType.Function>;
} | {
    type: VariableType.Function;
    node: ts.Node;
};
export type VariableRoot = ts.SourceFile | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration | ts.ConstructorDeclaration | ts.AccessorDeclaration | ts.ArrowFunction;
export type ParentMap = Map<ts.Node, {
    key: string;
    node: ts.Node;
}>;
export type Scopes = Map<ts.Node, Map<string, VariableDeclaration>>;
export type ScopeChild = Map<ts.Node, Set<ts.Node>>;
export type Functions = Set<VariableRoot>;
declare function abort(msg: string): never;
export declare function findAncient(node: ts.Node, parentMap: ParentMap, predicate: (node: ts.Node) => boolean): ts.Node | undefined;
export declare function findAncient<T extends ts.Node = ts.Node>(node: ts.Node, parentMap: ParentMap, predicate: (node: ts.Node) => node is T): T | undefined;
export declare function markParent(node: ts.Node, parentMap: ParentMap): void;
export declare function isScopeRoot(node: ts.Node): node is VariableRoot;
export declare function extractVariable(node: ts.Identifier | ts.ObjectBindingPattern | ts.ArrayBindingPattern | ts.Node): ts.Identifier[];
export declare function isAsyncFunctionDeclaration(node: ts.FunctionDeclaration): boolean;
export declare function isNonAnnexBFunctionDeclaration(node: ts.FunctionDeclaration): boolean;
export declare function isLexicalSwitchFunctionDeclaration(node: ts.FunctionDeclaration, parentMap: ParentMap): boolean;
export declare function hasParameterExpressions(node: ts.FunctionLikeDeclarationBase | VariableRoot): boolean;
export declare function getFunctionBodyScopeNode(node: ts.FunctionLikeDeclarationBase | VariableRoot): ts.Block | null;
export declare function searchFunctionAndScope(node: ts.Node, parentMap: ParentMap, functions: Functions, scopes: Scopes): void;
export declare function resolveScopes(node: ts.Node, parentMap: ParentMap, functions: Functions, scopes: Scopes): void;
export declare function linkScopes(node: ts.Node, parentMap: ParentMap, scopes: Scopes, scopeChild: ScopeChild): void;
export declare function collectEvalTaintedFunctions(node: ts.Node, parentMap: ParentMap, functions: Functions): Set<VariableRoot>;
export { abort };
