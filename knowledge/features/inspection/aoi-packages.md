# Gói ảnh AOI (AOI Packages)

## 1. Mục đích
Quản lý các gói ZIP chứa ảnh AOI mà máy gửi lên: xem danh sách packages cùng trạng thái upload (`pending` / `uploading` / `uploaded` / `committed` / `failed`), xem ảnh trong package, tải ZIP gốc, theo dõi hàng đợi upload theo máy và xem activity logs cho mục đích audit.

## 2. Vị trí truy cập
- URL: `/aoi-packages`
- Menu: **Sản xuất › Gói ảnh AOI**
- File trang: `client/src/pages/AOIPackages.tsx`

## 3. Quyền yêu cầu
- Permission key: `history_view`
- Một số thao tác (re-commit, download ZIP raw) thường yêu cầu quyền cao hơn của Admin / IT.

## 4. Tiền điều kiện
- Storage object (S3 hoặc MinIO) đã cấu hình và kết nối được.
- Agent / máy AOI đã đăng ký, có API Key và đang gửi packages.
- Đã có dữ liệu trong bảng `inspection_packages`.

## 5. Các bước thao tác
1. Mở menu **Sản xuất › Gói ảnh AOI** hoặc truy cập `/aoi-packages`.
2. Xem **tổng quan thống kê** (cards trên cùng): Total Packages, Committed, Failed, Total Images, Total Size, Average Upload Time.
3. Đặt bộ lọc:
   - `Serial Number` (tìm kiếm), `Machine Code`.
   - `Status` dropdown: `pending` / `uploading` / `uploaded` / `committed` / `failed`.
   - `Result`: `all` / `OK` / `NG`.
   - `Date From` – `Date To`.
4. Xem bảng danh sách packages với cột: Package ID, Serial Number, Machine, Status, Result, Upload Time, File Size, Image Count, OK/NG count.
5. Click một package để mở **chi tiết** (dialog hoặc panel) gồm các tab:
   - **Info**: metadata (`metaJson`, `presignExpiresAt`, `committedAt`, ...).
   - **Images**: thumbnail từng ảnh; click để xem full size kèm watermark, point code, result, measured value.
   - **Logs**: activity log – các bước upload / parse / commit / errors.
   - **Stats**: biểu đồ kích thước, thời gian upload.
6. Mở tab **Upload Queue** để xem hàng đợi theo máy: số pending, queue size (bytes), thời gian dự kiến.
7. Mở tab **Statistics** để xem trend upload, success rate, phân phối kích thước.
8. Với package `failed`: bấm **Re-commit** (nếu có quyền) để thử commit lại; hoặc **Download ZIP** để debug thủ công.
9. Bấm **Refresh** để reload danh sách / queue.

## 6. Kết quả mong đợi
- Danh sách packages được lọc đúng theo điều kiện.
- Mở chi tiết: thấy đầy đủ ảnh, metadata, logs.
- Upload Queue cho thấy backlog hiện tại của từng máy.
- Re-commit cập nhật trạng thái thành `committed` khi thành công.
- Download ZIP trả về file `.zip` đúng cấu trúc.

## 7. Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Ảnh không tải từ package | `storageKey` sai; ZIP corrupt; cache hết hạn | Kiểm tra `storageKey` / `storageUrl`; xác minh integrity ZIP; clear cache; **Re-commit** package |
| Package kẹt ở `uploading` | Mất kết nối agent; upload timeout; mạng chậm | Kiểm tra agent health (heartbeat); retry upload; xem `presignExpiresAt` còn hạn không |
| Commit failed, log không rõ | `meta.json` invalid; measurement point không tồn tại; lỗi ghi storage | Mở tab **Logs** xem lỗi chi tiết; kiểm tra format `meta.json`; xác minh `measurement_point_defs` |
| Upload Queue tăng nhanh, không giảm | Service upload worker dừng; bottleneck network | Restart upload worker service; kiểm tra throughput mạng / disk |

## 8. API liên quan
- tRPC `aoiPackage.listPackages` – danh sách phân trang theo bộ lọc.
- tRPC `aoiPackage.getUploadStats` – stats tổng hợp.
- tRPC `aoiPackage.getQueueStatus` – hàng đợi upload theo máy.
- tRPC `aoiPackage.getPackage` – chi tiết một package.
- tRPC `aoiPackage.getPackageLogs` – activity logs.
- tRPC `aoiPackage.getImage` – extract ảnh từ ZIP (cache + watermark).
- Bảng DB: `inspection_packages`, `package_images`, `package_activity_logs`, `upload_queue_metrics`.

## 9. Tính năng liên quan
- **Chi tiết kiểm tra** (`inspection-detail.md`) – mỗi package thường gắn 1 inspection.
- **Lịch sử kiểm tra** (`history.md`) – tra cứu kết quả tương ứng với package.
- **Đăng ký máy** (`../monitoring/machine-registration.md`) – tiền đề để máy có quyền upload.

## 10. Ví dụ thực tế
> IT nhận cảnh báo nhiều package `failed` từ máy `AOI-LINE2-03`:
> 1. Vào **Gói ảnh AOI**, lọc `Machine Code = AOI-LINE2-03`, `Status = failed`, ngày = hôm nay.
> 2. Click một package failed, mở tab **Logs** → thấy lỗi `meta.json: missing field "pointCode"`.
> 3. Liên hệ team firmware máy để fix format `meta.json`.
> 4. Sau khi máy gửi lại, theo dõi tab **Upload Queue** thấy backlog giảm dần, status chuyển `committed`.
> 5. Mở vài package mới để xác nhận ảnh hiển thị đúng.
