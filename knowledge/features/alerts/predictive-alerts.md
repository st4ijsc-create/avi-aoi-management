# Cảnh báo Dự báo (Predictive Alerts)

## Mục đích
Hiển thị và quản lý các cảnh báo do mô hình AI/ML dự báo trước khi sự cố thực sự xảy ra: dự báo máy sắp lỗi, NG rate sắp vượt ngưỡng, drift mô hình, MTBF giảm. Cho phép QC/Manager hành động phòng ngừa thay vì chỉ phản ứng.

## Vị trí truy cập
- Menu: `Menu chính` › `Cảnh báo` › `Cảnh báo dự báo`
- URL: `/predictive-alerts`
- Vai trò thấy menu: admin, supervisor

## Quyền yêu cầu
- Resource: `analytics`
- Actions: `analytics_predictive_alerts`
- Middleware: `protectedProcedure` + `requirePermission('analytics_predictive_alerts')`

## Tiền điều kiện
- Đã có dữ liệu lịch sử ≥ 14 ngày (inspection, machine telemetry) để mô hình train được.
- Service `predictiveAlertService` đang chạy (cron mỗi 15 phút mặc định).
- Có ít nhất 1 mô hình dự báo đã được publish (xem [AI Model Management](../ai/ai-model-management.md)).

## Các bước thao tác
1. **Mở dashboard** — vào `/predictive-alerts`. Layout 3 phần:
   - **KPI strip**: số dự báo open, độ tin cậy trung bình, thời gian dự báo trung bình (lead time).
   - **Bảng predictions**: `predictedAt`, `targetType` (`machine` | `product` | `model`), `targetId`, `predictionType` (`failure`, `ng-spike`, `drift`), `predictedFor` (timestamp), `confidence` (%), `severity`, `status`.
   - **Timeline chart**: trục thời gian, mỗi prediction là 1 marker.
2. **Filter** — `predictionType`, `severity`, `confidence ≥ X%`, `targetType`, `from/to` (date range).
3. **Mở chi tiết** — click row → side panel hiển thị:
   - Biểu đồ feature contribution (vì sao mô hình dự báo).
   - Lịch sử các sự kiện gần nhất của target (vd 50 inspection cuối).
   - Action gợi ý (vd `Lên kế hoạch bảo trì máy trong 24h`).
4. **Acknowledge / Dismiss** — nhấn `Acknowledge` (sẽ chuyển sang trang [Alerts List](alerts-list.md) để xử lý) hoặc `Dismiss` (false-positive, dùng để retrain).
5. **Feedback cho mô hình** — đánh giá `useful` / `false-positive` → ghi vào `predictive_alert_feedback`, dùng cho continual learning.

## Kết quả mong đợi
- Khi service chạy: 0–N rows mới trong `predictive_alerts` với `confidence`, `predictedFor`, `featureSnapshot` (jsonb).
- Mỗi row severity ≥ warning cũng tạo entry trong `alerts` (source = `predictive`) → hiện ở [Alerts List](alerts-list.md).
- Acknowledge/Dismiss cập nhật `status` và ghi audit log.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Trang trống "Chưa có dự báo" | Mô hình chưa publish hoặc chưa đủ data | Kiểm tra [AI Model Management](../ai/ai-model-management.md), chờ ≥ 14 ngày data |
| `confidence` luôn rất thấp (<40%) | Mô hình stale / drift | Retrain, xem [AI Active Learning](../ai/ai-active-learning.md) |
| Quá nhiều false-positive | Threshold publish quá thấp | Tăng `minConfidence` trong [AI Settings](../ai/ai-settings.md) |
| Service không sinh dự báo mới | Cron job dừng | Check log `server/services/predictiveAlertService.ts`, restart server |

## API liên quan
- `predictiveAlert.list` (tRPC) — params: `predictionType`, `severity`, `from`, `to`, `minConfidence`.
- `predictiveAlert.detail` — params: `id`. Trả về feature contribution + recent events.
- `predictiveAlert.acknowledge` / `.dismiss`.
- `predictiveAlert.feedback` — body: `{ id, label: 'useful'|'false-positive', note? }`.
- (Internal) `predictiveAlertService.runOnce()` — chạy thủ công cho debug.

## Tính năng liên quan
- [Danh sách Cảnh báo](alerts-list.md) — predictive alert severity ≥ warning xuất hiện ở đây.
- [AI Model Management](../ai/ai-model-management.md) — quản lý mô hình dự báo.
- [AI Active Learning](../ai/ai-active-learning.md) — feedback loop để retrain.
- [Machine Health](../monitoring/machine-health.md) — telemetry feed cho mô hình.
- [SPC Analysis](../analytics/spc-analysis.md) — input feature cho ng-spike prediction.

## Ví dụ thực tế
Tình huống: "Mô hình dự báo `Machine #5` có 78% xác suất lỗi spindle trong 12h tới."
1. Sáng vào `/predictive-alerts`, sort theo `confidence desc`.
2. Top row: `targetId = Machine 5, predictionType = failure, confidence = 78%, predictedFor = +11h30m`.
3. Mở chi tiết → Feature contribution: `vibration_rms_30min`, `current_spike_count`, `temperature_trend` cao nhất.
4. Action gợi ý: `Schedule preventive maintenance within 8 hours`.
5. Acknowledge → tạo công việc bảo trì trong shift kế tiếp.
6. Sau khi sửa: vào lại → Feedback `useful` để mô hình ghi nhận đúng.
