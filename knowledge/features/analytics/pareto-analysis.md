# Phân tích Pareto (Pareto Analysis)

## 1. Mục đích
Áp dụng nguyên lý 80/20 để xếp hạng lỗi theo loại / máy / line / khung thời gian, giúp đội cải tiến tập trung xử lý nhóm lỗi gây ảnh hưởng nhiều nhất.

## 2. Vị trí truy cập
- URL: `/pareto-analysis`
- Menu: Analytics → Pareto Analysis

## 3. Quyền yêu cầu
- `analytics_` (truy cập analytics chung)
- Category: `analytics`

## 4. Tiền điều kiện
- Có inspections kèm `defectTypes` đã phân loại
- Đã khai báo line/machine/factory để bộ lọc hoạt động

## 5. Các bước thao tác
1. Chọn khoảng thời gian (mặc định 30 ngày)
2. Chọn tab `By Type` / `By Machine` / `By Line` / `By Time Period`
3. Áp dụng bộ lọc Factory / Line / Machine
4. Với tab `By Time Period`, chọn `groupBy`: hour / shift / day / week
5. Xem bar chart + cumulative % line, top-N có thể giới hạn (vd top 15)
6. Nhấn Export CSV (Category, Count, Percentage, Cumulative %)

## 6. Kết quả mong đợi
- Bar chart sorted desc, line cumulative% chạm ~80% ở 20% nhóm đầu
- Bảng ranked items đồng bộ
- CSV có đầy đủ cột

## 7. Lỗi thường gặp & cách xử lý
- Quá nhiều category → biểu đồ rối, áp dụng top-N filter
- Dataset rỗng → mở rộng range hoặc bỏ bộ lọc Machine
- Nhóm `Unknown` chiếm % lớn → kiểm tra defect classification ở module Inspection

## 8. API liên quan
- `trpc.factory.list`, `trpc.line.list`, `trpc.machine.list`
- `trpc.paretoAnalysis.byDefectType({ startDate, endDate, factoryId?, lineId?, machineId? })`
- `trpc.paretoAnalysis.byMachine(...)`
- `trpc.paretoAnalysis.byLine(...)`
- `trpc.paretoAnalysis.byTimePeriod({ ...filter, groupBy })`

## 9. Tính năng liên quan
- [SPC Analysis](analytics/spc-analysis.md)
- [Defect Heatmap](analytics/defect-heatmap.md)
- [Reports](analytics/reports.md)

## 10. Ví dụ thực tế
Quản lý chất lượng chọn 30 ngày, tab `By Type`: top 3 lỗi `Solder Bridge` (450), `Missing Pad` (280), `Cold Joint` (120) chiếm ~92% tổng. Chuyển tab `By Time Period` group `shift` thấy ca 2 NG cao hơn 65% → đề xuất đào tạo kỹ thuật ca 2.
