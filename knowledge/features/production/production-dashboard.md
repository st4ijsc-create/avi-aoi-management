# Bảng điều khiển sản xuất (Production Dashboard)

## 1. Mục đích
Cung cấp cái nhìn tổng quan thời gian thực về hiệu suất sản xuất theo trạm (station): tỉ lệ qua lần đầu (FPY), sản lượng, tỉ lệ kiểm lại (retest), phân tích lỗi, xu hướng và biểu đồ kiểm soát quá trình (SPC). Là điểm khởi đầu để phát hiện trạm/dây chuyền có hiệu suất thấp và đào sâu (drill-down) sang chi tiết.

## 2. Vị trí truy cập
- URL: `/production-dashboard`
- Menu: **Sản xuất → Bảng điều khiển sản xuất**
- Tệp giao diện: `client/src/pages/ProductionDashboard.tsx`

## 3. Quyền yêu cầu
- Quyền: `dashboard_view` — Xem bảng điều khiển sản xuất
- Có thể truy cập với role: viewer, engineer, manager, admin (mọi role đều có quyền xem mặc định)

## 4. Tiền điều kiện
- Đã cấu hình ít nhất một **nhà máy (factory)**, **xưởng (workshop)**, **dây chuyền (line)** và **trạm (station)** trong hệ thống.
- Các máy AOI đã được gắn vào trạm và có dữ liệu kiểm tra (`product_inspections`).
- Có ít nhất một bản ghi kiểm tra trong khoảng thời gian được chọn.
- Bảng `daily_statistics` được populate (chạy job tổng hợp hằng ngày) để biểu đồ tải nhanh.

## 5. Các bước thao tác
1. **Mở trang** từ menu *Sản xuất → Bảng điều khiển sản xuất*. Mặc định hiển thị tab **Station View** với dữ liệu hôm nay.
2. **Chọn khoảng ngày**: bấm một trong các nút preset (Hôm nay / Hôm qua / 1 Tuần / 1 Tháng / 1 Năm) hoặc bấm **Custom** để mở lịch và chọn ngày bắt đầu — kết thúc.
3. **Lọc theo nhà máy**: bấm dropdown *Factory*, chọn nhà máy. Khi đổi nhà máy, bộ lọc *Line* tự động xóa.
4. **Lọc theo dây chuyền**: bấm dropdown *Line* (chỉ hiện các dây chuyền của nhà máy đã chọn).
5. **Tìm kiếm trạm**: gõ vào ô search ở đầu bảng — lọc theo tên trạm, mã trạm, dây chuyền, xưởng (không phân biệt hoa thường).
6. **Bật bộ lọc Low Yield**: bấm vào KPI card *Low Yield Stations* hoặc chip màu vàng — chỉ hiển thị trạm có FPY < 70%.
7. **Bật tự động làm mới**: bấm nút *Auto-Refresh* — dữ liệu refresh mỗi 30 giây.
8. **Bật so sánh nhà máy**: bấm switch *Factory Comparison* — hiển thị biểu đồ so sánh nhiều nhà máy (sẽ xóa filter factory đang chọn).
9. **Sao chép link với filter**: bấm *Copy Link* — URL với toàn bộ filter hiện tại được copy vào clipboard để chia sẻ.
10. **Chuyển tab phân tích**: bấm tab **Defect Analysis** xem Pareto top 15 loại lỗi; **Trend** xem xu hướng yield/output theo thời gian (chọn interval Hour/Day/Week); **SPC** xem biểu đồ kiểm soát quá trình.
11. **Xuất báo cáo**: bấm nút *Export* — mở dialog, chọn nội dung, sinh file PDF gồm summary, bảng trạm, bảng lỗi.

## 6. Kết quả mong đợi
- Strip KPI ở đầu trang hiển thị: tổng số trạm, FPY trung bình (xanh), tổng sản lượng, tỉ lệ retest (đỏ nếu >5%, vàng nếu >2%), số trạm Low Yield (chip vàng).
- Bảng **Station View** liệt kê trạm với cột FPY tô màu (xanh ≥90%, vàng 70-89%, đỏ <70%), Point Change %, Final Yield %, Output, Retest Rate %.
- Khi đổi filter, mọi biểu đồ và KPI cập nhật tức thì (hoặc theo chu kỳ 30 giây nếu Auto-Refresh bật).
- Tab **Defect Analysis** trả về Pareto chart + bảng top lỗi.
- Tab **Trend** trả về line chart yield/output/retest.
- Tab **SPC** trả về control limits ± sigma.
- Nút Export sinh PDF có timestamp, tiêu đề, khoảng ngày và các section đã chọn.

## 7. Lỗi thường gặp & cách xử lý
- **Triệu chứng**: Bảng trạm trống, hiển thị "No data" / "Không có dữ liệu". **Nguyên nhân**: Chưa cấu hình factory/line/station hoặc không có inspection trong khoảng ngày. **Cách xử lý**: Mở rộng date range, hoặc kiểm tra `product_inspections` đã có dữ liệu chưa.
- **Triệu chứng**: Số Low Yield luôn bằng 0 dù có trạm yield thấp. **Nguyên nhân**: Logic FPY (`okCount / totalInspections`) tính trên first-pass; có thể bị sai do retest. **Cách xử lý**: Kiểm tra `getStationOverview` ở `productionDashboardRouter.ts`, đối chiếu `daily_statistics`.
- **Triệu chứng**: Filter Factory không phản hồi khi đổi. **Nguyên nhân**: State `selectedFactory` không sync với URL params. **Cách xử lý**: Bấm *Copy Link* để xem URL, kiểm tra `useEffect` đồng bộ search params trong component.
- **Triệu chứng**: Tab Trend hiển thị biểu đồ trống. **Nguyên nhân**: Interval không phù hợp (chọn Hour cho khoảng 1 năm sẽ quá nhiều điểm và bị throttle). **Cách xử lý**: Chọn interval Day hoặc Week cho khoảng dài.

## 8. API liên quan
- tRPC `factory.list` (query) — lấy danh sách nhà máy cho dropdown.
- tRPC `line.list` (query) — lấy danh sách dây chuyền.
- tRPC `productionDashboard.getStationOverview` (query) — dữ liệu trạm + KPI + top defects.
- tRPC `productionDashboard.getDefectAnalysis` (query, lazy) — phân tích lỗi theo loại (chỉ chạy khi mở tab Defect).
- tRPC `productionDashboard.getTrendData` (query, lazy) — time-series yield/output/retest.
- tRPC `productionDashboard.getSpcSummary` (query, lazy) — control limits + sigma.
- Bảng dữ liệu nguồn: `stations`, `machines`, `production_lines`, `workshops`, `factories`, `product_inspections`, `measurement_results`, `daily_statistics`.

## 9. Tính năng liên quan
- [Đơn hàng sản xuất](./production-orders.md) — quản lý các order chạy trên dây chuyền.
- [Lập lịch sản xuất](./production-scheduling.md) — tối ưu lịch dựa trên insight từ dashboard.
- [Lịch sử kiểm tra](../inspection/history.md) — drill-down xem chi tiết từng inspection.
- Quality Gates — định nghĩa ngưỡng cảnh báo cho FPY/retest.

## 10. Ví dụ thực tế
**Tình huống**: Quản đốc xưởng SMT cần kiểm tra hiệu suất ca sáng hôm nay.
1. Mở `/production-dashboard`.
2. Bấm preset *Hôm nay*.
3. Chọn factory "Nhà máy 1" → line "SMT-Line-A".
4. Quan sát KPI: FPY 87%, retest 3.2% (vàng).
5. Bấm chip *Low Yield Stations* (vàng) → bảng lọc còn 2 trạm có FPY < 70%.
6. Bấm tab **Defect Analysis** → Pareto chỉ ra "Solder bridge" chiếm 42% lỗi.
7. Bật **Auto-Refresh** để theo dõi liên tục, đồng thời bấm *Copy Link* gửi cho kỹ thuật viên kiểm tra trạm gốc.
