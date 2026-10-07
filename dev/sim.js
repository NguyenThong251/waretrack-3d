// Dev page for the live simulation: the real scene shell (lights, map controls, hidden-tab render
// watchdog) + createWorld({scene, camera, renderer}) + createSimulation(world) + the interaction
// layer (hover / click, truck route ribbon). A table under the view lists every truck / forklift /
// dock with its live state; click a truck or forklift row to select it (route ribbon, follow).
// Query: ?site=WH-01..WH-05|ALL  ?speed=4  ?clean=1 (no HUD)  ?grid=1 (forklift occupancy grid)
import * as THREE from 'three'
import { createScene } from '../src/three/scene.js'
import { createWorld } from '../src/three/world.js'
import { createInteraction } from '../src/three/interaction.js'
import { createSimulation } from '../src/state/simulation.js'
import { SITE_IDS } from '../src/data/layout.js'
import { db } from '../src/data/db.js'
import { store, bus } from '../src/state/store.js'
import { fmtTime } from '../src/data/format.js'

const params = new URLSearchParams(location.search)
if (params.has('clean')) document.body.classList.add('clean')

const app = createScene(document.getElementById('view'), { preserveDrawingBuffer: true })
const world = createWorld({ scene: app.scene, camera: app.camera, renderer: app.renderer })
const sim = createSimulation(world)
const interaction = createInteraction(app, world)

let site = params.get('site') ?? 'WH-04'
let followId = null
const _v = new THREE.Vector3()

// Hidden panes throttle frames to a few per second while the sim clamps dt to 0.1 s: feed the
// real elapsed time in 0.1 s slices so the dev page keeps real time (?catchup=0 to disable).
const catchup = params.get('catchup') !== '0'
let lastNow = performance.now()
app.onFrame((dt, elapsed) => {
  const now = performance.now()
  let real = Math.min(2, (now - lastNow) / 1000)
  lastNow = now
  if (!catchup || real <= 0.11) sim.update(dt, elapsed)
  else while (real > 1e-3) { sim.update(Math.min(0.1, real), elapsed); real -= 0.1 }
  world.update(dt, elapsed)
  interaction.update(dt, elapsed)
  if (followId) {
    const sel = store.state.selection
    if (sel) {
      world.getEntityPosition(sel.type, sel.id, _v)
      app.controls.target.lerp(_v, 0.08)
    }
  }
})

// ── HUD ───────────────────────────────────────────────────────────────────────────────────────
function show(id) {
  site = id
  const view = id === 'ALL' ? world.getNetworkView() : world.getSiteView(id)
  app.flyTo({ ...view, duration: 0 })
  for (const b of document.querySelectorAll('#sites button')) b.classList.toggle('on', b.dataset.id === id)
  updateUrl()
  render()
}

function updateUrl() {
  const q = new URLSearchParams(location.search)
  q.set('site', site)
  history.replaceState(null, '', `?${q}`)
}

const sitesEl = document.getElementById('sites')
for (const id of [...SITE_IDS, 'ALL']) {
  const b = document.createElement('button')
  b.textContent = id
  b.dataset.id = id
  b.onclick = () => show(id)
  sitesEl.append(b)
}

const speedsEl = document.getElementById('speeds')
for (const m of [0, 1, 2, 4, 10]) {
  const b = document.createElement('button')
  b.textContent = m ? `${m}×` : 'pause'
  b.dataset.m = m
  b.onclick = () => setSpeed(m)
  speedsEl.append(b)
}
function setSpeed(m) {
  sim.setSpeed(m)
  for (const b of speedsEl.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.m) === m)
}
setSpeed(Number(params.get('speed') ?? 1))

document.getElementById('follow').onclick = (e) => {
  followId = followId ? null : store.state.selection?.id ?? null
  e.target.classList.toggle('on', !!followId)
}

// occupancy grid overlay (forklift planner) for the current site
let gridMesh = null
document.getElementById('grid').onclick = (e) => toggleGrid(e.target)
function toggleGrid(btn) {
  if (gridMesh) {
    app.scene.remove(gridMesh)
    gridMesh = null
    btn?.classList.remove('on')
    return
  }
  const s = sim.debug.sites.get(site)
  const G = s?.grid
  if (!G) return
  const pos = []
  for (let i = 0; i < G.cols * G.rows; i++) {
    if (!G.base[i] && !G.dyn[i]) continue
    const x = G.minX + ((i % G.cols) + 0.5) * 0.5, z = G.minZ + (Math.floor(i / G.cols) + 0.5) * 0.5
    pos.push(x, (s.platformY ?? 0) + 0.12, z)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  gridMesh = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff3355, size: 0.35, sizeAttenuation: true }))
  app.scene.add(gridMesh)
  btn?.classList.add('on')
}

// ── table ─────────────────────────────────────────────────────────────────────────────────────
const table = document.getElementById('table')
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n)
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—')

function render() {
  document.getElementById('clock').textContent = `${fmtTime(sim.debug.clock)} (${sim.debug.clock.toFixed(2)}) err ${sim.debug.errors}`
  const sel = store.state.selection
  const scope = (e) => site === 'ALL' || e.siteId === site
  const lines = []
  lines.push('<h4>Trucks</h4>')
  for (const t of db.list('truck').filter(scope)) {
    const ts = sim.debug.trucks.get(t.id)
    const cls = sel?.type === 'truck' && sel.id === t.id ? 'row sel' : 'row'
    lines.push(`<div class="${cls}" data-type="truck" data-id="${t.id}">${pad(t.id, 9)}${pad(t.siteId, 6)}${pad(t.status, 10)}${pad(ts?.phase + '/' + ts?.stage, 15)}${pad(t.dockId, 11)}`
      + `pos ${pad(num(t.position.x) + ',' + num(t.position.z), 14)} h ${pad(num(t.heading, 2), 6)} ${pad(t.speedKmh + 'km/h', 8)} left ${pad(t.distanceLeftM + 'm', 6)} eta ${pad(t.etaMin, 4)}`
      + `prog ${t.progress.done}/${t.progress.total}  cargo ${t.cargo.pallets}/${t.cargo.capacity} ${t.cargo.weightT}t  pass ${ts?.pass ? 'Y' : '-'} path ${t.path?.length ?? '-'}</div>`)
  }
  lines.push('<h4>Forklifts</h4>')
  for (const f of db.list('forklift').filter(scope)) {
    const fs = sim.debug.forklifts.get(f.id)
    const cls = sel?.type === 'forklift' && sel.id === f.id ? 'row sel' : 'row'
    lines.push(`<div class="${cls}" data-type="forklift" data-id="${f.id}">${pad(f.id, 7)}${pad(f.status, 10)}${pad(f.task, 30)} bat ${pad(num(f.battery), 6)} moves ${pad(f.movesToday, 4)}`
      + `pos ${pad(num(f.position.x) + ',' + num(f.position.z), 14)} ${pad(f.speedKmh + 'km/h', 9)} fork ${pad(num(f.forkHeight, 2), 5)} carry ${pad(f.carryingPalletId ?? f.carryingKind ?? '-', 10)} mode ${pad(fs?.mode, 9)} step ${fs?.steps?.[0]?.kind ?? '-'}</div>`)
  }
  lines.push('<h4>Docks · chargers · pallets</h4>')
  lines.push(db.list('dock').filter(scope).map((d) => `${d.id} ${d.status}${d.truckId ? ' ' + d.truckId : ''}${d.bookedTruckId ? ' (bk ' + d.bookedTruckId + ' ' + d.bookedInMin + 'm)' : ''} ${d.rearDoors} today ${d.trucksToday}`).join('  ·  '))
  lines.push(db.list('charger').filter(scope).map((c) => `${c.id} ${c.status} ${c.energyKwh}kWh s${c.sessionsToday}`).join('  ·  '))
  lines.push(db.list('pallet').filter(scope).map((p) => `${p.id}/${p.slot} ${p.status}${p.carriedBy ? '@' + p.carriedBy : ''}`).join('  ·  '))
  lines.push(db.sites().filter((s) => site === 'ALL' || s.id === site).map((s) => `${s.id} stock ${s.stock} (+${s.stockDelta}) out ${s.outboundToday} put ${s.putawaysToday} trucksΔ ${s.trucksDelta}`).join('  ·  '))
  table.innerHTML = lines.join('')
}
table.addEventListener('click', (e) => {
  const row = e.target.closest('.row')
  if (row) store.select({ type: row.dataset.type, id: row.dataset.id })
})
bus.on('data:update', render)

show(site)
app.start()
app.renderNow()
if (params.has('grid')) toggleGrid(document.getElementById('grid'))

// ── collision monitor: truck↔truck and forklift↔truck body overlaps, forklifts on blocked cells ──
const mon = { truckTruck: {}, forkTruck: {}, forkForks: {}, flBlocked: {}, frames: 0 }
function overlap(a, b, shrink = 0.3) {
  for (const o of [a, b]) {
    const s0 = Math.sin(o.h), c0 = Math.cos(o.h)
    for (const [ax, az] of [[s0, c0], [c0, -s0]]) {
      const r = (q) => { const s = Math.sin(q.h), c = Math.cos(q.h); return q.hl * Math.abs(s * ax + c * az) + q.hw * Math.abs(c * ax - s * az) }
      if (Math.abs((b.x - a.x) * ax + (b.z - a.z) * az) > r(a) + r(b) - shrink) return false
    }
  }
  return true
}
mon.events = []
const describe = (o) => `${o.id}:${o.phase ?? o.fs?.mode}/${o.stage ?? o.fs?.steps?.[0]?.kind ?? '-'}@${o.x.toFixed(1)},${o.z.toFixed(1)},h${o.h.toFixed(2)}`
const bump = (m, k, a, b) => {
  if (!m[k] && a && mon.events.length < 60) mon.events.push(`${sim.debug.clock.toFixed(1)} ${describe(a)} × ${describe(b)}`)
  m[k] = (m[k] || 0) + 1
}
app.onFrame(() => {
  mon.frames++
  const ts = [...sim.debug.trucks.values()].filter((t) => !t.broken && t.phase !== 'offmap')
  const fl = [...sim.debug.forklifts.values()].map((f) => ({ id: f.id, x: f.x, z: f.z, h: f.h, hl: 2.45, hw: 0.8, fs: f }))
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) if (overlap(ts[i], ts[j])) bump(mon.truckTruck, `${ts[i].id}~${ts[j].id}`, ts[i], ts[j])
    for (const f of fl) if (overlap(ts[i], f, 0.2)) bump(mon.forkTruck, `${f.id}~${ts[i].id}:${ts[i].phase}`, f, ts[i])
  }
  for (let i = 0; i < fl.length; i++) {
    for (let j = i + 1; j < fl.length; j++) if (overlap(fl[i], fl[j], 0.2)) bump(mon.forkForks, `${fl[i].id}~${fl[j].id}`, fl[i], fl[j])
    const fs = fl[i].fs, G = fs.site.grid
    const st = fs.steps[0]
    if (G && st?.kind === 'drive' && !st.final) {
      const c = Math.floor((fs.x - G.minX) / 0.5), r = Math.floor((fs.z - G.minZ) / 0.5)
      if (G.base[r * G.cols + c]) bump(mon.flBlocked, fs.id)
    }
  }
})

window.__sim = { app, world, sim, db, store, interaction, mon }
