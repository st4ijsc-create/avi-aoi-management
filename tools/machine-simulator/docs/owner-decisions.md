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

**Không mục nào trong đây đã bị sửa.** Tất cả đều là hành vi đang chạy hôm nay.

---

## Trạng thái phán quyết — 2026-08-16

Chủ sở hữu uỷ quyền quyết định toàn bộ danh sách này. Phán quyết ghi ngay dưới mỗi
mục. **Ba mục KHÔNG được quyết đơn phương** và lý do nêu tại chỗ: chúng đổi thứ mà
**người ngoài tổ chức này đang dựa vào** — payload MQTT, hình dạng dữ liệu trên dây,
và con số OEE đã báo cáo trong quá khứ. Uỷ quyền phủ được *"làm hay không làm"*,
**không phủ được sự đồng ý của bên thứ ba**.

| # | mục | phán quyết |
|---|---|---|
| 1 | ghi đè im lặng | 🔨 **SỬA** — gộp với 5–7, cùng một thiết kế |
| 2 | `Warn` tốt cho OEE | ✅ **GIỮ HÀNH VI, XUẤT BẢN NÓ** — đổi là viết lại lịch sử |
| 3 | bất đối xứng Sparkplug | ✅ **GIỮ DÂY, ĐÃ GHI RÕ** — đổi payload là việc của bên đăng ký |
| 4 | hình dạng hàng `Samples` | ⚖️ **ĐO TRƯỚC, RỒI CHỌN** — SDK đã xuất bản là ứng viên chuẩn |
| 5–7 | trạng thái thứ ba còn thiếu | 🔨 **SỬA, LÀM TRƯỚC** — mục 1 là hệ quả nặng nhất của nó |
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

> ### 🔨 PHÁN QUYẾT 2026-08-16 — SỬA, VÀ SỬA CÙNG MỤC 5–7
> Đây là **khuyết tật mất dữ liệu** trên một đường **thành công**, không phải một
> lựa chọn thiết kế. Không có cách đọc nào khiến "ghi đè cấu hình của vận hành viên
> mà không một dòng log" là đúng.
>
> **Nhưng nó không được sửa tại chỗ.** Nó là **hệ quả nặng nhất của mục 5–7**: mã
> chỉ biết *có file* và *không có file*, nên một file **hỏng** rơi vào nhánh *không
> có*, và nhánh đó **được phép ghi**. Vá riêng chỗ này để lại đúng cái lỗ ấy ở ba
> chỗ khác.
>
> **Luật, phát biểu một lần cho cả bốn mục:** một file **tồn tại nhưng không đọc
> được** là một trạng thái **thứ ba**. Nó **không bao giờ** được đối xử như *không
> tồn tại*, và **không bao giờ** bị ghi đè. Nội dung không đọc được là **bằng chứng
> duy nhất còn lại** của điều vận hành viên đã cấu hình.
>
> **Thứ tự làm, và lý do — vì tài liệu này nói việc xếp thứ tự chọn một lời biện
> minh:** mục này **đi trước**, vì nó là mục duy nhất **phá huỷ dữ liệu người dùng
> trong một lần khởi động bình thường**. Hai mục kia làm mất **một dòng log** và
> gây **một thứ tự quan sát được**. Mất log là tệ; **mất cấu hình trên một cỗ máy
> không có giao diện để gõ lại** là không phục hồi được.
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
> **Mục 5–7 CHƯA làm**: quyết định này chỉ mở khoá mục 1; ba hình dạng xoá file (mục 5),
> log hoãn của một lần cài đặt thất bại (mục 6) và nửa sau của S4 (mục 7) vẫn nguyên.
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

## 5–7. Ba mục cùng CHUNG một trạng thái thứ ba còn thiếu

Ba mục dưới đây **không phải ba vấn đề** — chúng là **một** vấn đề xuất hiện ba
lần. Hệ thống ở khắp nơi chỉ biết hai trạng thái: *"file có"* và *"file không có"*.
Trạng thái thứ ba — 🔴 **"file CÓ nhưng KHÔNG ĐỌC ĐƯỢC"** — không tồn tại trong mã.

Vì thế **thứ tự làm ba mục này chọn một LỜI BIỆN MINH, không chọn một thiết kế**:
thiết kế là như nhau ở cả ba. Quyết định của anh là làm cái nào **trước**, và điều
đó quyết định câu chuyện được kể về vì sao nó được làm.

### 5. Ba hình dạng xoá file (J-3, mục D1)
Ba đường xoá dữ liệu có hành vi khác nhau ở cùng một tình huống, cách nhau **một
hợp đồng**. Bằng chứng: commit `eca39f89`.

### 6. Log hoãn lại của một lần cài đặt THẤT BẠI (J-2, phần dư 3)
Khi cài đặt thất bại, các dòng log đã hoãn **không được phát ra**. Đã bị từ chối
sửa **ba lần** với cùng một lý do: **KHÔNG TÁCH RỜI ĐƯỢC** khỏi phần còn lại của
đường xử lý. Bằng chứng: commit `99ab7b61`.

### 7. Nửa sau của S4 (J-2)
Dựng-trước-khi-tháo là một **sự đảo thứ tự mà vận hành viên QUAN SÁT ĐƯỢC**, và
việc sửa nó đòi một cơ chế tháo dỡ **có tính giao dịch**. Bằng chứng: commit `99ab7b61`.

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
