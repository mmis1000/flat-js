# Flat JS Arena Stepping Model

## Current Model

### 1. World time

- `TICKS_PER_SECOND` in `web/game/core/types.ts` is the arena world-tick rate.
- It also sets the per-tick units for movement, rotation, projectile speed, cooldowns, and scan timing.
- The main UI loop converts it into `TICK_MS = 1000 / TICKS_PER_SECOND` in `web/index.vue`.

### 2. World tick vs VM step vs visible debugger step

Treat these as three different things.

- World tick:
  one `runner.stepOneTick()` call
- Raw VM step:
  one `execution[Fields.step]()` call
- Visible debugger step:
  a non-internal source highlight change

The current autoplay loop is:

1. wait for the next wall-clock wake
2. advance the world with `runner.stepOneTick()`
3. run VM raw steps in a loop until:
   - program done
   - VM barrier active
   - visible highlight change
   - guard limit

Implications:

- A single world tick may include many raw VM steps.
- A single world tick is effectively at most one visible debugger step.
- A blocked tick may produce zero visible debugger steps.

### 3. Barriers

- `scan()` and `lastMoveDistance()` are host reads that depend on world progress.
- They arm barriers in sim state.
- While the barrier is active, the VM must stop and wait for future world ticks.
- Paused stepping should drain the barrier fully before resuming normal stepping.

## Why This Matters

The easiest wrong assumption is:

- "TICKS_PER_SECOND means one script step per tick."

That is false if "script step" means raw VM instruction stepping.
That is approximately true if "step" means user-visible debugger highlight advancement in autoplay.

Be explicit about which definition is being used in design discussions and code changes.

## Multi-Controller Direction

If more scripted bots are added later, preserve these invariants:

- one shared world and one shared simulation runner
- one controller VM per scripted actor/controller
- no controller VM is allowed to advance world time directly
- controller VMs may run until blocked, but the runner remains the single writer for time

Before doing that, move these from world-singleton state to per-actor state:

- VM read barrier
- scan timing state
- scan visuals if they are meant to be per actor

## Recommended Sanity Checks

When touching this area, always verify:

- paused `Step` through `scan()`
- paused `Step in` through `scan()`
- `lastMoveDistance()` behavior after queued moves
- autoplay highlight pacing
- no direct world ticking outside the runner
