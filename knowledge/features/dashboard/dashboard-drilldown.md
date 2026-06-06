# Drill-Down Dashboard

## Mục đích
Phân tích chi tiết đa cấp (factory → line → machine → station → defect) cho bất kỳ chỉ số nào trên dashboard chính, giúp truy nguyên nhanh nguồn gốc bất thường.

## Vị trí truy cập
- Menu: `Dashboard` › `Drill-Down`
- URL: `/dashboard/drilldown`
- Vai trò thấy menu: admin, manager, engineer

## Quyền yêu cầu
- Resource: `dashboard`
- Actions: `view`, `drilldown`
- Middleware: `requirePermission('dashboard_drilldown')`

## Tiền điều kiện
- Có dữ liệu `inspections` và `measurement_results` trong khoảng thời gian phân tích.
- Đã định nghĩa hierarchy Factory > Workshop > Line > Machine.

## Các bước thao tác
1. **Chọn metric** — Dropdown `Metric`: NG Rate / Pass Rate / Throughput / Cycle Time / Defect Count.
2. **Chọn dimension đầu tiên** — Mặc định `Factory`. Có thể đổi `Line`, `Machine`, `Defect Type`.
3. **Xem bảng/biểu đồ cấp 1** — Sắp xếp giảm dần theo metric.
4. **Click hàng** — Drill xuống cấp tiếp theo (Line → Machine → Station).
5. **Lọc bổ sung** — Date range, Product Model, Shift.
6. **Export** — Nút `Export CSV` ở góc phải.

## Kết quả mong đợi
- URL update với query params giúp share link.
- Breadcrumb hiển thị đường drill: `F1 > Line A > Machine M01 > St-3`.
- Mỗi cấp drill < 1.5s response time.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| "Không có dữ liệu cho cấp này" | Hierarchy chưa gán đầy đủ | Vào Corporate Layout kiểm tra |
| Drill chậm > 5s | Khoảng thời gian quá lớn | Thu hẹp date range về ≤ 7 ngày |

## API liên quan
- `tRPC: drillDown.analyze` — input: `{ metric, dimensions[], filters, dateRange }`.
- `tRPC: dashboard.timeline` — biểu đồ xu hướng tại mỗi cấp.

## Tính năng liên quan
- [Dashboard chính](../dashboard/dashboard-view.md) — entry point.
- [Pareto Analysis](../analytics/pareto-analysis.md) — phân tích defect 80/20.
- [Root Cause Analysis](../analytics/root-cause-analysis.md) — AI gợi ý nguyên nhân.

## Ví dụ thực tế
Tình huống: "NG Rate hôm nay tăng đột biến lên 5.1%".
Bước: Chọn metric `NG Rate`, dim `Factory` → F1 cao nhất 5.8% → click F1 → Line B 8.2% → click Line B → Machine M-07 chiếm 62% NG. Click M-07 → Station St-2 → defect `Missing Component` chiếm 78%. Mở Pareto để xác nhận.
