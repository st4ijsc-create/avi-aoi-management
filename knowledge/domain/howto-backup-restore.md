# SOP — Sao lưu & phục hồi dữ liệu hệ thống AVI/AOI Management

> **Đối tượng**: quản trị viên hệ thống (admin), kỹ sư DevOps on-prem.
> **Phạm vi**: Postgres database, thư mục ảnh `uploads/`, thư mục `knowledge/`, file `.env`.
> **Tần suất khuyến nghị**: full backup hằng ngày 02:00, retention 14 ngày.

## 1. Mục đích

- Đảm bảo phục hồi RPO ≤ 24h, RTO ≤ 1h khi sự cố hỏng đĩa, lỗi nâng cấp, hoặc xoá nhầm dữ liệu.
- Giữ lịch sử ảnh kiểm tra phục vụ truy xuất chất lượng (ít nhất 90 ngày trên đĩa nóng).

## 2. Thành phần cần backup

| Thành phần | Đường dẫn / nguồn | Cách backup |
|---|---|---|
| PostgreSQL database `avi_aoi_db` | localhost:5432 | `pg_dump -Fc` |
| Ảnh kiểm tra & ảnh mẫu | `uploads/` (server) hoặc S3 bucket cấu hình trong `.env` | `rsync` hoặc `aws s3 sync` |
| Knowledge base | `knowledge/` (chứa `chunks.json`, `embeddings.bin`, `graph.jsonl`) | `tar` |
| Cấu hình môi trường | `.env`, `license.lic` | copy qua kênh bảo mật, KHÔNG đưa lên git |

## 3. Quy trình backup hằng ngày (Linux/WSL)

```bash
# 1. Database — full custom dump (nén)
pg_dump -h localhost -U postgres -d avi_aoi_db -Fc -f /backup/avi_$(date +%F).dump

# 2. Uploads — incremental
rsync -a --delete /apps/avi-aoi-management/uploads/ /backup/uploads/

# 3. Knowledge base
tar -czf /backup/knowledge_$(date +%F).tar.gz -C /apps/avi-aoi-management knowledge/

# 4. Config (1 lần / khi thay đổi)
cp /apps/avi-aoi-management/.env       /backup/config/.env.$(date +%F)
cp /apps/avi-aoi-management/license.lic /backup/config/license.lic.$(date +%F)
```

Đặt vào `cron`:

```
0 2 * * *  /opt/scripts/avi-backup.sh >> /var/log/avi-backup.log 2>&1
```

## 4. Quy trình backup trên Windows (PowerShell)

```powershell
$date = Get-Date -Format yyyy-MM-dd
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" `
  -h localhost -U postgres -d avi_aoi_db -Fc `
  -f "D:\backup\avi_$date.dump"

robocopy C:\Apps\avi-aoi-management\uploads D:\backup\uploads /MIR
Compress-Archive -Path C:\Apps\avi-aoi-management\knowledge -DestinationPath "D:\backup\knowledge_$date.zip" -Force
```

## 5. Phục hồi (Restore)

> **Cảnh báo**: Restore sẽ ghi đè dữ liệu hiện có. Luôn dừng dịch vụ trước.

```bash
# 1. Dừng app
pm2 stop avi-aoi  ||  systemctl stop avi-aoi

# 2. Drop & tạo lại database (nếu hỏng nặng)
psql -U postgres -c 'DROP DATABASE IF EXISTS avi_aoi_db;'
psql -U postgres -c 'CREATE DATABASE avi_aoi_db;'

# 3. Restore từ dump
pg_restore -h localhost -U postgres -d avi_aoi_db --no-owner --clean /backup/avi_2026-05-10.dump

# 4. Khôi phục uploads
rsync -a /backup/uploads/ /apps/avi-aoi-management/uploads/

# 5. Khôi phục knowledge base
tar -xzf /backup/knowledge_2026-05-10.tar.gz -C /apps/avi-aoi-management/

# 6. Khởi động lại
pm2 start avi-aoi
```

## 6. Kiểm tra sau restore

1. Mở `http://<server>:3000/api/health` → trả `{"ok":true}`.
2. Đăng nhập `admin / admin123`. Vào *Dashboard* xem số liệu hôm qua khớp với báo cáo trước backup.
3. Mở *AOI Inspection* xem ảnh sản phẩm hiển thị đúng.
4. Mở *Trợ lý AI* (chat AI Assistant) hỏi "tổng sản lượng hôm nay" → phải trả lời từ DB thực.

## 7. Lưu ý quan trọng

- **KHÔNG** dùng `pg_dump -Fp` (plain SQL) cho DB lớn (>5GB) — chậm gấp 3-5 lần khi restore.
- File `license.lic` là license on-prem, gắn với MAC address máy chủ. Khi restore sang máy khác phải xin lại license mới.
- KB (`knowledge/`) có thể tái tạo bằng `node scripts/build-knowledge-base.mjs` — không bắt buộc backup nhưng nên giữ để tiết kiệm 5-10 phút khi phục hồi.
- Postgres user `postgres` trong môi trường demo có mật khẩu `sa123@`. Production phải đổi và lưu vào secret manager.

## 8. Liên kết

- Cấu hình môi trường: xem mục 4 trong `AI_ANALYTICS_MODULE_AUDIT.md`.
- Kiểm tra license: `howto-license-bypass-dev.md` (chỉ áp dụng môi trường dev).
