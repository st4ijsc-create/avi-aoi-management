# Corporate Dashboard

## Mục đích
Tổng hợp dữ liệu sản xuất/chất lượng cấp tập đoàn (multi-factory): so sánh các nhà máy, xếp hạng, KPI hợp nhất — phục vụ ban lãnh đạo.

## Vị trí truy cập
- Menu: `Corporate` › `Dashboard`
- URL: `/corporate` hoặc `/corporate/dashboard`
- Vai trò: admin, corporate-manager, executive

## Quyền yêu cầu
- Resource: `corporate`
- Actions: `view`
- Middleware: `requirePermission('dashboard_corporate')`

## Tiền điều kiện
- Có ≥ 2 factory trong hệ thống.
- `daily_statistics` đã có data cho mỗi factory.

## Các bước thao tác
1. **Đăng nhập** — Người dùng có scope corporate (không bị giới hạn factory).
2. **Mở trang** — Top KPI: Total throughput, Avg Pass Rate, Avg OEE, Active Alerts (toàn tập đoàn).
3. **Bảng xếp hạng** — Bar chart factory theo Pass Rate / OEE / NG Rate.
4. **Map view** (nếu có lat/lng) — Pin factory với màu theo health.
5. **So sánh tháng/năm** — Toggle period.
6. **Drill** — Click factory → mở Factory Dashboard riêng.

## Kết quả mong đợi
- Số liệu refresh mỗi 5 phút.
- Mọi factory đều có data; nếu factory missing → highlight vàng.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Factory không hiện | Permission scope hạn chế | Cần role corporate |
| KPI lệch | Timezone factory khác | Chuẩn hóa về UTC trong daily_statistics |

## API liên quan
- `tRPC: corporateStats.summary / ranking / mapData`.

## Tính năng liên quan
- [Cấu trúc tổ chức](../corporate/corporate-layout.md).
- [Quản lý Tập đoàn](../corporate/corporate-mgmt.md).
- [Dashboard chính](../dashboard/dashboard-view.md).

## Ví dụ thực tế
Tình huống: "CEO xem báo cáo cuối tháng cho 5 nhà máy".
Bước: Mở Corporate Dashboard, period `Last month` → ranking: F1 Pass 98%, F3 92% (thấp nhất). Click F3 → drill thấy line C có vấn đề. Forward report cho GM F3.
