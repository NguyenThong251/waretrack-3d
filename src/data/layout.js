// World layout of the five WareTrack sites and the public road network around them.
//
// Everything is in WORLD metres (Y up, ground y = 0). A pose's heading h ⇒ object.rotation.y = h,
// forward = (sin h, 0, cos h) — vehicle models face +Z.  Consumers: world.js (meshes),
// environment.js (city + yard decor) and the simulation (routes and poses). See SPEC §5.
//
// Besides the SPEC §5 fields every siteLayout() also carries a few extras:
//   centre        {x,z}                  building centre (origin = the site's lot centre)
//   lot           {minX,maxX,minZ,maxZ}  paved, fenced site lot
//   gateSide      'north'|'south'|'east'|'west'  fence side the gate is on
//   openSides     ['east', …]             lot sides left unfenced (yard opens onto the street)
//   dockNormals   { [dockId]: {x,z} }     outward unit normal of the dock door
//   dockAnchors   { [dockId]: {x,z} }     ground point just outside the door / platform edge
//   dockExit      { [dockId]: [{x,z}…] }  docked pose → forward out of the bay → gate
//   cabinets      { [chargerId]: pose }   charger cabinet pose (faces its forklift)
//   chargerPad    { x, z, w, d, heading, y }  green glow pad under the charging area
//   platform      null | { height, x0, x1, z0, z1, edge, apron }  raised dock platform (WH-03)
//   decor         [{ type, … }]           static yard clutter, built by environment.js
//
// CONTRACT-GAP: forklift-related poses (dockWork / slots / chargers / cabinets) carry an optional
// `y` (raised platform at WH-03 — forklifts work on the 1.3 m loading platform like frame 19).
// Movers should keep `position.y = pose.y ?? 0`.
import { SITES, DOCKS, CHARGERS } from './mockData.js'

// ───────────────────────────── toy scale ─────────────────────────────
// The reference video draws vehicles and cargo "toy-sized" next to compact buildings: trucks are a
// little oversized, forklifts more so, and a loaded pallet is about twice its real size (nearly a
// dock door wide). Models stay in real metres; world.js / environment.js scale every instance and
// all yard spacing below is derived from the scaled sizes.
// CONTRACT-GAP: SPEC §4 gives real-world model sizes only; these scales are a world-module choice.
export const VEHICLE_SCALE = 1.15    // trucks (site, parked and ambient)
export const FORKLIFT_SCALE = 1.4
export const PALLET_SCALE = 2.0
export const CHARGER_SCALE = 1.4
export const PIN_SCALE = 1.25
const V = VEHICLE_SCALE
const F = FORKLIFT_SCALE
const P = PALLET_SCALE

export const LANE_W = 4
const OUTER_LANE = 1.5 * LANE_W      // centre of the curb-side lane of a 4-lane road
const TRUCK_REAR = 5.25 * V          // truck origin → rear bumper
const FORK_HALF_L = 1.75 * F         // forklift origin → rear / fork tips
const DOCK_GAP = 2 * FORK_HALF_L + 2.4 // door anchor → truck rear: a forklift works in this gap (frames 10, 23)
const PLATFORM_GAP = 0.3             // truck rear → platform anchor (cold store)
const TURN_R = 7                     // yard turn radius
const LANE_OUT = TRUCK_REAR + 5.5    // approach lane distance in front of the docked pose
const PULL_OUT = LANE_OUT + TURN_R   // pull-forward point: one turn radius beyond the lane
const EXIT_OUT = LANE_OUT + 4.5      // exit lane distance in front of the docked pose
const ROAD_TURN_R = 11               // street-corner turn radius
const CAB_DIST = FORK_HALF_L + 0.55 + 0.25 * CHARGER_SCALE // forklift centre → cabinet centre
const CHARGER_STEP = 1.15 * F + 0.95 // spacing between forklift parking spots at a charger row
const PLATFORM_H = 1.3
// Site cameras: the frames are shot lower than SPEC §3's 50° — fitting the camera to building
// corners measured in frames 01 and 21 gives ≈ 1.1 rad from vertical (≈ 27° elevation).
const SITE_POLAR = 1.1

/** Painted outlines: truck bay (width × length) and pallet slot, in scaled metres. */
export const BAY = { w: 2.5 * V + 1.2, l: 10.5 * V + 2.5 }
export const SLOT = { w: 1.2 * P + 0.5, l: 1.0 * P + 0.5 }
const SLOT_STEP = { x: SLOT.w + 0.7, z: SLOT.l + 0.8 }

// ───────────────────────────── road network ─────────────────────────────
// axis 'z' → road runs north–south at x = at; axis 'x' → runs east–west at z = at.
export const ROADS = [
  { id: 'V6', axis: 'z', at: -430, from: -900, to: 900, lanes: 2 },
  { id: 'V0', axis: 'z', at: -175, from: -900, to: 900, lanes: 4 },
  { id: 'V1', axis: 'z', at: 28.5, from: -900, to: 115, lanes: 4 },
  { id: 'V2', axis: 'z', at: 222, from: -900, to: 900, lanes: 4 },
  { id: 'V3', axis: 'z', at: 378, from: -900, to: 900, lanes: 4 },
  { id: 'V4', axis: 'z', at: 552, from: 115, to: 900, lanes: 4 },
  { id: 'V5', axis: 'z', at: 700, from: -900, to: 900, lanes: 4 },
  { id: 'V7', axis: 'z', at: 880, from: -900, to: 900, lanes: 2 },
  { id: 'H3', axis: 'x', at: -430, from: -900, to: 900, lanes: 2 },
  { id: 'H0', axis: 'x', at: -150, from: -900, to: 900, lanes: 4 },
  { id: 'H1', axis: 'x', at: 115, from: -900, to: 900, lanes: 4 },
  { id: 'H2', axis: 'x', at: 388, from: -900, to: 900, lanes: 4 },
  { id: 'H4', axis: 'x', at: 650, from: -900, to: 900, lanes: 4 },
]

export const SIDEWALK_W = 3.5
export const CITY_EXTENT = 900
export const roadHalfWidth = (road) => (road.lanes * LANE_W) / 2

// ───────────────────────────── small 2D helpers ─────────────────────────────
const pt = (x, z) => ({ x, z })
const pose = (x, z, heading, y = 0) => ({ x, z, heading, y })
const sub = (a, b) => pt(a.x - b.x, a.z - b.z)
const add = (a, b, s = 1) => pt(a.x + b.x * s, a.z + b.z * s)
const len = (a) => Math.hypot(a.x, a.z)
const norm = (a) => { const l = len(a) || 1; return pt(a.x / l, a.z / l) }
const cross = (a, b) => a.x * b.z - a.z * b.x
const right = (d) => pt(-d.z, d.x)                    // right-hand side of a heading
export const headingOf = (d) => Math.atan2(d.x, d.z)
/** Wrap an angle into (-π, π]. */
export const wrapAngle = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2))
const round = (p) => pt(Math.round(p.x * 100) / 100, Math.round(p.z * 100) / 100)

/** Offset a rectilinear centreline to driving lanes. offsets[i] = right-hand offset of segment i. */
function laneLine(corners, offsets) {
  const segs = []
  for (let i = 0; i < corners.length - 1; i++) {
    const d = norm(sub(corners[i + 1], corners[i]))
    segs.push({ p: add(corners[i], right(d), offsets[i]), d })
  }
  const out = [segs[0].p]
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1], b = segs[i]
    const den = cross(a.d, b.d)
    if (Math.abs(den) < 1e-6) { out.push(b.p); continue }
    const t = cross(sub(b.p, a.p), b.d) / den
    out.push(add(a.p, a.d, t))
  }
  const last = segs[segs.length - 1]
  out.push(add(corners[corners.length - 1], right(last.d), offsets[offsets.length - 1]))
  return out
}

/** Round every interior corner of a polyline with an arc (radius clamped to the segment lengths). */
function fillet(points, radius, step = 2) {
  if (points.length < 3) return points.map(round)
  const out = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1]
    const u = norm(sub(b, a)), v = norm(sub(c, b))
    const turn = Math.atan2(Math.abs(cross(u, v)), u.x * v.x + u.z * v.z)
    if (turn < 0.02) { out.push(b); continue }
    const half = Math.tan(turn / 2)
    const maxT = Math.min(len(sub(b, a)), len(sub(c, b))) * 0.5
    const r = Math.min(radius, maxT / half)
    const t = r * half
    const p1 = add(b, u, -t)
    const s = Math.sign(cross(u, v))
    const centre = add(p1, pt(-u.z * s, u.x * s), r)
    const rel = sub(p1, centre)
    const n = Math.max(2, Math.ceil((turn * r) / step))
    for (let k = 0; k <= n; k++) {
      const ang = s * turn * (k / n)
      const ca = Math.cos(ang), sa = Math.sin(ang)
      out.push(pt(centre.x + rel.x * ca - rel.z * sa, centre.z + rel.x * sa + rel.z * ca))
    }
  }
  out.push(points[points.length - 1])
  return dedupe(out).map(round)
}

function dedupe(points) {
  return points.filter((p, i) => i === 0 || len(sub(p, points[i - 1])) > 0.05)
}

const street = (corners, offsets) => fillet(laneLine(corners, offsets), ROAD_TURN_R)

/**
 * Drivable lane polyline along road centreline corners (offset to the right by `offset` metres,
 * corners rounded). closed → loop that starts and ends mid-way along the first edge.
 */
export function streetPath(corners, offset = LANE_W / 2, { closed = false, radius = ROAD_TURN_R } = {}) {
  let pts = corners
  if (closed) {
    const mid = pt((corners[0].x + corners[1].x) / 2, (corners[0].z + corners[1].z) / 2)
    pts = [mid, ...corners.slice(1), corners[0], mid]
  }
  return fillet(laneLine(pts, pts.slice(1).map(() => offset)), radius)
}
const yard = (points) => fillet(points, TURN_R, 1.5)

export function pathLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += len(sub(points[i], points[i - 1]))
  return total
}

/** Point + heading at arc length s along a polyline (clamped). */
export function pointAlong(points, s) {
  let rest = Math.max(0, s)
  for (let i = 1; i < points.length; i++) {
    const seg = sub(points[i], points[i - 1])
    const l = len(seg)
    if (rest <= l || i === points.length - 1) {
      const k = l ? Math.min(1, rest / l) : 0
      return { x: points[i - 1].x + seg.x * k, z: points[i - 1].z + seg.z * k, heading: headingOf(seg) }
    }
    rest -= l
  }
  const p = points[0]
  return { x: p.x, z: p.z, heading: 0 }
}

// ───────────────────────────── building geometry ─────────────────────────────
// Door `offset` is measured from the face centre along local +X (south/north faces) or local +Z
// (east/west faces). World.js later refines every dock from the model's real doorAnchors.
const FACE = {
  south: { n: pt(0, 1), t: pt(1, 0) },
  north: { n: pt(0, -1), t: pt(1, 0) },
  east: { n: pt(1, 0), t: pt(0, 1) },
  west: { n: pt(-1, 0), t: pt(0, 1) },
}

const rotate = (p, a) => pt(p.x * Math.cos(a) + p.z * Math.sin(a), -p.x * Math.sin(a) + p.z * Math.cos(a))

/** Analytic door anchor (world) for a door of a building spec placed at centre/rotY. */
function doorAnchor(building, centre, rotY, door, platformDepth = 0) {
  const f = FACE[door.side]
  const halfN = door.side === 'south' || door.side === 'north' ? building.depth / 2 : building.width / 2
  const local = add(add(pt(0, 0), f.n, halfN + platformDepth + 0.6), f.t, door.offset)
  return { position: add(centre, rotate(local, rotY)), normal: rotate(f.n, rotY) }
}

// ───────────────────────────── site definitions ─────────────────────────────
// doors are oversized like the vehicles: in the frames a dock door is about as tall as a truck
const door = (id, side, offset, extra = {}) => ({ id, side, offset, width: 4.2, height: 5, state: 'open', cargo: true, ...extra })
const dockIds = (siteId) => DOCKS.filter((d) => d.siteId === siteId).map((d) => d.id)
const chargerIds = (siteId) => CHARGERS.filter((c) => c.siteId === siteId).map((c) => c.id)

/** Forklift parking poses in a row, each forklift facing its cabinet (frames 07, 10, 29). */
function chargerRow(ids, start, step, facing, y = 0) {
  const chargers = {}, cabinets = {}
  const f = pt(Math.sin(facing), Math.cos(facing))
  ids.forEach((id, i) => {
    const p = add(start, step, i)
    chargers[id] = pose(p.x, p.z, facing, y)
    const c = add(p, f, CAB_DIST)
    cabinets[id] = pose(c.x, c.z, wrapAngle(facing + Math.PI), y)
  })
  return { chargers, cabinets }
}

/** Staging slots on a grid: codes fill `cols` along `step` first, then the next row along `rowStep`. */
function slotGrid(codes, start, step, rowStep, cols, heading, y = 0) {
  const slots = {}
  codes.forEach((code, i) => {
    const p = add(add(start, step, i % cols), rowStep, Math.floor(i / cols))
    slots[code] = pose(p.x, p.z, heading, y)
  })
  return slots
}

function padAround(points, margin, heading, y = 0) {
  const xs = points.map((p) => p.x), zs = points.map((p) => p.z)
  const minX = Math.min(...xs) - margin, maxX = Math.max(...xs) + margin
  const minZ = Math.min(...zs) - margin, maxZ = Math.max(...zs) + margin
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ, heading, y }
}

const PI = Math.PI
const HALF_PI = Math.PI / 2
const SX = pt(SLOT_STEP.x, 0)
const SZ = pt(0, SLOT_STEP.z)
const CZ = pt(0, CHARGER_STEP)

// Each def: building placement + doors, gate, routes (as street corner lists), yard geometry
// (approach/exit builders per dock) and site clutter. Building sizes follow the reference video
// (compact buildings, large vehicles) rather than real-world proportions.
const DEFS = {
  // WH-01 Riverside Hub — compact blue corrugated depot, yard south, 4-lane road right past its
  // east gable (frames 01–04, 25)
  'WH-01': {
    centre: pt(-6, -12), rotY: 0, gateSide: 'east', openSides: ['east'],
    building: {
      variant: 'depot', width: 26, depth: 15, height: 12, label: 'WH-01', sign: 'WareTrack', subtitle: 'WH-01 · Riverside Hub',
      // front-hall facade: Bay 2 (west) and Bay 1 (east) as the door plates in frame 01 read; a
      // cargo door on the rear hall and a big one on the east gable
      doors: [
        door('WH-01-D3', 'south', -5.85, { number: 3 }),
        door('WH-01-B2', 'south', 1.4, { number: 2 }),
        door('WH-01-B1', 'south', 7.3, { number: 1 }),
        door('WH-01-D4', 'east', 2, { number: 4, width: 4.8 }),
      ],
    },
    lot: { minX: -50, maxX: 17, minZ: -34, maxZ: 42 },
    gate: pt(17, 31),
    arrival: [[pt(28.5, -640), pt(28.5, 31), pt(17, 31)], [OUTER_LANE, 0]],
    departure: [[pt(17, 31), pt(28.5, 31), pt(28.5, 115), pt(470, 115)], [0, OUTER_LANE, OUTER_LANE]],
    approach: (d, g) => [g, pt(8, d.z + LANE_OUT), pt(d.x, d.z + LANE_OUT), pt(d.x, d.z + PULL_OUT)],
    exit: (d, g) => [d, pt(d.x, d.z + EXIT_OUT), pt(8, d.z + EXIT_OUT), g],
    // pinned S02/S03/S04 in front of the facade door, the east cargo door and north-east of the
    // hall (frame 01); S01/S05/S06 in the pallet field west of the trucks (PAL-1026, frame 04)
    slots: {
      S01: pose(-12.4, 8.6, 0),
      S05: pose(-16, 8.6, 0),
      S06: pose(-12.4, 12.2, 0),
      S02: pose(5.7, 2, 0),
      S03: pose(10.8, -8.2, 0),
      S04: pose(13, -19.5, 0),
    },
    // charging spot in the open yard west of the annex, the forklifts nose-in to the cabinets (02)
    chargerRow: [pt(-24.5, -6.2), CZ, -HALF_PI],
    parking: [pose(-43, 28, 0), pose(-37.5, 28, 0)],
    view: { target: { x: 4, y: 0, z: -16 }, distance: 87 },
    decor: [
      { type: 'container', x: -30, z: 7, heading: 0, label: 'MAERA LINE' },
      { type: 'pallets', x: -16, z: 3.4, heading: 0, kind: 'cardboard', cols: 3, rows: 2, gap: 3.6, layers: 2 },
      { type: 'pallets', x: -19.6, z: 10.4, heading: 0, kind: 'cardboard', cols: 1, rows: 2, gap: 3.9, layers: 2 },
      { type: 'pallets', x: -16, z: 13.6, heading: 0.06, kind: 'cardboard', cols: 1, rows: 1, gap: 3, layers: 1 },
      { type: 'rack', x: 2.5, z: -23.5, heading: 0, bays: 2, levels: 3 },
      { type: 'pallets', x: -6, z: -25, heading: 0.2, kind: 'blue', cols: 2, rows: 1, gap: 2.7, layers: 2 },
      { type: 'pallets', x: 13.5, z: -24.5, heading: 0, kind: 'blue', cols: 2, rows: 2, gap: 2.6, layers: 2 },
      { type: 'pallets', x: 11.2, z: -15, heading: 0, kind: 'white', cols: 1, rows: 1, gap: 2.4, layers: 1 },
      { type: 'grass', minX: -50, maxX: 17, minZ: -34, maxZ: -29 },
      { type: 'treeRow', from: pt(-44, -31.5), to: pt(13, -31.5), step: 9.5 },
      { type: 'bushes', from: pt(-40, -30), to: pt(10, -30), step: 14 },
    ],
  },

  // WH-02 Northgate DC — long white DC rotated so its 8 doors face east, office south (15, 16)
  'WH-02': {
    centre: pt(304, -40), rotY: HALF_PI, gateSide: 'east',
    building: {
      variant: 'dc', width: 84, depth: 32, height: 11, label: 'WH-02', sign: 'WareTrack', subtitle: 'WH-02 · Northgate DC',
      // local offsets run north (rotY = π/2): Bay 1 is the door next to the office (frame 15)
      doors: [
        door('WH-02-B1', 'south', -19, { height: 6, number: 1 }),
        door('WH-02-B2', 'south', -11, { height: 6, number: 2 }),
        door('WH-02-B3', 'south', -3, { height: 6, number: 3 }),
        door('WH-02-B4', 'south', 5, { height: 6, number: 4 }),
        door('WH-02-D5', 'south', 13, { height: 6, number: 5 }),
        door('WH-02-D6', 'south', 21, { height: 6, number: 6 }),
        door('WH-02-D7', 'south', 29, { height: 6, number: 7 }),
        door('WH-02-D8', 'south', 37, { height: 6, number: 8 }),
      ],
    },
    lot: { minX: 250, maxX: 362, minZ: -116, maxZ: 30 },
    gate: pt(362, 12),
    arrival: [[pt(378, -470), pt(378, 12), pt(362, 12)], [OUTER_LANE, 0]],
    departure: [[pt(362, 12), pt(378, 12), pt(378, 480)], [0, OUTER_LANE]],
    approach: (d, g) => [g, pt(d.x + LANE_OUT, g.z - 6), pt(d.x + LANE_OUT, d.z), pt(d.x + PULL_OUT, d.z)],
    exit: (d, g) => [d, pt(d.x + EXIT_OUT, d.z), pt(d.x + EXIT_OUT, g.z - 6), g],
    // two pinned pallets by the office (frame 15, lower left), the rest mid-yard by door 6
    slots: {
      ...slotGrid(['S01', 'S02'], pt(325.5, -4.2), pt(0, -SLOT_STEP.x), SX, 2, HALF_PI),
      ...slotGrid(['S03', 'S04', 'S05'], pt(334, -55.5), pt(0, -SLOT_STEP.x), SX, 3, HALF_PI),
    },
    // charging bay past the north-east corner (frame 15, top right)
    chargerRow: [pt(324.5, -90.5), pt(CHARGER_STEP, 0), PI],
    parking: [pose(352, -70, PI), pose(357.5, -70, PI)],
    view: { target: { x: 341, y: 0, z: -41 }, distance: 116, azimuth: 0.85 },
    decor: [
      { type: 'pallets', x: 334, z: -67.5, heading: HALF_PI, kind: 'cardboard', cols: 1, rows: 1, gap: 2.8, layers: 2 },
      { type: 'pallets', x: 334.5, z: -71.2, heading: HALF_PI, kind: 'blue', cols: 1, rows: 1, gap: 2.7, layers: 2 },
      { type: 'pallets', x: 329, z: -8, heading: HALF_PI, kind: 'white', cols: 1, rows: 1, gap: 2.6, layers: 1 },
      { type: 'rack', x: 310, z: -96, heading: 0, bays: 3, levels: 3 },
      { type: 'pallets', x: 296, z: -96, heading: 0, kind: 'blue', cols: 2, rows: 1, gap: 2.7, layers: 2 },
      { type: 'pallets', x: 280, z: 15, heading: 0, kind: 'cardboard', cols: 2, rows: 1, gap: 2.8, layers: 2 },
      { type: 'grass', minX: 254, maxX: 276, minZ: 18, maxZ: 28 },
      { type: 'treeRow', from: pt(257, 23), to: pt(273, 23), step: 8 },
    ],
  },

  // WH-03 Eastport Cold Chain — insulated box, raised platform + apron on the south face (17–20)
  'WH-03': {
    centre: pt(600, 34), rotY: 0, gateSide: 'south', platformDepth: 4.5,
    building: {
      variant: 'cold', width: 74, depth: 40, height: 11, label: 'WH-03', sign: 'WareTrack', subtitle: 'WH-03 · Eastport Cold Chain',
      // 4 narrow doors on the west half of the platform, the sign on the long blank east part (17)
      doors: [
        door('WH-03-B1', 'south', -11.2, { number: 1, width: 3.6, height: 4.8 }),
        door('WH-03-B2', 'south', -1.2, { number: 2, width: 3.6, height: 4.8 }),
        door('WH-03-B3', 'south', 8.8, { number: 3, width: 3.6, height: 4.8 }),
        door('WH-03-D4', 'south', 18.8, { number: 4, width: 3.6, height: 4.8, state: 'closed', cargo: false }),
      ],
    },
    lot: { minX: 540, maxX: 662, minZ: -15, maxZ: 96 },
    gate: pt(652, 96),
    arrival: [[pt(700, -330), pt(700, 115), pt(652, 115), pt(652, 96)], [OUTER_LANE, OUTER_LANE, 0]],
    departure: [[pt(652, 96), pt(652, 115), pt(290, 115)], [0, OUTER_LANE]],
    approach: (d, g) => [g, pt(g.x - 3, g.z - 10), pt(g.x - 3, d.z + LANE_OUT), pt(d.x, d.z + LANE_OUT), pt(d.x, d.z + PULL_OUT)],
    exit: (d, g) => [d, pt(d.x, d.z + EXIT_OUT), pt(g.x + 3, d.z + EXIT_OUT), pt(g.x + 3, g.z - 10), g],
    // slots + chargers live on the platform / apron (see applyColdPlatform())
    view: { target: { x: 618, y: 0, z: 55 }, distance: 135 },
    decor: [
      { type: 'silo', x: 553, z: 2, radius: 2.8, height: 11 },
      { type: 'silo', x: 553, z: 9, radius: 2.8, height: 11 },
      { type: 'silo', x: 553, z: 16, radius: 2.8, height: 11 },
      { type: 'pallets', x: 648, z: 64, heading: 0.1, kind: 'blue', cols: 1, rows: 1, gap: 2.6, layers: 2 },
      { type: 'pallets', x: 648, z: 30, heading: 0, kind: 'white', cols: 2, rows: 2, gap: 3.6, layers: 1 },
    ],
  },

  // WH-04 Southfield Cross-Dock — sawtooth roof, In doors south, Out doors east, road south (07–12, 21)
  'WH-04': {
    // 4 sawtooth bays: In 1–3 + one more door on the short south face, the long east face carries
    // Out 1–3 between spare doors (frame 21)
    centre: pt(116, 304.5), rotY: 0, gateSide: 'south',
    building: {
      variant: 'crossdock', width: 48, depth: 56, height: 6.5, label: 'WH-04', sign: 'WareTrack', subtitle: 'WH-04 · Southfield Cross-Dock',
      doors: [
        door('WH-04-IN1', 'south', -16.5, { number: 1 }),
        door('WH-04-IN2', 'south', -8, { number: 2 }),
        door('WH-04-IN3', 'south', 0.5, { number: 3 }),
        door('WH-04-D4', 'south', 9, { number: 4 }),
        door('WH-04-D5', 'east', 22, { number: 5 }),
        door('WH-04-OUT1', 'east', 12.5, { number: 6 }),
        door('WH-04-OUT2', 'east', 3, { number: 7 }),
        door('WH-04-OUT3', 'east', -6.5, { number: 8 }),
        door('WH-04-D9', 'east', -16, { number: 9 }),
      ],
    },
    // the fence + road run right past the bays' outer ends; the gate opens opposite the staging
    // area so arriving trucks turn in right beside the In bays (frames 12, 13, 27)
    lot: { minX: 40, maxX: 205, minZ: 250, maxZ: 375 },
    gate: pt(141, 375),
    arrival: [[pt(640, 388), pt(141, 388), pt(141, 375)], [OUTER_LANE, 0]],
    departure: [[pt(141, 375), pt(141, 388), pt(-230, 388)], [0, OUTER_LANE]],
    approach: (d, g, n) => n.x > 0.5
      ? [g, pt(d.x + LANE_OUT, g.z - 12), pt(d.x + LANE_OUT, d.z), pt(d.x + PULL_OUT, d.z)]
      : [g, pt(g.x, g.z - 10), pt(g.x - 6, d.z + LANE_OUT), pt(d.x, d.z + LANE_OUT), pt(d.x, d.z + PULL_OUT)],
    exit: (d, g, n) => n.x > 0.5
      ? [d, pt(d.x + EXIT_OUT, d.z), pt(d.x + EXIT_OUT, g.z - 14), g]
      : [d, pt(d.x, d.z + EXIT_OUT), pt(g.x + 6, d.z + EXIT_OUT), pt(g.x + 6, g.z - 10), g],
    // 2 × 3 staging grid between door 4 and the south-east corner, pinned pallets in the front row
    // (frames 07, 21, 29)
    slots: {
      ...slotGrid(['S02', 'S05', 'S06'], pt(122.5, 347), pt(4, 0), SZ, 3, 0),
      ...slotGrid(['S01', 'S03', 'S04'], pt(122.5, 351.2), pt(4, 0), SZ, 3, 0),
    },
    // charging bay north-west of the In 1 truck, cabinets on the west side (frames 07, 10, 29)
    chargerRow: [pt(83.5, 329.5), CZ, -HALF_PI],
    parking: [pose(52, 360, 0), pose(57.5, 360, 0), pose(63, 360, 0)],
    view: { target: { x: 139, y: 0, z: 322 }, distance: 105, azimuth: 0.85, polar: 1.15 },
    decor: [
      { type: 'pallets', x: 135, z: 347.5, heading: 0.05, kind: 'white', cols: 1, rows: 1, gap: 3.1, layers: 1 },
      { type: 'pallets', x: 135.5, z: 351.6, heading: -0.1, kind: 'cardboard', cols: 1, rows: 1, gap: 2.6, layers: 2 },
      { type: 'pallets', x: 60, z: 285, heading: 0, kind: 'blue', cols: 3, rows: 2, gap: 2.7, layers: 2 },
      { type: 'rack', x: 182, z: 276, heading: -HALF_PI, bays: 2, levels: 3 },
      { type: 'pallets', x: 174, z: 272, heading: 0, kind: 'cardboard', cols: 2, rows: 1, gap: 2.8, layers: 2 },
      { type: 'grass', minX: 40, maxX: 120, minZ: 372.5, maxZ: 375 },
    ],
  },

  // WH-05 Westgate Robotics Hub — large white box, 4 roller doors facing east (22–24)
  'WH-05': {
    // a tall box with 4 big roller doors evenly spread along its east face (frames 22, 23)
    centre: pt(468, 318), rotY: HALF_PI, gateSide: 'south',
    building: {
      variant: 'robotics', width: 48, depth: 44, height: 13, label: 'WH-05', sign: 'WareTrack', subtitle: 'WH-05 · Westgate Robotics Hub',
      doors: [
        door('WH-05-B1', 'south', -17.4, { number: 1, width: 4.6, height: 5.6, state: 'closed', cargo: false }),
        door('WH-05-B2', 'south', -5.8, { number: 2, width: 4.6, height: 5.6, state: 'closed', cargo: false }),
        door('WH-05-B3', 'south', 5.8, { number: 3, width: 4.6, height: 5.6, state: 'closed', cargo: false }),
        door('WH-05-B4', 'south', 17.4, { number: 4, width: 4.6, height: 5.6, state: 'closed', cargo: false }),
      ],
    },
    lot: { minX: 400, maxX: 535, minZ: 258, maxZ: 375 },
    // gate on the south fence: the at-gate truck waits south of the docks (frame 23)
    gate: pt(520, 375),
    arrival: [[pt(880, 388), pt(520, 388), pt(520, 375)], [OUTER_LANE, 0]],
    departure: [[pt(520, 375), pt(520, 388), pt(-120, 388)], [0, OUTER_LANE]],
    approach: (d, g) => [g, pt(d.x + LANE_OUT, g.z - 6), pt(d.x + LANE_OUT, d.z), pt(d.x + PULL_OUT, d.z)],
    exit: (d, g) => [d, pt(d.x + EXIT_OUT, d.z), pt(d.x + EXIT_OUT, g.z - 6), g],
    slots: slotGrid(['S01', 'S02', 'S03'], pt(497, 287), pt(0, -SLOT_STEP.x), SX, 3, HALF_PI),
    // charging bay at the north end of the yard (frame 23, top right)
    chargerRow: [pt(508, 270), CZ, HALF_PI],
    parking: [pose(523, 279, PI), pose(528.5, 279, PI)],
    view: { target: { x: 506, y: 0, z: 309 }, distance: 125, azimuth: 0.8 },
    decor: [
      { type: 'pallets', x: 503.2, z: 287, heading: HALF_PI, kind: 'blue', cols: 2, rows: 1, gap: 3.6, layers: 2 },
      { type: 'pallets', x: 488, z: 372, heading: 0, kind: 'cardboard', cols: 2, rows: 1, gap: 2.8, layers: 2 },
    ],
  },
}

// ───────────────────────────── build + cache ─────────────────────────────
const cache = new Map()

function build(siteId) {
  const site = SITES.find((s) => s.id === siteId)
  const def = DEFS[siteId]
  const L = {
    id: siteId,
    origin: { x: site.world.x, z: site.world.z },
    centre: { ...def.centre },
    rotY: def.rotY,
    building: def.building,
    lot: { ...def.lot },
    gateSide: def.gateSide,
    openSides: def.openSides ?? [],
    gate: { ...def.gate },
    arrivalRoute: street(...def.arrival),
    departureRoute: street(...def.departure),
    docks: {}, dockNormals: {}, dockAnchors: {}, dockApproach: {}, dockWork: {}, dockExit: {},
    slots: {}, chargers: {}, cabinets: {}, chargerPad: null,
    parking: (def.parking ?? []).map((p) => ({ ...p })),
    platform: null,
    decor: def.decor ?? [],
    view: { azimuth: PI / 4, polar: SITE_POLAR, ...def.view, target: { ...def.view.target } },
  }

  // analytic door anchors (refined from the real model by world.js → refineSiteDocks)
  const anchors = {}
  for (const d of def.building.doors) {
    anchors[d.id] = doorAnchor(def.building, def.centre, def.rotY, d, def.platformDepth ?? 0)
  }
  applyDocks(L, def, anchors)

  if (siteId === 'WH-03') applyColdPlatform(L, def)
  else {
    Object.assign(L.slots, def.slots)
    const [start, step, facing] = def.chargerRow
    const row = chargerRow(chargerIds(siteId), start, step, facing)
    L.chargers = row.chargers
    L.cabinets = row.cabinets
    L.chargerPad = padAround([...Object.values(row.chargers), ...Object.values(row.cabinets)], 2.2, 0)
  }
  return L
}

/** Docked / work / approach / exit poses from door anchors (world space). */
function applyDocks(L, def, anchors) {
  const gap = def.platformDepth ? PLATFORM_GAP : DOCK_GAP
  for (const id of dockIds(L.id)) {
    const a = anchors[id]
    if (!a) continue
    const n = norm(a.normal)
    const heading = headingOf(n)
    const d = add(a.position, n, gap + TRUCK_REAR)
    const dockPose = pose(d.x, d.z, heading)
    L.docks[id] = dockPose
    L.dockNormals[id] = n
    L.dockAnchors[id] = round(a.position)
    L.dockApproach[id] = yard(def.approach(dockPose, L.gate, n))
    L.dockExit[id] = yard(def.exit(dockPose, L.gate, n))
    if (def.platformDepth) {
      // the platform is shallower than a forklift is long: it waits beside the door on the
      // platform, parallel to the wall and facing the door (frames 17, 19)
      const t = pt(n.z, -n.x)       // along the wall, away from the apron (east for a south face)
      const w = add(add(a.position, n, -(0.6 + def.platformDepth / 2)), t, 1.6 + FORK_HALF_L + 0.4)
      L.dockWork[id] = pose(w.x, w.z, headingOf(pt(-t.x, -t.z)), PLATFORM_H)
    } else {
      const w = add(a.position, n, gap / 2 - 0.15)
      L.dockWork[id] = pose(w.x, w.z, wrapAngle(heading + PI))
    }
  }
}

/**
 * WH-03: chargers on the raised apron at the west end of the platform, staging slots on the
 * platform's east end (frames 17, 19). Mirrors warehouse.js coldLayout/coldPlatform —
 * CONTRACT-GAP: the apron is not in the SPEC (plant annex = clamp(0.16·W, 8, 14) wide,
 * apron = main.x0 … first door − 3.5 m, 10 m deep).
 */
function applyColdPlatform(L, def) {
  const b = def.building
  const wall = def.centre.z + b.depth / 2
  const edge = wall + def.platformDepth
  const annexW = Math.min(14, Math.max(8, 0.16 * b.width))
  const x0 = def.centre.x - b.width / 2 + annexW
  const x1 = def.centre.x + b.width / 2
  const first = Math.min(...b.doors.map((d) => d.offset - d.width / 2)) + def.centre.x
  const apron = { x0, x1: first - 3.5, z0: wall, z1: wall + 10 }
  const y = PLATFORM_H
  L.platform = { height: y, x0, x1, z0: wall, z1: edge, edge, apron }
  const row = chargerRow(chargerIds(L.id), pt(x0 + 1 + CAB_DIST, wall + 3), pt(0, CHARGER_STEP), -HALF_PI, y)
  L.chargers = row.chargers
  L.cabinets = row.cabinets
  L.chargerPad = padAround([...Object.values(row.chargers), ...Object.values(row.cabinets)], 1.4, 0, y)
  // S01/S03 on the platform's east end, S02 on the ground past its south-east corner (frame 17)
  const sz = wall + def.platformDepth / 2
  L.slots.S01 = pose(x1 - 2.2, sz, 0, y)
  L.slots.S03 = pose(x1 - 2.2 - SLOT_STEP.x, sz, 0, y)
  L.slots.S02 = pose(x1 + 4.6, edge + 1.6, 0)
}

/**
 * Re-derive dock poses from the real model's door anchors (world space).
 * anchors: { [doorId]: { position:{x,z}, normal:{x,z} } }. Called once by world.js.
 */
export function refineSiteDocks(siteId, anchors) {
  const L = siteLayout(siteId)
  let def = DEFS[siteId]
  if (def.platformDepth) {
    // platform depth from the real anchors (anchor = 0.6 m outside the platform edge)
    const any = Object.values(anchors).find((a) => a.normal.z > 0.5)
    const depth = any ? any.position.z - 0.6 - (def.centre.z + def.building.depth / 2) : def.platformDepth
    if (depth > 1 && Math.abs(depth - def.platformDepth) > 0.05) {
      def = { ...def, platformDepth: depth }
      applyColdPlatform(L, def)
    }
  }
  applyDocks(L, def, anchors)
  return L
}

// ───────────────────────────── public API ─────────────────────────────
export const SITE_IDS = SITES.map((s) => s.id)

export function siteOrigin(siteId) {
  const s = SITES.find((x) => x.id === siteId)
  return { x: s.world.x, z: s.world.z }
}

/** Full layout of a site (cached; the same object every call). */
export function siteLayout(siteId) {
  if (!cache.has(siteId)) cache.set(siteId, build(siteId))
  return cache.get(siteId)
}

export function allLayouts() {
  return SITE_IDS.map(siteLayout)
}

/** Camera view framing all five sites. */
export function networkView() {
  return { target: { x: 330, y: 0, z: 180 }, distance: 1200, azimuth: PI / 4, polar: 0.8 }
}

/** Pose (x, z, heading) at the point `distanceLeft` metres before a dock along arrival → approach → reverse. */
function poseBeforeDock(L, dockId, distanceLeft, includeArrival) {
  const dock = L.docks[dockId]
  const n = L.dockNormals[dockId]
  if (distanceLeft <= PULL_OUT) {
    const p = add(dock, n, distanceLeft)
    return { x: p.x, z: p.z, heading: dock.heading }
  }
  const forward = includeArrival ? [...L.arrivalRoute, ...L.dockApproach[dockId].slice(1)] : L.dockApproach[dockId]
  const total = pathLength(forward)
  return pointAlong(forward, total - (distanceLeft - PULL_OUT))
}

function setPose(e, p) {
  e.position.x = p.x
  e.position.y = p.y ?? 0
  e.position.z = p.z
  e.heading = p.heading
}

/** Give every truck / forklift / pallet a sensible pose from its status (before the sim runs). */
export function applyInitialPoses(db) {
  for (const t of db.list('truck')) {
    const L = siteLayout(t.siteId)
    const dock = L.docks[t.dockId]
    if (!dock) continue
    switch (t.status) {
      case 'loading':
      case 'unloading':
        setPose(t, dock)
        break
      case 'docking':
        setPose(t, poseBeforeDock(L, t.dockId, t.distanceLeftM || 12, false))
        break
      case 'at_gate': {
        const g = pointAlong(L.arrivalRoute, pathLength(L.arrivalRoute) - 6)
        setPose(t, g)
        break
      }
      case 'departing':
        setPose(t, pointAlong(L.departureRoute, 10))
        break
      default:
        setPose(t, poseBeforeDock(L, t.dockId, t.distanceLeftM || 400, true))
    }
  }

  for (const f of db.list('forklift')) {
    const L = siteLayout(f.siteId)
    const truck = f.truckId ? db.get('truck', f.truckId) : null
    const work = truck && L.dockWork[truck.dockId]
    setPose(f, work ?? L.chargers[f.chargerId] ?? { x: L.centre.x, z: L.centre.z, heading: 0 })
  }

  for (const p of db.list('pallet')) {
    const L = siteLayout(p.siteId)
    const carrier = p.carriedBy ? db.get('forklift', p.carriedBy) : null
    if (carrier) setPose(p, { x: carrier.position.x, y: carrier.position.y, z: carrier.position.z, heading: carrier.heading })
    else if (L.slots[p.slot]) setPose(p, L.slots[p.slot])
  }
}
