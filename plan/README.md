# Codewar robot game — design notes

This document captures the agreed design for a canvas-based **code war** style game: user code controls a round robot (field, obstacles, bot, target).

**Status (repo today, checked 2026-05-04):** A canvas arena, simulation (`web/game/sim.ts`), and builtins wired from `web/index.vue` are implemented for the primary player bot. Current code differs from the first design sketch in one important way: `move`, `rotate`, and `shoot` enqueue world actions and let VM execution continue; `scan()` and `lastMoveDistance()` are the VM read barriers that pause VM progress until queued actions and read timing finish. See the root `README.md` for commands, API surface, and host polyfills.

---

## 1. Goals

- **Canvas** for the arena: place and draw the field, static objects, bot, and target.
- **Round robot** (vacuum-bot aesthetic) with:
  - **Rotate** at a fixed, tunable angular speed.
  - **Move forward** at a fixed, tunable linear speed.
  - **Scan** a **90°** forward arc with a **caller-chosen ray count**; report visible hits **per ray** from **near to far**, each with an **item type** (wall, obstacle, target, disc, etc.). Fewer rays = less accurate but cheaper; more rays = finer sampling but more work (see §4).
  - **Shoot** a disc toward / at the target.
- **Flat-JS integration**: expose game APIs through the same `compile` / `getExecution` / builtins path used today (`print`, `clear`), alongside the Monaco editor and debugger.

---

## 2. Time model: highlights, world, and VM barriers

Two mechanisms work **together** (not either-or).

### 2.1 Program position and visuals

- **Source highlight** (`debugInfo.sourceMap` at `execution[Fields.ptr]`, same rules as today, including `debugInfo.internals` if the UI skips updates for internal instructions) is the anchor for **which source range is “active”** and for **keeping the editor visually in sync** with execution.

### 2.2 Autoplay world ticks and visible highlights

- Autoplay uses `TICKS_PER_SECOND` from `web/game/core/types.ts` as the world simulation rate and wall-clock pacing source.
- Each world tick calls `runner.stepOneTick()`, then the UI runs raw VM steps until one of: program done, VM barrier active, visible highlight change, or guard limit.
- A single world tick may include many raw VM steps, but autoplay is effectively capped at one visible source highlight change per world tick.
- Paused **Step** / **Step in** normally advance VM code to the next visible source change without ticking the world, unless they must drain an active VM barrier.

### 2.3 World-action builtins and VM read barriers

- `move(distance)`, `rotate(deg)`, and `shoot()` enqueue FIFO world actions. The VM keeps running after the builtin returns.
- Queued actions still cost world ticks. Move/rotate duration is derived from distance/angle and per-tick units; shoot respects projectile creation and cooldown timing.
- `scan(rays)` waits for queued actor actions to drain, runs scan timing, then returns the per-ray hit lists.
- `lastMoveDistance()` waits for queued actor actions to drain, then returns the distance covered by the last completed move segment.
- While a read barrier is active, the canvas can continue updating as world ticks advance, but VM execution is blocked until the barrier reaches `ready`.

### 2.4 Single-step debugging

- **Step** and **Step in** drain any active `scan()` / `lastMoveDistance()` barrier before resuming normal debugger stepping.
- After barrier drain, stepping runs raw VM steps until the next visible source range, respecting the existing Step vs Step-in stack behavior.

---

## 3. Parameterized action cost (examples)

Exact formulas are tunable; the rule is **monotonic in “how big” the action is**.

| Action   | Parameters   | Example cost idea                                        |
|----------|--------------|----------------------------------------------------------|
| Rotate   | angle (deg)  | Queued action; world ticks scale with absolute angle and `BOT_ROTATE_RAD_PER_TICK`. |
| Move     | distance     | Queued action; world ticks scale with distance and `BOT_MOVE_PER_TICK`, stopping early on collision. |
| Shoot    | none         | Queued action; creates a projectile when cooldown permits and then waits through cooldown/post-fire timing. |
| Scan     | `rays` (fixed 90° arc) | VM read barrier; timing scales with normalized ray count via `SCAN_TICKS_PER_RAY`. |

---

## 4. Scan semantics

- **90°** forward arc (`-45°` to `+45°` relative to facing).
- `scan(rays)` takes a caller-chosen ray count. Omitted/falsy values default to `36`; non-falsy values are floored and clamped to `1..90`.
- Rays are spread evenly across the arc. With `N > 1`, adjacent ray centers are `90 / (N - 1)` degrees apart; with `N === 1`, the ray points straight ahead.
- **Accuracy vs cost**: fewer rays => coarser angular sampling and shorter scan timing; more rays => finer sampling and longer timing.
- Per ray: ordered list of hits **from near to far**, each with **distance** and **type**.

---

## 5. Architecture sketch

- **Simulation module** (plain TS): entities, physics, collisions, raycast, win/loss.
- **Renderer** (canvas): draws state snapshots; optional scan-line overlay for debugging.
- **Vue** (`index.vue` or child components): layout (code, canvas, result, debug); wire builtins to the sim; drive `execution[Fields.step]` in line with existing run/pause/step behavior.

---

## 6. Open decisions / future work

- **Multi-controller scheduling**: the world model has actor IDs, but the web API currently drives the primary actor only. Future multi-bot control should keep one shared runner and one controller VM per scripted actor.
- **Per-actor barriers**: `vmBarrier` and `scanState` are world-level singletons tagged with an actor ID. Move these to per-actor state before allowing multiple controller VMs to block independently.
- **Tuning surface**: decide whether scan, movement, rotation, projectile, and cooldown constants are game-level config or fixed implementation constants.
- Whether **animation smoothing** between world ticks is allowed when highlight is unchanged (visual-only).

---

## 7. Implementation status

1. Canvas + static scene (bounds, obstacles, target, round bot + heading): implemented.
2. Game state object + rendering loop: implemented via `createSimulationSession` and the Vue loop.
3. Physics, collisions, disc projectile, win/loss: implemented for the current target-shooting game.
4. Raycast scan with stable JSON result shape and ray-count cost tradeoff: implemented.
5. Builtin wiring with queued actions plus VM read barriers: implemented.
6. Remaining tuning / expansion: multi-controller scheduling, per-actor barrier state, and any future UI exposure for simulation constants.

---

## 8. Files (implementation reference)

- `web/index.vue` — layout, run loop, builtins, debugger, host redirects.
- `web/game/sim.ts` — world simulation and tick model.
- `web/components/game-canvas.vue` — canvas rendering.
- `web/vm-host-redirects.ts` — browser-only function redirects for deterministic `Math.random` and callback-array polyfills.

Further expansion can follow §6 as needed.
