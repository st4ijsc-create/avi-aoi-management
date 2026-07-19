# St4i Machine Simulator

Exhibition machine simulator that evolves into real edge middleware — a WPF kiosk app + a
headless service, sharing one `St4i.EdgeCore` pipeline (driver → normalize → transport). See
`docs/ECOSYSTEM/62_MACHINE_SIMULATOR_EDGE_MIDDLEWARE_DESIGN_2026-07-18.md` for the full design;
**§11** is the middleware evolution roadmap (P1 this build → P5).

*(Trình mô phỏng máy triển lãm tiến hoá thành middleware edge thật — xem tài liệu thiết kế đầy đủ
ở đường dẫn trên; §11 là lộ trình tiến hoá.)*

---

## 1. What it is / Đây là gì

**EN** — A fleet of simulated exhibition machines (screwdriver, dispenser, welder, assembly press,
leak tester, functional tester, IoT sensor, AOI/AVI inspector) driven through the exact same
`IDeviceDriver → Normalizer → ITransport → EdgePipeline` pipeline that a real machine's firmware
would use against the ST4I AOI/AVI platform (contract per doc 61, the Machine Developer Integration
Guide). It doubles as a live demo booth app (dashboard, per-machine detail, API Inspector, kiosk
mode) **and** as the seed of production edge middleware — `St4i.EdgeCore` has no WPF dependency, so
the same pipeline also runs headless via `St4i.EdgeService`.

**VI** — Một đội máy triển lãm mô phỏng (bắt vít, điểm keo, hàn, ép lắp ráp, kiểm rò rỉ, kiểm chức
năng, cảm biến IoT, máy soi AOI/AVI) chạy qua đúng pipeline `IDeviceDriver → Normalizer → ITransport
→ EdgePipeline` mà firmware máy thật sẽ dùng để bắn dữ liệu vào hệ thống ST4I AOI/AVI (đúng theo
contract doc 61). Vừa là app trình diễn tại gian hàng (dashboard, chi tiết từng máy, API Inspector,
chế độ kiosk), vừa là hạt giống của middleware edge sản xuất thật — `St4i.EdgeCore` không phụ thuộc
WPF nên cùng pipeline đó cũng chạy headless qua `St4i.EdgeService`.

---

## 2. Requirements / Yêu cầu

- **.NET 10 SDK** (`dotnet --version` ≥ 10.0). Every project targets `net10.0-windows` (WPF +
  `System.Windows.Threading`); the whole solution is Windows-only.
- **win-x64** — the app/service ship as `win-x64`; `RuntimeIdentifier` is already pinned in the WPF
  csproj.
- No database, no external services required for Demo mode (see §4) — it runs fully offline out of
  the box.

---

## 3. Build & Run / Build & Chạy

```powershell
cd tools/machine-simulator

# Build the whole solution (WPF app + EdgeCore + EdgeService + tests)
dotnet build St4iMachineSimulator.sln -c Debug

# Run the exhibition app (opens the kiosk window, Demo mode by default)
dotnet run --project src/St4iMachineSimulator

# Headless self-test — exercises the full DI graph + fleet + every screen without opening a
# window; prints "SELFTEST OK" and exits 0 on success. Useful in CI / before a build handoff.
dotnet run --project src/St4iMachineSimulator -- --selftest

# Run the xUnit suite (St4i.EdgeCore.Tests)
dotnet test tests/St4i.EdgeCore.Tests/St4i.EdgeCore.Tests.csproj
```

The app boots straight into **Demo mode** with no configuration — it is the bulletproof,
offline-first default: no server, no network, no `mk_` key needed to see the whole fleet running
and streaming realistic 201/202 acks through the API Inspector.

---

## 4. Modes — Live / Demo / Auto / Chế độ

Toggled from the shell's top bar (or `Settings`). Backed by `TransportCoordinator` re-pointing one
DI-resolved `ITransport` at whichever concrete transport is active — every screen/ViewModel looks at
the same seam regardless of mode.

| Mode | Behavior |
|---|---|
| **Demo** (default) | `DemoTransport` — an offline fabricator: realistic incrementing ids, dedup-by-idempotency-key, deterministic (no wall clock/RNG), configurable fake latency/error rate. No network at all. |
| **Live** | `LiveTransport` — a real `St4iDeviceClient` (the reference SDK) talking to a real ST4I server. Needs `Settings` → Server URL / Verify TLS / Machine code, plus a machine `mk_` credential (see §5). |
| **Auto** | Tries Live first; on any network failure or an unconfigured `mk_`, falls back to Demo and raises a **DEMO FALLBACK** badge — never a crash/error state. Periodically re-probes Live. |

*(VI: Demo là mặc định, không cần server. Live nói thật với server ST4I. Auto tự rơi về Demo khi
Live lỗi/chưa cấu hình — không bao giờ crash.)*

---

## 5. Live setup — server flags + credential / Cấu hình Live

To point this app at a real server, the **ops/dev team must first turn on the ingest flags** the
machine feeds need (doc 61 §12 — all default OFF, "ships-dark"):

| Flag | Enables | Default |
|---|---|---|
| `PROCESS_RESULT_INGEST_ENABLED` | RESULT feed (`POST /api/v1/ingest/process-result`) | OFF |
| `CONFIG_SYNC_GENERIC_ENABLED` | config-sync check/get/ack | OFF |
| `CONFIG_DRIFT_REPORT_ENABLED` | two-way drift via heartbeat `running[]` | OFF |
| `PROCESS_STORE_FORWARD_ENABLED` | WAL buffer for RESULT when DB is down | OFF |
| `OT_STORE_FORWARD_ENABLED` | WAL buffer for telemetry | OFF |
| `MACHINE_CRED_MK_ONLY_ENABLED` | requires `mk_` for automation/iot | OFF |
| `ENROLLMENT_ENABLED` | `met_` enrollment flow | OFF |
| `PROCESS_ATTR_VALIDATE_MODE` | `stepType` vocab check (`off/log/enforce`) | off |

*(TELEMETRY + heartbeat need no flag. Full 14-flag matrix: doc 58 §6.)*

Then get a machine credential (`mk_...`) via the **Onboarding** screen (Register → PollApproval →
Claim, or paste an existing key, or drop a `fleet.json` through its file picker) — same
register/claim contract doc 61 §3 documents, run against the real server when `IsDemo` is off.
Fastest path for a dev box: `PasteKey` with a key minted through the platform's own admin/onboarding
UI. Once a machine has a stored `mk_` (via `CredentialStore`, DPAPI-protected), flip the top-bar mode
to Live or Auto.

---

## 6. The two proof drivers — Hot-folder AOI & MQTT / Hai driver chứng minh

Both prove the exact same `IDeviceDriver` seam a real machine driver would implement — not mocks:

### 6.1 Hot-folder AOI (doc 28) — one click in-app

Go to **Scenario** → click the **"Hot-folder AOI"** preset. It writes one guaranteed-NG doc-28
result file (`Doc28Writer.WriteAtomic`, real atomic-rename protocol) into a temp watch folder, then
runs a dedicated `EdgePipeline` over a real `HotFolderAoiDriver` watching that same folder — you'll
see the round-tripped inspection land in the API Inspector within a couple of seconds, proving the
full **file → middleware → ingest** loop with a real producer and a real consumer (no mocking on
either side). This is also exercised headlessly by `--selftest` and by
`HotFolderDriverTests`/`Doc28ParserTests` in the test suite.

*(VI: vào màn Scenario, bấm preset "Hot-folder AOI" — ghi 1 file doc-28 NG thật, rồi
`HotFolderAoiDriver` đọc lại thật, thấy lên API Inspector trong vài giây.)*

### 6.2 MQTT — proven via the test suite; wire it into a real broker programmatically

`St4i.EdgeCore.Drivers.Mqtt.MqttDriver` (MQTTnet v5) is a first-class `IDeviceDriver`: it connects to
any broker (an in-process `InProcessBroker` for self-contained demos, or a real Mosquitto/EMQX in the
field), subscribes to topic filters, and bridges each `(topic, payload)` through a caller-supplied
mapper into a `DeviceReading`. This exhibition build doesn't wire it to a Scenario-screen button yet
(that's roadmap — see §9) — today it's proven by `MqttDriverTests` (publish → driver receives →
`ReadAsync` yields), which you can run directly:

```powershell
dotnet test tests/St4i.EdgeCore.Tests/St4i.EdgeCore.Tests.csproj --filter MqttDriverTests
```

To demo it against a real broker, construct one and feed it into an `EdgePipeline` the same way
`HotFolderAoiDriver` is used in `FleetService.RunHotFolderAoiDemoAsync`:

```csharp
await using var driver = new MqttDriver(host: "localhost", port: 1883,
    topics: new[] { "sensors/+/telemetry" },
    map: (topic, payload) => /* parse payload -> DeviceReading */);
var pipeline = new EdgePipeline(driver, MappingProfile.ForClass(DeviceClass.Iot), transport, eventBus);
await pipeline.RunAsync(ct);
```

*(VI: MqttDriver đã có sẵn và được chứng minh qua xUnit (MqttDriverTests, dùng InProcessBroker) —
publish 1 sample thấy telemetry đi qua. Chưa có nút trên UI Scenario; wiring vào UI/EdgeWorker là
việc của lộ trình §9.)*

---

## 7. Scenario presets / Kịch bản trình diễn

The **Scenario** screen (`ScenarioViewModel`) exposes 4 live sliders (cycle-rate, extra-defect-rate,
fault-rate, network-outage toggle) plus 5 one-click presets and a **Burst** button:

| Preset | What it shows |
|---|---|
| **Ca bình thường** (Normal) | Baseline — every other preset compares against this. |
| **Lô lỗi cao** (High-defect lot) | Injects extra fail-rate to trigger andon/alert behavior. |
| **Sensor drift** | Speeds up cycles to surface `IOT_SENSOR`'s periodic calibration-drift event within a short demo window. |
| **Mất mạng demo** (Network outage) | Swaps the live transport for a ~90%-error `DemoTransport` — API Inspector shows queued/failed rows while the fleet keeps running; re-selecting "Ca bình thường" restores clean acks. |
| **Hot-folder AOI** | One-shot doc-28 write+ingest demo — see §6.1. |
| **Burst** (button) | 6× cycle-rate for 4s, then auto-reverts to whatever rate was active before — proves throughput visibly spikes without restarting the demo. |

---

## 8. Kiosk mode + attract mode / Chế độ kiosk + tự trình diễn

- **F11** toggles kiosk (borderless, maximized, topmost); **Esc** exits it. Wired in `ShellView`'s
  key handling, mirrored two-way with `Settings.Kiosk`.
- **Attract mode**: after an idle timeout with no input, `AttractModeService` auto-cycles through
  Dashboard → Machine detail → API Inspector on a timer, for unattended booth operation; any mouse/
  keyboard activity exits it immediately back to Dashboard.

---

## 9. EdgeService — the headless seam / Middleware chạy không cần UI

`St4i.EdgeService` is a plain `Microsoft.Extensions.Hosting` Generic Host running an `EdgeWorker`
`BackgroundService` that drives the *same* EdgeCore pipeline with **no WPF, no window** — the "this
evolves into production middleware" proof. It never references the WPF project.

```powershell
# Run until Ctrl-C, using its own small in-code default fleet (8 machines)
dotnet run --project src/St4i.EdgeService

# Load the packaged fleet.json instead, and stop automatically after 20 committed readings
# (exit code 0) — good for CI smoke tests
dotnet run --project src/St4i.EdgeService -- --fleet fleet.json --smoke 20
```

- `--fleet <path>` — load the roster from a `fleet.json`-shaped file via `FleetConfig.Load` instead
  of the built-in default; silently falls back to the default if the path doesn't exist.
- `--smoke <N>` — stop the host itself after exactly N `EdgePipeline.Committed` events, exit 0. No
  `--smoke` means it runs until externally cancelled, the normal Windows-Service shape.

---

## 10. Fleet & mapping packaging / Đóng gói fleet.json + mapping

- **`fleet.json`** (repo root of this tool) — the default 11-machine roster: 2×SCREWDRIVE,
  1×DISPENSING, 1×WELDER, 1×ASSEMBLY, 1×LEAK_TEST, 1×FUNCTIONAL_TEST, 2×IOT_SENSOR, 2×AOI, spanning
  all 3 `DeviceClass` values (`automation`/`iot`/`aoiAvi`, case-insensitive). The WPF app
  (`FleetService`) auto-loads it from next to the exe on startup (or via `--fleet <path>`), falling
  back to a smaller in-code default roster only if no `fleet.json` is found or it fails to parse —
  the kiosk always has something running.
- **`mapping/*.json`** — `MappingProfile` presets per machine class: `screwdrive.json`,
  `dispensing.json`, `welder.json`, `iot-sensor.json`, `aoi.json`, plus `hotfolder-aoi.json` and
  `mqtt-iot.json` for the two proof drivers in §6. Each declares `name`/`deviceClass`/
  `defaultStepType`/`defaultRecipeCode`/`unitMap` (e.g. mapping a device-native `"C"` to the
  platform's canonical `"°C"`). `fleet.json` entries reference these by name via `mappingProfile`
  (`null` for machine types with no dedicated preset yet — ASSEMBLY/LEAK_TEST/FUNCTIONAL_TEST).
- Both are shipped with the build/publish output (`CopyToOutputDirectory=PreserveNewest` in the WPF
  csproj) so an operator can hand-edit `fleet.json`/`mapping/*.json` next to a published exe with no
  rebuild. Proven to parse via `PackagingFleetJsonTests` in the xUnit suite, `St4i.EdgeService --fleet
  fleet.json --smoke N`, and the WPF `--selftest` run (which now organically exercises the shipped
  `fleet.json`, not just the in-code fallback).

> **Not yet wired into the runtime pipeline.** `fleet.json` itself IS live — `FleetService` actually
> loads and runs it (see above). The `mapping/*.json` **presets** are not: nothing in this build calls
> `MappingProfile.FromJson` against them yet — `FleetService`/`EdgeWorker` both build one shared,
> generic `MappingProfile` ("Mixed") for the whole pipeline, since `Normalizer` today only ever
> consults `DefaultStepType`/`UnitMap`, never per-machine `DeviceClass` routing. They ship as
> future-extensibility placeholders that demonstrate the per-class `MappingProfile` shape (and
> `fleet.json`'s `mappingProfile` field already references them by name) — actually resolving that
> reference into a real per-machine profile at pipeline-build time is doc 62 §11's **P2** ("Mapping
> UI") scope, not this build's.
>
> *(VI: `mapping/*.json` CHƯA được runtime đọc — chỉ là placeholder cho lộ trình P2 doc 62 §11, minh
> hoạ shape MappingProfile cho từng lớp máy; pipeline hiện tại dùng 1 profile chung "Mixed".)*

---

## 11. Publish — self-contained single-file exe / Đóng gói exe độc lập

```powershell
dotnet publish src/St4iMachineSimulator -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -o publish
```

Produces `publish/St4iMachineSimulator.exe` — a single file with the full .NET runtime + LiveCharts/
SkiaSharp native libraries embedded, runnable on a clean win-x64 machine with **no separately
installed .NET runtime**. Verify it actually runs headlessly before handing it off:

```powershell
publish/St4iMachineSimulator.exe --selftest
```

should print `SELFTEST OK` and exit 0. `fleet.json` + `mapping/` ship next to the exe from the same
publish (see §10), so a publish output is fully self-contained for a demo booth: copy the whole
`publish/` folder to a clean machine and double-click.

---

## 12. Roadmap / Lộ trình tiếp theo

This build is **P1** of doc 62 §11's middleware evolution plan — `IDeviceDriver`/`Normalizer`/
`MappingProfile` are deliberately shaped so each later phase only adds one driver class + mapping
preset, never touches the pipeline/transport/UI:

| Phase | Adds | Protocol |
|---|---|---|
| **P1 (this build)** | Simulator + EdgeCore + Normalizer + Live/Demo/Auto + Hot-folder AOI + MQTT + headless service seam + packaging | Hot-folder (doc 28), MQTT |
| P2 | Mapping UI + Sparkplug B + headless Device Manager | MQTT/Sparkplug B |
| P3 | Modbus TCP/RTU + Serial drivers (screw/glue guns, small PLCs, RS-232/485) | Modbus, Serial |
| P4 | OPC-UA + Siemens S7 / EtherNet-IP drivers | OPC-UA, S7, EtherNet/IP |
| P5 | SECS/GEM + Zmotion (koffi FFI) + HA/buffering + security hardening + OTA config | SECS/GEM, Zmotion |

See `docs/ECOSYSTEM/62_MACHINE_SIMULATOR_EDGE_MIDDLEWARE_DESIGN_2026-07-18.md` §11 for the full
detail, and `docs/ECOSYSTEM/61_MACHINE_DEVELOPER_INTEGRATION_GUIDE_2026-07-18.md` for the contract
every driver ultimately targets.

---

## 13. Web UI standalone offline desktop package (Task 9) / Đóng gói web UI thành app desktop offline

`web/` (Tasks 1-8) is a separate React/Vite UI for the same `St4i.EngineApi` engine host (Task 3) —
7 screens, i18n (vi/en), dark mode. Task 9 packages it as a native, chrome-less desktop window that
runs **fully offline** (Demo mode, the default) for a trade-exhibition machine with no internet.

### 13.1 Dev mode — unchanged

```powershell
cd tools/machine-simulator
dotnet run --project src/St4i.EngineApi          # engine + API + WS on :5199
cd web && npm run dev                             # Vite dev server on :5173, proxies to :5199
```

`web/src/lib/api.ts`/`inspector.ts` default to `http://localhost:5199` in dev
(`import.meta.env.DEV`) — this split is untouched by Task 9.

### 13.2 Deliverable A (ships) — WebView2 desktop shell, no Rust needed

**Environment reality this build targets:** Rust/Cargo/rustup are **absent** on the exhibition build
box; a full Tauri build is not available without installing them (see §13.4). WebView2 Runtime and
.NET SDK 10 **are** present, so this deliverable is built entirely from the .NET toolchain already
on the machine — same end result as Tauri (a native window embedding Chromium, no browser chrome),
just assembled from `dotnet publish` + a small WPF `WebView2` host instead of `cargo`/`tauri build`.

**How it works:**
1. `St4i.EngineApi` (the same ASP.NET host from Task 3) now also serves the built web UI —
   `St4i.EngineApi.csproj` copies `web/dist/**` into `wwwroot/` at build time (Content item,
   `Condition="Exists('..\..\web\dist')"` so a fresh checkout without a `web/dist` yet still builds);
   `Program.cs` adds `UseDefaultFiles()` + `UseStaticFiles()` + `MapFallbackToFile("index.html")` (SPA
   deep-link fallback) around the existing API/WebSocket endpoint maps. One process, one port, serves
   UI + API + WS — no CORS needed for this same-origin path (though the dev-mode CORS policy for
   `:5173`/`tauri://localhost` is untouched).
2. `web/src/lib/api.ts`'s `BASE_URL` and `inspector.ts`'s `inspectorStreamUrl()` now default to a
   **relative path** (`""`) / **`window.location.origin`** respectively in a production build
   (`import.meta.env.PROD`) when `VITE_ENGINE_URL` isn't set — so a `npm run build` bundle served by
   EngineApi automatically talks to whatever host:port it was loaded from, no hardcoded port. The
   `VITE_ENGINE_URL` env var still overrides both when set (needed for the Tauri path — see §13.4).
3. A new project, `src/St4i.DesktopShell` (WPF, `net10.0-windows`, `Microsoft.Web.WebView2` NuGet —
   added to `St4iMachineSimulator.sln`): on startup, probes `GET http://localhost:5199/v1/fleet`; if
   nothing answers, spawns `.\engine\St4i.EngineApi.exe` as a child process (stdout/stderr piped to
   `%LOCALAPPDATA%\St4iMachineSimulator\logs\engine.log`, since it runs with no console window),
   polls the same URL until it's ready (25s timeout, shows a status line in the window meanwhile),
   then points a `WebView2` control (explicit user-data folder under `%LOCALAPPDATA%`) at
   `http://localhost:5199/`. If an EngineApi is **already** running on that port (e.g. re-launching
   the shell without closing a previous one), it attaches to it instead of spawning a second one —
   and, correctly, does NOT kill a process it didn't start. Closing the window kills the engine child
   process (`Process.Kill(entireProcessTree: true)`) if-and-only-if this shell instance owns it — no
   orphaned `St4i.EngineApi.exe` left running after the visitor closes the app.

**Build & publish (exact commands, run in order):**

```powershell
cd tools/machine-simulator

# 1. Build the web UI
cd web
npm run build                     # -> web/dist/ (tsc -b && vite build)
cd ..

# 2. Publish the engine (now serving the UI too) — self-contained, single-file, win-x64
dotnet publish src/St4i.EngineApi/St4i.EngineApi.csproj -c Release -r win-x64 `
  --self-contained true -p:PublishSingleFile=true -o publish-desktop/engine

# 3. Publish the desktop shell — self-contained, single-file, win-x64
dotnet publish src/St4i.DesktopShell/St4i.DesktopShell.csproj -c Release -r win-x64 `
  --self-contained true -p:PublishSingleFile=true -o publish-desktop
```

**Resulting layout** (the whole `publish-desktop/` folder is the shippable artifact — copy it
anywhere on the exhibition PC and double-click the shell exe):

```
publish-desktop/
  St4i.DesktopShell.exe        <- double-click THIS (native window, no browser chrome)
  WebView2Loader.dll, *.dll    <- WPF/WebView2 native deps (single-file publish still needs these)
  engine/
    St4i.EngineApi.exe         <- spawned as a child process automatically, port 5199
    wwwroot/                   <- the built web UI (from step 1)
    fleet.json, mapping/*.json <- default 11-machine roster (§10)
```

**Run:** double-click `publish-desktop/St4i.DesktopShell.exe`. No dev server, no internet — Demo
mode (the engine's default transport) fabricates the entire fleet locally. Engine port: **5199**
(same fixed port as dev mode — `St4i.EngineApi.Program.cs`).

**Verified LIVE (this task):** published the artifact per the commands above, copied the whole
`publish-desktop/` folder to a clean directory outside the repo (no dev server, nothing else
running on :5199/:5173), launched `St4i.DesktopShell.exe` — native window opened
(`MainWindowTitle="ST4I Machine Simulator"`), engine child process (`St4i.EngineApi`, separate PID)
came up and answered `GET /v1/fleet` within the poll window, dashboard rendered correctly (navy/white
theme, Vietnamese UI, not blank), clicked **"Chạy Fleet"** — all 11 machines went online and started
producing cycles (verified via a `GET /v1/fleet` snapshot mid-run: 34+ cycles, ~93% FPY, realistic
per-machine sparklines/status), all with **zero network activity** (Demo mode). Closed the window —
both the shell process and the engine child process exited cleanly, port 5199 freed, no orphan.
Screenshots taken by capturing the actual native window's on-screen pixels (not a browser tab).

### 13.3 Dev-mode split vs. packaged split — do not confuse the two

| | Dev mode (§13.1) | Packaged (§13.2) |
|---|---|---|
| UI served by | Vite (`:5173`) | `St4i.EngineApi` itself (`:5199`, static files) |
| `VITE_ENGINE_URL` default | `http://localhost:5199` (`import.meta.env.DEV`) | `""` / same-origin (`import.meta.env.PROD`) |
| Processes | 2 (Vite + `dotnet run` EngineApi), started manually | 1 double-click (`St4i.DesktopShell.exe` spawns EngineApi) |

### 13.4 Deliverable B (documented, NOT built) — Tauri path

**What was attempted:** `where cargo rustup rustc` → nothing found; `where cl.exe` (the MSVC
linker Rust's default `x86_64-pc-windows-msvc` target needs) → also nothing found. A working
`rustup` + Tauri build here would mean installing **both** the Rust toolchain **and** Visual Studio
Build Tools (C++ workload) — realistically a multi-GB download and tens of minutes, with real risk
of stalling on this exhibition-prep box. Per this task's explicit instruction ("do not sink time
into a fragile Rust install — Deliverable A is what ships"), **no install was attempted.** Deliverable
A (§13.2) is fully built, verified, and is what ships for the show.

**What IS done toward Deliverable B:** the `web/src-tauri/` scaffold already existed (Tauri 2,
`create-tauri-app` defaults — `Cargo.toml`, `tauri.conf.json`, icons, a CORS allowlist for
`tauri://localhost` already present in `St4i.EngineApi/Program.cs` from Task 3, anticipating exactly
this path). This task added the one safe, non-Rust config change: `tauri.conf.json`'s
`bundle.externalBin` now declares `"binaries/st4i-engineapi"` — Tauri's sidecar convention. Everything
below is **documented, not compiled/verified** (no Rust toolchain in this environment) — treat it as
a recipe, not a proven build.

**To build the Tauri exe on a machine WITH Rust + MSVC Build Tools:**

1. **Install Rust:** https://rustup.rs (`rustup-init.exe`, default `x86_64-pc-windows-msvc` target)
   — needs the "Desktop development with C++" workload from Visual Studio Build Tools
   (https://visualstudio.microsoft.com/visual-cpp-build-tools/) if not already present.
2. **Publish the engine sidecar**, then copy+rename it into Tauri's expected sidecar path — Tauri
   requires the binary filename suffixed with the Rust **target triple**:
   ```powershell
   dotnet publish src/St4i.EngineApi/St4i.EngineApi.csproj -c Release -r win-x64 `
     --self-contained true -p:PublishSingleFile=true -o publish-tauri-engine
   mkdir web/src-tauri/binaries -Force
   copy publish-tauri-engine/St4i.EngineApi.exe `
        web/src-tauri/binaries/st4i-engineapi-x86_64-pc-windows-msvc.exe
   ```
3. **Add the shell plugin** (needed to spawn the sidecar from Rust) —
   `cargo add tauri-plugin-shell` in `web/src-tauri/`, and grant it permission in
   `web/src-tauri/capabilities/default.json` (add `"shell:allow-execute"` to the `permissions`
   array, scoped to the `st4i-engineapi` sidecar per Tauri's shell-plugin docs).
4. **Spawn-on-startup / kill-on-exit**, in `web/src-tauri/src/lib.rs` (illustrative — adjust to
   the actual `tauri-plugin-shell`/`tauri` 2.x API surface, which this environment cannot verify):
   ```rust
   use tauri_plugin_shell::ShellExt;
   use tauri_plugin_shell::process::CommandChild;
   use std::sync::Mutex;

   struct EngineHandle(Mutex<Option<CommandChild>>);

   #[cfg_attr(mobile, tauri::mobile_entry_point)]
   pub fn run() {
     tauri::Builder::default()
       .plugin(tauri_plugin_shell::init())
       .manage(EngineHandle(Mutex::new(None)))
       .setup(|app| {
         let sidecar = app.shell().sidecar("st4i-engineapi")?;
         let (_rx, child) = sidecar.spawn().expect("failed to spawn St4i.EngineApi sidecar");
         app.state::<EngineHandle>().0.lock().unwrap().replace(child);
         // Poll http://localhost:5199/v1/fleet before navigating, same readiness check as
         // St4i.DesktopShell.MainWindow's StartOrAttachToEngineAsync (§13.2) — omitted here for
         // brevity; port the same logic.
         Ok(())
       })
       .on_window_event(|window, event| {
         if let tauri::WindowEvent::CloseRequested { .. } = event {
           if let Some(child) = window.app_handle().state::<EngineHandle>().0.lock().unwrap().take() {
             let _ = child.kill();
           }
         }
       })
       .run(tauri::generate_context!())
       .expect("error while running tauri application");
   }
   ```
5. **Build**, with `VITE_ENGINE_URL` forced to the sidecar's fixed port — Tauri's frontend loads
   from the `tauri://localhost` custom protocol, NOT from `St4i.EngineApi`'s own HTTP server, so the
   §13.2 same-origin default does **not** apply here; the existing CORS allowlist for
   `tauri://localhost` in `Program.cs` exists precisely for this cross-origin call pattern:
   ```powershell
   cd web
   $env:VITE_ENGINE_URL = "http://localhost:5199"
   npm run build
   npx tauri build
   ```
   Produces an MSI/NSIS installer (and a portable `.exe`) under `web/src-tauri/target/release/bundle/`.

*(VI: môi trường build này KHÔNG có Rust/Cargo lẫn MSVC linker — cài cả hai để build Tauri thật sự
sẽ tốn nhiều GB và nhiều phút, rủi ro treo máy ngay trước triển lãm, nên theo đúng chỉ dẫn task đã
KHÔNG cài. Deliverable A (§13.2, WebView2 + EngineApi) đã build+publish+chạy thật LIVE offline,
đó là thứ mang đi triển lãm. Phần Tauri ở trên là công thức đã ghi lại đầy đủ — CHƯA compile/verify
— cho máy nào có sẵn Rust dùng sau này.)*
