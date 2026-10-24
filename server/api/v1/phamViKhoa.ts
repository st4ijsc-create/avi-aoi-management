/**
 * ★★★ 2026-10-24 — BỘ PHÂN GIẢI PHẠM VI CỦA KHOÁ API cho các tuyến /api/v1 (rà bảo mật: khoá của nhà máy A đọc/ghi dữ liệu nhà máy B).
 *
 * Phạm vi khoá = `req.apiPrincipal.tenantScope` (api_keys.dataScopeMode + corporateCode/factoryCode, mig 0325), qua trục ② (`PhamViMaTenant`) của CÙNG `idsTrongPhamVi` mà trục ① (người dùng) dùng.
 *   • khoá TOÀN CỤC tường minh (kể cả master) ⇒ `undefined`/`null` ⇒ KHÔNG thêm mệnh đề (chiều dương chống vá quá tay);
 *   • khoá MỘT NHÀ MÁY ⇒ chỉ dữ liệu của nhà máy đó; id ngoài phạm vi ≡ 404 CÙNG hình dạng với "không tồn tại";
 *   • khoá CHƯA KHAI ⇒ rỗng / 404 (fail-closed; "vắng mặt" không bao giờ đọc thành "không lọc").
 * Khoá GẮN MÁY (`principal.machineId`, khoá `mk_`/máy-principal): ngoài phạm vi khai báo, luôn được dùng CHÍNH máy của nó (không phá tích hợp máy tự đọc trạng thái mình).
 *
 * ⚠ Mọi `import()` động: các lưới `server/api/v1/**` mock `drizzle-orm`/`db` (cùng lý do ở moduleReads.ts).
 */
import type { SQL } from "drizzle-orm";
import { ApiHttpError } from "./envelope";
import type { ApiKeyTenantScope } from "./apiKeyScope";
import type { PhamViMaTenant } from "../../db/hierarchy";
import type { CotViTri } from "../../routers/_adapterPhamVi";

export interface NguoiGoiKhoa {
  machineId?: number;
  tenantScope?: ApiKeyTenantScope | null;
}

/** Trục ② của khoá, hoặc `undefined` = khoá TOÀN CỤC (không lọc). */
export async function phamViCuaKhoa(tenantScope: ApiKeyTenantScope | null | undefined): Promise<PhamViMaTenant | undefined> {
  const { tenantCodeScopeOf } = await import("./apiKeyScope");
  const codes = tenantCodeScopeOf(tenantScope);
  return codes ? { tenantScope: codes } : undefined;
}

/** Cổng SQL cho bảng tenant theo CỘT ĐỊNH VỊ (xem `dieuKienViTriTrongPhamVi`). `undefined` khi toàn cục. */
export async function dieuKienKhoa(tenantScope: ApiKeyTenantScope | null | undefined, cot: CotViTri): Promise<SQL | undefined> {
  const pv = await phamViCuaKhoa(tenantScope);
  if (!pv) return undefined;
  const { dieuKienViTriTrongPhamVi } = await import("../../routers/_adapterPhamVi");
  return dieuKienViTriTrongPhamVi(pv, cot);
}

/** id (nhà máy/chuyền/trạm/máy) client gửi phải trong phạm vi khoá; ngoài phạm vi ≡ 404 cùng hình dạng "không tồn tại". */
export async function canTrongPhamVi(
  tenantScope: ApiKeyTenantScope | null | undefined,
  cap: "factory" | "line" | "station" | "machine",
  idCan: number,
  nhan: string,
): Promise<void> {
  const pv = await phamViCuaKhoa(tenantScope);
  if (!pv) return;
  const { trongPhamVi } = await import("../../db/hierarchy");
  if (!(await trongPhamVi(cap, idCan, pv))) throw new ApiHttpError(404, "not_found", `${nhan} ${idCan} not found.`);
}

/**
 * Tập id MÁY khoá được thấy: `null` = tất cả (khoá toàn cục); khoá gắn máy luôn thêm CHÍNH máy của nó.
 * Khoá chưa khai không gắn máy ⇒ `[]`.
 */
export async function idsMayCuaKhoa(nguoi: NguoiGoiKhoa | null | undefined): Promise<number[] | null> {
  const pv = await phamViCuaKhoa(nguoi?.tenantScope);
  if (!pv) return null;
  const { idsTrongPhamVi } = await import("../../db/hierarchy");
  const ids = (await idsTrongPhamVi("machine", pv)) ?? [];
  const rieng = nguoi?.machineId;
  return rieng != null && !ids.includes(rieng) ? [...ids, rieng] : ids;
}

/** Máy (id client gửi) phải thuộc tập máy khoá thấy được; ngoài ⇒ 404 cùng hình dạng "không tồn tại". Trả tập id để tái dùng. */
export async function mayTrongPhamViKhoa(nguoi: NguoiGoiKhoa | null | undefined, machineId: number, nhan = "Machine"): Promise<number[] | null> {
  const ids = await idsMayCuaKhoa(nguoi);
  if (ids !== null && !ids.includes(machineId)) throw new ApiHttpError(404, "not_found", `${nhan} ${machineId} not found.`);
  return ids;
}

/** Điều kiện `col IN (…)` cho danh sách máy (`[]` ⇒ 0 hàng, KHÔNG phải "không lọc"). `undefined` khi toàn cục. */
export async function dieuKienMayCuaKhoa(nguoi: NguoiGoiKhoa | null | undefined, cot: import("drizzle-orm/pg-core").AnyPgColumn): Promise<SQL | undefined> {
  const ids = await idsMayCuaKhoa(nguoi);
  if (ids === null) return undefined;
  const { inArray } = await import("drizzle-orm");
  return inArray(cot, ids.length > 0 ? ids : [-1]);
}

/** Mã nhà máy (`factories.code`) trong phạm vi khoá: `null` = toàn cục. */
export async function maNhaMayCuaKhoa(tenantScope: ApiKeyTenantScope | null | undefined): Promise<Set<string> | null> {
  const pv = await phamViCuaKhoa(tenantScope);
  if (!pv) return null;
  const { idsTrongPhamVi } = await import("../../db/hierarchy");
  const ids = (await idsTrongPhamVi("factory", pv)) ?? [];
  if (ids.length === 0) return new Set();
  const [{ getDb }, { factories }, { inArray }] = await Promise.all([
    import("../../db/connection"),
    import("../../../drizzle/schema"),
    import("drizzle-orm"),
  ]);
  const d = await getDb();
  if (!d) return new Set();
  const rows = await d.select({ code: factories.code }).from(factories).where(inArray(factories.id, ids));
  return new Set(rows.map((r) => r.code));
}
