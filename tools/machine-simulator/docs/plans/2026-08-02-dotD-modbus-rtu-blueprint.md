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

🔴 **Hệ quả, thêm sau đợt đóng các phát hiện mang sang: nói rõ dụng cụ nào tạo ra TỪNG KHẲNG ĐỊNH, không phải từng phát hiện.**
Sự tồn tại của một lỗi và **cơ chế của bản sửa được đề xuất** là hai khẳng định khác nhau, và thường do hai dụng cụ khác nhau tạo ra — đó chính là cách ca này lọt qua.

Reviewer **đo** được lỗi: nó dựng một relay chào rồi RST, đọc ra câu văn sai. Rồi nó **đọc** cơ chế khắc phục khỏi bề mặt API — *"`SocketErrorCode` phân tách hai trường hợp, cách đó đúng một property, ngay bên trong `Classify`"* — và **trình bày cả hai bằng một giọng**. Cụm "reviewer đã kiểm" mang thẩm quyền của phép đo sang cho lần soi.

Cơ chế ấy **sai**. Trên runtime này, greet-then-RST cho ra `SmtpException(GeneralFailure) → IOException` **không có `SocketException` nào trong cả chuỗi**; hai trường hợp được phân tách bởi nhánh dự phòng không-có-mã-socket, không phải bởi cái switch được ghi công. Nó lọt vào **phán quyết của reviewer, phần hiện thực của implementer, và cả lần reviewer tự kiểm chứng lại** — ba bên, hai vòng đọc kỹ. Thứ giết nó là **một đột biến mất hai phút**.

→ ***"Chỉ cách một property"* là phát biểu về SỰ CÓ SẴN, và không nói gì về KHẢ NĂNG VỚI TỚI — mà bản sửa phụ thuộc vào cái thứ hai.** Phép soi tốn gần như không gì, sống sót qua ba người đọc cẩn thận, và **tới được hai artifact trước khi có bất cứ thứ gì bắt nó tự chứng minh**. Đó là lý do quy tắc này gắn vào từng khẳng định chịu lực, không gắn vào cả phát hiện.

**Sửa một trường hợp của một lớp lỗi không cho miễn nhiễm với lớp lỗi đó, và có thể còn làm yếu đi.**
D-2 tái tạo đúng lỗi I-5 **trong chính commit sửa I-5**, cách mười hai file. D-2 cũng tìm đúng cơ chế rò cổng rồi **khẳng định phạm vi thay vì đi grep**, và hai chỗ bỏ sót **tệ hơn** chỗ đã sửa. → **Biện pháp đối kháng là một đợt quét, không phải sự cẩn thận. Mọi bản sửa kèm một lệnh grep tìm anh em của nó.**

🔴 **Bổ sung sau Đợt D — ba trên ba, và đó không phải sự bất cẩn.** Cùng một hình dạng xảy ra ba lần trong đợt này, mỗi lần **bên trong chính bản sửa cho nó**: D-2 tái tạo I-5 trong commit sửa I-5; D-7c quét nửa vời trong lúc đang viết ra quy tắc chống quét nửa vời; và tôi thêm `EXPECT_WARNINGS` với lập luận *"một con số được in không phải một phép kiểm"* rồi **để nguyên một con số được in y hệt cách đó mười một dòng** (`BUILD_NODES` — bộ đo của chính bẫy số 8).

→ **Chẩn đoán: bản sửa và phép quét *cảm giác* như một hành động, nhưng là hai.** Khi đã hiểu ra cơ chế, việc sửa chỗ đang nhìn cho ta cảm giác *đã xong* — và cảm giác đó chính là lúc phép quét bị bỏ. Vậy nên phép quét phải là một bước **riêng, sau khi commit đã xanh**, không phải một phần của việc sửa.

🔴 **Và một đính chính về cách quét, sau khi một phép quét ĐÚNG vẫn mù (D-7b, ca thứ sáu của lớp "một chuỗi, hai đường sinh").**
Phép quét ấy grep tên trường phân biệt hai đường (`existing.Source`). Công thức đúng, phép tìm sai: tên trường **chỉ xuất hiện ở nơi nó đã nằm trong tầm nhìn**, nên phép quét liệt kê được những lệnh trả về *nhìn thấy* trường ấy mà bỏ qua nó, và **mù về cấu trúc** với một lệnh trả về trong một kiểu **chưa bao giờ nhận** trường ấy. Ca sống sót (`TryFindBlockedDevice`) nhận `bindings` + `roster`, không bao giờ nhận store — `Source` **không thể nào** xuất hiện trong grep đó.

→ **Bắt đầu từ TẬP CÁC LỆNH TRẢ VỀ, không phải từ tên trường**, rồi hỏi ở từng chỗ xem trường ấy có nằm trong tầm nhìn không. **"Không nằm trong tầm nhìn" là câu trả lời NGUY HIỂM, không phải câu an toàn.** Nếu đưa nó vào tầm nhìn là quá đắt ở một chỗ nào đó, hãy viết một câu **đúng mà không cần trường ấy** — tốt hơn một phép rẽ không dựng nổi — và nói rõ tại chỗ đó rằng câu hỏi **đã được đặt ra**.

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

→ 🔴 **Và đây là LÚC phải hỏi (thêm sau D-7c): khi một bài test LOẠI BỎ một nhân chứng rồi THAY bằng một nhân chứng khác, hãy kiểm xem cái thay thế có phải HÀNG XÓM của cái bị loại không.**

Quy tắc ở trên nói **thế nào là** một nhân chứng tốt. Câu này nói **khi nào** phải đặt câu hỏi ấy — và D-7c là bằng chứng rằng hai điều đó cần được viết riêng. Người viết D-7c **đã thấm quy tắc trên**: nó tự viết ra đoạn giải thích trung thực vì sao `LeaseCount` không đủ cho phép kiểm cuối — rồi vẫn hạ cánh xuống `HasBus`. `LeaseCount` → `HasBus` chỉ **dịch sang một trường**, cả hai đều là sổ sách của chính `ModbusBusRegistry`. **Biết quy tắc đã không kích hoạt nó; một cái cò súng thì có.**

Bằng chứng, do reviewer chạy lại độc lập trên cả hai nhân chứng:

| Đột biến | Nhân chứng CŨ (`LeaseCount`/`HasBus`) | Nhân chứng MỚI (`IsOpen` của chính cổng) |
|---|---|---|
| `DisposeAsync` không còn gọi `TearDownLink()` — bus bị dispose, link **vẫn mở** | **PASSED** — sống sót | **FAILED** — bị giết |
| Bỏ cache link-còn-sống trong `EnsureLinkAsync` — **mở lại mỗi giao dịch** | **PASSED** — sống sót | **FAILED** — bị giết |

Thứ được bảo vệ là **một cổng COM không bị giữ tới hết đời tiến trình**, và điều đó chỉ đọc được **từ chính cái cổng**. Đây cùng dạng với nguyên tắc thứ BA (mỗi bản sửa đi kèm một phép quét tìm anh em của nó): một cái cò súng cụ thể, gắn vào một khoảnh khắc cụ thể trong lúc viết test.

🔴 **(d) Cơ chế do NGƯỜI GIAO VIỆC cung cấp cũng phải chịu đúng phép kiểm ấy — nó không được miễn vì đã qua một vòng phản biện (G-2).**

Nguyên tắc "chỉ cách một property" ở trên nói về cơ chế do **reviewer** đọc ra. G-2 gặp cùng hình dạng ở một vị trí mới: brief giao cho nó **năm điểm sửa đã được phản biện đo lại**, và điểm số 1 nêu cả **chẩn đoán** (*"`git status --porcelain` in đường dẫn tương đối với gốc repo, nên một phép so khớp ngây thơ KHÔNG BAO GIỜ khớp"*) lẫn **thuốc chữa** (*"dùng `git diff --quiet`"*), kèm điểm số 5 nêu lý do thứ hai (*"để chuẩn hoá CRLF/filter không biến nó thành lệnh từ chối sai vĩnh viễn"*).

Chạy thử từ `tools/machine-simulator` trên một file bẩn, ba biến thể:

| Biến thể | Kết quả |
|---|---|
| `git status --porcelain \| grep -q "$p"` | **KHỚP** — đường dẫn in ra *chứa* đối số như một chuỗi con |
| `git status --porcelain \| awk '{print $2}' \| grep -qx "$p"` | **IM LẶNG** — đây mới là cái bẫy |
| `git status --porcelain -- "$p"` | **KHỚP** — để git tự phân giải pathspec |

→ *"Không bao giờ khớp"* **quá mạnh**, và *"porcelain là lệnh sai"* **sai hẳn**: dạng thứ ba chạy đúng. Lỗi nằm ở việc **so khớp ĐẦU RA của nó bằng tay**, và biến thể đi im lặng lại chính là biến thể tự nhiên nhất để viết. Lý do ở điểm 5 cũng không đứng được: `git status` và `git diff` đi qua **cùng một phép so với index và cùng bộ clean filter**, nên không có khác biệt CRLF nào giữa hai lệnh.

**Kết luận không đổi, lập luận thì đổi** — `git diff --quiet` vẫn đúng, vì nó **không có đầu ra để phải so**. Và bản sửa được thiết kế sao cho phép kiểm ấy **không chịu lực**: nó chụp ảnh **vô điều kiện** và chỉ dùng phép so để chọn giọng thông báo, nên một phép kiểm sai chỉ tốn một dòng log chứ không tốn công việc.

→ **Quy tắc: cơ chế đến kèm nhiệm vụ là một KHẲNG ĐỊNH, không phải một tiền đề. Chạy nó trước khi xây lên trên nó — kể cả khi nó đã được một vòng phản biện đo lại, vì cái được đo là TẦN SUẤT (1 trên 3 lần mất) chứ không phải CƠ CHẾ.** Cùng hình dạng như ca greet-then-RST, ở một chỗ mà không ai nghĩ là còn phải kiểm.

🔴 **(e) `finally` là một nơi trú của lớp lỗi này, không phải thuốc chữa của nó (G-2).**

G-2 đóng lớp lỗi ấy bằng `try`/`finally` ở từng chỗ. **Một trong các bản sửa mang đúng lỗi nó đang sửa**: một cú ném **bên trong** `finally` **bỏ luôn phần còn lại của chính `finally` ấy**, nên hai câu lệnh viết nối nhau trong một `finally` không phải hai bảo đảm — câu thứ hai vẫn phơi ra trước câu thứ nhất. Đúng cửa sổ mà bản sửa sinh ra để đóng.

🔴 **Nó thuộc nguyên tắc thứ BA ("sửa một trường hợp của một lớp lỗi không cho miễn nhiễm với lớp lỗi đó, và có thể còn làm yếu đi" — D-2 tái tạo I-5 ngay trong commit sửa I-5), KHÔNG thuộc §8.1(b).** Bản nháp đầu của mục này xếp nó là "lần thứ tư" của (b) — sai, và sai theo cách mà chính (b) cảnh báo: câu chốt của (b) là *cả ba lần lỗi đều nằm trong **văn xuôi**, không nằm trong logic*, còn ca của G-2 nằm **trong logic**. Nối thêm một thành viên phá đúng bất biến mà lớp ấy tự phát biểu, rồi đếm nó, là làm hỏng cả lớp. (Do phản biện bắt.)

**Thứ bắt được nó là bài test, không phải lần đọc lại.** Bản nháp trông đúng, đọc trôi, và giải thích chính nó một cách thuyết phục.

→ **Với mỗi `finally` có nhiều hơn MỘT câu lệnh, hỏi: nếu câu đầu ném thì câu sau còn chạy không? Nếu không, hoặc lồng chúng lại, hoặc nói rõ tại chỗ vì sao câu sau là no-op trên đúng đường ném ấy.**

**Và một phân biệt về bằng chứng:** một diff chỉ sửa chú thích là **bằng chứng kết luận về cây mã, và không nói gì về môi trường**. Cổng đỏ trên một commit như vậy nghĩa là máy bẩn, không phải mã hỏng — nhưng cách chữa là **dọn máy**, không phải nới trần.

**Và một đính chính về chính bộ công cụ này, do D-3 tìm ra.** Brief D-3 của tôi yêu cầu test phụ thuộc phần cứng phải *"bỏ qua sạch sẽ và ồn ào"*, trong khi `verify-suites.sh` — cũng của tôi — **fail khi `skipped != 0`**. Hai chỉ thị loại trừ nhau, và **cái phải đổi là brief, không phải script**: xUnit đếm test bị bỏ qua động vào `Total`, nên một bộ test phụ thuộc phần cứng làm `Skipped` **phụ thuộc môi trường** — và bất kỳ con số kỳ vọng cố định nào cũng sẽ làm **máy trang bị tốt hơn** bị đỏ. Đó là cái bẫy "một con số xanh mang nghĩa khác nhau trên các máy khác nhau", mặc áo phần cứng. **`skipped == 0` chính là thứ làm cho "817" mang cùng một nghĩa ở mọi nơi.**

→ Quy tắc đúng: **hành vi phụ thuộc phần cứng không bao giờ là một test bị bỏ qua có điều kiện bên trong năm bộ test.** Nó hoặc được **ghi rõ là khoảng trống chưa test** trong báo cáo và trong chú thích của cổng, hoặc được commit thành **một bench harness riêng nằm ngoài năm bộ** (`tools/serial-bench/`). Phép đo không commit được thì không tái lập được — reviewer D-3 phải **viết lại toàn bộ probe** để kiểm chứng các con số của D-3.

Công cụ bắt buộc từ D-3: `scripts/mutate-guard.sh` (so dấu thời gian + đối chứng dương mỗi phiên). Lý do đầy đủ nằm trong header của nó.

🔴 **PHÉP CENSUS — ngữ liệu của nó là một phần của phương pháp, không phải của từng brief (thêm sau Đợt E, E-4).**

Đợt D đã ghi *cách* quét: **một lần đọc được tổ chức theo chỗ một chủ đề được XẾP VÀO; một phép grep được tổ chức theo những TỪ mà một khẳng định dùng** — nên mọi chỗ bị sót đều là chỗ **xếp ở nơi khác**.

Đợt E thêm nửa còn thiếu: **QUÉT `src/` VÀ `tests/`, KHÔNG CHỈ `*.md`.**

Ba khẳng định cũ được tìm thấy trong **mã**, không phải trong tài liệu, ở E-4 — và cả ba đều thoát vì cùng một lý do: **khẳng định cũ nằm cạnh một phép kiểm vẫn xanh.** Trường hợp rõ nhất là `SerialDependencyScopingTests`: phép khẳng định của nó ghim *"DLL có được ship không"*, **không** ghim *"host này mở được cổng không"* — nên bốn câu quanh nó mục ruỗng hoàn toàn mà **không gì đỏ**. Một phép khẳng định đúng, hẹp, bền **không bảo vệ được đoạn văn quanh nó**, và không phép khẳng định nào làm được điều đó.

E-4 quy lỗi cho cách brief phát biểu (*"census tài liệu"*). **Đó không phải nguyên nhân**, và bằng chứng là chính phép quét sau-commit của E-4: chạy dưới **cùng quy tắc ấy** trên `src/`+`tests/`, nó tìm ra ngay. Nguyên nhân là **ngữ liệu không nằm trong quy tắc**, nên nó phải được suy ra từ câu chữ mỗi lần — và một lần nào đó sẽ suy sai.

→ **Phép quét là một hành động riêng, chạy sau khi commit đã xanh, trên `src/` + `tests/` + `*.md`.** Và cái nó đi tìm không phải câu sai — mà là **câu đúng đã trở thành sai vì thứ nó mô tả đã đổi**, đặc biệt ở nơi một phép kiểm gần đó vẫn xanh.

🔴 **VÀ NGAY LẦN ĐẦU QUY TẮC TRÊN ĐƯỢC ÁP, NÓ VẪN SÓT — vì ngữ liệu đúng không cứu được một quy tắc thiếu (review toàn nhánh Đợt E).**

Bốn khẳng định cũ **nằm gọn trong ngữ liệu vừa được thêm vào** và vẫn thoát. Lý do: **mỗi lượt quét chạy MỘT quy tắc.** Quy tắc của E-4 là *"host nào chủ trì connector nào trên transport nào"* — và có **cả một trục trực giao với nó** mà không nhiệm vụ nào chạm: *"kiểu nào sở hữu cái khoá, assembly nào sở hữu kiểu này."* Trên trục ấy có **32 chỗ trong 25 file**, trong đó hai chỗ vượt khỏi phạm vi tài liệu: **hợp đồng mà tác giả driver bên thứ ba được bảo phải tuân theo**, và **một chuỗi lỗi sống hiện trong CI**.

→ **Liệt kê CÁC QUY TẮC, đúng cách đã học liệt kê CÁC THÀNH VIÊN.** Ba tầng, cùng một bài học, mỗi tầng phải trả giá riêng: *thành viên thay vì kiểu* → *ngữ liệu thay vì chỉ tài liệu* → **quy tắc thay vì một quy tắc**.

🔴 **Hai điều bổ sung, và cái thứ nhất là thứ không phép quét nào với tới.**

**(a) Có thứ mục ruỗng vì THIẾU MỘT PHÉP KIỂM, không vì thiếu một lượt quét.** Bốn `cref` xuyên assembly trỏ tới `FleetHost` nằm trong file EdgeCore — **chúng chưa bao giờ phân giải được, ở bất kỳ đợt nào**. Chúng sống sót vì **không project nào bật `GenerateDocumentationFile`**, nên `cref` không bao giờ được trình biên dịch kiểm. *Liệt kê thêm quy tắc sẽ không bắt được lớp này; bật sinh tài liệu cho các assembly hợp đồng thì có.* **Trước khi thêm một quy tắc quét, hỏi xem thứ đang mục có đáng lẽ phải do một phép kiểm bắt hay không.**

🔴 **ĐÃ ĐO, 2026-08-08 — và con số lớn hơn bốn.** Bật `GenerateDocumentationFile` kèm `NoWarn CS1591` trên **riêng `St4i.Connector.Abstractions`** làm lộ **32 cảnh báo `CS1574`** ở **16 chỗ** (`DeviceReading`, `DisposeAsync`, `DriverKind`, `Genealogy`, `Load`, `TelemetryNumeric`, `TryGet`, `Value`). **Đó là assembly hợp đồng — thứ tác giả driver bên thứ ba đọc trước tiên** — và chưa từng có gì kiểm nó, ở bất kỳ đợt nào.

Thí nghiệm đã hoàn nguyên, không commit: 32 cảnh báo ấy là **32 lỗi thật cần sửa, không phải nhiễu cần tắt**, nên bật cờ mà không sửa sẽ đẩy `EXPECT_WARNINGS` từ 116 lên 148 và biến một phép kiểm mới thành một khoản nợ mới. **Việc đúng là một hạng mục riêng: bật cờ cho các assembly hợp đồng, SỬA cả 16 chỗ, và cảnh báo quay về 116** — lúc đó con số vẫn mang đúng một nghĩa và lớp lỗi này có người canh vĩnh viễn.

*Bản thân phép đo này là ví dụ cho chính quy tắc: một lượt quét theo quy tắc sẽ không bao giờ tìm ra 16 chỗ đó, vì chúng không sai theo một chủ đề nào — chúng chỉ đơn giản là **không phân giải được**, và chỉ một trình biên dịch mới biết điều đó.*

🔴 **(a2) TẦNG THỨ TƯ, thêm sau E-5: quét cả REGISTER, không chỉ ngữ liệu và quy tắc.**

Quy tắc census của E-5 đúng, ngữ liệu đúng, và nó vẫn bỏ sót **đúng một chỗ**. Mọi chỗ nó tìm ra phát biểu quy
tắc ấy **cho một lập trình viên** — một chú thích, một khối doc, một mục README. Chỗ nó bỏ sót phát biểu
**cho một người vận hành**, ngay khoảnh khắc họ đang đứng trước sự cố: chuỗi giải thích vì sao một cổng COM bị
giữ. Hai thứ đó là **hai quần thể văn bản khác nhau, tìm bằng hai phép tìm khác nhau** — và ở quần thể thứ hai,
một câu sai tốn **một giờ trong ca trực của ai đó**, không phải sự kiên nhẫn của một reviewer.

→ **Một phép quét theo quy tắc phải liệt kê cả nơi quy tắc ấy được NÓI RA CHO NGƯỜI VẬN HÀNH, không chỉ nơi nó
được viết cho lập trình viên.**

**Và bản thân sự phân tầng giờ đã là cái mẫu:** thành viên → ngữ liệu → quy tắc → register. **Mỗi đợt đều phát
hiện lượt quét trước đó ĐÚNG và THIẾU PHẠM VI đúng một chiều.** Đừng đọc bốn tầng này như một danh sách đã
đóng; đọc nó như bằng chứng rằng chiều thứ năm tồn tại và chưa ai gọi tên.

🔴 **(a3) Nêu tên ĐẠI LƯỢNG mà dụng cụ của anh thật sự đo, rồi đối chiếu với đại lượng TIÊU CHÍ nêu tên.**

Ba lần trong hai đợt, một dụng cụ trả lời một câu **hẹp hơn** câu tiêu chí hỏi, và được phát biểu **bằng giọng
của tiêu chí**: một bảng đếm "điểm mã do host cung cấp" dùng để nghiệm thu tiêu chí "I/O **hoặc `Dispose`**";
một `git diff` cấp **file** dùng cho một tiêu chí nói về một **cuộc đi bộ** phụ thuộc cả callee (E-3 và E-5 làm
điều này **hai lần, sau khi §10.3(c) đã viết ra bài học**); và những con số "bảy lần" / "~730 ký tự" phát biểu
như đã đo trong khi chưa đếm.

**Kết luận đúng cả ba lần** — đó chính là chỗ nguy hiểm: một dụng cụ hẹp hơn vẫn cho câu trả lời đúng đủ lâu để
không ai đi kiểm nó, cho tới lần nó không đúng nữa.

**(b) 🔴 Artifact ít được quét nhất trong một thay đổi là LỜI BIỆN MINH CỦA CHÍNH TÁC GIẢ.** Ba lần trong hai đợt, một bản sửa ship kèm **đúng hình dạng nó đang sửa** — và cả ba lần lỗi nằm trong **phần văn xuôi giải thích gắn vào bản sửa**, không nằm trong logic của nó:
- một lời tổng quát hoá sai phủ năm artifact, viết bằng giọng của một phép đo;
- một chú thích sai **về chính bài test nó đứng cạnh**;
- một chuỗi hướng-người-vận-hành nêu một đường sinh **không thể sinh ra nó** — **và một test ghim chuỗi ấy lại**.

**Cả ba đều do reviewer bắt, không lần nào do tác giả.** Khi ta vừa hiểu ra một cơ chế, phần giải thích ta viết ra *cảm giác* như đã được kiểm bởi chính sự hiểu ấy. Nó không. **Câu văn biện minh cho một bản sửa phải chịu đúng phép kiểm mà bản sửa phải chịu** — và nếu nó khẳng định một điều phổ quát ("mọi chuỗi cũ đều…", "không thành viên nào…"), thì **liệt kê để phủ định nó trước khi commit**, vì đó chính là dạng câu mà lớp lỗi này thích trú.

🔴 **(c) Với MỖI phép đo đã ghi trong `src/`: những khẳng định nói-với-người-vận-hành nào mô tả cùng cơ chế ấy, và chúng có KHỚP với nó không?** (F-1)

Một thông báo cho người vận hành nói khung tin lạc "trở thành một giao dịch bị từ chối chứ không phải một giá trị
sai, nên hậu quả là suy giảm chứ không phải dữ liệu hỏng". `ModbusBus.cs:102-105` ghi lại phép dò của **chính
repo này** bác bỏ nó: khung tin cũ cùng địa chỉ slave, cùng mã hàm, cùng số byte thì **không bị bắt và được trả
về cho người gọi như câu trả lời** — đúng trường hợp mà thông báo ấy sinh ra để cảnh báo. Nó ship trong dòng log
ở cả hai host và trong thân phản hồi `POST /v1/connectors`.

**Ba vòng phản biện đã ĐỌC câu đó và cho qua.** Bài test câu chữ của chính tác giả khẳng định cái nhãn "chưa đo"
**có mặt** — một dụng cụ đo *"tần suất đã được rào chưa"* đối chiếu tiêu chí *"câu này có đúng không"*, tức
(a3) lần thứ tư. Bằng chứng bác bỏ nằm **cùng assembly, cách ba file**.

**Chẩn đoán đầu tiên cũng sai, và sai theo hướng đắt nhất:** tác giả xếp nó là **thiếu một tầng ngữ liệu thứ
sáu**. Không phải. Câu ấy đã nằm trong ngữ liệu của **hai** quy tắc sẵn có — R3 ("ai phân xử hai host trên một
dây": câu ấy ở ngay trong đoạn đó) và R5 ("nơi một luật được nói cho người vận hành": nó là dòng log và thân
HTTP). Cả hai quy tắc **đã lôi nó ra**. Thứ thiếu là **một bước KIỂM CHỨNG áp lên những câu mà các quy tắc sẵn
có đã đặt trước mặt người ta** — không phải một phép quét. **Xếp một phép kiểm còn thiếu thành một ngữ liệu còn
thiếu sẽ đẩy đợt sau đi lùng thứ văn bản không ai đọc, trong khi vấn đề là thứ văn bản ba người đã đọc và không
ai kiểm.**

**Dạng chạy được là dạng ĐẢO NGƯỢC.** Chạy xuôi từ "khẳng định nào mâu thuẫn với một phép đo" thì không có điểm
khởi đầu máy móc: tập khẳng định vô hạn, và không grep được cái "mâu thuẫn". Nhưng repo này **tự viết một chỉ
mục nhỏ, đặc thù, grep được cho các phép đo của chính nó** — `Probed directly`, `by probe`, `measured two ways`,
`established by probe rather than by reading`, `measured rather than read`. Liệt kê tập ấy (hữu hạn và nhỏ), rồi
với mỗi phép đo **quét xuôi** tới mọi câu nói-với-người-vận-hành về cùng cơ chế. Đi từ "phép dò về khung tin cũ"
tới "chuỗi vận hành của ta nói gì về khung tin lạc" mất **một bước**, và nó rơi trúng `DescribeSegmentOwnership`.

**Đây là tầng hiếm hoi mà ngữ liệu tự lớn lên theo chính thói quen nó dựa vào** — khác phép grep từ lượng hoá,
độ bao phủ của nó không bám vào từ ngữ tác giả tự chọn. (Lý do **thật** để từ chối phép grep `every|all|no arm`
cũng là **độ bao phủ**, chứ không phải "grep không quyết định được đúng/sai" — lý lẽ sau loại luôn cả chốt đếm
ship cạnh nó, vì chốt đếm cũng chỉ quyết định *sự nhất quán*. Khẳng định phổ quát sai tệ nhất của F-1 **không
dùng từ lượng hoá nào**.)

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
