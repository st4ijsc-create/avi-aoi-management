# Gán Sản phẩm - Máy (Product-Machine Mapping)

## Mục đích
Khai báo máy AOI nào được phép kiểm tra sản phẩm nào. Cho phép thiết lập matrix N-N giữa Product Models và Machines, kèm cấu hình ưu tiên (priority), ngày hiệu lực, và ghi chú. Inspector chỉ chấp nhận inspection request nếu mapping tồn tại và đang active.

## Vị trí truy cập
- Menu: `Menu chính` › `Sản phẩm` › `Gán Sản phẩm-Máy`
- URL: `/product-machine-mapping`
- Vai trò thấy menu: admin, supervisor, quality_inspector

## Quyền yêu cầu
- Resource: `products`
- Actions: `products_view` (xem); `product_machine_mapping_manage` (ghi)
- Middleware: `protectedProcedure` + `requirePermission('products_view')`

## Tiền điều kiện
- Có ít nhất 1 Product Model đã tạo.
- Có ít nhất 1 Machine đã đăng ký (xem [Đăng ký Máy](../monitoring/machine-registration.md)).
- Product có Measurement Points đã định nghĩa (khuyến nghị, không bắt buộc).

## Các bước thao tác
1. **Mở matrix mapping** — vào `/product-machine-mapping`. Có 2 view:
   - `Matrix view` (mặc định): dòng = Product, cột = Machine, ô tích = mapping active.
   - `List view`: bảng với `productCode`, `machineCode`, `priority`, `effectiveFrom`, `effectiveTo`, `isActive`.
2. **Tạo mapping** — Matrix: click ô giao → toast hỏi xác nhận. List: nhấn `+ Add Mapping`.
   - Trường nhập: `productModelId` (chọn), `machineId` (chọn), `priority` (1–10, default 5), `effectiveFrom` (date, default hôm nay), `effectiveTo` (date, optional), `notes` (tuỳ chọn).
3. **Bulk assign** — nhấn `Bulk Assign`. Chọn nhiều product + nhiều machine + áp dụng cùng cấu hình.
4. **Sửa / Xoá** — bấm icon trên hàng. Xoá là soft-delete (`isActive = false`), không xoá cứng để giữ history cho inspection records.
5. **Export / Import CSV** — nút `Export` / `Import` ở góc trên-phải. Format CSV: `productCode,machineCode,priority,effectiveFrom,effectiveTo`.

## Kết quả mong đợi
- Bản ghi trong `product_machine_mappings` với `id`, `productModelId`, `machineId`, `priority`, `isActive = true`.
- Inspector trên máy đó nhận được product code mới khi gọi `GET /api/machines/:id/allowed-products`.
- Trên `Machine Detail` page, tab `Allowed Products` hiển thị thêm product mới.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Toast `Mapping đã tồn tại` | Đã có mapping active cho cặp product-machine | Sửa mapping cũ thay vì tạo mới |
| Inspection bị reject `Product not allowed on this machine` | Mapping inactive hoặc `effectiveFrom > today` | Activate mapping hoặc chỉnh `effectiveFrom` |
| Bulk assign báo lỗi 1 dòng | Có product/machine code không tồn tại | Sửa CSV, import lại |
| Không xoá được vĩnh viễn | Có inspection records tham chiếu | Chỉ soft-delete (set `isActive = false`) |

## API liên quan
- `productMachineMapping.list` (tRPC) — params: `machineId?`, `productId?`, `activeOnly?`.
- `productMachineMapping.create` / `.update` / `.delete` (soft).
- `productMachineMapping.bulkAssign` — body: `{ productIds: [], machineIds: [], priority, effectiveFrom }`.
- `GET /api/machines/:id/allowed-products` — Inspector dùng để tra cứu.

## Tính năng liên quan
- [Quản lý Sản phẩm](product-management.md) — phải có product trước.
- [Đăng ký Máy](../monitoring/machine-registration.md) — phải có machine trước.
- [Quản lý Quy trình](process-management.md) — process group các machine.
- [Inspection History](../inspection/history.md) — chỉ thấy record của (product, machine) đã được mapping.

## Ví dụ thực tế
Tình huống: "Line trưởng chuyển dây chuyền sang sản xuất `PCB-A7-V2` trên 3 máy AOI #5, #6, #7 từ thứ Hai tuần sau."
1. Vào `/product-machine-mapping` → `Bulk Assign`.
2. Chọn product = `PCB-A7-V2`, machines = `[5, 6, 7]`.
3. Set `effectiveFrom = next-monday`, `priority = 5`.
4. Save → 3 mappings được tạo.
5. Sang `/machines/5` → tab `Allowed Products` → confirm `PCB-A7-V2` đã xuất hiện.
6. Thứ hai 6h sáng: Inspector tự động pull config mới và bắt đầu inspect.
