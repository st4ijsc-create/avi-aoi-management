# AVI/AOI Monitor Mobile App

React Native (Expo) mobile app để nhận thông báo NG qua MQTT cho hệ thống AVI/AOI Factory Management.

## Tính năng

### 1. MQTT Client
- Kết nối MQTT broker để nhận real-time alerts
- Auto-reconnect khi mất kết nối
- Subscribe theo station hoặc tất cả stations

### 2. NG Alert Popup
- Hiển thị popup ở trên cùng màn hình khi có NG
- Thông tin: máy, serial, điểm NG, ảnh
- Tự động đóng sau thời gian cấu hình (mặc định 60 giây)
- Có thể đóng thủ công

### 3. Thống kê lỗi
- Dashboard hiển thị thống kê hôm nay
- Số lượng kiểm tra, tổng NG, tỷ lệ NG
- NG trong 1 giờ qua
- Danh sách thông báo gần đây

### 4. Push Notification (FCM)
- Nhận push notification khi offline
- Hỗ trợ cả Android và iOS

## Cài đặt

### Prerequisites
- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- Expo Go app trên điện thoại (để test)

### Development

```bash
# Cài đặt dependencies
cd mobile-app
npm install

# Chạy development server
npm start

# Chạy trên Android
npm run android

# Chạy trên iOS
npm run ios
```

### Build Production

```bash
# Cài đặt EAS CLI
npm install -g eas-cli

# Login vào Expo account
eas login

# Build Android APK
eas build --platform android --profile preview

# Build iOS IPA
eas build --platform ios --profile preview
```

## Cấu hình

### MQTT Settings
Trong app, vào **Settings** để cấu hình:
- **Broker URL**: URL của MQTT broker (ví dụ: `mqtt://your-server.com`)
- **Port**: Port của MQTT broker (mặc định: 1883)
- **Username/Password**: Thông tin xác thực (nếu có)

### Notification Settings
- **Thời gian hiển thị**: Thời gian popup hiển thị (giây)
- **Nhận cảnh báo NG**: Bật/tắt nhận NG alerts
- **Báo cáo hàng ngày**: Bật/tắt nhận daily summary
- **Báo cáo hàng tuần**: Bật/tắt nhận weekly summary

## Firebase Cloud Messaging (FCM)

Để nhận push notification khi offline:

1. Tạo project trên [Firebase Console](https://console.firebase.google.com)
2. Thêm Android/iOS app vào project
3. Download `google-services.json` (Android) và `GoogleService-Info.plist` (iOS)
4. Đặt files vào thư mục `mobile-app/`
5. Cấu hình `FCM_SERVER_KEY` trên server

## MQTT Topics

App subscribe các topics sau:
- `avi/+/+/+/station/{stationId}/errors` - NG alerts
- `avi/+/+/+/station/{stationId}/summary/daily` - Daily summary
- `avi/+/+/+/station/{stationId}/summary/weekly` - Weekly summary

## Message Format

### NG Alert
```json
{
  "type": "NG_ALERT",
  "inspectionId": 123,
  "serialNumber": "SN001",
  "productName": "Product A",
  "machineName": "Machine 1",
  "stationName": "Station A",
  "timestamp": "2025-01-22T10:00:00Z",
  "ngPoints": [
    {
      "pointId": 1,
      "pointName": "Point 1",
      "result": "NG",
      "actualValue": "10.5"
    }
  ],
  "totalNG": 1,
  "imageUrl": "https://..."
}
```

### Summary
```json
{
  "type": "DAILY_SUMMARY",
  "stationId": 1,
  "stationName": "Station A",
  "period": {
    "start": "2025-01-22T00:00:00Z",
    "end": "2025-01-22T23:59:59Z"
  },
  "statistics": {
    "totalInspections": 100,
    "totalNG": 5,
    "totalNTF": 0,
    "ngRate": 5.0
  },
  "topNGPoints": [
    {
      "pointId": 1,
      "pointName": "Point 1",
      "ngCount": 3,
      "percentage": 60.0
    }
  ],
  "timestamp": "2025-01-23T06:00:00Z"
}
```

## Troubleshooting

### Không kết nối được MQTT
- Kiểm tra URL và port đúng chưa
- Kiểm tra firewall cho phép kết nối
- Kiểm tra username/password

### Không nhận được thông báo
- Kiểm tra đã subscribe đúng topic chưa
- Kiểm tra cài đặt notification đã bật chưa
- Kiểm tra app có quyền notification không

### Push notification không hoạt động
- Kiểm tra đã cấu hình Firebase đúng chưa
- Kiểm tra FCM_SERVER_KEY trên server
- Kiểm tra device đã đăng ký FCM token chưa
