# Doc 62 — ST4I Machine Simulator Studio → Edge Middleware (Design Spec)

> **Thiết kế đã duyệt** cho một sản phẩm **C# WPF (.NET 8)** mô phỏng TOÀN BỘ máy nội bộ
> kết nối hệ thống ST4I qua API — cấp độ **triển lãm** — được kiến trúc để **tiến hoá thành
> edge middleware / gateway** cho hệ sinh thái (đọc thiết bị tự động hoá thật, chuẩn hoá,
> đẩy lên nền tảng).
>
> Ngày: 2026-07-18 · Nối tiếp doc 61 (Machine Developer Integration Guide — contract đã kiểm
> chứng live) · doc 57 (Standard Process Feed v1) · doc 28 (Standard Inspection Feed v1) ·
> doc 56 (Device Connectivity Standardization). SDK phía Bắc tái dùng: `examples/device-client/csharp/St4iDeviceClient.cs`.
>
> Trạng thái: **APPROVED (brainstorming) → chờ writing-plans**. Quy ước brainstorming: spec này
> là đầu vào cho kế hoạch triển khai chi tiết.

---

## 1. Mục tiêu & bối cảnh

### 1.1 Vấn đề
Hệ thống ST4I AVI/AOI Management đã có contract má↔server **đã kiểm chứng live** (doc 61) và SDK
C# (`St4iDeviceClient.cs`). Còn thiếu một **ứng dụng cầm-tay để trình diễn** rằng "mọi máy nội bộ
đều kết nối được vào hệ thống, đầy đủ các bước và chức năng" — đủ đẹp và tin cậy để **mang đi
triển lãm**, chạy được **ngay cả khi không có server/mạng** tại gian hàng.

### 1.2 Tầm nhìn (do người dùng chốt)
Sản phẩm KHÔNG dừng ở mô phỏng. Nó được kiến trúc để **sau này trở thành phần mềm trung gian
(edge middleware / gateway)** của hệ sinh thái: đọc **thiết bị tự động hoá thật** (PLC, súng vít,
máy AOI, cảm biến…), **chuẩn hoá** về ST4I Standard Feed, và **đẩy lên** nền tảng qua chính SDK đã
proven — với độ bền store-and-forward. Mô phỏng chỉ là **một driver phía Nam** trong pipeline này.

### 1.3 Nguyên tắc thiết kế chủ đạo
- **Trừu tượng hai đầu**: phía Nam `IDeviceDriver` (nguồn dữ liệu) ↔ phía Bắc `ITransport` (đích
  gửi). Giữa là **Normalizer/Mapping** (trái tim middleware). UI chỉ quan sát, không chứa logic.
- **Core tách khỏi UI**: mọi logic ở `St4i.EdgeCore` (class lib) để **WPF app và Windows Service
  headless dùng chung**, không viết lại khi lên production.
- **Một nguồn sự thật cho contract**: link (không copy) `St4iDeviceClient.cs`; mở rộng additive.
- **Luôn đẹp khi demo**: transport dual-mode Live/Demo/Auto — mất server tự rơi về Demo.
- **Bám contract đã kiểm chứng** (doc 61 §4.8 các điểm lệch): `stationId` là SỐ, replay dùng
  `duplicate`, `metrics[].value` chỉ number, `ts` có offset, lỗi payload gộp `400 ingest_failed`.

---

## 2. Phạm vi

### 2.1 TRONG phạm vi lần build này (P1)
1. **Simulator triển lãm** cho 4 lớp máy (§5): automation lõi (vít/keo/hàn), automation mở rộng
   (ép/leak/functional), IoT (ESP32 telemetry), AOI/AVI (inspection).
2. **EdgeCore pipeline**: `IDeviceDriver` → `Normalizer` → `ITransport`, + models canonical.
3. **Transport dual-mode**: `LiveTransport` (SDK, HTTP thật) · `DemoTransport` (offline, sinh ack
   thực tế) · chế độ **Auto** (thử live, rơi Demo khi mất server, badge cảnh báo).
4. **HAI driver thật làm proof** (chứng minh khả năng middleware, đều self-contained):
   - `HotFolderAoiDriver` — watch folder, parse file doc 28 (JSON/CSV/XML), atomic-write §6.3.
   - `MqttDriver` — subscribe broker MQTT (MQTTnet), + **broker in-process tuỳ chọn** để demo
     không cần hạ tầng ngoài; ánh xạ topic→canonical (nền tảng Sparkplug B ở roadmap).
5. **Full onboarding lifecycle** trong app: register → poll approve → claim (`mct_`)/enroll
   (`met_`) → lưu khóa (DPAPI); **và** dán `mk_` sẵn; nạp fleet từ file JSON.
6. **UI triển lãm**: Shell · Dashboard fleet · Machine detail (biểu đồ động) · Onboarding wizard ·
   **API Inspector** (stream request/response live) · Scenario control · Settings.
7. **EdgeService seam**: project Windows Service headless tối giản, dùng EdgeCore (chứng minh
   chạy được không UI). Không cần cài đặt production, chỉ là seam biên dịch được + smoke.
8. **Mở rộng SDK**: thêm `SubmitInspectionAsync` vào `St4iDeviceClient.cs` (additive).
9. **Đóng gói**: self-contained single-file EXE (.NET 8, win-x64), song ngữ **vi/en**.

### 2.2 NGOÀI phạm vi lần này (→ roadmap §11, mỗi phase 1 spec riêng)
- Driver thật cho **Modbus TCP/RTU + Serial**, **OPC-UA + Siemens S7 / EtherNet-IP**, **SECS/GEM**,
  **Zmotion** (koffi FFI). Lớp `IDeviceDriver` được thiết kế khớp sẵn nhưng KHÔNG hiện thực lần này.
- Sửa đổi server/backend (spec này chỉ là **client/edge**; không đụng `server/`, `client/`, `drizzle/`).
- Mapping UI đầy đủ (P2). Lần này mapping bằng file JSON + preset.

### 2.3 Không phá vỡ
Không sửa server. SDK chỉ **thêm** method (mọi caller cũ vẫn biên dịch/chạy). Toàn bộ code mới nằm
dưới `tools/machine-simulator/` (isolated), + 1 method thêm vào file SDK dùng chung.

---

## 3. Tóm tắt contract (đích phía Bắc — từ doc 61 & doc 28, đã kiểm chứng live)

| # | Feed | Endpoint | Cờ server | OK | Cho lớp máy |
|---|---|---|---|---|---|
| 1 | RESULT | `POST /api/v1/ingest/process-result` | `PROCESS_RESULT_INGEST_ENABLED` | 201 | automation |
| 2 | TELEMETRY | `POST /api/v1/ingest/telemetry` | (không) | 202 | IoT |
| 3 | INSPECTION | `POST /api/v1/ingest/inspection` | (vision gated) | 201 | AOI/AVI |
| 4 | CONFIG-SYNC | `GET/POST /api/machine/config-sync/{check,get,ack}` | `CONFIG_SYNC_GENERIC_ENABLED` | 200 | mọi máy có recipe |
| 5 | HEARTBEAT | `POST /api/machine/heartbeat` | (không) | 200 | mọi máy |
| 6 | Onboarding | `register`(public) → `config`(poll) → `claim`(`mct_`)/`enroll`(`met_`) | `ENROLLMENT_ENABLED` cho enroll | 200 | mọi máy |

- **Auth**: `Authorization: Bearer mk_...` (ingest/config-sync) hoặc `X-API-Key` (heartbeat, KHÔNG
  Bearer). Header thắng body.
- **RESULT envelope** (§4.2 doc 61): `serialNumber`✅, `stepType`✅, `result`✅(pass|fail|warn|skip),
  `ts`(offset), `recipe{code✅,version,checksum}`, `metrics[]{name✅,value✅number,unit,lsl/usl/nominal}`,
  `waveforms[]{name✅,unit,rateHz,samples[[t,v]]}`, `idempotencyKey`(8..200), `stationId`(SỐ),
  `lineCode`/`lotCode`/`productionOrderCode` (genealogy). Field lạ bị **strip**.
- **TELEMETRY** (`CanonicalSample`): `metric`✅, `value`(num|str|bool|null), `unit`, `ts`, `deviceId`
  (= mã máy để resolve), `quality`(good|bad|uncertain), `protocol`. Body `{samples:[…]}` hoặc mảng trần.
- **INSPECTION** (`machineDataContractV11`): `machineCode|apiKey` (một trong hai), `serialNumber`✅
  (≤100), `productModel`, `variantCode`, `overallResult`✅(OK|NG|NTF), `inspectionTime`,
  `idempotencyKey`(8..200), `measurements[]{pointCode, measuredValue, result✅(OK|NG|NTF),
  defectCatalogCode(IPC-A-610), defectSeverity, unit, valueHeight/Area/Volume/VoidPct/Coplanarity/
  Warpage/OffsetX/OffsetY/Tilt/Thickness/Z, imageBase64}`, `panelId`/`boardIndex` (multi-up).
- **Ba trụ độ-bền** (doc 61 §8): `idempotencyKey` ổn định `<machineCode>:<recipe>:<cycle>` (exactly-once),
  `ts` kèm offset, retry-chỉ-khi-retryable (429/5xx/mất mạng) + store-and-forward JSONL. SDK đã cài sẵn.

---

## 4. Kiến trúc

### 4.1 Pipeline gateway (EdgeCore)
```
        ┌──────────── St4i.EdgeCore (class lib .NET 8) ─────────────┐
 phía   │ IDeviceDriver ──▶ Channel<DeviceReading> ──▶ Normalizer ──┼─▶ ITransport ──▶ ST4I
 Nam    │  ├ SimulatedDriver (per-machine sims)      (map raw→      │   ├ LiveTransport (SDK HTTP)
        │  ├ HotFolderAoiDriver (doc 28 parse)        canonical      │   ├ DemoTransport (offline)
        │  └ MqttDriver (MQTTnet)                     Feed field)    │   └ AutoTransport (live→demo)
        │                                                            │        └ St4iDeviceClient (SDK)
        │  ResiliencePolicy · CredentialStore(DPAPI) · FleetConfig · EventBus(observability)
        └────────────────────────────────────────────────────────────────────────────────────────┘
                       ▲ dùng chung ▲
        ┌──────────────┴──────────────┐        ┌──────────────┴───────────────┐
        │ St4iMachineSimulator (WPF)  │        │ St4i.EdgeService (Win Service │
        │  Views + ViewModels (MVVM)  │        │  headless — seam, dùng EdgeCore)│
        └─────────────────────────────┘        └───────────────────────────────┘
```

### 4.2 Vòng đời một "reading"
1. `IDeviceDriver` phát 1 `DeviceReading` (thô: tag/register/field máy) vào một `Channel<T>` (back-pressure).
2. `Normalizer` áp `MappingProfile` → sinh **canonical envelope** (RESULT/TELEMETRY/INSPECTION) đúng
   field doc 57/28, gắn `idempotencyKey` ổn định, `ts` offset.
3. `ITransport.SendAsync(envelope)` → SDK (Live) hoặc fabricator (Demo) → `TransportAck`.
4. `EventBus` phát sự kiện (request, response, latency, verdict) → API Inspector + KPI + charts
   (UI subscribe; cập nhật qua `Dispatcher`).
5. Lỗi retryable/mất mạng → SDK/queue store-and-forward; UI hiển thị badge "QUEUED/REPLAY".

### 4.3 MVVM (WPF)
- `CommunityToolkit.Mvvm` (ObservableObject/RelayCommand source-gen).
- Mỗi màn hình 1 ViewModel; `FleetViewModel` sở hữu N `MachineViewModel`; `AppShellViewModel` giữ
  mode (Live/Demo/Auto), server status, global start/stop.
- **Threading (bắt buộc, doc 61 §11.4)**: driver/transport/heartbeat chạy trên `Task`/`PeriodicTimer`
  nền + `CancellationToken`; UI cập nhật qua `Dispatcher.BeginInvoke`; **không** `.Result/.Wait()`.

---

## 5. Thiết kế thành phần (mỗi unit: làm gì · interface · phụ thuộc)

### 5.1 EdgeCore — models canonical
- `DeviceReading` (thô, discriminated theo `ReadingKind`: ProcessResult|Telemetry|Inspection).
- `ProcessResultEnvelope`, `TelemetryBatch`, `InspectionDocument` (khớp §3). `TransportAck`
  (`Success, Id, Duplicate, Queued, Accepted, HttpStatus, LatencyMs, RawBody`).
- `MachineDescriptor` (`Code, SerialSeed, DeviceClass, MachineType, StepType, DriverKind, RecipeCode`).
- **Làm gì**: kiểu dữ liệu bất biến toàn pipeline. **Phụ thuộc**: không (POCO + System.Text.Json).

### 5.2 `IDeviceDriver` (phía Nam)
```csharp
public interface IDeviceDriver : IAsyncDisposable {
    string Id { get; } DriverKind Kind { get; }
    IAsyncEnumerable<DeviceReading> ReadAsync(CancellationToken ct);   // stream readings
    Task StartAsync(CancellationToken ct); Task StopAsync();
    DriverHealth Health { get; }                                       // Connected/Degraded/Down
}
```
- **Làm gì**: nguồn dữ liệu cắm-tháo. **Phụ thuộc**: models. Ba hiện thực (§5.3–5.5).

### 5.3 `SimulatedDriver` + per-machine simulators (bản triển lãm)
- `IMachineSimulator.NextCycle()` sinh 1 `DeviceReading` thực tế theo state machine
  `Idle→Running→Fault→Recovery` + tỉ lệ pass/warn/fail/defect cấu hình (§6).
- `SimulatedDriver` bọc N simulator, phát reading theo cycle-time mỗi máy.
- **Phụ thuộc**: models, `Random` seeded (KHÔNG dùng thời gian thực để seed — tái lập được).

### 5.4 `HotFolderAoiDriver` (PROOF thật — doc 28)
- Watch một thư mục (`FileSystemWatcher` + poll fallback). Bỏ qua `*.tmp`; chỉ nhận file hoàn tất
  (atomic rename §6.3). Parse **JSON/CSV/XML** theo doc 28 §4; validate §8 (offset bắt buộc, token
  OK/NG/NTF, `serial_number` non-empty…). File OK → `archive/`, lỗi → `error/` (không xoá).
- Sinh `DeviceReading(Inspection)` → Normalizer → `POST /api/v1/ingest/inspection`.
- **Vòng demo sống**: `SimulatedDriver` (máy AOI) có option **ghi ra file doc 28 thật** vào watch
  folder → `HotFolderAoiDriver` nhặt lên → đẩy đi. Khách thấy trọn "máy→file→middleware→hệ thống".
- **Phụ thuộc**: models, parser doc 28 (viết mới, thuần .NET, 0 NuGet). Không phụ thuộc mạng ngoài.

### 5.5 `MqttDriver` (PROOF thật — MQTT)
- Subscribe topic (MQTTnet client). Map `topic→(deviceId, metric)` + payload JSON→value theo
  `MappingProfile`. Sinh `DeviceReading(Telemetry)` (hoặc ProcessResult nếu topic cấu hình vậy).
- **Broker in-process tuỳ chọn** (`MQTTnet.Server`) để demo self-contained: app vừa publish (máy
  IoT mô phỏng) vừa subscribe (driver) trên broker nội bộ — ESP32 thật bên ngoài cũng cắm vào được.
- Sparkplug B: để roadmap (chỉ chuẩn bị enum `protocol`).
- **Phụ thuộc**: `MQTTnet` (NuGet, managed thuần, self-contained OK).

### 5.6 `Normalizer` + `MappingProfile`
- **Làm gì**: chuyển `DeviceReading` thô → canonical envelope. `MappingProfile` (JSON) khai báo:
  tag/field máy → field canonical, đơn vị + `unitScaleToCanonical`, LSL/USL, `stepType`/`metric`,
  quy tắc `idempotencyKey`. Preset sẵn cho từng lớp máy; máy mới = thêm JSON, không sửa code.
- **Phụ thuộc**: models. Đây là **điểm mở rộng chính** của middleware.

### 5.7 `ITransport` (phía Bắc) + 3 hiện thực
```csharp
public interface ITransport {
    Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct);
    Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct);
    Task<ConfigSyncResult> SyncConfigAsync(...);  TransportMode Mode { get; }
}
```
- `LiveTransport`: bọc `St4iDeviceClient` (một instance/máy, singleton, tái dùng SDK trọn vẹn:
  RESULT/TELEMETRY/**INSPECTION(mới)**/config-sync/heartbeat/enroll/claim/queue).
- `DemoTransport`: **offline fabricator** — sinh ack thực tế: bộ đếm `processResultId` tăng dần,
  bảng dedup theo `(machineCode, idempotencyKey)` trả `duplicate:true`, telemetry `accepted=received`,
  inspection `inspectionId` tăng, config-sync trả payload recipe mẫu, heartbeat `keyStatus:no_expiry`.
  Có độ trễ giả + tỉ lệ lỗi giả tuỳ chọn (để demo retry/queue).
- `AutoTransport`: thử `LiveTransport`; nếu `St4iNetworkException`/health Down → chuyển
  `DemoTransport`, phát cờ **DEMO FALLBACK**; định kỳ probe live để quay lại.
- **Phụ thuộc**: `St4iDeviceClient` (link), models.

### 5.8 SDK extension — `SubmitInspectionAsync` (thêm vào `St4iDeviceClient.cs`)
- Thêm DTO `MeasurementPoint` + method `SubmitInspectionAsync(serialNumber, productModel,
  overallResult, measurements, idempotencyKey?, variantCode?, panelId?, boardIndex?, ts?, ...)`
  → `POST /api/v1/ingest/inspection` dùng đúng `SendWithRetryAsync` (retry/queue/duplicate như RESULT).
- **Additive**: không đổi chữ ký cũ. Reference `ExampleScrewdriver.cs` không đổi.

### 5.9 Hạ tầng dùng chung
- `CredentialStore`: lưu/nạp `mk_` per-máy, **DPAPI `ProtectedData`** (Windows). Fleet config JSON.
- `ResilienceProbe`: ping `/api/v1/openapi.json` → báo endpoint/cờ nào reachable (hướng dẫn operator).
- `EventBus`: pub/sub in-proc (Channel) cho observability (API Inspector, KPI, charts, log file).

### 5.10 WPF Views/ViewModels
| Màn hình | ViewModel | Nội dung |
|---|---|---|
| **Shell** | `AppShellViewModel` | sidebar nav · topbar: server status, **toggle Live/Demo/Auto**, Start/Stop fleet, badge cờ + DEMO-FALLBACK, đồng hồ, nút kiosk |
| **Dashboard** | `FleetViewModel`+`KpiViewModel` | lưới tile mỗi máy (đèn, throughput, pass-rate, cycle cuối, driver-kind SIM/HOTFOLDER/MQTT) · KPI tổng (cycle, FPY, ONLINE) · sparkline |
| **Machine detail** | `MachineViewModel` | biểu đồ động: histogram/**SPC I-MR** (automation), line telemetry (IoT), **board-view vẽ bbox defect** (AOI) · panel recipe/config-sync (check→get→apply→ack) · log chu trình |
| **Onboarding** | `OnboardingViewModel` | wizard register→poll→claim/enroll→lưu khóa · dán `mk_` · nạp fleet JSON |
| **API Inspector** ⭐ | `InspectorViewModel` | stream request/response live (method, URL, status, latency, body gọn) · filter theo máy/feed · pause/clear/export |
| **Scenario** | `ScenarioViewModel` | slider cycle-rate/defect-rate/fault-inject · Burst · preset (Ca bình thường, Lô lỗi cao, Sensor drift, Mất mạng demo, Hot-folder AOI) |
| **Settings** | `SettingsViewModel` | server URL, verify TLS, kiểm cờ (`ResilienceProbe`), quản lý khóa, ngôn ngữ vi/en, kiosk/attract |

### 5.11 `St4i.EdgeService` (seam headless)
- Console/Windows Service (`Microsoft.Extensions.Hosting`) khởi tạo cùng EdgeCore từ 1 file cấu hình,
  chạy driver→normalize→transport không UI. **Chỉ seam**: biên dịch + smoke "chạy 10 reading rồi
  thoát". Chứng minh production middleware chạy được không cần UI.

---

## 6. Mô hình mô phỏng theo lớp máy (physics thực tế)

| Máy | Feed / stepType | Sinh dữ liệu | Chấm verdict |
|---|---|---|---|
| Bắt vít `SCREWDRIVE` | RESULT `screw_tightening` | torque ~N(12.0,0.4)Nm + angle ~N(350,10)°, **waveform torque-vs-angle** (ramp), drift nhẹ theo giờ | pass nếu LSL≤torque≤USL, warn cận biên, fail ngoài |
| Điểm keo `DISPENSING` | RESULT `glue_dispense` | volume ~N(0.21,0.01)mL + pressure kPa, tương quan nhiệt | LSL/USL volume |
| Hàn `WELDER` | RESULT `weld_spot` | weld_current A + weld_time ms, **waveform dòng hàn** | spec current/time |
| Ép `ASSEMBLY` | RESULT `press_fit` | lực ép N + độ sâu mm | (chưa seed spec → warn-only) |
| Leak `*` | RESULT `leak_test` | áp suất rò Pa/s | ngưỡng cấu hình |
| Functional `*` | RESULT `functional_test` | pass-rate + vài metric số | tỉ lệ |
| IoT `IOT_SENSOR` | TELEMETRY | temperature/humidity/current dạng sin+nhiễu; sự kiện **drift**; quality good/uncertain | (telemetry, không verdict) |
| AOI/AVI `AOI` | INSPECTION | board N điểm; tiêm defect **IPC-A-610** (`INSUFFICIENT_SOLDER`, `BRIDGING`, `MISSING_COMPONENT`, `TOMBSTONING`…) + `bbox_px` + `values_3d`; NG-rate cấu hình | overallResult OK nếu mọi point OK (doc 28 §8.5) |

- **Fleet mặc định triển lãm** (~10–12 máy): 2 vít, 1 keo, 1 hàn, 1 ép, 1 leak, 1 functional,
  2 IoT, 2 AOI — một dây chuyền đáng tin. Cấu hình bằng `fleet.json`.
- `idempotencyKey` = `<machineCode>:<recipeCode>:<cycleCounter>` (ổn định qua retry).
- **Determinism**: `Random` seed cố định/máy để tái lập; biến thiên theo index, KHÔNG theo
  `DateTime.Now` (tránh phụ thuộc thời gian như quy tắc workflow của dự án).

---

## 7. Transport dual-mode (chi tiết hành vi)

- **Live**: mọi call đi SDK thật; cần server bật cờ (§3). Settings có "Kiểm cờ" (probe) báo đỏ/xanh.
- **Demo**: 100% offline; fabricator sinh ack **giống thật** để UI/biểu đồ/Inspector đầy đủ; hỗ trợ
  bật "tỉ lệ lỗi giả" để trình diễn retry + store-and-forward + queue badge.
- **Auto** (mặc định triển lãm): live-first, rơi Demo khi mất server, badge **DEMO FALLBACK**,
  auto-probe quay lại live. API Inspector đánh dấu rõ dòng nào Live vs Demo (không gây hiểu nhầm).

---

## 8. Onboarding (đầy đủ bước — do người dùng yêu cầu)

- **Wizard live**: `register` (public) → poll `config?serialNumber=` tới `isApproved` → `claim`
  (`mct_`) hoặc `enroll` (`met_`, cần `ENROLLMENT_ENABLED`) → nhận `mk_` (hiện 1 lần) → lưu DPAPI.
- **Dán `mk_`**: nhập tay per-máy (provision trước) — đường nhanh.
- **Fleet JSON**: `fleet.json` liệt kê máy + `mk_` (hoặc để trống chờ claim). Demo mode bỏ qua khóa.

---

## 9. Xử lý lỗi & độ bền

- Phân loại đúng doc 61 §8–§9: **4xx (400/401/403/409) = vĩnh viễn** → không retry, hiện lỗi để
  sửa; **429/5xx/mất mạng = tạm** → backoff mũ + store-and-forward JSONL (SDK lo). Config-sync OFF
  trả **500 (đừng retry)**.
- UI phân biệt `St4iApiException` (đỏ, cần sửa) vs `St4iNetworkException` (vàng, đã queue, sẽ replay).
- HotFolder: file lỗi → `error/` (không xoá, không mất). MQTT: mất broker → driver Degraded, không sập.

---

## 10. Đánh bóng triển lãm & đóng gói

- Theme công nghiệp tối + accent, animation mượt (LiveCharts), font lớn, layout thoáng.
- **Kiosk/fullscreen** + **Attract mode** (tự chạy preset "Ca bình thường" khi rảnh N giây).
- **Song ngữ vi/en** (ResourceDictionary; mặc định vi).
- **Đóng gói**: `dotnet publish -r win-x64 -c Release --self-contained -p:PublishSingleFile=true`
  (TFM `net10.0-windows`) → 1 EXE cắm-chạy, không cần cài .NET. Splash + icon thương hiệu ST4I.

---

## 11. Lộ trình tiến hoá middleware (mỗi phase 1 spec riêng)

| Phase | Nội dung | Giao thức |
|---|---|---|
| **P1 (lần này)** | Simulator + EdgeCore + Normalizer + Live/Demo/Auto + **HotFolderAoiDriver** + **MqttDriver** + Service-seam + đóng gói | Hot-folder (doc 28), MQTT |
| **P2** | Mapping UI + Sparkplug B + Device Manager headless production | MQTT/Sparkplug B |
| **P3** | Driver Modbus TCP/RTU + Serial (súng vít/keo/hàn, PLC nhỏ, RS-232/485) | Modbus, Serial |
| **P4** | Driver OPC-UA + Siemens S7 / EtherNet-IP | OPC-UA, S7, EtherNet/IP |
| **P5** | SECS/GEM + **Zmotion** (koffi FFI, tham chiếu doc 38) + HA/buffering + security hardening + OTA config | SECS/GEM, Zmotion |

`IDeviceDriver`/`Normalizer`/`MappingProfile` được thiết kế lần này để **khớp sẵn** các driver P2–P5:
mỗi phase chỉ thêm 1 lớp `IDeviceDriver` + preset mapping, không sửa pipeline/transport/UI.

---

## 12. Tech stack & bố cục project

- **.NET 10** WPF — TFM `net10.0-windows` (SDK 10.0.300 + WindowsDesktop 10.0.8 đã cài trên máy;
  .NET 10 LTS, mới hơn .NET 8, publish self-contained y hệt). win-x64. C# nullable enable.
- NuGet: `CommunityToolkit.Mvvm`, `LiveChartsCore.SkiaSharpView.WPF`, `MQTTnet` (+ `MQTTnet.Server`).
  Tất cả managed/self-contained-friendly. `St4iDeviceClient.cs` **link** (0 NuGet trên .NET 8).
- Không đụng `server/`, `client/`, `drizzle/`.

```
tools/machine-simulator/
  St4iMachineSimulator.sln
  fleet.json · mapping/*.json · README.md
  src/
    St4i.EdgeCore/            # class lib: models, IDeviceDriver(+Simulated/HotFolder/Mqtt),
    │                         #   Normalizer/MappingProfile, ITransport(Live/Demo/Auto),
    │                         #   Resilience/CredentialStore/EventBus, doc28 parser
    │                         #   (+ <Compile Link> St4iDeviceClient.cs)
    St4iMachineSimulator/     # WPF app: App, Views/, ViewModels/, Themes/, Assets/, i18n/
    St4i.EdgeService/         # Windows Service headless seam (Microsoft.Extensions.Hosting)
  tests/
    St4i.EdgeCore.Tests/      # xUnit: normalizer, doc28 parser, demo-transport dedup, idempotency
```

---

## 13. Chiến lược kiểm thử & nghiệm thu

- **Unit (xUnit)**: doc28 parser (JSON/CSV/XML + reject offset-less/DOCTYPE), Normalizer mapping,
  DemoTransport dedup/`duplicate`, idempotencyKey ổn định, HotFolder atomic-write (bỏ `.tmp`).
- **Build gate**: `dotnet build` toàn sln xanh; `dotnet test` xanh.
- **Verify Demo (không cần server)**: chạy app Demo mode, chụp Dashboard + Machine detail + API
  Inspector đang chảy; chứng minh "luôn đẹp khi offline".
- **Verify Live (nếu server dev bật cờ)**: bắn thật ≥1 chu trình mỗi feed; đối chiếu
  `processResultId`/`accepted`/`inspectionId` như doc 61 §14. HotFolder: thả 1 file `.st4i.json` →
  thấy inspection lên hệ thống. MQTT: publish 1 sample → thấy telemetry.
- **Verify đóng gói**: publish single-file EXE, chạy trên máy sạch (Demo mode) → mở được, không lỗi runtime.

---

## 14. Giả định & rủi ro

- **GĐ**: máy triển lãm chạy Win10/11 x64. Server dev (nếu dùng Live) bật cờ §3 + có `mk_`.
  Không có phần cứng tự động hoá thật tại gian hàng (nên proof-driver chọn HotFolder+MQTT self-contained).
- **Rủi ro**: LiveCharts/SkiaSharp kéo native lib → EXE lớn (chấp nhận). MQTTnet API version drift →
  pin version. Contract server đổi → SDK là một-nguồn-sự-thật nên chỉ sửa 1 nơi.
- **Đã giảm thiểu**: Demo mode loại rủi ro mạng; EdgeCore tách UI loại rủi ro rewrite khi lên production.

---

## 15. Tiêu chí hoàn thành (Definition of Done — P1)

1. `dotnet build`/`dotnet test` xanh toàn solution.
2. App chạy **Demo mode** không cần server: Dashboard + ≥1 Machine detail (mỗi lớp máy) + API
   Inspector hoạt động, biểu đồ động chạy.
3. **AutoTransport** chuyển Live↔Demo có badge đúng khi bật/tắt server.
4. **HotFolderAoiDriver**: thả file doc 28 (JSON/CSV/XML) → đẩy inspection (Live) / hiện Inspector (Demo).
5. **MqttDriver**: publish→subscribe qua broker in-process → telemetry chảy.
6. Onboarding wizard đi hết register→claim (hoặc enroll) khi server bật; dán `mk_` hoạt động.
7. `SubmitInspectionAsync` thêm vào SDK, mọi caller cũ vẫn biên dịch.
8. `St4i.EdgeService` biên dịch + smoke headless chạy 10 reading.
9. Publish self-contained single-file EXE chạy được trên máy sạch.
10. README + `fleet.json`/`mapping` mẫu; song ngữ vi/en; roadmap §11 ghi rõ.

---

*Doc 62 · Design spec (brainstorming APPROVED) · scope = client/edge only, không đụng server ·
tái dùng SDK doc 61 · tiến hoá thành edge middleware theo §11 · 2026-07-18.*
