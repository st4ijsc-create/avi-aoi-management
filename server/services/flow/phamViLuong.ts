/**
 * ★★★ Đợt 9 (IDOR, dieu-phoi duyệt (d)) — PHẠM VI NHÀ MÁY của CHÍNH LUỒNG AI (luồng · lượt · bí mật). MỘT chỗ duy nhất:
 *
 *   • đơn vị phạm vi = nhà máy, cùng bộ phân giải với máy (`idsTrongPhamVi("factory", phạm vi)` của `phamViCua(ctx)`);
 *   • `ai_flows.factoryId` / `ai_flow_credentials.factoryId` NULL = TOÀN HỆ THỐNG: chỉ phạm vi "tất cả" (admin, `null`) thấy và dùng;
 *   • ngoài phạm vi và không tồn tại KHÔNG phân biệt được (cùng `false`);
 *   • tạo mới: thuộc ĐÚNG MỘT nhà máy ⇒ gán nhà máy đó; nhiều ⇒ phải chọn trong phạm vi; chưa thuộc nhà máy nào ⇒ từ chối; chỉ admin tạo NULL.
 * Router (`flowRouter.ts`) gọi các hàm này cho MỌI thủ tục nhận flowId/runId/credentialId; động cơ gọi qua `BoKiemPhamVi` của chủ lượt.
 */
import { eq } from "drizzle-orm";
import { aiFlowCredentials, aiFlowRuns, aiFlows, factories } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { idsTrongPhamVi, type PhamViNguoiXem } from "../../db/hierarchy";

/** Tập nhà máy được phép: `null` = tất cả (admin); `[]` = không nhà máy nào. */
export function nhaMayChoPhep(pv: PhamViNguoiXem): Promise<number[] | null> {
  return idsTrongPhamVi("factory", pv);
}

/** Một hàng mang `factoryId` có nằm trong tập cho phép không? NULL chỉ hợp lệ với tập "tất cả". */
export function nhaMayHopLe(factoryId: number | null | undefined, cho: number[] | null): boolean {
  if (cho === null) return true;
  return typeof factoryId === "number" && cho.includes(factoryId);
}

export async function luongTrongPhamVi(pv: PhamViNguoiXem, flowId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [f] = await db.select({ f: aiFlows.factoryId }).from(aiFlows).where(eq(aiFlows.id, flowId)).limit(1);
  if (!f) return false;
  return nhaMayHopLe(f.f, await nhaMayChoPhep(pv));
}

export async function luotTrongPhamVi(pv: PhamViNguoiXem, runId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [r] = await db.select({ flowId: aiFlowRuns.flowId }).from(aiFlowRuns).where(eq(aiFlowRuns.id, runId)).limit(1);
  return !!r && (await luongTrongPhamVi(pv, r.flowId));
}

export async function biMatTrongPhamVi(pv: PhamViNguoiXem, credentialId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [c] = await db.select({ f: aiFlowCredentials.factoryId }).from(aiFlowCredentials).where(eq(aiFlowCredentials.id, credentialId)).limit(1);
  if (!c) return false;
  return nhaMayHopLe(c.f, await nhaMayChoPhep(pv));
}

export type KetQuaNhaMayTao = { ok: true; factoryId: number | null } | { ok: false; lyDo: "chua-co-nha-may" | "can-chon-nha-may" | "ngoai-pham-vi" };

/**
 * Nhà máy gán cho luồng / bí mật MỚI. `yeuCau` = nhà máy người gọi chọn (tuỳ chọn). Admin (tập "tất cả"): `yeuCau` vắng ⇒ NULL (toàn
 * hệ thống), có ⇒ phải là nhà máy có thật. Người khác: 0 nhà máy ⇒ từ chối; đúng 1 ⇒ nhà máy ấy (`yeuCau` khác ⇒ ngoài phạm vi);
 * ≥ 2 ⇒ BẮT BUỘC `yeuCau` và phải nằm trong phạm vi.
 */
export async function nhaMayChoLuongMoi(pv: PhamViNguoiXem, yeuCau: number | null | undefined): Promise<KetQuaNhaMayTao> {
  const cho = await nhaMayChoPhep(pv);
  if (cho === null) {
    if (yeuCau == null) return { ok: true, factoryId: null };
    const db = await getDb();
    const [nm] = db ? await db.select({ id: factories.id }).from(factories).where(eq(factories.id, yeuCau)).limit(1) : [];
    return nm ? { ok: true, factoryId: yeuCau } : { ok: false, lyDo: "ngoai-pham-vi" };
  }
  if (cho.length === 0) return { ok: false, lyDo: "chua-co-nha-may" };
  if (yeuCau != null) return cho.includes(yeuCau) ? { ok: true, factoryId: yeuCau } : { ok: false, lyDo: "ngoai-pham-vi" };
  if (cho.length === 1) return { ok: true, factoryId: cho[0] };
  return { ok: false, lyDo: "can-chon-nha-may" };
}
