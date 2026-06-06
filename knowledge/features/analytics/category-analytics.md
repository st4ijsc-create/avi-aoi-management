# Phân tích theo nhóm sản phẩm (Category Analytics)

## 1. Mục đích
Phân tích sản lượng, yield và phân bố lỗi theo `productCategory` để xác định nhóm sản phẩm có chất lượng thấp, hỗ trợ quyết định ưu tiên cải tiến.

## 2. Vị trí truy cập
- URL: `/category-analytics`
- Menu: Analytics → Category Analytics

## 3. Quyền yêu cầu
- `analytics_category` — read-only cho hầu hết role
- Category: `analytics`

## 4. Tiền điều kiện
- Đã khai báo `productCategories` và gán `categoryId` cho `productModels`
- Có inspections gắn với productModel hợp lệ

## 5. Các bước thao tác
1. Mở trang, hệ thống tải mặc định 7 ngày gần nhất
2. Chọn bộ lọc Date / Factory / Product nếu cần
3. Xem tab `Category Breakdown` với pie phân bố sản lượng
4. Chuyển tab `Yield Distribution` để xem yield theo nhóm
5. Chuyển tab `Bar Charts` xem OK/NG/NTF từng nhóm
6. Đổi time range sang `month` để mở rộng phạm vi
7. Nhấn `Export` để tải CSV `category-analytics-YYYY-MM-DD.csv`

## 6. Kết quả mong đợi
- Mỗi nhóm hiển thị: Total / OK / NG / NTF / Yield %
- Biểu đồ pie + bar đồng bộ với bộ lọc
- CSV chứa cột: Code, Name, Total, OK, NG, NTF, Yield (%)

## 7. Lỗi thường gặp & cách xử lý
- Nhóm bị thiếu khỏi biểu đồ → product chưa map `categoryId`, vào Product Model gán lại
- Inspection không tính vào nhóm → kiểm tra `productModel.categoryId` ≠ null
- Timeout khi range > 90 ngày → giảm range hoặc tăng `limit` server-side

## 8. API liên quan
- `trpc.productCategory.list`
- `trpc.factory.list`
- `trpc.inspection.list({ startDate, endDate, limit })`
- `trpc.productModel.list({ limit })`

## 9. Tính năng liên quan
- [Reports](analytics/reports.md)
- [Pareto Analysis](analytics/pareto-analysis.md)
- Product Models (Products module)

## 10. Ví dụ thực tế
Trưởng QA xem dữ liệu tháng, nhận thấy nhóm `PCB-Industrial` yield 89% trong khi nhóm `PCB-Consumer` 96%. Xuất CSV và mở Pareto Analysis filter theo nhóm `PCB-Industrial` để tìm loại lỗi chính cần xử lý.
