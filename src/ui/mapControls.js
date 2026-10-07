// Map controls (SPEC §2.3): vertical card with zoom in / out, rotate left / right and home.
// Each button emits bus 'camera:cmd' { cmd } — the camera director does the rest.
import { bus } from '../state/store.js'
import { icon } from './icons.js'

const GROUPS = [
  [
    { cmd: 'zoomIn', icon: 'plus', label: 'Zoom in', size: 18 },
    { cmd: 'zoomOut', icon: 'minus', label: 'Zoom out', size: 18 },
  ],
  [
    { cmd: 'rotateLeft', icon: 'rotateLeft', label: 'Rotate left', size: 15 },
    { cmd: 'rotateRight', icon: 'rotateRight', label: 'Rotate right', size: 15 },
  ],
  [
    { cmd: 'home', icon: 'home', label: 'Reset view', size: 15 },
  ],
]

const button = (b) => `
  <button class="mapctl__btn" type="button" data-cmd="${b.cmd}" title="${b.label}" aria-label="${b.label}">
    ${icon(b.icon, b.size, { sw: 1.75 })}
  </button>`

export function mountMapControls(el) {
  el.innerHTML = `
  <nav class="card mapctl" aria-label="Map controls">
    ${GROUPS.map((g) => g.map(button).join('')).join('<span class="mapctl__sep" aria-hidden="true"></span>')}
  </nav>`

  const onClick = (e) => {
    const btn = e.target.closest('[data-cmd]')
    if (btn) bus.emit('camera:cmd', { cmd: btn.dataset.cmd })
  }
  el.addEventListener('click', onClick)

  return {
    destroy() {
      el.removeEventListener('click', onClick)
      el.innerHTML = ''
    },
  }
}
