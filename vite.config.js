import { defineConfig } from 'vite'

export default defineConfig({
  // relative asset URLs so the build works from any sub-path (GitHub Pages serves it at /waretrack-3d/)
  base: './',
  build: {
    chunkSizeWarningLimit: 1200, // three.js + the procedural city ship as one ~880 kB chunk on purpose
  },
})
