// Shared 3D colour palette + cached materials. Every model factory must use these so the
// scene keeps the soft, pastel "clay" look of the reference video.
import * as THREE from 'three'

export const C = {
  // environment
  sky: 0xeef1fa,          // background + fog
  ground: 0xe3e7f3,       // base ground outside lots
  lot: 0xedf0f8,          // paved yard inside a site
  sidewalk: 0xf6f7fc,
  curb: 0xdfe4f1,
  road: 0xc6cff0,         // periwinkle asphalt
  roadDark: 0xb7c2ea,
  roadLine: 0xffffff,
  grass: 0xd5f0de,        // mint grass patches
  grassGlow: 0xc6f0d4,
  yellowLine: 0xf2c14e,   // parking-bay outlines, platform edges

  // brand / buildings
  blue: 0x2f5bea,         // WareTrack primary (roofs, cab, pins)
  blueDark: 0x2347c9,
  blueMid: 0x4a70f0,
  blueLight: 0x8fa6f5,
  blueGlass: 0x5c80ee,
  wall: 0xeef0f6,         // white/grey cladding
  wallShade: 0xdfe3ee,
  roofWhite: 0xf3f5fa,
  doorFrame: 0x2447c8,
  doorInside: 0xc9cfdc,   // dark-ish interior behind open dock doors
  doorRoll: 0xd6dbe6,     // closed roller door

  // vehicles
  white: 0xf7f8fc,
  black: 0x22252e,
  tire: 0x2b2e37,
  hub: 0xc3c9d6,
  glassDark: 0x1d2433,
  forkYellow: 0xf5b72e,
  forkBlue: 0x3d5af1,
  skin: 0xc68a63,
  vestOrange: 0xf28a2e,
  navy: 0x1f2a78,
  teal: 0x16a08b,
  orange: 0xf26b1d,
  container: 0x2bb5a6,

  // cargo
  cardboard: 0xd9aa72,
  cardboardLight: 0xe6bf8c,
  cardboardDark: 0xc9965c,
  tape: 0xf0d6ac,
  wood: 0xd2a679,
  woodDark: 0xb98b5e,
  wrapBlue: 0x3f63e6,
  wrapBlueLight: 0x6d8af0,
  wrapWhite: 0xf1f3f8,

  // props
  tree: 0x6dd197,
  treeDark: 0x52b97c,
  trunk: 0x8a5a3b,
  fencePost: 0xb3bdd6,
  fencePanel: 0xdfe5f3,
  charger: 0xf4f6fa,
  chargerGlow: 0x7ee2a2,
  rackUpright: 0x3557e6,
  rackBeam: 0xf28a2e,
  cityWall: 0xf1f3f9,
  cityWindow: 0x8ea4ee,

  // highlight / UI-in-3D
  select: 0x3b5bdb,
  selectGlow: 0x5a7cff,
}

const cache = new Map()

/**
 * Cached MeshStandardMaterial. mat(C.blue) or mat(C.blue, { roughness: 0.4 }).
 * Default: roughness 0.78, metalness 0 → soft matte clay look.
 */
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, ...opts }))
  }
  return cache.get(key)
}

/** Transparent material helper (glass, fence panels, glows). */
export function matTransparent(color, opacity, opts = {}) {
  return mat(color, { transparent: true, opacity, depthWrite: false, ...opts })
}

/** Unlit basic material (ground decals, lines). */
export function matBasic(color, opts = {}) {
  const key = `basic|${color}|${JSON.stringify(opts)}`
  if (!cache.has(key)) cache.set(key, new THREE.MeshBasicMaterial({ color, ...opts }))
  return cache.get(key)
}

/** Enable cast/receive shadows on every mesh of a subtree. */
export function shadows(obj, cast = true, receive = true) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast
      o.receiveShadow = receive
    }
  })
  return obj
}
