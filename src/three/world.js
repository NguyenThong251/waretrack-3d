// The 3D world: city environment + one building per site + one mesh per live entity (trucks,
// forklifts, pallets, chargers, dock pick volumes). Meshes follow the db entities every frame.
// Contract: docs/SPEC.md §5. createWorld only relies on app.scene / app.camera / app.renderer.
import * as THREE from 'three'
import { db } from '../data/db.js'
import {
  SITE_IDS, VEHICLE_SCALE, FORKLIFT_SCALE, PALLET_SCALE, CHARGER_SCALE, PIN_SCALE, BAY,
  siteLayout, allLayouts, refineSiteDocks, applyInitialPoses, networkView,
} from '../data/layout.js'
import { C } from './palette.js'
import { createEnvironment } from './environment.js'
import { createWarehouse } from './models/warehouse.js'
import { createTruck } from './models/truck.js'
import { createForklift } from './models/forklift.js'
import { createPallet } from './models/pallet.js'
import { createCharger, createMapPin, createGlowDisc } from './models/props.js'

// Flat pick slab over the bay: trucks / forklifts standing in the bay still win the raycast.
const DOCK_VOLUME = { width: BAY.w, height: 0.8 }
const MAX_WHEEL_STEP = 40                                     // metres; larger jumps are teleports
// A pallet riding on the forks keeps its world (toy) size: scale relative to the forklift and
// push it forward so the bigger load still clears the carriage.
const FORK_PALLET_SCALE = PALLET_SCALE / FORKLIFT_SCALE
const FORK_PALLET_Z = 0.5 * (FORK_PALLET_SCALE - 1)
const PALLET_LAYERS = { cardboard: 2, blue: 2, white: 1 }
const palletLayers = (kind) => PALLET_LAYERS[kind] ?? 2

export function createWorld(app) {
  const root = new THREE.Group()
  root.name = 'world'
  app.scene.add(root)

  const objects = { site: new Map(), dock: new Map(), truck: new Map(), forklift: new Map(), pallet: new Map(), charger: new Map() }
  const pickables = []
  const tag = (obj, type, id) => {
    obj.userData.ref = { type, id }
    objects[type].set(id, obj)
    pickables.push(obj)
    return obj
  }

  // ── buildings first: their real door anchors refine the dock poses ──────────────────────────
  const buildings = new THREE.Group()
  buildings.name = 'buildings'
  root.add(buildings)
  for (const siteId of SITE_IDS) {
    const L = siteLayout(siteId)
    const b = createWarehouse({ ...L.building })
    b.position.set(L.centre.x, 0, L.centre.z)
    b.rotation.y = L.rotY
    b.updateMatrixWorld(true)
    refineSiteDocks(siteId, worldAnchors(b))
    buildings.add(b)
    tag(b, 'site', siteId)
  }

  const layouts = allLayouts()
  const env = createEnvironment(layouts)
  root.add(env.root)
  applyInitialPoses(db)

  // ── entities ────────────────────────────────────────────────────────────────────────────────
  const entities = new THREE.Group()
  entities.name = 'entities'
  root.add(entities)
  const pallets = new THREE.Group()
  pallets.name = 'pallets'
  entities.add(pallets)
  const pins = new THREE.Group()
  pins.name = 'pins'
  entities.add(pins)

  for (const t of db.list('truck')) {
    const obj = createTruck({ carrier: t.carrier, reefer: !!t.reefer })
    obj.scale.setScalar(VEHICLE_SCALE)
    entities.add(tag(obj, 'truck', t.id))
  }

  for (const f of db.list('forklift')) {
    const obj = createForklift()
    obj.scale.setScalar(FORKLIFT_SCALE)
    obj.userData.generic = new Map()   // carryingKind → pallet shown on the forks
    entities.add(tag(obj, 'forklift', f.id))
  }

  const pinOf = new Map()
  db.list('pallet').forEach((p, i) => {
    const kind = db.sku(p.sku)?.kind ?? 'cardboard'
    const obj = createPallet({ kind, layers: palletLayers(kind), seed: i * 3 + 1 })
    obj.scale.setScalar(PALLET_SCALE)
    pallets.add(tag(obj, 'pallet', p.id))
    const pin = createMapPin({ color: C.blue, scale: PIN_SCALE })
    pin.userData.phase = i * 1.7
    pin.visible = false
    pins.add(pin)
    pinOf.set(p.id, pin)
  })

  const glows = new Map()
  for (const c of db.list('charger')) {
    const L = siteLayout(c.siteId)
    const cab = L.cabinets[c.id]
    const obj = createCharger()
    obj.scale.setScalar(CHARGER_SCALE)
    obj.position.set(cab.x, cab.y ?? 0, cab.z)
    obj.rotation.y = cab.heading
    entities.add(tag(obj, 'charger', c.id))
    const spot = L.chargers[c.id]
    const glow = createGlowDisc(1.9 * FORKLIFT_SCALE, C.chargerGlow, 0)
    glow.position.set(spot.x, (spot.y ?? 0) + 0.05, spot.z)
    glow.visible = false
    entities.add(glow)
    glows.set(c.id, glow)
  }

  // dock = flat pick slab from the door to the far end of the painted bay (frame 07 brackets)
  const volumeMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  for (const d of db.list('dock')) {
    const L = siteLayout(d.siteId)
    const a = L.dockAnchors[d.id], n = L.dockNormals[d.id], dock = L.docks[d.id]
    if (!a) continue
    const near = -0.6                                            // the door itself
    const far = Math.hypot(dock.x - a.x, dock.z - a.z) + BAY.l / 2 // outer end of the bay
    const vol = new THREE.Mesh(new THREE.BoxGeometry(DOCK_VOLUME.width, DOCK_VOLUME.height, far - near), volumeMat)
    vol.visible = false   // never drawn; raycasts and Box3.setFromObject still see it
    const mid = (near + far) / 2
    vol.position.set(a.x + n.x * mid, (dock.y ?? 0) + DOCK_VOLUME.height / 2, a.z + n.z * mid)
    vol.rotation.y = dock.heading
    vol.name = `dock-${d.id}`
    entities.add(tag(vol, 'dock', d.id))
  }

  // ── per-frame sync ──────────────────────────────────────────────────────────────────────────
  const last = new Map()   // entity id → last synced {x, z}

  function syncVehicle(obj, e) {
    const prev = last.get(e.id)
    const x = e.position.x, z = e.position.z
    if (prev) {
      const dx = x - prev.x, dz = z - prev.z
      const moved = dx * Math.sin(e.heading) + dz * Math.cos(e.heading)   // signed: reversing spins back
      if (Math.abs(moved) > 1e-5 && Math.hypot(dx, dz) < MAX_WHEEL_STEP) {
        for (const w of obj.userData.wheels ?? []) w.rotation.x += moved / ((w.userData.radius ?? 0.45) * obj.scale.x)
      }
      prev.x = x
      prev.z = z
    } else last.set(e.id, { x, z })
    obj.position.set(x, e.position.y ?? 0, z)
    obj.rotation.y = e.heading ?? 0
  }

  function syncForklift(obj, f) {
    syncVehicle(obj, f)
    const h = f.forkHeight ?? 0.15
    if (obj.userData.forkHeight !== h) obj.userData.setForkHeight?.(h)
    // generic load on the forks (no real pallet entity)
    const kind = !f.carryingPalletId && f.carryingKind ? f.carryingKind : null
    for (const [k, p] of obj.userData.generic) p.visible = k === kind
    if (kind && !obj.userData.generic.has(kind)) {
      const p = createPallet({ kind, layers: palletLayers(kind), seed: obj.id % 6 })
      p.scale.setScalar(FORK_PALLET_SCALE)
      p.position.z = FORK_PALLET_Z
      obj.userData.forkAnchor.add(p)
      obj.userData.generic.set(kind, p)
    }
  }

  const _p = new THREE.Vector3()
  function syncPallet(obj, p, carrierId) {
    const show = p.status !== 'loaded'
    if (obj.visible !== show) {
      obj.visible = show
      const i = pickables.indexOf(obj)
      if (!show && i >= 0) pickables.splice(i, 1)
      else if (show && i < 0) pickables.push(obj)
    }
    const carrier = carrierId && objects.forklift.get(carrierId)
    if (carrier) {
      const anchor = carrier.userData.forkAnchor
      if (obj.parent !== anchor) {
        anchor.add(obj)   // the forklift's scale applies on top
        obj.position.set(0, 0, FORK_PALLET_Z)
        obj.rotation.set(0, 0, 0)
        obj.scale.setScalar(FORK_PALLET_SCALE)
      }
    } else {
      if (obj.parent !== pallets) {
        pallets.add(obj)
        obj.scale.setScalar(PALLET_SCALE)
      }
      obj.position.set(p.position.x, p.position.y ?? 0, p.position.z)
      obj.rotation.set(0, p.heading ?? 0, 0)
    }
  }

  function syncPin(pin, palletObj, p, elapsed) {
    pin.visible = !!p.pinned && palletObj.visible
    if (!pin.visible) return
    palletObj.getWorldPosition(_p)
    pin.position.set(_p.x, _p.y + (palletObj.userData.height ?? 1) * PALLET_SCALE + 0.3, _p.z)
    const head = pin.userData.head
    if (head) head.position.y = 0.18 + Math.sin(elapsed * 2.4 + pin.userData.phase) * 0.16
  }

  function update(dt = 0, elapsed = 0) {
    for (const t of db.list('truck')) syncVehicle(objects.truck.get(t.id), t)

    const carried = new Map()
    for (const f of db.list('forklift')) {
      syncForklift(objects.forklift.get(f.id), f)
      if (f.carryingPalletId) carried.set(f.carryingPalletId, f.id)
    }
    root.updateMatrixWorld()   // fork anchors must be current before pins read world positions

    for (const p of db.list('pallet')) {
      const obj = objects.pallet.get(p.id)
      syncPallet(obj, p, p.carriedBy ?? carried.get(p.id))
      syncPin(pinOf.get(p.id), obj, p, elapsed)
    }

    for (const c of db.list('charger')) {
      const glow = glows.get(c.id)
      const fl = c.forkliftId ? db.get('forklift', c.forkliftId) : null
      const charging = c.status === 'charging' || (fl?.status === 'charging' && fl.chargerId === c.id)
      glow.visible = charging
      const led = objects.charger.get(c.id).userData.led
      if (charging) {
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3.2 + c.id.length)
        glow.material.opacity = 0.28 + 0.3 * pulse
        if (led) led.material.emissiveIntensity = 0.9 + 1.2 * pulse
      } else if (led) led.material.emissiveIntensity = 1.4
    }

    env.update(dt, elapsed)
  }

  // ── queries ─────────────────────────────────────────────────────────────────────────────────
  const getObject = (type, id) => objects[type]?.get(id) ?? null

  function getEntityPosition(type, id, out = new THREE.Vector3()) {
    const obj = getObject(type, id)
    if (!obj) return out.set(0, 0, 0)
    if (type === 'site') {
      const L = siteLayout(id)
      return out.set(L.centre.x, 0, L.centre.z)
    }
    obj.getWorldPosition(out)
    if (type === 'dock') out.y = 0
    return out
  }

  function getEntityBox(type, id, out = new THREE.Box3()) {
    const obj = getObject(type, id)
    if (!obj) return out.makeEmpty()
    if (type === 'site' && obj.userData.extents) {
      obj.updateWorldMatrix(true, false)
      return out.copy(obj.userData.extents).applyMatrix4(obj.matrixWorld)
    }
    obj.updateWorldMatrix(true, true)
    return out.setFromObject(obj)
  }

  const getSiteView = (siteId) => {
    const v = siteLayout(siteId).view
    return { target: { ...v.target }, distance: v.distance, azimuth: v.azimuth, polar: v.polar }
  }
  const getNetworkView = () => networkView()

  update(0, 0)

  return { root, pickables, getObject, getEntityPosition, getEntityBox, getSiteView, getNetworkView, update }
}

/** Door anchors of a placed building in world space ({ position:{x,z}, normal:{x,z} }). */
function worldAnchors(building) {
  const out = {}
  const p = new THREE.Vector3(), n = new THREE.Vector3()
  for (const [id, a] of Object.entries(building.userData.doorAnchors ?? {})) {
    p.copy(a.position).applyMatrix4(building.matrixWorld)
    n.copy(a.normal).transformDirection(building.matrixWorld)
    out[id] = { position: { x: p.x, z: p.z }, normal: { x: n.x, z: n.z } }
  }
  return out
}
