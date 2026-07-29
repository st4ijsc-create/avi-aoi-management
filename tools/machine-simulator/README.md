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

> ### ⚠ Safety notice — read this before connecting a real machine / Cảnh báo an toàn — đọc trước khi kết nối máy thật
>
> **EN** — The control this product calls **HALT** on the HMI panel (fleet-level `FleetHost.Estop()`
> / `POST /v1/fleet/estop`) and **Abort** on the Line Control page is a **supervisory software latch**,
> not a safety device. Pressing it cancels this software's own read pipeline and disconnects from the
> configured device(s) — nothing more. It cannot stop a machine, because **this product has no write
> path to any device anywhere in this codebase**: `IDeviceDriver` has exactly one data-producing
> member (`ReadAsync`); there is no `WriteAsync`/`SendCommand`/`Actuate` on any driver contract, no
> Modbus `Write*` call, no OPC-UA `WriteAsync`/`CallAsync`, and Sparkplug NCMD is never received
> anywhere. A real emergency stop is a hardwired, safety-rated circuit per **ISO 13849** (Cat 3/4) —
> software is never permitted to be the safety path, and this product does not attempt to be one. Do
> not rely on any control in this product as a safety function, and do not connect a real machine's
> actual emergency-stop circuit to anything this software does.
>
> **VI** — Điều khiển mà sản phẩm này gọi là **NGỪNG** trên bảng HMI (mức fleet, `FleetHost.Estop()` /
> `POST /v1/fleet/estop`) và **Hủy** trên trang Line Control là một **chốt phần mềm giám sát**, không
> phải thiết bị an toàn. Nhấn nút này chỉ hủy pipeline đọc dữ liệu của phần mềm này và ngắt kết nối tới
> thiết bị đã cấu hình — không hơn không kém. Nó không thể dừng máy thật, vì **sản phẩm này không có
> đường ghi lệnh tới bất kỳ thiết bị nào trong toàn bộ mã nguồn**: `IDeviceDriver` chỉ có đúng một
> thành viên tạo dữ liệu (`ReadAsync`); không hợp đồng driver nào có `WriteAsync`/`SendCommand`/
> `Actuate`, không có lệnh Modbus `Write*`, không có OPC-UA `WriteAsync`/`CallAsync`, và Sparkplug
> NCMD không bao giờ được nhận ở bất kỳ đâu. Một hệ thống dừng khẩn cấp thật là mạch cứng đạt chuẩn an
> toàn theo **ISO 13849** (Cat 3/4) — phần mềm không bao giờ được phép là đường an toàn, và sản phẩm
> này không cố trở thành như vậy. Đừng dựa vào bất kỳ điều khiển nào trong sản phẩm này như một chức
> năng an toàn, và đừng đấu mạch dừng khẩn cấp thật của máy vào bất cứ thứ gì phần mềm này làm.

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
# Run until Ctrl-C. Product mode (no ST4I_DEMO_ENABLED — the default, real-deployment behavior): the
# roster starts EMPTY, never fabricated. Demo mode (ST4I_DEMO_ENABLED=true): its own small in-code
# default fleet (8 machines), unchanged.
dotnet run --project src/St4i.EdgeService

# Load a fleet.json-shaped file describing YOUR real machine(s), and stop automatically after 20
# committed readings — good for CI smoke tests. See the ⚠️ below before pointing this at this repo's
# own root fleet.json in anything but a demo/CI context.
dotnet run --project src/St4i.EdgeService -- --fleet fleet.json --smoke 20
```

- `--fleet <path>` — load the roster from a `fleet.json`-shaped file via `FleetConfig.Load`. A file that
  parses successfully (with entries, or validly empty — an operator's explicit empty declaration) is
  honored **as-is, in either mode**: `--fleet` is the *only* roster input `EdgeService` has (unlike the
  WPF app/EngineApi, which also accept `connectors.json`/env vars for a real machine), so a valid file's
  content is never demo-gated. A **blank/missing/malformed** path falls back to the built-in 8-machine
  default **only in demo mode** (`ST4I_DEMO_ENABLED=true`, or implicitly under a bare `--smoke N` with
  the env var unset — see below); in **product mode** (the default) that same situation yields an
  **empty roster** instead — never a fabricated one, and it starts/stops cleanly with no crash.
  ⚠️ **The worked example above points at this repo's own root-level `fleet.json`, which ships 11
  fabricated demo machines** (`"driverKind": "simulated"` throughout — see §10). That's fine for a demo/
  CI run, but pointing a real product/Live deployment at it honors those 11 fabricated machines as real
  configuration and pipes their fake readings to whatever real server `ST4I_SERVER_URL` names — `--fleet`
  content is an explicit operator choice, not something this task's fabrication guard sandboxes. For a
  real deployment, point `--fleet` at a file describing your own actual machine(s), not this repo's demo
  fixture.
- `--smoke <N>` — stop the host itself after exactly N `EdgePipeline.Committed` events, exit 0.
  **Not universally exit 0**: if the roster ends up empty (product mode with no usable `--fleet`), N can
  never be reached, so `EdgeService` exits fast with a non-zero code instead of hanging forever or
  reporting a false pass. A bare `--smoke N` with `ST4I_DEMO_ENABLED` unset still defaults to demo mode
  (so this worked example keeps behaving exactly as before, no script changes needed) — the non-zero
  case only arises when an operator explicitly forces product mode with no machine configured. No
  `--smoke` means it runs until externally cancelled, the normal Windows-Service shape — including an
  empty product-mode roster, which now stops the host cleanly on its own rather than hanging.

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
Policy layer + the XC-R40 `/v1/safety` supervisory halt-status endpoint (§16.2), per-pipeline fault
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

**Update (Giai đoạn 3, sub-4 — Alarms (ISA-18.2) + Line control (PackML)):** an ISA-18.2 alarm engine
(Policy DENY / DriverHealth / NG-rate sources, an SQLite active-set + history store, a periodic
background evaluator) and a supervisory PackML/ISA-88 line-control state machine layered over
`FleetHost` (Start/Hold/Unhold/Stop/Abort/Reset, an alarm→hold interlock, a retained UNS `_line/state`
topic) have both since landed — see **§18** for the full detail (env vars, endpoints, alarm
sources/priorities, PackML states+commands+FleetHost mapping, and the alarm→hold gate's honest
boundary).

**Genuinely still future, not touched by this build:** **EST/SCEP enrollment + a Site CA** — today the
device identity is a bare self-signed certificate, and trust (in both mDNS directions now — browsing,
§17.4, and the machine's own advertising, §17.8) is still a single operator-pasted, manually pinned PEM,
not a CA-issued/auto-renewed chain, with no automatic trust-on-first-discovery (§17.11); **an inbound
command path (NCMD or otherwise)** — the bridge is outbound-telemetry-only, so a Site can observe this
device but never actuate it; and **WS-B B2 (bridge inversion)** — flipping the UNS spine from an
additive mirror into the sole source of truth with ST4I/historian driven asynchronously off it instead
of synchronously inside `EdgePipeline` — assessed and **deliberately deferred to a dedicated GĐ3 pass**
(high blast-radius: ~34 files touch the synchronous ack today; see
`docs/plans/2026-07-27-ws-b-b2-bridge-inversion-assessment.md`).

**Update (GĐ3 closeout WI-1 Part B / WI-4):** the two items this line used to list as future — **the
machine announcing itself over mDNS** and **certificate rotation** — have both since landed.
`SiteAdvertiser` now multicasts this device's own presence (`_st4i-machine._tcp`, on by default whenever
the local UNS spine is enabled) so a Site's join wizard can find it without an operator hand-typing a
host/port — see **§17.8**. `POST /v1/site/identity/rotate` mints a fresh self-signed identity on demand
and re-keys the live bridge and mDNS advertisement in the same call — **operator-triggered only; there
is still no automatic pre-expiry renewal** — see **§17.10** for the required two-step follow-up at the
Site.

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

**Cập nhật (Giai đoạn 3, sub-4 — Cảnh báo ISA-18.2 + Điều khiển line PackML):** một cỗ máy cảnh báo
ISA-18.2 (nguồn Policy DENY / DriverHealth / NG-rate, kho SQLite tập-đang-hoạt-động + lịch sử, một bộ
đánh giá nền định kỳ) và một máy trạng thái PackML/ISA-88 giám sát nằm trên `FleetHost`
(Start/Hold/Unhold/Stop/Abort/Reset, khoá liên động cảnh báo→hold, một topic UNS `_line/state` giữ lại)
đều đã giao — xem **§18** để biết chi tiết đầy đủ (biến môi trường, endpoint, nguồn/mức ưu tiên cảnh
báo, trạng thái+lệnh PackML+ánh xạ FleetHost, và ranh giới thật của khoá cảnh báo→hold).

Vẫn CHƯA làm: **EST/SCEP + Site CA** để tự động cấp/xoay chứng chỉ (hiện danh tính thiết bị chỉ là chứng
chỉ tự ký, và tin cậy — ở CẢ HAI chiều mDNS, vừa duyệt tìm §17.4 vừa tự quảng bá §17.8 — vẫn chỉ là một
PEM operator dán tay, ghim thủ công, không phải chuỗi CA cấp/tự gia hạn, và vẫn chưa có
trust-on-first-discovery tự động, §17.11); **đường lệnh vào (NCMD hay khác)** — bridge CHỈ GỬI telemetry
RA, Site quan sát được máy này nhưng không điều khiển được; và **WS-B B2 (đảo chiều bridge)** — đã đánh
giá và CHỦ ĐỘNG hoãn sang một đợt GĐ3 riêng (phạm vi ảnh hưởng lớn — khoảng 34 file đang dùng ack đồng
bộ).

**Cập nhật (GĐ3 closeout WI-1 Part B / WI-4):** hai mục mà dòng này từng liệt kê là tương lai — **máy tự
quảng bá qua mDNS** và **xoay vòng chứng chỉ** — nay ĐÃ GIAO. `SiteAdvertiser` nay multicast sự hiện diện
của chính thiết bị (`_st4i-machine._tcp`, MẶC ĐỊNH BẬT bất cứ khi nào UNS spine cục bộ đang bật) để join
wizard của Site tìm ra máy này mà operator không cần gõ tay host/port — xem **§17.8**. `POST
/v1/site/identity/rotate` tạo một danh tính tự ký mới theo yêu cầu và re-key bridge đang sống cùng quảng
bá mDNS trong CÙNG một lần gọi — **chỉ theo yêu cầu operator; vẫn CHƯA có tự động gia hạn trước khi hết
hạn** — xem **§17.10** để biết bước theo sau bắt buộc tại Site.)*

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
| Flag | *(absent)* | `ST4I_DEMO_ENABLED=true`, read once at engine startup by `St4i.EdgeCore.Config.DemoModeGate` (moved here from `St4i.EngineApi` by SM-1b so `St4i.EdgeService` — §9 — shares the exact same gate) |
| Engine boots into | **Live** — `TransportMode.Live`, connected to nothing until configured | **Demo** — the fabricated, offline 11-machine fleet, exactly like every build before WS2-T1 |
| First launch shows | The full Dashboard/Machines UI immediately, roster empty until a real machine is added (§20.2) — **not** a blocking form. A small, collapsed-by-default **"Ecosystem"** status widget (`EcosystemStatusWidget`, SM-3 — §20.4) shows **Standalone** (calm/neutral, never a warning) until a server is configured; expand it for the same server-URL field + retry + "Register / claim this machine" link `Settings` already exposes. Auto-expands only when a configured server stops answering (**Failed**, red). | The full dashboard/machine grid immediately — nothing to configure, no widget shown at all (Demo's fabricated fleet has nothing to connect to) |
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
install has no ecosystem configured yet) — as of SM-3 (§20.4) that is a **complete, working product
state**, not a blocking form: Dashboard and Machines render in full immediately, roster empty until a
real machine is added via `/connectors` (§20.2), with only a small collapsed **"Standalone"** status
widget in the corner, never a full-page gate. Opening that widget exposes the same server URL field
`Settings` → *Server connection* already exposes, wired here directly rather than a second config
surface; saving/retrying walks the badge through testing → connected (or it stays **Failed**, which
auto-expands the widget on its own), then the "Register / claim this machine" link goes into
Onboarding. `GET /v1/settings/probe` is polled in the background the whole time — the badge updates
live, with no reload needed and nothing else on the screen ever blocked waiting for it.

*(VI: WS2 biến app này thành sản phẩm bán cho khách — cùng một bản build `publish-desktop/`, chỉ khác
CÁCH chạy. Bản triển lãm: copy `packaging/run-exhibition.bat` cạnh `St4i.DesktopShell.exe`, bấm file
đó thay vì bấm thẳng .exe — set cờ `ST4I_DEMO_ENABLED=true` rồi mới chạy shell, cờ này truyền xuống
tiến trình engine con. Bản sản phẩm (mặc định): không cờ, không file phụ — bấm thẳng .exe, máy vào
Live, Dashboard/Machines hiện đầy đủ ngay lập tức (danh sách máy rỗng cho tới khi thêm máy thật qua
`/connectors`, §20.2) — chỉ có một widget nhỏ, thu gọn sẵn, tên **"Standalone"**, KHÔNG PHẢI màn chặn
toàn trang như trước SM-3 (§20.4).)*

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
| **Operator** (least-privileged) | View everything (fleet/machine/product/recipe/config/machine-settings/scenario/historian/OEE), start/stop/halt the fleet, manage their own session (logout / me / change-password). No configuration writes. |
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

### 14.7 Lock-out recovery — `--reset-admin-password`

**EN** — GĐ3 closeout WI-5 added a genuine offline, out-of-band CLI recovery verb. `St4i.EngineApi`'s
`Program.cs` does take command-line arguments today — it already did before this verb existed
(`ServiceInstallVerbs`' `--install`/`--uninstall`/`--status`, §15.1):

```
St4i.EngineApi.exe --reset-admin-password <username> [--password <newPassword>]
```

- **Omitting `--password`** generates a strong random password (24 characters drawn from a ~74-symbol
  alphabet via `RandomNumberGenerator`, ~149 bits of entropy) and prints it to stdout **exactly once** —
  never logged or stored anywhere else.
- **An explicit `--password` with no usable value** — missing entirely, blank, or a value that itself
  looks like another flag (e.g. `--password --force`) — is a **usage error** (exit code `1`); it never
  silently falls back to generating one instead. An explicit password under **8 characters** — the same
  floor `AuthEndpoints`/`UserEndpoints` already enforce for every in-app password set — is rejected the
  same way. Neither failure mode touches `security.db` at all.
- **Behavior:** if `<username>` already exists, its password is reset, it is promoted to **Admin** if it
  wasn't already, and it is **re-enabled** if it was disabled — a locked-out operator's last remaining
  account could plausibly be non-Admin, disabled, or both, and a "recovery" that left any of those
  blocking login wouldn't actually recover anything. If `<username>` doesn't exist, a brand-new **Admin**
  account is created — there were no prior sessions to invalidate. For an **existing** account, every
  other outstanding session cookie for it is invalidated (the security stamp is bumped) on its very next
  use; the audit row's own `sessionsInvalidated` field records exactly this distinction (`false` for a
  newly-created account, `true` otherwise).
- **Audited:** every run appends exactly one row to the SAME hash-chained `audit_log` (§14.3) the running
  host writes to — actor `console-recovery`, action `console.reset_admin_password` — so a completed
  recovery is never invisible, even though it happened outside any authenticated session.
- **Honors `ST4I_SECURITY_DIR`** — opens the exact same `security.db`, at the exact same resolved
  directory, applying the exact same ACL lock-down (below) the running host would.
- Handled strictly before `WebApplication.CreateBuilder`, exactly like `--install`/`--uninstall`/
  `--status` (§15.1) — a recovery invocation never spins up Kestrel, DataProtection, the UNS broker, or
  the mDNS advertiser (§17.8).

> **The threat model, stated plainly, not softened.** `--reset-admin-password` intentionally bypasses
> this product's own authentication. **Anyone who can execute this exe on this machine can take over the
> application** — mint a brand-new Admin account, or reset/promote an existing one, with no login and no
> existing session required. That is the deliberate, intended design of an out-of-band recovery tool, not
> an oversight: every in-app password-change path requires an already-authenticated Admin, and losing
> every Admin account would otherwise be unrecoverable. The real security boundary here is **not** the
> application's cookie/RBAC layer — it is the **OS-level ACL on `%ProgramData%\ST4I\sim\security`**
> (`SecurityDirAcl`, §15.1) plus ordinary Windows login rights to this machine.
>
> Be precise about what that ACL actually grants: **FullControl to `NT AUTHORITY\SYSTEM`,
> `BUILTIN\Administrators`, and the security directory's current owner** — nobody else, not even
> `Authenticated Users`. On an interactive install (`St4i.DesktopShell` spawning the engine under the
> logged-on user), that owner is normally an **ordinary, non-elevated** user account — so on that install
> shape this verb needs **no elevation at all** to succeed, by design, not by accident. The OS only
> actually blocks a non-elevated attempt on the OTHER install shape — a `LocalSystem`-owned Windows
> Service (§15.1) — where an interactive, non-elevated console typically lacks write access to a
> directory SYSTEM owns. Do **not** assume the OS "generally" stops a non-elevated run here; whether it
> does depends entirely on which of the two install shapes is on this machine.
>
> **Elevation is deliberately not required.** A hard UAC gate on top of the ACL above would break the
> common interactive/desktop shape (where the security directory's owner already IS the ordinary
> logged-on user — elevation would buy nothing but friction) and would fail unhelpfully on a fresh dev
> box. The ACL is the real gate; a failure to write `security.db` (most likely permission-denied, from
> running non-elevated against a service-owned directory) still surfaces as a clear, actionable message —
> never a raw stack trace.

**Operational recommendation, unchanged:** still bootstrap/keep **at least 2** enabled Admin accounts on
any real deployment — the server-enforced, race-proof "last enabled Admin" guard
(`UserEndpoints.IsLastEnabledAdmin`) exists specifically so the in-app `/users` recovery path (any Admin
resets/re-enables another) never locks itself out. `--reset-admin-password` is the fallback for when
that guard was somehow defeated anyway (e.g. every Admin account's password is genuinely forgotten) — it
is not a replacement for keeping a second Admin.

*(VI: WI-5 GĐ3 closeout đã thêm một lệnh khôi phục CLI ngoại tuyến THẬT SỰ.
`St4i.EngineApi.exe --reset-admin-password <username> [--password <mật khẩu mới>]` — `Program.cs` của
`St4i.EngineApi` CÓ nhận tham số dòng lệnh (đã có từ trước lệnh này, qua `--install`/`--uninstall`/
`--status` của `ServiceInstallVerbs`, §15.1).

**Bỏ trống `--password`** thì tự sinh một mật khẩu mạnh (24 ký tự từ bảng ~74 ký tự, ~149 bit entropy,
qua `RandomNumberGenerator`) và IN RA màn hình đúng MỘT LẦN — không log hay lưu ở đâu khác.
**`--password` có mặt nhưng giá trị không dùng được** (thiếu, rỗng, hoặc trông giống một cờ khác, ví dụ
`--password --force`) là LỖI CÚ PHÁP (exit code `1`) — KHÔNG bao giờ tự động quay về sinh mật khẩu thay
thế. Mật khẩu tường minh dưới **8 ký tự** — đúng ngưỡng tối thiểu `AuthEndpoints`/`UserEndpoints` đã áp
dụng cho mọi lần đặt mật khẩu trong ứng dụng — cũng bị từ chối như vậy; cả hai lỗi trên đều KHÔNG đụng gì
tới `security.db`. **Hành vi:** nếu `<username>` đã tồn tại — reset mật khẩu, thăng lên **Admin** nếu
chưa phải, **bật lại** nếu đang bị vô hiệu hoá (một tài khoản Admin cuối cùng bị khoá có thể vừa không
phải Admin vừa bị vô hiệu hoá, và một lần "khôi phục" bỏ sót một trong hai thì chưa thực sự khôi phục
được gì); nếu `<username>` chưa tồn tại — tạo mới thành tài khoản **Admin** — tài khoản mới thì không có
phiên cũ nào để vô hiệu hoá. Với tài khoản ĐÃ TỒN TẠI, mọi phiên đăng nhập cũ của nó đều bị vô hiệu hoá
(bump security stamp) ngay lần dùng tiếp theo; dòng audit tự ghi đúng phân biệt này qua trường
`sessionsInvalidated` (`false` cho tài khoản mới tạo, `true` cho trường hợp còn lại). **Có
audit:** mỗi lần chạy ghi đúng một dòng vào CHÍNH `audit_log` dạng chuỗi hash (§14.3) mà host đang chạy
cũng ghi vào — actor `console-recovery`, action `console.reset_admin_password`. **Tôn trọng
`ST4I_SECURITY_DIR`** — mở đúng `security.db`, đúng thư mục đã phân giải, áp đúng khoá ACL (bên dưới) mà
host thật sẽ dùng. Được xử lý TRƯỚC `WebApplication.CreateBuilder`, giống hệt `--install`/`--uninstall`/
`--status` — một lần gọi khôi phục không bao giờ khởi động Kestrel, DataProtection, UNS broker, hay mDNS
advertiser (§17.8).

**Mô hình đe doạ, nói thẳng, không giảm nhẹ.** `--reset-admin-password` CHỦ Ý bỏ qua toàn bộ lớp xác thực
của sản phẩm. **Bất kỳ ai chạy được exe này trên máy đều chiếm được ứng dụng** — tạo tài khoản Admin mới,
hoặc reset/thăng cấp tài khoản có sẵn, không cần đăng nhập, không cần phiên có sẵn. Đây là thiết kế CHỦ Ý
của một công cụ khôi phục ngoài băng, không phải sơ suất — vì mọi đường đổi mật khẩu trong ứng dụng đều
cần một Admin ĐÃ đăng nhập, và mất hết Admin thì không còn đường nào khác. Ranh giới bảo mật thật ở đây
KHÔNG PHẢI lớp cookie/RBAC của ứng dụng — mà là **ACL cấp hệ điều hành trên
`%ProgramData%\ST4I\sim\security`** (`SecurityDirAcl`, §15.1) cộng với quyền đăng nhập Windows thông
thường vào máy này.

Phải nói chính xác ACL đó cấp gì: **FullControl cho `NT AUTHORITY\SYSTEM`, `BUILTIN\Administrators`, và
chủ sở hữu hiện tại của thư mục security** — không ai khác, kể cả `Authenticated Users`. Trên bản cài
tương tác (do `St4i.DesktopShell` sinh tiến trình dưới người dùng đang đăng nhập), chủ sở hữu đó thường
là một tài khoản người dùng THƯỜNG, KHÔNG NÂNG QUYỀN — nên ở hình thức cài này, lệnh KHÔNG CẦN nâng
quyền để chạy được, đây là CHỦ Ý, không phải tình cờ. Hệ điều hành chỉ thực sự chặn một lần chạy không
nâng quyền ở hình thức cài KIA — Windows Service chạy dưới `LocalSystem` (§15.1) — nơi một console tương
tác không nâng quyền thường không có quyền ghi vào thư mục do SYSTEM sở hữu. ĐỪNG giả định hệ điều hành
"nói chung" chặn được việc chạy không nâng quyền ở đây — điều đó phụ thuộc hoàn toàn vào hình thức cài
nào đang chạy trên máy.

**Cố ý KHÔNG yêu cầu nâng quyền (UAC).** Thêm một cổng UAC cứng lên trên ACL ở trên sẽ phá hình thức cài
tương tác/desktop phổ biến (nơi chủ sở hữu thư mục security ĐÃ LÀ người dùng thường đang đăng nhập — nâng
quyền chỉ thêm phiền phức) và gây lỗi khó hiểu trên một máy dev mới. ACL mới là cổng thật; một lỗi ghi
`security.db` (nhiều khả năng là permission-denied khi chạy không nâng quyền trên thư mục do service sở
hữu) vẫn hiện thông báo rõ ràng, không bao giờ là stack trace thô.

**Khuyến nghị vận hành, không đổi:** vẫn nên bootstrap/giữ ÍT NHẤT 2 tài khoản Admin đang bật trên mọi
triển khai thật — cơ chế chặn "Admin cuối cùng" (`UserEndpoints.IsLastEnabledAdmin`) tồn tại chính là để
đường khôi phục trong ứng dụng (`/users`, một Admin reset/bật lại Admin khác) không bao giờ tự khoá mình.
`--reset-admin-password` là phương án dự phòng cho khi cơ chế đó vẫn bị vượt qua (ví dụ quên hết mật khẩu
Admin) — không thay thế việc giữ một Admin thứ hai.)*

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
(§16.5, the Asset Registry's `assets.db` location), `connectors.json` (§16.7, GP-5's additive file-based
alternative to the two connectors' env vars, with `GET /v1/connectors` surfacing a configured-but-not-
started one) — and see §17.3 for the full Ecosystem Connect table:
`ST4I_IDENTITY_DIR`/`ST4I_SITELINK_DIR`/`ST4I_SITE_SERVICE_TYPE` (device identity + Site link + Site
discovery), plus GĐ3 closeout WI-1/WI-2/WI-3's new `ST4I_MDNS_ADVERTISE`/`ST4I_MDNS_SERVICE_TYPE`
(§17.8, mDNS advertise — **new outbound network behavior, on by default whenever UNS is enabled**) and
`ST4I_BRIDGE_SPOOL_ENABLED`/`_DIR`/`_MAX_BYTES`/`_MAX_AGE_HOURS` (§17.9, the durable bridge spool), and
§18.2 for `ST4I_IDENTITY_EXPIRY_WARN_DAYS` (§17.10, the `Identity` alarm).)*

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

**(d) The `--install` pre-check's SCM query path is manually verified only (GĐ3 closeout WI-6).**
`ServiceInstallVerbs.Install()` (§15.1) now checks whether `St4iEngineApi` is already registered with
the SCM before ever calling `sc.exe create` — but exercising that check against a REAL already-registered
service (needing either the MSI's `ServiceFeature` installed, or a manually `sc create`d service, on a
real Windows box with the SCM reachable) has only been done manually. Only the pure decision logic
downstream of the query (`BuildAlreadyRegisteredOutcome` — the exit code, the message naming the MSI's
`ServiceFeature`) is unit-tested; the SCM query itself is not, by design (this repo's test suites don't
install real Windows services).

**(e) The WPF telemetry regression guard lives in `--selftest`, not any CI gate (GĐ3 closeout WI-6).**
`MachineViewModel`'s non-numeric-telemetry handling (the same `TelemetryNumeric.TryGet` guard used
elsewhere in this codebase, replacing an unguarded `IConvertible.ToDouble` that used to throw on a value
like `"RUNNING"`) is covered by a check inside the WPF app's own `--selftest` harness (§11) — a real,
automatically-run-on-demand regression check that fails loudly if the bug is reintroduced. But
`--selftest` itself is a separate, manual/documented smoke run (there is no xUnit test project for the
WPF app) — it is **not wired into `dotnet test` or any CI gate**.

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
trong là 3.53.3, qua ngưỡng vá 3.50.2), KHÔNG dùng `<NoWarn>` để ẩn cảnh báo. (d) Bước kiểm tra trước của
`--install` (GĐ3 closeout WI-6, §15.1) — CHỈ xác minh THỦ CÔNG qua đường truy vấn SCM thật (cần service đã
đăng ký thật trên máy Windows thật); chỉ logic quyết định thuần (`BuildAlreadyRegisteredOutcome`) có unit
test, bản thân truy vấn SCM thì KHÔNG (bộ test của repo này không cài service Windows thật). (e) Bộ chắn
hồi quy telemetry của WPF (GĐ3 closeout WI-6, `MachineViewModel` dùng lại `TelemetryNumeric.TryGet` thay
vì `IConvertible.ToDouble` không chắn, vốn từng crash trên giá trị như `"RUNNING"`) nằm trong harness
`--selftest` (§11) — chạy thật, tự động khi được gọi, báo lỗi rõ nếu bug tái xuất hiện — nhưng
`--selftest` là một lượt smoke thủ công/có tài liệu riêng, KHÔNG nằm trong `dotnet test` hay bất kỳ cổng
CI nào.)*

---

## 16. Middleware backbone (Giai đoạn 2) — UNS spine, Policy/safety, fault isolation, Modbus, Asset Registry / Middleware nền tảng (Giai đoạn 2)

**EN** — Giai đoạn 2 (pass 1 + pass 2, "SYNAPSE connect") adds five features that turn this exhibition
simulator into real edge middleware: a local Unified Namespace spine, a default-deny Policy layer with
a supervisory halt-status endpoint (SM-4: renamed from "E-STOP safety endpoint" — see §1's safety
notice; this endpoint reports a software latch, never a safety function), per-pipeline fault isolation,
a first real field-protocol driver (Modbus TCP), and a persistent Asset Registry. Everything below is
**additive** — the existing ST4I HTTP ingest path, `EdgePipeline.Committed`, and every pre-existing
endpoint/behavior are unchanged unless explicitly called out.

*(VI: Giai đoạn 2 (pass 1+2, "SYNAPSE connect") thêm 5 tính năng biến trình mô phỏng triển lãm này
thành middleware edge thật: một xương sống Unified Namespace (UNS) cục bộ, lớp Policy mặc định-từ-chối
kèm endpoint trạng thái ngừng giám sát (SM-4: đổi tên từ "endpoint an toàn E-STOP" — xem cảnh báo an
toàn ở §1; endpoint này báo cáo một chốt phần mềm, không bao giờ là chức năng an toàn), cách ly lỗi
theo từng pipeline, driver giao thức trường đầu tiên (Modbus TCP), và một Asset Registry bền vững. Tất
cả đều là THÊM VÀO — đường ingest HTTP ST4I hiện có, `EdgePipeline.Committed`, và mọi endpoint/hành vi
trước đó không đổi trừ khi nói rõ.)*

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
operator-visible behavior change: **`POST /v1/fleet/start` while the halt latch is engaged now
returns `409 Conflict` with reason `SAFETY_BLOCKED`** (plus an audited `fleet.start.denied` row) —
before this, the same call silently no-op'd with a `200`.

Policy reason code → HTTP status mapping: `SAFETY_BLOCKED` / `NOT_READY` / `BUSY` → `409`;
`POLICY_DENIED` → `403`; `INVALID_ARGS` / `UNSUPPORTED` → `400`. Every denial (not just safety ones) is
audited.

New read-only endpoint:

| Path | Verb | Role | Behavior |
|---|---|---|---|
| `/v1/safety` | GET | Operator | Returns `{ estopEngaged, isRunning, safetyClass: "SupervisorySoftwareLatch", advisory }` |

**The XC-R40 boundary** — read this before treating the halt latch as more than it is (SM-4: see §1's
safety notice for the full statement): it is a **SUPERVISORY software latch**, not a substitute for a
machine's independent, safety-rated emergency-stop circuit (a hardwired circuit per ISO 13849), and
must never be relied on as a protective safety function — **this product has no write path to any
device at all**; `/v1/safety` itself carries this advisory string verbatim in its response
(`SafetyEndpoints.XcR40Advisory`). `GET /v1/safety` is **read-only by design** — there is deliberately
no write route here. The only two ways to change the underlying latch remain the pre-existing operator
actions: `POST /v1/fleet/estop` (engage) and `POST /v1/fleet/estop/reset` (clear) — both still
Operator-role, both still audited, both still always reachable even while the latch is engaged (the
policy rule never blocks stop/estop/estop-reset/reads). The operator-facing label for these actions is
**HALT**/**NGỪNG** (HMI panel) and **Abort**/**Hủy** (Line Control) — not "E-STOP"; the identifiers
(`FleetHost.Estop()`, the `/v1/fleet/estop` route, `EstopGuardRule`) are kept unchanged for API/code
stability, but no operator-facing surface calls this an emergency stop.

*(VI: `St4i.EngineApi.Policy` thêm một lớp policy mặc định-từ-chối, đánh giá BÊN TRONG cổng RBAC hiện
có cho mọi lệnh tác động lên fleet — bất kỳ Deny nào cũng THẮNG mọi Permit. Thay đổi hành vi người vận
hành thấy được: `POST /v1/fleet/start` khi chốt ngừng đang cài giờ trả về `409` lý do `SAFETY_BLOCKED`
(kèm dòng audit `fleet.start.denied`) thay vì im lặng no-op trả 200 như trước. Endpoint mới
`GET /v1/safety` (vai trò Operator, CHỈ ĐỌC) trả trạng thái chốt ngừng giám sát + cảnh báo XC-R40.
**Ranh giới XC-R40**: chốt này là điều khiển phần mềm GIÁM SÁT, KHÔNG thay thế mạch dừng khẩn cấp an
toàn độc lập của máy (mạch cứng theo ISO 13849) — không bao giờ được coi là chức năng an toàn bảo vệ,
và **sản phẩm này không có đường ghi lệnh tới bất kỳ thiết bị nào**. Tên gọi mà người vận hành nhìn
thấy là **NGỪNG** (bảng HMI) và **Hủy** (Line Control) — không phải "E-STOP"; các định danh trong mã
nguồn (`FleetHost.Estop()`, route `/v1/fleet/estop`, `EstopGuardRule`) vẫn giữ nguyên để ổn định API,
nhưng không có bề mặt nào hướng tới người vận hành còn gọi đây là dừng khẩn cấp. Chỉ có 2 cách ghi vào chốt: `POST /v1/fleet/estop`
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
  "readTimeoutMs": 3000,
  "retries": 2,
  "registers": [
    { "address": 100, "type": "Holding", "dataType": "UInt16", "scale": 0.1, "metric": "temperature", "unit": "°C" },
    { "address": 101, "type": "Input", "dataType": "Int16", "scale": 1.0, "metric": "pressure", "unit": "kPa" }
  ]
}
```

- `machineCode` — required, non-blank; becomes this Modbus machine's roster/asset code.
- `unitId` — the Modbus slave address on the wire (not related to `machineCode`); defaults to `1`.
- `pollIntervalMs` — poll cadence; defaults to `1000`.
- `readTimeoutMs` *(optional, Task 9)* — overrides `Transport.ReadTimeout`/`WriteTimeout` (ms) instead of
  deriving them from `pollIntervalMs` — see the "configurable timeout" note below. Rejected (falls back to
  the derived default, with a logged warning — never fails the whole map load) if it isn't a positive
  whole number, or exceeds the 60 000 ms (`ModbusRegisterMap.MaxReadTimeoutMs`) upper guard. Omitted/JSON
  `null` silently keeps the derived default.
- `retries` *(optional, Task 9)* — overrides `Transport.Retries`. Same rejection rule as `readTimeoutMs`,
  guarded at 5 (`ModbusRegisterMap.MaxRetries`).
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
  `readTimeoutMs`/`retries` are the ONE deliberate exception to that "malformed input throws" rule — see
  above.

**Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — declarative
write/command capability, no driver executes any of it yet (that's B-4).** Two OPTIONAL additions, both
absent from every register-map ever accepted before this task and both a no-op for a map that never sets
them (a map with neither is a read-only connector exactly as before):

- A `Holding` register may add `"writable": { "min": <number>, "max": <number> }` — declares that register
  as a writable setpoint named by its own `metric`, with **mandatory** physical bounds (engineering units,
  the same domain `scale` already reads in): a writable register missing either bound, an `"Input"` register
  declared writable, a zero/non-finite `scale`, or a declared range that overflows the register's own
  `dataType` once inverse-scaled (÷`scale`, rounded) is **rejected at parse time**, naming the offending
  point — never silently treated as unbounded.
- A top-level `"commands": [ { "name": "...", "coilAddress": <ushort>, "arguments": [ { "name": "...",
  "type": "UInt16" | "Int16" | "Int32" | "UInt32" | "Bool" | "Double", "min"?: <number>, "max"?: <number> }
  ] } ]` declares a named coil-pulse command (mirroring a real vendor's "start cycle" button) and its
  argument types — every argument value a future driver receives is narrowed against the declared type
  (an OPC-UA-style boxed integer is re-narrowed to the exact declared width) before it could ever reach a
  device.

Neither declaration performs any I/O by itself — `ModbusRegisterMap`/`ModbusTcpDriver` still only ever
**read** — this is the map format B-4's future write driver will consume.

When Modbus is enabled and its map loads successfully, the Modbus machine is wired in as a
**first-class roster member** — it gets a fleet snapshot tile, a historian row per poll, and (via
Asset Registry auto-upsert, §16.5) an asset row, not just an invisible telemetry stream — and its
readings are mirrored onto the UNS spine (§16.1) exactly like every other machine's.

**Reliability fix (GP-6b) — a real bug the connector conformance suite (§19.5) found, user-visible:**
against a device that accepts the TCP handshake but then goes silent at the protocol level (a stateful
firewall timing out an idle polled flow, a PLC whose Modbus task hung while its TCP stack stayed up, a
device reset behind a switch that holds link) `ModbusTcpDriver` used to pin a thread-pool thread
**forever** — the underlying NModbus read call has no cancellation overload and both
`Transport.ReadTimeout`/`WriteTimeout` default to **infinite** (`-1`). `Health` stayed frozen at
whatever it last reported (`Connected`, for a device that HAD been talking), so `AlarmEvaluator` never
raised a Degraded/Down alarm — **an operator saw a green connector that had silently stopped producing
data, indefinitely, with no alarm ever firing.** Fixed by bounding both timeouts to
`Math.Max(1000ms, pollIntervalMs × 4)` **by default** and dropping NModbus's own retry count to 1 by
default (this driver already reconnects from scratch on any failure, so NModbus-level retries only
multiplied the stall); an in-flight read is now also promptly **cancellable** (`ct.Register` disposes the
live connection, unblocking a pending read in ~2ms instead of waiting out the timeout). A connector that
hits this now reports `Degraded`/`Down` like any other fault, instead of staying silently green.

**Plant-rollout follow-up (Task 9) — the derived-only timeout was itself a hazard for one real
deployment shape.** A site whose Modbus TCP endpoint is actually a **TCP→RTU gateway** can legitimately
take several seconds to answer ONE register when the RTU slave drops a frame (the gateway's own internal
retry budget) — and the derived formula COUPLES that tolerance to `pollIntervalMs`, the wrong direction:
the only way to buy more tolerance was to poll slower, and any site polling at `pollIntervalMs ≤ 250`
(exactly the fast, gateway-fronted sites most likely to need it) got a flat, un-liftable 1000ms floor.
Worse, exceeding the bound isn't "one slow poll" — the catch sets `Health = Degraded` **and tears down the
TCP connection**, so a device chronically just over the bound produces continuous connect/close churn
that can exhaust a gateway's small fixed TCP-slot pool. `readTimeoutMs`/`retries` (see the register-map
shape above) let a site set the bound **directly** instead of gaming `pollIntervalMs` — unset, the
behaviour is byte-identical to before these fields existed. **Sizing note:** the effective tolerance for a
healthy-but-slow device is **one `readTimeoutMs`, not `retries` of them** — a retry is a fresh request
under the exact same per-attempt bound, so a device that consistently answers just over it fails every
attempt identically; size the value for the slowest legitimate single round-trip, not a multiple of it.

**Honest deferrals** (documented in the driver's own source, not silently missing): 32-bit/float
register values (combining a register PAIR) and register-block batching (today: one read per
register, per poll) are follow-ups, not built; **Modbus RTU (serial)** is not implemented — TCP only;
there is no per-machine `MappingProfile` override for Modbus yet (it uses one shared `Automation`-class
fallback profile for every Modbus machine today).

*(VI: `St4i.EdgeCore.Drivers.Modbus` là driver giao thức trường thật đầu tiên — vòng lặp poll TCP định
kỳ (NModbus) đọc danh sách thanh ghi cố định từ một Modbus TCP slave, chạy trong pipeline slot cách ly
lỗi riêng (§16.3). **MẶC ĐỊNH TẮT** — ngược cực với UNS spine. 4 biến môi trường `ST4I_MODBUS_*` (bảng
trên). Định dạng JSON register-map: `machineCode`, `unitId` (mặc định 1), `pollIntervalMs` (mặc định
1000), `readTimeoutMs`/`retries` *(tuỳ chọn, Task 9 — xem đoạn "follow-up rollout" bên dưới; sai định dạng
thì rơi về mặc định suy ra + log cảnh báo, KHÔNG làm hỏng cả map, giới hạn trên lần lượt 60 000ms/5)*,
`registers[]` gồm `address`/`type` (Holding FC03 hoặc Input FC04, chỉ ĐỌC dù loại nào)/`dataType`
(UInt16 hoặc Int16, giải mã XONG mới nhân `scale`)/`scale`/`metric`/`unit`. `machineCode` rỗng hoặc
`registers` rỗng bị từ chối lúc nạp — Program.cs bắt lỗi này, log cảnh báo, tắt Modbus cho lần chạy đó
thay vì crash. Khi bật và map nạp thành công, máy Modbus trở thành thành viên fleet CHÍNH THỨC (có tile,
historian, asset) chứ không chỉ là luồng telemetry vô hình; dữ liệu cũng được phản chiếu lên UNS spine.

**Fix độ tin cậy (GP-6b) — lỗi thật do bộ conformance connector (§19.5) tìm ra, ảnh hưởng trực tiếp
người vận hành:** trước một thiết bị vẫn bắt tay TCP nhưng im lặng ở tầng giao thức (firewall stateful
hết giờ một luồng poll rảnh, PLC treo tác vụ Modbus trong khi tầng TCP vẫn sống, thiết bị reset sau một
switch vẫn giữ link), `ModbusTcpDriver` trước đây ghim CHẾT một luồng thread-pool MÃI MÃI — lệnh đọc
NModbus không có overload huỷ, và `Transport.ReadTimeout`/`WriteTimeout` mặc định là **vô hạn** (`-1`).
`Health` đứng yên ở giá trị báo cáo gần nhất (`Connected`, với thiết bị TỪNG nói chuyện), nên
`AlarmEvaluator` KHÔNG BAO GIỜ báo cảnh báo Degraded/Down — **operator nhìn thấy connector XANH nhưng đã
âm thầm ngừng sinh dữ liệu, vô thời hạn, không một cảnh báo nào.** Đã sửa bằng cách chặn cả hai timeout ở
`Math.Max(1000ms, pollIntervalMs × 4)` **theo mặc định** và hạ số lần thử lại của NModbus xuống 1 theo mặc
định (driver đã tự kết nối lại từ đầu khi lỗi, nên retry cấp NModbus chỉ nhân đôi thời gian treo); một
lệnh đọc đang treo giờ cũng HUỶ ĐƯỢC ngay (`ct.Register` đóng kết nối sống, giải phóng lệnh đọc đang treo
trong ~2ms thay vì chờ hết timeout). Một connector gặp lỗi này giờ báo `Degraded`/`Down` như mọi lỗi khác,
thay vì đứng yên màu xanh trong im lặng.

**Follow-up rollout thực tế (Task 9) — công thức suy-ra-duy-nhất tự nó là một rủi ro cho một dạng triển
khai thật.** Một site mà đầu Modbus TCP thực ra là **gateway TCP→RTU** có thể hợp lý mất vài giây để trả
lời MỘT thanh ghi khi slave RTU rớt khung (do ngân sách tự retry nội bộ của gateway) — mà công thức suy ra
lại KHOÁ độ chịu lỗi đó vào `pollIntervalMs`, sai chiều: cách duy nhất để có thêm độ chịu lỗi là poll chậm
lại, và bất kỳ site nào poll ở `pollIntervalMs ≤ 250` (đúng nhóm site nhanh, sau gateway, cần nó nhất) bị
ghim ở sàn 1000ms không thể nới. Tệ hơn, vượt ngưỡng không phải là "một lần poll chậm" — catch đặt
`Health = Degraded` **VÀ phá kết nối TCP**, nên một thiết bị liên tục hơi vượt ngưỡng tạo ra vòng lặp
connect/close liên tục có thể làm cạn pool TCP-slot cố định nhỏ của gateway. `readTimeoutMs`/`retries`
(xem định dạng register-map ở trên) cho phép site đặt ngưỡng TRỰC TIẾP thay vì phải "lách" qua
`pollIntervalMs` — không đặt thì hành vi giữ nguyên y hệt trước khi hai trường này tồn tại. **Lưu ý khi
chỉnh:** độ chịu lỗi thực tế cho một thiết bị khoẻ-nhưng-chậm là **MỘT `readTimeoutMs`, không phải
`retries` lần** — một lần retry là một yêu cầu MỚI dưới đúng ngưỡng mỗi-lần-thử đó, nên một thiết bị luôn
trả lời hơi trễ hơn ngưỡng sẽ trượt MỌI lần thử như nhau; hãy đặt giá trị theo round-trip đơn hợp lý chậm
nhất, không phải bội số của nó.

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

**Task B-3 — declarative write/command capability** (same posture as the Modbus section above — no driver
executes any of this yet; `OpcUaDriver` still only ever **reads**): a node may add `"writable": {
"valueType": "UInt16" | "Int16" | "Int32" | "UInt32" | "Double", "min": <number>, "max": <number> }` —
`valueType` must be numeric (a boolean/string writable node is a documented, deferred follow-up),
`min`/`max` are **mandatory** and must fit within `valueType`'s own representable range, and are validated
at parse time exactly like Modbus's `writable` above. A top-level `"commands": [ { "name": "...",
"objectNodeId": "...", "methodNodeId": "...", "arguments": [ ... same shape as Modbus's command arguments
... ] } ]` declares an OPC-UA method by BOTH the NodeId of the object it is called on and the method's own
NodeId (the `Call` service needs both), so a future driver never has to re-derive which object owns a
method.

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

**Reliability fix (GP-6b) — the other bug the connector conformance suite (§19.5) found:**
`OpcUaDriver` used to reconnect via the synchronous `CoreClientUtils.SelectEndpoint` call, which blocks
for exactly this driver's own `TransportQuotas.OperationTimeout` (**hardcoded 15 seconds**, not
configurable via any env var/setting) **regardless of cancellation** — five times `FleetHost`'s own
3-second teardown budget, and completely uninterruptible while in flight (`DisposeAsync` cannot unstick
it either, since the session field is still unset at that point). Fixed by switching to
`CoreClientUtils.SelectEndpointAsync` — confirmed present in the installed 1.5.378.156 package by
reflection — passing the SAME 15s value through as a `ct`-cancellable bound instead of an
unconditional block: a healthy-but-slow endpoint negotiation is unaffected, but the call can now be
interrupted. **Honest correction, not swept under the rug:** the fix still needs a `#pragma warning
disable CS0618` — this specific `SelectEndpointAsync` overload, and every `Session.Create` overload in
this package version, are themselves marked `[Obsolete]` in favor of an `ITelemetryContext`-based API
this codebase does not thread through anywhere; migrating to it is a materially larger client-API
change than this defect's scope, confirmed by reflection against the installed assembly before deciding
to keep the suppression rather than re-attempt the swap.

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
historian, asset) chứ không chỉ là luồng telemetry vô hình.

**Fix độ tin cậy (GP-6b) — lỗi thứ hai bộ conformance connector (§19.5) tìm ra:** `OpcUaDriver` trước
đây kết nối lại qua lệnh ĐỒNG BỘ `CoreClientUtils.SelectEndpoint`, chặn đúng bằng
`TransportQuotas.OperationTimeout` của chính driver này (**cố định 15 giây, KHÔNG cấu hình được** qua
biến môi trường/cài đặt nào) **bất kể có huỷ hay không** — gấp 5 lần ngân sách teardown 3 giây của
`FleetHost`, và hoàn toàn không huỷ được khi đang chạy (`DisposeAsync` cũng không gỡ được vì trường
session lúc đó vẫn chưa gán). Đã sửa bằng cách chuyển sang `CoreClientUtils.SelectEndpointAsync` — xác
nhận CÓ THẬT trong gói 1.5.378.156 đã cài (kiểm chứng bằng reflection) — truyền CÙNG giá trị 15 giây đó
nhưng giờ chặn theo `ct` huỷ được, thay vì chặn vô điều kiện: một endpoint khoẻ mạnh nhưng chậm vẫn không
bị ảnh hưởng, nhưng lệnh giờ huỷ được. **Đính chính trung thực, không giấu:** bản sửa vẫn cần
`#pragma warning disable CS0618` — chính overload `SelectEndpointAsync` này, và MỌI overload
`Session.Create` trong phiên bản gói này, đều bị đánh dấu `[Obsolete]` để nhường chỗ cho một API dùng
`ITelemetryContext` mà codebase này chưa nối dây ở đâu cả; chuyển sang đó là một thay đổi API client lớn
hơn hẳn phạm vi lỗi này — đã xác nhận bằng reflection trên chính assembly đã cài trước khi quyết định
giữ suppression thay vì thử chuyển lại.

**Những gì CHƯA làm:** OPC-UA subscription
(hiện chỉ poll — một lệnh `Read` theo lô mỗi chu kỳ), giải mã kiểu phức hợp/cấu trúc (giá trị lạ rơi về
`ToString()`), chế độ bảo mật Sign/SignAndEncrypt, driver Siemens S7/EtherNet-IP.)*

### 16.7 `connectors.json` — file-based connector config / Cấu hình connector qua file (GP-5)

**EN** — `connectors.json` (repo root of this tool, same shipping convention as `fleet.json` — a loose
file next to the built/published exe, hand-editable post-publish) is an **additive** config source
alongside the `ST4I_MODBUS_*`/`ST4I_OPCUA_*` env vars above: a JSON array of `{ id, kind, settings }`
entries. **Absent (or an empty array, which is what ships by default) ⇒ byte-identical to before this
file existed** — an existing install driven purely by env vars is unaffected.

```json
[
  { "id": "line1-modbus", "kind": "Modbus", "settings": { "machineCode": "PLC-01", "unitId": 1,
      "pollIntervalMs": 500, "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16",
      "scale": 1.0, "metric": "temperature", "unit": "C" } ] } }
]
```

- `id` — a label for this entry (used in log messages naming a malformed/conflicting/skipped entry);
  defaults to `kind` if omitted.
- `kind` — which connector kind to build. **Today this build only knows how to construct the two
  built-in kinds, `Modbus`/`OpcUa`** (matched case-insensitively, same rule as `driverKind` everywhere
  else in this codebase) — there is no dynamic third-party plugin-loading mechanism yet (a documented,
  non-blocking follow-up: the eventual out-of-process sidecar isolation model). A `kind` this build
  can't construct is skipped with a named warning, not silently ignored.
- `settings` — **inline JSON**, not a path to a second file: for `Modbus`/`OpcUa` it is exactly the same
  shape as the `ST4I_MODBUS_MAP`/`ST4I_OPCUA_MAP` register-/node-map file's own contents (§16.4/§16.6),
  embedded directly instead of referenced by path — forwarded to the connector factory byte-for-byte,
  never re-interpreted by this loader. An operator who prefers a separate map file can keep using the
  env-var route unchanged; this is an additional way to configure the same two kinds, not a replacement.
  (Host/port for Modbus, and the PKI directory for OPC-UA, still come from their existing env vars —
  `connectors.json` only replaces the "enabled + map" half of that story.)
- **One malformed entry never discards the whole file** (the same lesson already applied to `fleet.json`):
  a `connectors.json` entry missing a non-blank `kind` or a `settings` value is skipped with a warning
  naming it (by `id`, or its 1-based position); every other valid entry still loads. Only genuinely
  unparseable JSON (bad syntax, or a non-array root) falls back to "no connectors.json entries" wholesale.
- **Precedence when both an env var and a `connectors.json` entry configure the same kind: the env var
  always wins**, and the conflicting `connectors.json` entry is skipped with a logged warning naming the
  conflict — this is what keeps "an existing install with only the four env vars set behaves
  byte-identically" true even after that install later gains an unrelated `connectors.json`. Two
  `connectors.json` entries for the same kind are similarly de-duplicated (first one in the file wins,
  the rest are skipped with a warning), since the registry itself only ever holds one factory per kind.

**`GET /v1/connectors`** (Operator role) surfaces every currently-configured connector whose most recent
start attempt failed — an operator-visible answer to "my connector just isn't there," instead of only a
log line. Deliberately **never flips `GET /v1/health` unhealthy** — a bad/misconfigured optional
connector is informational, not a fault, the same judgment call this codebase already makes for a
malformed Modbus/OPC-UA map. **Web UI (GP-7):** this same list is now rendered on `/assets` — see
§19.4's own web-visibility write-up and §19.7 for exactly what `id`/`kind`/the registry do and do not
mean today.

*(VI: `connectors.json` (gốc thư mục công cụ này, cùng quy ước đóng gói như `fleet.json`) là nguồn cấu
hình BỔ SUNG bên cạnh các biến môi trường `ST4I_MODBUS_*`/`ST4I_OPCUA_*` — một mảng JSON gồm các mục
`{ id, kind, settings }`. **Không có file (hoặc mảng rỗng, giá trị mặc định khi đóng gói) ⇒ giống hệt
trước khi file này tồn tại.** `kind` hiện chỉ hỗ trợ hai loại có sẵn `Modbus`/`OpcUa` (chưa có cơ chế
nạp plugin bên thứ ba); `settings` là JSON NHÚNG TRỰC TIẾP (không phải đường dẫn file khác) — với
Modbus/OPC-UA đúng bằng nội dung file register-/node-map hiện có, chuyển nguyên văn cho connector, không
diễn giải lại. Một mục lỗi (thiếu `kind`/`settings`) chỉ bị bỏ qua kèm cảnh báo nêu tên, không huỷ cả
file — cùng bài học đã áp dụng cho `fleet.json`. Khi biến môi trường VÀ một mục `connectors.json` cùng
cấu hình một `kind`: **biến môi trường luôn thắng**, mục xung đột bị bỏ qua kèm cảnh báo nêu rõ xung đột.
`GET /v1/connectors` (vai trò Operator) hiển thị mọi connector đã cấu hình nhưng lần khởi động gần nhất
thất bại — KHÔNG BAO GIỜ làm `GET /v1/health` báo unhealthy. **Web UI (GP-7):** danh sách này nay hiển
thị ngay trên `/assets` — xem phần web-visibility ở §19.4 và §19.7 để biết chính xác `id`/`kind`/registry
có ý nghĩa gì (và CHƯA có ý nghĩa gì) ở thời điểm này.)*

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
- GĐ3 closeout WI-4 added on-demand **rotation** — see §17.10 for the endpoint, the two-step operator
  flow it forces, and the alarm that warns before a certificate lapses. Rotating mints an entirely new
  self-signed certificate (same ECDSA P-256, same 10-year validity, same NodeId) — it doesn't change how
  or where the identity is stored, only which bytes are currently in `device-identity.bin`.

*(VI: `DeviceIdentityStore` tạo (một lần duy nhất) và nạp một chứng chỉ X.509 tự ký **ECDSA P-256** —
danh tính bền vững của thiết bị, dùng làm chứng chỉ client cho mutual TLS khi bridge bên dưới liên kết
tới Site. Khoá riêng KHÔNG BAO GIỜ rời khỏi máy: PFX được mã hoá DPAPI (LocalMachine, cùng cách
`CredentialStore` đã dùng cho khoá `mk_`, §15.8), thư mục chứa bị khoá ACL. Thư mục mặc định
`%ProgramData%\ST4I\sim\identity`, dời chỗ qua **`ST4I_IDENTITY_DIR`**. Được tạo LẦN ĐẦU lúc khởi động
(`LoadOrCreate`) — blob hỏng/không đọc được bị coi là "chưa có danh tính" và tự tạo lại, không bao giờ
crash. `CN` chứng chỉ lấy từ đoạn Cell ISA-95 (`ST4I_UNS_CELL`, §16.1), đã làm sạch an toàn. Fingerprint
SHA-256 + chứng chỉ công khai (PEM) được lộ qua `GET /v1/site/identity` (§17.4) — đây là thứ operator
đưa cho Site để đăng ký thiết bị. WI-4 GĐ3 closeout thêm khả năng **xoay vòng (rotate) theo yêu cầu** —
xem §17.10 để biết endpoint, luồng thao tác 2 bước, và cảnh báo trước khi chứng chỉ hết hạn. Xoay vòng
tạo một chứng chỉ tự ký HOÀN TOÀN MỚI (vẫn ECDSA P-256, vẫn hiệu lực 10 năm, vẫn cùng NodeId) — không đổi
cách/nơi lưu danh tính, chỉ đổi nội dung byte trong `device-identity.bin`.)*

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
local pipeline is unaffected) · `Down` (the LOCAL client can't reach this device's own UNS spine) ·
`Faulted` (GĐ3 closeout WI-3 — the durable spool's writer and/or forward loop crashed; takes priority
over every other state above because the MQTT connections can look healthy while forwarding has
actually stopped — see §17.9 for what causes it, and for the low-friction fix: **re-applying the Site
link (`PUT /v1/site`) rebuilds the bridge and clears it — a process/service restart is not required**).

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
vẫn hoạt động độc lập. **6 trạng thái bridge** (`bridgeState` của `GET /v1/site`): `Disabled` ·
`Connecting` · `Connected` · `Degraded` (Site sập, cục bộ không ảnh hưởng) · `Down` (client cục bộ
không tới được UNS spine của chính máy này) · `Faulted` (WI-3 GĐ3 closeout — vòng lặp writer/forward
của spool bền đã chết; ưu tiên cao hơn mọi trạng thái khác vì kết nối MQTT có thể vẫn trông khoẻ trong
khi việc forward đã thực sự dừng — xem §17.9; cách sửa ít tốn công nhất: **áp lại Site link (`PUT
/v1/site`) sẽ dựng lại bridge và gỡ lỗi này — KHÔNG cần khởi động lại tiến trình/service**).)*

### 17.3 Env vars / Biến môi trường

**EN** — Both stores follow the exact same "explicit path (tests) → env var → `%ProgramData%` default"
resolution idiom used elsewhere in this doc (e.g. §15.2's `ST4I_HISTORIAN_DIR`/`ST4I_WAL_DIR`/
`ST4I_SECURITY_DIR`, §16.5's `ST4I_ASSETS_DIR`); an unset/blank env var falls back to the default
rather than erroring:

| Var | What it does | Default |
|---|---|---|
| `ST4I_IDENTITY_DIR` | Relocates the device-identity store (`device-identity.bin` + `device-node.txt`, §17.1) | `%ProgramData%\ST4I\sim\identity` |
| `ST4I_SITELINK_DIR` | Relocates the Site-link store (`site-link.json`, §17.2) | `%ProgramData%\ST4I\sim\sitelink` |
| `ST4I_SITE_SERVICE_TYPE` | The mDNS service type the "Discover Sites" browse (§17.4, `GET /v1/site/discover`) queries for — this device is the BROWSER here | `_synapse-site._tcp` |
| `ST4I_MDNS_ADVERTISE` | GĐ3 closeout WI-1 (§17.8) — `0`/`false` (case-insensitive) stops this device from advertising ITSELF over mDNS, independently of the UNS gate below | unset → advertises whenever `ST4I_UNS_ENABLED` is on |
| `ST4I_MDNS_SERVICE_TYPE` | The mDNS service type this device advertises itself under (§17.8) — deliberately different from `ST4I_SITE_SERVICE_TYPE` above | `_st4i-machine._tcp` |
| `ST4I_BRIDGE_SPOOL_ENABLED` | GĐ3 closeout WI-2/WI-3 (§17.9) — `0`/`false` disables the durable northbound spool, reverting to drop-everything-while-disconnected | `true` |
| `ST4I_BRIDGE_SPOOL_DIR` | Relocates the spool database (`bridge-spool.db`, §17.9) | `%ProgramData%\ST4I\sim\bridge-spool` |
| `ST4I_BRIDGE_SPOOL_MAX_BYTES` | Total spool size cap in bytes — a drop-oldest trim once exceeded (§17.9) | `67108864` (64 MiB) |
| `ST4I_BRIDGE_SPOOL_MAX_AGE_HOURS` | Maximum age, in hours, a spooled item is kept before being trimmed (§17.9) | `48` |

Neither the Site-link nor the discovery feature introduces a new *enable* flag of its own — the Site
bridge's on/off switch is the persisted link's own `enabled` field (set via `PUT /v1/site`, §17.4), not
an environment variable. It does, however, depend on the **pre-existing** `ST4I_UNS_*` family (§16.1):
`SiteBridgeManager` is only ever registered when `ST4I_UNS_ENABLED` is on (the default), the bridge's
local client dials `ST4I_UNS_PORT` on loopback, and the device identity's `CN`/SAN is derived from
`ST4I_UNS_CELL`. GĐ3 closeout WI-1/WI-2/WI-3 add three MORE independent knobs, each env-var-only (no UI
toggle exists for any of them): mDNS **advertise** defaults ON whenever `ST4I_UNS_ENABLED` is (§16.1 —
itself on by default), independently disable-able via `ST4I_MDNS_ADVERTISE=0`; the bridge's durable
**spool** defaults ON (`ST4I_BRIDGE_SPOOL_ENABLED`) whenever a Site link is enabled. See §17.8/§17.9 for
the full behavioral write-up of each.

*(VI: Cả hai store đều theo đúng thứ tự phân giải "đường dẫn tường minh (test) → biến môi trường →
mặc định `%ProgramData%`" đã dùng ở nơi khác trong tài liệu này (§15.2, §16.5) — biến trống/chưa đặt
thì dùng mặc định, không báo lỗi. **`ST4I_IDENTITY_DIR`** dời thư mục danh tính thiết bị (mặc định
`%ProgramData%\ST4I\sim\identity`). **`ST4I_SITELINK_DIR`** dời thư mục Site-link (mặc định
`%ProgramData%\ST4I\sim\sitelink`). **`ST4I_SITE_SERVICE_TYPE`** là loại dịch vụ mDNS mà thiết bị này
BROWSE để tìm Site (§17.4). Ba biến MỚI của WI-1/WI-2/WI-3 GĐ3 closeout: **`ST4I_MDNS_ADVERTISE`**
(`0`/`false` tắt việc tự quảng bá qua mDNS, độc lập với cổng UNS, §17.8), **`ST4I_MDNS_SERVICE_TYPE`**
(loại dịch vụ mDNS thiết bị này TỰ quảng bá, mặc định `_st4i-machine._tcp`, khác với
`ST4I_SITE_SERVICE_TYPE`, §17.8), và bốn biến **`ST4I_BRIDGE_SPOOL_*`** (`ENABLED`/`DIR`/`MAX_BYTES`/
`MAX_AGE_HOURS`, §17.9) cho spool bền của bridge. Không có cờ bật/tắt riêng cho BẢN THÂN Site link —
công tắc bật bridge chính là trường `enabled` của link (đặt qua `PUT /v1/site`). Tính năng phụ thuộc vào
các biến `ST4I_UNS_*` CÓ SẴN (§16.1): `SiteBridgeManager` chỉ đăng ký khi `ST4I_UNS_ENABLED` bật (mặc
định), client cục bộ của bridge quay số `ST4I_UNS_PORT` trên loopback, và `CN` của danh tính thiết bị lấy
từ `ST4I_UNS_CELL`. mDNS advertise MẶC ĐỊNH BẬT bất cứ khi nào `ST4I_UNS_ENABLED` bật (mà biến đó tự nó
mặc định bật) — tắt riêng qua `ST4I_MDNS_ADVERTISE=0`; spool bền của bridge MẶC ĐỊNH BẬT bất cứ khi nào
Site link đang bật.)*

### 17.4 Endpoints (EC-3) / Endpoint

**EN** — `St4i.EngineApi.Endpoints.SiteEndpoints` exposes five routes:

| Path | Verb | Role | Behavior |
|---|---|---|---|
| `/v1/site` | GET | Operator | Status + config: `{enabled, host, port, bridgeState, lastError, siteFingerprint, deviceFingerprint, unsEnabled, spoolDepth, lastAckedSeq, droppedTotal}`. With the local UNS spine disabled, returns a fixed `Disabled`/`unsEnabled:false` view that still reports the real `deviceFingerprint` (a device has an identity whether or not anything is federated); `spoolDepth`/`lastAckedSeq`/`droppedTotal` (GĐ3 closeout WI-3, §17.9) are always a real `0` — never garbage — when there is no durable spool at all. |
| `/v1/site` | PUT | Engineer, audited `site.link.set` | Body `{enabled, host, port, siteTrustPem}` — a **full replace** of the persisted link (an omitted field applies its own default, not "leave unchanged"). Drives `SiteBridgeManager.ApplyAsync` — stops the old bridge, persists, starts a fresh one if `enabled`. `400` if enabling with a missing host, an out-of-range port (must be 1–65535), or a `siteTrustPem` that doesn't parse to at least one certificate; `409` if the local UNS spine is disabled (nothing to bridge). The audit row never logs the raw PEM — only its length + a SHA-256 fingerprint of the PEM text itself. |
| `/v1/site/identity` | GET | Operator | `{deviceFingerprint, deviceCertPem, notAfterUtc, daysToExpiry}` — this device's own public identity (§17.1), plus its certificate's expiry (GĐ3 closeout WI-4, §17.10), to register at a Site and to know when it needs rotating. |
| `/v1/site/identity/rotate` | POST | **Admin**, audited `site.identity.rotate` | GĐ3 closeout WI-4 (§17.10 for the full write-up) — mints+persists a brand-new device identity and re-keys everything presenting the old one (the live Site bridge, the mDNS advertisement). Body `{currentFingerprint}` must echo what `GET /v1/site/identity` currently reports — `400` if missing/blank, `409` if it doesn't match. **Deliberately breaks the Site uplink** until the new fingerprint is pasted at the Site. |
| `/v1/site/discover` | GET | Engineer | **(GĐ3 sub-2, mDNS join wizard)** A bounded (~4s) mDNS browse of the LAN for the `ST4I_SITE_SERVICE_TYPE` service (§17.3, default `_synapse-site._tcp`) → `DiscoveredSite[] {instanceName, host, port, addresses[], txt{}}`. Read-only network scan (no audit); per-call ephemeral (opens no always-on multicast socket); never throws — an empty array means "no Sites found", not an error. Discovery only *pre-fills* the form host/port; it never sets the trust PEM or enables the link. The mirror image of this — the machine ADVERTISING itself so a Site can find it — is §17.8, not an HTTP endpoint. |

**Deferred:** a pre-save `POST /v1/site/test` connectivity probe (from the original blueprint) was not
built — the live `bridgeState` badge `GET /v1/site` already exposes (`Connecting` → `Connected`/
`Degraded` + `lastError`) is the operator's connection feedback once a link is saved, so a dedicated
pre-save probe is a follow-up, not a blocker.

*(VI: `SiteEndpoints` có 5 route: **`GET /v1/site`** (Operator) — trạng thái + cấu hình (enabled, host,
port, bridgeState, lastError, siteFingerprint, deviceFingerprint, unsEnabled, spoolDepth, lastAckedSeq,
droppedTotal); UNS tắt thì trả về view cố định `Disabled` nhưng vẫn có `deviceFingerprint` thật; ba
trường spool (§17.9) luôn là số `0` THẬT — không bao giờ là rác — khi không có spool bền nào. **`PUT
/v1/site`** (Engineer, có audit `site.link.set`) — body `{enabled, host, port, siteTrustPem}`, **THAY
THẾ TOÀN BỘ** link đã lưu (trường bỏ trống áp giá trị mặc định của nó, KHÔNG phải "giữ nguyên"); gọi
`SiteBridgeManager.ApplyAsync` — dừng bridge cũ, lưu, khởi động bridge mới nếu `enabled`. Trả `400` nếu
bật mà thiếu host/port sai khoảng (1–65535)/PEM không hợp lệ; trả `409` nếu UNS spine cục bộ đang tắt.
Dòng audit KHÔNG BAO GIỜ ghi PEM thô — chỉ độ dài + fingerprint SHA-256 của chính văn bản PEM. **`GET
/v1/site/identity`** (Operator) — `{deviceFingerprint, deviceCertPem, notAfterUtc, daysToExpiry}`, danh
tính công khai của thiết bị kèm hạn dùng chứng chỉ (WI-4, §17.10). **`POST
/v1/site/identity/rotate`** (**Admin**, có audit `site.identity.rotate`) — tạo+lưu danh tính mới, re-key
cả bridge Site đang sống lẫn quảng bá mDNS; body `{currentFingerprint}` phải khớp giá trị `GET
/v1/site/identity` đang trả — `400` nếu thiếu/rỗng, `409` nếu không khớp; CỐ Ý làm đứt kết nối Site cho
tới khi dán fingerprint mới tại Site (xem §17.10). **Việc CHƯA làm:** `POST /v1/site/test` (probe kết
nối trước khi lưu) chưa xây — badge `bridgeState` sống động của `GET /v1/site` đã là phản hồi kết nối
cho operator sau khi lưu, nên probe riêng là việc làm tiếp theo, không phải điều kiện chặn.)*

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

### 17.8 mDNS advertise — the machine announces itself (GĐ3 closeout WI-1 Part B) / Tự quảng bá qua mDNS

**EN**

> **New outbound network behavior — on by default.** Starting with this build, the machine actively
> **multicasts its own presence on the LAN** whenever the local UNS spine is enabled
> (`ST4I_UNS_ENABLED`, §16.1 — **on by default**, even standalone/offline) — every existing install
> begins doing this the moment it upgrades to this build, whether or not it has ever linked to a Site.
> This is a deliberate product decision (a SYNAPSE Site's own join wizard can find the machine without an
> operator hand-typing a host/port) — but an operator should learn about it from this paragraph, not
> from a packet capture.

`St4i.EngineApi.Site.SiteAdvertiser` is the mirror image of §17.4's `GET /v1/site/discover` (which
*browses* the LAN for a Site): this advertises the MACHINE itself.

- **Service type:** `_st4i-machine._tcp` (`ST4I_MDNS_SERVICE_TYPE` to override, §17.3) — deliberately
  DIFFERENT from `_synapse-site._tcp` (the type this device browses FOR); a Site advertises the Site
  type, a machine advertises the machine type, never the same one.
- **Instance name:** the sanitized device NodeId (§17.1) — `[A-Za-z0-9._-]` kept, everything else
  replaced with `_`, falling back to `st4i-machine` if that leaves nothing at all.
- **Port:** read from Kestrel's own actually-bound listen address at runtime — never hard-coded `5199`.
- **TXT records:** `node` (NodeId) · `fp` (this device's identity fingerprint, §17.1) · `site`/`area`/
  `line`/`cell` (the ISA-95 address, §16.1) · `v` (the assembly's informational version).
- **Disable switch:** `ST4I_MDNS_ADVERTISE=0` (or `false`) turns advertising off independently of the
  UNS gate — the rest of the engine is completely unaffected either way.
- **Never crashes the host:** a machine with no multicast-capable NIC, or a firewall silently dropping
  the traffic, simply never manages to advertise — same never-fails discipline as every other optional
  subsystem in this build.
- A rotation (§17.10) tears the advertisement down and rebuilds it from the new identity, so the `fp`
  TXT field never keeps broadcasting a stale fingerprint.

*(VI: **Hành vi mạng ra ngoài MỚI — MẶC ĐỊNH BẬT.** Từ bản build này, máy CHỦ ĐỘNG multicast sự hiện diện
của chính nó lên LAN bất cứ khi nào UNS spine cục bộ đang bật (`ST4I_UNS_ENABLED`, §16.1 — MẶC ĐỊNH BẬT,
kể cả khi chạy độc lập/ngoại tuyến) — mọi bản cài CÓ SẴN đều bắt đầu làm việc này ngay khi nâng cấp lên
bản build này, dù đã liên kết Site hay chưa. Đây là quyết định sản phẩm CÓ CHỦ Ý (join wizard của Site
tìm được máy mà operator không cần gõ tay host/port) — nhưng operator phải biết điều này từ đoạn văn
này, không phải từ việc bắt gói tin.

`SiteAdvertiser` là ảnh gương của `GET /v1/site/discover` ở §17.4 (thứ BROWSE LAN để tìm Site) — đây
QUẢNG BÁ chính MÁY này. **Loại dịch vụ:** `_st4i-machine._tcp` (ghi đè qua `ST4I_MDNS_SERVICE_TYPE`,
§17.3) — CỐ Ý khác với `_synapse-site._tcp` (loại máy này browse để tìm); Site quảng bá loại Site, máy
quảng bá loại máy, không bao giờ trùng. **Tên instance:** NodeId đã làm sạch (§17.1). **Cổng:** đọc từ
địa chỉ Kestrel THẬT SỰ đã bind lúc chạy — không hard-code `5199`. **TXT record:** `node`/`fp`/`site`/
`area`/`line`/`cell`/`v`. **Công tắc tắt:** `ST4I_MDNS_ADVERTISE=0` tắt quảng bá độc lập với cổng UNS.
**Không bao giờ làm sập host:** máy không có NIC hỗ trợ multicast, hay firewall âm thầm chặn traffic,
chỉ đơn giản là không quảng bá được — không bao giờ crash. Xoay vòng chứng chỉ (§17.10) sẽ dừng rồi dựng
lại quảng bá từ danh tính mới, nên trường TXT `fp` không bao giờ tiếp tục phát fingerprint cũ.)*

### 17.9 Durable bridge spool + reconciliation (GĐ3 closeout WI-2/WI-3) / Spool bền cho bridge + đồng bộ lại

**EN** — Before this build, `UnsBridge` dropped **everything** it dequeued while the Site was
unreachable — a Site outage meant silent, permanent data loss for the whole outage window. It now:

- **Spools to SQLite on disk** (`bridge-spool.db`, a sibling of `...\sim\sitelink`/`...\sim\alarms`)
  instead of dropping — every message that actually reaches the spool writer while the Site is
  unreachable is durably queued. That is deliberately **not** phrased as "every message the local UNS
  spine emits" — a bounded, silent gate sits upstream of the spool and can shed messages before they
  ever get there; see the honest-limitations block below for exactly when and how.
- **Survives a process restart** — the spool is a real on-disk table, not an in-memory queue; a crash or
  a service restart mid-outage does not lose whatever had already been spooled.
- **Replays in ascending sequence order** on reconnect — oldest first, never out of order.
- **Publishes a retained resync record BEFORE replaying anything** — RETAINED, to
  `syn/{site}/{area}/{line}/{cell}/_bridge/resync`, so the Site learns a gap exists — and exactly how
  big — before the backfill itself starts arriving. Fields: `resumedAtUtc`, `backlogDepth`, `oldestUtc`,
  `firstSeq`, `lastAckedSeq`, `droppedTotal`.
- `droppedTotal` is not a soft metric — it means **production data was permanently lost**: the spool's
  own age/size caps below trimmed the oldest entries before the Site ever received them. It counts
  **only** that one cause, though — it is not a total loss counter; see below for two more loss paths it
  never sees at all.

**Env vars** (`BridgeSpoolOptions.FromEnvironment` — same "unparseable/non-positive value → keep the
default" posture as every other `ST4I_*` options bag in this doc):

| Var | What it does | Default |
|---|---|---|
| `ST4I_BRIDGE_SPOOL_ENABLED` | `false`/`0` disables the durable spool entirely — reverts to the pre-this-build behavior (drop everything while disconnected, no resync record) | `true` |
| `ST4I_BRIDGE_SPOOL_DIR` | Relocates the spool database | `%ProgramData%\ST4I\sim\bridge-spool` |
| `ST4I_BRIDGE_SPOOL_MAX_BYTES` | Total spool size cap, in bytes — a drop-oldest trim once exceeded | `67108864` (64 MiB) |
| `ST4I_BRIDGE_SPOOL_MAX_AGE_HOURS` | Maximum age, in hours, a spooled item is kept before being trimmed | `48` |

**The retention trade-off, stated plainly:** these caps exist so an unattended device doesn't fill its
disk forever during a long outage — but they mean a Site outage that outlasts either cap is
**guaranteed** data loss, not a possibility: the oldest entries are dropped to make room, and
`droppedTotal` is the only record *this specific cause* of loss ever happened — it says nothing about
the other loss paths below. 48h is comfortably above the product's own ≥24h
buffering requirement, but it is still a hard ceiling, not a promise of eventual delivery.

**The `Faulted` bridge state — no automatic recovery, but a low-friction manual fix exists.** If the
spool's writer loop (drains the local channel into the spool) or its forward loop (replays + acks
against the Site) terminates from an unexpected exception — never this bridge's own shutdown —
`GET /v1/site`'s `bridgeState` reports **`Faulted`** (§17.2), which outranks
`Connected`/`Degraded`/`Connecting`: the MQTT connections can look perfectly healthy while messages have
quietly stopped being persisted or replayed — a worse, more surprising failure than a known Site outage.
**There is no *automatic/supervised* restart of these loops** — nothing watches for a faulted bridge and
rebuilds it on its own. But an operator does **not** need to restart the whole process:
`SiteBridgeManager.ApplyAsync` unconditionally tears down whatever bridge is currently running (whatever
its state) and builds a fresh one, so **re-applying the Site link — `PUT /v1/site` with the same fields
(the same action §17.6 already documents for the join flow), or the equivalent action on the `/site`
page — rebuilds the bridge and clears the fault**, no process/service restart required. A certificate
rotation (§17.10) does the same, through that identical `ApplyAsync` call. Restarting the
`St4i.EngineApi` process/service (§15.1) also clears it, but that is a heavier-handed fix than necessary,
not the only one. **Until something intervenes** (either path above), the spool keeps accepting/growing
(whichever loop is still alive) until the size/age caps above start trimming it — i.e. the exact same
real, eventual data loss described above, just reached sooner, and signalled only by the `Faulted` flag
and a log line, not by anything that pages an operator. **What to do:** treat `Faulted` as an incident,
not a transient blip — re-apply the Site link (or rotate the identity) to rebuild the bridge, then check
the logs for what actually killed the loop; a full process/service restart works too if that's more
convenient, but is not required.

**Head-of-line blocking — no dead-letter path.** If the Site permanently rejects one specific message
(e.g. a topic-ACL denial that will never succeed no matter how many times it's retried), that ONE
message blocks the entire backlog behind it — the forward loop retries it with escalating backoff
(500ms, doubling, capped at 30s) forever, and nothing behind it in sequence order can be delivered until
it either eventually succeeds or ages out of the spool. This is **not a regression** from before this
build (the old behavior dropped the message outright, immediately, with nothing behind it blocked) —
but it is the remaining route from "the Site rejects one message" to real, eventual data loss, and there
is no dead-letter queue or skip-and-continue path today.

**Three more ways northbound data goes missing, invisibly, that this section would be dishonest to
omit:**

1. **A bounded, silent gate sits in front of the spool.** `OnLocalMessageReceivedAsync` hands every
   locally-received message to a 10,000-item `Channel.CreateBounded` (`UnsBridge.cs`) configured
   `BoundedChannelFullMode.DropOldest` — this sits UPSTREAM of everything described above, spool
   included. If that channel is ever full (a slow spool writer, a burst of traffic, a long Site outage
   with the writer loop still alive but behind), it silently drops the OLDEST buffered item to make room
   for the newest — with **no counter anywhere**: `droppedTotal` never sees these drops, because the
   message never reached `EnqueueAsync` in the first place. The saturation-warning log line this path is
   supposed to emit (`Site bridge forward queue saturated…`) is, in addition, **unreachable**: it only
   fires when `Channel.Writer.TryWrite` returns `false`, and a `DropOldest` channel's `TryWrite` is
   documented to always return `true` (it makes room by evicting, it never rejects) — so that warning
   can never actually print.
2. **The spool writer got materially slower exactly when this feature needs it to be fast.** Because
   `IBridgeSpool` has no batch-insert method, `RunSpoolWriterLoopAsync` pays one full
   open-connection + four `PRAGMA`s + `INSERT` + `last_insert_rowid()` round trip **per message** — a
   real throughput cost the code's own comment acknowledges — and it lands squarely during a Site
   outage (the exact window this feature exists for), which makes the upstream channel in point 1
   measurably easier to saturate than it would have been pre-this-build.
3. **A spool write can itself fail — full disk, a locked file, a vanished directory — and that failure is
   invisible everywhere an operator would look.** `BridgeSpool.EnqueueAsync` returns `-1` on any such
   failure (never throws, by design) and the message is simply not persisted. That `-1` does **not**
   increment `droppedTotal`, does **not** change `spoolDepth`, and does **not** flip `bridgeState` to
   `Faulted`. `GET /v1/site` and the `/site` page can report `Connected · Depth 0 · Dropped 0` while
   100% of northbound telemetry is being silently discarded.
4. **The only signal for any of the above is a log line — and on the documented Windows Service install
   shape, that log line has nowhere to go.** The composition root wires this bridge's
   `logWarning`/`logError` straight to `Console.Error.WriteLine`; a process running as a Windows Service
   has no attached console, and `Console.Error` routes to `Stream.Null` in that case. So despite what
   this section says elsewhere, `Faulted` plus a log line is **not** a reliable signal on a service
   install — there may be no signal at all.

*(VI: Trước bản build này, `UnsBridge` bỏ TOÀN BỘ những gì lấy ra khỏi hàng đợi trong lúc không tới được
Site — Site sập nghĩa là mất dữ liệu vĩnh viễn, âm thầm, suốt thời gian sập. Nay: **Spool ra SQLite trên
đĩa** (`bridge-spool.db`) thay vì bỏ — mọi message THỰC SỰ TỚI ĐƯỢC vòng lặp writer của spool lúc Site
không tới được đều được xếp hàng bền. CỐ Ý không nói "mọi message UNS spine cục bộ phát ra" — có một
cổng giới hạn, âm thầm, nằm TRƯỚC spool, có thể bỏ message trước khi chúng kịp tới đó; xem khối "những gì
CHƯA làm" bên dưới để biết chính xác khi nào và bằng cách nào. **Sống sót qua khởi động lại tiến trình** — spool là bảng thật trên đĩa, không phải
hàng đợi trong bộ nhớ. **Phát lại theo đúng thứ tự seq tăng dần** khi kết nối lại — cũ nhất trước. **Phát
một bản ghi đồng bộ lại (resync) RETAINED TRƯỚC KHI phát lại bất cứ gì** — lên
`syn/{site}/{area}/{line}/{cell}/_bridge/resync`, để Site biết có khoảng trống — và trống bao nhiêu —
TRƯỚC KHI dữ liệu bù (backfill) bắt đầu tới. Trường dữ liệu: `resumedAtUtc`, `backlogDepth`, `oldestUtc`,
`firstSeq`, `lastAckedSeq`, `droppedTotal`. `droppedTotal` KHÔNG phải chỉ số nhẹ nhàng — nó nghĩa là DỮ
LIỆU SẢN XUẤT ĐÃ MẤT VĨNH VIỄN: trần tuổi/dung lượng của spool (bên dưới) đã cắt bớt các mục cũ nhất
trước khi Site kịp nhận. Nó CHỈ đếm một nguyên nhân DUY NHẤT này thôi — không phải bộ đếm mất dữ liệu
tổng; xem bên dưới để biết thêm hai đường mất dữ liệu khác mà nó không bao giờ thấy.

**Biến môi trường:** **`ST4I_BRIDGE_SPOOL_ENABLED`** (`false`/`0` tắt hẳn spool bền, quay lại hành vi
trước bản build này — bỏ hết lúc mất kết nối, không có resync — mặc định `true`); **`ST4I_BRIDGE_SPOOL_DIR`**
(dời CSDL spool, mặc định `%ProgramData%\ST4I\sim\bridge-spool`); **`ST4I_BRIDGE_SPOOL_MAX_BYTES`** (trần
dung lượng spool tính byte, mặc định `67108864` = 64 MiB); **`ST4I_BRIDGE_SPOOL_MAX_AGE_HOURS`** (tuổi
tối đa tính giờ trước khi bị cắt, mặc định `48`).

**Đánh đổi lưu trữ, nói thẳng:** các trần này tồn tại để một thiết bị không người trông không lấp đầy đĩa
mãi mãi trong một đợt sập dài — nhưng nghĩa là một đợt Site sập lâu hơn một trong hai trần là mất dữ liệu
CHẮC CHẮN, không phải khả năng: các mục cũ nhất bị bỏ để lấy chỗ, và `droppedTotal` là bằng chứng DUY
NHẤT rằng CHÍNH NGUYÊN NHÂN NÀY đã xảy ra — nó không nói gì về các đường mất dữ liệu khác bên dưới. 48
giờ cao hơn thoải mái so với yêu cầu đệm ≥24 giờ của sản phẩm, nhưng vẫn
là một trần cứng, không phải lời hứa giao hàng cuối cùng.

**Trạng thái bridge `Faulted` — không tự động hồi phục, nhưng có cách sửa tay ít tốn công.** Nếu vòng lặp
writer của spool (dồn kênh cục bộ vào spool) hoặc vòng lặp forward (phát lại + ack với Site) chết vì một
exception bất ngờ — không phải do chính bridge tự tắt — thì `bridgeState` của `GET /v1/site` báo
**`Faulted`** (§17.2), được ưu tiên hơn `Connected`/`Degraded`/`Connecting`: kết nối MQTT có thể vẫn
trông khoẻ trong khi message đã âm thầm ngừng được lưu hoặc phát lại — một lỗi tệ hơn, bất ngờ hơn một
đợt Site sập bình thường. **KHÔNG có cơ chế TỰ ĐỘNG/được giám sát để khởi động lại các vòng lặp này** —
không có gì theo dõi một bridge bị Faulted rồi tự dựng lại. Nhưng operator KHÔNG cần khởi động lại cả
tiến trình: `SiteBridgeManager.ApplyAsync` LUÔN dừng bridge đang chạy (bất kể trạng thái gì) rồi dựng
bridge mới, nên **áp lại Site link — gọi `PUT /v1/site` với đúng các trường hiện có (đúng thao tác §17.6
đã ghi cho luồng gia nhập), hoặc thao tác tương đương trên trang `/site` — sẽ dựng lại bridge và gỡ lỗi
này, KHÔNG cần khởi động lại tiến trình/service**. Xoay vòng chứng chỉ (§17.10) cũng làm y vậy, qua cùng
lệnh `ApplyAsync`. Khởi động lại tiến trình/service `St4i.EngineApi` (§15.1) cũng gỡ được lỗi, nhưng đó
là cách nặng tay hơn mức cần thiết, không phải cách DUY NHẤT. **Cho tới khi có ai đó can thiệp** (một
trong hai cách trên), spool vẫn tiếp tục nhận/phình to (nếu vòng lặp còn lại vẫn sống) cho tới khi trần
dung lượng/tuổi ở trên bắt đầu cắt bớt — tức là ĐÚNG loại mất dữ liệu thật, cuối cùng, y như mô tả ở
trên, chỉ là đến sớm hơn, và chỉ được báo hiệu bằng cờ `Faulted` cùng một dòng log, không có gì báo động
cho operator. **Phải làm gì:** coi `Faulted` là một sự cố thật, không phải trục trặc thoáng qua — áp lại
Site link (hoặc xoay vòng danh tính) để dựng lại bridge, rồi kiểm tra log xem cái gì thực sự giết vòng
lặp; khởi động lại tiến trình/service cũng được nếu tiện hơn, nhưng không bắt buộc.

**Chặn đầu hàng đợi (head-of-line blocking) — không có đường dead-letter.** Nếu Site từ chối VĨNH VIỄN
một message cụ thể (ví dụ bị chặn ACL theo topic, không bao giờ thành công dù thử lại bao nhiêu lần), MỘT
message đó chặn đứng toàn bộ phần còn lại phía sau nó — vòng lặp forward thử lại với backoff tăng dần
(500ms, nhân đôi, trần 30s) MÃI MÃI, và không gì phía sau theo thứ tự seq được gửi cho tới khi nó hoặc
cuối cùng thành công, hoặc bị cắt khỏi spool do quá tuổi. Đây KHÔNG phải một thoái lui so với trước bản
build này (hành vi cũ bỏ message đó ngay lập tức, không chặn gì phía sau) — nhưng đây vẫn là con đường
còn lại từ "Site từ chối một message" tới mất dữ liệu thật, cuối cùng, và hiện chưa có hàng đợi
dead-letter hay đường bỏ-qua-và-tiếp-tục nào.

**Ba đường mất dữ liệu khác, âm thầm, mà phần này sẽ là không trung thực nếu bỏ qua:**

1. **Có một cổng giới hạn, âm thầm, nằm TRƯỚC spool.** `OnLocalMessageReceivedAsync` đưa mọi message
   nhận được cục bộ vào một `Channel.CreateBounded` 10.000 phần tử (`UnsBridge.cs`) cấu hình
   `BoundedChannelFullMode.DropOldest` — kênh này nằm TRƯỚC mọi thứ mô tả ở trên, kể cả spool. Nếu kênh
   này đầy (writer chậm, traffic dồn cục, hoặc một đợt Site sập dài trong khi vòng lặp writer vẫn sống
   nhưng chạy chậm hơn), nó âm thầm bỏ phần tử CŨ NHẤT để lấy chỗ cho phần tử mới — **không có bộ đếm
   nào ghi lại việc này**: `droppedTotal` không bao giờ thấy các lượt bỏ này, vì message chưa bao giờ
   tới được `EnqueueAsync`. Dòng log cảnh báo bão hoà lẽ ra phải phát ra ở đường này (`Site bridge
   forward queue saturated…`) thêm nữa còn là **code không thể chạm tới**: nó chỉ chạy khi
   `Channel.Writer.TryWrite` trả về `false`, mà `TryWrite` của một kênh `DropOldest` theo tài liệu LUÔN
   trả về `true` (nó nhường chỗ bằng cách đuổi phần tử cũ, không bao giờ từ chối) — nên cảnh báo đó
   không bao giờ thực sự in ra được.
2. **Vòng lặp writer của spool trở nên chậm hơn rõ rệt đúng vào lúc tính năng này cần nó nhanh.** Vì
   `IBridgeSpool` không có phương thức insert theo lô, `RunSpoolWriterLoopAsync` phải trả giá một vòng
   mở-kết-nối + bốn `PRAGMA` + `INSERT` + `last_insert_rowid()` đầy đủ **cho MỖI message** — một chi phí
   thông lượng thật mà chính comment của code thừa nhận — và chi phí này rơi đúng vào lúc Site đang sập
   (đúng khoảng thời gian tính năng này tồn tại để phục vụ), khiến kênh giới hạn ở mục 1 dễ bị đầy hơn
   hẳn so với trước bản build này.
3. **Bản thân một lượt ghi spool có thể thất bại — hết đĩa, file bị khoá, thư mục biến mất — và lỗi đó vô
   hình ở mọi nơi operator có thể nhìn vào.** `BridgeSpool.EnqueueAsync` trả về `-1` khi gặp bất kỳ lỗi
   nào như vậy (không bao giờ throw, có chủ ý) và message đơn giản là không được lưu. `-1` đó **không**
   làm tăng `droppedTotal`, **không** đổi `spoolDepth`, và **không** chuyển `bridgeState` sang `Faulted`.
   `GET /v1/site` và trang `/site` có thể báo `Connected · Depth 0 · Dropped 0` trong khi 100% telemetry
   hướng bắc đang âm thầm bị mất.
4. **Tín hiệu duy nhất cho tất cả những điều trên chỉ là một dòng log — và trên hình thái cài đặt Windows
   Service đã được tài liệu hoá, dòng log đó không có nơi nào để đi.** Nơi khởi tạo hệ thống nối thẳng
   `logWarning`/`logError` của bridge này vào `Console.Error.WriteLine`; một tiến trình chạy dưới dạng
   Windows Service không có console gắn kèm, và `Console.Error` được định tuyến sang `Stream.Null` trong
   trường hợp đó. Vậy nên, trái với những gì phần này nói ở nơi khác, `Faulted` cộng với một dòng log
   **không phải** là một tín hiệu đáng tin cậy trên một bản cài dạng service — có thể sẽ KHÔNG có tín
   hiệu nào cả.)*

### 17.10 Certificate rotation, expiry visibility, and the `Identity` alarm (GĐ3 closeout WI-4) / Xoay vòng chứng chỉ, hiển thị hạn dùng, và cảnh báo `Identity`

**EN**

- `GET /v1/site/identity` (§17.4) now also returns `notAfterUtc` and `daysToExpiry` — an operator (or a
  script) can see how much runway is left on this device's identity without decoding the certificate
  PEM by hand.
- `POST /v1/site/identity/rotate` (§17.4) mints and persists a brand-new self-signed identity (same
  ECDSA P-256, same NodeId, same 10-year validity — §17.1) — **Admin-only**, audited
  (`site.identity.rotate`, recording both the OLD and NEW fingerprint, never the private key or the raw
  PEM), and requires the request body to echo the device's CURRENT fingerprint
  (`{"currentFingerprint": "..."}`) — `400` if it's missing/blank, `409` if it doesn't match what
  `GET /v1/site/identity` currently reports (someone else may have already rotated it, or the caller is
  working from a stale read). This forces whoever calls it to have actually read the current fingerprint
  first, rather than a bare `POST` re-keying the device with no confirmation of what's being replaced.
- Rotating also **re-keys everything already presenting the old identity**, in the same call: the live
  Site bridge is torn down and rebuilt from the new certificate (`SiteBridgeManager.ReapplyCurrentAsync`),
  and the mDNS advertisement (§17.8) is restarted so its `fp` TXT field stops broadcasting the stale
  fingerprint.

> **The two-step operator flow — read this before rotating a device that's linked to a Site.** Rotating
> **breaks the Site uplink**. The Site's own trust store pins THIS device's *old* fingerprint (§17.2/
> §17.7 — that pin is exactly why federation is fail-closed); the moment the identity rotates, the Site
> rejects the new certificate and the bridge's mTLS handshake keeps failing until an operator manually
> pastes the NEW fingerprint into that Site's own trust configuration. That is not a bug to route around
> — it's why the rotate response returns the new fingerprint as the first field of its body, and why the
> audit row records both fingerprints: there is always a paper trail of exactly what changed and what an
> operator must now go do at the Site. **Only rotate when you're ready to immediately update the Site to
> match.**

**The `Identity` alarm source.** The same periodic evaluator that runs DriverHealth/NgRate (§18.2) now
also watches this device's own certificate expiry:

- Source `AlarmSource.Identity`, threshold **`ST4I_IDENTITY_EXPIRY_WARN_DAYS`** (default **30**) —
  raises once `daysToExpiry` falls to or below that many days (an already-expired certificate, i.e. a
  negative day count, still raises — it is never treated as "too late to warn"). Clears automatically
  once a rotation pushes the expiry back out; an operator's Ack only silences it in the meantime (a
  CONDITION alarm, same as DriverHealth/NgRate, §18.1).
- **Capped at `AlarmPriority.High` — deliberately, never `Critical`.** A `Critical` alarm feeds
  `LineController`'s alarm→hold gate (§18.7): it blocks `line.start`/`line.unhold` and shows as `Held`
  on every `GET /v1/line` poll. An expiring device certificate must never be able to stop production —
  the alarm exists to get an operator's attention well before expiry (30 days of runway by default), not
  to halt the line.

*(VI: `GET /v1/site/identity` (§17.4) nay trả thêm `notAfterUtc` và `daysToExpiry` — operator (hay một
script) xem được còn bao lâu nữa danh tính thiết bị hết hạn mà không cần tự giải mã PEM. `POST
/v1/site/identity/rotate` (§17.4) tạo+lưu một danh tính tự ký HOÀN TOÀN MỚI (vẫn ECDSA P-256, vẫn cùng
NodeId, vẫn hiệu lực 10 năm — §17.1) — CHỈ Admin, có audit (`site.identity.rotate`, ghi cả fingerprint
CŨ lẫn MỚI, không bao giờ ghi khoá riêng hay PEM thô), và bắt body phải khớp lại fingerprint HIỆN TẠI của
thiết bị (`{"currentFingerprint": "..."}`) — `400` nếu thiếu/rỗng, `409` nếu không khớp với `GET
/v1/site/identity` đang trả (có thể ai đó đã xoay vòng trước, hoặc caller đang dùng dữ liệu cũ). Việc này
buộc bên gọi phải THỰC SỰ đọc fingerprint hiện tại trước, thay vì một `POST` trần trụi re-key thiết bị mà
không xác nhận đang thay thế cái gì. Xoay vòng cũng **re-key mọi thứ đang trình diện danh tính cũ** trong
CÙNG một lần gọi: bridge Site đang sống bị dừng rồi dựng lại từ chứng chỉ mới
(`SiteBridgeManager.ReapplyCurrentAsync`), và quảng bá mDNS (§17.8) được khởi động lại để trường TXT `fp`
không tiếp tục phát fingerprint cũ.

**Luồng thao tác 2 bước — đọc trước khi xoay vòng một thiết bị đang liên kết Site.** Xoay vòng LÀM ĐỨT
kết nối lên Site. Kho tin cậy của Site ghim fingerprint CŨ của chính thiết bị này (§17.2/§17.7 — chính
cái ghim đó là lý do liên kết thất-bại-thì-đóng); ngay khi danh tính xoay vòng, Site từ chối chứng chỉ
mới và bắt tay mTLS của bridge cứ lỗi cho tới khi operator dán TAY fingerprint MỚI vào cấu hình tin cậy
của Site đó. Đây không phải lỗi cần né tránh — đó là lý do phản hồi của rotate trả fingerprint mới làm
TRƯỜNG ĐẦU TIÊN, và dòng audit ghi cả hai fingerprint: luôn có một dấu vết giấy tờ chính xác những gì đã
đổi và operator giờ phải làm gì tại Site. **Chỉ xoay vòng khi đã sẵn sàng cập nhật Site ngay sau đó.**

**Nguồn cảnh báo `Identity`.** Cùng bộ đánh giá định kỳ chạy DriverHealth/NgRate (§18.2) nay cũng theo
dõi hạn dùng chứng chỉ của chính thiết bị: nguồn `AlarmSource.Identity`, ngưỡng
**`ST4I_IDENTITY_EXPIRY_WARN_DAYS`** (mặc định **30**) — cảnh báo khi `daysToExpiry` còn bằng hoặc dưới
số ngày đó (chứng chỉ ĐÃ hết hạn, tức số ngày âm, vẫn cảnh báo — không bao giờ coi là "quá muộn để cảnh
báo"). Tự xoá khi một lần xoay vòng đẩy hạn dùng ra xa; Ack của operator chỉ tạm im lặng trong lúc đó
(cảnh báo ĐIỀU KIỆN, giống DriverHealth/NgRate, §18.1). **Giới hạn ở `AlarmPriority.High` — CÓ CHỦ Ý,
không bao giờ `Critical`.** Một cảnh báo Critical sẽ nạp vào khoá cảnh báo→hold của `LineController`
(§18.7): chặn `line.start`/`line.unhold` và hiện `Held` ở mọi lần đọc `GET /v1/line`. Một chứng chỉ thiết
bị sắp hết hạn không bao giờ được phép dừng sản xuất — cảnh báo này tồn tại để operator chú ý sớm (mặc
định còn 30 ngày), không phải để dừng line.)*

### 17.11 Honest deferrals / Những gì CHƯA làm

**EN** — Documented here, not silently missing:

- **mDNS auto-provision / trust-on-first-discovery is still not implemented.** Discovery
  (`GET /v1/site/discover`, §17.4) pre-fills the host/port form fields; advertising (§17.8) lets a Site
  find this machine the same way. **Neither one automates trust** — the Site's trust PEM pinned here
  (§17.2) and this device's identity registered at the Site are both still a manually pasted step
  (§17.6). There is no automatic "first discovery wins" provisioning path, by design: trusting whatever
  answers first on an unauthenticated LAN broadcast would be a real security regression, not a
  convenience.
- **Self-signed identity + pinned trust only** — no EST/SCEP enrollment, no Site CA, no automated
  cross-signing; a device's identity and a Site's trust are both provisioned by hand.
- **Certificate rotation is manual/on-demand only** (§17.10) — no automatic pre-expiry rotation, no
  scheduled job; an operator (or a future automation) must call `POST /v1/site/identity/rotate`
  themselves, and must immediately follow up at the Site (§17.10's two-step flow) or the uplink stays
  down.
- **No automatic/supervised restart of the durable bridge spool's writer/forward loops** (§17.9) —
  nothing watches for a `Faulted` bridge and rebuilds it on its own. An operator does have a
  low-friction manual fix (re-applying the Site link, or rotating the identity, both rebuild the bridge
  without a process restart) — but until someone does, the spool keeps growing until the size/age caps
  trim the oldest entries, i.e. eventual real data loss, signalled only by a status flag and a log line.
- **No dead-letter path for a permanently-rejected message** (§17.9) — head-of-line blocking behind one
  bad message is the remaining route to real data loss, even with the durable spool in place.
- **Outbound telemetry only** — no inbound command path (NCMD or otherwise); the Site can observe this
  device but never actuate it.
- **No pre-save connectivity probe** (`POST /v1/site/test`) — see §17.4.
- **WS-B B2 (bridge inversion)** — a separate, larger piece of work (flipping the UNS spine into the
  sole source of truth) — assessed and deliberately deferred to its own GĐ3 pass (§12).
- The new `/site` nav item means the existing visual-regression baselines need a CI
  `--update-snapshots` pass — not yet done as of this doc update (same outstanding item §16.5 already
  flagged for `/assets`).

*(VI: Ghi rõ ở đây, không giấu: **mDNS auto-provision/trust-on-first-discovery vẫn CHƯA làm.** Duyệt tìm
(`GET /v1/site/discover`, §17.4) điền sẵn host/port; quảng bá (§17.8) giúp Site tìm ra máy này theo chiều
ngược lại. KHÔNG CÁI NÀO tự động hoá được TIN CẬY — PEM tin cậy của Site ghim ở đây (§17.2) và danh tính
thiết bị đăng ký tại Site vẫn phải dán tay (§17.6). Chưa có đường tự động "ai lên tiếng trước thì được
tin" theo CHỦ Ý — tin ngay thứ trả lời đầu tiên trên một broadcast LAN không xác thực sẽ là một thoái lui
bảo mật thật sự, không phải tiện lợi. **Chỉ danh tính tự ký + tin cậy ghim tay** — chưa có EST/SCEP, chưa
có Site CA, chưa ký chéo tự động. **Xoay vòng chứng chỉ chỉ thủ công/theo yêu cầu** (§17.10) — chưa tự
động xoay trước khi hết hạn, chưa có job định kỳ; operator (hay một tự động hoá tương lai) phải tự gọi
`POST /v1/site/identity/rotate`, và phải cập nhật Site NGAY SAU ĐÓ (luồng 2 bước ở §17.10) nếu không kết
nối sẽ đứng im. **Chưa có cơ chế TỰ ĐỘNG/được giám sát khởi động lại vòng lặp writer/forward của spool
bền** (§17.9) — không có gì theo dõi một bridge bị `Faulted` rồi tự dựng lại. Operator có cách sửa tay ít
tốn công (áp lại Site link, hoặc xoay vòng danh tính, cả hai đều dựng lại bridge mà không cần khởi động
lại tiến trình) — nhưng cho tới khi có ai làm vậy, spool cứ phình to cho tới khi trần dung lượng/tuổi cắt
bớt các mục cũ nhất, tức là mất dữ liệu thật, cuối cùng, chỉ được báo hiệu bằng một cờ trạng thái và một
dòng log. **Chưa có đường
dead-letter cho message bị từ chối vĩnh viễn** (§17.9) — chặn đầu hàng đợi vì một message xấu vẫn là con
đường còn lại dẫn tới mất dữ liệu thật, dù đã có spool bền. **Chỉ gửi telemetry ra ngoài** — chưa có
đường lệnh vào (NCMD hay khác), Site quan sát được nhưng không điều khiển được máy. **Chưa có probe kết
nối trước khi lưu** (`POST /v1/site/test`). **WS-B B2 (đảo chiều bridge)** — một hạng mục lớn riêng, đã
đánh giá và CHỦ ĐỘNG hoãn sang một đợt GĐ3 riêng (§12). Mục điều hướng `/site` mới cần chạy lại baseline
visual-regression CI (`--update-snapshots`) — chưa làm tại thời điểm cập nhật tài liệu này (giống hạng
mục còn treo mà §16.5 đã nêu cho `/assets`).)*

---

## 18. Alarms (ISA-18.2) + Line control (PackML) / Cảnh báo (ISA-18.2) + Điều khiển line (PackML)

**EN** — GĐ3 sub-4 gives this device two new supervisory layers, both landed this build: an
**ISA-18.2 alarm engine** (a durable, auto-clearing alarm backbone fed by three sources — Policy
denials, driver health, and fleet NG-rate) and a **PackML/ISA-88 line-control state machine** layered
over `FleetHost` (Start/Hold/Unhold/Stop/Abort/Reset), with an alarm→hold interlock tying the two
together: a live Critical alarm blocks the line from starting or resuming. Both are additive — neither
changes `FleetHost`'s own Start/Stop/Estop/ResetEstop behavior, they only supervise it.

*(VI: GĐ3 sub-4 cho thiết bị này hai lớp giám sát mới, đều đã giao trong bản này: một **cỗ máy cảnh báo
ISA-18.2** (một xương sống cảnh báo bền vững, tự xoá khi hết điều kiện, nạp từ ba nguồn — Policy từ
chối, sức khoẻ driver, và NG-rate của fleet) và một **máy trạng thái điều khiển line PackML/ISA-88**
nằm trên `FleetHost` (Start/Hold/Unhold/Stop/Abort/Reset), cùng một khoá liên động cảnh báo→hold nối
hai lớp này lại: một cảnh báo Critical đang hoạt động sẽ chặn line khởi động hoặc tiếp tục chạy. Cả hai
đều là bổ sung — không đổi hành vi Start/Stop/Estop/ResetEstop của chính `FleetHost`, chỉ giám sát nó.)*

### 18.1 The alarm model (ISA-18.2) / Mô hình cảnh báo (ISA-18.2)

**EN** — `St4i.EngineApi.Alarms.Alarm` is one alarm condition, keyed for dedup by `Source:Code:TargetId`
(`AlarmRaise.Key`): a re-raise of the same key UPDATEs `Count`/`LastRaisedUtc` while PRESERVING
`FirstRaisedUtc` and any existing ack state — never resets a re-raised alarm back to "freshly raised".

- **`AlarmSource`** — `Policy` | `DriverHealth` | `NgRate` (§18.2 below for these two automatic sources)
  | `Identity` (GĐ3 closeout WI-4 — §17.10; the SAME periodic evaluator additionally watches this
  device's own certificate expiry).
- **`AlarmPriority`** — `Critical` | `High` | `Medium` | `Low`, most-severe first (the same order
  `GET /v1/alarms` sorts by).
- **`AlarmState`** — `Active` | `Acked` | `Cleared` (`Cleared` is transient — a cleared alarm is already
  DELETEd from the live set; it only ever appears as the state on the in-memory `Alarm` a clearing call
  just returned, or as the `"cleared"` row in history).
- **EVENT vs. CONDITION (`ClearOnAck`)** — the model's central distinction. `ClearOnAck=true` (an EVENT
  alarm — today, only Policy denials): the triggering event has no lingering condition to watch, so an
  operator's Ack both acks AND clears it in one step. `ClearOnAck=false` (a CONDITION alarm —
  DriverHealth/NgRate): the condition can still be true after an Ack, so Ack only silences it
  (`Active`→`Acked`) — only the periodic evaluator's own `ClearAsync`, once the condition itself ends,
  actually removes it.
- **Store** — `AlarmStore` is its own SQLite file, `alarms.db`, under a directory resolved the same
  "explicit path (tests) → env var → `%ProgramData%` default" idiom as every other store in this doc
  (§15.2, §16.5, §17.3): default `%ProgramData%\ST4I\sim\alarms`, relocatable via **`ST4I_ALARMS_DIR`**.
  Two tables: `active_alarms` (the live set — one row per `Key`, UPSERTed/DELETEd) and `alarm_history`
  (append-only `raised`/`cleared`/`acked` events, never mutated). `RaiseAsync`/`ClearAsync` **NEVER
  throw** (a swallowed, logged failure) — a Policy-deny handler or the periodic evaluator must never
  fail an HTTP response or crash a tick just because `alarms.db` hiccuped; `AckAsync`/`ListActiveAsync`/
  `QueryHistoryAsync` are direct, caller-invoked reads/writes and may surface an ordinary exception.

**Sources:**

| Source | Raised by | Priority | `ClearOnAck` | Clears when |
|---|---|---|---|---|
| **Policy DENY** | `PolicyResults.DenyAsync` — every policy denial across the policy-gated fleet/scenario/line mutation routes (`FleetEndpoints`, `ScenarioEndpoints`, `LineEndpoints`) | `Critical` for `SAFETY_BLOCKED` (the halt guard, `EstopGuardRule`); `High` for every other denial reason | `true` (EVENT) | The operator's own Ack (both acks and clears it in one step) |
| **DriverHealth** | `AlarmEvaluator`'s periodic per-slot health pass (`FleetHost.GetDriverHealth`) | `High` for `Degraded`; `Critical` for `Down` | `false` (CONDITION) | The evaluator sees the slot `Connected` again, or the slot is removed from the fleet |
| **NG-rate** | `AlarmEvaluator`'s periodic windowed fleet-wide NG-rate pass (`FleetHost.GetKpiCounters`) | `High` | `false` (CONDITION) | The evaluator's next windowed rate falls back at/under the threshold |
| **Identity** (GĐ3 closeout WI-4, §17.10) | `AlarmEvaluator`'s periodic check of this device's own certificate `NotAfter` (`DeviceIdentityProvider.Current`) | **`High` only — capped, never `Critical`** (a `Critical` alarm feeds the alarm→hold gate, §18.7; an expiring credential must never stop production) | `false` (CONDITION) | A rotation (§17.10) pushes the expiry back out past the warn threshold |

Only the Policy source carries a **`Runbook`** hint: `SAFETY_BLOCKED` gets a halt-specific one ("The
halt latch is engaged — this stopped this software's own data collection only, not any machine. Reset
the latch (`POST /v1/fleet/estop/reset`) before starting."); every other denial reason gets a generic
one. DriverHealth/NgRate/Identity alarms carry no runbook.

The NG-rate source is a **windowed DELTA since the evaluator's last pass**, never a lifetime-cumulative
rate: if the judged-unit delta since the last pass is below **`ST4I_ALARM_NGRATE_MINSAMPLE`**, the
source evaluates nothing at all this pass (neither raises nor clears, to avoid flapping on a tiny
sample); a cumulative counter that goes backwards (e.g. a fleet reset) also just re-seeds the baseline
and skips the pass, rather than computing a nonsense negative rate.

*(VI: `Alarm` là một điều kiện cảnh báo, khoá trùng lặp theo `Source:Code:TargetId` — raise lại cùng
khoá CHỈ cập nhật `Count`/`LastRaisedUtc`, GIỮ NGUYÊN `FirstRaisedUtc` và trạng thái ack đã có. Ba+một
enum: `AlarmSource` (Policy/DriverHealth/NgRate/Identity — Identity là WI-4 GĐ3 closeout, §17.10),
`AlarmPriority` (Critical/High/Medium/Low, nghiêm trọng nhất trước), `AlarmState`
(Active/Acked/Cleared — Cleared chỉ là trạng thái tức thời, alarm đã bị XOÁ khỏi tập sống). Phân biệt
cốt lõi **SỰ KIỆN vs. ĐIỀU KIỆN** (`ClearOnAck`): `true` (sự kiện — hiện chỉ Policy DENY) — Ack vừa ghi
nhận vừa XOÁ luôn trong một bước; `false` (điều kiện — DriverHealth/NgRate/Identity) — Ack chỉ im lặng
nó (Active→Acked), CHỈ bộ đánh giá định kỳ mới thực sự xoá khi điều kiện tự hết. Kho lưu `AlarmStore` là
file SQLite riêng `alarms.db`, mặc định `%ProgramData%\ST4I\sim\alarms`, dời chỗ qua
**`ST4I_ALARMS_DIR`**. Hai bảng: `active_alarms` (tập sống) và `alarm_history` (log chỉ-ghi-thêm).
`RaiseAsync`/`ClearAsync` KHÔNG BAO GIỜ throw. Bốn nguồn: **Policy DENY** (mọi lần từ chối policy trên
các route fleet/scenario/line — `SAFETY_BLOCKED` = Critical + runbook chốt ngừng, còn lại = High + runbook
chung; sự kiện, Ack tự xoá); **DriverHealth** (đánh giá định kỳ theo từng slot — Degraded=High,
Down=Critical; tự xoá khi slot Connected lại hoặc bị gỡ khỏi fleet); **NG-rate** (đánh giá NG-rate CỬA
SỔ theo delta kể từ lần trước, không phải tỷ lệ cộng dồn trọn đời — dưới `ST4I_ALARM_NGRATE_MINSAMPLE`
thì bỏ qua hẳn lượt này để tránh nhấp nháy); **Identity** (WI-4 GĐ3 closeout, §17.10 — theo dõi hạn dùng
chứng chỉ thiết bị, GIỚI HẠN ở High, KHÔNG BAO GIỜ Critical vì Critical sẽ nạp vào khoá cảnh báo→hold,
§18.7). Chỉ nguồn Policy có `Runbook`.)*

### 18.2 The periodic evaluator (env vars) / Bộ đánh giá định kỳ (biến môi trường)

**EN** — `AlarmEvaluator` is the pure, directly-testable evaluation core for the three automatic sources
(no timer of its own — each of DriverHealth/NG-rate/Identity runs inside its own try/catch, and
`EvaluateAsync` itself never throws). `AlarmEvaluatorService` is the **first `IHostedService`**
registered in `St4i.EngineApi`: a thin `PeriodicTimer` loop that, every tick, reads a fresh
driver-health snapshot + KPI-counter pair + this device's own certificate expiry (§17.10) and hands them
to the evaluator — wrapped in its own try/catch too (defense in depth), so a bad tick is logged and the
loop simply continues, never taking the host down.

| Var | What it does | Default |
|---|---|---|
| `ST4I_ALARMS_DIR` | Relocates the alarm store directory (`alarms.db`, §18.1) | `%ProgramData%\ST4I\sim\alarms` |
| `ST4I_ALARM_NGRATE_THRESHOLD` | The NG-rate fraction (0.0-1.0) above which the fleet-wide NG-rate alarm raises | `0.20` (20%) |
| `ST4I_ALARM_NGRATE_MINSAMPLE` | The minimum judged-unit delta a window must accumulate before the NG-rate source evaluates at all | `5` |
| `ST4I_ALARM_EVAL_INTERVAL_MS` | `AlarmEvaluatorService`'s `PeriodicTimer` period, in milliseconds | `5000` (5s) |
| `ST4I_IDENTITY_EXPIRY_WARN_DAYS` | GĐ3 closeout WI-4 (§17.10) — how many days before this device's identity certificate's `NotAfter` the `Identity` source starts warning | `30` |

An unset or unparseable value keeps its built-in default rather than crashing startup — same posture
`WalOptions.FromEnvironment` already uses.

*(VI: `AlarmEvaluator` là lõi đánh giá thuần, test được trực tiếp, cho ba nguồn tự động (không có timer
riêng — không bao giờ throw). `AlarmEvaluatorService` là `IHostedService` ĐẦU TIÊN của
`St4i.EngineApi` — vòng lặp `PeriodicTimer` mỗi tick đọc health/KPI mới + hạn dùng chứng chỉ thiết bị
(§17.10) rồi đưa cho evaluator, tự bọc try/catch riêng để một tick lỗi không bao giờ làm sập host. Năm
biến môi trường: **`ST4I_ALARMS_DIR`**
(thư mục `alarms.db`, mặc định `%ProgramData%\ST4I\sim\alarms`); **`ST4I_ALARM_NGRATE_THRESHOLD`**
(ngưỡng tỷ lệ NG kích hoạt cảnh báo, mặc định `0.20` = 20%); **`ST4I_ALARM_NGRATE_MINSAMPLE`** (số mẫu
tối thiểu để đánh giá, mặc định `5`); **`ST4I_ALARM_EVAL_INTERVAL_MS`** (chu kỳ đánh giá, mặc định
`5000` ms = 5s); **`ST4I_IDENTITY_EXPIRY_WARN_DAYS`** (WI-4 GĐ3 closeout, §17.10 — số ngày trước khi
chứng chỉ danh tính thiết bị hết hạn thì nguồn `Identity` bắt đầu cảnh báo, mặc định `30`). Giá trị
trống/không đọc được thì giữ mặc định, không crash lúc khởi động.)*

### 18.3 Alarm endpoints / Endpoint cảnh báo

**EN** — `AlarmEndpoints` exposes three routes:

| Path | Verb | Role | Behavior |
|---|---|---|---|
| `/v1/alarms` | GET | Operator | The live/active set (`ListActiveAsync`) — every alarm currently `Active` or `Acked`, `Critical`-first then most-recently-raised-first. |
| `/v1/alarms/history` | GET | Operator | Paged/filtered read of the append-only `alarm_history` log (`?source=&priority=&from=&to=&limit=(200)&offset=(0)`), newest-first; `limit` is clamped to 1-1000, `offset` to ≥0 (same clamp-before-store discipline `AuditEndpoints.GetAuditAsync` uses); `total` is the FULL filtered count. |
| `/v1/alarms/{id}/ack` | POST | Operator, audited `alarm.ack` | Acknowledges the alarm by its `Id` (rowid) — for an EVENT alarm (`ClearOnAck=true`) this both acks and clears it; for a CONDITION alarm it only silences it (`Active`→`Acked`). `404` if `id` is unknown or already cleared (no audit row is written on a 404 — same "mutate THEN record" ordering `AssetEndpoints.SetLifecycleAsync` uses). |

*(VI: `AlarmEndpoints` có 3 route: **`GET /v1/alarms`** (Operator) — tập đang hoạt động, Critical
trước, mới nhất trước. **`GET /v1/alarms/history`** (Operator) — đọc phân trang/lọc log
`alarm_history`, mới nhất trước; `limit` giới hạn 1-1000, `offset` ≥0, `total` là tổng số đã lọc.
**`POST /v1/alarms/{id}/ack`** (Operator, có audit `alarm.ack`) — xác nhận theo `Id`; alarm SỰ KIỆN thì
vừa ack vừa xoá luôn, alarm ĐIỀU KIỆN thì chỉ im lặng (Active→Acked); `404` nếu `id` không tồn tại/đã
xoá, không ghi audit khi 404.)*

### 18.4 LineController — the PackML state machine / Máy trạng thái PackML

**EN** — `St4i.EngineApi.Line.LineController` is a supervisory PackML/ISA-88 state machine layered OVER
`FleetHost` — it calls `FleetHost.Start`/`Stop`/`Estop`/`ResetEstop` to actually drive the fleet, never
reimplementing that logic. It's a deliberately **pragmatic ISA-88 stable-state subset**: since
`FleetHost`'s own Start/Stop/Estop/ResetEstop calls return only once the pipeline transition has
already happened, the transient states a real PackML model names (Starting/Stopping/Holding/Aborting/
Resetting/…) are instantaneous here and not modeled — only the **five stable states** a caller can ever
actually observe between commands:

**States (`PackMlState`):** `Idle` · `Execute` · `Held` · `Stopped` · `Aborted`

**Commands (`LineCommand`), one per `POST /v1/line/{command}` route segment:** `Start` · `Hold` ·
`Unhold` · `Stop` · `Abort` · `Reset`

**FleetHost mapping** — `Hold` is a resumable pause, distinct from `FleetHost`'s own plain "stopped":

| Command | FleetHost call | Notes |
|---|---|---|
| `Start` | `FleetHost.Start` | Unless a Critical alarm is active (§18.7) |
| `Hold` | `FleetHost.Stop` | Remembers the operator's intent to resume via `Unhold` |
| `Unhold` | `FleetHost.Start` | Unless a Critical alarm is active (§18.7) |
| `Stop` | `FleetHost.Stop` | No implied resume (unlike `Hold`) |
| `Abort` | `FleetHost.Estop` | |
| `Reset` | `FleetHost.ResetEstop` | Idempotent — a no-op on the latch if it wasn't actually engaged |

**Transition table** (validated against the CURRENT commanded state; an illegal command is REJECTED —
`Accepted=false` — never silently ignored):

- **Start** — legal from `{Idle, Stopped}`. If a Critical alarm is active, the target is redirected to
  `Held` (`HoldReason` = `"critical alarm active"`) and `FleetHost.Start` is deliberately **not**
  called — this is still an ACCEPTED transition (the command was legal; the interlock's permissive just
  wasn't met). Otherwise → `Execute` + `FleetHost.Start`.
- **Hold** — legal only from `Execute` → `Held` (`"operator hold"`) + `FleetHost.Stop`.
- **Unhold** — legal only from `Held`. If a Critical alarm is active, REJECTED (`Accepted=false`, stays
  `Held`, reason `"critical alarm active"`) — unlike Start's redirect, there's no NEW state to report
  here. Otherwise → `Execute` + `FleetHost.Start`.
- **Stop** — legal from `{Execute, Held}` → `Stopped` + `FleetHost.Stop`.
- **Abort** — legal from any state except `Aborted` (a halt must always be reachable) → `Aborted` +
  `FleetHost.Estop` (SM-4: a software abort of this software's own pipeline, not a safety device — §1).
- **Reset** — legal from `{Stopped, Aborted}` → `Idle` + `FleetHost.ResetEstop`.

`Snapshot` reports the **effective** state, which can diverge from the raw commanded state: a commanded
`Execute` with a Critical alarm currently active reads back as `Held` (§18.7) — a pure read, it never
mutates the commanded state. Initial commanded state is `Stopped` (not derived from
`FleetHost.IsRunning` at construction). Thread-safe (its own private lock). Publishes to the UNS spine
(§18.6) on every commanded-state **change** — never on a rejection, never on `Snapshot`'s own read-time
override.

*(VI: `LineController` là máy trạng thái PackML/ISA-88 giám sát nằm TRÊN `FleetHost` — gọi
Start/Stop/Estop/ResetEstop của FleetHost để thực sự điều khiển fleet, không tự làm lại logic đó. Đây
là tập con TRẠNG THÁI ỔN ĐỊNH thực dụng của ISA-88 — vì các lệnh của FleetHost là đồng bộ (trả về khi đã
xong việc), các trạng thái tức thời PackML thật đặt tên (Starting/Stopping/Holding/...) không được mô
hình hoá — chỉ có 5 TRẠNG THÁI ỔN ĐỊNH: `Idle`, `Execute`, `Held`, `Stopped`, `Aborted`. 6 LỆNH (mỗi
lệnh một đoạn route `POST /v1/line/{command}`): `Start`, `Hold`, `Unhold`, `Stop`, `Abort`, `Reset`. Ánh
xạ FleetHost: Start→FleetHost.Start; Hold/Stop→FleetHost.Stop (Hold nhớ ý định tiếp tục qua Unhold, Stop
thì không); Unhold→FleetHost.Start; Abort→FleetHost.Estop; Reset→FleetHost.ResetEstop (idempotent).
Bảng chuyển trạng thái: **Start** hợp lệ từ {Idle, Stopped} — nếu có cảnh báo Critical đang hoạt động
thì chuyển hướng sang `Held` (lý do "critical alarm active") mà KHÔNG gọi FleetHost.Start (vẫn là
chuyển trạng thái ĐƯỢC CHẤP NHẬN); **Hold** chỉ hợp lệ từ Execute → Held ("operator hold"); **Unhold**
chỉ hợp lệ từ Held — nếu Critical đang hoạt động thì BỊ TỪ CHỐI (không phải chuyển hướng, vì không có
trạng thái mới để báo); **Stop** hợp lệ từ {Execute, Held} → Stopped; **Abort** hợp lệ từ MỌI trạng
thái trừ Aborted (chốt ngừng luôn phải với tới được) → Aborted; **Reset** hợp lệ từ {Stopped, Aborted} →
Idle. `Snapshot` trả về trạng thái HIỆU LỰC (có thể khác trạng thái đã lệnh) — Execute + Critical đang
hoạt động đọc về thành Held (§18.7). Trạng thái lệnh ban đầu là `Stopped`. An toàn luồng (khoá riêng).
Publish lên UNS (§18.6) mỗi khi trạng thái LỆNH đổi — không bao giờ khi bị từ chối hay khi Snapshot tự
ghi đè lúc đọc.)*

### 18.5 Line endpoints / Endpoint line

**EN** — `LineEndpoints` exposes two routes:

| Path | Verb | Role | Behavior |
|---|---|---|---|
| `/v1/line` | GET | Operator | The effective `LineStatus` — `{state, holdReason, isRunning, estopEngaged}`. `holdReason` is non-null only when `state` is `Held`; `isRunning`/`estopEngaged` are read straight off `FleetHost` (the ACTUAL truth), never cached. |
| `/v1/line/{command}` | POST | Operator, policy-gated + audited | Policy-evaluated as `line.{command}` (derived from the PARSED enum, never the raw route text, so casing never matters) — same `policy.Evaluate` → `PolicyResults.DenyAsync` → mutate → `recorder.RecordAsync` template `/v1/fleet/*` already uses. `line.start`/`line.unhold` are **`EstopGuardRule`**-blocked while the halt latch is engaged (`SAFETY_BLOCKED`, same guard `fleet.start` already has) — a denial here is what raises the Critical Policy alarm (§18.1). A REJECTED `LineController` transition (illegal state, or an Unhold blocked by a Critical alarm) returns `409` and writes NO audit row (only the Policy-deny path is audited pre-mutation); an ACCEPTED transition audits before/after `LineStatus` snapshots. |

*(VI: `LineEndpoints` có 2 route: **`GET /v1/line`** (Operator) — trạng thái hiệu lực
`{state, holdReason, isRunning, estopEngaged}`; `holdReason` chỉ khác null khi `state` là Held;
`isRunning`/`estopEngaged` đọc thẳng từ FleetHost (sự thật THỰC), không cache. **`POST
/v1/line/{command}`** (Operator, có policy-gate + audit) — đánh giá policy dưới tên `line.{command}`
(lấy từ enum đã parse, không phải chữ route thô); `line.start`/`line.unhold` bị **`EstopGuardRule`**
chặn khi chốt ngừng đang cài (`SAFETY_BLOCKED`, cùng guard mà `fleet.start` đã có) — một lần từ chối ở
đây chính là thứ nâng cảnh báo Policy Critical (§18.1). Chuyển trạng thái BỊ TỪ CHỐI trả `409`, KHÔNG
ghi audit; chuyển trạng thái ĐƯỢC CHẤP NHẬN thì có audit trước/sau.)*

### 18.6 UNS `_line/state` / UNS `_line/state`

**EN** — `LineController` publishes the PackML state to the local UNS spine (§16.1) on every commanded
state change, via `IUnsPublisher.PublishLineState` — a RETAINED message on its own dedicated topic
(`UnsTopicBuilder.BuildLineStateTopic`):

```
syn/{site}/{area}/{line}/{cell}/_line/state
```

(`{site}/{area}/{line}/{cell}` is this process's own ISA-95 address, the same one §16.1's semantic-mirror
topics already use — the `{line}` segment there is the ISA-95 Line, not to be confused with this
section's "line control" feature name.) Payload: `{ state, atUtc }` (e.g.
`{"state":"Execute","atUtc":"2026-07-28T09:00:00Z"}`). The underscore-prefixed `_line` segment can
never collide with a real equipment code (always derived from `MachineDescriptor.Code`). Non-blocking,
optional — a `null` `IUnsPublisher` (UNS disabled, §16.1) is a no-op, same convention as every other
UNS-adjacent collaborator.

*(VI: `LineController` publish trạng thái PackML lên UNS spine cục bộ (§16.1) mỗi khi trạng thái LỆNH
đổi, qua `IUnsPublisher.PublishLineState` — một message GIỮ LẠI (retained) trên topic riêng:
`syn/{site}/{area}/{line}/{cell}/_line/state` (địa chỉ ISA-95 của chính process, giống §16.1; đoạn
`{line}` ở đây là Line theo ISA-95, khác với tên tính năng "điều khiển line" của mục này), payload
`{state, atUtc}`. Đoạn `_line` có gạch dưới không bao giờ trùng mã thiết bị thật. Không chặn, tuỳ chọn —
UNS tắt thì đây là no-op.)*

### 18.7 The alarm→hold gate — honest boundary / Khoá cảnh báo→hold — ranh giới thật

**EN** — Both `GET /v1/line` and `POST /v1/line/{command}` compute `criticalAlarmActive` as "does
`GET /v1/alarms`' active set contain ANY alarm with `Priority=Critical`" (from ANY source — a Policy
`SAFETY_BLOCKED`, a `DriverHealth` `Down`, or a future Critical source; not just Policy). That single
boolean drives the gate:

- **Start** into a Critical alarm redirects to `Held` (not `Execute`) — accepted, not rejected.
- **Unhold** out of `Held` while a Critical alarm is active is rejected — stays `Held`.
- **Every poll's effective state** (`Snapshot`) shows `Held` the instant a Critical alarm is active,
  even if the commanded state is still `Execute` — so a Critical alarm raised WHILE the line is already
  running becomes visible on the very next `GET /v1/line`, without waiting for an operator to issue a
  fresh `Hold`.

Note also: "active" here means anything still in the live set returned by `ListActiveAsync` — `Active`
**or** `Acked` (§18.1). Acknowledging a CONDITION-type Critical alarm (e.g. a `DriverHealth` `Down`)
does **not**, by itself, lift the gate — it stays counted until the evaluator's own `ClearAsync` removes
it once the condition ends. A Policy `SAFETY_BLOCKED` Critical alarm is the one exception: it's an
EVENT alarm (`ClearOnAck=true`), so acknowledging it clears it in the same call, and the gate lifts
immediately.

**The honest boundary the brief calls out:** this gate only ever engages through a **Start/Unhold
command** (blocking/redirecting it) or through **`Snapshot`'s read-time display** (showing `Held`
instead of `Execute`). It does **not** reach into `FleetHost` on its own initiative — nothing in this
codebase watches for a NEW Critical alarm and automatically calls `FleetHost.Stop` on an already-
`Execute` line. Concretely: if the line is commanded `Execute` and a Critical alarm is raised mid-run,
the fleet **keeps physically producing** (`FleetHost.IsRunning` stays `true`) until an operator (or a
future auto-hold feature, §18.9) actually issues `Hold`/`Stop` — the poll only makes that Critical
condition **visible**, it does not act on it by itself.

*(VI: Cả `GET /v1/line` lẫn `POST /v1/line/{command}` đều tính `criticalAlarmActive` = "tập cảnh báo
đang hoạt động (`GET /v1/alarms`) có bất kỳ cảnh báo Critical nào không" (từ BẤT KỲ nguồn nào — Policy
SAFETY_BLOCKED, DriverHealth Down, hay nguồn Critical tương lai). Giá trị boolean đó điều khiển khoá:
**Start** vào lúc Critical đang hoạt động → chuyển hướng sang `Held` (không phải Execute) — được CHẤP
NHẬN, không bị từ chối. **Unhold** ra khỏi `Held` khi Critical đang hoạt động → BỊ TỪ CHỐI, giữ nguyên
Held. **Mỗi lần đọc** (`Snapshot`) hiện `Held` ngay khi có Critical, dù trạng thái lệnh vẫn là Execute —
nên một cảnh báo Critical nổi lên GIỮA LÚC line đang chạy sẽ hiện ra ngay ở lần `GET /v1/line` kế tiếp,
không cần đợi operator ra lệnh Hold mới. Lưu ý: "đang hoạt động" ở đây gồm cả `Active` LẪN `Acked`
(§18.1) — ack một cảnh báo Critical dạng ĐIỀU KIỆN (ví dụ DriverHealth Down) KHÔNG tự gỡ khoá, nó vẫn bị
tính cho tới khi bộ đánh giá thực sự xoá. Cảnh báo Policy SAFETY_BLOCKED là ngoại lệ duy nhất — đó là
alarm SỰ KIỆN (ClearOnAck=true), ack là xoá luôn, nên khoá gỡ ngay.

**Ranh giới thật:** khoá này CHỈ tác động qua lệnh Start/Unhold (chặn/chuyển hướng) hoặc qua HIỂN THỊ
lúc đọc của Snapshot (hiện Held thay vì Execute). Nó KHÔNG tự ý gọi vào FleetHost — không có gì trong mã
nguồn này theo dõi một cảnh báo Critical MỚI rồi tự động gọi FleetHost.Stop trên một line đang Execute.
Cụ thể: nếu line đang lệnh Execute và một cảnh báo Critical nổi lên giữa chừng, fleet VẪN TIẾP TỤC SẢN
XUẤT THẬT (FleetHost.IsRunning vẫn true) cho tới khi operator (hay một tính năng auto-hold tương lai,
§18.9) thực sự ra lệnh Hold/Stop — việc đọc chỉ làm điều kiện Critical đó HIỂN THỊ RA, không tự hành
động theo nó.)*

### 18.8 Web UI — `/alarms` and `/line` / Web UI — trang `/alarms` và `/line`

**EN** — Two new nav items (`shell.nav.alarms`/`shell.nav.line`, `Shell.tsx`/`Sidebar.tsx`):

- **`/alarms` — Alarm Center** (`routes/AlarmCenter.tsx`) — an **Active** tab (polled list, a priority
  chip per row, a view-detail dialog with message/priority/first-raised/last-raised/runbook/acked-by,
  and an **Ack** button) and a **History** tab (a paged, filtered read of `alarm_history`, same
  limit/offset/prev-next idiom `Audit.tsx` established). Reads are Operator (the lowest role, so every
  signed-in user); the Ack button is wrapped in a client-side `RequireRole role="Operator"` for shape —
  the real enforcement is the server's own `Policies.Operator` on `POST /v1/alarms/{id}/ack`.
- **`/line` — Line Control** (`routes/LineControl.tsx`) — a **Status** card (the live PackML badge,
  polled off `GET /v1/line`, a `holdReason` banner, and `isRunning`/`estopEngaged` readouts) and a
  **Commands** card (Start/Hold/Unhold/Stop/Abort/Reset buttons, each disabled unless legal from the
  current state per §18.4's own transition table — mirrored client-side so the UI never offers a
  command the server would `409`-reject; **Abort is the one deliberate exception, always enabled**,
  mirroring the physical convention that a real emergency-stop control should never be greyed out
  (SM-4: Abort itself is a software abort of this software's own pipeline, not a safety device — §1) —
  a redundant Abort-from-`Aborted` still 409s and surfaces the same inline error every other rejected
  command does). This is a dedicated route,
  distinct from `TopBar.tsx`'s own separate fleet-level Start/Stop pair (the whole simulated fleet's
  power switch) — shoehorning this PackML-level surface into the KPI strip would conflate the two.

*(VI: Hai mục điều hướng mới. **`/alarms` — Alarm Center** — tab **Active** (danh sách polled, chip mức
ưu tiên, dialog xem chi tiết, nút **Ack**) và tab **History** (đọc phân trang/lọc `alarm_history`). Đọc
là quyền Operator (thấp nhất — mọi người dùng đăng nhập); nút Ack có `RequireRole role="Operator"` phía
client chỉ mang tính hình thức, thực thi thật nằm ở server (`Policies.Operator`). **`/line` — Line
Control** — thẻ **Status** (badge PackML sống, banner `holdReason`, `isRunning`/`estopEngaged`) và thẻ
**Commands** (nút Start/Hold/Unhold/Stop/Abort/Reset, disable theo đúng bảng chuyển trạng thái §18.4 —
riêng **Abort LUÔN BẬT** — theo quy ước của một nút dừng khẩn cấp vật lý thật, không bao giờ nên bị xám
(SM-4: bản thân Abort là một lệnh hủy phần mềm của pipeline phần mềm này, không phải thiết bị an toàn —
§1); Abort dư thừa từ Aborted vẫn 409
như bình thường). Đây là route RIÊNG, khác với cặp Start/Stop cấp-fleet của `TopBar.tsx`.)*

### 18.9 Honest deferrals / Những gì CHƯA làm

**EN** — Documented here, not silently missing:

- **Per-machine hold** — `LineController` drives the WHOLE fleet through `FleetHost`; there is no
  per-machine PackML state or per-machine Hold.
- **Auto-hold of an already-running fleet on a new Critical alarm** — see §18.7's own boundary: only
  Start/Unhold (and the read-time effective-state display) are gated; nothing automatically transitions
  or stops a line already commanded `Execute`.
- **NCMD inbound line commands from a Site** — the northbound UNS bridge (§17.2) is
  outbound-telemetry-only; a Site can observe `_line/state` (§18.6) but cannot issue
  Start/Hold/Stop/etc. to this device.
- **Alarm shelving/suppression/rationalization workflow** — no shelve/suppress, no duplicate-alarm
  rationalization beyond the dedup-by-`Key` upsert (§18.1); every raised alarm is either active or
  acked, nothing in between.
- **Full PackML transient-state/mode machinery** — only the five stable states are modeled (§18.4); no
  Starting/Stopping/Holding/Aborting/Resetting transient states, and no PackML Modes
  (Auto/Manual/Maintenance/…).

*(VI: Ghi rõ ở đây, không giấu: **Chỉ hold cấp fleet** — LineController điều khiển CẢ fleet qua
FleetHost, không có trạng thái PackML hay Hold riêng theo từng máy. **Chưa tự động hold một fleet đang
chạy khi có cảnh báo Critical mới** — xem ranh giới §18.7: chỉ Start/Unhold (và hiển thị lúc đọc) bị
khoá, không có gì tự chuyển/dừng một line đang lệnh Execute. **Chưa có đường lệnh line vào (NCMD) từ
Site** — bridge UNS hướng lên (§17.2) chỉ gửi telemetry ra, Site xem được `_line/state` nhưng không ra
lệnh được. **Chưa có luồng shelving/suppression/rationalization cảnh báo** — không có shelve/suppress,
không hợp lý hoá trùng lặp ngoài việc upsert theo Key (§18.1). **Chưa có đầy đủ máy trạng thái/mode
PackML** — chỉ mô hình hoá 5 trạng thái ổn định, không có các trạng thái tức thời hay Mode
(Auto/Manual/Maintenance/…).)*

---

## 19. Connector SDK — the seam for a future plugin/sidecar model (WS-G-plugin) / SDK Connector — nền tảng cho mô hình plugin/sidecar tương lai

**EN** — WS-G-plugin (`.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/`) built the
**seam** a future Connector SDK will need: a dependency-free contract assembly a third party can compile
against, a lossless JSON wire format for that contract, connector ids opened from a closed enum to
free-form strings, a registry that replaced `FleetHost`'s own per-driver hardcoding, a `connectors.json`
config source, and a shippable conformance suite — which then found and fixed two real reliability
defects in the Modbus/OPC-UA drivers that ship today (§16.4/§16.6). **Read §19.7 before assuming more
than this shipped: there is no plugin loader, nothing external is loaded, and `connectors.json` can only
dispatch to the two built-in protocol drivers.** This section documents the seam; §19.7 states plainly
what it is not.

*(VI: WS-G-plugin (`.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/`) xây **nền tảng**
(seam) mà một Connector SDK trong tương lai sẽ cần: một assembly hợp đồng không phụ thuộc mà bên thứ ba
có thể biên dịch driver của họ dựa vào, một định dạng JSON lossless cho hợp đồng đó, id connector mở từ
enum đóng thành chuỗi tự do, một registry thay thế việc hard-code từng driver trong `FleetHost`, một
nguồn cấu hình `connectors.json`, và một bộ kiểm tra tuân thủ (conformance suite) có thể đóng gói —
bộ này sau đó tìm ra và giúp sửa 2 lỗi độ tin cậy THẬT trong driver Modbus/OPC-UA đang chạy sản xuất hôm
nay (§16.4/§16.6). **Đọc §19.7 trước khi nghĩ có nhiều hơn thế: CHƯA có plugin loader, KHÔNG có mã ngoài
nào được nạp, và `connectors.json` hiện chỉ dispatch được tới hai driver giao thức có sẵn.** Mục này ghi
lại nền tảng đã xây; §19.7 nói thẳng nó CHƯA phải là gì.)*

### 19.1 `St4i.Connector.Abstractions` — the contract assembly / Assembly hợp đồng, không phụ thuộc (GP-1)

**EN** — A new project, `src/St4i.Connector.Abstractions`: plain **`net10.0`** (deliberately **not**
`-windows`), **zero** `PackageReference`/`ProjectReference` (verified against the built DLL's own
metadata — it references only `System.Runtime`/`System.Collections`/`System.Text.Json`, all BCL). It
exists because `St4i.EdgeCore` — where `IDeviceDriver` used to live —
is `net10.0-windows` (DPAPI `CredentialStore`, a WPF-adjacent vendored SDK) and is never published:
**before this task, nobody outside this repo could compile a driver against anything in this
codebase.** Now they can compile against this one assembly alone.

Moved here (a pure relocation — GP-1's own review re-verified byte-for-byte that no method body,
default value, member, or accessibility changed): `IDeviceDriver`, `IConnectorFactory`,
`DeviceReading` + its nested records (`MetricSample`/`WaveformSeries`/`Bbox`/`Values3d`/
`MeasurementResult`/`TelemetrySample`), `CyclePlan`/`CyclePlanStep`, `TelemetryNumeric`, and the
contract enums `ReadingKind`/`Verdict`/`DriverHealthState`/`DeviceClass` (namespace
`St4i.Connector.Abstractions`(`.Models`)). `TransportMode` deliberately **stayed** in `St4i.EdgeCore` —
it is a host concern (the enum itself is `{Live, Demo, Auto}` — not part of the driver contract).

**Not published to NuGet** — a third party currently has to reference it from source (clone/submodule
this repo, or copy the project), not `dotnet add package`. Same is true of
`src/St4i.Connector.Conformance` (§19.5).

*(VI: Dự án mới, `src/St4i.Connector.Abstractions`: `net10.0` thuần (CỐ Ý không phải `-windows`), **ZERO**
`PackageReference`/`ProjectReference` (đã xác minh qua metadata của DLL đã build — chỉ tham chiếu
`System.Runtime`/`System.Collections`/`System.Text.Json`, toàn bộ đều là BCL). Nó
tồn tại vì `St4i.EdgeCore` — nơi `IDeviceDriver` từng sống — là `net10.0-windows` (DPAPI
`CredentialStore`, SDK vendor gắn với WPF) và KHÔNG BAO GIỜ được publish: **trước task này, không ai
ngoài repo này biên dịch được driver dựa vào bất cứ thứ gì trong codebase.** Giờ họ chỉ cần biên dịch
dựa vào MỘT assembly này. Đã di dời (thuần di chuyển, review GP-1 xác minh lại từng byte không đổi
method body/giá trị mặc định/thành viên/khả năng truy cập nào): `IDeviceDriver`, `IConnectorFactory`,
`DeviceReading` + các record lồng, `CyclePlan`/`CyclePlanStep`, `TelemetryNumeric`, và các enum hợp đồng
`ReadingKind`/`Verdict`/`DriverHealthState`/`DeviceClass`. `TransportMode` CỐ Ý ở lại `St4i.EdgeCore` —
đó là mối quan tâm của host (bản thân enum là `{Live, Demo, Auto}` — không thuộc hợp đồng driver).

**Chưa publish lên NuGet** — bên thứ ba hiện phải tham chiếu từ mã nguồn (clone/submodule repo này, hoặc
copy project), không `dotnet add package` được. `src/St4i.Connector.Conformance` (§19.5) cũng vậy.)*

### 19.2 `IDeviceDriver` — the driver lifecycle contract / Hợp đồng vòng đời driver (GP-2, GP-6)

**EN** — GP-6 turned `IDeviceDriver`'s own XML doc comments into the literal conformance contract
(§19.5 enforces every line below):

- **Construction is non-blocking and performs no I/O.** `FleetHost.StartLocked` constructs drivers under
  the SAME lock `Estop()` takes — a slow/blocking constructor stalls the `Estop()` call itself (a
  supervisory software halt of this software's own pipeline — SM-4, §1 — not a machine safety function)
  for as long as it takes. Any connect/session work belongs entirely inside `ReadAsync`, never the constructor.
- **`ReadAsync`'s cancellation must be honoured promptly — including when no device is reachable at
  all.** The realistic failure mode this exists for: a device that's off, disconnected, or that accepts
  a connection but never responds. `FleetHost`'s own teardown only waits a bounded few seconds before
  giving up and moving on with the background task orphaned.
- **`DisposeAsync` is idempotent** — safe to call more than once, after cancellation, after a completed
  enumeration, or without `ReadAsync` ever having been enumerated — must never throw in any of those
  cases, and should itself return promptly (`FleetHost` best-effort disposes under a bounded budget; a
  slow `DisposeAsync` is effectively abandoned, not awaited to completion).
- **`Id`/`Kind` are non-empty and stable for the instance's whole lifetime** (they key slot labels and,
  through those, alarms) — including after `DisposeAsync`.
- **`Health` only ever takes a documented `DriverHealthState` value**, and a device-backed driver must
  **never** report `Connected` while no device is actually reachable — not even transiently, partway
  through an attempt that never completes. A pure in-process simulator is exempt from that ONE rule, but
  only if its own class doc comment says so explicitly and documents what `Health` reports instead —
  claiming the exemption silently is itself a conformance violation.
- **No reading-instance reuse or mutation** — each yielded `DeviceReading` (and anything mutable it
  holds, e.g. its `Telemetry` list) must be a distinct instance never touched again afterward.
  `EdgePipeline` hands the exact same reference to the UNS publisher (read later, on a background
  thread) and to every `Committed` subscriber, with no defensive copy — reusing/mutating a
  previously-yielded reading corrupts data that has already been delivered, in a way that's extremely
  hard to trace back to the driver.
- **Every yielded reading must round-trip losslessly through `ConnectorJson`** (GP-2, the sidecar-
  readiness gate) — see `ConnectorObjectConverter`'s own doc comment for the exact accepted domain of
  `TelemetrySample.Value`/`DeviceReading.Genealogy` values: `null`/`bool`/`string`, every standard CLR
  integral numeric type (all widen losslessly to `long`), `float`/`double` — `decimal` and anything else
  (a `DateTime`, an array, a nested object) is **rejected loudly** (throws), never silently coerced,
  because a silent type change at a real process boundary is undiagnosable on the other side.

*(VI: GP-6 biến các doc comment XML của `IDeviceDriver` thành hợp đồng tuân thủ THẬT SỰ (§19.5 thực thi
từng dòng): **Khởi tạo (constructor) không chặn và không I/O** — `FleetHost.StartLocked` khởi tạo driver
dưới CÙNG lock mà `Estop()` giữ, constructor chậm/chặn sẽ làm chính lệnh gọi `Estop()` treo lâu tương
ứng (SM-4: đây là một chốt ngừng phần mềm giám sát của pipeline phần mềm này, không phải chức năng an
toàn của máy — §1). **Huỷ
(cancellation) của `ReadAsync` phải được tôn trọng NGAY LẬP TỨC — kể cả khi không có thiết bị nào tiếp
cận được** — teardown của `FleetHost` chỉ chờ vài giây có giới hạn rồi bỏ cuộc, để lại task nền mồ côi.
**`DisposeAsync` phải idempotent** — gọi nhiều lần, sau khi huỷ, sau khi enumerate xong, hoặc chưa từng
enumerate — không bao giờ được throw, và nên trả về nhanh. **`Id`/`Kind` không rỗng và ổn định suốt vòng
đời instance** (dùng để đặt tên slot và qua đó là cảnh báo) — kể cả sau `DisposeAsync`. **`Health` chỉ
nhận giá trị `DriverHealthState` đã tài liệu hoá**, và driver có thiết bị thật KHÔNG BAO GIỜ được báo
`Connected` khi không có thiết bị nào tiếp cận được — kể cả thoáng qua. Một simulator thuần trong-tiến-
trình được miễn trừ MỘT quy tắc này, nhưng chỉ khi doc comment của chính lớp đó nói rõ và ghi `Health`
báo gì thay vào đó — nhận miễn trừ mà không ghi rõ chính là vi phạm tuân thủ. **Không tái sử dụng/sửa
đổi instance reading đã yield** — mỗi `DeviceReading` yield ra phải là instance riêng biệt không bao giờ
bị đụng vào sau đó — `EdgePipeline` giữ đúng tham chiếu đó cho UNS publisher (đọc sau, trên thread nền)
và mọi subscriber `Committed`, không có bản sao phòng vệ. **Mọi reading yield ra phải round-trip lossless
qua `ConnectorJson`** (GP-2) — domain chấp nhận: `null`/`bool`/`string`, mọi kiểu số nguyên CLR chuẩn
(đều widen lossless về `long`), `float`/`double` — `decimal` và bất cứ gì khác bị TỪ CHỐI ngay (throw),
không bao giờ âm thầm ép kiểu.)*

### 19.3 Connector ids — open strings, not a closed enum / Id connector — chuỗi mở, không còn enum đóng (GP-3)

**EN** — `DriverKind` used to be a closed 5-member enum; it is now a free-form `string`
(`IDeviceDriver.Kind`, `MachineDescriptor.DriverKind`, `DriverHealthSnapshot`, the fleet DTOs, `assets.db`'s
`driver_kind` column). **The five built-ins keep their exact historical spellings** — `DriverKinds.Simulated`
/`HotFolderAoi`/`Mqtt`/`Modbus`/`OpcUa` (PascalCase, the same strings the old enum's
`JsonStringEnumConverter` already produced) — **no migration**, no wire/database format change.
`DriverKinds.Normalize` case-insensitively folds any casing of those five to the canonical spelling
(preserving `fleet.json`'s long-standing tolerant casing), then leaves anything else — a third-party id —
byte-for-byte, **case-sensitively** untouched: `"vendor.acme.weld"` and `"Vendor.Acme.Weld"` are two
distinct ids as far as this codebase is concerned, and a third-party author is responsible for one
consistent spelling.

**Recommended (not enforced) third-party convention:** a namespaced, reverse-DNS-style id — e.g.
`vendor.acme.weld` — so two unrelated vendors' ids cannot collide. This is a documentation recommendation
only; nothing validates the shape (enforcing one here would just trade the old closed-enum problem for a
new closed-shape one).

*(VI: `DriverKind` từng là enum đóng 5 thành viên; giờ là `string` tự do. **5 loại có sẵn giữ NGUYÊN cách
viết lịch sử** — `Simulated`/`HotFolderAoi`/`Mqtt`/`Modbus`/`OpcUa` — KHÔNG có migration, không đổi định
dạng wire/database. `DriverKinds.Normalize` gấp mọi cách viết hoa/thường của 5 id này về đúng chính tả
chuẩn, còn lại — id bên thứ ba — giữ NGUYÊN VĂN, PHÂN BIỆT hoa/thường: `"vendor.acme.weld"` và
`"Vendor.Acme.Weld"` là hai id KHÁC NHAU, tác giả bên thứ ba tự chịu trách nhiệm dùng một cách viết nhất
quán. **Quy ước khuyến nghị (không bắt buộc) cho bên thứ ba:** id kiểu namespace, reverse-DNS — vd
`vendor.acme.weld` — để hai hãng không đụng độ id. Đây chỉ là khuyến nghị tài liệu, không có kiểm tra hình
thức nào ép buộc.)*

### 19.4 `ConnectorRegistry`, `IConnectorFactory` + web visibility / `ConnectorRegistry`, `IConnectorFactory` + hiển thị trên web (GP-4, GP-5, GP-7)

**EN** — `St4i.EngineApi.Fleet.ConnectorRegistry` replaced `FleetHost`'s old per-driver-kind hardcoding
(one dedicated constructor parameter + one copy-pasted `StartLocked` block, PER kind — Modbus and
OPC-UA each had their own). Now: one optional `ConnectorRegistry`, one `foreach` over
`RegisteredIds`. `IConnectorFactory` (`St4i.Connector.Abstractions`) is the two-member seam a connector
implements to be buildable by id — `string Kind` (what the registry keys on, normalized the same way as
any other connector id, §19.3) and `bool TryCreate(string config, out driver, out error)`. Its own doc
comment sets three hard rules any implementation — first- or third-party — must follow:

- **MUST return promptly and MUST NOT perform I/O.** `ConnectorRegistry` is consulted from inside the
  SAME `_gate` lock `FleetHost.Estop()` takes — this is the one place third-party code runs while that
  lock is held, so a slow `TryCreate` blocks the halt call (`Estop()`) for as long as it takes. Both
  built-in factories (Modbus, OPC-UA) only ever parse a small in-memory JSON blob here; the actual
  socket/session opens lazily inside `ReadAsync`.
- **MUST NOT throw for a bad/malformed config** — return `false` with an operator-readable `error`
  instead. `ConnectorRegistry.TryCreateDriver` doubly guards this anyway (catches a throwing factory)
  precisely because a third party cannot be forced to honor its own contract.
- **`config` is a completely opaque string**, never parsed by the registry — chosen specifically because
  a plain string is what an operator-authored config file already is on disk, AND it is what would have
  to cross a future sidecar process boundary unchanged, with no serializer assumption baked in.

Config sources: the four legacy `ST4I_MODBUS_*`/`ST4I_OPCUA_*` env vars (unchanged) and `connectors.json`
(§16.7) both register into the same `ConnectorRegistry`; env vars always win a same-kind conflict.

**Web visibility (GP-7):** `GET /v1/connectors` (§16.7) is now rendered on `/assets`
(`AssetRegistry.tsx`) as a small "Connector status" card above the asset table — placed there, not on
`/site` or a new route, because a connector that fails to start is structurally a driver that never
became one of the rows in that same table, so this is the one page an operator already opens to answer
"is my machine's driver actually running." **An empty list is the healthy state** and renders as a
plain, calm `CircleCheck` confirmation (`connectors.empty`), never an "nothing here" placeholder — a
healthy fleet shows this card empty essentially forever, and a page that looks broken when nothing is
wrong trains operators to ignore it. The `error` string is a factory's own exception message forwarded
**verbatim** — a structural validation message for the two built-in factories today, but the type makes
no promise beyond "readable text" for a future third-party factory, so it is rendered as plain,
untrusted text (React already escapes it — no markup injection is possible) inside a wrapping container
so an unusually long message cannot break the page layout.

**Small doc correction (batch review) — the `id` field is actually the `kind`.** `ConnectorRegistry`
keys purely on the normalized `Kind` (§19.3) — a `connectors.json` entry's OWN `id` field (e.g.
`{"id":"line3-weld","kind":"Modbus"}`) is used only for the per-entry warning naming during config
loading (`ConnectorsConfig.Load`/`ResolveEntries`) and is discarded before `Register` is ever called, so
it never reaches the registry at all. `ConnectorStatusDto`'s `Id` field (`GET /v1/connectors`) is
populated from the registry's own key — i.e. the entry above surfaces as `{"id":"Modbus","error":...}`,
NOT `{"id":"line3-weld",...}`. Kept as documentation rather than a rename: renaming the DTO field would
touch `AssetRegistry.tsx` and every existing test asserting on `Id`/`SlotLabel` naming for a field whose
actual (undocumented) behavior this note now simply makes explicit — a wire-format change is a separate
decision from writing down what the wire format already, honestly, does today.

*(VI: `St4i.EngineApi.Fleet.ConnectorRegistry` thay thế việc hard-code từng loại driver trong `FleetHost`
(trước đây mỗi loại Modbus/OPC-UA có RIÊNG một tham số constructor + một khối `StartLocked` copy-paste).
Giờ: một `ConnectorRegistry` tuỳ chọn, một vòng `foreach` trên `RegisteredIds`. `IConnectorFactory` là
hợp đồng 2 thành viên để một connector có thể được xây dựng theo id — `Kind` và
`TryCreate(config, out driver, out error)`. Ba quy tắc cứng: **PHẢI trả về nhanh và KHÔNG được làm I/O**
(registry được gọi từ TRONG cùng lock `_gate` mà `Estop()` giữ — đây là nơi DUY NHẤT mã bên thứ ba chạy
trong khi lock đó đang giữ); **KHÔNG được throw với config hỏng** — trả `false` kèm `error` đọc được;
`config` là **chuỗi hoàn toàn mờ (opaque)**, registry không bao giờ parse — chọn vậy vì đây đúng là những
gì một file cấu hình do operator viết đã là trên đĩa, VÀ là thứ sẽ phải vượt biên giới tiến trình sidecar
sau này không cần đổi dạng. Nguồn cấu hình: 4 biến môi trường cũ (không đổi) và `connectors.json` (§16.7)
cùng đăng ký vào MỘT `ConnectorRegistry`; biến môi trường luôn thắng khi xung đột cùng loại.

**Hiển thị trên web (GP-7):** `GET /v1/connectors` (§16.7) giờ hiển thị ngay trên `/assets`
(`AssetRegistry.tsx`) — một thẻ nhỏ "Trạng thái connector" phía trên bảng tài sản — đặt ở đây, không phải
`/site` hay route mới, vì một connector khởi động lỗi về bản chất là một driver chưa từng trở thành một
hàng trong CHÍNH bảng đó, nên đây là trang operator đã sẵn mở để trả lời "driver của máy tôi có đang chạy
không." **Danh sách rỗng LÀ trạng thái khoẻ mạnh** và hiển thị như một xác nhận `CircleCheck` bình thản,
không phải như một chỗ trống "không có gì" — một fleet khoẻ mạnh sẽ để thẻ này trống gần như MÃI MÃI, và
một trang trông như hỏng khi chẳng có gì sai sẽ tập cho operator thói quen bỏ qua nó. Chuỗi `error` là
thông báo exception gốc của factory, chuyển nguyên văn — với hai factory có sẵn đây là thông báo validate
cấu trúc, nhưng kiểu dữ liệu không hứa hẹn gì hơn "văn bản đọc được" cho một factory bên thứ ba tương lai,
nên được hiển thị như văn bản KHÔNG ĐÁNG TIN CẬY thuần tuý (React tự động escape — không thể chèn mã) bên
trong một khung bao để một thông báo dài bất thường không phá layout trang.

**Đính chính tài liệu nhỏ (đợt review toàn batch) — trường `id` thực ra là `kind`.** `ConnectorRegistry`
chỉ key theo `Kind` đã chuẩn hoá (§19.3) — trường `id` riêng của một entry `connectors.json` (vd
`{"id":"line3-weld","kind":"Modbus"}`) chỉ dùng để đặt tên cảnh báo lúc load config
(`ConnectorsConfig.Load`/`ResolveEntries`) rồi bị bỏ trước khi `Register` được gọi, nên KHÔNG BAO GIỜ tới
được registry. Trường `Id` của `ConnectorStatusDto` (`GET /v1/connectors`) lấy từ chính KHOÁ của registry
— tức entry trên sẽ hiển thị thành `{"id":"Modbus","error":...}`, KHÔNG PHẢI `{"id":"line3-weld",...}`.
Chọn ghi tài liệu thay vì đổi tên trường: đổi tên DTO sẽ đụng tới `AssetRegistry.tsx` và mọi test đang
assert theo `Id`/`SlotLabel` cho một trường mà hành vi thật (chưa từng ghi rõ) nay chỉ được nói thẳng ra —
đổi định dạng wire là một quyết định khác, tách biệt với việc ghi lại đúng những gì định dạng đó đang thật
sự làm hôm nay.)*

### 19.5 The conformance suite — `St4i.Connector.Conformance` / Bộ kiểm tra tuân thủ connector (GP-6, GP-6b)

**EN** — `src/St4i.Connector.Conformance` (plain `net10.0`, referencing only `St4i.Connector.Abstractions`
+ xunit — **shippable**, deliberately not buried inside a test-internal helper: a third-party driver
author references this project/DLL directly, subclasses `DeviceDriverConformanceSuite`, and runs the
same suite against their own driver before shipping it, without ever referencing `St4i.EdgeCore`/
`St4i.EngineApi`). **9 checks** total: construction is non-blocking + performs no I/O; `Id`/`Kind` are
non-empty and stable; `Health` only takes documented values and is sane with no device; `ReadAsync`
honours cancellation with an unreachable device; `DisposeAsync` is idempotent (three separate scenarios:
never enumerated, after cancellation, after a completed enumeration); no reading-instance reuse/mutation;
and the telemetry JSON round trip (§19.2's last bullet). A reflection-based enforcement test
(`EveryCheckIsWiredOrAcknowledged`) makes a subclass silently skipping a check a **red test**, not an
invisible gap — the AcknowledgedGaps mechanism exists only for a genuine, reported, currently-open
finding, never as a quiet way around an inconvenient check.

**Falsifiability — corrected count (batch review):** only **5 of these 9** are proven — against a
deliberately non-conforming fake driver — to actually fail if their underlying mechanism were removed.
**4 of 9 are not**: `Id`/`Kind` stability (already disclosed below) **plus all three `DisposeAsync`
idempotency checks (never enumerated / after cancellation / after a completed enumeration), which were
NOT previously disclosed anywhere** — not here, not §19.7, not the roadmap backlog; no fake in
`tests/St4i.Connector.Conformance.Tests/Fakes/` targets `DisposeAsync` at all. The opposite error also
happened, in `Health`'s favor: it was UNDERSOLD, not oversold — it has **four** dedicated negative
controls (two proving the device-backed loop body actually executes, one proving its `sawConnected`
mechanism is independently load-bearing against a purely-transient violation, one proving the
device-less branch's assertion is falsifiable); only its narrow `Enum.IsDefined` baseline has no
dedicated control.

**Applied to four of this codebase's `IDeviceDriver` implementations** — `SimulatedDriver`,
`ModbusTcpDriver`, `OpcUaDriver`, `HotFolderAoiDriver` (every driver `Program.cs` actually wires into a
running host) — **all pass, with no acknowledged gaps remaining** as of this writing (the two gaps below
closed by GP-6b). Along the way, the suite found the two real production defects §16.4/§16.6 describe —
its entire reason for existing, delivered.

**Coverage gaps, honestly recorded (not silently missing):**
- **`Waveforms`** is exercised by no real driver's output today — nothing currently shipping populates a
  `DeviceReading.Waveforms` entry, so the round-trip check has never actually compared one.
- **4 of the 9 checks have no dedicated negative-control fake** — every other check is proven to fail
  against a deliberately broken driver; these four are exercised only against conforming drivers:
  `Id`/`Kind` stability, and all **three `DisposeAsync` idempotency checks** (never enumerated, after
  cancellation, after a completed enumeration) — the latter three were not previously disclosed anywhere
  in this document. `Health`'s baseline, by contrast, is the ONE narrow exception that has no control —
  `Health` overall is otherwise the best-covered check here (four dedicated negative controls; see §19.5's
  falsifiability paragraph above).
- **Two of the six `IDeviceDriver` implementations in this repo are not under conformance test at all:**
  `MqttDriver` (§6.2 — proven only via the test suite; `Program.cs` never wires it into a running host
  today) and, more significantly, **`ScenarioAwareDriver`** — the wrapper `FleetHost` actually installs
  in the simulated-fleet slot (`FleetHost.cs`), not `SimulatedDriver` directly.

*(VI: `src/St4i.Connector.Conformance` (`net10.0` thuần, chỉ tham chiếu `St4i.Connector.Abstractions` +
xunit — **CÓ THỂ ĐÓNG GÓI ĐỘC LẬP**, cố ý không giấu trong helper nội bộ test: tác giả driver bên thứ ba
tham chiếu thẳng project/DLL này, kế thừa `DeviceDriverConformanceSuite`, chạy CÙNG bộ kiểm tra với driver
của họ trước khi ship, không cần tham chiếu `St4i.EdgeCore`/`St4i.EngineApi`). **9 bài kiểm tra** tổng
cộng: khởi tạo không chặn + không I/O; `Id`/`Kind` không rỗng và ổn định; `Health` chỉ nhận giá trị đã tài
liệu hoá và hợp lý khi không có thiết bị; `ReadAsync` tôn trọng huỷ khi thiết bị không tiếp cận được;
`DisposeAsync` idempotent (3 kịch bản: chưa enumerate, sau khi huỷ, sau khi enumerate xong); không tái sử
dụng/sửa instance reading; và round-trip JSON telemetry. Một test enforcement bằng reflection
(`EveryCheckIsWiredOrAcknowledged`) khiến việc một lớp con âm thầm bỏ qua một bài kiểm tra trở thành
**test ĐỎ**, không phải lỗ hổng vô hình — cơ chế AcknowledgedGaps chỉ dùng cho một phát hiện THẬT, đang
mở, đã báo cáo, không phải cách lách một bài kiểm tra bất tiện.

**Khả năng chứng minh sai (falsifiability) — đếm lại cho đúng (đợt review toàn batch):** chỉ **5 trong 9**
bài được chứng minh — bằng một driver giả cố ý KHÔNG tuân thủ — là sẽ THẬT SỰ fail nếu cơ chế nó kiểm tra
bị gỡ bỏ. **4 trong 9 thì KHÔNG**: độ ổn định `Id`/`Kind` (đã ghi ở dưới) **cộng với cả BA bài kiểm tra
idempotent của `DisposeAsync`** (chưa enumerate / sau khi huỷ / sau khi enumerate xong) — ba bài sau
TRƯỚC ĐÂY CHƯA từng được ghi ở bất kỳ đâu trong tài liệu này. Chiều ngược lại cũng có lỗi, nhưng theo
hướng có lợi cho `Health`: nó bị ĐÁNH GIÁ THẤP, không phải thổi phồng — `Health` có **bốn** negative-control
riêng (hai bài chứng minh vòng lặp device-backed thật sự chạy, một bài chứng minh cơ chế `sawConnected`
độc lập có tác dụng trước vi phạm thoáng qua, một bài chứng minh nhánh device-less có thể chứng minh sai
được); chỉ có baseline `Enum.IsDefined` của nó là chưa có kiểm-chứng-âm riêng.

**Áp dụng cho 4 trong số các implementation `IDeviceDriver` của codebase này** — `SimulatedDriver`,
`ModbusTcpDriver`, `OpcUaDriver`, `HotFolderAoiDriver` (mọi driver mà `Program.cs` THẬT SỰ nối dây vào một
host đang chạy) — **tất cả đều pass, không còn gap nào được ghi nhận** tại thời điểm viết tài liệu này (2
gap dưới đây đã đóng bởi GP-6b). Trong quá trình đó, bộ kiểm tra tìm ra đúng 2 lỗi sản xuất THẬT mà
§16.4/§16.6 mô tả — chính là lý do nó tồn tại, đã giao đúng giá trị.

**Khoảng trống coverage, ghi nhận trung thực (không giấu):**
- **`Waveforms`** hiện không được bất kỳ driver thật nào populate — chưa có gì đang chạy sản xuất tạo ra
  một entry `DeviceReading.Waveforms`, nên bài kiểm tra round-trip chưa từng thực sự so sánh nó.
- **4 trong 9 bài kiểm tra chưa có fake kiểm-chứng-âm (negative-control) riêng** — mọi bài khác đều đã
  chứng minh fail với driver cố ý hỏng; bốn bài này mới chỉ chạy qua driver tuân thủ: độ ổn định
  `Id`/`Kind`, và cả **ba bài kiểm tra idempotent của `DisposeAsync`** (chưa enumerate, sau khi huỷ, sau
  khi enumerate xong) — ba bài sau trước đây chưa từng được ghi ở bất kỳ đâu trong tài liệu này. Baseline
  của `Health` là NGOẠI LỆ hẹp duy nhất chưa có kiểm-chứng-âm — nhìn chung `Health` là bài được phủ tốt
  nhất ở đây (bốn negative-control riêng; xem đoạn falsifiability của §19.5 phía trên).
- **Hai trong số sáu implementation `IDeviceDriver` của repo này CHƯA nằm dưới conformance test:**
  `MqttDriver` (§6.2 — chỉ được chứng minh qua bộ test, `Program.cs` chưa bao giờ nối dây nó vào một host
  đang chạy) và, đáng chú ý hơn, **`ScenarioAwareDriver`** — wrapper mà `FleetHost` THẬT SỰ lắp vào slot
  fleet mô phỏng (`FleetHost.cs`), không phải `SimulatedDriver` trực tiếp.)*

### 19.6 The two driver reliability fixes, in one place / Hai lỗi độ tin cậy đã sửa, gom một chỗ (GP-6b)

**EN** — Both found by §19.5's suite, both genuinely user-visible (not internal cleanup) — see §16.4/
§16.6 for the full narrative. Tunables, in one table:

| Driver | What was unbounded before | Fix | New default |
|---|---|---|---|
| `ModbusTcpDriver` | `Transport.ReadTimeout`/`WriteTimeout` = `-1` (infinite); NModbus has no cancellable read overload at all | Bound both timeouts; cap retries; cancel via `ct.Register(DisposeConnection)` | `Math.Max(1000ms, pollIntervalMs × 4)`, `Retries=1` — derived from the register map by default; **Task 9: `readTimeoutMs`/`retries` register-map fields now override either directly** (no new env var), see §16.4's plant-rollout follow-up |
| `OpcUaDriver` | `CoreClientUtils.SelectEndpoint` — synchronous, uncancellable | Switch to `SelectEndpointAsync`, same bound, now cancellable | `TransportQuotas.OperationTimeout = 15000ms` — hardcoded, still not configurable |

Neither fix added a new environment variable. Modbus's bound started fully automatic/derived and, per
Task 9, gained two optional register-map fields to override it directly (no env var either) once the
derived-only version turned out to be its own rollout hazard for gateway-fronted slaves (§16.4); OPC-UA's
remains a hardcoded constant that only became cancellable, not configurable.

*(VI: Cả hai đều do bộ kiểm tra §19.5 tìm ra, cả hai đều THẬT SỰ ảnh hưởng người dùng (không phải dọn dẹp
nội bộ) — xem §16.4/§16.6 để đọc đầy đủ câu chuyện. Bảng tunable, gom một chỗ:

| Driver | Trước đây không có giới hạn | Cách sửa | Giá trị mặc định mới |
|---|---|---|---|
| `ModbusTcpDriver` | `ReadTimeout`/`WriteTimeout` = `-1` (vô hạn); NModbus không có overload đọc huỷ được | Chặn cả hai timeout; giới hạn retry; huỷ qua `ct.Register(DisposeConnection)` | `Math.Max(1000ms, pollIntervalMs × 4)`, `Retries=1` — mặc định suy ra từ register map; **Task 9: hai trường `readTimeoutMs`/`retries` trong register map nay ghi đè trực tiếp được** (không thêm biến môi trường), xem follow-up rollout ở §16.4 |
| `OpcUaDriver` | `CoreClientUtils.SelectEndpoint` — đồng bộ, không huỷ được | Chuyển sang `SelectEndpointAsync`, cùng giới hạn, giờ huỷ được | `TransportQuotas.OperationTimeout = 15000ms` — hardcode, vẫn chưa cấu hình được |

Không bản sửa nào thêm biến môi trường. Ngưỡng của Modbus ban đầu hoàn toàn tự động/suy ra và, theo Task 9,
có thêm hai trường tuỳ chọn trong register map để ghi đè trực tiếp (cũng không thêm biến môi trường) khi
bản chỉ-suy-ra tự nó lộ ra là một rủi ro rollout cho các slave sau gateway (§16.4); OPC-UA vẫn là hằng số
hardcode chỉ mới huỷ được, chưa cấu hình được.)*

### 19.7 🔴 Honest limitations — the seam, not the plugin system / Giới hạn trung thực — mới là nền tảng, CHƯA phải hệ plugin

**EN** — Written down plainly, not softened:

- **The isolation model is a sidecar, and it is not built.** Nothing loads external code today; the
  registry is populated in-process by the host itself. The contract was deliberately designed to be
  IPC-safe now (the lossless JSON round trip, §19.2) so a sidecar can arrive later without breaking it —
  but no sidecar, loader, or process boundary exists yet.
- **`connectors.json` cannot yet onboard an arbitrary third party.** It dispatches only to Modbus and
  OPC-UA (`Program.cs`'s own dispatch `switch`), because no plugin-loading mechanism exists. Its
  practical value today is "configure Modbus/OPC-UA without the two `*_ENABLED` environment variables" —
  **not** "add a connector by configuration alone." **Correction (batch review): "the two environment
  variables" understates it** — `ST4I_MODBUS_HOST`/`ST4I_MODBUS_PORT`/`ST4I_OPCUA_PKI_DIR` still come
  from the environment regardless of whether a connector was configured via the two `*_ENABLED` vars or
  via `connectors.json`: `Program.cs` builds ONE `ModbusConnectorFactory`/`OpcUaConnectorFactory` per kind
  from `ModbusOptions`/`OpcUaOptions` (both `FromEnvironment()`-sourced) and reuses that same instance for
  BOTH the env-var path and any `connectors.json` entry of the same kind — only the register/node MAP
  (`settings`) is genuinely swappable via `connectors.json` today.
- **The `id`/`kind` split has no functional effect today** — the registry is one-factory-per-kind, and
  `id` is used only for log/slot-label naming (see §19.4's own doc correction: `GET /v1/connectors`'
  `id` field is actually the registry key — the normalized `kind` — not a `connectors.json` entry's own
  `id`, which is discarded after config loading).
- **A known hazard for whoever builds the loader:** the simulated-fleet carve-out means a connector
  registered under a **built-in** id (notably `Simulated`) could re-open a double-drive path where two
  pipelines write the same machine and corrupt cycle counts. **Unreachable today** — no dispatch path
  registers arbitrary ids — **but it goes live the moment a plugin loader exists**, and that loader
  **must reject third-party registration under any built-in id.**
- **A second, narrower hazard for the same future loader (batch review, fix 1):** a cancellation callback
  a third-party driver registers on the token `ReadAsync` receives (`CancellationToken.Register`, per
  `IDeviceDriver.ReadAsync`'s own doc comment) runs SYNCHRONOUSLY, on the halt (`Estop()`) caller's
  thread, while `FleetHost` holds `_gate` — `FleetHost.StopLocked` now catches a THROWING callback
  per-slot so it can never abort the `EstopEngaged` latch or any sibling slot's cancellation, but a
  callback that is merely SLOW (never throws) still stalls that same halt transition for as long as it
  runs; there is no independent timeout around the callback itself.
- **Conformance coverage gaps** (repeated from §19.5 for visibility here, corrected count — batch review):
  `Waveforms` is exercised by no real driver's output; 4 of the suite's 9 checks have no dedicated
  negative control (`Id`/`Kind` stability, plus all three `DisposeAsync` idempotency checks — `Health`'s
  own baseline is the only part of THAT check without one, `Health` overall being the best-covered check
  here); the `ModelsExternalDeviceConnection = false` escape hatch (used by
  `HotFolderAoiDriverConformanceTests`) guts not one but TWO checks — Health, and the second assertion of
  `Check_Construction_IsNonBlocking_AndPerformsNoIO` — and lets a REAL, known violation through silently:
  `HotFolderAoiDriver`'s constructor calls `Directory.CreateDirectory` three times and constructs a
  `FileSystemWatcher`, a direct violation of `IDeviceDriver`'s own "construction performs no I/O" rule
  (deliberately not fixed here — a separate decision, and this driver is only ever constructed off
  `FleetHost`'s `_gate` today, unlike Modbus/OPC-UA); and `ScenarioAwareDriver` — the wrapper `FleetHost`
  actually installs in the simulated slot — is not itself under conformance test.
- **The contract assembly is not published to NuGet** — a third party references it from source today.
- **Not started:** `plugin.yaml`/SemVer `apiVersion`/`configSchema`-driven UI/plugin signing.

*(VI: Ghi rõ ràng, không mềm hoá: **Mô hình cô lập là sidecar, và CHƯA được xây.** Hôm nay không có mã
ngoài nào được nạp; registry được host tự đăng ký trong-tiến-trình. Hợp đồng được thiết kế CỐ Ý an toàn
IPC ngay từ bây giờ (round-trip JSON lossless, §19.2) để sidecar có thể đến sau mà không phá vỡ nó — nhưng
CHƯA có sidecar, loader, hay ranh giới tiến trình nào tồn tại. **`connectors.json` CHƯA thể onboard một
bên thứ ba bất kỳ.** Nó chỉ dispatch được tới Modbus và OPC-UA (switch dispatch của chính `Program.cs`),
vì chưa có cơ chế nạp plugin. Giá trị thực tế hôm nay là "cấu hình Modbus/OPC-UA mà không cần 2 biến môi
trường `*_ENABLED`" — KHÔNG PHẢI "thêm connector chỉ bằng cấu hình." **Đính chính (đợt review toàn
batch): "2 biến môi trường" nói giảm** — `ST4I_MODBUS_HOST`/`ST4I_MODBUS_PORT`/`ST4I_OPCUA_PKI_DIR` vẫn
lấy từ môi trường bất kể connector được cấu hình qua 2 biến `*_ENABLED` hay qua `connectors.json`:
`Program.cs` dựng ĐÚNG MỘT `ModbusConnectorFactory`/`OpcUaConnectorFactory` cho mỗi loại từ
`ModbusOptions`/`OpcUaOptions` (đều lấy từ `FromEnvironment()`) và dùng lại CHÍNH instance đó cho cả
đường env-var lẫn mọi entry `connectors.json` cùng loại — chỉ riêng MAP thanh ghi/node (`settings`) mới
thực sự thay được qua `connectors.json` hôm nay. **Việc tách `id`/`kind` CHƯA có tác dụng chức
năng nào hôm nay** — registry là một-factory-một-kind, `id` chỉ dùng để đặt tên log/slot (xem đính chính ở
§19.4: trường `id` của `GET /v1/connectors` thực ra là khoá registry — `kind` đã chuẩn hoá — không phải
`id` riêng của entry `connectors.json`, vốn đã bị bỏ sau khi load config). **Một rủi ro đã
biết cho ai xây loader sau này:** carve-out cho simulated-fleet nghĩa là một connector đăng ký dưới một id
**có sẵn** (đặc biệt `Simulated`) có thể MỞ LẠI đường double-drive khiến hai pipeline cùng ghi một máy và
làm hỏng số đếm chu kỳ. **KHÔNG THỂ xảy ra hôm nay** — không có đường dispatch nào đăng ký id tuỳ ý — **NHƯNG
sẽ trở thành THẬT ngay khi có plugin loader**, và loader đó **PHẢI từ chối đăng ký bên thứ ba dưới bất kỳ id
có sẵn nào.** **Rủi ro thứ hai, hẹp hơn, cho cùng loader tương lai (đợt review, fix 1):** một callback
huỷ mà driver bên thứ ba đăng ký trên token `ReadAsync` nhận được chạy ĐỒNG BỘ, trên thread gọi lệnh
ngừng (`Estop()`), trong khi `FleetHost` giữ `_gate` — `FleetHost.StopLocked` nay bắt callback THROW theo
từng slot để không bao giờ chặn được latch `EstopEngaged` hay việc huỷ các slot khác, nhưng một callback
chỉ CHẬM (không throw) vẫn làm chậm chính giao dịch ngừng đó; chưa có timeout riêng cho bản thân callback.
**Khoảng trống coverage conformance** (nhắc lại từ §19.5 để dễ thấy ở đây, đã đếm lại cho đúng — đợt
review toàn batch): `Waveforms` chưa được driver thật nào populate; 4 trong 9 bài kiểm tra của bộ suite
chưa có negative-control riêng (độ ổn định `Id`/`Kind`, cộng cả ba bài idempotent của `DisposeAsync` —
baseline của `Health` là phần DUY NHẤT của bài đó chưa có, `Health` nhìn chung là bài được phủ tốt nhất ở
đây); cờ thoát hiểm `ModelsExternalDeviceConnection = false` (dùng bởi
`HotFolderAoiDriverConformanceTests`) làm mất tác dụng không chỉ MỘT mà HAI bài kiểm tra — Health, và
assertion thứ hai của `Check_Construction_IsNonBlocking_AndPerformsNoIO` — và để lọt một vi phạm THẬT, đã
biết, một cách im lặng: constructor của `HotFolderAoiDriver` gọi `Directory.CreateDirectory` ba lần và
dựng một `FileSystemWatcher`, vi phạm trực tiếp quy tắc "constructor không I/O" của chính `IDeviceDriver`
(cố ý CHƯA sửa ở đây — một quyết định khác, và driver này hôm nay chỉ được dựng ngoài `_gate` của
`FleetHost`, không giống Modbus/OPC-UA); và `ScenarioAwareDriver` — wrapper `FleetHost` THẬT SỰ lắp vào
slot mô phỏng — CHƯA tự nó nằm dưới conformance test. **Assembly hợp đồng chưa publish lên NuGet** — bên
thứ ba hiện tham chiếu từ mã nguồn. **Chưa bắt
đầu:** `plugin.yaml`/SemVer `apiVersion`/UI sinh từ `configSchema`/ký số plugin.)*

---

## 20. Đợt A (SM-1–SM-6) — single-machine sellability: empty default roster, `/connectors`, data provenance, standalone / Đợt A — máy độc lập bán được thật

**EN** — An audit done for a *different* reason (helping a user recover a login — see §20-item on
the Playwright leak below) found that, despite Giai đoạn 1–3 above being marked "done" feature by
feature, this product **could not actually be sold to a customer buying it for one real machine**:
the shipped default was still the fabricated 11/8-machine demo fleet on both hosts, that fabricated
data could silently blend into customer-facing numbers, a full-page "Connect ecosystem" form blocked
Dashboard/Machines until an ecosystem was configured, the HALT control was still named and drawn like
an emergency stop, and there was no way in the product itself to add a real machine. Six tasks
(SM-1 → SM-6) closed this. This section documents what actually shipped — **including, plainly, what
did not.**

### 20.1 From a fresh install to a running real machine / Từ cài mới tới máy thật đang chạy

**EN** — **The product default is now an empty roster, in both hosts.** `St4i.EngineApi`
(`DemoModeGate`, `St4i.EdgeCore.Config` — shared by both hosts since SM-1b) boots **Live** with
**zero machines** unless `ST4I_DEMO_ENABLED` is set (§13.5); `St4i.EdgeService`'s `EdgeWorker.LoadFleet`
returns an **empty roster**, never the built-in 8-machine fallback, in product mode (§9). The
fabricated fleet (`fleet.json`, 11 machines, `"driverKind": "simulated"` throughout — §10) now loads
**only** under `ST4I_DEMO_ENABLED=true` — it is demo/exhibition-only in both hosts, never a silent
product-mode substitute.

A customer's actual path, first launch to first real reading:
1. Double-click `St4i.DesktopShell.exe` (no flag, no launcher — §13.5). Dashboard/Machines render in
   full immediately, roster empty, no crash, no blocking screen (§20.4).
2. Sign in (first-run bootstrap creates the initial Admin account — §14.1) and open **`/connectors`**
   (Engineer+) — §20.2 below.
3. Pick Modbus TCP or OPC-UA, enter the connection settings, paste/upload the register/node-map JSON,
   click **Test connection**, then **Save**. The machine appears in the fleet roster — live, if the
   fleet was already running (§20.2's own "applies live vs. next Stop/Start" distinction).
4. Optionally connect a Site/ecosystem server (`Settings` → *Server connection*, or the collapsed
   **Ecosystem** widget on Dashboard — §20.4) — entirely optional; a customer who never does this has
   a complete, supported product, not an unfinished one.

The **WPF kiosk packaging** (`St4iMachineSimulator`, the original exhibition-booth app —
distinct from `St4i.EngineApi`/`St4i.DesktopShell`, the sellable product line above) is **unaffected
by this batch** and still auto-loads `fleet.json` next to its own exe by long-standing convention
(§10) — that packaging was never claimed to be "sold to a customer for one real machine" the way
`St4i.EngineApi`/`DesktopShell` now explicitly is.

*(VI: **Đội hình mặc định nay RỖNG, ở cả hai host.** `St4i.EngineApi` (`DemoModeGate`, dùng chung qua
`St4i.EdgeCore.Config`) vào **Live** với **0 máy** trừ khi bật `ST4I_DEMO_ENABLED` (§13.5);
`St4i.EdgeService`'s `LoadFleet` trả về **đội hình rỗng**, KHÔNG bao giờ rơi về 8 máy mặc định trong
chế độ sản phẩm (§9). Đội hình fabricated (`fleet.json`, 11 máy, toàn bộ `"driverKind": "simulated"`)
nay chỉ tải khi `ST4I_DEMO_ENABLED=true` — demo/triển lãm mà thôi, ở cả hai host. Đường đi thực tế của
khách: (1) bấm thẳng `.exe`, không cờ — Dashboard/Machines hiện đầy đủ ngay, đội hình rỗng, không
crash, không màn chặn; (2) đăng nhập, mở `/connectors`; (3) chọn Modbus/OPC-UA, nhập cấu hình, dán/tải
JSON map, bấm Test rồi Save — máy xuất hiện trong đội hình; (4) tuỳ chọn kết nối Site/hệ sinh thái, không
bắt buộc. **Gói kiosk WPF** (`St4iMachineSimulator`) KHÔNG bị đợt này ảnh hưởng, vẫn tự tải `fleet.json`
cạnh exe như quy ước cũ — gói đó chưa từng được tuyên bố "bán cho khách chỉ 1 máy thật" như
`St4i.EngineApi`/`DesktopShell` nay đã là.)*

### 20.2 Adding a real machine — the `/connectors` page / Thêm máy thật — trang `/connectors`

**EN** — SM-5 added the write path `/onboarding` never was. `routes/Connectors.tsx` (Engineer+ for
the add-connector form and Remove button; Operator can view the configured list) talks to four new
routes on `ConnectorEndpoints.cs`:

| Route | Role | What it does |
|---|---|---|
| `GET /v1/connectors/configured` | Operator | Every persisted connector configuration, **without** its register/node-map JSON (which may embed an OPC-UA username/password — never even `SELECT`ed by this projection's SQL). |
| `POST /v1/connectors` | Engineer, audited `connector.save` | Validates, persists (`ConnectorConfigStore`), registers the factory live, and seeds the roster via `FleetHost.RegisterMachine`. |
| `DELETE /v1/connectors/{kind}` | Engineer, audited `connector.delete` | Removes **only the persisted row** — see the honest-limitations note below. |
| `POST /v1/connectors/test` | Engineer, **not audited** (mutates nothing) | Builds a throwaway driver, attempts one bounded read, reports reachable or not — never registered, never touches the running fleet. |

**Only Modbus TCP and OPC-UA are offered** — the two protocols this build has a working driver for
(§20.5). **The "map JSON"** is the exact same shape the `ST4I_MODBUS_MAP`/`ST4I_OPCUA_MAP` environment
variables already used: for Modbus, `{ machineCode, unitId, pollIntervalMs, registers: [{ address,
type, dataType, scale, metric, unit?, writable? }], commands?: [...] }` (`ModbusRegisterMap.cs`); for
OPC-UA, `{ machineCode, endpointUrl, securityMode, username?, password?, pollIntervalMs, nodes: [{
nodeId, metric, unit?, writable? }], commands?: [...] }` (`OpcUaNodeMap.cs`) — `writable`/`commands` are
Task B-3's declarative write/command capability (§16.4/§16.6 have the full field-level writeup); every
map that omits both parses and behaves exactly as it always has. It is entered by pasting or uploading a
`.json` file into a plain `<textarea>` — **there is no visual/graphical map builder** (§20.5).

**Task B-3 — the deliberate-save gate.** A map that declares ANY writable point or command cannot be
saved on a bare `POST /v1/connectors`: the request also needs `confirmedWriteCapabilityFingerprint`, a
value only obtainable by having already seen what this EXACT map grants (mirrors `POST
/v1/site/identity/rotate`'s own current-fingerprint echo, §12). Omitted/blank → `400`, naming every
writable point/command this map would grant and the fingerprint required to confirm; present but not
matching what the map currently declares (e.g. the JSON was edited after the fingerprint was copied) →
`409`. A map declaring neither never needs this field at all — every existing map, and every map an
operator pastes without ever touching `writable`/`commands`, saves exactly as before. The response's
`writeCapability` field (deliberately its first field) always reports what was just granted, even
`{ grantsWriteCapability: false, writablePoints: [], commands: [], fingerprint: null }` for a plain
read-only save — never a field the caller has to know to go looking for. Commands are not setpoints: B-6
gates them at a stricter RBAC role, using this SAME structural split (a `commands` entry vs. a register/
node's own `writable`) rather than inspecting any name.

**A fresh add applies live; re-saving an existing one does not.** `FleetHost.RegisterMachine` only
ever **adds** — it has no "unregister"/"update in place." So `POST /v1/connectors` for a **new**
machine code registers it into the running fleet immediately (restarting the pipeline if it was
already running). Re-submitting the **same** machine code updates the persisted row and the
`ConnectorRegistry` factory, but the already-running roster entry is untouched until the next
Stop/Start or a full restart — the API's own response (`ConnectorCreateResultDto.AppliedLive`) and
the UI toast say this plainly rather than implying an instant update that didn't happen. Symmetrically,
**`DELETE`** only removes the persisted configuration row; a machine already in the roster (or a
connector of that kind currently running) keeps running until the process is fully restarted — there
is no live "unregister" path either.

*(VI: SM-5 thêm đường ghi mà `/onboarding` chưa từng có. `routes/Connectors.tsx` (form thêm + nút Remove
yêu cầu Engineer+; xem danh sách là Operator) gọi 4 route mới trên `ConnectorEndpoints.cs`:
`GET /v1/connectors/configured` (Operator, không kèm JSON map vì có thể chứa mật khẩu OPC-UA),
`POST /v1/connectors` (Engineer, có audit `connector.save` — validate, lưu, đăng ký factory sống, và
gieo vào đội hình qua `RegisterMachine`), `DELETE /v1/connectors/{kind}` (Engineer, audit
`connector.delete` — CHỈ xoá dòng đã lưu), `POST /v1/connectors/test` (Engineer, KHÔNG audit vì không
đổi gì — dựng driver dùng-một-lần, thử đọc có giới hạn thời gian). **Chỉ Modbus TCP và OPC-UA** được
chọn — 2 giao thức build này có driver thật. **"JSON map"** đúng y hệt shape 2 biến môi trường
`ST4I_MODBUS_MAP`/`ST4I_OPCUA_MAP` đã dùng, nhập bằng cách dán/tải file `.json` vào một `<textarea>`
thường — **CHƯA có bộ dựng map trực quan/đồ hoạ**. **Thêm máy MỚI áp dụng sống ngay; lưu lại một máy ĐÃ
CÓ thì KHÔNG** — `RegisterMachine` chỉ biết THÊM, không "gỡ đăng ký"/"cập nhật tại chỗ", nên máy mới vào
đội hình ngay (khởi động lại pipeline nếu đang chạy), còn lưu lại cùng mã máy chỉ cập nhật cấu hình đã
lưu + factory registry — đội hình ĐANG CHẠY giữ nguyên tới lần Dừng/Chạy kế tiếp hoặc khởi động lại toàn
bộ tiến trình; phản hồi API + toast nói rõ điều này. Tương tự, `DELETE` chỉ xoá dòng đã lưu — máy đang
chạy (hoặc connector loại đó đang chạy) vẫn tiếp tục chạy tới khi tiến trình khởi động lại hoàn toàn.)*

### 20.3 Data provenance — fabricated data never blends into customer-facing numbers / Nguồn gốc dữ liệu — dữ liệu giả KHÔNG BAO GIỜ trộn

**EN** — SM-2 added a nullable `is_fabricated` column to the historian schema (migration v2,
`SqliteHistorianStore.cs`), set once at write time (`DriverKinds.IsFabricated`, keyed off the writing
machine's `driverKind`) and never re-derived later. Every customer-facing historian/OEE/genealogy query
(`ApplyRealPresenceGateAsync`) applies one rule GIVEN the caller's own `includeFabricated` boolean:
**if `false`, an explicitly-fabricated row (`is_fabricated = 1`) is EXCLUDED, full stop** — there is no
scope in which a demo/simulated cycle is allowed to blend into a customer's pass-rate, OEE, or
genealogy numbers by default. A **`null`** row — one written before this column existed — is labelled
**"Unknown origin"** and is let through **only if no explicitly-real row exists in that same query's
scope**; the moment a real (`is_fabricated = 0`) row is present, Unknown rows are excluded too (a
documented, accepted residual: a genuinely-real pre-migration row would vanish from a report alongside
the fabricated ones it can no longer be told apart from — accepted because no shipped customer's data
predates this migration). Live fleet KPIs follow the same spirit via `FleetKpisDto.HasMixedProvenance`:
once a real machine is present, the Dashboard's own KPI tiles count **only** that real machine, with a
banner explaining fabricated machines running alongside are excluded, not blended in.

**Who decides that boolean — the Đợt A fix (task-7, whole-batch review, CRITICAL) this section now
documents.** `HistorianEndpoints` used to hardcode `includeFabricated ?? false` on every route with no
carve-out at all, and no web route ever sent `includeFabricated=true` — so on an exhibition/demo
install (`DemoModeGate.Enabled`, where the ENTIRE roster is `Simulated`) the gate excluded **every**
row, permanently: a fresh demo `historian.db` produced ZERO default-visible rows, so `/historian` and
`/reports` rendered nothing, the PDF export was an empty shell, and genealogy was empty — on the exact
packaging line the product's own opening brief describes. Fixed by resolving `includeFabricated` through
`HistorianEndpoints.ResolveIncludeFabricated`: `false` (a real customer's product install — the shipped
default, `DemoModeGate` disabled) reproduces the untouched rule above byte-for-byte; `true`
(`DemoModeGate.Enabled`, an exhibition/demo-flagged deployment ONLY) flips the default so that
deployment's own fabricated rows render instead of vanishing.

**The `ProvenanceTag` badge** (`HistorianResultsTable.tsx`, reused by the genealogy dialog) renders
next to every row's verdict: **"Demo"** for `isFabricated === true`, **"Unknown origin"** for `null`/
`undefined`, nothing for a real (`false`) row. **On a real customer's product install** (`DemoModeGate`
disabled, the shipped default), the **"Demo"** badge still cannot render — there is no path to a
fabricated row at all on that deployment (an empty or real-only roster never writes `is_fabricated = 1`
in the first place), so what a customer's own screen can show is either nothing (a real row) or
**"Unknown origin"** (a rare, pre-migration-only case), exactly as before. **On an exhibition/demo
install**, the **"Demo"** badge now DOES render — deliberately: that deployment's whole roster is
fabricated by design (§20.1/§2.5), and the fix above is what lets its own Historian/Reports screens show
anything at all instead of a permanently-empty product.

*(VI: SM-2 thêm cột `is_fabricated` (nullable) vào schema historian, gán MỘT LẦN lúc ghi (theo
`driverKind` của máy), không bao giờ tính lại sau đó. Mọi truy vấn historian/OEE/genealogy khách hàng
(`ApplyRealPresenceGateAsync`) áp một luật DỰA TRÊN cờ `includeFabricated` của bên gọi: **nếu `false`,
dòng fabricated tường minh (`is_fabricated = 1`) bị LOẠI** — không có phạm vi nào cho phép một chu kỳ
demo/mô phỏng trộn vào tỷ lệ đạt/OEE/genealogy của khách theo mặc định. Dòng **`null`** (ghi trước khi
có cột này) được gắn nhãn **"Không rõ nguồn gốc"** và chỉ lọt qua NẾU không có dòng thật tường minh nào
trong cùng phạm vi truy vấn đó — hễ có dòng thật, dòng Unknown cũng bị loại (giới hạn đã biết, chấp
nhận được vì chưa khách hàng nào có dữ liệu từ trước migration này). KPI đội hình sống theo cùng tinh
thần qua `FleetKpisDto.HasMixedProvenance`: khi có máy thật, các thẻ KPI Dashboard chỉ đếm máy thật, kèm
banner giải thích máy demo chạy song song bị LOẠI, không trộn.

**Ai quyết định cờ đó — bản sửa Đợt A (task-7, review toàn batch, CRITICAL) mục này nay ghi lại.**
`HistorianEndpoints` từng gán cứng `includeFabricated ?? false` ở mọi route, không hề có ngoại lệ, và
không route web nào từng gửi `includeFabricated=true` — nên trên bản triển lãm/demo (`DemoModeGate.Enabled`,
đội hình 100% `Simulated`) cổng này loại TOÀN BỘ dòng, vĩnh viễn: một `historian.db` demo mới tinh
không bao giờ cho ra dòng nào hiện mặc định, nên `/historian`/`/reports` trống trơn, PDF xuất ra rỗng,
genealogy cũng rỗng — đúng trên chính dòng đóng gói mà bản tóm tắt sản phẩm này mô tả. Đã sửa bằng cách
giải quyết `includeFabricated` qua `HistorianEndpoints.ResolveIncludeFabricated`: `false` (bản cài đặt
sản phẩm thật của khách — mặc định khi giao, `DemoModeGate` tắt) tái tạo đúng luật trên, không đổi gì;
`true` (`DemoModeGate.Enabled`, CHỈ bản triển lãm/demo) đổi mặc định để dòng fabricated của riêng bản đó
hiện ra thay vì biến mất.

**`ProvenanceTag`** hiện cạnh mỗi verdict: **"Demo"** khi `isFabricated === true`, **"Không rõ nguồn
gốc"** khi `null`/`undefined`, không hiện gì khi thật. **Trên bản cài đặt sản phẩm thật của khách**
(`DemoModeGate` tắt, mặc định khi giao), nhãn **"Demo"** vẫn KHÔNG THỂ hiện — không có đường nào dẫn tới
dòng fabricated trên bản đó cả (đội hình rỗng hoặc toàn máy thật không bao giờ ghi `is_fabricated = 1`),
nên màn của khách chỉ có thể hiện KHÔNG GÌ (dòng thật) hoặc **"Không rõ nguồn gốc"** (hiếm, chỉ dữ liệu
trước migration), y như trước. **Trên bản triển lãm/demo**, nhãn **"Demo"** NAY hiện ra — có chủ đích:
đội hình bản đó vốn 100% fabricated theo thiết kế (§20.1/§2.5), và bản sửa trên là thứ giúp màn
Historian/Reports của chính bản đó hiện được gì đó thay vì một sản phẩm trống rỗng vĩnh viễn.)*

### 20.4 Standalone is a supported state / Standalone là trạng thái được hỗ trợ

**EN** — Before SM-3, `needsConnect: boolean` drove a full-page "Connect ecosystem" form that
**replaced** Dashboard/Machines' entire content whenever no ecosystem server was reachable — a
customer who genuinely never intends to connect one (a legitimate, complete way to own this product)
saw a permanent, nagging blocking screen. SM-3 replaced the boolean with a named
`EcosystemConnectionState.status` — `"standalone" | "testing" | "connected" | "failed"` — and moved
the connect/diagnose form into `EcosystemStatusWidget`: a small, **collapsed-by-default** disclosure
on Dashboard/Machines (Live mode only — Demo's fabricated fleet has nothing to connect to, so the
widget doesn't render there at all) carrying a status badge in its own header. **`"standalone"` reads
as a calm, neutral badge — never a warning** — and stays collapsed; the widget auto-expands only when
`status === "failed"` (a real, diagnosable problem). §13.5 above is this widget's own product-vs-
exhibition packaging story.

*(VI: Trước SM-3, `needsConnect: boolean` điều khiển một FORM CHẶN TOÀN TRANG "Kết nối hệ sinh thái",
thay thế TOÀN BỘ nội dung Dashboard/Machines khi chưa có server hệ sinh thái — một khách hàng THẬT SỰ
không bao giờ định kết nối (một cách sở hữu sản phẩm hợp lệ, đầy đủ) sẽ thấy màn chặn nag vĩnh viễn.
SM-3 thay boolean bằng `EcosystemConnectionState.status` có tên rõ ràng — `"standalone" | "testing" |
"connected" | "failed"` — và chuyển form kết nối/chẩn đoán vào `EcosystemStatusWidget`: một disclosure
nhỏ, THU GỌN SẴN trên Dashboard/Machines (chỉ ở Live — đội demo không có gì để kết nối nên widget không
hiện ở Demo), mang badge trạng thái ngay tiêu đề. **`"standalone"` là badge trung tính, bình thản —
KHÔNG PHẢI cảnh báo** — và luôn thu gọn; widget chỉ tự mở khi `status === "failed"`.)*

### 20.5 🔴 Honest limitations / Giới hạn trung thực

**EN** — Written down plainly, not softened:

- **There is no write path to any device.** `IDeviceDriver` (`St4i.Connector.Abstractions`) has
  exactly four members — `Id`, `Kind`, `Health`, `ReadAsync` — no `WriteAsync`/`SendCommand`/`Actuate`.
  `ModbusTcpDriver`/`OpcUaDriver` expose no write/method-call capability (the only `Write*` hit in
  either file is an NModbus **socket timeout setting**, not a device write). Sparkplug NCMD (the
  inbound command topic) is never received anywhere in this codebase. This product **observes**
  machines; it cannot **command** them. A machine-control (SCADA) layer is a separate future phase,
  not something this batch started.
- **Alarms cannot reach anyone who is not looking at the screen.** `St4i.EngineApi/Alarms/` is exactly
  seven files — a store, an evaluator, endpoints, thresholds, a raise/record model — and nothing else.
  There is no email, SMS, webhook, Slack, syslog, relay, or audible-signal integration anywhere in this
  repository. An alarm is visible on `/alarms` and in the `alarms.db` history the moment someone opens
  that screen, and not one moment before, to anyone who wasn't already looking.
- **Only Modbus TCP and OPC-UA actually work.** `MqttDriver` exists and is proven by
  `MqttDriverTests`, but it is registered into **no** host's dependency injection — neither
  `St4i.EngineApi`'s nor `St4i.EdgeService`'s `Program.cs`/startup wiring references it. Serial/RS-485,
  S7, EtherNet/IP, and SECS/GEM have no driver at all.
- **Re-saving an existing connector's settings while the fleet runs does not apply live; a fresh add
  does.** See §20.2's own explanation — `FleetHost.RegisterMachine` only ever adds, never updates an
  already-running slot in place.
- **Editing a connector requires the map JSON to be pasted or uploaded; there is no visual mapper.**
  `/connectors`' only input for the register/node map is a plain `<textarea>` (or a `.json` file picked
  into that same textarea) — see §20.2.
- **Northbound UNS/Sparkplug publishing carries no provenance filter.** Unlike the historian/OEE/
  genealogy/KPI surfaces §20.3 documents, nothing in `St4i.EdgeCore.Uns`/`UnsBridge` checks
  `DriverKinds.IsFabricated` before publishing a machine's cycle onto the local `syn/{site}/...` spine
  or the upstream Site bridge — a fabricated cycle is published exactly like a real one, with no
  `is_fabricated` tag anywhere on the wire. This only matters at all if an operator deliberately runs a
  mixed real+demo fleet (Demo mode alongside an onboarded real machine) — the standard "one real
  machine" product path (an empty or all-real roster) has no fabricated cycles to leak, so this never
  fires by accident. Recorded here as a known limitation, not fixed this batch.

*(VI: Ghi rõ ràng, không mềm hoá: **KHÔNG có đường ghi lệnh tới bất kỳ thiết bị nào.** `IDeviceDriver`
chỉ có đúng 4 thành viên — `Id`, `Kind`, `Health`, `ReadAsync` — không `WriteAsync`/`SendCommand`/
`Actuate`. `ModbusTcpDriver`/`OpcUaDriver` không có khả năng ghi/gọi method nào (chỉ 1 chỗ khớp
`Write*` trong cả hai file là **cấu hình timeout socket** của NModbus, không phải ghi thiết bị).
Sparkplug NCMD (topic lệnh vào) không bao giờ được nhận ở bất kỳ đâu. Sản phẩm này CHỈ QUAN SÁT máy,
KHÔNG điều khiển được. Layer điều khiển máy (SCADA) là giai đoạn tương lai riêng, đợt này chưa bắt đầu.
**Cảnh báo KHÔNG thể tới ai không đang nhìn màn hình.** Thư mục `Alarms/` chỉ có đúng 7 file — store,
evaluator, endpoint, ngưỡng, model raise/record — không gì khác. KHÔNG có email/SMS/webhook/Slack/
syslog/relay/tín hiệu âm thanh nào trong repo này. **Chỉ Modbus TCP và OPC-UA THẬT SỰ chạy được.**
`MqttDriver` tồn tại, được `MqttDriverTests` chứng minh, nhưng KHÔNG được đăng ký DI ở host nào cả.
Serial/RS-485, S7, EtherNet/IP, SECS/GEM chưa có driver. **Lưu lại cấu hình một connector ĐÃ CÓ trong
khi đội hình đang chạy KHÔNG áp dụng sống; thêm máy MỚI thì có** — xem §20.2. **Sửa một connector đòi
dán/tải JSON map; CHƯA có bộ dựng trực quan** — ô nhập duy nhất của `/connectors` là một `<textarea>`
thường. **Phát UNS/Sparkplug hướng lên KHÔNG có bộ lọc nguồn gốc.** Khác với các mặt
historian/OEE/genealogy/KPI mà §20.3 ghi lại, không có gì trong `St4i.EdgeCore.Uns`/`UnsBridge` kiểm tra
`DriverKinds.IsFabricated` trước khi phát chu kỳ của một máy lên nhánh `syn/{site}/...` cục bộ hay cầu
Site phía trên — một chu kỳ fabricated được phát giống hệt một chu kỳ thật, không có nhãn
`is_fabricated` nào trên dây. Việc này chỉ có ý nghĩa khi người vận hành CHỦ ĐỘNG chạy đội hình lẫn
thật+demo (bật Demo song song một máy thật đã thêm) — đường đi chuẩn "một máy thật" (đội hình rỗng hoặc
toàn máy thật) không có chu kỳ fabricated nào để rò rỉ, nên việc này không tự nhiên xảy ra. Ghi nhận ở
đây như một giới hạn đã biết, chưa sửa trong đợt này.)*
