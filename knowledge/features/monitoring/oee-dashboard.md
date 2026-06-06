# OEE Dashboard

## 1. Mục đích
Hiển thị chỉ số **OEE** (Overall Equipment Effectiveness = Availability × Performance × Quality) cho từng máy và toàn nhà máy, kèm theo lịch sử downtime và công cụ ghi nhận sự cố ngừng máy. Hỗ trợ xuất CSV/Excel để báo cáo lãnh đạo.

## 2. Vị trí truy cập
- URL: `/oee-dashboard`
- Menu: **Analytics** → **OEE Dashboard**
- Trang nguồn: `client/src/pages/OEEDashboard.tsx`

## 3. Quyền yêu cầu
- Permission: `analytics_oee_targets` (category `analytics`)
- `canView=true` để xem; `canCreate/canEdit` để Start/End downtime; `canEdit` để Calculate OEE thủ công.

## 4. Tiền điều kiện
- Máy đã có dữ liệu OEE trong `oee_metrics` (sinh tự động từ MQTT job hoặc bằng nút Calculate).
- Đã thiết lập **OEE Targets** ở `analytics_oee_targets` (xem batch Alerts).
- Để Start Downtime cần biết category (planned/unplanned/breakdown/changeover/maintenance/other).

## 5. Các bước thao tác
1. Mở `/oee-dashboard` → quan sát 4 KPI: Avg OEE %, Top Machine, Total Machines, Avg Availability.
2. Chọn máy ở sidebar (hoặc dropdown) → 3 radial gauge **Availability / Performance / Quality** hiện ra.
3. Xem **OEE Breakdown** bar chart và **Downtime by Category** pie chart.
4. Nếu có downtime đang chạy: section **Active Downtime** hiện thời gian + category, bấm **End Downtime** để đóng.
5. Bấm **Start Downtime** → chọn category, nhập reason, người báo → submit ghi `downtime_events`.
6. Bấm **Calculate OEE** → mutation `calculateOEE` chạy lại công thức cho máy đã chọn.
7. Bấm **Export CSV** / **Export Excel** để tải báo cáo (kèm summary và Vietnamese diacritics).

## 6. Kết quả mong đợi
- Gauge và KPI cập nhật ngay sau Calculate OEE.
- Active Downtime hiển thị timer running (hh:mm:ss) tăng theo thời gian thực.
- Sau End Downtime: dòng mới xuất hiện trong Downtime History với duration tính chính xác.
- File export mở được bằng Excel, không lỗi font.

## 7. Lỗi thường gặp & cách xử lý
- **Avg OEE = 0%**: chưa có dữ liệu `oee_metrics` → bấm Calculate OEE cho từng máy hoặc đợi MQTT job.
- **"Không có dữ liệu để xuất"** (`oee.noDataToExport`): chưa chọn máy hoặc dữ liệu rỗng.
- **Start Downtime validation**: thiếu category → form chặn submit.
- **calculateOEE error**: thiếu machineId → kiểm tra đã chọn máy chưa.

## 8. API liên quan
- Query: `machine.list`, `mqttClient.getAllOEE`, `getMachineOEE({ machineId })`, `getActiveDowntime({ machineId })`, `getDowntimeHistory({})`, `getMachineHealth({ machineId })`.
- Mutation: `mqttClient.calculateOEE`, `startDowntime`, `endDowntime`, `calculateMachineHealth`.
- Server: `server/routers/mqttOeeRouters.ts`.
- DB tables: `oee_metrics`, `downtime_events`, `oee_targets`, `machines`.

## 9. Tính năng liên quan
- [knowledge/features/monitoring/machine-health.md](../monitoring/machine-health.md) — health score tổng hợp.
- [knowledge/features/monitoring/machine-status-monitor.md](../monitoring/machine-status-monitor.md) — uptime/heartbeat.
- OEE Target Settings (sẽ tạo ở batch Alerts).

## 10. Ví dụ thực tế
Quản đốc xem `/oee-dashboard` đầu giờ chiều: Avg OEE 78%, Top Machine MCH-004 (85%). Chọn MCH-001: Availability 95%, Performance 80%, Quality 85% → OEE = 64.6%. Pie chart cho thấy Unplanned downtime chiếm 40% (2 giờ). Anh bấm **Start Downtime** cho MCH-001, category=maintenance, reason="Thay dầu định kỳ", reportedBy="NV001". Active Downtime timer chạy. 45 phút sau hoàn tất bảo trì, bấm **End Downtime** → record lưu duration=45 phút. Cuối ca bấm **Export Excel** gửi báo cáo OEE ngày cho phòng kế hoạch.

## 11. Q&A nhanh

**Q: OEE là gì?**
A: OEE (Overall Equipment Effectiveness) = **Availability × Performance × Quality**. Đây là chỉ số tổng hợp đánh giá hiệu quả thiết bị: Availability = thời gian chạy / thời gian kế hoạch; Performance = sản lượng thực / sản lượng lý thuyết; Quality = sản phẩm đạt / tổng sản phẩm. Hiển thị ở trang `/oee-dashboard`.

**Q: OEE được tính thế nào trong hệ thống?**
A: OEE được tính tự động từ dữ liệu MQTT và ghi vào bảng `oee_metrics`, hoặc bằng tay qua nút **Calculate OEE** (mutation `mqttClient.calculateOEE`). Downtime được ghi vào `downtime_events` qua thao tác Start/End Downtime.

**Q: Có bao nhiêu category downtime?**
A: 6 category: `planned`, `unplanned`, `breakdown`, `changeover`, `maintenance`, `other`.

