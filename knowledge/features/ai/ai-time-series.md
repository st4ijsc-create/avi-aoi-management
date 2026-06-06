# Phân tích chuỗi thời gian AI (AI Time Series)

## 1. Mục đích
Phân tích chuỗi thời gian metric chất lượng (Defect Rate, Yield Rate, Inspection Count): forecast, anomaly detection, decomposition (trend/seasonal/residual), changepoints.

## 2. Vị trí truy cập
- URL: `/ai-time-series`
- Menu: AI → Time Series

## 3. Quyền yêu cầu
- Tính năng AI

## 4. Tiền điều kiện
- Có inspections aggregated theo bucket thời gian
- ≥ 30 điểm dữ liệu để forecast hợp lệ

## 5. Các bước thao tác
1. Chọn metric (Defect Rate / Yield Rate / Inspection Count...)
2. Chọn period (1d / 7d / 30d / 90d)
3. Chọn analysis type tab: Analyze / Forecast / Anomaly / Decompose / Changepoints
4. Click `Run Analysis` → mutation `analyzeMetric` xử lý
5. Xem chart + summary
6. Forecast: đường nét đứt nối tiếp lịch sử
7. Anomaly: highlight ngày bất thường + z-score + cause
8. Xuất CSV (timestamp, actual, forecast, anomaly_flag)

## 6. Kết quả mong đợi
- Chart x=date, y=metric, đầy đủ summary
- Forecast 7 ngày tới
- Anomaly list rõ severity
- Decompose 3 components

## 7. Lỗi thường gặp & cách xử lý
- Metric không có data → "No data for selected metric"
- < 30 điểm → cảnh báo cần period dài hơn
- Anomaly false positive → tăng z-score threshold

## 8. API liên quan
- `trpc.aiTimeSeries.analyzeMetric({ metric, period, analysisType })` (mutation chung)

## 9. Tính năng liên quan
- [SPC Analysis](analytics/spc-analysis.md)
- [AI Inspection Analytics](ai/ai-inspection-analytics.md)
- [AI Reports](ai/ai-reports.md)

## 10. Ví dụ thực tế
Engineer chọn metric Defect Rate, period 30d, tab Forecast → AI dự báo defect rate giữ 3.0-3.4% trong 7 ngày tới. Tab Anomaly phát hiện 2 spike (2026-05-03: 5.1%, 2026-05-09: 4.8%) → kiểm tra log thấy trùng ngày bảo trì máy SMT-02.
