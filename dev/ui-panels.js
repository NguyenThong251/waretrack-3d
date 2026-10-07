// Dev harness for the ui-panels components (detail panel, Shipment Tracking, Fleet panel) laid
// over reference frames of the video so layout / typography / colours can be compared 1:1.
// Open http://localhost:5173/dev/ui-panels.html — at 1440×830 the overlay is at design scale, at
// 1248×718 it is zoomed exactly like the frames.
import '../src/ui/styles.css'
import { store, bus } from '../src/state/store.js'
import { db } from '../src/data/db.js'
import { mountDetailPanel } from '../src/ui/detailPanel.js'
import { mountShipmentTracker } from '../src/ui/shipmentTracker.js'
import { mountFleetPanel } from '../src/ui/fleetPanel.js'
import { illustration } from '../src/ui/illustrations.js'

// same scaling rule as src/ui/index.js (not imported: index.js pulls in every ui-shell module)
// ?crop=x,y (or __dev.crop(x, y)) pins a 1:1 1440×830 stage shifted by (-x, -y) for close inspection
const params = new URLSearchParams(location.search)
let cropAt = params.get('crop')?.split(',').map(Number) ?? null
if (params.has('nobar')) document.body.classList.add('bar-off')
if (params.get('mode')) document.body.classList.add(params.get('mode'))
if (params.has('gallery')) document.body.classList.add('show-gallery', 'gallery-full')
const applyScale = () => {
  const stage = document.getElementById('stage')
  document.body.classList.toggle('crop', !!cropAt)
  stage.style.transform = cropAt ? `translate(${-cropAt[0]}px, ${-cropAt[1]}px)` : ''
  const s = cropAt ? 1 : Math.min(window.innerWidth / 1440, window.innerHeight / 830, 1)
  document.documentElement.style.setProperty('--ui-scale', String(Math.max(0.7, Math.round(s * 1000) / 1000)))
}
applyScale()
window.addEventListener('resize', applyScale)

const ui = document.getElementById('ui')
ui.classList.add('wt-ui')
const region = (tag, id) => {
  const el = document.createElement(tag)
  el.id = id
  el.className = 'wt-region'
  ui.appendChild(el)
  return el
}

const cleanups = [
  mountDetailPanel(region('aside', 'wt-detail')),
  mountShipmentTracker(region('section', 'wt-tracker')),
  mountFleetPanel(region('section', 'wt-fleet')),
]

// ── reference frames: key → [frame, site, selection, tab, simMinutes, extra] ──
const FRAMES = {
  '01': ['01_wh01_overview', 'WH-01', null, 'docks', 580],
  '02': ['02_wh01_forklift_selected', 'WH-01', ['forklift', 'FL-01'], 'docks', 580],
  '04': ['04_wh01_pallet_panel_orbit', 'WH-01', ['pallet', 'PAL-1026'], 'docks', 581],
  '08': ['08_wh04_charger_panel', 'WH-04', ['charger', 'WH-04-C1'], 'docks', 582],
  '09': ['09_wh04_truck_panel', 'WH-04', ['truck', 'TRK-2205'], 'docks', 583],
  10: ['10_wh04_forklift_tab', 'WH-04', ['forklift', 'FL-10'], 'forklifts', 583],
  11: ['11_wh04_trucks_tab', 'WH-04', ['forklift', 'FL-12'], 'trucks', 584],
  12: ['12_wh04_truck_docking_path', 'WH-04', ['truck', 'TRK-2307'], 'trucks', 584, { follow: 'TRK-2307' }],
  15: ['15_wh02_overview', 'WH-02', null, 'trucks', 586],
  17: ['17_wh03_overview', 'WH-03', null, 'trucks', 588],
  23: ['23_wh05_overview', 'WH-05', null, 'trucks', 592],
}
const ref = document.getElementById('ref')
function showFrame(key) {
  const [frame, siteId, sel, tab, minutes, extra = {}] = FRAMES[key]
  ref.style.backgroundImage = `url('/docs/ref/${frame}.jpg')`
  store.setSite(siteId)
  store.set({ fleetTab: tab, simMinutes: minutes })
  if (sel) store.select({ type: sel[0], id: sel[1] })
  if (extra.follow) store.set({ followId: extra.follow })
  if (sel?.[0] !== 'truck') store.set({ trackedTruckId: db.site(siteId).featuredTruckId })
}

// ── live nudges (stand-in for the simulation) ──
let ticking = null
function tick() {
  let minutes = store.state.simMinutes
  minutes += 0.05
  if (Math.floor(minutes) !== Math.floor(store.state.simMinutes)) store.set({ simMinutes: Math.floor(minutes) })
  for (const f of db.list('forklift')) {
    if (f.status === 'charging') f.battery = Math.min(100, f.battery + 0.4)
    else if (f.status !== 'idle') {
      f.battery = Math.max(5, f.battery - 0.05)
      f.speedKmh = Math.max(0, Math.min(9, (f.speedKmh || 4) + (Math.random() - 0.5) * 1.6))
    }
  }
  for (const t of db.list('truck')) {
    if ((t.status === 'loading' || t.status === 'unloading') && Math.random() < 0.02 && t.progress.done < t.progress.total) {
      t.progress.done++
      t.cargo.pallets = Math.max(0, Math.min(t.cargo.capacity, t.cargo.pallets + (t.status === 'loading' ? 1 : -1)))
      t.etaMin = Math.max(1, t.etaMin - 1)
    }
    if (t.status === 'docking') t.distanceLeftM = Math.max(1, t.distanceLeftM - 0.4)
    if (t.status === 'en_route') t.distanceLeftM = Math.max(30, t.distanceLeftM - 4)
  }
  bus.emit('data:update', { simMinutes: minutes })
}
function toggleLive(on = !ticking) {
  clearInterval(ticking)
  ticking = on ? setInterval(tick, 250) : null
  renderBar()
}

// ── illustration gallery ──
const NAMES = ['box', 'container', 'helmet', 'tape', 'panel', 'chair', 'gloves', 'frozen', 'water',
  'site', 'network', 'truck', 'forklift', 'pallet', 'dock', 'charger', 'trackerTruck']
document.getElementById('gallery').innerHTML = [
  ...NAMES.map((n) => `<figure><div class="tile">${illustration(n, 96)}</div><figcaption>${n}</figcaption></figure>`),
  ...['#1f2a78', '#16a08b', '#f26b1d'].map((c) => `<figure><div class="tile">${illustration('trackerTruck', 96, { color: c })}</div><figcaption>${c}</figcaption></figure>`),
  ...['#1f2a78', '#16a08b', '#f26b1d'].map((c) => `<figure><div class="tile">${illustration('truck', 96, { color: c })}</div><figcaption>truck ${c}</figcaption></figure>`),
  `<figure><div class="tile">${illustration('site', 96, { color: '#58aee6' })}</div><figcaption>site cyan</figcaption></figure>`,
  `<figure><div class="tile">${illustration('pallet', 96, { kind: 'blue' })}</div><figcaption>pallet blue</figcaption></figure>`,
  ...NAMES.map((n) => `<figure><div class="tile small">${illustration(n, 44)}</div></figure>`),
].join('')

// ── debug toolbar ──
const SELECT = [
  ['WH-01', () => store.setSite('WH-01')],
  ['TRK-2205', () => store.select({ type: 'truck', id: 'TRK-2205' })],
  ['TRK-2307', () => store.select({ type: 'truck', id: 'TRK-2307' })],
  ['TRK-2481', () => store.select({ type: 'truck', id: 'TRK-2481' })],
  ['FL-01', () => store.select({ type: 'forklift', id: 'FL-01' })],
  ['FL-12', () => store.select({ type: 'forklift', id: 'FL-12' })],
  ['PAL-1026', () => store.select({ type: 'pallet', id: 'PAL-1026' })],
  ['PAL-1060', () => store.select({ type: 'pallet', id: 'PAL-1060' })],
  ['WH-04-IN2', () => store.select({ type: 'dock', id: 'WH-04-IN2' })],
  ['WH-04-C1', () => store.select({ type: 'charger', id: 'WH-04-C1' })],
  ['ALL', () => store.setSite('ALL')],
  ['✕', () => store.select(null)],
]
const bar = document.getElementById('devbar')
function renderBar() {
  const { fleetTab } = store.state
  bar.innerHTML = [
    ...SELECT.map(([label], i) => `<button data-sel="${i}">${label}</button>`),
    '<span class="sep"></span>',
    ...['docks', 'forklifts', 'trucks'].map((t) => `<button data-tab="${t}" class="${t === fleetTab ? 'on' : ''}">${t}</button>`),
    '<span class="sep"></span>',
    `<button data-act="live" class="${ticking ? 'on' : ''}">live</button>`,
    '<button data-act="overlay">overlay</button>',
    '<button data-act="gallery">gallery</button>',
    '<span class="sep"></span>',
    ...Object.keys(FRAMES).map((k) => `<button data-frame="${k}">${k}</button>`),
  ].join('')
}
bar.addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (!b) return
  if (b.dataset.sel) SELECT[+b.dataset.sel][1]()
  else if (b.dataset.tab) store.set({ fleetTab: b.dataset.tab })
  else if (b.dataset.frame) showFrame(b.dataset.frame)
  else if (b.dataset.act === 'live') toggleLive()
  else if (b.dataset.act === 'overlay') cycleOverlay()
  else if (b.dataset.act === 'gallery') document.body.classList.toggle('show-gallery')
})
cleanups.push(store.subscribe((s, p, changed) => { if (changed.includes('fleetTab')) renderBar() }))
renderBar()
// ?frame=NN applies a reference frame preset on first load (not again on hot updates)
if (FRAMES[params.get('frame')] && !import.meta.hot?.data.booted) showFrame(params.get('frame'))
// ?sel=type:id (e.g. dock:WH-04-IN2) selects an entity on first load; ?site=ALL switches site
if (!import.meta.hot?.data.booted) {
  if (params.get('site')) store.setSite(params.get('site'))
  const [type, id] = params.get('sel')?.split(':') ?? []
  if (type && id) store.select({ type, id })
  // ?then=type:id@ms selects another entity later (shoot mid cross-fade with a virtual-time budget)
  const [, thenType, thenId, thenMs] = params.get('then')?.match(/^(\w+):([\w-]+)@(\d+)$/) ?? []
  if (thenType) setTimeout(() => store.select({ type: thenType, id: thenId }), +thenMs)
}

const MODES = ['', 'ui-half', 'ui-diff']
let mode = 0
function cycleOverlay() {
  if (MODES[mode]) document.body.classList.remove(MODES[mode])
  mode = (mode + 1) % MODES.length
  if (MODES[mode]) document.body.classList.add(MODES[mode])
}

function onKey(e) {
  if (e.key === 'o') cycleOverlay()
  else if (e.key === 'h') document.body.classList.toggle('ui-hidden')
  else if (e.key === 'b') document.body.classList.toggle('ref-off')
  else if (e.key === 'd') document.body.classList.toggle('bar-off')
  else if (e.key === 'g') document.body.classList.toggle('show-gallery')
  else if (e.key === 't') toggleLive()
}
document.addEventListener('keydown', onKey)

// other modules are still being written: keep vite's error overlay (for src/main.js) off this harness
const dropOverlay = () => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove())
const overlayObserver = new MutationObserver(dropOverlay)
overlayObserver.observe(document.body, { childList: true })
dropOverlay()

cleanups.push(bus.on('camera:locate', (p) => console.info('[bus] camera:locate', p)))
cleanups.push(bus.on('camera:cmd', (p) => console.info('[bus] camera:cmd', p)))

function crop(x, y) {
  cropAt = x == null ? null : [x, y]
  applyScale()
}

/**
 * Typography calibration: [[selector, targetWidthPx, index?]] → measured text width vs the width
 * measured on the reference frame (at 1440 scale) and the font-size that would match it.
 */
function cal(list, root = document.querySelector('.dp__layer:not(.dp__layer--leaving)')) {
  return list.map(([sel, target, i = 0]) => {
    const el = (root ?? document).querySelectorAll(sel)[i] ?? document.querySelectorAll(sel)[i]
    if (!el) return `${sel}: missing`
    const r = document.createRange()
    r.selectNodeContents(el)
    const w = r.getBoundingClientRect().width
    const fs = parseFloat(getComputedStyle(el).fontSize)
    return `${sel}#${i} "${el.textContent.trim().slice(0, 24)}" ${w.toFixed(1)} / ${target} → fs ${fs} ⇒ ${(fs * target / w).toFixed(2)}`
  })
}

window.__dev = { store, bus, db, showFrame, toggleLive, crop, cal }

// other agents keep editing shared modules: re-run this harness in place instead of letting vite
// reload the whole page (store/db state survives; the panels are mounted afresh)
if (import.meta.hot) {
  import.meta.hot.accept()
  // edits to the 3D modules (not used here) make vite reload every page; ignore those. Retargeting
  // the payload path to another page makes the vite client skip its location.reload().
  import.meta.hot.on('vite:beforeFullReload', (p) => {
    const relevant = /[\\/](src[\\/](data|state)[\\/]|src[\\/]ui[\\/](panels|illustrations|detailPanel|shipmentTracker|fleetPanel|icons|styles)\.|dev[\\/]ui-panels)/
      .test(p.triggeredBy ?? '')
    if (p.path === '*' && p.triggeredBy && !relevant) p.path = '/__other-page__.html'
  })
  import.meta.hot.dispose((data) => {
    data.booted = true
    clearInterval(ticking)
    cleanups.forEach((off) => off())
    document.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', applyScale)
    overlayObserver.disconnect()
    ui.replaceChildren()
  })
}
