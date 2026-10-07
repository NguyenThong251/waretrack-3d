// Camera director: turns store / bus events into camera moves (SPEC §6).
//  - site change      → arc flight across the city to the site (or network) view
//  - selection change → bring the entity into view (no move when it is already comfortably visible,
//                       as in the video; a short pan when it sits at the screen edge; a focus flight
//                       when it is off-screen or the camera is far away)
//  - camera:locate    → fly close to the entity
//  - camera:cmd       → zoom / rotate / home from the map controls
//  - followId         → keep the followed truck / forklift centred every frame
import * as THREE from 'three'
import { store, bus } from '../state/store.js'
import { db } from '../data/db.js'
import { normalizeView } from './scene.js'

const SITE_FLIGHT = 1.8
const FOCUS_FLIGHT = 1.0
const NUDGE_FLIGHT = 0.7
const CMD_FLIGHT = 0.45

const SELECT_DISTANCE = [45, 110]
const LOCATE = { distance: 40, polar: 0.9 }
const ZOOM_STEP = { zoomIn: 0.75, zoomOut: 1.33 }
const ROTATE_STEP = Math.PI / 6
const FOLLOW_RATE = 4.5 // 1/s, exponential catch-up

// Screen-space layout (fractions of the viewport) of the area not covered by the UI cards:
// KPIs on top, detail panel at the top-right, tracker + fleet panel at the bottom.
// CONTRACT-GAP: the director does not know the real UI rects; these mirror SPEC §2.
const FOCUS = { x: 0.42, y: 0.48 } // where a focused entity lands
const SAFE = { left: 0.05, right: 0.7, top: 0.2, bottom: 0.78 } // "comfortably visible" region
const NUDGE_MARGIN = 0.12 // a nudge brings the entity this far inside the safe region
const NEAR_ENOUGH = 300 // farther than this, a selection always zooms in

const FOLLOWABLE = ['truck', 'forklift']

export function createCameraDirector(app, world) {
  const { camera, controls } = app
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const raycaster = new THREE.Raycaster()
  const probe = camera.clone()
  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()
  const trackPos = new THREE.Vector3()
  let goal = null // destination of the flight this director started (so repeated +/− clicks add up)

  // ── views ────────────────────────────────────────────────────────────────────────────────────

  function siteView(siteId) {
    return normalizeView(siteId === 'ALL' ? world.getNetworkView?.() : world.getSiteView?.(siteId))
  }

  function currentView() {
    return goal ?? app.getView()
  }

  function entityPosition(ref, out = tmp) {
    if (!ref || !db.get(ref.type, ref.id) || !world.getObject?.(ref.type, ref.id)) return null
    return world.getEntityPosition?.(ref.type, ref.id, out) ?? null
  }

  /**
   * Ground point seen at screen fraction (fx, fy) relative to the orbit target, for a camera with
   * the given spherical offset. Translation-invariant, so target = entity − this puts the entity there.
   */
  function screenOffset(fx, fy, { distance, azimuth, polar }, out) {
    probe.copy(camera)
    probe.position.setFromSphericalCoords(distance, polar, azimuth)
    probe.lookAt(0, 0, 0)
    probe.updateMatrixWorld()
    raycaster.setFromCamera({ x: fx * 2 - 1, y: 1 - fy * 2 }, probe)
    ground.constant = 0
    return raycaster.ray.intersectPlane(ground, out) ?? out.set(0, 0, 0)
  }

  /** View that keeps the current angles and puts the entity at the FOCUS point. */
  function focusView(ref, { distance, polar } = {}) {
    const pos = entityPosition(ref)
    if (!pos) return null
    const cur = currentView()
    const view = {
      distance: distance ?? THREE.MathUtils.clamp(cur.distance, ...SELECT_DISTANCE),
      azimuth: cur.azimuth,
      polar: polar ?? cur.polar,
    }
    const off = screenOffset(FOCUS.x, FOCUS.y, view, new THREE.Vector3())
    view.target = { x: pos.x - off.x, y: 0, z: pos.z - off.z }
    // trucks keep driving during the flight: steer it to where the entity is now
    view.track = (out) => {
      const p = entityPosition(ref, trackPos)
      if (p) out.set(p.x - off.x, 0, p.z - off.z)
    }
    return view
  }

  // ── flights ──────────────────────────────────────────────────────────────────────────────────

  function fly(view, opts) {
    if (!view) return
    const g = { ...app.getView(), ...view, target: view.target ?? controls.target.clone() }
    goal = g
    app.flyTo({ ...view, ...opts }).then(() => {
      if (goal === g) goal = null
    })
  }

  function flyToSite(siteId, duration = SITE_FLIGHT) {
    fly(siteView(siteId), { duration, arc: true })
  }

  function flyToEntity(ref, opts = {}) {
    fly(focusView(ref, opts), { duration: opts.duration ?? FOCUS_FLIGHT, arc: true })
  }

  /** Screen fraction of an entity for the current camera, or null when behind the camera. */
  function screenFraction(pos) {
    camera.updateMatrixWorld() // may run before the first render after an instant flyTo
    tmp2.copy(pos).project(camera)
    if (tmp2.z > 1) return null
    return { x: (tmp2.x + 1) / 2, y: (1 - tmp2.y) / 2 }
  }

  /** Selection from the 3D view or a list: move only as much as needed. */
  function revealEntity(ref) {
    const pos = entityPosition(ref)
    if (!pos) return
    const view = app.getView()
    const s = !goal && !app.flying && view.distance <= NEAR_ENOUGH ? screenFraction(pos) : null
    const onScreen = s && s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1
    if (!onScreen) return flyToEntity(ref)
    const inside = s.x >= SAFE.left && s.x <= SAFE.right && s.y >= SAFE.top && s.y <= SAFE.bottom
    if (inside) return // video: clicking a visible object never moves the camera

    // nudge: shift the target so the entity lands just inside the safe region
    const fx = THREE.MathUtils.clamp(s.x, SAFE.left + NUDGE_MARGIN, SAFE.right - NUDGE_MARGIN)
    const fy = THREE.MathUtils.clamp(s.y, SAFE.top + NUDGE_MARGIN, SAFE.bottom - NUDGE_MARGIN)
    const want = screenOffset(fx, fy, view, tmp2)
    const have = screenOffset(s.x, s.y, view, new THREE.Vector3())
    fly({ target: { x: view.target.x + have.x - want.x, y: view.target.y, z: view.target.z + have.z - want.z } },
      { duration: NUDGE_FLIGHT })
  }

  // ── store & bus ──────────────────────────────────────────────────────────────────────────────

  function onStore(state, prev, changed) {
    const has = (k) => changed.includes(k)
    const sel = state.selection

    if (has('siteId')) {
      if (sel && sel.type !== 'site') flyToEntity(sel, { duration: SITE_FLIGHT })
      else flyToSite(state.siteId)
    } else if (has('selection') && sel) {
      if (sel.type === 'site') flyToSite(sel.id, FOCUS_FLIGHT + 0.2)
      else revealEntity(sel)
    }

    if (has('followId') && state.followId) {
      const ref = followRef(state.followId)
      if (ref) flyToEntity(ref, { duration: 0.9 })
    }
  }

  function onLocate(ref) {
    if (ref?.type === 'site') return flyToSite(ref.id, FOCUS_FLIGHT + 0.2)
    flyToEntity(ref, { ...LOCATE, duration: 1.1 })
  }

  function onCommand({ cmd } = {}) {
    // build on the pending goal so quick repeated clicks accumulate instead of restarting
    const v = currentView()
    const base = { target: v.target, distance: v.distance, azimuth: v.azimuth, polar: v.polar }
    switch (cmd) {
      case 'zoomIn':
      case 'zoomOut':
        return fly({ ...base, distance: v.distance * ZOOM_STEP[cmd] }, { duration: CMD_FLIGHT })
      case 'rotateLeft':
      case 'rotateRight':
        return fly({ ...base, azimuth: v.azimuth + (cmd === 'rotateLeft' ? -ROTATE_STEP : ROTATE_STEP) },
          { duration: CMD_FLIGHT + 0.15 })
      case 'home':
        return flyToSite(store.state.siteId, FOCUS_FLIGHT + 0.2)
    }
  }

  const unsubscribe = [
    store.subscribe(onStore),
    bus.on('camera:locate', onLocate),
    bus.on('camera:cmd', onCommand),
  ]

  // ── follow ───────────────────────────────────────────────────────────────────────────────────

  function followRef(id) {
    const type = FOLLOWABLE.find((t) => db.get(t, id))
    return type ? { type, id } : null
  }

  // A left-button drag (map pan) while following hands control back to the user.
  const dom = app.renderer.domElement
  let press = null
  const onDown = (e) => { press = e.button === 0 ? { x: e.clientX, y: e.clientY } : null }
  const onMove = (e) => {
    if (!press || !store.state.followId) return
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) {
      press = null
      store.set({ followId: null })
    }
  }
  const onUp = () => { press = null }
  dom.addEventListener('pointerdown', onDown)
  dom.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)

  const followDelta = new THREE.Vector3()
  function updateFollow(dt) {
    const id = store.state.followId
    if (!id || app.flying) return
    const ref = followRef(id)
    const pos = ref && entityPosition(ref)
    if (!pos) return
    const view = app.getView()
    const off = screenOffset(FOCUS.x, FOCUS.y, view, tmp2)
    followDelta.set(pos.x - off.x - view.target.x, 0, pos.z - off.z - view.target.z)
    followDelta.multiplyScalar(1 - Math.exp(-dt * FOLLOW_RATE))
    camera.position.add(followDelta)
    controls.target.add(followDelta)
  }

  // initial camera: the current site's view, no animation
  const initial = siteView(store.state.siteId)
  if (initial) app.flyTo({ ...initial, duration: 0 })

  return {
    update(dt) {
      updateFollow(dt)
    },
    dispose() {
      unsubscribe.forEach((off) => off())
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    },
  }
}
