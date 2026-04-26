import { compile } from '../../src/compiler'
import { Fields, Result, getExecution, run } from '../../src/runtime'
import { BOT_MOVE_PER_TICK, createSimulationSession, Sim, SimulationRunner } from '../game/sim'
import { createVmHostRedirects, ensureHostPolyfillsCompiled } from '../vm-host-redirects'

function makeGlobalThis() {
    const names = [
        'Infinity',
        'NaN',
        'undefined',
        'Math',
        'isFinite',
        'isNaN',
        'parseFloat',
        'parseInt',
        'decodeURI',
        'decodeURIComponent',
        'encodeURI',
        'encodeURIComponent',
        'Array',
        'ArrayBuffer',
        'Boolean',
        'DataView',
        'Date',
        'Error',
        'EvalError',
        'Float32Array',
        'Float64Array',
        'Function',
        'Int8Array',
        'Int16Array',
        'Int32Array',
        'Map',
        'Number',
        'Object',
        'Promise',
        'Proxy',
        'RangeError',
        'ReferenceError',
        'RegExp',
        'Set',
        'SharedArrayBuffer',
        'String',
        'Symbol',
        'SyntaxError',
        'TypeError',
        'Uint8Array',
        'Uint8ClampedArray',
        'Uint16Array',
        'Uint32Array',
        'URIError',
        'WeakMap',
        'WeakSet',
        'Atomics',
        'JSON',
        'Reflect',
        'escape',
        'unescape',
        'Intl',
        'eval'
    ]

    const obj: any = {}

    for (const name of names) {
        if (Reflect.has(globalThis, name)) {
            obj[name] = (globalThis as any)[name]
        }
    }

    Reflect.defineProperty(obj, 'globalThis', {
        enumerable: true,
        configurable: false,
        value: obj
    })

    return obj
}

const STARTER_PROGRAM = `
    clear()

    let unstuck = 0

    while (!won()) {
      const rays = 9
      const sweep = scan(rays)

      let bestIdx = -1, bestDist = Infinity
      for (let i = 0; i < sweep.length; i++) {
        const hits = sweep[i]
        if (hits.length > 0 && hits[0].type === 'target' && hits[0].distance < bestDist) {
          bestDist = hits[0].distance
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        unstuck = 0
        const t = bestIdx / (rays - 1)
        const deg = -45 + t * 90
        rotate(deg)
        shoot()
        if (Math.random() > 0.5) {
          move(5)
          rotate(90)
          move(8)
          rotate(-90)
        } else {
          move(5)
          rotate(-90)
          move(8)
          rotate(90)
        }
      } else {
        const want = 24
        if (unstuck !== 0) {
          move(want)
          if (lastMoveDistance() >= want - 0.5) {
            unstuck = 0
          } else {
            rotate(unstuck)
          }
        } else {
          move(want)
          if (lastMoveDistance() < want - 0.5) {
            unstuck = -90 + Math.random() * 180
            rotate(unstuck)
          }
        }
      }
    }
    print('win!')
`

const REPRO_SNIPPET = `
    clear()

    let unstuck = 0

    print('win!')
    while (!won()) {
      print('win2!')
      const rays = 9
      const sweep = scan(rays)

      let bestIdx = -1, bestDist = Infinity
      for (let i = 0; i < sweep.length; i++) {
        const hits = sweep[i]
        if (hits.length > 0 && hits[0].type === 'target' && hits[0].distance < bestDist) {
          bestDist = hits[0].distance
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        print('win1!')
        unstuck = 0
        const t = bestIdx / (rays - 1)
        const deg = -45 + t * 90
        rotate(deg)
        shoot()
        if (Math.random() > 0.5) {
          move(5)
          rotate(90)
          move(8)
          rotate(-90)
        } else {
          move(5)
          rotate(-90)
          move(8)
          rotate(90)
        }
      } else {
        print('win2!')
        const want = 24
        if (unstuck !== 0) {
          move(want)
          if (lastMoveDistance() >= want - 0.5) {
            unstuck = 0
          } else {
            rotate(unstuck)
          }
        } else {
          move(want)
          if (lastMoveDistance() < want - 0.5) {
            unstuck = -90 + Math.random() * 180
            rotate(unstuck)
          }
        }
      }
      print(1)
      print('win3!')
    }
    print('win4!')
`

ensureHostPolyfillsCompiled(compile)

function setupGameExecution(src: string, shuffleSeed?: number) {
    const fakeGlobalThis = makeGlobalThis()
    const { sim, runner } = createSimulationSession({ stageMode: 'default' })
    const hostCalls = {
        waitForScan: 0,
        getScanResult: 0,
        waitForLastMoveDrain: 0,
        getLastMoveDistanceResult: 0,
    }
    let output = ''
    const clear = () => { output = '' }
    const print = (val: any) => {
        output += JSON.stringify(val, undefined, 2) + '\n'
    }
    const rotate = (deg: number) => {
        const n = Number(deg) || 0
        if (n !== 0) {
            sim.beginRotateRadians((n * Math.PI) / 180)
        }
    }
    const move = (dist: number) => {
        const n = Number(dist) || 0
        if (n !== 0) {
            sim.beginMove(n)
        }
        return 0
    }
    const shoot = () => {
        sim.beginShoot()
    }
    const waitForScan = (rays: number) => {
        hostCalls.waitForScan++
        sim.armScanBarrier(Number(rays) || 36)
    }
    const getScanResult = (cb: (res: { distance: number, type: string }[][]) => void) => {
        hostCalls.getScanResult++
        sim.deliverScanResult(cb)
    }
    const waitForLastMoveDrain = () => {
        hostCalls.waitForLastMoveDrain++
        sim.armLastMoveDistanceBarrier()
    }
    const getLastMoveDistanceResult = (cb: (d: number) => void) => {
        hostCalls.getLastMoveDistanceResult++
        sim.deliverLastMoveDistanceResult(cb)
    }
    const won = () => sim.view.won

    const [programData] = compile(src, { range: true, shuffleSeed })
    const hostRedirects = createVmHostRedirects(compile, () => null, fakeGlobalThis)

    const [scanPolyProgram] = compile(`function vmScanPoly(rays) {
  waitForScan(rays)
  let result
  getScanResult((res) => { result = res })
  return result
}
vmScanPoly`, { evalMode: true, shuffleSeed })
    const scan = run(
        scanPolyProgram,
        0,
        fakeGlobalThis,
        [{ waitForScan, getScanResult, __proto__: null }],
        undefined,
        [],
        compile,
        hostRedirects.redirects,
        () => null
    )

    const [lastMovePolyProgram] = compile(`function vmLastMovePoly() {
  waitForLastMoveDrain()
  let result
  getLastMoveDistanceResult((res) => { result = res })
  return result
}
vmLastMovePoly`, { evalMode: true, shuffleSeed })
    const lastMoveDistance = run(
        lastMovePolyProgram,
        0,
        fakeGlobalThis,
        [{ waitForLastMoveDrain, getLastMoveDistanceResult, __proto__: null }],
        undefined,
        [],
        compile,
        hostRedirects.redirects,
        () => null
    )

    const execution = getExecution(
        programData,
        0,
        fakeGlobalThis,
        [{ print, clear, rotate, move, lastMoveDistance, shoot, scan, won, __proto__: null }],
        undefined,
        [],
        () => null,
        compile,
        hostRedirects.redirects
    )

    return { execution, sim, runner, output: () => output, hostCalls }
}

function advanceGame(
    execution: ReturnType<typeof getExecution>,
    sim: Sim,
    runner: SimulationRunner,
    maxTicks: number,
    maxGuardSteps: number
) {
    let result: Result = { [Fields.done]: false } as Result

    for (let tick = 0; tick < maxTicks; tick++) {
        runner.stepOneTick()

        let guardSteps = 0
        while (!result[Fields.done] && !sim.vmBarrierBlocksExecution()) {
            result = execution[Fields.step](true)
            guardSteps++
            if (guardSteps > maxGuardSteps) {
                throw new Error('VM failed to pace against the world')
            }
        }
    }

    return result
}

test('web game pacing: lastMoveDistance blocks on world ticks', () => {
    const { execution, sim, runner, output } = setupGameExecution(`
        clear()
        move(24)
        print(lastMoveDistance())
    `)

    const result = advanceGame(execution, sim, runner, 20, 20_000)

    expect(result[Fields.done]).toBe(false)
    expect(output()).toBe('')
    expect(sim.view.tick).toBe(20)
})

test('debug: web lastMoveDistance helper returns to caller', () => {
    const { execution, sim, runner, output, hostCalls } = setupGameExecution(`
        clear()
        print('before')
        move(24)
        print(lastMoveDistance())
        print('after')
    `)

    const ticksToDrainMove = Math.ceil(24 / BOT_MOVE_PER_TICK)
    advanceGame(execution, sim, runner, ticksToDrainMove + 100, 50_000)

    expect(output()).toContain('"before"')
    expect(output()).toContain('"after"')
    expect(hostCalls.waitForLastMoveDrain).toBeGreaterThan(0)
    expect(hostCalls.getLastMoveDistanceResult).toBeGreaterThan(0)
})

test('queued movement can outlive VM completion', () => {
    const { execution, sim, runner } = setupGameExecution(`
        move(24)
    `)

    runner.stepOneTick()

    let result: Result = { [Fields.done]: false } as Result
    let guardSteps = 0
    while (!result[Fields.done]) {
        result = execution[Fields.step](true)
        guardSteps++
        if (guardSteps > 20_000) {
            throw new Error('VM did not finish the queued-move probe')
        }
    }

    expect(result[Fields.done]).toBe(true)
    expect(sim.view.activeIntent).not.toBeNull()
})

test('web starter program pacing is stable across seeds', () => {
    for (let seed = 0; seed < 256; seed++) {
        const { execution, sim, runner } = setupGameExecution(STARTER_PROGRAM, seed)
        const result = advanceGame(execution, sim, runner, 10, 50_000)
        expect(result[Fields.done]).toBe(false)
        expect(sim.view.won).toBe(false)
    }
})

test('web snippet with scan resumes after first barrier', () => {
    const { execution, sim, runner, output, hostCalls } = setupGameExecution(REPRO_SNIPPET)
    advanceGame(execution, sim, runner, 1_500, 50_000)

    expect(output()).toContain('"win!"')
    expect(output()).toContain('"win2!"')
    expect(output()).toContain('"win3!"')
    expect(hostCalls.waitForScan).toBeGreaterThan(0)
    expect(hostCalls.getScanResult).toBeGreaterThan(0)
})

test('web scan helper returns to caller', () => {
    const { execution, sim, runner, output, hostCalls } = setupGameExecution(`
        clear()
        print('before')
        const sweep = scan(9)
        print(sweep.length)
        print('after')
    `)

    advanceGame(execution, sim, runner, 400, 50_000)

    expect(output()).toContain('"before"')
    expect(output()).toContain('9')
    expect(output()).toContain('"after"')
    expect(hostCalls.waitForScan).toBe(1)
    expect(hostCalls.getScanResult).toBeGreaterThan(0)
})
