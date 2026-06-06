# Dự báo Khiếm tật (Defect Prediction)

## Mục đích
Dự báo xác suất xuất hiện defect trong tương lai gần dựa trên xu hướng và sensor data, cho phép can thiệp trước khi sự cố xảy ra.

## Vị trí truy cập
- Menu: `Analytics` › `Defect Prediction`
- URL: `/analytics/defect-prediction`
- Vai trò: admin, manager, engineer

## Quyền yêu cầu
- Resource: `analytics_advanced`
- Actions: `view`, `predict`
- Middleware: `requirePermission('analytics_advanced')`

## Tiền điều kiện
- Đã có model dự báo deployed (xem AI Model Management).
- Sensor và inspection data realtime.

## Các bước thao tác
1. **Chọn scope** — Line, Machine, Product Model.
2. **Chọn horizon** — 1h / 4h / 24h.
3. **View prediction** — Card hiện xác suất NG dự báo + biểu đồ confidence interval.
4. **Top defect risks** — Bảng defect type ranked theo predicted count.
5. **Recommended actions** — AI gợi ý: calibrate machine X, change lot Y...
6. **Tạo predictive alert** — Nếu xác suất > threshold → tự động ghi `predictive_alerts`.

## Kết quả mong đợi
- Prediction update mỗi 5 phút.
- Accuracy tracking: predicted vs actual sau khi qua horizon.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Prediction = 0 | Model chưa load | Reload model trong AI Settings |
| Sai số lớn | Model cũ | Re-train với data mới |
| No data | Sensor offline | Check MQTT |

## API liên quan
- `tRPC: defectPrediction.predict / topRisks / recommendations`.

## Tính năng liên quan
- [Cảnh báo dự báo](../alerts/predictive-alerts.md).
- [Time Series Forecast](../ai/ai-time-series.md).
- [Root Cause Analysis](../analytics/root-cause-analysis.md).

## Ví dụ thực tế
Tình huống: "Sáng thứ 2, line A khởi động — muốn biết rủi ro NG 4 giờ tới".
Bước: Scope = Line A, horizon = 4h → predicted NG rate 3.8% (CI: 2.9-4.7%). Top risk: `Cold Solder` (45% probability) do reflow temp đang lệch -3°C. Action: pre-warm 15 phút. Sau 4h: actual 3.5% — model chính xác.
