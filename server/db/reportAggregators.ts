/**
 * server/db/reportAggregators.ts — Wave R1 report data aggregators (doc 32 §1.4,
 * §2 items 10/12/13, §4 Wave R1).
 * ============================================================================
 * The "missing" report data-layer helpers the audit (doc 32 §1.4) flagged as
 * gaps: defect Pareto by defect CATEGORY/severity/IPC-section, per-PRODUCT
 * yield, per-WEEK yield trend, and the workstation×NG heatmap that
 * reportGenerator's NG-Visual report mocked as empty.
 *
 * Design principles (mirrors server/services/aiInspectionAnalytics.getDefectClassPareto
 * and componentPackageAnalytics.getPackageDefectPareto — same filters, same
 * top-N + OTHERS folding, same honest never-hidden residual bucket):
 *
 *  - Canonical KPI math: FINAL yield = (OK + NTF)/total via utils/kpi.finalYield
 *    (decision #4 — NTF counts as PASS).
 *  - Factory-timezone bucketing: week buckets use factoryDateTruncSql('week', …)
 *    so ISO weeks split at the factory-local week boundary, not UTC.
 *  - Callers resolving date-ONLY UI strings ("YYYY-MM-DD") must first pass them
 *    through utils/kpi.resolveFactoryDateWindow so the window is factory-local;
 *    these functions take resolved Date instants.
 *  - HONESTY CONTRACT: NG rows that carry no defectCatalogId are NEVER hidden or
 *    redistributed — they land in one "UNCLASSIFIED" bucket that competes in the
 *    Pareto ranking like any category. (doc 31 note: historical feed carried no
 *    codes, so real data is ~0% classified today — the UNCLASSIFIED bucket makes
 *    that gap visible instead of faking a distribution.)
 *  - Fail-safe: DB offline → empty result (never throws to the report path).
 *
 * COMPLEMENTS, does not duplicate:
 *  - getDefectClassPareto (aiInspectionAnalytics) groups by individual
 *    defectCatalogId ("which exact defect class").
 *  - getPackageDefectPareto (componentPackageAnalytics) groups by component
 *    PACKAGE ("which part footprint").
 *  - THIS groups by defect_catalog.category / severity / ipcSection ("what KIND
 *    of defect, rolled up") — the dimension a management defect-analysis report
 *    wants.
 */
// T-3 (doc 38 R-2a): these are ALL heavy read-only analytics rollups (defect
// Pareto, per-product / per-week yield, workstation heatmap) — pure SELECT
// aggregations with no writes. They route through getReadDb() so they run on
// the read replica (env DATABASE_READ_URL) when one exists, and honest-degrade
// to the primary pool when it does not. These reports TOLERATE replica lag
// (ms–seconds staleness on a rollup window is acceptable), so this is safe.
import { getReadDb } from "./connection";
import { sql, eq, and, or, inArray, gte, lte, desc, SQL, type AnyColumn } from "drizzle-orm";
import {
  productInspections,
  measurementResults,
  defectCatalog,
  productModels,
  machines,
  stations,
  productionLines,
  workshops,
  workstations,
  measurementPointDefs,
  factories,
} from "../../drizzle/schema";
import { finalYield, roundPct, factoryDateTruncSql } from "../utils/kpi";
// Nhãn phạm vi sống ở module KHÔNG phụ thuộc (`accessControlLabels`) nên `server/db/**` nhập
// TĨNH được mà không tạo vòng router → db → trpc. Bản thân `_core/accessControl` vẫn phải
// `import()` động — xem `tenantScopeFilter` / `resolveTenantFactoryScope`.
import { UNSCOPED_LABELS, scopeLabelsOf, type ScopeLabels } from "../_core/accessControlLabels";
// ★ 2026-08-18 — trục phạm vi THỨ HAI (mã tenant tường minh của khoá API). Module thuần, chỉ
// phụ thuộc drizzle ⇒ nhập TĨNH an toàn từ `server/db/**`. Xem docblock của nó.
import {
  isTenantCodeScopeEmpty,
  tenantCodeInspectionFilter,
  type TenantCodeScope,
} from "../_core/tenantCodeScope";

// ═══════════════════════════════════════════════════════════════════════════
// Shared filter shape + condition builder (mirrors getDefectClassPareto)
// ═══════════════════════════════════════════════════════════════════════════

/** Ô lọc THUẦN NGHIỆP VỤ (cửa sổ + phân cấp). Không ô nào ở đây là trục phạm vi. */
export interface ReportRollupSelectors {
  /** Resolved window start (factory-local via resolveFactoryDateWindow). */
  startDate: Date;
  /** Resolved window end. */
  endDate: Date;
  machineId?: number;
  lineId?: number;
  workshopId?: number;
  factoryId?: number;
  productModelId?: number;
}

/**
 * TRỤC ① — danh tính NGƯỜI XEM.
 *
 * ★★★ 2026-08-17 — Danh tính luôn đến từ `ctx.user` (máy chủ tự xác thực) hoặc không từ đâu cả.
 * **CẤM lấy từ `input`**: một `input.userId` là lời TỰ KHAI của người gọi, nó biến bộ lọc tenant
 * thành một ô chọn trên giao diện của kẻ tấn công.
 *
 * Bỏ trống = KHÔNG lọc — đúng hình dạng của lối đi không mang danh tính (tác vụ nền, khoá master
 * server-to-server). Đó cũng chính là hình dạng của LỖ đã đo: `externalReportService` gọi cả họ
 * hàm này mà không truyền gì, nên mọi tài khoản đã đăng nhập dựng được artefact số liệu TOÀN CỤC.
 * Nơi gọi có ngữ cảnh người dùng PHẢI truyền.
 */
export interface ReportUserScopeAxis {
  userId?: number;
  userRole?: string;
  /**
   * ⚠ `never` là CƯỠNG CHẾ KIỂU, không phải trang trí: nó làm cho
   * `{ userId: 7, tenantScope: {...} }` KHÔNG biên dịch được. Hai trục cùng có mặt là một câu
   * MƠ HỒ ("phạm vi của ai thắng?"), và một câu mơ hồ về phân quyền sẽ được giải quyết bằng thứ
   * tự các dòng `if` — tức bằng tai nạn.
   */
  tenantScope?: never;
}

/**
 * TRỤC ② — MÃ TENANT TƯỜNG MINH, cho principal **KHÔNG PHẢI NGƯỜI DÙNG** (khoá API, mig 0325).
 *
 * ★★★ 2026-08-18 — VÌ SAO PHẢI LÀ MỘT TRỤC RIÊNG chứ không mượn trục ①. `api_keys.createdBy` là
 * NULLable, người tạo có thể đã nghỉ việc hoặc là admin (⇒ khoá tự động thành TOÀN CỤC). Mượn
 * danh tính người tạo khoá vừa sai ngữ nghĩa vừa sai hướng an toàn.
 *
 * ⚠ Lời khai RỖNG (`{}` — không mã nào) KHÔNG có nghĩa "không lọc": `tenantCodeInspectionFilter`
 * đọc nó thành `1 = 0`. Khoá TOÀN CỤC diễn đạt bằng cách **không truyền `tenantScope`**, không
 * phải bằng cách truyền một `tenantScope` rỗng.
 */
export interface ReportTenantScopeAxis {
  tenantScope: TenantCodeScope;
  /** ⚠ Xem `ReportUserScopeAxis.tenantScope` — hai trục LOẠI TRỪ NHAU ở mức KIỂU. */
  userId?: never;
  userRole?: never;
}

/**
 * Bộ lọc của một bộ tổng hợp = ô nghiệp vụ + **ĐÚNG MỘT** trục phạm vi.
 *
 * ⚠ Đây là một UNION có chủ đích. Nơi gọi cũ (`{ startDate, endDate, machineId }`) khớp nhánh ①
 * vì mọi ô của nó đều tuỳ chọn ⇒ không có nơi gọi nào phải sửa.
 */
export type ReportRollupFilters = ReportRollupSelectors & (ReportUserScopeAxis | ReportTenantScopeAxis);

/**
 * Điều kiện SQL thu hẹp về tenant của người gọi — **CHỈ `filter`**, để trong một biến RIÊNG.
 *
 * ⚠⚠ KHÔNG BAO GIỜ trả/spread nguyên `ResolvedDataScope`: nó mang `filter` là đối tượng SQL
 * drizzle có THAM CHIẾU VÒNG (`PgTable → PgSerial → table`), và một lượt `{...scope}` trên đường
 * ra tRPC giết superjson bằng `Converting circular structure to JSON` (đã xảy ra thật hôm nay:
 * `dashboard.getStats` trả 500 cho MỌI người dùng sau một bản vá `tsc` sạch + 220 ca xanh).
 * Ba ô CHỮ đi ra ngoài phải qua `scopeLabelsOf()`.
 *
 * ⚠ `import()` ĐỘNG là bắt buộc cho trục ①: `_core/accessControl` kéo theo `_core/trpc`, nhập
 * tĩnh từ `server/db/**` tạo vòng router → db → trpc (cùng lý do đã ghi ở `db/statistics.ts`).
 * Trục ② KHÔNG cần: `_core/tenantCodeScope` là module thuần, không kéo theo tRPC.
 *
 * ★ THỨ TỰ: trục ② được hỏi TRƯỚC. Kiểu đã cấm hai trục cùng có mặt, nên thứ tự này không thể
 * quan sát được từ mã hợp lệ — nó tồn tại để một lời gọi ép kiểu (`as any`, JS thuần, dữ liệu
 * dựng từ JSON) cũng rơi về phía THU HẸP chứ không rơi về phía mở.
 */
async function tenantScopeFilter(f: ReportRollupFilters): Promise<SQL | undefined> {
  if (f.tenantScope) return tenantCodeInspectionFilter(f.tenantScope);
  if (!f.userId) return undefined;
  const { resolveDataScope } = await import("../_core/accessControl");
  const resolved = await resolveDataScope(f.userId, f.userRole ?? "user");
  return resolved.filter;
}

/**
 * `baseConditions` + mệnh đề tenant. MỌI bộ tổng hợp trong file này đi qua đây — thêm một bộ
 * mới mà quên gọi hàm này là mở lại đúng cái lỗ vừa vá, nên đừng gọi `baseConditions` trực tiếp.
 */
async function scopedConditions(
  f: ReportRollupFilters,
  opts: { includeProduct?: boolean } = {},
): Promise<SQL[]> {
  const conditions = baseConditions(f, opts);
  const scope = await tenantScopeFilter(f);
  if (scope) conditions.push(scope);
  return conditions;
}

/** True when a filter needs the machines→stations→lines→workshops join chain. */
function needsHierarchy(f: ReportRollupFilters): boolean {
  return !!(f.lineId || f.workshopId || f.factoryId);
}

// ═══════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-17 — PHẠM VI CHO BẢNG **KHÔNG CÓ CỘT TENANT**
// ═══════════════════════════════════════════════════════════════════════════
//
// `oee_metrics` và `downtime_events` (drizzle/schema/oee.ts) chỉ có `machineId`/`machineCode`
// — **không có** `factoryCode`/`corporateCode`. Mệnh đề của `getAccessFilterConditions` nói về
// `"product_inspections"."factoryCode"` nên không gắn thẳng vào được.
//
// **Cách bị loại.** Dựng lại luật theo đường `machines → stations → production_lines →
// workshops → factories.code` là tạo NGUỒN THỨ HAI của cùng một luật phân quyền: lần sau ai đó
// sửa `getAccessFilterConditions` (ví dụ thêm gán theo CÔNG TY, hay đổi cách xử lý hàng không
// mang mã tenant) thì bản sao ở đây lệch trong im lặng — không lưới nào đỏ, vì hai bên vẫn tự
// nhất quán với chính mình.
//
// **Cách được chọn.** Dùng LẠI NGUYÊN VĂN mệnh đề ấy bên trong một truy vấn phụ trên
// `product_inspections`: *máy nào có bản ghi kiểm NẰM TRONG phạm vi người xem, TRONG CÙNG cửa
// sổ thời gian*. Một luật, một chỗ sửa. Khuôn theo `externalReportService.fetchOeeReportRows`
// (đường XUẤT ARTEFACT) — đây là bản dùng chung để đường HẸN GIỜ không phải chép tay lần thứ ba.
//
// ⚠ Đánh đổi đã biết, nói ra thay vì giấu: một máy có hàng OEE/downtime nhưng KHÔNG có bản ghi
// kiểm nào trong cửa sổ sẽ rơi khỏi báo cáo của người bị thu hẹp. Sai lệch nghiêng về phía ĐÓNG
// (thiếu một dòng), không về phía RÒ (lộ máy của nhà máy khác). Admin không bị ảnh hưởng — họ
// không có mệnh đề nào nên không đi qua cổng này.
//
// ⚠⚠ Mốc thời gian đi vào truy vấn dưới dạng **chuỗi ISO**, không phải đối tượng `Date`.
// postgres.js từ chối `Date` làm tham số của một truy vấn thô (`ERR_INVALID_ARG_TYPE: The
// "string" argument must be of type string … Received an instance of Date`) — đúng lỗi đã khiến
// báo cáo OEE của đường xuất **chưa bao giờ chạy được trên CSDL thật** trong khi lưới cũ vẫn
// xanh vì giả lập `getDb`. Vì thế mỗi bề mặt dùng cổng này BẮT BUỘC có ≥1 ca chạm CSDL thật.

/** Cửa sổ thời gian của một lượt tổng hợp. */
export interface TenantScopeWindow {
  start: Date;
  end: Date;
}

/**
 * Truy vấn phụ trả về tập `machineId` có bản ghi kiểm nằm trong phạm vi người xem.
 * `scopeFilter` là mệnh đề NGUYÊN VĂN của `getAccessFilterConditions` (bảng `product_inspections`,
 * KHÔNG đặt bí danh — bí danh sẽ làm vỡ `42P01`, xem `db/statistics.scopeGateOnAlias`).
 */
export function tenantMachineIdsSubquery(scopeFilter: SQL, window: TenantScopeWindow): SQL {
  return sql`SELECT DISTINCT ${productInspections.machineId}
             FROM ${productInspections}
             WHERE ${productInspections.inspectionTime} >= ${window.start.toISOString()}
               AND ${productInspections.inspectionTime} <= ${window.end.toISOString()}
               AND ${scopeFilter}`;
}

/**
 * Cổng phạm vi gắn vào một cột `machineId` của bảng KHÔNG có cột tenant.
 * @param machineIdCol cột máy của bảng đích, ví dụ `oeeMetrics.machineId`
 */
export function tenantMachineGate(
  machineIdCol: SQL | AnyColumn,
  scopeFilter: SQL,
  window: TenantScopeWindow,
): SQL {
  return sql`${machineIdCol} IN (${tenantMachineIdsSubquery(scopeFilter, window)})`;
}

/**
 * Bản JS của cùng cổng ấy — dành cho bề mặt tổng hợp TRONG BỘ NHỚ (`getAllMachinesOEELive` trả
 * một mảng máy đã dựng sẵn, không có chỗ nào để nhét mệnh đề WHERE vào).
 *
 * ⚠ Trả `[]` khi CSDL không sẵn sàng — fail-CLOSED. Một danh sách máy rỗng làm báo cáo trống,
 * còn "bỏ qua bộ lọc vì không đọc được CSDL" thì gửi số liệu toàn nhà máy đi. Rỗng thì sửa được;
 * rò thì không thu lại được.
 */
export async function getTenantScopedMachineIds(
  scopeFilter: SQL,
  window: TenantScopeWindow,
): Promise<number[]> {
  const db = await getReadDb();
  if (!db) {
    console.error("[getTenantScopedMachineIds] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }
  const rows = await db
    .select({ machineId: productInspections.machineId })
    .from(productInspections)
    .where(
      and(
        gte(productInspections.inspectionTime, window.start),
        lte(productInspections.inspectionTime, window.end),
        scopeFilter,
      ),
    )
    .groupBy(productInspections.machineId);
  return (rows as any[])
    .map((r) => Number(r.machineId))
    .filter((id) => Number.isFinite(id));
}

// ═══════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-18 — PHẠM VI CHO BẢNG **CÓ SẴN CỘT `factoryId`**
// ═══════════════════════════════════════════════════════════════════════════
//
// `daily_statistics` (drizzle/schema/production.ts) mang `factoryId` NOT NULL + chỉ mục
// `idx_stats_factory_date`. `production_orders` và `fact_inspection_hourly` cũng có `factoryId`.
// Với những bảng NÀY, cổng bán-nối qua `product_inspections` ở trên là **đắt và sai lệch về phía
// đóng**: một máy có sản lượng nhưng không có bản ghi kiểm nào trong cửa sổ sẽ biến mất. Ở đây
// không cần cái đánh đổi ấy — hỏi thẳng cột `factoryId` là đúng và rẻ.
//
// **Một quy tắc, một chỗ sửa.** Tập mã gán vẫn lấy từ ĐÚNG MỘT nguồn (`getUserAssignmentCodes`
// — cùng nguồn mà `getAccessFilterConditions` dùng). Bước thêm duy nhất là CHIẾU tập mã ấy lên
// bảng `factories` (`code` ∈ factoryCodes **HOẶC** `corporateCode` ∈ corporateCodes) — đúng cùng
// phép HOẶC-hai-danh-sách mà `getAccessFilterConditions` viết trên `product_inspections`. Không
// có chỗ nào ở đây dựng lại luật gán nhà máy, và KHÔNG đi qua chuỗi
// `machines → stations → production_lines → workshops` để suy quyền (đó mới là nguồn thứ hai).
//
// ⚠ **Fail-CLOSED ba lần**: CSDL vắng ⇒ `[]`; 0 gán ⇒ `[]`; `[]` ⇒ vị từ `1 = 0` TƯỜNG MINH.
// Tuyệt đối KHÔNG để tập rỗng biến thành `undefined` = "không lọc" — đó chính xác là lớp lỗi
// `or()!` đã cho 4 tài khoản 0-gán đọc trọn 22.996 bản ghi kiểm (xem `DENY_ALL_ROWS`).

/**
 * Phạm vi tenant biểu diễn bằng TẬP `factories.id`.
 *
 * ⚠⚠ `factoryIds` và `labels` TÁCH RỜI NGAY TỪ KIỂU, và ở đây **không hề có ô `filter`** — nên
 * `{ ...scope }` trên đường ra tRPC không thể lôi được đối tượng SQL drizzle (tham chiếu vòng
 * `PgTable → PgSerial → table`) vào đáp ứng. Đó là lỗi đã giết `dashboard.getStats` bằng
 * `Converting circular structure to JSON` ngày 2026-08-17, sống sót qua `tsc` sạch cả hai config
 * và 220 ca test. Xem docblock `scopeLabelsOf` ở `_core/accessControlLabels.ts`.
 */
export interface TenantFactoryScope {
  /** `null` = vai toàn quyền / lối đi KHÔNG mang danh tính ⇒ KHÔNG áp cổng nào. */
  factoryIds: number[] | null;
  labels: ScopeLabels;
}

/**
 * ★★★ BỘ PHÂN GIẢI DUY NHẤT của trục `factoryId`. Mọi bề mặt đọc `daily_statistics` /
 * `production_orders` / `fact_inspection_hourly` theo danh tính người xem gọi hàm NÀY.
 *
 * Lối đi không mang danh tính (`userId` rỗng — tác vụ nền, UNS publisher, REST máy-với-máy) và
 * vai `admin` nhận `factoryIds: null` + `UNSCOPED_LABELS`: GIỮ NGUYÊN hành vi cũ. Đây là chiều
 * DƯƠNG chống "vá quá tay thành chặn tất cả".
 */
export type TenantFactoryScopeArgs =
  | { userId?: number; userRole?: string; tenantScope?: never }
  /**
   * ★★★ 2026-08-18 — TRỤC ②: mã tenant TƯỜNG MINH (khoá API). Loại trừ trục ① ở mức KIỂU.
   * Lời khai RỖNG ⇒ `factoryIds: []` ⇒ `factoryIdGate` sinh `1 = 0`, KHÔNG phải "không lọc".
   */
  | { tenantScope: TenantCodeScope; userId?: never; userRole?: never };

export async function resolveTenantFactoryScope(
  args?: TenantFactoryScopeArgs,
): Promise<TenantFactoryScope> {
  // ★ Trục ② hỏi TRƯỚC — cùng lý do đã ghi ở `tenantScopeFilter`: một lời gọi đã ép kiểu phải
  //   rơi về phía THU HẸP. Nhãn `scopeApplied: true` vì phạm vi ĐANG được áp; `scopeEmptyReason`
  //   để null vì lý do "chưa được gán nhà máy" nói về TÀI KHOẢN NGƯỜI DÙNG, không về một khoá API.
  if (args?.tenantScope) {
    const { factoryIds } = await resolveTenantCodeFactoryIds(args.tenantScope);
    return { factoryIds, labels: { scopeApplied: true, scopeEmptyReason: null, scopeMessage: null } };
  }
  if (!args?.userId || args.userRole === "admin") {
    return { factoryIds: null, labels: UNSCOPED_LABELS };
  }
  // ⚠ `import()` ĐỘNG bắt buộc: `_core/accessControl` kéo theo `_core/trpc`; nhập tĩnh từ
  // `server/db/**` tạo vòng router → db → trpc (cùng lý do đã ghi ở `db/statistics.ts`).
  const { resolveDataScope, getUserAssignmentCodes } = await import("../_core/accessControl");
  const userRole = args.userRole ?? "user";
  const resolved = await resolveDataScope(args.userId, userRole);
  // ⚠ `scopeLabelsOf` chép ĐÚNG BA ô — `filter` không có đường lọt ra ngoài hàm này.
  const labels = scopeLabelsOf(resolved);
  if (!resolved.filter) {
    // Vai toàn quyền theo MÃ (không phải theo tên vai) — giữ đối xứng với `resolveDataScope`.
    return { factoryIds: null, labels };
  }

  const { corporateCodes, factoryCodes } = await getUserAssignmentCodes(args.userId, userRole);
  if (corporateCodes.length === 0 && factoryCodes.length === 0) {
    return { factoryIds: [], labels };
  }

  const db = await getReadDb();
  if (!db) {
    console.error("[resolveTenantFactoryScope] Database connection unavailable (DB_UNAVAILABLE)");
    return { factoryIds: [], labels };
  }
  const codeConds: SQL[] = [];
  if (factoryCodes.length > 0) codeConds.push(inArray(factories.code, factoryCodes));
  if (corporateCodes.length > 0) codeConds.push(inArray(factories.corporateCode, corporateCodes));
  const rows = await db
    .select({ id: factories.id })
    .from(factories)
    .where(codeConds.length === 1 ? codeConds[0] : or(...codeConds));
  return {
    factoryIds: (rows as any[]).map((r) => Number(r.id)).filter((id) => Number.isFinite(id)),
    labels,
  };
}

/**
 * ★★★ 2026-08-18 — CHIẾU **MÃ TENANT** (trục ②) xuống tập `factories.id`.
 *
 * Cần cho hai bề mặt mà mệnh đề trên `product_inspections` KHÔNG gắn vào được:
 *   • `oee_metrics` — chỉ có `machineId`; phải đi qua `machineIdFactoryGate` (nhận `factoryIds`).
 *   • `getShiftReport` — chọn `shift_configs` theo `factoryId` (SỐ), còn khoá mang mã (CHỮ).
 *
 * ★★★ **DÙNG ĐỊNH DANH CỤ THỂ NHẤT — và vì sao KHÔNG phải AND hai mã.**
 * Bản đầu của hàm này viết `code = factoryCode AND "corporateCode" = corporateCode`, đối xứng với
 * `tenantCodeInspectionFilter`. **Phép đo bác bỏ nó** (2026-08-18, chạy trên CSDL thật):
 *
 *     aoi_management       →   0/3    hàng `factories` có `corporateCode`
 *     aoi_management_test  →  33/1177 hàng `factories` có `corporateCode`
 *     (`product_inspections` thì mang ĐỦ cả hai mã: 22.995 hàng `SIM`/`SIM-FAC`)
 *
 * Tức `factories.corporateCode` gần như luôn NULL trong khi `product_inspections.corporateCode`
 * thì không. Với phép AND, **mọi khoá phạm vi-nhà-máy trên bản triển khai thật sẽ chiếu ra 0 nhà
 * máy** ⇒ `machine_oee` rỗng và `shift` 403 — một tính năng chết ngay khi ra đời, mà lại trông
 * "an toàn". Đây đúng là lớp lỗi "lưới đo một HÌNH DẠNG DỮ LIỆU KHÔNG TỒN TẠI".
 *
 * Luật thay thế: **`factories.code` là UNIQUE** (ràng buộc lược đồ, không phải giả định), nên
 * `factoryCode` MỘT MÌNH đã xác định đúng một nhà máy. `corporateCode` chỉ được dùng khi KHÔNG có
 * `factoryCode` — tức khoá cấp TẬP ĐOÀN.
 *
 * ⚠ Điều này **KHÔNG nới cổng lọc hàng**. Gate quyền lực thật vẫn là
 * `tenantCodeInspectionFilter` trên `product_inspections`, và nó VẪN nối hai mã bằng AND. Hàm
 * này chỉ trả lời một câu hỏi khác: *"khoá này nói tới nhà máy NÀO"* — và một khoá viết rõ
 * `factoryCode` thì đã tự trả lời rồi.
 *
 * ⚠ **Fail-CLOSED ba lần**, và mỗi lần đều kèm MÃ MÁY-ĐỌC-ĐƯỢC thay vì một mảng rỗng câm:
 * lời khai rỗng ⇒ `empty_scope`; CSDL vắng ⇒ `db_unavailable`; không nhà máy nào khớp ⇒
 * `no_match`. Nơi gọi PHẢI phân biệt được "phạm vi của bạn không có nhà máy nào" với "nhà máy
 * của bạn không có số liệu" — trả 0 dòng cho cả hai là nói dối một trong hai.
 */
export type TenantCodeFactoryOutcome = "ok" | "empty_scope" | "db_unavailable" | "no_match";

export interface TenantCodeFactoryIds {
  factoryIds: number[];
  outcome: TenantCodeFactoryOutcome;
}

export async function resolveTenantCodeFactoryIds(
  scope: TenantCodeScope | null | undefined,
): Promise<TenantCodeFactoryIds> {
  if (isTenantCodeScopeEmpty(scope)) return { factoryIds: [], outcome: "empty_scope" };

  const db = await getReadDb();
  if (!db) {
    console.error("[resolveTenantCodeFactoryIds] Database connection unavailable (DB_UNAVAILABLE)");
    return { factoryIds: [], outcome: "db_unavailable" };
  }
  // ĐỊNH DANH CỤ THỂ NHẤT — xem docblock. `factories.code` UNIQUE ⇒ `factoryCode` cho ra tối đa
  // MỘT hàng; chỉ khi vắng nó mới lùi về `corporateCode` (khoá cấp tập đoàn ⇒ N hàng, hợp lệ).
  const where = scope?.factoryCode
    ? eq(factories.code, scope.factoryCode)
    : eq(factories.corporateCode, scope!.corporateCode!);
  const rows = await db.select({ id: factories.id }).from(factories).where(where);
  const factoryIds = (rows as any[]).map((r) => Number(r.id)).filter((id) => Number.isFinite(id));
  return { factoryIds, outcome: factoryIds.length > 0 ? "ok" : "no_match" };
}

/**
 * Vị từ `IN (…)` trên một cột `factoryId`, dùng được cả trong truy vấn drizzle lẫn truy vấn thô.
 *
 * ⚠ Tập RỖNG ⇒ `1 = 0` TƯỜNG MINH, KHÔNG phải `undefined`/bỏ qua. Và KHÔNG dùng
 * `col = ANY(${jsArray})`: postgres.js gửi mảng JS sang thành `text[]` ⇒ `42809 op ANY/ALL
 * (array) requires array on right side` (đã cắn 10 chỗ, xem note `drizzle-ANY-array`). `sql.join`
 * trải từng phần tử thành tham số ràng buộc riêng — cùng khuôn với `db/machine.ts:80`.
 */
export function factoryIdGate(col: SQL | AnyColumn, factoryIds: number[]): SQL {
  if (factoryIds.length === 0) return sql`1 = 0`;
  return sql`${col} IN (${sql.join(factoryIds.map((id) => sql`${id}`), sql`, `)})`;
}

/**
 * Base WHERE conditions over product_inspections. The product filter is honoured
 * by default so any report can scope to a single product model (getYieldByProduct
 * still GROUPs by product, so a product filter just narrows it to one row).
 * `includeProduct=false` is an escape hatch for callers that want the product
 * dimension unconstrained regardless of the passed filter.
 */
function baseConditions(
  f: ReportRollupFilters,
  opts: { includeProduct?: boolean } = {},
): SQL[] {
  const includeProduct = opts.includeProduct ?? true;
  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, f.startDate),
    lte(productInspections.inspectionTime, f.endDate),
  ];
  if (f.machineId) conditions.push(eq(productInspections.machineId, f.machineId));
  if (includeProduct && f.productModelId) {
    conditions.push(eq(productInspections.productModelId, f.productModelId));
  }
  if (f.lineId) conditions.push(eq(stations.lineId, f.lineId));
  if (f.workshopId) conditions.push(eq(productionLines.workshopId, f.workshopId));
  if (f.factoryId) conditions.push(eq(workshops.factoryId, f.factoryId));
  return conditions;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Defect Pareto by CATEGORY / SEVERITY / IPC-SECTION
// ═══════════════════════════════════════════════════════════════════════════

export type DefectDimension = "category" | "severity" | "ipcSection";

/** One raw grouped row from the DB (or a test fixture). */
export interface DimensionCountRow {
  /** The dimension value (category / severity / ipcSection); NULL when the NG
   * row is unclassified, or classified but the dimension column is null. */
  key: string | null;
  /** measurement_results.defectCatalogId IS NOT NULL. */
  classified: boolean;
  count: number;
}

export interface DimensionParetoItem {
  /** Dimension value | "UNSPECIFIED" | "OTHERS" | "UNCLASSIFIED". */
  key: string;
  count: number;
  /** Of the FULL NG population (classified + unclassified). */
  percentage: number;
  cumulativePercentage: number;
  bucket: "value" | "unspecified" | "others" | "unclassified";
}

export interface DimensionParetoResult {
  dimension: DefectDimension;
  items: DimensionParetoItem[];
  totalDefects: number;
  classifiedDefects: number;
  unclassifiedDefects: number;
  topN: number;
}

type EmittedItem = Omit<DimensionParetoItem, "percentage" | "cumulativePercentage">;

/**
 * Pure Pareto builder (unit-tested): true cumulative % over the FULL NG
 * population, top-N named dimension values + one "OTHERS" tail bucket, plus:
 *  - "UNSPECIFIED": classified rows whose dimension column is null (only
 *    possible for the nullable ipcSection — competes in the ranking).
 *  - "UNCLASSIFIED": rows with no defectCatalogId. NEVER folded into OTHERS —
 *    it stays its own bucket and competes in the ranking (hiding it would fake
 *    the distribution).
 */
export function buildDimensionPareto(
  rows: DimensionCountRow[],
  dimension: DefectDimension,
  topN = 10,
): DimensionParetoResult {
  let unclassified = 0;
  const byValue = new Map<string, number>();
  for (const r of rows) {
    const count = Number(r.count) || 0;
    if (count <= 0) continue;
    if (!r.classified) {
      unclassified += count;
      continue;
    }
    const key = r.key == null || r.key === "" ? "UNSPECIFIED" : String(r.key);
    byValue.set(key, (byValue.get(key) ?? 0) + count);
  }

  const valueItems: EmittedItem[] = [...byValue.entries()]
    .map(([key, count]) => ({
      key,
      count,
      bucket: (key === "UNSPECIFIED" ? "unspecified" : "value") as DimensionParetoItem["bucket"],
    }))
    .sort((a, b) => b.count - a.count);

  const totalDefects = valueItems.reduce((s, r) => s + r.count, 0) + unclassified;

  const head = valueItems.slice(0, Math.max(1, topN));
  const tail = valueItems.slice(Math.max(1, topN));
  const emitted: EmittedItem[] = [...head];
  if (tail.length > 0) {
    emitted.push({ key: "OTHERS", count: tail.reduce((s, r) => s + r.count, 0), bucket: "others" });
  }
  if (unclassified > 0) {
    emitted.push({ key: "UNCLASSIFIED", count: unclassified, bucket: "unclassified" });
  }
  // OTHERS/UNCLASSIFIED compete for rank — sort the emitted set by count.
  emitted.sort((a, b) => b.count - a.count);

  let cumulative = 0;
  const items: DimensionParetoItem[] = emitted.map((r) => {
    const pct = totalDefects > 0 ? (r.count / totalDefects) * 100 : 0;
    cumulative += pct;
    return { ...r, percentage: round2(pct), cumulativePercentage: round2(cumulative) };
  });

  return {
    dimension,
    items,
    totalDefects,
    classifiedDefects: totalDefects - unclassified,
    unclassifiedDefects: unclassified,
    topN,
  };
}

/**
 * Defect Pareto rolled up by a defect_catalog DIMENSION over an inspection
 * window. Filters: machine / line / workshop / factory / product model. NG
 * measurement_results only. See buildDimensionPareto for the honesty contract.
 */
export async function getDefectParetoByCategory(
  params: ReportRollupFilters & { dimension?: DefectDimension; topN?: number },
): Promise<DimensionParetoResult> {
  const dimension = params.dimension ?? "category";
  const topN = params.topN ?? 10;
  const db = await getReadDb();
  if (!db) {
    console.error("[getDefectParetoByCategory] Database connection unavailable (DB_UNAVAILABLE)");
    return { dimension, items: [], totalDefects: 0, classifiedDefects: 0, unclassifiedDefects: 0, topN };
  }

  const dimCol =
    dimension === "category"
      ? defectCatalog.category
      : dimension === "severity"
        ? defectCatalog.severity
        : defectCatalog.ipcSection;

  // Grouped as an int (not a boolean) so the classified flag is driver-agnostic
  // (postgres.js booleans vs 't'/'f' strings). Same expression in SELECT + GROUP BY.
  const classifiedExpr = sql<number>`(CASE WHEN ${measurementResults.defectCatalogId} IS NOT NULL THEN 1 ELSE 0 END)`;

  const conditions = await scopedConditions(params);
  conditions.push(sql`${measurementResults.result} = 'NG'`);

  let query = db
    .select({
      key: dimCol,
      classified: classifiedExpr.as("classified"),
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(defectCatalog, eq(measurementResults.defectCatalogId, defectCatalog.id))
    .$dynamic();

  if (needsHierarchy(params)) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query
    .where(and(...conditions))
    .groupBy(dimCol, classifiedExpr)
    .orderBy(desc(sql`COUNT(*)`));

  const clean: DimensionCountRow[] = (rows as any[]).map((r) => ({
    key: r.key ?? null,
    classified: Number(r.classified) === 1,
    count: Number(r.count) || 0,
  }));
  return buildDimensionPareto(clean, dimension, topN);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Per-PRODUCT yield rollup
// ═══════════════════════════════════════════════════════════════════════════

export interface ProductYieldRow {
  productModelId: number | null;
  productCode: string | null;
  productName: string | null;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  /** Canonical FINAL yield % ((OK+NTF)/total), rounded to 2 decimals. */
  yieldRate: number;
}

/**
 * Per-product output + canonical final yield over a window, ordered by output
 * (total inspections) descending. Inspections with a null productModelId are
 * NOT hidden — they roll up into one honest row (productModelId=null) so the
 * output totals stay reconcilable with getDashboardStats.
 */
export async function getYieldByProduct(params: ReportRollupFilters): Promise<ProductYieldRow[]> {
  const db = await getReadDb();
  if (!db) {
    console.error("[getYieldByProduct] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions = await scopedConditions(params);

  let query = db
    .select({
      productModelId: productInspections.productModelId,
      productCode: productModels.code,
      productName: productModels.name,
      total: sql<number>`COUNT(*)`.as("total"),
      ok: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`.as("ok"),
      ng: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`.as("ng"),
      ntf: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`.as("ntf"),
    })
    .from(productInspections)
    .leftJoin(productModels, eq(productInspections.productModelId, productModels.id))
    .$dynamic();

  if (needsHierarchy(params)) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query
    .where(and(...conditions))
    .groupBy(productInspections.productModelId, productModels.code, productModels.name)
    .orderBy(desc(sql`COUNT(*)`));

  return (rows as any[]).map((r) => {
    const total = Number(r.total) || 0;
    const ok = Number(r.ok) || 0;
    const ng = Number(r.ng) || 0;
    const ntf = Number(r.ntf) || 0;
    return {
      productModelId: r.productModelId ?? null,
      productCode: r.productCode ?? null,
      productName: r.productName ?? null,
      total,
      ok,
      ng,
      ntf,
      yieldRate: roundPct(finalYield({ ok, ntf, total }), 2),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Per-WEEK yield trend (factory-timezone ISO week buckets)
// ═══════════════════════════════════════════════════════════════════════════

export interface WeeklyYieldRow {
  /** Factory-local week start (Monday) as 'YYYY-MM-DD'. */
  week: string;
  /** ISO week label e.g. '2026-W27'. */
  isoWeek: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  /** Canonical FINAL yield % for the week. */
  yieldRate: number;
}

/**
 * Yield trend bucketed by ISO week in the FACTORY timezone
 * (date_trunc('week', … AT TIME ZONE factory)). Ordered chronologically.
 */
export async function getYieldTrendByWeek(params: ReportRollupFilters): Promise<WeeklyYieldRow[]> {
  const db = await getReadDb();
  if (!db) {
    console.error("[getYieldTrendByWeek] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  // Factory-local week bucket — same expression object in SELECT / GROUP BY /
  // ORDER BY (tz literals are inlined via sql.raw, so it is repeatable).
  const weekTrunc = factoryDateTruncSql("week", productInspections.inspectionTime);
  const weekText = sql<string>`TO_CHAR(${weekTrunc}, 'YYYY-MM-DD')`;
  const isoWeekText = sql<string>`TO_CHAR(${weekTrunc}, 'IYYY-"W"IW')`;

  const conditions = await scopedConditions(params);

  let query = db
    .select({
      week: weekText.as("week"),
      isoWeek: isoWeekText.as("isoWeek"),
      total: sql<number>`COUNT(*)`.as("total"),
      ok: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`.as("ok"),
      ng: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`.as("ng"),
      ntf: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`.as("ntf"),
    })
    .from(productInspections)
    .$dynamic();

  if (needsHierarchy(params)) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query
    .where(and(...conditions))
    .groupBy(weekTrunc)
    .orderBy(weekTrunc);

  return (rows as any[]).map((r) => {
    const total = Number(r.total) || 0;
    const ok = Number(r.ok) || 0;
    const ng = Number(r.ng) || 0;
    const ntf = Number(r.ntf) || 0;
    return {
      week: String(r.week),
      isoWeek: String(r.isoWeek),
      total,
      ok,
      ng,
      ntf,
      yieldRate: roundPct(finalYield({ ok, ntf, total }), 2),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3b. Per-DAY yield trend (factory-timezone day buckets) — CÓ TRỤC PHẠM VI
// ═══════════════════════════════════════════════════════════════════════════

export interface DailyYieldRow {
  /** Factory-local day as 'YYYY-MM-DD'. */
  day: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  /** Canonical FINAL yield % ((OK+NTF)/total). */
  yieldRate: number;
  /** NG / total, %. */
  ngRate: number;
}

/**
 * ★★★ 2026-08-17 — vì sao hàm này ra đời thay vì dùng lại `db/statistics.getYieldTrendData`.
 *
 * Báo cáo `daily` (loại được xuất nhiều nhất) là bề mặt DUY NHẤT của họ báo cáo còn đi qua
 * `getYieldTrendData`, và hàm ấy **không có trục `userId`**: nó nhận đúng một `factoryCode`
 * đơn lẻ. Một người được gán HAI nhà máy không diễn đạt được bằng một ô `factoryCode`, nên
 * "thu hẹp bằng cách truyền factoryCode" là một bản vá SAI theo cấu tạo — nó vừa để lọt
 * (người 2 nhà máy) vừa chặn nhầm (người 2 nhà máy chỉ thấy 1).
 *
 * `getYieldTrendData` sống ở `db/statistics.ts` — file đang do một lượt khác sở hữu, KHÔNG
 * được đụng trong lượt này. Nên bản `day` được dựng ở đây, dùng ĐÚNG `scopedConditions` như
 * ba bộ tổng hợp còn lại: một trục phạm vi, một chỗ, không có bản sao thứ hai để lệch.
 *
 * Phép tính giữ nguyên quy ước chuẩn của repo: yield CUỐI = (OK+NTF)/total (NTF = PASS,
 * quyết định #4), bucket theo múi giờ NHÀ MÁY (`factoryDateTruncSql`), không phải UTC.
 */
export async function getYieldTrendByDay(params: ReportRollupFilters): Promise<DailyYieldRow[]> {
  const db = await getReadDb();
  if (!db) {
    console.error("[getYieldTrendByDay] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const dayTrunc = factoryDateTruncSql("day", productInspections.inspectionTime);
  const dayText = sql<string>`TO_CHAR(${dayTrunc}, 'YYYY-MM-DD')`;

  const conditions = await scopedConditions(params);

  let query = db
    .select({
      day: dayText.as("day"),
      total: sql<number>`COUNT(*)`.as("total"),
      ok: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`.as("ok"),
      ng: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`.as("ng"),
      ntf: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`.as("ntf"),
    })
    .from(productInspections)
    .$dynamic();

  if (needsHierarchy(params)) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query.where(and(...conditions)).groupBy(dayTrunc).orderBy(dayTrunc);

  return (rows as any[]).map((r) => {
    const total = Number(r.total) || 0;
    const ok = Number(r.ok) || 0;
    const ng = Number(r.ng) || 0;
    const ntf = Number(r.ntf) || 0;
    return {
      day: String(r.day),
      total,
      ok,
      ng,
      ntf,
      yieldRate: roundPct(finalYield({ ok, ntf, total }), 2),
      ngRate: total > 0 ? round2((ng / total) * 100) : 0,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Workstation × NG heatmap (real query behind reportGenerator's mock)
// ═══════════════════════════════════════════════════════════════════════════

export interface WorkstationHeatmapRow {
  workstationId: number | null;
  workstationName: string;
  /** NG measurement_results at this workstation. */
  ngCount: number;
  /** ALL measurement_results at this workstation (the ngRate denominator). */
  inspectionCount: number;
  ngRate: number;
}

/**
 * Workstation NG heatmap — NG rate per workstation (via
 * measurement_point_defs.workstationId). Shape matches the field set the NG
 * Visual report's HTML/PDF/XLSX consume ({ workstationName, ngCount,
 * inspectionCount, ngRate }). Only workstations that actually have NG appear
 * (HAVING ng>0) — an NG heatmap of zero-NG rows is noise. Point defs with no
 * workstation link roll up into one honest "Chưa gán công trạm" row.
 */
export async function getWorkstationHeatmap(params: ReportRollupFilters): Promise<WorkstationHeatmapRow[]> {
  const db = await getReadDb();
  if (!db) {
    console.error("[getWorkstationHeatmap] Database connection unavailable (DB_UNAVAILABLE)");
    return [];
  }

  const conditions = await scopedConditions(params);

  let query = db
    .select({
      workstationId: measurementPointDefs.workstationId,
      workstationName: workstations.name,
      total: sql<number>`COUNT(*)`.as("total"),
      ng: sql<number>`SUM(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 ELSE 0 END)`.as("ng"),
    })
    .from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(workstations, eq(measurementPointDefs.workstationId, workstations.id))
    .$dynamic();

  if (needsHierarchy(params)) {
    query = query
      .innerJoin(machines, eq(productInspections.machineId, machines.id))
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id));
  }

  const rows = await query
    .where(and(...conditions))
    .groupBy(measurementPointDefs.workstationId, workstations.name)
    .having(sql`SUM(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 ELSE 0 END) > 0`)
    .orderBy(desc(sql`SUM(CASE WHEN ${measurementResults.result} = 'NG' THEN 1 ELSE 0 END)`));

  return (rows as any[]).map((r) => {
    const ngCount = Number(r.ng) || 0;
    const inspectionCount = Number(r.total) || 0;
    return {
      workstationId: r.workstationId ?? null,
      workstationName: r.workstationName ?? "Chưa gán công trạm",
      ngCount,
      inspectionCount,
      ngRate: inspectionCount > 0 ? round2((ngCount / inspectionCount) * 100) : 0,
    };
  });
}
