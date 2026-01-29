# Hướng dẫn Cấu hình Firebase - Step by Step

## Mục lục

1. [Tạo Firebase Project](#1-tạo-firebase-project)
2. [Thêm Android App](#2-thêm-android-app)
3. [Tạo Service Account](#3-tạo-service-account)
4. [Cấu hình Server](#4-cấu-hình-server)
5. [Kiểm tra kết nối](#5-kiểm-tra-kết-nối)

---

## 1. Tạo Firebase Project

### Bước 1.1: Truy cập Firebase Console

1. Mở trình duyệt và truy cập: https://console.firebase.google.com/
2. Đăng nhập bằng tài khoản Google

### Bước 1.2: Tạo Project mới

1. Click nút **"Add project"** hoặc **"Create a project"**
2. Nhập tên project: `avi-aoi-mes` (hoặc tên tùy chọn)
3. Click **"Continue"**

### Bước 1.3: Cấu hình Google Analytics (Tùy chọn)

1. Bật hoặc tắt Google Analytics theo nhu cầu
2. Nếu bật, chọn hoặc tạo Google Analytics account
3. Click **"Create project"**

### Bước 1.4: Hoàn tất

1. Đợi Firebase tạo project (khoảng 30 giây)
2. Click **"Continue"** khi hoàn tất

---

## 2. Thêm Android App

### Bước 2.1: Thêm App

1. Trong Firebase Console, click biểu tượng **Android** (hình robot)
2. Hoặc vào **Project settings** > **General** > **Your apps** > **Add app** > **Android**

### Bước 2.2: Đăng ký App

Nhập thông tin sau:

| Field | Giá trị |
|-------|---------|
| Android package name | `com.avi.aoimonitor` |
| App nickname (optional) | `AVI/AOI Monitor` |
| Debug signing certificate SHA-1 (optional) | Để trống hoặc thêm sau |

Click **"Register app"**

### Bước 2.3: Download google-services.json

1. Click **"Download google-services.json"**
2. Lưu file vào thư mục `mobile-app/` của project
3. Click **"Next"**

### Bước 2.4: Bỏ qua các bước còn lại

1. Bỏ qua bước "Add Firebase SDK" (đã cấu hình sẵn trong Expo)
2. Click **"Continue to console"**

---

## 3. Tạo Service Account

### Bước 3.1: Truy cập Service Accounts

1. Trong Firebase Console, click biểu tượng **⚙️ Settings** (bánh răng)
2. Chọn **"Project settings"**
3. Click tab **"Service accounts"**

### Bước 3.2: Tạo Private Key

1. Đảm bảo **"Firebase Admin SDK"** được chọn
2. Click nút **"Generate new private key"**
3. Xác nhận bằng cách click **"Generate key"**
4. File JSON sẽ tự động download

### Bước 3.3: Bảo mật File

**QUAN TRỌNG:** File này chứa credentials nhạy cảm!

1. **KHÔNG** commit file này vào git
2. **KHÔNG** chia sẻ file này công khai
3. Lưu trữ an toàn và backup

---

## 4. Cấu hình Server

### Bước 4.1: Encode Service Account JSON

Chạy script sau để encode file JSON thành base64:

**Linux/Mac:**
```bash
# Thay đổi tên file cho phù hợp
cat avi-aoi-mes-firebase-adminsdk-xxxxx.json | base64 -w 0 > firebase_encoded.txt
```

**Windows (PowerShell):**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("avi-aoi-mes-firebase-adminsdk-xxxxx.json")) | Out-File firebase_encoded.txt
```

**Hoặc sử dụng script có sẵn:**
```bash
cd /home/ubuntu/avi-aoi-management
node scripts/encode-firebase-credentials.js path/to/service-account.json
```

### Bước 4.2: Cấu hình Environment Variable

**Cách 1: Qua Manus Management UI**

1. Mở Management UI của project
2. Vào **Settings** > **Secrets**
3. Thêm secret mới:
   - Key: `FIREBASE_SERVICE_ACCOUNT_JSON`
   - Value: Nội dung từ file `firebase_encoded.txt`

**Cách 2: Qua file .env (Development)**

```bash
# .env
FIREBASE_SERVICE_ACCOUNT_JSON=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50Ii...
```

### Bước 4.3: Restart Server

Sau khi cấu hình, restart server để áp dụng:

```bash
# Development
pnpm dev

# Production
pm2 restart avi-aoi-mes
```

---

## 5. Kiểm tra kết nối

### Bước 5.1: Test qua API

```bash
# Test FCM connection
curl -X POST http://localhost:3000/api/trpc/fcm.testConnection \
  -H "Content-Type: application/json"
```

**Kết quả thành công:**
```json
{
  "result": {
    "data": {
      "success": true,
      "message": "Connected to project: avi-aoi-mes"
    }
  }
}
```

### Bước 5.2: Kiểm tra logs

```bash
# Xem logs FCM
grep "FCM" /var/log/mes/server.log

# Hoặc trong development
pnpm dev 2>&1 | grep FCM
```

**Logs thành công:**
```
[FCM] Access token obtained, expires in: 3600 seconds
[FCM] Connected to project: avi-aoi-mes
```

### Bước 5.3: Test Push Notification

1. Đăng ký device token từ mobile app
2. Gửi test notification:

```bash
curl -X POST http://localhost:3000/api/trpc/fcm.sendTestNotification \
  -H "Content-Type: application/json" \
  -d '{"token": "your_device_token"}'
```

---

## Troubleshooting

### Lỗi: "Service account not configured"

**Nguyên nhân:** Environment variable chưa được set

**Giải pháp:**
1. Kiểm tra `FIREBASE_SERVICE_ACCOUNT_JSON` đã được set
2. Restart server sau khi set

### Lỗi: "Failed to get access token"

**Nguyên nhân:** Service account JSON không hợp lệ

**Giải pháp:**
1. Kiểm tra file JSON đã encode đúng base64
2. Tạo lại service account key mới

### Lỗi: "Invalid registration token"

**Nguyên nhân:** Device token không hợp lệ hoặc đã hết hạn

**Giải pháp:**
1. Mobile app cần đăng ký lại token
2. Kiểm tra app đã cấu hình đúng package name

### Lỗi: "Sender ID mismatch"

**Nguyên nhân:** google-services.json không khớp với service account

**Giải pháp:**
1. Đảm bảo cả 2 file từ cùng một Firebase project
2. Download lại cả 2 file

---

## Checklist

- [ ] Tạo Firebase project
- [ ] Thêm Android app với package name `com.avi.aoimonitor`
- [ ] Download `google-services.json` vào `mobile-app/`
- [ ] Tạo service account và download JSON
- [ ] Encode JSON thành base64
- [ ] Cấu hình `FIREBASE_SERVICE_ACCOUNT_JSON`
- [ ] Restart server
- [ ] Test connection thành công
- [ ] Test push notification thành công

---

## Liên hệ hỗ trợ

- Email: support@avi-aoi.com
- Documentation: https://docs.avi-aoi.com
- Firebase Support: https://firebase.google.com/support
