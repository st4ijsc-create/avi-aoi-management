/**
 * W5-D (doc 27 §6 gap A10) — BI DATASET FEED for Power BI / Tableau web
 * connectors.
 * ════════════════════════════════════════════════════════════════════════════
 *   GET /api/bi/datasets                    — dataset catalog (name/params)
 *   GET /api/bi/datasets/:name              — paged JSON rows + nextToken
 *
 * Datasets (all AGGREGATE/rollup level — raw rows live on /api/export):
 *   • inspections_daily — canonical final-yield per machine per factory-TZ day.
 *     Served from the `hourly_yield_cache` MV when FRESH (same freshness rule
 *     as the dashboard read path, W4-B/A7), otherwise a live query using the
 *     0174 `to_factory_time()` bucketing (fallback: naive date_trunc when the
 *     helper functions are not installed).
 *   • defect_pareto     — NG measurement count per defect class
 *     (defect_catalog), window-scoped.
 *   • machine_oee       — per machine per day averages from `oee_metrics`.
 *
 * Contract (documented in docs/ECOSYSTEM/30_BI_EXPORT_API.md):
 *   • AUTH — API key with the `bi:read` scope (Bearer / X-API-Key).
 *   • PAGING — plain JSON `{ dataset, rows, nextToken }`; pass `nextToken`
 *     back verbatim to fetch the next page (@odata.nextLink-STYLE continuation
 *     — full OData $filter/$select/$orderby is deliberately NOT implemented
 *     and documented as unsupported).
 *   • WINDOW — optional from/to (ISO); default last 30 days; span capped at
 *     366 days.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { Router, type Request, type Response } from "express";
import type { SQL } from "drizzle-orm";
import { API_SCOPES } from "../v1/scopes";
import { requireScope } from "../v1/auth";
import {
  inspectionTenantFilter,
  requireDeclaredTenantScope,
  tenantCodeScopeOf,
  tenantScopeDescriptor,
  tenantScopeLabels,
  type ApiKeyTenantScope,
} from "../v1/apiKeyScope";
import type { TenantCodeScope } from "../../_core/tenantCodeScope";

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const DEFAULT_PAGE_SIZE = intEnv("BI_DATASET_PAGE_SIZE", 1000);
const MAX_PAGE_SIZE = intEnv("BI_DATASET_MAX_PAGE_SIZE", 5000);
export const BI_MAX_WINDOW_DAYS = intEnv("BI_MAX_WINDOW_DAYS", 366);

// ── Continuation token (offset-based; datasets are bounded rollups) ──────────

export function encodeNextToken(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

export function decodeNextToken(token: unknown): number {
  if (typeof token !== "string" || !token) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const o = Number(parsed?.o);
    return Number.isInteger(o) && o >= 0 ? o : 0;
  } catch {
    return 0;
  }
}

// ── Window (optional, defaulted) ──────────────────────────────────────────────

function parseBiWindow(req: Request): { from: Date; to: Date; error?: string } {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 86_400_000);
  let from = defaultFrom;
  let to = now;
  if (typeof req.query.from === "string" && req.query.from) {
    const d = new Date(req.query.from);
    if (Number.isNaN(d.getTime())) return { from, to, error: "Invalid `from` (ISO-8601 expected)." };
    from = d;
  }
  if (typeof req.query.to === "string" && req.query.to) {
    const d = new Date(req.query.to);
    if (Number.isNaN(d.getTime())) return { from, to, error: "Invalid `to` (ISO-8601 expected)." };
    to = d;
  }
  if (from.getTime() >= to.getTime()) return { from, to, error: "`from` must be before `to`." };
  const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (spanDays > BI_MAX_WINDOW_DAYS) {
    return { from, to, error: `Window too large: max ${BI_MAX_WINDOW_DAYS} days.` };
  }
  return { from, to };
}

function pageParams(req: Request): { offset: number; pageSize: number } {
  const offset = decodeNextToken(req.query.nextToken);
  const rawSize = Number(req.query.pageSize);
  const pageSize =
    Number.isInteger(rawSize) && rawSize > 0 ? Math.min(rawSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { offset, pageSize };
}

// ── Dataset catalog ───────────────────────────────────────────────────────────

export const BI_DATASETS = [
  {
    name: "inspections_daily",
    description:
      "Canonical final-yield rollup per machine per factory-timezone day: total/ok/ng/ntf/yield_rate (NTF counts as pass).",
    params: { from: "ISO date (default now-30d)", to: "ISO date (default now)", machineId: "optional int", nextToken: "continuation", pageSize: `≤${MAX_PAGE_SIZE}` },
    columns: ["day", "machine_id", "total", "ok", "ng", "ntf", "yield_rate"],
  },
  {
    name: "defect_pareto",
    description:
      "NG measurement count per defect class (defect_catalog) in the window, with share-of-total (pct). Unclassified NG rows appear as defect_code=UNCLASSIFIED.",
    params: { from: "ISO date (default now-30d)", to: "ISO date (default now)", machineId: "optional int", nextToken: "continuation", pageSize: `≤${MAX_PAGE_SIZE}` },
    columns: ["defect_code", "defect_name", "defect_name_vi", "count", "pct"],
  },
  {
    name: "machine_oee",
    description:
      "Per machine per day averages from oee_metrics: availability/performance/quality/oee (%), plus summed counts.",
    params: { from: "ISO date (default now-30d)", to: "ISO date (default now)", machineId: "optional int", nextToken: "continuation", pageSize: `≤${MAX_PAGE_SIZE}` },
    columns: ["day", "machine_id", "machine_code", "availability", "performance", "quality", "oee", "total_count", "good_count", "reject_count"],
  },
  {
    name: "defect_category",
    description:
      "Defect Pareto rolled up by a defect_catalog DIMENSION (category | severity | ipcSection) over the window, with share-of-total + cumulative %. NG rows with no defectCatalogId land in an honest UNCLASSIFIED bucket (never hidden). Complements defect_pareto (per exact defect code).",
    params: { from: "ISO date (default now-30d)", to: "ISO date (default now)", machineId: "optional int", dimension: "category|severity|ipcSection (default category)", nextToken: "continuation", pageSize: `≤${MAX_PAGE_SIZE}` },
    columns: ["key", "count", "percentage", "cumulative_percentage", "bucket"],
  },
  {
    name: "yield_by_product",
    description:
      "Per product-model output + canonical FINAL yield ((OK+NTF)/total) over the window, ordered by output. Inspections with no product model roll up into one honest null-product row.",
    params: { from: "ISO date (default now-30d)", to: "ISO date (default now)", machineId: "optional int", nextToken: "continuation", pageSize: `≤${MAX_PAGE_SIZE}` },
    columns: ["product_model_id", "product_code", "product_name", "total", "ok", "ng", "ntf", "yield_rate"],
  },
  {
    name: "shift",
    description:
      "Per configured shift rollup (real shift_configs windows, factory-local, cross-midnight aware) over the window: output, final yield %, FPY %, machines active, distinct defect types.",
    params: { from: "ISO date (default now-30d)", to: "ISO date (default now)", factoryId: "optional int", lineId: "optional int", nextToken: "continuation", pageSize: `≤${MAX_PAGE_SIZE}` },
    columns: ["shift", "shift_name", "shift_window", "total", "ok", "ng", "ntf", "yield_pct", "fpy", "machines_active", "defect_type_count", "source"],
  },
] as const;

export type BiDatasetName = (typeof BI_DATASETS)[number]["name"];

/**
 * ★★★ 2026-08-18 — **CẢ SÁU dataset nay THU HẸP ĐƯỢC** về nhà máy của khoá.
 *
 * (Bản trước của khối chú thích này liệt kê BỐN dataset "không thu hẹp được" kèm lý do. Bốn lý
 * do ấy nay đều SAI — chúng mô tả trạng thái của mã nguồn ngày 2026-08-17, không phải hôm nay.
 * Để nguyên chữ cũ là nói dối người đọc sau, nên chúng bị XOÁ chứ không bị bình luận lại.)
 *
 * Ba đường thu hẹp, theo hình dạng của nguồn dữ liệu — KHÔNG phải ba bản sao của cùng một luật:
 *
 *   ① Truy vấn chạy thẳng trên `product_inspections` ⇒ nhúng `inspectionTenantFilter`.
 *     `inspections_daily` · `defect_pareto`.
 *
 *   ② Đi qua `db/reportAggregators` ⇒ truyền **trục phạm vi ②** (`tenantScope: {corporateCode,
 *     factoryCode}`). Cả họ hàm ấy đi qua `scopedConditions`, nên một chỗ sửa là đủ cho cả bộ.
 *     `defect_category` · `yield_by_product`.
 *
 *   ③ Nguồn KHÔNG có cột tenant ⇒ chiếu mã sang tập `factories.id` rồi dùng cổng liên kết.
 *     `machine_oee` — `oee_metrics` thật sự không có cột tenant nào (18 cột, chỉ `machineId`;
 *     `machines` cũng KHÔNG mang mã nhà máy — đường ra nhà máy là
 *     `machines → stations → production_lines → workshops → factories`). Vì thế nó dùng
 *     `machineIdFactoryGate` — CÙNG cổng mà `commandCenterService` đã dùng cho tầng dự phòng
 *     `oee_metrics` của ô OEE, chứ không phải một chuỗi JOIN chép tay lần thứ hai.
 *     `shift` — `getShiftReport` nay nhận thẳng `tenantScope` (mệnh đề AND-hai-mã, giống hệt
 *     `inspectionTenantFilter`), còn phép chiếu mã→`factoryId` chỉ dùng để chọn ĐÚNG bộ
 *     `shift_configs`. Phép chiếu ấy **fail-closed**: xem `SHIFT_SCOPE_*` bên dưới.
 *
 * ⚠ Đây KHÔNG phải danh sách trang trí: hằng số này là thứ cưỡng chế ở tuyến `/datasets/:name`.
 * Thêm một dataset mới mà quên nối trục phạm vi thì đừng thêm tên nó vào đây — 403 là câu trung
 * thực, còn số chưa lọc thì rò dữ liệu nhà máy khác và 0 dòng im lặng thì nói dối.
 */
export const TENANT_SCOPABLE_DATASETS: ReadonlySet<string> = new Set<BiDatasetName>([
  "inspections_daily",
  "defect_pareto",
  "machine_oee",
  "defect_category",
  "yield_by_product",
  "shift",
]);

export const DATASET_NOT_SCOPABLE_CODE = "dataset_not_tenant_scopable";

export function datasetNotScopableMessage(name: string): string {
  return (
    `Dataset "${name}" chưa thu hẹp được về phạm vi nhà máy của khoá API này, nên nó bị từ chối ` +
    `thay vì trả về số liệu của toàn bộ nhà máy. Dùng khoá có phạm vi toàn cục tường minh, hoặc ` +
    `một trong các dataset đã hỗ trợ phạm vi: ${[...TENANT_SCOPABLE_DATASETS].join(", ")}.`
  );
}

// ── `shift` — phép chiếu mã→factoryId, và vì sao nó phải FAIL-CLOSED ──────────

/**
 * ★★★ `shift` là dataset DUY NHẤT cần biết nhà máy dưới dạng **một SỐ**, vì các cửa sổ ca
 * (`shift_configs`) là **của từng nhà máy**: "Ca A" của nhà máy này là 06:00-14:00, của nhà máy
 * kia có thể là 07:00-15:00.
 *
 * ⚠⚠ Vì thế "gộp nhiều nhà máy vào một dòng ca" KHÔNG phải một hạn chế kỹ thuật cần lách — nó là
 * một con số VÔ NGHĨA: cùng nhãn "Ca A" mà mỗi phần của tổng được cắt theo một khung giờ khác
 * nhau. Một khoá cấp TẬP ĐOÀN (chỉ khai `corporateCode`, phủ N nhà máy) vì thế nhận **403 có
 * mã** chứ không nhận một con số đã trộn. Đó là đường duy nhất trung thực còn lại.
 *
 * ⚠ Và tuyệt đối KHÔNG được im lặng trả 0 dòng khi không tra được mã: 0 dòng đọc thành "ca này
 * không sản xuất gì", tức một lời khai SAI về xưởng.
 */
export const SHIFT_SCOPE_UNRESOLVED_CODE = "tenant_scope_factory_unresolved";
export const SHIFT_SCOPE_AMBIGUOUS_CODE = "tenant_scope_factory_ambiguous";

export function shiftScopeUnresolvedMessage(
  scope: { corporateCode: string | null; factoryCode: string | null },
  dataset = "shift",
): string {
  return (
    `Dataset "${dataset}" phải chiếu phạm vi của khoá sang một hàng trong bảng factories (nguồn ` +
    `dữ liệu của nó không mang cột tenant), nhưng phạm vi này (corporateCode=` +
    `${scope.corporateCode ?? "∅"}, factoryCode=${scope.factoryCode ?? "∅"}) KHÔNG khớp nhà máy ` +
    `nào. Đây là lỗi CẤU HÌNH KHOÁ, không phải kết luận rằng nhà máy không có sản lượng. Kiểm ` +
    `tra lại mã nhà máy của khoá.`
  );
}

export function shiftScopeAmbiguousMessage(count: number): string {
  return (
    `Dataset "shift" cần ĐÚNG MỘT nhà máy, nhưng phạm vi của khoá này phủ ${count} nhà máy. Cửa ` +
    `sổ ca (shift_configs) được cấu hình RIÊNG cho từng nhà máy, nên gộp chúng vào một dòng "Ca ` +
    `A" sẽ tạo ra một con số trộn từ nhiều khung giờ khác nhau. Dùng một khoá khai factoryCode ` +
    `cụ thể, hoặc gọi dataset này một lần cho mỗi nhà máy.`
  );
}

// ── Dataset queries (LIMIT pageSize+1 to detect more; offset continuation) ────

type Rows = Array<Record<string, unknown>>;

/**
 * ⚠⚠ BÍ DANH SQL ĐÃ BỊ GỠ Ở ĐÂY — ĐỪNG ĐƯA LẠI.
 *
 * `tenantFilter` (từ `apiKeyScope.inspectionTenantFilter`) kết xuất cột theo **tên BẢNG**:
 * `"product_inspections"."factoryCode"`. Ba truy vấn dưới đây trước đây viết
 * `FROM product_inspections pi` — trong Postgres, một bí danh **THAY THẾ** tên bảng trong
 * phạm vi câu lệnh, nên tham chiếu `"product_inspections"."factoryCode"` sẽ vỡ
 * `42P01 missing FROM-clause entry for table "product_inspections"`. Vì thế bí danh `pi` bị
 * gỡ và mọi cột viết đủ tên bảng. Điều kiện được **nhúng nguyên đối tượng `SQL`** để tham số
 * đi qua đường RÀNG BUỘC của driver — không nối chuỗi (nối chuỗi ở đây là một lỗ tiêm).
 */
async function queryInspectionsDaily(
  window: { from: Date; to: Date },
  machineId: number | undefined,
  offset: number,
  pageSize: number,
  tenantFilter: SQL | undefined,
): Promise<Rows> {
  const { getDb } = await import("../../db/connection");
  const { sql } = await import("drizzle-orm");
  const { executeRows } = await import("../../utils/kpi");
  const db = await getDb();
  if (!db) return [];

  const machineFilterMv = machineId ? sql` AND machine_id = ${machineId}` : sql``;
  const machineFilterLive = machineId ? sql` AND product_inspections."machineId" = ${machineId}` : sql``;
  const tenantLive = tenantFilter ? sql` AND ${tenantFilter}` : sql``;

  // 1) MV-first (A7 read path) — only when the MV is FRESH (same rule as the
  //    dashboard: stale/absent → live query, never silently stale).
  //
  //    ⚠ CHỈ cho khoá TOÀN CỤC. `hourly_yield_cache` gộp sẵn theo (bucket_hour, machine_id)
  //    và KHÔNG mang cột tenant nào (đo 2026-08-17: bảng này thậm chí không tồn tại trên
  //    `aoi_management`), nên không có cách nào thu hẹp nó về một nhà máy. Đọc MV cho một
  //    khoá phạm vi-nhà-máy sẽ trả số của TẤT CẢ nhà máy dưới nhãn của một nhà máy — tức
  //    một con số SAI, tệ hơn cả 403. Khoá 'factory' vì thế đi thẳng xuống truy vấn sống.
  if (!tenantFilter) {
    try {
      const { getMvFreshness } = await import("../../functions/cachedStatistics");
      const freshness = await getMvFreshness();
      if (freshness) {
        const res = await db.execute(sql`
          SELECT
            TO_CHAR(bucket_hour, 'YYYY-MM-DD') AS day,
            machine_id,
            SUM(total)::int AS total,
            SUM(ok)::int    AS ok,
            SUM(ng)::int    AS ng,
            SUM(ntf)::int   AS ntf,
            ROUND(100.0 * SUM(ok + ntf) / NULLIF(SUM(total), 0), 2)::float AS yield_rate
          FROM hourly_yield_cache
          WHERE bucket_hour >= ${window.from.toISOString()} AND bucket_hour < ${window.to.toISOString()}${machineFilterMv}
          GROUP BY 1, 2
          ORDER BY 1, 2
          LIMIT ${pageSize + 1} OFFSET ${offset}
        `);
        return executeRows(res);
      }
    } catch (err) {
      console.warn("[BI] inspections_daily MV read failed — live fallback:", (err as Error)?.message ?? err);
    }
  }

  // 2) Live query with factory-TZ day bucketing (0174 helpers).
  try {
    const res = await db.execute(sql`
      SELECT
        TO_CHAR(date_trunc('day', public.to_factory_time(product_inspections."inspectionTime")), 'YYYY-MM-DD') AS day,
        product_inspections."machineId" AS machine_id,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE product_inspections."overallResult" = 'OK')::int  AS ok,
        COUNT(*) FILTER (WHERE product_inspections."overallResult" = 'NG')::int  AS ng,
        COUNT(*) FILTER (WHERE product_inspections."overallResult" = 'NTF')::int AS ntf,
        ROUND(100.0 * COUNT(*) FILTER (WHERE product_inspections."overallResult" IN ('OK','NTF'))
          / NULLIF(COUNT(*), 0), 2)::float AS yield_rate
      FROM product_inspections
      WHERE product_inspections."inspectionTime" >= ${window.from.toISOString()}
        AND product_inspections."inspectionTime" < ${window.to.toISOString()}${machineFilterLive}${tenantLive}
      GROUP BY 1, 2
      ORDER BY 1, 2
      LIMIT ${pageSize + 1} OFFSET ${offset}
    `);
    return executeRows(res);
  } catch (err) {
    console.warn("[BI] to_factory_time unavailable — naive day bucketing fallback:", (err as Error)?.message ?? err);
  }

  // 3) Last resort: naive date_trunc (pre-0174 DBs).
  const res = await db.execute(sql`
    SELECT
      TO_CHAR(date_trunc('day', product_inspections."inspectionTime"), 'YYYY-MM-DD') AS day,
      product_inspections."machineId" AS machine_id,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE product_inspections."overallResult" = 'OK')::int  AS ok,
      COUNT(*) FILTER (WHERE product_inspections."overallResult" = 'NG')::int  AS ng,
      COUNT(*) FILTER (WHERE product_inspections."overallResult" = 'NTF')::int AS ntf,
      ROUND(100.0 * COUNT(*) FILTER (WHERE product_inspections."overallResult" IN ('OK','NTF'))
        / NULLIF(COUNT(*), 0), 2)::float AS yield_rate
    FROM product_inspections
    WHERE product_inspections."inspectionTime" >= ${window.from.toISOString()}
      AND product_inspections."inspectionTime" < ${window.to.toISOString()}${machineFilterLive}${tenantLive}
    GROUP BY 1, 2
    ORDER BY 1, 2
    LIMIT ${pageSize + 1} OFFSET ${offset}
  `);
  const { executeRows: rows2 } = await import("../../utils/kpi");
  return rows2(res);
}

async function queryDefectPareto(
  window: { from: Date; to: Date },
  machineId: number | undefined,
  offset: number,
  pageSize: number,
  tenantFilter: SQL | undefined,
): Promise<Rows> {
  const { getDb } = await import("../../db/connection");
  const { sql } = await import("drizzle-orm");
  const { executeRows } = await import("../../utils/kpi");
  const db = await getDb();
  if (!db) return [];
  // Bí danh `pi` đã gỡ — xem docblock của `queryInspectionsDaily` (bẫy 42P01).
  const machineFilter = machineId ? sql` AND product_inspections."machineId" = ${machineId}` : sql``;
  const tenant = tenantFilter ? sql` AND ${tenantFilter}` : sql``;
  const res = await db.execute(sql`
    WITH ng AS (
      SELECT COALESCE(dc.code, 'UNCLASSIFIED')  AS defect_code,
             COALESCE(dc.name, 'Unclassified')  AS defect_name,
             dc."nameVi"                        AS defect_name_vi,
             COUNT(*)::int                      AS count
      FROM measurement_results mr
      JOIN product_inspections ON product_inspections.id = mr."inspectionId"
      LEFT JOIN defect_catalog dc ON dc.id = mr."defectCatalogId"
      WHERE mr.result = 'NG'
        AND product_inspections."inspectionTime" >= ${window.from.toISOString()}
        AND product_inspections."inspectionTime" < ${window.to.toISOString()}${machineFilter}${tenant}
      GROUP BY 1, 2, 3
    )
    SELECT defect_code, defect_name, defect_name_vi, count,
           ROUND(100.0 * count / NULLIF(SUM(count) OVER (), 0), 2)::float AS pct
    FROM ng
    ORDER BY count DESC, defect_code
    LIMIT ${pageSize + 1} OFFSET ${offset}
  `);
  return executeRows(res);
}

/**
 * ★★★ 2026-08-18 — `machine_oee` THU HẸP ĐƯỢC, và đây là chỗ khảo sát được ghi lại.
 *
 * **Tiền đề bị bác bỏ:** "nối sang bảng `machines` để lấy nhà máy". `machines` KHÔNG mang mã nhà
 * máy — nó chỉ có `stationId` (đo trên `drizzle/schema/hierarchy.ts`). Đường ra nhà máy dài bốn
 * chặng: `machines → stations → production_lines → workshops → factories`. `oee_metrics` cũng
 * đúng như đã khai: 18 cột, không cột tenant nào, chỉ `machineId`/`machineCode`.
 *
 * **Không cần cột mới, không cần migration.** Chuỗi bốn chặng ấy ĐÃ được viết đúng một lần ở
 * `services/ecosystem/commandCenterScope.machineIdFactoryGate`, và đang canh CHÍNH `oee_metrics`
 * (tầng dự phòng của ô OEE trong `buildKpiSummary`). Dùng lại nó là giữ một luật một chỗ; chép
 * chuỗi JOIN ấy vào đây là tạo nguồn thứ hai để lệch trong im lặng.
 *
 * ⚠ VÌ SAO KHÔNG DÙNG `reportAggregators.tenantMachineGate` (cổng qua `product_inspections`):
 * hàm ấy trả về "máy nào ĐÃ KIỂM trong cửa sổ này", không phải "máy nào THUỘC nhà máy này". Một
 * máy chạy nhưng không có bản ghi kiểm nào trong cửa sổ sẽ biến mất khỏi báo cáo OEE của chính
 * nó. Lý lẽ đầy đủ ở docblock `machineIdFactoryGate`.
 */
async function queryMachineOee(
  window: { from: Date; to: Date },
  machineId: number | undefined,
  offset: number,
  pageSize: number,
  factoryIds: number[] | null,
): Promise<Rows> {
  const { getDb } = await import("../../db/connection");
  const { sql } = await import("drizzle-orm");
  const { executeRows } = await import("../../utils/kpi");
  const db = await getDb();
  if (!db) return [];
  // ⚠ Cột viết ĐỦ TÊN BẢNG. Cổng bên dưới nhúng truy vấn phụ trên `machines`/`stations`/… nên
  //   một `"machineId"` trần sẽ mơ hồ; và bí danh bảng thì vỡ `42P01` (xem docblock đầu file).
  const machineFilter = machineId ? sql` AND oee_metrics."machineId" = ${machineId}` : sql``;
  let tenantGate = sql``;
  if (factoryIds) {
    const { machineIdFactoryGate } = await import("../../services/ecosystem/commandCenterScope");
    // `[]` ⇒ `factoryIdGate` sinh `1 = 0` TƯỜNG MINH, KHÔNG phải "bỏ qua bộ lọc".
    tenantGate = sql` AND ${machineIdFactoryGate(sql`oee_metrics."machineId"`, factoryIds)}`;
  }
  // oee_metrics stores percentages ×100 (8550 = 85.50%) → /100 on the way out.
  const res = await db.execute(sql`
    SELECT
      TO_CHAR(date_trunc('day', oee_metrics."timestamp"), 'YYYY-MM-DD') AS day,
      oee_metrics."machineId"   AS machine_id,
      oee_metrics."machineCode" AS machine_code,
      ROUND(AVG(oee_metrics.availability) / 100.0, 2)::float AS availability,
      ROUND(AVG(oee_metrics.performance)  / 100.0, 2)::float AS performance,
      ROUND(AVG(oee_metrics.quality)      / 100.0, 2)::float AS quality,
      ROUND(AVG(oee_metrics.oee)          / 100.0, 2)::float AS oee,
      SUM(oee_metrics."totalCount")::int  AS total_count,
      SUM(oee_metrics."goodCount")::int   AS good_count,
      SUM(oee_metrics."rejectCount")::int AS reject_count
    FROM oee_metrics
    WHERE oee_metrics."timestamp" >= ${window.from.toISOString()}
      AND oee_metrics."timestamp" < ${window.to.toISOString()}${machineFilter}${tenantGate}
    GROUP BY 1, 2, 3
    ORDER BY 1, 2
    LIMIT ${pageSize + 1} OFFSET ${offset}
  `);
  return executeRows(res);
}

// ── Aggregator-backed datasets (bounded rollups; in-memory offset slice) ──────
// These reuse the Wave R1 report aggregators (server/db/reportAggregators.ts) +
// getShiftReport (server/db/statistics.ts). The rollups are small (top-N pareto,
// per-product, per-shift) so paging by slicing the full result in memory is
// correct and cheap — no LIMIT/OFFSET push-down needed.

function sliceRows(rows: Rows, offset: number, pageSize: number): Rows {
  // Return up to pageSize+1 so the caller detects "more" exactly like the SQL path.
  return rows.slice(offset, offset + pageSize + 1);
}

async function queryDefectCategory(
  window: { from: Date; to: Date },
  machineId: number | undefined,
  dimension: "category" | "severity" | "ipcSection",
  offset: number,
  pageSize: number,
  tenantScope: TenantCodeScope | undefined,
): Promise<Rows> {
  const { getDefectParetoByCategory } = await import("../../db/reportAggregators");
  const res = await getDefectParetoByCategory({
    startDate: window.from,
    endDate: window.to,
    machineId,
    dimension,
    // ⚠ `...(x ? {tenantScope: x} : {})` chứ không phải `tenantScope: x`: kiểu của
    //   `ReportRollupFilters` là một UNION loại trừ, và một ô `tenantScope: undefined` viết
    //   tường minh sẽ khớp nhánh SAI. Bỏ hẳn ô = trục ① (không lọc) — đúng cho khoá toàn cục.
    ...(tenantScope ? { tenantScope } : {}),
  });
  const all: Rows = res.items.map((i) => ({
    key: i.key,
    count: i.count,
    percentage: i.percentage,
    cumulative_percentage: i.cumulativePercentage,
    bucket: i.bucket,
  }));
  return sliceRows(all, offset, pageSize);
}

async function queryYieldByProduct(
  window: { from: Date; to: Date },
  machineId: number | undefined,
  offset: number,
  pageSize: number,
  tenantScope: TenantCodeScope | undefined,
): Promise<Rows> {
  const { getYieldByProduct } = await import("../../db/reportAggregators");
  const res = await getYieldByProduct({
    startDate: window.from,
    endDate: window.to,
    machineId,
    ...(tenantScope ? { tenantScope } : {}), // xem ghi chú ở `queryDefectCategory`
  });
  const all: Rows = res.map((r) => ({
    product_model_id: r.productModelId,
    product_code: r.productCode,
    product_name: r.productName,
    total: r.total,
    ok: r.ok,
    ng: r.ng,
    ntf: r.ntf,
    yield_rate: r.yieldRate,
  }));
  return sliceRows(all, offset, pageSize);
}

async function queryShift(
  window: { from: Date; to: Date },
  factoryId: number | undefined,
  lineId: number | undefined,
  offset: number,
  pageSize: number,
  tenantScope: TenantCodeScope | undefined,
): Promise<Rows> {
  const { getShiftReport } = await import("../../db/statistics");
  const res = await getShiftReport({
    startDate: window.from,
    endDate: window.to,
    factoryId,
    lineId,
    ...(tenantScope ? { tenantScope } : {}), // xem ghi chú ở `queryDefectCategory`
  });
  const all: Rows = res.map((r) => ({
    shift: r.shift,
    shift_name: r.shiftName,
    shift_window: r.shiftWindow,
    total: r.total,
    ok: r.ok,
    ng: r.ng,
    ntf: r.ntf,
    yield_pct: r.yieldPct,
    fpy: r.fpy,
    machines_active: r.machinesActive,
    defect_type_count: r.defectTypeCount,
    source: r.source,
  }));
  return sliceRows(all, offset, pageSize);
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createBiRouter(): Router {
  const r = Router();

  // GET /datasets — catalog (requires bi:read like the data itself).
  //
  // ⚠ `requireDeclaredTenantScope()` chạy NGAY SAU `requireScope`: ngay cả CATALOG cũng đòi
  // phạm vi đã khai. Catalog không mang số liệu sản xuất, nhưng để nó lọt sẽ dạy người tích
  // hợp rằng khoá "đã dùng được", rồi mới vỡ ở lượt gọi dữ liệu — 403 phải đến ở lượt đầu tiên.
  r.get(
    "/datasets",
    requireScope(API_SCOPES.BI_READ),
    requireDeclaredTenantScope(),
    (req: Request, res: Response) => {
      const scope = req.apiPrincipal?.tenantScope;
      res.json({
        datasets: BI_DATASETS,
        paging: "Pass the returned nextToken back as ?nextToken= to fetch the next page. nextToken=null means done.",
        odata: "OData $filter/$select/$orderby are NOT supported — use from/to/machineId params.",
        docs: "docs/ECOSYSTEM/30_BI_EXPORT_API.md",
        // ⚠ CHỈ mô tả bằng chuỗi + ba ô nhãn. KHÔNG bao giờ spread `scope` hay đối tượng
        // `filter` (SQL drizzle có tham chiếu vòng ⇒ 500 cho mọi người gọi).
        tenantScope: tenantScopeDescriptor(scope),
        ...tenantScopeLabels(scope),
        tenantScopableDatasets: [...TENANT_SCOPABLE_DATASETS],
      });
    },
  );

  // GET /datasets/:name — one page of rows + continuation token.
  r.get("/datasets/:name", requireScope(API_SCOPES.BI_READ), requireDeclaredTenantScope(), async (req: Request, res: Response) => {
    const name = req.params.name as BiDatasetName;
    if (!BI_DATASETS.some((d) => d.name === name)) {
      return res.status(404).json({ error: `Unknown dataset "${name}".`, available: BI_DATASETS.map((d) => d.name) });
    }
    const window = parseBiWindow(req);
    if (window.error) return res.status(400).json({ error: window.error });
    const { offset, pageSize } = pageParams(req);
    const machineIdRaw = Number(req.query.machineId);
    const machineId = Number.isInteger(machineIdRaw) && machineIdRaw > 0 ? machineIdRaw : undefined;
    const factoryIdRaw = Number(req.query.factoryId);
    const factoryId = Number.isInteger(factoryIdRaw) && factoryIdRaw > 0 ? factoryIdRaw : undefined;
    const lineIdRaw = Number(req.query.lineId);
    const lineId = Number.isInteger(lineIdRaw) && lineIdRaw > 0 ? lineIdRaw : undefined;
    const dimension =
      req.query.dimension === "severity" || req.query.dimension === "ipcSection"
        ? (req.query.dimension as "severity" | "ipcSection")
        : "category";

    // ⚠ `scope`/`tenantFilter` sống ở HAI biến RIÊNG và `tenantFilter` KHÔNG BAO GIỜ ra tới
    //   `res.json`. Đó là đối tượng SQL của drizzle (tham chiếu vòng `PgTable → PgSerial →
    //   table`); một lượt `{...}` trên đường ra là `Converting circular structure to JSON`
    //   ⇒ 500 cho MỌI người gọi, và `tsc` không bắt được (xem `scopeLabelsOf`).
    const scope: ApiKeyTenantScope | undefined = req.apiPrincipal?.tenantScope;
    const tenantFilter = inspectionTenantFilter(scope);
    // ★ 2026-08-18 — CÙNG phạm vi ấy, diễn đạt bằng MÃ (hai ô CHUỖI) cho các bề mặt nhận trục
    //   phạm vi tường minh. `undefined` ⇔ `tenantFilter === undefined` ⇔ khoá TOÀN CỤC.
    const tenantCodes: TenantCodeScope | undefined = tenantCodeScopeOf(scope);

    // Khoá phạm vi-nhà-máy + dataset chưa thu hẹp được ⇒ TỪ CHỐI, không trả số toàn cục.
    if (tenantFilter !== undefined && !TENANT_SCOPABLE_DATASETS.has(name)) {
      return res.status(403).json({
        error: datasetNotScopableMessage(name),
        code: DATASET_NOT_SCOPABLE_CODE,
        dataset: name,
        tenantScope: tenantScopeDescriptor(scope),
        tenantScopableDatasets: [...TENANT_SCOPABLE_DATASETS],
      });
    }

    // ── Phép chiếu MÃ → `factories.id`, cần cho `machine_oee` (cổng liên kết) và `shift`
    //    (chọn bộ `shift_configs`). CHỈ chạy cho khoá phạm vi-nhà-máy; khoá toàn cục giữ
    //    `null` = KHÔNG áp cổng nào.
    let factoryIds: number[] | null = null;
    if (tenantCodes && (name === "machine_oee" || name === "shift")) {
      const { resolveTenantCodeFactoryIds } = await import("../../db/reportAggregators");
      const resolved = await resolveTenantCodeFactoryIds(tenantCodes);
      factoryIds = resolved.factoryIds;

      // ⚠ KHÔNG chiếu được sang nhà máy nào ⇒ 403 cho CẢ HAI dataset, không phải 200-rỗng.
      //   `oee_metrics` chỉ thu hẹp được qua chuỗi phân cấp của máy; nếu mã của khoá không ứng
      //   với hàng `factories` nào thì không có phạm vi để mà áp. Trả trang rỗng ở đây đọc thành
      //   "nhà máy của bạn không có số liệu OEE", trong khi sự thật là "mã nhà máy của khoá không
      //   tồn tại" — một lời khai SAI về xưởng, và người tích hợp sẽ đi tìm lỗi ở chỗ không có lỗi.
      if (factoryIds.length === 0) {
        return res.status(403).json({
          error: shiftScopeUnresolvedMessage(tenantScopeDescriptor(scope), name),
          code: SHIFT_SCOPE_UNRESOLVED_CODE,
          dataset: name,
          matchedFactories: 0,
          resolution: resolved.outcome,
          tenantScope: tenantScopeDescriptor(scope),
        });
      }

      // ⚠ `shift` đòi ĐÚNG MỘT nhà máy — cửa sổ ca là của TỪNG nhà máy. >1 ⇒ 403 có mã
      //   máy-đọc-được, KHÔNG BAO GIỜ 0 dòng im lặng (0 dòng đọc thành "ca không sản xuất gì").
      if (name === "shift" && factoryIds.length !== 1) {
        const ambiguous = factoryIds.length > 1;
        return res.status(403).json({
          error: ambiguous
            ? shiftScopeAmbiguousMessage(factoryIds.length)
            : shiftScopeUnresolvedMessage(tenantScopeDescriptor(scope)),
          code: ambiguous ? SHIFT_SCOPE_AMBIGUOUS_CODE : SHIFT_SCOPE_UNRESOLVED_CODE,
          dataset: name,
          matchedFactories: factoryIds.length,
          resolution: resolved.outcome,
          tenantScope: tenantScopeDescriptor(scope),
        });
      }
      // ⚠ Người gọi hỏi `?factoryId=` của một nhà máy KHÁC ⇒ 403 XUNG ĐỘT, không ghi đè im lặng.
      //   Ghi đè sẽ trả số của nhà máy A dưới một yêu cầu ghi rõ B — client dán nhãn sai; trả 0
      //   dòng thì thành "nhà máy B không có sản lượng". Cùng lý lẽ với `applyKeyScopeToFilters`
      //   ở `exportRouter.ts` (mã `tenant_scope_conflict`).
      if (name === "shift" && factoryId !== undefined && factoryId !== factoryIds[0]) {
        return res.status(403).json({
          error:
            `Khoá API này chỉ được phép nhà máy id=${factoryIds[0]} (factoryCode=` +
            `${scope?.factoryCode ?? "∅"}), nhưng yêu cầu hỏi factoryId=${factoryId}. Bỏ tham ` +
            `số đi, hoặc dùng khoá có phạm vi phù hợp.`,
          code: "tenant_scope_conflict",
          dataset: name,
          tenantScope: tenantScopeDescriptor(scope),
        });
      }
    }

    try {
      let rows: Rows;
      if (name === "inspections_daily") rows = await queryInspectionsDaily(window, machineId, offset, pageSize, tenantFilter);
      else if (name === "defect_pareto") rows = await queryDefectPareto(window, machineId, offset, pageSize, tenantFilter);
      else if (name === "machine_oee") rows = await queryMachineOee(window, machineId, offset, pageSize, factoryIds);
      else if (name === "defect_category") rows = await queryDefectCategory(window, machineId, dimension, offset, pageSize, tenantCodes);
      else if (name === "yield_by_product") rows = await queryYieldByProduct(window, machineId, offset, pageSize, tenantCodes);
      // ⚠ `shift`: khoá phạm vi-nhà-máy đã được ép về ĐÚNG MỘT `factoryId` ở trên; tham số
      //   `factoryId` do người gọi tự khai chỉ còn tác dụng với khoá TOÀN CỤC.
      else rows = await queryShift(window, factoryIds ? factoryIds[0] : factoryId, lineId, offset, pageSize, tenantCodes);

      const hasMore = rows.length > pageSize;
      const page = hasMore ? rows.slice(0, pageSize) : rows;
      res.setHeader("Cache-Control", "no-store");
      res.json({
        dataset: name,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        count: page.length,
        rows: page,
        nextToken: hasMore ? encodeNextToken(offset + pageSize) : null,
        tenantScope: tenantScopeDescriptor(scope),
        ...tenantScopeLabels(scope),
      });
    } catch (err) {
      // ⚠ Ghi CẢ `err.cause`. Driver postgres.js gói lỗi thật (mã SQLSTATE, tên bảng/cột) vào
      //   `cause`, còn `message` chỉ là "Failed query: <SQL>" — không có SQLSTATE thì một
      //   `42501 permission denied` và một `42P01 undefined table` trông y hệt nhau trong log.
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      console.error(
        `[BI] dataset ${name} failed:`,
        (err as Error)?.message ?? err,
        cause ? `| cause ${cause.code ?? ""}: ${cause.message ?? ""}` : "",
      );
      res.status(500).json({ error: "Dataset query failed." });
    }
  });

  // Unknown /api/bi path → structured 404.
  r.use((_req, res) =>
    res.status(404).json({ error: "Unknown /api/bi endpoint.", available: ["/api/bi/datasets", "/api/bi/datasets/:name"] }),
  );

  return r;
}
