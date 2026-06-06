# Audit Logs

## Mục đích
Ghi và truy vấn nhật ký mọi thao tác quan trọng trong hệ thống (login, CRUD, override, config change) phục vụ điều tra, compliance và bảo mật.

## Vị trí truy cập
- Menu: `Admin` › `Audit Logs`
- URL: `/admin/audit-logs` và `/admin/enhanced-audit-logs`
- Vai trò: admin, security-officer

## Quyền yêu cầu
- Resource: `audit`
- Actions: `view`, `search`, `export`
- Middleware: `requirePermission('admin_audit')`

## Tiền điều kiện
- Audit middleware đã enable (mặc định: on).
- Bảng `audit_logs` không bị purge sớm (giữ tối thiểu 90 ngày).

## Các bước thao tác
1. **Mở danh sách** — Bảng `timestamp`, `user`, `action`, `resource`, `resourceId`, `ip`, `result`, `details`.
2. **Filter nâng cao** — Date range, user, resource type, action (create/update/delete/login), result (success/fail).
3. **Search full-text** — Tìm trong `details` JSON.
4. **Xem chi tiết** — Click row → modal hiện `before`/`after` payload (cho update).
5. **Enhanced view** — Tab `/enhanced-audit-logs` có timeline, group by session.
6. **Export** — CSV/JSON cho compliance.
7. **Retention setting** — Admin có thể đặt `AUDIT_RETENTION_DAYS`.

## Kết quả mong đợi
- Mọi action quan trọng đều log < 100ms latency.
- Search theo index (user, timestamp) trả < 1s với 1M records.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Log thiếu | Action không gọi audit middleware | Thêm `auditLog()` ở route |
| Search chậm | Bảng lớn, thiếu index | Tạo index trên `timestamp`, `userId` |
| Disk đầy | Retention quá dài | Giảm `AUDIT_RETENTION_DAYS` |

## API liên quan
- `tRPC: audit.list / search / export`.
- Internal: `auditLog({userId, action, resource, before, after})`.

## Tính năng liên quan
- [Quản lý Người dùng](../admin/user-management.md).
- [Phiên đăng nhập](../admin/session-mgmt.md).

## Ví dụ thực tế
Tình huống: "Điều tra vì sao quality gate `PCB-A pre-pack` bị force open lúc 23h".
Bước: Audit Logs → filter resource `quality_gate`, action `force_open`, date hôm qua → 1 record: user `manager_b`, lý do `urgent shipment`, IP `10.0.5.12`. Confirm + email manager để follow.
