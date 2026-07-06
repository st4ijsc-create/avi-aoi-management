# SYNAPSE Machine Edition — desktop shell (Tauri 2) — scaffold

> doc 33 W5 / ADR-006. **Scaffold only** — building needs the Rust toolchain + `tauri-cli`
> (not available in this environment). Establishes the "web-first, package desktop" structure.

## What it is
The SAME React SPA that serves the browser Control Tower, wrapped as a **Tauri 2** `.exe` for a
single OEM machine (Machine Edition): auto-start, fullscreen kiosk, offline. **No second UI is
written** — one codebase, three distributions (browser · PWA kiosk · Tauri desktop), per ADR-006.

## Layout
```
apps/machine-shell/
├── src-tauri/
│   ├── tauri.conf.json   # window (fullscreen/kiosk) + frontendDist (../../../client/dist) + devUrl
│   ├── Cargo.toml        # tauri 2 deps
│   └── icons/            # app icon (add before bundling)
├── local-agent/          # Go/Node sidecar for serial/USB/dongle/vendor-DLL → UNS (see its README)
└── README.md
```

## Build (on a machine with Rust)
```bash
# 1. Build the web UI          → client/dist
pnpm build
# 2. Build the desktop bundle  → .exe / .msi / .dmg / .AppImage
cargo tauri build   # from apps/machine-shell/src-tauri
```

## Boundary (ADR-006)
The UI NEVER touches hardware directly. Anything native — RS-232/485, USB, license dongle, a
vendor's C#/C++ DLL — lives in the **Local Agent** (see `local-agent/README.md`), which normalizes
to the local UNS. This keeps the desktop shell a thin kiosk over the same web app.
