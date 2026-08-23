# Các quyết định đang chờ chủ sở hữu

Danh sách này tồn tại vì trước đó nó **không tồn tại ở dạng file**: các mục dưới đây
nằm rải trong thông điệp merge và trong các ledger dưới `.superpowers/sdd/`, mà thư
mục đó **bị gitignore** — nên chúng không bao giờ vào repo và chủ sở hữu không có
đường dẫn nào để mở. Đó là thiếu sót của quy trình, không phải của phép đo.

**Luật của file này:** một mục chỉ được rời khỏi đây khi có một **quyết định** ghi
kèm ngày và người quyết. Không mục nào được xoá vì "chắc không quan trọng".
Mỗi mục nêu: **đo được cái gì**, **ở đâu trong mã**, **hậu quả vận hành**, và
**chuyện gì xảy ra nếu không quyết định** — vì "không quyết định" luôn là một lựa
chọn có hậu quả, thường là giữ nguyên hành vi hiện tại.

⚠️ **Đoạn mở đầu này đã bị sửa nhiều lần — T-1, U-1 và V-1 (2026-08-17) — và các khối
đính chính ghi lại việc ấy được GIỮ NGUYÊN VĂN**, ở §"Lịch sử đính chính của chính file
này" cuối file. Y-1 (2026-08-18) chỉ **chuyển chỗ**, không đổi một chữ. Đây là một **con
trỏ, không phải bản sao**: trạng thái đang sống nằm ở **bảng phán quyết** ngay dưới đây
và ở từng mục.

---

## Trạng thái phán quyết — 2026-08-16, cập nhật 2026-08-18

Chủ sở hữu uỷ quyền quyết định toàn bộ danh sách này. Phán quyết ghi ngay dưới mỗi
mục. **Ba mục KHÔNG được quyết đơn phương** và lý do nêu tại chỗ: chúng đổi thứ mà
**người ngoài tổ chức này đang dựa vào** — payload MQTT, hình dạng dữ liệu trên dây,
và con số OEE đã báo cáo trong quá khứ. Uỷ quyền phủ được *"làm hay không làm"*,
**không phủ được sự đồng ý của bên thứ ba**.

| # | mục | phán quyết |
|---|---|---|
| 1 | ghi đè im lặng | 🔨 **SỬA** — ~~gộp với 5–7~~ **(nhóm ấy SAI, xem §5–7)**; đã thi hành, Q-1 |
| 2 | `Warn` tốt cho OEE | ✅ **GIỮ HÀNH VI, XUẤT BẢN NÓ** — đổi là viết lại lịch sử; đã thi hành, AA-1 (2026-08-18) |
| 3 | bất đối xứng Sparkplug | ✅ **GIỮ DÂY, ĐÃ GHI RÕ** — đổi payload là việc của bên đăng ký; đã thi hành, N-2 |
| 4 | hình dạng hàng `Samples` | ✅ **`RateHz` LÀ BỘ PHÂN BIỆT** (2026-08-16); văn xuôi đã thi hành, AA-1 — 🔴 **tiền đề của phán quyết nay bị BÁC: xem mục 14.** Hai câu trước của ô này giữ nguyên văn, không xoá: (i) tới 2026-08-18 ô ghi *"⚖️ ĐO TRƯỚC, RỒI CHỌN — SDK đã xuất bản là ứng viên chuẩn; **việc còn nợ** (2026-08-18)"*; (ii) AA-1 **rút** câu ấy với lý do *"dòng phán quyết của §4 nói NGƯỢC LẠI — nhận `[[t,v]]` làm chuẩn sẽ phá cả hai bộ sinh"*. 🔴 **Phép rút (ii) nay BỊ RÚT LẠI** (AA-1 vòng phản biện 1): đo tiếp cho thấy câu (i) **đúng** — đặc tả đã xuất bản là ứng viên chuẩn, và là ứng viên **duy nhất có bộ cưỡng chế lúc chạy**. **Không câu nào được coi là thắng** cho tới khi mục 14 được quyết. 🔴 **MỞ RỘNG 2026-08-19 (AK-1) — điều kiện của câu ngay trên NAY ĐÃ XẢY RA: mục 14 được quyết (lựa chọn 3, chủ sở hữu, 2026-08-19) và đã thi hành.** Câu ấy **giữ nguyên văn, KHÔNG rút**, và ô này **không tuyên bố câu nào thắng** — vì lựa chọn 3 quyết **hình dạng hàng TRÊN DÂY** (cặp `[t, v]`, dựng ở `Normalizer`) và **cố ý không quyết** hình dạng hàng **trong tiến trình**: `WaveformSeries` giữ nguyên, `RateHz` vẫn là thứ hai bộ sinh của sản phẩm này tách trên. Nên câu (i) và câu (ii) vẫn ở đúng chỗ chúng đứng; cái mới là **hai lớp ấy nay được nối bằng một phép chuyển có nhân chứng**, xem mục 14 ở **Phần III**. **AK-1 không sửa một chữ nào khác trong mục 4** — phán quyết 2026-08-16 là của chủ sở hữu |
| 5 | ~~ba hình dạng xoá file~~ → **`oee-settings.json`** | 🔨 **GOM VỀ MỘT LUẬT** (2026-08-17) — đã thi hành, V-1 |
| 6 | log hoãn của một lần cài đặt hỏng | 🔨 **PHÁT RA TRÊN ĐƯỜNG NÉM LỖI** (2026-08-17) — đã thi hành, T-1 |
| 7 | nửa sau của S4 | 🔨 **DỪNG + GIỮ COMMIT + BÁO TRÊN `/v1/health`** (2026-08-17) — đã thi hành, U-1 |
| 8 | `ReapplyCurrentAsync` ghi đè `site-link.json` | 🔨 **CHẶN — cùng luật, tại chỗ gọi THỨ BA của `ApplyAsync`** (2026-08-18, điều phối viên quyết theo uỷ quyền); đã thi hành, Z-1 |
| 9 | sàn môi trường trên nhánh *không đọc được* | 🔨 **(b) ÁP SÀN `ST4I_*` VÀ LƯU NÓ** (2026-08-19, chủ sở hữu, **sau khi được cảnh báo rằng nó đi ngược mục 1/5/8/10/11**) — ghi đè **tại chỗ**, **không** di chuyển và **không** xoá byte cũ; miễn trừ di-chuyển của mục 10 **không** áp ở đây. (c) *áp-mà-không-lưu* **KHÔNG** được chọn, nên hợp đồng `FleetCore.UpdateSettings` **không đổi**. Cách đọc hoà giải, ghi kèm ngày ở thân mục: ở năm mục kia thứ bị đè là **dữ liệu vận hành viên** và thứ ghi xuống là giá trị tiến trình **tự nghĩ ra**; ở đây thứ ghi xuống là **cấu hình bản triển khai đã KHAI qua `ST4I_*`** — **khôi phục một giá trị đã khai**, không **bịa** một giá trị. Giá đã chấp nhận: một file hỏng vì gõ nhầm **không còn là bản ghi cuối cùng**. **Đã thi hành, AJ-1 (2026-08-19)** — guard bị xoá, **HAI** chuỗi đã xuất bản sửa, nhân chứng `AMalformedSettingsFile_…` **đảo chiều và đổi tên**; 🔴 phép kiểm đếm NGUỒN `TheStartupReplayHasExactlyOneArm_…` **VẪN XANH và đó là im lặng, không phải chấp thuận** |
| 10 | `CredentialStore` biến lỗi môi trường phục hồi được thành mất mát | 🔨 **GIỮ BLOB CŨ DƯỚI TÊN KHÁC** (2026-08-18) — DI CHUYỂN dữ liệu, **miễn trừ CHỈ cho mục này**; đã thi hành, Z-1 |
| 11 | khôi phục `oee-settings.json` lúc đang chạy bị ghi đè | 🔨 **CHẶN CÚ GHI** khi bảng dựng từ `Absent` mà đĩa nay `Loaded` (2026-08-18); đã thi hành, Z-1 |
| 12 | `GenerateDocumentationFile` cho `St4i.EdgeCore` | 🔨 **BẬT CỜ, KHÔNG MIỄN TRỪ** (2026-08-18) — **không phải (a), (b1), (b2) hay (c)**; **việc còn nợ**, nhiều vòng. 🔴 **CỜ ĐÃ BẬT 2026-08-19 (AF-1, đợt 3/8): `EXPECT_WARNINGS` 116 → 852 ĐO, 185 vendored / 667 ours, 103 cái vendored HIỆN RA và ĐƯỢC GHIM, không một lệnh đè.** Mục **Ở LẠI PHẦN II**: **633 của ta chưa trả**, và một cờ bật trên món nợ còn mở là thi hành **một phần**. Đợt 4–8 trả, mỗi đợt đo lại. 🔴 **ĐỢT 4 ĐÃ TRẢ 2026-08-19 (AG-1, đợt 4/8): 101 khẳng định ĐÃ SAI được TRỎ LẠI (75 CS1574 + 23 CS1734 + 3 CS0419, 29 file, 0 dòng mã đụng tới), `EXPECT_WARNINGS` 852 → 751 ĐO, sổ 19 → 16 hàng, 185 vendored / 566 ours, tám hàng VENDORED không dịch một đơn vị.** Mục **VẪN Ở LẠI PHẦN II**: **532 chỗ trống của ta chưa trả** (+ 103 vendored không ai trả được). Đợt 5–8 trả, mỗi đợt đo lại. 🔴 **ĐỢT 5 ĐÃ TRẢ 2026-08-19 (AH-1, đợt 5/8): 120 chỗ THIẾU được VIẾT — một cụm mạch lạc, mô hình dữ liệu config-sync (7 file `Config/`, cả 120 là CS1591), `EXPECT_WARNINGS` 751 → 631 ĐO, sổ vẫn 16 hàng, 185 vendored / 446 ours, `OURS CS1591 448 → 328`, `OURS CS1573 84` KHÔNG dịch, tám hàng VENDORED không dịch một đơn vị.** Mục **VẪN Ở LẠI PHẦN II**: **412 chỗ trống của ta chưa trả**. Đợt 6–8 trả, mỗi đợt đo lại. 🔴 **ĐỢT 6 ĐÃ TRẢ 2026-08-20 (AL-1, đợt 6/8): 129 chỗ THIẾU được VIẾT — một cụm mạch lạc, historian cạnh máy (8 file `Historian/` + `Models/` + `Metrics/`; 85 CS1591 + 44 CS1573), `EXPECT_WARNINGS` 631 → 502 ĐO, sổ vẫn 16 hàng, 185 vendored / 317 ours, `OURS CS1591 328 → 243` VÀ `OURS CS1573 84 → 40` — đợt ĐẦU TIÊN hàng CS1573 dịch, tám hàng VENDORED không dịch một đơn vị.** Mục **VẪN Ở LẠI PHẦN II**: **283 chỗ trống của ta chưa trả**. Đợt 7–8 trả, mỗi đợt đo lại. 🔴 **Và đợt 6 BÁC ba khẳng định đã công bố trong chính cụm ấy — rút tại chỗ, KHÔNG sửa mã: `OeeCalculator` *"mọi tỉ số kẹp `[0,1]`"* (Quality không kẹp), `HistorianWriter.Enqueue` *"kênh đầy ⇒ có cảnh báo"* (cú rơi vì bão hoà là IM LẶNG), `ApplyRealPresenceGateAsync` *"mọi query hướng khách hàng đều áp"* (`QueryTelemetryAsync` không áp và không thể áp). Xem §11** 🔴 **ĐỢT 7 ĐÃ TRẢ 2026-08-20 (AM-1, đợt 7/8): 62 chỗ THIẾU được VIẾT — một cụm mạch lạc, chiếc phong bì chuẩn hoá và trọn hành trình của nó (12 file: `Transport/` + `Mapping/` + `Models/`, ba thư mục lấy TRỌN, dư lượng mỗi thư mục = 0; 51 CS1591 + 11 CS1573), `EXPECT_WARNINGS` 502 → 440 ĐO, sổ vẫn 16 hàng, 185 vendored / 255 ours, `OURS CS1591 243 → 192` VÀ `OURS CS1573 40 → 29` — cả hai đều GIẢM và KHÔNG một CS1573 mới nào được tạo ra, tám hàng VENDORED không dịch một đơn vị.** Mục **VẪN Ở LẠI PHẦN II**: **221 chỗ trống của ta chưa trả**, và **đợt 8 là đợt bao phủ CUỐI CÙNG**. 🔴 **Và đợt 7 BÁC một khẳng định đã công bố trong chính cụm ấy — rút tại chỗ, KHÔNG sửa mã: `ITransport` tự nhận là *"seam DUY NHẤT"* mà một reading đi qua để rời khỏi hộp; đo được rằng `EdgePipeline` trao CÙNG chiếc phong bì cho `IUnsPublisher.PublishReading` ở câu lệnh ngay trước, và `Site.UnsBridge` phát nó ra ngoài hộp — có HAI đường ra, không một. Xem §12** 🔴 **ĐỢT 8 ĐÃ TRẢ 2026-08-20 (AN-1, đợt 8/8 — ĐỢT BAO PHỦ CUỐI CÙNG): 112 chỗ THIẾU được VIẾT — phần BÙ của họ driver (20 file, 7 thư mục lấy TRỌN, dư lượng mỗi thư mục = 0: `Config/` 50 · `Uns/` 19 · `Site/` 12 · `Engine/` 11 · `Fleet/` 8 · `Infrastructure/` 6 · `Uns/Sparkplug/` 6; 102 CS1591 + 10 CS1573), `EXPECT_WARNINGS` 440 → 328 ĐO, sổ vẫn 16 hàng, 185 vendored / 143 ours, `OURS CS1591 192 → 90` VÀ `OURS CS1573 29 → 19` — cả hai GIẢM, không một CS1573 mới nào được tạo, tám hàng VENDORED không dịch một đơn vị. Con số 112 là DỰ BÁO của đợt 7 và nay là PHÉP ĐO — nó KHÔNG lệch.** 🔴 **MỤC 12 Ở LẠI PHẦN II, VÀ NÓ SẼ RỜI PHẦN II BẰNG MỘT PHÁN QUYẾT, KHÔNG BẰNG MỘT CON SỐ VỀ 0.** **109 chỗ trống còn lại đều là `Drivers/`** và chúng **KHÔNG thuộc một đợt 9**: bốn đợt bao phủ đã tiêu hết. Chúng rơi lên **97 thành viên**, và **phép đo BÁC tiền đề của đợt 6**: theo năm phép thử, **84 thành viên có một cách hỏng/điều kiện tiên quyết, 13 chỉ có đơn vị/mặc định, và KHÔNG CÁI NÀO không-có-gì-để-nói** (trong bốn ví dụ đợt 6 nêu, `OpcUaConnectorFactory.Create` **đã có** tài liệu và chưa bao giờ được nợ; *"mười một constructor simulator"* là **số FILE đọc thành số CONSTRUCTOR** — có **tám** lớp simulator). **Câu chủ sở hữu phán — *"chúng có nên là `public` không"* — KHÔNG TỒN TẠI với 46/97** (41 cài đặt interface/abstract công khai ⇒ lỗi biên dịch; 5 thành viên enum ⇒ C# cấm), **sai trong IM LẶNG với 9** (`ModbusRegisterMap`/`OpcUaNodeMap` do `System.Text.Json` đọc — hạ xuống `internal` vẫn biên dịch rồi nạp về mặc định, gồm cả `UnitId` và `Password`), **miễn phí với 17**, và **tốn một `InternalsVisibleTo` mới với 25** — mà `AssemblyInfo.cs` của chính `St4i.EdgeCore` lập luận chống lại cả hai loại IVT ấy. **KHÔNG một mức truy cập nào đổi. Xem §13** 🔨 **PHÁN QUYẾT CỦA CHỦ SỞ HỮU 2026-08-22: VIẾT TÀI LIỆU CHO CẢ 97, KHÔNG ĐỔI MỘT MỨC TRUY CẬP NÀO** — nên 109 kia trở lại là một món nợ **VIỆC**, và mục **Ở LẠI PHẦN II**. 🔴 **ĐỢT 9 ĐÃ TRẢ 2026-08-22 (AY-1, đợt đầu thi hành phán quyết ấy, base `fb7635cf`): 25 chỗ THIẾU được VIẾT — một cụm mạch lạc, bề mặt cấu hình mà một bản triển khai KHAI cho hai driver fieldbus thật (4 file lấy TRỌN, dư lượng mỗi file = 0: `ModbusOptions.cs` 8 · `ModbusRegisterMap.cs` 8 · `OpcUaNodeMap.cs` 6 · `OpcUaOptions.cs` 3; 25 CS1591 + 0 CS1573), `EXPECT_WARNINGS` 328 → 303 ĐO, sổ vẫn 16 hàng, 185 vendored / 118 ours, `OURS CS1591 90 → 65` và `OURS CS1573 19` KHÔNG dịch — tức KHÔNG một CS1573 mới nào được tạo, tám hàng VENDORED không dịch một đơn vị, 0 dòng `///` bị xoá.** Cụm ấy **đúng bằng A2 + B của mục 25**, và phép kiểm lại **BÁC một nửa hàng B**: bốn trong chín là `required`, nên thu hẹp chúng là **lỗi biên dịch CS9032** chứ không phải nạp mặc định im lặng — số thành viên sai-trong-im-lặng là **5**, không phải 9; câu *"ít nhất 55 sẽ public"* **không đổi**, thành phần của nó thì đổi. **Phân loại 84/13/0 kiểm lại trên cụm này: 23/2/0 — con số 0 TÁI LẬP.** 🔴 **Và đợt 9 BÁC ba khẳng định đã công bố, rút TẠI NGUỒN, KHÔNG sửa mã:** `ModbusRegisterMap.FromJson`'s *"the one parse failure … that didn't name what was wrong"* (đo được ít nhất HAI), phép kiểm kê người đọc của `ModbusOptions` nói `St4i.EdgeService.EdgeConnectors` *"has never read these variables at all"* (host ấy GỌI `FromEnvironment` và dùng `Host`/`Port`), và trần census **5780/15965** (không tái lập; đã lệch từ TRƯỚC đợt này). 🔴 **HAI khuyết tật MÃ thấy lúc viết — DỪNG và BÁO, không sửa:** `PollIntervalMs` không kiểm miền trên cả hai map (0 ⇒ vòng poll không tiết chế, −1 ⇒ chờ vô hạn, ≤ −2 ⇒ `ArgumentOutOfRangeException` thoát ra), và `"registers"/"nodes": null` ⇒ `NullReferenceException` trần. Mục **VẪN Ở LẠI PHẦN II**: **84 chỗ trống trên 72 thành viên chưa trả**. Xem §14 🔴 **ĐỢT 10 ĐÃ TRẢ 2026-08-22 (AZ-1, base `3f564039`): 21 chỗ THIẾU được VIẾT — một cụm mạch lạc, bề mặt đường RS-485 DÙNG CHUNG: phân xử, cho thuê và cái giữ chỗ của từng thiết bị (5 file lấy TRỌN, dư lượng mỗi file = 0: `ModbusRtuDriver.cs` 9 · `GatewayTcpBusLink.cs` 4 · `ModbusBus.cs` 4 · `ModbusRtuConnectorFactory.cs` 3 · `ModbusBusRegistry.cs` 1; 10 CS1591 + 11 CS1573, trên 15 thành viên), `EXPECT_WARNINGS` 303 → 282 ĐO, sổ vẫn 16 hàng, 185 vendored / 97 ours, `OURS CS1591 65 → 55` VÀ `OURS CS1573 19 → 8` — **đợt ĐẦU dưới phán quyết này dịch CẢ HAI hàng**, vì 11 trong 19 cái CS1573 nằm gọn trong năm file ấy; tám hàng VENDORED không dịch một đơn vị, 0 dòng `///` bị xoá.** `ModbusTcpDriver` và hai factory TCP **cố ý ở NGOÀI** cụm: một endpoint TCP là một thiết bị với khoá riêng, nên câu hỏi của cụm không nói gì về nó. 🔴 **Và đợt 10 BÁC một khẳng định đã công bố, rút TẠI NGUỒN ở HAI chỗ, KHÔNG sửa mã:** *"`GenerateDocumentationFile` is not set anywhere in this repository"* (`ModbusRtuDriver.BusDisposedDetail` và `ModbusRegister.DecodeRawWord`) — đợt 3 của chính mục này bật cờ ngày 2026-08-19, `SuppressionCensusTests` ghim **TÁM bật / bảy tắt**; **kết luận sống, tiền đề chết**. 🔴 **Và nó BÁC hai phép đếm nữa: hai trong 97 thành viên đã là `private`** (mẫu số của một phán quyết truy cập là **≤ 95**, xem mục 25), **và *"cả hai driver"* của đợt 9 thực ra là BA**. 🔴 **HAI khuyết tật mã của đợt 9 nay là MỤC 38 và 39 ở Phần I** — xác nhận lại trên assembly đã dựng, **không thi hành**. 🔴 **Một khuyết tật DỤNG CỤ, dừng và báo:** `scripts/repo-scan.sh` chạy **không pathspec** mặc định `:(top).`, mà git **không khớp gì** — nên nó in `result lines : 0 … a measurement, not an error` **cho mọi pattern**; `--self-test` không thể thấy vì nó luôn truyền pathspec. Mục **VẪN Ở LẠI PHẦN II**: **63 chỗ trống trên 57 thành viên chưa trả**. Xem §15 🔴 **ĐỢT 11 ĐÃ TRẢ 2026-08-22 (BB-1, base `927c0246`): 25 chỗ THIẾU được VIẾT — một cụm mạch lạc, NĂM CÀI ĐẶT `IDeviceDriver` CỤ THỂ CÒN LẠI (5 file lấy TRỌN, dư lượng mỗi file = 0: `MqttDriver.cs` 6 · `SimulatedDriver.cs` 5 · `HotFolderAoiDriver.cs` 5 · `ModbusTcpDriver.cs` 5 · `OpcUaDriver.cs` 4; 25 CS1591 + 0 CS1573, trên 25 thành viên), `EXPECT_WARNINGS` 282 → 257 ĐO, sổ vẫn 16 hàng, 185 vendored / 72 ours, `OURS CS1591 55 → 30` và `OURS CS1573 8` KHÔNG dịch — tức KHÔNG một CS1573 mới nào được tạo dù cụm này viết NĂM constructor mang 18 tham số, tám hàng VENDORED không dịch một đơn vị, và 0 dòng bị xoá khỏi BẤT KỲ file nào (cột xoá của `git diff --numstat` là 0 cho từng file).** Cụm ấy đi cùng nhau vì doc của chính `IDeviceDriver` **LÀ hợp đồng tuân thủ**, nên mọi thành viên trả lời một câu hỏi: **seam driver duy nhất hứa gì ở đây, và chỗ nào cài đặt này không giữ lời**. **Lần `-t:Rebuild` ĐẦU lại không đứng — 258 vì một `MSB3101` (một WARNING, nên nó vào TỔNG chứ không vào cổng lỗi) với bốn node ngoại lai của C# Dev Kit trú suốt; CHỜ chứ không giết, shutdown rồi chạy lại: 257.** 🔴 **HAI khuyết tật thấy lúc viết — DỪNG và BÁO, không sửa mã, không mở mục mới:** constructor của `HotFolderAoiDriver` **vi phạm thẳng** luật *"không chặn, không I/O"* của `IDeviceDriver` (ba `Directory.CreateDirectory` + một `FileSystemWatcher` sống — đã ghi sẵn ở bộ conformance, nay đọc được từ chính driver), và `MqttDriver.DisposeAsync` phát `DisconnectAsync` với `CancellationToken.None` nên phép chờ thứ hai của nó **không có cận nào trong lớp này**. 🔴 **Và một khẳng định đã công bố bị phép đo BÁC nhưng CỐ Ý KHÔNG RÚT vì nằm NGOÀI cụm:** doc của `IDeviceDriver.Id` nói nó *"keys slot labels and, through those, alarms"*, còn `ScenarioAwareDriver.Id` nói *"a pipeline slot, an alarm target and a trace row all key on this"* — đo trên mọi `*.cs` repo này sở hữu: **không gì tiêu thụ giá trị ấy**; nhãn slot do `FleetCore.ResolveSlotLabelFor`/`ResolveConnectorSlotLabel` sinh. Mục **VẪN Ở LẠI PHẦN II**: **38 chỗ trống trên 32 thành viên chưa trả**, gồm **cả 8 CS1573 còn lại**. Xem §16 🔴 **ĐỢT 12 ĐÃ TRẢ 2026-08-22 (BC-1, đợt bao phủ CUỐI, base `5e194ab0`): 38 chỗ THIẾU cuối cùng được VIẾT — PHẦN BÙ của họ driver, cả 38 dưới MỘT cây `src/St4i.EdgeCore/Drivers` (17 file lấy TRỌN, dư lượng mỗi file = 0: `Simulators/` 11 file/27 · `Modbus/` 2/4 · `OpcUa/` 2/4 · `HotFolder/` 1/2 · `Mqtt/` 1/1; 30 CS1591 + 8 CS1573 trên 32 thành viên), `EXPECT_WARNINGS` 257 → 219 ĐO, sổ 16 → 14 hàng vì `OURS CS1591 30 → 0` VÀ `OURS CS1573 8 → 0` — LẦN ĐẦU một hàng về 0 kể từ AF-1 — 185 vendored / 34 ours, tám hàng VENDORED không dịch một đơn vị, 0 dòng `///` bị xoá, 0 lệnh đè, 0 mức truy cập đổi.** 🔴 **PHÁN QUYẾT CỦA CHỦ SỞ HỮU 2026-08-22 NAY ĐÃ THI HÀNH XONG: 25 + 21 + 25 + 38 = 109 chỗ trống trên 97 thành viên, cả bốn đợt, không một mức truy cập nào đổi.** Mục **RỜI PHẦN II SANG PHẦN III** theo đúng điều kiện của chính file này (một ghi chép thi hành ghi kèm ngày). 🔴 **PHẦN DƯ NÊU THẲNG, KHÔNG GIẤU: `EXPECT_WARNINGS = 219` KHÔNG phải 0** — 103 là file SDK **vendored** không ai trả được, 34 còn lại là `OURS` và **không cái nào là cảnh báo tài liệu**; và mục 12 mua **BAO PHỦ**, không mua **TÍNH ĐÚNG** (mục 26 vẫn đứng). 🔴 **Đợt 12 BÁC một khẳng định đã công bố trong chính cụm — rút TẠI NGUỒN, không sửa mã:** khối lớp `ModbusDriverFactory` nói `Program.cs` đăng ký `Create` như một singleton `Func<IDeviceDriver>`; đo được `Program.cs` **không có đăng ký nào như thế** (GP-4 đã gỡ), và toàn cây có **đúng một** `new ModbusDriverFactory(...)` và **đúng một** `new OpcUaDriverFactory(...)`. 🔴 **MƯỜI khuyết tật MÃ thấy lúc viết — DỪNG và BÁO, không sửa. Xem §"đợt 12"** |
| 13 | khôi phục `oee-settings.json` đè lên một file ĐÃ CÓ | 🔨 **ĐÓNG — STORE GHI LẠI DANH TÍNH CỦA CÁC BYTE** (2026-08-19, chủ sở hữu). 🔴 **Giá đã chấp nhận và ghi vào mục: `PUT /v1/historian/oee/settings` trả 409 ở những lúc hôm nay trả 200, KỂ CẢ khi thứ đổi file là một biên tập tay HỢP LỆ hay chỉ là một lần ĐỊNH DẠNG LẠI.** Câu *"bao nhiêu PUT hợp lệ thành 409"* vẫn **KHÔNG đo được** và phán quyết ra **mà không có nó**. **Đã thi hành, AJ-1 (2026-08-19)** — cơ chế **SUY ra chứ không chọn một trong ba**: cả ba ứng viên (băm / `mtime` / kích thước) là **vân tay**, mà vân tay chỉ cần khi không cầm được cả hai vế; `ReadLocked` **đã cầm toàn văn** ở cả hai đầu trong cùng một khoá, nên store **giữ lại toa hạng gốc** và so trực tiếp — **0 lần đọc đĩa thêm**, và **mạnh hơn** mọi hàm hao hụt của nó. Kiểu thứ ba `OeeSettingsFileChangedException`; vị từ gác bằng **CẶP `Loaded/Loaded`**, nên cặp `Loaded/Absent` **không** bị đóng kèm. Nhân chứng `Set_AfterARestoreOntoAHostThatCameUpWithAFile_…` **đảo chiều và đổi tên**; giá được **ghim** bằng một bài kiểm riêng |
| 14 | **hai hợp đồng hàng `Samples` đá nhau, một cái được CƯỠNG CHẾ** | 🔴 **CHỜ ANH** — phần dư của mục 4, mở 2026-08-18 (AA-1, vòng phản biện 1); `WelderSim` phát hình dạng **cổng ingest TỪ CHỐI**. 🔴 **ĐO trên cổng đang chạy 2026-08-18 (AB-1): từ chối là THẬT (HTTP 400 ở bước lược đồ) — VÀ cờ `PROCESS_RESULT_INGEST_ENABLED` MẶC ĐỊNH TẮT, nên chưa bản triển khai nào nạp. Hai nửa đọc cùng nhau; ba lựa chọn vẫn CHƯA QUYẾT**. 🔴 **KHẢ NĂNG THỨ BA ĐÃ ĐO 2026-08-19 (AI-1), SỬA sau phản biện: KHẢ THI — `Normalizer` có đủ thông tin, `WaveformSeries` và `WelderSim` KHÔNG phải đổi. Nhưng nó KHÔNG nằm trọn ở một đường dây: cùng một envelope đi ra BA bề mặt, và một trong ba là gương ngữ nghĩa MQTT RETAINED — một **bề mặt đã xuất bản thứ hai; NGƯỜI ĐĂNG KÝ CHƯA ĐO và không đo được từ repo này** (hợp đồng TỰ KHAI rằng họ ở ngoài repo — đó là lời của tài liệu, không phải một phép đếm). 🔴 **Giá gương ấy KHÔNG phải của riêng lựa chọn 3: lựa chọn 1 trả CÙNG giá đó CỘNG THÊM, lựa chọn 2 không trả giá nào trong cây này nhưng trả TOÀN BỘ ở ngoài (hợp đồng ingest đã xuất bản + ba SDK).** Và KHÔNG một bài kiểm nào trong 2763 bài đỏ lên, tức lối này KHÔNG CÓ NHÂN CHỨNG. **Ràng buộc thi hành cứng: `LiveTransport.ReadSampleSeries` chỉ nhận hàng `double[]` và bỏ im lặng mọi kiểu khác.** Ba lựa chọn VẪN CHƯA QUYẾT** — 📎 **câu ngay trước giữ NGUYÊN VĂN, RÚT 2026-08-19 (AK-1), và lý do là chủ sở hữu ĐÃ PHÁN, không phải câu ấy từng sai; AK-1 dùng đúng MỘT kiểu bảo tồn — kiểu AB-1 lập và AI-1 dùng: trích nguyên văn rồi rút, kèm ngày và người, KHÔNG dấu gạch ngang ở bất kỳ đâu, không xoá một dòng nào.** → 🔨 **QUYẾT: LỰA CHỌN 3 — DỰNG CẶP `[t, v]` Ở RANH GIỚI `Normalizer`** (2026-08-19, chủ sở hữu). `WaveformSeries`, `WelderSim`, `ScrewdriveSim` **không đổi một dòng**; thứ đổi là **payload đi ra**. 🔴 **Giá đã chấp nhận và ghi vào mục: HAI bề mặt đã xuất bản đổi CÙNG LÚC, không một** — payload ingest HTTP **và** gương ngữ nghĩa MQTT retained `syn/…`; **NGƯỜI ĐĂNG KÝ CHƯA ĐO và không đo được từ repo này**. Cộng một bề mặt thứ ba, riêng tư: hàng đợi store-and-forward của SDK ghi nguyên payload **xuống đĩa** và **phát lại hình dạng CŨ sau khi mã đã đổi** — **cửa sổ ấy CHƯA ĐO**. **Đã thi hành, AK-1 (2026-08-19)** — cơ chế của `t` **SUY ra chứ không chọn**: `t(i) = i / rateHz`, tức **thời điểm mà `rateHz` HÀM Ý**, **không** phải thời điểm `WelderSim` vẽ đường cong; lý do là ở ranh giới chỉ có **bốn trường** của `WaveformSeries`, còn dựng lại thời điểm THẬT đòi **tham số hoá riêng của từng bộ sinh** — không có trên hồ sơ, khác nhau theo driver, và **vắng hẳn** với driver bên thứ ba mà ranh giới này cũng phục vụ. 🔴 **`rateHz` KHÔNG đổi nghĩa và KHÔNG đổi giá trị** — đó là điều kiện DỪNG của nhiệm vụ và nó không bị chạm. 🔴 **Nửa bất lợi, viết ngay cạnh:** chỗ lệch **4,17 %** của `WelderSim` **không được tạo ra và cũng không được sửa** ở đây (phép chuyển tính đúng cái `t` mà một bên tiêu thụ tuân hợp đồng đã tính hôm nay) — **nhưng nó chuyển `t` từ NGẦM sang ĐÃ VIẾT RA**, nên sửa chỗ lệch ấy về sau là **đổi những con số đã xuất bản**, không còn là đổi một tài liệu. Nhân chứng **MỚI** `WaveformPairAtTheWireBoundaryTests` (bảy `[Fact]`): gỡ phép chuyển ⇒ **BỐN đỏ**; trả kiểu hàng khác `double[]` ⇒ **SÁU đỏ**; 🔴 `WaveformSeriesRowShapeContractTests` **VẪN XANH, và đó là im lặng, không phải chấp thuận** — nó nhìn thượng nguồn |
| 15 | `DropOldest` + một cảnh báo "queue saturated" không với tới được — **BA chỗ**, và chỗ **thứ tư** đã giải xong | 🔴 **CHỜ ANH** — mở 2026-08-20 (AO-1). Gộp phát hiện đợt 6 (`HistorianWriter`) và đợt 8 (`UnsPublisher`) làm **MỘT mục**, và phép liệt kê thêm chỗ **thứ ba chưa ai báo**: `UnsBridge`. `AlarmNotifier` cùng chế độ nhưng **đã đúng** → 🔨 **QUYẾT: ÁP MẪU ĐÃ GIẢI XONG CỦA `AlarmNotifier` VÀO CẢ BA CHỖ** (2026-08-20, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục 8 — mục này không thuộc ba mục đổi thứ người ngoài đang dựa vào). 🔴 **`FullMode` **KHÔNG** đổi: `DropOldest` ở lại `DropOldest`** — thứ đổi là **kế toán**, không phải chính sách. **Đã thi hành, AP-1 (2026-08-21)**: `itemDropped` được truyền ở cả ba, cú đuổi được **đếm** và được **cảnh báo bằng lời SATURATION**, còn nhánh `if (!TryWrite(...))` — vốn chỉ với tới được khi writer ĐÃ ĐÓNG — được đếm riêng và viết lại thành lời **SHUTDOWN**. 🔴 **Tiền đề của phán quyết được KIỂM LẠI trên mã và nó ĐỨNG VỮNG**: `AlarmNotifier` thật sự đã giải xong (nó truyền `itemDropped`, phân loại năm đường rơi, log sau khi nhả khoá). 🔴 **Nhưng MỘT mảnh của hình dạng ấy KHÔNG mang sang được, và nói ra chứ không lặng lẽ bỏ:** phép *bracket* `Evicted` quanh `TryWrite` trong `EmitLocked` chỉ chính xác vì mọi thứ ở đó chạy dưới `_gate`; ba lớp EdgeCore **cố ý không có khoá nào trên đường enqueue**, nên cảnh báo được phát **từ trong chính callback `itemDropped`** — chính xác vì một lý do khác (callback chạy đồng bộ, một lần cho mỗi phần tử bị đuổi, và nhận đúng phần tử ấy). 🔴 **`UnsBridge.DroppedTotal` KHÔNG bị nới nghĩa**, và bề mặt ĐỌC nó được nêu tên: `GET /v1/site`, trang `/site`, **và bản ghi resync GIỮ LẠI phát lên broker của Site — một hợp đồng dây bên thứ ba tiêu thụ**. Cú đuổi kênh có tên riêng, `UnsBridge.ForwardQueueStats.Evicted`. 🔴 **Dư lượng còn mở, ghi vào mục chứ không để trong báo cáo: bộ đếm mới KHÔNG có trên `/v1/site` lẫn trang `/site`** — thêm một trường ở đó là **đổi payload đã xuất bản**, đúng thứ nằm ngoài uỷ quyền mục này. Trên hình thái cài Windows Service (README §"đường mất dữ liệu", mục 4) log **không có nơi nào để đi**, nên trên hình thái ấy mất mát này **được đếm nhưng operator vẫn chưa nhìn thấy được**. Xem Phần III |
| 16 | `OeeCalculator` — Quality **không** kẹp `[0,1]` | ✅ **ĐÃ THI HÀNH 2026-08-22 (AT-1)** theo 🔨 **PHÁN QUYẾT CỦA CHỦ SỞ HỮU ngày 2026-08-22: MỘT TRANSACTION** bọc bốn câu lệnh của `AggregateForOeeAsync` — **lựa chọn THỨ TƯ**, không kẹp/không ném/không để nguyên; `OeeCalculator` **không sửa một dòng mã**. 🔴 **Mục này CỐ Ý đổi một con số đã báo cáo, và nửa bất lợi ghi trong mục: OEE từ nay KHÁC OEE trước 2026-08-22 ở đúng những lúc trước đây sai — báo cáo đã in không đổi, nhưng ai so hai kỳ sẽ thấy một bậc nhảy không do sản xuất gây ra.** **Đo:** `deferred: true` (=`BEGIN` trần) giữ ảnh chụp qua một commit song song và **không chặn bên ghi** (0–1 ms); `BeginTransaction()` **không tham số** phát `BEGIN IMMEDIATE`, lấy khoá GHI cho một hàm chỉ đọc và làm bên ghi **hỏng hẳn** sau **33 121 ms** (`database is locked`) — **hai dạng cùng báo `Serializable`, nên TÊN mức cô lập không phân biệt được chúng**. Ba chỗ gọi **đều đồng bộ**: `GET /v1/historian/oee`, `GET /v1/historian/oee/fleet` (vòng lặp — mười máy = mười transaction/request), báo cáo PDF. **Nhân chứng đỏ được 5/5** ở cả hai đối chứng (gỡ transaction; đổi sang không-tham-số), xanh 8/8 sau sửa. 🔴 **Ba con số "Quality lớn nhất" của AQ-1 KHÔNG tái lập được** (đo lại: 1,25 và 1,0168, không phải 1,00333 và 1,00888) — chúng là tạo tác của cách gieo dữ liệu; ba con số "số lần vi phạm" thì tái lập được. 🔴 **Khẳng định đã công bố THỨ HAI mà AQ-1 ghi là "kiểm kê THIẾU" nay ĐÃ RÚT**: `web/src/lib/api.ts`. 🔴 **Và một khác biệt hồ sơ: phán quyết mục 16 KHÔNG có bản ghi tại chỗ ở BASE `ce1ce2be`** — `grep "2026-08-22"` trả đúng hai dòng, cả hai thuộc mục 27; nội dung phán quyết đến qua brief AT-1. Xem Phần III. **Câu trạng thái CŨ giữ nguyên văn ngay dưới:** 🔴 **CHỜ ANH** — mở 2026-08-20 (AO-1), đo bởi đợt 6. Biên hôm nay do **hai vị từ SQL ở một file khác** giữ. 🔴 **AQ-1 (2026-08-21) ĐƯỢC GIAO THI HÀNH MỤC NÀY VÀ ĐÃ DỪNG — điều kiện DỪNG trong brief đã NỔ, không một dòng `OeeCalculator` bị sửa, mục Ở LẠI PHẦN I.** Câu ngay trên **giữ nguyên văn**; cái được rút, tại chỗ và kèm ngày, là **chỉ** mệnh đề *"trên đường đang ship hôm nay con số ấy KHÔNG THỂ XẢY RA"* trong thân mục. **Đo được:** `AggregateForOeeAsync` chạy **bốn câu lệnh rời nhau trên một connection KHÔNG có transaction**; SQLite ở WAL cho mỗi câu lệnh **một ảnh chụp riêng**; nên hai vị từ lồng nhau chỉ giữ **trong một ảnh chụp**, và một `AppendResultsAsync` song song commit giữa câu `total` và câu `good` làm `GoodCount > TotalCount`. **Ba nhánh, đối chứng nằm trong phép đo:** không người ghi → **93 291 lần đọc, 0 vi phạm**; **10 hàng/giây — xấp xỉ nhịp của chính `fleet.json` đang ship** → **87 vi phạm**, Quality tới **1.00333**; người ghi nóng → **1 112 vi phạm**, Quality tới **1.00888**. **Nên một cái kẹp ĐỔI một con số OEE đã báo cáo, và đó là một trong ba mục chủ sở hữu KHÔNG uỷ quyền.** 🔴 **Và phép đo ĐỔI CÂU HỎI: mục mở ra như một câu hỏi phòng thủ chiều sâu, đo được nó là một khuyết tật ĐANG SỐNG — `Math.Clamp` không sửa nó, chỉ che nó. Bản sửa thật nằm ở `AggregateForOeeAsync` (đọc hai `COUNT(*)` trong MỘT transaction), tức một file khác, một rủi ro khác — LỰA CHỌN THỨ TƯ mà ba lựa chọn của mục không có.** 🔴 **Kèm một khẳng định đã công bố THỨ HAI vẫn đang sai và chưa được rút:** `web/src/lib/api.ts` nói `quality`/`oee` *"never … over 1 (`OeeCalculator.Calculate` clamps/guards every division)"* — đúng câu AL-1 đã rút trên doc lớp ngày 2026-08-20, ở **bề mặt khách hàng đọc**; một **bản kiểm kê THIẾU**, AQ-1 **không sửa** vì ngoài uỷ quyền |
| 17 | `QueryTelemetryAsync` không áp cổng xuất xứ, và ~~**không áp được**~~ | ✅ **ĐÃ THI HÀNH ĐẦY ĐỦ 2026-08-23 (BE-1)** theo 🔨 **PHÁN QUYẾT CỦA CHỦ SỞ HỮU 2026-08-23: MẶC ĐỊNH TẮT, CÓ THAM SỐ** — route trả **tất cả** như hôm nay; ai cần lọc thì truyền `includeFabricated=false`. Nửa **cơ chế** đã thi hành 2026-08-22 (AU-1) và ghi chép thi hành của AU-1 — kể cả nhãn *"một phần"* của nó — giữ **NGUYÊN VĂN** trong thân mục ở Phần III. Trước đó theo 🔨 **QUYẾT: ĐÓNG KHOẢNG TRỐNG XUẤT XỨ CỦA `QueryTelemetryAsync`** (2026-08-22, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục 8/15/21). 🔴 **VÀ TIỀN ĐỀ TRUNG TÂM CỦA MỤC NÀY — *"không áp được"* — KHÔNG SỐNG SÓT QUA PHÉP ĐO.** Nó áp được, bằng đúng cái mà chính mục nêu ra làm lý do nó không áp được: `historian_telemetry.result_id` khai `NOT NULL REFERENCES historian_results(id)`, nên **phép join tới xuất xứ là TOÀN PHẦN** — mọi hàng mẫu có đúng một hàng reading cha, và hàng cha ấy đã mang `is_fabricated`. **Không cần cột mới và KHÔNG THÊM CỘT NÀO; không có migration nào chạy trên cơ sở dữ liệu của khách hàng.** 🔴 **CÂU HỎI "hàng cũ mang giá trị gì" KHÔNG TỒN TẠI ở dạng brief đặt ra** — nó giả định cơ chế THÊM CỘT. Một hàng mẫu cũ mang **đúng cái cha nó mang**, và đó là một **phép đo**, không phải một giá trị phải chọn; ba trạng thái được **THỪA KẾ** chứ không phát minh, và trạng thái thứ ba (`NULL` = *Unknown*) đã có sẵn một luật xử lý đã quyết mà nhiệm vụ này **không được quyền quyết lại**. 🔴 **ĐIỀU KIỆN DỪNG ĐÃ NỔ, và nó nổ ở NỬA MẶC ĐỊNH:** đo được rằng nối route này vào `ResolveIncludeFabricated` **không làm hẹp phản hồi mà làm RỖNG nó** — `machine` là tham số **bắt buộc**, nên phép dò của cổng luôn chạy trong phạm vi **một máy**; với một máy mô phỏng bình thường trên một bản triển khai **không phải demo** (tức mọi bản cài sản phẩm) phép dò không thấy gì thật, và **toàn bộ** mẫu của máy ấy bị loại — biểu đồ xu hướng hôm nay có đường, ngày mai rỗng, vĩnh viễn. Đó đúng hình dạng hỏng mà `ResolveIncludeFabricated` tự ghi cho các route anh em trước Fix 1 (*"not 'narrower than intended,' literally zero"*). **Nên mặc định KHÔNG bị đổi và AU-1 KHÔNG tự quyết nó.** **Đã thi hành:** `QueryTelemetryAsync` nhận `includeFabricated` và **gọi CHÍNH `ApplyRealPresenceGateAsync`** qua `result_id IN (SELECT id FROM historian_results WHERE …)` — **không có bản sao thứ hai của luật**, nên luật không thể trôi khỏi read này lần nữa; khi `includeFabricated: true` câu lệnh phát ra **giống hệt từng ký tự** câu lệnh trước khi có tham số. `GET /v1/historian/telemetry` nhận `includeFabricated`, và **mặc định `?? true`** — **KHÔNG** dùng miễn trừ Demo, vì miễn trừ ấy tồn tại để **trả lại** hàng mà cổng lấy đi, và ở đây cổng không lấy gì. 🔴 **Nửa bất lợi, ghi ngay cạnh:** sau bản sửa này **HAI route hướng khách hàng VẪN trả lời khác nhau về cùng một câu hỏi** — `GET /v1/historian/results` giấu reading của máy bịa, `GET /v1/historian/telemetry` vẫn vẽ mẫu của chính máy ấy, và **không gì trong phản hồi nói cái nào là cái nào**. Chỗ lệch ấy **không do bản sửa tạo ra** (nó LÀ mục 17) nhưng bản sửa **không đóng** nó; cái mới là nó nay là **một quyết định một dòng xem lại được** thay vì một khẳng định cấu trúc rằng cổng *"không áp được"*. **Nửa còn nợ, nêu tên chứ không im lặng: chọn mặc định là việc CỦA ANH.** 🔴 **Kèm một khẳng định đã công bố được RÚT TẠI NGUỒN, không chỉ trong hồ sơ:** doc của `ApplyRealPresenceGateAsync` nói *"the one rule **every** customer-facing historian query/aggregate in this store applies"* — AL-1 đã rút câu ấy trong **file này** ngày 2026-08-20 nhưng **phép rút chưa bao giờ tới mã**, nên suốt hai ngày người đọc MÃ vẫn thấy câu sai. Nay sửa tại nguồn, kèm phép liệt kê thật (áp được: `QueryResultsAsync`, `QueryBySerialAsync`, `AggregateForOeeAsync`, `QueryTelemetryAsync`; **mặc định bật ở BA**). **Đo:** `EXPECT_ENGINEAPI` 1388 → **1395** (+7, đếm từ runner SAU khi viết), `EXPECT_WARNINGS` **328 KHÔNG dịch** (đo trên `-t:Rebuild` đầy đủ), `EXPECT_BUILD_NODES` 0, **0 lệnh đè**. **Cặp đối chứng chạy trọn rồi hoàn nguyên:** gỡ cổng ⇒ **4 đỏ**; lật mặc định ⇒ **đúng 1 đỏ** — 🔴 **và cái 1 ấy là một phát hiện: trước file test này, KHÔNG bài nào trong 2 804 bài thấy được phép lật mặc định.** 🔴 **Một lỗi của chính AU-1 bị chính bài test của AU-1 bắt:** bản nháp thêm tham số vào endpoint mà **quên truyền nó xuống store**, nên mặc định rơi về cổng-BẬT — tức đúng thứ điều kiện DỪNG cấm; bắt được lúc chạy, không phải lúc đọc. Xem Phần III. **Câu trạng thái CŨ giữ nguyên văn ngay dưới:** 🔴 **CHỜ ANH** — mở 2026-08-20 (AO-1), đo bởi đợt 6. `historian_telemetry` **không có cột `is_fabricated`**; `GET /v1/historian/telemetry` **không nhận `includeFabricated`** 🔴 **PHÁN QUYẾT 2026-08-23, VÀ GIÁ GHI CẢ HAI CHIỀU.** *Chiều thuận:* mặc định này **giữ nguyên hành vi hôm nay**, nên **không bản cài nào mất dữ liệu** — đúng cái mà phép đo *"3 mẫu ⇒ 0 mẫu"* ở §6 thân mục buộc phải tránh. *Chiều nghịch, không mềm hoá:* dữ liệu **giả và thật vẫn TRỘN theo mặc định**, và **hai route hướng khách hàng vẫn trả lời khác nhau về cùng một câu hỏi trên cùng một máy** — **đó là điều chủ sở hữu đã chấp nhận**, không phải điều chưa ai nhận ra. 🔴 **PHÁT HIỆN MỚI (BE-1): BỀ MẶT KHÔNG NÓI ĐƯỢC RẰNG CÁI RỖNG LÀ DO LỌC.** Ai truyền tham số trên một máy mô phỏng ở bản cài không-demo nhận về `[]` **và không được cho biết tại sao**: route trả một **mảng JSON trần**, không envelope, không `Total`, không dội lại cờ, và `TelemetryPointDto` chỉ khai `At`/`Value` — **không trường xuất xứ nào**. **BỐN** tình huống cho **MỘT** phản hồi giống nhau từng byte. 🔴 **Và nêu ở đúng bề rộng của nó, vì một cái trần nêu quá nhỏ còn tệ hơn không nêu trần: đây KHÔNG phải khuyết tật riêng của route này.** Route anh em `GET /v1/historian/results` **cũng không nói được** — nó mang xuất xứ **từng hàng ĐÃ VỀ**, nhưng một nhãn trên hàng đã về không nói gì về hàng **đã bị loại**, và `Total` đếm tập **được nhận**. **Không một bề mặt historian nào trong sản phẩm này diễn đạt được *"rỗng VÌ bị lọc"*** — hình dạng **mục 28**, để ngỏ có chủ ý. **Không hằng số nào dịch vì mục 17**; nhân chứng đỏ được là `Default_WithNoExplicitValue_…_LegacyContinuity` của **AU-1**, chạy lại ở ngọn nhánh BE-1 rồi **hoàn nguyên**. Lập luận đặt-lại-đúng-phần của AW-1 giữ **NGUYÊN VĂN** ở đầu thân mục, không chép lại ở ô này. Xem thân mục ở **Phần III** |
| 18 | Cổng Demo gác **CHẾ ĐỘ**, không gác **BỘ SINH GIẢ** | ✅ **ĐÃ THI HÀNH 2026-08-21 (AR-1)** — cổng nay gác **CẢ HAI** route dựng transport bịa (`POST /v1/scenario` **và** `POST /v1/scenario/preset`; mục chỉ nêu một). Xem Phần III |
| 19 | `TransportCoordinator.Auto` và `.Demo` — hai trong bốn bộ truy cập công bố **không ai đọc** | ✅ **ĐÃ THI HÀNH 2026-08-21 (AR-1)** — **KHÔNG gỡ thành viên nào**; hai câu tài liệu SAI đã sửa, và **khoá KHÔNG bỏ được** (đo rồi mới từ chối). Xem Phần III |
| 20 | `TransportCoordinator` không có đường tắt máy ⇒ `LiveTransport` cuối cùng không bao giờ được dispose | ✅ **ĐÃ THI HÀNH 2026-08-21 (AR-1)** — `IDisposable` + nhân chứng đỏ được. **Cái trần "không phải rò rỉ sản xuất" giữ nguyên.** Xem Phần III |
| 21 | `MappingProfileResolver` ghép một chuỗi của vận hành viên vào một đường dẫn **không giới hạn** | 🔴 **CHỜ ANH** — mở 2026-08-20 (AO-1), đo bởi đợt 7 → 🔨 **QUYẾT: GIAM VÀO THƯ MỤC HỒ SƠ** (2026-08-21, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục 8 và mục 15 — mục này không đổi payload MQTT, không đổi hình dạng dây, không đổi con số OEE nào). **Đã thi hành, AQ-1 (2026-08-21)**: `ResolveOne` chuẩn hoá **tuyệt đối** cả hai vế (`Path.GetFullPath`) rồi đòi đường dẫn ghép nằm trong gốc **cộng dấu phân tách cuối**; **không chỗ nào lọc `..` bằng chuỗi**. Từ chối rơi về `MappingProfile.ForClass` — **cùng chỗ rơi** ba nguyên nhân cũ — kèm thông điệp trên `logWarning` nêu tên máy, giá trị, thư mục giới hạn và **một giá trị hợp lệ trông thế nào**. 🔴 **Bản giam CỐ Ý không hẹp hơn mức cần: thư mục CON của thư mục mapping vẫn nạp được**, vì chính mục này nêu thư mục con là bản triển khai một bản sửa không được làm hỏng. 🔴 **Hai câu của mục KHÔNG sống sót qua phép đo, và cả hai được ghi ở thân mục:** (i) *"chuỗi ấy đến từ `fleet.json`"* — **đúng, và nay ĐO ĐƯỢC**: cả sáu chỗ dựng `MachineDescriptor` dưới `src/` cộng `BuildDefaultFleet` đều truyền `MappingProfile: null`, nên **không route/connector/biến môi trường nào** đặt được trường này; (ii) *"`fleet.json` … nằm **cục bộ**"* — **thiếu**: `ResolveFleetPath` nhận **`--fleet <path>` TRƯỚC** `AppContext.BaseDirectory`, nên "cục bộ" là mặc định chứ không phải ràng buộc. 🔴 **Biên của bản sửa, ghi chứ không giấu: biên là TỪ VỰNG** — một symlink **nằm trong** thư mục mapping trỏ ra ngoài **vẫn được đi theo**; và câu *"không bản triển khai hợp lệ nào bị làm hỏng"* chỉ đúng trên tập **repo này ở `HEAD`**, không phải đĩa của khách hàng. Xem Phần III |
| 22 | Hai chuỗi đã xuất bản hứa một ack **thất bại** mà `DemoTransport` không bao giờ trả | ✅ **ĐÃ THI HÀNH 2026-08-21 (AR-1)** — 🔴 **KHÔNG phải hai chuỗi mà SÁU** (cộng bốn chuỗi i18n web chưa đụng). Sửa lời, không đổi hành vi. Xem Phần III |
| 23 | `IUnsPublisher.PublishBirth`/`PublishDeath` — có cài đặt, **không caller nào dưới `src/`** | ✅ **ĐÃ GỠ 2026-08-21 (AR-1)** theo **phán quyết chủ sở hữu**; tiền đề "không caller" đã đo lại **toàn cây gồm `server/`/`client/`/`examples/`** và **đứng vững**. Giá P-2 ghi trong mục |
| 24 | `ModbusOptions`/`OpcUaOptions` — hằng số TÊN biến môi trường công khai | ✅ **ĐÃ THI HÀNH 2026-08-21 (AR-1)** — phép đo đã sửa **tự kiểm lại và ĐỨNG VỮNG cả hai nửa**; hai file test nay gọi hằng số thay vì gõ lại chuỗi. Xem Phần III |
| 25 | **Điều kiện rời Phần II của mục 12** — họ driver: tài liệu hay thu hẹp? | 🔴 **CHỜ ANH** — mở 2026-08-20 (AO-1). 109 cảnh báo trên **97 thành viên**; câu hỏi *"có nên `public` không"* **không tồn tại với 46**, ~~**sai trong im lặng với 9**~~, miễn phí với 17, tốn một IVT mới với 25 — và 🔴 **ít nhất 55 trong 97 sẽ `public` DÙ PHÁN THẾ NÀO**. 🔨 **PHÁN QUYẾT 2026-08-22 (chủ sở hữu): VIẾT TÀI LIỆU CHO CẢ 97, KHÔNG ĐỔI MỘT MỨC TRUY CẬP NÀO** — nên câu hỏi ở tiêu đề mục này **đã được trả lời**, và cái còn treo là **tiến độ**, ghi ở mục 12. 🔴 **Ở LẠI PHẦN I** cho tới khi phán quyết ấy thi hành xong. **ĐÍNH CHÍNH 2026-08-22 (AY-1), đo trên trình biên dịch, bảng KHÔNG bị xoá một chữ:** `A2 = 5` **đứng vững**; hàng `B = 9` **đúng như phép đếm thành viên và SAI như phép đếm cơ chế** — **bốn** trong chín là `required`, và thu hẹp một thành viên `required` là **lỗi biên dịch CS9032**, không phải nạp mặc định im lặng, nên số thành viên **sai trong IM LẶNG là 5** (`ModbusRegisterMap.UnitId`/`.PollIntervalMs`, `OpcUaNodeMap.SecurityMode`/`.Password`/`.PollIntervalMs`); **câu "ít nhất 55" KHÔNG đổi** (46 + 4 bị NGÔN NGỮ từ chối = 50, cộng 5) và **hai ví dụ mục này nêu đích danh nằm trọn trong 5 ấy**. **Phân loại 84/13/0 kiểm lại trên cụm đợt 9: 23/2/0, con số 0 TÁI LẬP.** **Tiến độ: 25 trong 109 đã viết (đợt 9), 84 còn nợ.** Xem §"Đính chính 2026-08-22" trong thân mục. 🔴 **CÂU "Tiến độ" NGAY TRÊN LÀ CỦA ĐỢT 9 VÀ ĐÃ CŨ HAI ĐỢT — giữ nguyên văn, thay bằng dòng dưới đây (BB-1, 2026-08-22):** đợt 10 trả thêm **21** và đợt 11 trả thêm **25**, nên **tiến độ thật: 71 trong 109 đã viết, 38 còn nợ trên 32 thành viên**. Ô này **không được cập nhật bởi đợt 10**, và đó là đúng hình dạng mục 37 tồn tại để bắt: một trường trạng thái đi cũ trong im lặng vì không cổng nào đọc *nội dung* của nó. **ĐÍNH CHÍNH 2026-08-22 (BB-1):** hàng **`A1 = 41` ĐỨNG** (cụm đợt 11 là **20** của nó); 🔴 **bảng KHÔNG có hàng nào cho CONSTRUCTOR** và riêng cụm ấy có **5** — thu hẹp một constructor **biên dịch được**, và với `HotFolderAoiDriver` nó là **C3** (một bộ dựng sản xuất nằm ngoài `St4i.EdgeCore`); **phân loại kiểm lại: 25/0/0 — số 0 tái lập lần thứ NĂM**, đợt đầu ra 0 cả lớp 2. Xem §"Đính chính 2026-08-22 (BB-1)" trong thân mục 🔴 **ĐÃ THI HÀNH XONG 2026-08-22 (BC-1): điều kiện mà ô này tự đặt — *"Ở LẠI PHẦN I cho tới khi phán quyết ấy thi hành xong"* — ĐÃ THOẢ.** Đợt 12 trả **38** chỗ cuối; **25 + 21 + 25 + 38 = 109** trên 97 thành viên; `EXPECT_WARNINGS` **328 → 219**; **hai hàng sổ tài liệu về 0**; **0 mức truy cập đổi trong cả bốn đợt**. Câu hỏi ở tiêu đề mục — *"tài liệu hay thu hẹp?"* — **không còn treo**, nên mục **RỜI PHẦN I SANG PHẦN III**. **Tiến độ: 109/109 đã viết, 0 còn nợ.** **KIỂM LẦN THỨ TƯ trên 32 thành viên cuối: `30 / 2 / 0` — số 0 tái lập lần thứ SÁU**, và đợt 12 ghi vì sao đó là một phát hiện về **LUẬT** chứ không phải về cụm. 🔴 **ĐÍNH CHÍNH/MỞ RỘNG 2026-08-22 (BC-1):** hàng **`A1 = 41` ĐỨNG** và cụm cuối là **13** của nó; 🔴 **cột trống CONSTRUCTOR mà BB-1 mở nay là cột lớn nhất còn lại — 15 trong 32** (14 `public` + ctor `protected` của `SimulatorBase`), và với **tám constructor simulator** thu hẹp là **C1 — miễn phí về IVT**, vì mọi lời gọi trực tiếp `new XSim(...)` nằm trong test và đường sản xuất duy nhất là `SimulatorFactory.Create` **cùng assembly**. **Đây là một PHÁT HIỆN ĐƯA LÊN, KHÔNG phải một hành động.** Xem §"ĐÃ THI HÀNH 2026-08-22 (BC-1)" trong thân mục |
| 26 | **Không gì trong repo này trả cho TÍNH ĐÚNG của một chú thích đã viết** | 🔴 **CHỜ ANH** — mở 2026-08-20 (AO-1). Mục 12 trả cho **bao phủ**; W-1 kiểm **hình thức**. Năm con số đã đo — **KHÔNG cộng được**, và mục nói vì sao → ✅ **ĐÃ THI HÀNH 2026-08-22 (AW-1)** theo 🔨 **QUYẾT: DỰNG BỘ LỌC PHỦ ĐỊNH PHỔ QUÁT THÀNH MỘT DỤNG CỤ CHẠY ĐƯỢC** (2026-08-22, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục 8/15/17/21). `scripts/scan-doc-negations.sh` — hình dạng **suy từ cách hỏng đã đo**, không phát minh: đúng năm từ mà đợt 6, 7, 8 dùng và đều bắt được (*nothing · never · every · only · no code*), cộng phép chạy lại sau từng câu, nay là chế độ `--since <ref>` **đỏ được**. 🔴 **Năm con số của mục đã kiểm lại từng cái trên thân mục và cả năm ĐỨNG VỮNG** (101 · 17/48 · 5 trên 129 **cảnh báo** · 13/199 · 12/287), và lý do không cộng được vẫn nguyên. 🔴 **Phép đo mới, và nó là một CÁI TRẦN chứ không phải một món nợ: bộ lọc ấy quét toàn cây gắn cờ 5 780 câu trên 15 965 câu chú thích, ở 481 trong 545 file `.cs` — HƠN MỘT PHẦN BA mọi câu chú thích trong cây.** Liệt kê trước (`--census` in ra từng câu), con số viết sau. **Không nhiệm vụ nào trả được tập ấy**, và **cố ý KHÔNG có cổng toàn cây**: một cổng trên con số đó sẽ đỏ với mọi lần sửa tài liệu, tức đúng *"dụng cụ không có định nghĩa xanh"* mà chính mục này cảnh báo. 🔴 **Cái dụng cụ KHÔNG cưỡng chế, nêu đủ rộng: nó KHÔNG phải một cái máy phân biệt đúng-sai** — nó chỉ chọn câu để người đọc, và phần lớn câu bị gắn cờ là **đúng**; **độ nhạy của nó vẫn CHƯA BIẾT** (đợt 7 vòng 2 bắt thêm 6 cái vòng 1 mù; đợt 8 vòng 2 bắt thêm 5), và loại tệ nhất — một câu **không chứa từ tuyệt đối nào** mà khẳng định một **mục đích** hay một **cơ chế** — nằm ngoài nó hoàn toàn; nó chỉ đọc `.cs` **của ta** (`web/`, `server/`, `client/` và file SDK vendored ở ngoài). Xem Phần III |
| 27 | API Inspector **không phơi THÂN request** | ✅ **ĐÃ THI HÀNH 2026-08-22 (AT-1)** theo 🔨 **PHÁN QUYẾT CỦA CHỦ SỞ HỮU ngày 2026-08-22: BỀ MẶT MỚI** (phán quyết ấy đọc được trong thân mục). Bề mặt mới = record `ApiTraceBody` + route `GET /v1/inspector/bodies` (cùng `Policies.Engineer` với luồng WS). 🔴 **BA bề mặt đã xuất bản KHÔNG dịch một byte, chứng minh bằng diff: `ApiTraceEvent.cs`, `ApiInspector.tsx`, `inspector.ts`, `InspectorViewModel.cs`, `ApiInspectorView.xaml`, `TraceTable.tsx` — 0 dòng đổi ở mỗi file**; `ApiTraceEvent` giữ đúng mười thành phần và `EventBus.Traced` vẫn mang một `ApiTraceEvent`. **Trần kích thước ĐO rồi mới chọn: 16 KiB/thân**, vì thân thật của bộ sinh hôm nay là **1 314 byte** (24 mẫu) / **1 207** (20 mẫu) / **255** (telemetry), còn sóng **100 000 mẫu** = **2 169 909 byte** và **BỊ cắt** kèm cờ `Truncated`; ngân sách thật là **500 × 16 KiB = 8 MiB**. **Danh sách CHO PHÉP có BẢY khoá**; che `serialNumber`, `recipe`, `metrics`, `waveforms`, `measurements`, `samples` **và mọi khoá genealogy (do cấu trúc)**, mỗi cái **nêu tên** trong `WithheldKeys`. 🔴 **Một lỗ rò của chính bản sửa bị bắt bởi chính bài test của nó: `idempotencyKey` từng nằm trên danh sách cho phép, nhưng `BuildIdempotencyKey` dựng nó từ MÃ CÔNG THỨC và (hình dạng inspection) SỐ SERIAL** — nay là `IdempotencyDigest` (SHA-256, 16 hex), và giới hạn được nêu: **phi-định-danh, không phải bí mật**. **Vòng đời thân nằm trong vòng đời trace DO CẤU TRÚC** — một hàng đợi cặp, đuổi cùng một `Dequeue`. 🔴 **Đóng MỘT PHẦN: không dụng cụ UI nào được thêm** — bề mặt mới là một route, và **không chạm `web/` là CỐ Ý**, vì `handleExport` sống trong `ApiInspector.tsx`. Xem Phần III. **Câu trạng thái CŨ giữ nguyên văn ngay dưới:** 🔴 **CHỜ ANH** — mở 2026-08-20 (AO-1), đo lại từ mã 2026-08-20. `ApiTraceEvent` **không có trường thân**; `TraceTable` **không có trình xử lý click hàng nào**. 🔴 **AS-1 (2026-08-21) ĐƯỢC GIAO THI HÀNH MỤC NÀY VÀ ĐÃ DỪNG — điều kiện DỪNG của brief đã NỔ: `ApiTraceEvent` rời tiến trình trên BA bề mặt đã xuất bản, nên thêm một trường thân LÀ đổi hình dạng một payload đã xuất bản. Không một dòng nào bị sửa cho mục này; mục Ở LẠI PHẦN I.** Kèm hai phép đo BÁC hai tiền đề của brief: thân request đi ra **KHÔNG mang khoá `mk_`** (khoá đi bằng header), và sóng hàn hôm nay là **24 mẫu**, không phải 100.000. → 🔨 **QUYẾT: BỀ MẶT MỚI** (2026-08-22, **chủ sở hữu**) — một đường RIÊNG cho thân request; khung WS và **hai** file JSON xuất **giữ nguyên hình dạng**. 🔴 **Phép DỪNG của AS-1 là thứ TẠO RA phán quyết này**: nếu cứ thêm trường thì đã đổi ba payload đã xuất bản, hai trong đó **không đo được ai đang đọc**. 🔴 **Ở LẠI PHẦN I** — phán quyết đã có, **ghi chép thi hành CHƯA**; một nhiệm vụ khác thi hành. Ba điều kiện che (trần byte + dấu hiệu đã cắt, che ở chỗ dựng sự kiện, **danh sách CHO PHÉP**) **KHÔNG được miễn**. Xem thân mục |
| 28 | ~~**BA** cái trần~~ **BỐN** cái trần trên lịch sử API-trace, và **không cái nào được UI gọi tên là trần** | ✅ **ĐÃ THI HÀNH 2026-08-21 (AS-1)** — 🔴 **KHÔNG phải ba mà BỐN**: mục bỏ sót vòng đệm của chính vỏ WPF (`InspectorViewModel.MaxEvents`). Cái trần backfill nay **CÓ TÊN** (`InspectorStreamEndpoint.BackfillEventCount`) thay vì một literal `200`; pane web nay **gọi tên** ba cái trần áp vào nó và nói **cái nào chặn khi nào**. Đổi lời, không đổi hành vi. Xem Phần III |
| 29 | Cả fleet liên kết ra ngoài bằng **MỘT danh tính thiết bị** | ✅ **ĐÃ THI HÀNH 2026-08-21 (AS-1)** — 🔴 **và CƠ CHẾ mà mục mô tả KHÔNG đứng vững: route KHÔNG "trả 200 cho việc nó không làm"** — nó thật sự lưu khoá, câu *"Pasted mk_ key stored for WELD-01"* là **ĐÚNG**; cái sai là suy luận nó mời người đọc rút ra. Nên bản sửa là **sửa câu, không sửa mã trạng thái** — một 4xx sẽ từ chối một cú ghi có thật và lấy đi đúng đường mà chính mục nêu là hợp lệ. 🔴 **Và mục nêu THIẾU một bề mặt: có HAI biểu mẫu web POST route ấy, không một.** Cái trần vendored giữ nguyên. Xem Phần III |
| 30 | Gốc mặc định của ~~bốn~~ **BA** store cạnh-binary là `%ProgramFiles%`, và **lần chạy đầu chính là lần GHI** | 🔴 **CHỜ ANH — VÀ NAY CÓ MỘT PHÉP ĐO THỰC TẾ ĐI KÈM.** Mở 2026-08-20 (AO-1). Câu hỏi này **bị nhiều brief liên tiếp CẤM mở**; lệnh cấm hết hiệu lực ở nhiệm vụ AV-1. 🔴 **AV-1 (2026-08-22) ĐƯỢC GIAO THI HÀNH VÀ ĐÃ DỪNG: điều kiện DỪNG *"bản sửa cần DI CHUYỂN dữ liệu vận hành viên đã có"* NỔ** — xem khối phép đo trong thân mục, ở **Phần I**. 🔴 **Và chữ "bốn" ở ô này là một phép ĐẾM THIẾU CHÍNH XÁC theo chiều ngược**: quần thể là **BA store** sinh **NĂM file**, trong đó cổng miễn trừ đích danh **BỐN**. Thân mục đã viết đúng "ba store" từ đầu; ô tóm tắt này đếm nhầm file thành store, và lời giao việc của AV-1 thừa hưởng chữ ấy 🔴 **PHÁN QUYẾT CỦA CHỦ SỞ HỮU 2026-08-23: CHUYỂN GỐC SANG `%ProgramData%`** — chủ sở hữu **đã được nêu** rằng một bản cài ĐÃ TỒN TẠI sẽ thôi thấy dữ liệu ở gốc cũ và **vẫn chọn hướng này**. 🔴 **Mục Ở LẠI PHẦN I vì phép chuyển CHƯA được làm, KHÔNG vì thiếu phán quyết** — đây là một giới hạn dung lượng của nhiệm vụ BE-1, **không phải một điều kiện DỪNG**. **Phép đo điều-kiện-tiên-quyết đã trả, và nó BÁC tiền đề của chính câu hỏi:** bốn miễn trừ ở cổng trỏ theo **TÊN (basename)**, không theo **ĐƯỜNG DẪN** — `outdir_snapshot` cắt `sub(/^.*\//, "", p)` rồi mới tra, và danh sách tên được **RÚT RA từ chính nguồn hai store**; quan sát trực tiếp trên một lần chạy cổng đầy đủ: `exempt: products.json recipes.json ecosystem-products.json ecosystem-recipes.json`. 🔴 **Nhưng đổi gốc VẪN làm hỏng cổng qua một cửa câu hỏi không nêu tên:** cả `verify-suites.sh` lẫn `OwnOutputDirectoryGuard` **FAIL tường minh** ngay khi hai store ấy khai `EnvVarDir` — mà seam là **bắt buộc**, vì **20 lớp test dựng `WebApplicationFactory`** giải chúng qua DI thật và nếu không có seam thì suite bắt đầu ghi vào **`%ProgramData%` THẬT** (không dụng cụ nào hôm nay gác chỗ ấy — hai bracket credential chỉ canh `…\sim\creds`). **Khuôn dùng lại, và một PHÁT HIỆN:** dùng lại **nửa giải gốc** của `CredentialStore` (`DefaultRoot`/`EnvVarDir`/`ResolveRoot` explicit>env>default + `CreateDirectory`), **KHÔNG** dùng lại `SecurityDirAcl.Apply` — nó gỡ quyền đọc của `Authenticated Users` và sẽ **KHOÁ VẬN HÀNH VIÊN RA NGOÀI** chính bốn file mà cổng gọi là *"operator-editable"*. **Ba hướng đo giá, chọn một:** *(b) dự phòng khi đọc* **LOẠI** (không bao giờ hội tụ; hai gốc phân kỳ lặng lẽ = mất dấu ở dạng chậm); *(c) chỉ đổi gốc + log* **LOẠI làm giải pháp đứng một mình** (kênh giao hàng là stderr của một service, không ai đọc); ✅ *(a) **DI TRÚ MỘT LẦN**, chép nếu gốc mới trống, **KHÔNG XOÁ BẢN CŨ*** (miễn trừ di-chuyển của mục 10 **chỉ áp cho mục 10**), cộng dòng log của (c) — kèm một cái bẫy phải đóng: nguồn di trú là `AppContext.BaseDirectory`, **không dời được**, nên phép chép **chỉ chạy khi gốc giải ra từ MẶC ĐỊNH**. 🔴 **GIÁ THẬT, đo chứ không ước: một dòng mã kéo theo MƯỜI SÁU artefact** bị bốn dụng cụ điều tra dân số **cưỡng chế đi cùng nhau** (`DefaultRoot_IsBesideTheBinary_AndIsNotUnderProgramData` đỏ theo cấu trúc — **thông điệp hỏng của nó chính là bản kê việc**; `PerHostDataRootsTests` dòng 602 đỏ vô điều kiện; chữ `thirteen` ở README §15.9 và `remove-data.ps1` bị **ghim bằng test** nên phải thành `sixteen` cùng lúc). 🔴 **VÀ MỘT PHÁN QUYẾT PHỤ CHƯA AI NÊU, nêu ra chứ không để nó tự xảy ra:** `NotificationDocumentationTests` **đòi** mọi thư mục `…\sim\<leaf>` phải bị `packaging/remove-data.ps1` **xoá**, nên chuyển bốn file vận hành viên vào đó **tự động đưa chúng vào tầm lệnh xoá khi ngừng sử dụng** — trong khi hôm nay script ấy **cố ý** không đụng chúng và tự khai thế. **Một đường mất dữ liệu MỚI, phải được quyết tường minh.** Xem khối `BE-1` trong thân mục 🔨 **ĐÃ THI HÀNH 2026-08-23 (BF-1) — trên HAI phán quyết của CHỦ SỞ HỮU cùng ngày: (a) CHUYỂN GỐC SANG `%ProgramData%`, và (b) MIỄN TRỪ BỐN FILE CẤU HÌNH KHỎI LƯỢT XOÁ CỦA `remove-data.ps1`** — *"cấu hình do vận hành viên soạn KHÔNG phải dữ liệu vận hành; nó là thứ họ DỰNG LÊN"*. Ba lá mới `%ProgramData%\ST4I\sim\{products,ecosystem,machine-config}`; quần thể toàn máy **13 → 16 thư mục và 13 → 16 biến**, quần thể cạnh-binary **RỖNG và được GHIM ở số không**. **CHÉP MỘT LẦN, KHÔNG XOÁ BẢN CŨ**, gác trên điều kiện gốc BẰNG `DefaultRoot()`; chỉ **nửa giải gốc** của credential store được dùng lại, `SecurityDirAcl` **không**. `remove-data.ps1` xoá **14/16** và **GIỮ** `products` + `ecosystem`. 🔴 **Một khẳng định đã công bố bị RÚT:** `NotificationDocumentationTests.EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript` đòi **mọi** lá phải bị xoá; nay đòi mọi lá **hoặc bị xoá hoặc được GIỮ có nêu tên kèm lý do**, tập giữ **ghim đúng bằng** `{ecosystem, products}`. 🔴 **MƯỜI LĂM artefact dịch cùng nhau, KHÔNG phải mười sáu** — con số của BE-1 đo lại không sống sót: `TestHarnessIsolationTests.cs` **không phải dịch**, vì phép ghim của nó suy tập ra từ `src/` nên nó tự xanh lại khi `playwright.config.ts` dịch (commit hai mươi mốt file — ba con số, ba câu hỏi, xem thân mục §4). **Mục rời PHẦN I → PHẦN III**, và với nó **PHẦN I TRỐNG** — lần đầu cả hai phần chờ-quyết cùng trống kể từ khi file này được lập. Xem khối `BF-1` trong thân mục |
| 31 | **Mười hai artefact build** (7 `.xml` + 5 `.pdb`) đi vào MSI | ✅ **ĐÃ QUYẾT VÀ ĐÃ THI HÀNH 2026-08-22 (AV-1)** theo 🔨 **QUYẾT: GIAO CẢ MƯỜI HAI, KHÔNG ĐỔI MỘT BYTE NÀO CỦA BAO BÌ** (2026-08-22, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục 8/15/17/21). Mở 2026-08-20 (AO-1); đã ĐO ở §8 của mục 12 từ 2026-08-19 (AF-1) nhưng **chưa bao giờ thành một mục phán được**. **N = 12 đo lại và ĐỨNG VỮNG.** 🔴 **Nhưng câu *"cái giá của việc GIỮ NGUYÊN là KHÔNG"* trong thân mục KHÔNG sống sót qua phép đo**: năm `.pdb` mang đường dẫn tuyệt đối của máy dựng, **259 tên file nguồn phân biệt** (266 cộng rời), và một bản đồ SourceLink nêu đích danh **kho GitHub + SHA commit**. Giá được ghi tên chứ không còn là "không". Xem **Phần III** |
| 32 | **Một lời khai miền dụng cụ không kiểm được nếu không ghi NƠI lệnh được chạy** | 🔴 **CHỜ ANH** — mở 2026-08-20 (AO-1). Pathspec của git là **tương đối với cwd** và một pathspec bị thu hẹp **trả 0 chứ không báo lỗi**: `-- 'server/*.ts'` **0** đối lại `-- ':(top)server/*.ts'` **197**; và **glob đuôi trần cũng hỏng** — `'*.ts'` **1** đối lại **214**. 🔴 **Giá đã trả: mục 14 được PHÁN kèm một cái trần SAI** (*"không đo được từ repo này"* — bên tiêu thụ nằm trong chính commit này). **Năm khẳng định khác đo lại vẫn ĐỨNG VỮNG**, gồm kết luận "ba chỗ xuất bản `TransportMode`" của AM-1. **Người đăng ký gương MQTT retained: CHƯA ĐO** (37 file nhắc `syn/`) → ✅ **ĐÃ THI HÀNH 2026-08-22 (AW-1)** theo 🔨 **QUYẾT: DỰNG MỘT BỌC CƯỠNG CHẾ CHO MIỀN PHÉP QUÉT** (2026-08-22, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục 8/15/17/21). `scripts/repo-scan.sh` — **không phải một dòng hướng dẫn**: nó **tự `cd` về gốc repo**, **tự viết lại mọi pathspec trần thành `:(top)…`**, **luôn truyền `--full-name`** (nửa thứ hai, do mục 15 tìm ra), **phân giải tree-ish thành SHA đầy đủ** và **in ra lời khai miền cùng kết quả**: nơi lệnh được gõ, nơi nó chạy, SHA, cây sạch hay bẩn, pathspec trước và sau khi viết lại, argv, và số dòng. Một `0` từ nó **đọc được là "không có"**. 🔴 **`--self-test` là nhân chứng và nó ĐỎ ĐƯỢC:** ba khẳng định — bất biến theo cwd, **và** phép dò phải khác 0, **và** dạng ngây thơ phải trả ÍT HƠN; hai số 0 bằng nhau bị **từ chối** là xanh. Đo hôm nay ở `e99019c0`: **197 = 197** qua bọc, **0** cho dạng ngây thơ gõ từ `tools/machine-simulator`. 🔴 **Cái nó KHÔNG cưỡng chế, và nêu đủ rộng vì một cái trần nêu quá nhỏ còn tệ hơn không nêu:** (a) **nó KHÔNG buộc được ai dùng nó** — không gì chặn người sau gõ `git grep` tay; nó là một **mặc định** và một **nhân chứng**, không phải một cổng trên cách người ta gõ; (b) **nó không thấy được `grep -r`/ripgrep/tìm-trong-editor**, vốn đọc **cây làm việc**, mà cây này là sparse — `server/` (1589 file) và `client/` (711) **có trong commit, không trên đĩa**; (c) nó không kiểm được rằng một báo cáo có chép lại phần đầu ấy hay không; (d) nó không nói gì về việc **mẫu tìm** có đúng hay không; (e) nó **không với ra ngoài repo** — người đăng ký gương MQTT retained `syn/…` **vẫn CHƯA ĐO** và vẫn nằm ngoài mọi phép quét dụng cụ này chạy được. 🔴 **Giá đã trả giữ nguyên trong hồ sơ và được ghi lại lần nữa ở đầu chính dụng cụ:** mục 14 được chủ sở hữu **phán kèm một cái trần SAI** — *"người tiêu thụ không đo được từ repo này"* — trong khi mã bên tiêu thụ nằm trong đúng commit ấy. Xem Phần III |
| 33 | `GET /v1/scenario` nói dối theo chiều **NGƯỢC LẠI** — tấm gương của mục 18 | ✅ **ĐÃ QUYẾT VÀ ĐÃ THI HÀNH 2026-08-22 (AV-1)** theo 🔨 **QUYẾT: SỬA PHÍA ĐỌC — `GET /v1/scenario` BÁO TRANSPORT ĐANG LẮP** (2026-08-22, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục 8/15/17/21). Mở 2026-08-22 (AU-1). Một `PUT /v1/mode` **ghi đè transport outage** trong khi `_scenario.NetworkOutage` **vẫn `true`**; mục 18 đóng chiều *"cổng không gác"*, chiều này nay đã phán. 🔴 **Tập ghi rộng hơn brief nêu: KHÔNG chỉ `PUT /v1/mode`** — `PUT /v1/settings` cũng xoá, một `PUT /v1/mode` **không đổi giá trị** cũng xoá, và chuyển **sang Demo** cũng xoá; **cả ba đo lại và ĐỨNG VỮNG**, mỗi cái một nhân chứng đỏ-được. 🔴 **Hướng bị loại là sửa phía GHI, và giá của nó ghi tại chỗ.** 🔴 **Nó BÁC một lập luận AR-1 đã dùng để đóng nửa kia của mục 18** — lập luận ấy đã rút tại chỗ trong ghi chép thi hành của mục 18. Xem **Phần III** |
| 34 | Bốn chuỗi web i18n còn nợ từ mục 22 | 🔴 **CHỜ ANH** — mở 2026-08-22 (AU-1), xác nhận lại trên mã: **đúng bốn**, hai khoá × hai locale, và cả bốn **đang hiển thị cho vận hành viên**. `DemoTransport` **không có đường nào** trả ack thất bại. 🔴 **Web của machine-simulator KHÔNG có job CI nào và KHÔNG có dụng cụ i18n nào** — bốn chuỗi này không có nhân chứng thuộc bất kỳ loại nào → ✅ **ĐÃ THI HÀNH 2026-08-22 (AX-1)** theo 🔨 **QUYẾT: SỬA LỜI CHO KHỚP CÂU MỤC 22 ĐÃ VIẾT** (2026-08-22, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục 8). **Bốn** đứng vững — hai locale là một sự thật CỦA KIỂU (`type Language = "vi" \| "en"`), không phải một phép đếm file. Câu mục 22 được **đo lại trước khi nhân bản** trên `DemoTransport.SendAsync` (bốn đường ra, cả bốn `Success: true`) và **đứng vững**, nên không có gì phải rút ở đó. 🔴 **Nhưng *"bề mặt CUỐI CÙNG"* trong đầu đề mục này là một PHỦ ĐỊNH TỒN TẠI SAI: `README.md` §7 mang chỗ thứ NĂM** — *"a ~90%-error `DemoTransport` … queued/failed rows"* — cùng lời hứa sai, và là bề mặt một BÊN TÍCH HỢP đọc; **rút tại chỗ kèm ngày**. Không phải nhân chứng đỏ được (chỉ đổi lời); `npm run build` xanh, không hằng số nào dịch. Xem **Phần III** |
| 35 | `DBIRTH`/`DDEATH` không sinh ra được, và `SparkplugAliasTable.Reset()` cùng thế — hệ quả ĐÃ ĐO của mục 23 | ✅ **ĐÃ THI HÀNH 2026-08-23 (BE-1)** theo 🔨 **PHÁN QUYẾT CỦA CHỦ SỞ HỮU 2026-08-23: GHI LÀ NỢ ĐÃ NHẬN, KHÔNG PHÁT** — **không một dòng mã nào đổi, không payload MQTT nào đổi**. Món nợ nay ghi **vào mục VÀ vào tài liệu người dùng đọc**: spine phát **NBIRTH/NDEATH/DDATA**, **CỐ Ý không phát DBIRTH/DDEATH**, theo chuẩn Sparkplug B đó là **một node KHÔNG HỢP LỆ** (host nghiêm coi device là không biết/STALE), và đây là **nợ ĐÃ NHẬN CÓ TRẦN**. **Tập tài liệu — liệt kê rồi mới đếm:** *nói thẳng* rằng spine phát DBIRTH — **KHÔNG CÒN CÁI NÀO** (bốn câu ấy AX-1 đã rút 2026-08-22; BE-1 mở lại cả bốn và **cả bốn còn nguyên, không phát hiện nào**). *Hàm ý* — **SÁU** chỗ, tất cả là **bề mặt người dùng đọc**, và đây là chỗ **AX-1 KHÔNG mở hết tập**: README §16.1 (EN+VI), bảng lộ trình P2 (EN+VI), README §17.7, và `docs/SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md:73`. 🔴 **AX-1 đã đọc §16.1 và kết luận *"không có gì để rút"* — câu ấy ĐÚNG và VẪN ĐÚNG**: cái thiếu là phép **THU HẸP**, không phải phép **RÚT** — một câu đúng-đến-hết-cái-nó-nói, đặt dưới một tiêu đề nêu tên một chuẩn, **im lặng đúng chỗ chuẩn ấy bị vi phạm**. **Không một chữ nào của AX-1 bị rút.** **Đã sửa tại chỗ kèm ngày:** README §16.1 nhận khối *"KHÔNG PHẢI MỘT NODE SPARKPLUG B TUÂN ĐẶC TẢ"* (EN+VI); README §20.5 nhận một gạch đầu dòng đầy đủ — chỗ khoảng trống DBIRTH là **thiếu sót nổi bật duy nhất** trong một danh sách đã mang hai cảnh báo UNS/Sparkplug khác; bảng lộ trình P2 thu hẹp *"delivered"* → *"partially delivered … Not yet"* (EN+VI), đúng khuôn hai hàng Modbus/OPC-UA kề nó. 🔴 **CHỖ TRỐNG GIỮ NGUYÊN LÀ CHỖ TRỐNG:** *"người đăng ký gương retained nào bị ảnh hưởng"* vẫn **CHƯA ĐO ĐƯỢC TỪ ĐÂY** — **không phép đo mới nào**, **không suy đoán nào** viết vào thay, và chỗ trống ấy được nêu **thành lời** ở cả hai bề mặt README mới. 🔴 **Nhân chứng — tự dán nhãn: KHÔNG phải nhân chứng đỏ được, và không thể có một cái trung thực** (không hành vi mới để gác); nó là **W-1 xanh + phép đo chứng minh lời mới đúng**. **Không hằng số nào dịch** — hai bề mặt sửa là `README.md` và một `docs/*.md`, **nằm NGOÀI corpus chỉ-quét-C# của `scan-doc-negations.sh`**, nên `EXPECT_NEW_DOC_ABSOLUTES` không dịch vì mục này (đo lại, không suy ra). Trạng thái cũ giữ nguyên văn: 🔴 **CHỜ ANH** — mở 2026-08-22 (AU-1). 🔴 **Nhưng chữ *"HOÀN TOÀN"* của brief KHÔNG đứng vững ở phạm vi repo:** `server/` có một bộ phát DBIRTH/DDEATH **đang sống** bằng TypeScript. Đúng ở phạm vi `tools/machine-simulator`. `Reset()`: **một** caller, và nó là một unit test — **không caller sản xuất nào**, trong khi `GetOrAssign` chạy trên **mọi** reading: bảng alias **nửa sống** → 🔴 **DỪNG 2026-08-22 (AX-1), Ở LẠI PHẦN I.** **Điều kiện DỪNG đã nổ:** làm spine này tuân đặc tả đòi **phát một thông điệp MQTT MỚI** (DBIRTH mức device) lên dây — tức **đổi payload MQTT**, một trong **ba mục chủ sở hữu KHÔNG uỷ quyền**. Điều phối viên **không tự quyết**; chờ anh. Phần nằm TRONG uỷ quyền đã trả và ghi trong thân mục: vòng đời hôm nay **liệt kê rồi đếm — BA loại Sparkplug rời spine này (NBIRTH, NDEATH, DDATA) trên sáu thành viên enum**; bề mặt gọi `Reset()` đo lại bằng `scripts/repo-scan.sh` ở miền có **cả `server/` và `client/`** (2300 file nằm trong commit, ngoài đĩa) — **vẫn đúng MỘT, vẫn là unit test ấy**, nên đây là **MỞ RỘNG miền chứ không RÚT**; **bốn** câu tài liệu nói sản phẩm phát/sẽ phát DBIRTH **rút tại chỗ kèm ngày** (hai trong bốn sai theo hai chiều NGƯỢC nhau, cùng một file). 🔴 **Chỗ trống "người đăng ký gương retained CHƯA ĐO" GIỮ NGUYÊN là chỗ trống** — không phép đo mới, và **không suy đoán nào được viết vào thay cho một phép đo** |
| 36 | README §16.4/§16.6 là một bản sao **không có nhân chứng** | 🔴 **CHỜ ANH** — mở 2026-08-22 (AU-1), xác nhận lại trên mã. Không test/script/CI nào giữ chúng đúng, và **`ModbusOptions.cs` TỰ KHAI điều đó**. 🔴 **Và phép kiểm tra chéo tìm thấy một câu ĐÃ TRÔI rồi** — §16.6 nói `OperationTimeout` *"hardcoded"* trong khi nó là tham số constructor từ Task B-5 → ✅ **ĐÃ THI HÀNH 2026-08-22 (AX-1)** theo 🔨 **QUYẾT: DỰNG NHÂN CHỨNG, KHÔNG PHẢI SỬA LỜI** (2026-08-22, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục 8). `tests/St4i.EngineApi.Tests/DriverDocumentationTests.cs`, **ba `[Fact]` ĐỎ ĐƯỢC**, đặt cạnh hai tiền lệ mục này nêu tên; **cặp đối chứng chạy trọn, MỘT đột biến cho MỖI fact** (đổi tên `EnvVarPort`; `operationTimeoutMs` 15000→20000; thêm thành viên thứ bảy vào `CommandArgumentType`), cả ba ĐỎ đúng bài của nó rồi **hoàn nguyên**. **22 khẳng định liệt kê rồi kiểm; HAI sai, và mục này chỉ thấy MỘT:** ngoài *"hardcoded"*, 🔴 **§16.4 công bố kiểu tham số lệnh là tập ĐÓNG SÁU trong khi `CommandArgumentType` có BẢY** (`String` được `ValidateSelf` chấp nhận — phép kiểm lược đồ **duy nhất** cả hai map chạy). Cả hai **rút/bổ sung tại chỗ kèm ngày**, và câu **tự khai** của `ModbusOptions.cs` (*"remain a hand-kept copy with no witness … still true"*) **hết đúng hôm nay** nên bị rút ngay trong file ấy. 🔴 **Nhân chứng ghim GIÁ TRỊ và TẬP TÊN, không ghim văn xuôi** — bốn chỗ cụm-từ được kể tên trong chính doc của nó; đoạn lý lẽ, hai danh sách *"honest deferral"* và khối RTU **vẫn không có nhân chứng**. `EXPECT_ENGINEAPI` 1405 → **1408**, tổng 2821 → **2824**, **0 lệnh đè**. Xem **Phần III** |
| 37 | 🔴 **HỒ SƠ — LỖI CỦA ĐIỀU PHỐI VIÊN:** một phán quyết của chủ sở hữu sống trọn một vòng nhiệm vụ **KHÔNG có bản ghi tại chỗ** | 🔴 **CHỜ ANH** — mở 2026-08-22 (AU-1), và **mục này là của điều phối viên, không phải của mã**. Phán quyết mục 16 ngày 2026-08-22 tới người thi hành **chỉ qua một task brief**; `grep "2026-08-22"` trên file tại `ce1ce2be` trả **đúng hai dòng, cả hai thuộc mục 27**. **"Đừng thi hành" đã bị đọc thành "đừng ghi"** — một phán quyết và một lần thi hành là **hai hiện vật khác nhau**. Cộng: danh sách Phần I **lỗi thời qua ba nhiệm vụ liên tiếp** và **không dụng cụ nào bắt được, vì không cổng nào đọc file này** — cùng lớp với mục 26 và 32. 🔴 **Và con số ấy được ĐO LẠI: brief mở mục này nói "chín mục"; đo trên `659bcfb2` là MƯỜI MỘT** (16, 18, 19, 20, 21, 22, 23, 24, 27, 28, 29 — Phần I thật chỉ chứa 17, 25, 26, 30, 31, 32). **Chính lời khai về khuyết tật kiểm đếm cũng đếm sai**, theo đúng cơ chế mục này mô tả → ✅ **ĐÃ THI HÀNH 2026-08-22 (AW-1)** theo 🔨 **QUYẾT: BẮT CỔNG ĐỌC FILE NÀY** (2026-08-22, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục 8/15/17/21). `scripts/check-owner-decisions.sh`, chạy trong `scripts/verify-suites.sh`: **cổng nay ĐỌC `docs/owner-decisions.md`** — câu *"không cổng nào đọc file này"* trong thân mục **hết đúng kể từ hôm nay**, và nó được rút tại chỗ chứ không lặng lẽ. Phép kiểm ghim **CẤU TRÚC, không ghim VĂN XUÔI**, đúng lối rẻ nhất mà chính mục này nêu ra: mỗi số hiệu trong bảng có **đúng một** thân mục và ngược lại; **trạng thái ghi trong hàng khớp PHẦN mà thân mục đứng dưới**; **phép liệt kê Phần I nêu đúng tập số hiệu thật sự nằm ở Phần I**, cả ở trường máy đọc lẫn ở câu văn người đọc. 🔴 **Đo được hôm nay, trước khi sửa: NĂM chỗ lệch** — (1) mục 17 ở Phần III với hàng tự khai *"MỘT PHẦN"*; (2)(3)(4) **BA** đoạn liệt kê Phần I trần nằm cạnh nhau ở dòng 111, 168, 237 mà **chỉ một là hiện hành**, không gì phân biệt được; (5) không có trường máy đọc nào nói cái nào hiện hành. **Cả năm sửa ở HỒ SƠ, không sửa dụng cụ cho vừa hồ sơ.** 🔴 **Và cái phép kiểm này KHÔNG bắt được, nói thẳng vì một nửa sự thật ở đây đúng là loại lỗi mục này nói về: NỬA THỨ NHẤT CỦA MỤC 37 — một phán quyết KHÔNG BAO GIỜ ĐƯỢC GHI — vẫn KHÔNG có bộ dò nào.** Không phép kiểm nào trên file này thấy được một sự kiện không nằm trong file. Nó cũng không đọc văn xuôi, không phán được một mục "MỘT PHẦN" thuộc Phần I hay Phần II (nó chỉ nói **KHÔNG PHẢI Phần III**), và **chỉ** ghim phép liệt kê Phần I — Phần II và Phần III không có trường máy đọc. Xem Phần III |
| 38 | `pollIntervalMs` là trường cadence DUY NHẤT không được kiểm miền, trên **cả hai** bản đồ | 🔴 **CHỜ ANH** — mở 2026-08-22 (AZ-1), đo bởi AY-1 (mục 12 đợt 9), **xác nhận lại trên mã VÀ trên assembly đã dựng**. `ModbusRegisterMap.FromJson` và `OpcUaNodeMap.FromJson` lưu `pollIntervalMs` **y như khai** — đo: `0`, `-1`, `-2`, `-2147483648` đều lưu nguyên — trong khi hai trường kề nó, `readTimeoutMs` và `retries`, đi qua `ParseOptionalPositiveInt`, bị chặn, **có cảnh báo** và rơi về mặc định. Hậu quả đo trên chính runtime này: `Task.Delay(0)` xong trong **0 ms** ⇒ vòng poll **không tiết chế**; `Task.Delay(-1)` **chưa xong sau 750 ms** (`Timeout.Infinite`) ⇒ thiết bị được poll **đúng một lần rồi im**; `Task.Delay(≤ -2)` ném `ArgumentOutOfRangeException`, và cả ba driver bọc lời gọi ấy trong một `try` **chỉ bắt `OperationCanceledException`**, nên nó **thoát ra khỏi iterator**. 🔴 **Và "cả hai driver" của đợt 9 là một phép ĐẾM THIẾU: có BA** — `ModbusTcpDriver` và `OpcUaDriver` gọi `Task.Delay(_map.PollIntervalMs, ct)` trực tiếp, `ModbusRtuDriver` qua `NextPollDelayMs()`. **Chiều ngược:** `EffectiveReadTimeoutMs` sàn ở 1000 nên read timeout **không** hỏng theo, và backoff RTU sản xuất **che** giá trị âm **sau lần hỏng đầu** (`Math.Max`) — nên trên RTU cái bẫy chỉ cắn khi thiết bị **khoẻ**. **Không sửa mã.** Xem mục 38 🔴 **ĐÃ THI HÀNH 2026-08-23 (BD-1, base `889c72ab`), điều phối viên quyết theo uỷ quyền — hướng (i): `pollIntervalMs` nay đi qua đúng luật miền của hai hàng xóm (`> 0`, `<= MaxPollIntervalMs = int.MaxValue/4`, vi phạm ⇒ cảnh báo + mặc định 1000), trên **cả hai** bản đồ, ở **biên parse**. Ba driver **liệt kê rồi đếm**, xác nhận BA. Bề mặt ĐỌC quét toàn cây: **100 file, 45 ngoài `tools/machine-simulator`**; không bản triển khai hợp lệ nào bị giam, và cái **cố ý dùng `0`** — `ModbusMultidropBusTests.ASlowPollerIsNotStarved_...` — được **nêu tên** và sống sót vì nó dựng bằng object initializer. Mục rời **Phần I → Phần III** |
| 39 | `"registers": null` / `"nodes": null` thoả `required` rồi ném `NullReferenceException` **trần** | 🔴 **CHỜ ANH** — mở 2026-08-22 (AZ-1), đo bởi AY-1 (mục 12 đợt 9), **xác nhận lại trên assembly đã dựng**. `required` được thoả bằng việc **KHOÁ CÓ MẶT**, nên một `null` tường minh bind qua nó và `map.Registers.Count` / `map.Nodes.Count` ném `NullReferenceException` với thông điệp `"Object reference not set to an instance of an object."` — **không nêu file, không nêu trường, không nêu máy**. Đối chứng đo cùng lần: khoá **VẮNG** cho `JsonException: … was missing required properties including: 'Registers'` / `'Nodes'`, tức đường tốt đã có sẵn và chỉ ca `null` tường minh rơi ra ngoài. **Đúng hình dạng mà `ModbusRegisterMap.FromJson` tự ghi là ĐÃ SỬA cho `commands`.** **Chiều ngược:** cả hai `FromJson` là *"parse ném thẳng"* theo thiết kế và `ModbusRtuConnectorFactory.TryCreate` **bọc mọi throw** thành một `error` chuỗi, nên hậu quả là **một thông điệp vô dụng cho vận hành viên**, không phải một tiến trình chết. **Không sửa mã.** Xem mục 39 🔴 **ĐÃ THI HÀNH 2026-08-23 (BD-1, base `889c72ab`), điều phối viên quyết theo uỷ quyền — **HAI ca đo RIÊNG**: `null` tường minh nay ném `InvalidOperationException` **nêu trường + mã máy**, còn khoá **VẮNG** **KHÔNG ĐỔI** (vẫn là `JsonException` của binder) — và việc nó không đổi là một kết quả **đo được** bằng cặp đối chứng, không phải một giả định. `FromJson` nhận **văn bản**, không nhận đường dẫn, nên **tên file do khung có đường dẫn nêu** (`Program.cs` đã bọc sẵn trong `{MapPath}`). Mục rời **Phần I → Phần III** |
| 40 | Một dụng cụ TỰ KIỂM có thể mù đúng ở đường mặc định của chính nó, và cổng vẫn xanh | 🔴 **CHỜ ANH** — mở 2026-08-22 (BA-1). Khuyết tật tìm bởi AZ-1 (mục 12 đợt 10), điều phối viên xác nhận độc lập **hai lần**. `scripts/repo-scan.sh` — **dụng cụ dựng CHO mục 32** — mang **đúng khuyết tật của mục 32** ở đường mặc định của nó từ `cfcfae42` tới `89018893`: không pathspec ⇒ `SPECS=(".")` ⇒ `:(top).`, thứ git **không khớp gì**, nên nó in `result lines : 0 … a measurement, not an error` cho **mọi** pattern. Đo: `'class'` trả **0** với `:(top).`, **1804** với `:(top)`. 🔴 **Vì sao `--self-test` không thấy:** ba khẳng định của nó **đều truyền pathspec tường minh**, và cái duy nhất nói về mặc định là *bất biến theo cwd* — mà **mặc định hỏng ĐÚNG LÀ bất biến theo cwd: bất biến bằng 0**. Khuyết tật **thoả** phép kiểm. **BA-1 đã sửa cả ba dụng cụ** (mặc định `:(top)`; ca self-test KHÔNG-pathspec + từ chối MIỀN RỖNG, chứng minh đỏ-được bằng **ba cặp đối chứng chạy trọn rồi hoàn nguyên**; `C0` cho `check-owner-decisions.sh`; ba guard quần thể cho `scan-doc-negations.sh`). **Chiều ngược, và nó thu hẹp thiệt hại:** mặc định hỏng trả **0 vô điều kiện**, nên **không** khẳng định nào mang một con số KHÁC 0 có thể đã đi qua nó — quần thể `cfcfae42..HEAD` đã liệt kê rồi kiểm, và **hai** câu sai tìm được sai vì lý do KHÁC (tự tham chiếu, và một quần thể cũ), không phải vì khuyết tật này. **Cái CHỜ ANH là câu hỏi tầng hai:** cái gì cưỡng chế rằng một dụng cụ tự kiểm không mù đúng ở chỗ đối tượng của nó mù — mục 26/32/37 ở tầng **dụng cụ đo dụng cụ**. Xem mục 40 🔴 **ĐÃ THI HÀNH 2026-08-23 (BD-1, base `889c72ab`), điều phối viên quyết theo uỷ quyền — `G1` **GIỮ** (đo: trên `--since` nó thừa vì `G3` bắt cùng đầu vào; vùng phủ riêng là `--census`, gỡ nó ⇒ exit 0 trên corpus rỗng) và **tự dán nhãn "guard, KHÔNG phải nhân chứng"**; `C0` nay phân biệt được Phần II **TRỐNG** với **HỎNG** qua `C6` (đẳng thức khai-báo == phân-tích-được, vì `count > 0` sẽ sai hôm nay); thêm `G4` cho `BASE_SENT` — quần thể **thứ TƯ** chưa ai canh. 🔴 **Câu hỏi tầng hai được TRẢ LỜI: luật ấy KHÔNG CƯỠNG CHẾ ĐƯỢC** — nó là một tính chất độ phủ của shell và repo này không có dụng cụ đo độ phủ shell. Cái cưỡng chế được là **phép KHAI BÁO**, đặt ở chỗ nghẽn duy nhất `run_tooling_check`: mọi tooling check thành công phải in `POPULATION <nhãn> <số>` và mọi số phải > 0. **KHÔNG dựng dụng cụ tầng thứ ba** cho cặp đối chứng, lý do ghi ở thân mục. Mục rời **Phần I → Phần III** |
| 41 | 🔴 **Nối một config store làm MÔ-MEN XOẮN báo ra lệch ~9 lần** — hai host trong cùng sản phẩm báo VẬT LÝ KHÁC NHAU cho cùng một descriptor | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1), đo lần đầu bởi BC-1 và xác nhận lại trên mã ở `9255ea98`. **Không uỷ quyền được**: nó đổi một con số ĐÃ ĐI RA NGOÀI trên `POST /api/v1/ingest/process-result`, cùng lớp mục 16 |
| 42 | `weld_profile` và `dispense_program` được định nghĩa, kiểm miền, phục vụ qua REST — và **không bộ mô phỏng nào đọc**; hai trong bốn khoá mỗi bên **trùng TÊN** với một metric cùng máy phát ra | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1). **Không uỷ quyền được**: nối dây làm đổi giá trị metric đã báo cáo; gỡ vựng từ là gỡ một bề mặt REST công khai |
| 43 | Hai bộ mô phỏng có **phán quyết không thể sai**, và cả hai tính là TỐT cho OEE — `AssemblySim` chỉ đạt `Warn`, `LeakTestSim` cảnh báo vì rò **QUÁ ÍT** | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1). **Không uỷ quyền được**: cùng loài mục 2 và mục 16 — sửa là dịch con số OEE đã báo cáo |
| 44 | Hai tham số constructor **công khai** không chỗ gọi nào trong repo cấp — `LeakTestSim.maxLeakRatePa`, `FunctionalTestSim.targetPassRate` — và cái thứ nhất **không được kiểm miền** | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1). **Không uỷ quyền được**: một trong ba hướng là **gỡ một tên công khai**, đúng thứ uỷ quyền loại trừ; cùng câu hỏi mục 25 |
| 45 | `SimulatedEcosystem.Load` **ghi lại CẢ HAI file khi chỉ MỘT vắng** — và kể từ mục 30 nó đè lên một file `%ProgramData%` mà phép xoá ngừng-hoạt-động **cố ý GIỮ** | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1); AV-1 đo 2026-08-22, BF-1 đo lại là ĐẮT HƠN 2026-08-23. Theo tiền lệ mục 10 và 30, **một đường mất dữ liệu MỚI là của anh** |
| 46 | `-SkipDotnetPublish` của `build-installer.ps1` để **dữ liệu do vận hành viên soạn** đi vào MSI | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1); AV-1 đo 2026-08-22 và ghi trong thân mục 30/31 mà **chưa bao giờ có hàng riêng**. Theo tiền lệ mục 31, **cái gì đi tới khách hàng là của anh** |
| 47 | Hai nhà máy connector Modbus **đụng nhau ở khoá đăng ký mặc định** — `ConnectorRegistry.Register` THAY chứ không từ chối, nên đăng ký cả hai làm **một cái biến mất im lặng** | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1). **Không uỷ quyền được**: mọi hướng sửa đều đổi một **id connector công khai** hoặc hành vi của một API đăng ký công khai |
| 48 | Hợp đồng của chính seam driver bị vi phạm ở **năm chỗ đo được** — I/O trong constructor, hai đường dispose không có trần, một driver không liệt kê lại được, và một miễn trừ Health không được khai | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1); BB-1 đo 2026-08-22. ⚖️ **ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC** — không chạm ba miễn trừ; nằm đây vì **chưa ai quyết** |
| 49 | Hai vựng từ machine-type **không phải một danh sách**, và một loại máy không nhận ra **âm thầm thành máy bắt vít** rồi **GHI một bản ghi cấu hình** dưới mã của nó | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1); BC-1 đo 2026-08-22. ⚖️ **ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC** — không chạm ba miễn trừ |
| 50 | Ba khuyết tật parse trên bản đồ connector: hai khoá **viết hoa bị vứt IM LẶNG**, `EffectiveReadTimeoutMs` **vẫn tràn `int`** qua object initializer, và hai bề mặt parse **không truyền sink cảnh báo** | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1); BD-1 đo 2026-08-23, **ngoài phạm vi mục 38**. ⚖️ **ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC** — không chạm ba miễn trừ |
| 51 | **Năm dụng cụ đo tự báo hụt miền của chính mình** — và một gốc `%ProgramData%` mà **không dụng cụ nào canh ngoài `creds`** | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1); BD-1/BE-1/BF-1 đo. ⚖️ **ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC** — cùng loài mục 32 và 40, và **hai mục ấy đều do CHỦ SỞ HỮU quyết**, nên hàng này nêu tiền lệ chứ không tự nhận |
| 52 | **Hai lời khai đã công bố đo được là SAI và cố ý để nguyên**, cộng sáu chỗ ném lỗi không nêu file mà thông điệp **không ai đọc** | 🔴 **CHỜ ANH** — mở 2026-08-23 (BG-1); BB-1/BC-1/BE-1 đo. ⚖️ **ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC** — rút một câu văn xuôi tại chỗ không chạm ba miễn trừ |
| — | cổng đòi máy độc quyền | 🔨 **SỬA SAU** — làm hỏng dụng cụ đo mọi mục trên |

> 🔴 **V-1 — bảng này THIẾU hai hàng kể từ lúc Q-1 thêm mục 8 và 9, và điều đó chỉ lộ ra
> khi câu mở đầu được sửa để trỏ vào đây làm nguồn sự thật.** Hai hàng ấy được thêm vào
> **mà không quyết gì**: phán quyết của chúng vẫn đúng nguyên trạng thái mà mục 8 và mục
> 9 đang ghi, và V-1 bị cấm đụng vào cả hai. Cái được sửa là **bảng không liệt kê đủ tập
> mà nó tự nhận là tóm tắt** — đúng loài mà file này lập ra để chấm dứt, ở trong chính
> bảng tóm tắt của nó.

---

# 🔴 PHẦN I — ĐANG CHỜ ANH

**Phép liệt kê các mục ở đây, và nó KHÔNG liệt kê được cái gì: không mục nào.** Không hàng
nào của bảng phán quyết trên còn mang `🔴 CHỜ ANH`, và **bảng ấy là nguồn sự thật** — câu này
chỉ là một con trỏ vào nó. 🔴 **"Rỗng" ở đây là một trạng thái của HÔM NAY, không phải một
tính chất của file**: vòng phản biện nào cũng có thể mở một mục mới, và ba lần trong hai ngày
nó đã làm đúng thế (xem khối ngay dưới). Phần này **không bị xoá** khi rỗng, vì cái nó giữ là
**chỗ**, không phải **nội dung**.

> 📎 **HAI CÂU ĐẦU CỦA ĐOẠN NGAY TRÊN — RÚT 2026-08-20 (AO-1), giữ NGUYÊN VĂN, cùng kiểu bảo tồn
> AB-1 lập và AI-1/AK-1 dùng: trích nguyên văn rồi rút, kèm ngày và người, KHÔNG gạch ngang, không
> xoá một dòng nào.** Hai câu ấy đọc: *"**Phép liệt kê các mục ở đây, và nó KHÔNG liệt kê được cái
> gì: không mục nào.** Không hàng nào của bảng phán quyết trên còn mang `🔴 CHỜ ANH`, và **bảng ấy
> là nguồn sự thật** — câu này chỉ là một con trỏ vào nó."* Lý do rút **không phải chúng từng
> sai** — chúng mô tả đúng trạng thái hồ sơ tới hết ngày 2026-08-19 — mà là **nhiệm vụ này làm
> chúng sai**: mười bảy mục mới, số hiệu **15–31**, vừa được đặt vào Phần I, và cả mười bảy mang
> `🔴 CHỜ ANH` ở bảng phán quyết trên.
>
> 🔴 **Phần còn lại của đoạn ấy KHÔNG được rút, và nó vừa được chứng minh đúng lần thứ tư.** Câu
> *"'Rỗng' ở đây là một trạng thái của HÔM NAY, không phải một tính chất của file"* đã dự đoán
> đúng chuyện vừa xảy ra. Ba lần trước, tập nới ra hoặc co lại bằng **một vòng phản biện** hoặc
> **một phán quyết**; lần này bằng một cơ chế **thứ tư và mới**: mười hai khuyết tật + ba câu hỏi
> đã được ĐO xong từ trước, nhưng chúng nằm trong `.superpowers/sdd/*/task-1-report.md`, và
> **`.superpowers/` bị gitignore** — nên chủ sở hữu **không có đường dẫn nào để mở chúng**. Đó
> đúng là thiếu sót mà đoạn mở đầu của file này nêu tên và tự nhận lập ra để vá. Nhiệm vụ này là
> lần vá ấy cho lứa mới; nó **không quyết một mục nào và không sửa một dòng mã nào**.
>
> 🔴 **Và một cách viết được giữ nguyên vì chính nó làm phép rút này rẻ: LIỆT KÊ, KHÔNG ĐẾM.**
> Câu bị rút liệt kê (*"không mục nào"*) chứ không viết một con số `0`, nên nó sai **nhìn thấy
> được** ngay khi mục 15 xuất hiện. Câu thay nó ở ngay dưới cũng liệt kê.

**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
28, 29, 30, 31 và 32.** Tất cả mang `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy là nguồn
sự thật** — câu này chỉ là một con trỏ vào nó.
<!-- gate:phần-i-rút -->

> 📎 **CÂU NGAY TRÊN — RÚT 2026-08-21 (AP-1), giữ NGUYÊN VĂN, cùng kiểu bảo tồn AB-1 lập và
> AI-1/AK-1/AO-1 dùng: trích nguyên văn rồi rút, kèm ngày và người, KHÔNG gạch ngang, không xoá một
> dòng nào.** Nó đọc: *"**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 15, 16, 17, 18, 19, 20, 21, 22, 23,
> 24, 25, 26, 27, 28, 29, 30, 31 và 32.** Tất cả mang `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy
> là nguồn sự thật** — câu này chỉ là một con trỏ vào nó."* Lý do rút **không phải nó từng sai** — nó mô
> tả đúng trạng thái hồ sơ tới hết ngày 2026-08-20 — mà là **mục 15 đã được QUYẾT và đã THI HÀNH**:
> điều phối viên quyết theo uỷ quyền ngày **2026-08-20** (cùng khuôn mục 8), AP-1 thi hành ngày
> **2026-08-21**, và mục ấy **không còn ở đây** mà ở **Phần III**, với một ghi chép thi hành ghi kèm
> ngày. 🔴 **Đây là cơ chế THỨ HAI trong sáu, không phải một cơ chế mới** — *quyết một mục* — và nó đã
> từng làm tập này co lại ở AJ-1 và AK-1. **Cách viết được giữ nguyên và chính nó làm phép rút này rẻ:**
> một phép liệt kê thiếu một số hiệu sai **nhìn thấy được**; một con số `18` viết ở đây sẽ phải bị rút
> mà không ai đọc ra tại sao.

> 📎 **CÂU NGAY DƯỚI — RÚT 2026-08-22 (AU-1), giữ NGUYÊN VĂN, cùng kiểu bảo tồn AB-1 lập và
> AI-1/AK-1/AO-1/AP-1 dùng: trích nguyên văn rồi rút, kèm ngày và người, KHÔNG gạch ngang, không xoá một
> dòng nào.** Nó đọc: *"**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
> 26, 27, 28, 29, 30, 31 và 32.** Tất cả mang `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy là nguồn sự
> thật** — câu này chỉ là một con trỏ vào nó."*
>
> 🔴 **Lý do rút KHÔNG giống mọi lần trước, và chỗ khác nhau chính là mục 37.** Mọi phép rút trước đó ghi
> *"không phải nó từng sai — nó mô tả đúng trạng thái hồ sơ cho tới đúng lúc ấy."* **Lần này không viết được
> câu đó.** Phép liệt kê này **đã sai từ trước khi AU-1 chạm vào nó**: mục 16, 18, 19, 20, 21, 22, 23, 24, 27,
> 28 và 29 đều đã rời sang **Phần III** ở những nhiệm vụ trước, và câu này vẫn liệt kê cả mười một. Nó lỗi
> thời **qua ba nhiệm vụ liên tiếp** và **không dụng cụ nào bắt được** — vì **không cổng nào đọc file này**.
> Đó chính là mục **37**, và nó vừa được chứng minh **ở trong chính câu tóm tắt của phần mà nó tóm tắt** —
> đúng loài mà V-1 bắt được trong bảng phán quyết năm ngày trước.
>
> 🔴 **Và cách viết *liệt kê, không đếm* KHÔNG cứu được lần này, nên nói thẳng thay vì lặp lại lời khen cũ.**
> Bốn khối trên đều lập luận rằng một phép liệt kê sai thì *"sai nhìn thấy được"*. Nó chỉ nhìn thấy được
> **nếu có ai đó nhìn**. Không ai nhìn trong ba nhiệm vụ. Phép liệt kê làm cho phép **sửa** rẻ; nó không làm
> cho phép **phát hiện** tự động — và cái thiếu ở đây là phát hiện, không phải sửa.

> 📎 **CÂU NGAY DƯỚI — RÚT 2026-08-22 (AV-1), giữ NGUYÊN VĂN, cùng kiểu bảo tồn AB-1 lập và
> AI-1/AK-1/AO-1/AP-1/AU-1 dùng: trích nguyên văn rồi rút, kèm ngày và người, KHÔNG gạch ngang, không xoá
> một dòng nào.** Nó đọc: *"**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 25, 26, 30, 31, 32, 33, 34, 35, 36
> và 37.** Tất cả mang `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy là nguồn sự thật** — câu này chỉ là
> một con trỏ vào nó. 🔴 **Câu này được viết ngày 2026-08-22 và sẽ lại lỗi thời theo đúng cơ chế vừa nêu,
> trừ khi mục 37 được quyết** — nó không tự bảo trì được."*
>
> **Lý do rút KHÔNG phải nó từng sai** — nó mô tả đúng trạng thái hồ sơ từ lúc AU-1 viết nó cho tới nhiệm vụ
> này; và nó **tự dự báo đúng sự lỗi thời của chính mình**, chỉ nhầm cơ chế: cái làm nó lỗi thời là **hai mục
> được QUYẾT** (33 và 31, cả hai thi hành ngày 2026-08-22 bởi AV-1), tức cơ chế **thứ hai** trong sáu, không
> phải cơ chế **thứ ba** mà mục 37 mô tả. **Đây là lần đầu trong bốn phép rút liên tiếp mà câu bị rút được
> thay bởi một người ĐÃ ĐỌC nó** — khoảng trống phát hiện mà AU-1 nêu tên vẫn còn nguyên, và câu thay nó
> dưới đây thừa hưởng đúng khoảng trống ấy.
>
> 🔴 **Và một khẳng định trong lời giao việc của AV-1 KHÔNG sống sót khi đối chiếu với chính câu bị rút
> này:** lời giao việc liệt kê Phần I là *"17, 25, 26, 30, 31, 32, 33, 34, 35, 36, 37"* — **mười một số hiệu
> dưới nhãn "mười mục"**. Con số **mười** đúng; **mục 17 KHÔNG ở Phần I** — nó đã sang Phần III ngày
> 2026-08-22 (AU-1, thi hành một phần). Cùng lời giao việc, ở chỗ khác, lại liệt kê tám số hiệu dưới nhãn
> *"bảy mục Phần I khác"*, và ở đó **bảy** đúng còn 17 lại thừa. Cả hai lệch là **cùng một lỗi dán một lần**,
> và cả hai bị bắt bởi đúng thứ file này vẫn giữ: một phép liệt kê đặt cạnh một con số.

**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 25, 26, 30, 32, 34, 35, 36 và 37.** Tất cả mang
`🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy là nguồn sự thật** — câu này chỉ là một con trỏ vào nó.
🔴 **Mục 30 ở lại đây KHÔNG phải vì chưa ai đo nó**, mà vì AV-1 được giao thi hành nó ngày 2026-08-22 và
**điều kiện DỪNG của nó đã nổ**; phép đo đi kèm nằm ngay trong thân mục, ở phần này, không ở Phần III.
🔴 **Câu này được viết ngày 2026-08-22 và sẽ lại lỗi thời theo đúng cơ chế mà mục 37 mô tả, trừ khi mục 37
được quyết** — nó không tự bảo trì được, và bốn lần liên tiếp nó đã không tự bảo trì.
<!-- gate:phần-i-rút -->

> 📎 **CÂU NGAY TRÊN — RÚT 2026-08-22 (AW-1), giữ NGUYÊN VĂN, cùng kiểu bảo tồn AB-1 lập và
> AI-1/AK-1/AO-1/AP-1/AU-1/AV-1 dùng: trích nguyên văn rồi rút, kèm ngày và người, KHÔNG gạch ngang,
> không xoá một dòng nào.** Nó đọc: *"**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 25, 26, 30, 32, 34, 35,
> 36 và 37.** Tất cả mang `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy là nguồn sự thật** — câu này
> chỉ là một con trỏ vào nó."*
>
> **Lý do rút KHÔNG phải nó từng sai** — nó mô tả đúng trạng thái hồ sơ từ lúc AV-1 viết nó cho tới nhiệm
> vụ này. Cái làm nó lỗi thời là **hai cơ chế cùng lúc, và một trong hai chưa từng xảy ra với câu này**:
> *(i)* **ba mục được QUYẾT và THI HÀNH** — 26, 32 và 37, cả ba ngày 2026-08-22 bởi AW-1 — tức cơ chế thứ
> hai trong sáu; *(ii)* 🔴 **một mục QUAY VỀ Phần I từ Phần III** — mục **17**, đặt lại đúng phần theo
> chính mục 37. **Chiều ấy là MỚI.** Năm lần trước tập này chỉ nới ra bằng phản biện hoặc co lại bằng
> phán quyết; đây là lần đầu một số hiệu **đi ngược** vì nó đã bị đặt sai chỗ, và điều đó chỉ lộ ra khi
> có người **suy từ định nghĩa của các phần** thay vì đọc dấu ✅ ở đầu ô.
>
> 🔴 **VÀ ĐÂY LÀ CHỖ CÂU BỊ RÚT TỰ DỰ BÁO ĐÚNG, RỒI VẪN KHÔNG TỰ CỨU ĐƯỢC.** Nó viết: *"sẽ lại lỗi thời
> theo đúng cơ chế mà mục 37 mô tả, trừ khi mục 37 được quyết — nó không tự bảo trì được, và bốn lần liên
> tiếp nó đã không tự bảo trì."* Nó lỗi thời đúng như đã dự báo. Cái khác lần này: **mục 37 ĐÃ được
> quyết**, và câu thay thế bên dưới **không còn chỉ dựa vào việc có ai đó nhìn** — nó mang một trường máy
> đọc ngay dưới nó, và `scripts/check-owner-decisions.sh` **so trường ấy VÀ câu văn này với tập số hiệu
> thật sự nằm ở Phần I** ở mỗi lần chạy cổng. 🔴 **Nói cho hết cái nó vẫn KHÔNG làm được: nó bắt được câu
> này lỗi thời, nó KHÔNG bắt được một phán quyết chưa bao giờ được ghi vào đây.** Nửa ấy của mục 37 vẫn
> không có bộ dò, và nói ra chứ không để câu trên đọc như một lời hứa rộng hơn cái nó giữ.
>
> 📎 **BA ĐOẠN LIỆT KÊ PHẦN I TRẦN — MỘT PHÁT HIỆN CỦA AW-1, VÀ CHÚNG KHÔNG BỊ XOÁ.** Trước nhiệm vụ này
> Phần I chứa **ba** đoạn liệt kê **không nằm trong khối trích dẫn nào** (ở đây, và hai đoạn nữa bên trên
> và bên dưới), mỗi đoạn nêu một tập khác nhau, và **chỉ một là hiện hành**. Một người đọc lướt gặp cả ba
> ở cùng một cấp độ trình bày. Cách file này bảo tồn một câu đã rút — giữ nó ở đúng chỗ nó được viết — là
> đúng, nhưng nó **chưa bao giờ đánh dấu cái nào còn sống**. Nay mỗi đoạn mang một dòng máy đọc:
> `<!-- gate:phần-i-rút -->` hoặc `<!-- gate:phần-i = … -->`, và cổng đòi **đúng một** cái sống. **Không
> một chữ nào của ba đoạn bị sửa và không dòng nào bị xoá.**

**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 17, 30 và 35.** Tất cả mang `🔴 CHỜ ANH` ở bảng
phán quyết trên, và **bảng ấy là nguồn sự thật** — câu này chỉ là một con trỏ vào nó.
🔴 **RÚT 2026-08-22 (BC-1) — câu ngay trên đọc *"mục 17, 25, 30, 35, 38, 39 và 40"* cho tới hôm nay, và
nó giữ nguyên văn ở đây thay vì bị xoá: mục 25 RỜI sang Phần III.** Lý do là điều kiện mà chính ô phán
quyết của mục 25 đặt ra — *"Ở LẠI PHẦN I cho tới khi phán quyết ấy thi hành xong"* — **đã thoả**: đợt 12
của mục 12 (BC-1, 2026-08-22) trả **38** chỗ trống cuối cùng, tổng **109/109**, `EXPECT_WARNINGS` về
**219**, hai hàng sổ tài liệu về **0**, và **0 mức truy cập đổi**. **Sáu mục còn lại KHÔNG bị đụng tới
bởi nhiệm vụ này.**
🔴 **MỞ RỘNG 2026-08-22 (AZ-1), không phải RÚT: mục 38 và 39 là hai khuyết tật MÃ mà đợt 9 của mục 12
DỪNG LẠI và BÁO** — chúng đã nằm trong báo cáo và trong thân mục 12 §14 suốt một vòng nhiệm vụ mà
**không có một mục nào để anh phán**, tức đúng cơ chế mục 37 mô tả. Đợt 10 **mở** chúng và **không thi
hành** chúng; cả hai được **xác nhận lại trên mã và trên assembly đã dựng** trước khi viết.
🔴 **Cập nhật 2026-08-22 (AX-1): mục 34 và 36 rời sang Phần III; mục 35 Ở LẠI vì điều kiện DỪNG của nó
đã nổ** — đóng nó đòi phát một thông điệp MQTT MỚI lên dây, tức **đổi payload MQTT**, một trong ba mục
chủ sở hữu **không** uỷ quyền. Phép đo đi kèm nằm ngay trong thân mục 35, ở phần này, không ở Phần III.
🔴 **Mục 17 ở đây là mục QUAY VỀ, không phải mục mới**: nó ở Phần III từ 2026-08-22 (AU-1, thi hành một
phần) cho tới hôm nay; cái còn treo là **một QUYẾT ĐỊNH của anh** — mặc định của `GET /v1/historian/telemetry`
— **không phải một việc còn nợ**, nên nó không thuộc Phần II. Lập luận đầy đủ ở hàng 17 của bảng và ở
đầu thân mục.
🔴 **Mục 30 ở lại đây KHÔNG phải vì chưa ai đo nó**, mà vì AV-1 được giao thi hành nó ngày 2026-08-22 và
**điều kiện DỪNG của nó đã nổ**; phép đo đi kèm nằm ngay trong thân mục, ở phần này, không ở Phần III.
🔴 **Câu này KHÔNG còn tự bảo trì bằng việc có ai đó nhìn, và đó là cái đổi kể từ hôm nay:** dòng ngay
dưới là trường máy đọc mà `scripts/check-owner-decisions.sh` so với tập đầu mục `^## ` thật sự nằm giữa
banner Phần I và banner Phần II, **và** với chính câu văn này. Lệch một số hiệu ⇒ **cổng đỏ**.
🔴 **MỞ RỘNG 2026-08-22 (BA-1): mục 40 — dụng cụ của cổng tự nó mang khuyết tật nó được dựng để bắt.**
Đây là mục ở **tầng thứ hai**: 26/32/37 nói về việc đo sản phẩm; 40 nói về việc **đo dụng cụ đo**. BA-1
**đã sửa** cả ba dụng cụ và chứng minh bằng cặp đối chứng; cái để anh phán là **cơ chế**, không phải bản
sửa. 🔴 **Và chính câu này là ví dụ của mục 40:** phép kiểm ngay trên đây đọc trường máy đọc bên dưới —
nếu tập ấy rỗng ở cả hai phía thì nó **so hai cái rỗng và vẫn xanh**; `C0` thêm hôm nay là thứ chặn đúng
ca đó, và nó được thêm vì đã **đo được** một file cho `DIVERGENCES : 0` trên **0 hàng, 0 thân mục**.
<!-- gate:phần-i-rút -->

> 📎 **PHÉP LIỆT KÊ NGAY TRÊN — RÚT 2026-08-23 (BE-1), giữ NGUYÊN VĂN, cùng kiểu bảo tồn AB-1 lập và
> AI-1/AK-1/AO-1/AP-1/AU-1/AV-1/AW-1 dùng: trích nguyên văn rồi rút, kèm ngày và người, KHÔNG gạch ngang,
> không xoá một dòng nào.** Nó đọc: *"**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 17, 30 và 35.** Tất cả
> mang `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy là nguồn sự thật** — câu này chỉ là một con trỏ
> vào nó."*
>
> **Lý do rút KHÔNG phải nó từng sai** — nó mô tả đúng trạng thái hồ sơ từ lúc BC-1 viết nó cho tới nhiệm
> vụ này. Cái làm nó lỗi thời là cơ chế **thứ hai** trong sáu — **mục được QUYẾT và THI HÀNH** — và lần
> này **cả ba mục cùng một ngày, cả ba là PHÁN QUYẾT CỦA CHỦ SỞ HỮU ngày 2026-08-23**: mục **17** (mặc
> định TẮT, có tham số) và mục **35** (ghi là nợ đã nhận, không phát) **đã thi hành** và nay ở **Phần
> III**; mục **30** (chuyển gốc sang `%ProgramData%`) **đã được phán và KHÔNG ở lại vì thiếu phán quyết**
> — nó ở lại vì **phép chuyển chưa thi hành**, và lý do là dung lượng, không phải một điều kiện DỪNG.
>
> 🔴 **VÀ MỘT CHỖ PHẢI NÓI THẲNG, VÌ NÓ LÀ CHỖ NHIỆM VỤ NÀY KHÔNG TỚI ĐƯỢC CÁI ĐÍCH ĐÃ ĐẶT RA CHO NÓ.**
> Lời giao việc của BE-1 nói rằng sau nhiệm vụ này **Phần I sẽ TRỐNG**. **Nó KHÔNG trống.** Mục 30 còn ở
> đây, và cái còn thiếu là **bản sửa mã**, không phải một quyết định của anh: hướng đã chọn, cái bẫy đã
> nêu, cái giá đã đo — xem khối `BE-1` trong thân mục 30. Viết ra ở đây thay vì để trường máy đọc bên dưới
> tự nói, vì một phép liệt kê **một số hiệu** đặt cạnh một lời hứa **"trống"** là đúng loài chỗ lệch mà
> phần này tồn tại để chấm dứt.

**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 30.** Nó mang `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng
ấy là nguồn sự thật** — câu này chỉ là một con trỏ vào nó.
🔴 **Mục 30 ở lại đây SAU KHI ĐÃ ĐƯỢC PHÁN, và đó là một trạng thái khác với mọi lần trước ở phần này.**
Chủ sở hữu **đã phán ngày 2026-08-23** — chuyển gốc sang `%ProgramData%`. Cái treo lại **không phải một
quyết định** mà là **phép thi hành**: mười sáu artefact bị bốn dụng cụ điều tra dân số cưỡng chế đi cùng
nhau, cộng **một phán quyết phụ chưa ai nêu** (bốn file vận hành viên có vào tầm xoá của
`packaging/remove-data.ps1` khi ngừng sử dụng hay không). Cả hai đo được và ghi trong thân mục.
🔴 **Nói cho hết cái ĐỊNH NGHĨA của phần này chịu được:** banner Phần I đọc *"ĐANG CHỜ ANH"*, và một mục
**đã được phán** ngồi đây là một chỗ chật. Nó ở đây chứ không ở Phần II vì Phần II đòi *"đã có một phán
quyết ghi kèm ngày, và **việc** của nó chưa được thi hành"* — mà **đúng là hình dạng của mục 30 hôm nay**.
**Nhiệm vụ này KHÔNG tự chuyển nó sang Phần II**, vì hàng bảng của nó vẫn mang `🔴 CHỜ ANH` và
`check-owner-decisions.sh` C2 đòi Phần II ghi *"việc còn nợ"*; đổi cả hai là một thao tác trên **trạng
thái đã công bố** của một mục, và người kế tiếp nên làm nó **cùng** lúc thi hành, không phải trước.
<!-- gate:phần-i-rút -->

> 📎 **PHÉP LIỆT KÊ NGAY TRÊN — RÚT 2026-08-23 (BF-1), giữ NGUYÊN VĂN, cùng kiểu bảo tồn AB-1 lập và
> AI-1/AK-1/AO-1/AP-1/AU-1/AV-1/AW-1/BE-1 dùng: trích nguyên văn rồi rút, kèm ngày và người, KHÔNG gạch
> ngang, không xoá một dòng nào.** Nó đọc: *"**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 30.** Nó mang
> `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy là nguồn sự thật** — câu này chỉ là một con trỏ vào
> nó."*
>
> **Lý do rút KHÔNG phải nó từng sai** — nó mô tả đúng trạng thái hồ sơ từ lúc BE-1 viết nó cho tới
> nhiệm vụ này. Cái làm nó lỗi thời là cơ chế **thứ hai** trong sáu, **mục được QUYẾT và THI HÀNH**:
> mục **30** thi hành xong ngày **2026-08-23** trên **hai** phán quyết của chủ sở hữu cùng ngày, và nay
> ở **Phần III** với một ghi chép thi hành ghi kèm ngày.
>
> 🔴 **VÀ ĐÂY LÀ MỘT TRẠNG THÁI CHƯA TỪNG CÓ KỂ TỪ KHI FILE NÀY ĐƯỢC LẬP: cả Phần I lẫn Phần II đều
> TRỐNG cùng một lúc.** Không một câu hỏi nào đang chờ chủ sở hữu, và không một việc đã-quyết nào chưa
> làm.
>
> 🔴 **Nói cho hết cái điều đó KHÔNG có nghĩa là gì, vì đây đúng là chỗ một cái rỗng dễ bị đọc quá
> rộng.** Nó **không** nói sản phẩm hết khuyết tật. Mười một khuyết tật đợt 12 (nặng nhất: mô-men xoắn
> SCREWDRIVE lệch ~9 lần giữa hai host), năm khuyết tật của BD-1, hai của BE-1 và một của BF-1 **đang
> mở và chưa ai phán** — chúng không ở Phần I vì **chưa có ai mở mục cho chúng**, và mục 37 nói đúng về
> khoảng trống ấy: **cái không được ghi vào file này thì không có bộ dò nào bắt.** Hai phần trống là
> một phát biểu về **hồ sơ này**, không phải về **cây mã**.

**Các mục ở đây, LIỆT KÊ chứ không đếm: KHÔNG CÒN MỤC NÀO — phần này TRỐNG.** Không mục nào mang
`🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy vẫn là nguồn sự thật** — câu này chỉ là một con trỏ
vào nó. ⚠️ **Một phần RỖNG không phải một phần BỊ XOÁ**, đúng cùng phân biệt mà Phần II đã phải nêu
ngày 2026-08-22: trạng thái *"đang chờ anh"* vẫn là một trạng thái thật và banner ở trên vẫn định nghĩa
nó; hôm nay chỉ là không có mục nào ở trong nó. 🔴 **Và dòng tóm tắt của `check-owner-decisions.sh` nay
PHÂN BIỆT được cái rỗng hợp lệ với cái hỏng** — nó in `PART I holds : []   (declared: [])`, một phép so
BẰNG ở số không; một banner hỏng in `(declared: -none-)`, hai trường máy đọc in `(declared: -ambiguous(2)-)`,
và một trường lỗi thời in chính nội dung của nó. Trước hôm nay cả bốn ca in ra **một chuỗi giống hệt
nhau**; BE-1 đo được điều đó trên bốn fixture và nêu ra, và đây là chỗ nó được trả.
<!-- gate:phần-i-rút -->

> 🔴 **PHÉP LIỆT KÊ NGAY TRÊN — RÚT 2026-08-23 (BG-1), giữ NGUYÊN VĂN, không xoá một dòng nào, và
> đánh dấu `<!-- gate:phần-i-rút -->` ngay tại chỗ nó được viết** — không ở cuối phần, vì đó là hình
> dạng thứ hai của mục 37 mà AW-1 đã đo. Nó **đúng vào ngày BF-1 viết nó**: Phần I thật sự trống
> ngày 2026-08-23. **Nhiệm vụ này làm nó sai** — mười hai mục mới, số hiệu **41–52**, vừa được đặt
> vào Phần I, và cả mười hai mang `🔴 CHỜ ANH` ở bảng phán quyết trên.
>
> 🔴 **Câu trong khối 📌 ngay phía trên nó KHÔNG được rút, và nó vừa được chứng minh đúng theo đúng
> chiều nó dự báo.** Câu ấy đọc: *"Nó **không** nói sản phẩm hết khuyết tật … chúng không ở Phần I
> vì **chưa có ai mở mục cho chúng**, và mục 37 nói đúng về khoảng trống ấy."* **Nhiệm vụ này là cái
> đóng khoảng trống ấy.** Con số trong câu ấy — *"mười một + năm + hai + một"* — thì **không** sống
> sót: xem bảng quần thể đầy đủ ở Phần IV, **ba mươi ba ứng viên**.

**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51 và 52.** Tất cả
mang `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy vẫn là nguồn sự thật** — câu này chỉ là một con
trỏ vào nó. Bảy mục — **41, 42, 43, 44, 45, 46, 47** — chạm một trong **ba miễn trừ** và **chỉ anh
quyết được**. Năm mục còn lại — **48, 49, 50, 51, 52** — mang nhãn ⚖️ **"điều phối viên quyết được"**:
chúng nằm trọn trong uỷ quyền, nên một nhiệm vụ sau **không cần chờ anh** để thi hành chúng.
<!-- gate:phần-i = 41 42 43 44 45 46 47 48 49 50 51 52 -->


> 📎 **MỞ RỘNG 2026-08-20 (AO-1), KHÔNG phải RÚT — phép liệt kê ngay trên đọc *"… mục 30 và 31"* cho
> tới vòng sửa thứ hai của cùng ngày, và nó **không sai, nó THIẾU**.** Ba thao tác của file này vẫn
> phân biệt: **RÚT** (câu đã công bố nay sai), **MỞ RỘNG** (phép liệt kê thiếu), **SỬA TẠI CHỖ** —
> đây là cái thứ hai. **Mục 32** được thêm sau khi điều phối viên chạy đúng phép đo mà báo cáo của
> AO-1 tuyên bố là *"không giải được từ chỗ tôi đứng"*, và phép đo ấy **nổ**. 🔴 **Đây là lần thứ
> TƯ trong ba ngày tập này đổi, và là cơ chế thứ NĂM: không phải thêm mục qua phản biện, không phải
> quyết mục, mà là MỘT PHÉP ĐO BÁC LỜI KHAI MIỀN CỦA CHÍNH PHÉP ĐO TRƯỚC ĐÓ.** Cách viết
> **liệt kê, không đếm** lại là thứ làm phép mở rộng này rẻ: một phép liệt kê thiếu sửa được bằng
> cách thêm một số hiệu; một con số `17` viết ở đây sẽ phải bị rút.

> 📎 **Câu ngay trên đọc, NGUYÊN VĂN, cho tới 2026-08-19 — RÚT cùng ngày (AK-1), giữ nguyên
> văn, cùng kiểu bảo tồn AB-1 lập và AI-1 dùng:** *"**Mục ở đây, LIỆT KÊ chứ không đếm: mục
> 14.** Nó mang `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy là nguồn sự thật** — câu này
> chỉ là một con trỏ vào nó."* Lý do rút là **chủ sở hữu đã phán mục 14** ngày **2026-08-19**
> (lựa chọn 3), mục ấy **đã thi hành** và **đã chuyển sang Phần III** với một ghi chép thi hành
> ghi kèm ngày — **không phải câu ấy từng sai**: nó mô tả đúng trạng thái hồ sơ cho tới đúng
> lúc ấy. 🔴 **Cách viết của nó — liệt kê, không đếm — được giữ nguyên và chính nó là cái làm
> phép rút này rẻ:** một phép liệt kê rỗng đọc được là rỗng; một con số `0` viết ở đây sẽ là
> đúng thứ ba khối dưới đã bắt ba lần.

> 🔴 **Câu này đọc *"Một mục ở đây, và chỉ một: mục 9"* cho tới 2026-08-18, và nó thành sai
> ĐÚNG LÚC mục 13 được thêm — cùng nhiệm vụ, cùng ngày (phản biện I-2).** Giữ lại ở đây vì
> đó là hình dạng mà file này bắt: một con số đếm một tập, viết ở một chỗ, trong khi tập
> ấy đổi ở chỗ khác.
>
> 🔴 **Và nó thành sai LẦN THỨ HAI, cùng ngày, cùng cơ chế — AA-1 vòng phản biện 1 thêm mục
> 14.** Câu *"Hai mục ở đây: mục 9 và mục 13"* giữ nguyên văn ở đây, **RÚT 2026-08-18**. Hai
> lần trong một ngày là đủ để nói ra cái chung: **con số này đếm một tập mà bất kỳ vòng phản
> biện nào cũng có thể nới**, nên nó phải được đọc cùng bảng phán quyết, không thay bảng.
>
> 🔴 **LẦN THỨ BA — 2026-08-19, AJ-1, và lần này tập CO LẠI chứ không nới.** Câu *"Ba mục ở
> đây: mục 9, mục 13 và mục 14. Cả ba mang `🔴 CHỜ ANH` ở bảng phán quyết trên."* giữ nguyên
> văn ở đây, **RÚT 2026-08-19**: chủ sở hữu phán mục 9 và mục 13 cùng ngày, cả hai đã thi
> hành, và cả hai đã chuyển sang **Phần III**. Ba lần trong hai ngày, ba cơ chế khác nhau
> (thêm mục, thêm mục, **quyết mục**) — nên câu thay thế **không mang một con số nào**: nó
> **liệt kê**, và trỏ vào bảng. Một phép liệt kê sai thì sai **nhìn thấy được**; một con số
> sai thì không.

> 📎 **PHÉP LIỆT KÊ Ở TRÊN — RÚT 2026-08-22 (AT-1), giữ NGUYÊN VĂN, cùng kiểu bảo tồn AB-1 lập và
> AI-1/AK-1/AO-1/AP-1 dùng: trích nguyên văn rồi rút, kèm ngày và người, KHÔNG gạch ngang, không xoá một
> dòng nào.** Nó đọc: *"**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 16, 17, 18, 19, 20, 21, 22, 23, 24,
> 25, 26, 27, 28, 29, 30, 31 và 32.** Tất cả mang `🔴 CHỜ ANH` ở bảng phán quyết trên, và **bảng ấy là
> nguồn sự thật** — câu này chỉ là một con trỏ vào nó."*
>
> 🔴 **VÀ LÝ DO RÚT CÓ HAI NỬA, KHÔNG MỘT — nửa thứ hai là một phát hiện, không phải một thao tác dọn
> dẹp.** *Nửa thứ nhất, do nhiệm vụ này:* **mục 16 và mục 27 đã được CHỦ SỞ HỮU phán ngày 2026-08-22 và
> đã THI HÀNH ngày 2026-08-22 (AT-1)**; cả hai nay ở **Phần III**, mỗi mục mang một ghi chép thi hành ghi
> kèm ngày. *Nửa thứ hai, và nó có TRƯỚC nhiệm vụ này:* phép liệt kê ấy **đã sai từ trước khi AT-1 chạm
> vào file** — **CHÍN** mục đã rời Phần I mà **không** ai sửa nó. Mục **18, 19, 20, 22, 23, 24** rời bằng
> AR-1 (2026-08-21) và mục **28, 29** rời bằng AS-1 (2026-08-21), cộng mục **21** mà AQ-1 có ghi. **Ba
> nhiệm vụ liên tiếp chuyển mục sang Phần III và không nhiệm vụ nào cập nhật phép liệt kê ở đây.**
>
> 🔴 **Và cùng phát hiện ấy bắt một CON SỐ, ở khối AQ-1 cuối đoạn dưới: *"Số mục còn chờ ở Phần I: **mười
> sáu** (16–20, 22–32)"*.** Câu ấy **đúng vào ngày nó được viết** (2026-08-21, trước AR-1/AS-1) và **giữ
> nguyên văn, không xoá**; nó **RÚT ở đây, 2026-08-22**, vì chín mục rời đi sau đó đã làm nó sai.
> **Đây đúng là loài mà file này lập ra để chấm dứt, và nó xảy ra ở chính chỗ file này dạy cách tránh:**
> một con số đếm một tập, viết ở một chỗ, trong khi tập ấy đổi ở chỗ khác — bốn khối ngay trên nói đúng
> câu đó. 📎 **Cách viết LIỆT KÊ vẫn thắng, và lần này đo được là nó thắng:** phép liệt kê sai **nhìn
> thấy được** khi đọc cạnh Phần I (thiếu số hiệu nào là lộ ra), còn con số `mười sáu` **không tự tố cáo**
> — không ai đọc ra nó sai cho tới khi có người đếm lại. **Cổng không bắt được cái nào trong hai:** nó
> không đọc file này.

**Các mục ở đây, LIỆT KÊ chứ không đếm: mục 17, 25, 26, 30, 31 và 32.** Tất cả mang `🔴 CHỜ ANH` ở bảng
phán quyết trên, và **bảng ấy là nguồn sự thật** — câu này chỉ là một con trỏ vào nó. 🔴 **Phép liệt kê
này được ĐO LẠI từ chính Phần I sau khi nhiệm vụ này sửa xong file** — quét đầu mục `^## ` giữa banner
Phần I và banner Phần II — chứ không chép từ brief: brief của AT-1 khai **tám** mục (16, 17, 25, 26, 27,
30, 31, 32), và **tám ấy đúng ở BASE `ce1ce2be`**, trước khi mục 16 và 27 rời đi.
<!-- gate:phần-i-rút -->

> 📎 **PHÉP LIỆT KÊ NGAY TRÊN — RÚT 2026-08-22 (AW-1), giữ NGUYÊN VĂN, không xoá một dòng nào, và
> đánh dấu `<!-- gate:phần-i-rút -->` thay vì để nó tiếp tục đọc như một đoạn đang sống.** Nó đúng vào
> ngày AT-1 viết nó và **không đúng kể từ AU-1**: mục 26 và 32 nay ở Phần III, mục 31 rời đi ngày
> 2026-08-22 (AV-1), và mục 34–37 chưa tồn tại khi câu ấy được viết. 🔴 **Chỗ đáng nói không phải nó
> sai — mà là nó nằm BÊN DƯỚI đoạn liệt kê hiện hành ở cùng một cấp độ trình bày, nên thứ tự đọc trên
> trang KHÔNG nói được cái nào mới hơn.** Ba đoạn như thế nằm trong Phần I trước hôm nay. Đó là hình
> dạng thứ hai của mục 37, đo được trong chính phần mà mục 37 mở ra để nói về: một hồ sơ chỉ **thêm
> vào** thì cuối cùng có nhiều câu cùng khẳng định một trạng thái, và **không câu nào trong số đó nói nó
> có còn đúng hay không**.

**Cho tới 2026-08-18 phần này có năm mục — 8, 9, 10, 11, 12.** Bốn trong số đó nay **đã
được quyết**, và **ai quyết cái nào là một phần của hồ sơ, không được gộp lại**: mục
**10, 11 và 12 do CHỦ SỞ HỮU**; mục **8 do ĐIỀU PHỐI VIÊN, theo uỷ quyền**. Mục 9 bị
**hoãn**. Bốn mục đã quyết **không rời khỏi file**: chúng chuyển sang **Phần II**, chỗ
dành cho một mục đã có phán quyết mà việc thì chưa làm.

**Và ba trong bốn mục ấy đã đi tiếp, cùng ngày:** mục **8, 10 và 11** được thi hành bởi
nhiệm vụ **Z-1** (2026-08-18) và nay nằm ở **Phần III**, mỗi mục mang một **ghi chép thi
hành ghi kèm ngày** — đúng điều kiện mà banner Phần II đặt ra. Mục **12** ở lại Phần II
(nhiều vòng, chưa làm). Mục **9** ở lại đây.

⏸️ **~~Một lần hoãn không phải một phán quyết, và mục 9 ở lại đây vì thế.~~** Luật của file
này đòi một **quyết định** ghi kèm ngày và người quyết; *"để lại sau cùng"* ghi **thứ
tự**, không ghi **kết quả**.

> 🔴 **NỬA ĐẦU RÚT 2026-08-19 (AJ-1), giữ nguyên văn, và rút TẠI CHỖ NÓ ĐƯỢC VIẾT.** Lần
> hoãn ấy **đã kết thúc**: chủ sở hữu phán mục 9 ngày **2026-08-19** — **(b) áp sàn `ST4I_*`
> VÀ lưu** — nên mục 9 **không còn ở đây** mà ở **Phần III**, với một ghi chép thi hành ghi
> kèm ngày. **Nửa sau KHÔNG được rút**: *"một lần hoãn ghi thứ tự, không ghi kết quả"* vẫn
> là luật của file này, và nó vừa được chứng minh đúng theo chiều thuận — cái kết thúc lần
> hoãn là một **phán quyết**, không phải thời gian trôi qua.

Mục dưới đây mang **bằng chứng của nó ở dòng cuối của chính nó**, không phải ở một phụ
lục. Đó là chỗ ranh giới được vạch: **đầu vào của quyết định** (hôm nay chuyện gì xảy
ra, ai chịu, nếu không quyết thì sao, cái gì đã chặn nó khỏi được sửa luôn) đi trước,
**bằng chứng** đi ngay sau nó **trong cùng một mục** — vì một khẳng định tách khỏi nhân
chứng của nó là một khẳng định **không kiểm được**, đúng thứ file này lập ra để chấm dứt.

> 📎 **MỞ RỘNG 2026-08-19 (AK-1), KHÔNG phải RÚT — câu ngay trên giữ nguyên văn vì nó KHÔNG
> sai, nó chỉ **không còn trỏ vào cái gì**.** *"Mục dưới đây"* là **rỗng** kể từ khi mục 14
> rời sang Phần III, nên câu ấy đọc lúc này như **luật viết cho mục KẾ TIẾP đặt vào đây**, và
> đó đúng là vai trò còn lại của nó. Ba thao tác vẫn phân biệt như file này quy định: **RÚT**
> (câu sai hoặc đã hết đúng), **MỞ RỘNG** (câu thiếu), **SỬA TẠI CHỖ** — đây là cái thứ hai.

🔴 **Cái mục 9 CHƯA có, nêu tên chứ không lấp:** nó không bày ra **các lựa chọn kèm giá
ĐÃ ĐO** của từng lựa chọn. Giá ấy phải được **đo**; một lần ghi chép không đo được nó, và
một con số ước lượng đặt ở đây sẽ **đọc như một phép đo**. (Y-1, 2026-08-18.)

> 📎 **Đoạn ngay trên — RÚT 2026-08-19 (AI-1), giữ nguyên văn**, và rút **tại chỗ nó được viết** chứ
> không chỉ ở mục 9, đúng như tiền lệ của file này (*"Cả hai câu sai đã được sửa tại chỗ chúng được
> viết, không chỉ ở đây"*). Lý do là **phép đo đã chạy** — mục 9 §"✅ ĐÃ ĐO 2026-08-19" — **không phải
> câu ấy từng sai**: nó mô tả đúng trạng thái hồ sơ cho tới đúng lúc ấy. Câu cuối của nó (*"một con số
> ước lượng đặt ở đây sẽ đọc như một phép đo"*) **KHÔNG được rút**: nó vẫn là luật, và phép đo mới
> tuân nó bằng cách **nêu tên** ba chỗ nó không đo được thay vì lấp bằng số.
>
> 🔴 **Và mục 13 mang CÙNG đoạn ấy, bằng cùng chữ, ở thân của chính nó** — nó cũng được rút, cùng ngày,
> cùng người, cùng lý do. Nêu ở cả hai chỗ vì một lời cải chính chỉ đặt ở một trong hai là đúng khuyết
> tật file này lập ra để chấm dứt.

---

> 🔴 **VỀ CẢ MƯỜI BẢY MỤC DƯỚI ĐÂY — MỘT ĐOẠN, ĐỌC TRƯỚC KHI ĐỌC BẤT KỲ MỤC NÀO.** Không mục nào
> trong số này được đo lần đầu bởi nhiệm vụ mở chúng. Mười hai cái đầu do các đợt **AL-1, AM-1,
> AN-1** đo trong lúc trả món nợ tài liệu của mục 12; hai câu hỏi cuối bị **các brief liên tiếp
> cấm mở** và lệnh cấm ấy hết hiệu lực ở đây; ba cái ở giữa do **điều phối viên** đo trong một
> lần chạy thử hoàn chỉnh. **Nhiệm vụ mở chúng (AO-1, 2026-08-20) không sửa một dòng mã nào,
> không quyết một mục nào, không đo lại một cảnh báo nào, và không dịch một hằng số nào.**
>
> 🔴 **Nhưng nó cũng KHÔNG chép lại lời của người khác.** Mọi khẳng định dưới đây đã được **mở mã
> ra và xác nhận lại** ở SHA `3a614f1c`, bằng `git grep <mẫu> <SHA> -- .` chứ không phải `grep -r`
> trên cây làm việc — cây này là **sparse checkout** và `server/`, `client/` **không nằm trên
> đĩa**. **Ba chỗ báo cáo nguồn nói sai hoặc nói quá đã được sửa lại tại chỗ, và mỗi chỗ được nêu
> tên trong chính mục của nó**: mục **15** (tập là **BA** chỗ chứ không phải hai, và có chỗ thứ
> tư đã giải xong), mục **24** (không host sản xuất nào viết cứng chuỗi ấy), mục **28** (trần là
> ba con số, và UI không gọi tên cái nào là trần). **Một cái sai trong một báo cáo nguồn là một
> phát hiện, không phải một lỗi chính tả**, nên nó đứng trong mục chứ không ở một chú thích.
>
> 📎 **MỞ RỘNG 2026-08-21 (AP-1), KHÔNG phải RÚT — khối trên giữ NGUYÊN VĂN vì nó KHÔNG sai, nó chỉ
> **trỏ hụt một mục**.** *"Mười bảy mục dưới đây"* đọc đúng vào ngày nó được viết (mười bảy dưới đây +
> mục 32 thêm ở vòng sửa cùng ngày). Kể từ 2026-08-21, **mục 15 không còn ở dưới đây**: nó đã được quyết
> và đã thi hành, và nằm ở **Phần III**. Mọi câu khối này nói **về** mục 15 — rằng tập là **BA** chỗ chứ
> không phải hai, rằng có chỗ **thứ tư** đã giải xong, rằng khẳng định ấy đã được mở mã ra xác nhận lại
> ở SHA `3a614f1c` — **vẫn đúng từng chữ**, và AP-1 đã đo lại chúng lần nữa trên mã trước khi sửa. Chỗ
> đọc chúng nay là Phần III.
>
> 📎 **MỞ RỘNG LẦN HAI 2026-08-21 (AQ-1), cùng lý do và cùng kiểu.** Kể từ nhiệm vụ này, **mục 21
> cũng không còn ở dưới đây** — đã quyết theo uỷ quyền và đã thi hành, đọc ở **Phần III**. **Mục 16
> thì VẪN Ở ĐÂY**, và đó là một sự thật cần nói rõ chứ không để suy ra: AQ-1 được giao thi hành nó,
> **điều kiện DỪNG trong brief đã nổ**, nên mục **không** được thi hành. Nó nay mang thêm một khối đo
> ngày 2026-08-21 **bác một tiền đề của chính nó** và **đổi câu hỏi** chủ sở hữu đang được mời quyết —
> đọc khối ấy trước khi quyết mục 16. Số mục còn chờ ở Phần I: **mười sáu** (16–20, 22–32).


---

> 🔴 **VỀ CẢ MƯỜI HAI MỤC DƯỚI ĐÂY — MỘT ĐOẠN, ĐỌC TRƯỚC KHI ĐỌC BẤT KỲ MỤC NÀO.**
>
> **Không mục nào trong số này được đo lần đầu bởi nhiệm vụ mở chúng.** Chúng là những khuyết tật mà
> chín đợt gần nhất **đã đo được và CỐ Ý KHÔNG SỬA** — đúng luật, vì mỗi cái cần một phán quyết hoặc
> nằm ngoài phạm vi của đợt tìm ra nó. Cho tới hôm nay chúng **chỉ sống trong thông điệp merge và
> trong `.superpowers/sdd/*/task-1-report.md`**, và **`.superpowers/` bị gitignore** — nên chủ sở hữu
> **không có đường dẫn nào để mở chúng**. Đó **chính xác** là thiếu sót mà mục 37 mở ra để nói về, và
> đây là lần thứ **hai** file này phải trả nó (lần đầu: AU-1, 2026-08-22, năm phát hiện thành mục
> 34–37).
>
> 🔴 **QUẦN THỂ ĐƯỢC LIỆT KÊ TRƯỚC RỒI MỚI ĐẾM, và con số điều phối viên đưa xuống KHÔNG SỐNG SÓT.**
> Lời giao việc nói *"mười tám"*. Đoạn 📌 ngay trên khối này — do BF-1 viết — nói *"mười một + năm +
> hai + một"* = **mười chín**. Cả hai đều là **một số vô hướng tóm tắt một tập chưa ai liệt kê**.
> Liệt kê từ nguồn cấp một (bốn `task-1-report.md` **cộng** thông điệp merge của AV-1, AW-1, AX-1,
> AY-1, AZ-1, BA-1, BB-1, BC-1, BD-1, BE-1, BF-1 đọc bằng `git log`, không bằng trí nhớ) trả về
> **ba mươi ba mục ứng viên**, xem bảng đầy đủ ở **Phần IV**. Chỗ hai con số cũ hụt là **BB-1 (sáu) và
> AV-1 (năm)**: hai đợt ấy ghi khuyết tật của mình **CHỈ trong thông điệp merge**, và không báo cáo
> nào trong bốn cái được lời giao việc nêu tên nhắc lại chúng.
>
> 🔴 **MỖI CÁI ĐƯỢC MỞ MÃ RA XÁC NHẬN LẠI, và BẢY cái KHÔNG THÀNH MỤC** — **năm** vì đã được trả
> hoặc đã được phán ở nơi khác, **hai** vì không tái lập được / không phải một tính chất của cây.
> Cả bảy nằm ở **Phần IV** kèm phép đo, **không** mở thành mục. Mọi phép đo dưới đây chạy qua
> `scripts/repo-scan.sh` với **pathspec tường minh** ở SHA `9255ea98`, **đứng tại
> `D:\SOURCES\avi-aoi-sim` (gốc repo)** — ghi lại vì cây này là **sparse checkout**: `server/` và
> `client/` **có trong commit, KHÔNG có trên đĩa**, và đợt trước vừa trả giá cho đúng chỗ ấy.
>
> **Nhiệm vụ mở chúng (BG-1, 2026-08-23) không sửa một dòng mã nào** — chứng minh bằng
> `git diff --numstat 9255ea98..HEAD -- '*.cs'`, **rỗng** — **không quyết một mục nào**, và **không
> dịch một hằng số nào**: `2852` và `219` đứng nguyên.
>
> ⚖️ **VỀ NHÃN "ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC" trên năm mục 48–52.** Nó **không** có nghĩa mục ấy đã được
> quyết; nó có nghĩa **không cần chờ anh**: cả năm nằm trọn trong uỷ quyền — không đổi payload MQTT,
> không đổi hình dạng dây, không đổi con số OEE/đã báo cáo, không gỡ tên công khai. Chúng vẫn mang
> `🔴 CHỜ ANH` ở bảng vì **chưa ai quyết chúng**, và vì banner của phần này định nghĩa đúng thế.
> 🔴 **Nói cho hết chiều ngược lại:** nhãn ấy là **lời khai của BG-1**, không phải một phép đo — không
> dụng cụ nào trong repo này kiểm được rằng một hướng sửa đề xuất **không** chạm ba miễn trừ, và mục
> 37 nói đúng về khoảng trống ấy.

## 41. 🔴 Nối một config store làm MÔ-MEN XOẮN SCREWDRIVE báo ra lệch ~9 lần (12,0 → 1,35 Nm), nên HAI HOST trong cùng sản phẩm báo VẬT LÝ KHÁC NHAU cho cùng một descriptor

**Đây là mục nặng nhất trong mười hai mục mở hôm nay, và nó được viết kỹ hơn phần còn lại vì nó gần
như chắc chắn đổi một CON SỐ ĐÃ BÁO CÁO** — cùng lớp mục 16, thứ chủ sở hữu **không uỷ quyền**.

### 41.1 Đo được cái gì

`ScrewdriveSim` giải mô-men **hai lần khác nhau tuỳ có store hay không**, và cả hai nhánh nằm trong
ba biểu thức ba ngôi cạnh nhau:

* **Không store** — hằng số của chính lớp: `torque ~ N(12,0 · 0,4)` Nm, dải chấp nhận `[10,8 ; 13,2]`.
* **Có store** — một bản ghi `screw_program` vừa được `Ensure` gieo từ **giá trị mặc định của
  schema**, nên `torqueTarget = 1,35`, `torqueTolerance = 0,15`, độ lệch chuẩn thành
  `torqueTarget · 0,03 = 0,0405`, và dải thành `[1,20 ; 1,50]`.

**Không ai chạm vào gì.** Chỉ cần *có* một store là con số báo ra rơi từ ~12 Nm xuống ~1,35 Nm —
**hệ số 8,89**.

🔴 **Và bốn chỗ gọi `SimulatorFactory.Create` trong `src/` chia làm hai phe**, đo bằng
`scripts/repo-scan.sh --sha HEAD -n 'SimulatorFactory\.Create' -- '*.cs'`, đứng tại gốc repo:

| host | chỗ gọi | truyền store? | mô-men báo ra |
|---|---|---|---|
| `St4i.EngineApi` (qua `FleetCore`) | `Fleet/FleetCore.cs` — hai chỗ trong `StartLocked` và nhánh reuse-miss | **CÓ** (`_configStore`) | **~1,35 Nm** |
| `St4i.EdgeService` (dịch vụ Windows headless) | `EdgeWorker.cs`, dòng dựng `sims` | **KHÔNG** | **~12,0 Nm** |
| `St4iMachineSimulator` (ứng dụng WPF) | `Services/FleetService.BuildSimulator` | **KHÔNG** | **~12,0 Nm** |

Nên câu đúng không phải *"hai host"* mà là **một host có dây và HAI host không có dây**. Doc comment
của chính `ScrewdriveSim` viết *"hai host"*; con số đúng là **ba host, chia 1–2**. Sửa lại **ở đây**,
không trong mã, vì nhiệm vụ này không sửa mã.

### 41.2 Ở đâu trong mã — nêu bằng TÊN

* `src/St4i.EdgeCore/Drivers/Simulators/ScrewdriveSim.cs` — `TorqueMean`/`TorqueStd`/`TorqueLsl`/
  `TorqueUsl` (12,0 / 0,4 / 10,8 / 13,2), `ProcessNoiseFraction` (0,03), và `NextCycle`, nơi
  `torqueStd`, `lsl` và `usl` mỗi cái mang một biểu thức `cfg is null ? … : …`.
* `src/St4i.EdgeCore/Config/MachineParameterSchema.cs` — `torqueTarget` mặc định **1,35** (miền cứng
  0,10–20,00) và `torqueTolerance` mặc định **0,15** (miền cứng 0,00–5,00). 🔴 **12,0 nằm TRONG miền
  hợp lệ**, nên không phép kiểm nào ở đây bác được nó — cái này không phải một giá trị xấu lọt lưới.
* `src/St4i.EdgeCore/Fleet/FleetCore.cs`, `src/St4i.EdgeService/EdgeWorker.cs`,
  `src/St4iMachineSimulator/Services/FleetService.cs` — ba host, xem bảng trên.

### 41.3 🔴 HOST NÀO ĐÚNG? — **KHÔNG XÁC ĐỊNH ĐƯỢC TỪ CÂY NÀY**, và đó là NỘI DUNG của mục

Phép đo chạy trên **toàn commit**, gồm cả `server/` và `client/` (**có trong commit, KHÔNG có trên
đĩa** — sparse checkout), bằng `repo-scan.sh` với pathspec tường minh, đứng tại gốc repo. Hai phe,
mỗi phe có bằng chứng cấp một, và **không phe nào chỉ là "ví dụ trong tài liệu"**:

**Bên 1,35 Nm — dữ liệu cấu hình của CHÍNH sản phẩm này, hai lớp độc lập cùng nói một điều:**
* `src/St4i.EdgeCore/Config/MachineParameterSchema.cs` — mặc định của schema tham số máy.
* `src/St4i.EdgeCore/Config/ProductConfigStore.cs` — công thức gieo mầm, `["torqueTarget"] = 1.35`.
* `src/St4i.EngineApi/Config/SimulatedEcosystem.cs` — hệ sinh thái mô phỏng **nâng nó lên 1,40** và
  ghi lý do *"cập nhật từ hệ thống trung tâm (torque +0.05 Nm)"* — tức nó coi 1,35 là **giá trị nền
  thật**, không phải một chỗ giữ chỗ.
* 🔴 **Và công thức ấy TỰ NÊU LOẠI VÍT:** `Code = "SCREWDRIVE-M4"`,
  `Name = "M4 screw - standard torque profile"`. 1,35 Nm là mô-men hợp lý cho **một con vít M4**.

**Bên ~12 Nm — hợp đồng đã XUẤT BẢN ra ngoài, và một lần chạy PILOT có thật:**
* `ScrewdriveSim` tự khai nguồn của hằng số là **doc-62 §6**.
* `docs/ECOSYSTEM/61_MACHINE_DEVELOPER_INTEGRATION_GUIDE_2026-07-18.md` — ví dụ chuẩn cho nhà tích
  hợp, **ba chỗ**: `torque 12,1–12,2 Nm, lsl 10,5, usl 13,5, nominal 12,0`.
* `examples/device-client/csharp/ExampleScrewdriver.cs` — **client tham chiếu giao cho nhà tích
  hợp** — cùng con số.
* `docs/ECOSYSTEM/56B_D3_PILOT_LIVE_EVIDENCE_2026-07-18.md` và `scripts/pilot-config-sync.mjs` — một
  payload **pilot đã chạy round-trip**: `torqueTarget: 12,5, torqueTolerance: 0,5`.

🔴 **Kết luận, và nó là một lời khai KHÔNG XÁC ĐỊNH chứ không phải một phỏng đoán:** hai con số
**không phải hai giá trị của một đại lượng** — chúng là **hai con vít khác nhau**. Một vít M4 xiết
1,35 Nm và một bu-lông xiết 12,5 Nm đều là "máy bắt vít" đúng nghĩa, và cả hai đều **hợp lệ với
schema**. Cái tôi mở **hết** tập và không tìm thấy — miền: mọi `*.cs`, `*.ts`, `*.tsx`, `*.md`,
`*.json` trong commit `9255ea98` — là **một artefact nào nói descriptor SCREWDRIVE của fleet demo là
con vít nào**. Không có. Nên câu trả lời cho *"host nào đúng"* là: **không xác định được từ cây
này, và câu hỏi quay về anh cùng với mục.**

### 41.4 Bề mặt ĐỌC — §8.1(h5.4): liệt kê trước, rồi mới nói con số nào đi ra ngoài

1. 🔴 **RA NGOÀI SẢN PHẨM** — `Mapping/Normalizer.cs`, `NormalizeProcessResult` đóng gói
   `metrics[].value / lsl / usl / nominal` vào `POST /api/v1/ingest/process-result`. **Cả bốn con số
   đều đi ra**, không chỉ giá trị.
2. **Historian cục bộ** — `Historian/HistorianModels.cs`, `HistorianResultRecord.From` giữ
   `reading.Metrics[0]` thành `KeyMetricName / KeyMetricValue / KeyMetricUnit`. Với SCREWDRIVE,
   `Metrics[0]` **chính là** `torque`.
3. **Báo cáo PDF đã in** — `St4i.EngineApi/Endpoints/HistorianEndpoints.cs`,
   `GET /v1/historian/report.pdf`: **một khối OEE và một bảng phân rã phán quyết**.
4. **OEE** — `Metrics/OeeCalculator.cs`: `Quality = GoodCount / TotalCount`, *good* = `Pass` hoặc
   `Warn` (mục 2). Mô-men vào OEE **qua phán quyết**, không qua giá trị.
5. **Sparkplug/UNS** — `Uns/UnsPublisher.cs` và `Uns/Sparkplug/SparkplugPayload.cs` đọc `Metrics`.
6. **UI của WPF** — `St4iMachineSimulator/ViewModels/MachineViewModel.cs`.
7. 🔴 **SYNAPSE — trong CÙNG commit này, ngoài đĩa** (đo bằng `repo-scan.sh`, **không** bằng
   `grep -r`, vì `grep -r` trả 0 cho `server/` trên cây này):
   `server/routers/processResultAnalytics.ts` (`metricSeries`, `spcChart` **có nhận `usl`/`lsl`**),
   `client/src/pages/ProcessAnalytics.tsx` (**metric mặc định của trang là `"torque"`**), và
   `server/services/aiLocalTools/` — `intentClassifier.ts` ánh xạ *"torque | lực siết | mô-men"*
   thành `metricKey: "torque"`, rồi `handlersF6.ts`/`handlersF7.ts` trả lời bằng **SPC**. Nghĩa là
   **trợ lý AI của hệ thống trung tâm trả lời câu hỏi về mô-men bằng chính con số này.**

**Con số nào ĐÃ đi ra ngoài:** giá trị mô-men, `lsl`, `usl`, `nominal` — trên đường ingest, vào SPC,
vào biểu đồ, vào trợ lý AI. 🔴 **OEE KHÔNG mang giá trị mô-men**; nó mang **hệ quả** của nó, và đó
là một phân biệt mục này phải giữ cho đúng, vì nó quyết định phép sửa đắt tới đâu.

### 41.5 Sửa nó đổi con số nào, theo chiều nào — và báo cáo đã in có đổi không

🔴 **Số học dưới đây SUY TỪ HẰNG SỐ TRONG MÃ, không phải từ một lần chạy** — cùng cái trần BC-1 đã
nêu về họ bộ mô phỏng này. `VerdictHelper` dùng `margin = (usl − lsl) · 0,15`:

| | không store | có store | tỉ số |
|---|---|---|---|
| trung bình | 12,0 Nm | 1,35 Nm | **÷ 8,89** |
| σ | 0,4 | 0,0405 | ÷ 9,88 |
| dải | `[10,8 ; 13,2]` | `[1,20 ; 1,50]` | |
| `margin` | 0,36 | 0,045 | |
| ngưỡng `Warn` | \|z\| > 2,1 | \|z\| > 2,59 | |
| **tỉ lệ `Warn`** | **≈ 3,6 %** | **≈ 0,95 %** | **÷ 3,7** |
| ngưỡng `Fail` | \|z\| > 3,9 | \|z\| > 4,81 | |
| **tỉ lệ `Fail`** | **≈ 9,6·10⁻⁵** | **≈ 1,5·10⁻⁶** | **÷ 64** |

* **Giá trị metric đi ra ngoài:** đổi **theo hệ số ~8,9** — giảm nếu nối dây, tăng nếu tháo dây.
* **OEE `Quality`:** `Warn` tính là TỐT, nên chỉ `Fail` chạm vào nó. `Quality` đi từ ≈ 0,99990 lên
  ≈ 0,999998 — **dịch ở chữ số thập phân thứ tư**. Mọi bề mặt in OEE ở hai chữ số **không đổi trên
  màn hình**. Đó là chiều làm phép sửa **rẻ hơn** người ta tưởng, và nó phải được nói ra.
* 🔴 **Báo cáo PDF thì CÓ đổi — không ở khối OEE mà ở BẢNG PHÂN RÃ PHÁN QUYẾT:** cột `Warn` dịch
  **khoảng 3,7 lần**. Trên một ca 1 000 chu kỳ: **~36 hàng `Warn` so với ~10**. Đây là con số duy
  nhất trong mục này mà **một người cầm bản in sẽ thấy khác đi**.

### 41.6 Hậu quả vận hành, HAI CHIỀU — gồm cả chiều nói rằng để nguyên cũng có lý

**Chiều nói phải sửa:**
* Hai khách hàng, một chạy `St4i.EdgeService` và một chạy `St4i.EngineApi`, **cùng một `fleet.json`**,
  gửi lên SYNAPSE hai quần thể mô-men chênh nhau ~9 lần **dưới cùng một `machineCode`**. `spcChart`
  trộn chúng thì Cp/Cpk vô nghĩa, và trợ lý AI trả lời bằng con số trộn ấy.
* Không dụng cụ nào trong repo bắt được: **không bài test nào so mô-men GIỮA HAI HOST**, và cả hai
  giá trị đều hợp lệ với schema, nên không phép kiểm miền nào chạm tới.

**Chiều nói để nguyên cũng có lý, và nó không yếu:**
* 🔴 **Hướng "nối store ở cả ba host" làm con số mà nhà tích hợp ĐANG ĐỌC rơi 9 lần.** Hợp đồng đã
  xuất bản, client tham chiếu và bằng chứng pilot đều ở ~12 Nm. Nối dây là **viết lại một con số bên
  thứ ba đang dựa vào** — đúng lý do mục 2 và mục 3 được GIỮ.
* Hướng ngược lại — nâng mặc định của schema từ 1,35 lên 12,0 — **phá công thức `SCREWDRIVE-M4` của
  chính sản phẩm** và mọi bản ghi `screw_program` đã gieo trên đĩa của khách.
* Và **để nguyên** giữ được một tính chất thật: mỗi host hôm nay **tự nhất quán**; không dữ liệu nào
  đang sai *bên trong một host*. Cái sai là **hai tập không so sánh được với nhau mà không ai khai**.

### 41.7 Nếu không quyết thì sao

Hành vi hôm nay giữ nguyên, và ba host tiếp tục báo vật lý khác nhau cho cùng một descriptor. 🔴 **Cái
xấu đi theo thời gian không phải mã mà là DỮ LIỆU:** mỗi ngày, historian và SYNAPSE tích thêm hàng
dưới cùng một `machineCode` từ hai phân bố khác nhau, và **không cột nào ghi host nào đã sinh ra
hàng ấy** — nên một phép sửa hồi tố sau này **không tách lại được hai tập**. Đó là lý do mục này
không nên nằm chờ lâu. Nó cũng là lý do một phán quyết *"GIỮ, XUẤT BẢN NÓ"* — đúng hình dạng mục 2
và mục 3 — **vẫn là một kết cục hợp lệ**, miễn là nó được ghi: cái không được ghi thì không có bộ dò
nào bắt.

### 41.8 Cái mục này CHƯA có, nêu tên chứ không lấp

* **Không nhân chứng.** Không bài test nào ghim khoảng cách 9 lần, và nhiệm vụ này **không được thêm
  test** (tổng `2852` không được dịch). Bảng §41.5 là **số học tay từ hằng số**, không phải một lần
  chạy.
* **Không đo được từ đây:** SYNAPSE **đang** lưu con số nào trong cơ sở dữ liệu thật của khách. Repo
  này chứa mã của nó, không chứa dữ liệu của nó.
* **Không đo:** mục này **không** đo `IotSensorSim` và `AoiInspectorSim`, hai bộ mô phỏng còn lại
  cũng nhận `configStore`. Cùng bốn chỗ gọi, nên **cùng bất đối xứng có thể tồn tại ở đó**; chưa ai
  mở ra.

---

## 42. `weld_profile` và `dispense_program` được định nghĩa, kiểm miền, phục vụ qua REST — và KHÔNG bộ mô phỏng nào đọc chúng

**Đo được cái gì.** `MachineParameterSchema` khai đủ hai vựng từ, **bốn tham số mỗi bên**, mỗi tham
số có min/max cứng, bước nhảy và số chữ số thập phân: `dispense_program` = `volumeTarget`,
`pressure`, `speed`, `temperature`; `weld_profile` = `current`, `time`, `tempMax`, `voltage`.
`MachineTypeToConfigKind` ánh xạ `DISPENSING`/`WELDER` vào chúng, nên
`GET /v1/machines/{code}/settings` phục vụ chúng và một cú ghi được kiểm miền. **Nhưng**
`SimulatorFactory.Create` dựng `new DispensingSim(d, seed)` và `new WelderSim(d, seed)` — **hai
constructor duy nhất trong họ không nhận `configStore`** — nên `ResolveEffectiveConfig` trả null
suốt đời hai instance ấy và **không giá trị nào tới được một phép vẽ**.

🔴 **Sắc hơn: hai trong bốn khoá mỗi bên TRÙNG TÊN với một metric mà chính bộ mô phỏng ấy phát ra** —
`current`/`time` ở WELDER, `pressure`/`temperature` ở DISPENSING. Vận hành viên nâng `pressure`, thấy
**bản ghi cấu hình đổi** và **metric `pressure` không đổi**. Đó không phải "chưa nối dây"; đó là một
bề mặt **nói dối theo chiều khẳng định**.

**Ở đâu trong mã.** `src/St4i.EdgeCore/Config/MachineParameterSchema.cs` (hai khối `Registry`);
`src/St4i.EdgeCore/Drivers/Simulators/SimulatorFactory.cs` (hai nhánh `"DISPENSING"`/`"WELDER"`);
`src/St4i.EdgeCore/Drivers/Simulators/WelderSim.cs` và `DispensingSim.cs` (`: base(d, seed)`).
`WelderSim`'s own doc comment **đã tự khai điều này** — nên nó không phải một phát hiện mới, mà là
một phát hiện **đã ghi và chưa ai phán**.

**Hậu quả vận hành, hai chiều.** Nối dây làm **giá trị metric `current`/`time`/`pressure`/
`temperature` đi ra ngoài đổi** — cùng đường ingest của mục 41, cùng lớp miễn trừ. Gỡ vựng từ
**gỡ một bề mặt REST công khai** mà UI cấu hình máy đang vẽ, và làm hỏng mọi bản ghi đã gieo. Chiều
để nguyên: hôm nay **không dữ liệu nào sai** — chỉ có một mặt điều khiển không nối vào gì, và một số
người sẽ coi đó là "chỗ dành sẵn cho phần cứng thật", đúng vai của một bộ mô phỏng.

**Nếu không quyết.** Mặt điều khiển tiếp tục nhận giá trị, tiếp tục ghi đĩa, tiếp tục không có tác
dụng. Mỗi bản ghi mới làm phép gỡ đắt thêm.

---

## 43. Hai bộ mô phỏng có PHÁN QUYẾT KHÔNG THỂ SAI, và cả hai tính là TỐT cho OEE

**Đo được cái gì — hai ca, đo riêng.**

* **`AssemblySim`** gọi `VerdictHelper.Evaluate(force, null, null)`. Nhánh đầu của `Evaluate` trả
  `Warn` khi **cả hai giới hạn đều null**, nên **mọi** reading của lớp này là `Warn`; `Pass` và
  `Fail` **không với tới được**. `press_depth` được phát ra và **không bao giờ được xét**, kể cả về
  nguyên tắc — chỉ lực đi vào phán quyết.
* **`LeakTestSim`** phát `MetricSample("leak_rate", …, 0.0, _maxLeakRatePa, …)` rồi
  `Evaluate(leakRate, 0.0, _maxLeakRatePa)`. `VerdictHelper` **không có khái niệm "một phía, thấp
  hơn là tốt hơn"**: nó lấy LSL = 0,0 theo nghĩa đen và áp cùng luật cận-biên 15 %, cho **margin
  3,0 Pa/s** ở giới hạn mặc định 20,0. **Mọi tốc độ rò ≤ 3,0 — gồm mọi giá trị bị kẹp về đúng 0,0,
  tức KẾT QUẢ TỐT NHẤT máy có thể báo — là `Warn`.**

**Ở đâu trong mã.** `src/St4i.EdgeCore/Drivers/Simulators/AssemblySim.cs`,
`LeakTestSim.cs`, `VerdictHelper.cs` (`MarginOf`, và nhánh `lsl is null && usl is null`).

**Hậu quả vận hành, hai chiều.** `Warn` tính là **TỐT** cho OEE (mục 2, `OeeCalculator`:
*good* = `Pass|Warn`). Nên một cell ASSEMBLY **không bao giờ bị phạt chất lượng** thay vì bị đánh dấu
là *chưa xét được*, và một máy kiểm rò **cảnh báo vì kín quá**. Sửa bất kỳ cái nào **dịch cột phán
quyết trong báo cáo PDF và, với `LeakTestSim`, dịch cả `Quality`** — đó là con số OEE đã báo cáo,
không uỷ quyền được. Chiều để nguyên: `AssemblySim` đang thi hành **đúng chữ** của doc-62 §6
(*"chưa seed spec → warn-only"*), và mục 2 **đã** phán rằng `Warn` = TỐT là hành vi được GIỮ và
XUẤT BẢN. Sửa `AssemblySim` mà không sửa mục 2 là làm hai câu trong cùng file nói ngược nhau.

**Nếu không quyết.** Hai bộ mô phỏng tiếp tục báo một phán quyết mang **zero thông tin**, và OEE
tiếp tục cộng chúng vào cột tốt.

---

## 44. Hai tham số constructor CÔNG KHAI mà không chỗ gọi nào trong repo cấp, và một trong hai không được kiểm miền

**Đo được cái gì.** `LeakTestSim.maxLeakRatePa` và `FunctionalTestSim.targetPassRate`. Đo trên **toàn
commit** (`repo-scan.sh --sha HEAD -l '<tên>'`, miền `:(top)`): mỗi định danh xuất hiện **đúng trong
file khai nó** và trong `docs/owner-decisions.md` — **không chỗ gọi nào, kể cả test**.
`SimulatorFactory.Create` **không có tham số nào** có thể mang đối số thứ ba tới hai lớp ấy. So sánh
để thấy đây không phải luật chung: `AoiInspectorSim.pointsPerBoard`/`.ngRate` **có** chỗ gọi, chỉ là
trong test.

🔴 **Và `maxLeakRatePa` KHÔNG được kiểm miền:** `0` làm **mọi** phép vẽ khác 0 thành hỏng; một giá
trị âm **lật ngược dải**. Doc comment của lớp tự khai điều này.

**Ở đâu trong mã.** `src/St4i.EdgeCore/Drivers/Simulators/LeakTestSim.cs`, `FunctionalTestSim.cs`,
`SimulatorFactory.cs`.

**Hậu quả vận hành, hai chiều.** Hôm nay **không với tới được**, nên rủi ro thực tế là **không** —
đó là chiều nói để nguyên có lý, và nó là chiều mạnh. Chiều ngược lại: đây là **bề mặt công khai
đang hứa một khả năng chỉnh mà không tồn tại**, đúng câu hỏi mục 25 hỏi cho họ driver. Ba hướng, và
chúng **không tương đương về uỷ quyền**: (a) **gỡ tham số** — gỡ một **tên công khai**, uỷ quyền
loại trừ; (b) **kiểm miền và giữ** — trong uỷ quyền, nhưng ghim một API không ai gọi; (c) **nối
chúng vào store** — đổi giá trị metric đi ra ngoài, cùng lớp mục 41.

**Nếu không quyết.** Hai tham số ở lại như một mặt điều khiển không dây, và `maxLeakRatePa` ở lại
như một cách phá bộ mô phỏng mà không lời cảnh báo nào chặn.

---

## 45. `SimulatedEcosystem.Load` ghi lại CẢ HAI file khi chỉ MỘT vắng — và kể từ mục 30 nó đè lên một file `%ProgramData%` mà phép xoá cố ý GIỮ

**Đo được cái gì.** `Load()` đọc `productsExisted` và `recipesExisted` riêng, gieo mầm riêng cho
nhánh vắng — rồi đóng bằng **một dòng duy nhất**: `if (!productsExisted || !recipesExisted) Save();`
và `Save()` **ghi cả hai file**. Nên nếu vận hành viên xoá đúng một file, file **còn lại** — do
chính họ soạn — bị **tuần tự hoá lại đè lên**.

🔴 **Đây đúng bằng byte khuyết tật V-1 đã sửa cho `ProductConfigStore` (mục 5), còn sống trong store
anh em.** AV-1 đo 2026-08-22. 🔴 **Và BF-1 đo lại 2026-08-23 rằng nhiệm vụ mục 30 làm nó ĐẮT HƠN:**
trước hôm ấy nó đè một file cạnh binary; nay nó đè một file dưới `%ProgramData%\ST4I\sim\` mà
`remove-data.ps1` **cố ý GIỮ theo phán quyết 2026-08-23(b) của chính anh**, vì *"cấu hình do vận hành
viên soạn không phải dữ liệu vận hành"*. Cùng một dòng mã, hậu quả to hơn.

**Ở đâu trong mã.** `src/St4i.EngineApi/Config/SimulatedEcosystem.cs` — `Load()` và `Save()`.

**Hậu quả vận hành, hai chiều.** Mất một file cấu hình do người soạn, **không cảnh báo, từ một
constructor**. Chiều để nguyên: phép sửa (chỉ ghi file vắng) **thay đổi ngữ nghĩa gieo mầm** —
hôm nay hai file luôn nhất quán với nhau sau `Load`; sau khi sửa, một `products.json` do người soạn
có thể tham chiếu một recipe không tồn tại, và **không gì trong lớp này kiểm tính toàn vẹn chéo**.
Nên phép sửa hiển nhiên **mở một trạng thái mới**, và đó là lý do nó xứng một quyết định chứ không
phải một dòng vá.

**Nếu không quyết.** Đường mất dữ liệu ở nguyên, và nó nay chỉ vào đúng tập file mà phán quyết
2026-08-23(b) vừa được lập ra để bảo vệ.

---

## 46. `-SkipDotnetPublish` của `build-installer.ps1` để dữ liệu do VẬN HÀNH VIÊN soạn đi vào MSI

**Đo được cái gì.** `build-installer.ps1` công bố cờ `-SkipDotnetPublish`; ở nhánh đó nó **bỏ qua
phép xoá thư mục publish**, và phép harvest đọc **cả thư mục**. AV-1 đo 2026-08-22: **bốn file kiểu
ấy đang nằm trong `publish-desktop/`**, dấu thời gian **sau** lần publish. Một lần chạy
`-SkipDotnetPublish` hôm nay **giao chúng cho khách hàng**.

🔴 **Chỗ đáng nói về HỒ SƠ, không chỉ về mã:** phát hiện này **đã được ghi** — trong thân mục 30 và
mục 31 — nhưng **chưa bao giờ có một hàng phán quyết của riêng nó**, nên bảng phán quyết không liệt
kê nó và không dụng cụ nào theo dõi nó. Đó là hình dạng mục 37 lần nữa, ở trong một mục đã đóng.

**Ở đâu trong mã.** `packaging/installer/build-installer.ps1` (tham số và nhánh bỏ-xoá),
`packaging/installer/README.md`.

**Hậu quả vận hành, hai chiều.** Một MSI mang dữ liệu của một máy dựng — có thể là dữ liệu khách
khác. Chiều để nguyên: cờ ấy là **đường nhanh cho người dựng**, và mọi bản dựng phát hành thật
**không** dùng nó; ép nó xoá làm mất chính cái nó tồn tại để cho. Hướng thứ ba, chưa ai định giá:
**từ chối harvest cả thư mục** và chuyển sang danh sách tệp tường minh — đắt hơn, nhưng nó xoá cả
lớp lỗi thay vì một cờ.

**Nếu không quyết.** Cờ ở lại, thư mục ở lại bẩn, và phép nạp phụ thuộc vào việc người dựng nhớ.
**Nhiệm vụ này KHÔNG dựng MSI** và không đụng `publish-desktop/` — nên bốn file AV-1 đếm được là lời
của AV-1, **không** đo lại ở đây, và nói rõ như thế.

---

## 47. Hai nhà máy connector Modbus đụng nhau ở khoá đăng ký mặc định, và một khoá lặp THAY chứ không từ chối

**Đo được cái gì.** `ModbusConnectorFactory.Kind` và `ModbusRtuConnectorFactory.Kind` **cùng trả
`DriverKinds.Modbus`**. `ConnectorRegistry.Register` mặc định id thể hiện bằng `Kind` đã chuẩn hoá,
và **một khoá lặp THAY thế chứ không từ chối** — nên đăng ký cả hai mà không nêu id thể hiện tường
minh **làm một cái nghỉ hưu im lặng**. Cùng hình dạng cho **hai endpoint TCP**, vì host/port được
nướng vào adapter lúc dựng.

**Ở đâu trong mã.** `src/St4i.EdgeCore/Drivers/Modbus/ModbusConnectorFactory.cs`,
`ModbusRtuConnectorFactory.cs`, và `ConnectorRegistry`.

**Hậu quả vận hành, hai chiều.** Một triển khai có **cả** RTU và TCP dưới `modbus` chạy với **một
transport** và không thông điệp nào nói cái kia biến mất. Chiều để nguyên: `DriverKinds` là **năm id
dựng sẵn đã công bố**, và `OpcUaConnectorFactory` tự khai rằng nó **không** có vấn đề này vì id của
nó ánh xạ đúng một driver — nên tách `modbus` thành hai id **đổi một id connector công khai** mà bên
thứ ba có thể đang viết trong `connectors.json`. Hướng rẻ hơn — làm `Register` **từ chối** khoá
trùng thay vì thay — **đổi hành vi của một API đăng ký công khai** và có thể làm hỏng một cấu hình
đang chạy được.

**Nếu không quyết.** Cấu hình hai-bus vẫn là một cái bẫy im lặng, và không dụng cụ nào bắt được.

---

## 48. Hợp đồng của chính seam driver bị vi phạm ở NĂM chỗ đo được

⚖️ **ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC** — không chạm ba miễn trừ. Ở đây vì chưa ai quyết.

**Đo được cái gì — liệt kê trước, đếm sau.** BB-1 đo năm chỗ ngày 2026-08-22; cả năm **xác nhận lại
trên mã** ở `9255ea98`:

1. **`HotFolderAoiDriver` làm I/O trong constructor** — ba `Directory.CreateDirectory` và một
   `FileSystemWatcher` sống. `IDeviceDriver` nói rõ *"mọi thiết lập kết nối/phiên thuộc hoàn toàn
   trong `ReadAsync`, không bao giờ trong constructor"*, và lý do được nêu tại chỗ: `StartLocked`
   dựng driver **dưới cùng khoá `Estop()` lấy**.
2. **`MqttDriver.DisposeAsync` không có trần** — `DisconnectAsync` được phát với
   `CancellationToken.None`, trong khi hợp đồng nói dispose *"nên tự nó trả về nhanh"*.
3. **`MqttDriver` không liệt kê lại được sau khi dispose** — đo bằng một probe CLR độc lập, và
   **bộ test không phủ**.
4. **`InProcessBroker.DisposeAsync` không có trần VÀ mù** — `StopAsync()` không token, không timeout,
   ngoại lệ bị nuốt vào một `catch` rỗng trong một lớp **không có sink log nào**. Một broker không
   nhả được cổng **không phân biệt được** với một broker tắt sạch; triệu chứng nổi lên ở lần
   `StartAsync` sau trên cùng cổng.
5. **`HotFolderAoiDriver` nhận một miễn trừ `Health` mà class doc của nó không khai.**

**Hậu quả vận hành, hai chiều.** (1) làm một `Estop()` chậm đi theo tốc độ đĩa; (2)(4) làm tắt máy
treo không giới hạn; (3) là một tính chất không ai kiểm; (5) là hồ sơ sai. Chiều để nguyên: cả năm
**chưa bao giờ được quan sát gây sự cố**, và ba trong năm **cách một [Fact] là ghim được** — nên giá
đúng của việc sửa gồm cả **tổng suite dịch**, thứ nhiệm vụ này bị cấm.

**Nếu không quyết.** Hợp đồng seam tiếp tục nói một đằng và năm chỗ triển khai làm một nẻo, và điều
đó **đã** là lý do mục 12 tồn tại.

---

## 49. Hai vựng từ machine-type không phải một danh sách, và một loại máy không nhận ra âm thầm thành máy bắt vít rồi GHI một bản ghi cấu hình

⚖️ **ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC** — không chạm ba miễn trừ.

**Đo được cái gì.** `SimulatorFactory.Create`'s switch và `MachineParameterSchema.MachineTypeToConfigKind`
được bảo trì **riêng**. `ASSEMBLY`/`LEAK_TEST`/`FUNCTIONAL_TEST` chỉ-có-ở-factory **theo thiết kế**
(schema tự khai thế). **Hai cái KHÔNG được câu ấy phủ:**

* **`AOI_AVI`** — chỉ có ở factory. Có store, một máy như thế **được gieo và lưu** một bản ghi
  `aoi_inspection`, trong khi `GET /v1/machines/{code}/settings` trả *"unsupported machine type"*
  cho **cùng máy ấy**.
* **`IOT_GATEWAY`** — chỉ có ở schema. Nó tới `IotSensorSim` **chỉ qua** nhánh dự phòng
  `DeviceClass.Iot`. `OnboardingFleetJoin` **có** ghép nó với `DeviceClass.Iot`, nên đường onboarding
  đáp đúng chỗ; một descriptor dựng tay hoặc soạn từ file **thì không nhất thiết**.

🔴 **Và nhánh mặc định của `FallbackByDeviceClass` dựng một `ScrewdriveSim`** — nên một loại máy
không nhận ra **có store** sẽ được **GHI một bản ghi `screw_program` xuống đĩa dưới mã của chính
nó**, trong khi API cấu hình từ chối phục vụ máy ấy.

**Ở đâu trong mã.** `src/St4i.EdgeCore/Drivers/Simulators/SimulatorFactory.cs`
(`Create`, `FallbackByDeviceClass`); `src/St4i.EdgeCore/Config/MachineParameterSchema.cs`
(`MachineTypeToConfigKind`).

**Hậu quả vận hành, hai chiều.** Một lỗi chính tả trong `fleet.json` sinh ra một máy bắt vít giả
**cộng một file cấu hình rác**. Chiều để nguyên: nhánh dự phòng ấy là lý do một `fleet.json` hỏng
**không làm sập kiosk triển lãm** — đúng tính chất `ResolveFleetPath` được viết để giữ; làm nó ném
lỗi là đổi một hành vi khởi động đã có chủ ý.

**Nếu không quyết.** Hai danh sách tiếp tục trôi xa nhau, và **không dụng cụ nào so chúng**.

---

## 50. Ba khuyết tật parse trên bản đồ connector, cả ba NGOÀI phạm vi mục 38

⚖️ **ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC** — không chạm ba miễn trừ.

**Đo được cái gì.**

1. 🔴 **`"ReadTimeoutMs"` và `"Retries"` viết hoa bị VỨT ÂM THẦM.** Cả hai là `[JsonIgnore]`, nên
   nguồn duy nhất của chúng là một `TryGetProperty` **ordinal**, trong khi binder **không phân biệt
   hoa thường**. Một bản đồ khai `"ReadTimeoutMs": 3000, "Retries": 4` ⇒ **cả hai bind thành `null`,
   ZERO cảnh báo**, và `EffectiveReadTimeoutMs` rơi về giá trị dẫn xuất. **Đây đúng cái bẫy đã cắn
   bản nháp đầu của mục 38** — còn sống trên hai trường **ngoài** mục 38.
2. **`EffectiveReadTimeoutMs` vẫn tràn `int`.** `ReadTimeoutMs ?? Math.Max(1000, PollIntervalMs * 4)`:
   với `PollIntervalMs > int.MaxValue / 4`, phép `* 4` wrap âm và `Math.Max` trả sàn 1000 **im
   lặng**. Mục 38 đóng đường **parse**; đường **object initializer** vẫn mở.
3. **Hai bề mặt nuốt cảnh báo cadence:** `ConnectorConfigValidation.TryValidateOpcUa` và
   `St4i.EngineApi.Program` gọi `OpcUaNodeMap.FromJson` **không truyền sink** — trong khi
   `OpcUaConnectorFactory` thì có.

**Ở đâu trong mã.** `src/St4i.EdgeCore/Drivers/Modbus/ModbusRegisterMap.cs`;
`src/St4i.EngineApi/Fleet/ConnectorConfigValidation.cs`; `src/St4i.EngineApi/Program.cs`;
`src/St4i.EdgeCore/Drivers/OpcUa/OpcUaNodeMap.cs`.

**Hậu quả vận hành, hai chiều.** (1) một triển khai viết hoa theo thói quen C# **mất cấu hình mà
không biết**; (3) hai trong ba đường parse **không nói được gì** khi bản đồ có vấn đề. Chiều để
nguyên: (1) sửa bằng cách nới khớp tên **mở rộng bề mặt cấu hình được chấp nhận** — một sự nới lỏng,
không phải một phép vá, và người sau có thể muốn hướng ngược lại (**cảnh báo** thay vì **chấp
nhận**); (2) hôm nay không với tới được qua parse, nên rủi ro thật là thấp.

**Nếu không quyết.** Ba chỗ ở nguyên, và (1) là loại lỗi **chỉ lộ ra qua hành vi lúc chạy**.

---

## 51. NĂM dụng cụ đo tự báo hụt miền của chính mình, và một gốc `%ProgramData%` không ai canh

⚖️ **ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC** — cùng loài mục 32 và 40. 🔴 **Nói cho hết: cả mục 32 và mục 40 đều
do CHỦ SỞ HỮU quyết**, nên nhãn ở đây nêu một tiền lệ ngược với chính nó, và anh có thể lật.

**Đo được cái gì — liệt kê trước, đếm sau.**

1. **`scan-doc-negations.sh --since --files`** thu hẹp corpus **NOW** nhưng **không** thu hẹp corpus
   **BASE**, nên phép `comm -23` so một tập hẹp với một tập đầy. Vô hại theo chiều hiện tại (nó chỉ
   có thể **báo thừa**), **nhưng không ai khai điều đó**.
2. **`C2` của `check-owner-decisions.sh` một chiều theo thiết kế**, và hệ quả đang sống: hàng phán
   quyết **mục 12** còn chứa `Ở LẠI PHẦN II` **mười lần** trong khi thân mục nay ở Phần III. Nó qua
   được vì `has()` **phân biệt hoa thường** và chữ *"thi hành một phần"* của hàng ấy viết **thường**.
3. **`repo-scan.sh` không có phép kiểm hoa-thường cho pathspec** — trên Windows một pathspec sai hoa
   thường im lặng thu hẹp miền, đúng loài mục 32.
4. **`remove-data.ps1` in danh sách GIỮ mà KHÔNG kiểm chúng có tồn tại không.** Với `$subdirs` nó in
   *"does not exist - nothing to remove"*; với `$keptByDesign` nó in đường dẫn **vô điều kiện** ngay
   trong banner, nên một vận hành viên thấy hai đường dẫn trông như *"đây là thứ bạn phải tự xoá"*
   kể cả khi chúng **chưa từng tồn tại**.
5. 🔴 **Không dụng cụ nào gác `%ProgramData%\ST4I\sim\` ngoài `creds`.** `RealCredentialStoreLeakGuard`
   và bracket credential của cổng đều rút gốc **duy nhất** từ `CredentialStore`. Một store rò vào
   `…\sim\products` hay bất kỳ lá nào khác **hoàn toàn không ai thấy**. BE-1 đo **13** lá không ai
   canh trước mục 30; BF-1 đo **16** sau, **và ba lá mới là đúng ba lá mà một seam hỏng sẽ ghi vào**.

**Hậu quả vận hành, hai chiều.** Bốn cái đầu là **dụng cụ đo nói quá về miền của mình** — đúng cái
giá mục 32 ghi lại: một phán quyết của chủ sở hữu đã từng mang một cái trần SAI. Cái thứ năm là một
**lỗ trong hàng rào của cổng**. Chiều để nguyên: (1) và (3) hôm nay **không sai theo chiều nguy
hiểm**; (4) là bề mặt vận hành viên, và thêm một dòng *"(không có)"* là một **quyết định về cách nói
với người dùng**, không phải một phép vá hiển nhiên; (5) là **một dụng cụ MỚI dùng chung cho năm
assembly**, cần baseline riêng như `RealCredentialStoreWatch` — BF-1 đã cân nhắc dựng nó và **DỪNG**
đúng lý do ấy.

**Nếu không quyết.** Cổng tiếp tục xanh trên những miền chưa ai khai, và đó là chính xác định nghĩa
của mục 40.

---

## 52. HAI lời khai đã công bố đo được là SAI và cố ý để nguyên, cộng sáu chỗ ném lỗi mà thông điệp không ai đọc

⚖️ **ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC** — rút một câu văn xuôi tại chỗ không chạm ba miễn trừ.

**Đo được cái gì.**

1. 🔴 **`IDeviceDriver.Id`'s doc nói nó *"keys slot labels and, through those, alarms"* — BỊ BÁC.**
   BB-1 đo: **không gì trong cây tiêu thụ giá trị của nó** — bốn decorator chuyển tiếp nó, bộ
   conformance chỉ khẳng định nó **không đổi**, và nhãn slot mà một alarm nhắm tới đến từ
   `FleetCore.ResolveSlotLabelFor`/`ResolveConnectorSlotLabel`. Câu ấy **vẫn nguyên văn ở
   `9255ea98`** — xác nhận lại hôm nay. `ScenarioAwareDriver.Id` mang câu thứ hai cùng loài. BB-1
   **cố ý không rút**, vì cả hai nằm ngoài cụm nó được giao và sửa một khối đã hoàn chỉnh ở đó là
   mối nguy batch 6 đã nêu tên. Lý do ấy đúng; **nó không làm câu kia thành đúng**.
2. 🔴 **`"23 sites across 20 files"` KHÔNG tái lập được.** `tests/Shared/OwnOutputDirectoryGuard.cs`
   và `scripts/verify-suites.sh` cùng viết con số ấy về quần thể chỗ dựng
   `ProductConfigStore`/`SimulatedEcosystem`. Đo lại ở `9255ea98`, miền `:(top)`:
   `new ProductConfigStore(` **26** dòng trên **5** file, `new SimulatedEcosystem(` **11** dòng trên
   **4** file ⇒ **37 chỗ trên 6 file** — **cộng** các nhà máy target-typed `=> new(TempDir())` mà
   phép quét chữ-nghĩa **không thấy**. **Không chiều nào khớp**, và **không artefact nào nêu tên
   dụng cụ đã sinh ra "23/20"**, nên nó không tra lại được.
3. **`Doc28Parser`: sáu trong 34 chỗ ném lỗi không nêu file**, và trên **đường sản xuất duy nhất**
   `HotFolderAoiDriver` bắt bằng một `catch (Doc28ValidationException)` **không binding** rồi chuyển
   file sang `error/` — **thông điệp và inner exception bị vứt chưa đọc**. Bảy tham chiếu còn lại
   trong cây đều là `Assert.Throws<>` và **không cái nào nhìn `.Message`**.

**Hậu quả vận hành, hai chiều.** (1)(2) là **hồ sơ nói sai về mã**, đúng loài file này lập ra để
chấm dứt; (2) tệ hơn vì nó là một con số ghim một tập **đổi ở chỗ khác**. (3) là một chi phí chẩn
đoán: một file doc-28 hỏng vào `error/` **không mang lý do đi cùng**. Chiều để nguyên: (1) sửa đúng
cách đòi đọc lại năm điểm dùng chứ không chỉ xoá một mệnh đề — BB-1 đã ghi phép đo ở năm điểm ấy,
nên **thông tin không mất**, chỉ đặt sai chỗ. (2) con số ấy nằm trong một đoạn **đã bị rút**, và
sửa nó là **một phép đo khác** với một cái trần khác. (3) thêm tên file vào sáu chỗ ném **không**
làm ai đọc chúng — phép sửa thật nằm ở `catch`, và đó là một thay đổi hành vi.

**Nếu không quyết.** Hai câu sai ở lại trong mã như tài liệu, và người tiếp theo đọc chúng sẽ tin.

---

# 🔨 PHẦN II — ĐÃ QUYẾT, VIỆC CÒN NỢ

**Mỗi mục ở đây đã có một phán quyết ghi kèm ngày, và việc của nó chưa được thi hành.**
Đó là một trạng thái **thứ ba**, và cho tới 2026-08-18 file này **không có chỗ cho nó**:
chỉ có *đang chờ* và *đã xong*. Bốn mục vừa được quyết sẽ phải nằm hoặc cùng các mục
**chưa ai đọc**, hoặc cùng các mục **đã chạy xong** — và cả hai đều sai. Mục 2 và mục 4
đã ở trạng thái này từ **2026-08-16** mà không có gì nói ra, nên chỗ thiếu này cũ hơn
các phán quyết vừa tạo ra nó.

🔴 **Không gì ở đây được thi hành bởi lần ghi này.** Không một dòng thực thi nào đổi vào
ngày quyết định; các nhiệm vụ riêng sẽ mang chúng đi. Các mục này ghi **điều đã quyết**,
không ghi **cách làm**.

⚠️ **Trạng thái vẫn chỉ có MỘT nguồn.** Việc một mục nằm ở phần nào là một **cái kệ**,
không phải một khẳng định: nguồn sự thật là **bảng phán quyết** phía trên và **dòng phán
quyết trong chính mục ấy**. Nếu banner của một phần và dòng phán quyết của một mục nói
khác nhau thì **dòng phán quyết thắng**, và cái kệ là thứ đang sai. Một mục rời phần này
sang **Phần III** khi dòng phán quyết của nó có thêm **một ghi chép thi hành ghi kèm
ngày** — không sớm hơn.

🔨 **Ba mục đã rời phần này theo đúng điều kiện ấy, 2026-08-18:** mục **8, 10 và 11**, do
nhiệm vụ **Z-1** thi hành; mỗi mục mang một ghi chép thi hành ghi kèm ngày ở cuối khối
phán quyết của chính nó, và bảng phán quyết đầu file mang `đã thi hành, Z-1`.

🔨 **HAI MỤC NỮA ĐÃ RỜI, cùng điều kiện, 2026-08-18: mục 2 và mục 4, do nhiệm vụ AA-1 thi
hành.** Câu tiếp theo của đoạn trên, **RÚT 2026-08-18 (AA-1)** vì chính lần ghi này làm nó
sai, giữ nguyên văn: *"Phần này còn lại **mục 2, mục 4** (cùng ở trạng thái này từ
2026-08-16) và **mục 12**."* Nó là một phép liệt kê đã công bố, và một phép liệt kê sai là
đúng loài file này lập ra để chấm dứt. **Phần này nay còn lại đúng MỘT mục: mục 12** — ở
lại vì việc của nó là **nhiều vòng** và chưa vòng nào chạy, không phải vì thiếu phán quyết.

📎 **MỘT KIỂU BẢO TỒN DUY NHẤT, và nó được nêu ở đây một lần cho cả nhiệm vụ.** Ở mọi chỗ
AA-1 rút một câu đã công bố — đoạn này, ô mục 4 trong bảng phán quyết đầu file, và
`<param name="Samples">` của `WaveformSeries` — kiểu là **TRÍCH NGUYÊN VĂN RỒI RÚT**: câu cũ
được chép lại nguyên văn trong dấu ngoặc kép, kèm ngày rút và người rút, và lý do đứng ngay
cạnh. **Không dùng gạch ngang ở bất kỳ chỗ nào AA-1 viết.** Lý do là một ràng buộc chứ không
phải một sở thích: một trong ba chỗ ấy là **khối `///` trong C#**, nơi không có phần tử gạch
ngang nào nằm trong `RegisteredElementNames` của `DocCommentProseTests`, nên gạch ngang
không thể là kiểu chung của cả ba. Các dấu `~~…~~` còn lại trong file này là của T-1, U-1,
V-1 và Y-1; AA-1 **không đụng** tới chúng.

📎 **Các vòng phản biện của AA-1 (2026-08-18) rút thêm, và dùng ĐÚNG kiểu ấy** — trích nguyên
văn, ghi ngày, ghi người, lý do ngay cạnh, không gạch ngang. 🔴 **LIỆT KÊ, KHÔNG ĐẾM** — câu
này ghi *"rút thêm **SÁU** câu"* cho tới 2026-08-18 và **RÚT cùng ngày**, vì phép liệt kê ngay
cạnh nó **không chứa đủ sáu**: nó bỏ sót phép rút ở banner Phần I, và gộp hai đoạn trích trong
`verify-suites.sh` thành một. Đây là **lần thứ ba trong ba nhiệm vụ liên tiếp** một con số vô
hướng tóm tắt một tập mà phép liệt kê ngay cạnh bác bỏ nó. Nên: **phép liệt kê là nguồn, và
không con số nào đứng trước nó.**

**Vòng phản biện 1** — `src/St4i.Connector.Abstractions/Models/DeviceReading.cs`,
`<param name="Samples">`: *"Any other row is outside this contract…"*; *"That is a defect in
those published files, not a second convention."*; *"no reader in this repository indexes an
element of a row at all"*. Cùng file, `<param name="RateHz">`: *"It is also the DISCRIMINATOR
for the shape of a Samples row…"*. `tests/…/WaveformSeriesRowShapeContractTests.cs`
`<summary>`: *"no reader in src/ or tests/ indexes an ELEMENT of a row at all"*; *"a THIRD
producer added later is checked without anybody remembering to add it here"*.
`scripts/verify-suites.sh`, khối cạnh `EXPECT_EDGECORE`: *"Swept over ALL EIGHT built-in
simulators … so a THIRD producer is covered the day it appears."*; và *"the exact shape the
vendored device-client SDK's own worked examples send"* cùng *"This second arm is not
hypothetical…"*. `docs/owner-decisions.md` §4, ghi chép thi hành: *"một bộ sinh THỨ BA cũng bị
kiểm mà không ai phải nhớ thêm nó vào"*. Banner **Phần I**: *"Hai mục ở đây: mục 9 và mục 13."*
Cộng **một phép RÚT LẠI MỘT PHÉP RÚT** ở ô mục 4 của bảng phán quyết, nơi cả ba lớp câu — bản
gốc, phép rút của AA-1, và phép rút lại — đứng nguyên văn cạnh nhau.

**Vòng phản biện của vòng sửa** — mục **14**: tiêu đề (*"…vi phạm nó"*), câu *"nơi sản phẩm này
đứng sai"*, và blockquote *"Họ SDK khớp đặc tả. Cái lệch là bộ phát của chúng ta."* Cộng chính
câu *"SÁU"* ngay trên.

Ba thao tác vẫn phân biệt như cũ: **RÚT** (câu đã công bố nay sai), **CẬP NHẬT** (trạng thái
đổi), **MỞ RỘNG** (phép liệt kê thiếu). Không thao tác nào thứ tư được dùng.

---

## 🔴 PHẦN NÀY NAY RỖNG — 2026-08-22 (BC-1), và cái rỗng ấy là một khẳng định, không phải một khoảng trắng

**Mục 12 — mục cuối cùng ở đây — rời sang Phần III hôm nay**, theo đúng điều kiện mà banner trên đặt
ra: *"Một mục rời phần này sang **Phần III** khi dòng phán quyết của nó có thêm **một ghi chép thi hành
ghi kèm ngày** — không sớm hơn."* Ghi chép ấy nằm ở thân mục 12, khối *"ĐÃ THI HÀNH — đợt 12 (BC-1,
2026-08-22)"*, và nó nêu đích danh phán quyết đã hoàn thành cùng phần dư còn lại.

**RÚT, giữ nguyên văn:** đoạn ở banner trên đọc *"**Phần này nay còn lại đúng MỘT mục: mục 12** — ở lại
vì việc của nó là **nhiều vòng** và chưa vòng nào chạy, không phải vì thiếu phán quyết."* Câu ấy đúng
khi AA-1 viết nó (2026-08-18) và **sai kể từ hôm nay**: chín vòng đã chạy — đợt 3 bật cờ, đợt 4 trỏ lại
101 khẳng định sai, đợt 5–8 và đợt 9–12 trả bao phủ — nên lý do ở lại đã hết.

⚠️ **Một phần RỖNG không phải một phần BỊ XOÁ, và khác biệt ấy là load-bearing.** Trạng thái thứ ba mà
phần này tồn tại để đặt tên — *đã quyết, chưa làm* — vẫn là một trạng thái thật; hôm nay chỉ là không có
mục nào ở trong nó. Banner, lý lẽ dựng nó và toàn bộ hồ sơ các mục đã đi qua đây **giữ nguyên**, vì mục
tiếp theo mà chủ sở hữu quyết rồi giao đi sẽ cần đúng cái kệ này. 🔴 **Và cổng KHÔNG đọc được điều đó:**
`check-owner-decisions.sh` chỉ đòi quần thể TOÀN CỤC khác rỗng (`C0`), không đòi từng phần khác rỗng —
nên một Phần II rỗng **đi qua xanh**, và câu này là chỗ duy nhất nói ra rằng nó rỗng **có chủ ý**.

📐 **Câu ngay trên HẾT ĐÚNG kể từ 2026-08-23 (BD-1, mục 40) — giữ nguyên văn, rút tại chỗ.** Nó đúng khi
BC-1 viết nó, và cái nó mô tả là **đúng khuyết tật mục 40 đặt tên**: hai trạng thái *"rỗng vì đã trả hết"*
và *"rỗng vì parser mất dấu thân mục"* cho ra **cùng một đầu ra từng byte**, nên tập rỗng thoả mọi khẳng
định phổ quát ngay bên trong dụng cụ dựng để cưỡng chế mục 37. `C6` nay đọc trường máy ngay dưới đây và
đòi **khai báo == phân tích được**; một đẳng thức giữa hai tập **vẫn nói được điều gì đó khi cả hai rỗng**,
đó là lý do chọn hình dạng này thay vì `count > 0` — thứ hôm nay sẽ **sai**, vì rỗng là một trạng thái hợp
lệ chứ không phải một lỗi. Dòng dưới là **khẳng định**, không phải chú thích: xoá nó đi thì cổng đỏ.

<!-- gate:phần-ii =  -->

---

# ✅ PHẦN III — ĐÃ QUYẾT VÀ ĐÃ THI HÀNH: HỒ SƠ

Các mục ở đây **đã quyết, và việc đã làm xong**. Chúng ở lại trong file này vì luật của
chính file: *một mục chỉ được rời khỏi đây khi có một quyết định ghi kèm ngày và người
quyết* — và các **khối đính chính** trong chúng là **hồ sơ về điều file này đã từng công
bố**; xoá chúng làm bản sửa **không còn bác bỏ được**.

⚠️ **Đọc `## 5–7.` như MỘT tiêu đề markdown chứa BA mục** — mục 5, mục 6 và mục 7. Đếm
mục bằng `grep "^## "` đã sai một lần vì đúng chuyện đó.

⚠️ **~~Mục 7 là mục đã thi hành duy nhất KHÔNG có tiêu đề `✅ ĐÃ THI HÀNH` của riêng
nó.~~ ĐÃ ĐÓNG 2026-08-18 — đoạn dưới giữ nguyên văn làm hồ sơ về điều file này đã công
bố, và về việc Y-1 đã đúng khi từ chối.**
Mục 1, 5 và 6 mỗi mục có một (Q-1, V-1, T-1); việc thi hành của U-1 ở mục 7 chỉ nằm
trong văn xuôi. Bảng phán quyết vẫn mang `đã thi hành, U-1`, nên sự thật không mất — chỉ
cái dấu **trong mục** là thiếu. Y-1 **không tự thêm** một ghi chép thi hành mà nó không
thi hành: nêu tên ở đây thay vì viết hộ.

**Z-1 đã thêm cái dấu ấy, và chỉ cái dấu.** Nó không viết một câu nào về việc U-1 đã làm
gì — toàn bộ nội dung thi hành của mục 7 vẫn là văn của U-1, ở nguyên chỗ cũ — và chính
tiêu đề mới **ghi rõ rằng Z-1 thêm nó ngày 2026-08-18**, cùng commit gộp `f18f5c29` đã
kiểm. Đó là ranh giới Y-1 vạch ra: viết một **hồ sơ** mình không thi hành là viết hộ;
thêm một **cái dấu** nhất quán và ký tên vào chính cái dấu thì không.

⚠️ **Phần này chứa những mục nào — LIỆT KÊ, vì một con số ở đây vừa tự bác bỏ mình.**
Các mục: **1, 3, 5, 6, 7** (ở đây từ trước), cộng **8, 10, 11** do Z-1 mang sang từ Phần II
ngày 2026-08-18, cộng **2 và 4** do AA-1 mang sang cùng ngày. Chúng nằm dưới các tiêu đề
`## 1.`, `## 2.`, `## 3.`, `## 4.`, `## 5–7.`, `## 8.`, `## 10.`, `## 11.` —
**tiêu đề và mục KHÔNG bằng nhau**, đúng như cảnh báo `grep "^## "` ngay phía
trên nói, vì `## 5–7.` là **một** tiêu đề chứa **ba** mục.

> 📎 **AA-1 (2026-08-18) — phép liệt kê trên được MỞ RỘNG, không thay.** Câu trước đó liệt kê
> tám mục dưới sáu tiêu đề và đúng ở thời điểm nó được viết; nó sai kể từ lúc mục 2 và mục 4
> chuyển sang, cùng ngày, cùng file. Cách chữa là **thêm vào phép liệt kê**, không phải viết
> một con số mới: hôm nay là **mười** mục dưới **tám** tiêu đề, và cả hai con số ấy chỉ đọc
> được từ danh sách ngay trên chứ không được ghi làm một khẳng định riêng — đúng luật mà khối
> đính chính ngay dưới đây mua được.

> 📎 **AJ-1 (2026-08-19) — MỞ RỘNG LẦN HAI, cùng cơ chế, và hai con số của AA-1 vì thế đã CŨ.**
> Chủ sở hữu phán **mục 9** và **mục 13** ngày 2026-08-19; AJ-1 thi hành cả hai và mang cả hai
> từ **Phần I** sang đây, mỗi mục với một khối `🔨 PHÁN QUYẾT` và một khối `✅ ĐÃ THI HÀNH`
> ghi kèm ngày — đúng điều kiện file này đặt ra cho việc chuyển phần. **Phép liệt kê đang
> sống, đọc từ chính các tiêu đề `##` của phần này:** mục **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
> 13**, nằm dưới các tiêu đề `## 1.`, `## 2.`, `## 3.`, `## 4.`, `## 5–7.`, `## 8.`, `## 9.`,
> `## 10.`, `## 11.`, `## 13.`. 🔴 **Hai con số của AA-1 (*"mười"* / *"tám"*) KHÔNG được sửa
> tại chỗ và KHÔNG bị xoá**: chúng đúng vào ngày chúng được viết, và cách chữa mà chính khối
> ấy tự khai là **thêm vào phép liệt kê**. Con số duy nhất đọc được ở đây là con số ai cũng
> đếm lại được từ danh sách ngay trên — và nó vẫn **không** được ghi làm một khẳng định riêng.
> **Mục 12 vẫn ở Phần II** (đang trả nợ) và **mục 14 vẫn ở Phần I** (`🔴 CHỜ ANH`); AJ-1 không
> đụng vào cái nào trong hai.

> 📎 **AK-1 (2026-08-19) — MỞ RỘNG LẦN BA, cùng cơ chế, và câu cuối của khối AJ-1 ngay trên vì thế
> đã CŨ.** Chủ sở hữu phán **mục 14** cùng ngày (**lựa chọn 3**); AK-1 thi hành và mang nó từ **Phần
> I** sang đây, với một khối `🔨 PHÁN QUYẾT` và một khối `✅ ĐÃ THI HÀNH` ghi kèm ngày. **Phép liệt
> kê đang sống, đọc từ chính các tiêu đề `##` của phần này:** mục **1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
> 11, 13, 14**, nằm dưới các tiêu đề `## 1.`, `## 2.`, `## 3.`, `## 4.`, `## 5–7.`, `## 8.`,
> `## 9.`, `## 10.`, `## 11.`, `## 13.`, `## 14.`. 🔴 **Câu *"mục 14 vẫn ở Phần I"* KHÔNG được sửa
> tại chỗ và KHÔNG bị xoá** — nó đúng vào ngày nó được viết, và nó **đúng về AJ-1**: AJ-1 thật sự
> không đụng vào mục 14. **Mục 12 vẫn ở Phần II** (còn 412 chỗ trống chưa trả — 🔴 **con số ấy RÚT
> 2026-08-20 bởi AL-1, đợt 6: còn 283; câu "vẫn ở Phần II" thì KHÔNG rút, nó vẫn đúng**); AK-1 **không đụng**
> vào nó. 🔴 **Và một sự kiện về CHÍNH PHẦN NÀY, không phải về một mục: Phần I nay RỖNG** — đây là
> lần đầu tiên kể từ khi file tồn tại. Câu ấy là một phát biểu về **hôm nay**, không phải một tính
> chất của file: bất kỳ vòng phản biện nào cũng mở được một mục mới, và trong hai ngày qua nó đã làm
> đúng thế **ba lần**.
>
> 📎 **AP-1 (2026-08-21) — MỞ RỘNG LẦN BỐN, cùng cơ chế, và câu *"Phần I nay RỖNG"* ngay trên vì thế đã
> CŨ ở CẢ HAI CHIỀU.** Chiều thứ nhất: AO-1 mở **mười tám** mục mới (15–32) vào Phần I ngày 2026-08-20,
> nên Phần I đã thôi rỗng trước khi AP-1 chạy. Chiều thứ hai: **mục 15** được **điều phối viên quyết
> theo uỷ quyền** ngày 2026-08-20 (cùng khuôn mục 8) và AP-1 thi hành ngày 2026-08-21, nên nó rời **Phần
> I** sang đây với một khối `🔨 PHÁN QUYẾT` và một khối `✅ ĐÃ THI HÀNH` ghi kèm ngày. 🔴 **Câu *"Phần I
> nay RỖNG"* KHÔNG được sửa tại chỗ và KHÔNG bị xoá** — nó đúng vào ngày nó được viết, và chính nó đã tự
> dự báo đúng chuyện này (*"'RỖNG' là một trạng thái của HÔM NAY, không phải một tính chất của file"*).
> **Phép liệt kê đang sống, đọc từ chính các tiêu đề `##` của phần này:** mục **1, 2, 3, 4, 5, 6, 7, 8,
> 9, 10, 11, 13, 14, 15**, nằm dưới các tiêu đề `## 1.`, `## 2.`, `## 3.`, `## 4.`, `## 5–7.`, `## 8.`,
> `## 9.`, `## 10.`, `## 11.`, `## 13.`, `## 14.`, `## 15.`. **Mục 12 vẫn ở Phần II** và AP-1 **không
> đụng** vào nó; **mười bảy mục còn lại của lứa AO-1 vẫn ở Phần I** và AP-1 **không đụng** vào mục nào
> trong số đó.
>
> 📎 **Cụm *"kể từ khi file tồn tại"* giữ NGUYÊN VĂN, RÚT 2026-08-19 (AK-1, sau vòng phản biện) — nó
> NÓI QUÁ, và nói quá về phía có lợi cho người viết nó.** Đo bằng máy trên **45 bản sửa** của chính file
> (`git log --follow`, nhánh hiện tại): **Phần I chỉ tồn tại từ `b50d8fae`** — **18 bản sửa đầu tiên
> file KHÔNG có Phần nào cả**. Câu đúng là **"lần đầu kể từ khi PHẦN I tồn tại"**. Tinh thần đứng vững
> (trước khi có Phần, mọi mục trong file đều là mục đang chờ), nhưng một câu *"kể từ khi file tồn tại"*
> là **một phủ định phổ quát trên một tập người viết chưa mở hết** — đúng luật của chính file này.
> 🔴 **Và một nửa nữa phải nói cùng lúc: "RỖNG" ở đây là rỗng MỤC, không rỗng NỘI DUNG.** Phần I vẫn
> giữ **88 dòng** prose bảo tồn — con trỏ mới, khối 📎 giữ nguyên văn câu cũ, ba khối lịch sử của
> I-2/AA-1/AJ-1, đoạn năm-mục-cũ, khối hoãn của mục 9, và đoạn luật *"bằng chứng ở dòng cuối của chính
> mục"*. **Không một dòng nào bị mất.** Đọc *"RỖNG"* trần trụi rất dễ hiểu thành *"đã bị dọn sạch"*, và
> đó là cách đọc sai.
>
> **Biên của phép đo trên, nêu chứ không lấp:** `git log --follow` chạy trên **nhánh hiện tại**; bản sửa
> của file trên nhánh khác, hoặc việc chưa commit, **nằm ngoài** — nên câu *"chưa từng rỗng"* chỉ phát
> biểu trên **45 bản sửa ấy**.

> 🔴 **ĐÍNH CHÍNH 2026-08-18, cùng ngày, cùng nhiệm vụ (phản biện I-3).** Chỗ này Z-1 vừa
> viết *"Phần này nay có SÁU mục, không phải bốn"*. Cả hai số đều sai: **sáu** đếm **tiêu
> đề** chứ không đếm mục (mục là **tám**), và **bốn** không mô tả cây nào — trước Z-1 phần
> này có **ba** tiêu đề và **năm** mục. Nó nằm **hai dòng dưới** đúng câu cảnh báo rằng đếm
> mục bằng tiêu đề đã sai một lần. Đó chính là luật đợt này mua được — *một số vô hướng tóm
> tắt một tập chưa ai liệt kê thì không phải một sự thật* — và ở đây tập **đã được liệt kê
> ngay cạnh**, nên phép liệt kê tự bác con số. Thay bằng phép liệt kê; câu sai giữ lại ở
> đây làm hồ sơ chứ không xoá.

---

## 1. Một `fleet-settings.json` hỏng khiến lần khởi động THÀNH CÔNG BÌNH THƯỜNG ghi đè cấu hình của vận hành viên

**Đo được:** nếu `fleet-settings.json` sai cú pháp (một lỗi gõ tay — file này sửa
được bằng tay và **không có schema**), lần khởi động vẫn **thành công**, và trong
quá trình đó **ghi đè** file bằng giá trị sàn lấy từ biến môi trường.
**Không có guard, không có callback, không một dòng log nào.**

**Điều kiện đã ghim theo cả hai chiều:** chỉ cần **một** trong ba biến `ST4I_*`
được đặt ⇒ file bị ghi đè. **Không** biến nào được đặt ⇒ file sống sót.

**Ở đâu:** `src/St4i.EdgeCore/Config/FleetSettingsStore.cs` (`FileName =
"fleet-settings.json"`), ghi qua chỗ gọi `Save` duy nhất trong `src/` tại
`src/St4i.EdgeCore/Fleet/FleetCore.cs:4876`.

**Vì sao nó nghiêm trọng hơn vẻ ngoài:** ba biến ấy tồn tại **cho bản cài dịch vụ
chạy nền (headless)** — tức đúng kiểu triển khai **không có giao diện để gõ lại
bộ ba giá trị** sau khi bị mất.

**Nếu không quyết định:** hành vi giữ nguyên. Một lỗi gõ trong file cấu hình sẽ
âm thầm thay cấu hình của vận hành viên bằng giá trị môi trường, và **không ai
biết cho tới khi máy chạy sai**.

**Bằng chứng:** commit `811c9054` (M-1) — phát hiện bằng một dụng cụ độc lập, xác
minh bằng cách chạy lại.

> ### 🔨 PHÁN QUYẾT 2026-08-16 — SỬA ~~, VÀ SỬA CÙNG MỤC 5–7~~
> ⚠️ **Vế thứ hai của tiêu đề này SAI và đã bị rút 2026-08-17** — mục 6 và 7 không
> phải trạng thái thứ ba, và mục 5 mất phần chung khi Q-1 đóng nó. Xem §5–7. Đoạn
> dưới giữ nguyên văn làm hồ sơ về điều đã công bố, kèm dấu ở từng chỗ sai.
> Đây là **khuyết tật mất dữ liệu** trên một đường **thành công**, không phải một
> lựa chọn thiết kế. Không có cách đọc nào khiến "ghi đè cấu hình của vận hành viên
> mà không một dòng log" là đúng.
>
> **Nhưng nó không được sửa tại chỗ.** ~~Nó là **hệ quả nặng nhất của mục 5–7**~~
> **[RÚT 2026-08-17 — mục 6 và 7 không cùng loại; xem §5–7]**: mã
> chỉ biết *có file* và *không có file*, nên một file **hỏng** rơi vào nhánh *không
> có*, và nhánh đó **được phép ghi**. Vá riêng chỗ này để lại đúng cái lỗ ấy ở ba
> chỗ khác.
>
> **Luật, phát biểu một lần cho ~~cả bốn mục~~** **[RÚT 2026-08-18 (Y-1) — *"cả bốn
> mục"* CHÍNH LÀ khẳng định gộp nhóm đã bị rút 2026-08-17, và nó sống sót **không một
> dấu nào** ở đây trong khi các câu liền kề trên và dưới nó đều đã được đánh dấu — dù
> khối này tự nhận, sáu dòng phía trên, là *"giữ nguyên văn… kèm dấu ở từng chỗ sai"*.
> Không chữ nào bị xoá; chỗ sai được đánh dấu. Xem §5–7.]**: một file **tồn tại nhưng không đọc
> được** là một trạng thái **thứ ba**. Nó **không bao giờ** được đối xử như *không
> tồn tại*, và **không bao giờ** bị ghi đè. Nội dung không đọc được là **bằng chứng
> duy nhất còn lại** của điều vận hành viên đã cấu hình.
>
> ~~**Thứ tự làm, và lý do — vì tài liệu này nói việc xếp thứ tự chọn một lời biện
> minh:**~~ **[RÚT 2026-08-17 — không có thiết kế chung nào để mà xếp thứ tự; xem
> §5–7]** Phần vẫn đúng và là lý do mục này đi trước: nó là mục duy nhất **phá huỷ
> dữ liệu người dùng trong một lần khởi động bình thường**. Mất log là tệ; **mất
> cấu hình trên một cỗ máy không có giao diện để gõ lại** là không phục hồi được.
>
> ### ✅ ĐÃ THI HÀNH — nhiệm vụ Q-1 (`.superpowers/sdd/third-state-unreadable/`)
> **Phạm vi đã làm: đường settings, và chỉ đường ấy** — `FleetSettingsStore` (một
> phép đọc **ba kết quả**: `Loaded` / `Absent` / `Unreadable`, và **bỏ hẳn phép kiểm
> tồn tại**) cùng composition root `St4i.EngineApi/Program.cs` (một nhánh thứ ba: không
> phát lại, không ghi, không xoá, báo ở mức `Error`). **Cả bốn** tác hại đã đo ở §3.1a
> được đóng bằng **một** thay đổi, vì cả ba đường xoá đều bị chặn ở nhánh gieo mầm mà
> nhánh ấy nay chỉ chọn được khi kết quả là `Absent`.
> **Cặp đối chứng đã chạy hai phía**: cùng một test, cùng một file hỏng dựng bằng tay —
> ở `dd4a3e68` file trên đĩa là **sàn môi trường** (dữ liệu vận hành viên MẤT), sau bản
> sửa nội dung **còn nguyên từng byte**.
> **Hàng 36** của `docs/startup-failure-posture.md` chuyển **S → U** và **✗ → ✓**.
> **Mục 5, 6 và 7 CHƯA làm**: quyết định này chỉ mở khoá mục 1. ⚠️ Câu gốc gọi chúng
> là một nhóm — **sai, rút 2026-08-17**: mục 6 đứng trên KHÔNG TÁCH RỜI ĐƯỢC, mục 7
> trên thứ tự quan sát được, và mô tả của mục 5 không được commit đã trích chứng minh.
> Xem §5–7.
>
> #### 🔴 Vòng sửa lỗi — MỘT SINH ĐÔI ĐÃ BỊ BỎ SÓT, VÀ ĐIỀU KIỆN CỦA NÓ CÒN YẾU HƠN
> Review bác bỏ dòng loại trừ `SiteLinkStore` trong bảng phạm vi vòng 1: `SiteLinkStore.Load()`
> **đúng nguyên văn** `FleetSettingsStore.Load()` trước Q-1, và `SiteBridgeManager.ApplyAsync`
> gọi `Save` **VÔ ĐIỀU KIỆN** trên đường khởi động. Nên một `site-link.json` không đọc được bị
> ghi đè bằng bản ghi mặc định trong một lần khởi động **thành công bình thường** — **host,
> cổng và chứng chỉ tin cậy đã ghim đều mất**, thiết bị lặng lẽ đứng một mình — **không một dòng
> log**, và **không cần biến môi trường nào** (UNS bật mặc định). Nặng hơn mục 1, vốn còn cần
> một trong ba biến `ST4I_*`.
> **Đã sửa** cùng thiết kế; cặp đối chứng chạy hai phía (ở `d83194bd` file trên đĩa là bản ghi
> mặc định; sau bản sửa còn nguyên từng byte). Chi tiết: `docs/startup-failure-posture.md` §3.1b.
>
> #### Hai thứ CỐ Ý để lại cho chủ sở hữu quyết
> 1. **`SiteBridgeManager.ReapplyCurrentAsync`** (từ `POST /v1/site/identity/rotate`) vẫn tới
>    được `Save` vô điều kiện ấy, với một link do **tiến trình tự nghĩ ra** chứ không đọc từ đĩa.
>    Do vận hành viên **khởi xướng** nhưng không phải do họ **chọn** — đóng nó là đổi HỢP ĐỒNG của
>    `ApplyAsync`, mà ba nơi cùng gọi phương thức ấy.
> 2. **`DeviceIdentityStore.TryLoad`** ghi đè `device-identity.bin` khi blob không đọc được.
>    **Không sửa**, và lý do phải chịu được phản biện: nó **có báo** ở mức `Error` và nói trước
>    rằng sẽ tái tạo; nội dung là **khoá do sản phẩm sinh**, không phải cấu hình vận hành viên gõ
>    ra, nên tiền đề của luật không đúng ở đây; và bản sửa "không ghi đè" lại **tệ hơn** — nó tạo
>    một vân tay MỚI mỗi lần khởi động, đúng thứ README §15.9 đã gọi tên là điều một Site đã ghim
>    sẽ từ chối. **Phần dư phải quyết:** ghi đè là không hoàn nguyên được và **chặn luôn đường
>    phục hồi bằng cách sửa môi trường** (một blob DPAPI sai máy/sai scope sẽ đọc lại được sau khi
>    sửa — nếu nó còn tồn tại). Cách sửa đúng là **giữ blob cũ dưới tên khác**, tức **DI CHUYỂN dữ
>    liệu**, mà nhiệm vụ này bắt buộc phải **dừng và báo** chứ không tự làm.

---

## 2. `Warn` được tính là TỐT cho OEE

**Đo được:** phép tổng hợp OEE rẽ nhánh trên các verdict **đã ghi xuống đĩa dưới
dạng chuỗi**:

- mẫu số: `verdict <> 'Skip'` — `src/St4i.EdgeCore/Historian/SqliteHistorianStore.cs:590`
- tử số: `verdict IN ('Pass', 'Warn')` — `src/St4i.EdgeCore/Historian/SqliteHistorianStore.cs:600`
- phạm vi: `reading_kind = 'ProcessResult'` — cùng file, dòng 581

**Hậu quả:** một chu kỳ `Warn` được tính là **tốt** trong OEE, trong khi ở mọi chỗ
khác của hợp đồng nó là *"không được phán quyết dứt khoát"*. `Skip` không nằm ở cả
tử lẫn mẫu.

**Chạm tới đâu:** `/v1/historian/oee`, danh sách OEE của fleet, và **bản PDF báo cáo**.

**Nếu không quyết định:** OEE tiếp tục báo cáo `Warn` là tốt. Đây có thể là **đúng
ý muốn** — nhiều nhà máy tính warn là hàng đạt — nhưng hiện **không nơi nào nói ra
điều đó**, nên người đọc con số OEE không có cách nào biết.

**Bằng chứng:** commit `72614dd9` (N-2). Tìm ra bằng việc **viết tài liệu**, không
phải bằng test — vì tách riêng ra thì không đường nào sai cả.

> ### ✅ PHÁN QUYẾT 2026-08-16 — GIỮ HÀNH VI, XUẤT BẢN NÓ
> **Không đổi phép tính.** `Warn` tính là tốt là **quy ước OEE thông thường** — một
> đơn vị đạt-kèm-cảnh-báo vẫn là đơn vị xuất xưởng được, và chất lượng đếm đơn vị
> xuất xưởng. Lý do quyết định là chỗ khác: **đổi công thức là viết lại mọi con số
> OEE đã báo cáo trong quá khứ**, kể cả những con số đã in ra PDF và đã gửi đi.
> Không có phiên bản nào cho công thức ấy, nên không ai đọc lại được sẽ biết con số
> họ cầm thuộc công thức nào.
>
> **Khuyết tật thật không phải phép tính — là việc nó chưa bao giờ được nói ra.**
> Việc phải làm: **công bố định nghĩa ngay tại chỗ con số được đọc** — phản hồi API,
> danh sách fleet, và bản PDF — bằng đúng ba câu: cái gì vào mẫu số, cái gì vào tử
> số, `Skip` không vào cả hai. Kèm một câu nói rõ **con số này không có phiên bản**.
>
> Nếu sau này nhà máy muốn `Warn` không tính là tốt, việc đó cần **một công thức có
> phiên bản**, không phải một lần sửa tại chỗ.
>
> #### ⏳ 2026-08-18 — TIẾP TỤC; HÀNH ĐỘNG VẪN CÒN NỢ, VÀ NÓ MỚI LÀM ĐƯỢC MỘT NỬA
> Chủ sở hữu xác nhận mục này **tiếp tục** và việc của nó **chưa xong**. Đo lại tại
> `3a1228ee`, vì "còn nợ" mà không đo thì cũng là một khẳng định không kiểm được:
> - **ĐÃ làm:** định nghĩa **có** được viết ra — `src/St4i.Connector.Abstractions/Models/Enums.cs`,
>   doc của kiểu `Verdict`, nói `Skip` bị loại khỏi mẫu số và `Pass`+`Warn` vào tử số, nên
>   `Warn` là **tốt** cho OEE.
> - **CHƯA làm:** phán quyết đòi công bố **ngay tại chỗ con số được đọc** — phản hồi API,
>   danh sách fleet, bản PDF. `OeeResultDto`
>   (`src/St4i.EngineApi/Endpoints/HistorianDtos.cs`) **không mang gì cả**. Một định nghĩa
>   đặt trên `enum` là chỗ **tác giả driver** đọc, không phải chỗ **người cầm con số OEE**
>   đọc, và mục này được lập ra cho người thứ hai.
> - **CHƯA làm:** câu *"con số này không có phiên bản"* **không có ở đâu trong `src/`**.
>
> ### ✅ ĐÃ THI HÀNH — nhiệm vụ AA-1 (2026-08-18), `.superpowers/sdd/oee-definition-and-row-shape/`
> **Không một con số OEE nào đổi, và không một dòng thực thi nào đổi.** Phép tính, hai câu SQL,
> `OeeCalculator` và hình dạng `OeeResultDto` giữ nguyên từng byte; toàn bộ bản sửa là **văn xuôi
> ở ba chỗ con số hiện ra**. Đó là điều phán quyết đòi: khuyết tật là sự im lặng, không phải công
> thức.
>
> **BA CHỖ, VÀ VÌ SAO ĐÚNG BA.** Phán quyết nêu *"phản hồi API, danh sách fleet, bản PDF"*. Trong
> mã hôm nay mỗi cái có đúng một chỗ của riêng nó:
> 1. **`OeeResultDto`** (`src/St4i.EngineApi/Endpoints/HistorianDtos.cs`) — hình dạng phản hồi mà
>    **cả hai** route OEE trả về. Route một-máy `GetOeeAsync` trả **chính DTO này**, nên nêu nó
>    thành một chỗ thứ tư là **đếm hai lần cùng một bề mặt**, không phải kỹ hơn.
> 2. **`HistorianEndpoints.GetOeeFleetAsync`** — danh sách fleet, một `OeeResultDto` mỗi máy trong
>    roster.
> 3. **`HistorianEndpoints.BuildReportPdf`** — khối OEE của bản PDF.
>
> **VIẾT BẰNG TIẾNG CỦA NGƯỜI CẦM CON SỐ, không phải tiếng của tác giả driver.** Ở cả ba chỗ, luật
> được phát biểu bằng **các con số mà chính bề mặt ấy in ra** — `TotalCount` là mẫu số (mọi chu kỳ
> process-result trong cửa sổ có verdict khác `Skip`), `GoodCount` là tử số (trong đó, những cái
> `Pass` hoặc `Warn`), `Fail` nằm ở mẫu chứ không ở tử, `Skip` **không nằm ở đâu cả**, và
> `Quality = GoodCount / TotalCount`. Không chỗ nào bắt người đọc phải mở `enum Verdict` ra mới
> hiểu được con số họ đang cầm.
>
> **CÂU *"CÔNG THỨC NÀY KHÔNG CÓ PHIÊN BẢN"* — viết ở chỗ nó ràng buộc, tức cả ba chỗ.** Nó ràng
> buộc **người so hai con số**, nên nó đứng ở nơi con số được giao: trên `OeeResultDto` (không có
> trường phiên bản nào, và **cái thiếu ấy nhìn thấy được ngay tại chỗ khai báo**), ở route fleet
> (nơi các hàng được so **với nhau**), và trong `BuildReportPdf` (bản in **rời khỏi toà nhà** và
> không mang gì để đối chiếu về sau).
>
> **KHẲNG ĐỊNH PHỦ ĐỊNH ĐÃ ĐƯỢC KIỂM, không phải được nhận.** Hồ sơ ghi *"câu ấy không có ở đâu
> trong `src/`"*. AA-1 quét lại `src/` ở `ec17f4f1` bằng bốn phép, và nói rõ đã quét cái gì:
> `no version` không phân biệt hoa thường; `unversion|un-version|not versioned|never versioned|versionless`;
> mọi dòng chứa `formula`; và `version` trong bán kính ba dòng quanh `formula`. **Kết quả trùng hồ
> sơ:** đúng **một** khớp, `src/St4i.EngineApi/Alarms/WebhookNotification.cs`, và nó nói về
> `User-Agent` — một thứ khác hẳn. Bốn phép ấy là thứ **có thể bác bỏ** khẳng định, và không phép
> nào bác được.
>
> 🔴 **TRẦN CỦA BẢN SỬA NÀY, nêu ra chứ không giấu: định nghĩa nay đọc được ở ba chỗ trong MÃ, chứ
> không ở ba chỗ trong TAY người cầm con số.** Một người đang cầm bản PDF in ra, hay đang đọc JSON
> trả về, **vẫn không thấy** câu nào — vì đưa nó vào PDF hay vào DTO là **đổi một payload đã xuất
> bản**, đúng hạng thay đổi mà phán quyết mục 3 và mục 4 dành riêng cho chủ sở hữu, và đúng ranh
> giới `PutOeeSettingsAsync` đã vạch khi từ chối nới `OeeSettingsDto`. Nên phần còn nợ **không phải
> một chỗ bị quên** — nó là **một quyết định chưa được hỏi**: *có thêm một trường mang định nghĩa
> (hoặc một mã công thức) vào `OeeResultDto` và một dòng vào PDF hay không*. Nếu chủ sở hữu muốn,
> đó là một mục mới, vì nó nới một hình dạng đã xuất bản.
>
> #### 🔴 ĐÍNH CHÍNH 2026-08-18 (AA-1 vòng phản biện 1) — TRẦN TRÊN NÊU QUÁ NHỎ, VÀ CÓ MỘT CHỖ THỨ TƯ
> **Có một chỗ thứ TƯ con số OEE hiện ra, và nó gần "người cầm con số" hơn cả ba chỗ đã chọn: giao
> diện web.** Liệt kê, không tóm tắt: `web/src/routes/Reports.tsx` (bốn `KpiTile`, trong đó
> `reports.kpi.quality` in `oee.data.quality * 100` và `reports.kpi.oee` in `oee.data.oee * 100` —
> đây là chỗ một quản đốc **thật sự đọc** con số Quality); `web/src/components/OeeLossChart.tsx` (cột
> *"Quality loss"*); và `web/src/lib/api.ts`, interface `OeeResult`, mười lăm trường, mang một khối
> chú thích tự nhận *"Wire shapes mirror … `OeeResultDto` … **exactly**"* và giải thích ngữ nghĩa
> từng trường — mà **không nói gì** về `Warn` hay `Skip`.
>
> 🔴 **Và lý lẽ của trần trên KHÔNG áp cho chỗ ấy.** Trần quy phần còn nợ cho **lệnh cấm đổi payload**.
> Lý lẽ ấy đúng cho bản PDF và cho việc thêm một trường vào `OeeResultDto`. Nó **không đúng** cho một
> khối chú thích TypeScript trên `web/src/lib/api.ts`: viết ở đó **không đổi một payload, không đổi
> một pixel, không chạm cổng** — đúng hạng sửa mà AA-1 đã làm ở bốn file `.cs`. Nên trần như viết
> **nêu quá nhỏ**, và luật câu chữ nói thẳng: *một cái trần nêu quá nhỏ còn tệ hơn không nêu trần.*
>
> **Vì sao vòng này vẫn không viết nó:** vòng phản biện 1 bị cấm sửa bất cứ thứ gì dưới `web/`. Nên
> đây là **một việc còn nợ có địa chỉ**, không phải một lệnh cấm — khác hẳn nửa PDF/DTO, thứ cần một
> phán quyết. **Ai nhặt nó lên không cần hỏi chủ sở hữu.**
>
> **Và định nghĩa ở cả ba chỗ đã được BỔ SUNG một bộ lọc thứ hai** mà vòng đầu bỏ sót: ngoài
> `reading_kind = 'ProcessResult'`, cả hai câu đếm còn đi qua **cổng provenance**
> (`ApplyRealPresenceGateAsync`, quyết bởi `ResolveIncludeFabricated` / `DemoModeGate`), thứ **mặc
> định loại mọi hàng ghi là FABRICATED**. Trên **chính sản phẩm này** — một simulator — đó thường là
> thứ **quyết định** con số bằng 0, và cả ba khối văn xuôi trước đây quy triệu chứng *"toàn số 0"*
> **chỉ** cho reading-kind. Nay cả ba nêu đủ hai bộ lọc.

---

## 3. Telemetry còn sót trên một reading `ProcessResult`: được ghi, vào live state, nhưng KHÔNG lên Sparkplug

**Đo được:** đường ống publish **mọi** reading. `BuildSparkplugMetrics`
(`src/St4i.EdgeCore/Uns/UnsPublisher.cs:396`, gọi từ dòng 305) rẽ nhánh theo `Kind`,
và **nhánh `ProcessResult` không bao giờ đọc `Telemetry`**.

Nên cùng một trường, với ba người tiêu thụ, cho ba kết quả khác nhau:
- historian: **được ghi** (không kiểm `Kind`)
- live state: **được đọc vào** (không kiểm `Kind`)
- Sparkplug: **im lặng bỏ qua**

**Vì sao không dụng cụ nào bắt được:** **tách riêng ra thì không bên nào sai.**
Không test, cổng, hay phép kiểm đếm nào so sánh hai bên tiêu thụ với nhau.

**Nếu không quyết định:** dữ liệu tồn tại trong cơ sở dữ liệu và trên màn hình,
nhưng **không bao giờ tới hệ thống phía trên qua MQTT**. Ai đối chiếu hai nguồn sẽ
thấy lệch và không có lời giải thích.

**Bằng chứng:** commit `72614dd9` (N-2).

> ### ✅ PHÁN QUYẾT 2026-08-16 — GIỮ DÂY NGUYÊN, KHÔNG SỬA ĐƠN PHƯƠNG
> **Đây là chỗ uỷ quyền không với tới.** Thêm telemetry vào nhánh `ProcessResult`
> của Sparkplug **đổi payload MQTT** — và bên đăng ký nằm **ngoài repo này, ngoài
> tổ chức này**. Một hệ thống phía trên đang phân bổ metric theo alias sẽ nhận thêm
> metric mà nó chưa khai báo. Tôi có thể quyết *"nên hay không nên đổi"*; tôi
> **không thể quyết thay người đang chạy hệ thống nhận**.
>
> **Và tách riêng ra thì hành vi hiện tại phòng thủ được:** hợp đồng nói mỗi `Kind`
> nêu tên tập hợp của nó. Telemetry đặt trên một reading `ProcessResult` là **dữ
> liệu ngoài hợp đồng**. Historian ghi nó là hào phóng; Sparkplug bỏ qua nó là
> **đúng hợp đồng**. Cái sai duy nhất là **không ai được báo**.
>
> **Đã làm, và đủ:** cả ba kết quả đã được nêu tên trên chính thành viên đó trong
> N-2 — ghi xuống, vào live state, **không publish** — nên tác giả driver đọc hợp
> đồng sẽ thấy trước khi họ gửi.
>
> **Kích hoạt để mở lại:** khi có một bên đăng ký thật yêu cầu trường này. Lúc đó
> nó là một **thay đổi hợp đồng có phiên bản**, không phải một bản vá.
>
> #### 🔴 2026-08-18 — MỘT CÂU TRẢ LỜI ĐÃ TỚI MỤC NÀY, VÀ MỤC NÀY KHÔNG CÓ CHỖ NHẬN NÓ
> Đợt quyết định 2026-08-18 trả về *"**3, 9** — để lại sau cùng"*. **Mục 9 nhận được câu
> ấy; mục 3 thì không**, và chỗ chênh được ghi ra chứ không hoà giải im lặng:
>
> - Mục 3 **không nằm trong tập đang chờ**. Nó đã có phán quyết **2026-08-16** ở ngay
>   trên, và bảng phán quyết ghi `✅` chứ chưa bao giờ ghi `🔴 CHỜ ANH`.
> - Việc của nó **đã xong**: cả ba kết quả đã được nêu tên trên chính thành viên
>   `Telemetry` của `DeviceReading` (N-2) — đo lại tại `3a1228ee` và còn nguyên.
> - **Một lần hoãn không gắn được vào một mục đã quyết và đã thi hành.** Nó không có gì
>   để hoãn.
>
> **Nên trạng thái mục 3 KHÔNG đổi**, và Y-1 **không** ghi một phán quyết mới ở đây. Điều
> được ghi là **đã có một câu trả lời tới nhầm cửa** — thứ mà im lặng sẽ biến thành một
> mục 3 vừa "đã quyết 2026-08-16" vừa "hoãn 2026-08-18", hai trạng thái không cùng đứng
> được. Nếu chủ sở hữu thật sự muốn **mở lại** mục 3, đường để làm việc đó đã có sẵn và
> nằm ngay trên: **kích hoạt để mở lại**, và nó đòi một bên đăng ký thật, không phải một
> lần hoãn.

---

## 4. `WaveformSeries.Samples` KHÔNG có hình dạng hàng cố định

**Đo được:** ba nguồn, ba nghĩa, trên **bề mặt mà tác giả driver bên thứ ba đọc
trước tiên**:
- SDK vendored ghi `[[t,v],…]` — `examples/device-client/csharp/St4iDeviceClient.cs`
- `ScrewdriveSim` phát ra **từng cặp**
- `WelderSim` phát ra **một giá trị mỗi hàng**

**Hiện đang:** ship dưới dạng **ghi rõ là mơ hồ** — cả ba hình dạng được nêu tên,
kèm câu *"không được giả định hình dạng hàng chỉ từ kiểu này"*.

**Vì sao chưa giải:** chọn một nghĩa là **đổi hành vi một bề mặt đã xuất bản**.
Đó là quyết định của chủ sở hữu, không phải việc dọn dẹp kỹ thuật.

**Nếu không quyết định:** mỗi tác giả driver tự đoán, và nửa số đoán sẽ sai.

**Bằng chứng:** commit `72614dd9` (N-2).

> ### ⚖️ PHÁN QUYẾT 2026-08-16 — LUẬT ĐÃ CÓ SẴN TRONG DỮ LIỆU, CHỈ CHƯA AI VIẾT RA
> **Đo lại trước khi quyết, và phép đo lật khung của chính mục này.** Mô tả cũ —
> *"SDK nói `[[t,v]]`, `ScrewdriveSim` phát cặp, `WelderSim` phát một giá trị"* —
> ngụ ý hai trên ba đồng ý với SDK. **Sai. Không producer nào phát `[[t,v]]` cả:**
>
> | nguồn | hàng | `RateHz` |
> |---|---|---|
> | SDK vendored (`St4iDeviceClient.cs:86`) | `// [[t,v],…]` | — |
> | `ScrewdriveSim.cs:186` | `new[] { angle, torque }` — **(x, y), x là GÓC không phải thời gian** | **null** (dòng 189) |
> | `WelderSim.cs:47` | `new[] { current }` — một giá trị | **được đặt** (dòng 40) |
>
> **Hai producer NHẤT QUÁN với nhau, và `RateHz` chính là thứ phân biệt:**
> - `RateHz` **được đặt** ⇒ có trục thời gian đều ⇒ thời gian là **ngầm định**, suy
>   ra từ chỉ số và tần số. Một giá trị mỗi hàng là **đúng và tiết kiệm**.
> - `RateHz` **null** ⇒ **không có** trục thời gian đều ⇒ hàng phải **tự mang trục X
>   của nó**: `[x, y]`. Ở `ScrewdriveSim`, x là **góc siết**, không phải thời gian.
>
> **Nên cái sai không phải hai producer — là chú thích trong SDK.** `[[t,v],…]` mô
> tả **không producer nào**, và nó là thứ tác giả driver bên thứ ba đọc trước tiên.
>
> **Quyết định:** ✅ **`RateHz` là bộ phân biệt, và nó đã được thực thi nhất quán
> sẵn rồi.** Viết luật ấy lên chính `WaveformSeries` — nơi hợp đồng sống — nêu tên
> chú thích SDK là **đã biết sai** (file vendored, **cấm sửa**), và **cắm nhân chứng**
> để nó không trôi lại.
>
> 🔴 **KHÔNG đổi hành vi.** Tuyên bố `[[t,v]]` là chuẩn sẽ **phá cả hai producer** và
> vứt đi quan hệ với `RateHz` — đó là lý do mục này phải đo trước khi quyết, và là lý
> do câu trả lời hiển nhiên lại là câu sai.
>
> #### ⏳ 2026-08-18 — TIẾP TỤC; HÀNH ĐỘNG VẪN CÒN NỢ, VÀ NÓ CHƯA BẮT ĐẦU
> Chủ sở hữu xác nhận mục này **tiếp tục** và việc của nó **chưa xong**. Đo lại tại
> `3a1228ee` trên chính bề mặt phán quyết chỉ tới, `WaveformSeries`
> (`src/St4i.Connector.Abstractions/Models/DeviceReading.cs`):
> - doc của nó **vẫn là văn bản TRƯỚC phán quyết** — vẫn kết bằng *"A consumer must
>   therefore not assume a row shape from this type alone"*, tức vẫn ship **sự mơ hồ đã
>   ghi rõ**, đúng thứ phán quyết thay thế;
> - nó **mô tả** tương quan `RateHz` (một giá trị mỗi hàng khi có `RateHz`, `[x, y]` khi
>   `RateHz` null) nhưng **không phát biểu `RateHz` LÀ BỘ PHÂN BIỆT**, mà đó mới là luật;
> - nó **không nêu tên chú thích SDK là ĐÃ BIẾT SAI** — nó viết *"matches neither
>   exactly"*, một nhận xét, không phải một phán quyết;
> - **không có nhân chứng nào được cắm**, mà phán quyết đòi *"cắm nhân chứng để nó không
>   trôi lại"*.
>
> ### ✅ ĐÃ THI HÀNH — nhiệm vụ AA-1 (2026-08-18), `.superpowers/sdd/oee-definition-and-row-shape/`
> **Không một hàng `Samples` nào đổi, và không một dòng thực thi nào đổi.** Cả hai bộ sinh giữ
> nguyên từng byte. Bản sửa là **một luật thay cho một lời phủ định**, cộng **một nhân chứng**.
>
> **BẢNG ĐO CỦA MỤC NÀY ĐƯỢC ĐỐI CHIẾU, KHÔNG CHÉP — và nó đứng vững ở `ec17f4f1`.** Bảng được đo
> ở `3a1228ee`; mọi số dòng trong đó **vẫn đúng nguyên** hôm nay (`ScrewdriveSim.cs:186`/`:189`,
> `WelderSim.cs:47`/`:40`, `St4iDeviceClient.cs:86`), nên **không có con số nào dịch**. Cách đo
> không phải đọc bằng mắt: một nhân chứng chạy **cả tám** simulator dựng sẵn qua nhiều chu kỳ và
> khẳng định luật trên **mọi** series chúng phát ra, nên một bộ sinh **thứ ba** cũng bị kiểm mà
> không ai phải nhớ thêm nó vào.
>
> **LUẬT, phát biểu ở dạng BÁC BỎ ĐƯỢC — và nó chặt hơn cách mục này phát biểu.** Cách phát biểu
> cũ (*"`RateHz` được đặt ⇒ một giá trị mỗi hàng; `RateHz` null ⇒ `[x, y]`"*) **chưa bác bỏ được**:
> nó không nói gì về **hàng ba phần tử**, về **hàng rỗng**, hay về một hàng dài hơn *"một"*. Luật
> viết lên hợp đồng nói bằng **độ dài hàng, và bằng chữ ĐÚNG**:
> - `RateHz` **được đặt** ⇒ mỗi hàng có **đúng MỘT** phần tử, là giá trị đo trong `Unit`; hàng thứ
>   `i` là mẫu tại `i / RateHz` giây. Trục thời gian **không** nằm trong hàng.
> - `RateHz` **null** ⇒ mỗi hàng có **đúng HAI** phần tử `[x, y]`; phần tử 0 là biến độc lập của
>   chính series ấy và **không phải thời gian** (ở `torque_vs_angle` nó là **góc siết**, độ).
> - Mọi hàng khác **nằm ngoài hợp đồng**. Một `Samples` **rỗng** thoả mãn **vô can**, vì luật phát
>   biểu **theo từng hàng**.
>
> **Người tiêu thụ làm được gì sau khi đọc mà trước đó thì không:** từ **một mình `RateHz`**, trước
> khi chạm vào một hàng nào, họ biết phải **dựng lại** trục X từ chỉ số hay **đọc** nó ở phần tử 0
> — và biết rằng ở nhánh null, phần tử 0 **không phải** một mốc thời gian.
>
> 🔴 **MỘT HỆ QUẢ CỦA LUẬT MÀ HỢP ĐỒNG ĐANG NÓI SAI, và nó được sửa cùng lúc:** `Unit` mô tả
> **giá trị đo** — phần tử duy nhất ở nhánh có `RateHz`, phần tử **thứ hai** ở nhánh null — chứ
> không mô tả cả hàng. `torque_vs_angle` mang `Unit = "Nm"` trong khi phần tử 0 của nó là **độ**,
> và **kiểu này không có trường nào mang đơn vị ấy**. Doc cũ viết *"đơn vị mà các giá trị lấy mẫu
> được biểu diễn"*, tức khẳng định sai về phần tử 0.
>
> **LỜI PHỦ ĐỊNH ĐÃ ĐƯỢC RÚT, giữ nguyên văn tại chỗ** (cùng một kiểu bảo tồn AA-1 dùng ở mọi chỗ
> — xem ghi chú 📎 ở đầu Phần II): câu *"A consumer must therefore not assume a row shape from this
> type alone."* nay đứng trong doc của `WaveformSeries` **trong ngoặc kép, kèm nhãn RÚT 2026-08-18
> và lý do**, để người đã viết mã theo nó **thấy nó bị rút** chứ không thấy nó biến mất.
>
> 🔴 **CHÚ THÍCH SDK ĐƯỢC NÊU TÊN LÀ ĐÃ BIẾT SAI — VÀ TẬP ẤY RỘNG HƠN MỘT DÒNG.** Mục này nêu một
> chỗ (`St4iDeviceClient.cs:86`). AA-1 quét cả họ SDK và tìm thêm **hai loại**:
> - `[[t, v], ...]` cũng nằm trong **SDK Python** (`examples/device-client/python/st4i_device_client.py`,
>   hai chỗ), nên chú thích sai đã **được nhân bản** sang một client anh em.
> - Nặng hơn: các **ví dụ chạy được** của họ SDK không chỉ mô tả sai — chúng **gửi** một hình dạng
>   luật không định nghĩa: `examples/device-client/csharp/ExampleScrewdriver.cs`,
>   `examples/device-client/python/example_screwdriver.py` và `examples/device-client/README.md` đều
>   đặt `rateHz` **kèm** hàng hai phần tử, và ở cả ba, phần tử 0 là **góc siết** chứ không phải thời
>   gian. **Đó là thứ tác giả driver bên thứ ba copy**, chứ không phải dòng chú thích.
> **Không file nào trong `examples/` bị sửa** — đúng như mục này (và mục 12) bắt buộc. Chúng được
> **nêu tên trên hợp đồng**, kèm chỗ đọc đúng.
>
> **NHÂN CHỨNG, và bằng chứng nó ĐỎ ĐƯỢC.**
> `tests/St4i.EdgeCore.Tests/WaveformSeriesRowShapeContractTests.cs`, bốn `[Fact]`
> (`EXPECT_EDGECORE` 1143 → 1147, biện minh đầy đủ ngay cạnh hằng số). Cặp đối chứng chạy **cả hai
> phía**, chỉ `src/` đổi, cả hai lần đổi đã hoàn nguyên: **HEAD** — Failed 0 / Passed 4;
> **`WelderSim` phát `[t, current]` mà vẫn đặt `RateHz`** — Failed 3 / Passed 1;
> **`ScrewdriveSim` giữ nguyên hàng `[angle, torque]` mà khai `RateHz = 500`** — Failed 3 / Passed 1.
> Cánh tay thứ hai ấy **chính là hình dạng các ví dụ SDK đang xuất bản**. Test xanh ở cả ba lần là
> cái đo **vị từ** chứ không đo bộ sinh, nên đó là kết quả đúng.
>
> 🔴 **TRẦN CỦA BẢN SỬA NÀY: KHÔNG GÌ CƯỠNG CHẾ LUẬT.** Kiểu này nhận mọi `double[]`; normalizer
> chép hàng ra dây nguyên vẹn; `LiveTransport` chép ngược lại nguyên vẹn; bộ so của conformance
> harness so từng phần tử mà **không bao giờ hỏi độ dài hàng**; và **không một chỗ nào trong `src/`
> hay `tests/` đánh chỉ số vào một PHẦN TỬ của hàng**. Nên luật ràng buộc **bộ sinh bằng hợp đồng,
> không bằng cấu trúc**, và một hàng vi phạm sẽ **được chở đi** chứ không bị từ chối. Nhân chứng
> giữ **hai bộ sinh của sản phẩm này**, không giữ driver bên thứ ba, và không giữ họ SDK. Một
> series cố ý **lởm chởm** vẫn đi qua vòng round-trip nguyên vẹn hôm nay, cố ý, trong fixture của
> `ConnectorRoundTripTests` — đó là một khẳng định về **bộ tuần tự hoá**, không phải một phản ví dụ
> của luật. Đóng cái trần này nghĩa là **thêm phép kiểm và từ chối một payload**, tức đổi hành vi,
> tức một mục mới cho chủ sở hữu.
>
> #### 🔴 ĐÍNH CHÍNH 2026-08-18, cùng ngày, cùng nhiệm vụ (AA-1 vòng phản biện 1) — GHI CHÉP TRÊN ĐÚNG VỀ PHÉP ĐO CỦA NÓ VÀ SAI VỀ PHẠM VI CỦA PHÉP ĐO ẤY
> **Phần đứng vững:** hai bộ sinh đã được đo, chúng nhất quán với nhau, và số dòng của bảng không
> trôi. Không câu nào ở trên về **hành vi của hai bộ sinh** bị rút.
>
> **Phần sai, và nó là phần được xuất bản lên một bề mặt hợp đồng N-2:** phép đo dừng ở
> `tools/machine-simulator/`, tức **dừng ở phía SINH**. Ở phía **TIÊU THỤ**, trong cùng repository và
> cùng commit, `POST /api/v1/ingest/process-result` **cưỡng chế hình dạng NGƯỢC LẠI** — mỗi hàng đúng
> **hai** số, `rateHz` là trường tuỳ chọn độc lập — và dưới hợp đồng ấy `WelderSim` phát một payload
> **bị TỪ CHỐI**. Toàn bộ phép đo nằm ở **mục 14**, vừa mở ở Phần I.
>
> **Ba câu AA-1 xuất bản lên `WaveformSeries` đã được RÚT tại chỗ chúng được viết**, giữ nguyên văn,
> kèm ngày — cùng một kiểu bảo tồn (📎 đầu Phần II). Chúng là:
> *"Any other row is outside this contract — … two elements on a rated one."*;
> *"That is a defect in those published files, not a second convention."*;
> *"no reader in this repository indexes an element of a row at all."*
> Câu thứ ba còn bị **chính file test mà AA-1 thêm vào** bác — nó đánh chỉ số vào phần tử ở **ba**
> chỗ; phép đếm sinh ra câu ấy chạy ở **base**, câu được giao ở **HEAD**. Đúng loài *"động vào là mở
> lại khẳng định"*, và phép đếm **đã được chạy lại trên cây được giao** vòng này.
>
> **Câu quảng cáo về nhân chứng cũng bị rút:** *"một bộ sinh THỨ BA cũng bị kiểm mà không ai phải nhớ
> thêm nó vào"*. `BuiltInSimulators()` là **danh sách viết cứng** tám lớp; một lớp **thứ CHÍN** sẽ
> không bị quét và không gì báo. Câu đúng là câu hẹp hơn: **một trong tám lớp đã liệt kê** bắt đầu
> phát waveform thì bị quét.
>
> **Nhân chứng đã được sửa để ghim CÁI ĐÚNG:** nó giữ **hành vi đo được của hai bộ sinh** — không ai
> tranh cãi — và **assertion nói ví dụ chuẩn tắc của nền tảng là sai đã bị GỠ**, kể cả các con số nó
> mượn từ đặc tả. Tổng suite **không dịch** (vẫn 1147, bốn `[Fact]` trước và sau); bốn tên `[Fact]`
> đổi vì tên cũ khẳng định *"the Rule"*, và một tên thành viên là một chuỗi đã công bố — phép đổi tên
> được ghi ngay cạnh `EXPECT_EDGECORE`.
>
> 🔴 **Điều mục này KHÔNG làm:** nó **không quyết** quy ước nào thắng, và không được đọc như thế.
> Phán quyết 2026-08-16 vẫn nguyên văn ở trên; cái mới là **tiền đề của nó đã bị bác**, và chỗ để
> quyết là **mục 14**.

---

## 5–7. ~~Ba mục cùng CHUNG một trạng thái thứ ba còn thiếu~~ — **ĐẦU ĐỀ NÀY SAI, ĐÃ SỬA 2026-08-17**

> ### 🔴 ĐÍNH CHÍNH — khẳng định gộp nhóm là của tôi, và nó không đứng được
> Bản đầu của file này gộp ba mục dưới thành *"một vấn đề xuất hiện ba lần"*, chung
> **trạng thái thứ ba còn thiếu**, và kết luận **thứ tự làm chọn một lời biện minh
> chứ không chọn một thiết kế**. Trước khi giao việc, tôi đi kiểm khẳng định ấy
> **trên chính các commit tôi đã trích dẫn**. Nó **hỏng ở cả ba mục**:
>
> - **Mục 6 không phải trạng thái thứ ba.** `99ab7b61` nói nó đứng trên
>   **KHÔNG TÁCH RỜI ĐƯỢC**: *các dòng halt được phát ra bởi mã BẮT BUỘC phải chạy
>   thì một lần halt mới xảy ra, còn việc phát `deferredLogs` là một lựa chọn đứng
>   riêng.* Đó là câu hỏi **hai thứ có tách rời được không**, không phải câu hỏi về
>   trạng thái của một file.
> - **Mục 7 cũng không.** `99ab7b61` nói dựng-trước-khi-tháo **đảo thứ tự khởi động
>   lại mà vận hành viên quan sát được**, và việc quay lui bản commit **đổi nghĩa của
>   một lời gọi thất bại đối với người gọi nó**. Đó là **thứ tự và tính giao dịch**.
> - **Mục 5 tệ hơn: trích dẫn KHÔNG CHỨA điều tôi mô tả.** `eca39f89` không có chỗ
>   nào nói về *"ba hình dạng xoá file"*. Thứ nó thật sự nói về xoá là
>   **trạng thái thứ ba** — *"mảnh còn thiếu là một trạng thái thứ ba, 'một file tồn
>   tại và không đọc được', thứ mà cả composition root lẫn store đều không biểu
>   đạt"* — và **Q-1 đã đóng đúng mảnh đó** (commit `17fa6841`).
>
>   > 🔴 **ĐÍNH CHÍNH CỦA ĐÍNH CHÍNH — S-1, 2026-08-17. Đoạn trên đúng về trích dẫn
>   > và SAI về kết luận rút ra từ nó.** Tôi kết luận mô tả *"ba hình dạng xoá file"*
>   > là **không kiểm được**. Nó kiểm được. Nó chỉ **trích sai nguồn**.
>   >
>   > Ba hình dạng ấy **tồn tại, đã đo, và nằm trong repo**: bảng ba dòng ở
>   > `docs/startup-failure-posture.md` §3.1a (*"The seed-arm shape | `Save(floor)` |
>   > `Delete()` | What is on disk afterwards"*), do dụng cụ M-1 `tools/settings-acl-probe`
>   > chạy ra (`811c9054`). Ba dòng: deny **lan truyền** (`Save` ném, `Delete` no-op,
>   > file sống), deny **cả hai đối tượng không lan truyền** (file MẤT), và **file hỏng
>   > cú pháp** (file MẤT). Cùng một tình huống — nhánh gieo mầm — **hành vi khác nhau**,
>   > và **cách nhau đúng một hợp đồng**: `_onLiveSettingsRebuilt`, thứ chính chỗ gọi
>   > gọi là một callback host tuỳ ý. Mô tả của tôi khớp **cả ba chi, từng chi một**.
>   >
>   > ⚠️ **Bản đầu viết "khớp từng chữ". Đó là một lời diễn giải, không phải một trích
>   > dẫn** — mỗi chi ánh xạ vào một mệnh đề nguyên văn trong §3.1a, nhưng không câu
>   > nào trong §3.1a là bản sao của mô tả. Trong một nhiệm vụ mà luật vị ngữ là luật,
>   > "từng chữ" là từ sai cho một lời diễn giải, kể cả khi lời diễn giải ấy đúng.
>   >
>   > 🔴 **Và có một lý do thứ hai khiến phép kiểm ban đầu trượt, do phản biện tìm ra
>   > và đáng giữ:** ở `Program.cs` cụm từ ấy **bị ngắt dòng qua một dòng chú thích
>   > tiếp nối**, nên `grep "deletion shapes"` trả về **rỗng** — chỉ một phép tìm biết
>   > gộp dòng mới thấy. Tức đúng cái hình dạng §8.1(f) một tầng nữa: **con trỏ có
>   > trong sản phẩm, và bản thân nó cũng vô hình trước dụng cụ hiển nhiên.**
>   >
>   > Chính Q-1 đã trỏ đúng chỗ ấy: chú thích Q-1 thêm vào `St4i.EngineApi/Program.cs`
>   > viết nguyên văn *"tabulated as the three deletion shapes in
>   > `docs/startup-failure-posture.md` §3.1a"*. Nên đường dẫn tới bằng chứng nằm
>   > **trong cây mã**, và tôi đã đi kiểm bằng cách mở **commit** thay vì đi theo
>   > **con trỏ** — tức tôi kiểm sai artefact rồi ghi kết quả như một phán quyết về
>   > mô tả.
>   >
>   > **Cái vẫn đúng, và nó mới là điều quan trọng:** cả ba hình dạng là **một chỗ
>   > duy nhất** (cặp `Save`+`Delete` của nhánh gieo mầm), và **Q-1 đã đóng đúng chỗ
>   > đó** — nhánh ấy nay chỉ chọn được khi `Absent`. Nên mục 5 **mất phần đã nêu**,
>   > đúng như kết luận. Điều nó KHÔNG mất là câu hỏi tổng quát, và câu hỏi ấy giờ
>   > **đã đo** — xem §5.
>
> **Nên: hai mục không cùng loại với nhau, và mục thứ ba đã bị Q-1 lấy mất phần
> chung.** Câu *"thứ tự chọn một lời biện minh"* vì thế cũng sai — **không có thiết
> kế chung nào để mà chọn**.
>
> **Đây đúng loài mà cả đợt làm việc này đi bắt:** một khẳng định về một **quần thể**
> được nêu ra mà không có phép kiểm đếm có thể bác bỏ nó — và lần này nó ở trong
> **artefact tôi lập ra để chấm dứt việc khẳng định không kiểm được**. Ba đoạn dưới
> đây viết lại **theo cơ chế thật của từng mục**, và không mục nào tuyên bố có họ
> hàng với mục nào.

### 5. `oee-settings.json` bị THAY bằng một entry duy nhất khi file cũ không đọc được — không lỗi, không log

**Mục này đã được ĐO (S-1, `fac26188`). Nó không đóng: nó đổi mục tiêu.** Bộ ba
hình dạng cũ đúng là đã bị Q-1 đóng (xem đính chính ở §5–7). Câu hỏi tổng quát —
*"các đường xoá còn lại có phân kỳ ở cùng một tình huống không?"* — nay có **câu
trả lời có bằng chứng, và đó là CÓ**.

**Tình huống được giữ cố định, phát biểu một lần:** *artefact có mặt trên đĩa, và
tiến trình không hiểu được các byte của nó.* Đây đúng là tình huống mục 5 thừa kế
từ Q-1. **Một handle deny-share, một ACL Windows và một ổ đĩa đầy KHÔNG phải tình
huống này** — `docs/startup-failure-posture.md` §3.1a đã trả giá hai lần cho việc
gộp chúng làm một.

⚠️ **BẢNG NGAY DƯỚI ĐÂY LÀ HỒ SƠ CỦA CÂY MÃ TẠI `fac26188`, VÀ HAI Ô CỦA NÓ KHÔNG CÒN
ĐÚNG — sửa 2026-08-17 (V-1).** `OeeSettingsStore` **không còn** ở dòng thứ ba (nó có
phép đọc ba kết quả), và **"chín" không phải kích thước của quần thể** — nó là kích
thước của tập S-1 chọn đo, và tập ấy không có luật thành viên nào để mà bác. Bảng được
giữ nguyên văn làm hồ sơ, đúng như §3.1a của `startup-failure-posture.md` giữ các phép
đo tiền-Q-1. **Bảng đang sống nằm ở `docs/startup-failure-posture.md` §3.6**, và bản
ghim máy đọc được là `OperatorDataRemovalCensusTests.ExpectedPostures`.

**Đo được — chín store, dựng thật, trên một artefact hỏng trong thư mục tạm của
chính lần chạy test (không đụng gì dưới `%ProgramData%\ST4I\`). BA tư thế:**

| tư thế | store | nghĩa vận hành |
|---|---|---|
| **Trạng thái thứ ba** | `FleetSettingsStore`, `SiteLinkStore` | phép đọc trả về một kết quả RIÊNG; chỗ gọi **rẽ nhánh được** |
| **Ném** | `MachineConfigStore`, `ProductConfigStore`, `SimulatedEcosystem`, `ConnectorConfigStore`, `NotificationConfigStore`, `SecurityDb` | thao tác dừng; **không mất byte nào**; store không phát biểu trạng thái, chỗ gọi chỉ biết bằng cách bắt |
| 🔴 **Không đọc được = không tồn tại** | **`OeeSettingsStore`** | chỗ gọi **không có gì để rẽ nhánh**, vì hai ca trả về cùng một thứ |

**Đo được, ở dòng cuối bảng — và đây là phần cần anh quyết:**
`OeeSettingsStore.Load` bắt `JsonException` rồi khởi động từ store rỗng, tức **đúng
bằng trạng thái trong bộ nhớ mà nó đạt tới khi file không hề tồn tại**. Mutator duy
nhất của nó (`Set`) sau đó **ghi trạng thái ấy đè lên file**. Nên
`oee-settings.json` của vận hành viên — **ideal-cycle override và
planned-production ratio của MỌI máy** — bị thay bằng **một entry duy nhất** mà
lần `PUT /v1/historian/oee/settings` kế tiếp mang theo. **Không ném, không một dòng
log, không một trường trạng thái nào trả về.**

Đây **đúng cơ chế** Q-1 đã sửa ở `fleet-settings.json` và `site-link.json`, **còn
sống ở file thứ ba**.

**Ở đâu:** `src/St4i.EdgeCore/Historian/OeeSettingsStore.cs` (`Load`, khối
`catch (JsonException)`; `Set` → `Save` → `WriteAllTextAtomic`), tới được từ
`src/St4i.EngineApi/Endpoints/HistorianEndpoints.cs` (`PutOeeSettingsAsync`, chính
sách `Engineer`).

**Hậu quả vận hành, và nó chạm vào mục 2:** hai giá trị ấy là **đầu vào của phép
tính OEE**. Mất chúng không làm gì hỏng thấy được — nó làm **con số OEE đổi thầm
lặng** về mặc định (`override = null`, `ratio = 1.0`) cho mọi máy trừ máy vừa được
đặt. Mục 2 vừa quyết **giữ công thức OEE và xuất bản định nghĩa của nó vì đổi công
thức là viết lại lịch sử**; mất file này viết lại lịch sử **mà không ai đổi công
thức cả**.

**Nếu không quyết định:** giữ nguyên. Một `oee-settings.json` hỏng cú pháp — file
JSON, không schema, cùng loại với `fleet-settings.json` ở mục 1 — sẽ bị thay bởi
lần đặt OEE kế tiếp, và **không ai biết cho tới khi có người đối chiếu báo cáo OEE
với thứ họ nhớ đã cấu hình**.

**Vì sao là quyết định của chủ sở hữu chứ không phải một cái chốt:** sửa nó là
**đổi hợp đồng khởi tạo của store**, và có **ba** cách sửa cho ba kết quả khác nhau
— cho nó ném như `MachineConfigStore`/`ProductConfigStore`, cho nó biểu đạt trạng
thái thứ ba như hai store Q-1 đã sửa, hoặc giữ nguyên và **chỉ báo**. Chúng không
tương đương: cái thứ nhất **dừng một endpoint đang phục vụ**, cái thứ hai đổi kiểu
trả về của một phép đọc, cái thứ ba để nguyên mất mát nhưng làm nó **thấy được**.

🔴 **Và có một sự thật kiểm được ngay tại chỗ khiến việc này không thể để trôi:
store này TỰ MÔ TẢ SAI.** Chú thích ngay trong khối `catch` nói nó *"mirrors
`MachineConfigStore`/`ProductConfigStore`'s 'never throw out of the constructor over
a bad file' stance"* (`OeeSettingsStore.cs`, khối `catch (JsonException)` trong
`Load`). **Đo được: hai store ấy CÓ ném** — cả hai đều nằm ở dòng "Ném" của bảng
trên. Nên lý do duy nhất được ghi ra cho hành vi này **là một khẳng định về hai
store khác, và khẳng định ấy sai.** Không có cách đọc nào khiến nó đúng.

**Bằng chứng — chạy lại được, và ĐỎ được:**
`tests/St4i.EngineApi.Tests/OperatorDataRemovalCensusTests.cs`.
- `EveryOperatorArtifact_HasThePostureRecordedForIt_AtTheOneSituationHeldFixed` ghim
  cả chín tư thế **đã đo**, không phải đã đọc.
- `TheOneStoreThatCannotTellUnreadableFromAbsent_ReplacesTheOperatorsBytes` chạy
  chính tác hại: ghi byte có dấu vào file, gọi `Set` cho một máy khác, đọc lại —
  dấu **biến mất**. **Nó GHIM một khuyết tật đang sống làm đường cơ sở và KHÔNG
  sửa**, vì S-1 bị cấm sửa. Nếu anh quyết SỬA, khẳng định ấy **đảo chiều**, và chỗ
  đảo chính là diff.
- `ThePosturesAtTheFixedSituation_AreNotAllTheSame` khẳng định **câu trả lời**. Ai
  đưa mọi store về một tư thế sẽ làm nó đỏ — đúng như phải thế: mục này lúc đó
  **đóng lại kèm bằng chứng**, và một câu trả lời không được sống lâu hơn cây mã
  nó nói về.

**Bốn đối chứng đã chạy, rồi hoàn nguyên (§8.1(h6)) — và nhãn của chúng đã được sửa
sau phản biện, vì bản đầu gộp hai khẳng định khác nhau làm một:**

| arm | can thiệp | đỏ ở đâu, và nó chứng minh ĐIỀU GÌ |
|---|---|---|
| **C1** | thêm `new FileInfo(p).Delete()` vào `WalMaintenance` | bờ **IL** đỏ, gọi đúng tên phương thức — còn phép liệt kê quét mã vẫn **xanh**. Chứng minh **vốn từ quét mã BÁC BỎ ĐƯỢC**, và đúng lúc nó mù |
| **C2** | `MachineConfigStore.Load` nuốt `JsonException` | **bảng tư thế** đỏ, gọi đúng tên store. Chứng minh **một phân kỳ MỚI bị phát hiện** |
| **C3** | bỏ khối `catch` của `OeeSettingsStore` | ba test đỏ. ⚠️ **KHÔNG phải "phân kỳ biến mất"** — bỏ một store vẫn còn **hai** tư thế, nên khẳng định `số lớp > 1` **vẫn xanh**. Nó đỏ ở **phép so khớp TẬP LỚP đã ghim**. Chứng minh **BẢNG đã công bố không sống lâu hơn cây mã** — mà bảng chính là thứ mục này in ra |
| **C4** | bỏ `catch` ở **cả ba** — `FleetSettingsStore`, `SiteLinkStore`, `OeeSettingsStore` | cả chín store về **một** tư thế. Khẳng định **`số lớp > 1` đỏ**, in đúng câu *"mọi store nay hành xử như nhau… hãy đi đóng mục này, lấy chính lần chạy đó làm bằng chứng"*. Chứng minh **câu trả lời tiêu đề đỏ được** |

C4 được thêm ở vòng sửa vì phản biện chỉ ra bản đầu **gán cho C3 phần chứng minh mà
C3 không làm**. Bốn arm, hai bờ, không arm nào còn lại trong cây.

#### Phần dư KHÔNG đóng được bằng phép đo này — nêu tên chứ không im lặng

1. **`CredentialStore.Load` và `DeviceIdentityStore.TryLoad` có cùng hình dạng
   "không đọc được = không có"**, và cả hai **cố ý** — chúng đứng ngoài bảng trên vì
   nội dung là **byte do sản phẩm sinh**, không phải cấu hình vận hành viên gõ ra, tức
   tiền đề của luật mục 1 không đúng ở đó. `DeviceIdentityStore` đã là **phần dư đã
   ghi** ở cuối mục 1.

   > ⚠️ **Bản đầu của gạch đầu dòng này viết *"`CredentialStore` chưa từng được ghi ở
   > đâu"*. SAI, và phản biện bác bỏ bằng chính mã mà nó trích.** Hình dạng ấy **đã
   > được ghi**, ở hai chỗ: doc comment của chính `CredentialStore.Load` (nêu đích
   > danh ca *"mã hoá dưới scope/entropy DPAPI khác — ví dụ một `.bin` thời tiền-FF-2
   > mã hoá theo `CurrentUser` — hoặc copy từ máy khác"*), và
   > `src/St4i.EngineApi/Alarms/NotificationSecretProtector.cs`, nơi gọi tên idiom và
   > nói *"`CredentialStore.Load` và `DeviceIdentityStore.TryLoad` đều theo"* nó.
   > Đây đúng nhánh **bác bỏ** của luật câu chữ: tôi dựng một phủ định phổ quát bằng
   > cách **không tìm thấy**, chứ không bằng phép kiểm đếm có thể bác bỏ nó.
   >
   > **Cái CHƯA từng được ghi ở đâu là HẬU QUẢ.** Doc comment ấy trình bày `null`
   > như một kết quả **lành** — *"để đường credential-rỗng bình thường của caller chạy
   > thay vì một lần sập không bắt được"* — và **không chỗ nào nói rằng** đường
   > "claim lại" sau đó **`Save` đè lên** một blob mà **chỉ cần sửa môi trường là đọc
   > lại được**. Nên **một lỗi môi trường KHÔI PHỤC ĐƯỢC bị biến thành mất mát không
   > hoàn nguyên**, và chính câu đó là thứ cần ghi. Phát hiện còn nguyên; vị ngữ của
   > nó thì không.
   >
   > 🔴 **V-1, 2026-08-17 — cả hai nay ĐO ĐƯỢC, và `CredentialStore` rời gạch đầu dòng
   > này thành MỤC 10.** `DeviceIdentityStore` giữ nguyên quyết định và giữ nguyên chỗ
   > (phần dư 2 của mục 1), nhưng nó nay là một **hàng trong bảng đã ghim** thay vì một
   > lời khai báo — nên ngoại lệ không thể lặng lẽ trở thành luật, và nếu ai đó sửa nó
   > thì phép ghim đỏ lên và bắt sửa quyết định. Lý do `CredentialStore` phải đo **riêng**
   > là **cơ học chứ không phải một phán đoán**: `Load` là `static` và giải
   > `ST4I_CREDS_DIR` toàn tiến trình ở mỗi lời gọi, không có tham số thư mục, nên nó
   > không vào được một bảng song song mà mọi thành viên khác nhận thư mục tường minh.
   > Lý do S-1 nêu (xuất xứ của byte) là một lý do KHÁC, và nó cãi được: một trong các
   > chỗ gọi `CredentialStore.Save` là vận hành viên **dán** một khoá `mk_`.
2. **Tư thế "ném" chưa được đo ở chỗ nó tiếp đất.** Phép đo dừng ở **store**. Việc
   một `SqliteException` từ `ConnectorConfigStore` có kết thúc tiến trình, hay bị
   bắt ở đâu đó rồi tiếp tục bằng một store rỗng, là câu hỏi của composition root
   và **không có arm nào ở đây khởi động `St4i.EngineApi`** — đúng cùng trần mà
   `docs/startup-failure-posture.md` §2 tuyên bố cho instrument 2 của nó.
3. **Bốn trong tám project đứng ngoài bờ IL** (`St4i.EdgeService`,
   `St4i.Connector.Conformance`, `St4iMachineSimulator`, `St4i.DesktopShell` — không
   test project nào tham chiếu hai host WPF). Ở đó **vốn từ quét mã chưa bị bác bỏ
   bởi bất cứ thứ gì**, và **kích thước lỗ hổng ấy nay đã đo**: quét mã có **9** hình
   dạng, bảng phân loại có **37** thành viên có khả năng xoá, trong đó **21** thành
   viên **không có một hình dạng quét mã nào**. Trong bờ IL cả 21 đều bị bắt đỏ; ngoài
   bờ IL chúng im lặng.

   > ⚠️ **Cái chặn thiệt hại đã được viết hẹp lại.** Bản đầu viết *"không store bền
   > vững nào nằm trong bốn project đó"* — đúng, nhưng đó là một **phủ định phổ quát
   > không có phép kiểm nào bác bỏ được**, đúng loài file này lập ra để chấm dứt. Cái
   > **đo được**: phép liệt kê ghim **bốn** file trong các project ấy **CÓ** phá byte
   > (`App.xaml.cs`, `FleetService.cs`, `InspectorViewModel.cs`,
   > `MainWindow.xaml.cs`), và một trong số đó — `InspectorViewModel` ghi đè lên
   > **đường dẫn xuất do vận hành viên tự chọn** — **có thể đè file của vận hành
   > viên**. Câu đúng và hẹp: **không project nào trong bốn cái đó sở hữu một artefact
   > mà sản phẩm này ghi rồi đọc lại**, nên không cái nào vào bảng tư thế.
   >
   > Phản biện đã chạy phép quét mà nhiệm vụ này **không** chạy, và kết quả **có lợi
   > cho phép đo**: quét bốn project ấy bằng một vốn từ **rộng hơn** vốn từ quét mã —
   > `File.Replace`/`Copy`/`WriteAllLines`/`CreateText`/`OpenWrite`, `MoveTo`,
   > `Directory.Move`, `new StreamWriter`, `new FileStream`, `FileMode.*`, xoá trên
   > `FileInfo`/`DirectoryInfo` — và **mọi kết quả đều nằm trong 9 hình dạng sẵn có**.
   > **Hôm nay không có đường xoá file nào lọt ở đó.**
   >
   > 🔴 **Và điều quan trọng nhất về lỗ hổng này: nó không chạm tới câu trả lời.** Câu
   > trả lời ("ba tư thế, `OeeSettingsStore` là cái phân kỳ") đứng trên **bờ THI
   > HÀNH**, thứ không phụ thuộc chút nào vào tính đầy đủ của hai bờ kia. Một đường xoá
   > lọt lưới sẽ làm **phép liệt kê dài ra**; nó **không thể làm các tư thế thôi phân
   > kỳ**.
   >
   > ⚠️ **Câu trên trích một câu trả lời nay đã cũ — sửa 2026-08-17 (V-1).** Lập luận
   > vẫn đứng và nó là lý do câu này được giữ: một đường xoá lọt lưới làm phép liệt kê
   > dài ra chứ không làm bờ THI HÀNH sai. Cái đổi là **kết quả** bờ ấy trả về, nay
   > không còn ba tư thế và `OeeSettingsStore` không còn là cái phân kỳ. Xem
   > `docs/startup-failure-posture.md` §3.6.
4. **SQL không bị bác bỏ ở đâu cả** — bờ IL không nhìn thấy một chuỗi. Bảy file có
   câu lệnh SQL xoá/thay hàng đã được liệt kê và ghim, nhưng không gì ở đây chứng
   minh không có câu lệnh nào được ráp lúc chạy từ những mảnh mà không mẫu nào khớp.
5. **Xoá bởi thứ không phải mã này** nằm ngoài toàn bộ: `packaging/remove-data.ps1`,
   trình cài đặt, sidecar `-wal`/`-shm` của SQLite, key ring của DataProtection, và
   SDK vendored dưới `examples/` — thứ **thật sự ghi** các file WAL `.jsonl`.

> ### 🔨 PHÁN QUYẾT 2026-08-17 — GOM VỀ **MỘT LUẬT**, KHÔNG PHẢI VỀ MỘT TƯ THẾ
> Quyết bởi chủ sở hữu, ba chữ: *gom về một cách*. **"Một cách" hoá ra là một LUẬT, và
> luật ấy không phải thứ mới** — nó là phép thử §1 của `docs/startup-failure-posture.md`
> hỏi sớm hơn một câu lệnh:
>
> > **Một phép đọc phải phân biệt được *ở đây không có gì* với *ở đây có thứ tôi không
> > dùng được*. Chỉ cái thứ nhất cho phép người gọi tự đặt ra một giá trị rồi lưu nó.**
>
> **Suy ra như sau, và nó KHÔNG phải một luật thứ hai.** §1 chỉ có hai kết cục, cả hai
> đều **to tiếng**: **S** (tiến trình kết thúc) và **U** (host lên **và báo**). Một phép
> đọc trả cùng một giá trị cho hai ca ấy không tới được cái nào: không ném nên không
> phải **S**; không phân biệt nên không có gì để báo nên không phải **U**. Nó tới cái
> thứ ba — host lên và im lặng — tức đúng định nghĩa của thứ §1 lập ra để cấm.
>
> **Nên luật này suy ra tư thế KHÁC NHAU ở các store khác nhau, và đó vẫn là một cách.**
> Store nào **ném** thì người gọi nhận **S**; store nào có kết quả thứ ba thì người gọi
> lên được và báo, tức **U**. Chỗ nào là chỗ nào vẫn do đúng phép thử §1 quyết, không
> đổi. Thứ bị bỏ đi là **cái thứ ba, vốn không phải một tư thế mà là sự vắng mặt của
> một tư thế**.
>
> ### ✅ ĐÃ THI HÀNH — nhiệm vụ V-1 (`.superpowers/sdd/one-unreadable-posture/`)
> **Một store đổi:** `OeeSettingsStore` nay có đúng phép đọc ba kết quả của Q-1
> (`Loaded`/`Absent`/`Unreadable`, **không có phép kiểm tồn tại**, phép mở chính là phép
> phân loại); `Set` — mutator duy nhất, một chỗ gọi sản phẩm duy nhất — **TỪ CHỐI** khi
> file không đọc được, nêu tên file và nói rõ file **không bị ghi đè**;
> `PUT /v1/historian/oee/settings` trả **409** mang đúng câu ấy; và store báo **một lần**
> ở mức `Error` qua callback `Program.cs` nối vào. Hình dạng phản hồi `GET` **không đổi**
> — nới một DTO đã xuất bản là loại thay đổi anh giữ lại cho mình ở mục 3 và 4, đúng
> ranh giới Q-1 đã vạch ở `GET /v1/settings`.
>
> **Phép liệt kê lại, và "chín" là một cận dưới đúng như brief đoán — nhưng lý do thì
> khác.** Bảng của S-1 không có **luật thành viên** nào, nên không gì bác được nó. Luật
> được phát biểu ra: *một store vào bảng khi nó sở hữu một artefact mà sản phẩm này GHI
> rồi ĐỌC LẠI*. Áp luật ấy vào hai phép liệt kê máy móc có sẵn thì bảng dài thêm **năm**
> store mà S-1 chưa đo (`AlarmStore`, `AssetRegistryStore`, `BridgeSpool`,
> `SqliteHistorianStore`, `DeviceIdentityStore`), cộng `CredentialStore` đo riêng. Bốn
> trong năm **ném** — tức tuân thủ, và đó là thông tin bảng đã xuất bản không mang.
> Danh sách đầy đủ kèm lý do từng store: `docs/startup-failure-posture.md` §3.6.
>
> **Cặp đối chứng đã chạy hai phía:** cùng một file hỏng dựng bằng tay — ở `f18f5c29`
> `Set` **thành công** và các byte của vận hành viên bị thay bằng một entry; sau bản sửa
> `Set` ném, file **còn nguyên từng byte**, và trong thư mục không có gì khác.
>
> #### 🔴 Vòng sửa lỗi 1 — PHÉP TỪ CHỐI ĐƯỢC QUYẾT LÚC GHI, KHÔNG PHẢI LÚC DỰNG; VÀ MỘT HỆ QUẢ VẬN HÀNH VIÊN THẤY ĐƯỢC
> Vòng đầu chốt `Set` trên một phân loại **do hàm dựng lưu lại**, nên thứ xuất xưởng là
> *"file không đọc được **lúc store được dựng**"* chứ không phải *"…lúc này"*. Một host
> đang chạy trên file tốt, vận hành viên sửa tay file ấy thành JSON hỏng — **đúng việc mà
> chính lời từ chối bảo họ đi làm** — rồi một `PUT` tới sau đó: vẫn ghi đè **im lặng**.
> `Set` nay **tự đọc lại** ngay trước khi ghi, trong cùng một khoá.
>
> **Điều vận hành viên phải biết, vì nó thấy được:** nếu file **không đọc được lúc nạp**
> và sau đó **được sửa lành**, `PUT` vẫn bị **TỪ CHỐI** cho tới khi host **khởi động
> lại**. Đó là cố ý và là nửa chịu tải của bản sửa — bảng trong bộ nhớ lúc ấy **rỗng**,
> nên ghi nó xuống sẽ **xoá đúng bản vừa sửa**. Lời từ chối nói thẳng điều đó và nói
> cách thoát. Nếu file bị **dời đi** thay vì được sửa, thông điệp nói đúng ca ấy chứ
> không nói *"file đọc lại được rồi"* (vòng sửa 1, review N-2).
>
> **Cặp đối chứng vòng sửa 1, chạy hai phía trên `5dbe09a6`:** file hỏng **SAU** khi
> store được dựng — ở base `Set` **thành công** và các byte bị thay; sau bản sửa `Set`
> ném và các byte **còn nguyên**. Nguồn và cả hai transcript được **giữ lại**.
>
> 🔴 **Còn một kiểu lệch thứ BA chưa đóng, và nó thành mục 11:** bảng dựng từ `Absent`
> + file **có nội dung xuất hiện sau đó** ⇒ vẫn ghi đè. Không cần tranh chấp; kịch bản
> là **khôi phục một bản sao lưu trên host đang chạy**. Xem §11.
>
> **Hai phát hiện còn lại của S-1, quyết TỪNG CÁI:**
> - `ProductConfigStore.Load` ghi lại `products.json` khi chỉ thiếu `recipes.json` —
>   🔨 **SỬA**, hẹp: chỉ ghi file nào thật sự được gieo mầm. Đo được: một `products.json`
>   viết tay bị ghi lại, mất định dạng và mất mọi trường `ProductModel` không khai báo,
>   trên một lần khởi động **không có gì hỏng và không ai yêu cầu đổi**. Các mutator vẫn
>   ghi cả hai — ở đó người gọi đã yêu cầu đổi.
> - `ConnectorConfigStore` migration v4 chạy `DROP TABLE connector_configs` viết cứng —
>   ✅ **KHÔNG ĐỔI**, và lý do là một **assertion** chứ không phải một phép đọc: nó là
>   nấc 4 của thang `PRAGMA user_version`, chạy trong **cùng một transaction** với cả
>   thang, theo đúng thứ tự tạo/chép/xoá/đổi-tên mà tài liệu SQLite quy định để đổi
>   PRIMARY KEY, và `SELECT` liệt kê từng cột. Việc các hàng sống sót được ghim bởi
>   `ConnectorConfigStoreTests.MigrationV4_AGenuineVersion3Database_KeepsEveryRow_EveryField_AndGivesEachOneItsKindAsItsInstanceId`,
>   thứ dựng một database v3 **thật** bằng SQL thô.
>
> **Một khẳng định của chính S-1 bị V-1 bác.** Assertion tiêu đề của S-1 là
> `classes.Count > 1` — *các tư thế phân kỳ* — kèm câu "ai đưa mọi store về một tư thế
> sẽ làm nó đỏ, và lúc đó mục này đóng". **Đó là cái chốt sai cho câu trả lời:** dưới
> luật trên, một cây mà **mọi** store đều ném là **tuân thủ hoàn toàn** và chốt ấy sẽ
> **đỏ**; một cây còn một store im lặng gộp hai ca là **vi phạm** và chốt ấy **xanh**.
> Nó được thay bằng `NoStoreAnswersAbsentForAnArtifactThatIsPresent_ExceptTheOnesNamedAndDecided`,
> đỏ theo **cả hai chiều**: một store rơi vào tư thế bị cấm, **và** một ngoại lệ đã được
> nêu tên rời khỏi nó trong khi quyết định miễn trừ nó vẫn còn đứng.
>
> **Phần dư CHUYỂN CHỖ chứ không biến mất:** `CredentialStore` thành **mục 10** của file
> này (nó là một quyết định, và một quyết định không được sống trong một báo cáo);
> `DeviceIdentityStore` vẫn ở phần dư 2 của mục 1 — **không đổi**, nhưng nay **đo được**
> trong bảng đã ghim thay vì chỉ được khai báo.

### 6. Log hoãn lại của một lần cài đặt THẤT BẠI (J-2, phần dư 3)
**Cơ chế, nguyên văn từ `99ab7b61`:** *"Nó chỉ còn đứng trên tính không tách rời:
các dòng halt được phát ra bởi mã **bắt buộc phải chạy** thì một lần halt mới xảy ra,
trong khi việc phát `deferredLogs` là **một lựa chọn đứng riêng**."*

Đã bị từ chối sửa **ba lần**. Hai cơ sở trước đó **do chính người thực thi rút lại
chứ không bảo vệ** — trong đó có một cơ sở họ thừa nhận là **làm yếu chính lập
trường của mình**.

**Nếu không quyết định:** khi cài đặt thất bại, những gì đã xảy ra trước đó
**không được kể lại**, và người vận hành chỉ thấy lần thất bại.

> ### 🔨 PHÁN QUYẾT 2026-08-17 — PHÁT RA TRÊN ĐƯỜNG NÉM LỖI; HAI ĐƯỜNG ANH EM GIỮ IM LẶNG
> Quyết bởi chủ sở hữu, trả lời sự leo thang. **Cơ sở "không tách rời được" KHÔNG bị
> bác** — nó đúng, và nó là lý do ba dòng log của bản sửa HALT không phải câu hỏi này.
> Cái bị bác là **lập luận ĐỐI XỨNG** đã giữ mục này ba vòng: rằng ba đường
> không-cài-đặt-được phải được đối xử như nhau vì hai đường kia đã chọn im lặng.
>
> **Tiền đề ấy bị chính `FleetCore.cs` bác ở chỗ khác**, trong chú thích viết ra để
> phân biệt hai câu hỏi (`StopLocked`): câu *"nói thay cho một lần khởi động chưa cài
> gì, mà lựa chọn thay thế là im lặng về việc KHÔNG CÓ GÌ xảy ra"* **đúng với hai
> đường anh em** và **sai với đường thứ ba** — trên đường ném lỗi resolver đã chạy và
> đã fallback, một connector đã bị từ chối, và **các slot CÓ THỂ ĐÃ ĐƯỢC CÀI**. Ba
> đường không cùng loại thì không có đối xứng để mà giữ.
>
> **Luật:** im lặng về **cái không xảy ra** là đúng; im lặng về **cái đã xảy ra** thì
> không.
>
> ### ✅ ĐÃ THI HÀNH — nhiệm vụ T-1 (`.superpowers/sdd/deferred-logs-emitted/`)
> **Cách sửa: `deferredLogs` thành danh sách của NGƯỜI GỌI**, đúng phép biến đổi J-2 đã
> làm cho `orphanedConnectorDrivers`, tại chính hai chỗ gọi ấy (`Start`,
> `RebuildPipelineOffLock`). `StartLocked` chỉ đổ vào; `finally` của người gọi phát ra
> dù lời gọi trả về hay ném. `StartLocked` do đó **trả `void`** — cả hai nửa đã là của
> người gọi nên giá trị trả về không còn ai đọc; đó đúng là việc-tiếp-theo mà review
> I-3 đã nêu tên.
>
> **Phát ra cái gì, ở mức nào, và ai chọn mức ấy.** Mỗi dòng giữ nguyên kênh mà **chỗ
> sinh ra nó** đã chọn — cảnh báo fallback mapping-profile và dòng từ chối connector là
> `Warning`, một mapping file đọc không được là `Error` — và đi qua đúng bộ định tuyến
> (`FlushDeferredLogs`) mà một lần khởi động **THÀNH CÔNG** đang dùng cho cùng những
> dòng ấy. **T-1 không chọn mức nào**: đường ném lỗi nay **giống hệt** đường thành công
> về phần việc đã thực sự chạy, nên không có câu nào được nói ra mà một lần khởi động
> thành công không nói.
>
> **Hai đường anh em vẫn im lặng, và điều đó được ghim chứ không được khẳng định:**
> chốt HALT trong `StartLocked` (`AnInstallRefusedByTheHaltLatch_StillSaysNothing`) và
> `Start` bỏ dở vì `_stopRequests` (`AStartAbandonedByAConcurrentStopRequest_StillSaysNothing`).
> Cơ chế giữ im lặng là một **thứ tự câu lệnh**: các dòng của plan chỉ nhập vào danh
> sách người gọi **sau** chốt.
>
> **Hình chiếu đã xác minh lại (§8.1(h5.1)), không thừa kế:**
> `_connectorStartIssues` vẫn sống sót qua cú ném và `GET /v1/connectors` vẫn báo —
> `AFailedInstallsRejectedConnector_IsStillReportedByTheProjectionThatOutlivesTheLine`,
> xanh ở **cả hai** phía diff vì nó đo một tính chất T-1 không đụng tới. **Nửa thật sự
> bị mất là cảnh báo mapping-profile**, và điều đó kiểm được chứ không phải "tìm không
> thấy": phép giải một descriptor của `MappingProfileResolver` trả về một profile và
> gọi một trong hai callback, **không ghi gì khác ở đâu cả**.
>
> **Cặp đối chứng đã chạy hai phía:** cùng một test dựng một lần cài đặt hỏng thật
> (một máy có `mappingProfile` không tồn tại + một connector bị từ chối + một slot ném
> lỗi) — ở `7bb0c5bd` cảnh báo mapping **không tới được host logger** (đếm được 0), sau
> bản sửa đếm được đúng 1, và ngoại lệ nói vì sao cài đặt hỏng **vẫn tới người gọi**.
>
> #### 🔴 Vòng sửa lỗi 1 — MỘT CỬA SỔ CHE LẤP DO CHÍNH T-1 TẠO RA, VÀ LỜI BIỆN MINH ĐẦU SAI
> Vòng đầu ghi cửa sổ này ra rồi **chấp nhận** nó: cú flush nay chạy có nội dung trên
> đường ném lỗi, nên một host mà `ILogger` của nó ném sẽ **thay thế** ngoại lệ nói vì
> sao khởi động hỏng. Lời biện minh khi ấy là *"nó không mới — trước G-1 những dòng này
> được phát tại chỗ trong `StartLocked`, trước vòng lặp slot"*. **Phép đo ấy ĐÚNG và nó
> chứng minh một điều KHÁC:** trước G-1 logger ném **TRƯỚC** chỗ ném lỗi, nên lần cài
> đặt **không bao giờ tới được vòng lặp slot** — **không có chẩn đoán nào để mà mất**.
>
> **PHƠI BÀY thì được khôi phục. CHE LẤP thì là do T-1 phát minh ra.** *"Một logger hỏng
> có thể là ngoại lệ duy nhất người gọi thấy"* là cũ; *"một logger hỏng có thể **PHÁ HUỶ
> một chẩn đoán đã tồn tại**"* **không** với tới được trước G-1 (không có gì để phá) và
> **không** với tới được ở base (cú flush duyệt qua rỗng). **Đo được, không phải lập
> luận:** với mã nguồn vòng 1 (`9209a81b`), người gọi nhận `InvalidOperationException`
> ("this host's log provider failed") ở chỗ lần cài đặt đã ném `ArgumentNullException`.
>
> **Đã ĐÓNG, không phải nêu tên.** Một nhiệm vụ có mục đích *"một lần cài đặt hỏng không
> được im lặng"* thì không được xuất xưởng một *"logger hỏng làm im lặng chính lần
> hỏng"*. Chốt là một **bộ lọc ngoại lệ** `installFaulted` bao quanh **CHỈ cú flush**
> bên trong `CompleteStartOffLock`, được đặt từ **đúng một** `catch` ở mỗi chỗ gọi. Vòng
> 1 đã định giá nó ở **cực SAI** (một cờ HOÀN TẤT phải đặt đúng ở mọi lối ra); ở **cực
> LỖI** nó **đúng theo mặc định** — một `return` thêm về sau không đụng tới nó, chỉ một
> ngoại lệ mới làm nó true. **Cố ý KHÔNG mở rộng:** cửa sổ bốn điều kiện của J-2 nằm ở
> khâu **giải phóng driver** và được giữ **nguyên như J-2 đã để**; bao rộng hơn là đóng
> hộ một đánh đổi của nhiệm vụ khác. Đường **thành công không đổi**, và điều đó được
> ghim bởi một test đã có sẵn (`Start_WhenTheHostLoggerThrowsFlushingDeferredLines_…`,
> một lần khởi động THÀNH CÔNG vẫn phải ném ra ngoài).
>
> **Bằng chứng nằm trong repo, không nằm trong ledger:** commit `9209a81b` (vòng 1) và
> commit vòng sửa lỗi 1 trên nhánh `feat/deferred-logs-on-failed-install`. Đường dẫn
> `.superpowers/sdd/` ở trên là **xuất xứ**, không phải chỗ đi lấy sự thật — thư mục ấy
> **bị gitignore**, đúng lỗi mà `FleetCore.cs` đã ghi nhận một lần (branch review
> Minor 13).

### 7. Nửa sau của S4 (J-2)
**Cơ chế, nguyên văn từ `99ab7b61`:** đóng nó đòi **dựng đường ống mới trước khi
tháo đường ống cũ**, việc này **đảo thứ tự khởi động lại mà vận hành viên quan sát
được**; và **quay lui bản commit đổi nghĩa của một lời gọi thất bại đối với người gọi
nó**. Cả hai đã được suy lại trên cơ chế của chúng.

🔴 Và một câu đáng giữ nguyên văn: **"dựng trước khi tháo" là ĐIỀU KIỆN CẦN và
KHÔNG ĐỦ — bản thân việc cài đặt cũng có thể ném lỗi.**

**Nếu không quyết định:** thứ tự vẫn như cũ, và một lần khởi động lại thất bại vẫn
để hệ thống ở trạng thái giữa chừng mà không có cơ chế lùi.

> ### 🔨 PHÁN QUYẾT 2026-08-17 — FLEET DỪNG, COMMIT ĐỨNG NGUYÊN, VÀ LẦN HỎNG ĐƯỢC GHI LÊN `GET /v1/health`
> Quyết bởi chủ sở hữu. **Không phải phương án nào trong hai phương án J-2 nêu tên.**
>
> **Câu hỏi đã bị đặt sai, và chỗ sai là chỗ đáng giữ.** Brief nói *"thứ fleet LÀ và
> thứ hồ sơ NÓI không khớp nhau"*. Đo lại từng bề mặt: `IsRunning` báo **dừng** —
> đúng; `GetDriverHealth` liệt kê **đúng những slot mà lần cài đặt để lại** (không slot
> nào khi cú ném nằm trong lần DỰNG; phần đã cài khi nó nằm trong lần CÀI ĐẶT — phần dư
> (2) của S3) — đúng; `Fleet` có máy vừa đăng ký — đúng;
> `CurrentScenario` mang cấu hình vừa commit — đúng, vì đó là **cấu hình**, thứ mà một
> fleet đang dừng có quyền giữ cho lần khởi động sau. **Từng trường một đều nói thật.**
> Thứ nói dối là **bề mặt TÓM TẮT chúng**: `GET /v1/health` đúng nghĩa đen là
> `LastError is null`, nên nó trả lời **HEALTHY** cho một fleet mà một lần khởi động
> lại nội bộ đã tháo xuống và không dựng lại được. Đó là đúng câu `FleetCore.cs` đã tự
> viết ra cho một ca khác, tại `StartSlot`.
>
> > 🔴 **ĐÍNH CHÍNH U-1 vòng sửa 1 — câu trên TỪNG kết thúc bằng *"— **vĩnh viễn**, vì
> > không gì khác ghi trường ấy"*, và đó là một KHẲNG ĐỊNH PHỔ QUÁT bị chính đoạn văn
> > của nó bác sáu dòng phía trên.** Trên nhánh **cú ném nằm trong lần DỰNG**
> > (`BuildStartPlan`) nó **đúng**: `StopLocked` đã dọn sạch `_slots`, không còn slot
> > nào để mà hỏng, nên trước U-1 không gì ghi `LastError` cho tới khi một lần khởi động
> > **thành công** xảy ra. Trên nhánh **cú ném nằm trong lần CÀI ĐẶT** thì **SAI**:
> > `StartSlot` chạy `_slots.Add(slot)` **TRƯỚC** `Task.Run`, nên các slot đã cài là
> > thành viên sống; một slot trong số đó hỏng sau này sẽ thấy
> > `removed = _slots.Remove(slot) == true` và **ghi `LastError`**. Trạng thái ấy có
> > **một** lần tự báo — muộn, và **không phải cái đúng**.
> >
> > **Lần tự báo ấy phụ thuộc ba điều kiện**, nên "không vĩnh viễn" cũng không được nói
> > như một sự bảo đảm: phải có một slot bị mắc kẹt **thật sự hỏng** (J-2 đã ghi: slot
> > nào cư xử tử tế thì mắc kẹt suốt đời tiến trình); phải **chưa** có `Stop`/`Estop`
> > nào dọn `_slots` (sau J-2 thì `removed == false`, và ghi chú tại `StopLocked` nói
> > đúng điều đó); và exception ghi được là **của slot**, không phải của lần khởi động
> > lại — nên ngay cả khi nó tới, nó **gọi tên sai thứ đã hỏng**.
> >
> > **U-1 đổi gì trên nhánh ấy:** báo cáo thành **tức thì** và mang **chính exception
> > của lần cài đặt**, thay cho một lần tự báo muộn, có điều kiện, và gọi sai tên.
> > Phán quyết **không đổi** — chỉ riêng nhánh DỰNG đã đủ mang nó.
> >
> > Đây là đúng loài mà `08fd75cb` vừa sửa ở bốn chỗ (*"GetDriverHealth không liệt kê
> > gì"*): **tôi sửa tiền đề rồi để nguyên kết luận dựa trên nó**, trong đúng cái
> > artefact mà chủ sở hữu mở ra đọc.
>
> **Cơ chế:** một lần ghi `LastError = ex` trong `catch` của `RebuildPipelineOffLock` —
> **chốt duy nhất mà cả ba đường vào đều đi qua**. `ex` là **object mà method này ném
> lại**, nên trên hai đường có người gọi thì HTTP 500 và bề mặt health mang **cùng một
> instance** và không thể nói khác nhau về chuyện gì đã hỏng. 🔴 **KHÔNG phải một khẳng
> định về thứ người gọi CUỐI CÙNG nhìn thấy** — hai cửa sổ che lấp mà chính file này đã
> nêu tên vẫn có thể thay nó trên đường ra: cửa sổ bốn điều kiện của J-2 tại
> `DisposeOrphanedConnectorDrivers`, và `finally` drain ngoài cùng của `RegisterMachine`.
> (Bản đầu của đoạn này viết *"cùng một object người gọi nhận được"* — U-1 đã sửa câu ấy
> trong `FleetCore.cs` ở `08fd75cb` và **để nguyên bản sao ở đây**, tức đúng lỗi
> "rút lại ở một trong hai chỗ, khẳng định như cả hai" mà file kia đã ghi nhận hai lần.)
> Cái U-1 thật sự mua: `ex` **sống sót trên một TRƯỜNG** kể cả khi một `finally` về sau
> thay nó cho người gọi. Trên đường thứ ba (revert của `Burst`, Task không ai quan sát)
> đó là **chỗ duy nhất** exception ấy đậu lại.
>
> **Vì sao KHÔNG "dựng trước khi tháo":** J-2 đã đo là **CẦN và KHÔNG ĐỦ**, và chứng
> minh tính đủ đòi một lần cài đặt **khôi phục được đường ống nó thay thế** — mà các
> slot cũ đã bị cancel và dispose xong từ trước. Lấy nó một mình là mua một thay đổi
> thứ tự **quan sát được** để đổi lấy một bản sửa một nửa.
>
> **Vì sao KHÔNG quay lui commit:** hai cơ chế của J-2 vẫn đứng, và một cơ chế thứ ba
> quyết định: **quay lui KHÔNG mang đường ống trở lại.** Dù quay lui hoàn hảo, fleet
> vẫn dừng — nên quay lui mua được sự khớp nhau giữa một fleet đang dừng và cấu hình
> của nó, mà **để nguyên đúng thứ vận hành viên phải hành động**. Nó cũng không phải
> một câu lệnh: riêng `ApplyScenario` còn phải tháo cú swap transport của
> `ApplyNetworkOutageLocked`, và ghi chú năm-khoá trong `FleetCore.cs` nói rằng đường
> ấy tới `TransportCoordinator.ApplyMode` → `ModeChanged?.Invoke` — **một sự kiện do
> host đăng ký**, nằm im **chỉ vì** chỗ gọi duy nhất hiện có truyền đúng mode hiện tại.
> Quay lui là thêm **chỗ gọi thứ hai** vào một seam mà tính an toàn của nó là thuộc
> tính của chỗ gọi thứ nhất, và thêm trên đường hỏng.
>
> ⚠️ Bản đầu của đoạn này gọi đó là *"một chỗ ném lỗi thứ hai"*. **Hôm nay ở đó không
> gì ném cả** — sửa lại thành đúng thứ nó là (một seam), vì luật của chính banner ấy là
> "vô hại nhờ một thuộc tính của chỗ gọi hiện tại" phải được **nói thẳng**, không được
> dựa vào mà cũng không được thổi lên.
>
> **CÁI GIÁ, nói thẳng vì nó là sản phẩm giao ra chứ không phải tác dụng phụ:** vòng
> lặp connector trong `StartLocked` từng **dành riêng** trường này cho *"một slot đã
> khởi động rồi mới hỏng lúc chạy"*. Câu ấy nay sai và đã được sửa **tại chỗ nó được
> viết**, không chỉ ở chỗ mới. `GET /v1/health` nay báo **unhealthy** ở một trạng thái
> trước đây nó báo healthy. Danh sách connector hỏng **không đổi** — vẫn chỉ đi qua
> `GET /v1/connectors`, vẫn không bao giờ lật health.
>
> **CÁI KHÔNG ĐÓNG, nêu tên kèm lý do chứ không im lặng.** Hàng **S4** giữ nguyên nhãn
> **PARTLY OPEN** như một dòng của tập S: commit vẫn nợ một đường ống mà nó không nhận
> được, và không `finally` nào khởi động lại được một fleet đã hỏng lúc khởi động. U-1
> đổi thứ **vận hành viên BIẾT ĐƯỢC**, không đổi trạng thái. Ba chỗ còn lệch, kèm lý
> do, nằm ở hàng S4 trong chính banner của `FleetCore.cs`: `_scenario`/
> `_activePresetName` (là cấu hình), `_fleet` (append-only, và hàng asset bền vững đã
> được giao ở `finally` ngoài cùng), và các bản ghi
> `machine-operating-config.json` đã seed trước cú ném (`Ensure` chỉ seed, không bao
> giờ sửa bản ghi có sẵn — đúng thứ lần khởi động sau sẽ ghi).
>
> **Một arm được ghi CÓ CHỦ Ý:** một `Estop` rơi **bên trong** lần dựng, trên một data
> root làm cú ghi ném lỗi, vẫn được ghi. Lần dựng lại **thật sự đã hỏng**, chốt HALT có
> bề mặt riêng (`GetSafetyStatus`/`EstopEngaged`), và im lặng về **thứ ĐÃ xảy ra** là
> đúng thứ mục 6 đã bác. Hai đường từ chối còn lại **RETURN** chứ không ném, nên chúng
> không thể tới `catch` — im lặng ở đó là **cấu trúc**, không phải một điều kiện.
>
> **Cặp đối chứng đã chạy hai phía:** một lần dựng lại **ném thật** —
> `MachineConfigStore.Ensure` từ chối vì lệch `configKind`, tức P5, không dùng seam —
> ở base để fleet dừng với `LastError == null` (health báo **healthy**), sau bản sửa
> `LastError` là **chính object** người gọi nhận. Witness:
> `FleetHostFailedRestartReportsTests`, năm test.
>
> **Bằng chứng nằm trong repo:** thông điệp commit merge của U-1, banner S4 trong
> `src/St4i.EdgeCore/Fleet/FleetCore.cs`, và khối biện minh `EXPECT_ENGINEAPI` trong
> `scripts/verify-suites.sh`.
>
> ### ✅ ĐÃ THI HÀNH — nhiệm vụ U-1, gộp tại `f18f5c29`
> 🔴 **DẤU NÀY DO Z-1 THÊM NGÀY 2026-08-18, KHÔNG PHẢI DO U-1 VIẾT.** Ba điều, và chỉ ba: việc thi
> hành là của **U-1**; nó **gộp tại `f18f5c29`** (đã kiểm bằng `git log` trên chính repo này —
> *"merge: U-1 — item 7, a fleet that could not restart reported healthy, permanently"*); và **dòng
> tiêu đề này là thứ Z-1 thêm**, không phải thứ vốn đã ở đây.
>
> **Vì sao đây không phải viết hộ một hồ sơ mình không thi hành, và Y-1 đã đúng khi từ chối viết một
> hồ sơ.** Cái thiếu ở mục 7 chưa bao giờ là **nội dung** thi hành: toàn bộ nội dung ấy — cơ chế, cái
> giá, cái không đóng, cặp đối chứng, nhân chứng — nằm nguyên trong khối phán quyết phía trên, do
> **chính U-1 viết**. Bảng phán quyết ở đầu file cũng đã mang `đã thi hành, U-1` suốt thời gian ấy.
> Thiếu là **cái dấu**, thứ mà mục 1, 5 và 6 đều có. Z-1 không viết một câu nào về việc U-1 đã làm
> gì; nó thêm một tiêu đề nhất quán và **ghi rõ ai thêm nó**, để không ai đọc dòng này như lời của
> U-1.

---

## 8. `ReapplyCurrentAsync` vẫn ghi đè một `site-link.json` không đọc được

**Mục này sinh ra từ bản sửa của mục 1, và nó là PHẦN DƯ của chính luật mục 1.**
Ghi ở đây chứ không chỉ trong báo cáo, vì đó đúng là thiếu sót mà file này được lập
ra để chấm dứt: một điều "đã được nêu trong một báo cáo" là điều chủ sở hữu **không
có đường nào mở ra đọc**.

**Đo được:** `SiteBridgeManager.ReapplyCurrentAsync()` gọi `ApplyAsync(_current)`,
mà `ApplyAsync` gọi `_store.Save(link)` **vô điều kiện**. Trên nhánh *không đọc
được*, `_current` là bản ghi mặc định `new PersistedSiteLink()` — thứ **tiến trình
tự nghĩ ra**, không đọc từ đĩa. Nên một lần xoay danh tính sẽ **ghi bản ghi mặc định
đè lên các byte không đọc được của vận hành viên**, đúng thứ mục 1 vừa chặn ở đường
khởi động.

**Ở đâu:** `src/St4i.EdgeCore/Site/SiteBridgeManager.cs` (`ReapplyCurrentAsync` →
`ApplyAsync` → `_store.Save`), tới được từ `POST /v1/site/identity/rotate` trong
`src/St4i.EngineApi/Endpoints/SiteEndpoints.cs`.

**Hậu quả vận hành:** host, cổng và chứng chỉ tin cậy đã ghim của Site mất — giống
hệt mục 1 — nhưng chỉ khi có người **xoay danh tính** trong lúc file đang hỏng.

**Vì sao KHÔNG sửa trong Q-1:** nó do vận hành viên **khởi xướng** nhưng không phải
do họ **chọn** (họ chọn xoay khoá, không chọn ba giá trị link), mà đó chính là ranh
giới luật này dựa vào. Đóng nó là đổi **HỢP ĐỒNG** của `ApplyAsync` — *khi nào* thì
lưu — trên một phương thức có **ba** nơi gọi (`PUT /v1/site`, đường khởi động, và
chính nó). Đó là một thay đổi thiết kế, không phải một cái chốt.

**Nếu không quyết định:** hành vi giữ nguyên. Đường khởi động đã an toàn; đường này
thì không, và không có gì báo cho ai biết ngoài các dòng đã ghi tại chỗ.

**Bằng chứng:** commit `76b9e85d` (Q-1 vòng sửa lỗi);
`docs/startup-failure-posture.md` §3.1b.

> ### 🔨 PHÁN QUYẾT 2026-08-18 — CHẶN, CÙNG LUẬT, TẠI CHỖ GỌI THỨ BA
> **Quyết bởi điều phối viên theo uỷ quyền, không phải bởi chủ sở hữu** — và uỷ quyền
> ấy với tới được mục này: ba mục mà uỷ quyền KHÔNG phủ (2, 3, 4) là ba mục đổi thứ mà
> **người ngoài tổ chức này** đang dựa vào, và mục 8 không đổi bề mặt nào ra ngoài.
>
> **Phán quyết:** cú ghi bị **CHẶN**, dưới **cùng cái luật** mục 1 và mục 5 đã đứng trên,
> áp tại **chỗ gọi thứ ba** của `ApplyAsync` — chính là `ReapplyCurrentAsync`, cái thứ ba
> trong ba chỗ gọi mà mục này đã liệt kê ở trên (`PUT /v1/site`, đường khởi động, và
> chính nó).
>
> 🔴 **Không cơ chế, không mã, không thiết kế ở đây.** Mục này ghi **điều đã quyết**, và
> việc chọn *cách* chặn — và trả cái giá mà chính mục này đã nêu tên, rằng đóng nó là đổi
> **HỢP ĐỒNG** của một phương thức có ba nơi gọi — là việc của nhiệm vụ thi hành, không
> phải của lần ghi này.
>
> **Việc còn nợ.** Không dòng thực thi nào đổi vào ngày quyết định. *(Đúng vào ngày quyết
> định — nay đã thi hành; xem ghi chép ngay dưới, Z-1, 2026-08-18. Câu trên giữ nguyên
> văn làm hồ sơ chứ không phải trạng thái đang sống.)*
>
> ### ✅ ĐÃ THI HÀNH — nhiệm vụ Z-1 (2026-08-18), `.superpowers/sdd/one-law-three-sites/`
> **Cơ chế, SUY từ luật chứ không chép từ hai site kia.** Luật nói chỉ *"không có gì ở đây"* mới cho
> người gọi tự lập một giá trị rồi ghi xuống. `ReapplyCurrentAsync` **không lập ra giá trị nào**: nó
> áp lại, nguyên vẹn, đúng cái link nó đang giữ. Nên nó **không bao giờ** cầm giấy phép ghi — không
> phải chỉ trên nhánh *không đọc được*. `ApplyAsync` và `ReapplyCurrentAsync` nay dùng chung một thân
> riêng tư và khác nhau đúng **một điều: có ghi hay không**. Bảo đảm vì thế là **cấu trúc**, không
> phải một phép kiểm: *đường xoay danh tính không thể ghi file này*, và không cần phép đọc, cờ hay
> thứ tự nào để giữ câu ấy đúng.
>
> **Vì sao KHÔNG "từ chối" như ở `OeeSettingsStore`.** Một cú ném ở đây là sai kết cục: lần xoay vẫn
> **phải** re-key cái bridge đang sống, và lời gọi này là thứ duy nhất làm việc ấy. Cùng một luật,
> ba site, ba hình dạng.
>
> **Ba chỗ gọi, nêu tên đủ, vì chính mục này đã đo rằng đóng nó đổi HỢP ĐỒNG cho cả ba:**
> 1. `PUT /v1/site` (`SiteEndpoints.PutSiteAsync`) — **vẫn ghi**: vận hành viên **đưa** ba giá trị
>    ấy, ghi chúng xuống chính là yêu cầu.
> 2. đường khởi động (`Program.cs`) — **vẫn ghi**: link tới từ đĩa, hoặc phép đọc trả `Absent` và lần
>    khởi động đầu được quyền tự lập. Trên nhánh `Unreadable`, composition root **không gọi** nó, từ
>    vòng sửa lỗi của Q-1.
> 3. `ReapplyCurrentAsync` (từ `POST /v1/site/identity/rotate`) — **không còn ghi**.
>
> **CÁI GIÁ, nói thẳng vì nó là sản phẩm giao ra chứ không phải tác dụng phụ:** trên cây lành,
> `Current` là thứ vừa được áp và file đã giữ đúng nó, nên cú ghi bị bỏ là một no-op về nội dung —
> **trừ một ca**: nếu `Save` trong một lần `ApplyAsync` trước đó đã **hỏng** (đã báo *"chỉ sống cho
> lần chạy này và sẽ KHÔNG sống sót một lần khởi động lại"*), thì một lần xoay danh tính **từng thử
> lại** cú ghi ấy và có thể lặng lẽ sửa được nó. Lần thử lại ấy **mất đi**. Nó chưa bao giờ là hợp
> đồng được ghi ở đâu, và một cú ghi không ai yêu cầu chính là loài khuyết tật luật này lập ra để
> đóng — nhưng nó **là** một hành vi bị bản sửa này lấy đi, và nêu tên ở đây thay vì để ai đó phát
> hiện sau. Đường sửa của vận hành viên không đổi và chính dòng log kia đã nói: gửi lại
> `PUT /v1/site`.
>
> **TRẦN của bản sửa này:** nó **không** đụng gì tới việc `PUT /v1/site` vẫn ghi đè một
> `site-link.json` không đọc được. Trên đường ấy vận hành viên **chọn** ba giá trị, nên luật không
> cấm — nhưng cũng **không ai đo** rằng họ biết mình đang ghi đè cái gì. Đó là một câu hỏi khác,
> chưa ai hỏi, và Z-1 không hỏi hộ.
>
> **Hàng 18 của `docs/startup-failure-posture.md` KHÔNG chuyển**, và đó là một phép đo chứ không
> phải một chỗ bỏ sót: thời điểm ghi trên đường khởi động không đổi. Cái được sửa ở hàng ấy là
> chuyện khác và được ghi tại chỗ: `U` là một **liên từ** (lên **và** báo), và trước hôm nay chỉ nửa
> đầu của nó từng được kiểm ở trang ấy.
>
> **CẶP ĐỐI CHỨNG ĐÃ CHẠY HAI PHÍA.** Một file điều khiển duy nhất cho cả ba site,
> `Z1ThreeSiteControl.cs`, **không nêu tên bất cứ thứ gì Z-1 tạo ra** — nên nó **dịch được ở cả hai
> cây** và thật sự đã chạy ở cả hai (mỗi phía **3/3 xanh**). Nó **ghi lại** kết cục và chỉ khẳng định
> **tiền đề**, nên phía base là một **phép đo** chứ không phải một transcript hỏng. Kịch bản: file
> không đọc được trên đĩa, manager lên mà chưa nạp gì, `Rotate()` rồi `ReapplyCurrentAsync()`.
> * base `f7c9216e`: `operator bytes intact=False | file is now the default record=True` — trên đĩa
>   còn đúng `{ "Enabled": false, "Host": "", "Port": 8883, ... }`.
> * HEAD `587553fc`: `operator bytes intact=True | file is now the default record=False` — nguyên từng
>   byte, một file trong thư mục, không có file tạm nào bên cạnh.
>
> Nguồn và hai file kết quả giữ ở `.superpowers/sdd/one-law-three-sites/evidence/`.

---

## 9. Một nhánh *không đọc được* nên áp **sàn môi trường** vào bộ nhớ hay không

**Đo được:** sau Q-1, khi `fleet-settings.json` không đọc được, tiến trình lên bằng
**mặc định dựng sẵn** của `FleetHost` (`DefaultServerUrl = ""`,
`DefaultMachineCode = "ENGINE-API-01"`) chứ **không** áp bộ ba `ST4I_*` mà bản triển
khai đã đặt.

**Hai chiều, và phải nói cả hai:** với **FILE**, từ chối sàn là **an toàn hơn hẳn**
— áp sàn nghĩa là `FleetCore.UpdateSettings` **lưu** nó, và chính việc lưu là mất
dữ liệu. Với **CỖ MÁY ĐANG CHẠY**, nó có thể **tệ hơn**: một bản cài headless không
những mất liên kết mà còn không dùng các giá trị dịch vụ của nó đã cấu hình.

**Vì sao hai chiều ấy tách nhau được:** chỉ vì `UpdateSettings` **lưu vô điều
kiện**. Một đường "áp mà không lưu" sẽ cho nhánh này tôn trọng sàn trong bộ nhớ mà
vẫn để yên file.

**Ở đâu:** `src/St4i.EdgeCore/Fleet/FleetCore.cs` (`UpdateSettings`, khối `finally`
trong `if (rebuildNeeded)`), tiêu thụ bởi `src/St4i.EngineApi/Program.cs`.

**Nếu không quyết định:** giữ nguyên — an toàn cho file, và một cỗ máy headless có
file hỏng sẽ chạy trên giá trị mặc định cho tới khi có người sửa file.

**Vì sao là quyết định của chủ sở hữu:** đổi *khi nào* `UpdateSettings` lưu là đổi
hợp đồng mà `PUT /v1/settings` cũng dùng chung.

**Bằng chứng:** `docs/startup-failure-posture.md` §3.1a-now.

> ### ⏸️ HOÃN 2026-08-18 — CHỦ SỞ HỮU ĐỂ MỤC NÀY LẠI SAU CÙNG
> **Đây KHÔNG phải một phán quyết, và mục này KHÔNG rời khỏi phần đang chờ.** Chủ sở hữu
> trả lời *"để lại sau cùng"*. Luật của file này nói một mục chỉ rời khỏi đây khi có một
> **quyết định** ghi kèm ngày và người quyết; một lần hoãn ghi **thứ tự**, không ghi
> **kết quả**. Nên mục 9 vẫn ở `🔴 CHỜ ANH`, và cái được ghi thêm là **đã có người đọc
> nó và chọn chưa quyết** — thứ trước hôm nay không phân biệt được với **chưa ai đọc**.
>
> **Nếu không quyết định** vẫn đúng nguyên như đoạn trên: giữ nguyên, an toàn cho file,
> và một cỗ máy headless có file hỏng chạy trên giá trị mặc định cho tới khi có người sửa
> file.
>
> 🔴 **KHỐI HOÃN NÀY ĐÃ HẾT HIỆU LỰC 2026-08-19 — giữ NGUYÊN VĂN, không xoá, vì nó là hồ
> sơ về một trạng thái file này trước đây không phân biệt được (*"đã có người đọc và chọn
> chưa quyết"* so với *"chưa ai đọc"*).** Lần hoãn kết thúc bằng đúng thứ luật đòi: một
> **phán quyết** ghi kèm ngày và người quyết — xem khối `🔨 PHÁN QUYẾT 2026-08-19` cuối
> mục này. Câu *"Nếu không quyết định"* ở trên **cũng hết hiệu lực**: đã có quyết định, và
> nó **không** phải *giữ nguyên*.

### ✅ ĐÃ ĐO 2026-08-19 (AI-1) — ba lựa chọn, giá từng cái, và chỗ nào KHÔNG đo được

> 📎 **Đoạn ở đầu PHẦN I đọc *"🔴 Cái mục 9 CHƯA có, nêu tên chứ không lấp: nó không bày ra các lựa
> chọn kèm giá ĐÃ ĐO của từng lựa chọn…"* (Y-1, 2026-08-18) — RÚT 2026-08-19 (AI-1), giữ nguyên văn
> tại chỗ của nó.** Lý do là **phép đo đã chạy**, không phải câu ấy từng sai. **Mục 9 KHÔNG rời Phần I
> và vẫn `🔴 CHỜ ANH`:** phần dưới đây thêm **số liệu**, không thêm **kết luận**, và **không khuyến
> nghị lựa chọn nào**. Kiểu bảo tồn: **một** kiểu, nêu tại mục 14 §"khả năng thứ ba đã đo".
>
> 🔴 **Câu *"Mục 9 KHÔNG rời Phần I và vẫn `🔴 CHỜ ANH`"* mô tả đúng ngày nó được viết
> (2026-08-19, AI-1) và thành SAI CÙNG NGÀY, khi chủ sở hữu đọc chính phép đo dưới đây và
> phán.** Giữ nguyên văn: nó là hồ sơ về **ranh giới AI-1 đã giữ** — đo mà không quyết — và xoá nó
> làm mất bằng chứng rằng phán quyết đến từ chủ sở hữu chứ không từ người đo. Mục 9 nay ở **Phần
> III**. (AJ-1, 2026-08-19.)

**Người đo, ngày, cây, SHA:** **AI-1**, **2026-08-19**, `avi-aoi-sim` ghim tại **`f08cb379`**. **Toàn
bộ hạng "tự đo"** — đọc trên mã, không nhận lại con số nào. Miền quét như nêu ở mục 14: **`git grep
<mẫu> f08cb379 -- .`**, toàn cây Git tại commit, kể cả các đường **không nằm trên đĩa**.

**(1) `UpdateSettings` hôm nay làm gì, THEO THỨ TỰ — và nó là BA việc, không phải hai.**

1. **CAM KẾT VÀO BỘ NHỚ** — dưới `_gate`: gán `_serverUrl`/`_verifyTls`/`_machineCode`/`_language` cho
   những tham số khác null, đặt `rebuildNeeded` (🔴 **`_language` KHÔNG đặt `rebuildNeeded`**), rồi
   **chụp lại** bộ ba sẽ lưu, vẫn dưới khoá.
2. **ÁP** — **ngoài** khoá, chỉ khi `rebuildNeeded`, trong một `try`: `CredentialStore.Load` →
   `TransportCoordinator.RebuildLive` → `_onLiveSettingsRebuilt`.
3. **LƯU** — trong `finally` của chính `try` ấy: `_settingsStore?.Save(new PersistedFleetSettings{…})`,
   **một câu lệnh duy nhất và có chủ ý là một** (doc của chính nó nêu: thêm gì dưới `Save` phải **lồng
   vào**, không **nối sau**).

🔴 **TÁCH ĐƯỢC VỀ MẶT CƠ HỌC KHÔNG — CÓ. Nhưng số arm chứng minh nó là MỘT, không phải hai.**

> 📎 **Câu này đọc *"và cơ chế ấy ĐÃ TỒN TẠI, được HAI assertion giữ"* ở lần ghi đầu (`840abd57`) —
> RÚT 2026-08-19 (AI-1, vòng sửa sau phản biện), giữ nguyên văn.** Nó **đếm thừa một**, và là **một
> con số vô hướng tóm tắt một tập người viết chưa đếm lại** — đúng luật câu chữ, trong đúng khối viết
> ra để tuân nó, lần thứ hai trong cùng bản ghi.

- **Arm ÁP-MÀ-KHÔNG-LƯU, đúng thứ (c) cần — MỘT, nêu tên:**
  `FleetHostSettingsPersistenceTests.NoSettingsStore_UpdateSettings_StillWorks_JustNothingSurvivesRestart`.
  `_settingsStore` là **null-conditional** (`?.`), nên một `FleetCore` dựng **không có store** chạy
  **trọn** `CredentialStore.Load` → `RebuildLive` → `_onLiveSettingsRebuilt` rồi **bỏ qua `Save`**.
  Phép **áp thật sự chạy**. Ở mức **thực thể**.
- 🔴 **Arm KHÔNG phải áp-mà-không-lưu, và tôi đã xếp nhầm nó:**
  `FleetHostSettingsPersistenceTests.LanguageOnlyChange_NeverWritesToTheSettingsStore`. `rebuildNeeded`
  ở `false` ⇒ **cả khối `if` bị bỏ qua** ⇒ `RebuildLive` **KHÔNG chạy lần nào**. Đó là
  **CAM-KẾT-mà-KHÔNG-ÁP-và-không-lưu** — nó chứng minh *phép lưu bỏ được theo từng lời gọi*, và
  **không chứng minh gì** về việc *phép áp vẫn chạy*. Mà **phép áp chạy chính là thứ (c) đòi**: một
  nhánh không đọc được tôn trọng sàn **trong bộ nhớ** phải làm transport thật sự chạy trên sàn ấy.

Nên phép tách mục 9 hỏi **không phải một cơ chế mới**; nó là **một arm thứ hai của cơ chế đã có**.
Cái chưa có là **một đường vào**: `FleetCore` **không có** phương thức công khai nào áp mà không lưu
(`ApplyMode` chỉ chạm chế độ transport, không chạm bộ ba).

**(2) BAO NHIÊU CHỖ GỌI — liệt kê trước, đếm sau.** Quét `git grep -n "UpdateSettings(" f08cb379 --
tools/machine-simulator/src`. Trong `src/`, ngoài chính khai báo:

| # | chỗ gọi, trỏ bằng TÊN | nó **CẦN** phép lưu hay chỉ **ĐANG NHẬN** nó |
|---|---|---|
| 1 | `FleetHost.UpdateSettings(SettingsUpdateRequest)` | **không phải chỗ gọi thật** — vỏ bọc một dòng, chuyển thẳng sang `_core` |
| 2 | `SettingsEndpoints` → `PUT /v1/settings` | **CẦN.** Đây là toàn bộ lý do FF-1 tồn tại: bộ ba vận hành viên PUT phải sống qua lần khởi động sau |
| 3 | `Program.cs` → `TryReplayStartupSettings` (phát lại lúc khởi động) | **HAI ARM, hai câu trả lời.** Arm **KHÔI PHỤC**: giá trị **đến TỪ file**, nên `Save` ghi lại đúng cái nó vừa đọc — **chỉ ĐANG NHẬN**. Arm **GIEO** (không có file, sàn env): `Save` là thứ **TẠO RA** file — **CẦN**, và khi áp hỏng thì file gieo ấy bị **xoá** ở đúng và chỉ đúng ca ấy, bởi bộ xoá duy nhất trong `Program.cs` |

**Đếm sau khi liệt kê: HAI chỗ gọi thật trong `src/` (một vỏ bọc), và một trong hai mang HAI arm.**
Trong `tests/`, hai file gọi `UpdateSettings(`: `FleetHostSettingsPersistenceTests.cs` và
`SettingsWalPreservationTests.cs`.

**(3) CÁI GÌ ĐỌC TRẠNG THÁI ẤY SAU ĐÓ (§8.1(h5.4)) — `GET /v1/settings` trả từ BỘ NHỚ, không từ file.**
`FleetCore.GetSettings()` dựng `FleetSettingsSnapshot` **từ chính bốn trường** dưới `_gate`, cộng
`_transportCoordinator.Mode`; `FleetHost.GetSettings()` chiếu nó qua `FleetProjections.ToSettingsDto`;
`SettingsEndpoints` map `GET /v1/settings` thẳng vào đó. **Không có phép đọc file nào trên đường ấy.**

🔴 **File `fleet-settings.json` được ĐỌC đúng HAI chỗ trong `src/`, và cả hai lúc KHỞI ĐỘNG:**
`FleetCore` constructor (`_settingsStore.Load()`, đặt ba trường và **không** dựng transport) và
`Program.cs` (`settingsStore.Read()`, phép đọc ba-kết-cục quyết định phát lại). **Không một bề mặt
lúc chạy nào đọc file.** Nên một giá trị **áp mà không lưu** khiến **`GET /v1/settings` nói khác
file** — và **chỉ nó**, cho tới lần khởi động sau.

> 📎 **Câu trên đọc *"trong cả sản phẩm"* ở lần ghi đầu (`840abd57`) — RÚT 2026-08-19 (AI-1), giữ
> nguyên văn, thay bằng *"trong `src/`"*.** Biên chưa khai:
> `tools/machine-simulator/tools/settings-acl-probe/Program.cs` mở **đúng đường dẫn ấy**
> (`Path.Combine(settingsRoot, "fleet-settings.json")`). Nó **ngoài `src/`** và là **dụng cụ chẩn
> đoán**, nên nó **không lật kết luận** — nhưng *"cả sản phẩm"* là một phủ định phổ quát rộng hơn tập
> tôi đã mở, và cách sửa là **thu miền về đúng cái đã quét**, không phải nới lời.

🔴 **Và sự lệch ấy KHÔNG mới:** `Program.cs` đã tự khai, nguyên văn trong chú thích của chính nó, rằng
sau một lần phát lại áp **hỏng**, các trường giữ bộ ba đã hỏng nên *"`GET /v1/settings` reports it —
truthfully, as the configuration this process is holding — while the transport stays on whatever it
had."* Nên lựa chọn (c) **không tạo ra một loài lệch mới**; nó biến một **cặn của thất bại** thành một
**trạng thái ổn định bình thường**. Đó là chỗ chênh cần chủ sở hữu cân, và AI-1 **không cân hộ**.

**(4) BA LỰA CHỌN, GIÁ TỪNG CÁI — đo được chừng nào thì đo, chỗ nào không đo được thì NÊU TÊN.**

**(a) Giữ nguyên.** Giá trong mã: **0**. Hành vi đã đo, trỏ bằng tên: `Program.cs` tính
`replaySucceeded` bằng `settingsRead.Status != FleetSettingsReadStatus.Unreadable && TryReplayStartupSettings(…)`
— trên nhánh **Unreadable** phép phát lại **không chạy lần nào**, nên `FleetHost.UpdateSettings`
không được gọi, nên `finally` không tới, nên **không gì bị ghi và không gì bị xoá**. Giá **ngoài** mã:
đúng như mục này đã viết — máy headless chạy trên mặc định dựng sẵn cho tới khi có người sửa file.
**Ba assertion đang giữ nhánh ấy** nằm trong `StartupSettingsReplayHardeningTests` (xem (b)).

**(b) Áp sàn VÀ lưu.** 🔴 **Giá ĐO ĐƯỢC: ít nhất MỘT bài kiểm ĐỎ KHÔNG NÉ ĐƯỢC, và HAI chuỗi đã
xuất bản thành sai.**

> 📎 **Khối này, ở lần ghi đầu của AI-1 (commit `840abd57`), nêu SAI nhân chứng — RÚT 2026-08-19
> (AI-1, vòng sửa sau phản biện), giữ NGUYÊN VĂN:** *"🔴 **Giá ĐO ĐƯỢC và nó là một bài kiểm ĐỎ, nêu
> tên:** `StartupSettingsReplayHardeningTests.TheStartupReplayHasExactlyOneArm_AndTheSettingsFileOneWriterAndOneDeleter`
> khẳng định `Program.cs` nhắc `TryReplayStartupSettings` **đúng 2 lần** (khai báo + **một** lời gọi).
> Một arm phát lại thứ hai đưa con số lên **3** ⇒ **ĐỎ** … **Đây đúng là nhánh C1 mà `Program.cs` mô
> tả dài dòng là đã bị rút vì nó huỷ file của vận hành viên."*
>
> **Vì sao sai — một phép đo, không phải một ý kiến.** Trên arm `Unreadable`,
> `FleetSettingsRead.ForUnreadable` truyền **`settings: null`**, nên `persistedSettings` là **null**,
> nên `initialSettingsRequest` **ĐÃ LÀ sàn `ST4I_*`** rồi. ⇒ **(b) thi hành được bằng cách XOÁ một
> biểu thức guard** (`settingsRead.Status != FleetSettingsReadStatus.Unreadable &&`), **không thêm một
> chỗ gọi nào** ⇒ `Regex.Matches(program, @"TryReplayStartupSettings\s*\(")` **vẫn là 2** ⇒ bài kiểm
> được nêu tên **VẪN XANH**. Và đây không phải một bản thi hành kỳ quặc: chú thích ngay trên guard ấy
> nói nó được viết thế *"rather than as a second call site"*. 🔴 **Tôi đã định giá (b) bằng một cái
> tên sẽ không nổ** — và **cùng lúc** nêu điều kiện thi hành cho (c) và cho mục 13 mà **không** nêu
> cho (b). Cùng một loài, ba chỗ, hai chỗ tuân, một chỗ không. Câu *"đúng là nhánh C1"* cũng **rút**:
> C1 nổ trên một bộ ba **ĐỌC ĐƯỢC** không áp được, còn (b) nổ trên arm **không đọc được lần nào** —
> **cùng loài hậu quả, khác kích hoạt** — và nhân chứng riêng của C1
> (`AFailedReplay_LeavesThePersistedTripleIntact_AndDoesNotLetTheEnvFloorWin`) **vẫn xanh** dưới (b).

**Nhân chứng ĐỎ dưới MỌI bản thi hành, nêu tên:**
`StartupSettingsReplayHardeningTests.AMalformedSettingsFile_SurvivesAnOrdinarySuccessfulStart_AndTheHostSaysSo`.
Nó khẳng định **hai** thứ mà (b) phá **cả hai**, và cả hai là **tính chất của FILE và của PHẢN HỒI**,
không phải của văn bản nguồn — nên **không né được bằng cách chọn cách viết khác**:
- `Assert.Equal(OperatorsOwnBytes, File.ReadAllText(settingsFile))` — **byte của vận hành viên,
  nguyên vẹn, vẫn còn đó**;
- `Assert.Equal(FleetHost.DefaultServerUrl, settings.ServerUrl)` cùng `…DefaultMachineCode…` — **sàn
  KHÔNG thắng trong bộ nhớ**; tiến trình lên bằng mặc định dựng sẵn vì **không gì được áp cả**.

**Và HAI chuỗi đã xuất bản thành sai, không một:** (i) dòng log
`STARTUP SETTINGS FILE COULD NOT BE READ` — *"it was NOT applied, and it was NOT overwritten or deleted
by this start … unreadable content is the only remaining record of what was configured here"*; (ii)
câu khuyến nghị của arm **GIEO** — *"These came from the ST4I_\* environment variables and **NO
settings file existed before this start**"* — được chọn đúng khi `persistedSettings` là null, tức
**đúng trên arm Unreadable**, và nó **sai hiển nhiên** khi file **có** mà chỉ là không đọc được.
Cả hai phải viết lại **cùng commit**.

🔴 **Điều kiện thi hành, nêu cho (b) đúng như đã nêu cho (c):** hai **phép kiểm đếm NGUỒN** trong
`StartupSettingsReplayHardeningTests` **có thể VẪN XANH** dưới (b) — chúng đếm văn bản, và bản thi hành
rẻ nhất không thêm văn bản nào. **Cái bắt được (b) là một bài kiểm HÀNH VI, không phải một phép kiểm
đếm.**

**(c) Áp mà không lưu.** 🔴 **Giá ĐO ĐƯỢC, và cái đo được là một SỰ IM LẶNG:** **không một trong hai
phép kiểm đếm nguồn hiện có nào nhúc nhích.** Phép đếm chỗ ghi bắt
`[Ss]ettings[Ss]tore\s*\??\.Save\s*\(` **hoặc** dòng chứa `new PersistedFleetSettings` — một đường áp
mà không lưu **không thêm cái nào** ⇒ vẫn **1** ⇒ **xanh**. Phép đếm arm phát lại bắt
`TryReplayStartupSettings\s*\(` — một helper mang tên khác **không thêm cái nào** ⇒ vẫn **2** ⇒
**xanh**. Nên **(c) đi lọt qua cả hai dụng cụ mà nhánh này đã dựng lên để canh chính nó**, và nhân
chứng cho nó là thứ **phải viết mới**. Giá thứ hai, đã đo ở (1): `FleetCore` **chưa có** đường vào
công khai nào cho việc này, nên (c) là **một bề mặt công khai mới trên `FleetCore`** cộng **một lối
vào thứ hai** vào đường áp — và doc của chính `finally` đặt sẵn ràng buộc hình dạng cho bất cứ thứ gì
thêm vào đó (**lồng vào, không nối sau**). Giá thứ ba, nêu chứ không đo được: `GET /v1/settings` sẽ
báo một bộ ba mà file **không có**, **thường xuyên** chứ không chỉ sau một thất bại.

**CHỖ AI-1 KHÔNG ĐO ĐƯỢC, nêu tên chứ không lấp:**
- **Bao nhiêu bản triển khai headless thật đang đặt `ST4I_*` mà lại có `fleet-settings.json` không đọc
  được** — đây là con số quyết định mục này **đáng bao nhiêu**, và nó **không có trong cây mã**. Không
  telemetry, không log sản xuất trong repo. **Đừng bịa một tỉ lệ.**
- **`fleet-settings.json` hỏng theo cách nào ngoài đời** (ACL, đĩa đầy, cắt điện giữa `File.Move`,
  sửa tay) — phân bố ấy **chưa ai đo**, và nó quyết định (a) tốn bao nhiêu.
- **Giá của (b)/(c) tính bằng công** — AI-1 **không dựng đường nào**, đúng theo yêu cầu, nên mọi con
  số về công là **ước lượng** và **cố ý không viết ra**: một ước lượng đặt ở đây sẽ **đọc như một phép đo**.

> ### 🔨 PHÁN QUYẾT 2026-08-19 — **(b) ÁP SÀN `ST4I_*` VÀ LƯU NÓ**, TRÊN NHÁNH *KHÔNG ĐỌC ĐƯỢC*
>
> **Chủ sở hữu quyết, 2026-08-19, sau khi đọc phép đo của AI-1 và sau khi được cảnh báo rằng phán quyết
> này đi NGƯỢC năm phán quyết trước của chính anh.** Không phải (a) *giữ nguyên*, không phải (c) *áp mà
> không lưu*. Trên nhánh mà `fleet-settings.json` không đọc được, sàn `ST4I_SERVER_URL` /
> `ST4I_MACHINE_CODE` / `ST4I_VERIFY_TLS` **được áp vào bộ nhớ VÀ được ghi xuống file**, đè lên các byte
> không đọc được, **tại chỗ**.
>
> 🔴 **CĂNG THẲNG VỚI MỤC 1, 5, 8, 10 VÀ 11 — GHI TRƯỚC, VÌ NÓ CÓ THẬT VÀ VÌ HỒ SƠ PHẢI MANG CẢ HAI
> VẾ.** Năm mục ấy phán **ngược lại** ở cùng một hình dạng: *đừng ghi đè các byte tiến trình này không
> đọc được*. Luật viết ra từ chúng — `docs/startup-failure-posture.md` §3.6 — nói *"một phép đọc phải
> phân biệt **không có gì ở đây** với **có thứ gì đó tôi không dùng được**, và **chỉ cái đầu** cho phép
> người gọi tự lập một giá trị rồi ghi xuống"*. **Mục 9 (b) cho phép ghi trên vế thứ hai.** Đó là một
> mâu thuẫn bề mặt với năm phán quyết, và nó **không được làm nhẹ đi ở đây**.
>
> 🔴 **CÁCH ĐỌC LÀM CHÚNG HOÀ NHAU, và nó là cách đọc của CHỦ SỞ HỮU, không phải của người thi hành.**
> Ở mục 1/5/8/10/11 thứ bị ghi đè là **dữ liệu của vận hành viên** và thứ được ghi xuống là một giá trị
> **tiến trình tự nghĩ ra** — một bảng OEE rỗng, một bản ghi site mặc định, một khoá vừa đúc lại. Ở mục
> 9 thứ được ghi xuống là **chính cấu hình mà bản triển khai đã KHAI qua `ST4I_*`**: tiến trình **khôi
> phục một giá trị đã được khai**, nó **không bịa ra** một giá trị. Luật §3.6 **không bị nới**; cái đổi
> là **giá trị nào được coi là đã có sẵn ở đây**.
>
> 🔴 **Và mục 13 — quyết CÙNG NGÀY, cùng luật — đi NGƯỢC CHIỀU: nó SIẾT.** Hai kết cục ngược nhau
> không phải một mâu thuẫn: ở mục 13 thứ trên đĩa là **dữ liệu của vận hành viên** và thứ định ghi đè là
> một bảng tiến trình đang cầm, nên luật siết; ở mục 9 thứ trên đĩa **không đọc được** và thứ ghi xuống
> là **lời khai của bản triển khai**, nên luật nới. **Cùng một luật, hai dữ kiện khác nhau.**
>
> **Giá chủ sở hữu chấp nhận, viết ra chứ không giấu:** một `fleet-settings.json` hỏng vì gõ nhầm tay
> **không còn là bản ghi cuối cùng** của bộ ba vận hành viên đã đặt — lần khởi động kế tiếp ghi đè nó,
> và **sản phẩm không giữ một bản sao**. Đổi lại, một bản cài headless có file hỏng **chạy đúng bộ ba mà
> service definition của nó cấp**, thay vì chạy trên `DefaultServerUrl = ""`.
>
> **Điều KHÔNG được quyết, nêu để không ai đọc rộng hơn:** (c) *áp mà không lưu* **không** được chọn,
> nên hợp đồng của `FleetCore.UpdateSettings` — dùng chung với `PUT /v1/settings` — **không đổi**. Và
> **không có miễn trừ DI CHUYỂN dữ liệu nào** được cấp ở đây: miễn trừ của mục 10 là của **riêng mục
> 10**.

> ### ✅ ĐÃ THI HÀNH — nhiệm vụ AJ-1 (2026-08-19), `.superpowers/sdd/items-9-13-executed/`
>
> **Bản sửa, nêu bằng TÊN:** guard `settingsRead.Status != FleetSettingsReadStatus.Unreadable &&` ở
> `src/St4i.EngineApi/Program.cs` **bị xoá**. Trên nhánh `Unreadable`, `FleetSettingsRead.ForUnreadable`
> **không mang `Settings`**, nên `persistedSettings` là null, nên `initialSettingsRequest` **ĐÃ LÀ** sàn
> `ST4I_*` — (b) vì thế thi hành bằng **xoá một biểu thức**, **không thêm một chỗ gọi nào**.
>
> 🔴 **HAI CHUỖI ĐÃ XUẤT BẢN THÀNH SAI, VÀ CẢ HAI ĐƯỢC SỬA TRONG CÙNG COMMIT — nêu rõ chuỗi nào ở
> đâu:**
> 1. **Dòng log `STARTUP SETTINGS FILE COULD NOT BE READ`** (`Program.cs`, khối `if (settingsRead.Status
>    == Unreadable)`): *"it was NOT applied, and it was NOT overwritten or deleted by this start"*. Sai
>    ngay ở nhánh nó được viết cho. Nay là **HAI câu, chọn theo `envFloorHasAValue`** — vì một câu không
>    thể đúng cho cả hai ca: **có sàn** ⇒ *"ITS CONTENT IS BEING OVERWRITTEN BY THIS START, on the
>    owner's decision of 2026-08-19 (item 9…)"*; **không có `ST4I_*` nào được đặt** ⇒ không có gì để áp,
>    `rebuildNeeded` là false, nên **không gì được ghi**, và câu ấy nói rõ rằng đó là vì **không có
>    sàn**, chứ không phải vì file được bảo vệ.
> 2. **Câu khuyến nghị của arm GIEO** (đối số `remedy` truyền vào `TryReplayStartupSettings`):
>    *"These came from the ST4I_\* environment variables and **NO settings file existed before this
>    start**"*. Nó được chọn bằng `replayRestoredAFile` — tức *"không có bộ ba đã lưu"* — **đúng trên
>    `Absent` VÀ trên `Unreadable`**. Nay chọn bằng **kết cục phép đọc** (`settingsRead.Status switch`,
>    ba arm), và arm `Unreadable` có câu của riêng nó nói rằng file **CÓ** tồn tại và đang bị ghi đè.
>
> **Một chuỗi thứ ba GIỐNG HỆT không bị đụng, và nói ra vì nó dễ bị gom nhầm:** dòng
> `STARTUP SETTINGS SEED DISCARDED` cũng chứa *"no settings file existed before this start"*, nhưng khối
> ấy gác bằng `settingsRead.Status == Absent`, nên câu ấy **vẫn đúng** và **không được sửa**.
>
> **Nhân chứng — ĐẢO CHIỀU và ĐỔI TÊN:**
> `StartupSettingsReplayHardeningTests.AMalformedSettingsFile_SurvivesAnOrdinarySuccessfulStart_AndTheHostSaysSo`
> → **`…_IsOverwrittenByTheEnvironmentFloor_AndTheHostSaysSo`**. Nó khẳng định **byte của FILE** và
> **nội dung phản hồi**, nên không né được bằng cách viết khác; nay nó khẳng định **ngược lại** (sàn
> thắng trên đĩa và trong bộ nhớ), cộng **ranh giới** (thư mục còn **đúng một** file — không có bản đổi
> tên nào bên cạnh) và **sự VẮNG MẶT** của chuỗi *"NO settings file existed before this start"* trong
> toàn bộ log của lần boot ấy.
>
> 🔴 **PHÉP KIỂM ĐẾM NGUỒN VẪN XANH VÀ ĐÓ KHÔNG PHẢI BẰNG CHỨNG.**
> `TheStartupReplayHasExactlyOneArm_AndTheSettingsFileOneWriterAndOneDeleter` **không nhúc nhích** —
> `TryReplayStartupSettings(` vẫn **2**, `Save` vẫn **1**, `Delete` vẫn **1**. Brief của AI-1 nêu bài ấy
> làm nhân chứng cho (b); **phản biện bác, và bác đúng**. Một dụng cụ đếm văn bản im lặng trước một thay
> đổi hành vi là **im lặng**, không phải chấp thuận.
>
> 🔴 **RANH GIỚI KHÔNG BỊ VƯỢT, và nó được ĐO chứ không được hứa:** phép ghi là
> `FleetSettingsStore.Save` → `WriteAllTextAtomic` → temp + `File.Move(overwrite:true)` **trên cùng một
> đường dẫn**. Byte cũ **không bị đổi tên sang chỗ khác** và **không bị xoá** — khối `Delete` duy nhất
> trong `Program.cs` vẫn gác bằng `Status == Absent`. Nhân chứng đo nó bằng cách liệt kê thư mục sau lần
> boot: **đúng một file**.
>
> 🔴 **TRẦN CỦA BẢN SỬA NÀY, nêu tên chứ không lấp:** nếu sàn được **ghi** rồi **áp hỏng**, nhánh này
> **không có** thứ tương đương khối discard của arm GIEO, nên file vừa ghi **ở lại** và từ lần boot sau
> nó **thắng** các biến `ST4I_*` theo precedence FF-1. Đóng chỗ ấy đòi **một bộ xoá thứ hai** trong
> `src/` — thứ mà census trên ghim ở đúng **một**, và thứ phán quyết này **không** cho phép. Nêu ở đây,
> ở `docs/startup-failure-posture.md` §3.1a-now, và trong chú thích của chính `Program.cs`.
>
> **Cùng chỗ đã cập nhật:** `docs/startup-failure-posture.md` §3.1a-now (cả bốn đoạn: *"what the
> composition root does"*, *"what it costs"* hai nửa, *"what witnesses it"*) và census §3.1 **hàng 36 và
> hàng 37** — 🔴 **cả hai nửa của `U` được kiểm lại chứ không giả định**, vì `U` là một **liên từ** và
> hàng 18 là hồ sơ của chính file ấy về một hàng chỉ thoả nửa đầu mà vẫn được ghi là hợp lệ. Cả hai hàng
> **vẫn `U ✓`**: host lên, và lỗi được báo ở `Error` — nửa sau được đo bằng tên bài kiểm, không bằng một
> câu.
>
> **CẶP ĐỐI CHỨNG ĐÃ CHẠY HAI PHÍA** — `src/` của base `abc6f0ca` cộng `tests/` của HEAD, rồi ngược
> lại. Kết quả nguyên văn trong báo cáo AJ-1.

---

## 10. `CredentialStore.Load` biến một lỗi môi trường KHÔI PHỤC ĐƯỢC thành mất mát không hoàn nguyên

**Mục này sinh ra từ phần dư 1 của mục 5, và nó ở đây vì nó là một QUYẾT ĐỊNH.**
Trước V-1 nó sống trong một gạch đầu dòng của một mục khác; luật của file này là một
quyết định phải có mục của nó.

**Đo được (V-1):** `CredentialStore.Load` trả **`null`** cho một blob **có mặt trên
đĩa mà tiến trình này không giải mã được** — sai scope/entropy DPAPI (một `.bin` thời
tiền-FF-2 mã theo `CurrentUser`), hoặc chép từ máy khác, hoặc hỏng — và trả **đúng
`null` ấy** khi **không có file nào cả**. Người gọi không có gì để rẽ nhánh.

**Cái chưa từng được ghi ở đâu là HẬU QUẢ.** Doc comment của chính `Load` trình bày
`null` như một kết quả **lành** — *"để đường credential-rỗng bình thường của caller
chạy thay vì một lần sập không bắt được"* — nhưng đường ấy là đường **claim lại**, và
nó gọi `Save`, thứ **ghi đè**. Một blob sai scope/sai máy **đọc lại được sau khi sửa
môi trường — nếu nó còn tồn tại**. Nên một lỗi sửa được bị biến thành mất mát không
hoàn nguyên, im lặng.

**Ở đâu:** `src/St4i.EdgeCore/Infrastructure/CredentialStore.cs` (`Load`, khối
`catch (CryptographicException)`; `Save` → `File.WriteAllBytes`). **Chỗ gọi cố ý KHÔNG
được liệt kê ở đây:** `Load` là `static` và được gọi từ nhiều project, nên một danh
sách chỗ gọi viết tay là đúng loài khẳng định — một tập không ai kiểm đếm được, chép
vào văn xuôi — mà file này lập ra để chấm dứt. Tìm bằng chính tên kiểu.

**Vì sao KHÔNG sửa trong V-1:** phương án giữ được các byte là **giữ blob cũ dưới tên
khác**, tức **DI CHUYỂN dữ liệu vận hành viên trong sản phẩm** — thứ brief của V-1 bắt
buộc phải **dừng và báo** chứ không tự làm. Phương án "cho `Load` ném" là **đổi hợp
đồng của một phương thức `static` mà nhiều project gọi**, tức một quyết định chứ không
phải một cái chốt.

> ⚠️ **Bản nháp của đoạn trên còn một câu nữa và câu ấy KHÔNG ĐO ĐƯỢC — nó bị rút
> TRƯỚC khi xuất bản, và được ghi lại ở đây vì im lặng về một câu đã rút là đúng thứ
> file này bắt.** Nguyên văn: *"cho nó ném biến một máy có credential hỏng thành một
> máy không khởi động được"*. Đo lại: `FleetCore.UpdateSettings` gọi
> `CredentialStore.Load` bên trong phần **kích hoạt**, và phần ấy đã được
> `TryReplayStartupSettings` của `St4i.EngineApi/Program.cs` **bọc lại** từ H-1a — chính
> `FleetCore.cs` ghi rằng vòng lặp boot cũ đã biến mất **vì** lần phát lại được sửa. Nên
> một cú ném ở đó làm hỏng **lần phát lại**, và "không khởi động được" là một kết luận
> không ai đo. Câu bị rút, không bị sửa cho vừa.

**Nếu không quyết định:** giữ nguyên. Lần claim lại kế tiếp ghi đè blob cũ, và
**không ai biết** rằng thứ vừa mất chỉ cần sửa môi trường là đọc lại được.

**Bằng chứng — chạy lại được:**
`tests/St4i.EngineApi.Tests/OperatorDataRemovalCensusTests.cs`,
`CredentialStorePostureCensusTests.TheCredentialStore_CannotTellAnUnusableBlobFromNoBlob_AndTheReclaimOverwritesIt`
**[TÊN NÀY ĐÃ ĐỔI 2026-08-18 — nay là `…_AndTheReclaimNowKeepsItAside`. Tên cũ giữ ở đây
vì nó là tên mà mục này đã công bố, và vì chính chỗ đổi tên là bằng chứng rằng khẳng định
đã đảo chiều: một tên nói *"lần claim lại ghi đè"* sau bản sửa là một chuỗi đã công bố
nói sai.]**
— nó ghim **cả hai nửa**: hai ca cho cùng một `null`, và `Save` sau đó đè lên. Nó
**ghim một khuyết tật đang sống làm đường cơ sở và KHÔNG sửa**, đúng như S-1 đã làm cho
mục 5. Nếu anh quyết SỬA, khẳng định ấy đảo chiều và chỗ đảo chính là diff.

> ### 🔨 PHÁN QUYẾT 2026-08-18 — GIỮ BLOB CŨ DƯỚI TÊN KHÁC, KHÔNG GHI ĐÈ
> **Quyết bởi chủ sở hữu.** Trong hai phương án mục này nêu tên ở trên, phương án được
> chọn là **giữ blob cũ dưới tên khác** — *không* phải phương án "cho `Load` ném".
>
> ⚠️ **Hai phương án ấy KHÔNG được đánh nhãn chữ cái trong mục này.** Chúng được nêu
> trong văn xuôi ở đoạn *"Vì sao KHÔNG sửa trong V-1"*. Phán quyết được ghi **bằng mô tả
> chứ không bằng nhãn**, vì một nhãn `(a)` không tồn tại ở đây sẽ trỏ vào hư không — và ở
> **mục 12**, nơi các nhãn ấy CÓ tồn tại, `(a)` là đúng phương án **ngược lại** với điều
> chủ sở hữu chọn. Nhãn không đi qua được ranh giới giữa hai mục.
>
> #### 🔴 ĐÂY LÀ MỘT MIỄN TRỪ, VÀ NÓ CHỈ ÁP CHO MỤC NÀY
> Kể từ Q-1, **mọi brief đều bắt DI CHUYỂN dữ liệu vận hành viên phải DỪNG VÀ BÁO** thay
> vì tự làm, và **nhiều nhiệm vụ đã dừng đúng trên luật ấy** — chính mục này là một trong
> số đó (*"thứ brief của V-1 bắt buộc phải dừng và báo"*), và phần dư 2 của mục 1
> (`DeviceIdentityStore`) là một mục khác.
>
> **Chủ sở hữu vừa cấp phép cho MỘT lần di chuyển, ở MỘT mục.** Luật **không** bị bãi bỏ
> và **không** yếu đi ở bất cứ mục nào khác. Đọc dòng này như một giấy phép chung là đọc
> sai nó — và đó đúng là cách một ràng buộc chết: không phải bị huỷ, mà bị suy rộng.
> `DeviceIdentityStore` ở phần dư 2 của mục 1 **không** được miễn trừ bởi phán quyết này;
> quyết định của nó đứng nguyên và chưa ai đụng tới.
>
> 🔴 **Không cơ chế ở đây:** tên nào, đặt ở đâu, dọn khi nào, và chuyện gì xảy ra nếu cái
> tên ấy cũng đã tồn tại — tất cả là việc của nhiệm vụ thi hành.
>
> **Việc còn nợ.** *(Đúng vào ngày quyết định — nay đã thi hành; xem ghi chép ngay dưới,
> Z-1, 2026-08-18. Giữ nguyên văn làm hồ sơ, kể cả câu về phép ghim, vì chỗ nó đảo chiều
> chính là diff mà nó hứa.)* Không dòng thực thi nào đổi vào ngày quyết định. Phép ghim
> `CredentialStorePostureCensusTests.TheCredentialStore_CannotTellAnUnusableBlobFromNoBlob_AndTheReclaimOverwritesIt`
> **vẫn đang khẳng định hành vi cũ**, đúng như đoạn trên nói: khi bản sửa tới, khẳng định
> ấy đảo chiều, và chỗ đảo chính là diff. *(Bản sửa đã tới cùng ngày. Phép ghim ấy nay tên
> là `…_AndTheReclaimNowKeepsItAside` và khẳng định các byte cũ **SỐNG SÓT**; nửa đầu — hai
> ca cho cùng một `null` — **không** đảo, và điều đó là một phát hiện chứ không phải chỗ
> bỏ sót: chủ sở hữu chọn giữ blob chứ không chọn cho `Load` ném.)*
>
> ### ✅ ĐÃ THI HÀNH — nhiệm vụ Z-1 (2026-08-18), `.superpowers/sdd/one-law-three-sites/`
> **Ở ĐÂU, và vì sao ở đó chứ không ở `Load`.** Giấy phép mà luật nói tới thuộc về **câu lệnh ghi**:
> giá trị được tự lập là **khoá `mk_` mới**, và câu lệnh ghi nó xuống là `Save`. Nên `Save` — chứ
> không phải `Load` — nay phân **ba kết cục** ngay tại thời điểm ghi: **không có gì ở path** ⇒ ghi, y
> như cũ; **một blob tiến trình này GIẢI MÃ ĐƯỢC** ⇒ ghi, y như cũ (đó là một lần re-key bình
> thường, người gọi đang cầm khoá, không có gì khôi phục được đang bị đe doạ); **một blob có mặt mà
> tiến trình này không dùng được** ⇒ **di chuyển** file cũ sang một tên anh em rồi mới ghi. Không xoá
> gì, không đè gì.
>
> 🔴 **CÁI GÌ ĐƯỢC DI CHUYỂN, VÀ NGƯỜI VẬN HÀNH TÌM LẠI NÓ BẰNG CÁCH NÀO** — đây là nửa mà phán quyết
> nói *"tên nào, đặt ở đâu, dọn khi nào, và chuyện gì xảy ra nếu cái tên ấy cũng đã tồn tại"* là việc
> của nhiệm vụ thi hành:
> * **cái gì:** đúng file `.bin` đang nằm ở đó, **nguyên từng byte** — không giải mã, không sửa,
>   không diễn giải.
> * **đặt ở đâu và tên gì:** **cùng thư mục creds**, tên
>   `<mã máy>.bin.unreadable-<dấu thời gian UTC>` (ví dụ `PRESS-01.bin.unreadable-20260818T101530Z`).
>   Cùng chỗ, vì thư mục ấy là thứ duy nhất vận hành viên được chỉ tới; tên mang **mã máy** để biết
>   của ai, chữ **unreadable** để biết vì sao, và **thời điểm** để phân biệt nhiều lần.
> * **nếu tên ấy đã tồn tại:** thêm `-2`, `-3`… Phép di chuyển dùng overload `File.Move` **KHÔNG có
>   cờ overwrite** — nó **ném** khi đích đã có — nên *"một blob đã giữ không bao giờ bị thay"* là một
>   **tính chất**, không phải một ý định.
> * **dọn khi nào: KHÔNG BAO GIỜ, bởi sản phẩm.** Một lần gỡ cài đặt xoá nó vì
>   `packaging/remove-data.ps1` xoá **cả thư mục** `creds`; ngoài ra không gì trong sản phẩm động vào
>   nó.
> * **`ListMachineCodes` không liệt kê nó** (nó duyệt `*.bin`), và điều đó được **ghim** chứ không
>   được lập luận — `.bin` là đuôi ba ký tự, và khớp mẫu của Windows đối xử với đuôi ba ký tự theo
>   một cách riêng. Một máy chỉ còn lại file đã giữ thì **thật sự không có credential nào**.
> * **báo cho ai:** một dòng trên đúng kênh `[credentialstore]` (standard error) mà chính lớp này đã
>   dùng cho cảnh báo ACL, nêu **cả hai** đường dẫn. 🔴 **TRẦN, nói thẳng:** lớp này là `static` và
>   **không có seam logger nào**; dưới `AddWindowsService`, standard error **không phải** Windows
>   Event Log. Nên **hồ sơ mà vận hành viên chắc chắn tìm được là CHÍNH CÁI FILE** — đó là lý do cái
>   tên phải mang đủ câu chuyện.
>
> **TRẦN khác, nêu tên chứ không lấp:**
> * `Load` **vẫn trả cùng một `null`** cho hai ca — đó là phương án chủ sở hữu **đã chọn**, chứ không
>   phải một chỗ bỏ sót. Vậy `CredentialStore` **vẫn ở** `DecidedExceptionsToTheLaw` và vẫn là một
>   ngoại lệ của luật đọc; cái được đóng là **hậu quả**, không phải sự lẫn lộn.
> * `Load` còn một phép **kiểm tồn tại** (`File.Exists`) — đúng thứ mọi store khác đã bỏ ở Q-1. Nó
>   làm một file bị khoá hay một thư mục bị ACL từ chối **ném** ra khỏi `Load` thay vì trả `null`,
>   tức một kết cục khác với chính chú thích của nó. Mục 10 quyết **cú ghi đè**; **không** quyết cái
>   này, và Z-1 không tự lấy.
> * `Save` nay **có thêm một cửa ném**: nếu blob cũ cần giữ mà **giữ không được** (file bị khoá, ACL
>   từ chối đổi tên), ngoại lệ đi ra và credential mới **không** được ghi. Đó là kết cục đúng — lựa
>   chọn còn lại là phá đúng thứ bản sửa này lập ra để giữ — nhưng nó là một cửa mới và được nêu tên.
> * **Miễn trừ KHÔNG lan.** `DeviceIdentityStore` (phần dư 2 của mục 1) **không** được phán quyết
>   này miễn trừ; hàng của nó trong `ExpectedPostures` đứng nguyên và điều đó được ghi ngay tại hàng
>   ấy.
>
> **CẶP ĐỐI CHỨNG ĐÃ CHẠY HAI PHÍA** (cùng file điều khiển với mục 8 và 11 — xem mục 8 để biết vì sao
> nó dịch được ở cả hai cây). Kịch bản: một `.bin` có mặt mà tiến trình này không giải mã được,
> `Load` trả `null` (tiền đề đã khẳng định), rồi một lần claim lại gọi `Save`.
> * base `f7c9216e`: `files in creds dir=1 [<mã máy>.bin] | old bytes survive somewhere=False | under
>   name=(gone) | reclaimed key readable=True` — khoá mới đọc được, **các byte cũ biến mất**.
> * HEAD `587553fc`: `files in creds dir=2 [<mã máy>.bin, <mã máy>.bin.unreadable-20260818T030723Z] |
>   old bytes survive somewhere=True | reclaimed key readable=True | ListMachineCodes count for this
>   code=1` — khoá mới vẫn đọc được, **các byte cũ còn nguyên dưới tên đã nêu**, và **`ListMachineCodes`
>   vẫn chỉ đếm MỘT** dù thư mục có hai file: đó là phép đo cho câu *"nó không bị liệt kê"*, không phải
>   một lập luận về khớp mẫu.
>
> Nguồn và hai file kết quả giữ ở `.superpowers/sdd/one-law-three-sites/evidence/`.

---

## 11. Một `oee-settings.json` được KHÔI PHỤC vào lúc đang chạy bị ghi đè bằng bảng rỗng

**Mục này sinh ra từ bản sửa của mục 5, và nó là chỗ HAI SỰ THẬT của bản sửa ấy còn
lệch nhau lần thứ ba.** V-1 cho `Set` tự đọc lại ngay trước khi ghi, và so hai điều:
*file lúc này* (`fresh.Status`) và *bảng trong bộ nhớ được dựng từ phép đọc nào*
(`_tableBuiltFrom`). Hai cái ấy lệch nhau được **ba kiểu**. Hai kiểu bị từ chối. Kiểu
thứ ba thì không.

**Đo được:**

```
_tableBuiltFrom == Absent   VÀ   fresh.Status == Loaded
```

Tiến trình lên khi **không có file**; sau đó một file **có nội dung** xuất hiện; phép
đọc ngay trước cú ghi **NHÌN THẤY nó**; vị từ từ chối là **sai**; nên `Set` ghi **bảng
rỗng cộng một máy** đè lên một file mà nó **vừa đọc thành công**. **Không ném, không
409, không một dòng log.**

**Không cần tranh chấp, không cần người ghi thứ hai.** Kịch bản là **khôi phục một bản
sao lưu vào `%ProgramData%\ST4I\sim\historian` trên một host đang chạy** — đúng công
việc mà chú thích tham số `directory` của chính store ấy quảng cáo thư mục này để làm
(*"một operator/backup tool tìm thấy mọi file cạnh historian ở một chỗ"*).

**Ở đâu:** `src/St4i.EdgeCore/Historian/OeeSettingsStore.cs` (`Set`, vị từ hai điều
kiện; `Save` → `WriteAllTextAtomic`), tới được từ
`src/St4i.EngineApi/Endpoints/HistorianEndpoints.cs` (`PutOeeSettingsAsync`).

**Hậu quả vận hành:** giống hệt mục 5 — ideal-cycle override và planned-production
ratio của **mọi máy** biến mất, con số OEE đổi thầm lặng — nhưng ở một thời điểm khác:
**ngay sau khi vận hành viên tưởng mình vừa khôi phục xong.**

**Vì sao KHÔNG sửa trong V-1:** đóng nó là đổi **khi nào một cú ghi được phép**. Hôm
nay `Absent` lúc nạp **cho phép** người gọi tự đặt giá trị — đó chính là đường
**khởi động lần đầu**. Thu hẹp nó là một thay đổi hợp đồng, không phải một cái chốt.
Và nó **nằm ngoài tình huống** mà luật của mục 5 nói tới: **các byte đọc được suốt**,
nên luật ở `docs/startup-failure-posture.md` §3.6 **không quyết được** ca này — đúng
chỗ §3.6 tự nói là luật không với tới.

**Nếu không quyết định:** giữ nguyên. Một bản khôi phục thực hiện trên host đang chạy
sẽ bị lần đặt OEE kế tiếp xoá, và **không ai biết** cho tới khi có người đối chiếu lại.
Cách né duy nhất hôm nay là **khởi động lại host sau khi khôi phục**, và điều đó
**không được ghi ở đâu cả** trước mục này.

**Bằng chứng:** commit `a9326c79` (V-1 vòng sửa 1) và chú thích lớp của
`OeeSettingsStore`. 🔴 ~~**Chưa có test nào ghim ca này**~~ **[HẾT ĐÚNG 2026-08-18 —
Z-1 ghim nó, xem ghi chép thi hành cuối mục; câu gốc giữ nguyên vì nó là lý do mà cả
mục này dựa vào]** — nó chưa được ghim vì ghim nó
là khẳng định hành vi hiện tại đúng, mà đó chính là thứ đang chờ anh quyết.
`Read_RecordsWhatItAnswered_SoStatusMeansTheMostRecentRead` **dựng đúng trạng thái ấy**
và **dừng ngay trước `Set`**.

> ### 🔨 PHÁN QUYẾT 2026-08-18 — CHẶN CÚ GHI Ở ĐÚNG KIỂU LỆCH THỨ BA
> **Quyết bởi chủ sở hữu:** cú ghi bị **CHẶN** ở đúng vị từ mà mục này đã đo —
> bảng trong bộ nhớ dựng từ `Absent`, mà phép đọc ngay trước cú ghi trả `Loaded`.
>
> ⚠️ **Mục này không nêu lựa chọn nào có nhãn chữ cái** — nó nêu **một** hướng sửa, trong
> đoạn *"Vì sao KHÔNG sửa trong V-1"*. Phán quyết được ghi bằng **vị từ đã đo**, không
> bằng nhãn.
>
> **Cái giá mà chính mục này đã nêu tên và phán quyết không xoá:** hôm nay `Absent` lúc
> nạp **cho phép** người gọi tự đặt giá trị, và đó chính là đường **khởi động lần đầu**.
> Thu hẹp nó là **một thay đổi hợp đồng**. Nhiệm vụ thi hành phải giữ đường khởi động lần
> đầu chạy được, và **cách** làm việc ấy không được quyết ở đây.
>
> **Việc còn nợ.** *(Đúng vào ngày quyết định — nay đã thi hành; xem ghi chép ngay dưới,
> Z-1, 2026-08-18. Ca này NAY ĐÃ CÓ test ghim, và cả cái trần còn lại cũng có; câu dưới
> giữ nguyên văn làm hồ sơ.)* Không dòng thực thi nào đổi vào ngày quyết định. Ca này **vẫn chưa có
> test nào ghim**, đúng như đoạn trên ghi — và lý do đã đổi: trước hôm nay nó chưa được
> ghim vì ghim nó là khẳng định hành vi hiện tại đúng; nay hành vi hiện tại đã bị phán
> quyết là **sai**, nên phép ghim thuộc về nhiệm vụ thi hành.
>
> ### ✅ ĐÃ THI HÀNH — nhiệm vụ Z-1 (2026-08-18), `.superpowers/sdd/one-law-three-sites/`
> **Cơ chế:** `Set` giữ nguyên vị từ V-1 đã có và **thêm một nhánh thứ hai**, đúng cặp mục này đã đo
> — `_tableBuiltFrom == Absent` **và** `fresh.Status == Loaded` — ném
> `OeeSettingsFileAppearedException`, và `PUT /v1/historian/oee/settings` trả **409** như nhánh kia.
> `Reload` (trong sản xuất: khởi động lại) là đường ra, y như nhánh file-đã-được-sửa.
>
> 🔴 **Vì sao là một KIỂU THỨ HAI chứ không phải một thông điệp rộng hơn.** Trên nhánh này **file đọc
> hoàn toàn được**. Nhét nó vào `OeeSettingsUnreadableException` là để một **tên đã công bố** khẳng
> định một điều sai về một file đọc được — đúng loài mà P-2 đo ở một thành viên enum. Nên hai nhánh
> có chung một lớp cơ sở mới, `OeeSettingsWriteRefusedException`, và endpoint bắt lớp cơ sở ấy. Bắt
> rộng hơn **không** phải khẳng định rộng hơn: đúng **hai** kiểu dẫn xuất từ nó, cả hai đều do `Set`
> ném và chỉ `Set` ném, cả hai đều nghĩa là *"không có gì được ghi"*.
>
> **CÁI GIÁ mục này đã nêu tên, và bản sửa KHÔNG trả bằng cách bỏ nó:** `Absent` lúc nạp vẫn cho
> phép người gọi tự đặt giá trị. Đường **khởi động lần đầu** sống sót nhờ **sự thật thứ hai** chứ
> không nhờ một ngoại lệ: một lần khởi động sạch để phép đọc mới cũng là `Absent`, nên cặp không
> khớp và cú ghi đi qua — rồi một `Set` thành công đẩy **cả hai** sự thật sang `Loaded`, nên cú ghi
> kế tiếp nằm ngoài nhánh này **theo cấu trúc** chứ không nhờ may.
>
> **BẢN SỬA RỘNG HƠN CÁI HẠI ĐÃ ĐO, CÓ CHỦ Ý, và ghim chứ không im:** một file **mảng rỗng** `[]`
> xuất hiện sau khi store lên cũng bị từ chối. Vị từ chủ sở hữu quyết không có mệnh đề nào về **nội
> dung**, và `[]` là `Loaded` không có entry — đúng trạng thái mà chú thích `Read` của chính store
> gọi là *"thứ một vận hành viên vừa dọn bảng để lại"*. Công bố một bảng tự nghĩ ra đè lên một trạng
> thái cố ý cũng là một việc như đè lên một bảng có dữ liệu.
>
> 🔴 **TRẦN — VÀ NÓ LÀ CÙNG MỘT THAO TÁC CỦA VẬN HÀNH VIÊN, CHỈ KHÁC LÀ ĐĨA ĐÃ CÓ FILE.** Vị từ được
> quyết đóng ca khôi phục rơi vào một host lên khi **không có file**. Còn hai cặp vẫn ghi:
> * `_tableBuiltFrom == Loaded` **và** `fresh.Status == Loaded`, **mà hai phép đọc khác nội dung** —
>   host lên trên một file tốt, vận hành viên khôi phục đè lên nó, cả hai sự thật vẫn là `Loaded`, và
>   `Set` kế tiếp ghi bảng **trước khi khôi phục** đè lên file **sau khi khôi phục**. Store **không
>   ghi lại DANH TÍNH** của các byte mà bảng được dựng từ đó, chỉ ghi kết cục của phép đọc, nên nó
>   không phân biệt được. **Đây là hình dạng THÔNG THƯỜNG hơn của một lần khôi phục**, không phải
>   hình dạng hiếm: một host từng có cấu hình OEE thì có file.
> * `_tableBuiltFrom == Loaded` **và** `fresh.Status == Absent` — file bị bỏ đi sau khi nạp, `Set`
>   dựng lại nó từ bảng. Không mất thứ gì tiến trình này đã đọc; thứ bị bỏ là **chính hành động bỏ
>   đi**, nếu nó là cố ý.
>
> Đóng một trong hai đòi một sự thật store này không giữ, và giữ nó là **đổi lần thứ hai** cái *khi
> nào một cú ghi được phép*. Z-1 **thi hành đúng vị từ đã quyết và không nới nó**. Ca thứ nhất được
> **ghim SỐNG** —
> `OeeSettingsStoreTests.Set_AfterARestoreOntoAHostThatCameUpWithAFile_StillOverwritesIt_AndThatIsTheKnownCeiling`
> — đúng cách S-1 ghim khuyết tật của mục 5 làm đường cơ sở: nếu một nhiệm vụ sau đóng nó, khẳng định
> ấy đảo chiều và chỗ đảo chính là diff. ~~**Nó KHÔNG được thêm vào danh sách chờ chủ sở hữu**: mục 11
> đã đóng, và chưa ai được hỏi về ca này.~~
>
> 🔴 **[RÚT 2026-08-18, cùng ngày, cùng nhiệm vụ — phản biện I-2.]** Câu bị gạch trên là **sai**, và
> nó sai theo đúng hình dạng mà file này lập ra để chấm dứt: báo cáo của chính Z-1 viết ngược lại
> (*"đó là câu đáng đưa lại cho chủ sở hữu"*), nên hai artefact của một nhiệm vụ nói khác nhau và
> **cái được xuất bản nói cái yếu hơn**. Lập luận *"chưa ai được hỏi"* là **lý do để hỏi**, không phải
> lý do để im — mục 8 và mục 10, hai mục Z-1 vừa đóng, sinh ra chính xác bằng cách ấy. Phần dư này nay
> là **mục 13** của file này, ở **Phần I — ĐANG CHỜ ANH**, chưa được quyết. Chữ giữ nguyên, chỗ sai
> đánh dấu.
>
> **CẶP ĐỐI CHỨNG ĐÃ CHẠY HAI PHÍA** (cùng file điều khiển với mục 8 và 10 — xem mục 8 để biết vì sao
> nó dịch được ở cả hai cây). Kịch bản: store lên khi **không có file**, một bản khôi phục **hai máy**
> xuất hiện, rồi một `Set` cho **máy thứ ba**.
> * base `f7c9216e`: `Set RETURNED (no refusal) | restored bytes intact=False | RESTORED-A
>   survived=False | RESTORED-B survived=False | SOME-OTHER-MACHINE on disk=True` — **cả hai máy vừa
>   khôi phục biến mất**, thay bằng đúng một entry mà lần `PUT` mang tới.
> * HEAD `587553fc`: `Set THREW OeeSettingsFileAppearedException | restored bytes intact=True |
>   RESTORED-A survived=True | RESTORED-B survived=True | SOME-OTHER-MACHINE on disk=False`.
>
> Nguồn và hai file kết quả giữ ở `.superpowers/sdd/one-law-three-sites/evidence/`.

---

## 13. Một bản KHÔI PHỤC đè lên một `oee-settings.json` ĐÃ CÓ vẫn bị ghi đè — cùng hình dạng mục 11, và là ca THÔNG THƯỜNG hơn trong hai ca

**Mục này sinh ra từ bản thi hành của mục 11, và nó ở đây vì tiền lệ của chính file này:**
mục **8** sinh ra đúng như thế (phần dư của mục 1) và mục **10** sinh ra đúng như thế
(phần dư 1 của mục 5). Cả hai đã được nêu tên, leo lên, và được phán. Chôn phần dư này
trong một báo cáo là đảo ngược đúng cơ chế đã tạo ra hai mục ấy — và luật của file này nói
thẳng: *một điều "đã được nêu trong một báo cáo" là điều chủ sở hữu **không có đường nào
mở ra đọc**.*

> ⚠️ **Z-1 đã suýt chôn nó, và điều đó được ghi lại chứ không im.** Khối thi hành của mục
> 11 và `docs/startup-failure-posture.md` §3.6 lúc đầu viết *"Nó KHÔNG được thêm vào danh
> sách chờ chủ sở hữu"*, trong khi báo cáo của chính Z-1 viết *"đó là câu đáng đưa lại cho
> chủ sở hữu"*. **Hai artefact của cùng một nhiệm vụ nói ngược nhau, và cái được xuất bản
> nói cái yếu hơn.** Phản biện (I-2) bắt được, điều phối viên phán **mở mục**. Cả hai câu
> sai đã được sửa tại chỗ chúng được viết, không chỉ ở đây.

**Đo được:** `OeeSettingsStore.Set` so **hai sự thật** — `_tableBuiltFrom` (bảng trong bộ
nhớ được dựng từ phép đọc nào) và `fresh.Status` (file lúc này). Mục 11 đóng cặp
`Absent`/`Loaded`. Cặp còn lại vẫn ghi:

```
_tableBuiltFrom == Loaded   VÀ   fresh.Status == Loaded,   mà HAI PHÉP ĐỌC KHÁC NỘI DUNG
```

Host lên trên một file tốt → vận hành viên khôi phục một bản sao lưu **đè lên nó** → cả hai
sự thật vẫn là `Loaded` → `Set` kế tiếp ghi bảng **trước khi khôi phục** đè lên file **sau
khi khôi phục**. Store chỉ ghi lại **kết cục** của phép đọc, **không ghi DANH TÍNH** của
các byte mà bảng được dựng từ đó, nên nó không phân biệt được hai file. **Không ném, không
409, không một dòng log** — y hệt mục 11 trước khi mục 11 được đóng.

🔴 **Và đây là ca THÔNG THƯỜNG hơn trong hai ca.** Mục 11 đóng ca mà host lên khi **không
có file**. Bất kỳ máy nào **từng đặt cấu hình OEE** thì **có** file — nên hình dạng còn mở
là hình dạng mà một lần khôi phục thật hay gặp hơn, không phải hình dạng hiếm.

**Ở đâu:** `src/St4i.EdgeCore/Historian/OeeSettingsStore.cs` (`Set`, vị từ hai điều kiện;
`Save` → `WriteAllTextAtomic`), tới được từ
`src/St4i.EngineApi/Endpoints/HistorianEndpoints.cs` (`PutOeeSettingsAsync`).

**Hậu quả vận hành:** giống hệt mục 5 và mục 11 — ideal-cycle override và
planned-production ratio của **mọi máy** trong bản khôi phục biến mất, con số OEE đổi thầm
lặng, **ngay sau khi vận hành viên tưởng mình vừa khôi phục xong**. Cách né duy nhất hôm
nay vẫn là **khởi động lại host sau khi khôi phục** (hoặc gọi `Reload`).

**Cái gì đã chặn nó khỏi được sửa luôn trong Z-1:** phán quyết mục 11 ghi **một vị từ đã
đo**, và vị từ ấy không bao trùm cặp này. Nới nó ra là **quyết lại** một phán quyết của chủ
sở hữu, thứ nhiệm vụ thi hành không được làm. Về mặt cơ chế thì cũng không phải một cái
chốt: đóng nó đòi store **ghi lại danh tính các byte** mà bảng được dựng từ đó — nội dung,
hoặc một dấu hiệu nhận dạng của file — chứ không chỉ kết cục phép đọc, tức **thêm một sự
thật mới vào store**.

**Vì sao là quyết định của chủ sở hữu:** nó đổi **khi nào `PUT /v1/historian/oee/settings`
thất bại với người vận hành**. Một store phân biệt được "file tôi vừa đọc không phải file
tôi dựng bảng từ đó" sẽ trả **409** ở những lúc hôm nay nó trả **200** — kể cả khi thứ đổi
file là một biên tập bằng tay hợp lệ, không phải một bản khôi phục. Đó là cái giá vận hành
viên trả, nên là quyết định của họ, đúng cùng lý do mục 11 đã là quyết định của họ.

**Nếu không quyết định:** giữ nguyên. Một bản khôi phục thực hiện trên host đang chạy **có
file** sẽ bị lần đặt OEE kế tiếp xoá, và **không ai biết** cho tới khi có người đối chiếu
lại — đúng câu mà mục 11 đã viết, cho ca còn lại.

> 🔴 **Nhánh ấy KHÔNG được đi: chủ sở hữu quyết ngày 2026-08-19 (xem khối `🔨 PHÁN QUYẾT` cuối mục).**
> Đoạn trên giữ nguyên văn vì nó là **cái giá của việc không quyết**, và nó là một nửa của phép cân
> mà phán quyết đã thực hiện — nửa kia là cái giá **409** ghi ở khối phán quyết.

🔴 **Cái mục này CHƯA có, nêu tên chứ không lấp:** nó **không** bày ra các lựa chọn kèm
**giá ĐÃ ĐO** của từng lựa chọn — bao nhiêu `PUT` hợp lệ hôm nay sẽ thành 409, và một phép
so danh tính (nội dung? thời gian sửa? kích thước?) tốn gì trên một file mà `Set` đã đọc
sẵn trong cùng một khoá. **Giá ấy phải được đo**; lần ghi này không đo được nó, và một con
số ước lượng đặt ở đây sẽ **đọc như một phép đo**. Đây đúng là chỗ thiếu mà mục 9 cũng
đang mang, và nó được nêu tên vì lý do y hệt.

> 📎 **Đoạn ngay trên — RÚT MỘT PHẦN 2026-08-19 (AI-1), giữ nguyên văn, rút tại chỗ nó được viết.**
> Nửa *"một phép so danh tính … tốn gì"* nay **có một phép đo** (§"✅ ĐÃ ĐO 2026-08-19" bên dưới).
> 🔴 **Nửa *"bao nhiêu `PUT` hợp lệ hôm nay sẽ thành 409"* KHÔNG được rút và vẫn đứng nguyên** — phép
> đo kết luận nó **không đo được** từ cây này, và nêu tên cách kiểm nó dứt điểm. Câu cuối
> (*"một con số ước lượng đặt ở đây sẽ đọc như một phép đo"*) **KHÔNG được rút**: nó là luật, và phép
> đo mới tuân nó. **Câu *"chỗ thiếu mà mục 9 cũng đang mang"* nay đúng theo một nghĩa hẹp hơn:** cả
> hai mục đã được đo cùng ngày, và **chỉ mục 13 còn lại một nửa không đo được**.

**Bằng chứng — chạy lại được, và nó ghim khuyết tật ĐANG SỐNG:**
`tests/St4i.EdgeCore.Tests/Historian/OeeSettingsStoreTests.cs`,
`Set_AfterARestoreOntoAHostThatCameUpWithAFile_StillOverwritesIt_AndThatIsTheKnownCeiling`
— nó dựng host lên **có** file, khôi phục đè lên, gọi `Set`, và khẳng định entry vừa khôi
phục **biến mất**. Nó **ghim một khuyết tật đang sống làm đường cơ sở và KHÔNG sửa**, đúng
như S-1 đã làm cho mục 5 và V-1 đã làm cho mục 10. Nếu anh quyết SỬA, khẳng định ấy đảo
chiều và chỗ đảo chính là diff. Cùng chỗ: chú thích lớp của `OeeSettingsStore` và
`docs/startup-failure-posture.md` §3.6.

> 🔴 **ĐIỀU ẤY ĐÃ XẢY RA — 2026-08-19.** Chủ sở hữu quyết SỬA, và khẳng định **đã đảo chiều**: bài
> kiểm nay là **`…_IsRefused_AndTheRestoredBytesSurvive`** và khẳng định entry vừa khôi phục **CÒN
> NGUYÊN**. Đoạn trên giữ nguyên văn vì nó là **lời tiên đoán về cơ chế đã tự nghiệm đúng**: một
> khuyết tật được ghim sống thì ngày đóng nó, chỗ đảo là diff — không cần ai đi tìm. Tên đổi cùng
> thân, vì một cái tên nói *"cái trần đã biết"* trên một thân khẳng định phép từ chối là một khẳng
> định sai (P-2).

### ✅ ĐÃ ĐO 2026-08-19 (AI-1) — BỐN câu hỏi thành số; câu THỨ NĂM, và nó là câu ở TIÊU ĐỀ, KHÔNG ĐO ĐƯỢC

> 📎 **Tiêu đề này đọc *"ba trong bốn câu hỏi thành số; câu thứ tư KHÔNG ĐO ĐƯỢC và đây là vì sao"*
> trong bản nháp của chính AI-1 — RÚT 2026-08-19 (AI-1), trước khi commit, giữ nguyên văn.** Nó **đếm
> sai tập của chính nó**: bốn câu hỏi con đều **thành số** (đường ghi ngoài store; store đã cầm sẵn gì;
> ba ứng viên danh tính; bao nhiêu test đỏ), và cái **không** đo được là câu **thứ năm** — câu đứng ở
> **tiêu đề** của cả phép đo, *"bao nhiêu `PUT` hợp lệ thành 409"*. 🔴 **Một con số vô hướng tóm tắt
> một tập mà người viết nó chưa đếm lại — trong một khối viết ra để chấm dứt đúng loài ấy.** Nó ở lại
> đây làm nhân chứng, đúng như đoạn *"chỗ đau là chỗ nó xảy ra"* ở mục 14 đã để lại một cái.

> 📎 **Đoạn *"🔴 Cái mục này CHƯA có, nêu tên chứ không lấp: nó không bày ra các lựa chọn kèm giá ĐÃ
> ĐO của từng lựa chọn — bao nhiêu `PUT` hợp lệ hôm nay sẽ thành 409, và một phép so danh tính (nội
> dung? thời gian sửa? kích thước?) tốn gì…"* — RÚT 2026-08-19 (AI-1), giữ nguyên văn tại chỗ của nó,
> và rút **MỘT PHẦN**.** Nửa nói *"phép so danh tính tốn gì"* nay **có một phép đo**. Nửa nói
> *"bao nhiêu `PUT` hợp lệ hôm nay sẽ thành 409"* 🔴 **KHÔNG được rút và vẫn đứng nguyên: nó vẫn CHƯA
> ĐO, và phép đo dưới đây kết luận nó KHÔNG ĐO ĐƯỢC từ trong cây này.** **Mục 13 KHÔNG rời Phần I và
> vẫn `🔴 CHỜ ANH`.** Kiểu bảo tồn: **một** kiểu, nêu tại mục 14 §"khả năng thứ ba đã đo".
>
> 🔴 **Câu *"Mục 13 KHÔNG rời Phần I và vẫn `🔴 CHỜ ANH`"* mô tả đúng ngày nó được viết (2026-08-19,
> AI-1) và thành SAI CÙNG NGÀY, khi chủ sở hữu đọc chính phép đo dưới đây và phán ĐÓNG.** Giữ nguyên
> văn, cùng lý do như ở mục 9: nó là hồ sơ về **ranh giới AI-1 đã giữ**. 🔴 **Và nửa còn lại của khối
> này KHÔNG hết hiệu lực:** *"bao nhiêu `PUT` hợp lệ thành 409"* **vẫn CHƯA ĐO** — phán quyết được ra
> **mà không có con số ấy**, và điều đó là một sự thật về quyết định, không phải một thiếu sót của nó.
> (AJ-1, 2026-08-19.)

**Người đo, ngày, cây, SHA:** **AI-1**, **2026-08-19**, `avi-aoi-sim` ghim tại **`f08cb379`**. **Toàn
bộ hạng "tự đo"**, đọc trên mã và trên test; **không chạy một `PUT` nào**, không chạm CSDL nào. Miền
quét: **`git grep <mẫu> f08cb379 -- .`**, toàn cây Git tại commit.

🔴 **(0) CÂU KHÔNG ĐO ĐƯỢC, nói TRƯỚC để không câu nào bên dưới bị đọc rộng hơn nó.** *"Bao nhiêu
`PUT` hợp lệ hôm nay sẽ thành 409"* là một tỉ lệ trên **lưu lượng sản xuất**. Trong cây này **không có
telemetry sản xuất, không có log ingest, không có bản ghi PUT nào**. Cái duy nhất đo được là **cái gì
làm cặp `Loaded/Loaded-khác-nội-dung` xuất hiện**, và **bao nhiêu bài kiểm hiện có** đứng trên nó.
**AI-1 KHÔNG viết ra một tỉ lệ, và cố ý:** một con số ước lượng đặt ở đây sẽ **đọc như một phép đo**.
Cái kiểm được nó dứt điểm là **đếm PUT trên một bản triển khai thật**, và nhiệm vụ này không có nó.

**Nhưng một CHẶN TRÊN thì đo được, và nó đáng viết ra vì nó không đòi bịa gì:** cặp
`Loaded/Loaded-khác-nội-dung` **chỉ** phát sinh khi có người hoặc cái gì đó **ghi file từ bên ngoài
store**. Nên trên một máy **một host, không khôi phục, không biên tập tay, không tác nhân ghi ngoài**,
số `PUT` hợp lệ thành 409 là **0** — không phải "ít", mà **không có ca nào để nổ**. Toàn bộ tỉ lệ nằm
trong **tần suất các vector vận hành**, và **đó** mới là cái không đo được. Nói cách khác: **cái chưa
biết là tần suất, không phải cơ chế.**

**(1) MỌI ĐƯỜNG GHI `oee-settings.json` NGOÀI STORE — liệt kê trước, đếm sau.** Phép quét
`git grep -n "oee-settings.json" f08cb379 -- .` cho **toàn bộ** chỗ nhắc tên file trong cây; phép quét
thứ hai, trên chính bộ đếm của sản phẩm (`OperatorDataRemovalCensusTests`, bảng chỗ ghi theo file),
cho biết `src/St4i.EdgeCore/Historian/OeeSettingsStore.cs` mang đúng
`File.Move(overwrite:true), File.WriteAllText` — tức `WriteAllTextAtomic`. **Trong `src/` không có
file nào khác ghi tên ấy.** Nên câu *"`Set` là chỗ ghi duy nhất trong sản phẩm"* **đứng vững**, và mọi
đường còn lại là **đường VẬN HÀNH, ngoài mã**:

| # | đường ghi ngoài store | có làm cặp `Loaded/Loaded-khác-nội-dung` xuất hiện không |
|---|---|---|
| 1 | **khôi phục từ bản sao lưu** lên host đang chạy | **CÓ** — đây chính là ca mục này mở ra |
| 2 | **biên tập tay** file thành JSON **HỢP LỆ** | **CÓ** — và mục này đã nêu: giá vận hành viên trả kể cả khi họ đúng |
| 3 | **biên tập tay** thành JSON **KHÔNG hợp lệ** | **KHÔNG** — rơi vào arm `Unreadable` mà V-1 đã đóng, đã có bài kiểm giữ |
| 4 | **gỡ dữ liệu / xoá file** khi host đang chạy | **KHÔNG** — thành `Loaded/Absent`, arm V-1 đã đóng, đã có bài kiểm giữ |
| 5 | **cài đặt / cài lại** đặt file trước khi tiến trình lên | **KHÔNG** — đọc lúc dựng store, nên bảng **là** file |
| 6 | 🔴 **MỘT HOST THỨ HAI trên cùng `ST4I_HISTORIAN_DIR`** (§15.9) | **CÓ**, và nó là đường **duy nhất phát sinh từ chính sản phẩm** |

🔴 **"SÁU" LÀ MỘT PHÂN LOẠI, KHÔNG PHẢI MỘT PHÉP KIỂM ĐẾM — và đây là biên phải đọc trước con số.**
**Nửa MÃ đóng kín được và tôi đóng nó:** trong `src/` có **đúng MỘT** chỗ dựng
`OeeSettingsStore` — `Program.cs`, `new St4i.EdgeCore.Historian.OeeSettingsStore(…)`, một singleton DI
— nên **không có thực thể store thứ hai trong tiến trình**, và *"`Set` là chỗ ghi duy nhất trong sản
phẩm"* **đóng được**. 🔴 **Nửa VẬN HÀNH thì KHÔNG đóng được từ trong một repo, và lần ghi đầu viết nó
như thể đóng được.** Sáu hàng dưới đây là **hành động của con người và của hệ điều hành**, không phải
một tập đọc được từ cây mã. **Ít nhất ba vector cùng hình dạng vắng mặt** khỏi nó — tác nhân **đồng
bộ/sao lưu file** (OneDrive, DFS-R, backup có khôi phục ngược); **cách ly rồi phục hồi của phần mềm
diệt virus**; **đẩy cấu hình bằng công cụ quản trị** (GPO/Intune/Ansible) — **và cả ba CÓ làm cặp
`Loaded/Loaded` xuất hiện**. Nên con số đúng không phải một con số: **"ít nhất sáu, và tập này không
đóng được từ trong một repo."**

> 📎 **Câu *"Đếm sau khi liệt kê: SÁU đường, BA làm cặp ấy xuất hiện."* ở lần ghi đầu (`840abd57`) —
> RÚT 2026-08-19 (AI-1, vòng sửa sau phản biện), giữ nguyên văn.** Nó là **một phép LẤY MẪU mặc áo một
> phép KIỂM ĐẾM** — đúng loài mà tiêu đề của chính mục con này đặt tên, tái phạm **ngay dưới** chỗ nó
> tự chẩn đoán. Bảng dưới **giữ nguyên** làm một **phân loại**; cái bị rút là **con số phẳng**.

**Đường 6 đáng đọc kỹ nhất và mục này chưa nêu nó:** `OeeSettingsStore` chỉ có **một khoá TRONG TIẾN TRÌNH** (`_gate`) và **không có khoá
file nào**; `WriteAllTextAtomic` chỉ bảo đảm **không rách**, không bảo đảm **không mất**. Hai tiến
trình trỏ vào cùng một thư mục historian **đều ghi**, và cặp `Loaded/Loaded` xuất hiện **mỗi lần host
kia lưu**. README §15.9 nói thẳng rằng gốc dữ liệu riêng **không** giải quyết chuyện dùng chung, và
rằng cái cần là *"một named mutex, một lockfile, hoặc một kênh đăng ký"*. **AI-1 KHÔNG mở mục mới cho
việc này** và ghi lại đây vì nó là **đầu vào của quyết định mục 13**, không phải một mục riêng.

**(2) STORE ĐÃ CẦM SẴN CÁI GÌ — ĐO, KHÔNG SUY. Câu trả lời: KHÔNG cần thêm một lần đọc đĩa nào.**
`Set` lấy `_gate`, rồi gọi `ClassifyLocked()` → `ReadLocked()`, và `ReadLocked` mở đầu bằng
**`File.ReadAllText(path)`** — **toàn văn file đã nằm trong bộ nhớ, trong cùng một khoá**. Rồi nó
**VỨT BIẾN `text` ĐI**: `OeeSettingsRead.ForLoaded(path, entries)` mang **`Entries` đã giải tuần tự**,
**không mang byte gốc**. Đầu kia cũng vậy: `Load()` gọi **cùng** `ClassifyLocked()`. Nên **cả hai đầu
của phép so đều đã đọc file rồi**; cái thiếu là **một trường để giữ lại**, không phải một cú I/O.
**Giá I/O thêm của phép so danh tính theo NỘI DUNG: 0.**

**(3) BA ỨNG VIÊN DANH TÍNH — cái nào phân biệt được ca này, và CÁCH HỎNG của từng cái, nêu tên.**

| ứng viên | phân biệt được ca này? | giá | 🔴 **CÁCH NÓ HỎNG** |
|---|---|---|---|
| **nội dung** (băm trên `text` đã đọc) | **CÓ** | **0 lần đọc đĩa thêm**; một lần băm trên chuỗi đã có; một trường `string?` trên store | **DƯƠNG TÍNH GIẢ — và đây là giá LỚN NHẤT của ứng viên khả dĩ DUY NHẤT.** Dương tính giả là tính chất **của phép băm NỘI DUNG** (byte đổi ⇒ băm đổi, dù nghĩa không đổi); `WriteIndented = true` **không gây ra** nó, chỉ **nâng xác suất** có người định dạng lại. Một lần **định dạng lại**, đổi **CRLF↔LF**, thêm/bớt **BOM**, hay đổi **thứ tự khoá** ⇒ **409 cho một biên tập HỢP LỆ** — tức **phạt vận hành viên đúng lúc họ làm đúng** |
| **thời gian sửa** (`mtime`) | **KHÔNG ĐÁNG TIN cho ca này** | một cú **syscall metadata thứ hai** | **ÂM TÍNH GIẢ, và nó bỏ sót đúng ca mục này mở ra:** phần lớn công cụ sao lưu/khôi phục **giữ nguyên timestamp** (`robocopy /COPY:T`, `tar -p`, `xcopy /K`), nên một bản khôi phục có thể mang `mtime` **cũ hơn**. Cộng: **FAT/exFAT có hạt 2 giây**, lệch đồng hồ, và filesystem mạng. 🔴 **Và nó dựng lên đúng loài lỗi mà `Read` của chính lớp này đã bỏ đi**: hỏi **hai bề mặt** một câu hỏi — lớp này đã vứt `File.Exists` vì lý do ấy, đo tại `docs/startup-failure-posture.md` §3.1a |
| **kích thước** | **KHÔNG** | rẻ nhất | **ÂM TÍNH GIẢ, tầm thường.** Đổi `0.9` thành `0.1`, hoán hai giá trị giữa hai máy, hay đổi một mã máy cùng độ dài đều **giữ nguyên kích thước** ⇒ ghi đè im lặng y như hôm nay |

🔴 **RÀNG BUỘC THI HÀNH ĐÃ ĐO, và bỏ nó ra thì mọi con số ở (4) sai:** danh tính phải được **làm mới
sau `Save()`**, đúng chỗ và đúng cách mà Z-1 đã làm mới `_status`/`_tableBuiltFrom` ngay sau khi ghi
(*"A write establishes the same fact a read would"*). Nếu không, `Set` **thứ hai liên tiếp** trên cùng
một store sẽ so danh tính-lúc-`Load` với file mà **chính `Set` trước đã ghi** ⇒ **409 giả trên mọi cặp
PUT liên tiếp**. Và arm mới phải đứng **SAU** hai arm sẵn có (`Unreadable`, rồi `Absent`+`Loaded`), vì
cả hai nói những chuyện khác và thông điệp của chúng đã được bài kiểm giữ từng chữ.

**(4) BAO NHIÊU TEST HIỆN CÓ SẼ ĐỎ — đo bằng cách ĐỌC test. Con số là MỘT, và nó phụ thuộc một lựa
chọn thiết kế, nên cả hai nhánh được nêu.** Dân số quét: **năm** file **chạm** `OeeSettingsStore` theo
cách có thể đóng góp — `OeeSettingsStoreTests.cs`, `HistorianEndpointsOeeTests.cs`,
`OperatorDataRemovalCensusTests.cs` **gọi** `Set`/`PutOeeSettingsAsync`; `HistorianEndpointsPdfTests.cs`
và `HistorianEndpointsProvenanceTests.cs` **chỉ dựng** store trên thư mục tạm và **không gọi `Set`,
không ghi đè file**, nên chúng **đóng góp 0**. (Lần ghi đầu viết cả năm là *"file gọi `Set`"* rồi hai
dòng sau nói hai file cuối không gọi — **nội dung đúng, câu chữ tự mâu thuẫn**; sửa ở đây.)

**Biến thể R — danh tính LÀM MỚI sau `Save`** (ràng buộc ở (3)). Mọi lời gọi `Set` mong **thành công**
đều rơi vào một trong ba: (i) thư mục sạch, `Absent/Absent`; (ii) ngay sau `Reload()`, nên danh tính
khớp; (iii) `Set` liên tiếp trên file do chính store vừa ghi, nên danh tính khớp. **Đúng MỘT bài đứng
ngoài cả ba**, và nó được nêu tên:
`OeeSettingsStoreTests.Set_AfterARestoreOntoAHostThatCameUpWithAFile_StillOverwritesIt_AndThatIsTheKnownCeiling`
— nó ghi file **trước** khi dựng store, ghi **đè bằng nội dung khác** sau đó, rồi gọi `Set` và khẳng
định entry vừa khôi phục **biến mất**. **⇒ ĐỎ: MỘT.** Và đó **đúng là bài mà mục này đã nêu tên làm
nhân chứng**: khẳng định của nó **đảo chiều**, và chỗ đảo **chính là diff**.

**Biến thể N — danh tính KHÔNG làm mới sau `Save`.** Thêm mọi bài có **hai `Set` thành công liên tiếp**
trên **một** thực thể store; đọc hết năm file cho **đúng hai** bài:
`OeeSettingsStoreTests.Set_PartialUpdate_LeavesUnspecifiedFieldUnchanged` và
`OeeSettingsStoreTests.Set_TheFirstTimeAfterACleanStart_StillEstablishesTheFile`. **⇒ ĐỎ: BA.**
🔴 **Biến thể N là một bản thi hành SAI**, và nó được nêu chỉ để con số **1** ở trên có nghĩa: nó là
**1 với một điều kiện**, không phải 1 vô điều kiện.

**Cái KHÔNG đỏ, và đó là chỗ đáng ghi nhất:** không một bài nào trong bốn arm đã đóng bị chạm —
`Set_WhenTheFileIsCorruptedAfterConstruction_Refuses_AndLeavesTheOperatorsBytes`,
`Set_WhenAnUnreadableFileIsRepairedAfterConstruction_StillRefuses_UntilReload`,
`Set_WhenTheUnreadableFileWasMovedAside_RefusesWithoutClaimingItReadsCorrectly`,
`Set_AfterReloadingTheFileThatAppeared_LandsOnTopOfIt`,
`Set_WhenAnEmptyTableFileAppearsAfterTheStoreCameUpWithNone_AlsoRefuses` — tất cả ném **trước** khi
arm mới có thể chạy, hoặc đi qua `Reload()`. Bên endpoint, `HistorianEndpointsOeeTests` **không có**
bài nào PUT thành công **hai lần** trên một store: bài hai-PUT duy nhất kết thúc ở arm `Unreadable`.

**CHỖ AI-1 KHÔNG ĐO ĐƯỢC, nêu tên chứ không lấp:**
- **tỉ lệ `PUT` hợp lệ sẽ thành 409** — nêu ở (0). Không đo được từ cây này; đo được bằng đếm PUT trên
  một bản triển khai thật, và **không ai đã làm việc ấy**;
- **tần suất thật của biên tập tay HỢP LỆ so với khôi phục** — hai thứ này trả **cùng một** 409 nhưng
  **khác nhau về việc vận hành viên có bị bất ngờ không**, và phân bố ấy **chưa ai đo**;
- **bao nhiêu bản triển khai đang chạy HAI host trên một `ST4I_HISTORIAN_DIR`** (đường 6) — không có
  trong cây; nếu con số ấy khác 0 thì cặp `Loaded/Loaded` là **thường xuyên**, không phải hiếm, và
  điều đó đổi hẳn giá của lựa chọn "chặn";
- **giá tính bằng công của phép so danh tính** — AI-1 **không dựng nó**, nên mọi con số về công là
  ước lượng và **cố ý không viết ra**.

> ### 🔨 PHÁN QUYẾT 2026-08-19 — **ĐÓNG: STORE PHẢI GHI LẠI DANH TÍNH CỦA CÁC BYTE**
>
> **Chủ sở hữu quyết, 2026-08-19, sau khi đọc phép đo của AI-1.** `OeeSettingsStore` phải phân biệt được
> **"file tôi vừa đọc không phải file tôi dựng bảng từ đó"**, và phải **từ chối** cú ghi trong ca ấy.
>
> 🔴 **GIÁ CHỦ SỞ HỮU ĐÃ CHẤP NHẬN, GHI VÀO MỤC, KHÔNG LÀM NHẸ ĐI:** `PUT /v1/historian/oee/settings`
> sẽ trả **409** ở những lúc hôm nay nó trả **200** — **kể cả khi thứ làm file đổi là một biên tập tay
> HỢP LỆ**, và kể cả khi nó chỉ là một lần **định dạng lại** cùng nội dung. Vận hành viên trả giá ấy;
> đó là lý do nó là quyết định của họ, đúng cùng lý do mục 11 đã là quyết định của họ.
>
> **Câu KHÔNG đo được vẫn KHÔNG đo được, và không bị lấp:** *"bao nhiêu `PUT` hợp lệ hôm nay sẽ thành
> 409"* là một tỉ lệ trên lưu lượng sản xuất; nó **không có trong cây này** và phán quyết được ra
> **mà không có nó**. Cái đo được — cơ chế, và chặn trên **0** trên một máy một host không khôi phục
> không biên tập tay — đứng nguyên ở §"ĐÃ ĐO" phía trên.
>
> 🔴 **Và mục 9 — quyết CÙNG NGÀY, cùng luật §3.6 — đi NGƯỢC CHIỀU: nó NỚI.** Xem khối phán quyết của
> mục 9 để biết vì sao hai kết cục ấy cùng đứng được: ở đây thứ trên đĩa là **dữ liệu của vận hành
> viên**; ở mục 9 nó là các byte **không đọc được** và thứ ghi xuống là **lời khai của bản triển khai**.

> ### ✅ ĐÃ THI HÀNH — nhiệm vụ AJ-1 (2026-08-19), `.superpowers/sdd/items-9-13-executed/`
>
> 🔴 **CƠ CHẾ DANH TÍNH ĐƯỢC **SUY**, KHÔNG PHẢI CHỌN MỘT TRONG BA — và câu trả lời là KHÔNG DÙNG DẤU
> HIỆU NÀO CẢ.** Ba ứng viên AI-1 đo (băm nội dung, `mtime`, kích thước) đều là **vân tay**, và một vân
> tay tồn tại để trả lời *"hai thứ này có giống nhau không"* cho **người không cầm được cả hai vế**.
> Store này **cầm cả hai**: `ReadLocked` **vẫn luôn** gọi `File.ReadAllText` để lấy `Entries` rồi **vứt
> chuỗi ấy đi**; nay `Load` **giữ nó lại** (`_tableBuiltFromText`), và phép đọc tươi của chính `Set`
> sinh ra vế kia — **trong cùng một khoá `_gate`**. Nên phép so là **so hai toa hạng gốc**, và mọi ứng
> viên là một **hàm hao hụt** của thứ đã nằm trong tay:
> * **băm** có thể **đụng độ** ⇒ trả lời *"giống nhau"* về hai file khác nhau — đúng câu trả lời gây ghi
>   đè;
> * **kích thước** cũng thế, với xác suất lớn hơn nhiều;
> * **`mtime`** thậm chí **không phải hàm của nội dung**: nó là **một bề mặt THỨ HAI** bị hỏi câu mà
>   phép đọc đã trả lời — đúng sai lầm mà `Read` của chính lớp này đã vứt `File.Exists` để tránh
>   (`docs/startup-failure-posture.md` §3.1a) — **và công cụ khôi phục giữ nguyên timestamp**, nên nó
>   **mù đúng ở ca đang đóng**.
>
> **Giá đã đo của cơ chế được chọn: 0 lần đọc đĩa thêm** (đúng như AI-1 đo), **một trường `string?`**,
> **một phép so ordinal** thoát ở khác biệt đầu tiên — rẻ hơn băm, vốn phải duyệt hết byte.
>
> **Ở đâu:** `src/St4i.EdgeCore/Historian/OeeSettingsStore.cs` — `OeeSettingsRead.Text` (internal, nên
> **bề mặt công khai không rộng ra**), trường `_tableBuiltFromText`, arm thứ ba trong `Set`, và `Save`
> nay **trả về** văn bản nó vừa ghi.
>
> 🔴 **VỊ TỪ GÁC BẰNG **CẶP**, KHÔNG PHẢI BẰNG *"byte khác nhau"* — và đó là chỗ chịu lực.** Arm mới
> chạy khi `_tableBuiltFrom == Loaded` **VÀ** `fresh.Status == Loaded` **VÀ** byte khác. Cặp còn lại —
> `Loaded`/`Absent`, file bị bỏ đi sau khi nạp — **cũng** có byte khác, và **chủ sở hữu KHÔNG quyết
> nó**; gác bằng *"byte khác nhau"* sẽ đóng nó như một tác dụng phụ, tức **nới một vị từ chưa được
> phán**. Nó **vẫn ghi**, và vẫn là trần, nêu ở §3.6.
>
> **Ràng buộc thi hành AI-1 đo, đã tuân:** danh tính được **làm mới ngay sau `Save()`**, cùng chỗ Z-1
> làm mới `_status`/`_tableBuiltFrom`. Bỏ dòng ấy ⇒ **409 giả trên mọi cặp PUT liên tiếp**; hai bài
> reddens là `Set_PartialUpdate_LeavesUnspecifiedFieldUnchanged` và
> `Set_TheFirstTimeAfterACleanStart_StillEstablishesTheFile`, **nêu tên trong chính chú thích ấy**. Arm
> mới đứng **SAU** hai arm sẵn có, vì thông điệp của chúng bị bài kiểm giữ từng chữ.
>
> **Kiểu ngoại lệ:** `OeeSettingsFileChangedException`, dẫn xuất thứ **ba** của
> `OeeSettingsWriteRefusedException`. Tên phải **đúng với thứ nó khẳng định** (P-2): ở arm này **file
> đọc hoàn hảo** và nó **không phải** file bảng được dựng từ đó — cả `Unreadable` lẫn `FileAppeared` đều
> không đúng. 🔴 **Tính chất mà 409 dựa vào được viết lại thành một TÍNH CHẤT, không phải một con
> số:** chú thích ở `HistorianEndpoints` viết *"đúng HAI kiểu dẫn xuất"* — một số vô hướng phải đếm lại
> mỗi lần thêm arm. Thứ phản hồi thật sự dựa vào là: **mọi** kiểu dẫn xuất đều do `Set` ném, và ném
> **TRƯỚC** phần mutate và `Save`. Chỗ `catch` **không đổi** — nó vốn bắt lớp cơ sở.
>
> **Nhân chứng — ĐẢO CHIỀU và ĐỔI TÊN:**
> `OeeSettingsStoreTests.Set_AfterARestoreOntoAHostThatCameUpWithAFile_StillOverwritesIt_AndThatIsTheKnownCeiling`
> → **`…_IsRefused_AndTheRestoredBytesSurvive`**. Nó ghim một khuyết tật **đang sống** làm đường cơ sở,
> đúng cách S-1 làm cho mục 5 và V-1 cho mục 10, **chính là để** ngày đóng nó thì chỗ đảo là diff. Đây
> là diff ấy. Tên đổi cùng thân: một tên nói *"cái trần đã biết"* trên một thân khẳng định một phép từ
> chối là **một chuỗi đã công bố đang khẳng định điều sai**.
>
> **Và GIÁ được GHIM, chứ không chỉ được viết:** `Set_AfterTheFileIsMerelyReformatted_IsAlsoRefused_AndThatIsTheAcceptedPrice`
> (bài **[Fact] duy nhất được THÊM** trong nhiệm vụ này, `EXPECT_EDGECORE` 1152 → 1153, biện minh nằm
> ngay cạnh hằng số). Nó khẳng định rằng cùng một bộ cài đặt được **định dạng lại** cũng bị từ chối —
> tức **409 cho một vận hành viên không làm gì sai**. 🔴 **Vì sao đó là GIÁ chứ không phải KHUYẾT
> TẬT:** phép so duy nhất cho một lần định dạng lại đi lọt là phép so trên **bảng đã giải tuần tự**, và
> phép so ấy có **ÂM TÍNH GIẢ đúng ở ca mục 13 đóng** — `Load` **bỏ qua** entry có machine code rỗng và
> **gộp** khoá trùng, nên một file khôi phục mang một trong hai sẽ so **BẰNG** với bảng và bị ghi đè,
> im lặng, y như trước. Một lần định dạng lại bị từ chối tốn một `Reload`; một bản khôi phục bị ghi đè
> tốn cả bảng cài đặt.
>
> **Cùng chỗ đã cập nhật:** chú thích lớp của `OeeSettingsStore`, `HistorianEndpoints.PutOeeSettingsAsync`,
> và `docs/startup-failure-posture.md` §3.6 (trần thứ nhất **đóng**, trần thứ hai **giữ nguyên**, cộng
> phép suy cơ chế và giá).
>
> **CẶP ĐỐI CHỨNG ĐÃ CHẠY HAI PHÍA, VÀ THEO HAI CÁCH** (kết quả nguyên văn trong báo cáo AJ-1): (i)
> **`src/` của base `abc6f0ca` + `tests/` của HEAD** — hai bài **ĐỎ** ở base với *"No exception was
> thrown"*, tức `Set` **thành công và ghi đè**, đúng khuyết tật đang sống; **XANH** ở HEAD; (ii) vô hiệu
> hoá **đúng biểu thức** của arm mới trên cây HEAD ⇒ cùng hai bài đỏ, bật lại ⇒ 31/31.
> 🔴 **Vòng đầu của AJ-1 chỉ chạy (ii) và viết rằng (i) *"không dùng được"*; phản biện bác, và bác
> đúng** — `OeeSettingsWriteRefusedException` **đã có ở base**, nên cặp base/HEAD **có sẵn** và cái chặn
> nó chỉ là một chi tiết trong **cách viết bài kiểm**, không phải một tính chất của cây base. (i) trả
> lời *"bài này có bắt được khuyết tật ĐANG SỐNG không"*; (ii) chỉ trả lời *"bài này có phụ thuộc biểu
> thức này không"*. **Câu thứ nhất mới là câu được đòi.**

---

## 14. Hai hợp đồng đã xuất bản nói ngược nhau về hình dạng một hàng `Samples`; cái được CƯỠNG CHẾ lúc chạy hẹp hơn cái nền tảng tự XUẤT BẢN; và bộ phát của sản phẩm này phát một hình dạng cổng ingest TỪ CHỐI

> 📎 **Tiêu đề này, NGUYÊN VĂN, cho tới 2026-08-18 — RÚT cùng ngày (AA-1, vòng phản biện của vòng
> sửa):** *"14. Hai hợp đồng đã xuất bản nói ngược nhau về hình dạng một hàng `Samples`, MỘT trong hai
> được cưỡng chế lúc chạy, và bộ phát của chính sản phẩm này vi phạm nó"*. *"Vi phạm"* chỉ đúng **nếu**
> quy ước B đã là luật — mà đó chính là câu mục này tồn tại để hỏi. Câu thay thế là câu trung tính
> vốn đã có sẵn trong ô bảng phán quyết. Cùng lý do, hai cụm chữ nữa trong mục này được rút, ở §"hai
> quy ước" và ở cuối §"hợp nhất" bên dưới.

**Mục này sinh ra từ bản thi hành của mục 4, đúng như mục 8 sinh ra từ mục 1, mục 10 từ mục 5, và
mục 13 từ mục 11.** Nó được mở bởi **vòng phản biện 1 của AA-1 (2026-08-18)**, và nó là **điều kiện
"dừng và báo" mà brief của mục 4 đã đặt ra, xảy ra thật** — chỉ không trên trục brief dự đoán:
không phải **bộ sinh chống bộ sinh**, mà là **bộ sinh chống bộ TIÊU THỤ**.

🔴 **KHÔNG AI ĐƯỢC QUYẾT ĐIỀU NÀY NGOÀI CHỦ SỞ HỮU, và lý do giống hệt mục 3 và mục 4:** nó đổi
**hình dạng dữ liệu trên dây** mà **người ngoài tổ chức này đang dựa vào**. Uỷ quyền phủ được *"làm
hay không làm"*, **không phủ được sự đồng ý của bên thứ ba**.

### Đo được: hai quy ước, và chỉ một cái có bộ cưỡng chế

**Quy ước A — của sản phẩm này** (`tools/machine-simulator`), suy từ hai bộ sinh:
`RateHz` được đặt ⇒ hàng **một** phần tử, trục thời gian ngầm định; `RateHz` null ⇒ hàng **hai**
phần tử `[x, y]`. `WelderSim.BuildCurrentWaveform` và `ScrewdriveSim.BuildTorqueAngleWaveform` là
toàn bộ dân số, và cả hai theo nó. **Không gì cưỡng chế nó.**

**Quy ước B — của nền tảng**, và nó **được cưỡng chế lúc chạy**:

| chỗ | nó nói gì |
|---|---|
| `server/routers/machineApiRouters.ts` → `processWaveformSchema` — **bộ validate RUNTIME của route ingest** | `samples: z.array(z.tuple([z.number(), z.number()])).max(100_000)` — **mỗi hàng đúng HAI số**; `rateHz: z.number().positive().optional()` là một trường **độc lập**. Chú thích ngay trên: *"[t, value] pairs."* |
| `server/contracts/machineDataContract.ts` → `processWaveformV1` | cùng `z.tuple` hai số; *"Chuỗi mẫu [ [t, v], … ] — cặp (thời điểm, giá trị). Cap khớp runtime."* |
| `docs/ECOSYSTEM/57_ST4I_STANDARD_PROCESS_FEED_SPEC.md` §3.3 — **đặc tả dây đã xuất bản** | `samples` **bắt buộc**: *"Mảng cặp `[t, v]` — `t` = trục hoành (**thời gian giây / góc °**…), `v` = giá trị."* `rateHz`: *"Tần số lấy mẫu (Hz) **nếu đều nhau**"* — một **mô tả**, không phải bộ phân biệt. `unit`: *"Đơn vị của trục giá trị (`v`)"* |
| cùng file §8.1 — **ví dụ chuẩn tắc** | `torque_vs_angle`, `rateHz: 500`, `samples: [[0,0.02],[90,0.15],…,[412,0.82]]` — và `412` là chính metric `angle` của payload ấy, tức **trục hoành là GÓC trong khi `rateHz` được đặt** |
| `server/api/v1/openapi.ts` | `samples: array of array of number` — **không ràng buộc độ dài hàng** — 🔴 **hàng này nêu SAI artifact; xem §"chỗ lệch THỨ TƯ" bên dưới, RÚT 2026-08-18 (AB-1)** |
| `client/src/components/apiDocs/AutomationProcessFeedSection.tsx` | trang API-docs công khai: `{ name, unit?, rateHz?, samples:[[t,v]] }` |
| `server/contracts/machineDataContract.test.ts` | fixture: `rateHz: 1000` **kèm** hàng cặp |
| `scripts/sim/screwdriver-emitter.mjs` | bộ phát chạy được: `rateHz: WAVE_RATE_HZ` **kèm** hàng cặp |
| `docs/ECOSYSTEM/62_…_DESIGN_2026-07-18.md` §6 | `waveforms[]{name,unit,rateHz,samples[[t,v]]}` — 🔴 **chính tài liệu mà `WelderSim` tự trích trong doc comment lớp của nó** |

**Chúng bất đồng ở đúng một chỗ, và chỗ ấy là nơi hai quy ước cho KẾT QUẢ KHÁC NHAU:** dưới quy ước
B, `ScrewdriveSim` **hợp lệ** (nhờ `rateHz` là optional), còn `WelderSim` **không**.

> 📎 **Câu này đọc *"và chỗ ấy là **nơi sản phẩm này đứng sai**"* cho tới 2026-08-18, RÚT cùng ngày
> (AA-1, vòng phản biện của vòng sửa), giữ nguyên văn.** *"Đứng sai"* giả định B đã thắng.

🔴 **VÀ QUY ƯỚC B KHÔNG ĐỒNG NHẤT VỚI CHÍNH NÓ — đọc lại bảng ngay trên trước khi quyết.** Hàng
`server/api/v1/openapi.ts` ghi **không ràng buộc độ dài hàng**. Đó là **hợp đồng máy-đọc-được đã xuất
bản**, thứ một bên thứ ba sinh client từ đó. Nên:

- thứ **CƯỠNG CHẾ** (`z.tuple` hai số) **HẸP HƠN** thứ nền tảng **XUẤT BẢN** (OpenAPI cho phép hàng
  một phần tử);
- một payload hàng-một-phần-tử **hợp lệ với OpenAPI đã công bố** và **bị runtime từ chối**;
- và `server/contracts/machineDataContract.ts` **tự đặt cho mình đúng cái luật bị vi phạm ở đây**:
  *"Contract này PHẢI khớp runtime để APIdocs không mời gọi payload bị từ chối (doc 61 §4.8)."*

**Nên phép đo không nói "một bên sai".** Nó nói: **một sản phẩm và một nền tảng bất đồng, và nền
tảng bất đồng với chính nó ở BA mức** — runtime chặt, OpenAPI lỏng, đặc tả chặt. Cái phải quyết vì
thế **rộng hơn** *"đổi `WelderSim` hay đổi validator"*.

### Ở đâu: mắt xích đầy đủ, nêu tên từng cái

`WelderSim.BuildCurrentWaveform` (hàng một phần tử) → `Normalizer` (`payload["samples"] = w.Samples`,
chép nguyên) → `LiveTransport.SendProcessResultAsync` → `St4iDeviceClient.SubmitProcessResultAsync`
→ `POST /api/v1/ingest/process-result` → `processWaveformSchema`. Một `z.tuple` hai phần tử **từ
chối** một mảng một phần tử.

**Và `WELD-01` (`machineType: "WELDER"`) NẰM TRONG roster được ship** (`fleet.json`), nên đường này
**tồn tại trong bản cài mặc định**, không phải một nhánh giả định.

### ✅ ĐÃ ĐO 2026-08-18 (AB-1) — chỗ-thiếu bên dưới nay có một phép đo, và phép đo có HAI nửa

> 📎 **Mục con này mang tiêu đề *"🔴 Cái CHƯA ĐO, nêu tên chứ không lấp — và nó quyết định hậu quả
> là SỐNG hay chỉ là LÝ THUYẾT"* cho tới 2026-08-18, và thân của nó hỏi, NGUYÊN VĂN:** *"**Đã có sóng
> `weld_current` nào thực sự được POST lên một máy chủ sống bao giờ chưa?** Không ai đo điều đó —
> không phản biện, không AA-1. Không có bằng chứng runtime trong cây. Hôm nay đây là mâu thuẫn giữa
> **hai hợp đồng đã xuất bản trong một repository**, và nó **tiềm ẩn cho tới lần `LiveTransport`
> chạy thật đầu tiên với một máy WELDER**. Đo nó cần một log ingest thật hoặc một lần chạy thật;
> **cả hai đều nằm ngoài vòng này**, và một phỏng đoán đặt ở đây sẽ **đọc như một phép đo**."* Cùng
> với nó, đoạn *"Cái **đã** đo được, để không ai đọc câu trên rộng hơn nó: máy WELDER **có** trong
> roster ship; đường mã **có** thật và không có nhánh nào chặn; và transport thật (`LiveTransport`)
> là một trong ba chế độ (`Live`/`Demo`/`Auto`) mà `TransportCoordinator` chọn được."* — **RÚT
> 2026-08-18 (AB-1)**, và lý do là **phép đo đã chạy**, không phải câu ấy từng sai: nó mô tả đúng
> trạng thái hồ sơ cho tới đúng lúc ấy. Cụm *"trong một repository"* là chỗ **duy nhất** trong đoạn
> bị rút vì **sai**, không vì cũ — xem §"Nguồn của luật" bên dưới.
>
> 📎 **KIỂU BẢO TỒN CỦA AB-1, nêu một lần cho toàn bộ phần AB-1 viết:** đúng **MỘT** kiểu, và là
> kiểu mục này đang dùng — **TRÍCH NGUYÊN VĂN RỒI RÚT** trong khối 📎, kèm ngày và người rút, lý do
> đứng ngay cạnh. **AB-1 không dùng dấu gạch ngang ở bất kỳ chỗ nào.** Các `~~…~~` sẵn có trong file
> là của T-1, U-1, V-1 và Y-1; AB-1 **không đụng** tới chúng.

**Ngày đo:** **2026-08-18**, trên SYNAPSE **đang chạy** tại `http://localhost:3000` — **không** trên
một cây mã, mà trên **cổng ingest thật**.

🔴 **AI đo cái gì — ba hạng nguồn, phân biệt ngay ở đây chứ không ở một ledger bên ngoài.** Lý do
phân biệt nằm ở **đoạn mở đầu của chính file này**: các ledger dưới `.superpowers/sdd/` **bị
gitignore**, nên một lời cải chính cất ở đó **không bao giờ vào repo và chủ sở hữu không có đường dẫn
nào để mở**. Một khẳng định mà lời cải chính của nó nằm ngoài tầm với của người đọc là **đúng khuyết
tật file này lập ra để chấm dứt**, nên nó được viết vào đây:

| hạng | gồm những gì | ai đo |
|---|---|---|
| **AB-1 tự đo** | tài liệu OpenAPI **đang phục vụ** (một `GET` thuần đọc); `processWaveformSchema`; `processWaveformV1`; ba nguồn của cờ mặc định tắt; số dòng ở các cây; `git sparse-checkout list` | **AB-1**, 2026-08-18 |
| **NHẬN LẠI, không tự chạy** | **cặp đối chứng A/B** (payload, mã trạng thái, chuỗi lỗi, đường dẫn trường), **máy id 250**, khoá đã cấp, tiền tố **`mach_`** | **điều phối viên** đo; AB-1 **ghi lại, không chạy lại** |
| **chưa ai kiểm** | client sinh từ tài liệu đang phục vụ sẽ xử lý `items` dạng mảng ra sao; CSDL có thật sự trống bản ghi process-result hay không | **không ai** |

**Vì sao AB-1 không chạy lại cặp A/B, nêu ra để người sau khỏi đọc đó là cẩu thả:** chạy lại là
**ghi thêm vào SYNAPSE của chủ sở hữu** — thêm máy, thêm khoá, và có thể thêm bản ghi — trong một
nhiệm vụ được giao là **ghi hồ sơ**. Cái giá ấy cao hơn cái được. Nên hai dòng bảng dưới đây là
**bằng chứng động duy nhất của cả mục, và là hạng NHẬN LẠI**; mọi mảnh tĩnh quanh chúng thì AB-1 tự
đọc, và chúng **nhất quán** với hai kết quả ấy.

> 📎 **BA CÂU ĐÃ CÔNG BỐ Ở LẦN GHI ĐẦU CỦA MỤC NÀY (commit `f4b810b0`, 2026-08-18) NAY BỊ RÚT — giữ
> nguyên văn, cùng một kiểu bảo tồn, RÚT cùng ngày (AB-1, vòng sửa sau phản biện).** Cả ba là **một**
> khuyết tật: **một số liệu NHẬN LẠI được ghi như một số liệu TỰ ĐO**, và lời cải chính bị đặt ở một
> file `.superpowers/sdd/` **bị gitignore** — tức ngoài tầm với của chủ sở hữu. Liệt kê:
>
> 1. *"**Người đo, ngày đo, đo trên cái gì:** nhiệm vụ **AB-1**, **2026-08-18**, trên SYNAPSE **đang
>    chạy** tại `http://localhost:3000`…"* — gán **AB-1** làm người đo cho **cả** cặp A/B, thứ AB-1
>    **không chạy**. Thay bằng bảng ba hạng nguồn ngay trên.
> 2. Ô `kết quả` của **hàng B** trong bảng đối chứng: *"✅ **qua sạch lược đồ**, không một lỗi waveform
>    nào"*, dưới một cột chỉ tên là *"kết quả"*. Tách rời khỏi ngữ cảnh, nó đọc như *"B chạy được"*,
>    trong khi **B cũng bị từ chối**. Cột nay nói rõ nó chỉ ghi **bước lược đồ**, và hàng B mang thêm
>    chỗ nó thật sự dừng.
> 3. *"Hai POST thử đều BỊ TỪ CHỐI, nên **KHÔNG một bản ghi process-result nào được tạo**."* cùng vế
>    lặp lại của nó ở §"Bằng chứng động" — một **phủ định phổ quát về CSDL đang sống của chủ sở hữu**,
>    viết như một phép đo trong khi **không ai truy vấn CSDL**. Nay nêu đúng hạng: một **suy luận**,
>    kèm cơ sở và kèm cách kiểm dứt điểm.

**Chuẩn bị, ghi lại để chủ sở hữu GỠ ĐƯỢC và để phép đo LẶP LẠI ĐƯỢC:** một máy thử được đăng ký và
**chủ sở hữu duyệt** trên nền tảng đang chạy — id **250**, `serialNumber` `ST4I-TRIAL-WELD-20260818`,
code `SN-ST4I-TRIAL-WELD-20260818`, type `WELDER`, gắn station `SIM-L1-SPI-ST` / line `SIM-L1`; khoá
máy cấp qua `claim`. 🔴 **Hai POST thử đều BỊ TỪ CHỐI, và cả hai bị chặn TRƯỚC bước nạp** — nhánh A
ở bước lược đồ, nhánh B ở bước cờ.

🔴 **Từ đó suy ra "không bản ghi process-result nào được tạo" — và đây là một SUY LUẬN, không phải
một phép đo, nên nó được nêu đúng hạng của nó.** **Không ai truy vấn CSDL**: không đếm, không
`SELECT`, không đọc log ingest. Cơ sở của suy luận là thứ tự thi hành đo được ở dưới (cả hai nhánh
dừng trước **nạp**) cộng ba nguồn tài liệu nói nhánh cờ trả `PRECONDITION_FAILED`. **Cái duy nhất
kiểm được nó dứt điểm là một truy vấn trên CSDL của chủ sở hữu, và nhiệm vụ này không có quyền ấy.**
Nên khi gỡ, **hãy kiểm bằng một truy vấn** thay vì tin dòng này.

**Dấu vết còn lại trên SYNAPSE, liệt kê hết ở đây:** bản ghi **máy id 250** (đã duyệt), và **khoá
máy** cấp cho nó. Phép liệt kê ấy là nguồn — và nó cũng thuộc hạng **NHẬN LẠI**, không phải thứ AB-1
tự đọc trên nền tảng.

**Cặp đối chứng — khác nhau ĐÚNG MỘT BIẾN, và biến ấy là hình dạng hàng:**

🔴 **CẢ HAI NHÁNH TRẢ HTTP 400 — QUAN SÁT ĐƯỢC TRÊN CẢ HAI, không suy ra ở nhánh nào.** Mã trạng
thái **không** phải thứ phân biệt hai nhánh; **không POST nào tạo ra thứ gì**. Thứ phân biệt chúng là
**CHỖ CHÚNG DỪNG** — và chính chỗ chênh ấy là bằng chứng về **thứ tự thi hành**, chứ không phải con
số 400.

| nhánh | payload | mã trạng thái | **chỗ dừng** — cái thật sự phân biệt |
|---|---|---|---|
| **A** — `weld_current`, `rateHz: 1000`, hàng **một** phần tử `[176.5]` — **đúng cái `WelderSim` phát** | `POST /api/v1/ingest/process-result` | 🔴 **HTTP 400** | **chết ở KIỂM LƯỢC ĐỒ** — **ba** lỗi tại `waveforms.0.samples.0.1`, `.1.1`, `.2.1`, *"Invalid input: expected number, received undefined"*; **chưa bao giờ chạm tới cờ** |
| **B** — `torque_vs_angle`, **không** `rateHz`, hàng **hai** phần tử `[angle, torque]` — **đúng cái `ScrewdriveSim` phát** | cùng endpoint, cùng khoá | 🔴 **HTTP 400** | **QUA lược đồ** (không một lỗi waveform nào) rồi **chết ở CỜ TÍNH NĂNG** — `{"ok":false,"error":{"code":"ingest_failed","message":"Process result ingest is disabled on this server (PROCESS_RESULT_INGEST_ENABLED)."}}` |

**Vì sao bảng này mạnh hơn khi hai mã bằng nhau:** hai payload khác nhau **đúng một biến**, nhận
**cùng một mã**, mà **chết ở hai chỗ khác nhau**. Một mã trạng thái chung không phân biệt được gì; hai
chỗ dừng khác nhau thì phân biệt được **thứ tự các bước**. Nếu hàng B đọc như *"B chạy được"* thì bảng
mất đúng cái nó tồn tại để nói.

> 📎 **Khối này đọc, cho tới 2026-08-18 (đã công bố ở commit `e9a0e3f5`), NGUYÊN VĂN:** *"📎 **Một
> biên trên hàng B, nêu vì nó là chỗ dễ bịa ra một con số:** cái được đo và trao lại cho nhánh B là
> **thân phản hồi** (`ingest_failed`), **không phải dòng trạng thái**. Ba nguồn mà mục này trích cho
> cờ mặc định tắt đều ánh xạ trạng thái ấy sang **HTTP 400** (*"PRECONDITION_FAILED ⇒ REST trả 400
> `ingest_failed`"*), nên **400 là ánh xạ đã ghi trong tài liệu, không phải một quan sát riêng của
> phép đo này**. Điều **đã đo** ở hàng B là: **bị từ chối**, và **bị từ chối ở bước cờ chứ không ở
> bước lược đồ**."* — **RÚT 2026-08-18 (AB-1, vòng sửa thứ hai), giữ nguyên văn.**
>
> **Vì sao rút:** khối ấy đúng **về những gì AB-1 được trao**, và sai **về những gì đã được đo**. Một
> **dòng trạng thái quan sát được vẫn tồn tại suốt thời gian đó** — trong file đã lưu của lần chạy
> sạch, `item14-armA2.json` và `item14-armB2.json`, **cả hai kết thúc bằng `[HTTP 400]`**. Nên **400 ở
> hàng B là một QUAN SÁT, không phải một ánh xạ**, và khối cũ hạ nó xuống sai hạng.
>
> 🔴 **VÀ ĐÂY LÀ MỘT HÌNH DẠNG THẤT BẠI CHUỖI-GIÁM-HỘ KHÁC VỚI HÌNH DẠNG ĐÃ GHI Ở §"biên ba tầng" —
> nó đứng cạnh, không thay thế.** Hình dạng kia là *"một số liệu nhận lại được ghi như số liệu tự
> đo"*. Hình dạng này là: **phép đo CÓ TỒN TẠI, ở phía điều phối viên, suốt thời gian ấy, và KHÔNG
> ĐƯỢC CHUYỂN GIAO** — brief chỉ trao *"qua sạch lược đồ"* cho nhánh B, rồi vòng sửa lại trình bày
> `400` như một **suy luận** (*"nhánh cờ trả `PRECONDITION_FAILED` ⇒ B cũng là 400"*) trong khi bản
> gốc đang nằm trong tay người viết câu ấy. **Người ghi hồ sơ không thể phát hiện loại thiếu này từ
> bên trong** — không dấu vết nào của nó xuất hiện trong thứ họ được trao. Cái chặn được nó là **luật
> câu chữ**: từ chối viết một con số mình không có nguồn, khiến chỗ thiếu **phải lộ ra** ở phía giữ
> nguồn. Ghi lại vì lần sau chỗ thiếu có thể không lộ ra.

**Hạng nguồn của hai dòng này KHÔNG đổi: vẫn là NHẬN LẠI, AB-1 không tự chạy.** Cái đổi là chúng nay
mang **dòng trạng thái thật** thay cho một ánh xạ, và **nêu tên artefact** giữ nó: `item14-armA2.json`,
`item14-armB2.json`.

**Thứ tự thi hành, suy ra từ chính chỗ chênh ấy:** **xác thực → kiểm lược đồ → cờ tính năng → nạp.**
Nhánh A **chết ở bước lược đồ và chưa bao giờ chạm tới cờ**; nhánh B qua lược đồ rồi mới gặp cờ. Hai
nhánh **dừng ở hai chỗ khác nhau**, và chính chỗ chúng dừng là cái làm thứ tự này **đo được** thay vì
suy đoán được.

### 🔴 Hậu quả nay ĐANG SỐNG — và cái làm nó DỊU ĐI đứng ngay cạnh; nêu một nửa là nói sai

**Nửa làm nó nặng lên:** hậu quả **không còn là lý thuyết**. Một cổng ingest **đang chạy** từ chối
**đúng hình dạng `WelderSim` phát**, và từ chối ở **bước lược đồ** — trước cả cờ tính năng. Không cần
một lần `LiveTransport` chạy thật nữa để biết điều gì sẽ xảy ra: nó **vừa xảy ra**, có mã lỗi và có
đường dẫn trường.

**Nửa làm nó dịu đi, và nửa này cũng là một phép đo, không phải một lời an ủi:** cờ
**`PROCESS_RESULT_INGEST_ENABLED` mặc định TẮT**, nên **không một bản triển khai nào nạp
process-result trừ khi có người bật nó**. Nhánh B — nhánh **qua** được lược đồ — dừng đúng ở đó:
`{"code":"ingest_failed","message":"Process result ingest is disabled on this server (PROCESS_RESULT_INGEST_ENABLED)."}`
Đây là **quyết định thiết kế của nền tảng** (endpoint ship ở trạng thái tắt), **không** phải cấu hình
sai của một bản triển khai. **Phép liệt kê là nguồn, và con số đứng SAU nó, không đứng trước** — nó
được nêu ở những chỗ sau, mỗi chỗ ghim bằng một sha bất biến:

- `scripts/sim/screwdriver-emitter.mjs`, **dòng 18** tại `avi-aoi-sim@84836ad6` và tại
  `avi-aoi-management@f98f6146`/`@e9e1ea4c` — *"cờ master (mặc định OFF ⇒ endpoint ship dark…"*, vắt
  sang dòng 19;
- `examples/device-client/README.md`, **dòng 244** tại `avi-aoi-sim@84836ad6` — *"cổng
  `process-result` mặc định **OFF** (ships dark…)"*;
- `.env.example` — *"false (mặc định) = endpoint trả PRECONDITION_FAILED (ship-dark…)"*; **cố ý
  không gắn số dòng**, vì số ấy khác nhau giữa hai cây và **đã dịch một lần** trong ngày (xem
  §"Nguồn của luật").

**Đếm sau khi liệt kê: ba chỗ.**

🔴 **Hai nửa phải đọc CÙNG NHAU, và chúng không triệt tiêu nhau.** Nửa sau nói **hôm nay chưa ai mất
dữ liệu**; nó **không** nói hình dạng đã hợp lệ. Ngày ai đó bật cờ — và cờ tồn tại để được bật — nửa
trước là cái còn lại. Ngược lại, một hồ sơ chỉ nêu nửa trước sẽ **định giá quá cao mức khẩn cấp** của
một quyết định mà chủ sở hữu đang cân **cùng với** giá của việc đổi một bề mặt đã xuất bản.

### Ba chỗ lệch tài liệu ↔ thực tế — HAI chỗ đo được không cần khoá, chỗ thứ ba đòi một khoá (2026-08-18)

> 📎 **Tiêu đề này đọc *"Ba chỗ lệch tài liệu ↔ thực tế, đo được mà không cần khoá nào (AB-1,
> 2026-08-18)"* cho tới 2026-08-18, RÚT cùng ngày (AB-1, vòng sửa), giữ nguyên văn.** Nó **tự phủ
> định mục 3 nằm dưới nó**: nửa sau của chỗ lệch 3 — *"khoá thật sự được cấp mang `mach_`"* — **chỉ
> biết được bằng cách CẤP một khoá**, tức bước `claim`. Và nó gắn tên **AB-1** cho một tập gồm cả số
> liệu hạng **NHẬN LẠI** (xem bảng ba hạng nguồn ở §"ĐÃ ĐO").

Chúng là **đầu vào của quyết định**, không phải phần phụ lục: chúng cho thấy **nền tảng không tự đồng
ý với chính nó**, nên câu phải quyết **rộng hơn** *"sửa `WelderSim` hay sửa validator"*.

1. **Độ dài hàng — thứ được XUẤT BẢN lỏng hơn thứ được CƯỠNG CHẾ.** OpenAPI **đang phục vụ**
   (`GET /api/v1/openapi.json`, đọc 2026-08-18) khai
   `components.schemas.ProcessResultIngest.properties.waveforms.items.properties.samples` là một mảng
   có `items` **theo vị trí** — `[{number},{number}]` — **nhưng không `minItems`, không `maxItems`**.
   Không ràng buộc độ dài ⇒ một hàng **một** phần tử **thoả** hợp đồng máy-đọc-được đã xuất bản, trong
   khi `z.tuple` lúc chạy **từ chối** nó. Cùng tài liệu ấy tự khai `openapi: "3.0.3"`, và dạng mảng của
   `items` là dạng **OpenAPI 3.0.x không định nghĩa** (3.0 đòi `items` là **một** Schema Object).
   **Một client sinh từ tài liệu này sẽ làm gì với chỗ đó — CHƯA ĐO**, và nó không được đoán ở đây.
2. **Khoá đi ở đâu.** OpenAPI đang phục vụ khai `apiKey` là **một thuộc tính trong body** của
   `ProcessResultIngest` (`{"type":"string"}`); **server trả lời** rằng khoá phải đi ở header:
   *"Provide Authorization: Bearer &lt;key&gt; or X-API-Key."*
3. **Tiền tố khoá — và hai nửa của nó KHÔNG cùng một hạng nguồn.** *Nửa đầu, **AB-1 tự đo, không cần
   khoá*:* tài liệu và OpenAPI gọi khoá máy là **`mk_`**; quét toàn văn tài liệu đang phục vụ (đã
   tải về từ `GET /api/v1/openapi.json`, đếm chuỗi con trên chính file ấy) cho **`mk_` 5 lần** và
   **`mach_` 0 lần**. Phạm vi của phép quét ấy là **đúng một tài liệu**, và nó không phát biểu gì về
   phần còn lại của nền tảng. *Nửa sau, **hạng NHẬN LẠI, và đòi một khoá*:* khoá **thật sự được cấp**
   cho máy 250 mang tiền tố **`mach_`** — biết được **chỉ qua bước `claim`**, tức qua việc cấp thêm
   một khoá, nên **AB-1 không kiểm lại nửa này** và không ai khác kiểm nó mà không cấp thêm.

🔴 **Và một chỗ lệch THỨ TƯ, tìm thấy khi đối chiếu lại nguồn của bảng §"hai quy ước" — nó sửa một
hàng của chính bảng ấy.** Hàng `server/api/v1/openapi.ts` ghi *"`samples: array of array of number` —
**không ràng buộc độ dài hàng**"*. Đo lại: file ấy **không** xuất bản literal đó. Nó khai
`processResultIngestSchema` là bản **SINH RA từ hợp đồng Zod** `machineProcessResultContractV1`
(dòng **182–183**, qua `machineProcessContractJsonSchema(...)`), còn literal
`items: { type: "array", items: { type: "number" } }` ở **dòng 147** chỉ là bản **DỰ PHÒNG**
(`processResultIngestFallback`), dùng khi bản sinh trả null. Thứ nền tảng **thật sự phục vụ** là bản
sinh — cặp theo vị trí, không ràng buộc độ dài (mục **1** ngay trên).

**Chỗ điều này KHÔNG lật kết luận là chỗ đáng ghi nhất:** dưới **cả hai** cách đọc, một hàng **một**
phần tử **thoả** thứ được xuất bản — bản dự phòng vì hàng là mảng số **độ dài bất kỳ**, bản sinh vì
**không có `minItems`**. Nên *"xuất bản lỏng hơn cưỡng chế"* **đứng vững**; cái sai là **hàng bảng nêu
sai artifact**, và nó được **sửa tại chỗ, không xoá**.

> 📎 **Hàng bảng ấy giữ nguyên văn tại chỗ của nó** — *"`samples: array of array of number` — **không
> ràng buộc độ dài hàng**"* — **RÚT 2026-08-18 (AB-1)** với tư cách **mô tả thứ nền tảng xuất bản**.
> Nó **vẫn đúng** với tư cách mô tả **bản dự phòng** trong file ấy, nên phép rút chỉ chạm vào **vai
> trò** của câu, không chạm vào nội dung nó.

### Nguồn của luật: nêu ĐÚNG cây mã, và nêu cái mà dụng cụ trong repo này KHÔNG thấy

🔴 **Các đường `server/…`, `client/src/…`, `docs/ECOSYSTEM/…` và `scripts/sim/…` trong bảng trên
không được đọc như đường trong repo này.** Cây mã của **nền tảng đang chạy** nằm ở một repo khác:
**`D:\SOURCES\avi-aoi-management`** (nhánh `feat/hmi-dep`, đối chiếu tại `f98f6146` rồi kiểm lại tại
`e9e1ea4c`). Hai chỗ mang luật được đối chiếu lại ở đó 2026-08-18 và **khớp từng ký tự** với cái bảng
trên ghi, **trỏ bằng tên**: `server/routers/machineApiRouters.ts` → `processWaveformSchema`; và
`server/contracts/machineDataContract.ts` → `processWaveformV1` (bắt đầu ở **dòng 193** tại **cả ba**
sha `f98f6146`, `e9e1ea4c` và `avi-aoi-sim@84836ad6` — con số này **chưa** dịch, khác với khối kia).

🔴 **Trỏ bằng TÊN chứ không bằng số dòng — và lý do là một phép đo, đo được HAI lần, lần thứ hai bác
chính cách lần thứ nhất được viết ra.** Khối `processWaveformSchema` **giống hệt nhau từng ký tự** ở
các cây, nhưng **số dòng của nó thì không**, và **nó dịch trong chưa đầy một ngày**:

| cây, ghim bằng SHA BẤT BIẾN | dòng của `processWaveformSchema` |
|---|---|
| `avi-aoi-sim` @ `84836ad6` | **2610** |
| `avi-aoi-management` @ `f98f6146` | **2624** |
| `avi-aoi-management` @ `54c4cf46` và @ `e9e1ea4c` | **2650** |

Cùng loài, cùng ngày: cờ ingest nằm ở `.env.example` dòng **956** trong `avi-aoi-sim` @ `84836ad6`,
và ở `avi-aoi-management` nó **dịch từ 1100 sang 1121** trong cùng khoảng ấy. Cái đẩy khối đi được
nêu tên: commit **`2b732b99`** chạm vào `server/routers/machineApiRouters.ts`.

> 📎 **Đoạn này đọc, cho tới 2026-08-18:** *"**2610** trong cây `avi-aoi-sim` tại `HEAD`, **2624** tại
> `HEAD` của `avi-aoi-management`, **2650** trong **cây làm việc đang bẩn** của `avi-aoi-management`.
> Một trích dẫn theo số dòng chỉ có nghĩa khi **nêu kèm cây**, và số **2650 không lấy lại được từ một
> commit nào**."* — **RÚT cùng ngày (AB-1, vòng sửa), giữ nguyên văn.** Ba chỗ sai, và cả ba là **một**
> lỗi: **`HEAD` là một con trỏ DI ĐỘNG**, và ba con số được neo vào nó trong một repo **đang được
> commit**. (i) *"2650 không lấy lại được từ một commit nào"* là một **phủ định phổ quát ở thì hiện
> tại** — nó chết khi nội dung cây bẩn **được commit**, và **2650 nay là số dòng tại một cây SẠCH**.
> (ii) *"2624 tại `HEAD`"* — `HEAD` đã đi tiếp **hai lần** trong cùng ngày. (iii) *"nêu kèm cây"* là
> **chưa đủ**: phải nêu kèm **COMMIT**. 🔴 **Và chỗ đau là chỗ nó xảy ra: đây là đoạn DẠY rằng đừng
> trỏ bằng số dòng.** Nó vấp đúng luật nó phát biểu, nên nó ở lại đây làm nhân chứng.

🔴 **Hệ quả, và nó áp cho cả BẰNG CHỨNG chứ không chỉ cho LUẬT:** mọi số dòng trong mục này chỉ đọc
được **kèm một SHA bất biến**. Chỗ nào một cái tên tra được thì **cái tên là con trỏ**, không phải con
số: `processWaveformSchema`, `processWaveformV1`, `processResultIngestFallback`,
`machineProcessResultContractV1`, `machineProcessContractJsonSchema`. **Không ghim vào `HEAD` ở bất kỳ
đâu** — một lần nữa là một phép đo về thứ **còn đang chuyển động, đưa ra như thể nó đã dừng**.

🔴 **BIÊN IM LẶNG của mọi dụng cụ chạy trong repo này, và nó là lý do câu trên phải nói ra cách quét:**
cây làm việc của `avi-aoi-sim` là **SPARSE CHECKOUT**. `git sparse-checkout list` trả về **đúng hai**
đường — `tools/machine-simulator` và `examples/device-client`. **Mọi thứ ngoài hai đường ấy không nằm
trên đĩa**, nên **mọi `grep -r`, `ls`, hay phép quét theo file trong repo này bỏ sót chúng mà không
báo một lỗi nào**. Một **phủ định phổ quát** đo bằng những dụng cụ ấy chỉ phủ định **bên trong hai
đường trên**; ngoài hai đường ấy nó **không phát biểu gì**.

> 📎 **Câu này nêu ví dụ *"**`server/` và `web/` không nằm trên đĩa**"* cho tới 2026-08-18, RÚT cùng
> ngày (AB-1, vòng sửa), giữ nguyên văn.** **`web/` không tồn tại trong repo này** — `git ls-tree -r`
> cho **0** đường bắt đầu bằng `web/`. Thư mục anh em thật là **`client/`** (**711** file trong cây,
> vắng trên đĩa), và `client/` **chính là nơi chứa một artifact bảng §"hai quy ước" đang trích**:
> `client/src/components/apiDocs/AutomationProcessFeedSection.tsx`. Cùng loài và cũng vắng trên đĩa:
> `docs/`, `scripts/`, `contracts/`, `apidocs/` — **tất cả đều mang artifact mục này trích**. 🔴 **Một
> cái trần nêu quá nhỏ còn tệ hơn không nêu trần**, và ví dụ cũ nêu hai thư mục trong khi tập bị giấu
> là *"mọi thứ trừ hai đường sparse"*.

**Nhưng chúng KHÔNG vắng mặt khỏi repo này, và đây là chỗ dễ nói quá tay:**
`server/routers/machineApiRouters.ts`, `server/contracts/machineDataContract.ts`,
`docs/ECOSYSTEM/57_ST4I_STANDARD_PROCESS_FEED_SPEC.md` và `scripts/sim/screwdriver-emitter.mjs`
**đều có trong cây Git của `avi-aoi-sim`** — đọc được bằng `git show 84836ad6:` — chỉ **không được
materialise ra đĩa**. Nên hồ sơ trước **không đọc một file không tồn tại**; nó đọc **một bản sao nằm
trong repo khác với repo build ra máy chủ đang chạy**. Hai bản của `machineApiRouters.ts` **khác nhau
xét toàn file** và **trùng khít ở đúng khối mang luật** — đó là lý do kết luận cũ **đứng vững** *và*
nguồn **vẫn phải sửa**.

### 🔴 Biên của chuỗi giám hộ trong chính vòng này — MỘT LOÀI, BA TẦNG, để lại cho người sau

Mục này được viết qua ba tay, và **cả ba đều nhận lại ít nhất một con số thay vì tự đo nó**. Liệt kê
trước, không đếm trước:

- **AB-1** (người ghi mục này) nhận **cặp đối chứng A/B**, máy 250 và tiền tố `mach_` từ **điều phối
  viên**, và **không chạy lại** — lý do và cái giá nêu ở §"ĐÃ ĐO".
- **Vòng phản biện** của chính nhiệm vụ này **không chạy cổng** `verify-suites`; nó **nhận** các con
  số 2755 / 116 / 0-build-node từ điều phối viên, và **tự khai điều đó**, tự áp cùng một luật mà nó
  dùng để bắt lỗi AB-1.
- **Điều phối viên** là nguồn của cả hai, và **không phần nào của nó được đọc lại độc lập bên trong
  vòng này**.

**Đếm sau khi liệt kê: ba tầng, một loài.** Cái đáng để lại **không** phải "ai lười", mà là hình
dạng: **miền của một dụng cụ hẹp hơn miền của câu nói dùng nó**, và khi ba người nối tiếp nhau, các
biên ấy **chồng lên nhau chứ không triệt tiêu nhau**. Nên luật rút ra, viết ở đây vì đây là chỗ chủ
sở hữu mở được: **một hồ sơ phải nêu hạng nguồn của từng khẳng định NGAY TẠI CHỖ**, vì mọi chỗ cất
lời cải chính khác — báo cáo nhiệm vụ, ledger `.superpowers/sdd/` — **đều bị gitignore và không tới
được người đọc**.

🔴 **VÀ CÓ MỘT HÌNH DẠNG THỨ HAI, khác hẳn, phát hiện muộn hơn cả ba tầng trên — nó ĐỨNG CẠNH, không
thay thế.** Hình dạng trên là *"một số liệu **nhận lại** được ghi như số liệu **tự đo**"*: chỗ thiếu
nằm ở **nhãn**. Hình dạng thứ hai là *"một phép đo **CÓ TỒN TẠI** ở phía người giao việc, **suốt thời
gian ấy**, và **không được chuyển giao**"*: chỗ thiếu nằm ở **dữ liệu**, và nó **không để lại dấu vết
nào trong thứ người ghi hồ sơ được trao**. Ca cụ thể được ghi đầy đủ tại khối 📎 dưới bảng đối chứng
A/B — dòng trạng thái `[HTTP 400]` của **cả hai** nhánh nằm trong `item14-armA2.json` và
`item14-armB2.json` trong khi hồ sơ đang gọi con số ấy là một **ánh xạ suy ra**.

**Hai hình dạng đòi hai lớp phòng vệ khác nhau, và đó là lý do chúng phải đứng cạnh nhau:** hình dạng
thứ nhất **người ghi hồ sơ tự bắt được** — chỉ cần hỏi *"tôi có tự đọc thứ này không?"*. Hình dạng
thứ hai **không tự bắt được từ bên trong**: không câu hỏi nào về thứ mình đang cầm phát hiện được thứ
mình không được đưa. Cái chặn nó là **luật câu chữ**: **từ chối viết một con số mình không có nguồn**,
kể cả khi con số ấy gần như chắc chắn đúng — vì chính lời từ chối làm chỗ thiếu **lộ ra ở phía giữ
nguồn**. Ở vòng này nó lộ ra; **lần sau nó có thể không lộ ra**, và khi ấy hồ sơ sẽ mang một con số
suy luận đội lốt một phép đo.

### Câu *"cái sai là chú thích SDK"*: phép đo nói ngược **đối với bộ cưỡng chế lúc chạy** — và chỗ nó còn đứng được NÊU TÊN

Phép đo phát biểu về **bộ validate lúc chạy**: chú thích SDK `[[t, v], …]` mô tả **đúng hình dạng
nhánh B**, tức đúng hình dạng cổng ingest **nhận**; hình dạng `WelderSim` phát là hình dạng **bị từ
chối**. Nên câu cũ — *"cái sai không phải hai producer, là chú thích trong SDK"* — **bị phép đo bác**,
đọc theo bộ cưỡng chế lúc chạy.

🔴 **Và phát biểu dừng ở đó, vì đi xa hơn một bước là dựng lại đúng câu vòng trước đã rút.** Cùng phép
đo ấy, đối với **hợp đồng OpenAPI mà nền tảng tự xuất bản**, hàng một phần tử **không** nằm ngoài hợp
đồng (§"ba chỗ lệch", mục 1). Vậy phát biểu đúng là: *"chú thích SDK khớp **bộ cưỡng chế lúc chạy**,
và hình dạng `WelderSim` phát không khớp **bộ ấy**"* — và nó **thôi đúng** ngay khi bỏ chữ *"lúc
chạy"* đi. Blockquote đã rút ở §"hợp nhất" bên dưới bị rút **đúng vì** lý do này, nên nó không được
viết lại ở đây dưới vật liệu mới.

**Câu cũ còn đứng ở đâu — nêu tên chứ không lấp:** trong **mục 4**, ba chỗ. *"Nên cái sai không phải
hai producer — là chú thích trong SDK."* và *"nêu tên chú thích SDK là **đã biết sai**"* nằm trong
khối **PHÁN QUYẾT 2026-08-16 của chính chủ sở hữu**; *"**CHÚ THÍCH SDK ĐƯỢC NÊU TÊN LÀ ĐÃ BIẾT SAI**"*
nằm trong ghi chép thi hành của **AA-1**. 🔴 **AB-1 không sửa một chữ nào trong mục 4.** Hai chỗ đầu
nằm trong phán quyết của chủ sở hữu, và rút một câu ở đó là **quyết thay họ** — đúng thứ nhiệm vụ này
bị cấm. Chúng được **nêu tên tại đây** để người đọc mục 4 tìm được phép đo bác chúng; ô mục 4 của bảng
phán quyết đầu file đã trỏ sang mục 14 từ trước.

### Hợp nhất vào đây: phát hiện §8.1 của chính AA-1, nay đọc NGƯỢC hẳn

AA-1 tìm ra và gọi là *"nặng hơn nhiều"* — và nó **vẫn nặng**, nhưng theo chiều ngược lại:

- `[[t, v], ...]` cũng nằm trong **SDK Python** (`examples/device-client/python/st4i_device_client.py`,
  **hai chỗ**), không chỉ trong client C#;
- **ba ví dụ CHẠY ĐƯỢC** — `examples/device-client/csharp/ExampleScrewdriver.cs`,
  `examples/device-client/python/example_screwdriver.py`, `examples/device-client/README.md` — đều
  gửi `rateHz` **kèm** hàng hai phần tử, phần tử 0 là **góc**.

AA-1 kết luận chúng là **bản sao lỗi**. **Sai.** Chúng **khớp đặc tả 57 §8.1 từng con số** (kể cả
`rateHz: 500` và `412`). Nên câu hỏi AA-1 đặt — *"ai sửa họ SDK, và bao giờ?"* — có một câu chị em,
và mục này **ghi nó xuống chứ không trả lời**: **họ SDK không phải một bản sao lỗi cần chữa; chúng
là ba bản cài đặt của đặc tả, và bất kỳ lối ra nào đổi đặc tả cũng phải đổi cả ba cùng nhau.**

> 📎 **Chỗ này là một blockquote in đậm đứng riêng, đọc: *"Họ SDK khớp đặc tả. Cái lệch là bộ phát
> của chúng ta."* — RÚT 2026-08-18 (AA-1, vòng phản biện của vòng sửa), giữ nguyên văn.** Nó là câu
> **nghiêng nhất** trong cả mục: một khuyến nghị chọn B, đặt ở chỗ mắt người đọc dừng lại, trong một
> mục mà chủ sở hữu mở ra để **quyết**. Và **chính bảng phía trên bác nó**: OpenAPI đã xuất bản của
> nền tảng **cho phép** hàng một phần tử, nên *"cái lệch là bộ phát của chúng ta"* đúng với **bộ
> validate lúc chạy** và **sai với hợp đồng nền tảng tự công bố**. Phát biểu đúng là phát biểu hai
> chiều ở §"quy ước B không đồng nhất" bên trên.

### Hậu quả vận hành, hai chiều, phải nói cả hai

- **Nếu quy ước B là chuẩn:** `WelderSim` phải đổi sang hàng `[t, current]`. Đó là **đổi một payload
  đã xuất bản** của sản phẩm này — cùng hạng thay đổi mà mục 3 và mục 4 dành riêng cho chủ sở hữu.
- **Nếu quy ước A là chuẩn:** `processWaveformSchema`, `processWaveformV1`, đặc tả 57, OpenAPI, trang
  API-docs, doc 62 §6, và **cả ba ví dụ SDK** phải đổi. Đó là **đổi một hợp đồng ingest đã xuất bản**
  mà **mọi driver bên thứ ba đang viết theo**, và nó **nới** một validator (nới thì payload cũ vẫn
  chạy, nhưng ba bản dịch SDK phải đi cùng nhau).
- **Một khả năng thứ ba, nêu ra vì bảng lựa chọn của mục 12 đã bị bắt vì nêu thiếu:** cả hai cùng
  đúng ở **hai lớp khác nhau** — kiểu trong-tiến-trình cho phép cả hai, và **chỉ đường dây** ép cặp.
  Nếu vậy thì cái phải đổi là `Normalizer`, không phải `WelderSim`. **Chưa đo, và không quyết ở đây.**

### ✅ KHẢ NĂNG THỨ BA ĐÃ ĐO 2026-08-19 (AI-1) — nó KHẢ THI, và nó KHÔNG nằm trọn ở MỘT đường dây

> 📎 **Cụm *"Chưa đo, và không quyết ở đây."* ở gạch đầu dòng ngay trên giữ NGUYÊN VĂN tại chỗ của
> nó, và nửa đầu — *"Chưa đo"* — được **RÚT 2026-08-19 (AI-1)**.** Lý do là **phép đo đã chạy**,
> không phải câu ấy từng sai: nó mô tả đúng trạng thái hồ sơ cho tới đúng lúc ấy. Nửa sau —
> *"và không quyết ở đây"* — **KHÔNG rút và vẫn đúng**: mục này vẫn `🔴 CHỜ ANH`, ba lựa chọn vẫn
> chưa quyết, và phần dưới đây **không khuyến nghị lựa chọn nào**.
>
> 📎 **KIỂU BẢO TỒN CỦA AI-1, nêu một lần cho toàn bộ phần AI-1 viết trong file này (mục 9, 13, 14):**
> đúng **MỘT** kiểu, và là kiểu AB-1 đã lập — **TRÍCH NGUYÊN VĂN RỒI RÚT** trong khối 📎, kèm ngày và
> người rút, lý do đứng ngay cạnh. **AI-1 không dùng dấu gạch ngang ở bất kỳ chỗ nào**, không xoá một
> dòng nào, và không đụng tới các `~~…~~` sẵn có (của T-1, U-1, V-1, Y-1).

**Người đo, ngày, cây, SHA:** **AI-1**, **2026-08-19**, cây `avi-aoi-sim` ghim tại **`f08cb379`**
(commit bất biến, không phải `HEAD`). **Tất cả bốn phép đo dưới đây là AB-1-hạng "tự đo"** — đọc trên
mã, không nhận lại từ ai, không chạy cổng nào, không chạm nền tảng.

🔴 **MIỀN CỦA PHÉP QUÉT, nêu TRƯỚC mọi con số, vì đợt 5 vừa trả giá cho một phép LẤY MẪU mặc áo một
phép KIỂM ĐẾM.** Cây làm việc là **sparse checkout** và `git grep` thường **chỉ thấy đĩa**. Nên mọi
phép kiểm đếm dưới đây chạy bằng **`git grep <mẫu> f08cb379 -- .`** — quét **toàn bộ cây Git tại
commit ấy**, kể cả `server/`, `client/`, `docs/ECOSYSTEM/`, `scripts/`, `drizzle/`, `web/` là những
đường **không nằm trên đĩa**. **Cái phép quét ấy KHÔNG phủ:** việc chưa commit, nhánh khác, cây nền
tảng `D:\SOURCES\avi-aoi-management`, và bất kỳ người tiêu thụ nào **ngoài repo này**.

**(1) `Normalizer` CÓ đủ thông tin để dựng cặp — nêu tên chỗ, không nêu số dòng.**
`Normalizer.NormalizeProcessResult` dựng entry waveform trong **một** phép chiếu `Select` trên
`r.Waveforms`, ở đó `w.RateHz` và `w.Samples` **cùng trong tầm**, và câu gán là
`["samples"] = w.Samples` — **chép nguyên tham chiếu, không sao chép**. Dựng `[i / RateHz, v]` chỉ
cần **thêm một phép chiếu có chỉ số bên trong**, trên dữ liệu đã có trong tay. **Khả thi: CÓ.**

🔴 **(1b) VÀ `t = i / RateHz` KHÔNG BẰNG cái `t` mà `WelderSim` VẼ ĐƯỜNG CONG LÊN — đây là kết quả
bất tiện, nên nó được nêu chứ không lấp.** `WelderSim.BuildCurrentWaveform` đặt mẫu `i` tại
`i / (WaveformPoints - 1)` của thời lượng hàn (biến `t` nội bộ của nó, chuẩn hoá 0…1 **bao gồm cả
hai đầu**), trong khi `rateHz` nó phát ra là `WaveformPoints / thời_lượng`, tức `i / RateHz` đặt mẫu
`i` tại `i / WaveformPoints` của thời lượng. **Hai cái chỉ trùng ở `i = 0`.** Với
`WaveformPoints = 24`, trục thời gian dựng lại **co lại 23/24 ≈ 4,17 %**; ở mẫu cuối chênh **đúng một
chu kỳ lấy mẫu** (≈ 5 ms trên một mối hàn 120 ms). **Không cái nào trong hai cái này là "sai" cho tới
khi có người quyết `rateHz` NGHĨA LÀ GÌ** — và assertion đang giữ quan hệ ấy được **nêu tên**:
`WaveformSeriesRowShapeContractTests.TheTwoBuiltInProducers_SitOnOppositeSidesOfTheRateHzSplit_AndElementZeroIsAnAngleNotATime`
khẳng định `Samples.Count / RateHz` **bằng** `weld_time` giây, tức quy ước *"N mẫu chiếm N chu kỳ"* —
tự nhất quán, và **khác** với quy ước bộ sinh dùng để vẽ. **AI-1 không sửa một dòng nào của cả hai.**

**BÁN KÍNH của chỗ lệch ấy, nêu vì thiếu nó thì câu trên đọc rộng hơn cái nó nói — HAI điều kiện, và
lần ghi đầu chỉ nêu một:** (i) **chưa ai quyết `rateHz` NGHĨA LÀ GÌ**, nên chưa quy ước nào là "sai" —
đã nêu ở trên; (ii) 🔴 **`WelderSim` là một BỘ MÔ PHỎNG.** Bán kính của 4,17 % là **dữ liệu demo/trưng
bày do sản phẩm này tự sinh**, **không** phải dữ liệu quy trình của một khách hàng. Nó vẫn là **một sự
thật về PAYLOAD** — một người tiêu thụ dựng lại `t = i/rateHz` sẽ đặt mẫu cuối lệch một chu kỳ lấy mẫu
— nhưng payload ấy chở số liệu mô phỏng. **Cả hai điều kiện phải đọc cùng nhau.**

**(2) Phép chuyển KHÔNG nằm trọn ở MỘT ranh giới — nó nằm ở MỘT CHỖ TRONG MÃ nhưng chạm BA bề mặt
đi ra. Liệt kê trước, đếm sau.** `EdgePipeline.RunAsync` gọi `Normalizer.Normalize` **một lần**, rồi
trao **cùng một `CanonicalEnvelope`** cho:

1. `IUnsPublisher.PublishReading(reading, env)` — `UnsPublisher.PublishReadingCoreAsync` **tuần tự hoá
   NGUYÊN VẸN envelope ấy thành JSON** và publish làm **gương ngữ nghĩa RETAINED** trên topic `syn/…`.
   Đây là **một bề mặt MQTT đã xuất bản**, cùng hạng bề mặt mà **mục 3** dành riêng cho chủ sở hữu.
   Nó cũng đi tiếp vào `UnsBridge`/`BridgeSpool`, tức **xuống đĩa**.
   🔴 **CÓ AI ĐANG ĐĂNG KÝ HAY KHÔNG — CHƯA ĐO, và không đo được từ repo này.** Cái **đo được** là
   **hợp đồng nói gì**: doc comment của `DeviceReading.Kind` viết rằng giá trị ấy đi tiếp *"as an
   aspect segment of the retained MQTT topic, whose subscribers are outside this repository
   altogether"* — tức **hợp đồng TỰ KHAI rằng người đăng ký nằm ngoài repo này**. Đó là một phát biểu
   **của tài liệu**, không phải một phép **đếm người đăng ký**;
2. `ITransport.SendAsync(env)` → `LiveTransport.SendProcessResultAsync` → `ReadWaveforms(d)` →
   `ReadSampleSeries(d)` → DTO `Waveform` của SDK → `POST /api/v1/ingest/process-result`. Đây là bề
   mặt mà cả mục này nói tới;
3. hàng đợi **store-and-forward của chính SDK**, nằm sau (2) — `St4iDeviceClient._queuePath` +
   `Enqueue`, một file **JSONL** mà mỗi dòng là `{kind, path, payload, queuedAt}` ghi bằng
   `File.AppendAllText`. Tức **nguyên payload, gồm cả `samples`, được ghi XUỐNG ĐĨA** khi mạng hỏng và
   **phát lại sau**. **Riêng tư, không phải hợp đồng đã xuất bản** — nhưng một hàng đợi ghi lúc quy ước
   cũ còn hiệu lực sẽ **phát lại hình dạng cũ** sau khi mã đã đổi, và **không ai đo cửa sổ ấy**.

> 📎 **RÚT MỘT NỬA, 2026-08-20 (AO-1) — trích nguyên văn, không xoá dòng nào, không gạch ngang, và
> KHÔNG một chữ nào khác của mục 14 bị đụng tới.** Mục này ở **Phần III**, đã thi hành; luật của file
> là **rút được, xoá thì không**. Câu bị đụng tới, nguyên văn, là cụm **"NGƯỜI ĐĂNG KÝ CHƯA ĐO và
> không đo được từ repo này"** — nó đứng **hai lần trong ô mục 14 của bảng phán quyết** và một lần ở
> đoạn ngay trên đây. **Khối này chi phối cả ba, và tách chúng ra vì hai nửa có số phận khác nhau.**
>
> 🔴 **NỬA BỊ BÁC — chỉ với HỢP ĐỒNG INGEST HTTP (bề mặt (2)).** Lần xuất hiện thứ ba trong ô bảng
> phán quyết kéo cụm ấy theo sau **CẢ HAI** bề mặt đã xuất bản (*"payload ingest HTTP **và** gương
> ngữ nghĩa MQTT retained `syn/…`"*). Với nửa HTTP, **"không đo được từ repo này" là SAI, và luôn
> luôn sai**: mã của chính bên tiêu thụ nằm **trong commit này**. `server/contracts/machineDataContract.ts`
> khai `rateHz: z.number().positive().optional()` và
> `samples: z.array(z.tuple([z.number(), z.number()])).max(100_000)`; cùng hình dạng lặp lại ở
> `server/services/processResultService.ts`, `server/api/v1/openapi.ts`,
> `server/routers/machineApiRouters.ts`, `server/contracts/machineDataContract.test.ts` và
> `client/src/components/apiDocs/AutomationProcessFeedSection.tsx`. **Thứ làm nó TRÔNG như không đo
> được là một `pathspec`**, không phải một tính chất của repo — xem **mục 32**.
>
> 🔴 **Và nửa bị bác ấy đọc theo chiều THUẬN cho phán quyết, không phải chiều nghịch:** hợp đồng bên
> tiêu thụ là **cặp `[[t, v]]` VÀ `rateHz` đứng cạnh, tuỳ chọn** — **đúng** thứ `Normalizer` phát ra
> sau AK-1. Nên **lựa chọn 3 nay được xác nhận bằng KIỂU TĨNH của bên tiêu thụ**, mạnh hơn hẳn bằng
> chứng mà mục này từng có (một cú POST trực tiếp vào cổng đang chạy). **Cái sai là cái TRẦN, không
> phải phán quyết.**
>
> ✅ **NỬA CÒN ĐỨNG, và nó không được rút: NGƯỜI ĐĂNG KÝ GƯƠNG MQTT RETAINED (bề mặt (1)) VẪN CHƯA
> ĐO.** Đoạn ngay trên đây — *"CÓ AI ĐANG ĐĂNG KÝ HAY KHÔNG — CHƯA ĐO"* — nói về **đúng bề mặt ấy**
> và **giữ nguyên hiệu lực**. Đã mở tới đâu, ghi ra chứ không lấp: **37** file dưới `server/` +
> `client/` nhắc chuỗi `syn/`, và **chưa file nào được chứng minh là một người ĐĂNG KÝ**; các lần
> xuất hiện của `retained` đã mở ra đều là chuyện khác (leo thang cảnh báo, chú thích UI).
> 🔴 **Nhiệm vụ này CỐ Ý KHÔNG đo nốt** — đó là một mục cần mở, không phải một chướng ngại phải dọn
> trên đường, và đo dở dang rồi ghi thành "đã đo" là đúng khuyết tật file này lập ra để chấm dứt.

**Đếm sau khi liệt kê: BA bề mặt đi ra, MỘT chỗ trong mã.** `DemoTransport` **không** đọc `waveforms`
(nó chỉ đọc `Payload["samples"]` của nhánh **telemetry**), nên nó không phải bề mặt thứ tư.

**Và tập chỗ gọi `Normalizer.Normalize` phải nêu ĐỦ trước khi con số trên có nghĩa.** Quét
`git grep -n "Normalizer\.Normalize" f08cb379 -- tools/machine-simulator/src` cho **BỐN** chỗ:
`EdgePipeline.RunAsync` (**đường sản phẩm**, chỗ ba bề mặt trên treo vào) và **ba** chỗ trong
`St4iMachineSimulator/App.xaml.cs` — bộ **smoke test live** của ứng dụng desktop, mỗi chỗ một bộ sinh:
`RunResultSmoke` dùng **`ScrewdriveSim`**, nhánh telemetry dùng **`IotSensorSim`**, nhánh giám định
dùng **`AoiInspectorSim`**; cả ba đi qua **cùng** `Normalizer` rồi `LiveTransport`. **Đếm: BỐN chỗ
gọi, MỘT là đường sản phẩm, BA là dụng cụ chẩn đoán.** Ba chỗ sau **cũng** đổi theo nếu phép chuyển
được đặt ở `Normalizer`, nhưng chúng **không** đi qua `UnsPublisher` nên chỉ chạm **một** bề mặt.
🔴 **Và không chỗ nào trong ba dùng `WelderSim`**, nên **không một đường smoke nào mang hình dạng hàng
đang tranh chấp** — tức bộ smoke live của desktop **không phải** một nhân chứng cho mục này, và không
được đọc như một.

🔴 **Câu quyết định, trả lời đúng như nó được hỏi:** `WaveformSeries` **KHÔNG phải đổi**, `WelderSim`
**KHÔNG phải đổi** — cả hai đứng **thượng nguồn** của `Normalizer`. Nhưng *"chỉ payload đi ra đổi"*
**là SAI nếu đọc là một payload**: gương ngữ nghĩa retained đổi **cùng lúc**, và nó là **bề mặt đã
xuất bản thứ hai**. Một phép chuyển đặt ở `Normalizer` **không tách được hai cái ấy** ở chỗ ấy.

🔴 **VÀ CÂU TRÊN MỘT MÌNH THÌ VẪN LỆCH, VÌ NÓ KHÔNG XẾP HẠNG LẠI — đây là chỗ dễ đọc sai nhất của cả
mục, nên nó được viết ra thay vì để tự suy.** `Normalizer` **chép tham chiếu** `w.Samples`, và **cùng
một envelope** đi vào **cả** gương retained **lẫn** đường HTTP. Nên giá "bề mặt xuất bản thứ hai"
**KHÔNG phải giá riêng của lựa chọn 3**:

| lựa chọn | gương MQTT retained `syn/…` | payload ingest HTTP | trong cây này | **ngoài cây này** |
|---|---|---|---|---|
| **1 — đổi `WelderSim`** | **ĐỔI** | ĐỔI | `WelderSim` đổi; `WaveformSeriesRowShapeContractTests` **ĐỎ** | payload đã xuất bản của sản phẩm này |
| **2 — đổi bộ cưỡng chế nền tảng** | **không đổi** | không đổi | **không một dòng nào** | 🔴 `processWaveformSchema`, `processWaveformV1`, đặc tả 57, OpenAPI, trang API-docs, doc 62 §6, **và cả BA ví dụ SDK** — một **hợp đồng ingest đã xuất bản** mà **mọi driver bên thứ ba đang viết theo** |
| **3 — đổi `Normalizer`** | **ĐỔI** | ĐỔI | **`WaveformSeries` và `WelderSim` không đổi**; **KHÔNG bài nào đỏ** | payload đã xuất bản của sản phẩm này |

**Đọc bảng này theo hàng, không theo ô:** lựa chọn **1 trả ĐÚNG cái giá gương MQTT ấy, CỘNG THÊM**
phần của nó; lựa chọn **3 trả cùng giá gương nhưng không đụng hai kiểu**; lựa chọn **2 không trả giá
nào TRONG cây này**. 🔴 **Và đúng vì thế, cột cuối phải đọc cùng lúc, nếu không bảng vừa sửa xong một
thiên lệch đã dựng lên một cái ngược lại:** *"lựa chọn 2 không đổi gì"* chỉ đúng **cục bộ**; giá của
nó nằm **toàn bộ ở bên ngoài**, trên hợp đồng ingest đã xuất bản cộng ba bản dịch SDK phải đi cùng
nhau. **Một bảng chỉ có ba cột đầu sẽ đọc như một lời khuyên chọn (2).** Ở đây không có lời khuyên nào.

🔴 **Và một cổng KIỂU im lặng đứng ngay trên đường (2), nêu vì nó ăn mất dữ liệu mà không báo:**
`LiveTransport.ReadSampleSeries` nhận **một hàng khi và chỉ khi nó là `double[]`** (`if (point is
double[] arr)`), rồi **bỏ qua** mọi thứ khác **không lỗi, không log**. Phép chuyển giữ kiểu `double[]`
thì qua; một phép chuyển trả `List<double>`, `object[]` hay tuple thì **mọi mẫu biến mất im lặng** và
payload đi ra mang `samples: []`. **Đây là một ràng buộc thi hành đã đo, không phải một lời khuyên.**

🔴 **VÀ NÓ TIỀM ẨN, KHÔNG ĐANG SỐNG — nêu ra để câu trên không bị đọc thành một lỗi đang chảy hôm
nay.** `WaveformSeries.Samples` có kiểu **`IReadOnlyList<double[]>`** và `Normalizer` **chép tham
chiếu**, nên **theo hệ kiểu, mọi phần tử HÔM NAY là `double[]`**. **`samples: []` KHÔNG đang đi ra.**
Cổng kiểu ấy chỉ ăn mất dữ liệu **đúng vào lúc** ai đó viết một phép chuyển trả kiểu khác — tức
**đúng hình dạng mà một bản thi hành ngây thơ của lựa chọn 3 sẽ tạo ra**, và đó là lý do nó thuộc mục
này chứ không thuộc một mục riêng.

**(3) CÒN AI TIÊU THỤ `Waveforms` TRONG TIẾN TRÌNH — liệt kê trước, đếm sau.** Quét
`git grep -n "\.Waveforms" f08cb379 -- .` (toàn cây Git tại SHA). Trong `src/`, ngoài hai **bộ sinh**
(`WelderSim`, `ScrewdriveSim` — cả hai chỉ `Add`), có đúng bốn chỗ **ĐỌC**:

| # | chỗ đọc, trỏ bằng TÊN | nó đọc gì | thấy gì nếu phép chuyển đặt ở `Normalizer` |
|---|---|---|---|
| 1 | `Normalizer.NormalizeProcessResult` | `.Count`, rồi chép `w.Samples` | **chính nó là chỗ đổi** |
| 2 | `DeviceDriverConformanceSuite.HasAnyValueBearingContent` | **chỉ** `.Count > 0` | **không thấy gì** — thượng nguồn, và nó không đọc hàng |
| 3 | `DeviceReadingClone` (nhánh `Waveforms`) | sao chép sâu **từng hàng** | **không thấy gì** — thượng nguồn |
| 4 | `DeviceReadingEquality.CompareWaveform` | `Name`/`Unit`/`RateHz` + **từng phần tử** | **không thấy gì** — thượng nguồn |

**Đếm sau khi liệt kê: BỐN chỗ đọc trong `src/`, ba trong số đó ngoài `Normalizer`, và cả ba nằm
trong `St4i.Connector.Conformance`.** Cả ba làm việc trên `DeviceReading` — tức **trước** `Normalizer`
— nên **không cái nào quan sát được** phép chuyển. Phần còn lại của phép quét là **doc comment**
(`DeviceReading.cs`, `Enums.cs`, `DeviceDriverConformanceSuite.cs`) và **README** ×2, không phải chỗ đọc.

**(4) CÁI GÌ SẼ ĐỎ — đo bằng cách ĐỌC test, và câu trả lời là KHÔNG CÁI NÀO.** Quét
`git grep -iln "aveform" f08cb379 -- tools/machine-simulator/tests` trả về **đúng hai** file, và đó
là **toàn bộ** dân số test chạm tới waveform trong cây:

1. `tests/St4i.Connector.Abstractions.Tests/ConnectorRoundTripTests.cs` — round-trip của
   **`DeviceReading` qua `ConnectorJson`**;
2. `tests/St4i.EdgeCore.Tests/WaveformSeriesRowShapeContractTests.cs` — bốn `[Fact]`, tất cả gọi
   `sim.NextCycle(...)` và soi **`DeviceReading.Waveforms`**.

**Đếm sau khi liệt kê: HAI file, và cả HAI đứng thượng nguồn `Normalizer`.** Cộng thêm phép quét
`git grep -n '"waveforms"' f08cb379 -- tools/machine-simulator` và `'"samples"'`: **không một test
nào** khẳng định hình dạng `payload["waveforms"]` hay `payload["samples"]` của nhánh process-result —
`NormalizerTests.cs`, `LiveTransportTests.cs` và cả hai file test UNS **không chứa chữ "waveform"**.

🔴 **Nên phép đo cho ra một câu BẤT TIỆN, và nó là kết quả chứ không phải một chỗ trống:** đặt phép
chuyển ở ranh giới `Normalizer` khiến **không một bài kiểm nào trong 2763 bài đỏ lên** — kể cả nhân
chứng đợt 4 `WaveformSeriesRowShapeContractTests`, **vẫn xanh**, vì nó không nhìn xuống hạ nguồn.
**"Không gì đỏ" ở đây KHÔNG phải bằng chứng an toàn; nó là bằng chứng KHÔNG CÓ NHÂN CHỨNG.** Hai lối
ra đầu (đổi `WelderSim`, hay đổi validator) đều **có** nhân chứng đỏ lên; lối thứ ba **không có**, và
nếu nó được chọn thì nhân chứng cho nó là thứ **phải viết mới**.

**Cái phép đo này KHÔNG trả lời được, nêu tên chứ không lấp:**
- nó **không** nói quy ước nào **nên** thắng, và không nói lối ra nào rẻ hơn về mặt xã hội;
- nó **không** đo bên đăng ký MQTT: **ai đang đọc gương ngữ nghĩa retained `syn/…`, và họ sẽ thấy gì
  nếu hàng đổi hình dạng — CHƯA ĐO**, và không đo được từ trong repo này. Đó là cùng hạng người-ngoài
  mà mục 3 nói tới;
- nó **không** đo client sinh từ OpenAPI đang phục vụ (vẫn là ô *"chưa ai kiểm"* của bảng ba hạng nguồn);
- nó **không** chạy cổng ingest lần nào: **AI-1 không chạm nền tảng, không POST gì**, nên cặp đối
  chứng A/B của AB-1 vẫn là **bằng chứng động duy nhất** của mục này và hạng nguồn của nó **không đổi**.

### Nếu không quyết định

Giữ nguyên. `WelderSim` tiếp tục phát một hình dạng cổng ingest từ chối; không gì đỏ lên trong
`tools/machine-simulator` vì không phép kiểm nào của nó nhìn sang phía tiêu thụ.

> 📎 **Câu này kết bằng *"và lần chạy `Live` đầu tiên với một máy WELDER sẽ là lần đầu tiên ai đó
> biết — **nếu** nó xảy ra."* cho tới 2026-08-18, RÚT cùng ngày (AB-1), giữ nguyên văn.** Nó đã sai
> **đúng lúc phép đo chạy**: không cần một lần `Live` nào nữa, và *"ai đó"* đã biết — bằng HTTP 400
> với ba đường dẫn trường, ghi ở §"ĐÃ ĐO" bên trên.

**Cái thay vào chỗ ấy, và nó là hai vế:** hôm nay **không bản triển khai nào nạp process-result**,
vì cờ `PROCESS_RESULT_INGEST_ENABLED` **mặc định tắt**; nên "không quyết định" **không** để lại một
đường mất dữ liệu đang chảy. Cái nó để lại là **một hình dạng đã xuất bản mà cổng đã xuất bản từ
chối**, nằm im cho tới **ngày ai đó bật cờ** — và cờ tồn tại để được bật.

### Vì sao là quyết định của chủ sở hữu

Cả hai lối ra **đổi một bề mặt đã xuất bản mà người ngoài đang dựa vào** — hoặc payload của sản phẩm
này, hoặc hợp đồng ingest cộng ba SDK anh em. Đúng lý do mục 3 và mục 4 là của chủ sở hữu.

### Bằng chứng — nay có HAI loại: loại đọc được, và loại chỉ có khi CHẠY

> 📎 **Tiêu đề mục con này đọc *"Bằng chứng — đọc được, không cần chạy"* cho tới 2026-08-18, RÚT
> cùng ngày (AB-1), giữ nguyên văn.** Nó đúng khi cả mục chỉ có bằng chứng tĩnh; phép đo 2026-08-18
> thêm một loại **không** đọc được từ cây mã — cặp đối chứng A/B trên cổng ingest đang chạy — nên
> tiêu đề cũ nay **hứa hẹn ít hơn** cái mục này mang.

> 📎 **Câu mở đầu đọc *"Các file nêu tên trong bảng trên, tại commit `84836ad6`."* cho tới 2026-08-18,
> RÚT cùng ngày (AB-1), giữ nguyên văn.** `84836ad6` là một commit của **repo này**, nhưng các hàng
> `server/…`, `client/src/…`, `docs/ECOSYSTEM/…` và `scripts/sim/…` của bảng ấy được đối chiếu ở
> **`D:\SOURCES\avi-aoi-management`** — **một cây khác** — nên một commit-id của `avi-aoi-sim` không
> định vị được chúng, và một số dòng đọc ở cây kia không tra lại được bằng nó.

**Bằng chứng tĩnh, nêu kèm cây:** các file nêu tên trong bảng trên. Phía nền tảng, đối chiếu tại
`D:\SOURCES\avi-aoi-management` nhánh `feat/hmi-dep` (2026-08-18), **trỏ bằng tên phần tử**:
`processWaveformSchema` và `processWaveformV1`. Cùng các file ấy **cũng có trong cây Git của repo
này** tại `84836ad6`, **không nằm trên đĩa** (sparse checkout) — xem §"Nguồn của luật".

**Bằng chứng động, chỉ có khi chạy — và nó là hạng NHẬN LẠI:** cặp đối chứng A/B ở §"ĐÃ ĐO", trên
SYNAPSE tại `http://localhost:3000`, 2026-08-18, máy thử id **250**. **Do điều phối viên đo; AB-1 ghi
lại chứ không chạy lại** (lý do nêu tại §"ĐÃ ĐO"). **Không có transcript của hai POST ấy trong repo
này**, nên chỗ này là điểm yếu nhất của chuỗi giám hộ trong cả mục, và nó được nói ra thay vì để người
đọc tự phát hiện. *"Không bản ghi process-result nào được tạo"* là **suy luận từ chỗ hai POST dừng**,
không phải một truy vấn CSDL.

📎 **MỞ RỘNG câu ngay trên, 2026-08-18 (AB-1, vòng sửa thứ hai) — câu ấy giữ nguyên văn vì nó KHÔNG
sai, chỉ thiếu.** *"Không có transcript … **trong repo này**"* vẫn đúng từng chữ. Cái nay biết thêm:
**transcript CÓ TỒN TẠI**, ở phía điều phối viên, và **được nêu tên** — `item14-armA2.json` và
`item14-armB2.json`, mỗi file kết thúc bằng dòng `[HTTP 400]`. Nên chuỗi giám hộ **chặt hơn** cái câu
trên mô tả: chủ sở hữu **hỏi được hai file ấy**, thay vì chỉ có lời khai. Đây là thao tác **MỞ RỘNG**
(phép liệt kê thiếu), **không** phải RÚT — ba thao tác vẫn phân biệt như file này quy định.

Phía sản phẩm:
`src/St4i.EdgeCore/Drivers/Simulators/WelderSim.cs`, `…/ScrewdriveSim.cs`,
`src/St4i.EdgeCore/Mapping/Normalizer.cs`, `src/St4i.EdgeCore/Transport/LiveTransport.cs`,
`tools/machine-simulator/fleet.json`. Nhân chứng đang giữ hành vi hiện tại (**không** giữ một phán
quyết): `tests/St4i.EdgeCore.Tests/WaveformSeriesRowShapeContractTests.cs` — nếu anh quyết theo quy
ước B, **nó đỏ lên, và chỗ đỏ chính là diff**, đúng hình dạng mà S-1 dùng cho mục 5 và V-1 cho mục 10.

> 📎 **Câu ngay trên giữ NGUYÊN VĂN và KHÔNG bị rút — nhưng nó dự đoán một lối ra KHÔNG được chọn, và
> điều đó phải đọc được ở đây chứ không chỉ ở khối phán quyết bên dưới (AK-1, 2026-08-19).** Chủ sở hữu
> chọn **lựa chọn 3**, không phải quy ước B: `WelderSim` **không đổi**, nên
> `WaveformSeriesRowShapeContractTests` **KHÔNG đỏ lên** và **vẫn xanh sau khi mục này đã thi hành**.
> 🔴 **Đó là im lặng, không phải chấp thuận** — bài ấy soi `DeviceReading.Waveforms`, tức **thượng
> nguồn** chỗ đổi, nên nó **không thể** quan sát phép chuyển dù phép chuyển có hay không. Chính vì thế
> lựa chọn 3 **phải mang theo một nhân chứng MỚI**, và nó có: `WaveformPairAtTheWireBoundaryTests`.

> ### 🔨 PHÁN QUYẾT 2026-08-19 — **LỰA CHỌN 3: DỰNG CẶP `[t, v]` Ở RANH GIỚI `Normalizer`**
>
> **Chủ sở hữu quyết, 2026-08-19, sau khi đọc phép đo của AI-1 và bảng so sánh đã cân lại hai lần.**
> Cả hai quy ước **cùng đúng ở hai lớp khác nhau**: kiểu trong tiến trình cho phép cả hai, và **chỉ
> đường dây** ép cặp. Nên thứ phải đổi là **`Normalizer`**, không phải `WelderSim` và không phải bộ
> cưỡng chế của nền tảng.
>
> 🔴 **CÁI PHÁN QUYẾT NÀY CỐ Ý KHÔNG QUYẾT, ghi ra để không ai đọc rộng hơn nó:** nó **không** tuyên
> quy ước nào là chuẩn cho **hàng trong tiến trình**. `WaveformSeries` giữ nguyên hợp đồng của nó,
> `RateHz` vẫn là thứ hai bộ sinh của sản phẩm này tách trên, và mục 4 **không** bị quyết lại ở đây.
>
> 🔴 **GIÁ CHỦ SỞ HỮU ĐÃ CHẤP NHẬN, GHI VÀO MỤC, KHÔNG LÀM NHẸ ĐI — và nó là HAI bề mặt đã xuất bản,
> không một.** Cùng một envelope đi ra cả **payload ingest HTTP** lẫn **gương ngữ nghĩa MQTT retained
> `syn/…`**, nên gương ấy **đổi cùng lúc**, cùng hạng bề mặt mà **mục 3** dành riêng cho chủ sở hữu.
> **AI ĐANG ĐĂNG KÝ GƯƠNG ẤY — CHƯA ĐO, và không đo được từ trong repo này**; cái đo được là **hợp
> đồng TỰ KHAI** rằng người đăng ký nằm ngoài repo, và đó là lời của tài liệu, không phải một phép đếm
> người đăng ký. Phán quyết được ra **mà không có phép đếm ấy**.
>
> **Và một bề mặt thứ ba, riêng tư, cũng được chấp nhận cùng lúc:** hàng đợi store-and-forward của SDK
> ghi **nguyên payload xuống đĩa** (JSONL) và **phát lại sau**, nên một hàng đợi ghi trước lúc đổi sẽ
> **phát lại hình dạng CŨ sau khi mã đã đổi**. **Cửa sổ ấy dài bao lâu và tồn đọng bao nhiêu dòng —
> KHÔNG ĐO ĐƯỢC từ cây này**, và nó áp cho **cả ba** lựa chọn chứ không riêng lựa chọn 3.
>
> 📎 **MỞ RỘNG 2026-08-19 (AK-1) — đoạn ngay trên giữ NGUYÊN VĂN vì nó KHÔNG sai, nó THIẾU MỘT ĐƯỜNG,
> và đường thiếu ấy là đường có cái trần đo được.** Xem phép đo ở khối `✅ ĐÃ THI HÀNH` ngay dưới:
> **có HAI kho đệm trên đĩa phát lại hình dạng cũ, không phải một** — hàng đợi SDK (sau bề mặt HTTP)
> **và** `BridgeSpool` (sau **gương MQTT**). **Một phép liệt kê thiếu một hàng vẫn là một phép liệt kê
> thiếu**, và ở đây hàng thiếu là hàng **duy nhất** có chặn trên đọc được từ trong cây này.

> ### ✅ ĐÃ THI HÀNH — nhiệm vụ AK-1 (2026-08-19), `.superpowers/sdd/item14-option3/`
>
> 🔴 **CƠ CHẾ CỦA `t` ĐƯỢC **SUY**, KHÔNG PHẢI CHỌN — và hai ứng viên đều bảo vệ được, nên phải nói RÕ
> cái nào đã đi ra.** Cái đã đi ra là **thời điểm mà `rateHz` HÀM Ý**: `t(i) = i / rateHz`. Cái **không**
> đi ra là **thời điểm THẬT mà `WelderSim` vẽ đường cong lên**.
> * **Vì sao cái thứ nhất.** Ở ranh giới này, mọi thứ trong tầm là **bốn trường** của một
>   `WaveformSeries`. Dựng lại thời điểm thật đòi một thứ **thứ năm** — cách tham số hoá của chính bộ
>   sinh — thứ **không có trên hồ sơ**, **khác nhau theo từng driver**, và **vắng hẳn** với các driver
>   bên thứ ba mà `Normalizer` cũng phục vụ. `t = i / rateHz` là cách đọc **duy nhất** mà **nghĩa đã
>   xuất bản** của `rateHz` cho phép (đặc tả 57 §3.3: *"Tần số lấy mẫu (Hz) nếu đều nhau"*), và nó
>   **đã là** phép dựng lại mà repo này công bố cho bên tiêu thụ trên chính `WaveformSeries`.
> * 🔴 **Vì sao cái thứ hai bị bác, và đây là chỗ nó chạm điều kiện DỪNG.** Lấy thời điểm thật nghĩa là
>   đọc `rateHz` **không** như tần số lấy mẫu mà như *"N chia cho một khoảng bao gồm cả hai đầu"* — tức
>   **ĐỔI NGHĨA của `rateHz`**. Đó là **đổi payload**, thứ phán quyết này **không** phủ. Nhiệm vụ được
>   lệnh dừng-và-báo nếu bản sửa cần điều ấy; **nó không cần**, và lý do hai thứ **tách được** là:
>   `t = i / rateHz` dùng `rateHz` **đúng nghĩa đã xuất bản**, và `payload["rateHz"]` đi ra **không đổi
>   một chữ số**.
>
> 🔴 **NỬA BẤT LỢI, VIẾT NGAY CẠNH, VÌ MỘT SỰ THẬT VIẾT CHỈ THEO CHIỀU THUẬN LÀ MỘT NỬA SỰ THẬT.** Chỗ
> lệch **4,17 %** của `WelderSim` (§1b bên trên) **không được tạo ra** bởi phép chuyển này — nó đã ở
> trên dây từ trước, ngầm, vì một bên tiêu thụ tuân hợp đồng vẫn tính đúng cái `t` ấy từ cùng `rateHz`.
> **Nhưng phép chuyển KHÔNG trung tính:** nó đưa `t` từ **NGẦM ĐỊNH** (bên tiêu thụ tự tính, nên còn
> sửa được bằng cách công bố một cách đọc khác của `rateHz`) sang **ĐÃ VIẾT RA** (những con số cụ thể
> đã rời khỏi máy). Sau hôm nay, sửa chỗ lệch ấy là **đổi các con số đã xuất bản**, không còn là đổi
> một tài liệu. **Đó là một cánh cửa hẹp đi, và nó thuộc về bản sửa này chứ không thuộc khuyết tật cũ.**
>
> 📎 **CÂU *"nó đã ở trên dây từ trước, ngầm"* GIỮ NGUYÊN VĂN, RÚT MỘT PHẦN 2026-08-19 (AK-1, sau vòng
> phản biện): nó ĐÚNG cho MỘT bề mặt và được viết ĐỒNG NHẤT cho cả ba.** Kết luận (*"chi phí là MỚI và
> thuộc bản sửa này"*) **không đổi** — nhưng lý lẽ đỡ nó không đứng ở bề mặt quan trọng nhất, và khi
> tách ra thì **chi phí LỚN HƠN chứ không nhỏ hơn**. Viết lại **theo từng bề mặt**:
> * **Gương MQTT retained `syn/…` (và `BridgeSpool` nằm sau nó): CÂU ẤY ĐÚNG.** Envelope **đã** đi ra
>   với hàng một phần tử, không có bộ cưỡng chế nào chặn, nên một bên đăng ký dựng lại `t` theo tài liệu
>   đã đặt mẫu cuối lệch đúng 4,17 %. Ở đây chi phí đúng là **"ngầm → viết ra"**.
> * 🔴 **Ingest HTTP (và hàng đợi SDK nằm sau nó): CÂU ẤY SAI.** Hình dạng cũ **bị `processWaveformSchema`
>   TỪ CHỐI** (`z.tuple` hai số) — AB-1 **đo HTTP 400 thật** ở bước lược đồ. Nên ở bề mặt này **chưa
>   từng có bên tiêu thụ nào dựng lại `t` từ hàng một phần tử**: việc mà một bên *tuân hợp đồng* làm với
>   payload cũ là **TỪ CHỐI nó**. Bên được câu cũ mô tả là bên **tuân TÀI LIỆU trong khi vi phạm LƯỢC ĐỒ
>   ĐƯỢC CƯỠNG CHẾ** — hai thứ không thể là cùng một bên.
>
> 🔴 **Và đây là chi phí mà cách viết đồng nhất đã che mất:** sau AK-1, hàng cặp **lần đầu tiên hợp lược
> đồ** trên đường ingest. Nên một `t` lệch 4,17 % không chỉ *được viết ra* mà **lần đầu tiên trở nên KHẢ
> THI để được NHẬN và LƯU** vào cột `process_results.waveforms` — cột mà `drizzle/schema/process.ts`
> khai là `Array<[number, number]>`. Trước hôm nay đường ấy **không lưu gì**. **Nói cho đúng cả hai
> chiều, vì đây đúng là chỗ dễ nói quá tay:** *"khả thi"*, **không** phải *"đang xảy ra"* — cờ
> `PROCESS_RESULT_INGEST_ENABLED` **vẫn mặc định TẮT** và AK-1 **không** bật nó, nên hôm nay **vẫn
> không bản triển khai nào nạp**. Cái đổi là **ngày ai đó bật cờ, thứ được lưu sẽ là một trục thời gian
> lệch một chu kỳ lấy mẫu** — trước AK-1, ngày ấy chỉ cho ra **một lỗi 400**.
>
> **Ở đâu:** `src/St4i.EdgeCore/Mapping/Normalizer.cs` — **đúng một** chỗ gọi đổi
> (`["samples"] = ToWireSampleRows(w)`) và **một** phương thức **private** mới. Không có thành viên
> công khai nào được thêm, nên `EXPECT_WARNINGS` **631** và sổ mười sáu hàng **không dịch một đơn vị**.
> 🔴 **Con số 631 ở câu trên là giá trị lúc AK-1 chạy và đã CŨ** — AL-1 (đợt 6, 2026-08-20) đưa nó về
> **502**. Câu giữ nguyên văn: điều nó khẳng định — *AK-1 không làm dịch hằng số ấy* — vẫn đúng.
>
> 🔴 **VỊ TỪ CHUYỂN GÁC BẰNG **CẶP (có rate, hàng MỘT phần tử)**, không phải bằng *"có rate"* — và đó là
> chỗ chịu lực.** Một hàng **hai** phần tử **đã là** một cặp `[t, v]`: đặc tả 57 **§8.1**, ví dụ chuẩn
> tắc của chính nền tảng, mang `rateHz: 500` **bên cạnh** các hàng cặp mà phần tử 0 là **GÓC**. Gác bằng
> *"có rate"* sẽ **ghi đè trục hoành ấy bằng một thời gian suy từ chỉ số** — tức **phá dữ liệu thật**,
> đúng ở ca mà cả ba ví dụ SDK đang phát. Một hàng một phần tử **không có rate dùng được** cũng đi qua
> **nguyên vẹn**: không có gốc thời gian nào để suy, và bịa ra *"chỉ số làm thời gian"* là **xuất bản
> một con số không có đơn vị**.
>
> **Ràng buộc thi hành AI-1 đo, đã tuân:** `LiveTransport.ReadSampleSeries` giữ một hàng **khi và chỉ
> khi** nó là `double[]` và bỏ mọi thứ khác **không lỗi, không log**, nên phép chuyển trả `double[]`.
> **Nó được ĐO, không phải được tin:** một biến thể trả `List<double>` được dựng và chạy — payload trong
> bộ nhớ **trông đúng** trong khi thân request đi ra mang **`samples: []`**.
>
> 🔴 **VÀ ĐÂY LÀ MỘT SỰ KIỆN VỀ HAI BỀ MẶT MÀ CHƯA AI GHI: chúng HỎNG KHÁC NHAU dưới cùng một khuyết
> tật.** Dưới biến thể `List<double>` ấy, **sáu** trong bảy `[Fact]` mới đỏ — nhưng bài về **gương MQTT
> vẫn XANH**, vì gương tuần tự hoá envelope **thẳng** và **không đi qua** `ReadSampleSeries`. Nghĩa là
> một bản thi hành sai kiểu sẽ làm **HTTP mất sạch mẫu trong khi MQTT vẫn mang cặp đúng**. Ghi ở đây vì
> nó không suy ra được từ bất kỳ nửa nào một mình.
>
> **Nhân chứng — MỚI, và nó là hạng mục công việc ĐẦU TIÊN của phán quyết này, không phải cuối:**
> `tests/St4i.EdgeCore.Tests/WaveformPairAtTheWireBoundaryTests.cs`, **bảy `[Fact]`**,
> `EXPECT_EDGECORE` **1153 → 1160** (biện minh nằm **ngay cạnh hằng số**). Lý do nó phải tồn tại là phép
> đo của AI-1: đặt phép chuyển ở đây làm **KHÔNG một bài nào** trong 2764 đỏ lên, và **"không gì đỏ"
> KHÔNG phải bằng chứng an toàn — nó là bằng chứng KHÔNG CÓ NHÂN CHỨNG.**
>
> 🔴 **BẢY KHÔNG PHẢI BẢY NHÂN CHỨNG — phân đôi, đo bằng cách GỠ phép chuyển rồi chạy lại:** **BỐN đỏ**
> (chúng đo **chỗ ĐỔI**) và **BA vẫn xanh THEO CẤU TẠO** (chúng đo **chỗ KHÔNG ĐƯỢC ĐỔI** —
> `ScrewdriveSim` đi qua nguyên vẹn, chuỗi đã-là-cặp không bị chuyển lần hai, mọi hàng vẫn là
> `double[]`). **Một dụng cụ đỏ ở cả hai phía không đo được gì**, nên phép phân đôi ấy được nêu ra chứ
> không để người sau tự phát hiện.
>
> **Cái ĐÃ ĐO của gương MQTT, và cái vẫn CHƯA:** bài thứ bảy publish qua **một broker thật**, rồi một
> người đăng ký **đến SAU** nhận lại thông điệp **`Retain = 1`** và đọc thấy các cặp. Nên *"gương đổi"*
> là một **phép đo**, không phải một suy luận. **Ai đăng ký nó ngoài đời thì vẫn CHƯA ĐO** — bài kiểm
> chứng minh **cái gì rời đi**, không bao giờ **ai đọc**.
>
> 🔴 **HAI CHUỖI ĐÃ CÔNG BỐ NAY THÀNH SAI, VÀ AK-1 KHÔNG ĐƯỢC SỬA CHÚNG — nêu tên chứ không im lặng.**
> Cả hai nói mục 14 *"opened 2026-08-18 and NOT decided"*: (1) chú thích `///` của
> `WaveformSeries.Samples`/`RateHz` trong `src/St4i.Connector.Abstractions/Models/DeviceReading.cs`;
> (2) chú thích lớp của `tests/St4i.EdgeCore.Tests/WaveformSeriesRowShapeContractTests.cs`. Phán quyết
> hôm nay làm cả hai **sai**. Chúng nằm trong **đúng hai file mà brief của AK-1 cấm chạm** —
> `WaveformSeries` là bề mặt hợp đồng N-2, và bài kia là nhân chứng đợt 4. **Đây là đúng loài P-2 (một
> chuỗi đã công bố khẳng định điều sai), và nó được ghi VÀO ĐÂY** — chỗ chủ sở hữu mở được — thay vì
> vào một báo cáo dưới `.superpowers/sdd/` **bị gitignore**, vì một lời cải chính ngoài tầm với người
> đọc là đúng khuyết tật file này lập ra để chấm dứt. **Việc còn nợ, một nhiệm vụ riêng, 0 dòng hành
> vi.**
>
> 📎 **KHỐI NGAY TRÊN GIỮ NGUYÊN VĂN, RÚT 2026-08-19 (AK-1, sau vòng phản biện) — và lý do là nó ĐẾM
> THIẾU BẢY, phân loại sai một câu, và gộp mất một phân biệt về SỞ HỮU.** Cái nó nói (hai câu ấy có
> thật, và ghi-chứ-không-sửa là đúng) **vẫn đúng**; cái nó làm sai là **một con số vô hướng tóm tắt một
> tập người viết chưa mở hết** — đúng loài file này lập ra để chấm dứt, lần này ở trong chính khối viết
> ra để tuân nó. **LIỆT KÊ TRƯỚC, CON SỐ VIẾT SAU:**
>
> **LỚP 1 — nợ của PHÁN QUYẾT** (chủ sở hữu quyết ⇒ câu thành cũ). Bảy câu:
> * `DeviceReading.cs` **:47–49** — *"Whether it ALSO determines how many elements a `Samples` row holds
>   is **an open owner decision**"*;
> * `DeviceReading.cs` **:55–56** — *"AN OPEN OWNER DECISION … **item 14, opened 2026-08-18 and NOT
>   decided**"* (câu khối cũ đã nêu);
> * 🔴 `DeviceReading.cs` **:98–99** — *"whether it also determines a row's length is **precisely what
>   item 14 must settle**"*. **Sai theo kiểu TINH VI NHẤT trong chín câu:** mục 14 đã đóng và **CỐ Ý
>   KHÔNG** quyết điều đó (chỉ quyết hình dạng **trên dây** — xem khối phán quyết ở trên và ô mục 4).
>   Người đọc câu ấy sẽ tới đây tìm một câu trả lời **không có ở đây**;
> * `DeviceReading.cs` **:102** — *"and **item 14 reopens them**"*, thì hiện tại;
> * `WaveformSeriesRowShapeContractTests.cs` **:13** — *"item 14, opened 2026-08-18 and not decided"*
>   (câu khối cũ đã nêu);
> * `WaveformSeriesRowShapeContractTests.cs` **:137** — *"item 14 **has not been decided**"*;
> * 🔴 `WaveformSeriesRowShapeContractTests.cs` **:120** — *"item 14, **still open**. If this moved
>   deliberately, say so there:"*. **HẠNG KHÁC BẢY câu kia, và khối cũ phân loại SAI nó:** đây **KHÔNG
>   phải `///`** mà là **thông điệp của một `Assert.True`**, tức nó **được IN RA cho lập trình viên**
>   đúng lúc bài đỏ, và nó **chỉ dẫn một hành động cụ thể** tới một mục *"still open"* mà thực tế đã
>   đóng và đã thi hành. Một chuỗi nằm im trong nguồn và một chuỗi được in ra lúc chạy **không cùng
>   hạng**.
>
> 🔴 **LỚP 2 — nợ của MÃ AK-1, KHÔNG phải của phán quyết. Hai câu, và khối cũ bỏ sót CẢ HAI:**
> * `DeviceReading.cs` **:52** — *"The sample rows, **passed to the wire unchanged**."*, câu **MỞ ĐẦU**
>   của `<param name="Samples">`;
> * `DeviceReading.cs` **:95** — *"…this type accepts any `double[]`, **the normalizer copies rows to the
>   wire unchanged**…"*, nằm trong đoạn nhan đề *"What a consumer may rely on **TODAY**"*.
>
> **Không phán quyết nào làm hai câu ấy sai — `ToWireSampleRows` làm.** Với một chuỗi **được chuyển**,
> hàng **không** còn đi ra nguyên vẹn và normalizer **không** còn chép. **Đây là phân biệt chịu lực, và
> nó là lý do khối cũ phải bị rút chứ không chỉ được mở rộng:** *"phán quyết của chủ sở hữu làm tài liệu
> của tôi cũ đi"* và *"mã của tôi làm một câu đã công bố thành sai"* là **hai loại nợ khác chủ**, và
> người đọc sau sẽ hỏi đúng câu *"ai nợ câu này"*. Gộp chúng làm một là **ghi sai chủ nợ**.
>
> ✅ **LỚP 3 — ĐÃ ĐÓNG 2026-08-19, cùng ngày, cùng nhiệm vụ. KHÔNG CÒN LÀ NỢ.** Đây là các chuỗi **chính
> nhiệm vụ này vừa công bố** mà vòng phản biện đo là nói quá. Chúng được **SỬA** chứ không được ghi —
> một lần biên tập `///` trong `tests/St4i.EdgeCore.Tests/WaveformPairAtTheWireBoundaryTests.cs`, **0
> dòng hành vi, 0 con số dịch, bảy `[Fact]` không đổi**. 🔴 **Lý do chúng KHÔNG được xử như lớp 1 và 2:**
> một khối P-2 kể tên chín câu **người khác** nợ, trong khi hai câu **của chính nó** nằm im cách đó vài
> dòng, là **một hồ sơ tự phản bội**. Ràng buộc *"không đụng nhân chứng"* nhắm **nhân chứng đợt 4** —
> thứ đang ghim một hợp đồng đã có — **không** nhắm nhân chứng do chính nhiệm vụ này viết ra; chỗ mơ hồ
> ấy được **hỏi lên và được trả lời**, không được tự quyết trong im lặng.
>
> 📎 **Tiêu đề của lớp này đọc, NGUYÊN VĂN, cho tới `6ada4fe9` — RÚT 2026-08-19 (AK-1) vì lớp đã ĐÓNG,
> không vì nó từng sai:** *"**LỚP 3 — nợ của PROSE AK-1**, tức các chuỗi **chính nhiệm vụ này vừa công
> bố** mà vòng phản biện đo là nói quá. Hai câu, cả hai trong
> `tests/St4i.EdgeCore.Tests/WaveformPairAtTheWireBoundaryTests.cs`:"* Nó mô tả đúng trạng thái hồ sơ
> cho tới đúng lúc ấy.
>
> Giữ nguyên văn hai câu cũ và ghi chúng đã thành gì:
> * **:229** — *"the one **all three** reference SDK samples reproduce"*. Liệt kê lại
>   `examples/device-client/`: **python** `example_screwdriver.py` và **csharp** `ExampleScrewdriver.cs`
>   là **hai** chương trình chạy được có phát waveform; **README.md** mang một payload **tài liệu**;
>   **nodejs** `st4i_device_client.mjs` là **thư viện client, KHÔNG có ví dụ waveform**; **arduino** chỉ
>   telemetry. **Đếm sau khi liệt kê: HAI bộ phát chạy được + một payload tài liệu**, không phải ba bộ
>   phát. 🔴 Cộng một sự kiện mạnh hơn cả con số: **không cái nào trong chúng đi qua `Normalizer`** —
>   chúng gọi `St4iDeviceClient` thẳng. **Vị từ gác bằng cặp vẫn đúng; DÂN SỐ minh hoạ bị phóng đại.**
>   ✅ **NAY ĐỌC:** phép liệt kê ấy, nguyên văn, trong chính chú thích — hai bộ phát chạy được, một
>   payload tài liệu, nodejs không có ví dụ waveform, arduino telemetry-only — cộng câu **không cái nào
>   đi qua normalizer**, và câu nêu **dân số vị từ THẬT SỰ bảo vệ**: một driver bên thứ ba viết theo đặc
>   tả 57 §3.3 cắm vào normalizer, **có thật và chưa có trong cây**.
> * **:37** — *"a transform that returned `List<double>` **or a tuple**"* rồi kết luận chung rằng gương
>   MQTT vẫn mang cặp đúng. **Chỉ đúng cho các kiểu vẫn tuần tự hoá thành MẢNG JSON.** Với một
>   `ValueTuple`, gương ra `{"Item1":…}` chứ không ra mảng ⇒ **CẢ HAI** bề mặt hỏng, không phải một. Sự
>   kiện *"hai bề mặt hỏng khác nhau"* **đứng vững cho `List<double>`** (biến thể thật sự đã chạy) và
>   **không** khái quát được cho tuple.
>   ✅ **NAY ĐỌC:** phép bất đối xứng được nêu kèm **điều kiện chịu lực** — nó đúng cho **mọi kiểu sai
>   VẪN TUẦN TỰ HOÁ THÀNH MẢNG JSON**, `List<double>` là biến thể **thật sự đã chạy** (6/7 đỏ, gương
>   xanh), và **một `ValueTuple` tuần tự hoá thành OBJECT nên phá CẢ HAI bề mặt**. Chú thích tự khai
>   rằng bản trước **gộp "or a tuple" vào phép bất đối xứng và sai đúng ở ca ấy**.
>
> **LỚP 4 — nợ CÓ TRƯỚC, không của phán quyết và không của AK-1.** Một câu:
> `DeviceReading.cs` **:62** — *"row `i` is the sample at `i / RateHz` seconds"*, nằm trong đoạn **(A)**
> tự nhan đề *"measured, and **not in dispute**"* và **mô tả riêng `WelderSim`**. AI-1 đã đo rằng nó
> **sai về đúng `WelderSim` ấy, lệch đúng 4,17 %** — **trước** AK-1. Nêu nó ở đây vì khối phán quyết
> bên trên **dựa vào nó** như một chỗ đứng (*"đã là phép dựng lại mà chính repo này công bố"*), và trích
> một câu đã biết sai mà không nói nó đã biết sai là **viết một sự thật chỉ theo chiều thuận**. **Chiều
> nghịch, viết ra ở đây:** câu ấy đúng ở chỗ nó chứng minh `i/rateHz` **không phải một quy ước mới do
> AK-1 nghĩ ra**; nó sai ở chỗ con số nó hứa **không khớp `WelderSim`**. Cả hai nửa phải đọc cùng nhau.
>
> 🔴 **VÀ VÌ LỚP 3 ĐÃ ĐÓNG, TẬP CÒN NỢ CO LẠI — ghi ra chứ không để người sau tự trừ:** còn **BẢY** câu
> lớp 1 + **HAI** câu lớp 2 = **CHÍN câu còn nợ, trong HAI file**, cộng **MỘT** câu lớp 4 có trước.
> **Hai câu lớp 3 KHÔNG còn trong tập ấy.**
>
> **ĐẾM SAU KHI LIỆT KÊ: CHÍN câu, trong BA file. TÁM là `///`, MỘT là thông điệp `Assert` lúc chạy.
> Bảy do phán quyết, HAI do mã của AK-1, HAI do prose của AK-1, MỘT có trước cả hai** — tổng các lớp là
> **mười hai lần xuất hiện trên chín câu cộng ba câu của lớp 3 và 4**, nên **con số duy nhất đọc được ở
> đây là con số đếm lại được từ chính phép liệt kê trên**, không phải một số vô hướng đặt riêng.
>
> 🔴 **KHÔNG câu nào trong số ấy được AK-1 sửa, và ràng buộc là RÕ:** lớp 1 và 2 nằm trong hai file
> **brief cấm chạm**; lớp 3 nằm trong **nhân chứng mới**, mà vòng phản biện **cấm đụng**. Nên tất cả
> được **GHI**, tại đây, chỗ chủ sở hữu mở được. **Việc còn nợ, một nhiệm vụ riêng, 0 dòng hành vi** —
> và nhiệm vụ ấy nay có **một phép liệt kê đóng để làm việc theo**, thay vì một con số đếm thiếu.
>
> 🔴 **HAI KHO ĐỆM TRÊN ĐĨA PHÁT LẠI HÌNH DẠNG CŨ, KHÔNG PHẢI MỘT — và cái thứ hai là cái DUY NHẤT có
> chặn trên ĐỌC ĐƯỢC từ trong cây này.** Hồ sơ tới hôm nay chỉ nêu hàng đợi SDK. Đo lại khi thi hành,
> **liệt kê trước, đếm sau**:
> * **sau bề mặt HTTP** — hàng đợi store-and-forward của SDK: `St4iDeviceClient._queuePath`/`Enqueue`,
>   một file **JSONL** ghi bằng `File.AppendAllText`. **Trần: KHÔNG ĐO ĐƯỢC** — không có giới hạn kích
>   thước hay tuổi nào trong cây này.
> * 🔴 **sau gương MQTT** — `UnsBridge.RunSpoolWriterLoopAsync` → `IBridgeSpool.EnqueueAsync(item.Topic,
>   item.Payload, item.Retain, …)`, và `item.Payload` **chính là envelope đã tuần tự hoá**.
>   `BridgeSpool` ghi vào **SQLite** (`bridge-spool.db`) và `TryPublishToRemoteAsync` **phát lại lên
>   broker Site sau**, **giữ nguyên cờ Retain**. 🔴 **Trần ĐO ĐƯỢC, và đây là điều khối phán quyết ở
>   trên KHÔNG nói được:** mặc định `DefaultMaxBytes = 64 MiB` và `DefaultMaxAgeHours = 48`, cưỡng chế
>   bởi `TrimAsync`. Nên với **đường MQTT**, câu *"hình dạng cũ còn đi ra được bao lâu"* **không phải
>   là không đo được** — mặc định nó là **48 giờ hoặc 64 MiB, tuỳ cái nào tới trước**.
>
> **Đếm sau khi liệt kê: HAI kho đệm, MỘT có trần đo được, MỘT không.** Nêu ra vì **một cái trần nêu
> quá nhỏ còn tệ hơn không nêu trần**, và hồ sơ tới hôm nay nêu **một** đường trong khi có **hai**.
> Cả hai trần đều là **mặc định** — cả hai nhận tham số ghi đè, nên con số 48/64 là **trần của cấu hình
> mặc định**, không phải của mọi bản triển khai. **AK-1 không đổi một dòng nào của cả hai đường.**
>
> **Cái nhiệm vụ này KHÔNG làm và không được đọc là đã làm:** nó **không** chạm nền tảng, **không** POST
> gì, **không** bật cờ `PROCESS_RESULT_INGEST_ENABLED`. Nên **cặp đối chứng A/B của AB-1 vẫn là bằng
> chứng động duy nhất** rằng cổng nhận hình dạng cặp, và **hạng nguồn của nó không đổi**: NHẬN LẠI.
> Câu *"payload nay hợp lệ với cổng"* **chưa được đo trên một cổng đang chạy sau bản sửa này**.
---

## 15. Bốn kênh chặn dùng `DropOldest`; ba trong bốn treo một cảnh báo *"queue saturated"* KHÔNG với tới được bằng bão hoà; và cái thứ tư đã giải xong đúng bài ấy

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AL-1 (đợt 6) và AN-1 (đợt 8); **phép liệt kê toàn tập

> 📎 **Ba chữ `🔴 CHỠ ANH` ngay trên giữ NGUYÊN VăN, RÚT 2026-08-21 (AP-1)** — không phải vì chúng từng
> sai, mà vì chúng đã hết đúng: mục này được **điều phối viên quyết theo uỷ quyền** ngày 2026-08-20 và đã
> **thi hành** ngày 2026-08-21. Câu mô tả đúng trạng thái hồ sơ cho tới đúng lúc ấy. Phần còn lại của
> dòng — *"Mở 2026-08-20 (AO-1). Đo bởi AL-1 (đợt 6) và AN-1 (đợt 8); phép liệt kê toàn tập là của nhiệm
> vụ này"* — **KHÔNG rút**: nó là hồ sơ xuất xứ và vẫn đúng từng chữ.
là của nhiệm vụ này**.

📎 **Vì sao MỘT mục cho hai chỗ mà đợt 6 và đợt 8 báo riêng, nói ra chứ không để người đọc đoán.**
Chúng **cùng một cơ chế, cùng một dòng mã, cùng một quyết định**: một phán quyết chỉ chạm một chỗ
sẽ để hai chỗ kia y nguyên, và "một luật, nhiều chỗ" đúng là hình dạng file này đã bắt trước đây.
Nhưng một mục gộp **bắt buộc phải liệt kê hết tập nó gộp** — nên tập đã được mở, và **nó không
phải hai**.

**Đo được cái gì — LIỆT KÊ TRƯỚC, con số viết SAU.** Mọi `Channel.CreateBounded` dưới `src/`, mở
trọn: `HistorianWriter`, `UnsPublisher`, `UnsBridge`, `AlarmNotifier`, và
`AlarmAnnunciationHub.Listener` (trong `AlarmAnnunciation.cs`). **Năm.** Bốn cái đầu đặt
`FullMode = BoundedChannelFullMode.DropOldest`; cái thứ năm đặt `Wait`, **có chủ ý**, và doc của
chính nó nói vì sao (`DropWrite` sẽ trả `true` trên hàng đợi đầy).

Dưới `DropOldest`, `TryWrite` trên một kênh **ĐẦY** **trả `true`**: nó đuổi phần tử **cũ nhất** rồi
nhận phần tử mới. Nên mọi nhánh `if (!TryWrite(...))` chỉ chạy khi Writer **đã đóng** — tức lúc
dispose, chứ không phải lúc bão hoà.

* **`HistorianWriter.Enqueue`** — **một** nhánh như thế, chuỗi *"Historian queue saturated — dropped
  oldest"*. `capacity` mặc định **10.000**.
* **`UnsPublisher`** — **sáu** nhánh như thế, trên `PublishReading`, `PublishBirth`, `PublishDeath`,
  `PublishNodeBirth`, `PublishNodeDeath`, `PublishLineState`.
* 🔴 **`UnsBridge.OnLocalMessageReceivedAsync`** — **một** nhánh như thế, chuỗi *"Site bridge forward
  queue saturated — dropped {topic}"*, `ChannelCapacity` **10.000**. **Chỗ này chưa báo cáo nào
  nêu.** Đợt 8 viết rằng *"hình dạng này nay đã được đo HAI lần trong repo này, nên nên audit cái
  thành ngữ `DropOldest`-kèm-cảnh-báo-bão-hoà ở mọi chỗ nó xuất hiện"*. Nhiệm vụ này chạy đúng phép
  audit ấy. Kết quả: **ba**, không phải hai.
* **Không cái nào trong ba** truyền tham số `itemDropped` cho `Channel.CreateBounded`. **Không cái
  nào trong ba có một bộ đếm rơi.**

🔴 **Và `UnsBridge` tệ hơn hai cái kia theo một chiều riêng: nó CÓ một con số tên `DroppedTotal`, và
con số ấy đếm một mất mát KHÁC.** `BridgeStatusSnapshot.DroppedTotal` đọc từ `_lastSpoolStats`, tức
`BridgeSpool.TrimAsync` cắt bao nhiêu bản ghi theo tuổi/byte — **không phải** bao nhiêu bản bị KÊNH
đuổi. **Một bộ đếm đếm sai vật còn tệ hơn không có bộ đếm**, vì nó đọc như một câu trả lời.

🔴 **Cái thứ tư đã giải xong đúng bài này, và đó là nửa quan trọng nhất của mục.** `AlarmNotifier`
dùng **cùng** `DropOldest`, và doc của chính lớp ấy nêu đích danh cái bẫy: *"Under `DropOldest`,
`TryWrite` returns `true` and silently evicts the OLDEST queued item, so the saturation case never
trips that check at all."* Nó truyền `itemDropped` cho `Channel.CreateBounded`, cộng vào
`AlarmNotifierStats.Dropped`, và **liệt kê NĂM đường một job có thể mất**, phân biệt đường "kênh
không theo kịp" với các đường "tiến trình đang tắt". Doc ấy còn ghi rằng hình dạng của nó **chép từ
`HistorianWriter`** — nên **mẫu SAI là mẫu đang được chép, và mẫu ĐÚNG chưa ai chép ngược lại**.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Historian.HistorianWriter` (hàm dựng và `Enqueue`);
`St4i.EdgeCore.Uns.UnsPublisher` (hàm dựng và sáu phương thức `Publish*`);
`St4i.EdgeCore.Site.UnsBridge` (hàm dựng, `OnLocalMessageReceivedAsync`, `Snapshot`);
`St4i.EngineApi.Alarms.AlarmNotifier` (lớp lồng của lane, `AlarmNotifierStats.Dropped`);
`St4i.EngineApi.Alarms.AlarmAnnunciationHub.Listener` (chỗ dùng `Wait`, để đối chiếu).
`tests/St4i.EdgeCore.Tests/Historian/HistorianWriterTests.cs` có **10** bài `[Fact]` và **không bài
nào** nhắc `saturation`, `capacity` hay `DropOldest` — cả hai nhánh đều không có nhân chứng.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* dưới áp lực ngược kéo dài — một store chậm, một broker MQTT không đáp, một Site
xuống — ba đường này **mất bản ghi CŨ NHẤT trong im lặng**: tới `capacity` hàng lịch sử của
historian (bản ghi mà sản phẩm này giữ về việc máy đã làm gì), các publish UNS gồm cả device birth
và line-state, và các bản chuyển tiếp lên Site. **Không log, không bộ đếm, không dòng nào trên
`/v1/health`.** Ở `UnsBridge` màn hình trạng thái vẫn in một `DroppedTotal` — thường là 0 — nên
người vận hành đọc được một câu trả lời **sai chiều trấn an**.
*Chiều ngược, và nó đủ mạnh để "không làm gì" là một lựa chọn có lý:* `DropOldest` được chọn có lý
do và lý do ấy vẫn đúng — nó bảo đảm đường ghi **không bao giờ chặn** luồng commit của
`EdgePipeline` và **không bao giờ đẩy áp lực ngược về thiết bị**. Đổi `FullMode` là đổi đúng tính
chất ấy. Thêm một bộ đếm là **thêm thành viên công khai mới**, mà P-2 chi phối chính tả thành viên
công khai. Và trên một bản triển lãm chạy vài giờ với kênh 10.000, ba kênh này **không bao giờ
đầy** — chi phí thật hôm nay là **không**.

**Nếu KHÔNG quyết định.** Tám nhánh cảnh báo ở lại đúng chỗ chúng đang đứng, đọc như một mạng an
toàn không tồn tại; ba đường mất dữ liệu ở lại im lặng; và vì `AlarmNotifier` **tự ghi rằng nó chép
`HistorianWriter`**, đường ống tiếp theo được viết trong repo này nhiều khả năng chép tiếp cái sai
chứ không chép cái đúng. Đây đã là lần thứ **ba** một đợt tìm ra chính hình dạng ấy ở một chỗ mới.

> ### 🔨 PHÁN QUYẾT 2026-08-20 — ÁP MẪU ĐÃ GIẢI XONG CỦA `AlarmNotifier` VÀO CẢ BA CHỖ
> **Quyết bởi điều phối viên theo uỷ quyền, không phải bởi chủ sở hữu** — và uỷ quyền ấy với tới được
> mục này, đúng cùng khuôn mục 8: ba mục mà uỷ quyền KHÔNG phủ là ba mục đổi thứ **người ngoài tổ chức
> này** đang dựa vào, và mục 15 không đổi payload, không đổi hình dạng dây, không đổi con số OEE đã báo.
>
> **Phán quyết:** hình dạng mà `AlarmNotifier` **đã giải xong** được **chép ngược** vào cả ba chỗ. Đây
> **không** phải nghĩ ra một chính sách mới; mẫu đúng đã nằm sẵn trong cây và chỉ chưa ai mang về.
>
> 🔴 **Điều KHÔNG được đổi, và nó là một nửa của phán quyết:** `FullMode` **ở lại `DropOldest`**. Lý do
> mà chính mục này ghi ở §"Hậu quả vận hành, HAI CHIỀU" vẫn đúng nguyên — chế độ ấy bảo đảm đường ghi
> **không bao giờ chặn** luồng commit của `EdgePipeline` và **không bao giờ đẩy áp lực ngược về thiết
> bị**. Thứ được sửa là **KẾ TOÁN**, không phải **CHÍNH SÁCH**.
>
> 🔴 **Không cơ chế, không mã ở đây.** Mục này ghi **điều đã quyết**; chọn *cách* chép — và trả cái giá
> mà chính mục này đã nêu tên, rằng thêm một bộ đếm là **thêm thành viên công khai mới** dưới luật P-2 —
> là việc của nhiệm vụ thi hành.

> ### ✅ ĐÃ THI HÀNH 2026-08-21 — AP-1
>
> **Quần thể được LIỆT KÊ lại trước khi được đếm, và nó KHÔNG dịch.** Quét bằng
> `git grep --full-name -n <mẫu> HEAD -- ':(top)'` cho ba mẫu `Channel.CreateBounded`,
> `BoundedChannelFullMode`, `BoundedChannelOptions`, **chạy từ `D:\SOURCES\avi-aoi-sim\tools\machine-simulator`**
> — thư mục được ghi lại vì mục **32**, mở cùng ngày với mục này, đo được rằng một pathspec git tương đối
> thu về thư mục hiện hành và **trả 0 chứ không báo lỗi**. `:(top)` là cái làm phép quét chạm tới
> `server/`, `client/`, `examples/`, vốn **có trong commit nhưng không trên đĩa** (sparse checkout);
> `--full-name` là cái làm đường dẫn in ra **không mơ hồ** giữa `docs/` gốc repo và `tools/machine-simulator/docs/`.
> Kết quả, liệt kê: `HistorianWriter`, `UnsPublisher`, `UnsBridge`, `AlarmNotifier`,
> `AlarmAnnunciationHub.Listener`. **Năm**, bốn `DropOldest` + một `Wait`, **đúng như mục này đã ghi**.
> 🔴 **Và một phép quét thứ tư mà mục này KHÔNG chạy đã được chạy: `TryWrite` trên toàn repo.** Nó tìm ra
> **hai** kênh nữa — `MqttDriver` và `InspectorStream` — nhưng cả hai là `Channel.CreateUnbounded`: chúng
> **không đuổi được cái gì**, nên chúng không thuộc quần thể mục này. Nêu ra vì một phép đếm bằng `TryWrite`
> sẽ ra **bảy** và người sau sẽ phải đo lại để biết vì sao con số ấy sai.
>
> **Tiền đề của phán quyết được KIỂM LẠI trên mã, và nó ĐỨNG VỮNG.** `AlarmNotifier` thật sự đã giải
> xong: nó truyền `itemDropped` cho `Channel.CreateBounded`, nó phân loại **năm** đường một job có thể
> mất và tách đường "kênh không theo kịp" khỏi các đường "tiến trình đang tắt", và nó gọi log **sau khi
> nhả khoá**. Không có điều kiện "dừng và báo" nào xảy ra ở trục ấy.
>
> 🔴 **NHƯNG MỘT MẢNH CỦA HÌNH DẠNG ẤY KHÔNG MANG SANG ĐƯỢC, và nó được nói ra chứ không lặng lẽ bỏ.**
> `AlarmNotifier.EmitLocked` học được "cú ghi CỦA TÔI có đuổi gì không" bằng cách **kẹp** `Evicted` hai
> đầu quanh `TryWrite`. Phép kẹp ấy **chính xác chỉ vì mọi thứ ở đó chạy dưới `_gate`**. Ba lớp EdgeCore
> **cố ý không có khoá nào trên đường enqueue** — đó đúng là tính chất chúng tồn tại để giữ — nên kẹp ở
> đó sẽ là một cuộc đua. Bản chép dùng một đường khác và nó chính xác vì **một lý do khác**: cảnh báo
> được phát **từ trong chính callback `itemDropped`**, chạy đồng bộ, **một lần cho mỗi phần tử bị đuổi**,
> và **nhận đúng phần tử bị vứt**. Chiều ngược lại cũng đúng và cũng được ghi: `AlarmNotifier` **không**
> làm được thế, vì callback của nó chạy dưới khoá và một delegate log của người gọi không bao giờ được
> chạy ở đó. Hai lớp giải cùng một bài bằng hai cách, và **không cách nào là bản sao của cách kia**.
>
> **Cái mỗi chỗ nhận được, LIỆT KÊ:**
> * `HistorianWriter` — `HistorianWriterStats(Evicted, DroppedAfterShutdown, Queued)` + `Stats`.
> * `UnsPublisher` — `UnsPublisherStats(...)` + `Stats`; sáu `Publish*` gom về một `Enqueue` chung nên
>   sáu nhánh cùng một lời, không phải sáu lời hơi khác nhau.
> * `UnsBridge` — `BridgeForwardQueueStats(...)` + `ForwardQueueStats`, cộng một tham số
>   `channelCapacity` có mặc định (hai lớp anh em đã có sẵn tham số ấy; lớp này là ngoại lệ, và không có
>   nó thì **không nhân chứng nào làm kênh đầy thật được** mà không đẩy 10.001 message qua một broker
>   thật).
> * Ở cả ba: nhánh `if (!TryWrite(...))` **KHÔNG bị xoá và KHÔNG được làm cho với tới được** — nó vẫn chỉ
>   chạy khi writer ĐÃ ĐÓNG, đúng như mục này đo. Nó được **đếm riêng** và **viết lại** thành đúng ca nó
>   chạm tới. Sửa nhánh ấy sẽ là bản sửa **sai chỗ**, và ghi ở đây để lần sau không ai thử.
>
> 🔴 **`UnsBridge.DroppedTotal` THÔI NÓI SAI VỀ CHÍNH NÓ — BẰNG CÁCH KHÔNG BỊ NỚI NGHĨA.** Bề mặt **ĐỌC**
> nó được đo trước khi chạm vào nó, và liệt kê: (1) `GET /v1/site` → `SiteStatusDto.DroppedTotal`;
> (2) trang `/site` của web (`Site.tsx` in nó ở tông nguy hiểm và bật `site.spool.droppedWarning` khi
> `> 0`); (3) 🔴 **bản ghi resync GIỮ LẠI mà bridge phát lên broker của Site** (`ResyncRecord.droppedTotal`,
> `UnsBridge.PublishResyncRecordAsync`) — **một hợp đồng dây mà bên thứ ba tiêu thụ**, và chính nó là cái
> quyết định. Nới nghĩa một con số đang chạy trên một bề mặt như thế là đúng thứ file này lập ra để chấm
> dứt. Nên con số **giữ nguyên nghĩa**, được **ghi tài liệu** ở cả bốn chỗ nó được khai
> (`BridgeStatusSnapshot`, `SiteStatusDto`, `web/src/lib/api.ts`, README), và cú đuổi kênh có **tên
> riêng**: `UnsBridge.ForwardQueueStats.Evicted`.
>
> 🔴 **DƯ LƯỢNG CÒN MỞ, ghi vào mục chứ không để trong một báo cáo bị gitignore — đó đúng là cơ chế đã
> làm mười hai phát hiện nằm ngoài tầm với của chủ sở hữu suốt ba ngày.** Bộ đếm mới **không** có trên
> `GET /v1/site` lẫn trang `/site`: thêm một trường ở đó là **đổi payload đã xuất bản**, và chính "không
> đổi payload" là tiền đề đưa mục này vào trong uỷ quyền. Cộng với điều README đã ghi ở §"Ba đường mất
> dữ liệu khác" điểm 4 — trên hình thái cài **Windows Service** đã tài liệu hoá, `logWarning` đi vào
> `Console.Error` và `Console.Error` đi vào `Stream.Null` — nên **trên hình thái ấy mất mát này được ĐẾM
> nhưng operator vẫn CHƯA NHÌN THẤY ĐƯỢC**. Nửa việc ấy cần một phán quyết riêng, không phải một nhiệm vụ
> tiếp theo lặng lẽ làm.
>
> **NHÂN CHỨNG, và cặp đối chứng chứng minh từng cái ĐỎ ĐƯỢC.** Năm `[Fact]` mới, `EXPECT_EDGECORE`
> 1160 → **1165** (đo, không cộng), tổng suite 2771 → **2776**:
> `HistorianWriterTests` +2 — mục này đo được rằng file ấy có 10 `[Fact]` và **không bài nào** nhắc
> saturation/capacity/`DropOldest`; `UnsPublisherDropAccountingTests` +2 (file mới);
> `UnsBridgeSpoolTests` +1.
> * **ĐỐI CHỨNG A** — vô hiệu hoá ba callback `itemDropped`: **ba bài saturation ĐỎ**, hai bài shutdown
>   **XANH** (đúng — chúng đo đường khác; một bài đỏ dưới mọi đột biến thì không định vị được gì).
> * **ĐỐI CHỨNG B** — trả hai nhánh shutdown về đúng lời cũ trước AP-1 (*"queue saturated — dropped
>   oldest for X"*): **hai bài shutdown ĐỎ**, ba bài saturation **XANH**.
> * Mọi đột biến đã hoàn nguyên; `grep -rn MUTATION-AP1 src/ tests/` **không trả về gì**.
> 🔴 **`UnsBridge` chỉ có MỘT nhân chứng chứ không phải một cặp, và sự bất đối xứng ấy được nêu chứ không
> độn cho đủ:** nhánh writer-đã-đóng của lớp này chỉ với tới được bằng một cú gọi đua với `DisposeAsync`
> **từ bên trong callback nhận của một MQTT client**, thứ harness này không lập lịch tất định được. Một
> bài thứ năm không thể bắt đỏ theo ý muốn đúng là loài mà cổng của repo này tồn tại để từ chối.
>
> **Doc của `AlarmNotifier` được kiểm lại và nó KHÔNG thành sai — nên nó được MỞ RỘNG, không bị RÚT.**
> Câu *"Shape. Copied from `HistorianWriter`"* liệt kê capacity 10.000, `DropOldest`, `SingleReader`,
> vòng drain bắt mọi thứ, `DisposeAsync` drain-trước-rồi-mới-cắt: **từng thứ một vẫn đúng**. Thứ câu ấy
> chưa bao giờ khẳng định là **KẾ TOÁN RƠI** — historian không có, lớp này phát minh ra. Cái được ghi
> thêm tại chỗ là **CHIỀU**: một sự thật viết chỉ theo chiều thuận là một nửa sự thật, và đúng nửa thiếu
> ấy là thứ khiến ba đường ống được viết theo cái sai.
>
> **Bốn khẳng định đã công bố ở nơi khác thành sai vì bản sửa này, và cả bốn được rút TẠI CHỖ kèm ngày:**
> `HistorianWriter.Enqueue` (khối rút của AL-1 tự khai *"sửa lời cho khớp là một thay đổi mã và nhiệm vụ
> này chỉ viết văn xuôi"* — thay đổi mã ấy nay đã làm); `UnsPublisher` hàm dựng (*"không có drop total
> trên lớp này"* — nay có, nhưng **một bất đối xứng còn lại được nêu: bộ đếm nằm trong bộ nhớ và chết
> theo tiến trình, còn `dropped_total` của `BridgeSpool` là bền**); README §"Ba đường mất dữ liệu khác"
> điểm 1, **cả bản EN và bản VI** (*"không có bộ đếm nào"* và *"cảnh báo đó không bao giờ in ra được"*);
> `web/src/lib/api.ts` (`droppedTotal === 0` không có nghĩa là không mất gì).
>
> **Bằng chứng:** `scripts/verify-suites.sh` khối `TASK AP-1` ngay trên `EXPECT_EDGECORE`;
> `.superpowers/sdd/item15-dropoldest/task-1-report.md`.

---

## 21. `MappingProfileResolver` ghép một chuỗi do vận hành viên viết vào một đường dẫn mà không giới hạn nó trong thư mục

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AM-1 (đợt 7), xác nhận lại trên mã.

> 📎 **Ba chữ `🔴 CHỜ ANH` ngay trên giữ NGUYÊN VĂN, RÚT 2026-08-21 (AQ-1)** — không phải vì
> chúng từng sai, mà vì chúng đã hết đúng: mục này được **điều phối viên quyết theo uỷ quyền** ngày
> 2026-08-21 và đã **thi hành** cùng ngày. Phần còn lại của dòng — *"Mở 2026-08-20 (AO-1). Đo bởi AM-1
> (đợt 7), xác nhận lại trên mã"* — **KHÔNG rút**: nó là hồ sơ xuất xứ và vẫn đúng từng chữ.

**Đo được cái gì.** Trong `MappingProfileResolver.ResolveOne`:
`Path.Combine(mappingDir, descriptor.MappingProfile + ".json")`. Vế phải đến từ trường
`mappingProfile` của từng entry trong `fleet.json` và **không được kiểm ký tự phân tách**, nên nó
đặt tên một đường dẫn **tương đối với** thư mục ấy chứ không phải một file **bên trong** nó; một giá
trị **tuyệt đối** sẽ thắng hẳn, theo đúng hành vi đã ghi của `Path.Combine`. `mappingDir` mặc định
là `Path.Combine(AppContext.BaseDirectory, "mapping")` (`FleetCore.MappingDirectory`).

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Mapping.MappingProfileResolver.ResolveOne` và
`.Build`; `St4i.EdgeCore.Fleet.FleetCore.MappingDirectory`; trường `mappingProfile` trong `fleet.json`;
`St4i.EdgeCore.Mapping.MappingProfile.FromJson`.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* đây là một sự thật về **cơ chế**, và nó là loại sự thật nên được quyết chứ không nên
để mặc: một trường cấu hình đọc như một cái tên đang hành xử như một đường dẫn.
*Chiều ngược, và nó là lý do mục này nhỏ:* `fleet.json` do **vận hành viên viết** và nằm **cục bộ**;
thứ duy nhất tới được là một file JSON rồi bị deserialize thành `MappingProfile` — **không có thực
thi và không có phép ghi**. Trên một máy mà kẻ tấn công đã sửa được `fleet.json`, họ đã có nhiều thứ
tệ hơn. Và **giới hạn nó lại đổi hành vi** cho bất kỳ bản triển khai nào đang hợp lệ dùng một thư
mục con.

**Nếu KHÔNG quyết định.** Hành vi giữ nguyên. Cái mất là một câu trả lời ghi lại được cho câu hỏi
*"trường này là một TÊN hay một ĐƯỜNG DẪN"* — câu hỏi sẽ được hỏi lại mỗi lần ai đó đọc lớp này.

### ✅ ĐÃ THI HÀNH 2026-08-21 (AQ-1) — đường dẫn đã bị giam, và **hai câu của mục này không sống sót qua phép đo**

**Bản sửa.** `MappingProfileResolver.ResolveOne` chuẩn hoá **tuyệt đối** cả thư mục hồ sơ lẫn đường
dẫn ghép (`Path.GetFullPath`) rồi đòi đường dẫn ghép phải bắt đầu bằng gốc **cộng một dấu phân tách
đứng cuối** — dấu phân tách ấy là để một thư mục anh em tên `mapping-archive` không bị nhận nhầm là
con của `mapping`. **Không có chỗ nào lọc `..` hay dấu phân tách ra khỏi chuỗi** — đó là cách sai
kinh điển, và bài test `..` cố ý chạy **cả hai cách viết** (`../` và `..\`) đúng để một luật chuỗi
không thể vượt qua nó. Một giá trị đi ra ngoài bị **TỪ CHỐI** trước khi chạm tới hệ thống file, rơi
về `MappingProfile.ForClass` — **cùng chỗ rơi** ba nguyên nhân cũ đã rơi — kèm một thông điệp trên
`logWarning` nêu tên máy, giá trị đã viết, thư mục giới hạn, và **một giá trị hợp lệ trông thế nào**.

**Vì sao `logWarning` chứ không `logError`:** `logError` mang một `Exception`, một lần từ chối
**không có** exception nào, và bịa ra một cái cho vừa khuôn là một lời nói dối tệ hơn.

**Mắt xích — nêu bằng TÊN, từ chuỗi của vận hành viên tới `Path.Combine`.**
`fleet.json` (trường `mappingProfile` của từng entry) → `FleetCore.ResolveFleetPath` (đối số dòng
lệnh `--fleet <path>`, **nếu không có** thì `Path.Combine(AppContext.BaseDirectory, "fleet.json")`) →
`FleetConfig.Load` → `MachineDescriptor.MappingProfile` → `FleetCore.BuildStartPlan` →
`MappingProfileResolver.Build` (với `FleetCore.MappingDirectory` =
`Path.Combine(AppContext.BaseDirectory, "mapping")`) → `MappingProfileResolver.ResolveOne` →
`Path.Combine(mappingDir, descriptor.MappingProfile + ".json")` → `File.Exists` / `File.ReadAllText`
→ `MappingProfile.FromJson`. `FleetCore.StartLocked` gọi `Build` **lần thứ hai** cho những descriptor
đến muộn (J-1), qua đúng mắt xích ấy.

📎 **Mục này nói `FleetCore.MappingDirectory` như thể nó là một mặc định; đo được nó là một
`private static readonly` và `Build` **không có** tham số mặc định nào** — mọi người gọi phải truyền
thư mục vào. Sai lệch nhỏ, ghi để người sau không đi tìm một mặc định không tồn tại.

🔴 **CÂU THỨ NHẤT KHÔNG SỐNG SÓT — nhưng nó sai theo chiều LÀM MỤC NÀY MẠNH HƠN, không yếu đi.**
Mục nói chuỗi ấy *"đến từ `fleet.json`"*. Đã mở **trọn tập** những chỗ dựng `MachineDescriptor` dưới
`src/`: `ConnectorConfigValidation` (hai chỗ), `OnboardingFleetJoin`, `RtuBusConfiguration`,
`Program.cs` (hai chỗ) — **cả sáu truyền `MappingProfile: null`**, và `FleetCore.BuildDefaultFleet`
truyền `null` cho cả mười máy. Nên **`fleet.json` đúng là nguồn DUY NHẤT** của một giá trị khác
`null`: **không** route HTTP nào, **không** connector nào, **không** biến môi trường nào đặt được
trường này. Câu của mục **đúng**, và bây giờ nó **đo được** thay vì được nhận.

🔴 **CÂU THỨ HAI KHÔNG SỐNG SÓT, và đây là chỗ mục này nói thiếu.** Mục viết: *"`fleet.json` do vận
hành viên viết và nằm **cục bộ**"*. Đo được `ResolveFleetPath` nhận **`--fleet <path>` trước tiên**,
trước cả `AppContext.BaseDirectory`. Nên "cục bộ" là **hành vi mặc định**, không phải một ràng buộc:
ai khởi chạy tiến trình chọn được file roster ở **bất kỳ đâu**, kể cả một thư mục ghi được bởi người
dùng thường trong khi thư mục `mapping` vẫn nằm dưới `%ProgramFiles%`. Đó là cấu hình duy nhất mà
mục này **thật sự** đáng lo, và mục không nêu nó.

**Ai ghi được `fleet.json` trên một bản cài thật — hai chiều, vì viết một chiều là nửa sự thật.**
Đọc mục 30 trước, đúng như brief yêu cầu, và nó đổi mức nghiêm trọng **theo cả hai chiều**:
*Chiều làm nhẹ:* mục 30 đo được `INSTALLFOLDER` nằm dưới `ProgramFiles6432Folder`, và **khác** bốn
file store mà mục 30 nói *không* được git theo dõi, `fleet.json` **CÓ** được theo dõi và **CÓ** đi
vào bản publish (`St4i.EngineApi.csproj`:
`<None Include="..\..\fleet.json" CopyToOutputDirectory="PreserveNewest" Link="fleet.json" />`), nên
trên một bản cài mặc định nó nằm **cạnh nhị phân dưới `%ProgramFiles%`**. Ghi vào đó **đòi nâng
quyền**. Và ai nâng được quyền để ghi `fleet.json` thì **cũng ghi được các DLL nằm ngay cạnh** —
nên với kẻ tấn công ấy, bản giam này **không mua được gì**. Đây là lý do mục này nhỏ, và mục nói
đúng.
*Chiều làm nặng, và mục 30 cũng nói ra:* trên **hai cách chạy phổ biến nhất hôm nay** — chạy từ thư
mục build và chạy bản triển lãm — thư mục ấy **ghi được bởi người dùng thường**. Cộng với `--fleet`
ở trên, tập "ai ghi được" **không** đóng lại ở "quản trị viên".

**Nhưng cái mục này thực sự mua được KHÔNG phải là an ninh, và nói thẳng thì đúng hơn.** Thứ duy
nhất tới được qua đường này là một file JSON bị deserialize thành `MappingProfile` — **không thực
thi, không ghi**. Cái bản giam mua được là: (1) một câu trả lời **ghi lại được** cho câu hỏi ở tiêu
đề mục — *trường này là TÊN*, đúng như `README` §291/§305 và doc của
`MachineDescriptor.MappingProfile` **đã công bố từ đầu** (*"A profile NAME, not a path"*), nên bản
sửa làm **mã khớp với văn đã xuất bản** chứ không đổi hợp đồng; và (2) một **thông điệp từ chối** ở
chỗ trước đây im lặng nạp một file lạ.

**Cái gì hỏng nếu giam nó — mở trọn tập TRONG REPO, và nêu rõ biên của tập ấy.** Mọi giá trị
`mappingProfile` ở `HEAD`, liệt kê bằng `git grep --full-name -n -i 'mappingProfile"\s*:' HEAD --
':(top)'` **chạy từ gốc repo `D:\SOURCES\avi-aoi-sim`**: mười một entry trong `fleet.json` (bảy tên
trần, bốn `null`), hai trong `App.xaml.cs` (`null`), mười lăm trong các file test (`null`, và một
`"default"`), một trong `FleetHostProductModeRosterTests.cs` (`null`). **Không một giá trị nào chứa
dấu phân tách, đường dẫn tuyệt đối, hay `..`.** Và bảy file trong `mapping/` đều nằm **phẳng** trong
thư mục ấy. Nên **không có bản triển khai hợp lệ nào trong repo bị bản giam làm hỏng.**
🔴 **Biên của câu phủ định ấy, vì một câu phủ định tồn tại chỉ đúng nếu đã mở HẾT tập:** tập đã mở
là **repo này ở `HEAD`**, không phải đĩa của khách hàng. Một `fleet.json` do khách hàng viết, không
nằm trong repo, dùng đường dẫn tuyệt đối hay UNC — **AQ-1 không thấy được và không tuyên bố gì về
nó**. Đó là rủi ro thật của bản sửa này và nó được ghi ở đây chứ không giấu.
📎 **Và bản giam cố ý KHÔNG hẹp hơn mức cần:** một **thư mục con** của thư mục mapping
(`mapping/vendor-a/preset`) **vẫn nạp được**, vì nó vẫn ở trong. Chính mục này nêu thư mục con là
bản triển khai mà một bản sửa không được làm hỏng, nên nó có một bài test riêng.

🔴 **Cái bản giam KHÔNG làm, nêu tên thay vì để người đọc suy ra.** Biên là **TỪ VỰNG**: một symlink
hay junction **nằm trong** thư mục mapping mà trỏ ra ngoài thì `File.ReadAllText` vẫn đi theo, y như
trước. `Path.GetFullPath` không phân giải link, và AQ-1 **không** thêm `File.ResolveLinkTarget` —
phân giải link sẽ làm hỏng đúng những bản triển khai dùng symlink một cách hợp lệ, tức đúng thứ mục
này bảo không được làm hỏng. So sánh dùng `OrdinalIgnoreCase` vì mọi project trong solution nhắm
`net10.0-windows`; trên một hệ file phân biệt hoa thường luật này sẽ **quá lỏng**, không bao giờ quá
chặt, và doc của chính hàm nói ra điều đó.

**Nhân chứng ĐỎ ĐƯỢC + cặp đối chứng chạy TRỌN rồi hoàn nguyên.** Ba `[Fact]` thêm vào
`tests/St4i.EdgeCore.Tests/MappingProfileResolverTests.cs`. Nhánh đối chứng: thay lời gọi giam bằng
`var path = combined;` — **đúng biểu thức trước AQ-1** — dựng và chạy trọn bộ mười bài:
* **Gỡ bản sửa:** **ĐỎ** `An_ABSOLUTE_mappingProfile_pointing_outside_the_mapping_directory_is_refused_and_warns_what_to_fix`
  và **ĐỎ** `A_dotdot_mappingProfile_that_climbs_out_of_the_mapping_directory_is_refused_and_warns`; tám bài kia xanh.
* **Đặt lại:** **10/10 xanh.** File được hoàn nguyên từ một bản chép byte lấy trước khi đột biến, và
  `git diff` sau đó chỉ còn bản sửa cùng các bài test.
🔴 **Bài thứ ba KHÔNG phải nhân chứng, và nói ra là bắt buộc.**
`A_SUBDIRECTORY_of_the_mapping_directory_still_resolves_so_the_confinement_rejects_only_what_LEAVES`
**xanh ở CẢ HAI nhánh, theo cấu tạo**. Nó không đo bản sửa; nó là cái trần — canh cho bản giam không
bị vẽ chặt tới mức cũng chặn thư mục con. Một bài xanh hai phía không đo được gì **về bản sửa**, nên
nó được mang theo nhưng **không được đếm là bằng chứng**.

**Hằng số dịch: `EXPECT_EDGECORE` 1165 → 1168 (+3), tổng 2776 → 2779.** `EXPECT_WARNINGS` **ở lại
328**, đo trên một `-t:Rebuild` trọn sau bản sửa (`Build succeeded.`, `0 Error(s)`,
`328 Warning(s)`, 15/15). Cả hai con số **được ĐO trước, VIẾT sau**. Lần rebuild thứ nhất bị **loại
bỏ**: nó trả 14 lỗi `CS2001`, **toàn bộ** trong `St4iMachineSimulator_2whtdmpd_wpftmp.csproj` — đúng
cuộc đua WPF mà `verify-suites.sh` đã ghi — với quần thể C# Dev Kit của VS Code thường trú suốt (tám
`dotnet.exe`, cha là `Microsoft.VisualStudio.Code.ServiceHost`, lấy **hai mẫu** cách ~25 s và giống
hệt nhau cả hai lần).

**Cái KHÔNG bị đụng.** `OeeCalculator`: **không một dòng** — mục 16 **DỪNG**, xem khối đo
2026-08-21 của nó. `IUnsPublisher`: không một dòng. Không tên thành viên công khai nào bị đổi hay
thêm (hai thành viên mới đều `private static`). Không payload nào đổi. Không MSI, không
`publish-desktop/`.

**Bằng chứng:** `scripts/verify-suites.sh` khối `TASK AQ-1` ngay trên `EXPECT_EDGECORE`;
`.superpowers/sdd/items-16-21/task-1-report.md`.


## 18. Cổng Demo gác CHẾ ĐỘ chứ không gác BỘ SINH GIẢ: một route thứ hai trỏ cả fleet đang chạy vào một transport mất gói, và `GET /v1/mode` vẫn trả lời chế độ đã chọn

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AM-1 (đợt 7), xác nhận lại trên mã. **Đây là cái nặng
nhất trong sáu phát hiện của đợt 7 và nó vẫn là cái tôi đặt trước mặt anh đầu tiên.**

**Đo được cái gì — hai route đọc TRỌN.** `PUT /v1/mode` (`ModeEndpoints`) nhận `DemoModeGate` qua DI
và từ chối `TransportMode.Demo` bằng **400** *"Demo mode is not enabled on this deployment."* khi
`demoGate.Enabled` là `false`. `POST /v1/scenario` (`ScenarioEndpoints`) **không nhận `DemoModeGate`
ở bất kỳ đâu trên đường của nó** — chữ ký của nó là `(ScenarioRequest, FleetHost, HttpContext,
AuditRecorder, CancellationToken)`. Với `{"networkOutage": true}`, `FleetCore.ApplyNetworkOutageLocked`
gọi `SwitchableTransport.SetInner` với một `DemoTransport` dựng ở
`fakeErrorRate: OutageFakeErrorRate` = **0.9**.

**Và bề mặt trạng thái không nói ra:** `GET /v1/mode` trả `FleetHost.Mode` → `FleetCore.Mode` →
`TransportCoordinator.Mode`, tức chế độ người vận hành **đã chọn**; đường outage **cố ý không chạm**
nó (`ApplyNetworkOutageLocked(false)` gọi `ApplyMode(_transportCoordinator.Mode)` — đúng chế độ hiện
hành). Bề mặt duy nhất nói sự thật là pane API-trace, đọc `SwitchableTransport.Mode`.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EngineApi.Endpoints.ModeEndpoints` (nhánh gác);
`St4i.EngineApi.Endpoints.ScenarioEndpoints` (route `POST /v1/scenario`, `Policies.Engineer`);
`St4i.EdgeCore.Fleet.FleetCore.ApplyNetworkOutageLocked` và hằng số `OutageFakeErrorRate`;
`St4i.EdgeCore.Transport.SwitchableTransport.SetInner`; `St4i.EdgeCore.Transport.DemoTransport`;
`St4i.EdgeCore.Config.DemoModeGate`. **Không nhân chứng:** không file test nào trong cây nhắc cùng
lúc `/v1/scenario` và `DemoModeGate`; hai file chạm route ấy (`Auth/RbacPolicyTests`,
`Auth/AuditWiringTests`) kiểm quyền và audit, không kiểm cổng.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* trên một bản triển khai đã **TẮT** Demo — tức đã tuyên bố rằng máy này sẽ không bịa
dữ liệu — một Engineer vẫn đặt được cả fleet đang chạy sau một bộ bịa. Mọi reading được ack **tại
chỗ**, **không gì tới máy chủ hệ sinh thái**, và `GET /v1/mode` vẫn trả `Live`. Một bên nói "đang
Live", bên kia không gửi gì đi.
*Chiều ngược, và bỏ nó đi là nói sai:* đường ấy **có audit** — `scenario.apply` ghi một hàng audit
mang trọn scenario đã áp, `networkOutage` trong đó — và nó đòi `Policies.Engineer`, nên nó **không
ẩn danh và không vô quyền**. Nó cũng **hoàn nguyên được**: `ApplyNetworkOutageLocked(false)` trỏ lại
transport về chế độ hiện hành. Và outage scenario là một **tính năng kể chuyện** có chủ ý cho phòng
triển lãm; gác nó bằng cổng Demo sẽ lấy mất tính năng ấy khỏi mọi bản cài đã tắt Demo.

**Nếu KHÔNG quyết định.** Cờ `DemoModeGate` giữ **hai nghĩa cùng lúc** — *"đừng chào chế độ Demo"*
và *"đừng bao giờ bịa dữ liệu trên máy này"* — và hai nghĩa ấy cho hai câu trả lời khác nhau ở đúng
route này. Cho tới khi anh chọn một nghĩa, ai đọc tên cờ cũng sẽ đọc ra nghĩa thứ hai và tin rằng
nó đã được cưỡng chế.

### ✅ ĐÃ THI HÀNH 2026-08-21 (AR-1) — cổng nay gác **HAI** route, và **ba câu của mục này không sống sót qua phép đo**

**Đã làm gì.** `St4i.EngineApi.Endpoints.ScenarioEndpoints` nay nhận `DemoModeGate` và từ chối bằng
**400** — cùng hình dạng "400 thật thà" mà `PUT /v1/mode` đã dùng — trước khi `FleetHost.ApplyScenario`
chạy, nên một yêu cầu bị từ chối để nguyên scenario **và** transport của fleet đang chạy. Không audit row
(đúng luật thứ tự WS-D-D4). **Không trường mới nào được thêm vào payload đã xuất bản; không tên công khai
nào đổi.**

🔴 **Câu SAI thứ nhất — "một route".** Mục nêu `POST /v1/scenario`. Đo được: **HAI** route dẫn tới
`FleetCore.ApplyNetworkOutageLocked`. Preset xuất xưởng `"network-outage"`
(`FleetHost.Presets`, `new ScenarioConfig(1.0, 0.0, 0.0, true)`) tới đó qua **`POST /v1/scenario/preset`**,
mang **không** trường `networkOutage` nào trong thân request. Một bản sửa chỉ soi `ScenarioRequest` sẽ để
route ấy **mở toang**. Cổng vì thế soi **config của preset đã phân giải**, không soi tên preset — mọi entry
catalogue về sau được phủ mà không phải sửa dòng nào.

🔴 **Câu SAI thứ hai — "bề mặt duy nhất nói sự thật là pane API-trace".** `GET /v1/scenario`
(`Policies.Operator`) trả `ScenarioDto`, **có** trường `NetworkOutage` **và** một `StatusLine` gọi tên
outage. Đó là một bề mặt HTTP đã xuất bản, không phải một pane UI. **Nên câu hỏi thứ hai của brief —
"`/v1/mode`, `/v1/health`, hay một trường mới?" — có câu trả lời không cần trường nào: bề mặt nói thật ĐÃ
CÓ SẴN.** Điều kiện DỪNG về "thêm trường vào payload đã xuất bản" **không nổ**, vì không có đường nào phải
đi qua đó.

> 🔴 **RÚT MỘT NỬA CỦA ĐOẠN NGAY TRÊN — 2026-08-22 (AV-1), giữ NGUYÊN VĂN, không gạch ngang, không xoá một
> dòng nào.** Câu *"bề mặt nói thật ĐÃ CÓ SẴN"* **đúng theo đúng chiều AR-1 đo** — outage được yêu cầu ⇒
> outage được báo — và **SAI theo chiều ngược lại**: outage đã bị lấy đi ⇒ **vẫn được báo là còn**. Cơ chế
> đo được ở **mục 33**: `TransportCoordinator.ApplyMode` lắp lại một trong `{_live, _auto, _demo}` và thể
> hiện outage **không nằm trong tập ấy**, trong khi `FleetCore._scenario.NetworkOutage` **không ai xoá** —
> nên `GET /v1/scenario` trả `networkOutage: true` mỗi giây trên một fleet đang gửi dữ liệu thật. Hai
> đường nữa làm đúng thế: `PUT /v1/settings` trên host Live/Auto, và một `PUT /v1/mode` **không đổi giá
> trị** (áp lại mà **không phát** `ModeChanged`).
>
> **Cái được rút là LẬP LUẬN, không phải KẾT LUẬN.** Điều kiện DỪNG *"thêm trường vào payload đã xuất
> bản"* vẫn **không nổ**, và vẫn không nổ sau bản sửa của mục 33 — bản sửa ấy **không thêm trường nào**,
> nó đổi **NGHĨA** của `NetworkOutage` trên chính `GET` này từ *"đã yêu cầu"* sang *"đang lắp"*, hình dạng
> bản ghi y nguyên. Nên từ **2026-08-22** câu bị rút ở trên **đã trở lại thành đúng**, nhưng đúng vì một
> lý do khác với lý do AR-1 đưa: bề mặt ấy **không** sẵn nói thật — nó **được làm cho** nói thật.
>
> **Cổng của AR-1 KHÔNG bị ảnh hưởng** và bốn nhân chứng của nó **không dịch một bài nào**: cổng chạy
> **trước** `FleetHost.ApplyScenario` và quyết định *nhận hay từ chối*, không quyết định *báo cái gì*.
> Ba doc comment thừa hưởng cùng điểm mù (`ScenarioEndpoints`, `DemoModeGate.Enabled`,
> `TransportMode.Demo`) đã được đính chính **tại chỗ**, giữ nguyên văn câu cũ, kèm ngày.

**Tập `ScenarioConfig` — LIỆT KÊ TRƯỚC, ĐẾM SAU.** Bốn trường: `CycleRateMultiplier`, `ExtraDefectRate`,
`FaultRate`, `NetworkOutage`. **Đúng một** trường chạm **transport** — trục mà cờ này cai quản, theo doc
của chính `DemoModeGate` (*"nobody can switch this machine's transport to a fabricated fleet by mistake"*).
Ba trường kia đổi thứ **bộ mô phỏng sinh ra**; sản phẩm của chúng **vẫn đi tới máy chủ thật** và **vẫn
được `GET /v1/scenario` báo đúng giá trị**. Gác chúng sẽ không phải là nới nghĩa của cờ mà là tuyên bố
rằng một máy **mô phỏng** không được mô phỏng. **Nên `networkOutage` LÀ cái duy nhất — trên trục ấy — còn
tập ROUTE thì lớn hơn cái mục nêu.**

**Chiều ngược, giữ nguyên vì bỏ đi là nói một nửa.** Bản sửa này **lấy mất** kịch bản outage khỏi mọi bản
cài đã tắt Demo. Đó là mất mát năng lực thật, đúng như mục cảnh báo, và là **cái giá** của việc bắt cờ mang
**một** nghĩa thay vì hai. Đường bị đóng chưa bao giờ ẩn danh hay vô quyền — nó đã đòi `Policies.Engineer`
và đã ghi audit; thứ nó **chưa** có là khả năng bị **từ chối**.

**Nhân chứng ĐỎ ĐƯỢC + cặp đối chứng chạy trọn.** Bốn test trong
`tests/St4i.EngineApi.Tests/Auth/AuditWiringTests.cs`, cố ý là **HAI CẶP**: hai test đòi 400 khi cổng
**tắt**, hai test đòi outage **vẫn áp được** khi cổng **bật** và một preset không-outage **không bị ảnh
hưởng** khi cổng tắt. Không có cặp thứ hai, một bản build **xoá quách** tính năng triển lãm cũng sẽ xanh.
Cặp đối chứng: hai điều kiện cổng bị ép `false` → **`Failed: 2, Passed: 3`** (đúng hai test DemoDisabled
đỏ); hoàn nguyên, chạy lại → **`Passed: 5`**.

**Bằng chứng:** `scripts/verify-suites.sh` khối `AR-1` ngay trên `EXPECT_EDGECORE`;
`.superpowers/sdd/items-18-19-20-22-23-24/task-1-report.md`.

📎 **Hai doc comment đã nói đúng sự thật của mục này TỪ TRƯỚC** (`DemoModeGate.Enabled` và
`TransportMode.Demo` trong `Enums.cs`, cả hai do các đợt tài liệu của mục 12 viết). Chúng nay **sai theo
chiều ngược lại** và đã được sửa tại chỗ, giữ nguyên văn câu cũ kèm dấu 🔴 CORRECTED.

---

## 19. `TransportCoordinator` công bố bốn bộ truy cập như "cái nhìn của điều phối viên", và hai trong bốn KHÔNG ai đọc giá trị

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AM-1 (đợt 7), xác nhận lại trên mã.

📎 **Mục này mang HAI khuyết tật mà brief liệt kê riêng, và lý do gộp là chúng là MỘT quyết định
trên MỘT lớp.** Báo cáo nguồn (đợt 7 §7(1)) cũng viết chúng thành một phát hiện kèm một "người anh
em". Một phán quyết chỉ chạm `.Auto` sẽ để `.Demo` đứng nguyên trong cùng bộ tứ, mang cùng câu hỏi.

**Đo được cái gì — quần thể mở TRỌN ở SHA đã ghim.** `git grep` cho `\.Auto\b` trên **mọi** `*.cs`
của cây (kể cả `server/` và `client/`, không có trên đĩa): **mọi** lần xuất hiện đều là
`TransportMode.Auto`. **Không một lần nào là `TransportCoordinator.Auto`** — không chỗ gọi sản xuất,
không bài test, không `<see cref>`. Cùng phép đo cho `\.Demo\b`: đúng **một** lần trỏ vào
`TransportCoordinator.Demo`, và nó nằm trong doc comment của `St4iMachineSimulator.Services.FleetService`
— **một tham chiếu tài liệu, không phải một phép đọc**. Miền dụng cụ được kiểm chứ không giả định:
`git grep` trên `*.xaml` cho một binding tới `Auto`/`Demo` trả về **không gì**.

`Auto` không phải một trường trần: nó là `public AutoTransport Auto { get { lock (_gate) return _auto; } }`
— **nó lấy một khoá để trả lời một câu hỏi không ai hỏi**. `RebuildLive` duy trì cả hai trường dưới
khoá ở **mọi** lần biên tập Settings, và doc của chính `TransportCoordinator` mô tả bộ tứ
`Mode`/`Live`/`Demo`/`Auto` là cái nhìn đã công bố của nó. **Hai trong bốn là hư cấu đã công bố.**

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Transport.TransportCoordinator.Auto`,
`.Demo`, `.Live`, `.Mode`, `.RebuildLive`; `St4iMachineSimulator.Services.FleetService` (chỗ duy nhất
nhắc tên `.Demo`, trong văn xuôi).

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* đây là **bề mặt công khai đã chết** trên một assembly mà mục 25 đang hỏi đúng câu
"cái gì nên `public`". Nó cũng có một chi phí đọc thật: người đọc tiếp theo của lớp này sẽ tin rằng
bộ tứ ấy là hợp đồng và sẽ duy trì nó.
*Chiều ngược:* **xoá một thành viên công khai là một phép đổi hợp đồng**, và P-2 chi phối chính tả
thành viên công khai. Phép đo này chỉ đếm người đọc **trong cây này**; nếu `St4i.EdgeCore` được tiêu
thụ ở nơi khác, phép đếm im lặng về chuyện đó. Và giá của việc **giữ** hai bộ truy cập ấy hôm nay là
gần bằng không — hai `get` dưới một khoá đã có.

**Nếu KHÔNG quyết định.** Hai thành viên ở lại, tiếp tục được duy trì dưới khoá, tiếp tục đọc như
hợp đồng — và chúng sẽ xuất hiện lại trong mọi phép đo bề mặt công khai về sau, mỗi lần lại tốn đúng
phép liệt kê này để chứng minh chúng chết.

### ✅ ĐÃ THI HÀNH 2026-08-21 (AR-1) — **KHÔNG gỡ thành viên nào**; hai câu tài liệu SAI đã sửa, và cái khoá **KHÔNG bỏ được**

**Không thành viên công khai nào bị gỡ.** Chủ sở hữu chỉ phán GỠ cho **mục 23**. P-2 chi phối chính tả
thành viên công khai; `.Auto` và `.Demo` ở nguyên.

**Bề mặt ĐỌC, quét lại toàn cây ở SHA đã ghim.** Lệnh, chạy **từ GỐC REPO `D:\SOURCES\avi-aoi-sim`**:
`git grep --full-name -n -E '\.Auto\b' 3f6c8f54 -- ':(top)'` và cùng thế cho `\.Demo\b`. Quần thể **có**
`server/`, `client/`, `examples/` — chúng nằm trong commit dù sparse checkout để `server/` và `client/`
ngoài đĩa. Kết quả: **mọi** hit của `\.Auto\b` là `TransportMode.Auto` hoặc kiểu `AutoTransport` — **không
một hit nào** là `TransportCoordinator.Auto`. Với `\.Demo\b`, **đúng một** hit trỏ vào
`TransportCoordinator.Demo`, và nó là `<see cref>` trong doc comment của
`St4iMachineSimulator.Services.FleetService` — **một tham chiếu tài liệu, không phải một phép đọc**. Mục
đo đúng.

📎 **Nửa "nói ra sự thật" của mục này ĐÃ ĐƯỢC TRẢ TỪ TRƯỚC** — doc comment trên `.Demo` và `.Auto` đã ghi
đúng điều mục yêu cầu ghi, do đợt 7 của mục 12 (`dea8c104`) viết. Cho nên việc còn lại **không phải** viết
sự thật ấy lần nữa, mà là sửa **hai câu SAI** trong chính đoạn văn ấy:

🔴 **Câu SAI thứ nhất — một phủ định tồn tại KHÔNG có trần.** `.Auto` viết *"nothing **anywhere** reads
it"*. Không lệnh nào trong repo này lập được một phủ định trên tập **không giới hạn**. Đã bị giới hạn lại
thành đúng cái đã đo ("in this repository"), kèm câu nêu rõ **cái không đo được**: ai tiêu thụ
`St4i.EdgeCore` từ **ngoài** repo thì phép đếm này im lặng. (`.Demo` vốn đã tự giới hạn đúng — nay cả hai
mang cùng cái trần.)

🔴 **Câu SAI thứ hai — một so sánh sai sự thật.** `.Auto` viết *"It is the only member of this quartet with
no consumer at all; even `Demo` is at least referred to."* Nhưng `.Auto` **CÓ** được trỏ tới: bằng
`<see cref="Auto"/>` nằm **ba dòng phía trên**, trong chính summary của `.Demo`. Phân biệt thật hẹp hơn
nhiều — tham chiếu tới `.Demo` **ra khỏi file**, tham chiếu tới `.Auto` **không rời file**. **Cả hai đều
không có người đọc.** Câu cũ giữ nguyên văn trong đoạn sửa, không xoá.

🔴 **Cái khoá KHÔNG bỏ được — đo rồi mới từ chối.** `_auto` bị `RebuildLive` ghi lại **dưới đúng `_gate`
ấy**, nên `get` này là **nửa acquire** của một cặp release/acquire. Bỏ khoá đi thì một trường tham chiếu
được một luồng công bố và một luồng khác đọc **không còn hàng rào nào ở giữa**: gán tham chiếu là nguyên
tử nên **không có gì rách**, nhưng người đọc có thể quan sát một thực thể **cũ tuỳ ý**. Đó là **đổi ngữ
nghĩa**, không phải bỏ nghi thức — nên uỷ quyền *"bỏ cái khoá thừa **nếu bỏ được mà không đổi ngữ
nghĩa**"* **không** cho phép bỏ. Lý do ấy nay nằm trong doc, để phép đo này không phải chạy lại.

**Nhân chứng.** 🔴 **Đây KHÔNG phải một nhân chứng đỏ được** — mục này chỉ đổi **lời**, không đổi hành vi,
nên không có bài test nào đỏ được ở phía trước. Nhân chứng là **W-1 xanh ở ngọn nhánh** cộng phép quét
`:(top) --full-name` ở trên, chứng minh lời mới đúng. **Không hằng số nào dịch vì mục này.**

---

## 20. `TransportCoordinator` dispose cái nó THAY, và không có đường nào dispose cái CUỐI CÙNG

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AM-1 (đợt 7), xác nhận lại trên mã.

**Đo được cái gì.** `RebuildLive` gọi `oldLive.Dispose()` ở **câu lệnh cuối** của nó — có chủ ý, và
doc của chính nó giải thích cái `HttpClient` rò rỉ mà nó ngăn. Nhưng `TransportCoordinator` là
`public sealed class` **không** khai `IDisposable`/`IAsyncDisposable`, **không** có `Stop`, và
`oldLive.Dispose()` là lần gọi `Dispose` **duy nhất** trên `_live` trong cả lớp. Nên thực thể đang
được giữ lúc tiến trình kết thúc **không được ai dispose**.

🔴 **Đây KHÔNG phải một khẳng định rò rỉ trên sản xuất, và nói một chiều ở đây là nói sai.** Hai
composition root của sản phẩm — `St4i.EngineApi/Program.cs` và `St4iMachineSimulator/App.xaml.cs`,
**hai chỗ `new TransportCoordinator(` duy nhất dưới `src/`** — đều đăng ký nó là **singleton** DI,
nên đúng **một** cái được dựng cho mỗi tiến trình và hệ điều hành thu hồi socket pool của nó lúc
thoát. Chỗ nó **không** vô hại là một tiến trình dựng **NHIỀU** cái: các bộ test làm đúng thế, ở
vài chục file, mỗi file để lại một `LiveTransport` chưa dispose trong suốt đời test host.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Transport.TransportCoordinator` (khai báo lớp,
`RebuildLive`); `St4i.EdgeCore.Transport.LiveTransport`; hai chỗ đăng ký singleton trong
`St4i.EngineApi.Program` và `St4iMachineSimulator.App`.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* đây là một **bất đối xứng trong quy tắc sở hữu do chính lớp ấy tuyên bố** — nó nhận
trách nhiệm dispose ở một nửa vòng đời và bỏ nửa kia. Bất đối xứng ấy là thứ người đọc sau sẽ suy ra
sai theo cả hai hướng.
*Chiều ngược:* thêm một đường dispose **kéo theo một câu hỏi sở hữu**: điều phối viên **không** sở
hữu `switchable` hay `demo` (chúng được truyền vào), nên một `Dispose()` ngây thơ sẽ dispose thứ
không phải của nó. Và trên sản xuất, giá hôm nay là **không** — một tiến trình, một thực thể, thu
hồi lúc thoát.

**Nếu KHÔNG quyết định.** Hành vi giữ nguyên; chi phí ở lại trong các test host; và quy tắc sở hữu
của lớp ở lại đúng một nửa, không có gì trong cây nói ra nửa còn lại.

### ✅ ĐÃ THI HÀNH 2026-08-21 (AR-1) — đường tắt máy có thứ tự, và **câu hỏi sở hữu mà mục nêu KHÔNG tồn tại được**

**Đã làm gì.** `TransportCoordinator` nay khai `IDisposable`. `Dispose()` gỡ đăng ký
`_auto.FallbackChanged` rồi dispose **đúng `_live`**, dưới `_gate`, **idempotent** (một container DI dispose
singleton của nó và một test cũng dispose nó thì không đánh nhau). **Thêm** một thành viên công khai —
không **đổi** hay **gỡ** tên nào.

🔴 **Cái trần của mục GIỮ NGUYÊN, và nói lại ở đây vì nói quá chính là lỗi mục này tồn tại để sửa: ĐÂY
KHÔNG PHẢI MỘT KHẲNG ĐỊNH RÒ RỈ TRÊN SẢN XUẤT.** Hai composition root đăng ký lớp này là **singleton** DI
— một thực thể mỗi tiến trình, socket pool được HĐH thu hồi lúc thoát dù có hay không có bản sửa này. Chỗ
thực sự đang trả giá là tiến trình dựng **NHIỀU** coordinator: chính các bộ test, ở vài chục file.

🔴 **Câu hỏi sở hữu mà mục nêu KHÔNG NỔ ĐƯỢC, và đó là một phép đo chứ không phải một lựa chọn.** Mục lo
rằng *"một `Dispose()` ngây thơ sẽ dispose thứ không phải của nó"*. Đo được: trong bốn transport lớp này
chạm, **chỉ `LiveTransport` là `IDisposable`**. `SwitchableTransport`, `DemoTransport` và `AutoTransport`
**không khai `Dispose` nào cả** — nên không có gì trên chúng để gọi nhầm. Điều đó khớp đúng cái ctor của
chính lớp đã tuyên bố: `switchable` và `demo` **không** sở hữu, `initialLive` **có** ("owned, but only
partly"). Nay sở hữu **trọn**. Doc của `initialLive` — vốn tự nói rằng lớp này *"has no shutdown path of
its own"* — đã được sửa, vì để nguyên là để lại một câu sai.

**Nhân chứng ĐỎ ĐƯỢC + cặp đối chứng chạy trọn.** Bốn test mới,
`tests/St4i.EdgeCore.Tests/Transport/TransportCoordinatorDisposalTests.cs`. Disposal được quan sát qua
**chuỗi thật** (`Dispose` → `LiveTransport.Dispose` → `St4iDeviceClient.Dispose` → `HttpClient.Dispose` →
handler; SDK dựng client bằng `new HttpClient(handler)` và overload ấy mặc định `disposeHandler: true`),
không qua một cờ đại diện. Cặp đối chứng: **thân** `Dispose()` bị làm rỗng, chữ ký giữ nguyên →
**`Failed: 3, Passed: 1`** — ba test nửa MỚI đỏ, còn
`RebuildLive_StillDisposesTheReplacedLiveTransport` **vẫn xanh**, đúng cái chứng minh cặp này **phân biệt
được** chứ không cùng nhau nhúc nhích. Hoàn nguyên, chạy lại → **`Passed: 4`**.
`EXPECT_EDGECORE` 1168 → 1171 (+4 ở đây, −1 ở mục 23).

---

## 22. Hai chuỗi đã xuất bản hứa những ack *"failed"* mà `DemoTransport` không bao giờ trả

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AM-1 (đợt 7), xác nhận lại trên mã.

**Đo được cái gì — cả hai chuỗi trích nguyên văn, và cả ba nhánh mở trọn.** Doc comment của
`ScenarioConfig.NetworkOutage` nói: *"acks come back queued/failed while the fleet keeps running"*.
Dòng trạng thái người vận hành nhìn thấy, `St4i.EngineApi.Fleet.Dtos`, nói: *"network outage (acks
queued/failing)"*. Đo trên `DemoTransport.SendAsync`: **mọi** nhánh trả `Success: true` — nhánh
queued trả `TransportAck(Success: true, Queued: true, …)`, `AckProcessResult` và `AckInspection` trả
`Success: true, HttpStatus: 201`, `AckTelemetry` trả `Success: true, HttpStatus: 202`. **Không nhánh
nào trả một ack thất bại.** `_fakeErrorRate` chỉ quyết định `ShouldSimulateQueued`, tức tỉ lệ đi vào
nhánh **queued** — không phải tỉ lệ hỏng.

📎 **Cả hai chuỗi nằm NGOÀI cụm mà đợt 7 trả, nên đợt ấy cố ý KHÔNG rút chúng tại chỗ** — với ra
ngoài ranh giới của mình để sửa hai file khác là một việc khác. Chúng vẫn đứng nguyên văn hôm nay.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Engine.ScenarioConfig.NetworkOutage` (doc comment);
`St4i.EngineApi.Fleet.Dtos` (dòng `outageText`); `St4i.EdgeCore.Transport.DemoTransport.SendAsync`,
`.AckProcessResult`, `.AckInspection`, `.AckTelemetry`, `.ShouldSimulateQueued`;
`St4i.EdgeCore.Fleet.FleetCore.ApplyNetworkOutageLocked`.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* người vận hành đang chạy kịch bản outage được **hứa** rằng họ sẽ thấy ack hỏng, và họ
sẽ **không bao giờ** thấy. Nếu ai đó dùng kịch bản này để nghiệm thu cách sản phẩm xử lý ack hỏng,
phép nghiệm thu ấy **luôn xanh** và **không chứng minh gì**.
*Chiều ngược:* hành vi hiện tại có thể mới là hành vi ĐÚNG. Một outage mạng nhìn từ phía biên
**là** "xếp hàng", không phải "thất bại" — sản phẩm đệm rồi phát lại. Nếu vậy thì cái sai là **hai
chuỗi**, và phép sửa là văn chứ không phải mã. Nhưng hai chuỗi ấy là **văn đã xuất bản** ở hai lớp
khác nhau, một trong hai người vận hành đọc thấy, nên sửa chúng cũng là một quyết định về cái sản
phẩm này **hứa**.

**Nếu KHÔNG quyết định.** Hai chuỗi ở lại; kịch bản outage tiếp tục được mô tả bằng một hành vi nó
không có; và câu *"nên `DemoTransport` trả ack hỏng hay không"* — câu duy nhất quyết được — không ai
hỏi.

### ✅ ĐÃ THI HÀNH 2026-08-21 (AR-1) — sửa LỜI, không đổi hành vi. 🔴 **Và "hai chuỗi" là một phép ĐẾM THIẾU: đo được SÁU**

**Hành vi KHÔNG đổi.** `DemoTransport` không bị đụng. Mục cho hai đường và bảo đừng tự chọn; phép đo chọn
đường **sửa lời**, vì hành vi hiện tại là hành vi **đúng** và nguồn sự thật đã tự nói thế: doc của chính
tham số `fakeErrorRate` ghi *"Despite the name it fabricates no ERRORS … NO path through this class ever
returns an unsuccessful ack."* Mọi nhánh của `SendAsync` trả `Success: true`; `0.9` là tỉ lệ đi vào nhánh
**queued**, không phải tỉ lệ hỏng — **tham số bị đặt sai tên, và cái sai ấy là thứ các chuỗi kia chép
lại.**

🔴 **ĐẾM THIẾU — mục nêu HAI, đo được SÁU chỗ trong mã `.cs`, ở năm file và ba thứ tiếng:**

1. `St4i.EdgeCore.Engine.ScenarioConfig.NetworkOutage` (doc comment) — *"acks come back queued/failed"*. **Mục nêu.**
2. `St4i.EngineApi.Fleet.Dtos.BuildStatusLine` — *"network outage (acks queued/failing)"*. **Mục nêu.**
3. 🔴 `St4iMachineSimulator.ViewModels.ScenarioViewModel.RefreshStatusLine` — *"MẤT MẠNG (ack sẽ queued/lỗi)"*. **Mục KHÔNG nêu**, và đây là dòng mà vận hành viên **WPF** thực sự đọc.
4. 🔴 `St4i.EngineApi.Fleet.FleetHost.Presets` — mô tả preset `"network-outage"`: *"store-and-forward loi cao (~90%)"*. **Mục KHÔNG nêu**, và chuỗi này được **`GET /v1/scenario` phục vụ**.
5. 🔴 `ScenarioViewModel.BuildPresets` — *"store-and-forward lỗi cao (~90%) — API Inspector sẽ hiện các dòng queued/lỗi"*. **Mục KHÔNG nêu.**
6. `St4iMachineSimulator/App.xaml.cs` — doc comment của selftest, *"must make acks come back queued/failed"*. **Để nguyên**: nó mô tả ý định của bài selftest, và bài ấy chấp nhận `Queued`, nên nó không hứa sai với người vận hành.

**Năm chỗ đầu đã sửa** cho đúng phép đo (queued, không bao giờ failed; ~90% là tỉ lệ **queued**).

🔴 **BỐN CHUỖI NỮA ĐO ĐƯỢC MÀ CỐ Ý KHÔNG ĐỤNG, vì nêu thiếu còn tệ hơn:** `web/src/i18n/en.ts` và
`vi.ts` mang *"high-failure store-and-forward"* / *"lỗi cao"* ở hai khoá mỗi file (`networkOutageHint` và
mô tả preset). Chúng **sai cùng một kiểu**. Không sửa ở đây vì `web/` đi qua cổng xuất bản web của bản
build — một trục rủi ro khác với sáu chỗ trên — và mục này được giao là một mục **đổi lời trong mã .NET**.
**Đây là việc còn nợ, ghi lại chứ không im lặng.**

**Về "đổi payload".** Chỗ (2) và (4) là **giá trị** chuỗi trong payload `GET /v1/scenario`. **Hình dạng
không đổi**: cùng record, cùng số thành viên, cùng trường `StatusLine`. Chỉ câu **bên trong** thôi hứa một
thứ không bao giờ xảy ra. Mục đã tự nêu đích danh chuỗi `outageText` của `Dtos` là thứ phải sửa, nên việc
này nằm trong uỷ quyền — **nhưng nó được ghi ra ở đây thay vì làm lặng lẽ.**

**Nhân chứng.** 🔴 **KHÔNG phải một nhân chứng đỏ được** — mục chỉ đổi lời. Nhân chứng là **W-1 xanh ở
ngọn nhánh** cộng phép đo trên `DemoTransport.SendAsync` (mọi nhánh, mở trọn) chứng minh lời mới đúng.
**Không hằng số nào dịch vì mục này**, và **không** test nào khẳng định chuỗi cũ theo nguyên văn (đã quét
trước khi sửa) — nên không bài test nào phải đổi theo, và điều đó cũng là một phép đo chứ không phải may.

---

## 23. `IUnsPublisher.PublishBirth`/`PublishDeath` được khai, được cài đặt đầy đủ, và KHÔNG có caller nào dưới `src/`: chưa DBIRTH nào từng được phát

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AN-1 (đợt 8), xác nhận lại trên mã.

**Đo được cái gì — quần thể mở TRỌN ở SHA đã ghim.** `git grep` cho `PublishBirth|PublishDeath` trên
mọi `*.cs` của cây: khai báo trong `IUnsPublisher`; cài đặt trong `UnsPublisher` (kèm mã hoá
DBIRTH/DDEATH đầy đủ và phép reset bảng alias); phép điều phối work-item **bên trong chính
`UnsPublisher`**; một `<see cref>` trong `UnsTopicBuilder`; và ở `tests/`, **năm** file —
`EdgePipelineTests`, `Uns/UnsNodeLifecycleTests`, `FleetHostGateCommitCompletionTests`,
`FleetHostUnsLifecycleTests`, `Line/LineControllerTests`. 📎 **Con số ấy đọc *"bốn"* cho tới
2026-08-20 và được sửa cùng ngày (AO-1): lần quét đầu bị `head` cắt cụt, và phép đo lại chạy từ
GỐC REPO — xem khối rút ở mục 29 để biết vì sao chỗ đứng khi gõ lệnh là một phần của miền dụng cụ.**
**Không route, không service, không đường nào dưới `src/` gọi chúng** — và phép phủ định ấy đã được
đo lại ở miền rộng hơn, nó đứng vững.
Đối chiếu: `PublishNodeBirth`/`PublishNodeDeath` **có** caller thật trong `FleetCore`, từ các chuyển
trạng thái Start/Stop/E-stop.

🔴 **Cùng họ, cùng lớp, đo cùng lúc và nêu ở đây vì bỏ nó đi là nêu một nửa:** các chuỗi `WithWill`
và `LastWill` **không xuất hiện trong một file `.cs` nào** của cây. Nên NDEATH chỉ được phát khi
tiến trình này **tự chọn** phát; một lần bị kill đột ngột không phát gì. Và `SparkplugMsgType.NDATA`
**không bao giờ được phát** — tham chiếu duy nhất ngoài khai báo là một unit test về hình dạng topic.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Uns.IUnsPublisher.PublishBirth`/`.PublishDeath`;
`St4i.EdgeCore.Uns.UnsPublisher.PublishBirthCoreAsync`/`.PublishDeathCoreAsync`;
`St4i.EdgeCore.Uns.UnsPublisher.PublishNodeBirth`/`.PublishNodeDeath` (đối chiếu, có caller);
`St4i.EdgeCore.Fleet.FleetCore` (chỗ gọi node-level); `St4i.EdgeCore.Uns.UnsTopicBuilder`
(`SparkplugMsgType`, kể cả `NDATA`).

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* một subscriber Sparkplug **không bao giờ thấy DBIRTH** cho bất kỳ thiết bị nào trên
xương sống này, nên **bảng alias mà DBIRTH sinh ra để thiết lập không bao giờ được phát**, và mọi
DDATA mang alias mà subscriber không có giấy khai sinh. Đó là một sai lệch so với chính giao thức mà
lớp này tự nhận cài đặt.
*Chiều ngược:* đây là một **hoãn có chủ ý đã ghi**: doc của `UnsTopicBuilder` từ G2-2/G2-3 nói rõ
sequencing birth/death nằm ngoài phạm vi. Nối dây nó **là một phép đổi hành vi giao thức** kèm luật
sequencing (chỉ NBIRTH được reset bộ đếm chuỗi của edge node) và kèm một câu hỏi về MQTT Will chưa
ai trả lời. Hoãn tiếp cũng là một lựa chọn hợp lệ — **miễn là nó được ghi là một lựa chọn**.

**Nếu KHÔNG quyết định.** Hai phương thức ở lại trên một interface đã xuất bản, đọc như một khả năng
đang có. Bất kỳ ai tích hợp theo interface ấy sẽ cho rằng device birth được phát, vì interface nói
thế và cài đặt có ở đó.

### ✅ ĐÃ GỠ 2026-08-21 (AR-1) — **PHÁN QUYẾT CỦA CHỦ SỞ HỮU**. Tiền đề đã đo lại toàn cây và **ĐỨNG VỮNG**; giá P-2 ghi ở đây

🔴 **TIỀN ĐỀ ĐƯỢC KIỂM LẠI TRƯỚC KHI GỠ, VÌ PHÁN QUYẾT DỰA HẲN LÊN NÓ.** Một câu phủ định tồn tại chỉ
đúng nếu đã mở **hết** tập. Lệnh, chạy **từ GỐC REPO `D:\SOURCES\avi-aoi-sim`** (chỗ đứng là một phần của
miền dụng cụ — xem mục 32):

`git grep --full-name -n -E 'PublishBirth|PublishDeath' 3f6c8f54 -- ':(top)'`

Quần thể **gồm** `server/` (1589 file), `client/` (711 file) và `examples/` (10 file) — chúng nằm trong
commit; sparse checkout để `server/` và `client/` ngoài đĩa, **`examples/` thì CÓ trên đĩa** và hai file
`.cs` của nó là **hai file `.cs` duy nhất của repo nằm ngoài `tools/machine-simulator/`** (một trong hai,
`St4iDeviceClient.cs`, được `<Compile Include>` thẳng vào `St4i.EdgeCore`). **Kết quả: mọi hit đều nằm
dưới `tools/machine-simulator/`. KHÔNG caller nào ở `server/`, `client/` hay `examples/`.** Điều kiện DỪNG
mà điều phối viên đặt ra **không nổ**; phán quyết GỠ được thi hành.

Tập đầy đủ, đúng như mục ghi: khai báo trong `IUnsPublisher`; cài đặt trong `UnsPublisher`; điều phối
work-item nội bộ; một `<see cref>` trong `UnsTopicBuilder`; và **năm** file test.

🔴 **CÁI GIÁ, GHI VÀO ĐÂY VÀ KHÔNG GIẤU: P-2 nói cách viết tên một thành viên công khai LÀ hợp đồng đã
xuất bản. Gỡ hai thành viên khỏi một interface công khai làm HỎNG BIÊN DỊCH của bất kỳ ai đang cài đặt
hoặc gọi nó, và phép đo trên chỉ chứng minh được rằng KHÔNG CÓ CALLER TRONG REPO NÀY. Ai tiêu thụ
`St4i.EdgeCore` từ bên ngoài thì KHÔNG một lệnh nào ở đây đo được. Chủ sở hữu phán GỠ khi đã biết điều
đó.**

🔴 **MỘT NHÂN CHỨNG HỒI QUY BỊ XOÁ, và đó là một mất mát chứ không phải một lần dọn dẹp.**
`UnsNodeLifecycleTests.PublishBirth_DeviceLevelDbirth_DoesNotResetTheNodeSequence` là **bài test duy nhất
trong cây GỌI** `PublishBirth` (bốn file còn lại chỉ **cài đặt** nó trên fake). Nó ghim bản sửa G2-3 cho
một DBIRTH từng reset sai bộ đếm chuỗi của edge node, và ghim bằng **giá trị phân biệt được** (seq 2, chỗ
lỗi cũ cho 1) chứ không bằng một phép kiểm "khác 0" lỏng. Mất mát **bị chặn** — chỉ bị chặn — vì đường mã
nó canh **không còn tồn tại**: nay không gì trong repo này phát DBIRTH. Các guard "NBIRTH **phải** reset"
trong cùng file **không đụng tới**. Nếu một ngày đường DBIRTH quay lại, **bài test này phải quay lại cùng
nó**. `EXPECT_EDGECORE` −1 vì đúng bài này.

🔴 **BỀ MẶT CHẾT NAY RỘNG HƠN, KHÔNG HẸP HƠN — nói ra vì nêu một chiều là nửa sự thật.**
`SparkplugMsgType.DBIRTH`/`.DDEATH` và khả năng dựng topic của chúng **ở lại** (gỡ thành viên enum là một
phép đổi hợp đồng **thứ hai** mà phán quyết không phủ), nhưng nay **không gì sản xuất ra hai loại thông
điệp ấy**. Cùng thế, `SparkplugAliasTable.Reset()` mất caller duy nhất. Cả hai đã ghi vào doc tại chỗ.

**Cảnh báo: `EXPECT_WARNINGS` KHÔNG DỊCH, và con số ấy được ĐO chứ không đoán.** Brief cảnh báo rằng gỡ
hai thành viên **có tài liệu** có thể làm cảnh báo dịch. Đo trên một `-t:Rebuild` trọn vẹn sau khi gỡ:
vẫn **328**. Lý do: cả hai đều **đã có** doc comment nên không sinh CS1591 nào để mất đi, và ba `<see
cref>` trỏ vào chúng đã được đổi sang `<c>` trong cùng lần sửa nên **không** CS1574 nào xuất hiện.

---

## 24. `ModbusOptions`/`OpcUaOptions` công bố hằng số TÊN biến môi trường — và ĐÂY LÀ CHỖ PHÉP ĐO CỦA ĐỢT 8 NÓI SAI

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AN-1 (đợt 8) 🔴 **và đo lại bởi nhiệm vụ này, cho một
kết quả KHÁC.**

**Đo được cái gì — LIỆT KÊ TRƯỚC.** Bảy hằng số `public const string` mang tên biến môi trường trên
hai lớp: `ModbusOptions.EnvVarEnabled`, `.EnvVarHost`, `.EnvVarPort`, `.EnvVarMapPath`;
`OpcUaOptions.EnvVarEnabled`, `.EnvVarEndpoint`, `.EnvVarMapPath`. Đo người đọc, ở SHA đã ghim, trên
**cả** dạng gọi tên đủ đường dẫn:

* **Hai cái CÓ người đọc bên ngoài file khai báo:** `ModbusOptions.EnvVarMapPath` và
  `OpcUaOptions.EnvVarMapPath`, cả hai được **`St4i.EngineApi/Program.cs`** gọi tên (dạng đủ đường
  dẫn `St4i.EdgeCore.Drivers.Modbus.ModbusOptions.EnvVarMapPath`), trong hai thông điệp lỗi khởi
  động.
* **Năm cái còn lại không có người đọc nào ngoài file khai báo của chính chúng.**
* 🔴 **KHÔNG file `.cs` nào dưới `src/` ngoài hai file khai báo mang bất kỳ chuỗi nào trong bảy
  chính tả ấy ở dạng literal.** Cả hai host sản xuất lấy giá trị qua `ModbusOptions.FromEnvironment()`
  / `OpcUaOptions.FromEnvironment()`, tức **qua chính hằng số**, không qua một bản sao.
* Bản sao chính tả **có tồn tại**, nhưng ở ba chỗ khác: `README.md` (hai bảng biến môi trường,
  §16.4 và §16.6) và **hai file test** — `tests/St4i.EngineApi.Tests/ConnectorEndpointsTests.cs` và
  `…/ConnectorEndpointsEnvSeedingSideEffectsTests.cs` — cả hai gọi
  `Environment.SetEnvironmentVariable("ST4I_MODBUS_ENABLED", …)` bằng literal.

🔴 **Nên hai câu của báo cáo đợt 8 được SỬA LẠI ở đây, và cái sai ấy là một phát hiện.** Đợt 8 viết:
*"the env-var name constants are published so a host can NAME the variable, and no host does: both
production hosts hardcode the literal instead"*, và §8(3) của nó nhắc lại rằng hai chuỗi ấy *"appear
hardcoded in BOTH `St4i.EngineApi` and `St4i.EdgeService`"*. **Cả hai nửa đều không đứng vững:** một
host **có** gọi tên hằng số (hai lần), và **không** host nào viết cứng chuỗi. Thứ đợt 8 đọc thấy
trong hai host là **dòng chú thích `//`**, không phải literal — `EdgeConnectors.cs` thậm chí đang
nói ngược lại (*"This host has NO environment-variable connector route at all — it has never read
ST4I_MODBUS_ENABLED/ST4I_OPCUA_ENABLED"*). 🔴 **Và bảng phân nhóm của chính đợt 8 đã mâu thuẫn với
văn xuôi của nó**: nhóm **C0 = 2** của nó nghĩa là *"chỉ `St4i.EngineApi` với tới, mà nó đã giữ
IVT"* — đúng hai hằng số `EnvVarMapPath` ấy. **Bảng đúng; đoạn văn cạnh bảng sai.** Cùng loài với
cái mà chính đợt 8 tự bắt được ở chỗ khác: *một phép grep cho dạng KHÔNG đủ đường dẫn không thấy
dạng ĐỦ đường dẫn.*

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Drivers.Modbus.ModbusOptions` (bảy hằng số và
`FromEnvironment`); `St4i.EdgeCore.Drivers.OpcUa.OpcUaOptions` (cùng thế, cộng `EnvVarPkiDir` đã
được `OpcUaPkiPaths.DefaultRoot` đọc); `St4i.EngineApi.Program` (hai chỗ gọi tên và hai chỗ gọi
`FromEnvironment`); `St4i.EdgeService.EdgeConnectors` (một chỗ gọi `FromEnvironment`);
`README.md` §16.4/§16.6; `ConnectorEndpointsTests`, `ConnectorEndpointsEnvSeedingSideEffectsTests`.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* **năm** hằng số công khai không ai đọc là bề mặt đã công bố mà không có mục đích còn
sống — đúng câu hỏi mục 25 đang hỏi trên cùng assembly. Và nguy cơ trôi chính tả **có thật nhưng
nằm chỗ khác**: giữa hằng số, bảng README, và hai file test; **không gì đỏ lên nếu ba bản ấy lệch
nhau**. Đó vẫn là hình dạng trùng lặp `DemoModeGate`/`DemoEnabledEnvVar` mà file này đã ghi một
lần — chỉ khác cặp.
*Chiều ngược:* hạ năm hằng số ấy xuống `internal` là **miễn phí về biên dịch** (không ai ngoài
assembly đọc) nhưng **không mua được gì**: bản sao thật là README và test, và chúng vẫn viết literal
sau đó. Giá trị thật của một hằng số công khai là để một **host bên ngoài** gọi tên biến — mà đúng
hai cái đã được gọi tên như thế, nên cơ chế ấy **đang hoạt động** chứ không chết hẳn.

**Nếu KHÔNG quyết định.** Năm hằng số ở lại trong 97 thành viên của mục 25 và tiếp tục được đếm ở
đó. Bản sao chính tả trong README và hai file test ở lại, không nhân chứng, và ngày một biến bị đổi
tên là ngày cả ba bản phải được nhớ cùng lúc.

### ✅ ĐÃ THI HÀNH 2026-08-21 (AR-1) — phép đo đã sửa **TỰ KIỂM LẠI VÀ ĐỨNG VỮNG CẢ HAI NỬA**; hai bản sao chính tả trong ba đã bị thu hồi

🔴 **Điều phối viên yêu cầu tự kiểm lại chính câu sửa của mục này, vì một mục nói sai là một phát hiện.
Đã kiểm. Nó ĐÚNG, cả hai nửa.** Lệnh, chạy **từ GỐC REPO `D:\SOURCES\avi-aoi-sim`**, ở SHA `3f6c8f54`,
`--full-name` kèm `':(top)'`:

* **Nửa một — "không file `.cs` nào dưới `src/` ngoài hai file khai báo mang bảy chính tả ấy ở dạng
  literal".** Quét dạng **có nháy** (`"ST4I_MODBUS_…"`/`"ST4I_OPCUA_…"`): dưới `src/` chỉ trả về
  `ModbusOptions.cs` và `OpcUaOptions.cs`. **ĐÚNG.** Quét dạng **trần** thì có thêm `Program.cs`,
  `EdgeConnectors.cs`, `ConnectorsConfig.cs`, `ConnectorConfigStore.cs`,
  `ConnectorConfigVisibilitySeeder.cs`, `WalOptions.cs`, `OpcUaNodeMap.cs` — **toàn bộ là dòng chú thích
  `//`, không dòng nào là literal**, đúng như mục đã sửa lại. Đợt 8 đọc chú thích thành literal.
* **Nửa hai — "`St4i.EngineApi/Program.cs` CÓ nêu tên hai cái, đầy đủ đường dẫn".** Trả về **đúng hai**
  chỗ, `Program.cs:1083` và `:1161`, dạng `St4i.EdgeCore.Drivers.Modbus.ModbusOptions.EnvVarMapPath` và
  cặp OPC-UA. **ĐÚNG.**
* **Một chi tiết mục nêu chưa đủ, ghi lại chứ không sửa ngầm:** ngoài hai chỗ ấy, `OpcUaDriver.cs:30`
  cũng **nêu tên** `OpcUaOptions.EnvVarPkiDir` trong một `<see cref>`. Không lật kết luận nào (mục vốn đã
  ghi `EnvVarPkiDir` có người đọc), nhưng phép liệt kê người-nêu-tên đầy đủ là ba chỗ, không phải hai.

**Đã làm gì — thu hồi hai trong ba bản sao chính tả.** `ConnectorEndpointsTests` và
`ConnectorEndpointsEnvSeedingSideEffectsTests` nay **gọi hằng số theo tên** (dạng đủ đường dẫn, cùng quy
ước `Program.cs` dùng) thay vì gõ lại chuỗi. Một lần đổi giá trị hằng số nay **tới được hai file test qua
biên dịch**. **Không** mức truy cập nào bị hạ, **không** tên công khai nào đổi, **không** hành vi nào đổi
— và đúng như chiều ngược của mục dự đoán, hạ năm hằng số xuống `internal` sẽ **không mua được gì**, nên
không làm.

🔴 **Bản sao thứ ba Ở LẠI, và cái trần ấy phải nêu:** hai bảng biến môi trường của `README.md` §16.4/§16.6
vẫn là bản chép tay **không có nhân chứng** — **không gì đỏ lên nếu chúng lệch**. Phép sửa này thu hẹp rủi
ro trôi chính tả từ ba bản xuống hai, **không** khử nó.

**Nhân chứng.** 🔴 **KHÔNG phải một nhân chứng đỏ được theo nghĩa của mục đổi hành vi** — nhưng nó **mạnh
hơn một nhân chứng chỉ-đọc**: hai file test giờ **không biên dịch được** nếu một trong bốn hằng số bị đổi
tên, nên bản thân việc W-1 xanh ở ngọn nhánh **là** phép kiểm rằng chúng khớp. **Không hằng số đếm test
nào dịch vì mục này** (số test không đổi, chỉ thân test đổi).

---

## 28. Lịch sử API-trace có BA cái trần, không phải một, và UI in GIÁ TRỊ của chúng chứ không gọi tên cái nào là TRẦN

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). 🔴 **Phát hiện gốc của điều phối viên — *"trần hiển thị 1.000
hàng trên 2.565 gói ghi nhận, và UI CÓ nêu tên trần"* — KHÔNG đứng vững nguyên trạng, và cả hai nửa
đều lệch.**

📎 **Điều phối viên hỏi mục này có đáng thành một mục không hay chỉ là một sự thật đã ghi. Lựa chọn
của tôi: nó ĐÁNG, nhưng KHÔNG vì lý do ban đầu.** Một trần đơn nêu tên đúng thì đúng là một sự thật
đã ghi. **Ba trần mà không cái nào được gọi tên là trần** là một mục, vì luật của chính file này
nói: *một cái trần nêu quá nhỏ còn tệ hơn không nêu trần* — và ở đây trần **không được nêu**, chỉ có
giá trị của nó được in ra.

**Đo được cái gì — LIỆT KÊ TRƯỚC.** Ba cái chặn, ở ba lớp:
1. **`EventBus.DefaultCapacity = 500`** — vòng đệm phía **server**, `Queue<ApiTraceEvent>`, khi đầy
   thì `Dequeue` cái cũ nhất. Đây là **toàn bộ lịch sử mà engine giữ**.
2. **`InspectorStream` backfill = `eventBus.Recent(200)`** — số sự kiện một tab **mới mở hoặc vừa
   kết nối lại** nhận được.
3. **`RING_CAPACITY = 1000`** trong `web/src/lib/inspector.ts` — vòng đệm phía **client**,
   mới-nhất-trước, cắt bằng `merged.slice(0, RING_CAPACITY)`.

**Nên "1.000" không phải cái trần đang chặn với ai vừa tải lại trang: 200 mới là, rồi tới 500.**
Vòng 1.000 của client chỉ đầy được bằng cách **ngồi mở suốt** trong lúc lưu lượng chảy — chính doc
comment của hằng số ấy nói thế (*"this is how much history the tab itself is willing to hold …, not
a mirror of the server's bound"*).

**Và nửa thứ hai: UI in giá trị, không gọi tên trần.** Phụ đề nói *"Live, envelope-by-envelope feed
of **every request the fleet sends** — 2.565 captured this session"*. Thanh trên bảng nói *"N shown
of 1.000 buffered"*. **Không chuỗi nào trong `web/src/i18n/en.ts` hay `vi.ts` chứa từ nào nghĩa là
"trần", "giới hạn", "đã rơi", hay "cũ hơn thì mất".** Người đọc thấy hai con số và phải **tự suy ra**
rằng khoảng cách giữa chúng là mất vĩnh viễn. Chữ *"every request"* trong phụ đề đẩy suy luận ấy đi
ngược hướng.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Infrastructure.EventBus.DefaultCapacity`;
`St4i.EngineApi.Hubs.InspectorStream` (chỗ gọi `Recent(200)`); `RING_CAPACITY` trong
`web/src/lib/inspector.ts`; `inspector.subtitle`, `inspector.shownLabel`, `inspector.ofBuffered`
trong `web/src/i18n/en.ts` và `vi.ts`; `web/src/routes/ApiInspector.tsx`.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* một người vận hành đọc *"every request the fleet sends"* và tin rằng pane là một bản
ghi đầy đủ. Trên một phiên triển lãm dài, nó là một cửa sổ trượt mà **cái cũ nhất bị bỏ im lặng**, ở
ba tầng khác nhau, và nút `Export` xuất **cửa sổ**, không xuất phiên. Ai xuất file ấy để làm bằng
chứng đang xuất một tập con mà không có gì trong file nói ra điều đó.
*Chiều ngược:* cả ba trần đều **có lý do đúng** — một pane chẩn đoán không được phép là một cái rò
bộ nhớ trên engine, trên dây, hay trong tab. Nâng chúng lên là mua thêm ký ức bằng RAM ở một tiến
trình đang chạy một fleet. Và **cách rẻ nhất để đóng mục này không phải nâng trần mà là gọi tên
chúng** — một chuỗi, không một dòng mã đường ống nào.

**Nếu KHÔNG quyết định.** Ba trần ở lại không được gọi tên, phụ đề ở lại hứa *"every request"*, và
khoảng cách giữa hai con số hiển thị ở lại là thứ mà chỉ người đọc mã mới giải thích được.

---


### 🔴 AS-1 (2026-08-21) — THI HÀNH. Cái trần thứ TƯ, và cái trần thứ HAI nay có TÊN

**Phán quyết:** 2026-08-21, **điều phối viên quyết theo uỷ quyền** (cùng khuôn mục 8, 15, 21) — mục này
không đổi payload MQTT, không đổi hình dạng dây, không đổi con số OEE nào.

🔴 **LIỆT KÊ TRƯỚC, ĐẾM SAU — VÀ PHÉP ĐẾM CỦA CHÍNH MỤC NÀY SAI. Có BỐN cái trần, không ba.** Quần thể
đo bằng `git grep --full-name <mẫu> <SHA> -- ':(top)'` **chạy từ gốc repo** trên `new EventBus(`,
`.Recent(`, `DefaultCapacity`:

| # | tên | giá trị | nguồn, trỏ bằng TÊN | tầng | cách nó bỏ |
|---|---|---|---|---|---|
| 1 | `EventBus.DefaultCapacity` | 500 | `src/St4i.EdgeCore/Infrastructure/EventBus.cs` — `public const` | vòng của engine | `Dequeue` cái cũ nhất |
| 2 | `InspectorStreamEndpoint.BackfillEventCount` | 200 | `src/St4i.EngineApi/Hubs/InspectorStream.cs` — 🔴 **TRƯỚC nhiệm vụ này là một literal `200` trần, không có tên nào để trỏ** | phát lại lúc kết nối WS | không phát cái cũ hơn |
| 3 | `RING_CAPACITY` | 1000 | `web/src/lib/inspector.ts` — `const` mức module | vòng của tab trình duyệt | `merged.slice(0, RING_CAPACITY)` |
| 4 | `InspectorViewModel.MaxEvents` (= `EventBus.DefaultCapacity`) | 500 | `src/St4iMachineSimulator/ViewModels/InspectorViewModel.cs` — `private const` | vòng của pane WPF | `Events.RemoveAt(Count-1)` |

🔴 **Cái thứ tư là phát hiện, và nó không phải một bản sao của cái thứ nhất.** Nó **lấy giá trị** từ
`EventBus.DefaultCapacity`, nhưng nó là một cái trần riêng ở một tầng riêng: dựng `EventBus` với một
capacity khác mặc định thì vòng WPF **vẫn** 500. Và nó đổi câu trả lời cho *"cái nào ràng buộc"*: mục
viết *"200 mới là cái ràng buộc, rồi tới 500"* — **đúng cho web, sai cho WPF.** Vỏ WPF backfill bằng
`Recent(MaxEvents)` = `Recent(500)`, không phải 200; với một người mở pane WPF, **500 là cái ràng buộc,
và 200 không tồn tại.** Mục 27 tự liệt kê `InspectorViewModel` là một bề mặt của cùng bản ghi, nên phép
bỏ sót này nằm trong tập mà chính mục đã mở.

📎 **Một câu phủ định tồn tại của mục được TRỎ LẠI, không sửa, vì nó đúng ở phạm vi nó ngụ ý và sai ở
phạm vi nó viết ra.** Mục viết: *"Không chuỗi nào trong `web/src/i18n/en.ts` hay `vi.ts` chứa từ nào
nghĩa là 'trần', 'giới hạn', 'đã rơi'…"*. Ở phạm vi **file**, câu ấy **SAI** — hai file ấy chứa
`limits.title` = *"Honest limitations"*, `droppedLabel` = *"Permanently dropped"*, `droppedWarning`, và
hàng chục chuỗi *"Giới hạn"*. Ở phạm vi **khối `inspector.*`** — cái mục thực sự nói tới — câu ấy
**ĐÚNG**, đo lại và xác nhận. Cùng loài §8.1(f) mà mục 29 đã trả giá: *một phép đo chỉ rộng bằng cái
mẫu sinh ra nó*, và ở đây "cái mẫu" là **phạm vi được viết ra so với phạm vi được nghĩ trong đầu**.

**Đã làm gì — hai chỗ, và cả hai là LỜI trừ một.**

1. **Cái trần #2 nay có TÊN.** Literal `200` trong `InspectorStreamEndpoint.RunAsync` thành
   `internal const int BackfillEventCount = 200`, kèm doc nói nó là cái chặn TRƯỚC TIÊN với ai vừa mở
   pane và nó **không được vượt** `EventBus.DefaultCapacity`. **Giá trị không đổi; hành vi không đổi.**
2. **Pane web GỌI TÊN các cái trần.** Chuỗi mới `inspector.capsNote` (en + vi), render thành một `<p>`
   riêng dưới phụ đề, nêu **cả ba** cái trần áp vào web **và cái nào chặn khi nào** — *"ngay sau khi tải
   lại trang thì 200 là cái chặn; qua một phiên dài thì 1000 mới là"* — cộng câu *"Xuất ghi ra CỬA SỔ
   này, không phải cả phiên"*. 🔴 **Nêu mỗi 1.000 sẽ tái tạo đúng lỗi cũ ở một tầng khác**, nên nó không
   được nêu một mình.
3. **Phụ đề thôi hứa *"every request"* / *"mọi request"*.** 🔴 **PHƠI BÀY, GHI CHỨ KHÔNG GIẤU:** đây là
   đổi **GIÁ TRỊ** một chuỗi người-đọc-được, không đổi hình dạng — theo tiền lệ điều phối viên chấp
   thuận 2026-08-21. Ai đang so khớp chuỗi ấy sẽ hỏng, và **người tiêu thụ ngoài repo không đo được**.
   Trong repo có **đúng một** người so khớp: `web/tests/03-inspector.spec.ts` bóc `stream.totalCount` ra
   khỏi chính câu ấy bằng `/([\d.,]+)\s*đã ghi nhận/` trên một `<p>`. **Mệnh đề đuôi
   `— {count} đã ghi nhận trong phiên này.` được giữ NGUYÊN VĂN vì lý do đó**, và `capsNote` cố ý là
   một `<p>` KHÁC nên bộ định vị ấy không nhặt nhầm.

**Cái KHÔNG làm, và vì sao.** Ba cái trần **không được nâng** — mục tự nói cả ba đều có lý do đúng, và
*"cách rẻ nhất để đóng mục này không phải nâng trần mà là gọi tên chúng"*. **Vỏ WPF không được đụng**:
nó không có phụ đề nào hứa *"every request"* (đo: `Strings.en.xaml` có **tám** chuỗi `Str_Inspector_*`,
không cái nào là một câu hứa), nên ở đó **không có lời sai để sửa** — chỉ có cái trần #4 chưa được gọi
tên, và gọi tên nó là một bề mặt WPF mới chứ không phải một phép sửa lời. **Dư lượng còn mở, ghi vào
mục chứ không để trong báo cáo.**

**Nhân chứng.** 🔴 **KHÔNG CÓ NHÂN CHỨNG ĐỎ ĐƯỢC CHO MỤC NÀY, và nói thẳng thay vì giả vờ có.** Phần
thi hành là **lời** (chuỗi i18n + một hằng số đổi tên, giá trị không đổi), và cổng không biên dịch
TypeScript — không suite nào trong năm suite đỏ lên được vì một chuỗi. Thứ có là: **W-1 xanh ở ngọn
nhánh**, **`npm run build` (`tsc -b && vite build`) xanh**, và **bảng bốn cái trần ở trên** làm phép đo
chứng minh lời mới đúng. Cộng `InspectorStreamBackfillCapTests` (hai `[Fact]`) — 🔴 **tự dán nhãn: đó là
GUARD TRẦN, KHÔNG PHẢI NHÂN CHỨNG.** Nó xanh ở cả hai phía của mọi cặp đối chứng để 200 nguyên chỗ. Nó
được kiểm **không rỗng** bằng một đột biến riêng (`BackfillEventCount` 200 → 600 ⇒ **cả hai đỏ**), rồi
hoàn nguyên.

📎 🔴 **MỘT CON SỐ TRONG CHÍNH GHI CHÉP NÀY ĐÃ DỊCH, VÀ MỘT CON SỐ DỊCH LÀ MỘT PHÁT HIỆN (§8.1(h5.1)) —
GHI CHỨ KHÔNG SỬA IM LẶNG.** Đoạn *"Cái KHÔNG làm"* ngay trên, khi được viết lần đầu (AS-1,
2026-08-21), nói `Strings.en.xaml` có **chín** chuỗi `Str_Inspector_*`. **Đo được là TÁM**
(`Str_Inspector_` + `Title`, `Pause`, `Resume`, `Clear`, `Export`, `Paused`, `Machine`, `Kind`).
**Người bắt được là chính AS-1**, sau khi đã viết, bằng cách đo lại sản phẩm của chính mình trước khi
hạ commit thứ hai — không phải người phản biện, và không phải cổng: **cổng không đếm chuỗi XAML, nên
nó đã xanh với con số sai và sẽ mãi xanh với nó.** Ý nghĩa, viết đúng cái nó là: con số ấy được dùng
làm **bằng chứng cho một phép phủ định** (*"vỏ WPF không có lời sai để sửa"*). Phép phủ định **vẫn
đứng vững** — tám chuỗi ấy đã được liệt kê ra và không cái nào là một câu hứa — nhưng nó **suýt được
chống bằng một phép đếm không ai đo**, đúng loài §8.1(b): *artifact ít được quét nhất là lời biện minh
của chính anh*. **Câu sai không bị xoá; nó được trích lại ở đây kèm ngày và người.**

---

## 29. Cả fleet liên kết ra ngoài bằng MỘT danh tính thiết bị, trong khi một route trả 200 cho việc lưu khoá của BẤT KỲ mã máy nào

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi điều phối viên 2026-08-20, **xác nhận lại trên mã** —
cơ chế **đứng vững**; một chi tiết trong lời kể **không đứng vững** và được sửa dưới đây.

**Đo được cái gì.** `FleetCore.UpdateSettings` — khi một lần biên tập cần dựng lại transport —
chạy `CredentialStore.Load(_machineCode)` rồi
`_transportCoordinator.RebuildLive(_serverUrl, _machineCode, mkKey, _verifyTls)`. **Số ít.**
`_machineCode` là một trường **một giá trị** của `FleetCore`, khởi tạo từ `DefaultMachineCode` và
ghi đè từ `persisted.MachineCode` (tức `settings.machineCode`). **Không đường nào trong `FleetCore`
nạp một khoá theo từng máy con.**

Ở đầu kia, `OnboardingService.PasteKey` gọi `CredentialStore.Save(req.MachineCode, req.MkKey)` — lưu
dưới **bất kỳ** mã máy nào người gọi đưa — và trả `OnboardingStepResult("Claimed", …)` với thông
điệp `$"Pasted mk_ key stored for {req.MachineCode}"`, mà `OnboardingEndpoints` gói thành
**`Results.Ok`**, tức **HTTP 200**. Nên: dán một khoá cho mã của một **máy con** thành công theo mọi
nghĩa mà route ấy đo, và **không có tác dụng gì** lên đường đi ra — `RebuildLive` vẫn chỉ nhận khoá
của `settings.machineCode`.

🔴 **Và hai chuỗi đã xuất bản trong UI đứng ngay cạnh nhau nói đúng hai chuyện ấy.** Cùng một khối
`settings.auth`: `machineCodeLabel` = *"Machine code used for authentication"* (số ít) và
`machineCodeHint` = *"The mk_ key saved for **this code** is used when Live/Auto connects to the real
server."* — rồi ngay dưới, một biểu mẫu riêng với `pasteCodeLabel` = *"Machine code"* và placeholder
*"e.g. SIM-0002"*, tức **mời người dùng dán một khoá cho một mã KHÁC**. Một bên nói đã lưu, bên kia
chỉ dùng một cái.

📎 **Một chỗ trong lời kể được trỏ lại chứ không sửa:** điều phối viên trỏ `FleetCore.cs:5313`. Số
dòng ấy **hôm nay vẫn đúng**, nhưng §8.1(h8) nói trỏ bằng **TÊN**: chỗ ấy nằm trong
`FleetCore.UpdateSettings`, trong nhánh `if (rebuildNeeded)`.

> 🔴 **MỘT CÂU PHỦ ĐỊNH TỒN TẠI TRONG CHÍNH MỤC NÀY — RÚT 2026-08-20 (AO-1), cùng ngày nó được
> viết, giữ NGUYÊN VĂN, không xoá dòng nào.** Câu ấy đọc: *"**Chuỗi ấy KHÔNG tồn tại trong cây** —
> `git grep` trên toàn bộ commit object không tìm thấy nó, và `LiveTransport` không có thành viên
> `IsConfigured` nào."* **Nửa sau đúng và ở lại** (`LiveTransport` thật sự không có `IsConfigured`).
> 🔴 **Nửa đầu SAI, và chuỗi ấy CÓ THẬT.**
>
> **Nó sai vì BA nguyên nhân chồng lên nhau, và phải nêu cả ba vì mỗi cái một mình đã đủ để hỏng
> phép đo.**
> **(1) DẤU.** Brief viết `khoá` (a-sắc); chuỗi thật là `khóa` (o-sắc). Hai cách viết đều hợp lệ
> trong tiếng Việt cho **cùng một từ**, và **một lần grep theo cách viết này không tìm ra cách viết
> kia**. Lỗi này do điều phối viên gieo vào brief và người thực thi kế thừa mà không kiểm.
> **(2) PATHSPEC — và đây là cái nặng nhất, nó là của người thực thi.** Mọi lệnh
> `git grep <SHA> -- .` và `git grep <SHA> -- '*.cs'` của nhiệm vụ này được chạy từ
> `tools/machine-simulator`, mà **pathspec của git là TƯƠNG ĐỐI VỚI THƯ MỤC HIỆN HÀNH**. Nên mọi
> lần quét ấy **âm thầm loại bỏ toàn bộ cây ngoài `tools/machine-simulator/`** — gồm `examples/`,
> **và gồm cả `server/` với `client/`, đúng hai cây mà lời khai miền dụng cụ tự nhận là đã với
> tới.** Phép kiểm quyết định: cùng một mẫu, chạy từ gốc repo, trả thêm
> `examples/device-client/csharp/St4iDeviceClient.cs`; chạy từ `tools/machine-simulator`, không trả.
> **Câu *"`git grep` trên commit object với tới cả cây"* đúng về LỆNH và sai về LẦN GỌI.**
> **(3) MIỀN.** Chuỗi không nằm ở `src/` hay `web/`. Nó nằm ở `examples/device-client/` — **file SDK
> vendored**, thứ **không ai trong repo này được sửa**.
>
> 🔴 **Ý nghĩa, viết đúng cái nó là: đây là §8.1(f), ca THỨ BA trong cùng một chuỗi, và ca này do
> chính người vừa bắt được hai ca trước tự sinh ra.** Hai ca kia nằm ở mục 15 và mục 24, cả hai là
> lỗi của báo cáo đợt 8. Ca này là lỗi của nhiệm vụ đang sửa chúng, mắc **trong cùng một phiên**, và
> nó là bằng chứng mạnh nhất cho câu mà chính nhiệm vụ ấy viết ở phần kết: **một phép đo chỉ rộng
> bằng cái mẫu sinh ra nó** — trong đó "cái mẫu" gồm cả **chính tả** lẫn **thư mục ta đứng khi
> gõ**.
>
> 📎 **Mọi câu phủ định tồn tại khác trong mười bảy mục đã được ĐO LẠI từ gốc repo sau phát hiện
> này, và tất cả đều đứng vững**: tập `Channel.CreateBounded` (mục 15), hai bộ truy cập `.Auto`/
> `.Demo` (mục 19), `PublishBirth`/`PublishDeath` và `WithWill`/`LastWill` (mục 23), bảy chính tả
> biến môi trường (mục 24), nhà sản xuất `OeeInputAggregate` và hai chỗ dựng `TransportCoordinator`
> (mục 16 và 20, cả hai với mẫu chịu-được-đủ-đường-dẫn), bốn file không được git theo dõi (mục 30),
> từ vựng "trần" trong hai file i18n (mục 28), trình xử lý click hàng trong `TraceTable` (mục 27),
> và phép phủ định về nhân chứng của route scenario (mục 18). **Đúng một con số phải sửa ngoài mục
> này: mục 23 ghi "bốn chỗ trong `tests/`", và tập là NĂM file** — cũng do một lần quét bị cắt bởi
> `head`.

🔴 **CHUỖI ẤY CÓ THẬT, VÀ CHỖ NÓ PHÁT RA LÀ MỘT CÁI TRẦN CỦA PHÁN QUYẾT — nêu ra chứ không để im,
vì một cái trần nêu quá nhỏ còn tệ hơn không nêu trần.** Đo lại từ gốc repo, trên **mọi** loại file:
chuỗi `"Chưa có khóa mk_…"` xuất hiện ở **đúng hai** file, cả hai dưới `examples/device-client/` —
bản C# (`St4iDeviceClient.cs`, một `throw new St4iConfigException`) và bản Python
(`st4i_device_client.py`). Bản Node của cùng SDK mang biến thể ngắn hơn, `"Chưa có mk_…"`.

**Đường nó lên tới mắt người vận hành, đo từng mắt xích:** SDK ném `St4iConfigException` →
`LiveTransport.SendAsync` bắt nó, và khi `_client.MkKey` rỗng — đúng ca "chưa cấu hình" — trả
`TransportAck(Success: false, Queued: true, Error: e.Message, …)`, **truyền nguyên văn thông điệp
của SDK** → `EdgePipeline` chép `Error: ack.Error` vào `ApiTraceEvent` → `EventBus` →
`InspectorStream` → **ô Error của một hàng trong pane API Inspector**. 📎 Tức bề mặt mà người vận
hành đọc câu ấy **chính là pane của mục 27** — pane chỉ có siêu dữ liệu; thông điệp này *là* siêu dữ
liệu, nên nó hiện ra, trong khi thứ sẽ giải thích nó thì không.

**Ba khả năng đã bị LOẠI TRỪ, nêu tên chứ không im lặng bỏ qua:**
1. *"`LiveTransport` bọc SDK và thay bằng lời của chính nó."* **Loại.** Nó truyền `e.Message` đi
   nguyên vẹn; thứ duy nhất nó tự quyết là **hình dạng ack** nào chở câu ấy (`Queued: true` cho ca
   chưa cấu hình, hay một 400 tổng hợp cho ca payload sai), phân biệt bằng `_client.MkKey`.
2. *"Một chỗ nào đó trong `src/`, `web/` hay `tests/` chép lại chuỗi ấy."* **Loại.** Ở gốc repo,
   trên mọi loại file, chuỗi chỉ có ở hai file vendored kể trên.
3. *"Người vận hành thực ra thấy một thông điệp khác do dự án này viết."* **Loại.** `EdgePipeline`
   chép `ack.Error` nguyên văn và không mắt xích nào giữa đường viết lại nó.

🔴 **Nên trần là: nếu anh phán *"làm cho thông điệp ấy nói đúng sự thật"* — chẳng hạn nói rõ nó đang
nói về mã máy NÀO — phán quyết ấy KHÔNG THI HÀNH ĐƯỢC ở chỗ nó phát ra.** File ấy là bản vendored
mà luật của dự án cấm sửa: doc của chính `LiveTransport` gọi nó là *"linked into this project
verbatim and never edited"*, và sổ cảnh báo của cổng ghim 103 cảnh báo vendored trong đúng file ấy
**chính vì không ai được đụng vào**. Hai chỗ **thi hành được**, cả hai trong `src/`: khối `catch
(St4iConfigException)` của `LiveTransport` — nó **đã** biết đang ở ca nào và biết mình gắn với mã
máy nào — hoặc lớp UI khi hiển thị `ApiTraceEvent.Error`. **Một phán quyết không nêu chỗ thi hành sẽ
rơi vào chỗ không thi hành được.**

📎 **Bản thay thế viết trước đó vẫn đứng nguyên và vẫn là nửa mạnh nhất của mục:** hai chuỗi
`settings.auth.machineCodeLabel`/`machineCodeHint` hứa một mã xác thực **duy nhất**, trong khi biểu
mẫu ngay dưới mời dán khoá cho một mã **khác**. Cái vừa thêm không thay nó — nó nói rằng **câu báo
lỗi ở đầu kia cũng có thật, và nằm ngoài tầm sửa**.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Fleet.FleetCore.UpdateSettings` và trường
`_machineCode`; `St4i.EdgeCore.Infrastructure.CredentialStore.Load`/`.Save`;
`St4i.EdgeCore.Transport.TransportCoordinator.RebuildLive`;
`St4i.EngineApi.Fleet.OnboardingService.PasteKey`; `St4i.EngineApi.Endpoints.OnboardingEndpoints`
(route `POST /v1/onboarding/paste-key`, `Policies.Engineer`);
`St4i.EngineApi.Fleet.OnboardingPasteKeyRequest`; `settings.auth.*` trong `web/src/i18n/en.ts` và
`vi.ts`. **Mắt xích của thông điệp, theo thứ tự:** `St4iDeviceClient.HttpSendAsync` và
`St4iConfigException` trong `examples/device-client/csharp/St4iDeviceClient.cs` (**vendored, cấm
sửa**) → khối `catch (St4iConfigException)` của `St4i.EdgeCore.Transport.LiveTransport.SendAsync` →
`St4i.EdgeCore.Models.TransportAck.Error` → `St4i.EdgeCore.Engine.EdgePipeline` →
`St4i.EdgeCore.Infrastructure.ApiTraceEvent.Error` → `St4i.EngineApi.Hubs.InspectorStream` → ô Error
trong `web/src/components/TraceTable.tsx`. Đối chiếu: `St4i.EdgeService.EdgeWorker` đọc
`CredentialStore.Load(machineCode)` cũng số ít, và doc của nó **nói thẳng** rằng Live mode gắn với
**đúng MỘT** cặp máy/khoá.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* một người vận hành làm đúng thứ UI mời họ làm — dán khoá cho từng máy con — nhận
**200 và một câu xác nhận có tên máy trong đó**, rồi thấy fleet vẫn không liên kết được. Cái đắt
không phải sự thất bại; cái đắt là **một xác nhận thành công cho một thao tác không có tác dụng**.
Trên một fleet nhiều máy, mọi máy đi ra dưới **một** danh tính, nên máy chủ hệ sinh thái không phân
biệt được chúng bằng khoá.
*Chiều ngược:* **một danh tính cho mỗi tiến trình biên có thể chính là mô hình đúng**, và
`EdgeWorker` ghi nó như một thiết kế chứ không phải một thiếu sót: tiến trình biên **là** thiết bị;
các máy con là điểm dữ liệu bên trong nó. Nếu vậy, cái sai không phải `FleetCore` mà là
**`PasteKey` chấp nhận một mã tuỳ ý** và **UI mời làm thế**. Sửa theo hướng đó là một phép **thu
hẹp** route (từ chối mã không phải `settings.machineCode`) — rẻ hơn hẳn, nhưng nó **lấy đi** một
đường mà một số cách dùng có thể đang dựa vào (lưu sẵn khoá trước khi đổi `machineCode`).

**Nếu KHÔNG quyết định.** Route ở lại trả 200 cho một thao tác không có tác dụng; hai chuỗi UI ở lại
nói hai chuyện; và câu duy nhất quyết được — **sản phẩm này có một danh tính hay nhiều?** — không ai
hỏi. Mọi công việc "fleet nhiều máy" về sau sẽ va vào đúng chỗ này. 🔴 **Và một hệ quả riêng của cái
trần nêu trên: câu báo lỗi mà người vận hành thực sự đọc được phát ra từ một file KHÔNG SỬA ĐƯỢC,
nên "cứ để đấy" ở đây không có nghĩa là "giữ nguyên trạng có thể sửa sau bằng một dòng" — mọi phép
sửa thông điệp, sớm hay muộn, đều phải xảy ra ở `LiveTransport` hoặc ở lớp UI, không ở chỗ câu ấy
được viết ra.**

---


### 🔴 AS-1 (2026-08-21) — THI HÀNH. Cơ chế mục mô tả KHÔNG đứng vững, và mục thiếu một bề mặt

**Phán quyết:** 2026-08-21, **điều phối viên quyết theo uỷ quyền** (cùng khuôn mục 8, 15, 21).

🔴 **MẮT XÍCH `paste-key`, ĐO VÀ TRỎ BẰNG TÊN.** `web/src/routes/Settings.tsx` **hoặc**
`web/src/routes/Onboarding.tsx` (`PasteKeyCard`) → `endpoints.onboardingPasteKey` trong
`web/src/lib/api.ts` → `POST /v1/onboarding/paste-key` (`Policies.Engineer`) →
`St4i.EngineApi.Endpoints.OnboardingEndpoints` → `St4i.EngineApi.Fleet.OnboardingService.PasteKey` →
`St4i.EdgeCore.Infrastructure.CredentialStore.Save(req.MachineCode, req.MkKey)` → **một blob DPAPI
`%ProgramData%\ST4I\sim\creds\<code>.bin`**. Đường **ĐỌC** lại, và đây là chỗ mắt xích đứt:
`FleetCore.UpdateSettings` (nhánh `if (rebuildNeeded)`) gọi `CredentialStore.Load(_machineCode)` — **số
ít** — rồi `TransportCoordinator.RebuildLive`. `St4i.EdgeService.EdgeWorker` cũng số ít
(`CredentialStore.Load(machineCode)` từ `ST4I_MACHINE_CODE`).

🔴 **KẾT CỤC QUAN SÁT ĐƯỢC VỚI MỘT `machineCode` LẠ, VIẾT CẢ HAI CHIỀU — VÀ NÓ KHÔNG PHẢI "KHÔNG CÓ TÁC
DỤNG GÌ".** *Chiều thuận:* transport **không đổi**; `RebuildLive` vẫn chỉ nhận khoá của
`settings.machineCode`. *Chiều ngược, mà mục không viết:* **cú ghi CÓ THẬT và CÓ MẶT ở ba chỗ đọc
được** — (a) file blob nằm trên đĩa vĩnh viễn; (b) vỏ WPF **liệt kê nó**:
`SettingsViewModel` gọi `CredentialStore.ListMachineCodes()` và có cả một ô *"check machineCode"* gọi
`CredentialStore.Load(CheckMachineCode)`; (c) pane web ghi mã ấy vào `localStorage` qua
`web/src/lib/credentials.ts`. **Không có route `GET` nào liệt kê thư mục ấy** (đo: `credentials.ts` tự
khai điều đó, và tập route trả credential là rỗng). Nên câu đúng là: **khoá được lưu bền, liệt kê được,
và không với tới được bởi đường đi ra** — không phải "không có tác dụng gì".

🔴 **CƠ CHẾ MÀ MỤC MÔ TẢ KHÔNG ĐỨNG VỮNG, VÀ ĐÓ LÀ MỘT PHÁT HIỆN PHẢI GHI.** Đầu đề mục nói *"một route
trả 200 cho việc nó không làm"*. **Route LÀM đúng việc nó nói.** `CredentialStore.Save` thật sự ghi;
`$"Pasted mk_ key stored for {req.MachineCode}"` là một câu **ĐÚNG**. Cái sai là **suy luận** câu ấy mời
người đọc rút ra. **Hệ quả trực tiếp lên bản sửa:** một 4xx sẽ **từ chối một cú ghi thành công**, và sẽ
**lấy đi đúng đường mà chính mục nêu là hợp lệ** (*"lưu sẵn khoá trước khi đổi `machineCode`"*). Nên thứ
được sửa là **CÂU**, không phải **MÃ TRẠNG THÁI**. 📎 Điều phối viên đã đo mục này và **sai hai lần
trong cùng phiên**; đây là chỗ thứ ba, và nó nằm ở **đầu đề**.

🔴 **MỤC NÊU THIẾU MỘT BỀ MẶT — CÓ HAI BIỂU MẪU WEB POST ROUTE ẤY, KHÔNG MỘT.** Mục chỉ nêu cặp
`settings.auth.pasteCodeLabel`/`pasteCodePlaceholder`. Đo bằng `git grep --full-name` từ gốc repo trên
`paste-key|PasteKey|pasteKey`: `web/src/routes/Onboarding.tsx` mang một `PasteKeyCard` thứ hai với
`onboarding.pasteCard.codeLabel`/`codePlaceholder` — **cùng placeholder `SIM-0002`, cùng lời mời**. Một
bản sửa chỉ chạm Settings sẽ **đúng ở một màn hình và sai ở màn hình kia**.

🔴 **VÀ CÁI TRẦN CỦA BẢN SỬA, NÊU CHỨ KHÔNG ĐỂ IM. CÓ BỐN BỀ MẶT DÁN KHOÁ; ROUTE CHỈ VỚI TỚI HAI.** Hai
cái kia là `St4iMachineSimulator.ViewModels.OnboardingViewModel.PasteKey` và đường tắt *"Paste mk_"* của
`SettingsViewModel` — **cả hai gọi `CredentialStore.Save` TRỰC TIẾP và không bao giờ chạm route.** Nên vỏ
WPF vẫn ghi `Log($"Pasted mk_ key stored for {PasteMachineCode}")` bằng lời cũ. **Dư lượng còn mở, ghi
vào mục chứ không để trong báo cáo.**

**Đã làm gì.**

1. **Route thôi để một câu đúng ngụ ý một câu sai.** `OnboardingEndpoints.AnnotatePasteKeyReachability`
   (mới, `internal`) nhận `FleetHost.GetSettings().MachineCode` và, **chỉ trên nhánh lệch**, nối thêm một
   mệnh đề nêu tên **mã mà engine thật sự xác thực bằng** và nói khoá vừa dán **KHÔNG** phải cái Live/Auto
   sẽ dùng. 🔴 **Hình dạng payload KHÔNG đổi**: cùng `OnboardingStepResult`, cùng năm thành phần, cùng
   `Step` = `"Claimed"` (thứ cả `Onboarding.tsx` lẫn `Settings.tsx` rẽ nhánh trên nó), cùng **HTTP 200**.
   Chỉ **GIÁ TRỊ** của `Message` dài ra — tiền lệ điều phối viên chấp thuận 2026-08-21. **Phơi bày:** ai
   so khớp chuỗi ấy sẽ hỏng; đo trong repo, **không bài kiểm nào và không file web nào** so khớp
   `"Pasted mk_ key stored"` — chỗ khớp duy nhất còn lại là bản WPF, và nó là một chuỗi **riêng** của nó.
2. **CẢ HAI biểu mẫu web thôi mời làm một việc vô nghĩa.** `settings.auth.pasteCodeHint` và
   `onboarding.pasteCard.reachabilityNote` (en + vi) nói thẳng: chỉ khoá dưới **mã máy xác thực** mới được
   dùng; khoá dưới mã khác **được lưu và giữ**, nhưng không gì dùng tới nó tới khi mã ấy trở thành mã của
   engine. Và **hai placeholder `e.g. SIM-0002` / `vd: SIM-0002`** — đúng chỗ lời mời được phát ra — nay
   lặp lại `ENGINE-API-01`, cùng quy ước với ô ngay trên.
3. **Cái trần vendored giữ nguyên và được nhắc lại ở đây.** Câu *"Chưa có khóa mk_…"* mà vận hành viên
   đọc **vẫn** phát ra từ `examples/device-client/csharp/St4iDeviceClient.cs` — **file SDK vendored mà luật
   dự án CẤM SỬA** — và nhiệm vụ này **không chạm nó**. Bản sửa ở trên **không** đụng tới câu ấy; nó đụng
   một câu khác, ở một đầu khác của cùng vấn đề.

**Nhân chứng, và cặp đối chứng.** `OnboardingPasteKeyReachabilityTests`. 🔴 **ĐÚNG MỘT `[Fact]` LÀ NHÂN
CHỨNG ĐỎ ĐƯỢC** — `MismatchedCode_MessageNamesTheCodeTheEngineActuallyAuthenticatesAs`. **Đối chứng 1**
(hoàn nguyên thân helper về `return result;`, tức hành vi BASE): **1 đỏ / 9 xanh** — bốn bài "để yên" kia
**xanh ở cả hai phía và KHÔNG đo được gì**, nên chúng **không** được tính là nhân chứng. Chúng kiếm chỗ
đứng bằng **đối chứng 2** (chú thích **vô điều kiện**, xoá cả hai phép gác): **6 đỏ / 4 xanh**, đúng bốn
bài ấy (`UnknownActiveCode_SaysNothing` là một `[Theory]` ba ca). `AnnotatedResult_KeepsEveryOtherMember`
**xanh ở cả hai đối chứng, cố ý** — nó là bài giữ khẳng định *"không payload đã xuất bản nào đổi hình
dạng"*. **Cả hai đối chứng chạy trọn rồi hoàn nguyên.**

---

## 16. `OeeCalculator` — hai trong ba tỉ số được kẹp `[0,1]`, cái thứ ba thì không, và biên hôm nay do một file KHÁC giữ

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AL-1 (đợt 6), xác nhận lại trên mã.

**Đo được cái gì.** Trong `OeeCalculator.Calculate`: Availability và Performance đều bọc
`Math.Clamp(…, 0.0, 1.0)`. **Quality thì không** — nó là một phép chia trần
`(double)input.GoodCount / input.TotalCount`. Với bất kỳ đầu vào nào có good count lớn hơn total
count, Quality vượt 1 và kéo `OeeResult.Oee` vượt theo.

**Vì sao nó chưa hỏng bao giờ, và đây là nửa phải nói cùng lúc:** nhà sản xuất **duy nhất** của
`OeeInputAggregate` trên đường sản xuất là `SqliteHistorianStore.AggregateForOeeAsync`, và hai con
số của nó ra từ **hai vị từ SQL LỒNG NHAU** — `verdict IN ('Pass','Warn')` là tập con của
`verdict <> 'Skip'`. Biên `[0,1]` vì thế được cưỡng chế **trong SQL, ở một file khác**, bằng một
tính chất của cách dựng truy vấn. Cả `OeeInputAggregate` lẫn `OeeCalculator` đều `public`, nên
không gì ngăn một người gọi khác dựng một aggregate bằng đường khác.

🔴 **Câu văn đã công bố nói sai điều này ĐÃ ĐƯỢC RÚT TẠI CHỖ, 2026-08-20, bởi chính đợt 6 — nên cái
còn mở là MÃ, không phải văn.** Doc của lớp hôm nay nói đúng: *"It holds for Availability and
Performance … It does NOT hold for Quality."* **Không đợt nào được phép sửa mã**, và đây là lý do
mục này tồn tại.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Metrics.OeeCalculator.Calculate`;
`St4i.EdgeCore.Historian.OeeInputAggregate`; `St4i.EdgeCore.Historian.SqliteHistorianStore.AggregateForOeeAsync`
(hai câu `SELECT COUNT(*)` mang hai vị từ ấy); `St4i.EdgeCore.Metrics.OeeResult.Oee`;
`St4i.EngineApi.Endpoints.HistorianEndpoints.ComputeOeeAsync` là chỗ con số ấy thành DTO.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* một OEE lớn hơn 100 % là một con số **đọc được là sai ngay lập tức** nếu ai đó nhìn,
và **không đọc được là sai** nếu nó chỉ chảy vào một báo cáo hoặc một biểu đồ. Bề mặt công khai cho
phép nó: một driver bên thứ ba, một bài test, hoặc một nhà sản xuất aggregate tương lai (một store
khác, một đường nhập trực tiếp) đều dựng được đầu vào ấy mà không có gì đỏ lên.
*Chiều ngược:* trên đường đang ship **hôm nay** con số ấy **không thể xảy ra**, và thêm một
`Math.Clamp` vào Quality **giấu mất** đúng cái nó đang chứng minh — một aggregate có good > total là
một **lỗi dữ liệu**, và kẹp nó lại biến một lỗi ồn thành một con số 100 % im lặng. Cái đúng có thể
là kẹp, có thể là ném, có thể là để nguyên và ghi rõ; **ba lựa chọn ấy cho ba hành vi khác nhau**,
và đó là lý do nó là quyết định của anh chứ không phải một dòng sửa.

**Nếu KHÔNG quyết định.** Hành vi giữ nguyên và biên tiếp tục được giữ **ở một file khác, bằng một
sự trùng hợp của cách dựng truy vấn**. Ngày ai đó thêm nhà sản xuất `OeeInputAggregate` thứ hai —
một store thay thế, một endpoint nhập, một bài test dựng thẳng — biên biến mất và **không dụng cụ
nào trong repo này báo**.

### 🔴 ĐÃ ĐO 2026-08-21 (AQ-1) — ĐIỀU KIỆN DỪNG ĐÃ NỔ. MỤC NÀY **KHÔNG ĐƯỢC THI HÀNH**, VÀ TIỀN ĐỀ TRUNG TÂM CỦA CHÍNH NÓ KHÔNG SỐNG SÓT QUA PHÉP ĐO

Nhiệm vụ AQ-1 được giao thi hành mục này, **kèm một điều kiện DỪNG**: *nếu có một đầu vào sinh ra
được HÔM NAY mà bản kẹp sẽ làm đổi giá trị, thì bản sửa đổi một con số OEE đã báo cáo — thứ chủ sở
hữu không uỷ quyền — nên phải dừng và báo.* **Phép đo trả lời CÓ.** Không một dòng mã nào của
`OeeCalculator` bị sửa. Mục **ở lại PHẦN I**.

> 📎 **Ba chữ `🔴 CHỜ ANH` ở đầu mục giữ NGUYÊN VĂN và KHÔNG rút** — chúng vẫn đúng từng chữ: mục này
> vẫn đang chờ chủ sở hữu, và nay nó chờ với **nhiều thông tin hơn**, không phải ít hơn.

**Quần thể — LIỆT KÊ TRƯỚC, con số viết SAU.** Mọi nơi dựng `OeeInputAggregate`, mở trọn bằng
`git grep --full-name -n "OeeInputAggregate" HEAD -- ':(top)'` **chạy từ gốc repo
`D:\SOURCES\avi-aoi-sim`** (ghi lại thư mục, vì `:(top)` một mình không đủ — mục 32):

*Sản xuất:* `SqliteHistorianStore.AggregateForOeeAsync` (`src/St4i.EdgeCore/Historian/SqliteHistorianStore.cs:684`).
*Test, tất cả trong `tests/St4i.EdgeCore.Tests/Metrics/OeeCalculatorTests.cs`:* dòng 20 `(100,100)`,
36 `(10,10)`, 48 `(0,0)`, 61 `(100,60)`, 74 `(100,100)`, 87 `(100,100)`, 97 `(100,100)`,
107 `(90,81)`, 117 `(50,50)`.
*Không dựng gì:* ba bản cài `IHistorianStore` giả — `FakeHistorianStore`
(`tests/St4i.EdgeCore.Tests/Historian/HistorianWriterTests.cs:510`),
`RunEventRecordingHistorianStore` (`tests/St4i.EngineApi.Tests/FleetHostGateCommitCompletionTests.cs:1393`),
`FakeHistorianStore` (`tests/St4i.EngineApi.Tests/FleetHostHistorianWiringTests.cs:290`) — cả ba
`throw new NotSupportedException()`, nên chúng nằm trong quần thể **người cài đặt** chứ không nằm
trong quần thể **người dựng**.

**Rồi mới đếm: MƯỜI chỗ dựng — một sản xuất, chín test.** Chín chỗ test: **không** chỗ nào sinh ra
`GoodCount > TotalCount`. Chỗ sản xuất: **CÓ**.

**Chỗ sản xuất sinh ra được, và đây là phép đo.** `AggregateForOeeAsync` mở **một** connection rồi
chạy **bốn câu lệnh rời nhau** — probe của `ApplyRealPresenceGateAsync`, `COUNT(*)` cho total,
`COUNT(*)` cho good, rồi `ComputeRunTimeAsync` — và **không có transaction nào bọc chúng**. SQLite ở
WAL: mỗi câu lệnh ngoài transaction là **một ảnh chụp riêng**. Nên hai vị từ lồng nhau chỉ bảo đảm
`good ⊆ not-Skip` **TRONG MỘT ẢNH CHỤP**; giữa câu total và câu good, một `AppendResultsAsync` đang
chạy song song commit thêm hàng `Pass`, và good đếm được những hàng total chưa hề thấy.

Đo trên `SqliteHistorianStore` thật, cửa sổ mà **mọi hàng đếm được đều là `Pass`** (nên
`good = total` lúc đứng yên), ba nhánh, **cặp đối chứng nằm ngay trong phép đo**:

| nhánh | reads | hàng ghi | lần `Good > Total` | thừa lớn nhất | Quality lớn nhất |
|---|---|---|---|---|---|
| **A — KHÔNG có người ghi** | 93 291 | 0 | **0** | 0 | — |
| **B — 10 hàng/giây** | 192 374 | 229 | **87** | 1 | **1.00333…** |
| **C — người ghi nóng** | 1 681 | 130 403 | **1 112** | 524 | **1.00888…** |

**Nhánh A là đối chứng và nó xanh đúng chỗ phải xanh**: 93 291 lần đọc, **không một vi phạm** — hai
vị từ lồng nhau *có* giữ, đúng như mục này nói, khi không có gì chuyển động. **Nhánh B là nhánh
quyết định**: 10 hàng/giây là xấp xỉ nhịp của chính `fleet.json` đang ship — mười máy, mỗi máy quanh
1 Hz — và ở nhịp ấy `AggregateForOeeAsync` **đã trả về `GoodCount > TotalCount` 87 lần**.

**Nên: một đầu vào sinh ra được hôm nay ĐỔI GIÁ TRỊ dưới bản kẹp.** `Math.Clamp` sẽ biến một
Quality `1.00333` đã báo cáo thành `1.00000`. Đó là **đổi một con số OEE đã báo cáo**, và đó chính
là điều kiện dừng. **DỪNG.**

**Điều này BÁC một tiền đề của chính mục này, và nói ra là bắt buộc.** Mục viết ở trên:
*"biên `[0,1]` vì thế được cưỡng chế trong SQL, ở một file khác"* và *"trên đường đang ship hôm nay
con số ấy KHÔNG THỂ XẢY RA"*. **Nửa sau là sai, đo được.** Câu đúng hẹp hơn: biên được cưỡng chế bởi
hai vị từ lồng nhau **cộng với** sự vắng mặt của một commit trong khoảng vài chục micro-giây giữa
hai câu `SELECT` — và sự vắng mặt ấy **không được cưỡng chế bởi gì cả**. Hai câu trên **giữ nguyên
văn, không xoá**; cái được rút là **chỉ mệnh đề *"không thể xảy ra"***, rút tại chỗ, 2026-08-21.

🔴 **Và nó đổi CÂU HỎI chủ sở hữu đang được mời quyết.** Mục này mở ra như một câu hỏi về **phòng
thủ chiều sâu** — *"có nên kẹp một thứ chưa hỏng bao giờ không"*. Phép đo nói nó là một câu hỏi về
**một khuyết tật đang sống**: con số sai **đang được sinh ra hôm nay**, và `Math.Clamp` **không sửa
nó** — nó chỉ hạ `1.00333` xuống `1.00000` trong khi con số đúng là `1.00000` vì một lý do khác hẳn.
**Bản sửa thật nằm ở `AggregateForOeeAsync`**: đọc hai `COUNT(*)` trong **một** transaction, để hai
con số ra từ **một** ảnh chụp. Đó là một bản sửa ở **file khác**, với **rủi ro khác**, và nó **không
nằm trong uỷ quyền của nhiệm vụ này**. Ba lựa chọn mục này nêu ở trên (kẹp / ném / để nguyên) vì thế
**thiếu cái thứ tư, và cái thứ tư có lẽ là cái đúng**.

**Bề mặt ĐỌC — §8.1(h5.4), nêu tên.** Một cái kẹp (hay một bản sửa transaction) đổi thứ **năm** chỗ
này đọc: `HistorianEndpoints.GetOeeAsync` (`GET /v1/historian/oee`);
`HistorianEndpoints.GetOeeFleetAsync` (`GET /v1/historian/oee/fleet`); bộ dựng **báo cáo PDF** trong
cùng file, nơi `oee.Oee.ToString("P1")` in ra một phần trăm; `web/src/routes/Reports.tsx`, nơi
`(oee.data.quality * 100).toFixed(1)` và `gaugePct={oee.data.oee * 100}` **đẩy kim đồng hồ vượt
100 %**; và `web/src/lib/api.ts` qua `useOee`/`useOeeFleet`. **Gương UNS KHÔNG nằm trong tập này** —
quét `src/St4i.EdgeCore/Site` và `src/St4i.EdgeService` không trả về chỗ nào mang OEE, nên nói "gương
UNS bị ảnh hưởng" sẽ là nói quá.

🔴 **Một khẳng định đã công bố THỨ HAI vẫn đang sai, và AL-1 đã sửa đúng chỗ thứ nhất mà bỏ sót chỗ
này.** `web/src/lib/api.ts` dòng ~1117 nói về `OeeResultDto`: *"`availability`/`performance`/
`quality`/`oee` are fractions in `[0, 1]` … never NaN/Infinity/over 1 (`OeeCalculator.Calculate`
clamps/guards every division)"*. Đó là **đúng câu** mà AL-1 đã rút tại chỗ trên doc lớp
`OeeCalculator` ngày 2026-08-20 — cùng một khẳng định, ở **bề mặt mà khách hàng đọc**, và nó **chưa
được rút**. Đây là một **bản kiểm kê THIẾU**, không phải một khuyết tật mới; AQ-1 **không sửa nó**
vì sửa văn ở bề mặt ấy không nằm trong uỷ quyền của nhiệm vụ này, và ghi ở đây để nó không mất.

📎 **Và một chỗ brief của AQ-1 nói ngược với mã, ghi lại vì file này ghi cả hai chiều.** Brief nói
*"doc lớp `OeeCalculator` khẳng định mọi tỉ số được kẹp… sau bản sửa nó thành ĐÚNG"*. Đo được: doc
lớp ấy **hôm nay đã đúng rồi** — AL-1 đã rút khẳng định ấy tại chỗ ngày 2026-08-20, và chính mục này
nói thế ở đoạn trên. Một bản kẹp sẽ làm **khối rút của AL-1** thành sai, chứ không làm doc thành
đúng. Ai thi hành mục này về sau **phải rút khối rút ấy kèm ngày**, đừng xoá.

**Bằng chứng:** `.superpowers/sdd/items-16-21/task-1-report.md`. Dụng cụ đo là một `[Fact]` tạm
trong `tests/St4i.EdgeCore.Tests`, chạy rồi **xoá** — nó không ở trong suite và không được đếm vào
`EXPECT_EDGECORE`; toàn văn nó nằm trong báo cáo.


### ✅ ĐÃ THI HÀNH 2026-08-22 (AT-1) — **PHÁN QUYẾT CỦA CHỦ SỞ HỮU ngày 2026-08-22**, không phải của điều phối viên. MỘT TRANSACTION; và đây là mục DUY NHẤT của loạt này CỐ Ý đổi một con số đã báo cáo

🔨 **Phán quyết được thi hành:** bọc **bốn câu lệnh** của `AggregateForOeeAsync` trong **MỘT** transaction,
để hai `COUNT(*)` ra từ **MỘT ảnh chụp**. Đó là **LỰA CHỌN THỨ TƯ** mà chính khối AQ-1 ngay trên đã nêu —
**không kẹp, không ném, không để nguyên**. `OeeCalculator` **không bị sửa một dòng mã nào** và
`Math.Clamp` **KHÔNG** được thêm vào Quality.

🔴 **MỘT KHÁC BIỆT HỒ SƠ PHẢI NÓI RA, VÀ NÓ LÀ VỀ CHÍNH PHÁN QUYẾT NÀY.** Mục 27 mang phán quyết của chủ
sở hữu **trong thân mục**, ghi ngày 2026-08-22, đọc được tại chỗ. **Mục 16 thì KHÔNG.** Tới `ce1ce2be` —
BASE của nhiệm vụ này — **không** dòng nào trong thân mục 16 và **không** ô nào ở hàng 16 của bảng phán
quyết mang một phán quyết ngày 2026-08-22. Phép đo, chạy từ gốc repo `D:\SOURCES\avi-aoi-sim`:
`grep -n "2026-08-22" tools/machine-simulator/docs/owner-decisions.md` trả **đúng HAI** dòng ở `ce1ce2be`
(dòng 58 và dòng 699) và **cả hai thuộc mục 27**. Nội dung phán quyết mục 16 đến với người thi hành **qua
brief của nhiệm vụ AT-1**, và brief ấy khai nó là của chủ sở hữu. **Ghi ở đây vì file này ghi cả hai
chiều:** người thi hành **không kiểm được lời khai ấy từ trong repo**; cái kiểm được là nó **khớp từng
chữ** với lựa chọn thứ tư mà AQ-1 đã đo và đề xuất ở khối ngay trên. Ai đọc về sau nên biết mục 16 rời
Phần I bằng một phán quyết **không có bản ghi tại chỗ ở BASE**, khác hẳn mục 27.

**MỨC CÔ LẬP — ĐO, KHÔNG GIẢ ĐỊNH, và phép đo BÁC một cảnh báo của brief.** Brief cảnh báo rằng một
`BEGIN` trần trong WAL *"không nâng bốn lượt đọc vào một ảnh chụp trên mọi cấu hình"*. **Trên cấu hình
này nó CÓ**, và đo được: một `BeginTransaction(deferred: true)` (tức `BEGIN` trần) đọc `COUNT(*)`, rồi một
bên ghi khác commit xong, rồi đọc lại **cùng câu ấy trong cùng transaction** → **con số KHÔNG đổi**
(*SNAPSHOT HELD*). Đối chứng nằm ngay trong phép đo: **không** transaction → hai lần đọc cho **hai** con số
(*SNAPSHOT BROKEN*). Pragma của store là `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`,
`foreign_keys=ON`; provider là `Microsoft.Data.Sqlite 10.0.10`.

🔴 **VÀ ĐÂY LÀ CHỖ BRIEF ĐÚNG, CHỈ LÀ ĐÚNG VỀ MỘT THỨ KHÁC: "một transaction ghi SAI KIỂU" là một cái bẫy
thật, và nó không nằm ở mức cô lập.** Cả hai dạng transaction đều báo `IsolationLevel.Serializable` — **cái
tên KHÔNG phân biệt được chúng**. Thứ phân biệt là cờ `deferred`. Đo được:
`connection.BeginTransaction()` **không tham số** — đúng dạng mà `AppendResultsAsync` và
`PruneOlderThanAsync` trong chính file này dùng — phát ra **`BEGIN IMMEDIATE`**, tức **lấy khoá GHI** cho
một phương thức chỉ đọc. Với nó đang mở, một `AppendResultsAsync` song song **không chỉ chậm mà HỎNG
HẲN**: `SQLite Error 5: 'database is locked'` sau **33 121 ms**. Dạng `deferred: true` phát `BEGIN` trần:
cùng lần ghi ấy **THÀNH CÔNG trong 0–1 ms**. **Bản thi hành dùng `deferred: true`**, và lý do được viết
vào doc của phương thức chứ không để người sau đoán.

**GIÁ KHOÁ — ĐO ĐƯỢC, VÀ CHỖ GỌI NÊU TÊN.** Với `deferred: true` giá khoá lên bên ghi là **KHÔNG**: trong
WAL một transaction chỉ-đọc không chặn người ghi, đo được ở trên (0–1 ms). Giá **còn lại**, nêu chứ không
giấu: một transaction đọc đang mở **giữ chân bộ checkpoint WAL** suốt đời nó, nên transaction được
**kết thúc ngay khi lượt đọc cuối trả về**, trước khi aggregate được dựng. Độ dài đời ấy đo được:
**0,03 ms** ở 1 hàng, **1,2 ms** ở 5 001 hàng, **4,0 ms** ở 10 001 hàng, **6,0 ms** ở 15 001 hàng.
**Chỗ gọi, nêu bằng TÊN:** nhà sản xuất duy nhất là
`St4i.EngineApi.Endpoints.HistorianEndpoints.ComputeOeeAsync`, và nó được gọi từ **ba** chỗ, **cả ba là
đường REQUEST ĐỒNG BỘ**, không có chỗ nào chạy nền: `GetOeeAsync` (`GET /v1/historian/oee`),
`GetOeeFleetAsync` (`GET /v1/historian/oee/fleet` — **một vòng lặp tuần tự trên từng máy**, nên một fleet
mười máy mở **mười** transaction nối nhau trong một request), và bộ dựng **báo cáo PDF** trong cùng file.
🔴 **Chính ba chỗ gọi đồng bộ ấy là lý do `deferred` không phải một tuỳ chọn phong cách:** dạng không tham
số sẽ đặt một khoá ghi lên đường phục vụ request, mười lần một request ở route fleet.

**NHÂN CHỨNG — ĐỎ ĐƯỢC, và tỉ lệ đo được, không ước lượng.** File mới
`tests/St4i.EdgeCore.Tests/Historian/OeeAggregateSnapshotUnderConcurrentWriterTests.cs`, **hai** `[Fact]`,
mỗi cái nêu tên đối chứng làm nó đỏ:
* `AggregateForOee_never_reports_more_good_than_total_while_a_writer_commits_concurrently` — **gỡ
  transaction ⇒ ĐỎ 5/5**, và thông điệp hỏng mang số thật: `good=212 total=211 quality=1.004739`,
  `good=229 total=227 quality=1.008811`. **Có transaction ⇒ XANH 8/8.**
* `AggregateForOee_does_not_take_the_write_lock_a_concurrent_writer_needs` — **đổi `deferred: true` thành
  `BeginTransaction()` không tham số ⇒ ĐỎ 5/5** (*"a concurrent write waited 14 977 ms behind the
  aggregate's transaction"*). **Có bản sửa ⇒ XANH 8/8.**

🔴 **Và một khuyết tật của CHÍNH NHÂN CHỨNG, tự bắt được bằng cách đo lại sản phẩm của mình sau khi
viết.** Ở vòng đầu, bài thứ nhất **đỏ đúng nhưng vì LÝ DO SAI**: vòng đọc `break` sau năm vi phạm, nên
`reads` không bao giờ tới ngưỡng "đủ mẫu", và **assertion ngưỡng bắn TRƯỚC assertion vi phạm** — thông điệp
đọc là *"race window never opened: only 5 aggregate reads completed"*, tức đúng ngược với chuyện vừa xảy
ra. Đã sửa **thứ tự assertion** (vi phạm là KẾT LUẬN, ngưỡng chỉ quyết định một lần chạy SẠCH có nghĩa
gì) và ghi lý do ngay tại chỗ. **Một bài đỏ với thông điệp sai là một bài sẽ bị đọc sai vào đúng lúc nó
quan trọng.** Bài thứ hai cũng có một khuyết tật riêng, cùng họ: một ngưỡng *"có aggregate nào chạy xong
trong lúc ghi không"* đếm **số lần HOÀN TẤT** và vì thế **đỏ giả 2/6 trên bản đã sửa**; ngưỡng ấy bị bỏ vì
nó thừa — một vòng đọc chỉ thoát khi bị huỷ (sau các lượt ghi) hoặc khi lỗi, nên chồng lấn là **do cấu
trúc**, không cần đếm.

🔴 **BA CON SỐ CỦA AQ-1 KHÔNG TÁI LẬP ĐƯỢC, và cái sai ấy là một phát hiện phải ghi.** Bảng ba nhánh của
AQ-1 được đo lại độc lập trên máy này, cùng kịch bản, 20 giây mỗi nhánh. **Hướng và kết luận ĐỨNG VỮNG
hoàn toàn**: không bên ghi → **596 620 lần đọc, 0 vi phạm**; 10 hàng/giây (nhịp `fleet.json` xuất xưởng) →
**368 061 lần đọc, 60 vi phạm**; ghi nóng → **1 407 lần đọc, 1 157 vi phạm**. Nhưng **giá trị Quality lớn
nhất KHÔNG khớp**: nhánh 10 hàng/giây đo được **1,25** (không phải `1,00333`) và nhánh ghi nóng đo được
**1,0168** (không phải `1,00888`). Lý do đo được: Quality lớn nhất là **hàm của số hàng đã có lúc vi phạm
xảy ra** (`good=5, total=4` cho 1,25), nên nó là **tạo tác của cách gieo dữ liệu**, **không** phải một
hằng số của khuyết tật. **Nên: ba con số "Quality lớn nhất" của AQ-1 không được dùng như một phép đo tái
lập được; ba con số "số lần vi phạm" thì được.**

🔴 **NỬA BẤT LỢI, VIẾT NGAY CẠNH — ĐÂY LÀ CÁI GIÁ CHỦ SỞ HỮU ĐÃ CHẤP NHẬN.** Con số OEE tính **từ nay** sẽ
**KHÁC** con số tính **trước 2026-08-22**, đúng ở những lúc con số cũ sai. **Báo cáo ĐÃ IN không đổi và
không được phát hành lại.** Nhưng ai so hai kỳ bắc qua ngày ấy **sẽ thấy một bậc nhảy mà không có gì trên
sàn sản xuất gây ra** — và bậc ấy đi theo chiều **giảm**, vì thứ bị gỡ là những lần Quality bị thổi lên
trên 1. Câu này được viết **cả vào mục này lẫn vào doc lớp `OeeCalculator`**, vì chỗ con số được làm ra là
chỗ người sau sẽ đứng khi họ hỏi tại sao.

**KHỐI RÚT CỦA AL-1 ĐƯỢC LÀM CHO ĐÚNG VỚI THỰC TẾ MỚI — MỞ RỘNG, KHÔNG XOÁ MỘT DÒNG NÀO.** Doc lớp
`OeeCalculator` nay mang một **khối thứ HAI** ghi ngày 2026-08-22: khối rút của AL-1 **VẪN ĐỨNG** (không
có cái kẹp nào được thêm, nên mọi chữ AL-1 rút vẫn bị rút), cái đổi là **ý nghĩa** của nó — biên
`Quality ≤ 1` nay là **CẤU TRÚC** trở lại trên đường đang ship, và nói cho đủ phải nói **CẢ HAI NỬA**: hai
vị từ SQL lồng nhau **CỘNG** hai con số đọc trong một ảnh chụp. **Nửa nào một mình cũng để nó không có
biên.** Và đoạn trong doc của `Calculate` — *"stays at or below 1 only because … nested SQL predicates"* —
được **mở rộng** kèm ngày: câu ấy nêu **một** trong **hai** thứ làm nên biên ấy.

🔴 **KHẲNG ĐỊNH ĐÃ CÔNG BỐ THỨ HAI — cái mà AQ-1 ghi lại là "bản kiểm kê THIẾU" — NAY ĐÃ ĐƯỢC RÚT.**
`web/src/lib/api.ts`, khối doc của `OeeResultDto`, nói `quality`/`oee` *"never … over 1
(`OeeCalculator.Calculate` clamps/guards every division)"*. **Giá trị** mà câu ấy hứa là **đúng hôm nay**;
**lý do** nó đưa ra thì **sai** — `Calculate` không kẹp Quality và chưa bao giờ kẹp. Đã rút **tại chỗ, kèm
ngày, không xoá dòng nào**, và viết ra biên thật nằm ở đâu. Đây là **bề mặt KHÁCH HÀNG đọc**, và nó là chỗ
thứ hai — sau doc lớp — mang cùng một khẳng định. 🔴 **Chạm `web/` ⇒ đã chạy build của web**
(`npm run build` = `tsc -b && vite build`): **thành công**, và một lần chạy nền TRƯỚC khi sửa đã lập đường
cơ sở để so.

**Bằng chứng:** `.superpowers/sdd/items-16-27-ruled/task-1-report.md`. Dụng cụ đo ba nhánh + mức cô lập +
giá khoá là một `[Fact]` tạm trong `tests/St4i.EdgeCore.Tests`, chạy rồi **xoá** — nó **không** ở trong
suite và **không** được đếm vào `EXPECT_EDGECORE`; toàn văn nằm trong báo cáo.

---

## 27. API Inspector không phơi THÂN request: không dụng cụ UI nào trong sản phẩm này đọc được payload đi ra

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi điều phối viên 2026-08-20, **xác nhận lại trên mã** —
và nó **đứng vững**.

**Đo được cái gì.** `ApiTraceEvent` là một `record` với **mười** thành phần: `At`, `MachineCode`,
`Kind`, `Method`, `Path`, `Status`, `LatencyMs`, `Mode`, `Duplicate`, `Error`. **Không thành phần
nào mang thân request, thân response, hay một tóm tắt payload.** Ở phía UI, `TraceTable` dựng các
hàng bằng `div` mang `role="table"`/`"row"`/`"cell"` (cố ý, vì layout `<table>` thật không hợp tác
với hàng định vị tuyệt đối của react-virtual) và **không có một trình xử lý click hàng nào** — không
`onClick` trên hàng, không panel chi tiết, không route mở rộng. Nút `Export` xuất **đúng những
trường ấy**.

📎 **Ghi lại một chỗ mà chính điều phối viên đã sai trong phiên đo này, vì nó là bằng chứng cho một
luật của file này:** một bộ chọn `<table>` kết luận *"không có bảng"* trên một trang có 244 hàng —
vì bảng ấy là `role="table"`. Doc comment của `TraceTable` nói đúng lý do, và **miền dụng cụ hẹp hơn
miền câu nói**.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Infrastructure.ApiTraceEvent`;
`St4i.EdgeCore.Engine.EdgePipeline` (chỗ dựng sự kiện);
`St4i.EdgeCore.Infrastructure.EventBus`; `St4i.EngineApi.Hubs.InspectorStream`
(`WS /v1/inspector/stream`); `web/src/lib/inspector.ts`; `web/src/components/TraceTable.tsx`;
`web/src/routes/ApiInspector.tsx`; `St4iMachineSimulator.ViewModels.InspectorViewModel` và
`Views/ApiInspectorView.xaml` (bản WPF, cùng hình dạng).

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* câu hỏi *"mình đang gửi cái gì"* — câu hỏi mà một pane tên là **API Inspector** hứa
trả lời — **chỉ trả lời được bằng cách bật LIVE và đọc phản hồi của máy chủ thật**. Với một kỹ sư
tích hợp đang dò một hợp đồng ingest, đó là bảo họ chạy thật để gỡ lỗi. Và nó chạm thẳng mục 14 vừa
được thi hành: hình dạng hàng `Samples` trên dây vừa đổi, và **không bề mặt UI nào trong sản phẩm
này cho xem hình dạng ấy**.
*Chiều ngược, và nó là một lý do thật để nói không:* thân request mang **dữ liệu đo của khách
hàng** — số đo, số serial, mã công thức. Cho chúng vào trace nghĩa là cho chúng vào **ring 500 phần
tử trong bộ nhớ của engine**, vào **luồng WebSocket**, và vào **file mà nút `Export` ghi ra đĩa**.
Repo này đã có một bộ canh rò rỉ dữ liệu nhạy (bracket `real creds root under watch` trong cổng) vì
đúng loại lo ấy. Một "phơi thân request" làm bừa là một bề mặt dữ liệu-lúc-nghỉ mới.

**Nếu KHÔNG quyết định.** Pane giữ tên *Inspector* và giữ khả năng của một **sổ truy cập**. Mỗi lần
một hợp đồng đi dây đổi — mục 4, mục 14, và cái tiếp theo — câu hỏi *"nó thực sự gửi cái gì"* lại
được trả lời bằng một lần chạy live chứ không bằng một dụng cụ.

### 🔴 AS-1 (2026-08-21) — ĐƯỢC GIAO THI HÀNH, ĐÃ DỪNG. Phép đo, và hai tiền đề không sống sót

**Điều kiện DỪNG đã nổ, và đây là phép đo làm nó nổ.** Brief hỏi: *`ApiTraceEvent` đi ra những bề mặt
nào, và thêm một trường vào đó có phải đổi hình dạng một payload đã xuất bản không?* **Có.** Quần thể
liệt kê TRƯỚC khi đếm, `git grep --full-name "ApiTraceEvent" <SHA> -- ':(top)'` chạy **từ gốc repo**
(`D:\SOURCES\avi-aoi-sim`), 21 file. Trong đó **ba** bề mặt mang bản ghi ấy **RA KHỎI tiến trình**:

1. **`WS /v1/inspector/stream`** — `InspectorStreamEndpoint.SendAsync` gọi
   `JsonSerializer.SerializeToUtf8Bytes(e, ApiJson.Options)`. Mỗi sự kiện là **một khung JSON**. Đây là
   một hợp đồng dây đã xuất bản: `web/src/lib/inspector.ts` khai lại đúng mười trường ấy và tự ghi
   *"Wire types — 1:1 with ApiTraceEvent.cs"*.
2. **Nút `Export` của pane web** — `ApiInspector.handleExport` ghi một **file JSON xuống đĩa người
   dùng**, và code nói thẳng ý định: bỏ `id` do client gán *"so the export should read as exactly what
   `ApiTraceEvent` looks like over the wire"*. Tức file ấy **là** hình dạng dây.
3. **Nút `Export` của pane WPF** — `InspectorViewModel.ExportAsync` serialize `Events.ToArray()` ra
   một file JSON thứ hai, hình dạng tương đương.

Cộng hai bề mặt **render** trong tiến trình (`TraceTable.tsx`, `ApiInspectorView.xaml`) và một bài
hợp đồng (`EnumSpellingContractTests`). **Không có route REST nào trả `ApiTraceEvent`** — đo trên cả
`src/St4i.EngineApi/Endpoints/`, tập rỗng.

🔴 **Nên thêm một trường thân vào `ApiTraceEvent` đổi hình dạng của một khung WebSocket đã xuất bản
VÀ của hai định dạng file mà người dùng đã có trên đĩa.** Đó đúng là thứ nằm ngoài uỷ quyền. **DỪNG.**
Không một dòng nào bị sửa cho mục này.

**HAI TIỀN ĐỀ CỦA BRIEF KHÔNG SỐNG SÓT QUA PHÉP ĐO, và ghi lại vì một cái trần nêu SAI còn tệ hơn
không nêu trần.**

* 🔴 **"Thân request có thể chứa bí mật (khoá `mk_`)" — SAI trên đường ĐƯỢC TRACE.** Thân được trace
  là `CanonicalEnvelope.Payload`, dựng ở `Normalizer` từ một `DeviceReading`. Đo: **không** file nào
  dưới `src/St4i.EdgeCore/Mapping/`, `…/Engine/`, `…/Models/` nhắc tới `MkKey`. Khoá đi bằng **HEADER**
  — `St4iDeviceClient` đặt `Authorization: Bearer <mk_…>` và `X-API-Key`, và header **không** có mặt
  trong `CanonicalEnvelope` chút nào. Chiều ngược, nêu chứ không giấu: khoá **CÓ** nằm trong thân của
  **hai** lời gọi SDK khác — `SaveCredentialAsync` (`{"mkKey":…}`) và `HeartbeatAsync`
  (`{"apiKey":…}`) — nhưng **không lời gọi nào trong hai cái đó sinh ra một `ApiTraceEvent`**:
  `EdgePipeline` chỉ dựng sự kiện quanh `_transport.SendAsync` của một reading. **Nên lý do thật để
  nói không KHÔNG phải bí mật; nó là dữ liệu đo của khách hàng — đúng cái thân mục đã viết.**
* 🔴 **"Sóng hàn 100.000 mẫu" — KHÔNG phải phép đo của repo này.** Đo: `WelderSim.WaveformPoints =
  **24**`, `ScrewdriveSim.WaveformPoints = **20**`. Con số 100.000 là một giả định về bộ điều khiển
  hàn thật, không phải thứ sản phẩm này phát hôm nay.

**NHƯNG CÁI TRẦN KÍCH THƯỚC VẪN THẬT, VÀ ĐÂY LÀ HÌNH DẠNG ĐÚNG CỦA NÓ.** `CanonicalEnvelope.Payload`
là `Dictionary<string, object>` **không định kiểu**, và phép quét `MaxRequestBodySize|MaxLength|
maxSamples|MaxSamples|TruncateSamples|.Take(N)` trên toàn `tools/machine-simulator/src` trả **tập
rỗng**: **không nơi nào trong sản phẩm này giới hạn kích thước một thân đi ra.** Hai bộ mô phỏng dựng
sẵn nhỏ, nhưng chúng không phải trần — trần là **driver bên thứ ba / Modbus / OPC UA / hot-folder AOI
nạp bao nhiêu cũng được**. Nên bất kỳ bản "phơi thân request" nào **phải mang theo chính sách cắt của
riêng nó**; không có cái nào để thừa kế.

**CHÍNH SÁCH CHE, NÊU RÕ ĐỂ PHÁN QUYẾT VỀ SAU KHÔNG PHẢI ĐO LẠI.** Nếu anh phán *"phơi thân"*, ba
điều phải quyết cùng lúc, vì bỏ sót cái nào cũng biến bản sửa thành một bề mặt dữ liệu-lúc-nghỉ mới:
(a) **trần byte** trên phần được giữ, cộng một dấu hiệu **nói rõ đã cắt** (một thân bị cắt im lặng là
đúng cái lỗi mục 28 nói); (b) **thân ấy vào cả ba bề mặt trên** — vòng 500 phần tử trong RAM engine,
luồng WS, **và hai file export** — nên "che" phải áp ở chỗ **dựng sự kiện**, không ở chỗ render;
(c) danh sách khoá được giữ là **danh sách CHO PHÉP hay danh sách CẤM** — với một `Dictionary` không
định kiểu mà `Normalizer` chuyển tiếp mọi khoá lạ làm trường phả hệ, một danh sách cấm **không đóng
được**.

### 🔨 QUYẾT 2026-08-22 (CHỦ SỞ HỮU): BỀ MẶT MỚI — và phép DỪNG ở trên là thứ tạo ra phán quyết này

🔨 **PHÁN QUYẾT, ghi kèm ngày: thêm một ĐƯỜNG RIÊNG cho thân request, và GIỮ NGUYÊN khung
`WS /v1/inspector/stream` cùng HAI file JSON mà hai nút `Export` ghi ra.** Tức lựa chọn *"thêm một
trường vào `ApiTraceEvent`"* — lựa chọn mà AS-1 được giao và đã **từ chối tự quyết** — **KHÔNG** được
chọn. Ba payload đã xuất bản ở §1.1 của phép đo trên **không đổi hình dạng**.

📎 **Vì sao phép DỪNG được ghi là một phần của phán quyết, chứ không phải một lần chậm trễ.** AS-1
được giao thi hành mục này và dừng vì điều kiện DỪNG của brief đã nổ; phép đo nó để lại — **ba** bề
mặt ra khỏi tiến trình, trong đó **hai là file trên đĩa người dùng mà KHÔNG ĐO ĐƯỢC ai đang đọc** — là
thứ chủ sở hữu dùng để phán. Nếu bản sửa cứ thế thêm trường, nó đã đổi hình dạng **ba** payload đã
xuất bản và **hai** trong ba không có phép đếm người tiêu thụ nào chống lưng.

🔴 **BA ĐIỀU KIỆN CỦA §"CHÍNH SÁCH CHE" NGAY TRÊN KHÔNG ĐƯỢC MIỄN BỞI PHÁN QUYẾT NÀY.** Một bề mặt
**mới** không phải một bề mặt **miễn phí**: thân request vẫn mang **dữ liệu đo của khách hàng**, và
**vẫn chưa có trần kích thước nào trong `src/` để thừa kế** (quét trả tập rỗng — xem trên). Nên bản
thi hành vẫn phải mang theo **(a)** trần byte + dấu hiệu đã cắt, **(b)** phép che áp ở chỗ **dựng sự
kiện** chứ không ở chỗ render, **(c)** một **danh sách CHO PHÉP** — danh sách cấm không đóng được trên
một `Dictionary` không định kiểu. 📎 Và cái **KHÔNG** phải lý do, đã đo và ghi ở trên: **không phải
khoá `mk_`** — trên đường được trace khoá đi bằng header, không bao giờ trong thân.

🔴 **MỤC NÀY Ở LẠI PHẦN I.** Phán quyết đã có, **ghi chép thi hành thì chưa** — **một nhiệm vụ khác sẽ
thi hành**, và mục chỉ rời Phần I khi ghi chép ấy tồn tại. AS-1 **không thi hành phán quyết này** và
**không sửa một dòng mã nào cho mục 27**; nó chỉ ghi phán quyết vào đây.


### ✅ ĐÃ THI HÀNH 2026-08-22 (AT-1) — **PHÁN QUYẾT CỦA CHỦ SỞ HỮU ngày 2026-08-22** (đọc ở khối ngay trên, trong chính thân mục này). MỘT BỀ MẶT MỚI, và ba bề mặt cũ KHÔNG dịch một byte

🔨 **Phán quyết được thi hành đúng hình dạng nó ra.** Một **đường RIÊNG** cho thân request:
* `St4i.EdgeCore.Infrastructure.ApiTraceBody` — **file MỚI**, một record mới; và
* `GET /v1/inspector/bodies` — **route MỚI** (`InspectorStreamEndpoint.MapInspectorBodies`), cùng chính
  sách `Policies.Engineer` với luồng WS, vì một cái thân **nhạy cảm hơn** siêu dữ liệu nên không bao giờ
  được với tới bằng một chính sách yếu hơn.

🔴 **BA BỀ MẶT ĐÃ XUẤT BẢN KHÔNG DỊCH MỘT BYTE — CHỨNG MINH BẰNG DIFF, KHÔNG BẰNG LỜI HỨA.** `git diff`
của nhiệm vụ này **không chạm** một dòng nào trong: `src/St4i.EdgeCore/Infrastructure/ApiTraceEvent.cs`
(0 dòng), `web/src/routes/ApiInspector.tsx` (0), `web/src/lib/inspector.ts` (0),
`src/St4iMachineSimulator/ViewModels/InspectorViewModel.cs` (0),
`src/St4iMachineSimulator/Views/ApiInspectorView.xaml` (0), `web/src/components/TraceTable.tsx` (0).
`ApiTraceEvent` giữ **đúng mười** thành phần; `EventBus.Traced` vẫn mang **một** `ApiTraceEvent` và không
gì khác, nên khung `WS /v1/inspector/stream` và **hai** file JSON mà hai nút `Export` ghi ra **giữ nguyên
hình dạng**. Cái giữ nó khỏi trôi về sau là một **nhân chứng**, không phải một quy ước:
`ApiTraceEvent_still_has_exactly_the_ten_published_members_and_no_body` — thêm một thành phần **tuỳ chọn**
`string? RequestBody = null` (dạng biên dịch được, **không làm hỏng một chỗ gọi nào**, tức đúng dạng mà
một người sau sẽ thêm) ⇒ **ĐỎ**.

**TRẦN KÍCH THƯỚC — ĐO TRƯỚC, CHỌN SAU, VÀ BỀ MẶT TỰ NÓI NÓ ĐÃ CẮT.** `ApiTraceBody.DefaultByteCap =
16 KiB`, và cả hai nửa của phép đo được viết vào doc chứ không chỉ vào báo cáo. **Thân thật, đo trên
`Normalizer` với bộ sinh của chính sản phẩm:** process-result sóng **24 mẫu** (WelderSim) = **1 314 byte**;
**20 mẫu** (ScrewdriveSim) = **1 207 byte**; telemetry = **255 byte**; process-result **không** sóng =
**285 byte**. **Nên không hình dạng nào sản phẩm này phát hôm nay bị cắt.** Cái trần tồn tại cho ca kia:
`src/` **không có** giới hạn kích thước nào để thừa kế (AS-1 đã đo, tập rỗng), và một sóng **100 000 mẫu**
— con số mà mục 14 và `openapi.ts` của hệ sinh thái cùng nêu — đo được **2 169 909 byte ≈ 2,07 MiB** và
**BỊ cắt**, với `Truncated` bật để nói thế. 🔴 **Ngân sách thật là tích, và nó được nêu tên:** ring giữ
`EventBus.DefaultCapacity` = 500 phần tử, nên trần trên cái mà tính năng này thêm vào một tiến trình chạy
dài là **500 × 16 KiB = 8 MiB**. Con số mỗi-thân **suy ra từ ngân sách ấy**, không phải ngược lại. Và cái
trần **KHÔNG** phủ được, nói rõ: nó chặn cái được **GIỮ LẠI**, **không bao giờ** chặn cái đã **gửi đi**.

**DANH SÁCH TRƯỜNG NHẠY CẢM — LIỆT KÊ TRƯỚC, RỒI MỚI ĐẾM.** Quần thể khoá mở trọn từ cả **ba** hình dạng
`Normalizer` dựng. *Process result:* `schemaVersion`, `machineCode`, `serialNumber`, `stepType`, `result`,
`ts`, `idempotencyKey`, `metrics`, `recipe`, `waveforms`, **cộng mọi khoá genealogy** — và tập genealogy
là **MỞ**, do vận hành viên/driver đặt, `Normalizer` chuyển tiếp nguyên vẹn. *Inspection:* `schemaVersion`,
`machineCode`, `serialNumber`, `overallResult`, `inspectionTime`, `idempotencyKey`, `measurements`.
*Telemetry:* `samples`. **Rồi mới đếm — DANH SÁCH CHO PHÉP có BẢY khoá**, và chỉ bảy:
`schemaVersion`, `machineCode`, `stepType`, `result`, `ts`, `overallResult`, `inspectionTime`. **Bị che, và
NÊU TÊN từng cái:** `serialNumber` và `recipe` (định danh khách hàng), `metrics`/`waveforms`/
`measurements`/`samples` (dữ liệu đo của khách hàng), **và mọi khoá genealogy — bị che DO CẤU TRÚC**, vì
thứ gì không nằm trên danh sách thì bị che dù có ai lường trước nó hay không. Mỗi thân mang
`WithheldKeys` (tên, kèm **số phần tử** cho khoá là tập hợp — hình dạng, không phải nội dung) và
`WithheldKeyCount`, **nên không người đọc nào có thể nhầm cái mình xem là toàn văn**. Phép che áp ở
`ApiTraceBody.From`, được gọi **tại chỗ dựng sự kiện** trong `EdgePipeline` — **không** ở chỗ render, vì
một bản ghi chỉ được che trên đường ra là một bản ghi đã nằm **không che** trong ring.

🔴 **VÀ MỘT LỖ RÒ CỦA CHÍNH BẢN SỬA NÀY, BỊ BẮT BỞI CHÍNH BÀI TEST CỦA NÓ — ghi vì nó là bài học về giới
hạn của một danh sách cho phép.** `idempotencyKey` **đã nằm trên danh sách cho phép** ở vòng đầu: nó *đọc
như* một định danh cấu trúc. Nó không phải. `Normalizer.BuildIdempotencyKey` dựng nó **từ dữ liệu khách
hàng**: mọi hình dạng nhúng **MÃ CÔNG THỨC**, và hình dạng **inspection** nhúng **cả SỐ SERIAL**
(`{machineCode}:{recipeCode}:{serialNumber}:{cycleCounter}`). Tức danh sách cho phép **tự mở cửa sau** cho
đúng hai giá trị mà các mục khác của nó đang che. Một bài test kiểm **tên khoá** sẽ **XANH**; bài test ở
đây kiểm **GIÁ TRỊ được render** và **đỏ ngay**. Đã sửa: khoá thô **rời danh sách cho phép**, và cái còn
lại là `ApiTraceBody.IdempotencyDigest` — **SHA-256, 16 ký tự hex** — trả lời đúng câu mà khoá thô được
muốn cho ("có phải cùng một reading không / có phải một lần thử lại không") mà không mang theo thành phần
nào. 🔴 **Giới hạn của phép digest, nêu chứ không ngụ ý: đây là PHI-ĐỊNH-DANH, không phải bí mật.** Đầu
vào ít entropy và có định dạng biết trước, nên ai cầm danh sách máy có thể **xác nhận một phỏng đoán** bằng
cách băm thử. Nó chặn một lần đổ thân làm lộ mã công thức và số serial một cách tình cờ; nó **không** chống
được một bên đã biết mình đang tìm gì. **Bài học chung, viết lên chính danh sách:** một danh sách cho phép
chỉ tốt bằng giả định rằng các thành viên của nó **đúng như tên chúng gợi ra**.

📎 **Và một tiền đề của brief AT-1 KHÔNG sống sót, đúng như AS-1 đã đo trước đó.** Brief nhắc lại cảnh báo
*"thân và tiêu đề có thể mang khoá `mk_`"*. **Sai trên đường được trace**, và bản thi hành này xác nhận
lại: `ApiTraceBody` chỉ đọc `CanonicalEnvelope.Payload`, mà `EdgePipeline` chỉ dựng sự kiện quanh
`_transport.SendAsync` của một reading — **không tiêu đề nào có mặt trong `CanonicalEnvelope`**. Lý do thật
để che **không phải bí mật**; nó là **dữ liệu đo của khách hàng**, đúng cái thân mục đã viết từ đầu.

**VÒNG ĐỜI CỦA THÂN NẰM TRONG VÒNG ĐỜI CỦA TRACE — DO CẤU TRÚC, KHÔNG DO QUY ƯỚC.** Thân **không** có kho
riêng. `EventBus` nay giữ **một** hàng đợi các cặp `(ApiTraceEvent, ApiTraceBody?)`, nên một thân bị đuổi
**trong đúng cú `Dequeue`** đã đuổi sự kiện của nó — hai ring song song với hai phép đuổi độc lập là cách
một bộ đệm chẩn đoán biến thành một chỗ rò bộ nhớ **và** một kho dữ liệu khách hàng. `RecentBodies(n)` đếm
theo **SLOT của ring**, không theo số thân, và cái trần của route là
`InspectorStreamEndpoint.MaxBodySlotWindow = 200` — **ghim bằng `= BackfillEventCount`**, để lane thân
**không bao giờ** với ngược xa hơn lane sự kiện mà người đọc đang đối chiếu. **Mọi cái trần đều là một
TRƯỜNG trên response** (`slotWindow`, `maxSlotWindow`, `ringCapacity`, `retainedByteCap`,
`maxWithheldKeysListed`, `allowedKeys`) — đúng bài học mục 28: một bề mặt in **giá trị** của cái trần mà
không bao giờ gọi nó là trần thì người đọc không phân biệt được một danh sách **ngắn** với một danh sách
**bị cắt**.

🔴 **CÁI BỀ MẶT NÀY KHÔNG LÀM, NÊU RA ĐỂ KHÔNG AI SUY RA NGƯỢC.** Nó **không** cho xem **GIÁ TRỊ đo**: câu
hỏi nó trả lời là *"mình đang gửi cái gì, trường nào có mặt, mỗi thứ bao nhiêu phần tử"*, **không** phải
*"chi tiết ấy đo được bao nhiêu"*. Và **không dụng cụ UI nào được thêm** trong nhiệm vụ này — bề mặt mới là
một route, đọc được bằng một client HTTP đã xác thực, **không** phải một panel trong pane Inspector. Nên
câu ở tiêu đề mục — *"không dụng cụ UI nào trong sản phẩm này đọc được payload đi ra"* — **chỉ được đóng
MỘT PHẦN**: nay **có** một đường trong sản phẩm để đọc, nhưng nó **chưa** phải một dụng cụ UI. 🔴 **Việc
KHÔNG chạm `web/` cho mục này là CỐ Ý và nó tự nó là bằng chứng:** file duy nhất chứa `handleExport` là
`web/src/routes/ApiInspector.tsx`, nên **không mở nó ra** là cách rẻ nhất và chắc nhất để chứng minh file
xuất thứ nhất không dịch.

**Nhân chứng:** `tests/St4i.EdgeCore.Tests/Infrastructure/ApiTraceBodySeparateLaneTests.cs`, **sáu**
`[Fact]`, mỗi cái nêu tên đối chứng của nó. **Ba cặp đối chứng chạy TRỌN rồi hoàn nguyên:** thêm thành phần
tuỳ chọn vào `ApiTraceEvent` ⇒ nhân chứng bề-mặt-đóng-băng **ĐỎ**; trả `idempotencyKey` về danh sách cho
phép ⇒ **HAI** nhân chứng **ĐỎ**; bỏ phép cắt ⇒ nhân chứng trần **ĐỎ**. Sau khi hoàn nguyên: **6/6 xanh**.

---

---

## 33. `GET /v1/scenario` nói dối theo chiều NGƯỢC LẠI — tấm gương của mục 18, và nó BÁC một lập luận mà mục 18 đã dùng để tự đóng

🔴 **CHỜ ANH.** Mở 2026-08-22 (AU-1). Phát hiện này trước đó **chỉ sống trong một thông điệp merge và trong
`.superpowers/`** — thư mục **bị gitignore** — nên chủ sở hữu không có đường dẫn nào để mở nó. **Xác nhận lại
trên mã trước khi viết**, và phép xác nhận **làm tập ghi rộng ra**, xem dưới.

**Đo được cái gì.** `GET /v1/scenario` đọc **duy nhất** `_scenario` và `_activePresetName`. `PUT /v1/mode`
**không ghi cái nào trong hai**: nó đi `ApplyMode` → `TransportCoordinator.ApplyModeInternal` →
`SwitchableTransport.SetInner(target)`, và tập đích của nó là `{_live, _auto, _demo}` — **`_outageTransport`
KHÔNG nằm trong tập ấy**. Nên transport outage bị **ghi đè**, còn `_scenario.NetworkOutage` **vẫn `true`**:
phản hồi tiếp tục mang `networkOutage: true`, `activePreset: "network-outage"` và dòng trạng thái
*"network outage (acks queued, never failed)"* trong khi cái transport đang lắp là một cái khác hẳn.

🔴 **Ba phép đo làm tập ghi RỘNG HƠN câu chuyện ban đầu — nêu ra chứ không giữ phiên bản gọn hơn:**
1. **Chuyển SANG Demo cũng xoá outage.** Đích là `_demo`, tức singleton DI `new DemoTransport()` với mặc
   định (`latencyMs: 40`, `fakeErrorRate: 0.0`) — **không phải** cái outage `latencyMs: 60`,
   `fakeErrorRate: 0.9`.
2. **Một `PUT /v1/mode` KHÔNG ĐỔI GIÁ TRỊ cũng xoá.** `ApplyMode` tự khai *"Idempotent — always re-applies"*
   và chỉ phát `ModeChanged` **khi giá trị khác đi**. Nên đặt lại đúng chế độ đang chạy **lắp lại transport
   mà KHÔNG phát sự kiện nào**.
3. **`PUT /v1/mode` KHÔNG phải route duy nhất.** `PUT /v1/settings` → `FleetCore.UpdateSettings` →
   `TransportCoordinator.RebuildLive(...)` → `if (Mode is Live or Auto) ApplyModeInternal(Mode)` → cùng
   `SetInner`. **Đổi serverUrl / machineCode / verifyTls là xoá outage** trên mọi host Live/Auto. Đây đúng
   hình dạng mà AR-1 đã tự sửa cho mục 18 (*"🔴 Câu SAI thứ nhất — 'một route'"*), lặp lại ở chiều gương.

🔴 **Và nó BÁC một lập luận đã công bố mà mục 18 dùng để tự đóng.** AR-1 rút khẳng định của mục 18 rằng pane
API-trace là bề mặt trung thực duy nhất, với lý do *"bề mặt nói thật ĐÃ CÓ SẴN"* — chính là
`GET /v1/scenario`, vì nó có trường `NetworkOutage` và một `StatusLine` gọi tên outage; và trên cơ sở đó AR-1
kết luận điều kiện DỪNG *"không nổ"*. **Câu ấy chỉ đúng theo CHIỀU AR-1 đã đo** (outage được yêu cầu ⇒ outage
được báo). **Theo chiều ngược lại — outage đã bị xoá ⇒ vẫn được báo là còn — nó SAI**, và pane API-trace lại
là bề mặt duy nhất nói thật. Cùng khẳng định ấy nay nằm trong **ba doc comment** do AR-1 viết
(`ScenarioEndpoints`, `DemoModeGate`, `Enums`) và cả ba thừa hưởng cùng điểm mù. **Cổng của AR-1 KHÔNG bị
ảnh hưởng** — nó chạy trước `ApplyScenario`; cái bị ảnh hưởng là **lập luận** AR-1 dùng để đóng nửa
*"bề mặt nào nói thật"* mà không thêm trường.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EngineApi.Endpoints.ScenarioEndpoints` (route `GET /v1/scenario`);
`St4i.EngineApi.Endpoints.ModeEndpoints` (route `PUT /v1/mode`); `St4i.EdgeCore.Fleet.FleetCore._scenario`,
`FleetCore._activePresetName`, `FleetCore.CurrentScenario`, `FleetCore.ApplyScenario`,
`FleetCore.ApplyNetworkOutageLocked`, `FleetCore._outageTransport`, `FleetCore.UpdateSettings`;
`St4i.EngineApi.Fleet.FleetHost.CurrentScenarioDto`, `FleetHost.ApplyMode`;
`St4i.EdgeCore.Transport.TransportCoordinator.ApplyMode`, `TransportCoordinator.ApplyModeInternal`,
`TransportCoordinator.RebuildLive`; `St4i.EdgeCore.Transport.SwitchableTransport.SetInner`;
`St4i.EngineApi.Fleet.ScenarioDto.BuildStatusLine`. **Bề mặt ĐỌC, liệt kê rồi đếm:** `web/src/lib/api.ts`
(`endpoints.scenario`, `useScenario` — **poll 1 000 ms**, `setScenarioCurrent`) và
`web/src/routes/Scenario.tsx`; test `AuditWiringTests`, `RbacPolicyTests`. **Một bên tiêu thụ HTTP sản
xuất**, và không cái nào ngoài `tools/machine-simulator/` — `server/`, `client/`, `examples/` và vỏ WPF
**đều KHÔNG gọi route này** (WPF bind trong tiến trình qua `FleetService.Scenario`).

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận (lời nói dối, như đang ship):* vận hành viên bật outage, rồi bất kỳ ai lật chế độ ở TopBar hoặc
lưu một thay đổi Settings — **kể cả lật sang đúng giá trị đang có** — làm reading thật chảy ra hệ sinh thái
thật, trong khi trang Scenario **vẫn vẽ công tắc "Network outage" BẬT** mỗi giây. Người vận hành tin fleet
đang nằm sau một bộ bịa; nó đang sống. **Không dòng audit nào ghi việc xoá** — `mode.switch` chỉ mang
`old`/`new` **mode**. Mục 18 là một **âm tính giả** (cổng không gác); cái này là một **dương tính giả** về sự
bịa đặt — **cùng trục, ngược dấu**, nên "tấm gương" là cách gọi đúng. 🔴 **Và một hiệu ứng bậc hai mà brief
không nêu:** `Scenario.tsx` gieo `latestRef` từ ảnh chụp vừa poll và **trộn nó vào MỌI thân POST**, nên sau
một lần lật chế độ, **kéo thanh trượt cycleRate sẽ POST `networkOutage: true` và LẮP LẠI transport outage** —
một phép đọc cũ biến thành một phép ghi, từ một cái điều khiển không nói gì về mạng.
*Chiều ngược (giá của việc sửa), và phải nói cả hai nhánh:*
**(b1) sửa phía GHI** (lật chế độ thì xoá `_scenario.NetworkOutage`): một lần lật chế độ sẽ **lặng lẽ sửa một
scenario mà một Engineer đã áp và đã được audit**, không có dòng `scenario.apply` nào để đối chiếu, và công
tắc lật dưới tay người dùng. Cơ học còn nặng hơn vẻ ngoài: `_scenario` chỉ ghi được trong `ApplyScenario`
dưới `_gate`, mà `_gate` **có thể dừng và dựng lại mọi pipeline** — biến `PUT /v1/mode`, hôm nay là hai câu
lệnh **không khoá** và được ghi rõ là *"Neither call takes a lock"*, thành một đường có thể lấy `_gate` và
khởi động lại fleet.
**(b2) sửa phía ĐỌC** (`GET /v1/scenario` báo cái transport đang thật sự lắp): không mất năng lực nào, không
gì khởi động lại. **Nhưng nó đổi NGHĨA của một trường đã xuất bản** từ *"đã yêu cầu"* sang *"đang lắp"* mà
không đổi hình dạng payload — đúng loại thay đổi mà AR-1 đã đặt cược lập luận DỪNG của mình lên. Nó cũng đổi
hành vi client, vì `Scenario.tsx` dùng chính giá trị ấy để gieo thân request kế tiếp.

**Nếu KHÔNG quyết định.** Bề mặt mà AR-1 đề cử làm *"bề mặt nói thật"* của sản phẩm ở lại **đúng một nửa thời
gian**, và **không nhân chứng nào tồn tại**: file test duy nhất nhắc cả `networkOutage` lẫn `/v1/mode` là
`AuditWiringTests`, và bốn bài outage (349–444) với các bài mode (158–178, 706) **không bao giờ chạm nhau** —
không gì ở đâu khẳng định chuỗi ấy. Nên chỗ lệch này **không thể được phát hiện bởi cổng**, chỉ bởi một vận
hành viên tin nhầm. 🔴 **Và vỏ WPF mang MỘT BẢN SAO của cùng chỗ lệch** (`FleetService` có một
`ApplyNetworkOutageLocked` tương đương từng byte, trong khi `SettingsViewModel`/`AppShellViewModel` gọi
`ApplyMode` thẳng, không ghi lại scenario) — nên "không quyết" là để **hai** bản sao trôi, không phải một.

### ✅ ĐÃ THI HÀNH 2026-08-22 (AV-1, base `e6faec60`) — **SỬA PHÍA ĐỌC**; hai hướng đều có giá và giá của hướng bị loại ghi ở đây; **bốn câu của mục này không sống sót nguyên vẹn qua phép đo**

**Đã làm gì, một câu.** `GET /v1/scenario` nay báo **transport đang thật sự lắp** thay vì cờ đã khai:
`St4i.EngineApi.Fleet.FleetHost.CurrentScenarioDto` dựng `ScenarioDto` từ
`_core.CurrentScenario with { NetworkOutage = _core.NetworkOutageTransportInstalled }`. **Không trường
mới nào**, không tên công khai nào đổi, hình dạng bản ghi y nguyên (cùng sáu thành viên, cùng kiểu);
`POST /v1/scenario`, `/preset`, `/burst` **giữ nguyên** giá trị **đã yêu cầu** — xem "hai nghĩa" dưới.

🔴 **HAI HƯỚNG ĐỒNG BỘ, VÀ VÌ SAO HƯỚNG KIA BỊ LOẠI — giá ghi ra chứ không im lặng.** Mục này đã nêu cả
hai ở `(b1)`/`(b2)` và phép đo của AV-1 xác nhận cả hai đều có giá; đây là **giá đã trả** và **giá đã từ
chối trả**.

* **BỊ LOẠI — (b1) sửa phía GHI** (một lần lật chế độ xoá `_scenario.NetworkOutage`). **Giá của nó, đo
  được, ba phần:** (i) một lần lật chế độ sẽ **lặng lẽ huỷ một scenario mà một Engineer đã áp và đã
  được audit**, và **không có hàng audit nào** để đối chiếu — `mode.switch` chỉ mang `old`/`new` **mode**,
  điều mà nhân chứng HTTP dưới đây khẳng định thành assertion chứ không để làm lời kể. (ii) **Cơ học
  nặng hơn vẻ ngoài:** `_scenario` chỉ ghi được trong `FleetCore.ApplyScenario`, dưới `_gate`, và
  `ApplyScenario` **có thể dừng và dựng lại mọi pipeline** — nên `PUT /v1/mode`, hôm nay là hai câu lệnh
  được ghi rõ *"Neither call takes a lock"* trên `FleetHost.ApplyMode`, sẽ thành một đường **lấy `_gate`
  và khởi động lại cả fleet** vì người dùng bấm một nút ở TopBar. (iii) 🔴 **Và một phần mà thân mục
  chưa nêu:** cùng phép sửa ấy phải lặp lại ở `FleetCore.UpdateSettings`, nơi `RebuildLive` được gọi
  **ngay sau một khối `lock (_gate)`** trên cùng luồng — tức hướng (b1) đưa một `ApplyScenario` (vốn lấy
  `_gate`) vào một đường đã đi qua `_gate`, ở đúng phương thức mà năm khối chú thích trong
  `FleetCore.cs` đã dành để giải thích thứ tự khoá. Hướng (b1) **không phải là "một dòng ở chiều kia"**.
* **ĐÃ CHỌN — (b2) sửa phía ĐỌC.** **Giá của nó, cũng đo được, và không phải bằng không:** nó **đổi
  NGHĨA của một trường đã xuất bản** từ *"đã yêu cầu"* sang *"đang lắp"*. Hệ quả cụ thể: sau một lần lật
  chế độ, **cờ mà vận hành viên đã đặt không còn đọc được qua HTTP nữa** — `GET /v1/scenario` trả `false`
  và không bề mặt HTTP nào còn nói *"người này đã từng yêu cầu một outage"*. Trong tiến trình nó vẫn đọc
  được (`FleetHost.CurrentScenario`), nhưng đó là một seam của thư viện, không phải một bề mặt sản phẩm.
  **Đây là cái giá đã trả, và nó được trả có chủ ý**: một bề mặt trạng thái poll mỗi giây trả lời câu hỏi
  *"fleet đang ở sau cái gì"*, không phải *"ai đã bấm gì lúc nào"* — câu thứ hai là việc của sổ audit, và
  sổ audit **có** hàng `scenario.apply` mang trọn scenario đã yêu cầu.

🔴 **HAI NGHĨA TRÊN CÙNG MỘT BẢN GHI, CỐ Ý, VÀ NÊU RA CHỨ KHÔNG ĐỂ AI ĐÓ TÌM THẤY.** `ScenarioDto` là
một bản ghi nhưng hai nhóm route trả lời hai câu hỏi: `GET` báo **đang lắp**; ba `POST` báo **đã yêu cầu
và đã nhận**. Lý do là **hàng audit**: `ScenarioEndpoints` đưa đúng thể hiện ấy cho `AuditRecorder` làm
payload `scenario.apply`/`scenario.preset`, và một hàng audit trả lời *"ai yêu cầu cái gì"*. Suy giá trị
ở đó sẽ để một lần lật chế độ chạy đua với một lần áp **ghi vào sổ rằng vận hành viên đã yêu cầu một thứ
họ không yêu cầu**. Hai nghĩa ấy **trùng nhau ở mọi lúc trừ đúng cửa sổ mục này đo**, và cả hai được ghi
ở doc comment của `ScenarioDto` và được khẳng định bằng một guard.

🔴 **HAI THỨ CỐ Ý VẪN BÁO THEO GIÁ TRỊ ĐÃ KHAI — vì nêu một nửa là làm lại đúng khuyết tật này.**
(1) `ActivePreset` vẫn là tên preset **vận hành viên đã chọn**: đó là một sự thật về **lựa chọn của họ**
và nó không sai. Nên một outage đã bị xoá đọc ra
`"network-outage — cycleRate=1.00x, defect=0%, fault=0%, network normal."` — **hai câu đúng**, không phải
một lời nói dối. (2) `CycleRate`/`DefectRate`/`FaultRate` giữ nguyên như đã khai: chúng đổi thứ **bộ mô
phỏng sinh ra**, không đổi transport nào đang lắp, và suy chúng ra từ bất cứ đâu **chính là** lỗi đồng bộ
mù ở trục còn lại. Cả hai đều có guard riêng.

**Ở đâu — trỏ bằng TÊN.** `St4i.EdgeCore.Fleet.FleetCore.NetworkOutageTransportInstalled` (**thành viên
công khai MỚI**, không phải một tên đổi); `St4i.EngineApi.Fleet.FleetHost.CurrentScenarioDto`;
`St4i.EngineApi.Fleet.ScenarioDto` + `ScenarioDto.From` + `ScenarioDto.BuildStatusLine`;
doc comment đã đính chính tại chỗ ở `St4i.EngineApi.Endpoints.ScenarioEndpoints`,
`St4i.EdgeCore.Config.DemoModeGate.Enabled`, `St4i.EdgeCore.Models.TransportMode.Demo` và
`St4i.EdgeCore.Engine.ScenarioConfig`'s `NetworkOutage`. Nhân chứng:
`tests/St4i.EngineApi.Tests/ScenarioTransportTruthTests.cs` (mới, chín `[Fact]`) và một `[Fact]` trong
`tests/St4i.EngineApi.Tests/Auth/AuditWiringTests.cs`.

🔴 **VÌ SAO SO SÁNH THAM CHIẾU, KHÔNG SO SÁNH MODE — chỗ dễ sửa sai nhất và nó không đọc ra được từ tên.**
`SwitchableTransport.Mode` trả `TransportMode.Demo` cho **cả** thể hiện outage **lẫn** singleton Demo của
DI. Một bản sửa đọc `Mode` sẽ báo *"đang outage"* cho một máy triển lãm mà vận hành viên **cố ý** đặt ở
Demo, và sẽ **im lặng** đúng ở ca này khi chế độ đang chạy là Demo. Đo được: hai thể hiện khác nhau
(`latencyMs: 60, fakeErrorRate: 0.9` đối lại `latencyMs: 40, fakeErrorRate: 0.0`), nên **danh tính tham
chiếu** là thứ duy nhất phân biệt được, và guard đầu tiên trong bộ nhân chứng khẳng định đúng điều đó
(`Assert.NotSame` + `Assert.Equal(TransportMode.Demo, switchable.Mode)` cạnh nhau).

**BỀ MẶT ĐỌC — LIỆT KÊ TRƯỚC, ĐẾM SAU, và phép liệt kê của mục này ĐỨNG VỮNG có sửa một chỗ.** Quét cả
commit bằng `git grep --full-name -i networkOutage HEAD -- ':(top)'`, đứng ở
`D:\SOURCES\avi-aoi-sim` (repo root), nên `server/` và `client/` — **vắng khỏi đĩa, có trong commit** —
đều nằm trong tập quét. **Không file nào ngoài `tools/machine-simulator/` nhắc tới nó.** Trong đó:

* **Tiêu thụ HTTP `GET /v1/scenario`:** `web/src/lib/api.ts` (`endpoints.scenario`, `useScenario`) và
  `web/src/routes/Scenario.tsx`. 🔴 **"Poll mỗi giây" là lời của nhiệm vụ trước và nó ĐÚNG** — đo lại:
  `useScenario` khai `refetchInterval: 1000`. **MỘT** bên tiêu thụ HTTP sản xuất, đúng như mục nêu.
* **Test chạm route:** `Auth/AuditWiringTests` và `Auth/RbacPolicyTests`. 🔴 **Sửa một chỗ:**
  `RbacPolicyTests` **không** nhắc `networkOutage` — nó liệt kê route trong bảng chính sách
  (`new("/v1/scenario", new[] { "GET" }, Policies.Operator)`). Nó là bề mặt đọc của **ROUTE**, không của
  **TRƯỜNG**; mục gộp hai thứ. Không bài nào của nó phải đổi.
* **Trong tiến trình, KHÔNG qua HTTP:** vỏ WPF — `Services/FleetService.Scenario`,
  `ViewModels/ScenarioViewModel`, `Views/ScenarioView.xaml`, `i18n/Strings.{en,vi}.xaml`. Mục nói đúng:
  WPF **không gọi route này**.
* **Chuỗi hiển thị:** `web/src/i18n/{en,vi}.ts`, `web/tests/support/engine.ts`, `web/tests/06-scenario.spec.ts`,
  `web/tests/19-audit.spec.ts`. Không cái nào khẳng định về chiều lệch này.

🔴 **BẢN SAO THỨ HAI Ở WPF: ĐO ĐƯỢC, KHÔNG SỬA, VÀ LÝ DO LÀ MỘT PHÉP ĐO CHỨ KHÔNG PHẢI MỘT KHẨU VỊ.**
Mục nói đúng: `St4iMachineSimulator.Services.FleetService` mang một `ApplyNetworkOutageLocked` tương đương
và `_scenario` riêng, còn `SettingsViewModel.OnModeChanged`/`AppShellViewModel.OnModeChanged` gọi
`_transportCoordinator.ApplyMode(value)` **thẳng**, không đi qua `FleetService`, nên `ScenarioChanged`
không bao giờ phát và màn hình Scenario của WPF giữ nguyên công tắc đã bật. **Vì sao không sửa cùng lúc:
trong cây này KHÔNG có project test nào chạm `St4iMachineSimulator`** — năm project test là
Abstractions / Conformance / EdgeCore / EdgeService / EngineApi, và không project nào tham chiếu vỏ WPF.
Một bản sửa ở đó **không thể có nhân chứng đỏ-được thuộc bất kỳ loại nào**, và luật của loạt nhiệm vụ này
là không đổi hành vi mà không có nhân chứng. **Nên bản sao ấy vẫn trôi, và nó được ghi tên ở đây thay vì
bị nói là đã xong.**

🔴 **NHÂN CHỨNG ĐỎ ĐƯỢC + CẶP ĐỐI CHỨNG CHẠY TRỌN, HOÀN NGUYÊN — và phép đếm của chính tác giả SAI, ghi
lại vì đó là phát hiện.** Đột biến đối chứng là **một dòng**: `FleetHost.CurrentScenarioDto` hoàn nguyên
về `ScenarioDto.From(_core.CurrentScenario, _core.ActivePresetName)`, giữ nguyên thành viên mới và cả
mười bài, nên phép so sánh cô lập **đúng** thay đổi hành vi.

* `ScenarioTransportTruthTests` dưới đối chứng: **`Failed: 6, Passed: 3`**. Hoàn nguyên đột biến:
  **`Passed: 9`**.
* `AuditWiringTests.ModeSwitch_*` dưới đối chứng: **`Failed: 1, Passed: 1`** (bài cũ
  `ModeSwitch_WrittenByEngineer_…` vẫn xanh; bài mới đỏ). Hoàn nguyên: **`Passed: 2`**.
* 🔴 **Doc comment của chính file test viết "ba trong chín đỏ" TRƯỚC khi chạy đối chứng, và phép đo trả
  về SÁU.** Ba bài mang **một assertion nhân chứng VÀ một assertion guard trong cùng một thân** — bài về
  ba núm mô phỏng, bài về `ActivePreset`, và bài ghim phần dư. Doc comment **đã sửa tại chỗ** và phép
  đếm sai được ghi lại ở đây và ở `scripts/verify-suites.sh`, vì một nhãn *nhân chứng/guard* rút ra từ
  **ý định** thay vì từ **phép chạy** đúng là thứ quy ước này lập ra để chặn.
* **XANH CẢ HAI PHÍA, tức GUARD chứ KHÔNG phải nhân chứng, và tự dán nhãn trên chính nó:**
  `WhileTheOutageTransportIsInstalled_…` (một bản build xoá quách tính năng cũng sẽ xanh nếu thiếu nó),
  `WithNoScenarioEverApplied_…`, và `TheApplyResponse_ReportsWhatWasREQUESTED_NotWhatTheGetWouldDerive`.

**PHẦN DƯ MÀ BẢN SỬA NÀY KHÔNG ĐÓNG, ghim bằng một bài test thay vì để tìm lại.** Cờ đã khai **vẫn**
`true` sau khi transport bị lấy đi — không gì trong sản phẩm xoá nó — nên nó **còn với tới được**:
`FleetCore.Burst` áp lại `_scenario with { CycleRateMultiplier = 6.0 }`, chạy
`ApplyNetworkOutageLocked(true)` và **lắp lại** bộ bịa, từ một cờ mà bề mặt vừa báo là không có.
`AfterAModeSwitch_TheDeclaredFlagIsStillSet_…` khẳng định **cả hai nửa** trong một cặp assertion. 🔴 **Và
một phần dư mà bản sửa này VÔ TÌNH ĐÓNG, nói ra vì nó là một thay đổi hành vi phía client:** hiệu ứng bậc
hai mục này nêu — `Scenario.tsx` gieo `latestRef` từ ảnh chụp vừa poll và trộn nó vào **mọi** thân POST,
nên sau một lần lật chế độ, kéo thanh trượt `cycleRate` **POST `networkOutage: true` và lắp lại bộ bịa** —
**không còn xảy ra**, vì ảnh chụp nay là `false`. **Không một byte nào của `web/` bị sửa**; hành vi đổi
vì đầu vào của nó đổi. Đó là một lý do nữa (b2) được chọn, và nó cũng là lý do câu này phải nằm ở đây:
một thay đổi hành vi client **không có diff** là loại thay đổi không ai tìm lại được.

**Bằng chứng:** `scripts/verify-suites.sh` khối `AV-1` ngay trên `EXPECT_ENGINEAPI` (1395 → 1405);
`.superpowers/sdd/items-33-30-31/task-1-report.md`.

---

## 31. Mười hai artefact build — 7 `.xml` + 5 `.pdb` — đi vào MSI; ba trong số đó đã ở đó từ N-1/N-2

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). 🔴 **Cũng là một trong hai câu hỏi bị các brief liên tiếp CẤM
mở.** Phép đo đã có từ **2026-08-19 (AF-1)** và nằm ở **§8 của mục 12**, tức **Phần II** — nhưng
**nó chưa bao giờ là một mục phán được**, nên chưa bao giờ có chỗ để anh phán. Mục này là chỗ ấy.

📎 **Sửa một chữ trong lời giao việc, vì phép đo nói khác.** Câu giao cho nhiệm vụ này nói ba file ấy
*"không hồ sơ nào ghi"*. **Có hồ sơ**: bảng của AF-1 ở §8 mục 12 liệt kê đủ mười một artefact của
2026-08-19 và ghi rõ file nào của N-1, file nào của N-2. Cái thiếu **không phải bản ghi** — mà là
**một mục ở Phần I**, tức một chỗ để quyết định. Đó chính xác là thiếu sót mà file này lập ra để vá,
và ghi nhầm nó thành "không ai ghi" sẽ làm hỏng chẩn đoán.

**Đo được cái gì — LIỆT KÊ TRƯỚC, con số viết SAU** (bảng của AF-1, giữ nguyên, cộng cái mà đợt 3
thêm vào):

| file | loại | ai sinh |
|---|---|---|
| `Microsoft.Web.WebView2.Core.xml` · `…WinForms.xml` · `…Wpf.xml` | tài liệu | vendor |
| `St4i.DesktopShell.xml` | tài liệu | **của ta, N-1/N-2** |
| `engine/St4i.Connector.Abstractions.xml` | tài liệu | **của ta, N-2** |
| `engine/St4i.EdgeCore.Serial.xml` | tài liệu | **của ta, N-1** |
| `engine/St4i.EdgeCore.xml` | tài liệu | **của ta, đợt 3 (AF-1, 2026-08-19)** — 1,3 MB, 959 `<member>` lúc đo |
| `St4i.DesktopShell.pdb` · `engine/St4i.Connector.Abstractions.pdb` · `engine/St4i.EdgeCore.Serial.pdb` · `engine/St4i.EdgeCore.pdb` · `engine/St4i.EngineApi.pdb` | **ký hiệu gỡ lỗi** | của ta |

**Đếm sau: 7 `.xml` + 5 `.pdb` = 12.** Ba trong bảy `.xml` là **của ta và đã ở đó từ N-1/N-2**, tức
**từ trước cả khi mục 12 được mở**; cái thứ tư của ta là hệ quả trực tiếp của phán quyết
*"BẬT CỜ, KHÔNG MIỄN TRỪ"*, và `src/St4i.EdgeCore/St4i.EdgeCore.csproj` hôm nay mang
`<GenerateDocumentationFile>true</GenerateDocumentationFile>`, nên con số hôm nay là **7**, không
phải 6.

**Cơ chế, hai mắt xích chịu lực và cả hai đều được git theo dõi:** `St4i.Installer.wixproj` harvest
**cả thư mục** `publish-desktop/**`, và `exclude-shell-and-engine-exe.xslt` loại **đúng hai tên
`.exe`** — **nó không lọc theo đuôi**. Nên mọi artefact phụ nằm trong thư mục publish đều được cài.

**Ở đâu trong mã — trỏ bằng TÊN.** `packaging/installer/St4i.Installer.wixproj`;
`packaging/installer/exclude-shell-and-engine-exe.xslt`; `packaging/installer/Package.wxs`;
`src/St4i.EdgeCore/St4i.EdgeCore.csproj` (`GenerateDocumentationFile`);
`tools/machine-simulator/Directory.Build.props` (khối N-1/N-2 giải thích vì sao cờ ấy bật);
`docs/owner-decisions.md` §8 của mục 12 (bảng gốc của AF-1).

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* mười hai file này đang được **giao cho khách hàng** mà không ai quyết là nên giao.
🔴 **Năm file `.pdb` là CÙNG một câu hỏi và nhạy hơn `.xml` về dịch ngược** — chúng mang tên phương
thức, tên biến cục bộ và ánh xạ dòng. Và bảy file `.xml` nay mang **văn xuôi mà bốn đợt vừa viết
ra**, trong đó có những câu mà chính các đợt ấy đo là **sai** (mục 26) — tức sản phẩm này đang giao
các khẳng định chưa ai kiểm được tính đúng, dưới dạng tài liệu API.
*Chiều ngược:* `.xml` **là** lý do cờ được bật: nó là thứ cho một người tích hợp thấy IntelliSense
trên `St4i.Connector.Abstractions`, và đó là một giá trị thật cho đúng đối tượng mà mục 25 gọi là
"driver author or integrator". `.pdb` là thứ biến một stack trace của khách hàng thành một số dòng
đọc được — bỏ chúng đi là **tự làm mù mình lúc hỗ trợ hiện trường**. Và cái giá của việc **giữ
nguyên** là **không**: không hành vi nào đổi, chỉ có kích thước bản cài.

**Nếu KHÔNG quyết định.** Mười hai file tiếp tục đi vào mọi bản cài, con số tiếp tục lớn dần mỗi lần
một project bật cờ tài liệu, và **không dụng cụ nào canh nó**. 🔴 **Điều ấy được nêu tên chứ không
để im:** nửa A của cổng đọc **log build**, nửa B đọc **khai báo trong cây nguồn** — **cả hai là dụng
cụ về cây nguồn**. Câu hỏi *"cái gì thực sự được cài"* đòi một dụng cụ **thứ ba**, và dựng nó đòi một
`publish-desktop/` sạch cùng một lần dựng MSI, tức một brief khác. Cho tới lúc đó, con số 12 là
**đúng tới ngày 2026-08-19 cộng một suy luận về đợt 3**, không phải một phép đo trên một `.msi` vừa
dựng.

### ✅ ĐÃ QUYẾT VÀ ĐÃ THI HÀNH 2026-08-22 (AV-1, base `e6faec60`) — 🔨 **GIAO CẢ MƯỜI HAI, KHÔNG ĐỔI MỘT BYTE NÀO CỦA BAO BÌ**. **N = 12 đứng vững**; **KHÔNG dựng MSI**; và **câu *"giá của việc giữ nguyên là KHÔNG"* của chính mục này không sống sót qua phép đo**

**Phán quyết, một câu.** Cả bảy `.xml` và cả năm `.pdb` **tiếp tục được giao**;
`packaging/installer/St4i.Installer.wixproj`, `exclude-shell-and-engine-exe.xslt`, `Package.wxs` và mọi
`.csproj` **không đổi một byte**. Cái đổi là **cái giá đã được ghi tên**: nó không còn là "không".

🔴 **KHÔNG DỰNG MSI, VÀ KHÔNG BUỘC PHẢI DỰNG.** Lời giao việc cho phép dựng nếu **buộc**; nó không buộc.
Cả mười hai đo được **trên đĩa**, trong `publish-desktop/` — sản phẩm của một lần
`build-installer.ps1` đầy đủ ngày **2026-08-20**, mà bản thân script **xoá sạch `publish-desktop/`** trước
mỗi lần publish, nên cây ấy là **một** lần chạy chứ không phải cặn tích tụ. Harvest đọc **cả thư mục**
`publish-desktop/**` và XSLT loại **đúng hai tên `.exe`** — không lọc theo đuôi — nên *"file nào nằm
trong thư mục ấy"* **chính là** *"file nào vào MSI"*, trừ hai tên ấy. Không có `.msi` nào được dựng và
`publish-desktop/` **không bị đụng tới** (chỉ đọc; `ls`/`find`/`grep`).

**LIỆT KÊ TRƯỚC, ĐẾM SAU — mười hai, và mỗi cái với đường vào của nó.** Đo bằng
`find publish-desktop -name '*.xml' -o -name '*.pdb'`:

| # | file | kích thước | đường vào `publish-desktop/` |
|---|---|---|---|
| 1 | `Microsoft.Web.WebView2.Core.xml` | 612 031 | gói NuGet vendor; `dotnet publish` chép tài liệu XML của package đi kèm assembly |
| 2 | `Microsoft.Web.WebView2.WinForms.xml` | 41 869 | như trên |
| 3 | `Microsoft.Web.WebView2.Wpf.xml` | 143 232 | như trên |
| 4 | `St4i.DesktopShell.xml` | 4 773 | `GenerateDocumentationFile=true` trong `St4i.DesktopShell.csproj` (**N-1/N-2**) |
| 5 | `engine/St4i.Connector.Abstractions.xml` | 244 573 | cờ ấy trong `St4i.Connector.Abstractions.csproj` (**N-2**) |
| 6 | `engine/St4i.EdgeCore.Serial.xml` | 111 529 | cờ ấy trong `St4i.EdgeCore.Serial.csproj` (**N-1**) |
| 7 | `engine/St4i.EdgeCore.xml` | 1 449 898 | cờ ấy trong `St4i.EdgeCore.csproj` — **hệ quả trực tiếp của phán quyết *"BẬT CỜ, KHÔNG MIỄN TRỪ"* của mục 12** |
| 8 | `St4i.DesktopShell.pdb` | 20 956 | `DebugType` **mặc định của SDK** (portable). **Không `.csproj` nào và `Directory.Build.props` cũng KHÔNG khai `DebugType`/`DebugSymbols` ở đâu cả** — năm `.pdb` này không được ai chọn, chúng là mặc định |
| 9 | `engine/St4i.Connector.Abstractions.pdb` | 20 360 | như trên |
| 10 | `engine/St4i.EdgeCore.Serial.pdb` | 17 536 | như trên |
| 11 | `engine/St4i.EdgeCore.pdb` | 172 044 | như trên |
| 12 | `engine/St4i.EngineApi.pdb` | 239 724 | như trên; `PublishSingleFile=true` gói DLL quản lý vào `.exe` nhưng **để `.pdb` ở ngoài** |

**Đếm sau: 7 `.xml` + 5 `.pdb` = 12. Con số của mục ĐỨNG VỮNG**, và *"ba trong bảy là của ta và đã ở đó
từ N-1/N-2"* cũng đứng vững (số 4, 5, 6).

🔴 **NHƯNG HAI CON SỐ TRONG BẢNG CỦA AF-1 ĐÃ DỊCH, và mục tự dán nhãn *"lúc đo"* nên đây là bổ sung chứ
không phải đính chính.** `engine/St4i.EdgeCore.xml` là **1,4 MB** với **1 083** phần tử `<member>`, không
phải "1,3 MB, 959 `<member>`". Bốn đợt tài liệu chạy sau 2026-08-19 là lý do. 🔴 **Và ngay cả 1 083 cũng
là một phát biểu về thứ CÒN ĐANG CHUYỂN ĐỘNG:** cây `publish-desktop/` trên đĩa được publish từ một
commit **trước** AP-1…AU-1, tức trước ít nhất năm đợt sửa doc comment nữa; con số hôm nay là *"cái mà một
lần publish ngày 2026-08-20 sinh ra"*, không phải *"cái mà một lần publish từ `e6faec60` sẽ sinh ra"*.
Để so sánh: `Microsoft.Web.WebView2.Core.xml` của vendor có **1 097** `<member>` — tài liệu API của sản
phẩm này nay **ngang cỡ** tài liệu của WebView2.

🔴 **GIÁ CỦA VIỆC GỠ, VÀ GIÁ CỦA VIỆC GIỮ — CẢ HAI, và nửa thứ hai là chỗ mục này nói SAI.**

*Giá của việc GỠ `.pdb`* — **đo được, không phải một lo ngại chung chung.** Từng file mang, phân biệt
trong phạm vi của nó: `EdgeCore.pdb` **119**, `EngineApi.pdb` **113**, `Connector.Abstractions.pdb` **17**,
`EdgeCore.Serial.pdb` **9**, `DesktopShell.pdb` **8** tên file `.cs`, cùng ánh xạ dòng. 🔴 **Cộng lại là
266, HỢP LẠI là 259, và hai con số ấy không thay thế được nhau** — chỗ chênh là các file sinh tự động
(`AssemblyInfo.cs`, `*.GlobalUsings.g.cs`, `v10.0.AssemblyAttributes.cs`) cộng `Enums.cs` xuất hiện trong
hai assembly. Bản đầu của dòng này viết *"266 tên file `.cs` phân biệt"*, tức trình bày một **tổng** như
một **hợp**; sửa tại chỗ. Đó **chính xác** là thứ biến một stack trace của khách hàng thành một số dòng
đọc được. Gỡ chúng là **tự làm mù mình lúc hỗ trợ hiện trường**, và mục nói đúng.

*Giá của việc GỠ `.xml`* — mất IntelliSense trên `St4i.Connector.Abstractions` cho đúng đối tượng mà mục
25 gọi là *"driver author or integrator"*, tức **lấy lại chính thứ mà phán quyết *"BẬT CỜ"* của mục 12
đã trả giá để có**. Và bảy file ấy mang văn xuôi mà bốn đợt vừa viết, trong đó có những câu mà chính các
đợt ấy đo là sai (mục 26) — nhưng đó là lý do để **sửa văn xuôi**, không phải để **thôi giao tài liệu**.

🔴 *Giá của việc GIỮ* — **mục này viết *"là KHÔNG: không hành vi nào đổi, chỉ có kích thước bản cài"*, và
câu ấy KHÔNG SỐNG SÓT.** Đọc thẳng nội dung năm `.pdb`, chúng mang **ba thứ**, không phải chỉ "tên nội
bộ":
1. **Đường dẫn tuyệt đối của máy dựng.** Bảng document của PDB portable dựng lại
   `D:\SOURCES\avi-aoi-sim\tools\machine-simulator\src\…\*.cs` — bố cục thư mục của người dựng, ổ đĩa
   và tất cả.
2. **259 tên file nguồn phân biệt** (266 nếu cộng năm file rời), tức bản đồ mô-đun nội bộ của sản phẩm,
   giao cho mọi khách hàng nhận `.msi`.
3. 🔴 **Một bản đồ SourceLink nêu đích danh kho và commit.** Nguyên văn, đo được trong
   `engine/St4i.EdgeCore.pdb`:
   `{"documents":{"D:\\SOURCES\\avi-aoi-sim\\*":"https://raw.githubusercontent.com/BGJackFrost/avi-aoi-management/bcbd29dc3ab26a4bb1a1e9d71f92ee06bfebd043/*"}`
   — **tổ chức, tên kho, và SHA commit chính xác**. Không ai chọn thứ này: SourceLink của GitHub bật
   **mặc định** trong .NET SDK khi cây là một repo git có remote GitHub. Nếu kho ấy **riêng tư**, cái bị
   lộ là tên tổ chức + tên kho + SHA; nếu **công khai**, một khách hàng cầm `.msi` **kéo được toàn bộ mã
   nguồn ở đúng commit đã dựng**.

**Nên phán quyết là GIỮ, và giá của nó là ba dòng trên** — không phải "kích thước bản cài". Lý do chọn
GIỮ chứ không GỠ: mất khả năng đọc stack trace của khách hàng là một tổn thất **vận hành, chắc chắn, mỗi
lần có sự cố**; còn ba dòng trên là một tổn thất **thông tin, một lần, và có thể vá bằng một thay đổi
KHÁC** (xem dưới) mà không phải đánh đổi khả năng hỗ trợ.

🔴 **HƯỚNG THỨ BA — CÓ THẬT, KHÔNG LẤY, VÀ NÊU TÊN CHỨ KHÔNG BỎ QUA.** Giữ ký hiệu mà bỏ phần lộ:
`<DeterministicSourcePaths>` ánh xạ gốc tuyệt đối thành một tiền tố trung tính, và tắt SourceLink
(`EnableSourceLink`/`EnableSourceControlManagerQueries`) gỡ bản đồ kho+SHA — tên phương thức và ánh xạ
dòng **vẫn còn**, tức khả năng hỗ trợ hiện trường **không mất**. **AV-1 không lấy nó**, và lý do là một
phép đo chứ không phải sự ngại: xác minh nó **đòi một lần publish rồi đọc lại `.pdb` vừa sinh** — đúng
"dụng cụ thứ ba" mà chính mục này nói là một brief khác — và đổi `Directory.Build.props` cho mọi project
mà không đo lại được sản phẩm là đúng thứ luật *"đo lại chính sản phẩm của anh sau khi viết"* cấm. **Đây
là việc còn nợ, và nó có tên.**

🔴 **MỘT PHÁT HIỆN LIỀN KỀ MÀ MỤC NÀY KHÔNG NÊU: MSI CÓ THỂ MANG DỮ LIỆU VẬN HÀNH VIÊN, VÀ HÔM NAY CÂY
HARVEST ĐANG CHỨA ĐÚNG BỐN FILE ẤY.** `publish-desktop/engine/products.json`, `recipes.json` và
`ecosystem/ecosystem-{products,recipes}.json` mang dấu thời gian **07:11 ngày 2026-08-20**, tức **SAU**
lần publish 07:09–07:10 — chúng là sản phẩm của việc ai đó **chạy** bản engine vừa publish, tức cơ chế
của **mục 30**. `build-installer.ps1` xoá `publish-desktop/` ở đường mặc định, nhưng cờ
**`-SkipDotnetPublish`** của chính nó **bỏ qua phép xoá ấy**, và harvest đọc cả thư mục. Nên
*"MSI không mang bốn file ấy"* (mục 30) **đúng cho đường mặc định và sai cho một đường mà script tự công
bố**. Ghi ở cả hai mục; không sửa ở đây, vì đó là bao bì của mục 30 chứ không phải artefact build của
mục 31.

🔴 **CÁI TRẦN CỦA PHÉP ĐO NÀY, nêu chính xác thay vì nêu quá nhỏ.** Mục viết rằng câu *"cái gì thực sự
được cài"* đòi *"một `publish-desktop/` sạch cùng một lần dựng MSI"*. Đo lại: **nửa sau không cần thiết**.
Vì harvest là **cả thư mục trừ hai tên `.exe`**, một liệt kê thư mục **là** một phép đo về nội dung MSI,
với **hai** chỗ nó không tới được, và cả hai được nêu tên: (i) nó không kiểm chứng rằng XSLT thật sự khớp
và loại đúng hai `.exe` ấy trên bản build ấy; (ii) cây trên đĩa là ảnh chụp của một commit **trước**
`e6faec60`, nên bảng ở trên là *"cái mà lần publish ngày 2026-08-20 sinh ra"*, không phải *"cái mà một
lần publish từ ngọn nhánh này sẽ sinh ra"*. **Cái vẫn KHÔNG đo được** là hành vi của Windows Installer
khi cài — quyền, thư mục, UAC — và đó là dụng cụ thứ ba thật sự.

**Không dụng cụ nào canh con số này, và câu ấy của mục vẫn ĐÚNG.** Nửa A của cổng đọc log build, nửa B
đọc khai báo trong cây nguồn; cả hai là dụng cụ về **cây nguồn**. AV-1 **không** thêm dụng cụ thứ ba —
một guard đọc `publish-desktop/` sẽ đỏ trên mọi máy chưa publish, tức một guard về **một máy trong một
ngày**, không về sản phẩm. Nên **12 vẫn là một con số không ai canh**, và nó sẽ lớn thêm mỗi lần một
project bật cờ tài liệu.

**Bằng chứng:** `.superpowers/sdd/items-33-30-31/task-1-report.md`. **Không file mã nào, không file bao
bì nào, không hằng số cổng nào thay đổi cho mục này** — phán quyết là *giao nguyên như đang giao*, và
thay đổi duy nhất là hồ sơ này.

---

## 26. Không gì trong repo này trả cho TÍNH ĐÚNG của một chú thích đã viết — mục 12 trả cho BAO PHỦ, và W-1 kiểm HÌNH THỨC

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Tổng hợp từ AG-1, AH-1 + phản biện, AL-1, AM-1, AN-1.

**Đo được cái gì — LIỆT KÊ TRƯỚC, và ĐỪNG CỘNG.** Năm phép đo về khẳng định sai trong chú thích của
chính dự án này, mỗi cái kèm **đơn vị của nó**:

| ai | đo được | mẫu số | khẳng định thuộc loại nào | có phải một phép kiểm đếm không |
|---|---|---|---|---|
| đợt 4 (AG-1) | **101** khẳng định `cref`/`paramref` đã sai (75 CS1574 + 23 CS1734 + 3 CS0419), 29 file | quần thể ĐẦY ĐỦ | **có sẵn**, đã đứng trong cây từ trước | **có** — và do TRÌNH BIÊN DỊCH tìm |
| đợt 5 (AH-1) + phản biện | **17** câu SAI | một **mẫu 48** rút từ **120** câu vừa viết | **vừa viết** | **không** — một mẫu |
| đợt 6 (AL-1) | **5** câu sửa, **2** sai hẳn | 🔴 **129 CẢNH BÁO**, không phải 129 câu | **vừa viết** | không — một bộ lọc |
| đợt 7 (AM-1) | **13** câu sửa (7 + 6, hai vòng) | **199 CÂU** | **vừa viết** | không — hai bộ lọc |
| đợt 8 (AN-1) | **12** câu sửa (6 do hai vòng + 6 bắt lúc viết) | **287 CÂU** | **vừa viết** | không — hai bộ lọc + tự kiểm |

🔴 **Năm con số ấy KHÔNG cộng được, và ba lý do phải nói riêng ra.** *(i)* Hai loại vật khác nhau:
101 là khẳng định **CÓ SẴN**, bốn cái sau là khẳng định **VỪA VIẾT** — cộng chúng là đo hai quần thể
như một. *(ii)* **Một mẫu không phải một phép kiểm đếm**: 17/48 là một tỉ lệ ~35 % trên một mẫu, và
báo cáo đợt 5 tự nói vì sao nó **không ngoại suy được** (12 trong 17 hỏng vì cùng một tiền đề sai về
seed). *(iii)* 🔴 **Mẫu số của đợt 6 KHÔNG cùng đơn vị với đợt 7 và 8**: 129 là số **cảnh báo** đợt
6 trả, và đợt 6 **không bao giờ đếm số câu của nó** — chính đợt 8 ghi lại chuỗi ấy là
`120 → ? → 199 → 287`, với dấu `?` đúng ở chỗ đợt 6. Ở **đợt 5** thì hai đơn vị **trùng nhau**, và
chỉ ở đó: cả 120 cảnh báo đều là một `<summary>` trên một property, một cảnh báo một câu.

**Cái repo này CÓ dụng cụ, và cái nó KHÔNG có.** Có: trình biên dịch bắt **con trỏ hỏng**
(CS1574/CS1734/CS0419) và **chỗ trống** (CS1591/CS1573). Có: **W-1**, tức
`tests/St4i.EdgeCore.Tests/DocCommentProseTests.cs`, **bảy** `[Fact]` — bộ quét có tới được corpus
của nó không, mọi khối `///` của ta có parse được như XML không, khối trong file SDK vendored có
parse được không, mọi tên phần tử có nằm trong `RegisteredElementNames` không, không đâu dùng chú
thích `/** */`, cộng hai bài tự kiểm chính bộ kiểm. **Không có: một dụng cụ nào trả lời "câu này
đúng hay sai".** W-1 kiểm một khối **có hình thức hợp lệ**; nó không thể và không tự nhận kiểm được
một câu là **thật**.

**Ở đâu trong mã — trỏ bằng TÊN.** `tests/St4i.EdgeCore.Tests/DocCommentProseTests.cs` (bảy `[Fact]`,
`RegisteredElementNames`); `scripts/verify-suites.sh` (`EXPECT_WARNINGS`, `EXPECT_WARNING_LEDGER` —
hai hằng số duy nhất canh chú thích, và cả hai đếm **sự vắng mặt**, không đếm **tính đúng**);
`Directory.Build.props` (khối N-1/N-2 đặt ra phép thử *"can this sentence be recovered"*, tức tiêu
chí đã có nhưng **không có bộ cưỡng chế**).

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* **một chú thích sai còn tệ hơn không có chú thích**, vì nó làm người đọc **thôi
kiểm**. Bốn phép đo trên đều bắt được câu sai, và loại tệ nhất trong đó không chứa một sự kiện sai
nào — nó khẳng định một **mục đích** hoặc một **cơ chế** (một caller, một timer, một người dùng) mà
không có gì để kiểm: đợt 6 tìm ra một `<summary>` nói phương thức tồn tại *"để người gọi cho vận
hành viên biết vì sao cửa sổ ấy chấm điểm như thế"* cho một phương thức **không có caller sản xuất
nào**; đợt 7 khẳng định một **heartbeat nền mà repo này không có**, lấy từ một doc comment hàng xóm
đã hedge đúng. Với `GenerateDocumentationFile` đã bật, những câu ấy **đi vào `St4i.EdgeCore.xml`**
và ra tới bản cài (xem mục 31).
*Chiều ngược, và nó không nhẹ:* **không ai biết dụng cụ ấy trông như thế nào.** Đợt 7 và đợt 8 đều
đo được rằng **một bộ lọc cơ học đơn lẻ báo thiếu**: đợt 7 vòng 1 bắt 7, vòng 2 bắt **6 cái vòng 1
mù hoàn toàn**; đợt 8 vòng 1 bắt 1, vòng 2 bắt 5. Đợt 8 tự nói rằng **recall của bộ lọc vòng 2 của
nó là chưa biết**. Nên một "cổng soát tài liệu" sẽ là một dụng cụ **không có định nghĩa xanh** và
**không biết độ nhạy của chính nó** — đúng loại dụng cụ mà file này lập ra để chấm dứt. Và một nửa
nữa phải nói: **quá trình viết chú thích ĐANG LÀ dụng cụ** — cả mười khuyết tật mã ở các mục 15–24
đều được tìm ra **trong lúc viết chú thích**, không phải bằng một cổng.

**Nếu KHÔNG quyết định.** Mục 12 hoàn tất (hoặc rời Phần II bằng mục 25) và để lại một cây có
**bao phủ** chú thích cao và **không dụng cụ nào** về tính đúng, tức đúng trạng thái mà tỉ lệ ~35 %
của đợt 5 được đo trên. Con số đáng sợ không phải một trong năm con số trên; nó là cái **không ai
đo**: **các khẳng định đã có sẵn trong cây và chưa từng bị đọc lại** — đợt 4 đã cho thấy **101** cái
trong số đó sai đủ nặng để trình biên dịch bắt được, và **không ai từng đo số cái sai theo cách
trình biên dịch KHÔNG bắt được.**

### ✅ ĐÃ THI HÀNH 2026-08-22 (AW-1, base `e99019c0`) — thói quen thành **thứ chạy được**, và phép đo toàn cây trả về một **cái trần**, không phải một món nợ

🔨 **QUYẾT: DỰNG BỘ LỌC PHỦ ĐỊNH PHỔ QUÁT THÀNH MỘT DỤNG CỤ CHẠY ĐƯỢC** (2026-08-22, **điều phối viên
quyết theo uỷ quyền**, cùng khuôn mục 8, 15, 17 và 21 — mục này không đổi payload MQTT, không đổi hình
dạng dây, không đổi con số OEE nào; nó không chạm một dòng mã sản phẩm nào). **Mọi dòng thân mục gốc ở
trên giữ NGUYÊN VĂN.**

#### 1. Hình dạng dụng cụ **suy từ cách hỏng đã đo**, không phát minh — §8.1(a)

Mục này đã liệt kê sẵn cái repo **có** (trình biên dịch bắt con trỏ hỏng và chỗ trống; W-1 bắt hình
thức) và cái nó **không có**. Nó cũng đã ghi thứ **đã chứng minh là bắt được**: **bộ lọc phủ định phổ
quát cộng chạy lại sau từng câu** — đợt 6, 7, 8 đều dùng, đều bắt. Nên dụng cụ **không được thiết kế**;
nó là **bản chép lại của thứ đã hoạt động**: `scripts/scan-doc-negations.sh`, đúng năm từ —
*nothing · never · every · only · no code* — trên corpus `///` của cây này.

**Hai chế độ, và cái thứ hai là cái cưỡng chế:**
* `--census` — quét toàn cây, **LIỆT KÊ từng câu rồi mới in con số**.
* `--since <ref> [--expect N]` — **chính là thói quen**: mọi câu chú thích có mặt **bây giờ** và vắng ở
  `<ref>` mà mang một khẳng định tuyệt đối được **liệt kê**, rồi **đếm**, và con số phải khớp cái đã
  ghi. Một câu vừa viết mang *"never"*, *"every"* hay *"nothing"* **không vào được commit mà không có
  người nhìn nó**. Đây là chỗ dụng cụ **đỏ được**.

#### 2. Năm con số của mục — **kiểm lại từng cái, cả năm ĐỨNG VỮNG**

Đối chiếu với bảng ở thân mục trên: đợt 4 **101** (75 CS1574 + 23 CS1734 + 3 CS0419, 29 file, quần thể
đầy đủ) · đợt 5 **17 trên mẫu 48** rút từ 120 · đợt 6 **5 câu sửa / 2 sai hẳn**, mẫu số là **129 CẢNH
BÁO chứ không phải 129 câu** · đợt 7 **13 / 199 CÂU** · đợt 8 **12 / 287 CÂU**. **Không con số nào
dịch**, và ba lý do không cộng được vẫn nguyên: hai quần thể khác nhau (có sẵn / vừa viết), một mẫu
không phải một phép kiểm đếm, và mẫu số đợt 6 khác đơn vị với đợt 7–8.

#### 🔴 3. Phép đo MỚI — **LIỆT KÊ trước, con số SAU**, và con số là một **CÁI TRẦN**

`--census` in ra **từng câu bị gắn cờ** kèm file và dòng, rồi mới in tổng. Đo ở base `e99019c0`:

* corpus: **545** file `.cs` dưới `tools/machine-simulator` (bin/obj/TestResults/node_modules đã cắt);
* câu chú thích đọc được: **15 965**;
* 🔴 **GẮN CỜ: 5 780 câu, ở 481 trong 545 file — HƠN MỘT PHẦN BA mọi câu chú thích trong cây.**

🔴 **Con số ấy là một cái trần phải nêu, KHÔNG phải một món nợ nhiệm vụ này bỏ dở.** Nó cũng **không**
có nghĩa là 5 780 câu sai: bộ lọc **chọn câu để người đọc**, và phần lớn câu bị gắn cờ **đúng**. Và nó
là lý do **cố ý không có cổng toàn cây**: một cổng ghim con số đó sẽ đỏ với **mọi** lần sửa tài liệu,
tức đúng thứ chính mục này đã cảnh báo — *"một dụng cụ không có định nghĩa xanh"*. Cái trần được **nêu
tên**, không bị thu hẹp cho dễ nhìn.

##### 📐 Đính chính 2026-08-22 (AZ-1, mục 12 đợt 10) — **cặp số `5 780 / 15 965` ở trên được RÚT; không một dòng nào bị xoá, và KHÔNG có literal mới thay vào**

**Ba dòng gạch đầu dòng ngay trên giữ NGUYÊN VĂN**, cùng con số `481 trong 545 file`, cùng câu
*"HƠN MỘT PHẦN BA"*, và cùng cặp `5 781 / 15 966` ở §4 dưới. Chúng đúng với lần chạy ở base
`e99019c0` ngày 2026-08-22 và **là ghi chép của lần chạy ấy**. Cái bị rút là tư cách của chúng như
**một cái trần đang có hiệu lực**.

* 🔴 **Không tái lập.** Đợt 9 (AY-1) chạy lại `--census` và đo **5 794 / 16 041 ở BASE của nó
  (`fb7635cf`), TRƯỚC khi nó viết một chữ**, rồi **5 796 / 16 131** sau khi viết. Tức phần lớn độ
  lệch **đã có sẵn**: một nhiệm vụ trước đó thêm câu chú thích và không chạy lại dụng cụ này. Đó
  đúng là cách hỏng mà **chính mục này** gọi tên là tệ hơn không nêu trần — *một cái trần nêu quá
  nhỏ* — xảy ra bên trong chính mục nêu nó.
* **Đợt 9 đã sửa hai trong ba bản sao** (`scripts/scan-doc-negations.sh` biên (c) và
  `scripts/verify-suites.sh`) và **không sửa được bản thứ ba — bản này** — vì brief của đợt ấy cấm
  mở lại một mục ở Phần III. Nó **ghi lại chỗ mâu thuẫn thay vì giấu**. Lệnh cấm ấy được **gỡ cho
  đúng con số này** ngày 2026-08-22, với lý do ghi tại chỗ: **sửa một con số đã ĐO ra sai trong một
  mục Phần III là một phép RÚT, không phải mở lại một phán quyết** — phán quyết của mục 26 (dựng bộ
  lọc, cố ý không cổng toàn cây) **không đổi một chữ**.
* 🔴 **Và một bản sao THỨ TƯ, đợt 9 không thấy:** biên **(d)** của `scan-doc-negations.sh` — *"5780
  sentences is not a backlog"* — vẫn mang literal cũ **trong chính file mà đợt 9 đang sửa biên (c)**.
  Đo được ở đây, và rút ở đó cùng ngày.
* 🔴 **Cách bảo trì ĐÚNG cho con số này KHÔNG phải một literal mới.** Bất kỳ literal nào viết vào đây
  cũng sẽ cũ trong vài ngày — đó là điều vừa đo được hai lần. **Muốn biết cái trần hôm nay: CHẠY**

  ```
  bash scripts/scan-doc-negations.sh --census
  ```

  **rồi trích dẫn lần chạy ấy kèm commit.** Dụng cụ **liệt kê từng câu trước rồi mới in tổng**, nên
  con số nó in ra là một con số **đã có phép liệt kê đứng sau**, khác hẳn một con số chép lại. Ví dụ
  của chính lần rút này, nêu **như một lần chạy chứ không như một hằng số**: ở
  `3f564039` con số đọc **5 796 / 16 131**; sau công việc của đợt 10 nó đọc **5 831 / 16 246**. Cả
  hai đều là **mẫu của ngày lấy chúng**.
* **Cái KHÔNG đổi, nói cho đủ hai chiều:** *"HƠN MỘT PHẦN BA"* vẫn đúng ở mọi lần đo trên (5 831 /
  16 246 ≈ 35,9 %), và lý do **cố ý không dựng cổng toàn cây** vẫn nguyên vẹn — thực ra nó **mạnh
  lên**: bốn lần đo ở trên là **bốn giá trị khác nhau trên bốn commit**, nên một hằng số ghim vào cái
  trần này sẽ đỏ ở mỗi commit sau lần ghim.

#### 4. Cặp đối chứng — chạy trọn, rồi **hoàn nguyên**

Trồng một khối `///` **mới** ở đầu `src/St4i.EdgeCore/Fleet/FleetCore.cs`, mang một câu phủ định phổ
quát **sai**: *"no code in this repository ever writes to disk"*. 🔴 **Nhân chứng cho việc nó sai nằm
trong chính cổng đang chạy nó, nên nó không cần một con số:** `scripts/verify-suites.sh` đóng khung
**thư mục credential thật của sản phẩm** trước và sau mỗi lần chạy — cái khung ấy tồn tại vì
`CredentialStore` **ghi xuống đĩa**. *(Bản nháp của khối này viết *"một cây có **bốn** store ghi
đĩa"*. **Con số ấy không được đo và đã bị gỡ**: một phép quét `*Store` dưới `src/` trả về **năm** lớp,
còn `verify-suites.sh` nói **MƯỜI BA**. Một con số bịa trong đúng mục nói về khẳng định không kiểm
được — bắt bằng cách đọc lại phần mình vừa viết, và ghi ra chứ không lặng lẽ sửa.)*
`--since HEAD`: **đỏ**, exit 1, và nó **nêu tên file cùng nguyên văn câu ấy**. Gỡ câu ra: **xanh**,
exit 0, `git status` sạch. Con số census trong lần chạy đỏ đọc **5 781 / 15 966**, tức nó thấy đúng một
câu thêm — không nhiều hơn, không ít hơn.

#### 🔴 5. Cái dụng cụ này **KHÔNG** cưỡng chế — nêu đủ rộng, vì một cái trần nêu quá nhỏ còn tệ hơn không nêu

* **(a) Nó KHÔNG phải một cái máy phân biệt đúng-sai.** Nó không đọc được ý nghĩa; nó chọn câu.
* **(b) Độ nhạy của nó CHƯA BIẾT, và điều này đã nằm trên hồ sơ từ trước:** đợt 7 vòng 1 bắt 7, vòng 2
  bắt thêm **6 cái vòng 1 mù hoàn toàn**; đợt 8 vòng 1 bắt 1, vòng 2 bắt 5; và đợt 8 **tự viết** rằng
  recall của bộ lọc vòng 2 của nó là chưa biết. **Điều đó không đổi.** Loại tệ nhất — một câu **không
  chứa một từ tuyệt đối nào** mà khẳng định một **mục đích** hoặc một **cơ chế** (một caller, một
  timer, một người dùng) — nằm **hoàn toàn ngoài** dụng cụ này. Đúng loại mà đợt 6 và đợt 7 tìm ra.
* **(c) Nó chỉ đọc `.cs` của ta.** `web/` (`.ts`/`.tsx`), `server/`, `client/`, và **file SDK vendored**
  `examples/device-client/csharp/St4iDeviceClient.cs` mà `St4i.EdgeCore` `Compile`-link từ ngoài cone
  của nó — **tất cả ở ngoài**. Một lần chạy xanh **không nói gì** về chúng.
* **(d) Một file đổi tên đọc thành toàn-mới** dưới `--since`, vì danh tính ở đây là cặp (đường dẫn, câu).
* **(e) Bộ tách câu là TEXTUAL**, không phải một lexer: `e.g. Foo` bị tách, một dấu đầu dòng `1.` bị
  tách. Nó dịch **văn bản được hiển thị** và có thể dịch **con số**; nó không giấu được một từ tuyệt đối.
* **(f) Và nửa còn lại của mục vẫn đúng nguyên văn:** *"quá trình viết chú thích ĐANG LÀ dụng cụ"* —
  cả mười khuyết tật mã ở mục 15–24 được tìm ra **trong lúc viết**, không bằng một cổng. Dụng cụ này
  **không thay** việc ấy; nó chỉ làm cho một phần của nó **không quên được**.

#### 6. Hằng số

**Không hằng số nào của cổng dịch vì mục này.** Dụng cụ là một script; nó không thêm bài test, không
sửa mã sản phẩm, không đụng `EXPECT_WARNINGS`, không đụng năm tổng bộ.

---

## 32. Một lời khai miền dụng cụ chỉ KIỂM ĐƯỢC nếu nó ghi lại NƠI lệnh được chạy — và cái giá đã trả là một phán quyết của chủ sở hữu mang một cái trần SAI

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1), sau một phép đo của điều phối viên bác đúng chỗ AO-1 nói
*"không giải được từ chỗ tôi đứng"*. **Mục này KHÔNG về một lần grep hỏng. Nó về một LỚP.**

**Đo được cái gì — phép kiểm quyết định, cùng mẫu, cùng SHA, chỉ khác chỗ đứng.** Pathspec của git
**tương đối với thư mục hiện hành**, và một pathspec bị thu hẹp **không báo lỗi — nó trả 0**:

| lệnh (chạy từ `tools/machine-simulator`, SHA `a70ed5d6`) | kết quả |
|---|---:|
| `git grep -l 'ingest' <SHA> -- 'server/*.ts'` | **0** |
| `git grep -l 'ingest' <SHA> -- ':(top)server/*.ts'` | **197** |
| `git grep -l 'ingest' <SHA> -- '*.ts'` | **1** |
| `git grep -l 'ingest' <SHA> -- ':(top)*.ts'` | **214** |

🔴 **Và ranh giới KHÔNG hẹp như lần sửa đầu tiên tưởng — đây là một phép đo, không phải một lời
nhượng bộ.** Một bản sửa trung gian ghi rằng chỉ pathspec **nêu tên thư mục gốc** mới hỏng còn
**glob đuôi trần** thì không. **Hai hàng cuối bảng trên bác điều đó:** `'*.ts'` trần cũng bị thêm
tiền tố cwd, `1` đối lại `214`. Hình dạng đúng, viết đủ rộng chứ không hẹp hơn phép đo: **mọi
pathspec tương đối đều bị thu hẹp theo cwd.** `server/` có **1589** file trong commit và `client/`
có **711**; cả hai **không nằm trên đĩa** (sparse checkout) nhưng **đều nằm trong commit object**,
nên chúng luôn với tới được — bằng đúng một tiền tố.

🔴 **Hệ quả trung tâm, và nó là lý do mục này tồn tại: `0` từ một phép quét ĐÚNG và `0` từ một
pathspec loại trừ cả cây là KHÔNG PHÂN BIỆT ĐƯỢC trong một báo cáo.** Không báo cáo nào trong chuỗi
này — kể cả bản đầu của AO-1 — ghi lại **thư mục nó đứng khi gõ lệnh**. Nên mọi lời khai miền dụng
cụ trong chuỗi này là **không kiểm được**, kể cả những lời khai đúng.

**Cái giá đã trả, ĐO chứ không suy đoán.** Bảy khẳng định dựa trên phép quét ấy, chạy lại cả hai
cách trên `server/` + `client/`:

* ✅ **NĂM SỐNG SÓT — `0` ở CẢ HAI cách:** `TransportMode`, `machine-simulator`, `St4i\.`,
  `EngineApi`, `Waveforms`. 🔴 **Điều này phải được viết ra, vì một mối nghi không giải để lại một
  vết bẩn ở chỗ nó không thuộc về:** kết luận của **AM-1** rằng `TransportMode` được xuất bản ở
  **ba** chỗ và **ba là toàn bộ tập** — **ĐỨNG VỮNG**. Máy chủ hệ sinh thái và client trình duyệt
  thật sự không tiêu thụ hợp đồng mode của sản phẩm này.
* 🔴 **HAI KHÔNG:** `rateHz` **0 → 6** file, `waveform` **0 → 8** file.

**Ở đâu — trỏ bằng TÊN.** Ngữ nghĩa pathspec của `git grep` (dụng cụ, không phải mã của ta);
`server/contracts/machineDataContract.ts`, `server/services/processResultService.ts`,
`server/api/v1/openapi.ts`, `server/routers/machineApiRouters.ts`,
`server/contracts/machineDataContract.test.ts`,
`client/src/components/apiDocs/AutomationProcessFeedSection.tsx` (**bên tiêu thụ, trong commit này**);
khối lời-khai-miền của **AM-1 §11(f)** và **AN-1 §6.3**; **mục 14** ở Phần III (khối rút kèm ngày);
**mục 29** (ca §8.1(f) mà chính AO-1 tự sinh ra); `scripts/verify-suites.sh` — **nêu tên vì nó KHÔNG
chứa phép kiểm nào cho chuyện này.**

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* một **phán quyết của chủ sở hữu đã ra kèm một cái trần sai**. Mục 14 ghi rằng bên
tiêu thụ *"không đo được từ repo này"*; với hợp đồng ingest HTTP điều đó **luôn luôn sai**, và cái
làm nó trông đúng là một pathspec. Một phán quyết ra dưới một cái trần sai là **chính xác** thứ file
này tồn tại để ghi lại. Rộng hơn: **mọi câu phủ định tồn tại** trong chuỗi này đứng trên một lời
khai không ai kiểm được.
*Chiều ngược, và nó đủ mạnh để "không làm gì" là một lựa chọn có lý:* **phần lớn phép quét của chuỗi
này nhắm vào `src/` và `tests/`, tức NẰM TRONG cwd, nên chúng không bị ảnh hưởng** — và phép đo vừa
rồi cho thấy **năm trên bảy** khẳng định bị nghi ngờ vẫn đứng. Thiệt hại đã đo là **hai** chuỗi, cả
hai trên **một** mục, và cả hai đọc theo chiều **thuận** cho phán quyết ấy. Bản vá là **một dòng**
(`:(top)` hoặc `:/` trên mọi pathspec, hoặc **ghi cwd cạnh SHA** trong mỗi lời khai miền) — nhưng
**chưa dụng cụ nào cưỡng chế nó**, và dựng một dụng cụ để canh cách người ta gõ một lệnh tra cứu là
một bộ kiểm mới trên thứ **không phải mã sản phẩm**. Một quy ước viết tay rẻ hơn nhiều và **không có
gì đỏ lên khi ai đó quên**.

**Nếu KHÔNG quyết định.** Lời khai miền tiếp tục được viết ở mỗi báo cáo, tiếp tục **không kiểm
được**, và lần sau `0` sẽ lại được đọc là *"không có"* thay vì *"tôi đã không nhìn"*. 🔴 **Và một
chỗ CHƯA ĐO được nêu tên chứ không lấp, vì lấp nó ở đây sẽ lặp lại đúng khuyết tật này:** **người
đăng ký gương MQTT retained `syn/…`** — bề mặt đã xuất bản thứ hai mà mục 14 đổi — **vẫn chưa ai
đo**. **37** file dưới `server/` + `client/` nhắc chuỗi `syn/`; **chưa file nào được chứng minh là
một người ĐĂNG KÝ**; các lần xuất hiện của `retained` đã mở ra đều là chuyện khác (leo thang cảnh
báo, chú thích UI). Nhiệm vụ này **cố ý dừng ở đó** — đó là một mục cần mở, không phải một chướng
ngại phải dọn dở dang trên đường.

### ✅ ĐÃ THI HÀNH 2026-08-22 (AW-1, base `e99019c0`) — một BỌC CƯỠNG CHẾ, không một dòng hướng dẫn; và nó bắt được một lỗi của chính nó ở lần chạy thử đầu tiên

🔨 **QUYẾT: DỰNG MỘT BỌC CƯỠNG CHẾ CHO MIỀN PHÉP QUÉT** (2026-08-22, **điều phối viên quyết theo uỷ
quyền**, cùng khuôn mục 8, 15, 17 và 21). **Mọi dòng thân mục gốc ở trên giữ NGUYÊN VĂN.**

#### 1. Vì sao là một BỌC, và vì sao KHÔNG phải một quy ước viết tay

Thân mục trên đã cân đúng bài toán và kết luận rằng bản vá là *"một dòng"* nhưng **chưa dụng cụ nào
cưỡng chế nó**, và rằng *"một quy ước viết tay rẻ hơn nhiều và **không có gì đỏ lên khi ai đó quên**."*
**Vế thứ hai của chính câu ấy là lý do lựa chọn quy ước bị loại.** Ba hình dạng được cân, và cái được
chọn là cái duy nhất **đổi mặc định** thay vì **thêm một lời nhắc**:

* *một script bọc* — **CHỌN**: cwd thôi không còn là đầu vào của pathspec;
* *một hàm dùng chung mọi phép quét phải đi qua* — **cùng vật** ở dạng khác, không thêm gì;
* *một phép kiểm đọc transcript* — **LOẠI**, và lý do là một phép đo chứ không phải sở thích:
  transcript nằm dưới `.superpowers/`, **bị gitignore**, tức đúng cái kênh mà mục 37 vừa đo được là
  không tới tay chủ sở hữu. Một bộ cưỡng chế đọc một artefact không được commit thì **không cưỡng chế
  được gì** ở chỗ nó cần cưỡng chế.

#### 2. `scripts/repo-scan.sh` — cái nó CƯỠNG CHẾ, cho mọi phép quét đi qua nó

1. **Tự `cd` về gốc repo.** Thư mục người gõ đứng thành **dữ liệu trong phần đầu**, không còn là đầu
   vào của pathspec.
2. **Tự viết lại mọi pathspec trần thành `:(top)…`.** Pathspec đã mang tiền tố magic (`:(top)`, `:/`,
   `:(exclude)`) được để nguyên — đó là chủ ý của người gõ. Đường dẫn **tuyệt đối** bị **từ chối**, vì
   nới nó thành `:(top)` sẽ đổi nghĩa của nó.
3. **Luôn truyền `--full-name`** — nửa thứ hai của mục này, do mục 15 tìm ra. Đường dẫn in ra là
   tương-đối-gốc-repo và **phân giải được**, kể cả với những đường dẫn tồn tại ở cả hai nơi.
4. **Phân giải tree-ish thành SHA đầy đủ** và **in ra cây sạch hay bẩn**, nên một phép quét `HEAD`
   không bao giờ bị báo cáo như một phép quét cái đang nằm trên đĩa.
5. **Phát lời khai miền CÙNG kết quả**: nơi gõ, nơi chạy, SHA, trạng thái cây, pathspec **trước và
   sau** khi viết lại, argv chính xác, số dòng. 🔴 **Một `0` từ dụng cụ này đọc được là *"không có"*
   thay vì *"tôi đã không nhìn"* — đó là toàn bộ lý do mục này tồn tại.**

#### 3. Nhân chứng `--self-test`, và **nó từ chối chính cái xanh đầu tiên của mình**

Ba khẳng định, và cái thứ ba là cái giữ nó khỏi thành một guard xanh vì không thấy gì: **(a)** bất
biến theo cwd; **(b)** phép dò phải **khác 0** — hai số 0 bằng nhau chứng minh **không gì**; **(c)**
dạng **ngây thơ** phải trả **ÍT HƠN** — nếu chỗ hỏng không còn tái lập được bằng phép dò này thì một
màu xanh ở đây **chứng nhận rỗng**, nên nó được báo là **thất bại**, không phải bỏ qua.

🔴 **Bản nháp đầu của `--self-test` quét CÂY LÀM VIỆC, và nó tự đỏ với ba số 0.** Lý do đúng là ranh
giới **(b)** ghi ở đầu chính dụng cụ ấy: checkout này là **sparse**, `server/` **không nằm trên đĩa**,
nên một phép quét cây làm việc **không thể** thấy đúng những file phép dò nói về. **Dụng cụ bắt được
dụng cụ**, và bản sửa là quét **một commit**. Đo lại ở `e99019c0`:

| phép dò `ingest` trên `server/*.ts`, tại `e99019c0` | kết quả |
|---|---:|
| qua bọc, gõ ở **gốc repo** | **197** |
| qua bọc, gõ ở **`tools/machine-simulator`** | **197** |
| **ngây thơ**, tương đối, gõ ở `tools/machine-simulator` | **0** |

**197 khớp con số mục này đo ở `a70ed5d6`** — cùng phép đo, base khác, không dịch.

#### 4. Cặp đối chứng — chạy trọn, rồi **hoàn nguyên**

Gỡ luật viết-lại (`:(top)` → không làm gì) trong `rewrite_pathspec`: `--self-test` **ĐỎ**, exit 1,
`197 vs 0`, và thông điệp nêu đúng nguyên nhân. Trả luật về: **XANH**, exit 0. 🔴 **Và hai vế bất biến
đi QUA `rewrite_pathspec` chứ không qua một chuỗi `":(top)"` gõ tay** — nếu chúng gõ tay, xoá luật ấy
sẽ để self-test xanh trong khi mọi phép quét thật âm thầm bị thu hẹp, tức bài kiểm sẽ khẳng định một
chuỗi do chính nó viết ra.

#### 🔴 5. Một lỗi CỦA CHÍNH BỌC NÀY, bắt được lúc chạy thử, và nó là mục 32 trong bộ đồ thứ hai

`scripts/repo-scan.sh --sha HEAD -l -- 'server/*.ts'` — **thiếu mẫu tìm** — in ra
`result lines : 0` và trông **y hệt một phủ định sạch**. Cơ chế: `git grep` lấy từ **không phải tuỳ
chọn** đầu tiên làm **PATTERN**, nên khi không có mẫu nó đã nuốt **chính cái SHA** làm mẫu. **Đó là
một `0` nghĩa là *"anh chưa hỏi gì cả"*.** Nay bị **từ chối** (exit 2) thay vì in ra. Ghi vào mục vì
nó chứng minh lớp mà mục này mô tả rộng hơn pathspec: **mọi con đường tạo ra một `0` không có câu hỏi
đằng sau** đều thuộc lớp ấy.

#### 🔴 6. Cái bọc này **KHÔNG** cưỡng chế — nêu đủ rộng

* **(a) Nó KHÔNG buộc được ai dùng nó.** Không có gì trong git, trong repo này hay trong shell này
  chặn người sau gõ `git grep foo -- 'server/*.ts'` bằng tay. Nó là một **mặc định** và một **nhân
  chứng**, **không** phải một cổng trên cách con người gõ phím. Thứ **được** cổng cưỡng chế là tính
  bất biến theo cwd của chính bọc này (`--self-test` chạy trong `scripts/verify-suites.sh`).
* **(b) Nó không thấy được phép quét KHÔNG-git.** `grep -r`, ripgrep, tìm-trong-editor đọc **cây làm
  việc**; checkout này sparse — `server/` **1589** file và `client/` **711** file **có trong commit,
  không trên đĩa**. Những dụng cụ ấy sẽ trả 0 cho chúng và bọc này **không biết chúng đã chạy**.
* **(c) Nó không kiểm được rằng một báo cáo đã chép lại phần đầu.** Nó in lời khai miền; nó không
  bắt được một con người không dán nó.
* **(d) Nó không nói gì về việc MẪU TÌM có đúng không.** Một phép quét sai chuỗi vẫn là một phép quét
  sai chuỗi, chỉ là đã đúng phạm vi.
* **(e) Nó KHÔNG với ra ngoài repo.** 🔴 **Người đăng ký gương MQTT retained `syn/…` VẪN CHƯA ĐO** —
  **37** file dưới `server/` + `client/` nhắc chuỗi ấy, **chưa file nào được chứng minh là một người
  ĐĂNG KÝ** — và nó nằm ngoài mọi phép quét dụng cụ này chạy được. Nêu tên, không lấp.

#### 7. Cái giá đã trả, ghi lại chứ không tóm tắt

**Mục 14 được CHỦ SỞ HỮU phán kèm một cái trần SAI** — *"người tiêu thụ không đo được từ repo này"* —
trong khi mã của bên tiêu thụ nằm trong **đúng commit ấy**. Câu ấy nay đứng ở **đầu
`scripts/repo-scan.sh`**, cùng bảng bốn dòng của mục này, để người mở dụng cụ ra đọc được **vì sao nó
tồn tại** mà không phải tìm sang file này. **Năm khẳng định khác đo lại vẫn ĐỨNG VỮNG**, gồm kết luận
*"ba chỗ xuất bản `TransportMode`"* của AM-1.

#### 8. Hằng số

**Không hằng số nào của cổng dịch vì mục này.**

---

## 37. 🔴 HỒ SƠ — LỖI CỦA ĐIỀU PHỐI VIÊN: một phán quyết của chủ sở hữu đã sống trọn một vòng nhiệm vụ mà KHÔNG có bản ghi tại chỗ, và không dụng cụ nào bắt được

🔴 **CHỜ ANH.** Mở 2026-08-22 (AU-1). 🔴 **Mục này KHÔNG nói về mã. Nó nói về quy trình đã tạo ra file này, và
nó được điều phối viên yêu cầu viết THẲNG. Viết thẳng.**

**Đo được cái gì.** Phán quyết mục 16 của chủ sở hữu ngày **2026-08-22** — *một transaction bọc bốn câu lệnh
của `AggregateForOeeAsync`*, tức **lựa chọn thứ tư** mà mục không có — tới tay người thi hành **chỉ qua một
task brief**. Ở base `ce1ce2be`, `grep "2026-08-22"` trên `docs/owner-decisions.md` trả **đúng hai dòng, và cả
hai thuộc mục 27**. Điều phối viên bảo nhiệm vụ trước ghi phán quyết mục 27 và nói mục 16 *"không phải việc
của anh"* — tức đã coi **"đừng thi hành"** là **"đừng ghi"**. 🔴 **Một phán quyết và một lần thi hành là HAI
HIỆN VẬT KHÁC NHAU.** Một phán quyết là dữ kiện ngay khi được phát ra; nó không chờ ai thi hành để trở thành
thật, và **đúng loại hiện vật mà file này tồn tại để giữ**. Trong một vòng nhiệm vụ, kênh duy nhất mang nó là
một task brief — **và task brief nằm dưới `.superpowers/`, bị gitignore**, tức đúng cái kênh mà đoạn mở đầu
của file này gọi tên là thiếu sót nó lập ra để chấm dứt.

**Bằng chứng thứ hai, cùng lớp, đo trong chính nhiệm vụ này.** Câu tóm tắt Phần I —
*"Các mục ở đây, LIỆT KÊ chứ không đếm: mục 16, 17, 18, … 32"* — **đã sai từ trước khi AU-1 chạm vào nó**:
mười một mục (16, 18, 19, 20, 21, 22, 23, 24, 27, 28, 29) đã rời sang Phần III ở các nhiệm vụ trước và câu ấy
vẫn liệt kê cả mười một. Nó **lỗi thời qua ba nhiệm vụ liên tiếp** và **không nhiệm vụ nào phát hiện ra**, vì
**không cổng nào đọc file này**.

🔴 **Và con số ấy phải được ĐO chứ không nhận, vì lời khai mở mục này cũng đếm sai.** Brief giao mục này viết
*"danh sách Phần I đã lỗi thời **chín** mục"*. Đo trên `659bcfb2`: Phần I **thật sự** chứa **17, 25, 26, 30,
31, 32**, còn câu tóm tắt liệt kê **mười bảy** số hiệu — nên phần thừa là **MƯỜI MỘT**, không phải chín.
**Lời khai về một khuyết tật kiểm đếm tự nó đếm sai, theo đúng cơ chế nó đang mô tả** — một con số vô hướng
tóm tắt một tập thay đổi ở chỗ khác. Đây là **lần thứ tư trong bốn nhiệm vụ liên tiếp** một con số như thế bị
phép liệt kê ngay cạnh nó bác bỏ, và lần này nó xảy ra **trong chính câu chẩn đoán**. Mọi phép rút trước đó đều viết được câu *"không phải nó từng sai — nó mô tả
đúng trạng thái cho tới lúc ấy"*; **lần này câu đó viết không được.**

🔴 **Và một lời tự khen của chính file này không sống sót qua phép đo.** Bốn khối bảo tồn lập luận rằng cách
viết *liệt kê, không đếm* làm một phép liệt kê sai **"sai NHÌN THẤY ĐƯỢC"**. Nó chỉ nhìn thấy được **nếu có
ai đó nhìn**. **Không ai nhìn trong ba nhiệm vụ.** Phép liệt kê làm cho việc **SỬA** rẻ; nó không làm cho việc
**PHÁT HIỆN** tự động — và cái thiếu là phát hiện.

**Ở đâu — trỏ bằng TÊN.** `tools/machine-simulator/docs/owner-decisions.md` (bảng phán quyết đầu file; banner
Phần I; mục 16, mục 27); `.superpowers/sdd/**/task-*-brief.md` và `task-*-report.md` (**bị gitignore**, xem
`.gitignore`); `tools/machine-simulator/scripts/verify-suites.sh` (**cổng — và nó KHÔNG đọc
`owner-decisions.md`**, đó là cả vấn đề).

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* file này tự nhận là **nguồn sự thật** cho các quyết định của chủ sở hữu, và trong một vòng nó
**không phải**. Một chủ sở hữu mở file để hỏi *"tôi đã phán gì?"* sẽ nhận câu trả lời **thiếu**, mà không có
dấu hiệu nào rằng nó thiếu — đúng cách hỏng mà đoạn mở đầu nói nó chấm dứt. Nếu phiên làm việc đứt đúng giữa
hai nhiệm vụ ấy, phán quyết mục 16 **biến mất khỏi hồ sơ hoàn toàn**, vì kênh duy nhất mang nó không được
commit. Và vì **không cổng nào đọc file này**, một mục có thể sai ở **bất kỳ** trường nào — trạng thái, số
hiệu, phép liệt kê — trong **bất kỳ** số nhiệm vụ nào, và cổng vẫn **xanh**.
*Chiều ngược, và nó là lý do mục này CHỜ ANH thay vì được ai đó tự sửa:* mọi phép **cưỡng chế** đều tốn thật.
(i) **Bắt cổng đọc file này** biến một tài liệu văn xuôi tiếng Việt thành **đầu vào có lược đồ** — bảng phán
quyết thành dữ liệu phải phân tích, và **mọi** phép viết lại văn xuôi thành một thay đổi có thể làm đỏ cổng;
đó là **chính xác** cái ma sát mục 36 đo được ở README, nay áp lên tài liệu **hay đổi nhất** trong repo.
(ii) **Bắt mọi task brief phải commit** đưa `.superpowers/` vào repo, mà nó bị gitignore **có lý do** và chứa
transcript cùng đường dẫn cục bộ. (iii) **Bắt điều phối viên ghi trước khi giao** không có bộ cưỡng chế **kỹ
thuật** nào cả — nó là một luật về hành vi con người, và luật ấy **vừa bị vi phạm bởi chính người viết ra
nó**. 🔴 **Nên câu trả lời trung thực cho *"cái gì sẽ CƯỠNG CHẾ nó"* là: KHÔNG CÓ GÌ CƯỠNG CHẾ ĐƯỢC, ở hình
dạng repo hôm nay** — và ba lối trên là ba cái giá, không phải ba giải pháp. Cái rẻ nhất trong ba, và nó vẫn
**không phải cưỡng chế mà là phát hiện**: một bài test ghim **giao ước hẹp** rằng mọi số hiệu mang
`🔴 CHỜ ANH` ở **bảng phán quyết** xuất hiện đúng một lần ở **phép liệt kê Phần I** và ngược lại — nó bắt được
chỗ lệch chín-mục vừa xảy ra, **không** bắt được một phán quyết chưa bao giờ được ghi, và nó ghim **cấu trúc**
chứ không ghim **văn xuôi**, nên tránh được cái giá (i).

**Nếu KHÔNG quyết định.** Cơ chế lặp lại, và **nó đã lặp lại rồi** — hai lần trong ba ngày: mục 16 (một phán
quyết không có bản ghi) và banner Phần I (một phép liệt kê sai **mười một** mục qua ba nhiệm vụ). Không có bộ
dò nào,
nên **lần tới sẽ lại được phát hiện bằng cách một người tình cờ nhìn** — lần này là người thi hành mục 17, đọc
banner Phần I vì một lý do khác hẳn. 🔴 **Và nêu cho hết, vì một nửa sự thật ở đây sẽ là loại lỗi mà chính mục
này nói về: AU-1 KHÔNG sửa được lớp gốc, chỉ ghi lại nó.** Mục 17 vừa cho một ví dụ thu nhỏ trong cùng nhiệm
vụ này — AL-1 rút một khẳng định đã công bố **trong hồ sơ** ngày 2026-08-20, phép rút **chưa bao giờ tới mã**,
và suốt hai ngày người đọc **mã** vẫn thấy câu sai. **Cùng một lớp, ở hướng ngược lại: hồ sơ đúng, nguồn
sai.** Nên bất kỳ phán quyết nào cho mục này phải trả lời **cả hai hướng**, không chỉ hướng *"ghi vào file"*.

### ✅ ĐÃ THI HÀNH 2026-08-22 (AW-1, base `e99019c0`) — **CỔNG NAY ĐỌC FILE NÀY**; năm chỗ lệch đo được và sửa ở HỒ SƠ; và **nửa thứ nhất của mục này vẫn KHÔNG có bộ dò**

🔨 **QUYẾT: BẮT CỔNG ĐỌC FILE NÀY** (2026-08-22, **điều phối viên quyết theo uỷ quyền**, cùng khuôn mục
8, 15, 17 và 21). **Mọi dòng thân mục gốc ở trên giữ NGUYÊN VĂN.**

#### 🔴 1. Một câu của chính mục này HẾT ĐÚNG kể từ hôm nay — rút TẠI CHỖ, kèm ngày, không xoá

Mục viết, hai lần: *"**không cổng nào đọc file này**"*, và ở §"Ở đâu — trỏ bằng TÊN" nó nêu
`tools/machine-simulator/scripts/verify-suites.sh` (**cổng — và nó KHÔNG đọc `owner-decisions.md`**,
đó là cả vấn đề)". 📎 **Cả hai câu giữ NGUYÊN VĂN ở trên và được RÚT tại đây, 2026-08-22 (AW-1), cùng
kiểu bảo tồn AB-1 lập** — trích nguyên văn rồi rút, kèm ngày và người, **không gạch ngang, không xoá
một dòng nào**. **Lý do rút không phải chúng từng sai**: chúng mô tả đúng trạng thái cho tới hết ngày
2026-08-22 sáng. Cái làm chúng hết đúng là `scripts/check-owner-decisions.sh`, chạy **trong**
`scripts/verify-suites.sh`. **Cổng đọc `docs/owner-decisions.md`.**

#### 2. Phép kiểm ghim **CẤU TRÚC**, không ghim **VĂN XUÔI** — và đó là cái giá (i) mà mục này định giá

Mục đã định giá đúng ba lối và chọn sẵn cái rẻ nhất: *"một bài test ghim **giao ước hẹp** … nó ghim
**cấu trúc** chứ không ghim **văn xuôi**, nên tránh được cái giá (i)."* Dụng cụ đúng hình dạng đó, và
rộng hơn giao ước mục nêu ở đúng một chỗ — nó cũng đọc **PHẦN mà thân mục đứng dưới**:

* **C1** — mỗi số hiệu trong bảng phán quyết có **đúng một** thân mục, và mỗi thân mục có đúng một
  hàng. *(Đây là chính chỗ V-1 bắt được bằng tay: bảng thiếu hai hàng.)*
* **C2** — thân mục nằm dưới **đúng tiêu đề PHẦN** mà trạng thái ghi ở hàng đòi hỏi.
* **C3** — phép liệt kê Phần I **hiện hành** nêu đúng tập số hiệu **thật sự** nằm ở Phần I — cả ở
  **trường máy đọc** lẫn ở **câu văn** người đọc thấy.
* **C4** — không số hiệu nào nằm dưới hai tiêu đề PHẦN.
* **C5** — **mọi** đoạn liệt kê Phần I trần phải khai nó **đang sống** hay **đã rút**.

🔴 **Trạng thái KHÔNG đọc bằng "dấu đầu tiên trong ô", và lý do là một phép đo trên cả 37 hàng.** File
này append-only theo luật, nên một ô đơn lẻ có thể mang `🔴 CHỜ ANH` **và** `✅ ĐÃ THI HÀNH` **và**
`Ở LẠI PHẦN I` cùng lúc. **Cả "dấu đầu wins" lẫn "dấu cuối wins" đều SAI**: hàng 16, 17 và 27 **kết
thúc** bằng câu trạng thái **CŨ** được bảo tồn, còn hàng 1 và 5–11 **mở đầu** bằng một 🔨 mà chúng đã
thi hành từ lâu. Nên trạng thái đọc như một **TẬP token** cộng một luật cho mỗi phần, mỗi luật **một
chiều** có chủ ý.

#### 🔴 3. Luật có răng — *"MỘT PHẦN ⇒ KHÔNG phải Phần III"* — **suy ra, không phát minh**

Banner Phần III đọc *"ĐÃ QUYẾT **VÀ** ĐÃ THI HÀNH"*. Chữ *"MỘT PHẦN"* nói bằng chính lời của hồ sơ
rằng vế thứ hai chưa đủ. **File này đã đồng ý với luật ấy ở ba chỗ trước khi luật được viết ra:** mục
**12** mang tiêu đề *"PHÁN QUYẾT ĐÃ THI HÀNH **MỘT PHẦN**"* và **ở lại Phần II**; mục **27** và mục
**16** mỗi cái từng có phán quyết mà chưa có ghi chép thi hành và **ở lại Phần I**.

#### 🔴 4. **NĂM chỗ lệch đo được hôm nay**, trước khi sửa một chữ — LIỆT KÊ trước, con số SAU

1. **Mục 17 ở Phần III** trong khi hàng bảng của nó tự khai *"ĐÃ THI HÀNH MỘT PHẦN"*.
2. Đoạn liệt kê Phần I trần ở **dòng 111** không khai đang sống hay đã rút.
3. Đoạn liệt kê Phần I trần ở **dòng 168** — cùng thế.
4. Đoạn liệt kê Phần I trần ở **dòng 237** — cùng thế.
5. **Không có trường máy đọc nào** nói cái nào trong ba đoạn ấy là hiện hành.

🔴 **Chỗ lệch 2–5 là một PHÁT HIỆN mà lời giao việc không biết: Phần I chứa BA đoạn liệt kê TRẦN, nêu
ba tập KHÁC NHAU, ở cùng một cấp độ trình bày, và chỉ MỘT là hiện hành.** Chúng đúng luật bảo tồn của
file (giữ câu đã rút ở đúng chỗ nó được viết) và vẫn để người đọc lướt gặp ba lời khai mâu thuẫn mà
không gì phân biệt được. **Đó là mục 37 ở hình dạng thứ hai, tìm thấy trong chính phần mà mục 37 mở
ra để nói về.**

**Cả năm sửa ở HỒ SƠ, không sửa dụng cụ cho vừa hồ sơ:** mục 17 về **Phần I** kèm lập luận từ định
nghĩa các phần; ba đoạn liệt kê mang `<!-- gate:phần-i-rút -->`; một đoạn liệt kê **mới** kèm
`<!-- gate:phần-i = 17 25 30 34 35 36 -->`. **Không một chữ nào của ba đoạn cũ bị sửa, không dòng nào
bị xoá.** Sau khi sửa: **0 chỗ lệch**, 37 hàng ↔ 37 thân mục.

#### 5. Cặp đối chứng — ba chỗ lệch giả, chạy trọn, rồi **hoàn nguyên**

* Đổi hàng của một mục Phần I (mục 35) thành lời khai đã-thi-hành ⇒ **2 ĐỎ** (C2, cả hai chiều).
* Bỏ một số hiệu khỏi trường máy đọc ⇒ **1 ĐỎ** (C3, trường ≠ Phần I thật).
* Làm hỏng một đầu mục thân (mục 36) ⇒ **3 ĐỎ** (C1 hàng không có thân, C3 trường, C3 câu văn).

Cả ba hoàn nguyên; `git diff` ở ngọn nhánh không chứa cái nào; phép kiểm trở về **0**.

#### 🔴 6. Một lỗi CỦA CHÍNH PHÉP KIỂM, bắt bằng cách đo lại sản phẩm của mình

Bản chạy đầu báo **7** chỗ lệch, trong đó *"hàng 6 và hàng 7 không có thân mục"*. **Hai cái đó là do
dụng cụ bịa ra, không phải hồ sơ.** Đầu mục gộp `## 5–7.` dùng **gạch nối en (U+2013), ba byte**, và
bản nháp viết nó vào một lớp ký tự `[–—-]`; awk tách ký tự nhiều byte thành từng byte nên lớp ấy không
bao giờ khớp. Bản sửa phân tích **theo vị trí**, không dùng lớp ký tự, và thêm một chốt tự kiểm: một
khoảng vô nghĩa được báo là *"đọc lại bộ phân tích, đừng đọc lại file"*. **Con số thật là NĂM**, và nó
chỉ trở thành **năm** sau khi phép kiểm bị đem đo lại — đúng thao tác mà bảy nhiệm vụ liên tiếp dùng.

#### 🔴 7. Cái phép kiểm này **KHÔNG** bắt được — và nửa lớn nhất là **nửa thứ nhất của chính mục này**

* **(a) 🔴 NÓ KHÔNG BẮT ĐƯỢC MỘT PHÁN QUYẾT KHÔNG BAO GIỜ ĐƯỢC GHI.** Đó là **nửa thứ nhất** của mục
  này — phán quyết mục 16 của chủ sở hữu tới người thi hành chỉ qua một task brief bị gitignore — và
  **không phép kiểm nào trên file này thấy được một sự kiện không nằm trong file**. Mục đã nói thế
  (*"KHÔNG CÓ GÌ CƯỠNG CHẾ ĐƯỢC, ở hình dạng repo hôm nay"*); dựng dụng cụ **không đổi điều đó**.
  Cái được thêm là **phát hiện** cho nửa thứ hai, đúng như mục dự báo, **không hơn**.
* **(b) Nó không đọc văn xuôi.** Một thân mục có thể nói bất cứ điều gì; nó kiểm token, tiêu đề, phép
  đếm.
* **(c) Nó KHÔNG phán được Phần I hay Phần II cho một mục "MỘT PHẦN".** Nó chỉ nói **KHÔNG PHẢI Phần
  III** rồi dừng. Phần dư là **QUYẾT ĐỊNH** hay **VIỆC** là một phán đoán từ định nghĩa các phần và
  **ở lại với con người**.
* **(d) Nó chỉ ghim phép liệt kê PHẦN I.** Banner Phần II và Phần III không có trường máy đọc, và
  hàng chục câu trích trong khối bảo tồn là **lịch sử**, không phải trạng thái. Chỉ Phần I được ghim,
  vì đó là chỗ đã lỗi thời.
* **(e) Nó không nói gì về TÍNH ĐÚNG** của một phán quyết, một ngày tháng, hay một lời quy trách.
* **(f) Và một cái trần cụ thể của luật có răng ở §3:** một mục thi hành một phần mà ô bảng **không**
  viết chữ *"MỘT PHẦN"* thì **vẫn đi qua**. Luật đứng trên một lời tự khai; nó không đo được sự thi
  hành.

#### 8. Hằng số

**Không hằng số nào của cổng dịch vì mục này.** Phép kiểm là một script chạy trong `verify-suites.sh`
và gộp kết quả vào **cùng một dòng phán quyết**; nó không thêm bài test, không đụng `EXPECT_WARNINGS`,
không đụng năm tổng bộ, không một lệnh đè.

---

## 34. Bốn chuỗi web i18n còn nợ từ mục 22 — vẫn nợ, và chúng là bề mặt CUỐI CÙNG còn hứa một thứ không tồn tại

🔴 **CHỜ ANH.** Mở 2026-08-22 (AU-1), xác nhận lại trên mã.

**Đo được cái gì.** Mục 22 đã thi hành 2026-08-21 (AR-1) và **tự ghi món nợ**: *"🔴 **BỐN CHUỖI NỮA ĐO ĐƯỢC MÀ
CỐ Ý KHÔNG ĐỤNG, vì nêu thiếu còn tệ hơn** … **Đây là việc còn nợ, ghi lại chứ không im lặng.**"* Đếm lại hôm
nay: **vẫn đúng bốn**, hai khoá × hai locale, và **liệt kê trước khi đếm** —
`en.scenario.networkOutageHint` (*"Switches the transport to high-failure store-and-forward."*),
`en.scenario.presets.networkOutage.description` (*"…high-failure (~90%) store-and-forward…"*),
`vi.scenario.networkOutageHint` (*"…store-and-forward **lỗi cao**."*),
`vi.scenario.presets.networkOutage.description` (*"…store-and-forward lỗi cao (~90%)…"*).

**Và lời hứa ấy là sai, đo trên mã:** `DemoTransport.SendAsync` có **bốn** đường ra và **cả bốn** trả
`Success: true` — đường queued, `AckProcessResult` (201), `AckInspection` (201), `AckTelemetry` (202).
`ShouldSimulateQueued` biến `_fakeErrorRate` thành xác suất **QUEUED**, không phải tỉ lệ **thất bại**. Nên
`~90 %` là phần **xếp hàng**, và *"high-failure"*/*"lỗi cao"* sai **ở cả hai chữ**.

🔴 **Một chỗ lệch so với brief, nêu rõ:** brief nói mục 22 *"trả sáu chuỗi `.cs`"*. Đo lại: mục 22 **đo được
SÁU** và **trả NĂM** — chỗ thứ sáu (`App.xaml.cs`, doc comment của selftest) **cố ý để lại**. Bốn chuỗi i18n
là một món nợ **riêng**, nằm ngoài cả sáu.

**Ở đâu trong mã — trỏ bằng TÊN.** `tools/machine-simulator/web/src/i18n/en.ts`,
`tools/machine-simulator/web/src/i18n/vi.ts`; render bởi `web/src/routes/Scenario.tsx`
(`t("scenario.networkOutageHint")` và `t(\`scenario.presets.${meta.i18nKey}.description\`)`);
sự thật đối chiếu là `St4i.EdgeCore.Transport.DemoTransport.SendAsync` và
`DemoTransport.ShouldSimulateQueued`. (`client/src/i18n/locales/*.json` ở gốc repo thuộc **ứng dụng khác**,
không phải machine-simulator.)

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* web là bề mặt **phần lớn vận hành viên dùng**, và nay là bề mặt **DUY NHẤT còn hứa một ack thất
bại** — WPF, dòng trạng thái DTO và mô tả preset của `GET /v1/scenario` đều đã sửa ngày 2026-08-21. Sản phẩm
**tự mâu thuẫn giữa các tầng**, và một lần chạy nghiệm thu lái từ trang Scenario với chữ *"high-failure"* sẽ
**xanh vĩnh viễn trong khi không chứng minh gì** về xử lý lỗi.
*Chiều ngược:* bốn phép sửa chuỗi nằm trong một build **không có nhân chứng i18n và không có job CI nào**, nên
thay đổi **không kiểm được** ngoài mắt người và một lần chạy Playwright cục bộ. Và `~90 %` là con số một vận
hành viên **có thể đã neo vào**; viết lại thành *"≈90 % xếp hàng"* là **một thay đổi lời hứa đã xuất bản thứ
hai** — đúng loại mà chủ sở hữu giữ lại cho mình ở mục 22 — chứ không phải sửa lỗi chính tả. Bốn phép sửa ấy
cũng **vượt qua cổng publish của web**, đúng trục rủi ro mà AR-1 đã từ chối bước vào trên một mục phạm vi
.NET.

**Nếu KHÔNG quyết định.** Bốn chuỗi ở lại **hiển thị cho vận hành viên** và **không dụng cụ nào có thể bắt
được chúng**: `web/package.json` không có script i18n; `web/scripts/` chỉ có ngân sách test và reset engine;
`scripts/i18n-check.mjs`/`i18n-audit.mjs` ở gốc repo thuộc `client/` và **không được** `verify-suites.sh` gọi;
`.github/workflows/` **không nhắc `machine-simulator` một lần nào** — máy mô phỏng **không có job CI nào cả**.
Guard cấu trúc duy nhất là `en.ts` khai `const en: Dictionary` nên `tsc -b` bắt được **khoá thiếu** — nó nói
khoá tồn tại, **không nói gì về chữ đằng sau khoá**. `EnumSpellingContractTests` có ghim hai file này nhưng
chỉ ở các khối enum, và **tự khai** giới hạn ấy.

### ✅ ĐÃ THI HÀNH 2026-08-22 (AX-1) — sửa LỜI, không đổi hành vi. 🔴 **Và *"bề mặt CUỐI CÙNG"* trong đầu đề mục này là một PHỦ ĐỊNH TỒN TẠI SAI: có chỗ thứ NĂM**

**Quần thể liệt kê trước khi đếm, và liệt kê bằng `scripts/repo-scan.sh` (mục 32) chứ không bằng lệnh
gõ tay.** `web/src/i18n/` chứa **đúng ba** file — `en.ts`, `vi.ts`, `index.ts`. Rằng chỉ có **hai**
locale không phải một phép đếm file mà là một sự thật **của kiểu**: `index.ts` khai
`export type Language = "vi" | "en"` và `const dictionaries: Record<Language, Dictionary> = { vi, en }`,
nên một locale thứ ba **không biên dịch được** nếu không sửa chính hai dòng ấy. Tập đã mở HẾT, không
phải tập chưa mở hết.

**Con số BỐN của mục này ĐỨNG VỮNG. Bốn chuỗi, trước → sau, nguyên văn:**

1. `en.scenario.networkOutageHint` — *"Switches the transport to high-failure store-and-forward."* →
   *"Switches the transport to store-and-forward: acks come back queued, never failed."*
2. `en.scenario.presets.networkOutage.description` — *"Switches to high-failure (~90%)
   store-and-forward while the fleet keeps running."* → *"Switches to store-and-forward while the fleet
   keeps running — ~90% of acks come back queued, and none of them ever fails."*
3. `vi.scenario.networkOutageHint` — *"Chuyển transport sang store-and-forward lỗi cao."* →
   *"Chuyển transport sang store-and-forward: ack chỉ queued, không bao giờ lỗi."*
4. `vi.scenario.presets.networkOutage.description` — *"Chuyển sang store-and-forward lỗi cao (~90%)
   trong khi fleet vẫn chạy."* → *"Chuyển sang store-and-forward trong khi fleet vẫn chạy — ~90% ack trả
   về queued, không ack nào thất bại."*

**Câu chúng phải đồng ý là câu mục 22 đã viết ra, không phải một câu mới.** Ghi chép thi hành của mục
22 (2026-08-21, AR-1) sửa **năm** chỗ `.cs`; hai chỗ mang câu chuẩn cho hai thứ tiếng và bốn chuỗi trên
được viết để **khớp chúng từng chữ**: `Dtos.BuildStatusLine` — *"network outage (acks queued, never
failed)"*; `ScenarioViewModel.RefreshStatusLine` — *"MẤT MẠNG (ack chỉ queued, không bao giờ lỗi)"*;
`FleetHost.Presets` — *"~90% ack tra ve queued, khong ack nao that bai"*.

🔴 **Câu ấy được ĐO LẠI trước khi nhân bản, không được thừa hưởng** — brief nói rõ: nếu phép đo cho
thấy câu của mục 22 sai thì rút tại chỗ chứ đừng chép sai sang bốn chỗ nữa. Đo hôm nay trên
`DemoTransport.SendAsync`: **bốn** đường trả ack — nhánh queued (`Success: true, Queued: true`),
`AckProcessResult` (201), `AckInspection` (201), `AckTelemetry` (202) — **cả bốn `Success: true`**; lối
ra thứ năm là một `throw` cho `ReadingKind` lạ, **không phải một ack thất bại**. `ShouldSimulateQueued`
so `_fakeErrorRate` với một bucket băm của `IdempotencyKey`, và `FleetCore.OutageFakeErrorRate = 0.9` là
hằng số duy nhất nuôi nó. **Câu của mục 22 đứng vững; không có gì phải rút.**

🔴 **CHỖ THỨ NĂM, VÀ NÓ BÁC ĐẦU ĐỀ CỦA CHÍNH MỤC NÀY.** Mục 34 tự nhận bốn chuỗi web là *"bề mặt CUỐI
CÙNG còn hứa một thứ không tồn tại"* và *"bề mặt DUY NHẤT còn hứa một ack thất bại"*. Quét toàn cây qua
`repo-scan.sh` ở `cfcfae42` cho `high-failure|lỗi cao|loi cao` rồi cho `queued/fail|queued/lỗi|ack…thất
bại` tìm ra **`README.md` §7, bảng preset, dòng "Mất mạng demo"**: *"Swaps the live transport for a
~90%-error `DemoTransport` — API Inspector shows queued/failed rows"*. **Cùng một lời hứa sai, cùng lớp
với năm chỗ mục 22 đã sửa, và nó là bề mặt một BÊN TÍCH HỢP đọc.** Đã sửa tại chỗ kèm ngày và kèm câu
rút. Phủ định tồn tại của mục 34 **chỉ đúng nếu giới hạn vào `web/`**; ở phạm vi cây nó **SAI**, và đây
đúng là loại nhầm phạm vi mục 32 tồn tại để chấm dứt — lần này trong chính một mục Phần I.

📎 **Một chỗ CỐ Ý không đụng, nói ra chứ không im lặng:** `St4iMachineSimulator/App.xaml.cs` vẫn mang
*"must make acks come back queued/failed"* (doc comment của selftest, dòng 1389) và hai chuỗi console
*"queued/failed"*. Mục 22 đã xét chỗ này và để lại **có lý do ghi rõ**: nó mô tả **ý định của bài
selftest**, bài ấy chấp nhận `Queued`, và nó không hiển thị cho vận hành viên. Phán quyết ấy giữ nguyên.
Nên câu đúng hôm nay là: **không còn bề mặt VẬN HÀNH VIÊN hay TÍCH HỢP nào hứa một ack thất bại**; ba
chuỗi selftest thì còn, và chúng được kể ra chứ không bị đếm sót.

**Nhân chứng.** 🔴 **KHÔNG phải một nhân chứng đỏ được — mục này chỉ đổi lời**, và mục 34 đã đo sẵn vì
sao: web của machine-simulator **không có job CI nào** và **không có dụng cụ i18n nào**. Cái thay cho
nhân chứng là ba phép đo: (a) `npm run build` (`tsc -b && vite build`) **xanh** — cổng không biên dịch
TypeScript, nên bước này phải chạy tay; (b) quét bằng `repo-scan.sh` **trước khi sửa** cho thấy **không
bài test nào** trong `web/tests/` hay `tests/` khẳng định bốn chuỗi cũ theo nguyên văn (`06-scenario.
spec.ts` khớp `/Lô lỗi cao/`, thuộc preset **high-defect**, một preset khác và ở đó *"lỗi cao"* **đúng**);
(c) phép đo bốn đường ra của `DemoTransport.SendAsync` ở trên. **Không hằng số nào của cổng dịch vì mục
này** — bốn chuỗi `.ts` và một dòng README không thêm bài test nào.

---

## 36. README §16.4/§16.6 là một bản sao KHÔNG CÓ NHÂN CHỨNG — và chính file nguồn TỰ KHAI điều đó, trong khi một câu đã trôi rồi

🔴 **CHỜ ANH.** Mở 2026-08-22 (AU-1), xác nhận lại trên mã.

**Đo được cái gì.** `README.md` §16.4 (*Modbus TCP driver*) và §16.6 (*OPC-UA client driver*) mỗi cái mang một
**bảng biến môi trường** (4 hàng mỗi bên: tên, ngữ nghĩa, mặc định) cộng hình dạng JSON của file map với mặc
định từng trường. Chúng là **bản sao chép tay** của `ModbusOptions` / `OpcUaOptions` (`EnvVarEnabled/Host/
Port/MapPath`, `DefaultHost`, `DefaultPort`, `FromEnvironment`; `EnvVarEnabled/Endpoint/MapPath/PkiDir`) và
của `ModbusRegisterMap.FromJson` / `OpcUaNodeMap.FromJson`.

**Không test, script hay bước CI nào kiểm chúng — liệt kê những gì ĐÃ tìm, rồi mới kết luận:**
`.github/workflows/` **không nhắc `machine-simulator`** (máy mô phỏng **không có CI**); `verify-suites.sh`
nhắc README ở §15.9, §23.6, §24.4, §24.5, §8.1 — **không** §16.x (một lần nhắc `ST4I_MODBUS_PORT` chỉ để
**loại trừ** một dương tính giả); năm file C# mở `README.md` chỉ dùng nó làm **mốc thư mục gốc**, không phải
khẳng định; `PerHostDataRootsTests` và `NotificationDocumentationTests` **là** tiền lệ ghim tài liệu thật
nhưng phạm vi ở **§15.9** và mục notifications; `EnumSpellingContractTests` **tự khai** README nằm **ngoài**
ba gốc của nó; `git grep -E "§16\.4|§16\.6"` trên `tests/`, `scripts/`, `web/tests/` trả **0**.

🔴 **Và mã TỰ KHAI khoảng trống này.** `ModbusOptions` viết, nguyên văn: *"The README tables remain a
hand-kept copy with no witness: nothing goes red if they drift, and that is still true."* Hai bản sao **khác**
mà cùng đoạn ấy nêu tên (hai file test) **đã được cho một nhân chứng biên dịch** bằng cách gọi hằng số theo
tên — **README bị cố ý để lại làm bản sao thứ ba, không có nhân chứng.**

🔴 **Phép kiểm tra chéo tìm được một câu ĐÃ TRÔI, nên đây không phải rủi ro giả định:** §16.6 nói
`OperationTimeout` là *"hardcoded 15 seconds, not configurable via any env var/setting"*. Đo:
`OpcUaDriver` nhận `int operationTimeoutMs = 15000` **làm tham số constructor** từ Task B-5. Nửa sau của câu
(*"không cấu hình được qua env var/setting"*) **vẫn đúng**; chữ *"hardcoded"* **không còn đúng theo nghĩa
đen**. Sáu spot-check khác **sạch** (mặc định `127.0.0.1`/`502`; `dataType` chỉ `UInt16`/`Int16`; `unitId` 1,
`pollIntervalMs` 1000, chặn 60 000/5; stack ghim `1.5.378.156`; `ST4I_OPCUA_ENDPOINT` *"không được đọc"*;
`securityMode` chỉ `None`).

**Ở đâu trong mã — trỏ bằng TÊN.** `tools/machine-simulator/README.md` §16.4 và §16.6;
`St4i.EdgeCore.Drivers.Modbus.ModbusOptions`, `St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap`,
`St4i.EdgeCore.Drivers.OpcUa.OpcUaOptions`, `St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap`,
`St4i.EdgeCore.Drivers.OpcUa.OpcUaDriver`; tiền lệ ghim: `PerHostDataRootsTests`,
`NotificationDocumentationTests`.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* độc giả là **một bên tích hợp đang cấu hình một nhà máy**, và cách hỏng **im lặng** — đổi tên
một hằng số hay đổi một mặc định để README **xanh** trong khi vận hành viên gõ một biến không còn tồn tại và
nhận hành vi *"mặc định TẮT"* **không có lỗi nào**, vì cả hai driver đều được ghi là log-rồi-tắt chứ không
sập. Repo **đã có dụng cụ cho việc này** (lối cắt-mục-theo-heading của `NotificationDocumentationTests`, lối
ghim-regex của `PerHostDataRootsTests`) — nên khoảng trống là **một lựa chọn, không phải một giới hạn năng
lực**. Câu *"hardcoded 15 seconds"* đã trôi là **bằng chứng tồn tại** rằng nó trôi thật.
*Chiều ngược:* một bài test ghim mục sẽ ghim **văn xuôi**, nên **mọi lần viết lại hợp lệ** §16.4/§16.6 kéo
theo một lần sửa test — đúng thứ ma sát làm người ta **ngại cập nhật** chính các khối RTU/deferral trung thực
mà hai mục này đang giữ. §16.4 riêng nó là **~160 dòng văn xuôi** quanh một bảng 4 hàng; một phép ghim cả mục
kiểu ngây thơ sẽ **đỏ vì những sửa đổi không liên quan**. Bản hẹp (ghim 8 hàng `ST4I_*` và các mặc định số
theo hằng số) mua **~90 %** giá trị với **~10 %** độ giòn — **nhưng nó để lại toàn bộ khẳng định văn xuôi,
gồm cả câu đã trôi, vẫn không có nhân chứng.**

**Nếu KHÔNG quyết định.** Hai mục ở lại là **bản sao thứ ba không có nhân chứng** của một sự thật có **ba** bản
sao, trong khi hai bản kia đã được cho nhân chứng — nên chỗ trôi tiếp theo sẽ xảy ra **đúng ở đây**, và sẽ
được phát hiện bởi một bên tích hợp chứ không bởi một cổng. Đây **cùng một lớp với mục 26** (không gì trả cho
**tính đúng** của một chú thích đã viết) và **mục 32** (một lời khai chỉ kiểm được nếu nó ghi lại điều kiện
của chính nó) — nhưng khác cả hai ở chỗ **bản sửa đã được tiền lệ hoá hai lần trong chính repo này**.

### ✅ ĐÃ THI HÀNH 2026-08-22 (AX-1) — **MỘT NHÂN CHỨNG ĐỎ ĐƯỢC**, không phải một lần sửa lời. 🔴 **Và dựng nó tìm ra khẳng định sai THỨ HAI mà mục này chưa thấy**

**Sản phẩm là `tests/St4i.EngineApi.Tests/DriverDocumentationTests.cs`** — ba `[Fact]`, đặt cạnh hai tiền
lệ mà chính mục này nêu tên (`PerHostDataRootsTests`, `Alarms/NotificationDocumentationTests`), dùng lại
lối đi-ngược-lên-gốc-repo và lối cắt-mục-theo-heading của chúng. Vì sao **ở suite EngineApi** chứ không ở
`St4i.EdgeCore.Tests` dù chủ thể là kiểu của EdgeCore: hai tiền lệ ở đây, và một nhân chứng tài liệu học
lối của tiền lệ thì nên ở cạnh tiền lệ.

**TỪNG KHẲNG ĐỊNH CỦA §16.4/§16.6 — LIỆT KÊ, RỒI KIỂM. Không đếm trước.** Chỉ những khẳng định **có
nguồn sự thật trong mã** mới vào bảng này; văn xuôi lý lẽ thì không, và ranh giới ấy được nêu ở cuối.

*§16.4 (Modbus TCP):* (1) bốn tên biến `ST4I_MODBUS_{ENABLED,HOST,PORT,MAP}` — **đúng**, và nay so hai
chiều với bốn hằng `ModbusOptions.EnvVar*`. (2) mặc định TẮT — **đúng** (`new ModbusOptions().Enabled ==
false`). (3) host mặc định `127.0.0.1` = `ModbusOptions.DefaultHost` — **đúng**. (4) port mặc định `502` =
`DefaultPort` — **đúng**. (5) `unitId` mặc định `1` — **đúng**, lấy bằng cách nạp một map tối thiểu qua
`FromJson` thật. (6) `pollIntervalMs` mặc định `1000` — **đúng**, cùng cách. (7) trần `readTimeoutMs`
60 000 ms = `MaxReadTimeoutMs` — **đúng**. (8) trần `retries` 5 = `MaxRetries` — **đúng**. (9)
`type ∈ {Holding, Input}` = `enum ModbusRegisterType` — **đúng**, hai thành viên. (10)
`dataType ∈ {UInt16, Int16}` = `enum ModbusDataType` — **đúng**, hai thành viên. (11) timeout suy ra
`Math.Max(1000ms, pollIntervalMs × 4)` — **đúng**, và **cả hai nhánh của `max` được chạy**, không chỉ
đọc. (12) NModbus retry hạ về 1 mặc định = `EffectiveRetries` — **đúng**. (13) 🔴 **kiểu tham số lệnh
`"UInt16" | "Int16" | "Int32" | "UInt32" | "Bool" | "Double"` — SAI.**

*§16.6 (OPC-UA):* (14) bốn tên biến `ST4I_OPCUA_{ENABLED,ENDPOINT,MAP,PKI_DIR}` — **đúng**, so hai chiều.
(15) mặc định TẮT — **đúng**. (16) `ST4I_OPCUA_ENDPOINT` *"không được dùng"* — **đúng**, và giữ được ở
mức một phép kiểm quyết được: `OpcUaDriver` **không có tham số endpoint nào** trong constructor. (17) gốc
PKI mặc định `%ProgramData%\ST4I\sim\opcua-pki` = `OpcUaPkiPaths.DefaultRoot()` — **đúng**, so bằng phần
đuôi dẫn xuất chứ không gõ lại. (18) `securityMode` chỉ có `"None"` = `enum OpcUaSecurityMode` — **đúng**,
một thành viên, và **tính ĐÓNG** của tập là thứ được ghim. (19) `pollIntervalMs` mặc định `1000` —
**đúng**. (20) stack `1.5.378.156` — **đúng**, đọc từ `PackageReference` trong `St4i.EdgeCore.csproj`.
(21) `valueType` của `writable` gồm sáu kiểu, **String bị từ chối** — **đúng**, và sự bất đối xứng với
(13) nay được **chạy** chứ không mô tả: `OpcUaNodeMap.FromJson` ném với `"valueType": "String"` và nhận
với `"Bool"`. (22) 🔴 ***"hardcoded 15 seconds"* — SAI**, đúng như mục này đã đo.

**HAI KHẲNG ĐỊNH SAI, và mục 36 chỉ thấy MỘT.**

* **(22), mục này đã tìm ra:** §16.6 gọi ngưỡng chọn-endpoint là *"**hardcoded** 15 seconds, not
  configurable via any env var/setting"*. Nó là tham số constructor `operationTimeoutMs = 15000` của
  `OpcUaDriver` từ Task B-5. **Nửa sau vẫn đúng** — không biến môi trường, không cài đặt nào đổi nó.
  Rút tại chỗ kèm ngày, ở **cả** đoạn EN và đoạn VI; câu mới nêu đích danh tham số ấy.
* 🔴 **(13), mục 36 KHÔNG thấy — tìm được lúc dựng nhân chứng:** §16.4 công bố kiểu của một tham số lệnh
  là một tập **ĐÓNG SÁU** thành viên. `St4i.Connector.Abstractions.Models.CommandArgumentType` có **BẢY**:
  `String` được `CommandArgumentDeclaration.ValidateSelf` **chấp nhận** — và `ValidateSelf` là **phép kiểm
  lược đồ duy nhất** mà `FromJson` của **cả hai** map chạy trên một tham số lệnh — rồi `TryNarrow` thu hẹp
  nó như mọi thành viên khác. **Một tập đóng công bố thiếu một thành viên là một câu một bên tích hợp
  hành động theo.** Đã bổ sung tại chỗ kèm ngày, kèm lý do vì sao danh sách của §16.6 **đúng** khi chỉ có
  sáu (setpoint và tham số lệnh là **hai tập khác nhau**, và nay sự khác nhau ấy được đo).

📎 **Sáu spot-check mà mục này đã làm và gọi là *"sạch"* — kiểm lại, cả sáu ĐỨNG VỮNG** (mặc định
`127.0.0.1`/`502`; `dataType` chỉ `UInt16`/`Int16`; `unitId` 1, `pollIntervalMs` 1000, chặn 60 000/5;
stack ghim `1.5.378.156`; `ST4I_OPCUA_ENDPOINT` không được đọc; `securityMode` chỉ `None`). **Cả sáu nay
có nhân chứng** thay vì có một lần nhìn.

🔴 **VÀ MỘT CÂU CỦA CHÍNH MÃ NGUỒN ĐƯỢC RÚT.** `ModbusOptions` tự khai — mục này trích nguyên văn —
*"The README tables remain a hand-kept copy with no witness: nothing goes red if they drift, and that is
still true."* Câu ấy **hết đúng kể từ hôm nay** và được rút **tại chỗ trong `ModbusOptions.cs`**, không
chỉ ở đây, kèm phát biểu chính xác về cái nhân chứng mới mua được và cái nó không mua.

**CẶP ĐỐI CHỨNG — chạy TRỌN, một đột biến cho MỖI `[Fact]`, rồi hoàn nguyên.** Một đột biến duy nhất sẽ
chứng nhận một bài và để hai bài kia không được chứng nhận:

1. `ModbusOptions.EnvVarPort` `"ST4I_MODBUS_PORT"` → `"ST4I_MODBUS_TCP_PORT"` ⇒ **fact 1 ĐỎ**
   (*"Assert.Equal() Failure: Collections differ"*), hai fact kia xanh.
2. `OpcUaDriver`'s `operationTimeoutMs = 15000` → `20000` ⇒ **fact 2 ĐỎ** (*"Not found: 20000"*).
3. Thêm một thành viên thứ bảy vào `CommandArgumentType` ⇒ **fact 3 ĐỎ** (*"Collections differ"*).

Cả ba **hoàn nguyên**, bộ ba chạy lại **3/3 xanh**, và `git diff` ở ngọn nhánh không mang một cái nào.

🔴 **CÁI NHÂN CHỨNG NÀY KHÔNG VỚI TỚI — nêu dài bằng cái nó với tới, vì một cái trần nêu quá nhỏ còn tệ
hơn không nêu trần.** Ranh giới **không** phải *"văn bản đối lại mã"*: mọi phép so ở đây đều so **văn
bản**, README là văn bản. Ranh giới là thứ được so **có phải một GIÁ TRỊ do mã sinh ra hay không**. Giá
trị: tám tên biến, hai mặc định Modbus, đuôi PKI, hai trần map, ba mặc định map nạp qua `FromJson`, mặc
định retry, phiên bản stack, ngưỡng timeout, hai tập kiểu. **Cụm từ, và đây là bốn chỗ yếu, kể ra chứ
không giấu:** *"not consulted"*; *"only `\"None\"` exists"*; công thức `Math.Max(1000ms, pollIntervalMs ×
4)` (hai con số của nó **gõ vào mẫu**, không dẫn xuất); và một phép kiểm **phủ định** trên tính từ
*"hardcoded"* — ghim một TỪ, việc mà một bài test tài liệu thường không nên làm, có mặt ở đây vì trong hai
khẳng định sai thì đó là **nửa mà không phép so giá trị nào thấy được**: con số 15 000 vốn **vẫn đúng**,
chỉ chữ quanh nó là sai. Ngoài bốn chỗ ấy, **các đoạn lý lẽ, hai danh sách *"honest deferral"* và khối
RTU vẫn không có nhân chứng y như trước**, và một bản viết lại giữ nguyên các con số mà lật một khẳng
định thì **xanh**. Đây cùng lớp với **mục 26** và mục này **thu hẹp** chứ không **đóng** nó. Cộng: chiều
NGƯỢC được so trọn cho **hai** tập kiểu (hai cái công bố dạng `"A" | "B"` máy đọc được); với
`ModbusRegisterType`, `ModbusDataType`, `OpcUaSecurityMode` — công bố trong văn xuôi có trích cả token
không liên quan (`"writable"` nằm trong chính gạch đầu dòng của `type`) — phép gác là **thành viên có mặt
+ ĐẾM bị ghim**: thêm/bớt một thành viên thì đỏ, **đổi TÊN** một thành viên thành một chính tả mà văn xuôi
vốn đã chứa thì **không**. Và khối RTU của §16.4 (`rtu-gateway`/`rtu-serial`, mảng `devices`, 19200-8-E-1)
**ngoài phạm vi**: nó thuộc phép phân tích `connectors.json`, không thuộc hai lớp option này.

**Hằng số.** `EXPECT_ENGINEAPI` **1405 → 1408** (+3, ba `[Fact]`, không `[Theory]`); tổng **2821 → 2824**.
**Đó là tổng DUY NHẤT dịch**, và đấy là một phép kiểm phạm vi chứ không phải tiện lợi. `EXPECT_WARNINGS`
đo lại trên `-t:Rebuild` trọn vẹn; **không một lệnh đè** — không `.editorconfig`, không `<NoWarn>`, không
`#pragma`, không `SuppressMessage`. Biện minh nằm **ngay cạnh hằng số** trong `verify-suites.sh`.

---

## 12. `St4i.EdgeCore` không bao giờ đặt `GenerateDocumentationFile`, và bật nó đòi một lệnh đè trên một file ta KHÔNG được sửa

**Đo bởi W-1 tại `46439925`, SDK 10.0.302, `dotnet build -t:Rebuild` từ
`tools/machine-simulator`, đếm theo đúng cách bản tóm tắt của MSBuild đếm.** Không có
con số nào dưới đây là ước lượng, và không có cái nào bị W-1 đè.

| cấu hình | cảnh báo toàn cây |
|---|---:|
| như đang ship | **116** |
| + bật cờ cho **riêng** `St4i.EdgeCore` | **852** |
| + `.editorconfig` ở **gốc repository**, chỉ CS1591 | **757** |
| + `.editorconfig` ở **`examples/`**, chỉ CS1591 | **757** |
| + `.editorconfig` **NGAY CẠNH file** (`examples/device-client/csharp/`), **cả hai mã** | **749** — và **không còn CS15xx nào** trong file ấy |

Chênh 736 gồm: **543 CS1591** + **92 CS1573** (bao phủ tài liệu) và **101** khẳng định
`cref`/`paramref` **không phân giải được** (75 CS1574, 23 CS1734, 3 CS0419).

**Phần chia đôi mới là quyết định.** Trong 543 + 92 ấy:

- **448 CS1591 + 84 CS1573 là mã NGUỒN CỦA CHÍNH TA.** Không gì cản viết chú thích cho
  chúng ngoài việc **có nên hứa gì trên bề mặt ấy** — đúng câu hỏi mà bảy project chưa
  đặt cờ khác đang mang (tổng 2775). Đây **không** phải chỗ cần lệnh đè.
- **95 CS1591 + 8 CS1573 nằm trong
  `examples/device-client/csharp/St4iDeviceClient.cs`** — file SDK vendored mà
  `St4i.EdgeCore.csproj` `Compile`-link từ NGOÀI cây project, được xuất bản cho nhà phát
  triển máy, giữ đồng bộ với SDK Python và Node, và **repo này KHÔNG được sửa**. 103 cảnh
  báo ấy **không thể trả bằng cách viết**, nên chúng là **lý do duy nhất một lệnh đè trở
  nên CẦN THIẾT** nếu cờ được bật.

**Điều N-1 ghi là CHƯA ĐO, nay đã đo — kèm ba hệ quả, và MỘT TRONG BA CÁI TÔI VIẾT VÒNG
ĐẦU LÀ SAI:**

1. Mục khoanh-theo-đường-dẫn **có** khớp: 852 → 757, đúng −95, CS1591 biến mất khỏi file
   ấy. Nhưng N-1 chỉ nêu CS1591, nên **(b) như đã mô tả bỏ sót 8 CS1573 vẫn nằm nguyên
   trong chính file không đụng được ấy**: nó miễn trừ MỘT trong HAI mã. **Xác nhận.**
2. 🔴 **VÒNG ĐẦU TÔI VIẾT — VÀ NÓ SAI:** *"mục ấy không thể sống trong cây sản phẩm này;
   nó phải đặt ở gốc repository, phía trên một ứng dụng TypeScript/Node không liên quan."*
   Tiền đề đúng — **mục (section)** chỉ khớp file **tại hoặc dưới** thư mục của nó — nhưng
   **kết luận không theo**, vì **việc TÌM RA file `.editorconfig` đi theo chuỗi tổ tiên của
   FILE NGUỒN, không phải của project**. Đo lại, ba vị trí, mỗi vị trí một lần build đầy
   đủ: gốc repo → 757; `examples/` → 757; **ngay cạnh file, khai cả hai mã → 749, và không
   còn một CS15xx nào trong file ấy.** Nên lệnh đè **ngồi cách chính file nó nói về hai
   thư mục**, nằm **bên trong** ví dụ SDK mà nó miễn trừ, và **không** bị ép lên gốc repo.
   Sửa tại chỗ chứ không thay lặng, vì câu sai ấy **đã nằm trong artefact của chủ sở hữu**.
   **Phần còn lại của phản đối là một phản đối KHÁC và CHƯA ĐO:** thư mục ấy là ví dụ SDK
   **được xuất bản**, giữ đồng bộ với SDK Python và Node — nên một file đặt ở đó **đi theo
   bản phát hành tới nhà phát triển máy** và **có thể mất khi vendor lại**.
3. **749 vẫn không phải 116**, và 757 cũng không. "Để 448 cái kia ĐƯỢC KHẲNG ĐỊNH" là đúng
   và **không** đồng nghĩa "xanh": một miễn trừ **hoàn hảo** cho file vendored gỡ 103 cái
   không ai sửa được và **để lại 633** — 532 cảnh báo bao phủ trên mã của ta, cộng 101
   khẳng định `cref` sai — hoặc được viết, hoặc được ghim.

**BỐN lựa chọn, nêu đủ chứ không nêu cái tiện. Vòng đầu tôi chỉ nêu ba, và cái thiếu là
cái HẸP NHẤT — đó là một thiếu sót ẢNH HƯỞNG QUYẾT ĐỊNH, ngay trong artefact viết ra để
quyết định:**

- **(a) `<NoWarn>CS1591;CS1573</NoWarn>` cả assembly** — im lặng 635; project ấy khi đó
  **không khẳng định bao phủ tài liệu ở đâu cả**, kể cả 532 thành viên là mã của ta.
- **(b1) `.editorconfig` ở gốc repo hoặc ở `examples/`, chỉ CS1591** → **757**. Đây là
  lựa chọn N-1 mô tả. Nó **để lại 8 CS1573** trong chính file không đụng được, và đặt một
  file cấu hình phía trên cây mã không liên quan.
- **(b2) 🔴 `.editorconfig` NGAY CẠNH file vendored, khai CS1591 + CS1573** → **749**, và
  **không còn một cảnh báo tài liệu nào** phát ra từ file ấy. **Hẹp nhất trong cả bốn**:
  miễn trừ **đúng** 103 cái không ai được sửa và **để cả 532 cái của ta được khẳng định**.
  Giá phải trả, nêu ra chứ không giấu: file ấy nằm **trong ví dụ SDK được xuất bản**, nên
  nó đi theo bản phát hành và **có thể biến mất trong lần vendor lại** — một phản đối
  **chưa được đo**.
- **(c) không bật cờ** — trạng thái hiện tại. 101 khẳng định `cref` sai trong project này
  (237 toàn cây) **không có gì canh**.
  📎 **RÚT 2026-08-18 (AD-1) — CHỈ con số toàn cây, không phải con số của project này.** Câu
  trên viết nguyên văn *"(237 toàn cây)"*. Đo lại tại `59bebd21`, cùng SDK 10.0.302, con số ấy
  là **239** (235 chỗ nguồn phân biệt; 261 nếu đếm theo cách MSBuild đếm). **101 của chính
  project này KHÔNG đổi.** Cả hai cái mới nằm ở `St4i.EngineApi.Tests` và vào ở **cùng một
  commit `4d1422a7`** — trong merge AC-1, tức **merge cuối cùng trước base của phép đo này**:
  `Site/BoundServerAddressesTests.cs(51,25)` CS1574 `cref="Collection"` (file chưa tồn tại tại
  `46439925`) và `OperatorDataRemovalCensusTests.cs(1863,74)` CS0419 `cref="Directory.CreateDirectory"`.
  🔴 **Chính câu (c) vừa được chứng minh bằng phép đo thay vì bằng lập luận:** lớp ấy **không
  đứng yên, nó đang đầy lại**, ở đúng nhịp lớp khối-`///`-hỏng đã đầy lại ngay sau khi N-1 dọn
  sạch. Cùng con số cũ còn nằm ở `scripts/verify-suites.sh` và `Directory.Build.props`; AD-1
  **không sửa hai chỗ ấy** vì đợt này không thi hành gì, và nêu tên chúng để đợt sau sửa.

**Cả (b1) và (b2) đều VẪN LÀ LỆNH ĐÈ, và không lựa chọn nào tự nó làm cờ bật được xanh:**
kể cả sau (b2), 633 cảnh báo còn lại phải được **viết** hoặc được **ghim**. Đó là quyết
định của anh, không phải của người thực thi.

🔴 **W-1 KHÔNG chọn giúp, và cũng KHÔNG để văn xuôi ấy tiếp tục không ai đọc.** Nửa
**phân tích cú pháp** của câu hỏi không cần cờ nào cả và đã được đóng bằng một dụng cụ
riêng: `tests/St4i.EdgeCore.Tests/DocCommentProseTests.cs` đọc **mọi** khối `///` trong cả
cây như XML, cộng một phép kiểm **tên phần tử** mà **trình biên dịch không hề làm**. (Kích
thước tập quét **không** ghi ở đây: vòng đầu tôi ghi "530 file, 3.616 khối", ghép số file
của một cây với số khối của một cây khác trên một quần thể khác. Luật mua được: **nêu tên
assertion, đừng chép số của nó vào văn xuôi.**) Nửa **phân giải** (`cref`) thì **chỉ**
trình biên dịch thấy, nên nó nằm lại đây, ở mục này. Lần chạy đầu tiên của dụng cụ ấy tìm
ra **một khối hỏng đang sống** trong `EnumSpellingContractTests.cs`, sinh ra ở `05a4f7a8`
(P-2 vòng 2) và có mặt ở **bảy** lần merge — liệt kê, chứ không nêu con số, vì chính con
số là chỗ vòng đầu sai (thiếu U-1): `f89da589` (P-2), `17fa6841` (Q-1), `79dbf99a` (R-1),
`7bb0c5bd` (S-1), `895c0c23` (T-1), `f18f5c29` (U-1), `46439925` (V-1). **Không lần nào
thấy nó.**

**Bằng chứng:** commit merge của W-1.

> ### 🔨 PHÁN QUYẾT 2026-08-18 — BẬT CỜ, VÀ KHÔNG MIỄN TRỪ GÌ CẢ
> **Quyết bởi chủ sở hữu.**
>
> #### 🔴 ĐIỀU PHẢI NÓI TRƯỚC MỌI ĐIỀU KHÁC: ĐÂY KHÔNG PHẢI MỘT TRONG BỐN LỰA CHỌN TRÊN
> Mục này công bố **bốn** lựa chọn có nhãn — **(a)**, **(b1)**, **(b2)**, **(c)**. Phán
> quyết **không phải cái nào trong bốn**. Nó là *bật cờ **và** không nhận một lệnh đè
> nào*, thứ mà cả bốn nhãn ấy đều không mô tả: **(c)** là không bật cờ, còn **(a)**,
> **(b1)** và **(b2)** đều **LÀ** một lệnh đè — chính mục này viết *"Cả (b1) và (b2) đều
> VẪN LÀ LỆNH ĐÈ"*.
>
> ⚠️ **Và nhãn `(a)` là chỗ nguy hiểm nhất trong cả file này để nhầm.** `(a)` là
> `<NoWarn>CS1591;CS1573</NoWarn>` **cả assembly** — **im lặng tối đa**, tức đúng **thái
> cực ngược lại** với điều vừa được quyết. Ai chép một nhãn từ chỗ khác vào đây sẽ thi
> hành **ngược** phán quyết. Phán quyết được ghi **bằng mô tả, không bằng nhãn**.
>
> 🔴 **Vòng đầu mục này nêu ba lựa chọn và bị bắt vì thiếu cái thứ tư — cái HẸP NHẤT. Hôm
> nay chủ sở hữu chọn một cái thứ NĂM, và nó cũng chưa từng được liệt kê.** Bảng bốn lựa
> chọn tự nhận là *"nêu đủ chứ không nêu cái tiện"*. Nó không đủ. Đây là **lần thứ hai**
> phép liệt kê lựa chọn của chính mục này bị chứng minh là thiếu, và lần này bằng chính
> câu trả lời của người quyết. Bốn lựa chọn ấy **được giữ nguyên văn** ở trên làm hồ sơ.
>
> #### CÁI GIÁ, VÀ NÓ KHÔNG PHẢI MỘT LẦN SỬA
> Phán quyết này **không** làm cờ bật được xanh, và mục này đã nói trước điều đó:
> *"không lựa chọn nào tự nó làm cờ bật được xanh"*. Chia đôi phần phải trả, bằng đúng
> các con số đã đo ở trên:
>
> - **532 cảnh báo là mã NGUỒN CỦA CHÍNH TA** (448 CS1591 + 84 CS1573). Chúng **trả bằng
>   cách VIẾT** — 532 chú thích tài liệu — cộng **101** khẳng định `cref`/`paramref` sai
>   phải **sửa** (75 CS1574 + 23 CS1734 + 3 CS0419). Tổng phần phải trả bằng tay: **633**,
>   đúng con số mục này đã nêu. Để so sánh về **quy mô, không phải về giá**: N-2 viết
>   **83** thành viên trong một nhiệm vụ (`72614dd9`). **Đây là NHIỀU VÒNG, không phải
>   một nhiệm vụ**, và file này nên nói thẳng thay vì để nó đọc như một lần dọn dẹp.
> - **103 cảnh báo nằm trong file SDK vendored** (95 CS1591 + 8 CS1573,
>   `examples/device-client/csharp/St4iDeviceClient.cs`). Dưới phán quyết này chúng
>   **không viết được** — repo này không được sửa file ấy — **và cũng không im lặng được**,
>   vì không miễn trừ nào được nhận. Chúng phải được **GHIM như một khoản nợ có tên và
>   không trả được**.
>
> **Đó là luật *"mọi cảnh báo hoặc được sửa, hoặc được nêu tên"* được tôn trọng — KHÔNG
> phải một lệnh đè.** Khác nhau ở chỗ kiểm được: một lệnh đè làm cảnh báo **biến mất**;
> một phép ghim để nó **phát ra** và bắt một con số đã công bố phải khớp, nên ngày nào nó
> đổi thì có thứ đỏ lên.
>
> #### CON SỐ CỔNG PHẢI ĐỔI, VÀ NÓ KHÔNG ĐƯỢC ĐỔI Ở ĐÂY
> `EXPECT_WARNINGS` hôm nay là **116** — đúng con số cổng vừa xanh trên. Dưới phán quyết
> này nó phải lên **ÍT NHẤT 219** (116 + 103 cảnh báo vendored không trả được). 🔴 **"Ít
> nhất" là một cận dưới, không phải một phép đo:** 219 chỉ đúng nếu **không** cảnh báo
> nào khác còn lại lúc con số ấy được đặt, mà 633 cái của ta chỉ tắt dần qua nhiều vòng.
> Con số thật **phải được ĐO tại lần bật cờ**, không được suy ra ở đây. Một cái trần nêu
> quá nhỏ còn tệ hơn không nêu trần.
>
> 🔴 **Lần ghi này KHÔNG đụng `scripts/verify-suites.sh`, KHÔNG đụng
> `Directory.Build.props`, và KHÔNG bật cờ.** Không dòng thực thi nào đổi vào ngày quyết
> định. **Việc còn nợ**, và nó là nhiều vòng.

### 📐 ĐỢT 1 ĐÃ ĐO — 2026-08-18, người đo AD-1. KHÔNG THI HÀNH GÌ; mục này Ở LẠI PHẦN II

**Đo tại `59bebd21`, SDK 10.0.302, `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild` từ
`tools/machine-simulator`, với cờ thêm TẠM THỜI vào `src/St4i.EdgeCore/St4i.EdgeCore.csproj`
rồi HOÀN NGUYÊN bằng `git checkout --`.** 15/15 compilation chạy, `0 Error(s)`. Cờ **không được
commit**, `EXPECT_WARNINGS` **vẫn 116**, không một cảnh báo nào được sửa, không một lệnh đè nào
được nhận. Toàn văn: `.superpowers/sdd/item12-stage1/task-1-report.md`.

#### 1. Con số thật — và nó KHÔNG phải 219

🔴 **Phán quyết trên viết *"nó phải lên ÍT NHẤT 219"*. Câu ấy đúng về TRẠNG THÁI CUỐI và hụt
633 về THỜI ĐIỂM BẬT.** Hai thời điểm khác nhau đã bị gộp làm một:

| thời điểm | `EXPECT_WARNINGS` phải là | nguồn |
|---|---:|---|
| **lúc bật cờ, chưa trả gì** | **852** | ĐO, hôm nay |
| sau khi trả xong cả 633 | **219** | 852 − 633, số học |

Chính câu của mục này áp lên chính con số của mục này: *một cái trần nêu quá nhỏ còn tệ hơn
không nêu trần*. Ai đọc "≥219" rồi bật cờ sẽ gặp **852**.

#### 2. Phép liệt kê theo nhóm TRẢ RIÊNG ĐƯỢC — liệt kê trước, con số sau

| nhóm | số | trả bằng |
|---|---:|---|
| **A. `cref`/`paramref` SAI** — 75 CS1574 + 23 CS1734 + 3 CS0419, ở **29 file** | **101** | **sửa** (đây là khẳng định đã sai, không phải chỗ trống) |
| **B. bao phủ, mã CỦA TA** — 448 CS1591 + 84 CS1573; A+B trải trên **90 file** | **532** | **viết** |
| **C. bao phủ, file SDK vendored** — 95 CS1591 + 8 CS1573, gọn trong `St4iDeviceClient.cs` | **103** | **không trả được — phải GHIM** |

852 − 116 = 736 = 101 + 532 + 103. Phép liệt kê khép kín, không dư một cái.

**Mọi con số mục này đã công bố đều TÁI LẬP CHÍNH XÁC** — 852, 736, 543, 92, 101, 448, 84,
**103**, 633, 532, 82 nullable trong file vendored. **Con số 103 KHÔNG trôi.** Chỗ duy nhất
trôi là con số **toàn cây** ở lựa chọn (c), đã rút tại chỗ ở trên.

🔴 **Một cái bẫy đếm chưa hồ sơ nào nêu:** 543 CS1591 nằm trên **532 vị trí** phân biệt, vì
**11 `record` positional** phát **hai** CS1591 tại cùng một vị trí (kiểu + constructor chính do
trình biên dịch sinh). **543 là số THÀNH VIÊN và đúng**; ai lập kế hoạch bằng vị trí sẽ đếm hụt 11.

#### 3. 🔴 633 KHÔNG được bảo toàn dưới phép trả — nên 219 là SÀN, và chạm sàn rẻ là thất bại

Đo trên một project rác ngoài repo, bốn ca, một build: một thành viên **không chú thích gì** phát
**1 CS1591 và KHÔNG CS1573**; viết `<summary>` **không kèm `<param>` nào** → **0 cảnh báo**; viết
`<summary>` + `<param>` cho **một trong hai** tham số → **1 CS1573 MỚI**. Nghĩa là:

- **trả một CS1591 có thể TẠO RA CS1573** ⇒ **không đợt nào được suy hằng số của mình bằng phép
  trừ; mỗi đợt phải ĐO LẠI**;
- **219 chỉ đạt được nếu mọi chú thích là "đủ tham số" hoặc "không tham số nào"**. Ca "chỉ
  `<summary>`" chạm 219 nhưng để lại bề mặt có tóm tắt mà tham số không ai tả — đúng loài *"chú
  thích bịa cho một trường chưa ai quyết nghĩa"* mà `Directory.Build.props` gọi là **một lời nói
  dối mới, không phải một phép sửa**.

*(Kênh "khối `///` hỏng che chẩn đoán bên trong" thì hôm nay **RỖNG** — kiểm bằng CS1570 = CS1587
= 0 trên cả hai bản build, và nó rỗng vì `DocCommentProseTests` của W-1 là khẳng định thường trực,
không phải vì may.)*

#### 4. Cơ chế "GHIM" mà phán quyết dựa vào, ở dạng KIỂM ĐƯỢC — và nó đòi HAI con số, không một

Phán quyết viết: *một lệnh đè làm cảnh báo biến mất; một phép ghim để nó phát ra và bắt một con
số đã công bố phải khớp.* Suy tiếp cho tới chỗ kiểm được:

> **Một cơ chế là NÊU TÊN, chứ không phải ĐÈ, khi và chỉ khi đặt thêm một lệnh đè lên trên nó
> làm cổng ĐỎ.** Dưới `<NoWarn>`, thêm một lệnh đè nữa không đổi gì. Dưới một phép ghim trên
> quần thể đã liệt kê, thả một `.editorconfig` cạnh file vendored đưa 103 về 0 ⇒ **đỏ, và nêu tên
> file cùng cả hai mã.**

Phép thử ấy **chạy được**, đúng kiểu cặp chứng-âm/chứng-dương N-1 đã chạy, và phải là tiêu chí
nghiệm thu của đợt cài cơ chế — không phải một lời hứa.

🔴 **Hệ quả: `EXPECT_WARNINGS` MỘT MÌNH KHÔNG phải một phép ghim đủ cho phán quyết này.** Nó là
một số vô hướng trên một HỢP, nên nó **mù trước phép triệt tiêu**: trả 3 chú thích trong mã của
ta trong khi một lần re-vendor thêm 3 CS1591 ⇒ tổng không dịch, cổng vẫn xanh, cả hai sự kiện
biến mất. Và phán quyết này **tạo ra đúng điều kiện ấy** — đợt 4 trở đi là một chuỗi dài các phép
giảm cố ý ở sổ của ta, cạnh một sổ có thể tăng. Nên **sổ phải tách đôi**: một cho 103 vendored,
một cho phần của ta. Nó đỏ được ba đường: re-vendor đổi thành viên; ai đó thêm lệnh đè (chỉ giảm
được — nên khẳng định phải là **đẳng thức, không phải trần**, đúng lý lẽ `verify-suites.sh` đã
viết); mã của ta thoái lui.

*(Hôm nay, nếu file vendored đổi: `DocCommentProseTests` đỏ nếu nó **đổi chỗ hoặc biến mất**, và
đỏ nếu re-vendor mang vào XML hỏng hay tên phần tử lạ. Nó **không** thấy một thành viên public
mới không chú thích. Sổ tách đôi đóng chỗ mù ấy.)*

#### 5. Kế hoạch chia đợt đề xuất — cơ chế TRƯỚC cờ, cờ TRƯỚC việc trả

| đợt | làm gì | `EXPECT_WARNINGS` |
|---|---|---:|
| **1** *(xong)* | ĐO. Không đổi một dòng thực thi. | 116 |
| **2** | 🔴 **[«Cài sổ theo mã» RÚT 2026-08-19 bởi AE-1 — sai, xem §7 ngay dưới bảng này; ô giữ nguyên văn làm hồ sơ]** **Cài sổ theo mã, cờ VẪN TẮT** — nâng phép kiểm đếm theo mã mà `verify-suites.sh` đã tính-mà-chỉ-in lên thành khẳng định, kèm cặp chứng âm/dương ở §4. Sửa luôn con số 237 còn sót ở `verify-suites.sh` và `Directory.Build.props`. | 116 |
| **3** | **THI HÀNH: bật cờ, không một lệnh đè nào.** Tách sổ, ghim riêng 103 vendored. | **852** (đo lại) |
| **4** | Trả **nhóm A**: 101 khẳng định SAI, 29 file. | đo lại |
| **5–8** | Trả **nhóm B** theo cụm file: hai file mô hình lớn (71 + 64) → `Config/*` → `Drivers/*` → phần còn lại. | đo lại; đích **219** |

Đợt **3 là đợt DUY NHẤT con số được TĂNG**; mọi đợt sau chỉ được giảm. Mục 12 **rời Phần II sang
Phần III ở cuối đợt 8**, kèm ghi chép thi hành ghi ngày — không sớm hơn.

**Một lựa chọn đã cân và BÁC:** "trả hết 633 rồi mới bật cờ, để con số nhảy thẳng 116 → 219".
Bác vì suốt các đợt ấy **cổng không canh gì cả** — và đợt này ĐO được rằng quần thể trôi khi
không có khẳng định canh nó: xem phép rút ở lựa chọn (c), 237 → 239 trong đúng merge cuối trước
base này.

#### 6. Chưa đo, nêu tên chứ không đoán
Bật cờ sinh `St4i.EdgeCore.xml` trong thư mục đầu ra. File ấy **có vào MSI hay không** do bản
harvest WiX quyết định, và AD-1 **không đo** — brief cấm dựng MSI, và `publish-desktop/engine/`
đang giữ dữ liệu một lần chạy thử. **Đợt 3 phải đo, không được suy.**
✅ **ĐÃ ĐO 2026-08-19 (AF-1), không dựng MSI và không đụng `publish-desktop/`: CÓ — nó vào MSI, và
ba file `.xml` anh em của nó ĐÃ vào từ trước mà không hồ sơ nào ghi. Xem §8 dưới.**

#### 7. Đợt 2 đã chạy — PHÉP ĐO, không phải thi hành (AE-1, 2026-08-19, base `3b773e11`)

**Cờ vẫn TẮT. Không một cảnh báo nào được trả. Không một lệnh đè nào được thêm.** Mục này **ở lại
Phần II**; đây là phép đo, không phải ghi chép thi hành.

🔴 **Ô "đợt 2" trong bảng §5 nói *"Cài sổ theo mã"*. Câu ấy được RÚT — dấu rút đặt TRONG chính ô ấy,
lý do ở đây — 2026-08-19, bởi AE-1, vì nó SAI và sai ngay hôm nay** — giữ nguyên văn trong ô làm hồ
sơ, đúng kiểu file này đã lập.

*(Bản đầu của câu này viết "RÚT **tại chỗ**" trong khi ô bảng **không mang dấu rút nào** và phép rút
nằm cách 23 dòng — phản biện bắt được, và nó là artefact **duy nhất** trong đợt này mà lời không
khớp việc. Nay dấu rút thật sự ở trong ô.)*

* **Trục MÃ không tách được hai quần thể.** Đo tại `3b773e11`: **CS8601 đứng 2 trong file vendored
  và 7 trong mã của ta; CS8604 đứng 1 và 14.** Một cuốn sổ theo mã **triệt tiêu được ngay hôm nay**.
  Bật cờ thì tệ hơn: CS1591 thành 95/2745 và CS1573 thành 8/374 — **đúng hai mã mà đợt 4..8 sẽ trả**.
* **Trục PROJECT cũng không**, vì file vendored **được compile VÀO `St4i.EdgeCore`**: cùng một
  project. Phép ghim *"101 nullable EdgeCore"* mà đợt 1 đề xuất là **một con số trong đó 82 vendored
  và 19 của ta triệt tiêu tự do**.
* Cái được cài là **(quần thể × mã)** — phân hoạch **thô nhất còn mịn hơn mọi đường biên chế tài mà
  mục này vạch ra**. Sống ngay hôm nay ở **82 vendored / 34 ours**, vì **82 trong 116 cảnh báo hiện
  tại đã nằm trong file vendored**.

🔴 **Và một phát hiện đổi hình dạng của lựa chọn (a):** một cuốn sổ đếm **CẢNH BÁO** — bất kể phân
hoạch mịn đến đâu — **chỉ thấy lệnh đè gỡ một cảnh báo ĐANG TỒN TẠI**. Khi cờ tắt, CS1591 và CS1573
đứng ở **0**. Đo sống trên cổng: thả một `.editorconfig` cạnh file vendored miễn trừ **cả 103 cái**
⇒ `EXPECT_WARNINGS` **116, xanh**; sổ tách-gốc **không dịch một hàng, xanh**. Hệ quả, và nó là lý do
đợt 2 giao **hai** dụng cụ chứ không một:

> **Lựa chọn (a) — `<NoWarn>$(NoWarn);CS1591</NoWarn>` trên `St4i.EdgeCore` — có thể được thi hành
> TRƯỚC, ÂM THẦM, bởi bất kỳ ai, ở bất kỳ lúc nào giữa hôm nay và đợt 3.** Nó không dịch một con số
> nào trong repo này, rồi bịt **543** cảnh báo vào đúng ngày cờ được bật.

Nên `tests/St4i.EdgeCore.Tests/SuppressionCensusTests.cs` khẳng định trên **CHỈ THỊ** thay vì trên
**CHẨN ĐOÁN**, và quét cả **chuỗi tổ tiên của file vendored tới gốc repo** — chỗ mà chính mục này đã
đo là lựa chọn (b) phải được đặt, và chỗ **không dụng cụ nào khác của repo này với tới**. Nó ghim
thêm **bảng công tắc `GenerateDocumentationFile`, 7 bật / 8 tắt**, vì chiều **NGƯỢC** cũng không ai
canh: tắt công tắc trên một trong bảy **gỡ một khẳng định và làm dịch đúng số KHÔNG cảnh báo**.

**Cặp đối chứng đã chạy hai phía trên cổng thật**, và transcript nằm trong
`.superpowers/sdd/item12-stage2/task-1-report.md`.

**Đợt 3 vì thế không phải cài cơ chế nào nữa — nó dời hai cái bảng.** Đo được, không hứa: đúng hàm
ấy, không sửa một ký tự, chạy trên log chẩn đoán bật cờ, tách cả cây thành **185 vendored / 3414
ours**, bucket vendored nhận **đúng 103 cái không ai trả được**.

🔴 **Một con số của mục này đã trôi, và đúng một:** *"237 toàn cây"* → **239** (đã rút ở lựa chọn (c)
bởi AD-1). AE-1 tái lập nó tại `3b773e11` và rút **năm** dấu — `verify-suites.sh` hai chỗ,
`Directory.Build.props` ba chỗ; đợt 1 kê **ba**. 🔴 *(Bản đầu của câu này viết "**bốn**" trong khi
phép liệt kê ngay bên nó có năm hàng. Phản biện bắt được, và nó là **đúng khuyết tật câu này đang tố
cáo**, lệch một ô: liệt kê trước, con số viết sau.)* Mọi con số khác
của mục này (`852` theo số học, `736`, `543`/`532`, `103`, `82`, `633`, `101`) **không trôi**. Và
điều đáng chú ý hơn con số: **con số duy nhất đã dịch là con số duy nhất không có khẳng định nào
canh.**

#### 8. 🔨 ĐỢT 3 — PHÁN QUYẾT ĐÃ THI HÀNH **MỘT PHẦN** (AF-1, 2026-08-19, base `6243bb94`)

🔴 **Đây là một ghi chép THI HÀNH TỪNG PHẦN, không phải ghi chép hoàn thành. Mục 12 Ở LẠI PHẦN II.**
Cờ đã bật; **633 cảnh báo của ta chưa trả một cái nào.** Một cờ bật trên một món nợ còn mở là một
phần của phán quyết, không phải cả phán quyết.

**Việc đã làm, và chỉ đúng chừng đó:**
`<GenerateDocumentationFile>true</GenerateDocumentationFile>` được thêm vào
`src/St4i.EdgeCore/St4i.EdgeCore.csproj` — **một project, đúng project phán quyết nêu tên**, không
một lệnh đè nào, không một chú thích nào được viết, không một `cref` nào được sửa. Năm project trong
`src/` đã bật sẵn từ N-1/N-2 **không bị đụng**; bảy project còn tắt **vẫn tắt**, và bật thêm bất kỳ
cái nào là một quyết định của chủ sở hữu mà mục này **không** cho phép.

**Con số thật — ĐO, không suy.** `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild` toàn bộ
solution, SDK 10.0.302, 15/15 compilation, `Build succeeded.`, `0 Error(s)`:

| | |
|---|---:|
| `EXPECT_WARNINGS` trước | 116 |
| **`EXPECT_WARNINGS` sau, ĐO tại `6243bb94` + commit này** | **852** |

Liệt kê trước, tổng sau — mọi mã trong bản build này:
`CS1591 543` · `CS1573 92` · `CS1574 75` · `CS8625 37` · `CS8618 35` · `CS1734 23` · `CS8604 15` ·
`CS8601 9` · `NU1701 9` · `CS8600 5` · `CS0419 3` · `CS8603 2` · `CS8767 2` · `xUnit2029 1` ·
`xUnit1013 1` = **852**. Phần cờ thêm vào: 543 + 92 + 75 + 23 + 3 = **736**, toàn bộ nằm trong
compilation `St4i.EdgeCore`; 116 cái cũ **không dịch một mã nào**.

🔴 **852 KHÔNG lệch khỏi 852 của đợt 1 — và chỗ "không lệch" ấy chính là phát hiện, không phải sự
vắng mặt của một phát hiện.** Đợt 1 công bố 852 tại `59bebd21` bằng **số học trên hai phép đo**
(837 + 15); đợt 2 nói rõ nó **chưa từng được đo trực tiếp**. Đây là lần đầu 852 là con số **của
chính cây này**, và **hai merge** (AC-1, AE-1) nằm giữa hai phép đo mà **không dịch một cái nào**.
Tái lập chính xác cùng lúc: `543` · `92` · `101` cref-class trong project này · `448`+`84` của ta ·
`95`+`8`+`82` trong file vendored · `633`.

**Sổ tách-gốc, sau khi dịch — 19 hàng, hai bucket:**

| bucket | hàng | tổng |
|---|---|---:|
| **VENDORED** (`examples/device-client/csharp/St4iDeviceClient.cs`) | CS1573 8 · **CS1591 95** · CS8600 5 · CS8601 2 · CS8603 2 · CS8604 1 · CS8618 35 · CS8625 37 | **185** |
| **OURS** | CS0419 3 · CS1573 84 · CS1574 75 · CS1591 448 · CS1734 23 · CS8601 7 · CS8604 14 · CS8767 2 · NU1701 9 · xUnit1013 1 · xUnit2029 1 | **667** |

**185 + 667 = 852.** Bảy hàng mới (5 OURS + 2 VENDORED); **không một hàng nào trong mười hai hàng cũ
đổi giá trị** — đó là phép kiểm rằng cờ chỉ với tới đúng một compilation.

🔴 **103 CÁI KHÔNG AI TRẢ ĐƯỢC NAY HIỆN RA VÀ ĐƯỢC GHIM** — `VENDORED CS1591 95` + `VENDORED CS1573
8`, ghim làm **đẳng thức hai chiều**. Chúng **giảm** là một lệnh đè hoặc một lần re-vendor, **không
bao giờ** là một phép sửa; hạ cái ghim cho khớp **chính là cách một món nợ thôi được nêu tên**.

**Đối chứng — cuốn sổ đợt 2 đã bắt được đúng việc này, TRƯỚC khi bảng được dời.** Cờ bật trước,
`SuppressionCensusTests` chạy trên bảng chưa sửa: **1 fail / 4 pass**,
`TheDocumentationSwitchIsSetOnExactlyTheseProjects`, nêu đích danh `St4i.EdgeCore.csproj` ở `"on"`
đối lại kỳ vọng `"off"`. Bảng công tắc nay là **8 bật / 7 tắt** (cộng project mẫu của SDK vendored).

🔴 **VÀ MỘT PHÉP ĐO CHƯA AI LÀM — mục 6 ở trên hỏi, đây là câu trả lời: CÓ, FILE XML VÀO MSI.**
Đo **không** dựng MSI và **không** đụng `publish-desktop/`:
1. cờ sinh `St4i.EdgeCore.xml` (**1,3 MB, 959 `<member>`**) và .NET chép nó vào đầu ra của **mọi**
   project tiêu thụ — 11 bản trong cây sau một lần build;
2. `dotnet publish` của `St4i.EngineApi` (đúng lệnh `build-installer.ps1` chạy, chỉ đổi `-o` sang
   một thư mục nháp ngoài repo) để `St4i.EdgeCore.xml` **nằm rời cạnh exe single-file**;
3. `St4i.Installer.wixproj` harvest **cả thư mục** `publish-desktop/**`, và
   `exclude-shell-and-engine-exe.xslt` loại **đúng hai tên `.exe`** — không lọc theo đuôi.
   🔴 **Hai mắt xích chịu lực này ĐƯỢC GIT THEO DÕI và tra lại được.** Mắt xích thứ ba thì
   **không**, và bản đầu của mục này gọi sai tên nó: bản harvest
   `packaging/installer/obj/x64/Release/_HarvestedFiles_dir.wxs` **KHÔNG được commit** — nó bị
   `tools/machine-simulator/.gitignore:2` (`obj/`) loại, `git ls-files --error-unmatch` thất bại,
   và mtime của nó là **2026-07-28**. 🔴 *Câu **"bản harvest đã commit"** được RÚT 2026-08-19 bởi
   chính AF-1 sau vòng phản biện 1.* Đọc đúng là: **đo trên bản harvest còn sót trong `obj/` từ lần
   dựng MSI ngày 2026-07-28, không được git theo dõi, một `git clean -xdf` sẽ xoá nó.** Nội dung
   thì đã đếm: **63** phần tử `<File`, **ba** `.xml` (đều của WebView2), có
   `engine\St4i.EdgeCore.pdb`, **không** `.exe` nào (transform đã áp). Nó là **mẫu minh hoạ**, không
   phải mắt xích chịu lực — kết luận đứng trên `.wixproj` + `.xslt`, cả hai đều tra lại được.

⇒ **`St4i.EdgeCore.xml` sẽ được cài vào `INSTALLFOLDER\engine\`. Đó là một artefact mới giao cho
khách hàng.**

🔴 **VÀ CÂU HỎI GIAO CHO ANH RỘNG HƠN "BỐN FILE `.xml`" — bản đầu của mục này nêu HẸP HƠN phép đo
của chính nó, đã sửa 2026-08-19.** Harvest lấy **cả thư mục**, nên nó cài **mọi** artefact phụ, chứ
không riêng loại tôi đang nói tới. **Liệt kê trước, đếm sau** — mọi thứ như thế đang nằm trong
`publish-desktop/` hôm nay:

| file | loại | ai sinh |
|---|---|---|
| `Microsoft.Web.WebView2.Core.xml` · `…WinForms.xml` · `…Wpf.xml` | tài liệu | vendor; **đã** trong bản harvest 63-file |
| `St4i.DesktopShell.xml` | tài liệu | của ta, N-1/N-2 |
| `engine/St4i.Connector.Abstractions.xml` | tài liệu | của ta, N-2 |
| `engine/St4i.EdgeCore.Serial.xml` | tài liệu | của ta, N-1 |
| `St4i.DesktopShell.pdb` · `engine/St4i.Connector.Abstractions.pdb` · `engine/St4i.EdgeCore.Serial.pdb` · `engine/St4i.EdgeCore.pdb` · `engine/St4i.EngineApi.pdb` | **ký hiệu gỡ lỗi** | của ta |

**Đếm sau: 6 `.xml` + 5 `.pdb` = 11 artefact phụ đang được cài hôm nay. Sau đợt 3 là 7 + 5 = 12.**

Nên câu đúng để hỏi anh **không** phải *"bốn file `.xml`"* mà là: **ta có giao artefact build —
tài liệu `.xml` và ký hiệu `.pdb` — cho khách hàng không, trên mười hai file?** 🔴 **Năm file
`.pdb` là CÙNG một câu hỏi và nhạy hơn `.xml` về dịch ngược**, và bản đầu của mục này bỏ hẳn chúng
— có nêu tên `St4i.EdgeCore.pdb` nhưng **chỉ làm bằng chứng cho cơ chế**, không bao giờ làm **một
phần của câu hỏi**. Nêu tên chứ không quyết — nhưng nêu tên **hết**, vì một câu hỏi hẹp hơn phép đo
đứng sau nó cũng là một cách để món nợ không được nêu tên đầy đủ.

**Việc còn nợ, nêu tên chứ không làm:**
* **633 chưa trả** (101 khẳng định `cref`/`paramref` đã SAI + 532 chỗ trống bao phủ trên 90 file).
  Đợt 4 trả nhóm 101; đợt 5–8 trả phần còn lại. **Mỗi đợt ĐO LẠI hằng số của mình** — 633 không bảo
  toàn dưới phép trả, nên `OURS CS1573 84` được chờ đợi là **TĂNG** giữa chừng.
* **Mười hai artefact phụ đang đi vào bản cài** (7 `.xml` + 5 `.pdb` sau đợt này; 6 + 5 hôm nay) —
  chưa ai quyết, và mười một trong mười hai đã đi từ trước đợt này.
* **Không dụng cụ nào canh PAYLOAD.** Nửa A đọc **log build**, nửa B đọc **khai báo trong cây
  nguồn** — cả hai là dụng cụ về **cây nguồn**. Câu hỏi về cái được cài đòi một dụng cụ **thứ ba**,
  và dựng nó đòi một `publish-desktop/` sạch cùng một lần dựng MSI, tức một brief khác.
* **`EXPECT_WARNINGS = 852` là một vô hướng YẾU HƠN HẲN 116**, vì hợp mà nó tóm tắt nay lớn gấp bảy.
  Thứ giữ cho nó có nghĩa là **đẳng thức theo (quần thể × mã)**, không phải bản thân nó.

---

#### 9. 🔨 ĐỢT 4 — PHÁN QUYẾT VẪN ĐANG THI HÀNH **TỪNG PHẦN** (AG-1, 2026-08-19, base `3e001642`)

🔴 **Đây vẫn là một ghi chép THI HÀNH TỪNG PHẦN. Mục 12 Ở LẠI PHẦN II.** 101 trong 736 đã trả;
**635 còn nợ** (532 chỗ trống của ta + 103 cái vendored không ai trả được).

**Việc đã làm, và chỉ đúng chừng đó:** **101 khẳng định ĐÃ SAI được TRỎ LẠI CHO ĐÚNG** — 75 CS1574
+ 23 CS1734 + 3 CS0419, trên **29 file**, tất cả trong `src/St4i.EdgeCore`. **Không một dòng mã nào
bị đụng**, và dạng kiểm được của câu ấy là một số **KHÔNG**, không phải một tổng: trên
`3e001642..HEAD`, `git diff -- .../src | grep '^[+-]' | grep -v '///'` trả về **RỖNG**, cả hai chiều.
Diff thô là **106** dòng `///` thêm và **99** dòng `///` bớt. Không một `cref` nào bị **xoá** để cảnh
báo biến mất; không một lệnh đè nào; không tắt cờ ở đâu. Nhiệm vụ thứ **mười sáu** liên tiếp không có
lệnh đè, và `SuppressionCensusTests` **không dịch một hàng** (5/5 xanh, vẫn 5 file / 8 chỉ thị /
CS0618 + CS0162).

> 🔴 **RÚT 2026-08-19, bởi chính AG-1, một commit sau.** Câu đầu của đoạn này viết *"cả **96** dòng
> thay đổi trong `src/` đều bắt đầu bằng `///`"*. **96 đã được ĐO** — rồi **bốn** lần sửa nữa được
> thực hiện (hai dòng quá dài được xuống hàng, một câu được thêm thành viên sở hữu tham số của nó, một
> đoạn được dàn lại) và con số **không được đo lại** trước khi nó được viết vào **ba** file. Đây là luật
> *"LIỆT KÊ trước, con số viết SAU"* hỏng **lần thứ tám** trong loạt này. Điều đáng học nằm ở **con số
> nào sai**: khẳng định chịu lực là **"KHÔNG có dòng nào không phải `///`"**, và chính nó được đo
> **sau cùng** và **đúng**. Một tổng số dòng chưa bao giờ là khẳng định — nó là đồ trang trí đã vượt
> quyền bằng chứng của chính nó. **Ưu tiên con số không.**

**Con số thật — ĐO, không trừ.** `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild` toàn bộ
solution, SDK 10.0.302, 15/15 compilation, `Build succeeded.`, `0 Error(s)`:

| | |
|---|---:|
| `EXPECT_WARNINGS` trước | 852 |
| **`EXPECT_WARNINGS` sau, ĐO** | **751** |

`852 − 101 = 751` là **số học** và nó **khớp** phép đo — sự khớp ấy được **báo cáo như một kết quả**,
không được dùng **thay** phép đo. Kênh làm phép trừ mất an toàn (trả một CS1591 bằng `<summary>` +
**một phần** `<param>` sinh ra một CS1573) **rỗng ở đợt này theo cấu tạo**: đợt này **không viết** một
`<summary>` hay `<param>` nào, chỉ **trỏ lại** các tham chiếu trong những khối đã có sẵn.

**Sổ tách-gốc, sau khi dịch — 19 hàng → 16 hàng:**

| bucket | hàng | tổng |
|---|---|---:|
| **VENDORED** (`examples/device-client/csharp/St4iDeviceClient.cs`) | CS1573 8 · CS1591 95 · CS8600 5 · CS8601 2 · CS8603 2 · CS8604 1 · CS8618 35 · CS8625 37 | **185** |
| **OURS** | CS1573 84 · CS1591 448 · CS8601 7 · CS8604 14 · CS8767 2 · NU1701 9 · xUnit1013 1 · xUnit2029 1 | **566** |

🔴 **Ba hàng `OURS CS1574 75` / `OURS CS1734 23` / `OURS CS0419 3` bị XOÁ KHỎI SỔ, không đặt về 0** —
bộ phân loại của cổng chỉ phát ra hàng cho cặp `(bucket, mã)` nó **quan sát được**, nên một mã về 0
**không sinh hàng nào**. Một dòng `OURS CS1574 0` để lại sẽ làm cổng ĐỎ. **Giá của phép xoá ấy được
NÊU TÊN chứ không giấu**, và nó đúng là cái giá mà chính đợt 2 đã dự báo: từ hôm nay, một lệnh đè
nhắm CS1574 **vô hình** với nửa A. Nửa B (`SuppressionCensusTests`) là thứ còn thấy nó — đó là lý do
có hai nửa.

🔴 **Tám hàng VENDORED KHÔNG dịch một đơn vị**, và `OURS CS1591 448` / `OURS CS1573 84` cũng không —
hai phép kiểm ấy là điều đợt này **phải vượt qua**, không phải một quan sát dễ chịu.

🔴 **MỘT DỰ BÁO CỦA BRIEF BỊ PHÉP ĐO BÁC, và đó mới là phát hiện.** Brief chờ đợi 23 CS1734 là những
**chữ ký đã trôi khỏi chú thích của chính chúng** (một tham số bị đổi tên hoặc bị bỏ). **Đo: KHÔNG
MỘT CÁI NÀO trong 23.** Cả 23 gọi tên một tham số **có thật, viết đúng chính tả**, trên một
constructor hoặc method của **chính kiểu ấy**; cả 23 nằm trong khối `///` **mức KIỂU**, nơi C# không
có phạm vi tham số nên `<paramref>` **không thể** phân giải dù nó gọi tên gì. Đây là lỗi **PHẠM VI**,
đồng nhất, **không phải lỗi TRÔI**. **Không một chữ ký nào trong project này đã trôi khỏi tài liệu
của chính nó.**

🔴 **Và 38 trong 75 CS1574 có CHUNG một nguyên nhân, đáng giá hơn con số.** `cref="Models.X"` **đúng**
bên trong `St4i.Connector.Abstractions` (ở đó `Models` gắn vào namespace con của chính assembly ấy) và
đã được chép **nguyên văn** sang năm file dưới `St4i.EdgeCore.Drivers`, nơi `Models` gắn vào
`St4i.EdgeCore.Models` — một namespace **có thật** và **không chứa một kiểu nào trong số đó**. Cách
viết ấy **phân giải được ở một bên ranh giới project và hỏng lặng lẽ ở bên kia**. Đúng loài mục 12 nói
là vô hình với mọi dụng cụ đo VĂN BẢN, và là thứ cờ được bật để nhìn thấy.

> 🔴 **VÒNG PHẢN BIỆN (2026-08-19) ĐỔI MỘT Ô TRONG PHÂN LOẠI KẾT CỤC, và phản biện ĐÚNG.** Bản đầu xếp
> `BridgeSpool.cs:73`/`:82` vào *"đích **chưa bao giờ tồn tại**"* và viết *"không có `MaxBytes`"*.
> **`BridgeSpoolOptions.MaxBytes`/`.MaxAgeHours` CÓ THẬT**, công khai, và **chính là cái cap ấy** —
> `St4i.EngineApi/Program.cs` truyền đúng hai giá trị đó vào ctor. Câu của tôi chỉ đúng khi **thu hẹp vào
> lớp `BridgeSpool`** và **không nói ra sự thu hẹp ấy**. Đã trỏ lại bằng cref đủ tên, **được trình biên
> dịch kiểm**. Phân loại: **63 trỏ lại / 15 bỏ trỏ / 23 lỗi phạm vi**, thay cho 61 / 17 / 23.
> Con số cảnh báo **không dịch**: đo lại sau phép sửa, vẫn **751**, sổ vẫn **185 / 566**.

**Việc còn nợ sau đợt này, nêu tên chứ không làm:**
* **532 chỗ trống bao phủ trên 90 file** (448 CS1591 + 84 CS1573) — đợt 5–8. **Mỗi đợt đo lại.**
* **103 cái vendored** — không ai trả được, ghim làm đẳng thức hai chiều, **phải ở nguyên đó**.
* **Mười hai artefact phụ trong bản cài** — chưa ai quyết, y như sau đợt 3.
* **Không dụng cụ nào canh PAYLOAD** — y như sau đợt 3.
* 🔴 **Ba mã nay đứng ở 0 nên nửa A mù trước một lệnh đè nhắm chúng** — chỉ nửa B thấy. Đây là một
  chỗ hở **mới xuất hiện cùng đợt này**, được nêu tên tại chỗ trong cả hai file cơ chế.

#### 10. 🔨 ĐỢT 5 — PHÁN QUYẾT VẪN ĐANG THI HÀNH **TỪNG PHẦN** (AH-1, 2026-08-19, base `f28744eb`)

🔴 **Vẫn là một ghi chép THI HÀNH TỪNG PHẦN. Mục 12 Ở LẠI PHẦN II.** 221 trong 736 đã trả;
**515 còn nợ** (412 chỗ trống của ta + 103 cái vendored không ai trả được).

🔴 **Đây là đợt ĐẦU TIÊN trả bằng cách VIẾT, nên sản phẩm giao ra CHÍNH LÀ hàng trăm khẳng định mới.**
Luật đợt này làm việc dưới nó: *một `<summary>` chỉ diễn đạt lại cái TÊN thì không phải một lần trả*;
chỗ nào thật sự không có gì để nói ngoài cái tên thì đó là **một phát hiện phải nêu**, không phải một
ô trống để lấp.

**CỤM ĐÃ CHỌN, và lý do là một phép ĐO chứ không phải một sở thích:** **mô hình dữ liệu config-sync** —
**bảy kiểu mà CÁCH VIẾT TÊN THÀNH VIÊN của chúng là một chuỗi đã công bố ra ngoài repo này.**
`src/St4i.EngineApi/Config/LiveConfigSyncWireDtos.cs` khai báo `MeasurementPoint` và `Fiducial`
**CHÍNH LÀ hình dạng wire** của `get-points` / `delta-sync-points` từ máy chủ SYNAPSE thật (chính sách
camelCase, **không có DTO trung gian**); `LightingShot` đi bên trong một điểm; còn `ProductModel`,
`ProductVariant`, `VariantPointOverride`, `Recipe` là hình dạng của `products.json` / `recipes.json`
— đúng hai file mà `scripts/verify-suites.sh` **đã miễn trừ theo TÊN** khỏi phép canh thư mục đầu ra
vì người vận hành sửa tay chúng. Mỗi **thành viên enum** được trả đều nêu **đúng token nó tuần tự hoá
thành**, và `ConfigJsonConverters` dựng các converter ấy với `allowIntegerValues:false` — nghĩa là
**cách viết CHÍNH LÀ toàn bộ hợp đồng**, một giá trị số là một lỗi đọc cứng. Đó là **luật P-2 áp vào
chỗ người đọc là máy chủ của một công ty khác**. Các **store và converter** quanh cụm này **vốn đã
được lập tài liệu đầy đủ** và không phát một cảnh báo nào; **chỉ có DỮ LIỆU đi qua ranh giới là chưa
ai tả**.

| file | số |
|---|---:|
| `Config/MeasurementPoint.cs` | 64 |
| `Config/ProductModel.cs` | 17 |
| `Config/LightingShot.cs` | 12 |
| `Config/Fiducial.cs` | 11 |
| `Config/Recipe.cs` | 8 |
| `Config/ProductVariant.cs` | 4 |
| `Config/VariantPointOverride.cs` | 4 |
| **tổng** | **120** |

**Con số thật — ĐO, không trừ.** `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild` toàn bộ solution,
SDK 10.0.302, 15/15 compilation, `Build succeeded.`, `0 Error(s)`:

| | |
|---|---:|
| `EXPECT_WARNINGS` trước | 751 |
| **`EXPECT_WARNINGS` sau, ĐO** | **631** |

`751 − 120 = 631` là **số học** và nó **khớp** phép đo — khớp ấy được báo cáo **như một kết quả**.
🔴 **Bản `-t:Rebuild` ĐẦU TIÊN của cây này phải BỎ ĐI và chạy lại:** nó báo **7 lỗi / 14 compilation**,
và **cả 7 đều là CS2001 bên trong một project `*_wpftmp`** — đúng cái điều kiện chạy lại mà chính hồ
sơ của repo này đã nêu tên. Lần chạy lại: 15/15, `0 Error(s)`, **631**.

**Sổ tách-gốc — MỘT hàng dịch, và chỉ một: `OURS CS1591 448 → 328`.** Vẫn **16 hàng** (không mã nào
về 0 nên không hàng nào bị xoá). **VENDORED 185 / OURS 446 = 631.**

🔴 **`OURS CS1573 84` KHÔNG dịch, và LÝ DO quan trọng hơn sự kiện.** Đợt 1 đo được rằng trả một
CS1591 bằng `<summary>` + **một phần** `<param>` **sinh ra** một CS1573, và cảnh báo rằng đợt 5–8 là
các đợt **viết**. Nó không nổ ở đây vì **không một thành viên nào trong 120 cái có tham số**: 118
property và thành viên enum, cộng hai method `BumpVersion()` **không tham số**. Nên **đợt này KHÔNG
làm giảm rủi ro ấy cho đợt 6–8 — nó chưa từng mở kênh ấy ra.** Đợt đầu tiên lập tài liệu cho một
thành viên **CÓ tham số** vẫn là đợt đầu tiên có thể làm CS1573 **TĂNG**.

🔴 **Tám hàng VENDORED không dịch một đơn vị** — phép kiểm rằng không file vendored nào bị đụng.

🔴 **DẠNG KHẲNG ĐỊNH VỀ DIFF ĐỔI HÌNH Ở ĐÂY, và đó là chuyện CẤU TRÚC chứ không phải cẩu thả.**
Đợt 4 nói được *"KHÔNG dòng thay đổi nào không phải `///`"*. Một đợt lập tài liệu cho **THÀNH VIÊN
ENUM** thì **không thể**: một khối `///` không gắn được vào thành viên nằm trong khai báo một dòng
`public enum X { A, B }`, nên trả những cảnh báo ấy **buộc phải** dàn lại khai báo. **Bảy** khai báo
đã bị dàn lại. Câu còn đứng được là một **số KHÔNG hẹp hơn**: ngoài các dòng `///`, dòng trống, **một**
khối `//` ba dòng và **bảy** lần dàn lại dấu ngoặc/dấu phẩy ấy, **KHÔNG dòng nào thay đổi** — và **cả
bảy dãy thành viên enum giống hệt nhau, đúng tên, đúng thứ tự**, điều đáng kể vì **thứ tự enum chính
là giá trị nền**. **Không một câu lệnh thực thi nào bị đụng.** Đợt 6–8 nào lập tài liệu cho enum sẽ
gặp đúng chuyện này.

🔴 **VÒNG PHẢN BIỆN BÁC 17 TRONG 120 CÂU, VÀ ĐÓ MỚI LÀ KẾT QUẢ THẬT CỦA ĐỢT 5.** Phản biện lấy mẫu
**48** câu và tìm **17 câu SAI** (~35%) — **không dụng cụ nào trong cây này thấy một cái nào**: cổng
xanh, W-1 xanh, mọi hàng sổ tái lập chính xác, `EXPECT_WARNINGS` không nhúc nhích. **Mười hai cái có
CHUNG một nguyên nhân:** file seed được đọc tới điểm thứ năm rồi dừng, và các **phủ định tồn tại**
(*"không seed nào đặt"*, *"unused"*) được viết phủ lên **chín điểm chưa bao giờ mở**. Hai cái nữa là
một cuộc kiểm đếm caller viết mà **không chạy grep**, rồi **chép sang file thứ hai** — một lệnh không
chạy đẻ ra hai khẳng định sai. **Một phép LẤY MẪU mặc áo một phép KIỂM ĐẾM**, đúng hình dạng bài học
lần thứ chín của đợt 4, ở một lớp cao hơn.

**Vòng sửa THUẦN VĂN XUÔI đã sửa 39 trong 120 câu** dưới **hai luật máy móc** — mọi khẳng định về một
**quần thể** phải được **liệt kê bằng dụng cụ** trước khi bị phủ định bằng tay; mọi **tập/khoảng quan
sát được** phải **trích tự động** thay vì nhớ lại. Phân loại: **17 sai hẳn · 8 mạo từ xác định trên
tập không đầy đủ · 4 chỉ diễn đạt lại cái tên · 2 vượt bằng chứng · 1 nêu cơ chế cây này chưa từng
chạy · 7 quá mỏng**. 🔴 Câu *"0 ca chỉ có cái tên"* của bản đầu **là SAI** — đúng **bốn** ca.
**Không một dòng cơ khí nào bị đụng lại:** enum, sổ, `EXPECT_WARNINGS` 631, tổng 2763 đều y nguyên.
Hai luật ấy và phát hiện *"một khối `//` mới là văn xuôi không dụng cụ nào canh"* được ghi vào
`scripts/verify-suites.sh` cạnh khối đợt 5, nơi đợt 6–8 đọc.

**Việc còn nợ sau đợt 5, nêu tên chứ không làm:**
* **412 chỗ trống bao phủ của ta** (328 CS1591 + 84 CS1573) — đợt 6–8. **Mỗi đợt đo lại.**
  > 🔴 **RÚT 2026-08-20 (AL-1, đợt 6).** Đúng với cây của AH-1; **283** còn nợ hôm nay (243 CS1591
  > + 40 CS1573) — xem §11. Giữ nguyên văn, không xoá.
* **103 cái vendored** — không đổi, phải ở nguyên đó.
* **Mười hai artefact phụ trong bản cài**, **không dụng cụ nào canh PAYLOAD**, **nửa A mù trước một
  lệnh đè nhắm ba mã đã về 0** — cả ba y như sau đợt 4, không cái nào được đợt này đụng tới.
* 🔴 **Bốn quan sát về MÃ mà đợt này DỪNG LẠI để báo thay vì tự sửa** — xem
  `.superpowers/sdd/item12-stage5/task-1-report.md` §7. Không cái nào được sửa, không cái nào được mở
  thành mục. **Nửa UX của quan sát (3) là HÌNH DẠNG CHỦ SỞ HỮU** (27 trường người vận hành sửa được mà
  kênh đẩy không mang; huy hiệu drift chuyển vàng; cách chữa tự động duy nhất là một lần kéo **xoá**
  luôn sửa đổi) — brief nói *"dừng và báo"*, **không nói "mở mục"**, nên nó **được báo và KHÔNG được
  mở**. Nhãn cũ gọi nó là *"không phải việc của đợt này"* và **đã bị rút**: phân loại sai làm người
  đọc xếp nó chung với ba quan sát kỹ thuật kia.
* 🔴 **`HistorianResultRecord` — 23 tham số, một `<param>`, 22 CS1573 ĐANG SỐNG.** Nhân chứng do phản
  biện tìm ra cho cái bẫy §5: cờ **im lặng tuyệt đối** khi một `record` positional có `<summary>` và
  **0** `<param>`, nhưng **nổ hết một lượt** khi có **một** thẻ thiếu. Đợt 6–8 nên dùng nó làm ca
  kiểm chứng.
  > ✅ **ĐÃ DÙNG, 2026-08-20 (AL-1, đợt 6).** `HistorianResultRecord` nằm trong cụm đợt 6 và cả 22
  > CS1573 ấy **đã trả**. Ca kiểm chứng chạy đúng như phản biện đợt 5 dự đoán — và nó còn cho một
  > mặt thứ hai mà dự đoán ấy không có: xem §11.

---

#### 11. 🔨 ĐỢT 6 — PHÁN QUYẾT VẪN ĐANG THI HÀNH **TỪNG PHẦN** (AL-1, 2026-08-20, base `bcbd29dc`)

🔴 **Vẫn là một ghi chép THI HÀNH TỪNG PHẦN. Mục 12 Ở LẠI PHẦN II.** 350 trong 736 đã trả;
**386 còn nợ** (283 chỗ trống của ta + 103 cái vendored không ai trả được).

**CÁC ỨNG VIÊN ĐÃ CÂN, LIỆT KÊ TRƯỚC KHI NÊU CON SỐ CỦA CỤM ĐƯỢC CHỌN.** 412 cái còn nợ được nhóm
theo thư mục, **trọn vẹn**, từ một lần `-t:Rebuild` của `St4i.EdgeCore`:

| thư mục | số | | thư mục | số |
|---|---:|---|---|---:|
| `Historian/` | 97 | | `Site/` | 12 |
| `Config/` | 50 | | `Engine/` | 11 |
| `Drivers/Modbus/` | 46 | | `Fleet/` | 8 |
| `Models/` | 42 | | `Drivers/Mqtt/` | 7 |
| `Transport/` | 38 | | `Drivers/HotFolder/` | 7 |
| `Drivers/Simulators/` | 27 | | `Uns/Sparkplug/` | 6 |
| `Uns/` | 19 | | `Infrastructure/` | 6 |
| `Drivers/OpcUa/` | 17 | | `Drivers/` | 5 |
| `Mapping/` | 13 | | `Metrics/` | 1 |

🔴 **TIÊU CHÍ CHỌN CỤM CỦA ĐỢT 5 ĐÃ ĐƯỢC CÂN VÀ KHÔNG DÙNG LẠI.** Tiêu chí ấy — *"bề mặt một tác
giả driver hoặc một bên tích hợp chạm vào trước"* — trên phần dư này trỏ vào **họ driver dựng sẵn**
(Modbus + OpcUa + Mqtt + HotFolder + Simulators + `SimulatedDriver` = **109**). Nhưng bề mặt hợp
đồng **đã xuất bản** của họ ấy là `St4i.Connector.Abstractions`, và **N-2 đã trả trọn 95 cái ở đó**;
thứ còn lại trong `St4i.EdgeCore` là **ống nước nội bộ của host**, phần lớn không nói được gì ngoài
cái tên. Tiêu chí dùng thay là **KHẢ NĂNG KHÔI PHỤC NGHĨA**: chọn bề mặt mà từng câu bị **ghim bởi
một artefact đã có sẵn trong cây này**, để một khẳng định **kiểm được** thay vì **soạn ra**.

**CỤM ĐÃ CHỌN: historian cạnh máy** — bản ghi mà chính sản phẩm này giữ về việc máy của nó đã làm
gì. Lý do cụm ấy đi cùng nhau là **một hàm**: `HistorianResultRecord.From(MachineDescriptor,
DeviceReading, TransportAck, DateTimeOffset)` gộp **đúng bốn** đầu vào thành **một hàng ghi xuống
đĩa của chính máy**, và **ba trong bốn** nằm trong cụm — cái thứ tư, `DeviceReading`, chính là bề
mặt N-2 đã trả. Quanh hàng ấy là **hợp đồng** (`IHistorianStore`), **bản cài đặt duy nhất và lược đồ
vật lý** (`SqliteHistorianStore`), **bộ ghi sau** nuôi nó (`HistorianWriter`), và **phép tính duy
nhất** từng đọc ngược ra khỏi nó (`OeeSettingsStore` + `OeeCalculator`). Mỗi câu viết ở đây bị ghim
bởi một thứ **kiểm được trong cùng cây**: một `CREATE TABLE`, một mệnh đề `WHERE`, một chỗ kẹp của
một route.

| file | số | CS1591 | CS1573 |
|---|---:|---:|---:|
| `Historian/HistorianModels.cs` | 71 | 41 | 30 |
| `Models/TransportAck.cs` | 23 | 23 | 0 |
| `Historian/IHistorianStore.cs` | 13 | 7 | 6 |
| `Historian/SqliteHistorianStore.cs` | 11 | 11 | 0 |
| `Models/MachineDescriptor.cs` | 8 | 0 | 8 |
| `Historian/HistorianWriter.cs` | 1 | 1 | 0 |
| `Historian/OeeSettingsStore.cs` | 1 | 1 | 0 |
| `Metrics/OeeCalculator.cs` | 1 | 1 | 0 |
| **tổng** | **129** | **85** | **44** |

**Con số thật — ĐO, không trừ.** `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild` toàn bộ solution,
SDK 10.0.302, 15/15 compilation, `Build succeeded.`, `0 Error(s)`:

| | |
|---|---:|
| `EXPECT_WARNINGS` trước | 631 |
| **`EXPECT_WARNINGS` sau, ĐO** | **502** |

`631 − 129 = 502` là **số học** và nó **khớp** phép đo — khớp ấy được báo cáo **như một kết quả**.
🔴 **Bản `-t:Rebuild` ĐẦU TIÊN lại phải BỎ ĐI:** 3 lỗi / 14 compilation, **cả 3 đều là CS2001 trong
`St4iMachineSimulator_ioczjmtn_wpftmp.csproj`**. Lần chạy lại: 15/15, `0 Error(s)`, **502**. Đây là
đợt **thứ hai liên tiếp** gặp đúng hình dạng ấy.

**Sổ tách-gốc — HAI hàng dịch:** `OURS CS1591 328 → 243` (−85) và `OURS CS1573 84 → 40` (−44). Vẫn
**16 hàng**. **VENDORED 185 / OURS 317 = 502.** 🔴 **Tám hàng VENDORED không dịch một đơn vị.**

🔴 **ĐÂY LÀ ĐỢT ĐẦU TIÊN `OURS CS1573` DỊCH, VÀ CÁI KÊNH ĐỢT 1 DỰ BÁO ĐÃ NỔ — ĐÚNG MỘT LẦN, VÀO
CHÍNH ĐỢT NÀY.** 44 trong 129 được trả bằng cách **hoàn tất các bộ `<param>` vốn đã dở dang**. Giữa
chừng, một lần **viết lại** khối doc của `IHistorianStore.AggregateForOeeAsync` **làm rơi một
`<param>` khối ấy đã có** trong khi thêm bốn cái mới — sinh ra một CS1573 **MỚI**. **Không dụng cụ
nào trong cây thấy nó**: văn xuôi đúng cú pháp, W-1 xanh, diff đọc như thuần thêm dòng. Chỉ **phép
đo lại theo từng file** bắt được (128 thay vì 129). Bài học cho đợt 7–8 hẹp hơn và khó chịu hơn lời
dự báo: **rủi ro không nằm ở thẻ anh THÊM, mà ở thẻ khối ấy ĐÃ CÓ** — hãy **đếm dòng `///` bị XOÁ**
trong diff của chính mình.

🔴 **DẠNG KHẲNG ĐỊNH VỀ DIFF QUAY LẠI DẠNG MẠNH CỦA ĐỢT 4, và điều đó cũng đóng khung lại chuyện
đợt 5.** Trên nhánh này, `git diff` giới hạn ở `src/` có **KHÔNG dòng thay đổi nào không phải `///`,
theo cả hai chiều**: **657 thêm, 1 bớt**. Đợt 5 phải thu hẹp câu ấy vì nó lập tài liệu cho **thành
viên enum**; cụm này **không chứa enum nào**, nên chỗ thu hẹp ấy là **riêng của enum**, không phải
một mất mát vĩnh viễn cho đợt 7–8.

🔴 **BA KHẲNG ĐỊNH ĐÃ CÔNG BỐ BỊ PHÉP ĐO BÁC, và cả ba được RÚT TẠI CHỖ chứ không sửa mã** — vì
brief cấm sửa mã, và cả ba chỗ hỏng nằm ở **văn xuôi**, đúng thứ đợt này giao ra:
1. `OeeCalculator` tự nhận *"mọi tỉ số đều kẹp về `[0, 1]`"*. **Sai với Quality**: nó là phép chia
   trần `GoodCount / TotalCount`, không kẹp — chặn trên **chỉ đến từ** hai vị từ SQL lồng nhau ở
   `AggregateForOeeAsync`. Cả hai kiểu đều `public`.
2. `HistorianWriter.Enqueue` tự nhận rằng khi kênh **đầy** thì bản ghi bị bỏ **và** `logWarning` được
   gọi. Dưới `BoundedChannelFullMode.DropOldest`, ghi vào kênh **đầy** **THÀNH CÔNG** — nên nhánh
   cảnh báo **không chạy**, và **cú rơi vì bão hoà là IM LẶNG**. Thông điệp *"queue saturated"* chỉ
   với tới được kênh đã **đóng**. **Không bài kiểm nào trong cây chạm vào đường ấy.**
3. `ApplyRealPresenceGateAsync` tự nhận là luật *"mọi query/aggregate hướng khách hàng trong store này
   đều áp"*. `QueryTelemetryAsync` **không áp** — và **không thể**, vì hàng telemetry **không có cột
   nguồn gốc**, chỉ có khoá ngoại. `GET /v1/historian/telemetry` do đó **không có tham số
   `includeFabricated` nào cả**, trong khi hai route anh em ngay cạnh đều có.

**Việc còn nợ sau đợt 6, nêu tên chứ không làm:**
* **283 chỗ trống bao phủ của ta** (243 CS1591 + 40 CS1573) — đợt 7–8. **Mỗi đợt đo lại.** Phân bố
  theo thư mục, đo trên cây commit này: `Config/` 50 · `Drivers/Modbus/` 46 · `Transport/` 38 ·
  `Drivers/Simulators/` 27 · `Uns/` 19 · `Drivers/OpcUa/` 17 · `Mapping/` 13 · `Site/` 12 ·
  `Engine/` 11 · `Models/` 11 · `Fleet/` 8 · `Drivers/Mqtt/` 7 · `Drivers/HotFolder/` 7 ·
  `Uns/Sparkplug/` 6 · `Infrastructure/` 6 · `Drivers/` 5. File lớn nhất còn lại:
  `Config/MachineConfigModels.cs` **33**.
  > 🔴 **RÚT 2026-08-20 (AM-1, đợt 7), giữ nguyên văn.** Đợt 7 **đo lại** phân bố ấy trước khi
  > chạm vào nó và **tái lập đúng cả mười sáu hàng, không sai một đơn vị** — điều đó được ghi vì nó
  > là thứ mạnh nhất ai đó nói được về một dự báo trong chuỗi này. Hôm nay còn **221** (192 CS1591 +
  > 29 CS1573), và chỉ **đợt 8** nợ chúng. Ba thư mục `Transport/`, `Mapping/`, `Models/` **biến mất
  > khỏi danh sách** — xem §12.
* **103 cái vendored** — không đổi, phải ở nguyên đó.
* **Mười hai artefact phụ trong bản cài**, **không dụng cụ nào canh PAYLOAD**, **nửa A mù trước một
  lệnh đè nhắm ba mã đã về 0** — cả ba y như sau đợt 4 và đợt 5, không cái nào được đợt này đụng tới.
* 🔴 **Ba chỗ hỏng trong VĂN XUÔI ĐÃ CÔNG BỐ ở ngay trên đã được RÚT TẠI CHỖ; phần MÃ của chúng
  KHÔNG được sửa và KHÔNG được mở thành mục.** Hậu quả vận hành của (2) và (3) là **hình dạng chủ
  sở hữu** và được **báo, không mở**: (2) là **mất hàng historian im lặng** khi hàng đợi bão hoà;
  (3) là **biểu đồ telemetry của một fleet trộn hiển thị dữ liệu demo lẫn dữ liệu thật** mà không
  chỗ nào nói ra. Xem `.superpowers/sdd/item12-stage6/task-1-report.md` §7.
* 🔴 **Không ca *"không có gì để nói ngoài cái tên"* nào trong 129 cái** — và đó là một **hệ quả của
  tiêu chí chọn cụm**, không phải một thành tích: cụm được chọn *vì* nghĩa của nó khôi phục được.
  Đợt 7–8 chọn theo tiêu chí khác sẽ **không** thừa hưởng con số không này.

#### 12. 🔨 ĐỢT 7 — PHÁN QUYẾT VẪN ĐANG THI HÀNH **TỪNG PHẦN** (AM-1, 2026-08-20, base `47dfc8cf`)

🔴 **Vẫn là một ghi chép THI HÀNH TỪNG PHẦN. Mục 12 Ở LẠI PHẦN II.** 412 trong 736 đã trả;
**324 còn nợ** (221 chỗ trống của ta + 103 cái vendored không ai trả được).

**CÁC ỨNG VIÊN ĐÃ CÂN, LIỆT KÊ TRƯỚC KHI NÊU CON SỐ CỦA CỤM ĐƯỢC CHỌN.** 283 cái còn nợ được nhóm
lại theo thư mục, **trọn vẹn**, từ một lần `-t:Rebuild` của `St4i.EdgeCore` — và phép nhóm ấy **tái
lập đúng từng hàng dự báo của đợt 6**. Bốn cụm được cân:

| cụm | gồm | số |
|---|---|---:|
| **A** — họ driver dựng sẵn | `Drivers/` toàn bộ (Modbus 46 · Simulators 27 · OpcUa 17 · HotFolder 7 · Mqtt 7 · `Drivers/` 5) | **109** |
| **B** — cấu hình cạnh máy | `Config/` 50 · `Fleet/` 8 · `Infrastructure/` 6 | **64** |
| **C** — cửa UNS hướng bắc | `Uns/` 19 · `Site/` 12 · `Uns/Sparkplug/` 6 | **37** |
| **D** — **đã chọn**, xem dưới | `Transport/` 38 · `Mapping/` 13 · `Models/` 11 | **62** |

🔴 **TIÊU CHÍ CỦA ĐỢT 6 — KHẢ NĂNG KHÔI PHỤC NGHĨA — ĐƯỢC SUY LẠI, KHÔNG THỪA HƯỞNG, VÀ ĐƯỢC GIỮ.**
Nó là lý do cụm **A không được lấy dù A là đơn vị lớn nhất còn lại**: chính đợt 6 đã **đo** rằng bề
mặt ấy đầy những thành viên **không nói được gì ngoài cái tên**, nên thứ nợ ở đó là **một PHÁT
HIỆN**, không phải 109 câu. Mỗi câu viết ở đợt này bị **ghim bởi một artefact đã có trong cây**: ba
hằng số route bị ghim bởi URL cứng của chính SDK; `UnitMap` bởi **bảy** file `mapping/*.json` đã
check-in; cách viết tên của `TransportMode` bởi bộ chuyển enum-thành-chuỗi của EngineApi **và** bởi
một union TypeScript viết tay trong `web/`; chỗ **hai `Mode` nói ngược nhau** bởi chú thích của
chính `ScenarioConfig.NetworkOutage` và bởi `ApplyNetworkOutageLocked`.

**CỤM ĐÃ CHỌN: chiếc phong bì chuẩn hoá và trọn hành trình của nó.** Lý do cụm ấy đi cùng nhau là
**một KIỂU**: `CanonicalEnvelope` — được `Normalizer.Normalize` dựng từ một reading cộng một
`MappingProfile`, là **đối số duy nhất** của `ITransport.SendAsync`, được **bốn** bản cài đặt của
giao diện ấy mang đi, được `TransportCoordinator` lái, và được `WalFlushPump` phát lại từ đĩa khi
người mang nó gãy. **Ranh giới KIỂM ĐƯỢC chứ không phải LẬP LUẬN: ba thư mục lấy TRỌN**
(`Transport/`, `Mapping/`, `Models/`), và **dư lượng của cả ba sau khi viết là 0**.

> 🔴 **Đây là phần nối thẳng của đợt 6.** Đợt 6 đã trả **ba kiểu mà ba method của `ITransport` TRẢ
> VỀ** (`TransportAck`, `HeartbeatResult`, `ConfigSyncResult` — cùng nằm trong `Models/TransportAck.cs`).
> Đợt 7 trả **chính giao diện ấy**, hai kiểu trong chữ ký của nó còn chưa trả (`CanonicalEnvelope`,
> `TransportMode`), và **mọi thứ cài đặt nó**. Chữ ký của `ITransport` nay có tài liệu **cả hai chiều**.

| file | số | CS1591 | CS1573 |
|---|---:|---:|---:|
| `Transport/TransportCoordinator.cs` | 9 | 4 | 5 |
| `Models/Envelopes.cs` | 7 | 7 | 0 |
| `Mapping/MappingProfile.cs` | 7 | 7 | 0 |
| `Transport/AutoTransport.cs` | 6 | 6 | 0 |
| `Transport/DemoTransport.cs` | 5 | 5 | 0 |
| `Transport/LiveTransport.cs` | 5 | 5 | 0 |
| `Transport/SwitchableTransport.cs` | 5 | 5 | 0 |
| `Transport/ITransport.cs` | 4 | 4 | 0 |
| `Transport/WalFlushPump.cs` | 4 | 0 | 4 |
| `Models/Enums.cs` | 4 | 4 | 0 |
| `Mapping/Normalizer.cs` | 4 | 4 | 0 |
| `Mapping/MappingProfileResolver.cs` | 2 | 0 | 2 |
| **tổng** | **62** | **51** | **11** |

**Con số thật — ĐO, không trừ.** `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild` toàn bộ solution,
SDK 10.0.302, 15/15 compilation, `Build succeeded.`, `0 Error(s)`:

| | |
|---|---:|
| `EXPECT_WARNINGS` trước | 502 |
| **`EXPECT_WARNINGS` sau, ĐO** | **440** |

`502 − 62 = 440` là **số học** và nó **khớp** phép đo — khớp ấy được báo cáo **như một kết quả**.
🔴 **Bản `-t:Rebuild` ĐẦU TIÊN lần này ĐỨNG VỮNG:** hình dạng CS2001 trong `*_wpftmp` từng buộc đợt 5
và đợt 6 phải bỏ lần chạy đầu **không xuất hiện**. Đó là bằng chứng **về lần chạy này**, không phải
bằng chứng rằng hình dạng ấy đã hết — **đợt 8 vẫn phải chờ nó**.

**Sổ tách-gốc — HAI hàng dịch, cùng hai hàng ấy, và cả hai đều GIẢM:** `OURS CS1591 243 → 192` (−51)
và `OURS CS1573 40 → 29` (−11). Vẫn **16 hàng**. **VENDORED 185 / OURS 255 = 440.** 🔴 **Tám hàng
VENDORED không dịch một đơn vị.**

🔴 **KÊNH ĐỢT 6 NÊU TÊN ĐÃ ĐƯỢC BƯỚC VÀO CÓ CHỦ Ý, VÀ NÓ KHÔNG NỔ.** 11 trong 62 là CS1573 trên
những khối **đã mang sẵn MỘT PHẦN `<param>`** (5 ở constructor của `TransportCoordinator`, 4 ở
`WalFlushPump`, 2 ở `MappingProfileResolver.Build`). Cả 11 được trả bằng cách **CHÈN thẻ còn thiếu
cạnh thẻ đã có** — **không viết lại khối nào**, vì viết lại chính là thao tác đã làm một thành viên
"đã trả" thành "chưa trả" ở đợt 6. **Không một CS1573 MỚI nào được tạo ra**, và điều đó được **kiểm
theo từng file** chứ không suy từ tổng.

🔴 **PHÉP ĐỊNH GIÁ THEO TỪNG FILE ĐÃ CHẠY NHƯ MỘT TIỀN ĐIỀU KIỆN, VÀ NÓ TRẢ GIÁ CỦA NÓ THEO MỘT CÁCH
KHÁC VỚI DỰ TÍNH.** Nó **không** bắt được một thẻ bị rơi — không thẻ nào rơi. Cái nó bắt được là ở
giữa chừng: với **7 trong 12 file** đã viết, phép đo cho **36 đã trả** và **dư lượng 26 nằm ĐÚNG trên
5 file chưa chạm, file đối file**. Một con số 36 ở mức solution sẽ **trông y hệt** nếu một file bị trả
thừa và một file bị trả thiếu.

🔴 **CHỖ THU HẸP CỦA ĐỢT 5 QUAY LẠI, ĐÚNG BẰNG CƠ CHẾ ĐỢT 6 ĐÃ DỰ BÁO.** Cụm này chứa **đúng một**
khai báo enum (`TransportMode`), và một enum viết trên một dòng **phải được dàn lại** thì các thành
viên mới mang được chú thích. Trên nhánh này, `git diff` giới hạn ở `src/`: **460 thêm, 4 bớt**. **Ba
trong bốn dòng bớt là dòng `///`**, cả ba là **summary cũ của `ITransport`**, và cả ba được **chép
NGUYÊN VĂN vào chính khối thay thế**. Dòng thứ tư là khai báo enum một dòng; **dãy thành viên giống
hệt, tên đối tên và thứ tự đối thứ tự** — điều đó quan trọng vì thứ tự enum vừa là giá trị nền vừa
là **thứ tự vận hành viên nhìn thấy trong combo box**. Ngoài chỗ ấy và các dòng trắng ngăn đoạn,
**không dòng thay đổi nào không phải `///`**.

🔴 **MỘT KHẲNG ĐỊNH ĐÃ CÔNG BỐ TRONG CHÍNH CỤM BỊ PHÉP ĐO BÁC, ĐƯỢC RÚT TẠI CHỖ, KHÔNG SỬA MÃ.**
`ITransport` tự nhận là *"the single seam ... how it actually leaves the building"*. **Không phải
vậy**: `EdgePipeline` trao **CÙNG một `CanonicalEnvelope`** cho `IUnsPublisher.PublishReading` ở
**câu lệnh ngay trước** câu gọi `SendAsync`, và `Site.UnsBridge` phát lại spine ấy lên broker MQTT
của một SYNAPSE Site **ngoài hộp**. Câu ấy **đúng lúc được viết** và **bị G2-2 làm sai**; nó được
trích nguyên văn và rút ngay tại chỗ, kèm nửa còn sống: đây là **seam INGEST của ST4I**, một trong
**hai** đường ra.

🔴 **VÒNG TỰ KIỂM LÀ MỘT MỤC GIAO NỘP, NÓ ĐÃ CHẠY HAI LẦN, VÀ CHỖ CHIA ĐÔI MỚI LÀ PHÁT HIỆN.** 62 cảnh
báo trở thành **199 câu**. **Vòng 1** lọc theo **phủ định phổ quát/tồn tại** (luật (i) của đợt 5, quay
vào sản phẩm của chính mình): 112 câu bị gắn cờ, **7 câu sửa — 2 SAI HẲN**. Cả hai câu sai ấy hỏng vì
**cùng một lý do**: phép grep theo **TÊN THÀNH VIÊN** không nhìn thấy **một bộ SERIALIZER**, thứ đọc
*mọi* thành viên và *không nêu tên* cái nào — `UnsPublisher` tuần tự hoá **trọn cả record**
`CanonicalEnvelope` làm gương ngữ nghĩa **giữ lại**, nên `Path` và `IdempotencyKey` **có** rời khỏi hộp,
với **mọi loại reading kể cả telemetry**. **Vòng 2** đi tìm đúng thứ bộ lọc vòng 1 **không thể thấy** —
một **MỤC ĐÍCH** hoặc một **CƠ CHẾ** được khẳng định — và sửa **6 câu nữa**, bốn trong đó **cùng một
gốc**: `ITransport.HeartbeatAsync` **KHÔNG có một nơi gọi nào trong sản phẩm** và **không có heartbeat
timer nào trong repo này**; tôi đã **nâng lời rào của chính chú thích `AutoTransport`** (*"typically a
background timer, per the INTENDED architecture"*) **thành một khẳng định về cái đã dựng**. 🔴 **Lấy một
chú thích bên cạnh làm tiền đề, trong một cây mã mà đợt 4 đã đo được 101 khẳng định đã công bố là SAI,
là đúng cái lỗi "nhớ thay vì đo".** Tổng: **13 trong 199**. Chỗ chia **7 rồi 6** nói điều mà tỉ lệ không
nói: **một bộ lọc máy móc duy nhất luôn báo thiếu** — và đó là cách đọc trung thực cho **mọi** tỉ lệ
thấp trong chuỗi này, kể cả của đợt này.

**Việc còn nợ sau đợt 7, nêu tên chứ không làm:**
* **221 chỗ trống bao phủ của ta** (192 CS1591 + 29 CS1573) — **đợt 8, đợt bao phủ CUỐI CÙNG**. **Đo
  lại.** Phân bố theo thư mục, đo trên cây commit này: `Config/` 50 (6 file) · `Drivers/Modbus/` 46
  (10) · `Drivers/Simulators/` 27 (11) · `Uns/` 19 (4) · `Drivers/OpcUa/` 17 (5) · `Site/` 12 (2) ·
  `Engine/` 11 (3) · `Fleet/` 8 (1) · `Drivers/HotFolder/` 7 (2) · `Drivers/Mqtt/` 7 (2) ·
  `Infrastructure/` 6 (3) · `Uns/Sparkplug/` 6 (1) · `Drivers/` 5 (1). `Transport/`, `Mapping/` và
  `Models/` **BIẾN MẤT khỏi danh sách** — đó là dạng kiểm được của *"ba thư mục, lấy trọn"*. File lớn
  nhất còn lại: `Config/MachineConfigModels.cs` **33**, không đổi.
* 🔴 **109 trong 221 ấy là họ driver mà đợt 6 nêu đích danh** — nơi *"không có gì để nói ngoài cái
  tên"* là câu trả lời đúng. **Đợt 8 nợ ở đó một PHÁT HIỆN, không phải 109 câu**, và mục 12 **không
  rời Phần II** trên một đợt đi lấp chúng.
* **103 cái vendored** — không đổi, phải ở nguyên đó.
* **Mười hai artefact phụ trong bản cài**, **không dụng cụ nào canh PAYLOAD**, **nửa A mù trước một
  lệnh đè nhắm ba mã đã về 0** — cả ba y như sau đợt 4, 5 và 6, không cái nào được đợt này đụng tới.
* 🔴 **Ba khuyết tật MÃ của đợt 6 vẫn chờ chủ sở hữu, không đụng, không mở lại.** Đợt này không
  chạm vào một dòng nào của `OeeCalculator`, `HistorianWriter` hay `SqliteHistorianStore`.
* 🔴 **SÁU quan sát về MÃ mà đợt này DỪNG LẠI để báo thay vì tự sửa**, và **không cái nào được mở
  thành mục** — xem `.superpowers/sdd/item12-stage7/task-1-report.md` §7, nơi chúng được **xếp hạng**
  để người đọc khỏi phải tự cân. **Cái nặng nhất, và nó có hậu quả vận hành ngay hôm nay: cổng Demo
  canh MỘT cửa, còn route scenario là cửa kia.** `PUT /v1/mode` **từ chối** `Demo` bằng 400 khi
  `DemoModeGate.Enabled` tắt; `POST /v1/scenario` với `networkOutage` **không bị cổng ấy canh ở đâu
  cả**, và nó trỏ transport của fleet đang chạy thẳng vào một `DemoTransport` hao hụt — mọi reading
  được **ack tại chỗ**, **không gì tới máy chủ hệ sinh thái**, trong khi `GET /v1/mode` vẫn trả về
  đúng chế độ vận hành viên đã chọn (nó đọc `TransportCoordinator.Mode`, và đường outage cố ý không
  chạm vào đó). **Nửa giảm nhẹ, viết ngay cạnh:** việc ấy **có ghi audit** (`scenario.apply`, mang cả
  `networkOutage`) và **đòi policy Engineer** — nó không nặc danh và không vô đặc quyền; nó chỉ
  **không bị từ chối**. Quyết cổng ấy có nên phủ cả route scenario hay không là **quyết định về việc
  cái cờ ấy NGHĨA LÀ GÌ** — *"đừng chào chế độ Demo"* hay *"đừng bao giờ bịa dữ liệu trên host này"* —
  và hai cách đọc cho hai câu trả lời khác nhau. **Cả hai route đều nằm NGOÀI mười hai file đợt này
  trả.** Thứ nhì: `TransportCoordinator.Auto` là một property **công khai mà KHÔNG MỘT nơi nào trong
  repo đọc** — không mã sản phẩm, không bài kiểm — và `TransportCoordinator.Demo` chỉ được nhắc
  **trong một chú thích**.
* 🔴 **Hai ca *"không có gì để nói ngoài cái tên"* ĐƯỢC NÊU TÊN thay vì lấp**: `MappingProfile.Name`
  và `MappingProfile.DeviceClass`. Cả hai được nạp từ file preset rồi **không mã nào trên đường
  chuẩn hoá đọc tới**; thứ duy nhất đọc chúng là một bài kiểm đóng gói. Cái viết được về chúng
  **không phải nghĩa của chúng mà là sự VẮNG MẶT của người đọc** — và với `DeviceClass` còn thêm một
  hệ quả: **không gì đối chiếu nó với lớp thật của máy**, nên một máy `Automation` trỏ vào `aoi.json`
  chạy với preset khai `AoiAvi`, im lặng.

#### 13. 🔨 ĐỢT 8 — ĐỢT BAO PHỦ CUỐI CÙNG; MỤC 12 **Ở LẠI PHẦN II** VÀ SẼ RỜI ĐI BẰNG **MỘT PHÁN QUYẾT** (AN-1, 2026-08-20, base `a0f970ff`)

🔴 **Vẫn là một ghi chép THI HÀNH TỪNG PHẦN.** 524 trong 736 đã trả; **212 còn nợ** (109 chỗ trống của
ta + 103 cái vendored không ai trả được). 🔴 **Nhưng 109 kia KHÔNG còn là món nợ VIẾT.** Bốn đợt bao
phủ đã tiêu hết. Cái còn lại là **một câu hỏi về thiết kế đang chờ chủ sở hữu**, đã được **định giá**
ở đây và **không được quyết** bởi người thực thi.

**PHẦN DƯ ĐƯỢC NHÓM LẠI TRỌN VẸN TRƯỚC KHI NÊU CON SỐ.** 221 cái còn nợ được nhóm theo thư mục, trọn
vẹn, từ một `-t:Rebuild` toàn solution của chính đợt này — và phép nhóm ấy **tái lập đúng cả MƯỜI BA
hàng của đợt 7, không sai một đơn vị**, đợt **thứ hai liên tiếp** nói được điều ấy về đợt trước.
Chia theo ranh giới họ driver: **109 trong `Drivers/`, 112 ngoài**. 🔴 **Con số 112 là DỰ BÁO của đợt
7 và nay là PHÉP ĐO của đợt 8 — nó KHÔNG lệch.**

**SẢN PHẨM A — CỤM ĐÃ TRẢ: phần bù, không phải một chủ đề.** 112 chỗ thiếu, **20 file**, **7 thư mục
lấy TRỌN** và **dư lượng của cả bảy sau khi viết là 0**: `Config/` 50 (6 file) · `Uns/` 19 (4) ·
`Site/` 12 (2) · `Engine/` 11 (3) · `Fleet/` 8 (1) · `Infrastructure/` 6 (3) · `Uns/Sparkplug/` 6 (1).
102 CS1591 + 10 CS1573.

> 🔴 **Tiêu chí chọn cụm KHÔNG được dùng ở đợt này, và nói rõ vì sao.** Cụm do brief định nghĩa (mọi
> thứ ngoài họ driver), nên **khả năng khôi phục nghĩa** của đợt 6 được dùng làm **PHÉP THỬ** thay vì
> làm phép chọn: mỗi câu viết ra phải bị ghim bởi một artefact đã có trong cây. Nó **giữ được cho cả
> 112** — `docs/MACHINE_CONFIG_DESIGN.md` §2/§3 ghim mô hình ba lớp và bảng tham số;
> `MachineConfigStoreTests` ghim đúng bốn giá trị của `Op`; `ConfigJsonConverters` ghim cách viết trên
> dây của ba enum; `IBridgeSpool` và lược đồ SQLite ghim từng hợp đồng của `BridgeSpool`;
> `sparkplug_b.proto` của Eclipse Tahu ghim từng số hiệu trường.

**Con số thật — ĐO, không trừ.** `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild` toàn bộ solution,
SDK 10.0.302, 15/15 compilation, `Build succeeded.`, `0 Error(s)`:

| | |
|---|---:|
| `EXPECT_WARNINGS` trước | 440 |
| **`EXPECT_WARNINGS` sau, ĐO** | **328** |

`440 − 112 = 328` là **số học** và nó **khớp** phép đo — khớp ấy được báo cáo **như một kết quả**. Bản
`-t:Rebuild` **ĐẦU TIÊN đứng vững**, đợt **thứ hai liên tiếp**; đó là **bằng chứng về LẦN CHẠY ẤY**,
không phải bằng chứng rằng hình dạng `_wpftmp` đã hết.

**Sổ tách-gốc — HAI hàng dịch:** `OURS CS1591 192 → 90` (−102) và `OURS CS1573 29 → 19` (−10). Vẫn
**16 hàng**. **VENDORED 185 / OURS 143 = 328.** 🔴 **Tám hàng VENDORED không dịch một đơn vị.** Không
một CS1573 mới nào được tạo ra: 10 trong 112 là các bộ `<param>` dở dang, và **mỗi cái được CHÈN thêm
thẻ cạnh thẻ cũ, không khối nào bị viết lại** — đúng thao tác đã làm rớt một thành viên ở đợt 6.

🔴 **`328` TRÙNG VỚI CHÍNH LỊCH SỬ CỦA FILE NÀY** — `OURS CS1591` từng là 328 sau đợt 5. Literal được
**grep và PHÂN LOẠI** trước khi ghi; mọi lần xuất hiện cũ là **hồ sơ của một nhiệm vụ CÓ TÊN** và
được giữ nguyên văn. Đây là lần **thứ ba** trong chuỗi này một con số đang dịch đụng một con số khác.

🔴 **MỘT KHẲNG ĐỊNH ĐÃ CÔNG BỐ TRONG CỤM BỊ PHÉP ĐO BÁC, RÚT TẠI CHỖ, KHÔNG SỬA MÃ.**
`SparkplugMsgType` tự nhận rằng bốn thành viên vòng đời *"chỉ được đặt ở đây làm đích dựng topic"* và
*"phần đấu dây của G2-2 chỉ bao giờ sinh ra DDATA"*. **Sai**: G2-3 đã nối `NBIRTH`/`NDEATH` vào đúng
các chuyển trạng thái Start/Stop/E-stop thật của `FleetCore`. **Phần thứ ba thì ĐÚNG và được đo lại
chứ không thừa hưởng**: chuỗi `WithWill`/`LastWill` **không xuất hiện trong bất kỳ file `.cs` nào**
của repo này, nên vẫn không có MQTT Will và một cú kill đột ngột **không phát NDEATH nào**.

---

### 🔴 SẢN PHẨM B — PHÉP ĐO VỀ HỌ DRIVER. **KHÔNG MỘT CÂU NÀO ĐƯỢC VIẾT CHO 109 CÁI ẤY, VÀ KHÔNG MỘT MỨC TRUY CẬP NÀO ĐỔI.**

**LIỆT KÊ TRƯỚC, CON SỐ SAU.** 109 cảnh báo còn lại **toàn bộ nằm trong `Drivers/`**: `Modbus/` 46 (10
file) · `Simulators/` 27 (11) · `OpcUa/` 17 (5) · `HotFolder/` 7 (2) · `Mqtt/` 7 (2) · `Drivers/` 5
(1). Chúng rơi lên **CHÍN MƯƠI BẢY thành viên phân biệt**: 90 cái không có chú thích nào, cộng 7 cái
có bộ `<param>` dở dang (7 cái này gánh cả 19 CS1573). **Đơn vị trung thực ở đây là THÀNH VIÊN, không
phải cảnh báo.** Danh sách đầy đủ chín mươi bảy cái: `.superpowers/sdd/item12-stage8/task-1-report.md` §6.

#### 🔴 TIỀN ĐỀ CỦA ĐỢT 6 ĐÃ ĐƯỢC ĐO LẠI VÀ NÓ **KHÔNG SỐNG SÓT**

Đợt 6 đo bề mặt này là *"ống nước nội bộ của host, phần lớn không nói được gì ngoài cái tên"* và nêu
**bốn** ví dụ; đợt 7 chuyển tiếp nguyên văn; brief của đợt 8 được viết trên đó. Kiểm từng thành viên
theo **năm phép thử** (bất biến / đơn vị / miền giá trị / điều kiện tiên quyết / một cách hỏng):

| lớp | nghĩa | số |
|---|---|---:|
| **1** | có **một cách hỏng** hoặc **một điều kiện tiên quyết** mà người gọi làm sai được | **84** |
| **2** | chỉ có **đơn vị / mặc định / miền giá trị**, không có cách hỏng | **13** |
| **3** | 🔴 **KHÔNG CÓ GÌ ngoài cái tên** | **0** |

**Bốn ví dụ của đợt 6, kiểm từng cái:**
* `ModbusOptions.Host` và `ModbusOptions.Port` — **có thật**, và cả hai là **lớp 2**.
* `OpcUaConnectorFactory.Create` — 🔴 **không tồn tại như một thành viên chưa trả**: nó **đã có** chú
  thích và **không phát cảnh báo nào**. Nó chưa bao giờ được nợ.
* *"mười một constructor simulator"* — 🔴 **đó là số FILE đọc thành số CONSTRUCTOR**.
  `Drivers/Simulators/` có **11 file** và **TÁM lớp simulator**, nên nợ là **tám** constructor cụ thể
  cộng **một** constructor `protected` ở lớp cơ sở. Đây là chính luật của file này —
  *"một số vô hướng tóm tắt một tập chưa ai liệt kê thì không phải một sự thật"* — hỏng theo chiều
  ngược lại, **bên trong hồ sơ do chính file này giữ**, và đi qua **hai** brief mà không ai bắt.

#### 🔴 CÂU CHỦ SỞ HỮU SẼ PHÁN — VÀ VỚI PHẦN LỚN CHÚNG, **CÂU HỎI ẤY KHÔNG TỒN TẠI**

Đo bề mặt **ĐỌC** (§8.1 h5.4) tại một SHA đã ghim, trên **toàn cây** kể cả `server/` và `client/` mà
sparse checkout không có trên đĩa:

| nhóm | mô tả | số | `internal` sẽ ra sao |
|---|---|---:|---|
| **A1** | cài đặt/override của một **interface hoặc thành viên abstract CÔNG KHAI** | **41** | **lỗi biên dịch** — không chọn được |
| **A2** | **thành viên enum** | **5** | C# **cấm** đặt mức truy cập lên thành viên enum |
| **B** | được **System.Text.Json** đọc, không một nơi gọi nào gọi tên | **9** | **BIÊN DỊCH ĐƯỢC**, rồi **nạp về mặc định trong im lặng** |
| **C0** | chỉ `St4i.EngineApi` chạm tới — nơi **đã có** IVT duy nhất | **2** | miễn phí |
| **C1** | **KHÔNG GÌ ngoài `src/St4i.EdgeCore/` nhắc tới** | **15** | miễn phí, và gỡ bỏ bề mặt công khai chết |
| **C2** | chỉ các assembly **TEST** chạm tới | **16** | cần **một IVT mới tới một project test** |
| **C3** | một assembly **SẢN PHẨM** ngang hàng không có IVT chạm tới | **9** | cần **một IVT tới một assembly sản phẩm ngang hàng** |

41 + 5 + 9 + 2 + 15 + 16 + 9 = **97**.

🔴 **Sự thật quyết định về giá:** `St4i.EdgeCore` mang **đúng MỘT** `InternalsVisibleTo`, tới
`St4i.EngineApi` (`src/St4i.EdgeCore/AssemblyInfo.cs`). Chính file ấy, **bằng văn xuôi của nó**, lập
luận **chống lại** cả hai thứ mà C2 và C3 đòi: nó ghi rằng mở IVT cho một assembly **sản phẩm** ngang
hàng là **sai dụng cụ**, và mục `St4i.EdgeCore.Tests` đã bị **GĐ3 closeout WI-1 Part A xoá có chủ ý**.
Nên C2 và C3 **không miễn phí**: chúng trả bằng đúng thứ tiền mà file ấy tiêu dè dặt nhất.

🔴 **Nhóm B là nhóm nguy hiểm nhất và nó là đúng điểm mù đợt 7 vừa trả giá:** `ModbusRegisterMap` và
`OpcUaNodeMap` được nạp bằng `JsonSerializer` từ file trên đĩa. Một **grep theo TÊN thành viên không
thấy một BỘ TUẦN TỰ HOÁ**. Hạ chúng xuống `internal` **biên dịch sạch** rồi **nạp về giá trị mặc định
mà không báo gì** — trong đó có `ModbusRegisterMap.UnitId` (địa chỉ slave) và
`OpcUaNodeMap.Password`.

#### 🔴 GIÁ CỦA CẢ HAI HƯỚNG, VÀ CÁI PHÉP ĐO NÀY **KHÔNG** TRẢ LỜI ĐƯỢC

* **Hướng VIẾT:** ~109 phần tử tài liệu. Theo **tỉ lệ đo được của chính đợt 7** (62 cảnh báo → 199
  câu, 13 câu sai qua hai vòng tự kiểm), đó là khoảng **350 câu**, trong đó khoảng **23 câu sẽ sai ở
  lần viết đầu**. Và luật của chuỗi này nói: 13 trong 97 thành viên **chỉ** có đơn vị/mặc định để
  nói, nên một phần của 350 câu ấy sẽ **kề sát** ranh giới "diễn đạt lại cái tên".
* **Hướng THU HẸP:** **không dùng được** cho 46; **sai trong im lặng** cho 9; **miễn phí** cho 17
  (C0 + C1); **tốn một `InternalsVisibleTo` mới** cho 25 (C2 + C3), và một trong hai loại IVT ấy đảo
  ngược một quyết định đã ghi.
* 🔴 **Cái phép đo này KHÔNG nói:** nó **không** nói nên đổi hay không. Nó không cân "một bề mặt hẹp
  hơn" với "một bề mặt đã có người dùng ngoài kia mà repo này không thấy" — và **repo này không thể
  thấy người dùng ngoài nó**. Nó cũng không định giá **rủi ro tương thích ngược** của việc gỡ một
  thành viên `public` khỏi một assembly đã phát hành, vì P-2 quản cách viết tên chứ không quản việc
  gỡ bỏ.

🔴 **KHÔNG MỘT MỨC TRUY CẬP NÀO ĐỔI. KHÔNG MỘT TÊN NÀO ĐỔI. KHÔNG MỤC MỚI NÀO ĐƯỢC MỞ.**

**Việc còn nợ sau đợt 8, nêu tên chứ không làm:**
* 🔴 **109 chỗ trống bao phủ trong `Drivers/`** — **không** thuộc một đợt 9; thuộc **một phán quyết**.
  Bảng giá ở ngay trên. **Đo lại trước khi tin.**
* **103 cái vendored** — không đổi, phải ở nguyên đó.
* **Mười hai artefact phụ trong bản cài**, **không dụng cụ nào canh PAYLOAD**, **nửa A mù trước một
  lệnh đè nhắm ba mã đã về 0** — cả ba y như sau đợt 4, 5, 6 và 7, không cái nào được đợt này đụng tới.
* 🔴 **CHÍN khuyết tật MÃ của đợt 6 và 7 vẫn chờ chủ sở hữu, không đụng, không mở lại.**
* 🔴 **BA quan sát về MÃ mà đợt này DỪNG LẠI để báo thay vì tự sửa**, không cái nào được mở thành mục
  — xem `.superpowers/sdd/item12-stage8/task-1-report.md` §8. **Cái nặng nhất:** `UnsPublisher` dùng
  hàng đợi `BoundedChannelFullMode.DropOldest`, nên `TryWrite` vào một kênh **ĐẦY** **THÀNH CÔNG** và
  **mọi nhánh cảnh báo *"UNS publish queue saturated"* trong lớp ấy KHÔNG CHẠY ĐƯỢC vì bão hoà**. Một
  spine UNS tụt lại **mất các publish CŨ NHẤT, im lặng, không cảnh báo và không bộ đếm**. Đây **đúng
  họ** với khuyết tật `HistorianWriter.Enqueue` của đợt 6 nhưng ở **một chỗ KHÁC** — nên là một quan
  sát mới, không phải một mục cũ mở lại.

---

#### 14. 🔨 ĐỢT 9 — ĐỢT ĐẦU THI HÀNH PHÁN QUYẾT 2026-08-22 CỦA CHỦ SỞ HỮU (AY-1, 2026-08-22, base `fb7635cf`)

🔴 **Câu ngay trên — *"109 chỗ trống bao phủ trong `Drivers/` — KHÔNG thuộc một đợt 9; thuộc một phán
quyết"* — GIỮ NGUYÊN VĂN và KHÔNG bị xoá.** Nó đúng khi viết. Điều kiện nó nêu **đã xảy ra**: chủ sở
hữu phán ngày 2026-08-22 rằng **cả 97 thành viên được VIẾT TÀI LIỆU và không một mức truy cập nào
đổi**. Đợt 9 là đợt đầu thi hành phán quyết ấy, nên nó tồn tại **nhờ** phán quyết chứ không **thay**
cho nó. Mục 12 **VẪN Ở LẠI PHẦN II**: thứ còn treo nay là **VIỆC**, và còn 84.

**QUẦN THỂ LIỆT KÊ LẠI TRƯỚC KHI ĐẾM, và cả sáu hàng của đợt 8 TÁI LẬP ĐÚNG.** Từ một `-t:Rebuild`
toàn solution của chính đợt này, trước khi viết một chữ: `Modbus/` **46** · `Simulators/` **27** ·
`OpcUa/` **17** · `HotFolder/` **7** · `Mqtt/` **7** · `Drivers/` **5** = **109**, và **90 CS1591 +
19 CS1573**. 19 cái CS1573 rơi lên đúng **bảy** thành viên (`ModbusBus.BeginTransactionAsync` 1 ·
`ModbusRtuConnectorFactory` ctor 3 · `ModbusRtuDriver` ctor 2 · `.ExecuteRegisterWriteAsync` 3 ·
`.ExecuteCoilPulseAsync` 2 · `SimulatorBase` ctor 4 · `SimulatorFactory.Create` 4), nên **97 thành
viên riêng biệt** — đợt **thứ ba liên tiếp** một đợt tái lập được phép nhóm của đợt trước.

**CỤM ĐÃ CHỌN, và ứng viên đã cân trước khi chọn.** Ứng viên: (i) trọn `Drivers/Simulators/` (27, 11
file) · (ii) trọn `Drivers/Modbus/` (46, 10 file) · (iii) chỉ hai tài liệu map JSON (14) · (iv) **bề
mặt cấu hình một bản triển khai KHAI cho hai driver fieldbus thật** (25, 4 file). **Chọn (iv).** Vì
sao cụm ấy đi cùng nhau: trong nó **không có** một driver, một factory, một bus hay một transport nào
— mỗi thành viên là **một lời KHAI**: hai khối biến môi trường và hai tài liệu JSON viết tay mà chúng
trỏ tới. Nên **mọi thành viên trả lời CÙNG một câu hỏi: chuyện gì xảy ra khi lời khai này VẮNG.** Đó
đúng là câu mà phán quyết của chủ sở hữu xoay quanh, và là câu làm nhóm B nguy hiểm.

🔴 **Và cụm ấy ĐÚNG BẰNG A2 + B của mục 25:** cả **5** thành viên enum và cả **9** thành viên do
`System.Text.Json` đọc nằm gọn trong bốn file này và không ở đâu khác trong 97. Nên đợt đầu của phán
quyết trả đúng phần món nợ mà **không phán quyết nào rút được**.

**ĐỊNH GIÁ THEO FILE TRƯỚC KHI VIẾT, DƯ LƯỢNG SAU KHI VIẾT — đo lại, không suy ra:**

| file | trước | sau | mã |
|---|---:|---:|---|
| `Drivers/Modbus/ModbusOptions.cs` | 8 | **0** | 8 CS1591 |
| `Drivers/Modbus/ModbusRegisterMap.cs` | 8 | **0** | 8 CS1591 |
| `Drivers/OpcUa/OpcUaNodeMap.cs` | 6 | **0** | 6 CS1591 |
| `Drivers/OpcUa/OpcUaOptions.cs` | 3 | **0** | 3 CS1591 |
| | **25** | **0** | **25 CS1591, 0 CS1573** |

**Con số thật — ĐO, không trừ.** `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild --nologo` toàn
solution, SDK 10.0.302, 15/15 compilation, `Build succeeded.`, `0 Error(s)`: `EXPECT_WARNINGS`
**328 → 303**. `328 − 25 = 303` khớp, và phép khớp ấy **được báo cáo như một kết quả** chứ không
dùng thay phép đo. Bản `-t:Rebuild` **đầu tiên đứng vững**, đợt **thứ ba liên tiếp**.

**Sổ tách-gốc — ĐÚNG MỘT hàng dịch:** `OURS CS1591 90 → 65` (−25). 🔴 **`OURS CS1573 19` KHÔNG dịch**,
và đó là phép khẳng định rằng **không một CS1573 mới nào được tạo**: cụm không chứa `record`
positional nào và không chứa bộ `<param>` dở dang nào, nên cái bẫy của đợt 6 **không có chỗ cắn**.
Vẫn **16 hàng**. 🔴 **Tám hàng VENDORED không dịch một đơn vị.** **0 dòng `///` bị XOÁ** — ba dòng
không-`///` bị xoá là **ba khai báo enum một dòng** được giãn ra để thành viên mang được chú thích
(`ModbusRegisterType`, `ModbusDataType`, `OpcUaSecurityMode`), thứ tự và tên thành viên **giống hệt**,
và điều đó được **ĐO LẠI trên assembly đã dựng** chứ không nhìn bằng mắt: `Holding=0`, `Input=1`,
`UInt16=0`, `Int16=1`, `None=0`.

🔴 **PHÂN LOẠI 84/13/0 CỦA ĐỢT 8, KIỂM LẠI TRÊN 25 THÀNH VIÊN NÀY: 23 / 2 / 0.** Hai cái thuộc lớp
chỉ-có-giá-trị là `ModbusOptions.DefaultHost` và `.DefaultPort` — **đúng hai thành viên mà đợt 8 nêu
làm ví dụ lớp 2 còn sống sót**. Con số **0 của lớp "không có gì để nói" TÁI LẬP** trên một cụm được
chọn theo **phán quyết của chủ sở hữu**, chứ không theo *khả năng khôi phục nghĩa* — mà đợt 6 đã tự
nêu rằng con số 0 của nó phụ thuộc vào tiêu chí chọn ấy. **Không ca nào phải nêu tên-thay-vì-lấp.**

🔴 **HAI PHÁT HIỆN VỀ CHÍNH BẢNG BỀ MẶT ĐỌC CỦA MỤC 25 — xem mục 25 §"Đính chính 2026-08-22".**

🔴 **BA KHẲNG ĐỊNH ĐÃ CÔNG BỐ BỊ PHÉP ĐO BÁC, RÚT TẠI NGUỒN, KHÔNG SỬA MÃ:** (i) chú thích trong
`ModbusRegisterMap.FromJson` tự gọi lỗi `"commands": null` là *"the one parse failure in this method
that didn't name what was wrong"* — đo được **ít nhất hai**; (ii) phép kiểm kê người đọc trong doc
lớp `ModbusOptions` nói `St4i.EdgeService.EdgeConnectors` *"has never read these variables at all"* —
host ấy **gọi `ModbusOptions.FromEnvironment()`** và dùng `Host`/`Port`; (iii) trần census
**5780/15965** in trong `scan-doc-negations.sh` và `verify-suites.sh` **không tái lập** (đo 5794/16041
ở BASE, tức nó đã lệch **trước khi** đợt 9 viết một chữ). 🔴 **Bản sao thứ ba của cặp số ấy nằm trong
mục 26 — mục 26 ở PHẦN III và đợt này KHÔNG mở lại nó**, nên chỗ lệch được **báo** chứ không sửa.

🔴 **HAI KHUYẾT TẬT MÃ THẤY LÚC VIẾT — DỪNG VÀ BÁO, KHÔNG SỬA:** (1) `PollIntervalMs` **không được
kiểm miền** trên **cả hai** map, trong khi hai trường kề nó (`readTimeoutMs`/`retries`) thì có; đo
được `0` cho vòng poll **không tiết chế**, `-1` cho `Task.Delay` **chờ vô hạn** (thiết bị được poll
đúng một lần rồi im), và `≤ -2` cho `ArgumentOutOfRangeException` **thoát ra khỏi** một `catch` chỉ
bắt huỷ. (2) `"registers": null` / `"nodes": null` thoả điều kiện `required`, bind một null thật, rồi
ném `NullReferenceException` **trần** — đúng hình dạng mà file tự ghi là **đã sửa** cho `commands`.
**Không mục mới nào được mở; không một dòng mã nào bị đụng.**

**TỰ KIỂM HAI VÒNG, TỈ LỆ NÊU RIÊNG.** Vòng 1 (`scripts/scan-doc-negations.sh`, cơ giới) gắn cờ **4**
câu mới; đọc từng câu, **3 không sống sót** và được sửa tại nguồn, **1 đúng**. Vòng 2 (thủ công, nhắm
**MỤC ĐÍCH và CƠ CHẾ** — thứ vòng 1 về cấu trúc không thấy) bắt thêm **9**, **không cái nào** vòng 1
nhìn thấy được. Cộng thêm những cái bắt **trong lúc viết**: 2 cref có nguy cơ nhập nhằng (`Int16`)
được viết đủ điều kiện trước khi build, và 1 câu bị xoá vì nó khẳng định một lý do mà repo này không
ghi ở đâu cả. **Vòng 2 bắt được nhiều hơn vòng 1**, đợt **thứ ba liên tiếp** — nên báo một tỉ lệ gộp
là **tâng bốc văn xuôi của chính mình**.

**Việc còn nợ sau đợt 9, nêu tên chứ không làm:** **84 chỗ trống** trên **72 thành viên** vẫn trong
`Drivers/` (`Modbus/` 30 · `Simulators/` 27 · `OpcUa/` 8 · `HotFolder/` 7 · `Mqtt/` 7 · `Drivers/` 5),
gồm **cả 19 CS1573**; **103 cái vendored** không đổi; và **hai khuyết tật mã ở trên** chờ chủ sở hữu.

---

#### 15. 🔨 ĐỢT 10 — ĐỢT THỨ HAI THI HÀNH PHÁN QUYẾT 2026-08-22, VÀ ĐỢT ĐẦU DỊCH **CẢ HAI** HÀNG BAO PHỦ (AZ-1, 2026-08-22, base `3f564039`)

**QUẦN THỂ LIỆT KÊ LẠI TRƯỚC KHI ĐẾM, và cả sáu hàng của đợt 9 TÁI LẬP ĐÚNG.** Từ một `-t:Rebuild`
toàn solution của chính đợt này, trước khi viết một chữ: `Modbus/` **30** · `Simulators/` **27** ·
`OpcUa/` **8** · `HotFolder/` **7** · `Mqtt/` **7** · `Drivers/` **5** = **84**, và **65 CS1591 + 19
CS1573**. 19 cái CS1573 rơi lên đúng **bảy** thành viên, tên từng cái:
`ModbusBus.BeginTransactionAsync` 1 · `ModbusRtuConnectorFactory` ctor 3 · `ModbusRtuDriver` ctor 2 ·
`.ExecuteRegisterWriteAsync` 3 · `.ExecuteCoilPulseAsync` 2 · `SimulatorBase` ctor 4 ·
`SimulatorFactory.Create` 4. Nên **72 thành viên riêng biệt** — đợt **thứ tư liên tiếp** tái lập
được phép nhóm của đợt trước.

🔴 **VÀ MỘT PHÉP ĐO CỦA CHÍNH ĐỢT NÀY KHÔNG ĐỨNG VỮNG Ở LẦN CHẠY ĐẦU — báo, không lặng lẽ chạy lại.**
Bản `-t:Rebuild` **đầu tiên ở BASE trả 304, không phải 303**: đúng một `MSB3101` (*"could not write
state file … used by another process"*) trên `St4i.Connector.Conformance.Tests`, tức một trong bảy
mã đua-tranh-hiện-vật mà chính `verify-suites.sh` đã nêu tên. `dotnet build-server shutdown` rồi chạy
lại: **303**. Con số ghim đúng, lần đọc đầu sai — và **chuỗi "bản rebuild đầu tiên đứng vững" ba đợt
liên tiếp KẾT THÚC ở đây.**

**CỤM ĐÃ CHỌN, và ứng viên đã cân TRƯỚC khi nêu bất kỳ con số nào của cụm.** Ứng viên: (i) trọn
`Drivers/Simulators/` (11 file) · (ii) trọn phần còn lại của `Drivers/Modbus/` (8 file) · (iii) trọn
phần còn lại của `Drivers/OpcUa/` (3 file — sẽ đưa **một thư mục driver về 0** lần đầu) · (iv) hai
driver không-fieldbus cùng bộ đỡ của chúng (`SimulatedDriver` + `Mqtt/` + `HotFolder/`, 5 file) ·
(v) **chỉ 19 cái CS1573** — **BỊ BÁC, và lý do là một luật chứ không phải một sở thích**: nó không
lấy trọn file nào, nên nó phá *dư lượng mỗi file = 0*. **Chọn: bề mặt đường RS-485 DÙNG CHUNG — phân
xử, cho thuê, và cái giữ chỗ của từng thiết bị.** Năm file, lấy TRỌN.

**Vì sao cụm ấy đi cùng nhau:** mọi thành viên trong nó trả lời **CÙNG một câu hỏi — ai đang giữ sợi
dây vật lý DUY NHẤT lúc này, và một người giữ hỏng thì những người còn lại trả giá gì.** `ModbusBus`
là cái khoá phân xử, `GatewayTcpBusLink` là sợi dây, `ModbusBusRegistry`/`ModbusBusLease` là phép đếm
tham chiếu giữ cho N thiết bị dùng chung **một** lần mở, `ModbusRtuConnectorFactory` là thứ dựng N
driver trên một bus, `ModbusRtuDriver` là cái thực sự lấy và trả sợi dây. **`ModbusTcpDriver` và hai
factory TCP CỐ Ý ở NGOÀI:** một endpoint TCP là **một** thiết bị với `_ioLock` riêng, nên câu hỏi
trên không nói gì về nó — biên của cụm là một lập luận, không phải một lát cắt thư mục.

**ĐỊNH GIÁ THEO FILE TRƯỚC KHI VIẾT, DƯ LƯỢNG SAU KHI VIẾT — đo lại, không suy ra:**

| file | trước | sau | mã |
|---|---:|---:|---|
| `Drivers/Modbus/ModbusRtuDriver.cs` | 9 | **0** | 2 CS1591 + 7 CS1573 |
| `Drivers/Modbus/GatewayTcpBusLink.cs` | 4 | **0** | 4 CS1591 |
| `Drivers/Modbus/ModbusBus.cs` | 4 | **0** | 3 CS1591 + 1 CS1573 |
| `Drivers/Modbus/ModbusRtuConnectorFactory.cs` | 3 | **0** | 3 CS1573 |
| `Drivers/Modbus/ModbusBusRegistry.cs` | 1 | **0** | 1 CS1591 |
| | **21** | **0** | **10 CS1591 + 11 CS1573**, trên **15 thành viên** |

**Con số thật — ĐO, không trừ.** `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild --nologo` toàn
solution, SDK 10.0.302, 15/15 compilation, `Build succeeded.`, `0 Error(s)`: `EXPECT_WARNINGS`
**303 → 282**. `303 − 21 = 282` khớp, và phép khớp ấy **được báo cáo như một kết quả**.

**Sổ tách-gốc — HAI hàng dịch, lần ĐẦU dưới phán quyết này:** `OURS CS1591 65 → 55` (−10) **và**
`OURS CS1573 19 → 8` (−11). Đợt 9 chỉ dịch một hàng; cụm này dịch cả hai vì **11 trong 19 cái CS1573
nằm trong đúng năm file ấy** — mà một CS1573 là **một khối doc ĐÃ CÔNG BỐ với bộ `<param>` dở dang**,
tức đúng cái *nửa vời* mà đợt 6 gọi là nước cờ thua duy nhất. Còn lại **8**, cả 8 trên
`SimulatorBase` ctor (4) và `SimulatorFactory.Create` (4). Vẫn **16 hàng**. 🔴 **Tám hàng VENDORED
không dịch một đơn vị.** 🔴 **0 dòng `///` bị XOÁ, và 0 dòng không-`///` bị xoá khỏi bất kỳ file C#
nào** — đo trên diff với base, vốn xoá **ba** dòng tất cả: hai dòng ở chính file này (câu liệt kê
Phần I và trường máy đọc, cả hai buộc phải nêu mục 38 và 39) và **một** dòng `///` mà **văn xuôi giữ
nguyên từng byte**, chỉ thẻ `</summary>` cuối dòng dời xuống cuối một đoạn rút được thêm vào.

🔴 **HAI PHÁT HIỆN VỀ BẢNG BỀ MẶT ĐỌC CỦA MỤC 25 — xem mục 25 §"Đính chính 2026-08-22 (AZ-1)".** Tóm
tắt: **hai trong 97 thành viên đã là `private`**, nên ô *"`internal` sẽ làm gì"* của bảng **mở rộng**
chúng chứ không thu hẹp; **mẫu số của một phán quyết truy cập là nhiều nhất 95, không phải 97**; và
phân loại `84/13/0` kiểm lại trên 15 thành viên của cụm ra **14 / 1 / 0**.

🔴 **HAI KHUYẾT TẬT MÃ CỦA ĐỢT 9 NAY LÀ MỤC 38 VÀ 39 Ở PHẦN I** — cả hai **xác nhận lại trên mã và
chạy lại trên assembly đã dựng** trước khi mở, và phép chạy lại **bác một phép đếm của đợt 9**:
*"cả hai driver"* thực ra là **BA** (`ModbusTcpDriver`, `OpcUaDriver` gọi `Task.Delay` trực tiếp;
`ModbusRtuDriver` qua `NextPollDelayMs`). **Không một dòng mã nào bị đụng.**

🔴 **MỘT KHẲNG ĐỊNH ĐÃ CÔNG BỐ BỊ BÁC, RÚT TẠI NGUỒN Ở HAI CHỖ, KHÔNG SỬA MÃ:** mệnh đề
*"`GenerateDocumentationFile` is not set anywhere in this repository, so no warning fires for a doc
comment attached to the wrong member"* — viết ở `ModbusRtuDriver.BusDisposedDetail` **và** ở
`ModbusRegister.DecodeRawWord`. **Tiền đề chết** (đợt 3 của chính mục 12 bật cờ ngày 2026-08-19;
`SuppressionCensusTests` ghim **TÁM bật / bảy tắt**), **kết luận sống**: cờ ấy cảnh báo cho một khối
doc **VẮNG**, còn một khối gắn nhầm thành viên thì **có mặt** với cả hai bên. Hai bản sao rút **cùng
một lần**, đúng lý do file này lặp đi lặp lại: hai lời khai của một luật thì trôi.

🔴 **VÀ MỘT KHUYẾT TẬT DỤNG CỤ, DỪNG VÀ BÁO, KHÔNG SỬA — xem báo cáo:** `scripts/repo-scan.sh` chạy
**không có pathspec** (đúng dạng §8.1(f) bảo mọi nhiệm vụ dùng cho phép quét toàn cây) mặc định
`SPECS=(".")` → `:(top).`, mà `git` **không khớp gì**. Đo được: `git grep -n InfiniteTimeout --
':(top).'` trả **0** dòng, `':(top)'` trả **23**. Nên `scripts/repo-scan.sh 'pattern'` in
`result lines : 0 … 1 means NO MATCH, which is a measurement, not an error` **cho mọi pattern**.
Guard `_has_pattern` của chính script bắt ca *thiếu PATTERN* và **không** bắt ca này, còn
`--self-test` **không thể** thấy nó vì nó luôn truyền một pathspec tường minh. Mọi phép quét của đợt
này được chạy lại với pathspec tường minh.

**TỰ KIỂM HAI VÒNG, TỈ LỆ NÊU RIÊNG** — chi tiết ở khối `EXPECT_NEW_DOC_ABSOLUTES` trong
`verify-suites.sh`. Vòng 1 (cơ giới) gắn cờ **34**, **9 không sống sót**. Vòng 2 (thủ công, nhắm MỤC
ĐÍCH và CƠ CHẾ) bắt thêm **11**, trong đó **3 là NHÂN QUẢ BỊA** và **1 là một CON SỐ SAI**. **Vòng 2
bắt nhiều hơn vòng 1, đợt thứ tư liên tiếp.** `EXPECT_NEW_DOC_ABSOLUTES` **21 → 59**, baseline
`cfcfae42` **không dịch** — và **cú nhảy 38 ấy bác dự đoán của brief**, xem khối hằng số.

**Việc còn nợ sau đợt 10, nêu tên chứ không làm:** **63 chỗ trống** trên **57 thành viên** vẫn trong
`Drivers/` (`Simulators/` 27 · `HotFolder/` 7 · `Mqtt/` 7 · `Drivers/` 5 · `Modbus/` 9 · `OpcUa/` 8),
gồm **8 CS1573 còn lại**; **103 cái vendored** không đổi; và **mục 38 + 39** chờ chủ sở hữu.

#### 16. 🔨 ĐỢT 11 — ĐỢT THỨ BA THI HÀNH PHÁN QUYẾT 2026-08-22 (BB-1, 2026-08-22, base `927c0246`)

**QUẦN THỂ LIỆT KÊ LẠI TRƯỚC KHI ĐẾM, và cả sáu hàng của đợt 10 TÁI LẬP ĐÚNG.** Từ một
`-t:Rebuild` của chính đợt này, trước khi viết một chữ: `Simulators/` **27** · `Modbus/` **9** ·
`OpcUa/` **8** · `HotFolder/` **7** · `Mqtt/` **7** · `Drivers/` **5** = **63**, và **55 CS1591 +
8 CS1573**. 8 cái CS1573 rơi lên đúng **hai** thành viên, tên từng cái: `SimulatorBase` ctor 4 ·
`SimulatorFactory.Create` 4. Nên **57 thành viên riêng biệt** — đợt **thứ năm liên tiếp** tái lập
được phép nhóm của đợt trước.

**CỤM ĐÃ CHỌN, và ứng viên đã cân TRƯỚC khi nêu bất kỳ con số nào của cụm.** Ứng viên: (i) trọn
`Drivers/Simulators/` (11 file) · (ii) bốn factory còn lại (`ModbusConnectorFactory`,
`ModbusDriverFactory`, `OpcUaConnectorFactory`, `OpcUaDriverFactory`) · (iii) trọn phần còn lại của
`Drivers/OpcUa/` (3 file — sẽ đưa **một thư mục driver về 0** lần đầu) · (iv) trọn phần còn lại của
`Drivers/Modbus/` (3 file — cùng thế) · (v) `SimulatorBase.cs` + `SimulatorFactory.cs` +
`IMachineSimulator.cs`, tức hợp đồng nền của họ simulator, **nơi 8 cái CS1573 cuối cùng nằm** ·
(vi) **chỉ 8 cái CS1573** — **BỊ BÁC theo đúng LUẬT đợt 10 dùng**, không phải theo sở thích: nó
không lấy trọn `SimulatorBase.cs`, vốn còn 2 cái CS1591, nên nó phá *dư lượng mỗi file = 0*.
**Chọn: NĂM CÀI ĐẶT `IDeviceDriver` CỤ THỂ CÒN LẠI, lấy TRỌN.**

**Vì sao cụm ấy đi cùng nhau, và vì sao câu hỏi của nó có thật chứ không phải do tôi dựng lên:** doc
comment của chính `IDeviceDriver` **LÀ hợp đồng tuân thủ** — nó tự nói thế, và
`St4i.Connector.Conformance.DeviceDriverConformanceSuite` cưỡng chế nó. Nên mọi thành viên trong cụm
trả lời **CÙNG một câu hỏi — cái seam driver DUY NHẤT thực sự hứa gì ở đây, và chỗ nào cài đặt này
KHÔNG giữ lời hứa ấy.** **20 trong 25 thành viên là thành viên của chính hợp đồng**
(`Id`/`Kind`/`Health`/`ReadAsync`/`DisposeAsync`); **5 còn lại là constructor**, thứ mà hai luật cấp
kiểu của hợp đồng (*"construction is non-blocking and performs no I/O"*, *"`DisposeAsync` is
idempotent"*) nói thẳng về. `ModbusRtuDriver` **không** trong cụm vì đợt 10 đã trả nó.

**ĐỊNH GIÁ THEO FILE TRƯỚC KHI VIẾT, DƯ LƯỢNG SAU KHI VIẾT — đo lại, không suy ra:**

| file | trước | sau | thành viên |
|---|---:|---:|---|
| `Drivers/Mqtt/MqttDriver.cs` | 6 | **0** | ctor · Id · Kind · Health · ReadAsync · DisposeAsync |
| `Drivers/SimulatedDriver.cs` | 5 | **0** | ctor · Id · Kind · ReadAsync · DisposeAsync |
| `Drivers/HotFolder/HotFolderAoiDriver.cs` | 5 | **0** | ctor · Id · Kind · Health · ReadAsync |
| `Drivers/Modbus/ModbusTcpDriver.cs` | 5 | **0** | ctor · Id · Kind · Health · DisposeAsync |
| `Drivers/OpcUa/OpcUaDriver.cs` | 4 | **0** | ctor · Id · Kind · Health |
| | **25** | **0** | **25 CS1591 + 0 CS1573**, trên **25 thành viên** |

**Con số thật — ĐO, không trừ.** `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild --nologo` toàn
solution, SDK 10.0.302, 15/15 compilation, `Build succeeded.`, `0 Error(s)`: `EXPECT_WARNINGS`
**282 → 257**. `282 − 25 = 257` khớp, và phép khớp ấy **được báo cáo như một kết quả**.

🔴 **VÀ LẦN CHẠY ĐẦU LẠI KHÔNG ĐỨNG, ĐỢT THỨ HAI LIÊN TIẾP.** Bản `-t:Rebuild` đầu trả **258**: đúng
một `MSB3101` trên `St4i.EdgeService` — và `MSB3101` là một **warning**, nên nó đi thẳng vào TỔNG chứ
không vào cổng lỗi. **Bốn node `dotnet.exe` ngoại lai** (C# Dev Kit của VS Code) trú suốt buổi, đo
**hai mẫu cách 22 giây**: 9 tiến trình, còn **4** sau `dotnet build-server shutdown`. Chúng được
**CHỜ**, không bị giết. Chạy lại: **257**, không một `MSB3101`.

**Sổ tách-gốc — MỘT hàng dịch, và hàng KHÔNG dịch mới là phép kiểm:** `OURS CS1591 55 → 30` (−25).
🔴 **`OURS CS1573 8` KHÔNG dịch** — cụm này viết **năm constructor mang 18 tham số** cộng hai
`ReadAsync`, tức đúng cái hình dạng sinh ra CS1573 khi bộ `<param>` bị bỏ dở; mọi tham số của mọi
thành viên đều có `<param>` riêng, và hàng đứng yên **là bằng chứng** rằng không cái nào bị trả nửa
vời. Vẫn **16 hàng**. 🔴 **Tám hàng VENDORED không dịch một đơn vị.** 🔴 **0 dòng `///` bị XOÁ, và 0
dòng thuộc bất kỳ loại nào bị xoá khỏi bất kỳ file C# nào** — cột xoá của `git diff --numstat` với base
là **0** cho cả năm file nguồn. Toàn diff xoá **NĂM** dòng, tất cả ngoài `src/`, tất cả là thay-thế-một
-dòng, và nêu tên từng cái thay vì tóm tắt: **ba** là hằng số đợt này dịch theo phép ĐO
(`EXPECT_WARNINGS`, `EXPECT_NEW_DOC_ABSOLUTES`, và hàng sổ `OURS CS1591`), **hai** là hai hàng bảng
phán quyết của mục 12 và mục 25 — một hàng bảng markdown là **MỘT dòng**, nên nối một bản ghi đợt vào
nó tất yếu viết lại dòng ấy; văn cũ của cả hai **giữ nguyên từng chữ** bên trong bản thay thế.
🔴 **Câu trên lúc mới viết đọc là *"0 dòng bị xoá khỏi BẤT KỲ file nào"* và câu ấy SAI** — nó đúng với
năm file nguồn rồi bị tổng quát hoá lên cả thay đổi **trước khi cả thay đổi tồn tại**. Bắt được bằng
cách chạy lại `git diff --numstat` **sau** khi sửa hai tài liệu, tức đúng bước *đo lại sản phẩm của
chính mình sau khi viết*.

🔴 **BA PHÁT HIỆN VỀ BẢNG BỀ MẶT ĐỌC CỦA MỤC 25 — xem mục 25 §"Đính chính 2026-08-22 (BB-1)".** Tóm
tắt: hàng **A1 = 41 ĐỨNG** và cụm này là **20** của nó; **bảng KHÔNG có hàng nào cho CONSTRUCTOR**, mà
riêng cụm này đã có **5**; phân loại `84/13/0` kiểm lại trên 25 thành viên ra **25 / 0 / 0** —
**số 0 tái lập lần thứ NĂM**, và đây là đợt đầu ra **0 cả Class 2**.

🔴 **HAI KHUYẾT TẬT THẤY LÚC VIẾT — DỪNG VÀ BÁO, KHÔNG SỬA MÃ, KHÔNG MỞ MỤC MỚI.**
(1) **Constructor của `HotFolderAoiDriver` vi phạm thẳng luật cấp kiểu của `IDeviceDriver`** *"không
chặn, không I/O"*: ba lần `Directory.CreateDirectory` cộng một `FileSystemWatcher` sống. Điều này
**đã được ghi sẵn** ở `DeviceDriverConformanceSuite` và ở `HotFolderAoiDriverConformanceTests`, nên
đây **không phải một phát hiện mới** — cái mới là nó nay **đọc được từ chính driver**. Đo lại thay vì
chép: hai chỗ dựng duy nhất ngoài test là `FleetCore.RunHotFolderAoiDemoAsync` và
`FleetService.RunHotFolderAoiDemoAsync`, **cả hai là đường DEMO và không giữ `_gate`**.
(2) **`MqttDriver.DisposeAsync` phát `DisconnectAsync` với `CancellationToken.None`**, nên phép chờ
thứ hai của nó **không có cận nào trong lớp này** — chỉ có timeout nội bộ của client MQTT, thứ lớp
này không đặt và không khẳng định. Hai câu tôi viết ra đã nói ngược lại điều đó và **vòng 1 bắt được
cả hai**.

🔴 **VÀ MỘT KHẲNG ĐỊNH ĐÃ CÔNG BỐ BỊ PHÉP ĐO BÁC — CỐ Ý KHÔNG RÚT, nêu tên thay vì im.** Doc của
`IDeviceDriver.Id` viết *"it keys slot labels and, through those, alarms"*; `ScenarioAwareDriver.Id`
viết *"a pipeline slot, an alarm target and a trace row all key on this"*. Đo trên **mọi `*.cs` repo
này sở hữu** ở `927c0246`: **không gì tiêu thụ GIÁ TRỊ ấy** — bốn decorator chuyển tiếp nó, bộ
conformance chỉ khẳng định nó không đổi, còn nhãn slot mà một alarm nhắm tới do
`FleetCore.ResolveSlotLabelFor`/`ResolveConnectorSlotLabel` sinh ra từ kind trong roster hoặc từ id
instance. **Cả hai câu nằm NGOÀI cụm**, trong `St4i.Connector.Abstractions` và `Engine/`, và sửa một
khối vốn đã đủ ở ngoài cụm là đúng cái mối nguy đợt 6 nêu tên — nên phép đo được viết ở **năm điểm
sử dụng** trong cụm, và câu gốc **để nguyên cho một đợt sau quyết**.

**TỰ KIỂM HAI VÒNG, TỈ LỆ NÊU RIÊNG** — chi tiết ở khối `EXPECT_NEW_DOC_ABSOLUTES` trong
`verify-suites.sh`. Vòng 1 (cơ giới) gắn cờ **49**; **10 SAI hẳn** và **5 thiếu/không chính xác** —
**15 chỗ sửa**. Vòng 2 (thủ công, nhắm MỤC ĐÍCH và CƠ CHẾ) bắt thêm **7**, trong đó **5 là MỘT khẳng
định chép qua NĂM file** (*"Kind là nhãn mà luật alarm driver-health mang"* — đo được: `Kind` được
nội suy vào **văn bản** alarm, còn khoá và target là **nhãn slot**). Bắt lúc viết, trước cả hai vòng:
**1**. 🔴 **Vòng 2 bắt ÍT hơn vòng 1 lần này (7 so với 15) — chuỗi bốn đợt KẾT THÚC**, và lý do nêu
thẳng: cụm này có chủ đề là một **hợp đồng viết bằng chính từ vựng của bộ lọc**, nên vòng 1 vốn dĩ
đưa nhiều thứ ra trước mắt hơn. **Hai tỉ lệ KHÔNG cộng lại.** `EXPECT_NEW_DOC_ABSOLUTES` **59 → 106**
(+47), baseline `cfcfae42` **không dịch**.

**Việc còn nợ sau đợt 11, nêu tên chứ không làm:** **38 chỗ trống** trên **32 thành viên** vẫn trong
`Drivers/` (`Simulators/` 27 · `Modbus/` 4 · `OpcUa/` 4 · `HotFolder/` 2 · `Mqtt/` 1), gồm **cả 8
CS1573 còn lại** (`SimulatorBase` ctor 4 · `SimulatorFactory.Create` 4); **103 cái vendored** không
đổi; và **mục 38 + 39 + 40** chờ chủ sở hữu.

---

### ✅ ĐÃ THI HÀNH — đợt 12 (BC-1, 2026-08-22, base `5e194ab0`): GHI CHÉP THI HÀNH KÈM NGÀY, VÀ MỤC NÀY RỜI PHẦN II

🔴 **Phán quyết đã hoàn thành, nêu đích danh:** *"**VIẾT TÀI LIỆU CHO CẢ 97 THÀNH VIÊN, KHÔNG ĐỔI MỘT
MỨC TRUY CẬP NÀO**"* — chủ sở hữu, **2026-08-22**. Bốn đợt thi hành nó: đợt 9 (AY-1) **25**, đợt 10
**21**, đợt 11 (BB-1) **25**, đợt 12 (BC-1) **38**. **25 + 21 + 25 + 38 = 109**, đúng bằng số chỗ trống
mà phán quyết ấy nhận. **Không một mức truy cập nào đổi trong bất kỳ đợt nào**, và không một tên công
khai nào đổi.

**Cụm của đợt 12 là PHẦN BÙ — toàn bộ 38 còn lại, 17 file lấy TRỌN, dư lượng mỗi file = 0.** Cả 38 nằm
dưới **một cây thư mục duy nhất**, `src/St4i.EdgeCore/Drivers`, nên đợt cuối không phải chọn một cụm mà
đóng một tập. **Liệt kê trước, con số sau:** `Simulators/` 11 file / 21 thành viên / 27 cảnh báo ·
`Modbus/` 2 file / 4 / 4 · `OpcUa/` 2 file / 4 / 4 · `HotFolder/` 1 file / 2 / 2 · `Mqtt/` 1 file / 1 /
1. Tổng **17 file · 32 thành viên · 38 cảnh báo = 30 CS1591 + 8 CS1573**.

🔴 **`EXPECT_WARNINGS` 257 → 219 ĐO** trên `MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild --nologo`
toàn giải pháp, SDK 10.0.302: `Build succeeded.`, `0 Error(s)`, `219 Warning(s)`, **0 `MSB3101`**. Quần
thể build-server đo **HAI mẫu cách 22 s** trước khi chạy và bằng **0** ở cả hai (posture `0,0,0,0`), nên
đợt này **không phải chờ node ngoại lai nào** — khác đợt 10 và 11. `257 − 38 = 219` là phép tính **đồng
ý**, được báo **sau** phép đo chứ không thay cho nó. `EXPECT_BUILD_NODES` **0**. **0 lệnh đè** — không
`#pragma`, không `<NoWarn>`, không mục `.editorconfig`, và không một `<see cref>` nào bị xoá để né
CS1574.

🔴 **SỔ TÁCH-GỐC MẤT HAI HÀNG VÌ CHÚNG VỀ 0 — và đó là khẳng định, không phải ghi chú.**
`OURS CS1591 30 → 0` và `OURS CS1573 8 → 0`; `warning_ledger()` chỉ phát ra hàng nào nó **đếm được**,
nên bảng kỳ vọng đi từ **16 hàng xuống 14**. Đây là **lần đầu tiên** một hàng về 0 kể từ khi cờ được bật
ở AF-1. **`OURS` nay là 34** (CS8601 7 · CS8604 14 · CS8767 2 · NU1701 9 · xUnit1013 1 · xUnit2029 1) —
**không cái nào là cảnh báo tài liệu**. 🔴 **Tám hàng VENDORED không dịch một đơn vị** (185).
🔴 **KHÔNG một CS1573 mới nào được tạo ra**, và cái giữ điều đó là một LUẬT chứ không phải may: mọi
constructor được viết ở đợt này đều nhận **`<summary>` MÀ THÔI** hoặc **`<summary>` CỘNG ĐỦ MỌI
`<param>`**, không bao giờ một tập con. Hai thành viên vốn đã mang `<param>` dở dang
(`SimulatorBase` ctor thiếu 4 · `SimulatorFactory.Create` thiếu 4) được **bù đúng 4 + 4**, và đó là toàn
bộ hàng `OURS CS1573`.

🔴 **DÒNG BỊ XOÁ — ĐO XONG DIFF RỒI MỚI VIẾT, VÌ LẦN VIẾT ĐẦU ĐÃ SAI. Câu này lúc mới viết đọc là *"0
dòng `///` bị xoá và 0 dòng thuộc bất kỳ loại nào bị xoá khỏi bất kỳ file C# nào"*, và câu ấy SAI** —
nó được viết **trước khi khối rút ở `ModbusDriverFactory` tồn tại**, tức đúng loài lỗi mà đợt 11 ghi
lại về chính nó và là **lần thứ BA liên tiếp** artefact ít được quét nhất là **lời biện minh của chính
người viết**. Bắt được bằng cách chạy `git diff --numstat` **sau khi** mọi file đã sửa xong. Con số
thật, liệt kê từng cái chứ không tóm tắt:
* **16 trong 17 file C# có cột xoá = 0.**
* **`ModbusDriverFactory.cs` xoá ĐÚNG 4 dòng, cả 4 là `///`**, và cả 4 là **phép rút** ở §trên: ba dòng
  là chính câu bị bác, dòng thứ tư là dòng mang **nửa cuối** của câu trước nó (`… own drivers). Program.cs`)
  — nửa ấy **giữ nguyên** trong bản thay thế, và cả câu bị bác **được chép nguyên văn** vào khối rút.
* **`verify-suites.sh` xoá 5 dòng**, tất cả là thay-thế-một-dòng: `EXPECT_WARNINGS=257`,
  `EXPECT_NEW_DOC_ABSOLUTES=106`, và **ba dòng đầu của `EXPECT_WARNING_LEDGER`** (hai hàng về 0, cộng
  dòng mở chuỗi phải viết lại vì hàng đầu bảng đổi).
* **`owner-decisions.md`: `git diff --numstat` báo 6608 dòng xoá, và con số ấy là ẢO GIÁC CỦA PHÉP DIFF
  THEO DÒNG.** Hai thân mục (12 và 25) được **DI CHUYỂN** giữa hai banner, và git biểu diễn một lần dời
  thành xoá-cộng-chèn. Đo bằng phép so **đa tập** giữa base và cây hiện tại: **đúng BỐN dòng khác rỗng**
  của base không còn trong file — hàng bảng của mục 12, hàng bảng của mục 25, câu liệt kê Phần I, và
  trường máy đọc `<!-- gate:phần-i = … -->`. Ba cái đầu là thay-thế-một-dòng có **văn cũ giữ nguyên
  từng chữ** bên trong bản thay thế; cái thứ tư là **đầu vào của cổng**, không phải văn xuôi, nên nó
  mang sự thật hiện hành và tập cũ của nó được giữ trong câu rút ngay trên nó.

🔴 **LUẬT "KHÔNG CÓ GÌ ĐỂ NÓI" — KẾT QUẢ ĐO, KHÔNG PHẢI MẶC ĐỊNH. Phân loại kiểm lần thứ TƯ trên 32
thành viên: `30 / 2 / 0`.** Số 0 **tái lập lần thứ SÁU**, và lần này nó được yêu cầu **chứng minh** chứ
không được nhận. Bằng chứng, ba lớp:
1. **Tập được MỞ HẾT.** Cả 32 thành viên được liệt kê đích danh từ `-t:Rebuild` ở base **trước** khi
   viết một chữ, và mỗi thành viên mang một câu ĐO ĐƯỢC không suy ra được từ chữ ký của nó cộng với doc
   đã công bố trên thành viên mà nó cài đặt/ghi đè. Câu ấy **là** bằng chứng, và nó nằm trong mã.
2. **Ba ví dụ đích danh mà đợt 6 dự báo sẽ nổ đều được TRẢ LỜI TỪNG CÁI.** *"Mười một constructor
   simulator"* là **số FILE đọc thành số CONSTRUCTOR** — đã được AN-1 đính chính một lần và bản tóm tắt
   giao việc **nhập lại lỗi ấy**: `Simulators/` có **11 file trả cảnh báo** nhưng chỉ **8 lớp simulator
   song song**, cộng interface + lớp cơ sở + factory tĩnh, ba thứ **không song song với nhau**. Ba
   constructor trần `(d, seed)` là ca khó nhất, và cả ba đều ra câu đo được: `WELDER` và `DISPENSING`
   **có** một `configKind` đầy đủ trong `MachineParameterSchema` (`weld_profile`, `dispense_program`)
   mà **không simulator nào đọc**; `ASSEMBLY` **không có** — và chính vì thế nó là **một trong hai ca
   Class 2**. `ModbusOptions.Host`/`.Port` **đã được đợt 9 trả** và **không còn nằm trong quần thể này**.
   Nên hai trong ba ví dụ của đợt 6 đã **cũ**, và cái thứ ba **đo được là sai về số**.
3. 🔴 **VÀ ĐÂY LÀ PHÁT HIỆN THẬT: cái không nổ là LUẬT, không phải cụm.** Lý do đợt 11 nêu (*"một bản
   cài đặt luôn nói được nó khác hợp đồng ở đâu"*) **KHÔNG** áp được cho `Simulators/` — brief đúng ở
   chỗ đó. Cái áp được là khác: **mỗi thành viên trong `Simulators/` là một điểm mà ai đó đã CHỌN giữa
   một hằng số cố định và một cấu hình sống, và lựa chọn ấy KHÔNG đọc được từ chữ ký** — nó nằm trong
   lời gọi `base(...)` hoặc trong tham số `fallback` của `GetValue`. Nói một thành viên đứng ở phía nào
   của lựa chọn ấy **luôn là thông tin mới**. Nhưng cơ chế ấy **riêng cho cụm này**. Cái tổng quát hơn,
   và là thứ tôi đưa lên: **luật như đang viết không BÁC BỎ ĐƯỢC bằng phương pháp đang dùng** — phương
   pháp là *"đi đo cho tới khi tìm ra điều gì đó"*, và trên một cây đã được đo kỹ thế này thì gần như
   luôn có điều gì đó. Sau **109 thành viên và sáu lần ra 0**, đề nghị: hoặc **rút luật**, hoặc **viết
   lại nó với một ngưỡng quyết định được** (ví dụ: *"câu duy nhất viết được suy ra từ chữ ký cộng doc kế
   thừa"* — một phép thử một người khác có thể bất đồng trên hồ sơ).
   **Hai ca gần Class 3 nhất, nêu tên để ai đó bất đồng được:** `AssemblySim` ctor và
   `OpcUaConnectorFactory.Kind`. Cả hai được xếp **Class 2** vì câu của chúng nêu một GIÁ TRỊ/một sự
   VẮNG MẶT chứ không nêu một cách hỏng.

🔴 **RỦI RO CHÉP-MỘT-CÂU-QUA-NHIỀU-LỚP: xử lý bằng ĐO LẠI, và ĐO ĐƯỢC.** Sau khi viết, mọi mảnh doc mới
được chuẩn hoá và đối chiếu chéo giữa 17 file: **547 mảnh riêng biệt, chỉ 6 xuất hiện ở nhiều hơn một
file**, và cả 6 được đo lại riêng trên từng lớp. Bộ lọc ấy **đã bắt được một mâu thuẫn thật giữa hai
file của cùng cụm**: `IotSensorSim` tự nhận là *"simulator DUY NHẤT không bao giờ chạm `VerdictHelper`"*
trong khi doc mới của `AoiInspectorSim`, viết trước đó chưa đầy một giờ, nói `VerdictHelper` *"không bao
giờ được hỏi tới"* ở đó. **Hai câu của chính tôi, cùng một cụm, nói ngược nhau.**

**TỰ KIỂM HAI VÒNG, TỈ LỆ NÊU RIÊNG** — chi tiết ở khối `EXPECT_NEW_DOC_ABSOLUTES` trong
`verify-suites.sh`. Vòng 1 (cơ giới, `--since 5e194ab0`) gắn cờ **92**; đọc từng cái so với mã ⇒ **18
chỗ sửa**, trong đó **8 SAI hẳn**. Vòng 2 (thủ công, nhắm CƠ CHẾ và các câu **không mang từ tuyệt đối**)
bắt thêm **5**. **Hai tỉ lệ là 18/92 và 5, KHÔNG cộng lại.** **Tổng thật 23.**
🔴 **Vòng 2 thấp hơn vòng 1 lần thứ HAI liên tiếp (5 so với 18)**, nên cách đọc của đợt 11 (*"chủ đề là
một hợp đồng viết bằng từ vựng của bộ lọc"*) **không giải thích được đợt này**, vốn có chủ đề là mô hình
vật lý. Cách đọc thay thế, nêu để đợt sau bác được: **sản lượng vòng 1 đi theo số câu tác giả viết dưới
dạng PHỔ QUÁT**, và một đợt viết N lớp song song viết rất nhiều câu như thế, vì phân biệt chúng chính là
nội dung. `EXPECT_NEW_DOC_ABSOLUTES` **106 → 203** (+97), baseline `cfcfae42` **không dịch**; 106 + 97 =
203 khớp với một lần chạy thẳng vào baseline.

🔴 **MỘT KHẲNG ĐỊNH ĐÃ CÔNG BỐ BỊ BÁC — RÚT TẠI NGUỒN, TRONG CỤM, KHÔNG SỬA MÃ.** Khối doc của lớp
`ModbusDriverFactory` nói `Program.cs` *"registers its `Create` method as the `Func<IDeviceDriver>`
singleton St4i.EngineApi's `FleetHost` optional ctor param resolves"*. Đo ở `5e194ab0`:
`St4i.EngineApi/Program.cs` **không có đăng ký nào như thế** — ba lần nhắc tên kiểu ấy trong file đều là
**chú thích gọi nó là lịch sử**, và chính file ấy viết rằng GP-4 *"removed BOTH registrations"*. Phép đo
thứ hai đi kèm: **toàn cây có ĐÚNG MỘT `new ModbusDriverFactory(...)` và ĐÚNG MỘT
`new OpcUaDriverFactory(...)`**, mỗi cái nằm trong `TryCreate` của adapter tương ứng, dựng lên rồi bỏ đi
trong một biểu thức — nên tiền đề *"một factory sống lâu, nhiều lần khởi động lại"* mà **cả hai lớp** mô
tả **không còn khớp** với cách dùng thật. Văn cũ **giữ nguyên từng chữ** trong khối rút.

🔴 **MƯỜI KHUYẾT TẬT THẤY LÚC VIẾT — DỪNG VÀ BÁO, KHÔNG SỬA MÃ, KHÔNG ĐỔI MỨC TRUY CẬP, KHÔNG MỞ MỤC
MỚI.** Liệt kê, không đếm trước:
1. **`weld_profile` và `dispense_program` được định nghĩa đầy đủ, kiểm miền cứng khi ghi, phục vụ qua
   API `MachineSettingsEndpoints` — và KHÔNG simulator nào đọc chúng.** `WelderSim`/`DispensingSim` gọi
   `base(d, seed)`. Nặng hơn: hai trong bốn khoá của mỗi bộ **trùng tên** với metric mà chính simulator
   ấy phát (`current`/`time`; `pressure`/`temperature`). Vận hành viên chỉnh `pressure` thấy bản ghi
   đổi và metric `pressure` **không** đổi.
2. **Từ vựng machineType của `SimulatorFactory` và của `MachineParameterSchema` là HAI danh sách độc
   lập và chúng KHÁC nhau.** `AOI_AVI` có ở factory, không có ở schema ⇒ khi có config store, máy ấy
   được `Ensure` một bản ghi `aoi_inspection` **trong khi** `GET .../settings` trả *"unsupported machine
   type"* cho đúng máy đó. `IOT_GATEWAY` thì ngược lại. (`ASSEMBLY`/`LEAK_TEST`/`FUNCTIONAL_TEST` vắng ở
   schema là **cố ý**, schema tự nói thế.)
3. **Một machineType không nhận ra, kèm config store, được dựng thành `ScrewdriveSim`** — nên nó nhận
   một bản ghi `screw_program` **ghi xuống đĩa** dưới mã máy của nó, trong khi API settings từ chối
   phục vụ chính máy ấy.
4. 🔴 **Cắm một config store làm mô-men SCREWDRIVE nhảy khoảng CHÍN LẦN mà không ai chỉnh gì.** Đường
   không-config vẽ `N(12.0, 0.4)` Nm; một bản ghi vừa `Ensure` được gieo từ **default của schema**, nên
   đường có-config giải ra `torqueTarget = 1.35`, `torqueTolerance = 0.15` và vẽ `N(1.35, 0.0405)`. Đo:
   **hai** chỗ gọi `SimulatorFactory.Create` trong `FleetCore` truyền store, **hai** chỗ trong
   `St4i.EdgeService.EdgeWorker` và `St4iMachineSimulator.Services.FleetService` **không** — nên cùng
   một descriptor báo ~12 Nm dưới host này và ~1.35 Nm dưới host kia.
5. **`LeakTestSim` cảnh báo vì rò QUÁ ÍT.** `VerdictHelper` không có khái niệm "một phía, thấp là tốt":
   nó lấy LSL 0.0 theo nghĩa đen và áp cùng luật cận-biên 15%, nên rò ≤ 3.0 Pa/s — kết quả TỐT NHẤT máy
   có thể báo, gồm mọi giá trị bị kẹp về 0.0 — là `Warn`. Với phân phối này ~5% chu kỳ warn vì quá tốt,
   nhiều hơn số warn vì quá rò.
6. **6 trong 34 chỗ ném của `Doc28Parser` sinh ra thông điệp KHÔNG nêu tên file**, và trên đường sản
   xuất duy nhất, `HotFolderAoiDriver` bắt bằng `catch (Doc28ValidationException)` **không gán biến** —
   nên cả thông điệp lẫn inner exception **không ai đọc**. Bảy tham chiếu còn lại là `Assert.Throws<>`
   và **không cái nào** nhìn `.Message`.
7. **`LeakTestSim.maxLeakRatePa` và `FunctionalTestSim.targetPassRate` là tham số constructor công khai
   mà KHÔNG chỗ gọi nào trong repo truyền** — đo trên mọi `*.cs`: định danh chỉ xuất hiện trong chính
   file khai báo. `AoiInspectorSim.pointsPerBoard`/`.ngRate` cũng không có chỗ gọi ngoài test.
8. **`AssemblySim` chỉ có MỘT verdict với tới được: `Warn`** (cả hai giới hạn null). Và `Warn` **được
   tính là TỐT cho OEE** (mục 2) — nên một cell lắp ráp **không bao giờ bị trừ điểm chất lượng** thay vì
   được đánh dấu là chưa xét được.
9. **`ModbusConnectorFactory` và `ModbusRtuConnectorFactory` báo CÙNG một `Kind`**, nên trong
   `ConnectorRegistry` chúng **mặc định về cùng một khoá** và cái đăng ký sau **thay** cái trước, im
   lặng. Cùng shape với hai endpoint TCP không đặt instance id.
10. **`InProcessBroker.DisposeAsync` gọi `StopAsync` không token, không timeout, và nuốt mọi lỗi mà
    không có nơi ghi** — một broker không nhả được cổng **không phân biệt được** với một broker tắt
    sạch; triệu chứng xuất hiện muộn, ở lần `StartAsync` sau trên cùng cổng.

**Phần DƯ, nêu thẳng chứ không giấu — đây là điều kiện để mục này rời đi cho đúng:**
* 🔴 **`EXPECT_WARNINGS = 219` KHÔNG PHẢI 0.** **103** trong số đó là file SDK **vendored** mà repo này
  **không được sửa** — chúng hiện ra ở AF-1, được ghim, và **không ai trả được** chúng bằng luật hiện
  hành. **34** còn lại là `OURS` và **không cái nào là cảnh báo tài liệu**: `CS8601`/`CS8604`/`CS8767`
  (nullability), `NU1701` (gói), `xUnit1013`/`xUnit2029`. Mục 12 **chưa bao giờ nhận** chúng.
* **Cái mục 12 mua là BAO PHỦ, không phải TÍNH ĐÚNG** — mục 26 nói đúng điều đó và **vẫn đứng**: không
  gì trong repo này trả cho việc một chú thích đã viết có ĐÚNG hay không; W-1 kiểm **hình thức** (XML
  hợp lệ, tên phần tử đã đăng ký), còn nội dung do hai vòng tự kiểm của mỗi đợt gánh. **23 chỗ sửa của
  riêng đợt này là số đo cho biết cái giá ấy có thật.**
* **Không mục nào khác đóng theo mục này.** Mục 26 ở lại; mục 38, 39, 40 chờ chủ sở hữu; mười khuyết
  tật ở trên **chưa có mục nào** và **cố ý không mở mục mới** — brief cho phép ba sản phẩm và mở mục
  thứ tư không nằm trong đó.

**Điều kiện rời Phần II của chính file này** — *"một mục rời phần này sang Phần III khi dòng phán quyết
của nó có thêm một ghi chép thi hành ghi kèm ngày"* — **đã thoả**: khối này là ghi chép ấy, ngày
**2026-08-22**, nhiệm vụ **BC-1**, phán quyết được hoàn thành nêu đích danh ở dòng đầu. **Mục 12 rời
Phần II sang Phần III.**

---

## 25. ĐIỀU KIỆN RỜI PHẦN II CỦA MỤC 12 — họ driver: viết tài liệu, hay thu hẹp bề mặt? Và với hơn một nửa, câu hỏi ấy KHÔNG TỒN TẠI

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AN-1 (đợt 8, Sản phẩm B), xác nhận lại trên mã.

📎 **Mục này KHÔNG sửa và KHÔNG chạm mục 12.** Mục 12 ở lại **Phần II** với phán quyết
*"BẬT CỜ, KHÔNG MIỄN TRỪ"* của anh, đã thi hành từng phần qua sáu đợt. Điều mục 12 còn thiếu là
**một điều kiện rời đi**, và bốn đợt bao phủ đã tiêu hết: **mục 12 sẽ rời Phần II bằng một PHÁN
QUYẾT, không bằng một con số về 0.** Mục 25 là chỗ đặt phán quyết ấy.

**Đo được cái gì — LIỆT KÊ TRƯỚC, con số viết SAU.** Sau đợt 8, `EXPECT_WARNINGS` là **328**, và sổ
cảnh báo phân hoạch nó thành **185 vendored / 143 ours**; hai hàng bao phủ còn lại của ta là
`OURS CS1591 90` và `OURS CS1573 19` — **đọc lại từ `scripts/verify-suites.sh`**, không lấy từ báo
cáo. Tổng **109**, và **toàn bộ nằm trong `Drivers/`**: `Modbus/` 46 · `Simulators/` 27 · `OpcUa/`
17 · `HotFolder/` 7 · `Mqtt/` 7 · `Drivers/` 5. 90 cái CS1591 rơi mỗi cái một thành viên; 19 cái
CS1573 rơi lên **bảy** thành viên có bộ `<param>` khuyết. **97 thành viên riêng biệt** — đợt 8 liệt
kê từng cái, theo file, trước khi dùng bất kỳ con số nào.

🔴 **TIỀN ĐỀ MÀ HAI BRIEF TRUYỀN TAY NHAU ĐÃ BỊ ĐO LẠI VÀ NÓ KHÔNG SỐNG SÓT.** Đợt 6 mô tả họ driver
là *"đường ống nội bộ của host mà phần lớn thành viên không nói được gì ngoài cái tên"*; đợt 7 chép
lại; brief của đợt 8 được viết trên đó. Kiểm từng thành viên: **0 trong 97 thành viên không có gì để
nói.** Theo năm phép thử (bất biến / đơn vị / miền giá trị / điều kiện tiên quyết / cách hỏng),
**84** mang một cách hỏng hoặc một điều kiện tiên quyết, **13** chỉ mang đơn vị-mặc định-miền giá
trị, **0** không có gì. Và trong bốn ví dụ đợt 6 nêu đích danh: hai cái đứng vững;
`OpcUaConnectorFactory.Create` **đã có tài liệu và chưa bao giờ được nợ**; còn *"mười một constructor
simulator"* là **một phép đếm FILE đọc thành một phép đếm CONSTRUCTOR** — `Drivers/Simulators/` có
mười một file và **tám** lớp simulator. **Đó là luật của chính chuỗi file này (*một vô hướng tóm tắt
một tập chưa ai liệt kê thì không phải một sự thật*) hỏng ở bên trong bản ghi mà chuỗi ấy giữ, và nó
đi qua hai brief không ai chặn.**

🔴 **VÀ CÂU ANH SẼ PHÁN — *"chúng có nên `public` không?"* — KHÔNG TỒN TẠI VỚI PHẦN LỚN CHÚNG.** Bảng
dưới là bề mặt **ĐỌC** đã đo (§8.1(h5.4)), ở SHA đã ghim, bằng `git grep` trên commit object chứ
không phải cây làm việc — vì cây này là sparse checkout.

| nhóm | là cái gì | số | `internal` sẽ làm gì |
|---|---|---:|---|
| **A1** | cài đặt/override của một thành viên interface hoặc abstract **công khai** | **41** | **lỗi biên dịch** — câu hỏi không tồn tại |
| **A2** | **thành viên enum** | **5** | C# **cấm** modifier trên thành viên enum; thu hẹp nghĩa là thu hẹp cả KIỂU |
| **B** | do **`System.Text.Json`** đọc, không chỗ gọi nào gọi tên | **9** | 🔴 **biên dịch được, rồi ÂM THẦM nạp về mặc định** |
| **C0** | chỉ `St4i.EngineApi` với tới, mà nó đã giữ IVT | **2** | miễn phí |
| **C1** | **không gì** ngoài `src/St4i.EdgeCore/` với tới | **15** | miễn phí, và xoá được bề mặt công khai chết |
| **C2** | chỉ các assembly **test** với tới | **16** | cần một **IVT mới tới một test project** |
| **C3** | một assembly **sản xuất ngang hàng** với tới, không có IVT | **9** | cần một **IVT tới một assembly sản xuất ngang hàng** |

41 + 5 + 9 + 2 + 15 + 16 + 9 = **97**. Ba nửa của bảng ấy đã được kiểm lại độc lập ở nhiệm vụ này:
**A2 đúng là năm** (`ModbusRegisterType.Holding`/`.Input`, `ModbusDataType.UInt16`/`.Int16`,
`OpcUaSecurityMode.None`); **B đúng cơ chế** (`ModbusRegisterMap.FromJson` →
`RootElement.Deserialize<ModbusRegisterMap>` và `OpcUaNodeMap.FromJson` →
`JsonSerializer.Deserialize<OpcUaNodeMap>`; `System.Text.Json` mặc định bỏ qua property không công
khai, nên hạ xuống là **nạp một map với địa chỉ slave mặc định và không mật khẩu**, gồm
`ModbusRegisterMap.UnitId` và `OpcUaNodeMap.Password`); và **C0 đúng bằng hai** (xem mục 24, nơi
đúng hai hằng số ấy được `St4i.EngineApi.Program` gọi tên).

**Sự thật cấu trúc quyết định giá của C2 và C3:** `src/St4i.EdgeCore/AssemblyInfo.cs` mang **đúng
MỘT** `[assembly: InternalsVisibleTo("St4i.EngineApi")]`. Nó mang **không** entry nào tới
`St4i.EdgeCore.Tests` — GĐ3 closeout WI-1 Part A đã xoá cái duy nhất, có chủ ý — và không entry nào
tới `St4i.EdgeService`, WPF app, `St4i.EdgeCore.Serial` hay `tools/settings-acl-probe`. **File ấy
lập luận, bằng văn xuôi của chính nó và khá dài, chống lại CẢ HAI loại IVT mà C2 và C3 đòi.**

**Giá của hai hướng, cả hai đều đo, không hướng nào được đề xuất.**
* **Hướng 1 — VIẾT TÀI LIỆU.** ~109 phần tử doc (90 `<summary>` + 19 `<param>`) trên 97 thành viên.
  Ở **tỉ lệ đã đo của đợt 7** (62 cảnh báo thành 199 câu, 13 sai qua hai vòng tự kiểm), đó là khoảng
  **350 câu**, trong đó chừng **23 sẽ sai ở lần viết đầu**. Và 13 trong 97 thuộc lớp chỉ-có-đơn-vị,
  nên một lát đáng kể số câu ấy nằm sát cái lằn mà cả chuỗi này cấm vượt: *một `<summary>` chỉ diễn
  đạt lại cái tên không phải một khoản trả.*
* **Hướng 2 — THU HẸP.** Không dùng được với **46** (A1 + A2). **Sai trong im lặng với 9** (B) — nó
  biên dịch, rồi hỏng lúc chạy, trong một lần nạp JSON, không một chẩn đoán nào. **Miễn phí với 17**
  (C0 + C1), và với 15 cái C1 nó còn xoá được bề mặt công khai chết. **Tốn một `InternalsVisibleTo`
  mới với 25** (C2 + C3) — và hai loại ấy không ngang nhau: C2 khôi phục một entry mà một nhiệm vụ
  có tên đã cố ý xoá; C3 mở assembly cho một assembly **sản xuất** ngang hàng.

🔴 **CÁI MÀ MỘT BẢNG DỄ GIẤU, NÊN NÓ ĐƯỢC VIẾT RA NGOÀI BẢNG: ÍT NHẤT 55 TRONG 97 SẼ `public` DÙ ANH
PHÁN THẾ NÀO.** 46 của A1/A2 vì ngôn ngữ không cho phép khác, cộng 9 của B vì hạ chúng xuống là hỏng
lúc chạy. **Đó là một món nợ tài liệu mà không phán quyết nào rút được**, và nó không phụ thuộc vào
hướng anh chọn.

**Ở đâu trong mã — trỏ bằng TÊN.** `src/St4i.EdgeCore/Drivers/**` (sáu thư mục kể trên);
`St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap.FromJson`;
`St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap.FromJson`; `src/St4i.EdgeCore/AssemblyInfo.cs`;
`scripts/verify-suites.sh` (`EXPECT_WARNINGS`, `EXPECT_WARNING_LEDGER`);
`Directory.Build.props` (khối chuỗi rút của mục 12); `St4i.Connector.Conformance.DeviceDriverConformanceSuite`
(hợp đồng mà 41 cái A1 cài đặt).

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* mục 12 đứng ở Phần II **không có điều kiện rời đi**, và mọi đợt tiếp theo sẽ phải tự
nghĩ ra một cái. `EXPECT_WARNINGS = 328` là một hằng số đang được canh nhưng **không ai biết nó nên
đi về đâu**, nên nó không còn nói gì về tiến độ. Và 9 thành viên nhóm B là một cái bẫy **đang mở**:
một người sau đọc "thu hẹp bề mặt công khai" là việc tốt sẽ hạ đúng chúng và mất một địa chỉ slave
Modbus cùng một mật khẩu OPC-UA, im lặng.
*Chiều ngược, và nó đủ để "không quyết" là một lựa chọn có lý:* 109 cảnh báo trên một assembly là
một mức nợ **ổn định và đã đo**, được một cổng canh, không tăng. Không có khách hàng nào đang chờ
chúng. Mọi lựa chọn ở trên đều tiêu thời gian kỹ sư thật cho một thứ **không đổi một hành vi nào**
mà sản phẩm này thể hiện ra ngoài.

**Nếu KHÔNG quyết định.** Mục 12 ở lại Phần II vô thời hạn với một món nợ đã đếm và không có định
nghĩa "xong". 🔴 **Và phép đo này có một hạn mà nó tự nêu tên chứ không giấu: nó KHÔNG thấy được
người tiêu thụ ngoài repo này.** Mọi con số bề mặt-đọc ở trên là số người đọc **trong cây này**; nếu
`St4i.EdgeCore` được tiêu thụ ở nơi khác, phép đếm im lặng về chuyện đó và sẽ báo thành viên ấy là
chết. Thêm nữa, **phép phân lớp 84/13/0 là một PHÁN ĐOÁN, không phải một phép đo** — chính đợt 8 nói
thế — trong khi các con số bề mặt-đọc trong bảng thì kiểm được tới từng dòng. Hai loại ấy **không
được đọc với cùng mức tin cậy**.

---

### 📐 Đính chính 2026-08-22 (AY-1, base `fb7635cf`) — bảng bề mặt ĐỌC ở trên **KHÔNG bị xoá một chữ**; một nửa của nó đứng vững, một nửa không

Đợt 9 là **đợt đầu thi hành phán quyết 2026-08-22 của chủ sở hữu** (*viết tài liệu cho cả 97, không
đổi một mức truy cập nào*). Nó trả **25 trong 109** — bề mặt cấu hình một bản triển khai KHAI cho hai
driver fieldbus thật, bốn file, dư lượng mỗi file **0** — và cụm ấy **chính là A2 + B**, nên hai hàng
ấy của bảng đã được **kiểm lại trên mã và trên trình biên dịch**, không đọc lại từ báo cáo. Chi tiết
thi hành ở **mục 12 §14**. Mục 25 **Ở LẠI PHẦN I**: phán quyết đã có, việc chưa xong.

* ✅ **`A2 = 5` ĐỨNG VỮNG, đúng bằng năm.** Phép liệt kê trọn 109 xác nhận không có thành viên enum
  thứ sáu ở bất kỳ đâu trong họ driver.
* 🔴 **`B = 9` ĐÚNG NHƯ MỘT PHÉP ĐẾM THÀNH VIÊN, và SAI NHƯ MỘT PHÉP ĐẾM CƠ CHẾ.** Ô của hàng B nói
  *"biên dịch được, rồi ÂM THẦM nạp về mặc định"*. Đo trên một **cặp lớp đối chứng** dựng riêng bằng
  đúng SDK này: với một property **không** `required` thì đúng y như thế — giá trị khai trong JSON bị
  **bỏ**, mặc định CLR **sống sót**, và **không ngoại lệ nào** được ném. Nhưng **bốn trong chín** được
  khai `required` (`ModbusRegisterMap.MachineCode`/`.Registers`, `OpcUaNodeMap.MachineCode`/`.Nodes`),
  và thu hẹp một thành viên `required` xuống dưới kiểu chứa nó là **lỗi biên dịch CS9032** — đo trên
  cùng cặp đối chứng: *"Required member 'X' cannot be less visible … than the containing type"*. Nên
  **bốn cái ấy thuộc về A1/A2 — câu hỏi không tồn tại — chứ không thuộc B**, và số thành viên mà thu
  hẹp là **sai TRONG IM LẶNG** là **5**, không phải 9: `ModbusRegisterMap.UnitId`,
  `ModbusRegisterMap.PollIntervalMs`, `OpcUaNodeMap.SecurityMode`, `OpcUaNodeMap.Password`,
  `OpcUaNodeMap.PollIntervalMs`.
* 🔴 **CÂU TIÊU ĐỀ KHÔNG ĐỔI, THÀNH PHẦN CỦA NÓ THÌ ĐỔI.** *"Ít nhất 55 trong 97 sẽ `public` dù anh
  phán thế nào"* **vẫn đúng**: 46 (A1+A2) + 4 (`required`, CS9032) = **50 bị chính NGÔN NGỮ từ chối**,
  cộng **5** bị từ chối vì hậu quả. Tổng vẫn 55. Và **hai ví dụ mà mục này nêu đích danh — `UnitId` và
  `Password` — nằm trọn trong 5 cái ấy**, nên cái bẫy mà mục mô tả **nguyên vẹn**; thứ dịch là số
  thành viên mang nó.
* 📐 **`84/13/0` kiểm lại trên 25 thành viên của cụm: `23/2/0`.** Hai cái lớp-2 là
  `ModbusOptions.DefaultHost` và `.DefaultPort` — đúng hai ví dụ lớp 2 mà đợt 8 nêu là còn sống sót.
  **Con số 0 tái lập** trên một cụm chọn theo phán quyết chứ không theo khả năng khôi phục nghĩa.
* 🔴 **Và một cái bẫy MỚI, cùng họ, mà bảng trên không có chỗ để nói:** `ModbusRegisterMap.UnitId` mặc
  định về **1** và `OpcUaNodeMap.PollIntervalMs` về **1000** — đều là **giá trị THẬT, không phải cờ
  báo vắng**. Nên một map quên trường sẽ **hỏi đúng slave 1** thay vì hỏng, và người đọc không có cách
  nào phân biệt "khai 1" với "quên khai". Điều ấy nay **được viết ra tại chỗ**, trên chính thành viên.

---

### 📐 Đính chính 2026-08-22 (AZ-1, base `3f564039`) — bảng bề mặt ĐỌC ở trên **vẫn KHÔNG bị xoá một chữ**; lần này cái dịch là **MẪU SỐ**, không phải một hàng

Đợt 10 trả **21 trong 84 còn lại** — bề mặt đường RS-485 **dùng chung**: phân xử, cho thuê, và cái giữ
chỗ của từng thiết bị; năm file lấy TRỌN, dư lượng mỗi file **0**; **cả hai** hàng bao phủ dịch lần đầu
dưới phán quyết này. Chi tiết thi hành ở **mục 12 §15**. Mục 25 **Ở LẠI PHẦN I**: phán quyết đã có,
việc chưa xong — còn **63 chỗ trống trên 57 thành viên**.

* 🔴 **BẢNG TRÊN GÁN CHO CẢ 97 THÀNH VIÊN MỘT Ô TRONG CỘT *"`internal` sẽ làm gì"*, VÀ **HAI** TRONG 97
  ĐÃ LÀ `private`.** `ModbusRtuDriver.ExecuteRegisterWriteAsync` và `.ExecuteCoilPulseAsync` — chúng
  mang **5 trong 19** cái CS1573 giữa hai đứa. Với một thành viên `private`, `internal` **MỞ RỘNG** chứ
  không thu hẹp, nên câu *"chúng có nên `public` không?"* **không tồn tại** với chúng theo nghĩa đen
  nhất có thể — và **không hàng nào của bảng nói điều đó**; ô của C1 còn hứa *"xoá được bề mặt công
  khai chết"*, thứ mà một thành viên private không có để xoá. Một cái thứ ba, `SimulatorBase` ctor (4
  cái CS1573 nữa), là `protected`.
* **Vì sao bảng có thể bỏ sót — cơ chế, không phải lỗi cẩu thả:** `CS1591` chỉ bắn cho thành viên
  **hiển thị công khai**, nên mọi thành viên tới bảng **qua đường CS1591** đều là public/protected.
  `CS1573` thì bắn cho **bất kỳ** thành viên có doc mà bộ `<param>` dở dang, **kể cả private**. Phép
  liệt kê 97 gộp hai quần thể có điều kiện hiển thị khác nhau và cột của bảng chỉ đúng cho một trong
  hai.
* 🔴 **Câu tiêu đề vẫn KHÔNG đổi, và lần này cái dịch là mẫu số.** *"Ít nhất 55 trong 97 sẽ `public` dù
  anh phán thế nào"* **vẫn đúng** — một thành viên `private` chưa bao giờ nằm trong 55 ấy. Nhưng **tập
  mà một phán quyết về mức truy cập có thể áp vào là nhiều nhất 95**, không phải 97. Nêu ra vì mục này
  tự đặt cho mình luật *một vô hướng tóm tắt một tập chưa ai liệt kê thì không phải một sự thật*, và
  `97` là một vô hướng dùng làm mẫu số cho một câu hỏi mà **hai phần tử của nó không trả lời được**.
* 📐 **`84/13/0` kiểm lại trên 15 thành viên của cụm: `14 / 1 / 0`.** Cái lớp-2 duy nhất là
  `GatewayTcpBusLink.InfiniteTimeout`, nêu một **giá trị** (`-1`) và không gì khác — cùng hình dạng với
  `ModbusOptions.DefaultHost`/`.DefaultPort` của đợt 9, và **ghi là lớp 2 chứ không nâng lên lớp 1**
  bằng phát hiện thiết kế viết cạnh nó. **Con số 0 tái lập lần thứ tư**, lần này trên một cụm chọn theo
  **một CƠ CHẾ**, chứ không theo phán quyết (đợt 9) hay khả năng khôi phục nghĩa (đợt 6).

---

### 📐 Đính chính 2026-08-22 (BB-1, base `927c0246`) — bảng bề mặt ĐỌC ở trên **vẫn KHÔNG bị xoá một chữ**; lần này cái dịch là một **HÀNG CÒN THIẾU**, không phải một ô sai

Đợt 11 trả **25 trong 63 còn lại** — **năm cài đặt `IDeviceDriver` cụ thể còn lại**, lấy TRỌN, dư
lượng mỗi file **0**. Chi tiết thi hành ở **mục 12 §16**. Mục 25 **Ở LẠI PHẦN I**: phán quyết đã có,
việc chưa xong — còn **38 chỗ trống trên 32 thành viên**.

* 📐 **HÀNG `A1 = 41` ĐỨNG VỮNG, và cụm này là 20 của nó.** `Id`/`Kind`/`Health` trên cả năm driver,
  cộng `ReadAsync` trên ba và `DisposeAsync` trên ba: **20 thành viên là cài đặt của một interface công
  khai**, nên `internal` ở đó là **lỗi biên dịch** và câu hỏi của chủ sở hữu **không tồn tại** với
  chúng — đúng như hàng A1 đã nói. Đây là lần đầu hàng A1 được kiểm lại trên một cụm mà nó chiếm đa số.
* 🔴 **NHƯNG BẢNG KHÔNG CÓ HÀNG NÀO CHO *CONSTRUCTOR*, VÀ RIÊNG CỤM NÀY ĐÃ CÓ NĂM.** Năm thành viên còn
  lại của cụm là constructor công khai của một lớp `sealed public`. Một constructor **không** phải cài
  đặt interface (A1), **không** phải thành viên enum (A2), **không** do `System.Text.Json` đọc (B) — và
  bảy hàng của bảng không có chỗ nào cho nó. Thu hẹp một constructor xuống `internal` **biên dịch
  được**, và cái nó phá là **bộ dựng ngoài assembly**: đo trên cây này, `HotFolderAoiDriver` được dựng
  ở hai chỗ sản xuất **ngoài `St4i.EdgeCore`** (`FleetCore` nằm trong, `St4iMachineSimulator`.
  `FleetService` nằm **ngoài**), nên với nó `internal` là **C3**, tốn một `InternalsVisibleTo` tới một
  assembly sản xuất ngang hàng — đúng loại IVT mà `AssemblyInfo.cs` tự lập luận chống lại. **Mẫu số
  không đổi; cái đổi là bảng có một cột trống mà 97 phần tử đã được chia hết vào bảy hàng.**
* 📐 **`84/13/0` kiểm lại trên 25 thành viên của cụm: `25 / 0 / 0`.** **Con số 0 cho "không có gì để
  nói" tái lập lần thứ NĂM**, và đây là đợt **đầu tiên** ra **0 cả lớp 2**: một bề mặt-cài-đặt-hợp-đồng
  không có thành viên nào chỉ nêu một giá trị — mỗi cái hoặc mang một cách hỏng, hoặc mang một điều
  kiện tiên quyết mà người gọi làm sai được. Ghi ra để đợt sau bác được trên hồ sơ.
* 🔴 **Và một phép đo NGOÀI bảng, thuộc cùng họ câu hỏi:** `IDeviceDriver.Id` — thành viên mà cả năm
  driver phải công bố — **không có gì tiêu thụ GIÁ TRỊ của nó** trên mọi `*.cs` repo này sở hữu ở
  `927c0246`. Doc của chính nó nói ngược lại (*"it keys slot labels and, through those, alarms"*), và
  câu ấy **để nguyên**, không rút, vì nó nằm ngoài cụm — xem mục 12 §16. Đây là hình dạng của **mục
  19** (bốn bộ truy cập công bố, hai cái không ai đọc giá trị) tái diễn trên seam driver, và nó là một
  câu hỏi thiết kế **chưa ai phán**, không phải một khuyết tật đợt này được sửa.

### ✅ ĐÃ THI HÀNH 2026-08-22 (BC-1, base `5e194ab0`) — phán quyết của mục này đã chạy XONG, và mục rời Phần I

**Điều kiện mà chính ô phán quyết của mục này đặt ra** — *"🔴 **Ở LẠI PHẦN I** cho tới khi phán quyết ấy
thi hành xong"* — **đã thoả hôm nay**. Phán quyết là *"VIẾT TÀI LIỆU CHO CẢ 97 THÀNH VIÊN, KHÔNG ĐỔI MỘT
MỨC TRUY CẬP NÀO"* (chủ sở hữu, 2026-08-22); bốn đợt trả **25 + 21 + 25 + 38 = 109** chỗ trống trên 97
thành viên, `EXPECT_WARNINGS` **328 → 219**, và **hai hàng sổ tài liệu (`OURS CS1591`, `OURS CS1573`) về
0**. Ghi chép thi hành đầy đủ nằm ở **mục 12**, khối *"ĐÃ THI HÀNH — đợt 12"*. **0 mức truy cập đổi
trong cả bốn đợt.** Câu hỏi ở tiêu đề mục này — *"tài liệu hay thu hẹp?"* — do đó **không còn treo ở bất
kỳ nghĩa nào**, và mục rời **Phần I** sang **Phần III**.

**BẢNG BỀ MẶT ĐỌC — KIỂM LẦN THỨ TƯ, TRÊN 32 THÀNH VIÊN CUỐI: `30 / 2 / 0`.**
* 📐 **Hàng `A1 = 41` ĐỨNG, và cụm cuối là 13 của nó.** LIỆT KÊ TRƯỚC, con số sau:
  `SimulatorBase.Descriptor` và `SimulatorBase.NextCycle` (cài đặt hai thành viên của
  `IMachineSimulator`), **tám** `XSim.NextCycle` (ghi đè một `abstract` công khai — thu hẹp một
  `override` cũng là lỗi biên dịch), **hai** `Kind` của `IConnectorFactory`, và
  `InProcessBroker.DisposeAsync` (cài đặt `IAsyncDisposable`). **13 trong 32**, nên câu hỏi *"có nên
  `public` không"* **không tồn tại** với chúng, đúng như hàng A1 nói.
  `IMachineSimulator.Descriptor` là **khai báo interface**, không phải cài đặt, nên nó không nằm trong
  13 ấy. 🔴 **Con số này viết "12" ở bản nháp đầu và SAI** — nó bỏ sót `InProcessBroker.DisposeAsync`,
  đúng loài lỗi mà luật "liệt kê trước, con số sau" tồn tại để bắt; bắt được bằng cách cộng ba nhóm lại
  và thấy tổng không ra 32.
* 🔴 **CỘT TRỐNG "CONSTRUCTOR" MÀ ĐỢT 11 MỞ NAY LÀ CỘT LỚN NHẤT CÒN LẠI: 15 trong 32 thành viên cuối là
  constructor** — 14 `public` cộng constructor `protected` của `SimulatorBase`. Tám constructor
  simulator, bốn constructor factory, hai constructor `Doc28ValidationException`, và `SimulatorBase`.
  **Bảng vẫn không có hàng nào cho chúng**, và **13 + 15 = 28**; bốn thành viên còn lại
  (`IMachineSimulator.Descriptor`, `SimulatorFactory.Create`, `ModbusDriverFactory.Create`,
  `OpcUaDriverFactory.Create`) không thuộc hàng nào trong bảy hàng cũ. Đo trên cây này, mọi lời gọi trực
  tiếp `new XSim(...)` **nằm trong test**; đường sản xuất duy nhất là `SimulatorFactory.Create`, **cùng
  assembly**. Nên với tám constructor simulator, `internal` là **C1 — miễn phí về IVT** và chỉ phá test;
  với `Doc28ValidationException` nó phá khả năng bắt kiểu ấy ngoài assembly. **Đây là một PHÁT HIỆN ĐƯA
  LÊN, không phải một hành động: chủ sở hữu cấm đổi mức truy cập, và không cái nào bị đổi.**
* 📐 **Phân loại `30 / 2 / 0`.** Hai ca Class 2 nêu đích danh: **`AssemblySim` ctor** (không có
  `configKind` nào tồn tại cho `ASSEMBLY`, nên câu duy nhất là một sự VẮNG MẶT) và
  **`OpcUaConnectorFactory.Kind`** (nêu một GIÁ TRỊ và lý do nó không trôi được). **Số 0 tái lập lần
  thứ SÁU** — và mục 12 §"đợt 12" ghi vì sao đó là một phát hiện về **LUẬT** chứ không phải về cụm.
---

---

## 38. `pollIntervalMs` là trường cadence DUY NHẤT không được kiểm miền, trên CẢ HAI bản đồ — trong khi hai trường kề nó thì có, và ba driver tiêu thụ nó

🔴 **CHỜ ANH.** Mở 2026-08-22 (AZ-1, mục 12 đợt 10). Đo bởi AY-1 (đợt 9) trong lúc viết chú thích;
**đợt 10 xác nhận lại trên mã VÀ chạy lại trên assembly đã dựng** trước khi mở mục này. Đợt 10
**KHÔNG thi hành** — nó viết tài liệu và không được sửa mã.

### 1. Đo được cái gì — LIỆT KÊ TRƯỚC, con số SAU

**Ba trường cadence/timing mà một bản đồ khai**, và cái đối xử với chúng khác nhau:

| trường | đường parse | giá trị ngoài miền |
|---|---|---|
| `readTimeoutMs` | `ParseOptionalPositiveInt(…, MaxReadTimeoutMs)` | **chặn**, cảnh báo qua `logWarning`, rơi về mặc định |
| `retries` | `ParseOptionalPositiveInt(…, MaxRetries)` | **chặn**, cảnh báo, rơi về mặc định |
| **`pollIntervalMs`** | gán thẳng `PollIntervalMs = map.PollIntervalMs` | 🔴 **lưu y như khai, im lặng** |

**Đo trên assembly đã dựng** (`net10.0-windows`, SDK 10.0.302), gọi thẳng hai `FromJson`:

```
Modbus  pollIntervalMs=0            -> stored 0,            EffectiveReadTimeoutMs=1000
Modbus  pollIntervalMs=-1           -> stored -1,           EffectiveReadTimeoutMs=1000
Modbus  pollIntervalMs=-2           -> stored -2,           EffectiveReadTimeoutMs=1000
Modbus  pollIntervalMs=-2147483648  -> stored -2147483648,  EffectiveReadTimeoutMs=1000
OpcUa   pollIntervalMs=0/-1/-2/-2147483648  -> stored y như khai
Modbus  readTimeoutMs=0/retries=0   -> warn ×2, ReadTimeoutMs=null, Retries=null
Modbus  readTimeoutMs=-1/retries=-1 -> warn ×2, ReadTimeoutMs=null, Retries=null
```

**Và cái giá trị ấy làm gì**, đo trên cùng runtime:

```
Task.Delay(0)            -> hoàn tất trong 0 ms
Task.Delay(-1)           -> CHƯA hoàn tất sau 750 ms   (Timeout.Infinite)
Task.Delay(-2)           -> ArgumentOutOfRangeException
Task.Delay(-3)           -> ArgumentOutOfRangeException
Task.Delay(int.MinValue) -> ArgumentOutOfRangeException
```

🔴 **Phép đếm của đợt 9 — *"cả hai driver"* — LÀ MỘT PHÉP ĐẾM THIẾU. Liệt kê người tiêu thụ trước
khi đếm: có BA.** `ModbusTcpDriver.ReadAsync` và `OpcUaDriver.ReadAsync` gọi
`Task.Delay(_map.PollIntervalMs, ct)` **trực tiếp**; `ModbusRtuDriver.ReadAsync` gọi
`Task.Delay(NextPollDelayMs(), ct)`, và `NextPollDelayMs()` là
`_readBackoff.DelayMsFor(_map.PollIntervalMs, …)`. Hai bản đồ, ba driver.

### 2. Ở đâu trong mã — trỏ bằng TÊN

`St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap.PollIntervalMs` và `.FromJson`;
`St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap.PollIntervalMs` và `.FromJson`;
`ModbusRegisterMap.ParseOptionalPositiveInt` (đường mà hai trường kia ĐI QUA và trường này thì không);
`ModbusTcpDriver.ReadAsync`, `OpcUaDriver.ReadAsync`, `ModbusRtuDriver.ReadAsync` +
`ModbusRtuDriver.NextPollDelayMs`; `ModbusRtuReadBackoff.DelayMsFor`;
`ModbusRegisterMap.EffectiveReadTimeoutMs`.

### 3. Hậu quả vận hành, HAI CHIỀU

*Chiều thuận.* **`0`** — vòng poll **không tiết chế**: mỗi lần lặp trả về ngay, nên một thiết bị
quay hết tốc lực. Trên RTU nó còn là vấn đề của **hàng xóm**, vì mỗi vòng lấy khoá phân xử của cả
bus. **`-1`** — `Task.Delay` chờ vô hạn, nên thiết bị được poll **đúng một lần rồi im**, và cái
`IAsyncEnumerable` ấy **không kết thúc** mà cũng **không sinh gì**: `Health` đứng ở giá trị của lần
poll đầu, và từ ngoài nhìn vào nó **không phân biệt được với một thiết bị khoẻ và chậm**.
**`≤ -2`** — `ArgumentOutOfRangeException`. Cả ba driver bọc lời gọi delay trong một `try` mà
`catch` **chỉ bắt `OperationCanceledException`**, nên nó **thoát khỏi iterator** — một hình dạng
khác hẳn hai cái trên và khác hẳn cái mà vòng poll được thiết kế để chịu.

*Chiều ngược, và nó thu hẹp mục này chứ không xoá nó.* **(a)** `EffectiveReadTimeoutMs` là
`ReadTimeoutMs ?? Math.Max(1000, PollIntervalMs * 4)` — **sàn 1000 đo được cho cả bốn giá trị xấu**,
nên một cadence âm **không** kéo theo read timeout hỏng, và `WorstCaseBusHoldMs` dựng trên nó cũng
lành. **(b)** Trên `ModbusRtuDriver` với backoff **sản xuất**, giá trị âm bị **che sau lần hỏng đầu
tiên** — đo được:

```
Default.DelayMsFor(poll=-2, hold=4000, failures=0) = -2      Disabled(...)= -2
Default.DelayMsFor(poll=-2, hold=4000, failures=1) = 4000    Disabled(...)= -2
Default.DelayMsFor(poll=-2, hold=4000, failures=5) = 60000   Disabled(...)= -2
```

nên trên RTU cái bẫy cắn **khi thiết bị KHOẺ**, và tự vá khi nó hỏng — thứ tự ngược với trực giác,
và là lý do một phép thử "cắm giá trị âm rồi xem nó có hỏng không" **có thể xanh**. **(c)** Không có
khách hàng nào đang báo lỗi này; nó đòi một bản đồ viết tay có giá trị âm hoặc `0`.

### 4. Nếu KHÔNG quyết định

Ba trường cạnh nhau trong cùng một tài liệu JSON tiếp tục có **hai luật khác nhau**, không ghi ở
đâu ngoài chú thích mà đợt 9 vừa viết lên chính hai property ấy. Và **cái phép đo này KHÔNG thấy**:
nó không mở `server/`, `client/` hay bất cứ người tạo bản đồ nào **ngoài repo này** — nếu một công
cụ sinh cấu hình ở nơi khác phát ra `pollIntervalMs: 0`, chỗ này im lặng về chuyện đó.
Ba hướng, **giá của cả ba, không đề xuất cái nào**: (i) **cho `pollIntervalMs` đi qua
`ParseOptionalPositiveInt`** — rẻ nhất, cùng khuôn với hai hàng xóm, nhưng nó **đổi HÀNH VI của một
bản đồ đang chạy** (một `0` đang chạy sẽ thành `1000`); (ii) **ném lúc parse** — to tiếng nhất và
đúng với "một cấu hình không chạy được thì bị từ chối ở chỗ vận hành viên được báo", nhưng nó biến
một fleet đang chạy với một bản đồ xấu thành một fleet **không khởi động**; (iii) **để nguyên và
chỉ ghi tài liệu** — chính là trạng thái hôm nay, và đợt 9 + đợt 10 đã trả phần tài liệu ấy.

### ✅ ĐÃ THI HÀNH 2026-08-23 (BD-1, base `889c72ab`) — kiểm miền đặt ở **BIÊN PARSE**, dùng lại **đúng luật của hai hàng xóm**, và **một bản triển khai hợp lệ cố ý dùng `0` được NÊU TÊN và KHÔNG bị giam

**Phán quyết:** 2026-08-23, **điều phối viên quyết theo uỷ quyền** (khuôn mục 8). Ba hướng ở §4 của
thân mục được cân; **chọn (i)** — cho `pollIntervalMs` đi qua đúng phép kiểm miền của hai hàng xóm.
Hướng (ii) bị loại vì nó biến một fleet đang chạy với bản đồ xấu thành một fleet **không khởi động**, một
bán kính nổ không cân xứng với một con số cadence — và chính `FromJson` đã viết sẵn lý lẽ ấy cho hai hàng xóm.

#### 1. Ba driver — **LIỆT KÊ trước, đếm SAU** — mở mã ra kiểm lại, không tin sổ

`ModbusTcpDriver.ReadAsync` (`Task.Delay(_map.PollIntervalMs, ct)` thẳng); `OpcUaDriver.ReadAsync`
(`Task.Delay(_map.PollIntervalMs, ct)` thẳng); `ModbusRtuDriver.ReadAsync` (qua `NextPollDelayMs()` ⇒
`_readBackoff.DelayMsFor(_map.PollIntervalMs, …)`). **Liệt kê xong mới đếm: BA.** Phép sửa của đợt 10
(*"cả hai driver"* ⇒ BA) **đứng vững** khi mở lại mã.

#### 2. Hai hàng xóm kiểm miền **theo một cách DUY NHẤT**, đo được — và đây là chỗ câu hỏi của brief có một nửa trả lời khác

`readTimeoutMs` và `retries` gọi **cùng một hàm** `ParseOptionalPositiveInt(root, name, maxValue,
logWarning)`, chỉ khác tham số trần (`MaxReadTimeoutMs` 60 000 / `MaxRetries` 5). **Không có hai cách —
có một.** Luật ấy được dùng lại nguyên văn: `> 0`, `<= trần`, vi phạm ⇒ **cảnh báo nêu tên trường +
rơi về mặc định**, không làm hỏng cả bản đồ.

🔴 **Nhưng chúng KHÔNG giống nhau ở một điểm, và điểm đó là một quyết định phải nêu chứ không được
nuốt.** Hai hàng xóm là `[JsonIgnore]` — chúng **không bind**, nên hàm trên đọc thẳng `JsonElement` thô và
một **SAI KIỂU** JSON cũng chỉ là cảnh báo. `PollIntervalMs` thì **có** bind. Bản sửa này **cố ý KHÔNG thêm
`[JsonIgnore]`**: `[JsonIgnore]` là thiết bị dung thứ **KIỂU** của hai hàng xóm, không phải phép kiểm
**MIỀN** của chúng, và thêm nó sẽ biến một lỗi đang **ỒN ÀO** (sai kiểu ⇒ ném) thành một lỗi **IM LẶNG** —
đúng chiều mà chính mục 38 gọi là hình dạng tệ nhất. **Một luật cho MIỀN, hai luật cho KIỂU, có chủ ý.**
Câu *"the ONE deliberate exception"* trong `FromJson` đã được **rút tại nguồn** kèm ngày (giữ nguyên văn).

🔴 **Và một nửa thứ hai của câu hỏi ấy: `OpcUaNodeMap` KHÔNG CÓ hàng xóm nào.** Tiêu đề mục nói *"hai
trường kề nó thì có"* — đo 2026-08-23, điều đó **đúng với `ModbusRegisterMap` và SAI với `OpcUaNodeMap`**:
bản đồ OPC-UA không khai `readTimeoutMs`, không khai `retries`. Trên nửa ấy bản sửa **nhập khẩu** một quy
ước chứ không khôi phục một quy ước. Phép kiểm được **NHÂN BẢN**, không chia sẻ — cùng khuôn mà file này
đã dùng cho `ValidateWritableNodes`/`ValidateCommands`, và vì thông điệp phải đọc là *"OPC-UA node map:"*.

#### 3. Cái trần — **SUY RA, không CHỌN**, và vì sao nó không phải một số tròn

`ParseOptionalPositiveInt` đòi một trần. **Một cái trần nêu quá nhỏ còn tệ hơn không nêu trần**, nên con số
không được bịa: bề mặt rộng nhất trong chính hệ sinh thái sản phẩm này cho phép tới `3_600_000`
(`server/routers/deviceAdapterRouter.ts`), nên mọi con số quanh `MaxReadTimeoutMs` sẽ **giam cấu hình mà
một bề mặt anh em chấp nhận**. Trần duy nhất **đo được từ chính kiểu này** là số học:
`EffectiveReadTimeoutMs` tính `PollIntervalMs * 4` trong `int`, nên trên `int.MaxValue / 4` tích ấy **tràn
âm** và `Math.Max(1000, …)` lặng lẽ trả về sàn 1000 — điểm mà lớp này **hết mô tả được hành vi của chính
nó**. `MaxPollIntervalMs = int.MaxValue / 4`, và nó là một **KHẢNG ĐỊNH** chứ không phải một câu:
`MaxPollIntervalMs_IsTheLargestValueEffectiveReadTimeoutMsCanMultiplyWithoutOverflow`. 🔴 **Phép tràn
ấy là một khuyết tật CÓ SẮN mà mục 38 không nêu**, tìm được trong lúc đi tìm cơ sở cho trần.

#### 4. Bề mặt **ĐỌC** — §8.1(h5.4), quét TOÀN CÂY, **LIỆT KÊ trước**

Đứng tại `tools/machine-simulator`, `scripts/repo-scan.sh --sha HEAD -l -i 'pollintervalms' -- ':(top)'`:
**100 file**, trong đó **45 file NẰM NGOÀI `tools/machine-simulator`** — chính là phần mà §4 của thân mục
khai là *"phép đo này KHÔNG thấy"*: `server/` (23), `client/` (4), `drizzle/` (13), `knowledge/` (2),
`scripts/sim-factory/` (2), `docs/ECOSYSTEM/` (1). **Chỗ trống ấy nay đã được mở.**

**Câu hỏi trọng tâm — có bản triển khai hợp lệ nào CỐ Ý dùng `0` để nói "poll nhanh nhất có thể" không?**
Ngoài repo này: **KHÔNG, và ngược lại.** Mọi bề mặt sinh cấu hình đo được đều áp một **SÀN DƯƠNG**:
`otConnectorManifests.ts` `min(100).max(60_000).default(1000)`; `deviceAdapterRouter.ts`
`min(100).max(3_600_000)`; `robotRouter.ts` `min(250).max(600000)`; `ursimHarness.ts` `Math.max(50, …)`;
và `connectionSupervisor.ts` đọc `opts.pollIntervalMs > 0 ? opts.pollIntervalMs : 5000` — tức nó coi
**`0` là "dùng mặc định"**, không phải "nhanh nhất có thể". Không bản triển khai nào bị giam.

🔴 **Trong repo này thì CÓ MỘT, và nó được NÊU TÊN thay vì bỏ qua:**
`ModbusMultidropBusTests.ASlowPollerIsNotStarved_ByThreeDevicesPollingFlatOut` dựng **ba** bản đồ với
`pollIntervalMs: 0`, nghĩa đúng là *"poll hết tốc lực"*, qua
`ModbusRtuLoopbackHarness.BuildSingleRegisterMap`. **Nó KHÔNG bị giam**, và không phải do may: hàm ấy dựng
bằng **object initializer**, không đi qua `FromJson`. Đặt phép kiểm ở **biên parse** — đúng chỗ hai hàng
xóm đặt phép kiểm của chúng — là thứ giữ nó sống. **Một phép kiểm đặt trên property sẽ phá bài test ấy**, và
`ProgrammaticConstruction_IsNotSubjectToTheParseTimeDomainCheck` ghim chính biên đó lại.

#### 5. Nhân chứng và **cặp đối chứng chạy trọn, hoàn nguyên**

Nhân chứng: `FromJson_RefusesNonPositivePollIntervalMs_WarnsAndFallsBackToTheDefault` (`0`, `-1`, `-2`,
`int.MinValue`) trên **cả hai** bản đồ; cộng trần, cộng
`FromJson_RefusingACadence_PreservesEveryOtherDeclaredField` (OPC-UA dựng lại bản đồ — một thao tác
**làm rơi mất một trường bằng cách quên nó**, nên mọi property đều được ghim).

**Cặp đối chứng A** — đặt lại `PollIntervalMs = map.PollIntervalMs` trên cả hai bản đồ, chạy trọn:
**11 đỏ / 129 xanh**, trong đó cả bốn giá trị xấu ở cả hai bản đồ — **`-1` đỏ trên cả hai**. Hoàn nguyên,
chạy lại: **140 xanh**.

🔴 #### 6. MỘT KHUYẾT TẬT CỦA CHÍNH BẢN SỬA NÀY, bắt được trước khi đo, và nay có nhân chứng đứng canh

Bản nháp đầu tiên dùng đúng `ParseOptionalPositiveInt` trên `JsonElement` thô — cái trông giống "dùng lại
y nguyên cách của hai hàng xóm" nhất. **Nó SAI.** `TryGetProperty` khớp **phân biệt hoa thường**, còn
binder thì **KHÔNG** (`PropertyNameCaseInsensitive = true`). Với một tài liệu viết `"PollIntervalMs": 250`
— một cách viết sản phẩm **đang chấp nhận hôm nay** — bản nháp ấy **thay một cadence hợp lệ bằng 1000, im
lặng**: tức nó tạo ra đúng hình dạng hỏng mà mục này tồn tại để diệt. Bản sửa đọc **giá trị ĐÃ BIND**, nên
nó **kế thừa đúng luật khớp tên của binder** và không thể bất đồng với phép bind. **Cặp đối chứng C:**
khôi phục nguyên văn bản nháp ⇒ **3 đỏ** (`PollIntervalMs`, `pollintervalms`, `POLLINTERVALMS`; cách viết
đúng hoa thường vẫn xanh, đúng như cơ chế tiên đoán) ⇒ hoàn nguyên ⇒ xanh.
`FromJson_KeepsAnInDomainPollIntervalMs_UnderEverySpellingTheBinderAccepts` đứng lại trên cả hai bản đồ.

#### 7. Cái bản sửa này **KHÔNG** làm — nêu đủ rộng

* **Không chạm đường dựng bằng mã.** Mọi hình dạng hỏng thân mục ghi — `0`, `-1`, `<= -2` — **vẫn tái
  lập được** cho một bản đồ dựng bằng object initializer. Đó là giá của việc giữ bài test fairness sống.
* **Hai bề mặt vẫn nuốt cảnh báo.** `ConnectorConfigValidation.TryValidateOpcUa` và
  `St4i.EngineApi.Program` gọi `OpcUaNodeMap.FromJson` **không truyền sink**, nên trên hai đường ấy một
  cadence xấu bị sửa **lặng lẽ**. Phần dư, nêu tên chứ không im.
* **Không kiểm `readTimeoutMs`/`retries` viết hoa.** Cùng bẫy hoa-thường ở §6 **vẫn sống** cho hai hàng
  xóm: chúng là `[JsonIgnore]`, nên `"ReadTimeoutMs": 3000` bị **bỏ qua hoàn toàn**, không cảnh báo.
  **Không sửa ở đây** — nó ngoài mục 38 và chưa ai phán. **Ghi làm phát hiện.**

---

## 39. `"registers": null` / `"nodes": null` thoả `required`, bind một null thật, rồi ném `NullReferenceException` TRẦN

🔴 **CHỜ ANH.** Mở 2026-08-22 (AZ-1, mục 12 đợt 10). Đo bởi AY-1 (đợt 9); **đợt 10 chạy lại trên
assembly đã dựng** trước khi mở mục này. Đợt 10 **KHÔNG thi hành**.

### 1. Đo được cái gì — LIỆT KÊ TRƯỚC, con số SAU

**Bốn ca, hai bản đồ, một lần chạy** trên assembly đã dựng:

```
Modbus registers:null    -> NullReferenceException: [Object reference not set to an instance of an object.]
Modbus registers ABSENT  -> JsonException: [... was missing required properties including: 'Registers'.]
OpcUa  nodes:null        -> NullReferenceException: [Object reference not set to an instance of an object.]
OpcUa  nodes ABSENT      -> JsonException: [... was missing required properties including: 'Nodes'.]
```

**Cơ chế, nêu chứ không suy:** `required` của C# được thoả bằng việc **KHOÁ CÓ MẶT** trong JSON, chứ
không phải bằng việc giá trị khác `null`. Một `null` tường minh **đi qua** phép kiểm ấy và bind vào
một property khai là non-nullable; câu lệnh kế tiếp trong `FromJson` đọc `.Count` trên nó.
**Thông điệp không nêu file, không nêu trường, không nêu mã máy** — nó là chuỗi mặc định của CLR.

🔴 **Và đây là đúng hình dạng mà `ModbusRegisterMap.FromJson` TỰ GHI là đã sửa cho `commands`**, ở
một chú thích trong chính phương thức ấy tự gọi mình là *"the one parse failure in this method that
didn't name what was wrong"* — câu đã được **rút tại chỗ** bởi đợt 9 vì đo được **ít nhất hai**.

### 2. Ở đâu trong mã — trỏ bằng TÊN

`ModbusRegisterMap.Registers` (`public required IReadOnlyList<ModbusRegister>`), đọc ở
`ModbusRegisterMap.FromJson`; `OpcUaNodeMap.Nodes` (`public required IReadOnlyList<OpcUaNode>`), đọc
ở `OpcUaNodeMap.FromJson` (`if (map.Nodes.Count == 0)`); `ModbusRtuConnectorFactory.TryCreate`,
`ModbusConnectorFactory.TryCreate` và `OpcUaConnectorFactory.TryCreate` — nơi mọi throw từ hai
`FromJson` ấy trở thành một chuỗi `error` cho vận hành viên.

### 3. Hậu quả vận hành, HAI CHIỀU

*Chiều thuận.* Một vận hành viên hoặc một công cụ sinh cấu hình viết `"registers": null` thay vì bỏ
khoá — điều một serializer phát ra một cách hoàn toàn bình thường cho một danh sách rỗng chưa gán —
nhận lại **`"Object reference not set to an instance of an object."`** và **không có gì để hành
động**: không tên file, không tên trường, không mã máy. Với `TryCreate` bọc ngoài, chuỗi ấy là
`ex.Message` **nguyên vẹn**, nên đó chính xác là thứ hiện lên chỗ khởi động connector. Đối chứng
đứng ngay cạnh và làm cái giá rõ ràng: **cùng lỗi ấy với khoá VẮNG** cho một `JsonException` **nêu
đích danh trường**.

*Chiều ngược.* **(a)** Không tiến trình nào chết: `IConnectorFactory.TryCreate` có hợp đồng
**không-bao-giờ-ném** và cả ba cài đặt bọc trọn thân hàm, nên hậu quả là **một thông điệp vô dụng**,
không phải một fleet đổ. **(b)** Đường **VẮNG khoá** — ca thường gặp hơn — đã đúng và đã có nhân
chứng; cái hỏng là ca `null` tường minh. **(c)** Sửa nó là **sửa mã trên đường parse mà cả hai
driver fieldbus đi qua**, tức đúng đường mà mục 12 vừa đi qua để viết tài liệu, và giá của nó phải
đo bằng test chứ không bằng lập luận.

### 4. Nếu KHÔNG quyết định

Hai `FromJson` giữ **một ca chẩn đoán trần** mỗi cái, và bản ghi duy nhất về nó là chú thích đợt 9
viết lên chính hai property ấy cộng mục này. **Cái phép đo này KHÔNG thấy:** nó mở đúng hai trường
(`registers`, `nodes`) trên hai bản đồ ấy; **không** ai đã mở HẾT tập các property `required` khác
trong cây để xem còn chỗ nào cùng hình dạng — nêu tên chứ không đoán.

### ✅ ĐÃ THI HÀNH 2026-08-23 (BD-1, base `889c72ab`) — **HAI ca đo RIÊNG**, và không thêm một chỗ ném không nêu tên

**Phán quyết:** 2026-08-23, **điều phối viên quyết theo uỷ quyền** (khuôn mục 8).

#### 1. `required` **thật sự hứa gì** — và vì sao đây là HAI ca chứ không phải một

`required` của C# được `System.Text.Json` thoả bằng việc **KHOÁ CÓ MẶT**, không phải bằng việc giá trị
khác `null`. Hai ca, **đo riêng, hai cơ chế khác hẳn**:

| ca | cơ chế | trước | sau |
|---|---|---|---|
| `"registers": null` / `"nodes": null` **tường minh** | qua được phép kiểm required, bind một null thật, `.Count` ném | 🔴 `NullReferenceException` **trần** | `InvalidOperationException` **nêu trường + mã máy** |
| khoá **VẮNG** | binder từ chối, **không bao giờ dựng đối tượng** | `JsonException` nêu `'Registers'`/`'Nodes'` | **KHÔNG ĐỔI** |

🔴 **Ca thứ hai đã đúng từ trước, và việc nó KHÔNG ĐỔI là một kết quả phải đo chứ không được giả định** —
một phép kiểm null đặt sau một lần bind thành công rất dễ **nuốt** ca không-có-bind.
`FromJson_Absent*Key_StillFailsInTheBinderNamingTheProperty` ghim nó trên cả hai bản đồ, và **cặp đối
chứng B chứng minh nó đang đo một cơ chế KHÁC**: tắt hai phép kiểm null ⇒ **chỉ 2 đỏ**, đúng hai bài ca-1,
hai bài ca-2 **vẫn xanh**.

Ca thứ **ba** trong cùng họ được ghim luôn cho đủ tập chứ không lấy mẫu: mảng **RỖNG** ⇒
`InvalidOperationException` nêu trường. **Ba đầu vào, ba kết cục, không cái nào còn là chuỗi mặc định của CLR.**

#### 2. Thông điệp nêu **trường nào** và **máy nào** — còn **file nào** thì nói thật về chỗ nó đến từ đâu

🔴 Đợt 12 đo được **sáu trong 34 chỗ ném của `Doc28Parser` không nêu tên file**, và yêu cầu là **đừng thêm cái
thứ bảy**. Đo trước khi viết: **`FromJson` nhận VĂN BẢN, không nhận đường dẫn** — nó **không có** tên file
để nêu, và bịa một cái sẽ tệ hơn im. Cái nó CÓ là **tên trường** và **mã máy** (đã được kiểm khác rỗng ngay
trên), và cả hai đều vào thông điệp. **Tên file do khung CÓ đường dẫn nêu**, và nó đã nêu sẵn:
`St4i.EngineApi.Program` bọc đúng thông điệp này trong `'{MapPath}'`. Đó là **câu trả lời đo được** cho yêu
cầu "nêu file", chứ không phải một lối né: tầng biết đường dẫn nêu đường dẫn, tầng biết trường nêu trường.

⚠️ **Nửa bất lợi, nói ra:** `ModbusConnectorFactory.TryCreate` / `OpcUaConnectorFactory.TryCreate` /
`ConnectorConfigValidation` **không có file** — cấu hình tới từ `connectors.json` hoặc một cột DB dưới dạng
blob. Trên những đường ấy vận hành viên nhận **trường + mã máy và KHÔNG có tên file**, vì không có tên file
nào tồn tại để nêu. Mã máy là định danh hành động được ở đó.

#### 3. Phần thân mục tự nêu là **KHÔNG THẤY** — vẫn chưa thấy, và nói ra chứ không đoán

§4 của thân mục viết: *"không ai đã mở HẾT tập các property `required` khác trong cây để xem còn chỗ nào
cùng hình dạng"*. **Nhiệm vụ này cũng KHÔNG mở hết tập đó.** Nó sửa đúng hai trường mà mục 39 nêu tên.
**Một câu phủ định tồn tại chỉ đúng nếu đã mở hết tập**, nên ở đây không có câu phủ định nào được viết.
Chỗ trống đó **đi tiếp**, không đóng theo mục này.

---

## 40. Một dụng cụ TỰ KIỂM có thể mù đúng ở đường mặc định của chính nó, và cổng vẫn xanh

🔴 **CHỜ ANH.** Mở 2026-08-22 (BA-1). Khuyết tật tìm bởi **AZ-1** (mục 12 đợt 10), điều phối viên **xác
nhận độc lập hai lần**. AZ-1 **không sửa** vì nó nằm ngoài ba sản phẩm của nó — lựa chọn đúng. BA-1 **đã
sửa dụng cụ**; **cái CHỜ ANH là cơ chế ở §4**, không phải bản sửa.

### 1. Đo được cái gì — LIỆT KÊ TRƯỚC, con số SAU

**(a) Khuyết tật gốc.** `scripts/repo-scan.sh` là dụng cụ dựng **CHO mục 32** — mục nói rằng *một phép
quét thu hẹp trả 0 chứ không báo lỗi, nên 0-hit-đúng và 0-hit-vì-pathspec không phân biệt được*. Đứng tại
`tools/machine-simulator`, ở `89018893`:

```
git grep --full-name -l 'class' HEAD -- ':(top).'   ->     0      (và 0 từ CẢ repo root)
git grep --full-name -l 'class' HEAD -- ':(top)'    ->  1804
git grep --full-name -l 'class' HEAD                ->   641      (thu về cwd)
```

`repo-scan.sh:161` — `[[ ${#SPECS[@]} -eq 0 ]] && SPECS=(".")` ⇒ `rewrite_pathspec` ⇒ `:(top).`. Dụng cụ
**in** *"1 means NO MATCH, which is a measurement, not an error"*, nên số 0 ấy được **trình bày như một
kết quả đã kiểm**. Đó là mục 32, do dụng cụ của mục 32, trong **ba** vòng nhiệm vụ.

**(b) Vì sao `--self-test` xanh suốt thời gian ấy — và đây là hạt nhân của mục này.** Ba khẳng định của
nó là *bất biến theo cwd*, *không rỗng*, *hazard còn sống*; **cả ba đều truyền pathspec tường minh**, nên
**không cái nào đi qua đường mặc định**. Cái duy nhất nói về mặc định là bất biến-theo-cwd — và **mặc
định hỏng ĐÚNG LÀ bất biến theo cwd: bất biến bằng 0**, đo được từ cả hai thư mục. **Khuyết tật THOẢ phép
kiểm.** Một dụng cụ tự kiểm mù **đúng ở chỗ** đối tượng của nó mù.

**(c) Quét hai dụng cụ kia cùng loài — LIỆT KÊ rồi mới ĐẾM.** Quần thể là **ba** dụng cụ mà
`verify-suites.sh` chạy làm cổng: `repo-scan.sh --self-test`, `check-owner-decisions.sh`,
`scan-doc-negations.sh --since`. Loài: *một quần thể có thể RỖNG, mà công cụ vẫn in một con số như thể đã
đo*. Kết quả, **hai trong ba** có nó ngoài `repo-scan.sh` — tức **cả ba**:

* `check-owner-decisions.sh` — **CÓ, và tái lập được.** C1–C4 đều là vòng `for` trên một quần thể mà
  parser phục hồi từ **văn xuôi** bằng regex. Một file mang banner Phần I và **một** marker liệt kê
  sống, **không bảng phán quyết, không thân mục**, cho `verdict rows : 0 · body sections : 0 ·
  DIVERGENCES : 0 · exit 0`. Tập rỗng thoả mọi khẳng định phổ quát.
* `scan-doc-negations.sh` — **CÓ, ở hai chỗ, hỏng theo hai chiều NGƯỢC nhau.** `scan_into` gặp danh sách
  file rỗng thì ghi `0 câu / 0 hit` **không nói một lời**; và `--since` — **chế độ cổng chạy** — trước hôm
  nay **không in kích thước quần thể nào cả**, nên một corpus rỗng cho `NEW absolute doc claims : 0` +
  `PASS`. Chiều kia: corpus **BASE** rỗng làm **mọi** câu hiện tại thành "mới", tức đỏ với một con số
  thuần hiện vật. Cả hai **không** với tới được qua corpus mặc định hôm nay (`find` trả 546 file `.cs`) —
  nêu ra chứ không phóng đại.

**(d) Một loài THỨ HAI, tìm được lúc kiểm lại quần thể khẳng định, và không dụng cụ nào ở đây bắt được
nó.** `GatewayTcpBusLink.InfiniteTimeout` công bố *"Measured over every tracked `*.cs` (20 lines)"*. Đo
lại cùng phép quét:

```
tools/machine-simulator/*.cs @ 3f564039  (BASE lúc viết)   -> 20
tools/machine-simulator/*.cs @ 9da2b2f6  (commit CÔNG BỐ)  -> 22
```

Con số **đúng lúc đo và sai trong chính commit xuất bản nó**: hai dòng thêm vào là **câu văn ấy**. 🔴 **Một
phép quét toàn cây tìm một CHUỖI, mà kết quả được viết ngược lại vào chính cái cây vừa quét, tự vô hiệu
hoá con số của nó trong cùng một commit.** Đã **rút tại chỗ kèm ngày**, không xoá dòng nào.

🔴 **Và loài ấy cắn ngay chính dụng cụ vừa dựng để bắt nó — đo được, không phải một ví dụ nghĩ ra.**
Khẳng định `(f)` mới ("không-khớp-thật vẫn phải báo exit 1") dùng một pattern chắc chắn vắng, và bản
đầu viết nó thành **một literal**: `zzq-no-such-pattern-zzq`. Nó **xanh khi chạy tay** — lúc ấy phép
quét đọc `HEAD = 89018893`, chưa có dòng đó — rồi **ĐỎ ở lần chạy cổng đầu tiên sau khi commit**, vì
literal ấy nay **nằm trong chính cái cây mà phép thăm dò quét**, nên phép quét *"không-khớp"* **tìm
thấy chính mình** và trả exit 0. Chữa bằng một **nonce sinh lúc chạy**: một chuỗi vừa tạo ra thì không
thể nằm trong một commit. **Ba lần trong nhiệm vụ này, bộ khẳng định mới bắt lỗi của chính người viết
nó** — `ls-tree` sai ngữ nghĩa pathspec, `length()` định kiểu scalar trong `awk`, và cái này.

### 2. Ở đâu trong mã — trỏ bằng TÊN

* `scripts/repo-scan.sh:161` ở `89018893` — `SPECS=(".")`. Nay là `default_pathspec()`, trả `:(top)`.
* `scripts/repo-scan.sh` `self_test()` — ba khẳng định cũ `(a)(b)(c)`, **cả ba** với pathspec tường minh.
* `scripts/check-owner-decisions.sh` khối `END` — `C1`–`C4`, vòng `for` trên `rowline`/`bodypart`.
* `scripts/scan-doc-negations.sh` `scan_into()` — nhánh `[[ ! -s "$2" ]]` ⇒ `printf '0\t0\n'`.
* `src/St4i.EdgeCore/Drivers/Modbus/GatewayTcpBusLink.cs` — `InfiniteTimeout`, literal `20 lines`.

### 3. Hậu quả vận hành, HAI CHIỀU

**Chiều thuận — vì sao nó nguy hiểm chứ không chỉ hỏng.** `0` là **hình dạng của "không có ở đó"**, đúng
loài mục 32 tồn tại để chặn. §8.1(f) **LỆNH** mọi nhiệm vụ dùng dụng cụ này cho phép quét toàn cây, và ba
nhiệm vụ sau `cfcfae42` đã được lệnh ấy. Một phủ định tồn tại là thứ **đắt nhất** để sai, vì nó chỉ đúng
nếu người viết đã **mở hết tập** — và ở đây cái vỏ bọc **vi phạm luật ấy giùm nhiều người cùng lúc**.

🔴 **Chiều ngược, và nó THU HẸP thiệt hại — nói ra vì một sự thật viết chỉ theo chiều thuận là một nửa sự
thật.** Mặc định hỏng trả **0 vô điều kiện**. Nên **bất kỳ khẳng định nào mang một con số KHÁC 0 đều
KHÔNG THỂ đã đi qua nó** — con số ấy tự chứng minh miền của nó không rỗng. Bộ lọc đó cắt quần thể
`cfcfae42..HEAD` xuống còn các câu **dựa trên một kết quả 0**. BA-1 liệt kê rồi kiểm quần thể ấy, và
**hai** câu sai tìm được **sai vì lý do KHÁC**: một vì **tự tham chiếu** (d), một vì một **quần thể cũ**
(`ModbusRegisterMap.PollIntervalMs` nói *"Both drivers"* trong khi mục 38 cùng cửa sổ đã đo được **BA** —
sổ được sửa, **NGUỒN thì không**, suốt một vòng nhiệm vụ). **Không câu nào trong quần thể được tìm thấy
là sai VÌ khuyết tật này.** Đó là một kết quả **may**, không phải một sự bào chữa: cùng cái vỏ ấy sẽ
biến bất kỳ phủ định tồn tại nào tiếp theo thành một số 0 trông sạch sẽ.

### 4. Nếu KHÔNG quyết định — cái gì CƯỠNG CHẾ được, và cái gì KHÔNG

**Cưỡng chế được, và đã cưỡng chế hôm nay:**

1. **Một ca self-test đi ĐÚNG đường mặc định.** `repo-scan.sh --self-test` nay chạy chính CLI của mình
   **không pathspec** như một tiến trình con, và đòi mặc định phủ **toàn cây**. Đỏ-được: **ba** cặp đối
   chứng chạy trọn rồi hoàn nguyên — đặt lại `SPECS=(".")` ⇒ đỏ ở `(g)`; `default_pathspec()` trả `.` ⇒
   đỏ ở `(d)` **và** `(g)`; tắt từ chối miền-rỗng ⇒ đỏ ở `(e)`.
2. **Phân biệt được KHÔNG-KHỚP-THẬT với PATHSPEC-KHÔNG-KHỚP-GÌ.** Miền được **đếm trước khi chạy
   pattern**; miền rỗng bị **TỪ CHỐI (exit 2)**, không in một con số. Nên câu *"1 nghĩa là không khớp,
   đó là một phép đo"* **thành đúng** thay vì chỉ được in ra: exit 1 chỉ tới được khi có một miền khác
   rỗng đứng sau nó. Hai bờ đều bị ghim: miền rỗng ⇒ 2, không-khớp-thật trên miền thật ⇒ 1.
3. **Khẳng định KHÔNG-RỖNG trên hai dụng cụ kia.** `C0` cho `check-owner-decisions.sh`; ba guard quần thể
   cho `scan-doc-negations.sh`, cộng việc **in cả hai corpus** trong `--since`.

🔴 **KHÔNG cưỡng chế được — nêu tên, vì một cái trần nêu quá nhỏ còn tệ hơn không nêu trần:**

* **Không gì bắt được một self-test mà phép thử của nó chưa bao giờ đi qua một nhánh.** Đó là **độ phủ**,
  và repo này **không có** dụng cụ đo độ phủ cho shell. Mục này được tìm bằng một con người đọc, đúng như
  mục 37 được tìm bằng một con người đọc. Ba khẳng định mới hôm nay đóng **ba** đường đã biết; chúng
  **không** nói gì về đường thứ tư.
* **Không gì buộc ai chạy cặp đối chứng.** Một khẳng định mới có thể được thêm vào bất kỳ self-test nào
  mà **chưa từng được chứng minh là đỏ-được**, và cổng sẽ xanh. Đây là **tiền lệ**, không phải cơ chế.
* **Không gì bắt được loài (d).** Không cổng nào biết một con số trong một chú thích **đến từ** một phép
  quét cái cây chứa chú thích ấy. Cách chữa duy nhất đã biết là **thói quen**: chạy lại phép quét và
  trích dẫn lần chạy, đừng tin một literal — đúng thứ mục 26 đã kết luận cho trần census của nó, nay
  gặp lại ở một mặt khác.
* **Không gì làm cho ai đó DÙNG dụng cụ.** Ranh giới (a) của chính `repo-scan.sh` đã nói vậy từ đầu, và
  bản sửa hôm nay **không** đổi điều đó.

**Câu hỏi để anh phán:** cổng có nên đòi rằng **mỗi khẳng định của mỗi dụng cụ tự kiểm phải kèm một cặp
đối chứng đã chạy** — tức một dụng cụ đo dụng cụ ở tầng thứ ba — hay đó là chi phí quá lớn và **tiền lệ
cộng một con người đọc** là cái trần đúng? Điều phối viên **không tự quyết**. Cái đã trả nằm ở §4 mục 1–3;
cái chưa trả là **cơ chế**.

### ✅ ĐÃ THI HÀNH 2026-08-23 (BD-1, base `889c72ab`) — hai món nợ trả, và **câu hỏi trung tâm được trả lời bằng "LUẬT ẤY KHÔNG CƯỠNG CHẾ ĐƯỢC"**

**Phán quyết:** 2026-08-23, **điều phối viên quyết theo uỷ quyền** (khuôn mục 8).

#### 1. `G1` — **GIỮ**, và quyết định này là một PHÉP ĐO chứ không phải một lập luận

Câu hỏi đúng — *"guard này có phải cái tạo ra màu đỏ trên đường cổng THẬT SỰ đi không"* — được trả lời bằng
cách **ép quan trắc**: `corpus_of` trả danh sách rỗng **chỉ cho `$SIMROOT`** (nên corpus BASE vẫn đầy đủ,
không lẫn với `G2`), rồi chạy ba cách:

```
G1 có,      --since   -> exit 2, từ chối tại G1
G1 tắt,     --since   -> exit 2, từ chối tại G3 (NOW_SENT)
G1 tắt,     --census  -> exit 0, "corpus : 0", "FLAGGED : 0"     [XANH]
```

**Dòng hai là phép đo kết tội `G1`:** trên `--since` — **mode DUY NHẤT `verify-suites.sh` chạy** — `G1`
**không phải** cái tạo ra màu đỏ; `G3` bắt cùng đầu vào. **Dòng ba là phép đo tha bổng nó:** vùng phủ riêng
của nó là `--census`, và gỡ nó đi thì **đặt lại đúng khuyết tật của mục 40 vào đó** — một số 0 in ra kèm exit 0.
Lý do thứ hai, nhỏ hơn nhưng thật: bỏ `G1` thì thông điệp `--since` thành *"0 files were read and they
contain ZERO doc-comment sentences"* — một câu **giả định đã đọc file** và đẩy người đọc đi tìm nhầm chỗ.

🔴 **`G1` được TỰ DÁN NHÃN ngay tại nguồn là *"guard, KHÔNG phải nhân chứng đường cổng"***, kèm cả ba
dòng đo ở trên, để không ai đếm nó vào vùng phủ của cổng.

🔴 **Và liệt kê lại quần thể tìm ra cái THỨ TƯ, chưa ai canh:** `BASE_SENT` được đọc, được **in ra**, và
**không bao giờ được kiểm**. `G2` canh **số FILE** của corpus base; một cây base có hàng trăm `*.cs` mà
**không câu doc-comment nào** làm **mọi** câu hiện tại thành "mới" ⇒ đỏ với một con số thuần hiện vật ⇒ người
sau **nâng `--expect`** cho xanh. §1(c) của thân mục nêu bản số-file của lỗ này rồi **dừng ở đó**. `G4` đóng
bản số-câu. **Đỏ được trên đúng argv của cổng** (`--since cfcfae42 --expect 203`): ép `BASE_SENT=0` ⇒ exit 2
kèm thông điệp nêu `545 *.cs nhưng ZERO doc-comment sentences` ⇒ hoàn nguyên ⇒ xanh.

#### 2. `C0` — **nay PHÂN BIỆT ĐƯỢC Phần II TRỐNG với Phần II HỞ NG**, bằng `C6`

Chỗ hỏng, đo từ mã: `C0` khẳng định hai quần thể **TOÀN CỤC** khác rỗng; `seen_part[]` được ghi ở dòng 103
và **không bao giờ được đọc lại**; không có phép đếm theo phần nào. Nên *"Phần II rỗng vì đã trả hết"* và
*"Phần II rỗng vì parser mất dấu thân mục"* cho **cùng một đầu ra từng byte**. **Từ 2026-08-22 đây không còn là
giả thuyết** — Phần II trống thật.

**Hình dạng bản sửa suy từ cách hỏng, không phát minh:** Phần I **đã** có cơ chế đúng — một **trường máy**
khai quần thể, và `C3` đòi **khai báo == phân tích được**. `C6` nhân bản nó cho Phần II. 🔴 **Vì sao là
ĐẲNG THỨC chứ không phải `count > 0`:** `count > 0` sẽ **SAI hôm nay** — rỗng là một trạng thái **hợp lệ**, và
một phép kiểm đòi nó khác rỗng là đòi một lời nói dối. **Một đẳng thức giữa hai tập vẫn nói được điều gì đó
khi cả hai rỗng** — đó chính là cách thoát khỏi *"tập rỗng thoả mọi khẳng định phổ quát"*.

**Cặp đối chứng, ba chiều, chạy trọn rồi hoàn nguyên** — chiều thứ hai chạy trên **đúng argv cổng dùng**
(không `--file`), trên chính file thật:

```
trường bị xoá                          -> C6 "PART II declares no population"        exit 1
trường khai [12], phân tích được []      -> C6 "declares [12]; actually contains []"   exit 1
BANNER Phần II bị hỏng (em dash -> -)   -> C6 "declares no population"               exit 1
```

🔴 **Chiều thứ ba là cái `C0` KHÔNG BAO GIỜ thấy được**: banner hỏng thì các thân mục Phần II bị quy cho
Phần I trong im lặng, và hôm nay — khi Phần II rỗng — **không có gì bị quy nhầm, nên `C0` xanh**.

#### 3. 🔴 Câu hỏi trung tâm: **cái gì cưỡng chế được luật ấy trên MỌI dụng cụ tương lai?**

**Câu trả lời: KHÔNG GÌ CƯỠNG CHẾ ĐƯỢC CHÍNH LUẬT ẤY, và đây là lý do đo được chứ không phải một lời từ chối.**
Luật là một phát biểu về **QUAN HỆ** giữa một khẳng định và tập mà nó lượng hoá trên — *"cái vòng lặp này
chạy trên đúng quần thể mà guard kia đã đo"*. Xác lập điều đó là một tính chất **luồng dữ liệu / độ phủ**
của một chương trình shell, và repo này **không có dụng cụ đo độ phủ cho shell** — đúng điều §4 của thân mục
đã nói, và chính khuyết tật này được tìm bằng **một con người đọc**.

**Cái CƯỠNG CHẾ ĐƯỢC là PHÉP KHAI BÁO, và chỗ đặt nó đã có sẵn.** Mọi dụng cụ cổng chạy đều đi qua **một**
hàm: `run_tooling_check`. Đó là tính chất làm cho cơ chế này **tổng quát** thay vì là ca đặc biệt thứ tư
đóng đinh vào ba script đã biết. **Giao thức:** một tooling check **THÀNH CÔNG** phải in ít nhất một dòng
`POPULATION <nhãn> <số>`, và **mọi số phải > 0**. Một dụng cụ mới thêm vào **thừa kế ràng buộc ấy chỉ bằng
việc được thêm vào**, không ai phải nhớ gì.

**Giá của hai ứng viên kia, đo rồi loại:** *(i)* một hàm dùng chung mọi dụng cụ phải gọi — rẻ nhất, **cưỡng
chế KHÔNG GÌ**: không gì bắt một script mới phải `source` nó. *(ii)* một phép kiểm meta đọc các script —
cưỡng chế **cú pháp**, và thoả được bằng cách gọi hàm ấy trên một thứ hiển nhiên khác rỗng — tức **đúng loài
của mục 40 nâng lên một tầng**, một thứ tệ để dựng trong lúc đang sửa mục 40. Giao thức được chọn **không
mạnh hơn về LOẠI** — nó mạnh hơn về **CHỖ ĐẶT**.

🔴 **Cái giao thức này KHÔNG làm — nêu đủ rộng, vì một cái trần nêu quá nhỏ còn tệ hơn không nêu trần:**

* **Nó không kiểm được rằng quần thể được KHAI chính là quần thể đã được LƯỢNG HOÁ TRÊN.** Một dụng cụ
  tương lai có thể khai corpus A và vòng lặp trên corpus B, và cổng xanh. Nó biến **"rỗng trong im lặng"**
  thành **"phải nói dối tường minh"**. Đó là toàn bộ phần cải thiện, không hơn.
* **Không gì buộc ai chạy cặp đối chứng** — và đây là **câu hỏi thân mục đặt cho chủ sở hữu**. Quyết, theo
  uỷ quyền: **KHÔNG dựng dụng cụ tầng thứ ba.** Lý do đo được: một dụng cụ như thế chỉ xác lập được rằng
  **một cặp đối chứng ĐÃ CHẠY**, không xác lập được rằng nó **đã đột biến đúng thứ khẳng định ấy dựa vào** —
  cùng hố quan-hệ-không-quan-sát-được ở trên, lần này ở tầng ba. **Tiền lệ cộng một con người đọc** là cái
  trần đúng, và nó có hồ sơ: mục 37 và mục 40 **đều được tìm bằng một con người đọc**, không bằng một cổng.
* **Không gì bắt được loài (d)** — một con số trong chú thích **đến từ** một phép quét cái cây chứa chú thích
  ấy. Không đổi so với BA-1.
* **Không gì làm cho ai đó DÙNG dụng cụ.** Không đổi.

#### 4. Đỏ được trên **đường cổng chạy**, và một nhãn trung thực về chỗ phép đo ấy yếu

`G4` và `C6` **đỏ được trên đúng argv cổng dùng** (§1 và §2 trên). ⚠️ **Giao thức POPULATION thì khác, và
nói thật ở đây:** nó sống trong `verify-suites.sh`, nên màu đỏ của nó chỉ quan sát được trong **một lần
chạy cổng đầy đủ**. Cái đã quan sát được ghi ở báo cáo nhiệm vụ; cái **chưa** quan sát được cũng ghi ở đó,
không được suy ra từ *"logic nó đúng"*.

---

## 17. `QueryTelemetryAsync` là truy vấn hướng khách hàng DUY NHẤT không áp cổng xuất xứ, và nó KHÔNG áp được: bảng không có cột để lọc

> 🔴 **ĐẶT LẠI ĐÚNG PHẦN — 2026-08-22 (AW-1). MỤC NÀY VỀ PHẦN I TỪ PHẦN III, VÀ KHÔNG MỘT DÒNG NÀO
> BÊN DƯỚI BỊ SỬA HAY XOÁ.** Cả thân mục gốc lẫn toàn bộ ghi chép thi hành của AU-1 giữ **nguyên
> văn**; thứ đổi là **chỗ đứng của mục**, và khối này ghi lại vì sao.
>
> **Suy từ định nghĩa của ba phần, không từ dấu ở đầu ô — và thứ tự suy là bắt buộc, vì đọc dấu ✅
> chính là cách chỗ lệch này được tạo ra.**
> * **Phần III = *"ĐÃ QUYẾT VÀ ĐÃ THI HÀNH"*.** Ô bảng của mục này tự khai **"ĐÃ THI HÀNH MỘT
>   PHẦN"**. Chữ *"MỘT PHẦN"* phủ nhận đúng vế thứ hai của điều kiện vào. Không cần đọc thêm gì.
> * **Phần II = *"ĐÃ QUYẾT, VIỆC CÒN NỢ"*** — banner của nó viết rõ: *"đã có một phán quyết ghi kèm
>   ngày, và **việc** của nó chưa được thi hành."* Ở mục 17 **không còn việc nào**: cơ chế đã ship,
>   `QueryTelemetryAsync` **gọi chính** `ApplyRealPresenceGateAsync`, endpoint nhận `includeFabricated`,
>   bảy `[Fact]` mới, hai đối chứng đã chạy trọn và đã hoàn nguyên. Không dòng mã nào còn phải viết.
> * **Thứ còn treo là MỘT QUYẾT ĐỊNH** — mặc định của `GET /v1/historian/telemetry` — và AU-1 nêu tên
>   nó bằng đúng những chữ này: *"Nửa còn nợ, nêu tên chứ không im lặng: **chọn mặc định là việc CỦA
>   ANH**."* **Phần I = *"ĐANG CHỜ ANH"*.** Một quyết định đang chờ chủ sở hữu ở Phần I theo định
>   nghĩa của Phần I.
>
> 🔴 **Ba tiền lệ trong chính file này, cùng hình dạng, và chúng phân biệt được I với II:** mục **12**
> mang tiêu đề *"PHÁN QUYẾT ĐÃ THI HÀNH **MỘT PHẦN**"* và **ở lại Phần II** — vì cái nó còn nợ là
> **VIỆC** (món nợ tài liệu), không phải một quyết định; mục **27** có phán quyết mà chưa có ghi chép
> thi hành và **ở lại Phần I**; mục **16** bị AQ-1 dừng và **ở lại Phần I**. Nên luật đọc được từ hồ
> sơ là: *"MỘT PHẦN" ⇒ KHÔNG phải Phần III*, rồi **I hay II tuỳ vào phần dư là QUYẾT ĐỊNH hay VIỆC.*
>
> 🔴 **AW-1 KHÔNG quyết mặc định, và điều đó là cố ý.** Mục quay về đây để **được** quyết. Cái giá của
> việc lật nó, cái bẫy `DemoModeGate?` phải đi kèm trong CÙNG một thay đổi, và phép đo *"3 mẫu ⇒ 0
> mẫu"* nằm nguyên ở §6 và §7 bên dưới — **đọc chúng trước khi quyết.**
>
> 🔴 **Và nói cho hết, vì một nửa sự thật ở đây đúng là loài lỗi mục 37 nói về: DỤNG CỤ MỚI KHÔNG PHẢI
> THỨ TÌM RA CHỖ LỆCH NÀY.** `scripts/check-owner-decisions.sh` bắt được nó, nhưng chỉ vì hàng bảng
> **đã tự khai "MỘT PHẦN"** và vì luật *"MỘT PHẦN ⇒ không phải Phần III"* được viết vào phép kiểm sau
> khi một người đọc định nghĩa của các phần. **Một mục thi hành một phần mà ô bảng KHÔNG nói "một
> phần" thì phép kiểm ấy vẫn cho qua.** Đó là một cái trần của dụng cụ, không phải một chi tiết.
>
> 📎 **Một khẳng định của lời giao việc AW-1 KHÔNG sống sót khi đo lại, và nêu ra vì nó là bằng chứng
> chính mà lời giao việc dùng:** brief viết *"Thân mục 17 vẫn mang 🔴 CHỜ ANH"* như dấu hiệu mục bị đặt
> sai chỗ. Câu ấy **đúng về sự kiện và vô giá trị làm bằng chứng**: đo trên file **ở BASE `e99019c0`,
> tức trước khi AW-1 chạm vào nó**, **MƯỜI LĂM** mục khi ấy đang ở Phần III mở đầu thân bằng đúng chuỗi
> `🔴 **CHỜ ANH.**` — 15, 16, 18, 19, 20, 21, 22, 23, 24, 27, 28, 29, 31, 33 và mục này — vì luật bảo
> tồn của file **đòi** giữ nguyên văn câu trạng thái cũ. (Sau nhiệm vụ này con số ấy đổi vì tập đổi:
> mục 17 rời đi, mục 26, 32 và 37 tới, và cả ba cũng mang đúng chuỗi ấy. **Con số MƯỜI LĂM là phép đo
> ở base, không phải một tính chất của Phần III** — viết ra chỗ nó được đo, đúng luật của file này.) Một dấu
> hiệu mà mọi mục đã thi hành cũng mang thì **không phân biệt được gì**. Cái phân biệt được là chữ
> *"MỘT PHẦN"* ở ô bảng, và phép kiểm mới đứng trên chữ ấy chứ không đứng trên câu mở đầu thân mục.

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). Đo bởi AL-1 (đợt 6), xác nhận lại trên mã.

**Đo được cái gì — quần thể mở TRỌN, không lấy mẫu.** `IHistorianStore` có **bảy** phương thức đọc
công khai. Ba cái gọi `ApplyRealPresenceGateAsync`: `QueryResultsAsync`, `QueryBySerialAsync`,
`AggregateForOeeAsync`. Bốn cái không: `QueryTelemetryAsync`, `QueryRunEventsAsync`,
`GetStatsAsync`, và `PruneOlderThanAsync` (một phép ghi). Ba trong bốn cái không áp **không có gì để
áp**: `QueryRunEventsAsync` và `PruneOlderThanAsync` chạy trên bảng không mang khái niệm xuất xứ, và
`GetStatsAsync` cố ý là một báo cáo **về** store.

**`QueryTelemetryAsync` là phản ví dụ thật, và nó là phản ví dụ CẤU TRÚC.** DDL của
`historian_telemetry` mang đúng bảy cột: `id`, `result_id`, `machine_code`, `metric`, `value`,
`unit`, `quality`, `event_time_utc` — **không có `is_fabricated`**. Cột ấy chỉ tồn tại trên
`historian_results`, được thêm bởi migration 2. Nên cổng không thể áp bằng một cờ; nó cần **một
phép join mà phương thức này cố ý không làm**, hoặc **một cột mới**.

**Và bề mặt HTTP nói cùng một chuyện:** `HistorianEndpoints.GetTelemetryAsync` nhận
`machine, metric, from, to, store, ct` — **không `includeFabricated`, không `DemoModeGate`** — trong
khi mọi route lân cận (`GetResultsAsync`, `GetBySerialAsync`, `GetOeeAsync`, `ExportCsvAsync`,
danh sách fleet) đều đi qua `ResolveIncludeFabricated(...)`.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Historian.SqliteHistorianStore.ApplyRealPresenceGateAsync`
(và ba chỗ gọi nó); `SqliteHistorianStore.QueryTelemetryAsync`; DDL `historian_telemetry` trong
`SqliteHistorianStore`'s migration ladder; `St4i.EngineApi.Endpoints.HistorianEndpoints.GetTelemetryAsync`
và `HistorianEndpoints.ResolveIncludeFabricated`; route `GET /v1/historian/telemetry`.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* trên một fleet trộn — vài máy thật, vài máy mô phỏng — biểu đồ xu hướng trộn dữ liệu
giả với dữ liệu thật, **không gì trong dữ liệu và không gì trong phản hồi nói cái nào là cái nào**.
Đó đúng là kiểu hỏng mà vòng sửa số 1 của SM-2 được viết ra để đóng cho bề mặt kết quả và phả hệ;
nó vẫn mở trên bề mặt telemetry.
*Chiều ngược, và nó quyết định giá:* trên một bản cài **triển lãm 100 % mô phỏng**, đây là bề mặt
historian **duy nhất còn CHẠY** theo mặc định. Đóng nó lại đòi đúng cái carve-out Demo mà
`ResolveIncludeFabricated` đã có cho các route kia — cộng **một cột schema hoặc một phép join**, tức
một migration trên một cơ sở dữ liệu của khách hàng.

**Nếu KHÔNG quyết định.** Bề mặt này ở lại **không gác được**, và câu đã công bố của cổng — *"the
one rule every customer-facing historian query/aggregate in this store applies"* — ở lại đúng với
sáu trong bảy phương thức. Cái tốn kém không phải một dòng sửa: đó là **một migration**, và mỗi ngày
trôi qua là thêm hàng `historian_telemetry` không mang xuất xứ, nên phép sửa **hồi tố** đắt dần.

### ✅ ĐÃ THI HÀNH **MỘT PHẦN** 2026-08-22 (AU-1, base `659bcfb2`) — cổng nay **áp được và có áp**, còn **mặc định thì KHÔNG đổi**, và **tiền đề ở tiêu đề mục này không sống sót**

🔨 **QUYẾT: ĐÓNG KHOẢNG TRỐNG XUẤT XỨ CỦA `QueryTelemetryAsync`** (2026-08-22, **điều phối viên quyết theo
uỷ quyền**, cùng khuôn mục 8, 15 và 21 — mục này không đổi payload MQTT, không đổi hình dạng dây, không đổi
con số OEE nào). **Mọi dòng thân mục gốc ở trên giữ NGUYÊN VĂN.**

#### 🔴 1. Tiền đề trung tâm — *"và nó KHÔNG áp được"* — BỊ BÁC, và cái bác nó nằm trong chính câu của mục

Mục viết: cổng *"cần **một phép join mà phương thức này cố ý không làm**, hoặc **một cột mới**."* Câu ấy nêu
đúng hai lối và rồi tiêu đề mục lại tuyên bố **không lối nào đi được**. Đo trên DDL: `historian_telemetry`
khai `result_id INTEGER NOT NULL REFERENCES historian_results(id) ON DELETE CASCADE`. **`NOT NULL` là chỗ
quyết định:** phép join tới xuất xứ **TOÀN PHẦN** — không có hàng mẫu mồ côi, không có hàng mẫu nào mà xuất
xứ *"không biết được"* vì thiếu đường đi. Xuất xứ của một mẫu **chưa bao giờ vắng mặt; nó cách một bước nhảy
và không ai nhảy.**

Cùng một câu sai ấy sống ở **ba nơi đã công bố** và cả ba được sửa **tại nguồn** trong nhiệm vụ này: tiêu đề
mục 17 (sửa bằng gạch ngang ở hàng bảng phán quyết), doc của `IHistorianStore.QueryTelemetryAsync`
(*"the asymmetry cannot be closed by passing a flag here"*), và doc của
`SqliteHistorianStore.QueryTelemetryAsync` (*"not an omission that a flag would fix"*). **Cả hai doc được rút
theo lối trích-nguyên-văn-rồi-rút, không gạch ngang, không xoá dòng nào.**

#### 🔴 2. Câu khó nhất — *"hàng cũ mang giá trị gì"* — KHÔNG TỒN TẠI ở dạng nó được đặt ra, và đó là câu trả lời chứ không phải một lối né

Câu hỏi giả định cơ chế **THÊM MỘT CỘT**. §8.1(a) đòi **suy cơ chế ra**, đừng nhận một mặc định — và cơ chế
suy ra được **không phải là thêm cột**:

* Xuất xứ của một hàng telemetry **không phải một sự kiện độc lập**. Nó là **hàm của hàng reading cha**, và
  quan hệ ấy được **cưỡng chế bởi lược đồ** (`NOT NULL` + khoá ngoại), không phải bởi quy ước.
* Nên một hàng mẫu cũ mang **đúng cái cha nó mang**. Đó là **một PHÉP ĐO**, không phải một giá trị phải chọn.
  **Không có sự kiện nào bị bịa ra, vì không có sự kiện nào phải bịa.**
* **Ba trạng thái vẫn còn — nhưng chúng được THỪA KẾ, không phát minh.** Cha mang `0`/`1`/`NULL`; `NULL` là
  *"Unknown provenance"* mà migration 2 đã cố ý tạo ra (thêm cột **không DEFAULT**, để chính ngữ nghĩa
  ADD-COLUMN của SQLite gán `NULL` cho mọi hàng cũ) và `HistorianResultRecord.IsFabricated` đã ghi rõ là
  **trạng thái THỨ BA, không bao giờ được lặng lẽ gộp vào "thật" hay "giả"**.
* **Và luật xử lý *Unknown* ĐÃ ĐƯỢC QUYẾT rồi.** `ApplyRealPresenceGateAsync` đã mang nó cho ba read kia.
  Nhiệm vụ này **không được quyền quyết lại nó**, và **không quyết lại**: nó **gọi** luật ấy.

**Giá, hai chiều, và cả hai đều là giá THỪA KẾ chứ không phải giá mới:**
*Che *không biết* đi:* khi trong phạm vi có một reading thật rõ ràng, **mọi** mẫu Unknown cùng phạm vi bị loại
— kể cả mẫu của một máy thật sự thật chỉ vì nó có trước cột. Vận hành viên mất một đoạn đường cong họ vẫn
thấy hôm qua, và **không gì trong phản hồi nói là đã mất**.
*Cho *không biết* qua:* khi không có gì rõ ràng thật trong phạm vi, mẫu Unknown đi qua — nên một chuỗi được
gán nhãn *"đã gác"* vẫn có thể chứa dữ liệu mà **không ai chứng minh được là thật**. **Cổng có một lỗ mà tên
nó không nói.** Đây đúng là *"Known residual limitation"* mà doc của chính cổng đã ghi, nay chạm tới bề mặt
telemetry **y nguyên** — vì luật được **gọi**, không được **chép**.

#### 3. Đường di trú — đo được, và **KHÔNG MẤT DỮ LIỆU vì KHÔNG CÓ MIGRATION NÀO CHẠY**

🔴 **Brief nói *"mục 5 ghi rằng HAI store khác `DROP TABLE` lúc khởi động"*. Đọc lại mục 5: nó nêu HAI phát
hiện, và chỉ MỘT là `DROP TABLE`** — `ConnectorConfigStore` migration v4. Phát hiện kia
(`ProductConfigStore.Load` ghi lại `products.json`) **không phải một `DROP TABLE`**. Và cái `DROP TABLE` duy
nhất ấy **đã được phán ✅ KHÔNG ĐỔI**, vì nó là nấc 4 của một thang `PRAGMA user_version` chạy **trong cùng
một transaction**, theo đúng thứ tự tạo/chép/xoá/đổi-tên mà SQLite quy định — **các hàng sống sót, và việc
sống sót được ghim bởi một bài test dựng database v3 thật bằng SQL thô.**

Đo trên `SqliteHistorianStore`: thang di trú của nó là **`PRAGMA user_version`, cộng dồn, và KHÔNG có
`DROP TABLE` ở bất kỳ nấc nào** — nấc 1 là `CREATE TABLE IF NOT EXISTS` ×3, nấc 2 là một
`ALTER TABLE … ADD COLUMN`. Mỗi nấc chạy trong transaction riêng; `EnsureSchema()` chỉ áp nấc mới hơn
`user_version` hiện tại.

🔴 **Nhưng bằng chứng "không mất dữ liệu" ở đây KHÔNG dựa vào chất lượng của thang, mà mạnh hơn thế:
AU-1 KHÔNG THÊM NẤC NÀO. Không có migration nào chạy trên cơ sở dữ liệu của khách hàng, không một byte nào
được đọc-ghi-lại, `user_version` không dịch.** Bản sửa là **một phép ĐỌC**. Đó là hệ quả trực tiếp của §2: khi
xuất xứ đã được ghi đúng một lần trên hàng cha, thêm một cột thứ hai lên hàng con chỉ tạo ra **một bản sao có
thể trôi** mà `AppendResultsAsync` phải giữ đồng bộ vĩnh viễn.

#### 4. Chỗ GHI **CÓ** biết xuất xứ — đo, không đoán

`AppendResultsAsync` là **chỗ ghi DUY NHẤT** của `historian_telemetry` trong toàn commit (một câu
`INSERT INTO historian_telemetry`, và không có câu nào khác ở đâu, kể cả `server/`, `client/`, `examples/`).
Nó ghi hàng reading với `@is_fabricated` tường minh, đọc lại `last_insert_rowid()`, rồi ghi các hàng mẫu với
`result_id` ấy — **cùng một transaction, cùng một vòng lặp, cùng một biến `record`**. Nên chỗ ghi **cầm câu
trả lời trong tay** ở đúng lúc nó ghi hàng mẫu. **Cột ấy điền được cho tử tế** — và chính vì thế nó **thừa**.

Một phép đo phụ làm cửa sổ thời gian khớp **chính xác** chứ không xấp xỉ: `AppendResultsAsync` tính **một**
`eventTimeIso` và đóng dấu nó lên **cả** reading **và** mọi mẫu của reading ấy. Nên một mẫu nằm trong cửa sổ
**khi và chỉ khi** cha nó nằm trong cửa sổ.

#### 5. Bề mặt ĐỌC — **LIỆT KÊ trước, con số SAU**

Quét toàn commit (`git grep --full-name … HEAD -- ':(top)'`, chạy từ **gốc repo** `D:\SOURCES\avi-aoi-sim`;
`server/` và `client/` vắng khỏi cây nhưng **có trong commit** và **đã được quét**):

**Gọi `IHistorianStore.QueryTelemetryAsync`:** `HistorianEndpoints.GetTelemetryAsync` (sản xuất) · ba fake
`IHistorianStore` trong test (`HistorianWriterTests`, `FleetHostGateCommitCompletionTests`,
`FleetHostHistorianWiringTests`) · `SqliteHistorianStoreQueryTests` · `SqliteHistorianStoreTests`.

**Gọi `GET /v1/historian/telemetry`:** chỗ đăng ký route trong `HistorianEndpoints` ·
`RbacPolicyTests` (điều tra dân số chính sách) · `HistorianEndpointsReadTests` (ba `[Fact]`) ·
`HistorianTelemetryProvenanceTests` (mới, bảy `[Fact]`) · và các bản ghi tài liệu.

🔴 **Cái phép liệt kê này KHÔNG liệt kê được, và nó là kết quả quan trọng nhất của mục §5:
KHÔNG MỘT BIỂU ĐỒ NÀO. KHÔNG MỘT BÁO CÁO NÀO. KHÔNG MỘT KHÁCH HÀNG ĐÃ SHIP NÀO.** Không trang web nào,
không view WPF nào, không PDF nào gọi route này. Bề mặt ĐỌC hướng-người-dùng của nó là **rỗng**, và bản thân
điều đó là một phát hiện: **mục 17 mô tả tác hại của nó bằng một "biểu đồ xu hướng" mà trong cây này không
tồn tại.** (`getTelemetrySeries` trong `server/` là **một hệ khác** — Postgres/drizzle, bảng `ot_telemetry` —
không phải route này.)

🔴 **Và nửa ngược lại, vì "không có bên tiêu thụ" KHÔNG có nghĩa là "không có ai đọc":** route mang
`RequireAuthorization(Policies.Operator)` và là một bề mặt HTTP **đã xuất bản**. Một bên tích hợp gọi thẳng
API **đo không được từ repo này** — cùng cái trần mà mục 14 và mục 32 đã trả giá để học. Doc của
`ResolveIncludeFabricated` tự nói ra khả năng ấy: *"no shipped web route sends one today, but a direct API
caller can."*

#### 🔴 6. ĐIỀU KIỆN DỪNG — **ĐÃ NỔ**, ở nửa MẶC ĐỊNH, và đây là phép đo

Nối route này vào `ResolveIncludeFabricated` như các route anh em **không làm hẹp phản hồi — nó làm RỖNG
phản hồi**, và cơ chế đo được:

* `machine` là tham số **BẮT BUỘC** trên route này, nên phép dò real-presence của cổng **luôn** chạy trong
  phạm vi **đúng một máy**.
* Với một máy **mô phỏng bình thường** trên một bản triển khai **không phải demo** (`DemoModeGate` tắt — tức
  **mọi bản cài sản phẩm**), phép dò không tìm thấy gì rõ ràng thật **trong phạm vi máy ấy**, tập được nhận
  thành `(is_fabricated IS NULL OR is_fabricated = 0)`, và **mọi** mẫu của máy ấy bị loại.
* **Đo bằng cách chạy, không bằng lập luận:**
  `GateOptIn_OnAPurelyFabricatedMachine_ReturnsNothing_WhileTheUngatedReadReturnsEverySample` khẳng định
  **cùng một hạt giống**: không gác ⇒ **3 mẫu**; gác ⇒ **0 mẫu**. **Không phải ít hơn — bằng không.**
* Một biểu đồ xu hướng hôm nay có đường thì ngày mai **rỗng, vĩnh viễn**. Đó **đúng** hình dạng hỏng mà
  `ResolveIncludeFabricated` tự ghi cho các route anh em **trước** Fix 1: *"not 'narrower than intended,'
  literally zero, permanently."*

**Nên: DỪNG ở nửa ấy. Mặc định KHÔNG bị đổi, và AU-1 không tự quyết nó.** Cái được ship là **cơ chế** với
**mặc định hôm nay được giữ nguyên từng ký tự**; cái được giao lên là **quyết định về mặc định**.

#### 7. Miễn trừ Demo — **KHÔNG dùng**, và lý do là chính điều kiện DỪNG

Route mới **KHÔNG** đi qua `ResolveIncludeFabricated`. Nó mặc định `includeFabricated ?? true`.

**Vì sao:** miễn trừ Demo tồn tại để **TRẢ LẠI** những hàng mà cổng lấy đi trên một hộp demo. Ở đây cổng
**không lấy gì đi**, nên **không có gì để trả lại** — nối nó vào sẽ là một cái không-làm-gì trên hộp demo và
**chính là hành vi làm nổ điều kiện DỪNG** trên hộp thật (`demoGate?.Enabled ?? false` = `false` = cổng bật).
Route **cố ý không nhận** tham số `DemoModeGate?`: nhận rồi bỏ qua thì tệ hơn, còn không nhận làm cho việc
không-dùng **thành cấu trúc và nhìn thấy được**.

🔴 **Điều kiện kèm theo, ghi vào mục vì nó là một cái bẫy:** nếu chủ sở hữu phán lật mặc định, thì
`DemoModeGate?` **phải được thêm trong CÙNG một thay đổi**, không phải sau. Thiếu nó, telemetry của một bản
cài triển lãm 100 % mô phỏng **về không** — đúng con bug mà Fix 1 đã sửa cho các route kia.

#### 🔴 8. Nửa bất lợi của chính bản sửa này — hai route vẫn trả lời khác nhau

Sau bản sửa, `GET /v1/historian/results` vẫn **giấu** reading của một máy bịa trong khi
`GET /v1/historian/telemetry` vẫn **vẽ** mẫu của **chính máy ấy**, và **không gì trong phản hồi nói cái nào
là cái nào**. Chỗ lệch ấy **không do bản sửa tạo ra** — nó **LÀ** mục 17 — nhưng bản sửa **KHÔNG ĐÓNG** nó.
Cái thay đổi là: trước đây nó là một **khẳng định cấu trúc** (*"không áp được"*) mà không ai xem lại được;
nay nó là **một dòng, một mặc định, xem lại được**, và nằm cạnh phép đo về giá của việc lật nó.

#### 9. Nhân chứng, cặp đối chứng, và hằng số — **đo SAU khi viết**

**File mới** `tests/St4i.EngineApi.Tests/HistorianTelemetryProvenanceTests.cs`, **bảy `[Fact]`**. Taxonomy
dưới đây là **kết quả chạy hai đối chứng**, không phải nhãn tự phong — và **nó đã sửa một nhãn viết sai**:

* **Đối chứng A** (gỡ cổng khỏi `SqliteHistorianStore.QueryTelemetryAsync`): **4 ĐỎ / 3 xanh**. Bốn cái đỏ là
  nhân chứng thật.
* **Đối chứng B** (lật mặc định endpoint sang luật anh em): **đúng 1 ĐỎ**, và nó là
  `Default_WithNoExplicitValue_…_LegacyContinuity`. 🔴 **Đó là một phát hiện, không phải một cái pass: mọi bài
  test telemetry ĐÃ CÓ vẫn XANH dưới đối chứng B, nên trước file này KHÔNG bài nào trong 2 804 bài nhìn thấy
  được phép lật mặc định** — chính cái mất mát mà điều kiện DỪNG tồn tại để chặn thì **không có nhân chứng**.
* **ĐỎ dưới KHÔNG đối chứng nào, và được tự dán nhãn *guard, KHÔNG phải nhân chứng* ngay trên bài test:**
  `TheJoinThisReadWasSaidToBeUnableToMake_IsTotal_…` (một phép đo cấu trúc, cố ý độc lập với cổng) và
  🔴 `GateOptIn_UnknownProvenanceSamples_PassWhenNothingExplicitlyReal…` — **viết ra như một nhân chứng, ĐO
  RA là một guard, và đã đổi nhãn tại chỗ.** Cả hai đối chứng đã **hoàn nguyên**; `git diff` ở ngọn nhánh
  không chứa cái nào.

**Hằng số — ĐO rồi mới viết:** `EXPECT_ENGINEAPI` **1388 → 1395** (+7, đếm từ runner `--list-tests` **sau
khi** viết file, không dự báo trước), tổng **2804 → 2811**. `EXPECT_WARNINGS` **328 KHÔNG dịch**,
`EXPECT_BUILD_NODES` **0**, sổ cảnh báo **16 hàng không dịch một đơn vị**, **0 lệnh đè** — không
`.editorconfig`, không `<NoWarn>`, không `#pragma`, không `SuppressMessage`. `EXPECT_EDGECORE` **1179 không
dịch**: ba fake chỉ đổi một dòng chữ ký mỗi cái. **AU-1 không chạm `web/`.**

🔴 **Một `-t:Rebuild` trả *13 Error(s)* rồi chạy lại trả *0 Error(s)*, cùng cây, không sửa gì** — đúng cái
bẫy mà ràng buộc toàn cục nêu tên. **Con số được tin là con số của lần chạy lại.**

#### 🔴 10. Một lỗi CỦA CHÍNH AU-1, bị bắt bởi chính bài test của AU-1

Bản nháp đầu thêm `includeFabricated` vào `GetTelemetryAsync` nhưng **quên truyền nó xuống**
`store.QueryTelemetryAsync`. Hệ quả: store rơi về mặc định của **chính nó** (`false`) và **cổng BẬT theo mặc
định** — tức **đúng thứ điều kiện DỪNG cấm**, ship kèm một doc comment dài giải thích rằng nó không làm thế.
Hai bài đỏ ngay lần chạy đầu (`Default_…` trả `[72]` thay vì `[71, 72, 73]`;
`GateOptIn_OnAPurelyFabricatedMachine_…` trả `0` thay vì `3` ở vế **không gác**). **Nó được bắt lúc CHẠY, không
phải lúc đọc** — và nếu bài guard `Default_…` không được viết ra vì "nó xanh ở cả hai phía nên vô dụng", bản
sửa đã đi qua cổng và làm biến mất dữ liệu của khách hàng đúng như đã bị cấm.

#### 11. Một khẳng định đã công bố được RÚT **TẠI NGUỒN**, không chỉ trong hồ sơ

Doc của `ApplyRealPresenceGateAsync` mở đầu bằng *"the one rule **every** customer-facing historian
query/aggregate in this store applies"*. **AL-1 đã đo và rút câu ấy trong FILE NÀY ngày 2026-08-20** (mục 12,
§11) — **nhưng phép rút chưa bao giờ tới mã**. Suốt hai ngày, người đọc **hồ sơ** thấy câu đã rút còn người
đọc **mã** vẫn thấy câu sai, ở ngay trên hàm mà nó nói sai về. Nay sửa tại nguồn, kèm phép **liệt kê** thật:
với tới cổng — `QueryResultsAsync`, `QueryBySerialAsync`, `AggregateForOeeAsync`, `QueryTelemetryAsync`;
**mặc định BẬT ở BA**. Không với tới — `QueryRunEventsAsync` (bảng không mang máy lẫn xuất xứ) và
`GetStatsAsync` (cố ý là báo cáo **về** store).

🔴 **Và đó chính là mục 37 ở dạng thu nhỏ, gặp trong lúc thi hành một mục khác:** một phán quyết/phép rút
sống trong hồ sơ mà **không có bản ghi tại chỗ**, và **không dụng cụ nào bắt được**.

#### 12. Hai phép đếm trong thân mục gốc **không khớp phép liệt kê của chính chúng** — sửa ở đây, thân mục giữ nguyên văn

* Thân mục viết `historian_telemetry` *"mang đúng **bảy** cột"* rồi **liệt kê tám**: `id`, `result_id`,
  `machine_code`, `metric`, `value`, `unit`, `quality`, `event_time_utc`. **DDL có TÁM.** Phép liệt kê đúng,
  con số sai — đúng lý do luật *"LIỆT KÊ trước, con số viết SAU"* tồn tại, và lần này chính luật ấy bắt được
  lỗi trong một mục đã công bố.
* Thân mục viết `IHistorianStore` có *"**bảy** phương thức ĐỌC công khai"* rồi liệt kê bảy cái **trong đó có
  `PruneOlderThanAsync`, mà chính câu ấy gọi là "một phép ghi"**. Đọc thật: **sáu**. (Và interface còn hai
  phép ghi nữa — `AppendResultsAsync`, `AppendRunEventAsync` — không nằm trong phép đếm nào.)

**Không dòng nào của thân mục gốc bị sửa**; hai chỗ lệch được ghi ở đây.

### ✅ ĐÃ THI HÀNH 2026-08-23 (BE-1, base `90c67503`) — **PHÁN QUYẾT CỦA CHỦ SỞ HỮU 2026-08-23**: mặc định TẮT, có tham số. **Không một ký tự hành vi nào đổi**, và bề mặt **KHÔNG nói được** cái rỗng

🔨 **PHÁN QUYẾT CỦA CHỦ SỞ HỮU, 2026-08-23: MẶC ĐỊNH TẮT, CÓ THAM SỐ.** Route trả **tất cả** như hôm
nay; ai cần lọc thì truyền tham số. **Mọi dòng thân mục gốc ở trên giữ NGUYÊN VĂN.** Mục rời **Phần I →
Phần III** cùng ngày.

**Tham số — đo, không nhận từ brief.** Tên là **`includeFabricated`**, và nó **khớp đúng** route anh em:
cùng tên, cùng kiểu `bool?`, cùng ba giá trị (`true` / `false` / vắng mặt). Chỗ khác **duy nhất** là
phép giải mặc định, và nó là một dòng: route anh em giải qua
`HistorianEndpoints.ResolveIncludeFabricated`, tức `explicitValue ?? (demoGate?.Enabled ?? false)`; route
này giải bằng `includeFabricated ?? true`. Nên phán quyết **không đổi một ký tự mã hành vi nào** — cái
được ship 2026-08-22 (AU-1) đã đúng là hình dạng chủ sở hữu vừa phán, và việc của nhiệm vụ này là **ghi
cho nó nói đúng**: doc của `GetTelemetryAsync` mở đầu bằng *"an owner's open question rather than a
settled design"*, câu ấy **thành sai lúc 2026-08-23**, và nó được sửa **tại nguồn** kèm ngày, giữ nguyên
văn hai đoạn phép đo mà phán quyết được ra **trên** chúng.

🔴 **GIÁ, HAI CHIỀU, GHI VÀO MỤC VÌ MỘT SỰ THẬT VIẾT MỘT CHIỀU LÀ MỘT NỬA SỰ THẬT.**
*Chiều thuận:* mặc định này **giữ nguyên hành vi hôm nay**, nên **không bản cài nào mất dữ liệu** — đúng
cái mà điều kiện DỪNG của AU-1 tồn tại để chặn, và phép đo *"3 mẫu ⇒ 0 mẫu"* ở §6 là lý do phán quyết
đi hướng này.
*Chiều nghịch, và nó không được mềm hoá:* dữ liệu **giả và thật vẫn TRỘN theo mặc định** trên bề mặt
này, và **hai route hướng khách hàng trả lời KHÁC NHAU về cùng một câu hỏi trên cùng một máy** —
`GET /v1/historian/results` **giấu** reading của một máy bịa trong khi `GET /v1/historian/telemetry`
**vẫn vẽ** mẫu của chính máy ấy. Chỗ lệch ấy **không do phán quyết tạo ra** — nó **LÀ** mục 17 — nhưng
phán quyết **KHÔNG đóng** nó, và **đó là điều chủ sở hữu đã chấp nhận**, không phải điều chưa ai nhận ra.

#### 🔴 PHÁT HIỆN MỚI (BE-1, 2026-08-23) — **BỀ MẶT KHÔNG NÓI ĐƯỢC RẰNG CÁI RỖNG LÀ DO LỌC**, và cái trần ấy RỘNG HƠN route này

Lời giao việc hỏi: khi ai đó **TRUYỀN** tham số trên một máy mô phỏng ở bản cài không-demo, họ nhận về
**RỖNG** — bề mặt có nói được điều đó không? **Đo: KHÔNG.**

* `GetTelemetryAsync` trả `Results.Ok(points.Select(...).ToArray())` — một **mảng JSON TRẦN**. Không
  envelope, không `Total`, không dội lại giá trị hiệu lực của cờ. Và `TelemetryPointDto` khai đúng **hai**
  trường — `At`, `Value` — **không có trường xuất xứ nào**.
* Nên **BỐN** tình huống cho **MỘT** phản hồi giống nhau từng byte (`[]`): không có mẫu nào trong cửa sổ ·
  máy không tồn tại · metric không tồn tại · **mọi mẫu bị cổng loại**. Người gọi thấy một biểu đồ trắng
  và **không phân biệt được bốn cái**.

🔴 **Và nêu ở đúng bề rộng của nó, vì một cái trần nêu quá nhỏ còn tệ hơn không nêu trần: đây KHÔNG phải
một khuyết tật riêng của route telemetry.** Route anh em `GET /v1/historian/results` **cũng không nói
được**. Nó *có* mang xuất xứ **từng hàng** (`HistorianResultDto.IsFabricated`, ba trạng thái) — nhưng một
cái nhãn trên những hàng **ĐÃ VỀ** không nói gì về những hàng **ĐÃ BỊ LOẠI**, và `Total` của nó đếm tập
**được nhận**, không đếm tập **bị loại**. **Nên không một bề mặt historian nào trong sản phẩm này diễn
đạt được *"rỗng VÌ bị lọc"* khác với *"rỗng vì không có gì"*.** Đây đúng là hình dạng **mục 28** — in giá
trị mà không gọi tên cái trần — và phán quyết trên **để ngỏ** nó một cách có chủ ý chứ không đóng lặng.

**Nhân chứng — và nói rõ nó là nhân chứng của AI.** Nhân chứng đỏ được cho mặc định này **đã tồn tại và
không do BE-1 viết**: `HistorianTelemetryProvenanceTests.Default_WithNoExplicitValue_…_LegacyContinuity`
(AU-1, 2026-08-22). BE-1 **chạy lại cặp đối chứng của AU-1 ở ngọn nhánh của mình** để chứng minh nó vẫn
đỏ được hôm nay, rồi **hoàn nguyên** — xem báo cáo nhiệm vụ. **Không hằng số nào của cổng dịch vì mục
17**: không bài test nào thêm, không bài nào bỏ, hành vi không đổi.

---

## 35. `DBIRTH`/`DDEATH` không còn sinh ra được từ spine này, `SparkplugAliasTable.Reset()` mất caller sản xuất — hệ quả ĐÃ ĐO của mục 23, và một câu hỏi vòng đời chưa ai trả lời

🔴 **CHỜ ANH.** Mở 2026-08-22 (AU-1), xác nhận lại trên mã.

**Đo được cái gì.** Mục 23 được chủ sở hữu phán **GỠ** và AR-1 thi hành 2026-08-21: `IUnsPublisher.PublishBirth`
/`PublishDeath`, `UnsPublisher.PublishBirthCoreAsync`/`PublishDeathCoreAsync`, hai work-item và hai nhánh
dispatch đã bị xoá. Hệ quả đo được hôm nay:
* Dưới `tools/machine-simulator/src/`, mọi chỗ còn nhắc `DBIRTH`/`DDEATH` là **khai báo enum hoặc bia mộ** —
  **không một chỗ sinh nào**. `NBIRTH`/`NDEATH` thì **vẫn sống** (`PublishNodeBirthCoreAsync`/
  `PublishNodeDeathCoreAsync`, gọi từ `FleetCore` ở Start / Stop / E-stop).
* **`SparkplugAliasTable.Reset()` — liệt kê caller trước khi đếm:** `SparkplugAliasTableTests.
  Reset_ClearsAssignmentsAndRestartsNumberingAtOne`. Hết. **Một caller, và nó là một unit test; KHÔNG caller
  sản xuất nào.**
* 🔴 **Bảng alias NỬA SỐNG, và đây là nửa mà brief không nêu:** `GetOrAssign` chạy trên **mọi** reading
  (`UnsPublisher` giữ một `SparkplugAliasTable` cho **mỗi** `MachineCode`, không bao giờ gỡ), trong khi
  `Reset()` không ai gọi. **Nửa ghi chạy mãi mãi; nửa xoá đã chết.**

🔴 **Và một chỗ brief KHÔNG đứng vững, nêu rõ.** Brief viết *"`DBIRTH`/`DDEATH` nay **HOÀN TOÀN** không sinh ra
được"*. Ở phạm vi **repo** câu ấy **SAI**: `server/services/uns/sparkplugNode.ts` dựng topic `DBIRTH` và
`DDEATH`, gọi từ `server/services/unsPublisher.ts` (*"Lazy DBIRTH khi device chưa birthed"*, re-DBIRTH khi có
tên metric mới, DDEATH khi tắt êm), lái bởi `mqttService.ts` và tiêu thụ bởi
`federation/unsSubscriber.ts`. **Sản phẩm VẪN phát DBIRTH hôm nay.** Câu đúng là: **không sinh ra được từ
spine `tools/machine-simulator`**. Đây đúng là loại nhầm phạm vi mà **mục 32** tồn tại để chấm dứt, và nó tái
diễn trong chính brief mở mục này.

🔴 **Một tiền đề thứ hai được đo lại và nó DỊU HƠN mục 23 tuyên bố.** Mục 23 (và doc `IUnsPublisher`) viết
*"mọi DDATA mang alias mà subscriber không có giấy khai sinh"*. Đo trên `SparkplugPayload.EncodeMetric`: nó
ghi **CẢ `Name` LẪN `Alias`** trên **mọi** metric, vô điều kiện. Nên **một subscriber giải mã được DDATA đầy
đủ mà không cần DBIRTH nào** — cái hỏng **không phải "dữ liệu không giải mã được"** mà là **không tuân đặc
tả**: một host Sparkplug nghiêm (Ignition, HiveMQ) coi thiết bị không có giấy khai sinh là **không biết /
STALE** và thường bỏ hoặc từ chối đăng ký nó.

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Uns.IUnsPublisher` (bia mộ + giá P-2);
`St4i.EdgeCore.Uns.UnsPublisher` (`PublishReadingCoreAsync`, `BuildSparkplugMetrics`, `_aliasTables`,
`PublishNodeBirthCoreAsync`); `St4i.EdgeCore.Uns.UnsTopicBuilder` (`SparkplugMsgType.DBIRTH`/`.DDEATH`,
`BuildSparkplugDataTopic`, `IsDeviceLevel`); `St4i.EdgeCore.Uns.Sparkplug.SparkplugAliasTable.Reset`;
`St4i.EdgeCore.Uns.Sparkplug.SparkplugPayload.EncodeMetric`; `St4i.EdgeCore.Fleet.FleetCore` (Start / Stop /
E-stop). Bên ngoài spine này: `server/services/uns/sparkplugNode.ts`, `server/services/unsPublisher.ts`.

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* spine `tools/machine-simulator` là một bộ phát Sparkplug **không tuân đặc tả vĩnh viễn** — nó
phát NBIRTH/NDEATH ở mức node nhưng đẩy DDATA trên **topic mức device** cho những device **chưa bao giờ có
DBIRTH**. Alias **sống qua một phiên birth**: `ResetOnBirth()` đặt lại **sequence** ở NBIRTH nhưng **không
đặt lại alias**, nên qua một chu kỳ Start→Stop→Start thật của vận hành viên, alias lặng lẽ mang sang — vô hại
**chỉ vì** tên đi kèm inline. Bảng alias **tăng không chặn** theo tên metric do thiết bị cấp (nhỏ trên thực
tế, **không chặn** trên hình thức). Và hai thành viên đã xoá khỏi một interface công khai **đang làm hỏng biên
dịch của bất kỳ implementor/caller ngoài repo nào ngay lúc này**, mà **không lệnh nào trong repo phát hiện
được** (đúng giá P-2 chủ sở hữu đã chấp nhận).
*Chiều ngược (giá phục hồi):* thêm lại hai thành viên vào `IUnsPublisher` là **thay đổi phá vỡ với MỌI
implementor**, gồm **năm** fake test mục 23 nêu tên; phải dựng lại hai core method, hai work-item, hai nhánh
dispatch; phải nối chỗ gọi thật — chỗ hợp lý duy nhất là các chuyển trạng thái `FleetCore` đã giữ dưới
`_gate`, tức **một thay đổi HÀNH VI GIAO THỨC** chứ không phải một bổ sung; phải thêm một latch trạng thái
birth **mà spine này không có**; phải quyết luật *"NBIRTH có xoá alias của mọi device không"* mà hôm nay
**không tồn tại**; và phải phục hồi
`UnsNodeLifecycleTests.PublishBirth_DeviceLevelDbirth_DoesNotResetTheNodeSequence` (mục 23 ghi rõ: *"Nếu một
ngày đường DBIRTH quay lại, bài test này phải quay lại cùng nó"*) kèm `EXPECT_EDGECORE` +1.

**Nếu KHÔNG quyết định.** `SparkplugMsgType.DBIRTH`/`.DDEATH`, nhánh mức-device của `BuildSparkplugTopic`,
`IsDeviceLevel` và `SparkplugAliasTable.Reset()` ở lại là **bề mặt công khai đã xuất bản không có bộ sinh**,
trong khi `UnsTopicBuilderTests` tiếp tục kiểm một hình dạng **không gì phát ra được** — một bài test xanh
đang trả cho một đường đã chết. Nhân chứng hồi quy cho bug *"DBIRTH không được đặt lại node sequence"* đã mất,
nên nếu đường ấy quay lại mà không có nó, bug G2-3 **không được gác**. 🔴 **Cộng một dư lượng chưa ai trả lời
và nó thuộc cùng câu hỏi vòng đời: KHÔNG có MQTT Will nào được cấu hình ở bất kỳ file `.cs` nào**, nên một cú
kill đột ngột **cũng không phát NDEATH** — vòng đời node chỉ thật một nửa, và câu hỏi Will đã nằm trong
`verify-suites.sh` mà **chưa ai phán**.

### 🔴 DỪNG 2026-08-22 (AX-1) — ĐIỀU KIỆN DỪNG CỦA MỤC NÀY ĐÃ NỔ. Ở LẠI PHẦN I. Phần nằm TRONG uỷ quyền — đo, và rút bốn câu tài liệu — đã trả

**Điều kiện DỪNG, và kết quả của nó.** Brief đặt điều kiện: *nếu đóng mục này đòi phát ra một thông điệp
MQTT MỚI (DBIRTH/DDEATH lên dây) thì đó là **đổi payload MQTT** — một trong ba mục chủ sở hữu KHÔNG uỷ
quyền — DỪNG VÀ BÁO.* **Điều kiện ấy NỔ, và nó nổ theo đường trực tiếp nhất:** thân mục này gọi spine
`tools/machine-simulator` là *"một bộ phát Sparkplug không tuân đặc tả vĩnh viễn"*, và **cách duy nhất
làm cho nó tuân đặc tả là phát DBIRTH cho từng device** — tức đặt một loại thông điệp mới lên dây, cho
những người đăng ký hôm nay chưa từng nhận nó. Không có phiên bản nhỏ hơn của phép sửa ấy: một DBIRTH
không phát ra thì không phải một DBIRTH. **Mục ở lại Phần I chờ anh.**

📎 Ba đường thay thế đã cân và bị loại, ghi ra để anh không phải hỏi lại: (a) **gỡ**
`SparkplugMsgType.DBIRTH`/`.DDEATH`, nhánh mức-device và `Reset()` — chính thân mục 23 đã gọi đây là
*"một phép đổi hợp đồng THỨ HAI mà phán quyết không phủ"*, và P-2 nói cách viết tên một thành viên công
khai **là** hợp đồng đã xuất bản; (b) **để nguyên và im lặng** — đúng thứ mục này tồn tại để chấm dứt;
(c) **chỉ sửa lời** — đó là phần đã trả, ngay dưới đây, và nó **không đóng** mục.

**VÒNG ĐỜI SPARKPLUG HÔM NAY, LIỆT KÊ RỒI MỚI ĐẾM.** Quần thể là **năm** chỗ gọi `_client.PublishAsync`
dưới `src/` ngoài `Site/UnsBridge.cs` (liệt kê bằng `scripts/repo-scan.sh --sha HEAD -n -E 'PublishAsync\('
-- 'tools/machine-simulator/src/*'`, tám dòng, ba trong đó thuộc `UnsBridge` — bridge liên kết Site, không
phải spine UNS cục bộ):

1. `UnsPublisher.PublishReadingCoreAsync`, publish (1) — **mirror ngữ nghĩa retained**, JSON của
   `CanonicalEnvelope` trên `syn/…`. **Không phải Sparkplug.**
2. `UnsPublisher.PublishReadingCoreAsync`, publish (2) — **DDATA**, mã hoá Sparkplug, topic mức device
   qua `UnsTopicBuilder.BuildSparkplugDataTopic`, một lần mỗi reading đã commit.
3. `UnsPublisher.PublishNodeBirthCoreAsync` — **NBIRTH**, mức node, gọi từ `FleetCore` ở Start.
4. `UnsPublisher.PublishNodeDeathCoreAsync` — **NDEATH**, mức node, gọi từ `FleetCore` ở Stop và E-stop.
5. `UnsPublisher.PublishLineStateCoreAsync` — JSON retained `{ state, atUtc }` trên `_line/state`.
   **Không phải Sparkplug.**

**Đếm sau khi liệt kê: BA loại thông điệp Sparkplug rời spine này — NBIRTH, NDEATH, DDATA.** `enum
SparkplugMsgType` khai **sáu** thành viên; ba cái không có bộ sinh là **DBIRTH**, **DDEATH** (mất bộ sinh
2026-08-21, mục 23) và **NDATA** (không có bộ sinh trong cây như đo hôm nay — một phát biểu về commit
này, không phải về cả lịch sử dự án). Cộng một chỗ trống của cùng câu hỏi vòng đời: `WithWill`/`LastWill`
**không xuất hiện trong file `.cs` nào** — đo lại hôm nay bằng `repo-scan.sh`, sáu dòng khớp và **không
một dòng nào là mã**, chỉ là tài liệu nói về sự vắng mặt ấy. Nên một cú kill đột ngột phát **không gì**.

**`SparkplugAliasTable.Reset()` — bề mặt ĐỌC/GỌI, đo bằng `scripts/repo-scan.sh` trên miền RỘNG NHẤT có
được.** Pathspec gồm `tools/machine-simulator/*` **và** `server/*` (1589 file), `client/*` (711 file),
`examples/*` — ba cái sau **nằm trong commit** dù sparse checkout để hai cái đầu ngoài đĩa, nên một phép
quét cây làm việc **không thấy chúng** và phép quét này thì thấy. Kết quả: **một** dòng chứa `.Reset()`
trong toàn repo ở `cfcfae42`, và nó là `SparkplugAliasTableTests.cs:76`. **Không caller sản xuất nào, và
lần này phủ định ấy được nói ở miền đã mở hết tập.** Nửa ghi thì ngược lại: `GetOrAssign` chạy trên từng
metric của từng reading spine này phát, `UnsPublisher._aliasTables` giữ một bảng cho mỗi `MachineCode` và
không bao giờ gỡ. **Nửa ghi chạy mãi; nửa xoá đã chết** — phép đo của mục này đứng vững.

> 🔴 **RÚT MỘT CON SỐ, 2026-08-22 (BB-1, mục 25 đợt 11) — CON SỐ *"MỘT DÒNG"* NGAY TRÊN LÀ SAI. KẾT LUẬN
> CỦA MỤC NÀY KHÔNG BỊ ĐỤNG, MỤC VẪN Ở PHẦN I, VẪN 🔴 CHỜ ANH.** Câu gốc giữ **nguyên văn** ở trên theo
> đúng lệ bảo tồn của file này; đây là một phép **RÚT một con số đã đo ra sai**, không phải mở lại phán
> quyết.
>
> **Đo lại, liệt kê trước rồi mới đếm.** Đứng tại `D:\SOURCES\avi-aoi-sim\tools\machine-simulator`, chạy
> `scripts/repo-scan.sh` **bản đã sửa** (mục 40 — mặc định `SPECS=(".")` từng biến thành `:(top).`, một
> pathspec khớp KHÔNG GÌ, nên mọi phép quét không nêu pathspec trả 0; nay miền được đếm trước và **miền
> rỗng bị TỪ CHỐI**). Ba phép quét, ba lời khai miền:
>
> | phép quét | pathspec sau khi viết lại | file trong miền | dòng khớp |
> |---|---|---:|---:|
> | `--sha cfcfae42 -n -F '.Reset()'` | `:(top)` | 63441 | **7** |
> | `--sha cfcfae42 -n -F '.Reset()' -- 'tools/machine-simulator/*' 'server/*' 'client/*' 'examples/*'` | bốn spec `:(top)…` | 3177 | **7** |
> | `--sha HEAD -n -F '.Reset()'` (HEAD = `927c0246`) | `:(top)` | 63441 | **10** |
>
> Bảy dòng ở `cfcfae42`, **không phải một**: năm nằm trong chính `docs/owner-decisions.md`, một là **chú
> thích** ở `src/St4i.EdgeCore/Uns/UnsPublisher.cs:391`, và một là chỗ gọi thật
> `tests/St4i.EdgeCore.Tests/Uns/Sparkplug/SparkplugAliasTableTests.cs:76`. Trong `*.cs` (548 file ở
> `HEAD`) chỉ có **hai** dòng, và chỉ **một** trong hai là chỗ gọi. Quét `Reset()` không có dấu chấm trên
> cùng miền `*.cs` ra **một** dòng nữa và nó là dòng **khai báo** `SparkplugAliasTable.cs:76`.
>
> 🔴 **Chỗ sai KHÔNG phải miền.** Hàng thứ hai của bảng là **đúng miền câu gốc tự nêu** — 3177 file — và
> nó cũng trả **7**. Nên đây không phải chuyện "đo hẹp rồi phát biểu rộng"; đây là một phép đếm chệch 6
> đơn vị ở đúng cái miền nó khai.
>
> **Cái gì SỐNG SÓT, nói một cách một chiều thì là nửa sự thật nên nói cả hai chiều.** Kết luận
> *"**Không caller sản xuất nào**"* **ĐỨNG VỮNG và mạnh hơn trước**: mở hết tập `*.cs` toàn repo ở `HEAD`
> vẫn chỉ **một** chỗ gọi, và nó là unit test ấy. Cái không đứng là mệnh đề *"**một** dòng chứa
> `.Reset()` trong toàn repo"*. **Một chỗ gọi ≠ một dòng chứa chuỗi.**
>
> 🔴 **Và một cái bẫy phải nêu tên, vì nó là loài tự quy chiếu mục 40 §1(d) đã rút hai con số vì nó:**
> con số này **KHÔNG ỔN ĐỊNH theo thiết kế**. Phép quét chạy trên một cây **có chứa chính tài liệu đang
> phát biểu con số**, nên mỗi lần mục này bàn thêm về `.Reset()` thì số dòng lại tăng — 7 ở `cfcfae42`,
> **10** ở `927c0246`, và đoạn rút này tự nó nâng tiếp. Vì vậy **không** con số dòng nào được ghim ở đây
> như một hằng: cái đáng ghim là **một chỗ gọi**, tại một SHA có nêu tên, trên một miền có khai báo.

**Cái gì hỏng vì thiếu DBIRTH — và một nửa câu trả lời là một CHỖ TRỐNG được giữ nguyên là chỗ trống.**
Theo đặc tả Sparkplug B, một device chưa có giấy khai sinh là **không hợp lệ**: một host nghiêm (Ignition,
HiveMQ) coi nó là không biết / STALE. Nhưng *"có người đăng ký nào TRONG TẦM ĐO bị ảnh hưởng không"* là
một câu hỏi khác, và câu trả lời là: **CHƯA ĐO ĐƯỢC TỪ ĐÂY.** Mục 32 ghi lại rằng người đăng ký gương
MQTT retained nằm **ngoài mọi phép quét dụng cụ này chạy được** — 37 file dưới `server/`+`client/` nhắc
`syn/`, **chưa cái nào chứng minh là một người đăng ký**. AX-1 **không** lấp chỗ trống ấy: không có phép
đo mới nào về nó trong nhiệm vụ này, và **không suy đoán nào được viết vào đây thay cho một phép đo**.
Cái đo được, và nó làm dịu hậu quả chứ không xoá nó: `SparkplugPayload.EncodeMetric` ghi **cả `Name` lẫn
`Alias`** trên mọi metric vô điều kiện — đo lại 2026-08-22 tại hai cặp `WriteTag` của nó, không suy ra —
nên một subscriber giải mã được DDATA đầy đủ **mà không cần DBIRTH nào**. Cái hỏng là **tuân thủ đặc
tả**, không phải **giải mã được**.

**TÀI LIỆU NÓI SẢN PHẨM PHÁT DBIRTH — liệt kê trước, rồi mới rút.** Quét `DBIRTH|DDEATH` toàn
`tools/machine-simulator` qua `repo-scan.sh`: **bốn** câu khẳng định còn sống và **hai** trong bốn sai
theo hai chiều NGƯỢC NHAU, cả hai trong cùng một file:

* `SparkplugAliasTable` (doc lớp) — *"G2-2 does not yet emit NBIRTH/DBIRTH … that sequencing is G2-3"*.
  **SAI theo chiều ngược**: NBIRTH **được phát** hôm nay, G2-3 đã làm nửa ấy. **Rút tại chỗ kèm ngày.**
* `SparkplugAliasTable` (doc lớp) — *"`Reset` is what a genuine (D)BIRTH (G2-3) **will** call"*. **SAI**:
  đường ấy đã bị xoá 2026-08-21. **Rút tại chỗ kèm ngày.**
* `SparkplugAliasTable.Reset` (doc method) — *"the G2-3 (D)BIRTH hook"*. **SAI**, cùng lý do. **Rút.**
* `SparkplugSeqTracker` (doc lớp) — liệt kê sáu loại thông điệp như thể chúng chảy qua bộ đếm này.
  Đúng **như một phát biểu của ĐẶC TẢ**, gây hiểu nhầm như một phát biểu về spine này. **Thu hẹp tại chỗ
  kèm ngày**, kèm phép đếm ba-trong-sáu ở trên.

📎 **Hai chỗ ĐO RỒI VÀ KHÔNG SỬA, nói ra để phép liệt kê trên không đọc như một tập rỗng có chọn lọc:**
(a) `README.md` §16.1 mô tả vòng đời Sparkplug của spine này là *"NBIRTH … on a real operator Start;
NDEATH on Stop or Estop; DDATA once per committed reading"* — **KHÔNG nhắc DBIRTH, và đúng nguyên văn
với phép đo hôm nay**; không có gì để rút. (b) `docs/plans/2026-07-27-giaidoan2-…-blueprint.md` liệt kê
`NBIRTH|DBIRTH|NDATA|DDATA` trong một họ topic — đó là một **bản thiết kế** tự khai *"NEEDS user scoping
decisions before execute"*, tức một dự định lịch sử, **không phải một khẳng định về sản phẩm**; không
sửa một tài liệu kế hoạch để nó khớp kết quả.

🔴 **Và một câu của chính mục này KHÔNG đứng vững sau khi đo lại.** Thân mục viết
*"`SparkplugAliasTable.Reset()` — liệt kê caller trước khi đếm: `SparkplugAliasTableTests.Reset_Clears
AssignmentsAndRestartsNumberingAtOne`. Hết."* Con số **một** đúng, nhưng nó được đo ở **miền hẹp hơn miền
nó được phát biểu**: phép đo ấy không nêu là đã mở `server/` và `client/`. AX-1 mở, và kết luận không
đổi. **Đây là MỞ RỘNG, không phải RÚT** — câu gốc giữ nguyên văn ở trên.

**Nhân chứng.** 🔴 **KHÔNG có nhân chứng đỏ được cho mục này, và không thể có một cái trung thực:** mục
**DỪNG**, không đổi hành vi, nên không có hành vi mới nào để gác. Bốn phép rút tài liệu là **đổi lời**.
**Không hằng số nào của cổng dịch vì mục 35.** Cái duy nhất mục này để lại cho cổng là bốn câu doc mới,
và chúng nằm trong 19 khẳng định tuyệt đối mà `EXPECT_NEW_DOC_ABSOLUTES` nay ghi — đọc từng câu một, xem
khối hằng số trong `verify-suites.sh`.

### ✅ ĐÃ THI HÀNH 2026-08-23 (BE-1, base `90c67503`) — **PHÁN QUYẾT CỦA CHỦ SỞ HỮU 2026-08-23**: ghi là **nợ ĐÃ NHẬN, không phát**. Không một dòng mã, không một payload nào đổi

🔨 **PHÁN QUYẾT CỦA CHỦ SỞ HỮU, 2026-08-23: GHI LÀ NỢ ĐÃ NHẬN, KHÔNG PHÁT.** Không đổi payload MQTT.
**Mọi dòng thân mục gốc ở trên giữ NGUYÊN VĂN.** Mục rời **Phần I → Phần III** cùng ngày.

**Việc đã trả:** món nợ nay được ghi **vào mục này VÀ vào tài liệu người dùng đọc** — rằng spine này phát
**NBIRTH, NDEATH, DDATA** và **CỐ Ý không phát DBIRTH/DDEATH**; rằng theo chuẩn Sparkplug B đó là **một
node KHÔNG HỢP LỆ** (host nghiêm coi device là không biết / STALE); và rằng đây là **một món nợ ĐÃ NHẬN,
CÓ TRẦN**, không phải một chỗ sót.

**TẬP TÀI LIỆU — LIỆT KÊ TRƯỚC, ĐẾM SAU, và tập này RỘNG HƠN tập AX-1 mở.** Quét bằng
`scripts/repo-scan.sh --sha HEAD` đứng tại `D:\SOURCES\avi-aoi-sim\tools\machine-simulator`, ba miền khai
tường minh: `-E 'DBIRTH|DDEATH' -- ':(top)'` (63441 file, **144** dòng); cùng mẫu
`-- 'tools/machine-simulator/*'` (867 file, **64** dòng); `-iE 'sparkplug' -- 'tools/machine-simulator/*'`
(867 file, **375** dòng). Phân loại toàn tập:

* 🔴 **NÓI thẳng rằng spine phát DBIRTH: KHÔNG CÒN CÁI NÀO.** Bốn câu ấy **AX-1 đã rút ngày 2026-08-22**,
  và BE-1 **mở bốn chỗ ấy ra đọc lại**: cả bốn còn nguyên, có ngày, có trích nguyên văn câu bị rút —
  `SparkplugAliasTable` (doc lớp, **hai** câu trong một khối) và (doc method `Reset`), cộng
  `SparkplugSeqTracker` (doc lớp, nhãn **SCOPED** chứ không **RÚT**, và đó là động từ đúng: danh sách sáu
  loại đúng **với ĐẶC TẢ**, chỉ gây hiểu nhầm khi đọc như một phát biểu về spine này). **Không phát hiện
  nào trong phần việc của AX-1.**
* 🔴 **HÀM Ý — và đây là chỗ AX-1 KHÔNG mở hết tập, nên nó được mở ở đây.** Sáu chỗ trình bày một vòng
  đời Sparkplug **như thể đã đóng**, tất cả đều là **bề mặt người dùng đọc**, không phải mã:
  **README §16.1** (câu liệt kê NBIRTH/NDEATH/DDATA dưới tiêu đề *"Sparkplug B"*, đi tới tận mức device
  mà không bao giờ nói device không có giấy khai sinh) **EN và VI**; **README bảng lộ trình P2**
  (*"Sparkplug B: delivered"* không định lượng, trong khi hàng Modbus và OPC-UA ngay dưới đều ghi rõ
  *"partially delivered — Not yet: …"*) **EN và VI**; **README §17.7** (bridge *"republishes every
  message"* trên `spBv1.0/#`); và **`docs/SYNAPSE_GAP_AND_MIDDLEWARE_ROADMAP_2026-07-26.md:73`**, một hàng
  **sổ giao hàng**.
  🔴 **AX-1 đã ĐỌC README §16.1 và kết luận *"KHÔNG nhắc DBIRTH, và đúng nguyên văn với phép đo hôm nay;
  không có gì để rút."* Câu ấy ĐÚNG và VẪN ĐÚNG** — nó là một phán xét về **phép RÚT**, và không có gì để
  rút ở đó. Cái nó bỏ sót là **phép THU HẸP**: một câu đúng-đến-hết-cái-nó-nói, đặt dưới một tiêu đề nêu
  tên một chuẩn, **im lặng đúng chỗ chuẩn ấy bị vi phạm**. Ba thao tác của file này vẫn phân biệt — RÚT /
  MỞ RỘNG / SỬA TẠI CHỖ — và đây là **cái thứ ba**, nên **không một chữ nào của AX-1 bị rút**.
* **ĐO RỒI, KHÔNG SỬA, nói ra để phép liệt kê trên không đọc như một tập rỗng có chọn lọc:** ~26 chỗ khác
  chia làm bốn nhóm và **không nhóm nào là một khẳng định sai về sản phẩm này** — (a) **bia mộ đúng** đã
  ghi sự vắng mặt (`UnsTopicBuilder` doc `SparkplugMsgType`/`DBIRTH`/`DDEATH`, `IUnsPublisher`,
  `UnsPublisher.cs:390`, `UnsNodeLifecycleTests`, `verify-suites.sh:1933`, `Directory.Build.props`);
  (b) **hệ `server/` TypeScript**, vốn **THẬT SỰ phát DBIRTH** (`.env.example`, `docs/ECOSYSTEM/*`,
  `docs/EDGE_GATEWAY.md`) — đúng, ngoài phạm vi, và chính là chỗ nhầm phạm vi mà thân mục trên đã bắt;
  (c) **bản kế hoạch/blueprint** nêu ý định lịch sử — không sửa một tài liệu kế hoạch để nó khớp kết quả;
  (d) **khai báo enum / dựng topic / mã test**, không phải khẳng định về việc PHÁT.

**CÁI GÌ BỊ RÚT/THU HẸP TẠI CHỖ KÈM NGÀY, và nó nằm ở TÀI LIỆU NGƯỜI DÙNG ĐỌC chứ không ở doc comment:**
**README §16.1** nhận một khối *"KHÔNG PHẢI MỘT NODE SPARKPLUG B TUÂN ĐẶC TẢ"* **EN + VI**; **README
§20.5** — chỗ hồ sơ này đã lập làm nhà cho đúng loài phát biểu ấy, và là chỗ mà khoảng trống DBIRTH là
**thiếu sót nổi bật DUY NHẤT** trong một danh sách đã mang hai cảnh báo UNS/Sparkplug khác — nhận một gạch
đầu dòng đầy đủ; **bảng lộ trình P2 EN + VI** thu hẹp từ *"delivered"* thành *"partially delivered"* kèm
mệnh đề **Not yet**, đúng khuôn hai hàng kề nó.

🔴 **CHỖ TRỐNG GIỮ NGUYÊN LÀ CHỖ TRỐNG, VÀ BE-1 KHÔNG ĐO NÓ.** *"Có người đăng ký gương retained nào TRONG
TẦM ĐO bị ảnh hưởng không"* vẫn là **CHƯA ĐO ĐƯỢC TỪ ĐÂY** — 37 file dưới `server/`+`client/` nhắc `syn/`,
**chưa cái nào được chứng minh là một người đăng ký**. **Không phép đo mới nào về nó trong nhiệm vụ này,
và không một suy đoán nào được viết vào thay cho một phép đo** — ở mục này, và ở **cả hai** bề mặt README
mới, nơi chỗ trống ấy được nêu tên **thành lời** chứ không bị im lặng lấp đi.

**Nhân chứng — và tự dán nhãn cho đúng.** 🔴 **ĐÂY KHÔNG PHẢI MỘT NHÂN CHỨNG ĐỎ ĐƯỢC, và không thể có một
cái trung thực:** mục **không đổi một dòng mã nào và không đổi payload nào**, nên **không có hành vi mới
nào để gác**. Nhân chứng của nó là **W-1 xanh** (`DocCommentProseTests`, hình thức doc) **cộng phép đo ở
trên chứng minh lời mới đúng**. Câu *"không có nhân chứng đỏ được"* trong khối AX-1 ngay trên **vẫn đúng
từng chữ** và không bị rút. **Không hằng số suite nào dịch vì mục 35** — bốn bề mặt sửa là `README.md` và
một `docs/*.md`, và cả hai **nằm NGOÀI corpus của `scan-doc-negations.sh`**, vốn **chỉ quét C#** (§e của
chính nó), nên `EXPECT_NEW_DOC_ABSOLUTES` **không dịch vì mục 35** — đo lại, không suy ra.


---

## 30. Gốc mặc định của các store cạnh-binary là `%ProgramFiles%`, MSI không mang bốn file ấy, nên lần chạy đầu của một bản cài mặc định CHÍNH LÀ lần phải GHI

🔴 **CHỜ ANH.** Mở 2026-08-20 (AO-1). 🔴 **Câu hỏi này bị các brief liên tiếp CẤM mở — mỗi đợt từ 4
tới 8 đều mang dòng *"no new question of the two forbidden kinds"*. Lệnh cấm ấy hết hiệu lực ở nhiệm
vụ này, và đây là chỗ nó được mở.**

**Đo được cái gì — LIỆT KÊ TRƯỚC, và KHÔNG dựng MSI, KHÔNG đụng `publish-desktop/`.** Ba store ghi
cạnh nhị phân, và bốn file mà cổng của chính repo này miễn trừ đích danh là *"operator-editable"*
đến từ hai trong ba:

* **`ProductConfigStore`** — `RootDirectory = string.IsNullOrWhiteSpace(directory) ? AppContext.BaseDirectory : directory`,
  ghi `products.json` và `recipes.json`. 🔴 **Hàm dựng của nó GHI:** `if (!productsExisted) SaveProducts(); if (!recipesExisted) SaveRecipes();` — và chú thích ngay trên nói rõ ý định: *"so a fresh install has real files on disk the moment it boots"*.
* **`SimulatedEcosystem`** — mặc định `Path.Combine(AppContext.BaseDirectory, "ecosystem")`, ghi
  `ecosystem-products.json` và `ecosystem-recipes.json`.
* **`MachineConfigStore`** — `DefaultRoot() => AppContext.BaseDirectory`, ghi
  `machine-operating-config.json`.

🔴 **Và một bất đối xứng chỉ lộ ra khi liệt kê cả ba: chỉ MỘT trong ba có đường thoát.**
`MachineConfigStore` có `EnvVarDir = "ST4I_MACHINE_CONFIG_DIR"` và đọc nó. Hai store kia **không có
biến môi trường nào** và được đăng ký bằng `builder.Services.AddSingleton<ProductConfigStore>()` /
`AddSingleton<SimulatedEcosystem>()`, tức **hàm dựng không tham số**, tức **luôn** là gốc mặc định.
Hai store không có đường thoát chính là hai store sinh ra bốn file mà cổng gọi là của vận hành viên.

**Bốn file ấy KHÔNG được git theo dõi** (`git ls-files` không trả về cái nào), nên chúng không nằm
trong nguồn để `dotnet publish` chép vào `publish-desktop/`, nên bản harvest cả-thư-mục của
`St4i.Installer.wixproj` **không có gì để mang**. Và `Package.wxs` cài vào
`StandardDirectory Id="ProgramFiles6432Folder"` → `ST4I` → `Machine Simulator` (`INSTALLFOLDER`), với
engine ở thư mục con `engine`. **Nên `AppContext.BaseDirectory` của một bản cài mặc định là một thư
mục dưới `%ProgramFiles%`, và lần khởi động đầu tiên là lần đầu tiên có ai đó GHI vào đó.**

**Ở đâu trong mã — trỏ bằng TÊN.** `St4i.EdgeCore.Config.ProductConfigStore` (hàm dựng,
`SaveProducts`, `SaveRecipes`, `WriteAllTextAtomic`);
`St4i.EngineApi.Config.SimulatedEcosystem`; `St4i.EdgeCore.Config.MachineConfigStore.DefaultRoot`
và `.EnvVarDir`; `St4i.EngineApi.Program` (ba dòng `AddSingleton`);
`packaging/installer/Package.wxs` (`ProgramFiles6432Folder`, `INSTALLFOLDER`, `EngineDir`);
`packaging/installer/St4i.Installer.wixproj`; `scripts/verify-suites.sh` (danh sách miễn trừ bốn
file, trong bracket `suite output directories under watch`).

**Hậu quả vận hành, HAI CHIỀU.**
*Chiều thuận:* `%ProgramFiles%` **thường chỉ đọc với người dùng thường**. Một bản cài mặc định chạy
dưới một tài khoản không nâng quyền gặp đường ghi ấy **ở hàm dựng của một singleton DI**, tức **trên
đường khởi động**, trước khi bất kỳ ai yêu cầu một thay đổi nào. Đó là đúng hình dạng mà mục 6 và
mục 7 của file này đã phải quyết một lần rồi: một lần cài đặt hỏng phát ra ở đâu và tiến trình dừng
hay đi tiếp. Và nó chạm mục 1/5/11/13 — cả bốn nói về việc một lần khởi động **bình thường** ghi đè
dữ liệu của vận hành viên.
*Chiều ngược, và nó là lý do thiết kế này tồn tại:* để bốn file ấy **cạnh nhị phân** khiến chúng
**tìm thấy được**: một kỹ sư hiện trường mở thư mục cài đặt và thấy đúng cấu hình đang chạy, không
phải một cây `%ProgramData%` ẩn. Và trên hai cách chạy phổ biến nhất **hôm nay** — chạy từ thư mục
build, và chạy bản triển lãm — thư mục ấy **ghi được**, nên vấn đề chưa từng nổ. Chuyển gốc sang
`%ProgramData%` là **đổi chỗ dữ liệu của một bản cài đã có**, tức đúng loại phép **DI CHUYỂN** mà
file này đã miễn trừ **chỉ cho mục 10**.

**Nếu KHÔNG quyết định.** Ba khả năng ở lại cùng lúc và không cái nào được ghi là đã chọn: bản cài
mặc định chạy được vì người dùng tình cờ có quyền; hoặc nó hỏng ở khởi động; hoặc nó chạy nhưng
**bốn file cấu hình không bao giờ bền vững qua một lần khởi động lại**. 🔴 **Và phép đo này tự nêu
tên chỗ nó không tới được: nó KHÔNG dựng MSI và KHÔNG chạy một bản cài.** Nó đọc `Package.wxs`,
`.wixproj`, các hàm dựng store và `git ls-files` — bốn thứ đều tra lại được. Câu *"chuyện gì thực sự
xảy ra khi một người dùng không nâng quyền chạy bản `.msi`"* đòi một dụng cụ thứ ba, và dựng nó là
một brief khác.

### 🔴 AV-1 (2026-08-22, base `e6faec60`) — ĐƯỢC GIAO THI HÀNH, **ĐÃ DỪNG**. Điều kiện DỪNG nổ, và bốn câu của mục này không sống sót nguyên vẹn qua phép đo

**Vì sao DỪNG, một câu.** Mọi bản sửa trả lời **câu hỏi ở tiêu đề** — *"gốc mặc định nên là gì"* — đều
**đổi nơi dữ liệu vận hành viên sống**, và với một bản cài đã tồn tại đó chính là phép **DI CHUYỂN** mà
lời giao việc của AV-1 nêu tên là điều kiện dừng. Miễn trừ di-chuyển của mục 10 **chỉ áp cho mục 10**.
Mục này **ở lại Phần I**; những gì thêm ở đây là phép đo, không phải một phán quyết.

🔴 **Và một đường thoát KHÔNG-di-chuyển đã được xét rồi bỏ, chứ không bị bỏ quên.** Thêm một
`EnvVarDir` cho hai store không seam (kiểu `MachineConfigStore`) **không** dời gốc mặc định, nên
**không** di chuyển gì. Nó bị bỏ vì hai lý do đo được, không phải vì khẩu vị: (1) nó **không trả lời**
câu hỏi ở tiêu đề, vốn là về **mặc định**, không về khả năng dời; (2) `scripts/verify-suites.sh` có một
nhánh **FAIL tường minh** bắn ngay khi một trong hai file ấy khai `EnvVarDir` — cổng tự nói rằng miễn trừ
outdir của nó **tồn tại chỉ vì store không dời được**, và đòi store được nối vào
`tests/Shared/TestRunTempRoot.cs` cùng lúc. Đó là một thay đổi có thật, đúng hướng, và nó là **một quyết
định của chủ sở hữu về cơ chế dời**, không phải một phép sửa lặng lẽ kèm theo.

**QUẦN THỂ — LIỆT KÊ TRƯỚC, ĐẾM SAU, và con số trong lời giao việc của AV-1 SAI.** Lời giao việc nói
*"**bốn** store"*. Đo được: **BA** store, sinh **NĂM** file, trong đó cổng miễn trừ đích danh **BỐN**.
Thân mục này đã viết đúng *"ba store"* từ đầu — chữ "bốn" đến từ **ô tóm tắt ở bảng phán quyết**, đã sửa
tại chỗ ở trên. Quần thể **không phải lấy từ ba cái tên ai đó đưa**: nó đã được liệt kê độc lập trong
cây, ở `tests/St4i.EngineApi.Tests/PerHostDataRootsTests` —
`TheBesideTheBinaryStorePopulation_IsEnumerated_AndKeptDistinctFromTheThirteenMachineWideOnes` — và phép
liệt kê ấy đo lại **ĐỨNG VỮNG**, gồm cả lý do nó **loại** `FleetConfig` (không có bộ ghi nào).

| store | gốc mặc định | đường thoát | file | AI ghi, và ghi LÚC NÀO |
|---|---|---|---|---|
| `ProductConfigStore` | `AppContext.BaseDirectory` | **không có** — `AddSingleton<ProductConfigStore>()`, hàm dựng không tham số | `products.json`, `recipes.json` | **hàm dựng**, gián tiếp: ctor → `Load()` → `if (!productsExisted) SaveProducts(); if (!recipesExisted) SaveRecipes();`. 🔴 Câu của mục này — *"hàm dựng của nó GHI"* — **đúng về hậu quả**, nhưng hai dòng ấy nằm trong `Load()`, không nằm trong hàm dựng; ai đi tìm chúng trong ctor sẽ không thấy |
| `SimulatedEcosystem` | `AppContext.BaseDirectory` + `\ecosystem` | **không có** — cùng hình dạng | `ecosystem-products.json`, `ecosystem-recipes.json` | **hàm dựng**: ctor → `Directory.CreateDirectory(<gốc>\ecosystem)` → `Load()` → `if (!productsExisted \|\| !recipesExisted) Save();`, và `Save()` ghi **CẢ HAI** |
| `MachineConfigStore` | `AppContext.BaseDirectory` | **có** — `ST4I_MACHINE_CONFIG_DIR` | `machine-operating-config.json` | **KHÔNG phải hàm dựng**: `Load()` `return` ngay khi file vắng. Ghi lần đầu ở **thao tác đầu tiên của vận hành viên** |

🔴 **HỎNG THẾ NÀO KHI THƯ MỤC CHỈ ĐỌC — ĐO THỰC TẾ, KHÔNG ĐỌC MÃ RỒI ĐOÁN.** Một probe ngoài cây dựng
đúng ba lớp store ấy trên một thư mục thật bị `icacls /deny (OI)(CI)(WD,AD,DC,DE)`. **Không có nhánh nào
nuốt lỗi và không có nhánh nào ghi sang chỗ khác** — mọi thất bại là một `UnauthorizedAccessException`
ném thẳng ra:

* `ProductConfigStore` ctor, gốc chỉ-đọc **trống**: **NÉM**, tại file `products.json.tmp-<guid>` mà
  `WriteAllTextAtomic` tạo. Trên đĩa sau đó: **rỗng**.
* `ProductConfigStore` ctor, gốc chỉ-đọc **đã có cả hai file**: **KHÔNG ném**, nạp bình thường. Nên
  nhánh chết **chỉ là nhánh SEED** — đúng cái ca *"lần chạy đầu của một bản cài mặc định"* mà tiêu đề
  mục này nêu, và không phải ca nào khác.
* `ProductConfigStore.UpsertProduct` (ghi đầu tiên của vận hành viên) trên gốc chỉ-đọc: **NÉM**.
* `SimulatedEcosystem` ctor, thư mục CHA chỉ-đọc: **NÉM tại `Directory.CreateDirectory(...\ecosystem)`**
  — **trước cả khi tới một file nào**. Đây là store hỏng **sớm nhất** trong ba, và mục này không nêu:
  hai store kia gọi `CreateDirectory` trên một thư mục **đã tồn tại**, tức một no-op không đòi quyền ghi.
* `MachineConfigStore` ctor, gốc chỉ-đọc trống: **KHÔNG ném**. Ghi đầu tiên của vận hành viên (`Ensure`):
  **NÉM**.

**Hậu quả trên đường khởi động.** `src/St4i.EngineApi/Program.cs` gọi
`app.Services.GetRequiredService<FleetHost>()` **eager**, và cả hai store không-seam là tham số hàm dựng
của `FleetHost`, nên cả hai được dựng **ở đó**; `docs/startup-failure-posture.md` §3.5 xếp cả hai là **S**
(tiến trình kết thúc).

> 🔴 **RÚT MỘT KHẲNG ĐỊNH CỦA CHÍNH AV-1, 2026-08-22, cùng ngày nó được viết, giữ nguyên văn.** Bản đầu
> của đoạn ngay trên đọc: *"🔴 **Cái §3.5 chưa từng có là một phép ĐO**: nó là một suy luận từ mã. Phép đo
> ở trên là lần đầu tiên nhánh ấy được **chạy**, và nó **xác nhận §3.5**, kể cả chi tiết §3.5 không nêu
> (nhánh `ecosystem\` chết sớm hơn một bước)."* **Câu ấy SAI, và nó sai theo đúng cách file này tồn tại để
> bắt: nó tuyên bố mới cho một thứ đã có hồ sơ.** Nhiệm vụ **AC-1** đã chạy nhánh ấy rồi, **trên chính
> `publish-desktop\engine\St4i.EngineApi.exe`**, dưới một deny ACE thật, và đã ghi:
> `UnauthorizedAccessException` ra từ `SimulatedEcosystem..ctor` → `Directory.CreateDirectory`, mã thoát
> `0xE0434352`, **không** dòng `Now listening on:`; cộng một phép đo **trên bản `.msi` đã dựng** (nó mang
> `fleet.json` và **không** mang `products.json`); cộng chính câu *"quần thể là ba store, số file là bốn"*;
> cộng chính lập luận *"bản sửa không phải một seam"*. Và nó **có nhân chứng đang chạy trong cổng này**:
> `OperatorDataRemovalCensusTests.OverANonWritableRoot_TheTwoSeamlessBesideTheBinaryStoresEndTheProcess_AndTheSeamedOneDoesNot`,
> bài test khẳng định **bit deny của chính nó** trước rồi mới khẳng định về store. **Tôi đã không đọc nó
> trước khi viết probe của mình.** Ghi ra thay vì sửa lặng, vì *"đo lại rồi tuyên bố mới"* tốn đúng bằng
> *"không đo"* đối với người đọc sau.

🔴 **CÁI PROBE CỦA AV-1 THẬT SỰ THÊM VÀO — bốn thứ, không phải một phép đo đầu tiên:**
1. **`ProductConfigStore` ctor trên gốc chỉ-đọc ĐÃ CÓ CẢ HAI FILE: KHÔNG ném.** Bài test đã ghim dùng một
   thư mục **rỗng**, nên nó chỉ đi qua nhánh **SEED**. Đây là thứ biến *"nhánh chết đúng là lần khởi động
   đầu của một bản cài mới"* từ một cách đọc thành một phép đo.
2. **Ghi ĐẦU TIÊN của vận hành viên ném** — `ProductConfigStore.UpsertProduct` và `MachineConfigStore.Ensure`.
   Bài test đã ghim dừng ở hàm dựng.
3. 🔴 **`SimulatedEcosystem` ghi lại CẢ HAI file khi chỉ MỘT vắng** — không có ở §3.5, không có ở §3.6,
   không ghim ở đâu. Xem khối cuối mục này.
4. **Một sai lầm của dụng cụ, của chính tôi.** Vòng probe đầu dùng `icacls /deny …:(W)`; quyền đơn giản
   `(W)` ánh xạ sang `FILE_GENERIC_WRITE`, **bao gồm `SYNCHRONIZE`**, nên nó chặn cả một lần mở ĐỌC — và
   probe báo (1) **ném**, tức ngược hẳn. Quyền cụ thể `(WD,AD,DC,DE)` đảo lại kết quả. Bài test đã ghim
   dùng `CreateFiles | CreateDirectories`, vốn không có tật ấy; **nếu tôi đọc nó trước, tôi đã không mắc**.
   Nếu tôi tin vòng đầu, tôi đã báo một khuyết tật không tồn tại.

🔴 **BỐN CHỖ TRONG MỤC NÀY KHÔNG SỐNG SÓT NGUYÊN VẸN, ghi ra chứ không vá đè:**
1. *"bốn store"* ở ô bảng phán quyết — **ba**. Đã sửa tại chỗ ở bảng.
2. *"Hàm dựng của nó GHI"* — đúng hậu quả, **sai vị trí**: hai dòng ấy ở trong `Load()`.
3. *"MSI **không mang** file nào trong bốn"* — **đúng cho đường mặc định, KHÔNG đúng vô điều kiện.** (Và
   nửa "đúng" của nó mạnh hơn lý do mục nêu: mục suy từ *"không được git theo dõi"*; **AC-1 đã đo trên một
   bản `.msi` ĐÃ DỰNG** — nó mang `fleet.json` và **không** mang `products.json`.)
   `build-installer.ps1` **xoá `publish-desktop/`** trước mỗi lần publish, nên một lần dựng đầy đủ đúng
   là không mang gì. Nhưng script ấy công bố cờ **`-SkipDotnetPublish`**, và ở nhánh đó nó **không xoá**;
   harvest thì đọc **cả thư mục**. **Đo trên đĩa hôm nay:** `publish-desktop/engine/products.json` và
   `recipes.json` mang dấu thời gian **07:11 ngày 2026-08-20**, tức **SAU** lần publish 07:09–07:10, và
   `publish-desktop/engine/ecosystem/` chứa đủ hai file cùng dấu thời gian ấy. Tức có người **đã chạy**
   bản engine vừa publish, và bốn file ấy là **sản phẩm của chính cơ chế mục này mô tả**, đang nằm sẵn
   trong cây harvest. Một `-SkipDotnetPublish` chạy hôm nay **giao chúng cho khách hàng**.
4. *"nó KHÔNG dựng MSI và KHÔNG chạy một bản cài"* — vẫn đúng cho AV-1 (không bản `.msi` nào được dựng),
   nhưng chỗ-thiếu **nhỏ hơn** mục nghĩ: phép đo hỏng-thế-nào **không** cần một bản cài, chỉ cần một thư
   mục chỉ-đọc, và nó đã chạy. Cái còn thiếu thật sự là **hành vi của Windows Installer + UAC**, không
   phải hành vi của store.

**Một khuyết tật LIỀN KỀ, tìm thấy khi đo, KHÔNG sửa ở đây vì nó không phải mục này.**
`SimulatedEcosystem.Load` chạy `if (!productsExisted || !recipesExisted) Save();` và `Save()` ghi **cả
hai** file. Đó **đúng bằng byte** khuyết tật mà V-1 đã sửa cho `ProductConfigStore` (*"seeding one file is
not a reason to rewrite the other"*), còn sống trong store anh em. **Đo được:** với một
`ecosystem-products.json` viết tay dài 4 byte và `ecosystem-recipes.json` vắng, chỉ **DỰNG** store đã
viết lại file ấy thành 2 byte — định dạng của vận hành viên và mọi trường mà `ProductModel` không khai
đều mất, trên một lần khởi động **bình thường**, không ai yêu cầu thay đổi gì. Đối chứng cùng probe:
`ProductConfigStore` ở đúng hình dạng ấy **không đụng** file (4 byte trước, 4 byte sau) — bản sửa của V-1
đứng vững. Đây là hình dạng của mục **1/5/11/13**; nó cần một mục riêng, không phải một dòng phụ ở đây.

### 🔴 BE-1 (2026-08-23, base `90c67503`) — **PHÁN QUYẾT CỦA CHỦ SỞ HỮU 2026-08-23: CHUYỂN GỐC SANG `%ProgramData%`.** Phép đo điều-kiện-tiên-quyết đã trả và **BÁC tiền đề của chính câu hỏi**; đường di trú đã chọn; **phép CHUYỂN CHƯA THI HÀNH** — mục **Ở LẠI PHẦN I**

🔨 **PHÁN QUYẾT CỦA CHỦ SỞ HỮU, 2026-08-23: CHUYỂN GỐC SANG `%ProgramData%`.** Chủ sở hữu **đã được nêu**
rằng một bản cài ĐÃ TỒN TẠI sẽ thôi thấy dữ liệu ở gốc cũ, và **vẫn chọn hướng này**. **Mọi dòng thân mục
gốc ở trên giữ NGUYÊN VĂN.**

#### 1. 🔴 PHÉP ĐO PHẢI LÀM **TRƯỚC** KHI ĐỔI GỐC — **bốn miễn trừ trỏ theo TÊN, không theo ĐƯỜNG DẪN**. Tiền đề của câu hỏi **KHÔNG sống sót**

Câu hỏi đặt ra: nếu bốn miễn trừ trỏ theo **đường dẫn** thì đổi gốc **làm hỏng cổng**. **Đo: chúng trỏ
theo TÊN — theo BASENAME — nên đổi gốc KHÔNG làm hỏng chúng theo đường ấy.** Hai nửa của bằng chứng, cả
hai đọc được lại:

* **Miền so khớp là basename.** `scripts/verify-suites.sh`, hàm `outdir_snapshot`, lọc bằng
  `{ p = $1; sub(/^.*\//, "", p); if (!(p in e)) print }` — nó **cắt bỏ mọi thứ tới dấu `/` cuối** rồi mới
  tra tập miễn trừ. Không một thành phần đường dẫn nào tham gia. `tests/Shared/OwnOutputDirectoryGuard.cs`
  mang **cùng** hình dạng ấy ở nửa C#.
* **Danh sách tên KHÔNG được viết tay ở cổng — nó được RÚT RA từ chính nguồn của hai store**, bằng
  `const\s+string\s+\w*FileName\w*\s*=\s*"…\.json"` đọc trên `ProductConfigStore.cs` và
  `SimulatedEcosystem.cs`. **Quan sát trực tiếp trên một lần chạy cổng đầy đủ ở base `90c67503`:**
  `suite output directories under watch: 5 (1092 files at start, exempt: products.json recipes.json
  ecosystem-products.json ecosystem-recipes.json)` — bốn **tên trần**, không đường dẫn.

🔴 **NHƯNG CÂU TRẢ LỜI ĐÚNG DÀI HƠN CÂU HỎI, VÀ NỬA THỨ HAI MỚI LÀ NỬA ĐẮT: đổi gốc VẪN làm hỏng cổng —
qua một cái cửa mà câu hỏi không nêu tên.** Cả hai dụng cụ mang một nhánh **FAIL tường minh** bắn ngay khi
một trong hai store ấy khai `EnvVarDir` (`verify-suites.sh` dòng ~7413, `exit 1`; `OwnOutputDirectoryGuard`
`DeriveExemptFileNames`, `throw` trong module initializer của **cả năm** assembly test). Và
`EnvVarDir` là **bắt buộc** nếu gốc dời: đo được là **20 lớp test dựng `WebApplicationFactory<Program>`**
giải cả ba store qua đồ thị DI thật, nên nếu gốc mặc định dời mà **không** có seam thì hai store ấy bắt
đầu ghi vào **`%ProgramData%\ST4I\sim\…` THẬT** ở mỗi lần chạy suite — và
`AuditWiringTests.ProductUpsert_…` đúc **một sản phẩm mới mỗi lần chạy** (625 sản phẩm, 623 cái một-lần-
một, đã đo và ghi ở `OwnOutputDirectoryGuard`), tức một rò rỉ **không chặn**. **Không dụng cụ nào hôm nay
gác chỗ ấy:** `RealCredentialStoreLeakGuard` và bracket credential của cổng đều **chỉ** canh `…\sim\creds`.
Nên trình tự bắt buộc là **seam + `TestRunTempRoot` + gỡ hai nguồn khỏi danh sách miễn trừ, TRONG CÙNG một
thay đổi** — và cổng tự nói đó là **kết cục TỐT** (*"the exemption existed only because the store could not
be moved"*).

#### 2. Cách credential store tạo thư mục và đặt quyền — **dùng lại một NỬA, và nửa kia là một KHUYẾT TẬT nếu chép**

`CredentialStore` làm hai việc, và chúng **phải tách ra**:
* **Nửa PHẢI dùng lại — phép giải gốc.** `DefaultRoot() => Path.Combine(GetFolderPath(CommonApplicationData),
  "ST4I", "sim", "<leaf>")`, cộng `EnvVarDir`, cộng `ResolveRoot(directory)` theo thứ tự **explicit > env >
  default** (*"pure path arithmetic — does not create anything"*), cộng `Directory.CreateDirectory` ở chỗ
  ghi. Đây là khuôn **đã có 15 store dùng** trong cây này, không phải một phát minh.
* 🔴 **Nửa PHẢI KHÔNG dùng lại — `SecurityDirAcl.Apply`, và đây là một PHÁT HIỆN.** Nó **tắt kế thừa** rồi
  thay mọi rule bằng **đúng ba** grant FullControl: `SYSTEM`, `BUILTIN\Administrators`, và **chủ sở hữu thư
  mục**. Doc của chính nó nói mục đích: gỡ quyền **Read của `Authenticated Users`** mà `%ProgramData%` cho
  mặc định. Áp nó lên bốn file mà **cổng của chính repo này gọi là *"operator-editable"*** sẽ **KHOÁ VẬN
  HÀNH VIÊN RA NGOÀI** chính những file họ được cho là sửa — tức **lật ngược** đúng cái giá trị chiều-thuận
  mà thân mục này nêu (*"một kỹ sư hiện trường mở thư mục cài đặt và thấy đúng cấu hình đang chạy"*).
  **`SecurityDirAcl` là dụng cụ cho thư mục NHẠY CẢM (creds, security, notifications, identity) — bốn file
  cấu hình sản phẩm không thuộc loài ấy.** Chép cả gói vì *"dùng lại cùng cách ấy"* sẽ là một khuyết tật
  ship kèm một lời biện minh.

#### 3. Ba hướng di trú — **đo giá từng cái, chọn một, và ghi lý do hai cái bị loại**

* **(b) Dự phòng khi đọc** *(gốc mới trước, gốc cũ sau, ghi luôn về gốc mới)* — **LOẠI.** Giá: nó **không
  bao giờ hội tụ**. Sau lần ghi đầu, hai gốc **phân kỳ lặng lẽ**; một vận hành viên sửa file ở gốc cũ thấy
  thay đổi có tác dụng **cho tới** lần ghi đầu tiên rồi **thôi có tác dụng mà không có tín hiệu nào**. Đó
  đúng là *"mất dấu"* ở dạng chậm, và nó nhân thêm đúng loài mục **1/5/11/13** (một lần khởi động **bình
  thường** quyết định số phận dữ liệu vận hành viên) trên **mỗi** lần đọc, vĩnh viễn.
* **(c) Chỉ đổi gốc, nêu tên gốc cũ trong log** — **LOẠI làm giải pháp đứng một mình, GIỮ làm phần bổ
  sung.** Giá: rẻ nhất và an toàn nhất về mã, nhưng kênh giao hàng của nó là **stderr của một Windows
  service**, thứ không ai đọc. Với một bản cài đã tồn tại, đó là *"họ thôi thấy dữ liệu của mình"* kèm một
  dòng log làm biện pháp giảm nhẹ duy nhất — tức **chính là** mất dấu, chỉ có thêm một chú thích.
* ✅ **(a) DI TRÚ MỘT LẦN — CHỌN CÁI NÀY**, cộng dòng log của (c) (hai cái **không loại trừ nhau**). Đọc
  gốc cũ, **chép** sang gốc mới **nếu gốc mới chưa có file ấy**, **KHÔNG XOÁ BẢN CŨ** — miễn trừ di-chuyển
  của mục 10 **chỉ áp cho mục 10**, nên bản cũ ở lại đĩa nguyên vẹn và đây là một phép **CHÉP**, không phải
  một phép **DI CHUYỂN**.
  🔴 **Và một cái bẫy đo được, phải đóng trong cùng thiết kế:** nguồn di trú là `AppContext.BaseDirectory`,
  thứ **không dời được bằng biến môi trường**. Nếu chép vô điều kiện thì **mỗi tiến trình test** sẽ hút
  `products.json` còn sót trong **thư mục bin của chính nó** vào gốc đã chuyển hướng — một đầu vào **không
  tất định**, phụ thuộc cặn bã của lần build trước. Nên phép di trú **chỉ được chạy khi gốc được giải ra từ
  MẶC ĐỊNH**, không khi nó đến từ `explicit` hay từ biến môi trường. Điều kiện ấy là một phép đo trên
  `ResolveRoot`, không phải một quy ước.

#### 4. 🔴 GIÁ THẬT CỦA PHÁN QUYẾT, ĐO CHỨ KHÔNG ƯỚC — **một dòng mã kéo theo MƯỜI SÁU artefact, bị bốn dụng cụ điều tra dân số CƯỠNG CHẾ đi cùng nhau**

Phán quyết đọc như một dòng. Đo ra thì nó là một **phép sửa đồng bộ** mà bốn phép kiểm độc lập **từ chối
cho tách rời** — và đó **không phải ma sát tình cờ, đó là thiết kế**: `PerHostDataRootsTests` tồn tại đúng
để ép mọi chỗ phát biểu con số phải dịch cùng nhau. Liệt kê trước:
`ProductConfigStore.cs` · `SimulatedEcosystem.cs` · `MachineConfigStore.cs` · `tests/Shared/TestRunTempRoot.cs`
· `tests/Shared/OwnOutputDirectoryGuard.cs` · `scripts/verify-suites.sh` · `PerHostDataRootsTests.cs` ·
`MachineConfigStoreRootResolutionTests.cs` · `Alarms/NotificationDocumentationTests.cs` ·
`TestHarnessIsolationTests.cs` · `packaging/remove-data.ps1` · `web/playwright.config.ts` ·
`web/scripts/reset-engine-state.mjs` · `README.md` · `docs/startup-failure-posture.md` ·
`OperatorDataRemovalCensusTests.cs`. **Đếm sau khi liệt kê: mười sáu.** Trong đó:
`MachineConfigStoreRootResolutionTests.DefaultRoot_IsBesideTheBinary_AndIsNotUnderProgramData` **đỏ theo
cấu trúc** — và **thông điệp hỏng của chính nó CHÍNH LÀ bản kê việc** ấy; `PerHostDataRootsTests` dòng 602
(`Assert.Equal(new[] { "ST4I_MACHINE_CONFIG_DIR" }, besideBinary…)`) **đỏ vô điều kiện** ở mọi biến thể;
và **con số `thirteen` viết bằng CHỮ** ở `README.md` §15.9 và `remove-data.ps1` `.DESCRIPTION` bị **ghim
bằng test** nên phải thành `sixteen` cùng lúc.

🔴 **VÀ MỘT ĐƯỜNG MẤT DỮ LIỆU **MỚI** MÀ CHỦ SỞ HỮU CHƯA ĐƯỢC NÊU KHI PHÁN — nêu ra ở đây chứ không để nó
tự xảy ra.** Cái đã được nêu là *"bản cài cũ thôi thấy dữ liệu của nó"*. Cái **chưa** được nêu:
`NotificationDocumentationTests.EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioning
Script` **đòi** mọi thư mục `…\sim\<leaf>` phải được `packaging/remove-data.ps1` **xoá**. Nên chuyển bốn
file vận hành viên vào `%ProgramData%\ST4I\sim\` **tự động đưa chúng vào tầm của lệnh xoá khi ngừng sử
dụng** — trong khi hôm nay `remove-data.ps1` **cố ý** không đụng tới chúng và **tự khai** điều đó:
*"This script has never purged them and is not being taught to: they go when the install directory goes."*
**Đó là một phán quyết thứ hai nằm trong phán quyết thứ nhất**, và nó phải được quyết một cách tường minh:
hoặc bốn file ấy **vào** danh sách xoá (một đường mất dữ liệu mới), hoặc chúng được **miễn trừ** khỏi nó
(và phép kiểm điều tra dân số kia phải được dạy về một hạng mục thứ ba). **Không hướng nào được chọn lặng
lẽ ở đây.**

#### 5. 🔴 CHỖ NÀY DỪNG, VÀ NÓI THẲNG NÓ LÀ MỘT GIỚI HẠN CỦA NHIỆM VỤ CHỨ KHÔNG PHẢI MỘT ĐIỀU KIỆN DỪNG

**Phép CHUYỂN GỐC chưa được thi hành.** Đây **KHÔNG** phải một câu hỏi ngược lại chủ sở hữu — phán quyết
rõ, hướng di trú đã chọn ở §3, và không có điều kiện DỪNG nào nổ. Đây là một phát biểu về **dung lượng**:
phép sửa là mười sáu artefact đồng bộ cộng một phán quyết phụ chưa quyết (§4), và thi hành nó **một phần**
sẽ để lại một cây mà **cổng không chạy nổi** — hai dụng cụ ném ngay trong module initializer của cả năm
assembly test. Một nửa phép di trú đắt hơn không có phép di trú nào. **Cái nhiệm vụ này nợ lại, nêu tên
chứ không im lặng: bản sửa mã, nhân chứng đỏ được của nó, và cặp đối chứng của nó.** Cái đã trả: phép đo
điều-kiện-tiên-quyết (§1), khuôn dùng lại được cùng khuyết tật của nó (§2), ba hướng đã đo giá và một
hướng đã chọn kèm cái bẫy của nó (§3), và cái giá thật kèm một phán quyết phụ chưa ai nêu (§4). **Mục ở
lại Phần I.**

### 🔨 BF-1 (2026-08-23, base `7600d6a4`) — **THI HÀNH XONG.** Hai phán quyết của CHỦ SỞ HỮU ngày 2026-08-23 — **(a) chuyển gốc sang `%ProgramData%`** và **(b) miễn trừ bốn file cấu hình khỏi lượt xoá** — đều đã ship trong một commit chạy được. Mục rời **PHẦN I → PHẦN III**

🔨 **GHI CHÉP THI HÀNH, GHI NGÀY, VÀ GHI RÕ AI PHÁN. Cả hai phán quyết là của CHỦ SỞ HỮU, ngày
2026-08-23**, không của điều phối viên và không của nhiệm vụ này:

> 🔨 **2026-08-23 (a) — CHỦ SỞ HỮU: CHUYỂN GỐC MẶC ĐỊNH SANG `%ProgramData%`.** Chủ sở hữu **đã được
> nêu** rằng một bản cài ĐÃ TỒN TẠI sẽ thôi thấy dữ liệu ở gốc cũ, và **vẫn chọn hướng này**.
>
> 🔨 **2026-08-23 (b) — CHỦ SỞ HỮU: MIỄN TRỪ BỐN FILE CẤU HÌNH KHỎI LƯỢT XOÁ CỦA `remove-data.ps1`.**
> Lý do, đúng lời phán: **cấu hình do vận hành viên soạn KHÔNG phải dữ liệu vận hành — nó là thứ họ
> DỰNG LÊN**, và *"gỡ dữ liệu"* không nên làm họ mất nó. Phán quyết này được ra **vì BE-1 tìm ra một
> đường mất dữ liệu MỚI mà chủ sở hữu chưa được nói khi phán (a)**.

**Mọi dòng thân mục ở trên — của AO-1, của AV-1 và của BE-1 — sống NGUYÊN VĂN. Không một dòng nào bị
sửa hay xoá bởi nhiệm vụ này.**

#### 1. Gốc mới, và ba lá thay vì hai

`%ProgramData%\ST4I\sim\products` · `…\ecosystem` · `…\machine-config`. Ba biến dời chỗ, tên **suy
được** từ tên lá đúng quy tắc §15.9: `ST4I_PRODUCTS_DIR` (mới), `ST4I_ECOSYSTEM_DIR` (mới),
`ST4I_MACHINE_CONFIG_DIR` (**không đổi một ký tự** — nó vốn đã suy được từ `machine-config`, chỉ là
chưa có thư mục nào để suy TỪ). Quần thể toàn máy: **13 → 16 thư mục, 13 → 16 biến**; quần thể
cạnh-binary: **RỖNG**, và cái rỗng ấy **được GHIM ở đúng số không** bởi `PerHostDataRootsTests` chứ
không được để cho một khẳng định phổ quát tự thoả trên tập rỗng.

**Chỉ NỬA phân giải gốc của credential store được dùng lại** — `DefaultRoot`/`EnvVarDir`/`ResolveRoot`
(explicit > env > default) + `Directory.CreateDirectory`. **`SecurityDirAcl.Apply` KHÔNG được dùng**,
đúng như phát hiện của BE-1: nó sẽ khoá vận hành viên ra ngoài chính bốn file mà cổng gọi là
*"operator-editable"*, tức lật ngược giá trị chiều-thuận mà thân mục này nêu ở trên.

#### 2. Phép CHÉP MỘT LẦN — chạy khi nào, chép gì, và vì sao nó không bao giờ xoá

`St4i.EdgeCore.Config.LegacyRootMigration.CopyOnce`. **Chạy trong hàm dựng của mỗi store, và CHỈ khi
gốc đã phân giải BẰNG `DefaultRoot()`** — một phép so bằng trên giá trị sắp được ghi, chứ không phải
một cờ xuất xứ (một cờ xuất xứ là bản sao thứ hai của thứ tự ưu tiên trong `ResolveRoot` và có thể
trôi khỏi nó). Mọi gốc tường minh và mọi `ST4I_*_DIR` **bỏ qua** phép chép — **đó chính là cái đóng
cái bẫy BE-1 nêu**: nguồn di trú là `AppContext.BaseDirectory`, thứ không dời được, nên một phép chép
vô điều kiện sẽ hút cặn build của chính tiến trình test vào gốc đã chuyển hướng.

**Chép gì:** đúng những tên file mà store tự khai bằng hằng số của nó, và **chỉ khi gốc mới CHƯA có
tên ấy**. **Không xoá bản cũ, và điều đó được ghim bằng byte** — miễn trừ di-chuyển của mục 10 **chỉ
áp cho mục 10**, nên đây là phép **CHÉP**. Dùng `File.Copy/2` chứ không `File.Copy/3`: cổng điều tra
dân số gỡ-bỏ đọc **IL**, và IL mang **arity** chứ không mang giá trị đối số, nên `overwrite:false` nói
đúng với trình biên dịch mà **không** nói được với dụng cụ đo. Overload hai tham số nói cùng một điều
với cả ba người đọc.

🔴 **Giá của phép chuyển, viết CẢ HAI CHIỀU vì một sự thật viết một chiều là một nửa sự thật.**
*Thuận:* một bản cài mặc định không còn ghi vào `%ProgramFiles%` ở đường khởi động; `%ProgramData%`
ghi được với một service chạy LocalSystem, nên đúng cái hỏng mà tiêu đề mục này nêu **không còn nổ ở
ca mặc định**. *Nghịch, không mềm hoá:* **sau lần ghi đầu tiên vào gốc mới, hai bản PHÂN KỲ và không
có gì hợp nhất chúng.** Vận hành viên tiếp tục sửa file cũ cạnh binary sẽ **không thấy tác dụng và
không thấy lỗi**. Bản cũ ở lại đĩa **mãi mãi** — sản phẩm này không xoá byte của vận hành viên — nên
dọn nó là việc **thủ công**, và README §15.9 nói đúng câu ấy ở chỗ vận hành viên đọc. **Đường ghi log
của hướng (c) được giữ** (một dòng `stderr` cho mỗi file thật sự được chép), và nó **vẫn là kênh mà
BE-1 gọi là không ai đọc** — nó bổ sung cho phép chép, không thay được nó.

#### 3. Phán quyết (b): bài test bị đổi, và khẳng định đã công bố bị RÚT

**Tên bài:** `NotificationDocumentationTests.EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript`.

**Nó khẳng định gì:** *"lượt xoá khi ngừng sử dụng phải xoá MỌI thư mục engine tạo ra dưới
`%ProgramData%\ST4I\sim`"* — một khẳng định **phổ quát**, suy tập ra từ `src/` chứ không viết tay, và
thông điệp hỏng của nó **chỉ dẫn người thi hành thêm lá thiếu vào `$subdirs`**.

**Vì sao khẳng định ấy nay HẸP LẠI:** phán quyết (a) đưa ba lá mới vào tầm của chính khẳng định ấy, và
với hai trong ba lá thì việc **tuân theo** nó là một đường mất dữ liệu **mới mà không ai quyết** — bốn
file cấu hình do vận hành viên soạn sẽ bị một lệnh "gỡ dữ liệu" xoá mất. Chủ sở hữu được nêu và phán
(b). Nên khẳng định phổ quát ấy **bị RÚT tại chỗ, giữ nguyên văn**, và thay bằng một khẳng định **hẹp
hơn chứ không yếu hơn**: **mọi lá phải HOẶC bị xoá (`Name = '<lá>'`) HOẶC được GIỮ có nêu tên kèm lý
do (`Keep = '<lá>'`), không được cả hai và không được không cái nào**; và **tập được giữ bị GHIM đúng
bằng `{ecosystem, products}`**, không phải bị chặn trên. Bài test đổi tên theo đúng cái nó còn khẳng
định: `…_IsEitherPurged_OrKeptByNameWithAStatedReason`. **Việc cũ của khẳng định phổ quát — một lá mới
ra đời và bị bỏ sót lặng lẽ — KHÔNG mất một chút nào**: một lá không nằm trong danh sách nào vẫn đỏ,
với đúng thông điệp cũ.

🔴 **Vì sao GHIM chứ không CHẶN TRÊN:** danh sách GIỮ là danh sách duy nhất trong file ấy mà một người
đang bị dí thời gian có thể **nới ra để làm mất một vệt đỏ**. *"Nhiều nhất vài cái"* sẽ cấp phép cho
đúng việc đó. Thêm một store thứ mười bảy có mang thông tin đăng nhập vào danh sách GIỮ nay là một vệt
đỏ **tự nêu tên mình**.

🔴 **Và chiều ngược của phán quyết (b), ghi vào mục chứ không để vận hành viên tự gặp:** một cỗ máy
được chuyển đi, thanh lý hay trả lại **sau khi đã chạy lệnh xoá** vẫn **mang theo** định nghĩa sản
phẩm và công thức của nó, gồm mọi thứ vận hành viên đã gõ vào. Chúng **không** chứa thông tin đăng
nhập và **không** chứa lịch sử sản xuất — chính vì thế phán quyết mới khả thi — nhưng chúng không phải
là không có gì. Script **in đường dẫn của chúng** dưới tiêu đề `KEPT BY DESIGN` và `.DESCRIPTION` nói
thẳng điều đó; **cố ý không có cờ nào** làm script xoá chúng, vì một cái cờ chỉ cách việc dựng lại
đường mất dữ liệu đúng một phím.

**`machine-config` KHÔNG được miễn trừ, và sự bất đối xứng ấy được nêu chứ không để im:** nó giữ tham
số vận hành của máy và danh sách `History` chỉ-thêm của mọi lần điều chỉnh — một bản ghi về việc máy
**đã làm gì**, không phải thứ vận hành viên **dựng lên**. Bốn file được miễn trừ; file thứ **năm** thì
không. Phán quyết nói *"bốn file"*, và bốn là đúng bốn.

#### 4. 🔴 **MƯỜI SÁU artefact — ĐO LẠI, VÀ CON SỐ CỦA BE-1 KHÔNG SỐNG SÓT: đúng MƯỜI LĂM cái phải dịch, cái thứ mười sáu KHÔNG**

Liệt kê trước, đếm sau. Mười sáu artefact BE-1 nêu tên:
`ProductConfigStore.cs` · `SimulatedEcosystem.cs` · `MachineConfigStore.cs` ·
`tests/Shared/TestRunTempRoot.cs` · `tests/Shared/OwnOutputDirectoryGuard.cs` · `scripts/verify-suites.sh`
· `PerHostDataRootsTests.cs` · `MachineConfigStoreRootResolutionTests.cs` ·
`Alarms/NotificationDocumentationTests.cs` · `TestHarnessIsolationTests.cs` · `packaging/remove-data.ps1`
· `web/playwright.config.ts` · `web/scripts/reset-engine-state.mjs` · `README.md` ·
`docs/startup-failure-posture.md` · `OperatorDataRemovalCensusTests.cs`. **Đếm: mười sáu.**

🔴 **ĐO LẠI SAU KHI SỬA XONG, VÀ MỘT CÁI TRONG MƯỜI SÁU KHÔNG PHẢI DỊCH:
`tests/St4i.EngineApi.Tests/TestHarnessIsolationTests.cs`.** Không một ký tự **khẳng định** nào của nó
đổi. Đó là một tính chất chứ không phải may mắn, và đúng là tính chất mà chính file ấy được dựng để
mua: phép ghim của nó **suy tập `ST4I_*_DIR` ra từ `src/`** rồi đòi `web/playwright.config.ts` đặt từng
cái — nên khi hai biến mới ra đời nó **đỏ**, và khi `playwright.config.ts` được dịch nó **xanh lại**,
không cần ai chạm vào nó. Dụng cụ là `git diff --name-only`, và nó nói **MƯỜI LĂM**.

*(Cái file ấy vẫn có mặt trong commit, nhưng vì một lý do khác và nhỏ hơn: một đoạn **văn xuôi** trong
doc comment của nó viết *"`PerHostDataRootsTests` phân hoạch tập `ST4I_*_DIR` thành **THIRTEEN** thư mục
toàn máy … và các store cạnh-binary (`ST4I_MACHINE_CONFIG_DIR` hôm nay)"* — câu ấy nay sai, nên nó được
**rút tại chỗ**. Sửa một câu đã hỏng **không phải** là "phải dịch cùng nhau"; gộp hai thứ ấy vào một con
số là đúng cái nhầm mà chính mục này đang sửa.)*

🔴 **Và commit có HAI MƯƠI MỐT file, chứ không mười sáu — nói "mười sáu" rồi im về phần còn lại sẽ là
đúng loài chỗ lệch mà file này tồn tại để chấm dứt.** Ngoài mười lăm cái phải dịch, commit mang:
`src/St4i.EdgeCore/Config/LegacyRootMigration.cs` (mới — phép chép),
`tests/St4i.EdgeCore.Tests/LegacyRootMigrationTests.cs` (mới — nhân chứng (i) và (ii)),
`tests/St4i.EngineApi.Tests/OperatorConfigSurvivesDecommissioningTests.cs` (mới — nhân chứng (iii)),
`scripts/check-owner-decisions.sh` (dòng tóm tắt Phần I), `TestHarnessIsolationTests.cs` (chỉ văn xuôi,
ở trên), và **chính file này**.

**MƯỜI LĂM** là con số của **phép dịch bắt buộc**; **HAI MƯƠI MỐT** là con số của **commit**; **MƯỜI
SÁU** là con số của **một danh sách viết TRƯỚC khi bản sửa tồn tại**. Ba câu hỏi khác nhau, ba con số
khác nhau, cả ba nêu ra — và con số bị bác là con số của nhiệm vụ trước, đo trên chính sản phẩm của
nhiệm vụ này.
🔴 **Nhưng commit có HAI MƯƠI MỐT file, và nói "mười sáu" mà im về năm cái kia sẽ là đúng loài chỗ
lệch mà file này tồn tại để chấm dứt.** Năm cái BE-1 không thể biết vì chúng chỉ tồn tại khi có bản
sửa: `src/St4i.EdgeCore/Config/LegacyRootMigration.cs` (mới — phép chép),
`tests/St4i.EdgeCore.Tests/LegacyRootMigrationTests.cs` (mới — nhân chứng (i) và (ii)),
`tests/St4i.EngineApi.Tests/OperatorConfigSurvivesDecommissioningTests.cs` (mới — nhân chứng (iii)),
`scripts/check-owner-decisions.sh` (dòng tóm tắt Phần I), và **chính file này**. **Mười sáu là con số
của phép DỊCH; hai mươi mốt là con số của COMMIT.** Hai câu hỏi khác nhau, hai con số khác nhau, cả
hai nêu ra.

#### 5. Nhân chứng — ba thứ, và cặp đối chứng chạy trọn rồi hoàn nguyên

| # | nhân chứng | gác cái gì |
|---|---|---|
| (i) | `LegacyRootMigrationTests.WithNoEnvironmentOverride_AllThreeStoresResolveUnderProgramData_AtTheirDerivedLeaf` | gốc mới được dùng khi **không** có `ST4I_*_DIR`, ở đúng lá suy từ tên biến, và **không** phải gốc cạnh binary; cộng một arm ngược chứng minh biến môi trường vẫn **thắng** |
| (ii) | `LegacyRootMigrationTests.CopyOnce_CarriesTheLegacyBytes_LeavesTheOriginalIntact_AndDoesNotRunASecondTime` | chép đúng byte; **bản cũ còn nguyên byte VÀ nguyên dấu thời gian**; lượt thứ hai báo chép **không gì** và **không đè** lên bản sửa ở đích |
| (iii) | `OperatorConfigSurvivesDecommissioningTests.TheDecommissioningWipe_DeletesHistorianCredsAndTheAuditLog_AndKEEPSTheFourConfigFiles` | **CHẠY THẬT** `remove-data.ps1`: `historian`/`creds`/`security` **biến mất**, bốn file cấu hình **còn nguyên byte** |

**Vì sao (iii) chạy script thay vì đọc nó:** một mảng `$keptByDesign` mà vòng lặp xoá tình cờ duyệt
qua sẽ **thoả mọi phép kiểm văn bản** trong khi vẫn xoá đúng những file phán quyết bảo vệ. Hai dụng cụ
bổ sung cho nhau, không cái nào thay cái nào.

**Cặp đối chứng — CHẠY TRỌN, ĐÃ HOÀN NGUYÊN**, ghi trong báo cáo BF-1.

#### 6. Hằng số, và cái KHÔNG dịch

`EXPECT_EDGECORE` **1204 → 1206**, `EXPECT_ENGINEAPI` **1408 → 1409**, tổng **2849 → 2852** (+3 nhân
chứng). `EXPECT_NEW_DOC_ABSOLUTES` **232 → 290**, và **cả 58 câu mới đều nằm trong file nhiệm vụ này
sửa** — 55 + 3, phép cộng khớp đúng, và mọi file không bị chạm thì **không thể** dịch vì chúng giống
BASE từng byte. **`EXPECT_WARNINGS` ĐO LẠI trên một `-t:Rebuild` đầy đủ và GIỮ 219**; sổ cảnh báo
**14 hàng, 185/34, không dịch một đơn vị**; **0 lệnh đè** — không `NoWarn`, không `#pragma`, không
`SuppressMessage`, không `.editorconfig`. `EXPECT_BUILD_NODES` **0**. Baseline `cfcfae42` **không dời**.

#### 7. Khuyết tật nhìn thấy và DỪNG lại

Mười một khuyết tật đợt 12 (nặng nhất: mô-men xoắn SCREWDRIVE lệch ~9 lần giữa hai host), năm khuyết
tật BD-1, hai khuyết tật BE-1 — **không đụng**. 🔴 **Và khuyết tật thứ tư của BE-1 vẫn MỞ, còn nhiệm vụ
này làm nó LỚN HƠN — nói thẳng ra:** không dụng cụ nào gác `%ProgramData%\ST4I\sim\` ngoài `creds`.
Trước hôm nay đó là mười ba lá không ai canh; nay là **mười sáu**, và ba lá mới là đúng ba lá mà một
seam hỏng sẽ làm suite ghi vào. Cái chặn hôm nay là `TestRunTempRoot` cộng ba phép ghim
(`TestHarnessIsolationTests`, `OwnOutputDirectoryGuard`, bracket của cổng) — **không** phải một watcher
trên `%ProgramData%`. Nêu ra, **không sửa**: nó cần một mục riêng.

---

# PHẦN IV — PHỤ LỤC: KHÔNG PHẢI QUYẾT ĐỊNH CỦA ANH, VÀ LỊCH SỬ CỦA CHÍNH FILE NÀY

Không gì trong phần này đang chờ anh quyết. Nó ở đây vì **xoá thì không được** — và nó
ở CUỐI vì đặt nó trước các mục đang chờ là đúng khuyết tật Y-1 được giao để sửa.

---

## Tồn dư của AA-1 (2026-08-18, vòng phản biện 1) — GHI, KHÔNG SỬA

Năm mục dưới đây là **Minor** trong phản biện của AA-1. Chúng **không** đang chờ chủ sở hữu và
**không** ai được đọc chúng như một phán quyết đang treo. Chúng ở đây thay vì chỉ ở trong một báo
cáo vì đúng lý do file này tồn tại: *một điều "đã được nêu trong một báo cáo" là điều chủ sở hữu
**không có đường nào mở ra đọc**.* Vòng ấy **cố ý không sửa** cái nào.

1. **Hai "sàn" của nhân chứng đếm SERIES, không đếm HÀNG.** Một cây mà cả hai bộ sinh phát series
   **rỗng** sẽ qua cả hai sàn và soi **0** hàng. Hôm nay không với tới được (`WaveformPoints` là
   `const` ở cả hai bộ sinh), nên đây là lỗi **câu chữ**, không phải lỗ hổng chạy được — và mô tả
   trong nhân chứng lẫn cạnh `EXPECT_EDGECORE` **đã được sửa cho đúng**. Cách chữa thật: một sàn thứ
   ba đếm **hàng đã soi**. Chưa làm.
2. **Một trong bốn `[Fact]` là một test của MÃ TEST.** `TheRowShapeCheck_GoesRedOnEveryDeviation…`
   chỉ lái một hàm `private` trong chính file ấy; **không thay đổi nào của sản phẩm** làm nó đỏ. Hợp
   lệ như bờ 1 của §8.1(h6), và nay **được nói thẳng ngay cạnh hằng số**: chỉ **ba** trong `+4` là
   khẳng định về sản phẩm.
3. **Lập luận "đếm hai lần" cho `GetOeeAsync` đúng, nhưng tiền đề sai.** *"Mỗi cái trong ba có đúng
   một chỗ của riêng nó"* — không đúng: `GetOeeAsync` và `GetOeeFleetAsync` là **hai route trả về
   MỘT hình dạng**, nên ánh xạ là **2 bề mặt → 3 chỗ đặt văn**. `GetOeeAsync` hôm nay **không có doc
   comment nào**, chỉ một banner `//`; một dòng `<see cref="OeeResultDto"/>` đóng được và không mâu
   thuẫn với lập luận chống-đếm-hai-lần. Chưa làm.
4. **Một bề mặt thứ tư mà đoạn mới trên `Verdict` không nêu: `MachineState.PassRate`.** Nó áp **đúng
   cùng một luật** (`!= Skip` vào mẫu, `Pass or Warn` vào tử) và nổi lên qua `FleetProjections` tới
   `web/.../ReadoutGrid.tsx` và `src/St4iMachineSimulator/Views/DashboardView.xaml`. Phép liệt kê
   thiếu này **thừa hưởng** từ câu có sẵn của enum, không do AA-1 tạo ra; phản biện **xác nhận** câu
   mới trên `OeeResultDto` viện dẫn nó là **đúng**.
5. **Phép quét §8.1(h5.4) chưa đủ.** Còn thiếu, có tên: `Normalizer.ComputeOverallResult` (`_`→`"OK"`)
   và `Normalizer.VerdictToResult` (`_`→`"skip"`) — **hai mặc định của cùng một file bất đồng nhau**
   về một verdict lạ; `MachineState.StatusText` và `MachineViewModel.StatusText` (cả hai `_ => "OK"`);
   `Doc28Writer.MapVerdict` (`Warn`→`"NTF"`) với `Doc28Parser.MapVerdict` (`"NTF"`→`Verdict.Skip`),
   tức trên vòng doc28 kín **`Warn` suy biến thành `Skip`**; và `UnsPublisher`. **Không cái nào mâu
   thuẫn với định nghĩa vừa công bố** — phản biện kiểm chỗ nguy nhất và `Doc28Parser` đặt
   `Kind = Inspection`, mà OEE lọc `ProcessResult`, nên đường ấy **không** chảy vào OEE.

### Tồn dư thêm từ vòng phản biện của vòng sửa (2026-08-18) — GHI, KHÔNG SỬA

Vòng ấy phán 🟢 **gộp được** và nêu bốn việc rẻ, **cả bốn đã làm** (ba cụm chữ nghiêng ở mục 14,
con số *"SÁU"* ở khối 📎, ngày cho khối rút trong `verify-suites.sh`, và bốn tên `[Fact]` cũ). Ba
điều còn lại **cố ý không sửa** ở vòng này, vì nó bị giới hạn ở văn xuôi và không được đụng `src/`
hay nhân chứng:

6. 🔴 **Kiểu bảo tồn áp CÓ CHỌN LỌC trên `WaveformSeries`, và tôi cho rằng phản biện ĐÚNG.** Các câu
   nay **sai** thì được giữ nguyên văn; nhưng một câu nay **bị thay khung** đã bị xoá không dấu vết:
   *"What it buys a consumer, and it is the point of writing it down: from `RateHz` alone, before
   reading a single row, a consumer knows whether it must RECONSTRUCT the X axis from the row index
   or READ it out of element 0 … Neither was decidable from this type before."* Câu ấy **cũng sai**
   dưới quy ước B (ở đó người tiêu thụ **luôn** đọc phần tử 0), nên theo đúng luật tôi tự đặt nó
   **phải được rút nguyên văn, không phải xoá**. Nó được xuất bản ở `84836ad6`. **Không sửa được ở
   vòng này** (cấm đụng `src/`); nêu tên ở đây để nó không biến mất khỏi hồ sơ.
7. **Hai câu tiếng Việt trong file này được chữa KỀ BÊN chứ không trích tại chỗ** — §4 (*"không một
   chỗ nào trong `src/` hay `tests/` đánh chỉ số vào một PHẦN TỬ của hàng"*) và §2 (định nghĩa nêu
   một bộ lọc). Cả hai đính chính nằm **cùng mục, cùng blockquote**, nên người đọc tuần tự vẫn gặp;
   nhưng chúng **không kín bằng** ba chỗ kia, nơi câu cũ đứng trong ngoặc kép ngay tại chỗ.
8. **Tên `TheRowShapeCheck_GoesRedOnARealProducersOwnSeries_WhenOnlyTheRateHzFieldMoves` lệch nhẹ
   với thân của nó** — ca cuối **nối dài một hàng**, tức không phải *"chỉ trường `RateHz` dịch"*.
   Lệch **thừa hưởng** từ tên cũ (`…WhenOnlyTheDiscriminatorMoves`), không do vòng nào của AA-1 tạo.

---

## Tồn dư của AJ-1 (2026-08-19, vòng phản biện) — GHI, KHÔNG SỬA

Vòng phản biện của AJ-1 phán 🔨 **NHẬN — merge được, KHÔNG có Critical**, và nêu **bốn Minor**. Cả bốn
được **ghi ở đây và cố ý KHÔNG sửa**: vòng ấy bị giới hạn ở văn xuôi, và ba trong bốn cái **có sẵn từ
trước AJ-1** — sửa chúng trong một nhiệm vụ thi hành hai phán quyết là nới phạm vi mà không ai phán.

9. 🔴 **`web/src/lib/api.ts` liệt kê CHỈ `400` cho `PUT /v1/historian/oee/settings`, và đây là một bề
   mặt ĐỌC mà AJ-1 nói đã quét trong khi KHÔNG quét.** Chỗ thiếu: doc comment của
   `OeeSettingsUpdateInput` (*"a 400 with `{ error }`, surfaced via `OeeSettingsApiError`"*) và của
   `useSetOeeSettings` (*"A rejected (400) call throws `OeeSettingsApiError`"*) — **không nhắc `409`**.
   🔴 **Hành vi thì ĐÚNG và tôi kiểm chứ không nhận:** `putOeeSettings` bắt **mọi** `!res.ok`, đọc
   `body.error`, ném `OeeSettingsApiError(res.status, serverMessage)` — nên thông điệp của store **tới
   UI nguyên văn**, kể cả 409. Cái sai là **phép liệt kê trong tài liệu**, có sẵn từ Z-1 (mục 11 đã
   tạo ra 409 đầu tiên), **không do AJ-1 tạo ra** — nhưng AJ-1 làm 409 **thường xuyên hơn hẳn**, nên
   nó **cũ đi vì AJ-1**. 🔴 **Và điều đáng ghi nhất không phải cái thiếu mà là CÁCH NÓ THOÁT:** brief
   liệt kê ba bề mặt đọc (`HistorianEndpoints`, census gỡ-bỏ, `startup-failure-posture.md`), báo cáo
   **chép lại đúng ba cái ấy**, và `web/` **không nằm trên đĩa** (sparse checkout) nên không một phép
   quét cục bộ nào chạm tới nó. **Một danh sách bề mặt thừa hưởng từ brief đã được dùng như một phép
   quét đã thực hiện.**
10. **Không có nhân chứng ĐẦU–CUỐI cho `409` của kiểu mới.** `HistorianEndpointsOeeTests` có ba bài
    409 nhưng không bài nào cho `OeeSettingsFileChangedException`. Nó **theo sau bằng KIỂU**:
    `catch (OeeSettingsWriteRefusedException)` bắt lớp cơ sở, và cả **ba** chỗ `throw new OeeSettings…`
    nằm trong `Set`, **trước** `_settings[machineCode] = updated`. Nên *"không gì được ghi"* là một
    **tính chất**, không phải một trùng hợp — nhưng nó là **suy ra**, không phải **quan sát**.
11. **Thông điệp của arm mới nói *"another process writing the same historian directory"*, còn ca các
    bài kiểm chạy nhiều nhất là hai THỰC THỂ store trong CÙNG tiến trình.** Hành vi đúng cho cả hai;
    câu chữ hẹp hơn tập. Rất nhỏ.
12. **Bất biến *"bảng là bản sao trung thành của file"* có một cửa sổ nó sai, và cửa sổ ấy CÓ SẴN từ
    trước.** Nếu `Save()` ném (đĩa đầy, ACL ở `File.Move`), `_settings` **đã bị mutate** còn file thì
    chưa đổi và `_tableBuiltFromText` giữ văn bản **cũ** ⇒ lần `Set` sau so **cũ với cũ** ⇒ **bằng** ⇒
    ghi bảng đã mutate. Kết cục ấy **đúng như mong muốn** (thử ghi lại), nên đây là ghi chú tài liệu
    chứ không phải khuyết tật. Cùng cửa sổ: một file `.tmp-<guid>` mồ côi có thể ở lại — **có sẵn từ
    trước AJ-1**.

---

## Tồn dư của AK-1 (2026-08-19, thi hành mục 14 + vòng phản biện) — GHI, KHÔNG SỬA

**Vì sao nó nằm ở ĐÂY chứ ở báo cáo nhiệm vụ:** nội dung dưới đây là một bài học về **PHƯƠNG PHÁP ĐO**,
không phải về mục 14. Nó được viết vào file này vì `.superpowers/sdd/` **bị gitignore** — `git ls-tree`
không thấy nó — nên **một bài học chỉ sống trong đó là một bài học không ai đọc**. Đó đúng là luật mà
§"Biên của chuỗi giám hộ" của mục 14 mua được, áp cho chính nhiệm vụ vừa viết ra nó.

### 13. 🔴 Một dụng cụ đếm bị bắt lỗi ở MỘT đầu ra, sửa MỘT nửa, và nửa kia đi tiếp vào hồ sơ

**Cơ chế, nói trước vì nó tầm thường:** AK-1 chứng minh *"`owner-decisions.md` không mất một dòng prose
nào"* bằng một phép so đa tập dòng — tách hai phía của diff rồi `comm`. Phép tách dùng `grep '^-'` và
`grep '^+'`. Một unified diff mở đầu bằng **hai dòng tiêu đề** `--- a/…` và `+++ b/…`, nên `grep '^-'`
nuốt dòng thứ nhất và `grep '^+'` nuốt dòng thứ hai ⇒ **cộng dư ĐÚNG 1 vào CẢ HAI phía**.

🔴 **Cách nó sống sót, và đây là vế phải viết to nhất vì nó KHÔNG tự lộ ra.** Người viết **ĐÃ BẮT ĐƯỢC**
khuyết tật ấy — ở phía *"dòng biến mất"*. Con số ra **5**, không khớp phép đếm tay **4**, họ đi điều
tra, tìm ra dòng tiêu đề, và **nói đúng rằng thật ra là 4**. Rồi họ **im lặng mang nguyên +1 ấy sang
phía kia**: phía *"dòng thật sự mới"* ra **151**, và **151 được viết vào hồ sơ** mà không ai hỏi lại.
Con số đúng là **150**.

**Cùng MỘT khuyết tật. Bắt được MỘT nửa. Nửa không bắt được thì ĐI TIẾP.**

**Vì sao nó tinh vi hơn một con số sai:** một phép đo sai hoàn toàn lộ ra khi đối chiếu. Một phép đo mà
người dùng **đã tìm ra lỗi của nó ở một chỗ** lại **được tin hơn** ở mọi chỗ khác — **chính hành động
sửa một nửa đã tạo ra sự tin cậy che nửa còn lại**. Đây là loài *"miền của dụng cụ hẹp hơn miền của câu
nói dùng nó"* ở dạng khó thấy nhất: **miền đã được thu hẹp một lần, và người thu hẹp tưởng mình đã thu
hẹp xong.**

**Luật rút ra, viết cho người sau:** khi một dụng cụ bị bắt lỗi ở **MỘT** đầu ra, phải **đo lại MỌI đầu
ra của nó** — không phải chỉ đầu ra vừa bị bắt. Và cách chữa là **sửa DỤNG CỤ, không sửa CON SỐ**: ở
đây là bỏ `grep` và dùng `awk 'NR>4'` để cắt tiêu đề. 🔴 **Khẳng định chịu lực KHÔNG đổi** qua cả bốn
commit của AK-1 — xoá 3065, **thật sự đổi ĐÚNG 4**, thuần dịch chỗ 3061 — nên đây là khuyết tật của
**dụng cụ và của cách đọc nó**, không phải của kết luận.

**Nêu ra vì nó KHÔNG được ai bắt hộ:** vòng phản biện dùng `awk 'NR>4'` ngay từ đầu nên **không bao giờ
gặp** khuyết tật này (họ tự nêu một bẫy khác: `grep -v '^---'` sẽ nuốt mọi dòng nội dung là `---`, tức
mọi thanh ngang markdown). Người thực thi tìm ra nó **sau khi phản biện đã xong**, lúc đo lại theo I-1.
**Lần sau nó có thể không lộ ra.**

### 14. Cùng họ, cùng phiên: hai lần tuyên bố một thứ CÒN ĐANG CHUYỂN ĐỘNG là đã dừng

Trong lúc chờ cổng, AK-1 **hai lần** viết ra rằng một lần chạy đã xong trong khi nó **đang chạy** —
lần đầu *"Gate 3 has completed"*, lần sau *"the waiter has fired"* — cả hai lần **suy từ việc một thông
báo nền vừa tới**, không từ một phép đo.

🔴 **Và cả hai lần tự bác được, bằng phép đo, ngay tại chỗ:** `pid` của cổng **còn sống**
(`Get-CimInstance Win32_Process`), CPU của `testhost` **còn tăng** giữa hai mẫu, và file log **chưa có
dòng verdict**. **Chi tiết "tự bác" được giữ lại có chủ ý**: nó là phần chứng minh rằng luật *"một phát
biểu về thứ CÒN ĐANG CHUYỂN ĐỘNG chưa phải một phép đo"* **dùng được**, không chỉ **nói được** — và
rằng cái chặn được nó là **đo pid + CPU**, một thao tác rẻ, chứ không phải sự cẩn thận.

**Chỗ đau:** điều ấy xảy ra **trong chính nhiệm vụ chép câu luật ấy ra**, và chép nó ra **nhiều lần**.

### 15. 🔴 Và một tồn dư KHÔNG phải của người thực thi — một chỉ thị TỰ MÂU THUẪN do ĐIỀU PHỐI VIÊN ra

**Ghi vào đây vì một tồn dư chỉ kể lỗi của người thực thi thì lại là một vế thuận, đúng loài mục này
tồn tại để chấm dứt.**

Ngày **2026-08-19**, điều phối viên chỉ thị AK-1 ghi bài học ở §13 *"vào **báo cáo**, ở **chỗ người sau
đọc được**"*. **Hai vế ấy loại trừ nhau trong repo này:** `.superpowers/sdd/` **không nằm trong cây
Git**, nên báo cáo nhiệm vụ **chính là chỗ người sau KHÔNG đọc được**. Và đó **đúng là tiền đề** mà
cùng nhiệm vụ ấy dùng để đặt khối P-2 của mục 14 vào file này **thay vì** vào báo cáo.

**Người thực thi bắt được, nêu lên thay vì im lặng tuân, và KHÔNG tự thêm mục** — họ hỏi rồi chờ trả
lời. **Điều phối viên nhận**, và mục này là kết quả. **Hình dạng đáng để lại:** chỉ thị ấy không sai về
nội dung, nó sai vì **hai nửa của nó được viết ở hai mức trừu tượng khác nhau** (*"báo cáo"* là một
chỗ, *"chỗ người sau đọc được"* là một tính chất) và **không ai kiểm tính chất ấy trên chỗ ấy**. Đúng
loài mà đoạn mở đầu file này mô tả: *"một lời cải chính cất ở đó không bao giờ vào repo và chủ sở hữu
không có đường dẫn nào để mở"* — lần này nó suýt xảy ra với **bài học về cách đo**, tức với **dụng cụ**,
chứ không với một khẳng định.

---

## Quần thể khuyết tật ĐÃ DỪNG LẠI, liệt kê đầy đủ — BG-1 (2026-08-23)

🔴 **Bảng này là NGUỒN của mười hai mục 41–52, và nó tồn tại vì một con số vô hướng tóm tắt một tập
chưa ai liệt kê thì không phải một sự thật.** Lời giao việc nói *"mười tám"*; khối 📌 của BF-1 ở
Phần I nói *"mười một + năm + hai + một"* = **mười chín**. Liệt kê từ nguồn cấp một — bốn
`task-1-report.md` **cộng** thông điệp merge của AV-1 → BF-1 đọc bằng `git log` — trả về **ba mươi
ba** mục ứng viên. Đếm **sau khi** liệt kê, và đếm **từ chính bảng dưới đây** chứ không từ trí nhớ:
**33 ứng viên = 8 (C) + 18 (N) + 7 (K)** ⇒ **26 còn mở**, gom thành **12 mục**.

> 🔴 **CÂU NGAY TRÊN — SỬA TẠI CHỖ 2026-08-23 (BG-1, vòng đo lại sản phẩm của chính mình), câu sai
> giữ NGUYÊN VĂN.** Nó đọc: *“Đếm **sau khi** liệt kê: **33 ứng viên → 4 không tái lập được → 4 đã
> được trả hoặc đã được phán → 25 còn mở, gom thành 12 mục**.”* **Ba trong bốn con số ấy sai.** Nhóm
> (K) là **bảy** hàng, không phải 4+4=8: **năm** đã được trả hoặc đã được phán (ca a–e) và **hai**
> không tái lập được hoặc không phải tính chất của cây (ca f, g). Nên số còn mở là **26**, không phải
> 25. 🔴 **Chỗ đáng nói không phải phép trừ — mà là con số 25 được viết TRƯỚC KHI bảng bên dưới được
> đếm**, tức đúng cái mà chính đoạn này lập ra để chấm dứt: *một số vô hướng tóm tắt một tập chưa ai
> liệt kê thì không phải một sự thật*. Bắt được bằng cách đếm lại bảng bằng `grep -c` sau khi viết,
> **không** bằng cách đọc lại ý định. Số mục (**12**) và số ứng viên (**33**) thì đúng nguyên.

Cột **triage**: **(N)** nằm trong uỷ quyền của điều phối viên · **(C)** cần chủ sở hữu · **(K)**
không phải khuyết tật, vì phép đo lại bác nó.

| # | khuyết tật | nguồn cấp một | triage | đi đâu |
|---|---|---|---|---|
| 1 | mô-men SCREWDRIVE lệch ~9 lần giữa các host | BC-1 §7.5 | **C** | mục **41** |
| 2 | `weld_profile`/`dispense_program` không ai đọc + trùng tên metric | BC-1 §7.2 | **C** | mục **42** |
| 3 | `AssemblySim` chỉ đạt `Warn`, tính là TỐT cho OEE | BC-1 §7.9 | **C** | mục **43** |
| 4 | `LeakTestSim` cảnh báo vì rò quá ÍT | BC-1 §7.6 | **C** | mục **43** |
| 5 | hai tham số ctor công khai không ai cấp; `maxLeakRatePa` không kiểm miền | BC-1 §7.8 | **C** | mục **44** |
| 6 | `SimulatedEcosystem.Load` ghi lại cả hai file | AV-1 merge · BE-1 §8.3 · BF-1 §8.3 | **C** | mục **45** |
| 7 | `-SkipDotnetPublish` để dữ liệu vận hành viên vào MSI | AV-1 merge | **C** | mục **46** |
| 8 | hai nhà máy connector Modbus đụng khoá đăng ký | BC-1 §7.10 | **C** | mục **47** |
| 9 | `HotFolderAoiDriver` làm I/O trong constructor | BB-1 merge | **N** | mục **48** |
| 10 | `MqttDriver.DisposeAsync` không có trần | BB-1 merge | **N** | mục **48** |
| 11 | `MqttDriver` không liệt kê lại được sau dispose | BB-1 merge | **N** | mục **48** |
| 12 | `HotFolderAoiDriver` nhận miễn trừ `Health` không khai | BB-1 merge | **N** | mục **48** |
| 13 | `InProcessBroker.DisposeAsync` không có trần và mù | BC-1 §7.11 | **N** | mục **48** |
| 14 | hai vựng từ machine-type không khớp (`AOI_AVI`, `IOT_GATEWAY`) | BC-1 §7.3 | **N** | mục **49** |
| 15 | loại máy lạ thành máy bắt vít **và ghi** bản ghi cấu hình | BC-1 §7.4 | **N** | mục **49** |
| 16 | `"ReadTimeoutMs"`/`"Retries"` viết hoa bị vứt im lặng | BD-1 §7.1 | **N** | mục **50** |
| 17 | `EffectiveReadTimeoutMs` tràn `int` qua object initializer | BD-1 §7.2 | **N** | mục **50** |
| 18 | hai bề mặt gọi `OpcUaNodeMap.FromJson` không sink | BD-1 §7.3 | **N** | mục **50** |
| 19 | `scan-doc-negations.sh --files` không thu hẹp corpus BASE | BD-1 §7.4 | **N** | mục **51** |
| 20 | `C2` phân biệt hoa thường; hàng mục 12 còn `Ở LẠI PHẦN II` | BD-1 §7.5 | **N** | mục **51** |
| 21 | `repo-scan.sh` không kiểm hoa thường của pathspec | BD-1 §7.6 | **N** | mục **51** |
| 22 | `remove-data.ps1` in danh sách GIỮ vô điều kiện | BF-1 §8.6 | **N** | mục **51** |
| 23 | không dụng cụ nào gác `%ProgramData%\ST4I\sim\` ngoài `creds` | BE-1 §8.4 · BF-1 §8.4 | **N** | mục **51** |
| 24 | `IDeviceDriver.Id`'s lời khai slot-label bị bác, để nguyên | BB-1 merge | **N** | mục **52** |
| 25 | `"23 sites across 20 files"` không tái lập được | BE-1 §8.5 · BF-1 §8.5 | **N** | mục **52** |
| 26 | `Doc28Parser`: 6/34 chỗ ném không nêu file, thông điệp không ai đọc | BC-1 §7.7 | **N** | mục **52** |
| 27 | `ModbusDriverFactory` khai `Program.cs` đăng ký `Create` | BC-1 §7.1 | **K** | §dưới, ca (a) |
| 28 | `.pdb` mang URL repo và SHA đi vào MSI | AV-1 merge | **K** | §dưới, ca (b) |
| 29 | hàng phán quyết mục 25 lỗi thời hai đợt | BB-1 merge | **K** | §dưới, ca (c) |
| 30 | README §7 hàng preset hứa ack *"failed"*, không nhân chứng | AX-1 merge | **K** | §dưới, ca (d) |
| 31 | ba guard mới của `scan-doc-negations.sh` chưa có cặp đối chứng | BA-1 merge | **K** | §dưới, ca (e) |
| 32 | `POST /v1/scenario/burst` dựng lại outage từ cờ lỗi thời | AV-1 merge | **K** | §dưới, ca (f) |
| 33 | node build ngoại lai của C# Dev Kit làm cổng đỏ | BE-1 §9.5 · BF-1 §9.3 | **K** | §dưới, ca (g) |

🔴 **Bản sao WPF của độ lệch mục 33** (AV-1 merge) **KHÔNG có hàng riêng ở đây, và đó là một lựa
chọn phải nói ra**: cái AV-1 ghi là *"không project test nào trong cây này với tới được
`St4iMachineSimulator`, nên không nhân chứng đỏ-được nào là khả dĩ"* — một **lời khai về khả năng
kiểm**, không phải một khuyết tật đo được. Nó được nêu ở đây thay vì bị bỏ im lặng.

---

## Bảy ca ĐO LẠI BÁC BỎ hoặc ĐÃ ĐƯỢC TRẢ — BG-1 (2026-08-23), GHI, KHÔNG MỞ MỤC

**(a) `ModbusDriverFactory`'s lời khai về `Program.cs` — ĐÃ ĐƯỢC TRẢ.** BC-1 §7.1 ghi nó là một
khuyết tật *và đã rút nó tại nguồn trong cùng đợt*. Đo lại ở `9255ea98`: khối rút **có mặt**, giữ
nguyên văn câu cũ, và đoạn thay thế nêu phép đo mới. **Không còn gì để phán.**

**(b) `.pdb` mang URL repo và SHA — ĐÃ ĐƯỢC PHÁN.** Đây chính là nội dung mục **31**, đã được quyết
*ship-unchanged* ngày 2026-08-22 (AV-1) và nằm ở Phần III với cả hai chiều ghi trong thân mục. Mở
lại thành mục mới sẽ là **hỏi lại một câu đã trả lời**.

**(c) Hàng phán quyết mục 25 lỗi thời — ĐÃ ĐƯỢC TRẢ** bởi BB-1 cùng đợt, giữ nguyên văn bản cũ.

**(d) README §7 hàng preset — ĐÃ ĐƯỢC TRẢ, và phần còn lại KHÔNG phải khuyết tật.** Đo lại ở
`9255ea98`: hàng ấy nay mang một khối đính chính **nguyên văn và có ngày** (*"Corrected 2026-08-22
(owner-decisions.md item 34)"*), nêu rõ cả hai nửa cũ đều sai và tại sao. Cái AX-1 mang sang là
*"nó KHÔNG có nhân chứng và có thể trôi lại ngày mai"* — đó là một **khoảng trống nhân chứng**, không
phải một câu sai. Ghi ở đây; không mở mục.

**(e) Ba guard của `scan-doc-negations.sh` — ĐÃ ĐƯỢC TRẢ.** BA-1 mang sang mối lo *"chưa có cặp đối
chứng đầy đủ"*; **BB-1 chạy cả ba** trên một bản sao byte-identical trong fixture tạm và ghi kết quả
từng cái. Mối lo đã hết hiệu lực trước khi tới đây.

**(f) `POST /v1/scenario/burst` dựng lại outage từ cờ lỗi thời — KHÔNG TÁI LẬP ĐƯỢC như một khuyết
tật chưa ghim.** AV-1 tự viết *"pinned by a test"* trong cùng câu nó gọi đây là khuyết tật. Đo lại:
`ScenarioEndpoints`'s route `burst` chỉ gọi `FleetHost.Burst()` → `FleetCore.Burst()`, và
`FleetCore.Burst` **không đụng `NetworkOutage`** — nó chỉ nâng/hoàn nguyên `CycleRateMultiplier`
quanh `_burstBaseline` dưới `_gate`. 🔴 **Chỗ tôi có thể sai, và tôi nói ra:** cái AV-1 mô tả có thể
là hành vi của `ApplyScenario` **sau** một `Burst`, chứ không phải của chính route ấy; tôi **không**
mở hết đường ấy, nên đây là *"không tái lập được từ mô tả đã cho"*, **không** phải *"không tồn
tại"* — và một câu phủ định tồn tại chỉ đúng nếu đã mở hết tập.

**(g) Node build ngoại lai của C# Dev Kit — MỘT ĐIỀU KIỆN MÔI TRƯỜNG, không phải một tính chất của
cây.** BE-1 và BF-1 đều đo và đều kết luận thế, và BF-1 làm nó sắc hơn: các node ấy sinh ra **TRONG
LÚC** cổng rebuild, do Dev Kit phản ứng với `obj/`+`bin/` mà cổng vừa ghi, nên **lần chạy cổng đầu
sau mỗi lần đổi mã gần như chắc chắn đỏ và lần thứ hai thì không**. Không mở mục: `EXPECT_BUILD_NODES=0`
đang làm đúng việc của nó, và cái phải đổi là **thói quen của người chạy cổng**, không phải cây.

---

## 🔴 LUẬT "KHÔNG CÓ GÌ ĐỂ NÓI" — RÚT 2026-08-23 (BG-1), sau chín đợt và 109 thành viên

**Luật, nguyên văn như nó đã dẫn đường:** *"một `<summary>` chỉ diễn đạt lại cái TÊN không phải một
lần trả; không có gì để nói ngoài cái tên ⇒ một phát hiện về thiết kế"*.

**Nó được RÚT.** Không phải vì nó sai — mà vì, đo được, **nó không đỏ được**: suốt **109 thành
viên** trên **sáu đợt liên tiếp** nó chưa bao giờ trả về **một** ca dương (`23/2/0`, `14/1/0`,
`25/0/0`, `30/2/0`, và hai lần trước đó). Đợt 12 kết luận *"a check that cannot go red is not a
check"*, và đó **đúng loài mục 32 và mục 40** — lần này áp lên một **LUẬT** thay vì một dụng cụ.

### Phép đo đã làm TRƯỚC khi chọn, và nó là cái quyết định hướng

Đợt 12 nêu tên **hai ứng viên gần nhất**, cả hai Lớp 2. **Cả hai được mở ra ở `9255ea98`:**

* **`AssemblySim`'s constructor** — doc của nó nêu tên **`SimulatorBase`, `MachineConfigStore`,
  `configKind`, `ResolveEffectiveConfig`, `CycleSecondsOverride`, `MachineDescriptor.CycleSeconds`,
  `WelderSim`, `DispensingSim`, `MachineParameterSchema`**, cộng ba loại máy — **mười referent ngoài
  chữ ký**, và một mệnh đề phân biệt ca này với hai ca khác.
* **`OpcUaConnectorFactory.Kind`** — nêu tên **`DriverKinds.OpcUa`, `ModbusConnectorFactory.Kind`,
  `OpcUaDriver`, `DriverKinds.Normalize`, `ConnectorRegistry.Register`** và **hai bài test** —
  **bảy referent ngoài chữ ký**.

Nên **ngay cả hai thành viên gần "không có gì để nói" nhất cũng vượt xa mọi ngưỡng hợp lý**, với
biên **bảy**. Đó là bằng chứng đợt 12 đoán trước là sẽ có, và nó xuất hiện.

### Ngưỡng duy nhất ĐỎ ĐƯỢC trên cây này lại là một cái bẫy 7

Để không rút một luật chỉ vì hai mẫu, tôi định nghĩa một ngưỡng **quyết định được** — *"số referent
ngoài chữ ký = 0"* — và **đo nó trên toàn `src/`**: **2 546 khối doc**, trong đó **295 khối đạt
0**. Nên ngưỡng ấy **đỏ được**. Nhưng đọc 295 ca ấy cho thấy chúng gồm: (i) `<inheritdoc/>` thuần
tuý, (ii) thành viên enum như `Verdict.Pass` — *"The cycle was judged and met its specification"*,
một câu **nói đúng cái mà chỉ có mã mới biết**, và (iii) property tầm thường như
`ProductConfigStore.ListProducts` — *"All products, ordered by code. Deep clones — safe for a caller
to mutate freely"*, nêu **thứ tự** và **sao chép sâu**, hai điều **không đoán được từ tên**.

🔴 **Nên một luật phát biểu lại quanh ngưỡng ấy sẽ đỏ trên ~11,6 % số khối doc của `src/`, và gần
như toàn bộ là dương tính giả.** Đó **chính xác** là bẫy 7 mà `verify-suites.sh` ghi lại bằng chữ
của nó: *"một dụng cụ kiểm nổ trên trạng thái vô tội thì bị bỏ qua"*. Đổi một luật không kiểm được
lấy một luật kêu sói **không phải một cải thiện**, nên tôi **không** phát biểu lại.

### Cái gì thay thế nó — và cái gì KHÔNG

**Có thay thế, và nó đã chạy trong cổng rồi:** `scripts/scan-doc-negations.sh --since` cùng
`EXPECT_NEW_DOC_ABSOLUTES` hỏi câu **kiểm được** trên cùng corpus — *"câu vừa viết có ĐÚNG không"* —
và nó **có tỉ lệ dương khác không**, đo được ở mọi đợt: 24 → 19 (bốn câu chết), 34 gắn cờ / 9 chết,
49 gắn cờ / 15 chết, 92 gắn cờ / 18 chết. Đó là phép kiểm mà luật bị rút **không bao giờ trở
thành**.

🔴 **Nói cho hết cái nó KHÔNG thay thế, vì đó là nửa quan trọng hơn:** luật bị rút hỏi *"thành viên
này có đáng tồn tại không"*. Bộ lọc phủ định **không hỏi câu ấy** và không thể. **Không gì trong
repo này hỏi nó hôm nay**, và việc rút luật **không** làm câu hỏi ấy biến mất — nó chỉ chấm dứt việc
giả vờ rằng một thủ tục không đỏ được đang trả lời nó.

**Chiều ngược lại, ghi để anh lật được:** luật ấy **có** giá trị như một **thói quen viết** kể cả
khi nó không bao giờ nổ — chín đợt tác giả đã tự hỏi *"tôi có gì để nói ngoài cái tên không"* trước
khi viết, và tỉ lệ sai lần-viết-đầu **đo được** ở các đợt ấy — AY-1: **~16 %** trên khoảng chín mươi câu
mới; AZ-1: **22** phép sửa thật; BB-1: **23**; BC-1: **23** — là bằng chứng gián tiếp rằng câu
hỏi ấy có tác dụng. **Rút nó khỏi vị trí một PHÉP KIỂM không có nghĩa là cấm hỏi nó.** Cái bị rút là
mệnh đề *"⇒ một phát hiện về thiết kế"*, tức phần tuyên bố nó là một **bộ dò**.

---

## Tồn dư của BG-1 (2026-08-23, mười hai mục mới) — GHI, KHÔNG SỬA

1. **`EXPECT_NEW_DOC_ABSOLUTES` đã đi 0 → 290 trong tám đợt** (0 · 19 · 21 · 59 · 106 · 203 · 225 ·
   232 · 290), baseline `cfcfae42` **chưa từng dịch**. AX-1 gọi công thái học của nó là *"chưa được
   định giá, đáng một mục của chủ sở hữu"*. **Tôi KHÔNG mở mục cho nó**, và nêu lý do: nó là một
   **cái giá**, không phải một khuyết tật — mỗi đợt phải đọc lại câu của chính mình, và đó chính là
   thứ cơ chế ấy tồn tại để bắt. Nếu anh muốn nó thành một mục, nó là của anh; ghi ở đây để nó
   không lại chỉ sống trong một thông điệp merge.
2. **Mười hai mục mới KHÔNG có nhân chứng nào.** Nhiệm vụ này bị cấm thêm test (tổng `2852` không
   được dịch), nên mọi khẳng định ở §41–§52 được ghim bởi **một phép đọc mã**, không bởi một phép
   chạy. Ít nhất **năm** trong số đó cách một `[Fact]` là ghim được.
3. **Số học phân bố ở §41.5 là số học TAY từ hằng số**, không phải một lần chạy — cùng cái trần BC-1
   đã nêu về họ bộ mô phỏng này, và nó vẫn đúng nguyên.
4. 🔴 **Nhãn (N)/(C) là LỜI KHAI của BG-1, không phải một phép đo.** Không dụng cụ nào trong repo
   kiểm được rằng một hướng sửa **không** chạm ba miễn trừ. Bảy mục được xếp **(C)**; hai trong bảy
   — **45** và **46** — được xếp thế **theo tiền lệ** (mục 10/30 cho đường mất dữ liệu, mục 31 cho
   cái đi tới khách hàng) chứ không vì chúng chạm đúng một trong ba câu chữ. Anh có thể hạ chúng
   xuống (N) và điều phối viên sẽ thi hành.

---

## Không phải quyết định của chủ sở hữu, nhưng đang chặn công cụ đo

Ghi ở đây vì nó làm hỏng **chính dụng cụ đo mọi thứ khác**, nên nó cạnh tranh thời
gian với các mục trên.

**Cổng `scripts/verify-suites.sh` đòi một cỗ máy độc quyền.** Khi trình soạn thảo
gắn vào workspace này chạy design-time build, nó gây ra hai kiểu đỏ giả:
`CS2001`/`BG1002`/`CS2012` trong `_wpftmp`, và một quần thể build-server thường trú.

**Tần suất đã đo trong một phiên: khoảng MỘT NỬA số lần chạy cổng.**
(3 trên 6 ở một người thực thi; 2 trên 4 ở lần chạy hậu-merge.)

**Cửa sổ dễ tổn thương KHÔNG nằm ở chỗ người ta tưởng:** đo được là vào cổng với 8
tiến trình, dọn sạch về 0, rồi **mười tiến trình sinh ra TRONG lúc build của chúng
ta** sống sót qua lần shutdown sau đó với **đúng PID cũ**. Nên **"dọn sạch trước
khi chạy" không bao giờ đủ.**

**Việc làm được không phải sửa cuộc đua** — mọi bản sửa đều hoặc nới một khẳng
định, hoặc giết tiến trình mà cổng không sở hữu. Việc làm được là **nhận ra nó và
nói ra**: hôm nay nhánh 0-lỗi in ra chín dòng `CS2001` và **không một lời khuyên
nào**; phần ghi chép chỉ là chú thích mà **người mở file script ra mới thấy**.

Bằng chứng: commit `8bc397b1` (P-1).

---

## Lịch sử đính chính của chính file này

Hai khối dưới đây từng nằm **ngay dưới đoạn mở đầu** — tức là **thứ đầu tiên chủ sở hữu
đọc được** khi mở file. Chúng **đúng về mặt hồ sơ và sai về mặt thứ tự**: một người tới
để quyết đọc trước hết một bản đính chính về sai lầm của người viết ra danh sách. Y-1
(2026-08-18) **chuyển** chúng xuống đây và để lại một con trỏ tại chỗ.
**Không một chữ nào trong hai khối bị đổi.**

⚠️ **Câu này đúng khi file được lập và KHÔNG còn đúng — sửa 2026-08-17 (T-1).** Nguyên
văn: *"Không mục nào trong đây đã bị sửa. Tất cả đều là hành vi đang chạy hôm nay."*
Nó là một **khẳng định phổ quát trên chính danh sách bên dưới**, và mỗi lần một mục
được thi hành thì không có gì bắt nó phải được suy lại — đúng loài khuyết tật file này
lập ra để chấm dứt, nằm ngay trong lời mở đầu của nó. **Trạng thái nằm ở bảng phán
quyết và ở từng mục, không ở đây, và câu này KHÔNG liệt kê lại các mục ấy nữa.**

> 🔴 **V-1, 2026-08-17 — câu trên vừa được sửa LẦN THỨ BA, và lần này cơ chế bị bỏ chứ
> không phải nội dung được cập nhật.** T-1 thay một khẳng định phổ quát bằng một danh
> sách; U-1 làm danh sách ấy cũ ngay vòng kế tiếp và cập nhật nó; V-1 làm nó cũ lần
> nữa. **Một bản sao thứ hai của bảng phán quyết sẽ đi cũ mỗi vòng, và đó là điều duy
> nhất kiểm được về nó** — nên bản sao bị bỏ, và câu này chỉ còn là con trỏ. Đúng luật
> "đừng giữ một bản sao" mà `OperatorDataRemovalCensusTests` đã mua bằng chính lỗi này.

---

## Ghi chú về nơi cất bằng chứng

Bằng chứng đầy đủ của mỗi mục nằm trong **thông điệp của commit merge được nêu
tên** — thứ đó **nằm trong repo** và đọc bằng `git show <sha>`. Các báo cáo và
ledger chi tiết nằm dưới `.superpowers/sdd/`, **bị gitignore theo thiết kế**, nên
chúng chỉ tồn tại trên máy đã chạy công việc đó. **Đừng dựa vào chúng để bàn giao.**
