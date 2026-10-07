// Live operations simulation — SPEC §7.
//
//   createSimulation(world) → { update(dt, elapsed), setSpeed(mult), debug }
//
// Owns every live mutation of the db once the app runs:
//  • the sim clock (1 sim-minute ≈ 5 real seconds) → store.simMinutes on whole-minute changes
//  • truck visits: en_route (public road, layout.arrivalRoute) → at_gate (pause / queue just before
//    the gate) → docking (yard approach to the pull-forward point, then a straight reverse into
//    the bay) → loading | unloading → departing (dockExit + departureRoute) → respawn far away as a
//    new visit (fresh progress, next free dock, shipment times shifted to the new clock)
//  • forklifts shuttle pallets between the truck rear and staging slots / the dock door, drain and
//    charge their batteries, park at their charger when idle; chargers mirror them
//  • docks, shipments and site counters follow the trucks
//  • bus 'data:update' ≈ 4 Hz (real time)
//
// Motion model: vehicles follow polylines with a two-point "axle" model — position on the path at
// arc length s, heading from the chord between s − a and s + a — so corners turn smoothly and the
// body stays on the route. Speed follows a curvature / zone profile with braking, a gap check
// against trucks ahead on the path, and a per-site yard token (one truck manoeuvres in a yard at a
// time; others wait just before the gate, which reads as "At gate"). Forklifts plan on a per-site
// occupancy grid (A* → string pulling → filleted corners) and pivot in place like the toy forklifts
// of the video.
//
// Robustness: update() never throws (errors are caught per entity and logged a few times), missing
// layout entries are skipped, randomness is a seeded LCG (reproducible behaviour).
//
// CONTRACT-GAP: the forklift work poses are derived locally from layout.dockAnchors/dockNormals/
// dockWork: the forklift pivots at dockWork, faces the truck rear to pick/drop (truckStand) and
// faces the door to put a pallet away / fetch one (doorStand). layout.dockWork's own heading (facing
// the door) is only used as the pivot point. Fork reach and the pallet-on-forks offset mirror
// world.js (FORK_PALLET_Z) because world.js does not export them.
import * as THREE from 'three'
import { db } from '../data/db.js'
import { store, bus } from './store.js'
import { fmtTime } from '../data/format.js'
import {
  SITE_IDS, VEHICLE_SCALE, FORKLIFT_SCALE, PALLET_SCALE, CHARGER_SCALE,
  siteLayout, headingOf, wrapAngle,
} from '../data/layout.js'

// ───────────────────────────── tuning ─────────────────────────────
const SEC_PER_MIN = 5          // real seconds per sim minute (09:40 → 09:54 in ≈ 72 s)
const MAX_DT = 0.1             // frame dt clamp (tab switches)
const MAX_STEP = 0.1           // sub-step when the speed multiplier is high
const EMIT_EVERY = 0.25        // s (real) between 'data:update' events

// trucks — metres, m/s
const ROAD_SPEED = 9.5
const YARD_SPEED = 4
const REVERSE_SPEED = 2
const TRUCK_ACC = 1.6
const TRUCK_DEC = 2.4
const TRUCK_LAT = 1.8          // lateral acceleration → corner speed
const TRUCK_CHORD = 3.2        // half axle base of the two-point heading model
const GATE_BACK = 14.5         // a waiting truck's centre stops this far before the gate
const PASS_LOOKAHEAD = 70      // ask for the yard this far before the wait point
const YARD_ZONE = 18           // yard speed from this far before the gate
const GATE_PAUSE_P = 0.45      // chance of a 4–8 s stop at the gate
const PULL_PAUSE = 0.9         // stop at the pull-forward point before reversing
const DOORS_PAUSE = 1.6        // rear doors close before pulling out
const STUCK_GHOST = 6          // s held up by another truck → ignore it for a moment (deadlock breaker)
const SPAWN_GAP = 30           // m of free road needed at the spawn point
const ETA_PER_PALLET = 2.6     // sim minutes per pallet (ETA at the dock)
const MIN_CYCLE = 2            // sim minutes: no faster than this per pallet
const FALLBACK_CYCLE = 3       // sim minutes per pallet when no forklift is free (dock crew)

// forklifts
const FL_SPEED = 2.6
const FL_SPEED_LOADED = 2.2
const FL_SPEED_FINAL = 1.0     // last metre into a pick / drop pose
const FL_REVERSE = 1.1
const FL_ACC = 1.6
const FL_LAT = 1.3
const FL_CHORD = 0.9
const FL_PIVOT = 2.1           // rad/s turning on the spot
const FL_YAW = 3.2             // rad/s max while driving
const FORK_LOW = 0.04
const FORK_CARRY = 0.45
const FORK_TRUCK = 1.25        // truck bed height seen from a ground-level yard
const FORK_TRUCK_PLATFORM = 0.12
const FORK_RATE = 0.9          // m/s
const LOW_BATTERY = 25
const TOP_UP_BELOW = 90        // back at its charger after work, a forklift plugs in below this
const STEAL_CHARGING_ABOVE = 60
const DRAIN_WORK = 0.3         // % per sim minute
const DRAIN_IDLE = 0.02
const KWH_PER_PCT = 0.24       // 48 V · 500 Ah pack

// occupancy grid (forklift planning)
const CELL = 0.5
const INFLATE = 1.1
const INFLATE_PLATFORM = 0.45

// model dimensions (scaled the way world.js scales the instances)
const TRUCK_HALF_L = 5.25 * VEHICLE_SCALE
const TRUCK_HALF_W = 1.25 * VEHICLE_SCALE
const FL_HALF_L = 1.75 * FORKLIFT_SCALE
const FL_HALF_W = 0.575 * FORKLIFT_SCALE
const PAL_HALF_W = 0.6 * PALLET_SCALE      // 1.2 (X) × 1.0 (Z) pallet
const PAL_HALF_D = 0.5 * PALLET_SCALE
const CAB = { hl: 0.25 * CHARGER_SCALE, hw: 0.35 * CHARGER_SCALE }
// pallet on the forks: forkAnchor (≈ 1.26 m, model units) + world.js' FORK_PALLET_Z, × forklift scale
const FORK_PALLET_Z = 0.5 * (PALLET_SCALE / FORKLIFT_SCALE - 1)
const DEFAULT_FORK_REACH = (1.26 + FORK_PALLET_Z) * FORKLIFT_SCALE

const KIND_OF_SKU = (sku) => db.sku(sku)?.kind ?? 'cardboard'

// ───────────────────────────── small helpers ─────────────────────────────
const P = (x, z) => ({ x, z })
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
const fwd = (h) => P(Math.sin(h), Math.cos(h))
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const round1 = (v) => Math.round(v * 10) / 10
const angDiff = (a, b) => wrapAngle(a - b)
const finite = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z)

/** Seeded LCG (Numerical Recipes constants) → [0, 1). */
function lcg(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function polyLen(pts) {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += dist(pts[i], pts[i - 1])
  return l
}

// ───────────────────────────── paths ─────────────────────────────
/** Polyline with cumulative lengths; `splits` inserts vertices at those arc lengths. */
function makePath(points, splits = []) {
  let pts = []
  for (const p of points) {
    if (!finite(p)) continue
    if (!pts.length || dist(p, pts[pts.length - 1]) > 0.05) pts.push(P(p.x, p.z))
  }
  if (!pts.length) pts.push(P(0, 0))
  if (splits.length && pts.length > 1) {
    const marks = splits.filter((s) => Number.isFinite(s)).sort((a, b) => a - b)
    const out = [pts[0]]
    let acc = 0
    let m = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      const l = dist(a, b)
      while (m < marks.length && marks[m] <= acc) m++
      while (m < marks.length && marks[m] < acc + l) {
        const k = (marks[m] - acc) / l
        if (k > 0.02 && k < 0.98) out.push(P(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k))
        m++
      }
      out.push(b)
      acc += l
    }
    pts = out
  }
  const cum = new Float64Array(pts.length)
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + dist(pts[i], pts[i - 1])
  return { pts, cum, len: cum[pts.length - 1], vlim: null, cap: null }
}

/** Index i with cum[i] ≤ s < cum[i + 1] (clamped to the last segment). */
function segIndex(path, s) {
  const { cum } = path
  const last = cum.length - 1
  if (last < 1 || s <= 0) return 0
  if (s >= cum[last]) return last - 1
  let lo = 0, hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= s) lo = mid
    else hi = mid
  }
  return lo
}

function pointAt(path, s, out = P(0, 0)) {
  const { pts, cum } = path
  if (pts.length === 1) {
    out.x = pts[0].x
    out.z = pts[0].z
    return out
  }
  const i = segIndex(path, s)
  const a = pts[i], b = pts[i + 1]
  const l = cum[i + 1] - cum[i] || 1
  const k = clamp((s - cum[i]) / l, 0, 1)
  out.x = a.x + (b.x - a.x) * k
  out.z = a.z + (b.z - a.z) * k
  return out
}

const _c0 = P(0, 0), _c1 = P(0, 0)
/** Heading of the chord between s − a and s + a (front and rear axle on the path). */
function chordHeading(path, s, a, fallback = 0) {
  pointAt(path, Math.max(0, s - a), _c0)
  pointAt(path, Math.min(path.len, s + a), _c1)
  const dx = _c1.x - _c0.x, dz = _c1.z - _c0.z
  return dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) : fallback
}

/**
 * Speed limits per vertex (curvature + zone caps + braking toward the end).
 * capAt(s) → zone speed cap; the segment cap is evaluated at each segment's midpoint.
 */
function shapeProfile(path, capAt, aLat, dec, endSpeed = 0) {
  const { pts, cum } = path
  const n = pts.length
  const cap = new Float32Array(Math.max(1, n - 1))
  for (let i = 0; i < n - 1; i++) cap[i] = capAt((cum[i] + cum[i + 1]) / 2)
  const v = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let lim = Math.min(i > 0 ? cap[i - 1] : cap[0], i < n - 1 ? cap[i] : cap[n - 2] ?? cap[0])
    if (i > 0 && i < n - 1) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1]
      const turn = Math.abs(wrapAngle(Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z)))
      const span = Math.max(0.3, Math.min(dist(a, b), dist(b, c)))
      if (turn > 1e-3) lim = Math.min(lim, Math.sqrt((aLat * span) / turn))
    }
    v[i] = lim
  }
  v[n - 1] = Math.min(v[n - 1], endSpeed)
  for (let i = n - 2; i >= 0; i--) {
    const d = cum[i + 1] - cum[i]
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * dec * d))
  }
  path.vlim = v
  path.cap = cap
  return path
}

/** Allowed speed at arc length s (zone cap of the segment + braking toward the next vertex). */
function profileAt(path, s, dec) {
  if (!path.vlim || path.pts.length < 2) return 0
  const i = segIndex(path, s)
  const j = i + 1
  const rem = Math.max(0, path.cum[j] - s)
  return Math.min(path.cap[i], Math.sqrt(path.vlim[j] * path.vlim[j] + 2 * dec * rem))
}

/** Round the corners of a polyline with arcs (radius clamped to half the shorter leg). */
function fillet(points, radius, step = 0.6) {
  if (points.length < 3) return points
  const out = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1]
    const lu = dist(a, b), lv = dist(b, c)
    if (lu < 1e-6 || lv < 1e-6) continue
    const u = P((b.x - a.x) / lu, (b.z - a.z) / lu), w = P((c.x - b.x) / lv, (c.z - b.z) / lv)
    const cr = u.x * w.z - u.z * w.x
    const turn = Math.atan2(Math.abs(cr), u.x * w.x + u.z * w.z)
    if (turn < 0.03) {
      out.push(b)
      continue
    }
    const half = Math.tan(turn / 2)
    const r = Math.min(radius, (Math.min(lu, lv) * 0.5) / half)
    const t = r * half
    const p1 = P(b.x - u.x * t, b.z - u.z * t)
    const sg = Math.sign(cr)
    const centre = P(p1.x - u.z * sg * r, p1.z + u.x * sg * r)
    const rel = P(p1.x - centre.x, p1.z - centre.z)
    const n = Math.max(2, Math.ceil((turn * r) / step))
    for (let k = 0; k <= n; k++) {
      const ang = sg * turn * (k / n)
      const ca = Math.cos(ang), sa = Math.sin(ang)
      out.push(P(centre.x + rel.x * ca - rel.z * sa, centre.z + rel.x * sa + rel.z * ca))
    }
  }
  out.push(points[points.length - 1])
  return out
}

// ───────────────────────────── oriented boxes ─────────────────────────────
/** Separating-axis test for two oriented boxes {x, z, h, hl, hw}. */
function boxOverlap(a, b, margin = 0) {
  for (const o of [a, b]) {
    const s = Math.sin(o.h), c = Math.cos(o.h)
    for (let k = 0; k < 2; k++) {
      const ax = k ? c : s, az = k ? -s : c
      const ra = a.hl * Math.abs(Math.sin(a.h) * ax + Math.cos(a.h) * az) + a.hw * Math.abs(Math.cos(a.h) * ax - Math.sin(a.h) * az)
      const rb = b.hl * Math.abs(Math.sin(b.h) * ax + Math.cos(b.h) * az) + b.hw * Math.abs(Math.cos(b.h) * ax - Math.sin(b.h) * az)
      if (Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) > ra + rb + margin) return false
    }
  }
  return true
}

function boxContains(o, x, z, inflLon, inflLat) {
  const dx = x - o.x, dz = z - o.z
  const s = Math.sin(o.h), c = Math.cos(o.h)
  const lon = dx * s + dz * c
  const lat = dx * c - dz * s
  return Math.abs(lon) <= o.hl + inflLon && Math.abs(lat) <= o.hw + inflLat
}

// ───────────────────────────── occupancy grid + A* ─────────────────────────────
function createGrid(lot, infl) {
  const pad = 2
  const minX = lot.minX - pad, minZ = lot.minZ - pad
  const cols = Math.max(1, Math.ceil((lot.maxX - lot.minX + 2 * pad) / CELL))
  const rows = Math.max(1, Math.ceil((lot.maxZ - lot.minZ + 2 * pad) / CELL))
  const n = cols * rows
  return {
    minX, minZ, cols, rows, infl,
    base: new Uint8Array(n),
    dyn: new Uint8Array(n),
    footprints: new Map(),            // id → cell indices of a dynamic obstacle
    g: new Float32Array(n),
    parent: new Int32Array(n),
    seen: new Uint32Array(n),
    closed: new Uint32Array(n),
    search: 0,
  }
}

function cellOf(G, x, z) {
  const c = Math.floor((x - G.minX) / CELL), r = Math.floor((z - G.minZ) / CELL)
  return c < 0 || r < 0 || c >= G.cols || r >= G.rows ? -1 : r * G.cols + c
}
const cellX = (G, i) => G.minX + ((i % G.cols) + 0.5) * CELL
const cellZ = (G, i) => G.minZ + (Math.floor(i / G.cols) + 0.5) * CELL
const isBlocked = (G, i) => i < 0 || G.base[i] !== 0 || G.dyn[i] !== 0

/** Cells covered by a rotated rectangle grown by `grow` (may be negative to shrink). */
function rectCells(G, cx, cz, hl, hw, h, grow) {
  const s = Math.sin(h), c = Math.cos(h)
  const L = hl + grow, W = hw + grow
  if (L <= 0 || W <= 0) return []
  const ex = Math.abs(s) * L + Math.abs(c) * W, ez = Math.abs(c) * L + Math.abs(s) * W
  const c0 = Math.max(0, Math.floor((cx - ex - G.minX) / CELL)), c1 = Math.min(G.cols - 1, Math.floor((cx + ex - G.minX) / CELL))
  const r0 = Math.max(0, Math.floor((cz - ez - G.minZ) / CELL)), r1 = Math.min(G.rows - 1, Math.floor((cz + ez - G.minZ) / CELL))
  const out = []
  for (let r = r0; r <= r1; r++) {
    const z = G.minZ + (r + 0.5) * CELL - cz
    for (let col = c0; col <= c1; col++) {
      const x = G.minX + (col + 0.5) * CELL - cx
      const lon = x * s + z * c, lat = x * c - z * s
      if (Math.abs(lon) <= L && Math.abs(lat) <= W) out.push(r * G.cols + col)
    }
  }
  return out
}

function blockRect(G, cx, cz, hl, hw, h, grow = G.infl) {
  for (const i of rectCells(G, cx, cz, hl, hw, h, grow)) G.base[i] = 1
}

function addFootprint(G, id, cx, cz, hl, hw, h) {
  if (G.footprints.has(id)) return
  const cells = rectCells(G, cx, cz, hl, hw, h, G.infl)
  for (const i of cells) G.dyn[i]++
  G.footprints.set(id, cells)
}

function removeFootprint(G, id) {
  const cells = G.footprints.get(id)
  if (!cells) return
  for (const i of cells) if (G.dyn[i] > 0) G.dyn[i]--
  G.footprints.delete(id)
}

/** Run fn with some dynamic footprints lifted (the target's own pallet, …). */
function withLifted(G, ids, fn) {
  const saved = []
  for (const id of ids ?? []) {
    const cells = G.footprints.get(id)
    if (!cells) continue
    for (const i of cells) if (G.dyn[i] > 0) G.dyn[i]--
    saved.push(cells)
  }
  try {
    return fn()
  } finally {
    for (const cells of saved) for (const i of cells) G.dyn[i]++
  }
}

function nearestFree(G, i, maxR = 14) {
  if (i < 0) return -1
  if (!isBlocked(G, i)) return i
  const c0 = i % G.cols, r0 = Math.floor(i / G.cols)
  for (let rad = 1; rad <= maxR; rad++) {
    let best = -1, bestD = Infinity
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue
        const r = r0 + dr, c = c0 + dc
        if (r < 0 || c < 0 || r >= G.rows || c >= G.cols) continue
        const j = r * G.cols + c
        if (isBlocked(G, j)) continue
        const d = dr * dr + dc * dc
        if (d < bestD) { bestD = d; best = j }
      }
    }
    if (best >= 0) return best
  }
  return -1
}

/** Binary min-heap of (key, value) pairs. */
function createHeap() {
  const keys = [], vals = []
  return {
    get size() { return keys.length },
    clear() { keys.length = 0; vals.length = 0 },
    push(k, v) {
      let i = keys.length
      keys.push(k)
      vals.push(v)
      while (i > 0) {
        const p = (i - 1) >> 1
        if (keys[p] <= k) break
        keys[i] = keys[p]
        vals[i] = vals[p]
        i = p
      }
      keys[i] = k
      vals[i] = v
    },
    pop() {
      const top = vals[0]
      const k = keys.pop(), v = vals.pop()
      const n = keys.length
      if (n) {
        let i = 0
        for (;;) {
          const l = 2 * i + 1
          if (l >= n) break
          const r = l + 1
          const m = r < n && keys[r] < keys[l] ? r : l
          if (keys[m] >= k) break
          keys[i] = keys[m]
          vals[i] = vals[m]
          i = m
        }
        keys[i] = k
        vals[i] = v
      }
      return top
    },
  }
}
const heap = createHeap()
const SQ2 = Math.SQRT2

/** 8-connected A* (no corner cutting) → cell indices start…goal, or null. */
function astar(G, s, t) {
  const search = ++G.search
  const { cols, rows, g, parent, seen, closed } = G
  const tc = t % cols, tr = Math.floor(t / cols)
  const hfun = (i) => {
    const dc = Math.abs((i % cols) - tc), dr = Math.abs(Math.floor(i / cols) - tr)
    return Math.max(dc, dr) + (SQ2 - 1) * Math.min(dc, dr)
  }
  heap.clear()
  g[s] = 0
  parent[s] = -1
  seen[s] = search
  heap.push(hfun(s), s)
  let expanded = 0
  while (heap.size) {
    const i = heap.pop()
    if (closed[i] === search) continue
    closed[i] = search
    if (i === t) break
    if (++expanded > 60000) return null
    const c = i % cols, r = Math.floor(i / cols)
    for (let dr = -1; dr <= 1; dr++) {
      const nr = r + dr
      if (nr < 0 || nr >= rows) continue
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const nc = c + dc
        if (nc < 0 || nc >= cols) continue
        const j = nr * cols + nc
        if (closed[j] === search || isBlocked(G, j)) continue
        if (dr && dc && (isBlocked(G, r * cols + nc) || isBlocked(G, nr * cols + c))) continue
        const ng = g[i] + (dr && dc ? SQ2 : 1)
        if (seen[j] === search && ng >= g[j]) continue
        seen[j] = search
        g[j] = ng
        parent[j] = i
        heap.push(ng + hfun(j), j)
      }
    }
  }
  if (closed[t] !== search) return null
  const out = []
  for (let i = t; i >= 0; i = parent[i]) out.push(i)
  return out.reverse()
}

function lineFree(G, a, b) {
  const d = dist(a, b)
  const n = Math.max(1, Math.ceil(d / (CELL * 0.4)))
  for (let k = 0; k <= n; k++) {
    const t = k / n
    if (isBlocked(G, cellOf(G, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t))) return false
  }
  return true
}

/** Greedy line-of-sight simplification of a cell path. */
function stringPull(G, pts) {
  if (pts.length < 3) return pts
  const out = [pts[0]]
  let i = 0
  while (i < pts.length - 1) {
    let j = i + 1
    while (j + 1 < pts.length && lineFree(G, pts[i], pts[j + 1])) j++
    out.push(pts[j])
    i = j
  }
  return out
}

/** Drivable forklift polyline from a to b (inclusive) on the site grid, or null when blocked. */
function planPath(G, a, b, lifted) {
  if (!G) return [a, b]
  return withLifted(G, lifted, () => {
    if (lineFree(G, a, b)) return [a, b]
    const s = nearestFree(G, cellOf(G, a.x, a.z))
    const t = nearestFree(G, cellOf(G, b.x, b.z))
    if (s < 0 || t < 0) return null
    const cells = s === t ? [s] : astar(G, s, t)
    if (!cells) return null
    const pts = [P(a.x, a.z), ...cells.map((i) => P(cellX(G, i), cellZ(G, i))), P(b.x, b.z)]
    // drop the snapped cell centres right next to the true end points
    if (pts.length > 2 && dist(pts[0], pts[1]) < CELL) pts.splice(1, 1)
    if (pts.length > 2 && dist(pts[pts.length - 1], pts[pts.length - 2]) < CELL) pts.splice(pts.length - 2, 1)
    const simple = stringPull(G, pts)
    return fillet(simple, 1.8, 0.5)
  })
}

// ───────────────────────────── the simulation ─────────────────────────────
export function createSimulation(world) {
  const rng = lcg(0x5eed1e)
  const R = (a, b) => a + (b - a) * rng()
  let clock = Number(store.state.simMinutes)
  if (!Number.isFinite(clock)) clock = 580
  let lastMinute = Math.floor(clock)
  let speed = 1
  let emitAcc = 0
  let elapsedReal = 0
  let errorCount = 0

  const sites = new Map()
  const trucks = []
  const truckSim = new Map()
  const forklifts = []
  const flSim = new Map()
  const palletSim = new Map()     // pallet id → { recycleAt, ready }

  const report = (where, err) => {
    errorCount++
    if (errorCount <= 5) console.warn(`[simulation] ${where}:`, err)
  }

  // ── fork reach measured on a real forklift model when available ──────────────────────────────
  const FORK_REACH = (() => {
    try {
      const f = db.list('forklift')[0]
      const obj = f && world?.getObject?.('forklift', f.id)
      const anchor = obj?.userData?.forkAnchor
      if (!anchor) return DEFAULT_FORK_REACH
      obj.updateMatrixWorld(true)
      const v = anchor.getWorldPosition(new THREE.Vector3())
      obj.worldToLocal(v)
      const reach = (v.z + FORK_PALLET_Z) * (obj.scale?.z ?? FORKLIFT_SCALE)
      return reach > 0.5 && reach < 6 ? reach : DEFAULT_FORK_REACH
    } catch {
      return DEFAULT_FORK_REACH
    }
  })()
  const PALLET_FRONT = FORK_REACH + PAL_HALF_D           // forklift centre → front of the carried pallet
  const SLOT_PRE = FORK_REACH + 1.5                      // slot centre → approach point

  // ═════════════════════════════ init ═════════════════════════════
  function boot() {
    for (const id of SITE_IDS) {
      try { initSite(id) } catch (err) { report(`init site ${id}`, err) }
    }
    for (const t of db.list('truck')) {
      try { initTruck(t) } catch (err) { report(`init truck ${t.id}`, err) }
    }
    for (const f of db.list('forklift')) {
      try { initForklift(f) } catch (err) { report(`init forklift ${f.id}`, err) }
    }
    for (const site of sites.values()) {
      site.onSiteInit = onSiteCount(site)
      site.trucksDeltaInit = site.entity.trucksDelta ?? 0
      refreshSlotMask(site)
    }
    for (const fs of forklifts) {
      if (fs.parked && fs.home) addFootprint(fs.site.grid, `fl:${fs.id}`, fs.home.stand.x, fs.home.stand.z, FL_HALF_L, FL_HALF_W, fs.home.stand.h)
    }
    syncAll()
  }

  function initSite(id) {
    const L = siteLayout(id)
    const entity = db.site(id)
    if (!L || !entity) return
    const site = {
      id, L, entity,
      yard: { holders: new Set(), queue: [] },
      bookedBy: new Map(),    // dockId → truck sim (exclusive booking)
      occupant: new Map(),    // dockId → truck sim physically using / heading into the bay
      docks: new Map(),
      slots: new Map(),
      trucks: [],
      forklifts: [],
      grid: null,
      kinds: (entity.inventory ?? []).map((l) => KIND_OF_SKU(l.sku)),
      assignT: 0,
      onSiteInit: 0,
      trucksDeltaInit: 0,
      platformY: L.platform?.height ?? 0,
    }
    if (!site.kinds.length) site.kinds = ['cardboard']
    sites.set(id, site)

    for (const d of db.list('dock', id)) {
      const poses = dockPoses(L, d.id)
      site.docks.set(d.id, { id: d.id, entity: d, ...poses })
    }
    site.grid = buildGrid(site)

    for (const [code, pose] of Object.entries(L.slots ?? {})) {
      if (!finite(pose)) continue
      const pallets = db.list('pallet', id).filter((p) => p.slot === code)
      site.slots.set(code, { code, pose: { x: pose.x, z: pose.z, h: pose.heading ?? 0, y: pose.y ?? 0 }, pallets, resv: null })
    }
    for (const p of db.list('pallet', id)) palletSim.set(p.id, { recycleAt: null, ready: false })
  }

  /** Forklift work poses of a dock (see CONTRACT-GAP in the header). */
  function dockPoses(L, dockId) {
    const a = L.dockAnchors?.[dockId], n0 = L.dockNormals?.[dockId], dock = L.docks?.[dockId]
    if (!finite(a) || !finite(n0) || !finite(dock)) return { ok: false }
    const nl = Math.hypot(n0.x, n0.z) || 1
    const n = P(n0.x / nl, n0.z / nl)
    const h = headingOf(n)
    const platformDepth = L.platform ? Math.max(1, (L.platform.z1 ?? 0) - (L.platform.z0 ?? 0)) : 0
    const wallOff = -(0.6 + platformDepth)                      // wall plane, along n from the anchor
    const rear = (dock.x - a.x) * n.x + (dock.z - a.z) * n.z - TRUCK_HALF_L   // truck rear along n
    const truckD = rear - PALLET_FRONT - 0.15                   // pallet front just inside the rear doors
    const doorD = wallOff + (L.platform ? FORK_REACH : PALLET_FRONT - 0.3)
    const work = L.dockWork?.[dockId]
    const pivotD = L.platform || !finite(work) ? (truckD + doorD) / 2 : (work.x - a.x) * n.x + (work.z - a.z) * n.z
    const at = (d) => P(a.x + n.x * d, a.z + n.z * d)
    const pivot = at(pivotD)
    const truckStand = { ...at(truckD), h }
    const doorStand = { ...at(doorD), h: wrapAngle(h + Math.PI) }
    // raised platform (one forklift wide): wait beside the door hugging the wall, facing away from
    // the door, so another forklift can pass along the platform edge
    let waitT = null
    if (L.platform && finite(work)) {
      const shift = wallOff + 0.95 + (0.6 + platformDepth / 2)
      const wh = wrapAngle((work.heading ?? 0) + Math.PI)
      const wf = fwd(wh)
      const stand = { x: work.x + n.x * shift, z: work.z + n.z * shift, h: wh }
      waitT = { stand, pre: P(stand.x - wf.x * 2, stand.z - wf.z * 2), lifted: [] }
    }
    return {
      ok: true, n, h, anchor: P(a.x, a.z), pivot,
      truckT: { stand: truckStand, pre: pivot, lifted: [] },
      doorT: { stand: doorStand, pre: pivot, lifted: [] },
      waitT,
    }
  }

  function buildingRect(site) {
    const { L } = site
    const b = L.building ?? {}
    const swap = Math.abs(Math.sin(L.rotY ?? 0)) > 0.5
    const hx = ((swap ? b.depth : b.width) ?? 20) / 2, hz = ((swap ? b.width : b.depth) ?? 20) / 2
    const box = { minX: L.centre.x - hx, maxX: L.centre.x + hx, minZ: L.centre.z - hz, maxZ: L.centre.z + hz }
    return box
  }

  function buildGrid(site) {
    const { L } = site
    if (!L.lot) return null
    const plat = L.platform
    const G = createGrid(L.lot, plat ? INFLATE_PLATFORM : INFLATE)
    const n = G.cols * G.rows
    if (plat) {
      // cold store: forklifts live on the raised platform + apron only
      G.base.fill(1)
      const free = (x0, x1, z0, z1) => {
        for (const i of rectCells(G, (x0 + x1) / 2, (z0 + z1) / 2, (z1 - z0) / 2, (x1 - x0) / 2, 0, -G.infl)) G.base[i] = 0
      }
      free(plat.x0, plat.x1, plat.z0, plat.z1)
      if (plat.apron) free(plat.apron.x0, plat.apron.x1, plat.apron.z0, plat.apron.z1)
    } else {
      // outside the fenced lot (+ a margin) is off limits
      const { minX, maxX, minZ, maxZ } = L.lot
      for (let i = 0; i < n; i++) {
        const x = cellX(G, i), z = cellZ(G, i)
        if (x < minX + G.infl || x > maxX - G.infl || z < minZ + G.infl || z > maxZ - G.infl) G.base[i] = 1
      }
      const b = buildingRect(site)
      blockRect(G, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, (b.maxZ - b.minZ) / 2, (b.maxX - b.minX) / 2, 0)
    }
    // static yard clutter
    for (const d of L.decor ?? []) {
      switch (d.type) {
        case 'pallets': {
          const c = Math.cos(d.heading ?? 0), s = Math.sin(d.heading ?? 0)
          for (let i = 0; i < (d.cols ?? 1); i++) {
            for (let j = 0; j < (d.rows ?? 1); j++) {
              const ox = (i - ((d.cols ?? 1) - 1) / 2) * (d.gap ?? 3)
              const oz = (j - ((d.rows ?? 1) - 1) / 2) * (d.gap ?? 3) * 0.9
              blockRect(G, d.x + ox * c + oz * s, d.z - ox * s + oz * c, PAL_HALF_D + 0.15, PAL_HALF_W + 0.15, d.heading ?? 0)
            }
          }
          break
        }
        case 'rack': blockRect(G, d.x, d.z, 0.7, ((d.bays ?? 2) * 2.75) / 2 + 0.2, d.heading ?? 0); break
        case 'container': blockRect(G, d.x, d.z, 1.3, 6.2, d.heading ?? 0); break
        case 'silo': blockRect(G, d.x, d.z, (d.radius ?? 2.2) + 0.2, (d.radius ?? 2.2) + 0.2, 0); break
        case 'grass': blockRect(G, (d.minX + d.maxX) / 2, (d.minZ + d.maxZ) / 2, (d.maxZ - d.minZ) / 2, (d.maxX - d.minX) / 2, 0); break
        default: break
      }
    }
    // truck bays (a truck may stand there any time)
    for (const pose of Object.values(L.docks ?? {})) {
      if (finite(pose)) blockRect(G, pose.x, pose.z, TRUCK_HALF_L + 0.3, TRUCK_HALF_W + 0.3, pose.heading ?? 0)
    }
    // charger cabinets
    for (const cab of Object.values(L.cabinets ?? {})) {
      if (finite(cab)) blockRect(G, cab.x, cab.z, CAB.hl + 0.1, CAB.hw + 0.1, cab.heading ?? 0)
    }
    return G
  }

  function onSiteCount(site) {
    let n = 0
    for (const ts of site.trucks) if (['at_gate', 'docking', 'loading', 'unloading'].includes(ts.t.status)) n++
    return n
  }

  // ── trucks ─────────────────────────────────────────────────────────────────────────────────────
  function initTruck(t) {
    const site = sites.get(t.siteId)
    if (!site) return
    const L = site.L
    const obj = world?.getObject?.('truck', t.id)
    const ud = obj?.userData ?? {}
    const sc = obj?.scale?.z || VEHICLE_SCALE
    const shp = db.shipment(t.shipmentId)
    const ts = {
      id: t.id, t, site, L,
      hl: ud.length ? (ud.length * sc) / 2 : TRUCK_HALF_L,
      hw: ud.width ? (ud.width * sc) / 2 : TRUCK_HALF_W,
      dir: shp?.direction === 'outbound' ? 'out' : 'in',
      phase: 'docked', stage: 'road',
      path: null, s: 0, v: 0, h: t.heading ?? 0,
      x: t.position?.x ?? 0, z: t.position?.z ?? 0,
      waitS: 0, gateS: 0, releaseS: 0, rev: null,
      gatePause: 0, gateTimer: 0, timer: 0, pass: false,
      blockedFor: 0, ghost: 0,
      forkliftId: null, finished: false, loaded: [],
      lastProgress: clock - R(0, 1), etaBase: t.etaMin ?? 5, etaBaseAt: clock,
      avgT: t.cargo?.pallets > 0 ? t.cargo.weightT / t.cargo.pallets : 0.42,
      legMin: shp?.eta?.delivered && shp?.eta?.transit ? shp.eta.delivered - shp.eta.transit : 45,
      box: { x: 0, z: 0, h: 0, hl: TRUCK_HALF_L, hw: TRUCK_HALF_W },
      pathIdx: -1,
      broken: false,
    }
    ts.box.hl = ts.hl
    ts.box.hw = ts.hw
    trucks.push(ts)
    truckSim.set(t.id, ts)
    site.trucks.push(ts)

    const dockOk = !!L.docks?.[t.dockId]
    if (!dockOk) {
      ts.broken = true
      return
    }
    switch (t.status) {
      case 'loading':
      case 'unloading':
        ts.phase = 'docked'
        ts.dir = t.status === 'loading' ? 'out' : 'in'
        site.bookedBy.set(t.dockId, ts)
        site.occupant.set(t.dockId, ts)
        placeAtDock(ts)
        break
      case 'docking': {
        if (!buildInbound(ts, t.dockId)) { ts.broken = true; break }
        site.bookedBy.set(t.dockId, ts)
        site.occupant.set(t.dockId, ts)
        const left = Math.max(0, t.distanceLeftM ?? 12)
        if (left <= ts.rev.len) {
          ts.phase = 'reverse'
          ts.rev.u = ts.rev.len - left
          ts.h = ts.rev.h
        } else {
          ts.phase = 'inbound'
          ts.stage = 'yard'
          ts.s = clamp(ts.path.len - (left - ts.rev.len), ts.waitS, ts.path.len)
          ts.v = Math.min(YARD_SPEED, profileAt(ts.path, ts.s, TRUCK_DEC))
          ts.pass = true
          site.yard.holders.add(ts)
          ts.h = chordHeading(ts.path, ts.s, TRUCK_CHORD, ts.h)
        }
        break
      }
      case 'at_gate':
        if (!buildInbound(ts, t.dockId)) { ts.broken = true; break }
        site.bookedBy.set(t.dockId, ts)
        ts.phase = 'inbound'
        ts.stage = 'gate'
        ts.s = ts.waitS
        ts.v = 0
        ts.gatePause = R(4, 7)
        ts.h = chordHeading(ts.path, ts.s, TRUCK_CHORD, ts.h)
        break
      case 'departing':
        site.occupant.set(t.dockId, ts)
        ts.phase = 'leaving'
        ts.timer = 0.5
        placeAtDock(ts)
        break
      default: // en_route
        if (!buildInbound(ts, t.dockId)) { ts.broken = true; break }
        site.bookedBy.set(t.dockId, ts)
        ts.phase = 'inbound'
        ts.stage = 'road'
        ts.s = Math.max(0, ts.waitS - 15 - Math.max(0, (t.etaMin ?? 1) - 1) * 6)
        ts.v = 6
        ts.gatePause = rng() < GATE_PAUSE_P ? R(4, 8) : 0
        ts.h = chordHeading(ts.path, ts.s, TRUCK_CHORD, ts.h)
        break
    }
    poseFromState(ts)
  }

  function placeAtDock(ts) {
    const d = ts.L.docks[ts.t.dockId]
    ts.x = d.x
    ts.z = d.z
    ts.h = d.heading ?? 0
    ts.v = 0
  }

  /** arrival ⊕ approach to the pull-forward point + the straight reverse into the bay. */
  function buildInbound(ts, dockId) {
    const L = ts.L
    const arr = L.arrivalRoute, app = L.dockApproach?.[dockId], dock = L.docks?.[dockId]
    if (!arr?.length || !app?.length || !finite(dock)) return false
    const gateS = polyLen(arr)
    const waitS = Math.max(0, gateS - GATE_BACK)
    const yardS = Math.max(0, gateS - YARD_ZONE)
    const path = makePath([...arr, ...app.slice(1)], [yardS, waitS])
    shapeProfile(path, (s) => (s < yardS ? ROAD_SPEED : YARD_SPEED), TRUCK_LAT, TRUCK_DEC, 0)
    const pull = app[app.length - 1]
    ts.path = path
    ts.gateS = gateS
    ts.waitS = waitS
    ts.rev = { from: P(pull.x, pull.z), to: P(dock.x, dock.z), h: dock.heading ?? 0, len: dist(pull, dock), u: 0 }
    ts.pathIdx = -1
    return true
  }

  /** dockExit ⊕ departureRoute. */
  function buildOutbound(ts) {
    const L = ts.L
    const dock = L.docks?.[ts.t.dockId]
    let ex = L.dockExit?.[ts.t.dockId]
    if (!ex?.length) ex = finite(dock) && finite(L.gate) ? [dock, L.gate] : null
    const dep = L.departureRoute
    if (!ex || !dep?.length) return false
    const exitS = polyLen(ex)
    const path = makePath([...ex, ...dep.slice(1)], [exitS + 8])
    shapeProfile(path, (s) => (s < exitS + 8 ? YARD_SPEED : ROAD_SPEED), TRUCK_LAT, TRUCK_DEC, 0)
    ts.path = path
    ts.s = 0
    ts.releaseS = Math.min(path.len - 1, exitS + ts.hl + 6)
    ts.pathIdx = -1
    return true
  }

  // ── forklifts ──────────────────────────────────────────────────────────────────────────────────
  function initForklift(f) {
    const site = sites.get(f.siteId)
    if (!site) return
    const L = site.L
    const cpose = L.chargers?.[f.chargerId]
    const home = finite(cpose) ? chargerTarget(cpose) : null
    const fs = {
      id: f.id, f, site,
      home,
      x: f.position?.x ?? 0, z: f.position?.z ?? 0, h: f.heading ?? 0, y: site.platformY,
      v: 0, steps: [], at: null, parked: false,
      mode: 'idle', job: null, info: null,
      forkTarget: f.carryingPalletId || f.carryingKind ? FORK_CARRY : FORK_LOW,
      charger: db.get('charger', f.chargerId) ?? null,
      wasWorking: false,
    }
    forklifts.push(fs)
    flSim.set(f.id, fs)
    site.forklifts.push(fs)
    f.forkHeight = f.forkHeight ?? fs.forkTarget
    if (f.carryingPalletId) {
      const p = db.get('pallet', f.carryingPalletId)
      if (p) {
        p.carriedBy = f.id
        p.status = 'moving'
        f.carryingKind = f.carryingKind ?? KIND_OF_SKU(p.sku)
      }
      f.forkHeight = FORK_CARRY
    }

    const truck = f.truckId ? truckSim.get(f.truckId) : null
    if (truck && truck.phase === 'docked' && !truck.forkliftId) {
      assignJob(fs, truck, true)
    } else if (f.status === 'charging' && home) {
      fs.mode = 'charging'
      fs.at = { pre: home.pre }
      fs.parked = true
      if (fs.charger) fs.charger.status = 'charging'
    } else {
      f.truckId = null
      fs.mode = 'idle'
      if (home && dist(fs, home.stand) < 1) {
        fs.at = { pre: home.pre }
        fs.parked = true
      }
    }
  }

  function chargerTarget(pose) {
    const h = pose.heading ?? 0
    const f = fwd(h)
    return { stand: { x: pose.x, z: pose.z, h }, pre: P(pose.x - f.x * 2.2, pose.z - f.z * 2.2), lifted: [] }
  }

  // ═════════════════════════════ update ═════════════════════════════
  function update(dt = 0, elapsed = 0) {
    try {
      let d = Math.min(MAX_DT, Math.max(0, Number(dt) || 0))
      elapsedReal += d
      emitAcc += d
      d *= speed
      while (d > 1e-6) {
        const step = Math.min(MAX_STEP, d)
        tick(step)
        d -= step
      }
      syncAll()
      const minute = Math.floor(clock)
      if (minute !== lastMinute) {
        lastMinute = minute
        store.set({ simMinutes: minute })
      }
      if (emitAcc >= EMIT_EVERY) {
        emitAcc = 0
        siteCounters()
        bus.emit('data:update', { simMinutes: minute })
      }
    } catch (err) {
      report('update', err)
    }
  }

  function tick(dt) {
    clock += dt / SEC_PER_MIN
    for (const ts of trucks) {
      if (ts.broken) continue
      try { updateTruck(ts, dt) } catch (err) { report(`truck ${ts.id}`, err); ts.broken = true }
    }
    for (const site of sites.values()) {
      try {
        processYard(site)
        site.assignT -= dt
        if (site.assignT <= 0) {
          site.assignT = 0.5
          assignForklifts(site)
          recyclePallets(site)
        }
      } catch (err) { report(`site ${site.id}`, err) }
    }
    for (const fs of forklifts) {
      try { updateForklift(fs, dt) } catch (err) { report(`forklift ${fs.id}`, err); fs.steps.length = 0 }
    }
  }

  // ── yard token (one truck manoeuvres in a yard at a time, FIFO) ───────────────────────────────
  function requestPass(ts) {
    if (ts.pass) return true
    const Y = ts.site.yard
    if (!Y.queue.includes(ts)) Y.queue.push(ts)
    processYard(ts.site)
    return ts.pass
  }

  function processYard(site) {
    const Y = site.yard
    while (Y.queue.length && Y.holders.size === 0) {
      const ts = Y.queue.shift()
      ts.pass = true
      Y.holders.add(ts)
      if (ts.phase === 'inbound') site.occupant.set(ts.t.dockId, ts)
    }
  }

  function releasePass(ts) {
    const Y = ts.site.yard
    Y.holders.delete(ts)
    const qi = Y.queue.indexOf(ts)
    if (qi >= 0) Y.queue.splice(qi, 1)
    ts.pass = false
  }

  // ── truck state machine ───────────────────────────────────────────────────────────────────────
  function updateTruck(ts, dt) {
    if (ts.ghost > 0) ts.ghost -= dt
    switch (ts.phase) {
      case 'inbound': return driveInbound(ts, dt)
      case 'pause':
        ts.v = 0
        ts.timer -= dt
        if (ts.timer <= 0 && reverseClear(ts, dt)) {
          ts.phase = 'reverse'
          ts.rev.u = 0
          releasePass(ts)
        }
        return
      case 'reverse': return reverseIn(ts, dt)
      case 'docked': return workAtDock(ts, dt)
      case 'leaving':
        ts.v = 0
        ts.timer -= dt
        if (ts.timer <= 0 && requestPass(ts)) {
          if (!buildOutbound(ts)) { ts.broken = true; return }
          ts.phase = 'outbound'
          ts.v = 0
        }
        return
      case 'outbound': return driveOutbound(ts, dt)
      case 'offmap':
        ts.v = 0
        ts.timer -= dt
        if (ts.timer <= 0) respawn(ts)
        return
      default: return undefined
    }
  }

  function dockClear(ts) {
    const occ = ts.site.occupant.get(ts.t.dockId)
    return !occ || occ === ts
  }

  function driveInbound(ts, dt) {
    const pauseLeft = ts.gatePause > 0 && ts.gateTimer < ts.gatePause
    if (!ts.pass && !pauseLeft && ts.s >= ts.waitS - PASS_LOOKAHEAD && dockClear(ts)) requestPass(ts)
    const mustStop = !ts.pass || pauseLeft
    const stopS = mustStop && ts.s <= ts.waitS + 0.5 ? ts.waitS : ts.path.len
    driveForward(ts, dt, stopS)
    if (mustStop && ts.s >= ts.waitS - 0.6 && ts.v < 0.3) {
      ts.stage = 'gate'
      ts.gateTimer += dt
    } else if (ts.s > ts.waitS + 0.3) {
      ts.stage = 'yard'
    }
    if (ts.s >= ts.path.len - 0.05 && ts.v < 0.25) {
      ts.phase = 'pause'
      ts.timer = PULL_PAUSE
      ts.v = 0
    }
  }

  function reverseIn(ts, dt) {
    const r = ts.rev
    const rem = r.len - r.u
    const vmax = Math.min(REVERSE_SPEED, Math.sqrt(2 * 1.2 * Math.max(0, rem)) + 0.12)
    ts.v = ts.v < vmax ? Math.min(vmax, ts.v + 1.2 * dt) : vmax
    r.u = Math.min(r.len, r.u + ts.v * dt)
    const k = r.len > 0 ? r.u / r.len : 1
    ts.x = r.from.x + (r.to.x - r.from.x) * k
    ts.z = r.from.z + (r.to.z - r.from.z) * k
    ts.h = wrapAngle(ts.h + angDiff(r.h, ts.h) * Math.min(1, dt * 3))
    ts.v = Math.abs(ts.v)
    if (r.u >= r.len - 1e-3) dockArrived(ts)
  }

  function dockArrived(ts) {
    const t = ts.t
    placeAtDock(ts)
    ts.phase = 'docked'
    ts.finished = false
    ts.lastProgress = clock
    ts.etaBase = Math.max(1, (t.progress.total - t.progress.done) * ETA_PER_PALLET)
    ts.etaBaseAt = clock
    const dock = db.get('dock', t.dockId)
    if (dock) dock.trucksToday = (dock.trucksToday ?? 0) + 1
    const shp = db.shipment(t.shipmentId)
    if (shp && ts.dir === 'in') shp.times.arrived = Math.round(clock)
  }

  function workAtDock(ts) {
    const t = ts.t
    ts.v = 0
    if (ts.finished) return
    const p = t.progress
    if (p.done < p.total && !ts.forkliftId && clock - ts.lastProgress >= FALLBACK_CYCLE) {
      transfer(ts)
      siteFlow(ts.site, ts.dir === 'in' ? 1 : -1)
    }
    if (p.done >= p.total) finishWork(ts)
  }

  function finishWork(ts) {
    const t = ts.t
    ts.finished = true
    ts.phase = 'leaving'
    ts.timer = DOORS_PAUSE + R(0, 1.5)
    if (ts.site.bookedBy.get(t.dockId) === ts) ts.site.bookedBy.delete(t.dockId)
    const shp = db.shipment(t.shipmentId)
    if (shp) {
      if (ts.dir === 'out') shp.times.loaded = Math.round(clock)
      else shp.eta.done = Math.round(clock)
    }
    const fs = ts.forkliftId ? flSim.get(ts.forkliftId) : null
    if (fs && fs.job === ts) fs.job = null
    ts.forkliftId = null
  }

  function driveOutbound(ts, dt) {
    driveForward(ts, dt, ts.path.len)
    if (ts.pass && ts.s >= ts.releaseS) {
      releasePass(ts)
      leftSite(ts)
    }
    if (ts.s >= ts.path.len - 0.05) {
      if (ts.pass) {
        releasePass(ts)
        leftSite(ts)
      }
      ts.phase = 'offmap'
      ts.timer = R(1, 6)
      ts.v = 0
    }
  }

  /** The truck is out on the public road: free the bay, count it, recycle its pallets later. */
  function leftSite(ts) {
    const site = ts.site
    if (site.occupant.get(ts.t.dockId) === ts) site.occupant.delete(ts.t.dockId)
    site.entity.outboundToday = (site.entity.outboundToday ?? 0) + 1
    const shp = db.shipment(ts.t.shipmentId)
    if (shp && ts.dir === 'out') {
      shp.times.transit = Math.round(clock)
      shp.eta.delivered = Math.round(clock + ts.legMin)
    }
    for (const id of ts.loaded) {
      const ps = palletSim.get(id)
      if (ps) {
        ps.ready = true
        ps.recycleAt = clock + R(2, 4)
      }
    }
    ts.loaded = []
  }

  function chooseDock(ts) {
    const site = ts.site
    const ok = (d) => {
      if (!site.L.docks?.[d.id] || !site.L.dockApproach?.[d.id]) return false
      if (d.direction === 'in' && ts.dir !== 'in') return false
      if (d.direction === 'out' && ts.dir !== 'out') return false
      return !site.bookedBy.has(d.id)
    }
    const all = db.list('dock', site.id).filter(ok)
    const clear = all.filter((d) => !site.occupant.has(d.id))
    const pool = clear.length ? clear : all
    if (!pool.length) return null
    return pool[Math.floor(rng() * pool.length)].id
  }

  function respawn(ts) {
    const site = ts.site
    const t = ts.t
    const dockId = chooseDock(ts)
    if (!dockId) { ts.timer = 2; return }
    const spawn = site.L.arrivalRoute?.[0]
    if (!finite(spawn)) { ts.broken = true; return }
    for (const o of trucks) {
      if (o !== ts && !o.broken && Math.hypot(o.x - spawn.x, o.z - spawn.z) < SPAWN_GAP) { ts.timer = 1.5; return }
    }
    if (!buildInbound(ts, dockId)) { ts.timer = 3; return }
    t.dockId = dockId
    site.bookedBy.set(dockId, ts)
    ts.phase = 'inbound'
    ts.stage = 'road'
    ts.s = 0
    ts.v = ROAD_SPEED * 0.7
    ts.h = chordHeading(ts.path, 0, TRUCK_CHORD, ts.h)
    ts.gatePause = rng() < GATE_PAUSE_P ? R(4, 8) : 0
    ts.gateTimer = 0
    ts.finished = false
    ts.loaded = []
    ts.blockedFor = 0
    ts.ghost = 0
    const cap = Math.max(1, t.cargo?.capacity ?? 6)
    const total = Math.max(1, Math.min(cap, Math.round(R(4, 8))))
    t.progress.done = 0
    t.progress.total = total
    if (ts.dir === 'in') {
      t.cargo.pallets = total
      t.cargo.weightT = round1(total * ts.avgT)
    } else {
      t.cargo.pallets = 0
      t.cargo.weightT = 0
    }
    t.status = 'en_route'
    ts.lastProgress = clock
    resetShipment(ts)
    poseFromState(ts)
  }

  function resetShipment(ts) {
    const shp = db.shipment(ts.t.shipmentId)
    if (!shp) return
    shp.times = shp.times ?? {}
    shp.eta = shp.eta ?? {}
    const now = clock
    const T = shp.times
    T.confirmed = Math.round(now - R(150, 200))
    T.picked = Math.round(Math.min(now - 30, T.confirmed + R(75, 100)))
    if (shp.direction === 'outbound') {
      delete T.loaded
      delete T.transit
    } else {
      T.loaded = Math.round(Math.min(now - 12, T.picked + R(35, 55)))
      T.transit = Math.round(Math.min(now - 3, T.loaded + R(12, 20)))
      delete T.arrived
    }
  }

  // ── truck motion ──────────────────────────────────────────────────────────────────────────────
  function driveForward(ts, dt, stopS) {
    const path = ts.path
    let vmax = profileAt(path, ts.s, TRUCK_DEC)
    vmax = Math.min(vmax, Math.sqrt(2 * TRUCK_DEC * Math.max(0, stopS - ts.s)))
    const probe = ts.ghost > 0 ? Infinity : probeAhead(ts)
    const held = probe < vmax
    if (held) vmax = probe
    if (ts.v < vmax) ts.v = Math.min(vmax, ts.v + TRUCK_ACC * dt)
    else ts.v = Math.max(vmax, ts.v - TRUCK_DEC * 2.5 * dt)
    if (held && ts.v < 0.3) {
      ts.blockedFor += dt
      if (ts.blockedFor > STUCK_GHOST) {
        ts.ghost = 3
        ts.blockedFor = 0
      }
    } else if (!held) ts.blockedFor = Math.max(0, ts.blockedFor - dt)
    ts.s = Math.min(path.len, Math.max(ts.s, Math.min(ts.s + ts.v * dt, stopS)))
    const p = pointAt(path, ts.s)
    ts.x = p.x
    ts.z = p.z
    const target = chordHeading(path, ts.s, TRUCK_CHORD, ts.h)
    const maxYaw = (0.4 + ts.v * 0.35) * dt
    ts.h = wrapAngle(ts.h + clamp(angDiff(target, ts.h), -maxYaw, maxYaw))
  }

  const _q = P(0, 0)
  const flBox = (fs) => ({ x: fs.x, z: fs.z, h: fs.h, hl: FL_HALF_L, hw: FL_HALF_W })
  /**
   * Speed limit from the first truck — or forklift on this site — found ahead on the remaining
   * path. A forklift in the way is remembered (ts.waitFor) so that forklift does not in turn wait
   * for this truck.
   */
  function probeAhead(ts) {
    ts.waitFor = null
    const reach = ts.hl + 3 + (ts.v * ts.v) / (2 * TRUCK_DEC) + 8
    const near = []
    for (const o of trucks) {
      if (o === ts || o.broken || o.phase === 'offmap') continue
      if (Math.abs(o.x - ts.x) > reach + 16 || Math.abs(o.z - ts.z) > reach + 16) continue
      near.push(o.box)
    }
    const nearFl = []
    for (const fs of ts.site.forklifts) {
      if (Math.abs(fs.x - ts.x) > reach + 8 || Math.abs(fs.z - ts.z) > reach + 8) continue
      nearFl.push(fs)
    }
    if (!near.length && !nearFl.length) return Infinity
    for (let d = ts.hl + 0.5; d <= reach; d += 1.5) {
      const sp = ts.s + d
      if (sp > ts.path.len + 0.5) break
      pointAt(ts.path, Math.min(sp, ts.path.len), _q)
      for (const o of near) {
        if (boxContains(o, _q.x, _q.z, 0.6, ts.hw + 0.25)) {
          return Math.sqrt(2 * TRUCK_DEC * Math.max(0, d - ts.hl - 1.5))
        }
      }
      for (const fs of nearFl) {
        if (boxContains(flBox(fs), _q.x, _q.z, 0.5, ts.hw + 0.2)) {
          ts.waitFor = fs.id
          return Math.sqrt(2 * TRUCK_DEC * Math.max(0, d - ts.hl - 1.2))
        }
      }
    }
    return Infinity
  }

  /** Nothing (truck or forklift) in the strip the truck is about to reverse through. */
  function reverseClear(ts, dt) {
    const r = ts.rev
    const n = fwd(r.h)
    const box = {
      x: (r.from.x + r.to.x) / 2 - n.x * ts.hl, z: (r.from.z + r.to.z) / 2 - n.z * ts.hl,
      h: r.h, hl: r.len / 2, hw: ts.hw + 0.3,
    }
    ts.waitFor = null
    let blocked = false
    for (const fs of ts.site.forklifts) {
      if (boxOverlap(box, flBox(fs))) {
        ts.waitFor = fs.id
        blocked = true
        break
      }
    }
    if (!blocked) {
      for (const o of trucks) {
        if (o !== ts && !o.broken && o.phase !== 'offmap' && boxOverlap(box, o.box, -0.2)) { blocked = true; break }
      }
    }
    if (!blocked) {
      ts.blockedFor = 0
      return true
    }
    ts.blockedFor += dt
    return ts.blockedFor > STUCK_GHOST * 2
  }

  function poseFromState(ts) {
    if (ts.phase === 'inbound' || ts.phase === 'outbound') {
      const p = pointAt(ts.path, ts.s)
      ts.x = p.x
      ts.z = p.z
    } else if (ts.phase === 'reverse' || ts.phase === 'pause') {
      const r = ts.rev
      const k = r.len > 0 ? r.u / r.len : 1
      ts.x = r.from.x + (r.to.x - r.from.x) * k
      ts.z = r.from.z + (r.to.z - r.from.z) * k
    }
  }

  // ── pallet transfers + counters ───────────────────────────────────────────────────────────────
  /** One pallet off (inbound) / onto (outbound) the truck. */
  function transfer(ts) {
    const t = ts.t
    const p = t.progress
    if (p.done >= p.total) return false
    p.done++
    const c = t.cargo
    if (c) {
      if (ts.dir === 'in') {
        c.pallets = Math.max(0, c.pallets - 1)
        c.weightT = round1(Math.max(0, c.weightT - ts.avgT))
        if (c.pallets === 0) c.weightT = 0
      } else {
        c.pallets = Math.min(c.capacity ?? Infinity, c.pallets + 1)
        c.weightT = round1(c.weightT + ts.avgT)
      }
    }
    ts.lastProgress = clock
    ts.etaBase = Math.max(0, (p.total - p.done) * ETA_PER_PALLET)
    ts.etaBaseAt = clock
    return true
  }

  /** Stock moves: +1 a pallet received (put away), −1 a pallet shipped. */
  function siteFlow(site, delta) {
    const s = site.entity
    s.stock = Math.max(0, (s.stock ?? 0) + delta)
    s.stockDelta = (s.stockDelta ?? 0) + delta
    if (delta > 0) s.putawaysToday = (s.putawaysToday ?? 0) + 1
  }

  function siteCounters() {
    for (const site of sites.values()) {
      const now = onSiteCount(site)
      site.entity.trucksDelta = Math.max(0, site.trucksDeltaInit + now - site.onSiteInit)
    }
  }

  // ── slots ─────────────────────────────────────────────────────────────────────────────────────
  const slotVisible = (p) => !!p && (p.status === 'staged' || p.status === 'stored') && !p.carriedBy
  const slotPallet = (slot) => slot.pallets.find(slotVisible) ?? null

  function refreshSlotMask(site) {
    const G = site.grid
    if (!G) return
    for (const slot of site.slots.values()) {
      const id = `slot:${slot.code}`
      if (slotPallet(slot)) addFootprint(G, id, slot.pose.x, slot.pose.z, PAL_HALF_D, PAL_HALF_W, slot.pose.h)
      else removeFootprint(G, id)
    }
  }

  /** Approach (stand + pre) for a slot from the side that is free, nearest to `from`. */
  function slotTarget(site, slot, from) {
    const G = site.grid
    const { pose } = slot
    const dirs = site.L.platform ? [P(1, 0), P(-1, 0)] : [fwd(pose.h), fwd(pose.h + Math.PI)]
    const lifted = [`slot:${slot.code}`]
    let best = null, bestD = Infinity
    withLifted(G, lifted, () => {
      for (const f of dirs) {
        const stand = { x: pose.x - f.x * FORK_REACH, z: pose.z - f.z * FORK_REACH, h: headingOf(f) }
        const pre = P(pose.x - f.x * SLOT_PRE, pose.z - f.z * SLOT_PRE)
        if (G && (isBlocked(G, cellOf(G, pre.x, pre.z)) || !lineFree(G, pre, stand))) continue
        const d = dist(pre, from)
        if (d < bestD) { bestD = d; best = { stand, pre, lifted } }
      }
    })
    return best
  }

  function findRefillSlot(site, from) {
    let best = null, bestD = Infinity
    for (const slot of site.slots.values()) {
      if (slot.resv || slotPallet(slot)) continue
      const p = slot.pallets.find((x) => x.status === 'loaded' && palletSim.get(x.id)?.ready)
      if (!p) continue
      const target = slotTarget(site, slot, from)
      if (!target) continue
      const d = dist(target.pre, from)
      if (d < bestD) { bestD = d; best = { slot, pallet: p, target } }
    }
    return best
  }

  function findSourceSlot(site, from) {
    let best = null, bestD = Infinity
    for (const slot of site.slots.values()) {
      if (slot.resv) continue
      const p = slotPallet(slot)
      if (!p) continue
      const target = slotTarget(site, slot, from)
      if (!target) continue
      const d = dist(target.pre, from) + (p.status === 'stored' ? 6 : 0)
      if (d < bestD) { bestD = d; best = { slot, pallet: p, target } }
    }
    return best
  }

  function recyclePallets(site) {
    let changed = false
    for (const slot of site.slots.values()) {
      if (slot.resv || slotPallet(slot)) continue
      for (const p of slot.pallets) {
        const ps = palletSim.get(p.id)
        if (!ps || p.status !== 'loaded' || !ps.ready || ps.recycleAt == null || clock < ps.recycleAt) continue
        // never pop a pallet in under a forklift
        if (site.forklifts.some((fs) => dist(fs, slot.pose) < 3.4)) continue
        stagePallet(p, slot)
        changed = true
        break
      }
    }
    if (changed) refreshSlotMask(site)
  }

  function stagePallet(p, slot, at) {
    const ps = palletSim.get(p.id)
    p.status = 'staged'
    p.carriedBy = null
    p.position.x = at?.x ?? slot.pose.x
    p.position.y = slot.pose.y ?? 0
    p.position.z = at?.z ?? slot.pose.z
    p.heading = at?.h ?? slot.pose.h
    p.received = `Apr 20, ${fmtTime(clock)}`
    if (ps) {
      ps.ready = false
      ps.recycleAt = null
    }
  }

  // ── forklift assignment ───────────────────────────────────────────────────────────────────────
  function assignForklifts(site) {
    for (const ts of site.trucks) {
      if (ts.broken || ts.phase !== 'docked' || ts.finished || ts.forkliftId) continue
      if (ts.t.progress.done >= ts.t.progress.total) continue
      const dk = site.docks.get(ts.t.dockId)
      if (!dk?.ok) continue
      let best = null, bestScore = Infinity
      for (const fs of site.forklifts) {
        if (fs.job || fs.mode === 'toCharger') continue
        if (fs.f.carryingPalletId || fs.f.carryingKind) continue
        const b = fs.f.battery ?? 0
        if (fs.mode === 'charging' ? b < STEAL_CHARGING_ABOVE : b < LOW_BATTERY + 5) continue
        const score = dist(fs, dk.pivot) + (fs.mode === 'charging' ? 80 : 0)
        if (score < bestScore) { bestScore = score; best = fs }
      }
      if (best) assignJob(best, ts, false)
    }
  }

  function assignJob(fs, ts, initial) {
    if (fs.mode === 'charging') stopCharging(fs)
    fs.job = ts
    fs.mode = 'work'
    fs.wasWorking = true
    ts.forkliftId = fs.id
    fs.f.truckId = ts.id
    const dock = db.get('dock', ts.t.dockId)
    fs.info = {
      status: ts.dir === 'in' ? 'unloading' : 'loading',
      task: `${ts.dir === 'in' ? 'Unloading' : 'Loading'} ${ts.id} at ${dock?.name ?? ts.t.dockId}`,
    }
    if (!initial) cancelSteps(fs)
  }

  function cancelSteps(fs) {
    // keep a carried pallet (it is delivered by the next plan); drop pending reservations
    for (const st of fs.steps) if (st.release) st.release()
    fs.steps.length = 0
  }

  function endJob(fs) {
    if (fs.job && fs.job.forkliftId === fs.id) fs.job.forkliftId = null
    fs.job = null
    fs.f.truckId = null
  }

  // ── forklift planning ─────────────────────────────────────────────────────────────────────────
  const randomKind = (site) => site.kinds[Math.floor(rng() * site.kinds.length)] ?? 'cardboard'

  function nearestDock(site, from, accept = () => true) {
    let best = null, bestD = Infinity
    for (const dk of site.docks.values()) {
      if (!dk.ok || !accept(dk)) continue
      const d = dist(dk.pivot, from)
      if (d < bestD) { bestD = d; best = dk }
    }
    return best
  }

  function planNext(fs) {
    const f = fs.f
    if (fs.job && (fs.job.phase !== 'docked' || fs.job.finished || fs.job.broken)) endJob(fs)
    if (f.carryingPalletId || f.carryingKind) return planDeliverHeld(fs)
    if (fs.job) {
      if ((f.battery ?? 0) < LOW_BATTERY) {
        endJob(fs)
        return planCharge(fs)
      }
      const ts = fs.job
      if (ts.t.progress.done < ts.t.progress.total) return ts.dir === 'in' ? planUnload(fs, ts) : planLoad(fs, ts)
      fs.steps.push({ kind: 'wait', t: 0.5 })
      return undefined
    }
    if (fs.mode === 'charging') return undefined
    fs.info = null
    if ((f.battery ?? 0) < LOW_BATTERY) return planCharge(fs)
    if (!fs.home) {
      fs.mode = 'idle'
      return undefined
    }
    if (!atHome(fs)) {
      fs.mode = 'returning'
      fs.steps.push({ kind: 'forksAsync', h: FORK_LOW }, { kind: 'goto', target: fs.home }, { kind: 'do', fn: () => park(fs) })
      return undefined
    }
    if (fs.mode !== 'idle') park(fs)
    return undefined
  }

  const atHome = (fs) => !!fs.home && !!fs.at && dist(fs, fs.home.stand) < 0.3

  function park(fs) {
    fs.parked = true
    fs.mode = 'idle'
    fs.info = null
    addFootprint(fs.site.grid, `fl:${fs.id}`, fs.home.stand.x, fs.home.stand.z, FL_HALF_L, FL_HALF_W, fs.home.stand.h)
    if (fs.wasWorking && (fs.f.battery ?? 100) < TOP_UP_BELOW) startCharging(fs)
    fs.wasWorking = false
    return true
  }

  function planCharge(fs) {
    if (!fs.home) {
      fs.mode = 'idle'
      return
    }
    fs.mode = 'toCharger'
    fs.info = null
    if (atHome(fs)) {
      park(fs)
      startCharging(fs)
      return
    }
    fs.steps.push(
      { kind: 'forksAsync', h: FORK_LOW },
      { kind: 'goto', target: fs.home },
      { kind: 'do', fn: () => { park(fs); startCharging(fs); return true } },
    )
  }

  function startCharging(fs) {
    fs.mode = 'charging'
    const c = fs.charger
    if (c) {
      if (c.status !== 'charging') c.sessionsToday = (c.sessionsToday ?? 0) + 1
      c.status = 'charging'
    }
  }

  function stopCharging(fs) {
    if (fs.charger) fs.charger.status = 'free'
    if (fs.mode === 'charging') fs.mode = 'idle'
  }

  function planUnload(fs, ts) {
    const site = fs.site
    const dk = site.docks.get(ts.t.dockId)
    if (!dk?.ok) {
      endJob(fs)
      return
    }
    const refill = findRefillSlot(site, dk.pivot)
    if (refill) refill.slot.resv = fs.id
    const kind = refill ? KIND_OF_SKU(refill.pallet.sku) : randomKind(site)
    const truckH = site.L.platform ? FORK_TRUCK_PLATFORM : FORK_TRUCK
    const release = () => { if (refill && refill.slot.resv === fs.id) refill.slot.resv = null }
    const paced = { kind: 'until', fn: () => ts.phase !== 'docked' || clock - ts.lastProgress >= MIN_CYCLE, release }
    fs.steps.push({ kind: 'forksAsync', h: FORK_LOW, release })
    if (dk.waitT) {
      // platform: wait beside the door, then step in front of the truck for the pick only
      fs.steps.push(
        { kind: 'goto', target: dk.waitT, release }, paced,
        { kind: 'goto', target: dk.truckT, release },
      )
    } else {
      fs.steps.push(
        { kind: 'goto', target: dk.truckT, release },
        { kind: 'forksAsync', h: truckH, release }, paced,
      )
    }
    fs.steps.push(
      { kind: 'forks', h: truckH, release },
      { kind: 'do', fn: () => pickFromTruck(fs, ts, refill, kind), release },
      { kind: 'wait', t: 0.35 },
      { kind: 'forksAsync', h: FORK_CARRY },
      { kind: 'goto', target: refill ? refill.target : dk.doorT },
      { kind: 'forks', h: FORK_LOW },
      { kind: 'do', fn: () => dropHeld(fs, refill) },
      { kind: 'wait', t: 0.3 },
    )
  }

  function pickFromTruck(fs, ts, refill, kind) {
    const f = fs.f
    if (ts.phase !== 'docked' || ts.t.progress.done >= ts.t.progress.total) {
      if (refill && refill.slot.resv === fs.id) refill.slot.resv = null
      return false
    }
    transfer(ts)
    if (refill && refill.pallet.status === 'loaded') {
      const p = refill.pallet
      p.status = 'moving'
      p.carriedBy = f.id
      p.received = `Apr 20, ${fmtTime(clock)}`
      const ps = palletSim.get(p.id)
      if (ps) { ps.ready = false; ps.recycleAt = null }
      f.carryingPalletId = p.id
      f.carryingKind = KIND_OF_SKU(p.sku)
      fs.held = { slot: refill.slot }
    } else {
      if (refill && refill.slot.resv === fs.id) refill.slot.resv = null
      f.carryingKind = kind
      fs.held = null
    }
    return true
  }

  /** Put down whatever is on the forks: a real pallet at its slot, a generic one through the door. */
  function dropHeld(fs, refill) {
    const f = fs.f
    const site = fs.site
    const reach = forksPoint(fs)
    if (f.carryingPalletId) {
      const p = db.get('pallet', f.carryingPalletId)
      const slot = refill?.slot ?? site.slots.get(p?.slot)
      if (p && slot && dist(reach, slot.pose) < 1.5) {
        stagePallet(p, slot, { x: reach.x, z: reach.z, h: fs.h })
      } else if (p) {
        // not at its slot (fallback delivery through a door): back into the building, re-staged later
        p.status = 'loaded'
        p.carriedBy = null
        const ps = palletSim.get(p.id)
        if (ps) { ps.ready = true; ps.recycleAt = clock + R(3, 6) }
      }
      if (slot && slot.resv === fs.id) slot.resv = null
      f.carryingPalletId = null
      refreshSlotMask(site)
    }
    f.carryingKind = null
    fs.held = null
    f.movesToday = (f.movesToday ?? 0) + 1
    siteFlow(site, 1)
    return true
  }

  function planLoad(fs, ts) {
    const site = fs.site
    const dk = site.docks.get(ts.t.dockId)
    if (!dk?.ok) {
      endJob(fs)
      return
    }
    const src = findSourceSlot(site, dk.pivot)
    if (src) src.slot.resv = fs.id
    const truckH = site.L.platform ? FORK_TRUCK_PLATFORM : FORK_TRUCK
    const release = () => { if (src && src.slot.resv === fs.id) src.slot.resv = null }
    fs.steps.push(
      { kind: 'forksAsync', h: FORK_LOW, release },
      { kind: 'goto', target: src ? src.target : dk.doorT, release },
      { kind: 'forks', h: FORK_LOW, release },
      { kind: 'do', fn: () => pickForLoad(fs, ts, src), release },
      { kind: 'wait', t: 0.35 },
      { kind: 'forksAsync', h: FORK_CARRY },
    )
    const paced = { kind: 'until', fn: () => ts.phase !== 'docked' || clock - ts.lastProgress >= MIN_CYCLE }
    if (dk.waitT) fs.steps.push({ kind: 'goto', target: dk.waitT }, paced, { kind: 'goto', target: dk.truckT })
    else fs.steps.push({ kind: 'goto', target: dk.truckT }, paced)
    fs.steps.push(
      { kind: 'forks', h: truckH },
      { kind: 'do', fn: () => dropIntoTruck(fs, ts) },
      { kind: 'wait', t: 0.3 },
      { kind: 'forksAsync', h: FORK_LOW },
    )
  }

  function pickForLoad(fs, ts, src) {
    const f = fs.f
    if (ts.phase !== 'docked' || ts.t.progress.done >= ts.t.progress.total) {
      if (src && src.slot.resv === fs.id) src.slot.resv = null
      return false
    }
    if (src) {
      const p = src.pallet
      src.slot.resv = null
      if (slotVisible(p)) {
        p.status = 'moving'
        p.carriedBy = f.id
        f.carryingPalletId = p.id
        f.carryingKind = KIND_OF_SKU(p.sku)
        refreshSlotMask(fs.site)
        return true
      }
    }
    f.carryingKind = randomKind(fs.site)
    return true
  }

  function dropIntoTruck(fs, ts) {
    const f = fs.f
    if (ts.phase !== 'docked' || !transfer(ts)) return false    // keep holding → delivered elsewhere
    if (f.carryingPalletId) {
      const p = db.get('pallet', f.carryingPalletId)
      if (p) {
        const reach = forksPoint(fs)
        p.status = 'loaded'
        p.carriedBy = null
        p.position.x = reach.x
        p.position.z = reach.z
        p.position.y = fs.y
        p.heading = fs.h
        ts.loaded.push(p.id)
        const ps = palletSim.get(p.id)
        if (ps) { ps.ready = false; ps.recycleAt = null }
      }
      f.carryingPalletId = null
    }
    f.carryingKind = null
    f.movesToday = (f.movesToday ?? 0) + 1
    siteFlow(fs.site, -1)
    return true
  }

  function planDeliverHeld(fs) {
    const f = fs.f
    const site = fs.site
    if (f.carryingPalletId) {
      const p = db.get('pallet', f.carryingPalletId)
      const slot = p ? site.slots.get(p.slot) : null
      if (p && slot && !slotPallet(slot) && (!slot.resv || slot.resv === fs.id)) {
        const target = slotTarget(site, slot, fs)
        if (target) {
          slot.resv = fs.id
          fs.steps.push(
            { kind: 'forksAsync', h: FORK_CARRY },
            { kind: 'goto', target },
            { kind: 'forks', h: FORK_LOW },
            { kind: 'do', fn: () => dropHeld(fs, { slot }) },
            { kind: 'wait', t: 0.3 },
          )
          return
        }
      }
    }
    // put it through a door nobody else is working at (the job's own dock first)
    const own = fs.job ? site.docks.get(fs.job.t.dockId) : null
    const dk = own?.ok ? own : nearestDock(site, fs, (d) => {
      const ts = site.occupant.get(d.id) ?? site.bookedBy.get(d.id)
      return !ts?.forkliftId || ts.forkliftId === fs.id
    })
    if (!dk?.ok) {
      // nowhere sensible to go: just let it vanish
      f.carryingKind = null
      if (f.carryingPalletId) {
        const p = db.get('pallet', f.carryingPalletId)
        if (p) { p.carriedBy = null; p.status = 'loaded' }
        f.carryingPalletId = null
      }
      return
    }
    fs.steps.push(
      { kind: 'forksAsync', h: FORK_CARRY },
      { kind: 'goto', target: dk.doorT },
      { kind: 'forks', h: FORK_LOW },
      { kind: 'do', fn: () => dropHeld(fs, null) },
      { kind: 'wait', t: 0.3 },
    )
  }

  function forksPoint(fs) {
    const f = fwd(fs.h)
    return P(fs.x + f.x * FORK_REACH, fs.z + f.z * FORK_REACH)
  }

  // ── forklift step runner ──────────────────────────────────────────────────────────────────────
  function updateForklift(fs, dt) {
    const f = fs.f
    // battery
    const dtMin = dt / SEC_PER_MIN
    if (fs.mode === 'charging') {
      const c = fs.charger
      const b = f.battery ?? 0
      const taper = b < 80 ? 1 : Math.max(0.3, 1 - ((b - 80) / 20) * 0.7)
      const gain = Math.min(100 - b, (c?.chargeRatePctMin ?? 6) * taper * dtMin)
      f.battery = Math.min(100, b + gain)
      if (c) c.energyKwh = round1((c.energyKwh ?? 0) + gain * KWH_PER_PCT * 1.0) // kept with 0.1 kWh precision
      if (f.battery >= 100 - 1e-6) {
        f.battery = 100
        stopCharging(fs)
        fs.mode = 'idle'
      }
    } else {
      const busy = fs.job || fs.info || fs.mode === 'toCharger' || fs.mode === 'returning' || f.carryingKind
      f.battery = Math.max(0, (f.battery ?? 0) - (busy ? DRAIN_WORK : DRAIN_IDLE) * dtMin)
    }

    // forks
    const fh = f.forkHeight ?? FORK_LOW
    if (Math.abs(fh - fs.forkTarget) > 1e-4) {
      const stepH = FORK_RATE * dt
      f.forkHeight = fh < fs.forkTarget ? Math.min(fs.forkTarget, fh + stepH) : Math.max(fs.forkTarget, fh - stepH)
    }

    // steps
    let guard = 0
    let planned = false
    let budget = dt
    while (guard++ < 12) {
      if (!fs.steps.length) {
        if (planned) break
        planned = true
        planNext(fs)
        if (!fs.steps.length) break
      }
      const st = fs.steps[0]
      const res = runStep(fs, st, budget)
      if (res === 'again') continue
      if (res === 'abort') {
        cancelSteps(fs)
        break
      }
      if (!res) break
      fs.steps.shift()
      budget = 0
    }
    const moving = fs.steps.length && (fs.steps[0].kind === 'drive' || fs.steps[0].kind === 'reverse')
    if (!moving) fs.v = 0
  }

  function runStep(fs, st, dt) {
    switch (st.kind) {
      case 'goto': {
        const sub = expandGoto(fs, st)
        if (!sub) {
          fs.steps.unshift({ kind: 'wait', t: 0.8 })
          return false
        }
        fs.steps.splice(0, 1, ...sub)
        return 'again'
      }
      case 'reverse': return stepReverse(fs, st, dt)
      case 'pivot': return stepPivot(fs, st, dt)
      case 'drive': return stepDrive(fs, st, dt)
      case 'wait':
        st.t -= dt
        return st.t <= 0
      case 'until':
        st.max = (st.max ?? 40) - dt
        return st.fn() || st.max <= 0
      case 'forks':
        fs.forkTarget = st.h
        return Math.abs((fs.f.forkHeight ?? 0) - st.h) < 0.005
      case 'forksAsync':
        fs.forkTarget = st.h
        return true
      case 'do':
        return st.fn() === false ? 'abort' : true
      case 'arrive':
        // standing at a pick / drop / park pose: other forklifts plan around it
        fs.at = { pre: st.pre }
        addFootprint(fs.site.grid, `fl:${fs.id}`, fs.x, fs.z, FL_HALF_L, FL_HALF_W, fs.h)
        fs.parked = true
        return true
      default:
        return true
    }
  }

  /**
   * goto → [back out of the current stand] + A* drive to the target's approach point + pivot +
   * straight in. Returns null (retry shortly) while the way is blocked by standing forklifts.
   */
  function expandGoto(fs, st) {
    const target = st.target
    const G = fs.site.grid
    const start = P(fs.x, fs.z)
    const back = fs.at ? P(fs.at.pre.x, fs.at.pre.z) : null
    const from = back ?? start
    let pts = planPath(G, from, target.pre, [...(target.lifted ?? []), `fl:${fs.id}`])
    if (!pts) {
      st.tries = (st.tries ?? 0) + 1
      if (st.tries < 8) return null
      pts = [from, P(target.pre.x, target.pre.z)]
    }
    if (fs.parked) {
      removeFootprint(G, `fl:${fs.id}`)
      fs.parked = false
    }
    const out = []
    if (back && dist(start, back) > 0.05) out.push({ kind: 'reverse', from: start, to: back })
    fs.at = null
    if (pts.length >= 2 && polyLen(pts) > 0.25) out.push({ kind: 'drive', pts })
    out.push({ kind: 'pivot', h: target.stand.h })
    out.push({ kind: 'drive', pts: [P(target.pre.x, target.pre.z), P(target.stand.x, target.stand.z)], final: true })
    out.push({ kind: 'arrive', pre: target.pre })
    return out
  }

  function stepReverse(fs, st, dt) {
    if (st.len == null) {
      st.len = dist(st.from, st.to)
      st.u = 0
    }
    const rem = st.len - st.u
    const vmax = Math.min(FL_REVERSE, Math.sqrt(2 * FL_ACC * Math.max(0, rem)) + 0.08)
    fs.v = Math.min(vmax, fs.v + FL_ACC * dt)
    st.u = Math.min(st.len, st.u + fs.v * dt)
    const k = st.len > 0 ? st.u / st.len : 1
    fs.x = st.from.x + (st.to.x - st.from.x) * k
    fs.z = st.from.z + (st.to.z - st.from.z) * k
    if (st.u >= st.len - 1e-4) {
      fs.v = 0
      return true
    }
    return false
  }

  function stepPivot(fs, st, dt) {
    fs.v = 0
    const d = angDiff(st.h, fs.h)
    const maxStep = FL_PIVOT * dt
    if (Math.abs(d) <= maxStep + 1e-4) {
      fs.h = wrapAngle(st.h)
      return true
    }
    fs.h = wrapAngle(fs.h + Math.sign(d) * maxStep)
    return false
  }

  function stepDrive(fs, st, dt) {
    if (!st.path) {
      st.path = makePath(st.pts)
      const top = st.final ? FL_SPEED_FINAL : fs.f.carryingKind ? FL_SPEED_LOADED : FL_SPEED
      shapeProfile(st.path, () => top, FL_LAT, FL_ACC, 0)
      st.s = 0
      if (st.path.len < 0.02) return true
      const h0 = chordHeading(st.path, 0, FL_CHORD, fs.h)
      if (Math.abs(angDiff(h0, fs.h)) > 0.45) {
        fs.steps.unshift({ kind: 'pivot', h: h0 })
        return 'again'
      }
    }
    const path = st.path
    const rem = path.len - st.s
    let vmax = Math.min(profileAt(path, st.s, FL_ACC), Math.sqrt(2 * FL_ACC * Math.max(0, rem)) + 0.05)
    vmax = Math.min(vmax, forkliftProbe(fs, dt, !!st.final))
    if (fs.v < vmax) fs.v = Math.min(vmax, fs.v + FL_ACC * dt)
    else fs.v = Math.max(vmax, fs.v - FL_ACC * 2.5 * dt)
    st.s = Math.min(path.len, st.s + fs.v * dt)
    const p = pointAt(path, st.s)
    fs.x = p.x
    fs.z = p.z
    const target = chordHeading(path, st.s, FL_CHORD, fs.h)
    const maxYaw = FL_YAW * dt
    fs.h = wrapAngle(fs.h + clamp(angDiff(target, fs.h), -maxYaw, maxYaw))
    if (st.s >= path.len - 1e-3) {
      if (st.final) fs.h = wrapAngle(chordHeading(path, path.len, FL_CHORD, fs.h))
      return true
    }
    return false
  }

  /**
   * Forklifts give way: they stop for any truck about to cross their way (trucks never wait for
   * forklifts) and slow behind another forklift straight ahead (ignored after a short standoff).
   */
  function forkliftProbe(fs, dt, committed) {
    const f = fwd(fs.h)
    let truckLim = Infinity
    const reach = FL_HALF_L + 1.2 + (fs.v * fs.v) / (2 * FL_ACC)
    for (const t of committed ? [] : fs.site.trucks) {
      if (t.broken || t.phase === 'offmap' || t.phase === 'docked') continue
      if (t.waitFor === fs.id) continue          // that truck is already waiting for us
      if (Math.abs(t.x - fs.x) > 40 || Math.abs(t.z - fs.z) > 40) continue
      // a moving truck claims the ground it is about to cover
      const moving = t.v > 0.05 || t.phase === 'pause' || t.phase === 'leaving'
      const back = t.phase === 'reverse' || t.phase === 'pause' ? -1 : 1
      const ext = moving ? Math.max(3, t.v * 2.5) : 0
      const tf = fwd(t.h)
      const box = { x: t.x + tf.x * back * ext / 2, z: t.z + tf.z * back * ext / 2, h: t.h, hl: t.hl + ext / 2, hw: t.hw }
      for (let d = FL_HALF_L * 0.5; d <= reach; d += 0.6) {
        if (boxContains(box, fs.x + f.x * d, fs.z + f.z * d, 0.4, FL_HALF_W + 0.3)) {
          truckLim = Math.min(truckLim, Math.sqrt(2 * FL_ACC * Math.max(0, d - FL_HALF_L - 0.6)))
          break
        }
      }
    }
    let lim = Infinity
    for (const o of fs.site.forklifts) {
      if (o === fs) continue
      const dx = o.x - fs.x, dz = o.z - fs.z
      const lon = dx * f.x + dz * f.z
      if (lon <= 0 || lon > 7) continue
      const lat = Math.abs(dx * f.z - dz * f.x)
      if (lat > FL_HALF_W * 2 + 0.3) continue
      // only yield to a forklift that is not itself waiting on us
      if (o.v < 0.05 && o.yieldT > 1.5) continue
      const gap = lon - FL_HALF_L * 2 - 0.4
      lim = Math.min(lim, Math.sqrt(2 * FL_ACC * Math.max(0, gap)))
    }
    if (lim < 0.05) fs.yieldT = (fs.yieldT ?? 0) + dt
    else fs.yieldT = 0
    // trucks always win, unless the forklift has been stuck for long (a docked-truck graze)
    if (truckLim < 0.05) fs.truckWait = (fs.truckWait ?? 0) + dt
    else fs.truckWait = 0
    if (fs.truckWait > 12) truckLim = Infinity
    return Math.min(truckLim, fs.yieldT > 2.5 ? Infinity : lim)
  }

  // ═════════════════════════════ sync → db entities ═════════════════════════════
  function syncAll() {
    for (const ts of trucks) {
      try { syncTruck(ts) } catch (err) { report(`sync truck ${ts.id}`, err) }
    }
    for (const fs of forklifts) {
      try { syncForklift(fs) } catch (err) { report(`sync forklift ${fs.id}`, err) }
    }
    for (const site of sites.values()) {
      try { syncDocks(site) } catch (err) { report(`sync docks ${site.id}`, err) }
    }
    for (const c of db.list('charger')) {
      const fs = c.forkliftId ? flSim.get(c.forkliftId) : null
      if (fs && fs.charger === c) c.status = fs.mode === 'charging' ? 'charging' : 'free'
    }
  }

  function syncTruck(ts) {
    const t = ts.t
    ts.box.x = ts.x
    ts.box.z = ts.z
    ts.box.h = ts.h
    if (ts.broken) return
    t.position.x = ts.x
    t.position.y = 0
    t.position.z = ts.z
    t.heading = ts.h
    t.speedKmh = Math.round(Math.abs(ts.v) * 3.6)

    let status = t.status
    switch (ts.phase) {
      case 'inbound': status = ts.stage === 'yard' ? 'docking' : ts.stage === 'gate' ? 'at_gate' : 'en_route'; break
      case 'pause':
      case 'reverse': status = 'docking'; break
      case 'docked': status = ts.dir === 'in' ? 'unloading' : 'loading'; break
      default: status = 'departing'
    }
    t.status = status

    const dock = ts.L.docks?.[t.dockId]
    if (ts.phase === 'inbound' || ts.phase === 'pause' || ts.phase === 'reverse') {
      const revLeft = ts.phase === 'inbound' ? ts.rev.len : ts.phase === 'pause' ? ts.rev.len : ts.rev.len - ts.rev.u
      const fwdLeft = ts.phase === 'inbound' ? Math.max(0, ts.path.len - ts.s) : 0
      t.distanceLeftM = Math.round(fwdLeft + revLeft)
      // time: road + yard + reverse (+ what is left of a gate stop)
      let sec = revLeft / REVERSE_SPEED
      if (ts.phase === 'inbound') {
        const road = Math.max(0, ts.waitS - ts.s)
        const yard = Math.max(0, ts.path.len - Math.max(ts.s, ts.waitS))
        sec += road / ROAD_SPEED + yard / YARD_SPEED + PULL_PAUSE
        if (ts.gatePause > ts.gateTimer) sec += ts.gatePause - ts.gateTimer
      } else if (ts.phase === 'pause') sec += ts.timer
      t.etaMin = Math.max(1, Math.round(sec / SEC_PER_MIN))
      t.target = dock ? { x: dock.x, z: dock.z } : null
      // remaining route for the ribbon: current position, then the vertices still ahead
      if (ts.phase === 'inbound') {
        const i = segIndex(ts.path, ts.s)
        if (i !== ts.pathIdx || !t.path || dist(t.path[0], ts) > 0.2) {
          ts.pathIdx = i
          const pts = [{ x: ts.x, z: ts.z }]
          for (let k = i + 1; k < ts.path.pts.length; k++) pts.push({ x: ts.path.pts[k].x, z: ts.path.pts[k].z })
          t.path = pts
        }
      } else if (!t.path || t.path.length !== 1 || dist(t.path[0], ts) > 0.2) {
        t.path = [{ x: ts.x, z: ts.z }]
      }
    } else if (ts.phase === 'docked') {
      t.distanceLeftM = 0
      t.etaMin = Math.max(1, Math.round(ts.etaBase - (clock - ts.etaBaseAt)))
      t.path = null
      t.target = null
    } else {
      t.distanceLeftM = ts.phase === 'outbound' ? Math.round(Math.max(0, ts.path.len - ts.s)) : 0
      const shp = db.shipment(t.shipmentId)
      t.etaMin = shp && ts.dir === 'out' && shp.eta?.delivered ? Math.max(1, Math.round(shp.eta.delivered - clock)) : 1
      t.path = null
      t.target = null
    }
    syncShipment(ts)
  }

  function syncShipment(ts) {
    const t = ts.t
    const shp = db.shipment(t.shipmentId)
    if (!shp || !shp.eta) return
    const left = Math.max(0, t.progress.total - t.progress.done) * ETA_PER_PALLET
    const docked = ts.phase === 'docked'
    const arriving = ts.phase === 'inbound' || ts.phase === 'pause' || ts.phase === 'reverse'
    if (ts.dir === 'in') {
      if (arriving) {
        shp.eta.arrive = Math.round(clock + t.etaMin)
        shp.eta.done = Math.round(clock + t.etaMin + left)
      } else if (docked) {
        shp.eta.done = Math.round(clock + t.etaMin)
      }
    } else if (arriving || docked) {
      const loadMin = docked ? t.etaMin : t.etaMin + left
      shp.eta.loaded = Math.round(clock + loadMin)
      shp.eta.transit = shp.eta.loaded + 6
      shp.eta.delivered = shp.eta.transit + Math.round(ts.legMin)
      if (arriving) shp.eta.arrive = Math.round(clock + t.etaMin)
    }
  }

  function syncForklift(fs) {
    const f = fs.f
    f.position.x = fs.x
    f.position.y = fs.y
    f.position.z = fs.z
    f.heading = fs.h
    f.speedKmh = round1(Math.abs(fs.v) * 3.6)
    if (fs.job || (fs.info && (f.carryingKind || f.carryingPalletId))) {
      f.status = fs.info?.status ?? 'loading'
      f.task = fs.info?.task ?? 'Working'
    } else if (fs.mode === 'charging') {
      f.status = 'charging'
      f.task = 'Charging at bay'
    } else if (fs.mode === 'toCharger') {
      f.status = 'moving'
      f.task = `Driving to charger ${fs.charger?.name ?? ''}`.trim()
    } else if (f.carryingKind || f.carryingPalletId) {
      f.status = 'moving'
      f.task = 'Putting away pallet'
    } else {
      f.status = 'idle'
      f.task = 'Waiting for work'
    }
    if (!fs.job) f.truckId = null
  }

  function syncDocks(site) {
    for (const [dockId, dk] of site.docks) {
      const d = dk.entity
      const ts = site.bookedBy.get(dockId)
      const status = ts?.t.status
      if (!ts || status === 'departing') {
        d.status = 'available'
        d.truckId = null
        d.bookedTruckId = null
        d.bookedInMin = null
        d.rearDoors = '—'
      } else if (status === 'en_route' || status === 'at_gate') {
        d.status = 'booked'
        d.truckId = null
        d.bookedTruckId = ts.id
        d.bookedInMin = ts.t.etaMin
        d.rearDoors = '—'
      } else if (status === 'docking') {
        d.status = 'docking'
        d.truckId = ts.id
        d.bookedTruckId = ts.id
        d.bookedInMin = ts.t.etaMin
        d.rearDoors = 'Closed'
      } else {
        d.status = status
        d.truckId = ts.id
        d.bookedTruckId = null
        d.bookedInMin = null
        d.rearDoors = 'Open'
      }
    }
  }

  // ═════════════════════════════ public ═════════════════════════════
  function setSpeed(mult) {
    const m = Number(mult)
    speed = Number.isFinite(m) ? clamp(m, 0, 50) : 1
  }

  const debug = {
    get clock() { return clock },
    get speed() { return speed },
    get errors() { return errorCount },
    sites, trucks: truckSim, forklifts: flSim, palletSim,
    forkReach: FORK_REACH,
  }

  try { boot() } catch (err) { report('boot', err) }
  return { update, setSpeed, debug }
}
