// Pallet loads: cardboard boxes, blue / white stretch-wrapped blocks on a wooden or blue plastic
// pallet (refs 01, 08, 16, 25, 28). Geometries are cached per variant and shared between every
// pallet instance — never dispose them.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { C, mat, shadows } from '../palette.js'

export const PALLET_W = 1.2   // along X
export const PALLET_D = 1.0   // along Z
export const PALLET_H = 0.15
const LAYER_H = 0.42          // one layer of cartons
const LOAD_W = 1.18
const LOAD_D = 0.98
const GAP = 0.014             // seam between neighbouring cartons

const CARDBOARD_VARIANTS = 6
const WRAP_VARIANTS = 3

// ───────────────────────────── shared geometry helpers (also used by props.js) ─────────────────

/** Deterministic PRNG (mulberry32) → () => [0, 1). */
export function rng(seed = 0) {
  let a = (Math.imul(seed | 0, 2654435761) + 0x9e3779b9) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box geometry whose BOTTOM sits at y (centred on x/z). r > 0 → rounded box. */
export function boxGeo(w, h, d, x = 0, y = 0, z = 0, r = 0, seg = 1) {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, seg, r) : new THREE.BoxGeometry(w, h, d)
  g.translate(x, y + h / 2, z)
  return g
}

/** Paint a flat vertex colour (hex, sRGB) on every vertex of g. Returns g. */
export function tint(g, hex) {
  const c = new THREE.Color(hex)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

/** Merge any mix of indexed / non-indexed geometries into one (inputs are disposed). Stays
 *  indexed when every input is indexed. */
export function mergeGeos(list) {
  const keepIndex = list.every((g) => g.index)
  const flat = list.map((g) => {
    const n = keepIndex || !g.index ? g : g.toNonIndexed()
    n.clearGroups()
    return n
  })
  let out = mergeGeometries(flat, false)
  for (const g of list) g.dispose()
  for (const g of flat) g.dispose()
  if (!keepIndex) {
    // re-index: rounded boxes share most corners → far fewer vertices to upload and shade
    const indexed = mergeVertices(out)
    out.dispose()
    out = indexed
  }
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

/** Mix two hex colours (t = 0 → a, 1 → b) and return a hex number. */
export function mixHex(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex()
}

// ───────────────────────────── materials ─────────────────────────────

const cartonMat = () => mat(0xffffff, { vertexColors: true, roughness: 0.84 })
const wrapMat = () => mat(0xffffff, { vertexColors: true, roughness: 0.45 })
const plasticMat = () => mat(C.blue, { roughness: 0.55 })

// ───────────────────────────── pallet bases ─────────────────────────────

const geoCache = new Map()
function cached(key, build) {
  if (!geoCache.has(key)) geoCache.set(key, build())
  return geoCache.get(key)
}

const ROW_Z = [-0.43, 0, 0.43]
const COL_X = [-0.54, 0, 0.54]

/** Recessed block filling the space under the deck: stops low sun leaking between the feet as
 *  bright streaks on the ground and reads as the dark gap interior. */
const gapCore = () => boxGeo(PALLET_W - 0.16, 0.1, PALLET_D - 0.16, 0, 0.005, 0)

/** EUR-style wooden pallet: bottom boards + 9 blocks + stringers + 5 deck slats. */
function woodBase() {
  return cached('base|wood', () => {
    const boards = []
    const blocks = []
    for (const z of ROW_Z) boards.push(boxGeo(PALLET_W, 0.022, 0.12, 0, 0, z))
    for (const x of COL_X) {
      for (const z of ROW_Z) blocks.push(boxGeo(0.12, 0.078, 0.13, x, 0.022, z))
      blocks.push(boxGeo(0.12, 0.024, PALLET_D, x, 0.1, 0))
    }
    blocks.push(gapCore())
    const slatW = 0.145
    const step = (PALLET_D - slatW) / 4
    for (let i = 0; i < 5; i++) boards.push(boxGeo(PALLET_W, 0.026, slatW, 0, 0.124, -PALLET_D / 2 + slatW / 2 + i * step))
    return { light: mergeGeos(boards), dark: mergeGeos(blocks) }
  })
}

/** Blue plastic pallet: rounded deck plate on 9 feet + 3 runners. */
function plasticBase() {
  return cached('base|plastic', () => {
    const parts = [boxGeo(PALLET_W + 0.02, 0.05, PALLET_D + 0.02, 0, 0.1, 0, 0.02)]
    for (const z of ROW_Z) parts.push(boxGeo(PALLET_W, 0.025, 0.14, 0, 0, z))
    for (const x of COL_X) for (const z of ROW_Z) parts.push(boxGeo(0.15, 0.08, 0.14, x * 0.97, 0.022, z))
    parts.push(gapCore())
    return mergeGeos(parts)
  })
}

// ───────────────────────────── loads ─────────────────────────────

/** One carton (rounded) + its tape strip across the top and down both ends. */
function carton(geos, { x, y, z, w, h, d, color, taped }) {
  geos.push(tint(boxGeo(w - GAP, h - 0.008, d - GAP, x, y, z, 0.03, 1), color))
  if (!taped) return
  const along = w >= d ? 'x' : 'z'
  const len = (along === 'x' ? w : d) - GAP
  const tw = 0.075
  const top = y + h - 0.008
  if (along === 'x') {
    geos.push(tint(boxGeo(len - 0.03, 0.005, tw, x, top - 0.002, z), C.tape))
    for (const s of [-1, 1]) geos.push(tint(boxGeo(0.005, 0.11, tw, x + s * (len / 2 + 0.0005), top - 0.11, z), C.tape))
  } else {
    geos.push(tint(boxGeo(tw, 0.005, len - 0.03, x, top - 0.002, z), C.tape))
    for (const s of [-1, 1]) geos.push(tint(boxGeo(tw, 0.11, 0.005, x, top - 0.11, z + s * (len / 2 + 0.0005)), C.tape))
  }
}

/** Cells of one carton layer: 2×2 grid, or two long cartons whose orientation alternates. */
function layerCells(style, layer) {
  if (style === 1) {
    return layer % 2 === 0
      ? [-1, 1].map((s) => ({ x: s * LOAD_W / 4, z: 0, w: LOAD_W / 2, d: LOAD_D }))
      : [-1, 1].map((s) => ({ x: 0, z: s * LOAD_D / 4, w: LOAD_W, d: LOAD_D / 2 }))
  }
  const cells = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cells.push({ x: sx * LOAD_W / 4, z: sz * LOAD_D / 4, w: LOAD_W / 2, d: LOAD_D / 2 })
  return cells
}

// style per variant: 0 = 2×2 grid, 1 = interlocked long cartons, 2 = one low carton in the top
// layer, 3 = small extra carton on top
const CARDBOARD_STYLES = [0, 1, 2, 0, 3, 1]

function cardboardLoad(layers, variant) {
  return cached(`cardboard|${layers}|${variant}`, () => {
    const r = rng(variant * 7919 + layers * 131 + 17)
    const style = CARDBOARD_STYLES[variant]
    // the video's cartons are a pale, creamy tan: pull the palette browns toward cream
    const shade = () => mixHex(mixHex(C.cardboardDark, C.cardboardLight, 0.15 + r() * 0.8), 0xf4e2c8, 0.3)
    const geos = []
    let height = PALLET_H + layers * LAYER_H
    for (let l = 0; l < layers; l++) {
      const y = PALLET_H + l * LAYER_H
      const isTop = l === layers - 1
      layerCells(style, l).forEach((c, i) => {
        const low = isTop && style === 2 && i === 3
        carton(geos, { ...c, y, h: low ? LAYER_H * 0.55 : LAYER_H, color: shade(), taped: isTop || low })
      })
    }
    if (style === 3) {
      const extra = { x: LOAD_W / 4 - 0.04, y: height, z: -LOAD_D / 4 + 0.03, w: 0.46, h: 0.3, d: 0.4, color: shade(), taped: true }
      carton(geos, extra)
      height += extra.h
    }
    return { geometry: mergeGeos(geos), height }
  })
}

/** One horizontal stretch-wrap band: four thin strips just proud of the load faces, kept clear of
 *  the rounded corners so the block still reads as one solid wrapped unit. */
function wrapBand(geos, y, color) {
  const h = 0.022
  const t = 0.008
  const inset = 0.05
  for (const s of [-1, 1]) {
    geos.push(tint(boxGeo(LOAD_W - inset * 2, h, t, 0, y - h / 2, s * (LOAD_D - 0.012) / 2), color))
    geos.push(tint(boxGeo(t, h, LOAD_D - inset * 2, s * (LOAD_W - 0.012) / 2, y - h / 2, 0), color))
  }
}

/** Stretch-wrapped load: blue = 2×2 tall carton columns, white = two tall halves; light wrap bands. */
function wrappedLoad(kind, layers, variant) {
  return cached(`${kind}|${layers}|${variant}`, () => {
    const r = rng(variant * 4271 + layers * 37 + (kind === 'blue' ? 1 : 2))
    const blue = kind === 'blue'
    const loadH = layers * LAYER_H
    const base = blue ? C.wrapBlue : C.wrapWhite
    const band = blue ? mixHex(C.wrapBlue, C.wrapBlueLight, 0.6) : 0xdfe3ee
    const strap = blue ? C.wrapBlueLight : 0xd3d9e8
    const jitter = () => mixHex(base, blue ? C.blueDark : 0xe4e8f1, r() * (blue ? 0.18 : 0.45))
    const cells = blue
      ? layerCells(0, 0)
      : [-1, 1].map((s) => ({ x: s * LOAD_W / 4, z: 0, w: LOAD_W / 2, d: LOAD_D }))
    const geos = []
    for (const c of cells) {
      geos.push(tint(boxGeo(c.w - 0.012, loadH - 0.01, c.d - 0.012, c.x, PALLET_H, c.z, blue ? 0.04 : 0.06, 2), jitter()))
    }
    const bands = Math.min(3, layers + 1)
    for (let i = 1; i <= bands; i++) wrapBand(geos, PALLET_H + (loadH * i) / (bands + 1), band)
    // cross straps over the top
    const top = PALLET_H + loadH - 0.012
    geos.push(tint(boxGeo(LOAD_W - 0.1, 0.006, 0.045, 0, top, 0), strap))
    if (blue) geos.push(tint(boxGeo(0.045, 0.006, LOAD_D - 0.1, 0, top, 0), strap))
    return { geometry: mergeGeos(geos), height: PALLET_H + loadH }
  })
}

// ───────────────────────────── public API ─────────────────────────────

const DEFAULT_BASE = { cardboard: 'wood', blue: 'plastic', white: 'plastic' }

/**
 * The geometry/material pairs a pallet is made of (shared, cached). Used by createPallet and by
 * props that merge many pallets into a few draw calls (racks). Returns { parts, height }.
 */
export function getPalletParts({ kind = 'cardboard', layers = 2, seed = 0, base } = {}) {
  const k = DEFAULT_BASE[kind] ? kind : 'cardboard'
  const n = Math.max(1, Math.min(4, Math.round(layers) || 2))
  const s = Math.abs(Math.round(seed)) || 0
  const load = k === 'cardboard'
    ? cardboardLoad(n, s % CARDBOARD_VARIANTS)
    : wrappedLoad(k, n, s % WRAP_VARIANTS)
  const parts = [{ geometry: load.geometry, material: k === 'cardboard' ? cartonMat() : wrapMat() }]
  if ((base ?? DEFAULT_BASE[k]) === 'wood') {
    const wood = woodBase()
    parts.push({ geometry: wood.light, material: mat(C.wood) }, { geometry: wood.dark, material: mat(C.woodDark) })
  } else {
    parts.push({ geometry: plasticBase(), material: plasticMat() })
  }
  return { parts, height: load.height }
}

/**
 * A 1.2 × 1.0 m pallet with its load. Origin = ground centre; long side along X.
 * kind: 'cardboard' | 'blue' | 'white'; layers: carton layers (≈ 0.42 m each); seed: look variant.
 * Extra option base: 'wood' | 'plastic' (default: wood for cardboard, blue plastic for wrapped).
 */
export function createPallet({ kind = 'cardboard', layers = 2, seed = 0, base } = {}) {
  const load = DEFAULT_BASE[kind] ? kind : 'cardboard'
  const { parts, height } = getPalletParts({ kind: load, layers, seed, base })
  const group = new THREE.Group()
  group.name = `pallet-${load}`
  for (const p of parts) group.add(new THREE.Mesh(p.geometry, p.material))
  group.userData = { kind: 'pallet', load, height, width: PALLET_W, depth: PALLET_D }
  return shadows(group)
}
