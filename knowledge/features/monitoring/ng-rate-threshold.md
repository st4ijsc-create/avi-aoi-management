# Ngưỡng NG Rate

## Mục đích
Cấu hình ngưỡng cảnh báo NG Rate (tỉ lệ lỗi) cho từng station/máy, để hệ thống tự phát alert khi vượt ngưỡng trong cửa sổ thời gian định trước.

## Vị trí truy cập
- Menu: `Monitoring` › `MQTT` › `NG Rate Threshold`
- URL: `/mqtt/ng-rate-threshold`
- Vai trò: admin, engineer, manager

## Quyền yêu cầu
- Resource: `mqtt_ng_rate_threshold`
- Actions: `view`, `create`, `update`, `delete`
- Middleware: `requirePermission('mqtt_ng_rate_threshold')`

## Tiền điều kiện
- Đã đăng ký máy/station trong hệ thống.
- Đã có dữ liệu inspection để tính NG Rate.

## Các bước thao tác
1. **Mở trang** — Bảng hiện rules: `station`, `threshold %`, `window`, `minSamples`, `enabled`.
2. **Thêm rule** — Nút `+ Add Rule`. Nhập:
   - `Station/Machine` (chọn từ dropdown).
   - `Threshold` (vd: 5.0%).
   - `Window` (vd: 30 minutes).
   - `Min samples` (vd: 50 — tránh nhiễu khi sample ít).
   - `Severity` (warning / critical).
3. **Save** — Tạo bản ghi `mqtt_ng_rate_thresholds`.
4. **Test rule** — Nút `Simulate`: nhập NG count + total → preview có trigger alert không.
5. **Bật/tắt** — Toggle `enabled` từng rule không cần xóa.

## Kết quả mong đợi
- Khi NG Rate vượt threshold trong window, hệ thống ghi vào `alerts` và publish topic `factory/{id}/alerts/ng-rate`.
- Email/SMS gửi nếu rule liên kết với notification channel.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Alert spam liên tục | `minSamples` quá thấp | Tăng lên 100+ |
| Không có alert dù NG cao | `enabled=false` | Bật rule |
| Window quá ngắn | False positive | Tăng lên 15-30 phút |

## API liên quan
- `tRPC: ngRateThreshold.list / create / update / delete / simulate`.

## Tính năng liên quan
- [Cảnh báo MQTT](../alerts/mqtt-alert-rules.md) — engine xử lý alert.
- [Cảnh báo](../alerts/alerts-list.md) — xem alerts đã trigger.
- [SPC Analysis](../analytics/spc-analysis.md) — phân tích sâu hơn.

## Ví dụ thực tế
Tình huống: "Line A station St-3 thường có NG ~2%, muốn alert khi vượt 4% trong 15 phút".
Bước: Add rule station `St-3-LineA`, threshold `4.0%`, window `15m`, minSamples `60`, severity `warning`. Simulate với NG=3, Total=60 → 5% > 4% → trigger. Save.
