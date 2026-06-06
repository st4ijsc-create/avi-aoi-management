# Quản lý Quy trình (Process Management)

## Mục đích
Định nghĩa các quy trình sản xuất (Process) gom nhiều bước/máy theo chuỗi. Mỗi process gồm các stage, mỗi stage có thể có nhiều máy AOI/AVI và rules chuyển đổi (next-stage). Dùng để mô tả workflow xưởng cho dashboard, scheduling, và traceability.

## Vị trí truy cập
- Menu: `Menu chính` › `Sản phẩm` › `Quy trình`
- URL: `/processes`
- Vai trò thấy menu: admin, supervisor, quality_inspector

## Quyền yêu cầu
- Resource: `products`
- Actions: `products_view` (xem); `process_manage` (tạo/sửa/xoá)
- Middleware: `protectedProcedure` + `requirePermission('products_view')`

## Tiền điều kiện
- Có ít nhất 1 Product Model.
- Có ít nhất 1 Machine.
- Khuyến nghị: đã có Product-Machine Mapping cho các machine trong process.

## Các bước thao tác
1. **Mở danh sách Processes** — vào `/processes`. Bảng hiển thị `code`, `name`, `productCount`, `stageCount`, `isActive`, `updatedAt`.
2. **Tạo Process mới** — nhấn `+ New Process`. Wizard 3 bước:
   - **B1 General**: `code` (unique), `name`, `description`, `category` (`SMT`, `Assembly`, `Packaging`, `QC` …).
   - **B2 Stages**: thêm các stage theo thứ tự. Mỗi stage có `name`, `order`, `machines` (multi-select), `isInspectionStage` (boolean).
   - **B3 Rules**: chọn `entryProducts` (products được phép vào process), `transitionRule` (`auto-advance` | `manual-confirm`), `failHandling` (`reject` | `rework` | `quarantine`).
3. **Save** — nhấn `Create`. Hệ thống gọi `process.create`, toast `Tạo Process thành công`.
4. **Mở chi tiết** — click vào tên process → trang chi tiết: tab `Overview`, `Stages`, `Products`, `Statistics`.
5. **Activate / Deactivate** — toggle `isActive`. Inactive process không hiển thị trong scheduling.

## Kết quả mong đợi
- Bản ghi trong bảng `processes` (hoặc tương đương) với `id`, `code`, `stages` (jsonb hoặc bảng con `process_stages`).
- Dashboard `Production` có thêm process mới ở dropdown filter.
- Statistics tab tự động tính throughput, NG rate per stage sau khi có data.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Toast `Code đã tồn tại` | Trùng `code` | Đổi code |
| Stage không cho thêm machine | Machine đã thuộc stage khác trong cùng process | Mỗi machine chỉ thuộc 1 stage; xoá khỏi stage cũ trước |
| Không thấy product trong dropdown `entryProducts` | Product chưa active hoặc không có MP | Activate product, định nghĩa MP trước |
| Inspection từ chối với `Process stage mismatch` | Stage rule `manual-confirm` chưa được operator confirm | Operator phải confirm tại stage trước |

## API liên quan
- `process.list` (tRPC) — phân trang, filter `category`, `isActive`.
- `process.create` / `.update` / `.delete`.
- `process.getStatistics` — params: `processId`, `from`, `to`. Trả về throughput, NG rate per stage.
- `process.advance` — di chuyển 1 unit sang stage tiếp theo (nếu manual-confirm).

## Tính năng liên quan
- [Quản lý Sản phẩm](product-management.md) — product được gán vào `entryProducts`.
- [Gán Sản phẩm-Máy](product-machine-mapping.md) — mapping ở tầng máy, process ở tầng workflow.
- [Production Orders](../production/production-orders.md) — order tham chiếu process.
- [Production Scheduling](../production/production-scheduling.md) — schedule theo process.

## Ví dụ thực tế
Tình huống: "Manager xưởng tạo quy trình `SMT-A7-Full` cho dòng PCB-A7: gồm 3 stage Print → Place → AOI Inspect, mỗi stage 2 máy."
1. Vào `/processes` → `+ New Process`.
2. B1: `code = SMT-A7-FULL`, `name = SMT A7 Full`, `category = SMT`.
3. B2 Stages:
   - Stage 1 `Print` (machines: Printer-1, Printer-2)
   - Stage 2 `Place` (machines: Placer-1, Placer-2)
   - Stage 3 `AOI` (machines: AOI-5, AOI-6) — `isInspectionStage = true`.
4. B3 Rules: `entryProducts = [PCB-A7-V2]`, `transitionRule = auto-advance`, `failHandling = rework`.
5. Save → Process active → Production Orders có thể chọn process này.
