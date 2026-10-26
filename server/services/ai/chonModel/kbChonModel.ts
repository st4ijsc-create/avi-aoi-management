/**
 * ★ Đợt 10.1 A2 — `context.chonModel` của KB / trợ lý lập trình (`/api/ai/local-kb/{ask,stream}`). Giải ở TUYẾN, TRƯỚC khi
 * mở SSE: giá trị lạ ⇒ HTTP 400/404 (không rơi về mặc định); hợp lệ ⇒ ô SERVER-ONLY `modelVaiTro` (cùng ô trợ lý theo vai trò
 * đã dùng) — nhánh lập trình và nhánh vận hành đọc nó. Vắng ⇒ ngữ cảnh không đổi một byte.
 */
import type { KbQueryContext } from "../../aiLocalKnowledgeService";
import { defaultModelBasename, nguCanhKhe } from "../modelResolver";
import { giaiChonModel } from "./giaiChonModel";
import type { PhuThuocDanhMuc } from "./kieu";

export type KetQuaChonModelKb =
  | { ok: true; context: KbQueryContext | undefined }
  | { ok: false; status: 400 | 404; error: string; code: string };

export async function apChonModelKb(
  context: KbQueryContext | undefined,
  layDep: () => Promise<PhuThuocDanhMuc> = async () => (await import("./danhMuc")).layPhuThuocDanhMucMacDinh(),
): Promise<KetQuaChonModelKb> {
  const ma = context?.chonModel;
  if (!ma) return { ok: true, context };
  try {
    const dich = await giaiChonModel(ma, { beMatChu: true, factoryId: null, kheBiKhoa: nguCanhKhe().kheBiKhoa }, await layDep());
    if (!dich) return { ok: true, context };
    // 10.1: chưa có cổng AI ngoài (danh mục ngoài rỗng ⇒ `giaiChonModel` đã NOT_FOUND); 10.3 nối `goiAiNgoai` ở đây.
    if (dich.loai !== "local") return { ok: false, status: 404, error: "model ngoài chưa được cài đặt", code: "modelNgoaiChuaCaiDat" };
    const modelId = dich.modelId ?? (defaultModelBasename() || undefined);
    return {
      ok: true,
      context: { ...context, modelVaiTro: { modelId, vaiTro: dich.vaiTro, nguon: dich.nguon, bangChung: `chọn tường minh ${ma}` } },
    };
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    const reason = String((e as { cause?: { appParams?: { reason?: unknown } } })?.cause?.appParams?.reason ?? "chonModelKhongHopLe");
    if (code === "NOT_FOUND") return { ok: false, status: 404, error: (e as Error).message, code: reason };
    if (code === "BAD_REQUEST") return { ok: false, status: 400, error: (e as Error).message, code: reason };
    throw e;
  }
}
