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

# Run the xUnit suites (St4i.EdgeCore.Tests + St4i.EngineApi.Tests)
dotnet test tests/St4i.EdgeCore.Tests/St4i.EdgeCore.Tests.csproj
dotnet test tests/St4i.EngineApi.Tests/St4i.EngineApi.Tests.csproj
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
preset, never touches the pipeline/transport/UI. **Update (Giai đoạn 2, pass 1 + pass 2):** several
P2/P3 items below have since landed — see the **Status** column and **§16** for the full detail
(env vars, endpoints, behavior) of everything now shipped.

| Phase | Adds | Protocol | Status |
|---|---|---|---|
| **P1 (this build)** | Simulator + EdgeCore + Normalizer + Live/Demo/Auto + Hot-folder AOI + MQTT + headless service seam + packaging | Hot-folder (doc 28), MQTT | Delivered |
| P2 | Mapping UI + Sparkplug B + headless Device Manager | MQTT/Sparkplug B | **Sparkplug B: delivered** — a local UNS spine (always-on loopback MQTT broker + dual Sparkplug B/semantic-mirror publisher), see §16.1. Mapping UI + headless Device Manager: still future. |
| P3 | Modbus TCP/RTU + Serial drivers (screw/glue guns, small PLCs, RS-232/485) | Modbus, Serial | **Modbus TCP: partially delivered** — TCP polling only, read-only, `UInt16`/`Int16` registers, one register per read, see §16.4. **Not yet:** 32-bit/float registers, register-block batching, Modbus **RTU** (serial), a per-machine `MappingProfile` override for Modbus. Serial drivers: still future. |
| P4 | OPC-UA + Siemens S7 / EtherNet-IP drivers | OPC-UA, S7, EtherNet/IP | **OPC-UA client: partially delivered** — the licensing spike that used to gate this is resolved (the OPC Foundation .NET stack relicensed MIT on 2025-12-04); a read-only poller against ONE OPC-UA server, `SecurityMode=None` (anonymous or username/password), poll-only (no subscriptions), see §16.6. **Not yet:** Siemens S7 / EtherNet-IP drivers, Sign/SignAndEncrypt security modes, complex/structured-type node decoding. |
| P5 | SECS/GEM + Zmotion (koffi FFI) + HA/buffering + security hardening + OTA config | SECS/GEM, Zmotion | Future. |

**Also delivered this build, not originally scoped as its own P1-P5 phase above** — a default-deny
Policy layer + the XC-R40 `/v1/safety` supervisory E-STOP endpoint (§16.2), per-pipeline fault
isolation (§16.3), and a persistent ISA-95 Asset Registry (§16.5, the "canonical model" piece of
this roadmap). See **§16** for all five middleware-backbone features together.

**Update (Giai đoạn 3, Ecosystem Connect):** the manual-join northbound Site federation this roadmap
line used to list as future has since landed — a durable, self-signed device identity plus a
trust-pinned mutual-TLS bridge that federates the local UNS spine (§16.1) up to a SYNAPSE Site; see
**§17** for the full detail (env vars, endpoints, join flow, security posture).

**Update (Giai đoạn 3, sub-2 — mDNS join wizard):** **browse-side mDNS discovery + a join wizard** has
since landed too — the `/site` page's **"Discover Sites"** button (backed by `GET /v1/site/discover`,
§17.4) browses the LAN for Sites advertising `_synapse-site._tcp` (configurable via
`ST4I_SITE_SERVICE_TYPE`, §17.3) and pre-fills the host/port for the operator; trust is still a manually
pasted, pinned PEM (§17.5). Discovery is browse-only + on-demand (no always-on multicast socket).

**Genuinely still future, not touched by this build:** **mDNS *advertising* (a Site auto-discovering the
machine)** — this device browses for Sites but does not announce itself; **EST/SCEP enrollment + a Site CA** — today the device
identity is a bare self-signed certificate and trust is a single operator-pasted PEM, not a
CA-issued/rotated chain; **an inbound command path (NCMD or otherwise)** — the bridge is
outbound-telemetry-only, so a Site can observe this device but never actuate it; **certificate
rotation** — the device identity is minted once and never auto-renewed; and **WS-B B2 (bridge
inversion)** — flipping the UNS spine from an additive mirror into the sole source of truth with
ST4I/historian driven asynchronously off it instead of synchronously inside `EdgePipeline` — assessed
and **deliberately deferred to a dedicated GĐ3 pass** (high blast-radius: ~34 files touch the
synchronous ack today; see `docs/plans/2026-07-27-ws-b-b2-bridge-inversion-assessment.md`).

*(VI: Vài mục P2/P3 phía trên ĐÃ giao trong Giai đoạn 2 (pass 1+2) — xem cột **Status** và **§16** để
biết chi tiết đầy đủ (biến môi trường, endpoint, hành vi). Sparkplug B: ĐÃ GIAO qua UNS spine cục bộ
(§16.1). Modbus TCP: GIAO MỘT PHẦN — chỉ đọc qua TCP, thanh ghi UInt16/Int16, mỗi lần đọc 1 thanh ghi
(§16.4); CHƯA có 32-bit/float, đọc theo khối, Modbus RTU (nối tiếp), hay MappingProfile riêng cho từng
máy Modbus. OPC-UA: GIAO MỘT PHẦN — "licensing spike" trước đây từng chặn mục này đã được giải quyết (bộ
thư viện .NET của OPC Foundation đổi giấy phép sang MIT ngày 2025-12-04); một poller chỉ-đọc nối với MỘT
server OPC-UA, `SecurityMode=None` (ẩn danh hoặc username/password), chỉ poll (chưa có subscription), xem
§16.6. CHƯA có: driver Siemens S7/EtherNet-IP, chế độ bảo mật Sign/SignAndEncrypt, giải mã kiểu
phức hợp/cấu trúc. Cũng đã giao trong bản này dù không nằm
trong bảng P1-P5 gốc: lớp Policy mặc định-từ-chối + endpoint an toàn XC-R40 `/v1/safety` (§16.2), cách
ly lỗi theo từng pipeline (§16.3), và Asset Registry ISA-95 bền vững (§16.5 — chính là phần "mô hình
canonical" của lộ trình này).

**Cập nhật (Giai đoạn 3, Ecosystem Connect):** phần gia nhập hệ sinh thái mà mục lộ trình này từng liệt
kê là tương lai — nay ĐÃ GIAO: một danh tính thiết bị bền vững (chứng chỉ tự ký) cùng một bridge mTLS
ghim tin cậy, liên kết xương sống UNS cục bộ (§16.1) lên một SYNAPSE Site. Xem **§17** để biết chi tiết
đầy đủ (biến môi trường, endpoint, luồng gia nhập, tư thế bảo mật).

Vẫn CHƯA làm: **mDNS tự động dò tìm + join wizard** (hiện gia nhập hoàn toàn thủ công — sao chép
fingerprint từ `/site`, đăng ký thủ công tại Site, dán lại chứng chỉ tin cậy của Site, §17.6);
**EST/SCEP + Site CA** để tự động cấp/xoay chứng chỉ (hiện danh tính thiết bị chỉ là chứng chỉ tự ký,
tin cậy chỉ là một PEM operator dán tay, không phải chuỗi CA cấp/xoay); **đường lệnh vào (NCMD hay
khác)** — bridge CHỈ GỬI telemetry RA, Site quan sát được máy này nhưng không điều khiển được;
**xoay vòng chứng chỉ** — danh tính thiết bị chỉ tạo một lần, không tự gia hạn; và **WS-B B2 (đảo
chiều bridge)** — đã đánh giá và CHỦ ĐỘNG hoãn sang một đợt GĐ3 riêng (phạm vi ảnh hưởng lớn — khoảng 34
file đang dùng ack đồng bộ).)*

See `docs/ECOSYSTEM/62_MACHINE_SIMULATOR_EDGE_MIDDLEWARE_DESIGN_2026-07-18.md` §11 for the full
detail, and `docs/ECOSYSTEM/61_MACHINE_DEVELOPER_INTEGRATION_GUIDE_2026-07-18.md` for the contract
every driver ultimately targets.

---

## 13. Web UI standalone offline desktop package (Task 9) / Đóng gói web UI thành app desktop offline

`web/` (Tasks 1-8) is a separate React/Vite UI for the same `St4i.EngineApi` engine host (Task 3) —
11 screens, i18n (vi/en), 3 themes. Task 9 packages it as a native, chrome-less desktop window.

**WS2 (docs/PRODUCTION_UI_DESIGN.md) — this is a product sold to customers, not a demo tool first:**
the engine's default transport mode is **Live** (connect a real ST4I ecosystem), not Demo. The
**exhibition build** (offline, fabricated 11-machine fleet, what §13.2 below verified live) is now an
explicit opt-in via one flag — see §13.5.

### 13.1 Dev mode — unchanged

```powershell
cd tools/machine-simulator
dotnet run --project src/St4i.EngineApi          # engine + API + WS on :5199
cd web && npm run dev                             # Vite dev server on :5173, proxies to :5199
```

`web/src/lib/api.ts`/`inspector.ts` default to `http://localhost:5199` in dev
(`import.meta.env.DEV`) — this split is untouched by Task 9.

> **WS-D note:** every `/v1/*` route now requires an authenticated session (see §14). The FIRST time
> you open the web UI against a fresh `security.db` you'll land on a **Bootstrap** screen (create the
> first Admin account) instead of the Dashboard — this is expected, not a broken build. To skip it
> entirely (auto-login as `demo-admin`, the exhibition contract), set `ST4I_DEMO_ENABLED=true` on the
> `St4i.EngineApi` process before `dotnet run` (see §14.6). The Playwright suite already does this for
> you — `web/playwright.config.ts`'s `webServer` entry sets it on the engine it spawns.

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

**Run:** double-click `publish-desktop/St4i.DesktopShell.exe`. No dev server needed either way — what
happens next depends on whether the exhibition flag is set (§13.5):
- **Product (no flag, the default since WS2-T1):** the engine boots **Live**, connected to nothing
  yet — the web UI shows the "Connect ecosystem" screen instead of an empty fleet grid until a real
  ST4I server is configured, exactly like a fresh customer install.
- **Exhibition (`ST4I_DEMO_ENABLED=true`):** boots straight into the offline, fabricated 11-machine
  Demo fleet, zero clicks, zero network — the pre-WS2 behavior, still fully supported.

Engine port: **5199** (same fixed port as dev mode — `St4i.EngineApi.Program.cs`).

**Verified LIVE (Task 9, pre-WS2-T1 when Demo was still the engine's own default):** published the
artifact per the commands above, copied the whole `publish-desktop/` folder to a clean directory
outside the repo (no dev server, nothing else running on :5199/:5173), launched
`St4i.DesktopShell.exe` — native window opened (`MainWindowTitle="ST4I Machine Simulator"`), engine
child process (`St4i.EngineApi`, separate PID) came up and answered `GET /v1/fleet` within the poll
window, dashboard rendered correctly (navy/white theme, Vietnamese UI, not blank), clicked **"Chạy
Fleet"** — all 11 machines went online and started producing cycles (verified via a `GET /v1/fleet`
snapshot mid-run: 34+ cycles, ~93% FPY, realistic per-machine sparklines/status), all with **zero
network activity** (Demo mode). Closed the window — both the shell process and the engine child
process exited cleanly, port 5199 freed, no orphan. Screenshots taken by capturing the actual native
window's on-screen pixels (not a browser tab). §13.5 re-verifies the now-default Live/product path.

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

### 13.5 Exhibition vs product packaging — the `ST4I_DEMO_ENABLED` flag / Đóng gói triển lãm vs sản phẩm

WS2 (`docs/PRODUCTION_UI_DESIGN.md` §2.1/§2.2/§2.5) made this a **product sold to customers**, not a
demo tool first — the packaged deliverable in §13.2 above is now used two different ways from the
exact same `publish-desktop/` build, distinguished by a single opt-in flag. Nothing about the
`dotnet publish`/`npm run build` steps in §13.2 changes; only how the resulting exe is *launched*
does.

| | Product build (default) | Exhibition build |
|---|---|---|
| Flag | *(absent)* | `ST4I_DEMO_ENABLED=true`, read once at engine startup by `St4i.EngineApi.Config.DemoModeGate` |
| Engine boots into | **Live** — `TransportMode.Live`, connected to nothing until configured | **Demo** — the fabricated, offline 11-machine fleet, exactly like every build before WS2-T1 |
| First launch shows | The **"Connect ecosystem"** screen (Dashboard/Machines) — enter the ST4I server URL, a live connection-status readout (idle/testing/connected/failed), a retry, and a link to Onboarding to register/claim this machine. Clears automatically the instant a real server answers. | The full dashboard/machine grid immediately — nothing to configure |
| `PUT /v1/mode {Demo}` | Rejected (400, `"Demo mode is not enabled on this deployment."`) — defense in depth, not just a hidden button | Allowed (round-trips back to Live too) |
| `GET /v1/capabilities` | `{demoEnabled:false, mode:"Live"}` | `{demoEnabled:true, mode:"Demo"}` |

**How to ship the exhibition build:** after publishing per §13.2, copy
`tools/machine-simulator/packaging/run-exhibition.bat` into the `publish-desktop/` folder (next to
`St4i.DesktopShell.exe`) and have the operator double-click **that** instead of the `.exe` directly —
it sets the flag, then launches the shell:

```powershell
copy tools\machine-simulator\packaging\run-exhibition.bat publish-desktop\
```

The launcher's whole content is one `set` + one `start`:

```bat
set ST4I_DEMO_ENABLED=true
start "" "%~dp0St4i.DesktopShell.exe"
```

`St4i.DesktopShell`'s `MainWindow.xaml.cs` (`LaunchEngineProcess`) explicitly copies this flag from
its own process environment onto the spawned `St4i.EngineApi.exe` child's — a plain `Process.Start`
already inherits the whole parent environment by default when `StartInfo.EnvironmentVariables` is
left untouched, but the copy is made explicit/greppable there rather than relying silently on that.
Running `St4i.EngineApi.exe` standalone (no `St4i.DesktopShell`, e.g. a headless/server-only
exhibition deployment) needs the same flag set on its OWN process instead — one line, no file needed:

```powershell
$env:ST4I_DEMO_ENABLED = "true"; .\St4i.EngineApi.exe        # PowerShell
```

```cmd
set ST4I_DEMO_ENABLED=true && St4i.EngineApi.exe             :: cmd.exe
```

**Product build:** ship `publish-desktop/` with **no launcher, no flag** — the operator just
double-clicks `St4i.DesktopShell.exe` as documented in §13.2. First run connects to nothing (a fresh
install has no ecosystem configured yet): Dashboard and Machines both show the "Connect ecosystem"
screen — enter the customer's real ST4I server URL (same field `Settings` → *Server connection*
already exposes, wired into this screen directly rather than a second config surface), watch the
status go idle → testing → connected, then follow the "Register / claim this machine" link into
Onboarding. The screen disappears the moment the configured server answers — Dashboard/Machines
immediately show the real fleet from then on, no reload needed (`GET /v1/settings/probe` is polled
in the background the whole time this screen is up).

*(VI: WS2 biến app này thành sản phẩm bán cho khách — cùng một bản build `publish-desktop/`, chỉ khác
CÁCH chạy. Bản triển lãm: copy `packaging/run-exhibition.bat` cạnh `St4i.DesktopShell.exe`, bấm file
đó thay vì bấm thẳng .exe — set cờ `ST4I_DEMO_ENABLED=true` rồi mới chạy shell, cờ này truyền xuống
tiến trình engine con. Bản sản phẩm (mặc định): không cờ, không file phụ — bấm thẳng .exe, máy vào
Live, hiện màn "Kết nối hệ sinh thái" cho tới khi nhập đúng địa chỉ máy chủ thật; màn này tự biến mất
ngay khi máy chủ trả lời.)*

---

## 14. Security (WS-D) — local cookie auth, RBAC, audit log / Bảo mật cục bộ

WS-D added a full local security layer in front of `St4i.EngineApi`: every `/v1/*` route requires an
authenticated session **by default** — the only anonymous routes are `/v1/health`, `/v1/capabilities`,
the four `/v1/auth/bootstrap-status|bootstrap|login` routes, and the SPA fallback (`index.html`).
Everything below is enforced **server-side** (ASP.NET Core cookie auth + named authorization
policies) — the web UI's own route-guards/hidden buttons are front-line UX only, never the real gate.

**EN/VI:** WS-D thêm một lớp bảo mật cục bộ đầy đủ trước `St4i.EngineApi` — mọi route `/v1/*` mặc định
đều cần phiên đăng nhập; chỉ health/capabilities/bootstrap-status/bootstrap/login và trang SPA fallback
là ẩn danh. Tất cả được chặn ở PHÍA SERVER, giao diện web chỉ là lớp UX hỗ trợ.

### 14.1 Cookie auth + first-run bootstrap

- Session cookie: `HttpOnly`, `SameSite=Lax`, `SecurePolicy=SameAsRequest`, 8h sliding expiration.
  Every request re-validates the cookie's baked-in `security_stamp` against the user row's CURRENT
  one — a password/role/disable change invalidates every other outstanding session on its very next
  use, not just at next login.
- **First run** against an empty `security.db` (no users yet): `GET /v1/auth/bootstrap-status` reports
  `needsBootstrap: true` and the web UI shows a **Bootstrap** screen instead of the Dashboard — create
  the first account, username + password, which is minted as **Admin**. `POST /v1/auth/bootstrap` is
  anonymous but one-shot: a second call (once any user exists) is rejected with `409 Conflict`.
- After that: `POST /v1/auth/login` (username + password) mints the cookie; `POST /v1/auth/logout`;
  `GET /v1/auth/me`; `POST /v1/auth/change-password` (self-service, new password ≥ 8 chars, bumps the
  stamp and so invalidates every other session for that account, including — on its next validation —
  this one).
- Login timing is equalized across "unknown username" / "disabled account" / "wrong password" (a
  throwaway password-hash verification is run on the two rejecting branches that don't already pay
  that cost) — a classic username-enumeration side channel closed by design, not an afterthought.

### 14.2 Three roles / Ba vai trò

Each role maps to a named ASP.NET Core authorization policy (`Policies.Operator/Engineer/Admin`, each
an OR-set over the role strings — Admin satisfies all three), applied per-route across every mapped
`/v1/*` endpoint. `RbacPolicyTests` exhaustively sweeps every registered route's metadata and asserts
it carries exactly its intended policy (or `AllowAnonymous`) — not a sampled spot-check.

| Role | Can do |
|---|---|
| **Operator** (least-privileged) | View everything (fleet/machine/product/recipe/config/machine-settings/scenario/historian/OEE), start/stop/e-stop the fleet, manage their own session (logout / me / change-password). No configuration writes. |
| **Engineer** | Everything Operator can, **plus** configure: edit products/points/recipes, machine-config & machine-settings pull/push + sync, `Settings` (server URL / language / machine code), scenario mutations + presets/burst, onboarding (register/claim), OEE settings, the Inspector WebSocket stream. |
| **Admin** | Everything Engineer can, **plus** administer: user management (`/users` — create, change role, disable/enable, reset password), the `/audit` log (read + verify chain integrity), historian prune, and one in-handler escalation — see §14.4. |

*(VI: Operator chỉ xem + vận hành fleet. Engineer thêm quyền cấu hình (sản phẩm/điểm đo/recipe/machine-
config/settings/scenario/onboarding). Admin thêm quyền quản trị (người dùng, nhật ký kiểm toán, prune
historian, và việc tắt xác thực TLS — xem §14.4).)*

### 14.3 Audit log — honest threat model

Every sensitive mutation (auth events, user management, settings/`verifyTls` changes, machine-config
sync, scenario actions, product/recipe/point edits, fleet actions, the startup binding-risk check,
…) is written to a hash-chained `audit_log` table living in the same `security.db` — actor, role,
action, target, old/new value JSON, correlation id, an advisory client IP, and a timestamp. Each row's
hash commits to the previous row's hash; the `/audit` screen's **"Verify chain integrity"** button
(Admin-only) walks the whole chain and reports intact vs. broken.

> **Honest limitation — read before calling this "tamper-proof" anywhere else.** This chain is
> tamper-**evident** against in-app modification and interior row deletion **only**. It is keyless and
> fully self-contained (nothing outside `security.db` to check against), so it does **not** resist a
> local actor with direct file-level access to `security.db` — e.g. editing the file with the process
> stopped, or a SQLite client against it with sufficient OS permissions. Such an actor can
> tail-truncate the chain, forge new rows using the same public hash algorithm, or re-forge it
> entirely from row 1 onward, all **undetected** by chain verification (which only checks internal
> consistency of whatever rows currently sit in the table — never against an independent record of
> what *should* be there). A keyed HMAC (an off-box key) and/or an external append-only/WORM anchor
> would close this gap and is **explicitly deferred to ecosystem/Site scope** (tracked as XC-R39), not
> built in this workstream. The `/audit` screen itself only ever surfaces this caveat via an info
> tooltip — it never claims "tamper-proof" or "immutable" as headline copy.

*(VI: Nhật ký kiểm toán dạng chuỗi hash chỉ phát hiện được sửa/xoá qua chính ứng dụng — KHÔNG chống lại
việc chỉnh sửa trực tiếp file `security.db` khi tiến trình đã dừng. HMAC có khoá ngoài + neo WORM bên
ngoài sẽ khắc phục việc này, nhưng đó là phạm vi hệ sinh thái/Site (XC-R39), chưa làm ở đây.)*

### 14.4 `verifyTls` — default-on, Admin-gated to disable

Every transport this codebase constructs defaults `verifyTls: true`. `PUT /v1/settings` lets any
Engineer change `serverUrl`/`language`/`machineCode` freely, but flipping `verifyTls` to **`false`**
(accepting an unverified/self-signed server certificate) is escalated **in-handler** to Admin-only —
a materially bigger security decision than the route's own Engineer-tier policy allows, and one that
depends on the request BODY rather than the route, so it can't be expressed as a second
`RequireAuthorization` policy. A `true → false` transition is also its own dedicated audit action
(`settings.verifyTls_disabled`), distinct from the general `settings.update` row, so it's trivially
filterable in `/audit`.

### 14.5 Loopback-default binding + non-loopback HTTP warning

This engine is meant to be reached over loopback only — dev mode via Vite's own proxy (§14.8),
packaged mode via `St4i.DesktopShell`'s WebView2 pointed at `localhost:5199` (§13.2). Once Kestrel has
actually bound its listening addresses at startup, the host checks every bound URL and logs a
`Warning` (plus always writing a `system.startup` audit row, safe-or-not) whenever any address serves
**plain HTTP on a non-loopback host** — i.e. anything other than `localhost` / `127.0.0.1` / `[::1]`.
An HTTPS binding is never flagged regardless of host; a loopback HTTP binding is never flagged either.
The risk being flagged is real and specific: session cookies and any credentials sent to this API
would traverse whatever network reaches that address in **cleartext**. Fix: bind loopback-only, or put
the host behind HTTPS.

### 14.6 `ST4I_DEMO_ENABLED` — exhibition auto-login (demo-admin)

On an exhibition build (`ST4I_DEMO_ENABLED=true`, §13.5), a middleware transparently provisions (once,
idempotently, under a lock) and signs in a real `demo-admin` **Admin** account for any request that
isn't already authenticated — no login/bootstrap screen, matching the "zero clicks" exhibition
contract. `demo-admin`'s password is a random value nobody is ever meant to type (the only way in is
this auto-login seam) — it still goes through the exact same one-way `PasswordHasher` as every other
account, never stored/logged in the clear. On a **product** build (`ST4I_DEMO_ENABLED` unset, the
default since WS2-T1) this middleware is a complete no-op and the normal bootstrap/login flow (§14.1)
applies from the very first run — no backdoor exists on a real customer deployment.

### 14.7 Lock-out recovery

There is **no** offline `--reset-admin-password` (or any other) CLI recovery verb in this build —
`St4i.EngineApi`'s `Program.cs` takes no command-line arguments at all today. Recovery instead relies
on always having **at least one other enabled Admin**: any Admin can reset any user's password
(`POST /v1/users/{id}/reset-password`) or re-enable/re-promote another account from the `/users`
screen. The server-enforced, race-proof "last enabled Admin" guard (`UserEndpoints.IsLastEnabledAdmin`
— refuses to disable or demote-away-from-Admin the sole remaining enabled Admin, even under concurrent
requests) exists specifically to keep this recovery path from ever locking itself out through the
UI/API.

**Operational recommendation:** bootstrap/create **at least 2** Admin accounts on any real deployment.
If every Admin account's password is genuinely forgotten with no other recovery path, the only
remaining option is direct SQLite surgery on `security.db` (e.g. clearing the `users` table to
re-trigger `bootstrap-status: needsBootstrap=true`) — not a supported or scripted path in this build.

*(VI: KHÔNG có lệnh dòng lệnh `--reset-admin-password` để khôi phục ngoại tuyến. Cách khôi phục là luôn
giữ ≥2 tài khoản Admin đang bật — một Admin có thể reset mật khẩu Admin khác qua màn `/users`. Nếu MẤT
hết Admin, chỉ còn cách can thiệp trực tiếp vào file `security.db`, không có kịch bản hỗ trợ sẵn.)*

### 14.8 Dev Vite `/v1` proxy — same-origin cookies

`web/vite.config.ts`'s dev server (`:5173`) proxies every `/v1/*` request — REST **and** the
Inspector's WebSocket upgrade (`ws: true`) — to the fixed-port engine (`:5199`), making the dev server
and the API **same-origin** from the browser's point of view. This is load-bearing, not cosmetic:
`/v1/auth/*`'s `SameSite=Lax` session cookie is only ever sent back on a same-origin fetch — without
this proxy, a direct cross-port fetch from `:5173` straight to `:5199` would never see the cookie come
back on the next request, and login would appear to silently fail. `web/src/lib/api.ts`'s `BASE_URL`
doc comment documents the client-side half of this same contract (and why the packaged build in §13.2
needs no such proxy at all — one process, one origin, no cross-port split to bridge).

---

## 15. Windows Service & Installer / Dịch vụ Windows & Trình cài đặt

**EN** — WS-F1 adds three things on top of everything §13 already documents: (1) `St4i.EngineApi.exe`
can register **itself** as a Windows Service, so it runs headlessly and starts at boot with no
`St4i.DesktopShell`/desktop session involved at all; (2) a WiX v4 MSI that installs the same
`publish-desktop/` payload with a Start-Menu shortcut and three off-by-default optional features; (3)
the operational knobs (service config, uninstall/data retention, signing, auto-update) an IT/ops team
needs to actually run this in the field. None of this changes how §13's Live/Demo/Exhibition packaging
works — it only adds a service-hosting option and an installer around the existing publish output.

*(VI: WS-F1 thêm 3 thứ lên trên những gì §13 đã tài liệu hoá: (1) `St4i.EngineApi.exe` tự đăng ký làm
Windows Service, chạy nền không cần phiên desktop; (2) trình cài đặt MSI (WiX v4) đóng gói cùng cây
`publish-desktop/` với shortcut Start Menu + 3 tính năng tùy chọn mặc định TẮT; (3) các nút vận hành
(cấu hình dịch vụ, gỡ cài đặt/giữ dữ liệu, thiếu chữ ký số, nền tảng tự cập nhật) đội IT/vận hành cần để
chạy thật ngoài hiện trường.)*

### 15.1 The Windows Service — `St4iEngineApi` / Dịch vụ Windows

`St4i.EngineApi.exe` (Task 3's ASP.NET host, §13.2 — the same one that serves the web UI + API on
`:5199`) self-registers with the Service Control Manager; no separate service executable exists.

```powershell
# From an ELEVATED ("Run as administrator") prompt/shell:
.\St4i.EngineApi.exe --install      # registers the service, sets start type to auto, sets its description
.\St4i.EngineApi.exe --status       # queries the SCM: "St4iEngineApi: Running" / "Stopped" / "not installed"
.\St4i.EngineApi.exe --uninstall    # unregisters it (sc.exe refuses if it's currently running — stop it first)

sc start St4iEngineApi              # or services.msc, or a reboot (start type is auto)
sc stop St4iEngineApi
```

- Internal SCM name: **`St4iEngineApi`** (`ServiceHostConstants.ServiceName`) — the one identifier both
  the *running* process (`AddWindowsService(o => o.ServiceName = ...)` in `Program.cs`, a complete
  no-op unless the process was actually launched BY the SCM) and the *install/uninstall* verbs share,
  so they can never disagree. Display name in `services.msc`: "ST4I Machine Simulator Engine".
- `--install`/`--uninstall`/`--status` are handled as the very first thing `Program.cs` does, before
  `WebApplication.CreateBuilder` runs — a pure verb invocation never spins up Kestrel or touches the
  historian/WAL/security directories or DPAPI.
- Runs as **`LocalSystem`** by default (`ServiceInstallVerbs.DefaultAccount` — also what the MSI's
  optional service feature registers, §15.3). **Why:** the security-hardening pass (§14) locks the
  `%ProgramData%\ST4I\sim\security` directory's ACL down to exactly three principals —
  `NT AUTHORITY\SYSTEM`, `BUILTIN\Administrators`, and whichever account happened to create/own the
  directory first (`SecurityDirAcl.Apply`) — nobody else, including a dedicated low-priv service
  account added later, gets any access at all. LocalSystem is always one of those three, so it always
  works with zero extra provisioning.
- **Optional hardened-account alternative (manual today):** a dedicated low-privilege account (instead
  of LocalSystem) is possible, but only if it is provisioned *before* the security directories are
  first created — i.e. the FIRST process to ever run under that account becomes the ACL'd "owner" — or
  if its access is granted by hand afterward (`icacls "%ProgramData%\ST4I\sim\security" /grant
  "DOMAIN\svc-account:(OI)(CI)F"`). Neither `--install` nor the MSI's `ServiceFeature` exposes a flag to
  pick a different account today — both hardcode `LocalSystem` — so switching accounts is a manual
  post-install step (`sc config St4iEngineApi obj= "DOMAIN\svc-account" password=...`) followed by the
  `icacls` grant above, not a supported one-command path yet.
- `sc.exe create`'s `binPath` carries **only the exe path, no extra CLI arguments** — a service-hosted
  instance can't be given `--urls`/`--fleet`/etc. on its command line the way an interactive `dotnet
  run`/double-click launch can. Environment variables (§15.2) are the only configuration channel
  available to a running service.
- A non-elevated `--install`/`--uninstall` fails clearly: `sc.exe` returns exit code 5 ("Access is
  denied"), which the verb detects and reports as "this requires administrator privileges."

*(VI: `St4i.EngineApi.exe` tự đăng ký với SCM — không có exe dịch vụ riêng. Tên nội bộ `St4iEngineApi`
dùng chung giữa lúc chạy và lúc cài/gỡ nên không bao giờ lệch nhau. Chạy mặc định dưới `LocalSystem` vì
ACL bảo mật (§14) chỉ cấp quyền cho SYSTEM/Administrators/chủ thư mục đầu tiên — tài khoản ít quyền
riêng chỉ hoạt động nếu được cấp trước khi thư mục security được tạo, hoặc cấp tay bằng `icacls` sau đó;
hiện chưa có cờ dòng lệnh để chọn tài khoản khác, phải làm tay qua `sc config` + `icacls`. `binPath` của
sc.exe chỉ có đường dẫn exe, không tham số — nên biến môi trường (§15.2) là kênh cấu hình DUY NHẤT cho
một service đang chạy.)*

### 15.2 Service config — per-service registry `Environment` / Cấu hình dịch vụ qua registry

A Windows Service does not inherit the environment of whichever user is (or isn't) logged on — there's
no user profile for it to read. The standard Windows mechanism is a **`REG_MULTI_SZ`** value named
`Environment` under the service's own registry key,
`HKLM\SYSTEM\CurrentControlSet\Services\St4iEngineApi\Environment` — the SCM reads it and injects every
line into the service process's environment block right before launching it (not read/reread live —
restart the service after changing it).

```powershell
# From an ELEVATED PowerShell:
New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\St4iEngineApi' -Name Environment `
  -PropertyType MultiString -Force -Value @(
    'ASPNETCORE_URLS=http://localhost:5199'
    'ST4I_HISTORIAN_DIR=D:\St4iData\historian'
    'ST4I_WAL_DIR=D:\St4iData\wal'
    'ST4I_SECURITY_DIR=D:\St4iData\security'
    'ST4I_DEMO_ENABLED=false'
    'ST4I_SERVER_URL=https://central.example.com'
    'ST4I_MACHINE_CODE=LINE3-AOI-01'
    'ST4I_VERIFY_TLS=true'
  )

sc stop St4iEngineApi; sc start St4iEngineApi   # Environment is only re-read at process start
```

The env vars that actually matter to this engine:

| Variable | Controls | Default when unset |
|---|---|---|
| `ASPNETCORE_URLS` | Kestrel bind address(es) — `Program.cs` only applies its own hardcoded `http://localhost:5199` default when NEITHER `--urls` nor this is set | `http://localhost:5199` |
| `ST4I_HISTORIAN_DIR` | Historian SQLite DB (`historian.db`) + `oee-settings.json` root | `%ProgramData%\ST4I\sim\historian` |
| `ST4I_WAL_DIR` | Store-and-forward WAL queue-file root (`WalOptions`) | `%ProgramData%\ST4I\sim\wal` |
| `ST4I_SECURITY_DIR` | `security.db` (users/sessions/audit log) + the DataProtection key ring root | `%ProgramData%\ST4I\sim\security` |
| `ST4I_DEMO_ENABLED` | `true` boots into the offline Demo fleet (exhibition, §13.5); unset/`false` boots Live (product default) | unset → Live |
| `ST4I_SERVER_URL` | The Live-mode ST4I server URL — `FleetHost`'s **initial** `serverUrl` at process start (WS-F1 final review fix F1) | `FleetHost.DefaultServerUrl` (`http://localhost:5000`) |
| `ST4I_MACHINE_CODE` | This engine's Live-mode machine identity — `FleetHost`'s **initial** `machineCode` at process start | `FleetHost.DefaultMachineCode` (`ENGINE-API-01`) |
| `ST4I_VERIFY_TLS` | `false`/`0` (case-insensitive) disables TLS certificate verification for the Live transport; unset/anything else leaves it on | unset → `true` |

*(Also relevant if the WAL needs tuning: `ST4I_WAL_ENABLED`/`ST4I_WAL_MAX_BYTES` — same idiom, see
`WalOptions`. Not a service-only mechanism — these same env vars work identically for an interactive
`dotnet run`/double-click launch; the registry `Environment` value is specifically how to set them when
there's no shell/user session to export them from.)*

*(Giai đoạn 2/3 additions, same idiom, cross-referenced rather than duplicated here — see §16 for the
full table: `ST4I_UNS_ENABLED`/`ST4I_UNS_SITE`/`_AREA`/`_LINE`/`_CELL`/`_PORT` (§16.1, the local UNS
spine), `ST4I_MODBUS_ENABLED`/`_HOST`/`_PORT`/`_MAP` (§16.4, the Modbus TCP driver),
`ST4I_OPCUA_ENABLED`/`_ENDPOINT`/`_MAP`/`_PKI_DIR` (§16.6, the OPC-UA client driver), `ST4I_ASSETS_DIR`
(§16.5, the Asset Registry's `assets.db` location).)*

*(WS-F1 final-review fix F1 — `ST4I_SERVER_URL`/`ST4I_MACHINE_CODE`/`ST4I_VERIFY_TLS` are read ONCE at
process start and applied via `FleetHost.UpdateSettings` — the exact same code path a runtime
`PUT /v1/settings` call already uses (so the rebuild of the Live transport/config-sync backends behaves
identically either way). This is what makes a headless service's Live config actually survive a
restart: before this fix `St4i.EngineApi` read none of these three (only `St4i.EdgeService`'s
`EdgeWorker` did), so a service always came back up pointed at the placeholder
`http://localhost:5000`/`ENGINE-API-01` defaults no matter what had been configured through the UI/API.
An env var left unset/blank leaves that field at `FleetHost`'s own built-in default — it does not force
Demo mode or otherwise validate connectivity. This ONLY covers the process's INITIAL settings at
startup — see §15.8(a) for what still does *not* persist across a restart.)*

*(VI: Dịch vụ Windows KHÔNG kế thừa biến môi trường của người dùng đăng nhập — cơ chế chuẩn là giá trị
`REG_MULTI_SZ` tên `Environment` dưới khóa registry của service,
`HKLM\SYSTEM\CurrentControlSet\Services\St4iEngineApi\Environment`; SCM chỉ đọc lúc khởi động tiến
trình, đổi giá trị xong phải `sc stop`/`sc start` lại. 8 biến quan trọng: `ASPNETCORE_URLS` (địa chỉ
bind), `ST4I_HISTORIAN_DIR`, `ST4I_WAL_DIR`, `ST4I_SECURITY_DIR` (thư mục dữ liệu), `ST4I_DEMO_ENABLED`
(bật Demo ngoại tuyến), và (từ bản vá WS-F1 final-review F1) `ST4I_SERVER_URL`/`ST4I_MACHINE_CODE`/
`ST4I_VERIFY_TLS` — 3 biến này được đọc MỘT LẦN lúc khởi động và áp dụng làm cấu hình Live BAN ĐẦU của
`FleetHost` qua đúng cơ chế `PUT /v1/settings` runtime dùng, nên service khởi động lại vẫn giữ đúng cấu
hình Live đã đặt qua registry — biến nào không đặt thì giữ nguyên giá trị mặc định sẵn có của
`FleetHost`.)*

### 15.3 Installer — WiX v4 MSI / Trình cài đặt MSI

A per-machine MSI that installs the same `publish-desktop/` deliverable §13.2 already produces
(`St4i.DesktopShell.exe` + the spawned engine + web UI + default fleet/mapping data) with a Start Menu
shortcut, plus three optional features, all **OFF by default**. Full detail, rationale, and the exact
verification performed: **`packaging/installer/README.md`** — this section is a summary, not a
duplicate.

```powershell
cd tools/machine-simulator
dotnet tool install --global wix --version 4.0.5   # optional — only needed for `wix msi decompile`/`validate` diagnostics; the build itself doesn't need this CLI on PATH
.\packaging\installer\build-installer.ps1
```

produces `packaging/installer/bin/x64/Release/St4iMachineSimulator.msi` — runs `npm run build` (web
UI), publishes `St4i.EngineApi` + `St4i.DesktopShell` (self-contained, single-file, win-x64) into a
fresh `publish-desktop/`, then builds the WiX v4 MSBuild project (`St4i.Installer.wixproj`, pinned to
`WixToolset.Sdk`/`WixToolset.Heat` **4.0.5** — v6/v7 gate their CLI behind an "Open Source Maintenance
Fee" EULA, so this repo deliberately stays on the last pre-OSMF release).

- **Scope:** `perMachine` — install/uninstall/repair all need elevation (a UAC prompt on double-click).
- **Start Menu:** `ST4I Machine Simulator\ST4I Machine Simulator.lnk`, installed unconditionally
  (`MainFeature`, always on, `Level="1"`).
- **No feature-picker UI is authored** (`WixToolset.UI.wixext` deliberately not referenced, to avoid
  another toolchain dependency) — install/uninstall shows only Windows Installer's own built-in
  progress UI. Optional features are opted into purely via `ADDLOCAL` on the `msiexec` command line:

  | Feature Id | What it does |
  |---|---|
  | `ServiceFeature` | Registers `St4i.EngineApi.exe` as the `St4iEngineApi` Windows Service (LocalSystem, auto-start) via native WiX `<ServiceInstall>`/`<ServiceControl>` — equivalent to §15.1's `--install` verb, same service name/account/start-type. **Pick one mechanism, never both** — using both double-registers the same service name. |
  | `StartupFeature` | Adds a shortcut to the installing user's own Startup folder (`St4i.DesktopShell.exe` launches at sign-in). |
  | `ExhibitionFeature` | Installs `run-exhibition.bat` (§13.5's `ST4I_DEMO_ENABLED=true` launcher) next to the exe. |

  ```powershell
  msiexec /i St4iMachineSimulator.msi /passive                                    # product default: MainFeature only
  msiexec /i St4iMachineSimulator.msi ADDLOCAL=ALL /passive                        # every optional feature
  msiexec /i St4iMachineSimulator.msi ADDLOCAL=MainFeature,ServiceFeature /passive # just the service
  msiexec /x St4iMachineSimulator.msi /passive                                     # uninstall
  ```

*(VI: MSI theo máy (perMachine), cần quyền elevate. Shortcut Start Menu luôn cài, không có UI chọn tính
năng — 3 tính năng tùy chọn, mặc định TẮT, bật qua `ADDLOCAL` trên dòng lệnh `msiexec`: `ServiceFeature`
(đăng ký Windows Service — chọn MỘT cơ chế, không dùng cùng lúc với `--install` của exe),
`StartupFeature` (chạy cùng lúc đăng nhập), `ExhibitionFeature` (cài `run-exhibition.bat`). Chi tiết đầy
đủ: `packaging/installer/README.md`.)*

### 15.4 Uninstall & data retention / Gỡ cài đặt & giữ dữ liệu

Uninstalling (Add/Remove Programs, `msiexec /x`, or a `MajorUpgrade`'s automatic remove-old-version
pass) removes only what the MSI itself installed — everything under `%ProgramFiles%\ST4I\Machine
Simulator\`, the Start Menu/Startup shortcuts, and — if `ServiceFeature` was enabled — stops and
deletes the `St4iEngineApi` service.

**Customer data under `%ProgramData%\ST4I\sim\{historian,wal,security,creds}\` is kept by default** —
the MSI has no `<Component>` referencing anything there (it's all runtime-created by the engine, not
installed), so Windows Installer's uninstall/remove sequence never touches it. This is deliberate: an
uninstall or upgrade must never silently destroy production history, the audit trail, or a machine's
credential.

To actually purge it (decommissioning a machine, resetting a demo box), run the separate, explicit,
destructive script — **never** invoked by the MSI itself:

```powershell
.\packaging\remove-data.ps1 -WhatIf   # preview only, nothing touched
.\packaging\remove-data.ps1           # interactive — prompts before each stop/delete
.\packaging\remove-data.ps1 -Force    # non-interactive, for scripted wipes

# Relocated a data dir via ST4I_HISTORIAN_DIR/ST4I_WAL_DIR/ST4I_SECURITY_DIR (§15.2)? Say so explicitly:
.\packaging\remove-data.ps1 -HistorianDir D:\St4iData\historian -WalDir D:\St4iData\wal -SecurityDir D:\St4iData\security
```

It stops+deletes the `St4iEngineApi` service if present, then deletes the historian/wal/security/creds
data directories — printing an explicit "this destroys the audit chain + historian + credentials"
warning up front, gated through PowerShell's `ShouldProcess`/`-WhatIf`/`-Confirm`.

**Relocated directories (WS-F1 final-review fix F3):** §15.2's `ST4I_HISTORIAN_DIR`/`ST4I_WAL_DIR`/
`ST4I_SECURITY_DIR` mean a deployment's real data doesn't have to live under
`%ProgramData%\ST4I\sim\*` at all — the script used to assume it always did, silently deleting an
empty default directory while the real data sat untouched elsewhere. It now resolves each of those
three per `-HistorianDir`/`-WalDir`/`-SecurityDir`, else the matching `ST4I_*_DIR` environment variable
in **this same PowerShell process**, else the `%ProgramData%` default — printing the resolved path for
each before doing anything. **It does NOT read the service's own registry `Environment` value** (only
this shell's own env) — if a relocated directory was only ever configured there, pass the matching
`-XxxDir` parameter explicitly (check the registry first: `Get-ItemProperty
'HKLM:\SYSTEM\CurrentControlSet\Services\St4iEngineApi' -Name Environment`), or that directory is
missed by this script and must be removed by hand. `creds` has no relocation env var (`CredentialStore`
is not relocatable) — always `%ProgramData%\ST4I\sim\creds`.

*(VI: Gỡ cài đặt chỉ xoá những gì MSI đã cài (Program Files, shortcut, service nếu có bật) — dữ liệu
`%ProgramData%\ST4I\sim\*` được GIỮ LẠI mặc định vì MSI không hề biết tới các thư mục này (do engine tự
tạo lúc chạy). Muốn xoá thật, chạy `packaging\remove-data.ps1` (có `-WhatIf`/`-Force`) — script riêng,
thủ công, có cảnh báo phá hủy rõ ràng, KHÔNG bao giờ được MSI tự gọi. Nếu historian/wal/security đã
được chuyển chỗ qua `ST4I_HISTORIAN_DIR`/`ST4I_WAL_DIR`/`ST4I_SECURITY_DIR`, truyền tham số
`-HistorianDir`/`-WalDir`/`-SecurityDir` tương ứng — script KHÔNG tự đọc giá trị registry `Environment`
của service, chỉ đọc biến môi trường của CHÍNH shell đang chạy nó; nếu không khớp, phải xoá thư mục
thật bằng tay.)*

### 15.5 `St4i.DesktopShell` coexistence / Cùng tồn tại với DesktopShell

If the service (§15.1) is installed and already holds port `:5199`, launching `St4i.DesktopShell.exe`
(§13.2) **attaches** to it instead of spawning a second engine — its own startup probe (`GET
/v1/fleet`) sees something already answering and skips the spawn step entirely, and closing the shell
window does **not** kill a process it didn't start. This is the same attach-vs-spawn logic §13.2
already documents for "re-launching the shell without closing a previous one" — a running service is
just another case of "something's already on :5199."

**Don't also run a manual `St4i.EngineApi.exe` (or `dotnet run --project src/St4i.EngineApi`) on
`:5199`** while the service is running — Kestrel's port bind simply fails for whichever one starts
second. Check what's already using the port first (`sc query St4iEngineApi` / `St4i.EngineApi.exe
--status` / `services.msc`) before starting anything else by hand.

*(VI: Nếu service đã giữ cổng :5199, mở `St4i.DesktopShell.exe` sẽ GẮN VÀO tiến trình đó thay vì mở
engine thứ hai, và đóng cửa sổ shell KHÔNG giết service. Đừng chạy thêm `St4i.EngineApi.exe` thủ công
trên :5199 khi service đang chạy — bind cổng sẽ lỗi cho bên chạy sau; kiểm tra bằng `sc query`/
`--status`/`services.msc` trước.)*

**Caveat — service-first install, then a non-elevated interactive launch (WS-F1 final-review fix
F2):** §14's `SecurityDirAcl.Apply` locks `%ProgramData%\ST4I\sim\security` down to exactly
`NT AUTHORITY\SYSTEM`, `BUILTIN\Administrators`, and whichever account happened to create it *first*
— nobody else gets any access. If the service (§15.1, `LocalSystem` by default) is what creates that
directory first, and someone LATER runs `St4i.DesktopShell.exe`/`St4i.EngineApi.exe` interactively as
a plain, **non-elevated, non-admin** logged-in user (with the service stopped, so the shell spawns its
own engine instead of attaching), that engine cannot read `security.db` or the DataProtection key ring
— every login attempt fails with a 500, not a clean "access denied" message. **Avoid this** by either
(a) running the interactive app **elevated** ("Run as administrator") the first time after a
service-first install, or (b) explicitly granting the interactive user access up front: `icacls
"%ProgramData%\ST4I\sim\security" /grant "DOMAIN\username:(OI)(CI)F"`. Don't run the interactive app as
a plain non-admin user against a security directory a service already created — this is the same
first-writer-owns-the-ACL behavior §15.1 already documents for a dedicated low-privilege service
account, just triggered the other direction (service first, interactive user second).

*(VI: Nếu service (chạy dưới LocalSystem) là bên tạo `%ProgramData%\ST4I\sim\security` TRƯỚC, sau đó ai
đó mở `St4i.DesktopShell.exe`/`St4i.EngineApi.exe` tương tác dưới tài khoản người dùng thường KHÔNG
elevate (service đã dừng nên shell tự spawn engine riêng) — engine đó sẽ KHÔNG đọc được `security.db`
hay key ring, mọi lần đăng nhập sẽ lỗi 500. Tránh bằng cách (a) chạy app tương tác dưới quyền
Administrator lần đầu sau khi cài service, hoặc (b) cấp quyền tay bằng `icacls
"%ProgramData%\ST4I\sim\security" /grant "DOMAIN\username:(OI)(CI)F"`. Đừng chạy app tương tác dưới tài
khoản thường khi thư mục security đã do service tạo trước.)*

### 15.6 Signing gap / Thiếu chữ ký số

**The MSI and every exe inside it are unsigned** — no code-signing certificate is available in this
environment. Installing/running shows "Unknown Publisher" and may trigger SmartScreen. Authenticode-signing (`signtool.exe sign /fd sha256
/tr ... /td sha256 ...`) both the `.msi` and the payload binaries is deferred to a future task once a
certificate is available — it's a pure post-build signing step, no code/authoring changes needed to add
it later.

*(VI: MSI và các exe bên trong CHƯA ký số — chưa có chứng chỉ code-signing. Cài/chạy sẽ hiện "Unknown
Publisher" và có thể bị SmartScreen chặn. Ký Authenticode để sau, khi có chứng chỉ — chỉ là bước ký
thêm sau build, không cần đổi code.)*

### 15.7 Auto-update foundation / Nền tảng tự cập nhật

`<MajorUpgrade>` (fixed `UpgradeCode`, strictly-increasing `Version` from `Directory.Build.props`) means
installing a newer MSI over an older install **upgrades in place** — installing an older MSI over a
newer one is refused with a clear message instead of silently downgrading files under a running app.
This is a **manual** upgrade path (an operator/admin runs the newer `.msi`) — there is no in-app
update-check or auto-download yet. The running version is always visible at `GET /v1/capabilities`
(`{demoEnabled:false, mode:"Live", version:"1.0.0.0"}` — `CapabilitiesEndpoints` reads
`typeof(CapabilitiesEndpoints).Assembly.GetName().Version`, i.e. the built assembly's 4-part
**`<AssemblyVersion>`** from `Directory.Build.props`, currently `1.0.0.0`, not the 3-part `<Version>`
directly. The MSI itself is versioned separately — `build-installer.ps1` reads `<Version>` (currently
`1.0.0`) straight from `Directory.Build.props` and passes it as WiX's `Version` preprocessor variable
(§15.3), so the two numbers share a source but differ in shape (`1.0.0` on the MSI vs. `1.0.0.0` from
`/v1/capabilities`)). Full auto-update (background check, download, staged install) and
long-term-support/channel policy are deferred beyond this workstream.

*(VI: `MajorUpgrade` cho phép cài MSI mới đè lên bản cũ (nâng cấp tại chỗ); cài bản cũ đè bản mới sẽ bị
từ chối rõ ràng. Đây là nâng cấp THỦ CÔNG — chưa có tự kiểm tra/tải bản mới trong app. Phiên bản đang
chạy xem được ở `GET /v1/capabilities` là `AssemblyVersion` 4 phần (`1.0.0.0`), khác với `Version` 3 phần
(`1.0.0`) mà file MSI dùng — cùng nguồn (`Directory.Build.props`) nhưng khác định dạng. Tự cập nhật đầy đủ
+ chính sách LTS để sau.)*

### 15.8 Known fast-follow gaps (and fixes) — be honest / Các khoảng trống đã biết (và đã sửa), nói thật

**(a) A runtime `PUT /v1/settings` edit is still in-memory only — persist config by env var instead
(WS-F1 final-review fix F1 narrowed this gap; it did not remove it).** `FleetHost`'s
`_serverUrl`/`_verifyTls`/`_machineCode` are plain private fields — `PUT /v1/settings` mutates them for
the lifetime of the running process only, with nothing written back to disk/registry, so a service
restart (or a reboot) throws away anything an operator changed *only* through the UI/API at runtime.
What changed: `St4i.EngineApi` now reads `ST4I_SERVER_URL`/`ST4I_MACHINE_CODE`/`ST4I_VERIFY_TLS` (§15.2)
fresh at every process start and applies them as `FleetHost`'s INITIAL settings — before this fix it
read none of these three at all (only `St4i.EdgeService`'s `EdgeWorker` did), so a headless service had
**no** way to be pointed at a real server across a restart; it silently fell back to the
`http://localhost:5000`/`ENGINE-API-01` placeholder defaults every time. A deployment configured once
via the registry `Environment` value now keeps that Live config across every subsequent restart. **What
is still NOT covered:** if an operator changes `serverUrl`/`machineCode`/`verifyTls` through
`PUT /v1/settings` (the web UI) at runtime, that change is NOT written back to the registry — the next
restart reverts to whatever the env vars (or built-in defaults, if none are set) say. To make a runtime
settings change durable, also update the registry `Environment` value (§15.2) to match, then restart the
service — a deeper settings-persistence fast-follow (writing `PUT /v1/settings` through to disk/registry
automatically) is not built in this workstream.

**(b) `CredentialStore` DPAPI scope — FIXED (WS-FF, FF-2).** This used to be per-user DPAPI
(`DataProtectionScope.CurrentUser`): a machine's `mk_` credential (§5) was encrypted to whichever
specific Windows account was running the process when `Save()` was called, decryptable only by that
same account on that same machine — an `mk_` onboarded interactively (as the logged-in operator) would
**not** be readable once the engine was converted to run as a service under a different account (e.g.
`LocalSystem`). FF-2 switched both `Save`/`Load` to `DataProtectionScope.LocalMachine` (matching what the
DataProtection key ring already does — §14, `protectToLocalMachine: true`), so any local account can now
decrypt any `.bin` on that same machine regardless of which account wrote it — filesystem ACLs on the
containing directory (the same rationale as `SecurityDirAcl`, §14) are the confidentiality boundary
now, not the Windows account. **Breaking, by design:** a `.bin` written by a pre-FF-2 build under
`CurrentUser` can no longer be decrypted here — `ProtectedData.Unprotect` throws `CryptographicException`
for it (wrong scope), which `Load` catches and treats as "no stored key" (returns `null`) rather than
letting the exception propagate, so the caller's normal empty-credential path (re-claim through
Onboarding) runs instead of a crash. The same `null`-not-throw behavior also covers any other
corrupt/foreign `.bin` (e.g. bytes from a different machine, or plain garbage) — see
`CredentialStoreTests` for the round-trip-under-`LocalMachine` and corrupt-blob coverage.

**(b, round 2) The creds directory itself is now ACL-locked too (FF-2 review fix).** Switching to
`LocalMachine` scope in round 1 above created a real regression if left there alone: a `LocalMachine`
blob is decryptable by **any** local account, so without also restricting who can even READ the `.bin`
files, `%ProgramData%`'s permissive default ACL (`Authenticated Users` read) would let any local
non-admin read + decrypt every stored `mk_`. Fixed by reusing `SecurityDirAcl` — the exact same
SYSTEM/`BUILTIN\Administrators`/owner-only, inheritance-disabled lock-down §14 already applies to the
`security` directory — against the creds directory too. `SecurityDirAcl` moved from
`St4i.EngineApi.Auth` to **`St4i.EdgeCore.Infrastructure`** (pure `System.Security.AccessControl`, no
ASP.NET dependency) specifically so `CredentialStore.Save` can call it directly for **every** host that
stores credentials — `St4i.EngineApi`, `St4i.EdgeService`, and the WPF app alike — rather than only the
one host that remembered to apply it. `Save` re-applies the lock-down every time it (re-)creates/ensures
the creds directory (self-healing on the next credential save, same idiom `SecurityDirAcl.Apply`'s own
doc comment already documents for the security directory), best-effort and never throwing.

**(c) NU1903 (`SQLitePCLRaw`/CVE-2025-6965) — cleared, not suppressed (WS-FF, FF-2).**
`Microsoft.Data.Sqlite 10.0.10` pins the transitive `SQLitePCLRaw.bundle_e_sqlite3`/`lib.e_sqlite3` at
`2.1.11`, which bundles a pre-3.50.2 SQLite affected by
[GHSA-2m69-gcr7-jv3q](https://github.com/advisories/GHSA-2m69-gcr7-jv3q) (CVE-2025-6965, a
memory-corruption issue, high severity). `2.1.12` is the first patched release on NuGet — verified by
pinning it in a scratch project and reading back `select sqlite_version()` = `3.53.3`, well past the fix
line, and by a clean `dotnet restore` emitting no NU1903 for it. `St4i.EdgeCore.csproj` now carries an
explicit `<PackageReference Include="SQLitePCLRaw.bundle_e_sqlite3" Version="2.1.12" />` — NuGet's
nearest-wins resolution picks this direct reference over `Microsoft.Data.Sqlite`'s own `2.1.11` transitive
minimum, so every project in the solution (via `St4i.EdgeCore`) gets the patched native SQLite build with
no `Microsoft.Data.Sqlite` version change and no `<NoWarn>` suppression needed. The full historian/WAL
SQLite test suites were re-run against this pin and are green.

*(VI: (a) Sửa WS-F1 final-review F1 THU HẸP khoảng trống này, KHÔNG xoá hẳn: đổi `serverUrl`/
`machineCode`/`verifyTls` qua `PUT /v1/settings` lúc đang chạy vẫn CHỈ ở bộ nhớ, mất khi service khởi
động lại. Cái đã sửa: `St4i.EngineApi` giờ đọc `ST4I_SERVER_URL`/`ST4I_MACHINE_CODE`/`ST4I_VERIFY_TLS`
(§15.2) MỖI LẦN khởi động và áp dụng làm cấu hình BAN ĐẦU của `FleetHost` — trước đây không đọc biến nào
trong 3 biến này cả (chỉ `EdgeWorker` của `St4i.EdgeService` đọc), nên service không có cách nào trỏ
đúng server thật qua các lần restart. Cái CHƯA sửa: đổi qua `PUT /v1/settings` lúc runtime KHÔNG ghi
ngược lại registry — muốn bền phải cập nhật registry `Environment` (§15.2) cho khớp rồi restart service.
(b) ĐÃ SỬA (WS-FF, FF-2): `CredentialStore` trước đây mã hoá DPAPI theo TỪNG NGƯỜI DÙNG — khoá `mk_`
claim lúc tương tác dưới tài khoản người dùng sẽ KHÔNG đọc được khi chuyển sang chạy dưới tài khoản
service khác. Giờ đã chuyển sang DPAPI theo LocalMachine (giống key-ring DataProtection, §14) — bất kỳ
tài khoản cục bộ nào trên cùng máy đều giải mã được; ranh giới bảo mật giờ là ACL thư mục, không phải
tài khoản Windows. Đây là thay đổi PHÁ VỠ TƯƠNG THÍCH có chủ đích: file `.bin` mã hoá kiểu cũ
(CurrentUser) không đọc lại được nữa — `Load` bắt lỗi `CryptographicException` và trả về `null` (coi như
chưa có khoá) thay vì crash, buộc claim lại qua Onboarding. (b, vòng 2 — review fix) Vì blob LocalMachine
giải mã được bởi BẤT KỲ tài khoản cục bộ nào, ACL mặc định lỏng lẻo của `%ProgramData%` (Authenticated
Users đọc được) sẽ lộ mọi `mk_` cho tài khoản không phải admin nếu không khoá luôn thư mục `creds`. Đã sửa
bằng cách chuyển `SecurityDirAcl` từ `St4i.EngineApi.Auth` sang `St4i.EdgeCore.Infrastructure` (không phụ
thuộc ASP.NET) và cho `CredentialStore.Save` tự áp dụng khoá SYSTEM/Administrators/chủ thư mục này mỗi
lần lưu khoá — mọi host dùng `CredentialStore` (EngineApi, EdgeService, WPF) đều được khoá tự động, không
cần host nào tự nhớ gọi riêng. (c) NU1903 (SQLitePCLRaw/CVE-2025-6965) —
ĐÃ GIẢI QUYẾT bằng cách ghim phiên bản vá `SQLitePCLRaw.bundle_e_sqlite3 2.1.12` (đã xác minh SQLite bên
trong là 3.53.3, qua ngưỡng vá 3.50.2), KHÔNG dùng `<NoWarn>` để ẩn cảnh báo.)*

---

## 16. Middleware backbone (Giai đoạn 2) — UNS spine, Policy/safety, fault isolation, Modbus, Asset Registry / Middleware nền tảng (Giai đoạn 2)

**EN** — Giai đoạn 2 (pass 1 + pass 2, "SYNAPSE connect") adds five features that turn this exhibition
simulator into real edge middleware: a local Unified Namespace spine, a default-deny Policy layer with
a supervisory E-STOP safety endpoint, per-pipeline fault isolation, a first real field-protocol driver
(Modbus TCP), and a persistent Asset Registry. Everything below is **additive** — the existing ST4I
HTTP ingest path, `EdgePipeline.Committed`, and every pre-existing endpoint/behavior are unchanged
unless explicitly called out.

*(VI: Giai đoạn 2 (pass 1+2, "SYNAPSE connect") thêm 5 tính năng biến trình mô phỏng triển lãm này
thành middleware edge thật: một xương sống Unified Namespace (UNS) cục bộ, lớp Policy mặc định-từ-chối
kèm endpoint an toàn E-STOP giám sát, cách ly lỗi theo từng pipeline, driver giao thức trường đầu tiên
(Modbus TCP), và một Asset Registry bền vững. Tất cả đều là THÊM VÀO — đường ingest HTTP ST4I hiện có,
`EdgePipeline.Committed`, và mọi endpoint/hành vi trước đó không đổi trừ khi nói rõ.)*

**Update (Giai đoạn 3, sub-3 — OPC-UA client driver):** §16.6 below is a later addition, filed as a
sibling of this section rather than under §17 — a SECOND real field-protocol driver (mirrors Modbus
exactly), landed after the rest of §16.

*(VI: **Cập nhật (Giai đoạn 3, sub-3 — driver OPC-UA client):** §16.6 bên dưới được thêm sau, xếp cạnh
mục này thay vì dưới §17 — driver giao thức trường thật thứ HAI (giống hệt Modbus), giao sau phần còn
lại của §16.)*

### 16.1 Local UNS spine — Sparkplug B + retained semantic mirror / Xương sống UNS cục bộ

**EN** — `St4i.EdgeCore.Uns` runs a local Unified Namespace spine: an embedded, loopback-only MQTTnet
broker (`UnsBroker`, bound to `127.0.0.1` only — LAN exposure is explicitly out of scope until mTLS
lands) that is **on by default, even when running fully standalone/offline** — this is a local spine,
not something that requires a Site/ecosystem connection to be useful. `UnsPublisher` additively mirrors
every committed reading onto it via two topic families, with zero change to the existing ST4I HTTP
path or `EdgePipeline.Committed`:

1. **Sparkplug B wire topic** — `spBv1.0/{site}.{area}.{line}/{msgType}/{cell}[/{equipment}]`. NBIRTH
   is published on a real operator `Start` (edge-node level, no device segment); NDEATH on `Stop` or
   `Estop`; DDATA once per committed reading (device-level, `{equipment}` = the machine's code).
2. **Retained semantic mirror** — `syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}`, where
   `aspect` is `result` / `telemetry` / `inspection` (the same three reading-kind buckets the HTTP
   ingest path already switches on) — the reading's own canonical JSON envelope, published with the
   MQTT retain flag set.

Env vars (`UnsOptions.FromEnvironment`, read once at startup — unset/blank falls back to the default,
an unparseable port is silently ignored rather than crashing):

| Var | What it does | Default |
|---|---|---|
| `ST4I_UNS_ENABLED` | `false`/`0` (case-insensitive) turns the whole spine off; anything else (incl. unset) leaves it on | `true` |
| `ST4I_UNS_SITE` | ISA-95 Site segment (Sparkplug `group_id`'s first part; also feeds the Asset Registry URN, §16.5) | `"site"` |
| `ST4I_UNS_AREA` | ISA-95 Area segment | `"area"` |
| `ST4I_UNS_LINE` | ISA-95 Line segment | `"line"` |
| `ST4I_UNS_CELL` | ISA-95 Cell segment — this process's Sparkplug `edge_node_id` | `"cell"` |
| `ST4I_UNS_PORT` | The embedded broker's loopback TCP port | `18832` (deliberately not 1883 — the standard MQTT port — nor 18830, already used by the pre-existing `InProcessBroker` test fixture) |

Failure modes are deliberately non-fatal: if the broker fails to bind at startup (e.g. the port is
already in use), the failure is logged to stderr and the process continues with the UNS spine simply
disabled for that run — it never crashes the host. If the internal publish queue saturates (a stuck/
slow broker connection), the oldest queued item is dropped and a warning logged — a UNS hiccup can
never slow or fail the pipeline's hot commit loop.

*(VI: `St4i.EdgeCore.Uns` chạy một xương sống Unified Namespace cục bộ: một broker MQTTnet nhúng, chỉ
nghe loopback (`127.0.0.1`) — **BẬT mặc định kể cả khi chạy độc lập/ngoại tuyến hoàn toàn**, đây là
xương sống cục bộ, không cần kết nối Site/hệ sinh thái mới có ích. `UnsPublisher` phản chiếu THÊM VÀO
mọi reading đã commit lên hai họ topic, không đổi đường ingest HTTP ST4I hay `EdgePipeline.Committed`
hiện có: (1) topic dây Sparkplug B `spBv1.0/{site}.{area}.{line}/{msgType}/{cell}[/{equipment}]` —
NBIRTH lúc Start thật, NDEATH lúc Stop/Estop, DDATA mỗi reading đã commit; (2) mirror ngữ nghĩa retained
`syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}` (aspect = result/telemetry/inspection). 6 biến
môi trường `ST4I_UNS_*` đọc một lần lúc khởi động, giá trị sai định dạng bị bỏ qua thay vì crash. Lỗi
bind cổng hay hàng đợi đầy đều chỉ log cảnh báo, KHÔNG BAO GIỜ làm crash host hay chậm vòng lặp commit.)*

### 16.2 Policy layer + XC-R40 safety endpoint / Lớp Policy + endpoint an toàn XC-R40

**EN** — `St4i.EngineApi.Policy` adds a thin, default-deny policy engine (`PolicyEngine`) evaluated
INSIDE the existing RBAC gate for every fleet-actuating command (`fleet.start`, `fleet.stop`,
`fleet.estop`, `fleet.estop_reset`, `scenario.burst`): rules are evaluated safety-first, any explicit
**Deny wins over any Permit**, and an action no rule explicitly permits is denied. The
operator-visible behavior change: **`POST /v1/fleet/start` while the E-STOP latch is engaged now
returns `409 Conflict` with reason `SAFETY_BLOCKED`** (plus an audited `fleet.start.denied` row) —
before this, the same call silently no-op'd with a `200`.

Policy reason code → HTTP status mapping: `SAFETY_BLOCKED` / `NOT_READY` / `BUSY` → `409`;
`POLICY_DENIED` → `403`; `INVALID_ARGS` / `UNSUPPORTED` → `400`. Every denial (not just safety ones) is
audited.

New read-only endpoint:

| Path | Verb | Role | Behavior |
|---|---|---|---|
| `/v1/safety` | GET | Operator | Returns `{ estopEngaged, isRunning, safetyClass: "SupervisorySoftwareLatch", advisory }` |

**The XC-R40 boundary** — read this before treating the E-STOP latch as more than it is: it is a
**SUPERVISORY software control**, not a substitute for a machine's independent, safety-rated
emergency-stop circuit, and must never be relied on as a protective safety function; `/v1/safety`
itself carries this advisory string verbatim in its response. `GET /v1/safety` is **read-only by
design** — there is deliberately no write route here. The only two ways to change the underlying latch
remain the pre-existing operator actions: `POST /v1/fleet/estop` (engage) and
`POST /v1/fleet/estop/reset` (clear) — both still Operator-role, both still audited, both still always
reachable even while the latch is engaged (the policy rule never blocks stop/estop/estop-reset/reads).

*(VI: `St4i.EngineApi.Policy` thêm một lớp policy mặc định-từ-chối, đánh giá BÊN TRONG cổng RBAC hiện
có cho mọi lệnh tác động lên fleet — bất kỳ Deny nào cũng THẮNG mọi Permit. Thay đổi hành vi người vận
hành thấy được: `POST /v1/fleet/start` khi E-STOP đang cài giờ trả về `409` lý do `SAFETY_BLOCKED` (kèm
dòng audit `fleet.start.denied`) thay vì im lặng no-op trả 200 như trước. Endpoint mới `GET /v1/safety`
(vai trò Operator, CHỈ ĐỌC) trả trạng thái chốt E-STOP giám sát + cảnh báo XC-R40. **Ranh giới XC-R40**:
chốt này là điều khiển phần mềm GIÁM SÁT, KHÔNG thay thế mạch dừng khẩn cấp an toàn độc lập của máy —
không bao giờ được coi là chức năng an toàn bảo vệ. Chỉ có 2 cách ghi vào chốt: `POST /v1/fleet/estop`
và `POST /v1/fleet/estop/reset` — cả hai vẫn như cũ, vẫn Operator, vẫn được audit, vẫn luôn gọi được kể
cả khi chốt đang cài.)*

### 16.3 Per-pipeline fault isolation / Cách ly lỗi theo từng pipeline

**EN** — `FleetHost` now runs each driver in its own independent `PipelineSlot` — its own `EdgePipeline`,
cancellation token, and background run-task. A slot that faults is removed **in isolation**: only that
slot's own driver is disposed and torn down; every sibling slot (and the rest of the fleet, simulated
or real) keeps running untouched. This is the load-bearing precondition for adding a real OT driver
(Modbus, §16.4) alongside the simulated fleet without risk — a flaky real field connection can degrade,
reconnect, or even fault outright without ever taking the whole engine down. There is no new endpoint
for this — it's an internal reliability property of `FleetHost`, observable as "the rest of the fleet
kept running" behavior rather than a new API surface.

*(VI: `FleetHost` giờ chạy mỗi driver trong một `PipelineSlot` độc lập riêng — EdgePipeline, token huỷ,
và tác vụ nền riêng. Một slot lỗi sẽ bị gỡ CÁCH LY: chỉ driver của slot đó bị dispose/dọn dẹp, mọi slot
khác (và phần còn lại của fleet, mô phỏng hay thật) vẫn chạy không hề bị ảnh hưởng. Đây là điều kiện tiên
quyết để thêm driver OT thật (Modbus, §16.4) cạnh fleet mô phỏng mà không rủi ro — một kết nối trường
thật chập chờn có thể suy giảm/kết nối lại/thậm chí lỗi hẳn mà không bao giờ kéo sập cả engine. Không có
endpoint mới cho việc này — đây là thuộc tính tin cậy nội bộ của `FleetHost`.)*

### 16.4 Modbus TCP driver / Driver Modbus TCP

**EN** — `St4i.EdgeCore.Drivers.Modbus` is the first real field-protocol driver: a periodic TCP poller
(NModbus) that reads a fixed, ordered register list off one Modbus TCP slave, riding its own
fault-isolated pipeline slot (§16.3). **Default OFF** — the opposite polarity from the UNS spine — a
fresh install/CI run with no Modbus endpoint configured is byte-identical to before this feature
existed.

Env vars (`ModbusOptions.FromEnvironment`, same "read once, unparseable falls back to default" idiom
as `UnsOptions`):

| Var | What it does | Default |
|---|---|---|
| `ST4I_MODBUS_ENABLED` | `true`/`1` (case-insensitive) turns the Modbus driver on; anything else (incl. unset) leaves it off | `false` |
| `ST4I_MODBUS_HOST` | Modbus TCP slave host to dial | `127.0.0.1` |
| `ST4I_MODBUS_PORT` | Modbus TCP slave port | `502` |
| `ST4I_MODBUS_MAP` | Path to the register-map JSON file (below) — required for Modbus to actually start even when `ENABLED=true` | none (unset/missing/malformed → Modbus is disabled for this run, logged, never crashes startup) |

Register-map JSON shape (`ModbusRegisterMap.FromJson` — property names matched case-insensitively):

```json
{
  "machineCode": "MODBUS-01",
  "unitId": 1,
  "pollIntervalMs": 1000,
  "registers": [
    { "address": 100, "type": "Holding", "dataType": "UInt16", "scale": 0.1, "metric": "temperature", "unit": "°C" },
    { "address": 101, "type": "Input", "dataType": "Int16", "scale": 1.0, "metric": "pressure", "unit": "kPa" }
  ]
}
```

- `machineCode` — required, non-blank; becomes this Modbus machine's roster/asset code.
- `unitId` — the Modbus slave address on the wire (not related to `machineCode`); defaults to `1`.
- `pollIntervalMs` — poll cadence; defaults to `1000`.
- `registers[]` — required, at least one entry:
  - `address` — the register address (`ushort`).
  - `type` — `"Holding"` (FC03, read/write on the real device) or `"Input"` (FC04, read-only) — this
    driver only ever **reads**, regardless of type.
  - `dataType` — `"UInt16"` (raw 16-bit word) or `"Int16"` (the same bits reinterpreted as two's-complement
    signed) — decoded, **then** multiplied by `scale`.
  - `scale` — e.g. a raw `235` with `scale: 0.1` → telemetry value `23.5`; this is the entire
    unit-conversion story.
  - `metric`/`unit` — the resulting telemetry sample's name/unit.
- A blank `machineCode` or an empty `registers` list is rejected at load (throws), which Program.cs
  catches — it logs a warning and disables Modbus for the run rather than crashing startup.

When Modbus is enabled and its map loads successfully, the Modbus machine is wired in as a
**first-class roster member** — it gets a fleet snapshot tile, a historian row per poll, and (via
Asset Registry auto-upsert, §16.5) an asset row, not just an invisible telemetry stream — and its
readings are mirrored onto the UNS spine (§16.1) exactly like every other machine's.

**Honest deferrals** (documented in the driver's own source, not silently missing): 32-bit/float
register values (combining a register PAIR) and register-block batching (today: one read per
register, per poll) are follow-ups, not built; **Modbus RTU (serial)** is not implemented — TCP only;
there is no per-machine `MappingProfile` override for Modbus yet (it uses one shared `Automation`-class
fallback profile for every Modbus machine today).

*(VI: `St4i.EdgeCore.Drivers.Modbus` là driver giao thức trường thật đầu tiên — vòng lặp poll TCP định
kỳ (NModbus) đọc danh sách thanh ghi cố định từ một Modbus TCP slave, chạy trong pipeline slot cách ly
lỗi riêng (§16.3). **MẶC ĐỊNH TẮT** — ngược cực với UNS spine. 4 biến môi trường `ST4I_MODBUS_*` (bảng
trên). Định dạng JSON register-map: `machineCode`, `unitId` (mặc định 1), `pollIntervalMs` (mặc định
1000), `registers[]` gồm `address`/`type` (Holding FC03 hoặc Input FC04, chỉ ĐỌC dù loại nào)/`dataType`
(UInt16 hoặc Int16, giải mã XONG mới nhân `scale`)/`scale`/`metric`/`unit`. `machineCode` rỗng hoặc
`registers` rỗng bị từ chối lúc nạp — Program.cs bắt lỗi này, log cảnh báo, tắt Modbus cho lần chạy đó
thay vì crash. Khi bật và map nạp thành công, máy Modbus trở thành thành viên fleet CHÍNH THỨC (có tile,
historian, asset) chứ không chỉ là luồng telemetry vô hình; dữ liệu cũng được phản chiếu lên UNS spine.
**Những gì CHƯA làm** (đã ghi rõ trong code, không giấu): thanh ghi 32-bit/float, đọc theo khối, Modbus
RTU (nối tiếp) — hiện chỉ có TCP; chưa có `MappingProfile` riêng cho từng máy Modbus.)*

### 16.5 Asset Registry / Sổ đăng ký tài sản

**EN** — `St4i.EngineApi.AssetRegistry` (`AssetRegistryStore`) is a persistent SQLite registry giving
every registered machine a durable, ISA-95-addressed identity independent of the in-memory fleet
roster.

- **Storage:** `assets.db`, default location `%ProgramData%\ST4I\sim\assets\assets.db` — a sibling of
  `...\sim\historian`/`...\sim\security`/`...\sim\wal` — relocatable via **`ST4I_ASSETS_DIR`** (same
  idiom as `ST4I_HISTORIAN_DIR`/`ST4I_WAL_DIR`/`ST4I_SECURITY_DIR`, §15.2).
- **URN:** `urn:isa95:{site}:{area}:{line}:{cell}:{code}` — the site/area/line/cell segments come from
  the same process-wide `UnsOptions` address the UNS spine (§16.1) uses; `code` is the machine's own
  code.
- **Lifecycle:** `Provisioned` → `Commissioning` → `Active` → `Maintenance` → `Decommissioned`. A
  machine registers/re-registers as `Active` on a fresh insert; critically, **re-registration (every
  process start's roster-seed, or a dynamic `RegisterMachine` call) never resets an already-set
  lifecycle back to `Active`** — only an explicit operator transition changes it, so a machine parked in
  `Maintenance` stays there across restarts.
- **Every registered machine auto-upserts as an asset** (roster-seed at every process start, plus every
  dynamic registration) — this upsert never throws into its caller; a registry hiccup (locked file,
  missing directory, disk full) is logged and swallowed, so starting/registering the fleet is never
  blocked by an `assets.db` problem.

Endpoints:

| Path | Verb | Role | Behavior |
|---|---|---|---|
| `/v1/assets` | GET | Operator | List every asset |
| `/v1/assets/{code}` | GET | Operator | One asset's detail; `404` if the code is unknown |
| `/v1/assets/{code}/lifecycle` | PUT | Engineer | Transition lifecycle state (body: `{"state":"Maintenance"}`); `400` on an unrecognized state, `404` on an unknown code, audited as `asset.lifecycle.set` |

**Honest deferral:** the web UI's new `/assets` nav item (`AssetRegistry.tsx`) means the existing
visual-regression baselines need a CI `--update-snapshots` pass to account for the new navigation
entry — not yet done as of this doc update.

*(VI: `St4i.EngineApi.AssetRegistry` là sổ đăng ký SQLite bền vững, cho mỗi máy đã đăng ký một danh
tính ISA-95 độc lập với roster fleet trong bộ nhớ. Lưu tại `assets.db` (mặc định
`%ProgramData%\ST4I\sim\assets`, dời chỗ qua `ST4I_ASSETS_DIR`). URN dạng
`urn:isa95:{site}:{area}:{line}:{cell}:{code}`. Vòng đời: Provisioned → Commissioning → Active →
Maintenance → Decommissioned — đăng ký lại KHÔNG BAO GIỜ đưa lifecycle đã set về lại Active, chỉ thao
tác thủ công của operator mới đổi được, nên máy đang ở Maintenance vẫn giữ nguyên qua các lần khởi động
lại. Mọi máy đăng ký đều tự động upsert thành asset, lỗi ghi registry không bao giờ chặn việc khởi động
fleet. 3 endpoint: `GET /v1/assets` (Operator, danh sách), `GET /v1/assets/{code}` (Operator, chi
tiết), `PUT /v1/assets/{code}/lifecycle` (Engineer, đổi vòng đời, có audit). **Việc CHƯA làm:** mục
điều hướng `/assets` mới trên web UI cần chạy lại baseline visual-regression (`--update-snapshots`) —
chưa làm tại thời điểm cập nhật tài liệu này.)*

### 16.6 OPC-UA client driver / Driver OPC-UA client

**EN** — `St4i.EdgeCore.Drivers.OpcUa` is the SECOND real field-protocol driver (mirrors Modbus, §16.4): a
periodic read poller built on the OPC Foundation .NET reference stack
(`OPCFoundation.NetStandard.Opc.Ua.Client` **1.5.378.156** — relicensed **MIT on 2025-12-04**, no longer a
licensing blocker for this roadmap, see §12), reading a fixed, ordered set of nodes off ONE OPC-UA server
every poll, riding its own fault-isolated pipeline slot (§16.3). **Default OFF** — same polarity as
Modbus — a fresh install/CI run with no OPC-UA endpoint configured is byte-identical to before this
feature existed.

Env vars (`OpcUaOptions.FromEnvironment`, same "read once, unparseable falls back to default" idiom as
`ModbusOptions`):

| Var | What it does | Default |
|---|---|---|
| `ST4I_OPCUA_ENABLED` | `true`/`1` (case-insensitive) turns the OPC-UA driver on; anything else (incl. unset) leaves it off | `false` |
| `ST4I_OPCUA_ENDPOINT` | Reserved for a possible future "quick-connect, no map file" mode — currently **not consulted**; the node map's own `endpointUrl` (below) always wins | none |
| `ST4I_OPCUA_MAP` | Path to the node-map JSON file (below) — required for OPC-UA to actually start even when `ENABLED=true` | none (unset/missing/malformed → OPC-UA is disabled for this run, logged, never crashes startup) |
| `ST4I_OPCUA_PKI_DIR` | Overrides the app-instance-certificate PKI root directory | `%ProgramData%\ST4I\sim\opcua-pki` |

Node-map JSON shape (`OpcUaNodeMap.FromJson` — property names matched case-insensitively):

```json
{
  "machineCode": "OPCUA-01",
  "endpointUrl": "opc.tcp://127.0.0.1:4840",
  "securityMode": "None",
  "username": null,
  "password": null,
  "pollIntervalMs": 1000,
  "nodes": [
    { "nodeId": "ns=2;s=Temperature", "metric": "temperature", "unit": "°C" },
    { "nodeId": "ns=2;s=Status", "metric": "status" }
  ]
}
```

- `machineCode` — required, non-blank; becomes this OPC-UA machine's roster/asset code.
- `endpointUrl` — required, non-blank; the ONLY source the driver ever reads its server address from
  (`ST4I_OPCUA_ENDPOINT` above is defined but not consulted by this wiring).
- `securityMode` — currently only `"None"` exists (no message signing/encryption) — an MVP/
  loopback-and-trusted-network posture; `Sign`/`SignAndEncrypt` (Basic256Sha256 + trusted app-instance
  certs) are a documented follow-up, not built.
- `username`/`password` — `null` (default) means anonymous auth.
- `pollIntervalMs` — poll cadence; defaults to `1000`.
- `nodes[]` — required, at least one entry: `nodeId` (the OPC-UA string form, e.g. `"ns=2;s=Foo"`, parsed
  straight into an `Opc.Ua.NodeId`) plus the `metric`/`unit` it becomes on the resulting telemetry sample.
- A blank `machineCode`/`endpointUrl` or an empty `nodes` list is rejected at load (throws), which
  Program.cs catches — it logs a warning and disables OPC-UA for the run rather than crashing startup.

**Value decoding + Verdict.Skip semantics:** every signed/unsigned integer and floating-point OPC-UA type
widens to `double` (one uniform numeric representation, same posture as Modbus's `TelemetrySample`
values); `bool` and `string` pass through as their native .NET type — a **non-numeric string is a
legitimate, supported telemetry value, not an error** (e.g. a `"status"` node reporting `"RUNNING"`):
every numeric-aggregation consumer (the fleet tile's spark line, a machine's telemetry chart series, the
historian's per-poll telemetry rows) goes through one shared `St4i.EdgeCore.Models.TelemetryNumeric`
helper that SKIPS a non-numeric value instead of crashing, while still parsing a genuinely numeric string
like `"42.5"`. Every reading carries `Verdict.Skip` (telemetry has no pass/fail concept — same
KPI-inflation reasoning §16.4 documents for Modbus). A per-node bad/uncertain status code emits that one
metric with `Quality="bad"`/`Value=null` rather than failing the whole poll.

**Security posture (MVP, honestly documented):** the OPC-UA stack requires an app-instance certificate
even at `SecurityMode=None` (it identifies the client to the server's audit log, not for encryption) —
auto-generated on first run under the PKI root above. `AutoAcceptUntrustedCertificates=true` blanket-
trusts whatever certificate the server presents — acceptable for a loopback/trusted-network exhibition
link, **not** for exposure to an untrusted network; validating + pinning the SPECIFIC server certificate
is a documented, non-blocking follow-up, the same posture the deferred Sign/SignAndEncrypt security modes
above are held to.

When OPC-UA is enabled and its node map loads successfully, the OPC-UA machine is wired in as a
**first-class roster member** — it gets a fleet snapshot tile, a historian row per poll, and (via Asset
Registry auto-upsert, §16.5) an asset row, not just an invisible telemetry stream.

**Honest deferrals** (documented in the driver's own source, not silently missing): OPC-UA subscriptions
(today: poll-only, one batched `Read` service call per cycle); complex/structured-type node decoding (an
unexpected node value falls back to `ToString()` rather than a real decode); `Sign`/`SignAndEncrypt`
security modes; Siemens S7 / EtherNet-IP drivers (still future, unstarted).

*(VI: `St4i.EdgeCore.Drivers.OpcUa` là driver giao thức trường thật thứ HAI (giống Modbus, §16.4) — vòng
lặp poll đọc định kỳ dựa trên bộ thư viện tham chiếu .NET của OPC Foundation
(`OPCFoundation.NetStandard.Opc.Ua.Client` **1.5.378.156** — đổi giấy phép sang **MIT ngày 2025-12-04**,
không còn là rào cản giấy phép cho lộ trình này nữa, xem §12), đọc một danh sách node cố định từ MỘT
server OPC-UA mỗi lần poll, chạy trong pipeline slot cách ly lỗi riêng (§16.3). **MẶC ĐỊNH TẮT** — cùng
cực với Modbus. 4 biến môi trường `ST4I_OPCUA_*` (bảng trên) — `ST4I_OPCUA_ENDPOINT` hiện CHƯA được dùng,
`endpointUrl` trong node-map JSON luôn thắng. Định dạng JSON node-map: `machineCode`, `endpointUrl`
(bắt buộc), `securityMode` (hiện chỉ có `"None"`), `username`/`password` (rỗng = ẩn danh),
`pollIntervalMs` (mặc định 1000), `nodes[]` gồm `nodeId` (dạng chuỗi OPC-UA, vd `"ns=2;s=Foo"`) +
`metric`/`unit`. `machineCode`/`endpointUrl` rỗng hoặc `nodes` rỗng bị từ chối lúc nạp — Program.cs bắt
lỗi này, log cảnh báo, tắt OPC-UA cho lần chạy đó thay vì crash.

**Giải mã giá trị:** số nguyên có/không dấu và số thực đều quy về `double`; `bool`/`string` giữ nguyên
kiểu — một chuỗi KHÔNG PHẢI số (vd node `"status"` báo `"RUNNING"`) là một giá trị telemetry HỢP LỆ, không
phải lỗi: mọi nơi tổng hợp số (spark line, chuỗi telemetry, dòng historian) đều đi qua MỘT helper dùng
chung `TelemetryNumeric` — bỏ qua giá trị không phải số thay vì crash, vẫn parse được chuỗi số hợp lệ như
`"42.5"`. Mọi reading đều mang `Verdict.Skip`. Một status code lỗi/không chắc chắn trên một node chỉ làm
metric đó có `Quality="bad"`, không làm hỏng cả lượt poll.

**Tư thế bảo mật (MVP, ghi rõ):** stack OPC-UA yêu cầu chứng chỉ app-instance ngay cả ở `SecurityMode=None`
(để định danh client với audit log của server, không phải để mã hoá) — tự tạo lần đầu chạy dưới thư mục
PKI trên. `AutoAcceptUntrustedCertificates=true` tin tưởng BẤT KỲ chứng chỉ nào server trình ra — chấp
nhận được cho kết nối loopback/mạng tin cậy (trình diễn), KHÔNG chấp nhận được nếu lộ ra mạng không tin
cậy; xác thực + ghim chứng chỉ CỤ THỂ của server là việc CHƯA làm, đã ghi rõ.

Khi OPC-UA bật và node map nạp thành công, máy OPC-UA trở thành thành viên fleet CHÍNH THỨC (có tile,
historian, asset) chứ không chỉ là luồng telemetry vô hình. **Những gì CHƯA làm:** OPC-UA subscription
(hiện chỉ poll — một lệnh `Read` theo lô mỗi chu kỳ), giải mã kiểu phức hợp/cấu trúc (giá trị lạ rơi về
`ToString()`), chế độ bảo mật Sign/SignAndEncrypt, driver Siemens S7/EtherNet-IP.)*

---

## 17. Ecosystem Connect (Giai đoạn 3) — device identity + northbound Site federation / Kết nối hệ sinh thái (Giai đoạn 3) — danh tính thiết bị + liên kết Site hướng lên

**EN** — Giai đoạn 3's Ecosystem-Connect features (EC-1..EC-4) give this device (a) a durable identity
it can present over mutual TLS, and (b) an optional, **default-off**, **outbound-only** bridge that
federates the local UNS spine (§16.1) up to a SYNAPSE Site's MQTT broker. A device with no Site link on
file is byte-identical to every build before this feature landed: standalone, loopback-only, unchanged.
Turning federation on never changes the local pipeline's own behavior — it only adds a second,
independent republish path riding alongside it.

*(VI: Các tính năng Ecosystem Connect của Giai đoạn 3 (EC-1..EC-4) cho thiết bị này (a) một danh tính
bền vững để trình diện qua mutual TLS, và (b) một bridge tuỳ chọn, **MẶC ĐỊNH TẮT**, **CHỈ GỬI RA**,
liên kết xương sống UNS cục bộ (§16.1) lên broker MQTT của một SYNAPSE Site. Một thiết bị chưa cấu hình
Site link giống hệt bản build trước khi có tính năng này — độc lập, chỉ loopback, không đổi. Bật liên
kết không bao giờ đổi hành vi của pipeline cục bộ — chỉ thêm một đường republish thứ hai, độc lập, chạy
song song.)*

### 17.1 Device identity (EC-1) / Danh tính thiết bị

**EN** — `St4i.EdgeCore.Identity.DeviceIdentityStore` mints (once) and loads a self-signed **ECDSA
P-256** X.509 certificate — this device's own durable identity, presented as the client certificate for
mutual TLS when the bridge below federates to a Site. The private key never leaves the box:

- **Storage:** the PFX bytes are DPAPI-protected (`DataProtectionScope.LocalMachine` — the same scope
  and rationale `CredentialStore` already uses for the `mk_` API key, §15.8) and the containing
  directory is ACL-locked (`SecurityDirAcl`, self-healed on every write). Default root
  `%ProgramData%\ST4I\sim\identity` — a sibling of `...\sim\creds`/`...\sim\settings`/`...\sim\historian`
  — relocatable via **`ST4I_IDENTITY_DIR`**.
- **Minted once, at first startup** (`LoadOrCreate`, called exactly once from `Program.cs`): a corrupt
  or unreadable stored blob (wrong machine, wrong DPAPI scope, garbage bytes) is treated as "no identity
  yet" and silently regenerated — a device always ends up with a usable identity, never a crash.
- The certificate's `CN` (and, when safe, a DNS SAN) is derived from this process's ISA-95 **Cell**
  segment (`ST4I_UNS_CELL`, §16.1) — sanitized so an unusual value can never corrupt the X.500 subject.
- Exposes a **SHA-256 fingerprint** and the **public certificate PEM** (never the private key) via
  `GET /v1/site/identity` (§17.4) — this is what an operator hands to the Site to register the device.

*(VI: `DeviceIdentityStore` tạo (một lần duy nhất) và nạp một chứng chỉ X.509 tự ký **ECDSA P-256** —
danh tính bền vững của thiết bị, dùng làm chứng chỉ client cho mutual TLS khi bridge bên dưới liên kết
tới Site. Khoá riêng KHÔNG BAO GIỜ rời khỏi máy: PFX được mã hoá DPAPI (LocalMachine, cùng cách
`CredentialStore` đã dùng cho khoá `mk_`, §15.8), thư mục chứa bị khoá ACL. Thư mục mặc định
`%ProgramData%\ST4I\sim\identity`, dời chỗ qua **`ST4I_IDENTITY_DIR`**. Được tạo LẦN ĐẦU lúc khởi động
(`LoadOrCreate`) — blob hỏng/không đọc được bị coi là "chưa có danh tính" và tự tạo lại, không bao giờ
crash. `CN` chứng chỉ lấy từ đoạn Cell ISA-95 (`ST4I_UNS_CELL`, §16.1), đã làm sạch an toàn. Fingerprint
SHA-256 + chứng chỉ công khai (PEM) được lộ qua `GET /v1/site/identity` (§17.4) — đây là thứ operator
đưa cho Site để đăng ký thiết bị.)*

### 17.2 Site link + northbound bridge (EC-2) / Liên kết Site + bridge hướng lên

**EN** — `St4i.EdgeCore.Site` persists a **Site link** (`site-link.json`, default root
`%ProgramData%\ST4I\sim\sitelink`, relocatable via **`ST4I_SITELINK_DIR`**) holding exactly
`{ enabled, host, port (default 8883), siteTrustPem }` — **no secrets** ever live in this file; the
device's own private key stays where §17.1 already keeps it, and `siteTrustPem` is only ever a PUBLIC
certificate (the Site's CA, or the Site's own self-signed leaf, pinned directly).

When `enabled`, `UnsBridge` (owned/lifecycle-managed by `SiteBridgeManager`) dials the Site's broker
over **mutual TLS**: it presents this device's own certificate (§17.1) and validates the Site's
presented certificate against `siteTrustPem` — **fail-closed** (`SiteTrustPin.IsTrusted`): the
machine's ambient default CA trust store is **deliberately irrelevant** here (a globally-trusted public
CA saying "yes" proves nothing about "is this actually my operator's Site"), so a blank/malformed pin,
or a certificate that doesn't chain to the pinned trust, is always rejected, never silently accepted.

The bridge subscribes the LOCAL UNS spine (`spBv1.0/#` + `syn/#`) and republishes every message,
byte-for-byte (retained for `syn/*`, matching §16.1's own retain policy), up to the Site. It is:

- **Outbound-only** — the bridge's local client only ever subscribes, its remote client only ever
  publishes; nothing the Site sends back is ever pulled into the local spine. There is no inbound
  command path.
- **Resilient** — both the local and remote connections reconnect on their own (bounded exponential
  backoff, capped at 10s, never a tight loop); a bounded, drop-oldest forward queue means a slow/down
  Site can never back-pressure or block the local pipeline.
- **Default-off** — no Site link on file (or one saved with `enabled: false`) means `UnsBridge` never
  opens a single socket; the local broker (`UnsBroker`, §16.1) stays loopback-only regardless of this
  feature's existence either way — only the bridge's own outbound client ever dials off-box.
- Only ever constructed when the local UNS spine itself is on (`ST4I_UNS_ENABLED`, §16.1 — a bridge with
  nothing to subscribe to is meaningless); with UNS disabled, only the identity singleton (§17.1) is
  registered, so `/v1/site/identity` still works standalone.

**Bridge states** (`GET /v1/site`'s `bridgeState`): `Disabled` (no link, or link saved disabled) ·
`Connecting` (link enabled, no successful remote connect yet) · `Connected` (both local + remote
clients up) · `Degraded` (was connected at least once, remote currently down — a **Site outage**; the
local pipeline is unaffected) · `Down` (the LOCAL client can't reach this device's own UNS spine).

*(VI: `St4i.EdgeCore.Site` lưu một **Site link** (`site-link.json`, thư mục mặc định
`%ProgramData%\ST4I\sim\sitelink`, dời chỗ qua **`ST4I_SITELINK_DIR`**) gồm đúng
`{enabled, host, port (mặc định 8883), siteTrustPem}` — KHÔNG có bí mật nào trong file này; khoá riêng
của thiết bị vẫn ở nguyên chỗ §17.1, còn `siteTrustPem` luôn chỉ là chứng chỉ CÔNG KHAI (CA của Site,
hoặc leaf tự ký của chính Site, ghim trực tiếp). Khi `enabled`, `UnsBridge` (do `SiteBridgeManager`
quản lý vòng đời) quay số tới broker của Site qua **mutual TLS**: trình diện chứng chỉ của chính thiết
bị (§17.1) và xác thực chứng chỉ Site trình diện dựa trên `siteTrustPem` — **THẤT BẠI-THÌ-ĐÓNG**
(`SiteTrustPin.IsTrusted`): kho tin cậy CA mặc định của máy KHÔNG liên quan gì ở đây — một CA công khai
được tin cậy toàn cục nói "được" không chứng minh được "đây đúng là Site của operator tôi", nên pin
rỗng/hỏng hoặc chứng chỉ không nối được vào chuỗi tin cậy đã ghim luôn bị TỪ CHỐI. Bridge subscribe
xương sống UNS CỤC BỘ (`spBv1.0/#` + `syn/#`) và republish nguyên văn lên Site (giữ retain cho `syn/*`,
giống §16.1). Đặc tính: **CHỈ GỬI RA** (không có đường lệnh vào); **BỀN BỈ** (tự kết nối lại với backoff
tăng dần có trần 10s, hàng đợi forward có giới hạn/drop-oldest nên Site chậm/sập không bao giờ chặn
pipeline cục bộ); **MẶC ĐỊNH TẮT** (chưa cấu hình hoặc `enabled:false` → không mở socket nào; broker
cục bộ (`UnsBroker`, §16.1) luôn chỉ loopback bất kể tính năng này); chỉ được tạo khi UNS spine cục bộ
đang bật (`ST4I_UNS_ENABLED`, §16.1) — tắt UNS thì chỉ còn singleton danh tính (§17.1), `/v1/site/identity`
vẫn hoạt động độc lập. **5 trạng thái bridge** (`bridgeState` của `GET /v1/site`): `Disabled` ·
`Connecting` · `Connected` · `Degraded` (Site sập, cục bộ không ảnh hưởng) · `Down` (client cục bộ
không tới được UNS spine của chính máy này).)*

### 17.3 Env vars / Biến môi trường

**EN** — Both stores follow the exact same "explicit path (tests) → env var → `%ProgramData%` default"
resolution idiom used elsewhere in this doc (e.g. §15.2's `ST4I_HISTORIAN_DIR`/`ST4I_WAL_DIR`/
`ST4I_SECURITY_DIR`, §16.5's `ST4I_ASSETS_DIR`); an unset/blank env var falls back to the default
rather than erroring:

| Var | What it does | Default |
|---|---|---|
| `ST4I_IDENTITY_DIR` | Relocates the device-identity store (`device-identity.bin` + `device-node.txt`, §17.1) | `%ProgramData%\ST4I\sim\identity` |
| `ST4I_SITELINK_DIR` | Relocates the Site-link store (`site-link.json`, §17.2) | `%ProgramData%\ST4I\sim\sitelink` |
| `ST4I_SITE_SERVICE_TYPE` | The mDNS service type the "Discover Sites" browse (§17.4, `GET /v1/site/discover`) queries for | `_synapse-site._tcp` |

Neither feature introduces a new *enable* flag of its own — the Site bridge's on/off switch is the
persisted link's own `enabled` field (set via `PUT /v1/site`, §17.4), not an environment variable. It
does, however, depend on the **pre-existing** `ST4I_UNS_*` family (§16.1): `SiteBridgeManager` is only
ever registered when `ST4I_UNS_ENABLED` is on (the default), the bridge's local client dials
`ST4I_UNS_PORT` on loopback, and the device identity's `CN`/SAN is derived from `ST4I_UNS_CELL`.

*(VI: Cả hai store đều theo đúng thứ tự phân giải "đường dẫn tường minh (test) → biến môi trường →
mặc định `%ProgramData%`" đã dùng ở nơi khác trong tài liệu này (§15.2, §16.5) — biến trống/chưa đặt
thì dùng mặc định, không báo lỗi. **`ST4I_IDENTITY_DIR`** dời thư mục danh tính thiết bị (mặc định
`%ProgramData%\ST4I\sim\identity`). **`ST4I_SITELINK_DIR`** dời thư mục Site-link (mặc định
`%ProgramData%\ST4I\sim\sitelink`). Không có cờ bật/tắt riêng — công tắc bật bridge chính là trường
`enabled` của link (đặt qua `PUT /v1/site`). Tính năng phụ thuộc vào các biến `ST4I_UNS_*` CÓ SẴN
(§16.1): `SiteBridgeManager` chỉ đăng ký khi `ST4I_UNS_ENABLED` bật (mặc định), client cục bộ của bridge
quay số `ST4I_UNS_PORT` trên loopback, và `CN` của danh tính thiết bị lấy từ `ST4I_UNS_CELL`.)*

### 17.4 Endpoints (EC-3) / Endpoint

**EN** — `St4i.EngineApi.Endpoints.SiteEndpoints` exposes four routes:

| Path | Verb | Role | Behavior |
|---|---|---|---|
| `/v1/site` | GET | Operator | Status + config: `{enabled, host, port, bridgeState, lastError, siteFingerprint, deviceFingerprint, unsEnabled}`. With the local UNS spine disabled, returns a fixed `Disabled`/`unsEnabled:false` view that still reports the real `deviceFingerprint` (a device has an identity whether or not anything is federated). |
| `/v1/site` | PUT | Engineer, audited `site.link.set` | Body `{enabled, host, port, siteTrustPem}` — a **full replace** of the persisted link (an omitted field applies its own default, not "leave unchanged"). Drives `SiteBridgeManager.ApplyAsync` — stops the old bridge, persists, starts a fresh one if `enabled`. `400` if enabling with a missing host, an out-of-range port (must be 1–65535), or a `siteTrustPem` that doesn't parse to at least one certificate; `409` if the local UNS spine is disabled (nothing to bridge). The audit row never logs the raw PEM — only its length + a SHA-256 fingerprint of the PEM text itself. |
| `/v1/site/identity` | GET | Operator | `{deviceFingerprint, deviceCertPem}` — this device's own public identity (§17.1), to register at a Site. |
| `/v1/site/discover` | GET | Engineer | **(GĐ3 sub-2, mDNS join wizard)** A bounded (~4s) mDNS browse of the LAN for the `ST4I_SITE_SERVICE_TYPE` service (§17.3, default `_synapse-site._tcp`) → `DiscoveredSite[] {instanceName, host, port, addresses[], txt{}}`. Read-only network scan (no audit); per-call ephemeral (opens no always-on multicast socket); never throws — an empty array means "no Sites found", not an error. Discovery only *pre-fills* the form host/port; it never sets the trust PEM or enables the link. |

**Deferred:** a pre-save `POST /v1/site/test` connectivity probe (from the original blueprint) was not
built — the live `bridgeState` badge `GET /v1/site` already exposes (`Connecting` → `Connected`/
`Degraded` + `lastError`) is the operator's connection feedback once a link is saved, so a dedicated
pre-save probe is a follow-up, not a blocker.

*(VI: `SiteEndpoints` có 3 route: **`GET /v1/site`** (Operator) — trạng thái + cấu hình (enabled, host,
port, bridgeState, lastError, siteFingerprint, deviceFingerprint, unsEnabled); UNS tắt thì trả về view
cố định `Disabled` nhưng vẫn có `deviceFingerprint` thật. **`PUT /v1/site`** (Engineer, có audit
`site.link.set`) — body `{enabled, host, port, siteTrustPem}`, **THAY THẾ TOÀN BỘ** link đã lưu (trường
bỏ trống áp giá trị mặc định của nó, KHÔNG phải "giữ nguyên"); gọi `SiteBridgeManager.ApplyAsync` — dừng
bridge cũ, lưu, khởi động bridge mới nếu `enabled`. Trả `400` nếu bật mà thiếu host/port sai khoảng
(1–65535)/PEM không hợp lệ; trả `409` nếu UNS spine cục bộ đang tắt. Dòng audit KHÔNG BAO GIỜ ghi PEM
thô — chỉ độ dài + fingerprint SHA-256 của chính văn bản PEM. **`GET /v1/site/identity`** (Operator) —
`{deviceFingerprint, deviceCertPem}`, danh tính công khai của thiết bị để đăng ký tại Site. **Việc CHƯA
làm:** `POST /v1/site/test` (probe kết nối trước khi lưu) chưa xây — badge `bridgeState` sống động của
`GET /v1/site` đã là phản hồi kết nối cho operator sau khi lưu, nên probe riêng là việc làm tiếp theo,
không phải điều kiện chặn.)*

### 17.5 Web UI — the `/site` page (EC-4) / Trang web `/site`

**EN** — The **"Site Link"** nav item (`routes/Site.tsx`, page title "Site / Ecosystem") gives two
cards: a **Device identity** card (Operator-readable) showing the fingerprint + a reveal/copy control
for the certificate PEM, with a hint to register it at the Site; and a **Site connection** card whose
host/port/trust-PEM/enable form is gated to **Engineer or above** (a non-Engineer instead sees a
read-only host/port/enabled summary), with a live bridge-status badge (polled off `GET /v1/site`,
pulsing while `Connecting`) always visible in the card header regardless of role. The Engineer-gated
form also carries a **"Discover Sites"** button (GĐ3 sub-2, `GET /v1/site/discover`, §17.4) — an
on-demand mDNS LAN scan whose discovered Sites the operator can click to pre-fill the host/port (the
trust PEM + enable toggle stay manually operator-controlled).

*(VI: Mục điều hướng **"Site Link"** (`routes/Site.tsx`, tiêu đề trang "Site / Ecosystem") gồm 2 thẻ:
thẻ **Danh tính thiết bị** (Operator đọc được) hiện fingerprint + nút xem/copy chứng chỉ PEM, kèm gợi ý
đăng ký tại Site; và thẻ **Kết nối Site** với form host/port/trust-PEM/bật, CHỈ Engineer trở lên mới
sửa được (người không đủ quyền chỉ thấy bản tóm tắt chỉ-đọc), cùng badge trạng thái bridge sống động
(poll từ `GET /v1/site`) luôn hiện trên header thẻ bất kể vai trò.)*

### 17.6 The join flow (operator steps) / Luồng gia nhập (thao tác của operator)

**EN**
1. Open `/site` (or call `GET /v1/site/identity`) and read this device's **fingerprint** (and, if the
   Site needs it, the public certificate PEM).
2. **Register that identity at the SYNAPSE Site** — Site-side provisioning, out of scope of this repo.
3. Back on `/site` (Engineer or above), paste the **Site's trust certificate** (its CA, or its own
   self-signed leaf — either pinning shape works, §17.2) plus its **host/port**, and enable the link —
   or call `PUT /v1/site` directly with the same fields.
4. The bridge connects: the status badge moves `Connecting` → `Connected`, and telemetry starts
   forwarding upward. If the Site is unreachable, the badge instead settles on `Down`/`Degraded` and
   `lastError` carries the reason — the local pipeline keeps running untouched either way.

*(VI: (1) Mở `/site` (hoặc gọi `GET /v1/site/identity`) để lấy **fingerprint** của thiết bị (và PEM
chứng chỉ nếu Site cần). (2) **Đăng ký danh tính đó tại SYNAPSE Site** — việc này nằm ở phía Site, ngoài
phạm vi repo này. (3) Quay lại `/site` (vai trò Engineer trở lên), dán **chứng chỉ tin cậy của Site**
(CA hoặc leaf tự ký, cả hai đều ghim được — §17.2) cùng **host/port**, rồi bật liên kết — hoặc gọi thẳng
`PUT /v1/site`. (4) Bridge kết nối: badge chuyển `Connecting` → `Connected`, dữ liệu bắt đầu forward lên
Site. Nếu không tới được Site, badge dừng ở `Down`/`Degraded` kèm lý do trong `lastError` — pipeline cục
bộ vẫn chạy bình thường không bị ảnh hưởng.)*

### 17.7 Security posture / Tư thế bảo mật

**EN**
- **Fail-closed mutual auth:** the device presents a real client certificate (§17.1); the Site's own
  certificate is checked against an **operator-pinned** trust anchor, never the machine's ambient CA
  trust store (§17.2) — a rogue listener on `host:port` (DNS spoofing, a compromised segment, ...) is
  rejected, not silently trusted.
- **Private key never leaves the box:** DPAPI(LocalMachine)-sealed + ACL-locked on disk (§17.1); loaded
  with `PersistKeySet` (required for a real schannel client-auth handshake — verified empirically, see
  the store's own doc comment), never re-exported.
- **No secrets in the Site-link file:** `site-link.json` holds only host/port/enabled + the Site's own
  PUBLIC trust PEM (§17.2); the trust PEM itself is write-only over the API (never echoed back by
  `GET /v1/site`) and never logged in full (only a length + fingerprint in the audit row, §17.4).
- **Outbound-only, default-off:** the bridge only ever dials out, never accepts a connection or a
  command from the Site; with no Site link enabled, this device is indistinguishable from a build
  before this feature existed. The local UNS broker itself stays loopback-only regardless — federation
  never opens it up to the LAN.

*(VI: **Xác thực hai chiều thất-bại-thì-đóng:** thiết bị trình diện chứng chỉ client thật (§17.1);
chứng chỉ của Site được kiểm dựa trên tin cậy DO OPERATOR GHIM, không bao giờ dùng kho CA mặc định của
máy (§17.2) — một listener giả trên `host:port` bị từ chối, không bao giờ được tin ngầm. **Khoá riêng
không bao giờ rời máy:** mã hoá DPAPI(LocalMachine) + khoá ACL trên đĩa, nạp bằng `PersistKeySet` (bắt
buộc để bắt tay schannel client-auth thật — đã kiểm chứng thực nghiệm). **Không bí mật nào trong file
Site-link:** `site-link.json` chỉ có host/port/enabled + PEM tin cậy CÔNG KHAI của Site; PEM này chỉ ghi
qua API (không bao giờ trả lại qua GET) và không bao giờ log nguyên văn (chỉ độ dài + fingerprint trong
audit). **CHỈ GỬI RA, MẶC ĐỊNH TẮT:** bridge chỉ quay số ra ngoài, không bao giờ nhận kết nối hay lệnh từ
Site; chưa bật Site link thì thiết bị giống hệt bản build trước khi có tính năng này. Broker UNS cục bộ
luôn chỉ loopback bất kể liên kết — liên kết hệ sinh thái không bao giờ mở nó ra LAN.)*

### 17.8 Honest deferrals / Những gì CHƯA làm

**EN** — Documented here, not silently missing:

- **Manual join only** — no mDNS auto-discovery, no join wizard; today's flow is the copy/paste in
  §17.6.
- **Self-signed identity + pinned trust only** — no EST/SCEP enrollment, no Site CA, no automated
  cross-signing; a device's identity and a Site's trust are both provisioned by hand.
- **No certificate rotation** — the device identity is minted once (§17.1) and never auto-renewed or
  re-issued.
- **Outbound telemetry only** — no inbound command path (NCMD or otherwise); the Site can observe this
  device but never actuate it.
- **No pre-save connectivity probe** (`POST /v1/site/test`) — see §17.4.
- **WS-B B2 (bridge inversion)** — a separate, larger piece of work (flipping the UNS spine into the
  sole source of truth) — assessed and deliberately deferred to its own GĐ3 pass (§12).
- The new `/site` nav item means the existing visual-regression baselines need a CI
  `--update-snapshots` pass — not yet done as of this doc update (same outstanding item §16.5 already
  flagged for `/assets`).

*(VI: Ghi rõ ở đây, không giấu: **Chỉ gia nhập thủ công** — chưa có mDNS tự dò, chưa có join wizard.
**Chỉ danh tính tự ký + tin cậy ghim tay** — chưa có EST/SCEP, chưa có Site CA, chưa ký chéo tự động.
**Chưa xoay vòng chứng chỉ** — danh tính thiết bị tạo một lần, không tự gia hạn/cấp lại. **Chỉ gửi
telemetry ra ngoài** — chưa có đường lệnh vào (NCMD hay khác), Site quan sát được nhưng không điều
khiển được máy. **Chưa có probe kết nối trước khi lưu** (`POST /v1/site/test`). **WS-B B2 (đảo chiều
bridge)** — một hạng mục lớn riêng, đã đánh giá và CHỦ ĐỘNG hoãn sang một đợt GĐ3 riêng (§12). Mục điều
hướng `/site` mới cần chạy lại baseline visual-regression CI (`--update-snapshots`) — chưa làm tại thời
điểm cập nhật tài liệu này (giống hạng mục còn treo mà §16.5 đã nêu cho `/assets`).)*
