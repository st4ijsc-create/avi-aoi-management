/**
 * ★★★ Phạm vi nhà máy cho GHI cấu hình hạ tầng nhà máy (ca · bố cục · lịch bảo trì · ngưỡng NG · panel · biến thể · công trạm …) — lô W13 (kiểm định phamViGhi, 2026-10-25).
 * Luật chung (chủ dự án duyệt 2026-10-24): ngoài phạm vi ≡ KHÔNG TỒN TẠI (cùng lỗi NOT_FOUND của id không có thật), kiểm TRƯỚC khi ghi; toàn quyền (admin) ⇒ không kiểm.
 * Mọi hàm ném đúng MỘT dạng lỗi theo `entity` (không lộ "tồn tại nhưng không phải của bạn").
 */
import { sql } from "drizzle-orm";
import { appError } from "../_core/appError";
import { getDb } from "../db";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";
import { ghiViTri, type ViTriGhi } from "./_viTriPhamVi";
import { sanPhamGhiTrongPhamVi, diemDoGhiTrongPhamVi } from "./_sanPhamPhamVi";

type Entity = string;
const khongCo = (entity: Entity, msg = "Not found") => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity }, msg);

async function toanQuyen(ctx: CoDanhTinh): Promise<boolean> {
  return (await idsTrongPhamVi("factory", phamViCua(ctx), { strict: true })) === null;
}

async function hangDau(q: ReturnType<typeof sql>): Promise<Record<string, unknown> | null> {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
  const r = (await d.execute(q)) as unknown as Array<Record<string, unknown>>;
  return r[0] ?? null;
}
const n = (v: unknown): number | null => (v == null ? null : Number(v));

/** Vị trí phải trong phạm vi; ngoài phạm vi / không có ⇒ NOT_FOUND `entity` (một dạng lỗi). `batBuoc`: người hẹp mà không nêu vị trí ⇒ không có. */
export async function viTriHopLe(ctx: CoDanhTinh, loc: ViTriGhi, entity: Entity): Promise<void> {
  if (await toanQuyen(ctx)) return;
  try {
    await ghiViTri(ctx, loc, { batBuoc: true });
  } catch {
    throw khongCo(entity);
  }
}

/** Hàng cấu hình theo NHÀ MÁY (shift_configs …): `factoryId` null = mặc định toàn cục ⇒ chỉ toàn quyền được ghi. */
export async function hangTheoNhaMay(ctx: CoDanhTinh, factoryId: number | null | undefined, entity: Entity): Promise<void> {
  if (await toanQuyen(ctx)) return;
  if (factoryId == null) throw khongCo(entity);
  await viTriHopLe(ctx, { factoryId }, entity);
}

/** Ca làm việc theo id → nhà máy của nó (null = mặc định toàn cục ⇒ chỉ toàn quyền). */
export async function caLamViecGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "factoryId" AS f FROM shift_configs WHERE id = ${id}`);
  if (!h) throw khongCo("shiftConfig");
  await hangTheoNhaMay(ctx, n(h.f), "shiftConfig");
}

/** Bố cục xưởng theo id → xưởng của nó. */
export async function boCucGhi(ctx: CoDanhTinh, layoutId: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "workshopId" AS w, "factoryId" AS f FROM factory_layouts WHERE id = ${layoutId}`);
  if (!h) throw khongCo("factoryLayout", "Layout not found");
  await viTriHopLe(ctx, { workshopId: n(h.w), factoryId: n(h.f) }, "factoryLayout");
}

/** Vị trí máy trên bố cục (machine_positions) theo id → bố cục của nó. */
export async function viTriMayBoCucGhi(ctx: CoDanhTinh, positionId: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "layoutId" AS l FROM machine_positions WHERE id = ${positionId}`);
  if (!h) throw khongCo("factoryLayout", "Layout not found");
  await boCucGhi(ctx, Number(h.l));
}

/** Lịch bảo trì theo id → máy của nó (máy phải trong phạm vi). */
export async function lichBaoTriGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "machineId" AS m, "factoryId" AS f FROM maintenance_schedules WHERE id = ${id}`);
  if (!h) throw khongCo("maintenanceSchedule");
  await viTriHopLe(ctx, { machineId: n(h.m), factoryId: n(h.f) }, "maintenanceSchedule");
}

/** Lô ngưỡng NG (mqtt_ng_rate_thresholds) theo id → trạm / máy của nó. */
export async function nguongNgGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "stationId" AS s, "machineId" AS m FROM mqtt_ng_rate_thresholds WHERE id = ${id}`);
  if (!h) throw khongCo("ngRateThreshold", "Threshold not found");
  await viTriHopLe(ctx, { stationId: n(h.s), machineId: n(h.m) }, "ngRateThreshold");
}

/** Cảnh báo NG (mqtt_ng_rate_alert_history) theo id → trạm / máy của nó. */
export async function canhBaoNgGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "stationId" AS s, "machineId" AS m FROM mqtt_ng_rate_alert_history WHERE id = ${id}`);
  if (!h) throw khongCo("ngRateAlert", "Alert not found");
  await viTriHopLe(ctx, { stationId: n(h.s), machineId: n(h.m) }, "ngRateAlert");
}

/** Gán quy trình – chuyền (line_process_assignments) theo id → chuyền / trạm của nó. */
export async function ganQuyTrinhGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "lineId" AS l, "stationId" AS s FROM line_process_assignments WHERE id = ${id}`);
  if (!h) throw khongCo("lineProcessAssignment");
  await viTriHopLe(ctx, { lineId: n(h.l), stationId: n(h.s) }, "lineProcessAssignment");
}

/** Định nghĩa panel theo id → sản phẩm của nó (luật ghi theo sản phẩm do bên gọi áp). Trả productModelId, hoặc null nếu không có. */
export async function sanPhamCuaPanel(panelDefId: number): Promise<number | null> {
  const h = await hangDau(sql`SELECT "productModelId" AS p FROM product_panel_defs WHERE id = ${panelDefId}`);
  return h ? n(h.p) : null;
}

/** Biến thể sản phẩm theo id → sản phẩm của nó. */
export async function sanPhamCuaBienThe(variantId: number): Promise<number | null> {
  const h = await hangDau(sql`SELECT "productModelId" AS p FROM product_variants WHERE id = ${variantId}`);
  return h ? n(h.p) : null;
}

/** Yêu cầu duyệt ngưỡng theo id → điểm đo của nó. */
export async function diemDoCuaDuyetNguong(id: number): Promise<number | null> {
  const h = await hangDau(sql`SELECT "pointDefId" AS p FROM threshold_approvals WHERE id = ${id}`);
  return h ? n(h.p) : null;
}

/** Công trạm theo id phải trong phạm vi (factoryId / workshopId / lineId của nó; công trạm mồ côi chỉ toàn quyền). */
export async function congTramGhi(ctx: CoDanhTinh, workstationId: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const ids = await idsTrongPhamVi("workstation", phamViCua(ctx), { strict: true });
  if (!ids || !ids.includes(workstationId)) throw khongCo("workstation", "Workstation not found");
}

// ═════════════════════════════════════════════════════════════════════════════
// W14 — thực thể kỹ thuật / chất lượng khai khoá nhà máy · sản phẩm · BOM · lần kiểm tra
// ═════════════════════════════════════════════════════════════════════════════

/** Chạy một phép kiểm có thể ném; mọi lỗi ⇒ NOT_FOUND `entity` (một dạng lỗi). */
export async function hoacKhongCo(entity: Entity, chay: () => Promise<void>, msg?: string): Promise<void> {
  try {
    await chay();
  } catch {
    throw khongCo(entity, msg);
  }
}

/** BOM theo id → sản phẩm của nó phải ghi được (luật ghi theo sản phẩm); BOM không có ≡ ngoài phạm vi. */
export async function bomGhi(ctx: CoDanhTinh, bomId: number, entity: Entity = "bom"): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "productModelId" AS p FROM bom_definitions WHERE id = ${bomId}`);
  if (!h) throw khongCo(entity);
  await hoacKhongCo(entity, () => sanPhamGhiTrongPhamVi(ctx, Number(h.p)));
}

/** Dòng BOM theo id → BOM → sản phẩm. */
export async function dongBomGhi(ctx: CoDanhTinh, lineItemId: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "bomId" AS b FROM bom_line_items WHERE id = ${lineItemId}`);
  if (!h) throw khongCo("bomLineItem");
  await bomGhi(ctx, Number(h.b), "bomLineItem");
}

export interface KhoaKyThuat {
  factoryId?: number | null;
  productModelId?: number | null;
  bomId?: number | null;
  inspectionId?: number | null;
  machineId?: number | null;
}
/**
 * Mỗi khoá được nêu phải trong phạm vi (nhà máy · máy: `viTriHopLe`; sản phẩm / BOM: luật ghi theo sản phẩm; lần kiểm tra: máy của nó phải TỒN TẠI và trong phạm vi).
 * Không nêu khoá nào ⇒ qua (thực thể cấp công ty chưa gắn gì — quyền module là cổng duy nhất, ghi trong sổ miễn trừ khi áp dụng).
 */
export async function khoaKyThuatGhi(ctx: CoDanhTinh, k: KhoaKyThuat, entity: Entity): Promise<void> {
  if (await toanQuyen(ctx)) return;
  if (k.factoryId != null || k.machineId != null) await viTriHopLe(ctx, { factoryId: k.factoryId ?? null, machineId: k.machineId ?? null }, entity);
  if (k.productModelId != null) await hoacKhongCo(entity, () => sanPhamGhiTrongPhamVi(ctx, k.productModelId!));
  if (k.bomId != null) await bomGhi(ctx, k.bomId, entity);
  if (k.inspectionId != null) {
    const h = await hangDau(sql`SELECT "machineId" AS m FROM product_inspections WHERE id = ${k.inspectionId}`);
    if (!h) throw khongCo(entity);
    await viTriHopLe(ctx, { machineId: n(h.m) }, entity);
  }
}

/** Máy tuỳ chọn: có nêu thì phải trong phạm vi; không nêu ⇒ qua (nhật ký cấp vật tư chưa gắn máy — quyền module là cổng). */
export async function mayTuyChonGhi(ctx: CoDanhTinh, machineId: number | null | undefined, entity: Entity): Promise<void> {
  if (machineId == null) return;
  await viTriHopLe(ctx, { machineId }, entity);
}

/** Nhật ký phơi nhiễm MSD theo id → máy của nó (nếu có). */
export async function nhatKyMsdGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "machineId" AS m FROM msd_exposure_logs WHERE id = ${id}`);
  if (!h) throw khongCo("msdExposure");
  await mayTuyChonGhi(ctx, n(h.m), "msdExposure");
}

/** Số đo năng lượng: ít nhất MỘT trong máy / bố cục phải nêu và trong phạm vi (người hẹp); toàn quyền ⇒ không kiểm. */
export async function nangLuongGhi(ctx: CoDanhTinh, machineId: number | null | undefined, layoutId: number | null | undefined): Promise<void> {
  if (await toanQuyen(ctx)) return;
  if (machineId == null && layoutId == null) throw khongCo("machine");
  if (machineId != null) await viTriHopLe(ctx, { machineId }, "machine");
  if (layoutId != null) await boCucGhi(ctx, layoutId);
}

/**
 * Mẫu đo (measurement_samples) theo điểm đo → chỉ giữ mẫu của điểm đo thuộc sản phẩm GHI ĐƯỢC trong phạm vi (luật ghi theo sản phẩm). Toàn quyền ⇒ trả nguyên.
 * Điểm đo không tồn tại ≡ ngoài phạm vi (bị loại).
 */
export async function locMauTheoPhamVi<T extends { pointDefId?: number | null }>(ctx: CoDanhTinh, rows: T[]): Promise<T[]> {
  if (await toanQuyen(ctx)) return rows;
  const duoc = new Map<number, boolean>();
  for (const id of new Set(rows.map((r) => r.pointDefId).filter((x): x is number => x != null))) {
    try {
      await diemDoGhiTrongPhamVi(ctx, id);
      duoc.set(id, true);
    } catch {
      duoc.set(id, false);
    }
  }
  return rows.filter((r) => r.pointDefId != null && duoc.get(r.pointDefId) === true);
}
