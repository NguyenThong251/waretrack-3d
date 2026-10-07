// Dev harness for the vehicle models: every carrier truck (+ a reefer), trucks seen from the other
// side and from the rear, and forklifts (empty, carrying a pallet stand-in, forks raised, no
// operator). Lighting follows SPEC §3. window.__vehicles exposes the scene for debugging.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { C, mat, shadows } from '../src/three/palette.js'
import { createTruck } from '../src/three/models/truck.js'
import { createForklift } from '../src/three/models/forklift.js'

const deg = THREE.MathUtils.degToRad
// Screen axes for the default camera (azimuth 45°): RIGHT runs left→right, AWAY into the distance.
const RIGHT = new THREE.Vector3(1, 0, -1).normalize()
const AWAY = new THREE.Vector3(-1, 0, -1).normalize()
const at = (right, away) => RIGHT.clone().multiplyScalar(right).addScaledVector(AWAY, away)

// Canvas liveries want Inter; don't wait forever if the font CDN is unreachable.
await Promise.race([
  document.fonts?.load('800 40px Inter') ?? Promise.resolve(),
  new Promise((resolve) => setTimeout(resolve, 2500)),
])

// ── renderer / scene / camera ──
const container = document.getElementById('viewport')
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap // r186 removed PCFSoftShadowMap (PCF is soft now)
container.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(C.sky)
scene.fog = new THREE.Fog(C.sky, 420, 1100)

const camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 1, 2500)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.screenSpacePanning = false
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
controls.minPolarAngle = 0.35
controls.maxPolarAngle = 1.25

// ── lights (SPEC §3) ──
scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe5f5, 1.6))
const sun = new THREE.DirectionalLight(0xfff6ea, 2.2)
sun.position.set(-50, 110, 70) // south-west, high → shadows fall north-east
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 400 })
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.03
sun.shadow.radius = 3
scene.add(sun, sun.target)
const fill = new THREE.DirectionalLight(0xe4ebff, 0.45)
fill.position.set(60, 40, 60)
scene.add(fill)

// ── ground + parking bays ──
const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), mat(C.lot))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

function parkingBay(width, length) {
  const bay = new THREE.Group()
  const line = mat(C.yellowLine)
  const t = 0.18
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(t, 0.02, length), line)
    side.position.set((s * width) / 2, 0.01, 0)
    const end = new THREE.Mesh(new THREE.BoxGeometry(width + t, 0.02, t), line)
    end.position.set(0, 0.01, (s * length) / 2)
    bay.add(side, end)
  }
  return shadows(bay, false, true)
}

// ── vehicles ──
const trucks = []
const forklifts = []

function place(obj, pos, heading) {
  obj.position.copy(pos)
  obj.rotation.y = heading
  scene.add(obj)
  return obj
}

function addTruck(opts, pos, heading, bay = false) {
  const truck = place(createTruck(opts), pos, heading)
  if (bay) place(parkingBay(3.6, 12.4), pos, heading)
  trucks.push(truck)
  return truck
}

// Row A — all carriers + a reefer, facing +Z (cab toward the lower-left, like frames 01/02).
const rowA = [
  { carrier: 'waretrack' },
  { carrier: 'bluepeak' },
  { carrier: 'nordline' },
  { carrier: 'cargoviva' },
  { carrier: 'bluepeak', reefer: true },
]
rowA.forEach((opts, i) => addTruck(opts, at((i - 2) * 11, 0), 0, true))

// Row B — facing +X (cab toward the lower-right, like frames 16/06): shows the other box side.
const rowB = ['nordline', 'bluepeak', 'waretrack', 'cargoviva']
rowB.forEach((carrier, i) => addTruck({ carrier, reefer: carrier === 'bluepeak' }, at((i - 1.5) * 13, 17), Math.PI / 2))

// Row C — seen from behind (rear doors, like frame 05).
addTruck({ carrier: 'waretrack' }, at(-9, 34), Math.PI + deg(20))
addTruck({ carrier: 'bluepeak' }, at(6, 34), Math.PI + deg(35))
addTruck({ carrier: 'nordline' }, at(20, 34), -Math.PI / 2 - deg(25))

// Forklifts, closer to the camera.
function palletStandIn() {
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 1.0), mat(C.wood))
  base.position.y = 0.075
  const load = new THREE.Mesh(new THREE.BoxGeometry(1.14, 1.05, 0.96), mat(C.cardboard))
  load.position.y = 0.15 + 0.525
  g.add(base, load)
  return shadows(g)
}

const flEmpty = place(createForklift(), at(-9, -14), 0)
const flLoaded = place(createForklift(), at(-3, -14), Math.PI / 2)
flLoaded.userData.forkAnchor.add(palletStandIn())
flLoaded.userData.setForkHeight(0.15)
const flRaised = place(createForklift(), at(3, -14), -deg(45))
flRaised.userData.setForkHeight(1.6)
const flNoOperator = place(createForklift({ operator: false }), at(9, -14), deg(200))
forklifts.push(flEmpty, flLoaded, flRaised, flNoOperator)

// ── camera presets ──
const views = {
  overview: { target: at(0, 8), distance: 165, azimuth: deg(45), polar: deg(50) },
  carriers: { target: at(0, 0), distance: 82, azimuth: deg(45), polar: deg(50) },
  waretrack: { target: at(-22, 0).setY(1.5), distance: 34, azimuth: deg(45), polar: deg(52) },
  closeup: { target: at(-19.5, 17).setY(1.5), distance: 28, azimuth: deg(38), polar: deg(55) },
  otherSide: { target: at(0, 17), distance: 70, azimuth: deg(45), polar: deg(50) },
  rear: { target: at(5, 34), distance: 62, azimuth: deg(45), polar: deg(50) },
  forklifts: { target: at(0, -14).setY(0.8), distance: 48, azimuth: deg(45), polar: deg(52) },
  forkLoaded: { target: at(-3, -14).setY(1), distance: 13, azimuth: deg(45), polar: deg(55) },
  forkRaised: { target: at(3, -14).setY(1.2), distance: 13, azimuth: deg(45), polar: deg(55) },
  reefer: { target: at(22, 0).setY(2), distance: 30, azimuth: deg(15), polar: deg(55) },
  video: { target: at(0, 8), distance: 150, azimuth: deg(45), polar: deg(50) },
}

function setView(name) {
  const v = views[name]
  if (!v) return
  controls.target.copy(v.target)
  const s = Math.sin(v.polar)
  camera.position.set(
    v.target.x + v.distance * s * Math.sin(v.azimuth),
    v.target.y + v.distance * Math.cos(v.polar),
    v.target.z + v.distance * s * Math.cos(v.azimuth),
  )
  controls.update()
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('active', b.dataset.view === name))
  render()
}

const viewBar = document.getElementById('views')
for (const name of Object.keys(views)) {
  const b = document.createElement('button')
  b.textContent = name
  b.dataset.view = name
  b.addEventListener('click', () => setView(name))
  viewBar.appendChild(b)
}

// ── animation (optional): wheels roll, forks of the third forklift cycle ──
let animate = false
const animBtn = document.getElementById('animate')
animBtn.addEventListener('click', () => {
  animate = !animate
  animBtn.classList.toggle('active', animate)
})

const timer = new THREE.Timer()
function update(dt, t) {
  if (!animate) return
  for (const v of [...trucks, ...forklifts]) {
    for (const w of v.userData.wheels) w.rotation.x += (dt * 4) / w.userData.radius
  }
  flRaised.userData.setForkHeight(1.5 + 1.4 * Math.sin(t * 0.8))
}

function render() {
  timer.update()
  update(Math.min(timer.getDelta(), 0.1), timer.getElapsed())
  controls.update()
  sun.position.copy(controls.target).add(new THREE.Vector3(-50, 110, 70))
  sun.target.position.copy(controls.target)
  renderer.render(scene, camera)
}

function loop() {
  render()
  requestAnimationFrame(loop)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  render()
})

// URL params: ?view=<preset>&hud=0 (handy for screenshots, survives Vite full reloads)
const params = new URLSearchParams(location.search)
if (params.get('hud') === '0') document.querySelector('.hud').style.display = 'none'
// Vite shows its error overlay for any broken module on the server, even ones this page never
// imports; keep it from covering the harness.
new MutationObserver(() => document.querySelector('vite-error-overlay')?.remove())
  .observe(document.body, { childList: true })
document.querySelector('vite-error-overlay')?.remove()

setView(params.get('view') || 'carriers')
loop()
setInterval(render, 250) // hidden tabs throttle rAF

window.__vehicles = { scene, camera, controls, renderer, render, setView, views, trucks, forklifts }
