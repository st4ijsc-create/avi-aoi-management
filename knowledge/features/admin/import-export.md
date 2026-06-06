# Import / Export Data

## Mục đích
Nhập (import) và xuất (export) dữ liệu hàng loạt: users, products, measurement points, machines, configs — phục vụ migration, bulk update và backup logic.

## Vị trí truy cập
- Menu: `Admin` › `Import / Export`
- URL: `/admin/import-export`
- Vai trò: admin

## Quyền yêu cầu
- Resource: `import_export`
- Actions: `import`, `export`
- Middleware: `requirePermission('admin_import_export')`

## Tiền điều kiện
- File CSV/Excel/JSON đúng schema (download template trước).

## Các bước thao tác
**Import**:
1. **Chọn entity** — Dropdown: Users / Products / Machines / Measurement Points / MQTT Clients...
2. **Download template** — Nút `Download Template` (CSV với header chuẩn).
3. **Fill data** — Edit Excel.
4. **Upload** — Nút `Upload`. Hệ thống parse + validate → preview bảng.
5. **Confirm** — Nếu validation pass, nhấn `Import`. Có option `Dry-run`.
6. **Xem log** — Bảng kết quả: success/fail per row, lý do fail.

**Export**:
1. **Chọn entity** + filter (date range, factory).
2. **Format**: CSV, Excel, JSON.
3. **Download**.

## Kết quả mong đợi
- Import: rows valid được insert, rows fail được skip với log chi tiết.
- Export: file download trực tiếp, encoding UTF-8 BOM cho Excel mở tiếng Việt OK.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Encoding garbled` | File CSV không UTF-8 | Save as `CSV UTF-8` |
| `Foreign key violation` | Reference không tồn tại | Import parent entity trước (vd factory trước line) |
| Import treo > 5 phút | File quá lớn | Chia file < 10,000 rows |

## API liên quan
- `POST /api/import/execute` (multipart) — body file + entity.
- `GET /api/export/execute?entity=...&format=...`.

## Tính năng liên quan
- [Quản lý Người dùng](../admin/user-management.md) — bulk import users.
- [Backup & Restore](../admin/backup-restore.md).

## Ví dụ thực tế
Tình huống: "Migration: import 200 product models từ Excel".
Bước: Entity `Products` → Download template → fill 200 rows → Upload → preview validation OK → Import → 198 success, 2 fail (duplicate code). Sửa 2 dòng → re-import.
