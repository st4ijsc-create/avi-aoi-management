# Machine Status Monitor

## 1. Mục đích
Theo dõi trạng thái online/offline của toàn bộ máy trên xưởng theo thời gian thực: hiển thị uptime %, heartbeat gần nhất, lịch sử thay đổi trạng thái, và xuất báo cáo. Giúp kỹ thuật phát hiện máy mất kết nối, lên kế hoạch bảo trì.

## 2. Vị trí truy cập
- URL: `/machine-status`
- Menu: **Monitoring** → **Machine Status**
- Trang nguồn: `client/src/pages/MachineStatusMonitor.tsx`

## 3. Quyền yêu cầu
- Permission: `machine_status` (category `machine_monitoring`)
- `canView=true` đủ để xem; cấu hình ngưỡng cảnh báo cần `canEdit`.

## 4. Tiền điều kiện
- Có máy đã đăng ký trong bảng `machines` và đang gửi heartbeat MQTT.
- Hệ thống đang ghi log heartbeat (`heartbeat_logs` / `mqtt_connection_logs`).

## 5. Các bước thao tác
1. Mở `/machine-status` → grid card 4 cột (responsive 2/1 cột).
2. Lọc theo Factory ở dropdown header (mặc định "Tất cả").
3. Quan sát màu card: green ≥95%, emerald ≥80%, yellow ≥60%, orange <60%; icon Wifi/WifiOff cho online/offline.
4. Bấm vào 1 card → mở **Detail Dialog**:
   - Đổi **Time Range** (1h / 6h / 24h / 72h / 7d).
   - Tab **Status History**: danh sách thay đổi trạng thái + IP.
   - Tab **Heartbeat**: timeline chart các nhịp tim.
   - Stats: Uptime %, Total Online, Total Offline.
5. Bấm **Update** ở Alert Configuration để chỉnh ngưỡng cảnh báo (ví dụ alert khi offline >5 phút).
6. Bấm **Export Report** để tải file CSV/Excel.

## 6. Kết quả mong đợi
- Card cập nhật theo `listWithStatus` (mặc định 30s).
- Detail dialog mở mượt, dữ liệu uptime khớp với time range.
- Export tạo file kèm summary (avg uptime, count online/offline) và timestamp.

## 7. Lỗi thường gặp & cách xử lý
- **"no data"** ở last heartbeat: máy chưa từng gửi heartbeat → kiểm tra MQTT client trên máy.
- **Uptime 100% bất thường**: không có offline event trong khoảng → tăng time range để chắc chắn.
- **"Không có dữ liệu để xuất"** (`machines.noDataToExport`): time range trống → đổi range rộng hơn.
- **Update alert config thất bại**: toast lỗi → kiểm tra quyền `canEdit` và payload threshold.

## 8. API liên quan
- Query: `machineStatus.listWithStatus`, `getLogs({ machineId, limit:50 })`, `getHeartbeats({ machineId, hours })`, `getUptimeStats({ machineId, hours })`, `getAllUptimeTimelines({ days? })`, `getAlertConfig`, `getReport({ format?, timeRange? })`.
- Mutation: `machineStatus.updateAlertConfig`.
- Server: `server/routers/machineApiRouters.ts`.
- DB tables: `machines`, `machine_status_logs`, `heartbeat_logs`, `mqtt_connection_logs`, `machine_health_history`, join `factories/workshops/production_lines/stations`.

## 9. Tính năng liên quan
- [knowledge/features/monitoring/mqtt-dashboard.md](../monitoring/mqtt-dashboard.md) — luồng tin MQTT tổng thể.
- [knowledge/features/monitoring/machine-health.md](../monitoring/machine-health.md) — health score chi tiết theo nhiều yếu tố.
- [knowledge/features/monitoring/oee-dashboard.md](../monitoring/oee-dashboard.md) — OEE & downtime.
- [knowledge/features/monitoring/machine-registration.md](../monitoring/machine-registration.md) — đăng ký máy mới.

## 10. Ví dụ thực tế
Tổ trưởng vào ca sáng mở `/machine-status`, thấy 10/12 máy xanh và 2 máy cam (Machine_C 72%, Machine_F 65%). Bấm vào Machine_C → đổi time range sang 7 ngày → Uptime 72%, Online 5040 phút, Offline 1920 phút. Tab Heartbeat thấy mất kết nối nhiều lần lúc 02:00–04:00 ban đêm. Anh bấm **Export Report**, lưu file CSV gửi cho bộ phận điện để kiểm tra nguồn nuôi MQTT gateway, đồng thời mở `/machine-health` xem health score chi tiết.
