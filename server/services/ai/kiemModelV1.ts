/**
 * ★ M4 (audit bảo mật kiem-dinh 2026-10-21) — CỬA `model` của `/v1`. Client chỉ được chọn:
 *   • tên logic cũ (chat/code/coder/fast/fim/infill/embed/embedding/embeddings) hoặc `auto`;
 *   • tên VAI TRÒ đã biết (sổ hoặc bộ gốc);
 *   • id HỒ SƠ phục vụ trong sổ (⇒ basename artifact của hồ sơ đó; hồ sơ tắt / artifact không available ⇒ từ chối);
 *   • TÊN TỆP trần (không dấu phân cách, không `..`, không ổ đĩa) mà `<GGUF_MODELS_DIR>/<tên>[.gguf]` CÓ THẬT và realpath
 *     của nó nằm TRONG realpath của thư mục (symlink trỏ ra ngoài ⇒ từ chối).
 * Mọi thứ khác ⇒ `{ ok: false }` ⇒ 400 với thông điệp chung (không phản chiếu đường dẫn, không lộ tệp có/không).
 */
import fs from "node:fs";
import path from "node:path";
import { laTenVaiTro } from "../../../shared/aiRoles";
import { layAnhSoModel, type AnhSoModel } from "./soModel/anhSoModel";
import { laVaiTroDaBiet } from "./soModel/dinhTuyenVaiTro";

const TEN_LOGIC = new Set(["chat", "code", "coder", "fast", "fim", "infill", "embed", "embedding", "embeddings", "auto"]);
const RE_TEN_TEP = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,159}$/;

export type KetQuaKiemModelV1 = { ok: true; ten: string } | { ok: false };

function thuMucMacDinh(): string {
  return process.env.GGUF_MODELS_DIR ? path.resolve(process.env.GGUF_MODELS_DIR) : path.join(process.cwd(), "uploads", "gguf-models");
}

function trongThuMuc(goc: string, ten: string): boolean {
  let gocThat: string;
  try {
    gocThat = fs.realpathSync(goc);
  } catch {
    return false;
  }
  for (const ung of [ten, `${ten}.gguf`]) {
    const p = path.join(gocThat, ung);
    try {
      const that = fs.realpathSync(p);
      if (that.startsWith(gocThat + path.sep) && fs.statSync(that).isFile()) return true;
    } catch {
      /* không có ⇒ thử ứng viên kế */
    }
  }
  return false;
}

export function kiemModelV1(model: string, y: { thuMucModel?: string; anh?: AnhSoModel } = {}): KetQuaKiemModelV1 {
  const tho = (model ?? "").trim();
  if (!tho || tho.length > 160) return { ok: false };
  const key = tho.toLowerCase();
  if (TEN_LOGIC.has(key)) return { ok: true, ten: key };
  const anh = y.anh ?? layAnhSoModel();
  if (laTenVaiTro(key) && laVaiTroDaBiet(key, anh)) return { ok: true, ten: key };
  const hs = anh.profile.get(tho);
  if (hs) {
    if (!hs.enabled || hs.artifactStatus !== "available") return { ok: false };
    return { ok: true, ten: path.basename(hs.artifactFile).replace(/\.gguf$/i, "") };
  }
  if (!RE_TEN_TEP.test(tho) || tho.includes("..")) return { ok: false };
  return trongThuMuc(y.thuMucModel ?? thuMucMacDinh(), tho) ? { ok: true, ten: tho } : { ok: false };
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
