# Hướng dẫn Cấu hình Firebase Push Notifications

## Tổng quan

Hệ thống MES AVI/AOI sử dụng Firebase Cloud Messaging (FCM) để gửi push notifications đến mobile app khi có NG alerts, ngay cả khi app đang chạy background hoặc đã đóng.

## Kiến trúc

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   MES Server    │────▶│   Firebase FCM  │────▶│   Mobile App    │
│   (Backend)     │     │   (Google)      │     │   (Client)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                               │
        │              ┌─────────────────┐              │
        └─────────────▶│   MQTT Broker   │◀─────────────┘
                       │   (Real-time)   │
                       └─────────────────┘
```

**Luồng hoạt động:**
1. Máy AVI/AOI gửi NG alert qua MQTT
2. MES Server nhận và xử lý NG alert
3. Server kiểm tra danh sách offline clients
4. Server gửi push notification qua FCM đến các client offline
5. Mobile app nhận notification và hiển thị

## Bước 1: Tạo Firebase Project

1. Truy cập [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" hoặc "Create a project"
3. Nhập tên project: `avi-aoi-mes`
4. Bật/tắt Google Analytics theo nhu cầu
5. Click "Create project"

## Bước 2: Thêm Android App

1. Trong Firebase Console, click biểu tượng Android
2. Nhập package name: `com.avi.aoimonitor`
3. Nhập app nickname: `AVI/AOI Monitor`
4. Click "Register app"
5. Download file `google-services.json`
6. Đặt file vào thư mục `mobile-app/`

## Bước 3: Tạo Service Account

1. Trong Firebase Console, vào Project Settings > Service accounts
2. Click "Generate new private key"
3. Download file JSON (ví dụ: `avi-aoi-mes-firebase-adminsdk.json`)
4. **Bảo mật file này** - không commit vào git

## Bước 4: Cấu hình Server

### Environment Variables

Thêm vào file `.env` hoặc environment variables:

```bash
# Firebase Service Account JSON (base64 encoded)
FIREBASE_SERVICE_ACCOUNT_JSON=<base64_encoded_json>

# Hoặc đường dẫn file (không khuyến khích cho production)
# FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
```

### Encode Service Account JSON

```bash
# Linux/Mac
cat avi-aoi-mes-firebase-adminsdk.json | base64 -w 0

# Windows (PowerShell)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("avi-aoi-mes-firebase-adminsdk.json"))
```

### Kiểm tra cấu hình

```bash
# Test FCM connection
curl -X POST http://localhost:3000/api/trpc/fcm.testConnection
```

## Bước 5: Cấu hình Mobile App

### 1. Cập nhật app.json

```json
{
  "expo": {
    "android": {
      "package": "com.avi.aoimonitor",
      "googleServicesFile": "./google-services.json"
    },
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#3b82f6"
        }
      ]
    ]
  }
}
```

### 2. Đăng ký FCM Token

Mobile app tự động đăng ký FCM token khi khởi động:

```typescript
// Trong App.tsx
import * as Notifications from 'expo-notifications';

const registerForPushNotifications = async () => {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  
  const token = await Notifications.getExpoPushTokenAsync();
  
  // Gửi token lên server
  await fetch('/api/trpc/fcm.registerToken', {
    method: 'POST',
    body: JSON.stringify({ token: token.data })
  });
};
```

## Notification Channels (Android)

Hệ thống sử dụng các notification channels sau:

| Channel ID | Tên | Mô tả | Priority |
|------------|-----|-------|----------|
| `ng_alerts` | NG Alerts | Cảnh báo NG từ máy kiểm tra | HIGH |
| `daily_summary` | Daily Summary | Báo cáo tổng hợp hàng ngày | NORMAL |
| `weekly_summary` | Weekly Summary | Báo cáo tổng hợp hàng tuần | NORMAL |
| `system` | System | Thông báo hệ thống | DEFAULT |

## Message Format

### NG Alert Notification

```json
{
  "notification": {
    "title": "⚠️ NG Alert - Station 1",
    "body": "3 điểm NG phát hiện: Solder Joint 1, Solder Joint 2..."
  },
  "data": {
    "type": "NG_ALERT",
    "stationId": "1",
    "inspectionId": "12345",
    "machineId": "1",
    "productCode": "MODEL-A",
    "ngCount": "3",
    "imageUrl": "https://...",
    "timestamp": "2025-01-26T10:00:00Z"
  },
  "android": {
    "priority": "HIGH",
    "notification": {
      "channel_id": "ng_alerts",
      "sound": "default",
      "color": "#ef4444"
    }
  }
}
```

### Daily Summary Notification

```json
{
  "notification": {
    "title": "📊 Báo cáo ngày - Station 1",
    "body": "Hôm nay: 1000 kiểm tra, 15 NG (1.5%). Top NG: Solder Joint 2"
  },
  "data": {
    "type": "DAILY_SUMMARY",
    "stationId": "1",
    "totalInspections": "1000",
    "totalNG": "15",
    "ngRate": "1.5"
  }
}
```

## API Endpoints

### Register FCM Token

```typescript
// POST /api/trpc/fcm.registerToken
{
  "token": "fcm_token_string",
  "platform": "android" | "ios",
  "deviceId": "device_unique_id"
}
```

### Unregister Token

```typescript
// POST /api/trpc/fcm.unregisterToken
{
  "token": "fcm_token_string"
}
```

### Test Notification

```typescript
// POST /api/trpc/fcm.sendTestNotification
{
  "token": "fcm_token_string"
}
```

## Troubleshooting

### Push notification không nhận được

1. **Kiểm tra quyền notification:**
   - Android: Settings > Apps > AVI/AOI Monitor > Notifications
   - iOS: Settings > Notifications > AVI/AOI Monitor

2. **Kiểm tra FCM token:**
   ```bash
   # Xem log server
   grep "FCM" /var/log/mes/server.log
   ```

3. **Kiểm tra Firebase Console:**
   - Vào Cloud Messaging > Statistics
   - Xem số lượng messages sent/delivered

### Token expired hoặc invalid

Server tự động xóa token không hợp lệ khi gửi notification thất bại. Client cần đăng ký lại token khi khởi động app.

### Notification bị delay

- FCM không đảm bảo delivery time
- Android Doze mode có thể delay notifications
- Kiểm tra network connectivity

## Best Practices

1. **Token Management:**
   - Đăng ký token mỗi khi app khởi động
   - Xử lý token refresh event
   - Xóa token khi user logout

2. **Notification Content:**
   - Giữ title ngắn gọn (< 50 ký tự)
   - Body cung cấp thông tin quan trọng
   - Sử dụng data payload cho chi tiết

3. **Rate Limiting:**
   - FCM có giới hạn 240 messages/minute per device
   - Batch notifications khi có nhiều alerts

4. **Background Handling:**
   - Sử dụng data-only messages cho background processing
   - Implement notification click handler

## Security

1. **Service Account:**
   - Không commit vào git
   - Sử dụng environment variables
   - Rotate keys định kỳ

2. **Token Storage:**
   - Lưu token trong database với encryption
   - Xóa token khi user logout

3. **Message Content:**
   - Không gửi sensitive data trong notification body
   - Sử dụng data payload và fetch details từ server

## Monitoring

### Firebase Console

- Cloud Messaging > Statistics: Xem delivery metrics
- Cloud Messaging > Reports: Phân tích chi tiết

### Server Logs

```bash
# Xem FCM logs
tail -f /var/log/mes/server.log | grep FCM
```

### Metrics

Theo dõi các metrics sau:
- FCM send success rate
- FCM delivery rate
- Token registration rate
- Notification click rate

## Liên hệ hỗ trợ

- Email: support@avi-aoi.com
- Documentation: https://docs.avi-aoi.com
- Firebase Support: https://firebase.google.com/support
