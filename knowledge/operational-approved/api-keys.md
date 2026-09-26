---
trang_thai: da_duyet
nguon: AI sinh tu ma nguon — CHU DU AN DA DUYET 2026-08-17
sinh_luc: 2026-08-17
route: /api-keys
permission: admin_system
role: [admin]
module: CORE_ADMIN
license: CORE
nguoi_duyet: chu du an
ngay_duyet: 2026-08-17
do_day: day_du
o_trong: 2
---

> **THẺ VẬN HÀNH — ĐÃ DUYỆT** (chủ dự án, 2026-08-17). Dùng được làm căn cứ vận hành.
> Dòng nào ghi **CHƯA GHI LẠI** là quy trình nhà máy **chưa có tài liệu** — khi được hỏi đúng chỗ đó
> hãy trả lời thẳng là *chưa được ghi lại*, không suy đoán và không thay bằng tài liệu kỹ thuật nội bộ.

# Khoá API — xử lý sự cố & thao tác

## Thông tin đã xác minh từ mã nguồn
- **Đường dẫn**: `/api-keys`
- **Menu**: Quản trị › Khoá API
- **Quyền yêu cầu**: `admin_system`
- **Vai trò giới hạn**: admin
- **Module / license**: `CORE_ADMIN` — CORE (luôn bật)
- **Router tRPC**: `apiKeyRouter` (server/routers/apiKeyRouter.ts, ~6 thủ tục)
- **Thao tác có thật ở backend**: `scopes`, `list`, `create`, `update`, `revoke`, `delete`

## Triệu chứng thường gặp

- Máy/hệ thống ngoài gọi API bị từ chối.
- Không rõ khoá nào đang được dùng bởi thiết bị nào.

## Nguyên nhân thường gặp

- Khoá hết hạn hoặc đã bị thu hồi.
- Khoá đúng nhưng thiếu phạm vi quyền cho endpoint đang gọi.
- Màn hình cần quyền `admin_system`.

## Các bước xử lý

- Mở `/api-keys`, đối chiếu khoá mà thiết bị đang dùng với danh sách còn hiệu lực.
- Cấp khoá mới nếu cần và cập nhật vào cấu hình thiết bị; thu hồi khoá cũ SAU khi thiết bị đã chạy bằng khoá mới.
- ⬜ **CHƯA GHI LẠI** — chu kỳ xoay khoá bắt buộc tại tổ chức này
- ⬜ **CHƯA GHI LẠI** — sổ đăng ký khoá ↔ thiết bị được giữ ở đâu

## Cách xác nhận đã xong

- Thiết bị gọi API thành công bằng khoá mới.
- Khoá cũ đã thu hồi và không còn lần gọi nào dùng nó.
