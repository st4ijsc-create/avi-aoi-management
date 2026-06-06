# Đơn hàng sản xuất (Production Orders)

## 1. Mục đích
Tạo, sửa, xóa và theo dõi tiến độ các đơn hàng sản xuất (production order). Mỗi đơn hàng gắn với một dây chuyền và một mã sản phẩm, có target sản lượng và trạng thái (chờ / đang chạy / hoàn thành / tạm dừng / hủy). Hỗ trợ xem dạng danh sách hoặc Gantt với khả năng kéo-thả để dời lịch.

## 2. Vị trí truy cập
- URL: `/production-orders`
- Menu: **Sản xuất → Đơn hàng sản xuất**
- Tệp giao diện: `client/src/pages/ProductionOrders.tsx`

## 3. Quyền yêu cầu
- Quyền: `production_orders` — Quản lý đơn hàng sản xuất.
- Xem danh sách: cần `production_orders` (đọc).
- Tạo / sửa / xóa / reschedule: yêu cầu role **admin** (các mutation dùng `adminProcedure` ở tRPC).

## 4. Tiền điều kiện
- Đã có ít nhất một **factory**, **workshop**, **production_line**, **product_model** trong hệ thống.
- Người dùng đăng nhập có session hợp lệ (mutation cần `createdBy = user.id`).
- Để dùng tab Gantt: nên có ≥2 đơn hàng để thấy được timeline.

## 5. Các bước thao tác
1. **Mở trang** từ menu *Sản xuất → Đơn hàng sản xuất*. Mặc định tab **List** hiển thị bảng đơn hàng.
2. **Xem stats** ở 4 card đầu trang: Tổng đơn / Đang chạy / Hoàn thành / Tổng sản lượng.
3. **Tìm kiếm**: gõ vào ô search (debounce 300 ms) — lọc theo `orderCode` hoặc `companyCode`.
4. **Lọc theo trạng thái**: dropdown bên cạnh search (All / Pending / In Progress / Completed / Paused / Cancelled).
5. **Tạo đơn hàng**: bấm nút **+ Tạo đơn hàng** mở dialog.
   - Nhập **Order Code** (mã đơn duy nhất) và **Company Code**.
   - Chọn **Factory** → **Workshop** (chỉ hiện workshop của factory) → **Line** (chỉ hiện line của workshop) → **Product**.
   - Nhập **Target Quantity**, chọn **Priority** (Bình thường / Cao / Khẩn cấp), nhập **Notes** (tùy chọn).
   - Bấm **Create**. Toast "Tạo thành công" và row mới xuất hiện.
6. **Sửa đơn hàng**: bấm icon Edit trên row → dialog pre-filled. Có thể đổi mã, sản lượng, trạng thái, priority, notes. Bấm **Update**.
7. **Xóa đơn hàng**: bấm icon Trash → AlertDialog xác nhận, hiển thị `orderCode`. Bấm **Delete** (đỏ).
8. **Xem tiến độ**: cột Progress trên row hiển thị progress bar = `completedQuantity / targetQuantity` và 3 ô màu OK / NG / NTF.
9. **Chuyển tab Gantt**: bấm tab **Gantt** → hiển thị biểu đồ Gantt các đơn hàng theo line × time.
10. **Kéo-thả Gantt**: drag thanh đơn hàng để đổi `scheduledStartDate` / `scheduledEndDate` hoặc kéo sang line khác. Khi thả, hệ thống gọi `checkScheduleOverlap` rồi `reschedule` mutation.
11. **Override conflict**: nếu kéo dẫn đến overlap/capacity vượt, dialog hỏi "Bỏ qua kiểm tra?". Bấm OK → `forceOverride = true`.

## 6. Kết quả mong đợi
- Sau khi **Create**: row mới với status `pending`, progress 0%, completedQuantity 0.
- Sau khi **Update**: row được refresh, status badge đổi màu theo enum (xám/xanh dương/xanh lá/vàng/đỏ).
- Sau khi **Delete**: row biến mất, toast "Xóa thành công".
- Sau khi **Reschedule trên Gantt**: thanh đơn hàng nhảy đến vị trí mới, toast "Cập nhật lịch thành công" hoặc lỗi cụ thể.
- Stats cards luôn cập nhật khi list thay đổi.

## 7. Lỗi thường gặp & cách xử lý
- **Triệu chứng**: Dropdown Workshop bị disabled sau khi chọn Factory. **Nguyên nhân**: Factory đó chưa có workshop nào, hoặc state `factoryId` chưa set. **Cách xử lý**: Vào *Cấu hình → Workshops* tạo workshop cho factory, hoặc chọn factory khác.
- **Triệu chứng**: Reschedule fail "capacity exceeded". **Nguyên nhân**: Line đã đạt `maxConcurrentOrders` hoặc `capacityPerHour` không đủ. **Cách xử lý**: Mở dialog Override → tick `forceOverride`, hoặc sang dây chuyền khác.
- **Triệu chứng**: Nút Create disabled. **Nguyên nhân**: Thiếu trường bắt buộc (đánh dấu *). **Cách xử lý**: Điền đầy đủ orderCode, companyCode, factory/workshop/line/product, targetQuantity.
- **Triệu chứng**: Tạo đơn báo "orderCode đã tồn tại". **Nguyên nhân**: Cột `order_code` có UNIQUE index. **Cách xử lý**: Đổi `orderCode` (có thể prefix theo ngày: `ORD-20260512-001`).
- **Triệu chứng**: Search không trả kết quả dù có data. **Nguyên nhân**: Server-side filter dùng ILIKE; chuỗi tìm có ký tự đặc biệt (%, _). **Cách xử lý**: Bỏ ký tự đặc biệt, hoặc gõ chính xác `orderCode`.

## 8. API liên quan
- tRPC `productionOrder.list` (query) — lọc theo factory/workshop/line/status/search/limit (tối đa 1000).
- tRPC `productionOrder.getById` / `getByCode` (query) — lấy chi tiết.
- tRPC `productionOrder.create` (mutation, **admin**) — tạo mới, cần `createdBy`.
- tRPC `productionOrder.update` (mutation, **admin**) — cập nhật bất kỳ field nào (id bắt buộc).
- tRPC `productionOrder.delete` (mutation, **admin**) — xóa theo id.
- tRPC `productionOrder.checkScheduleOverlap` (query) — kiểm tra trùng lịch trước reschedule.
- tRPC `productionOrder.reschedule` (mutation, **admin**) — đổi `scheduledStartDate/EndDate/lineId`, có flag `forceOverride`.
- tRPC `factory.list` / `workshop.list` / `line.list` / `productModel.list` — populate dropdown.
- Bảng: `production_orders` (chính), join `factories`, `workshops`, `production_lines`, `product_models`.

## 9. Tính năng liên quan
- [Bảng điều khiển sản xuất](./production-dashboard.md) — xem KPI sinh ra từ các order.
- [Lập lịch sản xuất](./production-scheduling.md) — tối ưu schedule bằng thuật toán FIFO/Priority/EDF.
- [Lịch sử kiểm tra](../inspection/history.md) — xem inspection của từng đơn hàng.
- Báo cáo (Reports) — sinh report theo khoảng thời gian / status đơn hàng.

## 10. Ví dụ thực tế
**Tình huống**: Kế hoạch viên cần tạo đơn hàng mới cho công ty XYZ, sản phẩm PCB-A1, sản lượng 500 units, độ ưu tiên cao, chạy ở SMT-Line-A.
1. Mở `/production-orders`, bấm **+ Tạo đơn hàng**.
2. Order Code: `ORD-20260512-XYZ-001`, Company Code: `XYZ`.
3. Factory: "Nhà máy 1" → Workshop: "SMT" → Line: "SMT-Line-A" → Product: "PCB-A1".
4. Target Quantity: `500`, Priority: **Cao**, Notes: "Giao 15/05".
5. Bấm **Create** → toast "Tạo thành công", row xuất hiện status *Pending*.
6. Chuyển tab **Gantt**, kéo thanh đơn mới đến slot 13/05 08:00 — 14/05 17:00.
7. Hệ thống báo overlap với đơn cũ → bấm **Override** → reschedule thành công.
8. Sau ca chạy, mở lại trang, progress bar đã tăng lên 38% (190/500), trạng thái auto chuyển *In Progress*.
