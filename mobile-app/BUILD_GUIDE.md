# Hướng dẫn Build Mobile APK

## Yêu cầu

- Node.js >= 18
- npm hoặc yarn
- Tài khoản Expo (miễn phí)
- EAS CLI

## Cài đặt EAS CLI

```bash
npm install -g eas-cli
```

## Đăng nhập Expo

```bash
eas login
```

## Cấu hình Project

### 1. Cập nhật app.json

Thay đổi `projectId` trong `app.json`:

```json
{
  "expo": {
    "extra": {
      "eas": {
        "projectId": "your-actual-project-id"
      }
    }
  }
}
```

Để lấy projectId, chạy:
```bash
eas init
```

### 2. Cấu hình Firebase (cho Push Notifications)

1. Tạo project trên [Firebase Console](https://console.firebase.google.com/)
2. Thêm Android app với package name: `com.avi.aoimonitor`
3. Download `google-services.json` và đặt vào thư mục `mobile-app/`

## Build APK

### Preview Build (cho testing)

```bash
cd mobile-app
eas build --platform android --profile preview
```

Build sẽ chạy trên cloud của Expo và mất khoảng 10-15 phút. Sau khi hoàn thành, bạn sẽ nhận được link download APK.

### Development Build (với development client)

```bash
eas build --platform android --profile development
```

### Production Build (App Bundle cho Play Store)

```bash
eas build --platform android --profile production
```

## Build Local (không cần Expo cloud)

Nếu muốn build trên máy local:

```bash
# Cài đặt dependencies
npm install

# Build APK local
npx expo run:android --variant release
```

**Yêu cầu:**
- Android Studio
- Android SDK
- Java JDK 11+

## Cài đặt APK

### Trên thiết bị Android

1. Download file APK từ link Expo cung cấp
2. Cho phép "Install from unknown sources" trong Settings
3. Mở file APK và cài đặt

### Qua ADB

```bash
adb install path/to/app.apk
```

## Cấu hình App sau khi cài đặt

1. Mở app AVI/AOI Monitor
2. Vào tab Settings
3. Cấu hình:
   - **API URL**: URL của MES server (ví dụ: `https://mes.company.com`)
   - **MQTT Broker**: URL của MQTT broker (ví dụ: `mqtt://broker.company.com:1883`)
   - **Username/Password**: Thông tin đăng nhập MQTT (nếu có)

4. Bật "Auto Connect" để tự động kết nối khi mở app

## Troubleshooting

### Build failed với error "Missing google-services.json"

Tạo file `google-services.json` giả hoặc download từ Firebase Console.

### App không nhận được notifications

1. Kiểm tra quyền notification trong Settings của điện thoại
2. Kiểm tra kết nối MQTT
3. Kiểm tra Firebase configuration

### Không kết nối được MQTT

1. Kiểm tra URL broker đúng format
2. Kiểm tra firewall cho phép port MQTT
3. Kiểm tra username/password

## Cập nhật App

Để cập nhật app mà không cần build lại APK (OTA update):

```bash
eas update --branch preview --message "Update description"
```

## Liên hệ hỗ trợ

- Email: support@avi-aoi.com
- Documentation: https://docs.avi-aoi.com
