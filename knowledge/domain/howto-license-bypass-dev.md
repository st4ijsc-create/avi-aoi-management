# Hướng dẫn — License & bypass cho môi trường phát triển (dev)

> **Đối tượng**: developer, kỹ sư QA chạy môi trường dev/staging nội bộ.
> **CẢNH BÁO**: Các thiết lập trong tài liệu này CHỈ dùng cho `NODE_ENV=development` hoặc môi trường nội bộ. **TUYỆT ĐỐI KHÔNG** áp dụng cho production / khách hàng.

## 1. Cơ chế license

Hệ thống dùng license file ký số (`license.lic`) gồm:

- `expiresAt` — ngày hết hạn.
- `maxMachines` — số máy AOI tối đa.
- `maxUsers` — số user.
- `features[]` — các module bật (`ai-quality-gate`, `oee`, `bulletin`, …).
- `signature` — RSA-2048 signature do nhà cung cấp ký.

File `license.lic` đặt ở thư mục gốc dự án, đọc lúc server khởi động bởi `server/services/licenseService.ts`.

## 2. Trạng thái khi không có license hợp lệ

- API `/api/license/status` trả `{ valid: false, reason: "..." }`.
- Banner đỏ trên UI: "Hết hạn license — vui lòng liên hệ NCC".
- Một số API ghi (POST/PUT/DELETE) trả `403 LICENSE_INVALID`.
- Đọc dữ liệu (GET) vẫn hoạt động (read-only mode).

## 3. Bypass cho dev (3 cách)

### 3.1. Đặt biến môi trường (khuyên dùng)

Trong `.env` (môi trường dev):

```ini
NODE_ENV=development
LICENSE_BYPASS=true            # bỏ qua kiểm tra license
LICENSE_BYPASS_FEATURES=all    # bật toàn bộ feature flag
```

Restart server. Banner sẽ ẩn, mọi API ghi hoạt động bình thường.

> Code chỉ chấp nhận `LICENSE_BYPASS=true` khi `NODE_ENV !== "production"`. Nếu cố bật ở prod, server sẽ từ chối boot và log: `LICENSE_BYPASS not allowed in production`.

### 3.2. Dùng license dev có hạn

Dev license file mẫu nằm tại `license.lic.example` (nếu có). Copy:

```bash
cp license.lic.example license.lic
```

License dev hạn 90 ngày, max 5 máy, max 10 users. Đủ cho local dev.

### 3.3. Sinh license dev tự ký (chỉ khi có khoá nội bộ)

```bash
node scripts/generate-dev-license.mjs \
  --expires 2026-12-31 \
  --maxMachines 10 \
  --maxUsers 50 \
  --features all
```

File mới ghi đè `license.lic`. Restart server.

## 4. Kiểm tra trạng thái license

```bash
curl http://localhost:3000/api/license/status
```

Phản hồi mẫu:

```json
{
  "valid": true,
  "mode": "dev-bypass",
  "expiresAt": null,
  "maxMachines": 9999,
  "maxUsers": 9999,
  "features": ["all"]
}
```

Hoặc UI: `Cài đặt › Hệ thống › License`.

## 5. Production — quy trình xin license

1. Lấy **MAC address** card mạng chính của server: `ip link` (Linux) / `getmac` (Windows).
2. Gửi NCC: tên công ty, MAC, số máy AOI dự kiến, ngày bắt đầu.
3. Nhận `license.lic` qua email an toàn → copy vào thư mục gốc → restart.
4. Kiểm tra `/api/license/status`.

## 6. Quy tắc bảo mật

- KHÔNG commit `license.lic` vào git (đã có trong `.gitignore`).
- KHÔNG bật `LICENSE_BYPASS` trong container image gốc — chỉ override qua env runtime của môi trường dev.
- Audit log ghi nhận mọi lần restart server kèm trạng thái license; admin có thể xem ở `Cài đặt › Audit Log`.

## 7. Khắc phục sự cố

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `LICENSE_INVALID_SIGNATURE` | File bị sửa hoặc tải sai | Xin lại file từ NCC |
| `LICENSE_HOST_MISMATCH` | MAC khác với MAC ký license | Kiểm tra interface chính; nếu thay card mạng cần xin license mới |
| `LICENSE_EXPIRED` | Hết hạn | Gia hạn với NCC |
| Server không boot, log `LICENSE_BYPASS not allowed in production` | Đặt bypass ở prod | Bỏ env này, dùng license thật |

## 8. Liên kết

- Backup file license: `howto-backup-restore.md` mục 2.
- SSO: `howto-sso-oauth.md`.
