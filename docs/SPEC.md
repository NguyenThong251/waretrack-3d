# WareTrack 3D — Build Spec & Module Contracts

Goal: rebuild the web app shown in `docs/ref/reference_video.mp4` **as faithfully as possible** — a
3D logistics control tower ("WareTrack") for an ERP/WMS: an isometric, soft-pastel 3D city with five
warehouse sites, live trucks / forklifts / pallets, and a glassy white UI overlay. Data is fake
(`src/data/mockData.js`).

Reference frames: `docs/ref/*.jpg` (1248×718 video frames) and 2× UI crops in `docs/ref/ui/*.png`.
**Open and study the frames relevant to your module before writing code.**

Stack: Vite 8 + three.js r186 (ES modules, plain JavaScript, no framework, no TypeScript).
Imports: `import * as THREE from 'three'`, addons from `three/addons/...`
(e.g. `three/addons/controls/OrbitControls.js`, `three/addons/renderers/CSS2DRenderer.js`,
`three/addons/geometries/RoundedBoxGeometry.js`, `three/addons/utils/BufferGeometryUtils.js`).

Dev server: `npm run dev` → http://localhost:5173 (already running during the build). Any
`dev/*.html` page you create is served at `http://localhost:5173/dev/<name>.html`.

---------------------------------------------------------------------------------------------------

## 0. File ownership (one owner per file — never edit files you don't own)

| Owner | Files |
|---|---|
| lead (done) | `index.html`, `src/main.js`, `src/data/mockData.js`, `src/data/db.js`, `src/data/format.js`, `src/data/selectors.js`, `src/state/store.js`, `src/three/palette.js`, `src/three/canvasText.js`, this spec |
| vehicles | `src/three/models/truck.js`, `src/three/models/forklift.js`, `dev/vehicles.html`, `dev/vehicles.js` |
| cargo-props | `src/three/models/pallet.js`, `src/three/models/props.js`, `dev/props.html`, `dev/props.js` |
| buildings | `src/three/models/warehouse.js`, `dev/buildings.html`, `dev/buildings.js` |
| world | `src/data/layout.js`, `src/three/world.js`, `src/three/environment.js`, `dev/world.html`, `dev/world.js` |
| scene | `src/three/scene.js`, `src/three/cameraDirector.js`, `src/three/interaction.js`, `src/three/interaction.css` |
| ui-shell | `src/ui/styles.css`, `src/ui/icons.js`, `src/ui/index.js`, `src/ui/topbar.js`, `src/ui/kpis.js`, `src/ui/mapControls.js` |
| ui-panels | `src/ui/panels.css`, `src/ui/illustrations.js`, `src/ui/detailPanel.js`, `src/ui/shipmentTracker.js`, `src/ui/fleetPanel.js` |
| simulation (phase B) | `src/state/simulation.js` |

If you need something from a file you don't own, code against the contract below. If the contract is
truly insufficient, add a clearly marked `// CONTRACT-GAP:` comment and work around it locally.

---------------------------------------------------------------------------------------------------

## 1. What the video shows (behaviour script)

1. **Load** → WH-01 Riverside Hub seen from a high isometric angle (camera south-east of the site,
   ~40° elevation, narrow FOV). Top bar, 3 KPI cards top-left, map controls + site detail panel
   top-right, Shipment Tracking bottom-left, Fleet panel (Docks/Forklifts/Trucks tabs) bottom-right.
2. **Hover** an object (forklift / pallet / dock bay / charger / truck / building) → a small blue
   pill label appears above it (`FL-01  Loading truck`, `PAL-1026  Safety Helmet`, `In 2  Booked`,
   `C1  Free`, `WH-01  Riverside Hub`) and blue **corner brackets** outline its bounding box, with a
   faint blue glow on the ground. Cursor = pointer.
3. **Click** → the object becomes selected (brackets + label persist), the camera eases to centre
   it, the right panel cross-fades (~250 ms) to that entity's detail card. ✕ closes back to the site card.
4. **Drag** pans the map (grab-hand cursor), right-drag rotates, wheel zooms. Map controls:
   `+`, `−`, rotate-left, rotate-right, home. Panning reveals the surrounding city (roads with white
   dashes, fences, trees, parking lots, other warehouses, office blocks).
5. **Site selector** (top bar): `WH-0x` badge + name + `78% full · 1/2 docked`, `›` (next site) and
   `⌄` (dropdown). Dropdown: "ALL · Network overview — Zoom out to all 5 sites", then 5 rows with
   badge, name, % and a progress bar, `2/2 docked · 0 inbound`. Choosing a site → **camera flies
   across the city** (rises, travels, descends ~1.8 s) to that site; KPIs, panels, tracker update.
6. **Fleet panel tabs**: Docks `2/2` · Forklifts `1/2` · Trucks `2`; clicking a row selects that
   entity and flies the camera to it.
7. **Live simulation**: clock in the top bar ticks (09:40 → 09:54 over ~72 s, i.e. 1 sim-minute ≈ 5 s);
   trucks drive on the roads, pull up, reverse into dock bays (a blue route ribbon with chevrons +
   dotted line + target pin is drawn for the selected truck); forklifts shuttle pallets between
   truck rears and staging slots; progress `2/6 → 3/6`, ETAs count down, batteries charge, statuses
   change (`En route → At gate → Docking → Unloading`), map pins bob over pinned pallets.
8. **Shipment Tracking** follows the selected/featured truck: 5 steps with icons, done = solid
   blue, current = bigger blue circle with halo ring, todo = grey; right card `#SHP-78442`,
   `To: Philadelphia, PA`, status chip, `WH-01 · Bay 1 · 13 min left`.

Key frames: `01_wh01_overview` (initial state), `02_wh01_forklift_selected`, `03_wh01_pallet_hover`,
`07_wh04_dock_hover`, `08_wh04_charger_panel`, `09_wh04_truck_panel`, `10_wh04_forklift_tab`,
`11_wh04_trucks_tab`, `12_wh04_truck_docking_path`, `14_site_dropdown`, `15_wh02_overview`,
`17_wh03_overview`, `20_wh03_truck_docking`, `21_wh04_overview`, `22_flyover_city_wh05`,
`23_wh05_overview`.

---------------------------------------------------------------------------------------------------

## 2. UI overlay — layout & design tokens

Design for a 1440×830 viewport (video is 1248×718 → multiply video px by ≈1.15). All overlay cards
float over the full-screen canvas; nothing pushes the 3D view.

| Region | Position (1440 wide) |
|---|---|
| Top bar | full width, height 64, white 92% + blur, bottom hairline |
| KPI cards ×3 | top 78, left 30; each ≈ 210×68; gap 12 |
| Map controls | top 78, right 360; 46 wide vertical card: + − ⟲ ⟳ ⌂ |
| Detail panel | top 78, right 30; width 336; max-height ≈ 430 (site card) |
| Shipment Tracking | bottom 22, left 30; width ≈ 860; height ≈ 122 |
| Fleet panel | bottom 22, right 30; width ≈ 430; ≈ 150 tall (4 rows visible, scroll if more) |

Tokens (CSS custom properties, defined by ui-shell in `styles.css` on `:root`):
```
--font: Inter, system-ui, sans-serif
--bg-card: rgba(255,255,255,.94)     --blur: saturate(160%) blur(14px)
--border: rgba(222,228,242,.95)      --shadow: 0 10px 30px rgba(36,56,120,.10), 0 1px 2px rgba(36,56,120,.06)
--radius: 14px  --radius-sm: 10px
--text: #151a2d   --text-2: #5d6579   --text-3: #8a92a6   --line: #edf0f6
--blue: #2f5bea   --blue-600: #2347c9   --blue-50: #eaf0ff   --blue-100: #dbe4ff
--green: #2e9e5b  --green-50: #e6f6ec   --green-bar: #34c26b
--orange: #e07b18 --orange-50: #fff1df
--gray-chip: #8a92a6 --gray-50: #f1f3f7
--cyan: #4cb3d8   (WH-03 cold-chain badge)
```
Typography (1440 scale): body 13px/1.35 medium-ish (#151a2d); small/sub 11.5px #8a92a6; card titles
15px 700; detail-panel name 18px 800; eyebrow 11px 700 uppercase letter-spacing .04em blue;
KPI value 22px 800 with tabular numbers.

Shared component classes (ui-shell defines in `styles.css`, everybody may use):
- `.card` glass card (bg, blur, border, radius, shadow).
- `.chip` + `.chip--green|--blue|--orange|--gray` → rounded 6px pill, 12px 600, tinted bg + coloured text
  (green `#e6f6ec/#2e9e5b`, blue `#eaf0ff/#3157d5`, orange `#fff1df/#e07b18`, gray `#f1f3f7/#8a92a6`).
- `.bar` (track `#eef1f6`, height 5, radius 3) with child `.bar__fill` (+ `--green|--blue|--orange`).
- `.icon-btn` 30×30 white rounded-8 bordered button; `.icon-btn--active` blue filled with white icon.
- `.kbd` small key hint box (the `/` in the search field).
- `.dot` 7px round status dot (colour via inline style).
- `.muted` text-3 colour.  `.link` blue text, cursor pointer.
- `.fade-enter` / cross-fade helpers as you see fit.

### 2.1 Top bar (`ui-shell`)  — ref `docs/ref/ui/topbar.png`
Left: cube logo (3-tone blue isometric cube) + "WareTrack" 20px 800.
Search field (≈ 400px, left ≈ 270): magnifier icon, placeholder "Search sites, trucks, forklifts,
pallets, shipments...", `/` kbd at right. Pressing `/` focuses it. Typing shows a results dropdown
(`selectors.search(q)`): rows with type icon, title, sub; Enter/click → `store.select({type,id})` and
`bus.emit('camera:locate',{type,id})`; Esc clears.
Right cluster: **site selector** (badge `WH-01` blue rounded-8 square [WH-03 uses `--cyan`], name 14px
700, sub `siteSelectorSub()` 11.5px grey, `›` button = next site, divider, `⌄` button = dropdown; when
'ALL' show badge `ALL` dark-slate and name "Network overview" sub "5 sites · N docked"); **Live pill**
(light-green bg, green dot pulsing, "Live" green 600 + clock `fmtTime(simMinutes)` dark 700);
**bell** with red dot (unread) → notifications dropdown (`db.notifications`); divider; **avatar**
(illustrated SVG person: brown skin, short black hair, beard, navy shirt — in a light-blue circle),
"Alex Chen" 14px 700 / "Operations Manager" 12px grey, chevron → small user menu (Profile, Settings,
Sign out — inert).
Site dropdown — ref `docs/ref/ui/site_dropdown.png`: card under the selector, first row `ALL` dark badge
"Network overview" / "Zoom out to all 5 sites"; then per site: badge, name, right-aligned `%`, a
thin blue bar (fullPct), `siteMenuSub()`. Hover row = `--blue-50`. Click → `store.setSite(id)`.

### 2.2 KPI cards (`ui-shell`) — ref `docs/ref/ui/kpis.png`
`kpis(siteId)` → 3 cards. Icon tile 40×40 `--blue-50` rounded-10 with a blue glyph (cube / truck /
clock). Title 12px text-2; value 22px 800 + green delta `↑ +15` (arrow in a tiny green circle);
sub 11.5px grey (`pallets · WH-01`).

### 2.3 Map controls (`ui-shell`) — ref `docs/ref/ui/map_controls.png`
Vertical white card, 5 icon buttons stacked (+, −, rotate-ccw, rotate-cw, home) separated by space.
Click → `bus.emit('camera:cmd', { cmd: 'zoomIn'|'zoomOut'|'rotateLeft'|'rotateRight'|'home' })`.

### 2.4 Detail panel (`ui-panels`) — refs `docs/ref/ui/panel_*.png`
Right card, content depends on `store.state.selection` (null → site card for `store.state.siteId`;
when siteId==='ALL' and no selection → a "Network overview" card: 5 compact site rows with % bars,
totals tiles). Header: 56×56 rounded-12 illustration tile (light blue-grey bg) + eyebrow (blue caps,
`TYPE · SITE` e.g. `FORKLIFT · WH-01`, `PALLET · PPE` (sku category), `DOCK BAY · WH-04`,
`CHARGER · WH-04`, trucks: carrier fullName caps `WARETRACK FREIGHT`, sites: `DEPOT · WH-01`)
+ name 18px 800 + sub line grey. Header buttons (top-right): **locate** (crosshair) →
`bus.emit('camera:locate', sel)`; **follow ↗** (trucks & forklifts only) toggles
`store.set({followId})` and shows `.icon-btn--active` while following; **✕** → `store.select(null)`.
Site card has locate only (+ a "layers" icon button on WH-05 as in video — inert).
Variants (exact rows from the video):
- **site**: chip `Operational` + `siteActivityLine()`; 2×2 tiles (bg `#f5f7fb` rounded-10):
  "Stock on hand **1,412** / 1,800" + blue bar; "Truck bays **2** / 2 busy" + green bar;
  "Outbound today **23** trucks"; "Put-aways today **15** pallets"; "Inventory ⋯ units" list of 4
  (illustration 28px, name, qty bold right, chip In Stock/Low Stock); "Forklift fleet  1/2 working"
  then first working forklift row: `FL-01  Loading TRK-2051 at Bay 1  [green bar] 75%`.
- **forklift**: chip (`Loading truck`/`Unloading truck`/`Charging`/`Idle`) + task text; battery bar
  green with "Battery 75%" right; rows: Carrying (`Empty` or link `PAL-1060 · LED Panel 60×60`),
  Moves today, Speed `0.0 km/h`, Charger (link `C1`), Site (site name).
- **pallet**: eyebrow `PALLET · <SKU category upper>`, name = SKU name, sub `PAL-1026 · PPE-HLM-Y`;
  chip `Staged` + `WH-01 · Yard slot S01` (or `Moving` + `On forks of FL-01`); rows Quantity
  `82 units`, Gross weight `56 kg`, Location (`WH-01 · Yard slot S01` / `Forklift FL-01`), Lot,
  Received, Site.
- **dock**: name `In 2`, sub = dock.kind; chip (`Booked` + `TRK-2481 due in 3 min` / `Available` +
  `Ready for next truck` / `Unloading` + `TRK-2205 · 2/6 pallets`); rows Truck (link
  `TRK-2481 · Cargoviva` or `—`), Rear doors, Trucks today, Site.
- **charger**: name `C1`, sub = spec; chip `Free` + `FL-10 is out · Unloading TRK-2205 at In 1` or
  `Charging` + `FL-12 · 89%`; rows Forklift (link `FL-10 · battery 85%`), Sessions today, Energy today
  `40.1 kWh`, Charge rate `8% a minute`, Site.
- **truck**: eyebrow carrier fullName caps; name id; sub `driver · plate`; chip + context
  (`Unloading` + `WH-04 · In 1 · 2/6 pallets`; `Docking` + `Reversing into In 3 · WH-04`;
  `En route` + `To WH-04 · ETA 1 min`; `At gate` + `Waiting at gate · WH-04`); progress bar: at a dock →
  green `done/total` right; docking / en route → blue bar `26 m left`; rows Shipment (link
  `#SHP-78450`), Customer, Destination, ETA (`Done in 13 min` / `09:45 (1 min)`), Speed, Bay (link
  dock name · site), Cargo `3/7 pallets · 1.2 t`.
Links (blue) select the referenced entity (`store.select`). Values update live on `data:update`
without re-animating; selection changes cross-fade.

### 2.5 Shipment Tracking (`ui-panels`) — refs `docs/ref/ui/tracker*.png`
Data: `shipmentTracking(store.state.trackedTruckId)`. Header: truck glyph + "Shipment Tracking" 15px
700, right `TRK-2051 · WareTrack` grey. Stepper of 5 (equal columns): icon circle 30px (done: solid
blue, white glyph; current: 38px blue with 6px `--blue-100` halo ring; todo: 30px `#eef1f6` grey glyph),
connector lines 3px (blue between done steps, grey after current), label 12.5px 600 and sub 11px grey.
Right inner card (≈ 230 wide, `#f4f6fb` rounded-12): truck illustration in carrier colour, `#SHP-78442`
700, `To: Philadelphia, PA` grey, chip, foot line grey, chevron `›` (click → select the truck).

### 2.6 Fleet panel (`ui-panels`) — refs `docs/ref/ui/fleet_*.png`
Header: small blue calendar/dock icon tile, segmented control (grey track `#f1f3f7`, active segment
white with shadow) `Docks 2/2 | Forklifts 1/2 | Trucks 2` (counts `fleetCounts()`), right: site
name grey. Rows (`fleetRows(siteId, tab)`), 28px tall, hairline separators: col1 bold title + tiny
grey sub (site id or carrier), col2 dot + text (muted grey italic-ish when "No truck assigned"),
col3 chip (fixed width 74), col4 mini bar 44px + right text 11px, chevron. Row hover bg `#f6f8fc`;
click → `store.select({type,id})`. Tab click → `store.set({fleetTab})`.

---------------------------------------------------------------------------------------------------

## 3. 3D look & feel

- Pastel, matte "clay" look. Use `palette.js` colours/materials (`mat()`, `matTransparent()`). No
  textures from the network; text/logos via `canvasText.js`.
- Renderer: antialias, `outputColorSpace = SRGBColorSpace`, tone mapping `NeutralToneMapping`
  (exposure ≈ 1.05) — tune against the frames; soft shadows (`PCFSoftShadowMap`, 4096 map, shadow
  camera ±130 m that **follows the controls target**), `setPixelRatio(min(devicePixelRatio, 2))`.
- Lights: `HemisphereLight(#ffffff, #dfe5f5, ~1.6)` + key `DirectionalLight(#fff6ea, ~2.2)` from the
  south-west-high so shadows fall north-east (toward upper-right on screen, as in the video)
  + subtle fill. Background & fog `C.sky` (#eef1fa), `Fog(near≈420, far≈1100)`.
- Camera: `PerspectiveCamera(fov 28)`. Default site view: azimuth ≈ 45° (camera sits +X/+Z of the
  target), polar ≈ 50° from vertical, distance ≈ 150–230 m depending on site size.
- Scale: 1 unit = 1 metre, Y up, ground y = 0.
- Selection visuals: corner brackets colour `#3b5bdb`, faint blue box fill (opacity .06), ground glow
  disc (radial gradient `#5a7cff` → transparent, opacity .35).

## 4. Coordinate & model conventions

- Every model factory returns a `THREE.Group` with origin at the **ground centre of its footprint**
  (y = 0 at the bottom), shadows enabled (`shadows(group)`), sharing palette materials.
- Vehicles face **+Z** (cab / mast at +Z). Heading `h` ⇒ `object.rotation.y = h`, forward vector
  `(sin h, 0, cos h)`.
- Buildings: local X = width, Z = depth. Faces: `south` = +Z, `north` = −Z, `east` = +X, `west` = −X.
- Keep draw calls sane: merge static geometry where easy (`BufferGeometryUtils.mergeGeometries`),
  use `InstancedMesh` for repeated city clutter / trees / fence panels when counts are large.

### 4.1 `src/three/models/truck.js` (vehicles)
```js
export function createTruck({ carrier = 'waretrack', reefer = false } = {}) // → THREE.Group
```
Box truck ≈ 10.5 m long (cab ≈ 2.6 m at +Z, box ≈ 7.4 m), 2.5 m wide, box top ≈ 3.9 m. Rounded cab,
dark windscreen, side mirrors, 3 axles (1 front, 2 rear) with black tyres + light hubs, bumper,
headlights. Liveries (see frames 01, 05, 13, 16, 20, 23):
- `waretrack`: **blue cab**, white box, blue lower band + blue roof edge, "WareTrack" + cube logo on
  both box sides (blue text), small subtitle line.
- `bluepeak`: white cab with navy stripe, white box with navy lower band, "Bluepeak" navy + mountain glyph.
- `nordline`: white cab with teal stripe, white box with teal swoosh band, "Nordline" teal + "N" glyph.
- `cargoviva`: white cab with orange stripe, white box with orange lower band, "Cargoviva" orange italic.
- `reefer: true` adds a refrigeration unit on the box front-top.
`userData = { kind:'truck', length, width, height, rearZ, wheels: Mesh[] }` (wheels spin about local X).

### 4.2 `src/three/models/forklift.js` (vehicles)
```js
export function createForklift({ operator = true } = {}) // → THREE.Group
```
≈ 2.4 m body + 1.1 m forks at +Z, 1.15 m wide, overhead guard top ≈ 2.25 m. Yellow body
(`C.forkYellow`), blue chassis skirt/base (`C.forkBlue`), black mast + overhead guard + counterweight
detail, black tyres, seated operator (orange vest, skin head, yellow hard hat).
`userData = { kind:'forklift', forkAnchor: Object3D, mast, setForkHeight(h), wheels }` — a pallet
Group added as a child of `forkAnchor` (at local origin) sits correctly on the forks.

### 4.3 `src/three/models/pallet.js` (cargo-props)
```js
export function createPallet({ kind = 'cardboard', layers = 2, seed = 0 } = {}) // → THREE.Group
```
1.2 × 1.0 m wooden pallet (slats, 0.15 m) + load ≈ 1.2–1.4 m: `cardboard` = brown boxes (slight
per-box tint variation by seed, lighter tape strips), `blue` = blue stretch-wrapped carton block
(rounded, subtle wrap lines), `white` = white wrapped block. `userData = { kind:'pallet', height }`.

### 4.4 `src/three/models/props.js` (cargo-props)
```js
export function createTree({ size = 1, seed = 0 } = {})          // mint-green rounded canopy + brown trunk, ≈ 4.5 m
export function createBush({ size = 1 } = {})
export function createFence(length, { height = 2.2 } = {})       // runs along +X from origin; posts every 3 m, translucent panels
export function createRack({ bays = 2, levels = 3, fill = 0.8, seed = 0 } = {}) // blue uprights, orange beams, boxes
export function createContainer({ color = C.container, label = 'MAERA LINE', length = 12.2 } = {}) // ribbed shipping container
export function createCharger() // white cabinet ≈ 0.7×0.5×1.6 m, dark screen, green LED, faces +Z
export function createMapPin({ color = C.blue, scale = 1 } = {}) // teardrop pin ≈ 2.4 m, white centre dot, origin at the tip; userData.head (bob this)
export function createParkingBay(width, length, { color = C.yellowLine, line = 0.18 } = {}) // flat outline at y≈0.03, centred
export function createACUnit() // rooftop condenser ≈ 2.2×1.2×0.8 m, two dark round fans on top
export function createSilo({ radius = 2.2, height = 9 } = {})
export function createGuardBooth()
export function createCityBuilding({ w, d, h, style = 'office', seed = 0 } = {}) // 'office' (white, blue window grid) | 'warehouse' (white walls, light-grey roof) | 'block'
export function createGlowDisc(radius, color = C.selectGlow, opacity = 0.35) // radial-gradient ground decal (transparent, depthWrite false), lies on XZ
export function createCrosswalk(width, length)
```

### 4.5 `src/three/models/warehouse.js` (buildings)
```js
export function createWarehouse(spec) // → THREE.Group
// spec = { variant, width, depth, height, label, sign, subtitle,
//          doors: [{ id, side, offset, width = 3.6, height = 4.2, number, state = 'open'|'closed', cargo = true }] }
// userData = { kind:'warehouse', doorAnchors: { [doorId]: { position: Vector3, normal: Vector3 } }, // LOCAL, ground level, 0.6 m outside the door / platform edge
//              footprint: { width, depth }, height, extents: Box3 /* local, incl. attached parts */ }
```
Variants (study the frames!):
- `depot` (WH-01, frames 01–04, 25): two joined **blue corrugated** halls — a taller rear hall with a
  low gable roof and a lower front hall with gable roof; vertical corrugation ribs; white trim on
  edges/ridge; front (south) facade lower part light grey/white with 3 big blue-framed dock openings
  showing stacked cardboard boxes inside; a white round roof badge with the cube logo + "WH-01".
- `dc` (WH-02, frames 15, 16): long white box (≈ 90×36 m, 10 m), flat light roof with blue parapet
  band, row of 8 dock doors (open, boxes inside, small blue number plates `D1…`), blue glass office
  block at the west end (curtain-wall grid), wall sign "WareTrack / WH-02 · Northgate DC", AC units.
- `cold` (WH-03, frames 17, 18, 19, 28): big white insulated box (≈ 70×44 m, 11 m), flat roof with
  ~12 condenser units around the edges and a blue hexagon logo, blue vertical corner trims + blue roof
  band, a **raised loading platform** (≈ 1.3 m) with yellow edge along the south face, 4 narrow
  blue-framed doors partially open; door anchors on the platform edge.
- `crossdock` (WH-04, frames 07, 09, 21): white walls (≈ 80×50 m, 8 m) with a **blue sawtooth roof**
  (5–6 teeth), dock doors on two faces (In 1–3 on south, Out 1–3 on east), each blue-framed with boxes
  visible, large "WareTrack" wall sign near a corner.
- `robotics` (WH-05, frames 22, 23): very large white box (≈ 100×60 m, 12 m) with thin blue band lines
  at roof edge and vertical corners, flat roof with skylight strips + a few AC units + blue logo,
  4 closed light-grey roller doors with blue frames on the south face.
All variants: small blue door number plates above doors, the WareTrack sign (cube logo + text) on a
visible facade, shadows.

---------------------------------------------------------------------------------------------------

## 5. World — `src/data/layout.js`, `src/three/world.js`, `src/three/environment.js` (world)

Site lot centres come from `SITES[i].world` (WH-01 (0,0), WH-02 (300,−40), WH-03 (600,20),
WH-04 (120,300), WH-05 (460,320)); you may nudge them **only via layout.js** (and then also use the
nudged values everywhere — `layout.siteOrigin(id)`), never by editing mockData.

`environment.js`: ground, city road grid (2–4 lanes, periwinkle asphalt, white dashed centre lines,
light sidewalks/curbs, crosswalk stripes at intersections), fences along lot edges, rows of trees on
mint grass strips, filler city (office blocks with blue window grids, white warehouses, container
yards, parked trucks), ambient traffic (non-pickable trucks looping along public roads). Everything
static should be merged/instanced. Extend to ≈ ±900 m so the network overview and flights look full.

`layout.js` (consumed by world + simulation; all coordinates **world space**):
```js
export function siteOrigin(siteId)          // {x,z}
export function siteLayout(siteId)          // object below
{
  origin:{x,z}, rotY,                                   // building rotation if any
  building: <warehouse spec>,                            // passed to createWarehouse
  docks:      { [dockId]: { x, z, heading } },           // truck pose when docked (rear at the door; heading points away from door)
  dockApproach:{ [dockId]: [{x,z}, ...] },               // gate → pull-forward point (truck then reverses straight to the dock pose)
  gate: {x,z},
  arrivalRoute: [{x,z}, ...],                            // far spawn on a public road → gate
  departureRoute: [{x,z}, ...],                          // gate → far away
  slots:      { [slotCode]: { x, z, heading } },         // pallet staging slots 'S01'…
  chargers:   { [chargerId]: { x, z, heading } },        // forklift parking pose at that charger (cabinet behind it)
  dockWork:   { [dockId]: { x, z, heading } },           // where a forklift stands to pick/drop at the truck rear
  parking:    [{ x, z, heading }],                       // spare truck parking
  view:       { target:{x,y,z}, distance, azimuth, polar } // default camera for this site
}
export function networkView()               // camera view showing all 5 sites
export function applyInitialPoses(db)       // set position/heading of every truck/forklift/pallet from status
```
Make sure every `dockId`, `slot` and `chargerId` in mockData has an entry. Arrange each site to
resemble its frames (yard on the visible south/east side, truck bays with yellow outlines in front of
docks, staging slots with pins, charging area with a green glow pad, decorative pallets/racks/
containers as in the frames).

`world.js`:
```js
export function createWorld(app) // app from createScene
→ {
  root,                         // THREE.Group added to app.scene
  pickables,                    // Object3D[] — entity roots; each has userData.ref = { type, id }
  getObject(type, id),          // root Object3D of an entity (site → its building group)
  getEntityPosition(type, id, out = new THREE.Vector3()), // world position (ground centre)
  getEntityBox(type, id, out = new THREE.Box3()),          // world AABB for brackets
  getSiteView(siteId),          // layout view
  getNetworkView(),
  update(dt, elapsed),          // sync meshes from entity.position/heading every frame
}
```
- One mesh per entity: trucks (`createTruck({carrier, reefer})`), forklifts, pallets (kind from SKU),
  chargers (`createCharger`), docks (an **invisible pick volume** ≈ 4.5 × 4.5 × 16 m covering the bay
  in front of the door + the door), sites (the building group, ref `{type:'site'}`).
- `update`: copy `position`/`heading` → object; spin wheels by distance moved; pallets with
  `carriedBy` are re-parented onto that forklift's `forkAnchor` (and back to the world when dropped);
  pallets with `status === 'loaded'` are hidden; a forklift with `carryingKind` (and no
  `carryingPalletId`) shows a generic pallet of that kind on its forks; bob map pins over
  `pinned` pallets; chargers with a charging forklift get a pulsing green glow.

## 6. Scene — `scene.js`, `cameraDirector.js`, `interaction.js` (scene)

```js
// scene.js
export function createScene(container) → {
  renderer, scene, camera, controls /* OrbitControls */, labelRenderer /* CSS2DRenderer */, dom: container,
  onFrame(cb /* (dt, elapsed) */) → unsubscribe,
  start(),
  flyTo({ target:{x,y,z}, distance?, azimuth?, polar?, duration = 1.2, arc = false }) → Promise, // eased; arc rises mid-flight (site-to-site flights)
  getView() → { target: Vector3, distance, azimuth, polar },
  cancelFlight(),
}
```
Controls: left-drag = **pan on the ground plane** (`screenSpacePanning = false`), right-drag =
rotate, wheel = zoom (to cursor), damping on, polar clamp [0.35, 1.25] rad, distance [18, 1400],
cursor `grab`/`grabbing`. Shadow camera follows the controls target.

```js
// cameraDirector.js
export function createCameraDirector(app, world) → { update(dt, elapsed) }
```
- `store.siteId` change → `flyTo(world.getSiteView(id) | world.getNetworkView(), {duration≈1.8, arc:true})`
  unless the same `store.set` also set a non-site selection (then fly straight to that entity).
- `store.selection` change → ease target to the entity (`getEntityPosition`) keeping azimuth/polar,
  distance = clamp(current, 45, 110) (site selection → site view).
- `bus 'camera:locate' {type,id}` → fly close (distance ≈ 40, polar ≈ 0.9).
- `bus 'camera:cmd'` → zoomIn ×0.75 · zoomOut ×1.33 · rotateLeft/Right ±π/6 azimuth · home → site view.
- `store.followId` → each frame lerp the target to that entity.

```js
// interaction.js  (imports './interaction.css')
export function createInteraction(app, world) → { update(dt, elapsed) }
```
- Raycast `world.pickables` on pointer move (throttle to rAF); walk up parents to `userData.ref`;
  `store.set({hover})`; click (pointer moved < 5 px) → `store.select(ref)`; click empty ground →
  nothing (keep selection; Esc clears).
- Hover + selection visuals: corner brackets (12 short edge segments at the 8 corners of the AABB,
  thick lines via thin boxes or `Line2`) + faint fill + ground glow; CSS2D label pill above the box top:
  `<div class="wt-tag"><b>FL-01</b><span>Loading truck</span></div>` (blue `#2f5bea` bg, white bold
  id, translucent-white text, rounded 7px, 11.5px, small down-pointer). Text from
  `entityTag(type, entity)` — update live.
- **Truck route viz** for the selected truck when it has `truck.path` (array of {x,z}, remaining route)
  and status ∈ en_route/at_gate/docking: blue ribbon 1.8 m wide on the ground with white chevrons
  scrolling toward the target, a dotted line of blue discs for the final reverse segment, a blue pin +
  pulsing ring at `truck.target` (the dock pose).

## 7. Simulation — `src/state/simulation.js` (phase B)

```js
export function createSimulation(world) → { update(dt, elapsed), setSpeed(mult) }
```
- Owns every live mutation of the db: sim clock (1 sim-minute ≈ 5 real s; `store.set({simMinutes})`
  only when the whole minute changes), truck state machine
  `en_route → at_gate → docking → (unloading|loading) → departing → (respawn as en_route)` moving along
  `layout` routes (drive forward on roads ≈ 8–12 m/s visual, slow down near the gate, reverse into the
  dock ≈ 2 m/s), keeps `truck.path`, `truck.target`, `distanceLeftM`, `speedKmh`, `etaMin`, progress,
  dock statuses (`booked → docking → unloading → available`), shipment ETAs; forklifts shuttle between
  `dockWork` and `slots` carrying pallets (generic `carryingKind` or a real pallet via
  `carryingPalletId`/`pallet.carriedBy`), `task` strings like the video, battery drain/charge,
  `movesToday`; charger status; site stock/putaways counters.
- Emits `bus.emit('data:update', { simMinutes })` ≈ 4×/s.

## 8. Store & events (lead, done) — `src/state/store.js`

State: `siteId`, `selection`, `hover`, `fleetTab`, `trackedTruckId`, `followId`, `simMinutes`,
`menu`, `searchQuery`. Helpers: `store.select(ref|null)`, `store.setSite(id|'ALL')`.
Bus events:
| event | payload | emitted by |
|---|---|---|
| `data:update` | `{ simMinutes }` | simulation (≈4 Hz) |
| `camera:cmd` | `{ cmd }` | map controls |
| `camera:locate` | `{ type, id }` | detail panel crosshair, search |

Data access: `db` (`src/data/db.js`), derived views in `src/data/selectors.js`, formatting/status
vocabulary in `src/data/format.js`. **UI must only read data through these.**

## 9. Acceptance checklist
- `npx vite build` succeeds with zero errors; no console errors at runtime.
- Initial screen ≈ frame `01_wh01_overview` (layout, colours, typography, content values).
- Hover/click/close/locate/follow work on trucks, forklifts, pallets, docks, chargers, buildings.
- Site switching flies over the city; Network overview shows all 5 sites.
- Live simulation visibly runs (clock, motion, counters) and the UI stays in sync.
- 60 fps target on a laptop GPU (keep draw calls < ~1500, merge/instance static clutter).
