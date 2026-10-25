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
import { theTenantHopLe } from "./_theTenantPhamVi";

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

// ═════════════════════════════════════════════════════════════════════════════
// W14b — khoá API · OAuth client · phiên: phạm vi KHOÁ không được rộng hơn người cấp
// ═════════════════════════════════════════════════════════════════════════════

export interface PhamViKhoa {
  dataScopeMode?: "factory" | "global" | null;
  corporateCode?: string | null;
  factoryCode?: string | null;
}

/** Phạm vi (chế độ + mã) có nằm TRONG phạm vi người gọi không. Toàn quyền ⇒ true. Người hẹp: 'global' / chưa khai ⇒ false; 'factory' ⇒ mã nhà máy / tập đoàn phải thuộc phạm vi. */
export async function phamViKhoaHopLe(ctx: CoDanhTinh, k: PhamViKhoa): Promise<boolean> {
  if (await toanQuyen(ctx)) return true;
  if (k.dataScopeMode !== "factory") return false; // không rộng hơn người cấp: người hẹp không cấp khoá toàn cục / chưa khai
  const fc = k.factoryCode?.trim() || null;
  const cc = k.corporateCode?.trim() || null;
  if (fc === null && cc === null) return false;
  let factoryId: number | null = null;
  if (fc !== null) {
    const h = await hangDau(sql`SELECT id FROM factories WHERE code = ${fc}`);
    if (!h) return false;
    factoryId = Number(h.id);
  }
  return theTenantHopLe(ctx, { factoryId, corporateCode: cc });
}

/** Khoá API THEO id: phạm vi hiện tại của khoá phải trong phạm vi người gọi; không → NOT_FOUND "apiKey". */
export async function khoaApiGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "dataScopeMode" AS m, "corporateCode" AS c, "factoryCode" AS f FROM api_keys WHERE id = ${id}`);
  if (!h) throw khongCo("apiKey", `API key ${id} not found`);
  const ok = await phamViKhoaHopLe(ctx, { dataScopeMode: (h.m as "factory" | "global" | null) ?? null, corporateCode: (h.c as string | null) ?? null, factoryCode: (h.f as string | null) ?? null }).catch(() => false);
  if (!ok) throw khongCo("apiKey", `API key ${id} not found`);
}

/** Phạm vi MỚI khai trong create/update: rộng hơn người cấp ⇒ FORBIDDEN SCOPE_MISMATCH. */
export async function phamViKhoaMoiGhi(ctx: CoDanhTinh, k: PhamViKhoa, entity: Entity): Promise<void> {
  if (await phamViKhoaHopLe(ctx, k).catch(() => false)) return;
  throw appError("FORBIDDEN", "SCOPE_MISMATCH", { entity, parent: "factory" }, "Phạm vi dữ liệu của khoá không được rộng hơn phạm vi của người cấp.");
}

/** Tập đoàn của ERP OAuth client / dòng outbox: null ⇒ cấp toàn cục (chỉ toàn quyền); có mã ⇒ mã phải thuộc phạm vi người gọi. */
async function tapDoanTrongPhamVi(ctx: CoDanhTinh, corporateCode: string | null): Promise<boolean> {
  if (await toanQuyen(ctx)) return true;
  if (corporateCode == null) return false;
  return theTenantHopLe(ctx, { corporateCode }).catch(() => false);
}

/** ERP OAuth client theo id (tập đoàn của nó trong phạm vi); không → NOT_FOUND "oauthClient". */
export async function oauthClientGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "corporateCode" AS c FROM erp_oauth_clients WHERE id = ${id}`);
  if (!h || !(await tapDoanTrongPhamVi(ctx, (h.c as string | null) ?? null))) throw khongCo("oauthClient", `OAuth client ${id} not found`);
}

/** Tạo OAuth client: tập đoàn khai phải trong phạm vi; người hẹp không tạo client toàn cục (không mã). */
export async function oauthClientMoiGhi(ctx: CoDanhTinh, corporateCode: string | null | undefined): Promise<void> {
  if (await tapDoanTrongPhamVi(ctx, corporateCode?.trim() || null)) return;
  throw appError("FORBIDDEN", "SCOPE_MISMATCH", { entity: "oauthClient", parent: "corporate" }, "Phạm vi tập đoàn của client không được rộng hơn phạm vi của người cấp.");
}

/**
 * Dead-letter outbox được phép thử lại: người hẹp chỉ các dòng 'dead' có corporateCode trong phạm vi (id khai ngoài phạm vi bị bỏ). Trả `null` = toàn quyền (không giới hạn, bên gọi giữ nguyên hành vi cũ);
 * mảng (có thể RỖNG ⇒ bên gọi KHÔNG được gọi retryDeadLetters vì mảng rỗng của nó nghĩa là "tất cả").
 */
export async function deadLetterDuocThuLai(ctx: CoDanhTinh, ids?: number[]): Promise<number[] | null> {
  if (await toanQuyen(ctx)) return null;
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
  const rows = (await d.execute(
    ids && ids.length > 0
      ? sql`SELECT id, "corporateCode" AS c FROM integration_outbox WHERE status = 'dead' AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`
      : sql`SELECT id, "corporateCode" AS c FROM integration_outbox WHERE status = 'dead'`,
  )) as unknown as Array<{ id: number; c: string | null }>;
  const duoc = new Map<string, boolean>();
  const ra: number[] = [];
  for (const r of rows) {
    const key = r.c ?? "\u0000null";
    if (!duoc.has(key)) duoc.set(key, await tapDoanTrongPhamVi(ctx, r.c ?? null));
    if (duoc.get(key)) ra.push(Number(r.id));
  }
  return ra;
}

/** Khoá MÁY (api_keys.machineId) theo id: máy của khoá phải trong phạm vi; khoá không gắn máy ⇒ đi theo phạm vi tenant của khoá (`khoaApiGhi`). */
export async function khoaMayGhi(ctx: CoDanhTinh, keyId: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "machineId" AS m FROM api_keys WHERE id = ${keyId}`);
  if (!h) throw khongCo("apiKey", `API key ${keyId} not found`);
  if (h.m != null) return viTriHopLe(ctx, { machineId: Number(h.m) }, "apiKey");
  return khoaApiGhi(ctx, keyId);
}

/** Trạm khai trong gói ingest của MÁY phải cùng nhà máy với máy gửi (khoá máy A không ghi vào trạm nhà máy B). Trạm không tồn tại ⇒ false. */
export async function tramCungNhaMayVoiMay(machineId: number, stationId: number): Promise<boolean> {
  const h = await hangDau(sql`SELECT (
      SELECT w."factoryId" FROM stations s JOIN production_lines l ON l.id = s."lineId" JOIN workshops w ON w.id = l."workshopId" WHERE s.id = ${stationId}
    ) AS ft, (
      SELECT w."factoryId" FROM machines m JOIN stations s ON s.id = m."stationId" JOIN production_lines l ON l.id = s."lineId" JOIN workshops w ON w.id = l."workshopId" WHERE m.id = ${machineId}
    ) AS fm`);
  return !!h && h.ft != null && h.fm != null && Number(h.ft) === Number(h.fm);
}

// ═════════════════════════════════════════════════════════════════════════════
// W14b — MQTT client management: mục tiêu (máy · trạm · nhà máy) của gán hồ sơ / sự kiện / cảnh báo
// ═════════════════════════════════════════════════════════════════════════════
type LoaiMucTieu = "machine" | "station" | "factory";
async function mucTieuTrongPhamVi(ctx: CoDanhTinh, loai: LoaiMucTieu | null | undefined, id: number | null | undefined, entity: Entity): Promise<void> {
  if (loai == null || id == null) throw khongCo(entity);
  await viTriHopLe(ctx, loai === "machine" ? { machineId: id } : loai === "station" ? { stationId: id } : { factoryId: id }, entity);
}

/**
 * Mục tiêu của một ghi MQTT (trạng thái kết nối · sự kiện kết nối lại · cảnh báo): `assignmentId` (→ mục tiêu của gán hồ sơ) hoặc `targetType`+`targetId`.
 * Người hẹp mà không nêu mục tiêu nào (chỉ `profileId` — hồ sơ là danh mục dùng chung nên bản ghi trạng thái theo hồ sơ chạm MỌI nhà máy dùng nó) ⇒ NOT_FOUND. Toàn quyền ⇒ không kiểm.
 */
export async function mucTieuMqttGhi(ctx: CoDanhTinh, o: { assignmentId?: number | null; targetType?: LoaiMucTieu | null; targetId?: number | null }, entity: Entity = "mqttAssignment"): Promise<void> {
  if (await toanQuyen(ctx)) return;
  if (o.assignmentId != null) {
    const h = await hangDau(sql`SELECT "targetType" AS t, "targetId" AS i FROM mqtt_profile_assignments WHERE id = ${o.assignmentId}`);
    if (!h) throw khongCo(entity);
    await mucTieuTrongPhamVi(ctx, h.t as LoaiMucTieu, n(h.i), entity);
    // khai thêm targetType/targetId thì phải TRÙNG phạm vi (không dùng gán A để ghi vào đích B)
    if (o.targetId != null) await mucTieuTrongPhamVi(ctx, o.targetType, o.targetId, entity);
    return;
  }
  await mucTieuTrongPhamVi(ctx, o.targetType, o.targetId, entity);
}

/** Cảnh báo kết nối MQTT theo id → mục tiêu của nó (cảnh báo cấp hồ sơ chỉ toàn quyền). */
export async function canhBaoMqttKetNoiGhi(ctx: CoDanhTinh, alertId: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "assignmentId" AS a, "targetType" AS t, "targetId" AS i FROM mqtt_connection_alerts WHERE id = ${alertId}`);
  if (!h) throw khongCo("mqttAlert");
  await mucTieuMqttGhi(ctx, { assignmentId: n(h.a), targetType: (h.t as LoaiMucTieu | null) ?? null, targetId: n(h.i) }, "mqttAlert");
}

/** Cấu hình toàn cục / cấp hồ sơ dùng chung: chỉ toàn quyền được ghi; người hẹp ⇒ NOT_FOUND `entity`. */
export async function chiToanQuyenGhi(ctx: CoDanhTinh, entity: Entity): Promise<void> {
  if (!(await toanQuyen(ctx))) throw khongCo(entity);
}

/** Mọi trạm khai phải trong phạm vi người gọi (lô: một trạm ngoài phạm vi ⇒ từ chối CẢ lô trước khi ghi). Toàn quyền ⇒ không kiểm. */
export async function cacTramGhi(ctx: CoDanhTinh, stationIds: number[]): Promise<void> {
  if (await toanQuyen(ctx)) return;
  for (const id of new Set(stationIds)) await viTriHopLe(ctx, { stationId: id }, "station");
}

/** Máy theo MÃ (lời khai của gói ingest / worker): phải tồn tại và trong phạm vi; người hẹp không nêu mã ⇒ NOT_FOUND. Toàn quyền ⇒ không kiểm. */
export async function mayTheoMaGhi(ctx: CoDanhTinh, machineCode: string | null | undefined, entity: Entity = "machine"): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const ma = machineCode?.trim();
  if (!ma) throw khongCo(entity);
  const h = await hangDau(sql`SELECT id FROM machines WHERE code = ${ma}`);
  if (!h) throw khongCo(entity);
  await viTriHopLe(ctx, { machineId: Number(h.id) }, entity);
}

/** Cấu hình hot-folder theo id → máy của nó (phải trong phạm vi). */
export async function hotFolderGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "machineId" AS m FROM hot_folder_configs WHERE id = ${id}`);
  if (!h) throw khongCo("hotFolderConfig");
  await viTriHopLe(ctx, { machineId: n(h.m) }, "hotFolderConfig");
}

/** Nút edge theo id → nhà máy (factoryCode) của nó; nút không gắn nhà máy chỉ toàn quyền. */
export async function nutEdgeGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT f.id AS fid FROM edge_nodes e LEFT JOIN factories f ON f.code = e."factoryCode" WHERE e.id = ${id}`);
  if (!h || h.fid == null) throw khongCo("edgeNode");
  await viTriHopLe(ctx, { factoryId: Number(h.fid) }, "edgeNode");
}

/** Dự án chương trình theo id → nhà máy (factoryId) của nó; không gắn nhà máy chỉ toàn quyền. */
export async function duAnChuongTrinhGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "factoryId" AS f FROM program_projects WHERE id = ${id}`);
  if (!h || h.f == null) throw khongCo("programProject");
  await viTriHopLe(ctx, { factoryId: Number(h.f) }, "programProject");
}

/** Mô hình 3D theo hàng hiện có (id hoặc modelKey): máy / nhà máy của hàng phải trong phạm vi; hàng không gắn gì chỉ toàn quyền. */
async function hangMoHinh3dTrongPhamVi(ctx: CoDanhTinh, h: Record<string, unknown> | null): Promise<void> {
  if (!h) throw khongCo("twinModel");
  await viTriHopLe(ctx, { machineId: n(h.m), factoryId: n(h.f) }, "twinModel");
}
export async function moHinh3dTheoIdGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  await hangMoHinh3dTrongPhamVi(ctx, await hangDau(sql`SELECT "machineId" AS m, "factoryId" AS f FROM equipment_3d_models WHERE id = ${id}`));
}

/**
 * Đăng ký / đăng ký lại mô hình 3D: ĐÍCH MỚI (máy · nhà máy · tập đoàn) phải trong phạm vi (người hẹp phải nêu máy hoặc nhà máy), VÀ nếu \`modelKey\` đã có
 * (đăng ký lại = GHI ĐÈ + tăng phiên bản) thì hàng cũ cũng phải thuộc phạm vi — không chiếm modelKey của nhà máy khác.
 */
export async function moHinh3dDangKyGhi(ctx: CoDanhTinh, o: { modelKey: string; machineId?: number | null; factoryId?: number | null; corporateCode?: string | null }): Promise<void> {
  if (await toanQuyen(ctx)) return;
  await viTriHopLe(ctx, { machineId: o.machineId ?? null, factoryId: o.factoryId ?? null }, "twinModel");
  if (o.corporateCode != null && !(await theTenantHopLe(ctx, { corporateCode: o.corporateCode }).catch(() => false))) throw khongCo("twinModel");
  const cu = await hangDau(sql`SELECT "machineId" AS m, "factoryId" AS f FROM equipment_3d_models WHERE "modelKey" = ${o.modelKey}`);
  if (cu) await hangMoHinh3dTrongPhamVi(ctx, cu);
}

/**
 * Hàng rào tham số (parameter_guardrails): phạm vi 'machine' ⇒ máy phải trong phạm vi người gọi; phạm vi 'machine_type' áp cho MỌI máy cùng loại ở mọi nhà máy
 * (nới dải ở đây là nới an toàn của máy nhà máy khác) ⇒ chỉ toàn quyền. KHÔNG đổi logic guardrail — chỉ thêm cổng phạm vi.
 */
export async function hangRaoGhi(ctx: CoDanhTinh, o: { scope: "machine" | "machine_type"; machineId?: number | null }): Promise<void> {
  if (await toanQuyen(ctx)) return;
  if (o.scope !== "machine" || o.machineId == null) throw khongCo("parameterGuardrail");
  await viTriHopLe(ctx, { machineId: o.machineId }, "parameterGuardrail");
}
export async function hangRaoTheoIdGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT scope AS s, machine_id AS m FROM parameter_guardrails WHERE id = ${id}`);
  if (!h) throw khongCo("parameterGuardrail");
  await hangRaoGhi(ctx, { scope: h.s as "machine" | "machine_type", machineId: n(h.m) });
}

/**
 * Lô huấn luyện AI (`ai_training_batches.batchId`, chuỗi) theo phạm vi: lô chỉ có "nhà máy" qua phản hồi của nó (ai_feedback.trainingBatchId → gợi ý → lần kiểm tra → máy).
 * Người hẹp thao tác được khi: lô tồn tại VÀ (mọi máy của phản hồi trong lô nằm trong phạm vi, có ≥ 1 phản hồi) HOẶC (lô RỖNG / chưa gom và do CHÍNH họ tạo).
 * Lô trộn máy ngoài phạm vi / không tồn tại ≡ NOT_FOUND "trainingBatch". Toàn quyền ⇒ không kiểm.
 */
export async function loHuanLuyenGhi(ctx: CoDanhTinh, batchId: string): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
  const lo = await hangDau(sql`SELECT "createdBy" AS c FROM ai_training_batches WHERE "batchId" = ${batchId}`);
  if (!lo) throw khongCo("trainingBatch", "Training batch không tồn tại");
  const may = (await d.execute(
    sql`SELECT DISTINCT i."machineId" AS m FROM ai_feedback f JOIN ai_suggestions s ON s.id = f."suggestionId" JOIN product_inspections i ON i.id = s."inspectionId" WHERE f."trainingBatchId" = ${batchId}`,
  )) as unknown as Array<{ m: number | null }>;
  if (may.length === 0) {
    if (n(lo.c) !== (ctx.user?.id ?? -1)) throw khongCo("trainingBatch", "Training batch không tồn tại");
    return;
  }
  const ids = await idsTrongPhamVi("machine", phamViCua(ctx), { strict: true });
  if (ids === null) return;
  if (!may.every((r) => r.m != null && ids.includes(Number(r.m)))) throw khongCo("trainingBatch", "Training batch không tồn tại");
}

// ═════════════════════════════════════════════════════════════════════════════
// W16 — kho vật tư theo nhà máy
// ═════════════════════════════════════════════════════════════════════════════
/** Nhà máy của máy (máy → trạm → chuyền → xưởng → nhà máy); null nếu máy không có / chưa gắn. */
export async function nhaMayCuaMay(machineId: number | null | undefined): Promise<number | null> {
  if (machineId == null) return null;
  const h = await hangDau(sql`SELECT w."factoryId" AS f FROM machines m JOIN stations s ON s.id = m."stationId" JOIN production_lines l ON l.id = s."lineId" JOIN workshops w ON w.id = l."workshopId" WHERE m.id = ${machineId}`);
  return h ? n(h.f) : null;
}

/** Tập nhà máy trong phạm vi người gọi; null = toàn quyền. */
export async function idsNhaMayCuaNguoiGoi(ctx: CoDanhTinh): Promise<number[] | null> {
  return idsTrongPhamVi("factory", phamViCua(ctx), { strict: true });
}

/** Số máy KHÁC NHAU của từng (nhà máy, mã phụ tùng) từng tiêu hao phụ tùng ấy — căn cứ của mức tồn tối thiểu (services/khoVatTu/mucTonToiThieu.ts). Khoá: `${partCode}|${factoryId}`. */
export async function soMayDungPhuTung(): Promise<Map<string, number>> {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
  const rows = (await d.execute(sql`SELECT wop."partCode" AS pc, w."factoryId" AS fid, count(DISTINCT mw."machineId")::int AS n
    FROM work_order_parts wop JOIN maintenance_work_orders mw ON mw.id = wop."workOrderId"
    JOIN machines m ON m.id = mw."machineId" JOIN stations s ON s.id = m."stationId" JOIN production_lines l ON l.id = s."lineId" JOIN workshops w ON w.id = l."workshopId"
    GROUP BY wop."partCode", w."factoryId"`)) as unknown as Array<{ pc: string; fid: number; n: number }>;
  return new Map(rows.map((r) => [`${r.pc}|${r.fid}`, Number(r.n)]));
}

/**
 * Nhà máy ĐÓNG DẤU cho hàng kho mới (phiếu nhập · lô NCC · quyết định lô): ưu tiên suy từ hàng cha (lô → phiếu → `receiptId`, quyết định → `supplierLotId`), rồi `factoryId` khai,
 * rồi nhà máy của vật tư (`materials.factoryCode`). Nhà máy suy ra phải TRONG phạm vi người gọi (ngoài ≡ NOT_FOUND "factory"); người hẹp mà không suy được nhà máy nào ⇒ NOT_FOUND
 * (fail-closed: hàng mồ côi chính họ cũng không thấy lại); toàn quyền được để NULL (admin gán sau). Khai `factoryId` MÂU THUẪN với hàng cha ⇒ NOT_FOUND (không gán lô A vào nhà máy B).
 */
export async function nhaMayDongDauKho(
  ctx: CoDanhTinh,
  o: { factoryId?: number | null; receiptId?: number | null; supplierLotId?: number | null; materialCode?: string | null },
): Promise<number | null> {
  let tuCha: number | null = null;
  if (o.supplierLotId != null) {
    const h = await hangDau(sql`SELECT "factoryId" AS f FROM supplier_lots WHERE id = ${o.supplierLotId}`);
    if (!h) throw khongCo("supplierLot");
    tuCha = n(h.f);
  } else if (o.receiptId != null) {
    const h = await hangDau(sql`SELECT "factoryId" AS f FROM material_receipts WHERE id = ${o.receiptId}`);
    if (!h) throw khongCo("materialReceipt");
    tuCha = n(h.f);
  }
  if (tuCha != null && o.factoryId != null && o.factoryId !== tuCha) throw khongCo("factory");
  let nm: number | null = o.factoryId ?? tuCha;
  if (nm == null && o.materialCode) {
    const h = await hangDau(sql`SELECT f.id AS fid FROM materials m JOIN factories f ON f.code = m."factoryCode" WHERE m.code = ${o.materialCode}`);
    nm = h ? n(h.fid) : null;
  }
  if (await toanQuyen(ctx)) return nm;
  if (nm == null) throw khongCo("factory");
  await viTriHopLe(ctx, { factoryId: nm }, "factory");
  return nm;
}

/** Quy tắc leo thang theo id: NULL (mặc định toàn tập đoàn) chỉ toàn quyền; có factoryId ⇒ nhà máy phải trong phạm vi. Không có / ngoài phạm vi ≡ NOT_FOUND "escalationRule". */
export async function quyTacLeoThangGhi(ctx: CoDanhTinh, id: number): Promise<void> {
  if (await toanQuyen(ctx)) return;
  const h = await hangDau(sql`SELECT "factoryId" AS f FROM alert_escalation_rules WHERE id = ${id}`);
  if (!h || h.f == null) throw khongCo("escalationRule", "Escalation rule not found");
  await viTriHopLe(ctx, { factoryId: Number(h.f) }, "escalationRule");
}

/** Tạo quy tắc leo thang: người hẹp phải nêu factoryId TRONG phạm vi (không tạo được quy tắc mặc định toàn tập đoàn); toàn quyền: NULL hoặc nhà máy bất kỳ tồn tại. */
export async function quyTacLeoThangMoiGhi(ctx: CoDanhTinh, factoryId: number | null): Promise<void> {
  if (await toanQuyen(ctx)) return;
  if (factoryId == null) throw appError("FORBIDDEN", "SCOPE_MISMATCH", { entity: "escalationRule", parent: "factory" }, "Quy tắc mặc định toàn tập đoàn chỉ người toàn quyền được tạo; hãy chọn nhà máy của bạn.");
  await viTriHopLe(ctx, { factoryId }, "escalationRule");
}
