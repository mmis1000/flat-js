import { compile, run } from '../src'
import type { DebugInfo } from '../src/compiler'
import { vmMathRandom } from './vm-deterministic-math'

/** ES5-style `Array.prototype.forEach` body; compiled in a separate `compile`/`run` so each iteration is VM bytecode. */
const VM_ARRAY_FOR_EACH_SRC = `function vmArrayForEach(callback: any, thisArg: any) {
  const O = Object(this)
  const len = O.length >>> 0
  let k = 0
  while (k < len) {
    if (k in O) {
      callback.call(thisArg, O[k], k, O)
    }
    k++
  }
}
vmArrayForEach`

export type VmHostRedirectsBundle = {
    redirects: WeakMap<Function, Function>
    forEachProgram: number[]
    forEachDebugInfo: DebugInfo
}

let compiled: { forEachProgram: number[]; forEachText: any[]; forEachDebugInfo: DebugInfo } | null = null

export function getForEachPolyfillCompiled(compileFn: typeof compile) {
    if (!compiled) {
        const [forEachProgram, forEachText, forEachDebugInfo] = compileFn(VM_ARRAY_FOR_EACH_SRC, {
            range: true,
            evalMode: true,
        })
        compiled = { forEachProgram, forEachText, forEachDebugInfo }
    }
    return compiled
}

/**
 * Build host `functionRedirects` for the web VM. The forEach polyfill must be extracted with the same
 * `getDebugFunction` as `getExecution` so `debugger` in user callbacks (and `OpCode.Debugger`) uses the host pause, not native `debugger`.
 */
export function createVmHostRedirects(
    compileFn: typeof compile,
    getDebugFunction: () => null | (() => void),
    globalThisForPolyfill: object
): VmHostRedirectsBundle {
    const { forEachProgram, forEachText, forEachDebugInfo } = getForEachPolyfillCompiled(compileFn)
    const mathOnly = new WeakMap<Function, Function>()
    mathOnly.set(globalThis.Math.random, vmMathRandom)
    const forEachFn = run(
        forEachProgram,
        forEachText,
        0,
        globalThisForPolyfill,
        [{}],
        undefined,
        [],
        compileFn,
        mathOnly,
        getDebugFunction
    )
    const redirects = new WeakMap<Function, Function>()
    redirects.set(globalThis.Math.random, vmMathRandom)
    redirects.set(Array.prototype.forEach, forEachFn)
    return { redirects, forEachProgram, forEachDebugInfo }
}
