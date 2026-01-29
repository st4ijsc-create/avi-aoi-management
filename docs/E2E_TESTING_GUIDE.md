# Hướng dẫn Test End-to-End với Thiết bị Thật

## Mục lục

1. [Yêu cầu](#yêu-cầu)
2. [Build APK Preview](#build-apk-preview)
3. [Cài đặt trên thiết bị](#cài-đặt-trên-thiết-bị)
4. [Cấu hình kết nối](#cấu-hình-kết-nối)
5. [Test luồng E2E](#test-luồng-e2e)
6. [Checklist Test](#checklist-test)
7. [Troubleshooting](#troubleshooting)

---

## Yêu cầu

### Phần cứng
- Điện thoại Android 8.0+ hoặc iOS 13+
- Kết nối WiFi/4G ổn định
- (Tùy chọn) Máy AVI/AOI thật để test

### Phần mềm
- Node.js >= 18
- EAS CLI (`npm install -g eas-cli`)
- Tài khoản Expo (miễn phí)

### Server
- MES Server đang chạy và accessible từ internet
- MQTT Broker đã cấu hình
- Firebase đã cấu hình (cho push notifications)

---

## Build APK Preview

### Bước 1: Đăng nhập Expo

```bash
cd mobile-app
eas login
```

### Bước 2: Khởi tạo EAS (lần đầu)

```bash
eas init
```

Nhập thông tin khi được hỏi:
- Project ID sẽ được tạo tự động

### Bước 3: Build APK

```bash
eas build --platform android --profile preview
```

**Lưu ý:**
- Build sẽ chạy trên cloud của Expo
- Thời gian build: 10-15 phút
- Sau khi hoàn thành, bạn sẽ nhận được link download APK

### Bước 4: Download APK

1. Sau khi build xong, Expo sẽ hiển thị link download
2. Hoặc vào https://expo.dev và tìm build của bạn
3. Click "Download" để tải APK

---

## Cài đặt trên thiết bị

### Android

1. **Cho phép cài đặt từ nguồn không xác định:**
   - Vào Settings > Security
   - Bật "Unknown sources" hoặc "Install unknown apps"

2. **Cài đặt APK:**
   - Transfer file APK sang điện thoại (qua USB, email, hoặc cloud)
   - Mở file APK và chọn "Install"
   - Đợi cài đặt hoàn tất

3. **Mở app:**
   - Tìm "AVI/AOI Monitor" trong danh sách app
   - Mở app

### iOS (TestFlight)

1. Build cho iOS:
   ```bash
   eas build --platform ios --profile preview
   ```

2. Upload lên TestFlight (cần Apple Developer account)

3. Cài đặt qua TestFlight app

---

## Cấu hình kết nối

### Bước 1: Mở Settings

1. Mở app AVI/AOI Monitor
2. Tap vào tab "Settings" (biểu tượng ⚙️)

### Bước 2: Cấu hình API

| Field | Giá trị | Ví dụ |
|-------|---------|-------|
| API URL | URL của MES server | `https://mes.company.com` |

### Bước 3: Cấu hình MQTT

| Field | Giá trị | Ví dụ |
|-------|---------|-------|
| Broker URL | URL của MQTT broker | `mqtt://broker.company.com:1883` |
| Username | Username MQTT (nếu có) | `avi_client` |
| Password | Password MQTT (nếu có) | `secret123` |

### Bước 4: Bật Auto Connect

1. Toggle "Auto Connect" sang ON
2. App sẽ tự động kết nối khi mở

### Bước 5: Test kết nối

1. Tap nút "Test Connection"
2. Kiểm tra kết quả:
   - ✅ API: Connected
   - ✅ MQTT: Connected

---

## Test luồng E2E

### Test 1: Nhận dữ liệu Real-time

**Mục đích:** Xác nhận app nhận được dữ liệu inspection từ máy AVI/AOI

**Bước thực hiện:**

1. Mở app, vào tab Dashboard
2. Chạy MQTT simulator trên server:
   ```bash
   cd /home/ubuntu/avi-aoi-management
   python3 scripts/mqtt_simulator.py --broker localhost --port 1884 --interval 2 --count 10
   ```
3. Quan sát Dashboard trên app

**Kết quả mong đợi:**
- KPI cards cập nhật real-time
- Output count tăng
- FPY/Yield thay đổi theo dữ liệu

### Test 2: Nhận NG Alert Push Notification

**Mục đích:** Xác nhận app nhận được push notification khi có NG

**Bước thực hiện:**

1. Đóng app hoặc để chạy background
2. Chạy MQTT simulator với NG rate cao:
   ```bash
   python3 scripts/mqtt_simulator.py --broker localhost --port 1884 --interval 3 --ng-rate 0.8 --count 5
   ```
3. Quan sát notification trên điện thoại

**Kết quả mong đợi:**
- Push notification xuất hiện
- Notification hiển thị thông tin NG (serial number, số điểm NG)
- Tap notification mở app vào màn hình Alerts

### Test 3: Xem danh sách Alerts

**Mục đích:** Xác nhận app hiển thị đúng danh sách NG alerts

**Bước thực hiện:**

1. Mở app, vào tab Alerts
2. Kiểm tra danh sách alerts
3. Filter theo severity (Critical, Warning, Info)
4. Tap vào một alert để xem chi tiết

**Kết quả mong đợi:**
- Danh sách alerts hiển thị đầy đủ
- Filter hoạt động đúng
- Chi tiết alert hiển thị đầy đủ thông tin

### Test 4: Offline Mode

**Mục đích:** Xác nhận app hoạt động khi mất kết nối

**Bước thực hiện:**

1. Mở app và đợi dữ liệu load
2. Tắt WiFi/4G
3. Kiểm tra app vẫn hiển thị dữ liệu cached
4. Bật lại WiFi/4G
5. Kiểm tra app tự động reconnect

**Kết quả mong đợi:**
- App hiển thị dữ liệu cached khi offline
- Hiển thị indicator "Offline"
- Tự động reconnect khi có mạng

---

## Checklist Test

### Kết nối

- [ ] App kết nối được API server
- [ ] App kết nối được MQTT broker
- [ ] App tự động reconnect khi mất kết nối

### Dashboard

- [ ] KPI cards hiển thị đúng dữ liệu
- [ ] Dữ liệu cập nhật real-time
- [ ] Refresh kéo xuống hoạt động

### Alerts

- [ ] Danh sách alerts hiển thị đầy đủ
- [ ] Filter theo severity hoạt động
- [ ] Chi tiết alert hiển thị đúng
- [ ] Mark as read hoạt động

### Push Notifications

- [ ] Nhận được notification khi có NG alert
- [ ] Notification hiển thị đúng thông tin
- [ ] Tap notification mở đúng màn hình
- [ ] Notification hoạt động khi app background
- [ ] Notification hoạt động khi app đóng

### Settings

- [ ] Lưu cấu hình thành công
- [ ] Cấu hình persist sau khi đóng app
- [ ] Test connection hoạt động

### Performance

- [ ] App mở nhanh (< 3 giây)
- [ ] Scroll mượt mà
- [ ] Không bị crash
- [ ] Pin tiêu thụ hợp lý

---

## Troubleshooting

### App không kết nối được API

**Nguyên nhân có thể:**
1. URL sai
2. Server không accessible từ internet
3. Firewall chặn

**Giải pháp:**
1. Kiểm tra URL đúng format (có https://)
2. Test URL trên trình duyệt điện thoại
3. Kiểm tra firewall/security group

### App không kết nối được MQTT

**Nguyên nhân có thể:**
1. Broker URL sai
2. Port không mở
3. Username/password sai

**Giải pháp:**
1. Kiểm tra URL và port
2. Kiểm tra firewall cho phép port MQTT
3. Kiểm tra credentials

### Không nhận được Push Notification

**Nguyên nhân có thể:**
1. Firebase chưa cấu hình
2. Quyền notification bị tắt
3. Device token không được đăng ký

**Giải pháp:**
1. Kiểm tra Firebase đã cấu hình đúng
2. Vào Settings > Apps > AVI/AOI Monitor > Notifications, bật notifications
3. Kiểm tra logs server xem có token được đăng ký

### App bị crash

**Giải pháp:**
1. Xóa app và cài lại
2. Clear app data
3. Kiểm tra logs crash (nếu có)

### Dữ liệu không cập nhật

**Nguyên nhân có thể:**
1. MQTT không kết nối
2. Topic không đúng
3. Server không gửi dữ liệu

**Giải pháp:**
1. Kiểm tra MQTT connection status
2. Kiểm tra topic configuration
3. Kiểm tra logs server

---

## Script Test Tự động

Sử dụng script sau để test tự động:

```bash
#!/bin/bash
# test-e2e.sh

echo "=== E2E Test Script ==="

# Test 1: API Health
echo "Testing API..."
curl -s https://your-server.com/api/health | jq .

# Test 2: MQTT Simulator
echo "Starting MQTT Simulator..."
python3 scripts/mqtt_simulator.py --broker localhost --port 1884 --interval 2 --count 5 &
PID=$!

# Wait for simulator
sleep 15

# Stop simulator
kill $PID

echo "=== Test Complete ==="
```

---

## Liên hệ hỗ trợ

- Email: support@avi-aoi.com
- Documentation: https://docs.avi-aoi.com
