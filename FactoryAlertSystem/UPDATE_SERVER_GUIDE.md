# Hướng dẫn cài đặt Update Server (LAN)

## Tổng quan

Update Server là một HTTP server đơn giản phục vụ file APK và file `version.json` để app Factory Alert System tự động kiểm tra và tải bản cập nhật mới.

## 1. Cấu trúc thư mục server

```
update-server/
├── server.js              # Server Node.js
├── package.json
└── releases/
    ├── version.json       # File thông tin phiên bản (BẮT BUỘC)
    └── factory-alert.apk  # File APK mới nhất
```

## 2. File `version.json` (BẮT BUỘC)

Đây là file quan trọng nhất. App sẽ gọi `GET http://<server>:<port>/version.json` để kiểm tra cập nhật.

```json
{
  "version": "1.1.0",
  "versionCode": 2,
  "releaseDate": "2026-04-05",
  "apkUrl": "/releases/factory-alert.apk",
  "changelog": [
    "Thêm tính năng tự động cập nhật",
    "Sửa lỗi kết nối MQTT",
    "Cải thiện hiệu năng"
  ],
  "mandatory": false,
  "minVersionCode": 1
}
```

### Giải thích các trường:

| Trường | Kiểu | Mô tả |
|--------|------|--------|
| `version` | string | Số phiên bản mới (ví dụ: "1.1.0") |
| `versionCode` | number | Mã phiên bản (phải lớn hơn version hiện tại: 1) |
| `releaseDate` | string | Ngày phát hành (YYYY-MM-DD) |
| `apkUrl` | string | Đường dẫn tới file APK (tương đối hoặc tuyệt đối) |
| `changelog` | string[] | Danh sách thay đổi |
| `mandatory` | boolean | `true` = bắt buộc cập nhật, không cho bấm "Để sau" |
| `minVersionCode` | number | Nếu app hiện tại < giá trị này → bắt buộc cập nhật |

### Quy tắc `apkUrl`:
- Đường dẫn tương đối: `/releases/factory-alert.apk` → App sẽ tự ghép với URL server
- Đường dẫn tuyệt đối: `http://192.168.1.100:3900/releases/factory-alert.apk`

## 3. Cài đặt Server bằng Node.js (Khuyến nghị)

### Bước 1: Cài Node.js
Tải và cài đặt từ https://nodejs.org (phiên bản LTS)

### Bước 2: Tạo thư mục server

```bash
mkdir update-server
cd update-server
npm init -y
npm install express
```

### Bước 3: Tạo file `server.js`

```javascript
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3900;

// Cho phép CORS (để app React Native truy cập)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Serve file version.json
app.get('/version.json', (req, res) => {
  const versionFile = path.join(__dirname, 'releases', 'version.json');
  if (fs.existsSync(versionFile)) {
    res.sendFile(versionFile);
  } else {
    res.status(404).json({ error: 'version.json not found' });
  }
});

// Serve file APK với header phù hợp
app.get('/releases/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'releases', req.params.filename);
  
  // Chỉ cho phép tải file .apk
  if (!req.params.filename.endsWith('.apk')) {
    return res.status(403).json({ error: 'Only APK files allowed' });
  }
  
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Update Server running on http://0.0.0.0:${PORT}`);
  console.log(`LAN URL: http://<YOUR_IP>:${PORT}`);
  console.log(`Version info: http://<YOUR_IP>:${PORT}/version.json`);
});
```

### Bước 4: Tạo thư mục releases và version.json

```bash
mkdir releases
```

Tạo file `releases/version.json`:
```json
{
  "version": "1.0.0",
  "versionCode": 1,
  "releaseDate": "2026-04-02",
  "apkUrl": "/releases/factory-alert.apk",
  "changelog": ["Phiên bản đầu tiên"],
  "mandatory": false,
  "minVersionCode": 1
}
```

### Bước 5: Chạy server

```bash
node server.js
```

Server sẽ chạy tại `http://0.0.0.0:3900`

## 4. Cấu hình trên App

1. Mở app → **Settings** (Cài đặt)
2. Kéo xuống mục **"Cập nhật ứng dụng"**
3. Nhập URL server: `http://<IP_MÁY_CHẠY_SERVER>:3900`
   - Ví dụ: `http://192.168.1.100:3900`
4. Bật **"Tự động kiểm tra cập nhật"**
5. Bấm **"Kiểm tra cập nhật"** để test

## 5. Quy trình cập nhật phiên bản mới

### Bước 1: Build APK mới
```bash
cd android
.\gradlew.bat assembleRelease
```
APK sẽ ở: `android/app/build/outputs/apk/release/`

### Bước 2: Copy APK vào server
```bash
copy android\app\build\outputs\apk\release\app-release-*.apk update-server\releases\factory-alert.apk
```

### Bước 3: Cập nhật `version.json`
Sửa file `releases/version.json`:
- Tăng `version` (ví dụ: "1.0.0" → "1.1.0")
- Tăng `versionCode` (ví dụ: 1 → 2)
- Cập nhật `releaseDate`
- Thêm `changelog`
- **QUAN TRỌNG**: Cũng phải tăng `versionCode` trong `android/app/build.gradle` trước khi build

### Bước 4: Khởi động lại server (nếu cần)
Nếu dùng Node.js server ở trên, không cần restart vì file được đọc mỗi request.

## 6. Chạy Server như Windows Service

### Dùng PM2 (khuyến nghị):
```bash
npm install -g pm2
pm2 start server.js --name "update-server"
pm2 save
pm2 startup
```

### Dùng NSSM (Windows Service):
1. Tải NSSM từ https://nssm.cc
2. Chạy: `nssm install UpdateServer "C:\Program Files\nodejs\node.exe" "C:\update-server\server.js"`
3. Khởi động: `nssm start UpdateServer`

## 7. Cách ép buộc cập nhật

Nếu muốn bắt buộc tất cả người dùng cập nhật:

```json
{
  "version": "2.0.0",
  "versionCode": 10,
  "mandatory": true,
  "minVersionCode": 10,
  ...
}
```

- `mandatory: true` → Không cho bấm "Để sau" hoặc "Bỏ qua"
- `minVersionCode: 10` → Tất cả app có versionCode < 10 phải cập nhật

## 8. Kiểm tra hoạt động

### Test từ trình duyệt:
```
http://192.168.1.100:3900/version.json
http://192.168.1.100:3900/health
```

### Test từ dòng lệnh:
```bash
curl http://192.168.1.100:3900/version.json
```

### Test từ app:
1. Mở Settings → nhập URL server → bấm "Kiểm tra cập nhật"
2. Nếu có bản mới → hiển thị dialog thông báo
3. Bấm "Cập nhật" → tải APK qua trình duyệt → cài đặt

## 9. Lưu ý bảo mật

- Server chỉ nên chạy trong mạng LAN nội bộ
- Không mở port 3900 ra Internet
- Chỉ cho phép tải file `.apk` (server.js đã kiểm tra)
- Trên thiết bị Android: cần bật **"Cho phép cài đặt từ nguồn không xác định"** trong Settings > Security
- Android 8.0+: cần cấp quyền **"Cài đặt ứng dụng không xác định"** cho trình duyệt
