# MQTT Topics & Messages

## Mục đích
Xem, quản lý và debug các topic MQTT đang hoạt động trong hệ thống — bao gồm message log, message rate, và subscription count.

## Vị trí truy cập
- Menu: `Monitoring` › `MQTT` › `Topics & Messages`
- URL: `/mqtt/topics`
- Vai trò: admin, engineer

## Quyền yêu cầu
- Resource: `mqtt`
- Actions: `view`, `inspect`
- Middleware: `requirePermission('mqtt_monitoring')`

## Tiền điều kiện
- Broker đang chạy có client đang publish.
- (Tùy chọn) bật `MQTT_LOG_MESSAGES=true` để lưu message vào DB.

## Các bước thao tác
1. **Mở trang Topics** — Bảng tree-view các topic theo prefix.
2. **Lọc topic** — Search box pattern: `factory/F1/+/+/inspection`.
3. **Xem live stream** — Click topic → panel bên phải hiện realtime messages (websocket).
4. **Xem lịch sử** — Tab `History` lấy từ `mqtt_message_logs` với date range.
5. **Publish thử** — Nút `Publish Test`: nhập payload JSON → gửi để test consumer.
6. **Subscribe quản lý** — Tab `Subscriptions`: xem clients nào subscribe topic này.

## Kết quả mong đợi
- Live stream cập nhật realtime (< 100ms latency).
- History query trả về tối đa 1000 messages mới nhất theo filter.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Live stream không có data | Topic chưa có publisher | Kiểm tra client có online không |
| History trống | `MQTT_LOG_MESSAGES=false` | Bật env và restart server |
| Publish test fail 403 | Thiếu quyền | Cần `mqtt:publish` resource |

## API liên quan
- `tRPC: mqtt.listTopics` — trả tree với count.
- `tRPC: mqtt.history` — input `{ topic, from, to, limit }`.
- `WebSocket /ws/mqtt/stream?topic=...` — live messages.

## Tính năng liên quan
- [MQTT Replay](../monitoring/mqtt-replay.md) — phát lại lịch sử.
- [MQTT Bulletin](../monitoring/mqtt-bulletin.md) — gửi thông báo theo topic.

## Ví dụ thực tế
Tình huống: "Engineer nghi machine M-05 không publish heartbeat".
Bước: Topics → search `factory/F1/+/M-05/heartbeat` → live stream trống 5 phút. Xem History 24h → lần cuối 18:30 hôm qua → confirm máy mất kết nối → check power/network.
