# Đợt B — Tầng điều khiển máy (SCADA): đường ghi đầu tiên xuống thiết bị

**Ngày:** 29/07/2026 · **Nhánh:** `feat/machine-simulator` · **BASE:** `52a5731f`

## Đây là công việc rủi ro cao nhất của cả dự án

Cho tới hôm nay sản phẩm **quan sát** máy và không bao giờ **ra lệnh** cho máy. Đợt này bỏ ranh giới đó. Từ đây, một lỗi trong sản phẩm có thể **làm thay đổi trạng thái vật lý của thiết bị đang chạy**.

Mọi quyết định thiết kế dưới đây phải đọc dưới ánh sáng đó.

## Quyết định của chủ sản phẩm (đã chốt)

| # | Quyết định | Ghi chú |
|---|---|---|
| 1 | **Setpoint + method call/lệnh** | Rộng hơn mức tôi khuyến nghị. Bao gồm OPC-UA `CallAsync` và xung coil Modbus — tức **kích được chuyển động**, không chỉ đặt giá trị. |
| 2 | **Map khai `writable` là đủ** | Không có công tắc ngắt ở mức triển khai. |
| 3 | **HALT vẫn là chốt phần mềm** | Không cố ghi lệnh dừng. ISO 13849 Cat 3/4 = mạch cứng; phần mềm không bao giờ là đường an toàn. |

### ⚠️ Hệ quả cộng hưởng của (1)+(2) — và cách siết bên trong nó
Ghép lại, **file map trở thành toàn bộ ranh giới an toàn**, và map được dán JSON qua UI. Một map từ vendor hoặc từ mạng, có `writable: true` trên một method khởi động chu trình, sẽ tự trang bị khả năng đó. Không đổi quyết định; siết bên trong:

- Khai báo có-khả-năng-ghi phải **hiện rõ và cần xác nhận có chủ ý lúc lưu** — dùng đúng khuôn echo-back của `POST /v1/site/identity/rotate` (400 nếu thiếu, 409 nếu lệch), đã có sẵn trong repo.
- **Method call gác chặt hơn setpoint** — vai trò RBAC cao hơn. Đặt giá trị ≠ kích chuyển động.
- Mỗi điểm writable **bắt buộc** khai min/max; ghi ngoài dải bị từ chối trước khi chạm thiết bị.

## 🔴 Bất biến không được phá

**HALT không dừng máy, và đợt này không được làm nó dừng máy.** Quyết định #3. Khi đã ghi được, khách sẽ hỏi *"ghi được rồi sao HALT không dừng máy?"* — tài liệu phải **trả lời thẳng** câu đó, không né.

**`EstopGuardRule` phải phủ mọi hành động ghi và lệnh.** Nếu không, HALT đang chốt mà vẫn ra lệnh được cho máy — đúng thứ mà cái chốt sinh ra để chặn. Đây là yêu cầu bắt buộc, không phải tuỳ chọn.

**Không I/O dưới `_gate`.** `FleetHost._gate` là lock mà `Estop()` lấy. Một lệnh ghi giữ lock đó sẽ chặn HALT. Đã có một Critical đúng kiểu này trong lịch sử dự án (dispose driver dưới `_gate` chặn HALT 3 giây).

## Dữ kiện đã khảo sát (không suy đoán)

- **Không có đường nào từ HTTP tới driver đang sống.** `GetDriverHealth()` khoá theo *nhãn slot*, `MachineDetail` không chạm driver, mọi thành viên trả `IDeviceDriver` đều private hoặc test-only. Đường tra cứu này **phải dựng mới**.
- **Mỗi giao thức chỉ một driver sống cho cả fleet.** `ConnectorRegistry` khoá theo `Kind` (last-write-wins); `ConnectorConfigStore` PK là `kind`, không phải máy.
- **NModbus 3.0.83 có đủ hàm ghi** (`WriteSingleCoilAsync`, `WriteSingleRegisterAsync`, `WriteMultipleRegistersAsync`, `WriteMultipleCoilsAsync`) nhưng **không hàm nào nhận `CancellationToken`** — đúng bẫy đã gặp ở đường đọc, đã có cách xử đã chứng minh (`Transport.WriteTimeout` + `ct.Register(DisposeConnection)`, đo được gỡ trong ~2ms).
- **OPC-UA `WriteAsync` và `CallAsync` đều nhận `ct`** — không có bẫy tương ứng.
- **Map hiện thuần đọc.** Không có cờ writable ở đâu; `ModbusRegisterType` còn ghi rõ "writing is out of scope for this driver".
- `IDeviceDriver` **không có** cơ chế apiVersion; assembly hợp đồng chưa publish NuGet, chỉ project-reference.
- Conformance có `AcknowledgedGaps` + `EveryCheckIsWiredOrAcknowledged` — mọi check phải được nối hoặc khai báo bỏ qua.
- **Không có hạ tầng rate-limit/debounce nào trong repo.**
- Tiền lệ cho thao tác nguy hiểm: cert rotation — `Policies.Admin`, echo-back fingerprint, audit cũ→mới, response không thể bỏ sót.

### Khẳng định "không có đường ghi" nằm ở ~15 chỗ, KHÔNG phải sáu

*(Đính chính — bản census đầu tiên của blueprint này ghi "sáu chỗ" và **sai**. Review B-1 quét lại và tìm ra khoảng 15, trong đó có những bề mặt **hiện ra cho người vận hành lúc chạy** mà tôi bỏ sót hoàn toàn. B-8 được định phạm vi theo danh sách này, nên nó phải đúng.)*

**Hiện ra cho người vận hành lúc chạy — nguy hiểm nhất nếu bỏ sót:**
- `src/St4i.EngineApi/Safety/SafetyEndpoints.cs:18` — `XcR40Advisory`, **ship trong body của một API response**
- `src/St4i.EngineApi/Policy/Rules/EstopGuardRule.cs:39` — thông điệp từ chối **hiện cho người vận hành**
- `web/src/i18n/en.ts:1392`, `web/src/i18n/en.ts:2118`, `web/src/lib/api.ts:771` *(và bản `vi.ts` tương ứng — kiểm tra)*

**Trong mã C#:**
- `EstopGuardRule.cs:14-15` · `FleetHost.cs:451/653-654` · `FleetHost.cs:687` · `LineController.cs:53-55`
- `IConnectorFactory.cs:76-77` · `PolicyResults.cs:36` · `SafetySnapshot.cs:6`
- `ModbusRegisterMap.cs:8` — *"writing is out of scope for this driver"*, **thành sai ngay tại B-4**

**README:** ba chỗ — dòng 1471, 1473 (*"read-only by design"*), 3543 — cộng §1 và §12.

Chính công việc trung thực của Đợt A dệt nó thành bất biến kiến trúc. **Đợt này vô hiệu hoá nó ở tất cả các chỗ cùng lúc** và phải sửa đồng bộ — bỏ sót một chỗ là để lại một lời nói dối, và những chỗ tệ nhất là ba dòng đầu vì chúng đi thẳng tới người vận hành.

## Ràng buộc toàn cục

- **Không thêm NuGet/npm.** Không sửa SDK vendored.
- **Additive:** driver bên thứ ba hiện có **không được vỡ**. Khả năng ghi phải là **interface tuỳ chọn**, không phải thành viên mới trên `IDeviceDriver`.
- Route mới phải vào `RbacPolicyTests.ExpectedRoutes` (sweep khớp số chính xác hai chiều).
- Gate mỗi task: `dotnet build` sạch + 5 project test chạy **riêng lẻ và tuần tự** (chạy song song bị treo ở máy này; `St4i.Connector.Conformance` là *thư viện*, abort dưới lượt chạy toàn solution) + `npm run build` exit 0 + Playwright.
- Mốc: **1365 test .NET · 176 Playwright**.
- Flaky đã biết: `WalFlushPumpTests`, `StoreAndForwardRestartSurvivalTests`, `MqttDriverTests`, mTLS trong `DeviceIdentityStoreTests`, `[Trait("Category","RequiresMulticast")]`.

## Các task

### B-1 — Hợp đồng ghi (`IWritableDeviceDriver`)
Interface **tuỳ chọn** để driver read-only không vỡ. Setpoint + lệnh. Ghi rõ trong doc: không bao giờ được gọi dưới `_gate`, phải tôn trọng `ct`, không bao giờ tự ý thử lại.

### B-2 — Đường tra cứu từ mã máy tới driver đang sống
Phần kiến trúc chưa từng tồn tại. Lấy tham chiếu **dưới** `_gate`, nhả lock, **rồi mới** ghi. Phải xử lý được ca driver bị dispose đồng thời.

### B-3 — Lược đồ map: điểm writable + lệnh
Cờ writable, **min/max bắt buộc**, khai báo lệnh + tham số. Xác nhận có chủ ý lúc lưu (echo-back). Di trú `ConnectorConfigStore` hoặc nằm trong `map_json` — quyết định và biện minh.

### B-4 — Modbus write
Dùng lại cách xử không-có-CT đã chứng minh. Kẹp giá trị **trước** khi chạm thiết bị.

### B-5 — OPC-UA write + `CallAsync`
Có `ct` sẵn. Method call là bề mặt rủi ro cao nhất đợt này.

### B-6 — Policy, RBAC, audit
`EstopGuardRule` phủ ghi + lệnh (**bắt buộc**). Lệnh ở vai trò cao hơn setpoint. Audit cũ→mới mọi lần ghi. Cân nhắc rate-limit — hiện **không có** hạ tầng nào.

### B-7 — Conformance cho hợp đồng ghi
Check mới + negative control. Driver read-only khai `AcknowledgedGaps`.

### B-8 — Web + tài liệu + review cả đợt + push
UI ghi setpoint/lệnh với xác nhận. **Sửa cả sáu chỗ** khẳng định "không có đường ghi". Trả lời thẳng câu "ghi được rồi sao HALT không dừng máy". Review cả đợt (opus) rồi push.

## Hoãn có ghi nhận

- **Cảnh báo ra ngoài (Đợt C)** vẫn chưa có — email/SMS/webhook/relay/còi đều không tồn tại.
- Giao thức: Serial/RS-485, S7, EtherNet/IP, SECS/GEM vẫn chưa có. `MqttDriver` vẫn chưa nối vào host nào.
- Sparkplug **NCMD** (lệnh vào từ Site) **không** thuộc đợt này — đường ghi này là cục bộ, không phải từ hệ sinh thái.
- Không có rate-limit ở mức hạ tầng; nếu B-6 cần thì phải tự dựng.
