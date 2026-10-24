/**
 * ★★★ Lô W11c — CỔNG PHẠM VI NHÀ MÁY CHUNG cho TOOL GHI do AI đề xuất (kiểm định phamViGhi, 2026-10-25; dieu-phoi duyệt cùng ngày).
 *
 * Trước đây `proposeAction` / `confirmAction` chỉ kiểm QUYỀN module (RBAC) + chủ phiên: kỹ sư nhà máy B đủ quyền module nhờ AI ghi lên máy / sản phẩm /
 * cảnh báo của nhà máy A vẫn được thực thi (đo ĐỎ ở `writeHandlers/phamViGhiToolDo.db.test.ts`). Cổng này THÊM một lớp: khoá định danh nhà máy trong tham số
 * của tool phải TRONG phạm vi người gọi, dùng lại ĐÚNG các hàm đã vá ở tRPC (ghiViTri · ghiDoiTuong · sanPhamGhiTrongPhamVi · diemDoGhiTrongPhamVi · canhBaoDuDoanGhi).
 *
 * Luật:
 *  • gọi ở HAI chỗ: `proposeAction` (từ chối ngay) và `confirmAction` (kiểm LẠI lúc thực thi, dùng tham số ĐÃ LƯU trong hàng — không nhận lại từ client);
 *  • FAIL-CLOSED: không tra được thực thể / thiếu khoá / lỗi CSDL / ngoại lệ bất kỳ ⇒ `OUT_OF_SCOPE`. Ngoài phạm vi và không tồn tại cho CÙNG một kết quả;
 *  • toàn quyền (admin, `idsTrongPhamVi("factory") === null`) ⇒ bỏ qua — cùng sàn đã dùng ở tRPC, không thêm đường tắt khác;
 *  • tool OT: cổng này chỉ THÊM kiểm máy, KHÔNG thay `aiControlGate` / `otWriteBinding` / `AI_OT_CONTROL_ENABLED` (chúng vẫn chạy nguyên); không có đường nào
 *    mà cổng này làm một lệnh OT từng bị chặn nay lọt (nó chỉ có thể từ chối thêm);
 *  • MỖI tool GHI đã đăng ký phải có một dòng trong `KHOA_PHAM_VI_TOOL` (hoặc miễn trừ CÓ LÝ DO) — `phamViGhi.census.test.ts` đỏ nếu thiếu.
 */
import { sql } from "drizzle-orm";
import { appError } from "../../_core/appError";
import { getDb } from "../../db/connection";
import { idsTrongPhamVi } from "../../db/hierarchy";
import { phamViCua, type CoDanhTinh } from "../../routers/_phamViNguoiXem";
import { ghiViTri, ghiDoiTuong, canhBaoDuDoanGhi } from "../../routers/_viTriPhamVi";
import { sanPhamGhiTrongPhamVi, diemDoGhiTrongPhamVi } from "../../routers/_sanPhamPhamVi";

type Args = Record<string, unknown>;

/** Một luật: ném lỗi (bất kỳ) khi KHÔNG trong phạm vi. */
type Kiem = (a: Args, ctx: CoDanhTinh) => Promise<void>;

export type LuatPhamViTool = { kieu: "kiem"; kiem: Kiem } | { kieu: "mien"; lyDo: string };

function so(a: Args, khoa: string): number | null {
  const v = a[khoa];
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}
function batBuocSo(a: Args, khoa: string): number {
  const v = so(a, khoa);
  if (v === null) throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: khoa }, "thiếu khoá");
  return v;
}
function soHoacNull(a: Args, khoa: string): number | null {
  const v = a[khoa];
  if (v === undefined || v === null) return null;
  return batBuocSo(a, khoa); // có nêu mà sai kiểu ⇒ lỗi (fail-closed)
}

const theoMay: Kiem = async (a, ctx) => ghiViTri(ctx, { machineId: batBuocSo(a, "machineId") }, { batBuoc: true });

/** Dòng CSDL thô; lỗi / vắng ⇒ ném. */
async function hang(q: ReturnType<typeof sql>): Promise<Record<string, unknown>> {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "db");
  const r = (await d.execute(q)) as unknown as Array<Record<string, unknown>>;
  if (!r[0]) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "tool-target" }, "không có hàng");
  return r[0];
}
const n = (v: unknown): number | null => (v == null ? null : Number(v));

/** Ngưỡng NG theo id → trạm / máy / điểm đo / sản phẩm của nó. */
const theoNguongNg: Kiem = async (a, ctx) => {
  const t = await hang(sql`SELECT "stationId" AS s, "machineId" AS m, "measurementPointId" AS p, "productModelId" AS pm FROM mqtt_ng_rate_thresholds WHERE id = ${batBuocSo(a, "thresholdId")}`);
  await ghiDoiTuong(ctx, { stationId: n(t.s), machineId: n(t.m), measurementPointDefId: n(t.p), productModelId: n(t.pm) }, { batBuoc: true });
};

/** Bản ghi cảnh báo (alert_history) → cài đặt cảnh báo → máy / nhà máy; cài đặt toàn cục (không máy, không nhà máy) ⇒ chỉ chủ cài đặt. */
const theoCanhBaoMqtt: Kiem = async (a, ctx) => {
  const id = so(a, "id") ?? batBuocSo(a, "alertSettingId");
  const h = await hang(sql`SELECT s."machineId" AS m, s."factoryId" AS f, s."userId" AS u
    FROM alert_history h JOIN alert_settings s ON s.id = h."alertSettingId" WHERE h.id = ${id}`);
  const m = n(h.m);
  const f = n(h.f);
  if (m === null && f === null) {
    if (n(h.u) !== (ctx.user?.id ?? -1)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "alert" }, "cảnh báo toàn cục của người khác");
    return;
  }
  await ghiViTri(ctx, { machineId: m, factoryId: f }, { batBuoc: true });
};

const MIEN_REPO = "Tool ghi vào GỐC DỰ ÁN (mã nguồn / lệnh sandbox), không thuộc dữ liệu nhà máy; đã có danh sách trắng gốc theo người gọi (doc 79 trục 2) và cổng riêng của từng tool.";

/**
 * BẢNG LUẬT — khoá = tên tool GHI trong registry. Thêm tool GHI mới ⇒ PHẢI thêm dòng (census đỏ nếu thiếu).
 * Tool OT: kiểm máy THÊM vào `aiControlGate` / `otWriteBinding` (xem docblock đầu tệp).
 */
export const KHOA_PHAM_VI_TOOL: Record<string, LuatPhamViTool> = {
  // ── Điều khiển OT (khoá: machineId) ──
  machine_start: { kieu: "kiem", kiem: theoMay },
  machine_stop: { kieu: "kiem", kiem: theoMay },
  machine_pause: { kieu: "kiem", kiem: theoMay },
  machine_reset: { kieu: "kiem", kiem: theoMay },
  select_recipe: { kieu: "kiem", kiem: theoMay },
  download_job: { kieu: "kiem", kiem: theoMay },
  set_machine_param: { kieu: "kiem", kiem: theoMay },
  acknowledge_machine_alarm: { kieu: "kiem", kiem: theoMay },
  reject_divert: { kieu: "kiem", kiem: theoMay },
  spi_printer_offset: { kieu: "kiem", kiem: theoMay },
  // ── Bảo trì · phân tích ──
  create_maintenance_workorder: { kieu: "kiem", kiem: theoMay },
  run_rca_analysis: { kieu: "kiem", kiem: theoMay },
  // ── Cảnh báo ──
  acknowledge_alert: { kieu: "kiem", kiem: theoCanhBaoMqtt },
  acknowledge_predictive_alert: { kieu: "kiem", kiem: async (a, ctx) => canhBaoDuDoanGhi(ctx, batBuocSo(a, "predictiveAlertId")) },
  resolve_predictive_alert: { kieu: "kiem", kiem: async (a, ctx) => canhBaoDuDoanGhi(ctx, batBuocSo(a, "predictiveAlertId")) },
  // ── Ngưỡng ──
  adjust_ng_threshold: { kieu: "kiem", kiem: theoNguongNg },
  configure_inspection_param: { kieu: "kiem", kiem: theoNguongNg },
  create_ng_threshold: {
    kieu: "kiem",
    kiem: async (a, ctx) =>
      ghiDoiTuong(ctx, { stationId: batBuocSo(a, "stationId"), machineId: soHoacNull(a, "machineId"), measurementPointDefId: soHoacNull(a, "measurementPointId"), productModelId: soHoacNull(a, "productModelId") }, { batBuoc: true }),
  },
  request_threshold_review: {
    kieu: "kiem",
    kiem: async (a, ctx) => ghiDoiTuong(ctx, { machineId: soHoacNull(a, "machineId"), measurementPointDefId: soHoacNull(a, "pointDefId") }, { batBuoc: true }),
  },
  set_yield_threshold: {
    kieu: "mien",
    lyDo: "Ngưỡng yield là cấu hình TOÀN CỤC (bảng yield_alert_thresholds không có cột nhà máy / máy); chỉ giữ bằng quyền settings_yield_thresholds + cổng aiControlGate (L-7).",
  },
  // ── Sản phẩm · điểm đo ──
  update_product_quality_target: { kieu: "kiem", kiem: async (a, ctx) => sanPhamGhiTrongPhamVi(ctx, batBuocSo(a, "productModelId")) },
  create_measurement_point: { kieu: "kiem", kiem: async (a, ctx) => sanPhamGhiTrongPhamVi(ctx, batBuocSo(a, "productModelId")) },
  update_measurement_point: { kieu: "kiem", kiem: async (a, ctx) => diemDoGhiTrongPhamVi(ctx, batBuocSo(a, "id")) },
  set_spec_limits: { kieu: "kiem", kiem: async (a, ctx) => diemDoGhiTrongPhamVi(ctx, batBuocSo(a, "measurementPointDefId")) },
  // ── An toàn ──
  propose_interlock_rule: {
    kieu: "kiem",
    kiem: async (a, ctx) => ghiViTri(ctx, { lineId: soHoacNull(a, "lineId"), stationId: soHoacNull(a, "stationId"), machineId: soHoacNull(a, "machineId") }, { batBuoc: true }),
  },
  // ── Repo (không thuộc dữ liệu nhà máy) ──
  apply_diff: { kieu: "mien", lyDo: MIEN_REPO },
  apply_diff_batch: { kieu: "mien", lyDo: MIEN_REPO },
  delete_file: { kieu: "mien", lyDo: MIEN_REPO },
  rename_file: { kieu: "mien", lyDo: MIEN_REPO },
  run_command: { kieu: "mien", lyDo: MIEN_REPO },
  write_project_file: { kieu: "mien", lyDo: MIEN_REPO },
};

export type KetQuaPhamViTool = { ok: true } | { ok: false; reason: "OUT_OF_SCOPE" };

/**
 * Kiểm phạm vi nhà máy cho MỘT tool ghi với tham số `args`. KHÔNG BAO GIỜ ném: mọi lỗi ⇒ `OUT_OF_SCOPE` (fail-closed).
 * Tool vắng trong bảng ⇒ `OUT_OF_SCOPE` (census canh thêm ở thời điểm build).
 */
export async function kiemPhamViGhiTool(toolName: string, args: Args, user: { id: number; role: string }): Promise<KetQuaPhamViTool> {
  const luat = KHOA_PHAM_VI_TOOL[toolName];
  if (!luat) return { ok: false, reason: "OUT_OF_SCOPE" };
  if (luat.kieu === "mien") return { ok: true };
  try {
    const ctx: CoDanhTinh = { user };
    if ((await idsTrongPhamVi("factory", phamViCua(ctx), { strict: true })) === null) return { ok: true }; // toàn quyền
    await luat.kiem(args, ctx);
    return { ok: true };
  } catch {
    return { ok: false, reason: "OUT_OF_SCOPE" };
  }
}
