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
- `Transport.Retries = 0` và `ct.Register(DisposeConnection)` của Đợt B **dùng lại nguyên vẹn** — chúng nằm trên `IModbusTransport`/`IStreamResource`, không phải trên socket.

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

**Giới hạn:** chỉ D-3 được phụ thuộc vào nó. Tầng đóng khung RTU và transport TCP-gateway **phải biên dịch được mà không có nó**, để một triển khai dùng gateway không kéo theo phụ thuộc serial.

## 7. Phân rã công việc

| # | Nhiệm vụ | Rủi ro |
|---|---|---|
| **D-1** | 🔴 **Định danh connector: kind-keyed → instance-keyed.** Registry, schema store (có migration), phân giải slot của `FleetHost`, `ResolveWritableDriver`, seeder, endpoint, RBAC. **Land riêng, xanh trước khi có bất kỳ code RTU nào.** | 🔴🔴 Cao nhất đợt — đụng cổng an toàn Đợt B |
| **D-2** | Tầng RTU + seam `IStreamResource` + transport **RTU-over-TCP** (không thêm dep) | |
| **D-3** | Transport **serial nguyên bản** — `System.IO.Ports`, adapter tự viết | |
| **D-4** | Hình dạng map multidrop: một bus, N địa chỉ slave, N mã máy | 🔴 |
| **D-5** | Đường ghi RTU qua hợp đồng Đợt B + cổng an toàn | 🔴 |
| **D-6** | Conformance + loopback harness (cần `IStreamResource` cặp đôi trong bộ nhớ — **không có cổng COM ảo khả chuyển**) | |
| **D-7** | Endpoint/RBAC/cấu hình + UI + census tài liệu | |

**D-1 phải land riêng và xanh trước khi bất kỳ code RTU nào tồn tại** — cùng lý do C-6 phải land hàng đợi riêng từng kênh trước khi viết logic relay: trộn một cuộc tái cấu trúc xương sống với một tính năng mới thì một lỗi sẽ không quy trách nhiệm được.

## 8. Bài học quy trình bắt buộc mang theo

- **Chín test rỗng đã bị bắt trong dự án này. Cả chín đều bằng đột biến, không lần nào bằng đọc.** Hai trong số đó do người vừa đọc xong báo cáo về đúng kiểu lỗi ấy viết ra.
- **Một tỷ lệ là triệu chứng, không phải chẩn đoán.** Một test bị bốn lượt độc lập gọi là "chập chờn do thời gian" hoá ra là `IOException` tất định 100%.
- **Một bản sửa nhắm sai cơ chế trông giống hệt bản sửa đúng cho tới khi nó chạy.** Tôi vấp điều này hai lần liên tiếp trên chính script kiểm chứng.
- **Không nới ngưỡng để lỗi hiếm đi.** Sửa cơ chế, hoặc nói thẳng là không sửa được.
- `scripts/verify-suites.sh` là cổng. Nó đã **sai bảy lần**, cả bảy do người *dùng* nó tìm ra. Nếu nó báo điều khó tin, **nghi ngờ công cụ ngang với nghi ngờ cây mã**.

## 9. Giới hạn phải nói thẳng khi xong

- ASCII framing không làm (NModbus có, ta không dùng).
- Broadcast (slave 0) — quyết định và nói rõ.
- S7 và EtherNet/IP vẫn không có.
- Nếu multidrop có giới hạn số thiết bị trên một bus, nói con số.
