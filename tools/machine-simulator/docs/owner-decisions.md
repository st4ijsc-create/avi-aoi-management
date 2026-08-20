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
| 12 | `GenerateDocumentationFile` cho `St4i.EdgeCore` | 🔨 **BẬT CỜ, KHÔNG MIỄN TRỪ** (2026-08-18) — **không phải (a), (b1), (b2) hay (c)**; **việc còn nợ**, nhiều vòng. 🔴 **CỜ ĐÃ BẬT 2026-08-19 (AF-1, đợt 3/8): `EXPECT_WARNINGS` 116 → 852 ĐO, 185 vendored / 667 ours, 103 cái vendored HIỆN RA và ĐƯỢC GHIM, không một lệnh đè.** Mục **Ở LẠI PHẦN II**: **633 của ta chưa trả**, và một cờ bật trên món nợ còn mở là thi hành **một phần**. Đợt 4–8 trả, mỗi đợt đo lại. 🔴 **ĐỢT 4 ĐÃ TRẢ 2026-08-19 (AG-1, đợt 4/8): 101 khẳng định ĐÃ SAI được TRỎ LẠI (75 CS1574 + 23 CS1734 + 3 CS0419, 29 file, 0 dòng mã đụng tới), `EXPECT_WARNINGS` 852 → 751 ĐO, sổ 19 → 16 hàng, 185 vendored / 566 ours, tám hàng VENDORED không dịch một đơn vị.** Mục **VẪN Ở LẠI PHẦN II**: **532 chỗ trống của ta chưa trả** (+ 103 vendored không ai trả được). Đợt 5–8 trả, mỗi đợt đo lại. 🔴 **ĐỢT 5 ĐÃ TRẢ 2026-08-19 (AH-1, đợt 5/8): 120 chỗ THIẾU được VIẾT — một cụm mạch lạc, mô hình dữ liệu config-sync (7 file `Config/`, cả 120 là CS1591), `EXPECT_WARNINGS` 751 → 631 ĐO, sổ vẫn 16 hàng, 185 vendored / 446 ours, `OURS CS1591 448 → 328`, `OURS CS1573 84` KHÔNG dịch, tám hàng VENDORED không dịch một đơn vị.** Mục **VẪN Ở LẠI PHẦN II**: **412 chỗ trống của ta chưa trả**. Đợt 6–8 trả, mỗi đợt đo lại. 🔴 **ĐỢT 6 ĐÃ TRẢ 2026-08-20 (AL-1, đợt 6/8): 129 chỗ THIẾU được VIẾT — một cụm mạch lạc, historian cạnh máy (8 file `Historian/` + `Models/` + `Metrics/`; 85 CS1591 + 44 CS1573), `EXPECT_WARNINGS` 631 → 502 ĐO, sổ vẫn 16 hàng, 185 vendored / 317 ours, `OURS CS1591 328 → 243` VÀ `OURS CS1573 84 → 40` — đợt ĐẦU TIÊN hàng CS1573 dịch, tám hàng VENDORED không dịch một đơn vị.** Mục **VẪN Ở LẠI PHẦN II**: **283 chỗ trống của ta chưa trả**. Đợt 7–8 trả, mỗi đợt đo lại. 🔴 **Và đợt 6 BÁC ba khẳng định đã công bố trong chính cụm ấy — rút tại chỗ, KHÔNG sửa mã: `OeeCalculator` *"mọi tỉ số kẹp `[0,1]`"* (Quality không kẹp), `HistorianWriter.Enqueue` *"kênh đầy ⇒ có cảnh báo"* (cú rơi vì bão hoà là IM LẶNG), `ApplyRealPresenceGateAsync` *"mọi query hướng khách hàng đều áp"* (`QueryTelemetryAsync` không áp và không thể áp). Xem §11** |
| 13 | khôi phục `oee-settings.json` đè lên một file ĐÃ CÓ | 🔨 **ĐÓNG — STORE GHI LẠI DANH TÍNH CỦA CÁC BYTE** (2026-08-19, chủ sở hữu). 🔴 **Giá đã chấp nhận và ghi vào mục: `PUT /v1/historian/oee/settings` trả 409 ở những lúc hôm nay trả 200, KỂ CẢ khi thứ đổi file là một biên tập tay HỢP LỆ hay chỉ là một lần ĐỊNH DẠNG LẠI.** Câu *"bao nhiêu PUT hợp lệ thành 409"* vẫn **KHÔNG đo được** và phán quyết ra **mà không có nó**. **Đã thi hành, AJ-1 (2026-08-19)** — cơ chế **SUY ra chứ không chọn một trong ba**: cả ba ứng viên (băm / `mtime` / kích thước) là **vân tay**, mà vân tay chỉ cần khi không cầm được cả hai vế; `ReadLocked` **đã cầm toàn văn** ở cả hai đầu trong cùng một khoá, nên store **giữ lại toa hạng gốc** và so trực tiếp — **0 lần đọc đĩa thêm**, và **mạnh hơn** mọi hàm hao hụt của nó. Kiểu thứ ba `OeeSettingsFileChangedException`; vị từ gác bằng **CẶP `Loaded/Loaded`**, nên cặp `Loaded/Absent` **không** bị đóng kèm. Nhân chứng `Set_AfterARestoreOntoAHostThatCameUpWithAFile_…` **đảo chiều và đổi tên**; giá được **ghim** bằng một bài kiểm riêng |
| 14 | **hai hợp đồng hàng `Samples` đá nhau, một cái được CƯỠNG CHẾ** | 🔴 **CHỜ ANH** — phần dư của mục 4, mở 2026-08-18 (AA-1, vòng phản biện 1); `WelderSim` phát hình dạng **cổng ingest TỪ CHỐI**. 🔴 **ĐO trên cổng đang chạy 2026-08-18 (AB-1): từ chối là THẬT (HTTP 400 ở bước lược đồ) — VÀ cờ `PROCESS_RESULT_INGEST_ENABLED` MẶC ĐỊNH TẮT, nên chưa bản triển khai nào nạp. Hai nửa đọc cùng nhau; ba lựa chọn vẫn CHƯA QUYẾT**. 🔴 **KHẢ NĂNG THỨ BA ĐÃ ĐO 2026-08-19 (AI-1), SỬA sau phản biện: KHẢ THI — `Normalizer` có đủ thông tin, `WaveformSeries` và `WelderSim` KHÔNG phải đổi. Nhưng nó KHÔNG nằm trọn ở một đường dây: cùng một envelope đi ra BA bề mặt, và một trong ba là gương ngữ nghĩa MQTT RETAINED — một **bề mặt đã xuất bản thứ hai; NGƯỜI ĐĂNG KÝ CHƯA ĐO và không đo được từ repo này** (hợp đồng TỰ KHAI rằng họ ở ngoài repo — đó là lời của tài liệu, không phải một phép đếm). 🔴 **Giá gương ấy KHÔNG phải của riêng lựa chọn 3: lựa chọn 1 trả CÙNG giá đó CỘNG THÊM, lựa chọn 2 không trả giá nào trong cây này nhưng trả TOÀN BỘ ở ngoài (hợp đồng ingest đã xuất bản + ba SDK).** Và KHÔNG một bài kiểm nào trong 2763 bài đỏ lên, tức lối này KHÔNG CÓ NHÂN CHỨNG. **Ràng buộc thi hành cứng: `LiveTransport.ReadSampleSeries` chỉ nhận hàng `double[]` và bỏ im lặng mọi kiểu khác.** Ba lựa chọn VẪN CHƯA QUYẾT** — 📎 **câu ngay trước giữ NGUYÊN VĂN, RÚT 2026-08-19 (AK-1), và lý do là chủ sở hữu ĐÃ PHÁN, không phải câu ấy từng sai; AK-1 dùng đúng MỘT kiểu bảo tồn — kiểu AB-1 lập và AI-1 dùng: trích nguyên văn rồi rút, kèm ngày và người, KHÔNG dấu gạch ngang ở bất kỳ đâu, không xoá một dòng nào.** → 🔨 **QUYẾT: LỰA CHỌN 3 — DỰNG CẶP `[t, v]` Ở RANH GIỚI `Normalizer`** (2026-08-19, chủ sở hữu). `WaveformSeries`, `WelderSim`, `ScrewdriveSim` **không đổi một dòng**; thứ đổi là **payload đi ra**. 🔴 **Giá đã chấp nhận và ghi vào mục: HAI bề mặt đã xuất bản đổi CÙNG LÚC, không một** — payload ingest HTTP **và** gương ngữ nghĩa MQTT retained `syn/…`; **NGƯỜI ĐĂNG KÝ CHƯA ĐO và không đo được từ repo này**. Cộng một bề mặt thứ ba, riêng tư: hàng đợi store-and-forward của SDK ghi nguyên payload **xuống đĩa** và **phát lại hình dạng CŨ sau khi mã đã đổi** — **cửa sổ ấy CHƯA ĐO**. **Đã thi hành, AK-1 (2026-08-19)** — cơ chế của `t` **SUY ra chứ không chọn**: `t(i) = i / rateHz`, tức **thời điểm mà `rateHz` HÀM Ý**, **không** phải thời điểm `WelderSim` vẽ đường cong; lý do là ở ranh giới chỉ có **bốn trường** của `WaveformSeries`, còn dựng lại thời điểm THẬT đòi **tham số hoá riêng của từng bộ sinh** — không có trên hồ sơ, khác nhau theo driver, và **vắng hẳn** với driver bên thứ ba mà ranh giới này cũng phục vụ. 🔴 **`rateHz` KHÔNG đổi nghĩa và KHÔNG đổi giá trị** — đó là điều kiện DỪNG của nhiệm vụ và nó không bị chạm. 🔴 **Nửa bất lợi, viết ngay cạnh:** chỗ lệch **4,17 %** của `WelderSim` **không được tạo ra và cũng không được sửa** ở đây (phép chuyển tính đúng cái `t` mà một bên tiêu thụ tuân hợp đồng đã tính hôm nay) — **nhưng nó chuyển `t` từ NGẦM sang ĐÃ VIẾT RA**, nên sửa chỗ lệch ấy về sau là **đổi những con số đã xuất bản**, không còn là đổi một tài liệu. Nhân chứng **MỚI** `WaveformPairAtTheWireBoundaryTests` (bảy `[Fact]`): gỡ phép chuyển ⇒ **BỐN đỏ**; trả kiểu hàng khác `double[]` ⇒ **SÁU đỏ**; 🔴 `WaveformSeriesRowShapeContractTests` **VẪN XANH, và đó là im lặng, không phải chấp thuận** — nó nhìn thượng nguồn |
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
