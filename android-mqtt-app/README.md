# AVI MQTT Monitor - Android App

Ứng dụng Android để nhận thông báo lỗi từ hệ thống AVI/AOI qua MQTT và hiển thị dạng Bubble overlay.

## Tính năng

- **Kết nối MQTT**: Nhận thông báo real-time từ MQTT broker
- **Bubble Notification**: Hiển thị thông báo lỗi dạng floating bubble trên tất cả app khác
- **Background Service**: Chạy nền để nhận thông báo liên tục
- **Cấu hình công trạm**: Thiết lập thông tin công trạm để nhận thông báo phù hợp
- **Lịch sử thông báo**: Xem và quản lý tất cả thông báo đã nhận
- **Filter & Search**: Tìm kiếm và lọc thông báo theo loại

## Yêu cầu hệ thống

- Android 7.0 (API 24) trở lên
- Node.js 18+
- React Native CLI
- Android Studio với Android SDK

## Cài đặt Development

### 1. Clone và cài đặt dependencies

```bash
cd android-mqtt-app
npm install
```

### 2. Cấu hình Android

Mở `android/` trong Android Studio và sync Gradle.

### 3. Chạy ứng dụng

```bash
# Start Metro bundler
npm start

# Chạy trên thiết bị/emulator Android
npm run android
```

## Build APK

### Debug APK

```bash
cd android
./gradlew assembleDebug
```

APK sẽ được tạo tại: `android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK

1. Tạo keystore (chỉ lần đầu):
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore my-upload-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

2. Cấu hình signing trong `android/app/build.gradle`

3. Build release:
```bash
cd android
./gradlew assembleRelease
```

APK sẽ được tạo tại: `android/app/build/outputs/apk/release/app-release.apk`

## Cấu hình MQTT

### Topics mặc định

App sẽ tự động đăng ký các topics sau:

- `avi/alerts/#` - Tất cả cảnh báo
- `avi/machines/+/status` - Trạng thái máy
- `avi/production/+/error` - Lỗi sản xuất
- `avi/quality/+/ng` - Sản phẩm NG

### Topics theo công trạm

Khi cấu hình công trạm, app sẽ tự động đăng ký:

- `avi/station/{stationId}/alerts`
- `avi/station/{stationId}/status`
- `avi/line/{lineId}/alerts`
- `avi/line/{lineId}/yield`

## Cấu trúc thư mục

```
android-mqtt-app/
├── App.tsx                 # Entry point
├── src/
│   ├── screens/           # Màn hình
│   │   ├── HomeScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   ├── NotificationHistoryScreen.tsx
│   │   └── StationConfigScreen.tsx
│   ├── services/          # Business logic
│   │   ├── mqttService.ts
│   │   └── notificationService.ts
│   ├── store/             # State management
│   │   └── notificationStore.ts
│   └── components/        # UI components
├── android/               # Native Android code
│   └── app/src/main/java/com/avimqttapp/
│       └── BubbleModule.java
└── package.json
```

## Quyền Android cần thiết

App yêu cầu các quyền sau:

- `INTERNET` - Kết nối MQTT
- `SYSTEM_ALERT_WINDOW` - Hiển thị bubble overlay
- `FOREGROUND_SERVICE` - Chạy background service
- `RECEIVE_BOOT_COMPLETED` - Tự khởi động sau khi reboot
- `VIBRATE` - Rung khi có thông báo
- `WAKE_LOCK` - Giữ thiết bị hoạt động

## Sử dụng trên tablet dây chuyền

1. Cài đặt APK lên tablet
2. Cấp quyền "Display over other apps" (Hiển thị trên ứng dụng khác)
3. Cấu hình MQTT broker URL
4. Cấu hình thông tin công trạm
5. Bật kết nối MQTT

App sẽ tự động:
- Chạy nền và nhận thông báo
- Hiển thị bubble khi có lỗi
- Lưu lịch sử thông báo

## Troubleshooting

### Không nhận được thông báo
- Kiểm tra kết nối MQTT (xem trạng thái trên HomeScreen)
- Kiểm tra topics đã đăng ký
- Kiểm tra broker URL và port

### Bubble không hiển thị
- Kiểm tra quyền "Display over other apps"
- Vào Settings > Apps > AVI MQTT > Display over other apps > Allow

### App bị kill khi chạy nền
- Tắt tối ưu pin cho app
- Vào Settings > Battery > AVI MQTT > Don't optimize

## Liên hệ hỗ trợ

Liên hệ team IT để được hỗ trợ cài đặt và cấu hình.
