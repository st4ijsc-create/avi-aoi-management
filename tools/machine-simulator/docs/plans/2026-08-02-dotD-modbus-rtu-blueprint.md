# Đợt D — Modbus RTU (RS-485), multidrop, hai transport

**Trạng thái:** đã duyệt · chủ sở hữu chốt: một giao thức làm trọn · RTU trước · cả hai transport · **có multidrop**
**Ngày:** 2026-08-02
**Base:** `1d1e12c5` (main, sau Đợt A/B/C + hai đợt backlog hạ tầng)

---

## 1. Vì sao RTU, và vì sao nó không rẻ như tưởng

Sản phẩm hiện nói được **Modbus TCP** và **OPC-UA**. Máy cũ trong xưởng Việt Nam phần lớn là **RS-485**. Đây là thứ trực tiếp chặn hợp đồng.

Phần giao thức gần như **không phải viết**:
- NModbus 3.0.83 lo trọn CRC và đóng khung t3.5 (`NModbus.IO.ModbusSerialTransport`, `NModbus.Extensions.CrcExtensions`).
- `IStreamResource` chỉ có **6 thành viên**: `ReadTimeout`, `WriteTimeout`, `InfiniteTimeout`, `DiscardInBuffer()`, `Read()`, `Write()`.
- **Mọi lệnh đọc/ghi nằm trên `IModbusMaster`** — `IModbusSerialMaster` chỉ thêm `Transport` và một hàm chẩn đoán. Nên `ReadHoldingRegistersAsync`, `WriteSingleRegisterAsync`, `WriteSingleCoilAsync` giống hệt TCP.
- `Transport.Retries = 0` của Đợt B **dùng lại nguyên vẹn** — nó nằm trên `IModbusTransport`, không phải trên socket.

### 🔴 2.1 Đính chính (2026-08-02, sau D-1) — cơ chế huỷ của Đợt B KHÔNG dùng lại nguyên vẹn được

Câu trên ban đầu tôi viết là *"`Transport.Retries = 0` **và** `ct.Register(DisposeConnection)` dùng lại nguyên vẹn"*. **Vế thứ hai sai**, và review D-1 chỉ ra tại sao.

`ct.Register(DisposeConnection)` là cách duy nhất honour một `CancellationToken` xuyên qua NModbus — nhưng nó hoạt động bằng cách **phá huỷ transport**. Điều đó đúng cho quan hệ 1:1. **Trên một bus dùng chung thì huỷ một phép đọc của một thiết bị sẽ giật sập đường dây của mọi thiết bị còn lại trên đó.**

Nghịch lý là chính cái `IStreamResource` dùng-chung-đếm-tham-chiếu mà D-1 chứng minh là bắt buộc (vì `SerialPort` mở cổng COM độc quyền) lại **là thứ làm cho khẳng định "dùng lại nguyên vẹn" trở nên sai**.

**Vậy D-2 phải có một câu chuyện huỷ khác**, và đây là quyết định thiết kế chứ không phải chi tiết triển khai: huỷ trong lúc chờ khoá trọng tài bus, cộng một timeout đọc có biên — và **dispose chỉ dành cho tham chiếu cuối cùng**. Không được để một lệnh huỷ của một thiết bị làm hỏng giao dịch của thiết bị khác.

Cái đắt nằm ở chỗ khác — §3.

## 2. Hai điều NModbus **không** cho

1. **Không có `SerialPortAdapter`.** Gói này ship đúng ba `IStreamResource`: `TcpClientAdapter`, `SocketAdapter`, `UdpClientAdapter`. Adapter serial **phải tự viết**.
2. **`CreateRtuMaster` không phải thành viên của `IModbusFactory`** — nó là extension method tĩnh (`NModbus.FactoryExtensions`). Tương đương `CreateRtuTransport(IStreamResource)` + `CreateMaster(IModbusSerialTransport)`.

Và **thiếu `CancellationToken` y hệt TCP**: không một overload nào trên `IModbusMaster` nhận token. Cách chữa duy nhất vẫn là dispose `IStreamResource` từ token — đã đo được ~2 ms ở Đợt B.

## 3. 🔴 Chặn cấu trúc: kiến trúc hiện tại không diễn đạt nổi multidrop

**Multidrop chính là RS-485.** Một driver chỉ nói được với một slave trên bus thì về bản chất là Modbus TCP thêm vài bước.

Hai chặn độc lập, chỉ cần một cái là đủ:

| Chặn | Bằng chứng |
|---|---|
| Một connector Modbus cho **toàn hệ thống** | `ConnectorRegistry` khoá theo **Kind** đã chuẩn hoá; `ConnectorConfigStore` có `kind TEXT PRIMARY KEY`; `FleetHost` map `DriverKinds.Modbus` sang đúng một nhãn slot `"modbus"` |
| Map là **1:1** với một `MachineCode` + một `UnitId` | `ModbusRegisterMap.MachineCode` là `required string` số ít; `PollOnceAsync` gắn `MachineCode = _map.MachineCode` cho mọi reading |

Gỡ chặn = đổi định danh connector từ **theo giao thức** sang **theo thực thể**.

## 4. 🔴 Điều nguy hiểm nhất đợt này: chốt `AmbiguousDriver`

Đợt B dựng `MachineDriverAvailability.AmbiguousDriver` vì **một lệnh ghi cho máy B từng tới thiết bị máy A** — lỗi Critical, tái hiện được bằng probe. Chốt đó tồn tại **chính xác vì** registry khoá theo Kind: nhiều máy trong roster cùng trỏ về một slot, và `SetpointWriteRequest` không mang mã máy, nên không cách nào phân giải.

**Instance-keying là thứ làm cho việc phân giải trở nên khả thi.** Nên đợt này phải **làm chốt đó mạnh lên, không được làm yếu đi**:

- Sau D-1, mỗi lệnh ghi phải phân giải tới **đúng một** driver, xác định được, **hoặc bị từ chối**.
- `AmbiguousDriver` **không được biến mất** — nó phải trở thành trạng thái *không thể xảy ra bằng cấu trúc*, và có test chứng minh, chứ không phải bị xoá vì "giờ không cần nữa".
- **Nếu một lệnh ghi có thể tới nhầm máy sau đợt này, đó là hồi quy Critical**, không phải một Minor.

## 5. Ràng buộc kế thừa, không thương lượng

1. **Phần mềm không bao giờ là đường an toàn.** HALT không dừng máy. RTU không đổi điều đó.
2. **`EstopGuardRule` phủ mọi lệnh ghi và lệnh gọi** — kể cả qua transport mới.
3. **`Indeterminate` sống sót như chính nó** qua mọi chặng. `WriteOutcome.Indeterminate = 0` là giá trị mặc định có chủ đích.
4. **Không thử lại ngầm.** Một lệnh ghi hỏng không được tự gửi lại.
5. Bí mật không bao giờ vào response GET, dòng log, hay bản ghi audit.
6. Không sửa SDK vendored.

## 6. Ngoại lệ NuGet, có chủ đích và giới hạn

**`System.IO.Ports` được thêm** — và đây là ngoại lệ đầu tiên với ràng buộc "không thêm NuGet" giữ suốt ba đợt.

Lý do chấp nhận: gói do **chính Microsoft phát hành**, không phải thư viện tiện ích bên thứ ba; nó cấp một **năng lực mới không thể thay thế** (truy cập cổng COM/RS-485), không phải sự tiện lợi; và nó **không có trong shared framework** ở bất kỳ TFM nào — đã kiểm.

**Giới hạn — 🔴 ĐÍNH CHÍNH sau D-7c (review D-7c, I-1). Câu cũ giờ SAI và phải đọc bản mới:**

*Câu cũ:* ~~"chỉ D-3 được phụ thuộc vào nó … để một triển khai dùng gateway không kéo theo phụ thuộc serial."~~
Cả hai vế đều **không còn đúng**: **ba** host phụ thuộc vào nó, và **mọi** triển khai — kể cả nơi chỉ dùng
gateway — đều mang `System.IO.Ports.dll`.

*Câu đúng:* **`PackageReference` chỉ nằm ở đúng MỘT project — `St4i.EdgeCore.Serial`** — và đó là ranh giới
duy nhất còn hiệu lực. Cái đã đổi là **project nào tham chiếu assembly ấy**, chứ không phải nơi đặt
`PackageReference`. Theo **quyết định của chủ sản phẩm ngày 2026-08-03**, cả `St4i.EngineApi`,
`St4i.EdgeService` và `St4iMachineSimulator` đều `ProjectReference` tới `St4i.EdgeCore.Serial`, để RS-485 cắm
thẳng có mặt ở mọi host. Ba chốt `..._NeverCarriesSystemIoPorts` trong `SerialDependencyScopingTests` đã được
**đảo thành khẳng định DƯƠNG** (không xoá — một chốt bị xoá để năng lực biến mất im lặng), còn chốt thứ tư —
`TheRtuFramingLayersOwnAssembly_ReferencesNeitherSystemIoPorts_NorTheSerialAssembly` — **giữ nguyên, không
đụng tới**, và chính nó là thứ ép hình dạng của D-7c.

🔴 **Trạng thái người đọc dễ hiểu sai, nên nói thẳng:** đo được ở thời điểm D-7c, **chỉ `St4i.EngineApi` có
đường mã nào mở được cổng COM.** `ConnectorRegistry`/`ConnectorsConfig`/`ConnectorsJsonRegistration`/
`ModbusMultidropRegistration`/`FleetHost` đều là kiểu của `St4i.EngineApi`, và **hai host còn lại thậm chí
không `ProjectReference` tới `St4i.EngineApi`** — nên chúng **mang phụ thuộc mà không có gì gọi được nó**.
`EdgeWorker.cs` dựng một `SimulatedDriver`; `FleetService.cs` dựng `ScenarioAwareDriver`/`HotFolderAoiDriver`.
Biến điều đó thành năng lực thật là tách tầng hosting ra thư viện dùng chung — **một việc cỡ D-1, chưa ai
lên phạm vi (D-7d)**, không phải một dòng csproj.

Tầng đóng khung RTU và transport TCP-gateway **vẫn phải biên dịch được mà không có nó** — câu này **không
đổi**, và đó chính là điều chốt thứ tư ghim.

## 7. Phân rã công việc

| # | Nhiệm vụ | Rủi ro |
|---|---|---|
| **D-1** | 🔴 **Định danh connector: kind-keyed → instance-keyed.** Registry, schema store (có migration), phân giải slot của `FleetHost`, `ResolveWritableDriver`, seeder, endpoint, RBAC. **Land riêng, xanh trước khi có bất kỳ code RTU nào.** | 🔴🔴 Cao nhất đợt — đụng cổng an toàn Đợt B |
| **D-2** | Tầng RTU + seam `IStreamResource` + transport **RTU-over-TCP** (không thêm dep) | |
| **D-3** | Transport **serial nguyên bản** — `System.IO.Ports`, adapter tự viết | |
| **D-4** | Hình dạng map multidrop — **đọc §7.1 trước, câu mô tả cũ mơ hồ về đúng trục an toàn** | 🔴 |
| **D-5** | Đường ghi RTU qua hợp đồng Đợt B + cổng an toàn | 🔴 |
| **D-6** | Conformance + loopback harness (cần `IStreamResource` cặp đôi trong bộ nhớ — **không có cổng COM ảo khả chuyển**) | |
| **D-7** | Endpoint/RBAC/cấu hình + UI + census tài liệu | |

### 🔴 7.1 Đính chính (2026-08-02, sau D-1) — D-4 phải nói rõ hình dạng nào, câu cũ của tôi không nói

Bản đầu tôi mô tả D-4 là *"một bus, N địa chỉ slave, N mã máy"*. Câu đó **đọc tự nhiên thành "một file map khai N máy"** — và review D-1 chỉ ra rằng cùng một định dạng file ấy có **hai cách hiện thực hoá, không phân biệt được trong một câu đặc tả, và ngược nhau về an toàn**:

| Cách | Hệ quả |
|---|---|
| Đường đăng ký **bung file ra thành N thực thể**, mỗi thực thể một máy | ✅ Hình dạng duy nhất tương thích với bất biến D-1 |
| Một blob giao cho một factory, sinh **một driver phát ra N mã máy** | ❌ Làm `AmbiguousDriver` **với tới được trở lại ngay lập tức** |

Lý do vế thứ hai hỏng: `SetpointWriteRequest` và `CommandRequest` **không mang mã máy**. Một driver phục vụ N máy thì không có cách nào phân giải một lệnh ghi tới đúng máy — đúng lỗ hổng đã sinh ra chốt `AmbiguousDriver` ở Đợt B.

**Nên D-4 chỉ được làm cách thứ nhất.** Nếu ai đó muốn cách thứ hai, **phải mở rộng bản thân yêu cầu ghi để mang mã máy trước** — và đó là một quyết định riêng, không phải một chi tiết của D-4.

Về §9 "nói con số": D-1 **không áp giới hạn nào** về số thiết bị trên một bus. Giới hạn sẽ đến từ tải điện RS-485 (thông lệ 32 unit load) và từ thông lượng trọng tài so với chu kỳ poll của từng thiết bị — câu trả lời thuộc D-4.

**D-1 phải land riêng và xanh trước khi bất kỳ code RTU nào tồn tại** — cùng lý do C-6 phải land hàng đợi riêng từng kênh trước khi viết logic relay: trộn một cuộc tái cấu trúc xương sống với một tính năng mới thì một lỗi sẽ không quy trách nhiệm được.

## 8. Bài học quy trình bắt buộc mang theo

- **Chín test rỗng đã bị bắt trong dự án này. Cả chín đều bằng đột biến, không lần nào bằng đọc.** Hai trong số đó do người vừa đọc xong báo cáo về đúng kiểu lỗi ấy viết ra.
- **Một tỷ lệ là triệu chứng, không phải chẩn đoán.** Một test bị bốn lượt độc lập gọi là "chập chờn do thời gian" hoá ra là `IOException` tất định 100%.
- **Một bản sửa nhắm sai cơ chế trông giống hệt bản sửa đúng cho tới khi nó chạy.** Tôi vấp điều này hai lần liên tiếp trên chính script kiểm chứng.
- **Không nới ngưỡng để lỗi hiếm đi.** Sửa cơ chế, hoặc nói thẳng là không sửa được.
- `scripts/verify-suites.sh` là cổng. Nó đã **sai bảy lần**, cả bảy do người *dùng* nó tìm ra. Nếu nó báo điều khó tin, **nghi ngờ công cụ ngang với nghi ngờ cây mã**.

## 8.1 Nguyên tắc rút ra trong D-1 và D-2 — mang theo cho D-3…D-7

Bốn câu dưới đây đều do implementer hoặc reviewer phát biểu sau khi trả giá, và cả bốn **tổng quát hơn** sự cố sinh ra chúng.

**"Không thể xảy ra" và "không test được" đều là phát biểu về giới hạn của mình, mặc áo phát biểu về mã nguồn.**
D-1: *phân tích khả-năng-với-tới là một câu hỏi về tính hợp lý của cái chốt, và không bao giờ hỏi câu hỏi hệ quả về trạng thái được chốt.* D-2 mở rộng: *"không test nào với tới được" là một khẳng định về bộ dụng cụ bạn đã cầm sẵn.* → **Hễ một chú thích viết "không thể xảy ra", câu kế tiếp phải nói code làm gì khi nó vẫn xảy ra.**

**Đột biến và truy-hệ-quả là hai dụng cụ khác nhau.**
Đột biến tìm ra **những bài test không thể đỏ**. Truy-hệ-quả tìm ra **đoạn mã không bao giờ bị hỏi tới**. Không đột biến nào với tới được một nhánh mà không gì chạy qua — reviewer D-1 tìm ra I-A **bằng cách đọc**, và nói thẳng như vậy.

**Sửa một trường hợp của một lớp lỗi không cho miễn nhiễm với lớp lỗi đó, và có thể còn làm yếu đi.**
D-2 tái tạo đúng lỗi I-5 **trong chính commit sửa I-5**, cách mười hai file. D-2 cũng tìm đúng cơ chế rò cổng rồi **khẳng định phạm vi thay vì đi grep**, và hai chỗ bỏ sót **tệ hơn** chỗ đã sửa. → **Biện pháp đối kháng là một đợt quét, không phải sự cẩn thận. Mọi bản sửa kèm một lệnh grep tìm anh em của nó.**

**Một bài test cấp giá trị mà nó đang kiểm thì mù với việc ai chọn giá trị đó.**
D-2 **đã có** một bài test retry, viết từ trước vì một đột biến sống sót — và nó không thấy I-2, vì nó tự truyền vào cái con số nó đang kiểm. Thêm test cùng hình dạng sẽ không bao giờ tìm ra. → **Khẳng định trên giá trị đã tới ranh giới, không phải giá trị bạn đưa vào.**

🔴 **Nguyên tắc thứ NĂM, thêm sau D-7a — và đây là lập luận mạnh nhất của cả đợt cho phép ĐO so với test hình-dạng-unit.**

**Một cơ chế giảm thiểu có thể được nối vào kênh GHI LOG, và khi đó nó chỉ tồn tại cho những driver có người tình cờ đang theo dõi.**

D-7a đếm số lần poll hỏng liên tiếp **bên trong ĐỐI SỐ** của `_logError?.Invoke(ex, DescribeFailedPoll())`. `?.` **đoản mạch cả đối số**, nên với mọi driver được dựng **không** kèm callback ghi log, bộ đếm không bao giờ nhúc nhích và **backoff không bao giờ khởi động**. Code đọc thì đúng. Số học thì đúng. Cái sai nằm ở chỗ **trạng thái của cơ chế được mang trên một kênh quan sát**.

Kiểm chứng bằng cùng một đột biến, do reviewer chạy lại độc lập:

| Chạy | Kết quả |
|---|---|
| `TheReadBackoff_CutsADeadDevicesTax…MeasuredBeforeAndAfter` (một phép ĐO đầu-cuối) | **KILLED** — *"backoff OFF 1.3 reads/s; backoff ON 2.0 reads/s — 1.5x"* so với ngưỡng 3× |
| `ADriverBuiltByTheFactory_SaysItIsBackingOff…` (test thông điệp, có logger) | **SURVIVED** |
| `ModbusRtuReadBackoffTests` + `ModbusRtuConnectorFactoryTests` — **16 test** của đúng cơ chế ấy | **SURVIVED 16/16** |

**Mười sáu bài test hình-dạng-unit của đúng cơ chế đó đều mù. Một phép đo đầu-cuối giết nó.** Lý do không phải là "unit test dở": mọi bài trong số 16 đều gọi thẳng vào số học, và số học không hỏng. Cái hỏng là **dây nối**, và dây nối chỉ hiện ra khi đo **hệ quả** của cơ chế lên thứ nó phải bảo vệ — thông lượng đọc của các thiết bị lành trên cùng một dây.

→ **Quy tắc:** với một cơ chế giảm thiểu, **ít nhất một bài kiểm chứng phải đo hệ quả của nó lên thứ nó bảo vệ, trên đường đi sản xuất, KHÔNG kèm bất kỳ quan sát viên nào mà bản thân cơ chế không cần.** Và cụ thể hơn: **trạng thái của một cơ chế không bao giờ được đi qua kênh log của nó** — hãy tách lệnh tăng biến ra khỏi đối số, luôn luôn.

**Và một phân biệt về bằng chứng:** một diff chỉ sửa chú thích là **bằng chứng kết luận về cây mã, và không nói gì về môi trường**. Cổng đỏ trên một commit như vậy nghĩa là máy bẩn, không phải mã hỏng — nhưng cách chữa là **dọn máy**, không phải nới trần.

**Và một đính chính về chính bộ công cụ này, do D-3 tìm ra.** Brief D-3 của tôi yêu cầu test phụ thuộc phần cứng phải *"bỏ qua sạch sẽ và ồn ào"*, trong khi `verify-suites.sh` — cũng của tôi — **fail khi `skipped != 0`**. Hai chỉ thị loại trừ nhau, và **cái phải đổi là brief, không phải script**: xUnit đếm test bị bỏ qua động vào `Total`, nên một bộ test phụ thuộc phần cứng làm `Skipped` **phụ thuộc môi trường** — và bất kỳ con số kỳ vọng cố định nào cũng sẽ làm **máy trang bị tốt hơn** bị đỏ. Đó là cái bẫy "một con số xanh mang nghĩa khác nhau trên các máy khác nhau", mặc áo phần cứng. **`skipped == 0` chính là thứ làm cho "817" mang cùng một nghĩa ở mọi nơi.**

→ Quy tắc đúng: **hành vi phụ thuộc phần cứng không bao giờ là một test bị bỏ qua có điều kiện bên trong năm bộ test.** Nó hoặc được **ghi rõ là khoảng trống chưa test** trong báo cáo và trong chú thích của cổng, hoặc được commit thành **một bench harness riêng nằm ngoài năm bộ** (`tools/serial-bench/`). Phép đo không commit được thì không tái lập được — reviewer D-3 phải **viết lại toàn bộ probe** để kiểm chứng các con số của D-3.

Công cụ bắt buộc từ D-3: `scripts/mutate-guard.sh` (so dấu thời gian + đối chứng dương mỗi phiên). Lý do đầy đủ nằm trong header của nó.

## 9. Giới hạn phải nói thẳng khi xong

- **RS-485: chỉ hỗ trợ adapter có điều khiển hướng TỰ ĐỘNG.** `System.IO.Ports.SerialPort` không có sự kiện "đã phát xong", không có `RTS_CONTROL_TOGGLE`, và `BaseStream.Flush()` chỉ xả bộ đệm ghi của driver chứ **không** xả thanh ghi dịch của UART — nên nó không phải tín hiệu phát-xong. Đảo chiều RTS bằng phần mềm vì thế **chỉ có thể là một phép đoán thời gian**, và trên bus RS-485 một phép đoán sai làm hỏng khung tin của thiết bị khác. Ai dùng adapter phải bật/tắt DE thủ công thì sản phẩm này **không hỗ trợ** — nói thẳng, đừng để khách phát hiện trên bàn thí nghiệm.
- **Transport serial chưa từng tải một khung tin nào.** D-3 kiểm chứng seam, đếm tham chiếu, huỷ và mở độc quyền; nhưng không có cặp COM ảo nên **chưa có khung Modbus nào đi qua dây thật**. Đây là một **bước nghiệm thu trên bàn với phần cứng thật**, không phải thủ tục sau một cổng xanh.
- ASCII framing không làm (NModbus có, ta không dùng).
- Broadcast (slave 0) — quyết định và nói rõ.
- S7 và EtherNet/IP vẫn không có.
- Nếu multidrop có giới hạn số thiết bị trên một bus, nói con số.

## 10. 🔴 Open items D-5 hands forward — D-6 và D-7 phải thừa kế ba điều này

Thêm sau review D-5 (I-2c, I-3). Trước đó ba nghĩa vụ dưới đây chỉ nằm trong `task-5-report.md`, và **một
báo cáo không phải là bản ghi nguồn**: người viết D-6/D-7 đọc thành viên, không đọc `.superpowers/`. Chúng
cũng đã được ghi ngay trên hai thành viên public `ModbusRtuDriver.WriteSetpointAsync` /
`InvokeCommandAsync`; mục này tồn tại để brief của D-6 và D-7 thừa kế được.

1. 🔴 **VIẾT LẠI SAU D-7a (review D-7a xác nhận cả hai vế) — biên áp cho phần CHỜ, không phải cho giao dịch,
   và nó thuộc về DRIVER chứ không phải caller.**

   *Câu cũ của tôi:* **"Không bao giờ gọi `WriteSetpointAsync`/`InvokeCommandAsync` với một
   `CancellationToken` không có biên."* Vấn đề đã đo được: **caller sản xuất duy nhất không thể thực hiện
   nghĩa vụ ấy, và câu trên biến một call site ĐÚNG thành một vi phạm.**
   `MachineWriteEndpoints` truyền `CancellationToken.None` **có chủ đích** — nếu tôn trọng token của request
   thì việc huỷ sẽ **phá kết nối DÙNG CHUNG** và làm `Health` của **mọi thiết bị trên bus đó** nhảy sang
   `Degraded`, biến một teardown như vậy thành chuyện thường ngày. Trên một dây RS-485 multidrop đó đúng là
   đính chính §2.1, nguyên văn. **`None` ở đó không phải lười; thay nó đi mới là hồi quy.**

   *Câu đúng:* con số vẫn thế — một lệnh ghi có thể xếp hàng sau trọn một lượt giữ của thiết bị khác,
   `registers × (retries+1) × readTimeoutMs`, tức **16 000 ms ở giá trị mặc định của map** và **khoảng hai
   giờ** ở các giá trị tối đa mà chính map chấp nhận. Nhưng **hai yêu cầu chỉ đồng thời thoả mãn được khi
   biên áp cho phần CHỜ chứ không phải cho GIAO DỊCH**, và chỗ duy nhất phân biệt được hai thứ đó là bên
   trong driver. Cơ chế: `ModbusRtuDriver.CreateQueueBudget` nối token của caller với một timer, và token đã
   nối **chỉ đi tới `BeginTransactionAsync`** — hai phương thức thực thi nhận **hai** token đúng vì lẽ đó, nên
   một cái biên **không bao giờ** cắt ngang một yêu cầu đã nằm trên dây. Khi biên hết hạn, kết quả là
   `Indeterminate` với lời khẳng định vẫn nguyên vẹn: **không byte nào tới dây, thiết bị chắc chắn chưa bị
   đụng tới, thử lại là an toàn** — và `Detail` của nó **khác** `Detail` của một lần caller huỷ, vì một người
   vận hành được báo "đã huỷ" cho một cái chờ mà không ai huỷ sẽ đi tìm client nào đã huỷ.
2. **Định cỡ biên đó theo `max_j WorstCaseBusHoldMs`** trên **các thiết bị cùng bus**, không phải của riêng
   thiết bị đang ghi. `ModbusRegisterMap.WorstCaseBusHoldMs` đã tính sẵn; `ModbusMultidropMap.FanOut` đã
   cảnh báo bằng đúng con số đó.
3. **`Applied` của một COMMAND là một sự xác nhận, không phải một quan sát.** Nó có nghĩa: một khung tin
   quay về khớp với yêu cầu này ở địa chỉ slave, mã hàm, địa chỉ coil và giá trị. Nó **không** chứng minh
   máy đã chuyển động — RTU không có gì để đối chiếu một khung tin với một yêu cầu, và một cặp echo cũ của
   một xung đã hoàn tất trước đó về muộn, đúng thứ tự, có thể làm cả hai nửa được xác nhận (task-5-report.md
   §3.3). **D-6 không được khẳng định hiệu ứng vật lý từ nó; D-7 không được trình bày nó cho người vận hành
   như bằng chứng vật lý.**

4. 🔴 **`Applied` của một command KHÔNG được hạ xuống `Indeterminate` dựa trên số byte mà lần
   đồng bộ lại của chính giao dịch đó đã xả — và điều kiện để nó trở nên đúng.** Review D-5 đề xuất bộ phân
   biệt này; D-5 cân nhắc và **từ chối**, và review đã tự bác bỏ lập luận chi phí của chính nó
   (task-5-report.md §15). Lý do ngắn: `_lastResynchronisationBytesDiscarded` được ghi trên nhánh
   **THÀNH CÔNG** của `ResynchroniseAsync`, nên một số khác 0 chính là chữ ký của một lần **hồi phục sạch**;
   và khung tin thực sự lừa được ta là khung **chưa kịp tới** lúc đồng bộ lại — nên nó đóng góp 0.
   Bộ phân biệt sẽ kêu to nhất đúng chỗ cửa sổ im lặng đã làm tròn việc của nó.

   **Điều kiện để xây nó (thuộc về D-6):** một **drain có quy trách nhiệm theo unit id** — tức là biết
   số byte vừa bỏ đi mang địa chỉ slave nào. **Hôm nay seam không cho điều đó, và đây là sự thật D-6 cần:**
   `IModbusBusLink.DrainBufferedInput()` trả về một `int` trần (`IModbusBusLink.cs:61`), và **cả hai link đang
   ship đều chỉ đếm chứ không phân tích khung tin** — `GatewayTcpBusLink.DrainBufferedInput` và
   `SerialPortBusLink.DrainBufferedInput` đều đọc vào một bộ đệm tạm rồi cộng dồn. Chừng nào điều đó còn
   đúng, tín hiệu không quy được cho thiết bị nào, mà trên bus dùng chung rác thường thuộc về **thiết bị
   khác** — thứ mà NModbus đã loại trừ sẵn bằng kiểm tra địa chỉ slave (D-5 đo được:
   `Response slave address does not match request`). Nếu D-6 thêm được quy trách nhiệm ấy thì **nên xây**,
   chặn theo cùng unit id và cùng mã hàm.

**Per-device backoff vẫn là điều kiện tiên quyết của D-7 — nhưng cho ĐƯỜNG ĐỌC, không phải đường ghi.**
Lý lẽ đã được review D-5 kiểm chứng bằng cấu trúc: lượt giữ nằm *bên trong* khoá trọng tài, còn backoff
đổi một `Task.Delay` nằm *ngoài* nó — nên trường hợp xấu nhất mà một lệnh ghi phải xếp hàng sau là **y hệt
nhau** dù có backoff hay không. Cái nó cải thiện là thông lượng ĐỌC ở trạng thái dừng (D-4 đo được 67.5×).
