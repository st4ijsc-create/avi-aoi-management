# Danh sách Cảnh báo (Alerts List)

## Mục đích
Trung tâm tổng hợp tất cả cảnh báo hệ thống: cảnh báo từ máy (offline, error), từ inspection (NG rate vượt ngưỡng), từ MQTT rules, từ AI predictive, từ SPC. Cho phép xem, filter, acknowledge, resolve, gán người xử lý, ghi nhận root-cause.

## Vị trí truy cập
- Menu: `Menu chính` › `Cảnh báo` › `Danh sách cảnh báo`
- URL: `/alerts`
- Vai trò thấy menu: admin, supervisor, quality_inspector

## Quyền yêu cầu
- Resource: `alerts`
- Actions: `alerts_view` (xem); `alerts_acknowledge` (ack/resolve)
- Middleware: `protectedProcedure` + `requirePermission('alerts_view')`

## Tiền điều kiện
- Hệ thống đã chạy ít nhất 1 trong các nguồn cảnh báo: MQTT alert rules, predictive alerts, SPC alerts, machine offline detector.
- Có user đang đăng nhập với quyền `alerts_view`.

## Các bước thao tác
1. **Mở danh sách Alerts** — vào `/alerts`. Bảng hiển thị: `severity` (info/warning/critical), `source` (machine/mqtt/predictive/spc/ai), `machine`, `message`, `triggeredAt`, `status` (`new`/`acknowledged`/`resolved`), `acknowledgedBy`, `resolvedBy`.
2. **Filter** — sidebar filter:
   - `severity` (multi)
   - `source` (multi)
   - `status` (multi, default: new + acknowledged)
   - `machineId`, `productId`
   - `from / to` (datetime range, default 24h gần nhất)
3. **Acknowledge** — chọn alert → nhấn `Acknowledge`. Dialog yêu cầu nhập `note` (tuỳ chọn). Status → `acknowledged`, `acknowledgedBy = currentUser`, `acknowledgedAt = now()`.
4. **Resolve** — nhấn `Resolve`. Dialog yêu cầu chọn `rootCauseCategory` (`hardware`, `process`, `material`, `false-positive`, …) và `resolution` (text). Status → `resolved`.
5. **Bulk acknowledge** — chọn nhiều rows → nhấn `Bulk Acknowledge`.
6. **Mở chi tiết** — click vào row → side panel hiển thị timeline, related inspection records, related MQTT messages, AI Root-Cause Analysis suggestion (nếu có).
7. **Subscribe realtime** — toggle `Live` → SSE/WebSocket push alerts mới vào đầu danh sách.

## Kết quả mong đợi
- Cập nhật cột `status` trong bảng `alerts`.
- Phát SSE event `alert.updated` cho các client đang mở `/alerts`.
- Nếu resolve: trigger `rootCauseAnalysis` job nền (nếu cấu hình).
- Audit log mới trong `audit_logs` với `action = alert.acknowledge` / `alert.resolve`.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Không thấy alert mới | Filter `status = resolved` đang ẩn | Bỏ filter resolved |
| Nút `Acknowledge` bị disable | Thiếu quyền `alerts_acknowledge` | Liên hệ admin gán quyền |
| SSE Live không cập nhật | Browser block hoặc proxy ngắt connection | Refresh trang, kiểm tra reverse-proxy buffer |
| Quá nhiều alert "noise" | Threshold quá nhạy | Vào [MQTT Alert Rules](mqtt-alert-rules.md) chỉnh threshold |

## API liên quan
- `alert.list` (tRPC) — params: `severity`, `source`, `status`, `from`, `to`, `cursor`, `limit`.
- `alert.acknowledge` (tRPC) — body: `{ alertId, note? }`.
- `alert.resolve` (tRPC) — body: `{ alertId, rootCauseCategory, resolution }`.
- `GET /api/external/alerts` — External API.
- `POST /api/external/alerts/:alertId/acknowledge` — External API.
- `POST /api/external/alerts/:alertId/resolve` — External API.
- SSE: `GET /api/sse/alerts` — push realtime.

## Tính năng liên quan
- [MQTT Alert Rules](mqtt-alert-rules.md) — định nghĩa rule sinh alert.
- [Predictive Alerts](predictive-alerts.md) — alert AI dự báo.
- [OEE Targets](oee-targets.md) — target sinh alert OEE drop.
- [Machine Health](../monitoring/machine-health.md) — alert offline/error từ máy.
- [Root Cause Analysis](../analytics/spc-analysis.md) (liên quan SPC).

## Ví dụ thực tế
Tình huống: "Supervisor ca đêm thấy 3 alert critical lúc 02:30 do `Machine #6` offline."
1. Mở `/alerts`, filter `severity = critical`, `from = -2h`.
2. Chọn 3 alerts → Bulk Acknowledge với note `Đang kiểm tra power`.
3. Sau khi kỹ thuật viên fix xong, mở từng alert → Resolve với `rootCauseCategory = hardware`, `resolution = Replaced power supply`.
4. Sáng hôm sau Manager xem báo cáo: `/alerts?status=resolved&from=last-shift` để review.
