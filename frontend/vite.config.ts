import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"

/**
 * Vite config Zentara — Frontend ↔ Backend integration.
 *
 * Round 10 fix :
 *  - `server.proxies['/api']`     → dev mode : forward /api → backend (corrige CORS).
 *  - `preview.proxies['/api']`    → preview mode : idem (Vite preview supporte aussi proxy).
 *  - `preview.host = true`        → bind 0.0.0.0 pour atteindre depuis un browser externe.
 *
 * Le frontend peut alors appeler :
 *   - `${VITE_API_BASE_URL}/api/...` (default → '' + '/api' relatif), ou
 *   - '/api/...' directement.
 *
 * On garde `VITE_API_BASE_URL=/api` (relatif) dans .env.local pour
 * que le browser voie les requêtes API comme same-origin, donc plus
 * aucun souci CORS / credentials / preflight.
 */
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: false,
        secure: false,
        // No rewrite: backend has /api/* mounted via app.use('/api', routes),
        // and exposes an alias /api/health alongside the root /health route,
        // so /api/* stays /api/* end-to-end.
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    // Allow any host (trycloudflare tunnels change hostname on every
    // session). Without this, Vite preview returns 403 "host not allowed".
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: false,
        secure: false,
      },
    },
  },
})
