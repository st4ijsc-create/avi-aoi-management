# WS-G-plugin (đợt 1) — Connector seam, registry & conformance

**Ngày:** 28/07/2026 · **Nhánh:** `feat/machine-simulator` · **BASE:** `39d65b01`

## Mục tiêu

Hôm nay, thêm một driver là **sửa code ở 3 file** (`FleetHost` ctor + `StartLocked` + `Program.cs`), và **bên thứ ba không có cách nào viết driver** vì `St4i.EdgeCore` là `net10.0-windows` và không publish NuGet. Đợt này dựng **seam** để việc đó thành cấu hình, và dựng **cổng conformance** để một driver — của ta hay của đối tác — phải chứng minh nó tuân thủ hợp đồng.

**Không** nạp code bên ngoài trong đợt này. Mô hình cách ly cuối cùng đã chốt là **sidecar tiến trình riêng** (lõi không link DLL của hãng), nên mọi quyết định hợp đồng ở đợt này phải **an toàn qua IPC ngay từ đầu** — đó là lý do GP-2 tồn tại.

## Quyết định đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| 1 | Cách ly = **sidecar tiến trình riêng** (đợt sau) | Middleware này điều khiển máy có E-STOP. Driver bên thứ ba treo/crash/rò bộ nhớ không được phép kéo sập lớp điều khiển. Cũng tránh luôn xung đột dependency và rắc rối `PublishSingleFile`. |
| 2 | Đợt này = **seam + registry + conformance** | Giao được giá trị thật (thêm driver = cấu hình) mà chưa phải chốt giao thức IPC. |
| 3 | `TelemetrySample.Value` giữ `object?`, thêm **JsonConverter** | Refactor sang variant type ripple ~6 chỗ. Converter ~30 dòng, ripple 0, và conformance ép chứng minh. Không đóng cửa việc siết kiểu sau. |
| 4 | `DriverKind` enum đóng → **chuỗi id mở** | Bên thứ ba không thêm được thành viên enum. Chi phí thấp: không nằm trong UNS/Sparkplug/historian; `assets.db` đã là TEXT. |

## Dữ kiện đã khảo sát (không suy đoán)

- `IDeviceDriver` (`src/St4i.EdgeCore/Drivers/IDeviceDriver.cs:1-27`): `Id`, `Kind`, `Health`, `ReadAsync(ct)`, `IAsyncDisposable`. Vòng đời: ctor (không chặn, không nối) → `ReadAsync` (vòng chạy) → `DisposeAsync`.
- **Không có registry/switch nào theo `driverKind`.** `FleetHost` có một tham số ctor riêng cho mỗi loại (`FleetHost.cs:266-268`) và hai khối `if` copy-paste (`:640-644`, `:653-657`). `driverKind` trong `fleet.json` chỉ dùng để **loại trừ** máy Modbus/OPC-UA khỏi nhánh simulator (`FleetHost.cs:594`).
- **Không hề có cơ chế nạp assembly động** trong repo (không `Assembly.Load`/`AssemblyLoadContext`/MEF).
- `DriverKind` **không** có trong UNS/Sparkplug, **không** có trong historian. Trong `assets.db` là `driver_kind TEXT` và `AssetRecord.DriverKind` **đã** là `string`.
- HTTP: `FleetTileDto.DriverKind`, `MachineDetailDto.DriverKind`, `DriverHealthSnapshot.Kind` — serialize thành chuỗi PascalCase qua `JsonStringEnumConverter`.
- Web: union đóng ở `api.ts:55`; `AssetRegistry.tsx:60-77` **đã** khoan dung giá trị lạ; `Nameplate.tsx:90` render `t()` **không fallback**.
- `fleet.json`: một `driverKind` sai làm hỏng **cả file** → `FleetConfigException` → âm thầm thay **toàn bộ roster** bằng đội mặc định trong code (`FleetConfig.cs:80-83`, `FleetHost.cs:1284`).
- `DeviceReading` là **class khả biến**, list khả biến, `Genealogy: Dictionary<string,object>?`. Miền giá trị thực của `TelemetrySample.Value` qua mọi driver: **`double | bool | string | null`** (chỉ `OpcUaDriver.BoxValue` sinh chuỗi phi số). `Genealogy`: `string | int | double` (chỉ `Doc28Parser` ghi).
- **Chưa có chỗ nào trong repo deserialize `DeviceReading`.** Chiều ra đã chạy thật (ingest HTTP) nhưng round-trip đầy đủ **chưa từng được thực thi**.
- `ScenarioAwareDriver.Inject` (`ScenarioAwareDriver.cs:56-96`) **sửa tại chỗ** reading sau khi driver trong đã yield. Nằm giữa driver và pipeline, cùng tiến trình → dưới mô hình sidecar nó sẽ sửa bản đã deserialize phía host, vẫn đúng.

## Ràng buộc toàn cục

- **Không thêm NuGet.** Không sửa SDK vendored `examples/device-client/csharp/St4iDeviceClient.cs`.
- **Additive:** cài đặt hiện có không đổi hành vi. `ST4I_MODBUS_*` / `ST4I_OPCUA_*` phải tiếp tục chạy y nguyên.
- Mọi route mới phải vào `RbacPolicyTests.ExpectedRoutes` (sweep khớp số lượng chính xác hai chiều).
- Gate mỗi task: `dotnet build St4iMachineSimulator.sln -c Debug` sạch + **toàn bộ** `St4i.EngineApi.Tests` + `St4i.EdgeCore.Tests` + `St4i.EdgeService.Tests` xanh (mốc hiện tại: 538 / 463 / 28 = **1029**).
- Test làm bẩn `%ProgramData%\ST4I\sim\` là lỗi (đã dính 4 lần). Lưu ý: leak sẵn có từ test của asset/credential store **không** thuộc đợt này.
- Flaky môi trường đã biết: `WalFlushPumpTests`, `StoreAndForwardRestartSurvivalTests`, `MqttDriverTests`, `DeviceIdentityStoreTests` mTLS handshake, và mọi thứ gắn `[Trait("Category","RequiresMulticast")]`.

## Các task

### GP-1 — `St4i.Connector.Abstractions` (`net10.0`, không phụ thuộc)
Tách assembly hợp đồng bên thứ ba compile against: `IDeviceDriver`, `DeviceReading` + các record lồng, `CyclePlan`, và các enum thuộc hợp đồng (`ReadingKind`, `Verdict`, `DriverHealthState`, `DeviceClass`), `TelemetryNumeric`.
**Thuần chuyển dời, không đổi hành vi.** Không dính DPAPI/WPF/Windows. Gate: 1029 test vẫn xanh.

### GP-2 — Trung thực round-trip cho hợp đồng (cốt lõi sẵn-sàng-sidecar)
`JsonConverter` đưa `object?` về đúng CLR type (`double`/`bool`/`string`/`null`) thay vì `JsonElement`, cho cả `TelemetrySample.Value` và `Genealogy`. Chứng minh `DeviceReading` round-trip **không mất mát** — kể cả `Waveforms`, `Measurements`, `Values3d`, `Plan`. Đây là lần đầu repo deserialize `DeviceReading`; nếu không có bước này, telemetry sẽ **biến mất im lặng** qua ranh giới sidecar vì `JsonElement` không phải `IConvertible`.

### GP-3 — Mở `DriverKind` thành id chuỗi
Enum đóng → id chuỗi (`"simulated"`, `"modbus-tcp"`, `"opcua"`, `"vendor.acme.weld"`). Sửa 2 DTO + `DriverHealthSnapshot`, web union + **fallback cho `Nameplate.tsx`**. Kèm: `fleet.json` khoan dung **theo từng dòng** — một entry sai không được phép thay cả roster.

### GP-4 — `ConnectorRegistry` + mô hình cấu hình
`IConnectorFactory` (kind + `Create(config)`), registry tra theo kind. `FleetHost` bỏ tham số ctor riêng từng loại và các khối hardcode. Env `ST4I_MODBUS_*`/`ST4I_OPCUA_*` giữ nguyên qua shim đăng ký vào registry.

### GP-5 — Di trú Modbus + OPC-UA + Simulated qua registry
Chứng minh seam bằng **driver thật**, không phải ví dụ đồ chơi. Hành vi không đổi với cài đặt hiện có.

### GP-6 — Bộ conformance
Bộ kiểm dùng chung mọi driver phải qua: ctor không chặn/không nối/không ném · `ReadAsync` tôn trọng cancellation · `DisposeAsync` idempotent và an toàn sau cancel · `Health` chuyển trạng thái hợp lệ · không tái dùng instance `DeviceReading` giữa các lần yield · **telemetry sống sót round-trip JSON**. Chạy cả ba driver qua nó.

### GP-7 — Web + tài liệu + review cả đợt + push
Hiển thị connector đã đăng ký; README §19 + cập nhật báo cáo tổng; review cả đợt (opus) rồi push.

## Hoãn có ghi nhận (không giấu nợ)

- **Sidecar + IPC** — đợt sau. Đợt này chỉ dựng seam cho nó.
- `plugin.yaml` / `apiVersion` SemVer / `configSchema` → form UI tự sinh / ký số plugin — GAP-G3, đợt sau.
- `EdgePipeline` chia sẻ **cùng instance `DeviceReading` khả biến** cho UNS (đọc trên thread nền) và mọi subscriber `Committed`, không copy phòng vệ. Đã kiểm: không subscriber nào ghi ngược, nên hôm nay chưa hỏng. **Nguy cơ tiềm ẩn có sẵn, không thuộc đợt này.**
- `St4i.EdgeCore` vẫn `net10.0-windows` (DPAPI `CredentialStore` + SDK vendored). Chỉ assembly hợp đồng là thuần `net10.0`.
- Không publish NuGet trong đợt này — assembly hợp đồng tồn tại và sạch phụ thuộc, nhưng khâu phát hành để lúc có sidecar thật.
