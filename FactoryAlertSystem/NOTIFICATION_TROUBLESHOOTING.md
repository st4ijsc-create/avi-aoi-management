# 🔔 Hướng Dẫn Khắc Phục Lỗi Notification

## Vấn Đề Thường Gặp

### 1. Notification không hiển thị

**Nguyên nhân:**
- Permission chưa được cấp (đặc biệt Android 13+)
- Notification channel bị tắt
- App bị hạn chế bởi battery optimization

**Giải pháp:**

#### Bước 1: Kiểm tra Permission
```javascript
// Trong app, gọi:
const hasPermission = await notificationService.hasPermission();
if (!hasPermission) {
  await notificationService.openSettings();
}
```

#### Bước 2: Kiểm tra Notification Channel (Android)
1. Mở Settings > Apps > Factory Alert System
2. Chọn "Notifications"
3. Đảm bảo tất cả channels đều BẬT:
   - ✅ Cảnh báo Nghiêm trọng
   - ✅ Cảnh báo Cao
   - ✅ Cảnh báo Trung bình
   - ✅ Cảnh báo Thấp

#### Bước 3: Tắt Battery Optimization
1. Settings > Battery > Battery optimization
2. Tìm "Factory Alert System"
3. Chọn "Don't optimize"

---

### 2. Notification không hiển thị khi app chạy nền

**Nguyên nhân:**
- Background handler chưa được đăng ký đúng cách
- App bị kill bởi system
- MQTT connection bị ngắt

**Giải pháp:**

#### Sử dụng Foreground Service
```javascript
// Khi app vào background, start foreground service
import { notificationService } from './src/services';

// Start khi cần duy trì kết nối
await notificationService.startForegroundService();

// Stop khi không cần nữa
await notificationService.stopForegroundService();
```

#### Kiểm tra Background Handler
File `index.js` phải có đoạn code sau TRƯỚC khi register app:
```javascript
import notifee, { EventType } from '@notifee/react-native';

notifee.onBackgroundEvent(async ({ type, detail }) => {
  // Handle background events
});
```

---

### 3. Full-screen alert không hiển thị (Critical alerts)

**Nguyên nhân:**
- Thiếu permission USE_FULL_SCREEN_INTENT
- Activity không có showWhenLocked

**Giải pháp:**

AndroidManifest.xml phải có:
```xml
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />

<activity
    android:name=".MainActivity"
    android:showWhenLocked="true"
    android:turnScreenOn="true">
```

---

## Cấu Hình Đề Xuất

### AndroidManifest.xml
```xml
<!-- Permissions cần thiết -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

<!-- Services -->
<service
    android:name="io.invertase.notifee.ForegroundService"
    android:foregroundServiceType="dataSync" />

<service
    android:name="io.invertase.notifee.NotifeeEventSubscriber"
    android:permission="android.permission.BIND_JOB_SERVICE" />

<!-- Boot receiver -->
<receiver android:name="io.invertase.notifee.NotifeeRebootReceiver">
    <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
    </intent-filter>
</receiver>
```

---

## Test Notification

### Trong App
Sử dụng nút "Test Notification" trong Settings để kiểm tra:

```javascript
// Hoặc gọi trực tiếp:
await notificationService.showTestNotification();
```

### Kiểm tra Log
```bash
# Android
adb logcat | grep -E "(Notification|notifee)"

# React Native
npx react-native log-android
```

---

## Checklist Khắc Phục

- [ ] Permission POST_NOTIFICATIONS được cấp
- [ ] Notification channels đều enabled
- [ ] Battery optimization đã tắt cho app
- [ ] Background handler đã đăng ký trong index.js
- [ ] Foreground service đang chạy (nếu cần)
- [ ] AndroidManifest có đầy đủ permissions
- [ ] MQTT connection vẫn hoạt động khi background

---

## Lưu Ý Quan Trọng

1. **Android 13+**: Bắt buộc phải request permission POST_NOTIFICATIONS
2. **MIUI/EMUI/ColorOS**: Các ROM custom có thể cần cấu hình thêm trong Settings > Apps
3. **Foreground Service**: Nên sử dụng để đảm bảo app không bị kill
4. **Critical Alerts**: Cần USE_FULL_SCREEN_INTENT permission

---

## Code Mẫu Hoàn Chỉnh

### App.tsx - Khởi tạo
```javascript
useEffect(() => {
  const init = async () => {
    // Initialize notification service
    await notificationService.initialize();
    
    // Check permission
    const hasPermission = await notificationService.hasPermission();
    if (!hasPermission) {
      // Show dialog to user
      Alert.alert(
        'Cần cấp quyền',
        'Vui lòng cấp quyền thông báo để nhận cảnh báo từ dây chuyền sản xuất',
        [
          { text: 'Để sau', style: 'cancel' },
          { text: 'Cài đặt', onPress: () => notificationService.openSettings() }
        ]
      );
    }
    
    // Start foreground service for background support
    await notificationService.startForegroundService();
  };
  
  init();
  
  return () => {
    notificationService.stopForegroundService();
  };
}, []);
```

### Hiển thị Alert
```javascript
// Khi nhận alert từ MQTT
mqttService.setOnMessage(async (alert) => {
  // Add to store
  addAlert(alert);
  
  // Show notification
  await notificationService.showAlert(alert);
  
  // Play sound
  soundService.playAlertSound(alert.severity);
});
```
