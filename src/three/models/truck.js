// Box truck (SPEC §4.1): chunky, toy-like delivery truck with per-carrier liveries.
// Origin = ground centre of the footprint, facing +Z (cab at +Z), 1 unit = 1 m.
//
// Everything heavy is built once and cached: per (carrier, reefer) one vertex-coloured body
// geometry, per carrier one livery atlas (both box sides + rear doors on a single canvas), and one
// wheel geometry for all trucks. A truck instance is therefore 8 draw calls (body, livery, 6 wheels)
// and allocates no new GPU memory.
//
// Also exports the small geometry helpers (PartList, createWheelGeometry, vertexColorMaterial)
// reused by forklift.js.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { C, mat, shadows } from '../palette.js'
import { canvasTexture, drawCubeLogo, roundRect, FONT } from '../canvasText.js'

// ───────────────────────────── shared helpers ─────────────────────────────

/** The one material every vertex-coloured vehicle mesh shares (palette-cached). */
export const vertexColorMaterial = () => mat(0xffffff, { vertexColors: true })

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _one = new THREE.Vector3(1, 1, 1)
const _c = new THREE.Color()

/**
 * Collects primitives, each painted one flat colour (as a vertex colour), and merges them into a
 * single geometry → one draw call with vertexColorMaterial(). Positions are centres, rotations are
 * Euler XYZ radians applied before the move.
 */
export class PartList {
  constructor() {
    this.parts = []
  }

  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    if (geo.index) {
      // RoundedBoxGeometry is non-indexed, so everything is merged non-indexed
      const flat = geo.toNonIndexed()
      geo.dispose()
      geo = flat
    }
    if (geo.attributes.uv) geo.deleteAttribute('uv')
    geo.applyMatrix4(_m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _one))
    _c.set(color)
    const n = geo.attributes.position.count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) colors.set([_c.r, _c.g, _c.b], i * 3)
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.parts.push(geo)
    return this
  }

  box(w, h, d, color, x, y, z, rx, ry, rz) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz)
  }

  /** Rounded box; corner smoothness scales with the radius to keep triangle counts low. */
  rbox(w, h, d, r, color, x, y, z, rx, ry, rz) {
    const segments = r >= 0.12 ? 3 : r >= 0.06 ? 2 : 1
    return this.add(new RoundedBoxGeometry(w, h, d, segments, r), color, x, y, z, rx, ry, rz)
  }

  /** Cylinder along local Y (rotate with rx / rz to lay it down). */
  cyl(r, len, color, x, y, z, rx = 0, ry = 0, rz = 0, seg = 16) {
    return this.add(new THREE.CylinderGeometry(r, r, len, seg), color, x, y, z, rx, ry, rz)
  }

  sphere(r, color, x, y, z, seg = 14) {
    return this.add(new THREE.SphereGeometry(r, seg, Math.ceil(seg * 0.7)), color, x, y, z)
  }

  merge() {
    const geo = mergeGeometries(this.parts)
    for (const p of this.parts) p.dispose()
    this.parts = []
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  }
}

/**
 * Outward-facing vertical strip hugging a rounded-rectangle outline (centred on x = 0, front face
 * at zFront, corner radius r): left side from zBack → front-left arc → front → front-right arc →
 * right side back to zBack. zBack = null gives only the front + corners. Used for the wrap-around
 * windscreen and the cab stripes.
 */
export function wrapStrip(halfW, zFront, r, zBack, y0, y1, off = 0.01, arcSeg = 6) {
  const R = r + off
  const pts = [] // [x, z, nx, nz]
  if (zBack !== null) pts.push([-halfW - off, zBack, -1, 0])
  for (let i = 0; i <= arcSeg; i++) {
    const a = Math.PI - (i / arcSeg) * (Math.PI / 2)
    pts.push([-halfW + r + R * Math.cos(a), zFront - r + R * Math.sin(a), Math.cos(a), Math.sin(a)])
  }
  for (let i = 0; i <= arcSeg; i++) {
    const a = Math.PI / 2 - (i / arcSeg) * (Math.PI / 2)
    pts.push([halfW - r + R * Math.cos(a), zFront - r + R * Math.sin(a), Math.cos(a), Math.sin(a)])
  }
  if (zBack !== null) pts.push([halfW + off, zBack, 1, 0])

  const pos = []
  const nrm = []
  const idx = []
  pts.forEach(([x, z, nx, nz], i) => {
    pos.push(x, y0, z, x, y1, z)
    nrm.push(nx, 0, nz, nx, 0, nz)
    if (i > 0) {
      const b0 = (i - 1) * 2
      const b1 = i * 2
      idx.push(b0, b1, b0 + 1, b0 + 1, b1, b1 + 1)
    }
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  geo.setIndex(idx)
  return geo
}

const wheelCache = new Map()

/**
 * Chunky wheel (rounded black tyre + light hub + darker cap), axle along local X, centred at the
 * origin. Vertex-coloured; spin it with mesh.rotation.x (+ = rolling toward +Z).
 */
export function createWheelGeometry(radius, width) {
  const key = `${radius}|${width}`
  if (wheelCache.has(key)) return wheelCache.get(key)
  const hubR = radius * 0.6
  const rr = Math.min(width * 0.3, radius * 0.25) // tyre shoulder rounding
  const half = width / 2
  const profile = [new THREE.Vector2(hubR, -half)]
  const arc = (cx, cy, a0, a1) => {
    for (let i = 0; i <= 4; i++) {
      const a = a0 + ((a1 - a0) * i) / 4
      profile.push(new THREE.Vector2(cx + rr * Math.cos(a), cy + rr * Math.sin(a)))
    }
  }
  arc(radius - rr, -half + rr, -Math.PI / 2, 0)
  arc(radius - rr, half - rr, 0, Math.PI / 2)
  profile.push(new THREE.Vector2(hubR, half))

  const seg = radius >= 0.4 ? 22 : 16
  const p = new PartList()
  p.add(new THREE.LatheGeometry(profile, seg), C.tire)
  p.cyl(hubR + 0.005, width + 0.01, C.hub, 0, 0, 0, 0, 0, 0, seg - 4)
  p.cyl(radius * 0.2, width + 0.03, 0x8e96a8, 0, 0, 0, 0, 0, 0, 10)
  const geo = p.merge()
  geo.rotateZ(Math.PI / 2) // lathe / cylinder axis Y → X
  geo.computeBoundingSphere()
  wheelCache.set(key, geo)
  return geo
}

// ───────────────────────────── dimensions ─────────────────────────────

const LENGTH = 10.5
const WIDTH = 2.5
const HEIGHT = 3.9
const REAR_Z = -5.25
const FRONT_Z = 5.25

const BOX = { w: 2.5, len: 7.4, y0: 1.05, y1: 3.9, z0: REAR_Z, r: 0.12 } // z0 = rear face
const CAB = { w: 2.4, y0: 0.55, y1: 3.0, z0: 2.5, z1: 5.0, r: 0.16 }    // z1 = front face
const WHEEL_R = 0.45
const WHEEL_W = 0.42
const WHEEL_X = 1.03
const AXLES_Z = [3.9, -2.75, -3.8]
const LIVERY_OFF = 0.008 // livery planes float this far off the box faces

const BUMPER = 0xdde2ec
const GRILLE = 0x2a2e3a
const SLAT = 0x8b93a7
const TRIM = 0xbcc3d2

// ───────────────────────────── liveries ─────────────────────────────

const WHITE_CSS = '#f7f8fc' // = C.white, so painted areas match the vertex-coloured box

const LIVERIES = {
  waretrack: {
    name: 'WareTrack', tagline: 'Freight · Warehousing · Last-mile delivery', logo: 'cube',
    cab: C.blue, stripe: null, roofTrim: C.blue,
    band: '#2f5bea', accent: '#aebff8', bandY: [0.7, 0.78], text: '#1b2147', frame: '#2f5bea', textScale: 1.12, logoScale: 0.42,
  },
  bluepeak: {
    name: 'Bluepeak', tagline: 'Fresh food network', logo: 'mountain',
    cab: C.white, stripe: C.navy, roofTrim: null,
    band: '#1f2a78', accent: '#b4bdf0', bandY: [0.62, 0.75], text: '#1f2a5c', glyph: '#1f2a78',
  },
  nordline: {
    name: 'Nordline', tagline: 'Warehousing & Delivery', logo: 'nordline',
    cab: C.white, stripe: C.teal, roofTrim: null,
    band: '#16a08b', accent: '#a6e3d7', bandY: [0.62, 0.74], text: '#127c6c', glyph: '#16a08b',
  },
  cargoviva: {
    name: 'Cargoviva', tagline: 'Express cargo', logo: 'speed', italic: true,
    cab: C.white, stripe: C.orange, roofTrim: null,
    band: '#f26b1d', accent: '#fbc6a2', bandY: [0.64, 0.76], text: '#e0621b', glyph: '#f26b1d',
  },
}

/** Carrier mark drawn in an s×s square at (x, y). */
function drawGlyph(ctx, L, x, y, s) {
  ctx.save()
  ctx.fillStyle = L.glyph
  if (L.logo === 'cube') {
    drawCubeLogo(ctx, x + s * 0.06, y, s * 0.88)
  } else if (L.logo === 'mountain') {
    ctx.beginPath()
    ctx.moveTo(x, y + s)
    ctx.lineTo(x + s * 0.38, y + s * 0.1)
    ctx.lineTo(x + s * 0.58, y + s * 0.52)
    ctx.lineTo(x + s * 0.74, y + s * 0.3)
    ctx.lineTo(x + s, y + s)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = WHITE_CSS
    ctx.lineWidth = s * 0.07
    ctx.beginPath()
    ctx.moveTo(x + s * 0.38, y + s * 0.18)
    ctx.lineTo(x + s * 0.3, y + s * 0.62)
    ctx.stroke()
  } else if (L.logo === 'nordline') {
    // italic "N": two posts and a lighter diagonal
    const slant = s * 0.22
    const quad = (pts, color) => {
      ctx.fillStyle = color
      ctx.beginPath()
      pts.forEach(([u, v], i) => {
        const px = x + u * s + (1 - v) * slant
        const py = y + v * s
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.closePath()
      ctx.fill()
    }
    quad([[0.22, 0.02], [0.52, 0.98], [0.76, 0.98], [0.46, 0.02]], L.accent)
    quad([[0, 0.02], [0.24, 0.02], [0.24, 0.98], [0, 0.98]], L.glyph)
    quad([[0.54, 0.02], [0.78, 0.02], [0.78, 0.98], [0.54, 0.98]], L.glyph)
  } else if (L.logo === 'speed') {
    // three speed lines
    const bars = [[0.06, 0.94], [0.2, 0.8], [0.34, 0.66]]
    bars.forEach(([x0, len], i) => {
      roundRect(ctx, x + x0 * s, y + s * (0.18 + i * 0.25), len * s, s * 0.15, s * 0.075)
      ctx.fill()
    })
  }
  ctx.restore()
}

/** One box side. The swoosh is always deepest toward the rear; the text block always reads left-aligned. */
function paintSide(ctx, w, h, L, rearOnLeft) {
  ctx.fillStyle = WHITE_CSS
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  if (!rearOnLeft) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  const [yRear, yFront] = L.bandY.map((f) => f * h)
  const curve = (dy) => {
    ctx.moveTo(0, yRear + dy)
    ctx.bezierCurveTo(w * 0.38, yRear + dy, w * 0.6, yFront + dy, w, yFront + dy)
  }
  ctx.beginPath()
  curve(0)
  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fillStyle = L.band
  ctx.fill()
  ctx.beginPath()
  curve(-h * 0.055)
  ctx.lineWidth = h * 0.03
  ctx.strokeStyle = L.accent
  ctx.stroke()
  ctx.restore()

  if (L.frame) {
    // blue trim: top edge + both ends (meets the rounded roof cap)
    const t = Math.round(h * 0.026)
    ctx.fillStyle = L.frame
    ctx.fillRect(0, 0, w, t)
    ctx.fillRect(0, 0, t, h)
    ctx.fillRect(w - t, 0, t, h)
  }

  // text block: glyph, name (≈ 40 % of the box length, as in the video) and a grey tagline
  const s = h * (L.logoScale ?? 0.34)
  const x0 = w * 0.06
  const baseline = h * 0.42
  const fs = h * 0.25 * (L.textScale ?? 1)
  drawGlyph(ctx, L, x0, baseline + h * 0.05 - s * 0.62, s)
  const tx = x0 + s * 1.1
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = L.text
  ctx.font = `${L.italic ? 'italic ' : ''}800 ${fs}px ${FONT}`
  ctx.fillText(L.name, tx, baseline)
  ctx.fillStyle = '#8a92a6'
  ctx.font = `500 ${Math.round(h * 0.06)}px ${FONT}`
  ctx.fillText(L.tagline, tx + fs * 0.04, baseline + h * 0.12)
}

/** Rear roller doors: corrugation ribs, split line, frame, sill and a small carrier mark. */
function paintRear(ctx, w, h, L) {
  ctx.fillStyle = '#f3f5fa'
  ctx.fillRect(0, 0, w, h)
  const ribs = 16
  for (let i = 1; i < ribs; i++) {
    const x = Math.round((i / ribs) * w)
    ctx.fillStyle = 'rgba(146,156,184,0.28)'
    ctx.fillRect(x - 2, h * 0.04, 2, h * 0.9)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillRect(x, h * 0.04, 2, h * 0.9)
  }
  ctx.fillStyle = 'rgba(104,114,142,0.7)'
  ctx.fillRect(w / 2 - 3, 0, 6, h)
  ctx.strokeStyle = 'rgba(146,156,184,0.6)'
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, w - 6, h - 6)
  ctx.fillStyle = '#d3d8e4'
  ctx.fillRect(0, h * 0.95, w, h * 0.05)
  drawGlyph(ctx, L, w * 0.7, h * 0.08, w * 0.15)
}

// Atlas layout (texture px): [side, rear on left] / [side, rear on right] stacked, rear doors at right.
const PX = 140
const SIDE_W = BOX.len - 2 * BOX.r
const SIDE_H = BOX.y1 - BOX.y0 - 2 * BOX.r
const REAR_W = BOX.w - 2 * BOX.r
const ATLAS = (() => {
  const sw = Math.round(SIDE_W * PX)
  const sh = Math.round(SIDE_H * PX)
  const rw = Math.round(REAR_W * PX)
  const gap = 16
  const W = sw + gap + rw
  const H = sh * 2 + gap
  const rect = (x, y, w, h) => [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H] // [u0, v0, u1, v1]
  return { W, H, sw, sh, rw, gap, sideRearLeft: rect(0, 0, sw, sh), sideRearRight: rect(0, sh + gap, sw, sh), rear: rect(sw + gap, 0, rw, sh) }
})()

function paintAtlas(ctx, L) {
  const { W, H, sw, sh, gap } = ATLAS
  ctx.fillStyle = WHITE_CSS
  ctx.fillRect(0, 0, W, H)
  paintSide(ctx, sw, sh, L, true)
  ctx.save()
  ctx.translate(0, sh + gap)
  paintSide(ctx, sw, sh, L, false)
  ctx.restore()
  ctx.save()
  ctx.translate(sw + gap, 0)
  paintRear(ctx, ATLAS.rw, sh, L)
  ctx.restore()
}

const liveryMaterials = new Map()

function liveryMaterial(key) {
  if (liveryMaterials.has(key)) return liveryMaterials.get(key)
  const L = LIVERIES[key]
  const texture = canvasTexture(ATLAS.W, ATLAS.H, (ctx) => paintAtlas(ctx, L))
  // Canvas text needs Inter: if it is still loading, repaint once it arrives.
  const fonts = document.fonts
  if (fonts && !fonts.check(`800 40px ${FONT}`)) {
    fonts.load(`800 40px ${FONT}`).then(() => {
      paintAtlas(texture.image.getContext('2d'), L)
      texture.needsUpdate = true
    }).catch(() => {})
  }
  const material = new THREE.MeshStandardMaterial({
    map: texture, roughness: 0.78, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  })
  liveryMaterials.set(key, material)
  return material
}

function atlasPlane(w, h, [u0, v0, u1, v1]) {
  const geo = new THREE.PlaneGeometry(w, h)
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
  return geo
}

let liveryGeo = null

/** Both box sides + the rear doors as one geometry (same UV layout for every carrier). */
function liveryGeometry() {
  if (liveryGeo) return liveryGeo
  const y = (BOX.y0 + BOX.y1) / 2
  const z = BOX.z0 + BOX.len / 2
  // +X face: viewed from outside the front (+Z) is on the viewer's left → rear on the right.
  const right = atlasPlane(SIDE_W, SIDE_H, ATLAS.sideRearRight).rotateY(Math.PI / 2).translate(BOX.w / 2 + LIVERY_OFF, y, z)
  const left = atlasPlane(SIDE_W, SIDE_H, ATLAS.sideRearLeft).rotateY(-Math.PI / 2).translate(-BOX.w / 2 - LIVERY_OFF, y, z)
  const rear = atlasPlane(REAR_W, SIDE_H, ATLAS.rear).rotateY(Math.PI).translate(0, y, BOX.z0 - LIVERY_OFF)
  liveryGeo = mergeGeometries([right, left, rear])
  liveryGeo.computeBoundingSphere()
  return liveryGeo
}

// ───────────────────────────── body ─────────────────────────────

function addCargoBox(p, L, reefer) {
  const h = BOX.y1 - BOX.y0
  const y = (BOX.y0 + BOX.y1) / 2
  const z = BOX.z0 + BOX.len / 2
  p.box(1.4, 0.4, 9.4, C.tire, 0, 0.8, -0.45) // chassis rails
  p.rbox(BOX.w, h, BOX.len, BOX.r, C.white, 0, y, z)
  // band colour over the bottom rounded edge so the painted swoosh reaches the very bottom
  p.box(BOX.w + 0.004, 0.2, BOX.len - 2 * BOX.r, L.band, 0, BOX.y0 + 0.098, z)
  if (L.roofTrim != null) {
    // coloured roof rim (all four top edges) with a white roof panel inset
    p.rbox(BOX.w + 0.012, 0.24, BOX.len + 0.012, 0.11, L.roofTrim, 0, BOX.y1 - 0.114, z)
    p.box(BOX.w - 0.26, 0.012, BOX.len - 0.26, C.white, 0, BOX.y1 + 0.008, z)
  }

  // rear doors: locking rods, handles, hinges
  const zr = BOX.z0 - 0.03
  for (const x of [-0.84, -0.2, 0.2, 0.84]) p.cyl(0.024, 2.4, TRIM, x, y - 0.04, zr)
  for (const s of [-1, 1]) {
    p.box(0.26, 0.06, 0.06, TRIM, s * 0.32, 2.15, zr - 0.02)
    for (const hy of [1.55, 2.5, 3.45]) p.box(0.12, 0.12, 0.05, 0x9aa2b4, s * 1.07, hy, BOX.z0 - 0.012)
  }
  // rear underride bar + tail lights
  p.box(2.26, 0.15, 0.12, 0x3a3f4c, 0, 0.62, BOX.z0 + 0.1)
  for (const s of [-1, 1]) p.rbox(0.3, 0.13, 0.05, 0.02, 0xe5484d, s * 0.86, 0.62, BOX.z0 + 0.03)

  // fuel tanks and mud flaps
  for (const s of [-1, 1]) {
    p.cyl(0.25, 1.1, 0xcdd3df, s * 0.92, 0.72, 1.0, Math.PI / 2)
    p.box(0.44, 0.42, 0.03, C.black, s * WHEEL_X, 0.42, AXLES_Z[2] - WHEEL_R - 0.14)
  }

  if (reefer) {
    // refrigeration unit on the box front, above the cab roof
    const zu = BOX.z0 + BOX.len + 0.25
    p.rbox(1.9, 0.72, 0.5, 0.08, C.white, 0, 3.47, zu)
    p.rbox(1.56, 0.48, 0.05, 0.02, GRILLE, 0, 3.47, zu + 0.25)
    for (let i = 0; i < 4; i++) p.box(1.44, 0.035, 0.03, SLAT, 0, 3.31 + i * 0.105, zu + 0.28)
  }
}

function addCab(p, L) {
  const zf = CAB.z1
  const halfW = CAB.w / 2
  p.rbox(CAB.w, CAB.y1 - CAB.y0, CAB.z1 - CAB.z0, CAB.r, L.cab, 0, (CAB.y0 + CAB.y1) / 2, (CAB.z0 + CAB.z1) / 2)

  // dark windscreen wrapping round the front corners, separate side windows behind the A-pillar
  p.add(wrapStrip(halfW, zf, CAB.r, null, 2.13, 2.94, 0.012), C.glassDark)
  for (const s of [-1, 1]) p.box(0.03, 0.72, 0.82, C.glassDark, s * (halfW + 0.002), 2.53, zf - CAB.r - 0.12 - 0.41)

  if (L.stripe != null) p.add(wrapStrip(halfW, zf, CAB.r, CAB.z0 + CAB.r, 1.9, 2.04, 0.008), L.stripe)

  // grille, headlights, bumper
  p.rbox(1.24, 0.6, 0.08, 0.03, GRILLE, 0, 1.45, zf)
  for (let i = 0; i < 5; i++) p.box(1.1, 0.04, 0.04, SLAT, 0, 1.24 + i * 0.105, zf + 0.04)
  for (const s of [-1, 1]) p.rbox(0.34, 0.2, 0.08, 0.04, 0xfdf6df, s * 0.88, 1.3, zf)
  p.rbox(CAB.w + 0.04, 0.42, 0.34, 0.08, BUMPER, 0, 0.72, zf + 0.04)

  // mirrors on short arms, cab steps
  for (const s of [-1, 1]) {
    p.box(0.34, 0.05, 0.05, C.black, s * (halfW + 0.15), 2.64, zf - 0.24)
    p.rbox(0.08, 0.46, 0.22, 0.03, C.black, s * (halfW + 0.33), 2.5, zf - 0.24)
    p.box(0.06, 0.1, 0.5, C.black, s * (halfW + 0.02), 0.62, CAB.z0 + 0.45)
  }
}

const bodyCache = new Map()

function bodyGeometry(key, reefer) {
  const cacheKey = `${key}|${reefer}`
  if (bodyCache.has(cacheKey)) return bodyCache.get(cacheKey)
  const L = LIVERIES[key]
  const p = new PartList()
  addCargoBox(p, L, reefer)
  addCab(p, L)
  const geo = p.merge()
  bodyCache.set(cacheKey, geo)
  return geo
}

// ───────────────────────────── factory ─────────────────────────────

/**
 * createTruck({ carrier: 'waretrack'|'bluepeak'|'nordline'|'cargoviva', reefer }) → THREE.Group
 * userData: { kind:'truck', carrier, reefer, length, width, height, rearZ, frontZ, wheelRadius,
 *             wheels: Mesh[] } — each wheel has userData.radius; spin with
 *             wheel.rotation.x += distance / radius (positive = rolling forward).
 */
export function createTruck({ carrier = 'waretrack', reefer = false } = {}) {
  const key = LIVERIES[carrier] ? carrier : 'waretrack'
  const vc = vertexColorMaterial()
  const group = new THREE.Group()
  group.name = `truck-${key}`

  const body = new THREE.Mesh(bodyGeometry(key, !!reefer), vc)
  body.name = 'body'
  const livery = new THREE.Mesh(liveryGeometry(), liveryMaterial(key))
  livery.name = 'livery'
  group.add(body, livery)

  const wheelGeo = createWheelGeometry(WHEEL_R, WHEEL_W)
  const wheels = []
  for (const z of AXLES_Z) {
    for (const s of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, vc)
      wheel.name = 'wheel'
      wheel.position.set(s * WHEEL_X, WHEEL_R, z)
      wheel.userData.radius = WHEEL_R
      wheels.push(wheel)
      group.add(wheel)
    }
  }

  shadows(group)
  livery.castShadow = false // flat decals on the box; the body already casts

  group.userData = {
    kind: 'truck', carrier: key, reefer: !!reefer,
    length: LENGTH, width: WIDTH, height: HEIGHT,
    rearZ: REAR_Z, frontZ: FRONT_Z, wheelRadius: WHEEL_R,
    wheels,
  }
  return group
}
