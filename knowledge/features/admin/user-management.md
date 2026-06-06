# Quản lý Người dùng

## Mục đích
Quản lý tài khoản user trong hệ thống AVI/AOI: tạo, sửa, vô hiệu hóa, gán role, reset password, gán factory/line/shift.

## Vị trí truy cập
- Menu: `Admin` › `Users`
- URL: `/admin/users`
- Vai trò: admin

## Quyền yêu cầu
- Resource: `user`
- Actions: `view`, `create`, `update`, `delete`, `resetPassword`
- Middleware: `requirePermission('admin_users')`

## Tiền điều kiện
- Có ít nhất 1 admin account khởi tạo (mặc định `admin/admin123`).
- Đã định nghĩa Roles trước (xem Role Management).

## Các bước thao tác
1. **Mở danh sách** — Bảng `username`, `fullName`, `email`, `roles`, `factory`, `enabled`, `lastLogin`.
2. **+ New User** — Form:
   - `Username` (unique, lowercase).
   - `Full name`, `Email`, `Phone`.
   - `Password` ban đầu (force change at first login).
   - `Roles` (multi-select).
   - `Factory/Line` scope (optional, hạn chế dữ liệu user thấy được).
   - `Shift` (optional, cho operator).
3. **Save** — Insert `users` + `user_roles`.
4. **Edit / Reset password / Disable** — Action menu mỗi hàng.
5. **Bulk import** — Upload CSV `username,fullName,email,role`.
6. **Audit** — Mọi thao tác ghi `audit_logs`.

## Kết quả mong đợi
- User login được với tài khoản mới.
- Password lưu hash bcrypt.
- Disabled user không login được nhưng record vẫn còn.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Username already exists` | Trùng | Đổi username |
| User login OK nhưng không thấy menu | Thiếu role | Edit → gán role |
| Password reset email không tới | SMTP chưa cấu hình | Set up SMTP, hoặc reset thủ công |

## API liên quan
- `tRPC: user.list / create / update / delete / resetPassword / bulkImport`.

## Tính năng liên quan
- [Vai trò](../admin/role-management.md).
- [Quyền hạn](../admin/permission-mgmt.md).
- [Phiên đăng nhập](../admin/session-mgmt.md).
- [Audit Logs](../admin/audit-logs.md).

## Ví dụ thực tế
Tình huống: "Tuyển 5 operator mới cho line A ca sáng".
Bước: Bulk import CSV 5 hàng với role `operator`, factory `F1`, line `Line A`, shift `Ca Sáng`. Sau import, mỗi user nhận username/password tạm. Login lần đầu bắt đổi password.
