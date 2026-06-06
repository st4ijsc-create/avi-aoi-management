# SPC — Đường UCL / LCL / Cpk

> **Đối tượng**: kỹ sư chất lượng, kỹ sư quy trình.

## 1. Khái niệm

SPC (Statistical Process Control) theo dõi quá trình bằng biểu đồ kiểm soát **X-bar / R** hoặc **I-MR**. Các đường chính:

- **CL** (Center Line): trung bình mẫu.
- **UCL / LCL**: giới hạn kiểm soát trên/dưới = `mean ± 3·σ`.
- **USL / LSL**: giới hạn kỹ thuật của khách hàng (specification limits, KHÁC UCL/LCL).
- **Cp = (USL − LSL) / (6·σ)** — khả năng quá trình (process capability).
- **Cpk = min((USL − μ)/(3σ), (μ − LSL)/(3σ))** — Cp có tính lệch tâm. Cpk ≥ 1.33 là yêu cầu thường gặp.

## 2. Đường dẫn

`Menu › Chất lượng › SPC` → chọn **sản phẩm** + **điểm đo** → hệ thống vẽ biểu đồ kiểm soát theo thời gian.

## 3. Cách đọc biểu đồ

- Điểm trong UCL/LCL → quá trình ổn định.
- **Điểm vượt UCL/LCL** → cảnh báo, kiểm tra ngay (tool wear, nguyên liệu khác, đổi ca).
- **Quy tắc Western Electric** áp dụng để cảnh báo sớm:
  1. 1 điểm ngoài 3σ.
  2. 2/3 điểm liên tiếp ngoài 2σ cùng phía.
  3. 4/5 điểm ngoài 1σ cùng phía.
  4. 8 điểm liên tiếp cùng phía CL.

## 4. Cấu hình ngưỡng

`Menu › Sản phẩm › chọn SKU › tab "Điểm đo" › cột UCL / LCL / USL / LSL`.

> Hệ thống KHÔNG tự sinh UCL/LCL từ dữ liệu lịch sử mặc định. Kỹ sư phải nhập, hoặc bấm **"Tính từ N mẫu gần nhất"** (mặc định N=30).

## 5. Cảnh báo SPC

Khi vi phạm rule, hệ thống:

1. Tô đỏ điểm vi phạm.
2. Push notification cho `quality_engineer` role.
3. Ghi vào `spc_violations` log.

## 6. Tham số kỹ thuật

- Refresh: 1 phút (live charts).
- Subgroup size mặc định = 5.
- Cpk được tính lại mỗi 100 mẫu mới.
- Lưu ý: nếu thấy Cpk = 1.33 không đổi cho mọi sản phẩm → **CẢNH BÁO**: hệ thống có thể đang dùng giá trị cứng (xem audit `AI_ANALYTICS_MODULE_AUDIT.md`).

## 7. Liên kết

- Cấu hình điểm đo: `PRODUCTS_MEASUREMENT_POINTS_P1_DELIVERABLE.md` (đã được ingest vào KB).
