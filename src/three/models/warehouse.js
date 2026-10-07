// WareTrack warehouse buildings (SPEC §4.5) — five variants built from merged, palette-coloured
// geometry: 'depot' (WH-01), 'dc' (WH-02), 'cold' (WH-03), 'crossdock' (WH-04), 'robotics' (WH-05).
//
// Conventions: origin = ground centre of the footprint, Y up, local X = width, Z = depth,
// south = +Z, east = +X. Door `offset` is the door centre measured along the face axis in local
// coordinates (x for south/north faces, z for east/west faces).
// userData.doorAnchors are LOCAL, at ground level 0.6 m outside the door (outside the loading-platform
// edge for 'cold'), with the outward face normal.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { C, mat } from '../palette.js'
import { canvasTexture, roundRect, drawCubeLogo, FONT } from '../canvasText.js'

const T = 0.3 // wall thickness
const DOOR_W = 3.6
const DOOR_H = 4.2
const ANCHOR_GAP = 0.6
const PLATFORM_H = 1.3 // cold-store loading platform
const PLATFORM_D = 4.5
const PLATFORM_APRON = 10

const COL = {
  // CONTRACT-GAP: palette.js has no roof tone. In the frames the blue roofs read as a lighter azure
  // (#5b99f0 on WH-04, #558ee5 on WH-01) than the C.blue walls, so roofs use this local colour.
  roofBlue: 0x4a86ec,
  greyWall: 0xd5dbec,
  ridge: 0x3a72e2,
  crossWall: 0xe6e9f2, // WH-04 cladding reads a touch greyer than C.wall (frames 07, 21)
  navy: 0x1f3db8, // WH-02 parapet band / trims (darker than the brand blue in frames 15, 16)
  insideFloor: 0xb3bccd,
  bumper: 0x2b2f38,
  leveller: 0x6b7180,
  platform: 0xe3e7f0,
  skylight: 0xc5d0f4,
  skyFrame: 0xe1e6f3,
  fan: 0x464c5a,
  acBase: 0xd9dee9,
  glass: 0x2f57cf,
  mullion: 0xf2f5fb,
  rail: 0xeef1f6,
  seam: 0xe0e4ed,
  lamp: 0xfafbff,
}

// Door styling per variant: frame width/depth, plate side, interior recess + colour, cargo inside the
// open bays (depth behind the wall, stack count, scale, max carton layers) and an optional
// rolled-up shutter fraction shown on open doors.
const STYLE = {
  depot: { frame: C.blue, frameW: 0.45, frameD: 0.28, plateSide: 'left', bumpers: true, recess: 3.5, cargoDepth: 0.2, stacks: 2, cargoScale: 1.32, layers: 3, inside: 0xa3aec6 },
  dc: { frame: C.doorFrame, frameW: 0.3, frameD: 0.2, plateSide: 'right', bumpers: true, recess: 3.4, cargoDepth: 0.25, stacks: 1, cargoScale: 1.3, inside: 0xb8c3dd },
  cold: { frame: C.doorFrame, frameW: 0.28, frameD: 0.18, plateSide: 'right', bumpers: false, recess: 3.6, cargoDepth: 1.2, stacks: 1, cargoScale: 1.15, inside: 0xbfc8dc, openShutter: 0.2 },
  crossdock: { frame: C.blue, frameW: 0.38, frameD: 0.24, plateSide: 'left', bumpers: true, recess: 3.4, cargoDepth: 0.35, stacks: 1, cargoScale: 1.5, inside: 0xb0bbd3 },
  robotics: { frame: C.doorFrame, frameW: 0.32, frameD: 0.2, plateSide: 'right', bumpers: true, recess: 3.4, cargoDepth: 1.1, stacks: 1, cargoScale: 1.2, inside: 0xb8c3dd },
}

// Each face: outward normal, the axis door offsets run along, and the Y rotation that turns
// face-local space (u = viewer's right when facing the wall, y = up, d = outward) into building space.
const FACES = {
  south: { normal: [0, 0, 1], rot: 0, axis: 'x', sign: 1 },
  east: { normal: [1, 0, 0], rot: Math.PI / 2, axis: 'z', sign: -1 },
  north: { normal: [0, 0, -1], rot: Math.PI, axis: 'x', sign: -1 },
  west: { normal: [-1, 0, 0], rot: -Math.PI / 2, axis: 'z', sign: 1 },
}
const SIDES = ['south', 'east', 'north', 'west']

// ───────────────────────────── public API ─────────────────────────────

/** Build a warehouse Group for `spec` (see SPEC §4.5). */
export function createWarehouse(spec = {}) {
  const s = normalizeSpec(spec)
  const V = VARIANTS[s.variant]
  const layout = V.layout(s)
  const doorsByFace = resolveDoors(s.doors, layout.faces)
  const b = new Builder()
  V.build(b, s, layout, doorsByFace)

  const group = new THREE.Group()
  group.name = `warehouse:${s.label || s.variant}`
  b.finish(group)
  group.updateMatrixWorld(true)
  const extents = new THREE.Box3().setFromObject(group)
  group.userData = {
    kind: 'warehouse',
    variant: s.variant,
    label: s.label,
    doorAnchors: anchorsFor(doorsByFace),
    footprint: { width: s.width, depth: s.depth },
    height: extents.max.y,
    extents,
  }
  return group
}

/** Door anchors for `spec` without building any geometry (same result as userData.doorAnchors). */
export function warehouseDoorAnchors(spec = {}) {
  const s = normalizeSpec(spec)
  return anchorsFor(resolveDoors(s.doors, VARIANTS[s.variant].layout(s).faces))
}

// ───────────────────────────── spec & doors ─────────────────────────────

const SIZES = {
  depot: { width: 46, depth: 30, height: 9 },
  dc: { width: 90, depth: 36, height: 10 },
  cold: { width: 70, depth: 44, height: 11 },
  crossdock: { width: 80, depth: 50, height: 8 },
  robotics: { width: 100, depth: 60, height: 12 },
}

function normalizeSpec(spec) {
  const variant = SIZES[spec.variant] ? spec.variant : 'depot'
  const size = SIZES[variant]
  const s = {
    variant,
    width: spec.width ?? size.width,
    depth: spec.depth ?? size.depth,
    height: spec.height ?? size.height,
    label: spec.label ?? '',
    sign: spec.sign ?? 'WareTrack',
    subtitle: spec.subtitle ?? spec.label ?? '',
  }
  const doors = spec.doors ?? VARIANTS[variant].doors(s)
  s.doors = doors.map((d, i) => ({
    id: d.id ?? `${d.side ?? 'south'}-${i + 1}`,
    side: FACES[d.side] ? d.side : 'south',
    offset: d.offset ?? 0,
    width: d.width ?? DOOR_W,
    height: d.height ?? DOOR_H,
    number: String(d.number ?? i + 1),
    state: d.state ?? 'open',
    cargo: d.cargo ?? true,
    seed: i + 1,
  }))
  return s
}

/** Assign each door to the outermost wall face of its side that can hold it. → Map<face, door[]> */
function resolveDoors(doors, faces) {
  const out = new Map(faces.map((f) => [f, []]))
  const outward = (f) => (f.side === 'south' || f.side === 'east' ? f.plane : -f.plane)
  for (const door of doors) {
    const own = faces.filter((f) => f.side === door.side && f.doors !== false)
    if (!own.length) continue
    const u = FACES[door.side].sign * door.offset
    const half = door.width / 2
    const fits = own.filter((f) => u - half >= f.u0 - 0.01 && u + half <= f.u1 + 0.01)
    const face = (fits.length ? fits : own).reduce((a, f) => (outward(f) > outward(a) ? f : a))
    const margin = half + 0.6
    const cu = face.u1 - face.u0 > margin * 2 ? clamp(u, face.u0 + margin, face.u1 - margin) : (face.u0 + face.u1) / 2
    out.get(face).push({ ...door, u: cu, y0: face.doorBase })
  }
  return out
}

function anchorsFor(doorsByFace) {
  const anchors = {}
  for (const [face, doors] of doorsByFace) {
    for (const d of doors) {
      const position = new THREE.Vector3(d.u, 0, ANCHOR_GAP + face.platform).applyMatrix4(face.matrix)
      position.y = 0
      anchors[d.id] = { position, normal: new THREE.Vector3(...FACES[face.side].normal) }
    }
  }
  return anchors
}

// ───────────────────────────── faces & profiles ─────────────────────────────

function makeFace(side, plane, c0, c1, extra = {}) {
  const F = FACES[side]
  const [fullU0, fullU1] = F.sign > 0 ? [c0, c1] : [-c1, -c0]
  const trim = F.axis === 'z' ? T : 0 // east/west walls sit between the south/north walls
  const matrix = new THREE.Matrix4().makeRotationY(F.rot)
  if (F.axis === 'x') matrix.setPosition(0, 0, plane)
  else matrix.setPosition(plane, 0, 0)
  return { side, plane, fullU0, fullU1, u0: fullU0 + trim, u1: fullU1 - trim, matrix, doorBase: 0, platform: 0, ...extra }
}

/** The 4 wall faces of a box volume. topFn(side) → wall-top polyline in axis coords [[c, y], ...]. */
function volumeFaces(v, topFn, extras = {}) {
  return SIDES.map((side) => {
    const plane = { south: v.z1, east: v.x1, north: v.z0, west: v.x0 }[side]
    const [c0, c1] = axisExtent(v, side)
    const face = makeFace(side, plane, c0, c1, { volume: v, ...extras[side] })
    face.top = clipPolyline(axisToU(side, topFn(side)), face.u0, face.u1)
    return face
  })
}

const axisExtent = (v, side) => (FACES[side].axis === 'x' ? [v.x0, v.x1] : [v.z0, v.z1])
const flatTop = (v, h) => (side) => axisExtent(v, side).map((c) => [c, h])

function axisToU(side, pts) {
  const s = FACES[side].sign
  const out = pts.map(([c, y]) => [s * c, y])
  return s > 0 ? out : out.reverse()
}

function clipPolyline(pts, a, b) {
  const yAt = (u) => {
    if (u <= pts[0][0]) return pts[0][1]
    for (let i = 0; i < pts.length - 1; i++) {
      const [ua, ya] = pts[i]
      const [ub, yb] = pts[i + 1]
      if (u >= ua && u <= ub) return ub === ua ? Math.max(ya, yb) : ya + ((u - ua) / (ub - ua)) * (yb - ya)
    }
    return pts[pts.length - 1][1]
  }
  return [[a, yAt(a)], ...pts.filter(([u]) => u > a + 1e-6 && u < b - 1e-6), [b, yAt(b)]]
}

const faceAt = (face, u, y, d = 0) => chain(face.matrix, tr(u, y, d))

function faceBox(b, face, material, u0, u1, y0, y1, d0, d1, opts) {
  b.boxMM(material, u0, y0, d0, u1, y1, d1, face.matrix, opts)
}

// ───────────────────────────── geometry builder ─────────────────────────────

const KEEP = new Set(['position', 'normal', 'uv'])
const M4 = () => new THREE.Matrix4()
const tr = (x, y, z) => M4().makeTranslation(x, y, z)
const rx = (a) => M4().makeRotationX(a)
const ry = (a) => M4().makeRotationY(a)
const rz = (a) => M4().makeRotationZ(a)
const chain = (...ms) => ms.reduce((acc, m) => acc.multiply(m), M4())
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/** Collects transformed geometry per material and merges each bucket into one mesh. */
class Builder {
  constructor() {
    this.buckets = new Map()
    this.decals = []
  }

  add(material, geometry, matrix, { cast = true, receive = true } = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    if (matrix) g.applyMatrix4(matrix)
    for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name)
    const key = `${material.uuid}|${cast}|${receive}`
    let bucket = this.buckets.get(key)
    if (!bucket) this.buckets.set(key, (bucket = { material, cast, receive, geos: [] }))
    bucket.geos.push(g)
  }

  box(material, w, h, d, matrix, opts) {
    this.add(material, new THREE.BoxGeometry(w, h, d), matrix, opts)
  }

  boxMM(material, x0, y0, z0, x1, y1, z1, matrix = null, opts) {
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    this.add(material, g, matrix, opts)
  }

  cyl(material, r, h, matrix, opts) {
    this.add(material, new THREE.CylinderGeometry(r, r, h, 20), matrix, opts)
  }

  /** Flat painted decal (plane facing +Z of `matrix`), packed into one atlas per building. */
  decal(w, h, ppm, draw, matrix) {
    const scale = Math.min(ppm, 1800 / w, 1800 / h)
    this.decals.push({ w, h, pw: Math.ceil(w * scale), ph: Math.ceil(h * scale), draw, matrix })
  }

  finish(group) {
    for (const { material, cast, receive, geos } of this.buckets.values()) {
      const geo = mergeGeometries(geos, false)
      for (const g of geos) g.dispose()
      if (material.userData.uvSpacing) planarUV(geo, material.userData.uvSpacing)
      const mesh = new THREE.Mesh(geo, material)
      mesh.castShadow = cast
      mesh.receiveShadow = receive
      group.add(mesh)
    }
    const decals = decalMesh(this.decals)
    if (decals) group.add(decals)
  }
}

/** World-space UVs (in units of `spacing`) so stripe textures line up across merged parts:
 *  walls stripe vertically, sloped roofs stripe down the fall line. */
function planarUV(geo, spacing) {
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i)
    let u, v
    if (Math.abs(ny) < 0.6) {
      u = Math.abs(nx) > Math.abs(nz) ? z : x
      v = y
    } else {
      const hl = Math.hypot(nx, nz)
      if (hl > 0.03) {
        u = (x * -nz + z * nx) / hl
        v = (x * nx + z * nz) / hl
      } else {
        u = x
        v = z
      }
    }
    uv.setXY(i, u / spacing, v / spacing)
  }
  uv.needsUpdate = true
}

// ───────────────────────────── textures & materials ─────────────────────────────

let stripes = null
function stripeTextures() {
  if (stripes) return stripes
  const make = (w, h, paint) => {
    const t = canvasTexture(w, h, paint)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    return t
  }
  const bars = (ctx, w, h, list, vertical) => {
    for (const [a, len, color] of list) {
      ctx.fillStyle = color
      if (vertical) ctx.fillRect(a, 0, len, h)
      else ctx.fillRect(0, a, w, len)
    }
  }
  stripes = {
    // corrugated metal: dark groove, soft falloff, faint crest shade (one period across the width)
    rib: make(64, 4, (ctx, w, h) => bars(ctx, w, h, [[0, w, '#ffffff'], [0, 7, '#c4c9d8'], [7, 6, '#dfe3ec'], [w - 9, 9, '#f0f2f7']], true)),
    // roof sheeting: the same profile, finer and softer (roofs read lighter in the frames)
    roofRib: make(64, 4, (ctx, w, h) => bars(ctx, w, h, [[0, w, '#ffffff'], [0, 4, '#d3d9e6'], [4, 5, '#e9ecf3'], [w - 6, 6, '#f5f6fa']], true)),
    // insulated sandwich panels: a fine seam per panel
    panel: make(64, 4, (ctx, w, h) => bars(ctx, w, h, [[0, w, '#ffffff'], [0, 2, '#e3e7ef'], [2, 2, '#f4f6f9']], true)),
    // roller shutter slats (horizontal)
    slat: make(4, 32, (ctx, w, h) => bars(ctx, w, h, [[0, h, '#ffffff'], [0, 4, '#c8cdd9'], [4, 3, '#e4e7ef']], false)),
  }
  return stripes
}

const surfaceCache = new Map()
/** Shared textured material; `spacing` = metres per stripe period (UVs are generated in metres). */
function surfaceMat(color, kind, spacing) {
  const key = `${color}|${kind}|${spacing}`
  if (!surfaceCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, map: stripeTextures()[kind], roughness: 0.78, metalness: 0 })
    m.userData.uvSpacing = spacing
    surfaceCache.set(key, m)
  }
  return surfaceCache.get(key)
}

// ───────────────────────────── decals (signs, plates, logos) ─────────────────────────────

function decalMesh(items) {
  if (!items.length) return null
  const PAD = 6
  const widest = Math.max(...items.map((i) => i.pw))
  const W = Math.min(4096, Math.max(1024, THREE.MathUtils.ceilPowerOfTwo(widest + PAD * 2)))
  let x = PAD
  let y = PAD
  let rowH = 0
  for (const it of [...items].sort((a, b) => b.ph - a.ph)) {
    if (x + it.pw + PAD > W) {
      x = PAD
      y += rowH + PAD
      rowH = 0
    }
    it.px = x
    it.py = y
    x += it.pw + PAD
    rowH = Math.max(rowH, it.ph)
  }
  const H = y + rowH + PAD
  const paint = (ctx) => {
    ctx.clearRect(0, 0, W, H)
    for (const it of items) {
      ctx.save()
      it.draw(ctx, it.px, it.py, it.pw, it.ph)
      ctx.restore()
    }
  }
  const texture = canvasTexture(W, H, paint)
  const geos = items.map((it) => {
    const g = new THREE.PlaneGeometry(it.w, it.h)
    const uv = g.attributes.uv
    const u0 = it.px / W, u1 = (it.px + it.pw) / W
    const v1 = 1 - it.py / H, v0 = 1 - (it.py + it.ph) / H
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
    return g.toNonIndexed().applyMatrix4(it.matrix)
  })
  const geo = mergeGeometries(geos, false)
  for (const g of geos) g.dispose()
  const material = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.receiveShadow = true
  mesh.renderOrder = 1
  repaintWhenFontsReady(texture, paint)
  return mesh
}

// Canvas text needs the web font: if Inter isn't loaded yet, repaint the atlas when it arrives.
function repaintWhenFontsReady(texture, paint) {
  const fonts = typeof document !== 'undefined' ? document.fonts : null
  if (!fonts?.addEventListener) return
  const interReady = () => [...fonts].some((f) => f.family.includes('Inter') && f.status === 'loaded' && String(f.weight).includes('800'))
  if (interReady()) return
  const repaint = () => {
    paint(texture.image.getContext('2d'))
    texture.needsUpdate = true
    if (interReady()) fonts.removeEventListener('loadingdone', repaint)
  }
  fonts.addEventListener('loadingdone', repaint)
  for (const w of ['800', '700', '600']) fonts.load(`${w} 48px Inter`).catch(() => {})
}

let probe = null
const probeCtx = () => (probe ??= document.createElement('canvas').getContext('2d'))

function signMetrics(ctx, h, title, subtitle, panel) {
  const pad = panel ? h * 0.17 : h * 0.02
  const ih = h - pad * 2
  const logo = ih * (subtitle ? 0.88 : 0.8)
  const gap = h * 0.13
  const titleSize = ih * (subtitle ? 0.44 : 0.62)
  const subSize = ih * 0.22
  ctx.font = `800 ${titleSize}px ${FONT}`
  const tw = ctx.measureText(title).width
  let sw = 0
  if (subtitle) {
    ctx.font = `600 ${subSize}px ${FONT}`
    sw = ctx.measureText(subtitle).width
  }
  const width = pad * 2 + logo + gap + Math.max(tw, sw) + (panel ? h * 0.1 : 0)
  return { pad, ih, logo, gap, titleSize, subSize, width }
}

const signAspect = (title, subtitle, panel) => signMetrics(probeCtx(), 100, title, subtitle, panel).width / 100

function signPainter(title, subtitle, panel) {
  return (ctx, x, y, w, h) => {
    const m = signMetrics(ctx, h, title, subtitle, panel)
    if (panel) {
      ctx.fillStyle = '#ffffff'
      roundRect(ctx, x + 2, y + 2, w - 4, h - 4, h * 0.14)
      ctx.fill()
      ctx.strokeStyle = '#d7deee'
      ctx.lineWidth = Math.max(2, h * 0.03)
      ctx.stroke()
    }
    drawCubeLogo(ctx, x + m.pad + h * 0.03, y + m.pad + (m.ih - m.logo) / 2, m.logo)
    const tx = x + m.pad + h * 0.03 + m.logo + m.gap
    const maxW = Math.max(10, x + w - m.pad - tx)
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#2446cf'
    ctx.font = `800 ${m.titleSize}px ${FONT}`
    ctx.fillText(title, tx, y + m.pad + m.ih * (subtitle ? 0.52 : 0.74), maxW)
    if (subtitle) {
      ctx.fillStyle = '#6273b2'
      ctx.font = `600 ${m.subSize}px ${FONT}`
      ctx.fillText(subtitle, tx, y + m.pad + m.ih * 0.88, maxW)
    }
  }
}

const PLATE_H = 0.62
function plateWidth(text) {
  const ctx = probeCtx()
  ctx.font = `700 ${PLATE_H * 0.56 * 100}px ${FONT}`
  return Math.max(0.78, (ctx.measureText(text).width / 100) * 1.25 + 0.3)
}

function platePainter(text, onBlue) {
  return (ctx, x, y, w, h) => {
    ctx.fillStyle = onBlue ? '#f3f6ff' : '#2f5bea'
    roundRect(ctx, x + 1, y + 1, w - 2, h - 2, h * 0.2)
    ctx.fill()
    ctx.fillStyle = onBlue ? '#2f5bea' : '#ffffff'
    ctx.font = `700 ${h * 0.56}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x + w / 2, y + h * 0.55, w * 0.86)
  }
}

const logoPainter = (ctx, x, y, w, h) => {
  const s = Math.min(w, h)
  drawCubeLogo(ctx, x + (w - s) / 2, y + (h - s) / 2, s)
}

function badgePainter(label) {
  return (ctx, x, y, w, h) => {
    const r = w * 0.34
    const cx = x + w / 2
    const cy = y + r + w * 0.03
    ctx.fillStyle = '#dbe4ff'
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
    ctx.fill()
    const s = r * 1.1
    drawCubeLogo(ctx, cx - s / 2, cy - s / 2, s)
    if (!label) return
    // small label tucked under the badge's lower-left edge, as on the WH-01 roof
    ctx.fillStyle = '#ffffff'
    ctx.font = `800 ${w * 0.115}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, cx - r * 0.62, cy + r + w * 0.1, w * 0.6)
  }
}

// ───────────────────────────── shared parts ─────────────────────────────

/** A wall panel on `face` (extruded shape, outer surface at d = 0) with door openings cut out. */
function buildWall(b, face, doors, material) {
  const openings = doors.map((d) => ({ u0: d.u - d.width / 2, u1: d.u + d.width / 2, y0: d.y0, y1: d.y0 + d.height }))
  b.add(material, wallGeometry(face.u0, face.u1, 0, face.top, openings), face.matrix)
}

function wallGeometry(u0, u1, base, top, openings) {
  const notches = openings.filter((o) => o.y0 <= base + 1e-3).sort((a, c) => a.u0 - c.u0)
  const holes = openings.filter((o) => o.y0 > base + 1e-3)
  const shape = new THREE.Shape()
  shape.moveTo(u0, base)
  for (const n of notches) {
    shape.lineTo(n.u0, base)
    shape.lineTo(n.u0, n.y1)
    shape.lineTo(n.u1, n.y1)
    shape.lineTo(n.u1, base)
  }
  shape.lineTo(u1, base)
  for (let i = top.length - 1; i >= 0; i--) shape.lineTo(top[i][0], top[i][1])
  for (const h of holes) {
    const p = new THREE.Path()
    p.moveTo(h.u0, h.y0)
    p.lineTo(h.u1, h.y0)
    p.lineTo(h.u1, h.y1)
    p.lineTo(h.u0, h.y1)
    shape.holes.push(p)
  }
  return new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -T)
}

/** Frame, interior / shutter, bumpers, number plate (+ optional wall lamp) for one door. */
function addDoor(b, face, door, st, { onBlue = false, lamp = false, sideBox = false } = {}) {
  const { u, width: w, height: h, y0 } = door
  const { frameW: fw, frameD: fd } = st
  const frame = mat(st.frame)
  const l = u - w / 2
  const r = u + w / 2
  const top = y0 + h
  faceBox(b, face, frame, l - fw, l, y0, top + fw, -0.02, fd)
  faceBox(b, face, frame, r, r + fw, y0, top + fw, -0.02, fd)
  faceBox(b, face, frame, l - fw, r + fw, top, top + fw, -0.02, fd)

  if (door.state !== 'closed') doorInterior(b, face, door, st)
  if (door.state !== 'open') shutter(b, face, door, door.state === 'half' ? 0.4 : 1)
  else if (st.openShutter) shutter(b, face, door, st.openShutter) // rolled-up shutter peeking below the lintel

  if (st.bumpers) {
    for (const s of [-1, 1]) {
      const c = u + s * (w / 2 + fw / 2)
      faceBox(b, face, mat(COL.bumper), c - 0.17, c + 0.17, y0 + 0.12, y0 + 0.8, fd - 0.04, fd + 0.24)
    }
  }
  if (sideBox) faceBox(b, face, mat(COL.bumper), r + fw + 0.25, r + fw + 0.55, y0 + h * 0.42, y0 + h * 0.42 + 0.42, 0, 0.12)

  const text = door.number
  const pw = plateWidth(text)
  const dir = st.plateSide === 'left' ? -1 : 1
  const pu = u + dir * Math.max(0, w / 2 - pw / 2)
  const py = top + fw + 0.12 + PLATE_H / 2
  b.decal(pw, PLATE_H, 150, platePainter(text, onBlue), faceAt(face, pu, py, 0.03))
  if (lamp) faceBox(b, face, mat(COL.lamp), pu - dir * (pw / 2 + 0.75), pu - dir * (pw / 2 + 0.25), py - 0.1, py + 0.16, 0, 0.3)
}

function doorInterior(b, face, door, st) {
  const { u, width: w, height: h, y0 } = door
  const back = -T - st.recess
  const inner = -T + 0.02
  const opts = { cast: false, receive: false }
  const inside = mat(st.inside)
  const l = u - w / 2
  const r = u + w / 2
  faceBox(b, face, mat(COL.insideFloor), l - 0.06, r + 0.06, y0 - 0.06, y0 + 0.02, back, inner, opts)
  faceBox(b, face, inside, l - 0.06, r + 0.06, y0 + h, y0 + h + 0.06, back, inner, opts)
  faceBox(b, face, inside, l - 0.07, l - 0.01, y0, y0 + h, back, inner, opts)
  faceBox(b, face, inside, r + 0.01, r + 0.07, y0, y0 + h, back, inner, opts)
  faceBox(b, face, inside, l - 0.06, r + 0.06, y0, y0 + h, back - 0.06, back, opts)
  if (!door.cargo) return
  const k = st.cargoScale
  const d = -T - st.cargoDepth - 0.5 * k
  const stacks = w >= 2.5 * k + 0.25 ? st.stacks : 1
  const scale = M4().makeScale(k, k, k)
  for (let i = 0; i < stacks; i++) {
    const du = stacks === 1 ? (door.seed % 2 ? -0.2 : 0.15) * k : (i - 0.5) * 1.28 * k
    const layers = (st.layers ?? 3) - ((door.seed + i + 1) % 2)
    const m = chain(faceAt(face, u + du, y0 + 0.02, d), ry((door.seed + i) % 2 ? 0.05 : -0.04), scale)
    cargoStack(b, m, door.seed * 7 + i, layers, opts)
  }
}

function shutter(b, face, door, frac) {
  const { u, width: w, height: h, y0 } = door
  const y1 = y0 + h
  const ys = y1 - h * frac
  faceBox(b, face, surfaceMat(C.doorRoll, 'slat', 0.3), u - w / 2 - 0.03, u + w / 2 + 0.03, ys, y1, -0.2, -0.12)
  faceBox(b, face, mat(COL.rail), u - w / 2, u + w / 2, ys, ys + 0.2, -0.2, -0.09)
}

/** Pallet of cardboard boxes; `m` = base centre (pallet 1.2 along local X, 1.0 along Z). */
function cargoStack(b, m, seed, layers, opts) {
  const r = rng(seed)
  b.boxMM(mat(C.wood), -0.6, 0.1, -0.5, 0.6, 0.15, 0.5, m, opts)
  for (const x of [-0.52, 0, 0.52]) b.boxMM(mat(C.woodDark), x - 0.07, 0, -0.5, x + 0.07, 0.1, 0.5, m, opts)
  const colors = [C.cardboard, C.cardboardLight, C.cardboardDark]
  let y = 0.15
  for (let l = 0; l < layers; l++) {
    const bh = 0.4 + r() * 0.06
    for (const [ix, iz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = ix * 0.3 + (r() - 0.5) * 0.04
      const cz = iz * 0.245 + (r() - 0.5) * 0.04
      b.boxMM(mat(colors[Math.floor(r() * 3)]), cx - 0.285, y, cz - 0.235, cx + 0.285, y + bh - 0.015, cz + 0.235, m, opts)
      if (l === layers - 1) b.boxMM(mat(C.tape), cx - 0.05, y + bh - 0.015, cz - 0.236, cx + 0.05, y + bh - 0.004, cz + 0.236, m, opts)
    }
    y += bh
  }
}

/** Rooftop condenser / AC unit; `m` = base centre, long axis along local X. */
function acUnit(b, m, { w = 2.4, d = 1.3, h = 0.75 } = {}) {
  b.boxMM(mat(COL.acBase), -w / 2 - 0.06, 0, -d / 2 - 0.06, w / 2 + 0.06, 0.14, d / 2 + 0.06, m)
  b.boxMM(mat(C.white), -w / 2, 0.14, -d / 2, w / 2, 0.14 + h, d / 2, m)
  const r = Math.min(d * 0.36, w * 0.2)
  for (const sx of [-0.25, 0.25]) {
    b.cyl(mat(COL.fan), r, 0.06, chain(m, tr(sx * w, 0.14 + h + 0.02, 0)))
    b.cyl(mat(C.hub), r * 0.3, 0.08, chain(m, tr(sx * w, 0.14 + h + 0.03, 0)))
  }
}

function skylight(b, cx, cz, len, wid, y) {
  b.boxMM(mat(COL.skyFrame), cx - len / 2 - 0.25, y, cz - wid / 2 - 0.25, cx + len / 2 + 0.25, y + 0.22, cz + wid / 2 + 0.25)
  b.boxMM(mat(COL.skylight, { roughness: 0.45 }), cx - len / 2, y, cz - wid / 2, cx + len / 2, y + 0.34, cz + wid / 2)
}

/** Flat roof slab sunk `parapet` below the wall tops, plus an optional cap on the parapet. */
function flatRoof(b, v, top, { parapet = 0.7, material = mat(C.roofWhite), cap = null, capH = 0.2 } = {}) {
  const y = top - parapet
  b.boxMM(material, v.x0 + T - 0.02, y - 0.3, v.z0 + T - 0.02, v.x1 - T + 0.02, y, v.z1 - T + 0.02)
  if (cap) {
    const o = 0.07
    b.boxMM(cap, v.x0 - o, top, v.z1 - T - o, v.x1 + o, top + capH, v.z1 + o)
    b.boxMM(cap, v.x0 - o, top, v.z0 - o, v.x1 + o, top + capH, v.z0 + T + o)
    b.boxMM(cap, v.x1 - T - o, top, v.z0 + T + o, v.x1 + o, top + capH, v.z1 - T - o)
    b.boxMM(cap, v.x0 - o, top, v.z0 + T + o, v.x0 + T + o, top + capH, v.z1 - T - o)
  }
  return y
}

/** Horizontal band on a face, wrapping the corners (south/north bands overlap the corner posts). */
function band(b, face, material, y0, y1, out = 0.05, u0 = face.fullU0, u1 = face.fullU1) {
  const ext = FACES[face.side].axis === 'x' ? out : 0
  faceBox(b, face, material, u0 - ext, u1 + ext, y0, y1, -0.01, out)
}

/** Vertical corner trims; heightAt(corner) → trim height; corners like 'se', 'nw'. */
function cornerTrims(b, v, heightAt, tw, material, corners = ['se', 'sw', 'ne', 'nw'], out = 0.07) {
  for (const c of corners) {
    const east = c.includes('e')
    const south = c.includes('s')
    const x = east ? v.x1 : v.x0
    const z = south ? v.z1 : v.z0
    const [xa, xb] = east ? [x - tw + out, x + out] : [x - out, x + tw - out]
    const [za, zb] = south ? [z - tw + out, z + out] : [z - out, z + tw - out]
    b.boxMM(material, xa, 0, za, xb, heightAt(c), zb)
  }
}

/** Gaps along a face that are free of doors (+frames and margin), in u. */
function freeGaps(face, doors, fw, margin, edge = 1) {
  const spans = doors.map((d) => [d.u - d.width / 2 - fw - margin, d.u + d.width / 2 + fw + margin]).sort((a, c) => a[0] - c[0])
  const gaps = []
  let cur = face.fullU0 + edge
  for (const [a, c] of spans) {
    if (a - cur > 0.05) gaps.push([cur, a])
    cur = Math.max(cur, c)
  }
  if (face.fullU1 - edge - cur > 0.05) gaps.push([cur, face.fullU1 - edge])
  return gaps
}

function pickGap(gaps, prefer, face) {
  if (!gaps.length) return null
  const size = (g) => g[1] - g[0]
  const widest = gaps.reduce((a, g) => (size(g) > size(a) ? g : a))
  if (prefer === 'end') {
    const last = gaps[gaps.length - 1]
    return size(last) >= Math.min(6, size(widest) * 0.5) ? last : widest
  }
  if (prefer === 'centre') {
    const c = (face.fullU0 + face.fullU1) / 2
    const dist = (g) => Math.abs((g[0] + g[1]) / 2 - c)
    return gaps.filter((g) => size(g) > 1).reduce((a, g) => (dist(g) < dist(a) ? g : a), widest)
  }
  return widest
}

/** "WareTrack" wall sign (cube logo + title + subtitle). fit = shrink into a door-free gap. */
function wallSign(b, face, doors, st, s, { y, h, prefer = 'widest', panel = false, fit = true, align = 'centre' }) {
  const aspect = signAspect(s.sign, s.subtitle, panel)
  const gap = pickGap(freeGaps(face, doors, st.frameW, fit ? 0.5 : 0), prefer, face)
  if (!gap) return
  let w = h * aspect
  if (fit && w > gap[1] - gap[0]) {
    w = gap[1] - gap[0]
    h = w / aspect
  }
  if (h < 0.5) return
  const u = align === 'end' ? gap[1] - w / 2 : (gap[0] + gap[1]) / 2
  b.decal(w, h, 120, signPainter(s.sign, s.subtitle, panel), faceAt(face, u, y, panel ? 0.06 : 0.03))
}

function roofDecal(b, size, draw, x, y, z, ppm = 70) {
  b.decal(size, size, ppm, draw, chain(tr(x, y + 0.03, z), rx(-Math.PI / 2)))
}

// ───────────────────────────── variant: depot (WH-01) ─────────────────────────────
// Three joined blue corrugated halls: a low west annex, a tall rear hall (ridge N–S) and a long
// front hall (ridge E–W) whose south facade is light grey with the big framed dock doors.

// x where the annex meets the tall hall (xB) and the tall hall meets the front hall (xC)
const depotSplits = (W) => ({ xB: -W / 2 + 0.15 * W, xC: -W / 2 + 0.42 * W })

function depotLayout(s) {
  const { width: W, depth: D, height: H } = s
  const { xB, xC } = depotSplits(W)
  // south faces almost flush; the annex and tall hall are shallower than the footprint and the
  // tall hall's low-pitch gable faces south (frames 01, 02, 04, 25)
  const halls = [
    { name: 'annex', x0: -W / 2, x1: xB, z0: D / 2 - 0.63 * D, z1: D / 2 - 0.03 * D, he: 0.56 * H, hr: 0.66 * H, ridge: 'z' },
    { name: 'rear', x0: xB, x1: xC, z0: -D / 2 + 0.1 * D, z1: D / 2 - 0.04 * D, he: 0.89 * H, hr: H, ridge: 'z' },
    { name: 'front', x0: xC, x1: W / 2, z0: -D / 2 + 0.26 * D, z1: D / 2, he: 0.71 * H, hr: 0.85 * H, ridge: 'x' },
  ]
  return { halls, faces: halls.flatMap((h) => volumeFaces(h, (side) => hallTop(h, side))) }
}

function depotDoors({ width: W, depth: D }) {
  const { xB, xC } = depotSplits(W)
  const span = W / 2 - xC
  return [
    { id: 'D1', side: 'south', offset: xC + 0.72 * span, number: '1' },
    { id: 'D2', side: 'south', offset: xC + 0.22 * span, number: '2' },
    { id: 'D3', side: 'south', offset: (xB + xC) / 2, number: '3' },
    { id: 'D4', side: 'east', offset: 0.17 * D, number: '4' },
  ]
}

function hallTop(h, side) {
  const alongX = h.ridge === 'x'
  const gableEnd = alongX ? side === 'east' || side === 'west' : side === 'south' || side === 'north'
  if (!gableEnd) return flatTop(h, h.he)(side)
  const [c0, c1] = alongX ? [h.z0, h.z1] : [h.x0, h.x1]
  return [[c0, h.he], [(c0 + c1) / 2, h.hr], [c1, h.he]]
}

function buildDepot(b, s, L, doorsByFace) {
  const st = STYLE.depot
  const blue = surfaceMat(C.blue, 'rib', 0.42)
  const grey = surfaceMat(COL.greyWall, 'rib', 0.42)
  const roof = surfaceMat(COL.roofBlue, 'roofRib', 0.42)
  const [annex, , front] = L.halls

  for (const face of L.faces) {
    const facade = face.volume === front && face.side === 'south'
    const doors = doorsByFace.get(face)
    buildWall(b, face, doors, facade ? grey : blue)
    for (const d of doors) addDoor(b, face, d, st, { onBlue: !facade, lamp: !facade })
  }
  for (const h of L.halls) gableRoof(b, h, { material: roof, cap: mat(COL.ridge), oh: 0.6 })

  // blue posts framing the grey facade
  cornerTrims(b, front, () => front.he, 0.55, mat(C.blue), ['sw', 'se'], 0.06)

  // round roof badge with the cube logo + site label on the front hall's south slope
  const zc = (front.z0 + front.z1) / 2
  const run = (front.z1 - front.z0) / 2
  const p = Math.atan2(front.hr - front.he, run)
  const zb = zc + run * 0.55
  const yb = front.hr - (zb - zc) * Math.tan(p) + 0.35 / Math.cos(p) + 0.04
  const size = clamp(run * 0.85, 3, 9)
  const xb = (front.x0 + front.x1) / 2 - (front.x1 - front.x0) * 0.08
  b.decal(size, size * 1.12, 70, badgePainter(s.label), chain(tr(xb, yb, zb), rx(p), rx(-Math.PI / 2)))

  // small facade sign beside the first door's number plate, under the eave (frames 01, 02)
  const facade = L.faces.find((f) => f.volume === front && f.side === 'south')
  const fdoors = doorsByFace.get(facade)
  if (fdoors.length) depotSign(b, facade, fdoors, st, s, front.he)
  else wallSign(b, facade, fdoors, st, s, { y: front.he * 0.6, h: 1.25 })

  // personnel door on the annex
  const af = L.faces.find((f) => f.volume === annex && f.side === 'south')
  if (af.u1 - af.u0 > 3 && !doorsByFace.get(af).length) faceBox(b, af, mat(C.white), af.u1 - 1.6, af.u1 - 0.6, 0, 2.5, -0.02, 0.07)
}

/** Painted "WareTrack" sign right of the westmost facade door's number plate, below the eave. */
function depotSign(b, face, doors, st, s, eave) {
  const d = doors.reduce((a, c) => (c.u < a.u ? c : a))
  const top = d.y0 + d.height + st.frameW
  const x0 = d.u - d.width / 2 + plateWidth(d.number) + 0.3
  const x1 = doors.filter((o) => o.u > d.u).reduce((m, o) => Math.min(m, o.u - o.width / 2 - st.frameW - 0.3), face.u1 - 0.5)
  const aspect = signAspect(s.sign, s.subtitle, false)
  const w = Math.min(Math.min(0.95, eave - top - 0.3) * aspect, x1 - x0)
  const h = w / aspect
  if (h < 0.35) return
  b.decal(w, h, 140, signPainter(s.sign, s.subtitle, false), faceAt(face, x0 + w / 2, top + 0.12 + h / 2, 0.03))
}

/** Gable roof: two corrugated slabs resting on the wall tops, overhanging (+ optional ridge cap). */
function gableRoof(b, h, { material, cap = null, oh = 0.6, thick = 0.35 }) {
  const alongX = h.ridge === 'x'
  const [a0, a1] = alongX ? [h.x0, h.x1] : [h.z0, h.z1]
  const [c0, c1] = alongX ? [h.z0, h.z1] : [h.x0, h.x1]
  const ac = (a0 + a1) / 2
  const cc = (c0 + c1) / 2
  const run = (c1 - c0) / 2
  const p = Math.atan2(h.hr - h.he, run)
  const len = a1 - a0 + 2 * oh
  const slope = (run + oh) / Math.cos(p)
  // canonical frame: ridge along X, slab descending toward +Z
  const base = alongX ? tr(ac, h.hr, cc) : chain(tr(cc, h.hr, ac), ry(Math.PI / 2))
  for (const flip of [0, Math.PI]) {
    b.box(material, len, thick, slope, chain(base, ry(flip), rx(p), tr(0, thick / 2, slope / 2)))
  }
  if (cap) b.box(cap, len, 0.16, 0.55, chain(base, tr(0, thick * Math.cos(p) + 0.04, 0)))
}

// ───────────────────────────── variant: dc (WH-02) ─────────────────────────────
// Long white distribution centre: flat roof with a blue parapet band, a row of open dock doors,
// a blue glass office block on the west end, skylights and AC units on the roof.

function dcLayout(s) {
  const { width: W, depth: D, height: H } = s
  const officeW = clamp(0.15 * W, 9, 16)
  const main = { x0: -W / 2 + officeW, x1: W / 2, z0: -D / 2, z1: D / 2 }
  const office = { x0: -W / 2, x1: main.x0, z0: -D / 2 + 0.1 * D, z1: D / 2 - 0.16 * D, h: H - 0.5 }
  return { main, office, faces: volumeFaces(main, flatTop(main, H)) }
}

function dcDoors({ width: W }) {
  const x0 = -W / 2 + clamp(0.15 * W, 9, 16)
  const len = W / 2 - x0
  return Array.from({ length: 8 }, (_, i) => ({ id: `D${i + 1}`, side: 'south', offset: x0 + len * (0.1 + (i * 0.8) / 7), number: `D${i + 1}` }))
}

function buildDc(b, s, L, doorsByFace) {
  const st = STYLE.dc
  const H = s.height
  const { main } = L
  const wall = surfaceMat(C.wall, 'panel', 1.25)
  for (const face of L.faces) {
    const doors = doorsByFace.get(face)
    buildWall(b, face, doors, wall)
    for (const d of doors) addDoor(b, face, d, st)
    band(b, face, mat(COL.navy), H - 1.6, H - 0.65)
  }
  const roofY = flatRoof(b, main, H, { cap: mat(COL.navy), capH: 0.22 })
  cornerTrims(b, main, () => H, 0.32, mat(COL.navy))
  glassOffice(b, L.office, s)

  // roof: staggered skylight strips (north half) + AC units
  const len = main.x1 - main.x0
  const D = main.z1 - main.z0
  for (const [gx, rows] of [[0.24, [-0.33, -0.17, -0.01]], [0.66, [-0.33, -0.17]]]) {
    rows.forEach((rz, i) => skylight(b, main.x0 + len * gx + i * 5, rz * D, len * 0.22, 1.6, roofY))
  }
  acUnit(b, tr(main.x0 + 6, roofY, main.z1 - 6))
  acUnit(b, chain(tr(main.x1 - 9, roofY, main.z0 + 6), ry(Math.PI / 2)))

  // panel sign under the parapet band, between the doors nearest the facade centre
  const south = L.faces.find((f) => f.side === 'south')
  wallSign(b, south, doorsByFace.get(south), st, s, { y: H - 2.75, h: 1.7, prefer: 'centre', panel: true, fit: false })
}

function glassOffice(b, o, s) {
  const H = o.h
  const gy = H - 0.85
  const glass = mat(COL.glass, { roughness: 0.32 })
  const white = mat(C.white)
  const mull = mat(COL.mullion)
  b.boxMM(glass, o.x0 + 0.1, 0, o.z1 - 0.32, o.x1, gy, o.z1 - 0.1)
  b.boxMM(glass, o.x0 + 0.1, 0, o.z0 + 0.1, o.x1, gy, o.z0 + 0.32)
  b.boxMM(glass, o.x0 + 0.1, 0, o.z0 + 0.1, o.x0 + 0.32, gy, o.z1 - 0.1)
  b.boxMM(white, o.x0 - 0.05, gy, o.z0 - 0.05, o.x1, H, o.z1 + 0.05)
  for (const [x, z] of [[o.x0, o.z1], [o.x0, o.z0]]) b.boxMM(white, x - 0.08, 0, z - 0.3, x + 0.45, gy, z + 0.3)

  // curtain-wall mullion grid on the three glass faces
  const cols = (a, c) => {
    const n = Math.max(2, Math.round((c - a) / 2.7))
    return Array.from({ length: n - 1 }, (_, i) => a + ((i + 1) * (c - a)) / n)
  }
  const rows = Array.from({ length: Math.max(1, Math.floor(gy / 2.25)) }, (_, i) => (i + 1) * (gy / (Math.floor(gy / 2.25) + 1)))
  for (const z of [o.z1, o.z0]) {
    const zz = z > 0 ? [z - 0.14, z - 0.02] : [z + 0.02, z + 0.14]
    for (const x of cols(o.x0, o.x1)) b.boxMM(mull, x - 0.08, 0, zz[0], x + 0.08, gy, zz[1])
    for (const y of [0.1, ...rows]) b.boxMM(mull, o.x0, y - 0.08, zz[0], o.x1, y + 0.08, zz[1])
  }
  for (const z of cols(o.z0, o.z1)) b.boxMM(mull, o.x0 - 0.02, 0, z - 0.08, o.x0 + 0.14, gy, z + 0.08)
  for (const y of [0.1, ...rows]) b.boxMM(mull, o.x0 - 0.02, y - 0.08, o.z0, o.x0 + 0.14, y + 0.08, o.z1)

  const face = makeFace('south', o.z1, o.x0, o.x1)
  const h = 1.25
  const w = Math.min(h * signAspect(s.sign, s.subtitle, true), o.x1 - o.x0 - 1.5)
  b.decal(w, w / signAspect(s.sign, s.subtitle, true), 120, signPainter(s.sign, s.subtitle, true), faceAt(face, o.x0 + 0.6 + w / 2, gy - 1.35, 0.06))
}

// ───────────────────────────── variant: cold (WH-03) ─────────────────────────────
// White insulated cold store: blue corner trims and roof band, rows of condensers on the roof,
// a lower plant annex on the west, and a raised loading platform with a yellow edge on the south.

function coldLayout(s) {
  const { width: W, depth: D, height: H } = s
  const annexW = clamp(0.16 * W, 8, 14)
  const main = { x0: -W / 2 + annexW, x1: W / 2, z0: -D / 2, z1: D / 2 }
  const annex = { x0: -W / 2, x1: main.x0, z0: -D / 2 + 0.2 * D, z1: D / 2 - 0.06 * D, h: 0.55 * H }
  const faces = [
    ...volumeFaces(main, flatTop(main, H), { south: { doorBase: PLATFORM_H, platform: PLATFORM_D } }),
    ...volumeFaces(annex, flatTop(annex, annex.h)),
  ]
  return { main, annex, faces }
}

function coldDoors({ width: W }) {
  const x0 = -W / 2 + clamp(0.16 * W, 8, 14)
  const len = W / 2 - x0
  return [0.36, 0.52, 0.68, 0.84].map((f, i) => ({ id: `D${i + 1}`, side: 'south', offset: x0 + len * f, width: 3.2, height: 4.4, number: `D${i + 1}` }))
}

function buildCold(b, s, L, doorsByFace) {
  const st = STYLE.cold
  const H = s.height
  const { main, annex } = L
  const wall = surfaceMat(C.wall, 'panel', 1.4)
  const trim = mat(C.doorFrame)
  for (const face of L.faces) {
    const doors = doorsByFace.get(face)
    buildWall(b, face, doors, wall)
    for (const d of doors) addDoor(b, face, d, st, { sideBox: true })
    if (face.volume === main) {
      seams(b, face, doors, H - 1.1)
      if (face.side === 'south' || face.side === 'east') band(b, face, trim, H - 0.95, H - 0.3)
    }
  }
  const roofY = flatRoof(b, main, H, { cap: mat(C.white), capH: 0.16 })
  const annexY = flatRoof(b, annex, annex.h, { parapet: 0.5, cap: mat(C.white), capH: 0.14 })
  cornerTrims(b, main, () => H, 0.4, trim)
  cornerTrims(b, annex, () => annex.h, 0.34, trim, ['sw', 'nw'])

  const south = L.faces.find((f) => f.volume === main && f.side === 'south')
  coldPlatform(b, main, doorsByFace.get(south))

  // condensers: two N–S rows near the long edges + a row on the annex
  const mw = main.x1 - main.x0
  const D = main.z1 - main.z0
  const n = clamp(Math.round((D - 10) / 8), 3, 6)
  for (const x of [main.x0 + mw * 0.15, main.x1 - mw * 0.1]) {
    for (let i = 0; i < n; i++) {
      const z = main.z0 + 6 + ((D - 12) * i) / (n - 1)
      acUnit(b, chain(tr(x, roofY, z), ry(Math.PI / 2)), { w: 3.4, d: 1.7, h: 0.95 })
    }
  }
  const az = (annex.z0 + annex.z1) / 2
  for (const dz of [-7, 0, 7]) acUnit(b, chain(tr((annex.x0 + annex.x1) / 2, annexY, az + dz), ry(Math.PI / 2)), { w: 3.2, d: 1.6, h: 0.9 })

  roofDecal(b, clamp(D * 0.12, 3.5, 6.5), logoPainter, main.x0 + mw * 0.52, roofY, 0)

  const doors = doorsByFace.get(south)
  const signY = PLATFORM_H + (doors.length ? doors[0].height * 0.62 : 3)
  wallSign(b, south, doors, st, s, { y: signY, h: 1.7, prefer: 'end', panel: true })
}

/** Subtle vertical panel joints every ~12 m, skipping doors. */
function seams(b, face, doors, top) {
  const len = face.fullU1 - face.fullU0
  const n = Math.max(1, Math.round(len / 12))
  for (let i = 1; i < n; i++) {
    const u = face.fullU0 + (len * i) / n
    if (doors.some((d) => Math.abs(d.u - u) < d.width / 2 + 0.8)) continue
    faceBox(b, face, mat(COL.seam), u - 0.1, u + 0.1, 0, top, -0.01, 0.05)
  }
}

function coldPlatform(b, main, doors) {
  const z0 = main.z1
  const z1 = main.z1 + PLATFORM_D
  const za = main.z1 + PLATFORM_APRON
  const firstX = doors.length ? Math.min(...doors.map((d) => d.u - d.width / 2)) : main.x1
  const apronX1 = firstX - 3.5
  const apron = apronX1 - main.x0 >= 6
  const body = mat(COL.platform)
  const yellow = mat(C.yellowLine)
  const ph = PLATFORM_H
  b.boxMM(body, main.x0, 0, z0 - 0.05, main.x1, ph, z1)
  if (apron) b.boxMM(body, main.x0, 0, z1 - 0.05, apronX1, ph, za)

  const yw = 0.24
  const y1 = ph + 0.025
  b.boxMM(yellow, apron ? apronX1 : main.x0, ph, z1 - yw, main.x1, y1, z1)
  b.boxMM(yellow, main.x1 - yw, ph, z0, main.x1, y1, z1)
  if (apron) {
    b.boxMM(yellow, main.x0, ph, za - yw, apronX1, y1, za)
    b.boxMM(yellow, apronX1 - yw, ph, z1 - yw, apronX1, y1, za)
    b.boxMM(yellow, main.x0, ph, z0, main.x0 + yw, y1, za)
    for (let i = 0; i < 4; i++) {
      const x = main.x0 + 2.4 + i * 1.5
      b.boxMM(mat(C.white), x - 0.55, ph, z0 + 1.3, x + 0.55, ph + 1.25, z0 + 1.7)
    }
  } else {
    b.boxMM(yellow, main.x0, ph, z0, main.x0 + yw, y1, z1)
  }
  for (const d of doors) {
    b.boxMM(mat(COL.leveller), d.u - 1.2, ph, z1 - 1.9, d.u + 1.2, ph + 0.04, z1 - 0.03)
    for (const sx of [-1, 1]) b.boxMM(mat(COL.bumper), d.u + sx * 1.45 - 0.18, ph - 0.8, z1, d.u + sx * 1.45 + 0.18, ph - 0.12, z1 + 0.24)
  }
}

// ───────────────────────────── variant: crossdock (WH-04) ─────────────────────────────
// White corrugated walls under a blue sawtooth roof (risers face west), dock doors on two faces,
// a large WareTrack sign near the south-east corner and on the east face.

function crossdockLayout(s) {
  const { width: W, depth: D, height: H } = s
  const main = { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 }
  const teeth = clamp(Math.round(W / 12.5), 3, 8)
  const hPeak = H + clamp(0.36 * H, 2, 3.8)
  const tw = W / teeth
  const saw = [[main.x0, hPeak]]
  for (let i = 1; i < teeth; i++) saw.push([main.x0 + i * tw, H], [main.x0 + i * tw, hPeak])
  saw.push([main.x1, H])
  const top = (side) => {
    if (side === 'south' || side === 'north') return saw
    return flatTop(main, side === 'east' ? H : hPeak)(side)
  }
  return { main, teeth, hPeak, faces: volumeFaces(main, top) }
}

function crossdockDoors({ width: W, depth: D }) {
  const south = [0.12, 0.3, 0.48, 0.66].map((f, i) => ({ id: i < 3 ? `IN${i + 1}` : 'S4', side: 'south', offset: -W / 2 + W * f, number: i < 3 ? `${i + 1}` : '4' }))
  const east = [0.16, 0.36, 0.56, 0.76].map((f, i) => ({ id: i < 3 ? `OUT${i + 1}` : 'E4', side: 'east', offset: D / 2 - D * f, number: `${i + 5}` }))
  return [...south, ...east]
}

function buildCrossdock(b, s, L, doorsByFace) {
  const st = STYLE.crossdock
  const H = s.height
  const { main } = L
  const wall = surfaceMat(COL.crossWall, 'panel', 0.55)
  for (const face of L.faces) {
    const doors = doorsByFace.get(face)
    buildWall(b, face, doors, wall)
    for (const d of doors) addDoor(b, face, d, st)
  }
  sawtoothRoof(b, main, { n: L.teeth, hWall: H, hPeak: L.hPeak, material: surfaceMat(COL.roofBlue, 'panel', 1.1), riser: wall })
  cornerTrims(b, main, (c) => (c.includes('w') ? L.hPeak : H), 0.45, mat(C.blue))

  const south = L.faces.find((f) => f.side === 'south')
  const east = L.faces.find((f) => f.side === 'east')
  const doorTop = (doors) => (doors.length ? Math.max(...doors.map((d) => d.y0 + d.height)) : DOOR_H)
  wallSign(b, south, doorsByFace.get(south), st, s, { y: doorTop(doorsByFace.get(south)) + 0.2, h: 2.3, prefer: 'end' })
  wallSign(b, east, doorsByFace.get(east), st, s, { y: doorTop(doorsByFace.get(east)) + 0.2, h: 1.9, prefer: 'end', align: 'end' })
}

/** Sawtooth roof: n blue slabs descending toward +X, white risers on each tooth's west side.
 *  The slabs barely overhang the south/north walls so the zigzag gable profile stays readable. */
function sawtoothRoof(b, v, { n, hWall, hPeak, material, riser, oh = 0.6, ohZ = 0.12, thick = 0.35 }) {
  const tw = (v.x1 - v.x0) / n
  const p = Math.atan2(hPeak - hWall, tw)
  const lenZ = v.z1 - v.z0 + 2 * ohZ
  const zc = (v.z0 + v.z1) / 2
  for (let i = 0; i < n; i++) {
    const xs = v.x0 + i * tw
    const lead = 0.3 // also caps the riser below this tooth's high edge
    const tail = i === n - 1 ? oh : 0
    const slope = (tw + lead + tail) / Math.cos(p)
    const m = chain(tr(xs - lead, hPeak + lead * Math.tan(p), zc), rz(-p), tr(slope / 2, thick / 2, 0))
    b.box(material, slope, thick, lenZ, m)
    if (i < n - 1) b.boxMM(riser, xs + tw - T, hWall - 0.3, v.z0 + 0.01, xs + tw, hPeak, v.z1 - 0.01)
  }
}

// ───────────────────────────── variant: robotics (WH-05) ─────────────────────────────
// Very large white automated DC: thin dark-blue parapet line, blue band, base line and corner trims,
// closed roller doors, skylight strips, a few AC units and the cube logo on the roof.

function roboticsLayout(s) {
  const { width: W, depth: D, height: H } = s
  const main = { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 }
  return { main, faces: volumeFaces(main, flatTop(main, H)) }
}

function roboticsDoors({ width: W }) {
  return [-0.26, -0.09, 0.08, 0.25].map((f, i) => ({ id: `D${i + 1}`, side: 'south', offset: W * f, state: 'closed', number: `D${i + 1}` }))
}

function buildRobotics(b, s, L, doorsByFace) {
  const st = STYLE.robotics
  const H = s.height
  const { main } = L
  const wall = surfaceMat(C.wall, 'panel', 1.5)
  const line = mat(C.doorFrame)
  for (const face of L.faces) {
    const doors = doorsByFace.get(face)
    buildWall(b, face, doors, wall)
    for (const d of doors) addDoor(b, face, d, st)
    band(b, face, mat(C.blueMid), H - 1.8, H - 0.75)
    for (const [a, c] of freeGaps(face, doors, st.frameW, 0, 0)) band(b, face, line, 0.95, 1.1, 0.04, a, c)
  }
  const roofY = flatRoof(b, main, H, { cap: line, capH: 0.22 })
  cornerTrims(b, main, () => H, 0.3, line)

  const W = main.x1 - main.x0
  const D = main.z1 - main.z0
  for (const [gx, rows] of [[-0.22, [-0.25, -0.1, 0.05]], [0.2, [-0.36, -0.21, -0.06]]]) {
    for (const rz of rows) skylight(b, W * gx, D * rz, W * 0.26, 1.9, roofY)
  }
  for (const [fx, fz] of [[-0.17, 0.37], [-0.09, 0.37], [0.37, -0.4], [0.43, -0.4]]) acUnit(b, tr(W * fx, roofY, D * fz))
  roofDecal(b, clamp(D * 0.1, 4, 7), logoPainter, W * 0.38, roofY, D * 0.06)

  const south = L.faces.find((f) => f.side === 'south')
  wallSign(b, south, doorsByFace.get(south), st, s, { y: H - 3.1, h: 2.2, prefer: 'centre', fit: false })
}

// ───────────────────────────── registry & misc ─────────────────────────────

const VARIANTS = {
  depot: { layout: depotLayout, build: buildDepot, doors: depotDoors },
  dc: { layout: dcLayout, build: buildDc, doors: dcDoors },
  cold: { layout: coldLayout, build: buildCold, doors: coldDoors },
  crossdock: { layout: crossdockLayout, build: buildCrossdock, doors: crossdockDoors },
  robotics: { layout: roboticsLayout, build: buildRobotics, doors: roboticsDoors },
}

function rng(seed) {
  let t = (seed * 2654435761) >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
