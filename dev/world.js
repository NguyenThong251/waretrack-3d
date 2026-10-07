// Dev page for the world module: the real scene shell (SPEC §3 lights, map-style OrbitControls,
// render watchdog for hidden tabs) + createWorld fed only { scene, camera, renderer }, site view
// buttons and draw-call stats. world.update runs every frame.
// Query: ?site=WH-01..WH-05|ALL  ?clean=1 (hide the HUD for screenshots)  ?env=1 (environment
// only)  ?live=1 (keep Vite HMR reloads, see world.html)
import { createScene } from '../src/three/scene.js'
import { SITE_IDS, siteLayout, allLayouts, networkView } from '../src/data/layout.js'

const params = new URLSearchParams(location.search)
const container = document.getElementById('view')
const hud = document.getElementById('hud')
const stats = document.getElementById('stats')
if (params.has('clean')) hud.classList.add('clean')

const app = createScene(container, { preserveDrawingBuffer: true })
const world = await loadWorld()

function show(id) {
  const view = id === 'ALL' ? world.getNetworkView() : world.getSiteView(id)
  app.flyTo({ ...view, duration: 0 })
  for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.id === id)
  const keep = ['clean', 'env', 'live'].filter((k) => params.has(k)).map((k) => `&${k}=1`).join('')
  history.replaceState(null, '', `?site=${id}${keep}`)
  app.renderNow()
}

const views = document.getElementById('views')
for (const id of [...SITE_IDS, 'ALL']) {
  const b = document.createElement('button')
  b.textContent = id
  b.dataset.id = id
  b.onclick = () => show(id)
  views.append(b)
}

app.onFrame((dt, elapsed) => world.update(dt, elapsed))
app.onFrame(() => {
  const info = app.renderer.info.render
  stats.textContent = `${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k tris`
})
show(params.get('site') ?? 'WH-01')
app.start()
app.renderNow()

window.__world = { app, world }

/** The real world, or (while models are still being written) the environment alone. */
async function loadWorld() {
  try {
    if (params.has('env')) throw new Error('?env → environment only')
    const { createWorld } = await import('../src/three/world.js')
    // only the contract's minimal app surface (SPEC §5): scene, camera, renderer
    return createWorld({ scene: app.scene, camera: app.camera, renderer: app.renderer })
  } catch (err) {
    console.warn('world.js unavailable, showing the environment only:', err.message)
    const t0 = performance.now()
    const { createEnvironment } = await import('../src/three/environment.js')
    const env = createEnvironment(allLayouts())
    app.scene.add(env.root)
    console.info(`environment built in ${(performance.now() - t0).toFixed(0)} ms`)
    return {
      update: env.update,
      getSiteView: (id) => siteLayout(id).view,
      getNetworkView: networkView,
    }
  }
}
