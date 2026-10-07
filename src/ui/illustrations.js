// Soft, isometric SVG illustrations for the UI thumbnails: inventory rows, detail-panel header
// tiles and the Shipment Tracking card. Everything is drawn in a 48×48 viewBox with a tiny
// isometric "painter" (3-tone gradient shading per material) so the look stays consistent.
//
//   illustration(name, size = 28, opts = {}) → SVG markup string (cached per name/size/opts)
//
// items:    box, container, helmet, tape, panel, chair, gloves, frozen, water
// entities: site, network, truck, forklift, pallet, dock, charger, trackerTruck
// opts:     color (site body / carrier colour for trucks), solidCab (trucks), kind (pallet load)

const COS30 = Math.cos(Math.PI / 6)
const BLUE = '#2f5bea'
const cache = new Map()
let uid = 0

export function illustration(name, size = 28, opts = {}) {
  const key = `${name}|${size}|${opts.color ?? ''}|${opts.solidCab ?? ''}|${opts.kind ?? ''}`
  let svg = cache.get(key)
  if (!svg) {
    const draw = DRAW[name] ?? DRAW.box
    const p = painter(`wti${(uid++).toString(36)}`)
    const body = draw(p, opts)
    svg = `<svg class="illu illu--${name}" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">`
      + `<defs>${p.defs.join('')}</defs>${body}</svg>`
    cache.set(key, svg)
  }
  return svg
}

/** Illustration key for a SKU (falls back to a cardboard box). */
export const skuIllustration = (sku) => (sku?.icon && DRAW[sku.icon] ? sku.icon : 'box')

// ───────────────────────────── colour helpers ─────────────────────────────

const toRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

/** t > 0 lightens toward white, t < 0 darkens toward a deep navy (keeps shading cool & pastel). */
export function tint(hex, t) {
  const to = t >= 0 ? [255, 255, 255] : [22, 28, 60]
  const a = Math.abs(t)
  const [r, g, b] = toRgb(hex).map((c, i) => Math.round(c + (to[i] - c) * a))
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

// ───────────────────────────── isometric painter ─────────────────────────────
// World axes: +x → screen down-right, +z → screen down-left, +y → up. Visible faces: top (+y),
// right (+x, lit) and left (+z, shaded).

function painter(prefix) {
  const defs = []
  const mats = new Map()
  let n = 0
  let ox = 24
  let oy = 30
  let k = 10
  const r2 = (v) => Math.round(v * 100) / 100
  const P = (x, y, z) => [r2(ox + (x - z) * COS30 * k), r2(oy + (x + z) * 0.5 * k - y * k)]
  const pts = (list) => list.map((q) => P(...q).join(',')).join(' ')

  const p = {
    defs,
    P,
    view(cx, cy, scale) { ox = cx; oy = cy; k = scale; return p },

    lin(c1, c2, [x1, y1, x2, y2] = [0, 0, 0, 1]) {
      const id = `${prefix}${n++}`
      defs.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`
        + `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`)
      return `url(#${id})`
    },

    rad(stops, cx = 0.5, cy = 0.5, r = 0.5) {
      const id = `${prefix}${n++}`
      const s = stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')
      defs.push(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${s}</radialGradient>`)
      return `url(#${id})`
    },

    /** 3-tone gradient material for a base colour. */
    mat(hex) {
      if (!mats.has(hex)) {
        mats.set(hex, {
          top: p.lin(tint(hex, 0.3), tint(hex, 0.12), [0, 0, 1, 1]),
          right: p.lin(tint(hex, 0.04), tint(hex, -0.06)),
          left: p.lin(tint(hex, -0.14), tint(hex, -0.24)),
        })
      }
      return mats.get(hex)
    },

    poly(list, fill, extra = '') { return `<polygon points="${pts(list)}" fill="${fill}"${extra}/>` },

    line(list, stroke, width = 0.6, extra = '') {
      return `<polyline points="${pts(list)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`
    },

    /** Axis-aligned box: corner (x,y,z), size (w along x, h along y, d along z). */
    box(x, y, z, w, h, d, m, faces = 'tlr') {
      const X = x + w
      const Y = y + h
      const Z = z + d
      let s = ''
      if (faces.includes('l')) s += p.poly([[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]], m.left ?? m)
      if (faces.includes('r')) s += p.poly([[X, y, z], [X, y, Z], [X, Y, Z], [X, Y, z]], m.right ?? m)
      if (faces.includes('t')) s += p.poly([[x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z]], m.top ?? m)
      return s
    },

    /** Flat rectangles lying on a +x face, a +z face or the top plane. */
    quadX(x, y0, y1, z0, z1, fill, extra) { return p.poly([[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]], fill, extra) },
    quadZ(z, x0, x1, y0, y1, fill, extra) { return p.poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], fill, extra) },
    quadY(y, x0, x1, z0, z1, fill, extra) { return p.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], fill, extra) },

    /** 2D content mapped onto a face. u runs "rightwards" on the face, v downwards, 1 unit = 1 m. */
    onX(x, yTop, zLeft, content) {
      const [ex, ey] = P(x, yTop, zLeft)
      return `<g transform="matrix(${r2(COS30 * k)} ${r2(-0.5 * k)} 0 ${r2(k)} ${ex} ${ey})">${content}</g>`
    },
    onZ(z, yTop, xLeft, content) {
      const [ex, ey] = P(xLeft, yTop, z)
      return `<g transform="matrix(${r2(COS30 * k)} ${r2(0.5 * k)} 0 ${r2(k)} ${ex} ${ey})">${content}</g>`
    },
    onY(y, x0, z0, content) {
      const [ex, ey] = P(x0, y, z0)
      return `<g transform="matrix(${r2(COS30 * k)} ${r2(0.5 * k)} ${r2(-COS30 * k)} ${r2(0.5 * k)} ${ex} ${ey})">${content}</g>`
    },

    /** Soft contact shadow (screen space). */
    shadow(cx, cy, rx, ry, a = 0.2) {
      const fill = p.rad([[0, '#1c2c6e', a], [0.6, '#1c2c6e', a * 0.45], [1, '#1c2c6e', 0]])
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`
    },

    /** Wheel seen on a +x side: dark tyre + light hub. */
    wheelX(x, y, z, r) {
      return p.onX(x, y + r, z + r, `<circle cx="${r}" cy="${r}" r="${r}" fill="#262a35"/>`
        + `<circle cx="${r}" cy="${r}" r="${r * 0.48}" fill="#c3c9d6"/><circle cx="${r}" cy="${r}" r="${r * 0.18}" fill="#8e97ab"/>`)
    },
  }
  return p
}

// ───────────────────────────── drawings ─────────────────────────────

const CARD = '#e0b47e'
const TAPE = '#f0d3a3'

function carton(p, x, y, z, w, h, d, color = CARD, tape = true) {
  let s = p.box(x, y, z, w, h, d, p.mat(color))
  if (tape) {
    const cx = x + w / 2
    const tw = Math.min(w, d) * 0.09
    s += p.quadY(y + h, cx - tw, cx + tw, z, z + d, tint(TAPE, 0.15))
    s += p.quadZ(z + d, cx - tw, cx + tw, y + h * 0.72, y + h, tint(TAPE, -0.06))
  }
  return s
}

function truckBody(p, o, detail) {
  const color = o.color ?? BLUE
  const solidCab = o.solidCab ?? color.toLowerCase() === BLUE
  const cabColor = solidCab ? color : '#f4f6fb'
  const white = p.mat('#f6f8fd')
  const dark = '#1f2635'
  let s = ''
  // chassis + rear wheels first (back to front)
  s += p.box(-0.5, 0.18, -2.15, 1.0, 0.22, 3.55, p.mat('#3a4050'))
  // cargo box
  s += p.box(-0.64, 0.4, -2.25, 1.28, 1.55, 2.8, white)
  s += p.quadX(0.64, 0.4, 0.66, -2.25, 0.55, p.lin(tint(color, 0.06), tint(color, -0.08)))
  s += p.quadZ(0.55, -0.64, 0.64, 0.4, 0.66, tint(color, -0.18))
  if (detail) {
    // blue outline on the box edges + roof edge, like the video's tracker drawing
    const e = tint(color, 0.15)
    s += p.line([[0.64, 0.66, 0.55], [0.64, 1.95, 0.55], [0.64, 1.95, -2.25], [0.64, 0.66, -2.25]], e, 0.7)
    s += p.line([[-0.64, 1.95, 0.55], [0.64, 1.95, 0.55]], e, 0.7)
    s += p.line([[-0.64, 1.95, -2.25], [-0.64, 1.95, 0.55]], tint(e, 0.3), 0.5)
    // logo + text lines on the box side
    s += p.onX(0.64, 1.62, -0.05, `<rect x="0" y="0" width=".42" height=".42" rx=".06" fill="${color}"/>`
      + `<rect x=".58" y=".06" width="1.25" height=".13" rx=".06" fill="${tint(color, 0.15)}"/>`
      + `<rect x=".58" y=".28" width=".8" height=".08" rx=".04" fill="${tint(color, 0.5)}"/>`)
  } else {
    s += p.onX(0.64, 1.55, -0.2, `<rect x="0" y="0" width=".42" height=".42" rx=".06" fill="${color}"/>`
      + `<rect x=".55" y=".1" width="1.1" height=".16" rx=".08" fill="${tint(color, 0.35)}"/>`)
  }
  s += p.wheelX(0.5, 0.0, -1.95, 0.32)
  s += p.wheelX(0.5, 0.0, -1.25, 0.32)
  // cab
  const cab = p.mat(cabColor)
  s += p.box(-0.6, 0.28, 0.62, 1.2, 1.18, 0.95, cab)
  s += p.box(-0.6, 1.46, 0.62, 1.2, 0.08, 0.62, p.mat(tint(cabColor, -0.05)), 't')
  if (!solidCab) {
    s += p.quadX(0.6, 0.42, 0.62, 0.62, 1.57, color)
    s += p.quadZ(1.57, -0.6, 0.6, 0.42, 0.62, tint(color, -0.1))
  }
  // windscreen, side window, grille, bumper, headlights
  s += p.quadZ(1.57, -0.5, 0.5, 0.88, 1.36, p.lin('#3a4560', dark))
  s += p.quadX(0.6, 0.92, 1.34, 1.02, 1.45, p.lin('#4a5674', dark))
  s += p.quadZ(1.57, -0.32, 0.32, 0.5, 0.72, tint(solidCab ? cabColor : '#cfd5e2', -0.3))
  s += p.box(-0.64, 0.2, 1.57, 1.28, 0.2, 0.08, p.mat('#c9cfdc'))
  s += p.quadZ(1.57, -0.55, -0.4, 0.62, 0.74, '#fff6d6')
  s += p.quadZ(1.57, 0.4, 0.55, 0.62, 0.74, '#fff6d6')
  if (detail) s += p.box(0.6, 1.0, 1.35, 0.1, 0.28, 0.05, p.mat('#2a3040'))
  s += p.wheelX(0.52, 0.0, 0.92, 0.32)
  return s
}

/** Corrugated hall with a gable roof running along x; optional white dock openings on the +z wall. */
function gableHall(p, c, { x0, x1, z0, z1, h, ridge, doors = [] }) {
  const zm = (z0 + z1) / 2
  const m = p.mat(c)
  const rib = tint(c, -0.2)
  let s = p.box(x0, 0, z0, x1 - x0, h, z1 - z0, m, 'lr')
  // faint vertical corrugation on the long wall
  for (let x = x0 + 0.15; x < x1 - 0.05; x += 0.18) s += p.line([[x, 0.03, z1], [x, h - 0.03, z1]], rib, 0.28, ' opacity=".35"')
  // roof: far slope, near slope (with ribs), gable end, white ridge + eave trims
  s += p.poly([[x0, h, z0], [x1, h, z0], [x1, ridge, zm], [x0, ridge, zm]], tint(c, 0.34))
  s += p.poly([[x0, ridge, zm], [x1, ridge, zm], [x1, h, z1], [x0, h, z1]], p.lin(tint(c, 0.26), tint(c, 0.1), [0, 0, 1, 1]))
  for (let x = x0 + 0.18; x < x1 - 0.08; x += 0.22) s += p.line([[x, ridge, zm], [x, h, z1]], tint(c, 0.5), 0.26, ' opacity=".6"')
  s += p.poly([[x1, h, z0], [x1, ridge, zm], [x1, h, z1]], tint(c, 0.02))
  s += p.line([[x0, ridge, zm], [x1, ridge, zm]], '#ffffff', 0.55)
  s += p.line([[x0, h, z1], [x1, h, z1], [x1, ridge, zm]], '#f4f7ff', 0.4, ' opacity=".8"')
  for (const x of doors) s += p.quadZ(z1, x, x + 0.46, 0.02, h * 0.78, '#f1f4fb')
  return s
}

const DRAW = {
  // ── inventory items ──
  box(p) {
    p.view(24, 32.5, 12.2)
    return p.shadow(24, 37.5, 18, 5.2) + carton(p, -0.82, 0, -0.82, 1.64, 1.12, 1.64)
      + p.line([[-0.82, 1.12, 0], [0.82, 1.12, 0]], tint(CARD, -0.12), 0.35)
  },

  container(p) {
    p.view(24, 32.5, 11)
    const c = '#3563ee'
    const [x0, x1, z0, z1, h, t] = [-0.95, 0.95, -0.72, 0.72, 1.0, 0.12]
    let s = p.shadow(24, 37.5, 19, 5)
    s += p.box(x0, 0, z0, x1 - x0, h, z1 - z0, p.mat(c))
    // open top: dark cavity + the lit inner faces of the two far walls
    const [ix0, ix1, iz0, iz1] = [x0 + t, x1 - t, z0 + t, z1 - t]
    s += p.quadY(h, ix0, ix1, iz0, iz1, p.lin(tint(c, -0.42), tint(c, -0.3), [0, 0, 1, 1]))
    s += p.poly([[ix0, h, iz0], [ix1, h, iz0], [ix1, h - 0.34, iz0], [ix0, h - 0.34, iz0]], tint(c, -0.12))
    s += p.poly([[ix0, h, iz0], [ix0, h, iz1], [ix0, h - 0.34, iz1], [ix0, h - 0.34, iz0]], tint(c, 0.05))
    // ribs + handle cut-outs
    s += p.quadX(x1, 0.3, 0.36, z0, z1, tint(c, 0.26)) + p.quadZ(z1, x0, x1, 0.3, 0.36, tint(c, 0.08))
    s += p.onX(x1, 0.82, -0.25, `<rect width=".5" height=".14" rx=".07" fill="${tint(c, -0.45)}"/>`)
    s += p.onZ(z1, 0.82, -0.35, `<rect width=".7" height=".14" rx=".07" fill="${tint(c, -0.5)}"/>`)
    return s
  },

  // soft, rounded hard hat (the video's thumbnail has no front ridge)
  helmet(p) {
    const shell = p.rad([[0, '#ffe39a'], [0.45, '#f8be45'], [1, '#e39a22']], 0.38, 0.3, 0.8)
    const brim = p.lin('#f5b43c', '#dc9320')
    return p.shadow(24, 37.5, 19, 4.6)
      + `<path d="M5.2 32.6c0-2.9 8.4-5 18.8-5s18.8 2.1 18.8 5-8.4 3.8-18.8 3.8S5.2 35.5 5.2 32.6z" fill="${brim}"/>`
      + `<path d="M8.8 31.8C8.4 19.6 15.2 11.4 24 11.4s15.6 8.2 15.2 20.4c-4.6 2-25.8 2-30.4 0z" fill="${shell}"/>`
      + '<path d="M9.4 29.4c4.4 1.6 24.8 1.6 29.2 0" stroke="#e8a02a" stroke-width="1" fill="none" opacity=".6"/>'
      + '<path d="M13.4 19.2c1.9-3.3 4.6-5.3 7.4-6" stroke="#fff6d2" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".75"/>'
  },

  tape(p) {
    const body = p.lin('#d79f5c', '#e9bd83', [0, 0, 1, 0])
    const face = p.rad([[0, '#f2cf98'], [1, '#dcaa66']], 0.45, 0.4, 0.7)
    return p.shadow(23, 39, 15, 4.4)
      + `<path d="M17 9.4c-6.2 0-10.2 6.4-10.2 14.6S10.8 38.6 17 38.6h9.4V9.4z" fill="${body}"/>`
      + `<ellipse cx="26.4" cy="24" rx="10.2" ry="14.6" fill="${face}"/>`
      + '<ellipse cx="26.4" cy="24" rx="5.6" ry="8.2" fill="#c98f4c"/>'
      + '<ellipse cx="27.1" cy="24.3" rx="4.6" ry="7.1" fill="#dfeaf8"/>'
      + '<path d="M25 18.5c-1 1.4-1.5 3.4-1.5 5.6" stroke="#fff" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".9"/>'
  },

  panel(p) {
    p.view(24, 30.5, 10.8)
    let s = p.shadow(24, 37, 20, 5)
    s += carton(p, -1.05, 0, -1.05, 2.1, 0.55, 2.1, '#dfb27b')
    // printed label with a 2×2 LED grid
    s += p.onY(0.551, -0.62, -0.75, '<rect width=".9" height=".9" rx=".06" fill="#fbfcff"/>'
      + '<rect x=".12" y=".12" width=".3" height=".3" fill="#cfe0ff"/><rect x=".48" y=".12" width=".3" height=".3" fill="#cfe0ff"/>'
      + '<rect x=".12" y=".48" width=".3" height=".3" fill="#cfe0ff"/><rect x=".48" y=".48" width=".3" height=".3" fill="#cfe0ff"/>')
    return s
  },

  chair(p) {
    p.view(24, 34, 10.5)
    let s = p.shadow(24, 38.5, 17, 4.8)
    s += carton(p, -0.8, 0, -0.8, 1.6, 1.6, 1.6, '#d8a76c')
    // chair glyph printed on the lit side
    s += p.onX(0.8, 1.32, 0.8, '<g fill="none" stroke="#8a5a2c" stroke-width=".1" stroke-linecap="round">'
      + '<path d="M.5 .15v.55h.6M.55 .7v.35M1.05 .7v.35M.8 .7v.35"/></g>')
    return s
  },

  gloves(p) {
    p.view(24, 31, 11)
    const c = '#3a67ef'
    let s = p.shadow(24, 37, 19, 5)
    s += p.box(-1.0, 0, -0.68, 2.0, 0.9, 1.36, p.mat(c))
    // dispenser slot + glove cuff poking out
    s += p.onY(0.901, -0.55, -0.3, '<ellipse cx=".55" cy=".3" rx=".5" ry=".22" fill="#1f3fae"/>'
      + '<path d="M.25 .3c.05-.35.55-.42.62-.05" fill="#a9c4ff"/>')
    s += p.onZ(0.68, 0.72, -0.85, `<rect width="1.7" height=".18" rx=".05" fill="${tint(c, 0.3)}"/>`)
    return s
  },

  frozen(p) {
    const bag = p.lin('#f3f8ff', '#bcd2f2', [0, 0, 1, 1])
    return p.shadow(24, 38.5, 17, 4.4)
      + `<path d="M11 12.5l13-3.6 13.6 3.4c1.4 6.8 1.6 15.8.2 23.2L24 39.2 10.6 35.4C9.4 28 9.6 19.4 11 12.5z" fill="${bag}"/>`
      + '<path d="M11 12.5l13-3.6 13.6 3.4-13.4 3.6z" fill="#e8f1ff"/>'
      + '<path d="M24.2 15.9v23.3" stroke="#a9c1e6" stroke-width=".7"/>'
      + '<path d="M11.4 11.6l12.6-3.5 13.2 3.3" stroke="#d6e4f8" stroke-width="1.8" fill="none" stroke-dasharray="1.2 1"/>'
      + '<ellipse cx="17.6" cy="26.5" rx="4.4" ry="5.2" fill="#7fd29b"/>'
      + '<circle cx="16.4" cy="25.4" r="1.2" fill="#4fb873"/><circle cx="18.8" cy="27.4" r="1.2" fill="#4fb873"/>'
      + '<path d="M28 19.5l4.5-1.2M28 23l5-1.3M28 26.5l3.4-.9" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".9"/>'
  },

  water(p) {
    p.view(24, 32, 10.5)
    let s = p.shadow(24, 37.5, 19, 5)
    s += p.box(-1.0, 0, -0.7, 2.0, 1.15, 1.4, p.mat('#e9f0fb'))
    // bottle caps (3×2) on top + film seams on the sides
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        const [cx, cy] = p.P(-0.66 + i * 0.66, 1.15, -0.35 + j * 0.7)
        s += `<ellipse cx="${cx}" cy="${cy}" rx="2.3" ry="1.3" fill="#4a78ee"/><ellipse cx="${cx}" cy="${cy - 0.6}" rx="2.3" ry="1.3" fill="#7c9cf5"/>`
      }
    }
    for (const z of [-0.23, 0.23]) s += p.quadX(1.0, 0.05, 1.1, z - 0.02, z + 0.02, '#cfdcf2')
    s += p.quadZ(0.7, -1.0, 1.0, 0.45, 0.62, '#4a78ee')
    return s
  },

  // ── entities ──
  // the WH-01 depot: a taller rear hall and a lower front hall, both blue corrugated with gable
  // roofs, white dock openings on the front facade
  site(p, o) {
    const c = o.color ?? '#3a62ee'
    p.view(23.6, 27.6, 8.3)
    let s = p.shadow(24, 35.5, 21, 5.4, 0.16)
    s += gableHall(p, c, { x0: -2.0, x1: 1.55, z0: -0.86, z1: -0.12, h: 0.66, ridge: 0.92 })
    s += gableHall(p, c, { x0: -1.6, x1: 2.0, z0: -0.12, z1: 0.66, h: 0.44, ridge: 0.66, doors: [-1.25, -0.4, 0.45, 1.3] })
    return s
  },

  network(p) {
    let s = p.shadow(24, 37, 21, 6, 0.14)
    const bld = (cx, cy, k, c) => {
      p.view(cx, cy, k)
      return p.box(-0.9, 0, -0.6, 1.8, 0.85, 1.2, p.mat('#e3e8f4'))
        + p.box(-0.95, 0.85, -0.65, 1.9, 0.16, 1.3, p.mat(c))
        + p.quadZ(0.6, -0.55, -0.15, 0.05, 0.5, '#ffffff') + p.quadZ(0.6, 0.15, 0.55, 0.05, 0.5, '#ffffff')
    }
    s += '<path d="M14 25 24 30.5 34 25" fill="none" stroke="#9db2f6" stroke-width="1.2" stroke-dasharray="1.6 1.6" stroke-linecap="round"/>'
    s += bld(14.5, 21.5, 5.6, '#3a62ee') + bld(33.5, 21.5, 5.6, '#4cb3d8') + bld(24, 33.5, 6.8, '#2f5bea')
    return s
  },

  truck(p, o) {
    p.view(25.5, 31, 7.4)
    return p.shadow(24, 37, 20, 5.2, 0.16) + truckBody(p, o, false)
  },

  trackerTruck(p, o) {
    p.view(26.5, 31.5, 7.6)
    return p.shadow(24, 39, 21, 5, 0.18) + truckBody(p, o, true)
  },

  forklift(p) {
    p.view(23, 31.5, 8.6)
    const yellow = p.mat('#f5b72e')
    const blue = p.mat('#3d5af1')
    const black = p.mat('#2a2e38')
    let s = p.shadow(24, 37, 18, 5, 0.18)
    // rear guard posts, counterweight, body, skirt
    s += p.box(-0.55, 0.95, -0.62, 0.09, 1.1, 0.09, black) + p.box(0.46, 0.95, -0.62, 0.09, 1.1, 0.09, black)
    s += p.box(-0.58, 0.05, -1.12, 1.16, 0.32, 2.05, blue)
    s += p.box(-0.55, 0.37, -1.12, 1.1, 0.78, 0.45, p.mat('#e9a91f'))
    s += p.box(-0.55, 0.37, -0.67, 1.1, 0.55, 1.5, yellow)
    // operator: seat, vest, head + hard hat
    s += p.box(-0.3, 0.92, -0.5, 0.6, 0.18, 0.5, black)
    s += p.box(-0.24, 1.1, -0.36, 0.48, 0.48, 0.34, p.mat('#f28a2e'))
    const [hx, hy] = p.P(0, 1.78, -0.18)
    s += `<circle cx="${hx}" cy="${hy}" r="2.1" fill="#c68a63"/>`
      + `<path d="M${hx - 2.4} ${hy - 0.5}a2.4 2.2 0 0 1 4.8 0z" fill="#f7c234"/>`
    // wheels
    s += p.wheelX(0.58, 0, -0.95, 0.3) + p.wheelX(0.58, 0, 0.32, 0.3)
    // front guard posts + roof
    s += p.box(-0.55, 0.92, 0.55, 0.09, 1.13, 0.09, black) + p.box(0.46, 0.92, 0.55, 0.09, 1.13, 0.09, black)
    s += p.box(-0.58, 2.05, -0.66, 1.16, 0.08, 1.32, black)
    s += p.quadY(2.13, -0.48, 0.48, -0.56, 0.56, '#3d4352')
    // mast + carriage + forks
    s += p.box(-0.46, 0.08, 0.86, 0.1, 2.15, 0.1, black) + p.box(0.36, 0.08, 0.86, 0.1, 2.15, 0.1, black)
    s += p.box(-0.46, 0.55, 0.9, 0.92, 0.1, 0.06, black) + p.box(-0.46, 1.5, 0.9, 0.92, 0.08, 0.06, black)
    s += p.box(-0.34, 0.06, 0.96, 0.12, 0.06, 1.15, black) + p.box(0.22, 0.06, 0.96, 0.12, 0.06, 1.15, black)
    return s
  },

  pallet(p, o) {
    p.view(24, 32, 9.6)
    const wood = p.mat('#d2a679')
    let s = p.shadow(24, 38, 20, 5.4)
    s += p.box(-1.05, 0, -0.9, 2.1, 0.24, 1.8, wood)
    for (const x of [-0.62, 0.25]) s += p.quadZ(0.9, x, x + 0.38, 0.04, 0.15, '#7e5a3a')
    for (const z of [-0.5, 0.2]) s += p.quadX(1.05, 0.04, 0.15, z, z + 0.32, '#7e5a3a')
    if (o.kind === 'blue' || o.kind === 'white') {
      const c = o.kind === 'blue' ? '#3f63e6' : '#eef1f8'
      s += p.box(-0.98, 0.24, -0.84, 1.96, 1.5, 1.68, p.mat(c))
      for (const y of [0.6, 1.0, 1.4]) s += p.quadX(0.98, y, y + 0.03, -0.84, 0.84, tint(c, 0.25))
      return s
    }
    const tones = ['#d9aa72', '#e2b783', '#d4a066', '#dcae76']
    let i = 0
    for (const y of [0.24, 0.86]) {
      for (const [x, z] of [[-1.0, -0.86], [0.02, -0.86], [-1.0, 0.02], [0.02, 0.02]]) {
        s += carton(p, x, y, z, 0.98, 0.62, 0.84, tones[i++ % tones.length], false)
      }
    }
    s += p.quadY(1.48, -0.08, 0.08, -0.86, 0.86, TAPE)
    return s
  },

  // dock bay: a slice of white wall with a blue-framed, half-open roller door, the loading
  // platform in front with a dark leveller plate, black bumpers and a yellow safety edge
  dock(p) {
    p.view(24.4, 30.4, 6.5)
    let s = p.shadow(24, 37.5, 19, 5, 0.14)
    // wall slab (only its lit end and top read at this angle)
    s += p.box(-1.5, 0, -1.55, 3.0, 2.5, 0.3, p.mat('#eef1f7'))
    // door opening: dark interior, roller door rolled half down, blue frame
    s += p.quadZ(-1.25, -0.95, 0.95, 0.55, 1.4, p.lin('#3a4258', '#232a3a'))
    s += p.quadZ(-1.25, -0.95, 0.95, 1.4, 2.12, p.lin('#e6eaf2', '#cbd2e0'))
    for (const y of [1.58, 1.76, 1.94]) s += p.quadZ(-1.25, -0.95, 0.95, y, y + 0.035, '#b4bccd')
    const frame = p.mat('#2f55df')
    s += p.box(-1.13, 0.55, -1.25, 0.18, 1.75, 0.1, frame) + p.box(0.95, 0.55, -1.25, 0.18, 1.75, 0.1, frame)
    s += p.box(-1.13, 2.12, -1.25, 2.26, 0.18, 0.1, frame)
    // platform + leveller plate + lip, bumpers, safety edge
    s += p.box(-1.5, 0, -1.25, 3.0, 0.55, 1.9, p.mat('#dde2ec'))
    s += p.poly([[-0.85, 0.56, -1.2], [0.85, 0.56, -1.2], [0.85, 0.57, 0.5], [-0.85, 0.57, 0.5]], p.lin('#4d5466', '#2c313e', [0, 0, 1, 1]))
    s += p.quadZ(0.65, -0.85, 0.85, 0.42, 0.55, '#262a35')
    s += p.quadZ(0.65, -1.5, 1.5, 0.47, 0.55, '#f2c14e')
    for (const x of [-1.35, 1.05]) s += p.box(x, 0.1, 0.65, 0.3, 0.32, 0.12, p.mat('#2a2e38'))
    return s
  },

  charger(p) {
    p.view(24, 33, 9.2)
    let s = `<ellipse cx="24" cy="36.2" rx="15" ry="5.2" fill="${p.rad([[0, '#7ee2a2', 0.55], [1, '#7ee2a2', 0]])}"/>`
    s += p.shadow(24, 36, 10, 3.6, 0.2)
    s += p.box(-0.48, 0, -0.34, 0.96, 2.3, 0.68, p.mat('#f2f5fa'))
    s += p.box(-0.52, 2.3, -0.38, 1.04, 0.2, 0.76, p.mat('#2b3140'))
    s += p.quadZ(0.34, -0.33, 0.33, 1.45, 2.05, p.lin('#2a3246', '#151a28'))
    s += p.onZ(0.34, 1.95, -0.2, '<path d="M.24 0 .08 .26h.12L.14 .44.32 .16H.2z" fill="#4fdc86"/>')
    s += p.quadZ(0.34, -0.25, 0.25, 0.55, 0.62, '#4fdc86')
    // cable loop on the lit side
    const [ax, ay] = p.P(0.48, 1.2, 0.05)
    s += `<path d="M${ax} ${ay}c4 1 5 6 2 9" stroke="#3a4152" stroke-width="1.1" fill="none" stroke-linecap="round"/>`
    return s
  },
}
