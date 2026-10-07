// Formatting + status vocabulary shared by every UI module.

export const pad2 = (n) => String(n).padStart(2, '0')

/** sim minutes since midnight → "09:40" */
export function fmtTime(min) {
  const m = Math.floor(((min % 1440) + 1440) % 1440)
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

/** 1412 → "1,412" */
export const fmtNum = (n) => Math.round(n).toLocaleString('en-US')

/** 96.64 → "96.6%" */
export const fmtPct = (n, digits = 1) => `${n.toFixed(digits)}%`

export const fmtKmh = (v) => `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)} km/h`

/** whole minutes → "13 min" (min 1) */
export const fmtMin = (m) => `${Math.max(1, Math.round(m))} min`

/**
 * Status chip vocabulary. tone ∈ green | blue | orange | gray.
 * chip    = short label used in lists/fleet panel
 * long    = label used in the right-hand detail panel chip (when different)
 */
export const STATUS = {
  truck: {
    en_route:  { chip: 'En route',  tone: 'blue' },
    at_gate:   { chip: 'At gate',   tone: 'orange' },
    docking:   { chip: 'Docking',   tone: 'blue' },
    loading:   { chip: 'Loading',   tone: 'green' },
    unloading: { chip: 'Unloading', tone: 'green' },
    departing: { chip: 'Departing', tone: 'gray' },
  },
  forklift: {
    loading:   { chip: 'Loading',   long: 'Loading truck',   tone: 'green' },
    unloading: { chip: 'Unloading', long: 'Unloading truck', tone: 'green' },
    charging:  { chip: 'Charging',  long: 'Charging',        tone: 'orange' },
    idle:      { chip: 'Idle',      long: 'Idle',            tone: 'gray' },
    moving:    { chip: 'Moving',    long: 'Moving',          tone: 'blue' },
  },
  pallet: {
    staged: { chip: 'Staged', tone: 'green' },
    moving: { chip: 'Moving', tone: 'blue' },
    stored: { chip: 'Stored', tone: 'gray' },
    loaded: { chip: 'Loaded', tone: 'green' },
  },
  dock: {
    available: { chip: 'Available', tone: 'gray' },
    booked:    { chip: 'Booked',    tone: 'orange' },
    docking:   { chip: 'Docking',   tone: 'blue' },
    loading:   { chip: 'Loading',   tone: 'green' },
    unloading: { chip: 'Unloading', tone: 'green' },
  },
  charger: {
    free:     { chip: 'Free',     tone: 'gray' },
    charging: { chip: 'Charging', tone: 'orange' },
  },
  inventory: {
    in_stock:  { chip: 'In Stock',  tone: 'green' },
    low_stock: { chip: 'Low Stock', tone: 'orange' },
  },
  site: {
    Operational: { chip: 'Operational', tone: 'green' },
  },
}

export function statusMeta(type, status) {
  return STATUS[type]?.[status] ?? { chip: String(status ?? '—'), tone: 'gray' }
}

/** Type label shown in the detail-panel eyebrow ("FORKLIFT · WH-01"). */
export const TYPE_LABEL = {
  site: 'SITE', truck: 'TRUCK', forklift: 'FORKLIFT', pallet: 'PALLET', dock: 'DOCK BAY', charger: 'CHARGER',
}
