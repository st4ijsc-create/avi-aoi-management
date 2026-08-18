import { getDb } from "./connection";
import { eq, and, desc, gte, lte, like, sql, or, inArray, SQL } from "drizzle-orm";
import {
  factories,
  workshops,
  productionLines,
  stations,
  machines,
  productInspections,
  measurementPointDefs,
  measurementResults,
  dailyStatistics, InsertDailyStatistics,
  productModels,
  alertHistory,
  workstations,
  defectCatalog,
} from "../../drizzle/schema";
import { getUserCorporateAssignments, getUserFactoryAssignments } from "./auth";
// Shared list projection for product_inspections hot paths (doc 27 gap B9).
import { inspectionListProjection } from "./inspection";
// Nhãn phạm vi từ module KHÔNG phụ thuộc (nhập tĩnh an toàn — `_core/accessControl` vẫn phải
// nạp bằng `import()` động vì nó kéo theo `_core/trpc`).
import {
  UNSCOPED_LABELS,
  type ScopeLabels,
  type ScopedRows,
  scopeLabelsOf,
  withScopeLabels,
} from "../_core/accessControlLabels";
// ★ 2026-08-18 — trục phạm vi THỨ HAI (mã tenant tường minh của khoá API). Module thuần, chỉ
// phụ thuộc drizzle ⇒ nhập TĨNH an toàn từ `server/db/**`.
import { tenantCodeInspectionFilter, type TenantCodeScope } from "../_core/tenantCodeScope";
// Canonical KPI math + factory-timezone bucketing (doc 27 decision #4, gaps A2/A3/A4).
import {
  finalYield,
  fpyFromFirstInspections,
  roundPct,
  finalYieldPctSql,
  fpyAggregateSql,
  factoryDateSql,
  factoryDayTextSql,
  factoryHourTextSql,
  factoryDateTruncSql,
  executeRows,
} from "../utils/kpi";
// Doc 32 Wave R1 — real shift attribution from shift_configs (decision #3).
import {
  getApplicableShiftConfigs,
  buildShiftClassifierSql,
  UNASSIGNED_SHIFT,
  type ShiftWindowMeta,
} from "./shiftResolution";

// ============ DAILY STATISTICS FUNCTIONS ============

export async function upsertDailyStatistics(data: InsertDailyStatistics) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(dailyStatistics).values(data).onConflictDoUpdate({
    target: [dailyStatistics.machineId, dailyStatistics.date],
    set: {
      totalCount: data.totalCount,
      okCount: data.okCount,
      ngCount: data.ngCount,
      ntfCount: data.ntfCount,
      yieldRate: data.yieldRate,
    }
  });
}

export async function getDailyStatistics(params: {
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
} | number, startDateArg?: Date, endDateArg?: Date) {
  const db = await getDb();
  if (!db) return [];

  // Support both old and new API
  let machineId: number | undefined;
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (typeof params === 'number') {
    // Old API: getDailyStatistics(machineId, startDate, endDate)
    machineId = params;
    startDate = startDateArg;
    endDate = endDateArg;
  } else {
    // New API: getDailyStatistics({ machineId?, startDate?, endDate? })
    machineId = params.machineId;
    startDate = params.startDate;
    endDate = params.endDate;
  }

  const conditions = [];
  if (machineId) conditions.push(eq(dailyStatistics.machineId, machineId));
  if (startDate) conditions.push(gte(dailyStatistics.date, startDate));
  if (endDate) conditions.push(lte(dailyStatistics.date, endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // If no machineId, aggregate across all machines
  if (!machineId) {
    const result = await db.select({
      date: dailyStatistics.date,
      okCount: sql<number>`SUM(${dailyStatistics.okCount})`.as('ok_count'),
      ngCount: sql<number>`SUM(${dailyStatistics.ngCount})`.as('ng_count'),
      ntfCount: sql<number>`SUM(${dailyStatistics.ntfCount})`.as('ntf_count'),
    })
      .from(dailyStatistics)
      .where(whereClause)
      .groupBy(dailyStatistics.date)
      .orderBy(dailyStatistics.date);
    
    return result.map(r => ({
      date: r.date,
      okCount: Number(r.okCount) || 0,
      ngCount: Number(r.ngCount) || 0,
      ntfCount: Number(r.ntfCount) || 0,
    }));
  }

  return db.select().from(dailyStatistics)
    .where(whereClause)
    .orderBy(dailyStatistics.date);
}

// ============ DASHBOARD STATS FUNCTIONS ============

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Machines under a factory/workshop as ONE uncorrelated subquery
 * (machines ⋈ stations ⋈ production_lines ⋈ workshops). Used with
 * `inArray(productInspections.machineId, …)` so the whole hierarchy filter is
 * resolved inside the aggregate query — doc 27 gap B3 (was 4 sequential
 * round-trips per dashboard render).
 *
 * Deliberately NO isActive conditions: the pre-B3 chain never filtered
 * soft-deleted rows either, and dashboard stats must keep counting history
 * of retired machines (verified in statistics.hierarchy.b3.test.ts).
 */
function machineIdsInHierarchySubquery(db: Db, filters: { factoryId?: number; workshopId?: number }) {
  const hierarchyConditions: SQL[] = [];
  if (filters.factoryId) hierarchyConditions.push(eq(workshops.factoryId, filters.factoryId));
  if (filters.workshopId) hierarchyConditions.push(eq(workshops.id, filters.workshopId));
  return db
    .select({ id: machines.id })
    .from(machines)
    .innerJoin(stations, eq(machines.stationId, stations.id))
    .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
    .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
    .where(and(...hierarchyConditions));
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// TRỤC PHẠM VI DÙNG CHUNG CHO CẢ FILE (2026-08-17, đợt trả nợ thứ hai)
// ══════════════════════════════════════════════════════════════════════════════════════════

/** Ô danh tính người gọi mà MỌI hàm đọc bản ghi kiểm trong file này phải nhận. */
export interface StatsScopeArgs {
  userId?: number;
  userRole?: string;
}

/**
 * Kết quả phân giải phạm vi, với `filter` và nhãn TÁCH RỜI NGAY TỪ KIỂU.
 *
 * ⚠⚠ Vì sao không trả thẳng `ResolvedDataScope`. Nó gộp `filter` (đối tượng SQL của drizzle,
 * tham chiếu vòng `PgTable → PgSerial → table`) CHUNG một mức với ba ô nhãn, nên `scope = resolved`
 * rồi `return { ...scope }` là một phép gán HỢP LỆ với `tsc` mà lúc chạy đẩy `filter` vào đáp ứng
 * tRPC ⇒ superjson chết `Converting circular structure to JSON` ⇒ **500 cho mọi người dùng**
 * (đã xảy ra thật trên `dashboard.getStats` ngày 2026-08-17; sống sót qua `tsc` cả hai config VÀ
 * 220 ca test). Ở đây `labels` là ĐÃ đi qua `scopeLabelsOf`, còn `filter` nằm ở một ô KHÁC TÊN —
 * `...scope.labels` không có đường nào lôi được `filter` ra.
 */
interface ResolvedStatsScope {
  /** Vị từ SQL trên BẢNG `product_inspections`. `undefined` = vai toàn quyền / lối đi vô danh. */
  filter: SQL | undefined;
  labels: ScopeLabels;
}

/**
 * ★★★ BỘ PHÂN GIẢI DUY NHẤT của file này. Mọi hàm đọc `product_inspections` gọi hàm NÀY —
 * không hàm nào tự dựng lại logic gán nhà máy (một quy tắc, một chỗ sửa).
 *
 * Lối đi KHÔNG mang danh tính (`userId` rỗng: tác vụ nền, REST máy-với-máy, export không ngữ
 * cảnh) và vai `admin` đều nhận `filter: undefined` + `UNSCOPED_LABELS` — GIỮ NGUYÊN hành vi cũ,
 * đây là chiều DƯƠNG chống "vá quá tay thành chặn tất cả".
 */
async function resolveStatsScope(args?: StatsScopeArgs): Promise<ResolvedStatsScope> {
  if (!args?.userId || args.userRole === 'admin') {
    return { filter: undefined, labels: UNSCOPED_LABELS };
  }
  const { resolveDataScope } = await import("../_core/accessControl");
  const resolved = await resolveDataScope(args.userId, args.userRole || 'user');
  // ⚠ `scopeLabelsOf` chép ĐÚNG BA ô — `filter` không có đường lọt vào `labels`.
  return { filter: resolved.filter, labels: scopeLabelsOf(resolved) };
}

/**
 * ★★ CỔNG PHẠM VI cho các truy vấn RAW SQL có ĐẶT BÍ DANH cho bảng (`FROM product_inspections pi`).
 *
 * **Vì sao không nhét thẳng `filter` vào.** `resolveStatsScope().filter` do drizzle sinh ra, luôn
 * tự đặt tên bảng ĐẦY ĐỦ: `"product_inspections"."factoryCode" in (…)`. Trong một truy vấn
 * `FROM product_inspections pi`, bí danh **che** tên bảng gốc, nên tham chiếu ấy là lỗi Postgres
 * `missing FROM-clause entry for table "product_inspections"` — bản vá sẽ ném 500 thay vì lọc.
 *
 * **Vì sao là bán-nối (semi-join) chứ không phải một vị từ viết tay trên bí danh.** Viết tay
 * `pi."factoryCode" IN (…)` là dựng bộ quy tắc phạm vi THỨ HAI: hai chỗ phải sửa mỗi khi quy tắc
 * đổi, và cái thứ hai sẽ lệch trong im lặng. Ở đây `filter` được dùng **NGUYÊN VĂN** bên trong
 * truy vấn con — nơi tên bảng đầy đủ lại hợp lệ — nên vẫn chỉ có MỘT nguồn quyền lực.
 *
 * **Giá phải trả, đã đo** (`EXPLAIN ANALYZE`, 22.996 hàng, 2026-08-17): 12,7 ms → 27,0 ms, kế
 * hoạch là *Hash Join* (bán-nối băm), KHÔNG phải vòng lặp lồng — chi phí ~2×, tuyến tính. Đổi lại
 * là một nguồn quyền lực duy nhất; nếu bảng lớn lên tới mức này thành nút thắt thì cách sửa ĐÚNG
 * là cho bộ phân giải nhận tham số bảng/bí danh, KHÔNG phải chép luật ra chỗ thứ hai.
 *
 * @param aliasIdCol cột khoá chính qua bí danh, ví dụ sql`pi.id`
 */
function scopeGateOnAlias(aliasIdCol: SQL, filter: SQL): SQL {
  return sql`${aliasIdCol} IN (SELECT ${productInspections.id} FROM ${productInspections} WHERE ${filter})`;
}

/**
 * ★★★ Như `scopeGateOnAlias` nhưng GIỮ LẠI phần DANH MỤC của các truy vấn
 * `… LEFT JOIN measurement_results mr … LEFT JOIN product_inspections pi …`.
 *
 * **Vì sao cần biến thể này.** Mấy bề mặt "danh mục + số đếm" (`getWorkstationSummary`,
 * `getDefectsByWorkstation`, `getMeasurementPointsByWorkstation`,
 * `getTopNGMeasurementPointsByWorkstation`) cố ý `LEFT JOIN` để một trạm/điểm đo CHƯA CÓ kết quả
 * đo nào vẫn hiện với số 0 — chính vì thế bộ lọc ngày của chúng cũng viết
 * `(pi."inspectionTime" IS NULL OR pi."inspectionTime" >= …)`. Một cổng phạm vi TRẦN
 * (`pi.id IN (…)`) sẽ loại luôn các hàng ấy và **xoá mất danh mục** — vá quá tay.
 *
 * ⚠⚠ VÌ SAO NEO VÀO `mr.id` CHỨ KHÔNG PHẢI `pi.id` — LỖ ĐÃ ĐO, KHÔNG PHẢI LO XA.
 * Bản đầu của hàm này viết `(pi.id IS NULL OR pi.id IN (…))`. Nghe thì cùng ý, nhưng
 * `pi.id IS NULL` KHÔNG chỉ đúng với hàng "chưa có kết quả đo": nó còn đúng với **kết quả đo MỒ
 * CÔI** — hàng `measurement_results` có `inspectionId` không nối được về bản ghi kiểm nào.
 * `product_inspections` là hypertable Timescale nên Postgres KHÔNG cho đặt khoá ngoại trỏ vào
 * nó ⇒ mồ côi là chuyện có thật, không phải giả định: đo trên `aoi_management` ngày 2026-08-17
 * có **383 kết quả NG/NTF mồ côi** trên tổng 588. Với vế `pi.id IS NULL`, `supervisor1`
 * (**0 gán nhà máy**) vẫn đọc được **383 NG** qua `workstation.topNGMeasurementPoints` — bản vá
 * XANH ở lưới mà lỗ vẫn mở.
 *
 * Neo `mr.id IS NULL` phát biểu đúng thứ cần giữ: *"hàng này KHÔNG mang kết quả đo nào"*. Hàng
 * CÓ kết quả đo thì phải chứng minh được bản ghi kiểm của nó nằm trong phạm vi — mồ côi (không
 * xác định được nhà máy) KHÔNG rơi vào phạm vi của ai cả, trừ vai toàn quyền (vốn không có
 * `filter` nên không đi qua cổng này).
 *
 * ⚠ Lưới 138 ca KHÔNG bắt được lỗ này ở lượt đầu vì dữ liệu dựng sẵn **không có mồ côi** — một
 * hình dạng dữ liệu CÓ THẬT trong sản xuất mà thước không hề chứa. Nghiệm thu HTTP thật mới lộ
 * ra. Nay dữ liệu dựng sẵn của `statisticsScope.test.ts` có một kết quả NG mồ côi.
 *
 * Giới hạn TRUNG THỰC (giống hệt bộ lọc ngày đã có, không phải hồi quy mới): một điểm đo mà TẤT
 * CẢ kết quả đều nằm NGOÀI phạm vi sẽ biến mất khỏi danh sách thay vì hiện số 0 — đúng như một
 * điểm đo mà mọi kết quả đều nằm ngoài cửa sổ ngày đang chọn.
 *
 * @param resultRowCol cột khoá chính của hàng KẾT QUẢ ĐO qua bí danh, ví dụ sql`mr.id`
 * @param aliasIdCol   cột khoá chính của bản ghi kiểm qua bí danh, ví dụ sql`pi.id`
 */
function scopeGateKeepingCatalogue(resultRowCol: SQL, aliasIdCol: SQL, filter: SQL): SQL {
  return sql`(${resultRowCol} IS NULL OR ${scopeGateOnAlias(aliasIdCol, filter)})`;
}

export async function getDashboardStats(filters?: {
  factoryId?: number;
  workshopId?: number;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: string;
}) {
  const db = await getDb();
  if (!db) return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0, fpy: 0, firstPass: 0, firstTotal: 0, ...UNSCOPED_LABELS };

  // Build conditions for inspections
  const conditions: SQL[] = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (filters?.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));

  // Access filter by user assignments.
  // ⚠ `resolveDataScope` trả CẢ điều kiện SQL lẫn câu giải thích: một tài khoản 0 gán nhà máy
  // nhận vị từ FALSE (không phải `undefined` = không lọc, xem `_core/accessControl.ts`) và
  // các số 0 của nó phải đi kèm lý do, không được im lặng thành "chưa có sản lượng".
  let scope: ScopeLabels = UNSCOPED_LABELS;
  if (filters?.userId && filters?.userRole !== 'admin') {
    const { resolveDataScope } = await import("../_core/accessControl");
    const resolved = await resolveDataScope(filters.userId, filters.userRole || 'user');
    if (resolved.filter) conditions.push(resolved.filter);
    scope = scopeLabelsOf(resolved);
  }

  // Hierarchy filter (doc 27 gap B3): ONE machineId IN (subquery) instead of the
  // previous 4 sequential round-trips (workshops→lines→stations→machines).
  // Semantics notes vs the old shape (both deliberate fixes, see W4-C tests):
  //  - workshopId was previously a DEAD parameter (accepted, silently ignored);
  //    it now actually filters.
  //  - the old code silently DROPPED the filter (returning global stats) when an
  //    intermediate level was empty (e.g. a factory with no lines); a factory
  //    filter that resolves to zero machines now honestly returns zeros.
  //  - like the old chain, the subquery does NOT filter isActive at any level:
  //    inspections of soft-deleted machines keep counting toward their factory.
  if (filters?.factoryId || filters?.workshopId) {
    conditions.push(inArray(productInspections.machineId, machineIdsInHierarchySubquery(db, {
      factoryId: filters.factoryId,
      workshopId: filters.workshopId,
    })));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [result, fpyResult] = await Promise.all([
    db.select({
      total: sql<number>`count(*)`,
      ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
      ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
    }).from(productInspections).where(whereClause),
    // True FPY: first inspection per serial inside the window (decision #4).
    db.execute(fpyAggregateSql({ where: whereClause })),
  ]);

  const stats = result[0] || { total: 0, ok: 0, ng: 0, ntf: 0 };
  const total = Number(stats.total) || 0;
  const ok = Number(stats.ok) || 0;
  const ng = Number(stats.ng) || 0;
  const ntf = Number(stats.ntf) || 0;

  const fpyRow = executeRows(fpyResult)[0] || {};
  const firstTotal = Number(fpyRow.first_total) || 0;
  const firstPass = Number(fpyRow.first_pass) || 0;

  return {
    total, ok, ng, ntf,
    // Canonical FINAL yield (NTF = pass, decision #4).
    yieldRate: roundPct(finalYield({ ok, ntf, total }), 2),
    // Canonical true FPY (first inspection per serial, NTF/retests excluded).
    fpy: roundPct(fpyFromFirstInspections({ firstPass, firstTotal }), 2),
    firstPass,
    firstTotal,
    ...scope,
  };
}

/**
 * ⚠ `scope` là tham số VỊ TRÍ THỨ TƯ, cố ý tuỳ chọn: ba nơi gọi cũ
 * (`dashboardStatsRouters`, `hierarchyRouters`, `machineApiRouters`) truyền theo vị trí, và
 * `machineApiRouters` là lối đi MÁY-VỚI-MÁY không có danh tính người dùng — nó phải tiếp tục
 * chạy y nguyên. Đổi sang một đối tượng tham số sẽ làm `tsc` đỏ ở cả ba mà không thu được gì.
 */
export async function getMachineStats(
  machineId: number,
  startDate?: Date,
  endDate?: Date,
  scope?: StatsScopeArgs,
) {
  const db = await getDb();
  if (!db) return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0, fpy: 0, firstPass: 0, firstTotal: 0, ...UNSCOPED_LABELS };

  const conditions = [eq(productInspections.machineId, machineId)];
  if (startDate) conditions.push(gte(productInspections.inspectionTime, startDate));
  if (endDate) conditions.push(lte(productInspections.inspectionTime, endDate));

  // Trục phạm vi — khuôn dùng chung (xem `resolveStatsScope`).
  const { filter, labels } = await resolveStatsScope(scope);
  if (filter) conditions.push(filter);

  const whereClause = and(...conditions);

  const [result, fpyResult] = await Promise.all([
    db.select({
      total: sql<number>`count(*)`,
      ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
      ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
    }).from(productInspections).where(whereClause),
    db.execute(fpyAggregateSql({ where: whereClause })),
  ]);

  const stats = result[0] || { total: 0, ok: 0, ng: 0, ntf: 0 };
  const total = Number(stats.total) || 0;
  const ok = Number(stats.ok) || 0;
  const ng = Number(stats.ng) || 0;
  const ntf = Number(stats.ntf) || 0;

  const fpyRow = executeRows(fpyResult)[0] || {};
  const firstTotal = Number(fpyRow.first_total) || 0;
  const firstPass = Number(fpyRow.first_pass) || 0;

  return {
    total, ok, ng, ntf,
    // Canonical FINAL yield (NTF = pass, decision #4).
    yieldRate: roundPct(finalYield({ ok, ntf, total }), 2),
    // Canonical true FPY (first inspection per serial within window).
    fpy: roundPct(fpyFromFirstInspections({ firstPass, firstTotal }), 2),
    firstPass,
    firstTotal,
    // ⚠ BA ô nhãn — KHÔNG bao giờ `...resolved` (kéo theo `filter` có tham chiếu vòng).
    ...labels,
  };
}

// ============ STATS WITH COMPARISON ============
export async function getStatsWithComparison(filters?: {
  factoryId?: number;
  workshopId?: number;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: string;
}) {
  // Get current period stats
  const currentStats = await getDashboardStats(filters);
  
  // Calculate previous period (same duration)
  if (filters?.startDate && filters?.endDate) {
    const duration = filters.endDate.getTime() - filters.startDate.getTime();
    const prevEndDate = new Date(filters.startDate.getTime() - 1);
    const prevStartDate = new Date(prevEndDate.getTime() - duration);
    
    const prevStats = await getDashboardStats({
      ...filters,
      startDate: prevStartDate,
      endDate: prevEndDate,
    });
    
    // Calculate trends
    const outputTrend = prevStats.total > 0
      ? ((currentStats.total - prevStats.total) / prevStats.total) * 100
      : 0;
    // trends.fpy is now the TRUE first-pass-yield delta (decision #4); the
    // final-yield delta is exposed separately as trends.finalYield so the
    // yieldRate KPI tile can pair with the matching trend.
    const fpyTrend = prevStats.fpy > 0
      ? currentStats.fpy - prevStats.fpy
      : 0;
    const finalYieldTrend = prevStats.yieldRate > 0
      ? currentStats.yieldRate - prevStats.yieldRate
      : 0;

    return {
      current: currentStats,
      previous: prevStats,
      trends: {
        output: Math.round(outputTrend * 10) / 10,
        fpy: Math.round(fpyTrend * 10) / 10,
        finalYield: Math.round(finalYieldTrend * 10) / 10,
        ok: prevStats.ok > 0 ? Math.round(((currentStats.ok - prevStats.ok) / prevStats.ok) * 1000) / 10 : 0,
        ng: prevStats.ng > 0 ? Math.round(((currentStats.ng - prevStats.ng) / prevStats.ng) * 1000) / 10 : 0,
        ntf: prevStats.ntf > 0 ? Math.round(((currentStats.ntf - prevStats.ntf) / prevStats.ntf) * 1000) / 10 : 0,
      }
    };
  }
  
  return {
    current: currentStats,
    previous: null,
    trends: null,
  };
}

// ============ PANEL-LEVEL YIELD (doc 51 CASE #7) ============
/**
 * Panel-level yield, surfaced ALONGSIDE the existing board-level yield (this
 * function ADDS panel numbers; getDashboardStats/getMachineStats are unchanged).
 *
 * WHY: SMT lines panelize (one physical panel carries N boards). Line KPIs are
 * booked per PANEL — a panel is scrapped/reworked as a unit, so a panel is NG
 * if ANY of its boards is NG. The board-level yield the dashboard already shows
 * over-counts good units (7/8 boards OK on a scrapped panel still reads 87.5%
 * board yield while the panel is 0% good). Both numbers are legitimate; the
 * factory wants them side by side.
 *
 * Definitions (aligned with utils/kpi.ts decision #4):
 *  - Panel identity  = product_inspections.panelSerial. Rows with panelSerial
 *    NULL or '' are single-board / legacy ingest — they are EXCLUDED from every
 *    panel metric (a board with no panel cannot form a panel) and reported
 *    separately as `boardsWithoutPanel`.
 *  - Panel FINAL yield: a panel PASSES iff none of its boards is 'NG'
 *    (BOOL_OR(result='NG') = false). NTF counts as pass, exactly like the
 *    board-level final yield — a panel of OK+NTF boards is a good panel.
 *  - Panel FPY (true first pass): take the FIRST inspection per BOARD, where a
 *    board is keyed by (panelSerial, boardIndex) — the documented panel-board
 *    identity (schema comment: COALESCE(boardIndex,1) for null-safety), NOT the
 *    row serial. Group those first-boards by panel; a panel first-passes iff
 *    every one of its boards passed OK on its first inspection (NTF and any
 *    retest-that-was-needed break the panel's first pass).
 *
 * LIMITATIONS (honest): when boardIndex is NULL for a panel's rows they all
 * COALESCE to board 1 and collapse to a single logical board (documented
 * null-safe degradation). "First inspection" is first-in-window (no retest
 * linkage column exists — same caveat as board FPY). Board-side
 * numbers here are computed over the SAME whereClause as the panel numbers so
 * the two are directly comparable; they equal getDashboardStats for an identical
 * filter.
 *
 * Purely additive + read-only; not wired to any router yet (see doc 51 report
 * for the proposed wiring into the dashboard KPI endpoint).
 */
/**
 * ★★★ 2026-08-17 — KHUÔN NHÃN PHẠM VI DÙNG CHUNG CHO MỌI HÀM THỐNG KÊ TRONG FILE NÀY.
 *
 * ⚠ ĐỢT HAI (cùng ngày) đã mở rộng khuôn này ra TOÀN BỘ file: 36 hàm xuất ra có đọc
 * `product_inspections`, nay tất cả đều nhận trục phạm vi trừ ba trường hợp MIỄN TRỪ khai tên
 * kèm lý do trong `statisticsScope.test.ts`. Bảy hàm dưới đây giữ nguyên khối `resolveDataScope`
 * viết tay của đợt một; các hàm vá sau dùng bộ phân giải dùng chung `resolveStatsScope` — hai
 * lối viết, CÙNG một nguồn quyền lực (`_core/accessControl`).
 *
 * Bảy hàm ở đây nhận `userId`/`userRole` và bị `resolveDataScope` thu hẹp ĐÚNG. Nhưng chặn đúng
 * mà IM LẶNG thì người dùng chưa được gán nhà máy đọc số 0 thành "chưa có sản lượng" và đi tìm
 * lỗi ở dây chuyền — đúng chỗ không có lỗi. Vì thế MỌI hàm phải mang ba ô
 * `scopeApplied`/`scopeEmptyReason`/`scopeMessage`, cùng một khuôn với `getDashboardStats`:
 *
 *   let scope: ScopeLabels = UNSCOPED_LABELS;                  // lối đi không mang danh tính
 *   if (userId && userRole !== 'admin') {
 *     const resolved = await resolveDataScope(userId, role);
 *     if (resolved.filter) conditions.push(resolved.filter);   // `filter` ở BIẾN RIÊNG
 *     scope = scopeLabelsOf(resolved);                         // ← chỉ BA ô, không bao giờ gán khối
 *   }
 *
 * ⚠⚠ CẤM `scope = resolved`. `ResolvedDataScope` gán được cho `ScopeLabels` (TypeScript chỉ cấm
 * thuộc tính thừa với *object literal*), nên `tsc` XANH, nhưng giá trị lúc chạy vẫn mang `filter`
 * — một đối tượng SQL của drizzle có tham chiếu vòng `PgTable → PgSerial → table`. Phép
 * `return { ...scope }` sẽ đẩy nó vào đáp ứng tRPC và superjson chết
 * `Converting circular structure to JSON` ⇒ 500 cho MỌI người dùng. Đã xảy ra thật ngày
 * 2026-08-17 trên `dashboard.getStats`; sống sót qua `tsc` cả hai config VÀ 220 ca test, chỉ lộ
 * ở lượt gọi HTTP. `accessControlScope.test.ts` nay có một tầng riêng canh đúng chuyện này
 * (stringify TỪNG đáp ứng của chín bề mặt), vì `tsc` không canh được.
 *
 * Hàm trả về MẢNG dùng `withScopeLabels(rows, resolved)` — nhãn đính lên chính mảng, hình dạng
 * mảng giữ nguyên cho các nơi gọi cũ; xem docblock của hàm ấy để biết vì sao không đổi thành
 * `{ rows, …nhãn }`.
 */

export interface PanelYieldStats extends ScopeLabels {
  // Board-level (ALL inspections in the slice; same math as getDashboardStats).
  boardTotal: number;
  boardOk: number;
  boardNg: number;
  boardNtf: number;
  /** Board final yield % (OK+NTF)/total. */
  boardYieldRate: number;
  /** Board true FPY %. */
  boardFpy: number;
  boardFirstPass: number;
  boardFirstTotal: number;
  // Panel-level (panelSerial non-null/non-empty only).
  /** Distinct panels in the slice. */
  panelTotal: number;
  /** Panels with NO NG board. */
  panelPass: number;
  /** Panels with ≥1 NG board. */
  panelNg: number;
  /** Panel final yield % = panelPass/panelTotal. */
  panelYieldRate: number;
  /** Panel true FPY % = panels whose every board first-passed / panels(first). */
  panelFpy: number;
  panelFirstPass: number;
  panelFirstTotal: number;
  /** Inspections with no panelSerial (single-board / legacy), for transparency. */
  boardsWithoutPanel: number;
}

export async function getPanelYieldStats(filters?: {
  factoryId?: number;
  workshopId?: number;
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: string;
}): Promise<PanelYieldStats> {
  const empty: PanelYieldStats = {
    boardTotal: 0, boardOk: 0, boardNg: 0, boardNtf: 0, boardYieldRate: 0,
    boardFpy: 0, boardFirstPass: 0, boardFirstTotal: 0,
    panelTotal: 0, panelPass: 0, panelNg: 0, panelYieldRate: 0,
    panelFpy: 0, panelFirstPass: 0, panelFirstTotal: 0,
    boardsWithoutPanel: 0,
    ...UNSCOPED_LABELS,
  };
  const db = await getDb();
  if (!db) return empty;

  // Build the SAME inspection where-clause getDashboardStats uses so the board
  // and panel numbers here are directly comparable.
  const conditions: SQL[] = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (filters?.machineId) conditions.push(eq(productInspections.machineId, filters.machineId));

  // Nhãn phạm vi — khuôn dùng chung (xem docblock trên `PanelYieldStats`).
  let scope: ScopeLabels = UNSCOPED_LABELS;
  if (filters?.userId && filters?.userRole !== 'admin') {
    const { resolveDataScope } = await import("../_core/accessControl");
    const resolved = await resolveDataScope(filters.userId, filters.userRole || 'user');
    if (resolved.filter) conditions.push(resolved.filter);
    scope = scopeLabelsOf(resolved);
  }
  if (filters?.factoryId || filters?.workshopId) {
    conditions.push(inArray(productInspections.machineId, machineIdsInHierarchySubquery(db, {
      factoryId: filters.factoryId,
      workshopId: filters.workshopId,
    })));
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // panelBase = whereClause AND has a real panel serial.
  const hasPanel = sql`${productInspections.panelSerial} IS NOT NULL AND ${productInspections.panelSerial} <> ''`;
  const panelBase = whereClause ? sql`(${whereClause}) AND ${hasPanel}` : hasPanel;

  const [boardResult, boardFpyResult, panelYieldResult, panelFpyResult, noPanelResult] = await Promise.all([
    // Board-level counts over the whole slice.
    db.select({
      total: sql<number>`count(*)`,
      ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
      ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
    }).from(productInspections).where(whereClause),
    // Board true FPY (first inspection per serial), same helper as the dashboard.
    db.execute(fpyAggregateSql({ where: whereClause })),
    // Panel final yield: one row per panel, NG if any board NG.
    db.execute(sql`
      SELECT
        COUNT(*)::int AS panel_total,
        COUNT(*) FILTER (WHERE panel_has_ng)::int AS panel_ng
      FROM (
        SELECT ${productInspections.panelSerial} AS panel_serial,
               BOOL_OR(${productInspections.overallResult} = 'NG') AS panel_has_ng
        FROM ${productInspections}
        WHERE ${panelBase}
        GROUP BY ${productInspections.panelSerial}
      ) AS panels
    `),
    // Panel FPY: first inspection per board (panelSerial, boardIndex); panel
    // first-passes iff every one of its boards' first inspection was OK.
    db.execute(sql`
      SELECT
        COUNT(*)::int AS panel_first_total,
        COUNT(*) FILTER (WHERE panel_all_ok)::int AS panel_first_pass
      FROM (
        SELECT panel_serial, BOOL_AND(result = 'OK') AS panel_all_ok
        FROM (
          SELECT DISTINCT ON (${productInspections.panelSerial}, COALESCE(${productInspections.boardIndex}, 1))
                 ${productInspections.panelSerial} AS panel_serial,
                 ${productInspections.overallResult} AS result
          FROM ${productInspections}
          WHERE ${panelBase}
          ORDER BY ${productInspections.panelSerial}, COALESCE(${productInspections.boardIndex}, 1), ${productInspections.inspectionTime} ASC, ${productInspections.id} ASC
        ) AS first_boards
        GROUP BY panel_serial
      ) AS panels
    `),
    // Boards with no panel (single-board / legacy), for transparency.
    db.execute(
      whereClause
        ? sql`SELECT COUNT(*)::int AS c FROM ${productInspections} WHERE (${whereClause}) AND (${productInspections.panelSerial} IS NULL OR ${productInspections.panelSerial} = '')`
        : sql`SELECT COUNT(*)::int AS c FROM ${productInspections} WHERE ${productInspections.panelSerial} IS NULL OR ${productInspections.panelSerial} = ''`,
    ),
  ]);

  const b = boardResult[0] || { total: 0, ok: 0, ng: 0, ntf: 0 };
  const boardTotal = Number(b.total) || 0;
  const boardOk = Number(b.ok) || 0;
  const boardNg = Number(b.ng) || 0;
  const boardNtf = Number(b.ntf) || 0;

  const bFpy = executeRows(boardFpyResult)[0] || {};
  const boardFirstTotal = Number(bFpy.first_total) || 0;
  const boardFirstPass = Number(bFpy.first_pass) || 0;

  const py = executeRows(panelYieldResult)[0] || {};
  const panelTotal = Number(py.panel_total) || 0;
  const panelNg = Number(py.panel_ng) || 0;
  const panelPass = panelTotal - panelNg;

  const pf = executeRows(panelFpyResult)[0] || {};
  const panelFirstTotal = Number(pf.panel_first_total) || 0;
  const panelFirstPass = Number(pf.panel_first_pass) || 0;

  const boardsWithoutPanel = Number(executeRows(noPanelResult)[0]?.c) || 0;

  return {
    boardTotal, boardOk, boardNg, boardNtf,
    boardYieldRate: roundPct(finalYield({ ok: boardOk, ntf: boardNtf, total: boardTotal }), 2),
    boardFpy: roundPct(fpyFromFirstInspections({ firstPass: boardFirstPass, firstTotal: boardFirstTotal }), 2),
    boardFirstPass, boardFirstTotal,
    panelTotal, panelPass, panelNg,
    // Panel final yield: passing panels / total panels.
    panelYieldRate: panelTotal > 0 ? roundPct((panelPass / panelTotal) * 100, 2) : 0,
    panelFpy: roundPct(fpyFromFirstInspections({ firstPass: panelFirstPass, firstTotal: panelFirstTotal }), 2),
    panelFirstPass, panelFirstTotal,
    boardsWithoutPanel,
    // ⚠ `...scope` = ĐÚNG BA ô nhãn. KHÔNG bao giờ `...resolved` (kéo theo `filter` có vòng).
    ...scope,
  };
}

// ============ SHIFT STATS ============
/**
 * Resolve a factory id → its code (product_inspections stores factoryCode, a
 * varchar, not the id). Returns undefined when the factory is unknown.
 */
async function resolveFactoryCode(db: Db, factoryId: number): Promise<string | undefined> {
  const [f] = await db
    .select({ code: factories.code })
    .from(factories)
    .where(eq(factories.id, factoryId))
    .limit(1);
  return f?.code;
}

/**
 * Per-shift yield/NG/output for the Dashboard shift card.
 *
 * Doc 32 Wave R1 (decision #3): shifts are now driven by the factory's
 * `shift_configs` windows (2, 3 or N shifts, custom hours, wrap-aware) instead
 * of the old hardcoded 6-14 / 14-22 / 22-6 buckets. When a factory has no
 * applicable shift_configs the legacy hour buckets (morning/afternoon/night)
 * are used so the card + its icons still render.
 *
 * `factoryId` now BOTH scopes the data (was previously accepted but ignored)
 * AND selects the shift windows — so a factory-scoped card shows that factory's
 * own shifts over its own data. Shape stays backward-compatible (adds a
 * `shiftWindow` field; existing shift/shiftName/total/ok/ng/ntf/fpy/finalYield
 * preserved). FPY per shift = true FPY of boards whose FIRST inspection fell in
 * the shift (canonical, decision #4).
 */
export interface ShiftStatsRow {
  shift: string;
  shiftName: string;
  /** Factory-local window "HH:MM-HH:MM". */
  shiftWindow: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  /** Wire name kept for the frontend; VALUE is true FPY (decision #4). */
  fpy: number;
  finalYield: number;
}

export async function getShiftStats(filters?: {
  factoryId?: number;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: string;
}): Promise<ScopedRows<ShiftStatsRow>> {
  const db = await getDb();
  // ⚠ Kể cả nhánh "không có CSDL" cũng phải mang nhãn, nếu không một mảng rỗng ở đây lại thành
  // số 0 im lặng — đúng lớp lỗi bản vá này đi xoá.
  if (!db) return withScopeLabels<ShiftStatsRow>([], UNSCOPED_LABELS);

  const conditions: SQL[] = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Factory scope: filter data to the factory AND drive the shift windows.
  if (filters?.factoryId) {
    const factoryCode = await resolveFactoryCode(db, filters.factoryId);
    if (factoryCode) conditions.push(eq(productInspections.factoryCode, factoryCode));
  }

  // Access filter by user assignments — khuôn nhãn dùng chung.
  let scope: ScopeLabels = UNSCOPED_LABELS;
  if (filters?.userId && filters?.userRole !== 'admin') {
    const { resolveDataScope } = await import("../_core/accessControl");
    const resolved = await resolveDataScope(filters.userId, filters.userRole || 'user');
    if (resolved.filter) conditions.push(resolved.filter);
    scope = scopeLabelsOf(resolved);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Real shift windows from shift_configs (fallback: legacy hour buckets).
  const configs = await getApplicableShiftConfigs(db, filters?.factoryId);
  const { expr: shiftExpr, metas } = buildShiftClassifierSql(configs, productInspections.inspectionTime);
  const metaByCode = new Map<string, ShiftWindowMeta>(metas.map((m) => [m.code, m]));
  const orderByCode = new Map<string, number>(metas.map((m) => [m.code, m.orderIndex]));

  const [result, fpyResult] = await Promise.all([
    db.select({
      shift: shiftExpr.as('shift'),
      total: sql<number>`count(*)`.as('total'),
      ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`.as('ok'),
      ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`.as('ng'),
      ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`.as('ntf'),
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(sql`shift`),
    // True FPY per shift: a board belongs to the shift of its FIRST inspection.
    db.execute(fpyAggregateSql({ where: whereClause, bucketExpr: shiftExpr, groupBy: 'bucket' })),
  ]);

  const fpyByShift = new Map<string, { firstPass: number; firstTotal: number }>(
    executeRows(fpyResult).map((r: any) => [String(r.bucket), {
      firstPass: Number(r.first_pass) || 0,
      firstTotal: Number(r.first_total) || 0,
    }]),
  );

  const rows: ShiftStatsRow[] = result.map(r => {
    const code = String(r.shift);
    const meta = metaByCode.get(code) ?? UNASSIGNED_SHIFT;
    const total = Number(r.total) || 0;
    const ok = Number(r.ok) || 0;
    const ntf = Number(r.ntf) || 0;
    const firsts = fpyByShift.get(code) || { firstPass: 0, firstTotal: 0 };
    return {
      shift: code,
      shiftName: meta.name,
      // Additive: factory-local window "HH:MM-HH:MM" of this shift.
      shiftWindow: meta.window,
      total,
      ok,
      ng: Number(r.ng) || 0,
      ntf,
      // Wire name kept for the frontend; VALUE is true FPY (decision #4).
      fpy: roundPct(fpyFromFirstInspections(firsts), 1),
      // Canonical final yield (NTF = pass) exposed alongside.
      finalYield: roundPct(finalYield({ ok, ntf, total }), 1),
    };
  });

  // Stable order: configured shift order, unassigned last.
  rows.sort(
    (a, b) =>
      (orderByCode.get(a.shift) ?? UNASSIGNED_SHIFT.orderIndex) -
        (orderByCode.get(b.shift) ?? UNASSIGNED_SHIFT.orderIndex) ||
      a.shift.localeCompare(b.shift),
  );
  // Nhãn đính lên chính mảng (không đổi hình dạng) — xem `withScopeLabels`.
  return withScopeLabels(rows, scope);
}

// ============ SHIFT REPORT ============
export interface ShiftReportRow {
  shift: string;
  shiftName: string;
  /** Factory-local window "HH:MM-HH:MM". */
  shiftWindow: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  /** Total inspections (output) in the shift. */
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  /** Canonical final yield % (NTF counts as pass). */
  yieldPct: number;
  /** True first-pass yield % (board's first inspection). */
  fpy: number;
  /** Distinct machines that produced inspections in the shift. */
  machinesActive: number;
  /** Distinct defect categories seen among failed measurement points. */
  defectTypeCount: number;
  /** Which resolution tier produced the shift attribution. */
  source: "config" | "fallback";
}

/**
 * Per-shift rollup over a date range, suitable for a "shift report"
 * (feeds R3/R4). One row per configured shift (zero-filled when the shift had
 * no output), ordered by shift order, plus an "unassigned" row only when data
 * fell outside every configured window.
 *
 * Shift attribution uses the factory's shift_configs windows (decision #3 tier
 * 2); the production_sessions-preferred tier is available row-level via
 * resolveShiftForInspections — the aggregate stays window-based for scale
 * (sessions are sparse; a per-row correlated session lookup over the inspection
 * hypertable is not worth it here).
 */
export type ShiftReportFilters = {
  factoryId?: number;
  lineId?: number;
  startDate?: Date;
  endDate?: Date;
} & (
  | { userId?: number; userRole?: string; tenantScope?: never }
  /**
   * ★★★ 2026-08-18 — TRỤC PHẠM VI THỨ HAI: mã tenant TƯỜNG MINH của một khoá API (mig 0325).
   * Loại trừ trục danh tính ở mức KIỂU — xem `ReportRollupFilters` ở `db/reportAggregators.ts`
   * cho lý lẽ đầy đủ (`api_keys.createdBy` NULLable ⇒ mượn danh tính người tạo là sai ngữ nghĩa).
   */
  | { tenantScope: TenantCodeScope; userId?: never; userRole?: never }
);

export async function getShiftReport(filters?: ShiftReportFilters): Promise<ScopedRows<ShiftReportRow>> {
  const db = await getDb();
  if (!db) return withScopeLabels<ShiftReportRow>([], UNSCOPED_LABELS);

  const conditions: SQL[] = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  if (filters?.factoryId) {
    const factoryCode = await resolveFactoryCode(db, filters.factoryId);
    if (factoryCode) conditions.push(eq(productInspections.factoryCode, factoryCode));
  }
  if (filters?.lineId) {
    const [l] = await db
      .select({ code: productionLines.code })
      .from(productionLines)
      .where(eq(productionLines.id, filters.lineId))
      .limit(1);
    if (l?.code) conditions.push(eq(productInspections.lineCode, l.code));
  }

  // Khuôn nhãn dùng chung (xem docblock trên `PanelYieldStats`).
  let scope: ScopeLabels = UNSCOPED_LABELS;
  if (filters?.tenantScope) {
    // ★ TRỤC ②. Hỏi TRƯỚC trục ① có chủ đích: kiểu đã cấm hai trục cùng có mặt, nên thứ tự này
    //   chỉ quan sát được từ một lời gọi đã ép kiểu — và lời gọi ấy phải rơi về phía THU HẸP.
    //
    // ⚠ VÌ SAO KHÔNG DỰA VÀO `filters.factoryId` Ở TRÊN. Nhánh ấy fail-OPEN theo cấu tạo
    //   (`if (factoryCode) …` — mã không tra được thì KHÔNG có mệnh đề nào được thêm), và nó chỉ
    //   so `factoryCode`, bỏ qua `corporateCode`. Với một khoá khai CẢ HAI mã, dựa vào nó sẽ
    //   NỚI phạm vi so với `inspectionTenantFilter`. Vị từ dưới đây là ĐÚNG cùng phép AND ấy.
    conditions.push(tenantCodeInspectionFilter(filters.tenantScope));
    scope = { scopeApplied: true, scopeEmptyReason: null, scopeMessage: null };
  } else if (filters?.userId && filters?.userRole !== 'admin') {
    const { resolveDataScope } = await import("../_core/accessControl");
    const resolved = await resolveDataScope(filters.userId, filters.userRole || 'user');
    if (resolved.filter) conditions.push(resolved.filter);
    scope = scopeLabelsOf(resolved);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const configs = await getApplicableShiftConfigs(db, filters?.factoryId);
  const { expr: shiftExpr, metas, isFallback } = buildShiftClassifierSql(configs, productInspections.inspectionTime);
  const source: "config" | "fallback" = isFallback ? "fallback" : "config";

  const [result, fpyResult, defectResult] = await Promise.all([
    db.select({
      shift: shiftExpr.as('shift'),
      total: sql<number>`count(*)`.as('total'),
      ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`.as('ok'),
      ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`.as('ng'),
      ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`.as('ntf'),
      machinesActive: sql<number>`count(distinct ${productInspections.machineId})`.as('machines_active'),
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(sql`shift`),
    db.execute(fpyAggregateSql({ where: whereClause, bucketExpr: shiftExpr, groupBy: 'bucket' })),
    // Distinct defect categories per shift among FAILED measurement points.
    db.select({
      shift: shiftExpr.as('shift'),
      defectTypes: sql<number>`count(distinct ${defectCatalog.category})`.as('defect_types'),
    })
    .from(productInspections)
    .innerJoin(measurementResults, eq(measurementResults.inspectionId, productInspections.id))
    .innerJoin(defectCatalog, eq(defectCatalog.id, measurementResults.defectCatalogId))
    .where(whereClause ? and(whereClause, sql`${measurementResults.result} <> 'OK'`) : sql`${measurementResults.result} <> 'OK'`)
    .groupBy(sql`shift`),
  ]);

  const fpyByShift = new Map<string, { firstPass: number; firstTotal: number }>(
    executeRows(fpyResult).map((r: any) => [String(r.bucket), {
      firstPass: Number(r.first_pass) || 0,
      firstTotal: Number(r.first_total) || 0,
    }]),
  );
  const defectByShift = new Map<string, number>(
    defectResult.map((r: any) => [String(r.shift), Number(r.defectTypes) || 0]),
  );
  const dataByShift = new Map<string, typeof result[number]>(
    result.map((r) => [String(r.shift), r]),
  );

  // One row per configured shift (zero-filled), plus any extra codes present in
  // the data (e.g. "unassigned").
  const codes = [...new Set([...metas.map((m) => m.code), ...dataByShift.keys()])];
  const metaByCode = new Map<string, ShiftWindowMeta>(metas.map((m) => [m.code, m]));

  const rows: ShiftReportRow[] = codes.map((code) => {
    const meta = metaByCode.get(code) ?? UNASSIGNED_SHIFT;
    const r = dataByShift.get(code);
    const total = Number(r?.total) || 0;
    const ok = Number(r?.ok) || 0;
    const ng = Number(r?.ng) || 0;
    const ntf = Number(r?.ntf) || 0;
    const firsts = fpyByShift.get(code) || { firstPass: 0, firstTotal: 0 };
    return {
      shift: code,
      shiftName: meta.name,
      shiftWindow: meta.window,
      startHour: meta.startHour,
      startMinute: meta.startMinute,
      endHour: meta.endHour,
      endMinute: meta.endMinute,
      total,
      ok,
      ng,
      ntf,
      yieldPct: roundPct(finalYield({ ok, ntf, total }), 1),
      fpy: roundPct(fpyFromFirstInspections(firsts), 1),
      machinesActive: Number(r?.machinesActive) || 0,
      defectTypeCount: defectByShift.get(code) || 0,
      source,
    };
  });

  rows.sort(
    (a, b) =>
      (metaByCode.get(a.shift)?.orderIndex ?? UNASSIGNED_SHIFT.orderIndex) -
        (metaByCode.get(b.shift)?.orderIndex ?? UNASSIGNED_SHIFT.orderIndex) ||
      a.shift.localeCompare(b.shift),
  );
  return withScopeLabels(rows, scope);
}

// ============ TOP/BOTTOM MACHINES ============
export async function getTopBottomMachines(filters?: {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  // doc65 W1 (additive optional) — scope trục ISA-95; no-op khi không truyền.
  factoryId?: number;
  userId?: number;
  userRole?: string;
}) {
  const db = await getDb();
  if (!db) return { top: [], bottom: [], ...UNSCOPED_LABELS };

  const conditions: SQL[] = [];
  if (filters?.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters?.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  // doc65 W1 — hierarchy filter, cùng subquery pattern như getDashboardStats (gap B3).
  if (filters?.factoryId) {
    conditions.push(inArray(productInspections.machineId, machineIdsInHierarchySubquery(db, {
      factoryId: filters.factoryId,
    })));
  }

  // Access filter by user assignments — khuôn nhãn dùng chung.
  let scope: ScopeLabels = UNSCOPED_LABELS;
  if (filters?.userId && filters?.userRole !== 'admin') {
    const { resolveDataScope } = await import("../_core/accessControl");
    const resolved = await resolveDataScope(filters.userId, filters.userRole || 'user');
    if (resolved.filter) conditions.push(resolved.filter);
    scope = scopeLabelsOf(resolved);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = filters?.limit || 5;

  const [result, fpyResult] = await Promise.all([
    db.select({
      machineId: productInspections.machineId,
      total: sql<number>`count(*)`,
      ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)`,
      ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)`,
      ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.machineId)
    .having(sql`count(*) > 0`),
    // True FPY per machine: first inspection per (machine, serial).
    db.execute(fpyAggregateSql({ where: whereClause, groupBy: 'machine' })),
  ]);

  const fpyByMachine = new Map<number, { firstPass: number; firstTotal: number }>(
    executeRows(fpyResult).map((r: any) => [Number(r.machine_id), {
      firstPass: Number(r.first_pass) || 0,
      firstTotal: Number(r.first_total) || 0,
    }]),
  );

  // Get machine details
  const machineDetails = await db.select().from(machines);
  const machineMap = new Map(machineDetails.map(m => [m.id, m]));

  const machinesWithStats = result.map(r => {
    const machine = machineMap.get(r.machineId!);
    const total = Number(r.total) || 0;
    const ok = Number(r.ok) || 0;
    const ntf = Number(r.ntf) || 0;
    const firsts = fpyByMachine.get(Number(r.machineId));
    const finalYieldPct = finalYield({ ok, ntf, total });
    // Wire name `fpy` kept; VALUE is now true FPY. If a machine has no
    // usable serials (all empty), fall back to final yield so the ranking
    // stays meaningful — documented limitation, see utils/kpi.ts.
    const fpy = firsts && firsts.firstTotal > 0
      ? fpyFromFirstInspections(firsts)
      : finalYieldPct;
    return {
      id: r.machineId,
      name: machine?.name || 'Unknown',
      code: machine?.code || '',
      total,
      ok: Number(r.ok) || 0,
      ng: Number(r.ng) || 0,
      ntf,
      fpy: roundPct(fpy, 1),
      finalYield: roundPct(finalYieldPct, 1),
    };
  });

  // Sort by FPY for top/bottom
  const sorted = [...machinesWithStats].sort((a, b) => b.fpy - a.fpy);
  
  return {
    top: sorted.slice(0, limit),
    bottom: sorted.slice(-limit).reverse(),
    // ⚠ BA ô nhãn, KHÔNG phải `...resolved` — xem docblock trên `PanelYieldStats`.
    ...scope,
  };
}

// ============ ACTIVE ALERTS COUNT ============
export async function getActiveAlertsCount() {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.select({
    count: sql<number>`count(*)`,
  })
  .from(alertHistory)
  .where(sql`${alertHistory.acknowledgedAt} IS NULL`);

  return Number(result[0]?.count) || 0;
}

// ============ OVERVIEW ENTITY COUNTS (doc 67 W6, việc 4) ============
// CorporateDashboard only needs the REGISTRY sizes for its KPI cards — it was
// fetching factory.list + line.list + machine.list in full just to read .length.
// One COUNT(*) round-trip instead; filters mirror the list procedures exactly
// (getFactories / getProductionLines / getMachines all filter isActive = true —
// soft-deletes on these tables are isActive=false tombstones), so the numbers
// match what the lists would have counted.
export async function getOverviewEntityCounts() {
  const db = await getDb();
  if (!db) return { factories: 0, lines: 0, machines: 0 };

  const [result] = await db.select({
    factories: sql<number>`(SELECT count(*) FROM ${factories} WHERE ${factories.isActive} = true)`,
    lines: sql<number>`(SELECT count(*) FROM ${productionLines} WHERE ${productionLines.isActive} = true)`,
    machines: sql<number>`(SELECT count(*) FROM ${machines} WHERE ${machines.isActive} = true)`,
  }).from(sql`(SELECT 1) AS one`);

  return {
    factories: Number(result?.factories) || 0,
    lines: Number(result?.lines) || 0,
    machines: Number(result?.machines) || 0,
  };
}

// ============ DAILY STATS ============
/**
 * ★★★ 2026-08-18 — `factoryId`/`workshopId` HẾT LÀ THAM SỐ CHẾT.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐÃ VÁ — **KHÔNG PHẢI RÒ, LÀ SAI SỐ**, và nó nguy hiểm theo một kiểu khác
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai tham số này được **nhận vào rồi im lặng bỏ qua**. `resolveStatsScope` vẫn áp phạm vi nên
 * không ai đọc được dữ liệu ngoài phần mình — nhưng một người được gán **N nhà máy**, bấm chọn
 * nhà máy A, nhận về **số của cả N nhà máy TRỘN LẪN, dán nhãn A**.
 *
 * ⚠ Một tham số nhận vào rồi bỏ qua nguy hiểm hơn KHÔNG CÓ tham số: nơi gọi TIN nó hoạt động, và
 * cả ba nơi gọi đều tin — `Dashboard.tsx` (trục ISA-95, chú thích *"sparkline theo trục phạm
 * vi"*), `Reports.tsx` (dropdown nhà máy), và `dashboardStatsRouters` còn đưa `factoryId` vào
 * **KHOÁ NHỚ ĐỆM**, tức giữ hai bản ghi khác khoá mà nội dung hệt nhau.
 *
 * ⇒ Chọn **THỰC HIỆN** phép lọc (không phải gỡ tham số): hai nơi gọi có bộ chọn nhà máy THẬT do
 * người dùng bấm, nên gỡ đi là lấy mất một tính năng người dùng đang trông thấy. Đây cũng đúng
 * tiền lệ của chính file này — `getDashboardStats` đã trả đúng món nợ này ở doc 27 gap B3
 * (*"workshopId was previously a DEAD parameter (accepted, silently ignored); it now actually
 * filters"*) và để lại sẵn `machineIdsInHierarchySubquery`; dùng lại nó, không dựng cơ chế thứ hai.
 *
 * ⚠⚠ BỘ LỌC NÀY CHỈ **THU HẸP**, KHÔNG BAO GIỜ **NỚI**. Nó được `AND` vào SAU vị từ của
 * `resolveStatsScope`, không thay thế vị từ ấy: người gán nhà máy A chọn xem B ⇒ **rỗng**, chứ
 * KHÔNG phải thấy B. `statisticsDailyScope.test.ts` §2 canh đúng chiều đó bằng CSDL thật.
 *
 * ⚠ Ngữ nghĩa cạnh, giữ y hệt `getDashboardStats` (cố ý, không phải bỏ sót): truy vấn con KHÔNG
 * lọc `isActive` ở bất kỳ mức nào — lịch sử của máy đã ngừng dùng vẫn phải cộng vào nhà máy của
 * nó; và một nhà máy phân giải ra 0 máy trả về **0 một cách trung thực**, không âm thầm rơi về
 * "toàn hệ thống".
 */
export async function getDailyStats(
  factoryId?: number,
  workshopId?: number,
  days: number = 30,
  scope?: StatsScopeArgs,
): Promise<ScopedRows<{
  date: string;
  totalProducts: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  fpy: number;
  finalYield: number;
}>> {
  const db = await getDb();
  if (!db) return withScopeLabels([], UNSCOPED_LABELS);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  // Use parameterized Drizzle query (safe from SQL injection).
  // Day buckets are computed in the FACTORY timezone (gap A2).
  const dayBucket = factoryDayTextSql(productInspections.inspectionTime);
  // Trục phạm vi — khuôn dùng chung. Truy vấn này KHÔNG đặt bí danh (`FROM ${productInspections}`
  // sinh ra tên bảng đầy đủ) nên `filter` nhét thẳng được, không cần cổng bán-nối.
  const { filter, labels } = await resolveStatsScope(scope);
  // ⚠ THỨ TỰ CÓ NGHĨA: `filter` (phạm vi của TÀI KHOẢN) và `hierarchy` (lựa chọn của NGƯỜI DÙNG)
  // đều là mệnh đề `AND`. Cái sau chỉ thu hẹp thêm bên trong cái trước — không có nhánh nào bỏ
  // qua `filter` khi có `factoryId`, và đó chính là chỗ một bản vá cẩu thả biến sai-số thành RÒ.
  //
  // ⚠ CỔNG `factoryId || workshopId` KHÔNG PHẢI TỐI ƯU VẶT — nó là thứ giữ cho bán-nối này không
  //   bao giờ có cơ hội LÀM MẤT hàng. Đột biến bỏ cổng (luôn áp bán-nối) ĐÃ CHẠY ngày 2026-08-18
  //   và **SỐNG SÓT** qua cả 156 ca; đã truy tới cùng thay vì ghi "lưới thủng": nó sống vì đúng là
  //   TƯƠNG ĐƯƠNG hôm nay — cả bốn mức đều `notNull` + FK `ON DELETE RESTRICT`
  //   (`product_inspections.machineId`→`machines.stationId`→`stations.lineId`→
  //   `production_lines.workshopId`), nên mọi bản ghi kiểm đều đi hết được chuỗi join. ĐO trên
  //   `aoi_management` cùng ngày: **0/22.996** bản ghi nằm ngoài chuỗi, và FK trỏ ra khỏi
  //   hypertable vẫn còn sống (`pg_constraint` = 1 — chiều này Postgres cho phép, khác chiều trỏ
  //   VÀO hypertable đã đẻ ra 383 kết quả đo mồ côi ở đợt trước).
  // ⇒ Tương đương HÔM NAY, không phải mãi mãi: nếu ai đó bỏ `notNull`/FK ở bất kỳ mức nào, bán-nối
  //   vô điều kiện sẽ âm thầm nuốt hàng. Cổng dưới đây làm điều đó KHÔNG THỂ xảy ra, và nó cũng
  //   tránh khoản ~2× của bán-nối (đã đo bằng `EXPLAIN ANALYZE`, xem `scopeGateOnAlias`).
  const hierarchy =
    factoryId || workshopId
      ? inArray(productInspections.machineId, machineIdsInHierarchySubquery(db, { factoryId, workshopId }))
      : undefined;
  const dieuKien: SQL[] = [sql`${productInspections.inspectionTime} >= ${startDate.toISOString()}`];
  if (filter) dieuKien.push(filter);
  if (hierarchy) dieuKien.push(hierarchy);
  // ⚠ `and(...)` chắc chắn không trả `undefined` (mảng luôn có ≥1 phần tử là mốc thời gian).
  const whereClause = and(...dieuKien)!;
  const [result, fpyResult] = await Promise.all([
    db.execute(sql`
    SELECT
      ${dayBucket} as date,
      COUNT(*) as "totalProducts",
      SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END) as "okCount",
      SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END) as "ngCount",
      SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END) as "ntfCount"
    FROM ${productInspections}
    WHERE ${whereClause}
    GROUP BY 1
    ORDER BY date DESC
  `),
    // Doc 27 Đợt 5 / W5-E (Đợt-1.4 leftover): canonical per-day KPIs so the
    // dashboard sparkline stops computing "(ok+ntf)/total" client-side and
    // mislabelling it FPY. True FPY = first inspection per serial per day
    // (same fpyAggregateSql pattern as getHourlyStats).
    db.execute(fpyAggregateSql({ where: whereClause, bucketExpr: dayBucket, groupBy: "bucket" })),
  ]);

  const fpyByDay = new Map<string, { firstPass: number; firstTotal: number }>(
    executeRows(fpyResult).map((r: any) => [String(r.bucket), {
      firstPass: Number(r.first_pass) || 0,
      firstTotal: Number(r.first_total) || 0,
    }]),
  );

  const rows = Array.isArray(result) ? result : (result as any).rows || [];
  return withScopeLabels(rows.map((r: any) => {
    const totalProducts = Number(r.totalProducts) || 0;
    const okCount = Number(r.okCount) || 0;
    const ntfCount = Number(r.ntfCount) || 0;
    const firsts = fpyByDay.get(String(r.date)) || { firstPass: 0, firstTotal: 0 };
    return {
      date: String(r.date),
      totalProducts,
      okCount,
      ngCount: Number(r.ngCount) || 0,
      ntfCount,
      // Canonical true FPY (decision #4); 0 when no usable serials that day.
      fpy: roundPct(fpyFromFirstInspections(firsts), 2),
      // Canonical final yield (NTF = pass).
      finalYield: roundPct(finalYield({ ok: okCount, ntf: ntfCount, total: totalProducts }), 2),
    };
  }), labels);
}

// ============ HOURLY STATS ============
export async function getHourlyStats(filters?: {
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  machineId?: number;
  hours?: number;
} & StatsScopeArgs): Promise<ScopedRows<{
  hour: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  fpy: string;
  fy: string;
  ntfy: string;
}>> {
  const db = await getDb();
  if (!db) return withScopeLabels([], UNSCOPED_LABELS);

  const hoursBack = filters?.hours || 24;
  const startDate = new Date();
  startDate.setHours(startDate.getHours() - hoursBack);

  // Build conditions array (parameterized, safe from SQL injection)
  const conditions: SQL[] = [sql`${productInspections.inspectionTime} >= ${startDate.toISOString()}`];
  if (filters?.machineId) {
    conditions.push(sql`${productInspections.machineId} = ${filters.machineId}`);
  }
  // Trục phạm vi — truy vấn KHÔNG đặt bí danh, `filter` nhét thẳng được.
  const { filter, labels } = await resolveStatsScope(filters);
  if (filter) conditions.push(filter);
  const whereClause = sql.join(conditions, sql` AND `);

  // Hour buckets in the FACTORY timezone (gap A2).
  const hourBucket = factoryHourTextSql(productInspections.inspectionTime);
  const [result, fpyResult] = await Promise.all([
    db.execute(sql`
      SELECT
        ${hourBucket} as hour,
        COUNT(*) as "totalProducts",
        SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END) as "okCount",
        SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END) as "ngCount",
        SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END) as "ntfCount"
      FROM ${productInspections}
      WHERE ${whereClause}
      GROUP BY 1
      ORDER BY hour ASC
    `),
    // True FPY per hour: a board counts in the bucket of its FIRST inspection.
    db.execute(fpyAggregateSql({ where: whereClause, bucketExpr: hourBucket, groupBy: 'bucket' })),
  ]);

  const fpyByHour = new Map<string, { firstPass: number; firstTotal: number }>(
    executeRows(fpyResult).map((r: any) => [String(r.bucket), {
      firstPass: Number(r.first_pass) || 0,
      firstTotal: Number(r.first_total) || 0,
    }]),
  );

  const rows = Array.isArray(result) ? result : (result as any).rows || [];
  return withScopeLabels(rows.map((r: any) => {
    const total = Number(r.totalProducts) || 1;
    const ok = Number(r.okCount) || 0;
    const ng = Number(r.ngCount) || 0;
    const ntf = Number(r.ntfCount) || 0;
    const firsts = fpyByHour.get(String(r.hour)) || { firstPass: 0, firstTotal: 0 };
    return {
      hour: String(r.hour),
      total,
      ok,
      ng,
      ntf,
      // Wire names/types kept (strings). VALUES fixed per decision #4:
      //   fpy  = true First Pass Yield (was ok/total),
      //   fy   = FINAL yield, NTF counts as pass (was the NG rate!),
      //   ntfy = NTF rate (unchanged).
      fpy: fpyFromFirstInspections(firsts).toFixed(1),
      fy: finalYield({ ok, ntf, total }).toFixed(1),
      ntfy: ((ntf / total) * 100).toFixed(1),
    };
  }), labels);
}

// ============ SEARCH INSPECTIONS ============
export async function searchInspections(params: {
  factoryCode?: string;
  workshopCode?: string;
  lineCode?: string;
  stationCode?: string;
  machineCode?: string;
  serialNumber?: string;
  productModel?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  userId?: number;
  userRole?: string;
  // W7-B (doc 27 V3): "ntfScore" pre-sorts the operator verify queue by
  // suspected-false-call likelihood (DESC NULLS LAST — unscored rows keep
  // newest-first order at the tail). Default stays newest-first.
  sortBy?: "time" | "ntfScore";
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0, ...UNSCOPED_LABELS };

  // Hierarchy filter (doc 27 gap B3): ONE machineId IN (subquery) instead of
  // up to 6 sequential round-trips (factories→workshops→lines→stations→machines
  // + per-level LIKE intersections). Preserved semantics: `machineCode` still
  // OVERRIDES the other hierarchy filters (old `if/else if` shape); "no machine
  // matches" still yields { data: [], total: 0 } (now simply because the IN-set
  // is empty). Deliberate fix: a code filter that matches nothing at some level
  // is no longer silently dropped (the old intersect chain could fall through
  // and return UNFILTERED rows, e.g. nonexistent factoryCode + valid
  // workshopCode ignored the factory).
  const conditions = [];
  if (params.machineCode) {
    conditions.push(inArray(
      productInspections.machineId,
      db.select({ id: machines.id }).from(machines)
        .where(like(machines.code, `%${params.machineCode}%`)),
    ));
  } else if (params.stationCode || params.lineCode || params.workshopCode || params.factoryCode) {
    const hierarchyConditions: SQL[] = [];
    if (params.factoryCode) hierarchyConditions.push(like(factories.code, `%${params.factoryCode}%`));
    if (params.workshopCode) hierarchyConditions.push(like(workshops.code, `%${params.workshopCode}%`));
    if (params.lineCode) hierarchyConditions.push(like(productionLines.code, `%${params.lineCode}%`));
    if (params.stationCode) hierarchyConditions.push(like(stations.code, `%${params.stationCode}%`));
    conditions.push(inArray(
      productInspections.machineId,
      db.select({ id: machines.id }).from(machines)
        .innerJoin(stations, eq(machines.stationId, stations.id))
        .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
        .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
        .innerJoin(factories, eq(workshops.factoryId, factories.id))
        .where(and(...hierarchyConditions)),
    ));
  }

  if (params.serialNumber) conditions.push(like(productInspections.serialNumber, `%${params.serialNumber}%`));
  if (params.productModel) conditions.push(like(productInspections.productModel, `%${params.productModel}%`));
  if (params.result) conditions.push(eq(productInspections.overallResult, params.result));
  if (params.startDate) conditions.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) conditions.push(lte(productInspections.inspectionTime, params.endDate));

  // Apply access control for non-admin users — khuôn nhãn dùng chung.
  let scope: ScopeLabels = UNSCOPED_LABELS;
  if (params.userId && params.userRole !== 'admin') {
    const { resolveDataScope } = await import("../_core/accessControl");
    const resolved = await resolveDataScope(params.userId, params.userRole || 'user');
    if (resolved.filter) conditions.push(resolved.filter);
    scope = scopeLabelsOf(resolved);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // W7-B (V3): partial index idx_inspections_ntf_score covers the scored rows.
  const orderBy = params.sortBy === "ntfScore"
    ? [sql`${productInspections.ntfScore} DESC NULLS LAST`, desc(productInspections.inspectionTime)]
    : [desc(productInspections.inspectionTime)];

  const [data, countResult] = await Promise.all([
    // Projected hot-path read (gap B9) — History/QualityHome/SupervisorHome
    // list views; heavy json/text detail columns stay on inspection.getById.
    db.select(inspectionListProjection).from(productInspections)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.limit || 50)
      .offset(params.offset || 0),
    db.select({ count: sql<number>`count(*)` }).from(productInspections).where(whereClause)
  ]);

  // ⚠ `...scope` = BA ô nhãn. `filter` sống ở `conditions`, KHÔNG bao giờ trong đối tượng này.
  return { data, total: countResult[0]?.count || 0, ...scope };
}

// ============ TOP NG MEASUREMENT POINTS ============
export interface TopNGMeasurementPoint {
  pointDefId: number;
  code: string;
  name: string;
  productModelId: number | null;
  productCode: string | null;
  productName: string | null;
  ngCount: number;
  percentage: number;
}

export async function getTopNGMeasurementPoints(params: {
  machineId?: number;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  userId?: number;
  userRole?: string;
}): Promise<ScopedRows<TopNGMeasurementPoint>> {
  const db = await getDb();
  if (!db) return withScopeLabels<TopNGMeasurementPoint>([], UNSCOPED_LABELS);

  const conditions = [eq(measurementResults.result, 'NG')];

  // Build inspection-level access filter for non-admin users — khuôn nhãn dùng chung.
  const inspectionFilterConditions: SQL[] = [];
  let scope: ScopeLabels = UNSCOPED_LABELS;

  if (params.userId && params.userRole !== 'admin') {
    const { resolveDataScope } = await import("../_core/accessControl");
    const resolved = await resolveDataScope(params.userId, params.userRole || 'user');
    if (resolved.filter) inspectionFilterConditions.push(resolved.filter);
    scope = scopeLabelsOf(resolved);
  }

  if (params.machineId) {
    inspectionFilterConditions.push(eq(productInspections.machineId, params.machineId));
  }

  if (params.startDate) inspectionFilterConditions.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) inspectionFilterConditions.push(lte(productInspections.inspectionTime, params.endDate));

  // If we have any inspection-level filters, pre-fetch matching IDs
  if (inspectionFilterConditions.length > 0) {
    const inspectionIds = await db.select({ id: productInspections.id })
      .from(productInspections)
      .where(and(...inspectionFilterConditions));
    if (inspectionIds.length > 0) {
      conditions.push(inArray(measurementResults.inspectionId, inspectionIds.map(i => i.id)));
    } else {
      // ⚠ Đây LÀ đường mà tài khoản 0 gán nhà máy đi qua (vị từ `1 = 0` ⇒ 0 bản ghi kiểm).
      // Trả mảng rỗng TRẦN ở đây chính là "số 0 im lặng" — phải mang nhãn.
      return withScopeLabels<TopNGMeasurementPoint>([], scope);
    }
  }

  const result = await db.select({
    pointDefId: measurementResults.pointDefId,
    ngCount: sql<number>`count(*)`.as('ng_count'),
  })
    .from(measurementResults)
    .where(and(...conditions))
    .groupBy(measurementResults.pointDefId)
    .orderBy(desc(sql`ng_count`))
    .limit(params.limit || 10);

  // Get point definition details
  const pointDefIds = result.map(r => r.pointDefId);
  if (pointDefIds.length === 0) return withScopeLabels<TopNGMeasurementPoint>([], scope);

  const pointDefs = await db.select({
    id: measurementPointDefs.id,
    code: measurementPointDefs.code,
    name: measurementPointDefs.name,
    productModelId: measurementPointDefs.productModelId,
    productCode: productModels.code,
    productName: productModels.name,
  })
    .from(measurementPointDefs)
    .leftJoin(productModels, eq(measurementPointDefs.productModelId, productModels.id))
    .where(inArray(measurementPointDefs.id, pointDefIds));

  const pointDefMap = new Map(pointDefs.map(p => [p.id, p]));

  // Get total NG count for percentage calculation
  const totalNGResult = await db.select({
    total: sql<number>`count(*)`.as('total'),
  })
    .from(measurementResults)
    .where(and(...conditions));
  const totalNG = totalNGResult[0]?.total || 0;

  const rows: TopNGMeasurementPoint[] = result.map(r => {
    const pointDef = pointDefMap.get(r.pointDefId);
    return {
      pointDefId: r.pointDefId,
      code: pointDef?.code || 'Unknown',
      name: pointDef?.name || 'Unknown',
      productModelId: pointDef?.productModelId || null,
      productCode: pointDef?.productCode || null,
      productName: pointDef?.productName || null,
      ngCount: Number(r.ngCount),
      percentage: totalNG > 0 ? (Number(r.ngCount) / totalNG * 100) : 0,
    };
  });
  return withScopeLabels(rows, scope);
}

// ============ SEED DATA FUNCTIONS ============
export async function seedSampleData() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if data already exists
  const existingFactories = await db.select().from(factories).limit(1);
  if (existingFactories.length > 0) {
    return { message: "Sample data already exists" };
  }

  // Create 3 factories
  const factoryData = [
    { code: "FAC-HN", name: "Nhà máy Hà Nội", address: "Khu CN Thăng Long, Hà Nội", region: "Miền Bắc", country: "Vietnam" },
    { code: "FAC-DN", name: "Nhà máy Đà Nẵng", address: "Khu CN Hòa Khánh, Đà Nẵng", region: "Miền Trung", country: "Vietnam" },
    { code: "FAC-HCM", name: "Nhà máy TP.HCM", address: "Khu CN Tân Bình, TP.HCM", region: "Miền Nam", country: "Vietnam" },
  ];

  const factoryIds: number[] = [];
  for (const factory of factoryData) {
    const [result] = await db.insert(factories).values(factory).returning({ id: factories.id });
    factoryIds.push(result.id);
  }

  // Create 2-4 workshops per factory
  const workshopData = [
    // Hà Nội - 3 workshops
    { factoryId: factoryIds[0], code: "WS-HN-01", name: "Xưởng lắp ráp A", floorArea: "2500" },
    { factoryId: factoryIds[0], code: "WS-HN-02", name: "Xưởng lắp ráp B", floorArea: "2000" },
    { factoryId: factoryIds[0], code: "WS-HN-03", name: "Xưởng kiểm tra", floorArea: "1500" },
    // Đà Nẵng - 2 workshops
    { factoryId: factoryIds[1], code: "WS-DN-01", name: "Xưởng sản xuất 1", floorArea: "3000" },
    { factoryId: factoryIds[1], code: "WS-DN-02", name: "Xưởng sản xuất 2", floorArea: "2500" },
    // HCM - 4 workshops
    { factoryId: factoryIds[2], code: "WS-HCM-01", name: "Xưởng SMT", floorArea: "4000" },
    { factoryId: factoryIds[2], code: "WS-HCM-02", name: "Xưởng Assembly", floorArea: "3500" },
    { factoryId: factoryIds[2], code: "WS-HCM-03", name: "Xưởng Testing", floorArea: "2000" },
    { factoryId: factoryIds[2], code: "WS-HCM-04", name: "Xưởng Packing", floorArea: "1500" },
  ];

  const workshopIds: number[] = [];
  for (const workshop of workshopData) {
    const [result] = await db.insert(workshops).values(workshop).returning({ id: workshops.id });
    workshopIds.push(result.id);
  }

  // Create production lines
  const lineData = [
    { workshopId: workshopIds[0], code: "LINE-HN-A1", name: "Dây chuyền A1" },
    { workshopId: workshopIds[0], code: "LINE-HN-A2", name: "Dây chuyền A2" },
    { workshopId: workshopIds[1], code: "LINE-HN-B1", name: "Dây chuyền B1" },
    { workshopId: workshopIds[3], code: "LINE-DN-01", name: "Dây chuyền 1" },
    { workshopId: workshopIds[5], code: "LINE-HCM-SMT1", name: "SMT Line 1" },
    { workshopId: workshopIds[5], code: "LINE-HCM-SMT2", name: "SMT Line 2" },
    { workshopId: workshopIds[6], code: "LINE-HCM-ASM1", name: "Assembly Line 1" },
  ];

  const lineIds: number[] = [];
  for (const line of lineData) {
    const [result] = await db.insert(productionLines).values(line).returning({ id: productionLines.id });
    lineIds.push(result.id);
  }

  // Create stations
  const stationData = [
    { lineId: lineIds[0], code: "ST-HN-A1-01", name: "Trạm kiểm tra 1", orderIndex: 1 },
    { lineId: lineIds[0], code: "ST-HN-A1-02", name: "Trạm kiểm tra 2", orderIndex: 2 },
    { lineId: lineIds[4], code: "ST-HCM-SMT1-01", name: "AOI Station 1", orderIndex: 1 },
    { lineId: lineIds[4], code: "ST-HCM-SMT1-02", name: "AOI Station 2", orderIndex: 2 },
    { lineId: lineIds[6], code: "ST-HCM-ASM1-01", name: "AVI Station 1", orderIndex: 1 },
  ];

  const stationIds: number[] = [];
  for (const station of stationData) {
    const [result] = await db.insert(stations).values(station).returning({ id: stations.id });
    stationIds.push(result.id);
  }

  // Create machines with API keys
  const { nanoid } = await import("nanoid");
  const machineData = [
    { stationId: stationIds[0], code: "AVI-HN-001", name: "AVI Machine 1", machineType: "AVI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[0], code: "AVI-HN-002", name: "AVI Machine 2", machineType: "AVI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[1], code: "AOI-HN-001", name: "AOI Machine 1", machineType: "AOI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[2], code: "AOI-HCM-001", name: "AOI SMT 1", machineType: "AOI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[3], code: "AOI-HCM-002", name: "AOI SMT 2", machineType: "AOI" as const, apiKey: `mach_${nanoid(32)}` },
    { stationId: stationIds[4], code: "AVI-HCM-001", name: "AVI Assembly 1", machineType: "AVI" as const, apiKey: `mach_${nanoid(32)}` },
  ];

  for (const machine of machineData) {
    await db.insert(machines).values(machine);
  }

  // Create sample product model
  const [productModelResult] = await db.insert(productModels).values({
    code: "PCB-001",
    name: "PCB Main Board v1.0",
    description: "Main circuit board for electronic device",
    imageWidth: 1920,
    imageHeight: 1080,
  }).returning({ id: productModels.id });
  const productModelId = productModelResult.id;

  // Create sample measurement points (30 points)
  const measurementTypes = ["DIMENSION", "VISUAL", "POSITION", "COLOR", "SURFACE"] as const;
  for (let i = 1; i <= 30; i++) {
    await db.insert(measurementPointDefs).values({
      productModelId,
      code: `MP-${String(i).padStart(3, '0')}`,
      name: `Measurement Point ${i}`,
      measurementType: measurementTypes[i % measurementTypes.length],
      positionX: 50 + (i % 10) * 180,
      positionY: 50 + Math.floor(i / 10) * 300,
      radius: 15 + (i % 3) * 5,
      orderIndex: i,
    });
  }

  return { 
    message: "Sample data created successfully",
    factories: factoryIds.length,
    workshops: workshopIds.length,
    lines: lineIds.length,
    stations: stationIds.length,
    machines: machineData.length,
    productModels: 1,
    measurementPoints: 30
  };
}

// ============ SEED INSPECTION DATA ============
export async function seedInspectionData(count: number = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get all machines
  const allMachines = await db.select().from(machines).where(eq(machines.isActive, true));
  if (allMachines.length === 0) {
    throw new Error("No machines found. Please seed sample data first.");
  }

  // Get product model with measurement points
  const productModel = await db.select().from(productModels).limit(1);
  if (productModel.length === 0) {
    throw new Error("No product model found. Please seed sample data first.");
  }
  const productModelId = productModel[0].id;

  const measurementPoints = await db.select().from(measurementPointDefs)
    .where(eq(measurementPointDefs.productModelId, productModelId));

  const results: string[] = ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'NG', 'NTF']; // 80% OK, 10% NG, 10% NTF
  const ngReasons = ['Scratch detected', 'Dimension out of spec', 'Position shifted', 'Color mismatch', 'Surface defect'];
  
  let createdCount = 0;
  const now = new Date();

  for (let i = 0; i < count; i++) {
    // Random machine
    const machine = allMachines[Math.floor(Math.random() * allMachines.length)];
    
    // Random date within last 30 days
    const inspectionDate = new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);
    
    // Generate serial number
    const serialNumber = `SN-${inspectionDate.toISOString().slice(0, 10).replace(/-/g, '')}-${String(i + 1).padStart(5, '0')}`;
    
    // Determine overall result
    const overallResult = results[Math.floor(Math.random() * results.length)] as 'OK' | 'NG' | 'NTF';
    
    // Create inspection record
    const [inspectionResult] = await db.insert(productInspections).values({
      machineId: machine.id,
      productModelId: productModelId,
      serialNumber,
      productModel: productModel[0].code,
      batchNumber: `BATCH-${inspectionDate.toISOString().slice(0, 7).replace(/-/g, '')}`,
      overallResult,
      originalResult: overallResult === 'NTF' ? 'NG' : overallResult,
      inspectionTime: inspectionDate,
      cycleTime: String((Math.random() * 5 + 1).toFixed(2)), // 1-6 seconds
    }).returning({ id: productInspections.id });
    const inspectionId = inspectionResult.id;

    // Create measurement results for each point
    for (const point of measurementPoints) {
      // If overall is NG, make 1-3 points NG
      let pointResult: 'OK' | 'NG' = 'OK';
      if (overallResult === 'NG' || overallResult === 'NTF') {
        // 10-20% chance each point is NG when overall is NG
        if (Math.random() < 0.15) {
          pointResult = 'NG';
        }
      }

      await db.insert(measurementResults).values({
        inspectionId,
        pointDefId: point.id,
        result: pointResult,
        measuredValue: pointResult === 'OK' ? (Math.random() * 0.1 + 0.95).toFixed(3) : (Math.random() * 0.2 + 0.7).toFixed(3),
        remark: pointResult === 'NG' ? ngReasons[Math.floor(Math.random() * ngReasons.length)] : null,
      });
    }

    createdCount++;
  }

  return {
    message: `Created ${createdCount} inspection records with measurement results`,
    inspections: createdCount,
    measurementResultsPerInspection: measurementPoints.length,
  };
}

// ============ WORKSTATION ANALYTICS ============

export interface DefectsByWorkstationRow {
  workstationId: number | null;
  workstationCode: string | null;
  workstationName: string | null;
  processType: string | null;
  measurementPointId: number;
  measurementPointCode: string;
  measurementPointName: string;
  totalCount: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
}

// Get defect statistics by workstation
export async function getDefectsByWorkstation(filters?: {
  startDate?: Date;
  endDate?: Date;
  productModelId?: number;
  machineId?: number;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<DefectsByWorkstationRow>([], UNSCOPED_LABELS);

  // Trục phạm vi. Truy vấn đặt bí danh `pi` ⇒ phải đi qua cổng bán-nối (xem `scopeGateOnAlias`),
  // và phải là biến thể GIỮ NULL vì đây là bề mặt "danh mục trạm + số đếm" dùng LEFT JOIN.
  const { filter, labels } = await resolveStatsScope(filters);
  const scopeGate = filter ? scopeGateKeepingCatalogue(sql`mr.id`, sql`pi.id`, filter) : undefined;

  try {
    // Convert Date objects to ISO strings for postgres-js
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();

    // Simplified query: Use LEFT JOIN to handle cases with no measurement results
    const query = sql`
      SELECT 
        w.id as "workstationId",
        w.code as "workstationCode",
        w.name as "workstationName",
        w."processType",
        mpd.id as "measurementPointId",
        mpd.code as "measurementPointCode",
        mpd.name as "measurementPointName",
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount"
      FROM workstations w
      LEFT JOIN measurement_point_defs mpd ON mpd."workstationId" = w.id
      LEFT JOIN measurement_results mr ON mr."pointDefId" = mpd.id
      LEFT JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE w."isActive" = true
      ${startDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" >= ${startDateStr})` : sql``}
      ${endDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" <= ${endDateStr})` : sql``}
      ${filters?.productModelId ? sql`AND (mpd."productModelId" IS NULL OR mpd."productModelId" = ${filters.productModelId})` : sql``}
      ${filters?.machineId ? sql`AND (pi."machineId" IS NULL OR pi."machineId" = ${filters.machineId})` : sql``}
      ${scopeGate ? sql`AND ${scopeGate}` : sql``}
      GROUP BY w.id, w.code, w.name, w."processType", mpd.id, mpd.code, mpd.name
      HAVING mpd.id IS NOT NULL
      ORDER BY "ngCount" DESC
    `;

    const result = await db.execute(query);
    // PostgreSQL returns rows directly
    const rows = (result as any).rows || result;
    return withScopeLabels((rows as unknown) as DefectsByWorkstationRow[], labels);
  } catch (error) {
    console.error('getDefectsByWorkstation error:', error);
    // ⚠ Kể cả nhánh HỎNG cũng mang nhãn — mảng rỗng trần ở đây lại thành "số 0 im lặng".
    return withScopeLabels<DefectsByWorkstationRow>([], labels);
  }
}

export interface TopNGByWorkstationRow {
  workstationId: number | null;
  workstationCode: string | null;
  workstationName: string | null;
  measurementPointId: number;
  measurementPointCode: string;
  measurementPointName: string;
  totalCount: number;
  ngCount: number;
  ntfCount: number;
}

// Get top NG measurement points by workstation
export async function getTopNGMeasurementPointsByWorkstation(filters?: {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<TopNGByWorkstationRow>([], UNSCOPED_LABELS);

  // Trục phạm vi — LEFT JOIN `pi`, giữ hàng NULL (danh mục điểm đo).
  const { filter, labels } = await resolveStatsScope(filters);
  const scopeGate = filter ? scopeGateKeepingCatalogue(sql`mr.id`, sql`pi.id`, filter) : undefined;

  try {
    const limitVal = filters?.limit || 10;
    // Convert Date objects to ISO strings for postgres-js
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();
    
    const query = sql`
      SELECT 
        w.id as "workstationId",
        w.code as "workstationCode",
        w.name as "workstationName",
        mpd.id as "measurementPointId",
        mpd.code as "measurementPointCode",
        mpd.name as "measurementPointName",
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount"
      FROM measurement_point_defs mpd
      LEFT JOIN workstations w ON mpd."workstationId" = w.id
      LEFT JOIN measurement_results mr ON mr."pointDefId" = mpd.id AND mr.result IN ('NG', 'NTF')
      LEFT JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE 1=1
      ${startDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" >= ${startDateStr})` : sql``}
      ${endDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" <= ${endDateStr})` : sql``}
      ${scopeGate ? sql`AND ${scopeGate}` : sql``}
      GROUP BY w.id, w.code, w.name, mpd.id, mpd.code, mpd.name
      HAVING SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) > 0 OR SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END) > 0
      ORDER BY "ngCount" DESC
      LIMIT ${limitVal}
    `;

    const result = await db.execute(query);
    // PostgreSQL returns rows directly
    const rows = (result as any).rows || result;
    return withScopeLabels((rows as unknown) as TopNGByWorkstationRow[], labels);
  } catch (error) {
    console.error('getTopNGMeasurementPointsByWorkstation error:', error);
    return withScopeLabels<TopNGByWorkstationRow>([], labels);
  }
}

export interface WorkstationSummaryRow {
  workstationId: number;
  workstationCode: string;
  workstationName: string;
  processType: string;
  measurementPointCount: number;
  totalInspections: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  yieldRate: number;
}

// Get workstation summary statistics
export async function getWorkstationSummary(filters?: {
  startDate?: Date;
  endDate?: Date;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<WorkstationSummaryRow>([], UNSCOPED_LABELS);

  // Trục phạm vi — LEFT JOIN `pi`, giữ hàng NULL (danh mục trạm phải còn nguyên).
  const { filter, labels } = await resolveStatsScope(filters);
  const scopeGate = filter ? scopeGateKeepingCatalogue(sql`mr.id`, sql`pi.id`, filter) : undefined;

  try {
    // Convert Date objects to ISO strings for postgres-js
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();
    
    const query = sql`
      SELECT 
        w.id as "workstationId",
        w.code as "workstationCode",
        w.name as "workstationName",
        w."processType",
        COALESCE(COUNT(DISTINCT mpd.id), 0) as "measurementPointCount",
        COALESCE(COUNT(mr.id), 0) as "totalInspections",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(${finalYieldPctSql(sql`mr.result`, { countExpr: sql`COUNT(mr.id)` })}, 0) as "yieldRate"
      FROM workstations w
      LEFT JOIN measurement_point_defs mpd ON mpd."workstationId" = w.id
      LEFT JOIN measurement_results mr ON mr."pointDefId" = mpd.id
      LEFT JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE w."isActive" = true
      ${startDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" >= ${startDateStr})` : sql``}
      ${endDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" <= ${endDateStr})` : sql``}
      ${scopeGate ? sql`AND ${scopeGate}` : sql``}
      GROUP BY w.id, w.code, w.name, w."processType"
      ORDER BY "ngCount" DESC
    `;

    const result = await db.execute(query);
    // PostgreSQL returns rows directly
    const rows = (result as any).rows || result;
    return withScopeLabels((rows as unknown) as WorkstationSummaryRow[], labels);
  } catch (error) {
    console.error('getWorkstationSummary error:', error);
    return withScopeLabels<WorkstationSummaryRow>([], labels);
  }
}


export interface MeasurementPointByWorkstationRow {
  measurementPointId: number;
  measurementPointCode: string;
  measurementPointName: string;
  pointType: string;
  lowerLimit: number | null;
  upperLimit: number | null;
  unit: string | null;
  totalCount: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  avgValue: number;
  minValue: number;
  maxValue: number;
}

// Get measurement points by workstation with NG statistics
export async function getMeasurementPointsByWorkstation(filters: {
  workstationId: number;
  startDate?: Date;
  endDate?: Date;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<MeasurementPointByWorkstationRow>([], UNSCOPED_LABELS);

  // Trục phạm vi — LEFT JOIN `pi`, giữ hàng NULL (danh mục điểm đo của trạm).
  const { filter, labels } = await resolveStatsScope(filters);
  const scopeGate = filter ? scopeGateKeepingCatalogue(sql`mr.id`, sql`pi.id`, filter) : undefined;

  try {
    // Convert Date objects to ISO strings for postgres-js
    const startDateStr = filters.startDate?.toISOString();
    const endDateStr = filters.endDate?.toISOString();
    
    const query = sql`
      SELECT 
        mpd.id as "measurementPointId",
        mpd.code as "measurementPointCode",
        mpd.name as "measurementPointName",
        mpd."measurementType" as "pointType",
        mpd."lowerLimit",
        mpd."upperLimit",
        mpd.unit,
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(AVG(mr."measuredValue"), 0) as "avgValue",
        COALESCE(MIN(mr."measuredValue"), 0) as "minValue",
        COALESCE(MAX(mr."measuredValue"), 0) as "maxValue"
      FROM measurement_point_defs mpd
      LEFT JOIN measurement_results mr ON mr."pointDefId" = mpd.id
      LEFT JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE mpd."workstationId" = ${filters.workstationId}
      ${startDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" >= ${startDateStr})` : sql``}
      ${endDateStr ? sql`AND (pi."inspectionTime" IS NULL OR pi."inspectionTime" <= ${endDateStr})` : sql``}
      ${scopeGate ? sql`AND ${scopeGate}` : sql``}
      GROUP BY mpd.id, mpd.code, mpd.name, mpd."measurementType", mpd."lowerLimit", mpd."upperLimit", mpd.unit
      ORDER BY "ngCount" DESC, mpd.code ASC
    `;

    const result = await db.execute(query);
    // PostgreSQL returns rows directly
    const rows = (result as any).rows || result;
    return withScopeLabels((rows as unknown) as MeasurementPointByWorkstationRow[], labels);
  } catch (error) {
    console.error('getMeasurementPointsByWorkstation error:', error);
    return withScopeLabels<MeasurementPointByWorkstationRow>([], labels);
  }
}

// ============ SEED WORKSTATION ANALYTICS DATA ============
export async function seedWorkstationAnalyticsData(options?: {
  inspectionCount?: number;
  daysBack?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const inspectionCount = options?.inspectionCount || 500;
  const daysBack = options?.daysBack || 7;

  // Step 1: Ensure workstations exist
  const existingWorkstations = await db.select().from(workstations);
  if (existingWorkstations.length === 0) {
    // Create default workstations
    const defaultWorkstations = [
      { code: 'WS-SMT', name: 'SMT Assembly', description: 'Surface Mount Technology', processType: 'SMT' as const, orderIndex: 1, isActive: true },
      { code: 'WS-DIP', name: 'DIP Soldering', description: 'Dual In-line Package Soldering', processType: 'DIP' as const, orderIndex: 2, isActive: true },
      { code: 'WS-AOI', name: 'AOI Inspection', description: 'Automated Optical Inspection', processType: 'TESTING' as const, orderIndex: 3, isActive: true },
      { code: 'WS-FCT', name: 'Functional Test', description: 'Functional Circuit Testing', processType: 'TESTING' as const, orderIndex: 4, isActive: true },
      { code: 'WS-PKG', name: 'Packaging', description: 'Final Packaging', processType: 'PACKAGING' as const, orderIndex: 5, isActive: true },
    ];

    for (const ws of defaultWorkstations) {
      await db.insert(workstations).values(ws);
    }
    console.log(`Created ${defaultWorkstations.length} default workstations`);
  }

  // Step 2: Get all workstations
  const allWorkstations = await db.select().from(workstations).where(eq(workstations.isActive, true));
  if (allWorkstations.length === 0) {
    throw new Error("No active workstations found");
  }

  // Step 3: Get all machines
  const allMachines = await db.select().from(machines).where(eq(machines.isActive, true));
  if (allMachines.length === 0) {
    throw new Error("No machines found. Please seed sample data first.");
  }

  // Step 4: Get product model with measurement points
  const productModel = await db.select().from(productModels).limit(1);
  if (productModel.length === 0) {
    throw new Error("No product model found. Please seed sample data first.");
  }
  const productModelId = productModel[0].id;

  // Step 5: Get measurement points and assign workstations if not assigned
  let measurementPoints = await db.select().from(measurementPointDefs)
    .where(eq(measurementPointDefs.productModelId, productModelId));

  if (measurementPoints.length === 0) {
    throw new Error("No measurement points found. Please create measurement points first.");
  }

  // Assign workstations to measurement points if not already assigned
  let assignedCount = 0;
  for (let i = 0; i < measurementPoints.length; i++) {
    const point = measurementPoints[i];
    if (!point.workstationId) {
      const workstation = allWorkstations[i % allWorkstations.length];
      await db.update(measurementPointDefs)
        .set({ workstationId: workstation.id })
        .where(eq(measurementPointDefs.id, point.id));
      assignedCount++;
    }
  }
  if (assignedCount > 0) {
    console.log(`Assigned workstations to ${assignedCount} measurement points`);
    // Refresh measurement points
    measurementPoints = await db.select().from(measurementPointDefs)
      .where(eq(measurementPointDefs.productModelId, productModelId));
  }

  // Step 6: Generate inspection data
  const results: string[] = ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'NG', 'NG', 'NTF']; // 70% OK, 20% NG, 10% NTF
  const ngReasons = [
    'Scratch detected', 
    'Dimension out of spec', 
    'Position shifted', 
    'Color mismatch', 
    'Surface defect',
    'Solder bridge',
    'Missing component',
    'Wrong polarity',
    'Cold solder joint',
    'Tombstone effect'
  ];
  
  let createdInspections = 0;
  let createdResults = 0;
  const now = new Date();

  for (let i = 0; i < inspectionCount; i++) {
    // Random machine
    const machine = allMachines[Math.floor(Math.random() * allMachines.length)];
    
    // Random date within last N days
    const inspectionDate = new Date(now.getTime() - Math.random() * daysBack * 24 * 60 * 60 * 1000);
    
    // Generate serial number
    const serialNumber = `SN-WS-${inspectionDate.toISOString().slice(0, 10).replace(/-/g, '')}-${String(i + 1).padStart(5, '0')}`;
    
    // Determine overall result
    const overallResult = results[Math.floor(Math.random() * results.length)] as 'OK' | 'NG' | 'NTF';
    
    // Create inspection record
    const [inspectionResult] = await db.insert(productInspections).values({
      machineId: machine.id,
      productModelId: productModelId,
      serialNumber,
      productModel: productModel[0].code,
      batchNumber: `BATCH-WS-${inspectionDate.toISOString().slice(0, 7).replace(/-/g, '')}`,
      overallResult,
      originalResult: overallResult === 'NTF' ? 'NG' : overallResult,
      inspectionTime: inspectionDate,
      cycleTime: String((Math.random() * 5 + 1).toFixed(2)),
    }).returning({ id: productInspections.id });
    const inspectionId = inspectionResult.id;
    createdInspections++;

    // Create measurement results for each point
    for (const point of measurementPoints) {
      // If overall is NG/NTF, make some points NG based on workstation
      let pointResult: 'OK' | 'NG' | 'NTF' = 'OK';
      
      if (overallResult === 'NG' || overallResult === 'NTF') {
        // Higher chance of NG for certain workstations (simulate real-world patterns)
        const workstation = allWorkstations.find(ws => ws.id === point.workstationId);
        let ngProbability = 0.15; // default 15%
        
        if (workstation) {
          // SMT and DIP have higher defect rates
          if (workstation.code === 'WS-SMT') ngProbability = 0.25;
          else if (workstation.code === 'WS-DIP') ngProbability = 0.20;
          else if (workstation.code === 'WS-AOI') ngProbability = 0.10;
        }
        
        if (Math.random() < ngProbability) {
          pointResult = overallResult === 'NTF' ? 'NTF' : 'NG';
        }
      }

      await db.insert(measurementResults).values({
        inspectionId,
        pointDefId: point.id,
        result: pointResult,
        measuredValue: pointResult === 'OK' 
          ? (Math.random() * 0.1 + 0.95).toFixed(3) 
          : (Math.random() * 0.2 + 0.7).toFixed(3),
        remark: pointResult === 'NG' || pointResult === 'NTF' 
          ? ngReasons[Math.floor(Math.random() * ngReasons.length)] 
          : null,
      });
      createdResults++;
    }
  }

  return {
    message: `Created ${createdInspections} inspection records with ${createdResults} measurement results`,
    inspections: createdInspections,
    measurementResults: createdResults,
    workstationsUsed: allWorkstations.length,
    measurementPointsPerInspection: measurementPoints.length,
  };
}


// ============ NG TREND AND COMPARISON FUNCTIONS ============

// Get NG trend data by day
export interface NGTrendRow {
  date: string;
  totalCount: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  ngRate: number;
}

export async function getNGTrendByDay(filters?: {
  startDate?: Date;
  endDate?: Date;
  workstationId?: number;
  measurementPointDefId?: number;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<NGTrendRow>([], UNSCOPED_LABELS);

  // Trục phạm vi. INNER JOIN `pi` ⇒ không có hàng NULL để giữ, dùng cổng bán-nối TRẦN.
  const { filter, labels } = await resolveStatsScope(filters);
  const scopeGate = filter ? scopeGateOnAlias(sql`pi.id`, filter) : undefined;

  try {
    // Convert Date objects to ISO strings for postgres-js
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();
    
    // Day buckets in the FACTORY timezone (gap A2). TO_CHAR keeps the wire
    // format a stable 'YYYY-MM-DD' string (the declared contract).
    const query = sql`
      SELECT
        ${factoryDayTextSql(sql`pi."inspectionTime"`)} as date,
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as "ngRate"
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
      LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
      WHERE pi."inspectionTime" IS NOT NULL
      ${startDateStr ? sql`AND pi."inspectionTime" >= ${startDateStr}` : sql``}
      ${endDateStr ? sql`AND pi."inspectionTime" <= ${endDateStr}` : sql``}
      ${filters?.workstationId ? sql`AND mpd."workstationId" = ${filters.workstationId}` : sql``}
      ${filters?.measurementPointDefId ? sql`AND mr."pointDefId" = ${filters.measurementPointDefId}` : sql``}
      ${scopeGate ? sql`AND ${scopeGate}` : sql``}
      GROUP BY 1
      ORDER BY date ASC
    `;

    const result = await db.execute(query);
    // PostgreSQL returns rows directly
    const rows = (result as any).rows || result;
    // V3: postgres.js returns COUNT/SUM (bigint) and ROUND (numeric) as STRINGS. The API
    // contract (and every consumer: charts, PDF/PPT reports, report builder) expects numbers,
    // so coerce the numeric columns here at the source rather than in each caller.
    return withScopeLabels(((rows as any[]) ?? []).map((r) => ({
      date: String(r.date),
      totalCount: Number(r.totalCount),
      okCount: Number(r.okCount),
      ngCount: Number(r.ngCount),
      ntfCount: Number(r.ntfCount),
      ngRate: Number(r.ngRate),
    })) as NGTrendRow[], labels);
  } catch (error) {
    console.error('getNGTrendByDay error:', error);
    return withScopeLabels<NGTrendRow>([], labels);
  }
}

// Get NG comparison between two periods
export async function getNGComparison(filters: {
  currentStartDate: Date;
  currentEndDate: Date;
  previousStartDate: Date;
  previousEndDate: Date;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return null;

  // Trục phạm vi — INNER JOIN `pi`, cổng bán-nối trần.
  const { filter, labels } = await resolveStatsScope(filters);
  const scopeGate = filter ? scopeGateOnAlias(sql`pi.id`, filter) : undefined;

  try {
    // Convert Date objects to ISO strings for postgres-js
    const currentStartStr = filters.currentStartDate.toISOString();
    const currentEndStr = filters.currentEndDate.toISOString();
    const previousStartStr = filters.previousStartDate.toISOString();
    const previousEndStr = filters.previousEndDate.toISOString();
    
    // Get current period stats
    const currentQuery = sql`
      SELECT 
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as "ngRate"
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE pi."inspectionTime" >= ${currentStartStr}
        AND pi."inspectionTime" <= ${currentEndStr}
        ${scopeGate ? sql`AND ${scopeGate}` : sql``}
    `;

    // Get previous period stats
    const previousQuery = sql`
      SELECT 
        COALESCE(COUNT(mr.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN mr.result = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(mr.id), 0), 2), 0) as "ngRate"
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE pi."inspectionTime" >= ${previousStartStr}
        AND pi."inspectionTime" <= ${previousEndStr}
        ${scopeGate ? sql`AND ${scopeGate}` : sql``}
    `;

    const [currentResult, previousResult] = await Promise.all([
      db.execute(currentQuery),
      db.execute(previousQuery),
    ]);

    const current = ((currentResult as any).rows?.[0] || (currentResult as any)[0]) || { totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0, ngRate: 0 };
    const previous = ((previousResult as any).rows?.[0] || (previousResult as any)[0]) || { totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0, ngRate: 0 };

    // Calculate changes
    const ngRateChange = Number(current.ngRate) - Number(previous.ngRate);
    const totalCountChange = Number(current.totalCount) - Number(previous.totalCount);
    const ngCountChange = Number(current.ngCount) - Number(previous.ngCount);

    return {
      current: {
        totalCount: Number(current.totalCount),
        okCount: Number(current.okCount),
        ngCount: Number(current.ngCount),
        ntfCount: Number(current.ntfCount),
        ngRate: Number(current.ngRate),
      },
      previous: {
        totalCount: Number(previous.totalCount),
        okCount: Number(previous.okCount),
        ngCount: Number(previous.ngCount),
        ntfCount: Number(previous.ntfCount),
        ngRate: Number(previous.ngRate),
      },
      changes: {
        ngRateChange,
        ngRateChangePercent: previous.ngRate > 0 ? (ngRateChange / Number(previous.ngRate)) * 100 : 0,
        totalCountChange,
        totalCountChangePercent: previous.totalCount > 0 ? (totalCountChange / Number(previous.totalCount)) * 100 : 0,
        ngCountChange,
        ngCountChangePercent: previous.ngCount > 0 ? (ngCountChange / Number(previous.ngCount)) * 100 : 0,
        isImproved: ngRateChange < 0, // NG rate decreased = improved
      },
      // ⚠ BA ô nhãn, KHÔNG phải `...resolved`.
      ...labels,
    };
  } catch (error) {
    console.error('getNGComparison error:', error);
    return null;
  }
}

// ============ FALLBACK NG FUNCTIONS (product_inspections-based) ============

export interface NGSummaryByMachineRow {
  machineId: number;
  machineCode: string;
  machineName: string;
  totalInspections: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  yieldRate: number;
}

// Get NG summary by machine (fallback when workstation data is unavailable)
export async function getNGSummaryByMachine(filters?: {
  startDate?: Date;
  endDate?: Date;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<NGSummaryByMachineRow>([], UNSCOPED_LABELS);

  // Trục phạm vi. Cổng nằm trong điều kiện ON của LEFT JOIN (như bộ lọc ngày ngay cạnh), nên
  // DANH MỤC MÁY vẫn hiện đủ với số 0 — chặn đúng mà không xoá mất danh sách máy.
  const { filter, labels } = await resolveStatsScope(filters);
  const scopeGate = filter ? scopeGateOnAlias(sql`pi.id`, filter) : undefined;

  try {
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();

    const query = sql`
      SELECT 
        m.id as "machineId",
        m.code as "machineCode",
        m.name as "machineName",
        COALESCE(COUNT(pi.id), 0) as "totalInspections",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(${finalYieldPctSql(sql`pi."overallResult"`, { countExpr: sql`COUNT(pi.id)` })}, 0) as "yieldRate"
      FROM machines m
      LEFT JOIN product_inspections pi ON pi."machineId" = m.id
        ${startDateStr ? sql`AND pi."inspectionTime" >= ${startDateStr}` : sql``}
        ${endDateStr ? sql`AND pi."inspectionTime" <= ${endDateStr}` : sql``}
        ${scopeGate ? sql`AND ${scopeGate}` : sql``}
      WHERE m."isActive" = true
      GROUP BY m.id, m.code, m.name
      ORDER BY "ngCount" DESC
    `;

    const result = await db.execute(query);
    const rows = (result as any).rows || result;
    return withScopeLabels((rows as unknown) as NGSummaryByMachineRow[], labels);
  } catch (error) {
    console.error('getNGSummaryByMachine error:', error);
    return withScopeLabels<NGSummaryByMachineRow>([], labels);
  }
}

// Get NG trend by day from product_inspections directly (fallback)
export async function getNGTrendByDayDirect(filters?: {
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<NGTrendRow>([], UNSCOPED_LABELS);

  // Trục phạm vi — `FROM product_inspections pi` (có bí danh) ⇒ cổng bán-nối trần.
  const { filter, labels } = await resolveStatsScope(filters);
  const scopeGate = filter ? scopeGateOnAlias(sql`pi.id`, filter) : undefined;

  try {
    const startDateStr = filters?.startDate?.toISOString();
    const endDateStr = filters?.endDate?.toISOString();

    // Day buckets in the FACTORY timezone (gap A2).
    const query = sql`
      SELECT
        ${factoryDayTextSql(sql`pi."inspectionTime"`)} as date,
        COALESCE(COUNT(pi.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(pi.id), 0), 2), 0) as "ngRate"
      FROM product_inspections pi
      WHERE pi."inspectionTime" IS NOT NULL
      ${startDateStr ? sql`AND pi."inspectionTime" >= ${startDateStr}` : sql``}
      ${endDateStr ? sql`AND pi."inspectionTime" <= ${endDateStr}` : sql``}
      ${filters?.machineId ? sql`AND pi."machineId" = ${filters.machineId}` : sql``}
      ${scopeGate ? sql`AND ${scopeGate}` : sql``}
      GROUP BY 1
      ORDER BY date ASC
    `;

    const result = await db.execute(query);
    const rows = (result as any).rows || result;
    return withScopeLabels((rows as unknown) as NGTrendRow[], labels);
  } catch (error) {
    console.error('getNGTrendByDayDirect error:', error);
    return withScopeLabels<NGTrendRow>([], labels);
  }
}

// Get NG comparison from product_inspections directly (fallback)
export async function getNGComparisonDirect(filters: {
  currentStartDate: Date;
  currentEndDate: Date;
  previousStartDate: Date;
  previousEndDate: Date;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return null;

  // Trục phạm vi — `FROM product_inspections pi` (có bí danh) ⇒ cổng bán-nối trần.
  const { filter, labels } = await resolveStatsScope(filters);
  const scopeGate = filter ? scopeGateOnAlias(sql`pi.id`, filter) : undefined;

  try {
    const currentStartStr = filters.currentStartDate.toISOString();
    const currentEndStr = filters.currentEndDate.toISOString();
    const previousStartStr = filters.previousStartDate.toISOString();
    const previousEndStr = filters.previousEndDate.toISOString();

    const currentQuery = sql`
      SELECT 
        COALESCE(COUNT(pi.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(pi.id), 0), 2), 0) as "ngRate"
      FROM product_inspections pi
      WHERE pi."inspectionTime" >= ${currentStartStr}
        AND pi."inspectionTime" <= ${currentEndStr}
        ${scopeGate ? sql`AND ${scopeGate}` : sql``}
    `;

    const previousQuery = sql`
      SELECT 
        COALESCE(COUNT(pi.id), 0) as "totalCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END), 0) as "okCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END), 0) as "ngCount",
        COALESCE(SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END), 0) as "ntfCount",
        COALESCE(ROUND(SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(pi.id), 0), 2), 0) as "ngRate"
      FROM product_inspections pi
      WHERE pi."inspectionTime" >= ${previousStartStr}
        AND pi."inspectionTime" <= ${previousEndStr}
        ${scopeGate ? sql`AND ${scopeGate}` : sql``}
    `;

    const [currentResult, previousResult] = await Promise.all([
      db.execute(currentQuery),
      db.execute(previousQuery),
    ]);

    const current = ((currentResult as any).rows?.[0] || (currentResult as any)[0]) || { totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0, ngRate: 0 };
    const previous = ((previousResult as any).rows?.[0] || (previousResult as any)[0]) || { totalCount: 0, okCount: 0, ngCount: 0, ntfCount: 0, ngRate: 0 };

    const ngRateChange = Number(current.ngRate) - Number(previous.ngRate);
    const totalCountChange = Number(current.totalCount) - Number(previous.totalCount);
    const ngCountChange = Number(current.ngCount) - Number(previous.ngCount);

    return {
      current: {
        totalCount: Number(current.totalCount),
        okCount: Number(current.okCount),
        ngCount: Number(current.ngCount),
        ntfCount: Number(current.ntfCount),
        ngRate: Number(current.ngRate),
      },
      previous: {
        totalCount: Number(previous.totalCount),
        okCount: Number(previous.okCount),
        ngCount: Number(previous.ngCount),
        ntfCount: Number(previous.ntfCount),
        ngRate: Number(previous.ngRate),
      },
      changes: {
        ngRateChange,
        ngRateChangePercent: previous.ngRate > 0 ? (ngRateChange / Number(previous.ngRate)) * 100 : 0,
        totalCountChange,
        totalCountChangePercent: previous.totalCount > 0 ? (totalCountChange / Number(previous.totalCount)) * 100 : 0,
        ngCountChange,
        ngCountChangePercent: previous.ngCount > 0 ? (ngCountChange / Number(previous.ngCount)) * 100 : 0,
        isImproved: ngRateChange < 0,
      },
      // ⚠ BA ô nhãn, KHÔNG phải `...resolved`.
      ...labels,
    };
  } catch (error) {
    console.error('getNGComparisonDirect error:', error);
    return null;
  }
}

// Get gallery images from measurement_results joined with product_inspections
export async function getGalleryImages(params: {
  factoryCode?: string;
  workshopCode?: string;
  lineCode?: string;
  stationCode?: string;
  machineCode?: string;
  serialNumber?: string;
  productModel?: string;
  result?: "OK" | "NG" | "NTF";
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  userId?: number;
  userRole?: string;
}) {
  const db = await getDb();
  if (!db) return { data: [], total: 0, ...UNSCOPED_LABELS };

  // Phạm vi được cưỡng chế Ở TẦNG DƯỚI: `searchInspections` nhận `userId`/`userRole` qua
  // `...params` và chỉ trả về những bản ghi kiểm trong phạm vi; ảnh ở đây bị chặn bởi
  // `inArray(inspectionId, …)` nên KHÔNG có đường vòng. Cái thiếu là ba ô NHÃN — nếu không
  // chuyển tiếp, người 0 gán nhà máy nhận thư viện ảnh rỗng KHÔNG kèm lý do.
  const inspectionResult = await searchInspections({
    ...params,
    limit: params.limit || 100,
    offset: params.offset || 0,
  });
  const labels = scopeLabelsOf(inspectionResult);

  if (inspectionResult.data.length === 0) {
    return { data: [], total: 0, ...labels };
  }

  const inspectionIds = inspectionResult.data.map(i => i.id);

  // Fetch measurement results with images for these inspections
  const results = await db.select({
    id: measurementResults.id,
    inspectionId: measurementResults.inspectionId,
    pointDefId: measurementResults.pointDefId,
    measuredValue: measurementResults.measuredValue,
    measuredValueText: measurementResults.measuredValueText,
    result: measurementResults.result,
    imageUrl: measurementResults.imageUrl,
    imageKey: measurementResults.imageKey,
    remark: measurementResults.remark,
    createdAt: measurementResults.createdAt,
    // Point def info
    pointCode: measurementPointDefs.code,
    pointName: measurementPointDefs.name,
    // Inspection info
    serialNumber: productInspections.serialNumber,
    overallResult: productInspections.overallResult,
    inspectionTime: productInspections.inspectionTime,
    productModel: productInspections.productModel,
  }).from(measurementResults)
    .innerJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .where(
      and(
        inArray(measurementResults.inspectionId, inspectionIds),
        sql`${measurementResults.imageUrl} IS NOT NULL AND ${measurementResults.imageUrl} != ''`
      )
    )
    .orderBy(desc(productInspections.inspectionTime), measurementResults.id);

  return {
    data: results,
    total: results.length,
    inspectionCount: inspectionResult.total,
    ...labels,
  };
}


// ============ CORPORATE/FACTORY STATISTICS FUNCTIONS ============
export async function getYieldRateByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    if (corporateAssignments.length > 0) {
      const corporateCodes = corporateAssignments.map(a => a.corporateCode);
      conditions.push(inArray(productInspections.corporateCode, corporateCodes));
    } else {
      // User has no corporate assignments, return empty
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      totalInspections: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    totalInspections: Number(r.totalInspections),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ntfCount: Number(r.ntfCount),
    // Canonical FINAL yield (NTF = pass, decision #4); wire type stays string.
    yieldRate: finalYield({
      ok: Number(r.okCount),
      ntf: Number(r.ntfCount),
      total: Number(r.totalInspections),
    }).toFixed(2),
  }));
}

export async function getYieldRateByFactory(filters: {
  corporateCode?: string;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filters.corporateCode) conditions.push(eq(productInspections.corporateCode, filters.corporateCode));
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    const factoryAssignments = await getUserFactoryAssignments(filters.userId);
    
    if (corporateAssignments.length > 0 || factoryAssignments.length > 0) {
      const accessConditions = [];
      if (corporateAssignments.length > 0) {
        const corporateCodes = corporateAssignments.map(a => a.corporateCode);
        accessConditions.push(inArray(productInspections.corporateCode, corporateCodes));
      }
      if (factoryAssignments.length > 0) {
        const factoryCodes = factoryAssignments.map(a => a.factoryCode);
        accessConditions.push(inArray(productInspections.factoryCode, factoryCodes));
      }
      if (accessConditions.length > 0) {
        conditions.push(or(...accessConditions));
      }
    } else {
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      factoryCode: productInspections.factoryCode,
      totalInspections: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode, productInspections.factoryCode);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    factoryCode: r.factoryCode || 'N/A',
    totalInspections: Number(r.totalInspections),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ntfCount: Number(r.ntfCount),
    // Canonical FINAL yield (NTF = pass, decision #4); wire type stays string.
    yieldRate: finalYield({
      ok: Number(r.okCount),
      ntf: Number(r.ntfCount),
      total: Number(r.totalInspections),
    }).toFixed(2),
  }));
}

export async function getThroughputByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  interval?: 'hour' | 'day' | 'week';
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const interval = filters.interval || 'day';
  const conditions = [];
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    if (corporateAssignments.length > 0) {
      const corporateCodes = corporateAssignments.map(a => a.corporateCode);
      conditions.push(inArray(productInspections.corporateCode, corporateCodes));
    } else {
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Buckets in the FACTORY timezone (gap A2).
  let dateFormat: SQL;
  if (interval === 'hour') {
    dateFormat = factoryDateTruncSql('hour', productInspections.inspectionTime);
  } else if (interval === 'week') {
    dateFormat = factoryDateTruncSql('week', productInspections.inspectionTime);
  } else {
    dateFormat = factoryDateSql(productInspections.inspectionTime);
  }

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      timeInterval: dateFormat.as('timeInterval'),
      count: sql<number>`COUNT(*)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode, dateFormat)
    .orderBy(dateFormat);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    timeInterval: r.timeInterval,
    count: Number(r.count),
  }));
}

export async function getThroughputByFactory(filters: {
  corporateCode?: string;
  startDate?: Date;
  endDate?: Date;
  interval?: 'hour' | 'day' | 'week';
  userId?: number;
  userRole?: 'admin' | 'user';
}) {
  const db = await getDb();
  if (!db) return [];

  const interval = filters.interval || 'day';
  const conditions = [];
  if (filters.corporateCode) conditions.push(eq(productInspections.corporateCode, filters.corporateCode));
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));

  // Apply access control for non-admin users
  if (filters.userId && filters.userRole !== 'admin') {
    const corporateAssignments = await getUserCorporateAssignments(filters.userId);
    const factoryAssignments = await getUserFactoryAssignments(filters.userId);
    
    if (corporateAssignments.length > 0 || factoryAssignments.length > 0) {
      const accessConditions = [];
      if (corporateAssignments.length > 0) {
        const corporateCodes = corporateAssignments.map(a => a.corporateCode);
        accessConditions.push(inArray(productInspections.corporateCode, corporateCodes));
      }
      if (factoryAssignments.length > 0) {
        const factoryCodes = factoryAssignments.map(a => a.factoryCode);
        accessConditions.push(inArray(productInspections.factoryCode, factoryCodes));
      }
      if (accessConditions.length > 0) {
        conditions.push(or(...accessConditions));
      }
    } else {
      return [];
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Buckets in the FACTORY timezone (gap A2).
  let dateFormat: SQL;
  if (interval === 'hour') {
    dateFormat = factoryDateTruncSql('hour', productInspections.inspectionTime);
  } else if (interval === 'week') {
    dateFormat = factoryDateTruncSql('week', productInspections.inspectionTime);
  } else {
    dateFormat = factoryDateSql(productInspections.inspectionTime);
  }

  const results = await db
    .select({
      corporateCode: productInspections.corporateCode,
      factoryCode: productInspections.factoryCode,
      timeInterval: dateFormat.as('timeInterval'),
      count: sql<number>`COUNT(*)`,
    })
    .from(productInspections)
    .where(whereClause)
    .groupBy(productInspections.corporateCode, productInspections.factoryCode, dateFormat)
    .orderBy(dateFormat);

  return results.map(r => ({
    corporateCode: r.corporateCode || 'N/A',
    factoryCode: r.factoryCode || 'N/A',
    timeInterval: r.timeInterval,
    count: Number(r.count),
  }));
}


// ============ TOP NG ANALYSIS FUNCTIONS (ENHANCED) ============

export interface TopNGEnhancedRow {
  rank: number;
  measurementPointId: number;
  pointCode: string;
  pointName: string;
  measurementType: string;
  productModelId: number | null;
  productCode: string | null;
  productName: string | null;
  ngCount: number;
  totalCount: number;
  ngRate: string;
  cumulativePercent: number;
}

export async function getTopNGMeasurementPointsEnhanced(filters: {
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  factoryCode?: string;
  productModelId?: number;
  limit?: number;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<TopNGEnhancedRow>([], UNSCOPED_LABELS);

  const limitCount = filters.limit || 10;
  const conditions: SQL[] = [];

  // Trục phạm vi — truy vấn drizzle (không bí danh), `filter` nhét thẳng vào `conditions`.
  // ⚠ `productInspections` ở đây được nối bằng LEFT JOIN, nên một kết quả đo KHÔNG gắn được với
  // bản ghi kiểm nào (`pi.*` NULL) sẽ bị vị từ này loại — ĐÚNG chủ ý: không xác định được nhà
  // máy thì không được rơi vào phạm vi của bất kỳ ai (trừ vai toàn quyền, vốn không có `filter`).
  const { filter, labels } = await resolveStatsScope(filters);
  if (filter) conditions.push(filter);

  // Join with inspections to filter by date and factory
  if (filters.startDate) {
    conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  if (filters.productModelId) {
    conditions.push(eq(productInspections.productModelId, filters.productModelId));
  }
  
  // Filter for NG results only
  conditions.push(eq(measurementResults.result, 'NG'));
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  const results = await db
    .select({
      measurementPointId: measurementResults.pointDefId,
      pointCode: measurementPointDefs.code,
      pointName: measurementPointDefs.name,
      measurementType: measurementPointDefs.measurementType,
      productModelId: measurementPointDefs.productModelId,
      productCode: productModels.code,
      productName: productModels.name,
      ngCount: sql<number>`COUNT(*)`,
      totalCount: sql<number>`(
        SELECT COUNT(*) FROM measurement_results mr2 
        WHERE mr2."pointDefId" = ${measurementResults.pointDefId}
      )`,
    })
    .from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productModels, eq(measurementPointDefs.productModelId, productModels.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(whereClause)
    .groupBy(measurementResults.pointDefId, measurementPointDefs.code, measurementPointDefs.name, measurementPointDefs.measurementType, measurementPointDefs.productModelId, productModels.code, productModels.name)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(limitCount);
  
  return withScopeLabels(results.map((r, index) => ({
    rank: index + 1,
    measurementPointId: r.measurementPointId,
    pointCode: r.pointCode || 'N/A',
    pointName: r.pointName || 'Unknown',
    measurementType: (r.measurementType || 'OTHER') as string,
    productModelId: r.productModelId || null,
    productCode: r.productCode || null,
    productName: r.productName || null,
    ngCount: Number(r.ngCount),
    totalCount: Number(r.totalCount),
    ngRate: Number(r.totalCount) > 0
      ? ((Number(r.ngCount) / Number(r.totalCount)) * 100).toFixed(2)
      : '0.00',
    // For Pareto chart - cumulative percentage
    cumulativePercent: 0, // Will be calculated in router
  })), labels);
}

// ============ TREND ANALYSIS FUNCTIONS ============

export interface YieldTrendRow {
  timeInterval: unknown;
  totalCount: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  yieldRate: number;
  ngRate: number;
}

export async function getYieldTrendData(filters: {
  startDate: Date;
  endDate: Date;
  machineId?: number;
  factoryCode?: string;
  interval?: 'hour' | 'day' | 'week' | 'month';
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<YieldTrendRow>([], UNSCOPED_LABELS);

  const interval = filters.interval || 'day';
  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, filters.startDate),
    lte(productInspections.inspectionTime, filters.endDate),
  ];

  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }

  // Trục phạm vi — truy vấn drizzle không bí danh.
  const { filter, labels } = await resolveStatsScope(filters);
  if (filter) conditions.push(filter);

  // Buckets in the FACTORY timezone (gap A2).
  let dateFormat: SQL;
  if (interval === 'hour') {
    dateFormat = factoryDateTruncSql('hour', productInspections.inspectionTime);
  } else if (interval === 'week') {
    dateFormat = factoryDateTruncSql('week', productInspections.inspectionTime);
  } else if (interval === 'month') {
    dateFormat = factoryDateTruncSql('month', productInspections.inspectionTime);
  } else {
    dateFormat = factoryDateSql(productInspections.inspectionTime);
  }

  const results = await db
    .select({
      timeInterval: dateFormat.as('timeInterval'),
      totalCount: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(dateFormat)
    .orderBy(dateFormat);

  return withScopeLabels(results.map(r => ({
    timeInterval: r.timeInterval,
    totalCount: Number(r.totalCount),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ntfCount: Number(r.ntfCount),
    // Canonical FINAL yield (NTF = pass, decision #4).
    yieldRate: finalYield({
      ok: Number(r.okCount),
      ntf: Number(r.ntfCount),
      total: Number(r.totalCount),
    }),
    ngRate: Number(r.totalCount) > 0
      ? ((Number(r.ngCount) / Number(r.totalCount)) * 100)
      : 0,
  })), labels);
}

// ============ ANOMALY DETECTION FUNCTIONS ============

export interface RecentYieldRow {
  date: unknown;
  totalCount: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  yieldRate: number;
  ngRate: number;
}

export async function getRecentYieldData(filters: {
  machineId?: number;
  factoryCode?: string;
  days?: number;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<RecentYieldRow>([], UNSCOPED_LABELS);

  const days = filters.days || 30;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conditions: SQL[] = [
    gte(productInspections.inspectionTime, startDate),
  ];

  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }

  // Trục phạm vi — truy vấn drizzle không bí danh.
  const { filter, labels } = await resolveStatsScope(filters);
  if (filter) conditions.push(filter);

  const results = await db
    .select({
      // Day bucket in the FACTORY timezone (gap A2).
      date: factoryDateSql(productInspections.inspectionTime).as('date'),
      totalCount: sql<number>`COUNT(*)`,
      okCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
      ngCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
      ntfCount: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
    })
    .from(productInspections)
    .where(and(...conditions))
    .groupBy(sql`date`)
    .orderBy(sql`date`);

  return withScopeLabels(results.map(r => ({
    date: r.date,
    totalCount: Number(r.totalCount),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ntfCount: Number(r.ntfCount),
    // Canonical FINAL yield (NTF = pass, decision #4).
    yieldRate: finalYield({
      ok: Number(r.okCount),
      ntf: Number(r.ntfCount),
      total: Number(r.totalCount),
    }),
    ngRate: Number(r.totalCount) > 0
      ? ((Number(r.ngCount) / Number(r.totalCount)) * 100)
      : 0,
  })), labels);
}

// ============ WORKSTATION ANALYSIS FUNCTIONS ============

export interface NGByWorkstationRow {
  workstationId: number | null;
  workstationCode: string;
  workstationName: string;
  processType: string;
  ngCount: number;
  totalCount: number;
}

export async function getNGByWorkstation(filters: {
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  factoryCode?: string;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<NGByWorkstationRow>([], UNSCOPED_LABELS);

  // Trục phạm vi — áp lên CẢ HAI truy vấn (đếm NG và đếm TỔNG). Bỏ sót truy vấn thứ hai thì
  // `ngRate` = NG-trong-phạm-vi / TỔNG-toàn-cục — vẫn rò số liệu, chỉ là dưới dạng mẫu số.
  const { filter, labels } = await resolveStatsScope(filters);

  const conditions: SQL[] = [];
  if (filter) conditions.push(filter);

  if (filters.startDate) {
    conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  // Filter for NG results
  conditions.push(eq(measurementResults.result, 'NG'));
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  // First get NG counts
  const ngResults = await db
    .select({
      workstationId: measurementPointDefs.workstationId,
      workstationCode: workstations.code,
      workstationName: workstations.name,
      processType: workstations.processType,
      ngCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(workstations, eq(measurementPointDefs.workstationId, workstations.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(whereClause)
    .groupBy(measurementPointDefs.workstationId, workstations.code, workstations.name, workstations.processType)
    .orderBy(sql`COUNT(*) DESC`);
  
  // Get total counts per workstation (all results, not just NG)
  const totalConditions: SQL[] = [];
  if (filter) totalConditions.push(filter);
  if (filters.startDate) {
    totalConditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    totalConditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    totalConditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    totalConditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const totalWhereClause = totalConditions.length > 0 ? and(...totalConditions) : undefined;
  
  const totalResults = await db
    .select({
      workstationId: measurementPointDefs.workstationId,
      totalCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .leftJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(totalWhereClause)
    .groupBy(measurementPointDefs.workstationId);
  
  // Create map of total counts
  const totalMap = new Map(totalResults.map(r => [r.workstationId, Number(r.totalCount)]));
  
  return withScopeLabels(ngResults.map(r => ({
    workstationId: r.workstationId,
    workstationCode: r.workstationCode || 'N/A',
    workstationName: r.workstationName || 'Unknown',
    processType: (r.processType || 'OTHER') as string,
    ngCount: Number(r.ngCount),
    totalCount: totalMap.get(r.workstationId) || Number(r.ngCount),
  })), labels);
}


// ============ WORKSTATION-MEASUREMENT POINT LINKED ANALYSIS ============

export interface NGByPointForWorkstationRow {
  pointDefId: number;
  pointCode: string;
  pointName: string;
  ngCount: number;
  totalCount: number;
}

export async function getNGByMeasurementPointForWorkstation(filters: {
  workstationId: number;
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  factoryCode?: string;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<NGByPointForWorkstationRow>([], UNSCOPED_LABELS);

  // Trục phạm vi — áp lên CẢ HAI truy vấn (NG và TỔNG), xem `getNGByWorkstation`.
  const { filter, labels } = await resolveStatsScope(filters);

  const conditions: SQL[] = [
    eq(measurementPointDefs.workstationId, filters.workstationId),
    eq(measurementResults.result, 'NG'),
  ];
  if (filter) conditions.push(filter);

  if (filters.startDate) {
    conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    conditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    conditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const whereClause = and(...conditions);
  
  // Get NG counts by measurement point
  const ngResults = await db
    .select({
      pointDefId: measurementPointDefs.id,
      pointCode: measurementPointDefs.code,
      pointName: measurementPointDefs.name,
      ngCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(whereClause)
    .groupBy(measurementPointDefs.id, measurementPointDefs.code, measurementPointDefs.name)
    .orderBy(sql`COUNT(*) DESC`);
  
  // Get total counts per measurement point (all results)
  const totalConditions: SQL[] = [
    eq(measurementPointDefs.workstationId, filters.workstationId),
  ];
  if (filter) totalConditions.push(filter);
  if (filters.startDate) {
    totalConditions.push(gte(productInspections.inspectionTime, filters.startDate));
  }
  if (filters.endDate) {
    totalConditions.push(lte(productInspections.inspectionTime, filters.endDate));
  }
  if (filters.machineId) {
    totalConditions.push(eq(productInspections.machineId, filters.machineId));
  }
  if (filters.factoryCode) {
    totalConditions.push(eq(productInspections.factoryCode, filters.factoryCode));
  }
  
  const totalWhereClause = and(...totalConditions);
  
  const totalResults = await db
    .select({
      pointDefId: measurementPointDefs.id,
      totalCount: sql<number>`COUNT(*)`,
    })
    .from(measurementResults)
    .innerJoin(measurementPointDefs, eq(measurementResults.pointDefId, measurementPointDefs.id))
    .leftJoin(productInspections, eq(measurementResults.inspectionId, productInspections.id))
    .where(totalWhereClause)
    .groupBy(measurementPointDefs.id);
  
  // Create map of total counts
  const totalMap = new Map(totalResults.map(r => [r.pointDefId, Number(r.totalCount)]));
  
  return withScopeLabels(ngResults.map(r => ({
    pointDefId: r.pointDefId,
    pointCode: r.pointCode || 'N/A',
    pointName: r.pointName || 'Unknown',
    ngCount: Number(r.ngCount),
    totalCount: totalMap.get(r.pointDefId) || Number(r.ngCount),
  })), labels);
}

// Get linked measurement points for a workstation
export async function getLinkedMeasurementPointsForWorkstation(workstationId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    id: measurementPointDefs.id,
    code: measurementPointDefs.code,
    name: measurementPointDefs.name,
    unit: measurementPointDefs.unit,
    lowerLimit: measurementPointDefs.lowerLimit,
    upperLimit: measurementPointDefs.upperLimit,
    nominalValue: measurementPointDefs.nominalValue,
    productModelId: measurementPointDefs.productModelId,
  })
  .from(measurementPointDefs)
  .where(eq(measurementPointDefs.workstationId, workstationId))
  .orderBy(measurementPointDefs.code);
}

// ============ MEASUREMENT POINT STATISTICS BY PRODUCT ============
export interface MeasurementPointStatsRow {
  pointDefId: number;
  pointCode: string;
  pointName: string;
  measurementType: string;
  unit: string;
  lowerLimit: number | null;
  upperLimit: number | null;
  nominalValue: number | null;
  totalCount: number;
  okCount: number;
  ngCount: number;
  ngRate: number;
  minValue: number | null;
  maxValue: number | null;
  avgValue: number | null;
}

export async function getMeasurementPointStatsByProduct(params: {
  productModelId: number;
  startDate: Date;
  endDate: Date;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return withScopeLabels<MeasurementPointStatsRow>([], UNSCOPED_LABELS);

  const startStr = params.startDate.toISOString();
  const endStr = params.endDate.toISOString();

  // Trục phạm vi — cổng nằm TRONG nhánh LATERAL (nơi có bí danh `pi`), nên DANH MỤC điểm đo của
  // sản phẩm vẫn hiện đủ với số 0, chỉ phần SỐ ĐẾM bị thu hẹp. Đây là bề mặt "cấu hình + số
  // đếm": danh mục điểm đo là dữ liệu chủ, số đếm mới là bản ghi kiểm.
  const { filter, labels } = await resolveStatsScope(params);
  const scopeGate = filter ? scopeGateOnAlias(sql`pi.id`, filter) : undefined;

  const result = await db.execute(sql`
    SELECT
      mpd.id AS "pointDefId",
      mpd.code AS "pointCode",
      mpd.name AS "pointName",
      mpd."measurementType",
      mpd.unit,
      mpd."lowerLimit",
      mpd."upperLimit",
      mpd."nominalValue",
      COALESCE(stats."totalCount", 0) AS "totalCount",
      COALESCE(stats."okCount", 0) AS "okCount",
      COALESCE(stats."ngCount", 0) AS "ngCount",
      COALESCE(stats."minValue", NULL) AS "minValue",
      COALESCE(stats."maxValue", NULL) AS "maxValue",
      COALESCE(stats."avgValue", NULL) AS "avgValue"
    FROM measurement_point_defs mpd
    LEFT JOIN LATERAL (
      SELECT
        COUNT(mr.id) AS "totalCount",
        SUM(CASE WHEN mr.result = 'OK' THEN 1 ELSE 0 END) AS "okCount",
        SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) AS "ngCount",
        MIN(mr."measuredValue"::numeric) AS "minValue",
        MAX(mr."measuredValue"::numeric) AS "maxValue",
        AVG(mr."measuredValue"::numeric) AS "avgValue"
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE mr."pointDefId" = mpd.id
        AND pi."productModelId" = ${params.productModelId}
        AND pi."inspectionTime" >= ${startStr}::timestamp
        AND pi."inspectionTime" <= ${endStr}::timestamp
        ${scopeGate ? sql`AND ${scopeGate}` : sql``}
    ) stats ON true
    WHERE mpd."productModelId" = ${params.productModelId}
      AND mpd."isActive" = true
    ORDER BY mpd."orderIndex", mpd.code
  `);

  const rows = (result as any).rows || (result as any);
  return withScopeLabels((rows as any[]).map((r: any) => ({
    pointDefId: Number(r.pointDefId),
    pointCode: r.pointCode || '',
    pointName: r.pointName || '',
    measurementType: r.measurementType || 'OTHER',
    unit: r.unit || '',
    lowerLimit: r.lowerLimit != null ? Number(r.lowerLimit) : null,
    upperLimit: r.upperLimit != null ? Number(r.upperLimit) : null,
    nominalValue: r.nominalValue != null ? Number(r.nominalValue) : null,
    totalCount: Number(r.totalCount),
    okCount: Number(r.okCount),
    ngCount: Number(r.ngCount),
    ngRate: Number(r.totalCount) > 0
      ? Number(((Number(r.ngCount) / Number(r.totalCount)) * 100).toFixed(2))
      : 0,
    minValue: r.minValue != null ? Number(Number(r.minValue).toFixed(6)) : null,
    maxValue: r.maxValue != null ? Number(Number(r.maxValue).toFixed(6)) : null,
    avgValue: r.avgValue != null ? Number(Number(r.avgValue).toFixed(6)) : null,
  })) as MeasurementPointStatsRow[], labels);
}

/**
 * Lấy danh sách ảnh (OK/NG) cho từng điểm đo theo sản phẩm trong khoảng thời gian
 *
 * ⚠ MIỄN TRỪ NHÃN (không phải miễn trừ LỌC — bộ lọc vẫn áp đủ). Hàm trả về một BẢN ĐỒ khoá theo
 * `pointDefId` (`Record<number, …>`), không phải mảng hay đối tượng cố định, nên ba ô
 * `scopeApplied`/`scopeEmptyReason`/`scopeMessage` không có chỗ đặt mà không đụng vào không gian
 * khoá số. Nơi gọi DUY NHẤT là tuyến REST ngoài `/api/external/statistics/measurement-points`
 * (`validateExternalAuth`: master-key/bearer máy-với-máy) — lối đi KHÔNG mang danh tính người
 * dùng, nên nó không truyền `userId` và cũng không có giao diện nào để hiển thị lý do.
 */
export async function getMeasurementPointImagesByProduct(params: {
  productModelId: number;
  startDate: Date;
  endDate: Date;
} & StatsScopeArgs) {
  const db = await getDb();
  if (!db) return [];

  const startStr = params.startDate.toISOString();
  const endStr = params.endDate.toISOString();

  // Trục phạm vi — `INNER JOIN product_inspections pi` ⇒ cổng bán-nối trần.
  const { filter } = await resolveStatsScope(params);
  const scopeGate = filter ? scopeGateOnAlias(sql`pi.id`, filter) : undefined;

  const result = await db.execute(sql`
    SELECT
      mr."pointDefId",
      mr.result,
      mr."imageUrl",
      mr."measuredValue",
      pi."serialNumber",
      pi."inspectionTime"
    FROM measurement_results mr
    INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
    WHERE pi."productModelId" = ${params.productModelId}
      AND pi."inspectionTime" >= ${startStr}::timestamp
      AND pi."inspectionTime" <= ${endStr}::timestamp
      AND mr."imageUrl" IS NOT NULL
      AND mr."imageUrl" != ''
      ${scopeGate ? sql`AND ${scopeGate}` : sql``}
    ORDER BY mr."pointDefId", pi."inspectionTime" DESC
  `);

  const rows = (result as any).rows || (result as any);

  // Group by pointDefId
  const grouped: Record<number, { okImages: any[]; ngImages: any[] }> = {};
  for (const r of rows as any[]) {
    const pointDefId = Number(r.pointDefId);
    if (!grouped[pointDefId]) {
      grouped[pointDefId] = { okImages: [], ngImages: [] };
    }
    const img = {
      imageUrl: r.imageUrl,
      measuredValue: r.measuredValue != null ? Number(r.measuredValue) : null,
      serialNumber: r.serialNumber || '',
      inspectionTime: r.inspectionTime,
    };
    if (r.result === 'OK') {
      grouped[pointDefId].okImages.push(img);
    } else {
      grouped[pointDefId].ngImages.push(img);
    }
  }

  return grouped;
}

// ============ DRILL-DOWN AGGREGATES (doc 67 W6) ============
//
// Thay thế đường "fetch 50k row → group bằng Map trong Node" của drillDownRouter
// (annotationRouters.ts) bằng GROUP BY trực tiếp trên product_inspections.
// Contract shape của router GIỮ NGUYÊN — các hàm này chỉ trả aggregate thô
// (bucket + đếm), router map sang code/name/yieldRate/isUnassigned như cũ.

/** 1 bucket aggregate thô của drill-down (đếm theo overallResult). */
export interface DrillAggRow {
  total: number;
  ok: number;
  ng: number;
  ntf: number;
}

/**
 * Access-control cho drill-down — SAO NGUYÊN logic của getProductInspections
 * (inspection.ts): non-admin bị giới hạn theo corporate-assignment OR
 * factory-assignment; không có assignment nào → KHÔNG có quyền (trả granted=false,
 * caller trả []).
 */
async function drillAccessCondition(
  userId?: number,
  userRole?: 'admin' | 'user',
): Promise<{ granted: boolean; condition?: SQL }> {
  if (!userId || userRole === 'admin') return { granted: true };
  const corporateAssignments = await getUserCorporateAssignments(userId);
  const factoryAssignments = await getUserFactoryAssignments(userId);
  const accessConditions: SQL[] = [];
  if (corporateAssignments.length > 0) {
    accessConditions.push(
      inArray(productInspections.corporateCode, corporateAssignments.map(a => a.corporateCode)),
    );
  }
  if (factoryAssignments.length > 0) {
    accessConditions.push(
      inArray(productInspections.factoryCode, factoryAssignments.map(a => a.factoryCode)),
    );
  }
  if (accessConditions.length === 0) return { granted: false };
  return { granted: true, condition: or(...accessConditions) as SQL };
}

/** Các cột đếm dùng chung cho 3 hàm drill (đếm theo overallResult). */
const drillCountColumns = {
  total: sql<number>`COUNT(*)`,
  ok: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'OK' THEN 1 ELSE 0 END)`,
  ng: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NG' THEN 1 ELSE 0 END)`,
  ntf: sql<number>`SUM(CASE WHEN ${productInspections.overallResult} = 'NTF' THEN 1 ELSE 0 END)`,
};

/**
 * Tầng CORPORATE: GROUP BY COALESCE(NULLIF(corporateCode,''),'Unknown') — bucket
 * 'Unknown' = sentinel "chưa gán tập đoàn" (W1), khớp hệt hành vi JS cũ
 * `corporateCode || 'Unknown'` (NULL và chuỗi rỗng đều vào bucket sentinel).
 */
export async function getDrillStatsByCorporate(filters: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}): Promise<Array<DrillAggRow & { code: string }>> {
  const db = await getDb();
  if (!db) return [];

  const access = await drillAccessCondition(filters.userId, filters.userRole);
  if (!access.granted) return [];

  const conditions: SQL[] = [];
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (access.condition) conditions.push(access.condition);

  const corpBucket = sql<string>`COALESCE(NULLIF(${productInspections.corporateCode}, ''), 'Unknown')`;

  const rows = await db
    .select({ code: corpBucket, ...drillCountColumns })
    .from(productInspections)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(corpBucket);

  return rows.map(r => ({
    code: r.code,
    total: Number(r.total),
    ok: Number(r.ok),
    ng: Number(r.ng),
    ntf: Number(r.ntf),
  }));
}

/**
 * Tầng FACTORY: GROUP BY COALESCE(NULLIF(factoryCode,''),'Unknown') trong 1
 * corporate. `unassignedCorporate: true` = drill từ sentinel 'Unknown' (W1) —
 * match corporateCode NULL/rỗng thay vì eq().
 */
export async function getDrillStatsByFactory(filters: {
  corporateCode?: string;
  /** true → lọc corporateCode NULL/'' (drill từ bucket "Chưa gán tập đoàn"). */
  unassignedCorporate?: boolean;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}): Promise<Array<DrillAggRow & { factoryCode: string }>> {
  const db = await getDb();
  if (!db) return [];

  const access = await drillAccessCondition(filters.userId, filters.userRole);
  if (!access.granted) return [];

  const conditions: SQL[] = [];
  if (filters.unassignedCorporate) {
    conditions.push(
      sql`(${productInspections.corporateCode} IS NULL OR ${productInspections.corporateCode} = '')`,
    );
  } else if (filters.corporateCode) {
    conditions.push(eq(productInspections.corporateCode, filters.corporateCode));
  }
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (access.condition) conditions.push(access.condition);

  const factoryBucket = sql<string>`COALESCE(NULLIF(${productInspections.factoryCode}, ''), 'Unknown')`;

  const rows = await db
    .select({ factoryCode: factoryBucket, ...drillCountColumns })
    .from(productInspections)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(factoryBucket);

  return rows.map(r => ({
    factoryCode: r.factoryCode,
    total: Number(r.total),
    ok: Number(r.ok),
    ng: Number(r.ng),
    ntf: Number(r.ntf),
  }));
}

/**
 * Tầng LINE: JOIN machines→stations rồi GROUP BY stations."lineId" trong 1
 * factory (lọc theo factoryCode của inspection — giữ hệt semantics cũ: chỉ đếm
 * inspection mang factoryCode của nhà máy đang drill). INNER JOIN đồng nghĩa
 * machine không gắn station bị loại — khớp JS cũ (stationIds.includes(null) = false).
 */
export async function getDrillStatsByLine(filters: {
  factoryCode: string;
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  userRole?: 'admin' | 'user';
}): Promise<Array<DrillAggRow & { lineId: number }>> {
  const db = await getDb();
  if (!db) return [];

  const access = await drillAccessCondition(filters.userId, filters.userRole);
  if (!access.granted) return [];

  const conditions: SQL[] = [eq(productInspections.factoryCode, filters.factoryCode)];
  if (filters.startDate) conditions.push(gte(productInspections.inspectionTime, filters.startDate));
  if (filters.endDate) conditions.push(lte(productInspections.inspectionTime, filters.endDate));
  if (access.condition) conditions.push(access.condition);

  const rows = await db
    .select({ lineId: stations.lineId, ...drillCountColumns })
    .from(productInspections)
    .innerJoin(machines, eq(productInspections.machineId, machines.id))
    .innerJoin(stations, eq(machines.stationId, stations.id))
    .where(and(...conditions))
    .groupBy(stations.lineId);

  return rows
    .filter(r => r.lineId != null)
    .map(r => ({
      lineId: Number(r.lineId),
      total: Number(r.total),
      ok: Number(r.ok),
      ng: Number(r.ng),
      ntf: Number(r.ntf),
    }));
}
