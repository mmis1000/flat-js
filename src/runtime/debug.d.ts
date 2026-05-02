import { type Scope, type ScopeDebugEntry } from "./shared";
export declare const isRuntimeInternalKey: (key: string | symbol) => boolean;
export declare const getScopeDebugPtr: (scope: Scope) => number | undefined;
export declare const getScopeDebugEntries: (scope: Scope, debugNames?: readonly string[]) => ScopeDebugEntry[];
export declare const materializeScopeStaticBindings: (scope: Scope) => void;
