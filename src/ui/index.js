// Overlay entry point: builds the fixed UI regions and mounts every UI module into them.
// Layout + tokens live in styles.css (SPEC §2). The overlay root has pointer-events:none;
// only the cards inside the regions catch the mouse, so the 3D view stays draggable.
import { mountTopbar } from './topbar.js'
import { mountKpis } from './kpis.js'
import { mountMapControls } from './mapControls.js'
import { mountDetailPanel } from './detailPanel.js'
import { mountShipmentTracker } from './shipmentTracker.js'
import { mountFleetPanel } from './fleetPanel.js'

/** Design viewport of the overlay (SPEC §2); smaller windows scale the whole overlay down. */
export const DESIGN_WIDTH = 1440
export const DESIGN_HEIGHT = 830
const MIN_SCALE = 0.7

const REGIONS = [
  ['header', 'wt-topbar'],
  ['div', 'wt-kpis'],
  ['div', 'wt-map-controls'],
  ['aside', 'wt-detail'],
  ['section', 'wt-tracker'],
  ['section', 'wt-fleet'],
]

/** Scale factor so the 1440×830 layout fits the window (never upscales). */
export function uiScale(width = window.innerWidth, height = window.innerHeight) {
  const s = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT, 1)
  return Math.max(MIN_SCALE, Math.round(s * 1000) / 1000)
}

/** Keeps `--ui-scale` (used as `zoom` on #ui) in sync with the window size. Returns a disposer. */
export function bindUiScale(target = document.documentElement) {
  const apply = () => target.style.setProperty('--ui-scale', String(uiScale()))
  apply()
  window.addEventListener('resize', apply)
  return () => window.removeEventListener('resize', apply)
}

/** Create the region containers inside `root`; returns { [id]: element }. */
export function createRegions(root, ids = REGIONS.map(([, id]) => id)) {
  const els = {}
  for (const [tag, id] of REGIONS) {
    if (!ids.includes(id)) continue
    const el = root.querySelector(`#${id}`) ?? document.createElement(tag)
    el.id = id
    el.classList.add('wt-region')
    root.appendChild(el)
    els[id] = el
  }
  return els
}

export function mountUI(root) {
  root.classList.add('wt-ui')
  bindUiScale()
  const r = createRegions(root)
  mountTopbar(r['wt-topbar'])
  mountKpis(r['wt-kpis'])
  mountMapControls(r['wt-map-controls'])
  mountDetailPanel(r['wt-detail'])
  mountShipmentTracker(r['wt-tracker'])
  mountFleetPanel(r['wt-fleet'])
  return r
}
