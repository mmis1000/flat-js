export type CodeSnippet = {
    id: string
    label: string
    code: string
}

export const CODE_SNIPPETS: CodeSnippet[] = [
    {
        id: 'scan-aim',
        label: 'Scan & aim',
        code: `// Robot controls:
//   rotate(deg)      turn (deg), positive = clockwise
//   move(distance)   enqueue forward motion (FIFO with rotate/shoot); VM keeps running
//   lastMoveDistance()  after prior moves finish: pixels moved for last completed segment (less if blocked)
//   shoot()          enqueue a shot (FIFO)
//   scan(rays)       1..90 rays across a 90-deg forward arc; waits for queued world actions + scan timing
//                    returns array of per-ray hit lists (length === rays)
//                    each hit: { distance, type }
//                    type: 'wall' | 'obstacle' | 'target' | 'disc'
//   won()            true once a disc has hit the green target
// Win by hitting the green target with a disc.
// Note: scan rays only see line-of-sight; the disc can still clip obstacles off-center,
// so after shooting we strafe sideways to break "aim OK but disc always blocked" loops.

clear()

let unstuck = 0

while (!won()) {
  // Fewer rays => shorter scan (fewer world ticks per loop); 9 is enough for ~11 deg steps on the arc.
  const rays = 9
  const sweep = scan(rays)

  // Find a ray whose FIRST hit is the target (nothing in the way).
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
    // Side-step: same LOS as scan can still mean a blocked disc path; strafe for a new firing point.
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

`,
    },
    {
        id: 'rotate-sweep',
        label: 'Rotate sweep',
        code: `// Same API as other snippet (move/rotate/shoot queue in parallel with VM; scan and
// lastMoveDistance wait for the world). Strategy: keep sweeping in 10-deg steps,
// but if we complete a full 360 without seeing the target, force a bigger turn to
// break the "drive in a circle forever" pattern.

clear()

let unstuck = 0
let swept = 0
let breakDir = 1

while (!won()) {
  if (unstuck === 0) {
    rotate(10)
    swept += 10
    if (swept >= 360) {
      rotate(breakDir * 135)
      breakDir *= -1
      swept = 0
    }
  }
  const rays = 11
  const sweep = scan(rays)

  let hitIdx = -1
  for (let i = 0; i < sweep.length; i++) {
    const h = sweep[i]
    if (h.length > 0 && h[0].type === 'target') {
      hitIdx = i
      break
    }
  }

  if (hitIdx >= 0) {
    unstuck = 0
    swept = 0
    const t = hitIdx / (rays - 1)
    const deg = -45 + t * 90
    rotate(deg)
    shoot()
    print('shot ~' + deg.toFixed(0) + 'deg')
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
    const want = 14
    if (unstuck !== 0) {
      move(want)
      if (lastMoveDistance() >= want - 0.5) {
        unstuck = 0
        swept = 0
      } else {
        rotate(unstuck)
        swept = 0
      }
    } else {
      move(want)
      if (lastMoveDistance() < want - 0.5) {
        unstuck = breakDir * 135
        breakDir *= -1
        rotate(unstuck)
        swept = 0
      }
    }
  }
}
print('win!')

`,
    },
    {
        id: 'scan-memory-explorer',
        label: 'Scan memory explorer',
        code: `// Deterministic explorer for harder random stages.
// It uses the full depth list from scan() to remember free lanes, solid faces,
// and target sightings, then makes larger jumps toward frontier space.
// Memory is just normal JS state, and lastMoveDistance() stays the ground truth.

clear()

const CELL = 24
const BOT_RADIUS = 15
const MAX_STEP = 132
const CRUISE_STEP = 96
const MOVE_MARGIN = 8
const MIN_PROGRESS = 14
const RAYS = 9
const TURN = 90
const TARGET_MERGE = 28
const BLOCK_EPS = 0.5
const STALE_TARGET_NEAR = CELL * 4
const LANE_HALF_ANGLE = 28
const HARD_BLOCK = 4
const MAP_MARK_STEP = 18

let x = 0
let y = 0
let heading = 0
let shotCount = 0
let cruiseHeading = 0
let cruiseBudget = 0

const visited = Object.create(null)
const seen = Object.create(null)
const solid = Object.create(null)
const blocked = Object.create(null)
const targetMemory = []

function wrap360(deg) {
  while (deg < 0) deg += 360
  while (deg >= 360) deg -= 360
  return deg
}

function normTurn(deg) {
  while (deg <= -180) deg += 360
  while (deg > 180) deg -= 360
  return deg
}

function toRad(deg) {
  return deg * Math.PI / 180
}

function cosd(deg) {
  return Math.cos(toRad(deg))
}

function sind(deg) {
  return Math.sin(toRad(deg))
}

function roundCell(v) {
  return Math.round(v / CELL)
}

function cellKey(cx, cy) {
  return cx + ',' + cy
}

function pointKey(px, py) {
  return cellKey(roundCell(px), roundCell(py))
}

function headingBucket(deg) {
  return Math.round(wrap360(deg) / 15) % 24
}

function markSeen(px, py) {
  const key = pointKey(px, py)
  seen[key] = (seen[key] || 0) + 1
  return key
}

function markSolid(px, py) {
  const key = pointKey(px, py)
  solid[key] = (solid[key] || 0) + 1
  return key
}

function solidPenaltyAt(px, py) {
  return solid[pointKey(px, py)] || 0
}

function markVisited(px, py) {
  const key = pointKey(px, py)
  visited[key] = (visited[key] || 0) + 1
  markSeen(px, py)
  return key
}

function blockedKey(px, py, deg) {
  return pointKey(px, py) + '|' + headingBucket(deg)
}

function blockedPenalty(px, py, deg) {
  return blocked[blockedKey(px, py, deg)] || 0
}

function rememberBlocked(px, py, deg) {
  const key = blockedKey(px, py, deg)
  blocked[key] = (blocked[key] || 0) + 1
}

function turnBy(deg) {
  const delta = normTurn(deg)
  if (Math.abs(delta) > 0.001) {
    rotate(delta)
  }
  heading = wrap360(heading + delta)
}

function turnTo(targetHeading) {
  turnBy(normTurn(targetHeading - heading))
}

function stepForward(dist) {
  move(dist)
  const moved = lastMoveDistance()
  const startX = x
  const startY = y

  for (let walked = MAP_MARK_STEP; walked < moved; walked += MAP_MARK_STEP) {
    markSeen(startX + cosd(heading) * walked, startY + sind(heading) * walked)
  }

  x = startX + cosd(heading) * moved
  y = startY + sind(heading) * moved
  markVisited(x, y)
  return moved
}

function headingGap(a, b) {
  return Math.abs(normTurn(a - b))
}

function pointAlong(px, py, deg, forward, side) {
  return {
    x: px + cosd(deg) * forward + cosd(deg + 90) * side,
    y: py + sind(deg) * forward + sind(deg + 90) * side,
  }
}

function rememberTargetPoint(tx, ty) {
  let bestIndex = -1
  let bestDistance = TARGET_MERGE
  for (let i = 0; i < targetMemory.length; i++) {
    const mem = targetMemory[i]
    const dist = Math.hypot(mem.x - tx, mem.y - ty)
    if (dist < bestDistance) {
      bestDistance = dist
      bestIndex = i
    }
  }

  if (bestIndex >= 0) {
    const mem = targetMemory[bestIndex]
    mem.x = (mem.x * 2 + tx) / 3
    mem.y = (mem.y * 2 + ty) / 3
    mem.age = 0
    mem.misses = 0
    mem.seen = true
    return
  }

  targetMemory.push({
    x: tx,
    y: ty,
    age: 0,
    misses: 0,
    seen: true,
  })
}

function pruneTargetMemory() {
  let index = 0
  while (index < targetMemory.length) {
    const mem = targetMemory[index]
    if (!mem.seen) {
      mem.age += 1
      if (Math.hypot(mem.x - x, mem.y - y) < STALE_TARGET_NEAR) {
        mem.misses += 1
      }
    }
    if (mem.age > 40 || mem.misses > 4) {
      targetMemory.splice(index, 1)
      continue
    }
    mem.seen = false
    index += 1
  }
}

function worldDistanceForHit(hit) {
  return hit.distance + (hit.type === 'wall' ? 0 : BOT_RADIUS)
}

function moveClearanceFor(moveDistance, moveType) {
  let clearance = moveDistance - MOVE_MARGIN
  if (moveType === 'wall') {
    clearance -= BOT_RADIUS
  }
  return Math.max(0, clearance)
}

function rememberDepthRay(rayHeading, hits) {
  const first = hits.length > 0 ? hits[0] : null
  const firstDistance = first ? first.distance : 200
  const firstType = first ? first.type : 'miss'

  let moveDistance = firstDistance
  let moveType = firstType
  let foundBlocker = false

  for (let hitIndex = 0; hitIndex < hits.length; hitIndex++) {
    const hit = hits[hitIndex]
    const worldDistance = worldDistanceForHit(hit)
    const point = pointAlong(x, y, rayHeading, worldDistance, 0)

    if (hit.type === 'target') {
      rememberTargetPoint(point.x, point.y)
    }

    if (hit.type === 'wall' || hit.type === 'obstacle') {
      markSolid(point.x, point.y)
      if (!foundBlocker) {
        moveDistance = hit.distance
        moveType = hit.type
        foundBlocker = true
      }
    }
  }

  const clearance = moveClearanceFor(moveDistance, moveType)
  for (let dist = MAP_MARK_STEP; dist <= clearance + 1e-9; dist += MAP_MARK_STEP) {
    const point = pointAlong(x, y, rayHeading, dist, 0)
    markSeen(point.x, point.y)
  }

  return {
    heading: rayHeading,
    firstDistance: firstDistance,
    firstType: firstType,
    moveDistance: moveDistance,
    moveType: moveType,
  }
}

function surveyArc() {
  const samples = []
  const sweep = scan(RAYS)
  for (let rayIndex = 0; rayIndex < sweep.length; rayIndex++) {
    const rayHeading = RAYS === 1
      ? heading
      : wrap360(heading - 45 + rayIndex * (90 / (RAYS - 1)))
    samples.push(rememberDepthRay(rayHeading, sweep[rayIndex]))
  }
  return samples
}

function fullSurvey() {
  for (let i = 0; i < targetMemory.length; i++) {
    targetMemory[i].seen = false
  }

  const samples = []
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const arc = surveyArc()
    for (let i = 0; i < arc.length; i++) {
      samples.push(arc[i])
    }
    turnBy(TURN)
  }

  pruneTargetMemory()
  return samples
}

function moveClearance(sample) {
  return moveClearanceFor(sample.moveDistance, sample.moveType)
}

function laneDistanceForHeading(samples, desiredHeading) {
  let best = Infinity
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const gap = headingGap(sample.heading, desiredHeading)
    if (gap > LANE_HALF_ANGLE) {
      continue
    }
    const projected = moveClearance(sample) * Math.max(0, cosd(gap))
    if (projected < best) {
      best = projected
    }
  }
  return best === Infinity ? 0 : best
}

function chooseTargetShot(samples) {
  let best = null
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    if (sample.firstType !== 'target') {
      continue
    }
    if (best == null || sample.firstDistance < best.firstDistance) {
      best = sample
    }
  }
  return best
}

function targetApproachBonus(nx, ny) {
  let best = 0
  for (let i = 0; i < targetMemory.length; i++) {
    const mem = targetMemory[i]
    const before = Math.hypot(mem.x - x, mem.y - y)
    const after = Math.hypot(mem.x - nx, mem.y - ny)
    const gain = before - after
    if (gain > best) {
      best = gain
    }
  }
  return best * 0.8
}

function targetHeadingBonus(moveHeading) {
  let best = 0
  for (let i = 0; i < targetMemory.length; i++) {
    const mem = targetMemory[i]
    const desired = wrap360(Math.atan2(mem.y - y, mem.x - x) * 180 / Math.PI)
    const gap = headingGap(moveHeading, desired)
    const bonus = Math.max(0, 36 - gap) * 2
    if (bonus > best) {
      best = bonus
    }
  }
  return best
}

function frontierBonus(nx, ny, moveHeading) {
  const probes = [
    [CELL, 0, 20],
    [2 * CELL, 0, 26],
    [3 * CELL, 0, 32],
    [CELL, CELL, 16],
    [CELL, -CELL, 16],
    [2 * CELL, CELL, 20],
    [2 * CELL, -CELL, 20],
    [0, 2 * CELL, 10],
    [0, -2 * CELL, 10],
  ]

  let score = 0
  for (let i = 0; i < probes.length; i++) {
    const probe = probes[i]
    const point = pointAlong(nx, ny, moveHeading, probe[0], probe[1])
    const key = pointKey(point.x, point.y)
    if (solid[key]) {
      score -= solid[key] * 14
      continue
    }
    if (!seen[key]) {
      score += probe[2]
    } else {
      score -= Math.min(seen[key], 3) * 3
    }
  }
  return score
}

function pathPenalty(moveHeading, stride) {
  let penalty = 0
  for (let dist = CELL; dist <= stride + 1e-9; dist += CELL) {
    const center = pointAlong(x, y, moveHeading, dist, 0)
    const left = pointAlong(center.x, center.y, moveHeading, 0, BOT_RADIUS)
    const right = pointAlong(center.x, center.y, moveHeading, 0, -BOT_RADIUS)
    penalty += solidPenaltyAt(center.x, center.y) * 60
    penalty += solidPenaltyAt(left.x, left.y) * 32
    penalty += solidPenaltyAt(right.x, right.y) * 32
  }
  return penalty
}

function chooseExploreHeading(samples) {
  const originKey = pointKey(x, y)
  let bestHeading = heading
  let bestStride = 0
  let bestScore = -1e9

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const clearance = Math.max(0, Math.min(MAX_STEP, laneDistanceForHeading(samples, sample.heading)))
    const stride = clearance >= CRUISE_STEP ? clearance : Math.max(0, clearance)
    const nx = x + cosd(sample.heading) * stride
    const ny = y + sind(sample.heading) * stride
    const destKey = pointKey(nx, ny)
    const visits = visited[destKey] || 0

    let score = stride * 0.75
    if (stride < MIN_PROGRESS) {
      score -= 180
    }
    if (stride >= CRUISE_STEP) {
      score += 55
    }
    if (destKey !== originKey && visits === 0) {
      score += 70
    } else {
      score -= visits * 24
    }
    score += frontierBonus(nx, ny, sample.heading)
    score -= pathPenalty(sample.heading, stride)
    score -= blockedPenalty(x, y, sample.heading) * 35
    score += targetApproachBonus(nx, ny)
    score += targetHeadingBonus(sample.heading)

    if (score > bestScore) {
      bestScore = score
      bestHeading = sample.heading
      bestStride = stride
    }
  }

  return {
    heading: bestHeading,
    stride: bestStride,
  }
}

function chooseSideStep(samples) {
  const left = laneDistanceForHeading(samples, wrap360(heading - 90))
  const right = laneDistanceForHeading(samples, wrap360(heading + 90))
  if (left < 6 && right < 6) {
    return 0
  }
  if (left === right) {
    return shotCount % 2 === 0 ? 90 : -90
  }
  return right > left ? 90 : -90
}

function rememberImpact(px, py, moveHeading, moved) {
  const point = pointAlong(px, py, moveHeading, moved + BOT_RADIUS + 4, 0)
  markSolid(point.x, point.y)
}

markVisited(x, y)

while (!won()) {
  const wasCruising = cruiseBudget > 0
  let survey = []
  if (wasCruising) {
    turnTo(cruiseHeading)
    survey = surveyArc()
  } else {
    survey = fullSurvey()
  }
  const targetShot = chooseTargetShot(survey)

  if (targetShot) {
    cruiseBudget = 0
    turnTo(targetShot.heading)
    shoot()
    shotCount += 1

    const sideStep = chooseSideStep(survey)
    const beforeX = x
    const beforeY = y
    if (sideStep !== 0) {
      turnBy(sideStep)
      const moved = stepForward(10)
      if (moved < 9.5) {
        cruiseBudget = 0
        rememberBlocked(beforeX, beforeY, heading)
        rememberImpact(beforeX, beforeY, heading, moved)
      } else {
        cruiseHeading = heading
        cruiseBudget = 1
      }
      turnBy(-sideStep)
      cruiseHeading = heading
    } else {
      const reposition = chooseExploreHeading(survey)
      turnTo(reposition.heading)
      const moved = stepForward(Math.min(28, Math.max(12, reposition.stride)))
      if (moved < 11.5) {
        cruiseBudget = 0
        rememberBlocked(beforeX, beforeY, heading)
        rememberImpact(beforeX, beforeY, heading, moved)
      } else {
        cruiseHeading = heading
        cruiseBudget = 1
      }
    }
    continue
  }

  let nextMove = null
  if (wasCruising) {
    const forwardStride = Math.max(0, Math.min(MAX_STEP, laneDistanceForHeading(survey, heading)))
    if (forwardStride >= CRUISE_STEP * 0.7) {
      nextMove = {
        heading: heading,
        stride: forwardStride,
      }
    } else {
      cruiseBudget = 0
      continue
    }
  } else {
    nextMove = chooseExploreHeading(survey)
  }
  const fromX = x
  const fromY = y

  turnTo(nextMove.heading)
  const attempt = nextMove.stride >= MIN_PROGRESS ? nextMove.stride : Math.max(8, nextMove.stride)
  const moved = stepForward(attempt)
  if (moved < attempt - BLOCK_EPS) {
    rememberBlocked(fromX, fromY, nextMove.heading)
    rememberImpact(fromX, fromY, nextMove.heading, moved)
    if (moved >= MIN_PROGRESS) {
      cruiseHeading = heading
      cruiseBudget = 1
    } else {
      cruiseBudget = 0
    }
    const sideTurn = chooseSideStep(survey)
    if (sideTurn !== 0) {
      turnBy(sideTurn)
    } else {
      turnBy(moved < HARD_BLOCK ? 110 : 55)
    }
  } else {
    cruiseHeading = heading
    cruiseBudget = wasCruising ? cruiseBudget - 1 : 1
  }
}

print('win!')

`,
    },
]
