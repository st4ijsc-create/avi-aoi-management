# MQTT Bulletin

## 1. Mục đích
Cấu hình và theo dõi việc gửi **bản tin định kỳ** (bulletin) qua MQTT cho từng station: tổng hợp số liệu sản xuất, danh sách điểm NG, gửi đến hệ thống ngoài (external) hoặc Firebase Cloud Messaging (FCM). Hỗ trợ scheduler chạy nền theo interval hoặc cron.

## 2. Vị trí truy cập
- URL: `/mqtt-bulletin`
- Menu: **MQTT** → **MQTT Bulletin**
- Trang nguồn: `client/src/pages/MqttBulletin.tsx`

## 3. Quyền yêu cầu
- Permission: `mqtt_bulletin` (category `mqtt`)
- Quyền cần: `canView`, `canCreate`, `canEdit`, `canDelete` để CRUD đầy đủ.
- Trigger thủ công yêu cầu `canEdit`.

## 4. Tiền điều kiện
- Đã đăng ký station trong hệ thống (xem `production-orders.md` / `machine-registration.md`).
- MQTT broker hoạt động và scheduler service đã start (badge **Scheduler: Running**).
- Để gửi FCM cần cấu hình Firebase server key trong system settings.

## 5. Các bước thao tác
1. Tab **Dashboard**: xem Total Bulletins (7 ngày), Success Rate, Avg Send Time, Next Scheduled Send, badge scheduler.
2. Tab **Settings** → bấm **Add Configuration**.
   - Chế độ multi-station: chọn nhiều station → áp cùng cấu hình.
   - Chế độ single: chọn 1 station và sửa chi tiết.
3. Nhập: `intervalMinutes` (5–1440), `scheduleType` (interval/cron), `cronExpression` (nếu cron), `startHour`/`endHour` (6–22), `includeImages`, `maxFailPoints` (1–100), `sendToExternal`, `sendFcm`.
4. Bấm **Save** → record ghi vào `mqtt_bulletin_settings`, scheduler tự reload.
5. Trên hàng cấu hình: bấm **Trigger Now** để gửi ngay; **Toggle Enabled**; **Edit**; **Delete**.
6. Tab **History**: lọc theo station, phân trang 20/page, xem timestamp + status.
7. Tab **NG Alerts**: cấu hình topic pattern, QoS, cooldown_seconds chống spam.

## 6. Kết quả mong đợi
- Sau **Save**: toast "X stations configured, Y created, Z updated".
- **Trigger Now**: bulletin gửi ngay, dòng mới xuất hiện ở History với status CheckCircle2 (xanh) hoặc XCircle (đỏ).
- Scheduler chạy đúng `intervalMinutes` trong khung giờ `startHour–endHour`.

## 7. Lỗi thường gặp & cách xử lý
- **"Chọn ít nhất 1 station"**: chế độ multi-add nhưng chưa chọn → tick checkbox station.
- **"Station not found"** khi edit: station đã bị xóa → reload trang.
- **Scheduler: Stopped**: service nền không chạy → restart server hoặc kiểm tra log `mqttBulletinScheduler`.
- **intervalMinutes invalid**: phải 5–1440, ngoài khoảng → form chặn submit.
- **Test bulletin success=false**: kiểm tra `result.message`, thường do topic không có subscriber.

## 8. API liên quan
- Query: `mqttBulletin.getDashboardStats({ days:7 })`, `listSettings({})`, `getHistory({ stationId?, limit, offset })`, `getSchedulerStatus`.
- Mutation: `upsertSetting`, `quickSetup` (multi-station batch), `toggleEnabled`, `deleteSetting`, `triggerNow`, `sendTestBulletin`.
- Server: `server/routers/mqttBulletinRouter.ts`.
- DB tables: `mqtt_bulletin_settings`, `mqtt_bulletin_history`, join `stations`, `factories`, `workshops`, `production_lines`.

## 9. Tính năng liên quan
- [knowledge/features/monitoring/mqtt-dashboard.md](../monitoring/mqtt-dashboard.md) — bức tranh tổng thể MQTT.
- [knowledge/features/monitoring/monitoring-settings.md](../monitoring/monitoring-settings.md) — cấu hình MQTT Profile/Topics.
- [knowledge/features/alerts/mqtt-alert-rules.md](../alerts/mqtt-alert-rules.md) — quy tắc cảnh báo (sẽ tạo ở batch sau).

## 10. Ví dụ thực tế
Quản lý sản xuất muốn 3 station (Station_A, B, C) gửi bản tin tổng kết mỗi giờ trong ca làm 6:00–22:00. Mở `/mqtt-bulletin` → Settings → **Add Configuration** (multi-station) → tick 3 station → set interval=60, scheduleType=interval, startHour=6, endHour=22, includeImages=true, maxFailPoints=20, sendToExternal=true. Bấm Save → toast "3 stations configured, 0 created, 3 updated". Sau đó bấm **Trigger Now** trên Station_A để kiểm tra: History tab xuất hiện dòng mới timestamp 14:23, recipientCount=2, status xanh. Sang tab NG Alerts thêm cooldown_seconds=30 để tránh spam.
