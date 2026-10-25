/**
 * ★★★ 2026-10-24 — BỘ PHÂN GIẢI PHẠM VI NHÀ MÁY DÙNG CHUNG cho MỌI thủ tục tRPC khoá theo `adapterId` (rà bảo mật, scada-master phát hiện:
 * `commissioning.list|status`, `deviceAdapter.tags.listByAdapter`, `unsMapping.get|list` đọc dữ liệu adapter của nhà máy KHÁC).
 *
 * Luật (cùng `scadaDiagRouter`, nay một nơi): adapter nhìn thấy được ⇔ phạm vi toàn quyền (`idsTrongPhamVi` = null) HOẶC `machineId` của nó ∈ tập máy trong phạm vi.
 * Adapter KHÔNG gắn máy (`machineId` null) chỉ phạm vi toàn quyền thấy. "Ngoài phạm vi" ≡ "không tồn tại": CÙNG một NOT_FOUND (không lộ sự tồn tại). Danh sách chỉ trả mục trong phạm vi.
 * `strict: true` — không phân giải được phạm vi (DB) ⇒ NÉM, không đoán "toàn quyền" (fail-closed).
 * Danh tính LUÔN từ `ctx.user` (`phamViCua`), không bao giờ từ `input`.
 */
import { eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { appError } from "../_core/appError";
import { getDb as getDbRaw } from "../db";
import { idsTrongPhamVi, type PhamViDoc } from "../db/hierarchy";
import { cameraCalibrations, collaborationSessions, commandLog, commissioningRecords, deviceAdapters, deviceTags, lineBalanceMetrics, productionOrders, productionSessions, recipeSetItems, robots, safetyEvents, safetyZones, stationDwellTime, wipTracking } from "../../drizzle/schema";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";

export const khongThayAdapter = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
export const khongThayMay = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, "Máy không tồn tại.");

async function layDb() {
  const d = await getDbRaw();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Tập id máy trong phạm vi người gọi: `null` = toàn quyền (không lọc), `[]` = phạm vi rỗng. */
export async function idsMayTrongPhamVi(ctx: CoDanhTinh): Promise<number[] | null> {
  return idsTrongPhamVi("machine", phamViCua(ctx), { strict: true });
}

/** Adapter nhìn thấy được với tập máy trong phạm vi (xem luật ở đầu tệp). */
export function adapterNhinThay(machineId: number | null, idsMay: number[] | null): boolean {
  if (idsMay === null) return true;
  return machineId !== null && idsMay.includes(machineId);
}

/** Điều kiện SQL cho danh sách `device_adapters`: `undefined` khi toàn quyền (không thêm cổng nào — chiều DƯƠNG chống vá quá tay). */
export function dieuKienAdapterTrongPhamVi(idsMay: number[] | null): SQL | undefined {
  return idsMay === null ? undefined : inArray(deviceAdapters.machineId, idsMay.length > 0 ? idsMay : [-1]);
}

export interface HangAdapterToiThieu {
  id: number;
  code: string;
  machineId: number | null;
}

/** Đọc MỘT adapter theo id client gửi và kiểm phạm vi. Không thấy / ngoài phạm vi ⇒ cùng NOT_FOUND. */
export async function adapterTrongPhamVi(ctx: CoDanhTinh, adapterId: number): Promise<HangAdapterToiThieu> {
  const db = await layDb();
  const idsMay = await idsMayTrongPhamVi(ctx);
  const [row] = await db
    .select({ id: deviceAdapters.id, code: deviceAdapters.code, machineId: deviceAdapters.machineId })
    .from(deviceAdapters)
    .where(eq(deviceAdapters.id, adapterId))
    .limit(1);
  if (!row || !adapterNhinThay(row.machineId, idsMay)) throw khongThayAdapter();
  return row;
}

/** Như trên nhưng theo MÃ adapter (mappingAsCode). */
export async function adapterTheoMaTrongPhamVi(ctx: CoDanhTinh, ma: string): Promise<HangAdapterToiThieu | null> {
  const db = await layDb();
  const idsMay = await idsMayTrongPhamVi(ctx);
  const [row] = await db
    .select({ id: deviceAdapters.id, code: deviceAdapters.code, machineId: deviceAdapters.machineId })
    .from(deviceAdapters)
    .where(eq(deviceAdapters.code, ma))
    .limit(1);
  if (!row || !adapterNhinThay(row.machineId, idsMay)) return null;
  return row;
}

/**
 * Máy mà một adapter ĐƯỢC PHÉP gắn vào (tạo adapter / đổi `machineId`): phạm vi toàn quyền ⇒ mọi giá trị (kể cả null); phạm vi hẹp ⇒ máy PHẢI trong phạm vi
 * (null = tạo adapter vô chủ mà chính người đó sẽ không thấy lại ⇒ từ chối; máy ngoài phạm vi ⇒ NOT_FOUND như "máy không tồn tại").
 */
export async function maySuDungTrongPhamVi(ctx: CoDanhTinh, machineId: number | null): Promise<void> {
  const idsMay = await idsMayTrongPhamVi(ctx);
  if (idsMay === null) return;
  if (machineId === null) {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "machineId" }, "Adapter phải gắn một máy thuộc phạm vi của bạn.");
  }
  if (!idsMay.includes(machineId)) throw khongThayMay();
}

/** NOT_FOUND của một tag — MỘT hình dạng cho "không tồn tại" và "ngoài phạm vi" (kiem-dinh R1b-1 M6). */
export const khongThayTag = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");

/**
 * Adapter của một TAG (id client gửi): tag không tồn tại / adapter ngoài phạm vi ⇒ CÙNG MỘT NOT_FOUND `{ entity: "deviceTag" }`. Trả `adapterId`.
 * kiem-dinh R1b-1 M6 (2026-10-25): trước đây ngoài phạm vi trả `NOT_FOUND {entity:"adapter"}` (lỗi của `adapterTrongPhamVi`) còn không tồn tại
 * trả `{entity:"deviceTag"}` ⇒ người nhà máy A dò id tag phân biệt được tag CÓ THẬT của nhà máy B. Lỗi phạm vi đổi về đúng lỗi "không tồn tại";
 * lỗi khác (DB, phạm vi không phân giải được — strict) vẫn ném nguyên.
 */
export async function adapterCuaTag(ctx: CoDanhTinh, tagId: number): Promise<number> {
  const db = await layDb();
  const [t] = await db.select({ adapterId: deviceTags.adapterId }).from(deviceTags).where(eq(deviceTags.id, tagId)).limit(1);
  if (!t) throw khongThayTag();
  try {
    await adapterTrongPhamVi(ctx, t.adapterId);
  } catch (e) {
    const c = (e as { code?: string; cause?: { appCode?: string } } | null) ?? null;
    if (c?.code === "NOT_FOUND" && c.cause?.appCode === "ENTITY_NOT_FOUND") throw khongThayTag();
    throw e;
  }
  return t.adapterId;
}

/** Adapter của một BẢN KÝ commissioning (id client gửi). Không thấy / ngoài phạm vi ⇒ NOT_FOUND. */
export async function adapterCuaBanKy(ctx: CoDanhTinh, recordId: number): Promise<number> {
  const db = await layDb();
  const [r] = await db
    .select({ adapterId: commissioningRecords.adapterId })
    .from(commissioningRecords)
    .where(eq(commissioningRecords.id, recordId))
    .limit(1);
  if (!r) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "commissioningRecord" }, "Bản ghi commissioning không tồn tại.");
  await adapterTrongPhamVi(ctx, r.adapterId);
  return r.adapterId;
}

/** Tập id adapter trong phạm vi (cho danh sách lọc ở tầng router): `null` = toàn quyền. */
export async function idsAdapterTrongPhamVi(ctx: CoDanhTinh): Promise<Set<number> | null> {
  const idsMay = await idsMayTrongPhamVi(ctx);
  if (idsMay === null) return null;
  if (idsMay.length === 0) return new Set();
  const db = await layDb();
  const rows = await db.select({ id: deviceAdapters.id }).from(deviceAdapters).where(inArray(deviceAdapters.machineId, idsMay));
  return new Set(rows.map((r) => r.id));
}

/** Tập MÃ adapter trong phạm vi: `null` = toàn quyền. */
export async function maAdapterTrongPhamVi(ctx: CoDanhTinh): Promise<Set<string> | null> {
  const idsMay = await idsMayTrongPhamVi(ctx);
  if (idsMay === null) return null;
  if (idsMay.length === 0) return new Set();
  const db = await layDb();
  const rows = await db.select({ code: deviceAdapters.code }).from(deviceAdapters).where(inArray(deviceAdapters.machineId, idsMay));
  return new Set(rows.map((r) => r.code));
}

/** Một MÁY id client gửi phải trong phạm vi; ngoài phạm vi / không tồn tại ⇒ cùng NOT_FOUND "machine". Trả tập id máy (null = toàn quyền) để tái dùng. */
export async function mayTrongPhamVi(ctx: CoDanhTinh, machineId: number): Promise<number[] | null> {
  const idsMay = await idsMayTrongPhamVi(ctx);
  if (idsMay !== null && !idsMay.includes(machineId)) throw khongThayMay();
  return idsMay;
}

/** Điều kiện SQL cho `command_log`: lệnh của máy trong phạm vi HOẶC của adapter gắn máy trong phạm vi. `undefined` khi toàn quyền. */
export function dieuKienLenhTrongPhamVi(idsMay: number[] | null): SQL | undefined {
  if (idsMay === null) return undefined;
  const ids = idsMay.length > 0 ? idsMay : [-1];
  return or(
    inArray(commandLog.machineId, ids),
    inArray(commandLog.adapterId, sql`(select ${deviceAdapters.id} from ${deviceAdapters} where ${inArray(deviceAdapters.machineId, ids)})`),
  );
}

/** Cột định vị của một bảng tenant (bỏ trống cột nào bảng không có). `deviceId` không bao giờ dùng định vị. */
export interface CotViTri {
  lineId?: AnyPgColumn;
  stationId?: AnyPgColumn;
  factoryId?: AnyPgColumn;
  robotId?: AnyPgColumn;
  machineId?: AnyPgColumn;
}

/**
 * Điều kiện SQL phạm vi nhà máy cho một bảng tenant theo CỘT ĐỊNH VỊ (line/station/factory/robot): hàng thấy được ⇔ toàn quyền, HOẶC có ÍT NHẤT MỘT thuộc tính định vị khác null VÀ MỌI thuộc tính
 * khác null đều trong phạm vi (robot ⇒ line của nó hoặc line của station của nó). Hàng không định vị được chỉ phạm vi toàn quyền thấy — fail-closed. `undefined` khi toàn quyền.
 * `phamVi`: trục ① (`phamViCua(ctx)`, người dùng) HOẶC trục ② (`{ tenantScope }`, khoá API) — cùng bộ phân giải `idsTrongPhamVi`.
 */
export async function dieuKienViTriTrongPhamVi(phamVi: PhamViDoc, cot: CotViTri): Promise<SQL | undefined> {
  const [dong, tram, nhaMay, may] = await Promise.all([
    idsTrongPhamVi("line", phamVi, { strict: true }),
    idsTrongPhamVi("station", phamVi, { strict: true }),
    idsTrongPhamVi("factory", phamVi, { strict: true }),
    idsTrongPhamVi("machine", phamVi, { strict: true }),
  ]);
  if (dong === null && tram === null && nhaMay === null && may === null) return undefined;
  const d = (a: number[] | null) => sql.join((a && a.length > 0 ? a : [-1]).map((x) => sql`${x}`), sql`, `);
  const co = Object.values(cot).filter(Boolean) as AnyPgColumn[];
  if (co.length === 0) throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "dieuKienViTriTrongPhamVi" }, "dieuKienViTriTrongPhamVi: bảng không có cột định vị nào");
  const mot = sql.join(co.map((c) => sql`${c} IS NOT NULL`), sql` OR `);
  const mach: SQL[] = [];
  if (cot.lineId) mach.push(sql`(${cot.lineId} IS NULL OR ${cot.lineId} IN (${d(dong)}))`);
  if (cot.stationId) mach.push(sql`(${cot.stationId} IS NULL OR ${cot.stationId} IN (${d(tram)}))`);
  if (cot.factoryId) mach.push(sql`(${cot.factoryId} IS NULL OR ${cot.factoryId} IN (${d(nhaMay)}))`);
  if (cot.machineId) mach.push(sql`(${cot.machineId} IS NULL OR ${cot.machineId} IN (${d(may)}))`);
  if (cot.robotId) {
    mach.push(sql`(${cot.robotId} IS NULL OR ${cot.robotId} IN (
      SELECT r."id" FROM robots r LEFT JOIN stations st ON st."id" = r."stationId"
      WHERE r."lineId" IN (${d(dong)}) OR st."lineId" IN (${d(dong)})))`);
  }
  return sql`((${mot}) AND ${sql.join(mach, sql` AND `)})`;
}

/** `safety_events` theo người dùng (tRPC). */
export async function dieuKienSuKienAnToanTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  const se = safetyEvents;
  return dieuKienViTriTrongPhamVi(phamViCua(ctx), { lineId: se.lineId, stationId: se.stationId, factoryId: se.factoryId, robotId: se.robotId });
}

/**
 * Mảnh SQL thô `<col> IN (id máy trong phạm vi)` cho truy vấn viết tay (bí danh `i`, `ia`, …); `undefined` khi phạm vi toàn quyền. Phạm vi rỗng ⇒ `IN (-1)` (0 hàng, KHÔNG phải "không lọc").
 * `col` là cột/biểu thức SQL thô, vd `sql.raw('i."machineId"')`.
 */
export async function dieuKienMaySql(ctx: CoDanhTinh, col: SQL): Promise<SQL | undefined> {
  const ids = await idsMayTrongPhamVi(ctx);
  if (ids === null) return undefined;
  return sql`${col} IN (${sql.join((ids.length > 0 ? ids : [-1]).map((x) => sql`${x}`), sql`, `)})`;
}

/** `lần kiểm tra thuộc máy trong phạm vi`: tập id lần kiểm tra → máy; true khi toàn quyền hoặc MỌI lần kiểm tra tồn tại đều thuộc máy trong phạm vi (id không tồn tại bị bỏ qua). */
export async function kiemTraTrongPhamVi(ctx: CoDanhTinh, inspectionIds: number[]): Promise<boolean> {
  const ids = await idsMayTrongPhamVi(ctx);
  if (ids === null || inspectionIds.length === 0) return true;
  const d = await layDb();
  const { productInspections } = await import("../../drizzle/schema");
  const rows = await d.select({ m: productInspections.machineId }).from(productInspections).where(inArray(productInspections.id, inspectionIds));
  return rows.every((r) => ids.includes(r.m));
}

/** Lọc danh sách id lần kiểm tra: BỎ các id TỒN TẠI nhưng thuộc máy ngoài phạm vi (id không tồn tại giữ nguyên — thao tác sau tự bỏ qua như cũ). Toàn quyền ⇒ trả nguyên. Dùng cho mutation hàng loạt. */
export async function locKiemTraTrongPhamVi(ctx: CoDanhTinh, inspectionIds: number[]): Promise<number[]> {
  const ids = await idsMayTrongPhamVi(ctx);
  if (ids === null || inspectionIds.length === 0) return inspectionIds;
  const d = await layDb();
  const { productInspections } = await import("../../drizzle/schema");
  const rows = await d.select({ id: productInspections.id, m: productInspections.machineId }).from(productInspections).where(inArray(productInspections.id, inspectionIds));
  const ngoai = new Set(rows.filter((r) => !ids.includes(r.m)).map((r) => r.id));
  return inspectionIds.filter((x) => !ngoai.has(x));
}

/** Chú thích (hàng `image_annotations`) thấy được ⇔ toàn quyền HOẶC gắn một lần kiểm tra thuộc máy trong phạm vi (chú thích không gắn lần kiểm tra ⇒ chỉ toàn quyền thấy — cùng luật đọc L1). */
export async function chuThichTrongPhamVi(ctx: CoDanhTinh, inspectionId: number | null | undefined): Promise<boolean> {
  const ids = await idsMayTrongPhamVi(ctx);
  if (ids === null) return true;
  if (inspectionId == null) return false;
  const d = await layDb();
  const { productInspections } = await import("../../drizzle/schema");
  const rows = await d.select({ m: productInspections.machineId }).from(productInspections).where(eq(productInspections.id, inspectionId)).limit(1);
  return rows.length === 1 && ids.includes(rows[0].m);
}

/** Điều kiện SQL phạm vi cho `wip_tracking` (theo `lineId` / `currentMachineId`); hàng không định vị được chỉ toàn quyền thấy. `undefined` khi toàn quyền. */
export async function dieuKienWipTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  return dieuKienViTriTrongPhamVi(phamViCua(ctx), { lineId: wipTracking.lineId, machineId: wipTracking.currentMachineId });
}

/**
 * phạm vi người dùng (L2 2026-10-24): tập đơn vị (serial) trong `serials` mà người gọi THẤY ĐƯỢC — toàn quyền ⇒ tất cả; ngược lại ⇒ có ≥1 bản ghi bước/kiểm tra/linh kiện ở máy trong phạm vi (cùng luật genealogy
 * `donViThayDuoc`) HOẶC ≥1 hàng WIP ở dây chuyền/máy trong phạm vi. Không tính "tác giả sự kiện chuỗi" (đặc thù genealogy).
 */
export async function donViTrongPhamVi(ctx: CoDanhTinh, serials: string[]): Promise<Set<string>> {
  const idsMay = await idsMayTrongPhamVi(ctx);
  if (idsMay === null) return new Set(serials);
  if (serials.length === 0) return new Set();
  const { donViThayDuoc } = await import("../api/v1/genealogyApi");
  const out = await donViThayDuoc(serials, idsMay, null);
  const con = serials.filter((s) => !out.has(s));
  if (con.length > 0) {
    const cong = await dieuKienWipTrongPhamVi(ctx);
    const d = await layDb();
    const rows = await d.select({ s: wipTracking.serialNumber }).from(wipTracking).where(cong ? sql`${inArray(wipTracking.serialNumber, con)} AND ${cong}` : inArray(wipTracking.serialNumber, con));
    for (const r of rows) if (r.s != null) out.add(r.s);
  }
  return out;
}

/** phạm vi người dùng (L4 2026-10-25): điều kiện phạm vi cho vùng an toàn / hiệu chuẩn camera / phiên cộng tác / robot (cùng luật `dieuKienViTriTrongPhamVi`: hàng không định vị được chỉ toàn quyền thấy). */
export async function dieuKienVungAnToanTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  return dieuKienViTriTrongPhamVi(phamViCua(ctx), { lineId: safetyZones.lineId, stationId: safetyZones.stationId, factoryId: safetyZones.factoryId, robotId: safetyZones.robotId });
}
export async function dieuKienHieuChuanCameraTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  return dieuKienViTriTrongPhamVi(phamViCua(ctx), { lineId: cameraCalibrations.lineId, stationId: cameraCalibrations.stationId, factoryId: cameraCalibrations.factoryId, robotId: cameraCalibrations.robotId });
}
export async function dieuKienPhienCongTacTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  return dieuKienViTriTrongPhamVi(phamViCua(ctx), { factoryId: collaborationSessions.factoryId, robotId: collaborationSessions.robotDeviceId });
}
export async function dieuKienRobotTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  return dieuKienViTriTrongPhamVi(phamViCua(ctx), { lineId: robots.lineId, stationId: robots.stationId });
}

/**
 * phạm vi người dùng (L5 2026-10-25): điều kiện phạm vi cho `production_orders` — lệnh thấy được ⇔ `lineId` ∈ chuyền trong phạm vi (cùng luật `getProductionOrderById`/`getProductionOrders`); `undefined` khi toàn quyền.
 */
export async function dieuKienLenhSanXuatTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  const dong = await idsTrongPhamVi("line", phamViCua(ctx), { strict: true });
  return dong === null ? undefined : inArray(productionOrders.lineId, dong.length > 0 ? dong : [-1]);
}

/**
 * phạm vi người dùng (L5 2026-10-25): điều kiện phạm vi cho `production_sessions` — cùng luật GHI (`ghiViTri`): nhà máy + xưởng phải trong phạm vi, chuyền (nếu có) phải trong phạm vi. `undefined` khi toàn quyền.
 */
export async function dieuKienPhienSanXuatTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  const pv = phamViCua(ctx);
  const [nhaMay, xuong, dong] = await Promise.all([
    idsTrongPhamVi("factory", pv, { strict: true }),
    idsTrongPhamVi("workshop", pv, { strict: true }),
    idsTrongPhamVi("line", pv, { strict: true }),
  ]);
  if (nhaMay === null && xuong === null && dong === null) return undefined;
  const d = (a: number[] | null) => sql.join((a && a.length > 0 ? a : [-1]).map((x) => sql`${x}`), sql`, `);
  const ps = productionSessions;
  return sql`(${ps.factoryId} IN (${d(nhaMay)}) AND ${ps.workshopId} IN (${d(xuong)}) AND (${ps.lineId} IS NULL OR ${ps.lineId} IN (${d(dong)})))`;
}

/** phạm vi người dùng (L5 2026-10-25): `station_dwell_time` theo chuyền + trạm (hàng không định vị chỉ toàn quyền thấy). */
export async function dieuKienDwellTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  return dieuKienViTriTrongPhamVi(phamViCua(ctx), { lineId: stationDwellTime.lineId, stationId: stationDwellTime.stationId });
}

/** phạm vi người dùng (L5 2026-10-25): `line_balance_metrics` theo chuyền. */
export async function dieuKienCanBangChuyenTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  return dieuKienViTriTrongPhamVi(phamViCua(ctx), { lineId: lineBalanceMetrics.lineId });
}

/**
 * phạm vi người dùng (L5 2026-10-25): tập recipe set (trong `setIds`) mà người gọi THẤY ĐƯỢC — cùng luật GHI (`setTrongPhamVi`): MỌI máy trong item của set phải thuộc phạm vi; set không item (nháp) ai cũng thấy.
 * `null` khi toàn quyền (không lọc).
 */
export async function recipeSetThayDuocTrongPhamVi(ctx: CoDanhTinh, setIds: number[]): Promise<Set<number> | null> {
  const may = await idsMayTrongPhamVi(ctx);
  if (may === null) return null;
  if (setIds.length === 0) return new Set();
  const d = await layDb();
  const rows = await d.select({ s: recipeSetItems.recipeSetId, m: recipeSetItems.machineId }).from(recipeSetItems).where(inArray(recipeSetItems.recipeSetId, setIds));
  const ngoai = new Set<number>();
  for (const r of rows) if (!may.includes(r.m)) ngoai.add(r.s);
  return new Set(setIds.filter((s) => !ngoai.has(s)));
}
