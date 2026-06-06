# Root Cause Analysis (RCA)

## Mục đích
Sử dụng AI/heuristics phân tích nguyên nhân gốc rễ của bất thường chất lượng — kết hợp dữ liệu inspection, MQTT, sensors, machine status để gợi ý root cause.

## Vị trí truy cập
- Menu: `Analytics` › `Root Cause Analysis`
- URL: `/analytics/root-cause`
- Vai trò: admin, manager, quality-engineer

## Quyền yêu cầu
- Resource: `analytics_advanced`
- Actions: `analyze`
- Middleware: `requirePermission('analytics_advanced')`

## Tiền điều kiện
- Có dữ liệu inspection ≥ 7 ngày.
- Sensors/MQTT data đã ingest.
- Predictive alerts module hoạt động.

## Các bước thao tác
1. **Chọn anomaly** — Từ alert, từ Pareto, hoặc nhập manual: thời điểm + line + defect type.
2. **Run RCA** — Nút `Analyze`. AI thu thập:
   - Top contributing machines.
   - Sensor outliers (temp, voltage).
   - Operator shift correlation.
   - Material lot correlation.
3. **Xem kết quả** — Cây Ishikawa-like + ranked causes với confidence %.
4. **Đánh giá** — Mỗi cause có nút `Confirm` / `Reject` để feed back AI.
5. **Tạo action item** — Nút `Create CAPA` (Corrective Action / Preventive Action).
6. **Lưu phân tích** — `root_cause_analysis` table.

## Kết quả mong đợi
- Trả 3-5 nguyên nhân ranked theo confidence (>70% là đáng chú ý).
- Có evidence link tới inspection/sensor data.
- Feedback cải thiện model qua thời gian.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Confidence thấp toàn bộ | Data ít | Chờ thêm data hoặc mở rộng date range |
| Cause không hợp lý | Model thiếu context | Reject → AI học |

## API liên quan
- `tRPC: rootCause.analyze` — input `{ anomalyId / customScope }`.
- `tRPC: rootCause.history` — list các phân tích cũ.
- `tRPC: rootCause.feedback`.

## Tính năng liên quan
- [Pareto Analysis](../analytics/pareto-analysis.md) — bước trước RCA.
- [Cảnh báo dự báo](../alerts/predictive-alerts.md).
- [Defect Heatmap](../analytics/defect-heatmap.md).

## Ví dụ thực tế
Tình huống: "Sáng nay NG `Solder Bridge` tăng 3x trên line B".
Bước: Analytics → RCA → input: line B, 6h-10h, defect `Solder Bridge`. Run → top cause: Machine M-12 reflow temperature drift -8°C (confidence 89%); secondary: solder lot LOT-2024-08 (confidence 64%). Confirm cause 1 → tạo CAPA: re-calibrate M-12.
