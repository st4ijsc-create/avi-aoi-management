/**
 * ★★★ 2026-10-24 — BỘ LỌC SQL THÔ cho các tuyến `/api/external/*` (rà bảo mật), đặt trên CHỦ DUY NHẤT của "người gọi ngoài thấy nhà máy nào": `_phamViNgoai.ts`
 * (`phamViGoiNgoai(req)` → `nguoiXemCuaPhamVi`). Master key ⇒ `undefined` (toàn quyền, KHÔNG lọc); token người dùng ⇒ phạm vi gán nhà máy của họ.
 * Module này chỉ thêm đoạn SQL thô `AND <cột> IN (ids)` cho các truy vấn viết tay (bí danh `pi`, `pal`, `m`, `s`…) — KHÔNG dựng luật thứ hai.
 *
 * Quy ước của cụm (xem `_phamViNgoai.ts`): tuyến trả DANH SÁCH kèm `scopeApplied` (boolean); tuyến tra theo KHOÁ/ID ngoài phạm vi ⇒ 403 `external_factory_scope_denied`
 * (KHÔNG 404 — bản ghi có tồn tại). Người dùng không gán nhà máy ⇒ rỗng (`IN (-1)`), không bao giờ "không lọc".
 */
import { sql, type SQL } from "drizzle-orm";
import { idsTrongPhamVi, type PhamViNguoiXem } from "../db/hierarchy";

export type CapPhanCapExternal = "factory" | "workshop" | "line" | "station" | "machine" | "workstation";

/** Tập id cấp phân cấp trong phạm vi người gọi: `null` = toàn quyền (`nguoiXem` undefined); `[]` = rỗng. Không phân giải được phạm vi ⇒ NÉM (fail-closed). */
export async function idsCapExternal(nguoiXem: PhamViNguoiXem | undefined, cap: CapPhanCapExternal): Promise<number[] | null> {
  return nguoiXem === undefined ? null : idsTrongPhamVi(cap, nguoiXem, { strict: true });
}

/**
 * Mảnh SQL thô `AND <col> IN (ids)`; mảnh rỗng khi toàn quyền. `col` là cột SQL thô theo bí danh của truy vấn, vd `sql.raw('pi."machineId"')`.
 * Hàng có `col` NULL bị loại với người dùng hẹp (không định vị được ⇒ không thấy).
 */
export async function andTrongPhamVi(nguoiXem: PhamViNguoiXem | undefined, cap: CapPhanCapExternal, col: SQL): Promise<SQL> {
  const ids = await idsCapExternal(nguoiXem, cap);
  if (ids === null) return sql``;
  return sql`AND ${col} IN (${sql.join((ids.length > 0 ? ids : [-1]).map((x) => sql`${x}`), sql`, `)})`;
}

/** Một id cấp phân cấp client gửi phải trong phạm vi; ngoài ⇒ `false` (tầng gọi trả 403 `thanTuChoiPhamViNgoai`). */
export async function idTrongPhamViExternal(nguoiXem: PhamViNguoiXem | undefined, cap: CapPhanCapExternal, id: number): Promise<boolean> {
  const ids = await idsCapExternal(nguoiXem, cap);
  return ids === null || ids.includes(id);
}

/**
 * Mảnh SQL thô `AND (<cột sản phẩm> thuộc ≥1 nhà máy trong phạm vi)` — dùng LẠI nguyên thuỷ `congSanPhamTrongNhaMay` của `publicProductScope.ts` (hợp ba đường: ánh xạ máy · điểm đo · kiểm tra),
 * KHÔNG dựng luật thứ hai. Mảnh rỗng khi toàn quyền; phạm vi rỗng ⇒ `AND 1 = 0`. Sản phẩm chưa gắn máy/điểm đo/kiểm tra nào ⇒ ẩn với người dùng hẹp (fail-closed).
 */
export async function andSanPhamTrongPhamVi(nguoiXem: PhamViNguoiXem | undefined, cot: import("drizzle-orm").AnyColumn): Promise<SQL> {
  const fids = await idsCapExternal(nguoiXem, "factory");
  if (fids === null) return sql``;
  if (fids.length === 0) return sql`AND 1 = 0`;
  const { congSanPhamTrongNhaMay } = await import("../routers/publicProductScope");
  return sql`AND (${sql.join(fids.map((f) => congSanPhamTrongNhaMay(cot, f)), sql` OR `)})`;
}
