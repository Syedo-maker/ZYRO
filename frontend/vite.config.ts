import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Proxying makes the browser see the API as same-origin (localhost:5173), so the
      // httpOnly refresh-token cookie is sent unambiguously on every request; this
      // sidesteps cross-origin cookie edge cases entirely rather than working around them.
      // Found during Phase 1's frontend module: sessions didn't survive a page reload
      // until this was added, even with credentials:'include' and matching CORS config.
      '/api': 'http://localhost:5000',
      '/uploads': 'http://localhost:5000',
    },
  },
})
