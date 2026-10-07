// Live in-memory database over mockData. Objects are shared by reference:
// the simulation mutates them, UI and 3D read them.
import {
  SITES, DOCKS, TRUCKS, FORKLIFTS, CHARGERS, PALLETS, SHIPMENTS,
  CARRIERS, SKUS, USER, NOTIFICATIONS,
} from './mockData.js'

const byId = (arr) => new Map(arr.map((o) => [o.id, o]))

const tables = {
  site: byId(SITES),
  dock: byId(DOCKS),
  truck: byId(TRUCKS),
  forklift: byId(FORKLIFTS),
  charger: byId(CHARGERS),
  pallet: byId(PALLETS),
  shipment: byId(SHIPMENTS),
}

export const ENTITY_TYPES = ['site', 'dock', 'truck', 'forklift', 'charger', 'pallet']

export const db = {
  carriers: CARRIERS,
  skus: SKUS,
  user: USER,
  notifications: NOTIFICATIONS,

  /** @returns {object|undefined} */
  get(type, id) {
    return tables[type]?.get(id)
  },

  /** All entities of a type, optionally filtered by siteId. Order = mockData order. */
  list(type, siteId) {
    const all = [...(tables[type]?.values() ?? [])]
    return siteId && siteId !== 'ALL' ? all.filter((e) => e.siteId === siteId || (type === 'site' && e.id === siteId)) : all
  },

  sites() { return [...tables.site.values()] },
  site(id) { return tables.site.get(id) },
  sku(code) { return SKUS[code] },
  carrier(key) { return CARRIERS[key] },
  shipment(id) { return tables.shipment.get(id) },
  shipmentForTruck(truckId) {
    const t = tables.truck.get(truckId)
    return t ? tables.shipment.get(t.shipmentId) : undefined
  },
  truckAtDock(dockId) {
    for (const t of tables.truck.values()) if (t.dockId === dockId && ['loading', 'unloading'].includes(t.status)) return t
    return undefined
  },

  /** Every entity across types (used by search). */
  all() {
    return ENTITY_TYPES.flatMap((type) => [...tables[type].values()])
  },
}

export default db
