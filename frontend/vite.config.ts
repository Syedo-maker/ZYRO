import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Where the dev server forwards /api and /uploads: this machine's API by default; the API container in
// the Docker development setup (compose.dev.yaml sets VITE_DEV_API_TARGET=http://api:5000). Read by
// the dev server only; it never reaches the browser bundle.
const apiTarget = process.env.VITE_DEV_API_TARGET || 'http://localhost:5000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In the Docker development setup file events do not cross the mount, so the dev server polls.
    watch: process.env.VITE_DEV_POLLING === 'true' ? { usePolling: true, interval: 1000 } : undefined,
    proxy: {
      // Proxying makes the browser see the API as same-origin (localhost:5173), so the
      // httpOnly refresh-token cookie is sent unambiguously on every request; this
      // sidesteps cross-origin cookie edge cases entirely rather than working around them.
      // Found during Phase 1's frontend module: sessions didn't survive a page reload
      // until this was added, even with credentials:'include' and matching CORS config.
      '/api': apiTarget,
      '/uploads': apiTarget,
    },
  },
})
