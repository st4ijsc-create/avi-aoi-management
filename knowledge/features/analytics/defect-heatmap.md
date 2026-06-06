# Bản đồ nhiệt lỗi (Defect Heatmap)

## 1. Mục đích
Hiển thị bản đồ 2D vị trí lỗi trên sản phẩm/PCB (X/Y coordinates) với gradient màu từ xanh (ít lỗi) sang đỏ (nhiều lỗi), giúp xác định vùng lỗi tập trung.

## 2. Vị trí truy cập
- URL: `/defect-heatmap`
- Menu: Analytics → Defect Heatmap

## 3. Quyền yêu cầu
- `analytics_defect_heatmap`
- Category: `analytics`

## 4. Tiền điều kiện
- Đã bật `defectMeasurementPoints` cho product (có toạ độ X/Y)
- Có ảnh outline sản phẩm (PCB diagram) tải được

## 5. Các bước thao tác
1. Mở trang Defect Heatmap
2. Tab `Heatmap`: xem bản đồ nhiệt phủ trên outline sản phẩm
3. Hover vùng đỏ → xem tooltip count, types, last incident
4. Click vùng đỏ → drill-down danh sách inspections gần nhất tại vùng đó
5. Tab `Trend Analysis`: xem xu hướng tần suất lỗi của vùng đã chọn theo thời gian
6. Xuất dữ liệu (zone ID, defect counts, coordinates) sang CSV

## 6. Kết quả mong đợi
- Bản đồ render đúng outline sản phẩm với gradient màu
- Tooltip hiển thị thông tin chi tiết khi hover
- Drill-down list các inspections vùng được chọn
- Trend chart cho vùng được chọn

## 7. Lỗi thường gặp & cách xử lý
- Ảnh outline không tải → fallback placeholder xám; kiểm tra URL ảnh trong product setup
- Không có dữ liệu vị trí → bật `Enable measurement points` trong Product Setup
- Render chậm với dataset lớn → áp dụng pagination/limit client-side

## 8. API liên quan
- Component lazy-load: `DefectHeatmap`, `TrendAnalysisChart`
- DB: `inspections`, `defectMeasurementPoints`

## 9. Tính năng liên quan
- [SPC Analysis](analytics/spc-analysis.md)
- [Pareto Analysis](analytics/pareto-analysis.md)
- Products → Measurement Points

## 10. Ví dụ thực tế
Kỹ sư nhìn heatmap mẫu PCB-A và thấy góc trên-trái đỏ đậm. Click vào vùng → 32 lỗi `Solder Bridge` ghi nhận trong 14 ngày qua. Mở Trend Analysis cho vùng này thấy lỗi tăng đột biến từ 2026-05-05 → trùng thời điểm thay batch solder paste mới.
