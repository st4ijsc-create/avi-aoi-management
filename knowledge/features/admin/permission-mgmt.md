# Quản lý Quyền (Permission Management)

## Mục đích
Xem danh sách tất cả permissions có sẵn trong hệ thống (resource × action) và kiểm tra quyền của user hiện tại — công cụ tham khảo khi xây role.

## Vị trí truy cập
- Menu: `Admin` › `Roles & Permissions` › `Permissions`
- URL: `/admin/permissions`
- Vai trò: admin

## Quyền yêu cầu
- Resource: `permission`
- Actions: `view`
- Middleware: `requirePermission('admin_permissions')`

## Tiền điều kiện
- Đã chạy migration permissions (`migrate-permissions.mjs`).

## Các bước thao tác
1. **Mở danh sách** — Tree view group theo resource: `dashboard`, `inspection`, `machine`, `mqtt`, `analytics`, `ai`, `admin`...
2. **Xem chi tiết** — Click resource → list actions kèm description.
3. **Filter** — Search box theo tên permission key (vd `mqtt_replay`).
4. **Xem My Permissions** — Tab `My Permissions`: liệt kê permissions của user hiện tại.
5. **Check user permission** — Nhập username + permission key → hệ thống trả `allow/deny` + role nào cấp.
6. **Export** — CSV để audit hoặc thiết kế role.

## Kết quả mong đợi
- Tree đầy đủ các resource module.
- "My Permissions" trùng với menu/UI user thấy.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Permission mới không xuất hiện | Migration chưa chạy | `node migrate-permissions.mjs` |
| User có permission nhưng không thấy menu | Frontend cache | Hard reload (Ctrl+F5) |

## API liên quan
- `tRPC: permission.list` — tất cả.
- `tRPC: permission.getMyPermissions` — của user hiện tại.
- `tRPC: permission.check` — input `{ userId, permission }`.

## Tính năng liên quan
- [Vai trò](../admin/role-management.md).
- [Quản lý Người dùng](../admin/user-management.md).
- [Audit Logs](../admin/audit-logs.md).

## Ví dụ thực tế
Tình huống: "Operator báo không thấy menu MQTT Replay".
Bước: Permissions → Check user `op_an` permission `mqtt_replay` → result `deny`. Vào Roles → role `operator` không có. Quyết định: tạo role `operator-senior` có quyền này, gán cho op_an.
