/**
 * ★ M4 (audit bảo mật kiem-dinh 2026-10-21) — CỬA `model` của `/v1`. Client chỉ được chọn:
 *   • tên logic cũ (chat/code/coder/fast/fim/infill/embed/embedding/embeddings) hoặc `auto`;
 *   • tên VAI TRÒ đã biết (sổ hoặc bộ gốc);
 *   • id HỒ SƠ phục vụ trong sổ (⇒ basename artifact của hồ sơ đó; hồ sơ tắt / artifact không available ⇒ từ chối);
 *   • ★ Đợt 10.1 — MÃ DANH MỤC `vai-tro:<id>` | `ho-so:<id>` | `ngoai:<ncc>:<model>` (hình dạng `CHON_MODEL_RE`; giải +
 *     kiểm có trong danh mục ở `giaiChonModel`, gọi từ cổng).
 * ★ Đợt 10.1 — BỎ nhánh "TÊN TỆP trần trong GGUF_MODELS_DIR" (spec §4 A2: không còn tên tệp ở mọi bề mặt; kiểm kê bên gọi
 *   2026-10-26 — extension `aviAiLocal.agentModel` mặc định "chat", FIM "fim", scripts dùng tên logic/vai trò — không bên
 *   nào gửi tên tệp). Mọi thứ khác ⇒ `{ ok: false }` ⇒ 400 nêu các dạng hợp lệ (`THONG_DIEP_MODEL_KHONG_HOP_LE`; không phản
 *   chiếu đường dẫn, không lộ tệp có/không).
 */
import path from "node:path";
import { laTenVaiTro } from "../../../shared/aiRoles";
import { CHON_MODEL_RE } from "./chonModel/kieu";
import { layAnhSoModel, type AnhSoModel } from "./soModel/anhSoModel";
import { laVaiTroDaBiet } from "./soModel/dinhTuyenVaiTro";

const TEN_LOGIC = new Set(["chat", "code", "coder", "fast", "fim", "infill", "embed", "embedding", "embeddings", "auto"]);

export type KetQuaKiemModelV1 = { ok: true; ten: string } | { ok: false };

/** Lời từ chối của `/v1` khi `model` không hợp lệ — nêu dạng hợp lệ (dieu-phoi 2026-10-26). */
export const THONG_DIEP_MODEL_KHONG_HOP_LE =
  "Unknown model. Valid: auto | chat | code | fast | fim | embed | <role> | vai-tro:<role> | ho-so:<profile-id> (see GET /v1/models).";

export function kiemModelV1(model: string, y: { anh?: AnhSoModel } = {}): KetQuaKiemModelV1 {
  const tho = (model ?? "").trim();
  if (!tho || tho.length > 160) return { ok: false };
  const key = tho.toLowerCase();
  if (TEN_LOGIC.has(key)) return { ok: true, ten: key };
  if (CHON_MODEL_RE.test(tho)) return { ok: true, ten: tho };
  const anh = y.anh ?? layAnhSoModel();
  if (laTenVaiTro(key) && laVaiTroDaBiet(key, anh)) return { ok: true, ten: key };
  const hs = anh.profile.get(tho);
  if (hs) {
    if (!hs.enabled || hs.artifactStatus !== "available") return { ok: false };
    return { ok: true, ten: path.basename(hs.artifactFile).replace(/\.gguf$/i, "") };
  }
  return { ok: false };
}

/**
 * Lỗi trả client của `/v1`: lỗi mang ĐƯỜNG DẪN / "không tìm thấy tệp" ⇒ thông điệp chung (chi tiết chỉ vào log máy chủ);
 * lỗi khác giữ nguyên (client cần để hành động, vd vượt ngữ cảnh).
 */
export function thongDiepLoiChoKhachV1(err: unknown, macDinh: string): string {
  const m = (err as { message?: unknown } | null | undefined)?.message;
  if (typeof m !== "string" || !m) return macDinh;
  if (/GGUF model file not found|ENOENT|no such file|[A-Za-z]:[\\/]|(^|[\s'"(])\/[\w.-]+\/|\\\\/i.test(m)) {
    console.error("[openaiGateway] lỗi model (ẩn đường dẫn khỏi client):", m);
    return "model unavailable";
  }
  return m;
}
