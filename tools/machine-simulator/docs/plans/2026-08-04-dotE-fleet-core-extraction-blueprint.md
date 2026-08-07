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
