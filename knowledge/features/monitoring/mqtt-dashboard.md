# MQTT Dashboard

## 1. Mục đích
Bảng điều khiển MQTT cung cấp cái nhìn thời gian thực về trạng thái kết nối các MQTT client (máy/thiết bị), lưu lượng tin nhắn, phân phối loại tin (NG Alert / Daily / Weekly), và cho phép gửi tin nhắn thử nghiệm để xác nhận đường truyền hoạt động.

## 2. Vị trí truy cập
- URL: `/mqtt-dashboard`
- Menu: **MQTT** → **MQTT Dashboard**
- Trang nguồn: `client/src/pages/MqttDashboard.tsx`

## 3. Quyền yêu cầu
- Permission: `mqtt_view` (category `mqtt`, module `mqtt_monitoring`)
- Quyền tối thiểu: `canView=true`. Không yêu cầu quyền chỉnh sửa.
- Action gửi NG Alert thử nghiệm chỉ phụ thuộc broker đang hoạt động.

## 4. Tiền điều kiện
- MQTT broker (local hoặc cloud) phải đang chạy; trang sẽ hiển thị badge "Local: Online/Offline" và "Cloud: Connected/Disconnected".
- Có ít nhất một MQTT client đã đăng ký để xem số liệu.
- Để gửi NG Alert thử: phải tồn tại Factory → Workshop → Line → Station → Machine.

## 5. Các bước thao tác
1. Mở `/mqtt-dashboard`. Hệ thống tự động tải `mqttClient.dashboardStats`, `recentMessages`, `messageTrend`.
2. Quan sát 4 stats card: **Clients Online**, **Clients Offline**, **Messages Today**, breakdown theo loại tin.
3. Bật/tắt **WebSocket toggle** để chọn cập nhật real-time qua WS hoặc polling (state lưu `localStorage['mqtt-ws-enabled']`).
4. Đổi khoảng thời gian biểu đồ trend (7 / 14 / 30 ngày).
5. Bấm **Test NG Alert** → chọn Factory/Workshop/Station/Machine → tùy chọn thêm measurement points → bấm **Send**.
6. Bấm **Refresh** để gọi lại tất cả query; **Sound toggle** bật/tắt âm báo khi có tin mới.
7. Quan sát bảng **Recent Messages** với badge DELIVERED / FAILED / PENDING.

## 6. Kết quả mong đợi
- Stats card cập nhật mỗi 10 giây qua `realtimeStats`; throughput chart cập nhật mỗi 60 giây.
- Sau khi gửi test NG Alert thành công: toast xanh "Alert sent to serial:XYZ", message hiển thị trong bảng Recent với trạng thái DELIVERED.
- Pie chart phân bố loại tin (NG Alerts / Daily / Weekly) cập nhật ngay sau test.

## 7. Lỗi thường gặp & cách xử lý
- **"Vui lòng chọn Factory, Workshop và Station"**: chưa chọn đủ hierarchy trong dialog test → chọn lại đầy đủ.
- **WS: Off**: WebSocket không kết nối được → hệ thống tự fallback sang polling; kiểm tra firewall hoặc bấm Refresh.
- **NG Alert thử thất bại**: toast đỏ kèm `error.message` (ví dụ broker disconnect, topic không hợp lệ) → kiểm tra MQTT Profile của station.
- **Clients Offline cao bất thường**: máy mất heartbeat → mở MachineStatusMonitor để chẩn đoán.

## 8. API liên quan
- Query: `trpc.mqttClient.dashboardStats`, `messageTrend({ days })`, `recentMessages({ limit:20 })`, `list({})`, `status`, `realtimeStats` (refetch 10s), `throughputHistory({ minutes:60 })` (refetch 60s).
- Mutation: `trpc.mqttClient.testNGAlert` (input: factoryId, workshopId, stationId, machineId, measurementPoints?).
- Server: `server/routers/mqttOeeRouters.ts`.
- DB tables: `mqtt_clients`, `mqtt_message_history`, `mqtt_connection_status`.

## 9. Tính năng liên quan
- [knowledge/features/monitoring/mqtt-bulletin.md](../monitoring/mqtt-bulletin.md) — cấu hình bản tin định kỳ.
- [knowledge/features/monitoring/machine-status-monitor.md](../monitoring/machine-status-monitor.md) — chi tiết uptime từng máy.
- [knowledge/features/monitoring/machine-registration.md](../monitoring/machine-registration.md) — đăng ký máy/thiết bị MQTT.

## 10. Ví dụ thực tế
Kỹ sư trực ca mở MQTT Dashboard lúc 8:00, thấy 12/15 client online, Messages Today = 3,420 (NG=85, Daily=120, Weekly=15). Anh bấm **Test NG Alert** chọn Factory_A → Workshop_1 → Station_3 → Machine MCH-007, thêm measurement point "P1=NG (45.5)", bấm Send. Toast hiện "Alert sent to serial:MCH007-1714305600", Recent Messages xuất hiện dòng mới DELIVERED, pie chart NG Alerts tăng 1 đơn vị. Anh xác nhận đường truyền OK và đóng dialog.
