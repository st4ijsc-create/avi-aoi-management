# Báo cáo (Reports)

## 1. Mục đích
Trang Reports cung cấp báo cáo tổng hợp đa cấp (Executive, Detailed, Machine Comparison) phục vụ ban điều hành và quản lý sản xuất theo dõi sản lượng, tỷ lệ đạt (yield), phân bố OK/NG/NTF và chi phí chất lượng kém (COPQ).

## 2. Vị trí truy cập
- URL: `/reports`
- Menu: Analytics → Reports

## 3. Quyền yêu cầu
- `reports_view` — xem báo cáo
- `reports_create` — tạo báo cáo tuỳ biến
- `reports_export` — xuất CSV/PDF/Excel
- Category: `reports`

## 4. Tiền điều kiện
- Có dữ liệu inspections trong khoảng thời gian được chọn
- Đã khai báo factories/workshops/machines
- (Tuỳ chọn) Đã nhập đơn giá rework NG/NTF trong localStorage để tính COPQ

## 5. Các bước thao tác
1. Chọn khoảng thời gian (mặc định 30 ngày), Factory, Workshop
2. Chọn tab `Executive` để xem 4 thẻ tổng quan + biểu đồ yield + pie phân bố kết quả
3. Chuyển tab `Detailed` để xem bảng chi tiết theo ngày/máy
4. Chuyển tab `Machine Comparison` để so sánh hiệu năng giữa các máy
5. Nhập chi phí rework NG/NTF → hệ thống tự lưu localStorage và tính lại COPQ
6. Nhấn `Export` → tải file `reports_YYYY-MM-DD.csv`

## 6. Kết quả mong đợi
- Hiển thị các chỉ số: Total / OK / NG / NTF / Yield % / COPQ
- Biểu đồ xu hướng yield và phân bố kết quả cập nhật theo bộ lọc
- File xuất chứa header + dữ liệu so sánh máy

## 7. Lỗi thường gặp & cách xử lý
- Empty state khi không có dữ liệu → mở rộng khoảng thời gian hoặc kiểm tra bộ lọc Factory/Workshop
- COPQ = 0 → kiểm tra đã nhập đơn giá rework chưa (localStorage `copq_rework_cost_ng`, `copq_rework_cost_ntf`)
- Export bị treo với dataset lớn → thu hẹp khoảng thời gian xuống ≤ 90 ngày

## 8. API liên quan
- `trpc.factory.list`
- `trpc.workshop.list`
- `trpc.machine.list`
- `trpc.dashboard.getDailyStats({ factoryId?, days })`
- `trpc.corporateFactoryStats.weeklyCOPQ({ weeks, factoryId? })`

## 9. Tính năng liên quan
- [Category Analytics](analytics/category-analytics.md)
- [SPC Analysis](analytics/spc-analysis.md)
- [Pareto Analysis](analytics/pareto-analysis.md)

## 10. Ví dụ thực tế
Quản đốc xưởng A1 chọn khoảng 7 ngày gần nhất, tab Executive cho thấy yield 94.2% giảm 0.8% so với tuần trước, COPQ tăng 12 triệu đồng. Chuyển tab Machine Comparison thấy máy SMT-03 có yield thấp nhất 88%, xuất CSV gửi đội kỹ thuật để kiểm tra.
