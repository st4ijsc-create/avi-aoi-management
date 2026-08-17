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

⚠️ **Câu này đúng khi file được lập và KHÔNG còn đúng — sửa 2026-08-17 (T-1).** Nguyên
văn: *"Không mục nào trong đây đã bị sửa. Tất cả đều là hành vi đang chạy hôm nay."*
Nó là một **khẳng định phổ quát trên chính danh sách bên dưới**, và mỗi lần một mục
được thi hành thì không có gì bắt nó phải được suy lại — đúng loài khuyết tật file này
lập ra để chấm dứt, nằm ngay trong lời mở đầu của nó. **Trạng thái nằm ở bảng phán
quyết và ở từng mục, không ở đây:** mục 1 (Q-1), mục 6 (T-1) và mục 7 (U-1) đã thi
hành; những mục còn lại vẫn là hành vi đang chạy hôm nay.

> 🔴 **U-1, 2026-08-17 — và câu ngay trên vừa được sửa LẦN THỨ HAI vì đúng lý do nó
> được viết ra.** T-1 thay một khẳng định phổ quát bằng một **danh sách**, đúng cách;
> nhưng một danh sách các mục đã thi hành **cũng đi cũ** mỗi lần một mục nữa được thi
> hành, và U-1 làm nó cũ ngay trong vòng kế tiếp. Nó được cập nhật chứ không bị bỏ, vì
> **bảng phán quyết mới là nguồn sự thật** và câu này chỉ là con trỏ tới nó.

---

## Trạng thái phán quyết — 2026-08-16

Chủ sở hữu uỷ quyền quyết định toàn bộ danh sách này. Phán quyết ghi ngay dưới mỗi
mục. **Ba mục KHÔNG được quyết đơn phương** và lý do nêu tại chỗ: chúng đổi thứ mà
**người ngoài tổ chức này đang dựa vào** — payload MQTT, hình dạng dữ liệu trên dây,
và con số OEE đã báo cáo trong quá khứ. Uỷ quyền phủ được *"làm hay không làm"*,
**không phủ được sự đồng ý của bên thứ ba**.

| # | mục | phán quyết |
|---|---|---|
| 1 | ghi đè im lặng | 🔨 **SỬA** — ~~gộp với 5–7~~ **(nhóm ấy SAI, xem §5–7)**; đã thi hành, Q-1 |
| 2 | `Warn` tốt cho OEE | ✅ **GIỮ HÀNH VI, XUẤT BẢN NÓ** — đổi là viết lại lịch sử |
| 3 | bất đối xứng Sparkplug | ✅ **GIỮ DÂY, ĐÃ GHI RÕ** — đổi payload là việc của bên đăng ký |
| 4 | hình dạng hàng `Samples` | ⚖️ **ĐO TRƯỚC, RỒI CHỌN** — SDK đã xuất bản là ứng viên chuẩn |
| 5 | ~~ba hình dạng xoá file~~ → **`oee-settings.json`** | 🔴 **CHỜ ANH** — đã đo (S-1): ba tư thế, một cái mất dữ liệu im lặng |
| 6 | log hoãn của một lần cài đặt hỏng | 🔨 **PHÁT RA TRÊN ĐƯỜNG NÉM LỖI** (2026-08-17) — đã thi hành, T-1 |
| 7 | nửa sau của S4 | 🔨 **DỪNG + GIỮ COMMIT + BÁO TRÊN `/v1/health`** (2026-08-17) — đã thi hành, U-1 |
| — | cổng đòi máy độc quyền | 🔨 **SỬA SAU** — làm hỏng dụng cụ đo mọi mục trên |

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
> **Luật, phát biểu một lần cho cả bốn mục:** một file **tồn tại nhưng không đọc
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
4. **SQL không bị bác bỏ ở đâu cả** — bờ IL không nhìn thấy một chuỗi. Bảy file có
   câu lệnh SQL xoá/thay hàng đã được liệt kê và ghim, nhưng không gì ở đây chứng
   minh không có câu lệnh nào được ráp lúc chạy từ những mảnh mà không mẫu nào khớp.
5. **Xoá bởi thứ không phải mã này** nằm ngoài toàn bộ: `packaging/remove-data.ps1`,
   trình cài đặt, sidecar `-wal`/`-shm` của SQLite, key ring của DataProtection, và
   SDK vendored dưới `examples/` — thứ **thật sự ghi** các file WAL `.jsonl`.

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

## Ghi chú về nơi cất bằng chứng

Bằng chứng đầy đủ của mỗi mục nằm trong **thông điệp của commit merge được nêu
tên** — thứ đó **nằm trong repo** và đọc bằng `git show <sha>`. Các báo cáo và
ledger chi tiết nằm dưới `.superpowers/sdd/`, **bị gitignore theo thiết kế**, nên
chúng chỉ tồn tại trên máy đã chạy công việc đó. **Đừng dựa vào chúng để bàn giao.**
