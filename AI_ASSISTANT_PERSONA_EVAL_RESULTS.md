# AI Assistant — Persona Evaluation Results

Run at: 2026-05-12T18:10:03.899Z
Endpoint: `http://127.0.0.1:3000/api/ai/local-kb/ask`

## Overall

- Pass rate (score ≥ 70%): **97%** (32/33)
- Latency p50/p95: **6348ms / 8721ms** (target p95 ≤ 11000)
- Avg depth (mean of persona means): **0.56**
- Personas with avg depth ≥ 0.75: **0/6** (target ≥ 6)

## Summary by Persona

| Persona | Role/Level | Avg score | Avg depth | Depth≥0.75 | Tool used | Citation-only | Empty | Avg latency (ms) | p95 latency (ms) |
|---------|------------|-----------|-----------|------------|-----------|---------------|-------|-------------------|--------------------|
| P1_operator_new — Công nhân vận hành (mới vào nghề) | worker/basic | 87% | 0.57 | 1/5 | 2/5 | 3/5 | 0/5 | 6422 | 8397 |
| P2_operator_exp — Công nhân vận hành (kinh nghiệm) | worker/basic | 94% | 0.49 | 0/5 | 5/5 | 0/5 | 0/5 | 4699 | 4960 |
| P3_qa_engineer — Kỹ sư QA / Quy trình | engineer/technical | 92% | 0.45 | 0/8 | 0/8 | 8/8 | 0/8 | 6202 | 9355 |
| P4_production_mgr — Quản lý sản xuất | manager/manager | 93% | 0.55 | 1/5 | 5/5 | 0/5 | 0/5 | 4481 | 5220 |
| P5_ai_engineer — Kỹ sư AI / Vision | engineer/technical | 93% | 0.57 | 1/5 | 1/5 | 4/5 | 0/5 | 7198 | 8596 |
| P6_it_admin — Quản trị hệ thống (IT Admin) | it_admin/technical | 90% | 0.7 | 2/5 | 0/5 | 5/5 | 0/5 | 7756 | 8594 |

## Per-question detail

### [P1_operator_new] Làm sao để vào màn hình kiểm tra sản phẩm?

- intent=`how_to` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=6801ms score=**100%** depth=**0.7**
- depth breakdown: procedural=1, role=1, error=0.4, api=0.7, examples=0.4
- citations: feature/knowledge/features/inspection/history.md (0.754), feature/knowledge/features/inspection/history.md (0.746), feature/knowledge/features/inspection/inspection-detail.md (0.736)

```
Để vào màn hình kiểm tra sản phẩm, công nhân cần thực hiện các bước sau:

1. Mở menu **Sản xuất › Lịch sử kiểm tra** hoặc truy cập trực tiếp `/history`.
2. Khi đã ở trong màn hình này, hãy click vào một dòng để mở chi tiết của một lần kiểm tra cụ thể.
3. Sau khi mở chi tiết, họ sẽ thấy màn hình `/inspection/:id` với đầy đủ thông tin về sản phẩm và kết quả kiểm tra.

Lưu ý/lỗi thường gặp:
- Ảnh không tải hoặc mờ có thể do URL ảnh sai; storage (S3/MinIO) không khả dụng; watermark gây chậm.
- Toạ độ overlay sai vị trí có thể do `positionX/Y` trong `measurement_point_defs` không khớp với ảnh thực tế; ảnh sản phẩm khác kích thước reference.

Liên quan 2 chủ đề:
- Quản lý Sản phẩm (Product Models): Để biết thêm thông tin về cách quản lý các mô hình sản phẩm, công nhân có thể tham khảo tài liệu liên quan.
- Chi tiết kiểm tra (Inspection Detail): Công nhân cũng cần hiểu rõ hơn về cách sử dụng màn hình `/inspection/:id` để xem chi tiết về từng lần kiểm tra.

API liên quan: `/api/inspection/:id/images`, `/api/measurement-point/:pointDefId/reference-image`
```

### [P1_operator_new] Tôi thấy máy báo NG, phải làm gì tiếp theo?

- intent=`general` lang=`vi` provider=`ollama` tool=`get_machine_status` toolNote=`-` cit=5 latency=6151ms score=**83%** depth=**0.6**
- depth breakdown: procedural=1, role=1, error=1, api=0, examples=0
- citations: domain/knowledge/domain/howto-shift-change.md (0.745), feature/knowledge/features/monitoring/machine-registration.md (0.717), feature/knowledge/features/production/production-scheduling.md (0.711)
- toolSummary: Tổng 47 máy: 0 online, 47 offline, 0 lỗi. Offline: AVI-GB300-01, GB300-AVI-01, MCH-FAC-BN-DIP-LA-ST1, MCH-FAC-BN-DIP-LB-ST1, MCH-FAC-BN-DIP-LB-ST2.

```
Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại. Tôi đề xuất bạn cần tìm hiểu thêm về quy trình xử lý báo cáo NG trên hệ thống AVI-AOI của công ty mình. Bạn có thể tham khảo các bước sau:

1. **Kiểm tra trạng thái máy**: Đầu tiên, hãy kiểm tra xem máy đang chạy nào đã báo lỗi (NG). Điều này giúp bạn xác định được cụ thể là máy nào cần xử lý.

2. **Xác minh thông tin báo cáo NG**: Đảm bảo rằng thông tin về lỗi đã được ghi chính xác và đầy đủ trên hệ thống, bao gồm cả thời điểm báo cáo và chi tiết lỗi.

3. **Kiểm tra dữ liệu sản phẩm**: Nếu lỗi liên quan đến sản phẩm, hãy kiểm tra xem liệu có bất kỳ vấn đề nào với sản phẩm đang chạy hay không. Có thể cần phải kiểm tra lại các quy trình sản xuất hoặc chất lượng sản phẩm.

4. **Hỏi trưởng ca hoặc IT admin**: Nếu bạn không chắc
```

### [P1_operator_new] Cách đổi ca làm việc trong hệ thống?

- intent=`how_to` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=8397ms score=**83%** depth=**0.88**
- depth breakdown: procedural=1, role=1, error=1, api=1, examples=0.4
- citations: feature/knowledge/features/settings/shift-config.md (0.808), domain/knowledge/domain/howto-shift-change.md (0.793), feature/knowledge/features/admin/user-guide.md (0.773)

```
Để đổi ca làm việc trong hệ thống AVI-AOI, công nhân cần tuân theo các bước sau:

1. **Trưởng ca đến trước giờ giao 10 phút**: Trong menu `Sản xuất › Bàn giao ca`, họ sẽ xem danh sách các lô đang chạy, sản lượng tích lũy, số lỗi (NG), máy offline và alert chưa xử lý.

2. **Điền ghi chú bàn giao**: Trưởng ca cũ cần điền một ghi chú ngắn mô tả tình trạng của máy hoặc lô đang chạy. 

3. **Hoàn tất bàn giao**: Bấm nút "Hoàn tất bàn giao" để hệ thống chốt ca và tạo bản ghi `ShiftHandover`.

4. **Nhận ca mới**: Trưởng ca mới cần đăng nhập vào hệ thống, bấm nút "Nhận ca". Hệ thống sẽ mở ca mới và áp dụng `shiftId` cho mọi quét tiếp theo.

5. **Công nhân tiếp tục vận hành**: Khi công nhân quét sản phẩm, `shiftId` mới đã được gắn tự động.

Nếu quên bấm "Nhận ca", hệ thống vẫn ghi nhận sản phẩm vào ca theo giờ chấm; nhưng sẽ không có `ShiftHandover` record. Trong trường hợp này, họ có thể sử dụng nút "Bổ sung bàn giao" để hoàn thiện quá trình.

Lưu ý rằng nếu có lô chưa kết thúc, nó **không bị split** giữa hai ca và sản lượng tích lũy được phân bổ theo `scannedAt`. 

Hệ thống

API liên quan: `/api/ai/local-kb/reload`, `/api/userguide/topics`, `/api/userguide/topic/:slug`, `/api/userguide/sea
```

### [P1_operator_new] Hôm nay máy của tôi đã kiểm tra được bao nhiêu sản phẩm?

- intent=`list` lang=`vi` provider=`ollama` tool=`get_today_stats` toolNote=`-` cit=5 latency=2499ms score=**86%** depth=**0.28**
- depth breakdown: procedural=0.2, role=0.6, error=0.4, api=0, examples=0.2
- citations: feature/knowledge/features/inspection/history.md (0.814), feature/knowledge/features/inspection/history.md (0.775), feature/knowledge/features/monitoring/machine-registration.md (0.752)
- toolSummary: Hôm nay đã kiểm tra 0 sản phẩm: OK=0, NG=0, NTF=0. Tỉ lệ NG = 0%.

```
Hôm nay máy của bạn đã kiểm tra được 0 sản phẩm. Kết quả kiểm tra hôm nay là OK=0, NG=0, NTF=0. Tỷ lệ lỗi (NG) là 0%. 

[1] Lịch sử kiểm tra (History) (part 4) | knowledge/features/inspection/history.md
```

### [P1_operator_new] Tôi quên mật khẩu, làm sao đăng nhập lại?

- intent=`how_to` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=8260ms score=**83%** depth=**0.4**
- depth breakdown: procedural=1, role=0.6, error=0.4, api=0, examples=0
- citations: domain/knowledge/domain/howto-change-password.md (0.69), domain/knowledge/domain/howto-shift-change.md (0.67), domain/knowledge/domain/howto-shift-change.md (0.654)

```
Để lấy lại mật khẩu trong hệ thống AVI/AOI, bạn có thể theo các bước sau:

1. Trong giao diện người dùng (UI), tìm đến **"Trang đăng nhập"**.
2. Bạn sẽ thấy một ô để nhập email hoặc username của mình. Nhập vào và bấm **"Quên mật khẩu?"**.
3. Hệ thống sẽ gửi cho bạn một liên kết reset mật khẩu qua email. Nếu SMTP chưa được cấu hình, hãy liên hệ với quản trị viên để thực hiện việc reset thủ công tại `Menu › Quản trị › Người dùng › chọn user › Reset password`.
4. Sau khi nhận được liên kết reset từ hệ thống, hãy mở link đó và điền lại thông tin cần thiết như mật khẩu mới (yêu cầu ≥ 8 ký tự, có chữ hoa, chữ thường, số) để cập nhật mật khẩu của bạn.

Nếu quên mật khẩu, bạn cũng có thể sử dụng các bước trong phần hướng dẫn đổi mật khẩu tại [1]. 

Lưu ý: 
- Không nên dùng lại mật khẩu cũ trong 5 lần gần nhất.
- Bật xác thực hai yếu tố (2FA) để tăng cường bảo mật. Bạn có thể bật xác thực này ở tab "Bảo mật" bằng cách quét QR code từ ứng dụng Authenticator như Google Authenticator hoặc Microsoft Authenticator.

Trong quá trình sử dụng, nếu gặp lỗi liên quan đến thời gian địa lý, hãy kiểm tra và điều chỉnh `TZ` trên server (mặc định là `Asia/Ho_Chi_Minh`). Nếu sai, mọi cột giờ đều sẽ lệch 7h
```

### [P2_operator_exp] Trạng thái lô L20260505-001 thế nào?

- intent=`general` lang=`vi` provider=`ollama` tool=`get_lot_status` toolNote=`NOT_FOUND` cit=5 latency=4287ms score=**86%** depth=**0.36**
- depth breakdown: procedural=0.2, role=0.6, error=0.4, api=0.4, examples=0.2
- citations: domain/knowledge/domain/howto-lot-management.md (0.698), feature/knowledge/features/production/production-orders.md (0.669), feature/knowledge/features/monitoring/machine-registration.md (0.666)
- toolSummary: Không tìm thấy lệnh sản xuất "L20260505-001".

```
Tình trạng của lô sản xuất L20260505-001 hiện tại chưa được tìm thấy trong dữ liệu thời gian thực. Để biết chính xác trạng thái của lô này, bạn có thể thử tra cứu thông qua API `/api/lots/:orderCode` với `orderCode` là `L20260505-001`. 

Nếu bạn đã sử dụng API này nhưng vẫn không tìm thấy thông tin về lô L20260505-001, có thể đó là do lô này chưa được tạo hoặc trạng thái của nó đang ở một trạng thái khác ngoài `planned`, `running`, `completed`, `cancelled`. 

Nếu bạn cần thêm hướng dẫn về cách sử dụng API, tôi có thể cung cấp thêm thông tin.
```

### [P2_operator_exp] Máy nào đang offline?

- intent=`general` lang=`vi` provider=`ollama` tool=`get_machine_status` toolNote=`-` cit=5 latency=4924ms score=**100%** depth=**0.54**
- depth breakdown: procedural=0.7, role=1, error=1, api=0, examples=0
- citations: feature/knowledge/features/monitoring/machine-registration.md (0.688), feature/knowledge/features/monitoring/machine-registration.md (0.674), feature/knowledge/features/alerts/alerts-list.md (0.66)
- toolSummary: Tổng 47 máy: 0 online, 47 offline, 0 lỗi. Offline: AVI-GB300-01, GB300-AVI-01, MCH-FAC-BN-DIP-LA-ST1, MCH-FAC-BN-DIP-LB-ST1, MCH-FAC-BN-DIP-LB-ST2.

```
### Tóm tắt
Công nhân muốn biết danh sách các máy đangoffline.

### Các bước làm

1. **Xem Machine Status Monitor**:
   - Mở URL `/machine-status` hoặc truy cập vào menu `Monitoring › Machine Status`.
   - Trong giao diện, bạn sẽ thấy một grid card hiển thị trạng thái của tất cả các máy.
   - Chọn tab "Status History" để xem lịch sử thay đổi trạng thái của từng máy.
   - Máy đang offline sẽ có màu sắc và biểu tượng Wi-Fi bị tắt (icon Wifi/WifiOff).
   - Kết quả: Bạn sẽ thấy danh sách các máy đangoffline.

2. **Xem Danh sách Cảnh báo**:
   - Truy cập URL `/alerts` hoặc vào menu `Cảnh báo › Danh sách cảnh báo`.
   - Lọc theo trạng thái của máy, bạn sẽ tìm thấy các máy đã bị offline.
   - Kết quả: Bạn sẽ thấy danh sách các máy đangoffline với thông tin về lý do và thời gian.

###
```

### [P2_operator_exp] Top 5 lỗi nhiều nhất tuần này

- intent=`troubleshoot` lang=`vi` provider=`ollama` tool=`get_ng_compare` toolNote=`-` cit=5 latency=4906ms score=**100%** depth=**0.56**
- depth breakdown: procedural=1, role=0.6, error=1, api=0, examples=0.2
- citations: feature/knowledge/features/inspection/history.md (0.587), feature/knowledge/features/production/production-dashboard.md (0.586), feature/knowledge/features/inspection/history.md (0.56)
- toolSummary: tuần này: NG 0/0 (0%). tuần trước: NG 0/0 (0%). Tỉ lệ NG không đổi 0 điểm % (+0% tương đối).

```
### Tóm tắt

Để tìm top 5 lỗi nhiều nhất trong tuần này, bạn cần thực hiện các bước sau:

1. Mở trang **Sản xuất › Lịch sử kiểm tra**.
2. Lọc dữ liệu theo `dateFrom` và `dateTo` để chỉ xem sản phẩm từ đầu tuần đến nay.
3. Chọn kết quả là `NG`.
4. Bấm **Search** để hiển thị danh sách các lỗi.

### Các bước

1. **Mở trang**: Vào **Sản xuất › Lịch sử kiểm tra** trong UI.
   - *Làm gì*: Mở trang lịch sử kiểm tra.
   - *Ở đâu*: Trong menu Sản xuất, chọn Lịch sử kiểm tra.
   - *Kết quả*: Hiển thị danh sách các lỗi từ đầu tuần đến nay.

2. **Lọc dữ liệu**: Chọn khoảng ngày là `Hôm nay` và `Tuần`.
   - *Làm gì*: Nhập `dateFrom` và

Màn hình liên quan: `/inspection/:id`
```

### [P2_operator_exp] Xu hướng lỗi 7 ngày qua

- intent=`troubleshoot` lang=`vi` provider=`ollama` tool=`get_defect_trend` toolNote=`-` cit=5 latency=4960ms score=**100%** depth=**0.56**
- depth breakdown: procedural=0.7, role=1, error=0, api=0.7, examples=0.4
- citations: feature/knowledge/features/production/production-dashboard.md (0.696), feature/knowledge/features/production/production-orders.md (0.679), feature/knowledge/features/products/product-management.md (0.671)
- toolSummary: Xu hướng 7 ngày: tỉ lệ NG TB = 0%. Cao nhất ngày 2026-05-07 (0%).

```
### Tóm tắt

Trợ lý hệ thống AVI/AOI on-prem cho công nhân được thiết kế để giúp họ quản lý và theo dõi quá trình sản xuất một cách hiệu quả. Các bước thao tác bao gồm mở trang từ menu *Sản xuất → Bảng điều khiển sản xuất*, chọn khoảng ngày, lọc theo nhà máy và dây chuyền, tìm kiếm trạm cụ thể, bật bộ lọc Low Yield, tự động làm mới dữ liệu, so sánh nhiều nhà máy, sao chép link với filter, chuyển tab phân tích, và xuất báo cáo.

### Các bước

1. **Mở trang**: Từ menu *Sản xuất → Bảng điều khiển sản xuất*. Mặc định hiển thị tab **Station View** với dữ liệu hôm nay.
2. **Chọn khoảng ngày**: Bấm một trong các nút preset (Hôm nay / Hôm qua / 1 Tuần / 1 Tháng / 1 Năm) hoặc bấm **Custom** để mở lịch và chọn ngày bắt đầu

API liên quan: `/api/public/products/by-code/:code`, `/api/reports/export`
```

### [P2_operator_exp] Lô của tôi sắp xong chưa?

- intent=`general` lang=`vi` provider=`ollama` tool=`get_lot_status` toolNote=`NOT_FOUND` cit=5 latency=4419ms score=**83%** depth=**0.44**
- depth breakdown: procedural=0.2, role=0.6, error=0, api=1, examples=0.4
- citations: feature/knowledge/features/ai/ai-local-knowledge-base.md (0.64), domain/knowledge/domain/aoi-workflow.md (0.61), feature/knowledge/features/admin/audit-logs.md (0.606)
- toolSummary: Không tìm thấy lệnh sản xuất "<mã lệnh>".

```
Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại. Bạn có thể hỏi thêm về việc tạo AOI Package mới hoặc liên quan đến hệ thống audit logs. Để biết thêm thông tin, bạn có thể tham khảo các mục liên quan như cách tạo AOI Package và cách sử dụng Audit Logs.

API liên quan: `/api/ai/local-kb/reload`, `/api/userguide/topics`, `/api/userguide/topic/:slug`, `/api/userguide/search`
Màn hình liên quan: `/admin/audit-logs`, `/admin/enhanced-audit-logs`, `/admin/user-guide`
Biến cấu hình: `USE_LEGACY_OLLAMA=true`, `KB_QA_NUM_PREDICT=384`
```

### [P3_qa_engineer] Hướng dẫn cài điểm đo cho sản phẩm

- intent=`how_to` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=8721ms score=**83%** depth=**0.68**
- depth breakdown: procedural=1, role=1, error=0, api=1, examples=0.4
- citations: feature/knowledge/features/admin/user-guide.md (0.704), feature/knowledge/features/products/product-management.md (0.696), domain/knowledge/domain/howto-shift-change.md (0.679)

```
### Tóm tắt

Đây là hướng dẫn cài đặt và cấu hình các điểm đo cho sản phẩm trong hệ thống AVI-AOI. Các bước này bao gồm việc tạo mô hình sản phẩm, cấu hình điểm đo (measurement point shapes), và thêm điểm đo vào các mô hình sản phẩm cụ thể.

### Các bước đánh số nêu

1. **Mở trang quản lý sản phẩm** — Mở `/admin/user-guide` hoặc truy cập trực tiếp `/products`. Bảng hiển thị các cột: `Code`, `Name`, `Category`, `Số MP`, `Số máy gán`, `Updated at`.
2. **Tạo mô hình mới** — Nhấn `+ New Product Model`. Dialog mở với các trường cần nhập:
   - Trường nhập: `code` (bắt buộc, unique), `name` (bắt buộc), `category` (chọn từ dropdown), `description` (tuỳ chọn), `goldenImage` (upload — file PNG/JPG, khuyến nghị ≤ 5 MB).
   - Tab `Fiducial Marks`: thêm các điểm fiducial (toạ độ X, Y, kiểu). Lưu ý: Hình dạng của điểm đo được xác định bởi `shape`, `coordinates`, và `pointType`.
3. **Cấu hình điểm đo** — Nhấn vào tên mô hình → mở trang chi tiết, có các tab như `Overview`, `Measurement Points`, `Fiducial Marks`, `Versions`. Tại đây, kỹ sư sẽ cấu hình các hình dạng điểm đo cho từng mô hình sản phẩm.
4. **Thêm điểm đo** — Chọn hình dạng cần thiết từ danh sách

API liên quan: `/api/ai/local-kb/reload
```

### [P3_qa_engineer] Cách tạo sản phẩm mới và liên kết với lệnh sản xuất?

- intent=`how_to` lang=`vi` provider=`extractive` tool=`-` toolNote=`-` cit=5 latency=1511ms score=**83%** depth=**0.2**
- depth breakdown: procedural=0, role=0.6, error=0, api=0, examples=0.4
- citations: feature/knowledge/features/production/production-orders.md (0.73), feature/knowledge/features/products/product-management.md (0.723), feature/knowledge/features/production/production-orders.md (0.717)

```
Bạn muốn tra cứu lô sản xuất nào? Vui lòng cung cấp **mã lệnh sản xuất** (ví dụ `L20260505-001` hoặc `PO12345`).
Bạn cũng có thể vào *Menu › Sản xuất › Lệnh sản xuất* để chọn trực tiếp từ danh sách.
```

### [P3_qa_engineer] Các tham số cấu hình của một measurement point gồm những gì?

- intent=`general` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=6348ms score=**100%** depth=**0.42**
- depth breakdown: procedural=0.7, role=1, error=0, api=0, examples=0.4
- citations: feature/knowledge/features/products/measurement-point-setup.md (0.942), feature/knowledge/features/products/measurement-point-setup.md (0.926), domain/knowledge/domain/howto-measurement-point-shapes.md (0.867)

```
### Tóm tắt

Cấu hình điểm đo (Measurement Points) bao gồm các tham số như `pointCode`, `type`, `coordinates`, `nominal`, `USL`, `LSL`, `unit`, `algorithm`, và `aiModelId`. Các tham số này được cấu hình trên tab Measurement Points trong sản phẩm cụ thể.

### Các bước

1. **Mở tab Measurement Points**:
   - *Đi làm gì*: Mở tab Measurement Points của một sản phẩm cụ thể.
   - *Ở đâu*: Trong `/products/:productModelId` hoặc `/products/:id/points`.
   - *Kết quả*: Bảng hiển thị các điểm đo với thông tin `pointCode`, `type`, `coordinates`, `nominal`, `USL`, `LSL`, `unit`, `algorithm`, và `aiModelId`.

2. **Thêm điểm đo**:
   - *Đi làm gì*: Thêm một điểm đo mới.
   - *Ở đâu*: Trong `/products/:productModelId`
```

### [P3_qa_engineer] Cho ví dụ cấu hình một điểm đo dạng vòng tròn (ring) với fiducial

- intent=`general` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=6680ms score=**100%** depth=**0.62**
- depth breakdown: procedural=0.7, role=1, error=0, api=1, examples=0.4
- citations: domain/knowledge/domain/howto-measurement-point-shapes.md (0.81), feature/knowledge/features/products/measurement-point-setup.md (0.79), feature/knowledge/features/products/measurement-point-setup.md (0.783)

```
### Tóm tắt

Đây là cách cấu hình một điểm đo dạng vòng tròn (ring) cùng với fiducial trên trợ lý kỹ thuật AVI/AOI on-prem. Điểm đo này sẽ được thêm vào mô hình sản phẩm `PCB-A7-V2` và sau đó được áp dụng cho các máy AOI.

### Các bước

1. **Mở danh sách Product Models**:
   - Truy cập URL: `/products`.
   - Mở tab `Measurement Points` của `PCB-A7-V2`.

2. **Thêm điểm đo dạng vòng tròn (ring)**:
   - Bấm vào `+ Thêm điểm`, chọn loại shape là `ring`.
   - Vẽ vòng tròn ngoài và vòng tròn trong trên ảnh mẫu.
   - Điền thông tin cho điểm đo:
     - Mã điểm: `P-PCB-A7-V2-FID1` (ví dụ).
     - Loại đo: `presence` (hoặc loại khác tùy thuộc yêu cầu).
     - Tolerance: 5

API liên quan: `/api/machines/:id/refresh-config`, `/api/public/products/:productCode/measurement-points`, `/api/public/products/by-code/:code`
Màn hình liên quan: `/products/:productModelId`, `/products/PCB-A7-V2`, `/machines/5`
```

### [P3_qa_engineer] Cách phân tích Pareto cho NG theo điểm đo trong tháng?

- intent=`how_to` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=9355ms score=**83%** depth=**0.56**
- depth breakdown: procedural=1, role=0.6, error=1, api=0, examples=0.2
- citations: feature/knowledge/features/analytics/pareto-analysis.md (0.922), feature/knowledge/features/analytics/category-analytics.md (0.902), domain/knowledge/domain/howto-pareto-defects.md (0.837)

```
### Cách phân tích Pareto cho lỗi NG theo điểm đo trong tháng?

Để thực hiện phân tích Pareto cho lỗi NG theo điểm đo trong một tháng, bạn có thể sử dụng các API và bước sau đây:

1. **Tạo bộ lọc:**
   - Chọn khoảng thời gian là 30 ngày (tháng).
   - Bộ lọc theo tất cả line/machine/factory.
   
2. **Xem biểu đồ Pareto:**
   - Chọn tab `By Type` để xem lỗi theo loại.
   - Áp dụng bộ lọc Factory / Line / Machine nếu cần.
   - Với tab `By Time Period`, chọn `groupBy`: day hoặc week.
   - Xem bar chart và đường tích lũy %, top-N có thể giới hạn (vd top 15).
   
3. **Xuất dữ liệu:**
   - Nhấn "Export CSV" để tải xuống kết quả.

### Các bước cụ thể:

**Bước 1:** 
- Truy cập URL `/pareto-analysis` trong menu `Analytics → Pareto Analysis`.
- Chọn khoảng thời gian là 30 ngày.
- Áp dụng bộ lọc Factory / Line / Machine nếu cần.
- Chọn tab `By Type`.

**Bước 2:**
- Xem biểu đồ Pareto với bar chart và đường tích lũy %.
- Giới hạn top-N lỗi (vd top 15).
- Xuất dữ liệu sang CSV.

### Lưu ý/Lỗi thường gặp:

- **Quá nhiều lỗi:** Áp dụng filter top-N để giảm độ phức tạp của biểu đồ.
- **Dataset rỗng:**
```

### [P3_qa_engineer] SPC trong hệ thống dùng công thức nào để tính UCL/LCL?

- intent=`general` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=6416ms score=**100%** depth=**0.68**
- depth breakdown: procedural=0.7, role=0.6, error=0.7, api=1, examples=0.4
- citations: domain/knowledge/domain/howto-spc-control.md (0.778), feature/knowledge/features/analytics/spc-rules.md (0.726), domain/knowledge/domain/howto-spc-control.md (0.69)

```
### Tóm tắt

Hệ thống AVI-AOI sử dụng công thức `mean ± 3·σ` để tính đường UCL và LCL trong SPC (Statistical Process Control).

### Các bước

1. **Tạo điểm đo**: Trong UI, chọn sản phẩm và điểm đo cần thiết.
   - *Ở đâu*: Menu › Sản phẩm › Chọn SKU › tab "Điểm đo".
   - *Làm gì*: Nhập hoặc bấm "Tính từ N mẫu gần nhất" (n=30 mặc định).
2. **Cấu hình UCL/LCL**: Sau khi nhập dữ liệu, hệ thống tự động tính và hiển thị đường UCL và LCL.
   - *Ở đâu*: tab "Điểm đo".
   - *Làm gì*: Nhập hoặc bấm "Tính từ N mẫu gần nhất" (n=30 mặc định).
   
### Lưu ý/lỗi thường gặp

- **Cấu hình UCL/LCL không tự sinh**: Nếu hệ thống không tự

API liên quan: `/api/ai/local-kb/reload`, `/api/userguide/topics`, `/api/userguide/topic/:slug`, `/api/userguide/search`
Màn hình liên quan: `/admin/user-guide`
```

### [P3_qa_engineer] có bao nhiêu Rules cho SPC

- intent=`list` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=4212ms score=**86%** depth=**0.2**
- depth breakdown: procedural=0.2, role=0.6, error=0, api=0, examples=0.2
- citations: feature/knowledge/features/analytics/spc-rules.md (0.75), feature/knowledge/features/analytics/spc-rules.md (0.701), feature/knowledge/features/alerts/mqtt-alert-rules.md (0.673)

```
SPC có tổng cộng **13 rules**: 4 luật Western Electric (`WE_1`..`WE_4`), 8 luật Nelson (`NELSON_1`..`NELSON_8`) và 1 luật EWMA (`EWMA_OOC`). 

[2] Bộ luật SPC (SPC Rule Catalog) (part 2) | knowledge/features/analytics/spc-rules.md
```

### [P3_qa_engineer] liệt kê các luật Nelson SPC

- intent=`list` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=6371ms score=**100%** depth=**0.24**
- depth breakdown: procedural=0.4, role=0.6, error=0, api=0, examples=0.2
- citations: feature/knowledge/features/analytics/spc-rules.md (0.75), feature/knowledge/features/analytics/spc-rules.md (0.695), feature/knowledge/features/analytics/spc-analysis.md (0.608)

```
Các luật Nelson trong hệ thống AVI-AOI bao gồm 8 luật sau:

- `NELSON_1`: 1 điểm >3σ từ mean.
- `NELSON_2`: 9 điểm cùng phía.
- `NELSON_3`: 6 điểm tăng/giảm đơn điệu.
- `NELSON_4`: 14 điểm xen kẽ.
- `NELSON_5`: 2/3 điểm >2σ cùng phía.
- `NELSON_6`: 4/5 điểm >1σ cùng phía.
- `NELSON_7`: 15 điểm trong ±1σ (stratification).
- `NELSON_8`: 8 điểm >1σ về cả hai phía.

Đây là thông tin được lấy từ tài liệu [SPC Rules](knowledge/features/analytics/spc-rules.md).
```

### [P4_production_mgr] Hôm nay sản lượng toàn công ty thế nào?

- intent=`architecture` lang=`vi` provider=`ollama` tool=`get_today_stats` toolNote=`-` cit=5 latency=4984ms score=**100%** depth=**0.54**
- depth breakdown: procedural=0.7, role=1, error=1, api=0, examples=0
- citations: feature/knowledge/features/production/production-orders.md (0.639), feature/knowledge/features/production/production-scheduling.md (0.638), feature/knowledge/features/production/production-orders.md (0.629)
- toolSummary: Hôm nay đã kiểm tra 0 sản phẩm: OK=0, NG=0, NTF=0. Tỉ lệ NG = 0%.

```
### Tóm tắt

Hôm nay đã kiểm tra 0 sản phẩm. Tổng tỉ lệ lỗi là 0%.

### Các bước

1. **Kiểm tra số liệu**: Trong UI của Production Orders tab, chọn `Stats` để xem tổng số lượng đơn hàng và tỉ lệ hoàn thành.
   - *Làm gì*: Kiểm tra số liệu trong Production Orders tab.
   - *Ở đâu trong UI*: Chọn Stats card.
   - *Kết quả*: Xem được số liệu thống kê về sản lượng hôm nay.

2. **Kiểm tra tỉ lệ lỗi**: Trong UI của Production Orders tab, chọn `Stats` để xem tỉ lệ đơn hàng thành công và lỗi.
   - *Làm gì*: Kiểm tra tỉ lệ lỗi trong Production Orders tab.
   - *Ở đâu trong UI*: Chọn Stats card.
   - *Kết quả*: Xem được tỉ lệ đơn hàng thành công và lỗi hôm nay.

### Lưu ý/lỗi thường gặp

- **Triệu chứng**: Số liệu
```

### [P4_production_mgr] Tỉ lệ NG tháng này so với tháng trước?

- intent=`general` lang=`vi` provider=`ollama` tool=`get_ng_compare` toolNote=`-` cit=5 latency=4877ms score=**100%** depth=**0.34**
- depth breakdown: procedural=0.7, role=1, error=0, api=0, examples=0
- citations: feature/knowledge/features/monitoring/machine-registration.md (0.765), domain/knowledge/domain/howto-ng-handling-sop.md (0.761), domain/knowledge/domain/howto-ng-handling-sop.md (0.757)
- toolSummary: tháng này: NG 0/0 (0%). tháng trước: NG 0/0 (0%). Tỉ lệ NG không đổi 0 điểm % (+0% tương đối).

```
### Tóm tắt

Nguyễn có sự thay đổi về tỉ lệ NG giữa tháng này và tháng trước. Theo dữ liệu từ CSDL, tỉ lệ NG trong tháng này là 0%, tương tự như tháng trước cũng chỉ với 0%. Điều này cho thấy tỉ lệ NG không thay đổi so với tháng trước.

### Các bước

1. **Mở Cấu hình › Quản lý máy › Đăng ký máy** hoặc truy cập `/machine-registration`.
   - *Làm gì*: Mở trang đăng ký máy.
   - *Ở đâu trong UI*: Tab "Cấu hình" > "Quản lý máy" > "Đăng ký máy".
   - *Kết quả*: Dữ liệu về các máy đang chờ phê duyệt được hiển thị, bao gồm thông tin như Mã máy, Tên, Loại, Serial Number, Firmware, và Ngày yêu cầu.

2. **Mở Production Dashboard**.
   - *Làm gì*: Mở trang bảng điều khiển sản xuất.
   - *Ở đâu trong
```

### [P4_production_mgr] Nhà máy nào có hiệu suất tốt nhất tuần này?

- intent=`general` lang=`vi` provider=`ollama` tool=`get_ng_compare` toolNote=`-` cit=5 latency=4737ms score=**100%** depth=**0.7**
- depth breakdown: procedural=0.7, role=1, error=0.7, api=0.7, examples=0.4
- citations: feature/knowledge/features/monitoring/machine-registration.md (0.624), feature/knowledge/features/inspection/history.md (0.595), feature/knowledge/features/monitoring/machine-registration.md (0.58)
- toolSummary: tuần này: NG 0/0 (0%). tuần trước: NG 0/0 (0%). Tỉ lệ NG không đổi 0 điểm % (+0% tương đối).

```
### Tóm tắt

Để xác định nhà máy có hiệu suất tốt nhất trong tuần này, chúng ta cần xem xét các thông số KPI liên quan đến việc đăng ký và kiểm tra máy. Chúng tôi sẽ tập trung vào việc phân tích dữ liệu từ `/machine-registration` và `/inspection/history`.

### Các bước

1. **Xác định nhà máy có hiệu suất tốt nhất**:
   - Truy cập `/machine-registration`.
   - Lọc theo `Status = active`, `Last Inspection Date` gần đây nhất.
   - Xem số lượng máy hoạt động và trạng thái (`pending`, `approved`) trong tuần này.

2. **Xác định xu hướng kiểm tra máy**:
   - Truy cập `/inspection/history`.
   - Lọc theo `Machine ID` và `Status = NG` trong tuần này.
   - Tính toán tỷ lệ số lượng máy bị báo lỗi (`NG`) so với tổng số máy hoạt động.

### Lưu ý/lỗi thường gặp

- **Không thấy máy ở tab Pending**: Máy chưa

API liên quan: `/api/machine/submit-inspection`, `/api/machine/upload-image`
```

### [P4_production_mgr] OEE của dây chuyền A đang là bao nhiêu?

- intent=`list` lang=`vi` provider=`ollama` tool=`get_oee` toolNote=`NOT_FOUND` cit=5 latency=2587ms score=**67%** depth=**0.24**
- depth breakdown: procedural=0.2, role=1, error=0, api=0, examples=0
- citations: feature/knowledge/features/alerts/oee-targets.md (0.701), feature/knowledge/features/alerts/oee-targets.md (0.694), feature/knowledge/features/production/production-dashboard.md (0.68)
- toolSummary: Chưa có dữ liệu OEE trong 7 ngày qua.

```
Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại. Đề xuất bạn cung cấp thêm chi tiết như dây chuyền cụ thể hoặc khoảng thời gian mà bạn muốn biết OEE của dây chuyền A. Điều đó sẽ giúp tôi tìm kiếm thông tin chính xác hơn.
```

### [P4_production_mgr] Xuất báo cáo điều hành tuần qua dạng PDF được không?

- intent=`general` lang=`vi` provider=`ollama` tool=`get_defect_trend` toolNote=`-` cit=5 latency=5220ms score=**100%** depth=**0.94**
- depth breakdown: procedural=1, role=1, error=0.7, api=1, examples=1
- citations: domain/knowledge/domain/howto-export-pdf-report.md (0.813), domain/knowledge/domain/howto-export-pdf-report.md (0.781), feature/knowledge/features/analytics/scheduled-reports.md (0.742)
- toolSummary: Xu hướng 7 ngày: tỉ lệ NG TB = 0%. Cao nhất ngày 2026-05-07 (0%).

```
Theo dữ liệu thời gian thực cung cấp, xu hướng 7 ngày của tỉ lệ NG (Not Good) là 0%. Điều này cho thấy trong tuần qua, hệ thống AVI/AOI đã không phát hiện ra bất kỳ sản phẩm nào bị lỗi (NG). 

Để xuất báo cáo PDF dạng định kỳ như Weekly Report, bạn có thể theo dõi các bước sau:

1. Mở trang Reports từ menu *Sản xuất → Bảng điều khiển sản xuất*.
2. Chọn khoảng thời gian là "Hôm nay" để lấy dữ liệu tuần qua.
3. Lọc theo Factory và Line nếu cần.
4. Nhấn vào nút **Export** ở góc phải của màn hình.

Lưu ý rằng, bạn sẽ được yêu cầu chọn định dạng file (PDF) và có thể bao gồm ảnh lỗi (defects) trong file PDF. 

Nếu bạn muốn xuất báo cáo PDF tự động hàng tuần, bạn có thể sử dụng chức năng Báo cáo định kỳ như đã mô tả ở phần

API liên quan: `/api/reports/export`
Màn hình liên quan: `/uploads/reports/Bao`

Ví dụ:
```http
POST /api/reports/export
Content-Type: application/json
Cookie: <session>

{
  "reportType": "shift",          // shift | lot | pareto | oee | bulletin
  "format": "pdf",                // pdf | xlsx
  "filter": {
    "fromDate": "2026-05-11T00:00:00Z",
    "toDate":   "2026-05-1
…
```
```

### [P5_ai_engineer] Cách triển khai một mô hình AI mới lên edge device?

- intent=`how_to` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=8596ms score=**83%** depth=**0.76**
- depth breakdown: procedural=1, role=1, error=1, api=0.4, examples=0.4
- citations: domain/knowledge/domain/howto-edge-model-deploy.md (0.858), domain/knowledge/domain/howto-edge-model-deploy.md (0.853), feature/knowledge/features/ai/ai-local-knowledge-base.md (0.722)

```
Để triển khai một mô hình AI mới lên Edge Device (máy AOI), bạn cần tuân theo các bước sau:

### 1. Tóm tắt
- **Hướng dẫn**: Triển khai mô hình AI xuống Edge (máy AOI) (part 2)
- **Cấu trúc dữ liệu**: `/etc/avi-edge/config.yaml` chứa cấu hình Edge Agent
- **API**: `/api/ai/local-kb/reload` để reload knowledge base

### 2. Các bước thực hiện trên UI
1. Mở `Menu › AI Models`.
2. Chọn model muốn deploy → tab **Versions** → chọn version đã PASS evaluation.
3. Chuyển sang tab **Deployment** → bấm **+ Deploy mới**.
4. Trong hộp thoại:
   - **Target**: chọn từng máy hoặc theo line/factory.
   - **Strategy**: `rolling` (deploy lần lượt 1 máy/phút).
   - **Auto-rollback**: bật nếu inference fail-rate > 5 % trong 10 phút sau deploy.
5. Bấm **Bắt đầu** → theo dõi cột **Status** (Pending → Downloading → Verifying → Active).

### 3. Lưu ý/lỗi thường gặp
- **Ollama offline**: Kiểm tra `ollama serve` để đảm bảo Ollama service đang hoạt động.
- **Câu trả lời sai**: Reload KB, kiểm tra MD content & template.
- **Chậm > 15s**: Giảm `KB_QA_NUM_PREDICT`, kiểm tra model size phù hợp RAM.
- **Empty answer**: Mở rộng MD
```

### [P5_ai_engineer] Confusion matrix của mô hình hiện tại ra sao?

- intent=`general` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=6284ms score=**100%** depth=**0.7**
- depth breakdown: procedural=0.7, role=1, error=0.4, api=1, examples=0.4
- citations: feature/knowledge/features/ai/ai-performance.md (0.687), feature/knowledge/features/inspection/inspection-detail.md (0.649), feature/knowledge/features/products/product-machine-mapping.md (0.644)

```
### Tóm tắt

Trong tài liệu được cung cấp, confusion matrix của mô hình AI được hiển thị trên trang `/ai-performance` trong UI. Các thông tin này bao gồm số lượng True Positive (TP), False Positive (FP), False Negative (FN), và True Negative (TN). 

### Các bước làm việc

1. **Mở `/ai-performance`:**
   - Trong giao diện người dùng (UI), mở trang `/ai-performance` để xem 4 metric cards (Accuracy, Precision, Recall, F1) và confusion matrix.
   - Kết quả: Xem được thông tin về các chỉ số hiệu suất của mô hình AI.

2. **Xem confusion matrix:**
   - Trên trang `/ai-performance`, click vào phần confusion matrix để xem chi tiết.
   - Kết quả: Xem được số lượng TP, FP, FN, TN tương ứng với từng class trong mô hình.

### Lưu ý/lỗi thường gặp

- **Metrics = 0:** Nếu các chỉ số như Accuracy, Precision,

API liên quan: `/api/machines/:id/allowed-products`, `/api/inspection/:id/images`, `/api/measurement-point/:pointDefId/reference-image`, `/api/public/products/by-code/:code`
```

### [P5_ai_engineer] Hệ thống có phát hiện model drift không, theo metric nào?

- intent=`technical` lang=`vi` provider=`ollama` tool=`get_ng_compare` toolNote=`-` cit=5 latency=6668ms score=**100%** depth=**0.48**
- depth breakdown: procedural=0.4, role=1, error=0.4, api=0.4, examples=0.2
- citations: feature/knowledge/features/analytics/category-analytics.md (0.708), feature/knowledge/features/ai/ai-model-management.md (0.696), feature/knowledge/features/products/product-management.md (0.683)
- toolSummary: tháng này: NG 0/0 (0%). tháng trước: NG 0/0 (0%). Tỉ lệ NG không đổi 0 điểm % (+0% tương đối).

```
Theo ngữ cảnh được cung cấp, hệ thống không có thông tin cụ thể về việc phát hiện drift của model AI. Tuy nhiên, trong tài liệu liên quan đến tính năng Hiệu năng AI (AI Performance), có một số thông tin có thể giúp chúng ta hiểu hơn về các chỉ số hiệu suất mà hệ thống theo dõi:

- Hệ thống theo dõi các chỉ số như Accuracy, Precision, Recall và F1. Những chỉ số này được hiển thị trong 4 card metric.
- Confusion matrix cũng được hiển thị để xem xét phân loại của model.

Tuy nhiên, tài liệu không đề cập đến việc phát hiện drift hoặc sử dụng bất kỳ metric nào cụ thể để theo dõi drift của model AI. 

Để xác định liệu hệ thống có phát hiện drift hay không và theo dõi bằng metric nào, cần tìm hiểu thêm về tính năng này trong tài liệu liên quan đến Hiệu năng AI (AI Performance). Nếu thiếu thông tin, tôi sẽ chỉ ra rằng hệ thống không có thông tin chính xác về việc phát hiện

API liên quan: `/api/public/products/by-code/:code`
```

### [P5_ai_engineer] Cách chạy A/B testing giữa hai phiên bản model?

- intent=`how_to` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=8470ms score=**83%** depth=**0.56**
- depth breakdown: procedural=1, role=1, error=0, api=0.4, examples=0.4
- citations: feature/knowledge/features/ai/ai-model-management.md (0.689), feature/knowledge/features/products/product-management.md (0.681), feature/knowledge/features/ai/ai-model-management.md (0.679)

```
Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại. Để giúp bạn rõ hơn, tôi sẽ cung cấp một cách tổng quát để chạy A/B testing giữa hai phiên bản model AI trên nền tảng AVI/AOI.

### Cách chạy A/B Testing

1. **Tạo Mô hình mới và Version:**
   - Engineer tạo mô hình `PCB-Defect-Detector` với type ONNX, status `DRAFT`. Sau đó upload file v1.onnx 1.2GB.
   - Sau khi training, tạo version v2 với accuracy +3% → Activate v2.

2. **Tạo Mô hình mới:**
   - Engineer tạo mô hình mới với code khác và type ONNX, status `DRAFT`. Upload file v1.onnx 1.2GB.
   - Sau khi training, tạo version v3 với accuracy +3%.

3. **Lưu trữ các phiên bản:**
   - Lưu cả hai phiên bản (v2 và v3) vào hệ thống để có thể so sánh.

4. **Tạo Mô hình mới cho A/B Testing:**
   - Engineer tạo mô hình mới với code khác, type ONNX, status `DRAFT`. Upload file v1.onnx 1.2GB.
   - Sau khi training, tạo version v4 với accuracy +3%.

5. **Activate phiên bản mới cho A/B Testing:**
   - Activate version v4 để sử dụng trong quá trình A/B testing.

6. **Tạo Mô hình mới cho Control Group:**
   - Engineer tạo mô hình mới với code khác, type ONNX, status `DRAFT

API liên quan: `/api/public/products/by-code/:code
```

### [P5_ai_engineer] Active learning trong hệ thống hoạt động thế nào?

- intent=`general` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=5973ms score=**100%** depth=**0.34**
- depth breakdown: procedural=0.7, role=1, error=0, api=0, examples=0
- citations: feature/knowledge/features/ai/ai-active-learning.md (0.944), feature/knowledge/features/ai/ai-active-learning.md (0.851), feature/knowledge/features/analytics/annotation-statistics.md (0.735)

```
Trợ lý kỹ thuật AVI/AOI on-prem cho kỹ sư hoạt động theo cách sau:

1. **Tóm tắt**: Trong hệ thống này, Active Learning được triển khai dưới dạng một tính năng AI Active Learning trong menu AI → Active Learning. Người dùng có thể xem stats của queue mẫu cần gắn nhãn, review và đánh dấu các mẫu khó, đồng thời hệ thống sẽ đề xuất Retrain model khi cần thiết.

2. **Các bước**:
   - **Bước 1**: Mở trang `/ai-active-learning` để xem stats của queue mẫu cần gắn nhãn như số lượng mẫu trong queue, số mẫu đã được đánh dấu và độ chính xác.
   - **Bước 2**: Trong tab `Review Queue`, hệ thống sẽ hiển thị mẫu đầu tiên với hình ảnh, nhãn dự đoán và mức độ tin cậy. Người dùng có thể đồng ý hoặc không đồng ý với nhãn dự đoán, hoặc chọn nhãn đúng từ dropdown rồi submit.
   - **Bước 3**: Nếu mẫu khó, người dùng
```

### [P6_it_admin] Cách phân quyền cho một role mới?

- intent=`how_to` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=8208ms score=**83%** depth=**0.68**
- depth breakdown: procedural=1, role=1, error=0.7, api=0, examples=0.7
- citations: feature/knowledge/features/admin/role-management.md (0.721), feature/knowledge/features/admin/role-management.md (0.715), feature/knowledge/features/admin/permission-mgmt.md (0.649)

```
Để phân quyền cho một role mới trong hệ thống AVI/AOI, kỹ sư cần thực hiện các bước sau:

1. **Mở danh sách vai trò** — Truy cập vào `Admin` › `Roles & Permissions` › `Roles` trên màn hình `/admin/roles`.

2. **Tạo vai trò mới** — Nhấn + New Role để tạo một role mới. Nhập tên và mô tả cho vai trò, sau đó gán các permissions cần thiết.

3. **Gán permissions** — Trong tab Permissions, kỹ sư sẽ tìm thấy tree view theo resource → chọn từng action muốn cấp quyền cho role mới. 

4. **Save vai trò mới** — Sau khi đã cấu hình xong permissions, kỹ sư nhấn Save để lưu vai trò mới vào hệ thống.

5. **Gán cho User** — Sang trang Users và gán vai trò mới cho các user cần thiết thông qua việc assign vai trò.

Lưu ý/lỗi thường gặp:

- Nếu không thể xóa một role vì còn user được gán, kỹ sư cần tái phân quyền user trước.
- Nếu user không thấy menu mới sau khi tạo hoặc cập nhật vai trò, họ nên logout và login lại để hệ thống cập nhật cache permissions.

API liên quan:
```ts
// Tạo vai trò mới
tRPC: role.create({ name: 'quality-engineer-line-a', description: 'Role for quality engineer line A' })

// Gán permissions cho vai trò mới
tRPC: role.assignPermissions(roleId, [permissionIds])

// Gán vai trò 
```

### [P6_it_admin] MQTT broker chạy ở port nào và config ở đâu?

- intent=`general` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=6429ms score=**83%** depth=**0.52**
- depth breakdown: procedural=0.2, role=1, error=0, api=0.4, examples=1
- citations: feature/knowledge/features/monitoring/mqtt-client-mgmt.md (0.829), feature/knowledge/features/monitoring/mqtt-replay.md (0.793), feature/knowledge/features/monitoring/mqtt-dashboard.md (0.776)

```
MQTT broker của bạn đang chạy trên một cổng cụ thể, nhưng tài liệu không cung cấp thông tin cụ thể về cổng đó. Để xác định cổng mà MQTT broker đang chạy, bạn có thể cần xem cấu hình của hệ thống hoặc liên hệ với người quản lý hệ thống.

Tài liệu chỉ ra rằng cấu hình của MQTT broker được lưu trong môi trường `.env`. Bạn có thể truy cập file này để tìm thông tin về cổng mà MQTT broker đang sử dụng. Cụ thể, bạn sẽ cần xem biến `MQTT_BROKER_URL` hoặc bất kỳ biến khác liên quan đến cổng.

Ví dụ, nếu cấu hình của bạn như sau:

```env
MQTT_BROKER_URL="ws://localhost:1883"
```

Đó có nghĩa là MQTT broker đang chạy trên cổng 1883. 

Nếu không tìm thấy thông tin này trong `.env`, bạn cần kiểm tra các cấu hình khác hoặc liên hệ với người quản lý hệ thống để biết cổng cụ thể
```

### [P6_it_admin] Cách tích hợp SSO / OAuth với hệ thống?

- intent=`how_to` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=8594ms score=**83%** depth=**0.8**
- depth breakdown: procedural=1, role=1, error=0, api=1, examples=1
- citations: domain/knowledge/domain/howto-sso-oauth.md (0.833), domain/knowledge/domain/howto-sso-oauth.md (0.829), feature/knowledge/features/admin/user-management.md (0.617)

```
Để tích hợp SSO / OAuth với hệ thống AVI/AOI, bạn cần thực hiện các bước sau:

1. **Cấu hình Azure Entra ID**:
   - Trong Azure Portal, tạo ứng dụng mới và ghi lại `Application (client) ID` (`AZURE_CLIENT_ID`) và `Directory (tenant) ID` (`AZURE_TENANT_ID`).
   - Tạo client secret và ghi lại vào file `.env`.
   - Cấu hình API permissions cho Microsoft Graph với các permission: `openid`, `profile`, `email`, `User.Read`.

2. **Cấu hình Google Workspace**:
   - Trong file `.env`, cấu hình `SSO_PROVIDER=google` và cung cấp thông tin về `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, và `SSO_REDIRECT_URI`.

3. **Cấu hình OIDC chung (Keycloak / Okta / Authentik)**:
   - Cấu hình `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, và `SSO_REDIRECT_URI` trong file `.env`.
   - Hệ thống tự discovery thông qua `${OIDC_ISSUER_URL}/.well-known/openid-configuration`.

4. **Map role từ provider → role hệ thống**:
   - Cấu hình `SSO_ROLE_MAP_GROUP_CLAIM=groups` và `SSO_ROLE_MAP` cho các nhóm cụ thể.

5. **Quy trình đăng nhập SSO trên UI**:
   - Người dùng sẽ thấy nút "Đăng nhập với Microsoft / Google / SSO" khi mở trang login.
   - Trình duyệt sẽ redirect đến Id

API liên quan: `/api/auth/oidc/
```

### [P6_it_admin] Backup database định kỳ ở đâu?

- intent=`technical` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=7931ms score=**100%** depth=**0.68**
- depth breakdown: procedural=1, role=1, error=0, api=0.4, examples=1
- citations: feature/knowledge/features/admin/backup-restore.md (0.854), feature/knowledge/features/admin/backup-restore.md (0.751), domain/knowledge/domain/howto-backup-restore.md (0.678)

```
Backup database của hệ thống AVI/AOI Management được thực hiện ở `/backup/avi` trong thư mục dựa trên cấu hình trong `.env`. 

Các bước cụ thể để thực hiện backup database định kỳ như sau:

1. **Backup Database**:
   - Sử dụng lệnh `pg_dump` để sao lưu toàn bộ cơ sở dữ liệu Postgres.
   ```bash
   pg_dump -h localhost -U postgres -d avi_aoi_db -Fc -f /backup/avi_$(date +%F).dump
   ```
   Lưu ý rằng, trong cấu hình hiện tại, backup database được thực hiện bằng cách sử dụng `pg_dump` với tùy chọn `-Fc`, tạo ra một dump file nén (`-Fc`) và đặt tên dựa trên ngày hiện tại.

2. **Backup Files**:
   - Sử dụng lệnh `rsync` để sao lưu các tập tin trong thư mục `uploads/`.
   ```bash
   rsync -a --delete /apps/avi-aoi-management/uploads/ /backup/uploads/
   ```
   Lưu ý rằng, tùy thuộc vào cấu hình của hệ thống, backup file có thể được thực hiện bằng cách sử dụng lệnh `rsync` để sao lưu các tập tin trong thư mục `uploads/`.

3. **Backup Knowledge Base**:
   - Sử dụng lệnh `tar` để tạo một tệp ghi (`tar.gz`) chứa các tập tin trong thư mục `knowledge/`.
   ```bash
   tar -czf /backup/knowledge_$(date +%F).tar.gz -C /apps/avi-aoi-management knowledge/
   ```
   Lưu ý rằng, tùy thuộc vào cấu hì
```

### [P6_it_admin] Cách bật/tắt license bypass cho môi trường dev?

- intent=`how_to` lang=`vi` provider=`ollama` tool=`-` toolNote=`-` cit=5 latency=7616ms score=**100%** depth=**0.82**
- depth breakdown: procedural=0.7, role=1, error=1, api=0.4, examples=1
- citations: domain/knowledge/domain/howto-license-bypass-dev.md (0.949), domain/knowledge/domain/howto-license-bypass-dev.md (0.91), feature/knowledge/features/admin/license-mgmt.md (0.779)

```
Để bật hoặc tắt bypass license cho môi trường phát triển (dev), bạn cần thực hiện các bước sau:

### 1. Đặt biến môi trường

**Cách bật:**
```ini
NODE_ENV=development
LICENSE_BYPASS=true            # bỏ qua kiểm tra license
LICENSE_BYPASS_FEATURES=all    # bật toàn bộ feature flag
```

**Cách tắt:**
```ini
NODE_ENV=production
```

### 2. Sử dụng lệnh CLI

**Cách bật:**

```bash
cp license.lic.example license.lic
```

**Cách tắt:**

```bash
rm -f license.lic
```

### 3. Kiểm tra trạng thái

Để kiểm tra xem bypass đã được kích hoạt hay chưa, bạn có thể sử dụng lệnh sau:

```bash
curl http://localhost:3000/api/license/status
```

Hoặc mở trực tiếp trên UI: `Cài đặt › Hệ thống › License`.

### Lưu ý/lỗi thường gặp

- **Lỗi `LICENSE_INVALID_SIGNATURE`:** Nếu file license bị sửa hoặc tải sai, bạn cần xin lại file từ nhà cung cấp.
- **Lỗi `LICENSE_HOST_MISMATCH`:** Nếu MAC khác với MAC ký license, bạn cần kiểm tra interface chính và thay card mạng nếu cần.

### Liên quan

- [Hướng dẫn — License & bypass cho môi trường phát triển (dev)](knowledge/domain/howto-license-bypass-dev.md)
- [Quản lý License (part 1)](knowledge/features/admin/license-mgmt.md)
```
