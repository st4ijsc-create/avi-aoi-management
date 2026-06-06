# Quản lý MQTT Client

## Mục đích
Quản lý các MQTT client kết nối từ máy/thiết bị tới broker trung tâm, bao gồm credentials, ACL và trạng thái kết nối realtime.

## Vị trí truy cập
- Menu: `Monitoring` › `MQTT` › `Clients`
- URL: `/mqtt/clients`
- Vai trò: admin, engineer

## Quyền yêu cầu
- Resource: `mqtt`
- Actions: `view`, `create`, `update`, `delete`
- Middleware: `requirePermission('mqtt_monitoring')`

## Tiền điều kiện
- MQTT broker đang chạy và endpoint cấu hình trong `.env` (`MQTT_BROKER_URL`).
- Đã tạo MQTT Profile (xem feature liên quan) nếu muốn áp dụng template.

## Các bước thao tác
1. **Mở danh sách** — `MQTT › Clients`. Bảng hiện `clientId`, `username`, `status`, `lastSeen`.
2. **Thêm client** — Nút `+ New Client`. Nhập `clientId` (unique), `username`, `password`, `profile`.
3. **Gán Subscriptions** — Tab `Subscriptions`: thêm topic patterns + QoS.
4. **Kích hoạt** — Toggle `Enabled`. Hệ thống tạo bản ghi `mqtt_clients`.
5. **Test kết nối** — Nút `Test`: gửi ping, kiểm tra ACK.
6. **Xem log** — Tab `Connection Log` để debug disconnect.

## Kết quả mong đợi
- Bản ghi `mqtt_clients` với `enabled=true`.
- Client có thể connect và publish/subscribe theo ACL.
- Status hiện `connected` khi máy thật sự kết nối.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `status='disconnected'` | Sai password | Reset password ở dialog `Edit` |
| ClientId trùng | Đã có client cùng id | Đổi tên hoặc xóa client cũ |
| Không nhận message | Subscription pattern sai | Sửa pattern, dùng `+` `#` đúng cú pháp |

## API liên quan
- `tRPC: mqttClientManagement.list` / `.create` / `.update` / `.delete`.
- `tRPC: mqttClientManagement.testConnection` — trả latency ms.

## Tính năng liên quan
- [MQTT Profiles](../monitoring/mqtt-profiles.md) — template cho nhiều client.
- [MQTT Topics](../monitoring/mqtt-topics.md) — quản lý subscriptions chi tiết.
- [MQTT Dashboard](../monitoring/mqtt-dashboard.md) — overview broker.

## Ví dụ thực tế
Tình huống: "Thêm 10 máy AOI mới line C, mỗi máy 1 MQTT client".
Bước: Tạo MQTT Profile `aoi-line-c` (sub: `factory/F1/lineC/+/inspection`). Vào Clients → New → clientId `aoi-c-01`...`aoi-c-10` cùng profile. Test từng client → connected.
