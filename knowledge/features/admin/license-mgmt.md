# Quản lý License

## Mục đích
Quản lý license key của hệ thống AVI/AOI: xem giới hạn (số máy, số user, modules), gia hạn, kích hoạt offline, kiểm tra validity.

## Vị trí truy cập
- Menu: `Admin` › `License`
- URL: `/admin/license`
- Vai trò: admin

## Quyền yêu cầu
- Resource: `license`
- Actions: `view`, `update`
- Middleware: `requirePermission('admin_system')`

## Tiền điều kiện
- File license có sẵn: `license.lic` hoặc `license.lic.b64` ở root project.

## Các bước thao tác
1. **Xem trạng thái** — Card hiện: `Customer`, `Plan`, `Expires`, `Max Machines`, `Max Users`, `Modules enabled`.
2. **Upload license mới** — Nút `Upload .lic`. Chọn file → validate signature → apply.
3. **Activate online** — Nhập license key → server gọi licensing endpoint.
4. **Activate offline** — Generate machine fingerprint → gửi vendor → nhận file `.lic` → upload.
5. **Xem features available** — Tab `Modules`: list module on/off theo license.
6. **Cảnh báo expiry** — Banner đỏ khi < 30 ngày, hệ thống vẫn chạy nhưng cảnh báo.

## Kết quả mong đợi
- License hợp lệ → tất cả modules được phép hoạt động.
- License hết hạn → block thao tác create/update, vẫn cho view (degraded mode).

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Invalid signature` | File license bị sửa | Re-download từ vendor |
| `Machine count exceeded` | Vượt limit | Disable máy không dùng hoặc upgrade plan |
| Activate offline fail | Sai fingerprint | Generate lại bằng cùng host |

## API liên quan
- `tRPC: license.status / upload / activate / deactivate`.

## Tính năng liên quan
- [Backup & Restore](../admin/backup-restore.md).
- [Đăng ký Máy](../monitoring/machine-registration.md) — bị giới hạn theo license.

## Ví dụ thực tế
Tình huống: "License hết hạn 15 ngày nữa, banner cảnh báo hiện trên dashboard".
Bước: Liên hệ vendor mua gia hạn 1 năm → nhận `.lic` mới → upload → status update `Expires: 2027-01-15`. Banner biến mất.
