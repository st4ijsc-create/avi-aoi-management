/**
 * ★★★ 2026-08-18 — TRỤC PHẠM VI THỨ HAI: **mã tenant TƯỜNG MINH** (không phải danh tính người dùng).
 * ════════════════════════════════════════════════════════════════════════════
 * Hệ có HAI loại principal đọc số liệu, và tới hôm nay chỉ MỘT loại có trục phạm vi:
 *
 *   1. **NGƯỜI DÙNG** — `userId`/`userRole` → `getUserAssignmentCodes` → `getAccessFilterConditions`.
 *      Quyền là CỘNG DỒN nhiều bản gán ⇒ mệnh đề là **OR** nhiều danh sách mã.
 *   2. **KHOÁ API** — `api_keys.dataScopeMode/corporateCode/factoryCode` (mig 0325). Một khoá
 *      đại diện MỘT nhà máy ⇒ mệnh đề là **AND** hai mã (lời khai chi tiết hơn phải THU HẸP,
 *      không được NỚI — xem docblock `inspectionTenantFilter`).
 *
 * ⚠⚠ **VÌ SAO KHÔNG MƯỢN DANH TÍNH NGƯỜI TẠO KHOÁ.** `api_keys.createdBy` là NULLable, và người
 * tạo có thể đã nghỉ việc hoặc là admin (⇒ khoá tự động thành TOÀN CỤC). Mượn danh tính là sai
 * ngữ nghĩa và sai cả hướng an toàn. Nên trục thứ hai này tồn tại như một trục RIÊNG.
 *
 * ⚠ **VÌ SAO FILE NÀY TÁCH RA KHỎI CẢ HAI NƠI DÙNG.** Vị từ dưới đây được dùng ở
 * `api/v1/apiKeyScope.ts` (tầng HTTP) VÀ `db/reportAggregators.ts` + `db/statistics.ts` (tầng
 * CSDL). Đặt nó ở một trong hai chỗ sẽ tạo cạnh nhập từ `server/db/**` sang `server/api/**` (hoặc
 * ngược lại) — đúng loại vòng mà `_core/accessControl` đã phải né bằng `import()` động. File này
 * chỉ phụ thuộc `drizzle-orm` + `drizzle/schema`, không kéo theo express, không kéo theo tRPC,
 * không kéo theo `db/connection` ⇒ cả hai tầng nhập TĨNH được. Một luật, một chỗ sửa.
 *
 * ⚠ **DỰNG LƯỜI, KHÔNG PHẢI HẰNG Ở TẦNG MODULE.** Năm lưới của `server/api/v1/**`
 * `vi.mock("drizzle-orm")` chỉ trả `eq`/`and`; một lời gọi `sql\`…\`` ở tầng module sẽ chạy NGAY
 * LÚC NẠP và làm hỏng khâu nạp của cả năm file (đo được: 5 file ĐỎ, 0 ca chạy). Vì thế
 * `denyAllRows()` là một HÀM.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { productInspections } from "../../drizzle/schema";

/**
 * Phạm vi tenant khai bằng MÃ. Cả hai ô rỗng = lời khai RỖNG ⇒ TỪ CHỐI TẤT CẢ, không phải
 * "không lọc" (đó chính xác là lớp lỗi `or()` rỗng đã cho 4 tài khoản 0-gán đọc trọn 22.996
 * bản ghi kiểm — xem `DENY_ALL_ROWS` ở `_core/accessControl.ts`).
 */
export interface TenantCodeScope {
  corporateCode?: string | null;
  factoryCode?: string | null;
}

/** Vị từ FALSE TƯỜNG MINH. Dựng lười — xem docblock đầu file. */
function denyAllRows(): SQL {
  return sql`1 = 0`;
}

/** Lời khai có mang ít nhất một mã không? Rỗng ⇒ mọi cổng phải fail-CLOSED. */
export function isTenantCodeScopeEmpty(scope: TenantCodeScope | null | undefined): boolean {
  return !scope?.corporateCode && !scope?.factoryCode;
}

/**
 * Điều kiện thu hẹp trên các cột của **`product_inspections`**, nối bằng **AND**.
 *
 * ⚠ KIỂU TRẢ VỀ LÀ `SQL`, KHÔNG PHẢI `SQL | undefined` — và đó là điểm mấu chốt. Mọi nơi gọi
 * viết `if (x) conditions.push(x)`, nên một `undefined` lọt ra đây sẽ đọc thành "KHÔNG có mệnh
 * đề WHERE" = "thấy TẤT CẢ". Trục này không có khái niệm "toàn cục": khoá toàn cục đơn giản là
 * KHÔNG truyền `tenantScope`, nên hàm này không bao giờ cần một đường thoát mở cửa.
 *
 * ⚠ **KHÔNG ĐẶT BÍ DANH BẢNG** ở truy vấn nơi gọi. Drizzle kết xuất cột theo TÊN BẢNG
 * (`"product_inspections"."factoryCode"`); một `FROM product_inspections pi` sẽ vỡ
 * `42P01 missing FROM-clause entry` khi nhúng vị từ này.
 */
export function tenantCodeInspectionFilter(scope: TenantCodeScope | null | undefined): SQL {
  const conds: SQL[] = [];
  if (scope?.corporateCode) conds.push(eq(productInspections.corporateCode, scope.corporateCode));
  if (scope?.factoryCode) conds.push(eq(productInspections.factoryCode, scope.factoryCode));
  if (conds.length === 0) return denyAllRows();
  if (conds.length === 1) return conds[0];
  // `and()` với ≥2 phần tử không thể trả undefined; nếu nó vẫn trả thì đường thoát là TỪ CHỐI,
  // không phải mở cửa (không dùng dấu `!` — chính dấu ấy đã che mất lỗ ở `_core/accessControl.ts`).
  return and(...conds) ?? denyAllRows();
}
