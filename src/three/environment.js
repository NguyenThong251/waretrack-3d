// The city around the five sites: ground, road grid (periwinkle asphalt, white dashes, sidewalks,
// crosswalks), lot paving, grass strips, fences, street trees, filler city (offices, white
// warehouses, blue depots, container yards, truck parking), site yard clutter (bay / slot
// outlines, charger pads, racks, pallets, containers, silos) and ambient traffic.
//
// Everything static is merged per material and per 150 m chunk (frustum + shadow culling);
// trees and bushes are instanced per variant and chunk. Truck, forklift and pallet clutter uses
// the toy scales from layout.js. createEnvironment(layouts) → { root, update(dt, elapsed) }.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { C, mat } from './palette.js'
import { canvasTexture, roundRect } from './canvasText.js'
import { ROADS, SIDEWALK_W, CITY_EXTENT, LANE_W, VEHICLE_SCALE, PALLET_SCALE, BAY, SLOT, roadHalfWidth, streetPath, pathLength, headingOf } from '../data/layout.js'
import { getTreeParts, createBush, createFence, createRack, createContainer, createSilo, createCityBuilding, createCrosswalk } from './models/props.js'
import { createPallet, rng } from './models/pallet.js'
import { createTruck } from './models/truck.js'
import { createWarehouse } from './models/warehouse.js'

const CHUNK = 150   // merge / instancing cell: small enough that the ±60 m shadow frustum culls most of the city
const Y_PAVE = 0.02
const Y_GRASS = 0.03
const Y_MARK = 0.045
const SIDEWALK_H = 0.14
const CARRIERS = ['waretrack', 'bluepeak', 'nordline', 'cargoviva']

// decals sit on the same plane family → pull them toward the camera instead of lifting them
const decal = (color, level, opts = {}) => mat(color, {
  roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -level, polygonOffsetUnits: -level * 2, ...opts,
})
const M = {
  ground: () => mat(C.ground, { roughness: 0.95 }),
  road: () => decal(C.road, 1),
  lot: () => decal(C.lot, 1),
  grass: () => decal(C.grass, 2),
  line: () => decal(C.roadLine, 3),
  yellow: () => decal(C.yellowLine, 4),
  sidewalk: () => mat(C.sidewalk, { roughness: 0.9 }),
  curb: () => mat(C.curb, { roughness: 0.9 }),
}

// ───────────────────────────── merging helpers ─────────────────────────────

const chunkKey = (x, z) => `${Math.floor((x + CITY_EXTENT) / CHUNK)}:${Math.floor((z + CITY_EXTENT) / CHUNK)}`

/** Collects static meshes and merges them per (material, shadow flags, chunk). */
class StaticBatch {
  constructor() {
    this.buckets = new Map()
    this._m = new THREE.Matrix4()
    this._p = new THREE.Vector3()
  }

  /** Add every mesh of an object (its current world transform). */
  addObject(obj) {
    obj.updateMatrixWorld(true)
    obj.getWorldPosition(this._p)
    const chunk = chunkKey(this._p.x, this._p.z)
    obj.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && o.visible) this.addGeometry(o.geometry, o.material, o.matrixWorld, o.castShadow, o.receiveShadow, chunk)
    })
  }

  /** Add one geometry with a world matrix. Geometry is cloned (shared caches stay untouched). */
  addGeometry(geometry, material, matrix, cast = true, receive = true, chunk = null) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    const keep = ['position', 'normal', 'uv']
    if (material.vertexColors) keep.push('color')
    for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name)
    if (!g.attributes.normal) g.computeVertexNormals()
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    if (material.vertexColors && !g.attributes.color) {
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3))
    }
    g.morphAttributes = {}
    g.clearGroups()
    if (matrix) g.applyMatrix4(matrix)
    if (chunk == null) {
      g.computeBoundingBox()
      g.boundingBox.getCenter(this._p)
      chunk = chunkKey(this._p.x, this._p.z)
    }
    const key = `${material.uuid}|${cast ? 1 : 0}${receive ? 1 : 0}|${chunk}|${material.vertexColors ? 'c' : ''}`
    if (!this.buckets.has(key)) this.buckets.set(key, { material, cast, receive, geos: [] })
    this.buckets.get(key).geos.push(g)
  }

  /** Convenience: a flat rectangle on XZ (centre x,z, size w×d, rotation about Y). */
  addRect(x, z, w, d, y, material, rot = 0, receive = true) {
    this.addGeometry(UNIT.rect, material, trs3(x, y, z, rot, w, 1, d), false, receive, chunkKey(x, z))
  }

  /** Convenience: a box whose bottom sits on y. */
  addBox(x, y, z, w, h, d, material, rot = 0, cast = true) {
    this.addGeometry(UNIT.box, material, trs3(x, y + h / 2, z, rot, w, h, d), cast, true, chunkKey(x, z))
  }

  build(name = 'static') {
    const group = new THREE.Group()
    group.name = name
    for (const { material, cast, receive, geos } of this.buckets.values()) {
      const merged = mergeGeometries(geos, false)
      for (const g of geos) g.dispose()
      if (!merged) continue
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, material)
      mesh.castShadow = cast
      mesh.receiveShadow = receive
      mesh.matrixAutoUpdate = false
      group.add(mesh)
    }
    this.buckets.clear()
    return group
  }
}

/** Collects instance transforms per (geometry, material, chunk) → InstancedMeshes. */
class Scatter {
  constructor() { this.sets = new Map() }

  add(geometry, material, matrix, { cast = true, receive = false } = {}) {
    const chunk = chunkKey(matrix.elements[12], matrix.elements[14])
    const key = `${geometry.uuid}|${material.uuid}|${chunk}`
    if (!this.sets.has(key)) this.sets.set(key, { geometry, material, cast, receive, matrices: [] })
    this.sets.get(key).matrices.push(matrix.clone())
  }

  build(name = 'instances') {
    const group = new THREE.Group()
    group.name = name
    for (const { geometry, material, cast, receive, matrices } of this.sets.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length)
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.castShadow = cast
      mesh.receiveShadow = receive
      group.add(mesh)
    }
    this.sets.clear()
    return group
  }
}

const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _v = new THREE.Vector3()
const _m4 = new THREE.Matrix4()
const UP = new THREE.Vector3(0, 1, 0)
function trs(x, y, z, rotY = 0, scale = 1) {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromAxisAngle(UP, rotY), _s.setScalar(scale))
}
/** Shared scratch matrix: translate · rotateY · scale(sx, sy, sz). */
function trs3(x, y, z, rotY, sx, sy, sz) {
  return _m4.compose(_v.set(x, y, z), _q.setFromAxisAngle(UP, rotY), _s.set(sx, sy, sz))
}
// unit primitives, non-indexed once so batching only has to clone + transform them
const UNIT = {
  rect: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).toNonIndexed(),
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
}

// ───────────────────────────── rect helpers ─────────────────────────────

const rect = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ })
const grow = (r, m) => rect(r.minX - m, r.maxX + m, r.minZ - m, r.maxZ + m)
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
const rw = (r) => r.maxX - r.minX
const rd = (r) => r.maxZ - r.minZ
const centre = (r) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 })

/** Largest piece of `r` left after cutting away `hole` (axis-aligned), or null. */
function carve(r, hole) {
  if (!overlaps(r, hole)) return r
  const pieces = [
    rect(r.minX, Math.min(r.maxX, hole.minX), r.minZ, r.maxZ),
    rect(Math.max(r.minX, hole.maxX), r.maxX, r.minZ, r.maxZ),
    rect(r.minX, r.maxX, r.minZ, Math.min(r.maxZ, hole.minZ)),
    rect(r.minX, r.maxX, Math.max(r.minZ, hole.maxZ), r.maxZ),
  ].filter((p) => rw(p) > 0 && rd(p) > 0)
  pieces.sort((a, b) => rw(b) * rd(b) - rw(a) * rd(a))
  return pieces[0] ?? null
}

// ───────────────────────────── road network ─────────────────────────────

const vRoads = ROADS.filter((r) => r.axis === 'z')
const hRoads = ROADS.filter((r) => r.axis === 'x')
const spans = (road, v) => v >= road.from - 0.01 && v <= road.to + 0.01

function intersections() {
  const out = []
  for (const v of vRoads) {
    for (const h of hRoads) {
      if (spans(v, h.at) && spans(h, v.at)) out.push({ v, h, x: v.at, z: h.at })
    }
  }
  return out
}

/** Intervals along `road` blocked by crossing roads on the given side (−1/+1, or 0 = carriageway). */
function blockedAlong(road, side, pad) {
  const others = road.axis === 'z' ? hRoads : vRoads
  const hw = roadHalfWidth(road)
  const out = []
  for (const o of others) {
    if (!spans(road, o.at) || !spans(o, road.at)) continue
    if (side !== 0) {
      // does the crossing road reach this side of `road`?
      const probe = road.at + side * (hw + SIDEWALK_W / 2)
      if (!spans(o, probe)) continue
    }
    const ohw = roadHalfWidth(o) + pad
    out.push([o.at - ohw, o.at + ohw])
  }
  return out.sort((a, b) => a[0] - b[0])
}

/** Free sub-intervals of [from, to] after removing blocked ones. */
function freeIntervals(from, to, blocked) {
  const out = []
  let cur = from
  for (const [a, b] of blocked) {
    if (b <= cur) continue
    if (a > cur) out.push([cur, Math.min(a, to)])
    cur = Math.max(cur, b)
    if (cur >= to) break
  }
  if (cur < to) out.push([cur, to])
  return out.filter(([a, b]) => b - a > 0.5)
}

/** Place a box/rect described along a road (u = along, w = across) into world XZ. */
function roadFrame(road, u, w) {
  return road.axis === 'z' ? { x: road.at + w, z: u } : { x: u, z: road.at + w }
}

function buildRoads(batch) {
  const roadMat = M.road(), lineMat = M.line(), walkMat = M.sidewalk(), curbMat = M.curb()
  const dash = 3.2, period = 9, lineW = 0.16
  for (const road of ROADS) {
    const hw = roadHalfWidth(road)
    const length = road.to - road.from
    const mid = (road.from + road.to) / 2
    const c = roadFrame(road, mid, 0)
    const along = road.axis === 'z'
    batch.addRect(c.x, c.z, along ? hw * 2 : length, along ? length : hw * 2, Y_PAVE, roadMat)

    // white dashed lane dividers, interrupted at intersections
    const blockedRoad = blockedAlong(road, 0, SIDEWALK_W + 1.5)
    for (let k = 1; k < road.lanes; k++) {
      const off = -hw + k * LANE_W
      for (const [a, b] of freeIntervals(road.from, road.to, blockedRoad)) {
        for (let u = a + 1; u + dash < b; u += period) {
          const p = roadFrame(road, u + dash / 2, off)
          batch.addRect(p.x, p.z, along ? lineW : dash, along ? dash : lineW, Y_MARK, lineMat)
        }
      }
    }

    // raised sidewalks with a darker curb on the road side
    for (const side of [-1, 1]) {
      for (const [a, b] of freeIntervals(road.from, road.to, blockedAlong(road, side, SIDEWALK_W))) {
        const p = roadFrame(road, (a + b) / 2, side * (hw + SIDEWALK_W / 2))
        const l = b - a
        batch.addBox(p.x, 0, p.z, along ? SIDEWALK_W : l, SIDEWALK_H, along ? l : SIDEWALK_W, walkMat, 0, false)
        const q = roadFrame(road, (a + b) / 2, side * (hw + 0.12))
        batch.addBox(q.x, 0, q.z, along ? 0.24 : l, SIDEWALK_H + 0.02, along ? l : 0.24, curbMat, 0, false)
      }
    }
  }

  // corner squares + crosswalks at every intersection
  for (const { v, h, x, z } of intersections()) {
    const hv = roadHalfWidth(v), hh = roadHalfWidth(h)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // both sidewalks are interrupted here only when both roads continue past this corner
        const reachesV = spans(v, z + sz * (hh + SIDEWALK_W / 2))
        const reachesH = spans(h, x + sx * (hv + SIDEWALK_W / 2))
        if (!reachesV || !reachesH) continue
        batch.addBox(x + sx * (hv + SIDEWALK_W / 2), 0, z + sz * (hh + SIDEWALK_W / 2), SIDEWALK_W, SIDEWALK_H, SIDEWALK_W, walkMat, 0, false)
      }
    }
    // crosswalks: across the horizontal road (east/west arms) and the vertical road (north/south arms)
    for (const s of [-1, 1]) {
      if (spans(h, x + s * (hv + 3))) addCrosswalk(batch, x + s * (hv + 2.2), z, hh * 2 - 1, 0)
      if (spans(v, z + s * (hh + 3))) addCrosswalk(batch, x, z + s * (hh + 2.2), hv * 2 - 1, Math.PI / 2)
    }
  }
}

function addCrosswalk(batch, x, z, roadWidth, rot) {
  const cw = createCrosswalk(3, roadWidth)
  cw.position.set(x, Y_MARK - 0.028, z)
  cw.rotation.y = rot
  cw.traverse((o) => { if (o.isMesh) o.material = M.line() })
  batch.addObject(cw)
}

// ───────────────────────────── vegetation ─────────────────────────────

// Same silhouettes as props.createTree, fewer segments: used for the thousands of city trees.
const LOW_TREE_BLOBS = [
  [[1.1, 1.3, 1.1, 0, 3.15, 0]],
  [[1.05, 1.22, 1.05, 0, 3.2, 0], [0.62, 0.58, 0.62, 0.72, 2.55, 0.42]],
  [[1.0, 1.12, 1.0, -0.18, 3.05, 0], [0.78, 0.86, 0.78, 0.5, 3.55, -0.25]],
  [[1.2, 1.15, 1.2, 0, 2.95, 0], [0.5, 0.46, 0.5, -0.78, 2.45, 0.5]],
]
const lowTrees = []
function lowTreeParts(variant) {
  if (!lowTrees[variant]) {
    const hi = getTreeParts(variant)
    const blobs = LOW_TREE_BLOBS[variant].map(([rx, ry, rz, x, y, z]) => {
      const g = new THREE.SphereGeometry(1, 12, 8)
      g.scale(rx, ry, rz)
      g.translate(x, y, z)
      return g
    })
    const trunk = new THREE.CylinderGeometry(0.07, 0.11, 2.6, 6)
    trunk.translate(0, 1.3, 0)
    lowTrees[variant] = { ...hi, canopy: mergeGeometries(blobs, false), trunk }
  }
  return lowTrees[variant]
}

/** Tree instance. detail → the props model (site lots); otherwise the low-poly city tree. */
function addTree(scatter, x, z, seed, size = 1, detail = false) {
  const r = rng(Math.round(x * 13 + z * 7 + seed))
  const variant = Math.floor(r() * 4)
  const parts = detail ? getTreeParts(variant) : lowTreeParts(variant)
  const m = trs(x, 0, z, r() * Math.PI * 2, size * (0.88 + r() * 0.26))
  scatter.add(parts.trunk, parts.trunkMaterial, m, { cast: true })
  scatter.add(parts.canopy, parts.canopyMaterial, m, { cast: true })
}

let bushParts = null
function addBush(scatter, x, z, seed) {
  if (!bushParts) {
    const mesh = createBush().children[0]
    bushParts = { geometry: mesh.geometry, material: mesh.material }
  }
  const r = rng(Math.round(x * 5 + z * 11 + seed))
  scatter.add(bushParts.geometry, bushParts.material, trs(x, Y_GRASS, z, r() * 6.3, 0.8 + r() * 0.6), { cast: true })
}

function treeLine(scatter, from, to, step, seed = 0, skip = () => false, detail = true) {
  const dx = to.x - from.x, dz = to.z - from.z
  const l = Math.hypot(dx, dz)
  const n = Math.max(1, Math.round(l / step))
  for (let i = 0; i <= n; i++) {
    const x = from.x + (dx * i) / n, z = from.z + (dz * i) / n
    if (!skip(x, z)) addTree(scatter, x, z, seed + i, 1, detail)
  }
}

// ───────────────────────────── site lots ─────────────────────────────

/** For each lot side: the parallel road whose sidewalk is close (→ grass strip, trees, fence). */
function roadFacingSides(lot) {
  const sides = []
  const check = (side, edge, axis, lo, hi) => {
    for (const road of axis === 'z' ? vRoads : hRoads) {
      const walk = road.at + (edge < road.at ? -1 : 1) * (roadHalfWidth(road) + SIDEWALK_W)
      const gap = Math.abs(walk - edge)
      const between = side === 'east' || side === 'south' ? walk > edge : walk < edge
      if (between && gap < 15 && spans(road, lo) && spans(road, hi)) sides.push({ side, edge, walk, road })
    }
  }
  check('east', lot.maxX, 'z', lot.minZ, lot.maxZ)
  check('west', lot.minX, 'z', lot.minZ, lot.maxZ)
  check('south', lot.maxZ, 'x', lot.minX, lot.maxX)
  check('north', lot.minZ, 'x', lot.minX, lot.maxX)
  return sides
}

/** Fence along a straight line with an optional gap (gate) centred at `gateAt` (along-coordinate). */
function fenceLine(batch, a, b, gate = null, gateWidth = 13) {
  const along = Math.abs(b.x - a.x) > Math.abs(b.z - a.z) ? 'x' : 'z'
  const u0 = along === 'x' ? a.x : a.z
  const u1 = along === 'x' ? b.x : b.z
  const pieces = gate == null ? [[u0, u1]] : [[u0, gate - gateWidth / 2], [gate + gateWidth / 2, u1]]
  for (const [p, q] of pieces) {
    const l = Math.abs(q - p)
    if (l < 2) continue
    const f = createFence(Math.round(l * 10) / 10)
    const start = Math.min(p, q)
    if (along === 'x') f.position.set(start, 0, a.z)
    else {
      f.position.set(a.x, 0, start + l)
      f.rotation.y = Math.PI / 2
    }
    batch.addObject(f)
  }
}

function buildLot(batch, scatter, L) {
  const { lot } = L
  batch.addRect((lot.minX + lot.maxX) / 2, (lot.minZ + lot.maxZ) / 2, rw(lot), rd(lot), Y_PAVE, M.lot())

  for (const s of roadFacingSides(lot)) {
    const horizontal = s.side === 'south' || s.side === 'north'
    const lo = horizontal ? lot.minX : lot.minZ
    const hi = horizontal ? lot.maxX : lot.maxZ
    const mid = (s.edge + s.walk) / 2
    const width = Math.abs(s.walk - s.edge)
    const gateAt = s.side === L.gateSide ? (horizontal ? L.gate.x : L.gate.z) : null
    // grass strip between the lot edge and the sidewalk, trees on it, fence on the lot edge
    if (horizontal) batch.addRect((lo + hi) / 2, mid, hi - lo, width, Y_GRASS, M.grass())
    else batch.addRect(mid, (lo + hi) / 2, width, hi - lo, Y_GRASS, M.grass())
    if (gateAt != null) {
      // paved driveway across the strip
      if (horizontal) batch.addRect(gateAt, mid, 13, width + 0.2, Y_GRASS, M.lot())
      else batch.addRect(mid, gateAt, width + 0.2, 13, Y_GRASS, M.lot())
    }
    const nearGate = (x, z) => gateAt != null && Math.abs((horizontal ? x : z) - gateAt) < 10
    const a = horizontal ? { x: lo + 4, z: mid } : { x: mid, z: lo + 4 }
    const b = horizontal ? { x: hi - 4, z: mid } : { x: mid, z: hi - 4 }
    if (width > 3) {
      treeLine(scatter, a, b, 12, L.id.length * 31, nearGate)
      const ba = horizontal ? { x: lo + 10, z: mid } : { x: mid, z: lo + 10 }
      const bb = horizontal ? { x: hi - 10, z: mid } : { x: mid, z: hi - 10 }
      const n = Math.round((hi - lo) / 23)
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n
        const x = ba.x + (bb.x - ba.x) * t, z = ba.z + (bb.z - ba.z) * t
        if (!nearGate(x, z)) addBush(scatter, x + (horizontal ? 0 : 0.9), z + (horizontal ? 0.9 : 0), i)
      }
    }
    if (L.openSides?.includes(s.side)) continue
    if (width <= 3) {
      // no room for a planted strip: sparse trees stand on the sidewalk outside the fence (12, 13)
      const walkMid = s.walk + Math.sign(s.road.at - s.walk) * SIDEWALK_W / 2
      const ta = horizontal ? { x: lo + 6, z: walkMid } : { x: walkMid, z: lo + 6 }
      const tb = horizontal ? { x: hi - 6, z: walkMid } : { x: walkMid, z: hi - 6 }
      treeLine(scatter, ta, tb, 26, L.id.length * 17, nearGate)
    }
    const fa = horizontal ? { x: lo, z: s.edge } : { x: s.edge, z: lo }
    const fb = horizontal ? { x: hi, z: s.edge } : { x: s.edge, z: hi }
    fenceLine(batch, fa, fb, gateAt)
  }
}

/** Painted rectangle outline (w across, l along heading) centred at x,z — yellow site bays by default. */
function outline(batch, x, z, w, l, heading, y = 0, line = 0.18, material = M.yellow()) {
  const parts = [
    [0, l / 2 - line / 2, w, line], [0, -l / 2 + line / 2, w, line],
    [w / 2 - line / 2, 0, line, l], [-w / 2 + line / 2, 0, line, l],
  ]
  const c = Math.cos(heading), s = Math.sin(heading)
  for (const [ox, oz, pw, pd] of parts) {
    // local (ox, oz) rotated by heading about Y
    const px = x + ox * c + oz * s
    const pz = z - ox * s + oz * c
    batch.addRect(px, pz, pw, pd, y + Y_MARK, material, heading)
  }
}

let padTexture = null
function chargerPad(p) {
  padTexture ??= canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.12, w / 2, h / 2, w * 0.56)
    g.addColorStop(0, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.65, 'rgba(255,255,255,0.7)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    roundRect(ctx, 6, 6, w - 12, h - 12, 60)
    ctx.fill()
  })
  const material = new THREE.MeshBasicMaterial({
    map: padTexture, color: C.grassGlow, transparent: true, opacity: 0.85, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w + 3, p.d + 3).rotateX(-Math.PI / 2), material)
  mesh.position.set(p.x, (p.y ?? 0) + Y_MARK, p.z)
  mesh.rotation.y = p.heading ?? 0
  mesh.renderOrder = 1
  mesh.name = 'charger-pad'
  return mesh
}

function palletBlock(batch, d) {
  const c = Math.cos(d.heading ?? 0), s = Math.sin(d.heading ?? 0)
  let seed = Math.round(d.x * 3 + d.z)
  for (let i = 0; i < d.cols; i++) {
    for (let j = 0; j < d.rows; j++) {
      const ox = (i - (d.cols - 1) / 2) * d.gap
      const oz = (j - (d.rows - 1) / 2) * d.gap * 0.9
      const p = createPallet({ kind: d.kind, layers: d.layers ?? 2, seed: seed++ })
      p.scale.setScalar(PALLET_SCALE)
      p.position.set(d.x + ox * c + oz * s, d.y ?? 0, d.z - ox * s + oz * c)
      p.rotation.y = (d.heading ?? 0) + (rng(seed)() - 0.5) * 0.12
      batch.addObject(p)
    }
  }
}

function buildDecor(batch, scatter, L) {
  for (const d of L.decor) {
    switch (d.type) {
      case 'container': {
        const c = createContainer({ label: d.label, color: d.color ?? C.container })
        c.position.set(d.x, 0, d.z)
        c.rotation.y = d.heading ?? 0
        batch.addObject(c)
        break
      }
      case 'rack': {
        const r = createRack({ bays: d.bays, levels: d.levels, fill: 0.85, seed: Math.round(d.x) })
        r.position.set(d.x, 0, d.z)
        r.rotation.y = d.heading ?? 0
        batch.addObject(r)
        break
      }
      case 'silo': {
        const s = createSilo({ radius: d.radius, height: d.height })
        s.position.set(d.x, 0, d.z)
        batch.addObject(s)
        break
      }
      case 'pallets':
        palletBlock(batch, d)
        break
      case 'grass':
        batch.addRect((d.minX + d.maxX) / 2, (d.minZ + d.maxZ) / 2, d.maxX - d.minX, d.maxZ - d.minZ, Y_GRASS, M.grass())
        break
      case 'treeRow':
        treeLine(scatter, d.from, d.to, d.step, Math.round(d.from.x))
        break
      case 'bushes': {
        const n = Math.max(1, Math.round(Math.hypot(d.to.x - d.from.x, d.to.z - d.from.z) / d.step))
        for (let i = 0; i <= n; i++) {
          addBush(scatter, d.from.x + ((d.to.x - d.from.x) * i) / n, d.from.z + ((d.to.z - d.from.z) * i) / n, i)
        }
        break
      }
    }
  }
}

function buildSiteMarkings(batch, L, root) {
  for (const p of Object.values(L.docks)) {
    const narrow = !!L.platform   // cold store: tight bays from the platform edge (frame 19)
    outline(batch, p.x, p.z, narrow ? BAY.w - 0.5 : BAY.w, narrow ? BAY.l - 1 : BAY.l, p.heading)
  }
  for (const s of Object.values(L.slots)) outline(batch, s.x, s.z, SLOT.w, SLOT.l, s.heading, s.y ?? 0, 0.12)
  for (const p of L.parking) outline(batch, p.x, p.z, BAY.w, BAY.l, p.heading)
  if (L.chargerPad) root.add(chargerPad(L.chargerPad))
}

// ───────────────────────────── filler city ─────────────────────────────

/** Blue-roofed depot like WH-01 (white walls, blue gable roof halves). */
function blueDepot(batch, x, z, w, d, h, rot = 0) {
  const g = new THREE.Group()
  const wall = createCityBuilding({ w, d, h: h * 0.8, style: 'warehouse', seed: Math.round(x + z) })
  g.add(wall)
  const roofMat = mat(C.blue, { roughness: 0.6 })
  const rise = Math.min(3, d * 0.12)
  const slope = Math.atan2(rise, d / 2)
  const len = Math.hypot(d / 2, rise) + 0.4
  for (const s of [-1, 1]) {
    const half = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.35, len), roofMat)
    half.position.set(0, h * 0.8 + rise / 2, (s * d) / 4)
    half.rotation.x = s * slope
    half.castShadow = half.receiveShadow = true
    g.add(half)
  }
  g.position.set(x, 0, z)
  g.rotation.y = rot
  batch.addObject(g)
}

const CONTAINER_COLORS = [C.blue, C.blueMid, 0x5a7cf0, C.blue, C.container, 0xeef1f8, C.blueDark]

/** Low-poly container for distant yards: body box + darker top frame (2 merged boxes). */
function simpleContainer(batch, x, y, z, color, rot = 0) {
  batch.addBox(x, y, z, 12.2, 2.45, 2.44, mat(color, { roughness: 0.7 }), rot)
  batch.addBox(x, y + 2.45, z, 12.2, 0.14, 2.44, mat(C.blueDark, { roughness: 0.7 }), rot)
}

function containerYard(batch, r, seed, { detailed = false, sparse = 0.12 } = {}) {
  const rand = rng(seed)
  batch.addRect(centre(r).x, centre(r).z, rw(r), rd(r), Y_PAVE, M.lot())
  const cols = Math.max(1, Math.floor((rw(r) - 6) / 14))
  const rows = Math.max(1, Math.floor((rd(r) - 6) / 3.2))
  for (let i = 0; i < cols; i++) {
    if (sparse > 0.2 && i % 3 === 2) continue   // sparse yards keep a truck lane every third column
    for (let j = 0; j < rows; j++) {
      if ((j + 1) % 5 === 0 || rand() < sparse) continue
      const levels = 1 + Math.floor(rand() * 3)
      const color = CONTAINER_COLORS[Math.floor(rand() * CONTAINER_COLORS.length)]
      for (let k = 0; k < levels; k++) {
        const x = r.minX + 10 + i * 14, y = k * 2.6, z = r.minZ + 4 + j * 3.2
        if (!detailed) {
          simpleContainer(batch, x, y, z, color)
          continue
        }
        const c = createContainer({ color, label: rand() < 0.35 ? 'MAERA LINE' : null })
        c.position.set(x, y, z)
        batch.addObject(c)
      }
    }
  }
}

function truckParking(batch, r, seed, facing = 0) {
  const rand = rng(seed)
  batch.addRect(centre(r).x, centre(r).z, rw(r), rd(r), Y_PAVE, M.lot())
  const step = BAY.w + 0.6
  const bays = Math.floor((rw(r) - 6) / step)
  const rows = rd(r) > BAY.l * 2 + 6 ? 2 : 1
  for (let row = 0; row < rows; row++) {
    const z = rows === 2 ? (row === 0 ? r.minZ + BAY.l / 2 + 1.5 : r.maxZ - BAY.l / 2 - 1.5) : centre(r).z
    const heading = rows === 2 ? (row === 0 ? Math.PI : 0) : facing
    for (let i = 0; i < bays; i++) {
      const x = r.minX + 5 + i * step
      outline(batch, x, z, BAY.w, BAY.l, heading, 0, 0.18, M.line())   // public lots: white lines (frame 05)
      if (rand() < 0.55) parkedTruck(batch, x, z, heading, CARRIERS[Math.floor(rand() * 4)], rand() < 0.2)
    }
  }
}

const parkedTrucks = new Map()
const MAX_PARKED = 40
let parkedCount = 0
/** A static truck merged into the batch (one template per livery). Capped city-wide. */
function parkedTruck(batch, x, z, heading, carrier, reefer = false) {
  if (parkedCount++ >= MAX_PARKED) return
  const key = `${carrier}|${reefer}`
  if (!parkedTrucks.has(key)) parkedTrucks.set(key, createTruck({ carrier, reefer }))
  const t = parkedTrucks.get(key)
  t.scale.setScalar(VEHICLE_SCALE)
  t.position.set(x, 0, z)
  t.rotation.y = heading
  batch.addObject(t)
}

function cityParcel(batch, scatter, r, rand, nearSite) {
  const roll = rand()
  const w = rw(r), d = rd(r)
  const c = centre(r)
  const pick = nearSite
    ? (roll < 0.45 ? 'office' : roll < 0.76 ? 'warehouse' : roll < 0.86 ? 'block' : roll < 0.93 ? 'parking' : 'park')
    : (roll < 0.38 ? 'office' : roll < 0.68 ? 'warehouse' : roll < 0.8 ? 'block' : roll < 0.85 ? 'containers' : roll < 0.9 ? 'parking' : roll < 0.92 ? 'depot' : 'park')
  if (pick === 'park' || w < 22 || d < 20) {
    batch.addRect(c.x, c.z, w, d, Y_GRASS, M.grass())
    const n = Math.max(2, Math.floor((w * d) / 420))
    for (let i = 0; i < n; i++) addTree(scatter, r.minX + 3 + rand() * (w - 6), r.minZ + 3 + rand() * (d - 6), i)
    return
  }
  if (pick === 'containers' && w > 40 && d > 30) return containerYard(batch, r, Math.round(c.x * 7 + c.z))
  if (pick === 'parking' && w > 36 && d > 22) return truckParking(batch, r, Math.round(c.x + c.z * 3))
  batch.addRect(c.x, c.z, w, d, Y_PAVE, M.lot())
  if (pick === 'depot') {
    blueDepot(batch, c.x, c.z - d * 0.1, Math.min(60, w * 0.8), Math.min(34, d * 0.6), 9 + rand() * 3)
    return
  }
  if (pick === 'warehouse') {
    const bw = Math.min(70, w * (0.65 + rand() * 0.2)), bd = Math.min(46, d * (0.5 + rand() * 0.15))
    const b = createCityBuilding({ w: bw, d: bd, h: 8 + rand() * 4, style: 'warehouse', seed: Math.round(c.x * 3 + c.z) })
    b.position.set(c.x, 0, r.minZ + bd / 2 + 3)
    batch.addObject(b)
    if (rand() < 0.45) parkedTruck(batch, c.x - bw / 4, r.minZ + bd + 10, 0, CARRIERS[Math.floor(rand() * 4)])
    return
  }
  // office / block: one or two towers + trees at the front
  const tall = pick === 'block'
  const n = w > 60 && rand() < 0.6 ? 2 : 1
  for (let i = 0; i < n; i++) {
    const bw = Math.min(42, (w / n) * (0.6 + rand() * 0.2))
    const bd = Math.min(34, d * (0.45 + rand() * 0.25))
    const h = tall ? 20 + rand() * 26 : 10 + rand() * 16
    const b = createCityBuilding({ w: bw, d: bd, h, style: tall ? 'block' : 'office', seed: Math.round(c.x * 7 + c.z * 3 + i) })
    b.position.set(r.minX + (w / n) * (i + 0.5), 0, c.z - d * 0.08)
    batch.addObject(b)
  }
  for (let x = r.minX + 5; x < r.maxX - 4; x += 11) addTree(scatter, x, r.maxZ - 3, Math.round(x))
}

/** City blocks between the roads (shrunk by road + sidewalk + a 4 m apron). */
function cityBlocks() {
  const inset = (list, at) => {
    const road = list.find((r) => r.at === at)
    return road ? roadHalfWidth(road) + SIDEWALK_W + 4 : 0
  }
  const E = CITY_EXTENT
  const zs = [-E, ...hRoads.map((h) => h.at), E].sort((a, b) => a - b)
  const blocks = []
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i], z1 = zs[i + 1]
    const midZ = (z0 + z1) / 2
    const xs = [-E, ...vRoads.filter((v) => spans(v, midZ)).map((v) => v.at), E].sort((a, b) => a - b)
    for (let j = 0; j < xs.length - 1; j++) {
      const r = rect(xs[j] + inset(vRoads, xs[j]), xs[j + 1] - inset(vRoads, xs[j + 1]), z0 + inset(hRoads, z0), z1 - inset(hRoads, z1))
      if (rw(r) > 20 && rd(r) > 20) blocks.push(r)
    }
  }
  return blocks
}

/** Hand-placed city features near the sites (frames 05, 22). */
function landmarkFeatures(batch, scatter) {
  // truck parking lot west of WH-01 (frame 05)
  const park = rect(-150, -64, -40, 40)
  truckParking(batch, rect(park.minX, park.maxX, park.minZ, park.minZ + 30), 501)
  truckParking(batch, rect(park.minX, park.maxX, park.maxZ - 30, park.maxZ), 502)
  batch.addRect(centre(park).x, centre(park).z, rw(park), 20, Y_PAVE, M.lot())
  treeLine(scatter, { x: park.maxX + 5, z: park.minZ }, { x: park.maxX + 5, z: park.maxZ }, 13, 7)
  // container stacks + a small blue depot with its own yard east of WH-05 (frame 22)
  containerYard(batch, rect(570, 684, 136, 246), 911, { sparse: 0.3 })
  const depot = rect(566, 690, 262, 382)
  batch.addRect(centre(depot).x, centre(depot).z, rw(depot), rd(depot), Y_PAVE, M.lot())
  const hall = createWarehouse({ variant: 'depot', width: 34, depth: 20, height: 11, label: 'NL', sign: 'Nordline', subtitle: 'Eastside depot' })
  hall.position.set(628, 0, 296)
  batch.addObject(hall)
  const box = createContainer({ color: C.container, label: 'MAERA LINE' })
  box.position.set(596, 0, 312)
  batch.addObject(box)
  palletBlock(batch, { x: 612, z: 316, heading: 0, kind: 'cardboard', cols: 3, rows: 1, gap: 3.4, layers: 2 })
  palletBlock(batch, { x: 640, z: 318, heading: 0, kind: 'blue', cols: 2, rows: 1, gap: 3.2, layers: 2 })
  for (let i = 0; i < 3; i++) parkedTruck(batch, 650 + i * 5.6, 334 + i * 1.5, 0, CARRIERS[i + 1])
  return [park, rect(566, 690, 130, 382)]
}

function buildCity(batch, scatter, layouts) {
  const reserved = [
    ...layouts.map((L) => grow(L.lot, 6)),
    ...landmarkFeatures(batch, scatter).map((r) => grow(r, 4)),
  ]
  const siteCentres = layouts.map((L) => centre(L.lot))
  for (const block of cityBlocks()) {
    const cols = Math.max(1, Math.round(rw(block) / 72))
    const rows = Math.max(1, Math.round(rd(block) / 62))
    const cw = rw(block) / cols, cd = rd(block) / rows
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        let r = rect(block.minX + i * cw + 4, block.minX + (i + 1) * cw - 4, block.minZ + j * cd + 4, block.minZ + (j + 1) * cd - 4)
        for (const hole of reserved) {
          if (!r) break
          r = carve(r, hole)
        }
        if (!r || rw(r) < 16 || rd(r) < 16) continue
        const c = centre(r)
        const rand = rng(Math.round(c.x * 17 + c.z * 31))
        const near = siteCentres.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 260)
        cityParcel(batch, scatter, r, rand, near)
      }
    }
  }
}

/** Sparse street trees along sidewalks away from the lots. */
function streetTrees(scatter, layouts) {
  const lots = layouts.map((L) => grow(L.lot, 16))
  for (const road of ROADS) {
    const hw = roadHalfWidth(road)
    for (const side of [-1, 1]) {
      for (const [a, b] of freeIntervals(road.from, road.to, blockedAlong(road, side, SIDEWALK_W + 6))) {
        for (let u = a + 6; u < b - 4; u += 24) {
          const p = roadFrame(road, u, side * (hw + SIDEWALK_W + 1.6))
          if (Math.abs(p.x) > 760 || Math.abs(p.z - 100) > 700) continue
          if (lots.some((l) => p.x > l.minX && p.x < l.maxX && p.z > l.minZ && p.z < l.maxZ)) continue
          if (rng(Math.round(u * 3 + road.at))() < 0.45) continue
          addTree(scatter, p.x, p.z, Math.round(u))
        }
      }
    }
  }
}

// ───────────────────────────── ambient traffic ─────────────────────────────

// Each loop starts mid-way along its first edge; `start` shifts the first truck along the loop.
// The WH-01 block loop sends a truck south past the depot's east gable at load (frame 01).
const LOOPS = [
  { corners: [[28.5, -150], [28.5, 115], [-175, 115], [-175, -150]], trucks: 3, speed: 9, start: 0, jitter: 0, carriers: ['bluepeak', 'nordline', 'cargoviva'] },
  { corners: [[-175, -150], [700, -150], [700, 388], [-175, 388]], trucks: 3, speed: 11 },
  { corners: [[880, -430], [-430, -430], [-430, 650], [880, 650]], trucks: 2, speed: 12 },
  { corners: [[222, 115], [222, 650], [552, 650], [552, 115]], trucks: 2, speed: 10 },
]

function createTraffic() {
  const group = new THREE.Group()
  group.name = 'ambient-traffic'
  const movers = []
  LOOPS.forEach((loop, li) => {
    const path = streetPath(loop.corners.map(([x, z]) => ({ x, z })), LANE_W / 2, { closed: true, radius: 12 })
    const cum = [0]
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z))
    const total = pathLength(path)
    for (let i = 0; i < loop.trucks; i++) {
      const r = rng(li * 97 + i * 13)
      const carrier = loop.carriers?.[i] ?? CARRIERS[(li + i) % 4]
      const truck = createTruck({ carrier, reefer: r() < 0.2 })
      truck.name = 'ambient-truck'
      truck.scale.setScalar(VEHICLE_SCALE)
      group.add(truck)
      const s = ((loop.start ?? 0) + (total * (i + r() * (loop.jitter ?? 0.4))) / loop.trucks) % total
      movers.push({ truck, path, cum, total, s, speed: loop.speed * (0.9 + r() * 0.2), seg: 1 })
    }
  })

  const wheelRadius = (truck) => {
    const w = truck.userData.wheels?.[0]
    return (w?.userData.radius ?? 0.5) * VEHICLE_SCALE
  }
  for (const m of movers) m.r = wheelRadius(m.truck)

  function update(dt) {
    for (const m of movers) {
      const step = m.speed * dt
      m.s = (m.s + step) % m.total
      // advance the segment cursor (paths are short polylines; keep it monotonic with wrap)
      if (m.s < m.cum[m.seg - 1]) m.seg = 1
      while (m.seg < m.path.length - 1 && m.cum[m.seg] < m.s) m.seg++
      const a = m.path[m.seg - 1], b = m.path[m.seg]
      const l = m.cum[m.seg] - m.cum[m.seg - 1] || 1
      const k = (m.s - m.cum[m.seg - 1]) / l
      m.truck.position.set(a.x + (b.x - a.x) * k, 0, a.z + (b.z - a.z) * k)
      m.truck.rotation.y = headingOf({ x: b.x - a.x, z: b.z - a.z })
      for (const w of m.truck.userData.wheels ?? []) w.rotation.x += step / m.r
    }
  }
  update(0)
  return { group, update }
}

// ───────────────────────────── public ─────────────────────────────

/**
 * Build the whole static city + site yard dressing for the given site layouts.
 * @param {object[]} layouts  siteLayout() objects (after refineSiteDocks)
 */
export function createEnvironment(layouts) {
  const root = new THREE.Group()
  root.name = 'environment'
  const batch = new StaticBatch()
  const scatter = new Scatter()

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY_EXTENT * 2 + 1400, CITY_EXTENT * 2 + 1400).rotateX(-Math.PI / 2), M.ground())
  ground.receiveShadow = true
  ground.name = 'ground'
  ground.matrixAutoUpdate = false
  root.add(ground)

  buildRoads(batch)
  for (const L of layouts) {
    buildLot(batch, scatter, L)
    buildSiteMarkings(batch, L, root)
    buildDecor(batch, scatter, L)
  }
  buildCity(batch, scatter, layouts)
  streetTrees(scatter, layouts)

  root.add(batch.build('static-city'))
  root.add(scatter.build('trees'))
  const traffic = createTraffic()
  root.add(traffic.group)

  return {
    root,
    update(dt) { traffic.update(dt) },
  }
}
