import type { MasterDataColumn } from "./masterDataIO";

/**
 * MỘT nguồn sự thật cho spec cột danh sách sản phẩm (import/export/template).
 *
 * ⚠ `header` KHÔNG được bọc t(). Nó mang BA vai (xem masterDataIO.ts:26-37):
 * nhãn hiển thị, KHOÁ KHỚP tên cột trong file Excel/CSV người dùng tải lên
 * (`mapAndValidate` dò bằng `normalizeKey(col.header)`), và hàng tiêu đề của
 * file template xuất ra. Bọc t() vào đây (hoặc dịch giá trị) làm mọi file
 * Excel người dùng đang có hết nhập được — template xuất ra cũng mang tên cột
 * lạ. Muốn nhãn HIỂN THỊ đổi theo ngôn ngữ thì dùng `headerKey` (chỉ ảnh
 * hưởng bảng xem trước khi nhập, không ảnh hưởng khớp cột/tiêu đề template).
 *
 * Trước bản vá này spec cột sản phẩm có HAI bản sao không cổng nào canh lệch:
 *   - server/routers/productRouters.ts (PRODUCT_IMPORT_COLUMNS/PRODUCT_EXPORT_COLUMNS,
 *     0 cột có headerKey)
 *   - client/src/pages/ProductModels.tsx (PRODUCT_IO_COLUMNS, có đủ headerKey)
 * Khớp 10/10 theo `header` — nhưng đó là may mắn, không phải cơ chế. File này
 * gộp lại thành một nguồn duy nhất; cả hai phía import từ đây.
 */
export const PRODUCT_COLUMN_SPEC: readonly MasterDataColumn[] = [
  { field: "code", header: "Mã sản phẩm", headerKey: "productModelsCol.code", required: true, type: "string", example: "SP-001" },
  { field: "name", header: "Tên sản phẩm", headerKey: "productModelsCol.name", required: true, type: "string", example: "Bảng mạch A" },
  { field: "description", header: "Mô tả", headerKey: "productModelsCol.description", type: "string" },
  { field: "category", header: "Nhóm", headerKey: "productModelsCol.category", type: "string", example: "PCBA" },
  { field: "productLine", header: "Dòng sản phẩm", headerKey: "productModelsCol.productLine", type: "string" },
  { field: "variant", header: "Biến thể", headerKey: "productModelsCol.variant", type: "string" },
  { field: "revision", header: "Phiên bản (Rev)", headerKey: "productModelsCol.revision", type: "string", example: "A" },
  { field: "lifecycleStatus", header: "Trạng thái vòng đời", headerKey: "productModelsCol.lifecycleStatus", type: "string", example: "active" },
  { field: "targetYieldRate", header: "FPY mục tiêu (%)", headerKey: "productModelsCol.targetYieldRate", type: "number", example: 98 },
  { field: "minYieldRate", header: "FPY tối thiểu (%)", headerKey: "productModelsCol.minYieldRate", type: "number", example: 95 },
] as const;

/** Cột XUẤT = cột nhập + ngày tạo/cập nhật (chỉ đọc, không dùng khi nhập). */
export const PRODUCT_EXPORT_COLUMN_SPEC: readonly MasterDataColumn[] = [
  ...PRODUCT_COLUMN_SPEC,
  { field: "createdAt", header: "Ngày tạo", headerKey: "productModelsCol.createdAt", type: "date" },
  { field: "updatedAt", header: "Ngày cập nhật", headerKey: "productModelsCol.updatedAt", type: "date" },
] as const;
