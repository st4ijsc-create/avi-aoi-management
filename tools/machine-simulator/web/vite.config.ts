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
    // 🔴 CE-1 (owner item 60) — THE DEV SERVER MUST NOT WATCH THE ENGINE'S DATA ROOT, and this is a
    // fix for a REAL 500, not a tidy-up. `playwright.config.ts` points all sixteen `ST4I_*_DIR`
    // stores at `web/.e2e-data`, which is INSIDE this server's own project root, so chokidar walks
    // it. `MachineConfigStore.WriteAllTextAtomic` writes `<file>.tmp-<guid>` and then
    // `File.Move(tmp, dest, overwrite: true)`; on Windows that rename returns ERROR_ACCESS_DENIED
    // (→ `UnauthorizedAccessException`) while anything holds a handle on the target, and the store
    // has no retry. A fleet start calls `MachineConfigStore.Ensure` once per machine — eleven
    // renames onto ONE path in a few milliseconds — so `POST /v1/fleet/start` returned 500 and the
    // dashboard's Start button did nothing.
    //
    // MEASURED, one variable, nothing else changed — `ST4I_MACHINE_CONFIG_DIR` moved and moved back:
    //   web/.e2e-data/machine-config (inside)  → 5 of 5 runs 500
    //   web/.probe-mc                (inside)  → 3 of 3 runs 500
    //   <repo>/.probe-mc             (outside) → 3 of 3 runs 200
    //   engine run standalone, root outside, no dev server at all → 200, all 11 machines written
    // Being inside this root is the whole difference; the engine's own path is not broken.
    //
    // 📎 What this does NOT fix, said here because a silence would read as coverage: the
    // arrangement is still wrong — the engine's runtime data root LIVES inside the dev server's
    // project root, and the next tool that walks `web/` will trip on the same rename. This ignores
    // one directory for one watcher; it does not move the data root, and it does not give
    // `WriteAllTextAtomic` the retry that would make the store robust against ANY handle-holder.
    // Both of those are product decisions — see `docs/owner-decisions.md` item 60.
    watch: {
      ignored: ["**/.e2e-data/**", "**/.e2e-data"],
    },
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
