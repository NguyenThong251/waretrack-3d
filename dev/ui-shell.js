// Dev harness for the ui-shell components (top bar, KPI cards, map controls) laid over a reference
// frame of the video, so alignment / typography / colours can be compared 1:1.
// Open http://localhost:5173/dev/ui-shell.html — at 1248×718 the overlay matches the frame scale.
// Keys: o overlay mode · h hide UI · b frame on/off · 1–4 frame + site · t tick the clock.
import '../src/ui/styles.css'
import { store, bus } from '../src/state/store.js'
import { mountTopbar } from '../src/ui/topbar.js'
import { mountKpis } from '../src/ui/kpis.js'
import { mountMapControls } from '../src/ui/mapControls.js'

const params = new URLSearchParams(location.search)
const ui = document.getElementById('ui')

if (params.get('full') === '1') {
  // whole overlay incl. the ui-panels modules, through the real entry point
  const { mountUI } = await import('../src/ui/index.js')
  mountUI(ui)
} else {
  // same scaling rule as src/ui/index.js (not imported here: index.js pulls in the panel modules)
  const applyScale = () => {
    const s = Math.min(window.innerWidth / 1440, window.innerHeight / 830, 1)
    document.documentElement.style.setProperty('--ui-scale', String(Math.max(0.7, Math.round(s * 1000) / 1000)))
  }
  applyScale()
  window.addEventListener('resize', applyScale)

  const region = (tag, id) => {
    const el = document.createElement(tag)
    el.id = id
    el.className = 'wt-region'
    ui.appendChild(el)
    return el
  }
  mountTopbar(region('header', 'wt-topbar'))
  mountKpis(region('div', 'wt-kpis'))
  mountMapControls(region('div', 'wt-map-controls'))
}

// ── reference frames: key → [frame, site, clock] ──
const FRAMES = {
  1: ['01_wh01_overview', 'WH-01', 580],
  2: ['14_site_dropdown', 'WH-04', 586],
  3: ['07_wh04_dock_hover', 'WH-04', 582],
  4: ['17_wh03_overview', 'WH-03', 588],
}
const ref = document.getElementById('ref')
function showFrame(key) {
  const [frame, siteId, minutes] = FRAMES[key]
  ref.style.backgroundImage = `url('/docs/ref/${frame}.jpg')`
  store.setSite(siteId)
  store.set({ simMinutes: minutes, menu: key === '2' ? 'site' : null })
}

const MODES = ['', 'ui-half', 'ui-diff']
let mode = 0
let ticking = null

document.addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return
  const body = document.body
  if (e.key === 'o') {
    if (MODES[mode]) body.classList.remove(MODES[mode])
    mode = (mode + 1) % MODES.length
    if (MODES[mode]) body.classList.add(MODES[mode])
  } else if (e.key === 'h') body.classList.toggle('ui-hidden')
  else if (e.key === 'b') body.classList.toggle('ref-off')
  else if (e.key === '?') body.classList.toggle('hint-off')
  else if (FRAMES[e.key]) showFrame(e.key)
  else if (e.key === 't') {
    if (ticking) { clearInterval(ticking); ticking = null; return }
    // 1 sim-minute ≈ 5 s like the video; data:update at 4 Hz; store only on whole minutes
    let minutes = store.state.simMinutes
    ticking = setInterval(() => {
      minutes += 0.05
      if (Math.floor(minutes) !== Math.floor(store.state.simMinutes)) store.set({ simMinutes: Math.floor(minutes) })
      bus.emit('data:update', { simMinutes: minutes })
    }, 250)
  }
})

// URL params for headless screenshots: ?frame=2  &menu=notifications  &q=trk  &full=1 (all panels)
if (FRAMES[params.get('frame')]) showFrame(params.get('frame'))
if (params.get('q')) store.set({ searchQuery: params.get('q'), menu: 'search' })
if (params.get('menu')) store.set({ menu: params.get('menu') })
if (params.get('ui') === 'half') document.body.classList.add('ui-half')
if (params.get('hint') === '0') document.body.classList.add('hint-off')
if (params.get('hover')) forceHover(params.get('hover'))

/** Headless screenshots can't hover: mirror every `:hover` rule as `.dev-hover` and tag the target. */
function forceHover(selector) {
  const sheet = new CSSStyleSheet()
  for (const s of document.styleSheets) {
    let rules
    try { rules = s.cssRules } catch { continue }
    for (const r of rules) {
      if (r.selectorText?.includes(':hover')) sheet.insertRule(`${r.selectorText.replaceAll(':hover', '.dev-hover')} { ${r.style.cssText} }`, sheet.cssRules.length)
    }
  }
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  document.querySelectorAll(selector).forEach((el) => el.classList.add('dev-hover'))
}

// log bus traffic so map-control / search wiring can be checked from the console
bus.on('camera:cmd', (p) => console.info('[bus] camera:cmd', p))
bus.on('camera:locate', (p) => console.info('[bus] camera:locate', p))

window.__dev = { store, bus, showFrame }
