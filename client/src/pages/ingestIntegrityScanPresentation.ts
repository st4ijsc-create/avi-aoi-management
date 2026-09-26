/**
 * Lô 4 Mục 3 (BG-36) — integrityScan có đường đọc, PHẦN CLIENT.
 *
 * `server/routers/integrityRouter.ts` (`summary`) ĐÃ tồn tại + ĐÃ persist (đọc
 * `integrity_scan_results`, migration 0179) — KHÔNG cần procedure mới (đúng chỉ
 * dẫn brief: "nếu nó đã persist thì đọc", không tự chế bảng/migration mới). Việc
 * còn thiếu: (1) không trang client nào gọi `integrity.summary` (BG-36 khai
 * "integrityScan cũng chưa có giao diện" — đúng, dù server-side đã sẵn sàng từ
 * lâu); (2) `summary` trả TOÀN BỘ 21 relationship master-data (machines/stations/
 * lines/workshops/...), quá rộng cho một tab "ingest" — hàm THUẦN dưới đây lọc
 * xuống đúng các relationship LIÊN QUAN việc ingest kết quả kiểm tra
 * (`product_inspections`/`measurement_results`).
 */

export type IntegrityRelationshipLike = {
  key: string;
  [k: string]: unknown;
};

/**
 * Sáu khoá `INTEGRITY_RELATIONSHIPS`/`SOFT_INTEGRITY_CHECKS`/`CHA_KHONG_CON_CHECKS`
 * (`server/services/integrityScanService.ts`) liên quan TRỰC TIẾP tới dữ liệu
 * ingest (product_inspections/measurement_results) — đối lập với 15 khoá còn lại
 * (machines/stations/production_lines/workshops/factories/product_machine_mappings/
 * machine_recipes/recipe_deployments), thuộc phạm vi master-data KHÁC, không phải
 * "trang quản trị gói/ingest".
 */
export const INGEST_INTEGRITY_KEYS: readonly string[] = [
  "fk:product_inspections.machineId->machines.id",
  "fk:measurement_results.inspectionId->product_inspections.id",
  "fk:measurement_results.pointDefId->measurement_point_defs.id",
  "fk:measurement_results.defectCatalogId->defect_catalog.id",
  "soft:product_inspections.productModel->product_models.code",
  "cha-khong-con:product_inspections(v2.0)->measurement_results",
];

const INGEST_KEY_SET = new Set(INGEST_INTEGRITY_KEYS);

/**
 * Lọc `summary.relationships` (kiểu trả về của `integrity.summary`) xuống đúng
 * các relationship ingest-liên-quan. Một relationship CHƯA TỪNG được scan
 * (`lastScan: null`) vẫn được GIỮ LẠI — UI phải báo "chưa scan lần nào" trung
 * thực, không lặng lẽ lọc mất nó (khác với "0 vi phạm", vốn là tin tốt).
 */
export function locIngestLienQuan<T extends IntegrityRelationshipLike>(relationships: readonly T[]): T[] {
  return relationships.filter((r) => INGEST_KEY_SET.has(r.key));
}

// ── Fix review Lô 4 (Important) — phân biệt lỗi QUYỀN với empty-state THẬT ──────

/**
 * ⚠ CẬP NHẬT BG-131 (Lô 9 Mục 3, 2026-09-05) — đoạn dưới đây mô tả tình trạng TRƯỚC bản vá,
 * giữ nguyên văn để hiểu VÌ SAO hàm này tồn tại; tình trạng THẬT SAU vá: `integrity.summary`/
 * `runNow`/`history` (`server/routers/integrityRouter.ts`) đã đổi từ `adminProcedure` sang
 * `protectedProcedure + requirePermission("admin_system", canView|canEdit)` — CÙNG mô hình
 * với `aoiPackage.listDeadLetters`/`getDeadLetterDetail` mô tả bên dưới. Hàm `laLoiTuChoiQuyen`
 * này VẪN CẦN THIẾT (không xoá được) — một user THIẾU `admin_system.canView` vẫn nhận
 * FORBIDDEN thật ở `summary` (không có gate nào cấp quyền vô điều kiện), UI vẫn phải phân biệt
 * "0 relationship" thật với "bị từ chối quyền" — chỉ khác là NGƯỜI bị chặn hẹp lại (trước: mọi
 * non-admin; nay: chỉ non-`admin_system.canView`). `AOIPackages.tsx` còn thêm
 * `canRunIntegrityScan` (canEdit) RIÊNG cho nút "Quét ngay" — canView không tự cho canEdit, xem
 * comment tại chỗ dùng.
 *
 * ── Nguyên văn TRƯỚC bản vá (giữ để đối chiếu lịch sử) ──────────────────────────────────────
 * `integrity.summary`/`runNow`/`history` (`server/routers/integrityRouter.ts`) là
 * `adminProcedure` — đòi `ctx.user.role === 'admin'` ĐÚNG CHỮ (`server/_core/trpc.ts:357`),
 * KHÔNG dùng `requirePermission()`. `aoiPackage.listDeadLetters`/`getDeadLetterDetail`
 * (Lô 4 Mục 3) dùng `requirePermission("admin_system","canView")` — nhóm quyền CÓ THỂ
 * cấp cho một vai KHÔNG PHẢI admin (scoped-admin, xem `checkPermission` — một hàng
 * `permissions` với `canView=true` đủ để qua, không cần `role==='admin'`). Hai cổng
 * KHÔNG cùng lớp: một scoped-admin xem được tab dead-letter (đúng quyền của họ) nhưng
 * bị `integrity.summary` từ chối `FORBIDDEN` — nếu UI không phân biệt, empty-state
 * "0 relationship" và "bị từ chối quyền" trông GIỐNG HỆT NHAU, đúng lớp lỗi "một lối
 * vào rồi từ chối" (memory dự án đã ghi ở Khối D). KHÔNG đổi quyền của `integrityRouter`
 * ở đây — đó là quyết định ngoài phạm vi bản vá này (đổi ai được xem toàn bộ master-data
 * integrity là quyết định sản phẩm, không phải một fix UI) — ĐÃ LÀM Ở BG-131 (Lô 9 Mục 3).
 *
 * Hàm THUẦN — nhận hình dạng lỗi tRPC bất kỳ (không import `TRPCClientError` để giữ
 * module này không phụ thuộc `@trpc/client`, test được với object trần), cùng quy ước
 * đọc `error.data.code` mà `getErrorCode` (nội bộ, không export) của
 * `client/src/lib/trpcErrors.ts` đã dùng.
 */
export function laLoiTuChoiQuyen(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: { code?: unknown } }).data;
  return !!data && typeof data === "object" && data.code === "FORBIDDEN";
}
