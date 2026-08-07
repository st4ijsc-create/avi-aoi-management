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
- **Không gì được dispose hay I/O trong lúc giữ `FleetHost._gate`.** Cả **21** khối `lock` (không phải 20 —
  review E-1 đếm lại và con số 21 đã đúng từ commit merge Đợt D) đã được quét một lần; sau khi tách phải
  kiểm lại **ở cả hai bên đường cắt**, **bằng một cuộc đi bộ theo khả năng với tới, không bằng phép quét
  từ vựng** — chính phép quét từ vựng đã báo cáo bất biến này còn nguyên trong khi nó đã hỏng ba đường.
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
   Không test nào bắt được.
   🔴 **Đính chính (review E-1): câu bằng chứng ở trên SAI, kết luận thì đúng.** *Hai* test **có** truyền
   `IAssetRegistry` — `FleetHostModbusRosterTests.cs:165` và `FleetHostOpcUaRosterTests.cs:164`, qua một
   `FakeAssetRegistry`. Phát biểu đúng là: **không test nào truyền một `AssetRegistryStore` THẬT.** Cái fake
   là một `ConcurrentDictionary` đồng bộ trả `Task.CompletedTask`; nó không chạm SQLite và không phân biệt
   nổi đồng bộ với bất đồng bộ — tài liệu của chính nó nói vậy. Một khoảng trống được khẳng định mà chưa
   kiếm được, đúng lớp lỗi mục này đang mô tả.
   🔴 **Và có chỗ thứ TƯ mà E-1 bỏ sót:** `FleetHost.cs:455`, trong vòng gieo roster của hàm dựng. **Không**
   phải vi phạm `_gate` (hàm dựng không lấy khoá) — nhưng là N giao dịch SQLite đồng bộ **bên trong hàm dựng
   của một DI singleton**, cùng cơ chế, cùng phép đo.

**Đo được, không phải suy ra** (reviewer chạy trên `AssetRegistryStore` **thật**, không phải trên một kiểu
cùng hình dạng): `MappingProfileResolver.Build` giữ `_gate` **2,39 ms** với 50 máy có mapping file trên SSD
cục bộ; `RegisterMachine` ×100 tốn **0,1 ms** khi registry null và **7,1 ms** khi có store thật; và một
thread chỉ đọc `host.EstopEngaged` — **cùng cái khoá `Estop()` lấy** — bị chặn tới **12,35 ms**, tức ~300×.

**Cả ba đều có TRƯỚC Đợt E.** Khuyến nghị: xếp thành một hạng mục riêng, **không** gộp vào E-2 — gộp vào sẽ
làm hợp đồng "hành vi không đổi, gate là phép kiểm" của E-2 thành không đúng, và đó đúng là hình dạng
"bản sửa và phép quét cảm giác như một hành động nhưng là hai" của Đợt D §8.1.

🔴 **Hai điều kiện review đặt lên E-2, không hoãn được:**
1. **E-2 không được làm nó tệ hơn.** Hạng mục nghiệm thu: đường cắt **không được tăng** số thao tác I/O hoặc
   `Dispose` với tới được khi đang giữ `_gate`.
2. **Phép kiểm lại phải là một cuộc đi bộ theo khả năng với tới, ba chặng, ở CẢ HAI bên đường cắt — không
   bao giờ là một phép quét từ vựng thân khối `lock`.** Một phép quét từ vựng đã cho ra câu trả lời sai
   đúng một lần rồi: nó là thứ đã báo cáo bất biến này còn nguyên.

### 9.3 Đường cắt tạo ra một thứ tự khoá mới, và nó nằm trên đường an toàn
`_gate` là `Monitor` (tái nhập). `IsRunning` — bản thân nó là một getter `lock (_gate)` — được gọi **bên
trong** tám vùng đang giữ `_gate` (`:549`, `:919`, `:921`, `:965`, `:967`, `:1242`, `:1822`, `:1881`, `:1965`,
`:2003`). Sau khi cắt, mỗi chỗ đó thành một lời gọi **qua ranh giới**. Hệ quả nặng nhất:
`GetSafetyStatus()` trả `SafetySnapshot(_estopEngaged, IsRunning)` trong **một** lần lấy khoá, và nó là
**đầu vào duy nhất** của `EstopGuardRule` — thứ chặn `machine.setpoint.write`/`machine.command.invoke` khi
HALT đang gài. Tách thành **hai** lần đọc thì cặp ấy hết nguyên tử: `_estopEngaged` lấy trước một `Estop()`
đồng thời, `IsRunning` lấy sau — latch báo *đã nhả* đúng khoảnh khắc nó vừa gài, và lệnh ghi lọt qua.
→ **`GetSafetyStatus` phải đi CÙNG `_gate`, và `SafetySnapshot` phải đi cùng nó.**

### 🔴 9.3b Đính chính §9.3 (review E-1) — kết luận ĐÚNG, cơ chế SAI, và cơ chế mới là thứ E-2 đọc

Đoạn trên đúng ở kết luận và **sai ở lý do**. Reviewer dựng phản ví dụ **trên một trục khác** thay vì suy lại:

| Đột biến | Kết quả |
|---|---|
| tách một lần khoá thành **hai lần đọc** | **SỐNG SÓT** 1282/1282 |
| thay `IsRunning` trong snapshot bằng **`true` cứng** (hỏng hoàn toàn, không phải đọc rách) | **SỐNG SÓT** 1282/1282 |

Phép liệt kê giải thích vì sao. Toàn bộ nơi đọc bất kỳ thành viên nào của `SafetySnapshot` trong `src/`:
- `Policy/Rules/EstopGuardRule.cs:47` — **chỉ** `request.Safety.EstopEngaged`.
- `Safety/SafetyEndpoints.cs:34` — cả hai trường, nhưng để **chiếu ra `GET /v1/safety`**, tức hiển thị.

**`SafetySnapshot.IsRunning` không có người tiêu thụ nào trên đường an toàn**, và `EstopGuardRule` là rule
duy nhất đọc `Safety`. Nên tách lần lấy khoá **không** làm `_estopEngaged` cũ đi — nó chỉ làm `IsRunning`
đến từ một khoảnh khắc muộn hơn. Câu *"latch báo đã nhả đúng lúc nó vừa gài và lệnh ghi lọt qua"* mô tả một
**TOCTOU giữa lúc `GetSafetyStatus()` trả về và lúc lệnh ghi đáp** — thứ **đã tồn tại hôm nay**, với một lần
lấy khoá, không đổi. Vết rách duy nhất quan sát được là `(true, true)` thoáng qua, một trạng thái không bao
giờ thực sự tồn tại, và nó làm sai một **màn hình**, không làm lọt một lệnh ghi.

**Giá phải trả nếu không đính chính:** §9.3 bảo E-2 *"viết bài test đua, xác nhận nó giết được đột biến ấy,
rồi mới dời"*. **Không làm được.** Bài test đua không thể giết đột biến hai-lần-đọc, vì đột biến ấy không
đổi thứ mà guard nhìn thấy. E-2 làm theo đúng chữ sẽ viết một bài test đúng và có giá trị, thấy nó xanh dưới
đột biến, rồi phải đoán xem test rỗng hay đột biến vô hại.

**Cái sống sót thì mạnh hơn cái đổ.** *"Bất biến quan trọng nhất của §5 không có phép kiểm nào"* là **đúng, và
đột biến thứ hai làm nó mạnh hơn E-1 tuyên bố**: `SafetySnapshot.IsRunning` không phải "chưa được kiểm tính
nguyên tử" — nó **hoàn toàn không có nhân chứng nào**. Bài test đua E-1 đề xuất vẫn là bài test đúng cho
**TOCTOU** — một tính chất an toàn có thật, có sẵn, chưa được kiểm. Nó chỉ không phải bài test canh đường cắt.

→ **E-2 vẫn dời `GetSafetyStatus` + `SafetySnapshot` cùng `_gate`** — nhưng trên lý do đúng: *một phép đọc
cặp qua hai lần lấy khoá là mối nguy tiềm ẩn kể từ khoảnh khắc có bất kỳ ai đọc cả hai trường*, chứ không
phải vì hôm nay có lệnh ghi lọt qua.

→ **Và hai bài test phải viết, không phải một:** (a) một nhân chứng cho `SafetySnapshot.IsRunning` — bất cứ
thứ gì giết được `true` cứng; (b) bài test đua cho TOCTOU, ghi rõ nó canh cái gì và **không** canh đường cắt.

**Hình dạng của cái sai này đáng giữ hơn bản thân nó.** E-1 phát biểu §9.3 *bằng giọng của một phép liệt kê*,
nhưng nó được sinh ra từ việc **soi hình dạng một phương thức mà không liệt kê những người tiêu thụ bản ghi
phương thức ấy trả về** — đúng quy tắc *"bắt đầu từ tập các thành viên, không phải từ một tên kiểu"* mà chính
E-1 áp dụng xuất sắc ở §3.3 và §6.1, nhưng không áp lên chính mình. Hai đột biến và năm phút grep lật được nó.

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
  `Action<Exception,string>? logError`). Nên các lời gọi `_logger?.` của lõi phải đổi sang callback — **đúng
  hình dạng cú pháp của lỗi Critical D-7a**, và hai trong số đó nằm ngay cạnh trạng thái cơ chế
  (`_connectorStartIssues` ở `:1504`/`:1516`, `LastError` ở `:1600`/`:1619`). Sau khi port, chạy đột biến:
  đưa lệnh gán vào **trong đối số** của lời gọi log rồi dựng lõi **không** kèm callback —
  `FleetHostConnectorVisibilityTests` phải ĐỎ.
  🔴 **Đính chính (review E-1): là MƯỜI BỐN chỗ, không phải tám** — `FleetHost.cs:799, 835, 1371, 1372, 1504,
  1573, 1600, 1697, 1751, 1763, 2347, 2352, 2365, 2369` — và theo đúng danh sách cắt của chính E-1, **cả mười
  bốn** nằm trong các thành viên đi cùng lõi. Con số tám hụt **75%** bề mặt mà hình dạng `?.` đoản mạch của
  D-7a có thể tái diễn. Đếm sai một bề mặt rủi ro theo hướng thấp hơn là cách một phép quét trở thành nghi lễ.
  (Chữ nghĩa: EdgeCore có 8 chỗ nhắc `ILogger` **trong chú thích**, và `Microsoft.Extensions.Logging` có mặt
  bắc cầu qua `OPCFoundation…Opc.Ua.Client`. Ý thì đúng: không `using`, không dùng kiểu, không
  `PackageReference` trực tiếp.)
- **Hai chỗ khử bí mật của `FleetHost` không có test nào.** `TryWriteSetpointAsync:803` và
  `TryInvokeCommandAsync:839` cố ý phát `ex.GetType().Name` chứ không bao giờ `ex.Message`; đổi thành
  `ex.Message` thì **toàn bộ 2555 test vẫn xanh** (grep `"did not complete cleanly"` trong `tests/`: rỗng).
- **Bảng §1**: `ConnectorsJsonRegistration` là **286** dòng (không phải 302), `ModbusMultidropRegistration`
  là **344** (không phải 318). Năm số còn lại đúng.

### 🔴 9.6 Review E-1 — bốn đính chính nữa, và ba trong số đó nói rằng "cái lá" không phải lá

**a) Ba trong sáu chỗ níu KHÔNG phải nút lá, và §9.1 không nói điều đó.** `ConfigSyncCoordinator` kéo theo
`SwitchableConfigSyncBackend`/`SimulatedEcosystem`/`LiveConfigSyncBackend`/`IConfigSyncBackend`;
`IAssetRegistry` kéo `AssetRecord`/`AssetLifecycleState`; và nặng nhất: **`MachineState.cs` với `Dtos.cs`
móc vào nhau HAI CHIỀU** — `MachineState` trả `FleetTileDto`/`MachineDetailDto`, còn `Dtos.cs` tiêu thụ
`CycleLogEntry`/`TelemetrySeriesDto`/`SpcSummaryDto`/`BoardPointDto` **khai báo bên trong `MachineState.cs`**.
Thêm nữa **`Dtos.cs` không tự chứa**: `:252,253,256,280,281` tham chiếu bốn kiểu trong `ConnectorConfigStore.cs`
(1 064 dòng).
→ **Quyết định "để DTO ở lại" của §4 chỉ đứng vững nếu `Dtos.cs` được TÁCH ĐÔI, không phải để nguyên.**
Đó là công việc E-2 phải tính, không phải phát hiện lúc đang cắt.

**b) `ConnectorRegistry` được lõi đọc ở BỐN chỗ, không phải hai** — thêm `StartLocked:1337`
(`SnapshotBindings`, bộ lọc loại trừ sim) và `ResolveSlotLabelFor:1128` (`RegisteredIds`). Câu *"một lõi
không thấy nó không phải lõi vòng đời"* nếu có gì thì là **nói nhẹ đi**.

**c) Ba dòng điều tra sai, và hai trong số đó nói ngược lại chính chú thích của E-1.**
`CurrentProductFor:2204` **có** caller sản xuất — truyền dạng method group tại `StartLocked:1340`.
`ResolveFleet:2343` được gọi từ `LoadFleet:2316` **mỗi lần khởi động**. `DefaultLanguage:156` **không chết** —
nó được dùng ngay trong `FleetHost` tại `:401`. Chỉ `GetMachineDriverAvailability` và `SetCurrentProduct` là
thật sự không có caller sản xuất.
→ Và về `GetMachineDriverAvailability`, sự thật sắc hơn: sản xuất **có** dùng enum `MachineDriverAvailability`
(`MachineWriteEndpoints.cs:223,293`, `RelayNotificationChannel.cs:881,891`) — nhưng qua
`TryWriteSetpointAsync`/`TryInvokeCommandAsync`, vốn đọc hàm **private** `ResolveWritableDriver:633`. Enum và
hàm private chịu lực; **cái wrapper public là một quyết định, không phải một điều kiện cho sẵn.**

**d) Hạng mục nghiệm thu bắt buộc, trước khi dời hai thành viên ghi:** viết khẳng định khử bí mật ở §9.5
**trước** khi `TryWriteSetpointAsync`/`TryInvokeCommandAsync` rời chỗ. Đột biến ấy **đỏ hôm nay** và bản sửa
rẻ; dời một thành viên không có nhân chứng là cách một tính chất biến mất mà không ai thấy.

**e) Số dòng hạ tầng config connector là 2 723, không phải ~2 900.** Sáu con số thành phần đều đúng.

## 10. 🔴 E-2 ghi lại — cái gì đã dời, và những gì E-3 phải thừa kế

Toàn văn ở `.superpowers/sdd/2026-08-04-dotE-fleet-core-extraction/task-2-report.md`. Mục này tồn tại vì
`.superpowers/sdd/` bị gitignore và **một báo cáo không phải bản ghi nguồn** — mọi điều dưới đây phải sống sót
đến E-3 kể cả khi không ai đọc báo cáo.

**Commit:** `1a47dca8` (cuộc dời) và `8ecb2f47` (ba nhân chứng), nhánh `feat/fleet-core-extraction`.

### 10.1 Hình dạng đã dựng — và cái nó khoá lại cho E-3

`St4i.EdgeCore.Fleet.FleetCore` giữ toàn bộ thân cũ của `FleetHost`: vòng đời N-driver, roster, phân giải slot,
đường ghi, health/KPI, **cơ chế** kịch bản, các trường settings, và **`_gate`**. Cùng xuống: `ConnectorRegistry`
+ `ConnectorBinding`, `MachineState`, `SafetySnapshot`, `DriverHealthSnapshot`, `MachineDriverAvailability`.
Ở lại `St4i.EngineApi`: mọi DTO và phép chiếu, **danh mục preset** kịch bản, `ResilienceProbe`, `IAssetRegistry`,
`ConfigSyncCoordinator`, `ILogger`, toàn bộ `Endpoints/`.

🔴 **`FleetHost` KHÔNG GIỮ KHOÁ NÀO, và đó là điều chịu lực.** §3.2 của E-1 liệt kê hai hình dạng cho đường cắt
và kết luận cả hai đều tệ. **Có hình dạng thứ ba, và đây là nó: một khoá duy nhất, và không còn một phép đọc
cặp nào ở phía bên kia đường cắt.** Mọi thành viên từng đọc hai trường được `_gate` bảo vệ trong MỘT lần lấy
khoá đã xuống nguyên khối — `GetSafetyStatus`, `Snapshot`→`ReadSnapshot`, `GetSettings`, phép so `wasRunning`
của `Start`/`Stop`, `RegisterMachine`, `ApplyScenario`. **Luật cho E-3: đừng bao giờ thêm vào `FleetHost` một
thành viên đọc HAI thứ từ lõi rồi ghép lại** — đó chính là hình dạng xấu thứ nhất của E-1, dựng lại. Hãy phân
giải cặp ấy bên trong `FleetCore` và trả về một record.

**Ba thứ §4 xếp "Ở LẠI" nhưng không thể ở lại** (E-1 §1.4 đúng): `ApplyScenario`, `Burst`,
`RunHotFolderAoiDemoAsync`. Cả ba đổi trạng thái lõi dưới khoá của lõi; chỉ vỏ DTO của chúng ở lại.

### 10.2 🔴 Số khối `lock (_gate)` là **20**, không còn là 21 — và chỗ mất đi là chỗ nào

§9.2 ghi 21. Sau cuộc cắt là **20**, xác định bằng một bộ đếm khớp ngoặc chạy trên cả hai cây (không phải bằng
grep): khối duy nhất biến mất là của **`MachineDetail`**, mà thân nó đúng một lệnh — `isRunning = IsRunning;` —
tức một phép đọc của một getter *đã* `lock (_gate)`. `MachineDetail` là thành viên SPLIT (E-1 §1.4 mục 5): nửa
vòng đời là "đọc `IsRunning`", nửa chiếu ra là `state.ToDetail(isRunning)`. Tách ra thì nửa vòng đời đúng bằng
`_core.IsRunning`. Bọc thêm một `lock` ở phía vỏ chính là **thêm một khoá cho vỏ** — điều §10.1 cấm. Một lần
lấy khoá tái nhập dư thừa bị bỏ; giá trị không đổi, hành vi không đổi.

### 10.3 Ba vi phạm `_gate` của §9.2 **VẪN CÒN NGUYÊN**, và cuộc đi bộ ba chặng nói gì

Đi bộ theo khả năng với tới, ba chặng, **ở cả hai bên**, bắt đầu từ *tập các lệnh chạy dưới khoá* (kể cả bốn
helper giả định caller giữ khoá: `StartLocked`/`StopLocked`/`StartSlot`/`ApplyNetworkOutageLocked`), **không
phải** từ thân các khối `lock`. Cả ba vi phạm còn nguyên, ở đúng chỗ cũ, cùng số lượng:

1. `StartLocked` → `MappingProfileResolver.Build` → `File.Exists`/`File.ReadAllText` mỗi máy.
2. `StopLocked` → `slot.Cts.Cancel()` → callback `ct.Register` của driver chạy `Dispose` **đồng bộ**.
3. `RegisterMachine` → `_onMachineSeeded?.Invoke` → (vỏ) `_ = assetRegistry.UpsertAsync(d)` → giao dịch SQLite
   đồng bộ. Chỗ thứ tư trong hàm dựng (§9.2 note 4) cũng còn nguyên, cũng không phải vi phạm khoá.

**Số thao tác không tăng, đo bằng dụng cụ chứ không bằng đọc:** một bộ phân tích khớp ngoặc đếm những điểm mà mã
**do host cung cấp** với tới được khi đang giữ `_gate`, chạy trên cả cây trước (`5f2b8883`) và cây sau —
**6 điểm trước, 6 điểm sau, tương ứng 1-1**: `1371→1476`, `1372→1477` (callback của `MappingProfileResolver`),
`1504→1609` (cảnh báo connector không khởi động), `1600→1703` (slot faulted, nằm trong lambda `Task.Run` của
`StartSlot` — bộ phân tích *cố tình* đánh giá thừa ở đây, và đánh giá thừa **y hệt** ở cả hai bên),
`1697→1800` (callback huỷ ném), `1963→2057` (upsert roster). Không thêm một thao tác nào.

🔴 **Nhưng cuộc đi bộ tìm ra một đường I/O THỨ TƯ mà §9.2 không liệt kê, và nó CÓ TRƯỚC Đợt E.** Ba trong sáu
điểm trên là **lời gọi ghi log chạy khi đang giữ `_gate`** (hai callback của `MappingProfileResolver`, cảnh báo
connector trong `StartLocked`, và callback-ném trong `StopLocked`). Trước cuộc cắt đó là
`_logger?.LogWarning/LogError` ở **đúng những điểm ấy** — nên đây không phải cái E-2 tạo ra, và nó không tăng.
Nhưng ghi log **có thể là I/O đồng bộ**, và ở đúng cấu hình sản phẩm thì gần như chắc chắn là: `Program.cs:61`
gọi `AddWindowsService(...)`, thứ đăng ký `EventLogLoggerProvider` khi tiến trình chạy như một Windows Service,
và `EventLogLogger` ghi **đồng bộ**. Tức là **một dòng log có thể chặn `Estop()`**.
**Dụng cụ: [READ] trên `Program.cs` cộng [READ] trên hành vi framework — CHƯA ĐO.** Phép đo mà ai đó xếp lịch
cho hạng mục sửa `_gate` phải bao gồm cả đường này, không chỉ ba đường của §9.2.

### 10.4 Mười bốn lời gọi log đã port — và một sự trôi mức nghiêm trọng, có chủ đích

Mười bốn chỗ `_logger?.` (§9.5, con số đã đính chính) chuyển sang quy ước của EdgeCore. **Vỏ truyền `null` cho
cả hai callback khi nó không có `ILogger`**, chứ không truyền một lambda ôm lấy một logger null — nếu không, lỗi
Critical D-7a sẽ thành **không thể kiểm được**, vì sẽ không còn cách nào dựng lõi mà không kèm callback. Đột
biến D-7a (đưa `_connectorStartIssues[id] = err` vào **trong đối số** của lời gọi log) đã chạy: **GIẾT 2/3
`FleetHostConnectorVisibilityTests`.**

🔴 **Trôi mức nghiêm trọng, ghi ra vì nó là thay đổi quan sát được duy nhất của cuộc dời.** Quy ước EdgeCore chỉ
có HAI kênh. Bốn chỗ chỉ-có-thông-điệp đều là `LogWarning` và vẫn là `LogWarning`. Mười chỗ mang exception
trước đây là **5 `LogWarning` + 2 `LogError` + 3 `LogDebug`**; cả mười giờ tới nơi dưới dạng **`LogError`**.
Không hành vi sản phẩm, không test, không endpoint nào quan sát điều này — nhưng **ba dòng dọn dẹp tốt-nhất-nỗ-lực
giờ hiện ra ở mức Error**, và một người vận hành đọc log sẽ thấy khác. Nếu muốn khôi phục độ mịn, cách rẻ nhất
là một callback thứ ba (`WalFlushPump` đã có tiền lệ với `logInfo`); E-2 không làm, vì thêm kênh log trong một
cuộc dời đúng là thứ scope creep brief cấm.

### 10.5 `InternalsVisibleTo`, và vì sao nó KHÔNG mâu thuẫn với ghi chú cũ trong `AssemblyInfo.cs`

`St4i.EdgeCore/AssemblyInfo.cs` giờ mang **đúng một** entry: `InternalsVisibleTo("St4i.EngineApi")` — lần
đầu kể từ ghi chú SM-1b, và nó là tới một **assembly sản phẩm ngang hàng**. (Một entry thứ hai tới
`St4i.EngineApi.Tests` đã được viết ra, kiểm lại thấy **không gì với tới nó** — test chạm ba seam qua các
forwarder `internal` của chính `FleetHost`, vốn đã được `InternalsVisibleTo` sẵn có của `St4i.EngineApi` phủ —
nên nó bị xoá. Một IVT không ai dùng đúng là kiểu nới rộng đầu cơ mà file ấy phản đối, chỉ khó thấy hơn.) Lý do đầy đủ nằm trong chính file đó. Tóm tắt: ba seam
(`DriverDecoratorForTests`, `AdditionalPipelinesForTests`, `ResolveFleet`) là **cách bất biến "`AmbiguousDriver`
không với tới được" của §5 được CHỨNG MINH**; phương án thay thế — cho chúng `public` trên EdgeCore — **rộng hơn
hẳn**, vì nó phơi ba seam chỉ-dành-cho-test ra cho `St4i.EdgeService` (đúng cái host E-3 dựng, và là host tuyệt
đối không được có đường tiêm slot), cho WPF, và cho mọi host tương lai. Ca `DemoModeGate` khác thật: ở đó **đã
có sẵn** một ctor `public` phục vụ một caller sản xuất thật, nên IVT sẽ là lối tắt vòng qua một API vốn đã đúng.

🔴 **E-3 phải giữ điều này:** đừng nới ba seam ấy thành `public` cho tiện. Nếu `EdgeWorker` cần tiêm driver, nó
cần một seam **của riêng nó**, thiết kế cho một host sản xuất — không phải cái cửa mà test dùng.

### 10.6 Những gì E-3 vẫn phải đối mặt, chưa hề nhẹ đi

- **§9.4(1) `AppContext.BaseDirectory`.** `St4i.EdgeService.csproj` **vẫn không ship** `fleet.json`,
  `connectors.json` hay `mapping/*.json`. Cùng mã, cùng assembly, chạy trong EdgeService thì roster **rỗng** và
  mọi máy rơi về `MappingProfile.ForClass`, **không ngoại lệ, không cảnh báo nêu đúng nguyên nhân**. E-2 không
  đổi gì ở đây — nó chỉ làm cho mã ấy với tới được từ EdgeService, tức làm cái bẫy **chạm tới được**.
- **§9.4(1) hai bộ đọc `--fleet`.** `EdgeWorker.LoadFleet` (8 máy mặc định) và `FleetCore.LoadFleet` (10 máy)
  đọc cùng một cờ từ cùng `Environment.GetCommandLineArgs()`. Sau E-3 cả hai ở chung một tiến trình. **Chưa
  chạm tới.**
- **§9.4(2) hai tiến trình, một bộ file dữ liệu toàn máy.** `AssetRegistryStore`/`CredentialStore`/
  `FleetSettingsStore` vẫn `%ProgramData%\ST4I\sim\…`, không khoá theo tiến trình. `FleetCore.UpdateSettings`
  vẫn ghi đè một bộ ba duy nhất → **ai ghi sau thắng**. **Chưa chạm tới, và E-2 làm nó gần hơn một bước.**
- **§3 chiều ghi.** `TryWriteSetpointAsync`/`TryInvokeCommandAsync` giờ nằm trên một **thư viện** mà bất kỳ host
  nào cũng tham chiếu được, và **không có gì bên trong chúng hỏi chốt HALT** — guard nằm trọn ở hai caller
  (E-1 §5.4). 🔴 **E-3 không được để lộ hai thành viên này ra từ EdgeService.** Hình dạng "máy do tác nhân biên
  cầm là chỉ đọc" của §3 vì thế là **ràng buộc cấu trúc**, không phải một giới hạn tài liệu.
- **§9.1 ~2 723 dòng hạ tầng config connector** (`ConnectorsConfig`, `ConnectorsJsonRegistration`,
  `ModbusMultidropRegistration`, `ConnectorConfigStore`, `ConnectorConfigValidation`, `RtuBusConfiguration`)
  **vẫn ở `St4i.EngineApi`**. E-2 chỉ dời `ConnectorRegistry` — cái mà lõi *đọc*. Nếu E-3 muốn EdgeService tự
  chủ trì connector từ `connectors.json`, đó là khối lượng còn lại, và §6 chưa tính nó.
- **E-1 §2.3, bản sao `MinCycleSeconds`.** Ba bản của `0.05` giờ nằm trong **cùng một assembly**, và lý do được
  ghi cho việc nhân bản ("mirrored, not shared — EdgeCore doesn't reference EngineApi") đã **sai**. E-2 sửa cả
  ba chú thích và **cố ý không gộp**: `FleetCore.MinCycleSeconds` chặn `CycleSeconds` của một descriptor roster
  trong lúc `StartLocked` nhân nó với scenario multiplier, còn `MinCycleSecondsFloor` của sim chặn một cadence
  mà sim tự tính từ config sống và **bỏ qua descriptor ấy hoàn toàn**. Gộp một symbol sẽ buộc hai phép chặn độc
  lập vào nhau và đọc như một sự ràng buộc không tồn tại.

### 10.7 Con số duy nhất đã dịch, và bằng chứng rằng cuộc dời không dịch gì

**Cuộc dời tự nó dịch 0.** Nó được commit và chạy cổng RIÊNG, ở đúng `151/22/1072/28/1282 = 2555`, 0 lỗi,
**116 cảnh báo**, 0 build node (`1a47dca8`). Đó là phép kiểm brief yêu cầu, và nó chỉ đọc được vì hai bài test
được commit tách ra.

Sau đó `EXPECT_ENGINEAPI` 1282 → **1283**, tổng 2555 → **2556**, do **đúng một** `[Fact]` mới:
`Safety/EstopLatchVisibilityRaceTests` (§9.3b). Hai nhân chứng bắt buộc còn lại tốn **0**: nhân chứng
`SafetySnapshot.IsRunning` là hai khẳng định trong `RelayNotificationChannelTests.HaltLatched_…` đã có sẵn, và
khẳng định khử bí mật là các khẳng định trong hai bài test đua-huỷ đã có sẵn ở
`FleetHostMachineDriverResolutionTests`. §9.3b nói rõ *"bất cứ test nào giết được `true` cứng là đủ"*, nên đó là
mức tối thiểu thật, không phải một mẹo kế toán.

### 10.9 🔴 Phát hiện mang sang: một bài test mTLS có cuộc đua tắt máy, và nó cho ĐỎ GIẢ

`St4i.EdgeCore.Tests/Identity/DeviceIdentityStoreTests.Certificate_LoadedFromStore_CanCompleteARealMutualTlsHandshake`
đỏ **một lần** trong các lần chạy cổng của E-2, tại `Assert.True(serverError is null, …)`, với
`IOException → SocketException(10054)`. **Không phải của E-2**: đợt này không chạm một file nào dưới `Identity/`,
không chạm TLS, không chạm socket (grep toàn dải `5f2b8883..HEAD`: 0 file khớp), và phần **được biên dịch** thay
đổi giữa lần cổng xanh gần nhất và lần đỏ chỉ gồm ba sửa chú thích, một attribute không ai dùng bị xoá, và một
property `internal` không ai dùng bị xoá. Chạy riêng ngay sau đó: **17/17, sáu lần liên tiếp**.

🔴 **Nhưng "chập chờn" là triệu chứng, không phải chẩn đoán.** Cơ chế **[READ — CHƯA ĐO]**: client làm
`AuthenticateAsClientAsync` → `WriteAsync(1 byte)` → rơi ra khỏi các khối `using`, dispose `SslStream` +
`TcpClient`; server làm `AuthenticateAsServerAsync` → `ReadAsync(1 byte)`. **Không gì bắt việc client dispose
phải xảy ra SAU khi server đọc xong.** Nếu socket client đóng đột ngột trong lúc server còn trong `ReadAsync`,
server thấy RST (10054) chứ không phải EOF sạch, `serverError` khác null, và khẳng định đổ. Tức là
`serverError is null` **không phải tính chất bài test này bảo đảm** — cùng hình dạng với §10.8. Lịch sử git của
chính nó đã mang một bản sửa cho vấn đề kề bên (`f40a6bcb`), nên đây là lần thứ hai thứ tự tắt máy của bài test
này sinh ra một lần đỏ giả. **Cách sửa là một tín hiệu bắt tay-đã-xong (hoặc close có linger) để client dispose
sau khi server đọc — không phải retry, không phải nới khẳng định.**

### 10.8 🔴 Đính chính của E-2 cho §9.3b: bài test đua *không thể* khẳng định "không lệnh ghi nào lọt sau chốt"

§9.3 (và E-1 §4.3) mô tả bài test đua là *"khẳng định **không** lệnh ghi nào tiếp đất sau khi chốt gài"*. **Tính
chất đó SAI trên cây này**, và một bài test khẳng định nó sẽ đỏ vì lý do đúng đắn: TOCTOU dư (§9.3b tự nêu)
nghĩa là một lệnh ghi có quyết định guard lấy **trước** khoảnh khắc chốt gài vẫn có thể tiếp đất **sau** đó.
Không cách sắp xếp khoá nào bên trong `FleetCore` đóng được — chỉ một đường ghi kiểm lại chốt **nguyên tử tại
ranh giới thiết bị** mới đóng được, và đó là một thay đổi thiết kế.

Tính chất **đúng, có thật và chưa từng được kiểm** là: **mọi lần đánh giá guard BẮT ĐẦU sau khi `Estop()` trả về
đều thấy chốt và từ chối.** Đó là cái bài test khẳng định.

Và hình dạng của cái sai đáng giữ: **bản nháp đầu của chính bài test này đã ĐỎ**, ở khẳng định gương ngây thơ
*"mọi lần đánh giá trước chốt đều được cho qua"*. Nó sai — `Estop()` gài `_estopEngaged` **bên trong** `_gate`
rồi mới tháo dỡ pipeline và trả về, nên một reader đồng thời thấy chốt **sớm hơn nhiều** so với lúc `Estop()`
quay lại chỗ gọi. Từ chối sớm là chiều an toàn. **Cách xử lý là sửa khẳng định gương thành dạng nhân quả (không
có lần từ chối nào mà không có chốt), không phải nới lỏng tính chất chính** — nới lỏng ở đây chính là cách bài
test biến thành thứ nó sinh ra để bắt.
