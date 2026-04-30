import { compile, run } from '../src'
import { vmMathRandom } from './vm-deterministic-math'

/** Program buffers compiled for host polyfills (same reference as frame `programSection`). */
export const hostPolyfillProgramSet = new Set<number[]>()

type PolyfillSpec = { src: string; proto: () => any }

const POLYFILLS: PolyfillSpec[] = [
    {
        src: `function vmArrayForEach(callback: any, thisArg: any) {
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
vmArrayForEach`,
        proto: () => Array.prototype.forEach,
    },
    {
        src: `function vmArrayMap(callback: any, thisArg: any) {
  const O = Object(this)
  const len = O.length >>> 0
  const A = new Array(len)
  let k = 0
  while (k < len) {
    if (k in O) {
      A[k] = callback.call(thisArg, O[k], k, O)
    }
    k++
  }
  return A
}
vmArrayMap`,
        proto: () => Array.prototype.map,
    },
    {
        src: `function vmArrayFilter(callback: any, thisArg: any) {
  const O = Object(this)
  const len = O.length >>> 0
  const res: any[] = []
  let k = 0
  while (k < len) {
    if (k in O) {
      const val = O[k]
      if (callback.call(thisArg, val, k, O)) {
        res.push(val)
      }
    }
    k++
  }
  return res
}
vmArrayFilter`,
        proto: () => Array.prototype.filter,
    },
    {
        src: `function vmArrayFind(callback: any, thisArg: any) {
  const O = Object(this)
  const len = O.length >>> 0
  let k = 0
  while (k < len) {
    if (k in O) {
      const val = O[k]
      if (callback.call(thisArg, val, k, O)) {
        return val
      }
    }
    k++
  }
  return undefined
}
vmArrayFind`,
        proto: () => Array.prototype.find,
    },
    {
        src: `function vmArrayFindIndex(callback: any, thisArg: any) {
  const O = Object(this)
  const len = O.length >>> 0
  let k = 0
  while (k < len) {
    if (k in O) {
      if (callback.call(thisArg, O[k], k, O)) {
        return k
      }
    }
    k++
  }
  return -1
}
vmArrayFindIndex`,
        proto: () => Array.prototype.findIndex,
    },
    {
        src: `function vmArraySome(callback: any, thisArg: any) {
  const O = Object(this)
  const len = O.length >>> 0
  let k = 0
  while (k < len) {
    if (k in O) {
      if (callback.call(thisArg, O[k], k, O)) {
        return true
      }
    }
    k++
  }
  return false
}
vmArraySome`,
        proto: () => Array.prototype.some,
    },
    {
        src: `function vmArrayEvery(callback: any, thisArg: any) {
  const O = Object(this)
  const len = O.length >>> 0
  let k = 0
  while (k < len) {
    if (k in O) {
      if (!callback.call(thisArg, O[k], k, O)) {
        return false
      }
    }
    k++
  }
  return true
}
vmArrayEvery`,
        proto: () => Array.prototype.every,
    },
    {
        src: `function vmArrayReduce(callback: any) {
  const O = Object(this)
  const len = O.length >>> 0
  let k = 0
  let value: any
  const initProvided = arguments.length > 1
  if (initProvided) {
    value = arguments[1]
  } else {
    while (k < len && !(k in O)) {
      k++
    }
    if (k >= len) {
      throw new TypeError('Reduce of empty array with no initial value')
    }
    value = O[k]
    k++
  }
  while (k < len) {
    if (k in O) {
      value = callback(value, O[k], k, O)
    }
    k++
  }
  return value
}
vmArrayReduce`,
        proto: () => Array.prototype.reduce,
    },
    {
        src: `function vmArrayReduceRight(callback: any) {
  const O = Object(this)
  const len = O.length >>> 0
  let k = len - 1
  let value: any
  const initProvided = arguments.length > 1
  if (initProvided) {
    value = arguments[1]
  } else {
    while (k >= 0 && !(k in O)) {
      k--
    }
    if (k < 0) {
      throw new TypeError('Reduce of empty array with no initial value')
    }
    value = O[k]
    k--
  }
  while (k >= 0) {
    if (k in O) {
      value = callback(value, O[k], k, O)
    }
    k--
  }
  return value
}
vmArrayReduceRight`,
        proto: () => Array.prototype.reduceRight,
    },
    {
        src: `function vmArrayFlatMap(callback: any, thisArg: any) {
  const O = Object(this)
  const len = O.length >>> 0
  const A: any[] = []
  let k = 0
  while (k < len) {
    if (k in O) {
      const el = O[k]
      const mapped = callback.call(thisArg, el, k, O)
      if (Array.isArray(mapped)) {
        for (let j = 0; j < mapped.length; j++) {
          A.push(mapped[j])
        }
      } else {
        A.push(mapped)
      }
    }
    k++
  }
  return A
}
vmArrayFlatMap`,
        proto: () => Array.prototype.flatMap,
    },
]

type CompiledPolyfill = { program: number[]; protoFn: Function }

let compiledPolyfills: CompiledPolyfill[] | null = null

function compileHostPolyfills(compileFn: typeof compile): CompiledPolyfill[] {
    if (compiledPolyfills) {
        return compiledPolyfills
    }
    const out: CompiledPolyfill[] = []
    for (const { src, proto } of POLYFILLS) {
        const [program] = compileFn(src, {
            range: true,
            evalMode: true,
        })
        hostPolyfillProgramSet.add(program)
        out.push({ program, protoFn: proto() })
    }
    compiledPolyfills = out
    return out
}

export type VmHostRedirectsBundle = {
    redirects: WeakMap<Function, Function>
}

/**
 * Build host `functionRedirects` for the web VM. Polyfills are extracted with the same
 * `getDebugFunction` as `getExecution` so `debugger` in user callbacks uses the host pause.
 */
export function createVmHostRedirects(
    compileFn: typeof compile,
    getDebugFunction: () => null | ((ptr?: number) => void),
    globalThisForPolyfill: object
): VmHostRedirectsBundle {
    const list = compileHostPolyfills(compileFn)
    const mathOnly = new WeakMap<Function, Function>()
    mathOnly.set(globalThis.Math.random, vmMathRandom)
    const redirects = new WeakMap<Function, Function>()
    redirects.set(globalThis.Math.random, vmMathRandom)
    for (const { program, protoFn } of list) {
        if (typeof protoFn !== 'function') {
            continue
        }
        const fn = run(
            program,
            0,
            globalThisForPolyfill,
            [{}],
            undefined,
            [],
            compileFn,
            mathOnly,
            getDebugFunction
        )
        redirects.set(protoFn, fn)
    }
    return { redirects }
}

/** Compile all host array polyfills once and register their program buffers in `hostPolyfillProgramSet` (for editor / step UI). */
export function ensureHostPolyfillsCompiled(compileFn: typeof compile) {
    compileHostPolyfills(compileFn)
}
