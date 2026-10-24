/**
 * ★★★ 2026-10-24 — BỘ PHÂN GIẢI PHẠM VI NHÀ MÁY DÙNG CHUNG cho MỌI thủ tục tRPC khoá theo `adapterId` (rà bảo mật, scada-master phát hiện:
 * `commissioning.list|status`, `deviceAdapter.tags.listByAdapter`, `unsMapping.get|list` đọc dữ liệu adapter của nhà máy KHÁC).
 *
 * Luật (cùng `scadaDiagRouter`, nay một nơi): adapter nhìn thấy được ⇔ phạm vi toàn quyền (`idsTrongPhamVi` = null) HOẶC `machineId` của nó ∈ tập máy trong phạm vi.
 * Adapter KHÔNG gắn máy (`machineId` null) chỉ phạm vi toàn quyền thấy. "Ngoài phạm vi" ≡ "không tồn tại": CÙNG một NOT_FOUND (không lộ sự tồn tại). Danh sách chỉ trả mục trong phạm vi.
 * `strict: true` — không phân giải được phạm vi (DB) ⇒ NÉM, không đoán "toàn quyền" (fail-closed).
 * Danh tính LUÔN từ `ctx.user` (`phamViCua`), không bao giờ từ `input`.
 */
import { eq, inArray, type SQL } from "drizzle-orm";
import { appError } from "../_core/appError";
import { getDb as getDbRaw } from "../db";
import { idsTrongPhamVi } from "../db/hierarchy";
import { commissioningRecords, deviceAdapters, deviceTags } from "../../drizzle/schema";
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

/** Adapter của một TAG (id client gửi): tag không tồn tại / adapter ngoài phạm vi ⇒ NOT_FOUND. Trả `adapterId`. */
export async function adapterCuaTag(ctx: CoDanhTinh, tagId: number): Promise<number> {
  const db = await layDb();
  const [t] = await db.select({ adapterId: deviceTags.adapterId }).from(deviceTags).where(eq(deviceTags.id, tagId)).limit(1);
  if (!t) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");
  await adapterTrongPhamVi(ctx, t.adapterId);
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
