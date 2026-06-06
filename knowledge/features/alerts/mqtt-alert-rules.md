# Cảnh báo MQTT (MQTT Alert Rules)

## Mục đích
Định nghĩa các rule "khi MQTT message thoả điều kiện X thì sinh alert level Y, gửi cho người Z". Cho phép DevOps/QC tạo rule on-the-fly mà không cần code: filter theo topic/payload field, threshold, time-window, cooldown, kênh thông báo (in-app, email, webhook).

## Vị trí truy cập
- Menu: `Menu chính` › `Cảnh báo` › `Quy tắc cảnh báo MQTT`
- URL: `/mqtt-alerts`
- Vai trò thấy menu: admin, supervisor

## Quyền yêu cầu
- Resource: `mqtt`
- Actions: `mqtt_alerts` (xem & quản lý)
- Middleware: `protectedProcedure` + `requirePermission('mqtt_alerts')`

## Tiền điều kiện
- MQTT broker đã connect và có message luân chuyển (xem [MQTT Dashboard](../monitoring/mqtt-dashboard.md)).
- Có ít nhất 1 client/topic đã subscribe để rule có target.
- (Khuyến nghị) Đã cấu hình email SMTP hoặc webhook URL trong [Monitoring Settings](../monitoring/monitoring-settings.md).

## Các bước thao tác
1. **Mở danh sách Rules** — vào `/mqtt-alerts`. Bảng: `name`, `topic`, `condition`, `severity`, `channels`, `cooldownSec`, `isActive`, `lastTriggeredAt`, `triggerCount`.
2. **Tạo Rule** — nhấn `+ New Rule`. Form:
   - `name` (bắt buộc), `description`.
   - `topic` (bắt buộc, hỗ trợ wildcard MQTT `+` `#`, vd `factory/+/temperature`).
   - `conditionType`: `payload-field` | `payload-regex` | `frequency` | `silence`.
     - **payload-field**: chọn `field` (vd `value`), `operator` (`>`, `<`, `>=`, `<=`, `==`, `!=`), `threshold`.
     - **payload-regex**: regex match toàn payload.
     - **frequency**: `≥ N messages in M seconds`.
     - **silence**: `no message for ≥ M seconds` (detect offline).
   - `severity`: `info` | `warning` | `critical`.
   - `cooldownSec` (default 60): không re-trigger trong khoảng này dù điều kiện vẫn đúng.
   - `channels`: multi-select `in-app`, `email`, `webhook`. Nếu email/webhook → nhập recipients/URL.
   - `tags` (tuỳ chọn).
3. **Test rule** — nhấn `Simulate` → nhập payload mẫu → xem rule có match không.
4. **Save** — nhấn `Create`. Toast `Tạo rule thành công`. Rule active ngay.
5. **Sửa / Pause / Xoá** — toggle `isActive` để pause; nhấn `Edit` / `Delete` cho thao tác khác.
6. **Xem History** — click vào rule → tab `History` hiển thị các lần trigger gần nhất từ `mqtt_alert_history`.

## Kết quả mong đợi
- Bản ghi mới trong `mqtt_alert_rules` với `id`, `topic`, `condition` (jsonb), `severity`, `cooldownSec`, `isActive = true`.
- Khi message MQTT match: 1 row mới trong `mqtt_alert_history`, 1 row mới trong `alerts` (source = `mqtt`), notification được gửi qua channels đã cấu hình.
- Counter `triggerCount` của rule tăng.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Rule không trigger dù payload đúng | `topic` không match wildcard, hoặc rule `isActive = false` | Kiểm tra topic chính xác (case-sensitive); test bằng `Simulate` |
| Quá nhiều alert (storm) | Cooldown quá ngắn hoặc threshold quá nhạy | Tăng `cooldownSec` (vd 300s), điều chỉnh threshold |
| Email không gửi được | SMTP chưa cấu hình hoặc credentials sai | Mở [Monitoring Settings](../monitoring/monitoring-settings.md) → SMTP test |
| Webhook 4xx/5xx | URL sai hoặc service đích down | Xem `mqtt_alert_history.deliveryError`, sửa URL |
| Silence rule trigger ngay khi tạo | Không có message trong window | Đảm bảo client đang publish; tăng window |

## API liên quan
- `mqttAlertRule.list` (tRPC) — phân trang.
- `mqttAlertRule.create` / `.update` / `.delete`.
- `mqttAlertRule.simulate` — body: `{ ruleConfig, samplePayload }`. Trả về `match: true/false`.
- `mqttAlertRule.history` — params: `ruleId`, `from`, `to`.
- (Internal) Service `mqttAlertEngine.ts` chạy như một subscriber chung, evaluate mọi rule cho mỗi message đến.

## Tính năng liên quan
- [Danh sách Cảnh báo](alerts-list.md) — alert sinh ra hiển thị ở đây.
- [MQTT Dashboard](../monitoring/mqtt-dashboard.md) — xem topic, message rate.
- [MQTT Bulletin](../monitoring/mqtt-bulletin.md) — khai báo topic/client.
- [Monitoring Settings](../monitoring/monitoring-settings.md) — cấu hình SMTP, webhook.

## Ví dụ thực tế
Tình huống: "DevOps cần alert khi nhiệt độ máy `MACHINE-5` (topic `factory/machine-5/temperature`) vượt 75°C, cooldown 5 phút, gửi email cho team duy trì."
1. Vào `/mqtt-alerts` → `+ New Rule`.
2. `name = M5 Overheat`, `topic = factory/machine-5/temperature`.
3. `conditionType = payload-field`, `field = value`, `operator = >`, `threshold = 75`.
4. `severity = critical`, `cooldownSec = 300`.
5. `channels = [in-app, email]`, `recipients = maintenance@plant.com`.
6. Simulate với payload `{"value": 80}` → match ✓ → Save.
7. Khi nhiệt độ thực vượt 75°C: alert xuất hiện ở `/alerts`, mail đến team.

## Q&A nhanh

**Q: MQTT Alert Rule là gì?**
A: Một quy tắc khai báo trong `/mqtt-alerts` cho phép sinh cảnh báo khi message MQTT trên một topic thoả điều kiện (so sánh trường payload, regex, tần suất, hoặc im lặng). Rule được lưu trong `mqtt_alert_rules`, mỗi lần trigger ghi vào `mqtt_alert_history` và `alerts`.

**Q: Có bao nhiêu loại điều kiện (`conditionType`)?**
A: 4 loại: `payload-field` (so sánh một trường với threshold), `payload-regex` (regex match payload), `frequency` (≥N message trong M giây), `silence` (không có message trong M giây → detect offline).

**Q: Các mức severity là gì?**
A: 3 mức: `info`, `warning`, `critical`.

**Q: Channels nào được hỗ trợ?**
A: 3 kênh: `in-app`, `email` (cần SMTP), `webhook` (cần URL).

