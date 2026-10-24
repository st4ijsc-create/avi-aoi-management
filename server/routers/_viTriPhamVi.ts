/**
 * ★★★ Phạm vi nhà máy cho GHI theo VỊ TRÍ phân cấp (nhà máy · xưởng · chuyền · trạm · máy) mà client khai trong input — dùng chung
 * (productionRouters · productionSessionRouter · orderLifecycleRouter …), lô W9 (kiểm định phamViGhi, 2026-10-24).
 * Luật: MỌI id vị trí được nêu phải TRONG phạm vi người gọi (cùng `idsTrongPhamVi` với đường ĐỌC); ngoài phạm vi ≡ không tồn tại ⇒ NOT_FOUND theo
 * loại vị trí; `batBuoc`: người gọi phạm vi HẸP mà không nêu vị trí nào ⇒ BAD_REQUEST (hàng mồ côi chính họ cũng không thấy lại). Toàn quyền (admin) ⇒ bỏ qua.
 */
import { appError } from "../_core/appError";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";
import { sanPhamGhiTrongPhamVi, diemDoGhiTrongPhamVi } from "./_sanPhamPhamVi";

export interface ViTriGhi {
  factoryId?: number | null;
  workshopId?: number | null;
  lineId?: number | null;
  stationId?: number | null;
  machineId?: number | null;
}

export async function ghiViTri(ctx: CoDanhTinh, loc: ViTriGhi, opts: { batBuoc?: boolean } = {}): Promise<void> {
  const pv = phamViCua(ctx);
  const nhaMay = await idsTrongPhamVi("factory", pv, { strict: true });
  if (nhaMay === null) return; // toàn quyền
  const co = [loc.factoryId, loc.workshopId, loc.lineId, loc.stationId, loc.machineId].some((x) => x != null);
  if (!co) {
    if (opts.batBuoc) throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "location" }, "Cần nêu nhà máy, xưởng, chuyền, trạm hoặc máy thuộc phạm vi của bạn.");
    return;
  }
  if (loc.factoryId != null && !nhaMay.includes(loc.factoryId)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "factory" }, "Factory not found");
  if (loc.workshopId != null && !((await idsTrongPhamVi("workshop", pv, { strict: true })) ?? []).includes(loc.workshopId)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workshop" }, "Workshop not found");
  if (loc.lineId != null && !((await idsTrongPhamVi("line", pv, { strict: true })) ?? []).includes(loc.lineId)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "line" }, "Line not found");
  if (loc.stationId != null && !((await idsTrongPhamVi("station", pv, { strict: true })) ?? []).includes(loc.stationId)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "station" }, "Station not found");
  if (loc.machineId != null && !((await idsTrongPhamVi("machine", pv, { strict: true })) ?? []).includes(loc.machineId)) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, "Machine not found");
}

export interface DoiTuongSanXuat extends ViTriGhi {
  workstationId?: number | null;
  productModelId?: number | null;
  measurementPointDefId?: number | null;
}

/**
 * Phạm vi nhà máy cho GHI một đối tượng chất lượng / sản xuất khai nhiều loại khoá (máy · chuyền · trạm · công trạm · sản phẩm · điểm đo) — lô W10, 2026-10-25.
 * Mỗi khoá được nêu phải trong phạm vi (máy/chuyền/trạm/…: `ghiViTri`; công trạm: `idsTrongPhamVi("workstation")`; sản phẩm: luật ghi theo sản phẩm; điểm đo: qua sản phẩm của nó).
 * `batBuoc`: người gọi hẹp phạm vi mà không nêu khoá nào ⇒ BAD_REQUEST (hàng mồ côi). Toàn quyền ⇒ bỏ qua.
 */
export async function ghiDoiTuong(ctx: CoDanhTinh, o: DoiTuongSanXuat, opts: { batBuoc?: boolean } = {}): Promise<void> {
  const pv = phamViCua(ctx);
  if ((await idsTrongPhamVi("factory", pv, { strict: true })) === null) return;
  const co = [o.factoryId, o.workshopId, o.lineId, o.stationId, o.machineId, o.workstationId, o.productModelId, o.measurementPointDefId].some((x) => x != null);
  if (!co) {
    if (opts.batBuoc) throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "location" }, "Cần nêu máy, chuyền, trạm, công trạm, sản phẩm hoặc điểm đo thuộc phạm vi của bạn.");
    return;
  }
  await ghiViTri(ctx, { factoryId: o.factoryId, workshopId: o.workshopId, lineId: o.lineId, stationId: o.stationId, machineId: o.machineId });
  if (o.workstationId != null && !((await idsTrongPhamVi("workstation", pv, { strict: true })) ?? []).includes(o.workstationId)) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workstation" }, "Workstation not found");
  }
  if (o.productModelId != null) await sanPhamGhiTrongPhamVi(ctx, o.productModelId);
  if (o.measurementPointDefId != null) await diemDoGhiTrongPhamVi(ctx, o.measurementPointDefId);
}
