/**
 * ★★★ Phạm vi nhà máy cho PHIẾU quản lý chất lượng / kỹ thuật (NCR · ECN) — lô L6a, 2026-10-25 (dieu-phoi duyệt (a)+(b)+(c)).
 *
 * Trước: `create` KHÔNG ghi `factoryId` (cột nullable, input không có) ⇒ mọi phiếu NULL ⇒ không thể phạm vi hoá. Nay:
 *  • GHI: nhà máy của phiếu được SUY ra — NCR: từ máy của lần kiểm liên kết (`linkedInspectionId`); ECN: người gọi nêu `factoryId` (hoặc có đúng MỘT nhà máy trong phạm vi), sản phẩm đính kèm phải theo
 *    luật sản phẩm (L3). Người gọi bị thu hẹp mà không xác định được nhà máy ⇒ BAD_REQUEST (phiếu mồ côi chính họ cũng không thấy lại). Toàn quyền (admin) được để NULL.
 *  • ĐỌC: `factoryId` ∈ nhà máy trong phạm vi; NULL chỉ toàn quyền. Ngoài phạm vi ≡ không tồn tại (NOT_FOUND, cùng lỗi id không có thật).
 */
import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { appError } from "../_core/appError";
import { getDb } from "../db";
import { engineeringChanges, machines, productInspections, productionLines, stations, workshops } from "../../drizzle/schema";
import { congSanPhamTheoPhamVi, sanPhamTrongPhamVi } from "../db/product";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";
import { sanPhamGhiTrongPhamVi } from "./_sanPhamPhamVi";

/** Nhà máy của một MÁY (qua trạm → chuyền → xưởng); máy không tồn tại / không gắn chuỗi ⇒ null. */
export async function nhaMayCuaMay(machineId: number): Promise<number | null> {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const [r] = await d
    .select({ f: workshops.factoryId })
    .from(machines)
    .innerJoin(stations, eq(stations.id, machines.stationId))
    .innerJoin(productionLines, eq(productionLines.id, stations.lineId))
    .innerJoin(workshops, eq(workshops.id, productionLines.workshopId))
    .where(eq(machines.id, machineId))
    .limit(1);
  return r?.f ?? null;
}

/** Tập nhà máy người gọi thấy: `null` = toàn quyền. */
export async function nhaMayTrongPhamVi(ctx: CoDanhTinh): Promise<number[] | null> {
  return idsTrongPhamVi("factory", phamViCua(ctx), { strict: true });
}

/** Phiếu có `factoryId` này người gọi thấy được không (NULL chỉ toàn quyền). */
export async function phieuThayDuocTrongPhamVi(ctx: CoDanhTinh, factoryId: number | null | undefined): Promise<boolean> {
  const ids = await nhaMayTrongPhamVi(ctx);
  return ids === null || (factoryId != null && ids.includes(factoryId));
}

/**
 * Xác định `factoryId` khi TẠO phiếu. `tuLanKiem` = nhà máy suy từ lần kiểm liên kết (ưu tiên); `khai` = nhà máy người gọi tự nêu.
 * Người toàn quyền: dùng giá trị suy / khai nếu có, không thì NULL. Người hẹp: giá trị phải trong phạm vi (ngoài ≡ NOT_FOUND "factory"); thiếu ⇒ nếu có ĐÚNG một nhà máy trong phạm vi thì dùng, không thì BAD_REQUEST.
 */
export async function nhaMayGhiPhieu(ctx: CoDanhTinh, o: { tuLanKiem?: number | null; khai?: number | null }): Promise<number | null> {
  const ids = await nhaMayTrongPhamVi(ctx);
  const f = o.tuLanKiem ?? o.khai ?? null;
  if (ids === null) return f;
  if (f != null) {
    if (!ids.includes(f)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "factory" }, "Factory not found");
    return f;
  }
  if (ids.length === 1) return ids[0];
  throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "factoryId" }, "Cần nêu nhà máy của phiếu (thuộc phạm vi của bạn).");
}

/** NCR: nhà máy từ lần kiểm liên kết. Lần kiểm không tồn tại / của máy ngoài phạm vi ≡ NOT_FOUND "inspection" (người hẹp). */
export async function nhaMayTuLanKiem(ctx: CoDanhTinh, inspectionId: number | null | undefined): Promise<number | null> {
  if (inspectionId == null) return null;
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const [i] = await d.select({ m: productInspections.machineId }).from(productInspections).where(eq(productInspections.id, inspectionId)).limit(1);
  const ids = await nhaMayTrongPhamVi(ctx);
  if (!i) {
    if (ids === null) return null; // giữ hành vi cũ cho toàn quyền (tham chiếu mềm)
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "inspection" }, "Inspection not found");
  }
  const f = await nhaMayCuaMay(i.m);
  if (ids !== null && (f == null || !ids.includes(f))) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "inspection" }, "Inspection not found");
  return f;
}

/** ECN: sản phẩm đính kèm phải theo luật sản phẩm (L3: trong phạm vi hoặc nháp). */
export async function sanPhamChoPhieu(ctx: CoDanhTinh, productModelId: number | null | undefined): Promise<void> {
  if (productModelId != null) await sanPhamGhiTrongPhamVi(ctx, productModelId);
}


/**
 * ECN: thấy được ⇔ factoryId ∈ phạm vi, HOẶC (factoryId NULL VÀ có productModelId VÀ sản phẩm TRONG phạm vi theo luật sản phẩm đa nhà máy của L3 — kỹ sư nhà máy có gắn thấy).
 * NULL không sản phẩm ⇒ chỉ toàn quyền. (dieu-phoi xác nhận 2026-10-25: ECN gắn sản phẩm map nhiều nhà máy giữ NULL theo backfill.)
 */
export async function ecnThayDuocTrongPhamVi(ctx: CoDanhTinh, row: { factoryId: number | null; productModelId: number | null }): Promise<boolean> {
  const ids = await nhaMayTrongPhamVi(ctx);
  if (ids === null) return true;
  if (row.factoryId != null) return ids.includes(row.factoryId);
  return row.productModelId != null && (await sanPhamTrongPhamVi(row.productModelId, phamViCua(ctx)));
}

/** Điều kiện SQL cho danh sách ECN (cùng luật `ecnThayDuocTrongPhamVi`); undefined khi toàn quyền. */
export async function dieuKienEcnTrongPhamVi(ctx: CoDanhTinh): Promise<SQL | undefined> {
  const ids = await nhaMayTrongPhamVi(ctx);
  if (ids === null) return undefined;
  const cong = await congSanPhamTheoPhamVi(engineeringChanges.productModelId, phamViCua(ctx));
  return or(
    ids.length > 0 ? inArray(engineeringChanges.factoryId, ids) : sql`false`,
    and(isNull(engineeringChanges.factoryId), isNotNull(engineeringChanges.productModelId), cong ?? sql`false`),
  );
}
