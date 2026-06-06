# MQTT Replay

## Mục đích
Phát lại tin nhắn MQTT lịch sử để test consumer mới, debug logic xử lý hoặc tái tạo sự cố trên môi trường staging.

## Vị trí truy cập
- Menu: `Monitoring` › `MQTT` › `Replay`
- URL: `/mqtt/replay`
- Vai trò: admin, engineer (cấp cao)

## Quyền yêu cầu
- Resource: `mqtt`
- Actions: `replay`
- Middleware: `requirePermission('mqtt_replay')`

## Tiền điều kiện
- `MQTT_LOG_MESSAGES=true` đã bật và có dữ liệu trong `mqtt_message_history`.
- Có broker đích (có thể staging) để publish lại.

## Các bước thao tác
1. **Chọn nguồn** — Date range + topic pattern.
2. **Preview** — Bảng hiện messages khớp filter, count tổng.
3. **Cấu hình replay** — `Speed` (1x/2x/10x), `Target broker` (current/staging), `Topic remap` (optional rename prefix).
4. **Start Replay** — Nút `Start`. Progress bar hiển thị `X / Total` published.
5. **Pause/Stop** — Có thể dừng giữa chừng. Status: `running`, `paused`, `done`.
6. **Audit log** — Mọi replay lưu vào `audit_logs` với resource `mqtt_replay`.

## Kết quả mong đợi
- Messages được publish lại đúng thứ tự theo timestamp.
- Speed 1x giữ nguyên gap thời gian gốc; speed 10x giảm gap 10 lần.
- Bản ghi audit ghi rõ user, time, count.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Messages bị duplicate downstream | Consumer không idempotent | Dùng topic remap để route sang topic test |
| Replay quá nhanh, broker drop | Speed quá cao | Giảm speed về 2x-5x |
| 403 khi start | Thiếu `mqtt_replay` | Admin gán quyền |

## API liên quan
- `tRPC: mqttReplay.preview` — input filter, trả count + sample.
- `tRPC: mqttReplay.start` — input `{ filter, speed, target, remap }` → trả `replayId`.
- `tRPC: mqttReplay.status` — poll progress.

## Tính năng liên quan
- [MQTT Topics](../monitoring/mqtt-topics.md) — xem trước data trước khi replay.
- [Audit Logs](../admin/audit-logs.md) — kiểm tra ai đã replay.

## Ví dụ thực tế
Tình huống: "Tái tạo sự cố NG burst 14:00-14:30 hôm qua trên staging".
Bước: Date range 14:00-14:30 ngày hôm qua, topic `factory/F1/+/+/inspection`. Preview 12,000 messages. Target = staging broker, speed 5x → replay xong sau 6 phút. Quan sát alert engine staging đã trigger đúng cảnh báo.
