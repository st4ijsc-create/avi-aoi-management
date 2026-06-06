# Machine Health Monitoring

## 1. Mục đích
Đánh giá **sức khỏe tổng hợp** của máy theo thang điểm 0–100 dựa trên nhiều yếu tố: OEE, Availability, Performance, Quality, Uptime, Error Rate. Cung cấp gauge, radar chart, timeline và bảng so sánh nhiều máy giúp lập kế hoạch bảo trì dự đoán.

## 2. Vị trí truy cập
- URL: `/machine-health`
- Menu: **Analytics** → **Machine Health**
- Trang nguồn: `client/src/pages/MachineHealthMonitoring.tsx`

## 3. Quyền yêu cầu
- Permission: `analytics_machine_health` (category `analytics`)
- `canView=true` để xem; `canEdit=true` để bấm Recalculate.

## 4. Tiền điều kiện
- Có dữ liệu trong `machine_health_history` (sinh từ job định kỳ hoặc bấm Recalculate).
- Có `oee_metrics` hiện hành để bảng so sánh có giá trị.
- Máy đang được monitor (xem MachineStatusMonitor).

## 5. Các bước thao tác
1. Mở `/machine-health` → xem 3 KPI: Avg Health Score, Critical Machines Count, Health Trend (% so với kỳ trước).
2. Chọn **Time Range**: day / week / month (đổi mật độ điểm: 24 / 7 / 30).
3. Chọn máy ở dropdown → gauge tròn lớn hiển thị điểm số (màu theo ngưỡng: green ≥80, yellow 60–79, orange 40–59, red <40).
4. Quan sát 4 Factor Card (OEE, Availability, Performance, Quality) với trend ↑/↓ và progress bar.
5. Xem **Health Score Timeline** (line chart healthScore/oee/uptime/errorRate) — refetch mỗi 60 giây.
6. Xem **Radar Chart** so sánh các factor; **Machine Comparison Table** sortable theo cột.
7. Bấm **Calculate Health** để chạy lại; bấm **Export Health Report** để tải CSV.

## 6. Kết quả mong đợi
- Sau Calculate Health: điểm số cập nhật, history chèn dòng mới timestamp hiện tại.
- Timeline chart mượt, có thể nhận thấy uptick sau khi bảo trì.
- Bảng so sánh xếp hạng máy theo health score giảm dần.

## 7. Lỗi thường gặp & cách xử lý
- **Không có history cho range chọn**: hệ thống tự sinh dữ liệu giả lập (deterministic seeded random walk theo machineId) chỉ để xem hình; cần chạy Calculate để có dữ liệu thật.
- **Health score quá cũ**: máy offline → giá trị là snapshot cuối; mở MachineStatusMonitor để xác nhận.
- **"Không có dữ liệu để xuất"** (`machines.noDataToExport`): chưa chọn máy hoặc range trống.

## 8. API liên quan
- Query: `machine.list`, `mqttClient.getAllOEE`, `getMachineHealth({ machineId })`, `getMachineHealthHistory({ machineId, range, limit:500 })` (refetch 60s).
- Mutation: `mqttClient.calculateMachineHealth`.
- Server: `server/routers/mqttOeeRouters.ts`.
- DB tables: `machines`, `machine_health_history`, `oee_metrics`.

## 9. Tính năng liên quan
- [knowledge/features/monitoring/oee-dashboard.md](../monitoring/oee-dashboard.md) — chi tiết OEE + downtime.
- [knowledge/features/monitoring/machine-status-monitor.md](../monitoring/machine-status-monitor.md) — uptime/heartbeat.
- [knowledge/features/monitoring/mqtt-dashboard.md](../monitoring/mqtt-dashboard.md) — luồng tin MQTT.

## 10. Ví dụ thực tế
Trưởng phòng bảo trì mở `/machine-health` thứ Hai đầu tuần, chọn Time Range = week. KPI: Avg Health 76%, Critical Machines = 2, Trend −2.5%. Chọn Machine_B (CNC) → gauge 82 (xanh), factor cards: OEE 80%, Availability 95%, Performance 78%, Quality 85%. Timeline cho thấy điểm tăng từ 75 → 82 sau khi bảo trì ngày thứ Tư tuần trước. Radar chart cho thấy Performance tương đối thấp → ghi nhận để cân chỉnh tốc độ máy. Bấm **Export Health Report** để gửi CSV cho ban giám đốc.
