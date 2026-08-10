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

### 🔴 1.1 Đính chính (2026-08-08, sau E-3) — hai điều mục này nói không đúng, và cả hai là lỗi của tôi

**(a) "Tách lõi để tác nhân biên chạy được nó" — tác nhân biên KHÔNG chạy cái lõi.** `FleetCore`'s ctor đòi
`SwitchableTransport` + `TransportCoordinator`, thứ lại đòi bốn transport không-null
(`TransportCoordinator.cs:46`), trong khi `EdgeWorker.BuildLiveOrDemoTransport()` phân giải **một**
`ITransport` (`EdgeWorker.cs:302`). Sau E-3, **không có bên gọi `FleetCore` nào trong `St4i.EdgeService`**, và
sau khi lõi thành `internal` thì **không thể có**. Cái tác nhân biên chạy là `EdgeAgentPipelines`, một kiểu
310 dòng viết riêng.

**E-2 vẫn là bước mở đường, chỉ là vì một lý do khác lý do tôi viết:** thứ nó thật sự mua được là
`ConnectorRegistry` + `ConnectorBinding` **với tới được từ EdgeCore**. Đó là một biện minh thật và đủ — nó
chỉ không phải cái đã được ghi. *Để nguyên câu cũ thì người đọc sau mất một giờ đi tìm một bên gọi không thể
tồn tại.*

**(b) 🔴 Đợt này KHÔNG giao RS-485 cho tác nhân biên, và §6 chưa bao giờ có nhiệm vụ nào định giao.**
Sau E-3, **`St4i.EdgeService` chạy Modbus TCP và không gì khác trên dây.** Một entry RTU bị **từ chối theo
tên** vì `ModbusMultidropRegistration` với tới `RtuBusConfiguration.IsInBusNamespace` — nằm ở
`St4i.EngineApi`, và EdgeService không tham chiếu được EngineApi (§1, `NU1605`). OPC-UA cũng bị từ chối, vì
`OpcUaDriver` ghi chứng chỉ app-instance vào gốc toàn máy `%ProgramData%\ST4I\sim\opcua-pki` và phán quyết
không-thêm-người-ghi cấm điều đó. **Cả hai từ chối đều được ghim bằng đột biến**, mỗi cái chết bởi một test
khẳng định **lý do được nêu tên** — nên chúng ở lại như quyết định, không trôi thành tai nạn.

**Đây là lỗi phân rã, không phải lỗi thực thi.** E-1 lập bản đồ, E-2 tách, E-3 dựng vòng đời, E-4 lo hiển thị
và tài liệu. **Không nhiệm vụ đánh số nào từng định dời phần đăng ký RTU.** E-3 giao trọn phạm vi của nó rồi
**đo khối lượng còn thiếu lần đầu tiên** (§11.6). Vì thế §6 có thêm **E-5**.

**Và đường tắt đã có người thử và ghi lại là bất khả thi**: tham chiếu thẳng EdgeService →
`St4i.EngineApi` cho `NU1605` package downgrade lúc restore, cộng bề mặt ASP.NET Core / cổng publish
web-UI của EngineApi (`EdgeWorker.cs`, chú thích `ResolveGate`). **Tách lõi là bắt buộc.**

## 2. 🔴 Hình dạng đã chốt, và điều nó loại bỏ

**EdgeService là TÁC NHÂN BIÊN, không phải engine thứ hai.** `ST4I_SERVER_URL` mặc định
`http://localhost:5000`; nó đọc máy tại chỗ rồi **đẩy lên** EngineApi.

### 🔴 2.1 Đính chính (2026-08-08, sau E-4) — cơ chế trên SAI. Kết luận sống, lý do thì không.

**EdgeService không đẩy lên EngineApi.** Nó `POST` tới `{ST4I_SERVER_URL}/api/v1/ingest/…` — nền tảng ST4I ở
`:5000`. **EngineApi lắng nghe ở `:5199` (`Program.cs:69`) và không map một route `api/v1` nào cả** (đã grep,
rỗng); bản thân nó cũng là một **client** của cùng nền tảng ấy. **Hai host không chia sẻ roster, không chia sẻ
sổ yêu sách, không chia sẻ một kênh nào.**

Tôi rút ra "đẩy lên EngineApi" từ **một giá trị mặc định** — `localhost:5000` — và cho rằng nó nghĩa là
EngineApi. Đó là §9.3b lần nữa: **một khẳng định phát biểu bằng giọng của phép liệt kê, sinh ra từ việc đọc
một hằng số.**

**Cái sống nguyên vẹn:** EngineApi vẫn là nơi **duy nhất** sở hữu roster, yêu sách mã máy và UI — vì đó là
roster **của chính nó**, không phải vì có ai báo cáo về cho nó. Phép đo hai-tiến-trình-một-thiết-bị ở bảng
dưới cũng sống nguyên.

**Và cái đổi theo hướng xấu hơn:** tôi từng viết hình dạng tác nhân biên tránh được mối nguy **bằng cấu trúc**
vì có một nguồn sự thật. Sự thật là **hai host không được điều phối bởi bất cứ thứ gì — kể cả một đường dữ
liệu**. Thứ ngăn hai tiến trình cùng lái một thiết bị **không phải kiến trúc**; trên đường serial nó là hệ
điều hành từ chối lần mở thứ hai, còn trên gateway TCP thì **không có gì cả** — đúng như bảng dưới đã ghi, chỉ
là giờ không còn một "nguồn sự thật" nào làm nền cho nó.

→ **EngineApi vẫn là nơi DUY NHẤT sở hữu roster, yêu sách mã máy và UI** — nhưng vì phạm vi, không vì báo cáo.

🔴 **Và review E-4 đẩy điều đó đi xa hơn tôi đã viết, đúng:** *"sở hữu vì phạm vi, không vì báo cáo"* giờ là
**một điều hiển nhiên, không phải một bất biến kiến trúc** — EngineApi sở hữu roster của nó vì **không tồn tại
roster nào khác có thể báo cáo về cho nó**. Một điều hiển nhiên **không gánh nổi trọng lượng trong một lập
luận an toàn tương lai** theo cách một bất biến gánh được.

→ **"Một nguồn sự thật" được RÚT KHỎI danh sách tiền đề.** Đừng dựa vào nó ở E-5 hay ở bất cứ đợt nào sau.
Thứ còn lại là bảng đo ở trên, và nó nói: trên serial, hệ điều hành từ chối lần mở thứ hai; trên gateway TCP,
**không có gì cả**.

**Dụng cụ, và đây là chỗ chính §2.1 suýt lặp lại lỗi nó đang chẩn đoán:** đích POST thật nằm trong SDK nhúng
(`examples/device-client/csharp/St4iDeviceClient.cs:387/426/450`, ghép ở `:658`), **không phải** ở các hằng
`Normalizer.cs:14-16` — những hằng ấy chỉ **khai báo**, không quay số, và test của chính chúng nói vậy
(`StoreAndForwardRestartSurvivalTests.cs:379`: *đột biến `Normalizer.ProcessResultPath` để test này xanh*).
Cùng một giá trị, sai dụng cụ. **Một cơ chế đọc từ một hằng số đã khai báo** — đúng thứ §2 mắc phải.

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

### 🔴 6.1 Bổ sung (2026-08-08, sau E-3) — **E-5**, và vì sao nó phải tồn tại

| # | Nội dung |
|---|---|
| **E-5** | Dời phần đăng ký RTU xuống EdgeCore, để **RS-485 chạy được trong `St4i.EdgeService`** — tức là lý do §1 nêu ra cho cả đợt này. |

**Bảng §6 gốc là một danh sách bốn nhiệm vụ không cái nào giao được thứ §1 nói đợt này tồn tại để giao.** Bốn
nhiệm vụ ấy đều đúng và đều cần; chúng chỉ không cộng lại thành mục tiêu. Không ai phát hiện ra cho tới khi
E-3 va vào bức tường và **đo** nó — đó là lần đầu khối lượng còn thiếu được nêu bằng con số chứ không bằng
giả định.

**Khối lượng, đã đo (§11.6):** `ModbusRtuBusPlan` 108 dòng và **là một nút lá**; `ModbusMultidropRegistration`
344 dòng và **không phải nút lá** — nó với tới `RtuBusConfiguration.IsInBusNamespace`, một quy tắc mà chú
thích của chính nó nói **phải tồn tại đúng một lần cho ba bên gọi**; `ConnectorConfigValidation` 254 dòng.
Đó là hình dạng §9.6(a): *"cái lá" hoá ra không phải lá.*

### 🔴 6.2 Đính chính (2026-08-08, sau E-5) — hai dự đoán dưới đây SAI, và tôi lặp lại chúng ba nơi

**(a) "Hai quy tắc khoá hội tụ miễn phí" — KHÔNG.** Tôi viết nó ở §6.1(1), §11.5 và README §24.2, rồi nhắc
lại cho E-5 như một sự kiện đã chốt. E-5 liệt kê **theo lớp đầu vào** thay vì suy từ cơ chế, và kết quả ngược
lại: hai quy tắc **vốn đã đồng ý về một bus RTU** (E-5 biến nửa đó thành mã dùng chung qua
`ConnectorsConfig.IsRtuBus`); chúng **chỉ khác nhau ở TCP/OPC-UA**, thứ mà cuộc dời **không hề chạm tới**.

Và **không chiều nào khả dụng**: EngineApi→`id` chính là cuộc di trú alarm `TargetId` mà nó **đã từ chối hai
lần, có test ghim**; EdgeService→`kind` sẽ **gộp N entry Modbus TCP** (N socket, N máy) **thành một** — và
một bus RTU không thay thế được điều đó.

**Dự đoán ấy suy từ một CƠ CHẾ mà không liệt kê CÁC LỚP ĐẦU VÀO.**

🔴 **Đính chính của review E-5 cho chính câu trên — tôi dán nhãn đúng họ nhưng sai cơ chế, và cái nhãn sai
trỏ tới sai cách chữa.** §9.3b và §2.1 là những ca mà **cơ chế SAI** (một switch mã socket không bao giờ chạy;
một giá trị mặc định đọc thành một đích đến). Ở đây **cơ chế ĐÚNG**: RTU fan-out thật sự là hình dạng duy nhất
sinh ra N trong EngineApi — reviewer kiểm và xác nhận.

Thứ hỏng là **một phép đổi miền lượng hoá giữa tiền đề và kết luận**: từ *"hình dạng duy nhất sinh ra N"* sang
*"lý do duy nhất khiến hai quy tắc khác nhau"*. **Hai câu ấy lượng hoá trên hai tập khác nhau** — các hình dạng
fan-out, so với các lớp đầu vào mà hai hàm khoá bất đồng.

**Và phân biệt ấy không phải chẻ chữ, vì cách chữa khác nhau.** Cách chữa của §9.3b là *đo cái cơ chế* — mà đo
ở đây sẽ **xác nhận** cơ chế, rồi **dùng nó xác nhận luôn một kết luận sai**. Thứ bắt được ca này chính là thứ
E-5 đã làm: **liệt kê cái miền mà KẾT LUẬN lượng hoá trên đó, không phải cái miền tiền đề lượng hoá trên đó.**

**Và ba chỗ tôi nêu cũng sai một chỗ:** §11.5 **không chứa dự đoán hội tụ nào**, ở cả BASE lẫn HEAD. Chỗ thứ
ba thật là **nửa TIẾNG VIỆT của README §24.2**. E-5 sửa đúng cả hai nửa; chỉ bản kê chỗ của tôi là sai — **và
sai theo đúng hướng giấu đi cặp gương EN/VI**, đúng lớp dư lượng §13.5(1) tồn tại để gọi tên. Reviewer nói
thẳng, và nó đúng: *một đính chính có chủ đề là "hãy liệt kê thay vì suy từ cơ chế" thì không được khẳng định
ba vị trí mà không liệt kê chúng.*

**(b) "`IsInBusNamespace` không phải nút lá" — sai về đối tượng.** Nó phụ thuộc đúng **ba ký hiệu**:
`DriverKinds.Normalize` (ở **`St4i.Connector.Abstractions`**, không phải EdgeCore), `LooksLikeADeviceInstanceId`
và `DeviceIdSuffixPrefix` (cả hai ở `ModbusMultidropMap`). **Bản thân nó LÀ một nút lá; thứ không phải lá là
cái KIỂU bao quanh nó.** Nên nó **dời được nguyên vẹn** sang `ModbusMultidropMap`, bị xoá khỏi
`RtuBusConfiguration` không cần forwarder, và **vẫn được phát biểu đúng một lần cho ba bên gọi** (bốn điểm
gọi). Không tách, không có gì phải giữ cho khỏi trôi.

🔴 **Bản nháp đầu của chính đoạn này viết *"cả ba đã ở EdgeCore"* và *"nơi khai báo mọi sự kiện nó lập luận"* —
tức là ca THỨ TÁM của đúng cái universal sai mà đoạn này tồn tại để sửa, nằm trong bản ghi bền, ở chỗ người
thừa kế đọc trước tiên.** E-5 phát hiện và **cố ý không tự sửa** vì tôi dặn đừng chạm; nó báo lại. Ghi ở đây
thay vì lặng lẽ vá, vì con số "tám" là dữ kiện: **lớp lỗi này không bị chặn bởi việc biết về nó.**

→ **Và đây là chiều ngược của một quy tắc §8.1 đã có:** *"X không phải nút lá"* là một khẳng định về một
**KIỂU**; câu hỏi đắt tiền thì về một **THÀNH VIÊN**.

🔴 **Review E-5 sửa cả gốc lẫn cái giá tôi nêu, và cả hai đều đúng.**

**Gốc không phải "chiều".** Nó là **đơn vị của câu hỏi phải khớp đơn vị của câu trả lời**. Phép grep `Source`
của D-7b hỏi ở đơn vị *một tên trường đang trong tầm nhìn*, còn tính chất sống trên *một lệnh trả về*; §11.6
hỏi ở đơn vị *một kiểu*, còn tính chất sống trên *một thành viên*. *"Làm lỗ hổng trông như không có"* so với
*"làm công việc trông khó"* là **hệ quả, không phải gốc** — và phát biểu nó thành một luật hai chiều sẽ mời
người đọc sau đi tìm **một chiều** thay vì **một độ hạt**.

**Và câu chốt cũ của tôi — "một ước lượng quá cao cũng là một ước lượng sai" — đúng mà yếu.** Cái giá thật đã
nằm sẵn cách đó hai mục, ở §1.1: **một phép đếm ở tầng kiểu không chỉ thổi phồng một ước lượng, nó làm công
việc trông KHÔNG XẾP LỊCH NỔI — và bốn nhiệm vụ đúng đã ship mà không có năng lực cả đợt tồn tại để giao.**
Đó mới là thứ làm nó cùng một lỗi, chứ không phải một sự đối xứng thú vị.

→ 🔴 **Và quy tắc hành động được mà cả tôi lẫn E-5 đều không phát biểu:** khi ghi *"X không phải nút lá"*,
**hãy ghi TẬP KÝ HIỆU mà thành viên gây vướng phụ thuộc vào, không phải TÊN của tham chiếu gây vướng.** §11.6
viết *"không phải lá: nó với tới `RtuBusConfiguration.IsInBusNamespace`"* — **toàn bộ câu trả lời nằm cách câu
ấy đúng một lần giải tham chiếu.**

**Và một sự kiện bất tiện đi kèm, do reviewer chỉ ra:** bản đính chính này liệt kê tập phụ thuộc của thành
viên ấy **hai lần trong cùng một thay đổi, và hai bản liệt kê bất đồng ở hai trên ba mục** — `DriverKinds`
nằm ở `St4i.Connector.Abstractions`, **không phải EdgeCore**. Đó vừa là bằng chứng mạnh nhất cho quy tắc trên,
vừa là ca §8.1(b) thứ năm, **do một lượt census chạy riêng cho đúng lớp lỗi ấy bỏ sót**.

→ **Và hai đính chính §6.2(a) và §6.2(b) có CHUNG một gốc** — đơn vị của câu hỏi không khớp đơn vị của câu trả
lời — dù đang được xếp dưới hai hình dạng § khác nhau.

**(c) `ConnectorConfigValidation` (254 dòng) là thừa trong ước lượng §11.6.** Nó tồn tại để học mã máy mà một
blob TCP mờ khai báo; một bus **không cần** nó, vì `FanOut` đã phân giải từng thiết bị. Ước lượng liệt kê
*những gì `ConnectorsJsonRegistration` gọi* thay vì *những gì đường RTU cần*.

**Hai thứ E-5 phải mang theo, không được phát hiện lúc đang làm:**
1. **~~Quy tắc khoá đăng ký sẽ hội tụ.~~** ← **SAI, xem §6.2(a).** Giữ nguyên câu gốc bên dưới để thấy dự đoán
   đã được phát biểu thế nào. E-3 phải cho EdgeService khoá theo `entry.Id` vì khoá của EngineApi cho
   một entry TCP là **`Kind`**, nên N entry Modbus **gộp lại thành một**. Hai quy tắc trong hai host là hình
   dạng §7.1 của Đợt D ở tầng cấu hình — review E-3 phán đó là **ca chấp nhận được** (khác nhau vì một lý do
   phát biểu được và kiểm được, mỗi cái có test riêng) và **chúng hội tụ miễn phí đúng lúc
   `ModbusMultidropRegistration` xuống tới EdgeCore.** E-5 là lúc đó.
2. **Quyết định về gốc dữ liệu theo host vẫn chưa ra**, và nó chặn cả OPC-UA lẫn bất cứ thứ gì muốn ghi vào
   `%ProgramData%` từ hai tiến trình. `OpcUaConnectorFactory` **đã** nhận `pkiDir` làm tham số hàm dựng và
   `OpcUaPkiPaths.ResolveRoot` **đã** đọc `ST4I_OPCUA_PKI_DIR` — nên đường thoát tồn tại sẵn; thứ thiếu là
   một **quyết định**, không phải một cơ chế.

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

🔴 **Và đây là điều quan trọng nhất E-3 thừa kế, nói thẳng: LUẬT TRÊN ĐƯỢC BẢO VỆ BẰNG MỘT CHÚ THÍCH, KHÔNG
BẰNG MỘT PHÉP KIỂM.** Review E-2 chạy lại đột biến tách `GetSafetyStatus` thành hai lần lấy khoá ở HEAD:
**SỐNG SÓT 1283/1283**, tức là sống sót qua cả ba nhân chứng mới E-2 vừa viết. §9.3b đã chứng minh **không
bài test đua nào bắt được nó qua guard** — nên đây không phải thiếu sót của E-2. Nhưng mục này đọc lên như
thể hình dạng đã được khoá lại; **nó được khoá bằng văn xuôi.** Một nhân chứng *có thể* dựng được — nhắm vào
cặp trên màn hình `GET /v1/safety` chứ không nhắm vào guard — và đó là một hạng mục, không phải một cái chặn.

🔴 **ĐÍNH CHÍNH (review toàn nhánh, I2): có HAI ngoại lệ, không phải một, và cả hai giờ đều đã dán nhãn** —
`FleetHost.CurrentScenarioDto()` (dưới đây) và **`FleetHost.MachineDetail()`** (`FleetHost.cs:323-327`: đọc
`_core.IsRunning`, một lần lấy `_gate`, rồi `_core.TryGetMachineState`, không khoá, và ghép). Hành vi của cái
thứ hai **trùng từng byte với BASE** — cặp ấy đã là hai lần đọc trước cuộc cắt — nên không có gì thụt lùi;
cái sai là **lời khẳng định phổ quát**, và nó đứng ở BA chỗ (`FleetHost.cs`, `FleetCore.cs`, và mục này).
Điều đáng giữ: **E-2 đã nhìn thẳng vào chính thành viên ấy** — §10.2 nói về việc bỏ khối `lock` của nó — **và
vẫn viết ra chữ "duy nhất".** *Một biểu ngữ nói "không cái nào" là thứ làm người đọc sau thôi đếm.*

🔴 **Ngoại lệ thứ nhất đã được dán nhãn, tại `FleetHost.CurrentScenarioDto()`.** Review E-2 tìm
thấy nó **cách câu cấm ba mươi tư dòng**: nó đọc hai thứ từ lõi rồi ghép. Nó **bảo toàn hành vi** —
`_scenario`/`_activePresetName` là `volatile` và trước cuộc cắt cũng đã là hai lần đọc rời — nhưng cặp ấy
được **ghi cùng nhau dưới khoá của lõi**, nên vẫn là hình dạng cặp-có-thể-rách. Đã dán nhãn tại chỗ kèm điều
kiện huỷ ngoại lệ: **nếu có bất cứ thứ gì trên đường ghi hoặc đường an toàn bắt đầu đọc cặp này, ngoại lệ
chết** và cặp phải được phân giải trong `FleetCore`. *Một luật có ngoại lệ không dán nhãn sẽ bị chính nhiệm
vụ thừa kế nó phá vỡ.*

### 10.2 🔴 Số khối `lock (_gate)` là **20**, không còn là 21 — và chỗ mất đi là chỗ nào

§9.2 ghi 21. Sau cuộc cắt là **20**, xác định bằng một bộ đếm khớp ngoặc chạy trên cả hai cây (không phải bằng
grep): khối duy nhất biến mất là của **`MachineDetail`**, mà thân nó đúng một lệnh — `isRunning = IsRunning;` —
tức một phép đọc của một getter *đã* `lock (_gate)`. `MachineDetail` là thành viên SPLIT (E-1 §1.4 mục 5): nửa
vòng đời là "đọc `IsRunning`", nửa chiếu ra là `state.ToDetail(isRunning)`. Tách ra thì nửa vòng đời đúng bằng
`_core.IsRunning`. Bọc thêm một `lock` ở phía vỏ chính là **thêm một khoá cho vỏ** — điều §10.1 cấm. Một lần
lấy khoá tái nhập dư thừa bị bỏ; giá trị không đổi, hành vi không đổi.

### 10.3 ~~Ba vi phạm `_gate` của §9.2 **VẪN CÒN NGUYÊN**~~ → ~~🔴 **G-1: tập là CHÍN đường, ba đã đóng, bốn còn mở trong lõi, hai nằm trong callee**~~ → 🔴 **J-1: tập vẫn là CHÍN đường — 3 ĐÓNG, 2 THU HẸP, 4 MỞ** — và cuộc đi bộ ba chặng nói gì

> 🔴 **Đính chính ngày 2026-08-10, J-1 (review Minor 5).** Tiêu đề của G-1 tóm tắt tập là **3/4/2** ("ba đã
> đóng, bốn còn mở trong lõi, hai nằm trong callee") — một cách nhóm theo VỊ TRÍ, không theo TRẠNG THÁI. Sau
> J-1 nó không còn dựng lại được từ bản chính thức ở đầu `FleetCore.cs`, vốn đếm theo trạng thái: **3 ĐÓNG
> (P1–P3), 2 THU HẸP (P4, P5), 4 MỞ (P6–P9), 3+2+4 = 9**. Hai cách nhóm cùng cho ra chín nhưng **không phải
> cùng một phép chia**, và một người đọc đối chiếu hai tiêu đề sẽ thấy "bốn còn mở" chọi "bốn MỞ" rồi kết
> luận sai rằng P4/P5 vẫn nằm trong đó. Giữ tiêu đề cũ có gạch ngang theo đúng quy ước M4 của chính file này.

> 🔴 **Tiêu đề cũ giữ lại gạch ngang, không xoá** (đúng quy ước đính chính M4 của chính file này). Nó đúng
> lúc E-2 viết và **sai kể từ G-1**; một register được quét bằng TIÊU ĐỀ, nên để nguyên chữ "VẪN CÒN NGUYÊN" ở
> dòng đầu trong khi bản đính chính nằm 60 dòng bên dưới là đúng lớp lỗi mà census tồn tại để bắt. Toàn văn
> đính chính ở cuối mục này.

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

🔴 **Đính chính của review E-2 — bốn chỗ sai ở đúng mục này, ba trong số đó nghiêng về phía trấn an.**

**(a) Là BỐN lời gọi log dưới khoá, không phải ba** — và câu văn trên tự liệt kê bốn thứ rồi đếm thành ba.
Reviewer đi bộ lại và xác nhận: `FleetCore.cs:1476`, `:1477`, `:1609`, `:1800`. Điểm log thứ năm trong bảng
(`:1703`) mới là điểm **không** nằm dưới khoá — nó ở trong lambda `Task.Run` của `StartSlot`. Câu văn đã trừ
đúng món khỏi sai tổng. **Đếm hụt một bề mặt rủi ro theo hướng trấn an chính là bài học §9.5 đã ghi** (vụ
8-so-với-14) — lặp lại ngay ở mục viết ra để cảnh báo về nó.

**(b) Không phải "một dòng log có thể chặn `Estop()`" mà là "TỚI N DÒNG LOG, MỖI MÁY MỘT DÒNG".** Hai callback
của `MappingProfileResolver` được gọi **bên trong `ResolveOne`, mỗi máy trong roster một lần**
(`MappingProfileResolver.cs:76` và `:87`) — cùng vòng lặp với `File.Exists`/`File.ReadAllText` của vi phạm #1,
trên đúng roster 50 máy mà §9.2 đo được **2,39 ms** giữ khoá. Điều đó **đổi hình dạng của hạng mục sửa**, không
chỉ đổi con số.

> 🔴 **`2,39 ms` Ở ĐÂY LÀ MỘT PHÉP ĐO LỊCH SỬ (J-1, 2026-08-10 — review Minor 5).** Từ J-1, cả vòng lặp ấy —
> `MappingProfileResolver.Build` **và** hai callback của nó — chạy trong `FleetCore.BuildStartPlan`, **đã nhả
> `_gate`**. Dụng cụ sinh ra con số này chạy lại hôm nay sẽ cho một số khác. Hộp đính chính ở §9.2 tuyên bố
> "§10.3" đã được phủ; **nó chưa**, cho tới dòng này — một khẳng định về ĐỘ PHỦ trỏ tới một chỗ không có dấu,
> tức đúng lớp lỗi §8.1(b) mà chính đợt này đang đếm, cách chỗ bắt được nó đúng một artifact.

**(c) Dụng cụ dùng để nghiệm thu đếm một đại lượng KHÁC với đại lượng tiêu chí nêu tên.** Tiêu chí là
*"số thao tác **I/O hoặc `Dispose`** với tới được dưới `_gate` không được tăng"*; bảng sáu dòng ở trên đếm
*"số điểm mà mã do host cung cấp với tới được dưới `_gate`"* — và **không có một dòng `Dispose` hay `Cancel`
nào**, kể cả `slot.Cts.Cancel()` (`FleetCore.cs:1794`), vốn **chính là vi phạm #2 của §9.2**. Kết luận
"không tăng" vẫn đúng — reviewer tái lập bằng một cuộc đi bộ 13-điểm độc lập, một-đối-một — nhưng **E-3 sẽ
chạy lại phép kiểm này theo đúng câu chữ ở đây**, nên câu chữ phải nói đúng đại lượng.

**(d) Có `Cancel` THỨ NĂM dưới `_gate` mà cả §9.2 lẫn mục này đều không liệt kê:** `FleetCore.Burst()` tại
**`FleetCore.Burst()`** (`previousCts?.Cancel()`), trùng từng byte với `FleetHost.Burst()` ở BASE. (🔴 Review
toàn nhánh M4: mục này ghi `FleetCore.cs:2141`, và số dòng thật lúc review là **2185** — nên **nêu TÊN thành
viên, không nêu số dòng**: một số dòng trong bản ghi bền là một khẳng định tự mục nát theo từng lần sửa.) Có sẵn, không
đổi, **cùng lớp với vi phạm #2**. Nó thuộc danh sách của hạng mục mang sang.

→ **Hạng mục sửa `_gate` là BỐN đường, không phải ba**, và danh sách `Cancel` của nó có **hai** mục, không
phải một.

🔴 **Đính chính sau G-1 (`.superpowers/sdd/gate-and-log-channel/task-1-brief.md`) — tiêu đề mục này giờ SAI, và
tập hợp lớn hơn cả con số đã đính chính ở trên.** G-1 dựng lại **tập** thay vì thừa kế danh sách: một cuộc đi bộ
theo khả năng với tới từ cả **hai mươi** vùng `lock (_gate)` qua các callee, hỏi ở mỗi chỗ *"cái này có với tới
I/O, `Dispose` hay `Cancel` không"* — **không** phải một bảng đếm "điểm mã do host cung cấp", đúng cái đại lượng
(c) ở trên nói là sai.

🔴 **TẬP LÀ CHÍN ĐƯỜNG, đánh số MỘT LẦN — đóng và mở cùng một danh sách.** (Bản G-1 đầu tiên viết "tám", và
không cách nhóm nào trên chính danh sách của nó cho ra tám: nó đếm *điểm gọi* ở mục log và đếm *cơ chế* ở mọi
chỗ khác. Một con số tiêu đề không dựng lại được từ phép liệt kê mà nó tóm tắt là **lỗi trong chính sản phẩm
bàn giao**, vì phép liệt kê CHÍNH LÀ sản phẩm bàn giao. Review G-1 bắt được; sửa ở đây và trong
`FleetCore.cs`.)

**Đã ĐÓNG (1–3):**
1. Vi phạm #3 — `RegisterMachine` → `_onMachineSeeded`, đường mang con số **12,35 ms**. Nay xếp hàng dưới
   khoá, gọi ngoài khoá.
2. Lời gọi log dưới khoá — cơ chế thứ tư của (a), **bốn điểm gọi trong MỘT cơ chế** (đây chính là chỗ sinh ra
   "tám"). Cả bốn nay đệm rồi phát ngoài khoá.
3. `Cancel` thứ hai của (d), trong `Burst`. Đã đưa xuống dưới khoá.

**Còn MỞ, trong mã của chính lõi (4–7):**

> 🔴 **Đính chính ngày 2026-08-10, nhiệm vụ J-1 (`.superpowers/sdd/restart-chokepoint/`).** Hạng mục **4 và
> 5** dưới đây (là `P4` và `P5` trong danh sách chín đường ở đầu `FleetCore.cs`, nơi lưu bản CHÍNH THỨC) đã
> được **THU HẸP, chưa ĐÓNG**. Việc dựng driver đã được hoist ra ngoài `_gate`: `BuildStartPlan` dựng mọi
> simulator và phân giải mọi mapping profile **khi đã nhả khoá**; `StartLocked` chỉ lắp đặt. Trên mọi lần
> start không tranh chấp, cả hai đường đều **không** chạm hệ thống tập tin dưới khoá, và khoá riêng của
> `MachineConfigStore` **không** được lấy dưới `_gate`. Đường dưới khoá vẫn CÒN với đúng một máy: máy được
> đăng ký xen vào giữa lúc dựng. Con số **2,39 ms** ở hạng mục 4 và ở §10.3 vì thế là một phép đo LỊCH SỬ —
> dụng cụ cũ chạy lại hôm nay sẽ ra số khác. Câu chữ nguyên bản dưới đây giữ nguyên vì nó là bản ghi của Đợt
> E, không phải phát biểu về hiện trạng.

4. Vi phạm #1 — `MappingProfileResolver.Build` → `File.Exists`/`File.ReadAllText` mỗi máy, **2,39 ms**.
5. 🔴 **KHÔNG có trong bất kỳ danh sách nào trước đây, và nó là một lệnh GHI**: `StartLocked` →
   `SimulatorFactory.Create` → hàm dựng `SimulatorBase` → `MachineConfigStore.Ensure` → `Save()` →
   `File.WriteAllText` + `File.Move`, một lần mỗi máy chưa có trong store (tức lần `Start` đầu tiên trên một
   data root mới), và **lấy một khoá THỨ HAI trong lúc giữ `_gate`** ở mọi lần start sau đó. Mọi phép đếm
   trước đây của hạng mục này đều đếm đường ĐỌC. Nó cũng chính là cú ném khiến `RegisterMachine` phải drain
   trong `finally` (review G-1, I-3).
6. Vi phạm #2 — `StopLocked` → `slot.Cts.Cancel()` → callback `ct.Register` của driver chạy `Dispose` đồng bộ.
7. `IConnectorFactory.TryCreate` của bên thứ ba — có ghi tại chính điểm gọi, **chưa bao giờ nằm trong danh
   sách hạng mục**.

**Còn MỞ, trong mã của CALLEE (8–9) — không sửa được từ `FleetCore`:**
8. `Start`/`Stop`/`Estop` giữ `_gate` băng qua `PublishNodeBirth()`/`PublishNodeDeath()`, mà nhánh suy giảm
   của chúng (publisher đã dispose, hàng đợi publish đầy) gọi callback log **của chính publisher**. 🔴 Trường
   là `IUnsPublisher`, **không** phải lớp cụ thể `UnsPublisher` — nên đây là tính chất của **SEAM**: hai
   phương thức của *bất kỳ* hiện thực nào do host cung cấp đều chạy dưới khoá này, và câu "non-blocking,
   never throws" của interface là một *lời hứa*, không phải một *chặn trên*. (a) đếm các điểm `_logger?.`
   **bên trong FleetCore.cs**; đường này nằm trong callee nên nó cấu trúc-tính không thể thấy. G-1 cố ý không
   đụng: giữ hai lời gọi ấy trong khoá là một bản sửa review có chủ đích (nối thứ tự NBIRTH/NDEATH với chính
   lần chuyển trạng thái), nên bản sửa thuộc về phía sau seam.
9. `GetDriverHealth` đọc `Driver.Kind`/`Driver.Health` dưới khoá — getter của bên thứ ba trên `IDeviceDriver`.

**Chín đến từ đâu:** danh sách thừa kế nêu **năm** — ba vi phạm của §9.2 (nay là 1, 4, 6), cơ chế log của (a)
(2), và `Cancel` thứ hai của (d) (3). Mục 7 có ghi tại điểm gọi nhưng chưa bao giờ vào danh sách. **Mục 5, 8,
9 không có trong bất kỳ danh sách nào.** 5 + 1 + 3 = 9.

🔴 **Một TRỤC KHÁC, ghi ở đây vì chưa ai viết ra: `_gate` được giữ băng qua NĂM khoá khác.** Không cái nào là
vi phạm I/O/`Dispose`/`Cancel` nên không cái nào thuộc chín — nhưng "khoá nào được phép lấy trong lúc giữ khoá
này" là một bất biến riêng và nó không có chỗ trú. Theo thứ tự, luôn `_gate` trước: khoá của
`MachineConfigStore` (đường 5); của `TransportCoordinator` và `SwitchableTransport` (qua
`ApplyNetworkOutageLocked`); của `ConnectorRegistry`; và khoá vòng đời của publisher UNS. Chưa cái nào bị đảo.
`_seedNotifyGate` **cố ý không** nằm trong danh sách này và không bao giờ được phép gia nhập — xem doc của
chính nó. Và một chỗ im lặng hơn vẻ ngoài: `ApplyNetworkOutageLocked` → `TransportCoordinator.ApplyMode` kết
thúc bằng `ModeChanged?.Invoke(mode)`, tức **mã do host đăng ký, dưới khoá này**; nó ngủ yên **chỉ vì** điểm
gọi ấy truyền vào đúng mode hiện tại nên `changed` luôn false. Đó chính là câu "vô hại hôm nay, theo một tính
chất của điểm gọi hiện tại" mà §8.1 cảnh báo.

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

🔴 **Đính chính review E-2: kế toán đúng, nhưng cái giá cho người vận hành bị nói nhẹ đi — và theo một hướng
cụ thể.** `St4i.EngineApi` **không ship `appsettings.json` nào**, nên mức tối thiểu mặc định của framework áp
dụng và **`LogDebug` trước đây không phát ra gì cả**. Ba dòng dọn dẹp — `FleetCore.cs:1676` (lỗi dispose driver
connector mồ côi), `:1853` (chờ tháo slot cũ hỏng), `:1865` (lỗi dispose driver slot cũ) — **không đi từ Debug
lên Error trong mắt người vận hành. Chúng đi từ IM LẶNG lên Error** — và dưới `AddWindowsService`, từ im lặng
thành **một mục Windows Event Log ghi đồng bộ**. Mỗi lần khởi động lại đội máy mà vấp một pha tháo chậm giờ ghi
lỗi vào Event Log trên một đường trước đây không ghi gì.

Một điều tích cực cần nói cho cân: **sự trôi này KHÔNG làm tăng chi phí dưới `_gate`** — cả ba chỗ trôi đều nằm
ngoài khoá theo cuộc đi bộ của reviewer, và chỗ trôi duy nhất *nằm trong* khoá (`:1477`) không đổi việc có ghi
Event Log hay không, vì bộ lọc mặc định của `AddEventLog` vốn đã nhận mức Warning.

→ **Xếp lịch callback thứ ba, đừng để nó ở dạng "tôi sẽ nhận một follow-up".** *Ba đường tháo dỡ ghi lỗi vào
Event Log là cách một người vận hành học được thói quen thôi đọc Event Log.*

🔴 **G-1 đã làm, và phép đếm ở trên ĐÚNG y nguyên khi đếm lại từ nguồn.** Kiểm chứng bằng cách đọc chính
`FleetHost.cs` ở `5f2b8883` (trước cuộc dời), không bằng cách đọc lại mục này: **14 điểm** `_logger?.`, **4**
chỉ-có-thông-điệp (đều `LogWarning`, đều vẫn `LogWarning`), **10** mang exception = **5 `LogWarning` + 2
`LogError` + 3 `LogDebug`**. Không có đường `LogDebug` thứ tư. Ba đường ấy đúng là `:1573`/`:1751`/`:1763` của
bản trước cuộc dời — nay là `DisposeOrphanedConnectorDrivers`, và hai chỗ trong `WaitAndDisposeOldPipeline`
(**nêu tên thành viên, không nêu số dòng**, theo chính đính chính M4 ở §10.3(d)).

Kênh thứ ba là `Action<Exception,string>? logDebug` (mang exception, vì cả ba điểm đều mang), vỏ nối tới
`logger.LogDebug`, và **`null` khi không có `ILogger`** như cặp kia — một callback không-bao-giờ-null sẽ làm lỗi
Critical D-7a thành không thể kiểm được trên kênh này y như trên hai kênh kia. **Chọn `LogDebug` chứ không phải
`LogInformation`**, dù tiền lệ được nêu tên là `logInfo` của `WalFlushPump`: tiền lệ là *hình dạng* (một callback
thứ ba, nullable, do host cung cấp), còn mức thì mục tiêu là **khôi phục** độ mịn E-2 đã gộp — `LogInformation`
sẽ để ba dòng này hiện trên console ở nơi trước đây chúng im lặng, tức một thay đổi khác, không phải một sự khôi
phục. Đây là chỗ G-1 đi lệch chữ của brief một cách có chủ đích, và nó được ghi ra để review phán quyết.

**Năm chỗ trôi `LogWarning` → `LogError` còn lại thì KHÔNG sửa, và lý do là một phép đo chứ không phải sự lười:**
bộ lọc mặc định của `AddEventLog` vốn đã nhận mức Warning, nên năm chỗ ấy đổi **mức nghiêm trọng** chứ không đổi
**việc có mặt trong Event Log** — đúng như chính mục này đã ghi cho `:1477`. Cái giá cho người vận hành mà đoạn
văn trên mô tả nằm trọn ở ba đường im-lặng-thành-Error.

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

## 11. 🔴 E-3 ghi lại — cái gì đã dựng, và những gì E-4 phải thừa kế

Toàn văn ở `.superpowers/sdd/2026-08-04-dotE-fleet-core-extraction/task-3-report.md`. Mục này tồn tại vì
`.superpowers/sdd/` bị gitignore và **một báo cáo không phải bản ghi nguồn**.

**Commit:** `bf5bb66f` (cuộc dựng) và `ed975c05` (bịt khoảng trống giữa hai nửa), nhánh `feat/fleet-core-extraction`.
**Cổng:** `151/22/1080/43/1283 = 2579`, 0 lỗi, **116 cảnh báo**, 0 build node.

### 11.1 🔴 Giới hạn chỉ-đọc đã thành CẤU TRÚC, và cách chọn là hướng thứ ba

`St4i.EdgeCore.Fleet.FleetCore` giờ là **`internal`**. Brief nêu hai hướng (facade chỉ-đọc, hoặc `internal`
cho hai thành viên ghi); hướng đã lấy là **`internal` cho CẢ KIỂU**, cộng một kiểu mới hẹp hơn cho tác nhân biên.

**Vì sao cả kiểu, không phải hai thành viên.** Bắt đầu từ *tập các thành viên*, không từ hai cái brief nêu tên.
🔴 **Con số là MƯỜI BA, cộng một đường gián tiếp — bản đầu của mục này ghi TÁM, và review E-3 đã đính chính:**
`TryWriteSetpointAsync`, `TryInvokeCommandAsync`, `GetMachineDriverAvailability`, `Estop`, `ResetEstop`,
**`Start` (`:1058`)**, **`Stop` (`:1101`)**, `RegisterMachine`, `UpdateSettings` (ghi `FleetSettingsStore` khi
có store), `ApplyScenario`, `Burst`, `RunHotFolderAoiDemoAsync` (ghi file), `SetCurrentProduct` — cộng đường
thứ mười bốn gián tiếp qua `TryGetMachineState` (`:1034`), trả một `MachineState` mang
`ApplyReading`/`ApplyConfigSync`/`ApplyConfigSyncError` public.

**`Start` là thành viên dựng MỌI driver và mở MỌI cổng**, và nó vắng mặt khỏi cả danh sách tám lẫn mảng
`ForbiddenMemberNames` của bản đầu. Ghi thẳng ra thay vì lặng lẽ sửa con số: lập luận phương pháp trung tâm của
E-3 là *"tôi bắt đầu từ TẬP CÁC THÀNH VIÊN, nên mới thấy hai cái brief nêu tên là sai đơn vị"* — **và chính cái
tập ấy hụt đúng hai mục nặng nhất.** *Liệt kê không phải một kết quả; nó là một bước có thể làm dở.*

Không có gì từng không được bảo vệ: một từ khoá đóng cả mười bốn, và phép kiểm ở mức KIỂU (chứ không ở mức tên)
là thứ đang giữ. Danh sách tên là phòng thủ theo chiều sâu, và **giờ chính con số 13 cũng được KIỂM** — đối
chiếu với bề mặt public thật của `FleetCore` bằng reflection, nên một tên rơi khỏi danh sách là một test đỏ chứ
không phải một câu văn trôi dần thành hư cấu. Đường gián tiếp thứ mười bốn cũng có nhân chứng riêng: **không
kiểu export nào của EdgeCore trao ra một `MachineState`.**

Bịt hai cái brief nêu tên là để ngỏ mười một cái còn lại.

**Giá phải trả: bằng không.** Ngoài `St4i.EdgeCore`, tên `FleetCore` xuất hiện trong **đúng một file mã chạy
được** — `St4i.EngineApi/Fleet/FleetHost.cs`. Mọi chỗ nhắc khác trong `src/` và `tests/` là chú thích.
`InternalsVisibleTo("St4i.EngineApi")` mà E-2 đã thêm (§10.5) phủ nó. Không một call site nào phải đổi.

🔴 **Hệ quả kèm theo, và nó đóng luôn §9.4(1) bằng cấu trúc:** bộ đọc `--fleet` thứ hai
(`FleetCore.ResolveFleetPath`, roster mặc định 10 máy) là một phương thức private trên một kiểu **không thể
gọi tên được** từ `St4i.EdgeService`. Nên **hai bộ đọc roster không thể gặp nhau**; bộ đọc duy nhất trong tiến
trình EdgeService là `EdgeWorker.LoadFleet` (8 máy). Cùng lý do đó, cái bẫy `AppContext.BaseDirectory`/
`mapping/` của §9.4(1) **không còn với tới được từ EdgeService** — không phải được cảnh báo, mà là không tồn tại.

🔴 **GIỚI HẠN CỦA KHẲNG ĐỊNH NÀY — bản đầu của mục này nói QUÁ, và review E-3 đã đính chính. Đọc đoạn này
trước khi trích dẫn bất cứ câu nào ở trên.**

Bản đầu viết: *"đường phân giải mã-máy → driver-ghi-sống … hoàn toàn không với tới được từ tiến trình này"*.
**SAI. Đường phân giải ấy DI CHUYỂN, nó không biến mất.** `ConnectorRegistry.TryGetInstanceIdForMachine` là
`public` trên `St4i.EdgeCore` — chú thích của chính nó gọi đó là *"the ONE lookup that makes per-machine write
routing possible"* — và `ConnectorRegistry.TryCreateDriver` cũng public ngay cạnh. E-2 làm cả hai public ở
EdgeCore; **E-3 đưa cho host này một registry đã được nạp** (`EdgeConnectors.Build` → `EdgeWorker`). Nên đoạn
sau **biên dịch được ngay hôm nay bên trong `St4i.EdgeService`, chỉ dùng bề mặt public**:

```csharp
registry.TryGetInstanceIdForMachine(machineCode, out var instanceId);
registry.TryCreateDriver(instanceId, out var driver, out _);
if (driver is IWritableDeviceDriver w) await w.WriteSetpointAsync(req, ct);
```

**Câu ĐÚNG, và nó hẹp hơn:** *hai thành viên ghi không hỏi chốt HALT của `FleetCore`, cùng **bảng slot sống**
của nó — thứ ánh xạ một máy tới đúng driver mà một pipeline đang chạy — không với tới được từ host nào ngoài
`St4i.EngineApi`. Còn **phép tra cứu** mã-máy → driver thì public trên `ConnectorRegistry`, và host này đang
giữ một cái.*

Hai điều giữ cho nó ở mức Important chứ không phải chí mạng, và chúng **không** đồng nghĩa với "không với tới
được": driver mà một đoạn như trên lấy được là một driver **MỚI**, không phải driver sống mà pipeline đang
cầm — nó không cướp được một pipeline đang chạy; và dựng nó là **thêm mã dựng driver**, một hành vi thấy được
khi review, chứ không phải ép kiểu một tham chiếu sẵn có.

Và giới hạn phẳng: driver mà host này dựng từ `connectors.json` **chính là** `IWritableDeviceDriver` (một
`ModbusTcpDriver` là), vì driver là thứ giữ cổng — không phép đổi visibility nào sửa được điều đó.

→ **E-4:** nếu muốn đóng nốt phần còn lại, hạng mục là `ConnectorRegistry`, không phải `FleetCore`.

**Nhân chứng:** `tests/St4i.EdgeService.Tests/EdgeAgentWriteSurfaceTests.cs` (7 `[Fact]`), chạy **từ
`St4i.EdgeService.Tests`** — assembly không có `InternalsVisibleTo` từ EdgeCore, nên "không export" ở đó nghĩa
đúng như với host sản phẩm. Phép kiểm là **liệt kê** (mọi kiểu export, mọi thành viên public, so với cả tập
cấm), không phải tra tên hai thành viên rồi thấy vắng. Ba trong bảy `[Fact]` là **đối chứng dương**.

🔴 **Và review E-3 chứng minh nó ở mức MẠNH HƠN reflection — ở mức TRÌNH BIÊN DỊCH:** một file probe thêm vào
chính assembly sản phẩm `St4i.EdgeService`, chỉ nhắc tên `FleetCore`, cho
`error CS0122: 'FleetCore' is inaccessible due to its protection level`. Reflection nói về bề mặt export; câu
này nói về thứ trình biên dịch chịu chấp nhận, và đó mới đúng là điều cần khẳng định.

🔴 **Một chỗ danh sách cấm ban đầu SAI, và cách sửa đáng giữ:** `ApplyMode` nằm trong danh sách ở bản đầu, và
phép liệt kê lập tức bắt được `St4i.EdgeCore.Transport.TransportCoordinator.ApplyMode` — **không phải thành
viên fleet**. `FleetCore.ApplyMode` chỉ chuyển tiếp một dòng tới đúng API transport công khai có sẵn ấy. Sửa
bằng cách **bỏ tên khỏi tập**, không bằng cách miễn trừ `TransportCoordinator` — một danh sách miễn trừ là một
cái lỗ trong một phép liệt kê.

### 11.2 `EdgeAgentPipelines` — vì sao KHÔNG phải facade trên `FleetCore`

`St4i.EdgeCore.Engine.EdgeAgentPipelines` (public): N driver, N `EdgePipeline`, một transport, cô lập lỗi theo
từng pipeline, tự dựng/sở hữu/dispose driver, **không thành viên nào nhận, trả hay phơi một `IDeviceDriver`**.

**Facade trên `FleetCore` bị loại vì một cản trở cứng, không phải vì sở thích:** ctor của `FleetCore` đòi
`SwitchableTransport` **và** `TransportCoordinator`, mà `TransportCoordinator` lại đòi một cặp `LiveTransport` +
`AutoTransport` sống. `EdgeWorker` phân giải **một** `ITransport` (Demo hoặc Live, gắn một mã máy). Dựng cả
tầng điều phối transport của EngineApi bên trong tác nhân biên — cho một vòng đời không bao giờ đổi mode — là
thêm nhiều máy móc hơn phần tái sử dụng được, và kéo theo roster resolver, scenario, KPI, `MachineState`,
`UpdateSettings`.

🔴 **Một khoá MỚI đã được dựng rồi gỡ, ghi lại vì hình dạng đáng giữ.** Bản đầu phát `Committed` **dưới một
khoá** để giữ cho bộ đếm `++` không nguyên tử của `EdgeWorker` đúng khi có N pipeline. Đó là dựng lại đúng hình
dạng §10.3 cảnh báo — subscriber của `EdgeWorker` **ghi log và huỷ một token**. Đã đổi: sự kiện phát **không
giữ khoá nào**, subscriber dùng `Interlocked.Increment`, và `_stateGate` chỉ còn giữ hai `List<>`.
**Đi bộ theo khả năng với tới trên khoá mới: ba vùng `lock`, cả ba chỉ là thao tác list — không I/O, không
`Dispose`, không callback do host cung cấp.**

### 11.3 Bốn đường `_gate` của §10.3: KHÔNG TĂNG, và dụng cụ là một cái diff

Tiêu chí §10.3(c) nêu đúng đại lượng: *số thao tác **I/O hoặc `Dispose`** với tới được dưới `_gate`*.
`git diff 487f4cf5..HEAD -- src/St4i.EdgeCore/Fleet/FleetCore.cs`, bỏ mọi dòng `///`, cho ra **đúng một cặp
dòng**: `public sealed class FleetCore` → `internal sealed class FleetCore`. Không một lệnh chạy được nào
trong file đổi, nên tập lệnh chạy dưới `_gate` **giống hệt từng byte** với BASE và số thao tác I/O-hoặc-Dispose
với tới được **không đổi, cộng 0**. Một diff chỉ đổi chú thích cộng một từ khoá là bằng chứng **kết luận** về
cây mã (§8.1 của Đợt D). Bốn đường của §10.3 + hai `Cancel` của §10.3(d) vẫn còn nguyên, không sửa.

### 11.4 Store toàn máy `EdgeWorker` chạm sau E-3 — liệt kê đầy đủ, KHÔNG người ghi mới

| Store / gốc dữ liệu | Đọc hay ghi | Có sẵn hay E-3 thêm |
|---|---|---|
| `CredentialStore` (`%ProgramData%\ST4I\sim\creds`) | **ĐỌC** (chỉ khi Live) | có sẵn |
| WAL queue (`WalOptions.EnsureDir` + `ResolveQueueFile`) | **GHI** | **có sẵn** — `BuildTransport` đã làm từ WS-C |
| `connectors.json` (cạnh exe, hoặc `--connectors`) | **ĐỌC** | E-3 thêm, **chỉ đọc** |
| `fleet.json` / `--fleet` | **ĐỌC** | có sẵn |
| Biến môi trường `ST4I_*` (`ModbusOptions.FromEnvironment`, `WalOptions`, `DemoModeGate`, server URL / machine code / TLS) | **ĐỌC** | `ModbusOptions` là E-3, chỉ đọc |
| `AssetRegistryStore` | **KHÔNG CHẠM** | — |
| `FleetSettingsStore` | **KHÔNG CHẠM** | — |
| `%ProgramData%\ST4I\sim\opcua-pki` | **KHÔNG CHẠM — và đó là một quyết định** | xem dưới |

🔴 **OPC-UA bị TỪ CHỐI ở EdgeService vì đúng phán quyết của brief, không phải vì thiếu kiểu.**
`OpcUaConnectorFactory` nằm sẵn trong EdgeCore và sẽ biên dịch được. Cái chặn nó là `OpcUaDriver` ghi chứng chỉ
app-instance của nó vào `OpcUaPkiPaths.ResolveRoot` — `%ProgramData%\ST4I\sim\opcua-pki`, **toàn máy, không
khoá theo tiến trình**. Dispatch nó ở đây sẽ biến `St4i.EdgeService` thành **một người ghi mới vào một store
toàn máy**. Một entry OPC-UA bị bỏ qua kèm cảnh báo nêu đúng lý do, và có test ghim
(`AnOpcUaEntry_IsRefusedByName_…`) để nó là một quyết định chứ không phải một chỗ sót ai đó "sửa" bằng cách
thêm một nhánh `switch`.

🔴 **Đính chính của review E-3 — bản đầu viết "bật nó lên là một nhánh `switch`", và câu đó nói NHẸ đi cái đã
có sẵn.** Gốc PKI **đã được tham số hoá rồi**: `OpcUaConnectorFactory(map, pkiDir, …)` nhận nó làm đối số hàm
dựng, và `OpcUaPkiPaths.ResolveRoot` tôn trọng biến môi trường `ST4I_OPCUA_PKI_DIR`. Nghĩa là **cơ chế để cho
tác nhân biên một gốc PKI riêng đã tồn tại**; thứ còn thiếu là **quyết định** gốc dữ liệu theo host — nơi nó
nằm, ai đặt biến, và điều gì xảy ra với các cài đặt đã có. Từ chối vẫn là đúng dưới phán quyết không-thêm-người-ghi
của brief (E-3 không được tự chọn một gốc mới), nhưng bản ghi phải nói đúng: **cái chặn là một quyết định, không
phải một hạ tầng còn thiếu.**

### 11.5 Đường đọc `connectors.json`: một bộ phân tích, hai bộ dispatch — và vì sao

**`ConnectorsConfig` đã dời** `St4i.EngineApi.Config` → **`St4i.EdgeCore.Config`** (274 dòng, là nút lá thật:
chỉ phụ thuộc `System.Text.Json` + `DriverKinds`). Cả hai host giờ đọc file, áp dụng dung sai theo từng entry,
và giải quyết precedence qua **một** bản cài đặt.

**`ConnectorsJsonRegistration` (dispatch) KHÔNG dời, và đây là lý do đo được:** nó cần `ILogger`,
`ConnectorConfigValidation`, `ModbusRtuBusPlan` và `ModbusMultidropRegistration`; cái cuối gọi
`RtuBusConfiguration.IsInBusNamespace`, một luật mà **chính chú thích của nó nói phải phát biểu đúng MỘT lần vì
ba caller phải khớp nhau**. **Nó không phải nút lá** — đúng hình dạng §9.6(a). Dời nó là việc thật với rủi ro
thật, và gộp vào một nhiệm vụ vòng đời là cái bẫy "bản sửa và phép quét cảm giác như một hành động nhưng là hai".

Nên EdgeService có **composition root của riêng nó** (`EdgeConnectors.cs`), hẹp hơn có chủ đích:
- **Modbus TCP — CÓ.**
- **Modbus RTU (entry khai báo `transport`) — KHÔNG**, bỏ qua kèm cảnh báo nêu tên. Fan-out multidrop + ghost
  sweep là cái không-phải-lá ở trên; viết một fan-out thứ hai ở đây là **hai câu trả lời cho câu hỏi "đăng ký
  nào sở hữu thiết bị này"**.
- **OPC-UA — KHÔNG**, §11.4.
- **Kind khác — KHÔNG**, giống EngineApi: build này không có plugin loader.

🔴 **MỘT CHỖ LỆCH CÓ CHỦ ĐÍCH SO VỚI EngineApi, ghi ra vì một chỗ lệch im lặng là một khiếm khuyết: mỗi entry
đăng ký dưới `id` CỦA CHÍNH NÓ, không dưới kind.** `ConnectorsJsonRegistration.RegistrationKeyOf` trả "kind"
cho entry TCP/OPC-UA, và chú thích của chính nó nói vì sao: lấy id của operator ở đó sẽ dời nhãn slot — và do
đó `TargetId` của alarm — của một cài đặt đang chạy. **Host này không có di sản đó** (nó chưa từng chủ trì một
connector nào), nên không có gì để rẽ nhánh. Keying theo id cũng là thứ làm cho "N entry nghĩa là N driver" nói
được ở đây; keying theo kind gộp mọi entry Modbus thành một.

### 11.6 🔴 Những gì E-4 vẫn phải đối mặt

- **RS-485 CHƯA chạy được trong `St4i.EdgeService`.** Đây là giới hạn lớn nhất E-3 để lại. Reference tới
  `St4i.EdgeCore.Serial` vẫn chỉ làm transport *sẵn có*. Khối lượng còn thiếu, đã đo: `ModbusRtuBusPlan`
  (108 dòng, **là nút lá** — chỉ phụ thuộc `EdgeCore.Drivers.Modbus` + `EdgeCore.Serial`, dời sang
  `St4i.EdgeCore.Serial` là sạch), `ModbusMultidropRegistration` (344 dòng, ILogger → cặp callback, **không
  phải lá**: kéo `RtuBusConfiguration.IsInBusNamespace`), `ConnectorConfigValidation` (254 dòng, phụ thuộc chỉ
  EdgeCore + Abstractions, có vẻ là lá). Không dời được `RtuBusConfiguration` nguyên khối: nó cũng ôm
  `TryFindBlockedDevice`/`ReleaseOwnNamespace` và bám vào roster + store của EngineApi.
- **Hai bộ dispatch `connectors.json`.** Đã quyết định, đã ghi, có test — nhưng vẫn là hai. Chúng hợp nhất
  được đúng khi `ModbusMultidropRegistration` xuống được EdgeCore, không sớm hơn.
- **§9.4(2) hai tiến trình, một bộ file dữ liệu toàn máy — CHƯA CHẠM, và E-3 không làm nó gần hơn.**
  `AssetRegistryStore`/`FleetSettingsStore` vẫn không bị EdgeWorker chạm; WAL vẫn là người ghi có sẵn duy nhất.
  Quyết định gốc-dữ-liệu-theo-host vẫn là của chủ sở hữu, và **nó đang chặn OPC-UA ở tác nhân biên**.
- **§10.4 kênh log thứ ba** (khôi phục độ mịn `LogDebug` bị E-2 nâng lên `LogError`) — **chưa làm.**
- ~~**§10.9 bài test mTLS có cuộc đua tắt máy** — **chưa sửa**~~ 🔴 **SAI — ĐÃ SỬA, ở `487f4cf5`, HAI COMMIT
  TRƯỚC E-3** (review toàn nhánh, I7). Bản sửa nêu đúng cơ chế (TLS 1.3 NewSessionTicket không được rút,
  `SslStream.Dispose` không gửi `close_notify`, Windows gửi RST thay vì FIN). **Và §11.3 lấy CHÍNH
  `487f4cf5` làm mốc diff**, nên dòng này mâu thuẫn với một mục cách nó ba mục. Danh sách thừa kế đã được
  **chép tới** chứ không được **kiểm**.
- **§10.3 hạng mục sửa `_gate` bốn đường + hai `Cancel`** — **chưa làm**, không tăng.
- **Chiều ghi (§3) vẫn không có đường xuống.** Máy do tác nhân biên cầm là **chỉ đọc**, và bây giờ điều đó là
  một lỗi biên dịch chứ không phải một câu. Việc của E-4 là cho **người vận hành** thấy điều đó ở nơi họ gặp
  nút ghi.
- **Transport serial vẫn chưa tải một khung tin nào trên phần cứng thật.** Đúng sau Đợt D, đúng sau E-2, vẫn
  đúng sau E-3.

## 12. 🔴 E-4 ghi lại — cái gì đã sửa, và những gì REVIEW TOÀN NHÁNH phải thừa kế

Toàn văn ở `.superpowers/sdd/2026-08-04-dotE-fleet-core-extraction/task-4-report.md`. Mục này tồn tại vì
`.superpowers/sdd/` bị gitignore và **một báo cáo không phải bản ghi nguồn**. Đây là nhiệm vụ cuối của Đợt E;
sau nó là review toàn nhánh rồi merge.

**Cổng:** `151/22/1080/46/1289 = 2588`, 0 lỗi, **116 cảnh báo**, 0 build node.

### 12.1 🔴 Tiền đề của brief ĐÚNG về lớp lỗi, SAI về cơ chế — và cái sai lớn hơn cái đúng

Brief đoán: một máy do tác nhân biên cầm sẽ cho `NoLiveDriver`, và chuỗi "không có driver cho máy này" phủ
**hai** đường sinh. **Lớp lỗi thì đúng. Cơ chế thì sai theo một hướng nặng hơn**, và nó lật một câu của
chính blueprint này:

🔴 **§2 viết *"nó đọc máy tại chỗ rồi ĐẨY LÊN EngineApi"*. Điều đó KHÔNG ĐÚNG.** `EdgeWorker` →
`LiveTransport` → `St4iDeviceClient` đẩy tới `POST {ST4I_SERVER_URL}/api/v1/ingest/…` (`Normalizer.cs:14–16`),
mặc định `http://localhost:5000` — **nền tảng ST4I**, không phải EngineApi. `St4i.EngineApi` lắng nghe ở
**`:5199`** (`Program.cs:70`) và **không map một route `api/v1` nào cả** (grep toàn project: rỗng). Nó cũng là
một *client* của cùng nền tảng đó (`Program.cs:290` dựng `LiveTransport.ForMachine(FleetHost.DefaultServerUrl …)`).
**Hai host không chung roster, không chung sổ chiếm mã máy, không chung một kênh nào.**

Hệ quả trực tiếp cho việc E-4 được giao:

- **Máy do tác nhân biên cầm KHÔNG xuất hiện trong roster của EngineApi.** Nên thứ người vận hành gặp trước
  tiên là **`404`**, không phải `409 NO_LIVE_DRIVER`. Chỉ khi người vận hành **tự tay khai lại cùng mã máy**
  trong `fleet.json` của EngineApi thì mới tới được 409 — không cơ chế nào tạo hay đối chiếu bản sao ấy.
- **EngineApi không có SỰ KIỆN nào để biết một tác nhân biên tồn tại.** Không phải "chưa lộ ra ở API"; là
  **không có kênh**. Nên câu trả lời trung thực đúng là cái brief để ngỏ: *không phân biệt được*, và đây là
  giá để phân biệt (§12.4).
- §2 vẫn đúng ở **kết luận** ("EngineApi là nơi duy nhất sở hữu roster/yêu sách/UI") và ở **phép đo hai
  tiến trình một thiết bị**. Chỉ **cơ chế** sai. Cùng hình dạng §9.3b: kết luận đúng, lý do sai, và lý do là
  thứ nhiệm vụ sau đọc.

### 12.2 🔴 Phép liệt kê tìm ra **BA** chuỗi sai và **HAI** bề mặt, không phải một chuỗi và hai đường

Bắt đầu từ *tập những chỗ biến một `MachineDriverAvailability` thành văn xuôi cho người vận hành*, chứ không
từ nút ghi. Kết quả: **hai** bề mặt, mỗi bề mặt một bản sao độc lập của cùng danh sách nguyên nhân, đã trôi
khỏi nhau — `MachineWriteEndpoints.NotAvailableResult` (thân HTTP mà web UI hiện **nguyên văn**:
`web/src/lib/api.ts` `MachineWriteApiError` → `MachineControlPanel.tsx:203,333`) và
`RelayNotificationChannel.UnavailableAsync` (**cảnh báo người vận hành đọc khi ĐÈN BÁO KHÔNG SÁNG**).

**Cả sáu chuỗi đều mặc định rằng MỘT CONNECTOR TỒN TẠI**, và ba trong bốn ca vì thế sai:

| Ca | Chuỗi cũ | Vì sao sai |
|---|---|---|
| `404` | *machine "X" not found* | Nêu lỗi gõ / chưa onboard. Máy do tác nhân biên cầm là máy thật, đang chạy, cấu hình đúng **ở nơi khác** — và đây là ca người vận hành gặp trước tiên (§12.1). |
| `409 NO_LIVE_DRIVER` | *fleet may be stopped, HALT latch may be engaged, or this machine's connector failed to start this run … then retry* | Cả ba nguyên nhân đều giả định có connector. Máy **không có connector nào ở đây** không khớp cái nào — **và đó chính là trạng thái mà bài test của chính ca này dựng ra** (`Setpoint_MachineKnownButFleetNeverStarted_409_NoLiveDriver`). |
| `409 READ_ONLY` | *this connector declares no writable points or commands* | Nguồn sinh phổ biến nhất là máy do **nhóm mô phỏng có sẵn** lái — không có connector nào. **Cũng đúng trạng thái bài test của ca này dựng ra.** |
| `409 AMBIGUOUS_DRIVER` | (không đổi về nội dung) | Một đường sinh, chuỗi đúng. |

🔴 **Và "rồi thử lại" không chỉ vô dụng — nó nguy hiểm.** Nước đi hiển nhiên nó gợi ra là *cấu hình một
connector ở đây*, tức đặt **một tiến trình thứ hai lên một thiết bị đã có tiến trình khác lái**. Bảng của §2
đã đo: qua **gateway TCP** cả hai kết nối bình thường và **không ai chặn**. Chuỗi mới nói thẳng điều đó.

**Vì sao không có tests nào bắt được:** mọi bài test của bốn ca này khẳng định **status + reason code**, và
chỗ gần nội dung nhất là `Assert.False(string.IsNullOrWhiteSpace(body.Error))` — đúng với mọi chuỗi, kể cả
chuỗi sai. *Một khẳng định không-rỗng trên một chuỗi hướng-người-vận-hành là một khẳng định rỗng.*

### 12.3 Bản sửa: MỘT phát biểu, HAI cách trình bày — và vì sao KHÔNG đụng lõi

`MachineWriteGate.ExplainUnavailable(availability, machineCode)` (EngineApi, đúng chỗ C-6 đã đặt
`SetpointAction`/`AnyCriticalAlarmActiveAsync` và **vì đúng lý do đó**: bản sao riêng thứ hai là cách một
phát biểu lặng lẽ thành hai). Cả hai bề mặt gọi nó; `MachineWriteEndpoints` giữ **status + reason code**,
`RelayNotificationChannel` giữ **RelayOutcome**.

🔴 **Không thêm thành viên nào vào `FleetHost`, không đọc thêm thứ gì từ lõi, và điều đó BỊ ÉP chứ không phải
được chọn.** Thu hẹp `NO_LIVE_DRIVER` xuống "connector có cấu hình nhưng không khởi động được" *đối lại*
"không có connector nào" là việc EngineApi **làm được** (registry + `GetConfiguredConnectorIssues` + `IsRunning`
đều có) — nhưng làm ở vỏ nghĩa là **đọc hai thứ từ lõi rồi ghép**, đúng cái §10.1 cấm, và ngoại lệ duy nhất
đã dán nhãn là `FleetHost.CurrentScenarioDto()`. Làm trong lõi thì phải thêm một giá trị enum
`MachineDriverAvailability` — **đã cân nhắc và bỏ**, xem §12.5. Và với đường sinh mà đợt này quan tâm — máy do
tác nhân biên cầm — **sự kiện để thu hẹp không tồn tại ở bất cứ đâu** (§12.1), nên "nêu tên cả hai đường"
không phải một sự thoả hiệp: nó là phát biểu đúng.

**Nhân chứng:** `MachineWriteUnavailableMessageTests.cs` (6 `[Fact]`, file mới) khẳng định nội dung theo từng
đường sinh; **một trong sáu là nhân chứng-gộp** (bốn chuỗi phải đôi một khác nhau, nên một chuỗi chung chung
"không khả dụng" không thể làm xanh năm cái kia). Bốn khẳng định **join** — thân HTTP và cảnh báo relay phải
BẰNG/CHỨA đúng `ExplainUnavailable(...)` — nằm trong các bài test **đã có sẵn** và **tốn 0 test**: chúng thay
những khẳng định rỗng, và việc con số không dịch chính là bằng chứng rằng trạng thái đã được phủ, chỉ có khẳng
định là trống.

### 12.4 Cần gì để thật sự phân biệt "chưa cấu hình" với "do tác nhân biên cầm"

Hỏi và trả lời hẳn, vì brief yêu cầu *"đây là thứ cần có"* chứ không phải một lời hứa:

Tác nhân biên phải **ĐĂNG KÝ** với EngineApi ⇒ cần một **yêu sách mã máy XUYÊN TIẾN TRÌNH**. Hôm nay yêu sách
ấy là một `ConcurrentDictionary` **trong một tiến trình** (§2, đã grep lại: `Fleet/` và `Drivers/Modbus/` không
có mutex/lockfile/named primitive nào), và bảo vệ duy nhất giữa các tiến trình là hệ điều hành từ chối lần mở
thứ hai của một **cổng COM** — qua **gateway TCP** không có gì cả. **Nên cho engine biết điều đó = xây luôn
yêu sách xuyên tiến trình.** Đó là một đợt việc có lập luận an toàn riêng, không phải một trường trong DTO,
và nó đứng **trước** phương án (2) của §3 (endpoint kéo lệnh) chứ không phải sau: một đường xuống tới một tác
nhân biên mà engine không biết là ai thì không định tuyến được.

### 12.5 Ba thứ đã cân nhắc và CỐ Ý không làm — ghi ra để review khỏi phải hỏi

1. **Thêm giá trị `MachineDriverAvailability` mới** (ví dụ `NoConnectorConfigured`) để lõi tự phân biệt.
   Bỏ vì: đây là nhiệm vụ **cuối** của đợt, việc đó đổi một enum `public` của EdgeCore, chạm
   `RelayNotificationChannel`, `MachineWriteEndpoints`, `web/src/lib/api.ts` và có khả năng lật giá trị kỳ
   vọng của nhiều test sẵn có — tức là **một bản sửa và một phép quét bị gộp làm một**, đúng cái §8.1 cấm.
   Nó **không** đóng được đường sinh tác nhân biên (sự kiện không tồn tại), nên giá trị nó mua là "chưa cấu
   hình" *đối lại* "cấu hình mà chết", một phân biệt mà chuỗi mới đã **nêu tên** cả hai. Hạng mục cho đợt sau.
2. **Sửa `web/`.** Không cần: UI hiện `serverMessage` **nguyên văn**
   (`MachineControlPanel.tsx:203,333`), và bài Playwright `web/tests/25-machine-write.spec.ts:168` dùng thân
   phản hồi **giả lập** chứ không phải chuỗi thật của server. **E-4 không chạm `web/`, nên Playwright không
   phải chạy và không được đứng làm bằng chứng cho bất cứ điều gì.**
3. **Dịch các chuỗi ấy sang tiếng Việt.** Toàn bộ bề mặt lỗi HTTP của sản phẩm này là tiếng Anh; thêm i18n
   cho đúng bốn chuỗi là một quyết định sản phẩm, không phải một bản sửa.

### 12.6 🔴 Census: bốn khẳng định README đã chết, và MỘT trong số đó chưa bao giờ đúng

Quét **theo quy tắc** (*"Đợt E đổi gì về việc host nào chủ trì được connector nào, trên transport nào"*), không
theo danh sách. §23.6 là nơi tập trung, nhưng §20.5 **nhắc lại** một trong các khẳng định ở một mục nhan đề
"Honest limitations" — đúng hình dạng Đợt D dạy: *chỗ bị sót là chỗ được **xếp** ở nơi khác*. Cả hai chỗ đã
sửa, cả hai khối ngôn ngữ, và **sửa tại chỗ chứ không viết đè**, theo đúng quy ước README đã dùng cho D-7b.

| Khẳng định README | Trạng thái | Ai làm nó sai |
|---|---|---|
| *"`ConnectorRegistry`, `ConnectorsConfig`, `ConnectorsJsonRegistration` … không với tới được"* | **SAI** cho hai cái đầu | E-2 (registry) và E-3 (config) dời chúng xuống EdgeCore. Chỉ `ConnectorsJsonRegistration` còn của riêng EngineApi. |
| *"`EdgeWorker` gộp cả đội hình vào một `SimulatedDriver` chạy một pipeline"* | **SAI** | E-3 |
| *"Thứ cản đường là lõi 2 406 dòng của `FleetHost`, thứ cả ba host sẽ phải dùng chung"* | **SAI** | §1.1(a) — tác nhân biên không dùng lõi và về cấu trúc không thể |
| *"**Chỉ `St4i.EngineApi` mở được cổng COM**"* (§23.6 **và** §20.5) | 🔴 **CHƯA BAO GIỜ ĐÚNG** nếu hiểu là **khả năng** | **Không phải Đợt E.** Sai kể từ chính D-7c — cái ruling cho cả ba host tham chiếu `St4i.EdgeCore.Serial`. |

🔴 **Khẳng định thứ tư đáng đọc kỹ, vì nó là §11.1 lặp lại ở một trục khác.** `SerialPortBusLink.OpenAsync` và
`SerialLineSettings` đều `public` trên `St4i.EdgeCore.Serial`; cả ba host `ProjectReference` nó. **Đo bằng hai
dụng cụ, không đọc:** (a) một file probe biên dịch vào **chính assembly sản phẩm `St4i.EdgeService`** gọi
`SerialPortBusLink.OpenAsync(new SerialLineSettings("COM3"), default)` build ra **0 lỗi, 0 cảnh báo** (đối
chứng: cùng chỗ đó, chỉ nhắc tên `FleetCore` cho `CS0122` — §11.1); (b) `EdgeServiceSerialReachabilityTests`
(mới, `St4i.EdgeService.Tests`, project **chỉ** tham chiếu `St4i.EdgeService`) thực sự mở một cổng và bị **hệ
điều hành** từ chối, không phải trình biên dịch. **Câu đúng là về CẤU HÌNH**: chỉ `St4i.EngineApi` có một
đường đã cấu hình từ `connectors.json` tới một lệnh mở serial. **E-3 nói đúng chuyện này trong chú thích
csproj của chính nó** (*"still for a scoping reason rather than a capability one"*) — README thì không, và
README mới là thứ được phát hành.

**Vì sao phân biệt này chịu lực chứ không phải bắt bẻ chữ:** bảo vệ duy nhất của §2 cho một cổng cắm thẳng
**CHÍNH LÀ** việc hệ điều hành từ chối lần mở thứ hai. Người đọc tin rằng `St4i.EdgeService` *không thể* mở
cổng sẽ không bao giờ hỏi tiến trình nào đang giữ COM3 — và trên **gateway** thì không có bảo vệ nào để mà
hỏi.

**README mới có §24** (EN + VI đầy đủ), nói: lõi đã dời và tác nhân biên **không** chạy nó; EdgeService chủ
trì connector — **Modbus TCP và chỉ Modbus TCP trên dây**, RTU và OPC-UA **từ chối theo tên**, cả hai có test
ghim; **RS-485 ở biên là E-5**, kèm số đo; máy do tác nhân biên cầm là **chỉ đọc** và engine **không nhìn thấy
được** điều đó; và §24.5 nói lại khẳng định cổng COM cho đúng.

### 12.7 Những gì review toàn nhánh vẫn phải đối mặt — CHƯA hề nhẹ đi

Danh sách của §11.6, cộng những gì E-4 thêm. **E-4 không đóng cái nào trong số này**, và không cái nào là của
E-4 để đóng:

- **§10.3 hạng mục sửa `_gate`: BỐN đường I/O + HAI `Cancel`** — chưa làm, **không tăng**. E-4 chạm
  `FleetCore.cs` đúng **một chú thích XML** (phép quét sau-commit ở §12.9 bắt được một câu E-3 làm sai còn
  nằm trong đó); **không một lệnh chạy được nào đổi**, nên tập lệnh chạy dưới `_gate` **giống hệt từng byte**
  với sau E-3, đúng dạng bằng chứng §11.3 đã dùng. Phép đo của §11.3 vẫn đứng nguyên và không cần chạy lại.
- **§10.4 kênh log thứ ba** (khôi phục độ mịn `LogDebug` bị E-2 nâng lên `LogError`, ba đường tháo dỡ giờ ghi
  Event Log đồng bộ) — **chưa làm**.
- ~~**§10.9 bài test mTLS có cuộc đua tắt máy** — **chưa sửa**~~ 🔴 **SAI, và đây là bản sao thứ hai của
  cùng một dòng sai** (review toàn nhánh, I7): **đã sửa ở `487f4cf5`**, hai commit trước E-3. Tôi chép mục
  này từ §11.6 mà không kiểm nó — đúng cơ chế mà cả bản ghi này tồn tại để ngăn, và nó đi qua tôi ở đúng
  nhiệm vụ viết ra mục "cái gì review toàn nhánh phải thừa kế".
- **§9.4(2) hai tiến trình, một bộ file dữ liệu toàn máy** — **chưa chạm**, và quyết định gốc-dữ-liệu-theo-host
  vẫn là của chủ sở hữu. Nó vẫn **đang chặn OPC-UA ở biên**.
- **§11.1 phép tra cứu `machineCode → driver` là `public` trên `ConnectorRegistry`** và EdgeService giữ một
  registry đã nạp — **chưa đóng**, và E-4 khẳng định lại: hạng mục là `ConnectorRegistry`, không phải
  `FleetCore`. Không câu nào trong README §24 hay trong mã E-4 viết nói định tuyến ấy không với tới được.
- **E-5 (§6.1)** — RS-485 ở tác nhân biên. Giờ đã có mặt trong README §24.3 kèm số đo, nên nó là một hạng mục
  công khai chứ không phải một ghi chú nội bộ.
- **Transport serial vẫn chưa tải một khung tin nào trên phần cứng thật.** Đúng sau Đợt D, sau E-2, E-3, và
  sau E-4.

### 12.8 🔴 Ba điều review toàn nhánh nên KIỂM LẠI, không phải đọc lại

1. **§2 của blueprint** — sửa cơ chế theo §12.1, hoặc phán quyết ngược lại tôi. Câu *"đẩy lên EngineApi"* vẫn
   nằm đó và mọi lập luận về "một nguồn sự thật" đọc lên khác hẳn khi biết hai host chỉ là hai client của
   cùng một nền tảng.
2. ~~**Con số "bảy lần"**~~ — 🔴 **ĐÃ ĐÓNG bởi review E-4 (C4), bằng cách BỎ con số.** Nó từng đứng trong ba
   sản phẩm phát hành (`MachineWriteGate.cs` — một chú thích XML sản phẩm — cộng README §24.4 hai chỗ) **với
   giọng của một phép đo**, trong khi chính tôi ở đây từ chối bảo chứng cho nó. Review nói đúng: *một con số
   chưa đo, phát biểu bằng giọng của một phép đo, chính là lỗi dụng cụ mà đoạn kết của tôi nêu tên.* Cả ba
   chỗ giờ phát biểu lớp lỗi **định tính** ("một chuỗi phủ nhiều đường sinh và chỉ đúng với vài đường") và
   không mang con số nào. Nếu ai muốn con số ấy, nó phải được **liệt kê**, không được kế thừa.
3. **`ExplainUnavailable` ném cho `Writable`.** Ở `RelayNotificationChannel` đường đó không với tới được (cả
   hai bên gọi chỉ vào khi kết quả là `null`), và nếu có ai làm nó với tới được thì
   `ApplyAndCountAsync`'s catch-all biến nó thành `RelayOutcome.Lost` **có báo lỗi** — to hơn cái mặc định
   vỗ-về cũ, nhưng vẫn là một hành vi mới trên một đường trước đây câm. Đã cân nhắc, chọn ném; review có thể
   không đồng ý.

### 12.9 🔴 Phép quét SAU khi commit xanh — và nó bắt được hai chỗ nữa

**Bản sửa và phép quét là hai hành động** (§8.1). Phép quét chạy **sau** khi hai commit đã xanh, và nó tìm
thấy hai khẳng định nữa mà cả census lúc đang sửa lẫn census của E-3 đều bỏ sót — **cả hai nằm trong mã, không
nằm trong README**, tức đúng chỗ mà một census "quét tài liệu" không nhìn tới:

1. **`src/St4i.EdgeCore/Fleet/FleetCore.cs:123`** (mã sản phẩm) — *"`St4i.EdgeService`, whose `EdgeWorker`
   collapses the whole fleet into one `SimulatedDriver` on one `EdgePipeline`"*. **E-3 làm câu này sai và
   không sửa nó.** Đã chuyển sang thì quá khứ kèm đính chính tại chỗ. Chỉ là chú thích XML — **không một lệnh
   chạy được nào đổi**, nên §11.3 vẫn đứng.

2. **`tests/St4i.EdgeCore.Tests/Drivers/Modbus/SerialDependencyScopingTests.cs:96–113`** — đoạn chú thích của
   `EdgeServiceDeployment_CarriesSystemIoPorts_ByTheAllThreeHostsRuling` có **bốn** câu sai: *"this host can
   open a COM port today, which it cannot"* (chưa bao giờ đúng), *"no `ConnectorRegistry`, no
   `IConnectorFactory`, no `connectors.json` reader"* và *"builds one `SimulatedDriver`"* (sai từ E-3), *"
   `ConnectorRegistry` … are `St4i.EngineApi` types"* (sai từ E-2). Chuỗi mô tả trong chính lời gọi assertion
   cũng nói *"it has no connector registry to open a port from today"*. Đã sửa cả năm.

🔴 **Điều đáng giữ hơn hai chỗ ấy: `AssertSerialDependencyIsShippedWith` KHÔNG hỏng.** Nó khẳng định
*"DLL có được ship cùng deployment này không"* — một sự thật kiểm được — chứ không khẳng định *"host này mở
được cổng không"*. Chính lựa chọn đó là thứ cho phép **ba câu quanh nó** trôi thành sai mà **không bài test
nào đỏ**. Đó vừa là lời khen cho tác giả bài test, vừa là hình dạng của rủi ro còn lại: *một khẳng định hẹp,
đúng và bền có thể sống nhiều đợt bên trong một đoạn văn đã sai hết.* Không phép kiểm nào bắt được cái đó; chỉ
một phép quét theo quy tắc, chạy như một hành động riêng, mới bắt được.

**Và cái phép quét cơ học BỎ SÓT, báo cáo theo yêu cầu:** grep tổ chức theo *từ ngữ* (`only … can open`,
`EdgeService`, `ConnectorRegistry`, `COM port`) tìm ra §23.6 và §9 ngay lập tức, nhưng **§20.5 phải đọc mới
thấy** — nó xếp dưới nhan đề "Honest limitations", dùng chữ *"can open one"* chứ không phải *"COM port"*, và
nằm trong một khối `>` đính chính của một đợt TRƯỚC. Còn hai chỗ ở §12.9 này thì **grep tìm ra được**, nhưng
chỉ khi phép grep được tổ chức theo *quy tắc* ("host nào chủ trì được connector nào") và **chạy trên `src/` và
`tests/` chứ không chỉ trên `*.md`** — census của E-4 lúc đang sửa chỉ quét tài liệu, đúng như brief phát biểu
nó, và đó là chỗ nó hụt.

## 13. 🔴 Vòng sửa của REVIEW TOÀN NHÁNH — cái gì đã sửa, và cái gì merge mang theo

Toàn văn phát hiện ở `.superpowers/sdd/2026-08-04-dotE-fleet-core-extraction/branch-review-findings.md`.
Verdict: **MERGE SAU KHI SỬA, không Critical.** Không đường nào cho một lệnh ghi tới sai máy, vượt chốt, rò
bí mật, hay chặn HALT lâu hơn trước khi cắt.

**Cổng sau vòng sửa:** `151/22/1080/46/1290 = 2589`, 0 lỗi, **116 cảnh báo**, 0 build node. Chỉ nhóm 3 chạm
một khẳng định chạy được; ba nhóm còn lại không đổi một lệnh nào.

### 13.1 I2 — ngoại lệ THỨ HAI, và ba biểu ngữ nói là không có

`FleetHost.MachineDetail()` đọc `_core.IsRunning` (một lần lấy `_gate`) **và** `_core.TryGetMachineState`
(không khoá) rồi ghép. Đã dán nhãn tại chỗ đúng như `CurrentScenarioDto` được dán, kèm **điều kiện huỷ ngoại
lệ** riêng của nó, và cả ba chỗ khẳng định "không cái nào" (`FleetHost.cs`, `FleetCore.cs`, §10.1) đổi thành
**"hai cái, cả hai đều dán nhãn"**.

Hành vi trùng từng byte với BASE — nên **không có gì thụt lùi**; cái sai là lời khẳng định. Điều đáng giữ:
**E-2 đã nhìn thẳng vào chính thành viên này** (§10.2 nói về việc bỏ khối `lock` của nó) **và vẫn viết chữ
"duy nhất"**. Nhân chứng cho cặp trên màn hình `GET /v1/safety` vẫn là hạng mục sau, không chặn merge.

### 13.2 🔴 I4 — một TRỤC census chưa ai quét, và nó rộng hơn con số review đưa ra

Quy tắc: ***"kiểu nào sở hữu cái khoá, assembly nào sở hữu kiểu này"*** — chạy như một hành động riêng, trên
`src/` **và** `tests/`, **kể cả chuỗi thông điệp khẳng định**.

Review liệt kê ~18 phát biểu. **Phép quét cơ học theo đúng quy tắc ấy tìm ra 32 chỗ trong 25 file**, vì tập
thành viên đã dời rộng hơn danh sách chịu lực: `StartLocked`, `StopLocked`, `StartSlot`,
`ResolveWritableDriver`, `OnPipelineCommitted`, `_totalCycles`, `_gate`, cộng `RestartTeardownTimeout`,
`ResolveFleetPath`, `WaitAndDisposeOldPipeline`. Hai chỗ chịu lực nhất, đúng như review nói:

- **`IWritableDeviceDriver.cs:17`** — **hợp đồng mà tác giả driver bên thứ ba được bảo phải tuân theo.** Nó
  bảo họ đừng gọi khi đang giữ `FleetHost._gate`; **`FleetHost` không có `_gate`**. Ai grep tên ấy không thấy
  gì và có thể đọc quy tắc thành đã lỗi thời. Giờ nêu `FleetCore._gate` và nói rõ vỏ không giữ khoá nào.
- **`DeviceDriverConformanceSuite.cs:485`** — **một chuỗi lỗi SỐNG, hiện trong CI**, không phải chú thích.

**Bốn chỗ nằm trong file EdgeCore vốn không nhìn thấy `FleetHost`** — tức chúng chưa bao giờ biên dịch được
như một `cref`; chúng sống sót vì project này **không bật `GenerateDocumentationFile`**, nên `cref` không
được kiểm bao giờ. Đó là cơ chế, không phải sự bất cẩn, và nó là lý do M6 tồn tại được.

### 13.3 🔴 I3 — bản sửa của E-4 cho lớp lỗi "chuỗi phủ đường sinh nó không có" đã ship kèm đúng lỗi ấy

Chuỗi `READ_ONLY` mới nói *"hoặc nó có một connector mà driver không khai điểm ghi nào"*. **Đường ấy không
sinh ra được giá trị ấy trong build này:** `ResolveWritableDriver` trả `ReadOnly` **chỉ khi** driver của slot
không phải `IWritableDeviceDriver`, và **cả ba `IConnectorFactory`** ở đây (`ModbusConnectorFactory`,
`ModbusRtuConnectorFactory`, `OpcUaConnectorFactory`) đều sinh driver **có** implement nó; không có plugin
loader. Một driver ghi được mà map không khai điểm ấy phân giải thành `Writable`, được thử, và trả
`Rejected`.

**Và `MachineWriteUnavailableMessageTests` đang GHIM mệnh đề sai ấy.** Khẳng định giờ **đảo chiều** — mệnh đề
phải VẮNG MẶT — cộng hai khẳng định cho hai nguồn sinh thật (nhóm mô phỏng, pipeline hot-folder) và một cho
việc chuỗi phải nói trạng thái kia thực sự làm gì (`rejected`). Doc của chính enum `ReadOnly` cũng ghi lại
phép liệt kê ấy, để hai chỗ không trôi khỏi nhau.

*Ghi thẳng: đây là lớp lỗi của đợt này, xuất hiện bên trong bản sửa cho lớp lỗi đó, có test bảo vệ. Lần thứ
ba trong hai đợt mà một bản sửa mang theo đúng hình dạng nó đang sửa.*

### 13.4 I7 và bảy mục Minor

- **I7** — §11.6 và §12.7 đều ghi bài test mTLS là *"chưa sửa"*. **Đã sửa ở `487f4cf5`, hai commit trước
  E-3**, và **§11.3 lấy chính commit ấy làm mốc diff**. Hai danh sách thừa kế **được chép, không được kiểm** —
  và nó đi qua tôi ở đúng nhiệm vụ viết ra mục "cái gì review toàn nhánh phải thừa kế". Cả hai đã đóng.
- **M1** `FleetHost` là **410** dòng, không phải 2 406 — con số cũ bám vào sai kiểu sau cuộc dời, và nó đang
  được dùng làm **lý do hoãn** phẫu thuật roster ở mã sản xuất.
- **M2** *"~730 ký tự"* là một **phỏng đoán nói bằng giọng đo đạc**, hụt ~12%. Đã đo: **526 / 827 / 661 /
  269** ký tự với mã máy 13 ký tự, và **nêu tên đầu vào** vì con số phụ thuộc vào nó. Đúng lỗi dụng cụ đã làm
  con số "bảy lần" bị gỡ một vòng trước.
- **M3** biểu ngữ kỷ luật khoá nói `_gate` là khoá **duy nhất** của cặp; `_kpiGate` khai báo 29 dòng dưới.
  Reviewer đã đi bộ: **không có nguy cơ lồng khoá** — câu sai, không phải khoá sai.
- **M4** bản kiểm kê `_gate` **trong mã** vẫn là bản đã bị §10.3 thay thế ("ba đường" thay vì **bốn đường I/O
  + hai `Cancel`**). Bản ghi bền của một hạng mục tồn đọng đang là bản cũ. Và §10.3(d) giờ **nêu tên thành
  viên thay vì số dòng**.
- **M5** doc của `ReadOnly` thiếu `ModbusRtuDriver` khỏi danh sách driver ghi được (từ D-5).
- **M6** bảy `cref` xuyên assembly trỏ tới kiểu đã dời, cộng `ModbusRtuBusPlan` **107** dòng chứ không phải
  108.

### 13.5 🔴 Điều merge phải mang theo — census có vấn đề về ĐỘ PHỦ QUY TẮC, không phải NGỮ LIỆU

§12.9 vừa thêm **ngữ liệu** vào §8.1 (`src/` + `tests/`, không chỉ `*.md`). **I1, I4, I5, I6 đều nằm trong
ngữ liệu ấy và vẫn bị bỏ sót**, vì mỗi lượt quét chạy **một quy tắc** — và quy tắc của E-4 ("host nào chủ trì
connector nào trên transport nào") **trực giao** với trục I4. Chủ sở hữu đang viết phần thêm cho §8.1 về việc
**liệt kê các QUY TẮC**, đúng cách §11.1 đã học liệt kê các THÀNH VIÊN. Bốn dữ kiện nó nên mang theo:

1. **Cùng một câu sống sót ba lượt, ở hai file** (I1). `FleetCore.cs:123` được §12.9 sửa; `FleetHost.cs:25`
   thì không. **Hai file ấy do E-2 tách ra từ MỘT file** — nên **văn xuôi bị nhân đôi là dư lượng ĐƯỢC MONG
   ĐỢI của chính đợt này**, và không quy tắc nào của ai đi tìm nó. *Sau một lần tách file, "tìm bản sao của
   câu vừa sửa" phải là một bước.*
2. **Một lượt sửa dừng ở khối doc** (I6) — cách chỗ ghi bài học ấy **hai mươi lăm dòng**, trong **cùng một
   file**, để lại một **chuỗi thông điệp khẳng định** nói ngược lại. *Chuỗi thông điệp là mã, không phải chú
   thích.*
3. **Danh sách thừa kế được chép, không được kiểm** (I7).
4. **Một khẳng định phổ quát có hai phản ví dụ, ở ba chỗ** (I2) — và hai trong ba là **biểu ngữ chịu lực của
   hai nửa đường cắt**.

### 13.6 Vẫn còn mở sau merge — không cái nào là chặn

- **§10.3 hạng mục `_gate`: bốn đường I/O + hai `Cancel`** — chưa làm, không tăng. Bản kiểm kê trong mã giờ
  đã đúng.
- **§10.4 kênh log thứ ba** — chưa làm.
- **§9.4(2) hai tiến trình, một bộ file dữ liệu toàn máy** — chưa chạm; vẫn chặn OPC-UA ở biên.
  🔴 **ĐÓNG MỘT NỬA bởi Đợt F, F-1 (2026-08-09), và ghi ở đây vì một danh sách thừa kế bị CHÉP chứ
  không được KIỂM là bài học I7 của chính §13.4.** Gốc dữ liệu theo host giờ là hình dạng triển khai
  **được hỗ trợ, có tài liệu và có test** (README §15.9; `PerHostDataRootsTests` suy ra cả tập thư mục
  lẫn tập biến từ `src/` nên store thứ mười bốn không thể ra đời mà thiếu biến;
  `PerHostDataRootIsolationTests` chứng minh hai gốc là vô hình với nhau QUA chính các store). Cơ chế
  đã có sẵn từ trước — F-1 không sửa gì; nó ĐO (bốn store trong brief, **mười ba** trong thực tế),
  DỰNG PHÉP CHẶN, và NÓI RA. **Nửa còn mở:** mặc định vẫn là một bộ file dùng chung, không có gì được
  di trú khi đổi gốc, và OPC-UA ở biên **vẫn bị từ chối theo tên** — điều kiện chặn đã hết, cái còn
  thiếu là `OpcUaOptions` riêng cho host đó, nhánh dispatch, và một test hai-gốc-hai-kho-chứng-chỉ.
  🔴 **Và F-1 KHÔNG đụng chuyện hai host cùng lái một sợi dây** — đó là vấn đề khác, giải bằng một
  RÀNG BUỘC triển khai chứ không phải một cơ chế phân xử: README §24.7.
- **§11.1 tra cứu `machineCode → driver` public trên `ConnectorRegistry`** — chưa đóng; hạng mục là
  `ConnectorRegistry`, không phải `FleetCore`. 🔴 **Và E-5 làm nó RỘNG RA, không giữ nguyên** (review E-5,
  M3): driver mà một đoạn dùng bề mặt public ấy dựng được giờ có thể là một `ModbusRtuDriver` trên một cổng
  COM thật ở tác nhân biên, không chỉ một `ModbusTcpDriver` — xem §14.5.
- **E-5** — RS-485 ở tác nhân biên (README §24.3, có số đo).
- **Nhân chứng cho cặp `GET /v1/safety`**, và **`TryGetMachineDetail` một-lần-khoá** để giết ngoại lệ I2.
- **Độ dài + i18n của bốn chuỗi** (§12.5).
- **E-5 ĐÃ ĐÓNG dòng RS-485 ở trên — xem §14.** Mọi mục còn lại trong danh sách này vẫn mở.
- **Transport serial vẫn chưa tải một khung tin nào trên phần cứng thật.**

## 14. 🔴 E-5 ghi lại — RS-485 chạy ở tác nhân biên, và những gì REVIEW phải thừa kế

Toàn văn ở `.superpowers/sdd/2026-08-04-dotE-fleet-core-extraction/task-5-report.md`. Mục này tồn tại vì
`.superpowers/sdd/` bị gitignore và **một báo cáo không phải bản ghi nguồn**.

**Nhánh:** `feat/rtu-at-the-edge`, BASE `af9316ac`.
**Cổng:** `151/22/1082/49/1290 = 2594`, 0 lỗi, **116 cảnh báo**, 0 build node.

🔴 **Đánh số: mục này là §14, không phải §13.** Brief nói "viết vào §13", nhưng §13 đã là vòng sửa của review
toàn nhánh Đợt E; ghi đè vào đó sẽ trộn hai bản ghi khác nhau. Mẫu §9=E-1, §10=E-2, §11=E-3, §12=E-4,
§13=review toàn nhánh được giữ nguyên, và §13.6 được trỏ tới đây.

### 14.1 Điểm chặn hoá ra là **một dòng**, và đó là điều đáng giữ nhất

`ModbusMultidropRegistration` "không phải nút lá" (§9.6(a), §11.5, §11.6) **vì đúng một tham chiếu**:
`RtuBusConfiguration.IsInBusNamespace`. Không phải một cụm phụ thuộc — một hàm static thuần, phụ thuộc đúng
**ba ký hiệu**:

| Ký hiệu | Khai báo ở | Ghi chú |
|---|---|---|
| `DriverKinds.Normalize` | **`St4i.Connector.Abstractions`** | gọi **hai lần, ngay đầu hàm** |
| `ModbusMultidropMap.LooksLikeADeviceInstanceId` | `St4i.EdgeCore` | |
| `ModbusMultidropMap.DeviceIdSuffixPrefix` | `St4i.EdgeCore` | |

🔴 **Bản đầu của mục này viết "cả ba đều đã ở EdgeCore" và liệt kê `DeviceInstanceId` thay cho
`DriverKinds.Normalize`. SAI ở cả hai đầu** — review E-5 bắt được: `DriverKinds` ở assembly hợp đồng, không ở
EdgeCore; còn `DeviceInstanceId` **không hề được gọi**. Cùng một thay đổi chứa **hai bản liệt kê** tập phụ
thuộc của **một** hàm và chúng **bất đồng ở hai trên ba mục** (§14.1 so với §14.2/báo cáo). Đó là ca §8.1(b)
**thứ năm**, lớn nhất tính theo số chỗ, và **một lượt census chạy riêng cho đúng lớp lỗi ấy đã bỏ sót nó**.

**Cái sống nguyên vẹn sau khi sửa dữ kiện:** nó tự nó **vẫn là một nút lá** — cả ba ký hiệu đều với tới được
từ EdgeCore, vì `St4i.Connector.Abstractions` là assembly hợp đồng nằm dưới đáy đồ thị tham chiếu mà mọi
project ở đây đều đã tham chiếu. Thứ không phải lá là **kiểu chứa nó**.

→ **Nó được DỜI, không nhân đôi.** Đích là `ModbusMultidropMap` — **kiểu khai báo ĐỊNH DẠNG `{bus}:unit{n}`
mà predicate giải mã** (`DeviceIdSuffixPrefix`, `LooksLikeADeviceInstanceId`), ngay cạnh `DeviceInstanceId`
thứ đúc ra định dạng ấy. Một predicate về một định dạng thì thuộc về nơi giữ định dạng — đó là lý do **nhà
mới**; còn lý do **cuộc dời an toàn** là một sự kiện khác và không được lẫn: ký hiệu thứ ba nằm ở assembly
hợp đồng. `RtuBusConfiguration.IsInBusNamespace` bị **xoá hẳn** (không để lại forwarder), hai bên gọi của
chính `RtuBusConfiguration` và `SweepGhosts` đều trỏ tới nhà mới. Vẫn **đúng một** phát biểu cho **ba** bên
gọi. Không có bản thứ hai để mà trôi. Ghim bởi `RtuBusRegistrationTests.TheBusNamespaceRule_…` (theory 10
hàng, để nguyên chỗ cũ theo tiền lệ E-3: `ConnectorsConfigTests` cũng ở lại khi `ConnectorsConfig` dời xuống).

*Bài học tổng quát hơn ca này: "X không phải nút lá" là một khẳng định về **kiểu**, và câu hỏi đắt tiền là về
**thành viên**. §11.5/§11.6 phát biểu đúng và vẫn dẫn tới một ước lượng cao hơn công việc thật, vì phép đếm
chạy trên kiểu.*

🔴 **Đính chính của chủ sở hữu + review, và nó thay cả gốc lẫn cái giá tôi nêu — xem §6.2(b), đây chỉ là con
trỏ:** gốc **không phải "chiều"**. Nó là **đơn vị của câu hỏi phải khớp đơn vị của câu trả lời**; phát biểu
thành một luật hai chiều sẽ mời người đọc sau đi tìm một **chiều** thay vì một **độ hạt**. Và cái giá không
phải "một ước lượng quá cao cũng là một ước lượng sai" — nó là §1.1: **một phép đếm ở tầng kiểu làm công việc
trông KHÔNG XẾP LỊCH NỔI**, và bốn nhiệm vụ đúng đã ship mà không có năng lực cả đợt tồn tại để giao.

→ 🔴 **Quy tắc hành động được, và ca này là bằng chứng cho chính nó:** khi ghi *"X không phải nút lá"*, ghi
**TẬP KÝ HIỆU** mà thành viên gây vướng phụ thuộc vào, **không phải TÊN** của tham chiếu gây vướng. §11.6 viết
*"nó với tới `RtuBusConfiguration.IsInBusNamespace`"* — toàn bộ câu trả lời nằm cách câu ấy **đúng một lần
giải tham chiếu**. Và bảng ba dòng ở trên là thứ đáng lẽ phải có ở §11.6; khi cuối cùng nó được viết ra ở bản
đầu của mục này, nó vẫn sai hai trên ba — nên quy tắc là *ghi tập ký hiệu **và liệt kê nó, đừng nhớ nó***.

### 14.2 Cái gì đã dời, cái gì KHÔNG — và một mục trong ước lượng của §11.6 là thừa

| Thành phần | Trước | Sau E-5 |
|---|---|---|
| `IsInBusNamespace` | `RtuBusConfiguration` (EngineApi) | `ModbusMultidropMap` (EdgeCore) — **dời, không chép** |
| `ModbusMultidropRegistration` (344) | `St4i.EngineApi.Config` | `St4i.EdgeCore.Config`, `ILogger` → cặp callback |
| `ModbusRtuBusPlan` (107) | `St4i.EngineApi.Config` | `St4i.EdgeCore.Serial` — assembly duy nhất thấy **cả hai** transport |
| `ConnectorConfigValidation` (254) | `St4i.EngineApi.Fleet` | **KHÔNG dời, và KHÔNG cần** — xem dưới |
| `RtuBusConfiguration` (501) | `St4i.EngineApi.Fleet` | **KHÔNG dời**, đúng như §11.6 đo |

🔴 **`ConnectorConfigValidation` nằm trong ước lượng của §11.6 và nó là thừa.** Nó tồn tại để **học mã máy** mà
blob `settings` mờ đục của một entry TCP khai báo. Một tuyến RTU không cần: `ModbusMultidropMap.FanOut` đã
phân tích từng thiết bị và trả `device.MachineCode` ra trực tiếp, và `RegisterAll` truyền thẳng nó vào
`ConnectorRegistry.Register`. 254 dòng trong ước lượng, 0 dòng trong công việc. **Ước lượng liệt kê theo
"những gì `ConnectorsJsonRegistration` gọi"; phép liệt kê đúng là "những gì đường RTU cần".**

### 14.3 🔴 Hai quy tắc khoá **KHÔNG hội tụ**, và lời đoán của E-3/E-4 sai — phép liệt kê giải quyết

§6.1(1) và §11.5 (và README §24.2) đều nói hai quy tắc *"hội tụ miễn phí đúng lúc `ModbusMultidropRegistration`
xuống tới EdgeCore"*. **Ngày đó là E-5. Chúng không hội tụ.** Liệt kê theo **lớp đầu vào**, không theo tên
hàm:

| Lớp đầu vào | EngineApi | EdgeService | Cuộc dời có đổi gì không |
|---|---|---|---|
| Tuyến RTU | `Normalize(entry.Id)` | `Normalize(entry.Id)` | **Đã khớp từ trước.** E-5 biến nửa *"entry này có phải một tuyến không"* thành **mã dùng chung** (`ConnectorsConfig.IsRtuBus`), nên hai bản trùng nhau thành một. |
| TCP | `entry.Kind` | `Normalize(entry.Id)` | **Không.** |
| OPC-UA | `entry.Kind` | `Normalize(entry.Id)` | **Không.** |

Và **không chiều hội tụ nào khả dụng**: EngineApi lấy id chính là cuộc migration nhãn slot/`TargetId` mà nó đã
từ chối hai lần và có test ghim (`TheEntrysOwnIdIsNotAdoptedAsTheInstanceId_…`); còn EdgeService lấy kind sẽ
**gộp N entry Modbus TCP** — N socket, N máy — **thành một**, tức xoá một năng lực E-3 đã giao, và tuyến RTU
**không thay thế được** nó (một tuyến là N thiết bị trên MỘT sợi dây, không phải N socket).

→ Nó ở lại là **ca chấp nhận được** của hình dạng §7.1 Đợt D, đúng như review E-3 phán — nhưng vì lý do đã
liệt kê, không vì một lời hứa. Mỗi bên có test riêng (`ConnectorsJsonRegistrationTests` /
`EdgeWorkerConnectorsTests.NEntries_YieldNRegisteredInstances_…`).

*Vì sao lời đoán sai: nó suy từ **cơ chế** ("RTU là hình dạng duy nhất sinh ra N ở EngineApi, nên khi nó dời
thì hai bên hết lý do khác nhau") mà không liệt kê **các lớp đầu vào**. Đúng §9.3b: một kết luận phát biểu
bằng giọng của phép liệt kê, sinh ra từ việc soi một cơ chế.*

### 14.4 Trôi mức log: **đúng một chỗ**, và nó là chỗ duy nhất chỉ-có-thông-điệp

Quy ước EdgeCore có hai kênh: `Action<string>? logWarning`, `Action<Exception,string>? logError`. Liệt kê cả
sáu lời gọi log của `ModbusMultidropRegistration`: bốn đã là `LogWarning` (giữ nguyên), một mang exception
(→ `logError`), và **một** là `LogError` **không có exception** — "no connector factory could be built" — nay
là `logWarning`. Nhánh ấy **không với tới được từ cả hai bên gọi sản xuất** (overload `IConnectorFactory` từ
chối null; cả hai composition root truyền lambda luôn dựng được factory). Và dưới `AddWindowsService`, bộ lọc
mặc định của `AddEventLog` vốn đã nhận mức Warning, nên nó vẫn tới cùng một Event Log. **Đây là toàn bộ độ trôi VỀ MỨC.**

🔴 **Nhưng có một nửa thứ hai của cùng cuộc đổi mà cả E-2 lẫn bản đầu của mục này đều không ghi (review E-5,
M1): CÁC PLACEHOLDER CÓ CẤU TRÚC BIẾN MẤT.** Trước đây là
`logger.LogWarning("… '{BusInstanceId}' … unit {UnitId} …", busInstanceId, unitId)`, tức một sink có cấu trúc
truy vấn được theo `BusInstanceId`. Giờ là chuỗi nội suy, và mỗi host bọc toàn bộ vào **một** placeholder
(`"{ModbusMultidropMsg}"`), nên các trường ấy còn tồn tại **trong văn bản** chứ không còn là trường. Ghi ra
chứ không sửa: một cặp `Action<string>` **không thể** mang cấu trúc, nên khôi phục nghĩa là một hình dạng
THỨ BA cho quy ước log của EdgeCore — một quyết định thiết kế, không phải một bản sửa. Hôm nay giá bằng
không (sản phẩm không ship sink có cấu trúc nào, `St4i.EngineApi` không ship `appsettings.json`); nó tốn vào
đúng ngày ai đó thêm một cái. §10.4 đã đổi y hệt cho **mười bốn** chỗ và **chỉ ghi độ trôi MỨC** — nửa còn
lại đi qua hai đợt mà không ai viết ra.

**D-7a đã KIỂM, không chỉ đọc:** không lệnh nào trong file tính trạng thái cơ chế bên trong đối số của một lời
gọi log. Đột biến đưa `registry.Unregister(...)` **vào trong** đối số của cảnh báo sweep: **GIẾT** ba test —
`ModbusMultidropAgentTests.TheGhostSweep_RunsWithNoLogCallbacksAtAll_…`, cộng **hai** test EngineApi mà chính
E-5 biến thành bên-gọi-không-ai-xem khi bỏ `NullTestLogger.Instance` — và **SỐNG SÓT** ở
`ADeviceRemovedFromTheBusMap_…`, bài duy nhất còn truyền callback. Đúng bất đối xứng D-7a mô tả.

### 14.5 🔴 Giới hạn và hệ quả vận hành E-5 tạo ra

- **Transport serial VẪN chưa tải một khung tin nào trên phần cứng thật.** Đúng sau Đợt D, sau E-1…E-4, và
  **vẫn đúng sau E-5.** Cái được thực thi là **giàn in-memory ghép đôi của D-2** (`InMemoryBusLinkPair`): một
  mạng slave NModbus **thật** trong tiến trình — CRC thật, khung t3.5 thật, phân phát theo địa chỉ slave thật,
  phân xử thật trên một link dùng chung — cộng, cho nhánh gateway, một cổng loopback **ĐÓNG** mà lệnh connect
  **bị từ chối**: không socket nào được thiết lập và không khung nào đi qua nó (review E-5, M2 — bản đầu viết
  *"một socket loopback"*, thứ tuyên bố một transport đang hoạt động mà test không hề có). Cái **không** được
  thực thi: đồng. Không va chạm bán song công, không nhiễu, không khung bị xé bởi khoảng lặng t3.5, không tốc độ
  baud, **và không một dòng `System.IO.Ports` nào chạy trong bất kỳ test nào E-5 THÊM VÀO**. Nhánh
  `rtu-serial` chỉ được chạy tới chỗ `ModbusRtuBusPlan.Resolve` quyết định dựng nó. Không có adapter trên máy
  này, và chỉ adapter điều khiển hướng TỰ ĐỘNG mới được hỗ trợ.
  🔴 **Chính xác hoá của review E-5, và nó là về CỔNG chứ không về test của tôi:** một test **trong bộ
  EdgeService** *có* mở một cổng thật — `EdgeServiceSerialReachabilityTests`, từ E-4 — và nó bị **hệ điều
  hành** từ chối chứ không phải trình biên dịch. Nên câu đúng là *"không test nào E-5 thêm vào chạm một lệnh
  mở serial"*, **không phải** *"không có `System.IO.Ports` ở đâu trong cổng"*. Reviewer đo bằng cách bắt
  `SerialPortBusLink.OpenAsync` ném vô điều kiện (có đối chứng dương) và thấy cả hai test EdgeCore mới của
  E-5 cộng 48/49 test EdgeService vẫn xanh. Một khẳng định phổ quát nữa, hẹp lại bằng phép đo.
- 🔴 **HỆ QUẢ MỚI, và nó là của E-5:** một cổng COM chỉ nhận **một** tiến trình. Trước E-5 chỉ EngineApi có
  đường đã cấu hình tới một lệnh mở serial, nên bảng §2 (*"tiến trình thứ hai không mở nổi cổng"*) là một khả
  năng lý thuyết. **Giờ hai host đều cấu hình được lên cùng một sợi dây**, và nếu EdgeService giữ COM3 thì
  EngineApi không mở được — các máy trên dây ấy thành chỉ-đọc từ engine, và **hai host không có kênh nào để
  bên nào biết** (§12.1). Trên **gateway** RTU thì cả hai kết nối bình thường và **không ai chặn** — §2 nguyên
  văn, giờ có thể xảy ra bằng cấu hình chứ không chỉ trên nguyên tắc.
- 🔴 **Và trên một GATEWAY dùng chung, hệ quả rơi thẳng vào CHIỀU GHI (review E-5, I3).** Hai nguồn khung tin
  không phối hợp trên một segment: phép kiểm địa chỉ slave và mã hàm của NModbus biến một khung tin lạc thành
  một **lần TỪ CHỐI**, không phải một xác nhận sai — nên đây là **suy giảm, không phải hỏng dữ liệu**. Nhưng
  hệ quả thực tế là **lệnh ghi của EngineApi rơi vào `Indeterminate` ở một tần suất chưa ai đo**, và
  `Indeterminate` trên một lệnh ghi đúng là kết quả mà sản phẩm này cẩn thận nhất (Đợt D §10 mục 1 và 3). Ghi
  ra như một mệnh đề, không phải một phép đo: không có phần cứng và không có phép đo nào chạy.
- **Không người ghi mới nào vào store toàn máy.** Liệt kê, không suy: đường RTU chạm `SerialPortBusLink` (mở
  một cổng COM), `GatewayTcpBusLink` (mở một socket), `ModbusBusRegistry` (dictionary trong tiến trình).
  `grep` `File.` / `Directory.` / `ProgramData` / `GetFolderPath` trên `src/St4i.EdgeCore.Serial/` và
  `src/St4i.EdgeCore/Drivers/Modbus/`: **hai kết quả, cả hai nằm trong chú thích**. Bảng §11.4 không đổi một
  dòng.
- **Máy do tác nhân biên cầm vẫn chỉ-đọc.** `FleetCore` vẫn `internal`, và bốn đường I/O + hai `Cancel` dưới
  `_gate` (§10.3 / §11.3) **không tăng, cộng 0**.
  🔴 **Nhưng DỤNG CỤ phải nói đúng, và §11.3 lẫn bản đầu của mục này đều nói quá (review E-5, I4).** Một
  `git diff` **rỗng** trên `FleetCore.cs` là bằng chứng kết luận **về một FILE**; tiêu chí §10.3(c) là một
  **cuộc đi bộ theo khả năng với tới**, và cuộc đi bộ ấy phụ thuộc cả vào **callee**. Nên phép kiểm đúng là
  **diff rỗng CỘNG một phép kiểm callee**, và E-5 chạy cả hai: tập ký hiệu E-5 sửa là
  `ModbusMultidropMap` (thêm **một** static mới, không sửa thành viên nào có sẵn), `ConnectorsConfig` (thêm
  một static mới), `ModbusMultidropRegistration` + `ModbusRtuBusPlan` (dời; `FleetCore` không gọi cái nào),
  `RtuBusConfiguration` (ở `St4i.EngineApi` — `FleetCore` **không thể** gọi, sai chiều tham chiếu), và
  `EdgeConnectors` / `EdgeWorker` (chỉ `St4i.EdgeService`). **Không callee nào của một vùng đang giữ `_gate`
  đổi hành vi.**
  → **E-3 và E-5 đã HAI LẦN thay cuộc đi bộ bằng cái diff**, và nhiệm vụ thứ ba thừa kế câu chữ ấy sẽ không
  biết đó là một phép thay. Câu chữ để lại cho người sau: *"diff rỗng trên file giữ khoá, CỘNG một phép liệt
  kê callee"* — hoặc chạy lại cuộc đi bộ ba chặng.
- 🔴 **Và ĐỪNG viết rằng định tuyến `machineCode → driver` không với tới được** (đính chính §11.1). Nó
  `public` trên `ConnectorRegistry`, host này giữ một cái đã nạp, và **E-5 làm bề mặt ấy RỘNG hơn**: driver mà
  một đoạn như thế dựng được giờ có thể là một `ModbusRtuDriver` trên một cổng COM thật, không chỉ một
  `ModbusTcpDriver`. Hạng mục vẫn là `ConnectorRegistry`, và nó **lớn hơn** sau E-5.
- **OPC-UA vẫn bị từ chối theo tên**, vì quyết định gốc-dữ-liệu-theo-host vẫn là của chủ sở hữu (§11.4). E-5
  không chạm nó và không cần nó.

### 14.6 Những gì review E-5 phải đối mặt

- Danh sách §13.6 **nguyên vẹn trừ một dòng**: "E-5 — RS-485 ở tác nhân biên" đã đóng. Không mục nào khác bị
  E-5 chạm, và điều đó **đã được kiểm chứ không chép** (bài học I7 ở §13.4): hạng mục `_gate` — diff
  `FleetCore.cs` rỗng; kênh log thứ ba — chưa làm; gốc dữ liệu theo host — chưa chạm; `ConnectorRegistry` —
  chưa đóng và giờ rộng hơn; nhân chứng cặp `GET /v1/safety` — chưa làm; độ dài + i18n bốn chuỗi — chưa làm.
- **`ModbusBusRegistry` ở EdgeService do `EdgeWorker` sở hữu và `await using`**, đúng quy tắc
  `ConnectorsJsonRegistration` phát biểu cho EngineApi ("owned by the host, never constructed here").
  `EdgeConnectors.Build` nhận nó làm tham số tuỳ chọn; `null` nghĩa là run này không có transport RTU và entry
  bị bỏ qua kèm tên — có test riêng, vì đó chính là lý do tham số ấy tuỳ chọn.
- **Cảnh báo giới hạn auto-DE giờ phát ra ở EdgeService**, một lần cho mỗi SEGMENT và chỉ khi tuyến đã đăng ký
  được gì đó — cùng quy tắc EngineApi. Nó là WARNING vì hỏng theo kiểu **im lặng**: một adapter cần phần mềm
  bật DE thì không ném, nó chỉ không bao giờ phát.
- **Một test đã đổi CÓ CHỦ ĐÍCH, không phải "để đỏ rồi sửa cho xanh":**
  `AnRtuBusEntry_IsRefusedByName_RatherThanSilentlyBuildingASecondFanOut` (E-3) được **thay** bằng
  `AnRtuBusEntry_FansOutIntoOneInstancePerDevice_EachClaimingItsOwnMachine`. Nó ghim một QUYẾT ĐỊNH, và quyết
  định ấy bị lật công khai. Cái nó từ chối — **một phép toả THỨ HAI viết ở đây** — vẫn bị từ chối; thứ đổi là
  phép toả DUY NHẤT đã xuống được EdgeCore.
- **Census E-5 chạy như một hành động riêng, sau khi cổng xanh** (§8.1), theo hai quy tắc: *"host nào có đường
  đã cấu hình tới một cổng COM"* và *"assembly nào sở hữu `ModbusMultidropRegistration` / `ModbusRtuBusPlan` /
  `IsInBusNamespace`"*, trên `src/` + `tests/` + `*.md`. Kết quả ở §14.7.

### 14.7 🔴 Census chạy SAU khi cổng xanh — bốn chỗ, và ba trong bốn không do E-5 làm sai

Chạy như **một hành động riêng**, sau commit `c0fd84b8`, trên `src/` + `tests/` + `*.md` + `*.csproj`, theo
**hai** quy tắc (§8.1's "liệt kê CÁC QUY TẮC"):

- **R1** — *"host nào có ĐƯỜNG ĐÃ CẤU HÌNH tới một cổng COM"*.
- **R2** — *"assembly nào sở hữu `ModbusMultidropRegistration` / `ModbusRtuBusPlan` / `IsInBusNamespace`"*.

R1 tìm ra bốn chỗ **trong lúc đang sửa** (đã nằm trong commit): README §20.5/§23.6/§24.2/§24.3/§24.5 (EN+VI),
`St4i.EdgeService.csproj`, `EdgeServiceSerialReachabilityTests`, và **một chuỗi thông điệp khẳng định SỐNG**
trong `SerialDependencyScopingTests` (*"an RTU entry is refused by name, so no configured path here reaches a
COM port"*) — đúng bài học §13.5 mục 2: **chuỗi thông điệp là mã, không phải chú thích**.

R2, chạy sau commit, tìm ra bốn chỗ nữa:

| # | Chỗ | Ai làm nó sai |
|---|---|---|
| 1 | `ConnectorsJsonRegistration.cs:213` — `cref` mang **chữ ký cũ** (`…,ConnectorRegistry,ILogger)`) | **E-5.** Không phân giải được, và **không phép kiểm nào bắt** vì `GenerateDocumentationFile` vẫn tắt — §13.2's M6 nguyên văn. |
| 2 | `ModbusMultidropRegistration.cs` — chú thích sweep trỏ *"See RtuBusConfiguration.IsInBusNamespace"* | **E-5.** Con trỏ tới một thành viên chính E-5 vừa xoá; nó **đi cùng file trong cuộc dời** — §13.5 mục 1 ở dạng "dời" chứ "tách". |
| 3 | `RtuBusConfiguration.cs` — E-5 viết *"this is the ONLY trace it leaves here"*, trong khi ba call site cùng file cũng nhắc tên mới | **E-5.** Một khẳng định phổ quát, sai, **nằm trong chính lời biện minh của bản sửa** — §8.1(b) nguyên văn, bắt được bằng cách liệt kê thay vì đọc lại. |
| 4 | `ModbusRtuMultidropConformanceTests.cs:89` — *"`ConnectorRegistry`/`FleetHost` … those live in `St4i.EngineApi`"* | **KHÔNG PHẢI E-5.** Sai từ **E-2** (registry dời xuống EdgeCore) và giờ sai lần nữa vì fan-out cũng đã dời. Nằm trong ngữ liệu §12.9 vừa thêm và trong 25 file của §13.2 — **và vẫn thoát cả hai lượt**, vì quy tắc của E-4 là "host nào chủ trì connector nào" và quy tắc của review là "kiểu nào sở hữu cái khoá". Chỗ này ở trên trục thứ ba: *"assembly nào sở hữu kiểu này"* nói về **kiểu không phải khoá**. |

🔴 **Ba trong bốn là của E-5, và cả ba nằm trong VĂN XUÔI GIẢI THÍCH gắn vào bản sửa, không nằm trong logic
của nó** — đúng lớp lỗi §8.1(b) mô tả, lần thứ tư trong ba đợt. Khác biệt lần này: **tác giả bắt được, không
phải reviewer**, và thứ bắt được là **phép quét chạy như một hành động riêng sau khi cổng xanh**, không phải
sự cẩn thận.

🔴 **Và một khẳng định phổ quát nữa đã bị phủ định TRƯỚC khi commit, ghi ra vì nó là ca sạch nhất:** bản đầu
của `ModbusMultidropAgentTests.TheGhostSweep_RunsWithNoLogCallbacksAtAll_…` viết *"fold the Unregister call
into the warning's argument list and this test goes red while every other test of the sweep — all of which
supply a logger — stays green"*. **Sai.** Đột biến ấy giết **ba** test, vì chính E-5 đã biến hai bên gọi
EngineApi thành không-ai-xem khi bỏ `NullTestLogger.Instance`; **một** test sống sót, và đó mới là cái có
callback. Câu văn sai **theo hướng tâng bốc bài test của chính mình**; phép liệt kê tốn hai phút.

🔴 **Cái phép quét cơ học BỎ SÓT, báo cáo theo yêu cầu:** mục #4 chỉ ra được vì R2 nêu tên **ba kiểu cụ thể**;
một `grep` theo *từ ngữ* của R1 (`refus`, `COM port`, `only Modbus TCP`) **không tìm ra nó** — câu ấy không
dùng từ nào trong số đó. Ngược lại, R1 là quy tắc duy nhất tìm ra chuỗi thông điệp sống trong
`SerialDependencyScopingTests`, mà R2 sẽ bỏ qua vì nó không nêu tên kiểu nào trong ba kiểu. **Hai quy tắc,
hai tập kết quả gần như rời nhau** — bằng chứng trực tiếp cho phần thêm của §8.1: *liệt kê CÁC quy tắc, không
chạy MỘT quy tắc.*

### 14.8 🔴 Vòng sửa của REVIEW E-5 — bảy điều kiện, không điều nào chạm hành vi

Phán quyết: **MERGE sau khi sửa.** Reviewer chạy lại cổng (2594/116/0), chứng minh `FleetCore` không với tới
được **ở mức trình biên dịch trong chính assembly sản phẩm EdgeService**, và **ĐO giới hạn phần cứng thay vì
đọc nó** — bắt `SerialPortBusLink.OpenAsync` ném vô điều kiện kèm đối chứng dương, rồi xác nhận cả hai test
EdgeCore mới của E-5 và 48/49 test EdgeService vẫn xanh. **Cổng sau vòng sửa: `151/22/1082/49/1290 = 2594`,
0 lỗi, 116 cảnh báo, 0 build node** — không đổi, vì không điều kiện nào chạm hành vi.

**F1 (chặn) — thông điệp "cổng đang bị giữ" nêu HAI đường sinh, và E-5 tạo ra đường thứ BA, giờ là đường khả
dĩ nhất.** `SerialPortBusLink.DescribeOpenFailure`'s `UnauthorizedAccessException` arm nói *"another
application … or THIS process opening the same port twice"*, và liệt kê *"an earlier instance of this
service"* — tức **cùng một service, không phải host anh em**. Sau E-5, trên một máy chạy cả hai, câu trả lời
thường là *"tác nhân biên đang giữ COM3"*, và người vận hành bị đẩy đi săn một terminal program không tồn tại
rồi đi soát lại các tham số đường truyền vốn đúng. **Đây là lớp I-1 của D-5 nguyên văn, trong một chuỗi
SỐNG.** Đã sửa: ba đường sinh, đường host-anh-em đứng **thứ nhất** kèm lý do nó phải đứng đầu (nó là đường duy
nhất để **cả hai** file cấu hình trông vẫn đúng), cộng ba khẳng định mới ở `SerialPortBusLinkTests`.

🔴 **Và điều đáng giữ hơn bản sửa: chỗ ấy nằm ĐÚNG TRONG ngữ liệu mà quy tắc R1 của chính §14.7 nhắm vào.**
R1 là *"host nào có đường đã cấu hình tới một cổng COM"*; nó tìm ra bốn chỗ và **bỏ sót đúng chỗ mà câu trả
lời được NÓI CHO MỘT CON NGƯỜI**. Sắc hơn nữa: đoạn E-5 mới thêm vào `EdgeServiceSerialReachabilityTests` nói
*"câu hỏi 'tiến trình nào đang giữ COM3' giờ mới có câu trả lời thật"* — và **chuỗi trả lời đúng câu hỏi ấy
thì không được đụng tới**. → **Bổ sung cho §8.1: một lượt quét theo quy tắc phải liệt kê cả những chỗ quy tắc
ấy được NÓI RA CHO NGƯỜI VẬN HÀNH, không chỉ những chỗ nó được ghi cho lập trình viên.**

**F2/F3 — một khẳng định phổ quát sai ở TÁM chỗ, và nó là lời biện minh mà cả nhiệm vụ dựa lên.** Xem §14.1
(đã sửa) và §6.2(b). Ca §8.1(b) **thứ năm**, lớn nhất theo số chỗ, và **bị bỏ sót bởi một lượt census chạy
riêng cho đúng lớp lỗi ấy**. Đã sửa ở bảy chỗ: `ModbusMultidropMap`, `EdgeConnectors`,
`ConnectorsJsonRegistration`, `RtuBusConfiguration`, `RtuBusRegistrationTests`, README §24.3 (EN + VI), và
§14.1. **Chỗ thứ tám nằm trong §6.2 của chủ sở hữu, đang chưa commit trong cây — E-5 không đụng theo chỉ thị**;
bản thân §6.2 đã mang sẵn phần đính chính dữ kiện ở đoạn sau, nên hai nửa của nó cần được hoà giải bởi người
viết nó.

**I1 — `ConnectorsConfig.IsRtuBus` khai BỐN bên gọi; thật ra là BA.** `EdgeConnectors.RegistrationKeyOf`
không hỏi nó bao giờ — nó trả `Normalize(entry.Id)` vô điều kiện. **Và hành vi thật MẠNH hơn cái doc mô tả:**
cặp của EdgeService **không thể trôi khỏi nhau về mặt cấu trúc**, vì phía key không có nhánh nào để bất đồng
với phía dispatch. Đã thay lời cảnh báo "giữ bốn thứ đồng bộ" bằng phát biểu mạnh hơn ấy — cảnh báo cũ **mời
người sau thêm nhánh còn thiếu cho cân đối, và như thế là TẠO RA** mối nguy.

**I3 — một mệnh đề về CHIỀU GHI sau một gateway dùng chung**, đã thêm vào §14.5.

**I4 — dụng cụ `_gate` +0 nói quá, dù kết luận đúng.** Một `git diff` rỗng kết luận về một **file**; tiêu chí
§10.3(c) là một **cuộc đi bộ**, phụ thuộc cả callee. Đã sửa câu chữ và **chạy phép kiểm callee**, xem §14.5.
🔴 **E-3 và E-5 đã HAI LẦN thay cuộc đi bộ bằng cái diff**, và nhiệm vụ thứ ba thừa kế câu chữ sẽ không biết
đó là một phép thay — đó mới là thứ vòng sửa này ghi lại.

**Minor:** M1 (mất placeholder có cấu trúc — §14.4, và §10.4 đã đổi y hệt cho 14 chỗ mà không ghi);
M2 (*"một socket loopback"* → một connect **bị từ chối**, không có socket nào); M3 (§13.6: hạng mục
`ConnectorRegistry` **rộng ra**); M4 (dòng dài).

**Một chính xác hoá của reviewer mà E-5 nhận:** *"không `System.IO.Ports` trong bất kỳ test nào của E-5"*
đúng với **các test E-5 thêm vào**, không đúng với **cổng** — `EdgeServiceSerialReachabilityTests` (E-4) có mở
một cổng thật và bị **hệ điều hành** từ chối. Đã hẹp lại ở §14.5, README §24.6 và báo cáo.
