// Picking + selection visuals (SPEC §6): hover / click on world.pickables, corner brackets, faint
// box fill, ground glow, CSS2D label pills, and the route of the selected truck (blue ribbon with
// scrolling chevrons, dotted reverse leg, pin + pulsing ring at the dock).
//
// Video behaviour (docs/ref 02, 03, 05, 07–09, 12–13, 19–21):
//  - plain hover      → light pill + faint periwinkle brackets
//  - selected         → blue pill + light periwinkle brackets, frosted box, soft ground glow
//  - selected+hovered → the brackets turn solid brand blue and thicker
import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { C, mat } from './palette.js'
import { canvasTexture } from './canvasText.js'
import { db } from '../data/db.js'
import { entityTag } from '../data/selectors.js'
import { store } from '../state/store.js'
import './interaction.css'

const CLICK_SLOP = 5 // px: a press that moves less than this is a click, not a drag
const REPICK_INTERVAL = 0.2 // s: re-pick under a still pointer (things drive under it)
const BOX_REFRESH = 0.3 // s: re-measure the highlighted entity's bounds
const LABEL_LIFT = 0.6 // m above the box top
const DOCK_BOX_HEIGHT = 0.4 // dock bays are flat ground areas in the video
const ROUTE_STATUSES = new Set(['en_route', 'at_gate', 'docking'])

const sameRef = (a, b) => a === b || (!!a && !!b && a.type === b.type && a.id === b.id)

export function createInteraction(app, world) {
  const overlay = new THREE.Group()
  overlay.name = 'interaction-overlay'
  app.scene.add(overlay)

  const picker = createPicker(app, world)
  const selected = createHighlight(overlay, true)
  const hovered = createHighlight(overlay, false)
  const route = createRouteViz(overlay, world)

  return {
    update(dt, elapsed) {
      picker.update(elapsed)
      const { hover, selection } = store.state
      const focused = sameRef(hover, selection)
      selected.update(selection, world, dt, elapsed, focused)
      hovered.update(focused ? null : hover, world, dt, elapsed, false)
      route.update(selection, dt, elapsed, app.camera)
    },
    dispose() {
      picker.dispose()
      app.scene.remove(overlay)
    },
  }
}

// ── picking ──────────────────────────────────────────────────────────────────────────────────

function createPicker(app, world) {
  const dom = app.renderer.domElement
  const raycaster = new THREE.Raycaster()
  raycaster.params.Line.threshold = 0.05
  raycaster.params.Points.threshold = 0.05
  const ndc = new THREE.Vector2()

  let pointer = null // last client position while the pointer is over the canvas
  let press = null // { id, x, y, button, dragging }
  let dirty = false
  let lastPick = -Infinity

  function pick(x, y) {
    const r = dom.getBoundingClientRect()
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, app.camera)
    return resolveHits(raycaster.intersectObjects(world.pickables ?? [], true))
  }

  function setHover(ref) {
    if (!sameRef(ref, store.state.hover)) store.set({ hover: ref ? { type: ref.type, id: ref.id } : null })
  }

  const onMove = (e) => {
    pointer = { x: e.clientX, y: e.clientY }
    dirty = true
    if (press && !press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) {
      press.dragging = true
      setHover(null) // no labels while panning / rotating (video frame 05)
    }
  }
  const onDown = (e) => {
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button, dragging: false }
  }
  const onUp = (e) => {
    const p = press
    press = null
    dirty = true
    if (!p || p.id !== e.pointerId || p.dragging || p.button !== 0) return
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP) return
    const ref = pick(e.clientX, e.clientY)
    if (ref) store.select(ref) // empty ground keeps the selection; Esc clears it
  }
  const onCancel = () => {
    press = null
  }
  const onLeave = () => {
    pointer = null
    if (!press) setHover(null)
  }
  const onKey = (e) => {
    if (e.key !== 'Escape' || isTyping(e.target)) return
    if (store.state.selection) store.select(null)
  }

  dom.addEventListener('pointermove', onMove)
  dom.addEventListener('pointerdown', onDown)
  dom.addEventListener('pointerup', onUp)
  dom.addEventListener('pointercancel', onCancel)
  dom.addEventListener('pointerleave', onLeave)
  window.addEventListener('keydown', onKey)

  return {
    update(elapsed) {
      if (!pointer || press?.dragging) return
      if (!dirty && elapsed - lastPick < REPICK_INTERVAL) return
      dirty = false
      lastPick = elapsed
      const ref = pick(pointer.x, pointer.y)
      setHover(ref)
      if (!press) dom.style.cursor = ref ? 'pointer' : 'grab'
    },
    dispose() {
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointerup', onUp)
      dom.removeEventListener('pointercancel', onCancel)
      dom.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('keydown', onKey)
    },
  }
}

function isTyping(el) {
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/**
 * Nearest entity hit. Dock bays are invisible volumes that enclose the trucks / forklifts standing
 * in them, so they only win when nothing more specific is behind them (the building wall counts
 * as "behind": the bay sits in front of it).
 */
function resolveHits(hits) {
  let dock = null
  for (const hit of hits) {
    const ref = refOf(hit.object)
    if (!ref) continue
    if (ref.type === 'dock') {
      dock ??= ref
      continue
    }
    if (ref.type === 'site' && dock) return dock
    return ref
  }
  return dock
}

/** Entity ref of the nearest ancestor carrying userData.ref; null inside hidden subtrees. */
function refOf(object) {
  let ref = null
  for (let o = object; o; o = o.parent) {
    // the hit mesh itself may be invisible (dock pick volumes); hidden ancestors mean "not there"
    if (o !== object && o.visible === false) return null
    if (!ref && o.userData?.ref) ref = o.userData.ref
  }
  return ref && db.get(ref.type, ref.id) ? ref : null
}

// ── highlight: brackets + fill + glow + label ───────────────────────────────────────────────

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const UNIT_EDGES = new THREE.EdgesGeometry(UNIT_BOX)
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)

// Frosted "glass" box around the selection (frames 09, 20: a light veil with pale edges).
const FILL_MAT = new THREE.MeshBasicMaterial({
  color: 0xd2dcff, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false,
})
const EDGE_MAT = new THREE.LineBasicMaterial({
  color: 0xc4d0ff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false,
})

// Bracket looks (colour, px width, opacity) — see the header comment for when each applies.
const BRACKET = {
  hover: { color: new THREE.Color(0x8ea1ee), width: 1.6, opacity: 0.55 },
  selected: { color: new THREE.Color(0x7d92ec), width: 2.6, opacity: 1 },
  focused: { color: new THREE.Color(C.select), width: 3, opacity: 1 },
}
const BRACKET_EASE = 14 // 1/s
let glowMat = null
function glowMaterial() {
  glowMat ??= new THREE.MeshBasicMaterial({
    map: radialTexture(C.selectGlow),
    transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  })
  return glowMat
}

function bracketMaterial({ color, width, opacity }) {
  return new LineMaterial({
    color,
    linewidth: width, // CSS px
    transparent: true,
    opacity,
    depthTest: false, // read over the geometry they frame
    depthWrite: false,
    toneMapped: false,
  })
}

/** Ease a bracket material toward a look (framerate independent). */
function easeBracket(material, look, dt) {
  const k = 1 - Math.exp(-dt * BRACKET_EASE)
  material.color.lerp(look.color, k)
  material.linewidth += (look.width - material.linewidth) * k
  material.opacity += (look.opacity - material.opacity) * k
}

function createHighlight(parent, selected) {
  const frame = new THREE.Group() // oriented like the entity; origin = bottom centre of its box
  frame.visible = false
  parent.add(frame)

  const baseLook = selected ? BRACKET.selected : BRACKET.hover
  const brackets = new LineSegments2(new LineSegmentsGeometry(), bracketMaterial(baseLook))
  brackets.renderOrder = 30
  brackets.frustumCulled = false
  frame.add(brackets)

  const fill = selected ? new THREE.Mesh(UNIT_BOX, FILL_MAT) : null
  const edges = selected ? new THREE.LineSegments(UNIT_EDGES, EDGE_MAT) : null
  const glow = selected ? new THREE.Mesh(UNIT_PLANE, glowMaterial()) : null
  if (selected) {
    fill.renderOrder = 28
    edges.renderOrder = 29
    glow.renderOrder = 3
    glow.position.y = 0.05
    frame.add(fill, edges, glow)
  }

  const anchor = document.createElement('div')
  anchor.className = 'wt-tag-anchor'
  const label = new CSS2DObject(anchor)
  label.center.set(0.5, 1) // pill pointer tip sits on the anchor point
  frame.add(label)
  let idEl = null
  let textEl = null

  let current = null
  let boxAt = -Infinity
  const box = new THREE.Box3() // entity-local
  const dims = new THREE.Vector3()
  const builtDims = new THREE.Vector3(-1, -1, -1)

  function buildPill() {
    const pill = document.createElement('div')
    pill.className = selected ? 'wt-tag' : 'wt-tag wt-tag--light'
    idEl = document.createElement('b')
    textEl = document.createElement('span')
    pill.append(idEl, textEl)
    anchor.replaceChildren(pill)
  }

  function hide() {
    frame.visible = false
    current = null
  }

  function update(ref, world, dt, elapsed, focused) {
    const entity = ref && db.get(ref.type, ref.id)
    const obj = entity && world.getObject?.(ref.type, ref.id)
    if (!obj || !isShown(obj)) return hide()

    const look = focused ? BRACKET.focused : baseLook
    if (!sameRef(ref, current)) {
      current = { type: ref.type, id: ref.id }
      boxAt = -Infinity
      buildPill()
      easeBracket(brackets.material, look, Infinity) // a new target starts at its final look
    }
    if (elapsed - boxAt > BOX_REFRESH) {
      boxAt = elapsed
      if (!measure(obj, world, ref, box)) return hide()
    }
    place(obj, ref.type)
    setTag(entityTag(ref.type, entity))
    easeBracket(brackets.material, look, dt)
    frame.visible = true
  }

  const _p = new THREE.Vector3()
  const _q = new THREE.Quaternion()
  const _s = new THREE.Vector3()
  const _c = new THREE.Vector3()

  function place(obj, type) {
    obj.updateWorldMatrix(true, false)
    obj.matrixWorld.decompose(_p, _q, _s)
    box.getCenter(_c)
    _c.y = box.min.y
    frame.position.copy(_c.applyMatrix4(obj.matrixWorld))
    frame.quaternion.copy(_q)

    box.getSize(dims).multiply(_s.set(Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z)))
    if (type === 'dock') dims.y = Math.min(dims.y, DOCK_BOX_HEIGHT)
    if (dims.distanceToSquared(builtDims) > 1e-4) {
      builtDims.copy(dims)
      layout(type)
    }
  }

  /** Rebuild bracket segments and resize fill / glow / label for the current dims. */
  function layout(type) {
    // brackets stand a little off the object (frames 03, 20); dock bays are drawn on their outline
    const pad = type === 'dock' ? 0 : THREE.MathUtils.clamp(Math.max(dims.x, dims.z) * 0.18, 0.3, 0.7)
    const w = dims.x + pad * 2
    const d = dims.z + pad * 2
    const h = dims.y + (type === 'dock' ? 0 : pad * 0.6)

    brackets.geometry.dispose()
    brackets.geometry = new LineSegmentsGeometry().setPositions(bracketSegments(w, h, d))
    if (selected) {
      fill.scale.set(w, h, d)
      edges.scale.set(w, h, d)
      glow.visible = type !== 'site'
      glow.scale.set(w * 1.5 + 2, 1, d * 1.4 + 2)
    }
    label.position.set(0, h + LABEL_LIFT, 0)
  }

  function setTag({ id, text }) {
    if (idEl.textContent !== id) idEl.textContent = id
    if (textEl.textContent !== text) textEl.textContent = text ?? ''
  }

  return { update }
}

function isShown(obj) {
  for (let o = obj; o; o = o.parent) if (o.visible === false && o !== obj) return false
  return obj.visible !== false || obj.isMesh // invisible pick volumes still count
}

/** Entity-local bounds (oriented with the entity). Falls back to the world AABB from the contract. */
function measure(obj, world, ref, out) {
  // buildings publish their local extents (SPEC §4.5) — cheaper and excludes decorative overhangs
  if (obj.userData.extents?.isBox3 && !obj.userData.extents.isEmpty()) return !!out.copy(obj.userData.extents)
  localBox(obj, out)
  if (!out.isEmpty()) return true
  // CONTRACT-GAP: entities without meshes — use world.getEntityBox (axis-aligned) in obj space
  const wb = world.getEntityBox?.(ref.type, ref.id, new THREE.Box3())
  if (!wb || wb.isEmpty()) return false
  out.copy(wb).applyMatrix4(_inv.copy(obj.matrixWorld).invert())
  return true
}

const _inv = new THREE.Matrix4()
const _rel = new THREE.Matrix4()
const _bb = new THREE.Box3()

function localBox(root, out) {
  root.updateWorldMatrix(true, true)
  _inv.copy(root.matrixWorld).invert()
  out.makeEmpty()
  const add = (o) => {
    if (!o.isMesh || o.userData.noBounds) return
    let bb
    if (o.isInstancedMesh) {
      if (!o.boundingBox) o.computeBoundingBox()
      bb = o.boundingBox
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
      bb = o.geometry.boundingBox
    }
    if (bb.isEmpty()) return
    _rel.multiplyMatrices(_inv, o.matrixWorld)
    out.union(_bb.copy(bb).applyMatrix4(_rel))
  }
  root.traverseVisible(add)
  if (out.isEmpty()) root.traverse(add) // invisible pick volumes (dock bays)
  return out
}

/** 8 corners × 3 short segments. Box spans x ±w/2, y 0..h, z ±d/2. */
function bracketSegments(w, h, d) {
  const seg = (e) => Math.min(THREE.MathUtils.clamp(e * 0.22, 0.4, 2.5), e * 0.45)
  const lx = seg(w)
  const ly = seg(h)
  const lz = seg(d)
  const out = []
  for (const sx of [-1, 1]) {
    for (const top of [false, true]) {
      for (const sz of [-1, 1]) {
        const x = (sx * w) / 2
        const y = top ? h : 0
        const z = (sz * d) / 2
        out.push(x, y, z, x - sx * lx, y, z)
        out.push(x, y, z, x, top ? y - ly : y + ly, z)
        out.push(x, y, z, x, y, z - sz * lz)
      }
    }
  }
  return out
}

const radialCache = new Map()

/** Soft radial-gradient sprite of one colour (cached per colour). */
function radialTexture(color) {
  if (radialCache.has(color)) return radialCache.get(color)
  const c = new THREE.Color(color)
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`
  const tex = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, `rgba(${rgb},0.95)`)
    g.addColorStop(0.5, `rgba(${rgb},0.7)`)
    g.addColorStop(0.78, `rgba(${rgb},0.22)`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
  radialCache.set(color, tex)
  return tex
}

// ── truck route visualisation ────────────────────────────────────────────────────────────────
// Frames 12, 13, 20: a solid blue ribbon starts at the truck's leading edge and follows the road
// with small white chevrons drifting toward the target; the reverse leg into the bay is a dotted
// line of blue discs; a blue pin floats over a blue disc with a soft halo at the dock pose.

const ROUTE_BLUE = 0x2254e6 // a shade deeper than --blue, as the ribbon reads in the video
// CONTRACT-GAP: SPEC says a 1.8 m ribbon; measured against the (1.3×-scaled) trucks in frames 12/20
// the video's ribbon is ≈ 1.1 m (dots ≈ 0.6 m, target disc ≈ 1.7 m, pin ≈ 2.6 m tall).
const RIBBON_WIDTH = 1.1
const RIBBON_Y = 0.08
const CORNER_RADIUS = 5
const CHEVRON_SPACING = RIBBON_WIDTH * 6 // m per chevron (one 64 × 384 px texture tile)
const CHEVRON_SPEED = 3 // m/s toward the target
const CAP_SEGMENTS = 10
const DOT_SPACING = 1.8
const DOT_RADIUS = 0.32
const MAX_DOTS = 80
const TRUCK_HALF_LENGTH = 6.8 // fallback when the model doesn't publish userData.length
const MARKER_RADIUS = 0.85
const PIN_LIFT = 0.55 // gap between the target disc and the pin tip

const decal = (opts) => new THREE.MeshBasicMaterial({
  transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...opts,
})

function createRouteViz(parent, world) {
  const group = new THREE.Group()
  group.name = 'truck-route'
  group.visible = false
  parent.add(group)

  const ribbon = createRibbon()
  const dots = new THREE.InstancedMesh(
    new THREE.CircleGeometry(DOT_RADIUS, 20).rotateX(-Math.PI / 2),
    decal({ color: ROUTE_BLUE }),
    MAX_DOTS,
  )
  dots.count = 0
  dots.frustumCulled = false
  dots.renderOrder = 5
  const marker = createTargetMarker()
  group.add(ribbon.mesh, dots, marker.group)

  let signature = ''
  const builtAt = new THREE.Vector2(Infinity, Infinity)

  function update(selection, dt, elapsed, camera) {
    const truck = selection?.type === 'truck' ? db.get('truck', selection.id) : null
    const path = truck?.path
    if (!truck || !ROUTE_STATUSES.has(truck.status) || !Array.isArray(path) || !path.length) {
      group.visible = false
      signature = ''
      return
    }
    group.visible = true
    // cheap change test: rebuild when the route changes or the truck moved a quarter metre
    const sig = routeSignature(truck)
    const { x, z } = truck.position
    if (sig !== signature || builtAt.distanceToSquared({ x, y: z }) > 0.25 * 0.25) {
      signature = sig
      builtAt.set(x, z)
      rebuild(truck)
    }
    ribbon.scroll(dt)
    marker.animate(elapsed, camera)
  }

  function rebuild(truck) {
    const pts = [new THREE.Vector2(truck.position.x, truck.position.z)]
    for (const p of truck.path) pushDistinct(pts, p)
    if (truck.target) pushDistinct(pts, truck.target)
    const end = pts[pts.length - 1]
    const lead = truckHalfLength(world, truck.id)

    // the final leg into the dock is the reverse manoeuvre: dotted, not a ribbon
    const reverse = !!truck.target && pts.length >= 2
    const ribbonPts = trimStart(reverse ? pts.slice(0, -1) : pts, lead)
    ribbon.set(ribbonPts)
    if (reverse) {
      // reversing already (only the dock left): the dots start at the truck's rear
      const from = pts.length === 2 ? trimStart(pts, lead)?.[0] : pts[pts.length - 2]
      layoutDots(from, end, !!ribbonPts)
    } else {
      layoutDots(null)
    }
    marker.group.position.set(end.x, 0, end.y)
  }

  const _m = new THREE.Matrix4()
  const _dir = new THREE.Vector2()
  function layoutDots(from, to, afterRibbon) {
    dots.count = 0
    if (from) {
      const len = from.distanceTo(to)
      _dir.subVectors(from, to).normalize() // walk back from the target
      const startGap = MARKER_RADIUS + DOT_SPACING * 0.55 // clear of the target disc
      const endGap = afterRibbon ? RIBBON_WIDTH * 0.6 : DOT_RADIUS // clear of the ribbon cap
      for (let s = startGap; s <= len - endGap && dots.count < MAX_DOTS; s += DOT_SPACING) {
        _m.makeTranslation(to.x + _dir.x * s, RIBBON_Y, to.y + _dir.y * s)
        dots.setMatrixAt(dots.count++, _m)
      }
    }
    dots.instanceMatrix.needsUpdate = true
  }

  return { update }
}

/** Half the truck's length (its centre → bumper), so the ribbon starts at its leading edge. */
function truckHalfLength(world, id) {
  const obj = world.getObject?.('truck', id)
  const len = obj?.userData?.length
  return len > 0 ? (len * Math.abs(obj.scale.z)) / 2 : TRUCK_HALF_LENGTH
}

function pushDistinct(pts, p) {
  const last = pts[pts.length - 1]
  if (Math.hypot(p.x - last.x, p.z - last.y) > 0.05) pts.push(new THREE.Vector2(p.x, p.z))
}

/** The polyline without its first `dist` metres, or null when nothing (useful) is left. */
function trimStart(pts, dist) {
  let left = dist
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = pts[i].distanceTo(pts[i + 1])
    if (seg > left + 0.3) return [pts[i].clone().lerp(pts[i + 1], left / seg), ...pts.slice(i + 1)]
    left = Math.max(0, left - seg)
  }
  return null
}

function routeSignature(truck) {
  const f = (p) => (p ? `${p.x.toFixed(1)},${p.z.toFixed(1)}` : '-')
  const { path, target } = truck
  return `${truck.id}|${truck.status}|${path.length}|${f(path[0])}|${f(path[path.length - 1])}|${f(target)}`
}

// ── ribbon geometry (in-place updates, grown on demand) ─────────────────────────────────────

let chevronTex = null
function chevronTexture() {
  if (chevronTex) return chevronTex
  // u across the ribbon, v along it (canvas top = +v = toward the target): a small 90° "^"
  chevronTex = canvasTexture(64, 384, (ctx) => {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(18, 199)
    ctx.lineTo(32, 185)
    ctx.lineTo(46, 199)
    ctx.stroke()
  })
  chevronTex.wrapT = THREE.RepeatWrapping
  chevronTex.wrapS = THREE.ClampToEdgeWrapping
  return chevronTex
}

function createRibbon() {
  const baseMat = decal({ color: ROUTE_BLUE })
  const chevronMat = decal({ map: chevronTexture(), polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
  let geometry = new THREE.BufferGeometry()
  const mesh = new THREE.Mesh(geometry, [baseMat, chevronMat])
  mesh.frustumCulled = false
  mesh.renderOrder = 4
  mesh.visible = false
  let capacity = 0 // centre-line points the buffers can hold

  function allocate(points) {
    capacity = Math.max(64, Math.ceil(points * 1.5))
    const verts = capacity * 2 + 2 * (CAP_SEGMENTS + 2)
    const tris = (capacity - 1) * 2 + 2 * CAP_SEGMENTS
    geometry.dispose()
    geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(verts * 2), 2).setUsage(THREE.DynamicDrawUsage))
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(tris * 3), 1).setUsage(THREE.DynamicDrawUsage))
    mesh.geometry = geometry
  }

  function set(points) {
    mesh.visible = !!points && points.length >= 2
    if (!mesh.visible) return
    const line = roundCorners(points, CORNER_RADIUS)
    if (line.length > capacity) allocate(line.length)
    const pos = geometry.attributes.position.array
    const uv = geometry.attributes.uv.array
    const idx = geometry.index.array
    const hw = RIBBON_WIDTH / 2
    const n = line.length

    // v is measured back from the ribbon's end, so chevrons stay put while the truck eats the route
    let total = 0
    for (let i = 1; i < n; i++) total += line[i].distanceTo(line[i - 1])

    // strip
    let along = 0
    const t = new THREE.Vector2()
    const nrm = new THREE.Vector2()
    for (let i = 0; i < n; i++) {
      if (i > 0) along += line[i].distanceTo(line[i - 1])
      const miter = stripNormal(line, i, t, nrm)
      const p = line[i]
      const v = (along - total) / CHEVRON_SPACING
      writeVertex(pos, uv, i * 2, p.x + nrm.x * hw * miter, p.y + nrm.y * hw * miter, 0, v)
      writeVertex(pos, uv, i * 2 + 1, p.x - nrm.x * hw * miter, p.y - nrm.y * hw * miter, 1, v)
    }
    let k = 0
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2
      idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + 2
      idx[k++] = a + 1; idx[k++] = a + 3; idx[k++] = a + 2
    }
    const stripIndices = k

    // round caps (base material only, so they carry no chevrons)
    let v = n * 2
    for (const [i, sign] of [[0, -1], [n - 1, 1]]) {
      stripNormal(line, i, t, nrm)
      const c = line[i]
      const centre = v
      writeVertex(pos, uv, v++, c.x, c.y, 0.5, 0)
      for (let s = 0; s <= CAP_SEGMENTS; s++) {
        const a = (Math.PI * s) / CAP_SEGMENTS
        const ox = nrm.x * Math.cos(a) + t.x * sign * Math.sin(a)
        const oz = nrm.y * Math.cos(a) + t.y * sign * Math.sin(a)
        writeVertex(pos, uv, v++, c.x + ox * hw, c.y + oz * hw, 0.5, 0)
        if (s > 0) {
          idx[k++] = centre; idx[k++] = v - 2; idx[k++] = v - 1
        }
      }
    }

    geometry.clearGroups()
    geometry.addGroup(0, k, 0)
    geometry.addGroup(0, stripIndices, 1)
    geometry.setDrawRange(0, k)
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.uv.needsUpdate = true
    geometry.index.needsUpdate = true
  }

  return {
    mesh,
    set,
    scroll(dt) {
      const tex = chevronTexture()
      tex.offset.y = (tex.offset.y - (dt * CHEVRON_SPEED) / CHEVRON_SPACING) % 1
    },
  }
}

function writeVertex(pos, uv, i, x, z, u, v) {
  pos[i * 3] = x
  pos[i * 3 + 1] = RIBBON_Y
  pos[i * 3 + 2] = z
  uv[i * 2] = u
  uv[i * 2 + 1] = v
}

const _segT = new THREE.Vector2()

/** Tangent + left normal at point i of a polyline (Vector2 = x,z). Returns the miter scale. */
function stripNormal(line, i, outT, outN) {
  const n = line.length
  const prev = line[Math.max(0, i - 1)]
  const next = line[Math.min(n - 1, i + 1)]
  outT.subVectors(next, prev).normalize()
  outN.set(-outT.y, outT.x)
  if (i === 0 || i === n - 1) return 1
  _segT.subVectors(line[i], prev).normalize()
  return 1 / Math.max(0.5, outN.x * -_segT.y + outN.y * _segT.x)
}

/** Replace sharp corners with short quadratic curves (radius ≈ r, limited by segment lengths). */
function roundCorners(pts, r) {
  if (pts.length < 3) return pts.slice()
  const out = [pts[0].clone()]
  const d1 = new THREE.Vector2()
  const d2 = new THREE.Vector2()
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const c = pts[i + 1]
    const l1 = d1.subVectors(b, a).length()
    const l2 = d2.subVectors(c, b).length()
    d1.divideScalar(l1 || 1)
    d2.divideScalar(l2 || 1)
    const turn = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1))
    if (turn < 0.05) {
      out.push(b.clone())
      continue
    }
    const cut = Math.min(r * Math.tan(turn / 2), l1 * 0.45, l2 * 0.45)
    const p1 = b.clone().addScaledVector(d1, -cut)
    const p2 = b.clone().addScaledVector(d2, cut)
    const steps = Math.max(2, Math.ceil(turn / 0.18))
    for (let s = 0; s <= steps; s++) {
      const k = s / steps
      out.push(new THREE.Vector2(
        (1 - k) ** 2 * p1.x + 2 * (1 - k) * k * b.x + k * k * p2.x,
        (1 - k) ** 2 * p1.y + 2 * (1 - k) * k * b.y + k * k * p2.y,
      ))
    }
  }
  out.push(pts[pts.length - 1].clone())
  return out
}

// ── target marker: floating pin over a blue disc with a soft halo + pulsing ring ─────────────

function createTargetMarker() {
  const group = new THREE.Group()
  const flat = (geometry, material, y, order) => {
    const m = new THREE.Mesh(geometry.rotateX(-Math.PI / 2), material)
    m.position.y = y
    m.renderOrder = order
    return m
  }

  const halo = flat(new THREE.CircleGeometry(MARKER_RADIUS * 2, 40), decal({ map: radialTexture(C.selectGlow), opacity: 0.5 }), RIBBON_Y - 0.01, 4)
  const disc = flat(new THREE.CircleGeometry(MARKER_RADIUS, 40), decal({ color: ROUTE_BLUE }), RIBBON_Y + 0.01, 6)
  const pulseMat = decal({ color: C.blueMid, opacity: 0.5 })
  const pulse = flat(new THREE.RingGeometry(MARKER_RADIUS * 0.94, MARKER_RADIUS * 1.12, 48), pulseMat, RIBBON_Y, 5)

  const pin = createPin()
  group.add(halo, disc, pulse, pin.group)

  const _toCam = new THREE.Vector3()
  return {
    group,
    animate(elapsed, camera) {
      const k = (elapsed % 1.6) / 1.6
      const s = 1 + k * 1.6
      pulse.scale.set(s, 1, s)
      pulseMat.opacity = 0.6 * (1 - k) ** 1.5
      pin.group.position.y = PIN_LIFT + Math.sin(elapsed * 2.4) * 0.12
      // keep the white dot on the side of the head that faces the camera
      pin.head.getWorldPosition(_toCam)
      _toCam.subVectors(camera.position, _toCam).normalize()
      pin.dot.position.copy(pin.head.position).addScaledVector(_toCam, PIN.r + 0.02)
      pin.dot.quaternion.copy(camera.quaternion)
    },
  }
}

// Same silhouette and (cached) material as the pallet pins in props.js, so they read as one set.
const PIN = { r: 0.6, headY: 2 }
let pinGeometry = null

/** Teardrop map pin (tip at the origin), blue clay with a white camera-facing dot. */
function createPin() {
  pinGeometry ??= pinLathe()
  const group = new THREE.Group()
  const body = new THREE.Mesh(pinGeometry, mat(C.blue, { roughness: 0.4, emissive: C.blue, emissiveIntensity: 0.14 }))
  body.castShadow = true
  body.renderOrder = 6
  const head = new THREE.Object3D()
  head.position.y = PIN.headY
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(PIN.r * 0.42, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  )
  dot.renderOrder = 7
  group.add(body, head, dot)
  return { group, head, dot }
}

function pinLathe() {
  const { r, headY } = PIN
  const beta = Math.acos(r / headY) // tangent point from the tip to the head circle
  const pts = [new THREE.Vector2(0, 0)]
  const start = beta - Math.PI / 2
  for (let i = 0; i <= 18; i++) {
    const a = start + ((Math.PI / 2 - start) * i) / 18
    pts.push(new THREE.Vector2(Math.max(1e-3, r * Math.cos(a)), headY + r * Math.sin(a)))
  }
  pts.push(new THREE.Vector2(0, headY + r))
  return new THREE.LatheGeometry(pts, 32)
}
