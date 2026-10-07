// Tiny app store + event bus. No framework.
//
// store.state            → current state (read-only by convention)
// store.set(patch)       → shallow-merge patch, notify subscribers with (state, prev, changedKeys)
// store.subscribe(fn)    → returns unsubscribe
// store.select(entityRef)→ helper: set selection + (for trucks) trackedTruckId
//
// bus.on(evt, fn) / bus.off(evt, fn) / bus.emit(evt, payload)  — see SPEC §Events
import { SIM_START_MINUTES } from '../data/mockData.js'
import { db } from '../data/db.js'

const initial = {
  siteId: 'WH-01',            // 'WH-01'..'WH-05' | 'ALL' (network overview)
  selection: null,            // { type, id } | null   (type ∈ site|truck|forklift|pallet|dock|charger)
  hover: null,                // { type, id } | null
  fleetTab: 'docks',          // 'docks' | 'forklifts' | 'trucks'
  trackedTruckId: 'TRK-2051', // truck whose shipment is shown in Shipment Tracking
  followId: null,             // truck/forklift id the camera follows (↗ button), or null
  simMinutes: SIM_START_MINUTES, // live clock (float, minutes since midnight)
  menu: null,                 // open dropdown: null | 'site' | 'notifications' | 'user' | 'search'
  searchQuery: '',
}

function createStore(init) {
  let state = { ...init }
  const subs = new Set()
  return {
    get state() { return state },
    set(patch) {
      const prev = state
      const changed = Object.keys(patch).filter((k) => !Object.is(prev[k], patch[k]))
      if (!changed.length) return
      state = { ...prev, ...patch }
      for (const fn of [...subs]) fn(state, prev, changed)
    },
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
  }
}

export const store = createStore(initial)

/**
 * Select an entity (or null). Switching to an entity of another site also switches the site.
 * Selecting a truck also makes it the tracked shipment.
 */
store.select = function select(ref) {
  if (!ref) return store.set({ selection: null, followId: null })
  const e = db.get(ref.type, ref.id)
  if (!e) return
  const patch = { selection: { type: ref.type, id: ref.id } }
  const siteId = ref.type === 'site' ? e.id : e.siteId
  if (siteId && store.state.siteId !== siteId) patch.siteId = siteId
  if (ref.type === 'truck') patch.trackedTruckId = ref.id
  if (store.state.followId && store.state.followId !== ref.id) patch.followId = null
  store.set(patch)
}

/** Switch site (or 'ALL'). Resets selection and tracked shipment to the site's featured truck. */
store.setSite = function setSite(siteId) {
  const site = db.site(siteId)
  store.set({
    siteId,
    selection: null,
    followId: null,
    menu: null,
    trackedTruckId: site?.featuredTruckId ?? store.state.trackedTruckId,
  })
}

function createBus() {
  const map = new Map()
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set())
      map.get(evt).add(fn)
      return () => map.get(evt)?.delete(fn)
    },
    off(evt, fn) { map.get(evt)?.delete(fn) },
    emit(evt, payload) { for (const fn of [...(map.get(evt) ?? [])]) fn(payload) },
  }
}

export const bus = createBus()
