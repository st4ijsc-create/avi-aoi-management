# Cấu hình Điểm đo (Measurement Points)

## Mục đích
Định nghĩa các điểm đo (Measurement Points — MP) cho từng Product Model: vị trí trên board, kiểu đo (dimension/presence/solder/OCR), spec USL/LSL/nominal, thuật toán inspect, và versioning. Đây là dữ liệu cốt lõi quyết định máy AOI sẽ kiểm tra cái gì và pass/fail theo ngưỡng nào.

## Vị trí truy cập
- Menu: `Menu chính` › `Sản phẩm` › `Mô hình sản phẩm` → mở chi tiết → tab `Measurement Points`
- URL: `/products/:productModelId` (tab `Measurement Points`)
- Vai trò thấy menu: admin, supervisor, quality_inspector

## Quyền yêu cầu
- Resource: `products`
- Actions: `products_view` (xem); `measurement_points_manage` (tạo/sửa/xoá)
- Middleware: `protectedProcedure` + `requirePermission('products_view')`; thao tác ghi yêu cầu thêm permission cụ thể.

## Tiền điều kiện
- Product Model đã được tạo (xem [Quản lý Sản phẩm](product-management.md)).
- Có golden image để định vị MP (khuyến nghị).
- Có ít nhất 1 fiducial mark để align toạ độ.

## Các bước thao tác
1. **Mở tab Measurement Points** — vào `/products`, nhấn vào tên product → tab `Measurement Points`. Bảng hiển thị `pointCode`, `type`, `nominal`, `USL`, `LSL`, `algorithm`, `version`, `isActive`.
2. **Thêm điểm đo** — nhấn `+ Add Measurement Point`.
   - Trường nhập: `pointCode` (bắt buộc, unique trong product), `type` (`dimension` | `presence` | `solder` | `OCR` | `color`), `coordinates` (X, Y, W, H trên golden image), `nominal`, `USL`, `LSL`, `unit` (`mm`, `µm`, `pixel`...), `algorithm` (`opencv-template-match`, `ai-classifier`, ...), `aiModelId` (nếu type AI).
3. **Import hàng loạt** — nhấn `Import CSV`. Format header: `pointCode,type,x,y,w,h,nominal,usl,lsl,unit,algorithm`. Tối đa 500 dòng/lần.
4. **Vẽ trên Golden Image** — nhấn `Draw Mode`, vẽ ROI trực tiếp trên ảnh; toạ độ X/Y/W/H tự điền.
5. **Lưu version** — mỗi lần thay đổi spec/coordinates sẽ tạo entry mới trong `measurement_point_versions`. Version cũ vẫn dùng được cho inspection records cũ.
6. **Activate / Deactivate** — toggle `isActive`. MP inactive sẽ bị bỏ qua khi inspect.

## Kết quả mong đợi
- Bản ghi mới trong `measurement_point_defs` với `productModelId`, `pointCode`, spec.
- Version mới trong `measurement_point_versions`.
- Máy AOI kéo MP qua API `productModel.getMeasurementPoints` lần inspect kế tiếp.
- (Nếu có SPC) thêm MP vào `mp_spc_alerts` theo dõi.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Toast `pointCode đã tồn tại` | Trùng trong cùng product | Đổi `pointCode` |
| Import CSV báo `Invalid USL/LSL` | LSL ≥ USL hoặc nominal nằm ngoài [LSL, USL] | Chỉnh lại spec trong CSV |
| Máy AOI không nhận MP mới | Máy đang cache version cũ | Restart Inspector hoặc gọi `POST /api/machines/:id/refresh-config` |
| Toạ độ sai khi inspect | Fiducial chưa được căn lại sau update | Re-detect fiducial trên golden image |

## API liên quan
- `measurementPoint.list` (tRPC) — params: `productModelId`, `versionId?`.
- `measurementPoint.create` / `.update` / `.delete`.
- `measurementPoint.importCsv` — body: file CSV.
- `GET /api/public/products/:productCode/measurement-points` — Public API cho Inspector.

## Tính năng liên quan
- [Quản lý Sản phẩm](product-management.md) — MP thuộc về 1 product.
- [SPC Analysis](../analytics/spc-analysis.md) — phân tích biến động MP qua thời gian.
- [Defect Heatmap](../analytics/defect-heatmap.md) — visualize tần suất NG theo MP.
- [Inspection Detail](../inspection/inspection-detail.md) — xem kết quả từng MP trong 1 inspection.

## Ví dụ thực tế
Tình huống: "QC Engineer cần thêm 12 điểm đo solder joint cho `PCB-A7-V2` trước ca chiều."
1. Mở `/products/PCB-A7-V2` → tab `Measurement Points`.
2. Bật `Draw Mode`, vẽ 12 ROI trên 12 chân solder của golden image.
3. Với mỗi ROI: chọn `type = solder`, `algorithm = ai-classifier`, `aiModelId = solder-cls-v3`.
4. Save → version mới `v4` được tạo.
5. Vào `/machines/5` → `Refresh Config` để máy nhận spec mới.
6. Thử inspect 5 board mẫu → xem kết quả ở [Inspection Detail](../inspection/inspection-detail.md) để verify.
