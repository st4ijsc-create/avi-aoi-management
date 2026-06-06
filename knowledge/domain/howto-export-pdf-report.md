# Hướng dẫn — Xuất báo cáo PDF từ hệ thống AVI/AOI Management

> **Đối tượng**: trưởng ca, QA, quản lý nhà máy.
> **Module**: Báo cáo (Reports), Dashboard, Pareto NG, OEE.

## 1. Các loại báo cáo hỗ trợ xuất PDF

| Tên báo cáo | Đường dẫn | Nội dung |
|---|---|---|
| Báo cáo ca | `Menu › Báo cáo › Báo cáo ca` | OK/NG/NTF, FPY, top máy NG, top lỗi |
| Báo cáo NG theo lô | `Menu › Sản xuất › Lệnh sản xuất › chọn lô › Xuất PDF` | Tiến độ, NG-rate, ảnh sản phẩm NG |
| Pareto NG | `Menu › Báo cáo › Pareto NG` | Biểu đồ Pareto + bảng top 20 mã lỗi |
| OEE | `Menu › Báo cáo › OEE` | Availability / Performance / Quality / OEE theo máy |
| Bulletin chất lượng | `Menu › Báo cáo › Bulletin` | Tổng hợp tuần / tháng kèm khuyến nghị |

## 2. Các bước xuất PDF

1. Mở báo cáo cần xuất từ `Menu › Báo cáo`.
2. Chọn **bộ lọc**: ngày, ca, nhà máy/xưởng/line, sản phẩm.
3. Bấm nút **🖨 Xuất PDF** (góc phải trên cùng).
4. Hộp thoại xuất hiện, chọn:
   - **Trang giấy**: A4 mặc định (A3 cho biểu đồ Pareto rộng).
   - **Hướng**: dọc / ngang.
   - **Bao gồm ảnh defect**: bật nếu cần đính kèm ảnh NG (làm file nặng hơn ~5-20MB).
   - **Logo công ty**: tự động lấy từ `Cài đặt › Branding`.
5. Bấm **Tạo PDF**. Hệ thống sinh file ở backend (~2-10s tuỳ kích thước), sau đó tự động tải xuống.

## 3. Đặt tên file

Mẫu mặc định: `<ten_bao_cao>_<factory>_<YYYYMMDD>_<HHmm>.pdf`.

Ví dụ: `Bao_cao_ca_F01_20260511_1430.pdf`.

## 4. Xuất PDF qua API (tự động hoá)

```http
POST /api/reports/export
Content-Type: application/json
Cookie: <session>

{
  "reportType": "shift",          // shift | lot | pareto | oee | bulletin
  "format": "pdf",                // pdf | xlsx
  "filter": {
    "fromDate": "2026-05-11T00:00:00Z",
    "toDate":   "2026-05-11T08:00:00Z",
    "factoryCode": "F01",
    "lineCode":    "L01",
    "includeImages": true
  }
}
```

Phản hồi:

```json
{ "ok": true, "url": "/uploads/reports/Bao_cao_ca_F01_20260511_1430.pdf", "expiresIn": 3600 }
```

URL có hiệu lực 1 giờ, sau đó bị xoá tự động bởi cron dọn dẹp.

## 5. Lưu ý

- File PDF lưu tạm trong `uploads/reports/` 60 phút rồi tự xoá. Nếu muốn lưu vĩnh viễn, copy ra thư mục riêng.
- Báo cáo có ảnh defect dùng PNG nguyên gốc → kích thước có thể vượt 50MB. Khi gửi email, cân nhắc bật **"Nén ảnh"** trong hộp thoại xuất.
- Báo cáo PDF KHÔNG hỗ trợ tiếng Trung/Nhật — chỉ Tiếng Việt và Tiếng Anh (font Inter + Noto Sans Vietnamese).
- Để xuất cho nhiều ca/lô cùng lúc, dùng **Báo cáo định kỳ** (`Menu › Cài đặt › Báo cáo tự động`) — hệ thống gửi email PDF theo lịch.

## 6. Khắc phục sự cố

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `PDF generation timeout` | Báo cáo > 10.000 dòng hoặc > 500 ảnh | Thu hẹp khoảng thời gian, tắt "bao gồm ảnh defect" |
| Tiếng Việt bị vuông `□□□` | Font chưa load | Reload trang Ctrl+F5; nếu vẫn lỗi, báo admin kiểm tra `fonts/` trên server |
| Tải về 0 byte | Hết dung lượng `uploads/` | Admin chạy lệnh dọn `find uploads/reports -mtime +1 -delete` |

## 7. Liên kết

- Pareto NG: `howto-pareto-defects.md`.
- Bulletin: xem mục **Bulletin chất lượng** trong README module Báo cáo.
