# Monitoring Settings

## 1. Mục đích
Trang cấu hình tập trung dành cho **admin**, gom các tác vụ quản trị MQTT/máy vào một sidebar duy nhất: đăng ký máy, quản lý device, MQTT clients, topics, replay, profiles, ngưỡng NG rate. Mỗi mục tải nội dung của trang con tương ứng dưới dạng component nhúng.

## 2. Vị trí truy cập
- URL: `/monitoring-setting` (query param `?tab=<tab-name>` để chọn tab)
- Menu: **System** → **Monitoring Settings**
- Trang nguồn: `client/src/pages/MonitoringSettings.tsx`

## 3. Quyền yêu cầu
- Chỉ **role = admin** mới truy cập (kiểm tra `if (!isAdmin) return <AccessDenied />`).
- Các action bên trong từng tab tuân theo permission của module gốc tương ứng.

## 4. Tiền điều kiện
- Đăng nhập bằng tài khoản admin.
- Các module con đã hoạt động: machine registration, MQTT broker, MQTT profile templates.

## 5. Các bước thao tác
1. Mở `/monitoring-setting`. Sidebar trái 256px hiện 2 nhóm:
   - **Machine Management** (HardDrive, blue): Machine Registration, Device Management.
   - **MQTT Configuration** (Radio, green): MQTT Clients, MQTT Topics, MQTT Replay, MQTT Profiles, MQTT NG Rate.
2. Bấm vào danh mục cha để collapse/expand; bấm vào item con → URL đổi `?tab=<tab-name>`, main area render component tương ứng:
   - `MachineRegistrationContent`, `MqttClientManagementContent`, `MqttTopicsMessagesContent`, `MQTTReplayContent`, `MqttProfileManagementContent`, `MqttNgRateThresholdContent`.
3. Có thể đính kèm `MachineMapping` và `ManualMachineMapping` ở phần dưới.
4. Thực hiện CRUD trong từng tab; trang giữ trạng thái sidebar trong session.

## 6. Kết quả mong đợi
- Truy cập đúng tab qua URL (ví dụ `/monitoring-setting?tab=mqtt-profiles` mở trực tiếp MQTT Profiles).
- Sau khi cấu hình ở 1 tab, có thể bấm Refresh để tải lại số liệu liên quan.
- Các thay đổi từ embedded component đồng bộ ngay với các trang dashboard tương ứng.

## 7. Lỗi thường gặp & cách xử lý
- **Access Denied**: user không phải admin → đăng nhập tài khoản admin hoặc nhờ admin cấp role.
- **Tab param sai**: URL chứa tab không tồn tại → trang giữ tab hiện tại; sửa URL.
- **MQTT Replay không có dữ liệu**: chưa có message history → kiểm tra `mqtt_message_history`.

## 8. API liên quan
- Trang gốc không gọi tRPC trực tiếp; mỗi embedded component sử dụng router riêng:
  - `machine.*` (đăng ký máy), `mqttClient.*` (clients/replay), `mqttTopic.*`, `mqttProfile.*`, `mqttNgAlertSettings.*`.
- DB tables: phụ thuộc component (machines, mqtt_clients, mqtt_topics, mqtt_profiles, mqtt_ng_alert_thresholds, mqtt_message_history,...).

## 9. Tính năng liên quan
- [knowledge/features/monitoring/machine-registration.md](../monitoring/machine-registration.md) — đăng ký máy chi tiết.
- [knowledge/features/monitoring/mqtt-dashboard.md](../monitoring/mqtt-dashboard.md) — bức tranh tổng MQTT.
- [knowledge/features/monitoring/mqtt-bulletin.md](../monitoring/mqtt-bulletin.md) — bản tin định kỳ.

## 10. Ví dụ thực tế
Admin nhận yêu cầu thêm 3 thiết bị MQTT mới và phê duyệt 2 client đang chờ. Anh mở `/monitoring-setting`:
1. Tab **Machine Registration** → nhập 3 máy mới (code, name, type, vị trí Factory/Workshop/Line/Station).
2. Sang tab **MQTT Clients** → thấy 3 pending registrations, duyệt 2, từ chối 1 với lý do "topic không hợp lệ".
3. Tab **MQTT Profiles** → tạo profile mới `default-cnc` với topic pattern `factory/{factoryId}/cnc/#`, QoS=1.
4. Tab **MQTT NG Rate** → đặt ngưỡng NG 3% sẽ trigger alert.
5. Tất cả thay đổi phản ánh ngay tại `/mqtt-dashboard` (clients online tăng) và `/mqtt-bulletin` (station mới khả dụng cho cấu hình).
