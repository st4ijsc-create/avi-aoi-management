# SOP — Xử lý sản phẩm NG (Not Good) tại line AOI

> **Đối tượng**: công nhân vận hành, trưởng line, QA inline.
> **Module liên quan**: Sản xuất → AOI Inspection, Quản lý lỗi (Defect Catalog), Báo cáo chất lượng.

## 1. Mục đích

Quy trình chuẩn để xử lý sản phẩm bị máy AOI báo lỗi (NG) nhằm:

- Không để sản phẩm NG lọt sang công đoạn sau.
- Ghi nhận đầy đủ dữ liệu lỗi để truy xuất nguyên nhân (RCA) và tính KPI NG-rate / FPY.
- Cho phép phục hồi (rework) hoặc loại bỏ (scrap) đúng phân loại.

## 2. Khi nào áp dụng

Áp dụng ngay khi:

1. Đèn báo NG trên máy AOI bật, hoặc
2. Trên giao diện *AOI Live View* hiển thị badge **NG** ở khung sản phẩm vừa quét, hoặc
3. Quản lý lô báo NG-rate vượt ngưỡng cảnh báo (mặc định ≥ 5 % trong 30 phút).

## 3. Đường dẫn trên hệ thống

`Menu › Sản xuất › AOI Inspection › chọn line đang chạy › tab "Sản phẩm NG"`

Hoặc từ Dashboard: thẻ **NG hôm nay** → click số lượng NG để mở danh sách.

## 4. Các bước thực hiện

| Bước | Vai trò | Thao tác |
|------|---------|----------|
| 1 | Công nhân | Lấy sản phẩm khỏi băng tải, đặt vào khay đỏ "Chờ phân loại". Quét lại mã QR/barcode. |
| 2 | Công nhân | Trên màn hình AOI: chọn sản phẩm NG → bấm **"Xem ảnh defect"** để xác nhận lỗi thật/giả. |
| 3a | Công nhân | Nếu **lỗi giả** (false call): bấm **"Đánh dấu false call"** → ghi lý do (vd. nhiễu sáng, bụi). Sản phẩm trở lại OK. |
| 3b | QA inline | Nếu **lỗi thật**: chọn **mã lỗi** từ Defect Catalog (vd. `MISS-COMP`, `WRONG-POL`, `SOLDER-BRIDGE`). Nhập ghi chú nếu cần. |
| 4 | QA inline | Quyết định hướng xử lý: **Rework** (sửa lại) hoặc **Scrap** (loại bỏ). Bấm nút tương ứng. |
| 5 | Hệ thống | Tự động cập nhật lô: tăng `ngCount`, tính lại `ngRate`, ghi log audit. |
| 6 | Trưởng line | Khi NG-rate ≥ ngưỡng, mở tab **Pareto NG** để xem top lỗi và phân công RCA. |

## 5. Lưu ý quan trọng

- **Không bỏ qua bước chọn mã lỗi.** Sản phẩm NG chưa gán mã lỗi sẽ KHÔNG được tính vào báo cáo Pareto / SPC.
- **False call** vẫn được ghi log nhưng không tính vào NG-rate; nếu false-call rate > 10 % cần kiểm tra lại điểm đo / ngưỡng AI.
- Trường hợp máy AOI không thể kết nối DB (badge ⚠️ DB_UNAVAILABLE), thao tác vẫn được ghi vào hàng đợi local và đồng bộ sau khi DB phục hồi.

## 6. Tham số kỹ thuật

- `ngRate` = `ngCount / inspectedCount × 100 %`, refresh mỗi 60 giây.
- Ngưỡng cảnh báo mặc định 5 % (cấu hình tại `Cài đặt › Cảnh báo NG`).
- Mã lỗi nằm trong bảng `defect_catalog` (`code`, `name_vi`, `severity`, `category`).

## 7. Liên kết

- SOP đổi ca: `howto-shift-change.md`.
- Pareto NG: `howto-pareto-defects.md`.
- SPC UCL/LCL: `howto-spc-control.md`.
