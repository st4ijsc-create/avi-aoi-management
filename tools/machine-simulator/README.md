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
> configured device(s) — nothing more. **This product CAN write to a device** — as of Đợt B (§21), a
> Modbus TCP or OPC-UA connector whose map declares a writable setpoint/command executes a real write
> (`POST /v1/machines/{code}/setpoint`/`.../command`), gated by role (Engineer for a setpoint, Admin for
> a command) and refused outright while HALT is engaged. **HALT itself still never touches that path —
> and never will.** If you're asking "you can write now, why doesn't HALT stop my machine?": a real
> emergency stop is a hardwired, safety-rated circuit per **ISO 13849** (Cat 3/4) — software is never
> permitted to be the safety path, full stop. Making HALT also fire a Modbus/OPC-UA write to try to stop
> the device would not close that gap; it would make a supervisory latch LOOK more like a safety device
> while still failing to be one — a worse product, not a safer one. So HALT stays exactly what it always
> was: it cancels this software's own read pipeline and disconnects from the configured device(s),
> nothing more, and the machine-control write path (§21) is a separate, explicitly role-and-latch-gated
> capability that HALT deliberately does not use. Do not rely on any control in this product as a safety
> function, and do not connect a real machine's actual emergency-stop circuit to anything this software
> does.
>
> **VI** — Điều khiển mà sản phẩm này gọi là **NGỪNG** trên bảng HMI (mức fleet, `FleetHost.Estop()` /
> `POST /v1/fleet/estop`) và **Hủy** trên trang Line Control là một **chốt phần mềm giám sát**, không
> phải thiết bị an toàn. Nhấn nút này chỉ hủy pipeline đọc dữ liệu của phần mềm này và ngắt kết nối tới
> thiết bị đã cấu hình — không hơn không kém. **Sản phẩm này GIỜ ghi được vào thiết bị** — từ Đợt B
> (§21), một connector Modbus TCP hay OPC-UA có map khai báo setpoint/lệnh ghi được sẽ thực thi một
> lệnh ghi thật (`POST /v1/machines/{code}/setpoint`/`.../command`), gác theo vai trò (Engineer cho
> setpoint, Admin cho lệnh) và bị từ chối thẳng khi NGỪNG đang cài. **Bản thân NGỪNG vẫn không bao giờ
> chạm vào đường ghi đó — và sẽ không bao giờ.** Nếu bạn đang hỏi "giờ ghi được rồi, sao NGỪNG không
> dừng máy tôi?": một hệ thống dừng khẩn cấp thật là mạch cứng đạt chuẩn an toàn theo **ISO 13849**
> (Cat 3/4) — phần mềm không bao giờ được phép là đường an toàn, chấm hết. Cho NGỪNG tự bắn một lệnh ghi
> Modbus/OPC-UA để cố dừng thiết bị không lấp được khoảng trống đó; nó chỉ khiến một chốt giám sát TRÔNG
> giống thiết bị an toàn hơn trong khi vẫn không phải — một sản phẩm tệ hơn, không an toàn hơn. Nên
> NGỪNG vẫn giữ nguyên đúng như trước giờ: chỉ hủy pipeline đọc dữ liệu của phần mềm này và ngắt kết nối
> tới thiết bị đã cấu hình, không hơn không kém — còn năng lực ghi điều khiển máy (§21) là một khả năng
> tách biệt, gác theo vai trò và theo chốt NGỪNG, mà NGỪNG cố tình không dùng tới. Đừng dựa vào bất kỳ
> điều khiển nào trong sản phẩm này như một chức năng an toàn, và đừng đấu mạch dừng khẩn cấp thật của
> máy vào bất cứ thứ gì phần mềm này làm.

---

## 2. Requirements / Yêu cầu

- **.NET 10 SDK** (`dotnet --version` ≥ 10.0). Every project targets `net10.0-windows` (WPF +
  `System.Windows.Threading`); the whole solution is Windows-only.
- **win-x64** — the app/service ship as `win-x64`; `RuntimeIdentifier` is already pinned in the WPF
  csproj.
- No database, no external services required for Demo mode (see §4) — it runs fully offline out of
  the box.

### 2.1 Working tree — the sparse checkout, and the one command that reproduces it

🔴 **This repository is normally checked out SPARSE, and `git status` says CLEAN while most of the
tree is absent from disk.** Measured 2026-08-24: **62,443** of **63,468** tracked file paths were in
the commit and **not on disk**, across **26** of the **27** top-level directories. `git grep`,
`git show` and `git ls-files` read all of them perfectly — the object store is complete. What is
blind is every tool that reads the WORKING TREE: `grep -r`, ripgrep, editor search, `find`. Those
return `0` for an absent path, and **that `0` means NOT LOOKED AT, not NOT PRESENT.**
`scripts/repo-scan.sh` measures and prints the size of that region on every run; nothing else does.
See `docs/owner-decisions.md` item 74.

**The owner ruled on 2026-08-24 that five more directories should be on disk.** Run this once per
working tree:

```bash
git sparse-checkout add server client shared contracts drizzle
```

Measured cost of that command on 2026-08-24 (task BW-1): **2,729 files**, **65.4 MiB**, **1.35 s**
one-off. `uploads/` is deliberately **excluded** — alone it is **58,940 files / 20.2 GiB**, i.e.
**99.4 % of the disk cost** of a full checkout, and nothing in this workstream reads it.

📌 **Two things this command does NOT do, because both cost somebody a day when they were assumed:**

1. **It is worktree-local and it is NOT in the commit.** The cone lives in
   `<git-dir>/info/sparse-checkout`. In a LINKED WORKTREE (which this checkout is) `.git` is a
   *file*, not a directory, and the real path is
   `<main-repo>/.git/worktrees/<name>/info/sparse-checkout` — `cat .git/info/sparse-checkout` fails
   with `Not a directory`. Use `git sparse-checkout list` instead of guessing the path. Every other
   worktree and every fresh clone still gets the narrow default until this command is run there too.
2. **It does not make branch switching measurably slower.** Measured before/after on the same commit
   pair (57 files differing): **267 ms → 241 ms** mean — inside the noise, because `git switch` only
   writes files that DIFFER between the two commits, and these 2,729 stand still. Since 2026-07-18,
   **633** commits touched `tools/machine-simulator` and **0** touched any of the five directories.
   The worst case for a single switch is the same **1.35 s** the materialisation cost.

📌 **One hazard that was tested and does NOT exist, recorded so nobody has to fear it again.** A
narrowing or re-applying cone does **not** delete untracked files that sit in EXCLUDED directories.
Measured 2026-08-24 with a probe file placed under two excluded top-level directories, against
git 2.55: `git sparse-checkout reapply`, `git sparse-checkout add`, `git sparse-checkout set` and
`git switch` (away and back) all left the probe in place, each printing
`warning: directory 'X/' contains untracked files, but is not in the sparse-checkout cone`. Git warns
and preserves. Your scratch notes in an excluded directory survive this command.

To go back: `git sparse-checkout set examples/device-client tools/machine-simulator`.

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
| **Mất mạng demo** (Network outage) | Swaps the live transport for a `DemoTransport` that routes ~90% of sends into its store-and-forward QUEUED branch — API Inspector shows queued rows while the fleet keeps running; re-selecting "Ca bình thường" restores direct acks. 🔴 **Corrected 2026-08-22 (owner-decisions.md item 34).** This row used to say "a ~90%-error `DemoTransport` — API Inspector shows queued/failed rows". Neither half was true and both are the same defect item 22 closed in five `.cs` places on 2026-08-21: `DemoTransport.SendAsync` has four ack-returning exits and all four return `Success: true`, and `fakeErrorRate` is the probability of taking the QUEUED branch, not a failure rate. **Item 34 called the four `web/` i18n strings "the LAST surface still promising a failed ack"; this row is a fifth, and it is the one an integrator reads.** |
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

> 🔴 **Since Đợt E this host also HOSTS CONNECTORS — Modbus TCP and, since E-5, Modbus RTU on the wire.**
> It reads its own `connectors.json` and runs one driver and one pipeline per entry alongside the simulated
> group; one RTU **bus** entry becomes N instances, one per device on the line. An OPC-UA entry is still
> **refused by name** — a pinned decision, not a gap; 🔴 since F-1 the per-host data-root question it was
> waiting on is answered (§15.9) and what remains is engineering, so the refusal stands (§24.2). A machine
> this host drives is **read-only from `St4i.EngineApi`**, and a COM port this host holds is a port
> `St4i.EngineApi` cannot open — 🔴 and on an RTU **gateway** nothing refuses the second host at all
> (§24.7: one host per wire is a deployment constraint, not something this build enforces). If both hosts run
> here, give this one its own data roots (§15.9). **§24 is the whole statement** — read it before wiring this
> host to a real device.

- `--fleet <path>` — load the roster from a `fleet.json`-shaped file via `FleetConfig.Load`. A file that
  parses successfully (with entries, or validly empty — an operator's explicit empty declaration) is
  honored **as-is, in either mode**: `--fleet` is the *only* roster input `EdgeService` has (since E-3 it
  ALSO reads `connectors.json`, but that file adds connector-driven pipelines, never roster members — §24.2),
  so a valid file's content is never demo-gated. A **blank/missing/malformed** path falls back to the built-in 8-machine
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
- 🔴 **`screwTorque` — a SCREWDRIVE entry declares which screw it drives (owner's ruling 2026-08-23,
  item 41).** Optional per entry, and meaningless on any other machine type:
  `"screwTorque": { "screwCode": "M4", "targetNm": 1.35, "toleranceNm": 0.15 }`. All three hosts of this
  product read the roster, so a declared band is the band **every** host reports; both numbers are
  range-checked against exactly the bands `GET /v1/machines/{code}/settings` publishes for
  `screw_program` (`targetNm` 0.10–20.00 Nm, `toleranceNm` 0.00–5.00 Nm) and an out-of-range value is
  **rejected, never clamped** — that one entry is skipped with a named warning and the rest of the roster
  still loads. An operator's machine- or product-scoped adjustment on the settings screen still overrides
  the declaration; the roster sets the commissioning fact, not the shift.
  **Omitting it is a real state, and a REPORTED one.** The shipped roster above omits it on both
  screwdrivers, so `FleetConfig.Load` raises one warning per undeclared SCREWDRIVE, naming what actually
  happens: a machine with no declaration reports **~12.0 Nm** under a host that wires no machine config
  store (`St4i.EdgeService`, the WPF app) and **~1.35 Nm** under one that does (`St4i.EngineApi`, through
  `FleetCore`) — a factor of about nine, for one descriptor, decided by which host you started. 🔴 **This
  product does not choose between those two for you and this release does not either**: nothing in the
  tree says which screw the demo roster is, so the roster stays undeclared and the divergence is
  announced rather than silently resolved. Declare `screwTorque` and the question is closed for that
  machine. See `docs/owner-decisions.md` item 41.
  ⚠️ **Where that warning actually lands, measured rather than assumed: two sinks out of three.**
  `St4i.EngineApi` routes it to `FleetCore`'s logger and `St4i.EdgeService` to its `ILogger`. The WPF
  kiosk passes `Debug.WriteLine`, which is `[Conditional("DEBUG")]` — **compiled out of a Release
  build**, so on the shipped kiosk this warning (and every other `fleet.json` warning, which has been
  true since GP-3 wrote them) reaches nobody. Not introduced here and not fixed here; recorded because
  a warning is only as good as the sink it lands in.
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
| P2 | Mapping UI + Sparkplug B + headless Device Manager | MQTT/Sparkplug B | **Sparkplug B: partially delivered** — a local UNS spine (always-on loopback MQTT broker + dual Sparkplug B/semantic-mirror publisher), see §16.1. **Not yet:** the spine publishes NBIRTH/NDEATH/DDATA only and emits **no DBIRTH/DDEATH**, so it is not a conformant Sparkplug node and a strict host sees its devices as unknown/STALE — an accepted debt with a stated ceiling (§16.1, §20.5, owner-decisions.md item 35). Mapping UI + headless Device Manager: still future. |
| P3 | Modbus TCP/RTU + Serial drivers (screw/glue guns, small PLCs, RS-232/485) | Modbus, Serial | **Modbus TCP: partially delivered** — TCP polling, `UInt16`/`Int16` registers, one register per read, see §16.4; **read-AND-write since Đợt B** (§21) for a Holding register/command a map declares writable — a zero-argument coil pulse only, see §21.6. **Modbus RTU delivered in Đợt D** — both `rtu-gateway` (over a TCP serial device server) and `rtu-serial` (a directly-attached COM port), declared per multidrop **bus** in `connectors.json`; auto-DE RS-485 adapters only, and no frame has yet crossed the serial transport on real hardware (see §16.4's D-7c note). **Not yet:** 32-bit/float registers, register-block batching, a per-machine `MappingProfile` override for Modbus. |
| P4 | OPC-UA + Siemens S7 / EtherNet-IP drivers | OPC-UA, S7, EtherNet/IP | **OPC-UA client: partially delivered** — the licensing spike that used to gate this is resolved (the OPC Foundation .NET stack relicensed MIT on 2025-12-04); a poller against ONE OPC-UA server, `SecurityMode=None` (anonymous or username/password), poll-only (no subscriptions), see §16.6; **read-AND-write since Đợt B** (§21) for a node/method a map declares writable, including typed `CallAsync` arguments. **Not yet:** Siemens S7 / EtherNet-IP drivers, Sign/SignAndEncrypt security modes, complex/structured-type node decoding. |
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

**Update (Đợt B — machine control):** the biggest single line item on this whole roadmap — **this
product can now write to a device** — has landed. A Modbus/OPC-UA connector whose map declares a
writable setpoint or command executes a real write (`POST /v1/machines/{code}/setpoint`/`.../command`),
gated by RBAC (Engineer/Admin), the HALT latch, and a fleet-wide Critical-alarm interlock, with a web UI
to issue one. This does NOT make HALT a safety function or an emergency stop — see §1 and §21.5 for why
that conclusion did not change even though the reason Đợt A originally gave for it (no write path
existed) did. See **§21** for the full detail (endpoints, roles, the `Applied`/`Rejected`/`Failed`/
`Indeterminate` outcome vocabulary, the web UI, and honest limitations).

**Genuinely still future, not touched by this build:** **EST/SCEP enrollment + a Site CA** — today the
device identity is a bare self-signed certificate, and trust (in both mDNS directions now — browsing,
§17.4, and the machine's own advertising, §17.8) is still a single operator-pasted, manually pinned PEM,
not a CA-issued/auto-renewed chain, with no automatic trust-on-first-discovery (§17.11); **an inbound
command path (NCMD or otherwise)** — the bridge is outbound-telemetry-only, so a Site can observe this
device but never actuate it through the ecosystem link (unrelated to §21's LOCAL write path — a
SYNAPSE Site still cannot reach it); and **WS-B B2 (bridge inversion)** — flipping the UNS spine from an
additive mirror into the sole source of truth with ST4I/historian driven asynchronously off it instead
of synchronously inside `EdgePipeline` — assessed and **deliberately deferred to a dedicated GĐ3 pass**
(high blast-radius: ~34 files touch the synchronous ack today; see
`docs/plans/2026-07-27-ws-b-b2-bridge-inversion-assessment.md`).

🔴 **Update (Đợt C — outbound alarm notification):** **alarms now reach someone who is not looking at
the screen**, which this document listed as an honest limitation for two batches (§20.5). C-1 built the
edge detector and the notification seam; C-2 the configuration store and its DPAPI-protected secrets;
C-3 an HMAC-signed **webhook** (`docs/ALARM_WEBHOOK_CONTRACT.md` is its public wire contract); C-4
**e-mail over SMTP**; C-5 a **local annunciation** pushed to every open page over SSE; C-6 a **physical
relay/beacon**; C-7 the eleven endpoints, their RBAC and this product's first rate limiter; C-8 the
screens and this correction. See **§22** for the full detail and for the limitations that are real —
**no SMS and no syslog**, no Windows desktop toast, no implicit TLS on port 465, no proof that a stored
SMTP password works, a relay that is **not a safety device** and does not light while HALT is latched,
and no delivery guarantee behind any channel.

**Update (GĐ3 closeout WI-1 Part B / WI-4):** the two items this line used to list as future — **the
machine announcing itself over mDNS** and **certificate rotation** — have both since landed.
`SiteAdvertiser` now multicasts this device's own presence (`_st4i-machine._tcp`, on by default whenever
the local UNS spine is enabled) so a Site's join wizard can find it without an operator hand-typing a
host/port — see **§17.8**. `POST /v1/site/identity/rotate` mints a fresh self-signed identity on demand
and re-keys the live bridge and mDNS advertisement in the same call — **operator-triggered only; there
is still no automatic pre-expiry renewal** — see **§17.10** for the required two-step follow-up at the
Site.

*(VI: Vài mục P2/P3 phía trên ĐÃ giao trong Giai đoạn 2 (pass 1+2) — xem cột **Status** và **§16** để
biết chi tiết đầy đủ (biến môi trường, endpoint, hành vi). Sparkplug B: **GIAO MỘT PHẦN** qua UNS spine
cục bộ (§16.1) — spine chỉ phát NBIRTH/NDEATH/DDATA, **KHÔNG phát DBIRTH/DDEATH**, nên nó **không phải
một node Sparkplug tuân đặc tả** và một host nghiêm coi device của nó là không biết/STALE; đây là **món
nợ ĐÃ NHẬN, có trần** (§16.1, §20.5, mục 35). Modbus TCP: GIAO MỘT PHẦN — đọc qua TCP, thanh ghi UInt16/Int16, mỗi lần đọc 1 thanh ghi
(§16.4); **ĐỌC VÀ GHI từ Đợt B** (§21) cho thanh ghi Holding/lệnh map khai báo ghi được — chỉ xung coil
không tham số, xem §21.6. Modbus RTU ĐÃ GIAO ở Đợt D (cả `rtu-gateway` lẫn `rtu-serial` — cổng COM cắm thẳng; chỉ adapter tự đảo chiều, và chưa có khung tin nào chạy trên phần cứng thật). CHƯA có 32-bit/float, đọc theo khối, hay MappingProfile
riêng cho từng máy Modbus. OPC-UA: GIAO MỘT PHẦN — "licensing spike" trước đây từng chặn mục này đã được
giải quyết (bộ thư viện .NET của OPC Foundation đổi giấy phép sang MIT ngày 2025-12-04); một poller nối
với MỘT server OPC-UA, `SecurityMode=None` (ẩn danh hoặc username/password), chỉ poll (chưa có
subscription), xem §16.6; **ĐỌC VÀ GHI từ Đợt B** (§21) cho node/method map khai báo ghi được, kể cả tham
số `CallAsync` có kiểu. CHƯA có: driver Siemens S7/EtherNet-IP, chế độ bảo mật Sign/SignAndEncrypt, giải
mã kiểu phức hợp/cấu trúc. Cũng đã giao trong bản này dù không nằm
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

**Cập nhật (Đợt B — điều khiển máy):** mục lớn nhất trên toàn bộ lộ trình này — **sản phẩm này giờ ghi
được vào thiết bị** — đã giao. Một connector Modbus/OPC-UA có map khai báo setpoint/lệnh ghi được sẽ
thực thi một lệnh ghi thật (`POST /v1/machines/{code}/setpoint`/`.../command`), gác theo RBAC
(Engineer/Admin), chốt NGỪNG, và khoá liên động cảnh báo Critical toàn fleet, cùng một web UI để bắn lệnh.
Điều này KHÔNG biến NGỪNG thành chức năng an toàn hay dừng khẩn cấp — xem §1 và §21.5 vì sao kết luận đó
không đổi dù lý do Đợt A từng đưa ra (chưa có đường ghi) nay không còn đúng nữa. Xem **§21** để biết chi
tiết đầy đủ (endpoint, vai trò, từ vựng kết quả `Applied`/`Rejected`/`Failed`/`Indeterminate`, web UI, và
giới hạn trung thực).

Vẫn CHƯA làm: **EST/SCEP + Site CA** để tự động cấp/xoay chứng chỉ (hiện danh tính thiết bị chỉ là chứng
chỉ tự ký, và tin cậy — ở CẢ HAI chiều mDNS, vừa duyệt tìm §17.4 vừa tự quảng bá §17.8 — vẫn chỉ là một
PEM operator dán tay, ghim thủ công, không phải chuỗi CA cấp/tự gia hạn, và vẫn chưa có
trust-on-first-discovery tự động, §17.11); **đường lệnh vào (NCMD hay khác)** — bridge CHỈ GỬI telemetry
RA, Site quan sát được máy này nhưng không điều khiển được qua liên kết hệ sinh thái (khác với đường ghi
CỤC BỘ ở §21 — một SYNAPSE Site vẫn không chạm tới được); và **WS-B B2 (đảo chiều bridge)** — đã đánh
giá và CHỦ ĐỘNG hoãn sang một đợt GĐ3 riêng (phạm vi ảnh hưởng lớn — khoảng 34 file đang dùng ack đồng
bộ).

🔴 **Cập nhật (Đợt C — cảnh báo ra ngoài):** **cảnh báo nay ĐÃ tới được người không nhìn màn hình** —
điều mà tài liệu này liệt kê là giới hạn trung thực suốt hai đợt (§20.5). C-1 dựng bộ dò cạnh và seam
thông báo; C-2 kho cấu hình và bí mật bảo vệ bằng DPAPI; C-3 **webhook** ký HMAC
(`docs/ALARM_WEBHOOK_CONTRACT.md` là hợp đồng dây công khai của nó); C-4 **email qua SMTP**; C-5 **báo
tại chỗ** đẩy qua SSE tới mọi trang đang mở; C-6 **relay/đèn báo vật lý**; C-7 mười một endpoint, RBAC
của chúng và bộ giới hạn tốc độ đầu tiên của sản phẩm; C-8 màn hình và bản đính chính này. Xem **§22**
để biết chi tiết và các giới hạn THẬT — **KHÔNG có SMS, KHÔNG có syslog**, không có toast desktop
Windows, không dùng được TLS ngầm cổng 465, không chứng minh được mật khẩu SMTP đã lưu là đúng, relay
**không phải thiết bị an toàn** và không sáng khi HALT đang gài, và không kênh nào có bảo đảm gửi tới nơi.

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
§18.2 for `ST4I_IDENTITY_EXPIRY_WARN_DAYS` (§17.10, the `Identity` alarm), 🔴 `ST4I_NOTIFICATIONS_DIR`
(Đợt C, §22 — the alarm **notification** configuration store, which holds channel credentials protected
with DPAPI, so **that directory's ACL is a confidentiality boundary**), and 🔴 `ST4I_HMI_MODEL_DIR`/
`ST4I_HMI_TAGS_DIR` (WS-HMI-0a Task 5, §15.9 — the declared HMI component tree and tag namespace;
neither has an endpoint yet, see the roadmap ledger).)*

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
bind), `ST4I_HISTORIAN_DIR`, `ST4I_WAL_DIR`, `ST4I_SECURITY_DIR` (thư mục dữ liệu — 🔴 Đợt C thêm
`ST4I_NOTIFICATIONS_DIR` cho `notifications.db`, xem §22.5: thư mục đó chứa thông tin đăng nhập mã hóa
DPAPI nên ACL của nó là ranh giới bảo mật), `ST4I_DEMO_ENABLED`
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

**Customer data under `%ProgramData%\ST4I\sim\` is kept by default** — the engine declares **eighteen**
directories there (`historian`, `wal`, `security`, `creds`, `notifications`, `identity`,
`connector-config`, `opcua-pki`, `sitelink`, `alarms`, `assets`, `settings`, `bridge-spool`,
`machine-config`, `products`, `ecosystem` — 🔴 the last three arrived on **2026-08-23**, when the owner
moved three stores that until then wrote **beside the engine binary**; see §15.9 — and `hmi-model`,
`hmi-tags` arrived on **2026-08-30** (WS-HMI-0a Task 5), the day `Program.cs` first registered
`ComponentModelStore`/`TagNamespaceStore` into the DI graph) and
the MSI has no `<Component>` referencing anything there (it's all runtime-created by the engine, not
installed), so Windows Installer's uninstall/remove sequence never touches it. This is deliberate: an
uninstall or upgrade must never silently destroy production history, the audit trail, or a machine's
credential.

🔴 **DECLARES, not CREATES — corrected 2026-08-30 (whole-branch review of WS-HMI-0a, Important 2), and
the two sentences above it are kept verbatim.** The first sentence of this section read *"the engine
creates **eighteen** directories there"*, and the parenthesis read *"`hmi-model`, `hmi-tags` arrived on
**2026-08-30** (WS-HMI-0a Task 5), the day `Program.cs` first registered
`ComponentModelStore`/`TagNamespaceStore` into the DI graph"*. **Registration of a factory singleton is
not creation.** Both stores are registered as `AddSingleton<T>(sp => new …)` (`Program.cs`); a factory
registration's delegate runs on the first **resolution**, and the reviewer measured that nothing in
`src/` resolves `IComponentModelStore` or `ITagNamespaceStore` — there is no endpoint until WS-HMI-0b. A
running engine at this commit therefore never constructs either store, and
`%ProgramData%\ST4I\sim\{hmi-model,hmi-tags}` are never created. The honest form, and the one the §15.9
table row below already reaches for: **declared and registered; created on first resolution, which no
endpoint performs until WS-HMI-0b.** Sixteen of the eighteen are created by a running engine today.

**What did NOT change, said so the correction is not over-read:** both are relocatable
(`ST4I_HMI_MODEL_DIR`/`ST4I_HMI_TAGS_DIR`), both are purged by `packaging/remove-data.ps1` if present,
and both count toward the **eighteen** the naming rule of §15.9 covers — that rule is about DECLARED
directories, and `PerHostDataRootsTests` derives its number from `ST4I_*_DIR` literals in `src/`, which
is a declaration count and always was. The `.NET` test harness redirects both leaves structurally
(`tests/Shared/TestRunTempRoot.cs`) and that redirect stays required, not optional: `HmiModelWiringTests`
resolves both seams directly, and WS-HMI-0b's endpoint tests will resolve them constantly.

To actually purge it (decommissioning a machine, resetting a demo box), run the separate, explicit,
destructive script — **never** invoked by the MSI itself:

```powershell
.\packaging\remove-data.ps1 -WhatIf   # preview only, nothing touched
.\packaging\remove-data.ps1           # interactive — prompts before each stop/delete
.\packaging\remove-data.ps1 -Force    # non-interactive, for scripted wipes

# Relocated a data dir via any ST4I_*_DIR (§15.2)? Say so explicitly — one -XxxDir per directory:
.\packaging\remove-data.ps1 -HistorianDir D:\St4iData\historian -SecurityDir D:\St4iData\security -IdentityDir D:\St4iData\identity
```

It stops+deletes the `St4iEngineApi` service if present, then deletes **sixteen of the eighteen** data
directories — printing an explicit "this destroys the audit chain + historian + credentials" warning up
front, and a per-directory line naming exactly what each one loses, gated through PowerShell's
`ShouldProcess`/`-WhatIf`/`-Confirm`.

🔴 **FOURTEEN, NOT SIXTEEN — the owner ruled on 2026-08-23 that two directories are KEPT.** `products`
(`products.json`, `recipes.json`) and `ecosystem` (`ecosystem-products.json`, `ecosystem-recipes.json`)
are printed with their resolved paths under a **KEPT BY DESIGN** heading and are never deleted. The
reason, in the ruling's own words: **configuration an operator authored is not operational data — it is
something they built**, and "remove data" should not cost them that.

**Read the other direction of that before you hand a machine on.** Those four files SURVIVE a wipe this
section otherwise calls clean-slate. They hold no credential and no production history — which is why the
ruling was available at all — but they do hold whatever product and recipe definitions an operator typed.
If you want them gone, delete those two directories by hand; there is deliberately **no flag** that makes
the script do it, because a flag would be one keystroke away from re-creating the data-loss path the
ruling closed. 🔴 **This is not the pre-2026-08-23 arrangement re-labelled:** before that date those four
files sat beside the binary and went when the install directory went, which was an accident of layout.
Now they are under `%ProgramData%` and are kept **on purpose**. `machine-config` is the third new
directory and it **is** purged — it holds the machine's operating parameters and the append-only
`History` of every adjustment, which is a record of what the machine did rather than something an
operator authored.

🔴 **WS-HMI-0a Task 5, 2026-08-30 — `hmi-model` and `hmi-tags` joined the purge list, not the kept one.**
The engine gained two more `%ProgramData%` directories the day `Program.cs` first registered
`ComponentModelStore`/`TagNamespaceStore` (WS-HMI-0a Tasks 2/3) into its DI graph:
`hmi-model` (the declared component tree a HMI screen resolves against — component types and
`tagPrefix` bindings) and `hmi-tags` (the declared tag namespace, plus the flat index a driver will
eventually back). Both are relocatable (`ST4I_HMI_MODEL_DIR`/`ST4I_HMI_TAGS_DIR`) and both are
**purged**: neither holds a credential, and neither is exempt the way `products`/`ecosystem` are — a
component tree is closer to `machine-config`'s "record of what the machine currently does" than to a
recipe an operator typed, and the kept set stays pinned at exactly `{ecosystem, products}` by
`NotificationDocumentationTests`/`PerHostDataRootsTests`, so a third exemption was never available
without its own owner ruling.

🔴 **The purge list went from four directories to thirteen in Đợt C (C-8 and its review), and the gap was
real rather than documentary.** C-8 first added `notifications` — `notifications.db` holds the webhook
URLs, webhook signing secrets, webhook auth tokens and SMTP passwords an operator configured (§22.5), so
a wipe that skipped it left live third-party credentials on a machine being handed on or scrapped. The
review then found that **fixing one directory did not close the class**: the script purged five of the
thirteen the engine creates while claiming to wipe what the engine creates, and **two of the eight it
missed hold credentials**:

- 🔴 **`identity`** — `device-identity.bin` is the device's **PFX private key**, and it is sealed with
  DPAPI at **`LocalMachine`** scope rather than `CurrentUser`, so **any local administrator on the box
  can unseal it**. It is created unconditionally on every boot, so it is present even on a machine that
  never configured a Site link.
- 🔴 **`connector-config`** — persists the register/node-map JSON **verbatim**, and an OPC-UA node map
  carries its `password` as a **plaintext** field.

The remaining six (`opcua-pki`, `sitelink`, `alarms`, `assets`, `settings`, `bridge-spool`) are customer
data or trust material rather than bearer credentials, but this script's stated purpose is a clean-slate
wipe — leaving them meant it did not do that, and an operator reading the old output would reasonably
have believed the machine was clean. 🔴 **All EIGHTEEN directories are relocatable and each has its own
`-XxxDir` parameter** — `creds` included, since 2026-08-23 `-MachineConfigDir`, `-ProductsDir` and
`-EcosystemDir` too, and since 2026-08-30 `-HmiModelDir`/`-HmiTagsDir` (WS-HMI-0a Task 5). (`-ProductsDir`/
`-EcosystemDir` resolve a path the script **prints and does not delete**; they exist so
a relocated install's KEPT directories are named correctly in the banner — `-HmiModelDir`/`-HmiTagsDir`
are ordinary PURGE parameters, not reporting-only ones.) (This paragraph said "every directory except `creds`" until the
Đợt F branch review: `creds` became relocatable in the test-hygiene batch via `ST4I_CREDS_DIR`
(`CredentialStore.cs`), `remove-data.ps1` gained `-CredsDir` in the same change, and this sentence was not
updated with them. It mattered: it told an operator who HAD relocated `creds` that the wipe would still find
it at the default, so the DPAPI-sealed machine credential survived a "clean-slate" decommission.)

**Relocated directories (WS-F1 final-review fix F3):** the `ST4I_*_DIR` variables mean a deployment's
real data doesn't have to live under
`%ProgramData%\ST4I\sim\*` at all — the script used to assume it always did, silently deleting an
empty default directory while the real data sat untouched elsewhere. It now resolves **each of the
eighteen relocatable directories** per its own `-XxxDir` parameter, else the matching `ST4I_*_DIR` environment variable
in **this same PowerShell process**, else the `%ProgramData%` default — printing the resolved path for
each before doing anything. **It does NOT read the service's own registry `Environment` value** (only
this shell's own env) — if a relocated directory was only ever configured there, pass the matching
`-XxxDir` parameter explicitly (check the registry first: `Get-ItemProperty
'HKLM:\SYSTEM\CurrentControlSet\Services\St4iEngineApi' -Name Environment`), or that directory is
missed by this script and must be removed by hand. 🔴 **That applies to `creds` too** — it resolves through
`-CredsDir` > `ST4I_CREDS_DIR` > the `%ProgramData%` default like every other directory, so a relocated
credential store is exactly as easy to miss, and it is the one holding the DPAPI-sealed `mk_`.

*(VI: Gỡ cài đặt chỉ xoá những gì MSI đã cài (Program Files, shortcut, service nếu có bật) — dữ liệu
`%ProgramData%\ST4I\sim\*` được GIỮ LẠI mặc định vì MSI không hề biết tới các thư mục này (do engine tự
tạo lúc chạy). Muốn xoá thật, chạy `packaging\remove-data.ps1` (có `-WhatIf`/`-Force`) — script riêng,
thủ công, có cảnh báo phá hủy rõ ràng, KHÔNG bao giờ được MSI tự gọi. 🔴 **Danh sách xoá đã tăng từ 4 lên
ĐỦ 13 thư mục trong Đợt C (C-8 và vòng review), và đó là thiếu sót THẬT chứ không phải thiếu sót tài
liệu.** C-8 thêm `notifications` trước — `notifications.db` chứa URL webhook, khóa ký, token và mật khẩu
SMTP (§22.5), nên một lần xoá để thanh lý máy mà bỏ qua nó sẽ để lại thông tin đăng nhập bên thứ ba còn
sống trên máy sắp chuyển đi. Vòng review sau đó phát hiện **sửa một thư mục KHÔNG đóng được cả lớp vấn
đề**: script mới xoá 5 trong 13 thư mục engine tạo ra, trong khi tự nhận là xoá những gì engine tạo — và
**2 trong 8 thư mục bị bỏ sót chứa thông tin đăng nhập**: 🔴 **`identity`** (`device-identity.bin` là
**khóa riêng PFX** của thiết bị, niêm bằng DPAPI phạm vi **`LocalMachine`** chứ không phải `CurrentUser`,
nên **bất kỳ quản trị viên cục bộ nào trên máy cũng mở được**; nó được tạo vô điều kiện ở mọi lần khởi
động, kể cả trên máy chưa từng liên kết Site), và 🔴 **`connector-config`** (lưu **nguyên văn** JSON
register/node-map, mà node map OPC-UA chứa `password` ở dạng **văn bản thuần**). Sáu thư mục còn lại
(`opcua-pki`, `sitelink`, `alarms`, `assets`, `settings`, `bridge-spool`) là dữ liệu khách hàng hoặc vật
liệu tin cậy chứ không phải thông tin đăng nhập, nhưng mục đích script tự nhận là **xoá sạch để thanh
lý** — bỏ sót chúng nghĩa là nó không làm đúng điều đó, và người vận hành đọc kết quả cũ sẽ tin rằng máy
đã sạch. 🔴 **CẢ MƯỜI BA thư mục đều chuyển chỗ được và đều có tham số `-XxxDir` riêng — kể cả `creds`.**
(Câu này viết "mọi thư mục trừ `creds`" cho tới vòng review nhánh Đợt F: `creds` đã chuyển chỗ được từ đợt
test-hygiene qua `ST4I_CREDS_DIR`, `remove-data.ps1` nhận `-CredsDir` trong cùng thay đổi ấy, và câu này không
được cập nhật theo. Nó có hậu quả thật: nó bảo người vận hành ĐÃ dời `creds` rằng lệnh xoá vẫn tìm thấy nó ở
mặc định, nên khoá máy niêm DPAPI sống sót qua một lần "xoá sạch để thanh lý".) Nếu đã chuyển chỗ
qua một biến `ST4I_*_DIR` nào đó, truyền tham số `-XxxDir` tương ứng — script KHÔNG tự đọc giá trị
registry `Environment` của service, chỉ đọc biến môi trường của CHÍNH shell đang chạy nó; nếu không khớp,
phải xoá thư mục thật bằng tay.
🔴 **CẬP NHẬT 2026-08-23 — engine nay tạo MƯỜI SÁU thư mục, và script xoá MƯỜI BỐN.** Chủ sở hữu phán ngày
2026-08-23 rằng ba store trước đây ghi **cạnh file binary** chuyển gốc xuống `%ProgramData%\ST4I\sim\`
(`machine-config`, `products`, `ecosystem` — xem §15.9), và cùng ngày phán tiếp rằng **hai thư mục
`products` và `ecosystem` được MIỄN TRỪ khỏi lượt xoá**. Lý do, đúng lời phán: **cấu hình do vận hành viên
soạn KHÔNG phải dữ liệu vận hành — nó là thứ họ DỰNG LÊN**, và "gỡ dữ liệu" không nên làm họ mất nó. Script
in đường dẫn của hai thư mục ấy dưới tiêu đề **KEPT BY DESIGN** rồi để nguyên.
🔴 **Nói cả chiều ngược lại:** bốn file `products.json`, `recipes.json`, `ecosystem-products.json`,
`ecosystem-recipes.json` **SỐNG SÓT** qua một lần xoá mà mục này vẫn gọi là "xoá sạch để thanh lý". Chúng
không chứa thông tin đăng nhập và không chứa lịch sử sản xuất — chính vì thế phán quyết mới khả thi — nhưng
chúng chứa mọi định nghĩa sản phẩm/công thức mà vận hành viên đã gõ vào. Muốn xoá thì xoá hai thư mục ấy
bằng tay; **cố ý KHÔNG có cờ nào** làm việc đó. `machine-config` là thư mục mới thứ ba và nó **CÓ** bị xoá:
nó giữ tham số vận hành của máy và danh sách `History` chỉ-thêm của mọi lần điều chỉnh — một bản ghi về
việc máy ĐÃ LÀM GÌ, không phải thứ vận hành viên dựng lên.
🔴 **CẬP NHẬT 2026-08-30 (WS-HMI-0a Task 5) — engine KHAI MƯỜI TÁM thư mục, script xoá MƯỜI SÁU.**
`hmi-model` (cây linh kiện đã khai của máy) và `hmi-tags` (namespace tag đã khai) gia nhập danh sách
XOÁ, không phải danh sách GIỮ — chúng gần với `machine-config` (bản ghi máy đang chạy gì) hơn là với
`products`/`ecosystem` (cấu hình vận hành viên tự soạn), và danh sách GIỮ vẫn ghim đúng
`{ecosystem, products}` bởi `NotificationDocumentationTests`/`PerHostDataRootsTests`.
🔴 **KHAI, KHÔNG PHẢI TẠO — sửa 2026-08-30 (review toàn nhánh WS-HMI-0a, Important 2), câu cũ giữ nguyên
văn.** Câu ngay trên đọc *"engine nay tạo MƯỜI TÁM thư mục, script xoá MƯỜI SÁU"*. **Đăng ký một factory
singleton KHÔNG phải là tạo.** Cả hai store được đăng ký dạng `AddSingleton<T>(sp => new …)` trong
`Program.cs`; delegate của một factory chỉ chạy ở lần PHÂN GIẢI đầu tiên, và người review đo được rằng
**không có gì trong `src/` phân giải** `IComponentModelStore` hay `ITagNamespaceStore` — chưa có endpoint
nào cho tới WS-HMI-0b. Nên một engine đang chạy ở commit này **không bao giờ dựng** hai store ấy, và
`%ProgramData%\ST4I\sim\{hmi-model,hmi-tags}` **không bao giờ được tạo**. Dạng trung thực: **đã khai và đã
đăng ký; được tạo ở lần phân giải đầu tiên, mà chưa endpoint nào thực hiện trước WS-HMI-0b.** MƯỜI SÁU
trong MƯỜI TÁM là số thư mục một engine đang chạy thật sự tạo hôm nay. **Cái KHÔNG đổi:** cả hai vẫn dời
chỗ được, vẫn bị `remove-data.ps1` xoá NẾU CÓ, và vẫn tính vào con số mười tám của quy tắc đặt tên §15.9 —
quy tắc ấy nói về thư mục ĐƯỢC KHAI, và `PerHostDataRootsTests` suy số của nó từ các literal `ST4I_*_DIR`
trong `src/`, tức là một phép đếm lời khai.)*

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

### 15.9 🔴 Two hosts on one machine — per-host data roots / Hai host trên một máy — gốc dữ liệu riêng

**EN** — Since Đợt E it is a normal deployment to run **`St4i.EngineApi` and `St4i.EdgeService` on the same
Windows machine** (§24). They share no roster, no claim registry and no channel — but by default they share
**one set of files**. This section is how to give each host its own, and what that costs.

**The rule, and it is the whole mechanism — and it is scoped to the MACHINE-WIDE population:** every
directory this product creates under
`%ProgramData%\ST4I\sim\<name>` is relocatable by an environment variable whose name is derived from the
directory name — **`ST4I_` + `<NAME>` (uppercased, `-` → `_`) + `_DIR`**. There are **18** of them
today, and there is no exception **within that population**. 🔴 **It is not the whole of what this product
writes**: three more stores live BESIDE THE ENGINE BINARY and are isolated only by accident — see "The
SECOND store population" below, and read it before concluding two hosts are separated.

🔴 **WS-HMI-0a Task 5, 2026-08-30 — SIXTEEN → EIGHTEEN.** `hmi-model` (`ComponentModelStore`,
`ST4I_HMI_MODEL_DIR`) and `hmi-tags` (`TagNamespaceStore`, `ST4I_HMI_TAGS_DIR`) joined the population
the day `Program.cs` first registered both stores into the DI graph — see the two new rows in the
WRITES/READS table below. Nothing about the RULE changed; only the count did, which is the whole point
of stating it as a derived count rather than a list (see `PerHostDataRootsTests`' own doc comment).

🔴 **"JOINED THE POPULATION" IS RIGHT; "the engine creates them" WOULD NOT BE — 2026-08-30, whole-branch
review of WS-HMI-0a, Important 2.** Both are `AddSingleton<T>(sp => new …)` **factory** registrations, and
a factory's delegate runs on the first RESOLUTION. Nothing in `src/` resolves `IComponentModelStore` or
`ITagNamespaceStore` — no endpoint exists until WS-HMI-0b — so a running engine at this commit never
constructs either store and neither directory is created. They are **declared and registered; created on
first resolution, which no endpoint performs until WS-HMI-0b.** The naming RULE above counts declared
directories, which is what makes eighteen the right number here and sixteen the number of directories a
live machine actually has today. §15.4's own count sentence carried the wrong verb until this correction;
it now reads "declares".

📎 **THE SENTENCE AFTER THE COUNT IS RETRACTED, 2026-08-23 (BF-1), kept verbatim.** It read *"three more
stores live BESIDE THE ENGINE BINARY and are isolated only by accident"*, and it was true from F-1 until
that date. The owner ruled on **2026-08-23(a)** that those three move their defaults under
`%ProgramData%\ST4I\sim\` — which is why the count above went **thirteen → sixteen** in the same edit.
🔴 **The second population is now EMPTY, and "empty" is asserted rather than assumed**: an empty set
satisfies every universal anyone states about it, so `PerHostDataRootsTests` pins the beside-the-binary
variable set at exactly zero members instead of merely quantifying over it. The subsection below is kept
in place with its own retraction, because everything it says about WHY accidental isolation is not
isolation is still the reason the move happened.

🔴 **Read the WRITES/READS columns before you relocate anything.** Relocating a root a host **writes**
gives that host its own copy of something it produces — that is isolation, and it is what this section is for.
Relocating a root a host only **reads** disconnects it from data **another host produces**, and no process on
the machine will ever fill the new directory. The two look identical in a registry value and are opposite in
effect.

| Directory | Variable | Who WRITES it | Who READS it | What loses visibility if you move it |
|---|---|---|---|---|
| `creds` | `ST4I_CREDS_DIR` | **EngineApi** (`OnboardingService`), **WPF shell** (`OnboardingViewModel`/`SettingsViewModel`) | those two **+ EdgeService** (`EdgeWorker`) | the DPAPI-sealed `mk_` key per machine. 🔴 **EdgeService never writes one** — see the recipe below |
| `wal` | `ST4I_WAL_DIR` | **all three hosts** | all three | the store-and-forward backlog: unsent readings stay in the **old** `<machineCode>.jsonl` and are never sent |
| `identity` | `ST4I_IDENTITY_DIR` | EngineApi | EngineApi | the device PFX private key **and the node id** — a new root mints a **new device**, and a Site that pinned the old fingerprint no longer trusts it |
| `historian` | `ST4I_HISTORIAN_DIR` | EngineApi | EngineApi | `historian.db` + `oee-settings.json` — all production history and OEE inputs |
| `security` | `ST4I_SECURITY_DIR` | EngineApi | EngineApi | `security.db` (users/sessions/audit) + the DataProtection key ring — **every login and the audit trail** |
| `notifications` | `ST4I_NOTIFICATIONS_DIR` | EngineApi | EngineApi | alarm channels **and their DPAPI-protected credentials** (§22.5) |
| `connector-config` | `ST4I_CONNECTOR_CONFIG_DIR` | EngineApi | EngineApi | saved device connections (an OPC-UA map carries its password in plaintext) |
| `opcua-pki` | `ST4I_OPCUA_PKI_DIR` | EngineApi (an `OpcUaDriver` writes its app-instance cert) | EngineApi | the OPC-UA app-instance certificate + trusted-peer store |
| `alarms` | `ST4I_ALARMS_DIR` | EngineApi | EngineApi | `alarms.db` — active alarms and history |
| `assets` | `ST4I_ASSETS_DIR` | EngineApi | EngineApi | `assets.db` — the canonical asset registry |
| `settings` | `ST4I_SETTINGS_DIR` | EngineApi | EngineApi | `fleet-settings.json` — serverUrl/machineCode/verifyTls |
| `sitelink` | `ST4I_SITELINK_DIR` | EngineApi | EngineApi | the Site link and its operator-pinned PEM |
| `bridge-spool` | `ST4I_BRIDGE_SPOOL_DIR` | EngineApi | EngineApi | the durable northbound spool |
| `machine-config` | `ST4I_MACHINE_CONFIG_DIR` | EngineApi (`MachineConfigStore`, on the operator's first write) | EngineApi | `machine-operating-config.json` — per-machine baselines, every operator adjustment, and the append-only `History` behind them. 🔴 **joined this table on 2026-08-23**; the only root written **under the fleet's global lock** |
| `products` | `ST4I_PRODUCTS_DIR` | EngineApi (`ProductConfigStore`, **during construction**) | EngineApi | `products.json`, `recipes.json` — the product and recipe definitions. 🔴 **joined on 2026-08-23**, and **KEPT by `remove-data.ps1`** (§15.4) |
| `ecosystem` | `ST4I_ECOSYSTEM_DIR` | EngineApi (`SimulatedEcosystem`, **during construction**) | EngineApi | `ecosystem-products.json`, `ecosystem-recipes.json` — the Demo-mode ecosystem. 🔴 **joined on 2026-08-23**, and **KEPT by `remove-data.ps1`** (§15.4) |
| `hmi-model` | `ST4I_HMI_MODEL_DIR` | EngineApi (`ComponentModelStore`, on an engineer's `PutAsync`) | EngineApi | `hmi-model.db` — the declared component tree (types, `tagPrefix` bindings) a HMI screen resolves against. 🔴 **joined on 2026-08-30** (WS-HMI-0a Task 5); no endpoint reads it yet (WS-HMI-0b). 🔴 **Declared and registered; CREATED on first resolution, which no endpoint performs until WS-HMI-0b** — the DI registration is a factory singleton, so this directory does not exist on a live machine today |
| `hmi-tags` | `ST4I_HMI_TAGS_DIR` | EngineApi (`TagNamespaceStore`, on an engineer/connector's `PutAsync`) | EngineApi | `tag-namespaces.db` — the declared tag namespace + its flat path index. 🔴 **joined on 2026-08-30** (WS-HMI-0a Task 5); no driver loads a real tag into it yet (WS-HMI-0c). 🔴 **Declared and registered; CREATED on first resolution, which no endpoint performs until WS-HMI-0b** — same factory-singleton reason as the row above |

*(The WRITES/READS columns are an enumeration of CALL SITES in `src/`, not an inference from which assembly
references which type: `CredentialStore.Save` appears in `St4i.EngineApi/Fleet/OnboardingService.cs` and in the
WPF shell's two view-models and **nowhere else**, while `St4i.EdgeService`'s single credential call site,
`EdgeWorker.cs:368`, is a `Load`. `St4i.EdgeService` names `DeviceIdentityStore` nowhere at all, and
`OpcUaPkiPaths` only inside a doc comment.)*

Pinned by `PerHostDataRootsTests` — `EveryMachineWideDirectory_IsRelocatable_ByADerivableEnvVarName` derives
**both** sets by scanning `src/`, so a fourteenth **machine-wide** store fails it until it has a variable too
(🔴 the qualifier is load-bearing and was missing until H-1c's fix round: `MachineConfigStore` **is** a
fourteenth store, it **did** arrive, and this guard stayed green — correctly, because it is not machine-wide.
The guard that turned red was `TestHarnessIsolationTests`, for a different reason. The beside-the-binary
population has its own guard,
`TheBesideTheBinaryStorePopulation_IsEmpty_AndTheMachineWideOnesAccountForEveryVariable` — 🔴 renamed
2026-08-30 from `…AndTheSixteenMachineWideOnes…`; the count came OUT of the name because a name is not an
assertion and this one had gone stale at 16 while the test stayed green), and
`EveryRelocationVariable_IsActuallyREAD_NotMerelyDeclared` requires each variable to reach a real
`Environment.GetEnvironmentVariable` call rather than merely existing as a literal somewhere. That is
deliberate: the mechanism was already complete before this section existed, and the thing that would break
per-host roots is not a missing feature but a **new store added without one** — or with one that nothing
reads.

*(🔴 What those two pins do **not** measure, said here rather than left to be discovered. They prove a
variable is **declared and read at a resolution site**. They do not execute any store, so they cannot prove the
resolved value is then **honoured** all the way to a file. Where that last step actually is — **two
instruments, named apart because they answer different questions** (branch review F-8): (a) counting the files
under `tests/` that spell a variable's **literal**, and (b) reading each candidate test for a
`SetEnvironmentVariable(<Store>.EnvVarDir, …)` call. **(a) cannot produce the per-store rows and an earlier
version of this parenthetical credited it with them** — every store reads through its own constant, so
`FleetSettingsStoreTests` spells `ST4I_SETTINGS_DIR` **zero** times while driving the seam through
`FleetSettingsStore.EnvVarDir`, and `BridgeSpoolTests`' only occurrence of its literal is a doc comment. By
(b): **four** directories have a dedicated env-var witness — `creds` (`CredentialStoreTests`), `settings`
(`FleetSettingsStoreTests`), `wal` (`WalOptionsTests`), `bridge-spool` (`BridgeSpoolTests`) — plus
`PerHostDataRootIsolationTests` for the two-root case. **Eight** more are redirected incidentally by host
harnesses that would read or pollute the real `%ProgramData%` if the redirect were ignored. And
**`opcua-pki`'s honoured-to-file behaviour IS measured** (branch review F-10, correcting an earlier claim that
nothing measured it): `OpcUaDriver`'s constructor calls `OpcUaPkiPaths.ResolveRoot(pkiDir)`, and three OPC-UA
test files hand it a real temporary root and let the driver write its app-instance certificate there — that is
the **explicit-path** arm, the first tier of the same `explicit > env > default` chain. The residual is
narrower and is the one to carry: **nothing exercises `ST4I_OPCUA_PKI_DIR`, the environment variable.**
`historian` is also the one variable read at a composition root (`St4i.EngineApi/Program.cs`) rather than on its store, so a
host that ever constructed a historian store without going through that root would get the machine-wide default
with no env-var step. None does today.)*

#### 🔴 The SECOND store population — written BESIDE THE BINARY, and isolated only BY ACCIDENT

> 📎🔴 **THIS WHOLE SUBSECTION IS RETRACTED, 2026-08-23 (BF-1), and kept VERBATIM below rather than
> rewritten — including its table, its three numbered consequences and the AC-1 ruling table.** The owner
> ruled on **2026-08-23(a)**: all three stores move their default roots to
> `%ProgramData%\ST4I\sim\{machine-config,products,ecosystem}`. **The second population is now empty.**
>
> **Why it is kept rather than deleted.** Nothing in it was wrong. It is the argument that *accidental*
> separation is not isolation — the same distinction §24.2 draws for a COM port — and that argument is
> precisely what got the move ruled. A reader who arrives here from an older build, or from a machine that
> still has files beside its binary, needs to find this text, not a gap where it used to be.
>
> **What is true today, in five lines:**
> 1. All three roots are `%ProgramData%\ST4I\sim\<leaf>` and all three variables are derivable from the
>    leaf: `ST4I_MACHINE_CONFIG_DIR`, `ST4I_PRODUCTS_DIR`, `ST4I_ECOSYSTEM_DIR`. **Eighteen directories,
>    eighteen variables, one population.**
>    🔴 **SIXTEEN → EIGHTEEN, 2026-08-30 (whole-branch review of WS-HMI-0a, Important 1).** This line read
>    *"**Sixteen directories, sixteen variables, one population.**"* It was written on 2026-08-23 by BF-1
>    and was true then. WS-HMI-0a added `hmi-model`/`hmi-tags` and moved the count everywhere the guard
>    reads — but this line, and its Vietnamese mirror five lines further down, are in a
>    "what is true today" header that no guard reads, so both kept saying sixteen. The count of the three
>    stores BF-1 moved has not changed and is not what this line states; it states the size of the single
>    population they joined.
> 2. Two hosts launched from **one install directory** no longer share these files by accident — they
>    share them by DEFAULT, machine-wide, exactly like the other thirteen, and the fix is the same fix:
>    give each host its own roots. That is a real change of shape, not a repeal of the warning.
> 3. 🔴 **An existing install stops reading its old files**, and this is the cost the owner accepted with
>    the ruling. It is mitigated, not erased: on the first start under the new default each store performs
>    a **one-time COPY** from the old beside-the-binary location, and **never deletes the original**
>    (`LegacyRootMigration`). It runs only when the root resolved from the DEFAULT — an explicit path or
>    an `ST4I_*_DIR` value skips it, which is what keeps a test process from importing build residue.
> 4. 🔴 **After that first write the two copies DIVERGE and nothing converges them.** An operator who keeps
>    hand-editing the old path beside the binary will see no effect and no error. There is no warning on
>    that path; the old file simply stops being read. **Delete it once you are satisfied the new root has
>    what you need** — the product will not, because deleting an operator's bytes is not a thing this
>    product does.
> 5. `products` and `ecosystem` are **KEPT** by `packaging/remove-data.ps1` (owner ruling 2026-08-23(b),
>    §15.4); `machine-config` is **purged** like the other thirteen.

**EN** — Everything above is about the **thirteen machine-wide** directories under `%ProgramData%\ST4I\sim\`.
The product also writes **three** persistent stores **next to the engine's own .exe**
(`AppContext.BaseDirectory`), and for those the rule above does **not** apply:

| Store | Files | Relocatable? |
|---|---|---|
| `MachineConfigStore` | `machine-operating-config.json` — per-machine baselines + operator adjustments | **yes**, `ST4I_MACHINE_CONFIG_DIR` |
| `ProductConfigStore` | `products.json`, `recipes.json` | **no seam at all** |
| `SimulatedEcosystem` | `ecosystem\ecosystem-products.json`, `ecosystem\ecosystem-recipes.json` | **no seam at all** |

🔴 **Read this before assuming these are already separate.** Two hosts get their own copies of these files
**only because the installer happened to put the two exes in two different directories**. That is an
**ACCIDENT of layout, not a guarantee** — and it is exactly the distinction §24.2 had to draw for a COM port:
a resource that is separate today because nothing has asked it to be shared is *not* an isolated resource.
**Two hosts launched from ONE install directory share every one of these files**, including the machine
operating-configuration an operator tunes on the Settings screen, and nothing anywhere will say so.

🔴 **WHICH two hosts — measured, because it changes who this warning is for.** All three stores are
constructed in exactly one place, `St4i.EngineApi`'s own DI registrations. `St4i.EdgeService` and the WPF
shell construct none of them. So the hazard is **real for two `St4i.EngineApi` instances sharing an install
directory**, and **vacuous for the `EngineApi` + `EdgeService` pair this section is otherwise about**. It is
stated rather than dropped because "only one host constructs it" is a fact about today's call sites, and the
second host gaining one of these stores is exactly the change that would make it bite.

🔴 **`ST4I_MACHINE_CONFIG_DIR` is the one relocation that changes what happens under the fleet's global
lock — read this before pointing it at a network share.** Starting the fleet writes
`machine-operating-config.json` for any machine not yet in the store, and that write happens **while the
fleet's global lock is held** (`FleetCore`'s P5). It is the only one of the fourteen relocatable roots with
that property. A local directory is what has been measured; a UNC share puts a network filesystem write, and
a second lock, inside the lock the HALT path also takes, and **nobody has measured that**. Relocating this
root to a share is not forbidden — it is unmeasured, which is a different and more useful thing to be told.

Three consequences, stated rather than left to be met on site:

1. **`ST4I_MACHINE_CONFIG_DIR` is NOT one of the thirteen.** There are now **fourteen** `ST4I_*_DIR`
   variables and **thirteen** machine-wide directories. Those are two numbers about two populations, not an
   off-by-one — `PerHostDataRootsTests` partitions them on exactly that property so the pairing above stays
   checkable.
2. **`packaging/remove-data.ps1` cannot reach it.** That script purges `%ProgramData%`; a
   `machine-operating-config.json` beside the binary goes when the install directory goes. But if you
   **relocate** it with `ST4I_MACHINE_CONFIG_DIR`, you have put customer data somewhere the decommissioning
   wipe does not look, and there is no `-MachineConfigDir` parameter to tell it. Delete that directory by
   hand, and treat this as the reason to relocate deliberately rather than casually.
3. **NOTHING IS MIGRATED here either.** Same rule as §15.9's machine-wide roots: pointing
   `ST4I_MACHINE_CONFIG_DIR` at a new directory on a running deployment orphans the old file, and every
   machine silently reverts to schema defaults with no adjustments and no error.

The other two stores keep no seam on purpose: adding one is cheap, but a variable nobody reads and a default
nobody moved is worse than an honest absence — see `PerHostDataRootsTests`'
`EveryRelocationVariable_IsActuallyREAD_NotMerelyDeclared`. If a deployment genuinely needs them separated
today, **install the two hosts into two directories** — which is what the default installer does.

##### 🔴 Task AC-1 — a trial run met this section from the outside, and the ruling it asked for

A rebuilt `publish-desktop/` was started with **all fourteen** `ST4I_*_DIR` roots redirected, and reported
`products.json`/`recipes.json` beside the binary as a new defect. It is this section, re-observed from a
running process — and the observation was **short by half**: that start wrote **four** files, not two.
`ecosystem\ecosystem-products.json` and `ecosystem\ecosystem-recipes.json` landed in the same second, from
the third store of the same table — all four stamped `2026-08-18 07:23:42Z` on the artefact that run left
behind. **Three stores, five filenames, four files on a first run** (`MachineConfigStore`'s is written later,
at `Ensure`) — read the table above, never a count carried out of a run report.

**The ruling, because "is `ProductConfigStore` the same case as `MachineConfigStore`" has three answers and
they are not the same answer.**

| Asked about | Same case? | Why |
|---|---|---|
| the **default root** (`AppContext.BaseDirectory`) | **yes** | documented product behaviour for both — task X-1's ruling, and each constructor's own doc comment. Not a defect, and not changed here. |
| the **seam** | **no** | `MachineConfigStore` has `ST4I_MACHINE_CONFIG_DIR`; `ProductConfigStore` has none, and the absence is not an oversight — **three instruments derive from it** (`OwnOutputDirectoryGuard`'s exemption, which requires that source to declare NO `EnvVarDir`; `verify-suites.sh`'s output-directory bracket, which carries the same derivation; and `PerHostDataRootsTests`, which asserts the beside-the-binary population holds exactly `ST4I_MACHINE_CONFIG_DIR`). |
| the **constructor** | **no, and this is the one that costs** | `MachineConfigStore`'s constructor reads and does not write — **given a root that already exists**, which is what an install directory is. (It does call `Directory.CreateDirectory` first, so a root that does not exist AND cannot be created still throws; the split below is the shape of the ROOT plus the constructor's behaviour, never the constructor alone.) `ProductConfigStore`'s and `SimulatedEcosystem`'s **seed and persist**, so a directory they cannot write to ends the process before the host exists — measured on the shipped exe, exit code `0xE0434352`. See `docs/startup-failure-posture.md` §3.5, rows 32/33. |

🔴 **A seam would not have moved the third row.** A relocation variable with an unchanged default leaves every
existing install writing exactly where it writes today; what moves that row is moving the DEFAULT, and moving
a store's default relocates live customer data on the next start — a deployment decision, not a seam, in the
same words `MachineConfigStore.DefaultRoot`'s remarks already use. AC-1 measured the arm and **reported** the
decision rather than taking it.

> 📎🔴 **TOÀN BỘ ĐOẠN VI NGAY DƯỚI ĐÂY ĐƯỢC RÚT, 2026-08-23 (BF-1), giữ NGUYÊN VĂN.** Chủ sở hữu phán ngày
> **2026-08-23(a)**: cả ba store chuyển gốc mặc định xuống
> `%ProgramData%\ST4I\sim\{machine-config,products,ecosystem}`. **Quần thể thứ hai nay RỖNG** — và cái
> rỗng ấy được **ghim bằng test** chứ không phải được giả định, vì một tập rỗng thoả mọi khẳng định phổ
> quát. Giữ nguyên văn vì không câu nào trong đó từng sai: chính lập luận "tách vì tình cờ thì không phải
> đã cô lập" là thứ khiến phép chuyển được phán.
> **Hôm nay, năm dòng:** (1) mười tám thư mục, mười tám biến, MỘT quần thể — tên biến suy được từ tên thư
> mục.
> (🔴 **MƯỜI SÁU → MƯỜI TÁM, 2026-08-30**, review toàn nhánh WS-HMI-0a, Important 1: dòng này đọc
> *"(1) mười sáu thư mục, mười sáu biến, MỘT quần thể"* — đúng khi BF-1 viết nó ngày 2026-08-23, và sai
> từ ngày WS-HMI-0a thêm `hmi-model`/`hmi-tags`. Nó nằm trong một khối "hôm nay đúng cái gì" mà không có
> bài test nào đọc, cùng với bản tiếng Anh của chính nó năm dòng phía trên — nên cả hai cùng đứng yên ở
> mười sáu. Số ba store BF-1 chuyển thì KHÔNG đổi; dòng này nói kích thước của cái quần thể chúng gia
> nhập, không nói số của chúng.)
> (2) Hai host chạy từ một thư mục cài nay dùng chung các file ấy **theo mặc định**, giống hệt mười ba
> cái kia; cách tách vẫn là cho mỗi host một gốc riêng. (3) 🔴 Một bản cài ĐÃ TỒN TẠI **thôi đọc file cũ**
> — đó là cái giá chủ sở hữu đã chấp nhận; nó được giảm nhẹ bằng **một phép CHÉP MỘT LẦN** từ gốc cũ,
> **KHÔNG BAO GIỜ xoá bản cũ** (`LegacyRootMigration`), và phép chép chỉ chạy khi gốc giải ra từ MẶC ĐỊNH.
> (4) 🔴 Sau lần ghi đầu **hai bản PHÂN KỲ và không có gì hợp nhất chúng**: sửa file cũ cạnh binary sẽ
> không có tác dụng và không có báo lỗi nào. (5) `products` và `ecosystem` **ĐƯỢC GIỮ** khi chạy
> `packaging/remove-data.ps1` (phán quyết 2026-08-23(b), §15.4); `machine-config` **BỊ XOÁ**.

*(VI: 🔴 **Quần thể store THỨ HAI — ghi CẠNH FILE BINARY, và chỉ cô lập một cách TÌNH CỜ.** Mọi thứ bên trên
nói về **mười ba** thư mục **toàn máy** dưới `%ProgramData%\ST4I\sim\`. Sản phẩm còn ghi **ba** store bền vững
**ngay cạnh .exe của engine** (`AppContext.BaseDirectory`), và với ba store ấy quy tắc trên **không** áp dụng:
`MachineConfigStore` (`machine-operating-config.json` — **dời chỗ được** bằng `ST4I_MACHINE_CONFIG_DIR`),
`ProductConfigStore` (`products.json`, `recipes.json` — **không có seam nào**) và `SimulatedEcosystem`
(`ecosystem\ecosystem-products.json`, `ecosystem\ecosystem-recipes.json` — **không có seam nào**).
🔴 **Đọc kỹ trước khi cho rằng chúng đã tách sẵn.** Hai host có bản riêng của các file này **chỉ vì trình cài
đặt tình cờ đặt hai .exe vào hai thư mục khác nhau**. Đó là **SỰ TÌNH CỜ về bố cục, KHÔNG PHẢI một bảo đảm** —
đúng cái phân biệt §24.2 phải nêu cho cổng COM: một tài nguyên hôm nay còn riêng chỉ vì chưa ai đòi dùng chung
thì **không phải** một tài nguyên đã cô lập. **Hai host chạy từ MỘT thư mục cài đặt dùng chung tất cả các file
ấy**, kể cả cấu hình vận hành máy mà người vận hành chỉnh trên màn hình Settings, và **sẽ không có chỗ nào báo
điều đó**. 🔴 **HAI host NÀO — đã đo:** cả ba store chỉ được dựng ở đúng một chỗ, phần đăng ký DI của
`St4i.EngineApi`; `St4i.EdgeService` và vỏ WPF **không dựng cái nào**. Nên nguy cơ là **THẬT với hai thực thể
`St4i.EngineApi` chung một thư mục cài**, và **rỗng với cặp `EngineApi` + `EdgeService`** mà mục này vốn nói
tới — vẫn nêu ra, vì "chỉ một host dựng nó" là tính chất của các call site HÔM NAY.
🔴 **`ST4I_MACHINE_CONFIG_DIR` là phép dời chỗ DUY NHẤT làm đổi thứ chạy dưới khoá toàn cục của fleet — đọc
trước khi trỏ nó vào ổ mạng.** Khởi động fleet sẽ ghi `machine-operating-config.json` cho máy chưa có trong
store, và lần ghi đó xảy ra **khi khoá toàn cục đang được giữ** (P5 của `FleetCore`) — đây là gốc duy nhất
trong mười bốn gốc có tính chất ấy. Thứ đã được đo là một thư mục cục bộ; một đường UNC đặt một lần ghi qua
mạng, kèm một cái khoá thứ hai, vào bên trong đúng cái khoá mà đường HALT cũng lấy, và **chưa ai đo điều đó**.
Không cấm — nhưng **chưa đo**, và đó là điều đáng nói hơn. Ba hệ quả: (1) `ST4I_MACHINE_CONFIG_DIR` **KHÔNG** thuộc mười ba — hiện có **mười bốn** biến
`ST4I_*_DIR` và **mười ba** thư mục toàn máy; đó là hai con số của hai quần thể, không phải lệch một.
(2) `packaging/remove-data.ps1` **không với tới được** nó: script xoá `%ProgramData%`, còn file cạnh binary đi
theo thư mục cài đặt — nhưng nếu bạn **dời** nó bằng biến trên thì bạn đã đặt dữ liệu khách hàng ở chỗ lệnh xoá
khi ngừng sử dụng không tìm tới, và **không có tham số `-MachineConfigDir` nào** để báo cho nó; hãy xoá thư mục
đó bằng tay. (3) **KHÔNG CÓ DI TRÚ** ở đây cũng vậy: trỏ biến sang thư mục mới trên một triển khai đang chạy sẽ
bỏ rơi file cũ, mọi máy lặng lẽ quay về mặc định của schema, không điều chỉnh nào và không báo lỗi. Hai store
còn lại cố ý không có seam: một biến không ai đọc còn tệ hơn một sự vắng mặt trung thực. Nếu một triển khai
thật sự cần tách chúng ngay hôm nay, **hãy cài hai host vào hai thư mục khác nhau** — đó cũng là điều trình
cài đặt mặc định đang làm.)*

**How to actually set them — and the two hosts do NOT use the same mechanism.**

🔴 **`St4i.EdgeService` is not a Windows service in this build**, despite the name. `Program.cs` is a plain
`Host.CreateApplicationBuilder` + `RunAsync()` with **no `AddWindowsService`**; the only `AddWindowsService`
in `src/` is `St4i.EngineApi`'s, there is no `--install` verb on the edge agent, no WiX component and no
service key — §15.1 says it in as many words (*"no separate service executable exists"*). **The per-service
registry `Environment` mechanism of §15.2 therefore does not apply to it.** Set its variables in the shell
(or scheduled task, or supervisor) that launches the process:

```powershell
# Host 1 — the ENGINE. It IS a Windows service (St4iEngineApi, §15.1), so §15.2's per-service registry
# Environment value is the mechanism. Keeping the defaults it already has data in: nothing to do.
# (unset means %ProgramData%\ST4I\sim\<name>)

# Host 2 — the EDGE AGENT, launched from a shell. Two lines is the WHOLE recipe; see below for why.
$env:ST4I_WAL_DIR      = 'C:\ProgramData\ST4I\edge\wal'
$env:ST4I_MACHINE_CODE = 'LINE3-EDGE-01'
.\St4i.EdgeService.exe            # or: dotnet run --project src/St4i.EdgeService
```

🔴 **Running the edge agent unattended is out of scope for this build, and that is a gap rather than a
recipe.** Nothing here registers it with the SCM, so an unattended deployment needs an external supervisor
(a scheduled task at boot, or a third-party service wrapper) — whichever you use has to carry those two
variables into the process's own environment, because nothing else will.

🔴 **The second line does MORE than name a queue file, and §15.9 used to describe only half of it.**
`ST4I_MACHINE_CODE` is the WAL filename's second input **and** the key the edge agent looks its credential up
by (`EdgeWorker.cs:368`, `CredentialStore.Load(machineCode)`) **and** its Live identity to the platform. So:
**onboard `LINE3-EDGE-01` on a host that can claim (the engine or the WPF shell, §5) BEFORE starting the edge
agent** — with the shared creds root recommended below, that claim is what puts the `mk_` where this host will
find it. Skip that and the host reads `null` forever and never goes Live, which is the identical symptom this
section attributes to setting `ST4I_CREDS_DIR`, reached by a different route. And changing an
already-running host's machine code **strands its existing WAL backlog** under the old `<machineCode>.jsonl`,
which the no-migration warning below does not cover because a machine code is not a root.

🔴 **`ST4I_CREDS_DIR` is deliberately NOT in that block, and adding it would break this host.**
`St4i.EdgeService` **reads** a credential and can never write one — `CredentialStore.Save` exists only in
`St4i.EngineApi`'s onboarding service and in the WPF shell, and the edge agent's single credential call site
(`EdgeWorker.cs:368`) is a `Load`. Point it at a private creds root and nothing on the machine will ever put an
`mk_` in it: the host reads `null` forever and never goes Live. **The creds root is meant to be SHARED** —
that sharing is exactly how a machine onboarded on the engine becomes sendable from the edge agent. A private
creds root is supported but **manual**: onboard the machine on a host that can claim, then copy
`<machineCode>.bin` into the edge agent's root by hand. DPAPI does not block the copy (both stores seal at
`LocalMachine` scope, so a blob stays readable anywhere on the **same machine**) — but no `CredentialStore.Save`
will ever run in that directory to apply the SYSTEM/Administrators lock-down, so apply it yourself with
`icacls`, because the ACL is then the entire confidentiality boundary.

🔴 **`ST4I_IDENTITY_DIR` is not in that block either, for a weaker reason: it is inert here.**
`St4i.EdgeService` does not name `DeviceIdentityStore` anywhere. Setting it creates an unused directory and
implies this host has a device identity of its own, which it does not.

For an **interactive** run the same variables work from the shell that launches the process. Set them before
starting the second host — nothing is shared between the two processes, which have two environment blocks, and
that is the entire isolation mechanism. *(🔴 Do not read "set them before starting" as "changing one at
runtime takes effect". `CredentialStore` genuinely re-resolves on **every call** — it is `static`, with no
construction point a host could hold — but the other twelve roots are resolved **once**, when the store or its
options object is constructed at startup. Restart the host after changing any of them.)*

🔴 **Which ones `St4i.EdgeService` actually touches today** — the rest are listed above because they are
what you would have to move if that changes, not because this host touches them now. It **writes** `wal`,
**reads** `creds`, and reads `connectors.json`/`fleet.json` beside its own exe. It does **not** touch the asset
registry, the settings store, the historian, the alarm store, the security database or the device identity.
**`wal` is the only root both hosts WRITE, so it is the only one where "per-host" means isolation rather than
disconnection** — which is why the recipe above is two lines and not thirteen.

🔴 **`ST4I_WAL_DIR` is the one that bites first, and it is arithmetic rather than a warning.** The queue file
is `<walDir>\<machineCode>.jsonl` — a pure function of those two. Two hosts that share **both** share one
file, and both append to it. Change either one and they do not.

🔴 **NOTHING IS MIGRATED. Moving a root makes the old data INVISIBLE, not copied.** There is no migration
step, no fallback read of the previous location, and no warning at startup — a store simply finds an empty
directory and behaves like a fresh install. On a deployment that is already running, that means: saved
credentials are gone, the WAL backlog is stranded, and — if you move `identity` — the host mints a **new**
device certificate and node id, so a Site that pinned the old fingerprint stops trusting it. 🔴 **The
credential remedy depends on WHICH host you moved, and only two of the three can perform it:** `St4i.EngineApi`
and the WPF shell can claim again (they call `CredentialStore.Save`); **`St4i.EdgeService` cannot claim at
all** — its only recoveries are to be pointed back at the shared root, or to have the `.bin` copied in by hand
from a host that did claim. **Move roots on a host that has no data yet, or copy the
directory contents yourself first.** DPAPI is not an obstacle to copying: both `CredentialStore` and
`DeviceIdentityStore` seal at `DataProtectionScope.LocalMachine`, so a blob stays readable anywhere on the
**same machine** — and, for the same reason, the new directory's ACL is the entire confidentiality boundary
(`CredentialStore.Save` re-applies the SYSTEM/Administrators lock-down on every save; §22.5).

🔴 **The decommissioning wipe follows the roots, but only if you tell it.** `packaging/remove-data.ps1`
resolves each directory as `-XxxDir` parameter → the matching `ST4I_*_DIR` **in that PowerShell session** →
the `%ProgramData%` default. It does **not** read a service's registry `Environment` value. A second host's
relocated data therefore survives a "clean-slate" wipe run from a shell that does not have its variables
exported — pass the `-XxxDir` parameters explicitly, once per host.

🔴 **This does NOT stop two hosts driving one wire, and the two problems must not be conflated.** Separate
data roots solve **hosts overwriting each other's files**. They do nothing about **two hosts on one RS-485
segment**: two hosts with two data directories can still name the same Modbus gateway, or the same COM port.
That is a separate, unenforced deployment constraint — **§24.7**.

🔴 **OPC-UA at the edge: the blocking condition is cleared, the work is not done.** `St4i.EdgeService` refuses
an OPC-UA entry by name because dispatching it would make this host a second writer to the machine-wide
`opcua-pki` root (§24.2). The decision that was missing — *is a per-host data root a supported deployment?* —
is answered here: **yes**, and `ST4I_OPCUA_PKI_DIR` is the variable. What remains is engineering, and it is
listed rather than implied: this host has no `OpcUaOptions` of its own (endpoint, node map, PKI root), no
dispatch arm, and no test that two hosts pointed at two roots keep two certificate stores. **Setting
`ST4I_OPCUA_PKI_DIR` alone changes nothing** — the entry is still refused by name, and the refusal message
says so.

*(VI: Từ Đợt E, chạy **`St4i.EngineApi` và `St4i.EdgeService` trên cùng một máy Windows** là một hình dạng
triển khai bình thường (§24). Hai host không chia sẻ roster, không chia sẻ sổ yêu sách, không chia sẻ kênh
nào — nhưng mặc định chúng **dùng chung một bộ file**. Mục này nói cách cho mỗi host một bộ riêng, và cái giá
phải trả. **Quy tắc:** mọi thư mục sản phẩm tạo dưới `%ProgramData%\ST4I\sim\<tên>` đều dời chỗ được bằng một
biến môi trường suy ra được từ tên thư mục — **`ST4I_` + `<TÊN>` (viết hoa, `-` → `_`) + `_DIR`**. Hôm nay có
**mười tám** thư mục, **không có ngoại lệ TRONG QUẦN THỂ ẤY** (bảng bên trên).
📎 🔴 **RÚT 2026-08-30 (review toàn nhánh WS-HMI-0a, Important 1), giữ nguyên văn:** câu ngay trên đọc
*"Hôm nay có **mười sáu** thư mục, **không có ngoại lệ TRONG QUẦN THỂ ẤY** (bảng bên trên)."* Nó đúng cho
tới 2026-08-30, và nó **sai từ ngày ấy mà không ai thấy**: WS-HMI-0a Task 5 chuyển số này 16 → 18 ở nửa
TIẾNG ANH (*"There are **18** of them today"*, ngay trên) và **để nguyên nửa tiếng Việt ở mười sáu**, nên hai
nửa của cùng MỘT câu mâu thuẫn nhau và người vận hành đọc tiếng Việt bị bảo là mười sáu. Báo cáo của task
ấy còn khai là đã sửa *"all in **both languages**"* — xem `task-5-report.md` để biết chỗ đính chính. Phép đo
bác nó: `PerHostDataRootsTests.TheNumberOfMachineWideDirectories_…` suy số từ `src/` và ra **18**, nhưng
regex của nó khi ấy chỉ đọc câu TIẾNG ANH, trong khi thông điệp thất bại của chính nó lại kể tên "README
§15.9 (EN+VI …), §24.6 (EN+VI)" — một đòi hỏi được phát biểu mà không được đo. Từ 2026-08-30 bài test ấy đọc
**cả bảy** câu, cả hai ngôn ngữ, nên chỗ hở này không mở lại được bằng cùng cách nữa.
📎 **RÚT 2026-08-23 (BF-1), giữ nguyên văn:** câu ngay trên đọc *"Hôm nay có **mười ba** thư mục"* và tiếp
*"🔴 nhưng đó **không phải toàn bộ những gì sản phẩm ghi**: còn **ba** store nữa nằm **cạnh file binary của
engine**, chỉ cô lập một cách tình cờ, xem mục 'Quần thể store THỨ HAI' bên dưới."* Cả hai nửa đúng cho tới
2026-08-23. Chủ sở hữu phán chuyển ba store ấy xuống `%ProgramData%\ST4I\sim\` cùng ngày, nên **mười ba
thành mười sáu** và **quần thể thứ hai RỖNG** — cái rỗng ấy được ghim ở đúng số không, vì một tập rỗng thoả
mọi khẳng định phổ quát. Mục "Quần thể store THỨ HAI" vẫn ở dưới, giữ nguyên văn, mang khối rút của chính
nó. Và có **hai** test ghim trong
`PerHostDataRootsTests`: `EveryMachineWideDirectory_IsRelocatable_ByADerivableEnvVarName` suy ra **cả hai** tập
bằng cách quét `src/` (store **toàn máy** thứ mười bảy làm test đỏ cho tới khi nó cũng có biến — 🔴 chữ "toàn
máy" từng là chịu lực và **nay không còn phân chia gì**: `MachineConfigStore` ĐÚNG là store thứ mười bốn khi
H-1c thêm nó và phép ghim khi ấy vẫn XANH đúng như thiết kế, vì nó chưa thuộc quần thể toàn máy; từ
2026-08-23 nó **thuộc**, cùng với hai store còn lại, nên quần thể cạnh-binary rỗng và phép ghim riêng của nó
nay ghim đúng **số không**), và
`EveryRelocationVariable_IsActuallyREAD_NotMerelyDeclared` đòi mỗi biến phải tới được một lời gọi
`Environment.GetEnvironmentVariable` thật, chứ không chỉ tồn tại như một chuỗi ở đâu đó.
*(🔴 Cái hai phép ghim ấy **KHÔNG** đo: chúng chứng minh biến **được khai báo và được ĐỌC ở một điểm phân
giải**; chúng không chạy store, nên không chứng minh giá trị đã phân giải rồi **được tôn trọng** tới tận file.
Bước cuối ấy nằm ở đâu — **HAI dụng cụ, nêu tách nhau vì chúng trả lời hai câu hỏi khác nhau** (review
nhánh F-8): (a) đếm số file dưới `tests/` có **chuỗi literal** của biến, và (b) đọc từng test ứng viên tìm lời
gọi `SetEnvironmentVariable(<Store>.EnvVarDir, …)`. **(a) KHÔNG thể sinh ra các dòng theo từng store, mà bản
trước của đoạn này lại ghi công cho nó** — mọi store đọc qua HẰNG của chính nó, nên `FleetSettingsStoreTests`
viết `ST4I_SETTINGS_DIR` **không lần nào** trong khi vẫn lái seam qua `FleetSettingsStore.EnvVarDir`, còn
`BridgeSpoolTests` chỉ nhắc literal của nó trong một chú thích. Theo (b): **bốn** thư mục có nhân chứng riêng
cho biến — `creds` (`CredentialStoreTests`), `settings` (`FleetSettingsStoreTests`), `wal`
(`WalOptionsTests`), `bridge-spool` (`BridgeSpoolTests`) — cộng `PerHostDataRootIsolationTests` cho trường hợp
hai gốc; **tám** thư mục nữa được chuyển hướng **gián tiếp** bởi harness dựng host thật. Và **hành vi
"tôn trọng tới tận file" của `opcua-pki` CÓ được đo** (review nhánh F-10, đính chính khẳng định trước rằng
không gì đo nó): hàm dựng `OpcUaDriver` gọi `OpcUaPkiPaths.ResolveRoot(pkiDir)`, và ba file test OPC-UA đưa
cho nó một gốc tạm thật rồi để driver ghi chứng chỉ app-instance vào đó — đó là nhánh **đường dẫn tường minh**,
tầng đầu của chính chuỗi `tường minh > env > mặc định`. Phần dư hẹp hơn, và đây mới là thứ phải mang theo:
**không gì thực thi `ST4I_OPCUA_PKI_DIR`, tức chính biến môi trường.**)*

🔴 **Đọc cột GHI/ĐỌC trước khi dời bất cứ gốc nào.** Dời một gốc mà host **GHI** cho host ấy bản sao
riêng của thứ chính nó tạo ra — đó là *cô lập*, và đó là mục đích của mục này. Dời một gốc mà host chỉ **ĐỌC**
sẽ **cắt đứt** nó khỏi dữ liệu do host KHÁC tạo, và **không tiến trình nào trên máy sẽ đổ đầy thư mục mới**.
Hai việc ấy nhìn trong registry giống hệt nhau và có tác dụng ngược nhau.
🔴 **Hôm nay `St4i.EdgeService`: GHI `wal`, ĐỌC `creds`**, đọc `connectors.json`/`fleet.json` cạnh exe, và
**không chạm** sổ tài sản, store cài đặt, historian, store cảnh báo, CSDL bảo mật lẫn danh tính thiết bị.
**`wal` là gốc DUY NHẤT cả hai host cùng GHI**, nên nó là gốc duy nhất mà "theo host" nghĩa là cô lập chứ không
phải cắt đứt — vì thế công thức là **`ST4I_WAL_DIR` + `ST4I_MACHINE_CODE` khác nhau**, hai dòng, không phải
mười ba. File hàng đợi là `<walDir>\<machineCode>.jsonl`, một hàm thuần của hai thứ đó, nên trùng cả hai là
trùng file và cả hai cùng ghi thêm vào đó.
🔴 **ĐỪNG đặt `ST4I_CREDS_DIR` cho `St4i.EdgeService` — làm thế là làm HỎNG host đó.** Host này chỉ ĐỌC
khoá; `CredentialStore.Save` chỉ tồn tại trong onboarding của `St4i.EngineApi` và trong vỏ WPF, còn call site
duy nhất của tác nhân biên (`EdgeWorker.cs:368`) là một `Load`. Trỏ nó vào một gốc creds riêng thì **không có
gì trên máy đổ `mk_` vào đó**: host đọc ra `null` mãi mãi và không bao giờ lên Live. **Gốc creds được thiết kế
để DÙNG CHUNG** — chính việc dùng chung là cách một máy đã onboard trên engine trở nên gửi được từ tác nhân
biên. Nếu thật sự muốn gốc creds riêng thì được, nhưng **thủ công**: onboard trên host có quyền claim rồi tự
chép `<machineCode>.bin` sang. DPAPI không cản (cả hai store niêm phong ở phạm vi `LocalMachine`), nhưng sẽ
không có `CredentialStore.Save` nào chạy ở thư mục ấy để áp khoá ACL SYSTEM/Administrators — hãy tự áp bằng
`icacls`. **`ST4I_IDENTITY_DIR` cũng không nên đặt**, lý do nhẹ hơn: host này không nhắc `DeviceIdentityStore`
ở đâu cả, đặt nó chỉ tạo một thư mục vô dụng.
🔴 **Hai host KHÔNG dùng cùng một cơ chế đặt biến.** `St4i.EngineApi` **là** một Windows service
(`St4iEngineApi`, §15.1) nên dùng giá trị registry `Environment` của §15.2. **`St4i.EdgeService` KHÔNG phải
Windows service trong bản build này** dù mang cái tên đó: `Program.cs` của nó là một Generic Host thuần
(`Host.CreateApplicationBuilder` + `RunAsync()`), **không có `AddWindowsService`** — lời gọi ấy chỉ tồn tại
trong `St4i.EngineApi` — không có verb `--install`, không có component WiX, không có khoá service; §15.1 nói
thẳng *"không tồn tại một file thực thi service riêng"*. **Nên cơ chế registry của §15.2 KHÔNG áp dụng cho nó**;
đặt biến ở chính shell (hoặc scheduled task, hoặc trình giám sát) khởi động tiến trình:
`$env:ST4I_WAL_DIR = '…'; $env:ST4I_MACHINE_CODE = 'LINE3-EDGE-01'; .\St4i.EdgeService.exe`.
Chạy tác nhân biên **không cần người trực** nằm NGOÀI phạm vi bản build này — đó là một khoảng trống, không
phải một công thức: cần một trình giám sát bên ngoài, và chính nó phải mang hai biến ấy vào môi trường của
tiến trình.
🔴 **Dòng thứ hai làm NHIỀU hơn những gì §15.9 từng nói.** `ST4I_MACHINE_CODE` vừa là nửa sau tên file
hàng đợi, vừa là **khoá tra cứu khoá `mk_`** (`EdgeWorker.cs:368`, `CredentialStore.Load(machineCode)`), vừa là
danh tính Live của host với nền tảng. Vì vậy: **hãy onboard `LINE3-EDGE-01` trên một host claim được (engine
hoặc vỏ WPF, §5) TRƯỚC khi khởi động tác nhân biên** — với gốc creds dùng chung được khuyến nghị bên dưới,
chính lần claim ấy đặt `mk_` vào nơi host này sẽ tìm. Bỏ qua bước đó thì host đọc ra `null` mãi mãi và không
bao giờ lên Live — đúng triệu chứng mục này quy cho việc đặt `ST4I_CREDS_DIR`, chỉ đến bằng đường khác. Và đổi
mã máy của một host đang chạy sẽ **bỏ lại backlog WAL** dưới tên file cũ, thứ mà cảnh báo không-di-trú bên dưới
KHÔNG phủ, vì một mã máy không phải một gốc.
Hai tiến trình có hai khối môi trường — đó là **toàn bộ** cơ chế cô lập.
*(🔴 Đừng đọc "đặt trước khi khởi động" thành "đổi lúc đang chạy là có tác dụng": `CredentialStore` thật
sự phân giải lại **mỗi lần gọi** vì nó `static`, còn **mười hai** gốc kia được phân giải **một lần** lúc store
hoặc options của nó được dựng khi khởi động. Đổi xong phải khởi động lại host.)* 🔴 **KHÔNG CÓ DI TRÚ. Đổi gốc làm dữ liệu cũ trở nên VÔ HÌNH, không
phải được chép sang** — không có bước di trú, không đọc dự phòng chỗ cũ, không cảnh báo lúc khởi động: store
thấy thư mục rỗng và hành xử như bản cài mới. Trên một triển khai đang chạy nghĩa là: mất khoá `mk_` đã lưu
backlog WAL bị bỏ lại, và nếu dời `identity` thì host sinh **chứng chỉ + node id MỚI**, nên Site đã ghim vân
tay cũ sẽ không còn tin nó. 🔴 **Cách khắc phục khoá `mk_` phụ thuộc host nào bị dời, và chỉ HAI trong ba
host làm được:** `St4i.EngineApi` và vỏ WPF claim lại được (chúng gọi `CredentialStore.Save`); **`St4i.EdgeService`
KHÔNG claim được** — nó chỉ có hai đường: trỏ lại gốc dùng chung, hoặc được chép tay file `.bin` từ một host đã
claim. **Hãy đổi gốc khi host chưa
có dữ liệu, hoặc tự chép nội dung thư mục trước.** DPAPI không cản việc chép: cả `CredentialStore` lẫn
`DeviceIdentityStore` niêm phong ở phạm vi `LocalMachine`, nên blob vẫn đọc được ở bất kỳ đâu **trên cùng
máy** — và cũng vì thế ACL của thư mục mới là **toàn bộ** ranh giới bảo mật. 🔴 **Lệnh xoá dữ liệu đi theo gốc,
nhưng phải nói cho nó biết:** `packaging/remove-data.ps1` phân giải theo tham số `-XxxDir` → biến `ST4I_*_DIR`
**trong chính phiên PowerShell đó** → mặc định `%ProgramData%`; nó KHÔNG đọc giá trị registry `Environment`
của service, nên dữ liệu đã dời chỗ của host thứ hai sẽ **sống sót** qua một lượt "xoá sạch" nếu shell không
export biến — hãy truyền `-XxxDir` tường minh, mỗi host một lần. 🔴 **Điều này KHÔNG ngăn hai host cùng lái một
sợi dây, và đừng gộp hai vấn đề:** gốc riêng giải chuyện hai host **ghi đè file của nhau**; hai host với hai
thư mục khác nhau vẫn trỏ chung một gateway Modbus hoặc chung một cổng COM được — đó là ràng buộc triển khai
riêng, KHÔNG được thi hành, xem **§24.7**. 🔴 **OPC-UA ở biên: điều kiện chặn đã hết, việc thì chưa xong.**
Quyết định còn thiếu — *gốc dữ liệu theo host có phải hình dạng được hỗ trợ không?* — được trả lời ở đây:
**có**, và biến là `ST4I_OPCUA_PKI_DIR`. Cái còn lại là công việc kỹ thuật: host này chưa có `OpcUaOptions`
riêng (endpoint, node map, gốc PKI), chưa có nhánh dispatch, và chưa có test chứng minh hai host trỏ hai gốc
giữ được hai kho chứng chỉ. **Chỉ đặt `ST4I_OPCUA_PKI_DIR` thì KHÔNG bật được gì** — entry vẫn bị từ chối theo
tên, và chính thông điệp từ chối nói vậy.)*

#### 🔴 Which startup failures STOP this host, and which let it come up — the rule, and how it was measured

**EN** — Relocate two roots in one afternoon and you can get two different failure semantics, with nothing
telling you which you are about to get. This is the sentence that was missing. `FleetCore`'s P5 booked it as
an open item after two rulings landed in the same file, a thousand lines apart, looking like opposites: the
WAL root is created **unguarded** before the host serves anything (a root that cannot be created stops
startup), while a persisted settings triple that cannot be activated leaves the host **UP and reporting at
`Error`**. **They are not opposites. They are one rule applied to two different situations**, and the rule is:

> **A host refuses to start over a bad configuration only when starting would be the QUIETER failure.**

**The test — and it is ONE test, not two.** If either half of an older two-condition form is what you
remember, the second half was withdrawn; see the note below.

> **Would continuing HIDE the loss?** If whatever just stopped working would go on being presented as
> working — a record acknowledged but never made durable, a boundary reported but not enforced, a store whose
> absence nothing announces — then stopping is the only channel left, and the host stops. If the loss can be
> named on a surface somebody reads, and nothing left running claims the lost thing still works, then
> **coming up is the louder outcome** and the host comes up, keeps serving every endpoint, and says at
> `Error` or `Warning` what it could not use.

**Why the two headline cases are the same rule.** The WAL root stops because the alternative is silence: a
queue that quietly degrades to memory keeps returning successful acks for records that then die with the
process — invisible *in the outcome*. The persisted `fleet-settings.json` triple goes the other way because
*there* stopping **is** the silence: a dead service says nothing about which of three fields is wrong, while
a host that comes up names the failure at `Error` and goes on reporting the triple it holds truthfully.
**Both arms choose the louder failure.** That is the whole of it, and it is why neither ruling has to be
revisited.

🔴 **WHERE THE VALUE CAME FROM IS THE REASON, NOT A SECOND TEST — and this correction matters to you,
because it decides how you repair each arm.** An environment variable or an ACL you set is repaired with the
tool you set it with, and the next start retries. A file the product itself wrote is repaired *through the
product* — `PUT /v1/settings` for the settings triple — **or** by editing or deleting the file yourself,
which is exactly what that arm's own error message tells you to do. An earlier version of this section made
provenance a second required condition and said the settings arm failed "both conditions independently".
**That was wrong**: the value there *can* be corrected without the process, by the route the product names.
It is withdrawn as a test and kept as the reason the two arms feel like opposite rulings.

🔴 **THE DOMAIN OF THIS RULE — read this before extending it, because the rule is stated in a section about
roots and its domain is larger than roots.** The rule governs **startup-path configuration decisions**: every
statement a composition root executes before its host begins serving, at which a value obtained from outside
the running program — an environment variable, a file, a directory's existence or ACL, a command-line
argument, a store the product previously persisted — can fail to be usable, and where the code at that point
determines whether the process continues or ends. Roughly a third of that set is roots; the rest is argument
vectors, a bind address, register and node maps, `connectors.json`, `fleet.json`, the product and ecosystem
catalogues, persisted connector rows, a broker port, an ACL hardening step, five `FromEnvironment` factories
and the settings replay itself.

🔴 **The set is ENUMERATED — as a LIST, in `docs/startup-failure-posture.md` — and this section deliberately
stakes NO count.** An earlier version stated a scalar ("thirty-six sites, thirty-two agree, thirteen are
roots") in five places with the members written down nowhere the tree could reach. An independent
re-derivation then returned a different number and found two divergences the scalar had absorbed; and
"thirteen are roots" was refuted by this section's own two tables, since `creds` and `opcua-pki` are among
the thirteen while the table below declares them to have no startup decision, and `machine-config` is a
member of the set while not being one of the thirteen at all. **A summary contradicting the list it
summarises is the exact failure this artefact was written to end.** So: **the table immediately below is a
VIEW of that set projected onto the roots this section is otherwise about — it is not the set.** A later
change that reads this rule as "which roots crash the host" has to contradict a published **list**.

**What that means at each root — this is the table to read before relocating one.** "Stops" means the
process ends before it serves anything; "comes up" means every endpoint works and the failure is on the log.

| If this cannot be used at startup | What the host does |
|---|---|
| `security`, `historian`, `assets`, `machine-config` | **STOPS.** All would otherwise go on looking like they work |
| `settings` (the DIRECTORY) | **MIXED, and measured**: a directory that cannot be **created** stops the host; one that exists but cannot be **read** does **not** — the host comes up. *(Before task Q-1 the second arm then forked on whether the deny also reached the FILE, and one fork overwrote it. It no longer does: whatever the deny reaches, an unreadable file is reported and left alone — see the `fleet-settings.json` entry below.)* Directory-creation shape same as `identity` and `connector-config` below |
| `wal`, `sitelink` | **STOPS** — but only when that subsystem is on. `ST4I_WAL_ENABLED=0` removes the WAL decision entirely, and `sitelink` is only touched when the UNS spine is enabled (`ST4I_UNS_ENABLED`). Both default to on, so the common case is a stop |
| `products.json` / `recipes.json` / `ecosystem\*.json` beside the exe | **STOPS**, and this is one of the divergences — see the note after this table |
| `alarms`, and `security.db` itself | **STOPS**, a moment later — these open as the host starts rather than before it |
| `identity` | **MIXED, and read this one twice**: a directory that cannot be **created** stops the host; a directory that exists but cannot be **written** comes up on a fresh in-memory identity with an `Error` — a new device every start, which a Site that pinned the old fingerprint will refuse |
| `connector-config` | **MIXED**: a store that cannot be **opened** stops the host; one that opens but cannot be **read** comes up with no persisted connectors |
| `settings` (the FILE) | **Comes up and reports** (task Q-1). A `fleet-settings.json` that is present but cannot be read — a typo, a lock, a withheld permission — is applied to nothing, **left untouched on disk**, and named at `Error`. One that reads but cannot be **activated** comes up and reports too — that arm is the ruling above. *(Before Q-1 this row read "MIXED": some shapes stopped the host and one routed to the seed arm and overwrote the file. See `docs/startup-failure-posture.md` §3.1a for the measured table that is now history.)* |
| `notifications`, `bridge-spool`, the UNS broker port | **Comes up**, warns, that subsystem is off for the run |
| `connectors.json`, `fleet.json`, `ST4I_MODBUS_MAP`, `ST4I_OPCUA_MAP`, a persisted connector row | **Comes up**, warns, **only that source** disables itself. A connector that is configured but not running stays visible as exactly that — it is never shown as running |
| `creds`, `opcua-pki` | **No startup decision** — both are resolved when something uses them, not while the host starts |
| `ASPNETCORE_URLS` / `--urls` | **STOPS** — the bind failure is Kestrel's, not this product's, and it arrives after everything above has already succeeded |

**The instrument, and its ceiling — said plainly so nobody inherits this table as a certainty.** The first
one is a READ of the four composition roots (`St4i.EngineApi/Program.cs`, `St4i.EdgeService`'s `Program.cs` +
`EdgeWorker`, `St4iMachineSimulator/App.xaml.cs`, `St4i.DesktopShell/App.xaml.cs`) plus every store
constructor and options factory they reach, asking at each statement whether a failure is caught. **Nothing
was executed to produce it**, and it produced every row. 🔴 **A second instrument now exists and RUNS:
`tools/settings-acl-probe`** (task M-1) — a committed console app outside the five test suites. **A THIRD
runs too** (task Q-1): the five test suites, whose witnesses are indexed on the settings-file row and the
Site-link row. 🔴 **Three instruments — and NO TOTAL is offered for how many rows an execution backs.** The
probe's reach is enumerable (it is one program with named passes) and is two rows; the suites' reach is
**not** enumerable from here, so counting it produces a number nobody has measured. That count has been
stated wrongly twice. What is derivable is a **lower bound**: **at least five rows are backed by an
execution.** `docs/startup-failure-posture.md`'s header carries the derivation; prefer it to any scalar.
The probe answers
**two** rows and no others: what curtailed access to the settings root or file actually does, and whether a
throwing `ApplicationStarted` handler ends the host (it does not — the host serves, and the framework logs
the throw at `Critical`). **Even in those two rows it measures the STORE, not the host** — no arm of it
starts `St4i.EngineApi`, so "stops" versus "comes up" is still read off the composition root and mapped onto
a measured outcome. What a read cannot see is the part of the DI graph resolved **lazily, after the host has
started** — a factory that throws on its first resolution fails a request rather than the boot, and lands in
no row above.

🔴 **Places that do NOT follow the rule. Named here rather than changed, because flipping any of them is an
operator-observable startup change and none has a one-line fix.** The full statement of each is in
`docs/startup-failure-posture.md`; this is what an operator needs.
🔨 **One of them HAS now been changed** — the settings-file entry immediately below, by task Q-1 under the
owner's decision of 2026-08-16. It was flipped precisely *because* it was an operator-observable startup
change: the observable it changed was operator data being destroyed. The sentence above still holds of every
remaining entry, and none of those is fixed.

- ~~**`fleet-settings.json` is READ unguarded**~~ 🔨 **FIXED (task Q-1). It used to be the worst entry in
  this list and it is kept here, corrected, because an operator who read the old one needs to know it no
  longer applies.** Until this fix, a `fleet-settings.json` that could not be read — most likely a **typo in
  a file you hand-edited** — was treated as *no file at all*, and the "no file" branch is the one that is
  allowed to write. **Two harms, both measured:** your file was **overwritten with the environment floor on
  an ordinary successful start**, silently, whenever at least one of `ST4I_SERVER_URL` /
  `ST4I_MACHINE_CODE` / `ST4I_VERIFY_TLS` was set — which is exactly the headless service install those
  variables exist for; and on a narrower path it was **deleted while the log said nothing you wrote had been
  deleted**.
  **What happens now:** the host **comes up**, applies **nothing** (not the file, and not the environment
  floor either — the file wins whenever there is one, and there is one), leaves your file **exactly as it
  is**, and says so at `Error`, naming the file. Repair it and restart, or set the values with
  `PUT /v1/settings`. `GET /v1/settings` reports what the process is actually running on, which is its
  built-in defaults, and never claims your file was applied.
  **Advice that has not changed: if you hand-edit `fleet-settings.json`, keep a copy** — the same advice
  this section gives for `products.json`, and it is still the cheapest insurance.
  Full history, the measured permission/lock table behind it, and what the fix costs:
  `docs/startup-failure-posture.md` §3.1a and §3.1a-now.
- 🔨 **`site-link.json` had the SAME defect, and it was worse — also FIXED (task Q-1, fix round).** An
  unreadable Site link was rewritten with the default standalone record on an ordinary successful start:
  **the Site broker host, its port and the trust certificate you pinned were gone**, the device quietly
  stopped federating, and **there was no log line at all** — the overwrite succeeded, so nothing reported it.
  Unlike the settings file above, this needed **no environment variable set**: the local UNS spine that
  reaches this code is on by default. **What happens now:** the host comes up, applies nothing, leaves your
  file exactly as it is, and says at `Error` that the device is running **standalone**; `GET /v1/site`
  reports that truthfully rather than claiming a link. Repair it and restart, or set the link with
  `PUT /v1/site`. **If you hand-edit `site-link.json`, keep a copy.** One route is knowingly still open and
  is on the owner's list: rotating the device identity (`POST /v1/site/identity/rotate`) while the file is
  unreadable still overwrites it. `docs/startup-failure-posture.md` §3.1b.
- **Two operator-editable catalogues end the process**: `products.json`/`recipes.json` and the ecosystem
  files beside the exe are deserialized with no error handling at all, so one typo in a file with no
  published schema stops the host — while `connectors.json` and `fleet.json`, the same kind of file in the
  same folder, are tolerated and warn. If you hand-edit those catalogues, **keep a copy**.
- **The identity directory decides one variable three ways**: a root that cannot be *created* stops the
  host; one that exists but cannot be *written* comes up on a temporary identity and says so; and a
  certificate-mint failure stops the host uncaught.
- **An unparseable numeric environment variable is silently ignored — in nine places**, across the WAL, UNS,
  Modbus, bridge-spool and alarm knobs. A typo in any of them takes effect as the default with **no warning
  anywhere**, while an out-of-range value in the same variable stops the host. **Check these by reading the
  startup log for the value you expect, not by assuming a bad one would complain.**

One further finding is a **symmetry defect rather than a rule divergence**: the connector-configuration
store is opened unguarded while the notification store — same shape, same file — is wrapped, under a comment
claiming *every* startup config load shares that posture. It does not. The reason is that the notification
endpoints tolerate a missing store and the connector endpoints require one, so there is no "absent" state to
fail into; guarding it means building that state first.

*(VI: 🔴 **Lỗi khởi động nào DỪNG host, lỗi nào cho host lên — quy tắc, và cách đo.** Dời hai gốc trong một
buổi chiều là có thể nhận hai ngữ nghĩa lỗi khác nhau mà không chỗ nào báo trước. Đây là câu còn thiếu ấy.
P5 của `FleetCore` đã ghi nợ nó: hai phán quyết nằm trong cùng một file, cách nhau nghìn dòng, **trông** như
ngược nhau — gốc WAL không tạo được thì **chặn khởi động**; bộ ba settings đã lưu mà không kích hoạt được thì
host **VẪN LÊN và báo ở mức `Error`**. **Chúng KHÔNG ngược nhau. Chúng là MỘT quy tắc áp lên hai tình huống
khác nhau:** > **Một host chỉ từ chối khởi động vì cấu hình sai khi việc khởi động lên mới là cái thất bại
IM LẶNG HƠN.** 🔴 **PHÉP KIỂM là MỘT phép kiểm, không phải hai:** *chạy tiếp có GIẤU mất mát không?* Thứ vừa
hỏng có tiếp tục được trình bày như đang chạy không — một bản ghi đã ack mà không hề bền, một ranh giới được
báo mà không được thi hành, một store mà sự vắng mặt không ai công bố? Nếu có, dừng lại là kênh duy nhất còn
lại. Nếu mất mát ấy gọi tên được trên một bề mặt có người đọc, và không thứ gì còn chạy dám nói cái đã mất vẫn
hoạt động, thì **lên mới là cái ồn hơn**: host lên, phục vụ đủ mọi endpoint, và nói ra thứ nó không dùng được.
**Vì sao hai ca nổi tiếng là cùng một quy tắc:** gốc WAL chặn khởi động vì lựa chọn còn lại là sự im lặng —
một hàng đợi lặng lẽ tụt xuống bộ nhớ vẫn trả ack thành công cho những bản ghi rồi sẽ chết theo tiến trình.
Bộ ba `fleet-settings.json` đi hướng ngược lại vì ở **đó** dừng lại MỚI là sự im lặng: một dịch vụ đã chết
không nói được trường nào trong ba trường sai, còn một host lên được thì gọi tên lỗi ở mức `Error` và vẫn báo
đúng bộ ba nó đang giữ. **Cả hai nhánh đều chọn cái thất bại ỒN HƠN.**
🔴 **GIÁ TRỊ ĐẾN TỪ ĐÂU là LÝ DO, KHÔNG phải phép kiểm thứ hai — và đính chính này liên quan trực tiếp tới
bạn, vì nó quyết định cách SỬA từng nhánh.** Biến môi trường hay ACL do bạn đặt thì sửa bằng đúng dụng cụ đã
đặt, lần khởi động sau tự thử lại. File do chính sản phẩm ghi thì sửa **qua sản phẩm** (`PUT /v1/settings`)
**hoặc** tự tay sửa/xoá file — đúng như thông điệp lỗi của nhánh ấy đã bảo bạn làm. Một bản trước của mục này
đã biến điều đó thành **điều kiện thứ hai bắt buộc** và nói nhánh settings "sai cả hai điều một cách độc lập".
**Sai**: ở đó giá trị **sửa được** mà không cần tiến trình, bằng chính con đường sản phẩm nêu ra. Đã rút nó
khỏi vai trò phép kiểm, giữ lại làm lý do khiến hai nhánh trông như hai phán quyết ngược nhau.
🔴 **MIỀN CỦA QUY TẮC — đọc trước khi mở rộng nó**, vì quy tắc đang được phát biểu trong một mục nói về các
GỐC, còn miền của nó **rộng hơn các gốc**. Miền là **các quyết định cấu hình trên đường khởi động**: mọi câu
lệnh một composition root chạy trước khi host của nó bắt đầu phục vụ, tại đó một giá trị đến từ ngoài chương
trình đang chạy — biến môi trường, một file, sự tồn tại hay ACL của một thư mục, một tham số dòng lệnh, một
store sản phẩm đã lưu trước đó — có thể không dùng được, và đoạn mã ở đó quyết định tiến trình đi tiếp hay
kết thúc. Khoảng một phần ba là gốc; phần còn lại là tham số dòng lệnh, một địa chỉ bind, các file map,
`connectors.json`, `fleet.json`, các catalogue sản phẩm và ecosystem, các dòng connector đã lưu, một cổng
broker, một bước siết ACL, năm factory `FromEnvironment`, và chính lượt phát lại settings.
🔴 **Tập ấy được LIỆT KÊ — thành một DANH SÁCH, trong `docs/startup-failure-posture.md` — và mục này CỐ Ý
KHÔNG chốt con số nào.** Bản trước ghi một con số vô hướng ("ba mươi sáu chỗ, ba mươi hai tuân thủ, mười ba là
gốc") ở năm nơi trong khi **các thành viên không được viết ra ở bất kỳ đâu cây mã với tới được**. Một lượt
suy lại độc lập sau đó ra con số khác và tìm thấy **hai chỗ lệch mà con số ấy đã nuốt mất**; còn "mười ba là
gốc" thì bị **chính hai cái bảng của mục này bác**: `creds` và `opcua-pki` nằm trong mười ba nhưng bảng dưới
tuyên bố chúng **không có quyết định nào lúc khởi động**, còn `machine-config` là thành viên của tập mà lại
**không** thuộc mười ba. **Một bản tóm tắt mâu thuẫn với chính danh sách nó tóm tắt** đúng là thứ artefact này
sinh ra để chấm dứt. Vậy: **bảng bên dưới là một LÁT CẮT của tập ấy chiếu lên các gốc mà mục này vốn nói tới —
nó KHÔNG PHẢI là tập.** Một thay đổi sau này đọc quy tắc thành "gốc nào làm sập host" sẽ phải **bác một DANH
SÁCH đã công bố**. **Bảng ở bản EN là thứ phải đọc trước khi dời một gốc**, và lưu ý hai điều bảng ấy nói rõ:
`wal` và `sitelink` chỉ DỪNG khi hệ con đó đang bật (`ST4I_WAL_ENABLED`, `ST4I_UNS_ENABLED`); `creds` và
`opcua-pki` không có quyết định nào lúc khởi động. **Dụng cụ và trần của nó, nói thẳng:** dụng cụ THỨ NHẤT là
một lượt ĐỌC bốn composition root cộng mọi constructor store và factory options mà chúng với tới — **không
chạy gì cả** — và nó sinh ra mọi hàng trong danh sách. 🔴 **Dụng cụ THỨ HAI, do nhiệm vụ M-1 thêm, là một
phép CHẠY: `tools/settings-acl-probe`** — một console app đã commit, ngoài năm bộ test, trả lời đúng **HAI**
hàng (§3.1a và hàng `ApplicationStarted`) và **không hàng nào khác**. 🔴 **Dụng cụ THỨ BA, do Q-1 thêm, cũng
CHẠY:** năm bộ test, với nhân chứng cắm vào hàng file settings và hàng Site-link. 🔴 **BA dụng cụ — và
KHÔNG chốt một TỔNG SỐ nào** cho việc bao nhiêu hàng được một phép chạy chống lưng. Tầm với của bộ dò thì
**liệt kê được** (nó là MỘT chương trình với các lượt chạy có tên) và bằng hai hàng; tầm với của năm bộ
test thì **KHÔNG** liệt kê được từ đây, nên đếm nó ra một con số là đưa ra thứ chưa ai đo. Con số ấy **đã
bị nói sai hai lần**. Thứ suy ra được là một **CẬN DƯỚI**: **ít nhất NĂM hàng** có một phép chạy chống
lưng. Phần dẫn giải nằm ở đầu `docs/startup-failure-posture.md`; hãy đọc nó thay vì tin một con số. Thứ một lượt đọc không thấy là phần đồ
thị DI được phân giải **muộn, sau khi host đã lên**. Hàng từng được đánh dấu **chưa ngã ngũ** thì **đã chạy
và đã ngã ngũ**: một ngoại lệ ném ra từ handler `ApplicationStarted` **KHÔNG** làm chết host — host vẫn phục
vụ, và framework tự ghi lỗi ấy ở mức `Critical`.
🔴 **Những chỗ KHÔNG theo quy tắc — nêu tên chứ không sửa**, vì lật chỗ nào cũng là thay đổi quan sát được
trên đường khởi động và không chỗ nào có bản sửa một dòng. Bản đầy đủ nằm trong artefact; đây là phần người
vận hành cần.
🔨 **MỘT chỗ trong số đó thì ĐÃ được sửa** — mục file settings ngay dưới đây, bởi nhiệm vụ Q-1 theo phán
quyết của chủ sở hữu ngày 2026-08-16. Nó được lật **chính vì** đó là một thay đổi quan sát được trên đường
khởi động: thứ quan sát được mà nó đổi là **dữ liệu của người vận hành bị phá huỷ**. Câu trên vẫn đúng với
mọi mục còn lại, và không mục nào trong số đó được sửa.
🔨 **`fleet-settings.json` — ĐÃ SỬA (nhiệm vụ Q-1). Mục này từng là mục nặng nhất trong danh sách, và nó
được GIỮ LẠI ở đây kèm đính chính, vì người đã đọc bản cũ cần biết bản cũ không còn đúng.** Trước bản sửa,
một `fleet-settings.json` **không đọc được** — dễ xảy ra nhất là **một lỗi gõ trong file bạn tự sửa tay** —
bị đối xử như **không có file**, mà nhánh "không có file" chính là nhánh **được phép ghi**. **Hai tác hại,
cả hai đều đã đo:** file của bạn bị **GHI ĐÈ bằng sàn môi trường trong một lần khởi động THÀNH CÔNG bình
thường**, im lặng, chỉ cần **ít nhất MỘT** trong `ST4I_SERVER_URL` / `ST4I_MACHINE_CODE` /
`ST4I_VERIFY_TLS` được đặt — đúng kiểu cài headless mà ba biến ấy sinh ra để phục vụ; và trên một đường hẹp
hơn, file bị **XOÁ trong khi log ghi rằng không có gì bạn viết bị xoá**.
**Bây giờ thì sao:** host **vẫn lên**, **không áp gì cả** (không áp file, và cũng **không áp sàn môi
trường** — file thắng bất cứ khi nào có file, mà ở đây có), **giữ nguyên file của bạn**, và **nói ra ở mức
`Error`**, gọi đúng tên file. Hãy sửa file rồi khởi động lại, hoặc đặt giá trị bằng `PUT /v1/settings`.
`GET /v1/settings` báo đúng thứ tiến trình đang thực sự chạy (các giá trị mặc định dựng sẵn) và **không bao
giờ** tuyên bố file của bạn đã được áp.
**Lời khuyên KHÔNG đổi: nếu bạn sửa tay `fleet-settings.json`, hãy giữ một bản sao** — đúng lời khuyên mục
này đã dành cho `products.json`, và nó vẫn là bảo hiểm rẻ nhất. Toàn bộ lịch sử, bảng đo về quyền/khoá đứng
sau nó, và cái giá của bản sửa: `docs/startup-failure-posture.md` §3.1a và §3.1a-now.
🔨 **`site-link.json` CÓ ĐÚNG khuyết tật ấy, và còn NẶNG HƠN — cũng ĐÃ SỬA (Q-1, vòng sửa lỗi).** Một Site
link không đọc được bị ghi đè bằng bản ghi mặc định "đứng một mình" trong một lần khởi động **thành công
bình thường**: **host của broker Site, cổng, và chứng chỉ tin cậy bạn đã ghim đều mất**, thiết bị lặng lẽ
thôi federate, và **không một dòng log nào** — vì lệnh ghi đè THÀNH CÔNG nên không có gì báo cả. Khác với
file settings ở trên, chỗ này **không cần đặt biến môi trường nào**: hệ UNS cục bộ dẫn tới đoạn mã ấy vốn
BẬT theo mặc định. **Bây giờ thì:** host vẫn lên, **không áp gì cả**, **giữ nguyên file của bạn**, và nói ở
mức `Error` rằng thiết bị đang chạy **ĐỘC LẬP**; `GET /v1/site` báo đúng điều đó chứ không tuyên bố có link.
Hãy sửa file rồi khởi động lại, hoặc đặt link bằng `PUT /v1/site`. **Nếu bạn sửa tay `site-link.json`, hãy
giữ một bản sao.** Một đường vẫn **cố ý còn mở** và đã nằm trong danh sách của chủ sở hữu: xoay danh tính
thiết bị (`POST /v1/site/identity/rotate`) trong lúc file không đọc được thì vẫn ghi đè lên nó.
`docs/startup-failure-posture.md` §3.1b.
**Hai catalogue người vận hành sửa được thì làm chết tiến trình**:
`products.json`/`recipes.json` và các file ecosystem cạnh .exe được deserialize **không có bắt lỗi nào**, nên
một lỗi gõ trong một file **không có schema công bố** sẽ chặn host — trong khi `connectors.json` và
`fleet.json`, cùng loại file cùng thư mục, thì được dung thứ kèm cảnh báo; nếu bạn sửa tay hai catalogue ấy,
**hãy giữ một bản sao**. Thư mục `identity` quyết định **ba kiểu** cho cùng một biến: không TẠO được thì chặn
host; tạo được mà không GHI được thì lên bằng danh tính tạm và nói ra; còn lỗi khi đúc chứng chỉ thì chặn host
không ai bắt. Và **một biến môi trường dạng số không parse được thì bị bỏ qua trong im lặng — ở CHÍN chỗ**
(WAL, UNS, Modbus, bridge-spool, và các ngưỡng alarm): một lỗi gõ có hiệu lực như giá trị mặc định mà **không
cảnh báo ở đâu cả**, trong khi cùng biến ấy nếu parse được mà ngoài khoảng thì chặn host — **hãy kiểm bằng
cách đọc log khởi động tìm giá trị bạn mong đợi, đừng cho rằng giá trị sai sẽ tự kêu**. Một phát hiện nữa là
**lệch đối xứng chứ không phải lệch quy tắc**: store cấu hình connector **được MỞ không bọc** trong khi store
thông báo — cùng hình dạng, cùng file — thì có bọc, dưới một chú thích khẳng định **mọi** lượt nạp cấu hình
lúc khởi động đều cùng lập trường ấy; không phải vậy. Lý do là endpoint thông báo chấp nhận thiếu store còn
endpoint connector thì bắt buộc phải có, nên **không có trạng thái "vắng mặt"** để rơi vào — bọc nó nghĩa là
phải dựng trạng thái ấy trước.)*

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

🔴 **THIS SPINE IS NOT A CONFORMANT SPARKPLUG B NODE, AND THAT IS AN ACCEPTED DEBT RATHER THAN AN
OVERSIGHT — recorded here 2026-08-23 (owner-decisions.md item 35).** Three Sparkplug message types leave
this spine and the list above is all of them: **NBIRTH**, **NDEATH**, **DDATA**. It publishes **no
DBIRTH and no DDEATH** — the publish path for both was removed on 2026-08-21 under the owner's item-23
ruling, and `SparkplugMsgType` still declares the two members as vocabulary with no producer. Under the
Sparkplug B specification a device that never sent a birth certificate is **not valid**: a strict host
(Ignition, HiveMQ) treats it as unknown/STALE and will typically drop or refuse to register it, *while
this spine keeps pushing DDATA on the device-level topic for exactly those devices*.

**The ceiling on that statement, both halves.** What is broken is **spec conformance and host-side
device discovery — not decodability**: `SparkplugPayload.EncodeMetric` writes both `Name` and `Alias` on
every metric unconditionally, so a subscriber can decode this spine's DDATA in full without ever seeing
a DBIRTH. And the other half, left as a hole rather than filled with a guess: **whether any real
subscriber is affected has not been measured from this repository.** Closing the debt means putting a
new message type on the wire for subscribers that have never received one, which is a change to the
MQTT payload surface and needs an owner ruling; it is not scheduled here.

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

🔴 *(VI: **XƯƠNG SỐNG NÀY KHÔNG PHẢI MỘT NODE SPARKPLUG B TUÂN ĐẶC TẢ, và đó là một MÓN NỢ ĐÃ NHẬN chứ
không phải một chỗ sót — ghi ngày 2026-08-23, mục 35 của `docs/owner-decisions.md`.** Đúng **BA** loại
thông điệp Sparkplug rời xương sống này và danh sách trên là đủ cả ba: **NBIRTH**, **NDEATH**, **DDATA**.
Nó **KHÔNG phát DBIRTH và KHÔNG phát DDEATH** — đường phát của cả hai đã bị gỡ ngày 2026-08-21 theo phán
quyết mục 23 của chủ sở hữu, và `SparkplugMsgType` vẫn khai hai thành viên ấy như từ vựng **không có bộ
sinh**. Theo đặc tả Sparkplug B, một device chưa từng gửi giấy khai sinh là **KHÔNG HỢP LỆ**: một host
nghiêm (Ignition, HiveMQ) coi nó là không biết / STALE và thường bỏ hoặc từ chối đăng ký nó, *trong khi
xương sống này vẫn đẩy DDATA trên topic mức device cho đúng những device ấy*.
**Cái trần của câu trên, cả hai nửa.** Cái hỏng là **TUÂN THỦ ĐẶC TẢ và việc host khám phá device — KHÔNG
phải khả năng giải mã**: `SparkplugPayload.EncodeMetric` ghi **cả `Name` lẫn `Alias`** trên mọi metric vô
điều kiện, nên một subscriber giải mã được DDATA đầy đủ mà không cần DBIRTH nào. Và nửa còn lại, để
NGUYÊN là một chỗ trống thay vì lấp bằng suy đoán: **có người đăng ký thật nào bị ảnh hưởng hay không thì
CHƯA ĐO ĐƯỢC từ repo này.** Đóng món nợ đòi đặt một loại thông điệp MỚI lên dây cho những subscriber chưa
từng nhận nó — tức đổi bề mặt payload MQTT — nên nó cần một phán quyết của chủ sở hữu; ở đây không lên
lịch cho nó.)*

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

**The XC-R40 boundary** — read this before treating the halt latch as more than it is (SM-4/B-8: see
§1's safety notice for the full statement): it is a **SUPERVISORY software latch**, not a substitute for
a machine's independent, safety-rated emergency-stop circuit (a hardwired circuit per ISO 13849), and
must never be relied on as a protective safety function. **This product now has a real write path**
(§21 — Modbus/OPC-UA setpoints and commands), but this latch itself never touches it — see §1 for why
that stays deliberate rather than a gap now that writing is possible; `/v1/safety` itself carries this
exact reasoning in its response string (`SafetyEndpoints.XcR40Advisory`). `GET /v1/safety` is
**read-only by design** — there is deliberately no write route on THIS endpoint (the machine-control
write routes live at `POST /v1/machines/{code}/setpoint`/`.../command`, §21, an entirely separate
surface). The only two ways to change the underlying latch remain the pre-existing operator
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
toàn độc lập của máy (mạch cứng theo ISO 13849) — không bao giờ được coi là chức năng an toàn bảo vệ.
**Sản phẩm này GIỜ có đường ghi thật** (§21 — setpoint/lệnh Modbus/OPC-UA), nhưng bản thân chốt này
không bao giờ chạm vào đường ghi đó — xem §1. Tên gọi mà người vận hành nhìn
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
  - `type` — `"Holding"` (FC03, read/write on the real device) or `"Input"` (FC04, read-only) — the
    driver polls every register the same way regardless of type; only a `Holding` register can
    additionally declare `"writable"` (below), which makes the driver execute a real write
    (`WriteSingleRegisterAsync`) to it — an `"Input"` register can never be declared writable (rejected
    at parse time) — see §21 for the full write path.
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
write/command capability, executed by `ModbusTcpDriver` since B-4 (§21 has the full write-path
writeup).** Two OPTIONAL additions, both
absent from every register-map ever accepted before this task and both a no-op for a map that never sets
them (a map with neither is a read-only connector exactly as before):

- A `Holding` register may add `"writable": { "min": <number>, "max": <number> }` — declares that register
  as a writable setpoint named by its own `metric`, with **mandatory** physical bounds (engineering units,
  the same domain `scale` already reads in): a writable register missing either bound, an `"Input"` register
  declared writable, a zero/non-finite `scale`, or a declared range that overflows the register's own
  `dataType` once inverse-scaled (÷`scale`, rounded) is **rejected at parse time**, naming the offending
  point — never silently treated as unbounded.
- A top-level `"commands": [ { "name": "...", "coilAddress": <ushort>, "arguments": [ { "name": "...",
  "type": "Bool" | "Int16" | "UInt16" | "Int32" | "UInt32" | "Double" | "String", "min"?: <number>,
  "max"?: <number> }
  ] } ]` declares a named coil-pulse command (mirroring a real vendor's "start cycle" button) and its
  argument types — every argument value a future driver receives is narrowed against the declared type
  (an OPC-UA-style boxed integer is re-narrowed to the exact declared width) before it could ever reach a
  device. `min`/`max` are meaningful only for the four integral types and `Double`; declaring either on a
  `Bool` or a `String` argument is rejected at parse time. 🔴 **`"String"` added 2026-08-22
  (owner-decisions.md item 36).** This list said SIX types and `St4i.Connector.Abstractions.CommandArgumentType`
  has SEVEN — `String` is accepted by `CommandArgumentDeclaration.ValidateSelf`, which is the one check both
  maps' `FromJson` run over a command argument, and it narrows in `TryNarrow` like any other member. A
  published CLOSED SET stated one member short is a claim an integrator acts on. (The `writable` `valueType`
  list in §16.6 is a DIFFERENT set and is correctly six: `OpcUaNodeMap.FromJson` rejects a `String` setpoint
  explicitly, and that asymmetry is deliberate — see §16.6.)

Neither declaration performs any I/O by itself — `ModbusRegisterMap` stays a plain, throwing parse
function, exactly as before. `ModbusTcpDriver` is the one that acts on what a map declares: it still
polls every register (writable or not) exactly like before, and additionally executes a real write
(`WriteSingleCoilAsync`/`WriteSingleRegisterAsync`) for a point/command this same map marks writable,
since B-4 (§21).

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
register, per poll) are follow-ups, not built;
there is no per-machine `MappingProfile` override for Modbus yet (it uses one shared `Automation`-class
fallback profile for every Modbus machine today).

> 🔴 **Modbus RTU status, corrected (Đợt D task D-7c).** This paragraph used to say "**Modbus RTU
> (serial)** is not implemented — TCP only". That is no longer true, and the correction matters because
> the sentence is one an integrator would act on. RTU ships in two transports, declared by a `transport`
> field inside a Modbus entry's `settings` in `connectors.json` (§16.7 covers that file's general
> mechanics — loading, precedence, per-entry failure — but **says nothing about RTU**; the RTU schema is
> stated here and nowhere else until D-7b's documentation census lands):
> `"rtu-gateway"` (RTU framing over a TCP serial device server: `host` + `port`) and `"rtu-serial"`
> (a **directly-attached COM port**: `portName`, plus optional `baudRate`/`parity`/`dataBits`/`stopBits`,
> defaulting to MODBUS-over-Serial-Line's **19200-8-E-1** rather than `SerialPort`'s own 9600-8-N-1).
> One entry declares a whole multidrop **bus**: its `devices` array — required, **even for a single
> device** — fans out into one connector instance per device, all sharing one open port and one
> arbitration lock. Bus-level keys go beside `devices`, never inside an element, and an unrecognised or
> misspelled key is **refused** rather than silently ignored.
>
> **Three limits, stated here rather than discovered on a bench.** (1) **RS-485 direction control must be
> AUTOMATIC** (auto-DE / TXDEN adapters). This product drives no transmit-enable line and cannot —
> `System.IO.Ports` exposes no transmit-complete signal, so a software RTS turnaround could only be a
> timing guess, and a wrong guess corrupts another device's frame on the same segment. An adapter needing
> manual DE will not transmit at all; the engine logs this caveat once per serial bus at start-up.
> (2) **No Modbus frame has ever crossed the serial transport against real hardware.** The seam, the
> exclusive open, the cancellation latency and the drain primitive were measured against a real COM port
> by a standalone probe, and the RTU framing is exercised end to end against an in-memory paired
> transport — neither is a wire. A bench acceptance step with a real RS-485 device remains outstanding.
> 🔴 (3) **ONE HOST PER SEGMENT, and nothing enforces it — see §24.7, which is the full statement.**
> Since Đợt E both `St4i.EngineApi` and `St4i.EdgeService` can be configured onto the same segment from
> their own `connectors.json`. On a directly attached COM port the OPERATING SYSTEM refuses the second
> open — incidentally, not by this product's design. **On an `rtu-gateway` bus nothing refuses at all:**
> both hosts connect, neither can see the other, and a stray frame that matches on slave address,
> function code and byte count is handed back **as the answer** (§24.7 carries the probe). This limit is
> listed here because §16.4 is where an integrator configures a bus, and it was reachable only from §24
> until the Đợt F branch review.
>
> *(VI: đoạn trên trước đây ghi "Modbus RTU (nối tiếp) chưa có" — nay đã sai. RTU chạy được với HAI
> transport khai trong `connectors.json`: `"rtu-gateway"` (qua serial device server TCP) và
> `"rtu-serial"` (cổng COM cắm thẳng). BA giới hạn: chỉ hỗ trợ adapter RS-485 **tự động đảo chiều**;
> **chưa từng có khung tin nào chạy qua transport nối tiếp trên phần cứng thật** — vẫn còn một bước
> nghiệm thu trên bàn; và 🔴 **MỘT HOST MỘT SEGMENT, không gì thi hành điều đó** — trên cổng COM là hệ
> điều hành từ chối lần mở thứ hai (tình cờ, không do sản phẩm), còn trên `rtu-gateway` thì **không ai
> chặn**: xem **§24.7**, đó mới là phát biểu đầy đủ.)*

*(VI: `St4i.EdgeCore.Drivers.Modbus` là driver giao thức trường thật đầu tiên — vòng lặp poll TCP định
kỳ (NModbus) đọc danh sách thanh ghi cố định từ một Modbus TCP slave, chạy trong pipeline slot cách ly
lỗi riêng (§16.3). **MẶC ĐỊNH TẮT** — ngược cực với UNS spine. 4 biến môi trường `ST4I_MODBUS_*` (bảng
trên). Định dạng JSON register-map: `machineCode`, `unitId` (mặc định 1), `pollIntervalMs` (mặc định
1000), `readTimeoutMs`/`retries` *(tuỳ chọn, Task 9 — xem đoạn "follow-up rollout" bên dưới; sai định dạng
thì rơi về mặc định suy ra + log cảnh báo, KHÔNG làm hỏng cả map, giới hạn trên lần lượt 60 000ms/5)*,
`registers[]` gồm `address`/`type` (Holding FC03 hoặc Input FC04 — driver luôn ĐỌC mọi thanh ghi như
nhau bất kể loại; riêng Holding có thể khai `writable` để driver thực thi GHI thật qua
`WriteSingleRegisterAsync`, Input không bao giờ khai writable được, xem §21)/`dataType`
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

**Những gì CHƯA làm** (đã ghi rõ trong code, không giấu): thanh ghi 32-bit/float, đọc theo khối; chưa có
`MappingProfile` riêng cho từng máy Modbus. (Modbus RTU nối tiếp ĐÃ GIAO ở Đợt D — xem khối đính chính
tiếng Anh ngay phía trên.))*

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

**Task B-3 — declarative write/command capability, executed by `OpcUaDriver` since B-5** (see task-5-report.md;
§21 has the full write-path writeup for both protocols, B-8's coordinated cleanup of every "no driver
executes this yet" framing this section and §16.4 above used to share): a node may add `"writable": { "valueType": "Bool" |
"Int16" | "UInt16" | "Int32" | "UInt32" | "Double", "min": <number>, "max": <number> }` — `valueType` must be
`Bool` or numeric; a **string** writable node remains unsupported (its domain isn't similarly bounded). For a
numeric `valueType`, `min`/`max` are **mandatory** and must fit within that type's own representable range;
for `Bool`, `min`/`max` must be **absent** (a boolean's domain `{false,true}` is already exhaustively
bounded — a *stronger* bound than any numeric range, not a missing one — B-3 fix round 1 overruled the
original numeric-only restriction for exactly this reason: rejecting Bool would have pushed ordinary
enable/disable and mode-select writes into the command lane, which B-6 gates at a stricter role, a safety
regression rather than conservatism). Both are validated at parse time exactly like Modbus's `writable`
above. A top-level `"commands": [ { "name": "...",
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
for exactly this driver's own `TransportQuotas.OperationTimeout` (**15 000 ms**, the default of
`OpcUaDriver`'s `operationTimeoutMs` constructor parameter — a caller may pass another value, and no env
var or setting does) **regardless of cancellation** — five times `FleetHost`'s own
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

> 🔴 **§16.4 and §16.6 now have a witness — and the reason they needed one is written above them, dated.**
> Until 2026-08-22 these two sections were a HAND-KEPT third copy of `ModbusOptions` / `OpcUaOptions` /
> `ModbusRegisterMap` / `OpcUaNodeMap`, and `ModbusOptions`' own doc comment said so in as many words:
> *"The README tables remain a hand-kept copy with no witness: nothing goes red if they drift, and that is
> still true."* Two facts were already wrong when that witness was finally built, and each is retracted at
> the sentence that carried it rather than only here: (1) §16.6 called the 15-second endpoint-selection
> bound **"hardcoded"** — it has been `OpcUaDriver`'s `operationTimeoutMs` constructor parameter since Task
> B-5, and only the "no env var / no setting" half survived; (2) §16.4's command-argument `"type"` list
> named **six** of `CommandArgumentType`'s **seven** members.
> `St4i.EngineApi.Tests/DriverDocumentationTests` is the witness: it derives the eight `ST4I_*` variable
> names, the two Modbus defaults, the two register-map guards, the OPC-UA PKI root, the stack version, the
> operation-timeout value and both declared type sets FROM THE CODE, and compares each against what these
> two sections spell. **What it does NOT reach, stated because a ceiling put too low is worse than none:**
> it pins values and name sets, not prose. Every rationale paragraph, every deferral list and every
> "honest limitation" in these two sections remains unwitnessed, exactly as before — a rewrite that keeps
> the numbers and inverts a claim stays green.
>
> *(VI: §16.4/§16.6 nay CÓ nhân chứng — `St4i.EngineApi.Tests/DriverDocumentationTests` — vì tới 2026-08-22
> chúng vẫn là bản chép tay thứ ba, không dụng cụ nào giữ. Hai chỗ đã trôi, mỗi chỗ được rút tại câu mang
> nó: chữ **"hardcoded"** cho ngưỡng 15 giây (thực ra là tham số constructor `operationTimeoutMs` từ Task
> B-5), và danh sách kiểu tham số lệnh của §16.4 nêu **sáu** trong **bảy** thành viên
> `CommandArgumentType`. **Nhân chứng KHÔNG với tới văn xuôi** — nó ghim GIÁ TRỊ và TẬP TÊN; mọi đoạn lý
> lẽ, mọi danh sách "chưa làm" trong hai mục này vẫn không có nhân chứng.)*

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
`TransportQuotas.OperationTimeout` của chính driver này (**15 000 ms**, giá trị mặc định của tham số
constructor `operationTimeoutMs` trên `OpcUaDriver` — người gọi truyền giá trị khác được, nhưng KHÔNG có
biến môi trường hay cài đặt nào đổi nó) **bất kể có huỷ hay không** — gấp 5 lần ngân sách teardown 3 giây của
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
- **Precedence when both an env var and a `connectors.json` entry configure the same connector: the env
  var always wins**, and the conflicting `connectors.json` entry is skipped with a logged warning naming
  the conflict — this is what keeps "an existing install with only the four env vars set behaves
  byte-identically" true even after that install later gains an unrelated `connectors.json`. Two entries
  for the same connector are similarly de-duplicated (first one in the file wins, the rest are skipped
  with a warning).

  > 🔴 **CORRECTED (Đợt D, D-7b census) — this bullet used to say "the same KIND", and to justify it
  > with "since the registry itself only ever holds one factory per kind".** That justification is
  > **false** since D-1 (the registry is keyed per connector INSTANCE — §19.4), and the rule it justified
  > was **incomplete**: both comparisons are made on the **registration key**
  > (`ConnectorsJsonRegistration.RegistrationKeyOf`), which is the kind for a Modbus TCP / OPC-UA entry
  > and the entry's **own `id`** for an RTU bus. Stated as "kind", an unrelated env-var Modbus TCP
  > connector would suppress an RS-485 line, and a site's second RS-485 line would be called a duplicate
  > of its first.

> 🔴 **Modbus RTU / RS-485 (Đợt D) — where the schema actually is, and this pointer closes a dead
> end.** §16.4's own RTU paragraph sends a reader here "for that file's general mechanics" while noting
> that this section **said nothing about RTU**, and until D-7b that was literally true — the RTU schema
> existed only in §16.4's own block and in `ModbusRtuBusSettings`'s doc comment. The general mechanics
> above (loading, precedence, per-entry failure isolation) **do all apply unchanged to an RTU entry**; what
> is different is three things, and every one of them is in **§23**: an RTU `settings` blob declares a
> `transport` and therefore describes a **bus** rather than one connector (§23.1); that entry's own `id`
> becomes the bus's instance id rather than being discarded (§23.2); and one entry fans out into **N**
> registered connectors, N machine claims and N roster machines (§23.3). A Modbus entry that declares no
> `transport` is a Modbus **TCP** connector and behaves exactly as this section describes.

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
cấu hình MỘT KẾT NỐI: **biến môi trường luôn thắng**, mục xung đột bị bỏ qua kèm cảnh báo nêu rõ xung đột.
🔴 **Đính chính (Đợt D, D-7b):** câu này trước đây viết là "cùng một `kind`" và giải thích bằng "vì
registry chỉ giữ một factory cho mỗi kind" — lời giải thích đó **đã sai** từ D-1 (registry key theo TỪNG
THỂ kết nối, §19.4), và quy tắc nó biện minh thì **thiếu**: cả hai phép so sánh đều dựa trên KHOÁ ĐĂNG KÝ
(`ConnectorsJsonRegistration.RegistrationKeyOf`) — bằng `kind` với entry Modbus TCP / OPC-UA, và bằng
CHÍNH `id` của entry với một tuyến RTU. Nếu hiểu theo "kind", một kết nối Modbus TCP cấu hình bằng biến môi
trường sẽ chặn mất một đường RS-485 hoàn toàn không liên quan, còn đường RS-485 thứ hai của một trạm sẽ bị
coi là trùng với đường thứ nhất. Về RTU/RS-485, xem **§23**: một `settings` có khai báo `transport` mô tả
một TUYẾN chứ không phải một kết nối, và một entry như vậy nở ra thành N kết nối đã đăng ký.
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
   > 🔴 **PARTIALLY WITHDRAWN 2026-08-21, task AP-1 (owner decision 15) — quoted and retired in place, not
   > deleted.** Two claims above are now false and one is still exactly true.
   > * *"with **no counter anywhere**"* — **WITHDRAWN.** The eviction is counted, from this release, on
   >   `UnsBridge.ForwardQueueStats.Evicted` (`BridgeForwardQueueStats`), and it is warned, from the
   >   channel's own `itemDropped` callback.
   > * *"so that warning can never actually print"* — **WITHDRAWN as written**, and the reason matters: the
   >   `if (!TryWrite(...))` branch is still unreachable by saturation, exactly as the sentence says. It was
   >   not made reachable; the warning was **moved** to where the eviction is observable, and the branch was
   >   reworded to the shutdown case it *can* reach. Fixing the branch would have been the wrong repair.
   > * *"`droppedTotal` never sees these drops"* — **NOT withdrawn, and deliberately still true.** That
   >   number is READ by `GET /v1/site`, by the `/site` page, and by the **retained resync record this
   >   bridge publishes to the Site broker** — a wire contract a third party consumes. Widening what it
   >   counts would have silently changed a running number's meaning, so it was documented instead.
   > * 🔴 **What is therefore STILL open, stated rather than left to be found:** the new counter is
   >   in-process and is **not** on `GET /v1/site` or the `/site` page. Adding a field there changes a
   >   published payload, which item 15 was not delegated to do. On the Windows Service install shape
   >   described in point 4 below, the log has nowhere to go — so on that shape this loss is **counted but
   >   still not visible to an operator**. See `docs/owner-decisions.md` Part III item 15.
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
   > 🔴 **RÚT MỘT PHẦN 2026-08-21, nhiệm vụ AP-1 (phán quyết mục 15) — trích nguyên văn rồi rút tại chỗ,
   > không xoá.** Hai khẳng định ở trên nay SAI, một khẳng định vẫn ĐÚNG nguyên.
   > * *"**không có bộ đếm nào ghi lại việc này**"* — **RÚT.** Cú đuổi nay được đếm ở
   >   `UnsBridge.ForwardQueueStats.Evicted` (`BridgeForwardQueueStats`) và được cảnh báo từ chính callback
   >   `itemDropped` của kênh.
   > * *"nên cảnh báo đó không bao giờ thực sự in ra được"* — **RÚT theo đúng chữ**, và lý do là phần quan
   >   trọng: nhánh `if (!TryWrite(...))` VẪN không với tới được bằng bão hoà, đúng như câu ấy nói. Nó
   >   không được làm cho với tới được; cảnh báo đã được **DỜI** sang chỗ cú đuổi thật sự quan sát được, còn
   >   nhánh kia được viết lại theo đúng ca nó chạm tới (lúc tắt). Sửa nhánh ấy sẽ là bản sửa sai chỗ.
   > * *"`droppedTotal` không bao giờ thấy các lượt bỏ này"* — **KHÔNG rút, và cố ý vẫn đúng.** Con số ấy
   >   được ĐỌC bởi `GET /v1/site`, bởi trang `/site`, và bởi **bản ghi resync giữ lại mà bridge này phát
   >   lên broker của Site** — một hợp đồng dây mà bên thứ ba tiêu thụ. Nới nghĩa nó là lặng lẽ đổi nghĩa
   >   một con số đang chạy, nên nó được ghi tài liệu thay vì bị nới.
   > * 🔴 **Vì thế cái CÒN MỞ, nêu ra chứ không để người sau tự tìm:** bộ đếm mới nằm trong tiến trình và
   >   **không** có trên `GET /v1/site` lẫn trang `/site`. Thêm một trường ở đó là đổi payload đã xuất bản,
   >   việc mục 15 không được uỷ quyền làm. Trên hình thái cài Windows Service ở mục 4 dưới đây, log không
   >   có nơi nào để đi — nên trên hình thái ấy mất mát này **được đếm nhưng operator vẫn chưa nhìn thấy
   >   được**. Xem `docs/owner-decisions.md` Phần III mục 15.
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
| `ST4I_NOTIFICATIONS_DIR` | 🔴 Đợt C — relocates the alarm **notification** configuration store (`notifications.db`, §22), which holds every channel's settings **and its DPAPI-protected credentials** | `%ProgramData%\ST4I\sim\notifications` |

An unset or unparseable value keeps its built-in default rather than crashing startup — same posture
`WalOptions.FromEnvironment` already uses.

🔴 **`ST4I_NOTIFICATIONS_DIR` is not like the other five.** The directory it names holds webhook URLs,
webhook signing secrets, webhook auth tokens and SMTP passwords, encrypted with **DPAPI at the current
user scope** — so **that directory's ACL is the confidentiality boundary** against another local account
on the same machine. Relocating it onto a share, or onto a volume with looser permissions, moves that
boundary with it. See §22.5.

*(VI: `AlarmEvaluator` là lõi đánh giá thuần, test được trực tiếp, cho ba nguồn tự động (không có timer
riêng — không bao giờ throw). `AlarmEvaluatorService` là `IHostedService` ĐẦU TIÊN của
`St4i.EngineApi` — vòng lặp `PeriodicTimer` mỗi tick đọc health/KPI mới + hạn dùng chứng chỉ thiết bị
(§17.10) rồi đưa cho evaluator, tự bọc try/catch riêng để một tick lỗi không bao giờ làm sập host. Sáu
biến môi trường: **`ST4I_ALARMS_DIR`**
(thư mục `alarms.db`, mặc định `%ProgramData%\ST4I\sim\alarms`); **`ST4I_ALARM_NGRATE_THRESHOLD`**
(ngưỡng tỷ lệ NG kích hoạt cảnh báo, mặc định `0.20` = 20%); **`ST4I_ALARM_NGRATE_MINSAMPLE`** (số mẫu
tối thiểu để đánh giá, mặc định `5`); **`ST4I_ALARM_EVAL_INTERVAL_MS`** (chu kỳ đánh giá, mặc định
`5000` ms = 5s); **`ST4I_IDENTITY_EXPIRY_WARN_DAYS`** (WI-4 GĐ3 closeout, §17.10 — số ngày trước khi
chứng chỉ danh tính thiết bị hết hạn thì nguồn `Identity` bắt đầu cảnh báo, mặc định `30`); và 🔴 Đợt C
thêm **`ST4I_NOTIFICATIONS_DIR`** (thư mục cấu hình kênh báo ra ngoài `notifications.db`, §22, mặc định
`%ProgramData%\ST4I\sim\notifications`). Giá trị trống/không đọc được thì giữ mặc định, không crash lúc
khởi động. 🔴 **`ST4I_NOTIFICATIONS_DIR` khác năm biến kia:** thư mục nó trỏ tới chứa URL webhook, khóa
ký HMAC, token xác thực và mật khẩu SMTP — mã hóa bằng **DPAPI phạm vi người dùng hiện tại** — nên
**ACL của chính thư mục đó LÀ ranh giới bảo mật** với một tài khoản cục bộ khác trên cùng máy. Chuyển nó
sang ổ/thư mục có quyền lỏng hơn là chuyển luôn ranh giới đó. Xem §22.5.)*

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

> 🔴 **Task E-2 (Đợt E)** — this type is now `St4i.EdgeCore.Fleet.ConnectorRegistry`, not
> `St4i.EngineApi.Fleet.ConnectorRegistry`. It moved down with the N-driver lifecycle core (`FleetHost`'s body
> became `St4i.EdgeCore.Fleet.FleetCore`) because `StartLocked` builds one pipeline slot per registered
> instance from it and `ResolveWritableDriver` routes every write off its bindings — a lifecycle core that
> cannot see it is not a lifecycle core. Nothing about the CONTRACT below changed; only the assembly did. The
> rest of §19.4 stands, including the note further down that this section's `Id` wording predates Task D-1.

**EN** — `ConnectorRegistry` replaced `FleetHost`'s old per-driver-kind hardcoding
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

> 🔴 **CORRECTED (Đợt D, task D-7b documentation census) — a doc correction that had itself become the
> thing it was correcting.** This paragraph used to be headed *"Small doc correction (batch review) — the
> `id` field is actually the `kind`"* and stated that **`ConnectorRegistry` keys purely on the normalized
> `Kind`**. **Task D-1 made that false**, and it is the load-bearing half of Đợt D: the registry is keyed
> **per connector INSTANCE**, `Register` takes an `instanceId` (defaulting to the kind, which is why every
> pre-D-1 deployment behaves byte-identically), and two connectors of one protocol now genuinely run side
> by side. `ConnectorStatusDto.Id` therefore carries an **instance id**, and N devices on one RS-485 line
> produce **N distinct entries** here rather than one silently replacing the other.
>
> What is still true, and is the part worth keeping: a `connectors.json` entry's own `id` field is read
> only to NAME per-entry warnings and is discarded for a **Modbus TCP / OPC-UA** entry — that dispatch
> deliberately lets the instance id default to the kind, because adopting `entry.Id` would move every such
> connector's pipeline slot label and therefore its alarm `TargetId`. So `{"id":"line3-weld","kind":"Modbus"}`
> STILL surfaces as `{"id":"Modbus","error":…}` today — **for a different reason than the one the old note
> gave.** The exception, added by D-7a, is an **RTU bus**: an entry declaring a `transport` registers under
> its own `id` (see `ConnectorsJsonRegistration.RegistrationKeyOf`), because a site with two RS-485 lines
> has two buses of one kind and that is the entire point of instance identity. Each device on such a bus
> then registers under the derived id `{bus}:unit{slave address}` — a reserved namespace both allocation
> doors refuse to let anything else into (§23.2).
>
> The DTO field is still not renamed, and the original reason still holds: renaming it would touch
> `AssetRegistry.tsx` and every test asserting on `Id`/`SlotLabel`. What changed is not the wire format —
> it is what the value in that field MEANS.

*(VI: `ConnectorRegistry` thay thế việc hard-code từng loại driver trong `FleetHost`
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

🔴 **ĐÃ ĐƯỢC ĐÍNH CHÍNH (Đợt D, task D-7b — đợt rà soát tài liệu): một bản đính chính đã tự biến
thành đúng cái lỗi mà nó đi sửa.** Đoạn này trước đây có tiêu đề *"Đính chính tài liệu nhỏ — trường `id`
thực ra là `kind`"* và khẳng định **`ConnectorRegistry` chỉ key theo `Kind` đã chuẩn hoá**. **Task D-1 đã
làm điều đó trở thành SAI**, và đây chính là nửa chịu lực của cả Đợt D: registry giờ key theo **TỪNG THỂ
KẾT NỐI (instance)**, `Register` nhận `instanceId` (mặc định bằng kind, nên mọi triển khai trước D-1 chạy
y hệt như cũ), và hai kết nối cùng một giao thức giờ thực sự chạy song song. Do đó `ConnectorStatusDto.Id`
mang một **instance id**, và N thiết bị trên một đường RS-485 sinh ra **N mục riêng biệt** thay vì cái này
âm thầm thay thế cái kia.

Phần VẪN ĐÚNG và đáng giữ lại: trường `id` của một entry `connectors.json` vẫn chỉ dùng để ĐẶT TÊN cảnh
báo và vẫn bị bỏ đi đối với một entry **Modbus TCP / OPC-UA** — nhánh đó cố ý để instance id mặc định bằng
kind, vì nếu lấy `entry.Id` thì nhãn slot pipeline — và do đó `TargetId` của cảnh báo — của mọi kết nối
loại đó sẽ bị dịch đi. Nên `{"id":"line3-weld","kind":"Modbus"}` VẪN hiển thị thành
`{"id":"Modbus","error":…}` — **nhưng vì một lý do KHÁC với lý do mà ghi chú cũ đưa ra.** Ngoại lệ, do
D-7a thêm vào, là **tuyến RTU**: một entry có khai báo `transport` sẽ đăng ký dưới chính `id` của nó (xem
`ConnectorsJsonRegistration.RegistrationKeyOf`), vì một trạm có hai đường RS-485 là có hai tuyến cùng một
loại, và đó chính là toàn bộ lý do tồn tại của định danh theo thể. Mỗi thiết bị trên tuyến đó đăng ký dưới
id dẫn xuất `{tuyến}:unit{địa chỉ slave}` — một vùng tên được dành riêng mà cả hai cửa cấp phát đều từ chối
cho bất kỳ thứ gì khác đi vào (§23.2).

DTO vẫn không đổi tên, và lý do cũ vẫn đúng: đổi tên sẽ đụng tới `AssetRegistry.tsx` và mọi test đang
assert theo `Id`/`SlotLabel`. Cái đã thay đổi không phải định dạng wire — mà là Ý NGHĨA của giá trị trong
trường đó.)*

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
- **The `id`/`kind` split HAS a functional effect, since Đợt D.**

  > 🔴 **CORRECTED (D-7b fix round 1).** This bullet read *"The `id`/`kind` split has no functional
  > effect today — the registry is one-factory-per-kind, and `id` is used only for log/slot-label naming
  > (see §19.4's own doc correction: `GET /v1/connectors`' `id` field is actually the registry key — the
  > normalized `kind`)."* **Both halves are false since D-1/D-7a**, and it pointed the reader at the very
  > paragraph D-7b rewrote. The registry is keyed per connector **INSTANCE**; `ConnectorStatusDto.Id`
  > carries an instance id; and an RTU **bus** entry registers under its own `id`, with each of its devices
  > under the derived `{bus}:unit{n}` (§23.2). What survives is narrow and worth keeping: a Modbus TCP /
  > OPC-UA `connectors.json` entry still leaves its instance id defaulting to the kind, so ITS `id` is
  > still naming-only — deliberately, because adopting it would move that connector's pipeline slot label
  > and therefore its alarm `TargetId`.
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
thực sự thay được qua `connectors.json` hôm nay. **Việc tách `id`/`kind` ĐÃ CÓ tác dụng chức
năng, từ Đợt D.** 🔴 **ĐÍNH CHÍNH (D-7b, vòng sửa 1):** câu cũ viết *"CHƯA có tác dụng chức năng nào — registry
là một-factory-một-kind, `id` chỉ dùng để đặt tên log/slot (xem đính chính §19.4: trường `id` của
`GET /v1/connectors` thực ra là khoá registry — `kind` đã chuẩn hoá)."* **Cả hai vế đều SAI kể từ
D-1/D-7a**, và nó còn trỏ người đọc tới đúng đoạn mà D-7b đã viết lại. Registry key theo TỪNG THỂ kết nối;
`ConnectorStatusDto.Id` mang một instance id; và một entry **tuyến** RTU đăng ký dưới chính `id` của nó,
với từng thiết bị dưới id dẫn xuất `{tuyến}:unit{n}` (§23.2). Phần còn đúng thì hẹp và đáng giữ: một entry
`connectors.json` loại Modbus TCP / OPC-UA vẫn để instance id mặc định bằng kind, nên `id` CỦA NÓ vẫn chỉ
để đặt tên — và đó là chủ ý, vì lấy `id` đó sẽ làm dịch nhãn slot pipeline và kéo theo `TargetId` của cảnh
báo. **Một rủi ro đã
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
| `DELETE /v1/connectors/{instanceId}` | Engineer, audited `connector.delete` | Removes **only the persisted row**, and (since D-7a) releases that instance's live machine claim — see the honest-limitations note below. |
| `POST /v1/connectors/test` | Engineer, **not audited** (mutates nothing) | Builds a throwaway driver, attempts one bounded read, reports reachable or not — never registered, never touches the running fleet. |

> 🔴 **UPDATED (Đợt D, D-7b census) — the route's segment was `{kind}`, and this table said so.**
> D-1 renamed it to `{instanceId}` because with two connectors of one protocol configurable, "the kind" no
> longer identifies anything deletable; every pre-D-1 URL keeps working unchanged, because a migrated row's
> instance id IS its kind. **The web page itself did not catch up until D-7b** — it keyed its list, and
> built its DELETE URL, from `kind`, so on an RS-485 bus it could not say which of N devices a Remove
> button meant. §23.4 is the full write-up of what that screen shows now.

**Only Modbus and OPC-UA are offered** — the protocols this build has a working driver for (§20.5). 🔴 **Đợt D adds a third choice on that form, and it is not a third protocol:** "Modbus RTU
(RS-485)" is the same `Modbus` kind with a document that declares a `transport`, i.e. a whole multidrop
**bus** rather than one connector — see §23. **The "map JSON"** is the exact same shape the `ST4I_MODBUS_MAP`/`ST4I_OPCUA_MAP` environment
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
gieo vào đội hình qua `RegisterMachine`), `DELETE /v1/connectors/{instanceId}` (Engineer, audit
`connector.delete` — CHỈ xoá dòng đã lưu), `POST /v1/connectors/test` (Engineer, KHÔNG audit vì không
đổi gì — dựng driver dùng-một-lần, thử đọc có giới hạn thời gian). 🔴 **ĐÍNH CHÍNH (D-7b):** đoạn URL ngay trên đây trước là `{kind}`; từ D-1 nó là `{instanceId}`, vì khi
đã cấu hình được hai kết nối cùng giao thức thì "kind" không còn xác định được cái gì để xoá — mọi URL từ
trước D-1 vẫn chạy nguyên vì instance id của một dòng đã migrate CHÍNH LÀ kind của nó. Bản thân trang web
mãi tới D-7b mới bắt kịp (xem §23.4). **Chỉ Modbus và OPC-UA** được chọn — những giao thức mà build này
có driver thật. 🔴 **Và Đợt D thêm một lựa chọn THỨ BA trên biểu mẫu đó, không phải một giao thức thứ
ba:** "Modbus RTU (RS-485)" vẫn là kind `Modbus`, chỉ khác ở chỗ tài liệu của nó khai báo `transport` — tức
là cả một TUYẾN multidrop chứ không phải một kết nối đơn lẻ. Xem §23. **"JSON map"** đúng y hệt shape 2 biến môi trường
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

- **Machine control (writing to a device) exists now — see §21, not this bullet.** This line used to say
  "there is no write path to any device" — true when this section was written (Đợt A), **false since
  Đợt B** (B-1 through B-8): `IDeviceDriver` gained an OPTIONAL `IWritableDeviceDriver` capability, and
  both `ModbusTcpDriver` and `OpcUaDriver` execute a real write for a machine whose map declares one
  (`POST /v1/machines/{code}/setpoint`/`.../command`). §21 states the honest limitations of THAT
  capability plainly (only Modbus and OPC-UA write — Modbus TCP and, since Đợt D, Modbus RTU over RS-485
  (§23); a Modbus command is a zero-argument coil pulse, there is
  no rate limiting, the Critical-alarm gate is fleet-wide, `Indeterminate` is a real operational state,
  and Sparkplug NCMD — inbound commands from the ecosystem — is still never received, so this write path
  is local-caller-only). Left here, corrected rather than deleted, so anyone who bookmarked this
  paragraph across a batch boundary sees the correction in place, not a silently vanished claim.
- **Alarms CAN now reach someone who is not looking at the screen — see §22, not this bullet.** This
  line used to say "alarms cannot reach anyone who is not looking at the screen", that
  `St4i.EngineApi/Alarms/` was "exactly seven files", and that "there is no email, SMS, webhook, Slack,
  syslog, relay, or audible-signal integration anywhere in this repository". Every clause of that was
  true when it was written (Đợt A) and **every clause is false since Đợt C** (C-1 through C-8): that
  folder is now **23 files**, and the product ships **four** notification channels — an HMAC-signed
  **webhook** (Slack/Teams/MES), **e-mail over SMTP**, an **audible + visual annunciation** pushed to
  every open page over SSE, and a **physical relay/beacon** driven through a declared writable point.
  §22 states the honest limitations of THAT capability plainly (no SMS and no syslog; no Windows desktop
  toast; implicit TLS on port 465 is unreachable; a green e-mail test does not prove the stored password
  works; the relay is **not a safety device** and does **not** light while HALT is latched; there is no
  relay send test; and there is no delivery guarantee behind any channel). Left here, corrected rather
  than deleted, so anyone who bookmarked this paragraph across a batch boundary sees the correction in
  place, not a silently vanished claim — the same treatment the machine-control bullet above got.
- **What is still true, narrowed to what it actually covers:** on an install where **nothing has been
  configured**, an alarm is visible on `/alarms` and in the `alarms.db` history and reaches nobody else.
  A fresh install therefore starts silent, and the engine prints a startup **warning** saying so
  (`NotificationStartupNotices`) rather than leaving that state to be discovered.
- **Only Modbus and OPC-UA actually work — and "Modbus" now means TCP *and* RTU.** `MqttDriver` exists
  and is proven by `MqttDriverTests`, but it is registered into **no** host's dependency injection —
  neither `St4i.EngineApi`'s nor `St4i.EdgeService`'s `Program.cs`/startup wiring references it. S7,
  EtherNet/IP and SECS/GEM have no driver at all.

  > 🔴 **CORRECTED (Đợt D, D-7b fix round 1).** This bullet used to list **Serial/RS-485** among the
  > protocols with "no driver at all". That is false: `ModbusRtuDriver` ships, over both transports
  > (`rtu-gateway` and a directly-attached `rtu-serial` COM port), and `St4i.EngineApi` registers it — see
  > §23. What IS still true and is the part worth keeping: **no Modbus frame has yet crossed a real serial
  > port** (§23.5), and **only `St4i.EngineApi` can open one** (§23.6). RS-485 is a shipped driver with an
  > outstanding bench acceptance step, which is a different statement from "no driver at all" and has a
  > different remedy.
  >
  > 🔴 **CORRECTED AGAIN (Đợt E, E-4) — the second half of that "what IS still true" was itself not true.**
  > "Only `St4i.EngineApi` can open one" is a claim about CONFIGURATION, not about capability: the serial
  > open is `public` on a project all three hosts reference, and `St4i.EdgeService` performs one in
  > `EdgeServiceSerialReachabilityTests`. Only the first half survives unchanged — **no Modbus frame has yet
  > crossed a real serial port.** See §23.6's own correction block and §24.5. Recorded here as well as
  > there because this bullet is filed under "honest limitations", not under "connectors", and a reader
  > checking what this product can drive lands here — a claim only corrected where it is *filed* is a claim
  > still shipping wherever it was *repeated*.
  >
  > 🔴 **AND A THIRD TIME (Đợt E, E-5) — the CONFIGURATION half has now changed too.** `St4i.EdgeService`
  > has its own configured path from an `rtu-serial` entry in its `connectors.json` to a COM port, so **two
  > of the three hosts** can be configured onto a real RS-485 line and the question "which process holds
  > COM3" now has a real answer (§24.3). **The first half is STILL the part that survives: no Modbus frame
  > has yet crossed a real serial port** — E-5 made the port reachable by configuration and did not touch
  > that. Every RTU test in this repository runs on D-2's in-memory paired link, or against a CLOSED
  > loopback port whose connect is refused — not a working socket, and never a frame on copper.
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
- 🔴 **The local UNS spine is a NON-CONFORMANT Sparkplug B node: it publishes NBIRTH, NDEATH and DDATA,
  and deliberately publishes no DBIRTH/DDEATH.** The device-level birth certificate is the thing a strict
  Sparkplug host (Ignition, HiveMQ) requires before it will register a device, and this spine never sends
  one while still pushing DDATA on the device-level topic — so such a host sees those devices as
  unknown/STALE. The publish path for both messages was removed on 2026-08-21 under the owner's item-23
  ruling and the enum members remain as vocabulary with no producer. **This is an ACCEPTED DEBT with a
  stated ceiling, not an omission** — see §16.1 for the full statement. Two halves of that ceiling belong
  here too: decoding is *not* affected (every metric carries its `Name` inline beside its `Alias`, so a
  subscriber reads DDATA in full without a DBIRTH), and **whether any real subscriber is affected has not
  been measured from this repository**. Closing it puts a new message type on the wire, which is an owner
  decision (owner-decisions.md item 35), not a fix this batch could take.

*(VI: Ghi rõ ràng, không mềm hoá: **Điều khiển máy (ghi vào thiết bị) đã có — xem §21, không phải dòng
này.** Dòng này từng viết "KHÔNG có đường ghi lệnh tới bất kỳ thiết bị nào" — đúng lúc viết mục này (Đợt
A), **SAI từ Đợt B** (B-1 đến B-8): `IDeviceDriver` có thêm khả năng TÙY CHỌN `IWritableDeviceDriver`, và
cả `ModbusTcpDriver` lẫn `OpcUaDriver` đều thực thi lệnh ghi thật cho máy có map khai báo ghi được
(`POST /v1/machines/{code}/setpoint`/`.../command`). §21 ghi rõ giới hạn thật của năng lực đó (chỉ 2 giao
thức ghi được, lệnh Modbus là xung coil không tham số, KHÔNG có giới hạn tốc độ, cổng cảnh báo Critical
là toàn fleet chứ không theo từng máy, `Indeterminate` là trạng thái vận hành thật, và Sparkplug NCMD —
lệnh vào từ hệ sinh thái — vẫn không bao giờ được nhận, nên đường ghi này chỉ local). Giữ lại ở đây,
sửa lại thay vì xóa, để ai từng đọc đoạn này ở đợt trước vẫn thấy chỗ sửa, không phải một khẳng định biến
mất âm thầm.
**Cảnh báo ĐÃ có thể tới người không nhìn màn hình — xem §22, không phải dòng này.** Dòng này từng
viết "Cảnh báo KHÔNG thể tới ai không đang nhìn màn hình", rằng thư mục `Alarms/` "chỉ có đúng 7 file",
và rằng "KHÔNG có email/SMS/webhook/Slack/syslog/relay/tín hiệu âm thanh nào trong repo này" — đúng lúc
viết (Đợt A), **SAI từ Đợt C** (C-1 đến C-8): thư mục đó nay có **23 file**, và sản phẩm có **bốn** kênh
báo ra ngoài — **webhook** ký HMAC (Slack/Teams/MES), **email qua SMTP**, **báo tại chỗ** (chuông + thẻ
cảnh báo) đẩy qua SSE tới mọi trang đang mở, và **relay/đèn báo vật lý** ghi qua một điểm ghi được đã
khai báo. §22 ghi rõ giới hạn thật của năng lực đó (KHÔNG có SMS, KHÔNG có syslog; KHÔNG có toast
desktop Windows; TLS ngầm cổng 465 không thể dùng; một bài gửi thử email xanh KHÔNG chứng minh mật khẩu
đúng; relay **không phải thiết bị an toàn** và **không sáng khi HALT đang gài**; không có bài gửi thử
relay; và không kênh nào có bảo đảm gửi tới nơi). Giữ lại ở đây, sửa lại thay vì xóa, để ai từng đọc
đoạn này ở đợt trước vẫn thấy chỗ sửa. **Điều vẫn đúng, đã thu hẹp lại đúng phạm vi của nó:** trên một
bản cài **chưa cấu hình gì**, cảnh báo chỉ thấy ở `/alarms` và trong lịch sử `alarms.db`, không tới ai
khác — và engine in một **cảnh báo lúc khởi động** nói đúng điều đó thay vì để người dùng tự phát hiện.
**Chỉ Modbus và OPC-UA THẬT SỰ chạy được — và "Modbus" giờ gồm cả TCP LẪN RTU.**
`MqttDriver` tồn tại, được `MqttDriverTests` chứng minh, nhưng KHÔNG được đăng ký DI ở host nào cả.
S7, EtherNet/IP, SECS/GEM chưa có driver. 🔴 **ĐÍNH CHÍNH (Đợt D, D-7b, vòng sửa 1):** câu này trước
đây xếp cả **Serial/RS-485** vào nhóm "chưa có driver". Điều đó SAI: `ModbusRtuDriver` đã ship, trên cả hai
đường truyền (`rtu-gateway` và cổng COM cắm thẳng `rtu-serial`), và `St4i.EngineApi` có đăng ký nó — xem
§23. Phần VẪN ĐÚNG và đáng giữ: **chưa có khung Modbus nào đi qua một cổng serial thật** (§23.5), và **chỉ
`St4i.EngineApi` mở được cổng đó** (§23.6 — cả hai vế sau đều đã được đính chính, xem ngay dưới). "Đã có driver nhưng còn thiếu bước nghiệm thu trên bàn" là một
câu khác hẳn "chưa có driver", và cách xử lý cũng khác. 🔴 **ĐÍNH CHÍNH LẦN HAI (Đợt E, E-4) — chính nửa
"phần VẪN ĐÚNG" ấy lại không đúng.** "Chỉ `St4i.EngineApi` mở được cổng đó" là một khẳng định về **CẤU
HÌNH**, không phải về khả năng: lệnh mở cổng serial là `public` trên một project cả ba host đều tham chiếu,
và `St4i.EdgeService` thực sự mở một cổng trong `EdgeServiceSerialReachabilityTests`. Chỉ nửa đầu còn nguyên
— **chưa có khung Modbus nào đi qua một cổng serial thật**. Xem khối đính chính của §23.6 và §24.5. Ghi cả ở
đây lẫn ở đó vì dòng này xếp dưới "giới hạn trung thực" chứ không phải dưới "connector", và người đọc đi tìm
"sản phẩm này điều khiển được gì" sẽ rơi vào đây — một khẳng định chỉ được sửa ở nơi nó được *xếp vào* là một
khẳng định vẫn đang phát hành ở mọi nơi nó được *nhắc lại*. 🔴 **VÀ LẦN THỨ BA (Đợt E, E-5) — nửa CẤU HÌNH
giờ cũng đã đổi:** `St4i.EdgeService` có đường đã cấu hình của riêng nó từ một entry `rtu-serial` trong
`connectors.json` tới một cổng COM, nên **hai trong ba host** cấu hình được lên một đường RS-485 thật, và câu
hỏi "tiến trình nào đang giữ COM3" giờ mới có câu trả lời thật (§24.3). **Nửa đầu VẪN là phần sống sót: chưa
có khung Modbus nào đi qua một cổng serial thật** — E-5 làm cổng ấy với tới được bằng cấu hình chứ không chạm
vào sự thật đó; mọi test RTU trong kho mã này chạy trên giàn in-memory của D-2, hoặc nhắm vào một cổng
loopback ĐÓNG mà lệnh connect bị từ chối — không phải một socket đang hoạt động, và không khung nào trên đồng.
**Lưu lại cấu hình một connector ĐÃ CÓ trong
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

---

## 21. Đợt B (B-1–B-8) — machine control: writing to a device / Điều khiển máy: ghi vào thiết bị

**EN** — Every other section above that predates this one was written while it was true that **nothing in
this codebase could write to a device**. Đợt B (tasks B-1 through B-8, this section) built exactly that
capability, deliberately, as the highest-risk work in this project to date: until now the product only
ever *observed* a machine; a bug in this batch can change the physical state of running equipment. Every
place elsewhere in this document that used to assert "no write path exists" has been corrected in this
same coordinated pass (§1, §16.2, §16.4, §16.6, §20.5) rather than left to rot into a claim that is now
simply false.

### 21.1 What a write actually is / Một lệnh ghi thực sự là gì

Two operations, never conflated with each other or with a read:

- **A setpoint write** — `POST /v1/machines/{code}/setpoint` `{ "point": "<name>", "value": <number|bool|string> }`
  — sets one pre-declared point (a Modbus Holding register, an OPC-UA node) to a value, gated at
  **Engineer** role.
- **A command invocation** — `POST /v1/machines/{code}/command` `{ "command": "<name>", "arguments"?: {...} }`
  — invokes a pre-declared command/method that **can trigger real, physical motion** (a Modbus coil
  pulse, an OPC-UA `CallAsync`), gated at **Admin** — one level stricter than a setpoint, deliberately,
  because a command can start a machine moving and a setpoint cannot. This is the SAME asymmetry the web
  UI (§21.4) surfaces, not something the UI is free to flatten.

Both a point and a command are **named**, never a raw register address or NodeId — resolving a name to a
real device address is entirely the driver's own job (`St4i.Connector.Abstractions.IWritableDeviceDriver`,
task B-1). Both are declared in the connector's own register/node map (§16.4/§16.6) with **mandatory**
physical bounds (a numeric point) validated at parse time, never left "unbounded" by a forgotten field —
see §16.4/§16.6 for the exact validation rules (NaN/±Infinity rejected, overflow-checked against the
physical register width, a missing coil address rejected rather than silently defaulting to coil 0).

### 21.2 The gates a write passes through / Các cổng một lệnh ghi phải qua

In order, every attempt (permitted or denied) is audited:

1. **Request-shape validation** — a non-blank point/command name, a value/argument this host's JSON
   converter can parse. A malformed request 400s here, before policy is even evaluated (§21.7 addresses
   this as a carried, accepted gap, not a fixed one).
2. **A Critical alarm blocks it** (`CriticalAlarmGuardRule`) — mirroring `LineController`'s own precedent.
   **This gate is fleet-wide, not per-machine** — see §21.6.
3. **Policy + RBAC** (`PolicyEngine`, `EstopGuardRule`, `RoleObligationRule`) — denied outright while HALT
   is engaged (`SAFETY_BLOCKED`, `409`), or if the caller's role doesn't meet the action's own minimum
   (`403`). Every denial is audited and, for `SAFETY_BLOCKED`, raises a Critical Policy alarm.
4. **Machine → live-driver resolution** (`FleetHost.TryWriteSetpointAsync`/`TryInvokeCommandAsync`) — a
   machine code with no live driver, a read-only driver, or a driver shared ambiguously with another
   roster member (`AmbiguousDriver` — refuses rather than risk delivering the write to the wrong physical
   device) each get their own `409` with an actionable reason, never one generic "not available" error.
5. **The driver's own pre-flight validation** — an unknown point/command, a point the map declares
   read-only, or a value outside its declared range is `Rejected` **without the device ever being
   touched** — the cheapest possible refusal, always before any I/O.
6. **The actual write** — Modbus (`ModbusTcpDriver`) or OPC-UA (`OpcUaDriver`) only; see §21.6.

Every attempted write (steps 5–6) returns `200 OK` with the outcome **in the body**, never a 4xx/5xx —
deliberately, because this batch's own carried findings include a transport that silently re-sent an
unacknowledged write; mapping an uncertain outcome to a 4xx/5xx status would invite exactly the kind of
automatic HTTP-layer retry this contract forbids (§21.3). Only a genuinely UNATTEMPTED write (steps 1–4)
gets a non-`200` status, because retrying something that never touched the device is always safe.

### 21.3 `WriteOutcome` — four outcomes, one of them is the whole point / Bốn kết quả, một trong số đó là mấu chốt

`Applied` / `Rejected` / `Failed` / `Indeterminate` — the same four-way vocabulary for both a setpoint and
a command:

- **`Applied`** — the device confirmed the write took effect.
- **`Rejected`** — refused before the device was ever touched (an unknown point/command, a read-only
  point, an out-of-range value/argument) — the device's state is provably unchanged.
- **`Failed`** — the device or transport was reached and explicitly said no — a KNOWN failure.
- **`Indeterminate`** — **the single most consequential thing an operator can be told.** The attempt was
  interrupted (most commonly a timeout) before a definitive applied/failed answer arrived — the driver
  genuinely does not know whether the device took the write. This is NOT an error code to swallow or
  collapse into "failed": a failed write is safe to consider retryable in spirit (a known no), while an
  indeterminate one is not — retrying a setpoint that may have already applied can leave the wrong value
  in place unnoticed, and retrying a command that may have already fired can trigger a second, real coil
  pulse or `CallAsync` — a genuine double-actuation. **No driver in this codebase ever retries a write on
  its own initiative, for any reason, including a timeout — that decision belongs to a human standing
  where they can see the machine, never to software.** If you see `Indeterminate`: stop, do not resubmit
  the same write reflexively, and go verify the machine's actual physical state before deciding what to do
  next — that is the entire reason this outcome exists rather than being hidden inside "failed," which
  most comparable products do.

The web UI (§21.4) renders `Indeterminate` as itself — a distinct, clearly-worded state — never folded
into a generic failure banner and never mistaken for success. Two earlier tasks in this same batch (B-4,
B-5) shipped bugs where exactly this collapse happened one layer down (a driver-level bug swallowing
`Indeterminate` into a generic exception string); this UI does not repeat that one layer up.

### 21.4 Web UI — MachineDetail's "Control" tab / Web UI — tab "Control" ở trang chi tiết máy

`web/src/routes/MachineDetail.tsx` gained a new tab (bilingual "Control"/"Điều khiển") showing, for the
machine being viewed: every writable point declared for its connector (name, wire target, min/max bounds)
with an inline form to submit a setpoint, and every declared command (name, wire target) behind a
**confirmation dialog** — the same deliberate, two-step "this is destructive, say so before the click"
pattern `Site.tsx`'s identity-rotation flow already established, not a bare button a stray click can fire.
A setpoint does not get that same friction — it changes a value, it does not itself trigger motion — but
it is still gated: the form only renders its submit control for a session that meets the setpoint action's
own **Engineer** minimum, and the command's confirm-and-fire control only renders for **Admin** — the same
asymmetry §21.1 states for the API, made visible in the UI rather than flattened into one generic "write"
affordance. A session below the relevant role sees the declared points/commands (read-only) plus a plain
statement of which role is required, never a silently missing control. Every outcome — `Applied`/
`Rejected`/`Failed`/`Indeterminate`, plus the not-available cases (no live driver, read-only, ambiguous
driver) — renders with its own distinct wording; see §21.3 for why `Indeterminate` in particular is never
allowed to blur into anything else.

### 21.5 Why HALT still doesn't stop a machine / Vì sao NGỪNG vẫn không dừng được máy

Answered in full in §1's safety notice — restated here because this is where a reader following the write
path is most likely to ask it: **a real emergency stop is a hardwired Cat 3/4 circuit per ISO 13849;
software is never the safety path, full stop.** That was true when Đợt A renamed E-STOP to HALT and gave
"no write path exists" as the reason HALT couldn't stop a machine either way; that specific reason is gone
now, but the conclusion is not, and this batch deliberately did **not** make HALT command a stop. A
software "emergency stop" that also pulsed a coil or wrote a shutdown setpoint to a PLC would look even
more like a safety device while still failing to be one under ISO 13849 — a worse, more misleading
product, not a safer one. HALT (`FleetHost.Estop()`) and the new write path
(`FleetHost.TryWriteSetpointAsync`/`TryInvokeCommandAsync`) are two genuinely separate capabilities: the
first never calls the second, by design, and that is not going to change.

### 21.6 🔴 Honest limitations / Giới hạn trung thực

Stated plainly, verified against the source below, not softened:

- **Only Modbus and OPC-UA can write — Modbus TCP, and (since Đợt D) Modbus RTU over RS-485.** S7,
  EtherNet/IP and SECS/GEM have no driver at all (§20.5). `MqttDriver`
  (`St4i.EdgeCore.Drivers.Mqtt`) exists and is proven by its own test suite but is wired into **no** host's
  dependency injection — it cannot write, or even read, in a running instance of this product today.

  > 🔴 **CORRECTED (Đợt D, D-7b fix round 1), and this is the correction that mattered most.** This
  > bullet used to read *"Only Modbus TCP and OPC-UA can write. Serial/RS-485 … have no driver at all."*
  > `ModbusRtuDriver` is declared `: IWritableDeviceDriver` and is registered by `St4i.EngineApi`, so an
  > RS-485 device **can be written to**. This is the write-SAFETY section, so the stale sentence did more
  > than mislead: an engineer reading it concluded an RTU device was unwritable and therefore that
  > everything below — the four `WriteOutcome` states, the limits, and above all what `Applied` does and
  > does not prove — did not apply to them.
  >
  > 🔴 **It applies, and it is sharper for RTU than for TCP.** `Applied` on an RTU command is an
  > **acknowledgement, not an observation**: RTU has nothing that ties a returned frame to a specific
  > request, so a late echo of an earlier, already-finished pulse is acknowledged identically. See §23.5.
  > The two RTU-specific limits an integrator must also read are there: automatic-DE adapters only, and no
  > frame has yet crossed a real serial port.
- **A Modbus command is a zero-argument coil pulse.** `ModbusRegisterMap`'s command declaration
  (`coilAddress` + optional `arguments`) rejects any command that declares an argument **at parse time** —
  a real wire convention for delivering an argument to a Modbus coil pulse was never defined, so a map that
  tries is refused up front, naming the offending command, rather than accepted and silently
  un-executable. OPC-UA commands (`CallAsync`) do support typed arguments, narrowed against the map's own
  declared type before ever reaching the device.
- **There is no rate limiting anywhere in this product.** No `AddRateLimiter`, no debounce, no throttle —
  a deliberate B-6 decision, not an oversight: the invariant that actually matters for a write (no
  implicit retry, no double actuation) is already enforced at the driver layer, independent of request
  rate, and a rate limiter would not distinguish "N legitimate setpoint writes across N machines" from
  "one stuck script re-firing the same command" — the one real hazard rate limiting usually guards
  against here is a UI/workflow concern (the confirm-before-fire dialog, §21.4), not a server-side one.
- **The Critical-alarm write gate is fleet-wide, not per-machine.** `CriticalAlarmGuardRule` blocks a
  write/command if **any** Critical alarm is active anywhere in the fleet, because `Alarm.TargetId`
  cannot identify a single machine code reliably enough to scope the gate narrower — a Critical alarm on
  machine A currently blocks a write to machine B too. Conservative in the safe direction (refuses more
  than a per-machine gate would, never less), not a bug.
- **`Indeterminate` is a real operational state, not an error code** — see §21.3 for what it means and
  what an operator should do when they see it (stop; verify the physical machine; do not reflexively
  resubmit).
- **There is no inbound command path from the ecosystem.** Sparkplug NCMD (the inbound command topic) is
  still never received anywhere in this codebase (unchanged from §20.5) — this write path is reachable
  only from an authenticated local HTTP caller (the web UI, or a direct API call), never from a SYNAPSE
  Site or any other upstream system.
- 🔴 **A machine driven by a `St4i.EdgeService` edge agent cannot be written to from this engine, and this
  engine cannot even see that that is the situation.** Added in Đợt E (E-4) — full statement in §24.4.
  Two separate facts, and both matter here: (1) `ITransport` is **upload-only**, so there is no downlink a
  write command could travel on to an edge agent — an edge-held machine is **read-only** until one exists,
  and since E-3 that is a *compile error* rather than a promise (`FleetCore` is `internal`); (2) an edge
  agent pushes **northbound to the platform** and never calls this engine, which serves no ingest route, so
  nothing here ever learns an edge agent exists. **The write-button messages therefore NAME that path rather
  than claiming to detect it** — see `MachineWriteGate.ExplainUnavailable`, whose four strings were each
  rewritten in E-4 because each named fewer producing paths than it covered (`READ_ONLY` presupposed a
  connector that need not exist; `NO_LIVE_DRIVER` offered a non-exhaustive list of causes plus advice that
  cannot work for an edge-held device; the `404` was true but named none of the paths an operator needs).

*(VI: Ghi rõ, đã đối chiếu mã nguồn, không mềm hoá: **Chỉ Modbus và OPC-UA ghi được — Modbus TCP, và
(từ Đợt D) Modbus RTU trên RS-485** — S7, EtherNet/IP, SECS/GEM chưa có driver (§20.5); `MqttDriver` tồn
tại, có test riêng, nhưng KHÔNG được đăng ký DI ở host nào — không đọc, không ghi được trong một instance
đang chạy của sản phẩm này. 🔴 **ĐÍNH CHÍNH (Đợt D, D-7b, vòng sửa 1) — và đây là bản đính chính quan
trọng nhất.** Câu này trước đây viết *"Chỉ Modbus TCP và OPC-UA ghi được — Serial/RS-485 … chưa có
driver."* `ModbusRtuDriver` được khai báo `: IWritableDeviceDriver` và được `St4i.EngineApi` đăng ký, nên
một thiết bị RS-485 **GHI ĐƯỢC**. Đây là mục nói về AN TOÀN KHI GHI, nên câu cũ không chỉ gây hiểu nhầm:
một kỹ sư đọc nó sẽ kết luận thiết bị RTU không ghi được, và do đó mọi thứ bên dưới — bốn trạng thái
`WriteOutcome`, các giới hạn, và trên hết là ý nghĩa thật của `Applied` — không áp dụng cho họ. 🔴 **Nó CÓ
áp dụng, và với RTU còn gắt hơn với TCP:** `Applied` của một lệnh RTU là một sự **XÁC NHẬN, không phải một
QUAN SÁT** — RTU không có gì buộc một khung tin quay về với một yêu cầu cụ thể, nên một khung echo về muộn
của một xung đã kết thúc trước đó vẫn được xác nhận y hệt. Xem §23.5, nơi cũng nêu hai giới hạn riêng của
RTU: chỉ adapter tự động đảo chiều, và chưa có khung nào đi qua cổng serial thật.
**Một lệnh Modbus là một xung coil không tham số** — khai báo lệnh của `ModbusRegisterMap` (`coilAddress`
+ `arguments` tuỳ chọn) từ chối NGAY LÚC NẠP bất kỳ lệnh nào khai báo tham số — chưa có quy ước dây thật
nào để truyền tham số vào một xung coil Modbus, nên map nào cố khai báo sẽ bị từ chối ngay, nêu rõ tên
lệnh, thay vì được chấp nhận rồi không bao giờ thực thi được. Lệnh OPC-UA (`CallAsync`) hỗ trợ tham số có
kiểu, được thu hẹp theo đúng kiểu map khai báo trước khi chạm thiết bị. **KHÔNG có giới hạn tốc độ nào
trong sản phẩm này** — không `AddRateLimiter`, không debounce, không throttle — quyết định CÓ CHỦ Ý của
B-6, không phải thiếu sót: bất biến thật sự quan trọng cho một lệnh ghi (không tự động thử lại, không ghi
đúp) đã được ép ở tầng driver, độc lập với tốc độ request; bộ giới hạn tốc độ không phân biệt được "N lệnh
ghi hợp lệ trên N máy khác nhau" với "một script kẹt bắn lại đúng một lệnh" — rủi ro thật mà giới hạn tốc
độ hay dùng để chặn ở đây là vấn đề UI/quy trình thao tác (hộp thoại xác nhận trước khi bắn, §21.4), không
phải phía server. **Cổng chặn cảnh báo Critical là TOÀN FLEET, không theo từng máy** —
`CriticalAlarmGuardRule` chặn một lệnh ghi nếu BẤT KỲ cảnh báo Critical nào đang hoạt động ở bất cứ đâu
trong fleet, vì `Alarm.TargetId` không đủ tin cậy để xác định một mã máy cụ thể mà thu hẹp cổng chặn hơn —
một cảnh báo Critical ở máy A hiện đang chặn cả lệnh ghi tới máy B. Đây là hướng an toàn hơn (chặn nhiều
hơn một cổng theo-từng-máy, không bao giờ ít hơn), không phải lỗi. **`Indeterminate` là một trạng thái vận
hành thật, không phải mã lỗi** — xem §21.3 để biết ý nghĩa và operator nên làm gì khi thấy nó (dừng lại;
kiểm tra máy thật; đừng bắn lại phản xạ). **Không có đường lệnh vào từ hệ sinh thái** — Sparkplug NCMD
(topic lệnh vào) vẫn không bao giờ được nhận ở bất kỳ đâu trong mã nguồn (không đổi so với §20.5) — đường
ghi này chỉ tới được từ một caller HTTP cục bộ đã xác thực (web UI, hoặc gọi API trực tiếp), không bao giờ
từ một SYNAPSE Site hay hệ thống hướng lên nào khác.
🔴 **Máy do một tác nhân biên `St4i.EdgeService` cầm thì KHÔNG ghi được từ engine này, và engine này thậm
chí không nhìn thấy được rằng đó là tình huống đang xảy ra** — thêm ở Đợt E (E-4), phát biểu đầy đủ ở §24.4.
Hai sự thật riêng biệt, và cả hai đều thuộc về mục này: (1) `ITransport` **chỉ có chiều lên**, nên không có
đường xuống nào để một lệnh ghi đi tới tác nhân biên — máy do tác nhân biên cầm là **chỉ đọc** cho tới khi có
đường xuống, và từ E-3 điều đó là một *lỗi biên dịch* chứ không phải một lời hứa (`FleetCore` là `internal`);
(2) tác nhân biên đẩy **hướng lên nền tảng** và không bao giờ gọi engine này, thứ không phục vụ một route
ingest nào, nên ở đây không bao giờ có gì học được rằng một tác nhân biên tồn tại. **Vì thế các thông điệp
của nút ghi NÊU TÊN đường sinh ấy chứ không tuyên bố phát hiện được nó** — xem
`MachineWriteGate.ExplainUnavailable`, bốn chuỗi của nó đều đã được viết lại ở E-4 vì mỗi chuỗi đều mặc định
rằng có một connector tồn tại, và do đó đều sai với một cỗ máy không có connector nào.)*

### 21.7 Carried items — closed or routed / Các mục mang sang — đã đóng hoặc định tuyến

- **`ConnectorConfigStore.SaveAsync`'s parameter ordering** — closed this task: `CancellationToken ct` is
  now the LAST parameter (was previously sandwiched before `source`), matching every other method in this
  codebase; both production call sites updated to pass it by name.
- **Request-shape `400`s run ahead of the policy gate** (an unauthenticated-shape probe leaves no audit
  row) — routed, not fixed: documented as a deliberate tradeoff on `MachineWriteEndpoints`'s own class doc
  comment (no device I/O and no mutation happens on this path, so there is no machine action to miss
  auditing, only an unaudited malformed HTTP request).
- **`OpcUaDriver.DisposeSessionAsync`'s background `CloseAsync` running past HALT's 3-second budget** —
  already assessed at B-5/B-6 as resource hygiene, not a HALT-budget violation (`WaitAndDisposeOldPipeline`
  bounds the CALLER's wait; only the best-effort background close can run longer). B-8 confirms that
  assessment; no code change.
- **`OpcUaDriver.DisposeAsync` not taking `_sessionLock`** — a documented, accepted tradeoff (B-5): taking
  the lock would make HALT/disposal wait on whatever currently holds it, recreating the exact
  latency-coupling this project already fixed once. Confirmed, not changed.

---

## 22. Đợt C (C-1–C-8) — outbound alarm notification / Cảnh báo ra ngoài

**EN** — Until this batch, an alarm existed only on `/alarms` and in `alarms.db`, and reached nobody who
was not already looking at a screen. §20.5 recorded that as an honest limitation for two batches. It is
now false: this product ships **four notification channels**, an edge detector in front of them, a
configuration store with DPAPI-protected credentials, twelve HTTP routes with their own RBAC, and a
screen to drive all of it.

**Read this section for what the capability IS. Read §22.7 for what it is NOT** — that list is not
boilerplate; every entry on it was measured against source, and two of them (a green SMTP test proving
nothing about the password, and a relay that goes dark under HALT) are the kind of thing that gets a
person hurt if it is assumed rather than read.

*(VI: Trước đợt này, một cảnh báo chỉ tồn tại ở `/alarms` và trong `alarms.db`, không tới được ai không
đang nhìn màn hình — §20.5 ghi đó là giới hạn trung thực suốt hai đợt. Nay điều đó SAI: sản phẩm có
**bốn kênh báo ra ngoài**, một bộ dò cạnh đứng trước chúng, một kho cấu hình với thông tin đăng nhập
bảo vệ bằng DPAPI, mười hai route HTTP với RBAC riêng, và một màn hình để điều khiển tất cả. **Đọc mục
này để biết năng lực đó LÀ GÌ; đọc §22.7 để biết nó KHÔNG PHẢI là gì** — danh sách đó không phải văn mẫu:
mỗi mục đều đã đối chiếu với mã nguồn, và hai trong số đó (một bài gửi thử SMTP xanh không chứng minh gì
về mật khẩu, và một relay tắt ngóm khi HALT gài) là loại điều có thể làm ai đó bị thương nếu chỉ suy
đoán thay vì đọc.)*

### 22.1 The four channels / Bốn kênh

| Channel | What it does | Reaches | Needs network |
|---|---|---|---|
| **Webhook** (C-3) | HTTP `POST` of a JSON alarm envelope, **HMAC-signed** (`X-ST4I-Signature: v1=…`) plus an optional operator-configured auth header. Aimed at Slack, Teams, or an MES. | Anyone watching that chat channel or system | Yes |
| **E-mail / SMTP** (C-4) | One message per qualifying edge to a configured recipient list, over plain SMTP or **STARTTLS**. | Anyone on the recipient list | Yes |
| **Local annunciation** (C-5) | An alarm card **and a tone** pushed to every open page of this product's web UI over SSE (`GET /v1/alarms/annunciations`). The only channel that works with **no network at all** — which is what makes it the one that honours the standalone single-machine deployment. | Whoever has the UI open | No |
| **Relay / beacon** (C-6) | Energises a real annunciator through a **declared writable point or command** on a machine's register map, using the exact Đợt B write path (§21). | Anyone who can see the light or hear the horn | No (LAN to the device only) |

Each channel has its own **minimum priority** threshold and its own **enabled** flag, and each keeps its
own queue and its own counters — so "something is falling behind" can always be resolved to *which*.

**The wire contract for the webhook is a public interface** and is documented separately, for receiver
authors, in **`docs/ALARM_WEBHOOK_CONTRACT.md`** — including the one thing a receiver must get right:
**only `X-ST4I-Timestamp` and the raw body are covered by the signature**, so any decision that must be
trustworthy (dedup, routing, filtering) **must read the body**, never the convenience headers.

*(VI: Bốn kênh — **Webhook** (C-3): `POST` JSON ký HMAC + header xác thực tuỳ chọn, nhắm Slack/Teams/MES,
cần mạng. **Email/SMTP** (C-4): mỗi cạnh đủ điều kiện gửi một thư tới danh sách người nhận, qua SMTP
thường hoặc **STARTTLS**, cần mạng. **Báo tại chỗ** (C-5): thẻ cảnh báo **kèm tiếng chuông** đẩy qua SSE
tới mọi trang đang mở — kênh DUY NHẤT chạy được khi **hoàn toàn không có mạng**, nên nó là kênh tôn
trọng đúng kiểu triển khai một-máy-độc-lập. **Relay/đèn báo** (C-6): kích một đèn/còi thật qua một
**điểm hoặc lệnh ghi được đã khai báo** trong register map, dùng đúng đường ghi của Đợt B (§21). Mỗi kênh
có ngưỡng **mức ưu tiên tối thiểu** riêng, cờ **bật/tắt** riêng, hàng đợi riêng và bộ đếm riêng — nên
"có thứ gì đó đang tụt lại" luôn quy được về *kênh nào*. Hợp đồng dây của webhook là **giao diện công
khai**, tài liệu riêng ở `docs/ALARM_WEBHOOK_CONTRACT.md` — gồm điều một receiver bắt buộc phải làm
đúng: **chỉ `X-ST4I-Timestamp` và thân request thô được ký**, nên mọi quyết định cần tin cậy được (chống
trùng, định tuyến, lọc) **phải đọc thân request**, không bao giờ đọc các header tiện lợi.)*

### 22.2 What a fresh install actually does / Một bản cài mới thực sự làm gì

🔴 **This batch is NOT "additive and default-off", and that claim is retired.** It was made in C-1's
plan and it was true then. C-2's review deliberately overturned it: the notification seam is now
registered **unconditionally**, so a fresh install starts **one bounded channel, one drain loop and one
hosted service** it did not start before Đợt C. The reason is worth stating, because the alternative
looked cheaper: gating registration on "is at least one channel configured" left exactly one transition
— the first channel ever configured on a host that booted with none — needing an engine restart, bound
only by a doc comment. A rule that lives in prose is a rule the next person misses.

**What is still true, and it is the part that matters: with nothing configured, nothing is delivered to
anybody.** Whether anything is sent is decided by `NotificationConfigStore` at the point of delivery,
never by whether an object exists. And a fresh install says so out loud — `NotificationStartupNotices`
prints a **Warning** at boot ("No alarm notification channel is configured … NOTHING is sent to anyone
who is not looking at the screen"), rather than leaving silence to be discovered during an incident. It
warns just as loudly about the next state along: channels that are **configured but every one disabled**.

**Storm defence** is a condition of the whole batch, not a feature of one channel: C-1's edge detector
sits in front of everything, so the sources restating an unchanged alarm every 5 s produce **no**
notifications at all — only genuine `Raised`/`Restored`/`Escalated` **edges** do.

*(VI: 🔴 **Đợt này KHÔNG phải "cộng thêm và mặc định tắt" — khẳng định đó đã bị RÚT.** Nó đúng ở kế
hoạch C-1; review của C-2 chủ động lật lại: seam thông báo nay được đăng ký **vô điều kiện**, nên một
bản cài mới khởi động thêm **một channel có chặn, một vòng drain và một hosted service** mà trước Đợt C
không có. Lý do đáng nói vì phương án kia trông rẻ hơn: gán điều kiện "đã cấu hình ít nhất một kênh" để
lại đúng một chuyển tiếp — kênh đầu tiên được cấu hình trên một host khởi động khi chưa có kênh nào —
cần khởi động lại engine, mà chỉ được ràng buộc bằng một dòng chú thích. Một quy tắc sống trong văn xuôi
là quy tắc người sau bỏ sót. **Điều vẫn đúng, và là phần quan trọng: chưa cấu hình gì thì không gửi gì
cho ai.** Có gửi hay không do `NotificationConfigStore` quyết định tại thời điểm gửi, không phải do một
đối tượng có tồn tại hay không — và bản cài mới NÓI THẲNG điều đó: `NotificationStartupNotices` in một
**Cảnh báo** lúc khởi động thay vì để sự im lặng bị phát hiện giữa lúc có sự cố, và cảnh báo lớn tiếng
y như vậy cho trạng thái kế tiếp: đã cấu hình kênh nhưng **tất cả đều đang TẮT**. **Chống bão** là điều
kiện của cả đợt chứ không phải tính năng của một kênh: bộ dò cạnh của C-1 đứng trước tất cả, nên việc
các nguồn lặp lại một cảnh báo không đổi mỗi 5 giây tạo ra **KHÔNG** thông báo nào — chỉ cạnh thật
(`Raised`/`Restored`/`Escalated`) mới tạo.)*

### 22.3 Endpoints and roles / Endpoint và phân quyền

| Path | Verb | Role | Audited |
|---|---|---|---|
| `/v1/notifications/channels` | GET | Engineer | no |
| `/v1/notifications/status` | GET | Engineer | no |
| `/v1/notifications/annunciator` | GET | **Operator** | no |
| `/v1/notifications/webhook` | PUT / DELETE | Engineer | `notification.webhook.save` / `.delete` |
| `/v1/notifications/smtp` | PUT / DELETE | Engineer | `notification.smtp.save` / `.delete` |
| `/v1/notifications/local-annunciation` | PUT / DELETE | Engineer | `notification.localannunciation.save` / `.delete` |
| 🔴 `/v1/notifications/relay` | PUT / DELETE | **Admin** | `notification.relay.save` / `.delete` |
| `/v1/notifications/test` | POST | Engineer (**rate limited**, 1 per 5 s) | `notification.test` |

🔴 **The relay routes are Admin and the other ten are Engineer, and that is not an inconsistency.**
Saving a relay row whose `targetKind` is `Command` makes this engine perform — automatically, and for as
long as that row exists — an action a human needs Admin for (`MachineWriteGate.RoleFor`). That is
**granting authority**, not changing a setting. The gate is on the **route**, not inside the handler,
because an `if` in a handler body is invisible to `RbacPolicyTests`' endpoint-metadata sweep — the only
thing in the whole suite that can see a missing `.RequireAuthorization`. DELETE is Admin too: an
Engineer who could delete the row could silently un-configure the plant's beacon and could not put it
back, since the save is Admin.

**The two full reads are Engineer because they carry the whole configuration** — SMTP usernames, **every
alarm recipient's e-mail address**, webhook endpoints, and the machine and point a relay may energise.
The Operator-tier route (`/v1/notifications/annunciator`, added by C-8) is deliberately narrower: it
carries the beacon's believed state and the annunciation listener counts and **nothing else**, and its
handler never calls the store's configuration read at all — so no recipient address can reach it even if
the payload is widened later. That is a structural guarantee rather than a careful selection of fields.

**One rate limiter, on one route.** `POST /v1/notifications/test` is the only route that makes this
product emit something to a **third party**, so it is limited to one call per 5 s, refused with a `429`
rather than delayed. The **configuration writes are deliberately not limited**: they are local SQLite
writes, they are idempotent, and the moment an operator most needs to fix a configuration is during an
incident — a config write refused mid-alarm-storm is worse than the storm. The annunciation stream is
bounded a different way, by a **concurrent-listener cap** (32) rather than a rate limit, because its
cost is per *live connection*, not per connect.

*(VI: 🔴 **Route relay là Admin, mười route còn lại là Engineer — đó không phải sự thiếu nhất quán.**
Lưu một hàng relay có `targetKind = Command` khiến engine tự động thực hiện — và thực hiện suốt thời
gian hàng đó tồn tại — một hành động con người cần quyền Admin. Đó là **cấp quyền**, không phải đổi cấu
hình. Cổng đặt ở **ROUTE** chứ không trong thân handler, vì một `if` trong handler nằm ngoài tầm nhìn
của `RbacPolicyTests` — thứ duy nhất trong bộ test thấy được một `.RequireAuthorization` bị quên. DELETE
cũng là Admin: một Engineer xoá được hàng đó sẽ vô hiệu hoá đèn báo của nhà máy mà không đặt lại được,
vì lệnh lưu là Admin. **Hai route đọc đầy đủ là Engineer vì chúng mang toàn bộ cấu hình** — tài khoản
SMTP, **địa chỉ email của mọi người nhận cảnh báo**, endpoint webhook, và máy/điểm mà relay được phép
kích. Route mức Operator (`/v1/notifications/annunciator`, do C-8 thêm) hẹp hơn có chủ ý: nó chỉ mang
trạng thái đèn báo và số phiên trình duyệt đang nghe, **không gì khác**, và handler của nó không hề gọi
hàm đọc cấu hình của kho — nên không địa chỉ người nhận nào tới được đó kể cả khi payload bị mở rộng về
sau. Đó là bảo đảm mang tính CẤU TRÚC chứ không phải việc chọn trường cẩn thận. **Một bộ giới hạn tốc
độ, trên một route:** `POST /v1/notifications/test` là route duy nhất khiến sản phẩm phát ra thứ gì đó
tới **bên thứ ba**, nên bị giới hạn 5 giây/lần, từ chối bằng `429` chứ không trì hoãn. **Các route ghi
cấu hình cố ý KHÔNG bị giới hạn:** chúng là ghi SQLite cục bộ, idempotent, và lúc người vận hành cần sửa
cấu hình gấp nhất chính là lúc đang có sự cố — một lệnh ghi cấu hình bị từ chối giữa bão cảnh báo còn tệ
hơn cơn bão nó ngăn. Luồng báo tại chỗ được chặn theo cách khác: **giới hạn số kết nối đồng thời** (32)
chứ không phải rate limit, vì chi phí của nó nằm ở mỗi kết nối SỐNG chứ không ở mỗi lần kết nối.)*

### 22.4 🔴 The relay is not a safety device / Relay KHÔNG phải thiết bị an toàn

**EN** — Read this before wiring anything to it.

- **It is an ordinary machine write on an ordinary software path.** It is subject to the HALT latch, to
  the register map's declared limits, to a network that may be down, and to this process being alive.
- 🔴 **It does not light while HALT is latched.** The relay goes through `EstopGuardRule` unchanged, so
  the gate refuses the write — correct behaviour for a write path, and exactly wrong for a beacon.
  **HALT latched ⇒ the beacon does not light.**
- 🔴 **The same refusal applies to switching it OFF.** If HALT engages while the beacon is on, the
  release write is refused too, and the product ends up believing the annunciator is ON with no alarm
  latched. That state is reported explicitly rather than hidden — see §22.8.
- **Anyone who needs a light or a horn that works while HALT is engaged, or while this software is not
  running, must hardwire it.** A safety annunciator that must function when the software has failed is a
  hardwired circuit (**ISO 13849 Cat 3/4**). Routing it through this product is not that, and this
  product does not pretend otherwise.
- **A `Command` target can assert the annunciator and structurally cannot release it** — a command is an
  argument-less pulse. **A latching beacon needs a `Point` target**, with both an energise and a
  de-energise value. Those two values are configured explicitly and have **no default**, because a
  default would be this product choosing what to write to a coil it cannot prove is a lamp rather than a
  conveyor — and `true` is simply wrong for a Modbus holding register that wants `1`. The de-energise
  value is a separate value rather than a derived inverse, because the register map's declared range is
  the authority on what "off" is and this product must not infer it.
- **The register map remains the entire safety boundary.** The configuration stores a machine code and a
  **declared point/command NAME**, never an address — a configuration that stored a coil address would
  be a second, unvalidated boundary sitting beside the real one.

*(VI: Đọc mục này trước khi đấu bất cứ thứ gì vào relay. **Đó là một lệnh ghi máy bình thường trên đường
phần mềm bình thường** — chịu HALT latch, chịu giới hạn khai báo trong register map, chịu mạng có thể
đứt, và chịu việc tiến trình này còn sống hay không. 🔴 **Nó KHÔNG sáng khi HALT đang gài** — relay đi
qua `EstopGuardRule` không sửa đổi, nên cổng từ chối lệnh ghi: đúng với một đường ghi, và sai hoàn toàn
với một đèn báo. 🔴 **Từ chối đó áp dụng cả khi TẮT:** nếu HALT gài lúc đèn đang sáng, lệnh nhả cũng bị
từ chối, và sản phẩm rơi vào trạng thái tin rằng đèn ĐANG SÁNG trong khi không còn cảnh báo nào chốt —
trạng thái đó được báo cáo rõ ràng chứ không giấu, xem §22.8. **Ai cần một đèn hoặc còi hoạt động khi
HALT đang gài, hoặc khi phần mềm này không chạy, PHẢI đấu cứng.** Một đèn báo an toàn phải hoạt động khi
phần mềm đã hỏng là một mạch đấu cứng (**ISO 13849 Cat 3/4**); đi qua sản phẩm này thì không phải vậy,
và sản phẩm này không giả vờ ngược lại. **Mục tiêu kiểu `Command` kích được đèn nhưng về mặt cấu trúc
KHÔNG nhả được** — lệnh là một xung không tham số; **đèn chốt cần mục tiêu kiểu `Point`** với cả giá trị
kích và giá trị nhả. Hai giá trị đó phải khai báo tường minh và **KHÔNG có mặc định**, vì một mặc định
đồng nghĩa sản phẩm này tự chọn thứ để ghi vào một coil mà nó không chứng minh được là đèn chứ không
phải băng tải — và `true` đơn giản là sai với một thanh ghi Holding Modbus cần `1`. Giá trị nhả là một
giá trị RIÊNG chứ không phải nghịch đảo suy ra, vì dải khai báo trong register map mới là thẩm quyền
quyết định "tắt" nghĩa là gì, và sản phẩm này không được tự suy. **Register map vẫn là TOÀN BỘ ranh giới
an toàn:** cấu hình lưu mã máy và **TÊN điểm/lệnh đã khai báo**, không bao giờ lưu địa chỉ — một cấu
hình lưu địa chỉ coil sẽ là một ranh giới thứ hai, không được kiểm chứng, nằm cạnh ranh giới thật.)*

### 22.5 Configuration, credentials, and the ACL boundary / Cấu hình, thông tin đăng nhập, và ranh giới ACL

**EN** — Every channel's configuration lives in `notifications.db` under
`%ProgramData%\ST4I\sim\notifications\`, relocatable via **`ST4I_NOTIFICATIONS_DIR`** (§18.2).

- **Secrets are encrypted with DPAPI at the current-user scope** — webhook URLs (a Slack or Teams
  incoming webhook URL **is** a bearer capability: whoever holds it can post), webhook HMAC signing
  secrets, webhook auth tokens, and SMTP passwords.
- 🔴 **That directory's ACL is the confidentiality boundary** against another local account on the same
  machine. Relocating the store onto a share or a looser volume moves the boundary with it.
- 🔴 **No secret leaves through an endpoint, structurally: no HTTP handler reads one.** Reads use a
  single credential-free projection whose SQL cannot name an encrypted column, so a secret travels
  **inward only**. A read reports whether a credential *exists* (`hasSigningSecret`, `hasPassword`),
  never its value. This has a visible cost, and it is deliberate: **`PUT /v1/notifications/webhook`
  requires the URL on every save, including one that only changes a label** — the alternative would be
  decrypting a bearer capability inside a request handler. What makes it survivable is the stored
  `urlFingerprint`, which lets an operator confirm they are re-entering the same destination without
  ever being handed it.
- 🔴 **Secret fields are tri-state on save: absent = keep, `""` = clear, a value = replace.** A client
  that always sends an empty string for an untouched password field wipes the credential on every save.
  The one place that rule bends: **clearing `authHeaderName` also deletes the stored auth token**,
  because a token that names no header can never be sent — so a client editing an existing webhook must
  re-send every non-secret field it is not deliberately clearing.
- **Audit rows carry booleans, never values** (`signingSecretChanged`, `authTokenChanged`,
  `passwordChanged`); the relay's row additionally carries `grantsCommandAuthority`, because that one
  field decides whether the row makes the engine perform an Admin-tier command for as long as it exists.
- **A save that commits the row but fails to store the credential answers 500, not 200** — a committed
  webhook row whose signing secret did not commit would post **unsigned** from then on.
- **Deleting a channel takes its secrets with it** (`ON DELETE CASCADE`), so "remove this channel" can
  never strand a credential.
- 🔴 **Decommissioning:** `packaging/remove-data.ps1` purges this directory along with
  historian/wal/security/creds (§15.4). It did not before Đợt C's closeout, which meant a wiped machine
  kept live third-party credentials.

*(VI: Cấu hình mọi kênh nằm trong `notifications.db` dưới `%ProgramData%\ST4I\sim\notifications\`, đổi
chỗ được bằng **`ST4I_NOTIFICATIONS_DIR`** (§18.2). **Bí mật được mã hoá bằng DPAPI phạm vi người dùng
hiện tại** — URL webhook (một incoming webhook URL của Slack/Teams **LÀ** một capability: ai giữ nó thì
đăng được), khoá ký HMAC, token xác thực, mật khẩu SMTP. 🔴 **ACL của thư mục đó LÀ ranh giới bảo mật**
với một tài khoản cục bộ khác trên cùng máy; dời kho sang share hoặc ổ có quyền lỏng hơn là dời luôn
ranh giới. 🔴 **Không bí mật nào ra ngoài qua endpoint, và đó là điều mang tính CẤU TRÚC: không handler
HTTP nào đọc bí mật.** Các route đọc dùng đúng một phép chiếu không-chứa-bí-mật mà SQL của nó không thể
gọi tên một cột đã mã hoá, nên bí mật chỉ đi VÀO. Một lần đọc chỉ cho biết bí mật CÓ TỒN TẠI hay không
(`hasSigningSecret`, `hasPassword`), không bao giờ cho biết giá trị. Việc này có cái giá nhìn thấy được
và là cố ý: **`PUT /v1/notifications/webhook` bắt buộc phải có URL ở MỌI lần lưu, kể cả lần chỉ đổi
nhãn** — phương án ngược lại là giải mã một capability ngay trong request handler. Thứ khiến điều đó
sống được là `urlFingerprint` đã lưu: người vận hành xác nhận được mình đang nhập lại ĐÚNG đích đến mà
không bao giờ được đưa lại đích đó. 🔴 **Các trường bí mật có BA trạng thái khi lưu: vắng mặt = giữ,
`""` = xoá, có giá trị = thay.** Một client luôn gửi chuỗi rỗng cho ô mật khẩu không đụng tới sẽ xoá
mất thông tin đăng nhập ở mọi lần lưu. Chỗ duy nhất quy tắc đó bị bẻ: **xoá `authHeaderName` cũng xoá
luôn token đã lưu**, vì một token không có tên header thì không bao giờ gửi được — nên một client sửa
webhook đã có PHẢI gửi lại mọi trường không-bí-mật mà nó không cố ý xoá. **Hàng audit chỉ mang boolean,
không bao giờ mang giá trị**; riêng hàng relay mang thêm `grantsCommandAuthority`, vì đúng trường đó
quyết định hàng này có khiến engine thực hiện một lệnh mức Admin suốt thời gian nó tồn tại hay không.
**Một lần lưu ghi được hàng nhưng KHÔNG lưu được thông tin đăng nhập trả về 500 chứ không phải 200** —
một hàng webhook đã ghi mà khoá ký chưa ghi được sẽ đăng **KHÔNG KÝ** từ đó trở đi. **Xoá một kênh là
xoá luôn bí mật của nó** (`ON DELETE CASCADE`). 🔴 **Thanh lý máy:** `packaging/remove-data.ps1` nay xoá
cả thư mục này cùng historian/wal/security/creds (§15.4) — trước bản đóng Đợt C thì không, nghĩa là một
máy đã "xoá sạch" vẫn giữ thông tin đăng nhập bên thứ ba còn sống.)*

### 22.6 Web UI — `/notifications`, and the operator's beacon panel / Web UI

**EN** — Two surfaces, split along the role boundary §22.3 describes.

- **`/notifications` (Engineer+)** configures all four channels, shows every counter, and runs the send
  test. Its design is shaped almost entirely by the credential traps in §22.5:
  - The webhook URL field is **always empty and always required**, with the stored `endpoint`,
    `urlFingerprint`, `label` and signing state printed beside it. That is not an oversight.
  - **Every secret field is an explicit three-way KEEP / REPLACE / CLEAR chooser**, not a password box
    that renders empty. A box that looks empty and posts its contents is precisely how a save that only
    changed a label wipes a signing secret, because the API reads an empty string as "delete".
  - **`authHeaderName` is re-sent on every save**, and the field says out loud that emptying it also
    deletes the stored auth token — behaviour that follows from `PUT` meaning full replacement, and that
    is not guessable from the label.
  - 🔴 **The relay card renders for every Engineer, but its Save control is replaced by a sentence**
    naming Admin and saying why — the same shape Đợt B's command flow uses (§21.4). Hiding the card
    would tell an Engineer the beacon does not exist; disabling the button would tell them it is broken.
  - A webhook with an **auth header name but no token** — a webhook that cannot post at all — is called
    out on the card, because it is the one combination that looks configured and is not.
- **`/alarms` (Operator)** additionally shows the beacon's believed state and whether this page will be
  annunciated, over the narrow Operator route. An operator does not need the recipient list; they need
  to know whether the light above their head is telling the truth.

🔴 **The send-test result always shows what it does NOT prove**, with the same weight as what it does.
That is a field in the API response, not a UI nicety, because a statement only survives contact with a
UI if it is a field — and a caller that renders "OK" alone has visibly dropped something.

*(VI: Hai bề mặt, chia theo đúng ranh giới vai trò ở §22.3. **`/notifications` (Engineer trở lên)** cấu
hình cả bốn kênh, hiện mọi bộ đếm, và chạy bài gửi thử. Thiết kế của nó gần như hoàn toàn do các bẫy
thông tin đăng nhập ở §22.5 định hình: ô URL webhook **luôn rỗng và luôn bắt buộc**, kèm `endpoint`,
`urlFingerprint`, nhãn và trạng thái ký đã lưu in ngay bên cạnh — đó không phải sơ suất. **Mọi ô bí mật
là một bộ chọn ba trạng thái GIỮ / THAY / XOÁ tường minh**, không phải ô mật khẩu hiện rỗng: một ô trông
rỗng rồi gửi đi nội dung của nó chính là cách một lần lưu chỉ đổi nhãn xoá mất khoá ký, vì API đọc chuỗi
rỗng là "xoá". **`authHeaderName` được gửi lại ở mọi lần lưu**, và ô đó nói thẳng rằng bỏ trống nó cũng
xoá luôn token đã lưu — hành vi suy ra từ việc `PUT` nghĩa là thay thế toàn bộ, và không đoán được từ
cái nhãn. 🔴 **Thẻ relay hiển thị với mọi Engineer, nhưng nút Lưu bị thay bằng một câu** nêu tên quyền
Admin và nói lý do — đúng hình dạng luồng lệnh của Đợt B (§21.4): ẩn thẻ đi sẽ nói với Engineer rằng đèn
báo không tồn tại, còn làm mờ nút sẽ nói với họ rằng nó hỏng. Một webhook **có tên header xác thực nhưng
không có token** — tức một webhook không đăng được gì cả — được nêu rõ ngay trên thẻ, vì đó là tổ hợp
duy nhất trông như đã cấu hình mà thật ra thì không. **`/alarms` (Operator)** hiện thêm trạng thái đèn
báo và việc trang này có được báo động hay không, qua route Operator hẹp: người vận hành không cần danh
sách người nhận, họ cần biết cái đèn trên đầu mình có nói thật hay không. 🔴 **Kết quả gửi thử LUÔN hiện
cả điều nó KHÔNG chứng minh được**, cùng trọng lượng với điều nó chứng minh được — đó là một trường
trong phản hồi API chứ không phải một chi tiết UI, vì một tuyên bố chỉ sống sót qua tay UI khi nó là một
trường; và một caller chỉ hiện "OK" là đã đánh rơi một thứ nhìn thấy được.)*

### 22.7 🔴 Honest limitations / Giới hạn trung thực

**EN** — Each verified against the source file named after it, not asserted from memory:

- **There is no SMS channel and no syslog channel.** Slack and Teams are reachable, but only through
  their incoming-webhook URLs — there is no Slack API integration.
- 🔴 **There is no Windows desktop toast**, and an earlier doc comment predicted one. Three independent
  reasons, each sufficient (`NotificationConfig.cs`): the alarm engine runs only in the engine process
  and `St4i.DesktopShell` has no IPC to it; `Windows.UI.Notifications` does not resolve at the shell's
  target framework, and the toolkit package is a new NuGet this batch forbids; and **the decisive one** —
  measured on this platform, an unpackaged exe with an AppUserModelID registered nowhere had
  `ToastNotifier.Show()` return normally and report `Enabled` while Windows' own notification store held
  **zero** notifications for it. A channel built on that would report success while nothing emitted.
  What local annunciation delivers reaches the desktop shell anyway whenever its window is up, since the
  WebView2 **is** the web UI; the honest gap is a shell that is minimised or behind another window.
- 🔴 **Implicit TLS (SMTPS, port 465) is unreachable and no configuration can make it work.**
  `System.Net.Mail.SmtpClient` implements only RFC 3207 STARTTLS (`SmtpNotificationChannel.cs`). There
  is deliberately **no** implicit-TLS option in the configuration, because a store that accepted a value
  the channel must silently ignore is worse than one that never accepted it. An operator who needs SMTPS
  must point this at a relay speaking STARTTLS on 587 or plain SMTP on 25. A channel configured on port
  465 is warned about once per boot — bounded and counted, never left to hang.
- 🔴 **A green e-mail send test does NOT prove the stored password works**, and no arrangement of this
  code could make it (`SmtpNotificationChannel.cs`). `SmtpClient` proceeds to `MAIL FROM`
  **unauthenticated** in all three shapes where the credential is not successfully used — the relay
  rejects it, the relay refuses `AUTH`, or **the relay advertises no `AUTH` capability at all** (the
  reachable one) — and exposes no authentication result. Against an in-plant relay that then accepts the
  mail, the test is green and the password was never used. To actually be sure: read the relay's own
  logs, or point this at a relay that refuses anonymous mail. The API says this in the result, and the
  test message repeats it in its own body — because the person reading the mailbox is often not the
  person who pressed the button.
- 🔴 **The relay annunciator is not a safety device and does not light while HALT is latched.** §22.4.
- 🔴 **There is no relay send test, deliberately** (`NotificationEndpoints.cs`). It would be a real
  Admin-tier machine write that takes the coil away from the channel's own latch and **could leave a
  beacon lit by a test** if the release were then refused by the HALT latch — the exact failure the
  channel exists to prevent, caused by the affordance meant to diagnose it. Watch
  `relay.instances[].annunciatorState` instead. **A relay dry run** — resolving the machine code and
  target name and evaluating the write gate *without performing the write* — is the recommended shape
  for whoever picks this up, and **is not built**. It would catch the two failures an operator actually
  hits: a machine code that no longer resolves, and a target name whose case drifted.
- **There is no local-annunciation send test either**, for a different reason: it would publish a
  fabricated alarm card and tone to every open page, for a condition that is not happening. The stream's
  own `ready` frame and the listener count answer what that test would have.
- 🔴 **A stale beacon after a restart is a real, open case.** The relay channel's belief about the coil
  is per-process, so after a restart `annunciatorState` reports **UNKNOWN** until the next edge — honest,
  but it means a screen shows UNKNOWN for a beacon that may well be lit. Nothing in the product can
  re-assert a coil whose alarm episode completed while the process was dead.
- **There is no delivery guarantee behind any channel.** There is no delivery queue: if a channel fails,
  the notification is lost, and every channel counts its own losses so the loss is visible rather than
  silent (§22.8).
- 🔴 **A failed configuration read is indistinguishable from "nothing is configured"** in the data
  itself — the store's read is never-throws and returns the same empty result either way. That is why
  the store's own health (`readFailures` and a full sentence) is returned **beside** every read and
  every save, and why both the API and the screen show them together.
- **Webhook and e-mail need a network.** In a genuinely offline deployment only local annunciation and
  the relay work.
- 🔴 **`/hmi/:code` and `/tokens` render outside the app shell and are NOT annunciated** — the
  annunciator overlay is mounted in `Shell`, and those two routes deliberately bypass it (kiosk/
  standalone). **The shipped desktop deployment is covered**, because `St4i.DesktopShell` navigates to
  `/`, which is inside the shell; a browser parked directly on `/hmi/:code` is not. The HMI screen says
  so on itself rather than leaving it to this document.
- **Sparkplug NCMD — inbound commands from the ecosystem — is still never received** (unchanged from
  §20.5/§21.6). Nothing in Đợt C changes that.

*(VI: Mỗi mục đều đã đối chiếu với đúng file nguồn ghi kèm, không nói theo trí nhớ. **KHÔNG có kênh SMS
và KHÔNG có syslog**; Slack/Teams tới được nhưng chỉ qua incoming webhook URL, không có tích hợp Slack
API. 🔴 **KHÔNG có toast desktop Windows** — ba lý do độc lập, mỗi lý do đã đủ, và lý do quyết định là:
đo trên chính nền tảng này, một exe không đóng gói với AppUserModelID không đăng ký ở đâu cả có
`ToastNotifier.Show()` trả về bình thường và báo `Enabled`, trong khi kho thông báo của Windows giữ
**KHÔNG** thông báo nào — một kênh dựng trên đó sẽ báo thành công trong khi chẳng phát ra gì. Thứ mà báo
tại chỗ gửi ra vẫn tới được desktop shell bất cứ khi nào cửa sổ của nó đang mở, vì WebView2 CHÍNH LÀ web
UI; khoảng trống thật là khi shell bị thu nhỏ hoặc nằm sau cửa sổ khác. 🔴 **TLS ngầm (SMTPS, cổng 465)
không dùng được và không cấu hình nào cứu được** — `SmtpClient` chỉ có STARTTLS; cấu hình cố ý KHÔNG có
lựa chọn TLS ngầm, vì một kho nhận một giá trị mà kênh buộc phải âm thầm bỏ qua còn tệ hơn kho không bao
giờ nhận nó. Kênh cấu hình ở cổng 465 bị cảnh báo một lần mỗi lần khởi động — có chặn và có đếm, không
bao giờ để treo. 🔴 **Một bài gửi thử email xanh KHÔNG chứng minh mật khẩu đã lưu là đúng**, và không
cách sắp xếp nào của mã này làm được điều đó: `SmtpClient` đi tiếp tới `MAIL FROM` **không xác thực**
trong cả ba tình huống mà thông tin đăng nhập không được dùng thành công — relay từ chối nó, relay không
hỏi `AUTH`, hoặc **relay không hề quảng cáo `AUTH`** (tình huống dễ gặp nhất) — và không phơi bày kết
quả xác thực nào. Muốn chắc thật: đọc log của chính relay, hoặc trỏ vào một relay từ chối thư nặc danh.
API nói điều này ngay trong kết quả, và chính thân thư thử lặp lại nó — vì người đọc hộp thư thường
không phải người bấm nút. 🔴 **Relay không phải thiết bị an toàn và không sáng khi HALT gài** — §22.4.
🔴 **KHÔNG có bài gửi thử relay, có chủ ý**: nó sẽ là một lệnh ghi máy mức Admin thật, giành coil khỏi
latch của chính kênh đó, và **có thể để đèn sáng vì một BÀI THỬ** nếu lệnh nhả sau đó bị HALT chặn —
đúng thất bại mà kênh này sinh ra để ngăn, gây bởi chính công cụ dùng để chẩn đoán nó. Hãy xem
`relay.instances[].annunciatorState` thay thế. **Một bài CHẠY KHÔ cho relay** — phân giải mã máy và tên
mục tiêu rồi đánh giá cổng ghi *mà không thực hiện lệnh ghi* — là hình dạng được khuyến nghị cho người
tiếp nhận, và **CHƯA được xây**; nó sẽ bắt được đúng hai lỗi người vận hành thật sự gặp: mã máy không
còn phân giải được, và tên mục tiêu bị lệch hoa/thường. **Báo tại chỗ cũng không có bài gửi thử**, vì lý
do khác: nó sẽ đẩy một thẻ cảnh báo giả kèm chuông lên mọi trang đang mở cho một điều kiện không hề xảy
ra. 🔴 **Đèn báo cũ sau khi khởi động lại là một ca THẬT còn bỏ ngỏ:** niềm tin của kênh relay về coil
chỉ tồn tại trong tiến trình, nên sau khi khởi động lại `annunciatorState` báo **KHÔNG RÕ** cho tới cạnh
kế tiếp — trung thực, nhưng nghĩa là màn hình hiện KHÔNG RÕ cho một cái đèn có thể đang sáng thật.
**Không kênh nào có bảo đảm gửi tới nơi** — không có hàng đợi gửi lại: kênh hỏng thì thông báo mất, và
mỗi kênh tự đếm phần mất của mình để cái mất đó nhìn thấy được chứ không im lặng (§22.8). 🔴 **Một lần
đọc cấu hình THẤT BẠI không phân biệt được với "chưa cấu hình gì"** trong chính dữ liệu — nên sức khoẻ
của kho (`readFailures` kèm một câu đầy đủ) được trả về **BÊN CẠNH** mọi lần đọc và mọi lần lưu, và cả
API lẫn màn hình đều hiện hai thứ đó cùng nhau. **Webhook và email cần mạng** — ở một triển khai thật sự
ngoại tuyến chỉ còn báo tại chỗ và relay. 🔴 **`/hmi/:code` và `/tokens` render NGOÀI app shell nên
KHÔNG được báo động** — lớp phủ báo động gắn trong `Shell`, hai route đó cố ý đi vòng (kiosk/độc lập).
**Bản desktop xuất xưởng thì KHÔNG bị ảnh hưởng**, vì `St4i.DesktopShell` điều hướng tới `/` nằm trong
shell; một trình duyệt đỗ thẳng ở `/hmi/:code` thì có. Màn hình HMI tự nói điều đó chứ không để tài liệu
này nói hộ. **Sparkplug NCMD — lệnh vào từ hệ sinh thái — vẫn không bao giờ được nhận** (không đổi so
với §20.5/§21.6).)*

### 22.8 Counters whose short form lies / Những bộ đếm mà cách gọi tắt là sai

**EN** — Three of these were each corrected once by a review, and a three-word UI label is exactly what
would undo that. The API therefore ships the **full sentence** in the payload rather than leaving a
screen to invent a shorter one.

- 🔴 **`Unheard` does NOT mean "alarms nobody was told about".** It counts edges for which **no browser
  session was attached at the instant the edge happened**. Every alarm still standing when the engine
  started is counted here — nothing can be attached that early — **and is then replayed to the next page
  that connects**, because the annunciation stream serves the currently-active set at connect time. What
  remains permanently untold is only an edge whose alarm had already cleared before anyone connected: a
  transient nobody saw.
- 🔴 **`Energised` must never render as "off".** It has **three** states. `true` beside an empty latch
  set means **this product asked for the beacon to go OUT and was refused — it is still lit**. `null`
  means **this product does not know what the annunciator is doing** — a fresh process that has
  commanded nothing, or a write that returned `Indeterminate`, after which nobody knows whether the coil
  moved. Only `false` means off. Collapsing "unknown" into "off" is how a lit beacon becomes invisible
  on a screen. The API ships a rendered sentence (`annunciatorState`) for exactly this reason, and
  deliberately **omits** the related `Commanded` field from the wire shape so a screen cannot render the
  wrong one — a mistake made unavailable rather than merely discouraged.
- 🔴 **`PartiallyDelivered` is the only signal anywhere in this product that one recipient has silently
  stopped receiving alarms.** The mail relay accepted the message for some addresses and rejected it for
  others; the people on the rejected addresses were not told, nothing else will tell them, and the
  addresses are named only in the host log. It gets its own sentence and its own alert line rather than
  being one number among eight.
- **A non-zero `Lost` on any channel is a loss, phrased as one.** There is no delivery queue behind any
  channel, so those edges will not be re-emitted.
- **An `Attention` list that is empty means exactly that** — nothing currently needs attention. It is
  rendered as a sentence, never as a blank space that could equally mean "not loaded".

*(VI: Ba trong số này từng được một review sửa một lần rồi, và một cái nhãn UI ba chữ chính là thứ sẽ
phá lại điều đó — nên API mang **nguyên câu đầy đủ** trong payload thay vì để màn hình tự nghĩ ra bản
ngắn hơn. 🔴 **`Unheard` KHÔNG nghĩa là "cảnh báo không ai được báo".** Nó đếm những cạnh mà **không
phiên trình duyệt nào đang gắn vào đúng thời điểm cạnh đó xảy ra**. Mọi cảnh báo còn đang đứng lúc
engine khởi động đều bị đếm ở đây — không gì gắn được sớm thế — **rồi được phát lại cho trang kế tiếp
kết nối vào**, vì luồng báo động phục vụ tập đang hoạt động ngay lúc kết nối. Thứ mãi mãi không ai biết
chỉ là một cạnh mà cảnh báo của nó đã tự hết trước khi có ai kết nối: một thoáng qua không ai thấy. 🔴
**`Energised` KHÔNG BAO GIỜ được hiện thành "tắt".** Nó có **ba** trạng thái: `true` cạnh một tập chốt
rỗng nghĩa là **sản phẩm này đã yêu cầu đèn TẮT và bị từ chối — đèn vẫn đang sáng**; `null` nghĩa là
**sản phẩm này KHÔNG BIẾT đèn đang thế nào** — một tiến trình mới chưa ra lệnh gì, hoặc một lệnh ghi trả
về `Indeterminate`, sau đó không ai biết coil có chuyển hay không; chỉ `false` mới là tắt. Gộp "không
rõ" thành "tắt" chính là cách một cái đèn đang sáng trở nên vô hình trên màn hình. API mang sẵn một câu
đã dựng (`annunciatorState`) đúng vì lý do đó, và cố ý **BỎ** trường `Commanded` khỏi hình dạng dây để
màn hình không thể hiện nhầm trường kia — một lỗi bị làm cho KHÔNG THỂ mắc, chứ không chỉ bị khuyên
tránh. 🔴 **`PartiallyDelivered` là tín hiệu DUY NHẤT trong cả sản phẩm cho biết một người nhận đã âm
thầm ngừng nhận được cảnh báo** — relay thư nhận thư cho vài địa chỉ và từ chối các địa chỉ còn lại;
những người ở địa chỉ bị từ chối không được báo, không gì khác sẽ báo họ, và các địa chỉ đó chỉ được nêu
tên trong log của host. Nó có câu riêng và dòng cảnh báo riêng chứ không phải một con số trong tám con
số. **`Lost` khác 0 ở bất kỳ kênh nào là một sự MẤT, và được diễn đạt đúng như vậy** — không kênh nào có
hàng đợi gửi lại, nên những cạnh đó sẽ không được phát lại. **Danh sách `Attention` RỖNG nghĩa đúng là
như vậy** — hiện tại không có gì cần chú ý; nó được hiện thành một câu, không bao giờ là một khoảng
trắng có thể bị hiểu là "chưa tải xong".)*

---

## 23. Đợt D (D-1…D-7) — Modbus RTU / RS-485 multidrop / Modbus RTU / RS-485 nhiều thiết bị một dây

**EN** — Đợt D added the ability to drive **N devices that share one physical wire**. Everything before it
assumed one connector per protocol and one device per connector; RS-485 breaks both. This section is what
Đợt D actually built, what it deliberately did not, and the limits that must be said out loud.

### 23.1 Two transports, one framing, one document

A Modbus `connectors.json` entry whose `settings` declares a **`transport`** is not a connector — it is a
**bus**. Two transports ship:

| `transport` | What it is | Bus-level fields |
|---|---|---|
| `"rtu-gateway"` | RTU framing over a TCP socket to a serial device server (Moxa/USR-class). The device on the far side speaks RTU on a wire the gateway owns. | `host`, `port` (no default — a device server exposes one TCP port per physical line, and guessing which line was meant is how a write reaches the wrong bus) |
| `"rtu-serial"` | A **directly attached COM port**. | `portName` (required, no default), plus optional `baudRate`/`parity`/`dataBits`/`stopBits`, defaulting to MODBUS-over-Serial-Line's **19200-8-E-1** rather than `SerialPort`'s own 9600-8-N-1 |

Every device on the line goes in a **`devices`** array — required, **even for a single device**: a bus of
one is still a bus, and letting the root double as the only device would store the port path inside that
device's own configuration. Each element is a **complete single-device register map** with its own
`machineCode` and `unitId`, and **nothing is inherited from the bus level** — no shared `pollIntervalMs`,
no shared `readTimeoutMs`. That costs repetition and buys the property the whole design rests on: what an
operator pastes is exactly what each device stores and what its driver re-reads, so the file on disk and
the configuration running are one thing rather than two that have to be reconciled by hand.

An unrecognised bus-level key is **refused, not ignored** — a misspelled `baudRate` used to produce a
silent 19200-8-E-1 line, and a silently-ignored key is how "I set the port to 4001" becomes a belief the
system does not share.

### 23.2 Identity: connectors are per INSTANCE, and a bus owns a namespace

`ConnectorRegistry` is keyed by connector **instance id** (§19.4's correction). One RS-485 bus registers
**N** instances, each under the derived id **`{bus}:unit{slave address}`**, each claiming exactly one
machine code. That is what keeps a write routable: `SetpointWriteRequest` carries no machine code, so a
driver serving several machines could not tell which one a write was for — which is precisely the state
Đợt B's `AmbiguousDriver` guard exists to refuse. N instances × 1 machine each makes that state
unreachable rather than merely guarded against.

The `:unit<n>` namespace is **reserved**, and both doors into it refuse: a bus may not be NAMED like a
device position, and `POST /v1/connectors` refuses an operator-supplied instance id of that shape. Without
that rule a connector could be silently replaced — or deleted — by the next registration pass of a bus it
never belonged to.

### 23.3 The endpoints: one request, N of everything

`POST /v1/connectors` with a document that declares a `transport` creates a bus. Its shape, and the
reasoning, because "1 request → 1 machine → 1 audit row → 1 rollback" was this endpoint's whole contract:

- **N persisted rows** — one per device, keyed `{bus}:unit{n}`, written in **one SQLite transaction**. Each
  row carries the LINE in its `host`/`port` columns (`COM3` + `null` for a serial bus; the gateway's host
  and port for a gateway one) and the bus document in a column the credential-free projection **never
  selects**, the same structural discipline the register map itself has had since Đợt A.
- **A bus is saved whole or not at all.** If device 5 of 8 is invalid, **nothing** is saved and nothing is
  registered — the fan-out throws on the first device it cannot parse, naming which element of the array it
  was, before any store or registry mutation happens. "Register the 7 that parsed" was rejected: it leaves
  the operator with a bus silently one device short of the file they are reading, which is indistinguishable
  from a device that is merely unplugged.
- **ONE audit row**, targeted at the bus, whose after-state enumerates every device (instance id, unit id,
  machine code) and names the physical line. N rows would be N records of one operator action, and an
  auditor could not then tell one save of eight devices from eight saves.
- **The rollback cannot be half-done.** Its store half is one transaction and its undo is one transaction;
  its registry half is a set of removals that perform no I/O and cannot fail; and the one **irreversible**
  step — adding a machine to the fleet roster, which has no removal path — runs only after every reversible
  step has already succeeded, so no failure the endpoint can see ever has to undo it.

`GET /v1/connectors/configured` lists those rows, so an RS-485 line is finally visible on the one screen
this product has for "what is configured here" (before D-7b it was visible only in the startup log and in
`GET /v1/connectors`). `DELETE /v1/connectors/{instanceId}` removes **one device** off a bus — its siblings
keep running, and the response says how many devices remain on that line.

### 23.4 The `/connectors` screen

A bus renders as **one group with its own header** naming the line, with its devices listed by slave
position underneath. Eight rows differing only by a `:unit<n>` suffix is not intelligible — it makes the
operator do the grouping in their head every time, and it gives the Remove button nothing to say about
which device it is about to take off the wire. The confirmation dialog now names the device, its bus and
the machine it serves; the row's identity, the React key and the `DELETE` URL are all the **same** instance
id, so the thing the list points at and the thing the server is asked to remove cannot drift.

Per device the screen shows: the line it is on, the machine it serves, and its live state — *failed to
start* (from `GET /v1/connectors`, which is keyed per instance and therefore names the exact device whose
factory refused its configuration), *not in the roster this session*, or the machine's own status text.

🔴 **What the screen deliberately does NOT show is a "backed off" badge.** A device that stops answering
shows as degraded, and the product slows how often it takes the shared line so the healthy devices keep
their throughput (measured: one dead device on a bus collapses everyone else's read throughput by **67.5×**
without it). Whether a given device is *currently* backed off, as opposed to merely quiet, is published on
exactly one channel — the **application log**, where every failed poll records the consecutive-failure
count and the wait until the next attempt, and where recovery is logged once with the cadence being
restored. It is not on any HTTP projection because `IDeviceDriver` — the contract every connector in this
product implements — has no such member, and inventing one for a single transport would put a Modbus
concept on a seam shared by all of them. The screen says where the distinction lives rather than guessing
at a badge, because "backed off" and "not answering" have different remedies.

### 23.5 🔴 Limits that must be said out loud

- **RS-485 adapters with AUTOMATIC direction control only.** This product does not drive a transmit-enable
  (DE/RE) line, and it cannot: `System.IO.Ports.SerialPort` has no "transmission complete" event, no
  `RTS_CONTROL_TOGGLE`, and `BaseStream.Flush()` drains the driver's write buffer but **not** the UART's
  shift register — so software direction control could only ever be a timing guess, and on a shared wire a
  wrong guess corrupts another device's frame. An adapter that needs DE toggled by software is **not
  supported**. This is stated on the configuration form itself, not only here.
- **No Modbus frame has yet crossed a real serial port.** The serial transport is proven at the seam
  (reference scoping, cancellation, exclusive open, one open shared by N leases, the port actually being
  closed on disposal) and end to end **over a gateway socket**, but there was no virtual COM pair available,
  so **a bench acceptance step with real hardware remains outstanding**. That is a step, not a formality
  after a green gate.
- 🔴 **`Applied` on a command is an acknowledgement, not an observation.** It means a frame came back
  matching this request's slave address, function code, coil address and value. It does **not** prove the
  machine moved: RTU has nothing that ties a frame to a specific request, so a late echo of an earlier,
  already-finished pulse can be acknowledged in exactly the same way. Neither the UI nor these docs may
  present it to an operator as physical proof, and the UI says so at the point the capability is granted.
- **A deleted connector's MACHINE stays in the fleet roster until the process restarts.** `DELETE`
  releases the connector's live machine claim (D-7a), but `FleetHost.RegisterMachine` has no un-register, so
  the machine itself remains — and a replacement connector for that same machine code is still refused until
  a restart. What the released claim buys is that the refusal is the **roster's**, naming a machine that
  genuinely is in the fleet, instead of a ghost connector's, naming an instance the operator had already
  deleted. Roster removal reaches pipeline slots, alarm `TargetId`s, the historian and the asset registry;
  it is a named future batch. The `DELETE` response and the removal dialog both say this rather than letting
  an operator find it by trying.
- **ASCII framing is not implemented** (NModbus supports it; this product does not use it).
- **Broadcast (slave 0) is refused** at the RTU construction boundary — a broadcast write is unacknowledged
  by definition, so it can never report anything but `Indeterminate`, and a write path whose only honest
  answer is "unknown" is worse than no write path.
- **A device's own worst-case hold can starve the rest of its bus**, and the fan-out warns with the exact
  number when it does. A device declaring `readTimeoutMs: 60000` with `retries: 5` over 20 registers holds
  the line for about **two hours** per poll cycle. This is warned about, not refused: the arithmetic is
  decidable, but whether it is wrong depends on hardware this product cannot see.

### 23.6 🔴 The three hosts are NOT peers today — do not infer parity from three identical csproj lines

`St4i.EngineApi`, `St4i.EdgeService` and `St4iMachineSimulator` all `ProjectReference`
`St4i.EdgeCore.Serial` and all ship `System.IO.Ports.dll`. **Only `St4i.EngineApi` can open a COM port.**
> *(🔴 That sentence is corrected twice below — it was never true as a capability claim, and since E-5 it is
> not true as a configuration claim either. §24.3/§24.5 carry the current statement.)*

The other two have no connector-hosting layer at all: `ConnectorRegistry`, `ConnectorsConfig` and
`ConnectorsJsonRegistration` are EngineApi-only and are **not even reachable** from those projects (neither
csproj references `St4i.EngineApi`), and `EdgeWorker` collapses the whole fleet into **one**
`SimulatedDriver` driving **one** pipeline — it has no multi-driver concept to hang a connector on.

This is deliberate and it is going somewhere: the owner has confirmed `St4i.EdgeService` does run on the
machine with the RS-485 port, so the capability is wanted. What stands in the way is not the missing
registry (~1 342 lines, relocatable) but `FleetHost`'s **2 406-line N-driver lifecycle core** — machine
claims, slot resolution, health, restart, roster — which all three hosts would have to consume. Extracting
it is a **named future batch**, not an omission. The dependency is pre-positioned; the capability is not
there yet. `SerialDependencyScopingTests`' own assertion names carry the distinction
(`…_ByTheAllThreeHostsRuling` for the two that cannot open a port, a separate capability assertion for the
engine that can) and it must not be flattened.

> 🔴 **CORRECTED (Đợt E, E-4). Four of the paragraphs above are now false, one of them was never true, and
> the correction is kept in place rather than rewritten away** — the same treatment §20.5 and §21.6 already
> give a claim that outlived its batch. **Read §24 for the current statement.** Point by point:
>
> - **"Only `St4i.EngineApi` can open a COM port" was never true as a CAPABILITY claim** — not since D-7c
>   itself, which is what gave all three hosts the `ProjectReference`. `SerialPortBusLink.OpenAsync` and
>   `SerialLineSettings` are both `public` on `St4i.EdgeCore.Serial`; nothing about visibility or the
>   reference graph stops any of the three opening a port. Measured two ways rather than read: a probe file
>   compiled into the production `St4i.EdgeService` assembly builds with **0 errors** (contrast `FleetCore`,
>   which gives `CS0122` from that same assembly — §24.1), and
>   `EdgeServiceSerialReachabilityTests` actually performs the open from that host's own reference graph and
>   is refused by the **operating system**, not by the compiler. The TRUE statement is about
>   **configuration**: only `St4i.EngineApi` had a configured path from `connectors.json` to a serial open —
>   🔴 **and since E-5 so does `St4i.EdgeService`; two of the three hosts do, and only the WPF shell does
>   not (§24.3/§24.5).**
>   That distinction is not pedantic — §2's protection for a directly-attached port IS the OS refusing a
>   second open, and a reader who believes this host *cannot* open a port will never ask which process holds
>   COM3.
> - **"`ConnectorRegistry`, `ConnectorsConfig` … not even reachable"** — false since E-2/E-3. Both moved
>   DOWN to `St4i.EdgeCore`, which all three hosts already reference, so the test "does its csproj reference
>   `St4i.EngineApi`?" no longer answers the question it was standing in for. Only
>   `ConnectorsJsonRegistration` (the dispatch) is still EngineApi-only, and §24.2 says why. 🔴 **E-5
>   narrowed that further: `ModbusMultidropRegistration` and `ModbusRtuBusPlan` moved down too, so what is
>   still EngineApi-only is the dispatch's TCP/OPC-UA arms and their `ConnectorConfigValidation` binding.**
> - **"`EdgeWorker` collapses the whole fleet into one `SimulatedDriver` driving one pipeline"** — false
>   since E-3. It runs **N** drivers on **N** pipelines from `connectors.json` (§24.2).
> - **"What stands in the way is `FleetHost`'s 2 406-line N-driver lifecycle core, which all three hosts
>   would have to consume"** — false, and it was the batch's own founding assumption until E-3 measured it.
>   The edge agent does **not** consume that core and structurally cannot: `FleetCore` is `internal`
>   precisely so this host cannot reach its unguarded write path. It got `EdgeAgentPipelines` instead
>   (§24.1).

*(VI — **Đợt D thêm khả năng điều khiển N thiết bị dùng CHUNG một sợi dây.** Mọi thứ trước đó giả định mỗi
giao thức một kết nối và mỗi kết nối một thiết bị; RS-485 phá vỡ cả hai.

**23.1 — Hai loại đường truyền, một kiểu đóng khung, một tài liệu.** Một entry Modbus trong
`connectors.json` mà `settings` có khai báo **`transport`** thì không phải một kết nối — nó là một
**TUYẾN**. `"rtu-gateway"`: đóng khung RTU qua socket TCP tới bộ chuyển đổi serial (cần `host` + `port`,
không có mặc định — mỗi đường dây vật lý là một cổng TCP riêng, đoán nhầm là ghi nhầm dây).
`"rtu-serial"`: **cổng COM gắn trực tiếp** (cần `portName`, không mặc định; `baudRate`/`parity`/`dataBits`/
`stopBits` tuỳ chọn, mặc định **19200-8-E-1** theo chuẩn MODBUS-over-Serial-Line chứ không phải 9600-8-N-1
của `SerialPort`). Mọi thiết bị nằm trong mảng **`devices`** — bắt buộc, **kể cả khi chỉ có một thiết bị**:
một tuyến một thiết bị vẫn là một tuyến. Mỗi phần tử là một sơ đồ thanh ghi HOÀN CHỈNH của một thiết bị, và
**không có gì được kế thừa từ mức tuyến xuống**. Tốn công lặp lại, nhưng đổi lấy tính chất mà toàn bộ thiết
kế dựa vào: cái operator dán vào chính là cái mỗi thiết bị lưu và driver của nó đọc lại — file trên đĩa và
cấu hình đang chạy là MỘT thứ. Một khoá lạ ở mức tuyến bị **từ chối, không bị bỏ qua**: một `baudRate` gõ
sai trước đây tạo ra một đường 19200-8-E-1 im lặng.

**23.2 — Định danh theo THỂ, và một tuyến sở hữu một vùng tên.** `ConnectorRegistry` key theo **instance
id**. Một tuyến RS-485 đăng ký **N** thể, mỗi thể dưới id dẫn xuất **`{tuyến}:unit{địa chỉ slave}`**, mỗi
thể chiếm đúng MỘT mã máy. Đó là thứ giữ cho một lệnh ghi định tuyến được: `SetpointWriteRequest` không
mang mã máy, nên một driver phục vụ nhiều máy sẽ không biết lệnh ghi dành cho máy nào — đúng trạng thái mà
`AmbiguousDriver` của Đợt B sinh ra để từ chối. Vùng tên `:unit<n>` được **dành riêng**, và cả hai cửa cấp
phát đều từ chối.

**23.3 — Endpoint: một yêu cầu, N của mọi thứ.** `POST /v1/connectors` với tài liệu có `transport` sẽ tạo
một tuyến: **N dòng lưu trữ** (mỗi thiết bị một dòng, ghi trong MỘT giao dịch SQLite; cột `host`/`port`
mang ĐƯỜNG DÂY — `COM3` + `null` với serial, host/port của gateway với gateway; tài liệu tuyến nằm ở một
cột mà phép chiếu không chứa bí mật **không bao giờ SELECT**). **Một tuyến được lưu trọn vẹn hoặc không lưu
gì cả**: nếu thiết bị thứ 5 trong 8 bị sai thì **không có gì** được lưu và không có gì được đăng ký — phép
nở ra ném lỗi ngay ở thiết bị đầu tiên không parse được, nêu rõ phần tử nào, TRƯỚC mọi thay đổi. "Đăng ký 7
cái parse được" bị từ chối: nó để lại cho operator một tuyến thiếu âm thầm một thiết bị so với file họ đang
đọc, không phân biệt được với một thiết bị chỉ đơn giản là chưa cắm dây. **MỘT dòng audit**, nhắm vào tuyến,
với trạng thái-sau liệt kê từng thiết bị. **Bản hoàn tác không thể dở dang**: nửa lưu trữ là một giao dịch
và phần hoàn tác cũng là một giao dịch; nửa registry là các thao tác gỡ không làm I/O và không thể hỏng; và
bước **không thể đảo ngược** duy nhất — thêm máy vào danh sách dây chuyền, thứ không có đường gỡ — chỉ chạy
SAU khi mọi bước đảo ngược được đã thành công. `DELETE /v1/connectors/{instanceId}` gỡ **một thiết bị** khỏi
tuyến; các thiết bị anh em vẫn chạy, và phản hồi nói rõ còn lại bao nhiêu thiết bị trên đường đó.

**23.4 — Màn hình `/connectors`.** Một tuyến hiển thị thành **một nhóm có tiêu đề riêng** nêu tên đường dây,
các thiết bị liệt kê bên dưới theo vị trí slave. Tám dòng chỉ khác nhau ở hậu tố `:unit<n>` là không đọc
được — nó bắt operator tự gom nhóm trong đầu mỗi lần, và làm cho nút Xoá không nói được nó sắp gỡ thiết bị
nào khỏi dây. Hộp thoại xác nhận nay nêu tên thiết bị, tuyến của nó và máy nó phục vụ; định danh của dòng,
khoá React và URL `DELETE` đều là **cùng một** instance id. 🔴 **Màn hình cố ý KHÔNG hiện nhãn "đang giãn
nhịp".** Việc một thiết bị cụ thể hiện có đang giãn nhịp hay chỉ im lặng được ghi ở đúng một nơi — **nhật ký
ứng dụng** — vì `IDeviceDriver`, hợp đồng mà mọi kết nối trong sản phẩm này đều cài đặt, không có trường nào
như thế, và thêm một trường riêng cho một loại đường truyền sẽ đưa khái niệm của Modbus lên giao diện dùng
chung cho tất cả. "Đang giãn nhịp" và "không trả lời" có cách xử lý khác nhau, nên đoán là tệ hơn nói thẳng.

**23.5 — Những giới hạn phải nói thẳng.** (a) **CHỈ hỗ trợ bộ chuyển đổi RS-485 tự động đảo chiều.** Sản
phẩm này không điều khiển chân DE/RE và cũng không thể: `SerialPort` không có sự kiện "đã phát xong", không
có `RTS_CONTROL_TOGGLE`, và `BaseStream.Flush()` chỉ xả bộ đệm ghi của driver chứ **không** xả thanh ghi
dịch của UART — nên đảo chiều bằng phần mềm chỉ có thể là một phép đoán thời gian, và trên dây dùng chung
một phép đoán sai làm hỏng khung tin của thiết bị khác. Adapter cần phần mềm bật/tắt DE thì **không được hỗ
trợ**; điều này được nói ngay trên biểu mẫu cấu hình, không chỉ ở đây. (b) **Chưa có khung Modbus nào đi qua
một cổng serial thật.** Đường truyền serial đã được kiểm chứng ở lớp ghép nối và đầu-cuối **qua gateway**,
nhưng không có cặp COM ảo, nên **vẫn còn một bước nghiệm thu trên bàn với phần cứng thật** — đó là một
bước, không phải thủ tục sau một cổng xanh. (c) 🔴 **`Applied` của một lệnh là một sự XÁC NHẬN, không phải
một QUAN SÁT.** Nó chỉ có nghĩa là một khung tin quay về khớp địa chỉ slave, mã hàm, địa chỉ coil và giá
trị. Nó **không** chứng minh máy đã chuyển động: RTU không có gì buộc một khung tin với một yêu cầu cụ thể,
nên một khung echo về muộn của một xung đã kết thúc trước đó vẫn được xác nhận y hệt. Cả giao diện lẫn tài
liệu đều không được trình bày nó cho operator như bằng chứng vật lý, và giao diện nói đúng điều đó ngay tại
chỗ cấp quyền ghi. (d) **Máy của một kết nối đã xoá VẪN nằm trong danh sách dây chuyền cho tới khi khởi động
lại tiến trình.** `DELETE` giải phóng quyền chiếm mã máy (D-7a), nhưng `FleetHost.RegisterMachine` không có
đường gỡ, nên bản thân cái máy vẫn còn — và một kết nối thay thế cho cùng mã máy vẫn bị từ chối cho tới khi
khởi động lại. Cái mà việc giải phóng quyền chiếm mua được là: lời từ chối giờ là của **danh sách dây
chuyền**, nêu tên một cỗ máy thật sự đang trong đội hình, chứ không phải của một kết nối ma mà operator đã
xoá. Gỡ máy khỏi danh sách chạm tới slot pipeline, `TargetId` của cảnh báo, historian và sổ tài sản — đó là
một đợt việc riêng đã được đặt tên. Cả phản hồi `DELETE` lẫn hộp thoại xoá đều nói rõ điều này. (e) **Không
làm đóng khung ASCII.** (f) **Broadcast (slave 0) bị từ chối** ngay ở ranh giới dựng RTU — một lệnh ghi
broadcast theo định nghĩa là không có phản hồi, nên nó không bao giờ báo được gì ngoài `Indeterminate`.
(g) **Thời gian giữ dây tệ nhất của một thiết bị có thể bỏ đói cả tuyến**, và phép nở ra cảnh báo kèm đúng
con số đó khi điều này xảy ra.

**23.6 — 🔴 Ba host KHÔNG ngang hàng nhau ở thời điểm này; đừng suy ra sự ngang hàng từ ba dòng csproj
giống nhau.** `St4i.EngineApi`, `St4i.EdgeService` và `St4iMachineSimulator` đều `ProjectReference`
`St4i.EdgeCore.Serial` và đều mang theo `System.IO.Ports.dll`. **Chỉ `St4i.EngineApi` mở được cổng COM.**
*(🔴 Câu ấy được đính chính hai lần ở dưới — chưa bao giờ đúng nếu hiểu là KHẢ NĂNG, và kể từ E-5 thì cũng
không còn đúng nếu hiểu là CẤU HÌNH nữa. §24.3/§24.5 mang phát biểu hiện hành.)*
Hai host còn lại không có lớp chứa connector nào cả: `ConnectorRegistry`, `ConnectorsConfig`,
`ConnectorsJsonRegistration` chỉ có trong EngineApi và **thậm chí không với tới được** từ hai project kia
(không csproj nào tham chiếu `St4i.EngineApi`), còn `EdgeWorker` gộp cả đội hình vào **một**
`SimulatedDriver` chạy **một** pipeline — nó không có khái niệm nhiều driver để gắn connector vào. Đây là
chủ ý và nó đang đi tới đâu đó: chủ sản phẩm đã xác nhận `St4i.EdgeService` CÓ chạy trên chính cái máy có
cổng RS-485, nên khả năng này là thứ được mong muốn. Thứ cản đường không phải cái registry còn thiếu
(~1 342 dòng, di dời được) mà là **lõi vòng đời N-driver 2 406 dòng của `FleetHost`** — quyền chiếm máy,
phân giải slot, sức khoẻ, khởi động lại, danh sách đội hình — thứ cả ba host sẽ phải dùng chung. Tách nó ra
là **một đợt việc riêng đã được đặt tên**, không phải một thiếu sót. Phụ thuộc đã được đặt sẵn; khả năng thì
chưa có. Tên các assertion trong `SerialDependencyScopingTests` đã mang sẵn sự phân biệt này
(`…_ByTheAllThreeHostsRuling` cho hai host chưa mở được cổng, và một assertion khả-năng riêng cho engine mở
được) và không được làm phẳng nó đi.

🔴 **ĐÍNH CHÍNH (Đợt E, E-4). Bốn đoạn ở trên nay đã SAI, một trong số đó chưa bao giờ đúng, và bản đính
chính được giữ tại chỗ chứ không viết đè** — đúng cách §20.5 và §21.6 đã làm với một khẳng định sống lâu hơn
đợt sinh ra nó. **Xem §24 để có phát biểu hiện hành.** (a) **"Chỉ `St4i.EngineApi` mở được cổng COM" chưa
bao giờ đúng nếu hiểu là KHẢ NĂNG** — thậm chí ngay từ D-7c, chính cái ruling đã cho cả ba host tham chiếu
`St4i.EdgeCore.Serial`. `SerialPortBusLink.OpenAsync` và `SerialLineSettings` đều `public`; không có gì về
tầm nhìn hay đồ thị tham chiếu ngăn bất kỳ host nào mở một cổng. **Đo bằng hai dụng cụ chứ không phải đọc**:
một file probe biên dịch thẳng vào assembly sản phẩm `St4i.EdgeService` build ra **0 lỗi** (đối chiếu:
`FleetCore` cho `CS0122` từ chính assembly đó — §24.1), và `EdgeServiceSerialReachabilityTests` thực sự mở
cổng từ đồ thị tham chiếu của host ấy và bị **hệ điều hành** từ chối, không phải trình biên dịch. Câu ĐÚNG
nói về **CẤU HÌNH**: chỉ `St4i.EngineApi` có một đường đã cấu hình từ `connectors.json` tới một lệnh mở cổng
serial — 🔴 **và kể từ E-5 thì `St4i.EdgeService` cũng có; HAI trong ba host có, chỉ vỏ WPF là không
(§24.3/§24.5).** Phân biệt này không phải bắt bẻ chữ nghĩa — bảo vệ duy nhất cho một cổng cắm thẳng (§2) CHÍNH LÀ việc
hệ điều hành từ chối lần mở thứ hai, và người đọc tin rằng host này "không thể" mở cổng sẽ không bao giờ hỏi
tiến trình nào đang giữ COM3. (b) **"`ConnectorRegistry`, `ConnectorsConfig` … không với tới được"** — sai kể
từ E-2/E-3: cả hai đã dời XUỐNG `St4i.EdgeCore`, thứ cả ba host vốn đã tham chiếu, nên phép thử "csproj có
tham chiếu `St4i.EngineApi` không?" không còn trả lời được câu hỏi nó đứng thay. Chỉ còn
`ConnectorsJsonRegistration` (phần dispatch) là của riêng EngineApi — §24.2 nói vì sao. 🔴 **E-5 thu hẹp
thêm: `ModbusMultidropRegistration` và `ModbusRtuBusPlan` cũng đã dời xuống, nên thứ còn của riêng EngineApi
là hai nhánh TCP/OPC-UA của phần dispatch cùng phép ràng buộc `ConnectorConfigValidation` của chúng.** (c) **"`EdgeWorker`
gộp cả đội hình vào một `SimulatedDriver` chạy một pipeline"** — sai kể từ E-3: nó chạy **N** driver trên
**N** pipeline từ `connectors.json` (§24.2). (d) **"Thứ cản đường là lõi vòng đời N-driver 2 406 dòng của
`FleetHost`, thứ cả ba host sẽ phải dùng chung"** — sai, và đó chính là giả định nền của cả đợt cho tới khi
E-3 đo nó: tác nhân biên **không** dùng cái lõi ấy và về cấu trúc thì không thể — `FleetCore` là `internal`
đúng để host này không với tới đường ghi không có chốt của nó. Cái nó nhận là `EdgeAgentPipelines` (§24.1).)*

---

## 24. Đợt E (E-1…E-5) — the fleet core moved, and RS-485 runs at the edge / Lõi đội hình đã tách, và RS-485 chạy ở tác nhân biên

**EN** — Đợt D left one sentence standing: `St4i.EdgeService` runs on the machine with the RS-485 port and
could not host a connector at all. Đợt E moved the N-driver lifecycle core out of `St4i.EngineApi`, gave the
edge agent a connector-hosting layer of its own, and — in **E-5** — moved the multidrop registration down so
the port on that machine is finally usable from the process running on it. This section says what that host
can now do, **what it still cannot**, and which of the two the difference is a decision rather than a gap.
Read §24.4 before pointing an operator at a write button on a machine an edge agent drives.

### 24.1 What moved, and the one thing the edge agent deliberately did NOT get

`FleetHost`'s whole body — N-driver lifecycle, roster, slot resolution, health, restart, the write path, the
safety latch and its lock — moved to `St4i.EdgeCore.Fleet.FleetCore`, together with `ConnectorRegistry`,
`MachineState`, `SafetySnapshot`, `DriverHealthSnapshot` and `MachineDriverAvailability`. `St4i.EngineApi`'s
`FleetHost` is now a thin shell over it that holds **no lock of its own**, and every DTO/projection, the
scenario preset catalogue and all endpoints stayed put.

🔴 **`FleetCore` is `internal`, and that is the whole read-only story in one keyword.** The edge agent does
**not** run the core and structurally cannot name it: a probe file compiled into the production
`St4i.EdgeService` assembly gives `error CS0122: 'FleetCore' is inaccessible due to its protection level`.
It runs `St4i.EdgeCore.Engine.EdgeAgentPipelines` instead — N drivers, N pipelines, one transport, per-pipeline
fault isolation, and **no member that accepts, returns or exposes an `IDeviceDriver`**. Thirteen state-mutating
members plus one indirect route are closed by that one keyword, not by a list of names, and the number itself
is asserted (`EdgeAgentWriteSurfaceTests`, run from an assembly with no `InternalsVisibleTo`).

**The honest boundary on that claim, because a stronger version of it was written first and was wrong:** the
`machineCode → driver` **lookup** is `public` on `ConnectorRegistry` and this host holds a populated one, so
a future contributor could build a NEW driver and write through it in a few lines that compile today. What is
unreachable is narrower and is the part that matters: the two write members that ask no HALT-latch question,
and the **live slot table** that maps a machine to the driver a running pipeline is actually holding.
Closing the rest is a `ConnectorRegistry` question, not a `FleetCore` one.

### 24.2 `St4i.EdgeService` hosts connectors now — Modbus TCP **and Modbus RTU** on the wire

It reads its own `connectors.json` (`--connectors <path>`, else beside the exe) through the **same parser**
both hosts share (`ConnectorsConfig`, moved to `St4i.EdgeCore.Config` in E-3 — one file, one reader), and
registers **one instance per entry**, so N entries mean N drivers on N pipelines. A deployment with no
`connectors.json` behaves exactly as it did before E-3 — same simulated group, same transport, same event bus
— and that is a property of **one code path with an empty registry**, not of a branch nobody exercises.

| Entry | This host | Why, and where it is pinned |
|---|---|---|
| **Modbus TCP** | **runs it** | `ModbusConnectorFactory` is in `St4i.EdgeCore`; a `ModbusTcpDriver` owns a socket and no machine-wide file. |
| **Modbus RTU** (an entry declaring a `transport`) | 🔴 **runs it, since E-5** — one entry becomes **N** instances, one per device, each claiming one machine | An RTU entry is a **bus**. Until E-5 this host refused it, because the fan-out reached `RtuBusConfiguration.IsInBusNamespace` in `St4i.EngineApi` — an assembly this host cannot reference. E-5 **moved** that rule (to `ModbusMultidropMap`) and the fan-out (to `St4i.EdgeCore.Config`), so there is still exactly **one** fan-out and one answer to "which registration owns this device"; both hosts call it. Both transports run: a COM line and an RTU-over-TCP gateway. Pinned by `EdgeWorkerConnectorsTests.AnRtuBusEntry_FansOutIntoOneInstancePerDevice_…` and, end to end at the transport, by `St4i.EdgeCore.Tests…ModbusMultidropAgentTests`. |
| **OPC-UA** | **still refused by name** | Not a missing type — `OpcUaConnectorFactory` is right there and would compile. An `OpcUaDriver` writes its app-instance certificate into `%ProgramData%\ST4I\sim\opcua-pki`, **machine-wide, no per-process key**, and dispatching it here would make this host a second writer to the same certificate store `St4i.EngineApi` writes. The mechanism to avoid that already existed (`OpcUaConnectorFactory` takes `pkiDir`; `OpcUaPkiPaths.ResolveRoot` honours `ST4I_OPCUA_PKI_DIR`). 🔴 **F-1 closed the BLOCKING CONDITION** — per-host data roots are a supported deployment (§15.9) — **and the refusal stands anyway, because what is left is work rather than a ruling**: this host has no `OpcUaOptions` of its own (endpoint, node map, PKI root), no dispatch arm, and no test that two hosts on two roots keep two certificate stores. Setting `ST4I_OPCUA_PKI_DIR` alone enables nothing, and the refusal message says so. Pinned by `AnOpcUaEntry_IsRefusedByName_…`. |
| **Any other kind** | refused | Same as EngineApi: this build has no plugin loader. |

**The OPC-UA refusal is a decision with a test, not an omission** — that is the difference between a refusal
that survives review and one that somebody "fixes" next month by adding a `switch` arm. The RTU refusal was
the same kind of decision and E-5 reversed it **in the open**: its pinning test was rewritten deliberately,
not left to go red and be patched green.

🔴 **One deliberate divergence from EngineApi, stated because a silent one would be a defect:** here every
entry registers under its **own `id`**, not under its kind. EngineApi keys a TCP/OPC-UA entry by kind because
adopting the operator's id would move an existing install's pipeline slot label and therefore its alarm
`TargetId`. **This host has no such legacy** — it has never hosted a connector — and kind-keying would
collapse every Modbus entry into one, which is precisely what "N entries mean N drivers" has to rule out.

🔴 **E-4 wrote here that "the two rules converge for free the day `ModbusMultidropRegistration` reaches
EdgeCore". That day was E-5 and they did not converge — the prediction was wrong, and enumerating the inputs
settles it.** The two rules already AGREED on an RTU bus (both key it on the operator's id), and E-5 made that
half shared code rather than two agreeing copies (`ConnectorsConfig.IsRtuBus`). They differ on exactly one
input class — a **TCP or OPC-UA** entry — which the fan-out move does not touch. Neither direction of
convergence is available: EngineApi adopting id-keying is the `TargetId` migration it has refused twice with a
test pinning the refusal, and this host adopting kind-keying would collapse N Modbus **TCP** entries (N
sockets, N machines) into one — a capability an RTU bus does not replace, because a bus is N devices on **one**
wire, not N sockets. So it stays a stated, tested divergence.

### 24.3 🔴 RS-485 runs at the edge — **E-5**, and what it actually moved

This was the largest limit E-1…E-4 left, and it was the same capability the plan's §1 named as the reason the
batch existed. Those four numbered tasks were each correct and each necessary, and **none of them was ever
scheduled to move the RTU registration** — a decomposition error, found only when E-3 hit the wall and
**measured** the remaining work instead of assuming it. E-5 is that work. What moved, and what did not:

| Piece | Before | After E-5 |
|---|---|---|
| `ModbusMultidropMap.IsInBusNamespace` | `RtuBusConfiguration` (`St4i.EngineApi`) — the **one** reference that made the fan-out un-moveable | `ModbusMultidropMap` (`St4i.EdgeCore`). **Moved, not copied**: still stated exactly once, and all three callers reach it. It belongs there because the two symbols encoding the `{bus}:unit{n}` FORMAT it decodes (`DeviceIdSuffixPrefix`, `LooksLikeADeviceInstanceId`) are declared on that type, beside the `DeviceInstanceId` that mints it. 🔴 **The E-5 review corrected an earlier universal here** — *"every fact it reasons about … is declared on that type"* — which was wrong at both ends: the predicate's third dependency, `DriverKinds.Normalize`, is `St4i.Connector.Abstractions`', and `DeviceInstanceId`, which the old list named, is never called. What made the MOVE safe is the separate fact that the third symbol sits in the contract assembly every project already references. |
| `ModbusMultidropRegistration` (344 lines) | `St4i.EngineApi.Config` | `St4i.EdgeCore.Config`, on EdgeCore's two-callback logging convention. |
| `ModbusRtuBusPlan` (107 lines) | `St4i.EngineApi.Config` | `St4i.EdgeCore.Serial` — the only assembly that can see **both** transports. |
| `ConnectorConfigValidation` (254 lines) | `St4i.EngineApi.Fleet` | **did not move, and is not needed**: it exists to learn the machine code a TCP entry's opaque blob declares, and a bus does not need it — the fan-out parses each device and hands its machine code out directly. E-3's estimate listed it; the enumeration removed it. |
| `RtuBusConfiguration` | `St4i.EngineApi.Fleet` | **did not move**, as measured: it also carries `TryFindBlockedDevice`/`ReleaseOwnNamespace` and is bound to EngineApi's roster and store. Only the predicate left it. |

🔴 **What this costs, said as an operational fact rather than a feature.** A COM port admits **one** process.
If `St4i.EdgeService` holds COM3, `St4i.EngineApi` cannot open it — so the machines on that line become
read-only from the engine (§24.4), and the two hosts share no channel through which either could know
(§24.4's second half). Two `connectors.json` files on one machine naming one port is an operator decision this
product does not arbitrate; on an RTU **gateway** there is not even the OS's refusal to arbitrate it (§2 of
the plan, and §24.5 below).

### 24.4 🔴 A machine an edge agent drives is READ-ONLY from this engine — and this engine cannot see that it is

Two facts, and conflating them is what made the write button's messages wrong for two batches:

1. **There is no downlink.** `ITransport` is upload-only (`SendAsync`/`HeartbeatAsync`/`SyncConfigAsync`, all
   client→server), so no write command can travel to an edge agent. Add the OS's exclusive `SerialPort` open,
   and a device the edge agent holds on a COM port is one this engine could not reach even if it wanted to.
   Since E-3 that limit is **structural** — `FleetCore` is `internal` — rather than a sentence in a document.
2. **This engine cannot DETECT the situation.** An edge agent pushes its readings **northbound to the
   platform** (`ST4I_SERVER_URL`, default `http://localhost:5000`) and never calls this engine, which listens
   on `:5199` and serves **no ingest route at all**. The two hosts share no roster, no claim registry and no
   channel. **Nothing here ever learns that an edge agent exists**, let alone which machines it holds.

**So the operator-facing messages NAME that path rather than claiming to detect it**, and that is the honest
form. E-4 rewrote all four. The defect they shared is the one this project keeps finding — **an
operator-facing string covering several producing paths and true of only some** — but it is worth stating
per string rather than as one property they all had, because they did not all have the same one:

| The operator sees | It used to say | Why that was wrong |
|---|---|---|
| `404` on the write button | *machine "X" not found* | **Literally true, and uninformative.** It names a typo or a never-onboarded machine. An edge-held machine is real, running and correctly configured **somewhere else** — and, because it never appears in this roster, this 404 is the FIRST thing such an operator meets. (The alarm relay's own version of this case is the one with a real fault, and it is the ADVICE: *"check the code, or onboard the machine"* — onboarding an edge-held machine here creates exactly the duplicate roster entry that makes this engine's picture of the plant wrong.) |
| `409 NO_LIVE_DRIVER` | *the fleet may be stopped, the HALT latch may be engaged, or this machine's connector failed to start this run … then retry* | **A disjunction that is not exhaustive** — only its third branch assumes a connector, and no branch at all covers a machine with **no connector configured here**. The sharper fault is the advice: "then retry" can never work for an edge-held device, and the obvious next move it invites (configure a connector here) puts a **second process on a device another one already drives**. |
| `409 READ_ONLY` | *this connector declares no writable points or commands* | **The one that genuinely presupposed a connector.** Its most common producer is a machine driven by the **built-in simulated group**, which has no connector at all. |
| `409 AMBIGUOUS_DRIVER` | (unchanged in substance) | Correct: one producing path, one true string. |

The replacements live in **one** place, `MachineWriteGate.ExplainUnavailable`, because there are **two**
surfaces that render this and they had already drifted apart: the HTTP body the web UI shows verbatim, and
the warning an operator reads when the **annunciator did not light** (`RelayNotificationChannel`).

🔴 **Two things about the replacements that are NOT finished, said here rather than discovered:** they are
**long** — measured with a 13-character machine code: 526 / **827** / 661 / 269 characters for
`MACHINE_NOT_FOUND` / `NO_LIVE_DRIVER` / `READ_ONLY` / `AMBIGUOUS_DRIVER`, rendered unwrapped in the control
tab's not-available banner — and they are **English-only**, like this product's entire HTTP error surface.
Correctness was chosen over brevity deliberately — a short string is what produced the defect — but "true,
and hard to read where you meet it" is not done. Shortening means either dropping a producing path (no) or
giving the banner progressive disclosure (a UI change); translating means an i18n decision this product has
never taken for API errors. Both are open items, not oversights.

**What it would take to actually distinguish "no connector configured" from "held by an edge agent"** — asked
and answered rather than left as a wish: an edge agent would have to REGISTER with this engine, which means a
cross-process machine-code claim. Today that claim is a `ConcurrentDictionary` **inside one process** — no
mutex, no lockfile, no named primitive — and the only protection that exists across processes is the OS
refusing a second open of a **COM port**; over a **TCP gateway** two processes both connect normally and
nothing refuses. Giving the engine that knowledge therefore means building the cross-process claim as well,
and that is a batch with a safety argument of its own, not a field on a DTO.

### 24.5 🔴 "Only `St4i.EngineApi` can open a COM port" — a claim about configuration, not capability

Stated here because §23.6 asserted it and §20.5 repeated it, and a claim corrected only where it is *filed*
is a claim still shipping wherever it was *repeated*.

All three hosts `ProjectReference` `St4i.EdgeCore.Serial`, ship `System.IO.Ports.dll`, and **can** open a COM
port: `SerialPortBusLink.OpenAsync` and `SerialLineSettings` are `public`. Measured two ways rather than read
— a probe compiled into the production `St4i.EdgeService` assembly builds with **0 errors**, and
`EdgeServiceSerialReachabilityTests` performs a real open from that host's own reference graph and is refused
by the **operating system**. What differs between the hosts is **configuration**: only `St4i.EngineApi` has a
configured path from `connectors.json` to a serial open; `St4i.EdgeService` refuses an RTU entry by name
(§24.2) and the WPF shell has no connector registry at all.

🔴 **E-5 changed the configuration half, and the sentence above is corrected rather than deleted because it
is the record of what was true through E-4.** Since E-5 **two** of the three hosts have a configured path from
`connectors.json` to a serial open — `St4i.EngineApi` and `St4i.EdgeService`; only the WPF shell does not.
The capability half was never the differentiator and still is not.

The distinction is load-bearing, not pedantry: §2's protection for a directly-attached line **is** the OS
refusing a second open, so a reader who believes this host *cannot* open a port will never ask which process
holds COM3 — and on a **gateway** there is no such protection to reason about at all.

### 24.6 Still true after Đợt E, unchanged

- **No Modbus frame has yet crossed a real serial port.** True after Đợt D, true after E-2, E-3 and E-4, and
  **still true after E-5** — which made the port reachable by configuration and did not touch that fact. Every
  RTU test in this repository runs on D-2's in-memory paired link (a real in-process NModbus slave network:
  real CRC, real t3.5 framing, real dispatch by slave address, real arbitration over one shared link — but no
  copper), or against a CLOSED loopback port whose connect is refused — a refused connect is not a socket.
  There is no RS-485 adapter on any build machine, and only adapters with
  **automatic** direction control are supported at all. A bench acceptance step with real hardware remains
  outstanding — a step, not a formality.
- **Two processes still share one set of machine-wide data files _by default_.** `AssetRegistryStore`/
  `CredentialStore`/`FleetSettingsStore` all live under `%ProgramData%\ST4I\sim\…` with no per-process key.
  The edge agent touches neither the asset registry nor the settings store today (its only pre-existing writer
  is the WAL queue), so nothing regressed — **and E-5 did not change that either: an RS-485 bus opens a COM
  port and a gateway bus opens a socket; neither is a store, and the shared-open bookkeeping is an in-process
  dictionary the host owns.** 🔴 **F-1 changed the "by default": per-host data roots are now a SUPPORTED
  deployment (§15.9)** — every one of the **eighteen** (🔴 thirteen until 2026-08-23, sixteen until
  2026-08-30 — WS-HMI-0a Task 5 added `hmi-model`/`hmi-tags`) **machine-wide**
  directories under `%ProgramData%` is
  relocatable by a derivable `ST4I_*_DIR`
  variable, and a test derives both sets from `src/` so a **nineteenth** machine-wide store cannot arrive
  without one. 📎 **The clause that used to follow — *"a beside-the-binary store can, and does; that is what
  the second population below is"* — is RETRACTED 2026-08-23 (BF-1) and kept verbatim:** the owner moved all
  three of those stores under `%ProgramData%`, so the second population is EMPTY and a store arriving beside
  the binary is no longer something this product does. The guard for that population still exists and now
  pins it at exactly zero, which is the only form in which an emptiness is worth asserting. What
  F-1 did **not** do is set them for you: unset still means one shared set of files, and nothing migrates when
  you change one. 🔴 **H-1c added the qualifier "machine-wide" here because it was load-bearing and missing:**
  the product writes three further stores BESIDE THE ENGINE BINARY, where isolation between two hosts is
  accidental rather than mechanical — §15.9's second-population section is the one to read before planning a
  two-host box. **The decision that was blocking OPC-UA at the edge is therefore closed** — see §24.2 for
  what remains, which is engineering rather than a ruling.
- **A deleted connector's machine stays in the roster until restart** (§23.5), unchanged.

### 24.7 🔴 One host per wire — a CONSTRAINT, not a guarantee / Một host một sợi dây — RÀNG BUỘC, không phải bảo đảm

**EN** — Since E-5 both `St4i.EngineApi` and `St4i.EdgeService` have a configured path from their own
`connectors.json` to a real RS-485 segment (§24.5). **The deployment rule is that exactly one host owns a
given segment.** This section says who enforces it, and the answer on one of the two transports is *nobody*.

| Transport | Second host on the same segment | Who stops it | What the operator sees |
|---|---|---|---|
| **Direct serial (a COM port)** | the second open **fails** | the **operating system**, incidentally — a `SerialPort` opens exclusively | `SerialPortBusLink.DescribeOpenFailure`'s held-port arm, which names the sibling host **first** of three causes and now says the refusal was the OS's, not this product's |
| **RTU over a gateway** | **both connect, normally** | **nobody** | nothing — no error, no log line on the other side. So the constraint is stated at REGISTRATION time instead: `ModbusRtuBusSettings.DescribeSegmentOwnership`, logged once per bus by **both** hosts and returned in the `POST /v1/connectors` save response |

🔴 **Read the middle column literally. This product arbitrates nothing, on either transport.** Machine-code
claims are a `ConcurrentDictionary` inside one process; `ModbusBusRegistry`'s shared-link bookkeeping is
per-process too. On serial the safety is an **accident** of how Windows opens a COM port — real, but not
something this build arranges and not something it could extend to a gateway. **Nothing here detects, refuses
or recovers from two hosts on one wire.** A reader who takes the serial refusal for arbitration will never ask
the question the gateway needs asked.

🔴 **The consequence on a shared gateway — and the first version of this paragraph had it BACKWARDS.**
It said two uncoordinated frame sources "do not corrupt data", on the grounds that NModbus validates the slave
address and the function code. **This repository had already probed the opposite and written it down** in
`ModbusBus`'s own remarks (`src/St4i.EdgeCore/Drivers/Modbus/ModbusBus.cs`): a differing slave address, a
differing function code and a bad CRC **are** caught — but **a stale frame matching on all three is NOT caught
and is returned to the caller as the answer.** Measured, not reasoned: a request for register 99 came back
with register 0's stale value, silently, with no exception. An RTU response frame carries no transaction id,
so there is nothing left to check; and `IsDesynchronised` cannot rescue it either, because that flag is raised
when a transaction FAILS to consume a complete validated response and this one consumes a response it believes.

**Two masters on one segment reach that case whenever they address the same devices** — the ordinary
situation, since both hosts are configured for the same line; their frames then share the slave address and
the function code. 🔴 **It is not the only arrangement**, and an earlier version of this paragraph said it
was: two hosts splitting a segment by **disjoint unit ids** (host A on units 1-3, host B on unit 7) differ on
slave address, so for them the probe's *caught* branch applies and a stray frame really is refused. The
notice is unchanged because the remedy is the same for both — but on that split it over-warns, and that is
worth knowing rather than discovering. So a shared gateway **can** commit a **wrong register value as a real
reading**, which is what §20.3's entire data-provenance argument exists to prevent, and it can land **write
commands on `Indeterminate`** (§21.3).

**Both frequencies are UNMEASURED and stay that way.** Nobody has measured how often two masters produce a
matching stale frame, and nobody has measured the `Indeterminate` rate; there is no RS-485 adapter on any
machine here. The defect being corrected was an **unhedged reassurance sitting beside a hedged number**, which
invites a reader to take "your data is safe" as the settled half — so replacing it with a confident adjective
in the other direction would be the same mistake reversed. These are propositions; do not inherit either as a
figure.

🔴 **Per-host data roots (§15.9) do NOT solve this, and the two must not be conflated.** Separate roots stop
two hosts overwriting each other's *files*. Two hosts with two data directories can still name the same
gateway `host:port`, or the same `COM3`, and everything above applies unchanged.

🔴 **No machine-wide wire lock was built, and that is a decision.** A cross-process claim would need a shared
path — a named mutex, a lockfile, or a registration channel — which is precisely the shared surface §15.9 is
deliberately separating, and which §24.4 already prices as "a batch with a safety argument of its own". It is
the owner's call, not an oversight. The cheap non-solutions were considered and rejected for stated reasons: a
lockfile under a **per-host** root is invisible to the other host by construction, and a named mutex is a new
machine-wide shared object of exactly the kind this deployment shape exists to reduce.

**What an operator should actually do:** decide, per segment, which host owns it, and configure only that
host's `connectors.json` for it. On a gateway, that decision is the whole mechanism.

*(VI — **Đợt D để lại đúng một câu:** `St4i.EdgeService` chạy trên chính cái máy có cổng RS-485 mà không chủ
trì nổi một connector nào. Đợt E tách lõi vòng đời N-driver ra khỏi `St4i.EngineApi`, cho tác nhân biên một
lớp chủ trì connector của riêng nó, và — ở **E-5** — dời phần đăng ký multidrop xuống để cái cổng trên chính
cỗ máy ấy cuối cùng dùng được từ tiến trình đang chạy trên nó. Mục này nói host ấy giờ làm được gì, **cái gì vẫn chưa làm được**, và
trong hai loại đó cái nào là một QUYẾT ĐỊNH chứ không phải một khoảng trống. Đọc §24.4 trước khi chỉ cho
người vận hành một nút ghi trên cỗ máy do tác nhân biên lái.

**24.1 — Cái gì đã dời, và thứ tác nhân biên CỐ Ý không nhận.** Toàn bộ thân `FleetHost` — vòng đời N-driver,
roster, phân giải slot, sức khoẻ, khởi động lại, đường ghi, chốt an toàn và khoá của nó — đã sang
`St4i.EdgeCore.Fleet.FleetCore`, cùng `ConnectorRegistry`, `MachineState`, `SafetySnapshot`,
`DriverHealthSnapshot`, `MachineDriverAvailability`. `FleetHost` của `St4i.EngineApi` nay là một lớp vỏ mỏng
**không giữ khoá nào**; mọi DTO/phép chiếu, danh mục preset kịch bản và toàn bộ endpoint ở nguyên. 🔴
**`FleetCore` là `internal`, và toàn bộ câu chuyện chỉ-đọc nằm gọn trong một từ khoá ấy.** Tác nhân biên
**không** chạy cái lõi và về cấu trúc không gọi tên nổi nó: một file probe biên dịch vào chính assembly sản
phẩm `St4i.EdgeService` cho `error CS0122: 'FleetCore' is inaccessible due to its protection level`. Cái nó
chạy là `St4i.EdgeCore.Engine.EdgeAgentPipelines` — N driver, N pipeline, một transport, cô lập lỗi theo từng
pipeline, và **không thành viên nào nhận, trả hay phơi một `IDeviceDriver`**. Mười ba thành viên đột biến
trạng thái cộng một đường gián tiếp bị đóng bằng đúng một từ khoá chứ không bằng một danh sách tên, và **chính
con số đó cũng được kiểm** (`EdgeAgentWriteSurfaceTests`, chạy từ một assembly không có `InternalsVisibleTo`).
**Ranh giới trung thực của khẳng định ấy, ghi ra vì một bản mạnh hơn đã được viết trước và nó SAI:** phép
**tra cứu** `machineCode → driver` là `public` trên `ConnectorRegistry` và host này đang giữ một registry đã
nạp, nên một người đến sau có thể dựng một driver MỚI và ghi qua nó bằng vài dòng biên dịch được ngay hôm nay.
Thứ không với tới được hẹp hơn, và đó mới là phần quan trọng: hai thành viên ghi không hỏi chốt HALT, cùng
**bảng slot sống** ánh xạ một cỗ máy tới đúng driver mà một pipeline đang cầm. Đóng nốt phần còn lại là câu
chuyện của `ConnectorRegistry`, không phải của `FleetCore`.

**24.2 — `St4i.EdgeService` giờ chủ trì connector — Modbus TCP **và Modbus RTU** trên dây.** Nó đọc
`connectors.json` của chính nó (`--connectors <đường dẫn>`, mặc định là file cạnh exe) qua **cùng một bộ phân
tích** mà cả hai host dùng chung (`ConnectorsConfig`, đã dời sang `St4i.EdgeCore.Config` ở E-3 — một file, một
bộ đọc), và đăng ký **mỗi entry một thể hiện**, nên N entry nghĩa là N driver trên N pipeline. Một bản triển
khai không có `connectors.json` hành xử y hệt trước E-3 — cùng nhóm mô phỏng, cùng transport, cùng event bus —
và đó là tính chất của **MỘT đường mã với registry rỗng**, không phải của một nhánh không ai chạy. **Modbus
TCP — CÓ** (`ModbusConnectorFactory` nằm sẵn ở `St4i.EdgeCore`; một `ModbusTcpDriver` giữ một socket, không
giữ file toàn máy nào). 🔴 **Modbus RTU (entry có khai `transport`) — CHẠY ĐƯỢC, KỂ TỪ E-5**: một entry RTU là một
**TUYẾN**, và nó toả thành **N** thể hiện, mỗi thể hiện phục vụ đúng một máy. Trước E-5 host này từ chối nó,
vì phép toả với tới `RtuBusConfiguration.IsInBusNamespace` nằm ở `St4i.EngineApi` — assembly mà host này
không tham chiếu được. E-5 **DỜI** luật ấy (sang `ModbusMultidropMap`) và dời phép toả (sang
`St4i.EdgeCore.Config`), nên vẫn chỉ có **MỘT** phép toả và **một** câu trả lời cho câu hỏi "đăng ký nào sở
hữu thiết bị này"; cả hai host cùng gọi nó. Cả hai transport đều chạy: một đường COM và một gateway
RTU-trên-TCP. Ghim bởi `EdgeWorkerConnectorsTests.AnRtuBusEntry_FansOutIntoOneInstancePerDevice_…`, và ghim
đầu-cuối tại transport bởi `St4i.EdgeCore.Tests…ModbusMultidropAgentTests`. **OPC-UA — TỪ CHỐI
THEO TÊN**, và **không phải vì thiếu kiểu**: `OpcUaConnectorFactory` nằm ngay đó và biên dịch được. Cái chặn
là `OpcUaDriver` ghi chứng chỉ app-instance vào `%ProgramData%\ST4I\sim\opcua-pki` — **toàn máy, không khoá
theo tiến trình** — nên dispatch nó ở đây sẽ biến host này thành **một người ghi MỚI vào một store toàn máy**.
Cơ chế để tránh điều đó **đã có sẵn** (`OpcUaConnectorFactory` nhận `pkiDir`; `OpcUaPkiPaths.ResolveRoot` tôn
trọng `ST4I_OPCUA_PKI_DIR`). 🔴 **F-1 ĐÃ ĐÓNG ĐIỀU KIỆN CHẶN** — gốc dữ liệu theo host giờ là hình dạng
triển khai được hỗ trợ (§15.9) — **và lời từ chối VẪN ĐỨNG, vì cái còn lại là CÔNG VIỆC chứ không phải một
phán quyết**: host này chưa có `OpcUaOptions` riêng (endpoint, node map, gốc PKI), chưa có nhánh dispatch, và
chưa có test chứng minh hai host trỏ hai gốc giữ được hai kho chứng chỉ. Chỉ đặt `ST4I_OPCUA_PKI_DIR` thì
không bật được gì, và chính thông điệp từ chối nói vậy. Ghim bởi `AnOpcUaEntry_IsRefusedByName_…`. **Kind khác — TỪ CHỐI**, giống EngineApi: build này không
có plugin loader. **Lời từ chối OPC-UA là một QUYẾT ĐỊNH có test đi kèm, không phải chỗ sót** — đó là khác
biệt giữa một lời từ chối sống sót qua review và một lời từ chối bị ai đó "sửa" tháng sau bằng cách thêm một
nhánh `switch`. Lời từ chối RTU trước đây cũng đúng loại ấy, và **E-5 lật nó CÔNG KHAI**: bài test ghim nó
được viết lại có chủ đích, không phải để nó lặng lẽ đỏ rồi sửa cho xanh. 🔴 **Một chỗ lệch CÓ CHỦ ĐÍCH so với EngineApi, nói ra vì một chỗ lệch im lặng là một khiếm
khuyết:** ở đây mỗi entry đăng ký dưới **`id` của chính nó**, không dưới kind. EngineApi key theo kind vì lấy
id của operator sẽ dời nhãn slot — và do đó `TargetId` của cảnh báo — của một cài đặt đang chạy. **Host này
không có di sản đó**, và keying theo kind sẽ gộp mọi entry Modbus thành một, đúng thứ mà "N entry nghĩa là N
driver" phải loại trừ. 🔴 **E-4 viết ở đây rằng "hai quy tắc hội tụ miễn phí đúng ngày
`ModbusMultidropRegistration` xuống tới EdgeCore". Ngày đó là E-5, và chúng KHÔNG hội tụ — lời đoán ấy sai, và
phép liệt kê các lớp đầu vào giải quyết dứt điểm.** Hai quy tắc vốn ĐÃ khớp nhau với một tuyến RTU (cả hai key
theo id của operator), và E-5 biến nửa đó thành mã dùng chung chứ không còn là hai bản trùng nhau
(`ConnectorsConfig.IsRtuBus`). Chúng khác nhau ở đúng một lớp đầu vào — entry **TCP hoặc OPC-UA** — mà cuộc
dời phép toả không chạm tới. Và không chiều hội tụ nào khả dụng: EngineApi lấy id là đúng cuộc migration
`TargetId` mà nó đã từ chối hai lần và có test ghim; còn host này lấy kind sẽ gộp N entry Modbus **TCP** (N
socket, N máy) thành một — một năng lực mà tuyến RTU không thay thế được, vì một tuyến là N thiết bị trên
**MỘT** sợi dây, không phải N socket. Nên nó ở lại là một chỗ lệch có phát biểu và có test.

**24.3 — 🔴 RS-485 CHẠY ĐƯỢC Ở BIÊN — E-5, và nó thật sự dời những gì.** Đây từng là giới hạn lớn nhất mà
E-1…E-4 để lại, và nó chính là năng lực mà §1 của bản thiết kế nêu làm lý do tồn tại của cả đợt. Bốn nhiệm vụ
đánh số ấy đều đúng và đều cần, và **không cái nào từng được xếp lịch để dời phần đăng ký RTU** — một lỗi phân
rã, chỉ lộ ra khi E-3 va vào bức tường và **ĐO** khối lượng còn lại thay vì giả định. E-5 là phần việc đó.
**`ModbusMultidropMap.IsInBusNamespace`** — luật ấy rời `RtuBusConfiguration` (`St4i.EngineApi`) sang
`ModbusMultidropMap` (`St4i.EdgeCore`): **DỜI, KHÔNG NHÂN ĐÔI**, vẫn phát biểu đúng một lần và cả ba bên gọi
đều với tới; nó thuộc về đó vì hai ký hiệu mã hoá ĐỊNH DẠNG `{bus}:unit{n}` mà nó giải mã
(`DeviceIdSuffixPrefix`, `LooksLikeADeviceInstanceId`) khai báo trên chính kiểu ấy, ngay cạnh
`DeviceInstanceId` — thứ đúc ra định dạng đó. 🔴 **Review E-5 đã sửa một khẳng định phổ quát ở đây** —
*"mọi dữ kiện nó lập luận trên đều khai báo trên chính kiểu ấy"* — sai ở cả hai đầu: phụ thuộc thứ ba của
predicate, `DriverKinds.Normalize`, là của `St4i.Connector.Abstractions`, còn `DeviceInstanceId` mà danh
sách cũ nêu tên thì **không hề được gọi**. Thứ làm cho CUỘC DỜI an toàn là một sự kiện khác: ký hiệu thứ ba
nằm trong assembly hợp đồng mà mọi project ở đây vốn đã tham chiếu. **`ModbusMultidropRegistration`**
(344 dòng) sang `St4i.EdgeCore.Config`, dùng quy ước hai callback của EdgeCore. **`ModbusRtuBusPlan`**
(107 dòng) sang `St4i.EdgeCore.Serial` — assembly duy nhất nhìn thấy **cả hai** transport.
**`ConnectorConfigValidation`** (254 dòng) **KHÔNG dời, và không cần**: nó tồn tại để học mã máy mà blob cấu
hình mờ đục của một entry TCP khai báo, còn một tuyến thì không cần — phép toả đã phân tích từng thiết bị và
trả mã máy ra trực tiếp; ước lượng của E-3 có liệt kê nó, phép liệt kê thì loại nó ra.
**`RtuBusConfiguration`** **KHÔNG dời**, đúng như đã đo: nó còn ôm `TryFindBlockedDevice`/`ReleaseOwnNamespace`
và bám vào roster + store của EngineApi; chỉ có mỗi cái predicate rời đi. 🔴 **Cái giá, nói như một sự thật
vận hành chứ không phải một tính năng:** một cổng COM chỉ nhận **một** tiến trình. Nếu `St4i.EdgeService` giữ
COM3 thì `St4i.EngineApi` không mở được nó — các máy trên đường dây ấy thành chỉ-đọc từ phía engine (§24.4),
và hai host không có kênh nào để bên nào biết điều đó. Hai file `connectors.json` trên một máy cùng gọi tên
một cổng là một quyết định của người vận hành mà sản phẩm này không phân xử; còn trên **gateway** RTU thì đến
cả sự từ chối của hệ điều hành cũng không có để mà phân xử.

**24.4 — 🔴 Máy do tác nhân biên lái là CHỈ ĐỌC từ engine này — và engine này KHÔNG nhìn thấy được điều đó.**
Hai sự thật, và việc gộp chúng làm một chính là thứ khiến các thông điệp của nút ghi sai suốt hai đợt. (1)
**Không có đường xuống.** `ITransport` chỉ có chiều lên (`SendAsync`/`HeartbeatAsync`/`SyncConfigAsync`, cả ba
client→server), nên không lệnh ghi nào đi tới được tác nhân biên. Cộng thêm việc hệ điều hành mở `SerialPort`
độc quyền: một thiết bị mà tác nhân biên giữ trên cổng COM là thiết bị engine này không với tới được kể cả khi
muốn. Từ E-3, giới hạn ấy là **cấu trúc** — `FleetCore` là `internal` — chứ không còn là một câu trong tài
liệu. (2) **Engine này không PHÁT HIỆN được tình huống đó.** Tác nhân biên đẩy số liệu **hướng lên nền tảng**
(`ST4I_SERVER_URL`, mặc định `http://localhost:5000`) và không bao giờ gọi engine này — thứ lắng nghe ở
`:5199` và **không phục vụ route ingest nào cả**. Hai host không chung roster, không chung sổ chiếm mã máy,
không chung kênh nào. **Ở đây không bao giờ có gì học được rằng một tác nhân biên tồn tại**, chứ chưa nói tới
việc nó cầm những máy nào. **Vì thế thông điệp cho người vận hành NÊU TÊN đường sinh ấy thay vì tuyên bố phát
hiện được nó** — và đó mới là dạng trung thực. E-4 viết lại **cả bốn**. Lớp lỗi chung là thứ dự án này liên
tục gặp — **một chuỗi hướng-người-vận-hành phủ nhiều đường sinh và chỉ đúng với vài đường** — nhưng phải nói
**theo từng chuỗi** chứ không phải như một tính chất cả bốn cùng có, vì chúng không cùng mắc một lỗi:
**`404`** trước viết *machine "X" not found* — **đúng theo nghĩa đen, và vô ích**: nó nêu lỗi gõ hoặc máy chưa
onboard, trong khi một máy do tác nhân biên cầm là máy THẬT, đang chạy, và đã được cấu hình đúng **ở nơi
khác** — và vì nó không bao giờ xuất hiện trong roster này, chính cái 404 ấy mới là thứ ĐẦU TIÊN người vận
hành gặp. (Bản của relay cho cùng ca này mới là bản có lỗi thật, và lỗi nằm ở **LỜI KHUYÊN**: *"kiểm tra lại
mã, hoặc onboard cỗ máy"* — onboard một cỗ máy tác nhân biên đang lái sẽ tạo ra đúng bản sao roster làm cho
bức tranh nhà máy của engine này thành sai.) **`409 NO_LIVE_DRIVER`** trước là **một phép tuyển KHÔNG vét
cạn** — chỉ nhánh thứ ba mặc định có connector, và **không nhánh nào** phủ trường hợp máy **không có connector
nào ở đây**; lỗi sắc hơn nằm ở lời khuyên "rồi
thử lại" không bao giờ đúng được — nước đi hiển nhiên mà nó gợi ra (cấu hình một connector ở đây) đặt **một
tiến trình thứ hai lên một thiết bị đã có tiến trình khác lái**; **`409 READ_ONLY`** — **cái DUY NHẤT thật sự
mặc định rằng có connector** — trước viết *connector này không khai điểm ghi được nào*, trong khi nguồn sinh
phổ biến nhất của nó là một cỗ máy do **nhóm mô phỏng có sẵn** lái, thứ không có connector nào cả; còn
**`409 AMBIGUOUS_DRIVER`** thì **đúng** (một đường sinh, một chuỗi đúng) và chỉ được viết lại về câu chữ. Bản
thay thế nằm ở **MỘT** chỗ,
`MachineWriteGate.ExplainUnavailable`, vì có **HAI** bề mặt cùng hiển thị chuyện này và chúng đã trôi khỏi
nhau: thân phản hồi HTTP mà web UI hiện nguyên văn, và cảnh báo người vận hành đọc khi **đèn báo không sáng**
(`RelayNotificationChannel`). 🔴 **Hai điều CHƯA xong về bản thay thế, nói ra thay vì để người khác phát
hiện:** chúng **dài** — đo với một mã máy 13 ký tự: 526 / **827** / 661 / 269 ký tự cho
`MACHINE_NOT_FOUND` / `NO_LIVE_DRIVER` / `READ_ONLY` / `AMBIGUOUS_DRIVER`, và hiện không xuống dòng trong
banner của tab điều khiển — và **chỉ có tiếng Anh**, giống toàn bộ bề mặt lỗi HTTP của sản phẩm này. Đúng đắn được ưu tiên hơn
ngắn gọn một cách có chủ ý — chính một chuỗi ngắn đã sinh ra khiếm khuyết này — nhưng "đúng, mà khó đọc ngay
chỗ gặp nó" thì chưa phải là xong. Rút ngắn nghĩa là hoặc bỏ một đường sinh (không), hoặc cho banner một cơ
chế mở rộng dần (một thay đổi UI); dịch nghĩa là một quyết định i18n mà sản phẩm này chưa từng ra cho lỗi API.
Cả hai là hạng mục còn mở, không phải chỗ sót. **Cần gì để thật sự phân biệt "chưa cấu hình connector" với "do tác nhân biên
cầm"** — hỏi và trả lời hẳn thay vì để lửng: tác nhân biên sẽ phải ĐĂNG KÝ với engine này, tức là cần một
quyền chiếm mã máy XUYÊN TIẾN TRÌNH. Hôm nay quyền chiếm ấy là một `ConcurrentDictionary` **trong một tiến
trình** — không mutex, không lockfile, không primitive có tên — và bảo vệ duy nhất tồn tại giữa các tiến trình
là việc hệ điều hành từ chối lần mở thứ hai của một **cổng COM**; qua **gateway TCP** thì cả hai tiến trình
đều kết nối bình thường và không ai từ chối. Cho engine biết điều đó vì thế đồng nghĩa với việc xây luôn quyền
chiếm xuyên tiến trình — một đợt việc có lập luận an toàn riêng, không phải một trường trong một DTO.

**24.5 — 🔴 "Chỉ `St4i.EngineApi` mở được cổng COM" là khẳng định về CẤU HÌNH, không phải về KHẢ NĂNG.** Ghi ở
đây vì §23.6 đã nói câu đó và §20.5 nhắc lại nó lần nữa, mà một khẳng định chỉ được sửa ở nơi nó được *xếp
vào* là một khẳng định vẫn đang phát hành ở mọi nơi nó được *nhắc lại*. Cả ba host đều `ProjectReference`
`St4i.EdgeCore.Serial`, đều mang `System.IO.Ports.dll`, và đều **mở được** một cổng COM:
`SerialPortBusLink.OpenAsync` và `SerialLineSettings` đều `public`. Đo bằng hai dụng cụ chứ không phải đọc —
một probe biên dịch vào assembly sản phẩm `St4i.EdgeService` build ra **0 lỗi**, và
`EdgeServiceSerialReachabilityTests` thực sự mở một cổng từ đồ thị tham chiếu của chính host ấy rồi bị **hệ
điều hành** từ chối. Thứ khác nhau giữa ba host là **CẤU HÌNH**: chỉ `St4i.EngineApi` có một đường đã cấu hình
từ `connectors.json` tới một lệnh mở serial; `St4i.EdgeService` từ chối entry RTU theo tên (§24.2), còn vỏ WPF
không có registry connector nào cả. 🔴 **E-5 đã đổi nửa CẤU HÌNH, và câu trên được sửa chứ không xoá vì nó là
bản ghi của những gì đúng cho tới E-4:** kể từ E-5, **HAI** trong ba host có đường đã cấu hình từ
`connectors.json` tới một lệnh mở serial — `St4i.EngineApi` và `St4i.EdgeService`; chỉ vỏ WPF là không. Nửa
KHẢ NĂNG chưa bao giờ là thứ phân biệt và giờ vẫn không. Phân biệt này chịu lực chứ không phải bắt bẻ: bảo vệ của §2 cho một đường
cắm thẳng **CHÍNH LÀ** việc hệ điều hành từ chối lần mở thứ hai, nên người đọc tin rằng host này "không thể"
mở cổng sẽ không bao giờ hỏi tiến trình nào đang giữ COM3 — và trên một **gateway** thì không có bảo vệ nào
như thế để mà lý luận.

**24.6 — Vẫn đúng sau Đợt E, không đổi.** **Chưa có khung Modbus nào đi qua một cổng serial thật** — đúng sau
Đợt D, đúng sau E-2, E-3, E-4, và **vẫn đúng sau E-5**, thứ chỉ làm cái cổng ấy với tới được bằng cấu hình chứ
không chạm vào sự thật này. Mọi test RTU trong kho mã này chạy trên giàn in-memory ghép đôi của D-2 (một mạng
slave NModbus thật trong tiến trình: CRC thật, khung t3.5 thật, phân phát theo địa chỉ slave thật, phân xử
thật trên một link dùng chung — nhưng không có đồng), hoặc nhắm vào một cổng loopback ĐÓNG mà lệnh connect
bị từ chối — một connect bị từ chối không phải là một socket. Không có adapter RS-485
nào trên bất kỳ máy build nào, và chỉ adapter điều khiển hướng **tự động** mới được hỗ trợ. Bước nghiệm thu
trên bàn với phần cứng thật vẫn còn đó, và đó là một BƯỚC chứ không phải thủ tục. **Hai tiến trình vẫn dùng chung một bộ file dữ liệu toàn máy _theo mặc định_** —
`AssetRegistryStore`/`CredentialStore`/`FleetSettingsStore` đều nằm dưới `%ProgramData%\ST4I\sim\…`, không
khoá theo tiến trình; tác nhân biên hôm nay không chạm sổ tài sản lẫn store cài đặt (người ghi có sẵn duy nhất
của nó là hàng đợi WAL), nên không có gì thụt lùi — **và E-5 cũng không đổi điều đó: một tuyến RS-485 mở một
cổng COM còn một tuyến gateway mở một socket; không cái nào là store, và sổ sách chia sẻ lần mở là một
dictionary trong tiến trình do host sở hữu.** **Máy của một connector đã xoá vẫn nằm trong roster tới khi khởi
động lại** (§23.5), không đổi. 🔴 **F-1 đổi phần "mặc định" ấy: gốc dữ liệu theo host giờ là hình dạng triển
khai ĐƯỢC HỖ TRỢ (§15.9)** — cả **mười tám** thư mục **toàn máy** dưới `%ProgramData%` đều dời chỗ được bằng
một biến `ST4I_*_DIR` suy ra được (📎 🔴 **RÚT 2026-08-30 (review toàn nhánh WS-HMI-0a, Important 1), giữ
nguyên văn:** chỗ này đọc *"cả **mười sáu** thư mục **toàn máy**"*, trong khi nửa TIẾNG ANH của đúng câu này
đã được WS-HMI-0a Task 5 sửa thành **eighteen** cùng với **nineteenth** ở mệnh đề sau. Hai nửa của một câu
song ngữ mâu thuẫn nhau từ 2026-08-30 tới khi vòng sửa sau review bắt được; xem `task-5-report.md` để biết
chỗ đính chính lời khai *"all in **both languages**"* của task ấy. Từ nay
`PerHostDataRootsTests.TheNumberOfMachineWideDirectories_…` đọc **cả hai** nửa của câu này, nên chúng không
lệch nhau lặng lẽ được nữa. 📎 **RÚT 2026-08-23 (BF-1), giữ nguyên văn:** chỗ này đọc *"cả mười ba thư
mục"* và *"🔴 H-1c thêm chữ 'toàn máy': sản phẩm còn ba store ghi **cạnh binary**, ở đó sự cô lập giữa hai
host là **tình cờ** — đọc mục quần thể thứ hai của §15.9 trước khi lên kế hoạch một máy hai host"*. Chủ sở
hữu chuyển cả ba store ấy xuống `%ProgramData%` ngày 2026-08-23, nên **mười ba thành mười sáu** và quần thể
cạnh-binary **RỖNG**; hai host trên một máy nay dùng chung ba file ấy **theo mặc định** giống hệt mười ba cái
kia, và cách tách vẫn là cho mỗi host một gốc riêng), và
một test suy ra cả hai tập từ `src/` nên store **toàn máy** thứ **mười chín** không thể ra đời mà thiếu biến
(🔴 **MƯỜI BẢY → MƯỜI CHÍN, 2026-08-30**, cùng finding: mệnh đề này đọc *"store **toàn máy** thứ mười bảy"*,
là số thứ tự đi kèm con số mười sáu ở đầu câu; nửa tiếng Anh đã nói **nineteenth** từ Task 5) — còn
một store cạnh-binary thì **không còn cái nào**, và phép ghim của quần thể ấy nay ghim đúng số không. Cái F-1 **không**
làm là đặt chúng thay bạn: không đặt gì thì vẫn là một bộ file dùng chung, và đổi gốc thì **không có gì được
di trú**. **Do đó quyết định đang chặn OPC-UA ở biên đã ĐÓNG** — xem §24.2, phần còn lại là công việc kỹ
thuật chứ không phải một phán quyết.

**24.7 — 🔴 Một host một sợi dây: RÀNG BUỘC, không phải bảo đảm.** Từ E-5, cả `St4i.EngineApi` lẫn
`St4i.EdgeService` đều có đường đã cấu hình từ `connectors.json` của chính nó tới một segment RS-485 thật
(§24.5). **Luật triển khai là đúng một host sở hữu một segment.** Ai thi hành nó? Trên **serial cắm thẳng**:
lần mở thứ hai **hỏng**, và bên từ chối là **hệ điều hành** — một cổng COM mở ĐỘC QUYỀN; người vận hành gặp
nhánh cổng-bị-giữ của `SerialPortBusLink.DescribeOpenFailure`, nhánh này nêu host anh em **đầu tiên** trong ba
nguyên nhân và giờ nói rõ rằng lần từ chối ấy là của HỆ ĐIỀU HÀNH, không phải của sản phẩm này. Trên **gateway
RTU**: cả hai **kết nối bình thường**, **không ai** chặn, và **không có gì để nhìn** — không lỗi, không dòng
log nào ở phía bên kia. Nên trên gateway ràng buộc được phát biểu lúc ĐĂNG KÝ:
`ModbusRtuBusSettings.DescribeSegmentOwnership`, ghi một lần mỗi bus bởi **cả hai** host và trả kèm trong phản
hồi `POST /v1/connectors`. 🔴 **Đọc đúng nghĩa đen: sản phẩm này KHÔNG phân xử gì cả, trên cả hai transport.**
Yêu sách mã máy là một `ConcurrentDictionary` trong một tiến trình; sổ sách link dùng chung của
`ModbusBusRegistry` cũng trong tiến trình. Trên serial, sự an toàn là một **tai nạn** của cách Windows mở cổng
COM — có thật, nhưng không do bản build này sắp đặt và không thể mở rộng sang gateway. **Không có gì ở đây
phát hiện, từ chối hay khôi phục được tình huống hai host trên một dây.** 🔴 **Hệ quả trên gateway dùng chung — và bản đầu của đoạn này nói NGƯỢC:**
nó viết rằng hai nguồn khung tin không phối hợp "KHÔNG làm hỏng dữ liệu" vì NModbus kiểm địa chỉ slave và mã
hàm. **Kho mã này đã ĐO điều ngược lại và ghi sẵn ba file cách đó** (chú thích của chính `ModbusBus`): khung
lạc **khác** địa chỉ slave, **khác** mã hàm, hoặc **sai** CRC thì BỊ BẮT — nhưng **một khung cũ trùng cả ba
thì KHÔNG bị bắt và được trả về cho bên gọi NHƯ THỂ LÀ CÂU TRẢ LỜI.** Đo trực tiếp: một yêu cầu thanh ghi 99
nhận về giá trị cũ của thanh ghi 0, lặng lẽ, không ngoại lệ nào. Khung RTU không mang transaction id nên không
còn gì để kiểm; và `IsDesynchronised` cũng không cứu được, vì cờ ấy chỉ bật khi một giao dịch **KHÔNG** tiêu
thụ nổi một phản hồi hợp lệ trọn vẹn, còn ở đây giao dịch tiêu thụ một phản hồi mà nó tin. **Hai master trên
một segment rơi vào trường hợp đó **mỗi khi chúng cùng nhắm một thiết bị** — tình huống thông thường, vì cả
hai host đều được cấu hình cho cùng một đường dây; khi ấy khung tin của chúng trùng địa chỉ slave và trùng mã
hàm. 🔴 **Đó không phải cách bố trí DUY NHẤT**, và bản trước của đoạn này nói như thể vậy: hai host chia
segment theo **unit id RỜI NHAU** (host A giữ unit 1-3, host B giữ unit 7) thì **khác** địa chỉ slave, nên với
chúng nhánh BỊ BẮT của phép đo mới đúng và khung lạc thật sự bị từ chối. Thông điệp giữ nguyên vì cách xử lý
là một cho cả hai — nhưng trên kiểu chia ấy nó **cảnh báo quá tay**, và biết trước điều đó tốt hơn là tự phát
hiện ra. Nên
một gateway dùng chung có thể ghi nhận **một GIÁ TRỊ THANH GHI SAI như một số đo thật** — đúng thứ toàn bộ lập
luận nguồn-gốc-dữ-liệu ở §20.3 tồn tại để ngăn — và làm **lệnh ghi rơi vào `Indeterminate`** (§21.3). **Cả hai
tần suất đều CHƯA ĐO và vẫn để nguyên như vậy:** không ai đo tần suất hai master sinh ra một khung cũ trùng
khớp, cũng không ai đo tần suất `Indeterminate`; không có adapter RS-485 trên máy nào ở đây. Lỗi đang được sửa
là **một lời trấn an KHÔNG rào đứng cạnh một con số CÓ rào**, khiến người đọc coi "dữ liệu của bạn an toàn" là
phần đã chốt — nên thay nó bằng một tính từ chắc nịch theo chiều ngược lại là đúng cái sai ấy lộn ngược. Đây
là các mệnh đề; đừng thừa kế cái nào như một con số. 🔴 **Gốc dữ liệu theo host (§15.9) KHÔNG giải quyết chuyện này** — gốc riêng ngăn hai host ghi đè
*file* của nhau; hai host với hai thư mục vẫn trỏ chung một `host:port` gateway hoặc chung một `COM3` được. 🔴
**KHÔNG xây khoá chiếm-dây toàn máy, và đó là một quyết định:** một yêu sách xuyên tiến trình cần một đường
dùng chung — mutex có tên, lockfile, hoặc một kênh đăng ký — mà đó đúng là bề mặt chung §15.9 đang cố ý tách
ra, và §24.4 đã định giá nó là "một đợt việc có lập luận an toàn riêng". Đó là phán quyết của chủ sở hữu, không
phải một chỗ sót. Hai phương án rẻ đã cân nhắc và bị loại kèm lý do: một lockfile nằm dưới gốc **theo host**
thì về cấu trúc host kia không nhìn thấy, còn một mutex có tên là một đối tượng dùng chung toàn máy MỚI, đúng
loại thứ mà hình dạng triển khai này tồn tại để giảm bớt. **Việc người vận hành thật sự phải làm:** với mỗi
segment, chọn một host sở hữu nó, và chỉ cấu hình `connectors.json` của host đó cho segment ấy. Trên gateway,
quyết định ấy CHÍNH LÀ toàn bộ cơ chế.)*

---

## 25. `contracts/` — the frozen HMI schema contract (WS-HMI Mốc 0) / Hợp đồng schema HMI đã đóng băng

**EN** — `contracts/` (`.superpowers/sdd/2026-08-29-hmi-moc0-schema-freeze-blueprint/`,
`docs/HMI_BUILDER_DESIGN_2026-08-29.md` §4) holds three JSON Schemas — `tag-namespace.schema.json`,
`component-model.schema.json`, `hmi-screen.schema.json` — frozen so a future .NET "Tag Spine" branch
and a future web "HMI Runtime/Editor" branch can be built **in parallel** without drifting apart. **Read
this section as a warning before a feature list: Milestone 0 shipped no runtime, no editor, no driver,
and nothing a user can see.** It is a contract between two branches that do not exist yet, proven by a
corpus of fixtures and two independent pin-test suites, and nothing more.

**What is actually there:** the three schemas; a shared fixture corpus under `contracts/fixtures/`
(5 `valid/` + 6 `invalid/`, one `invalid/` file per named rule, its filename stating the rule it
violates); a **zero-dependency** contract assembly `src/St4i.Hmi.Contracts` (net10.0, no
`PackageReference`, same discipline as `St4i.Connector.Abstractions` in §19.1) with hand-written C#
records; hand-written TypeScript types under `web/src/contracts/`; and a two-way pin test suite on
**each** side (`tests/St4i.Hmi.Contracts.Tests`, `web/contract-tests/`) asserting the schema and the
type declare the exact same property names in both directions. `node scripts/check-contracts.mjs` runs
both suites from one command and prints one verdict — this is the command every WS-HMI-0/1/2 task runs
before reporting done, and it is proven to catch drift, not just to exist: adding one property to any of
the three schemas and running the gate turns **both** sides red, naming the missing property on each
side; reverting turns both green again (see `contracts/README.md` for the freeze rules this checks).

**The freeze rules, in one place** (full text in `contracts/README.md`): additive-only changes (removing
a property, renaming, retyping, or tightening a constraint requires bumping `schemaVersion` and keeping
an old-version read path); a change touches all **four** places — schema, fixture, C# record, TS
type — **in the same commit**, because the two-way pin tests are what catches a partial edit; a fixture
is part of the contract, not an example, so adding a property means adding/editing a `valid/` fixture
that uses it and adding a constraint means adding an `invalid/` fixture that violates exactly that
constraint; and the unresolvable `https://st4i.local/...` `$id` is deliberate — this product is
absolute-offline and nothing here is permitted to fetch a schema over the network.

**What became mechanically impossible rather than merely documented.** §5's "no unpoliced write" rule is
now encoded IN the schema, not just in prose: a tag with `"access": "rw"` and no `policyAction`, and an
`hmi-screen` widget of kind `setpoint-input` or `command-button` with no `policyAction`, are both refused
by `additionalProperties`/conditional (`if`/`then`) schema keywords —
`contracts/fixtures/invalid/tags-rw-without-policy-action.json` and
`contracts/fixtures/invalid/screen-write-widget-without-policy-action.json` exist to prove the refusal is
real, not asserted.

**What Milestone 0 deliberately did NOT do, stated as plainly as what it did.** No code generation: the
original design doc (`HMI_BUILDER_DESIGN_2026-08-29.md` §4, clause 2) called for generating C#/TypeScript
types from the schema; what shipped is hand-written types on both sides, pinned by two-way tests instead
— a departure recorded, not silently taken, in a freeze note directly under §4's table. The web-side
validator (`web/contract-tests/validate.mjs`) is a **hand-written partial** JSON Schema implementation
covering only the keywords these three schemas actually use — `type`, `enum`, `const`, `required`,
`properties`, `additionalProperties` (`false` or a single schema), `items` (schema form), `allOf`,
`oneOf`, `if`/`then`, `pattern`, `minLength`, `minimum`/`maximum`, `$ref` into `$defs`, plus the
annotation-only `$schema`/`$id`/`$defs`/`title`/`$comment` — and it **throws** on any keyword it does not
recognize rather than skipping it silently, so a future schema author who reaches for an unsupported
keyword gets a loud failure instead of a validator that quietly stops checking. It is not a
general-purpose JSON Schema engine and must never be read as one.

Two corrections to that sentence, both from a later review round, kept here rather than quietly folded in.
**(a) The list above previously omitted `allOf` and `items`** — both implemented, both used by all three
schemas; a "supported keywords" list that omits what is supported is the same class of untruth as a
validator that skips what it does not support. **(b) "Recognizes a keyword" now means recognizes it *in
the position the validator actually reads it*,** which is the stronger and more important claim. The
original guard accepted `if`/`then`/`items`/`$ref` **anywhere**, while the validator honours `if`/`then`
only as direct members of an `allOf` element, `items` only in schema form, and returns from `$ref` before
reading siblings. So `if`/`then` written directly on a node — legal JSON Schema, enforced by any real
validator, and the most natural way for anyone to add a third conditional to `$defs/widget` — was accepted
by the guard and silently ignored by the validator: an unpoliced `command-button` passed clean. Five such
positions (bare `if`/`then`; `then` with no sibling `if`; `$ref` with siblings; tuple-form `items`;
array-form `additionalProperties`) are now **rejected rather than implemented** — that matches the file's
posture, and each of the five is pinned by a test that has been watched to fire.

*(VI: `contracts/` (`.superpowers/sdd/2026-08-29-hmi-moc0-schema-freeze-blueprint/`,
`docs/HMI_BUILDER_DESIGN_2026-08-29.md` §4) chứa ba JSON Schema — `tag-namespace.schema.json`,
`component-model.schema.json`, `hmi-screen.schema.json` — được đóng băng để một nhánh .NET "Tag Spine"
và một nhánh web "HMI Runtime/Editor" trong tương lai xây được **song song** mà không lệch nhau. **Đọc
mục này như một lời cảnh báo trước khi đọc như một danh sách tính năng: Mốc 0 KHÔNG giao runtime, KHÔNG
giao editor, KHÔNG giao driver, và không có gì người dùng nhìn thấy được.** Đây là hợp đồng giữa hai
nhánh chưa tồn tại, được chứng minh bằng một bộ fixture và hai bộ test ghim độc lập, không hơn.

**Thực tế có gì:** ba schema; bộ fixture dùng chung dưới `contracts/fixtures/` (5 `valid/` + 6
`invalid/`, mỗi file `invalid/` ứng với đúng một luật, tên file nêu rõ luật bị vi phạm); một contract
assembly **ZERO dependency** `src/St4i.Hmi.Contracts` (net10.0, không `PackageReference`, cùng kỷ luật
với `St4i.Connector.Abstractions` ở §19.1) với record C# viết tay; type TypeScript viết tay dưới
`web/src/contracts/`; và một bộ test ghim hai chiều ở **MỖI** phía (`tests/St4i.Hmi.Contracts.Tests`,
`web/contract-tests/`) khẳng định schema và kiểu khai đúng cùng một tập tên property theo cả hai chiều.
`node scripts/check-contracts.mjs` chạy cả hai bộ từ một lệnh và in một kết luận — đây là lệnh mọi task
của WS-HMI-0/1/2 chạy trước khi báo xong, và nó đã được CHỨNG MINH bắt được drift chứ không chỉ tồn tại:
thêm một property vào bất kỳ schema nào trong ba file rồi chạy cổng làm **CẢ HAI** phía đỏ, nêu đúng tên
property thiếu ở mỗi phía; hoàn nguyên thì cả hai xanh lại (xem `contracts/README.md` để biết luật đóng
băng cổng này kiểm).

**Luật đóng băng, gom một chỗ** (toàn văn ở `contracts/README.md`): chỉ được cộng thêm (xoá property, đổi
tên, đổi kiểu, hay siết ràng buộc phải tăng `schemaVersion` và giữ đường đọc bản cũ); một lần đổi phải
chạm cả **bốn** chỗ — schema, fixture, record C#, type TS — **trong cùng một commit**, vì test ghim hai
chiều tồn tại chính để bắt một lần sửa nửa vời; fixture là một phần của hợp đồng chứ không phải ví dụ,
nên thêm property nghĩa là thêm/sửa một fixture `valid/` dùng nó và thêm ràng buộc nghĩa là thêm một
fixture `invalid/` vi phạm đúng ràng buộc đó; và `$id` `https://st4i.local/...` không phân giải được là
cố ý — sản phẩm này chạy offline tuyệt đối, không có gì ở đây được phép fetch một schema qua mạng.

**Cái gì trở thành KHÔNG THỂ VIẾT SAI bằng máy, chứ không chỉ được ghi bằng văn xuôi.** Luật "không có
đường ghi không gác" ở §5 nay được mã hoá TRONG schema: một tag `"access": "rw"` không có `policyAction`,
và một widget `hmi-screen` loại `setpoint-input` hay `command-button` không có `policyAction`, đều bị từ
chối bởi từ khoá `additionalProperties`/điều kiện (`if`/`then`) của schema —
`contracts/fixtures/invalid/tags-rw-without-policy-action.json` và
`contracts/fixtures/invalid/screen-write-widget-without-policy-action.json` tồn tại để chứng minh sự từ
chối đó là thật, không phải khẳng định suông.

**Cái Mốc 0 CỐ Ý KHÔNG làm, nói rõ như cái đã làm.** Không sinh mã: tài liệu thiết kế gốc
(`HMI_BUILDER_DESIGN_2026-08-29.md` §4, khoản 2) từng đề nghị sinh kiểu C#/TypeScript từ schema; cái thật
sự giao là kiểu viết tay ở cả hai phía, ghim bằng test hai chiều thay vì sinh mã — một sai lệch được ghi
lại, không lặng lẽ áp dụng, trong một khối ghi chú đóng băng ngay dưới bảng của §4. Bộ validate phía web
(`web/contract-tests/validate.mjs`) là một bản triển khai JSON Schema **viết tay, một phần**, chỉ phủ
đúng những từ khoá ba schema này thật sự dùng — `type`, `enum`, `const`, `required`, `properties`,
`additionalProperties` (`false` hoặc MỘT schema), `items` (dạng schema), `allOf`, `oneOf`, `if`/`then`,
`pattern`, `minLength`, `minimum`/`maximum`, `$ref` vào `$defs`, cộng nhóm chú thích
`$schema`/`$id`/`$defs`/`title`/`$comment` — và nó **ném lỗi** khi gặp từ khoá không nhận ra thay vì bỏ
qua âm thầm, để người viết schema sau này gặp một lỗi to tiếng thay vì một bộ validate lặng lẽ ngừng
kiểm. Nó không phải một engine JSON Schema tổng quát và không bao giờ nên được đọc như vậy.

Hai đính chính cho câu trên, đều từ một đợt review sau, để lại đây thay vì gộp vào âm thầm. **(a) Danh
sách trên trước đây THIẾU `allOf` và `items`** — cả hai đều đã thi hành, cả ba schema đều dùng; một danh
sách "từ khoá được hỗ trợ" mà bỏ sót thứ đang được hỗ trợ là cùng lớp nói-không-đúng với một bộ validate
bỏ qua thứ nó không hỗ trợ. **(b) "Nhận ra một từ khoá" nay nghĩa là nhận ra nó Ở ĐÚNG VỊ TRÍ mà bộ
validate thật sự đọc** — đây mới là khẳng định mạnh và quan trọng. Guard cũ nhận `if`/`then`/`items`/`$ref`
ở BẤT CỨ ĐÂU, trong khi bộ validate chỉ đọc `if`/`then` khi chúng là thành viên trực tiếp của một phần tử
`allOf`, chỉ đọc `items` dạng schema, và return ngay sau khi phân giải `$ref` nên bỏ mọi anh em kế bên. Vì
vậy `if`/`then` đặt thẳng trên một nút — hợp lệ theo JSON Schema, được mọi bộ validate thật thi hành, và
là cách TỰ NHIÊN NHẤT để ai đó thêm điều kiện thứ ba vào `$defs/widget` — được guard chấp nhận rồi bị bộ
validate bỏ qua trong im lặng: một `command-button` không có `policyAction` đi lọt sạch. Năm vị trí như
vậy (`if`/`then` trần; `then` không có `if` anh em; `$ref` có anh em; `items` dạng tuple;
`additionalProperties` dạng mảng) nay bị **TỪ CHỐI thay vì được thi hành** — đúng posture của file ấy — và
mỗi vị trí có một bài test đã được nhìn thấy bắn.)*
