import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // WS-D-D6 — proxies every `/v1/*` request (REST + the inspector's WS upgrade, `ws: true`) to the
    // fixed-port engine (Task 3's `http://localhost:5199`) so the dev server and the API are
    // SAME-ORIGIN from the browser's point of view (`http://localhost:5173` for both). Load-bearing
    // now that `/v1/auth/*` (D1) sets a `SameSite=Lax` session cookie: a cookie minted by a response
    // from a genuinely different origin (the old direct cross-port `:5199` fetch) is never sent back
    // on the next same-page fetch, which would break login before it could ever work. See
    // `lib/api.ts`'s `BASE_URL` doc comment for the client-side half of this.
    proxy: {
      "/v1": {
        target: "http://localhost:5199",
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
