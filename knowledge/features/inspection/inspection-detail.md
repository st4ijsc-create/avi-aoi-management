# Chi tiết kiểm tra (Inspection Detail)

## 1. Mục đích
Xem chi tiết một lần kiểm tra: thông tin sản phẩm, danh sách measurement points kèm ảnh, kết quả phân tích AI, so sánh ảnh chuẩn (reference) với ảnh thực tế (actual). Cho phép xác nhận NTF hoặc sửa lỗi kết quả khi cần.

## 2. Vị trí truy cập
- URL: `/inspection/:id`
- Menu: **Sản xuất › Lịch sử kiểm tra › Chi tiết** (mở từ trang Lịch sử bằng cách click một dòng).
- File trang: `client/src/pages/InspectionDetail.tsx`

## 3. Quyền yêu cầu
- Permission key: `history_view` để xem.
- Để **Confirm NTF** hoặc **Correct Result**: cần thêm quyền chỉnh sửa (thường gắn với role QC hoặc Engineer).

## 4. Tiền điều kiện
- Có `inspectionId` hợp lệ trong URL.
- Bản ghi `product_inspections` tồn tại với `measurement_results` và (nếu có) ảnh đã upload.
- Mô hình sản phẩm (`product_models`) và `measurement_point_defs` đã được khai báo để có ảnh reference + toạ độ.

## 5. Các bước thao tác
1. Từ trang **Lịch sử kiểm tra**, click một dòng để vào chi tiết. Hoặc mở trực tiếp `/inspection/<id>`.
2. Xem **thông tin tổng quan**: Serial Number, Kết quả tổng (`overallResult`), Kết quả ban đầu (`originalResult`), Thời gian kiểm tra, Mô hình, Batch Number, NTF Reason (nếu đã xác nhận).
3. Xem **ảnh sản phẩm tổng** với overlay các measurement points theo toạ độ. Có thể zoom / drag / rotate trong lightbox.
4. Click **một measurement point** trong overlay hoặc danh sách bên phải:
   - Hệ thống hiển thị ảnh **Reference** và ảnh **Actual** cạnh nhau.
   - Hiện kết quả đo, AI analysis result, confidence score.
5. (Tuỳ chọn) Bật **Compare Mode** để xem ảnh reference và actual ở chế độ split / overlay.
6. Bấm **Analyze with AI** để gọi LLM phân tích ảnh measurement (đưa ra defects, recommendations, confidence).
7. Nếu kết quả `NG` nhưng kiểm tra lại không có lỗi thật:
   - Bấm **Confirm NTF** → nhập **lý do** (NTF reason) → xác nhận.
   - Hệ thống cập nhật `ntfConfirmedBy`, `ntfConfirmedAt`, `ntfReason` và đổi `overallResult` thành `NTF`.
8. Nếu cần sửa lỗi kết quả của một measurement:
   - Bấm **Edit Result** trên measurement đó → chọn kết quả mới (`OK` / `NG` / `NTF`) → nhập lý do → **Save**.
9. Bấm **Back to History** để quay lại danh sách.

## 6. Kết quả mong đợi
- Hiển thị đầy đủ chi tiết kiểm tra cùng tất cả measurement points và ảnh.
- Overlay measurement points trên ảnh sản phẩm khớp toạ độ thực.
- Khi **Confirm NTF**: bản ghi cập nhật trong DB, trang Lịch sử hiện kết quả `NTF`.
- Khi **Correct Result**: `measurement_results.result` được cập nhật, log audit ghi nhận người sửa và lý do.
- Khi **Analyze with AI**: trả về assessment (`OK`/`NG`), defects, recommendations, confidence.

## 7. Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Ảnh không tải hoặc mờ | URL ảnh sai; storage (S3/MinIO) không khả dụng; watermark gây chậm | Kiểm tra `imageUrl` / `imageKey` trong `measurement_results`; xác minh kết nối storage; tạm tắt watermark để test |
| Toạ độ overlay sai vị trí | `positionX/Y` trong `measurement_point_defs` không khớp ảnh; ảnh sản phẩm khác kích thước reference | Đối chiếu `measurement_point_defs.positionX/Y/cropWidth/cropHeight`; cập nhật ảnh reference của product model |
| **Confirm NTF** báo lỗi | `originalResult` không phải `NG`; thiếu quyền | Chỉ NTF được khi result hiện tại = `NG`; kiểm tra quyền người dùng |
| **Analyze with AI** không trả kết quả | LLM (Ollama) không chạy; ảnh quá lớn; hết quota | Kiểm tra service AI Local (`127.0.0.1:11434`); resize ảnh; xem log `measurementResult.analyzeWithAI` |

## 8. API liên quan
- tRPC `inspection.getById` – lấy chi tiết inspection + measurement results.
- tRPC `inspection.confirmNTF` – xác nhận NTF cho inspection NG.
- tRPC `measurementResult.getByInspection` – list measurement của inspection.
- tRPC `measurementResult.correctResult` – sửa lỗi kết quả một measurement.
- tRPC `measurementResult.analyzeWithAI` – phân tích ảnh bằng LLM.
- tRPC `productModel.getByCode` – lấy ảnh reference + toạ độ measurement points.
- REST `GET /api/inspection/:id/images` – ảnh thuần (cho external client).
- REST `GET /api/measurement-point/:pointDefId/reference-image` – ảnh reference + toạ độ.
- Bảng DB: `product_inspections` (SELECT/UPDATE), `measurement_results` (SELECT/UPDATE), `measurement_point_defs`, `product_models`.

## 9. Tính năng liên quan
- **Lịch sử kiểm tra** (`history.md`) – nguồn vào của trang chi tiết.
- **Gói ảnh AOI** (`aoi-packages.md`) – xem ảnh gốc của kiểm tra trong package ZIP.
- **Mô hình sản phẩm & Measurement Points** – định nghĩa toạ độ và ảnh reference.

## 10. Ví dụ thực tế
> QC nhận thông báo Serial `SN20241115001` bị `NG`. Quy trình kiểm tra lại:
> 1. Vào **Lịch sử kiểm tra**, lọc Serial = `SN20241115001`, click vào dòng kết quả NG.
> 2. Trong **Chi tiết kiểm tra**, click measurement point bị NG (ví dụ `MP-12`).
> 3. So sánh ảnh **Reference** vs **Actual** trong **Compare Mode**: thấy không có khác biệt thực sự.
> 4. Bấm **Analyze with AI** để xác nhận → AI trả về `OK`, confidence 0.92.
> 5. Bấm **Confirm NTF**, nhập lý do: *"Phân tích lại bằng AI: không phát hiện lỗi thực, nghi ngờ camera nhiễu sáng."* → Save.
> 6. Quay lại **Lịch sử kiểm tra** → bản ghi hiện `NTF` với người xác nhận và thời gian.
