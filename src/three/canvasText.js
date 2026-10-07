// Canvas-texture helpers for text/logos painted onto 3D surfaces (truck liveries, building signs,
// dock numbers, roof logos). Fonts: Inter is loaded by index.html; fall back to system sans.
import * as THREE from 'three'

const FONT = 'Inter, "Segoe UI", system-ui, sans-serif'

/**
 * Draw on a fresh canvas and return a CanvasTexture (sRGB, anisotropic, mipmapped).
 * draw(ctx, w, h) does the painting.
 */
export function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  draw(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

/**
 * Text texture. Returns { texture, aspect } where aspect = width/height of the painted area.
 * opts: { color, bg, weight (e.g. 700), size (px, default 96), padX, padY, italic, letterSpacing }
 */
export function textTexture(text, opts = {}) {
  const { color = '#2f5bea', bg = null, weight = 700, size = 96, padX = 24, padY = 16, italic = false, radius = 0 } = opts
  const font = `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`
  const probe = document.createElement('canvas').getContext('2d')
  probe.font = font
  const tw = Math.ceil(probe.measureText(text).width)
  const w = tw + padX * 2
  const h = Math.ceil(size * 1.25) + padY * 2
  const texture = canvasTexture(w, h, (ctx) => {
    if (bg) {
      ctx.fillStyle = bg
      roundRect(ctx, 0, 0, w, h, radius)
      ctx.fill()
    }
    ctx.font = font
    ctx.fillStyle = color
    ctx.textBaseline = 'middle'
    ctx.fillText(text, padX, h / 2 + size * 0.04)
  })
  return { texture, aspect: w / h }
}

/**
 * A flat plane mesh showing `text`, sized to `height` metres (width from aspect).
 * Faces +Z by default. transparent background unless opts.bg given.
 */
export function textPlane(text, height, opts = {}) {
  const { texture, aspect } = textTexture(text, opts)
  const geo = new THREE.PlaneGeometry(height * aspect, height)
  const m = new THREE.MeshStandardMaterial({ map: texture, transparent: !opts.bg, roughness: 0.85, metalness: 0, depthWrite: !!opts.bg })
  const mesh = new THREE.Mesh(geo, m)
  mesh.userData.aspect = aspect
  return mesh
}

/** Plane mesh from a custom-painted canvas; width × height in metres. */
export function paintedPlane(width, height, pxPerMetre, draw, opts = {}) {
  const tex = canvasTexture(Math.round(width * pxPerMetre), Math.round(height * pxPerMetre), draw)
  const m = new THREE.MeshStandardMaterial({ map: tex, transparent: opts.transparent ?? true, roughness: 0.85, metalness: 0, depthWrite: !(opts.transparent ?? true) })
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), m)
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** The WareTrack isometric cube logo, drawn at (x,y) with size s on a 2D canvas. */
export function drawCubeLogo(ctx, x, y, s, colors = { top: '#7d97f7', left: '#2f5bea', right: '#2347c9' }) {
  const h = s / 2
  ctx.save()
  ctx.translate(x, y)
  // top face
  ctx.fillStyle = colors.top
  ctx.beginPath(); ctx.moveTo(h, 0); ctx.lineTo(s, s * 0.25); ctx.lineTo(h, s * 0.5); ctx.lineTo(0, s * 0.25); ctx.closePath(); ctx.fill()
  // left face
  ctx.fillStyle = colors.left
  ctx.beginPath(); ctx.moveTo(0, s * 0.25); ctx.lineTo(h, s * 0.5); ctx.lineTo(h, s); ctx.lineTo(0, s * 0.75); ctx.closePath(); ctx.fill()
  // right face
  ctx.fillStyle = colors.right
  ctx.beginPath(); ctx.moveTo(h, s * 0.5); ctx.lineTo(s, s * 0.25); ctx.lineTo(s, s * 0.75); ctx.lineTo(h, s); ctx.closePath(); ctx.fill()
  ctx.restore()
}

export { FONT }
