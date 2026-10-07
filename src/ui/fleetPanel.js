// Fleet panel, bottom-right (SPEC §2.6): segmented tabs Docks / Forklifts / Trucks with live
// counters, then the rows of the current site (≈ 4 visible, scrolls beyond). Clicking a row
// selects that entity; the selected entity's row is highlighted.
import './panels.css'
import { db } from '../data/db.js'
import { store, bus } from '../state/store.js'
import { fleetRows, fleetCounts } from '../data/selectors.js'
import { morph, esc, ico } from './detailPanel.js'

const TABS = [
  ['docks', 'Docks'],
  ['forklifts', 'Forklifts'],
  ['trucks', 'Trucks'],
]

// blue "dock board" glyph of the panel header (rounded tile, lighter top band, white rows)
const HEAD_GLYPH = `<svg width="19" height="16" viewBox="0 0 19 16" aria-hidden="true">
  <defs><linearGradient id="fp-glyph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4b74f4"/><stop offset="1" stop-color="#2a54e3"/></linearGradient></defs>
  <rect x=".5" y=".5" width="18" height="15" rx="3.2" fill="url(#fp-glyph)"/>
  <rect x=".5" y=".5" width="18" height="4.6" rx="2.4" fill="#fff" opacity=".3"/>
  <path d="M4.2 8.6h10.6M4.2 11.6h10.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".85"/>
</svg>`

function tabsHtml(tab, counts) {
  return TABS.map(([key, label]) => `<button type="button" class="fp-seg__btn${key === tab ? ' is-active' : ''}" data-tab="${key}" role="tab" aria-selected="${key === tab}">${label} <span class="fp-seg__n">${esc(counts[key])}</span></button>`).join('')
}

function rowHtml(r, sel) {
  const selected = sel && sel.type === r.type && sel.id === r.id
  const text = r.muted
    ? `<span class="fp-row__muted">${esc(r.text)}</span>`
    : `${r.dotColor ? `<i class="dot fp-row__dot" style="background:${esc(r.dotColor)}"></i>` : ''}<span class="fp-row__txt">${esc(r.text)}</span>`
  const meta = r.bar
    ? `<div class="bar"><div class="bar__fill bar__fill--green" style="width:${((r.bar.value / Math.max(1, r.bar.max)) * 100).toFixed(1)}%"></div></div><span>${esc(r.right)}</span>`
    : `<span class="fp-row__right">${esc(r.right)}</span>`
  return `<div class="fp-row${selected ? ' is-selected' : ''}" data-key="${esc(r.type)}:${esc(r.id)}" data-type="${esc(r.type)}" data-id="${esc(r.id)}" role="button" tabindex="0">
    <span class="fp-row__title"><b>${esc(r.title)}</b><small>${esc(r.titleSub)}</small></span>
    <span class="fp-row__text">${text}</span>
    <span class="fp-row__chip"><span class="chip chip--${r.tone}">${esc(r.chip)}</span></span>
    <span class="fp-row__meta${r.bar ? ' fp-row__meta--bar' : ''}">${meta}</span>
    <span class="fp-row__chev">${ico('chevronRight', 13, { sw: 1.9 })}</span>
  </div>`
}

export function mountFleetPanel(el) {
  const root = document.createElement('div')
  root.className = 'card fp'
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', 'Fleet')
  root.innerHTML = `<div class="fp__head">
      <span class="fp__icon">${HEAD_GLYPH}</span>
      <div class="fp-seg" role="tablist"></div>
      <span class="fp__site"></span>
    </div>
    <div class="fp__rows"></div>`
  el.appendChild(root)
  const seg = root.querySelector('.fp-seg')
  const site = root.querySelector('.fp__site')
  const list = root.querySelector('.fp__rows')

  let shown = ''

  function render() {
    const { siteId, fleetTab, selection } = store.state
    const tab = TABS.some(([k]) => k === fleetTab) ? fleetTab : 'docks'
    morph(seg, tabsHtml(tab, fleetCounts(siteId)))
    const name = siteId === 'ALL' ? 'All sites' : db.site(siteId)?.name ?? siteId
    if (site.textContent !== name) site.textContent = name
    list.className = `fp__rows fp__rows--${tab}`
    const rows = fleetRows(siteId, tab)
    morph(list, rows.length
      ? rows.map((r) => rowHtml(r, selection)).join('')
      : '<div class="fp__empty">Nothing to show for this site.</div>')
    const key = `${siteId}|${tab}`
    if (shown !== key) {
      if (shown) {
        list.scrollTop = 0
        list.classList.remove('fp__rows--swap')
        void list.offsetWidth
        list.classList.add('fp__rows--swap')
      }
      shown = key
    }
  }

  root.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-tab]')
    if (tabBtn) return store.set({ fleetTab: tabBtn.dataset.tab })
    const row = e.target.closest('.fp-row')
    if (row) store.select({ type: row.dataset.type, id: row.dataset.id })
    return undefined
  })
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.fp-row')) {
      e.preventDefault()
      e.target.click()
    }
  })

  const offStore = store.subscribe((state, prev, changed) => {
    if (changed.some((k) => k === 'siteId' || k === 'fleetTab' || k === 'selection')) render()
  })
  const offBus = bus.on('data:update', render)
  render()

  /** Unmount: stop listening and remove the card. */
  return () => {
    offStore()
    offBus()
    root.remove()
  }
}
