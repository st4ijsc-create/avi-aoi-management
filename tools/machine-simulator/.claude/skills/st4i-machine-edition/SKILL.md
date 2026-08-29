---
name: st4i-machine-edition
description: Quy ước bắt buộc khi làm việc trong tools/machine-simulator (ST4I Machine Edition — .NET 10 St4i.* + web React/Tauri) của repo avi-aoi-sim. Dùng skill này BẤT CỨ KHI NÀO bạn chạm vào cây này: sửa mã C# hay TypeScript, chạy test, viết tài liệu hay báo cáo, thêm endpoint, thêm connector/driver, chạm đường ghi thiết bị, hay đóng một task/workstream — kể cả khi việc đó trông nhỏ và hiển nhiên. Cây này có bốn nhóm quy ước KHÔNG suy ra được từ mã: cách chạy test (toàn solution không ổn định), bất biến an toàn HALT/PolicyEngine, bất biến "bán được cho một máy", và văn phong tài liệu không-overclaim. Đoán sai bất kỳ nhóm nào đều đã từng gây lỗi Critical thật trong lịch sử nhánh này.
---

# ST4I Machine Edition — quy ước làm việc

## 0. Bạn đang ở đâu

Repo `avi-aoi-sim` chứa **hai sản phẩm**, và chúng có luật khác nhau:

| | Đường dẫn | Ngăn xếp |
|---|---|---|
| **Synapse Platform** | gốc repo (`server/`, `client/`, `shared/`) | Node + tRPC + Drizzle + PostgreSQL, React 19, ~216 trang |
| **Machine Edition** | `tools/machine-simulator/` | .NET 10 (`St4i.*`) + web React 19/Vite/Tauri, SQLite, chạy offline |

Skill này **chỉ nói về Machine Edition**. Nếu bạn đang sửa `server/` hay `client/` ở gốc repo thì đây không phải chỗ tra cứu.

Machine Edition không còn là "simulator" dù tên thư mục vẫn vậy: nó là edge middleware bán được độc lập, có historian, OEE, RBAC, audit hash-chain, broker MQTT nhúng + Sparkplug B, Asset Registry ISA-95, AlarmEngine ISA-18.2, LineController PackML, driver Modbus TCP/RTU + OPC-UA, và một đường ghi thiết bị có gác.

---

## 1. Chạy test — bốn điều sẽ làm bạn báo cáo sai nếu không biết

**Chạy test .NET TỪNG PROJECT MỘT.** `dotnet test` toàn solution **không ổn định trên máy này** — điều này đã được ghi nhận nhiều lần trong ledger. Chạy:

```bash
dotnet test tests/St4i.EngineApi.Tests
dotnet test tests/St4i.EdgeCore.Tests
dotnet test tests/St4i.EdgeService.Tests
dotnet test tests/St4i.Connector.Abstractions.Tests
dotnet test tests/St4i.Connector.Conformance.Tests
```

Ghi lại **số bài của từng project**, không gộp. Nếu bạn không sửa mã C# thì số bài **phải không đổi** — một con số đổi mà bạn không giải thích được là tín hiệu, không phải nhiễu.

**Xác nhận build web bằng EXIT CODE, không bằng cách đọc log.** `npm run build` là `tsc -b && vite build`. Đã có **bốn đợt liên tiếp** né một lỗi kiểu bằng cách chạy `tsc -b` trần rồi tự nhận là xanh. Chạy `npm run build`, rồi kiểm `$?` / `$LASTEXITCODE` thật sự bằng 0.

**Cô lập Playwright khỏi dữ liệu sản xuất.** Bộ e2e từng ghi vào `%ProgramData%\ST4I\...` thật và tạo ra 10 tài khoản `e2e-user-*` trong `security.db` sản xuất; chúng phải bị xoá bằng tay sau đó. `web/playwright.config.ts` nay đặt các biến môi trường cô lập (gồm `ST4I_HISTORIAN_DIR`). Nếu bạn thêm một kho dữ liệu mới có đường dẫn từ `%ProgramData%`, **phải thêm biến cô lập tương ứng vào cấu hình đó** — nếu không bộ test sẽ âm thầm ăn vào dữ liệu thật.

**`web/playwright.config.ts` đặt `testDir: "./tests"`.** Bất kỳ file `*.test.mjs` / `*.spec.ts` nào bạn đặt dưới `web/tests/` sẽ bị Playwright nhặt. Bài test Node (`node --test`) phải nằm **ngoài** thư mục đó.

Cổng web đầy đủ:

```bash
cd web && npm run build && npx oxlint && node scripts/check-test-budgets.mjs
```

`check-test-budgets.mjs` là cổng tĩnh chặn một bài Playwright khai thời gian chờ lớn hơn mức nó có thể thực sự tiêu dưới trần 45 s mỗi bài. Nếu nó đỏ, đọc phần đầu file — nó giải thích vì sao, và câu trả lời hầu như không bao giờ là "nâng trần".

**Chỉ chạy lại toàn bộ Playwright khi bạn thật sự chạm vào thứ nó render.** Nếu không chạy, **nói rõ là không chạy và vì sao** trong báo cáo — im lặng bỏ qua đọc thành "đã chạy".

---

## 2. Viết test — quy ước "nói rõ bài này KHÔNG đo gì"

Mọi bài test trong cây này mang một doc-comment nêu **giới hạn của phép đo**, không chỉ mục đích. Xem `tests/St4i.EdgeCore.Tests/MachineConfigDesignDocTableTests.cs` làm mẫu chuẩn.

Lý do không phải hình thức: một bài xanh liên tục bị đọc thành nhiều hơn nó chứng minh, và trong lịch sử nhánh này chuyện đó đã dẫn tới một lỗi Critical lọt qua review (bằng chứng "demo không đổi" chỉ xét KPI fleet sống, chưa xét mặt historian/OEE/report). Viết ra giới hạn là cách rẻ nhất để lần sau người đọc không suy quá.

Khuôn:

```csharp
/// <summary>[bài này đo cái gì]
///
/// <para><b>Bài test này KHÔNG đo cái gì:</b> (1) …; (2) …; (3) …</para>
/// </summary>
```

### Khuôn ghim hai chiều — dùng khi hai thứ phải khớp nhau

Khi tài liệu phải khớp mã, hay schema phải khớp kiểu, đừng kiểm một chiều. Ba thành phần bắt buộc:

1. **Đối chiếu hai chiều** — thiếu bên nào cũng đỏ, thông điệp nói rõ thiếu bên nào.
2. **Danh sách miễn trừ khai tường minh** — không phải thói quen ngầm.
3. **Khẳng định không rỗng / không cũ** — một mục miễn trừ đã biến mất, hay một glob hụt làm mọi `[Theory]` bốc hơi, đều khiến bài test "xanh" trong khi không đo gì.

Mẫu có sẵn: `MachineConfigDesignDocTableTests`, `UnconsumedConfigKindsTests`.

### Cờ khai-báo-vs-thực-tế

Cây này có một khuyết tật lặp lại đủ nhiều để thành bài học: **một thứ được khai đủ, kiểm miền, lưu đĩa, phục vụ qua API — và không ai đọc nó.** `dispense_program`/`weld_profile` là ví dụ; `MachineParameterSchema.IsConsumedBySimulator` + `UnconsumedConfigKindsTests` là cách nó được đóng.

Khi bạn thêm một khả năng có thể rơi vào bẫy đó, thêm một cờ tương tự và **ghim nó bằng test đỏ theo cả hai chiều** — kể cả chiều ai đó nối dây thật mà quên sửa lời khai.

---

## 3. Bất biến AN TOÀN — không thương lượng

**HALT không phải thiết bị an toàn.** Nó là **chốt phần mềm giám sát**: nhấn thì huỷ pipeline đọc của phần mềm này và ngắt kết nối thiết bị, không hơn. Dừng khẩn cấp thật là mạch cứng đạt ISO 13849 Cat 3/4; phần mềm không bao giờ được là đường an toàn.

- **HALT không bao giờ đi đường ghi, và sẽ không bao giờ.** Cho HALT bắn một lệnh ghi Modbus/OPC-UA để "cố dừng máy" **không** lấp khoảng trống — nó chỉ khiến một chốt giám sát TRÔNG giống thiết bị an toàn hơn trong khi vẫn không phải. Sản phẩm tệ hơn, không an toàn hơn.
- **Đừng đặt tên/tạo hình bất kỳ điều khiển nào như một nút dừng khẩn cấp thật.** Đợt SM-4 đã đổi "E-STOP" → "HALT" (chữ + icon + doc, hành vi không đổi byte) chính vì lý do này. Đừng làm hỏng lại.

**Mọi lệnh ghi đi qua `PolicyEngine`, không có ngoại lệ.**

- `POST /v1/machines/{code}/setpoint` → vai **Engineer**
- `POST /v1/machines/{code}/command` → vai **Admin**
- `PolicyEngine` là **default-deny**; `EstopGuardRule` từ chối khi HALT đang cài; `CriticalAlarmGuardRule` từ chối khi có alarm Critical.
- `PolicyRequest` được thiết kế **transport-agnostic có chủ đích** — chú thích trong mã gọi đó là *"the no back-door"*. Một đường lệnh mới (UNS NCMD, widget HMI, bất kỳ thứ gì) **dựng cùng `PolicyRequest` ấy** thay vì tự làm cổng riêng. Nếu bạn thấy mình đang viết một cổng an toàn thứ hai, dừng lại — bạn đang đi sai đường.
- Mọi lệnh ghi vào **audit hash-chain** (`VerifyChainAsync` phải còn nguyên trước và sau).

**Chạm bất kỳ thứ gì ở trên ⇒ `security-review` là cổng bắt buộc trước merge**, không phải tuỳ chọn.

---

## 4. Bất biến "BÁN ĐƯỢC CHO MỘT MÁY"

Khách hàng tham chiếu: **một nhà máy mua ĐÚNG MỘT máy, không hệ sinh thái, không mạng ra ngoài.** Người đó phải có sản phẩm hoàn chỉnh.

Lịch sử: Giai đoạn 1 từng được đánh dấu **XONG**, rồi một audit độc lập phát hiện sản phẩm vẫn không bán được cho khách ấy. Phải mở lại thành Đợt A (SM-1→SM-6), và `task-7` còn phát hiện chính Đợt A đã làm hỏng bản demo mà nó tự nhận "không đụng tới". Đây là vòng đắt nhất trong lịch sử nhánh này.

| Bất biến | Chi tiết |
|---|---|
| **Đội hình mặc định RỖNG** | Ở cả `EngineApi` lẫn `EdgeService`. Đội demo chỉ nạp khi `ST4I_DEMO_ENABLED` |
| **Không rò dữ liệu demo** | Cột `is_fabricated` + `ApplyRealPresenceGateAsync` loại dòng fabricated khỏi truy vấn khách hàng; `ProvenanceTag` gắn nhãn "Demo"/"Unknown origin" |
| **Kiểm CẢ HAI CHIỀU** | 🔴 Đây là chỗ lỗi Critical đã lọt: bộ lọc fabricated làm bản DEMO hiện historian/OEE/report **rỗng vĩnh viễn**. `ResolveIncludeFabricated` nay mặc định `true` khi `DemoModeGate.Enabled`. Sửa gì đụng provenance thì kiểm **bản khách 0 dòng demo** VÀ **bản demo hiện đủ** |
| **Standalone là trạng thái hợp lệ** | Không màn chặn, không nag khi chưa cấu hình hệ sinh thái (SM-3) |
| **Offline tuyệt đối** | Font bundled, không CDN, không chức năng nào cần Site/Synapse/Internet |
| **Đặt tên trung thực** | Một máy thì gọi là một máy. Không "SCADA server", không "nhà máy" |

---

## 5. Viết tài liệu và báo cáo — văn phong không-overclaim

Cây này có văn phong tài liệu rất riêng, và nó **có chức năng**, không phải sở thích:

- **Song ngữ VI/EN** ở tài liệu hướng người dùng (README, spec thiết kế). Nhãn giao diện có gloss chữ hoa ngôn ngữ còn lại.
- **Không xoá văn cũ khi sửa — ghi chú đè lên nó.** Khi một mệnh đề hoá ra sai, khối `🔴` mới trích **nguyên văn** câu cũ, nói nó sai ở đâu, phép đo nào bác nó, rồi mới nêu câu đúng. Lý do: người đọc sau cần biết *vì sao* nó từng sai, và một lần sửa lặng lẽ sẽ khiến cùng khuyết tật quay lại.
- **Ledger ghi cả cái CHƯA làm.** Mọi hàng "Đã giao" trong `docs/SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md` §0-bis.1 đều có phần **"CHƯA có"**. Một workstream mới xong phần khung thì gọi là **SEAM**, không gọi là xong (xem `WS-G-plugin`).
- **Đừng lấy lại báo cáo cũ làm bằng chứng.** Nếu bạn nói bộ test xanh, bạn phải vừa tự chạy nó.
- **Phân biệt "được phục vụ" với "có tác dụng".** Hai câu đó khác nhau và nhiều khuyết tật của cây này sống đúng trong khoảng cách ấy.

**Tài liệu nằm ở đâu** (quyết định #8 của roadmap — giữ tại chỗ, đừng chuyển lên gốc repo):

| Loại | Đường dẫn |
|---|---|
| Spec thiết kế | `tools/machine-simulator/docs/<TÊN>_<YYYY-MM-DD>.md` |
| Kế hoạch thi công | `tools/machine-simulator/docs/plans/YYYY-MM-DD-<tên>-blueprint.md` |
| Bàn giao giữa hai phía | `tools/machine-simulator/docs/handoff/YYYY-MM-DD-<chủ-đề>.md` |
| Phán quyết chủ sở hữu | `tools/machine-simulator/docs/owner-decisions.md` |

---

## 6. Khuôn kiến trúc đã có — dùng lại, đừng phát minh lại

- **Contract assembly zero-dependency.** `src/St4i.Connector.Abstractions` là `net10.0` **thuần** (không `-windows`) với **KHÔNG một `PackageReference` nào**. Hợp đồng mới theo đúng khuôn này — một hợp đồng phải dùng được từ bất kỳ host nào mà không kéo theo gì.
- **Registry thay hard-code.** `ConnectorRegistry` + `connectors.json` thay chuỗi `if/else` trong `FleetHost`. Thêm loại mới thì đăng ký, đừng sửa nhánh điều kiện.
- **Cách ly lỗi theo slot.** `FleetHost` chạy N-slot: một driver chết không kéo sập pipeline khác. Giữ tính chất này.
- **Bộ conformance đóng gói được.** `St4i.Connector.Conformance` đã tìm ra **2 lỗi độ tin cậy thật** ở Modbus/OPC-UA. Driver mới chạy qua nó.
- **`capabilities` là seam license.** Tính năng mới đứng sau cờ `capabilities` để `WS-E License/Edition` bật Edition sau này không phải sửa kiến trúc.
- **Đọc phiên bản sản phẩm từ một chỗ.** `Directory.Build.props` là nguồn duy nhất; `GET /v1/capabilities` đọc lại từ assembly.

---

## 7. Trước khi báo cáo xong

Đừng nói "xong" trước khi từng ô dưới đây đúng, và **dán số liệu thật** chứ không mô tả:

- [ ] Năm (hoặc hơn) test project .NET chạy **riêng lẻ**, ghi số bài từng cái. Không sửa mã C# ⇒ số không đổi.
- [ ] `cd web && npm run build` — xác nhận **exit code 0**, không phải đọc log.
- [ ] `npx oxlint` và `node scripts/check-test-budgets.mjs` sạch.
- [ ] Playwright: chạy lại nếu chạm thứ nó render; **nếu không chạy, nói rõ là không và vì sao**.
- [ ] Chạm đường ghi / auth / mật mã ⇒ đã qua `security-review`.
- [ ] Chạm provenance / đội hình mặc định / màn chặn ⇒ đã kiểm **cả hai chiều** khách và demo.
- [ ] Tài liệu: ghi cả cái **CHƯA** làm; không xoá văn cũ mà ghi chú đè.
- [ ] Ledger `§0-bis.1` có hàng mới nếu đây là một workstream.
