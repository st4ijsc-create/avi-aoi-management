# Thiết kế: Wave 3 — "Đáng tin để hành động" (ngừng sản xuất nhiễu tại nguồn)

**Ngày:** 2026-07-29 · **Nhánh:** `feat/hmi-dep` · **Tiếp nối:** Wave 0 (`f02b4b88`) → Wave 1 (`65dbc2fa`) → Wave 2 (`8e4d2f66`)

**Mục tiêu một câu:** Wave 3 **không thêm AI mới và không dựng màn hình mới**. Nó sửa phía **SINH** để mỗi cảnh báo còn lại đều là một việc đáng làm.

---

## 1. Vì sao wave này tồn tại

Sau Wave 2, tôi đo trạng thái các mặt AI còn lại và thấy hai đống tồn:

| Đầu ra | Khối lượng | Đã ghi nhận |
|---|---|---|
| `predictive_alerts` | 52, **toàn bộ `ACTIVE`** | **0** (dù đã bắn 52 thông báo) |
| `ai_insights` (báo cáo điều hành) | 111, **toàn bộ `new`** | **0** |

Thoạt nhìn giống hệt Wave 2 ("AI làm ra mà không ai thấy"). **Nhưng không phải.** Cửa vào đã có: `ai_insights` có 6 nơi tiêu thụ phía client (`ControlTower`, `ExecutiveMobile`, `MachineAISummary`, `QualityAIInsightCard`, `RepairAISummary`, `controlTower/panels`), `predictive_alerts` có `OpsConsole`.

Phép hiệu chỉnh quyết định: **Andon có 6 sự kiện, cả 6 đều đã được ghi nhận.** Người dùng trong hệ này **có** xử lý việc khi việc đến đúng chỗ và đáng làm. Nên con số 0 không thể đổ cho "DB demo không có người dùng".

### Đính chính một chẩn đoán sai của chính tôi

Ban đầu tôi kết luận cảnh báo "không nêu tên máy" vì cột `machineCode` rỗng trên cả 52 dòng. **Sai.** 49/52 **có** `machineId`, và phần mô tả ghi rõ: `Predicted failure for machine SIM-L1-ICT: risk 67% (confidence 50%), within 5 days.` Chỉ cột `machineCode` (dữ liệu phi chuẩn hoá) là không bao giờ được ghi.

Sự thật phức tạp hơn và đáng lo hơn: **49 cảnh báo chỉ về 3 cái máy.**

---

## 2. Sáu nguyên nhân — đọc được từ mã, không suy đoán

| # | Nguyên nhân | Bằng chứng | Loại |
|---|---|---|---|
| 1 | **Bão cảnh báo** — cửa sổ gom trùng chỉ 5 phút, cho qua 3 cái rồi mới chặn, hết 5 phút reset | `aiSmartAlertRouter.ts:119-136`. Đo: máy #3 nhận **22 cảnh báo trong 1 ngày**; máy #2 nhận 11 (21/7) rồi 9 (24/7) | sinh rác |
| 2 | **Tiêu đề vô dụng** — `title = "MACHINE FAILURE: HIGH"` giống hệt trên cả 49 dòng | `aiSmartAlertRouter.ts:201` | rác không đọc được |
| 3 | **`machineCode` không bao giờ được ghi** (chỉ ghi `machineId`) | `aiSmartAlertRouter.ts:205` | rác không đọc được |
| 4 | **Không có hạn dùng** — `expiresAt` NULL trên cả 52; tuổi trung bình 9,2 ngày và tăng mãi | đo DB | rác không tự dọn |
| 5 | **Báo cáo không chống trùng** — INSERT trần | `aiExecutiveReport.ts:600`. Đo: 5 bản **trùng khớp từng byte** (md5 giống nhau, cùng dài 129); 111 dòng chỉ mang **36 nội dung khác nhau** | sinh rác |
| 6 | **Báo cáo rỗng vẫn được lưu** — `fpy: 0, ngRate: 0`, thân bài 129 ký tự | đo DB | sinh rác |

**Thứ tự sửa quan trọng:** sửa #2/#3 mà không sửa #1 chỉ làm 49 dòng rác trở nên dễ đọc hơn. Wave này sửa phía sinh trước.

### Khuôn đúng đã tồn tại trong chính codebase

Chú thích tại `aiSmartAlertRouter.ts:240` ghi rõ `qualityGateEvaluator` đã bảo đảm **"one-open-event + a re-arm cooldown"** cho cổng chất lượng. Đường cảnh báo máy **không dùng khuôn đó**. Wave 3 mang khuôn ấy sang.

---

## 3. Cơ chế lõi: một-cảnh-báo-mở cho mỗi (máy × loại)

Trong `routeAlert`, trước khi ghi: tìm cảnh báo `ACTIVE` cùng `(machineId, alertType)`.
- **Có** ⇒ **CẬP NHẬT** dòng đó: tăng số lần xuất hiện, làm mới `currentValue`/`confidenceScore`/`predictedTimeframe`/`description`, gia hạn `expiresAt`.
- **Không** ⇒ INSERT như hiện nay.

Bốn quy tắc kèm theo, mỗi cái xử lý một cạm bẫy có thật trong dữ liệu:

**(a) Giữ nguyên `createdAt`.** `processAutoEscalation()` đo tuổi cảnh báo để leo thang. Nó phải đo *"tình trạng này mở bao lâu rồi"*, không phải *"lần báo gần nhất cách đây bao lâu"*. Nếu reset `createdAt`, một tình trạng kéo dài 5 ngày sẽ **vĩnh viễn không bao giờ leo thang** — biến bản vá thành lỗi nặng hơn bệnh.

**(b) Mức độ chỉ đi lên.** Lấy `max(cũ, mới)`. Một tình trạng đã `CRITICAL` không được âm thầm tụt xuống `MEDIUM` vì vòng quét sau ước lượng nhẹ hơn.

**(c) Chỉ gộp khi có `machineId`.** 3/52 cảnh báo là `PATTERN_ANOMALY` không gắn máy — giữ nguyên hành vi cũ cho chúng. Không bịa khoá gộp từ dữ liệu không có.

**(d) Hỏng thì GHI, không nuốt.** Truy vấn tìm-cảnh-báo-mở lỗi ⇒ vẫn INSERT.

### Vì sao (d) fail-OPEN, ngược với cổng bảo mật Wave 2 (fail-CLOSED)

Hậu quả hai loại sai khác nhau về bản chất. Rò tài liệu là thiệt hại **vĩnh viễn, không thu hồi được** ⇒ không chắc thì cấm. Bỏ sót cảnh báo máy sắp hỏng thì hậu quả là **hỏng máy thật** ⇒ không chắc thì cứ báo. Một cảnh báo trùng tốn một dòng; một cảnh báo mất có thể tốn một cái máy.

**Ràng buộc:** không đụng `processAutoEscalation()`. Một dòng được cập nhật vẫn thoả điều kiện quét của nó (`status=ACTIVE`, `acknowledgedAt IS NULL`).

---

## 4. Bốn sửa còn lại

### 4.1 Cảnh báo đọc được

Ghi `machineCode` (đã có `machineId`, tra một lần).

Quan trọng hơn: bảng **đã có đủ trường cấu trúc** — `machineCode`, `currentValue`, `confidenceScore`, `predictedTimeframe` — nên **giao diện tự dựng câu tiếng Việt, máy chủ không sinh chuỗi**. Đây đúng ranh giới ngôn ngữ mà reviewer Wave 2 đề xuất (gắn dữ liệu máy-đọc-được, ánh xạ i18n phía client), và nó tránh nhân thêm đống câu tiếng Anh lẫn tiếng Việt đang nợ.

`title` chỉ còn là phương án dự phòng cho nơi chỉ hiển thị được tiêu đề: gồm mã máy + rủi ro + khung thời gian, thay cho `"MACHINE FAILURE: HIGH"` lặp 49 lần. **Với cảnh báo không có `machineId`** (ví dụ `PATTERN_ANOMALY`), giữ khuôn tiêu đề hiện tại — không bịa mã máy rỗng vào chuỗi.

### 4.2 Hạn dùng gắn với thực tế

Mỗi lần cập nhật thì gia hạn `expiresAt`. Nghĩa là: **chừng nào máy còn bị dự đoán hỏng, cảnh báo còn sống; khi vòng quét thôi báo về máy đó, cảnh báo tự hết hạn.**

Một tác vụ nền chuyển các cảnh báo quá hạn còn `ACTIVE` sang `EXPIRED` (**giá trị đã có sẵn trong enum `statusenum_5`: `ACTIVE | ACKNOWLEDGED | RESOLVED | DISMISSED | EXPIRED`** — không cần migration enum), **kèm lý do ghi vào `resolutionNotes`**. Không biến mất im lặng.

Điều này biến "hết hạn" thành *"tình trạng đã thôi tái diễn"* chứ không phải *"đã quá N ngày"* — một đồng hồ tuỳ tiện sẽ đóng nhầm cảnh báo của máy vẫn đang hỏng.

Đăng ký tác vụ theo đúng khuôn các scheduler khác trong `server/_core/backgroundJobs.ts` (mỗi khối `try/catch`, best-effort, không bao giờ làm sập boot).

### 4.3 Báo cáo điều hành: chống trùng

Khoá chống trùng `(source, title)` — tiêu đề đã chứa sẵn kỳ và mốc thời gian (`Báo cáo điều hành — ca làm việc (2026-07-20 07:00)`).

### 4.4 Không sinh báo cáo rỗng

KPI toàn 0, không rủi ro, không điểm nhấn ⇒ **không ghi**, chỉ log lý do. Một báo cáo không nói gì mà vẫn chiếm chỗ trong hòm chờ đọc chính là thứ dạy người ta bỏ qua cả hòm.

### 4.5 Độ tin cậy: hiện ra và đo được — KHÔNG đổi ngưỡng

Mục này được **gộp vào theo yêu cầu chủ dự án**. Khảo sát mã + dữ liệu cho kết quả **khác hẳn** giả thiết ban đầu ("mức độ HIGH gắn cho cảnh báo 52% tin cậy là sai"):

**(i) Mức độ lấy từ rủi ro là ĐÚNG.** `confidenceScore` = dữ-liệu-nhiều (≤50) + đặc-trưng-đồng-thuận (≤30) + khoảng-tin-cậy-hẹp (≤20) — nó đo **độ vững của bằng chứng**, không phải xác suất hỏng. `failureRisk` mới là khả năng/mức độ hỏng, và `urgencyFromRisk` (`predictiveMaintenanceService.ts:148-153`) map ≥75→CRITICAL, ≥55→HIGH. 49 cảnh báo có rủi ro 62–70 ⇒ HIGH **đúng công thức**. Đây là hai trục khác nhau, không phải một trục bị tính sai.

**(ii) Các đặc trưng CÓ đồng thuận.** Đo `aiAnalysis.factors`: 4–5 yếu tố mỗi cảnh báo, đóng góp thật — `reliability 48`, `trend 100` ("health slope −4.38/step, projected danger in ~6h"), `anomaly 16`, `temperature 75`. Giả thiết "không đặc trưng nào xác nhận lẫn nhau" **bị bác bỏ**.

**(iii) Thiên lệch chọn mẫu — lỗi suy luận phải tránh.** Độ tin cậy tụm ở đúng 50/51/55/56, tức ngay sát ngưỡng phát `CONFIDENCE_ALERT_THRESHOLD = 50` (`:46`). Kết luận "toàn cảnh báo yếu" là **sai**: cảnh báo dưới 50 không bao giờ được phát, nên tập quan sát được **bắt buộc** bắt đầu từ 50. Đó là đo cái thước, không phải đo cái được đo.

**Vấn đề thật:** ứng viên bị loại **biến mất không để lại dấu vết**. Không ai biết ngưỡng 50 đang chặn 3 hay 3000 cảnh báo ⇒ **không ai hiệu chỉnh được nó**. Đổi ngưỡng lúc này là đoán mò.

**Phạm vi gộp thêm — ba việc, không đụng ngưỡng:**

1. **Hiện độ tin cậy thành trục riêng.** `HIGH · bằng chứng vừa đủ (52%)` phải khác `HIGH · bằng chứng vững (88%)` trên màn hình. Dữ liệu đã có sẵn trong cột `confidenceScore`; phân dải (thấp/trung bình/cao) tính **phía client** theo đúng ranh giới ngôn ngữ ở §4.1.
2. **Ghi lại thứ bị loại.** Đếm ứng viên bị chặn theo từng điều kiện (rủi ro thấp / tin cậy thấp / ngoài khung thời gian) — **chỉ số đếm + log, KHÔNG tạo dòng cảnh báo**, không bảng mới. Đây là dữ liệu để wave sau quyết ngưỡng bằng bằng chứng.
3. **Số lần tái diễn là tín hiệu tin cậy tốt hơn.** Sau khi gộp trùng, "máy này đã báo 22 lần trong 1 ngày" mạnh hơn hẳn con số tin cậy do chính mô hình tự chấm — và Wave 3 tạo ra nó miễn phí. Phải hiện nó cạnh mức độ.

**KHÔNG làm:** không đổi `urgencyFromRisk`, không đổi `RISK_ALERT_THRESHOLD`/`CONFIDENCE_ALERT_THRESHOLD`/`TIMEFRAME_ALERT_HOURS`, không đổi công thức `confidenceScore`. Lý do ghi rõ ở (iii).

---

## 5. Đống tồn 52 + 111 — GỘP, KHÔNG XOÁ

Thực hiện bằng **một migration SQL chạy một lần** (auditable, không phải script chạy tay) — cùng file với migration cột đếm ở §7.

- **49 cảnh báo `MACHINE_FAILURE` → 3** (mỗi máy một cái, giữ giá trị mới nhất, ghi số lần đã xuất hiện). Các dòng bị thay thế chuyển `DISMISSED`, ghi lý do vào `resolutionNotes`.
- **3 cảnh báo `PATTERN_ANOMALY` giữ nguyên** — không có `machineId` nên không có khoá gộp (quy tắc (c) §3). ⇒ **Tổng `ACTIVE` sau wave: 6, không phải 3.**
- **111 báo cáo →** giữ **bản cũ nhất** mỗi tiêu đề (bản đầu tiên là bản thật, các bản sau là bản sao do chạy lặp); phần còn lại đặt `status = 'superseded'` (`ai_insights.status` là **varchar tự do** ⇒ không cần migration).
- **Không xoá dòng nào.** Lịch sử còn nguyên, truy vết được.

---

## 6. Rủi ro của chính wave này

Số cảnh báo `ACTIVE` sẽ giảm từ 52 xuống 6. Ai nhìn bảng điều khiển thấy con số tụt sẽ kết luận **"AI hỏng rồi"**.

Giảm thiểu: cảnh báo gộp phải **hiện rõ số lần đã tái diễn**. "Máy SIM-L1-ICT — đã cảnh báo 22 lần trong 1 ngày" mạnh hơn hẳn 22 dòng rời rạc, và nó chứng minh hệ vẫn đang làm việc.

---

## 7. Migration

Cần **một** migration, gồm hai phần: (i) thêm `occurrenceCount` (integer, NOT NULL, default 1) + `lastOccurredAt` (timestamptz) vào `predictive_alerts` — đã kiểm: **chưa tồn tại**; (ii) gộp đống tồn theo §5. Tên cột dùng đúng khuôn camelCase-có-nháy như các cột sẵn có của bảng này. Không cần migration enum cho `status` (đã có `EXPIRED`), không cần cho `ai_insights.status` (varchar).

Chạy bằng owner `aoi` — `avi_app` không có quyền DDL (lỗi `42501`, đã gặp ở các wave trước).

---

## 8. Kiểm thử & nghiệm thu

**Hàm thuần bắt buộc:** tách quyết định ghi-hay-cập-nhật thành `decideAlertWrite(existing, incoming)` để test được **không cần DB**: mức-độ-chỉ-đi-lên, `machineId` rỗng ⇒ luôn insert, hỏng-thì-vẫn-ghi, giữ `createdAt`.

Bài học Wave 2 (Task 4): logic rủi ro nằm lẫn trong hàm có I/O thì **không test nào chạy qua nó** — khối trộn nguồn Studio từng chưa bao giờ được thực thi vì bảng rỗng.

**Nghiệm thu — chạy lại CHÍNH những truy vấn đã dùng để chẩn đoán:**

| Kiểm | Trước | Đạt khi |
|---|---|---|
| Cảnh báo mở mỗi (máy × loại) | 22 cái/máy/ngày | **≤ 1** |
| Tổng cảnh báo `ACTIVE` | 52 | **6** (3 gộp theo máy + 3 `PATTERN_ANOMALY` không gộp), mỗi cái ghi rõ số lần tái diễn |
| Dòng báo cáo / nội dung khác nhau | 111 / 36 | **1 : 1** với báo cáo mới |
| Báo cáo rỗng mới sinh | có | **0** |
| Cảnh báo quá hạn còn `ACTIVE` | 52 | **0**, và mỗi cái `EXPIRED` có lý do |
| Ứng viên bị loại (§4.5) | **không đo được** | đếm được theo từng điều kiện chặn |
| Độ tin cậy hiện trên màn hình | không hiện | hiện dải + số lần tái diễn cạnh mức độ |

**Nghiệm thu live bắt buộc** (bài học Wave 2 — F4 lọt qua lượt live đầu vì tôi chỉ mở một loại điểm đo): phải kiểm **cả hai nhánh** — máy có `machineId` (gộp) **và** `PATTERN_ANOMALY` không có `machineId` (không gộp). Không được chỉ kiểm nhánh thuận.

---

## 9. Ngoài phạm vi (YAGNI có chủ đích)

- **Không dựng hòm việc / màn phân loại mới.** Sửa nguồn trước, đo lại, rồi mới quyết có cần không. Nếu sau khi sửa chỉ còn 6 cảnh báo mở thì cả một mảng giao diện là thừa.
- **Không đổi ngưỡng phát hay công thức rủi ro/tin cậy** — nay đã thành mục §4.5 (được gộp vào theo yêu cầu chủ dự án), với kết luận: mức-độ-từ-rủi-ro là đúng thiết kế, và ngưỡng **không thể** hiệu chỉnh cho tới khi có dữ liệu phía bị-loại mà Wave 3 sinh ra.
- **Không đụng đường thị giác** (990 ảnh nhúng, 49 mẫu bất thường) — để wave sau.
