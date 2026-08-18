/**
 * External / on-demand report orchestration (doc 32 Wave R3 · P0 #1).
 * ============================================================================
 * THE single place that turns a report REQUEST into a persisted, downloadable
 * report FILE, wiring together the three Wave R1/R2 building blocks:
 *
 *   reportType  →  aggregator (R1)  →  renderReport (R2-A)  →  persistArtifact (R2-B)
 *
 * This replaces the pre-R3 stub in `_core/index.ts` (which counted alerts,
 * ignored `format`, and stored a JSON summary in a volatile in-memory Map with a
 * 30-minute TTL). Now every report:
 *   - pulls REAL production data through the R1 aggregators,
 *   - renders to the REQUESTED format (pdf / xlsx / csv / html — decision #6),
 *   - is archived in the report_artifacts store (S3/storage, 1-year retention),
 *   - and is re-downloadable via the artifact download route.
 *
 * Reused by the external/mobile endpoint (Wave R3) AND the on-demand web
 * "email me this report" path (Wave R4) — hence a plain service, not a route.
 *
 * HONESTY: the OEE report reads the persisted `oee_metrics` table, which R1
 * found is only written on-demand (no continuous scheduler yet), so it is often
 * sparse. We render it anyway with an honest empty state rather than faking OEE.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  renderReport,
  resolveBranding,
  type ExportColumn,
  type ReportFormat,
  type ReportLocale,
  type ReportBranding,
} from "./universalExportService";
import {
  persistArtifact,
  type ReportArtifactSource,
} from "./reportArtifactService";
import {
  getDefectParetoByCategory,
  getYieldByProduct,
  getYieldTrendByDay,
  getYieldTrendByWeek,
  getWorkstationHeatmap,
  type ReportRollupFilters,
} from "../db/reportAggregators";
import { getShiftReport, type ShiftReportRow } from "../db/statistics";
import { resolveFactoryDateWindow, executeRows } from "../utils/kpi";
// ★★★ 2026-08-17 — xem `_core/reportExportScope.ts`. `exportScopeArgs(user)` chỉ nhận `{id, role}`
// (hình dạng của `ctx.user`) nên lối "lấy danh tính từ `input`" KHÔNG diễn đạt được.
import {
  exportScopeArgs,
  exportScopeNote,
  resolveExportScope,
  type ExportActor,
} from "../_core/reportExportScope";

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export type ExternalReportType =
  | "daily"
  | "weekly"
  | "shift"
  | "defect"
  | "product"
  | "station"
  | "oee";

export const EXTERNAL_REPORT_TYPES: ExternalReportType[] = [
  "daily",
  "weekly",
  "shift",
  "defect",
  "product",
  "station",
  "oee",
];

/**
 * Accept both the new short ids and the legacy names the mobile app sends today
 * (daily_summary / shift_report / defect_analysis / station_report) so the
 * existing client keeps working while R3-B migrates.
 */
const REPORT_TYPE_ALIASES: Record<string, ExternalReportType> = {
  daily: "daily",
  daily_summary: "daily",
  weekly: "weekly",
  weekly_summary: "weekly",
  shift: "shift",
  shift_report: "shift",
  defect: "defect",
  defect_analysis: "defect",
  defect_pareto: "defect",
  product: "product",
  product_yield: "product",
  station: "station",
  station_report: "station",
  workstation: "station",
  oee: "oee",
  oee_report: "oee",
};

/** Formats the on-demand path renders (decision #6). `excel` is a legacy alias. */
const FORMAT_ALIASES: Record<string, ReportFormat> = {
  pdf: "pdf",
  xlsx: "xlsx",
  excel: "xlsx",
  csv: "csv",
  html: "html",
};

export function normalizeReportType(raw: unknown): ExternalReportType | null {
  if (typeof raw !== "string") return null;
  return REPORT_TYPE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

/** Normalize (default pdf). Returns null only for an explicitly-invalid format. */
export function normalizeFormat(raw: unknown): ReportFormat | null {
  if (raw === undefined || raw === null || raw === "") return "pdf";
  if (typeof raw !== "string") return null;
  return FORMAT_ALIASES[raw.trim().toLowerCase()] ?? null;
}

function normalizeLocale(raw: unknown): ReportLocale {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return s === "en" || s === "zh" ? (s as ReportLocale) : "vi";
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ExternalReportError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ExternalReportError";
  }
}

// ─── Inputs / outputs ──────────────────────────────────────────────────────────

export interface ExternalReportFilters {
  factoryId?: number | string;
  factory?: number | string;
  workshopId?: number | string;
  workshop?: number | string;
  lineId?: number | string;
  line?: number | string;
  machineId?: number | string;
  machine?: number | string;
  productModelId?: number | string;
  productId?: number | string;
  product?: number | string;
  stationId?: number | string;
  station?: number | string;
  shift?: string;
  machineType?: string;
  // Legacy fields the current mobile client sends.
  stationIds?: (number | string)[];
  startDate?: string;
  endDate?: string;
}

export interface GenerateExternalReportInput {
  reportType: string;
  format?: string;
  dateFrom?: string;
  dateTo?: string;
  filters?: ExternalReportFilters;
  locale?: string;
  /** Report creator (JWT external user id) — NULL for master-key server-to-server. */
  createdBy?: number | null;
  /** Artifact provenance. Default "external" (mobile / third-party). */
  source?: ReportArtifactSource;
  /**
   * ★★★ 2026-08-17 — DANH TÍNH NGƯỜI XUẤT, trục phạm vi của TOÀN BỘ họ bộ tổng hợp bên dưới.
   *
   * **Khác `createdBy`.** `createdBy` chỉ là dấu vết "ai tạo" ghi vào hàng artefact — nó KHÔNG
   * đi vào truy vấn nào. Đó chính là lỗ đã đo: `reportArtifact.generate` là `protectedProcedure`
   * mà `ctx.user.id` chỉ chạm tới `createdBy`, nên **bất kỳ tài khoản đăng nhập nào cũng dựng
   * được artefact số liệu TOÀN CỤC rồi tải về**.
   *
   * ⚠⚠ LUÔN từ `ctx.user` / `req.externalUser` (máy chủ tự xác thực), KHÔNG BAO GIỜ từ thân
   * yêu cầu. Kiểu `ExportActor` chỉ có `{id, role}` nên lối sai không diễn đạt được.
   *
   * Bỏ trống = KHÔNG lọc. Đó là hình dạng HỢP LỆ của đúng một lối đi: khoá master
   * server-to-server (`x-master-key`) ở `/api/external/reports/generate` — người gọi tin cậy,
   * không có danh tính người dùng nào để thu hẹp. Mọi lối có phiên PHẢI truyền.
   */
  actor?: ExportActor;
}

export interface GenerateExternalReportResult {
  /** report_artifacts row id (the stable report id — NOT a volatile Map key). */
  reportId: number;
  /** Canonical auth-gated artifact download path (web/session/scoped-key). */
  downloadUrl: string;
  format: ReportFormat;
  reportType: ExternalReportType;
  title: string;
  locale: ReportLocale;
  rowCount: number;
  fileSize: number;
  expiresAt: Date;
  generatedAt: string;
  /** True when the report has zero data rows (still a valid, rendered file). */
  emptyState: boolean;
  /** Honest note explaining an empty report (e.g. sparse OEE). */
  emptyReason?: string;
  /** True when an identical prior artifact (same bytes) was returned. */
  deduped: boolean;
  /** True when the dataset exceeded EXPORT_MAX_ROWS and the render was capped (doc 54 P2.4 #1). */
  truncated: boolean;
}

// ─── Window + filter resolution ────────────────────────────────────────────────

function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
}

const round2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Resolve the report window. Date-only strings ("YYYY-MM-DD") are interpreted as
 * factory-local calendar days (resolveFactoryDateWindow). When omitted, defaults
 * to "today" (factory-local start-of-day → now), matching the previous stub.
 */
export function resolveReportWindow(
  dateFrom?: string,
  dateTo?: string,
): { start: Date; end: Date } {
  const from = dateFrom?.trim();
  const to = dateTo?.trim();
  if (from && to) {
    const { start, end } = resolveFactoryDateWindow(from, to);
    return { start, end };
  }
  // Fallback: whole current day up to now.
  const now = new Date();
  const start = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
  const end = to ? new Date(to) : now;
  return { start, end };
}

/**
 * Map the flexible external filter object → the R1 aggregator filter shape.
 *
 * ⚠ `actor` là tham số RIÊNG, không lấy từ `f`: `f` là thân yêu cầu do người gọi soạn, còn
 * danh tính phải đến từ máy chủ. Hai nguồn không được trộn vào một đối tượng.
 */
export function buildRollupFilters(
  window: { start: Date; end: Date },
  f: ExternalReportFilters | undefined,
  actor?: ExportActor,
): ReportRollupFilters {
  const filters = f ?? {};
  return {
    startDate: window.start,
    endDate: window.end,
    factoryId: toInt(filters.factoryId ?? filters.factory),
    workshopId: toInt(filters.workshopId ?? filters.workshop),
    lineId: toInt(filters.lineId ?? filters.line),
    machineId: toInt(filters.machineId ?? filters.machine),
    productModelId: toInt(filters.productModelId ?? filters.productId ?? filters.product),
    ...(actor ? exportScopeArgs(actor) : {}),
  };
}

// ─── i18n column/title labels ──────────────────────────────────────────────────

type L3 = { vi: string; en: string; zh: string };
const t = (loc: ReportLocale, l: L3): string => l[loc] ?? l.vi;

const TITLES: Record<ExternalReportType, L3> = {
  daily: { vi: "Báo cáo sản xuất theo ngày", en: "Daily Production Report", zh: "每日生产报告" },
  weekly: { vi: "Báo cáo sản xuất theo tuần", en: "Weekly Production Report", zh: "每周生产报告" },
  shift: { vi: "Báo cáo theo ca", en: "Shift Report", zh: "班次报告" },
  defect: { vi: "Phân tích lỗi (Pareto theo loại)", en: "Defect Analysis (Pareto by category)", zh: "缺陷分析（按类别帕累托）" },
  product: { vi: "Sản lượng theo sản phẩm", en: "Yield by Product", zh: "按产品良率" },
  station: { vi: "Báo cáo theo công trạm", en: "Workstation Report", zh: "工位报告" },
  oee: { vi: "Báo cáo OEE", en: "OEE Report", zh: "OEE 报告" },
};

const COL = {
  date: { vi: "Ngày", en: "Date", zh: "日期" } as L3,
  week: { vi: "Tuần", en: "Week", zh: "周" } as L3,
  isoWeek: { vi: "Tuần ISO", en: "ISO week", zh: "ISO 周" } as L3,
  total: { vi: "Tổng", en: "Total", zh: "总数" } as L3,
  ok: { vi: "OK", en: "OK", zh: "OK" } as L3,
  ng: { vi: "NG", en: "NG", zh: "NG" } as L3,
  ntf: { vi: "NTF", en: "NTF", zh: "NTF" } as L3,
  yield: { vi: "Sản lượng %", en: "Yield %", zh: "良率 %" } as L3,
  ngRate: { vi: "Tỉ lệ NG %", en: "NG rate %", zh: "NG 率 %" } as L3,
  fpy: { vi: "FPY %", en: "FPY %", zh: "FPY %" } as L3,
  shift: { vi: "Ca", en: "Shift", zh: "班次" } as L3,
  shiftWindow: { vi: "Khung giờ", en: "Window", zh: "时段" } as L3,
  machines: { vi: "Số máy", en: "Machines", zh: "机台数" } as L3,
  defectTypes: { vi: "Số loại lỗi", en: "Defect types", zh: "缺陷类型数" } as L3,
  category: { vi: "Loại lỗi", en: "Category", zh: "缺陷类别" } as L3,
  count: { vi: "Số lượng", en: "Count", zh: "数量" } as L3,
  pct: { vi: "Tỉ lệ %", en: "Share %", zh: "占比 %" } as L3,
  cumPct: { vi: "Lũy kế %", en: "Cumulative %", zh: "累计 %" } as L3,
  productCode: { vi: "Mã SP", en: "Product code", zh: "产品编码" } as L3,
  productName: { vi: "Tên SP", en: "Product name", zh: "产品名称" } as L3,
  workstation: { vi: "Công trạm", en: "Workstation", zh: "工位" } as L3,
  inspections: { vi: "Số lần đo", en: "Inspections", zh: "检测数" } as L3,
  machineCode: { vi: "Mã máy", en: "Machine code", zh: "机台编码" } as L3,
  availability: { vi: "Sẵn sàng %", en: "Availability %", zh: "可用率 %" } as L3,
  performance: { vi: "Hiệu suất %", en: "Performance %", zh: "性能 %" } as L3,
  quality: { vi: "Chất lượng %", en: "Quality %", zh: "质量 %" } as L3,
  oee: { vi: "OEE %", en: "OEE %", zh: "OEE %" } as L3,
  good: { vi: "Đạt", en: "Good", zh: "良品" } as L3,
  reject: { vi: "Loại bỏ", en: "Reject", zh: "废品" } as L3,
};

function col(key: string, label: L3, loc: ReportLocale, format?: ExportColumn["format"], width?: number): ExportColumn {
  return { key, header: t(loc, label), format, width };
}

// ─── OEE (persisted metrics — honestly sparse) ─────────────────────────────────

interface OeeRow {
  day: string;
  machineCode: string;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  total: number;
  good: number;
  reject: number;
}

/**
 * Per-machine-per-day OEE from the persisted oee_metrics table (values stored
 * ×100 → /100 back to a percent number). Scoped to the window + optional
 * machineId. Sparse by design (R1 finding: OEE is written on-demand only).
 *
 * ★★★ 2026-08-17 — PHẠM VI CHO MỘT BẢNG KHÔNG CÓ CỘT TENANT.
 *
 * `oee_metrics` (drizzle/schema/oee.ts) chỉ có `machineId`/`machineCode` — **không có**
 * `factoryCode`/`corporateCode`, nên mệnh đề của `getAccessFilterConditions` (vốn nói về
 * `"product_inspections"."factoryCode"`) không gắn thẳng vào được.
 *
 * Bản vá **không** dựng lại luật phân quyền theo đường `machines → stations → production_lines
 * → workshops → factories.code`. Làm thế là tạo NGUỒN THỨ HAI của cùng một luật — cái sẽ lệch
 * khỏi `getAccessFilterConditions` ở lần sửa sau mà không lưới nào đỏ. Thay vào đó nó **dùng
 * lại đúng mệnh đề ấy** trong một truy vấn phụ trên `product_inspections`: máy nào có bản ghi
 * kiểm NẰM TRONG phạm vi người xem, TRONG CÙNG cửa sổ thời gian.
 *
 * ⚠ Đánh đổi đã biết, nói ra thay vì giấu: một máy có hàng OEE nhưng KHÔNG có bản ghi kiểm nào
 * trong cửa sổ sẽ rơi khỏi báo cáo của người bị thu hẹp (admin không bị ảnh hưởng — họ không có
 * mệnh đề nào). Sai lệch nghiêng về phía ĐÓNG (thiếu một dòng), không về phía RÒ (lộ máy của
 * nhà máy khác). Cửa sổ trong truy vấn phụ giữ nó khỏi thành một lượt quét toàn bảng.
 */
async function fetchOeeReportRows(
  window: { start: Date; end: Date },
  machineId?: number,
  scopeFilter?: import("drizzle-orm").SQL,
): Promise<OeeRow[]> {
  const db = await getDb();
  if (!db) return [];
  // ⚠⚠ BUG CÓ SẴN, PHÁT HIỆN 2026-08-17 khi dựng lưới cho bản vá này: hai mốc dưới đây trước
  // đây được nhúng dưới dạng **đối tượng `Date`**. postgres.js từ chối tham số ấy —
  // `ERR_INVALID_ARG_TYPE: The "string" argument must be of type string … Received an instance
  // of Date` — nên báo cáo `oee` **CHƯA BAO GIỜ chạy được trên CSDL thật**; nó chỉ xanh trong
  // `externalReportService.test.ts` vì file đó giả lập `getDb`. Truyền chuỗi ISO như MỌI truy
  // vấn thô khác trong repo (`dataComparisonService`, `db/statistics`).
  const startStr = window.start.toISOString();
  const endStr = window.end.toISOString();
  const machineFilter = machineId ? sql` AND "machineId" = ${machineId}` : sql``;
  const tenantFilter = scopeFilter
    ? sql` AND "machineId" IN (
        SELECT DISTINCT product_inspections."machineId"
        FROM product_inspections
        WHERE product_inspections."inspectionTime" >= ${startStr}
          AND product_inspections."inspectionTime" < ${endStr}
          AND ${scopeFilter}
      )`
    : sql``;
  const res = await db.execute(sql`
    SELECT
      TO_CHAR(date_trunc('day', "timestamp"), 'YYYY-MM-DD') AS day,
      "machineCode" AS machine_code,
      ROUND(AVG(availability) / 100.0, 2)::float AS availability,
      ROUND(AVG(performance)  / 100.0, 2)::float AS performance,
      ROUND(AVG(quality)      / 100.0, 2)::float AS quality,
      ROUND(AVG(oee)          / 100.0, 2)::float AS oee,
      SUM("totalCount")::int  AS total_count,
      SUM("goodCount")::int   AS good_count,
      SUM("rejectCount")::int AS reject_count
    FROM oee_metrics
    WHERE "timestamp" >= ${startStr} AND "timestamp" < ${endStr}${machineFilter}${tenantFilter}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  const rows = executeRows(res);
  return rows.map((r) => ({
    day: String(r.day),
    machineCode: String(r.machine_code ?? ""),
    availability: r.availability == null ? null : Number(r.availability),
    performance: r.performance == null ? null : Number(r.performance),
    quality: r.quality == null ? null : Number(r.quality),
    oee: r.oee == null ? null : Number(r.oee),
    total: Number(r.total_count) || 0,
    good: Number(r.good_count) || 0,
    reject: Number(r.reject_count) || 0,
  }));
}

// ─── Report-type dispatch: reportType → aggregator → (columns, rows) ────────────

interface ReportData {
  columns: ExportColumn[];
  rows: Record<string, any>[];
  emptyReason?: string;
}

async function buildReportData(
  reportType: ExternalReportType,
  window: { start: Date; end: Date },
  rollup: ReportRollupFilters,
  filters: ExternalReportFilters | undefined,
  loc: ReportLocale,
  /** ⚠ CHỈ dùng cho `oee_metrics` (bảng không có cột tenant) — xem `fetchOeeReportRows`. */
  oeeScopeFilter?: import("drizzle-orm").SQL,
): Promise<ReportData> {
  switch (reportType) {
    case "daily": {
      // ★ 2026-08-17 — ĐỔI NGUỒN: `db/statistics.getYieldTrendData` → `getYieldTrendByDay`.
      // Hàm cũ KHÔNG có trục `userId`; thứ duy nhất nó nhận là MỘT `factoryCode` đơn lẻ, nên
      // một người được gán HAI nhà máy không diễn đạt được — bản vá "truyền factoryCode" vừa
      // để lọt vừa chặn nhầm theo cấu tạo. Bản `day` ở `db/reportAggregators.ts` đi qua CÙNG
      // `scopedConditions` với ba bộ tổng hợp còn lại (xem docblock của hàm ấy).
      const rows = await getYieldTrendByDay(rollup);
      return {
        columns: [
          col("day", COL.date, loc, "text", 16),
          col("total", COL.total, loc, "number"),
          col("ok", COL.ok, loc, "number"),
          col("ng", COL.ng, loc, "number"),
          col("ntf", COL.ntf, loc, "number"),
          col("yield", COL.yield, loc, "percentage"),
          col("ngRate", COL.ngRate, loc, "percentage"),
        ],
        rows: rows.map((r) => ({
          day: r.day,
          total: r.total,
          ok: r.ok,
          ng: r.ng,
          ntf: r.ntf,
          yield: round2(r.yieldRate),
          ngRate: round2(r.ngRate),
        })),
      };
    }

    case "weekly": {
      const rows = await getYieldTrendByWeek(rollup);
      return {
        columns: [
          col("week", COL.week, loc, "text", 16),
          col("isoWeek", COL.isoWeek, loc, "text", 14),
          col("total", COL.total, loc, "number"),
          col("ok", COL.ok, loc, "number"),
          col("ng", COL.ng, loc, "number"),
          col("ntf", COL.ntf, loc, "number"),
          col("yield", COL.yield, loc, "percentage"),
        ],
        rows: rows.map((r) => ({
          week: r.week,
          isoWeek: r.isoWeek,
          total: r.total,
          ok: r.ok,
          ng: r.ng,
          ntf: r.ntf,
          yield: r.yieldRate,
        })),
      };
    }

    case "shift": {
      // ⚠ Kiểu KHAI BÁO là mảng trần có chủ đích: `getShiftReport` trả `ScopedRows<…>` (mảng có
      // đính nhãn phạm vi), nhưng `.filter()` bên dưới sinh ra mảng MỚI không còn nhãn. Đây là
      // đường xuất báo cáo, không phải bề mặt vẽ số 0 cho người vận hành, nên bỏ nhãn ở đây là
      // đúng — chỉ cần nói ra thay vì để `tsc` bịt miệng bằng một phép ép kiểu.
      let rows: ShiftReportRow[] = await getShiftReport({
        startDate: window.start,
        endDate: window.end,
        factoryId: rollup.factoryId,
        lineId: rollup.lineId,
        // `getShiftReport` ĐÃ có sẵn trục danh tính (`filters.userId && userRole !== 'admin'`);
        // lỗ ở đây là NƠI GỌI chưa bao giờ truyền nó xuống.
        userId: rollup.userId,
        userRole: rollup.userRole,
      });
      const wantShift = filters?.shift?.trim();
      if (wantShift) rows = rows.filter((r) => r.shift === wantShift || r.shiftName === wantShift);
      return {
        columns: [
          col("shiftName", COL.shift, loc, "text", 18),
          col("shiftWindow", COL.shiftWindow, loc, "text", 16),
          col("total", COL.total, loc, "number"),
          col("ok", COL.ok, loc, "number"),
          col("ng", COL.ng, loc, "number"),
          col("ntf", COL.ntf, loc, "number"),
          col("yield", COL.yield, loc, "percentage"),
          col("fpy", COL.fpy, loc, "percentage"),
          col("machines", COL.machines, loc, "number"),
          col("defectTypes", COL.defectTypes, loc, "number"),
        ],
        rows: rows.map((r) => ({
          shiftName: r.shiftName,
          shiftWindow: r.shiftWindow,
          total: r.total,
          ok: r.ok,
          ng: r.ng,
          ntf: r.ntf,
          yield: r.yieldPct,
          fpy: r.fpy,
          machines: r.machinesActive,
          defectTypes: r.defectTypeCount,
        })),
      };
    }

    case "defect": {
      const pareto = await getDefectParetoByCategory({ ...rollup, dimension: "category" });
      return {
        columns: [
          col("category", COL.category, loc, "text", 24),
          col("count", COL.count, loc, "number"),
          col("pct", COL.pct, loc, "percentage"),
          col("cumPct", COL.cumPct, loc, "percentage"),
        ],
        rows: pareto.items.map((i) => ({
          category: i.key,
          count: i.count,
          pct: i.percentage,
          cumPct: i.cumulativePercentage,
        })),
        emptyReason:
          pareto.totalDefects === 0
            ? t(loc, {
                vi: "Không có lỗi NG trong kỳ.",
                en: "No NG defects in this period.",
                zh: "本期无 NG 缺陷。",
              })
            : undefined,
      };
    }

    case "product": {
      const rows = await getYieldByProduct(rollup);
      return {
        columns: [
          col("productCode", COL.productCode, loc, "text", 18),
          col("productName", COL.productName, loc, "text", 28),
          col("total", COL.total, loc, "number"),
          col("ok", COL.ok, loc, "number"),
          col("ng", COL.ng, loc, "number"),
          col("ntf", COL.ntf, loc, "number"),
          col("yield", COL.yield, loc, "percentage"),
        ],
        rows: rows.map((r) => ({
          productCode: r.productCode ?? "—",
          productName: r.productName ?? t(loc, { vi: "(Chưa gán SP)", en: "(Unassigned product)", zh: "(未分配产品)" }),
          total: r.total,
          ok: r.ok,
          ng: r.ng,
          ntf: r.ntf,
          yield: r.yieldRate,
        })),
      };
    }

    case "station": {
      const rows = await getWorkstationHeatmap(rollup);
      return {
        columns: [
          col("workstation", COL.workstation, loc, "text", 28),
          col("ng", COL.ng, loc, "number"),
          col("inspections", COL.inspections, loc, "number"),
          col("ngRate", COL.ngRate, loc, "percentage"),
        ],
        rows: rows.map((r) => ({
          workstation: r.workstationName,
          ng: r.ngCount,
          inspections: r.inspectionCount,
          ngRate: r.ngRate,
        })),
      };
    }

    case "oee": {
      const rows = await fetchOeeReportRows(window, rollup.machineId, oeeScopeFilter);
      return {
        columns: [
          col("day", COL.date, loc, "text", 16),
          col("machineCode", COL.machineCode, loc, "text", 16),
          col("availability", COL.availability, loc, "percentage"),
          col("performance", COL.performance, loc, "percentage"),
          col("quality", COL.quality, loc, "percentage"),
          col("oee", COL.oee, loc, "percentage"),
          col("total", COL.total, loc, "number"),
          col("good", COL.good, loc, "number"),
          col("reject", COL.reject, loc, "number"),
        ],
        rows: rows.map((r) => ({
          day: r.day,
          machineCode: r.machineCode,
          availability: r.availability,
          performance: r.performance,
          quality: r.quality,
          oee: r.oee,
          total: r.total,
          good: r.good,
          reject: r.reject,
        })),
        emptyReason:
          rows.length === 0
            ? t(loc, {
                vi: "Chưa có số liệu OEE trong kỳ (OEE hiện chỉ được ghi khi tính thủ công — chưa có bộ lập lịch liên tục).",
                en: "No OEE metrics in this window (OEE is only recorded on manual calculation — no continuous scheduler yet).",
                zh: "本期无 OEE 数据（OEE 目前仅在手动计算时写入，尚无持续调度器）。",
              })
            : undefined,
      };
    }
  }
}

/**
 * Human-readable window + filter summary for the report subtitle.
 *
 * ★ `scopeNote` (2026-08-17): một PDF của `engineer1` (gán một nhà máy) chứa 22.995 dòng trông
 * y hệt báo cáo TOÀN CÔNG TY 22.996 — chênh đúng một hàng, và không ô nào trên trang nói rằng
 * đây chỉ là một nhà máy. File rời khỏi hệ thống rồi được chuyển tiếp, in ra, dán vào slide
 * họp; lúc ấy không còn ngữ cảnh nào để đính chính. Nên tài liệu TỰ KHAI phạm vi của nó, đúng
 * theo tiền lệ vừa dựng ở `pdfReportRouter`/`powerpointRouter`. Admin không nhận câu này —
 * báo cáo của họ ĐÚNG là toàn hệ thống.
 */
function buildSubtitle(
  window: { start: Date; end: Date },
  filters: ExternalReportFilters | undefined,
  loc: ReportLocale,
  scopeNote?: string,
): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const parts = [`${fmt(window.start)} → ${fmt(window.end)}`];
  const f = filters ?? {};
  const scope: string[] = [];
  const factoryId = toInt(f.factoryId ?? f.factory);
  const lineId = toInt(f.lineId ?? f.line);
  const machineId = toInt(f.machineId ?? f.machine);
  const productId = toInt(f.productModelId ?? f.productId ?? f.product);
  if (factoryId) scope.push(`${t(loc, { vi: "Nhà máy", en: "Factory", zh: "工厂" })}#${factoryId}`);
  if (lineId) scope.push(`${t(loc, { vi: "Dây chuyền", en: "Line", zh: "产线" })}#${lineId}`);
  if (machineId) scope.push(`${t(loc, { vi: "Máy", en: "Machine", zh: "机台" })}#${machineId}`);
  if (productId) scope.push(`${t(loc, { vi: "SP", en: "Product", zh: "产品" })}#${productId}`);
  if (f.shift) scope.push(`${t(loc, { vi: "Ca", en: "Shift", zh: "班次" })} ${f.shift}`);
  if (scope.length) parts.push(scope.join(" · "));
  if (scopeNote) parts.push(scopeNote);
  return parts.join("  |  ");
}

// ─── The orchestrator ──────────────────────────────────────────────────────────

/**
 * Generate a report end-to-end: resolve window/filters → aggregate real data →
 * render to the requested format → persist as an artifact → return the artifact
 * id + download url. Throws ExternalReportError(400) for a bad reportType/format.
 */
export async function generateExternalReport(
  input: GenerateExternalReportInput,
): Promise<GenerateExternalReportResult> {
  const reportType = normalizeReportType(input.reportType);
  if (!reportType) {
    throw new ExternalReportError(
      400,
      `Invalid reportType. Supported: ${EXTERNAL_REPORT_TYPES.join(", ")} (legacy aliases daily_summary/shift_report/defect_analysis/station_report accepted).`,
    );
  }

  const format = normalizeFormat(input.format);
  if (!format) {
    throw new ExternalReportError(400, "Invalid format. Must be one of: pdf, xlsx, csv (or legacy 'excel').");
  }

  const locale = normalizeLocale(input.locale);

  // The current mobile client nests startDate/endDate under filters; accept both.
  const dateFrom = input.dateFrom ?? input.filters?.startDate;
  const dateTo = input.dateTo ?? input.filters?.endDate;
  const window = resolveReportWindow(dateFrom, dateTo);
  const rollup = buildRollupFilters(window, input.filters, input.actor);

  // ⚠⚠ HAI BIẾN RIÊNG, CỐ Ý. `resolveExportScope` trả về ĐÚNG BA Ô CHỮ (`scopeLabelsOf`), còn
  // `filter` — đối tượng SQL drizzle có tham chiếu vòng — chỉ tồn tại trong `oeeScopeFilter` và
  // không có đường nào đi ra ngoài. Gộp chúng làm một là công thức của
  // `Converting circular structure to JSON` mà `tsc` không bắt được (xem `accessControlLabels`).
  const scope = input.actor ? await resolveExportScope(input.actor) : undefined;
  const oeeScopeFilter =
    input.actor && reportType === "oee"
      ? (await import("../_core/accessControl")).getAccessFilterConditions(
          input.actor.id,
          input.actor.role,
        )
      : undefined;

  const { columns, rows, emptyReason } = await buildReportData(
    reportType,
    window,
    rollup,
    input.filters,
    locale,
    await oeeScopeFilter,
  );

  const title = t(locale, TITLES[reportType]);
  const scopeNote = scope ? exportScopeNote(scope) : undefined;
  const subtitle = buildSubtitle(window, input.filters, locale, scopeNote);

  // Branding from the company profile — never blocks a report.
  let branding: ReportBranding | undefined;
  try {
    branding = await resolveBranding();
  } catch {
    branding = undefined;
  }

  const rendered = await renderReport({
    type: reportType,
    title,
    subtitle,
    format,
    locale,
    branding,
    columns,
    data: rows,
    fileName: `${reportType}-report`,
  });

  const persisted = await persistArtifact({
    buffer: rendered.buffer,
    format,
    reportType,
    title,
    params: {
      reportType,
      format,
      locale,
      window: { start: window.start.toISOString(), end: window.end.toISOString() },
      filters: input.filters ?? {},
      rowCount: rows.length,
      truncated: rendered.truncated,
      totalRows: rendered.totalRows,
      // Dấu vết phạm vi đi kèm HÀNG artefact, không chỉ trên trang giấy: một file tải lại sau
      // sáu tháng vẫn trả lời được câu "số này của ai" mà không phải đoán từ `createdBy`.
      // ⚠ CHỈ ba ô CHỮ — `filter` không bao giờ được serialize (tham chiếu vòng ⇒ 500).
      ...(scope
        ? {
            scopeApplied: scope.scopeApplied,
            scopeEmptyReason: scope.scopeEmptyReason,
          }
        : {}),
    },
    createdBy: input.createdBy ?? null,
    source: input.source ?? "external",
    contentType: rendered.mimeType,
  });

  return {
    reportId: persisted.id,
    downloadUrl: persisted.downloadUrl,
    format,
    reportType,
    title,
    locale,
    rowCount: rows.length,
    fileSize: persisted.fileSize,
    expiresAt: persisted.expiresAt,
    generatedAt: new Date().toISOString(),
    emptyState: rows.length === 0,
    emptyReason: rows.length === 0 ? emptyReason : undefined,
    deduped: persisted.deduped,
    truncated: Boolean(rendered.truncated),
  };
}
