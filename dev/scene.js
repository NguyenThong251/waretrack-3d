// Dev harness for scene.js + cameraDirector.js + interaction.js on a FAKE world that implements the
// SPEC §5 world API (pickables with refs to real db entities, getObject / getEntityPosition /
// getEntityBox / getSiteView / getNetworkView / update). Real models are used when their modules
// load, simple boxes otherwise.
import * as THREE from 'three'
import { createScene } from '../src/three/scene.js'
import { createCameraDirector } from '../src/three/cameraDirector.js'
import { createInteraction } from '../src/three/interaction.js'
import { C, mat, shadows } from '../src/three/palette.js'
import { db } from '../src/data/db.js'
import { SITES } from '../src/data/mockData.js'
import { store, bus } from '../src/state/store.js'

// Other modules are edited concurrently: ignore Vite full reloads so a scenario stays on screen
// (throwing from this hook aborts the reload; ?live restores normal reloads). The rejection is
// swallowed below so it doesn't show up as a console error.
const RELOAD_BLOCKED = '[dev/scene] ignored full reload'
import.meta.hot?.on('vite:beforeFullReload', (payload) => {
  if (new URLSearchParams(location.search).has('live')) return
  throw new Error(`${RELOAD_BLOCKED} from ${payload?.triggeredBy ?? payload?.path ?? 'vite'}`)
})
window.addEventListener('unhandledrejection', (e) => {
  if (String(e.reason?.message).startsWith(RELOAD_BLOCKED)) e.preventDefault()
})

let models = {}
let app = null
let world = null

async function main() {
  const params = new URLSearchParams(location.search)
  models = await loadModels()
  app = createScene(document.getElementById('viewport'))
  // ?real → the real world module (src/three/world.js) when it loads; the fake world otherwise
  world = (params.has('real') && (await loadRealWorld(app))) || createFakeWorld(app)
  const director = createCameraDirector(app, world)
  const interaction = createInteraction(app, world)

  app.onFrame((dt, elapsed) => {
    world.update(dt, elapsed)
    interaction.update(dt, elapsed)
    director.update(dt, elapsed)
    showStatus()
  })
  app.start()
  app.renderNow()

  buildToolbar()
  window.__dev = { THREE, app, world, director, interaction, store, bus, db, benchPicking }
  runScenario(params)
}

/**
 * URL-driven scenarios for headless screenshots, e.g.
 *   ?boxes&site=WH-04&select=truck:TRK-2307&truck=7&hover=forklift:FL-10&view=120,330,70,45,0.9
 *   (clean → hide the toolbar / placeholders)
 * view = targetX,targetZ,distance,azimuthDeg,polar (applied after the director's flights).
 */
function runScenario(params) {
  const ref = (s) => {
    const [type, id] = (s ?? '').split(':')
    return type && id ? { type, id } : null
  }
  if (params.has('clean')) document.getElementById('ui').style.display = 'none'
  tuneLook(params)
  if (params.has('truck')) {
    if (world.sim) world.sim.paused = true
    world.advanceTruck?.(Number(params.get('truck')) || 0)
  }
  if (params.get('route')) {
    world.routeTruck?.(params.get('route'), Number(params.get('routeLeft')) || 60)
    world.update(0, 0) // sync meshes before the director measures positions
  }
  if (params.get('site')) store.setSite(params.get('site'))
  if (params.get('select')) store.select(ref(params.get('select')))
  if (params.get('follow')) store.set({ followId: params.get('follow') })
  if (params.get('cmd')) for (const c of params.get('cmd').split(',')) bus.emit('camera:cmd', { cmd: c })
  if (params.get('locate')) bus.emit('camera:locate', ref(params.get('locate')))
  if (params.get('view')) {
    const [x, z, distance, az, polar] = params.get('view').split(',').map(Number)
    app.flyTo({ target: { x, y: 0, z }, distance, azimuth: THREE.MathUtils.degToRad(az), polar, duration: 0 })
  }
  if (params.get('hover')) store.set({ hover: ref(params.get('hover')) })
  if (params.has('bench')) setTimeout(benchPicking, 1500)
}

/** ?bench → time raycasts over the whole viewport and print draw stats into #status / console. */
function benchPicking() {
  const raycaster = new THREE.Raycaster()
  const t0 = performance.now()
  let hits = 0
  for (let i = 0; i < 200; i++) {
    raycaster.setFromCamera({ x: (i % 20) / 10 - 0.95, y: Math.floor(i / 20) / 5 - 0.95 }, app.camera)
    hits += raycaster.intersectObjects(world.pickables, true).length ? 1 : 0
  }
  const ms = (performance.now() - t0) / 200
  const { calls, triangles } = app.renderer.info.render
  const msg = `[bench] pick ${ms.toFixed(2)} ms/ray (${hits}/200 hit, ${world.pickables.length} pickables) · ${calls} draw calls · ${triangles} tris`
  console.info(msg)
  document.title = msg
}

// ── models ───────────────────────────────────────────────────────────────────────────────────

async function loadModels() {
  // ?boxes → skip the real model modules (they are edited concurrently and trigger page reloads)
  if (new URLSearchParams(location.search).has('boxes')) return {}
  const tryImport = (path) =>
    import(/* @vite-ignore */ path).catch((err) => {
      console.info(`[dev/scene] using placeholder for ${path}: ${err.message}`)
      return null
    })
  const [truck, forklift, pallet, props] = await Promise.all([
    tryImport('/src/three/models/truck.js'),
    tryImport('/src/three/models/forklift.js'),
    tryImport('/src/three/models/pallet.js'),
    tryImport('/src/three/models/props.js'),
  ])
  return { truck, forklift, pallet, props }
}

/** Lighting experiments: &exp=1.2&tm=agx&hemi=2&sun=2&fill=0.4&sunColor=ffffff&env=0.5 */
function tuneLook(params) {
  const { renderer, lights, scene } = app
  const num = (k) => (params.has(k) ? Number(params.get(k)) : null)
  if (num('exp') != null) renderer.toneMappingExposure = num('exp')
  const tm = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping }[params.get('tm')]
  if (tm) renderer.toneMapping = tm
  if (num('hemi') != null) lights.hemi.intensity = num('hemi')
  if (num('sun') != null) lights.sun.intensity = num('sun')
  if (num('fill') != null) lights.fill.intensity = num('fill')
  if (params.get('sunColor')) lights.sun.color.set(`#${params.get('sunColor')}`)
  if (params.get('sky')) lights.hemi.color.set(`#${params.get('sky')}`)
  if (params.get('gnd')) lights.hemi.groundColor.set(`#${params.get('gnd')}`)
  if (num('shadow') != null) lights.sun.shadow.intensity = num('shadow')
  if (num('env') != null) scene.environmentIntensity = num('env')
}

async function loadRealWorld(app) {
  try {
    const [{ createWorld }, layout] = await Promise.all([
      import(/* @vite-ignore */ '/src/three/world.js'),
      import(/* @vite-ignore */ '/src/data/layout.js'),
    ])
    const world = createWorld(app)
    world.routeTruck = (truckId, metresLeft) => routeTruck(layout, truckId, metresLeft)
    return world
  } catch (err) {
    console.info('[dev/scene] real world unavailable, using the fake one:', err.message)
    return null
  }
}

/** Put a truck `metresLeft` before its dock on arrival → approach → reverse, with path + target. */
function routeTruck(layout, truckId, metresLeft) {
  const t = db.get('truck', truckId)
  const L = layout.siteLayout(t.siteId)
  const dock = L.docks[t.dockId]
  const full = [...L.arrivalRoute, ...L.dockApproach[t.dockId].slice(1), dock]
  const lengths = full.slice(1).map((p, i) => Math.hypot(p.x - full[i].x, p.z - full[i].z))
  let s = Math.max(0, lengths.reduce((a, b) => a + b, 0) - metresLeft)
  let i = 0
  while (i < lengths.length - 1 && s > lengths[i]) s -= lengths[i++]
  const a = full[i]
  const b = full[i + 1]
  const k = Math.min(1, s / (lengths[i] || 1))
  const reversing = i === lengths.length - 1
  const h = Math.atan2(b.x - a.x, b.z - a.z)
  Object.assign(t.position, { x: a.x + (b.x - a.x) * k, y: 0, z: a.z + (b.z - a.z) * k })
  t.heading = reversing ? h + Math.PI : h
  t.path = full.slice(i + 1).map((p) => ({ x: p.x, z: p.z }))
  t.target = { x: dock.x, z: dock.z, heading: dock.heading }
  t.status = reversing ? 'docking' : 'en_route'
}

function boxModel(w, h, d, color) {
  const g = new THREE.Group()
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
  m.position.y = h / 2
  g.add(m)
  return shadows(g)
}

function safely(make, fallback) {
  try {
    return make() ?? fallback()
  } catch (err) {
    console.info('[dev/scene] model factory failed, using placeholder:', err.message)
    return fallback()
  }
}

const makeTruck = (carrier, reefer = false) =>
  safely(() => models.truck?.createTruck({ carrier, reefer }), () => boxModel(2.5, 3.9, 10.5, C.white))
const makeForklift = () => safely(() => models.forklift?.createForklift(), () => boxModel(1.15, 2.25, 3.4, C.forkYellow))
const makePallet = (kind, seed) => safely(() => models.pallet?.createPallet({ kind, seed }), () => boxModel(1.2, 1.4, 1.0, C.cardboard))
const makeCharger = () => safely(() => models.props?.createCharger(), () => boxModel(0.7, 1.6, 0.5, C.charger))
const makeTree = (seed) => safely(() => models.props?.createTree({ seed }), () => boxModel(2, 4.5, 2, C.tree))

// ── fake world ───────────────────────────────────────────────────────────────────────────────

function siteOrigin(id) {
  return SITES.find((s) => s.id === id)?.world ?? { x: 0, z: 0 }
}

function createFakeWorld(app) {
  const root = new THREE.Group()
  root.name = 'fake-world'
  app.scene.add(root)
  const pickables = []
  const objects = new Map()
  const key = (type, id) => `${type}:${id}`

  function register(type, id, obj, { x, z, heading = 0, y = 0 }) {
    if (!db.get(type, id)) console.warn(`[dev/scene] unknown entity ${type} ${id}`)
    obj.userData.ref = { type, id }
    obj.position.set(x, y, z)
    obj.rotation.y = heading
    objects.set(key(type, id), obj)
    pickables.push(obj)
    root.add(obj)
    const e = db.get(type, id)
    if (e?.position) {
      Object.assign(e.position, { x, y: 0, z })
      e.heading = heading
    }
    return obj
  }

  buildGround(root)

  // WH-01 Riverside Hub (blue depot) ──────────────────────────────
  const o1 = siteOrigin('WH-01')
  register('site', 'WH-01', depotBuilding(), { x: o1.x, z: o1.z - 16 })
  for (const [i, dx] of [[1, -6], [2, 6]]) {
    register('dock', `WH-01-B${i}`, dockVolume(), { x: o1.x + dx, z: o1.z + 8.6 })
    addParkingBay(root, o1.x + dx, o1.z + 8.6, 4.5, 16)
  }
  register('truck', 'TRK-2051', makeTruck('waretrack'), { x: o1.x - 6, z: o1.z + 6.45 })
  register('forklift', 'FL-01', makeForklift(), { x: o1.x - 30, z: o1.z + 12, heading: 0.6 })
  register('forklift', 'FL-02', makeForklift(), { x: o1.x - 37, z: o1.z + 4, heading: 0.2 })
  register('pallet', 'PAL-1026', makePallet('cardboard', 1), { x: o1.x - 20, z: o1.z + 22, heading: 0.1 })
  register('pallet', 'PAL-1027', makePallet('cardboard', 2), { x: o1.x - 16.5, z: o1.z + 22, heading: 0.1 })
  register('pallet', 'PAL-1031', makePallet('blue', 3), { x: o1.x + 18, z: o1.z + 20 })
  register('charger', 'WH-01-C1', makeCharger(), { x: o1.x - 42, z: o1.z - 6 })

  // WH-04 Southfield Cross-Dock (white walls, blue roof) ────────────
  const o4 = siteOrigin('WH-04')
  register('site', 'WH-04', crossdockBuilding(), { x: o4.x, z: o4.z - 20 })
  const doors = { IN1: -20, IN2: -8, IN3: 4 }
  for (const [code, dx] of Object.entries(doors)) {
    register('dock', `WH-04-${code}`, dockVolume(), { x: o4.x + dx, z: o4.z + 8.6 })
    addParkingBay(root, o4.x + dx, o4.z + 8.6, 4.5, 16)
  }
  register('truck', 'TRK-2205', makeTruck('waretrack'), { x: o4.x - 20, z: o4.z + 6.45 })
  register('forklift', 'FL-10', makeForklift(), { x: o4.x - 16, z: o4.z + 15, heading: Math.PI })
  register('charger', 'WH-04-C1', makeCharger(), { x: o4.x + 30, z: o4.z + 4 })
  register('charger', 'WH-04-C2', makeCharger(), { x: o4.x + 32, z: o4.z + 4 })

  // TRK-2307 docking into In 3 along a scripted route ────────────────
  const truck2307 = db.get('truck', 'TRK-2307')
  const dockPose = { x: o4.x + 4, z: o4.z + 6.45, heading: 0 }
  const route = [
    { x: o4.x + 70, z: o4.z + 45 },
    { x: o4.x + 40, z: o4.z + 45 },
    { x: o4.x + 40, z: o4.z + 28 },
    { x: o4.x + 16, z: o4.z + 28 },
    dockPose,
  ]
  const truckObj = register('truck', 'TRK-2307', makeTruck('nordline'), { x: o4.x + 95, z: o4.z + 45, heading: -Math.PI / 2 })
  const sim = { paused: false, wait: 0 }

  function resetTruck() {
    Object.assign(truck2307.position, { x: o4.x + 95, y: 0, z: o4.z + 45 })
    truck2307.heading = -Math.PI / 2
    truck2307.path = route.map((p) => ({ x: p.x, z: p.z }))
    truck2307.target = { ...dockPose }
    truck2307.status = 'docking'
  }
  resetTruck()

  const _dir = new THREE.Vector2()
  function driveTruck(dt) {
    const t = truck2307
    if (!t.path?.length) {
      sim.wait += dt
      if (sim.wait > 3) {
        sim.wait = 0
        resetTruck()
      }
      return
    }
    const reversing = t.path.length === 1
    const speed = reversing ? 2.5 : 9
    const next = t.path[0]
    _dir.set(next.x - t.position.x, next.z - t.position.z)
    const dist = _dir.length()
    const step = speed * dt
    if (dist <= step) {
      t.position.x = next.x
      t.position.z = next.z
      t.path.shift()
      if (!t.path.length) {
        t.heading = dockPose.heading
        t.status = 'unloading'
        t.path = null
      }
      return
    }
    _dir.divideScalar(dist)
    t.position.x += _dir.x * step
    t.position.z += _dir.y * step
    const h = Math.atan2(_dir.x, _dir.y)
    t.heading = reversing ? h + Math.PI : h
  }

  // trees + fence for context
  for (let i = 0; i < 9; i++) {
    const tree = makeTree(i)
    tree.position.set(o1.x - 60 + i * 14, 0, o1.z + 46)
    root.add(tree)
    const tree4 = makeTree(i + 20)
    tree4.position.set(o4.x - 50 + i * 13, 0, o4.z + 56)
    root.add(tree4)
  }

  function syncTruck() {
    truckObj.position.set(truck2307.position.x, 0, truck2307.position.z)
    truckObj.rotation.y = truck2307.heading
  }

  const _box = new THREE.Box3()
  return {
    root,
    pickables,
    sim,
    resetTruck,
    advanceTruck(seconds) {
      for (let t = 0; t < seconds; t += 0.05) driveTruck(0.05)
      syncTruck()
    },
    getObject: (type, id) => objects.get(key(type, id)),
    getEntityPosition(type, id, out = new THREE.Vector3()) {
      const o = objects.get(key(type, id))
      return o ? o.getWorldPosition(out).setY(0) : null
    },
    getEntityBox(type, id, out = new THREE.Box3()) {
      const o = objects.get(key(type, id))
      return o ? out.copy(_box.setFromObject(o)) : out.makeEmpty()
    },
    getSiteView(id) {
      const o = siteOrigin(id)
      return { target: { x: o.x - 4, y: 0, z: o.z + 4 }, distance: 165, azimuth: Math.PI / 4, polar: 0.87 }
    },
    getNetworkView() {
      const c = SITES.reduce((a, s) => ({ x: a.x + s.world.x / SITES.length, z: a.z + s.world.z / SITES.length }), { x: 0, z: 0 })
      return { target: { x: c.x, y: 0, z: c.z }, distance: 1050, azimuth: Math.PI / 4, polar: 0.8 }
    },
    update(dt) {
      if (!sim.paused) driveTruck(dt)
      syncTruck()
    },
  }
}

function buildGround(root) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), mat(C.ground))
  ground.receiveShadow = true
  root.add(ground)
  for (const s of SITES) {
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(170, 120).rotateX(-Math.PI / 2), mat(C.lot))
    lot.position.set(s.world.x, 0.01, s.world.z)
    lot.receiveShadow = true
    root.add(lot)
    const road = new THREE.Mesh(new THREE.PlaneGeometry(900, 14).rotateX(-Math.PI / 2), mat(C.road))
    road.position.set(s.world.x, 0.02, s.world.z + 45)
    road.receiveShadow = true
    root.add(road)
    const dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(4, 0.3).rotateX(-Math.PI / 2), mat(C.roadLine), 90)
    const m = new THREE.Matrix4()
    for (let i = 0; i < 90; i++) dashes.setMatrixAt(i, m.makeTranslation(s.world.x - 450 + i * 10, 0.03, s.world.z + 45))
    root.add(dashes)
  }
}

function addParkingBay(root, x, z, w, l) {
  const bay = safely(() => models.props?.createParkingBay(w, l), () => null)
  if (!bay) return
  bay.position.set(x, 0, z)
  root.add(bay)
}

function dockVolume() {
  // invisible pick volume covering the bay in front of the door (SPEC §5)
  const m = new THREE.Mesh(new THREE.BoxGeometry(4.5, 4.5, 16).translate(0, 2.25, 0), new THREE.MeshBasicMaterial())
  m.visible = false
  return m
}

function depotBuilding() {
  const g = new THREE.Group()
  const hall = new THREE.Mesh(new THREE.BoxGeometry(46, 9, 30), mat(C.blue))
  hall.position.y = 4.5
  const roof = new THREE.Mesh(new THREE.BoxGeometry(46.6, 1.2, 30.6), mat(C.blueMid))
  roof.position.y = 9.6
  const front = new THREE.Mesh(new THREE.BoxGeometry(40, 5, 0.4), mat(C.wall))
  front.position.set(0, 2.5, 15.1)
  g.add(hall, roof, front)
  return shadows(g)
}

function crossdockBuilding() {
  const g = new THREE.Group()
  const walls = new THREE.Mesh(new THREE.BoxGeometry(70, 8, 40), mat(C.wall))
  walls.position.y = 4
  g.add(walls)
  for (let i = 0; i < 6; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(70, 3, 6.6), mat(C.blue))
    tooth.position.set(0, 9.2, -17 + i * 6.8)
    tooth.rotation.x = -0.35
    g.add(tooth)
  }
  return shadows(g)
}

// ── toolbar + status ─────────────────────────────────────────────────────────────────────────

function buildToolbar() {
  const bar = document.getElementById('tools')
  const group = (title, items) => {
    const b = document.createElement('b')
    b.textContent = title
    bar.append(b)
    for (const [label, fn] of items) {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.addEventListener('click', fn)
      bar.append(btn)
    }
  }
  const sel = (type, id) => () => store.select({ type, id })
  const cmd = (c) => () => bus.emit('camera:cmd', { cmd: c })
  group('Site', [
    ['WH-01', () => store.setSite('WH-01')],
    ['WH-02', () => store.setSite('WH-02')],
    ['WH-04', () => store.setSite('WH-04')],
    ['ALL', () => store.setSite('ALL')],
  ])
  group('Select', [
    ['FL-01', sel('forklift', 'FL-01')],
    ['PAL-1026', sel('pallet', 'PAL-1026')],
    ['TRK-2051', sel('truck', 'TRK-2051')],
    ['TRK-2307', sel('truck', 'TRK-2307')],
    ['In 2', sel('dock', 'WH-04-IN2')],
    ['C1', sel('charger', 'WH-04-C1')],
    ['WH-04', sel('site', 'WH-04')],
    ['none', () => store.select(null)],
  ])
  group('Hover', [
    ['FL-02', () => store.set({ hover: { type: 'forklift', id: 'FL-02' } })],
    ['TRK-2205', () => store.set({ hover: { type: 'truck', id: 'TRK-2205' } })],
  ])
  group('Camera', [
    ['+', cmd('zoomIn')],
    ['−', cmd('zoomOut')],
    ['⟲', cmd('rotateLeft')],
    ['⟳', cmd('rotateRight')],
    ['⌂', cmd('home')],
    ['locate', () => store.state.selection && bus.emit('camera:locate', store.state.selection)],
    ['follow', () => {
      const s = store.state.selection
      if (s && (s.type === 'truck' || s.type === 'forklift')) store.set({ followId: store.state.followId ? null : s.id })
    }],
  ])
  group('Truck', [
    ['pause', () => { if (world.sim) world.sim.paused = !world.sim.paused }],
    ['restart', () => world.resetTruck?.()],
  ])
}

const statusEl = document.getElementById('status')
let statusText = ''
function showStatus() {
  const { siteId, selection, hover, followId } = store.state
  const v = app.getView()
  const r = (n) => n.toFixed(1)
  const text = [
    `site ${siteId}   sel ${selection ? `${selection.type}:${selection.id}` : '—'}   hover ${hover ? `${hover.type}:${hover.id}` : '—'}   follow ${followId ?? '—'}`,
    `view target ${r(v.target.x)}, ${r(v.target.z)}   dist ${r(v.distance)}   az ${r(THREE.MathUtils.radToDeg(v.azimuth))}°   polar ${v.polar.toFixed(2)}${app.flying ? '   ✈' : ''}`,
  ].join('\n')
  if (text !== statusText) statusEl.textContent = statusText = text
}

main()
