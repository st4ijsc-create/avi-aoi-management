# Phân tích Pareto NG — Hướng dẫn

> **Đối tượng**: QA, kỹ sư cải tiến, trưởng line.

## 1. Khái niệm

Biểu đồ Pareto sắp xếp **các loại lỗi NG theo tần suất giảm dần**, kèm đường tích lũy %. Mục tiêu: xác định *Vital Few* (≈ 20 % loại lỗi) gây ra 80 % NG để tập trung khắc phục.

## 2. Đường dẫn

`Menu › Báo cáo chất lượng › Pareto NG`.

Hoặc trực tiếp từ AI Assistant: hỏi *"top lỗi 7 ngày qua"* (gọi tool `get_top_defects`).

## 3. Bộ lọc

| Bộ lọc | Mặc định | Ghi chú |
|--------|----------|---------|
| Khoảng thời gian | 7 ngày | 1, 7, 30, hoặc tùy chọn. |
| Line / máy | Tất cả | Chọn line cụ thể để zoom. |
| Sản phẩm | Tất cả | Lọc theo SKU. |
| Mức độ (severity) | Tất cả | `critical`, `major`, `minor`. |

## 4. Cách đọc biểu đồ

- **Cột (trái)**: số lượng NG cho từng `defect_code`.
- **Đường (phải)**: % tích lũy.
- Vạch đỏ ở mức **80 %** đánh dấu ranh giới Vital Few / Trivial Many.
- Hover cột để xem: count, % tỷ lệ, ví dụ ảnh defect.

## 5. Hành động đề xuất

| Tình huống | Hành động |
|-----------|-----------|
| 1 mã lỗi chiếm > 40 % | Mở RCA ngay (Fishbone / 5-Why). |
| Top 3 mã lỗi cùng line | Audit cấu hình điểm đo của line đó. |
| Mã lỗi tăng đột biến tuần này so với tuần trước | Kiểm tra: lô nguyên liệu mới? Đổi ca? Ngưỡng AI vừa thay đổi? |

## 6. Tham số kỹ thuật

- Nguồn dữ liệu: bảng `inspection_defects` + `defect_catalog`.
- Truy vấn theo `inspectedAt BETWEEN :from AND :to`, group by `defect_code`.
- Cache: 5 phút.
