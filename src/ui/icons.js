// Inline SVG icon set for the WareTrack overlay.
//
//   icon(name, size = 16, attrs = {}) → '<svg …>…</svg>' string
//     - stroke icons: 24-unit viewBox, currentColor, round caps/joins. The stroke is kept at
//       ≈1.8 px on screen whatever the size (pass attrs.sw to change the on-screen width,
//       or attrs['stroke-width'] to set it in viewBox units).
//     - filled icons (logoCube, cubeSolid, truck, clockSolid, dock): currentColor fills; logoCube /
//       cubeSolid are the 3-tone blue brand cube. Truck wheels / clock hands use
//       `var(--icon-cut, #fff)` so they can be matched to the background they sit on.
//     - any other attrs are written onto the <svg> (class, style, aria-label, …).
//   avatar(size = 40) → illustrated "Alex Chen" portrait (light blue circle).

const STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"'
const CUT = 'style="fill:var(--icon-cut,#fff)"'

// 8-tooth cog outline (generated once; avoids a huge hand-written path)
const GEAR = (() => {
  const pts = []
  const teeth = 8
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2 + Math.PI / (teeth * 4)
    const r = i % 4 < 2 ? 9.2 : 7.1
    pts.push(`${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
})()

/** Brand cube: 3-tone isometric box with a white tape stripe. */
const CUBE_SOLID = `
  <path d="M12 2.4 20.6 7.2 12 12 3.4 7.2Z" fill="#7d97f7"/>
  <path d="M3.4 7.2 12 12v9.8l-8.6-4.8Z" fill="#2f5bea"/>
  <path d="M20.6 7.2V17L12 21.8V12Z" fill="#2347c9"/>
  <path d="M3.4 7.2 12 2.4l8.6 4.8V17L12 21.8 3.4 17Z" fill="none" stroke="#2a52dc" stroke-width=".7" stroke-linejoin="round" opacity=".55"/>
  <path d="M7.7 4.8 16.3 9.6v4.6" fill="none" stroke="#fff" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>`

// name → [kind, svg body]; kind 's' = stroke, 'f' = filled
const ICONS = {
  search: ['s', '<circle cx="11" cy="11" r="6.6"/><path d="m16 16 4.4 4.4"/>'],
  chevronRight: ['s', '<path d="m9.5 6 6 6-6 6"/>'],
  chevronLeft: ['s', '<path d="m14.5 6-6 6 6 6"/>'],
  chevronDown: ['s', '<path d="m6 9.5 6 6 6-6"/>'],
  chevronUp: ['s', '<path d="m6 14.5 6-6 6 6"/>'],
  bell: ['s', '<path d="M6.2 16.6V10.4a5.8 5.8 0 0 1 11.6 0v6.2l1.7 1.9H4.5Z"/><path d="M10 21a2.1 2.1 0 0 0 4 0"/>'],
  plus: ['s', '<path d="M12 5v14M5 12h14"/>'],
  minus: ['s', '<path d="M5 12h14"/>'],
  rotateLeft: ['s', '<path d="M4.6 12.4a7.4 7.4 0 1 0 2.3-5.6L4.6 9"/><path d="M4.6 4.6V9H9"/>'],
  rotateRight: ['s', '<path d="M19.4 12.4a7.4 7.4 0 1 1-2.3-5.6L19.4 9"/><path d="M19.4 4.6V9H15"/>'],
  home: ['s', '<path d="M5 10.4 12 4.5l7 5.9v8.4a1.2 1.2 0 0 1-1.2 1.2h-4.1v-3.6h-3.4V20H6.2A1.2 1.2 0 0 1 5 18.8Z"/>'],
  crosshair: ['s', '<circle cx="12" cy="12" r="6.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'],
  arrowUpRight: ['s', '<path d="M7 17 17 7M8.5 7H17v8.5"/>'],
  arrowUp: ['s', '<path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5"/>'],
  close: ['s', '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>'],
  clipboard: ['s', '<rect x="5.5" y="4.5" width="13" height="16.5" rx="2"/><path d="M9 4.5V3.6c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v.9"/><path d="M9 10h6M9 13.5h6M9 17h3.5"/>'],
  box: ['s', '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/><path d="m8 5.2 8 4.6"/>'],
  package: ['s', '<rect x="4" y="5" width="16" height="15" rx="2.2"/><path d="M4 9.6h16"/><path d="M10 13.4h4"/>'],
  cube: ['s', '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'],
  check: ['s', '<path d="m5 12.5 4.5 4.5L19 7.5"/>'],
  clock: ['s', '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>'],
  layers: ['s', '<path d="m12 3.5 8.5 4.6L12 12.7 3.5 8.1Z"/><path d="m3.5 12 8.5 4.6 8.5-4.6"/><path d="m3.5 15.9 8.5 4.6 8.5-4.6"/>'],
  battery: ['s', '<rect x="2.8" y="7.4" width="16" height="9.2" rx="2.2"/><path d="M21.2 10.6v2.8"/><rect x="5.4" y="10" width="7.6" height="4" rx=".8" fill="currentColor" stroke="none"/>'],
  user: ['s', '<circle cx="12" cy="8.2" r="3.9"/><path d="M4.6 20.2c.9-3.7 3.8-5.7 7.4-5.7s6.5 2 7.4 5.7"/>'],
  settings: ['s', `<path d="${GEAR}"/><circle cx="12" cy="12" r="2.9"/>`],
  logout: ['s', '<path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14"/><path d="M9.5 16 5.5 12l4-4M5.5 12h10"/>'],
  alert: ['s', '<path d="M10.3 4.6a2 2 0 0 1 3.4 0l7.2 12.6a2 2 0 0 1-1.7 3H4.8a2 2 0 0 1-1.7-3Z"/><path d="M12 9.6v4"/><circle cx="12" cy="16.9" r=".6" fill="currentColor"/>'],
  info: ['s', '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r=".6" fill="currentColor"/>'],
  bolt: ['s', '<path d="M13.2 3 5.6 13.4h5.6L10.6 21l7.8-10.6h-5.6Z"/>'],
  mapPin: ['s', '<path d="M12 21s-6.4-5.6-6.4-10.6a6.4 6.4 0 0 1 12.8 0C18.4 15.4 12 21 12 21Z"/><circle cx="12" cy="10.3" r="2.3"/>'],
  warehouse: ['s', '<path d="M3.5 9.4 12 4.5l8.5 4.9V20h-17Z"/><path d="M7.5 20v-7h9v7M7.5 15.5h9M7.5 17.8h9"/>'],
  forklift: ['s', '<path d="M3.5 17.5V9.5h5.2l2.6 4.2v3.8"/><path d="M8.7 9.5V5.5H5.2v4"/><path d="M15.5 4v13.5h5"/><circle cx="6" cy="18.2" r="1.8"/><circle cx="12.2" cy="18.2" r="1.8"/>'],
  route: ['s', '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18h7.3a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6h7.3"/>'],
  more: ['s', '<circle cx="6" cy="12" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="18" cy="12" r="1.1" fill="currentColor"/>'],

  // ── filled glyphs ──
  logoCube: ['f', CUBE_SOLID],
  cubeSolid: ['f', CUBE_SOLID],
  truck: ['f', `
    <rect x="1.8" y="5.2" width="12.6" height="11.2" rx="1.6" fill="currentColor"/>
    <path d="M15.4 8.4h3.1c.5 0 .9.2 1.2.6l2.2 3.1c.2.3.3.6.3.9v2.6c0 .5-.4.9-.9.9h-5.9Z" fill="currentColor"/>
    <path d="M17.2 9.9h1.4l1.7 2.4h-3.1Z" ${CUT} opacity=".55"/>
    <circle cx="6.6" cy="17.3" r="2.5" fill="currentColor"/><circle cx="6.6" cy="17.3" r="1.05" ${CUT}/>
    <circle cx="17.6" cy="17.3" r="2.5" fill="currentColor"/><circle cx="17.6" cy="17.3" r="1.05" ${CUT}/>`],
  clockSolid: ['f', `
    <circle cx="12" cy="12" r="9.6" fill="currentColor"/>
    <path d="M12 6.8V12.4l3.4 2.1" fill="none" ${CUT.replace('fill', 'stroke')} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`],
  dock: ['f', `
    <rect x="2.6" y="3.6" width="18.8" height="16.8" rx="3.4" fill="currentColor"/>
    <rect x="2.6" y="3.6" width="18.8" height="5.2" rx="2.6" fill="#fff" opacity=".28"/>
    <path d="M6.8 12.2h10.4M6.8 15.4h10.4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".75"/>`],
}

export const ICON_NAMES = Object.keys(ICONS)

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/**
 * @param {string} name   one of ICON_NAMES
 * @param {number} size   rendered px (square)
 * @param {object} attrs  extra <svg> attributes; `sw` = on-screen stroke width in px
 */
export function icon(name, size = 16, attrs = {}) {
  const def = ICONS[name]
  if (!def) {
    console.warn(`[icons] unknown icon "${name}"`)
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"></svg>`
  }
  const [kind, body] = def
  const { sw = 1.8, ...rest } = attrs
  const strokeWidth = rest['stroke-width'] ?? +(sw * 24 / size).toFixed(2)
  delete rest['stroke-width']
  const extra = Object.entries(rest).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')
  const paint = kind === 's' ? ` ${STROKE} stroke-width="${strokeWidth}"` : ''
  const hidden = 'aria-label' in rest ? '' : ' aria-hidden="true"'
  return `<svg class="wt-icon wt-icon--${name}" width="${size}" height="${size}" viewBox="0 0 24 24"${paint}${hidden} focusable="false"${extra}>${body}</svg>`
}

let avatarSeq = 0

/** Illustrated portrait used for the signed-in user (brown skin, short black hair, beard, navy shirt). */
export function avatar(size = 40) {
  const id = `wt-av-${++avatarSeq}`
  return `<svg class="wt-avatar" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
  <defs>
    <clipPath id="${id}"><circle cx="20" cy="20" r="20"/></clipPath>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e6ebf6"/><stop offset="1" stop-color="#d3dbee"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#${id})">
    <rect width="40" height="40" fill="url(#${id}-bg)"/>
    <path d="M6.5 40c.6-6.2 4.6-9.4 9.4-10.4h8.2c4.8 1 8.8 4.2 9.4 10.4Z" fill="#26386f"/>
    <path d="M16.4 29.4h7.2l-3.6 5.4Z" fill="#f4f6fb"/>
    <path d="M17.3 24.6h5.4v5.6l-2.7 3.1-2.7-3.1Z" fill="#9a6142"/>
    <ellipse cx="13.6" cy="17.6" rx="1.3" ry="1.8" fill="#a8694a"/>
    <ellipse cx="26.4" cy="17.6" rx="1.3" ry="1.8" fill="#a8694a"/>
    <path d="M13.9 15.2c0-4.4 2.7-7 6.1-7s6.1 2.6 6.1 7v4.4c0 3.9-2.6 7.1-6.1 7.1s-6.1-3.2-6.1-7.1Z" fill="#b8784f"/>
    <path d="M13.9 17.6c.4 2.6 1.3 3.5 2.4 3.9 1.2.4 1.6-.6 3.7-.6s2.5 1 3.7.6c1.1-.4 2-1.3 2.4-3.9v2.5c0 4.4-2.7 7.6-6.1 7.6s-6.1-3.2-6.1-7.6Z" fill="#2a1d18"/>
    <path d="M18 23.3c.6.5 1.2.7 2 .7s1.4-.2 2-.7" fill="none" stroke="#7a4732" stroke-width=".8" stroke-linecap="round"/>
    <path d="M13.5 16.4c-.5-5.6 1.9-9.4 6.5-9.4 4.7 0 7 3.6 6.5 9.4l-.9-.2c-.2-2.3-.8-3.7-1.9-4.4-1.7.9-4.6 1.2-8.4.6-.6.9-.9 2.2-1 3.8Z" fill="#1d1715"/>
    <circle cx="17.6" cy="17" r=".75" fill="#20160f"/>
    <circle cx="22.4" cy="17" r=".75" fill="#20160f"/>
    <path d="M16.4 15.2c.6-.4 1.4-.5 2.1-.3M21.5 14.9c.7-.2 1.5-.1 2.1.3" fill="none" stroke="#2a1d18" stroke-width=".8" stroke-linecap="round"/>
  </g>
</svg>`
}
