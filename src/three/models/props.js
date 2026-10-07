// Small world props: trees, bushes, fences, racks, containers, chargers, map pins, parking bays,
// rooftop AC units, silos, guard booths, filler city buildings, glow discs and crosswalks.
// Every factory returns an Object3D whose origin is the ground centre of its footprint (except
// fences, which start at the origin and run along +X). Geometries, textures and most materials are
// cached at module level and shared — never dispose them; the per-instance exceptions are the
// charger LED material and the glow-disc material, which are safe to animate.
import * as THREE from 'three'
import { C, mat, matTransparent } from '../palette.js'
import { canvasTexture, textTexture } from '../canvasText.js'
import { boxGeo, getPalletParts, mergeGeos, mixHex, rng } from './pallet.js'

const geoCache = new Map()
function cached(key, build) {
  if (!geoCache.has(key)) geoCache.set(key, build())
  return geoCache.get(key)
}

const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`
const mesh = (geometry, material, { cast = true, receive = true } = {}) => {
  const m = new THREE.Mesh(geometry, material)
  m.castShadow = cast
  m.receiveShadow = receive
  return m
}

/** Sphere/ellipsoid geometry centred at (x, y, z) with radii (rx, ry, rz). */
function blobGeo(rx, ry, rz, x, y, z, seg = 20) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7))
  g.scale(rx, ry, rz)
  g.translate(x, y, z)
  return g
}

/** Cylinder standing on y (bottom), centred on x/z. */
function cylGeo(rTop, rBottom, h, x = 0, y = 0, z = 0, seg = 24) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg)
  g.translate(x, y + h / 2, z)
  return g
}

/** Flat rectangle lying on XZ at height y, centred on (x, z). */
function flatRect(w, d, x = 0, y = 0.03, z = 0) {
  const g = new THREE.PlaneGeometry(w, d)
  g.rotateX(-Math.PI / 2)
  g.translate(x, y, z)
  return g
}

// ───────────────────────────── soft radial textures ─────────────────────────────

let radialTex = null
/** White → transparent radial gradient, shared by glow discs and pin shadows. */
function radialTexture() {
  if (!radialTex) {
    radialTex = canvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.35, 'rgba(255,255,255,0.75)')
      g.addColorStop(0.7, 'rgba(255,255,255,0.25)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    })
    radialTex.anisotropy = 1   // a soft blur gains nothing from anisotropic sampling
  }
  return radialTex
}

// 2 × 2 decal quad; the lift above the ground is baked in so callers can freely set position.y = 0
const unitDisc = (lift) => cached(`disc|${lift}`, () => flatRect(2, 2, 0, lift, 0))
const DECAL = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }

// ───────────────────────────── vegetation ─────────────────────────────

const TREE_VARIANTS = 4
const TRUNK = mixHex(C.trunk, 0xa89a92, 0.3)   // the video's trunks are a soft grey-brown

function treeGeos(variant) {
  return cached(`tree|${variant}`, () => {
    const trunk = cylGeo(0.05, 0.085, 2.6, 0, 0, 0, 10)
    const blobs = [
      () => [blobGeo(1.1, 1.3, 1.1, 0, 3.15, 0)],
      () => [blobGeo(1.05, 1.22, 1.05, 0, 3.2, 0), blobGeo(0.62, 0.58, 0.62, 0.72, 2.55, 0.42)],
      () => [blobGeo(0.95, 1.35, 0.95, 0, 3.25, 0)],
      () => [blobGeo(1.2, 1.15, 1.2, 0, 2.95, 0), blobGeo(0.62, 0.56, 0.62, -0.78, 2.5, 0.42)],
    ][variant]()
    return { trunk, canopy: mergeGeos(blobs) }
  })
}

/**
 * Shared parts of a tree variant, for callers that want to build InstancedMeshes of many trees:
 * { trunk, canopy, trunkMaterial, canopyMaterial } (geometry origin = ground centre, ≈ 4.5 m tall).
 */
export function getTreeParts(seed = 0) {
  const { trunk, canopy } = treeGeos(Math.abs(Math.round(seed)) % TREE_VARIANTS)
  return { trunk, canopy, trunkMaterial: mat(TRUNK), canopyMaterial: mat(C.tree, { roughness: 0.92 }) }
}

/** Mint-green rounded canopy on a thin brown trunk, ≈ 4.5 m tall. */
export function createTree({ size = 1, seed = 0 } = {}) {
  const p = getTreeParts(seed)
  const group = new THREE.Group()
  group.name = 'tree'
  group.add(mesh(p.trunk, p.trunkMaterial), mesh(p.canopy, p.canopyMaterial))
  const r = rng(seed + 5)
  group.scale.setScalar(size * (0.92 + r() * 0.16))
  group.rotation.y = r() * Math.PI * 2
  group.userData = { kind: 'tree' }
  return group
}

/** Low rounded shrub (≈ 0.8 m). */
export function createBush({ size = 1 } = {}) {
  const geo = cached('bush', () => mergeGeos([
    blobGeo(0.62, 0.42, 0.55, 0, 0.22, 0, 18),
    blobGeo(0.42, 0.32, 0.4, 0.42, 0.16, 0.2, 16),
  ]))
  const group = new THREE.Group()
  group.name = 'bush'
  group.add(mesh(geo, mat(C.tree, { roughness: 0.92 })))
  group.scale.setScalar(size)
  group.userData = { kind: 'bush' }
  return group
}

// ───────────────────────────── fence ─────────────────────────────

/** Fence along +X from the origin: thin posts every ≈ 3 m, top/bottom rails, translucent panels. */
export function createFence(length, { height = 2.2 } = {}) {
  const key = `fence|${length.toFixed(2)}|${height}`
  const { frame, panel } = cached(key, () => {
    const n = Math.max(1, Math.round(length / 3))
    const step = length / n
    const parts = []
    for (let i = 0; i <= n; i++) parts.push(boxGeo(0.07, height, 0.07, i * step))
    parts.push(boxGeo(length, 0.05, 0.05, length / 2, height - 0.05, 0))
    parts.push(boxGeo(length, 0.04, 0.04, length / 2, 0.08, 0))
    const panelGeo = new THREE.PlaneGeometry(length, height - 0.16)
    panelGeo.translate(length / 2, 0.08 + (height - 0.16) / 2, 0)
    return { frame: mergeGeos(parts), panel: panelGeo }
  })
  const group = new THREE.Group()
  group.name = 'fence'
  group.add(
    mesh(frame, mat(C.fencePost)),
    mesh(panel, matTransparent(C.fencePanel, 0.35, { side: THREE.DoubleSide, roughness: 0.3 }), { cast: false }),
  )
  group.userData = { kind: 'fence', length, height }
  return group
}

// ───────────────────────────── pallet rack ─────────────────────────────

const RACK = { bayW: 2.75, depth: 1.1, levelH: 1.6, post: 0.09 }

function rackFrameGeo(bays, levels) {
  return cached(`rack|${bays}|${levels}`, () => {
    const { bayW, depth, levelH, post } = RACK
    const W = bays * bayW
    const H = levels * levelH + 0.1
    const uprights = []
    const beams = []
    for (let i = 0; i <= bays; i++) {
      const x = -W / 2 + i * bayW
      for (const s of [-1, 1]) uprights.push(boxGeo(post, H, post, x, 0, s * depth / 2))
      uprights.push(...frameBracing(x, H, depth))
    }
    for (let b = 0; b < bays; b++) {
      const xc = -W / 2 + (b + 0.5) * bayW
      for (let l = 1; l <= levels; l++) {
        for (const s of [-1, 1]) beams.push(boxGeo(bayW - post, 0.12, 0.06, xc, l * levelH - 0.12, s * (depth / 2 + 0.01)))
      }
    }
    return { uprights: mergeGeos(uprights), beams: mergeGeos(beams), width: W, height: H }
  })
}

/** Horizontal ties + zig-zag diagonals between the two posts of an upright frame. */
function frameBracing(x, H, depth) {
  const out = []
  const ties = Math.max(2, Math.round(H / 1.25))
  const dy = (H - 0.4) / ties
  for (let t = 0; t <= ties; t++) out.push(boxGeo(0.035, 0.035, depth, x, 0.2 + t * dy, 0))
  const len = Math.hypot(depth, dy)
  for (let t = 0; t < ties; t++) {
    const g = new THREE.BoxGeometry(0.03, len, 0.03)
    g.rotateX((t % 2 ? 1 : -1) * Math.atan2(depth, dy))
    g.translate(x, 0.2 + (t + 0.5) * dy, 0)
    out.push(g)
  }
  return out
}

/** Merge transformed copies of pallet parts into one mesh per material. */
function mergedPallets(placements) {
  const byMat = new Map()
  for (const { opts, x, y, z } of placements) {
    for (const p of getPalletParts(opts).parts) {
      if (!byMat.has(p.material)) byMat.set(p.material, [])
      byMat.get(p.material).push(p.geometry.clone().translate(x, y, z))
    }
  }
  return [...byMat].map(([material, geos]) => mesh(mergeGeos(geos), material))
}

/** Blue pallet rack (bays along X, open faces ±Z) holding cardboard pallets. */
export function createRack({ bays = 2, levels = 3, fill = 0.8, seed = 0, beamColor = C.rackUpright } = {}) {
  const { bayW, levelH } = RACK
  const frame = rackFrameGeo(bays, levels)
  const r = rng(seed * 31 + 7)
  const placements = []
  for (let b = 0; b < bays; b++) {
    const xc = -frame.width / 2 + (b + 0.5) * bayW
    for (let l = 0; l < levels; l++) {
      for (const s of [-1, 1]) {
        if (r() > fill) continue
        const layers = l < levels - 1 ? 2 + (r() < 0.6 ? 1 : 0) : 2 + (r() < 0.5 ? 1 : 0)
        const variant = [0, 1, 2, 5][Math.floor(r() * 4)]   // no extra-carton style: must clear the beam
        placements.push({ opts: { kind: 'cardboard', layers, seed: variant }, x: xc + s * 0.64, y: l * levelH, z: 0 })
      }
    }
  }
  // CONTRACT-GAP: SPEC says orange beams, the reference frames (01, 25) clearly show blue beams;
  // we follow the video and expose `beamColor` for anyone who wants the orange variant (C.rackBeam).
  const group = new THREE.Group()
  group.name = 'rack'
  group.add(mesh(frame.uprights, mat(C.rackUpright, { roughness: 0.55 })))
  group.add(mesh(frame.beams, mat(beamColor, { roughness: 0.55 })))
  for (const m of mergedPallets(placements)) group.add(m)
  group.userData = { kind: 'rack', width: frame.width, depth: RACK.depth, height: frame.height }
  return group
}

// ───────────────────────────── shipping container ─────────────────────────────

const CONT = { w: 2.44, h: 2.59 }

function containerGeos(length) {
  return cached(`container|${length}`, () => {
    const L = length
    const { w: W, h: H } = CONT
    const body = [boxGeo(L - 0.24, H - 0.26, W - 0.1, 0, 0.12, 0), boxGeo(L - 0.1, 0.05, W - 0.1, 0, H - 0.07, 0)]
    // corrugation: vertical ribs on the long sides and the front end
    const n = Math.floor((L - 0.5) / 0.3)
    for (let i = 0; i < n; i++) {
      const x = -((n - 1) * 0.3) / 2 + i * 0.3
      for (const s of [-1, 1]) body.push(boxGeo(0.14, H - 0.3, 0.06, x, 0.15, s * (W / 2 - 0.04)))
    }
    for (let i = 0; i < 7; i++) body.push(boxGeo(0.06, H - 0.3, 0.14, L / 2 - 0.1, 0.15, -0.9 + i * 0.3))
    // rear doors on -X
    for (const s of [-1, 1]) body.push(boxGeo(0.06, H - 0.32, W / 2 - 0.1, -L / 2 + 0.1, 0.16, s * W / 4))
    const frame = []
    for (const s of [-1, 1]) {
      frame.push(boxGeo(L, 0.16, 0.1, 0, 0, s * (W / 2 - 0.05)))
      frame.push(boxGeo(L, 0.13, 0.1, 0, H - 0.13, s * (W / 2 - 0.05)))
      frame.push(boxGeo(0.12, 0.16, W, s * (L / 2 - 0.06), 0, 0))
      frame.push(boxGeo(0.12, 0.13, W, s * (L / 2 - 0.06), H - 0.13, 0))
      for (const t of [-1, 1]) frame.push(boxGeo(0.16, H, 0.16, s * (L / 2 - 0.08), 0, t * (W / 2 - 0.08)))
    }
    // door locking bars
    for (const z of [-0.95, -0.35, 0.35, 0.95]) frame.push(cylGeo(0.028, 0.028, H - 0.4, -L / 2 + 0.05, 0.2, z, 8))
    return { body: mergeGeos(body), frame: mergeGeos(frame) }
  })
}

const labelMats = new Map()
function labelMaterial(label) {
  if (!labelMats.has(label)) {
    const { texture, aspect } = textTexture(label, { color: 'rgba(255,255,255,0.82)', weight: 800, size: 96, padX: 8, padY: 4 })
    const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 })
    labelMats.set(label, { material, aspect })
  }
  return labelMats.get(label)
}

/** Ribbed 40/20 ft shipping container (length along X, doors at -X) with the carrier name on both sides. */
export function createContainer({ color = C.container, label = 'MAERA LINE', length = 12.2 } = {}) {
  const { body, frame } = containerGeos(length)
  const group = new THREE.Group()
  group.name = 'container'
  group.add(mesh(body, mat(color, { roughness: 0.7 })), mesh(frame, mat(mixHex(color, 0x14223a, 0.22), { roughness: 0.7 })))
  if (label) {
    const { material, aspect } = labelMaterial(label)
    const h = 0.5
    const geo = cached(`label|${label}`, () => new THREE.PlaneGeometry(h * aspect, h))
    for (const s of [-1, 1]) {
      const plane = mesh(geo, material, { cast: false })
      plane.position.set(-length * 0.08, CONT.h * 0.58, s * (CONT.w / 2 + 0.005))
      plane.rotation.y = s > 0 ? 0 : Math.PI
      group.add(plane)
    }
  }
  group.userData = { kind: 'container', length, width: CONT.w, height: CONT.h }
  return group
}

// ───────────────────────────── forklift charger ─────────────────────────────

function chargerGeos() {
  return cached('charger', () => ({
    shell: mergeGeos([
      boxGeo(0.78, 0.07, 0.58, 0, 0, 0, 0.02),
      boxGeo(0.7, 1.46, 0.5, 0, 0.07, 0, 0.07, 2),
      boxGeo(0.76, 0.07, 0.56, 0, 1.53, 0, 0.03, 2),
    ]),
    dark: mergeGeos([
      boxGeo(0.46, 0.34, 0.03, 0, 1.0, 0.245, 0.03),
      boxGeo(0.07, 0.16, 0.08, 0.38, 0.86, 0.06, 0.02),
      cylGeo(0.03, 0.03, 0.62, 0.39, 0.25, 0.06, 8),
    ]),
    accent: boxGeo(0.71, 0.05, 0.51, 0, 0.22, 0),
    led: boxGeo(0.22, 0.035, 0.02, 0, 0.82, 0.25),
  }))
}

/** White charging cabinet ≈ 0.7 × 0.5 × 1.6 m facing +Z: dark screen, green LED strip, side cable. */
export function createCharger() {
  const g = chargerGeos()
  const group = new THREE.Group()
  group.name = 'charger'
  // per-instance LED material so callers can recolour / pulse a single charger
  const ledMat = new THREE.MeshStandardMaterial({ color: C.chargerGlow, emissive: C.chargerGlow, emissiveIntensity: 1.4, roughness: 0.4 })
  const led = mesh(g.led, ledMat, { cast: false })
  group.add(
    mesh(g.shell, mat(C.charger, { roughness: 0.55 })),
    mesh(g.dark, mat(C.glassDark, { roughness: 0.35 })),
    mesh(g.accent, mat(C.blue, { roughness: 0.6 })),
    led,
  )
  group.userData = { kind: 'charger', led, height: 1.6 }
  return group
}

// ───────────────────────────── map pin ─────────────────────────────

// head radius, head centre height, Z squash → ≈ 2.3 m tall, 1.04 m head (matches the video when
// measured against the 10.5 m trucks)
const PIN = { r: 0.52, cy: 1.78, flat: 0.62 }

/** Classic teardrop silhouette (lathe around Y): tip at the origin, round head on top. */
function pinGeos() {
  return cached('pin', () => {
    const { r, cy } = PIN
    const alpha = Math.asin(r / cy)
    const tangentLen = Math.sqrt(cy * cy - r * r)
    const pts = []
    for (let i = 0; i <= 6; i++) {
      const t = (i / 6) * tangentLen
      pts.push(new THREE.Vector2(t * Math.sin(alpha), t * Math.cos(alpha)))
    }
    const start = -alpha   // angle (from +X around the head centre) of the tangent point
    for (let i = 1; i <= 22; i++) {
      const a = start + (Math.PI / 2 - start) * (i / 22)
      pts.push(new THREE.Vector2(Math.max(0, r * Math.cos(a)), cy + r * Math.sin(a)))
    }
    pts[0].x = 0.0001
    const body = new THREE.LatheGeometry(pts, 40)
    // white "coin" through the head: its faces sit just outside the head on both sides
    const dot = new THREE.CylinderGeometry(r * 0.42, r * 0.42, r * 2.06, 32)
    dot.rotateX(Math.PI / 2)
    dot.translate(0, cy, 0)
    return { body, dot }
  })
}

const _cam = new THREE.Vector3()
let pinShadowMat = null
const pinShadowMaterial = () => (pinShadowMat ??= new THREE.MeshBasicMaterial({
  ...DECAL, map: radialTexture(), color: 0x1b2550, opacity: 0.32,
}))

/**
 * Teardrop map pin ≈ 2.3 m tall with a white centre dot; origin at the tip.
 * userData.head is the part to bob. The head turns to face the camera (around Y) every frame.
 */
export function createMapPin({ color = C.blue, scale = 1 } = {}) {
  const { body, dot } = pinGeos()
  const group = new THREE.Group()
  group.name = 'map-pin'

  const shadow = new THREE.Mesh(unitDisc(0.012), pinShadowMaterial())
  shadow.scale.set(0.36, 1, 0.28)
  shadow.renderOrder = 1

  const head = new THREE.Group()
  const face = new THREE.Group()
  face.scale.z = PIN.flat
  // a touch of self-light keeps the pin the bright brand blue of the video even on its shadow side
  const bodyMesh = mesh(body, mat(color, { roughness: 0.4, emissive: color, emissiveIntensity: 0.14 }))
  const dotMesh = mesh(dot, mat(0xffffff, { roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.55 }), { cast: false })
  face.add(bodyMesh, dotMesh)
  head.add(face)
  // Y-billboard: turn the flattened head toward the camera (applied for the next frame).
  bodyMesh.onBeforeRender = (renderer, scene, camera) => {
    if (!face.parent) return
    _cam.setFromMatrixPosition(camera.matrixWorld)
    face.parent.worldToLocal(_cam)
    face.rotation.y = Math.atan2(_cam.x, _cam.z)
  }

  group.add(shadow, head)
  group.scale.setScalar(scale)
  group.userData = { kind: 'pin', head, height: (PIN.cy + PIN.r) * scale }
  return group
}

// ───────────────────────────── ground markings ─────────────────────────────

/**
 * Painted bay outline (width along X, length along Z), centred, at y ≈ 0.03.
 * Extra option open: '+z' | '-z' | '+x' | '-x' leaves that side unpainted.
 */
export function createParkingBay(width, length, { color = C.yellowLine, line = 0.18, open = null } = {}) {
  const key = `bay|${width}|${length}|${line}|${open}`
  const geo = cached(key, () => {
    const sides = {
      '+z': flatRect(width, line, 0, 0.03, length / 2 - line / 2),
      '-z': flatRect(width, line, 0, 0.03, -length / 2 + line / 2),
      '+x': flatRect(line, length, width / 2 - line / 2, 0.031, 0),
      '-x': flatRect(line, length, -width / 2 + line / 2, 0.031, 0),
    }
    return mergeGeos(Object.entries(sides).filter(([k]) => k !== open).map(([, g]) => g))
  })
  const group = new THREE.Group()
  group.name = 'parking-bay'
  group.add(mesh(geo, mat(color, { roughness: 0.9 }), { cast: false }))
  group.userData = { kind: 'parkingBay', width, length }
  return group
}

/**
 * Zebra crossing covering width (X) × length (Z), centred. Bars are `width` long along X and
 * repeat along Z — pedestrians walk along Z, so it crosses a road that runs along X.
 */
export function createCrosswalk(width, length) {
  const geo = cached(`crosswalk|${width}|${length}`, () => {
    const bar = 0.55
    const n = Math.max(1, Math.floor((length + bar) / (bar * 2)))
    const span = n * bar * 2 - bar
    const bars = []
    for (let i = 0; i < n; i++) bars.push(flatRect(width, bar, 0, 0.028, -span / 2 + bar / 2 + i * bar * 2))
    return mergeGeos(bars)
  })
  const group = new THREE.Group()
  group.name = 'crosswalk'
  group.add(mesh(geo, mat(C.roadLine, { roughness: 0.9 }), { cast: false }))
  group.userData = { kind: 'crosswalk', width, length }
  return group
}

/**
 * Soft radial-gradient ground decal (radius in metres) lying on XZ, 4.5 cm above its origin
 * (baked into the geometry + polygon offset, so it never z-fights the ground).
 * Returns a Mesh with its own material (safe to animate .material.opacity / .material.color);
 * stretch it into an oval/pad with disc.scale.z.
 */
export function createGlowDisc(radius, color = C.selectGlow, opacity = 0.35) {
  const material = new THREE.MeshBasicMaterial({ ...DECAL, map: radialTexture(), color, opacity })
  const disc = new THREE.Mesh(unitDisc(0.045), material)
  disc.name = 'glow-disc'
  disc.scale.set(radius, 1, radius)
  disc.renderOrder = 1
  disc.userData = { kind: 'glow', radius }
  return disc
}

// ───────────────────────────── rooftop / industrial ─────────────────────────────

function acGeos() {
  return cached('ac', () => {
    const light = [boxGeo(2.2, 0.72, 1.2, 0, 0, 0, 0.08, 2)]
    const dark = []
    const hubs = []
    for (const x of [-0.52, 0.52]) {
      light.push(cylGeo(0.47, 0.47, 0.05, x, 0.71, 0, 28))
      dark.push(cylGeo(0.4, 0.4, 0.05, x, 0.73, 0, 28))
      hubs.push(cylGeo(0.09, 0.09, 0.03, x, 0.77, 0, 12))
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.BoxGeometry(0.7, 0.012, 0.07)
        blade.rotateY((i * Math.PI) / 3)
        blade.translate(x, 0.785, 0)
        hubs.push(blade)
      }
    }
    return { light: mergeGeos(light), dark: mergeGeos(dark), hubs: mergeGeos(hubs) }
  })
}

/** Rooftop condenser ≈ 2.2 × 1.2 × 0.8 m (long side along X) with two dark round fans on top. */
export function createACUnit() {
  const g = acGeos()
  const group = new THREE.Group()
  group.name = 'ac-unit'
  group.add(
    mesh(g.light, mat(C.wall, { roughness: 0.7 })),
    mesh(g.dark, mat(0x4b5163, { roughness: 0.6 }), { cast: false }),
    mesh(g.hubs, mat(0x9aa2b5, { roughness: 0.6 }), { cast: false }),
  )
  group.userData = { kind: 'acUnit', height: 0.8 }
  return group
}

/** White storage silo: plinth, cylinder with two subtle hoops, rounded dome. */
export function createSilo({ radius = 2.2, height = 9 } = {}) {
  const geo = cached(`silo|${radius}|${height}`, () => {
    const R = radius
    const domeH = R * 0.6
    const wallTop = height - domeH
    const pts = [[0, 0], [R + 0.12, 0], [R + 0.12, 0.45], [R, 0.5]]
    for (const f of [0.36, 0.68]) {
      const y = 0.5 + (wallTop - 0.5) * f
      pts.push([R, y - 0.08], [R + 0.05, y - 0.05], [R + 0.05, y + 0.05], [R, y + 0.08])
    }
    pts.push([R, wallTop])
    for (let i = 1; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2)
      pts.push([R * Math.cos(a), wallTop + domeH * Math.sin(a)])
    }
    pts[pts.length - 1][0] = 0
    return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 40)
  })
  const group = new THREE.Group()
  group.name = 'silo'
  group.add(mesh(geo, mat(C.wall, { roughness: 0.6 })))
  group.userData = { kind: 'silo', radius, height }
  return group
}

function boothGeos() {
  return cached('booth', () => ({
    white: mergeGeos([
      boxGeo(3.3, 0.15, 2.7, 0, 0, 0, 0.04),
      boxGeo(3.0, 1.0, 2.4, 0, 0.15, 0, 0.04),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => boxGeo(0.12, 1.25, 0.12, sx * 1.44, 1.15, sz * 1.14))),
      boxGeo(3.0, 0.14, 2.4, 0, 2.4, 0),
      boxGeo(3.6, 0.32, 3.0, 0, 2.54, 0, 0.05, 2),
    ]),
    glass: boxGeo(2.9, 1.25, 2.3, 0, 1.15, 0),
    blue: mergeGeos([
      boxGeo(3.62, 0.12, 3.02, 0, 2.6, 0),
      boxGeo(0.9, 2.1, 0.04, 0.8, 0.15, 1.2),
    ]),
  }))
}

/** Boom gate: white post with blue cap; arm striped white/blue, pivot at the post top. */
function barrierGeos(armLength) {
  return cached(`barrier|${armLength}`, () => {
    const seg = armLength / 7
    const stripe = (i) => boxGeo(seg, 0.09, 0.09, 0.2 + seg * (i + 0.5), -0.045, 0)
    return {
      post: boxGeo(0.34, 1.05, 0.34, 0, 0, 0, 0.04),
      cap: boxGeo(0.36, 0.1, 0.36, 0, 0.95, 0),
      armWhite: mergeGeos([0, 2, 4, 6].map(stripe)),
      armBlue: mergeGeos([1, 3, 5].map(stripe)),
    }
  })
}

/**
 * Small gatehouse ≈ 3 × 2.4 × 3 m: white shell, blue-tinted window band, blue fascia, door at +Z.
 * Extra options: barrier (adds a boom gate along +X; userData.barrierArm rotates about Z to open).
 */
export function createGuardBooth({ barrier = false, armLength = 6 } = {}) {
  const g = boothGeos()
  const group = new THREE.Group()
  group.name = 'guard-booth'
  group.add(
    mesh(g.white, mat(C.white, { roughness: 0.6 })),
    mesh(g.glass, mat(mixHex(C.blueGlass, 0xdfe7ff, 0.35), { roughness: 0.25 })),
    mesh(g.blue, mat(C.blue, { roughness: 0.55 })),
  )
  group.userData = { kind: 'guardBooth', height: 2.9 }
  if (barrier) {
    const b = barrierGeos(armLength)
    const gate = new THREE.Group()
    gate.position.set(1.95, 0, 1.2)
    const arm = new THREE.Group()
    arm.position.y = 0.92
    arm.add(mesh(b.armWhite, mat(C.white, { roughness: 0.6 })), mesh(b.armBlue, mat(C.blue, { roughness: 0.55 })))
    gate.add(mesh(b.post, mat(C.white, { roughness: 0.6 })), mesh(b.cap, mat(C.blue, { roughness: 0.55 })), arm)
    group.add(gate)
    group.userData.barrierArm = arm
  }
  return group
}

// ───────────────────────────── filler city buildings ─────────────────────────────

const WALL = css(C.cityWall)
const WINDOW = css(C.cityWindow)

// Facade tiles: one repeating texture per type; walls get whole-module UVs so tiles never stretch
// more than a little. modW/modH = metres covered by one tile.
const FACADES = {
  grid: { modW: 4.2, modH: 3.6, draw: (ctx, w, h) => {
    ctx.fillStyle = WALL
    ctx.fillRect(0, 0, w, h)
    windowRect(ctx, w * 0.24, h * 0.2, w * 0.52, h * 0.56)
  } },
  strip: { modW: 4.2, modH: 3.6, draw: (ctx, w, h) => {
    ctx.fillStyle = WALL
    ctx.fillRect(0, 0, w, h)
    windowRect(ctx, 0, h * 0.26, w, h * 0.46)
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillRect(w * 0.5 - 1, h * 0.26, 2, h * 0.46)
  } },
  dense: { modW: 2.4, modH: 3.1, draw: (ctx, w, h) => {
    ctx.fillStyle = WALL
    ctx.fillRect(0, 0, w, h)
    windowRect(ctx, w * 0.22, h * 0.24, w * 0.56, h * 0.48, '#a9b7ec')
  } },
  clad: { modW: 4, modH: 6, draw: (ctx, w, h) => {
    ctx.fillStyle = '#f4f6fb'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#e3e7f1'
    for (let i = 0; i < 4; i++) ctx.fillRect((i * w) / 4, 0, 2, h)
  } },
}

function windowRect(ctx, x, y, w, h, color = WINDOW) {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, mixCss(color, '#ffffff', 0.18))
  g.addColorStop(1, color)
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.fillRect(x, y, w, Math.max(2, h * 0.08))
}

function mixCss(a, b, t) {
  return css(mixHex(parseInt(a.slice(1), 16), parseInt(b.slice(1), 16), t))
}

const facadeMats = new Map()
function facadeMaterial(type) {
  if (!facadeMats.has(type)) {
    const tex = canvasTexture(128, 128, FACADES[type].draw)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    // walls are open planes: cast from both sides or light leaks along their base
    facadeMats.set(type, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0, shadowSide: THREE.DoubleSide }))
  }
  return facadeMats.get(type)
}

let rollerMat = null
function rollerDoorMaterial() {
  if (!rollerMat) {
    const tex = canvasTexture(64, 128, (ctx, w, h) => {
      ctx.fillStyle = css(C.doorRoll)
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#c2c9d8'
      for (let y = 6; y < h; y += 9) ctx.fillRect(0, y, w, 2)
    })
    rollerMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 })
  }
  return rollerMat
}

/** Four textured wall planes (outward normals) around a w × d footprint, from y0 to y1. */
function wallsGeo(w, d, y0, y1, type) {
  const { modW, modH } = FACADES[type]
  const h = y1 - y0
  const rows = Math.max(1, Math.round(h / modH))
  const faces = [
    { len: w, rot: 0, x: 0, z: d / 2 },
    { len: w, rot: Math.PI, x: 0, z: -d / 2 },
    { len: d, rot: Math.PI / 2, x: w / 2, z: 0 },
    { len: d, rot: -Math.PI / 2, x: -w / 2, z: 0 },
  ]
  return mergeGeos(faces.map(({ len, rot, x, z }) => {
    const g = new THREE.PlaneGeometry(len, h)
    const cols = Math.max(1, Math.round(len / modW))
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * cols, uv.getY(i) * rows)
    g.rotateY(rot)
    g.translate(x, y0 + h / 2, z)
    return g
  }))
}

/** Flat roof slab at y with a parapet ring (outer faces flush with the walls) up to y + rim. */
function roofGeo(w, d, y, rim, extras = []) {
  const t = 0.3
  return mergeGeos([
    boxGeo(w - 0.02, 0.06, d - 0.02, 0, y - 0.06, 0),
    boxGeo(w, rim, t, 0, y, d / 2 - t / 2),
    boxGeo(w, rim, t, 0, y, -d / 2 + t / 2),
    boxGeo(t, rim, d - 2 * t, w / 2 - t / 2, y, 0),
    boxGeo(t, rim, d - 2 * t, -w / 2 + t / 2, y, 0),
    ...extras,
  ])
}

/** Roller doors (+ frames) spread along the south (+Z) face of a w-wide building. */
function rollerDoors(w, d, wallH, r) {
  const count = Math.max(1, Math.min(4, Math.round(w / 14) + (r() < 0.5 ? 0 : 1)))
  const dw = 4
  const dh = Math.min(4.6, wallH - 1.4)
  const doors = []
  const frames = []
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / count
    const p = new THREE.PlaneGeometry(dw, dh)
    p.translate(x, dh / 2, d / 2 + 0.03)
    doors.push(p)
    frames.push(boxGeo(0.18, dh + 0.18, 0.12, x - dw / 2 - 0.09, 0, d / 2), boxGeo(0.18, dh + 0.18, 0.12, x + dw / 2 + 0.09, 0, d / 2))
    frames.push(boxGeo(dw + 0.36, 0.18, 0.12, x, dh, d / 2))
  }
  return { doors: mergeGeos(doors), frames: mergeGeos(frames) }
}

/**
 * Filler city building, footprint w (X) × d (Z), height h.
 * style 'office' (white, blue window grid or ribbon windows) | 'block' (dense small windows,
 * rooftop plant room) | 'warehouse' (white cladding, light-grey roof, roller doors on +Z).
 */
export function createCityBuilding({ w = 24, d = 18, h = 14, style = 'office', seed = 0 } = {}) {
  const r = rng(seed * 13 + 3)
  const group = new THREE.Group()
  group.name = `city-${style}`
  const rim = style === 'warehouse' ? 0.35 : 0.6
  const wallTop = h - rim
  if (style === 'warehouse') {
    group.add(mesh(wallsGeo(w, d, 0, wallTop, 'clad'), facadeMaterial('clad')))
    group.add(mesh(roofGeo(w, d, wallTop, rim), mat(0xe1e5ee, { roughness: 0.85 })))
    const { doors, frames } = rollerDoors(w, d, wallTop, r)
    group.add(mesh(doors, rollerDoorMaterial(), { cast: false }), mesh(frames, mat(0xc8cfde, { roughness: 0.7 })))
  } else {
    const type = style === 'block' ? 'dense' : (r() < 0.6 ? 'grid' : 'strip')
    const extras = []
    if (style === 'block' || r() < 0.5) {
      const pw = Math.min(6, w * 0.3)
      const pd = Math.min(5, d * 0.3)
      extras.push(boxGeo(pw, 2.2, pd, (r() - 0.5) * (w - pw - 2), wallTop, (r() - 0.5) * (d - pd - 2)))
    }
    group.add(mesh(wallsGeo(w, d, 0, wallTop, type), facadeMaterial(type)))
    group.add(mesh(roofGeo(w, d, wallTop, rim, extras), mat(r() < 0.5 ? C.roofWhite : C.wallShade, { roughness: 0.8 })))
  }
  group.userData = { kind: 'cityBuilding', style, width: w, depth: d, height: h }
  return group
}

// ───────────────────────────── batching helper ─────────────────────────────

/**
 * Bake a tree of static props (fences, city buildings, bays, trees…) into one mesh per material +
 * shadow flags. Returns a new Group in the same space as `root` (root itself is left untouched).
 * Shared cached geometries are copied, never modified. Keep map pins / animated parts out of it.
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true)
  const toRoot = root.matrixWorld.clone().invert()
  const buckets = new Map()
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.visible) return
    const g = o.geometry.clone()
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld))
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${!!g.index}|${Object.keys(g.attributes).sort()}`
    if (!buckets.has(key)) buckets.set(key, { material: o.material, cast: o.castShadow, receive: o.receiveShadow, geos: [] })
    buckets.get(key).geos.push(g)
  })
  const out = new THREE.Group()
  out.name = `${root.name || 'props'}-merged`
  for (const b of buckets.values()) out.add(mesh(mergeGeos(b.geos), b.material, { cast: b.cast, receive: b.receive }))
  return out
}
