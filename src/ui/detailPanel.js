// Right-hand detail panel (SPEC §2.4). Shows the selected entity, or the current site card
// (or the network overview when siteId === 'ALL'). A selection change cross-fades to a new layer
// while the card height eases; live data updates patch the current layer in place.
//
// Also exports the small HTML helpers shared by the other ui-panels modules (morph, esc, ico).
import './panels.css'
import { db } from '../data/db.js'
import { store, bus } from '../state/store.js'
import { siteStats, siteActivityLine, dockName } from '../data/selectors.js'
import { fmtTime, fmtNum, fmtKmh, fmtMin, statusMeta, TYPE_LABEL } from '../data/format.js'
import { illustration, skuIllustration } from './illustrations.js'
import { icon } from './icons.js'

const FADE_MS = 240
// illustrations are drawn with some air around them; render them a bit larger than their slot
const TILE_ILLU = 52
const ROW_ILLU = 34

// ───────────────────────────── shared helpers ─────────────────────────────

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c])

/** Icon markup from icons.js (empty string if the name is unknown). */
export function ico(name, size = 16, attrs) {
  try {
    return icon(name, size, attrs) ?? ''
  } catch {
    return ''
  }
}

/**
 * Patch `el` so its children match `html`, touching only what changed. Keeps nodes (and their
 * CSS transitions, hover and scroll state) alive across 4 Hz data refreshes. Elements with a
 * different tag or `data-key` are replaced instead of patched.
 */
export function morph(el, html) {
  if (el.__html === html) return
  el.__html = html
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  patchChildren(el, tpl.content)
}

function patchChildren(cur, next) {
  const a = [...cur.childNodes]
  const b = [...next.childNodes]
  b.forEach((n, i) => {
    const c = a[i]
    if (!c) return cur.appendChild(n)
    if (c.nodeType !== n.nodeType || c.nodeName !== n.nodeName
      || (c.nodeType === 1 && c.getAttribute('data-key') !== n.getAttribute('data-key'))) {
      return cur.replaceChild(n, c)
    }
    if (c.nodeType !== 1) {
      if (c.nodeValue !== n.nodeValue) c.nodeValue = n.nodeValue
      return undefined
    }
    patchAttrs(c, n)
    patchChildren(c, n)
    return undefined
  })
  for (let i = b.length; i < a.length; i++) a[i].remove()
}

function patchAttrs(c, n) {
  for (const { name } of [...c.attributes]) if (!n.hasAttribute(name)) c.removeAttribute(name)
  for (const { name, value } of [...n.attributes]) if (c.getAttribute(name) !== value) c.setAttribute(name, value)
}

/** Clickable entity reference (selects it). */
export const link = (type, id, text = id) =>
  `<a class="link wt-link" role="button" tabindex="0" data-type="${esc(type)}" data-id="${esc(id)}">${esc(text)}</a>`

const pct = (v, max) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0)
const bar = (value, tone) =>
  `<div class="bar"><div class="bar__fill bar__fill--${tone}" style="width:${value.toFixed(1)}%"></div></div>`

const CARRIER_BLUE = '#2f5bea'

// ───────────────────────────── building blocks ─────────────────────────────

// the video's locate glyph: a small hollow ring with four long ticks (icons.js' crosshair has a
// big ring and a centre dot)
const LOCATE = '<svg class="wt-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.6"/><path d="M12 2.6v5.8M12 15.6v5.8M2.6 12h5.8M15.6 12h5.8"/></svg>'

function button(act, iconName, label, active = false) {
  const cls = `icon-btn dp-btn${active ? ' icon-btn--active' : ''}`
  const glyph = iconName === 'locate' ? LOCATE : ico(iconName, 15, { sw: 1.75 })
  return `<button type="button" class="${cls}" data-act="${act}" title="${label}" aria-label="${label}"${active ? ' aria-pressed="true"' : ''}>${glyph}</button>`
}

function header({ illu, eyebrow, name, sub, buttons }) {
  return `<header class="dp-head">
    <div class="dp-head__tile">${illu}</div>
    <div class="dp-head__text">
      <div class="dp-eyebrow">${esc(eyebrow)}</div>
      <div class="dp-name">${esc(name)}</div>
      <div class="dp-sub">${esc(sub)}</div>
    </div>
    <div class="dp-head__btns">${buttons.join('')}</div>
  </header>
  <div class="dp-divider"></div>`
}

function status(chip, tone, text, extraCls = '') {
  return `<div class="dp-status">
    <span class="chip chip--${tone} dp-chip${extraCls}">${esc(chip)}</span>
    <span class="dp-status__text">${esc(text)}</span>
  </div>`
}

function progress(value, tone, label) {
  return `<div class="dp-progress">${bar(value, tone)}<span class="dp-progress__label">${esc(label)}</span></div>`
}

/** rows: [label, valueHtml][] — values are trusted HTML (escape plain text with esc()). */
function rows(list) {
  return `<div class="dp-rows">${list.map(([k, v]) =>
    `<div class="dp-row"><span class="dp-row__k">${esc(k)}</span><span class="dp-row__v">${v}</span></div>`).join('')}</div>`
}

function tile(label, valueHtml, barHtml = '') {
  return `<div class="dp-tile"><div class="dp-tile__k">${esc(label)}</div><div class="dp-tile__v">${valueHtml}</div>${barHtml}</div>`
}

function siteTiles(s) {
  return `<div class="dp-tiles">
    ${tile('Stock on hand', `<b>${fmtNum(s.stock)}</b> / ${fmtNum(s.capacity)}`, bar(pct(s.stock, s.capacity), 'blue'))}
    ${tile('Truck bays', `<b>${s.docksBusy}</b> / ${s.docksTotal} busy`, bar(pct(s.docksBusy, s.docksTotal), 'green'))}
    ${tile('Outbound today', `<b>${fmtNum(s.outboundToday)}</b> trucks`)}
    ${tile('Put-aways today', `<b>${fmtNum(s.putawaysToday)}</b> pallets`)}
  </div>`
}

const section = (title, right) =>
  `<div class="dp-sec"><span class="dp-sec__t">${esc(title)}</span><span class="dp-sec__r">${esc(right)}</span></div>`

const siteName = (id) => db.site(id)?.name ?? id ?? '—'
// every site card in the video uses the same blue depot thumbnail (even WH-03's cyan badge)
const siteIllu = () => illustration('site', TILE_ILLU)

// ───────────────────────────── variants ─────────────────────────────

function siteCard(site) {
  const s = siteStats(site.id)
  const forklifts = db.list('forklift', site.id)
  const fl = forklifts.find((f) => ['loading', 'unloading', 'moving'].includes(f.status)) ?? forklifts[0]
  const inv = (site.inventory ?? []).map((item) => {
    const sku = db.sku(item.sku)
    const m = statusMeta('inventory', item.status)
    return `<div class="dp-inv__row">
      <span class="dp-inv__ico">${illustration(skuIllustration(sku), ROW_ILLU)}</span>
      <span class="dp-inv__name">${esc(sku?.name ?? item.sku)}</span>
      <span class="dp-inv__qty">${fmtNum(item.qty)}</span>
      <span class="chip chip--${m.tone} dp-inv__chip">${esc(m.chip)}</span>
    </div>`
  }).join('')
  const flRow = fl ? `<div class="dp-fl" data-type="forklift" data-id="${esc(fl.id)}" role="button" tabindex="0">
      <b class="dp-fl__id">${esc(fl.id)}</b>
      <span class="dp-fl__task">${esc(fl.task)}</span>
      ${bar(fl.battery, fl.battery < 25 ? 'orange' : 'green')}
      <span class="dp-fl__pct">${Math.round(fl.battery)}%</span>
    </div>` : ''
  const buttons = [button('locate', 'locate', 'Locate on map')]
  // the video shows an extra (inert) layers toggle on the automated DC card
  if (site.variant === 'robotics') buttons.unshift(button('layers', 'layers', 'Map layers'))
  return header({
    illu: siteIllu(site),
    eyebrow: `${site.kind} · ${site.id}`,
    name: site.name,
    sub: site.address,
    buttons,
  })
    + status(site.status, statusMeta('site', site.status).tone, siteActivityLine(site.id))
    + siteTiles(s)
    + section('Inventory', 'units')
    + `<div class="dp-inv">${inv}</div>`
    + section('Forklift fleet', `${s.forkliftsWorking}/${s.forkliftsTotal} working`)
    + flRow
}

function networkCard() {
  const s = siteStats('ALL')
  const sites = db.sites()
  const list = sites.map((site) => {
    const st = siteStats(site.id)
    const full = Math.round(st.fullPct)
    return `<div class="dp-site" data-site="${esc(site.id)}" role="button" tabindex="0">
      <span class="site-badge dp-site__badge${site.badgeTone === 'cyan' ? ' site-badge--cyan' : ''}">${esc(site.id)}</span>
      <span class="dp-site__name">${esc(site.name)}<small>${st.docked}/${st.docksTotal} docked · ${st.inbound} inbound</small></span>
      ${bar(st.fullPct, 'blue')}
      <span class="dp-site__pct">${full}%</span>
    </div>`
  }).join('')
  return header({
    illu: illustration('network', TILE_ILLU),
    eyebrow: `NETWORK · ${sites.length} SITES`,
    name: 'Network overview',
    sub: `${sites.length} sites · ${s.docked} docked · ${s.inbound} inbound`,
    buttons: [button('home', 'locate', 'Show all sites')],
  })
    + status('Operational', 'green', siteActivityLine('ALL'))
    + siteTiles(s)
    + section('Sites', 'fill')
    + `<div class="dp-sites">${list}</div>`
}

function forkliftCard(f) {
  const m = statusMeta('forklift', f.status)
  const following = store.state.followId === f.id
  let carrying = 'Empty'
  if (f.carryingPalletId) {
    const pal = db.get('pallet', f.carryingPalletId)
    carrying = `${link('pallet', f.carryingPalletId)}${pal ? ` · ${esc(db.sku(pal.sku)?.name ?? pal.sku)}` : ''}`
  } else if (f.carryingKind) {
    carrying = `Pallet · ${esc(f.carryingKind)}`
  }
  const charger = db.get('charger', f.chargerId)
  return header({
    illu: illustration('forklift', TILE_ILLU),
    eyebrow: `${TYPE_LABEL.forklift} · ${f.siteId}`,
    name: f.id,
    sub: `${f.operator} · ${f.model}`,
    buttons: [button('locate', 'locate', 'Locate on map'), button('follow', 'arrowUpRight', following ? 'Stop following' : 'Follow', following), button('close', 'close', 'Close')],
  })
    + status(m.long ?? m.chip, m.tone, f.task)
    + progress(f.battery, f.battery < 25 ? 'orange' : 'green', `Battery ${Math.round(f.battery)}%`)
    + rows([
      ['Carrying', carrying],
      ['Moves today', esc(fmtNum(f.movesToday ?? 0))],
      ['Speed', `${(f.speedKmh ?? 0).toFixed(1)} km/h`],
      ['Charger', charger ? link('charger', charger.id, charger.name) : '—'],
      ['Site', esc(siteName(f.siteId))],
    ])
}

function palletWhere(p) {
  if (p.status === 'moving' && p.carriedBy) return { status: `On forks of ${p.carriedBy}`, location: `Forklift ${p.carriedBy}` }
  if (p.status === 'loaded') return { status: `Loaded · ${p.siteId}`, location: `${p.siteId} · On truck` }
  const where = `${p.siteId} · Yard slot ${p.slot}`
  return { status: where, location: where }
}

function palletCard(p) {
  const sku = db.sku(p.sku)
  const m = statusMeta('pallet', p.status)
  const where = palletWhere(p)
  return header({
    illu: illustration(skuIllustration(sku), TILE_ILLU),
    eyebrow: `${TYPE_LABEL.pallet} · ${(sku?.category ?? '').toUpperCase()}`,
    name: sku?.name ?? p.id,
    sub: `${p.id} · ${p.sku}`,
    buttons: [button('locate', 'locate', 'Locate on map'), button('close', 'close', 'Close')],
  })
    + status(m.chip, m.tone, where.status)
    + rows([
      ['Quantity', `${fmtNum(p.quantity)} units`],
      ['Gross weight', `${fmtNum(p.grossKg)} kg`],
      ['Location', esc(where.location)],
      ['Lot', esc(p.lot)],
      ['Received', esc(p.received)],
      ['Site', esc(siteName(p.siteId))],
    ])
}

function dockStatusText(d, truck) {
  if (d.status === 'booked') {
    const t = db.get('truck', d.bookedTruckId)
    const mins = d.bookedInMin ?? t?.etaMin ?? 0
    return `${d.bookedTruckId} due in ${fmtMin(mins)}`
  }
  if (d.status === 'available' || !truck) return 'Ready for next truck'
  if (d.status === 'docking') return `${truck.id} reversing in`
  return `${truck.id} · ${truck.progress.done}/${truck.progress.total} pallets`
}

function dockCard(d) {
  const m = statusMeta('dock', d.status)
  const truck = db.get('truck', d.truckId ?? d.bookedTruckId)
  return header({
    illu: illustration('dock', TILE_ILLU),
    eyebrow: `${TYPE_LABEL.dock} · ${d.siteId}`,
    name: d.name,
    sub: d.kind,
    buttons: [button('locate', 'locate', 'Locate on map'), button('close', 'close', 'Close')],
  })
    + status(m.chip, m.tone, dockStatusText(d, d.truckId ? truck : null))
    + rows([
      ['Truck', truck ? `${link('truck', truck.id)} · ${esc(db.carrier(truck.carrier)?.name ?? '')}` : '—'],
      ['Rear doors', esc(d.rearDoors ?? '—')],
      ['Trucks today', esc(fmtNum(d.trucksToday ?? 0))],
      ['Site', esc(siteName(d.siteId))],
    ])
}

function chargerCard(c) {
  const m = statusMeta('charger', c.status)
  const f = db.get('forklift', c.forkliftId)
  let text = 'Ready · no forklift assigned'
  if (f && c.status === 'charging') text = `${f.id} · ${Math.round(f.battery)}%`
  else if (f) text = `${f.id} is out · ${f.task}`
  return header({
    illu: illustration('charger', TILE_ILLU),
    eyebrow: `${TYPE_LABEL.charger} · ${c.siteId}`,
    name: c.name,
    sub: c.spec,
    buttons: [button('locate', 'locate', 'Locate on map'), button('close', 'close', 'Close')],
  })
    + status(m.chip, m.tone, text, c.status === 'free' ? ' dp-chip--ink' : '')
    + rows([
      ['Forklift', f ? `${link('forklift', f.id)} · battery ${Math.round(f.battery)}%` : '—'],
      ['Sessions today', esc(fmtNum(c.sessionsToday ?? 0))],
      ['Energy today', `${(c.energyKwh ?? 0).toFixed(1)} kWh`],
      ['Charge rate', `${c.chargeRatePctMin ?? 0}% a minute`],
      ['Site', esc(siteName(c.siteId))],
    ])
}

// Approach progress for trucks that are not at a dock yet: the bar fills as distanceLeftM shrinks.
// The reverse-in manoeuvre is ≈ 30 m, the drive in from the spawn point ≈ 800 m; the largest
// distance seen per truck/status widens the scale when the simulation uses longer routes.
const approachMax = new Map()
const NOMINAL_M = { docking: 30, en_route: 800, at_gate: 120 }

function approachPct(t) {
  const key = `${t.id}:${t.status}`
  const d = Math.max(0, t.distanceLeftM ?? 0)
  const max = Math.max(approachMax.get(key) ?? 0, NOMINAL_M[t.status] ?? d, d)
  approachMax.set(key, max)
  return max > 0 ? Math.max(4, (1 - d / max) * 100) : 100
}

const fmtDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km left` : `${Math.round(m)} m left`)

function fmtWeight(t) {
  if (!(t > 0)) return '0 kg'
  return t < 1 ? `${fmtNum(Math.round(t * 100) * 10)} kg` : `${t.toFixed(1)} t`
}

function truckContext(t, dock) {
  switch (t.status) {
    case 'loading':
    case 'unloading': return `${t.siteId} · ${dock} · ${t.progress.done}/${t.progress.total} pallets`
    case 'docking': return `Reversing into ${dock} · ${t.siteId}`
    case 'at_gate': return `Waiting at gate · ${t.siteId}`
    case 'departing': return `Leaving ${t.siteId} · ${dock}`
    default: return `To ${t.siteId} · ETA ${fmtMin(t.etaMin)}`
  }
}

function truckCard(t) {
  const m = statusMeta('truck', t.status)
  const carrier = db.carrier(t.carrier)
  const shp = db.shipment(t.shipmentId)
  const dock = dockName(t.dockId)
  const atDock = t.status === 'loading' || t.status === 'unloading'
  const following = store.state.followId === t.id

  let prog
  if (atDock) prog = progress(pct(t.progress.done, t.progress.total), 'green', `${t.progress.done}/${t.progress.total}`)
  else if (t.status === 'departing') prog = progress(100, 'green', 'Departed')
  else prog = progress(approachPct(t), 'blue', fmtDistance(t.distanceLeftM ?? 0))

  let eta
  if (atDock) eta = `Done in ${fmtMin(t.etaMin)}`
  else if (t.status === 'departing') eta = 'Departed'
  else eta = `${fmtTime(store.state.simMinutes + (t.etaMin ?? 0))} (${fmtMin(t.etaMin)})`

  const cargo = t.cargo ?? { pallets: 0, capacity: 0, weightT: 0 }
  return header({
    illu: illustration('truck', TILE_ILLU, { color: carrier?.color ?? CARRIER_BLUE }),
    eyebrow: (carrier?.fullName ?? TYPE_LABEL.truck).toUpperCase(),
    name: t.id,
    sub: `${t.driver} · ${t.plate}`,
    buttons: [button('locate', 'locate', 'Locate on map'), button('follow', 'arrowUpRight', following ? 'Stop following' : 'Follow', following), button('close', 'close', 'Close')],
  })
    + status(m.chip, m.tone, truckContext(t, dock))
    + prog
    + rows([
      ['Shipment', shp ? `<a class="link wt-link" role="button" tabindex="0" data-act="shipment" data-id="${esc(t.id)}">#${esc(shp.id)}</a>` : '—'],
      ['Customer', esc(shp?.customer ?? '—')],
      ['Destination', esc(shp?.toLabel ?? '—')],
      ['ETA', esc(eta)],
      ['Speed', esc(fmtKmh(t.speedKmh ?? 0))],
      ['Bay', t.dockId ? `${link('dock', t.dockId, dock)} · ${esc(t.siteId)}` : '—'],
      ['Cargo', `${cargo.pallets}/${cargo.capacity} pallets · ${fmtWeight(cargo.weightT)}`],
    ])
}

const CARDS = {
  forklift: forkliftCard,
  pallet: palletCard,
  dock: dockCard,
  charger: chargerCard,
  truck: truckCard,
}

/** What the panel shows for the current state → { key, ref, render() }. */
function currentView(state) {
  const sel = state.selection
  if (sel && sel.type !== 'site') {
    const e = db.get(sel.type, sel.id)
    const card = CARDS[sel.type]
    if (e && card) return { key: `${sel.type}:${sel.id}`, ref: sel, render: () => card(e) }
  }
  const siteId = sel?.type === 'site' ? sel.id : state.siteId
  const site = db.site(siteId)
  if (site) return { key: `site:${site.id}`, ref: { type: 'site', id: site.id }, render: () => siteCard(site) }
  return { key: 'site:ALL', ref: null, render: networkCard }
}

// ───────────────────────────── mount ─────────────────────────────

export function mountDetailPanel(el) {
  const card = document.createElement('div')
  card.className = 'card dp'
  card.setAttribute('role', 'region')
  card.setAttribute('aria-label', 'Details')
  el.appendChild(card)

  let view = null
  let layer = null
  let settleTimer = 0

  function makeLayer(html) {
    const l = document.createElement('div')
    l.className = 'dp__layer'
    morph(l, html)
    return l
  }

  /** Cross-fade to a new layer while the card height eases from old to new. */
  function swap(html) {
    const startH = card.offsetHeight
    for (const old of card.querySelectorAll('.dp__layer--leaving')) old.remove()
    const prev = layer
    layer = makeLayer(html)
    layer.classList.add('dp__layer--entering')
    if (prev) {
      prev.classList.add('dp__layer--leaving')
      prev.setAttribute('aria-hidden', 'true')
      prev.style.top = `${-prev.scrollTop}px`
    }
    card.appendChild(layer)
    if (!prev) {
      layer.classList.remove('dp__layer--entering')
      return
    }
    card.style.height = `${startH}px`
    const endH = layer.offsetHeight + (card.offsetHeight - card.clientHeight)
    // the forced layout above commits the start state, so these changes transition (no rAF:
    // it would stall in a background tab and leave the new layer invisible)
    card.style.height = `${endH}px`
    layer.classList.remove('dp__layer--entering')
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      prev.remove()
      card.style.height = ''
    }, FADE_MS + 40)
  }

  /** Another entity → cross-fade; same entity (live data, follow toggle) → patch in place. */
  function render() {
    const next = currentView(store.state)
    const changed = !view || next.key !== view.key
    view = next
    card.dataset.view = next.key.split(':')[0]
    const html = next.render()
    if (changed || !layer) swap(html)
    else morph(layer, html)
  }

  card.addEventListener('click', (e) => {
    const target = e.target.closest('[data-act],[data-type],[data-site]')
    if (!target || !card.contains(target)) return
    const { act, type, id, site } = target.dataset
    if (act === 'locate' && view?.ref) bus.emit('camera:locate', { ...view.ref })
    else if (act === 'home') bus.emit('camera:cmd', { cmd: 'home' })
    else if (act === 'follow' && view?.ref) {
      const fid = view.ref.id
      store.set({ followId: store.state.followId === fid ? null : fid })
    } else if (act === 'close') store.select(null)
    else if (act === 'shipment') store.set({ trackedTruckId: id })
    else if (site) store.setSite(site)
    else if (type && id) store.select({ type, id })
  })
  card.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) {
      e.preventDefault()
      e.target.click()
    }
  })

  const offStore = store.subscribe((state, prev, changed) => {
    if (changed.some((k) => k === 'selection' || k === 'siteId' || k === 'followId' || k === 'simMinutes')) render()
  })
  const offBus = bus.on('data:update', render)
  render()

  /** Unmount: stop listening and remove the card. */
  return () => {
    offStore()
    offBus()
    clearTimeout(settleTimer)
    card.remove()
  }
}
