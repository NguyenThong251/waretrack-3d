// Scene shell: WebGL renderer, soft pastel lighting, map-style OrbitControls, CSS2D label layer,
// the frame loop and eased camera flights. Contract: docs/SPEC.md §6.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { C } from './palette.js'

const FOV = 28
const POLAR_RANGE = [0.35, 1.25]
const DISTANCE_RANGE = [18, 1400]
const MAX_DT = 0.1
const DEFAULT_VIEW = { target: { x: 0, y: 0, z: 0 }, distance: 190, azimuth: Math.PI / 4, polar: 0.87 }

// Light rig tuned against docs/ref frames (01, 15, 21, 23): cool sky + white key + a faint room
// environment give the airy pastel "clay" look (cyan-leaning lit blues, cool white ground).
const LOOK = {
  exposure: 1.2,
  sky: 0xcfe6ff, ground: 0xe6ebf7, hemi: 1.3,
  sun: 0xffffff, sunIntensity: 2.6, shadowIntensity: 0.6,
  fill: 0xe6ecff, fillIntensity: 0.3,
  environment: 0.2,
}

// Sun: high, from the south-west → soft shadows fall north-east (screen right / slightly up).
const SUN_OFFSET = new THREE.Vector3(-150, 400, 230)
const SHADOW_MAP = 4096
const SHADOW_EXTENT = 130 // ± metres around the controls target at site zoom
const SHADOW_EXTENT_RANGE = [60, 420]

// Fog starts beyond a site view; it is pushed back when the camera pulls out (network overview).
const FOG_NEAR = 420
const FOG_FAR = 1100

const ARC_MAX_LIFT = 0.8 // distance multiplier peaks at 1 + 0.8 = 1.8 mid-flight

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * @param {HTMLElement} container full-size element that receives the canvas + label layer
 * @param {{ preserveDrawingBuffer?: boolean }} [opts]
 */
export function createScene(container, opts = {}) {
  const renderer = createRenderer(opts)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(C.sky)
  scene.fog = new THREE.Fog(C.sky, FOG_NEAR, FOG_FAR)

  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 6000)
  const labelRenderer = createLabelRenderer()

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
  container.append(renderer.domElement, labelRenderer.domElement)

  const controls = createControls(camera, renderer.domElement)
  const lights = addLights(scene, renderer)
  const { sun } = lights
  const flights = createFlights(camera, controls)

  controls.addEventListener('start', () => flights.cancel())

  applyView(camera, controls, DEFAULT_VIEW)
  observeSize(container, renderer, labelRenderer, camera)

  // ── frame loop ──────────────────────────────────────────────────────────────────────────────
  const callbacks = new Set()
  let running = false
  let last = 0
  let elapsed = 0
  let watchdog = 0

  function frame() {
    const now = performance.now()
    const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000))
    last = now
    elapsed += dt

    for (const cb of callbacks) cb(dt, elapsed)

    if (!flights.step(dt)) controls.update(dt)
    const distance = camera.position.distanceTo(controls.target)
    followShadow(sun, controls.target, distance)
    updateFog(scene.fog, distance)
    updateClipping(camera, distance)

    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
  }

  function start() {
    if (running) return
    running = true
    last = performance.now()
    renderer.setAnimationLoop(frame)
    // Hidden / background tabs pause requestAnimationFrame. Keep the world ticking slowly so the
    // live simulation, screenshots and headless previews stay current.
    watchdog = setInterval(() => {
      if (performance.now() - last > 400) frame()
    }, 250)
  }

  function stop() {
    running = false
    renderer.setAnimationLoop(null)
    clearInterval(watchdog)
  }

  return {
    renderer,
    scene,
    camera,
    controls,
    labelRenderer,
    dom: container,
    lights, // { hemi, sun, fill } — exposed for tuning / dev pages
    onFrame(cb) {
      callbacks.add(cb)
      return () => callbacks.delete(cb)
    },
    start,
    stop,
    /** Render one frame immediately (debug / dev pages). */
    renderNow: frame,
    flyTo: flights.flyTo,
    getView: () => readView(camera, controls),
    cancelFlight: flights.cancel,
    /** true while a flyTo() animation is running */
    get flying() { return flights.active },
  }
}

// ── construction helpers ─────────────────────────────────────────────────────────────────────

function createRenderer({ preserveDrawingBuffer = true }) {
  // preserveDrawingBuffer keeps the last frame readable for screenshots / thumbnails; the cost
  // is negligible for a single full-screen canvas.
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = LOOK.exposure
  renderer.shadowMap.enabled = true
  // r186 removed PCFSoftShadowMap: PCF + shadow.radius gives the soft Vogel-disk filter instead.
  renderer.shadowMap.type = THREE.PCFShadowMap
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none', outline: 'none' })
  return renderer
}

function createLabelRenderer() {
  const labelRenderer = new CSS2DRenderer()
  Object.assign(labelRenderer.domElement.style, {
    position: 'absolute', left: '0', top: '0', pointerEvents: 'none', overflow: 'hidden',
  })
  labelRenderer.domElement.className = 'wt-label-layer'
  return labelRenderer
}

function createControls(camera, dom) {
  const controls = new OrbitControls(camera, dom)
  controls.enableDamping = true
  controls.dampingFactor = 0.09
  controls.screenSpacePanning = false // left-drag pans on the ground plane like a map
  controls.zoomToCursor = true
  controls.zoomSpeed = 1.1
  controls.rotateSpeed = 0.55
  controls.minPolarAngle = POLAR_RANGE[0]
  controls.maxPolarAngle = POLAR_RANGE[1]
  controls.minDistance = DISTANCE_RANGE[0]
  controls.maxDistance = DISTANCE_RANGE[1]
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
  controls.cursorStyle = 'grab' // grab ↔ grabbing while dragging
  return controls
}

function addLights(scene, renderer) {
  const hemi = new THREE.HemisphereLight(LOOK.sky, LOOK.ground, LOOK.hemi)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(LOOK.sun, LOOK.sunIntensity)
  sun.position.copy(SUN_OFFSET)
  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.04
  sun.shadow.radius = 5
  sun.shadow.intensity = LOOK.shadowIntensity // pastel look: light, airy shadows
  const cam = sun.shadow.camera
  cam.near = 10
  cam.far = 1200
  setShadowExtent(sun, SHADOW_EXTENT)
  scene.add(sun, sun.target)

  // cool, shadowless fill from the opposite side lifts the shaded faces
  const fill = new THREE.DirectionalLight(LOOK.fill, LOOK.fillIntensity)
  fill.position.set(180, 160, -120)
  scene.add(fill)

  // soft image-based ambient + gentle sheen (no textures: a procedural room, prefiltered once)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  scene.environment = pmrem.fromScene(room, 0.04).texture
  scene.environmentIntensity = LOOK.environment
  room.dispose()
  pmrem.dispose()
  return { hemi, sun, fill }
}

function setShadowExtent(sun, extent) {
  const cam = sun.shadow.camera
  if (cam.right === extent) return
  cam.left = -extent
  cam.right = extent
  cam.top = extent
  cam.bottom = -extent
  cam.updateProjectionMatrix()
}

function observeSize(container, renderer, labelRenderer, camera) {
  const resize = () => {
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    labelRenderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  new ResizeObserver(resize).observe(container)
}

// ── per-frame helpers ────────────────────────────────────────────────────────────────────────

// orientation of the shadow camera (it looks from SUN_OFFSET toward its target, up = +Y)
const _sunQuat = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().lookAt(SUN_OFFSET, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)),
)
const _sunQuatInv = _sunQuat.clone().invert()
const _snap = new THREE.Vector3()

/** Keep the shadow frustum centred on the controls target, snapped to whole shadow texels (no shimmer). */
function followShadow(sun, target, distance) {
  const extent = THREE.MathUtils.clamp(Math.round((distance * 0.7) / 10) * 10, ...SHADOW_EXTENT_RANGE)
  setShadowExtent(sun, extent)

  const texel = (2 * extent) / SHADOW_MAP
  _snap.copy(target).applyQuaternion(_sunQuatInv)
  _snap.set(Math.round(_snap.x / texel) * texel, Math.round(_snap.y / texel) * texel, _snap.z)
  _snap.applyQuaternion(_sunQuat)

  sun.target.position.copy(_snap)
  sun.position.copy(_snap).add(SUN_OFFSET)
  sun.target.updateMatrixWorld()
}

function updateFog(fog, distance) {
  fog.near = Math.max(FOG_NEAR, distance * 1.25)
  fog.far = Math.max(FOG_FAR, distance * 2.9)
}

/** Scale near/far with zoom so ground decals keep depth precision from close-ups to the network view. */
function updateClipping(camera, distance) {
  const near = THREE.MathUtils.clamp(distance * 0.02, 0.5, 30)
  if (Math.abs(near - camera.near) / camera.near < 0.05) return
  camera.near = near
  camera.far = Math.max(2500, distance * 5)
  camera.updateProjectionMatrix()
}

// ── views & flights ──────────────────────────────────────────────────────────────────────────

const _offset = new THREE.Vector3()
const _sph = new THREE.Spherical()

function readView(camera, controls) {
  _sph.setFromVector3(_offset.copy(camera.position).sub(controls.target))
  return { target: controls.target.clone(), distance: _sph.radius, azimuth: _sph.theta, polar: _sph.phi }
}

function applyView(camera, controls, { target, distance, azimuth, polar }) {
  controls.target.set(target.x, target.y ?? 0, target.z)
  camera.position.copy(controls.target).add(_offset.setFromSphericalCoords(distance, polar, azimuth))
  camera.lookAt(controls.target)
}

const TAU = Math.PI * 2
const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU)

// CONTRACT-GAP: SPEC §3 quotes view angles in degrees ("azimuth ≈ 45°") but limits in radians.
// Views are radians; obviously-degree values (|azimuth| > 2π, polar > π) are converted defensively.
function toRadiansIfDegrees(v, limit) {
  return Math.abs(v) > limit + 1e-3 ? THREE.MathUtils.degToRad(v) : v
}

/** Copy of a layout view with angles guaranteed in radians. */
export function normalizeView(view) {
  if (!view) return null
  const { target, distance, azimuth, polar } = view
  return {
    target: { x: target.x, y: target.y ?? 0, z: target.z },
    distance,
    azimuth: azimuth == null ? azimuth : toRadiansIfDegrees(azimuth, TAU),
    polar: polar == null ? polar : toRadiansIfDegrees(polar, Math.PI),
  }
}

function createFlights(camera, controls) {
  let flight = null

  function cancel() {
    if (!flight) return
    const f = flight
    flight = null
    resetInertia(controls)
    f.resolve(false)
  }

  /**
   * Animate target + spherical camera offset with easeInOutCubic.
   * arc: true lifts the camera mid-flight (scaled by travel distance) for site-to-site flights.
   * track(out: Vector3) (optional extension): called every step to move the destination target,
   * so a flight to a moving truck lands on where it is now rather than where it was.
   * Resolves true when the flight lands, false when it is cancelled (user input / a newer flight).
   */
  function flyTo({ target, distance, azimuth, polar, duration = 1.2, arc = false, track = null } = {}) {
    cancel()
    const from = readView(camera, controls)
    const to = {
      target: target ? new THREE.Vector3(target.x, target.y ?? 0, target.z) : from.target.clone(),
      distance: THREE.MathUtils.clamp(distance ?? from.distance, ...DISTANCE_RANGE),
      azimuth: azimuth == null ? from.azimuth : toRadiansIfDegrees(azimuth, TAU),
      polar: THREE.MathUtils.clamp(polar == null ? from.polar : toRadiansIfDegrees(polar, Math.PI), ...POLAR_RANGE),
    }

    if (!(duration > 0)) {
      applyView(camera, controls, to)
      resetInertia(controls)
      return Promise.resolve(true)
    }
    const travel = from.target.distanceTo(to.target)
    const lift = arc ? THREE.MathUtils.clamp((travel - 40) / 260, 0, 1) * ARC_MAX_LIFT : 0
    return new Promise((resolve) => {
      flight = {
        from, to, duration, lift, track, resolve, t: 0,
        dAzimuth: wrapAngle(to.azimuth - from.azimuth),
        logD0: Math.log(from.distance),
        logD1: Math.log(to.distance),
      }
    })
  }

  const _target = new THREE.Vector3()

  /** Advance the active flight. Returns false when no flight is running. */
  function step(dt) {
    if (!flight) return false
    const f = flight
    f.t = Math.min(1, f.t + dt / f.duration)
    const e = easeInOutCubic(f.t)
    const bump = Math.sin(Math.PI * f.t) // rises early, descends late
    f.track?.(f.to.target)
    _target.lerpVectors(f.from.target, f.to.target, e)
    applyView(camera, controls, {
      target: _target,
      distance: Math.exp(THREE.MathUtils.lerp(f.logD0, f.logD1, e)) * (1 + f.lift * bump),
      azimuth: f.from.azimuth + f.dAzimuth * e,
      polar: THREE.MathUtils.lerp(f.from.polar, f.to.polar, e) - 0.12 * f.lift * bump,
    })
    if (f.t >= 1) {
      flight = null
      resetInertia(controls)
      f.resolve(true)
    }
    return true
  }

  return {
    flyTo, cancel, step,
    get active() { return !!flight },
  }
}

/** Drop OrbitControls' damping momentum so it doesn't drift after we moved the camera ourselves. */
function resetInertia(controls) {
  controls._sphericalDelta?.set(0, 0, 0)
  controls._panOffset?.set(0, 0, 0)
  if ('_scale' in controls) controls._scale = 1
}
