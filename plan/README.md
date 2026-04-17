# Codewar robot game — design plan

This document captures the agreed design for evolving `web/index.vue` into a canvas-based **code war** style game: user code controls a round, vacuum-like robot (field, obstacles, bot, target).

---

## 1. Goals

- **Canvas** for the arena: place and draw the field, static objects, bot, and target.
- **Round robot** (vacuum-bot aesthetic) with:
  - **Rotate** at a configurable angular speed.
  - **Move forward** at a configurable linear speed.
  - **Scan** a **90°** forward arc with a **caller-chosen ray count**; report visible hits **per sector** from **near to far**, each with an **item type** (wall, obstacle, target, disc, etc.). Fewer rays = less accurate but cheaper; more rays = finer sectors but more work (see §4).
  - **Shoot** a disc toward / at the target.
- **Flat-JS integration**: expose game APIs through the same `compile` / `getExecution` / builtins path used today (`print`, `clear`), alongside the Monaco editor and debugger.

---

## 2. Time model: highlights, world, and blocking calls

Two mechanisms work **together** (not either-or).

### 2.1 Program position and visuals

- **Source highlight** (`debugInfo.sourceMap` at `execution[Fields.ptr]`, same rules as today, including `debugInfo.internals` if the UI skips updates for internal instructions) is the anchor for **which source range is “active”** and for **keeping the editor visually in sync** with execution.

### 2.2 World simulation on highlight change

- **Valid highlight changes** may advance the **world** (simulation step) as well as the perceived code position. This repo has **not** specified that “pure computation” must freeze the world; do **not** assume the world only moves during blocking calls unless you add that as an explicit product rule later.

### 2.3 World-interaction builtins (move, rotate, shoot, …)

- When user code hits a **world interaction** builtin, execution **blocks** until that **world action** completes.
- Such actions cost **more than one world tick** depending on **parameters** (e.g. rotate **90°** takes longer than **45°**; move distance / shoot parameters similarly).
- While blocked, the host runs the world forward by the required number of **world ticks** until the action is done, then returns from the builtin so the VM can continue.
- During a long action, the **highlight can remain** on the same source range while the canvas updates each world tick—**one source span may correspond to several world frames**.

### 2.4 Single-step debugging

- Define explicitly whether **Step** advances **one VM step**, **one highlight-visible step**, **one world tick during a blocking action**, or a combination—so the debugger stays predictable.

---

## 3. Parameterized action cost (examples)

Exact formulas are tunable; the rule is **monotonic in “how big” the action is**.

| Action   | Parameters   | Example cost idea                                        |
|----------|--------------|----------------------------------------------------------|
| Rotate   | angle (deg)  | e.g. `ceil(abs(deg) / k)` world ticks                    |
| Move     | distance/speed | e.g. distance in steps or table by speed tier       |
| Shoot    | power / charge / etc. | e.g. cooldown ticks, or projectile travel in ticks |
| Scan     | `rayCount` (and fixed 90° arc) | e.g. world ticks or internal cost **scale with** `rayCount`: low count = faster to complete, high count = more accurate, slower to process |

---

## 4. Scan semantics

- **90°** forward arc (e.g. −45° … +45° relative to facing).
- **`rayCount` is a scan parameter** chosen by the caller. Rays are spread evenly across that arc, so each sector has angular width **90° / rayCount**.
- **Accuracy vs cost**: fewer rays ⇒ coarser sectors, less CPU and (if modeled) **faster** scan completion; more rays ⇒ finer angular resolution, **slower** to process for the same scene. The builtin API should expose this explicitly (e.g. `scan({ rays: 36 })` vs `scan({ rays: 180 })`).
- A **default** (e.g. 90) can be fixed in the implementation; **min/max** bounds should be documented to avoid pathological values.
- Per sector (or per ray): ordered list of hits **from near to far**, each with **distance** and **type**.

---

## 5. Architecture sketch

- **Simulation module** (plain TS): entities, physics, collisions, raycast, win/loss.
- **Renderer** (canvas): draws state snapshots; optional scan-line overlay for debugging.
- **Vue** (`index.vue` or child components): layout (code, canvas, result, debug); wire builtins to the sim; drive `execution[Fields.step]` in line with existing run/pause/step behavior.

---

## 6. Open decisions (not fixed in conversation)

- Which builtins count as **world interaction** vs instant; whether **scan** blocks and exactly how its cost scales with **`rayCount`** (world ticks vs VM-time only).
- **Scan** `rayCount` **min/max/default** and behavior when out of range.
- **Concurrency**: queue vs reject overlapping move/rotate/shoot while an action is in progress.
- Whether **animation smoothing** between world ticks is allowed when highlight is unchanged (visual-only).

---

## 7. Implementation order (suggested)

1. Canvas + static scene (bounds, obstacles, target, round bot + heading).
2. Game state object + rendering loop (can reuse host refresh from run/sim).
3. Physics, collisions, disc projectile.
4. Raycast scan (90° arc, configurable `rayCount`) and stable JSON result shape for user code; document accuracy vs cost tradeoff.
5. Builtin wiring and **blocking** multi-tick actions with parameterized duration.
6. Tuning, win/loss, UX (speed controls, less delay than 200 ms when “fast run” is desired—without changing logical rules unless specified).

---

## 8. Files to touch (when implementing)

- `web/index.vue` — layout, run loop integration, builtins.
- New modules under e.g. `web/game/` or `src/game/` — simulation + types (project-specific preference).
- Optional: `web/components/game-canvas.vue` or similar.

This plan is descriptive only; it does not change runtime behavior until implemented.
