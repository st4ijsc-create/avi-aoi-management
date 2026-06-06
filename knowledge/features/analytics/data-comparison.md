# So sánh Dữ liệu (Data Comparison)

## Mục đích
So sánh các chỉ số sản xuất/chất lượng giữa hai khoảng thời gian, giữa hai line, hoặc giữa hai product để đánh giá thay đổi và hiệu quả cải tiến.

## Vị trí truy cập
- Menu: `Analytics` › `Data Comparison`
- URL: `/analytics/data-comparison`
- Vai trò: admin, manager, engineer

## Quyền yêu cầu
- Resource: `analytics_advanced`
- Actions: `view`
- Middleware: `requirePermission('analytics_advanced')`

## Tiền điều kiện
- Có dữ liệu trong cả 2 nhóm so sánh.

## Các bước thao tác
1. **Chọn mode** — Compare by Time / by Line / by Product / by Shift.
2. **Group A & Group B** — Mỗi group định nghĩa filter (date range, line, product).
3. **Chọn metrics** — NG Rate, Throughput, Cycle Time, OEE, Top Defects.
4. **Run** — Bảng side-by-side hiện giá trị, delta tuyệt đối, delta %, p-value (t-test).
5. **Biểu đồ** — Bar chart cạnh nhau cho từng metric.
6. **Statistical significance** — Highlight metric có p < 0.05.
7. **Export** — Excel với detail.

## Kết quả mong đợi
- Bảng so sánh rõ ràng, mũi tên ↑↓ với màu xanh/đỏ.
- Cảnh báo nếu thay đổi đột biến > 20%.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Sample sizes lệch lớn | Date range khác nhau | Chuẩn hóa range tương đương |
| p-value = N/A | Sample quá nhỏ | Tăng date range |

## API liên quan
- `tRPC: dataComparison.compare` — input `{ mode, groupA, groupB, metrics }`.

## Tính năng liên quan
- [Pareto Analysis](../analytics/pareto-analysis.md).
- [Drill-Down](../dashboard/dashboard-drilldown.md).

## Ví dụ thực tế
Tình huống: "Line A trước và sau khi thay reflow oven mới (1/5/2026)".
Bước: Mode = by Time. Group A = `1-30/4`, Group B = `1-30/5`, scope = Line A. Metrics = NG, Cold Solder count. Result: NG giảm 4.2% → 2.8% (delta -33%, p<0.001). Cold Solder giảm 60%. Kết luận: oven mới hiệu quả.
