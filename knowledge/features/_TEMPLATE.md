# [Tên chức năng]

> Template chuẩn cho mỗi feature. Mỗi file 1 chức năng. Giữ thứ tự 10 mục dưới đây để chunker theo H2 hoạt động ổn định.

## Mục đích
Mô tả ngắn (1–3 câu) chức năng làm gì, giải quyết bài toán gì cho người dùng AVI/AOI.

## Vị trí truy cập
- Menu: `Menu chính` › `Submenu` › `Tên mục`
- URL: `/path/...`
- Vai trò thấy menu: admin, manager, engineer, operator …

## Quyền yêu cầu
- Resource: `xxx`
- Actions cần thiết: `view`, `create`, `update`, `delete`, …
- Middleware: `requirePermission('xxx:action')`

## Tiền điều kiện
Liệt kê dữ liệu/cấu hình phải có trước khi dùng (vd: phải tạo Factory trước, phải gán Machine trước…).

## Các bước thao tác
1. **[Hành động]** — Vào menu X › Y, nhấn nút `Z`.
   - Trường nhập: `field1` (bắt buộc), `field2` (tùy chọn, mặc định `…`).
   - UI hiển thị: dialog/sidebar/inline form.
2. **[Hành động tiếp]** — …
3. **[Lưu / Xác nhận]** — Nhấn `Save`. Hệ thống gọi API và hiển thị toast `…`.

## Kết quả mong đợi
- Record xuất hiện trong bảng `…`.
- Trạng thái chuyển từ `…` → `…`.
- (Nếu có) sự kiện được phát ra MQTT topic `…` hoặc job nền `…` được trigger.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Toast "…" | … | … |
| Nút bị ẩn | Thiếu quyền `…` | Liên hệ admin gán role |

## API liên quan
- `GET /api/...` — mô tả ngắn.
- `POST /api/...` — body, response.

## Tính năng liên quan
- [Tên feature 1](feature-1.md) — vì sao liên quan.
- [Tên feature 2](feature-2.md) — …

## Ví dụ thực tế
Tình huống: "Tổ trưởng line A muốn …".
Các bước cụ thể với dữ liệu mẫu (giá trị field cụ thể, kết quả thực).
