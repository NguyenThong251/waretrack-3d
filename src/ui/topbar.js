// Top bar (SPEC §2.1): logo, global search, site selector (› next / ⌄ dropdown), live clock,
// notifications, user menu. The DOM is built once; store / bus changes only patch text nodes and
// small sections, so the focused search input is never destroyed.
import { store, bus } from '../state/store.js'
import { db } from '../data/db.js'
import { search, siteSelectorSub, siteMenuSub, siteStats } from '../data/selectors.js'
import { fmtTime } from '../data/format.js'
import { icon, avatar } from './icons.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Only touch the DOM when the text actually changed (data:update fires ≈4×/s). */
function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text
}

const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

// ───────────────────────────── shared helpers ─────────────────────────────

/** Site ids in selector order; '›' cycles WH-01 → … → WH-05 → WH-01 (ALL → WH-01). */
export function nextSiteId(current) {
  const ids = db.sites().map((s) => s.id)
  return ids[(ids.indexOf(current) + 1) % ids.length]
}

function badgeClass(siteId) {
  if (siteId === 'ALL') return 'site-badge site-badge--slate'
  return db.site(siteId)?.badgeTone === 'cyan' ? 'site-badge site-badge--cyan' : 'site-badge'
}

function networkSub() {
  const s = siteStats('ALL')
  return `${db.sites().length} sites · ${s.docked} docked`
}

const TYPE_ICON = {
  site: 'warehouse', dock: 'dock', truck: 'truck', forklift: 'forklift', charger: 'battery', pallet: 'package', shipment: 'route',
}

/** Entity search: selectors.search() plus shipment numbers (selecting a shipment selects its truck). */
function searchAll(query) {
  const results = search(query)
  const q = query.trim().toLowerCase()
  if (!q || results.length >= 8) return results
  for (const shp of db.list('shipment')) {
    const hay = `${shp.id} #${shp.id} ${shp.customer} ${shp.toLabel}`.toLowerCase()
    if (!hay.includes(q) || !db.get('truck', shp.truckId)) continue
    results.push({
      type: 'truck', id: shp.truckId, kind: 'shipment',
      title: `#${shp.id} · ${shp.customer}`,
      sub: `${shp.truckId} · ${shp.direction === 'outbound' ? `To ${shp.toLabel}` : `Inbound to ${shp.siteId}`}`,
      siteId: shp.siteId,
    })
    if (results.length >= 8) break
  }
  return results
}

function highlight(text, query) {
  const q = query.trim()
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return esc(text)
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`
}

const ENTITY_PATTERNS = [
  [/\bTRK-\d{4}\b/, 'truck'],
  [/\bFL-\d{2}\b/, 'forklift'],
  [/\bPAL-\d{4}\b/, 'pallet'],
  [/\bWH-0\d\b/, 'site'],
]

/** First entity mentioned in a notification (e.g. "TRK-2481 approaching") that exists in the db. */
function refFromText(text) {
  for (const [re, type] of ENTITY_PATTERNS) {
    const id = text.match(re)?.[0]
    if (id && db.get(type, id)) return { type, id }
  }
  return null
}

const NOTE_ICON = { orange: 'alert', blue: 'truck', green: 'check', gray: 'battery' }

// ───────────────────────────── markup ─────────────────────────────

function template() {
  return `
  <a class="tb-brand" href="#" aria-label="WareTrack home">
    <span class="tb-brand__logo">${icon('logoCube', 37)}</span>
    <span class="tb-brand__name">WareTrack</span>
  </a>

  <div class="tb-search" data-menu="search">
    <label class="tb-search__field">
      ${icon('search', 18, { sw: 1.6 })}
      <input class="tb-search__input" type="search" autocomplete="off" spellcheck="false"
        placeholder="Search sites, trucks, forklifts, pallets, shipments..."
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="wt-search-results"
        aria-label="Search sites, trucks, forklifts, pallets, shipments" />
      <button class="tb-search__clear" type="button" aria-label="Clear search">${icon('close', 14)}</button>
      <kbd class="kbd">/</kbd>
    </label>
    <div class="wt-pop tb-results" id="wt-search-results" role="listbox"></div>
  </div>

  <div class="tb-right">
    <div class="tb-site" data-menu="site">
      <div class="tb-site__box">
        <button class="tb-site__main" type="button">
          <span class="site-badge tb-site__badge"></span>
          <span class="tb-site__text">
            <span class="tb-site__name"></span>
            <span class="tb-site__sub"></span>
          </span>
          <span class="tb-site__next">${icon('chevronRight', 15)}</span>
        </button>
        <span class="tb-site__divider"></span>
        <button class="tb-site__toggle" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Choose site">
          ${icon('chevronDown', 15, { sw: 1.9 })}
        </button>
      </div>
      <div class="wt-pop tb-sitemenu" role="listbox" aria-label="Sites"></div>
    </div>

    <div class="tb-live" role="status" aria-live="off" title="Live simulation clock">
      <span class="dot live-dot"></span>
      <span class="tb-live__label">Live</span>
      <span class="tb-live__clock"></span>
    </div>

    <div class="tb-bell" data-menu="notifications">
      <button class="tb-bell__btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">
        ${icon('bell', 24, { sw: 1.6 })}
        <span class="tb-bell__dot"></span>
      </button>
      <div class="wt-pop tb-notes" role="dialog" aria-label="Notifications">
        <div class="wt-pop__head">
          <span>Notifications</span>
          <button class="tb-notes__mark" type="button">Mark all as read</button>
        </div>
        <div class="tb-notes__list"></div>
      </div>
    </div>

    <span class="tb-divider" aria-hidden="true"></span>

    <div class="tb-user" data-menu="user">
      <button class="tb-user__btn" type="button" aria-haspopup="menu" aria-expanded="false">
        <span class="tb-user__avatar">${avatar(40)}</span>
        <span class="tb-user__text">
          <span class="tb-user__name">${esc(db.user.name)}</span>
          <span class="tb-user__role">${esc(db.user.role)}</span>
        </span>
        <span class="tb-user__chev">${icon('chevronDown', 16, { sw: 2 })}</span>
      </button>
      <div class="wt-pop tb-usermenu" role="menu">
        <div class="tb-usermenu__head">
          ${avatar(32)}
          <div><b>${esc(db.user.name)}</b><span>${esc(db.user.email)}</span></div>
        </div>
        <button class="tb-usermenu__item" type="button" role="menuitem">${icon('user', 16)}Profile</button>
        <button class="tb-usermenu__item" type="button" role="menuitem">${icon('settings', 16)}Settings</button>
        <button class="tb-usermenu__item tb-usermenu__item--danger" type="button" role="menuitem">${icon('logout', 16)}Sign out</button>
      </div>
    </div>
  </div>`
}

// ───────────────────────────── search ─────────────────────────────

function createSearch(root) {
  const input = root.querySelector('.tb-search__input')
  const list = root.querySelector('.tb-results')
  const clearBtn = root.querySelector('.tb-search__clear')
  let results = []
  let active = 0

  const open = () => store.state.menu === 'search'

  function choose(r) {
    if (!r) return
    const ref = { type: r.type, id: r.id }
    reset()
    input.blur()
    store.select(ref)
    bus.emit('camera:locate', ref)
  }

  function reset() {
    input.value = ''
    root.classList.remove('has-query')
    store.set({ searchQuery: '', menu: open() ? null : store.state.menu })
  }

  function paintActive() {
    list.querySelectorAll('.tb-results__row').forEach((row, i) => {
      row.classList.toggle('is-active', i === active)
      row.setAttribute('aria-selected', String(i === active))
    })
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }

  function render() {
    const q = store.state.searchQuery
    if (document.activeElement !== input && input.value !== q) input.value = q
    root.classList.toggle('has-query', !!q)
    results = searchAll(q)
    active = 0
    if (!q.trim()) { list.innerHTML = ''; return }
    list.innerHTML = results.length
      ? results.map((r, i) => `
        <button class="tb-results__row${i === 0 ? ' is-active' : ''}" type="button" role="option" data-i="${i}" aria-selected="${i === 0}">
          <span class="tb-results__icon">${icon(TYPE_ICON[r.kind ?? r.type] ?? 'cube', 16)}</span>
          <span class="tb-results__text">
            <span class="tb-results__title">${highlight(r.title, q)}</span>
            <span class="tb-results__sub">${esc(r.sub ?? '')}</span>
          </span>
          ${r.kind === 'shipment' ? '<span class="tb-results__type">Shipment</span>' : ''}
        </button>`).join('') + `
        <div class="tb-results__hint"><span><kbd class="kbd">↵</kbd>select</span><span><kbd class="kbd">↑↓</kbd>navigate</span><span><kbd class="kbd">esc</kbd>clear</span></div>`
      : `<div class="wt-pop__empty">No matches for “${esc(q.trim())}”</div>`
  }

  input.addEventListener('input', () => {
    const q = input.value
    root.classList.toggle('has-query', !!q)
    store.set({ searchQuery: q, menu: q.trim() ? 'search' : open() ? null : store.state.menu })
  })
  input.addEventListener('focus', () => {
    root.classList.add('is-focused')
    if (input.value.trim()) store.set({ menu: 'search' })
  })
  input.addEventListener('blur', () => root.classList.remove('is-focused'))
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return
      e.preventDefault()
      if (!open()) store.set({ menu: 'search' })
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length
      paintActive()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active] ?? results[0])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      reset()
      input.blur()
    }
  })
  // keep focus in the input while clicking a result
  list.addEventListener('mousedown', (e) => e.preventDefault())
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.tb-results__row')
    if (row) choose(results[+row.dataset.i])
  })
  list.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.tb-results__row')
    if (row && +row.dataset.i !== active) { active = +row.dataset.i; paintActive() }
  })
  clearBtn.addEventListener('mousedown', (e) => e.preventDefault())
  clearBtn.addEventListener('click', () => { reset(); input.focus() })

  return {
    input,
    render,
    setOpen(on) {
      const show = on && !!store.state.searchQuery.trim()
      list.classList.toggle('is-open', show)
      input.setAttribute('aria-expanded', String(show))
    },
  }
}

// ───────────────────────────── site selector ─────────────────────────────

function createSiteSelector(root) {
  const main = root.querySelector('.tb-site__main')
  const toggle = root.querySelector('.tb-site__toggle')
  const badge = root.querySelector('.tb-site__badge')
  const name = root.querySelector('.tb-site__name')
  const sub = root.querySelector('.tb-site__sub')
  const menu = root.querySelector('.tb-sitemenu')
  let rows = new Map() // siteId → { el, pct, fill, sub }

  function render() {
    const id = store.state.siteId
    const all = id === 'ALL'
    const site = db.site(id)
    badge.className = `${badgeClass(id)} tb-site__badge`
    setText(badge, all ? 'ALL' : id)
    setText(name, all ? 'Network overview' : site?.name ?? id)
    setText(sub, all ? networkSub() : siteSelectorSub(id))
    const next = db.site(nextSiteId(id))
    main.title = `Next site · ${next.id} ${next.name}`
    if (menu.classList.contains('is-open')) markCurrent()
  }

  function buildMenu() {
    const all = `
      <button class="tb-sitemenu__row tb-sitemenu__row--all" type="button" role="option" data-site="ALL">
        <span class="site-badge site-badge--slate">ALL</span>
        <span class="tb-sitemenu__body">
          <span class="tb-sitemenu__top"><span class="tb-sitemenu__name">Network overview</span></span>
          <span class="tb-sitemenu__meta"><span class="tb-sitemenu__sub">Zoom out to all ${db.sites().length} sites</span></span>
        </span>
      </button>`
    const sites = db.sites().map((s) => `
      <button class="tb-sitemenu__row" type="button" role="option" data-site="${s.id}">
        <span class="${badgeClass(s.id)}">${s.id}</span>
        <span class="tb-sitemenu__body">
          <span class="tb-sitemenu__top">
            <span class="tb-sitemenu__name">${esc(s.name)}</span>
            <span class="tb-sitemenu__pct"></span>
          </span>
          <span class="tb-sitemenu__meta">
            <span class="bar"><span class="bar__fill bar__fill--blue"></span></span>
            <span class="tb-sitemenu__sub"></span>
          </span>
        </span>
      </button>`).join('')
    menu.innerHTML = all + sites
    rows = new Map([...menu.querySelectorAll('[data-site]')].map((el) => [el.dataset.site, {
      el,
      pct: el.querySelector('.tb-sitemenu__pct'),
      fill: el.querySelector('.bar__fill'),
      sub: el.querySelector('.tb-sitemenu__sub'),
    }]))
    refreshMenu()
    markCurrent()
  }

  function refreshMenu() {
    for (const [id, r] of rows) {
      if (id === 'ALL') continue
      const pct = Math.round(siteStats(id).fullPct)
      setText(r.pct, `${pct}%`)
      const w = `${Math.min(100, pct)}%`
      if (r.fill.style.width !== w) r.fill.style.width = w
      setText(r.sub, siteMenuSub(id))
    }
  }

  function markCurrent() {
    for (const [id, r] of rows) {
      const cur = id === store.state.siteId
      r.el.classList.toggle('is-current', cur)
      r.el.setAttribute('aria-selected', String(cur))
    }
  }

  main.addEventListener('click', () => store.setSite(nextSiteId(store.state.siteId)))
  toggle.addEventListener('click', () => store.set({ menu: store.state.menu === 'site' ? null : 'site' }))
  menu.addEventListener('click', (e) => {
    const row = e.target.closest('[data-site]')
    if (!row) return
    if (row.dataset.site === store.state.siteId) store.set({ menu: null })
    else store.setSite(row.dataset.site)
  })

  return {
    render,
    refresh() {
      setText(sub, store.state.siteId === 'ALL' ? networkSub() : siteSelectorSub(store.state.siteId))
      if (menu.classList.contains('is-open')) refreshMenu()
    },
    setOpen(on) {
      if (on && !menu.classList.contains('is-open')) buildMenu()
      menu.classList.toggle('is-open', on)
      root.classList.toggle('is-open', on)
      toggle.setAttribute('aria-expanded', String(on))
    },
  }
}

// ───────────────────────────── live clock ─────────────────────────────

function createLiveClock(root) {
  const clock = root.querySelector('.tb-live__clock')
  return {
    render(minutes = store.state.simMinutes) {
      setText(clock, fmtTime(minutes))
    },
  }
}

// ───────────────────────────── notifications ─────────────────────────────

function createNotifications(root) {
  const btn = root.querySelector('.tb-bell__btn')
  const dot = root.querySelector('.tb-bell__dot')
  const pop = root.querySelector('.tb-notes')
  const list = root.querySelector('.tb-notes__list')
  const markAll = root.querySelector('.tb-notes__mark')
  // read-state is UI-local: the db stays read-only for the overlay
  const read = new Set(db.notifications.filter((n) => !n.unread).map((n) => n.id))
  const unreadCount = () => db.notifications.filter((n) => !read.has(n.id)).length

  function ago(at) {
    const m = Math.floor(store.state.simMinutes - at)
    return m <= 0 ? 'now' : m < 60 ? `${m} min ago` : fmtTime(at)
  }

  function renderBadge() {
    const n = unreadCount()
    dot.hidden = n === 0
    btn.setAttribute('aria-label', n ? `Notifications (${n} unread)` : 'Notifications')
    markAll.disabled = n === 0
  }

  function renderList() {
    const items = [...db.notifications].sort((a, b) => b.at - a.at)
    list.innerHTML = items.length
      ? items.map((n) => `
        <button class="tb-notes__row${read.has(n.id) ? '' : ' is-unread'}" type="button" data-note="${n.id}">
          <span class="tb-notes__icon tb-notes__icon--${n.tone}">${icon(NOTE_ICON[n.tone] ?? 'info', 16)}</span>
          <span class="tb-notes__text">
            <span class="tb-notes__title">${esc(n.title)}</span>
            <span class="tb-notes__body">${esc(n.body)}</span>
          </span>
          <span class="tb-notes__time" data-at="${n.at}">${ago(n.at)}</span>
        </button>`).join('')
      : '<div class="wt-pop__empty">You’re all caught up.</div>'
  }

  btn.addEventListener('click', () => store.set({ menu: store.state.menu === 'notifications' ? null : 'notifications' }))
  markAll.addEventListener('click', () => {
    db.notifications.forEach((n) => read.add(n.id))
    renderBadge()
    renderList()
  })
  list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-note]')
    if (!row) return
    const note = db.notifications.find((n) => n.id === row.dataset.note)
    read.add(note.id)
    renderBadge()
    store.set({ menu: null })
    const ref = refFromText(`${note.title} ${note.body}`)
    if (ref) {
      store.select(ref)
      bus.emit('camera:locate', ref)
    }
  })

  renderBadge()

  return {
    tick() {
      if (!pop.classList.contains('is-open')) return
      list.querySelectorAll('.tb-notes__time').forEach((el) => setText(el, ago(+el.dataset.at)))
    },
    setOpen(on) {
      if (on && !pop.classList.contains('is-open')) renderList()
      pop.classList.toggle('is-open', on)
      root.classList.toggle('is-open', on)
      btn.setAttribute('aria-expanded', String(on))
    },
  }
}

// ───────────────────────────── user menu ─────────────────────────────

function createUserMenu(root) {
  const btn = root.querySelector('.tb-user__btn')
  const pop = root.querySelector('.tb-usermenu')
  btn.addEventListener('click', () => store.set({ menu: store.state.menu === 'user' ? null : 'user' }))
  // Profile / Settings / Sign out are inert in this demo — they just close the menu.
  pop.addEventListener('click', (e) => {
    if (e.target.closest('.tb-usermenu__item')) store.set({ menu: null })
  })
  return {
    setOpen(on) {
      pop.classList.toggle('is-open', on)
      root.classList.toggle('is-open', on)
      btn.setAttribute('aria-expanded', String(on))
    },
  }
}

// ───────────────────────────── mount ─────────────────────────────

export function mountTopbar(el) {
  el.innerHTML = template()
  el.setAttribute('role', 'banner')
  // logo = "back to the current site's default view"
  el.querySelector('.tb-brand').addEventListener('click', (e) => {
    e.preventDefault()
    store.select(null)
    bus.emit('camera:cmd', { cmd: 'home' })
  })

  const searchBox = createSearch(el.querySelector('.tb-search'))
  const site = createSiteSelector(el.querySelector('.tb-site'))
  const live = createLiveClock(el.querySelector('.tb-live'))
  const notes = createNotifications(el.querySelector('.tb-bell'))
  const user = createUserMenu(el.querySelector('.tb-user'))

  function applyMenu(menu) {
    searchBox.setOpen(menu === 'search')
    site.setOpen(menu === 'site')
    notes.setOpen(menu === 'notifications')
    user.setOpen(menu === 'user')
  }

  site.render()
  live.render()
  searchBox.render()
  applyMenu(store.state.menu)

  const unsub = store.subscribe((state, prev, changed) => {
    if (changed.includes('siteId')) site.render()
    if (changed.includes('simMinutes')) { live.render(); notes.tick() }
    if (changed.includes('searchQuery')) searchBox.render()
    if (changed.includes('menu') || changed.includes('searchQuery')) applyMenu(state.menu)
  })

  const offData = bus.on('data:update', (p) => {
    live.render(p?.simMinutes ?? store.state.simMinutes)
    site.refresh()
  })

  // click outside any open menu closes it; elements with [data-menu="<name>"] count as inside
  const onPointerDown = (e) => {
    const menu = store.state.menu
    if (menu && !e.target.closest?.(`[data-menu="${menu}"]`)) store.set({ menu: null })
  }

  const onKeyDown = (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(document.activeElement)) {
      e.preventDefault()
      searchBox.input.focus()
      searchBox.input.select()
    } else if (e.key === 'Escape' && store.state.menu && store.state.menu !== 'search') {
      store.set({ menu: null })
    }
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown)

  return {
    destroy() {
      unsub()
      offData()
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      el.innerHTML = ''
    },
  }
}
