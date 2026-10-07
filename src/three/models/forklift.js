// Counterbalance forklift (SPEC §4.2): yellow counterweight + cowl, blue chassis/front body,
// black overhead guard and mast, seated operator (orange vest, yellow hard hat).
// Origin = ground centre of the whole footprint (body + forks), facing +Z (mast/forks at +Z).
//
// Geometry is cached and shared by every forklift: one vertex-coloured body mesh, three mast meshes
// (outer rails, inner rails, carriage + forks) and four wheels → 8 draw calls per forklift.
import * as THREE from 'three'
import { C, shadows } from '../palette.js'
import { PartList, createWheelGeometry, vertexColorMaterial } from './truck.js'

const LENGTH = 3.5
const WIDTH = 1.15
const HEIGHT = 2.25
const REAR_Z = -1.75

const MAST_Z = 0.6        // outer mast rails (body front face is at ≈ 0.545)
const CARRIAGE_Z = 0.74   // carriage front face = fork heel
const FORK_LEN = 1.01     // fork tips at z ≈ 1.75
const FORK_BASE_Y = 0.03  // fork blade underside when fully lowered
const FREE_LIFT = 1.1     // carriage travel before the inner mast starts to extend
const MAX_LIFT = 3.0
const PALLET_HALF_DEPTH = 0.5 // 1.2 (X) × 1.0 (Z) pallet

const FRONT_WHEEL = { r: 0.32, w: 0.26, x: 0.445, z: 0.2 }
const REAR_WHEEL = { r: 0.26, w: 0.24, x: 0.455, z: -1.22 }

const BLACK = C.black
const TROUSERS = 0x2c3552
const STEEL = 0x9aa2b4

function addChassis(p) {
  const Y = C.forkYellow
  const B = C.forkBlue
  p.rbox(0.92, 0.36, 2.25, 0.08, B, 0, 0.32, -0.58)  // floor pan between the wheels
  p.rbox(1.1, 0.64, 1.25, 0.1, B, 0, 0.56, -0.08)    // front body over the drive wheels
  p.rbox(1.06, 0.3, 0.42, 0.08, Y, 0, 1.0, 0.31)     // dashboard cowl behind the mast
  p.rbox(1.15, 1.02, 1.12, 0.18, Y, 0, 0.7, -1.19)   // counterweight
  // counterweight details: rear bumper strip, tail lights, cooling slot
  p.rbox(1.02, 0.14, 0.06, 0.03, BLACK, 0, 0.34, REAR_Z + 0.01)
  for (const s of [-1, 1]) p.rbox(0.14, 0.09, 0.04, 0.02, 0xe5484d, s * 0.4, 0.98, REAR_Z + 0.01)
  p.rbox(0.5, 0.06, 0.04, 0.02, 0x3a3f4c, 0, 0.98, REAR_Z + 0.01)

  // seat
  p.rbox(0.56, 0.13, 0.5, 0.05, BLACK, 0, 0.95, -0.36)
  p.rbox(0.56, 0.6, 0.12, 0.05, BLACK, 0, 1.25, -0.62)

  // steering column + wheel
  p.cyl(0.035, 0.36, BLACK, 0, 1.25, 0.16, -0.64)
  p.add(new THREE.TorusGeometry(0.15, 0.028, 6, 18), BLACK, 0, 1.38, 0.06, 0.93)
}

function addOverheadGuard(p) {
  for (const s of [-1, 1]) {
    p.box(0.07, 1.06, 0.07, BLACK, s * 0.5, 1.7, -0.74) // rear posts on the counterweight
    p.box(0.07, 1.1, 0.07, BLACK, s * 0.5, 1.67, 0.44)  // front posts from the cowl
    p.box(0.07, 0.07, 1.32, BLACK, s * 0.5, 2.2, -0.15) // roof side rails
  }
  // roof: solid plate with raised slats
  p.box(1.03, 0.03, 1.3, BLACK, 0, 2.2, -0.15)
  for (let i = 0; i < 6; i++) p.box(1.07, 0.04, 0.09, 0x2f333e, 0, 2.225, -0.7 + i * 0.22)
}

function addOperator(p) {
  const V = C.vestOrange
  p.rbox(0.44, 0.2, 0.46, 0.07, TROUSERS, 0, 1.1, -0.28)    // thighs
  p.rbox(0.38, 0.22, 0.16, 0.06, TROUSERS, 0, 0.99, 0.0)    // shins
  p.rbox(0.5, 0.6, 0.32, 0.11, V, 0, 1.36, -0.42)           // torso / hi-vis vest
  p.rbox(0.51, 0.05, 0.33, 0.02, 0xf4f1e6, 0, 1.3, -0.42)   // reflective band
  for (const s of [-1, 1]) {
    p.rbox(0.11, 0.11, 0.5, 0.05, V, s * 0.2, 1.46, -0.19, 0.38) // arms toward the wheel
    p.sphere(0.055, C.skin, s * 0.14, 1.37, 0.06, 8)            // hands
  }
  p.cyl(0.06, 0.08, C.skin, 0, 1.68, -0.42)                 // neck
  p.sphere(0.14, C.skin, 0, 1.8, -0.42)                     // head
  p.add(new THREE.SphereGeometry(0.165, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), C.forkYellow, 0, 1.84, -0.42)
  p.cyl(0.2, 0.03, C.forkYellow, 0, 1.845, -0.4, 0, 0, 0, 18) // hat brim
}

function mastOuterGeometry() {
  const p = new PartList()
  for (const s of [-1, 1]) p.box(0.1, 2.32, 0.14, BLACK, s * 0.36, 1.2, 0)
  p.box(0.81, 0.08, 0.1, BLACK, 0, 2.32, 0)
  p.box(0.81, 0.1, 0.1, BLACK, 0, 0.3, 0)
  p.cyl(0.045, 1.5, STEEL, 0, 0.95, -0.08) // lift cylinder
  return p.merge()
}

function mastInnerGeometry() {
  const p = new PartList()
  for (const s of [-1, 1]) p.box(0.07, 2.2, 0.08, BLACK, s * 0.27, 1.14, 0.03)
  p.box(0.6, 0.07, 0.08, BLACK, 0, 2.2, 0.03)
  return p.merge()
}

/** Carriage plate, load backrest and forks; local origin = fork heel at the blade underside. */
function carriageGeometry() {
  const p = new PartList()
  p.box(0.98, 0.42, 0.06, BLACK, 0, 0.32, -0.03)
  for (const x of [-0.45, -0.15, 0.15, 0.45]) p.box(0.04, 0.6, 0.04, BLACK, x, 0.83, -0.03)
  p.box(0.98, 0.05, 0.05, BLACK, 0, 1.13, -0.03)
  for (const s of [-1, 1]) {
    p.box(0.12, 0.05, FORK_LEN, BLACK, s * 0.3, 0.025, FORK_LEN / 2)
    p.box(0.12, 0.58, 0.05, BLACK, s * 0.3, 0.29, -0.025)
  }
  return p.merge()
}

let shared = null

function geometries() {
  if (shared) return shared
  const body = (operator) => {
    const p = new PartList()
    addChassis(p)
    addOverheadGuard(p)
    if (operator) addOperator(p)
    return p.merge()
  }
  shared = {
    bodyWithOperator: body(true),
    bodyEmpty: body(false),
    mastOuter: mastOuterGeometry(),
    mastInner: mastInnerGeometry(),
    carriage: carriageGeometry(),
    frontWheel: createWheelGeometry(FRONT_WHEEL.r, FRONT_WHEEL.w),
    rearWheel: createWheelGeometry(REAR_WHEEL.r, REAR_WHEEL.w),
  }
  return shared
}

/**
 * createForklift({ operator }) → THREE.Group
 * userData: { kind:'forklift', forkAnchor, mast, carriage, setForkHeight(h), forkHeight, wheels,
 *             wheelRadius, length, width, height }
 * - forkAnchor: a pallet Group added at its local origin sits on the forks (1.2 × 1.0 footprint,
 *   load centred along the forks).
 * - setForkHeight(h): fork blade height above the ground in metres, clamped to [0, 3]; the inner
 *   mast extends once the carriage passes the free-lift height.
 * - wheels have userData.radius (front 0.32, rear 0.26): spin with rotation.x += distance / radius.
 */
export function createForklift({ operator = true } = {}) {
  const g = geometries()
  const vc = vertexColorMaterial()
  const group = new THREE.Group()
  group.name = 'forklift'

  const body = new THREE.Mesh(operator ? g.bodyWithOperator : g.bodyEmpty, vc)
  body.name = 'body'
  group.add(body)

  const mast = new THREE.Group()
  mast.name = 'mast'
  mast.position.z = MAST_Z
  const inner = new THREE.Mesh(g.mastInner, vc)
  const carriage = new THREE.Group()
  carriage.name = 'carriage'
  carriage.position.z = CARRIAGE_Z - MAST_Z
  carriage.add(new THREE.Mesh(g.carriage, vc))
  const forkAnchor = new THREE.Object3D()
  forkAnchor.name = 'forkAnchor'
  forkAnchor.position.z = PALLET_HALF_DEPTH + 0.02
  carriage.add(forkAnchor)
  mast.add(new THREE.Mesh(g.mastOuter, vc), inner, carriage)
  group.add(mast)

  const wheels = []
  for (const [spec, geo] of [[FRONT_WHEEL, g.frontWheel], [REAR_WHEEL, g.rearWheel]]) {
    for (const s of [-1, 1]) {
      const wheel = new THREE.Mesh(geo, vc)
      wheel.name = 'wheel'
      wheel.position.set(s * spec.x, spec.r, spec.z)
      wheel.userData.radius = spec.r
      wheels.push(wheel)
      group.add(wheel)
    }
  }

  const setForkHeight = (h) => {
    const lift = THREE.MathUtils.clamp(Number(h) || 0, 0, MAX_LIFT)
    carriage.position.y = FORK_BASE_Y + lift
    inner.position.y = Math.max(0, lift - FREE_LIFT)
    group.userData.forkHeight = lift
  }

  group.userData = {
    kind: 'forklift', forkAnchor, mast, carriage, setForkHeight, forkHeight: 0, wheels,
    wheelRadius: FRONT_WHEEL.r, length: LENGTH, width: WIDTH, height: HEIGHT,
  }
  setForkHeight(0)

  return shadows(group)
}
