// WareTrack — mock ERP / WMS dataset.
// Seeded from the reference video (docs/ref). Everything here is fake business data.
// Entities are plain mutable objects: the simulation mutates them live, the UI reads them.
// Times are "sim minutes since midnight" (e.g. 9:40 → 580). Use format.js → fmtTime().

const t = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export const SIM_START_MINUTES = t('09:40')

export const USER = {
  name: 'Alex Chen',
  role: 'Operations Manager',
  email: 'alex.chen@waretrack.example',
}

// ───────────────────────────── Carriers ─────────────────────────────
export const CARRIERS = {
  waretrack: { key: 'waretrack', name: 'WareTrack', fullName: 'WareTrack Freight', color: '#2f5bea' },
  bluepeak:  { key: 'bluepeak',  name: 'Bluepeak',  fullName: 'Bluepeak Foods',   color: '#1f2a78' },
  nordline:  { key: 'nordline',  name: 'Nordline',  fullName: 'Nordline Logistics', color: '#16a08b' },
  cargoviva: { key: 'cargoviva', name: 'Cargoviva', fullName: 'Cargoviva',        color: '#f26b1d' },
}

// ───────────────────────────── SKUs (item master) ─────────────────────────────
// kind → how a pallet of this SKU looks in 3D: 'cardboard' | 'blue' | 'white'
// icon → UI illustration key (see SPEC §UI icons)
export const SKUS = {
  'BOX-M-001':  { sku: 'BOX-M-001',  name: 'Cardboard Box (M)',  category: 'Packaging', kind: 'cardboard', icon: 'box',       unitKg: 0.42 },
  'PLC-CNT-B':  { sku: 'PLC-CNT-B',  name: 'Plastic Container',  category: 'Storage',   kind: 'blue',      icon: 'container', unitKg: 1.1 },
  'PPE-HLM-Y':  { sku: 'PPE-HLM-Y',  name: 'Safety Helmet',      category: 'PPE',       kind: 'cardboard', icon: 'helmet',    unitKg: 0.45 },
  'PKG-TAPE-48':{ sku: 'PKG-TAPE-48',name: 'Packing Tape',       category: 'Packaging', kind: 'cardboard', icon: 'tape',      unitKg: 0.12 },
  'LED-6060':   { sku: 'LED-6060',   name: 'LED Panel 60×60',    category: 'Lighting',  kind: 'cardboard', icon: 'panel',     unitKg: 2.6 },
  'FUR-CHR-01': { sku: 'FUR-CHR-01', name: 'Office Chair',       category: 'Furniture', kind: 'cardboard', icon: 'chair',     unitKg: 14 },
  'PPE-GLV-N':  { sku: 'PPE-GLV-N',  name: 'Nitrile Gloves',     category: 'PPE',       kind: 'blue',      icon: 'gloves',    unitKg: 0.9 },
  'FRZ-PEA-10': { sku: 'FRZ-PEA-10', name: 'Frozen Peas 10 kg',  category: 'Frozen',    kind: 'white',     icon: 'frozen',    unitKg: 10 },
  'BEV-WTR-24': { sku: 'BEV-WTR-24', name: 'Spring Water 24-pack', category: 'Beverage', kind: 'white',    icon: 'water',     unitKg: 12.4 },
}

// ───────────────────────────── Sites ─────────────────────────────
// world: site lot centre in world metres (Y up). variant: building style (see SPEC §3D buildings).
// badgeTone: colour of the "WH-0x" badge in the top bar.
export const SITES = [
  {
    id: 'WH-01', type: 'site', name: 'Riverside Hub', kind: 'DEPOT', variant: 'depot',
    address: '12 Riverside Dr, Newark NJ', status: 'Operational', badgeTone: 'blue',
    capacity: 1800, stock: 1412, stockDelta: 15,
    onTime: 96.6, onTimeDelta: 0.4, outboundToday: 23, putawaysToday: 15,
    trucksDelta: 1,
    inventory: [
      { sku: 'BOX-M-001', qty: 1906, status: 'in_stock' },
      { sku: 'PLC-CNT-B', qty: 297, status: 'in_stock' },
      { sku: 'PPE-HLM-Y', qty: 212, status: 'low_stock' },
      { sku: 'PKG-TAPE-48', qty: 4448, status: 'in_stock' },
    ],
    featuredTruckId: 'TRK-2051',
    world: { x: 0, z: 0 },
  },
  {
    id: 'WH-02', type: 'site', name: 'Northgate DC', kind: 'DISTRIBUTION CENTER', variant: 'dc',
    address: '480 Northgate Blvd, Newark NJ', status: 'Operational', badgeTone: 'blue',
    capacity: 4200, stock: 3310, stockDelta: 35,
    onTime: 98.2, onTimeDelta: 0.4, outboundToday: 21, putawaysToday: 35,
    trucksDelta: 2,
    inventory: [
      { sku: 'LED-6060', qty: 1787, status: 'in_stock' },
      { sku: 'FUR-CHR-01', qty: 174, status: 'in_stock' },
      { sku: 'BOX-M-001', qty: 993, status: 'low_stock' },
      { sku: 'PPE-GLV-N', qty: 5793, status: 'in_stock' },
    ],
    featuredTruckId: 'TRK-2104',
    world: { x: 300, z: -40 },
  },
  {
    id: 'WH-03', type: 'site', name: 'Eastport Cold Chain', kind: 'COLD STORE', variant: 'cold',
    address: '7 Harbor Way, Elizabeth NJ', status: 'Operational', badgeTone: 'cyan',
    capacity: 1400, stock: 990, stockDelta: 20,
    onTime: 96.0, onTimeDelta: 0.4, outboundToday: 31, putawaysToday: 20,
    trucksDelta: 1,
    inventory: [
      { sku: 'FRZ-PEA-10', qty: 334, status: 'in_stock' },
      { sku: 'BEV-WTR-24', qty: 364, status: 'in_stock' },
      { sku: 'PPE-GLV-N', qty: 495, status: 'low_stock' },
      { sku: 'PLC-CNT-B', qty: 208, status: 'in_stock' },
    ],
    featuredTruckId: 'TRK-2148',
    world: { x: 600, z: 20 },
  },
  {
    id: 'WH-04', type: 'site', name: 'Southfield Cross-Dock', kind: 'CROSS-DOCK', variant: 'crossdock',
    address: '2200 Southfield Ave, Linden NJ', status: 'Operational', badgeTone: 'blue',
    capacity: 1600, stock: 610, stockDelta: 20,
    onTime: 96.2, onTimeDelta: 0.4, outboundToday: 29, putawaysToday: 20,
    trucksDelta: 2,
    inventory: [
      { sku: 'BEV-WTR-24', qty: 288, status: 'in_stock' },
      { sku: 'PKG-TAPE-48', qty: 1922, status: 'in_stock' },
      { sku: 'LED-6060', qty: 73, status: 'low_stock' },
      { sku: 'PPE-HLM-Y', qty: 320, status: 'in_stock' },
    ],
    featuredTruckId: 'TRK-2205',
    world: { x: 120, z: 300 },
  },
  {
    id: 'WH-05', type: 'site', name: 'Westgate Robotics Hub', kind: 'AUTOMATED DC', variant: 'robotics',
    address: '300 Westgate Rd, Kearny NJ', status: 'Operational', badgeTone: 'blue',
    capacity: 2400, stock: 1730, stockDelta: 25,
    onTime: 95.9, onTimeDelta: 0.4, outboundToday: 33, putawaysToday: 25,
    trucksDelta: 3,
    inventory: [
      { sku: 'LED-6060', qty: 934, status: 'in_stock' },
      { sku: 'BOX-M-001', qty: 1817, status: 'in_stock' },
      { sku: 'PPE-GLV-N', qty: 865, status: 'low_stock' },
      { sku: 'PPE-HLM-Y', qty: 908, status: 'in_stock' },
    ],
    featuredTruckId: 'TRK-2339',
    world: { x: 460, z: 320 },
  },
]

// ───────────────────────────── Docks ─────────────────────────────
// status: 'available' | 'booked' | 'docking' | 'loading' | 'unloading'
// direction: 'bay' (generic) | 'in' | 'out'
const dock = (siteId, code, name, direction, extra = {}) => ({
  id: `${siteId}-${code}`, type: 'dock', siteId, name, direction,
  kind: 'Dock door with leveller', status: 'available', truckId: null,
  bookedTruckId: null, bookedInMin: null, rearDoors: '—', trucksToday: 0,
  ...extra,
})

export const DOCKS = [
  dock('WH-01', 'B1', 'Bay 1', 'bay', { status: 'loading', truckId: 'TRK-2051', rearDoors: 'Open', trucksToday: 6 }),
  dock('WH-01', 'B2', 'Bay 2', 'bay', { status: 'booked', bookedTruckId: 'TRK-2287', bookedInMin: 3, trucksToday: 4 }),

  dock('WH-02', 'B1', 'Bay 1', 'bay', { status: 'unloading', truckId: 'TRK-2104', rearDoors: 'Open', trucksToday: 7 }),
  dock('WH-02', 'B2', 'Bay 2', 'bay', { status: 'booked', bookedTruckId: 'TRK-2658', bookedInMin: 1, trucksToday: 5 }),
  dock('WH-02', 'B3', 'Bay 3', 'bay', { status: 'loading', truckId: 'TRK-2127', rearDoors: 'Open', trucksToday: 6 }),
  dock('WH-02', 'B4', 'Bay 4', 'bay', { status: 'booked', bookedTruckId: 'TRK-2526', bookedInMin: 2, trucksToday: 3 }),

  dock('WH-03', 'B1', 'Bay 1', 'bay', { status: 'unloading', truckId: 'TRK-2471', rearDoors: 'Open', trucksToday: 9, kind: 'Insulated dock door with seal' }),
  dock('WH-03', 'B2', 'Bay 2', 'bay', { status: 'unloading', truckId: 'TRK-2148', rearDoors: 'Open', trucksToday: 11, kind: 'Insulated dock door with seal' }),
  dock('WH-03', 'B3', 'Bay 3', 'bay', { status: 'booked', bookedTruckId: 'TRK-2603', bookedInMin: 1, trucksToday: 8, kind: 'Insulated dock door with seal' }),

  dock('WH-04', 'IN1', 'In 1', 'in', { status: 'unloading', truckId: 'TRK-2205', rearDoors: 'Open', trucksToday: 7 }),
  dock('WH-04', 'IN2', 'In 2', 'in', { status: 'booked', bookedTruckId: 'TRK-2481', bookedInMin: 3, trucksToday: 5 }),
  dock('WH-04', 'IN3', 'In 3', 'in', { status: 'booked', bookedTruckId: 'TRK-2307', bookedInMin: 1, trucksToday: 4 }),
  dock('WH-04', 'OUT1', 'Out 1', 'out', { trucksToday: 6 }),
  dock('WH-04', 'OUT2', 'Out 2', 'out', { status: 'loading', truckId: 'TRK-2229', rearDoors: 'Open', trucksToday: 5 }),
  dock('WH-04', 'OUT3', 'Out 3', 'out', { trucksToday: 2 }),

  dock('WH-05', 'B1', 'Bay 1', 'bay', { status: 'loading', truckId: 'TRK-2339', rearDoors: 'Open', trucksToday: 8 }),
  dock('WH-05', 'B2', 'Bay 2', 'bay', { status: 'loading', truckId: 'TRK-2574', rearDoors: 'Open', trucksToday: 6 }),
  dock('WH-05', 'B3', 'Bay 3', 'bay', { status: 'booked', bookedTruckId: 'TRK-2372', bookedInMin: 1, trucksToday: 7 }),
  dock('WH-05', 'B4', 'Bay 4', 'bay', { status: 'booked', bookedTruckId: 'TRK-2412', bookedInMin: 2, trucksToday: 5 }),
]

// ───────────────────────────── Trucks ─────────────────────────────
// status: 'en_route' | 'at_gate' | 'docking' | 'loading' | 'unloading' | 'departing'
// progress: pallets moved {done,total}; cargo: what's physically on board.
// position/heading are owned by the simulation (world metres, heading = rotation.y, model faces +Z).
const truck = (o) => ({
  type: 'truck', speedKmh: 0, etaMin: 0, distanceLeftM: 0,
  position: { x: 0, y: 0, z: 0 }, heading: 0, path: null, target: null,
  ...o,
})

export const TRUCKS = [
  // WH-01
  truck({ id: 'TRK-2051', siteId: 'WH-01', carrier: 'waretrack', driver: 'Marcus Lee', plate: 'NJX-4471',
    status: 'loading', dockId: 'WH-01-B1', shipmentId: 'SHP-78442',
    progress: { done: 2, total: 6 }, etaMin: 13, cargo: { pallets: 2, capacity: 6, weightT: 0.8 } }),
  truck({ id: 'TRK-2287', siteId: 'WH-01', carrier: 'bluepeak', driver: 'Hannah Cole', plate: 'PAX-2093',
    status: 'en_route', dockId: 'WH-01-B2', shipmentId: 'SHP-78446',
    progress: { done: 0, total: 7 }, etaMin: 3, distanceLeftM: 640, speedKmh: 24, cargo: { pallets: 7, capacity: 8, weightT: 2.9 } }),

  // WH-02
  truck({ id: 'TRK-2127', siteId: 'WH-02', carrier: 'bluepeak', driver: 'Owen Price', plate: 'BLU-7712',
    status: 'loading', dockId: 'WH-02-B3', shipmentId: 'SHP-78441',
    progress: { done: 4, total: 7 }, etaMin: 9, cargo: { pallets: 4, capacity: 8, weightT: 1.7 } }),
  truck({ id: 'TRK-2104', siteId: 'WH-02', carrier: 'nordline', driver: 'Ella Novak', plate: 'NRD-3380',
    status: 'unloading', dockId: 'WH-02-B1', shipmentId: 'SHP-78444',
    progress: { done: 1, total: 5 }, etaMin: 13, cargo: { pallets: 4, capacity: 6, weightT: 1.9 } }),
  truck({ id: 'TRK-2658', siteId: 'WH-02', carrier: 'cargoviva', driver: 'Diego Ramos', plate: 'CGV-5521',
    status: 'docking', dockId: 'WH-02-B2', shipmentId: 'SHP-78452',
    progress: { done: 0, total: 6 }, etaMin: 1, distanceLeftM: 31, speedKmh: 6, cargo: { pallets: 6, capacity: 8, weightT: 2.4 } }),
  truck({ id: 'TRK-2526', siteId: 'WH-02', carrier: 'waretrack', driver: 'Grace Kim', plate: 'WTF-1186',
    status: 'en_route', dockId: 'WH-02-B4', shipmentId: 'SHP-78453',
    progress: { done: 0, total: 5 }, etaMin: 2, distanceLeftM: 420, speedKmh: 22, cargo: { pallets: 5, capacity: 6, weightT: 2.0 } }),

  // WH-03
  truck({ id: 'TRK-2148', siteId: 'WH-03', carrier: 'bluepeak', driver: 'Ravi Patel', plate: 'BLU-2148',
    status: 'unloading', dockId: 'WH-03-B2', shipmentId: 'SHP-78448', reefer: true,
    progress: { done: 3, total: 4 }, etaMin: 3, cargo: { pallets: 1, capacity: 4, weightT: 0.6 } }),
  truck({ id: 'TRK-2471', siteId: 'WH-03', carrier: 'bluepeak', driver: 'Tom Becker', plate: 'BLU-2471',
    status: 'unloading', dockId: 'WH-03-B1', shipmentId: 'SHP-78449', reefer: true,
    progress: { done: 0, total: 4 }, etaMin: 14, cargo: { pallets: 4, capacity: 4, weightT: 2.2 } }),
  truck({ id: 'TRK-2603', siteId: 'WH-03', carrier: 'bluepeak', driver: 'Alex Walsh', plate: 'HUL-7099',
    status: 'docking', dockId: 'WH-03-B3', shipmentId: 'SHP-78472', reefer: true,
    progress: { done: 0, total: 8 }, etaMin: 1, distanceLeftM: 24, speedKmh: 22, cargo: { pallets: 8, capacity: 8, weightT: 3.6 } }),

  // WH-04
  truck({ id: 'TRK-2205', siteId: 'WH-04', carrier: 'waretrack', driver: 'Sam Chen', plate: 'ZBY-5648',
    status: 'unloading', dockId: 'WH-04-IN1', shipmentId: 'SHP-78450',
    progress: { done: 2, total: 6 }, etaMin: 13, cargo: { pallets: 3, capacity: 7, weightT: 1.2 } }),
  truck({ id: 'TRK-2229', siteId: 'WH-04', carrier: 'nordline', driver: 'Lena Fischer', plate: 'NRD-2229',
    status: 'loading', dockId: 'WH-04-OUT2', shipmentId: 'SHP-78455',
    progress: { done: 3, total: 6 }, etaMin: 11, cargo: { pallets: 3, capacity: 6, weightT: 1.3 } }),
  truck({ id: 'TRK-2307', siteId: 'WH-04', carrier: 'nordline', driver: 'Ada Larsen', plate: 'EKT-2897',
    status: 'docking', dockId: 'WH-04-IN3', shipmentId: 'SHP-78456',
    progress: { done: 0, total: 8 }, etaMin: 1, distanceLeftM: 26, speedKmh: 6, cargo: { pallets: 8, capacity: 8, weightT: 3.2 } }),
  truck({ id: 'TRK-2481', siteId: 'WH-04', carrier: 'cargoviva', driver: 'Alex Haddad', plate: 'WKH-3157',
    status: 'en_route', dockId: 'WH-04-IN2', shipmentId: 'SHP-78466',
    progress: { done: 0, total: 10 }, etaMin: 1, distanceLeftM: 380, speedKmh: 23, cargo: { pallets: 10, capacity: 10, weightT: 4.1 } }),

  // WH-05
  truck({ id: 'TRK-2339', siteId: 'WH-05', carrier: 'cargoviva', driver: 'Nina Weber', plate: 'CGV-2339',
    status: 'loading', dockId: 'WH-05-B1', shipmentId: 'SHP-78458',
    progress: { done: 1, total: 5 }, etaMin: 13, cargo: { pallets: 1, capacity: 6, weightT: 0.5 } }),
  truck({ id: 'TRK-2574', siteId: 'WH-05', carrier: 'nordline', driver: 'Jonas Berg', plate: 'NRD-2574',
    status: 'loading', dockId: 'WH-05-B2', shipmentId: 'SHP-78459',
    progress: { done: 0, total: 4 }, etaMin: 15, cargo: { pallets: 0, capacity: 6, weightT: 0 } }),
  truck({ id: 'TRK-2372', siteId: 'WH-05', carrier: 'waretrack', driver: 'Luis Walsh', plate: 'TTC-2870',
    status: 'docking', dockId: 'WH-05-B3', shipmentId: 'SHP-78460',
    progress: { done: 0, total: 6 }, etaMin: 1, distanceLeftM: 5, speedKmh: 11, cargo: { pallets: 6, capacity: 6, weightT: 2.5 } }),
  truck({ id: 'TRK-2412', siteId: 'WH-05', carrier: 'nordline', driver: 'Mia Russo', plate: 'NRD-2412',
    status: 'at_gate', dockId: 'WH-05-B4', shipmentId: 'SHP-78462',
    progress: { done: 0, total: 5 }, etaMin: 2, distanceLeftM: 60, speedKmh: 0, cargo: { pallets: 5, capacity: 6, weightT: 2.1 } }),
]

// ───────────────────────────── Forklifts ─────────────────────────────
// status: 'loading' | 'unloading' | 'charging' | 'idle' | 'moving'
const forklift = (o) => ({
  type: 'forklift', speedKmh: 0, carryingPalletId: null, carryingKind: null, forkHeight: 0.15,
  position: { x: 0, y: 0, z: 0 }, heading: 0,
  ...o,
})

export const FORKLIFTS = [
  forklift({ id: 'FL-01', siteId: 'WH-01', operator: 'Sam Haddad', model: 'Toyota 8FBE18', status: 'loading', task: 'Loading TRK-2051 at Bay 1', truckId: 'TRK-2051', battery: 75, movesToday: 28, chargerId: 'WH-01-C1' }),
  forklift({ id: 'FL-02', siteId: 'WH-01', operator: 'Maya Ortiz', model: 'Linde E20', status: 'idle', task: 'Waiting for work', truckId: null, battery: 64, movesToday: 19, chargerId: 'WH-01-C2' }),

  forklift({ id: 'FL-03', siteId: 'WH-02', operator: 'Liam Brooks', model: 'Toyota 8FBE18', status: 'loading', task: 'Loading TRK-2127 at Bay 3', truckId: 'TRK-2127', battery: 78, movesToday: 41, chargerId: 'WH-02-C1' }),
  forklift({ id: 'FL-04', siteId: 'WH-02', operator: 'Chloe Martin', model: 'Jungheinrich EFG 216', status: 'unloading', task: 'Unloading TRK-2104 at Bay 1', truckId: 'TRK-2104', battery: 66, movesToday: 33, chargerId: 'WH-02-C2' }),
  forklift({ id: 'FL-05', siteId: 'WH-02', operator: 'Ben Carter', model: 'Toyota 8FBE18', status: 'charging', task: 'Charging at bay', truckId: null, battery: 41, movesToday: 36, chargerId: 'WH-02-C3' }),
  forklift({ id: 'FL-06', siteId: 'WH-02', operator: 'Sofia Rossi', model: 'Linde E20', status: 'idle', task: 'Waiting for work', truckId: null, battery: 97, movesToday: 12, chargerId: 'WH-02-C4' }),

  forklift({ id: 'FL-07', siteId: 'WH-03', operator: 'Kenji Mori', model: 'Toyota 8FBE18', status: 'unloading', task: 'Unloading TRK-2148 at Bay 2', truckId: 'TRK-2148', battery: 78, movesToday: 31, chargerId: 'WH-03-C1' }),
  forklift({ id: 'FL-08', siteId: 'WH-03', operator: 'Aisha Bello', model: 'Jungheinrich EFG 216', status: 'unloading', task: 'Unloading TRK-2471 at Bay 1', truckId: 'TRK-2471', battery: 70, movesToday: 27, chargerId: 'WH-03-C2' }),
  forklift({ id: 'FL-09', siteId: 'WH-03', operator: 'Pedro Alves', model: 'Toyota 8FBE18', status: 'charging', task: 'Charging at bay', truckId: null, battery: 58, movesToday: 22, chargerId: 'WH-03-C3' }),

  forklift({ id: 'FL-10', siteId: 'WH-04', operator: 'Zoe Reyes', model: 'Jungheinrich EFG 216', status: 'unloading', task: 'Unloading TRK-2205 at In 1', truckId: 'TRK-2205', battery: 84, movesToday: 38, chargerId: 'WH-04-C1', carryingPalletId: 'PAL-1060' }),
  forklift({ id: 'FL-11', siteId: 'WH-04', operator: 'Noah Kim', model: 'Linde E20', status: 'loading', task: 'Loading TRK-2229 at Out 2', truckId: 'TRK-2229', battery: 82, movesToday: 35, chargerId: 'WH-04-C2' }),
  forklift({ id: 'FL-12', siteId: 'WH-04', operator: 'Zoe Larsen', model: 'Toyota 8FBE18', status: 'charging', task: 'Charging at bay', truckId: null, battery: 86, movesToday: 24, chargerId: 'WH-04-C3' }),
  forklift({ id: 'FL-13', siteId: 'WH-04', operator: 'Omar Diaz', model: 'Toyota 8FBE18', status: 'charging', task: 'Charging at bay', truckId: null, battery: 91, movesToday: 21, chargerId: 'WH-04-C4' }),
  forklift({ id: 'FL-14', siteId: 'WH-04', operator: 'Priya Shah', model: 'Jungheinrich EFG 216', status: 'idle', task: 'Waiting for work', truckId: null, battery: 100, movesToday: 17, chargerId: 'WH-04-C5' }),

  forklift({ id: 'FL-15', siteId: 'WH-05', operator: 'Ines Moreau', model: 'Toyota 8FBE18', status: 'loading', task: 'Loading TRK-2339 at Bay 1', truckId: 'TRK-2339', battery: 94, movesToday: 34, chargerId: 'WH-05-C1' }),
  forklift({ id: 'FL-16', siteId: 'WH-05', operator: 'Felix Wagner', model: 'Linde E20', status: 'charging', task: 'Charging at bay', truckId: null, battery: 52, movesToday: 29, chargerId: 'WH-05-C2' }),
  forklift({ id: 'FL-17', siteId: 'WH-05', operator: 'Hana Sato', model: 'Toyota 8FBE18', status: 'idle', task: 'Waiting for work', truckId: null, battery: 88, movesToday: 15, chargerId: 'WH-05-C3' }),
]

// ───────────────────────────── Chargers ─────────────────────────────
// status: 'free' | 'charging'
const charger = (siteId, n, o = {}) => ({
  id: `${siteId}-C${n}`, type: 'charger', siteId, name: `C${n}`,
  spec: '48 V lithium-ion forklift charger', status: 'free', forkliftId: null,
  sessionsToday: 4, energyKwh: 22.4, chargeRatePctMin: 8,
  ...o,
})

export const CHARGERS = [
  charger('WH-01', 1, { forkliftId: 'FL-01', sessionsToday: 5, energyKwh: 31.2 }),
  charger('WH-01', 2, { forkliftId: 'FL-02', sessionsToday: 3, energyKwh: 18.6 }),

  charger('WH-02', 1, { forkliftId: 'FL-03', sessionsToday: 6, energyKwh: 36.8 }),
  charger('WH-02', 2, { forkliftId: 'FL-04', sessionsToday: 5, energyKwh: 29.5 }),
  charger('WH-02', 3, { status: 'charging', forkliftId: 'FL-05', sessionsToday: 7, energyKwh: 41.3 }),
  charger('WH-02', 4, { forkliftId: 'FL-06', sessionsToday: 2, energyKwh: 12.1 }),

  charger('WH-03', 1, { forkliftId: 'FL-07', sessionsToday: 6, energyKwh: 33.0 }),
  charger('WH-03', 2, { forkliftId: 'FL-08', sessionsToday: 4, energyKwh: 24.7 }),
  charger('WH-03', 3, { status: 'charging', forkliftId: 'FL-09', sessionsToday: 8, energyKwh: 44.9 }),

  charger('WH-04', 1, { forkliftId: 'FL-10', sessionsToday: 7, energyKwh: 40.1 }),
  charger('WH-04', 2, { forkliftId: 'FL-11', sessionsToday: 5, energyKwh: 28.3 }),
  charger('WH-04', 3, { status: 'charging', forkliftId: 'FL-12', sessionsToday: 6, energyKwh: 35.6 }),
  charger('WH-04', 4, { status: 'charging', forkliftId: 'FL-13', sessionsToday: 4, energyKwh: 21.9 }),
  charger('WH-04', 5, { forkliftId: 'FL-14', sessionsToday: 3, energyKwh: 15.2 }),

  charger('WH-05', 1, { forkliftId: 'FL-15', sessionsToday: 6, energyKwh: 34.4 }),
  charger('WH-05', 2, { status: 'charging', forkliftId: 'FL-16', sessionsToday: 5, energyKwh: 27.8 }),
  charger('WH-05', 3, { forkliftId: 'FL-17', sessionsToday: 2, energyKwh: 11.5 }),
]

// ───────────────────────────── Pallets (LPN) ─────────────────────────────
// status: 'staged' | 'moving' | 'stored' | 'loaded'
// slot: yard/staging slot code (layout.js gives its position). pinned: show a blue map pin above it.
const pallet = (o) => ({
  type: 'pallet', status: 'staged', carriedBy: null, pinned: false,
  position: { x: 0, y: 0, z: 0 }, heading: 0,
  ...o,
})

export const PALLETS = [
  // WH-01
  pallet({ id: 'PAL-1026', siteId: 'WH-01', sku: 'PPE-HLM-Y', slot: 'S01', quantity: 82, grossKg: 56, lot: 'L2501-870', received: 'Apr 19, 16:29' }),
  pallet({ id: 'PAL-1027', siteId: 'WH-01', sku: 'BOX-M-001', slot: 'S02', quantity: 120, grossKg: 64, lot: 'L2501-871', received: 'Apr 19, 16:41', pinned: true }),
  pallet({ id: 'PAL-1028', siteId: 'WH-01', sku: 'PKG-TAPE-48', slot: 'S03', quantity: 360, grossKg: 52, lot: 'L2501-874', received: 'Apr 20, 07:12', pinned: true }),
  pallet({ id: 'PAL-1029', siteId: 'WH-01', sku: 'BOX-M-001', slot: 'S04', quantity: 120, grossKg: 64, lot: 'L2501-871', received: 'Apr 20, 07:30', pinned: true, status: 'stored' }),
  pallet({ id: 'PAL-1031', siteId: 'WH-01', sku: 'PLC-CNT-B', slot: 'S05', quantity: 48, grossKg: 61, lot: 'L2501-902', received: 'Apr 20, 08:05', status: 'stored' }),
  pallet({ id: 'PAL-1032', siteId: 'WH-01', sku: 'BOX-M-001', slot: 'S06', quantity: 120, grossKg: 64, lot: 'L2501-871', received: 'Apr 20, 08:16', status: 'stored' }),

  // WH-02
  pallet({ id: 'PAL-1040', siteId: 'WH-02', sku: 'LED-6060', slot: 'S01', quantity: 24, grossKg: 71, lot: 'L2502-114', received: 'Apr 20, 06:58', pinned: true }),
  pallet({ id: 'PAL-1041', siteId: 'WH-02', sku: 'PPE-GLV-N', slot: 'S02', quantity: 60, grossKg: 58, lot: 'L2502-120', received: 'Apr 20, 07:21', pinned: true }),
  pallet({ id: 'PAL-1042', siteId: 'WH-02', sku: 'FUR-CHR-01', slot: 'S03', quantity: 6, grossKg: 92, lot: 'L2502-131', received: 'Apr 20, 07:44' }),
  pallet({ id: 'PAL-1043', siteId: 'WH-02', sku: 'PPE-GLV-N', slot: 'S04', quantity: 60, grossKg: 58, lot: 'L2502-120', received: 'Apr 20, 08:02' }),
  pallet({ id: 'PAL-1044', siteId: 'WH-02', sku: 'BOX-M-001', slot: 'S05', quantity: 120, grossKg: 64, lot: 'L2502-140', received: 'Apr 20, 08:30' }),

  // WH-03
  pallet({ id: 'PAL-1050', siteId: 'WH-03', sku: 'FRZ-PEA-10', slot: 'S01', quantity: 40, grossKg: 412, lot: 'L2503-018', received: 'Apr 20, 06:40', pinned: true }),
  pallet({ id: 'PAL-1051', siteId: 'WH-03', sku: 'PLC-CNT-B', slot: 'S02', quantity: 48, grossKg: 61, lot: 'L2503-022', received: 'Apr 20, 07:05', pinned: true }),
  pallet({ id: 'PAL-1052', siteId: 'WH-03', sku: 'BEV-WTR-24', slot: 'S03', quantity: 36, grossKg: 455, lot: 'L2503-030', received: 'Apr 20, 07:52' }),

  // WH-04
  pallet({ id: 'PAL-1060', siteId: 'WH-04', sku: 'LED-6060', slot: 'S01', quantity: 24, grossKg: 71, lot: 'L2504-310', received: 'Apr 20, 09:38', status: 'moving', carriedBy: 'FL-10' }),
  pallet({ id: 'PAL-1061', siteId: 'WH-04', sku: 'BEV-WTR-24', slot: 'S02', quantity: 36, grossKg: 455, lot: 'L2504-288', received: 'Apr 20, 08:12' }),
  pallet({ id: 'PAL-1062', siteId: 'WH-04', sku: 'PKG-TAPE-48', slot: 'S03', quantity: 360, grossKg: 52, lot: 'L2504-290', received: 'Apr 20, 08:20', pinned: true }),
  pallet({ id: 'PAL-1063', siteId: 'WH-04', sku: 'PPE-GLV-N', slot: 'S04', quantity: 60, grossKg: 58, lot: 'L2504-296', received: 'Apr 20, 08:47', pinned: true }),
  pallet({ id: 'PAL-1064', siteId: 'WH-04', sku: 'BEV-WTR-24', slot: 'S05', quantity: 36, grossKg: 455, lot: 'L2504-301', received: 'Apr 20, 09:02' }),
  pallet({ id: 'PAL-1065', siteId: 'WH-04', sku: 'PPE-HLM-Y', slot: 'S06', quantity: 82, grossKg: 56, lot: 'L2504-305', received: 'Apr 20, 09:15' }),

  // WH-05
  pallet({ id: 'PAL-1090', siteId: 'WH-05', sku: 'BOX-M-001', slot: 'S01', quantity: 120, grossKg: 64, lot: 'L2505-401', received: 'Apr 20, 07:10', pinned: true }),
  pallet({ id: 'PAL-1091', siteId: 'WH-05', sku: 'LED-6060', slot: 'S02', quantity: 24, grossKg: 71, lot: 'L2505-412', received: 'Apr 20, 07:55' }),
  pallet({ id: 'PAL-1092', siteId: 'WH-05', sku: 'PPE-GLV-N', slot: 'S03', quantity: 60, grossKg: 58, lot: 'L2505-420', received: 'Apr 20, 08:25', pinned: true }),
]

// ───────────────────────────── Shipments (orders) ─────────────────────────────
// direction 'outbound': loaded here, leaves to `toLabel`.  'inbound': arrives here and is unloaded.
// times: completed milestone clock times (sim minutes). eta*: forecast clock times (sim minutes).
export const SHIPMENTS = [
  { id: 'SHP-78442', truckId: 'TRK-2051', siteId: 'WH-01', dockId: 'WH-01-B1', direction: 'outbound', customer: 'Keystone Supply Co.', toLabel: 'Philadelphia, PA',
    times: { confirmed: t('06:49'), picked: t('08:19') }, eta: { loaded: t('09:53'), transit: t('10:01'), delivered: t('10:33') } },
  { id: 'SHP-78446', truckId: 'TRK-2287', siteId: 'WH-01', dockId: 'WH-01-B2', direction: 'inbound', customer: 'Bluepeak Foods', toLabel: 'WH-01 Riverside Hub',
    times: { confirmed: t('06:31'), picked: t('07:58'), loaded: t('08:47'), transit: t('09:05') }, eta: { arrive: t('09:43'), done: t('10:05') } },

  { id: 'SHP-78441', truckId: 'TRK-2127', siteId: 'WH-02', dockId: 'WH-02-B3', direction: 'outbound', customer: 'Harborline Retail', toLabel: 'Hartford, CT',
    times: { confirmed: t('06:22'), picked: t('08:02') }, eta: { loaded: t('09:49'), transit: t('09:55'), delivered: t('12:10') } },
  { id: 'SHP-78444', truckId: 'TRK-2104', siteId: 'WH-02', dockId: 'WH-02-B1', direction: 'inbound', customer: 'Brightway Electric', toLabel: 'WH-02 Northgate DC',
    times: { confirmed: t('06:43'), picked: t('08:20'), loaded: t('09:15'), transit: t('09:41') }, eta: { arrive: t('09:44'), done: t('10:00') } },
  { id: 'SHP-78452', truckId: 'TRK-2658', siteId: 'WH-02', dockId: 'WH-02-B2', direction: 'inbound', customer: 'Cargoviva', toLabel: 'WH-02 Northgate DC',
    times: { confirmed: t('06:55'), picked: t('08:11'), loaded: t('09:02'), transit: t('09:20') }, eta: { arrive: t('09:41'), done: t('10:08') } },
  { id: 'SHP-78453', truckId: 'TRK-2526', siteId: 'WH-02', dockId: 'WH-02-B4', direction: 'inbound', customer: 'Medline East', toLabel: 'WH-02 Northgate DC',
    times: { confirmed: t('07:05'), picked: t('08:26'), loaded: t('09:10'), transit: t('09:24') }, eta: { arrive: t('09:42'), done: t('10:12') } },

  { id: 'SHP-78448', truckId: 'TRK-2148', siteId: 'WH-03', dockId: 'WH-03-B2', direction: 'inbound', customer: 'FreshCo Markets', toLabel: 'WH-03 Eastport Cold Chain',
    times: { confirmed: t('06:40'), picked: t('08:19'), loaded: t('09:16'), transit: t('09:42') }, eta: { arrive: t('09:44'), done: t('09:52') } },
  { id: 'SHP-78449', truckId: 'TRK-2471', siteId: 'WH-03', dockId: 'WH-03-B1', direction: 'inbound', customer: 'Polar Foods', toLabel: 'WH-03 Eastport Cold Chain',
    times: { confirmed: t('06:52'), picked: t('08:30'), loaded: t('09:18'), transit: t('09:31') }, eta: { arrive: t('09:39'), done: t('10:04') } },
  { id: 'SHP-78472', truckId: 'TRK-2603', siteId: 'WH-03', dockId: 'WH-03-B3', direction: 'inbound', customer: 'Harbor & Co.', toLabel: 'WH-03 Eastport Cold Chain',
    times: { confirmed: t('07:07'), picked: t('08:34'), loaded: t('09:18'), transit: t('09:32') }, eta: { arrive: t('09:52'), done: t('10:32') } },

  { id: 'SHP-78450', truckId: 'TRK-2205', siteId: 'WH-04', dockId: 'WH-04-IN1', direction: 'inbound', customer: 'Oakridge Market', toLabel: 'WH-04 Southfield Cross-Dock',
    times: { confirmed: t('06:57'), picked: t('08:25'), loaded: t('09:10'), transit: t('09:26') }, eta: { arrive: t('09:35'), done: t('09:56') } },
  { id: 'SHP-78455', truckId: 'TRK-2229', siteId: 'WH-04', dockId: 'WH-04-OUT2', direction: 'outbound', customer: 'Lehigh Outfitters', toLabel: 'Allentown, PA',
    times: { confirmed: t('06:48'), picked: t('08:40') }, eta: { loaded: t('09:54'), transit: t('10:00'), delivered: t('11:25') } },
  { id: 'SHP-78456', truckId: 'TRK-2307', siteId: 'WH-04', dockId: 'WH-04-IN3', direction: 'inbound', customer: 'Sunvale Grocers', toLabel: 'WH-04 Southfield Cross-Dock',
    times: { confirmed: t('06:37'), picked: t('08:16'), loaded: t('09:12'), transit: t('09:26') }, eta: { arrive: t('09:45'), done: t('10:25') } },
  { id: 'SHP-78466', truckId: 'TRK-2481', siteId: 'WH-04', dockId: 'WH-04-IN2', direction: 'inbound', customer: 'Halcyon Retail', toLabel: 'WH-04 Southfield Cross-Dock',
    times: { confirmed: t('07:03'), picked: t('08:29'), loaded: t('09:12'), transit: t('09:26') }, eta: { arrive: t('09:45'), done: t('10:25') } },

  { id: 'SHP-78458', truckId: 'TRK-2339', siteId: 'WH-05', dockId: 'WH-05-B1', direction: 'outbound', customer: 'Northstar Robotics', toLabel: 'Trenton, NJ',
    times: { confirmed: t('06:53'), picked: t('08:28') }, eta: { loaded: t('10:05'), transit: t('10:13'), delivered: t('10:45') } },
  { id: 'SHP-78459', truckId: 'TRK-2574', siteId: 'WH-05', dockId: 'WH-05-B2', direction: 'outbound', customer: 'Coastal Clinics', toLabel: 'Stamford, CT',
    times: { confirmed: t('07:12'), picked: t('08:51') }, eta: { loaded: t('10:07'), transit: t('10:12'), delivered: t('11:58') } },
  { id: 'SHP-78460', truckId: 'TRK-2372', siteId: 'WH-05', dockId: 'WH-05-B3', direction: 'inbound', customer: 'Sunvale Grocers', toLabel: 'WH-05 Westgate Robotics Hub',
    times: { confirmed: t('07:10'), picked: t('08:32'), loaded: t('09:21'), transit: t('09:35') }, eta: { arrive: t('09:53'), done: t('10:33') } },
  { id: 'SHP-78462', truckId: 'TRK-2412', siteId: 'WH-05', dockId: 'WH-05-B4', direction: 'inbound', customer: 'Metro Office Supply', toLabel: 'WH-05 Westgate Robotics Hub',
    times: { confirmed: t('07:18'), picked: t('08:44'), loaded: t('09:24'), transit: t('09:38') }, eta: { arrive: t('09:54'), done: t('10:30') } },
]

// ───────────────────────────── Notifications ─────────────────────────────
export const NOTIFICATIONS = [
  { id: 'N1', tone: 'orange', title: 'Low stock · Safety Helmet', body: 'WH-01 Riverside Hub is at 212 units (min 300).', at: t('09:36'), unread: true },
  { id: 'N2', tone: 'blue', title: 'TRK-2481 approaching', body: 'Cargoviva truck booked for WH-04 · In 2.', at: t('09:38'), unread: true },
  { id: 'N3', tone: 'orange', title: 'Low stock · LED Panel 60×60', body: 'WH-04 Southfield Cross-Dock is at 73 units.', at: t('09:31'), unread: true },
  { id: 'N4', tone: 'green', title: 'SHP-78439 delivered', body: 'Delivered to Newark, NJ — 4 min early.', at: t('09:22'), unread: false },
  { id: 'N5', tone: 'gray', title: 'FL-05 battery low', body: 'Sent to charger C3 at WH-02 Northgate DC.', at: t('09:12'), unread: false },
]
