# Quản lý Workstation

## Mục đích
Quản lý các máy trạm (workstation) nơi operator thao tác — gán cho line, gán cho operator, theo dõi trạng thái online/offline.

## Vị trí truy cập
- Menu: `Monitoring` › `Workstations`
- URL: `/workstations`
- Vai trò: admin, manager, engineer

## Quyền yêu cầu
- Resource: `workstation`
- Actions: `view`, `create`, `update`, `assign`
- Middleware: `requirePermission('analytics_workstation')`

## Tiền điều kiện
- Đã định nghĩa Factory > Line trong Corporate Layout.
- Có user role `operator` để gán.

## Các bước thao tác
1. **Mở danh sách** — Bảng `name`, `code`, `line`, `assignedOperator`, `status`, `lastHeartbeat`.
2. **Thêm Workstation** — Nút `+ New`. Nhập `code`, `name`, chọn `Line`, IP máy.
3. **Gán Operator** — Action `Assign Operator`, chọn user có role operator.
4. **Cấu hình permissions** — Định nghĩa workstation có quyền truy cập module nào (vd: chỉ Inspection + Alerts).
5. **Theo dõi** — Cột `status` = online (heartbeat < 60s) / offline.
6. **Disable/Delete** — Action menu khi cần ngừng dùng.

## Kết quả mong đợi
- Bản ghi `workstations` với `enabled=true`.
- Workstation đăng nhập từ IP đó tự nhận identity.
- Heartbeat update mỗi 30s.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Status luôn offline | Agent workstation chưa cài | Cài agent + cấu hình `WORKSTATION_CODE` |
| Operator không login được | Chưa gán operator | Action Assign Operator |
| IP trùng | Đã có workstation cùng IP | Đổi IP hoặc disable cái cũ |

## API liên quan
- `tRPC: workstation.list / create / update / assign`.
- `POST /api/workstation/heartbeat` — agent gọi mỗi 30s.

## Tính năng liên quan
- [Quản lý Người dùng](../admin/user-management.md) — operator account.
- [Cấu trúc tổ chức](../corporate/corporate-layout.md) — Line.

## Ví dụ thực tế
Tình huống: "Line A có 3 trạm operator, mỗi trạm 1 máy tính".
Bước: Tạo 3 workstation `LA-WS01`, `LA-WS02`, `LA-WS03`, gán Line A. Gán operator `op_an`, `op_binh`, `op_chau`. Cài agent trên 3 máy. Sau 1 phút thấy cả 3 online.
