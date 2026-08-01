# SYNAPSE Machine Edition — desktop shell (Tauri 2) — scaffold

> doc 33 W5 / ADR-006 (+ doc 44 W7-2 §9). **Scaffold only** — building needs the Rust toolchain +
> `tauri-cli` (**not available in this environment; owner builds on a Rust box**). Establishes the
> "web-first, package desktop" structure. These are CONFIG files; no `.exe` is produced here.

## What it is
The SAME React SPA that serves the browser Control Tower, wrapped as a **Tauri 2** `.exe` for a
single OEM machine (Machine Edition): auto-start, fullscreen kiosk, offline. **No second UI is
written** — one codebase, three distributions (browser · PWA kiosk · Tauri desktop), per ADR-006.

## The four Machine-Edition requirements (doc 44 W7-2 §9)
| Requirement | Where it is realised |
|---|---|
| **Fullscreen kiosk** | `tauri.conf.json` → `app.windows[0]`: `fullscreen:true` + `kiosk:true` + `decorations:false` → the operator cannot leave the app. |
| **Auto-start** | `tauri-plugin-autostart` (Cargo.toml) wired in `src/main.rs` → launches on OS login, so an IPC that reboots after a power blip comes straight back to the Control Tower. |
| **Offline** | Point the window at the LOCAL embedded server (`http://127.0.0.1:3000`, Machine profile) — everything (broker, DB, UI) is on-box; OR bundle `client/dist` (`frontendDist`) for a pure static shell. No cloud dependency. |
| **Machine license** | The shell is a thin kiosk over the local Node server, which enforces `LICENSE_FILE_PATH` (`license.lic`) bound to the IPC. The desktop shell adds NO entitlement of its own. |

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
# 2. Add the entry point       → src-tauri/src/main.rs (see snippet below), then:
# 3. Build the desktop bundle  → .exe / .msi / .dmg / .AppImage
cargo tauri build   # from apps/machine-shell/src-tauri
```

### `src/main.rs` (the owner adds this on the Rust box — wires kiosk + auto-start + single-instance)
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri_plugin_autostart::MacosLauncher;

fn main() {
    tauri::Builder::default()
        // one kiosk window only — a second launch focuses the first
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") { let _ = w.set_focus(); }
        }))
        // auto-start on OS login (unattended IPC)
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .run(tauri::generate_context!())
        .expect("error while running SYNAPSE Machine shell");
}
```

**Dependencies the owner must install to build:** Rust toolchain (`rustup`, 1.77+) + `cargo install
tauri-cli` + platform WebView (WebView2 on Windows, `webkit2gtk` on Linux). None are present in
this environment — this directory is config-only.

## Boundary (ADR-006)
The UI NEVER touches hardware directly. Anything native — RS-232/485, USB, license dongle, a
vendor's C#/C++ DLL — lives in the **Local Agent** (see `local-agent/README.md`), which normalizes
to the local UNS. This keeps the desktop shell a thin kiosk over the same web app.
