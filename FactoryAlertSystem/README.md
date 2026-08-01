# 🏭 Factory Alert System

**Hệ Thống Thông Báo Lỗi Thời Gian Thực Cho Dây Chuyền Sản Xuất**

Real-time Error Notification System for Production Lines

---

## 📋 Mô Tả

Factory Alert System là ứng dụng mobile được thiết kế để giám sát và thông báo ngay lập tức các lỗi xảy ra trên dây chuyền sản xuất trong môi trường công nghiệp.

### Tính Năng Chính

- ✅ **Real-time Alerts**: Nhận cảnh báo trong < 2 giây
- ✅ **MQTT Integration**: Kết nối với MQTT broker để nhận message từ máy móc
- ✅ **Push Notifications**: Thông báo local với âm thanh và rung
- ✅ **Alert Queue Management**: Quản lý hàng đợi alerts chưa xử lý
- ✅ **Offline Ready**: Lưu alerts khi mất kết nối
- ✅ **Bilingual UI**: Giao diện tiếng Việt và tiếng Anh
- ✅ **Alert Simulator**: Test app không cần máy móc thật

---

## 🏗️ Kiến Trúc

```
FactoryAlertSystem/
├── src/
│   ├── components/          # UI Components
│   │   ├── AlertCard.tsx
│   │   ├── ConnectionStatus.tsx
│   │   ├── EmptyState.tsx
│   │   ├── KPICard.tsx
│   │   ├── SettingItem.tsx
│   │   └── SeverityBadge.tsx
│   ├── screens/             # App Screens
│   │   ├── HomeScreen.tsx
│   │   ├── AlertsScreen.tsx
│   │   ├── AlertDetailScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   └── SimulatorScreen.tsx
│   ├── services/            # Business Logic
│   │   ├── mqttService.ts
│   │   └── notificationService.ts
│   ├── store/               # State Management (Zustand)
│   │   ├── alertStore.ts
│   │   ├── settingsStore.ts
│   │   └── connectionStore.ts
│   ├── types/               # TypeScript Definitions
│   │   └── index.ts
│   └── utils/               # Utilities
│       ├── constants.ts
│       └── helpers.ts
├── App.tsx                  # Main App Component
├── index.js                 # Entry Point
└── package.json
```

---

## 🚀 Cài Đặt

### Yêu Cầu

- Node.js >= 18
- React Native CLI
- Android Studio (cho Android)
- Xcode (cho iOS - macOS only)

### Bước 1: Clone và Install Dependencies

```bash
cd FactoryAlertSystem
npm install
```

### Bước 2: Cài đặt iOS Pods (macOS only)

```bash
cd ios && pod install && cd ..
```

### Bước 3: Chạy App

```bash
# Android
npm run android

# iOS
npm run ios
```

---

## ⚙️ Cấu Hình

### MQTT Broker

Cấu hình kết nối MQTT trong màn hình Settings:

| Parameter | Default | Mô tả |
|-----------|---------|-------|
| Broker Address | 192.168.1.100 | IP hoặc hostname của MQTT broker |
| Port | 8000 | WebSocket port |
| Use SSL | false | Sử dụng wss:// thay vì ws:// |
| Username | (optional) | Username để xác thực |
| Password | (optional) | Password để xác thực |

### MQTT Topics

App subscribe vào các topics sau:

```
factory/+/station/+/alert
```

### Message Format

```json
{
  "alertId": "ALT-2026-001234",
  "timestamp": "2026-01-17T14:30:15Z",
  "station": {
    "id": "ST-A-001",
    "name": "Wire Cutting Station A1",
    "line": "Line A"
  },
  "product": {
    "id": "PRD-WH-12345",
    "name": "Wire Harness Model X"
  },
  "error": {
    "code": "E-CUT-001",
    "type": "Cutting Error",
    "description": "Wire length mismatch"
  },
  "severity": "high"
}
```

### Severity Levels

| Level | Màu | Mô tả |
|-------|-----|-------|
| critical | 🔴 Đỏ | Máy dừng khẩn cấp |
| high | 🟠 Cam | Lỗi nghiêm trọng |
| medium | 🟡 Vàng | Cần theo dõi |
| low | 🔵 Xanh dương | Cảnh báo nhẹ |
| info | ⚫ Xám | Thông tin |

---

## 📱 Màn Hình

### 1. Home Screen
- Dashboard hiển thị KPIs
- Danh sách alerts gần đây
- Trạng thái kết nối MQTT

### 2. Alerts Screen
- Danh sách tất cả alerts
- Tìm kiếm và lọc theo severity/status
- Swipe để acknowledge/dismiss

### 3. Alert Detail Screen
- Thông tin chi tiết alert
- Timeline xử lý
- Actions: Acknowledge, Resolve, Dismiss

### 4. Settings Screen
- Cấu hình MQTT
- Cài đặt thông báo
- Ngôn ngữ và theme

### 5. Simulator Screen
- Tạo alerts test
- Auto-generate với interval
- Chọn station, product, error, severity

---

## 🧪 Testing với Simulator

1. Mở tab **Simulator**
2. Chọn kiểu tạo: **Random** hoặc **Specific**
3. Nhấn **Generate Alert** để tạo 1 alert
4. Hoặc nhấn **Auto Generate** để tự động tạo alerts theo interval

---

## 📦 Tech Stack

- **React Native** 0.73.2
- **TypeScript** 5.3
- **Zustand** - State Management
- **MQTT.js** - MQTT Client
- **Notifee** - Local Notifications
- **React Navigation** 6
- **React Native Paper** - UI Components
- **AsyncStorage** - Data Persistence

---

## 🏭 Production Deployment

### Android

```bash
cd android
./gradlew assembleRelease
```

APK sẽ được tạo tại: `android/app/build/outputs/apk/release/`

### iOS

Build trong Xcode với scheme Release.

---

## 📄 License

Copyright © 2026 Foxconn Manufacturing

---

## 👥 Team

- Mobile Development Team
- Industrial Automation Division
