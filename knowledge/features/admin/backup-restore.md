# Backup & Restore

## Mục đích
Sao lưu định kỳ database (Postgres) và file storage (images, models), khôi phục về thời điểm cụ thể khi cần.

## Vị trí truy cập
- Menu: `Admin` › `Backup & Restore`
- URL: `/admin/backup`
- Vai trò: admin

## Quyền yêu cầu
- Resource: `backup`
- Actions: `view`, `create`, `restore`, `download`, `delete`
- Middleware: `requirePermission('admin_backup')`

## Tiền điều kiện
- Đã cấu hình `BACKUP_DIR` trong `.env`.
- (Tùy chọn) S3/Azure blob credentials cho remote backup.

## Các bước thao tác
1. **Manual Backup** — Nút `Backup Now`. Chọn:
   - Scope: `Database only` / `Files only` / `Full`.
   - Compression: gzip.
2. **Theo dõi tiến độ** — Bảng `Backups` hiện status `running → done`.
3. **Schedule auto-backup** — Tab `Schedule`: cron `0 2 * * *` (2h sáng), retention 30 ngày.
4. **Download** — Action `Download` → file `.tar.gz`.
5. **Restore** — Chọn backup → nút `Restore`. CONFIRM dialog 2 lần. Hệ thống stop services → restore → restart.
6. **Test restore** — Nút `Test Restore`: restore vào DB sandbox để verify integrity.

## Kết quả mong đợi
- Backup thành công với checksum SHA256 hợp lệ.
- Restore hoàn tất, hệ thống khởi động lại OK.
- Dung lượng < 30% memory database.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Backup fail "no space" | Disk đầy | Xóa backup cũ hoặc remote upload |
| Restore fail schema mismatch | Backup từ phiên bản DB cũ | Run migrations sau restore |
| Slow backup | DB lớn, single-thread `pg_dump` | Dùng parallel `pg_dump -j 4` |

## API liên quan
- `tRPC: backup.list / create / restore / download / delete / schedule`.

## Tính năng liên quan
- [License Management](../admin/license-mgmt.md) — restore cần license hợp lệ.
- [Audit Logs](../admin/audit-logs.md).

## Ví dụ thực tế
Tình huống: "Mỗi đêm backup full, giữ 30 ngày, upload lên S3".
Bước: Schedule full daily 02:00, retention 30. Cấu hình S3 credential. Sau 1 tuần, kiểm tra S3 có 7 file. Test restore bản gần nhất vào sandbox → OK → tin tưởng quy trình.
