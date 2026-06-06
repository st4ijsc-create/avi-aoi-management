# Quản lý Phiên (Session Management)

## Mục đích
Theo dõi và quản lý các phiên đăng nhập đang hoạt động, force logout user khi cần, hạn chế concurrent session per user.

## Vị trí truy cập
- Menu: `Admin` › `Sessions`
- URL: `/admin/sessions`
- Vai trò: admin

## Quyền yêu cầu
- Resource: `session`
- Actions: `view`, `revoke`
- Middleware: `requirePermission('admin_sessions')`

## Tiền điều kiện
- Session storage cấu hình (cookie + DB hoặc Redis).

## Các bước thao tác
1. **Mở danh sách** — Bảng `username`, `loginAt`, `lastActivity`, `ip`, `userAgent`, `expiresAt`.
2. **Filter** — Active only / All, theo user.
3. **Revoke session** — Action `Revoke`: invalidate cookie, user buộc login lại.
4. **Bulk revoke** — Multi-select khi cần kick toàn bộ user (sau security incident).
5. **Settings** — Cấu hình `SESSION_TTL`, `MAX_CONCURRENT_SESSIONS_PER_USER`.
6. **Audit** — Mọi revoke ghi audit.

## Kết quả mong đợi
- Revoke có hiệu lực ngay lập tức (next request → 401).
- Inactive sessions tự xóa theo TTL.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| User vẫn login được sau revoke | Browser cache cookie | Hard refresh hoặc `Clear-Site-Data` header |
| Quá nhiều session | Bot login lặp | Set max concurrent + rate limit |

## API liên quan
- `tRPC: session.list / revoke / revokeAllForUser`.

## Tính năng liên quan
- [Quản lý Người dùng](../admin/user-management.md).
- [Audit Logs](../admin/audit-logs.md).

## Ví dụ thực tế
Tình huống: "Nhân viên `op_an` nghỉ việc, cần kick toàn bộ session ngay".
Bước: Disable user trong User Management. Vào Sessions → filter user `op_an` → 2 session đang active → Bulk revoke. Verify: user thử reload trang → bật về login.
