import { compile } from '../src';
/** Program buffers compiled for host polyfills (same reference as frame `programSection`). */
export declare const hostPolyfillProgramSet: Set<number[]>;
export type VmHostRedirectsBundle = {
    redirects: WeakMap<Function, Function>;
};
/**
 * Build host `functionRedirects` for the web VM. Polyfills are extracted with the same
 * `getDebugFunction` as `getExecution` so `debugger` in user callbacks uses the host pause.
 */
export declare function createVmHostRedirects(compileFn: typeof compile, getDebugFunction: () => null | ((ptr?: number) => void), globalThisForPolyfill: object): VmHostRedirectsBundle;
/** Compile all host array polyfills once and register their program buffers in `hostPolyfillProgramSet` (for editor / step UI). */
export declare function ensureHostPolyfillsCompiled(compileFn: typeof compile): void;
