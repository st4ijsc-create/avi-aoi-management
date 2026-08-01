# Đợt A — "Bán được cho một máy" (standalone single-machine)

**Ngày:** 29/07/2026 · **Nhánh:** `feat/machine-simulator` · **BASE:** `9ad5e41b`

## Vì sao đợt này tồn tại

Một cuộc rà soát bằng mã nguồn cho thấy sản phẩm **chưa bán được cho khách mua một máy**. Ba điểm chặn, đều đã kiểm chứng:

1. **Không chạy được với một máy thật duy nhất.** `fleet.json` ship 11 máy `simulated`. Xoá rỗng file → **không** chạy 0 máy mà **rơi về roster 10 máy hardcode** (`FleetHost.LoadFleet` — `if (loaded.Count > 0) return loaded;` rồi `BuildDefaultFleet()`). Tự sửa file chỉ để máy thật → `SimulatedDriver` ctor ném `ArgumentException("At least one simulator is required.")`, **không có try/catch nào chắn**, sập ngay khi `Start()`. Bật một máy Modbus thật là **cộng thêm**, không thay thế.
2. **KPI trộn máy thật với máy giả.** `FleetHost.OnPipelineCommitted` cộng `_totalCycles`/`_totalJudged`/`_totalPass` cho **mọi** reading từ **mọi** slot, không hề lọc theo driver kind.
3. **Bản product mặc định chặn Dashboard/Machines sau form "Kết nối hệ sinh thái".** `DefaultServerUrl = "http://localhost:5000"` là placeholder **không bao giờ tồn tại**, nên `needsConnect` luôn true và khách ra khỏi hộp thấy form đòi URL server thay vì máy của mình.

Tin tốt: **backend đã thật sự chạy độc lập được** — historian, OEE, alarm, audit đều ghi bình thường không cần mạng, và `EdgePipeline.Committed` bắn vô điều kiện dù `LiveTransport` có gửi được hay không. Cái chặn nằm ở **mặc định cấu hình và lớp UI**, không phải kiến trúc lõi.

## Quyết định đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| 1 | Thứ tự: **Đợt A trước** (B = tầng điều khiển SCADA, C = cảnh báo ra ngoài) — 🔴 cả ba đợt nay ĐÃ GIAO (B: 2026-07-30, C: 2026-07-31) | A rẻ nhất và đổi trạng thái sản phẩm từ "không bán được" thành "bán được" |
| 2 | **Fleet mô phỏng tách hẳn thành chế độ demo** | Bản product mặc định **không có máy giả nào**; roster rỗng cho tới khi khách khai báo máy thật |
| 3 | `fleet.json` **vẫn ship 11 máy** nhưng chỉ nạp trong demo | Giữ nguyên trải nghiệm triển lãm/bán hàng, không phải xoá đi làm lại |
| 4 | E-STOP: **giữ đường API**, chỉ đổi nhãn UI + tài liệu + XML comment | Đổi endpoint là breaking change mà không được lợi gì; vấn đề là **sự trung thực của cách gọi tên**, không phải đường dẫn |

## ⚠️ Vấn đề an toàn phải xử lý cho đúng

**Nút "E-STOP" hiện tại không dừng máy.** `FleetHost.Estop()` chỉ huỷ `CancellationTokenSource` của pipeline, đóng socket và bật cờ `_estopEngaged`. Nó dừng **phần mềm đọc dữ liệu**, không dừng thiết bị — và **không thể** dừng, vì `IDeviceDriver` chỉ có `ReadAsync`, toàn repo không có một lời gọi ghi nào tới thiết bị.

Hôm nay vô hại vì sản phẩm chỉ đọc. **Nhưng ngay khi nối máy thật, cái nút đó thành nguy hiểm**: người vận hành bấm thứ họ tin là dừng khẩn cấp, máy vẫn chạy.

**Cách sửa KHÔNG phải là làm cho nó dừng máy thật.** E-STOP thật theo ISO 13849 là **mạch cứng, Cat 3/4** — phần mềm không bao giờ được phép là đường an toàn. Cách đúng duy nhất là **gọi tên trung thực** và nói rõ trong tài liệu rằng đây không phải thiết bị an toàn. Đợt B (tầng điều khiển) cũng **không** được biến nó thành đường an toàn.

## Ràng buộc toàn cục

- **Không thêm NuGet/npm.** Không sửa SDK vendored `examples/device-client/csharp/St4iDeviceClient.cs`.
- **Chế độ demo phải giữ nguyên hành vi hiện tại từng chi tiết** — đó là hợp đồng triển lãm ("zero clicks"), và là cách duy nhất demo/bán hàng hiện chạy.
- Route mới phải vào `RbacPolicyTests.ExpectedRoutes` (sweep khớp số lượng chính xác hai chiều).
- Gate mỗi task: `dotnet build St4iMachineSimulator.sln -c Debug` sạch + **toàn bộ** 5 project test xanh (mốc: EngineApi 610 · EdgeCore 545 · EdgeService 31 · Abstractions 45 · Conformance.Tests 11 = **1242**) + `cd web && npm run build` sạch.
- Chạy test **theo từng project** — `dotnet test` toàn solution không ổn định ở môi trường này, và `src/St4i.Connector.Conformance` là *thư viện* (chỉ xunit, cố ý không có Test.Sdk) nên sẽ abort dưới lượt chạy toàn solution.
- Test làm bẩn `%ProgramData%\ST4I\sim\` là lỗi. **Đã phát hiện một leak thật đang tồn tại**: bộ Playwright tạo tài khoản `e2e-user-*` **thật** vào `security.db` production — sửa trong đợt này.
- Flaky môi trường đã biết: `WalFlushPumpTests`, `StoreAndForwardRestartSurvivalTests`, `MqttDriverTests`, mTLS handshake trong `DeviceIdentityStoreTests`, và mọi thứ gắn `[Trait("Category","RequiresMulticast")]`.

## Các task

### SM-1 — Roster rỗng là trạng thái hạng nhất; fleet mô phỏng chỉ còn trong demo
Bản product (`ST4I_DEMO_ENABLED` không bật): roster **bắt đầu rỗng**, chỉ máy thật (Modbus/OPC-UA/`connectors.json`) mới điền vào. `fleet.json` + `BuildDefaultFleet()` trở thành **demo-only**. Roster rỗng phải chạy được: không sập, không âm thầm rơi về fleet giả, `/v1/fleet` trả danh sách rỗng hợp lệ. Demo mode giữ nguyên 11 máy y như cũ.

### SM-2 — KPI và báo cáo không được trộn dữ liệu mô phỏng vào số liệu thật
`OnPipelineCommitted` phải phân biệt được nguồn. Sau SM-1 thì product mode không còn máy giả nên phần lớn là phòng thủ chiều sâu — nhưng mọi bề mặt KPI/OEE/FPY/báo cáo phải **không bao giờ** gộp dữ liệu mô phỏng vào số liệu khách hàng đọc để ra quyết định.

### SM-3 — Bỏ cổng chặn hệ sinh thái; standalone là trạng thái hạng nhất
`useEcosystemConnection`/`EcosystemConnectPanel` không được **chặn** Dashboard/Machines nữa — kết nối hệ sinh thái thành **trạng thái hiển thị**, không phải điều kiện tiên quyết. Bỏ placeholder `http://localhost:5000` không bao giờ với tới được: không cấu hình server nghĩa là **chạy độc lập**, một lựa chọn hợp lệ và được hỗ trợ, không phải lỗi cấu hình.

### SM-4 — Trung thực hoá E-STOP
Đổi nhãn UI, toàn bộ tài liệu và XML comment sang tên phản ánh đúng việc nó làm (dừng thu thập / ngắt kết nối). Nói thẳng trong README: **đây không phải thiết bị an toàn**, E-STOP thật là mạch cứng theo ISO 13849. Giữ nguyên đường API và toàn bộ hành vi `PolicyEngine`/`EstopGuardRule`.

### SM-5 — Khai báo máy thật phải là trải nghiệm sản phẩm
Hôm nay muốn nối một máy phải đặt biến môi trường + soạn tay file map JSON. Rà `/onboarding` hiện có, đánh giá nó làm được tới đâu, và làm cho đường "khách mua một máy, khai báo máy của mình" thành một luồng dùng được. Nếu kết luận cần một task riêng lớn hơn thì **báo cáo thay vì tự phình phạm vi**.

### SM-6 — Sửa leak test + tài liệu + review cả đợt + push
Cô lập `ST4I_SECURITY_DIR` trong harness Playwright (đang tạo tài khoản thật vào `security.db` production) và dọn các tài khoản `e2e-user-*`. README + báo cáo tổng. Review cả đợt (opus) rồi push.

## Hoãn có ghi nhận (không giấu nợ)

- **Tầng điều khiển máy (SCADA) — Đợt B.** Toàn repo **không có một đường ghi nào** xuống thiết bị; `IDeviceDriver` chỉ có `ReadAsync`. Sparkplug **NCMD** cũng chưa nhận. Hạ tầng phân quyền (`PolicyEngine` default-deny + RBAC + audit) **đã sẵn sàng** cho lệnh ghi — chỉ thiếu đường xuống thiết bị.
- ~~**Cảnh báo ra ngoài — Đợt C.** Không có email/SMS/webhook/Slack/relay/còi/đèn. Alarm chỉ tồn tại nếu có người đang nhìn trang web.~~ 🔴 **ĐÃ GIAO — Đợt C (C-1..C-8), 2026-07-31.** Đã có webhook ký HMAC, email qua SMTP, báo tại chỗ (chuông + thẻ) đẩy qua SSE, và relay/đèn báo vật lý. **SMS và Slack-qua-API riêng vẫn KHÔNG có** (Slack/Teams dùng được qua incoming webhook), **syslog vẫn KHÔNG có**. Xem `README.md` §22 và `docs/plans/2026-07-30-dotC-alarm-notification-blueprint.md`. Giữ lại dòng cũ gạch ngang thay vì xoá, để ai đọc lại kế hoạch Đợt A thấy chỗ sửa chứ không thấy một khẳng định biến mất.
- Giao thức còn thiếu: Serial/RS-485, S7, EtherNet/IP, SECS/GEM. `MqttDriver` tồn tại nhưng **chưa được nối vào host nào**.
- `ResilienceProbe` coi **bất kỳ** phản hồi HTTP nào (kể cả 404) là "với tới được" — nới lỏng có chủ ý, ghi nhận chứ không sửa ở đợt này.
