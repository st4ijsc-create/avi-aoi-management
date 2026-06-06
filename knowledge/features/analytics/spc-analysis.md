# Phân tích SPC (SPC Analysis)

## 1. Mục đích
Phân tích kiểm soát quá trình thống kê (SPC): Pareto top NG, xu hướng yield + dự báo, phát hiện bất thường (anomaly), gợi ý nguyên nhân gốc (root cause) bằng AI.

## 2. Vị trí truy cập
- URL: `/spc-analysis`
- Menu: Analytics → SPC Analysis

## 3. Quyền yêu cầu
- `analytics_spc`
- Category: `analytics`

## 4. Tiền điều kiện
- Có inspections trong khoảng thời gian
- Để có dự báo cần ≥ 30 điểm dữ liệu lịch sử
- Cấu hình `defectMeasurementPoints` để phân tích vị trí NG

## 5. Các bước thao tác
1. Chọn khoảng thời gian (mặc định 30 ngày), Machine, Factory, Interval (day/week)
2. Tab `Pareto`: xem top 10 loại lỗi với cột tích luỹ %
3. Tab `Trend + Prediction`: xem yield theo thời gian + dự báo `predictDays` ngày
4. Tab `Anomaly`: điều chỉnh `zScoreThreshold` nếu false positive nhiều
5. Tab `Root Cause`: AI gợi ý nguyên nhân (ví dụ "kiểm tra hiệu chỉnh lò reflow")
6. Xuất dữ liệu xu hướng/Pareto sang CSV

## 6. Kết quả mong đợi
- Pareto chart với cột count + line cumulative %
- Trend chart có đường liền (actual) + đường nét đứt (forecast)
- Anomaly heatmap đánh dấu ngày bất thường, kèm reason
- Root cause: danh sách gợi ý ưu tiên

## 7. Lỗi thường gặp & cách xử lý
- Anomaly quá nhiều false positive → tăng `zScoreThreshold` (vd 2.5 → 3.0)
- Không có forecast → dữ liệu < 30 điểm, mở rộng khoảng thời gian
- Pareto rỗng theo machine filter → chuyển bộ lọc về tất cả máy

## 8. API liên quan
- `trpc.machine.list`, `trpc.factory.list`
- `trpc.spcAnalysis.topNGPoints({ startDate, endDate, machineId?, factoryCode?, limit })`
- `trpc.spcAnalysis.yieldTrend({ startDate, endDate, machineId?, factoryCode?, interval, predictDays })`
- `trpc.spcAnalysis.detectAnomalies({ machineId?, factoryCode?, days, zScoreThreshold })`
- `trpc.spcAnalysis.rootCauseSuggestions({ startDate, endDate, machineId?, factoryCode? })`

## 9. Tính năng liên quan
- [SPC Rule Catalog (13 luật: 4 WE + 8 Nelson + 1 EWMA)](analytics/spc-rules.md)
- [Pareto Analysis](analytics/pareto-analysis.md)
- [Defect Heatmap](analytics/defect-heatmap.md)
- [AI Time Series](ai/ai-time-series.md)

## 11. Bộ luật phát hiện vi phạm
Hệ thống chạy **13 luật SPC** trên dữ liệu measurement: 4 Western Electric (`WE_1..WE_4`), 8 Nelson (`NELSON_1..NELSON_8`), và 1 EWMA (`EWMA_OOC`). Chi tiết xem [spc-rules.md](analytics/spc-rules.md).

## 10. Ví dụ thực tế
Kỹ sư SPC chọn 30 ngày, máy SMT-02. Pareto cho thấy `Solder Bridge` chiếm 38% tổng NG. Tab Root Cause AI gợi ý: "Solder Bridge tăng 45% sau 2026-05-01, kiểm tra hiệu chỉnh lò reflow." Đội bảo trì xác nhận lệch nhiệt zone 4 và hiệu chỉnh lại.

## 12. Q&A nhanh

**Q: SPC Analysis là gì?**
A: Một trang phân tích tại `/spc-analysis` gồm 4 tab: Pareto top NG, Trend + Prediction (dự báo yield), Anomaly (z-score), và Root Cause (gợi ý nguyên nhân bằng AI). Khác với `/spc-advanced` (control chart + 13 luật vi phạm), trang này tập trung vào phân tích xu hướng và Pareto.

**Q: SPC Analysis khác SPC Advanced thế nào?**
A: `/spc-analysis` = Pareto/Trend/Anomaly/Root Cause; `/spc-advanced` = Control Chart + danh sách vi phạm theo 13 luật SPC. Để xem chi tiết 13 luật xem [spc-rules.md](analytics/spc-rules.md).
