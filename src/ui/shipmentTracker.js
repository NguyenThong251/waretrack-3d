// Shipment Tracking card, bottom-left (SPEC §2.5). Follows store.trackedTruckId: a 5-step stepper
// (done / current / todo) plus an inner card with the truck drawing, shipment id, destination,
// status chip and a foot line. The chevron selects the truck.
import './panels.css'
import { db } from '../data/db.js'
import { store, bus } from '../state/store.js'
import { shipmentTracking } from '../data/selectors.js'
import { illustration } from './illustrations.js'
import { morph, esc, ico } from './detailPanel.js'

const STEP_ICON = { clipboard: 'clipboard', box: 'box', package: 'package', truck: 'truck', check: 'check' }

function stepHtml(step) {
  const big = step.state === 'current'
  const glyph = ico(STEP_ICON[step.icon] ?? 'check', big ? 14 : 12, step.icon === 'truck' ? {} : { sw: 1.9 })
  return `<li class="st-step st-step--${step.state}" data-key="${esc(step.key)}">
    <span class="st-step__dot">${glyph}</span>
    <span class="st-step__label">${esc(step.label)}</span>
    <span class="st-step__sub">${esc(step.sub)}</span>
  </li>`
}

function trackerHtml(model) {
  if (!model) {
    return `<div class="st__main">
      <div class="st__head"><span class="st__icon">${ico('truck', 20)}</span><span class="st__title">Shipment Tracking</span></div>
      <div class="st__empty">Select a truck to follow its shipment.</div>
    </div>`
  }
  const { card, carrier, truck } = model
  return `<div class="st__main">
      <div class="st__head">
        <span class="st__icon">${ico('truck', 20)}</span>
        <span class="st__title">Shipment Tracking</span>
        <span class="st__meta">${esc(model.header)}</span>
      </div>
      <ol class="st-steps">${model.steps.map(stepHtml).join('')}</ol>
    </div>
    <div class="st-card" data-key="${esc(truck.id)}" data-truck="${esc(truck.id)}" role="button" tabindex="0" title="Show ${esc(truck.id)}">
      <span class="st-card__illu">${illustration('trackerTruck', 68, { color: carrier?.color })}</span>
      <span class="st-card__text">
        <span class="st-card__id">${esc(card.id)}</span>
        <span class="st-card__to">${esc(card.to)}</span>
        <span class="chip chip--${card.tone} st-card__chip">${esc(card.chip)}</span>
        <span class="st-card__foot">${esc(card.foot)}</span>
      </span>
      <span class="st-card__chev">${ico('chevronRight', 16, { sw: 2 })}</span>
    </div>`
}

export function mountShipmentTracker(el) {
  const root = document.createElement('div')
  root.className = 'card st'
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', 'Shipment Tracking')
  el.appendChild(root)

  let shownTruck = null

  function render() {
    const id = store.state.trackedTruckId
    const model = db.get('truck', id) ? shipmentTracking(id) : null
    const html = trackerHtml(model)
    if (shownTruck !== null && shownTruck !== id) {
      // a different shipment: replay a quick fade on the content
      root.classList.remove('st--swap')
      void root.offsetWidth
      root.classList.add('st--swap')
    }
    shownTruck = id
    morph(root, html)
  }

  root.addEventListener('click', (e) => {
    const target = e.target.closest('[data-truck]')
    if (target) store.select({ type: 'truck', id: target.dataset.truck })
  })
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-truck]')) {
      e.preventDefault()
      e.target.click()
    }
  })

  const offStore = store.subscribe((state, prev, changed) => {
    if (changed.includes('trackedTruckId') || changed.includes('simMinutes')) render()
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
