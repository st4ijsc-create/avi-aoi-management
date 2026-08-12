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

🔴 **(f) MIỀN của một dụng cụ được THỪA HƯỞNG từ vị trí của người viết, chứ không được SUY RA từ câu hỏi (G-2, SÁU ca).**

Bốn tầng ở (a2) — *thành viên → ngữ liệu → quy tắc → register* — đều nói về **cái gì** phải quét. Điều này nói về **ở đâu**, và nó là chiều mà (a2) tự dự báo là còn tồn tại mà chưa ai gọi tên.

**Phát biểu:**

> **Miền của một dụng cụ được thừa hưởng từ VỊ TRÍ của người viết, không phải suy ra từ CÂU HỎI. Vị trí ấy khi thì là một TẦNG, khi thì là một TỪ VỰNG. Cả hai đều ngẫu nhiên đối với câu hỏi, và không cái nào NHÌN THẤY ĐƯỢC TỪ BÊN TRONG dụng cụ. Hãy suy miền ra từ TÍNH CHẤT đang săn — "trạng thái ghi ở đây, hoàn tất ở chỗ khác sau", "một seam của host đứng trước phần việc không được phép bỏ" — rồi hỏi tính chất ấy CÓ THỂ SỐNG Ở ĐÂU, TRƯỚC khi chọn cách đi tìm.**

**Sáu ca, phân loại — ba TẦNG, ba TỪ VỰNG:**

| # | Ca | Cái gì đã chặn miền của dụng cụ | Loại |
|---|---|---|---|
| 1 | Dòng audit `fleet.estop` (G-2 I-4) | miền của phép quét S-set là "đường có giữ `_gate`"; `FleetHost` không giữ khoá nào | **tầng** |
| 2 | Phương án (c) của S6 | liệt kê phương án từ **bên trong** `UpdateSettings`; (c) sống ở `Program.cs` | **tầng** |
| 3 | Đường log thứ năm của G-1 (`UnsPublisher`) | phép census đếm các chỗ `_logger?.` **bên trong `FleetCore.cs`**; chỗ này nằm trong callee | **tầng** |
| 4 | `StartSlot` (G-2 NEW-1) | cùng file, cùng class. Phép grep khoá vào `_logDebug` **trong vòng lặp dispose**; chỗ này là `_logError` trong handler lỗi | **từ vựng** |
| 5 | `DrainSeedNotifications` (G-2 m-1) | cùng file, cùng class. Sót vì nó *"không phải vòng lặp dispose, cũng không phải handler lỗi"* | **từ vựng** |
| 6 | Phép quét đổi nhãn P (G-2 NEW-6) | miền lấy từ **VÍ DỤ** mà phát hiện dùng (`P5`), không lấy từ tính chất (*mọi tham chiếu theo thứ tự tới danh sách ấy*); `P8` sót ở mọi nơi | **từ vựng** |

🔴 **Vì sao ca 6 xếp vào TỪ VỰNG chứ không phải một loại thứ ba** — trục phân loại là *cái gì đã CHẶN miền*, không phải *vì sao nó bị chặn*. Miền của ca 6 bị chặn bởi một **tập từ** ("path 5"/"item 5"/"path B") và sót vì "path 8" không nằm trong tập ấy: đúng định nghĩa nửa từ-vựng. Cái RIÊNG của nó là **nguyên nhân** khiến tập từ ấy sai — một ví dụ minh hoạ bị nhầm thành đặc tả miền — và đó là một **quy tắc con của nửa từ-vựng**, ghi ở cuối mục này. Tách nó thành loại thứ ba sẽ chẻ bảng theo *vì sao*, phá đúng cái trục mà quy tắc dựng trên.

**Nó BAO TRÙM D-7b/D-7c** — *"bắt đầu từ TẬP CÁC LỆNH TRẢ VỀ, không phải từ tên trường"* — đúng bằng nửa từ-vựng của nó. Hai quy tắc ấy vẫn đúng và vẫn là cái cò súng cụ thể; điều này nói **vì sao** chúng cần thiết, và bổ sung nửa còn lại mà chúng không phủ.

🔴 **Và chính lời phát biểu đầu tiên của nguyên tắc này là một ca của (b).** Người thực thi G-2 phát biểu nó là *"thứ tôi không nhìn thấy luôn nằm cách một TẦNG"* — một đường thẳng khớp qua ba điểm mà **hai trong ba cùng loại**, và ca thứ ba (`StartSlot`) **mâu thuẫn với chẩn đoán đã viết sẵn ở chính chỗ ấy**. Nó đã kịp **ship vào một file sản phẩm** trước khi phản biện toàn nhánh bắt được. Một chẩn đoán đang được nâng lên thành quy tắc là chỗ đắt nhất cho một khẳng định phổ quát sai, vì mọi thứ phía sau sẽ được viết dựa trên nó.

→ **Trước khi nâng một chẩn đoán thành quy tắc, hãy liệt kê để PHỦ ĐỊNH nó — và đếm xem có bao nhiêu điểm thực sự KHÁC LOẠI.** Ba ca cùng một loại không phải ba bằng chứng; đó là một bằng chứng được đếm ba lần.

🔴 **Hệ quả về PHÂN LOẠI MỨC ĐỘ, thêm sau vòng phản biện cuối — và nó bác bỏ đề xuất của chính người thực thi.**

G-2 đề xuất một quy tắc phân loại: *"một câu sai CHO PHÉP một hành động thì nặng hơn một câu chỉ đưa tin sai"* — đúng, hữu ích, và nó tách được NEW-1 (bảo người ta đi tìm một bài test không tồn tại) khỏi một con số sai trơn. **Nhưng dùng nó làm BỘ LỌC thì lọt, và bằng chứng nằm ngay trong commit đề xuất nó.**

| Vì sao nó lọt | Ca |
|---|---|
| Nó **hạ thấp có hệ thống các KHẲNG ĐỊNH VỀ TÍNH ĐẦY ĐỦ.** *"Mọi call site đã được đổi."* *"Phép quét tìm ra sáu."* *"Không có I/O nào dưới khoá."* Chúng cho phép một sự **BỎ SÓT**, không phải một hành động — người đọc **thôi không kiểm nữa**. | NEW-6 chấm điểm thấp theo quy tắc ấy, mà NEW-6 chính là cái chặn merge. |
| **Tính "cho phép hành động" do chính tác giả chấm, từ bên trong artifact** — tức là §8.1(f) áp lên chính khâu phân loại. | Khi phản biện chặn ở C-1, nó **không nêu được** hành động nào C-1 cho phép; nó chặn trên cơ sở "từ vựng chuẩn". Về sau mới lộ ra C-1 **đã** cho phép một suy luận sai trong một artifact khác. Tính cho phép hành động chỉ nhìn thấy được **khi đã muộn**. |
| Nó hạ thấp **khẳng định phổ quát sai trong một quy tắc đang được nâng cấp**. | *"Luôn cách một tầng"* không cho phép hành động tức thời nào — nhưng mọi thứ phía sau sẽ được viết dựa trên nó. |

→ **Cặp quy tắc phải đi cùng nhau:**

> **Xếp hạng theo tính CHO PHÉP HÀNH ĐỘNG — một câu sai khiến người đọc LÀM một việc nặng hơn một câu chỉ khiến họ TIN sai. NHƯNG một khẳng định về TÍNH ĐẦY ĐỦ hoặc TÍNH PHỔ QUÁT là NẶNG bất kể xếp hạng, vì tác hại của nó là khiến người đọc THÔI KIỂM, và tác hại ấy vô hình theo đúng cấu trúc của nó.** Liệt kê để PHỦ ĐỊNH một câu phổ quát trước khi ship nó; phần còn lại thì xếp hạng.

Hai vế rời nhau thì mỗi vế đều để lọt một ca của đợt này; đi cùng nhau thì phủ được cả NEW-6, NEW-1 lẫn C-1/C-2.

🔴 **Và ca cuối cùng của (f) trong đợt này là ca sạch nhất: chính phép quét đổi tên P-label.** Phát hiện NEW-5 minh hoạ vấn đề "ba tên cho một thành viên" bằng **ví dụ P5**. Phép quét đi đổi **P5** — và bỏ sót **P8 ở mọi nơi**, tạo ra một trạng thái từ vựng **phụ thuộc thành viên**, tệ hơn cả trạng thái chưa gán nhãn. Miền của phép quét được thừa hưởng từ **VÍ DỤ mà phát hiện dùng**, chứ không suy ra từ **TÍNH CHẤT** (*mọi tham chiếu theo thứ tự tới danh sách này*). Xảy ra **trong chính commit nâng (f) lên blueprint, do chính tác giả của (f)**.

→ **Một ví dụ trong lời phát hiện là một VÍ DỤ, không phải một ĐẶC TẢ MIỀN.** Trước khi quét, hãy viết ra tính chất bằng câu chữ không chứa ví dụ ấy — rồi quét theo tính chất. *(Đây là quy tắc con của nửa TỪ VỰNG, không phải một loại riêng.)*

🔴 **Và một giới hạn của chính dụng cụ, tìm ra ở vòng cuối (NEW-7): với tính chất "tham chiếu theo thứ tự", GREP KHÔNG PHẢI DỤNG CỤ ĐẦY ĐỦ — ĐỌC ĐOẠN VĂN MỚI LÀ.** Ba tham chiếu còn sót thoát qua **ba** cơ chế chồng lên nhau: danh từ khác (`path`/`item`), chữ hoa (`Item` đầu câu), và — cái không phép grep một-dòng nào với tới được — **ngắt dòng rơi đúng giữa "item" và "7"**. Một chỗ (*"Folding 7 into 3"*) **không có danh từ nào cả**. Mở rộng biểu thức không cứu được: cơ chế thứ ba nằm ngoài khả năng của một phép tìm theo dòng, và cơ chế thứ tư là không có từ khoá.

→ **Khi tính chất là một THAM CHIẾU chứ không phải một TOKEN, hãy chốt phép quét bằng một lượt ĐỌC đoạn văn.** Và đừng gắn khẳng định "đã đổi hết" vào một danh sách mà dụng cụ của bạn về cấu trúc không quét hết được.

**Và một phân biệt về bằng chứng:** một diff chỉ sửa chú thích là **bằng chứng kết luận về cây mã, và không nói gì về môi trường**. Cổng đỏ trên một commit như vậy nghĩa là máy bẩn, không phải mã hỏng — nhưng cách chữa là **dọn máy**, không phải nới trần.

🔴 **(g) "CHỈ LÀ CHÚ THÍCH" LÀ MỘT KHẲNG ĐỊNH VỀ MỘT THAY ĐỔI, KHÔNG PHẢI MỘT TÍNH CHẤT CỦA NÓ (H-1).**

Mục (d) nói: cơ chế đến kèm nhiệm vụ là một **khẳng định**, phải chạy trước khi xây lên trên nó. Mục này
là **cùng quy tắc ấy áp lên NHÃN MỨC ĐỘ mà chính người sửa tự dán** — và nhãn nguy hiểm nhất là nhãn
khiến người ta bỏ qua vòng đột biến, vì nó tự bào chữa: *"chỉ là chú thích, không có gì chạy được để mà
hỏng."*

**Ca sinh ra nó.** H-1 sửa một dòng log ở lối khởi động: một bản sửa **trông y hệt chú thích** — nó chỉ
đổi câu khuyên người vận hành sao cho nhánh "gieo mầm" không còn chỉ tới một file mà host sắp xoá. Đột
biến **R6** gộp hai câu khuyên trở lại làm một, tức **dựng lại đúng khiếm khuyết vừa sửa**, và **mọi
assertion trong file vẫn XANH**. Bản sửa ấy suýt được ship như một chú thích đọc-thì-đúng mà **không có
gì giữ**.

→ **Cái cò súng, và nó SẮC hơn "luôn luôn đột biến" vì luôn-luôn thì bị bỏ đúng lúc cần nhất — một câu
hỏi tại thời điểm commit:**

> **Bản sửa này có đổi một CHUỖI mà một bài test đang khẳng định — hoặc CÓ THỂ khẳng định — hay không?**
> Nếu có, nó không phải "chỉ là chú thích": nó là hành vi quan sát được, và nó phải bị đột biến trước khi
> được gọi là đã sửa.

Chuỗi hướng-người-vận-hành, thông điệp lỗi, nhãn, đơn vị, tên file trong lời khuyên — tất cả đều là **bề
mặt sản phẩm**. Trình biên dịch không phân biệt chúng với chú thích; **bài test thì có**, nhưng chỉ khi ai
đó nghĩ tới việc viết ra. Cách phân loại theo "diff này có đổi file `.cs` nào không" trả lời sai ở đúng
lớp này, và §8.1 đã trả giá cho nó một lần: một diff chỉ-sửa-chú-thích là bằng chứng kết luận **về cây
mã** (đoạn ngay trên) — nhưng "chỉ-sửa-chú-thích" phải được ĐO chứ không được tự khai.

🔴 **(h) MỘT KHẲNG ĐỊNH CHỈ LÀ BẰNG CHỨNG CHO ĐÚNG TRẠNG THÁI CÂY MÃ NÓ ĐƯỢC KIỂM CHỨNG TRÊN ĐÓ — VÀ CHỖ LỚP LỖI NÀY TỤ LẠI LÀ BƯỚC SỬA, KHÔNG PHẢI CÔNG VIỆC GỐC (J-1, mở rộng ở J-1b).**

> 🔴 **Tiêu đề mục này TỪNG đọc là "một PHÉP ĐO … cây mã nó đã CHẠY trên đó", và chữ ấy quá hẹp — sửa
> tại chỗ, KHÔNG tách thành mục (i), vì các danh sách trong file này đã trôi một lần rồi.** Chủ ngữ
> đúng của (h) là **bất kỳ khẳng định nào được kiểm chứng đối chiếu với một TRẠNG THÁI của cây mã**:
> một phép đột biến, một phép đo, **và một CÂU VĂN nói một bài test bảo vệ cái gì**. Cái chung không
> phải là "phép đo"; cái chung là **chỉ mục theo trạng thái cây mã**. Lý do phải mở rộng thay vì thêm
> một chữ cái nằm ở §(h2) cuối mục này.
>
> 🔴 **Và lần mở rộng ĐẦU chỉ đụng đúng cái tiêu đề này** — phần thân bên dưới vẫn nói bằng từ vựng
> đột biến và **cả ba** thuốc chữa của nó vẫn chỉ áp được cho phép đo, nên một người chỉ đọc (h) vẫn
> nhận về một quy tắc dành-cho-phép-đo nằm dưới một tiêu đề nói về mọi khẳng định (phản biện toàn
> nhánh, Important 5). Đã vá bằng bảng chia việc ở cuối phần thân: **thuốc nào cho nửa nào.** Ghi lại
> vì đó là đúng lớp lỗi mục này nói tới — **một bản sửa đúng nhưng chưa tới nơi trông y hệt một bản
> sửa đã xong**.

Mục (f) nói phạm vi của một dụng cụ bị **thừa kế từ chỗ tác giả đang đứng**. J-1 sinh ra **bảy** ca của lớp
ấy trong **một** nhiệm vụ, và chúng tách làm hai trục khác hẳn nhau.

**Trục KHÔNG GIAN — sáu ca, đã biết:** sai file, sai hàm, sai mục, sai dòng được trích. Dụng cụ nhắm sai chỗ.

🔴 **Trục THỜI GIAN — một ca, mới, và đắt nhất:** dụng cụ **nhắm đúng**, kết quả **đúng vào lúc nó được tạo
ra** — và **cái nó đo đã dịch đi bên dưới nó**.

**Ca sinh ra nó.** `StartLocked` có một chốt HALT: `if (IsRunning || _estopEngaged) return`. Một phép đột
biến xoá chốt ấy đã chạy và **CHẾT** — bằng chứng tốt. Vòng sửa sau đó thêm một bộ đếm yêu-cầu-dừng, khiến
`Start()` **trả về trước khi** phần chạy dưới khoá được gọi. Chốt vẫn đúng; **chứng nhân của nó thì không
còn**. Phép đột biến cũ **không được chạy lại**, và kết quả CHẾT của nó tiếp tục được dẫn qua **hai vòng**
trong **ba artifact**. Chạy lại ở đầu nhánh: **SỐNG SÓT — 1330/1330 xanh với chốt HALT bị XOÁ.** Không một
test nào phân biệt được.

**Không quy tắc phạm vi nào bắt được chuyện này**, vì không có gì bị nhắm sai. Đột biến canh **bài test**;
cổng canh **cây mã**; và **không gì canh một kết quả được đánh chỉ mục theo một cây mã, đem dẫn cho một cây
mã khác**.

→ **"Tuổi" là một đại lượng thay thế BỊ HAO — đây là câu hỏi về DIFF, không phải về tuổi.** Phép đo ấy chỉ
vài ngày tuổi.
→ **Đường với tới, không phải cơ chế.** Bản nháp đầu của quy tắc này canh "cơ chế có đổi không" và **sẽ
không bắt được chính ca khai sinh ra nó**: vòng sửa ấy **chưa từng chạm vào cái chốt**, nó thêm một lệnh trả
về sớm **ở thượng nguồn**. Quy tắc đúng: **chạy lại các đột biến của một cái chốt khi BẤT CỨ THỨ GÌ nằm giữa
một lối vào công khai và cái chốt ấy thay đổi** — và chạy lại **CẢ CỤM** khi file của chúng đổi, chứ không
chọn theo cảm tính, vì "đột biến nào còn áp dụng được" **chính là phép cảm tính đã thất bại**.
→ Mỗi hàng trong bảng đột biến mang **mã commit nó đã chạy trên đó**. Cần, nhưng **chưa đủ**: nó làm một
hàng bác bỏ được bằng mắt, **không có gì ép người ta đặt câu hỏi**, và nó chỉ phủ cái bảng — trong khi lời
khẳng định sai còn được **trích lại trong văn xuôi**.

🔴 **BA THUỐC CHỮA VỪA KỂ CHỈ ÁP ĐƯỢC CHO NỬA "PHÉP ĐO" CỦA CHỦ NGỮ ĐÃ MỞ RỘNG — nói rõ ở đây, vì bản mở
rộng trước chỉ sửa TIÊU ĐỀ và như thế đọc lên như đã xong (phản biện toàn nhánh, Important 5).** "Chạy lại
cả cụm", "mỗi hàng mang mã commit", "tuổi là đại lượng bị hao" đều giả định thứ được kiểm chứng **chạy
được**. Với nửa còn lại của chủ ngữ — **một CÂU VĂN nói bài test nào canh cái gì** — cả ba đều **không dùng
được**: không có gì để chạy lại, không có hàng nào để gắn mã commit, và tuổi thì bằng không (ca tệ nhất là
câu văn viết **trong cùng commit** với đoạn mã làm nó sai). Thuốc chữa cho nửa ấy là **(h2) ở dưới**, và nó
là một thuốc khác về bản chất chứ không phải cùng một thuốc nói lại: **một lượt ĐỌC LẠI KHI ĐÓNG, đối chiếu
với trạng thái CUỐI của diff.** Đọc (h) mà bỏ (h2) thì vẫn còn là một quy tắc chỉ-dành-cho-phép-đo nằm dưới
một cái tiêu đề nói về mọi khẳng định.

**Chia việc, để không ai phải đoán:**

| Thứ được kiểm chứng | Thuốc chữa |
|---|---|
| một phép đột biến / một phép đo | chạy lại cả cụm; mỗi hàng mang mã commit **và bộ test** nó chạy trên đó (xem quy tắc ghép đôi ở cuối §8.1) |
| **một câu văn nói cái gì canh cái gì** | **(h2)** — đọc lại khi đóng, mô phỏng cả giả thuyết trên cây mã sau cùng |

🔴 **VÀ ĐÂY LÀ NỬA CÓ GIÁ TRỊ NHẤT — CHỖ LỚP (f) TỤ LẠI.** Hai cách đếm cùng tồn tại: "hai trên bảy" (ca
nằm trong bản sửa cho một ca (f) trước đó) và "năm trên bảy" (ca nằm trong **bất kỳ** bước sửa nào). Chúng
trả lời **hai câu hỏi khác nhau** và đã bị dùng thay cho nhau — tức **chính lỗi (a3), áp lên bằng chứng cho
một quy tắc về (a3)**.

**Và không phép đếm nào chứng minh được "sự tập trung"**, vì sau vòng một thì gần như **mọi** việc đều là
việc sửa: năm-trên-bảy xấp xỉ đúng cái tỉ lệ đều cho ra. Đó là một xu hướng đọc trên một mẫu số sai.

**Thứ làm nó đúng là một CƠ CHẾ:** trong **bốn trên năm** ca, **chính lời phê bình đã TRAO cho bản sửa cái
phạm vi của nó** — một dòng, một hàm, một mục, hai số mục — và **việc nhận lấy cái phạm vi được trao ấy mới
là thất bại**. Công việc gốc **không có** phạm vi được trao sẵn nên buộc phải tự chọn; **bước sửa bỏ qua đúng
khoảnh khắc chọn ấy, vì nó có cảm giác đã được trả lời rồi.** (Ca trục-thời-gian **không** chia sẻ cơ chế
này — nhất quán với việc nó là một trục riêng.)

→ **Kết luận dùng được, và nó HẸP hơn "các bản sửa hay đẻ lỗi": quy tắc (a) — viết ra tính chất cần quét
bằng những từ KHÔNG chứa ví dụ nào của lời phê bình — thuộc về giao thức TRẢ LỜI PHÊ BÌNH, như bước bắt buộc
đầu tiên khi nhận MỌI phát hiện, TRƯỚC mọi thao tác sửa.**

Bằng chứng gần nhất: chính vòng sửa cho ca (f) thứ tư đã đẻ ra ca thứ bảy, và phép quét sửa-tại-chỗ sau đó
đẻ ra ca thứ tám — **trong đúng tài liệu đang lý thuyết hoá về lớp lỗi này**, một vòng sau khi quy tắc được
viết ra.

🔴 **(h2) HỆ QUẢ CÙNG-COMMIT, thêm ở J-1b — và đây là lý do (h) phải MỞ RỘNG chứ không được đẻ thêm một
chữ cái.**

**Ca sinh ra nó.** J-1b thêm một bước kiểm trước ở `RebuildPipelineOffLock`, và **trong cùng commit ấy**
viết ba chỗ nói bài test "số không" của nó *"làm một thay đổi sau này khiến restart trở thành vô điều kiện
phải đỏ"*. Câu ấy **sai ngay lúc được viết**: chính bước kiểm vừa thêm trả về trước `BuildStartPlan` trong
đúng giả thuyết đó, nên bài test vẫn xanh. Không ai dẫn một kết quả cũ qua một cây mã mới — **cây mã đã dịch
đi bên dưới câu văn trong khoảng thời gian giữa lúc viết câu ấy và lúc commit**.

**Vì sao (h) như đã viết KHÔNG bắt được nó, dù đây đúng là (h).**
- **Cò súng của (h) không nổ.** (h) canh *"có gì thay đổi giữa một lối vào công khai và cái chốt kể từ khi
  phép đo được lấy?"* — một câu hỏi về **hai thời điểm**. Cùng-commit thì không có hai thời điểm nào để so:
  câu văn được viết **SAU** đoạn mã, **trong cùng một cây**, nên nó **có cảm giác đương thời theo đúng cấu
  tạo**. Đó là biến thể **nguy hiểm nhất** của lớp này, không phải biến thể nhẹ nhất.
- **Thuốc chữa của (h) không có ở đây.** Thuốc của (h) là **CHẠY LẠI**. Một câu văn không chạy lại được.
- **(g) chỉ sai hướng.** (g) hỏi *"bản sửa này có phải chỉ-là-chú-thích không"* — tức **sửa cái gì**. Câu
  hỏi ở đây ngược lại: *"đoạn mã tôi vừa sửa có làm một câu văn CÓ SẴN (kể cả câu tôi vừa viết) thành sai
  không?"*

→ **QUY TẮC, và nó là thuốc chữa DUY NHẤT còn lại vì "chạy lại" không dùng được: một lượt ĐỌC LẠI KHI ĐÓNG,
trên MỌI khẳng định về việc-cái-gì-canh-cái-gì nằm trong diff, đối chiếu với TRẠNG THÁI CUỐI CÙNG của diff
ấy — không phải với trạng thái lúc câu ấy được gõ ra.** Cụ thể: với mỗi câu trong diff nói *"bài test này
làm X đỏ"*, hãy **mô phỏng X trên cây mã sau cùng**, kể cả khi X là một giả thuyết. Nếu mọi phép khẳng định
vẫn xanh, câu ấy **sai** — và nó sai theo hướng tệ nhất, vì nó **bảo người đọc thôi không kiểm nữa** (xem
cặp quy tắc "khẳng định về TÍNH ĐẦY ĐỦ" ở (f)).

→ **Và ghi lại phép đệ quy, vì đó mới là điểm chính: (h) đã bị chính VÍ DỤ của nó thu hẹp phạm vi.** (h)
sinh ra từ một phép **đột biến**, nên nó được viết bằng từ vựng của đột biến ("phép đo", "chạy lại", "mã
commit trên mỗi hàng") và **miền của nó bị thừa hưởng từ ca khai sinh** thay vì được suy ra từ **tính chất**
(*chỉ mục theo trạng thái cây mã*). **Đó chính là §8.1(f), áp lên §8.1.** *(🔴 Phản biện toàn nhánh, Minor 10: chỗ này từng viết **"ca thứ chín CỦA LỚP ẤY"**, lấy bộ đếm **cục bộ trong J-1** — bảy ca, xem đầu mục này — rồi phổ quát hoá nó ra cả lớp, trong khi riêng bảng của §8.1(f) đã có sáu ca G-2 trước bảy ca của J-1. **Không đánh số lại** — đánh số một lớp trải khắp nhiều đợt là đúng thứ đã hỏng ba lần ở đây — mà bỏ hẳn con số: nó không làm việc gì trong lập luận.)* Và lần này
nạn nhân là **một quy tắc của chính bộ quy tắc này** — đúng chỗ (f) đã cảnh báo là đắt nhất: *"một chẩn đoán
đang được nâng lên thành quy tắc là chỗ đắt nhất cho một khẳng định phổ quát sai, vì mọi thứ phía sau sẽ
được viết dựa trên nó."*

🔴 **(h3) ĐI THEO MỘT THẤT BẠI TỚI NƠI NÓ ĐƯỢC BÁO CÁO — THƯỜNG KHÔNG PHẢI NƠI NÓ ĐƯỢC NÉM RA (K-1).**

(h) và (h2) nói về **một khẳng định từng đúng mà cái nó chỉ tới đã dịch đi**. Đây là nửa còn thiếu:
**một thông điệp VỐN KHÔNG VỚI TỚI ĐƯỢC và giờ đã sống.** Khẳng định ấy **chưa từng có cái để mà mục
ruỗng** — nó chưa bao giờ sai, vì chưa bao giờ có điều kiện nào chạy tới nó.

**Ca sinh ra nó.** Một bản sửa **ĐÚNG** — cho phép chụp trạng thái **ném lỗi** khi bị ACL từ chối, thay vì
trả về "thư mục không tồn tại" — đã biến một nhánh **chết** thành một nhánh **có người sinh ra nó**, và
định tuyến nó vào một thông điệp khuyên người đọc *"sửa lại phép suy ra"*. Phép suy ra **không hỏng**. Trước
bản sửa ấy, nhánh ACL-bị-từ-chối **không sinh ra ngoại lệ nào**, nên câu khuyên kia **chưa bao giờ với tới
được** và **chưa bao giờ sai**.

Chạy (h) lên ca này thì nó trả lời **"vẫn đúng"** — và trả lời đúng. Hàng xóm gần nhất là (f), nhưng **(f)
giả định điểm nhìn của tác giả VỐN ĐÃ SAI**, còn ở đây điểm nhìn **đúng và thế giới dịch chuyển**. Nó là
**logic thời gian của (h) áp lên câu hỏi độ phủ của (f)** — cả hai bố mẹ đều có sẵn trong file này, đứa con
thì chưa. Vì thế nó **sửa vào (h)**, không đẻ thêm một chữ cái: tính đúng đắn của một thông điệp **là một
khẳng định chỉ mục theo trạng thái cây mã**, mà (h) đã được mở rộng đúng sang nghĩa ấy một lần rồi — và
thêm một ordinal vào đúng cái file mà nhánh này đã **hai lần** ghi nhận ordinal của nó mục ruỗng thì là tự
chuốc lấy lớp lỗi ấy.

**Điều làm nó dùng được, và nó rất hẹp:** nửa bash của cùng bản sửa ấy sinh ra **ba** thất bại mới và viết
**ba** thông điệp cho chúng **trong cùng một hàm** — không cần quy tắc nào. Nửa C# sinh ra một thất bại
**trong một phương thức** rồi báo cáo nó **từ một kiểu khác**, và **đó chính là chỗ nó gãy**.

→ **Quy tắc: một thay đổi làm đổi TẬP CÁC THẤT BẠI CÓ THỂ XẢY RA thì phải quét mọi thông điệp mà các thất
bại ấy GIỜ chạy tới — và phép quét đi theo đường BÁO CÁO, không đi theo đường ném.**

🔴 **(h4) KHI SỬA MỘT TRONG HAI CHỖ ĐỐI XỨNG, DIFF PHẢI NÊU TÊN CHỖ KIA VÀ NÓI RÕ NÓ ĐƯỢC XỬ THẾ NÀO (K-1).**

**Đây là hình mẫu, còn (h3) chỉ là thể hiện sắc nhất của nó.** Ba vòng cuối của K-1, khiếm khuyết đều là
**đối xứng — sửa một bên, để nguyên hoặc làm xấu bên kia**: hai đường "gốc không đọc được"; hai thông điệp
của cùng một chốt; và hai nhánh của một dấu hiệu phân biệt, nơi một nhánh được **hạ nhãn** xuống *"không
quyết định được"* trong khi nhánh kia **được gắn thêm chữ "QUYẾT ĐỊNH ĐƯỢC"** — **trong cùng một khối văn
bản mà chủ đề của nó chính là hình dạng ấy**.

🔴 **Và chính người thực thi, khi gọi tên hình mẫu là "đối xứng", lại đề xuất một quy tắc chỉ phủ MỘT ca —
ca sắc nhất, ca duy nhất có thay đổi về tính-với-tới-được.** Khái quát hoá **từ thể hiện sắc nhất thay vì
từ hình mẫu vừa đặt tên**: đó là §8.1(a) vận hành **lùi ra một tầng, trong lúc viết một quy tắc**. Nên có
**hai** quy tắc, không phải một.

→ **Quy tắc: nêu tên chỗ đối xứng và phát biểu cách xử của nó — ĐÃ SỬA, CỐ Ý KHÔNG SỬA, hoặc KHÔNG ÁP DỤNG.
IM LẶNG KHÔNG PHẢI MỘT CÁCH XỬ.** Ưu điểm riêng của nó là **kiểm được CHỈ BẰNG DIFF**, không cần chạy gì —
và **mọi khiếm khuyết muộn của K-1 đều sẽ vấp phải nó**.

🔴 **(h5) BỐN BẢN SỬA LUẬT TỪ J-2 — và bằng chứng cho chúng là chính J-2, không phải lập luận trong J-2.**

J-2 đổi **mười dòng chạy được**, đúng ngay từ commit đầu, không đổi qua **ba** lượt kiểm chứng độc lập. Cùng
lúc đó nó sinh ra **SÁU câu sai qua bốn vòng — tất cả nằm trong lời biện minh, không câu nào nằm trong
logic**. Đó là §8.1(b) tự ứng nghiệm ở mật độ cao nhất từng ghi được. Và **hai hình dạng tái phát NGAY BÊN
TRONG các bản sửa viết ra cho chính chúng**: *"sửa một trong hai chỗ đối xứng"* và *"một con số vô hướng
tóm tắt một tập không đồng nhất"* — **ca thứ tư và thứ năm liên tiếp của mỗi loại, SAU khi đã được đặt tên**.
Đó là bằng chứng mạnh hơn mọi lập luận cho (h4) và cho việc **liệt kê thay vì đếm**.

**(h5.1) Một con số đối chứng là tính chất của bộ ba (ĐỘT BIẾN, BỘ TEST, SHA CÂY MÃ).** Luật ở J-1b nói cặp
*(đột biến, bộ test)* — vẫn thiếu một chiều. **Ghi con số luôn luôn; ghi TẬP TÊN các bài bị giết mỗi khi con
số dịch** — thứ còn nợ là **HIỆU CỦA HAI TẬP, THEO CẢ HAI CHIỀU**, vì một đối chứng **giết THÊM** cũng chẩn
đoán được y như một đối chứng giết ít đi; ghi tên **vô điều kiện** cho đối chứng dương, vì mỗi phiên chỉ có
một. 🔴 **Và một con số đối chứng DỊCH ĐI là MỘT PHÁT HIỆN PHẢI GIẢI THÍCH, không bao giờ là một con số để
lặng lẽ cập nhật** — nếu không, bản sửa luật này sẽ bị dùng **ngược**.

**Ca sinh ra nó, và nó là ca đẹp nhất của cả loạt:** đối chứng giết **91** ở cây cha, **85** ở cây con. Sáu
bài thôi chết là **năm bài Estop/tháo dỡ cộng `GetDriverHealth`** — vì đột biến đối chứng **chế ra trạng thái
kẹt ở MỌI lần `Start()`**, nên ở cây cha mọi lệnh dừng đều từ chối và mọi bài khẳng định *"sau khi dừng thì
slot biến mất"* đều đỏ; ở cây con **chính những bài ấy qua được DƯỚI đột biến**, vì phần tháo dỡ giờ chạy
thật. **Dụng cụ tụt xuống vì MÃ TỐT LÊN, không phải vì độ phủ mất đi.** Chiều, độ lớn và thành phần đều khớp
— và đối chứng ấy được chọn để **hiệu chuẩn một dụng cụ**, không phải để dò bản sửa này, nên **một con số
sinh ra cho mục đích khác rơi trúng kết luận rút ra bằng cách đọc thì mạnh hơn cả hai thứ đứng riêng**.
J-1b ghi "91" **mà không ghi tên**, nên **cách duy nhất giải thích được 85 là chạy lại cả hai cây**.

**(h5.2) Miền của lượt ĐỌC LẠI KHI ĐÓNG là SỰ PHỤ THUỘC, không phải sự GẦN GŨI.** *Đọc lại mọi câu mà giá
trị đúng-sai của nó có thể bị thay đổi bởi thay đổi của anh.* 🔴 **"Vùng lân cận" là một luật hình-ví-dụ —
tức §8.1(a) lùi ra một tầng** — vì **sự gần gũi không có bán kính**. Và chính file này đã mang sẵn phản ví
dụ: bản đính chính *"viết ở chỗ này, còn bản sao cách đó 200 dòng thì không"*. Giữ "gần" làm **lượt quét rẻ
đầu tiên, không bao giờ làm định nghĩa**. Ca sinh ra nó: cả năm khẳng định người thực thi tự bắt được đều nằm
**trong các hunk họ viết**; câu duy nhất họ bỏ sót — **và là câu mà cả nhiệm vụ xoay quanh** — nằm trong một
đoạn họ **sửa vòng quanh**, đổi tiêu đề mà không đụng thân. Phản biện nói đây là bản sửa **giá trị nhất trong
bốn**, vì **sáu thể hiện mà nó bắt được nằm ngay trên chính thay đổi đã đề xuất ra nó**.

**(h5.3) Một LẬP LUẬN THAY THẾ thừa kế nghĩa vụ của lập luận bị bác, và phải được CHẠY ĐỐI CHIẾU với chính
cái ca đã bác lập luận trước.** Khác (h)/(h2): **không có khẳng định thừa kế, không có cây mã cũ** — người
thực thi **tự phát minh một lời biện minh mới trong lúc sửa một phép quét sai, rồi không bao giờ chạy nó với
cái ca mà nó được viết ra để phục vụ**. *"Chịu cùng mức soi xét"* **không phải một quy trình**; dạng trên thì
**kiểm được chỉ bằng diff**. Bằng chứng giờ mạnh hơn ca của chính tác giả: **câu sai thứ năm của J-2 là một
ca thứ hai của đúng luật này**.

**(h5.4) Bản sửa cho (h3): phép quét định nghĩa trên NHỮNG BỀ MẶT ĐỌC TRẠNG THÁI ĐÃ THAY ĐỔI, không phải trên
các chỗ GHI LOG.** (h3) viết *"đi theo một thất bại tới nơi nó ĐƯỢC BÁO CÁO"* và **không nói gì về nơi nó
THÔI ĐƯỢC BÁO CÁO** — phép quét đã chạy một chiều **hai lần**, và cả hai lần phản biện phải cấp nửa còn lại.
🔴 **Nhưng nửa quan trọng hơn là nửa kia:** phát hiện nặng nhất của J-2 — `_slots` có một người đọc thứ hai
**không kiểm cờ nào**, để lại một driver **ghi được** phân giải ra được **sau khi đã dừng khẩn** — **không
phải một thông điệp gì cả. Nó là một QUYẾT ĐỊNH.** Không phép quét nào trên các chỗ ghi log, chạy theo chiều
nào, chạy hoàn hảo đến đâu, với tới được nó. Bộ đầy đủ đã được dựng trên **những bề mặt CÓ IN RA**, còn chỗ
này **không in gì**.

🔴 **VÀ MỘT TÁC DỤNG PHỤ KHÔNG DỤNG CỤ NÀO Ở ĐÂY THẤY ĐƯỢC, ghi ra vì nó là một LỚP chứ không phải một ca.**
J-2 làm cho `Stop()` trong trạng thái kẹt **thật sự có tác dụng**, nên nó **trông như một lần khôi phục trọn
vẹn** — và bước leo thang sang `Estop()` mà người vận hành từng buộc phải làm **giờ không còn xảy ra**, trong
khi đúng bước ấy mới là thứ đóng lại khoảng OEE đang mở. **Sửa cho một đường khôi phục hỏng chạy được đã xoá
mất cái TRIỆU CHỨNG vốn thúc người ta làm HÀNH ĐỘNG tình cờ vá được dòng thời gian.** Không test nào bắt,
không cổng nào thấy. Câu hỏi duy nhất lôi nó ra: **"sau bản sửa này, người vận hành sẽ THÔI LÀM gì?"**

🔴 **(h6) MỘT PHÁN QUYẾT CHỈ LÀ BẰNG CHỨNG VỀ NHỮNG TÍNH CHẤT MÀ CÁC KHẲNG ĐỊNH CỦA NÓ ĐƯỢC ĐÁNH CHỈ MỤC LÊN
— VÀ MỘT LẦN XANH TRÊN MỘT CÂY MÃ ĐANG MANG MỘT KHIẾM KHUYẾT ĐÃ BIẾT ĐO ĐƯỢC *NHỮNG TÍNH CHẤT ẤY LÀ GÌ* (L-1).**

Cả bộ quy tắc này nói về **các khẳng định của con người**. Mục này nói về **khẳng định của chính cái cổng** —
và nó cần thiết vì L-1 là nhiệm vụ duy nhất **được phán xử bằng chính dụng cụ nó đang sửa**.

**Ca sinh ra nó, và nó là một ĐỐI CHỨNG ÂM KHÔNG AI DÀN DỰNG.** Lần chạy 1 và 2 xanh **với một lớp test còn
nằm NGOÀI** collection — đúng cái khiếm khuyết khiến phản biện **bác cả nhiệm vụ**. Lần chạy 3 xanh **với nó
đã vào TRONG**. Cổng trả về **phán quyết y hệt ở cả hai phía**. Nó **không yếu đi, không mạnh lên, KHÔNG NHẬN
RA**. Và nó **không hỏng** — không có gì được đánh chỉ mục ở đó cả.

**Vì sao nó mạnh hơn một đột biến:** một đột biến là khiếm khuyết **ta cấy vào**, nên nó chỉ trả lời câu hỏi
ta đã nghĩ ra. Cái này **không ai cấy** — nó là một khiếm khuyết thật, do một phản biện tìm ra, đã tồn tại
trên cây mã trong hai lần chạy xanh trước khi bất cứ ai biết. **Một đối chứng âm không dàn dựng, trên chính
cái cổng của dự án.**

→ **Cách phát biểu, và giữ nguyên văn vì nó đã được cân:** *"nó không yếu đi, không mạnh lên, không nhận ra"*.
🔴 **ĐỪNG viết thành "cổng bị mù" hay "cổng hỏng"** — hai chữ ấy mời người đọc kết luận cổng **thất bại**, mà
nó không thất bại; **không có gì được đánh chỉ mục ở đó**. Sự khác biệt ấy quyết định người ta đi sửa cái gì.

🔴 **HAI CÁI CHẶN, BẮT BUỘC — thiếu chúng thì quy tắc này thành MỘT DUNG MÔI VẠN NĂNG để hạ giá bất kỳ lần
chạy xanh nào gây bất tiện:**
1. **Phải có một khiếm khuyết ĐÃ BIẾT hiện diện ở MỘT phía.** Không có nó thì đây chỉ là hai lần chạy xanh,
   và hai lần chạy xanh **không đo được gì cả**.
2. **Hai phía phải khác nhau KHÔNG QUÁ cái thay đổi đang xét.** Ở L-1 điều đó đúng — phần còn lại là
   chỉ-sửa-chú-thích, đã đo — **và phải NÓI RA, đừng bắt người đọc tự đi kiểm.**

**Hệ quả trực tiếp cho mọi nhiệm vụ sửa chính cái cổng:** một lần chạy xanh **theo định nghĩa là lần chạy mà
phép kiểm ta vừa sửa KHÔNG kích hoạt**. Bằng chứng cho một phép kiểm **luôn nằm ở chỗ khác** — ở những lần
chạy **ĐỎ**, dựng có chủ đích, chạy **qua đúng nhánh sản xuất**. Ở L-1 đó là hai lần chạy đầu-cuối trên một
quần thể **không thể cạn**, cộng bảy chuỗi tổng hợp, cộng việc phản biện **tự dựng lại cả bảy từ khối mã đã
ship** thay vì tin bảng số trong báo cáo.

**Và một mặt trái đã đo được, ghi ra vì nó là cái giá của quy tắc:** ở L-1 phép kiểm kê thành viên **sai hai
lần, cùng một kiểu** — lần đầu trong brief của người điều phối (đếm kẻ **gây nhiễu**, trong khi chỗ hở là các
kẻ **quan sát**), lần sau trong bản sửa cho chính nó (bám vào một câu lệnh `using`, sót đúng một lớp trên 45).
**Không lần nào cổng thấy, và không lần nào đột biến với tới được** — thiếu một `[Collection]` đổi **lịch
chạy, không đổi hành vi**. Khi một tính chất **không dụng cụ nào trong repo quan sát được**, thứ duy nhất còn
lại là **một phép liệt kê được nói ra kèm dụng cụ của nó** — và bằng chứng cho tính đầy đủ của nó là **CHỖ BẤT
ĐỒNG giữa các dụng cụ độc lập, không phải chỗ chúng đồng thuận**: hai bộ đối sánh hẹp sót hai thứ khác nhau và
lệch nhau một đơn vị **theo cả hai chiều**, nên **không cái nào tạo ra được chỗ sót của cái kia**. Ngay cả thế
**vẫn chưa phải chứng minh**, vì bộ rộng nhất **định nghĩa** con số — nên phép kiểm cuối phải đến **từ ngoài
phương pháp**: ở L-1 là một phép dò **ngược**, quét mọi lớp chưa được gom tìm bất cứ thứ gì với tới một chỗ mở
kết nối, **rỗng, với một đối chứng dương còn sống**.

**Và một đính chính về chính bộ công cụ này, do D-3 tìm ra.** Brief D-3 của tôi yêu cầu test phụ thuộc phần cứng phải *"bỏ qua sạch sẽ và ồn ào"*, trong khi `verify-suites.sh` — cũng của tôi — **fail khi `skipped != 0`**. Hai chỉ thị loại trừ nhau, và **cái phải đổi là brief, không phải script**: xUnit đếm test bị bỏ qua động vào `Total`, nên một bộ test phụ thuộc phần cứng làm `Skipped` **phụ thuộc môi trường** — và bất kỳ con số kỳ vọng cố định nào cũng sẽ làm **máy trang bị tốt hơn** bị đỏ. Đó là cái bẫy "một con số xanh mang nghĩa khác nhau trên các máy khác nhau", mặc áo phần cứng. **`skipped == 0` chính là thứ làm cho "817" mang cùng một nghĩa ở mọi nơi.**

→ Quy tắc đúng: **hành vi phụ thuộc phần cứng không bao giờ là một test bị bỏ qua có điều kiện bên trong năm bộ test.** Nó hoặc được **ghi rõ là khoảng trống chưa test** trong báo cáo và trong chú thích của cổng, hoặc được commit thành **một bench harness riêng nằm ngoài năm bộ** (`tools/serial-bench/`). Phép đo không commit được thì không tái lập được — reviewer D-3 phải **viết lại toàn bộ probe** để kiểm chứng các con số của D-3.

Công cụ bắt buộc từ D-3: `scripts/mutate-guard.sh` (so dấu thời gian + đối chứng dương **mỗi phiên**, và từ J-1b là **mỗi (đột biến, BỘ TEST)** — xem ngay dưới). Lý do đầy đủ nằm trong header của nó.

🔴 **HẠNG MỤC MANG THEO, thêm ở J-1b và CÓ PHẠM VI RỘNG HƠN nhiệm vụ sinh ra nó — ĐỐI CHỨNG DƯƠNG GHÉP THEO (ĐỘT BIẾN, BỘ TEST), KHÔNG PHẢI THEO PHIÊN.** Câu *"đối chứng dương **mỗi phiên**"* ở trên là **chưa đủ**: đối chứng chứng thực **MỘT DỤNG CỤ ĐO**, và mỗi project test là một dụng cụ riêng — nên một phiên "tin được" vẫn chứa được một phán quyết không tin được khi đối chứng chạy ở bộ này còn SURVIVED được đọc từ bộ khác. **Đo, J-1b:** đối chứng (`_running = true → false` trong `FleetCore.StartLocked` — khiến **mọi** `Start()` báo đội máy dừng) **KILLED 91** trên `St4i.EngineApi.Tests`; một đột biến **trong đúng hàm đó, đúng file đó** — cái chốt HALT nằm trên phép gán ấy vài dòng, *không phải* chính phép gán *(🔴 chỗ này viết **"đúng dòng đó"** ở bản đầu, sai, và **thứ bắt được nó là lượt ĐỌC LẠI KHI ĐÓNG mà chính vòng này vừa ghi vào (h2), chạy trên đúng cái diff đã đẻ ra quy tắc ấy**)* — đọc từ `St4i.EdgeCore.Tests` báo *"SURVIVED 1093/1093"*; chạy lại **chính đối chứng ấy** trên `St4i.EdgeCore.Tests` thì nó **cũng SỐNG SÓT, 1093/1093, trên binary tươi**. **CHÍNH BỘ TEST ẤY — `St4i.EdgeCore.Tests`, cả 1093 bài — không phát hiện nổi một đột biến làm mọi `Start()` báo đội máy dừng** *(🔴 phản biện toàn nhánh, Minor 8: câu này từng viết *"một bộ 1093 test"*, làm nó đọc thành khẳng định về **KÍCH CỠ** trong khi sự thật đo được là về **ĐỘ PHỦ** — 1093 không làm việc gì trong lập luận cả, đúng hình dạng §8.1(a3). Phản biện còn kiểm độc lập cơ chế: bộ ấy có **KHÔNG một tham chiếu sống nào** tới `FleetCore`/`FleetHost`, mọi kết quả grep đều là chú thích)* — và **1093 xanh** là bộ đồ nguỵ trang rất thuyết phục cho một **kết quả rỗng**. Cái bẫy này là **mặc định chứ không phải hi hữu**: với một file nằm dưới `src/St4i.EdgeCore`, bộ **SAI** lại chính là bộ **hiển nhiên**.

→ **Quy tắc: chạy đối chứng dương trên ĐÚNG bộ test mà anh sẽ đọc phán quyết từ đó; đọc một đột biến từ hai bộ thì cần hai đối chứng. Đối chứng sống sót ở bộ nào thì mọi phán quyết SURVIVED đọc từ bộ ấy là KHÔNG CÓ PHÁN QUYẾT, và chỉ với đoạn mã đối chứng ấy chạm tới — phải báo là "dụng cụ này không nhìn thấy đoạn mã này", tuyệt đối không báo là "đoạn mã này không được test" hay "cái chốt này không có nhân chứng".**

🔴 **Hai đính chính của phản biện toàn nhánh, và cái thứ hai nặng hơn:**
- **(Important 2)** Câu trên từng viết *"**mọi** phán quyết từ bộ ấy là KHÔNG CÓ PHÁN QUYẾT"*. **Sai hai đường:** một phán quyết **KILLED tự chứng thực** — có bài đỏ nghĩa là dụng cụ **đã** dựng, **đã** phát hiện và **đã** chạy đúng đoạn mã đột biến, tức đúng cái mà một đối chứng sinh ra để chứng minh; và phạm vi vô hiệu hoá chỉ tới **đoạn mã đối chứng chạm vào**, đúng như vế sau của chính câu ấy (*"không nhìn thấy ĐOẠN MÃ NÀY"*) đã tự thừa nhận. Áp nguyên văn thì nó **xoá sổ chính C0, M1′′ và M13 của J-1b** — tức bằng chứng rằng chốt HALT có nhân chứng.
- **(Important 3)** Câu chốt từng là *"dụng cụ vốn đã đúng; thứ còn thiếu là quy tắc"*. **Sai, và sai theo hướng bảo người ta thôi kiểm:** `control` **không nhận đối số bộ test** và file trạng thái **khoá theo cây mã**, nên `check` vẫn in *"positive control on record — SURVIVED is meaningful"* cho một SURVIVED đọc từ **bộ khác** với bộ đối chứng đã chạy — **đúng cái thất bại J-1b vừa vấp, được chính dụng cụ chúc phúc**. **Đã sửa Ở DỤNG CỤ, không sửa ở văn xuôi:** `control` và `check` nay **BẮT BUỘC** kèm tên bộ test, trạng thái khoá theo **(cây mã, bộ test)**, và `check` cho một bộ chưa có đối chứng riêng thì **từ chối** và liệt kê những bộ đang có. Đường mới đã được **chạy thử thật**, không chỉ `bash -n`.

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

## 11. 🔴 Hạng mục mang theo, ghi ở đây vì nó chạm MỌI đợt — cổng đếm build node có vẻ ĐUA (K-1)

Ghi ở đây, không phải chỉ trong `scripts/verify-suites.sh`, vì **một khiếm khuyết ở cấp CỔNG mà chỉ người
đọc đúng một file gặp được thì không phải một bản ghi nguồn** — cùng lý do §10 tồn tại. Mọi đợt đều đi qua
cổng này; K-1 chỉ tình cờ là đợt đầu tiên bị nó bắn ba lần.

**Đo được, K-1:** `dotnet build-server shutdown` (`verify-suites.sh`, ngay trước phần test) **PHÁT tín hiệu**
tháo dỡ, rồi phép đếm chạy ngay sau đó **không chờ, không poll, không thử lại**. Nó bắn **ba lần**, **luôn
luôn** với đúng cái population mà chính script vừa tạo ra bằng lần rebuild của nó, và **mỗi lần đều sạch khi
chạy lại mà KHÔNG đổi một dòng mã nào**. Đó chính là dấu hiệu: **một population sót lại thật thì không tự
biến mất khi chạy lại; một cuộc đua lúc tháo dỡ thì có.**

Hai thứ làm nó nặng thêm, và cả hai đã nằm sẵn trong file:
- luật đếm cả tiến trình có `CommandLine` **null** (thêm có chủ đích, để không bao giờ bỏ sót) — mà **một
  tiến trình ĐANG tháo dỡ chính là lúc `CommandLine` trở nên không đọc được**, nên một bản sửa trước đó
  **nuôi** đúng lần bắn này;
- `MSBUILDDISABLENODEREUSE` **không** chi phối `VBCSCompiler`, tức đúng thứ mà `shutdown` phải chạy đua.

**🔴 Vì sao K-1 KHÔNG sửa — và lý do đầu tiên tôi viết ra là SAI, ghi lại vì một lý do sai gắn vào một quyết
định hoãn chính là cách quyết định ấy bị lật.** Câu cũ: *"cổng này sinh ra phán quyết của chính K-1; đừng
sửa dụng cụ mà phán quyết của mình phụ thuộc vào."* Câu ấy **không thể là luật**: K-1 sửa chính file đó rất
nhiều, kể cả cái bracket mà phán quyết của nó giờ cũng phụ thuộc vào. Lý do **đúng** hẹp hơn và nói về
**động cơ**: bản sửa **NỚI một phép khẳng định** — "0 ngay bây giờ" thành "0 trong vòng N" — trên bằng
chứng **cũng khớp y hệt với một population sót lại đang tháo dần**. Nới một ngưỡng, trên bằng chứng nhập
nhằng, **bên trong chính vòng mà ngưỡng ấy đang phán xử**, là vị trí tệ nhất để ra quyết định đó. Không
phải "tác giả không được chạm dụng cụ" — mà **riêng thay đổi này không phán xử được từ đây**. Thêm một phép
kiểm, siết một phép kiểm, hay sửa một phép kiểm đang rỗng thì **không** mang rủi ro ấy.

**Thuốc chữa đã có sẵn trong từ vựng của chính script:** một phép **poll có biên**, hình dạng giống luật
"mấy lần liên tiếp" của bộ dò CPU-phẳng — và nó còn **phân biệt được một cuộc đua với một lần sót thật**,
vì một population thật thì đứng yên qua nhiều mẫu còn một lần tháo dỡ thì rút dần.

**Chiều đi hiện tại đã đúng:** K-1 **SIẾT** tư thế node-reuse (export ở đầu script, nên cả năm lần
`dotnet test` cũng nhận) chứ không nới phép kiểm. Điều đó có thể tự làm population nhỏ lại và khiến cuộc đua
ngừng bắn mà không ai phải nới gì cả — hãy đo lại trước khi xây thuốc chữa.

### 🔴 11.1 ĐÃ ĐÓNG ở L-1 — và điều đáng ghi là **khoản nợ được trả bằng cách nào**

`verify-suites.sh` giờ **lấy mẫu tới khi ỔN ĐỊNH** rồi mới phán quyết, thay vì lấy một mẫu duy nhất ngay sau
tín hiệu tháo dỡ. Điểm chịu lực **không phải** là "chờ lâu hơn":

- **TẬP GIÁ TRỊ ĐƯỢC CHẤP NHẬN KHÔNG ĐỔI.** Phán quyết vẫn là `settled == 0`. Không có ngưỡng nào được nới,
  không có số nào lớn hơn 0 được tha ở bất kỳ hạn nào. Thứ dịch đi là **KHOẢNH KHẮC ĐƯỢC ĐO**, và chỉ thế.
- **Một quần thể KHÔNG cạn vẫn ĐỎ, và đỏ KHÔNG MUỘN HƠN một quần thể đang cạn** — vì đứng yên *chính là* ổn
  định: nó chốt ở giá trị khác 0 ngay ở mẫu thứ ba, tức **mức sàn** của mọi lần chốt, và hỏng ở đó.
  *(🔴 Câu này từng viết **"đỏ SỚM HƠN"** — quá mạnh, vì một quần thể vốn đã bằng 0 cũng chốt sau đúng ba mẫu.
  Lượt đọc-lại-cuối của L-1 đã sửa đúng câu ấy ở `verify-suites.sh` và **KHÔNG đi theo nó sang đây, trong
  chính cái diff đã viết ra cả hai** — §8.1(h5.2) đúng nghĩa: miền của lượt đọc lại là **SỰ PHỤ THUỘC**, mà
  hai bản sao của một khẳng định là quan hệ phụ thuộc gần nhất có thể. Phản biện bắt.)*
- **KHÔNG BAO GIỜ ỔN ĐỊNH là một màu ĐỎ RIÊNG.** Một con số cứ nhúc nhích suốt biên không được coi là "vẫn
  đang cạn"; nó hỏng với thông điệp của chính nó. Hình dạng là *"lấy mẫu tới khi ổn định, và HỎNG nếu không
  bao giờ ổn định"*, không phải *"bằng không trong vòng N"*.
- Một mẫu **không đọc được** không bao giờ được tính là ổn định — mượn nguyên luật của bộ dò CPU-phẳng
  (*rỗng nghĩa là "không biết", không bao giờ là "phẳng"*).

**Bằng chứng là phép ĐO, không phải lập luận** (chi tiết trong `.superpowers/sdd/gate-determinism/task-1-report.md`):
cấy một tiến trình khớp bộ đếm và **không** chết theo `dotnet build-server shutdown`, rồi chạy cổng thật →
cổng **ĐỎ**, `exit 1`, chuỗi mẫu `1 1 1`. Cấy 100 tiến trình → chuỗi `74 87 100 100 100`, **ĐỎ** ở 100. Tức
là cùng một dụng cụ **phân biệt được** một lần tháo dỡ đang rút với một quần thể sót thật — đúng thứ mà một
mẫu đơn không làm được.

**Chỗ đối xứng, nêu tên theo §8.1(h4):** `dotnet build-server shutdown` được gọi **HAI lần** trong script.
Lần ở `[1/3]` (trước rebuild) **CỐ Ý KHÔNG poll**: không phán quyết nào đọc từ nó, nên ở đó không có khoảnh
khắc nào để đo sai; thứ nó phục vụ được khẳng định bằng chính các cổng của bản build (0 lỗi, và chốt MSB3061
bắt đúng ca "một tiến trình sống đang giữ output của ta").

**Giới hạn phải nói thẳng:** phép kiểm vẫn là một phép đo tại **một khoảnh khắc** — khoảnh khắc nó ổn định.
Một tiến trình build server xuất hiện **sau** lúc ấy thì nó không thấy, y hệt cái lỗ "hiện-rồi-biến-mất" mà
§12 nêu cho chốt creds. Đã đo: một máy có thứ gì đó sinh/diệt build server theo chu kỳ có thể ổn định ở 0
trong một cửa sổ rồi lại có tiến trình sau đó. Đóng chuyện ấy cần một **watcher**, và đây không phải watcher.

## 12. 🔴 Hạng mục mang theo (K-1) — GHI ĐÈ TẠI CHỖ: không dụng cụ nào của K-1 nhìn thấy

Tách **riêng** khỏi lỗ "hiện-rồi-biến-mất" ở §11 và khỏi nửa ĐUA, có chủ đích: gộp chung sẽ khiến hạng mục
này **thừa hưởng độ khó của hàng xóm**, mà nó thì **không cần một watcher** — hai cái kia thì có.

**Lỗ.** Cả hai dụng cụ của K-1 so **TẬP TÊN**: `comm -13`/`comm -23` phía cổng, `Except` phía tiến trình.
Một lần **ghi đè tại chỗ** lên một tên **đã có sẵn** không đổi tập tên, nên **cả hai đều im lặng**. Tác hại
đúng bằng thứ K-1 sinh ra để chặn — một lần niêm phong lại đè lên một trong **mười một** blob được cố ý giữ
sẽ **phá bằng chứng mà không dụng cụ nào nói một tiếng nào** — và nó **tệ hơn** lỗ hiện-rồi-biến-mất ở chỗ
lỗ kia ít nhất đòi ai đó **chủ động xoá một file đã được nêu tên**.

**Vì sao KHÔNG đóng trong K-1** (lý lẽ của phản biện, tôi nhận):
1. **Chưa từng có một ca đo được nào.** Bản kiểm kê quy **2.996 trên 3.007** blob về những tiền tố
   **duy-nhất-mỗi-lần-chạy** (`SIM-E2E-<unix-ms>`, `SF-RESTART-<8 hex>`, `REDIRECT-…`), và **cả hai** rò rỉ
   đã biết đều rơi vào **thêm mới**. Lỗ là thật, rủi ro hiện thời là lý thuyết — **ngược** với lỗ
   hiện-rồi-biến-mất, nơi *cách lách* (xoá đúng file vừa bị nêu tên) chính là thứ một người đang chịu áp lực
   sẽ với tay tới.
2. **Đóng cho đúng nghĩa là tái cấu trúc phép khẳng định LẦN THỨ BA trong một nhánh.** Nhánh này đã trả giá
   đàng hoàng để chứng minh lại rằng phép khẳng định còn hỏng được sau lần tái cấu trúc thứ nhất (M4). Lần
   thứ ba cần vòng đột biến riêng của nó, và làm việc đó **bên trong cửa sổ merge** chính là kiểu "một vòng
   sửa đúng cái dụng cụ sinh ra phán quyết của chính nó" mà §11 vừa mới nói đúng.

**🔴 DỤNG CỤ ĐÃ ĐƯỢC CHỌN SẴN, ghi ở đây để nhiệm vụ sau KHÔNG phải tranh luận lại thiết kế:** bộ ba
**tên + `Length` + `LastWriteTimeUtc`**, ở **cả hai** tầng. Vẫn **đọc 0 byte**, nên cả tính chất "không bao
giờ mở một file" lẫn ràng buộc bí mật đều **còn nguyên**; và nó **ghép thêm** vào phép so tập tên đang có
chứ **không thay thế** nó. Phía bash là **một chuỗi định dạng `stat`**. Nhiệm vụ ấy phải kèm vòng đột biến
của riêng nó, vì nó đổi hình dạng phép khẳng định.

**Ba việc nhỏ MANG THEO, chưa làm và chưa phân xử** — ghi ra vì tiêu đề "Minors taken" ở báo cáo K-1 liệt kê
ba trên sáu, và một tiêu đề ngụ ý nhiều hơn danh sách của nó là đúng lớp lỗi nhánh này trả giá nhiều lần:
- **M-3 — `OrdinalIgnoreCase` (C#) so với `comm` so byte (bash).** Một lần đổi tên **chỉ khác hoa/thường**
  làm hai dụng cụ **bất đồng**: phía cổng thấy một cặp thêm/bớt, phía tiến trình không thấy gì. Đây là một
  **bất đồng giữa hai dụng cụ**, không phải một lỗ của cặp.
- **M-5 — `_creds_src` là đường dẫn TƯƠNG ĐỐI.** Chạy script từ sai thư mục làm phép dò dẫn xuất hỏng
  **trước**, và thất bại đó **nêu sai thuốc chữa** (nó nói "sửa phép dò", còn nguyên nhân là cwd).
- **M-6 — "năm artifact" là một con số CHƯA ĐO**, ở ba chỗ trong mã (`verify-suites.sh`,
  `RealCredentialStoreLeakGuard.cs` ×2). Đúng cái lớp mà K-1 vừa dành hai vòng để sửa (`633`), còn sót lại
  trong chính văn bản của K-1.
- **N-4 (tin cậy thấp, chưa tái lập) — `ls -1a "$parent" | grep -qxF` dưới `set -o pipefail`.** `grep -q`
  thoát ngay khi khớp; nếu `ls` còn đang ghi thì nó ăn SIGPIPE và `pipefail` biến pipeline thành khác 0, tức
  đọc thành "không tìm thấy" rồi rơi xuống nhánh "vắng mặt thật → return 0" — **một lần xanh im lặng trong
  đúng hàm sinh ra để từ chối điều đó**. Không với tới được trên máy này (`C:\ProgramData` nhỏ hơn bộ đệm
  pipe rất nhiều, và nhánh `[[ -e ]]` chặn trước ở ca thường). Thuốc chữa một dòng:
  `grep -qxF … <<< "$(ls -1a "$parent")"`.
