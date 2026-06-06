# Quản lý Vai trò (Role Management)

## Mục đích
Định nghĩa các vai trò (role) trong hệ thống và bộ quyền (permissions) của từng role — RBAC linh hoạt cho phép tạo role tùy chỉnh ngoài role mặc định (admin, manager, engineer, operator).

## Vị trí truy cập
- Menu: `Admin` › `Roles & Permissions` › `Roles`
- URL: `/admin/roles`
- Vai trò: admin

## Quyền yêu cầu
- Resource: `role`
- Actions: `view`, `create`, `update`, `delete`
- Middleware: `requirePermission('admin_roles')`

## Tiền điều kiện
- Đã hiểu tập permissions có sẵn (xem Permission Management).

## Các bước thao tác
1. **Mở danh sách** — Bảng `name`, `description`, `userCount`, `permissionCount`, `system` (flag không cho xóa).
2. **+ New Role** — Nhập `name` (unique), `description`.
3. **Gán Permissions** — Tab `Permissions`: tree view theo resource → check box từng action.
4. **Clone từ role có sẵn** — Action `Clone` để bắt đầu nhanh.
5. **Save** — Insert `user_roles` + `role_permissions`.
6. **Gán cho User** — Sang trang Users → assign.
7. **Delete** — Chỉ xóa được nếu `userCount=0` và không phải system role.

## Kết quả mong đợi
- Role mới xuất hiện trong dropdown khi tạo user.
- Permissions có hiệu lực ngay sau khi user re-login.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Không xóa được role | Còn user gán | Reassign user trước |
| User không thấy menu mới | Cache permissions | Logout/login lại |
| Quá nhiều role tương tự | Thiếu chuẩn hóa | Consolidate, dùng template |

## API liên quan
- `tRPC: role.list / create / update / delete / clone`.
- `tRPC: role.assignPermissions`.

## Tính năng liên quan
- [Quản lý Quyền](../admin/permission-mgmt.md).
- [Quản lý Người dùng](../admin/user-management.md).

## Ví dụ thực tế
Tình huống: "Tạo role `quality-engineer-line-a` chỉ thấy line A và quyền approve quality gate".
Bước: New role, clone từ `quality-engineer`. Customize: chỉ giữ permissions analytics, quality_gate. Set scope `Line A` (qua user assignment). Gán cho 2 user QE.
