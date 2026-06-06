# Lịch sử kiểm tra (History)

## 1. Mục đích
Xem danh sách tất cả kết quả kiểm tra sản phẩm (OK / NG / NTF) cùng phân tích thống kê chi tiết theo máy, ngày, mô hình sản phẩm. Trang hỗ trợ lọc, xuất dữ liệu, phân tích xu hướng năng suất (yield) và xác định Top NG measurement points để cải thiện chất lượng.

## 2. Vị trí truy cập
- URL: `/history`
- Menu: **Sản xuất › Lịch sử kiểm tra**
- File trang: `client/src/pages/History.tsx`

## 3. Quyền yêu cầu
- Permission key: `history_view`
- Vai trò thường có: Engineer, QC, Supervisor, Admin

## 4. Tiền điều kiện
- Người dùng đã đăng nhập và có quyền `history_view`.
- Đã có dữ liệu kiểm tra trong cơ sở dữ liệu (bảng `product_inspections`).
- Máy đã được đăng ký và gửi dữ liệu kiểm tra (xem `Đăng ký máy`).
- (Tuỳ chọn) Đã cấu hình Factory / Workshop / Line / Station để lọc theo cấu trúc nhà máy.

## 5. Các bước thao tác
1. Mở menu **Sản xuất › Lịch sử kiểm tra** hoặc truy cập trực tiếp `/history`.
2. Đặt bộ lọc tìm kiếm ở thanh trên cùng:
   - Mã máy (Machine Code), Serial Number, Mô hình sản phẩm (Product Model).
   - Kết quả: chọn `OK`, `NG`, `NTF` hoặc để trống để xem tất cả.
   - Khoảng ngày: nhanh (Hôm nay / Tuần / Tháng) hoặc tuỳ chỉnh `dateFrom` – `dateTo`.
   - (Tuỳ chọn) Lọc theo Factory / Workshop / Line / Station.
3. Bấm **Search** để áp dụng. Bấm **Clear Filters** để xoá bộ lọc.
4. Chọn chế độ xem qua nút chuyển: **Card view** hoặc **Table view**.
5. Bấm **Columns** để bật / tắt cột hiển thị (serial, máy, kết quả, thời gian, mô hình, factory, workshop, line, station, OK/NG/NTF count).
6. Cuộn xuống và bấm **Load More** để tải thêm bản ghi (cursor pagination).
7. Bấm vào một dòng để mở **Chi tiết kiểm tra** (`/inspection/:id`).
8. Mở tab **Analytics** để xem:
   - Biểu đồ xu hướng yield rate.
   - Top NG measurement points.
   - Defect pattern clusters (phân cụm lỗi).
   - Heatmap theo workstation.
9. (Tuỳ chọn) Tích checkbox **Select All** rồi bấm **Export Bulk** hoặc **Acknowledge Bulk** để thao tác hàng loạt.

## 6. Kết quả mong đợi
- Hiển thị danh sách kiểm tra phân trang đúng theo bộ lọc.
- Tab Analytics hiện đầy đủ biểu đồ, Top NG points và phân cụm lỗi.
- Có thể mở chi tiết một lần kiểm tra để xem ảnh và measurement results.
- Có thể xuất dữ liệu / xác nhận hàng loạt thành công, hệ thống cập nhật trạng thái `acknowledgedAt`.

## 7. Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Danh sách trống | Không có dữ liệu trong khoảng đã chọn; quyền bị giới hạn theo factory | Mở rộng khoảng ngày; kiểm tra quyền người dùng; xác minh máy đã đăng ký và đang gửi dữ liệu |
| Biểu đồ Analytics không hiển thị | Dữ liệu < 3 ngày; lỗi tính toán thống kê | Mở rộng `dateRange`; kiểm tra log server `inspection.aiAnalysis` |
| Phân trang chậm, treo | Quá nhiều bản ghi; thiếu index | Hạn chế `dateRange`; kiểm tra index trên `product_inspections (inspection_time, machine_id, result)` |
| Không thấy cột mong muốn | Bị tắt trong **Columns** | Bấm **Columns** và bật lại cột |

## 8. API liên quan
- tRPC `inspection.search` – danh sách phân trang theo bộ lọc.
- tRPC `inspection.listCursor` – cursor pagination cho **Load More**.
- tRPC `inspection.topNGPoints` – Top measurement points NG.
- tRPC `inspection.aiAnalysis` – dự báo yield, anomalies, recommendations.
- tRPC `inspection.defectPatternClusters` – phân cụm defect.
- tRPC `inspection.gallery` – ảnh từ measurement results.
- tRPC `workstation.defectsByWorkstation` – heatmap.
- tRPC `machine.list` – danh sách máy cho filter / hiển thị tên.
- Bảng DB chính: `product_inspections`, `measurement_results`, `measurement_point_defs`.

## 9. Tính năng liên quan
- **Chi tiết kiểm tra** (`inspection-detail.md`) – mở chi tiết một lần kiểm tra.
- **Gói ảnh AOI** (`aoi-packages.md`) – xem package ZIP gốc của kiểm tra.
- **Lịch xuất dữ liệu** (`history-export-scheduling.md`) – tự động hoá xuất báo cáo.
- **Đăng ký máy** (`../monitoring/machine-registration.md`) – tiền đề để máy gửi dữ liệu.

## 10. Ví dụ thực tế
> QC muốn xem các sản phẩm NG hôm nay trên máy `AOI-LINE1-01`:
> 1. Vào **Sản xuất › Lịch sử kiểm tra**.
> 2. Lọc: Mã máy = `AOI-LINE1-01`, Kết quả = `NG`, Khoảng ngày = `Hôm nay`.
> 3. Bấm **Search**. Bảng hiển thị danh sách NG.
> 4. Mở tab **Analytics** → xem **Top NG Points** để biết measurement point nào lỗi nhiều nhất.
> 5. Click một dòng để vào chi tiết, xem ảnh, có thể bấm **Confirm NTF** nếu xác định là lỗi giả (no trouble found).
