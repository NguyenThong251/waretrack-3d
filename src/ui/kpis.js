// KPI cards under the top bar (SPEC §2.2): Stock on hand · Trucks on site · On-time delivery.
// Cards are built once; values patch in place on site change and on every simulation tick.
import { store, bus } from '../state/store.js'
import { kpis } from '../data/selectors.js'
import { fmtNum, fmtPct } from '../data/format.js'
import { icon } from './icons.js'

// selectors.kpis() icon key → glyph drawn in the tile (the video uses solid, shaded glyphs)
const GLYPH = {
  cube: ['cubeSolid', 26],
  truck: ['truck', 28],
  clock: ['clockSolid', 26],
}

const formatValue = (k) => (k.format === 'pct' ? fmtPct(k.value) : fmtNum(k.value))

function cardTemplate(k) {
  const [glyph, size] = GLYPH[k.icon] ?? ['cube', 22]
  return `
  <div class="card kpi" data-kpi="${k.key}">
    <span class="kpi__tile"><span class="kpi__glyph kpi__glyph--${k.icon}">${icon(glyph, size)}</span></span>
    <div class="kpi__body">
      <div class="kpi__title"></div>
      <div class="kpi__row">
        <span class="kpi__value"></span>
        <span class="kpi__delta"><span class="kpi__arrow">${icon('arrowUp', 10, { sw: 1.7 })}</span><span class="kpi__delta-text"></span></span>
      </div>
      <div class="kpi__sub"></div>
    </div>
  </div>`
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text
}

export function mountKpis(el) {
  el.setAttribute('aria-label', 'Key metrics')
  el.innerHTML = kpis(store.state.siteId).map(cardTemplate).join('')
  const cards = new Map([...el.querySelectorAll('[data-kpi]')].map((card) => [card.dataset.kpi, {
    title: card.querySelector('.kpi__title'),
    value: card.querySelector('.kpi__value'),
    delta: card.querySelector('.kpi__delta'),
    deltaText: card.querySelector('.kpi__delta-text'),
    sub: card.querySelector('.kpi__sub'),
  }]))

  function render({ swap = false } = {}) {
    for (const k of kpis(store.state.siteId)) {
      const c = cards.get(k.key)
      if (!c) continue
      setText(c.title, k.title)
      setText(c.value, formatValue(k))
      setText(c.deltaText, k.delta)
      c.delta.hidden = !k.delta || /^[+-]?0(\.0+)?%?$/.test(k.delta)
      setText(c.sub, k.sub)
      if (swap) {
        // replay the small "value swap" animation when the site changes
        c.value.classList.remove('is-swapping')
        void c.value.offsetWidth
        c.value.classList.add('is-swapping')
      }
    }
  }

  render()
  const unsub = store.subscribe((state, prev, changed) => {
    if (changed.includes('siteId')) render({ swap: true })
  })
  const offData = bus.on('data:update', () => render())

  return {
    destroy() {
      unsub()
      offData()
      el.innerHTML = ''
    },
  }
}
