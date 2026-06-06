# Xem Dashboard

## Mục đích
Trang dashboard chính tổng hợp các chỉ số sản xuất, chất lượng, cảnh báo theo thời gian thực, giúp giám sát toàn bộ nhà máy AVI/AOI từ một màn hình duy nhất.

## Vị trí truy cập
- Menu: `Dashboard` › `Tổng quan`
- URL: `/dashboard` hoặc `/`
- Vai trò thấy menu: admin, manager, engineer, operator

## Quyền yêu cầu
- Resource: `dashboard`
- Actions cần thiết: `view`
- Middleware: `requirePermission('dashboard_view')`

## Tiền điều kiện
- Phải có ít nhất 1 Factory được tạo và 1 Machine đăng ký.
- Hệ thống đã có dữ liệu `daily_statistics` (job tổng hợp chạy hàng đêm).
- Người dùng đã đăng nhập (cookie `WebSession`).

## Các bước thao tác
1. **Đăng nhập** — Mở `/login`, nhập tài khoản. Hệ thống điều hướng về `/dashboard`.
2. **Chọn khoảng thời gian** — Dùng date-range picker góc phải trên (mặc định: hôm nay).
3. **Lọc theo nhà máy/line** — Dropdown `Factory` và `Line` ở header.
4. **Xem KPI cards** — Pass Rate, NG Rate, OEE, Tổng inspection, Tổng cảnh báo.
5. **Xem biểu đồ** — Line chart xu hướng NG, bar chart top defects, donut machine status.
6. **Drill-down** — Click vào card hoặc cột biểu đồ để mở `DrillDownDashboard`.

## Kết quả mong đợi
- KPI tự refresh mỗi 30 giây.
- Biểu đồ render trong < 2 giây với dataset 1 ngày.
- Click drill-down chuyển sang `/dashboard/drilldown?metric=...&date=...`.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| KPI hiển thị `--` | Chưa có `daily_statistics` | Chờ job tổng hợp chạy hoặc trigger thủ công |
| Biểu đồ trống | Bộ lọc Factory không có data | Bỏ filter hoặc chọn khoảng thời gian rộng hơn |
| 403 Forbidden | Thiếu `dashboard_view` | Admin gán role `operator` trở lên |

## API liên quan
- `GET /api/dashboard/stats?from=...&to=...&factoryId=...` — trả KPI tổng hợp.
- `tRPC: dashboard.stats` — query React Query cache.
- `tRPC: dashboard.timeline` — dữ liệu cho line chart xu hướng.

## Tính năng liên quan
- [Drill-Down Dashboard](../dashboard/dashboard-drilldown.md) — phân tích sâu khi click KPI.
- [OEE Dashboard](../monitoring/oee-dashboard.md) — chi tiết OEE riêng.
- [Cảnh báo](../alerts/alerts-list.md) — số liệu alert hiển thị trên dashboard.

## Ví dụ thực tế
Tình huống: "Quản đốc ca sáng muốn xem tổng quan nhà máy F1 lúc 8h sáng".
Bước: Đăng nhập → Chọn Factory `F1`, Date `Today` → Xem Pass Rate `97.2%`, NG `2.8%`, OEE `82%`. Click vào card `Top Defect` thấy `Solder Bridge` chiếm 42% → click → mở drill-down theo từng máy.
