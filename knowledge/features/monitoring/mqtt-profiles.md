# MQTT Profiles

## Mục đích
Tạo template cấu hình MQTT (subscriptions, QoS, retain, ACL) áp dụng cho nhiều client cùng loại, giúp triển khai nhanh và đồng nhất.

## Vị trí truy cập
- Menu: `Monitoring` › `MQTT` › `Profiles`
- URL: `/mqtt/profiles`
- Vai trò: admin, engineer

## Quyền yêu cầu
- Resource: `mqtt`
- Actions: `view`, `create`, `update`, `assign`
- Middleware: `requirePermission('mqtt_monitoring')`

## Tiền điều kiện
- Đã hiểu cấu trúc topic của hệ thống (`factory/{id}/line/{id}/machine/{id}/...`).

## Các bước thao tác
1. **Mở Profiles** — Bảng hiện `name`, `description`, `clientCount`.
2. **Tạo profile** — Nút `New Profile`. Nhập `name`, mô tả.
3. **Thêm Subscriptions** — Mỗi dòng: `topic pattern`, `qos (0/1/2)`, `retainHandling`.
4. **Thêm Publish ACL** — Topics mà client được phép publish.
5. **Save** — Hệ thống lưu `mqtt_client_profiles`.
6. **Gán cho Clients** — Sang trang Clients → multi-select → Apply Profile → `mqtt_profile_assignments`.

## Kết quả mong đợi
- Profile xuất hiện với badge số client đang gán.
- Khi update profile, các client gán tự động re-subscribe.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Client không nhận topic mới | Cache MQTT broker | Bounce client connection |
| Không cho gán profile | Client đã có profile khác | Bỏ gán profile cũ trước |

## API liên quan
- `tRPC: mqttProfile.list / create / update / delete`.
- `tRPC: mqttProfile.assign` — input `{ profileId, clientIds[] }`.

## Tính năng liên quan
- [Quản lý MQTT Client](../monitoring/mqtt-client-mgmt.md).
- [MQTT Topics](../monitoring/mqtt-topics.md).

## Ví dụ thực tế
Tình huống: "10 máy AOI line C cần cùng 5 subscription identical".
Bước: Tạo profile `aoi-line-c` với subs `factory/+/lineC/+/inspection`, `.../alarm`, `.../heartbeat`. Gán cho 10 client. Khi cần thêm topic `.../telemetry`, chỉ sửa profile → tất cả 10 client tự cập nhật.
