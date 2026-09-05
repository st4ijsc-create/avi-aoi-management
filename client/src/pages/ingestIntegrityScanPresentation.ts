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
