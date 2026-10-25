/**
 * ★★★ L8 (rà bảo mật tRPC, 2026-10-25) — PHẠM VI NHÀ MÁY CHO TOOL ĐỌC của trợ lý AI.
 *
 * `rbacGate` trả lời "được GỌI tool không?"; thứ dưới đây trả lời "được THẤY dữ liệu của MÁY nào?" — cùng bộ phân giải với tRPC (`idsMayTrongPhamVi` →
 * `idsTrongPhamVi("machine", …, { strict: true })`), không có cơ chế thứ hai. Danh tính CHỈ lấy từ `__authCtx` do `argsWithAuthCtx` bơm từ phiên thật.
 *
 * Luật chung cho tool đọc: ngoài phạm vi ≡ không tồn tại (kết quả rỗng / NOT_FOUND, KHÔNG nói "có nhưng bị chặn"); phạm vi RỖNG ⇒ `ketQuaPhamViRong` (trung thực);
 * vai toàn quyền (admin) ⇒ không lọc. FAIL-CLOSED: `__authCtx` méo ⇒ rỗng.
 * Census: `phamViDoc.census.test.ts` — MỌI tool đọc đăng ký phải có dòng trong `KHOA_PHAM_VI_DOC_TOOL` (lọc hoặc miễn trừ có lý do).
 */
import { inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { authCtxSchema } from "./readToolRbac";
import type { CoDanhTinh } from "../../routers/_phamViNguoiXem";

/** ctx tối thiểu cho các hàm `…TrongPhamVi(ctx)` của router; `null` khi `__authCtx` vắng / méo. */
export function ctxCuaTool(rawAuthCtx: unknown): CoDanhTinh | null {
  const p = authCtxSchema.safeParse(rawAuthCtx);
  return p.success ? { user: { id: p.data.userId, role: p.data.role } } : null;
}

export type PhamViMay =
  | { kind: "global" }
  | { kind: "scoped"; machineIds: number[] }
  | { kind: "empty" };

export async function giaiPhamViMay(rawAuthCtx: unknown): Promise<PhamViMay> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx) return { kind: "empty" };
  const { idsMayTrongPhamVi } = await import("../../routers/_adapterPhamVi");
  const ids = await idsMayTrongPhamVi(ctx);
  if (ids === null) return { kind: "global" };
  return ids.length > 0 ? { kind: "scoped", machineIds: ids } : { kind: "empty" };
}

/** Mệnh đề `<cột máy> IN (máy trong phạm vi)`; `undefined` khi toàn quyền. Phạm vi rỗng KHÔNG tới đây (nơi gọi đã trả `ketQuaPhamViRong`) — nếu tới thì đóng (`false`). */
export function mayCot(pv: PhamViMay, cot: AnyPgColumn | SQL): SQL | undefined {
  if (pv.kind === "global") return undefined;
  if (pv.kind === "empty") return sql`false`;
  return inArray(cot as AnyPgColumn, pv.machineIds);
}

/** Một máy cụ thể có thấy được không. */
export function mayThay(pv: PhamViMay, machineId: number | null | undefined): boolean {
  if (pv.kind === "global") return true;
  if (pv.kind === "empty") return false;
  return machineId != null && pv.machineIds.includes(machineId);
}

/** Tập id máy dạng tham số cho các hàm `db/*` có `machineIds?: number[] | null` (null = toàn quyền; [] = rỗng). */
export function machineIdsParam(pv: PhamViMay): number[] | null {
  return pv.kind === "global" ? null : pv.kind === "scoped" ? pv.machineIds : [];
}

export type PhamViDong =
  | { kind: "global" }
  | { kind: "scoped"; lineIds: number[] }
  | { kind: "empty" };

/** Phạm vi theo CHUYỀN (cùng bộ phân giải `idsTrongPhamVi("line")` của tRPC). */
export async function giaiPhamViDong(rawAuthCtx: unknown): Promise<PhamViDong> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx) return { kind: "empty" };
  const { idsTrongPhamVi } = await import("../../db/hierarchy");
  const { phamViCua } = await import("../../routers/_phamViNguoiXem");
  const ids = await idsTrongPhamVi("line", phamViCua(ctx), { strict: true });
  if (ids === null) return { kind: "global" };
  return ids.length > 0 ? { kind: "scoped", lineIds: ids } : { kind: "empty" };
}

export function dongThay(pv: PhamViDong, lineId: number | null | undefined): boolean {
  if (pv.kind === "global") return true;
  if (pv.kind === "empty") return false;
  return lineId != null && pv.lineIds.includes(lineId);
}

/**
 * Đối số phạm vi cho các hàm `db/statistics` (`StatsScopeArgs`: userId + userRole). `__authCtx` méo ⇒ danh tính -1 (không có phân công nào ⇒ phạm vi RỖNG, fail-closed) —
 * thực tế không tới đây vì `rbacGate` đã chặn trước.
 */
export function statsScopeArgs(rawAuthCtx: unknown): { userId: number; userRole: string } {
  const p = authCtxSchema.safeParse(rawAuthCtx);
  return p.success ? { userId: p.data.userId, userRole: p.data.role } : { userId: -1, userRole: "user" };
}

/** Tập id NHÀ MÁY trong phạm vi: `null` = toàn quyền; `[]` = rỗng. `__authCtx` méo ⇒ `[]` (fail-closed). */
export async function idsNhaMayCuaTool(rawAuthCtx: unknown): Promise<number[] | null> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx) return [];
  const { idsTrongPhamVi } = await import("../../db/hierarchy");
  const { phamViCua } = await import("../../routers/_phamViNguoiXem");
  return idsTrongPhamVi("factory", phamViCua(ctx), { strict: true });
}

/** Từ chối trung thực cho tool mà router tương ứng chỉ cho admin (toàn quyền) — vd. nhật ký thay đổi (audit) không có cột nhà máy. */
export function ketQuaChiToanQuyen<T>(type: import("./toolRegistry").ToolResultType, title: string, fallback: T): import("./toolRegistry").ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary:
      "Dữ liệu này (không gắn nhà máy) chỉ dành cho tài khoản quản trị TOÀN QUYỀN — giống màn hình tương ứng. " +
      "Đây là giới hạn PHẠM VI của tài khoản, không phải kết luận rằng hệ thống không có số liệu.",
    note: "PERMISSION_DENIED",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SỔ PHẠM VI TOOL ĐỌC (L8) — MỌI tool ĐỌC đăng ký phải có dòng; `phamViDoc.census.test.ts` đỏ nếu thiếu / thừa / miễn trừ không có lý do.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export type LuatPhamViDocTool =
  /** Lọc theo phạm vi MÁY / CHUYỀN / SẢN PHẨM / NHÀ MÁY của `__authCtx` (cùng bộ phân giải tRPC). `truc` = trục lọc. */
  | { kieu: "loc"; truc: string }
  /** Router tương ứng chỉ cho admin (không cột nhà máy) ⇒ tool chỉ toàn quyền. */
  | { kieu: "chi-toan-quyen"; truc: string }
  /** Đã lọc từ trước (nhóm B #1 / G3-A) — giữ để sổ đủ; kiểm bằng test riêng của tool. */
  | { kieu: "da-co"; truc: string }
  /** KHÔNG có dữ liệu nhà máy (cây mã nguồn / tài liệu hãng / trạng thái GPU / hàm thuần) — lý do ≥ 20 ký tự. */
  | { kieu: "mien"; lyDo: string };

const MIEN_REPO_DOC = "Đọc cây mã nguồn / dự án của người gọi (danh sách trắng gốc theo người gọi, doc 79 trục 2) — không phải dữ liệu nhà máy.";
const MIEN_KHONG_DL = "Hàm thuần / tài liệu hãng / bộ biên dịch ngoại tuyến — không đọc bảng thuộc nhà máy nào.";

export const KHOA_PHAM_VI_DOC_TOOL: Record<string, LuatPhamViDocTool> = {
  // ── sản lượng · chất lượng · OEE (trục MÁY)
  get_today_stats: { kieu: "loc", truc: "máy (product_inspections.machineId)" },
  get_defect_trend: { kieu: "loc", truc: "máy (product_inspections.machineId)" },
  get_top_defects: { kieu: "loc", truc: "máy (product_inspections.machineId)" },
  get_model_metrics: { kieu: "loc", truc: "máy (product_inspections.machineId)" },
  get_oee: { kieu: "loc", truc: "máy (oee_metrics.machineId)" },
  get_machine_status: { kieu: "loc", truc: "máy (machines.id)" },
  get_lot_status: { kieu: "loc", truc: "chuyền (production_orders.lineId, luật L5)" },
  get_factory_stats: { kieu: "da-co", truc: "nhà máy (giaiPhamViNhaMay, nhóm B #1)" },
  get_ng_compare: { kieu: "da-co", truc: "nhà máy (giaiPhamViNhaMay, nhóm B #1)" },
  analytics_defect_heatmap_summary: { kieu: "da-co", truc: "nhà máy (resolveFactoryScope → mã nhà máy, G3-A)" },
  analytics_query_oee: { kieu: "loc", truc: "máy (oee_metrics.machineId)" },
  analytics_defect_pareto: { kieu: "loc", truc: "máy (machineIds của paretoByDefectType/Machine)" },
  analytics_query_yield: { kieu: "loc", truc: "mã nhà máy (getYieldTrendData + StatsScopeArgs)" },
  analytics_spc_status: { kieu: "loc", truc: "mã nhà máy (getYieldTrendData + StatsScopeArgs)" },
  analytics_forecast_series: { kieu: "loc", truc: "mã nhà máy (getYieldTrendData + StatsScopeArgs)" },
  analytics_pdm_forecast: { kieu: "loc", truc: "máy (mayThay)" },
  // ── công đoạn · chuyền · OT (chỉ ĐỌC trạng thái / telemetry)
  get_machine_process_result: { kieu: "loc", truc: "máy (process_results.machineId)" },
  get_process_metric_trend: { kieu: "loc", truc: "máy (process_results.machineId)" },
  get_packaging_throughput: { kieu: "loc", truc: "máy (process_results.machineId)" },
  get_palletizer_status: { kieu: "loc", truc: "máy (machines.id)" },
  get_ot_telemetry_latest: { kieu: "loc", truc: "máy (resolveMachine + mayThay) — ngoài phạm vi ⇒ không chạm telemetry" },
  get_device_health: { kieu: "loc", truc: "máy (mayThay)" },
  get_fleet_process_summary: { kieu: "loc", truc: "máy (machineIds của aggregateProcessResultStatsByType)" },
  get_line_balance: { kieu: "loc", truc: "chuyền (giaiPhamViDong)" },
  analyze_line_bottleneck: { kieu: "loc", truc: "chuyền (giaiPhamViDong)" },
  correlate_process_quality: { kieu: "loc", truc: "máy (process_results.machineId)" },
  get_routing: { kieu: "loc", truc: "chuyền (giaiPhamViDong); danh mục công đoạn chung giữ nguyên" },
  // ── bảo trì · cảnh báo · cấu hình
  list_work_orders: { kieu: "loc", truc: "máy (maintenance_work_orders.machineId)" },
  list_active_alerts: { kieu: "loc", truc: "máy / nhà máy / chủ cài đặt (alert_settings) + cảnh báo dự đoán (congCanhBaoDuDoan)" },
  list_anomalies: { kieu: "loc", truc: "máy / nhà máy (congCanhBaoDuDoan)" },
  get_machine_health: { kieu: "loc", truc: "máy (machine_health_history.machineId) + congCanhBaoDuDoan" },
  list_recipes: { kieu: "loc", truc: "máy (dieuKienCauHinhTrongPhamVi; recipe không máy = dùng chung)" },
  list_thresholds: { kieu: "loc", truc: "sản phẩm (congSanPhamTheoPhamVi); ngưỡng yield chỉ bản MẶC ĐỊNH toàn tập đoàn (factoryId NULL, W17b)" },
  list_products: { kieu: "loc", truc: "sản phẩm (congSanPhamTheoPhamVi, luật L3)" },
  get_rca_history: { kieu: "loc", truc: "máy / nhà máy / người yêu cầu (congPhanTichNguyenNhan)" },
  trace_genealogy: { kieu: "loc", truc: "đơn vị (donViTrongPhamVi, luật L2)" },
  get_energy_metrics: { kieu: "loc", truc: "máy (energy_readings / enpi_metrics.machineId)" },
  // ── quản trị
  list_users_by_role: { kieu: "loc", truc: "người dùng được gán nhà máy mã trong phạm vi (và chính mình)" },
  list_api_keys: { kieu: "loc", truc: "máy HOẶC mã nhà máy/tập đoàn (cùng apiKey.list); không trả băm" },
  get_change_history: { kieu: "chi-toan-quyen", truc: "audit_logs không có cột nhà máy; router audit.list là adminProcedure" },
  // ── miễn trừ
  calc: { kieu: "mien", lyDo: MIEN_KHONG_DL },
  find_files: { kieu: "mien", lyDo: MIEN_REPO_DOC },
  grep_repo: { kieu: "mien", lyDo: MIEN_REPO_DOC },
  list_files: { kieu: "mien", lyDo: MIEN_REPO_DOC },
  read_file: { kieu: "mien", lyDo: MIEN_REPO_DOC },
  read_project_file: { kieu: "mien", lyDo: MIEN_REPO_DOC },
  navigate: { kieu: "mien", lyDo: "Chỉ trả đường dẫn điều hướng UI — không đọc bảng dữ liệu nào." },
  prefill_form: { kieu: "mien", lyDo: "Chỉ trả giá trị điền sẵn do người dùng nêu — không đọc bảng dữ liệu nào." },
  compile_program: { kieu: "mien", lyDo: MIEN_KHONG_DL },
  generate_program: { kieu: "mien", lyDo: MIEN_KHONG_DL },
  simulate_program: { kieu: "mien", lyDo: MIEN_KHONG_DL },
  syntax_check_program: { kieu: "mien", lyDo: MIEN_KHONG_DL },
  kiem_bien_dich_st: { kieu: "mien", lyDo: MIEN_KHONG_DL },
  retrieve_programming_kb: { kieu: "mien", lyDo: "Tra tài liệu hãng (cơ sở tri thức lập trình) — không phải dữ liệu thuộc nhà máy." },
  lookup_error_code: { kieu: "mien", lyDo: "Tra mã lỗi trong tài liệu hãng — không phải dữ liệu thuộc nhà máy." },
  get_vram_state: { kieu: "mien", lyDo: "Trạng thái bộ điều phối VRAM của GPU máy chủ — hạ tầng, không phải dữ liệu thuộc nhà máy (vramRouter.state cũng không lọc nhà máy)." },
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BỘ BỌC phạm vi dùng LẠI luật của tRPC (nạp động — giữ đồ thị nạp của sổ đăng ký tool gọn, và để test mock-DB cũ chỉ cần mock MỘT module này).
// `__authCtx` méo ⇒ FAIL-CLOSED (`false` / rỗng).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const DONG = (): SQL => sql`false`;

/** `production_orders` theo chuyền trong phạm vi (luật tRPC L5). `undefined` = toàn quyền. */
export async function congLenhTool(rawAuthCtx: unknown): Promise<SQL | undefined> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx) return DONG();
  const { dieuKienLenhSanXuatTrongPhamVi } = await import("../../routers/_adapterPhamVi");
  return dieuKienLenhSanXuatTrongPhamVi(ctx);
}

/** `predictive_alerts` theo máy / nhà máy (hàng không định vị chỉ toàn quyền). */
export async function congCanhBaoDuDoanTool(rawAuthCtx: unknown): Promise<SQL | undefined> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx) return DONG();
  const { congCanhBaoDuDoan } = await import("../../routers/_aiPhamVi");
  return congCanhBaoDuDoan(ctx);
}

/** Cột id-sản-phẩm thuộc nhà máy trong phạm vi (luật L3). */
export async function congSanPhamTool(rawAuthCtx: unknown, cotSanPhamId: AnyPgColumn | SQL): Promise<SQL | undefined> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx) return DONG();
  const { congSanPhamTheoPhamVi } = await import("../../db/product");
  const { phamViCua } = await import("../../routers/_phamViNguoiXem");
  return congSanPhamTheoPhamVi(cotSanPhamId, phamViCua(ctx));
}

/** Cấu hình theo máy (máy trong phạm vi, hoặc máy NULL = dùng chung). */
export async function congCauHinhMayTool(rawAuthCtx: unknown, cotMay: AnyPgColumn | SQL): Promise<SQL | undefined> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx) return DONG();
  const { dieuKienCauHinhTrongPhamVi } = await import("../../routers/_adapterPhamVi");
  return dieuKienCauHinhTrongPhamVi(ctx, { may: cotMay });
}

/** `root_cause_analysis` (máy / nhà máy / người yêu cầu). */
export async function congRcaTool(rawAuthCtx: unknown): Promise<SQL | undefined> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx?.user?.id) return DONG();
  const { congPhanTichNguyenNhan } = await import("../../routers/_aiPhamVi");
  return congPhanTichNguyenNhan(ctx as never);
}

/** Tập id người dùng người gọi được thấy (cùng một nhà máy mã trong phạm vi + chính mình); `null` = toàn quyền. */
export async function nguoiTrongPhamViTool(rawAuthCtx: unknown): Promise<number[] | null> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx?.user?.id) return [];
  const { getUserAssignmentCodes } = await import("../../_core/accessControl");
  const g = await getUserAssignmentCodes(ctx.user.id as number, String(ctx.user.role));
  if (g.isAdmin) return null;
  const { getDb } = await import("../../db/connection");
  const { userFactoryAssignments } = await import("../../../drizzle/schema");
  const db = await getDb();
  const fa = g.factoryCodes.length && db
    ? await db.select({ userId: userFactoryAssignments.userId }).from(userFactoryAssignments).where(inArray(userFactoryAssignments.factoryCode, g.factoryCodes))
    : [];
  return Array.from(new Set([ctx.user.id as number, ...fa.map((r) => r.userId)]));
}

/** Trục MÃ (nhà máy / tập đoàn) của người gọi cho các bảng có cột mã (khoá API…). `undefined` = toàn quyền. */
export async function congMaTool(rawAuthCtx: unknown, cot: { factoryCode?: AnyPgColumn; corporateCode?: AnyPgColumn }): Promise<SQL | undefined> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx) return DONG();
  const { congMaTenant } = await import("../../db/hierarchy");
  const { phamViCua } = await import("../../routers/_phamViNguoiXem");
  return congMaTenant(cot, phamViCua(ctx));
}

/** Tập serial người gọi thấy được (luật L2 `donViTrongPhamVi`). */
export async function donViTool(rawAuthCtx: unknown, serials: string[]): Promise<Set<string>> {
  const ctx = ctxCuaTool(rawAuthCtx);
  if (!ctx) return new Set();
  const { donViTrongPhamVi } = await import("../../routers/_adapterPhamVi");
  return donViTrongPhamVi(ctx, serials);
}
