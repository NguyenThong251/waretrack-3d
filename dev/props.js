// Dev gallery for src/three/models/pallet.js + props.js: every factory laid out in screen-aligned
// rows, lit like the app (SPEC §3). Views: #all #pallets #props #yard #city #pins (keys 1–6).
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { C, mat, shadows } from '../src/three/palette.js'
import { textPlane } from '../src/three/canvasText.js'
import { createPallet } from '../src/three/models/pallet.js'
import {
  createTree, createBush, createFence, createRack, createContainer, createCharger, createMapPin,
  createParkingBay, createACUnit, createSilo, createGuardBooth, createCityBuilding, createGlowDisc,
  createCrosswalk,
} from '../src/three/models/props.js'

// ───────────────────────────── renderer / scene / lights ─────────────────────────────

const host = document.getElementById('view')
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap   // r186 removed PCFSoftShadowMap (falls back to this anyway)
host.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(C.sky)
scene.fog = new THREE.Fog(C.sky, 420, 1100)

const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.5, 3000)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe5f5, 1.6))
const sun = new THREE.DirectionalLight(0xfff6ea, 2.2)
sun.position.set(-70, 120, 60)
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 60, far: 320 })
sun.shadow.bias = -0.00008   // depth units: × 260 m range ≈ 2 cm (bigger values detach shadows from thin bases)
sun.shadow.normalBias = 0.02
scene.add(sun, sun.target)
const fill = new THREE.DirectionalLight(0xdfe7ff, 0.35)
fill.position.set(80, 40, -40)
scene.add(fill)

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), mat(C.lot))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// ───────────────────────────── gallery layout ─────────────────────────────

// (u, v) screen-aligned coordinates: u → right on screen, v → toward the camera (down on screen)
const S = Math.SQRT1_2
const at = (u, v) => new THREE.Vector3((u + v) * S, 0, (v - u) * S)
const gallery = new THREE.Group()
scene.add(gallery)

function place(obj, u, v, label, { rot = 0, labelV = 2.2 } = {}) {
  obj.position.copy(at(u, v))
  obj.rotation.y += rot
  gallery.add(obj)
  if (label) {
    const text = textPlane(label, 0.55, { color: '#5d6579', weight: 600, size: 64 })
    text.rotation.set(-Math.PI / 2, Math.PI / 4, 0, 'YXZ')
    text.position.copy(at(u, v + labelV)).setY(0.03)
    gallery.add(text)
  }
  return obj
}

function patch(color, u, v, w, d) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color))
  m.rotation.set(-Math.PI / 2, Math.PI / 4, 0, 'YXZ')
  m.position.copy(at(u, v)).setY(0.01)
  m.receiveShadow = true
  gallery.add(m)
}

// row: pallets
const palletRow = [
  ['cardboard ×2 s0', { kind: 'cardboard', layers: 2, seed: 0 }],
  ['s1', { kind: 'cardboard', layers: 2, seed: 1 }],
  ['s2', { kind: 'cardboard', layers: 2, seed: 2 }],
  ['s4', { kind: 'cardboard', layers: 2, seed: 4 }],
  ['×3 s3', { kind: 'cardboard', layers: 3, seed: 3 }],
  ['×3 s5', { kind: 'cardboard', layers: 3, seed: 5 }],
  ['plastic base', { kind: 'cardboard', layers: 2, seed: 0, base: 'plastic' }],
  ['blue ×2', { kind: 'blue', layers: 2, seed: 0 }],
  ['blue ×3', { kind: 'blue', layers: 3, seed: 1 }],
  ['white ×2', { kind: 'white', layers: 2, seed: 0 }],
  ['white ×1', { kind: 'white', layers: 1, seed: 1 }],
]
palletRow.forEach(([label, opts], i) => place(createPallet(opts), -15 + i * 3, 14, label, { labelV: 1.6 }))

// pins on top of a few staged pallets (as in the frames)
const pins = []
for (const [i, kind] of [[12, 'cardboard'], [13.5, 'blue'], [15, 'white']]) {
  const p = place(createPallet({ kind, layers: 2, seed: i }), -15 + i * 3, 14, i === 12 ? 'pinned' : null, { labelV: 1.6 })
  const pin = createMapPin()
  pin.position.set(0, p.userData.height, 0)
  p.add(pin)
  pins.push(pin)
}

// vignette mirroring frame 08 (WH-04 staging): pinned cardboard + blue, white wrapped behind
const vignette = new THREE.Group()
vignette.position.copy(at(0, 30))
gallery.add(vignette)
const stage = [
  { kind: 'cardboard', seed: 0, x: -2.2, z: 1.6, pin: true },
  { kind: 'blue', seed: 0, x: 1.4, z: 2.6, pin: true },
  { kind: 'white', layers: 1, seed: 0, x: -0.6, z: -2.6 },
  { kind: 'white', layers: 1, seed: 1, x: 3.2, z: -0.6 },
  { kind: 'cardboard', seed: 1, x: 4.6, z: -0.2 },
]
for (const s of stage) {
  const p = createPallet({ layers: 2, ...s })
  p.position.set(s.x, 0, s.z)
  vignette.add(p)
  if (s.pin) {
    const pin = createMapPin()
    pin.position.y = p.userData.height
    p.add(pin)
    pins.push(pin)
  }
}
const slotLines = createParkingBay(9, 5, { line: 0.1 })
slotLines.position.set(2.2, 0, -1)
vignette.add(slotLines)

// row: yard props
patch(C.grass, -14, 4, 18, 6)
for (let i = 0; i < 4; i++) place(createTree({ seed: i }), -21 + i * 4.2, 4, `tree s${i}`, { labelV: 2.6 })
place(createBush(), -6.5, 4.5, 'bush', { labelV: 2 })
place(createFence(9), -3, 2, 'fence 9 m', { labelV: 4 })
const pad = createGlowDisc(4.2, C.chargerGlow, 0.5)
pad.scale.z = 2.6
place(pad, 11, 4)
for (let i = 0; i < 3; i++) place(createCharger(), 9.8 + i * 1.2, 2.4, i === 1 ? 'chargers + glow pad' : null, { labelV: 4.4 })
place(createParkingBay(4, 15), 20, 4, 'parking bay 4×15', { labelV: 8.6 })
patch(C.road, 30, 4, 7, 14)
place(createCrosswalk(4, 7), 30, 4, 'crosswalk 4×7', { labelV: 8 })
place(createGlowDisc(3), 38, 4, 'select glow', { labelV: 3.6 })

// row: structures
place(createRack({ bays: 2, levels: 3, seed: 1 }), -20, -9, 'rack 2×3', { labelV: 3.6 })
place(createRack({ bays: 3, levels: 3, fill: 0.6, seed: 4 }), -9, -9, 'rack 3×3 fill .6', { labelV: 3.6 })
place(createContainer(), 6, -9, 'container 12.2', { labelV: 4.2 })
place(createContainer({ color: C.blue, label: 'WARETRACK', length: 6.1 }), 18, -9, '20 ft blue', { labelV: 4.2 })
place(createSilo(), 27, -9, 'silo', { labelV: 4.2 })
place(createSilo({ radius: 1.6, height: 7 }), 32, -10.5, null)
place(createGuardBooth({ barrier: true }), 40, -9, 'guard booth', { labelV: 4.2 })
for (let i = 0; i < 3; i++) place(createACUnit(), 48 + i * 3, -9, i === 1 ? 'AC units' : null, { labelV: 2.6 })

// row: city
place(createCityBuilding({ w: 26, d: 18, h: 16, style: 'office', seed: 0 }), -22, -40, 'office s0', { labelV: 17 })
place(createCityBuilding({ w: 22, d: 16, h: 22, style: 'office', seed: 2 }), 6, -40, 'office s2', { labelV: 17 })
place(createCityBuilding({ w: 18, d: 18, h: 26, style: 'block', seed: 1 }), 30, -40, 'block', { labelV: 17 })
place(createCityBuilding({ w: 36, d: 22, h: 9, style: 'warehouse', seed: 3 }), 60, -40, 'warehouse', { labelV: 17 })

shadows(ground, false, true)

// ───────────────────────────── views ─────────────────────────────

const VIEWS = {
  all: { u: 14, v: -12, dist: 230 },
  pallets: { u: 6, v: 14, dist: 52 },
  props: { u: 8, v: 3, dist: 80 },
  yard: { u: 11, v: 3, dist: 32 },
  structures: { u: 16, v: -9, dist: 100 },
  city: { u: 20, v: -40, dist: 190 },
  pins: { u: 23, v: 14, dist: 24 },
  frame08: { u: 0, v: 30, dist: 40 },
}

/** Aim the camera at gallery coords (u, v) — also handy from the console: __props.look(...) */
function look({ u = 0, v = 0, y = 0.8, dist = 60, az = Math.PI / 4, polar = 0.87 } = {}) {
  const target = at(u, v).setY(y)
  controls.target.copy(target)
  camera.position.set(
    target.x + dist * Math.sin(polar) * Math.sin(az),
    target.y + dist * Math.cos(polar),
    target.z + dist * Math.sin(polar) * Math.cos(az),
  )
  sun.target.position.copy(target)
  sun.position.copy(target).add(new THREE.Vector3(-70, 120, 60))
  controls.update()
  render()
}

function setView(name) {
  const view = VIEWS[name] ?? VIEWS.all
  const dist = Number(new URLSearchParams(location.search).get('dist')) || view.dist
  look({ ...view, dist, y: name === 'city' ? 6 : 0.8 })
  document.querySelectorAll('#views a').forEach((a) => a.classList.toggle('on', a.hash === `#${name}`))
}

const viewsEl = document.getElementById('views')
Object.keys(VIEWS).forEach((name, i) => {
  const a = document.createElement('a')
  a.href = `#${name}`
  a.textContent = `${i + 1} ${name}`
  viewsEl.appendChild(a)
})
addEventListener('hashchange', () => setView(location.hash.slice(1)))
addEventListener('keydown', (e) => {
  const name = Object.keys(VIEWS)[Number(e.key) - 1]
  if (name) location.hash = name
})
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  render()
})

// ───────────────────────────── loop ─────────────────────────────

const t0 = performance.now()
function render() {
  const t = (performance.now() - t0) / 1000
  pins.forEach((pin, i) => { pin.userData.head.position.y = 0.12 + Math.sin(t * 2.4 + i) * 0.12 })
  controls.update()
  renderer.render(scene, camera)
}

setView(location.hash.slice(1) || 'all')
renderer.setAnimationLoop(render)
setInterval(render, 250)   // hidden tabs throttle rAF

const info = renderer.info.render
setTimeout(() => {
  document.getElementById('stats').textContent = `${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k tris`
}, 600)
/** Render a view at a fixed size and return a PNG data URL (works while the tab is hidden). */
function capture(view, w = 1248, h = 718) {
  renderer.setPixelRatio(1)
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  look(view)
  render()   // second frame: pins billboard toward the new camera
  return renderer.domElement.toDataURL('image/png')
}

window.__props = { scene, camera, controls, renderer, render, setView, look, capture }
