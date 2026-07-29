# Thiết kế: Wave 4 — "Đo đúng cái vừa sửa" (trả nợ do Wave 3 tạo ra)

**Ngày:** 2026-07-29 · **Nhánh:** `feat/hmi-dep` · **Tiếp nối:** Wave 0 (`f02b4b88`) → Wave 1 (`65dbc2fa`) → Wave 2 (`8e4d2f66`) → Wave 3 (`f53bb004`)

**Mục tiêu một câu:** Wave 3 gộp cảnh báo trùng và **vô tình làm KPI báo động nói dối**. Wave 4 trả đúng món nợ đó, không thêm tính năng mới.

---

## 1. Vì sao wave này tồn tại — nợ do chính tôi tạo ra

Wave 3 đổi mô hình: một tình trạng đang mở nay chỉ có **MỘT dòng**, mỗi lần tái diễn chỉ cập nhật `occurrenceCount` thay vì đẻ dòng mới. Nhưng `alarmKpiRouter` đọc **mỗi DÒNG là một sự kiện**, và lọc cửa sổ theo `createdAt` — thứ Wave 3 **cố ý giữ nguyên** để `processAutoEscalation()` đo đúng tuổi tình trạng.

**Hai lỗi sinh ra, đo được:**

| Lỗi | Bằng chứng |
|---|---|
| **Đếm thiếu** | 6 dòng `ACTIVE` mang tổng `occurrenceCount` = **52**. KPI báo 6. Máy #3 (22 lần) xuống hạng trong Pareto "máy gây phiền nhất" |
| **Biến mất** | Lọc `createdAt >= since`. Cảnh báo tạo 4 ngày trước, hôm nay tái diễn 22 lần ⇒ **rơi hoàn toàn khỏi cửa sổ 24h**. Trước Wave 3 nó không rơi vì mỗi lần tái diễn có `createdAt` mới |

**Vì sao nghiêm trọng hơn vẻ ngoài:** `alarmKpiMath.ts` là toán **ISA-18.2** — chuẩn công nghiệp về quản lý báo động, tồn tại để **đo tải lên người vận hành**, gồm tần suất/giờ/operator và phép phát hiện **"ngập báo động" (>10 lượt trong 10 phút)**.

Mà Wave 3 chỉ gộp **dòng** — **thông báo vẫn bắn mỗi lần tái diễn** (nợ M6 đã ghi sổ). Nên tải thật lên người vận hành **không giảm**, trong khi chỉ số đo tải đó nay **báo thiếu**. Phép "ngập báo động" cũng mất tác dụng: một dòng không bao giờ tạo nổi 10 lượt trong 10 phút.

## 2. Con số mới sẽ có nghĩa gì — nói trước để không hiểu nhầm

Ta đo **"tình trạng đã tái diễn bao nhiêu lần"**, không phải **"người vận hành bị báo bao nhiêu lượt"**.

Hôm nay hai thứ trùng nhau vì thông báo bắn mỗi lần tái diễn. **Nếu sau này chặn bớt thông báo (nợ M6), hai con số sẽ tách ra** — KPI khi đó phản ánh *máy hỏng bao nhiêu lần*, không còn phản ánh *người bị làm phiền bao nhiêu lần*. ISA-18.2 vốn muốn vế sau.

Đây là đánh đổi **có chủ ý**: bảng nhật ký riêng bền hơn `notifications` (vốn phụ thuộc cấu hình người nhận và định tuyến), nhưng phải ghi rõ để wave sau không quyết sai.

## 3. Nhật ký lần-tái-diễn

Bảng mới `predictive_alert_occurrences`: mỗi lần `routeAlert` **ghi mới hoặc cập nhật** một cảnh báo ⇒ chèn một dòng gồm `alertId`, `occurredAt`, và mức độ + độ tin cậy **tại thời điểm đó**. **Lần đầu tiên cũng được ghi** — không cảnh báo nào thiếu lần thứ nhất.

**Ràng buộc bắt buộc:**

**(a) Ghi nhật ký hỏng thì cảnh báo VẪN phải được ghi.** Sổ sách không bao giờ được làm hỏng đường an toàn. Cùng tinh thần fail-open Wave 3 §3d, nhưng dứt khoát hơn vì đây thuần tuý là số liệu.

**(b) KHÔNG nạp ngược quá khứ.** 6 cảnh báo hiện có mang 52 lần tái diễn nhưng **không ai biết chúng xảy ra lúc nào**. Sinh 52 mốc thời gian giả cho bảng trông đẹp là đúng thứ cả ba wave trước chống lại.

**(c) Có hạn lưu.** 22 dòng/máy/ngày là bình thường ⇒ bảng sẽ phình. Xoá lần-tái-diễn cũ hơn một mốc cấu hình được (mặc định **90 ngày**), gắn vào **`alertExpirySweeper`** — bộ quét Wave 3 đã dựng và đã đăng ký trong `backgroundJobs.ts`, không đẻ tác vụ nền thứ hai. Việc dọn phải **độc lập** với việc đóng cảnh báo: một bên hỏng không được làm bên kia ngừng.
⚠ Đây là **cố ý phá luật "không xoá" của Wave 3**: luật đó dành cho **cảnh báo** — thứ người ta cần truy vết; còn đây là **số liệu đo**, giữ mãi mới là tích rác.

## 4. KPI đọc từ nhật ký

`alarmKpiRouter` dựng sự kiện từ **lần tái diễn** thay vì từ dòng cảnh báo. Mỗi lần tái diễn = một sự kiện với mốc thời gian riêng.

Một thay đổi này sửa **cả ba lỗi cùng lúc**:
- **Đếm đủ** — 22 lần thành 22 sự kiện.
- **Phát hiện lại được "ngập báo động"** — đã có mốc thời gian từng lần.
- **Hết lỗi biến mất** — cảnh báo tạo 4 ngày trước nhưng tái diễn hôm nay sẽ có lần tái diễn nằm trong cửa sổ hôm nay.

Các trường còn lại của sự kiện (mức độ, máy, thời điểm ghi nhận/xử lý) vẫn lấy từ dòng cảnh báo cha — không nhân bản chúng vào nhật ký.

## 5. Nút "sinh dự đoán" phải đi qua cùng một cửa

`aiRouters.ts:690` (`predictiveAlert.generatePredictions` — nút người dùng bấm) hiện `INSERT` thẳng vào `predictive_alerts`, **bỏ qua `routeAlert`**. Hậu quả: không gộp trùng, không đặt `expiresAt`, và sau wave này sẽ **không ghi nhật ký lần-tái-diễn** ⇒ tạo lỗ đen trong KPI.

Bấm nút vài lần là **dựng lại đúng đống tồn Wave 3 vừa dọn**. Cho nó đi qua `routeAlert` đóng cả ba lỗ cùng lúc.

## 6. Cảnh báo đã đóng không được biến mất không dấu vết

`OpsConsole.tsx:158` chỉ hỏi `status: "ACTIVE"`. Khi bộ quét đóng một cảnh báo vì đã thôi tái diễn, nó bốc hơi khỏi màn hình — và lý do Wave 3 cẩn thận ghi vào `resolutionNotes` **không ai đọc được**.

Cho phép xem cảnh báo vừa đóng gần đây, kèm lý do đóng.

## 7. Dọn sạch để có MỘT thời kỳ số liệu duy nhất

Chủ dự án xác nhận **dữ liệu hiện tại chỉ là dữ liệu thử**, cho phép xoá và sinh lại.

**Phạm vi xoá: CHỈ `predictive_alerts`.** Giữ nguyên hai bảng sao lưu `w3_backup_alerts`, `w3_backup_insights` đã tạo trước migration 0308.

**Thứ tự bắt buộc:** chạy migration tạo bảng nhật ký **TRƯỚC**, xoá `predictive_alerts` **SAU**. Lý do giống hệt bài học triển khai Wave 3 — drizzle liệt kê toàn bộ cột từ schema, nên thao tác trên bảng khi schema và DB lệch nhau sẽ ném `42703`. Bảng nhật ký lúc đó còn rỗng nên không cần xoá riêng; nếu khoá ngoại có `ON DELETE CASCADE` thì nó tự sạch theo.

**KHÔNG xoá** `ai_insights`, đề xuất ngưỡng, kho tri thức, sản phẩm/máy/điểm đo — dù đã được cho phép rộng hơn. Lý do: chúng **không liên quan tới KPI cảnh báo**, và là bằng chứng nghiệm thu của Wave 2 (150 đề xuất → 3 đã áp dụng; tài liệu `quy-trinh-thay-vòi-hút.txt` chứng minh trợ lý trích dẫn đúng). Xoá thứ không cần xoá là thói quen xấu; nếu sau này muốn dựng lại toàn bộ thì đó phải là quyết định riêng, không phải hệ quả phụ của việc sửa KPI.

**Lợi ích kèm theo:** đóng luôn **ô nghiệm thu duy nhất Wave 3 không đạt** — `machineCode` rỗng 6/6 và tiêu đề `"MACHINE FAILURE: HIGH"` cũ. Dòng sinh mới sẽ có mã máy và tiêu đề nêu đúng máy ngay từ đầu.

## 8. Kiểm thử — chỗ Wave 3 trả giá đắt nhất

Ba điều **bắt buộc**:

1. **Hàm thuần**: quyết định "ghi lần tái diễn nào" phải tách khỏi I/O, test được không cần DB. Bài học Wave 3: mọi lỗi lọt lưới đều nằm trong mã trộn lẫn I/O.
2. **Test fail-open ở tầng nối dây**: ghi nhật ký ném lỗi ⇒ cảnh báo **vẫn** được ghi. Wave 3 từng có đúng lỗ này ở `routeAlert` và chỉ phát hiện ở review.
3. **Test mệnh đề lọc cửa sổ của KPI**: phải **ĐỎ** nếu ai đổi về lọc theo `createdAt`. Đây chính là chỗ lỗi "cảnh báo đang sống mà biến mất" đã lọt, và mock cũ **không hề kiểm điều kiện lọc** — phải duyệt điều kiện thật, không chấp nhận mock trả kết quả bất kể lọc gì.

## 9. Nghiệm thu — đo bằng chính con số đã đau

Sinh lại dữ liệu, để một máy tái diễn nhiều lần, rồi kiểm:

| Kiểm | Đạt khi |
|---|---|
| Đếm | KPI đếm **đúng số lần tái diễn thật**, không phải số dòng |
| Ngập báo động | >10 lượt trong 10 phút ⇒ **phát hiện được** |
| Không biến mất | Cảnh báo tạo nhiều ngày trước, tái diễn hôm nay ⇒ **vẫn trong cửa sổ 24h** |
| Nút sinh dự đoán | Bấm nhiều lần ⇒ **không** đẻ dòng trùng, **có** ghi nhật ký |
| Cảnh báo đã đóng | Xem được, **kèm lý do** |
| `machineCode` | **0 rỗng** trên cảnh báo có `machineId` (ô Wave 3 không đạt) |

**Bắt buộc đi CẢ HAI nhánh** (bài học Wave 2): máy có `machineId` **và** `PATTERN_ANOMALY` không có.

## 10. Ngoài phạm vi (YAGNI có chủ đích)

- **KHÔNG chặn bớt thông báo (nợ M6).** Thông báo hiện bắn mỗi lần tái diễn, trước khi quyết gộp. Chặn nó là **đổi tải thật lên người vận hành** — cần dữ liệu để quyết, và dữ liệu đó chính là thứ wave này sinh ra. Quyết mù bây giờ là lặp lại đúng sai lầm "đổi ngưỡng khi chưa có dữ liệu phía bị loại" mà Wave 3 §4.5 đã tránh.
- **KHÔNG đụng chỉ mục tìm ảnh** (990 ảnh 384 chiều vs cột `vector(1024)`). Đã đo: tìm ảnh **vẫn đúng**, chỉ quét toàn bảng — trần hiệu năng, không phải lỗi. Tối ưu trước khi cần.
- **KHÔNG đổi ngưỡng/công thức ISA-18.2.**
