/**
 * W5-D (doc 27 §6 gap A10) — RAW DATA EXPORT: streaming CSV/JSON.
 * ════════════════════════════════════════════════════════════════════════════
 *   GET /api/export/inspections.csv | .json
 *   GET /api/export/measurements.csv | .json   (separate endpoint — volume)
 *
 * Contract (documented in docs/ECOSYSTEM/30_BI_EXPORT_API.md):
 *   • AUTH — either a browser session cookie (any logged-in user; rows are
 *     tenant-scoped through the same access filter the History list uses) or
 *     an API key with the `export:read` scope (Authorization: Bearer <key> or
 *     X-API-Key). No credential → 401; key without scope → 403.
 *   • WINDOW — `from` and `to` are REQUIRED (ISO date/datetime) and the span
 *     is capped at EXPORT_MAX_WINDOW_DAYS (default 92) → 400 otherwise.
 *   • FILTERS — optional machineId, result (OK|NG|NTF), product (substring of
 *     productModel), factoryCode, corporateCode.
 *   • STREAMING — cursor/keyset-paged DB reads (page ≤ 500/1000 rows) written
 *     to the response per page; the full result set is NEVER buffered. Client
 *     disconnect stops the DB loop.
 *   • RATE LIMIT — a dedicated stricter limiter (EXPORT_RATE_LIMIT_PER_5MIN,
 *     default 10 per principal per 5 min) on top of the global /api limiter.
 *   • AUDIT — every export writes an audit_logs row (who, window, filters,
 *     row count, completion status).
 *
 * Column set = the audited list projection (server/db/inspection.ts,
 * inspectionListProjection — doc 27 gap B9); measurement rollups are the
 * separate /measurements endpoint rather than an ?include= explosion.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { and, asc, eq, exists, gt, gte, inArray, like, lte, sql, type SQL } from "drizzle-orm";
import { apiKeyGenerator } from "../../_core/rateLimitConfig";
import { resolvePrincipal, type ApiPrincipal } from "../v1/auth";
import { API_SCOPES } from "../v1/scopes";
import { scopeSatisfied } from "../v1/scopes";
import {
  TENANT_SCOPE_UNDECLARED_CODE,
  TENANT_SCOPE_UNDECLARED_MESSAGE,
  inspectionTenantFilter,
  isTenantScopeDeclared,
  tenantCodeScopeOf,
  tenantScopeDescriptor,
  tenantScopeUndeclaredDetails,
  type ApiKeyTenantScope,
} from "../v1/apiKeyScope";
import type { TenantCodeScope } from "../../_core/tenantCodeScope";
import {
  toCsvLine,
  rowToCsvLine,
  jsonStreamChunk,
  renderReport,
  resolveBranding,
  type ExportColumn,
  type ReportFormat,
} from "../../services/universalExportService";

// ── Tunables ──────────────────────────────────────────────────────────────────

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Maximum allowed [from, to] span in days (window guard). */
export const EXPORT_MAX_WINDOW_DAYS = intEnv("EXPORT_MAX_WINDOW_DAYS", 92);
/** Rows per DB page for the inspections stream. */
const INSPECTION_PAGE_SIZE = intEnv("EXPORT_INSPECTION_PAGE_SIZE", 500);
/** Rows per DB page for the measurements stream. */
const MEASUREMENT_PAGE_SIZE = intEnv("EXPORT_MEASUREMENT_PAGE_SIZE", 1000);
/**
 * XLSX/PDF are BUFFERED (renderReport can't stream), so the row-level datasets
 * (inspections/measurements) are capped for the document formats to bound memory
 * — CSV/JSON stay streamed and uncapped. Aggregate datasets (yield/oee/defect)
 * are naturally small rollups.
 */
const XLSX_MAX_ROWS = intEnv("EXPORT_XLSX_MAX_ROWS", 100000);
const PDF_MAX_ROWS = intEnv("EXPORT_PDF_MAX_ROWS", 5000);

function docRowCap(format: "xlsx" | "pdf"): number {
  return format === "pdf" ? PDF_MAX_ROWS : XLSX_MAX_ROWS;
}

// ── Authentication (session OR scoped API key) ───────────────────────────────

export interface ExportPrincipal {
  kind: "session" | "api-key";
  name: string;
  /** Session principals carry the user for tenant-scoped row access. */
  userId?: number;
  userRole?: string;
  /**
   * mig 0325 — phạm vi tenant của KHOÁ API (`null` mode = chưa khai ⇒ đã bị 403 chặn trước
   * khi tới đây). Principal PHIÊN không dùng ô này: hàng của phiên vẫn được thu hẹp bằng
   * `userId`/`userRole` qua đúng bộ lọc mà danh sách Lịch sử dùng — hai đường khác nhau, và
   * gán nhầm 'global' cho phiên sẽ vô hiệu hoá phép lọc theo người dùng. Xem `authenticateExportRequest`.
   */
  tenantScope?: ApiKeyTenantScope;
}

/**
 * Điều kiện tenant của KHOÁ API cho một truy vấn trên `product_inspections`.
 * `undefined` khi: principal là PHIÊN (đường lọc theo người dùng lo việc ấy) hoặc khoá khai
 * TOÀN CỤC TƯỜNG MINH. Mọi đường còn lại đã bị 403 ở `authenticateExportRequest`.
 */
function apiKeyTenantCondition(principal: ExportPrincipal): SQL | undefined {
  if (principal.kind !== "api-key") return undefined;
  return inspectionTenantFilter(principal.tenantScope);
}

// ── ★★★ 2026-08-18 — TRỤC PHẠM VI cho BA DATASET TỔNG HỢP (yield / oee / defect-pareto) ──────
//
// Ba tuyến này trước đây trả **403 `dataset_not_tenant_scopable`** cho khoá phạm vi-nhà-máy, vì
// `db/reportAggregators` chỉ có trục danh tính NGƯỜI DÙNG. Nay nó có trục thứ hai (mã tenant
// tường minh), nên 403 ấy không còn lý do tồn tại và đã bị gỡ.
//
// ⚠ ĐỒNG THỜI vá một lỗ CÙNG HỌ mà 403 kia che mất: principal **PHIÊN** cũng chưa bao giờ được
// thu hẹp trên ba tuyến này (`buildYieldDataset(from, to, machineId)` — không có ô danh tính
// nào). Tức một tài khoản đã đăng nhập, dù chỉ được gán một nhà máy, vẫn tải về sản lượng và
// Pareto lỗi của TOÀN BỘ nhà máy. Hai principal, một cổng, hai trục.

/**
 * ĐÚNG MỘT trục phạm vi cho một principal xuất báo cáo.
 *
 * ⚠ Trả về `{}` cho khoá TOÀN CỤC và cho phiên không mang danh tính — tức "không lọc". Đó là
 * hình dạng ĐÚNG ở đây (khoá toàn cục là một quyết định ai đó đã ghi ra), khác hẳn với ô
 * `tenantScope` RỖNG (`{}` bên trong trục ②) vốn mang nghĩa `1 = 0`.
 */
type ReportScopeAxis =
  | { userId?: number; userRole?: string; tenantScope?: never }
  | { tenantScope: TenantCodeScope; userId?: never; userRole?: never };

function reportScopeAxisOf(principal: ExportPrincipal): ReportScopeAxis {
  if (principal.kind === "api-key") {
    const codes = tenantCodeScopeOf(principal.tenantScope);
    return codes ? { tenantScope: codes } : {};
  }
  return { userId: principal.userId, userRole: principal.userRole };
}

/**
 * Tập `factories.id` trong phạm vi — cho `oee_metrics`, bảng KHÔNG có cột tenant nào.
 * `null` = không áp cổng (khoá toàn cục / admin / lối đi không danh tính); `[]` ⇒ `1 = 0`.
 */
async function reportFactoryIdsOf(principal: ExportPrincipal): Promise<number[] | null> {
  const { resolveTenantCodeFactoryIds, resolveTenantFactoryScope } = await import(
    "../../db/reportAggregators"
  );
  if (principal.kind === "api-key") {
    const codes = tenantCodeScopeOf(principal.tenantScope);
    if (!codes) return null; // khoá TOÀN CỤC TƯỜNG MINH
    return (await resolveTenantCodeFactoryIds(codes)).factoryIds;
  }
  return (await resolveTenantFactoryScope({ userId: principal.userId, userRole: principal.userRole }))
    .factoryIds;
}

function extractApiKey(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    const tok = auth.replace(/^bearer\s+/i, "").trim();
    if (tok) return tok;
  }
  const xkey = req.header("x-api-key");
  if (xkey && xkey.trim()) return xkey.trim();
  return null;
}

/**
 * Resolve the caller: an API key (must satisfy the required scope) wins when
 * present; otherwise a signed-in browser session. Fail-safe: any resolution
 * error denies.
 */
export async function authenticateExportRequest(
  req: Request,
  requiredScope: string,
): Promise<{
  principal: ExportPrincipal | null;
  status: 401 | 403 | 200;
  message?: string;
  code?: string;
  details?: unknown;
}> {
  const key = extractApiKey(req);
  if (key) {
    let apiPrincipal: ApiPrincipal | null = null;
    try {
      apiPrincipal = await resolvePrincipal(key);
    } catch {
      apiPrincipal = null;
    }
    if (!apiPrincipal) return { principal: null, status: 401, message: "Invalid or expired API key." };
    if (!scopeSatisfied(apiPrincipal.scopes, requiredScope as never)) {
      return {
        principal: null,
        status: 403,
        message: `This API key lacks the required scope "${requiredScope}".`,
      };
    }
    // ★ FAIL-CLOSED (mig 0325). `scopes` vừa trả lời "LÀM ĐƯỢC GÌ"; giờ hỏi "THẤY ĐƯỢC GÌ".
    //   Chưa khai phạm vi ⇒ 403 kèm câu nói ĐÚNG lý do — không phải 200 với 0 dòng (dạy người
    //   tích hợp rằng "không có dữ liệu"), không phải 500.
    if (!isTenantScopeDeclared(apiPrincipal.tenantScope)) {
      return {
        principal: null,
        status: 403,
        message: TENANT_SCOPE_UNDECLARED_MESSAGE.vi,
        code: TENANT_SCOPE_UNDECLARED_CODE,
        details: tenantScopeUndeclaredDetails(),
      };
    }
    return {
      principal: { kind: "api-key", name: apiPrincipal.name, tenantScope: apiPrincipal.tenantScope },
      status: 200,
    };
  }

  // Browser session (cookie) — same authenticator tRPC context uses.
  try {
    const { sdk } = await import("../../_core/sdk");
    const user = await sdk.authenticateRequest(req as never);
    if (user) {
      return {
        principal: { kind: "session", name: user.name ?? user.email ?? `user:${user.id}`, userId: user.id, userRole: (user as { role?: string }).role },
        status: 200,
      };
    }
  } catch {
    /* fall through → 401 */
  }
  return {
    principal: null,
    status: 401,
    message: "Authentication required: session cookie or API key (Bearer / X-API-Key) with export scope.",
  };
}

// ── Window guard ──────────────────────────────────────────────────────────────

export interface ParsedWindow {
  from: Date;
  to: Date;
}

/** Parse+validate the required from/to window. Returns an error string or the window. */
export function parseExportWindow(
  fromRaw: unknown,
  toRaw: unknown,
  maxDays = EXPORT_MAX_WINDOW_DAYS,
): { window?: ParsedWindow; error?: string } {
  if (typeof fromRaw !== "string" || !fromRaw || typeof toRaw !== "string" || !toRaw) {
    return { error: "Query params `from` and `to` (ISO date/datetime) are REQUIRED." };
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "Invalid `from`/`to` — use ISO-8601 (e.g. 2026-06-01 or 2026-06-01T00:00:00Z)." };
  }
  if (from.getTime() >= to.getTime()) {
    return { error: "`from` must be before `to`." };
  }
  const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (spanDays > maxDays) {
    return { error: `Window too large: ${Math.ceil(spanDays)}d requested, max ${maxDays}d. Export in slices.` };
  }
  return { window: { from, to } };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** The audited list projection column order (doc 27 gap B9). */
export const INSPECTION_EXPORT_COLUMNS = [
  "id",
  "serialNumber",
  "overallResult",
  "originalResult",
  "aiDecision",
  "inspectionTime",
  "cycleTime",
  "machineId",
  "productModelId",
  "productModel",
  "batchNumber",
  "corporateCode",
  "factoryCode",
  "workshopCode",
  "lineCode",
  "stageCode",
  "acknowledgedBy",
  "acknowledgedAt",
  "createdAt",
] as const;

export const MEASUREMENT_EXPORT_COLUMNS = [
  "id",
  "inspectionId",
  "serialNumber",
  "inspectionTime",
  "machineId",
  "pointDefId",
  "pointCode",
  "pointName",
  "measuredValue",
  "measuredValueText",
  "result",
  "defectCatalogId",
  "defectCode",
  "defectName",
  "defectSeverity",
  "aiConfidence",
] as const;

interface CommonFilters {
  machineId?: number;
  result?: "OK" | "NG" | "NTF";
  product?: string;
  factoryCode?: string;
  corporateCode?: string;
}

function parseCommonFilters(req: Request): CommonFilters {
  const q = req.query;
  const filters: CommonFilters = {};
  const machineId = Number(q.machineId);
  if (Number.isInteger(machineId) && machineId > 0) filters.machineId = machineId;
  if (q.result === "OK" || q.result === "NG" || q.result === "NTF") filters.result = q.result;
  if (typeof q.product === "string" && q.product) filters.product = q.product;
  if (typeof q.factoryCode === "string" && q.factoryCode) filters.factoryCode = q.factoryCode;
  if (typeof q.corporateCode === "string" && q.corporateCode) filters.corporateCode = q.corporateCode;
  return filters;
}

export const TENANT_SCOPE_CONFLICT_CODE = "tenant_scope_conflict";
export const DATASET_NOT_SCOPABLE_CODE = "dataset_not_tenant_scopable";
/** Cùng mã với `biRouter.SHIFT_SCOPE_UNRESOLVED_CODE` — một mã, hai bề mặt, client xử một chỗ. */
export const TENANT_SCOPE_FACTORY_UNRESOLVED_CODE = "tenant_scope_factory_unresolved";

/**
 * ★★ Ép bộ lọc của yêu cầu vào phạm vi của KHOÁ (mig 0325).
 *
 * `getProductInspectionsCursor` chỉ nhận `corporateCode`/`factoryCode` dạng MỘT chuỗi mỗi ô
 * (và nó nằm ở `server/db/inspection.ts`, ngoài phạm vi lượt sửa này) — nên phạm vi khoá được
 * áp qua chính hai ô ấy. Khoá phạm vi-nhà-máy mang tối đa một mã mỗi loại nên ánh xạ là 1-1.
 *
 * ⚠ VÌ SAO XUNG ĐỘT LÀ 403 CHỨ KHÔNG PHẢI "GHI ĐÈ IM LẶNG". Nếu khoá khai `SIM-FAC` mà client
 * hỏi `?factoryCode=OTHER`, ghi đè sẽ trả về dữ liệu SIM-FAC dưới một yêu cầu ghi rõ OTHER —
 * client dựng báo cáo với nhãn sai. Trả 0 dòng thì lại thành "nhà máy OTHER không có dữ liệu".
 * Cả hai đều là lời khai sai; 403 nói đúng chuyện đã xảy ra.
 */
function applyKeyScopeToFilters(
  principal: ExportPrincipal,
  filters: CommonFilters,
): { filters: CommonFilters } | { conflict: string } {
  if (principal.kind !== "api-key") return { filters };
  const scope = principal.tenantScope;
  if (scope?.mode !== "factory") return { filters }; // 'global' (chưa khai đã bị 403 trước đó)

  const out: CommonFilters = { ...filters };
  if (scope.corporateCode) {
    if (out.corporateCode && out.corporateCode !== scope.corporateCode) {
      return {
        conflict:
          `Khoá API này chỉ được phép corporateCode "${scope.corporateCode}", nhưng yêu cầu hỏi ` +
          `"${out.corporateCode}". Bỏ tham số đi, hoặc dùng khoá có phạm vi phù hợp.`,
      };
    }
    out.corporateCode = scope.corporateCode;
  }
  if (scope.factoryCode) {
    if (out.factoryCode && out.factoryCode !== scope.factoryCode) {
      return {
        conflict:
          `Khoá API này chỉ được phép factoryCode "${scope.factoryCode}", nhưng yêu cầu hỏi ` +
          `"${out.factoryCode}". Bỏ tham số đi, hoặc dùng khoá có phạm vi phù hợp.`,
      };
    }
    out.factoryCode = scope.factoryCode;
  }
  return { filters: out };
}

function contentHeaders(
  res: Response,
  format: "csv" | "json",
  basename: string,
  expectedRows?: number,
): void {
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
  } else {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.setHeader("Content-Disposition", `attachment; filename="${basename}.${format}"`);
  res.setHeader("Cache-Control", "no-store");
  // ★ Lớp 1 chống cắt-im-lặng: SỐ HÀNG KỲ VỌNG được công bố TRƯỚC thân phản hồi, nên một
  //   client máy (script/ETL) đối chiếu được mà không cần đọc hết tệp. Xem sealExport().
  if (expectedRows !== undefined) res.setHeader("X-Export-Expected-Rows", String(expectedRows));
}

// ── ★★★ CHỐNG CẮT-IM-LẶNG (2026-08-18) ───────────────────────────────────────
//
// SỰ CỐ ĐÃ ĐO: `/api/export/measurements.csv` trả 27.000 hàng trong khi CSDL có 27.599 —
// lặp lại 6/6 lượt, HTTP 200, header đúng, dòng cuối TRỌN VẸN. Trang thứ 28 chạm
// `statement_timeout` (30 s) ⇒ `catch` gọi `res.destroy()` ⇒ luồng chunked đứt giữa chừng.
// Một tệp CSV bị cắt VẪN LÀ một tệp CSV hợp lệ: người nhận không có cách nào biết mình
// thiếu 599 hàng. Ba lớp dưới đây làm cho việc cắt KHÔNG THỂ im lặng nữa:
//
//   Lớp 1 — HEADER `X-Export-Expected-Rows` (công bố trước thân phản hồi).
//   Lớp 2 — DÒNG CHỨNG NHẬN cuối tệp. CSV hoàn chỉnh LUÔN kết thúc bằng
//           `# EXPORT_COMPLETE rows=<N>`; JSON hoàn chỉnh luôn có `"complete":true`.
//           Vắng dòng ấy ⇒ tệp bị cắt. Đây là lớp DUY NHẤT mà một người mở tệp bằng
//           Excel nhìn thấy được, nên nó là lớp chính.
//   Lớp 3 — HUỶ LUỒNG khi thiếu hàng. KHÔNG BAO GIỜ `res.end()` êm trên một luồng
//           thiếu: kết thúc êm biến "tải về thiếu" thành "tải về xong". `res.destroy()`
//           bỏ chunk kết thúc ⇒ curl/fetch/axios/trình duyệt đều BÁO LỖI truyền.
//
// Và mọi kết cục đều được ghi log KÈM SỐ (kỳ vọng / ghi được / thiếu) + một hàng audit.

/** Tiền tố dòng chứng nhận cuối tệp CSV. Vắng dòng bắt đầu bằng chuỗi này ⇒ tệp BỊ CẮT. */
export const CSV_COMPLETE_PREFIX = "# EXPORT_COMPLETE";

/** Dòng CUỐI CÙNG của một tệp CSV xuất hoàn chỉnh. */
export function csvCompletionLine(rows: number): string {
  return `${CSV_COMPLETE_PREFIX} rows=${rows}\r\n`;
}

export type ExportOutcome = "complete" | "short" | "failed" | "client_aborted";

/**
 * Quyết kết cục của một luồng xuất. TÁCH RIÊNG + THUẦN để đột biến kiểm được:
 *   • `failed`         — một trang CSDL lỗi giữa chừng (đây chính là sự cố đã đo).
 *   • `client_aborted` — client tự đóng (bấm Cancel). Không phải lỗi máy chủ, nhưng vẫn ghi số.
 *   • `short`          — luồng chạy hết mà ghi ÍT hơn số kỳ vọng ⇒ MẤT HÀNG.
 *   • `complete`       — ghi đủ (hoặc hơn, xem ghi chú dưới).
 *
 * ⚠ `written > expected` KHÔNG bị coi là hỏng: đó không phải mất dữ liệu mà là hàng được
 * chèn/bù (store-forward backfill) trong lúc xuất. Nó vẫn được ghi log cảnh báo, và dòng
 * chứng nhận mang SỐ THẬT đã ghi. Chiều nguy hiểm — thiếu hàng — bị chặn nghiêm ngặt.
 */
export function resolveExportOutcome(p: {
  failed: boolean;
  clientGone: boolean;
  written: number;
  expected: number;
}): ExportOutcome {
  if (p.failed) return "failed";
  if (p.clientGone) return "client_aborted";
  if (p.written < p.expected) return "short";
  return "complete";
}

/**
 * Sổ kế toán của một luồng xuất: đếm hàng ĐÃ GHI, tôn trọng backpressure, và biết khi nào
 * client đã bỏ đi.
 *
 * ⚠ BACKPRESSURE. Mã cũ bỏ qua giá trị trả về của `res.write()`, nên toàn bộ phần client
 * chưa kịp đọc bị chất đống trong bộ nhớ tiến trình (cửa sổ 92 ngày × hàng triệu hàng ⇒ OOM,
 * mà OOM thì cắt luồng — đúng lớp lỗi đang chữa). Nay mỗi lần `write()` trả `false` thì chờ
 * `drain`, và chờ ấy cũng tỉnh dậy khi socket đóng để vòng lặp không treo vĩnh viễn.
 */
export class ExportStreamAccountant {
  written = 0;
  clientGone = false;
  constructor(private readonly res: Response) {
    res.on("close", () => {
      if (!res.writableEnded) this.clientGone = true;
    });
  }

  /** Luồng còn ghi được không? */
  get open(): boolean {
    return !this.clientGone && !this.res.destroyed && !this.res.writableEnded;
  }

  /** Ghi một mẩu KHÔNG phải hàng dữ liệu (header CSV, mở/đóng JSON, dòng chứng nhận). */
  async writeRaw(chunk: string): Promise<boolean> {
    if (!this.open) return false;
    if (!this.res.write(chunk)) await this.awaitDrain();
    return this.open;
  }

  /** Ghi MỘT hàng dữ liệu và tính nó vào sổ. */
  async writeRow(chunk: string): Promise<boolean> {
    if (!this.open) return false;
    const flushed = this.res.write(chunk);
    this.written += 1; // đã giao cho socket ⇒ tính; `flushed=false` chỉ nghĩa là còn nằm đệm
    if (!flushed) await this.awaitDrain();
    return this.open;
  }

  private awaitDrain(): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = (): void => {
        this.res.off("drain", done);
        this.res.off("close", done);
        this.res.off("error", done);
        resolve();
      };
      this.res.once("drain", done);
      this.res.once("close", done);
      this.res.once("error", done);
    });
  }
}

/**
 * ĐÓNG một luồng xuất — điểm DUY NHẤT được phép kết thúc phản hồi luồng.
 * Trả về kết cục để lời gọi ghi audit/log.
 */
export async function sealExport(
  res: Response,
  acc: ExportStreamAccountant,
  opts: { format: "csv" | "json"; expected: number; failed: boolean; endpoint: string },
): Promise<ExportOutcome> {
  const outcome = resolveExportOutcome({
    failed: opts.failed,
    clientGone: acc.clientGone,
    written: acc.written,
    expected: opts.expected,
  });

  if (outcome === "complete") {
    // Lớp 2 — dòng/trường chứng nhận. Chỉ được ghi khi đã đối chiếu XONG.
    if (opts.format === "json") await acc.writeRaw(`],"count":${acc.written},"complete":true}`);
    else await acc.writeRaw(csvCompletionLine(acc.written));
    res.end();
  } else if (outcome !== "client_aborted") {
    // Lớp 3 — thiếu hàng ⇒ KHÔNG kết thúc êm. Không chunk kết thúc ⇒ client báo lỗi truyền.
    res.destroy();
  }
  // client_aborted: socket đã đi rồi, không còn gì để đóng — chỉ ghi sổ.

  const missing = Math.max(0, opts.expected - acc.written);
  const line =
    `[Export] ${opts.endpoint} ${outcome.toUpperCase()} — ` +
    `expected=${opts.expected} written=${acc.written} missing=${missing}`;
  if (outcome === "complete") {
    if (acc.written > opts.expected) {
      console.warn(`${line} (ghi NHIỀU hơn kỳ vọng ${acc.written - opts.expected} hàng — hàng mới chèn trong lúc xuất)`);
    } else {
      console.log(line);
    }
  } else {
    console.error(line);
  }
  return outcome;
}

/**
 * ★ Đóng một luồng ĐÃ HỎNG — gọi từ trong `catch`, nên bản thân nó **KHÔNG ĐƯỢC NÉM**.
 *
 * ⚠ Mã cũ viết `sealExport(res, acc!, …)` ngay trong `catch`. Hai lỗ ở đó:
 *   • `acc!` là một lời hứa suông. Nếu lượt hỏng xảy ra sau khi header đã đi mà `acc` vẫn
 *     `null`, câu ấy ném `Cannot read properties of null (reading 'clientGone')` — một lỗi
 *     MỚI, đúc ra ngay trong khối xử lý lỗi, và nó **thay thế** lỗi gốc trên đường lan ra.
 *   • Bất kỳ lỗi nào khác từ `sealExport` cũng che mất nguyên nhân thật của lượt xuất.
 * ⇒ Ở đây: `acc` khuyết ⇒ vẫn huỷ luồng và trả `"failed"`; `sealExport` ném ⇒ ghi lại rồi
 *   vẫn trả `"failed"`. Lỗi GỐC của lượt xuất luôn là thứ được báo ra ngoài.
 */
async function sealFailedStream(
  res: Response,
  acc: ExportStreamAccountant | null,
  opts: { format: "csv" | "json"; expected: number; endpoint: string },
): Promise<ExportOutcome> {
  try {
    if (!acc) {
      console.error(`[Export] ${opts.endpoint} FAILED — hỏng trước khi mở sổ luồng (acc=null)`);
      if (!res.destroyed) res.destroy();
      return "failed";
    }
    return await sealExport(res, acc, { ...opts, failed: true });
  } catch (sealErr) {
    console.error(`[Export] ${opts.endpoint} — lỗi KHI ĐÓNG luồng hỏng (lỗi gốc vẫn được giữ):`, describe(sealErr));
    try {
      if (!res.destroyed) res.destroy();
    } catch {
      /* socket đã đi */
    }
    return "failed";
  }
}

// ── ★★★ SỔ KIỂM TOÁN CỦA ĐƯỜNG LỖI (2026-08-18) ──────────────────────────────
//
// SỰ CỐ ĐÃ ĐO. Trên 8/8 lượt xuất HỎNG, máy chủ in `[Export] audit log failed:
// Cannot read properties of undefined (reading 'id')` và **không hàng audit nào được
// ghi**; trên 16/16 lượt xuất XONG, không một lỗi nào. Một lượt tệp xuất mất 22.599 hàng
// **không để lại dấu vết nào** — không ai truy được đã xảy ra, với ai, lúc nào.
//
// ⚠ GỐC RỄ LÀ **THỜI ĐIỂM ĐỌC**, KHÔNG PHẢI GIÁ TRỊ ĐỌC ĐƯỢC.
// `auditExport` cũ dựng đối tượng audit **BÊN TRONG** `.then()` của `import("../../db")`,
// nghĩa là nó đọc `req.ip` / `req.header(...)` ở một microtask **SAU** khi `sealExport()`
// đã gọi `res.destroy()`. Sau lượt destroy ấy, `req` và socket của nó không còn là nguồn
// dữ liệu đáng tin nữa. Phép đo trực tiếp (Express 4.22 + Node 24):
//
//     trước destroy : socket.remoteAddress="127.0.0.1"  req.ip="127.0.0.1"
//     sau  destroy  : socket.remoteAddress=undefined     req.ip=undefined
//
// (Node chỉ nhớ `socket._peername` nếu `remoteAddress` đã ĐƯỢC ĐỌC lúc handle còn sống —
// nên đường THÀNH CÔNG, vốn đọc lúc socket còn mở, luôn có IP; đường LỖI thì không.)
// Dấu vân tay của việc này còn nguyên trong CSDL: **19/19** hàng audit `status='failure'`
// có `ipAddress IS NULL`, trong khi **21/21** hàng `status='success'` đều có IP.
//
// ⇒ Đây đúng là lớp lỗi *"cơ chế ghi lại sự cố chính nó hỏng đúng lúc có sự cố"*: nó xanh
//   ở đường bình thường (nơi không cần nó) và hỏng ở đường lỗi (nơi cần nó nhất).
//
// BA THAY ĐỔI CẤU TRÚC — để nó KHÔNG THỂ hỏng lại theo đường này:
//   1. **CHỤP SỚM.** `captureExportAuditContext()` chạy NGAY sau khi xác thực xong, khi
//      socket còn sống và chưa một byte nào được ghi. Từ đó trở đi việc ghi audit **không
//      còn đọc `req`** nữa. Một hằng số không thể "vắng mặt ở nhánh lỗi".
//   2. **THIẾU TRƯỜNG ≠ MẤT BẢN GHI.** Mọi ô đều có đường lùi (`readIp` thử `req.ip` rồi
//      `req.socket.remoteAddress`, và KHÔNG BAO GIỜ ném), và nếu lượt ghi ĐẦY ĐỦ hỏng thì
//      còn một lượt **TỐI GIẢN** (bỏ `details`/`userAgent`) trước khi chịu thua.
//   3. **KHÔNG NUỐT SỰ CỐ GỐC.** Ghi audit vẫn là bắn-rồi-quên; nó chạy trong `finally`
//      **sau** khi kết cục của lượt xuất đã được báo ra ngoài (`res.destroy()` / 500), và
//      lượt cuối cùng in RA ĐỦ nội dung hàng để dựng lại bằng tay — không còn "một dòng
//      log rồi đi tiếp".

/**
 * Ảnh chụp BẤT BIẾN của ngữ cảnh yêu cầu, dùng để ghi audit sau khi luồng đã chết.
 * Chỉ chứa giá trị nguyên thuỷ — cố ý: nó không được giữ tham chiếu tới `req`/`res`.
 */
export interface ExportAuditContext {
  principalKind: ExportPrincipal["kind"];
  userId: number | null;
  userName: string;
  ipAddress: string | null;
  userAgent: string | null;
  requestedAt: string;
  method: string;
  path: string;
}

/** `req.ip` với đường lùi, KHÔNG BAO GIỜ ném (getter của Express đọc qua socket). */
function readIp(req: Request): string | null {
  try {
    const direct = req.ip;
    if (typeof direct === "string" && direct.length > 0) return direct;
  } catch {
    /* socket đã đi — rơi xuống đường lùi */
  }
  try {
    const sock = req.socket?.remoteAddress;
    return typeof sock === "string" && sock.length > 0 ? sock : null;
  } catch {
    return null;
  }
}

/** `req.header(name)` KHÔNG BAO GIỜ ném. */
function readHeader(req: Request, name: string): string | null {
  try {
    const v = req.header(name);
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * ★ Chụp ngữ cảnh kiểm toán **NGAY SAU KHI XÁC THỰC**, trước khi bất kỳ byte nào được ghi
 * và trước mọi khả năng `res.destroy()`.
 *
 * ⚠ `userName` KHÔNG được để trống: với khoá API thì `principal.userId` là `undefined`
 * (khoá API **không phải người dùng**), nên tên khoá là danh tính DUY NHẤT còn lại trong
 * sổ. Nếu cả nó cũng thiếu thì vẫn phải ghi được một danh tính nói thật ra điều đó.
 */
export function captureExportAuditContext(req: Request, principal: ExportPrincipal): ExportAuditContext {
  return {
    principalKind: principal.kind,
    userId: typeof principal.userId === "number" ? principal.userId : null,
    userName: principal.name || `${principal.kind}:không-rõ-danh-tính`,
    ipAddress: readIp(req),
    userAgent: readHeader(req, "user-agent"),
    requestedAt: new Date().toISOString(),
    method: req.method,
    path: (req.baseUrl || "") + req.path,
  };
}

export interface ExportAuditDetail {
  endpoint: string;
  from: string;
  to: string;
  filters: CommonFilters;
  rows: number;
  completed: boolean;
  /** ★ Số hàng KỲ VỌNG (thước đo độc lập) — có mặt trên hai tuyến luồng. */
  expectedRows?: number;
  /** ★ Kết cục luồng: complete | short | failed | client_aborted. */
  outcome?: ExportOutcome;
}

/**
 * Ghi một hàng audit cho lượt xuất. Bắn-rồi-quên: KHÔNG chặn, KHÔNG ném, và KHÔNG bao giờ
 * làm thay đổi kết cục mà lượt xuất đã báo ra ngoài.
 *
 * Ba nấc, giảm dần yêu cầu — nấc sau chỉ chạy khi nấc trước hỏng:
 *   ① hàng ĐẦY ĐỦ · ② hàng TỐI GIẢN (bỏ `details`, `userAgent`) · ③ in RA ĐỦ nội dung.
 */
export function auditExport(ctx: ExportAuditContext, detail: ExportAuditDetail): void {
  const status: "success" | "failure" = detail.completed ? "success" : "failure";
  const base = {
    userId: ctx.userId,
    userName: ctx.userName,
    action: "export",
    entityType: "inspection",
    entityName: detail.endpoint,
    ipAddress: ctx.ipAddress,
    status,
  } as const;
  const full = {
    ...base,
    details: {
      ...detail,
      principalKind: ctx.principalKind,
      requestedAt: ctx.requestedAt,
      method: ctx.method,
      path: ctx.path,
    } as never,
    userAgent: ctx.userAgent,
  };

  void (async () => {
    let db: typeof import("../../db");
    try {
      db = await import("../../db");
    } catch (err) {
      console.error("[Export] ★ HÀNG AUDIT BỊ MẤT — không nạp được tầng CSDL.", describe(err), JSON.stringify(full));
      return;
    }
    try {
      await db.createAuditLog(full);
      return;
    } catch (err) {
      // ⚠ In NGUYÊN VĂN + STACK. Một `.message` trơ trọi chính là thứ đã giấu sự cố này.
      console.error("[Export] audit log failed (lượt ĐẦY ĐỦ):", describe(err));
    }
    try {
      await db.createAuditLog({ ...base, details: null, userAgent: null });
      console.error(
        `[Export] audit: đã ghi được hàng TỐI GIẢN cho ${detail.endpoint} ` +
          `(mất \`details\`/\`userAgent\`) — sự cố VẪN có dấu vết.`,
      );
      return;
    } catch (err2) {
      console.error("[Export] audit log failed (lượt TỐI GIẢN):", describe(err2));
    }
    // ③ Không còn đường nào xuống CSDL. Vẫn KHÔNG được im lặng: in đủ để dựng lại bằng tay.
    console.error(
      "[Export] ★★★ HÀNG AUDIT BỊ MẤT HOÀN TOÀN — dựng lại bằng tay từ bản ghi dưới đây:",
      JSON.stringify({ ...full, details: detail }),
    );
  })();
}

/** Mô tả một lỗi cho log: ưu tiên stack, không bao giờ ném. */
function describe(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  try {
    return String(err);
  } catch {
    return "(lỗi không mô tả được)";
  }
}

// ── Buffered document (XLSX/PDF) + aggregate-dataset helpers ─────────────────

/** Set content headers for a fully-buffered document and send it. */
function sendBufferedDoc(
  res: Response,
  out: { buffer: Buffer; mimeType: string; filename: string },
): void {
  res.setHeader("Content-Type", out.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(out.buffer);
}

/** Render a bounded dataset to a branded XLSX/PDF via the canonical engine. */
async function renderDoc(params: {
  type: string;
  title: string;
  subtitle?: string;
  format: "xlsx" | "pdf";
  columns: ExportColumn[];
  data: Record<string, unknown>[];
  fileName: string;
}) {
  const branding = await resolveBranding().catch(() => ({}));
  return renderReport({
    type: params.type,
    title: params.title,
    subtitle: params.subtitle,
    format: params.format as ReportFormat,
    branding,
    columns: params.columns,
    data: params.data,
    fileName: params.fileName,
  });
}

/** identity-header columns for a raw dataset (key === header). */
function idColumns(keys: readonly string[]): ExportColumn[] {
  return keys.map((k) => ({ key: k, header: k }));
}

/** Collect up to `cap` inspection rows (bounded — for the XLSX/PDF doc path). */
async function collectInspections(
  from: Date,
  to: Date,
  filters: CommonFilters,
  principal: ExportPrincipal,
  cap: number,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const { getProductInspectionsCursor } = await import("../../db/inspection");
  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  let cursor: string | undefined;
  do {
    const page = await getProductInspectionsCursor({
      startDate: from,
      endDate: to,
      machineId: filters.machineId,
      result: filters.result,
      productModel: filters.product,
      factoryCode: filters.factoryCode,
      corporateCode: filters.corporateCode,
      limit: INSPECTION_PAGE_SIZE,
      cursor,
      userId: principal.userId,
      userRole: principal.userRole,
    });
    for (const row of page.data) {
      if (rows.length >= cap) {
        truncated = true;
        break;
      }
      rows.push(row as Record<string, unknown>);
    }
    cursor = !truncated && page.hasMore && page.nextCursor ? page.nextCursor : undefined;
  } while (cursor);
  return { rows, truncated };
}

// ── ★★★ NGUYÊN NHÂN GỐC của lượt cắt (đo 2026-08-18) ─────────────────────────
//
// Truy vấn phân trang CŨ là `measurement_results INNER JOIN product_inspections … LIMIT 1000`
// với khoá phân trang `mr.id` nhưng bộ lọc lại nằm trên `pi.inspectionTime` — HAI TRỤC KHÔNG
// TƯƠNG QUAN. Ở đuôi dải id, hàng khớp thưa dần, mà planner vẫn tin `LIMIT 1000` sẽ gặp đủ
// hàng ngay ⇒ chọn **Nested Loop + Materialize**. EXPLAIN ANALYZE trang cuối (đo thật):
//
//     Limit (actual time=2.282..179259.304 rows=599)
//       Nested Loop  Rows Removed by Join Filter: 2 997 964 925      ← BA TỶ hàng bị loại
//
// 179 GIÂY cho 599 hàng ⇒ vượt `statement_timeout` (DB_STATEMENT_TIMEOUT_MS, mặc định 30 s)
// ⇒ drizzle ném ⇒ `catch` gọi `res.destroy()` ⇒ tệp cắt. Trang nào cũng có thể dính (trang
// giữa dính khi CSDL đang tải nặng) — đó là chỗ đẻ ra tính KHÔNG TẤT ĐỊNH 27.000/8.000.
//
// BẢN VÁ: bỏ `INNER JOIN … LIMIT` khi CHỌN hàng. Chọn id bằng **semi-join EXISTS** (planner
// không còn cửa đánh cược nested-loop), rồi lấy hình chiếu cho ĐÚNG ≤1000 id ấy. Đo lại trên
// chính bộ dữ liệu đã hỏng: trang cuối 179.255 ms → 24 ms; TOÀN BỘ 27.599 hàng / 28 trang
// trong 960 ms (trước: 47.800 ms và MẤT 599 hàng).

type MeasurementTables = {
  mr: typeof import("../../../drizzle/schema")["measurementResults"];
  pi: typeof import("../../../drizzle/schema")["productInspections"];
  mp: typeof import("../../../drizzle/schema")["measurementPointDefs"];
  dc: typeof import("../../../drizzle/schema")["defectCatalog"];
};

/** Điều kiện cấp `product_inspections` (cửa sổ + bộ lọc + phạm vi khoá API). */
function measurementInspectionConds(
  t: MeasurementTables,
  from: Date,
  to: Date,
  filters: CommonFilters,
  keyTenant: SQL | undefined,
): SQL[] {
  const c: SQL[] = [gte(t.pi.inspectionTime, from), lte(t.pi.inspectionTime, to)];
  if (keyTenant) c.push(keyTenant); // mig 0325 — phạm vi KHOÁ, luôn AND vào
  if (filters.machineId) c.push(eq(t.pi.machineId, filters.machineId));
  if (filters.product) c.push(like(t.pi.productModel, `%${filters.product}%`));
  if (filters.factoryCode) c.push(eq(t.pi.factoryCode, filters.factoryCode));
  if (filters.corporateCode) c.push(eq(t.pi.corporateCode, filters.corporateCode));
  return c;
}

/** Vị từ semi-join: hàng đo thuộc về một bản ghi kiểm NẰM TRONG cửa sổ/phạm vi. */
function measurementInspectionExists(
  db: NonNullable<Awaited<ReturnType<typeof import("../../db/connection")["getDb"]>>>,
  t: MeasurementTables,
  from: Date,
  to: Date,
  filters: CommonFilters,
  keyTenant: SQL | undefined,
): SQL {
  return exists(
    db
      .select({ hit: sql`1` })
      .from(t.pi)
      .where(and(eq(t.pi.id, t.mr.inspectionId), ...measurementInspectionConds(t, from, to, filters, keyTenant))),
  );
}

async function measurementTables(): Promise<MeasurementTables> {
  const schema = await import("../../../drizzle/schema");
  return {
    mr: schema.measurementResults,
    pi: schema.productInspections,
    mp: schema.measurementPointDefs,
    dc: schema.defectCatalog,
  };
}

/**
 * ★ THƯỚC ĐO ĐỘC LẬP: đếm số hàng kỳ vọng + chốt trần `maxId` cho cả lượt xuất.
 *
 * `maxId` KHÔNG phải trang trí: nó chốt lượt xuất vào đúng ảnh chụp lúc bắt đầu, nên hàng do
 * simulator/backfill chèn TRONG LÚC xuất (id lớn hơn) không lọt vào và không làm thước lệch.
 * Nhờ vậy `expected` so được với `written` một cách chính xác.
 *
 * ⚠ Con số này đến từ MỘT TRUY VẤN KHÁC (`count(*)` trên cùng vị từ), KHÔNG phải từ số hàng
 * đã ghi — nếu nó được suy ra từ `written` thì phép đối chiếu tự thoả và vô dụng.
 */
async function measurementExpectation(
  db: NonNullable<Awaited<ReturnType<typeof import("../../db/connection")["getDb"]>>>,
  t: MeasurementTables,
  from: Date,
  to: Date,
  filters: CommonFilters,
  keyTenant: SQL | undefined,
): Promise<{ expected: number; maxId: number }> {
  const rowConds: SQL[] = [measurementInspectionExists(db, t, from, to, filters, keyTenant)];
  if (filters.result) rowConds.push(eq(t.mr.result, filters.result));
  const res = await db
    .select({ n: sql<number>`count(*)::int`, maxId: sql<number | null>`max(${t.mr.id})::int` })
    .from(t.mr)
    .where(and(...rowConds));
  return { expected: Number(res[0]?.n ?? 0), maxId: Number(res[0]?.maxId ?? 0) };
}

/** Một trang hàng đo (keyset trên `mr.id`, trần `maxId`) — hai bước, không có nested-loop bẫy. */
async function measurementPage(
  db: NonNullable<Awaited<ReturnType<typeof import("../../db/connection")["getDb"]>>>,
  t: MeasurementTables,
  args: {
    from: Date;
    to: Date;
    filters: CommonFilters;
    keyTenant: SQL | undefined;
    lastId: number;
    maxId: number;
    limit: number;
  },
): Promise<Record<string, unknown>[]> {
  const { from, to, filters, keyTenant, lastId, maxId, limit } = args;
  // Bước 1 — CHỌN id bằng semi-join (không JOIN nên planner không dựng được nested loop).
  const idConds: SQL[] = [
    gt(t.mr.id, lastId),
    lte(t.mr.id, maxId),
    measurementInspectionExists(db, t, from, to, filters, keyTenant),
  ];
  if (filters.result) idConds.push(eq(t.mr.result, filters.result));
  const idRows = await db
    .select({ id: t.mr.id })
    .from(t.mr)
    .where(and(...idConds))
    .orderBy(asc(t.mr.id))
    .limit(limit);
  const ids = idRows.map((r) => r.id);
  if (ids.length === 0) return [];

  // Bước 2 — hình chiếu cho ĐÚNG các id ấy. Tập lái bị chặn ≤ limit ⇒ không thể suy biến.
  //   `inArray` (KHÔNG phải `= ANY(${jsArray})` — xem GOTCHA drizzle 42809).
  const page = await db
    .select({
      id: t.mr.id,
      inspectionId: t.mr.inspectionId,
      serialNumber: t.pi.serialNumber,
      inspectionTime: t.pi.inspectionTime,
      machineId: t.pi.machineId,
      pointDefId: t.mr.pointDefId,
      pointCode: t.mp.code,
      pointName: t.mp.name,
      measuredValue: t.mr.measuredValue,
      measuredValueText: t.mr.measuredValueText,
      result: t.mr.result,
      defectCatalogId: t.mr.defectCatalogId,
      defectCode: t.dc.code,
      defectName: t.dc.name,
      defectSeverity: t.mr.defectSeverity,
      aiConfidence: t.mr.aiConfidence,
    })
    .from(t.mr)
    .innerJoin(t.pi, eq(t.mr.inspectionId, t.pi.id))
    .leftJoin(t.mp, eq(t.mr.pointDefId, t.mp.id))
    .leftJoin(t.dc, eq(t.mr.defectCatalogId, t.dc.id))
    .where(inArray(t.mr.id, ids))
    .orderBy(asc(t.mr.id));
  return page as Record<string, unknown>[];
}

/** Collect up to `cap` measurement rows (bounded keyset — for XLSX/PDF). */
async function collectMeasurements(
  from: Date,
  to: Date,
  filters: CommonFilters,
  cap: number,
  keyTenant: SQL | undefined,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) return { rows: [], truncated: false };
  const t = await measurementTables();
  const { maxId } = await measurementExpectation(db, t, from, to, filters, keyTenant);

  const rows: Record<string, unknown>[] = [];
  let truncated = false;
  let lastId = 0;
  while (lastId < maxId) {
    const page = await measurementPage(db, t, {
      from,
      to,
      filters,
      keyTenant,
      lastId,
      maxId,
      limit: MEASUREMENT_PAGE_SIZE,
    });
    if (page.length === 0) break;
    for (const row of page) {
      if (rows.length >= cap) {
        truncated = true;
        break;
      }
      rows.push(row);
      lastId = (row as { id: number }).id;
    }
    if (truncated || page.length < MEASUREMENT_PAGE_SIZE) break;
  }
  return { rows, truncated };
}

/**
 * ★ THƯỚC ĐO ĐỘC LẬP cho tuyến BẢN GHI KIỂM. Dựng lại ĐÚNG bộ điều kiện mà
 * `getProductInspectionsCursor` dùng (kể cả `resolveDataScope` theo người dùng) rồi `count(*)`.
 * Không tái dùng vòng lặp ghi ⇒ không tự thoả.
 */
async function countInspectionsInWindow(
  from: Date,
  to: Date,
  filters: CommonFilters,
  principal: ExportPrincipal,
): Promise<number> {
  const { getDb } = await import("../../db/connection");
  const schema = await import("../../../drizzle/schema");
  const db = await getDb();
  if (!db) return 0;
  const pi = schema.productInspections;
  const conds: SQL[] = [gte(pi.inspectionTime, from), lte(pi.inspectionTime, to)];
  if (principal.userId && principal.userRole !== "admin") {
    const { resolveDataScope } = await import("../../_core/accessControl");
    const resolved = await resolveDataScope(principal.userId, principal.userRole || "user");
    if (resolved.filter) conds.push(resolved.filter);
  }
  if (filters.machineId) conds.push(eq(pi.machineId, filters.machineId));
  if (filters.result) conds.push(eq(pi.overallResult, filters.result));
  if (filters.product) conds.push(like(pi.productModel, `%${filters.product}%`));
  if (filters.factoryCode) conds.push(eq(pi.factoryCode, filters.factoryCode));
  if (filters.corporateCode) conds.push(eq(pi.corporateCode, filters.corporateCode));
  const res = await db.select({ n: sql<number>`count(*)::int` }).from(pi).where(and(...conds));
  return Number(res[0]?.n ?? 0);
}

// ── Aggregate datasets (yield / oee / defect-pareto) — bounded rollups ────────

export interface AggregateDataset {
  dataset: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
}

/** Per-product output + canonical final yield (getYieldByProduct — R1). */
async function buildYieldDataset(
  from: Date,
  to: Date,
  machineId: number | undefined,
  axis: ReportScopeAxis,
): Promise<AggregateDataset> {
  const { getYieldByProduct } = await import("../../db/reportAggregators");
  const rows = await getYieldByProduct({ startDate: from, endDate: to, machineId, ...axis });
  return {
    dataset: "yield",
    columns: [
      { key: "productModelId", header: "productModelId", format: "number" },
      { key: "productCode", header: "productCode" },
      { key: "productName", header: "productName" },
      { key: "total", header: "total", format: "number" },
      { key: "ok", header: "ok", format: "number" },
      { key: "ng", header: "ng", format: "number" },
      { key: "ntf", header: "ntf", format: "number" },
      { key: "yieldRate", header: "yieldRate" },
    ],
    rows: rows as unknown as Record<string, unknown>[],
  };
}

/** Defect Pareto by defect_catalog dimension (getDefectParetoByCategory — R1). */
async function buildDefectParetoDataset(
  from: Date,
  to: Date,
  machineId: number | undefined,
  dimension: "category" | "severity" | "ipcSection",
  axis: ReportScopeAxis,
): Promise<AggregateDataset> {
  const { getDefectParetoByCategory } = await import("../../db/reportAggregators");
  const res = await getDefectParetoByCategory({ startDate: from, endDate: to, machineId, dimension, ...axis });
  return {
    dataset: "defect-pareto",
    columns: [
      { key: "key", header: dimension },
      { key: "count", header: "count", format: "number" },
      { key: "percentage", header: "percentage" },
      { key: "cumulativePercentage", header: "cumulativePercentage" },
      { key: "bucket", header: "bucket" },
    ],
    rows: res.items as unknown as Record<string, unknown>[],
  };
}

/** Per machine per day OEE averages from oee_metrics (%; ×100 stored → /100). */
async function buildOeeDataset(
  from: Date,
  to: Date,
  machineId: number | undefined,
  /** `null` = không áp cổng; `[]` ⇒ `1 = 0`. Xem `reportFactoryIdsOf`. */
  factoryIds: number[] | null,
): Promise<AggregateDataset> {
  const { getDb } = await import("../../db/connection");
  const { sql } = await import("drizzle-orm");
  const { executeRows } = await import("../../utils/kpi");
  const db = await getDb();
  const columns: ExportColumn[] = [
    { key: "day", header: "day" },
    { key: "machine_id", header: "machine_id", format: "number" },
    { key: "machine_code", header: "machine_code" },
    { key: "availability", header: "availability" },
    { key: "performance", header: "performance" },
    { key: "quality", header: "quality" },
    { key: "oee", header: "oee" },
    { key: "total_count", header: "total_count", format: "number" },
    { key: "good_count", header: "good_count", format: "number" },
    { key: "reject_count", header: "reject_count", format: "number" },
  ];
  if (!db) return { dataset: "oee", columns, rows: [] };
  // ⚠ Cột viết ĐỦ TÊN BẢNG — cổng bên dưới nhúng truy vấn phụ trên `machines`/`stations`/…,
  //   nên một `"machineId"` trần sẽ mơ hồ. Bí danh bảng thì vỡ `42P01` (xem `biRouter`).
  const machineFilter = machineId ? sql` AND oee_metrics."machineId" = ${machineId}` : sql``;
  let tenantGate = sql``;
  if (factoryIds) {
    // Cùng cổng mà `commandCenterService` dùng cho tầng dự phòng `oee_metrics` của ô OEE:
    // `machines → stations → production_lines → workshops → factories`. Một luật, một chỗ sửa.
    const { machineIdFactoryGate } = await import("../../services/ecosystem/commandCenterScope");
    tenantGate = sql` AND ${machineIdFactoryGate(sql`oee_metrics."machineId"`, factoryIds)}`;
  }
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
    WHERE oee_metrics."timestamp" >= ${from.toISOString()}
      AND oee_metrics."timestamp" < ${to.toISOString()}${machineFilter}${tenantGate}
    GROUP BY 1, 2, 3
    ORDER BY 1, 2
  `);
  return { dataset: "oee", columns, rows: executeRows(res) };
}

/** Emit an aggregate dataset as clean CSV / JSON / branded XLSX. */
async function emitAggregate(
  res: Response,
  format: "csv" | "json" | "xlsx",
  ds: AggregateDataset,
  from: Date,
  to: Date,
): Promise<number> {
  const keys = ds.columns.map((c) => c.key);
  const basename = `${ds.dataset}_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${basename}.json"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ dataset: ds.dataset, from: from.toISOString(), to: to.toISOString(), count: ds.rows.length, rows: ds.rows }));
  } else if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${basename}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    let body = toCsvLine(keys);
    for (const row of ds.rows) body += rowToCsvLine(row, keys);
    res.end(body);
  } else {
    const out = await renderDoc({
      type: ds.dataset,
      title: ds.dataset.toUpperCase(),
      subtitle: `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`,
      format: "xlsx",
      columns: ds.columns,
      data: ds.rows,
      fileName: basename,
    });
    sendBufferedDoc(res, out);
  }
  return ds.rows.length;
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createExportRouter(): Router {
  const r = Router();

  // Dedicated stricter limiter (per API-key/session/IP — B6 key strategy),
  // stacked on top of the global /api limiter.
  r.use(
    rateLimit({
      windowMs: 5 * 60 * 1000,
      max: intEnv("EXPORT_RATE_LIMIT_PER_5MIN", 10),
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: apiKeyGenerator,
      passOnStoreError: true,
      message: { error: "Export rate limit exceeded — try again in a few minutes." },
    }),
  );

  // GET /inspections.csv|.json — streamed list projection;
  //     /inspections.xlsx|.pdf — bounded branded document (renderReport).
  r.get(/^\/inspections\.(csv|json|xlsx|pdf)$/, async (req: Request, res: Response) => {
    const ext = req.path.slice(req.path.lastIndexOf(".") + 1) as "csv" | "json" | "xlsx" | "pdf";
    const auth = await authenticateExportRequest(req, API_SCOPES.EXPORT_READ);
    if (!auth.principal) {
      return res.status(auth.status).json({ error: auth.message, code: auth.code, details: auth.details });
    }

    // ★ Chụp ngữ cảnh audit NGAY BÂY GIỜ — socket còn sống, chưa ghi byte nào.
    const auditCtx = captureExportAuditContext(req, auth.principal);

    const parsed = parseExportWindow(req.query.from, req.query.to);
    if (!parsed.window) return res.status(400).json({ error: parsed.error });
    const { from, to } = parsed.window;
    const scoped = applyKeyScopeToFilters(auth.principal, parseCommonFilters(req));
    if ("conflict" in scoped) {
      return res.status(403).json({
        error: scoped.conflict,
        code: TENANT_SCOPE_CONFLICT_CODE,
        tenantScope: tenantScopeDescriptor(auth.principal.tenantScope),
      });
    }
    const filters = scoped.filters;

    // Buffered document path (XLSX/PDF): bounded row count, rendered branded.
    if (ext === "xlsx" || ext === "pdf") {
      let rows = 0;
      let completed = false;
      try {
        const cap = docRowCap(ext);
        const collected = await collectInspections(from, to, filters, auth.principal, cap);
        rows = collected.rows.length;
        const basename = `inspections_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
        const out = await renderDoc({
          type: "inspections",
          title: "Inspections",
          subtitle:
            `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}` +
            (collected.truncated ? `  (truncated to ${cap} rows)` : ""),
          format: ext,
          columns: idColumns(INSPECTION_EXPORT_COLUMNS),
          data: collected.rows,
          fileName: basename,
        });
        sendBufferedDoc(res, out);
        completed = true;
      } catch (err) {
        console.error("[Export] inspections doc failed:", (err as Error)?.message ?? err);
        if (!res.headersSent) res.status(500).json({ error: "Export failed." });
      } finally {
        auditExport(auditCtx, {
          endpoint: `/api/export/inspections.${ext}`,
          from: from.toISOString(),
          to: to.toISOString(),
          filters,
          rows,
          completed,
        });
      }
      return;
    }

    const format = ext; // "csv" | "json"
    const endpoint = `/api/export/inspections.${format}`;
    let acc: ExportStreamAccountant | null = null;
    let expected = 0;
    let outcome: ExportOutcome = "failed";
    try {
      const { getProductInspectionsCursor } = await import("../../db/inspection");
      // ★ Thước đo TRƯỚC khi mở luồng: biết trước phải giao bao nhiêu hàng, và công bố
      //   con số ấy ra header để client máy đối chiếu được.
      expected = await countInspectionsInWindow(from, to, filters, auth.principal);
      contentHeaders(
        res,
        format,
        `inspections_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`,
        expected,
      );
      acc = new ExportStreamAccountant(res);

      if (format === "csv") await acc.writeRaw(toCsvLine([...INSPECTION_EXPORT_COLUMNS]));
      else await acc.writeRaw(`{"dataset":"inspections","from":${JSON.stringify(from.toISOString())},"to":${JSON.stringify(to.toISOString())},"rows":[`);

      let cursor: string | undefined;
      do {
        const page = await getProductInspectionsCursor({
          startDate: from,
          endDate: to,
          machineId: filters.machineId,
          result: filters.result,
          productModel: filters.product,
          factoryCode: filters.factoryCode,
          corporateCode: filters.corporateCode,
          limit: INSPECTION_PAGE_SIZE,
          cursor,
          // Session principals stay tenant-scoped exactly like the History list.
          userId: auth.principal.userId,
          userRole: auth.principal.userRole,
        });
        for (const row of page.data) {
          if (!acc.open) break;
          const first = acc.written === 0;
          await acc.writeRow(
            format === "csv"
              ? rowToCsvLine(row as never, INSPECTION_EXPORT_COLUMNS)
              : jsonStreamChunk(row, first),
          );
        }
        cursor = page.hasMore && page.nextCursor ? page.nextCursor : undefined;
      } while (cursor && acc.open);

      outcome = await sealExport(res, acc, { format, expected, failed: false, endpoint });
    } catch (err) {
      console.error("[Export] inspections stream failed:", (err as Error)?.message ?? err);
      if (!res.headersSent) {
        outcome = "failed";
        res.status(500).json({ error: "Export failed." });
      } else {
        // Hỏng giữa luồng ⇒ huỷ hẳn, KHÔNG kết thúc êm (xem §CHỐNG CẮT-IM-LẶNG).
        outcome = await sealFailedStream(res, acc, { format, expected, endpoint });
      }
    } finally {
      auditExport(auditCtx, {
        endpoint,
        from: from.toISOString(),
        to: to.toISOString(),
        filters,
        rows: acc?.written ?? 0,
        expectedRows: expected,
        outcome,
        completed: outcome === "complete",
      });
    }
  });

  // GET /measurements.csv|.json — raw measurement rows in the window (keyset on
  // measurement id ASC); /measurements.xlsx|.pdf — bounded branded document.
  r.get(/^\/measurements\.(csv|json|xlsx|pdf)$/, async (req: Request, res: Response) => {
    const ext = req.path.slice(req.path.lastIndexOf(".") + 1) as "csv" | "json" | "xlsx" | "pdf";
    const auth = await authenticateExportRequest(req, API_SCOPES.EXPORT_READ);
    if (!auth.principal) {
      return res.status(auth.status).json({ error: auth.message, code: auth.code, details: auth.details });
    }

    // ★ Chụp ngữ cảnh audit NGAY BÂY GIỜ — socket còn sống, chưa ghi byte nào.
    const auditCtx = captureExportAuditContext(req, auth.principal);

    const parsed = parseExportWindow(req.query.from, req.query.to);
    if (!parsed.window) return res.status(400).json({ error: parsed.error });
    const { from, to } = parsed.window;
    const filters = parseCommonFilters(req);
    // ⚠ Đường ĐO LƯỜNG dựng truy vấn drizzle NGAY TẠI ĐÂY (khác đường bản ghi kiểm phải đi qua
    //   `getProductInspectionsCursor`), nên phạm vi khoá được áp bằng chính điều kiện SQL —
    //   không cần ánh xạ qua hai ô lọc. `pi` dưới đây là ĐỐI TƯỢNG BẢNG của drizzle chứ không
    //   phải bí danh SQL, nên nó kết xuất `"product_inspections"."factoryCode"` khớp đúng với
    //   `inspectionTenantFilter` — không dính bẫy 42P01 của các truy vấn raw ở `biRouter`.
    const keyTenant = apiKeyTenantCondition(auth.principal);

    // Buffered document path (XLSX/PDF): bounded row count, rendered branded.
    if (ext === "xlsx" || ext === "pdf") {
      let rows = 0;
      let completed = false;
      try {
        const cap = docRowCap(ext);
        const collected = await collectMeasurements(from, to, filters, cap, keyTenant);
        rows = collected.rows.length;
        const basename = `measurements_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;
        const out = await renderDoc({
          type: "measurements",
          title: "Measurements",
          subtitle:
            `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}` +
            (collected.truncated ? `  (truncated to ${cap} rows)` : ""),
          format: ext,
          columns: idColumns(MEASUREMENT_EXPORT_COLUMNS),
          data: collected.rows,
          fileName: basename,
        });
        sendBufferedDoc(res, out);
        completed = true;
      } catch (err) {
        console.error("[Export] measurements doc failed:", (err as Error)?.message ?? err);
        if (!res.headersSent) res.status(500).json({ error: "Export failed." });
      } finally {
        auditExport(auditCtx, {
          endpoint: `/api/export/measurements.${ext}`,
          from: from.toISOString(),
          to: to.toISOString(),
          filters,
          rows,
          completed,
        });
      }
      return;
    }

    const format = ext; // "csv" | "json"
    const endpoint = `/api/export/measurements.${format}`;
    let acc: ExportStreamAccountant | null = null;
    let expected = 0;
    let outcome: ExportOutcome = "failed";
    try {
      const { getDb } = await import("../../db/connection");
      const db = await getDb();
      if (!db) return res.status(503).json({ error: "Database unavailable." });
      const t = await measurementTables();

      // ★ Thước đo TRƯỚC khi mở luồng (một truy vấn gộp count+max, đo 50 ms trên 27.599 hàng).
      //   `maxId` chốt lượt xuất vào ảnh chụp lúc bắt đầu ⇒ hàng chèn thêm trong lúc xuất
      //   không làm thước lệch, nên `expected` so được CHÍNH XÁC với số hàng đã ghi.
      const expectation = await measurementExpectation(db, t, from, to, filters, keyTenant);
      expected = expectation.expected;
      const maxId = expectation.maxId;

      contentHeaders(
        res,
        format,
        `measurements_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`,
        expected,
      );
      acc = new ExportStreamAccountant(res);

      if (format === "csv") await acc.writeRaw(toCsvLine([...MEASUREMENT_EXPORT_COLUMNS]));
      else await acc.writeRaw(`{"dataset":"measurements","from":${JSON.stringify(from.toISOString())},"to":${JSON.stringify(to.toISOString())},"rows":[`);

      // Keyset trên mr.id, trần maxId — không OFFSET, không đệm cả tập, không nested-loop bẫy.
      let lastId = 0;
      while (acc.open && lastId < maxId) {
        const page = await measurementPage(db, t, {
          from,
          to,
          filters,
          keyTenant,
          lastId,
          maxId,
          limit: MEASUREMENT_PAGE_SIZE,
        });
        if (page.length === 0) break;
        for (const row of page) {
          if (!acc.open) break;
          const first = acc.written === 0;
          await acc.writeRow(
            format === "csv"
              ? rowToCsvLine(row, MEASUREMENT_EXPORT_COLUMNS)
              : jsonStreamChunk(row, first),
          );
          lastId = (row as { id: number }).id;
        }
        if (page.length < MEASUREMENT_PAGE_SIZE) break;
      }

      outcome = await sealExport(res, acc, { format, expected, failed: false, endpoint });
    } catch (err) {
      console.error("[Export] measurements stream failed:", (err as Error)?.message ?? err);
      if (!res.headersSent) {
        outcome = "failed";
        res.status(500).json({ error: "Export failed." });
      } else {
        outcome = await sealFailedStream(res, acc, { format, expected, endpoint });
      }
    } finally {
      auditExport(auditCtx, {
        endpoint,
        from: from.toISOString(),
        to: to.toISOString(),
        filters,
        rows: acc?.written ?? 0,
        expectedRows: expected,
        outcome,
        completed: outcome === "complete",
      });
    }
  });

  // GET /yield.csv|.json|.xlsx — per-product output + final yield rollup.
  // GET /oee.csv|.json|.xlsx — per machine per day OEE averages (oee_metrics).
  // GET /defect-pareto.csv|.json|.xlsx — defect Pareto by defect_catalog dimension.
  // All three are bounded aggregate rollups (scope + window guard + audit).
  r.get(/^\/(yield|oee|defect-pareto)\.(csv|json|xlsx)$/, async (req: Request, res: Response) => {
    const lastDot = req.path.lastIndexOf(".");
    const name = req.path.slice(1, lastDot); // "yield" | "oee" | "defect-pareto"
    const format = req.path.slice(lastDot + 1) as "csv" | "json" | "xlsx";
    const auth = await authenticateExportRequest(req, API_SCOPES.EXPORT_READ);
    if (!auth.principal) {
      return res.status(auth.status).json({ error: auth.message, code: auth.code, details: auth.details });
    }

    // ★★★ 2026-08-18 — BA dataset TỔNG HỢP nay ĐỀU thu hẹp được, nên 403
    //   `dataset_not_tenant_scopable` ở đây đã bị GỠ (khối chú thích cũ liệt kê ba lý do nay
    //   đều SAI, nên nó bị xoá chứ không bị bình luận lại — xem `reportScopeAxisOf`).
    //     • `yield`, `defect-pareto` — trục phạm vi ② của `db/reportAggregators`.
    //     • `oee`                    — `machineIdFactoryGate` (oee_metrics chỉ có `machineId`).
    //   Cổng này phục vụ CẢ HAI principal: khoá API theo mã tenant, PHIÊN theo danh tính.
    const scopeAxis = reportScopeAxisOf(auth.principal);

    // ★ Chụp ngữ cảnh audit NGAY BÂY GIỜ — socket còn sống, chưa ghi byte nào.
    const auditCtx = captureExportAuditContext(req, auth.principal);

    const parsed = parseExportWindow(req.query.from, req.query.to);
    if (!parsed.window) return res.status(400).json({ error: parsed.error });
    const { from, to } = parsed.window;
    const filters = parseCommonFilters(req);
    const dimensionRaw = req.query.dimension;
    const dimension =
      dimensionRaw === "severity" || dimensionRaw === "ipcSection" ? dimensionRaw : "category";

    let rows = 0;
    let completed = false;
    try {
      let ds: AggregateDataset;
      if (name === "yield") ds = await buildYieldDataset(from, to, filters.machineId, scopeAxis);
      else if (name === "oee") {
        const factoryIds = await reportFactoryIdsOf(auth.principal);
        // ⚠ Phạm vi chiếu ra 0 nhà máy ⇒ 403 CÓ MÃ, không phải một tệp rỗng. `oee_metrics` chỉ
        //   thu hẹp được qua chuỗi phân cấp của máy; một tệp 0 hàng đọc thành "nhà máy của bạn
        //   không có số liệu OEE", trong khi sự thật là "phạm vi của bạn không ứng với nhà máy
        //   nào". Người nhận một tệp CSV rỗng không có cách nào phân biệt hai chuyện ấy.
        if (factoryIds && factoryIds.length === 0) {
          completed = true; // đã trả lời dứt khoát — không phải một lượt xuất hỏng giữa chừng
          res.status(403).json({
            error:
              `Dataset "oee" phải chiếu phạm vi của người gọi sang bảng factories (oee_metrics ` +
              `không mang cột tenant), nhưng phạm vi này KHÔNG khớp nhà máy nào. Đây là lỗi CẤU ` +
              `HÌNH, không phải kết luận rằng nhà máy không có số liệu OEE.`,
            code: TENANT_SCOPE_FACTORY_UNRESOLVED_CODE,
            dataset: name,
            matchedFactories: 0,
            tenantScope: tenantScopeDescriptor(auth.principal.tenantScope),
          });
          return;
        }
        ds = await buildOeeDataset(from, to, filters.machineId, factoryIds);
      } else ds = await buildDefectParetoDataset(from, to, filters.machineId, dimension, scopeAxis);

      rows = await emitAggregate(res, format, ds, from, to);
      completed = true;
    } catch (err) {
      console.error(`[Export] ${name} dataset failed:`, (err as Error)?.message ?? err);
      if (!res.headersSent) res.status(500).json({ error: "Export failed." });
    } finally {
      auditExport(auditCtx, {
        endpoint: `/api/export/${name}.${format}`,
        from: from.toISOString(),
        to: to.toISOString(),
        filters,
        rows,
        completed,
      });
    }
  });

  // Unknown /api/export path → structured 404.
  r.use((_req, res) =>
    res.status(404).json({
      error: "Unknown /api/export endpoint.",
      available: [
        "/api/export/inspections.csv",
        "/api/export/inspections.json",
        "/api/export/inspections.xlsx",
        "/api/export/inspections.pdf",
        "/api/export/measurements.csv",
        "/api/export/measurements.json",
        "/api/export/measurements.xlsx",
        "/api/export/measurements.pdf",
        "/api/export/yield.csv",
        "/api/export/yield.json",
        "/api/export/yield.xlsx",
        "/api/export/oee.csv",
        "/api/export/oee.json",
        "/api/export/oee.xlsx",
        "/api/export/defect-pareto.csv",
        "/api/export/defect-pareto.json",
        "/api/export/defect-pareto.xlsx",
      ],
    }),
  );

  return r;
}
