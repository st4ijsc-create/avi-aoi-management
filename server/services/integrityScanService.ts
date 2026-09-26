/**
 * Master-data Integrity Scan Service (doc 27 §2 M1/M6/M11 — Đợt 3 item 3.1, W3-A)
 * ================================================================================
 * Re-runs the EXACT orphan/duplicate scans from migration 0179 on demand and on a
 * weekly cron, appending results to `integrity_scan_results` (created by 0179) so
 * drift is visible during the transition period in which some constraints from
 * 0180 are still NOT VALID / deferred (dirty legacy data) or intentionally
 * skipped (TimescaleDB cannot hold an FK referencing a hypertable — the
 * measurement_results.inspectionId relationship is covered HERE instead).
 *
 * SCAN KEY CONTRACT: `key` strings below are shared verbatim with migrations
 * 0179/0180 and scripts/repair-orphans.mjs (a test cross-checks the lists).
 *
 * Design: read-only scans + one INSERT per relationship into the report table;
 * fail-safe (a broken relationship marks itself degraded, never throws out);
 * single-flight; scheduler mirrors kbSyncScheduler/aiAnomalyBankScheduler.
 *
 * Env flags:
 *   INTEGRITY_SCAN_ENABLED (default "true" — this is a transitional SAFETY NET;
 *                           read-only counts, bounded work. Set "false" to disable.)
 *   INTEGRITY_SCAN_CRON    (default "30 3 * * 0" — Sunday 03:30, off-peak)
 *   INTEGRITY_SCAN_TZ      (default "Asia/Ho_Chi_Minh")
 */
import * as cron from "node-cron";
import { sql } from "drizzle-orm";
// W4-D (doc 27 §8 B5): integrity scans are long full-table LEFT JOIN counts —
// route them through the dedicated background-jobs pool (DB_POOL_MAX_JOBS) so
// a slow weekly scan never starves interactive API requests.
import { getJobsDb as getDb } from "../db/connection";

// ─── Relationship catalogue (single source of truth on the app side) ──────────

// Pha 1C Task 5 (BG-28, spec §13 Đ-19): "cha-khong-con" là chiều NGƯỢC với "fk-orphan"/
// "fk-soft-orphan" — hai kind đó bắt CON mồ côi (con trỏ tới cha không tồn tại); kind mới
// bắt CHA không có con nào (header product_inspections tồn tại mà measurement_results rỗng).
// Không FK/NOT NULL nào canh chiều này — một bo 0 dòng đo là hình dạng payload HỢP LỆ ở
// tầng SQL, nên đây là luật GIÁM SÁT thuần, không phải ràng buộc.
export type IntegrityKind = "fk-orphan" | "unique-duplicate" | "fk-soft-orphan" | "cha-khong-con";
/** How scripts/repair-orphans.mjs may fix violations of this relationship. */
export type RepairStrategy =
  | "set-null"      // safe auto-fix: NULL out the dangling soft reference
  | "delete-row"    // auto-fix only with --fix --allow-delete: drop garbage join rows
  | "manual";       // structural — print guidance, never auto-fix

export interface IntegrityRelationship {
  /** Stable scan key — matches integrity_scan_results."scanKey" (0179/0180). */
  key: string;
  kind: IntegrityKind;
  childTable: string;
  childColumn: string;
  parentTable?: string;
  parentColumn?: string;
  /** FK constraint name / unique index name created by migration 0180. */
  constraintName: string;
  /** ON DELETE behaviour (FKs) or "unique". Documentation for the UI. */
  enforcement: "RESTRICT" | "CASCADE" | "SET NULL" | "UNIQUE";
  repair: RepairStrategy;
  /** SELECT returning a single row { n: bigint } — violation count. */
  countSql: string;
  /** SELECT returning ≤20 sample rows (child ids or duplicate key tuples). */
  sampleSql: string;
}

const fkPair = (childFrag: string) => ({
  countSql: `SELECT count(*)::bigint AS n ${childFrag}`,
  sampleSql: `SELECT c.id ${childFrag} ORDER BY c.id LIMIT 20`,
});

export const INTEGRITY_RELATIONSHIPS: IntegrityRelationship[] = [
  {
    key: "fk:machines.stationId->stations.id",
    kind: "fk-orphan", childTable: "machines", childColumn: "stationId",
    parentTable: "stations", parentColumn: "id",
    constraintName: "fk_machines_station", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM machines c LEFT JOIN stations p ON c."stationId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:stations.lineId->production_lines.id",
    kind: "fk-orphan", childTable: "stations", childColumn: "lineId",
    parentTable: "production_lines", parentColumn: "id",
    constraintName: "fk_stations_line", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM stations c LEFT JOIN production_lines p ON c."lineId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:production_lines.workshopId->workshops.id",
    kind: "fk-orphan", childTable: "production_lines", childColumn: "workshopId",
    parentTable: "workshops", parentColumn: "id",
    constraintName: "fk_production_lines_workshop", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM production_lines c LEFT JOIN workshops p ON c."workshopId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:workshops.factoryId->factories.id",
    kind: "fk-orphan", childTable: "workshops", childColumn: "factoryId",
    parentTable: "factories", parentColumn: "id",
    constraintName: "fk_workshops_factory", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM workshops c LEFT JOIN factories p ON c."factoryId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:factories.corporateCode->corporates.code",
    kind: "fk-orphan", childTable: "factories", childColumn: "corporateCode",
    parentTable: "corporates", parentColumn: "code",
    constraintName: "fk_factories_corporate", enforcement: "RESTRICT", repair: "set-null",
    ...fkPair('FROM factories c LEFT JOIN corporates p ON c."corporateCode" = p.code WHERE c."corporateCode" IS NOT NULL AND p.id IS NULL'),
  },
  {
    key: "fk:product_inspections.machineId->machines.id",
    kind: "fk-orphan", childTable: "product_inspections", childColumn: "machineId",
    parentTable: "machines", parentColumn: "id",
    constraintName: "fk_product_inspections_machine", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM product_inspections c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL'),
  },
  {
    // ⚠ Hypertable-sensitive: when 0172 made these two tables hypertables, the
    // DB holds NO FK here (0180 skips it) — this weekly scan IS the guard.
    key: "fk:measurement_results.inspectionId->product_inspections.id",
    kind: "fk-orphan", childTable: "measurement_results", childColumn: "inspectionId",
    parentTable: "product_inspections", parentColumn: "id",
    constraintName: "fk_measurement_results_inspection", enforcement: "CASCADE", repair: "manual",
    ...fkPair('FROM measurement_results c LEFT JOIN product_inspections p ON c."inspectionId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:measurement_results.pointDefId->measurement_point_defs.id",
    kind: "fk-orphan", childTable: "measurement_results", childColumn: "pointDefId",
    parentTable: "measurement_point_defs", parentColumn: "id",
    constraintName: "fk_measurement_results_point_def", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM measurement_results c LEFT JOIN measurement_point_defs p ON c."pointDefId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:measurement_results.defectCatalogId->defect_catalog.id",
    kind: "fk-orphan", childTable: "measurement_results", childColumn: "defectCatalogId",
    parentTable: "defect_catalog", parentColumn: "id",
    constraintName: "fk_measurement_results_defect_catalog", enforcement: "SET NULL", repair: "set-null",
    ...fkPair('FROM measurement_results c LEFT JOIN defect_catalog p ON c."defectCatalogId" = p.id WHERE c."defectCatalogId" IS NOT NULL AND p.id IS NULL'),
  },
  {
    key: "fk:product_machine_mappings.productModelId->product_models.id",
    kind: "fk-orphan", childTable: "product_machine_mappings", childColumn: "productModelId",
    parentTable: "product_models", parentColumn: "id",
    constraintName: "fk_pm_mappings_product", enforcement: "CASCADE", repair: "delete-row",
    ...fkPair('FROM product_machine_mappings c LEFT JOIN product_models p ON c."productModelId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:product_machine_mappings.machineId->machines.id",
    kind: "fk-orphan", childTable: "product_machine_mappings", childColumn: "machineId",
    parentTable: "machines", parentColumn: "id",
    constraintName: "fk_pm_mappings_machine", enforcement: "CASCADE", repair: "delete-row",
    ...fkPair('FROM product_machine_mappings c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:machine_recipes.machineId->machines.id",
    kind: "fk-orphan", childTable: "machine_recipes", childColumn: "machineId",
    parentTable: "machines", parentColumn: "id",
    constraintName: "fk_machine_recipes_machine", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM machine_recipes c LEFT JOIN machines p ON c."machineId" = p.id WHERE c."machineId" IS NOT NULL AND p.id IS NULL'),
  },
  {
    key: "fk:recipe_deployments.recipeId->machine_recipes.id",
    kind: "fk-orphan", childTable: "recipe_deployments", childColumn: "recipeId",
    parentTable: "machine_recipes", parentColumn: "id",
    constraintName: "fk_recipe_deployments_recipe", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."recipeId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:recipe_deployments.machineId->machines.id",
    kind: "fk-orphan", childTable: "recipe_deployments", childColumn: "machineId",
    parentTable: "machines", parentColumn: "id",
    constraintName: "fk_recipe_deployments_machine", enforcement: "RESTRICT", repair: "manual",
    ...fkPair('FROM recipe_deployments c LEFT JOIN machines p ON c."machineId" = p.id WHERE p.id IS NULL'),
  },
  {
    key: "fk:recipe_deployments.previousRecipeId->machine_recipes.id",
    kind: "fk-orphan", childTable: "recipe_deployments", childColumn: "previousRecipeId",
    parentTable: "machine_recipes", parentColumn: "id",
    constraintName: "fk_recipe_deployments_previous_recipe", enforcement: "SET NULL", repair: "set-null",
    ...fkPair('FROM recipe_deployments c LEFT JOIN machine_recipes p ON c."previousRecipeId" = p.id WHERE c."previousRecipeId" IS NOT NULL AND p.id IS NULL'),
  },
  // ── Unique-duplicate relationships [M6] (violationCount = duplicate GROUPS) ──
  {
    key: "uq:workshops(factoryId,code)[active]",
    kind: "unique-duplicate", childTable: "workshops", childColumn: "factoryId,code",
    constraintName: "uq_workshops_factory_code_active", enforcement: "UNIQUE", repair: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM workshops WHERE "isActive" GROUP BY "factoryId", code HAVING count(*) > 1) d',
    sampleSql: 'SELECT "factoryId", code, count(*)::int AS n FROM workshops WHERE "isActive" GROUP BY "factoryId", code HAVING count(*) > 1 ORDER BY "factoryId", code LIMIT 20',
  },
  {
    key: "uq:production_lines(workshopId,code)[active]",
    kind: "unique-duplicate", childTable: "production_lines", childColumn: "workshopId,code",
    constraintName: "uq_production_lines_workshop_code_active", enforcement: "UNIQUE", repair: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM production_lines WHERE "isActive" GROUP BY "workshopId", code HAVING count(*) > 1) d',
    sampleSql: 'SELECT "workshopId", code, count(*)::int AS n FROM production_lines WHERE "isActive" GROUP BY "workshopId", code HAVING count(*) > 1 ORDER BY "workshopId", code LIMIT 20',
  },
  {
    key: "uq:stations(lineId,code)[active]",
    kind: "unique-duplicate", childTable: "stations", childColumn: "lineId,code",
    constraintName: "uq_stations_line_code_active", enforcement: "UNIQUE", repair: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM stations WHERE "isActive" GROUP BY "lineId", code HAVING count(*) > 1) d',
    sampleSql: 'SELECT "lineId", code, count(*)::int AS n FROM stations WHERE "isActive" GROUP BY "lineId", code HAVING count(*) > 1 ORDER BY "lineId", code LIMIT 20',
  },
  {
    key: "uq:product_machine_mappings(productModelId,machineId)",
    kind: "unique-duplicate", childTable: "product_machine_mappings", childColumn: "productModelId,machineId",
    constraintName: "uq_pm_mappings_pair", enforcement: "UNIQUE", repair: "manual",
    countSql: 'SELECT count(*)::bigint AS n FROM (SELECT 1 FROM product_machine_mappings GROUP BY "productModelId", "machineId" HAVING count(*) > 1) d',
    sampleSql: 'SELECT "productModelId", "machineId", count(*)::int AS n FROM product_machine_mappings GROUP BY "productModelId", "machineId" HAVING count(*) > 1 ORDER BY 1, 2 LIMIT 20',
  },
];

// ─── Soft-orphan checks (doc 51 P2 — CASE #6) ────────────────────────────────
//
// DISTINCT from INTEGRITY_RELATIONSHIPS above: those model REAL foreign keys that
// migrations 0179/0180 audit + enforce, and a contract test asserts the app list
// matches 0179 and repair-orphans.mjs verbatim. A "soft orphan" is NOT an FK
// violation — it is a RECOVERABLE dangling soft-link that no constraint can catch:
//
//   An AOI/AVI machine posts an inspection for a product model that does not exist
//   yet. Ingest stores productModelId = NULL but keeps the raw `productModel` code
//   string. Later an engineer creates that model — but the historical inspections
//   stay NULL forever, so they vanish from every by-model report (all of which
//   GROUP/JOIN on productModelId). The row is not an FK orphan (NULL FKs are legal);
//   it is a link that BECAME resolvable and nobody re-anchored it.
//
// These live in a SEPARATE list (and a SEPARATE `softResults` bucket on the run)
// precisely so they do NOT enter the 0179/0180/repair-script key contract. They
// are surfaced (count + sample) and persisted to integrity_scan_results like the
// FK scans, and are auto-repaired going forward by the model-create backfill in
// productRouters (and in bulk by `repair-orphans.mjs` over the historical backlog).
export const SOFT_INTEGRITY_CHECKS: IntegrityRelationship[] = [
  {
    key: "soft:product_inspections.productModel->product_models.code",
    kind: "fk-soft-orphan",
    childTable: "product_inspections", childColumn: "productModel",
    parentTable: "product_models", parentColumn: "code",
    // No DB constraint exists for this relationship — enforcement is documentation
    // only (a NULL productModelId is a legal FK state). Repaired by backfill.
    constraintName: "(none — recoverable soft link; backfilled on model create)",
    enforcement: "SET NULL", repair: "manual",
    countSql:
      'SELECT count(*)::bigint AS n FROM product_inspections c ' +
      'WHERE c."productModelId" IS NULL AND c."productModel" IS NOT NULL ' +
      'AND EXISTS (SELECT 1 FROM product_models p WHERE p.code = c."productModel")',
    sampleSql:
      'SELECT c.id, c."productModel" AS "productModel" FROM product_inspections c ' +
      'WHERE c."productModelId" IS NULL AND c."productModel" IS NOT NULL ' +
      'AND EXISTS (SELECT 1 FROM product_models p WHERE p.code = c."productModel") ' +
      'ORDER BY c.id LIMIT 20',
  },
];

// ─── "Cha không có con" checks (Pha 1C Task 5, BG-28, spec §13 Đ-19) ──────────
//
// Trước bản vá này, file có 12 luật fk-orphan + 1 luật fk-soft-orphan — TẤT CẢ đều bắt
// chiều "con mồ côi" (con trỏ tới cha không tồn tại). KHÔNG luật nào bắt chiều ngược lại:
// một bo (`product_inspections`) tồn tại mà `measurement_results` của nó RỖNG.
//
// Đây KHÔNG phải giả thuyết — đường ghi v2.0 hiện chưa ghi được cấp component vì
// `measurement_results.pointDefId` là NOT NULL + FK RESTRICT, và định nghĩa điểm đo
// (Khối B) chưa chạy. Hậu quả đo được (spec §13 Đ-19): khi total=0,
//   • `stationAnalysisRouter.ts:1922`   defectRate=0 ⇒ status='pass'   → bản đồ bo TOÀN XANH
//   • `ngRateAlertService.ts:208`       total<minSampleSize ⇒ return   → cảnh báo NG-rate KHÔNG BAO GIỜ bắn
//   • (ở đây, trước bản vá)             0 luật                          → lỗ VÔ HÌNH với giám sát toàn vẹn
//
// SCOPE: chỉ tính bo đi qua đường ingest CÂY v2.0 — nhận diện bằng `summaryCounts IS NOT
// NULL` (cột NÀY chỉ được ghi ở ĐÚNG MỘT nơi trong mã sản xuất: `machineApiRouters.ts:3225`,
// nhánh `submitInspection` v2.0). KHÔNG quét toàn bộ `product_inspections` — DB thật có
// 37.550/42.804 bo không có measurement_results, áp đảo bởi dữ liệu v1.x/di sản không liên
// quan gì tới lỗ này (đo trực tiếp trên DB test 2026-08-29); một luật không lọc theo scope sẽ
// luôn đỏ vì lý do KHÁC, làm loãng đúng tín hiệu cần bắt.
//
// childTable/childColumn/parentTable/parentColumn ở đây mang nghĩa "bảng có HÀNG VI PHẠM" /
// "bảng lẽ ra phải có hàng khớp" — KHÔNG phải hướng FK thật (measurement_results mới là bên
// giữ cột FK `inspectionId`). Cố ý đảo để nhất quán với ngữ nghĩa hiển thị `childTable` ở
// RelationshipScanResult (nơi có hàng cần chú ý), không phải hướng khai báo ràng buộc.
export const CHA_KHONG_CON_CHECKS: IntegrityRelationship[] = [
  {
    key: "cha-khong-con:product_inspections(v2.0)->measurement_results",
    kind: "cha-khong-con",
    childTable: "product_inspections", childColumn: "id",
    parentTable: "measurement_results", parentColumn: "inspectionId",
    // Không có ràng buộc DB nào cho chiều này (xem docblock trên) — field này chỉ để hiển
    // thị UI/docs, theo đúng quy ước "gán giá trị gần nghĩa nhất" mà SOFT_INTEGRITY_CHECKS
    // đã dùng cho trường hợp tương tự (soft:product_inspections.productModel...).
    constraintName: "(none — luật GIÁM SÁT, không phải ràng buộc DB; xem spec §13 Đ-19)",
    enforcement: "RESTRICT", repair: "manual",
    countSql:
      'SELECT count(*)::bigint AS n FROM product_inspections c ' +
      'LEFT JOIN measurement_results m ON m."inspectionId" = c.id ' +
      'WHERE c."summaryCounts" IS NOT NULL AND m.id IS NULL',
    sampleSql:
      'SELECT c.id, c."machineId", c."serialNumber", c."inspectionTime" FROM product_inspections c ' +
      'LEFT JOIN measurement_results m ON m."inspectionId" = c.id ' +
      'WHERE c."summaryCounts" IS NOT NULL AND m.id IS NULL ' +
      'ORDER BY c.id DESC LIMIT 20',
  },
];

/**
 * BG-28 — số bo v2.0-không-có-dòng-đo TỐI THIỂU trước khi coi quan hệ là "dirty" đủ để
 * cảnh báo (console.warn). Mặc định 1: MỘT bo v2.0 thiếu đo cũng đáng biết ngay — trước
 * bản vá này số đó là 0 luật bắt được ca này ở BẤT KỲ ngưỡng nào. Cấu hình được để vận
 * hành có thể nới ngưỡng khi đã biết rõ nguyên nhân (Khối B chưa chạy, xem §13 Đ-19) mà
 * không cần sửa mã — CÙNG khuôn đọc-env-với-mặc-định của `enabled()`/INTEGRITY_SCAN_CRON/
 * INTEGRITY_SCAN_TZ ở trên, không phải một cơ chế cấu hình mới.
 * ⚠ Ngưỡng chỉ ảnh hưởng phân loại "dirty"/cảnh báo — `violationCount` LUÔN là số đếm
 * THẬT, không bị ngưỡng cắt bớt.
 */
function nguongChaKhongCon(): number {
  const raw = Number(process.env.INTEGRITY_SCAN_CHA_KHONG_CON_MIN ?? 1);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

// ─── Scan execution ───────────────────────────────────────────────────────────

export interface RelationshipScanResult {
  key: string;
  kind: IntegrityKind;
  childTable: string;
  violationCount: number;
  samples: unknown[];
  /** true when this relationship's scan failed (table missing, timeout, …). */
  degraded: boolean;
  error?: string;
}

export interface IntegrityScanRunResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  totalViolations: number;
  dirtyRelationships: number;
  results: RelationshipScanResult[];
  /**
   * doc 51 P2 (CASE #6) — soft-orphan checks (SOFT_INTEGRITY_CHECKS). Kept OUT of
   * `results` so the 0179/0180/repair-script key-contract test (which asserts
   * results.length === INTEGRITY_RELATIONSHIPS.length) is unaffected.
   */
  softResults: RelationshipScanResult[];
  /**
   * Pha 1C Task 5 (BG-28) — CHA_KHONG_CON_CHECKS (bo có header mà 0 dòng đo). Bucket
   * RIÊNG cùng lý do softResults tách khỏi `results`: đây không phải một vi phạm FK/unique
   * trong hợp đồng 0179/0180/repair-orphans.mjs, và test hợp đồng đó khẳng định
   * results.length === INTEGRITY_RELATIONSHIPS.length — trộn vào sẽ làm phép đếm đó sai.
   */
  chaKhongConResults: RelationshipScanResult[];
  durationMs: number;
  scannedAt: string;
}

let running = false;
let lastRunAt: Date | null = null;
let lastRunResult: IntegrityScanRunResult | null = null;

function enabled(): boolean {
  // Default ON: transitional safety net, read-only + bounded (see header).
  return String(process.env.INTEGRITY_SCAN_ENABLED ?? "true").toLowerCase() !== "false";
}

/**
 * Run every relationship scan once, persist to integrity_scan_results and
 * return the summary. Fail-safe: never throws; per-relationship degradation.
 */
export async function runIntegrityScanNow(scanSource: string = "service"): Promise<IntegrityScanRunResult> {
  const start = Date.now();
  const scannedAt = new Date().toISOString();
  if (running) {
    return { ok: true, skipped: true, reason: "already_running", totalViolations: 0, dirtyRelationships: 0, results: [], softResults: [], chaKhongConResults: [], durationMs: 0, scannedAt };
  }
  running = true;
  const results: RelationshipScanResult[] = [];
  const softResults: RelationshipScanResult[] = [];
  const chaKhongConResults: RelationshipScanResult[] = [];
  try {
    const db = await getDb();
    if (!db) {
      return { ok: false, skipped: true, reason: "db_unavailable", totalViolations: 0, dirtyRelationships: 0, results: [], softResults: [], chaKhongConResults: [], durationMs: Date.now() - start, scannedAt };
    }

    // Scan ONE relationship (count + sample + best-effort persist) into `bucket`.
    // Shared by the FK/unique scans and the doc 51 P2 soft-orphan checks.
    const scanInto = async (rel: IntegrityRelationship, bucket: RelationshipScanResult[]) => {
      try {
        const countRows = (await db.execute(sql.raw(rel.countSql))) as unknown as Array<{ n: string | number | bigint }>;
        const violationCount = Number(countRows?.[0]?.n ?? 0);
        let samples: unknown[] = [];
        if (violationCount > 0) {
          samples = (await db.execute(sql.raw(rel.sampleSql))) as unknown as unknown[];
        }
        bucket.push({ key: rel.key, kind: rel.kind, childTable: rel.childTable, violationCount, samples, degraded: false });

        // Persist (best-effort — report table comes from 0179).
        try {
          await db.execute(sql`
            INSERT INTO integrity_scan_results
              ("scanKey","kind","childTable","childColumn","parentTable","parentColumn","violationCount","sampleIds","scanSource")
            VALUES (${rel.key}, ${rel.kind}, ${rel.childTable}, ${rel.childColumn},
                    ${rel.parentTable ?? null}, ${rel.parentColumn ?? null},
                    ${violationCount}, ${JSON.stringify(samples)}::jsonb, ${scanSource})`);
        } catch (persistErr) {
          console.warn(`[integrityScan] could not persist result for ${rel.key} (run migration 0179?):`, (persistErr as Error)?.message);
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        console.error(`[integrityScan] scan failed for ${rel.key}:`, msg);
        bucket.push({ key: rel.key, kind: rel.kind, childTable: rel.childTable, violationCount: 0, samples: [], degraded: true, error: msg });
      }
    };

    for (const rel of INTEGRITY_RELATIONSHIPS) await scanInto(rel, results);
    // doc 51 P2 (CASE #6): soft-orphan checks — separate bucket (see interface).
    for (const rel of SOFT_INTEGRITY_CHECKS) await scanInto(rel, softResults);
    // Pha 1C Task 5 (BG-28, spec §13 Đ-19): "cha không có con" — separate bucket (see interface).
    for (const rel of CHA_KHONG_CON_CHECKS) await scanInto(rel, chaKhongConResults);
  } finally {
    running = false;
  }

  const dirty = results.filter((r) => r.violationCount > 0);
  const softDirty = softResults.filter((r) => r.violationCount > 0);
  const nguong = nguongChaKhongCon();
  const chaKhongConDirty = chaKhongConResults.filter((r) => r.violationCount >= nguong);
  const totalViolations = dirty.reduce((s, r) => s + r.violationCount, 0);
  const run: IntegrityScanRunResult = {
    ok: results.every((r) => !r.degraded) && softResults.every((r) => !r.degraded) && chaKhongConResults.every((r) => !r.degraded),
    totalViolations,
    dirtyRelationships: dirty.length,
    results,
    softResults,
    chaKhongConResults,
    durationMs: Date.now() - start,
    scannedAt,
  };
  lastRunAt = new Date();
  lastRunResult = run;

  if (dirty.length > 0) {
    console.warn(
      `[integrityScan] ${dirty.length} relationship(s) dirty (${totalViolations} total violation(s)) — ` +
      dirty.map((r) => `${r.key}=${r.violationCount}`).join(", ") +
      ` — repair: node scripts/repair-orphans.mjs, then re-apply migration 0180 to validate.`,
    );
  } else {
    console.log(`[integrityScan] clean — ${results.length} relationships scanned in ${run.durationMs}ms`);
  }
  if (softDirty.length > 0) {
    console.warn(
      `[integrityScan] soft-orphan(s) recoverable — ` +
      softDirty.map((r) => `${r.key}=${r.violationCount}`).join(", ") +
      ` — inspections predating their product model; repair: node scripts/repair-orphans.mjs --fix ` +
      `--rel "soft:product_inspections.productModel->product_models.code".`,
    );
  }
  // BG-28 (spec §13 Đ-19) — thông điệp PHẢI nêu SỐ ĐẾM + gợi ý nguyên nhân, để người trực
  // đêm không phải tự suy tại sao một trạm/dashboard chỉ có bo v2.0 lại "toàn xanh"/im lặng.
  if (chaKhongConDirty.length > 0) {
    console.warn(
      `[integrityScan] BG-28 — ` +
      chaKhongConDirty.map((r) => `${r.violationCount} bo v2.0 có header mà 0 dòng measurement_results (${r.key})`).join(", ") +
      ` — NGUYÊN NHÂN: đường ghi v2.0 chưa ghi được cấp component (measurement_results.pointDefId ` +
      `NOT NULL, định nghĩa điểm đo từ Khối B chưa chạy) — xem spec §13 Đ-19 ` +
      `(docs/superpowers/specs/2026-08-24-aoi-5-cap-xuong-song-design.md). KHÔNG phải lỗi ingest mới; ` +
      `theo dõi tới khi Khối B đóng, repair: chạy lại sau khi measurement_point_defs được nạp.`,
    );
  }
  return run;
}

// ─── Live constraint state (is the DB actually enforcing?) ───────────────────

export interface ConstraintState {
  key: string;
  constraintName: string;
  enforcement: string;
  /** FK exists / unique index exists. */
  exists: boolean;
  /** For FKs: convalidated (NOT VALID ⇒ false). Unique indexes: same as exists. */
  validated: boolean;
}

/** Read pg_constraint / pg_indexes to report the REAL enforcement state. */
export async function getConstraintStates(): Promise<ConstraintState[]> {
  const db = await getDb();
  if (!db) return [];
  const out: ConstraintState[] = [];
  let fkRows: Array<{ conname: string; convalidated: boolean }> = [];
  let idxRows: Array<{ indexname: string }> = [];
  try {
    fkRows = (await db.execute(sql`
      SELECT conname, convalidated FROM pg_constraint WHERE contype = 'f'`)) as unknown as typeof fkRows;
    idxRows = (await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)) as unknown as typeof idxRows;
  } catch (err) {
    console.error("[integrityScan] constraint-state query failed:", (err as Error)?.message);
    return [];
  }
  const fkMap = new Map(fkRows.map((r) => [r.conname, r.convalidated]));
  const idxSet = new Set(idxRows.map((r) => r.indexname));
  for (const rel of INTEGRITY_RELATIONSHIPS) {
    if (rel.kind === "fk-orphan") {
      const validated = fkMap.get(rel.constraintName);
      out.push({ key: rel.key, constraintName: rel.constraintName, enforcement: rel.enforcement, exists: validated !== undefined, validated: validated === true });
    } else {
      const exists = idxSet.has(rel.constraintName);
      out.push({ key: rel.key, constraintName: rel.constraintName, enforcement: rel.enforcement, exists, validated: exists });
    }
  }
  return out;
}

// ─── Scheduler lifecycle (mirror the other schedulers) ────────────────────────

let job: cron.ScheduledTask | null = null;

/** Register the weekly cron job. No-op when INTEGRITY_SCAN_ENABLED="false". */
export function startIntegrityScanScheduler(): void {
  if (!enabled()) {
    console.log("[integrityScan] disabled (INTEGRITY_SCAN_ENABLED=false)");
    return;
  }
  if (job) return; // already started
  const CRON = process.env.INTEGRITY_SCAN_CRON || "30 3 * * 0";
  const TZ = process.env.INTEGRITY_SCAN_TZ || "Asia/Ho_Chi_Minh";
  job = cron.schedule(
    CRON,
    () => {
      runIntegrityScanNow("service").catch((e) => console.error("[integrityScan] cron error:", e));
    },
    { timezone: TZ },
  );
  console.log(`[integrityScan] scheduled '${CRON}' (${TZ}) — ${INTEGRITY_RELATIONSHIPS.length} relationships`);
}

/** Stop the cron job (shutdown). Safe to call when not started. */
export function stopIntegrityScanScheduler(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[integrityScan] stopped");
  }
}

/** Status for dashboards / the integrity tRPC router. */
export function getIntegrityScanSchedulerStatus() {
  return {
    enabled: enabled(),
    cron: process.env.INTEGRITY_SCAN_CRON || "30 3 * * 0",
    timezone: process.env.INTEGRITY_SCAN_TZ || "Asia/Ho_Chi_Minh",
    relationshipCount: INTEGRITY_RELATIONSHIPS.length,
    softCheckCount: SOFT_INTEGRITY_CHECKS.length,
    chaKhongConCheckCount: CHA_KHONG_CON_CHECKS.length, // BG-28
    running: !!job,
    scanInFlight: running,
    lastRunAt,
    lastRunResult,
  };
}
