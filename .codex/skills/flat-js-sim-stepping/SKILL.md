---
name: flat-js-sim-stepping
description: Use when working on the Flat JS arena sim, debugger stepping, scan or lastMoveDistance barriers, TICKS_PER_SECOND semantics, or future multi-controller bot scheduling. Grounds changes in the current code so world ticks, raw VM steps, and user-visible highlight steps are not conflated.
---

# Flat JS Sim Stepping

Use this skill when editing or explaining:

- `web/index.vue`
- `web/game/sim.ts`
- `web/game/core/types.ts`
- `web/game/core/systems.ts`
- debugger stepping behavior
- scan or `lastMoveDistance()` waiting semantics
- future multi-bot controller scheduling

## Ground Rules

- `TICKS_PER_SECOND` is the world simulation rate and the wall-clock pacing source for the arena loop. It is also the base unit for movement, rotation, projectile speed, cooldowns, and scan timing.
- `TICKS_PER_SECOND` is not a limit on raw VM `execution[Fields.step]()` calls.
- In autoplay, one world tick means one `runner.stepOneTick()` call, followed by VM execution until one of: program done, VM barrier active, visible highlight change, or guard limit.
- If "step" means the user-visible debugger step, defined as a non-internal source highlight change, autoplay is effectively at most one visible step per world tick, and sometimes zero when blocked.
- `move()`, `rotate()`, and `shoot()` usually enqueue work and let the VM continue immediately.
- `scan()` and `lastMoveDistance()` arm VM barriers. While a barrier is active, world ticks may continue but VM progress is blocked.
- Paused `Step` and `Step in` must drain active VM barriers fully before resuming normal debugger stepping.
- Preserve the single-writer rule: only the simulation runner advances world time.

## Files To Read First

- `web/index.vue`
Contains the autoplay loop, paused `stepExecution()`, and the host bindings that connect VM code to sim commands.

- `web/game/sim.ts`
Defines the public sim facade and the runner boundary. This is the authority split between reads/commands and ticking.

- `web/game/core/types.ts`
Defines `TICKS_PER_SECOND` and all per-tick units derived from it.

- `web/game/core/systems.ts`
Defines barrier semantics, scan timing, and world-tick advancement.

- `references/stepping-model.md`
Read this when you need the repo-grounded explanation of world ticks, raw VM steps, visible debugger steps, and the multi-controller migration path.

## Change Guidance

- Do not rewrite the model around "one raw VM step per tick" unless that is an intentional semantic change across the whole app.
- When touching stepping logic, reason separately about:
  - world ticks
  - raw `execution[Fields.step]()` calls
  - user-visible debugger highlight steps
- When adding more bots, prefer one shared runner plus one controller VM per actor/controller. Do not let each controller tick the world independently.
- If you need multi-controller support, move scan and last-move barriers from global world singletons to per-actor state before adding extra VMs.
- Keep renderer and UI code on `sim.view`; do not reintroduce direct mutable world access.

## Validation

- Run `npm.cmd test -- --runInBand`
- Run `npm.cmd run build-web`
- Browser-check paused stepping through `scan()`:
  - `Run and pause`
  - step until `scan(...)`
  - confirm one paused debug action resolves the full barrier instead of requiring repeated clicks
- If changing autoplay semantics, verify that visible highlight pacing still matches the intended model.

## Scope

This skill is grounding for the current Flat JS arena architecture. It should be preferred over generic assumptions when the task touches tick pacing, scan barriers, paused stepping, or future scripted-bot scheduling.
