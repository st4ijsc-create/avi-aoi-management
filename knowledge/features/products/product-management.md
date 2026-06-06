# Quản lý Sản phẩm (Product Models)

## Mục đích
Quản lý danh mục các mô hình sản phẩm (Product Models) được kiểm tra trên hệ thống AVI/AOI: tạo, sửa, xoá, phân loại, gắn ảnh chuẩn (golden image), fiducial marks và dimension specs để các máy AOI có thông tin tham chiếu khi inspect.

## Vị trí truy cập
- Menu: `Menu chính` › `Sản phẩm` › `Mô hình sản phẩm`
- URL: `/products`
- Vai trò thấy menu: admin, supervisor, quality_inspector

## Quyền yêu cầu
- Resource: `products`
- Actions cần thiết: `products_view` (xem); `products_manage` (tạo/sửa/xoá nếu được tách quyền)
- Middleware: `protectedProcedure` + `requirePermission('products_view')`

## Tiền điều kiện
- Đã đăng nhập với tài khoản có quyền `products_view`.
- Đã có ít nhất 1 `Category` (danh mục sản phẩm) hoặc cho phép category mặc định.
- Nếu cần upload golden image: đã cấu hình storage (ImagesService — ảnh lưu trên `images/products/<modelId>/`).

## Các bước thao tác
1. **Mở danh sách Product Models** — vào `/products`. Bảng hiển thị các cột: `Code`, `Name`, `Category`, `Số MP`, `Số máy gán`, `Updated at`. Có ô search theo `code/name`, filter theo `category`.
2. **Tạo mô hình mới** — nhấn `+ New Product Model`. Dialog mở.
   - Trường nhập: `code` (bắt buộc, unique), `name` (bắt buộc), `category` (chọn từ dropdown), `description` (tuỳ chọn), `goldenImage` (upload — file PNG/JPG, khuyến nghị ≤ 5 MB).
   - Tab `Fiducial Marks`: thêm các điểm fiducial (toạ độ X, Y, kiểu).
3. **Lưu** — nhấn `Save`. Hệ thống gọi `productModel.create`. Toast `Tạo Product Model thành công`.
4. **Sửa / Xoá** — nhấn icon edit/trash trên hàng. Xoá yêu cầu xác nhận và sẽ thất bại nếu còn `product_machine_mappings` hoặc `inspection_records` tham chiếu.
5. **Mở chi tiết để cấu hình Measurement Points** — nhấn vào tên mô hình → mở trang chi tiết, có các tab `Overview`, `Measurement Points`, `Fiducial Marks`, `Versions`.

## Kết quả mong đợi
- Bản ghi mới xuất hiện trong bảng `product_models` với `id` (uuid), `code`, `name`, `categoryId`, `goldenImagePath`.
- File ảnh golden được lưu vào `images/products/<id>/golden.<ext>`.
- Có thể tham chiếu `productCode` từ Public API `/api/public/products/by-code/:code`.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Toast `Code đã tồn tại` | `code` không unique | Đổi sang code khác hoặc tìm bản ghi cũ |
| Không upload được golden image | File > 5 MB hoặc sai định dạng | Resize / convert sang PNG/JPG ≤ 5 MB |
| Không xoá được product | Còn `product_machine_mappings` hoặc inspection records | Xoá mapping trước, hoặc archive (set `isActive = false`) |
| Nút `+ New` bị ẩn | Thiếu quyền `products_manage` | Yêu cầu admin cấp quyền |

## API liên quan
- `productModel.list` (tRPC) — danh sách phân trang, filter theo `category`, `search`.
- `productModel.create` (tRPC) — body `{ code, name, categoryId, description, goldenImagePath?, fiducialMarks? }`.
- `productModel.update` / `productModel.delete` (tRPC).
- `GET /api/public/products` — public list (External API).
- `GET /api/public/products/by-code/:code` — tra cứu theo code.

## Tính năng liên quan
- [Cấu hình Điểm đo (Measurement Points)](measurement-point-setup.md) — định nghĩa MP cho từng product.
- [Gán Sản phẩm-Máy](product-machine-mapping.md) — gán sản phẩm cho từng máy AOI.
- [Quản lý Quy trình](process-management.md) — process nào dùng product nào.
- [Inspection History](../inspection/history.md) — kết quả inspect tham chiếu `productCode`.

## Ví dụ thực tế
Tình huống: "QC Engineer line A cần thêm mô hình mới `PCB-A7-V2` để máy AOI #5 có thể bắt đầu kiểm tra lô sản phẩm mới sáng mai."
1. Vào `/products` → `+ New Product Model`.
2. Nhập `code = PCB-A7-V2`, `name = Mainboard A7 v2`, `category = Mainboard`.
3. Upload `golden.png` đã chụp từ board mẫu chuẩn.
4. Thêm 4 fiducial marks tại 4 góc (toạ độ pixel).
5. Save → mở chi tiết → tab `Measurement Points` → import CSV 38 điểm đo.
6. Sang `/product-machine-mapping` gán `PCB-A7-V2` cho `Machine #5`.
