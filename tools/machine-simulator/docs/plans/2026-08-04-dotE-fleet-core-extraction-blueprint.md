# Đợt E — Tách lõi vòng đời N-driver, để tác nhân biên lái được máy thật

**Ngày:** 2026-08-04. Tiếp sau Đợt D (`4204ecf6`) và đợt đóng phát hiện mang sang (`f6562866`).
Gate nền: 151/22/1072/28/1282 = **2555**, 0 lỗi, 116 cảnh báo (đã khẳng định), 0 build node (đã khẳng định).

## 1. Vì sao đợt này tồn tại

Đợt D làm cho RS-485 chạy được **chỉ trong `St4i.EngineApi`**. Chủ sở hữu xác nhận **`St4i.EdgeService` mới là tiến trình chạy trên máy có cổng RS-485**. Hôm nay nó không thể chủ trì một connector nào, và điểm chặn **không phải** cái registry còn thiếu:

| Thành phần | Dòng | Vai trò |
|---|---|---|
| `FleetHost` | **2406** | vòng đời **N driver**, roster, phân giải slot, health, restart, an toàn |
| `ConnectorRegistry` | 448 | dựng driver từ cấu hình |
| `ConnectorsConfig` | 274 | đọc `connectors.json` |
| `ConnectorsJsonRegistration` | 302 | điều phối config → registry |
| `ModbusMultidropRegistration` | 318 | toả một map thành N thể hiện |
| `EdgeWorker` | 429 | **một** driver, **một** pipeline |
| `FleetService` (WPF) | 584 | **một** driver + một driver demo |

`EdgeWorker` **không có khái niệm nhiều driver**: nó gom cả đội máy thành một `SimulatedDriver`
(`EdgeWorker.cs:164`) chạy một `EdgePipeline`.

**Và đường tắt đã có người thử và ghi lại là bất khả thi**: tham chiếu thẳng EdgeService →
`St4i.EngineApi` cho `NU1605` package downgrade lúc restore, cộng bề mặt ASP.NET Core / cổng publish
web-UI của EngineApi (`EdgeWorker.cs`, chú thích `ResolveGate`). **Tách lõi là bắt buộc.**

## 2. 🔴 Hình dạng đã chốt, và điều nó loại bỏ

**EdgeService là TÁC NHÂN BIÊN, không phải engine thứ hai.** `ST4I_SERVER_URL` mặc định
`http://localhost:5000`; nó đọc máy tại chỗ rồi **đẩy lên** EngineApi.

→ **EngineApi vẫn là nơi DUY NHẤT sở hữu roster, yêu sách mã máy và UI.** Một nguồn sự thật.

**Vì sao điều đó quan trọng hơn tiện lợi:** yêu sách mã máy là một `ConcurrentDictionary` **trong một
tiến trình** — không mutex, không lockfile, không primitive có tên (đã grep `Fleet/` và
`Drivers/Modbus/`, rỗng). Bảo vệ duy nhất tồn tại là của hệ điều hành, **cho cổng COM, không phải cho
cái máy**:

| Transport | Hai tiến trình cùng chủ trì một máy | Ai chặn |
|---|---|---|
| Serial cắm thẳng | tiến trình thứ hai **không mở nổi cổng** | hệ điều hành, tình cờ |
| Gateway TCP | **cả hai kết nối bình thường** | **không ai** |

`AmbiguousDriver` được chứng minh không-với-tới-được **về cấu trúc**, và toàn bộ chứng minh ấy nằm
**trong một tiến trình**. Một mô hình hai-engine sẽ tái mở đúng lỗ hổng Đợt B dựng guard để bịt — ở
quy mô tiến trình, nơi không guard nào tồn tại. **Hình dạng tác nhân biên tránh được điều đó bằng cấu
trúc, không bằng kỷ luật.**

## 3. 🔴 Giới hạn phải nói thẳng TRƯỚC khi xây: chiều ghi

`ITransport` **chỉ có chiều lên** — `SendAsync`, `HeartbeatAsync`, `SyncConfigAsync`, cả ba
client→server. **Không có đường xuống cho lệnh ghi.**

Ghép với `SerialPort` mở độc quyền (D-3 đã đo): **nếu EdgeService giữ COM3, EngineApi không ghi được
vào những máy đó nữa** — cổng đã bị chiếm.

Nên đợt này, đúng như phạm vi đã chốt, **giao chiều đọc và làm mất chiều ghi** cho đúng những máy tác
nhân biên cầm. Ba lối ra, phải chọn và ghi lại **trước** E-3:

1. **Chỉ đọc, ghi giới hạn thành văn.** Rẻ nhất, trung thực nhất. Máy do tác nhân biên cầm là máy
   **chỉ đọc** cho tới khi có đường xuống. Người vận hành phải thấy điều đó ở nơi họ gặp nút ghi,
   không phải chỉ trong tài liệu.
2. **Tác nhân biên KÉO lệnh đang chờ** qua một endpoint mới (`GET /v1/edge/commands`). Đường xuống
   dạng pull, nhỏ hơn push, dùng lại được mô hình `SyncConfigAsync` đã có.
3. **Xây đường xuống thật.** Lớn nhất; kéo theo xác thực, thứ tự, phát lại, và **hạn dùng của một
   lệnh** — một lệnh ghi tới muộn là một máy chuyển động muộn.

**Khuyến nghị: (1) cho đợt này, (2) là ứng viên cho đợt sau.** Lý do: chiều ghi đã có `EstopGuardRule`,
RBAC, dòng audit và hợp đồng `Indeterminate` của Đợt B **ở EngineApi**; dựng lại chúng sau một đường
xuống là một đợt riêng, không phải một nhiệm vụ.

## 4. Cái gì di chuyển, cái gì ở lại

`FleetHost` **không** phải một khối. Bề mặt công khai của nó trộn bốn nhóm:

| Nhóm | Ví dụ | Đi hay ở |
|---|---|---|
| **Vòng đời N-driver** | `Start`, `Stop`, `RegisterMachine`, `GetDriverHealth`, `GetMachineDriverAvailability` | **ĐI** |
| **An toàn** | `Estop`, `ResetEstop`, `EstopEngaged`, `GetSafetyStatus` | **ĐI** (xem §5) |
| **Kịch bản / trình diễn** | `ApplyPresetAsync`, `Burst`, `RunHotFolderAoiDemoAsync` | **Ở LẠI** |
| **Chiếu ra web** | `Snapshot`, `MachineDetail`, `GetSettings`, `CurrentScenarioDto` | **Ở LẠI** |

**Tin tốt:** `FleetHost` gần như đã độc lập host. Không dính ASP.NET; phụ thuộc Microsoft duy nhất là
`ILogger<FleetHost>`. Hai chỗ níu lại EngineApi:
- **`IAssetRegistry`** — *tuỳ chọn*, mặc định `null`, dùng bắn-và-quên ở đúng một chỗ (`:452`).
- **Các DTO** (`FleetSnapshotDto`, `MachineDetailDto`, `SettingsDto`…) ở `EngineApi/Fleet/Dtos.cs`.

🔴 **E-1 đã liệt kê và con số này SAI: có SÁU, không phải hai** — thiếu `ConnectorRegistry`,
`ConnectorRegistry.ConnectorBinding`, `MachineState`, `ConfigSyncCoordinator` và `SafetySnapshot`. Xem §9.1.

**Không dời DTO xuống.** Tài liệu của chính `ConnectorRegistry` đã cảnh báo đúng chuyện này: đặt một
kiểu có **một** người tiêu thụ thật vào `St4i.EdgeCore` (`net10.0-windows`, bề mặt phụ thuộc nặng,
DPAPI, SDK client nhúng) là **tổng quát hoá đầu cơ, không phải tái sử dụng**. Lõi trả về kiểu miền;
EngineApi chiếu chúng thành DTO.

## 5. 🔴 Điều KHÔNG được đổi khi di chuyển

Những bất biến này đã được chứng minh bằng phép liệt kê ở review toàn nhánh Đợt D. **Một lần dời file
không được phép làm yếu bất kỳ điều nào, và mỗi điều phải được chứng minh lại SAU khi dời** — vị trí
thay đổi thì bằng chứng cũ nói về một cây khác.

- **`AmbiguousDriver` vẫn không với tới được về cấu trúc**, có test chứng minh.
- **Một lệnh ghi cho máy B không thể chạm máy A.** Chứng minh bằng **liệt kê bên gọi**, không phải bằng
  đọc đường hạnh phúc. `SetpointWriteRequest`/`CommandRequest` **không mang mã máy**.
- **`EstopGuardRule` phủ mọi hành động ghi và lệnh.** **HALT không bao giờ là đường an toàn** —
  ISO 13849 Cat 3/4: E-stop thật là nối cứng, phần mềm không bao giờ là đường an toàn.
- **Không gì được dispose hay I/O trong lúc giữ `FleetHost._gate`.** Cả 20 khối `lock` đã được quét
  một lần; sau khi tách phải quét lại **ở cả hai bên đường cắt**.
  🔴 **E-1: bất biến này ĐÃ BỊ VI PHẠM trên cây hiện tại, ba đường, và số khối là 21 chứ không phải 20.**
  Bằng chứng cũ mô tả *thân* các khối `lock`; cả ba vi phạm nằm cách đó một tới ba lời gọi. Xem §9.2 —
  và đừng dùng lại phép quét từ vựng để chứng minh lại nó.
- **Bí mật không bao giờ tới GET, dòng log hay dòng audit** — giữ ra ngoài **về cấu trúc** bằng phép
  tách `SummaryColumns`/`FullColumns`, không phải bằng lọc.

## 6. Phân rã công việc

| # | Nội dung |
|---|---|
| **E-1** | Xác định đường cắt và **chứng minh nó bằng phép liệt kê**: mọi thành viên `FleetHost`, thuộc nhóm nào, ai gọi. Không di chuyển gì. Sản phẩm là bản đồ + danh sách bất biến kèm cách chứng minh lại từng cái. |
| **E-2** | Tách lõi thành thư viện độc lập host. EngineApi chạy trên nó, **hành vi không đổi** — gate là phép kiểm, và `FleetHost` thành lớp mỏng. |
| **E-3** | `EdgeWorker` mọc đường đọc `connectors.json` và chủ sở hữu vòng đời. Từ một-driver-một-pipeline thành N. |
| **E-4** | Giới hạn chiều ghi hiện ra nơi người vận hành gặp nó; census tài liệu; endpoint/RBAC nếu §3 chọn (2). |

**E-1 không di chuyển một dòng nào, và đó là điểm chính.** Đợt D dạy rằng thứ tốn kém nhất là một
khẳng định về phạm vi được đưa ra mà chưa liệt kê.

## 7. Phương pháp — mang nguyên §8.1 của blueprint Đợt D

Đọc `docs/plans/2026-08-02-dotD-modbus-rtu-blueprint.md` §8.1. Năm nguyên tắc cộng ba bổ sung, mỗi cái
kèm phép đo sinh ra nó. Ba cái áp trực tiếp vào đợt này:

- **Nguyên tắc 1** — *"không thể xảy ra" và "không thể kiểm được" đều là khẳng định về giới hạn của
  chính mình khoác áo khẳng định về mã nguồn.* **Bốn** khẳng định như thế đã đổ trong Đợt D trước
  người dựng phản ví dụ **trên một trục khác**.
- **Nguyên tắc 3 + hai bổ sung** — bản sửa và phép quét **cảm giác như một hành động nhưng là hai**
  (bắt được ba người, mỗi người bên trong chính bản sửa của mình); và **bắt đầu từ tập các lệnh trả
  về, không phải từ tên trường** — *"không nằm trong tầm nhìn" là câu trả lời nguy hiểm*.
- **Nguyên tắc 2 + bổ sung mới nhất** — **nói rõ dụng cụ nào tạo ra từng KHẲNG ĐỊNH.** *"Chỉ cách một
  property"* là phát biểu về **sự có sẵn** và không nói gì về **khả năng với tới**; một bản sửa phụ
  thuộc vào cái thứ hai.

## 8. Giới hạn phải nói thẳng khi xong

- **Transport serial vẫn chưa tải một khung tin nào trên phần cứng thật.** Đúng sau Đợt D, phải vẫn
  đúng sau đợt này. Không tài liệu, báo cáo hay commit nào được để người đọc hiểu khác.
- Chỉ adapter RS-485 tự động điều khiển DE.
- Máy do tác nhân biên cầm là **chỉ đọc** cho tới khi §3 có đường xuống.
- Một connector bị xoá vẫn để máy trong roster tới lần khởi động lại (dư lượng có biên, có tài liệu).

## 9. 🔴 E-1 ghi lại — những đính chính E-2 phải thừa kế

Toàn văn khảo sát ở `.superpowers/sdd/2026-08-04-dotE-fleet-core-extraction/task-1-report.md`. **Nhưng
`.superpowers/sdd/` bị `.gitignore` bằng `*`, nên không một báo cáo nào của Đợt D còn nằm trong cây git** —
đúng bài học §10 của blueprint Đợt D: *một báo cáo không phải là bản ghi nguồn*. Mục này tồn tại để bốn điều
dưới đây sống sót được đến E-2 kể cả khi không ai đọc báo cáo. **E-1 không sửa một dòng mã sản phẩm nào;
gate đứng nguyên 151/22/1072/28/1282 = 2555, 0 lỗi, 116 cảnh báo, 0 build node.**

### 9.1 §4 đếm thiếu: sáu chỗ níu lại EngineApi, không phải hai
Ngoài `IAssetRegistry` và các DTO còn có **`ConnectorRegistry`** (448 dòng — `StartLocked:1458` dựng một slot
cho mỗi instance từ nó, `ResolveWritableDriver:651` đọc bindings của nó; **một lõi không thấy nó không phải là
lõi vòng đời**), **`ConnectorRegistry.ConnectorBinding`**, **`MachineState`** (364 dòng, *phải tách đôi*: giữ
trạng thái sống *và* chiếu ra `FleetTileDto`/`MachineDetailDto`), **`ConfigSyncCoordinator`**, và
**`SafetySnapshot`**. Kéo theo: nếu E-3 muốn EdgeService chủ trì connector thì còn **~2 900 dòng** hạ tầng
config connector nữa (`ConnectorsConfig` 274, `ConnectorsJsonRegistration` 286, `ModbusMultidropRegistration`
344, `ConnectorConfigStore` 1064, `ConnectorConfigValidation` 254, `RtuBusConfiguration` 501) mà §6 không tính.

### 9.2 §5 bất biến `_gate`: ba vi phạm có sẵn, và số khối là 21
1. `StartLocked:1367` gọi `MappingProfileResolver.Build` → `File.Exists` + `File.ReadAllText` **mỗi máy**;
   cả ba caller (`Start:920`, `RegisterMachine:1976`, `ApplyScenario:2016`) đều giữ `_gate`. `Estop()` lấy
   cùng khoá đó.
2. `StopLocked:1691` gọi `slot.Cts.Cancel()`, chạy **đồng bộ trên chính thread đó** callback
   `ModbusTcpDriver.PollOnceAsync:350`'s `ct.Register(DisposeConnection)` → `_master.Dispose()` +
   `_tcpClient.Dispose()`. Chú thích `:1661` đã mô tả đúng cơ chế này rồi kết luận nhầm rằng chỉ một callback
   *ném* mới nguy hiểm — nó không nhận ra callback ấy chính là một `Dispose`.
3. `RegisterMachine:1963` chạy `_ = _assetRegistry?.UpsertAsync(descriptor)` **bên trong `lock (_gate)`**.
   `_ =` cộng hậu tố `Async` đọc như bắn-và-quên; **nó không phải**. Đo trên máy này với đúng phiên bản gói
   repo ghim (Microsoft.Data.Sqlite 10.0.10): `SqliteConnection.OpenAsync`/`SqliteCommand.ExecuteNonQueryAsync`
   đều là shim đồng bộ của lớp cơ sở, `IsCompleted == true` ngay, và một `open + insert` viết y hệt
   `UpsertAsync` chạy trọn vẹn trên thread gọi. Tức là **cả một giao dịch SQLite chạy trong lúc giữ `_gate`**.
   Không test nào bắt được: `_assetRegistry` mặc định `null` và **mọi** test dựng `FleetHost` đều để nó null.

**Cả ba đều có TRƯỚC Đợt E.** Khuyến nghị: xếp thành một hạng mục riêng, **không** gộp vào E-2 — gộp vào sẽ
làm hợp đồng "hành vi không đổi, gate là phép kiểm" của E-2 thành không đúng, và đó đúng là hình dạng
"bản sửa và phép quét cảm giác như một hành động nhưng là hai" của Đợt D §8.1.

### 9.3 Đường cắt tạo ra một thứ tự khoá mới, và nó nằm trên đường an toàn
`_gate` là `Monitor` (tái nhập). `IsRunning` — bản thân nó là một getter `lock (_gate)` — được gọi **bên
trong** tám vùng đang giữ `_gate` (`:549`, `:919`, `:921`, `:965`, `:967`, `:1242`, `:1822`, `:1881`, `:1965`,
`:2003`). Sau khi cắt, mỗi chỗ đó thành một lời gọi **qua ranh giới**. Hệ quả nặng nhất:
`GetSafetyStatus()` trả `SafetySnapshot(_estopEngaged, IsRunning)` trong **một** lần lấy khoá, và nó là
**đầu vào duy nhất** của `EstopGuardRule` — thứ chặn `machine.setpoint.write`/`machine.command.invoke` khi
HALT đang gài. Tách thành **hai** lần đọc thì cặp ấy hết nguyên tử: `_estopEngaged` lấy trước một `Estop()`
đồng thời, `IsRunning` lấy sau — latch báo *đã nhả* đúng khoảnh khắc nó vừa gài, và lệnh ghi lọt qua.
→ **`GetSafetyStatus` phải đi CÙNG `_gate`, và `SafetySnapshot` phải đi cùng nó.**
→ Và đây là điều phải làm **trước** khi dời: hôm nay đột biến "tách thành hai lần đọc" **SỐNG SÓT** cả 2555
test. Bất biến quan trọng nhất của §5 hiện **không có phép kiểm nào**. E-2 phải viết bài test đua
(`Estop()` một thread, vòng lặp ghi thread kia, khẳng định **không** lệnh ghi nào đáp sau khi latch gài),
xác nhận nó giết được đột biến ấy, rồi mới dời.

### 9.4 Hai thứ hỏng lúc chạy mà không hỏng lúc biên dịch — loại đáng sợ
1. **`AppContext.BaseDirectory` lặng lẽ trỏ chỗ khác.** `ResolveFleetPath:2389` tìm `fleet.json` cạnh exe;
   `StartLocked:1367` tìm `mapping/` cạnh exe. `St4i.EngineApi.csproj` ship cả `fleet.json`,
   `connectors.json` và `mapping/*.json`; **`St4i.EdgeService.csproj` không ship cái nào**. Cùng mã, cùng
   assembly, chạy trong EdgeService thì roster **rỗng** và mọi máy rơi về `MappingProfile.ForClass` —
   không ngoại lệ, không cảnh báo nêu đúng nguyên nhân (`MappingProfileResolver` cố ý không bao giờ ném).
   Thêm nữa, `EdgeWorker.cs:328–418` **đã có** `LoadFleet`/`BuildDefaultFleet` riêng đọc **cùng cờ `--fleet`**
   và trả **roster mặc định khác** (8 máy vs 10). Sau E-3, hai bộ đọc ấy ở chung một tiến trình.
2. 🔴 **Hai tiến trình, một bộ file dữ liệu toàn máy.** `AssetRegistryStore.DefaultRoot`,
   `CredentialStore.DefaultRoot` và `FleetSettingsStore.DefaultRoot` đều là `%ProgramData%\ST4I\sim\…`,
   **không có khoá theo tiến trình**, chỉ đổi được bằng biến môi trường. `FleetSettingsStore` giữ **một**
   bộ ba `(ServerUrl, MachineCode, VerifyTls)` và `UpdateSettings:2269` ghi đè mỗi lần đổi → **ai ghi sau
   thắng**, và lần khởi động sau mỗi host đọc giá trị của host kia. **Đây đúng là bản sao ở tầng FILE của
   chính lỗ hổng §2 dựng ra để bịt** — §2 đã đo yêu sách mã máy và chọn hình dạng tác nhân biên để tránh nó
   *về cấu trúc*; phép đo ấy chưa từng chạy trên các thư mục dữ liệu, và hình dạng tác nhân biên **không**
   tránh được nó. E-3 phải hoặc cho lõi một gốc thư mục theo host, hoặc truyền cả ba biến môi trường.

### 9.5 Ba điều nhỏ hơn, ghi để khỏi phải tìm lại
- **NU1605 không áp cho phép tách.** Nếu lõi hạ xuống **`St4i.EdgeCore`** thì `St4i.EdgeService`
  **đã tham chiếu sẵn** — không cạnh tham chiếu mới, không rủi ro restore. §4 đã ngụ ý đích đến này mà
  chưa bao giờ phát biểu nó thành quyết định; **E-2 nên phát biểu.**
- **`St4i.EdgeCore` không có một tham chiếu `ILogger` nào** (quy ước của nó là `Action<string>? logWarning` /
  `Action<Exception,string>? logError`). Nên tám lời gọi `_logger?.` của lõi phải đổi sang callback — **đúng
  hình dạng cú pháp của lỗi Critical D-7a**, và hai trong tám nằm ngay cạnh trạng thái cơ chế
  (`_connectorStartIssues` ở `:1504`/`:1516`, `LastError` ở `:1600`/`:1619`). Sau khi port, chạy đột biến:
  đưa lệnh gán vào **trong đối số** của lời gọi log rồi dựng lõi **không** kèm callback —
  `FleetHostConnectorVisibilityTests` phải ĐỎ.
- **Hai chỗ khử bí mật của `FleetHost` không có test nào.** `TryWriteSetpointAsync:803` và
  `TryInvokeCommandAsync:839` cố ý phát `ex.GetType().Name` chứ không bao giờ `ex.Message`; đổi thành
  `ex.Message` thì **toàn bộ 2555 test vẫn xanh** (grep `"did not complete cleanly"` trong `tests/`: rỗng).
- **Bảng §1**: `ConnectorsJsonRegistration` là **286** dòng (không phải 302), `ModbusMultidropRegistration`
  là **344** (không phải 318). Năm số còn lại đúng.
