// Dev harness for src/three/models/warehouse.js — all five variants side by side, or one with
// ?v=depot|dc|cold|crossdock|robotics. Rendered through the production createScene() so colours
// and lighting match the app. Extra params: ?rot=90 (building yaw, degrees), ?anchors=0 (hide the
// door-anchor markers), ?hud=0, ?d=180 (camera distance), ?az=45 ?polar=50 (camera angles,
// degrees), ?tx= ?ty= ?tz= (camera target), ?size=W,D,H, ?preset=world (use the building specs
// from src/data/layout.js instead of the SPEC §4.5 examples).
import * as THREE from 'three'
import { C } from '../src/three/palette.js'
import { createScene } from '../src/three/scene.js'
import { createWarehouse } from '../src/three/models/warehouse.js'

const params = new URLSearchParams(location.search)
const focus = params.get('v')
const yaw = THREE.MathUtils.degToRad(Number(params.get('rot') ?? 0))
const showAnchors = params.get('anchors') !== '0'
if (params.get('hud') === '0') document.body.classList.add('clean')

// Specs as in the SPEC §4.5 examples.
const SPECS = {
  depot: {
    variant: 'depot', width: 46, depth: 30, height: 9, label: 'WH-01', sign: 'WareTrack', subtitle: 'WH-01 · Riverside Hub',
    doors: [
      { id: 'WH-01-B1', side: 'south', offset: 15.5, number: '1' },
      { id: 'WH-01-B2', side: 'south', offset: 5, number: '2' },
      { id: 'D3', side: 'south', offset: -10.35, number: '3' },
      { id: 'D4', side: 'east', offset: 5, number: '4' },
    ],
  },
  dc: {
    variant: 'dc', width: 90, depth: 36, height: 10, label: 'WH-02', subtitle: 'WH-02 · Northgate DC',
    doors: Array.from({ length: 8 }, (_, i) => ({ id: `WH-02-D${i + 1}`, side: 'south', offset: -24 + i * 8.8, number: `D${i + 1}` })),
  },
  cold: {
    variant: 'cold', width: 70, depth: 44, height: 11, label: 'WH-03', subtitle: 'WH-03 · Eastport Cold Chain',
    doors: [-3, 6.5, 16, 25.5].map((x, i) => ({ id: `WH-03-B${i + 1}`, side: 'south', offset: x, width: 3.2, height: 4.4, number: `D${i + 1}` })),
  },
  crossdock: {
    variant: 'crossdock', width: 80, depth: 50, height: 8, label: 'WH-04', subtitle: 'WH-04 · Southfield Cross-Dock',
    doors: [
      ...[-30, -16, -2].map((x, i) => ({ id: `WH-04-IN${i + 1}`, side: 'south', offset: x, number: `${i + 1}` })),
      ...[17, 7, -3].map((z, i) => ({ id: `WH-04-OUT${i + 1}`, side: 'east', offset: z, number: `${i + 4}` })),
    ],
  },
  robotics: {
    variant: 'robotics', width: 100, depth: 60, height: 12, label: 'WH-05', subtitle: 'WH-05 · Westgate Robotics Hub',
    doors: [-26, -9, 8, 25].map((x, i) => ({ id: `WH-05-B${i + 1}`, side: 'south', offset: x, state: 'closed', number: `D${i + 1}` })),
  },
}

if (params.get('preset') === 'world') {
  const { siteLayout } = await import('../src/data/layout.js')
  for (const id of ['WH-01', 'WH-02', 'WH-03', 'WH-04', 'WH-05']) {
    const b = siteLayout(id).building
    SPECS[b.variant] = b
  }
}

// ── scene: the production renderer, lights, fog and controls ──
const app = createScene(document.getElementById('view'), { preserveDrawingBuffer: true })
const { scene, camera, controls, renderer } = app

const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: C.lot, roughness: 0.9 }))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// ── buildings ──
const names = focus && SPECS[focus] ? [focus] : Object.keys(SPECS)
// ?size=24,16,8 overrides the building's width,depth,height (doors fall back to the model's
// defaults, which scale with the size) — handy to judge proportions at other scales.
const sizeOverride = params.get('size')?.split(',').map(Number)
const buildings = names.map((name) => {
  const spec = sizeOverride?.length === 3
    ? { ...SPECS[name], width: sizeOverride[0], depth: sizeOverride[1], height: sizeOverride[2], doors: undefined }
    : SPECS[name]
  const g = createWarehouse(spec)
  g.rotation.y = yaw
  if (showAnchors) decorate(g)
  return g
})

// lay the row out along the screen-horizontal direction of the 45° camera, packed by size
const across = (g) => (g.userData.footprint.width + g.userData.footprint.depth) * Math.SQRT1_2
const GAP = 18
const rowLength = buildings.reduce((sum, g) => sum + across(g), 0) + GAP * (buildings.length - 1)
let cursor = -rowLength / 2
for (const g of buildings) {
  const t = cursor + across(g) / 2
  cursor += across(g) + GAP
  g.position.set(t * Math.SQRT1_2, 0, -t * Math.SQRT1_2)
  scene.add(g)
}

/** Footprint outline + a red marker and normal arrow at every door anchor. */
function decorate(g) {
  const { footprint, doorAnchors } = g.userData
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new THREE.Vector3((x * footprint.width) / 2, 0.06, (z * footprint.depth) / 2))
  g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: 0xf2c14e })))
  const dot = new THREE.MeshBasicMaterial({ color: 0xff2a2a })
  const ball = new THREE.SphereGeometry(0.45, 12, 8)
  for (const { position, normal } of Object.values(doorAnchors)) {
    const m = new THREE.Mesh(ball, dot)
    m.position.copy(position).setY(0.45)
    g.add(m, new THREE.ArrowHelper(normal, position.clone().setY(0.5), 4, 0xff2a2a, 1, 0.6))
  }
}

// ── camera ──
function setView({ target = new THREE.Vector3(), distance = 200, azimuth = 45, polar = 50 } = {}) {
  app.cancelFlight()
  const offset = new THREE.Vector3().setFromSphericalCoords(distance, THREE.MathUtils.degToRad(polar), THREE.MathUtils.degToRad(azimuth))
  controls.target.copy(target)
  camera.position.copy(target).add(offset)
  controls.update()
}

const box = new THREE.Box3()
for (const g of buildings) box.expandByObject(g)
const size = box.getSize(new THREE.Vector3())
const centre = box.getCenter(new THREE.Vector3()).setY(0)
// one building: a site-like close-up; the row: fit its length into the horizontal field of view
const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
const autoDistance = buildings.length === 1
  ? Math.max(size.x, size.z) * 2.4 + 40
  : (rowLength * 0.55) / (tanHalfFov * Math.min(innerWidth / innerHeight, 2.2)) + 60
const num = (k, fallback) => (params.has(k) ? Number(params.get(k)) : fallback)
setView({
  target: new THREE.Vector3(num('tx', centre.x), num('ty', 0), num('tz', centre.z)),
  distance: num('d', autoDistance),
  azimuth: num('az', 45),
  polar: num('polar', 50),
})

// ── HUD ──
const nav = document.getElementById('nav')
for (const v of ['all', ...Object.keys(SPECS)]) {
  const a = document.createElement('a')
  const q = new URLSearchParams(params)
  if (v === 'all') q.delete('v')
  else q.set('v', v)
  a.href = `?${q}`
  a.textContent = v
  if ((focus ?? 'all') === v) a.className = 'on'
  nav.appendChild(a)
}
const info = document.getElementById('info')
app.onFrame(() => {
  const lines = buildings.map((g) => {
    const { variant, footprint, height, extents: e, doorAnchors } = g.userData
    return `${variant.padEnd(9)} ${footprint.width}×${footprint.depth} h=${height.toFixed(1)}  ext x[${e.min.x.toFixed(1)},${e.max.x.toFixed(1)}] z[${e.min.z.toFixed(1)},${e.max.z.toFixed(1)}]  doors=${Object.keys(doorAnchors).length}`
  })
  const r = renderer.info.render
  info.textContent = `${lines.join('\n')}\ncalls ${r.calls} · tris ${(r.triangles / 1000).toFixed(1)}k`
})

// createScene keeps a 250 ms watchdog frame running, so hidden tabs still render
app.start()
app.renderNow()

/** Rendered pixel colours (canvas px) — for comparing against the reference frames. */
function sample(points) {
  app.renderNow()
  const src = renderer.domElement
  const ctx = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height }).getContext('2d')
  ctx.drawImage(src, 0, 0)
  return points.map(([x, y]) => `#${[...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`)
}

window.__dev = { THREE, app, scene, camera, controls, renderer, buildings, setView, render: app.renderNow, sample }
