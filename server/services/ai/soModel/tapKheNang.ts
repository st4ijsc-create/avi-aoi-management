/**
 * ★★ Đợt 7.1 — TẬP KHE NẶNG: những model llama-server CÓ THỂ phục vụ (đang giữ, hoặc sau khi đổi khe).
 * THUẦN (đọc ảnh sổ + env truyền vào) — `aiLlamaServerClient.laModelServerDangGiu` gọi nó trên đường sinh chữ.
 *
 *   H = {model nhà} ∪ {artifact của hồ sơ `nang` bật + `available`}
 *
 * ⚠ MỘT tập cho HAI người đọc (G1-D): M ∈ H ⇒ lượt đi qua server (ĐƯỜNG ĐI) VÀ tiến trình này cấm nạp M (ĐƯỜNG CẤM).
 *   Có hồ sơ `nang` cho model 30B mà vị từ cấm không biết ⇒ engine sẽ nạp bản 30B thứ hai trong tiến trình (OOM).
 */
import { toBasename } from "../modelResolver";
import type { AnhSoModel } from "./anhSoModel";

/** `AI_KHE_NANG_HOAN_DOI=false` ⇒ không tự đổi khe (tập phụ coi như rỗng). Mặc định BẬT. */
export function hoanDoiKheNangBat(env: NodeJS.ProcessEnv): boolean {
  return (env.AI_KHE_NANG_HOAN_DOI ?? "").trim().toLowerCase() !== "false";
}

/** Model "nhà" của khe nặng: `LLAMA_SERVER_MODEL` (đã phủ bởi lựa chọn quản trị) → `GGUF_DEFAULT_MODEL`. */
export function modelNhaKheNang(env: NodeJS.ProcessEnv): string {
  return toBasename(env.LLAMA_SERVER_MODEL) || toBasename(env.GGUF_DEFAULT_MODEL);
}

/** Basename các model khe nặng KHÁC nhà (hồ sơ `nang` bật, tệp còn). Không trùng lặp, thứ tự ổn định. */
export function modelKheNangPhu(anh: AnhSoModel, modelNha: string): string[] {
  const ra = new Set<string>();
  for (const p of anh.profile.values()) {
    if (p.slotClass !== "nang" || !p.enabled || p.artifactStatus !== "available") continue;
    const m = toBasename(p.artifactFile);
    if (m && m !== modelNha) ra.add(m);
  }
  return [...ra].sort();
}

/**
 * ★ Đợt 9 (dieu-phoi 2026-10-22) — M là artifact của một HỒ SƠ khe nặng (`slotClass = nang`, bật, tệp còn) — kể cả model nhà
 * nếu nó có hồ sơ. Dùng cho trần thời gian SINH riêng của khe nặng (`AI_KHE_NANG_INFER_TIMEOUT_MS`), KHÔNG phụ thuộc cờ đổi khe.
 */
export function laModelHoSoKheNang(model: string | undefined, anh: AnhSoModel): boolean {
  const m = toBasename(model);
  if (!m) return false;
  for (const p of anh.profile.values()) {
    if (p.slotClass === "nang" && p.enabled && p.artifactStatus === "available" && toBasename(p.artifactFile) === m) return true;
  }
  return false;
}

/** M có thuộc tập PHỤ (phục vụ được sau khi đổi khe) không. */
export function laModelKheNangPhu(model: string | undefined, anh: AnhSoModel, env: NodeJS.ProcessEnv): boolean {
  if (!model || !hoanDoiKheNangBat(env)) return false;
  return modelKheNangPhu(anh, modelNhaKheNang(env)).includes(toBasename(model));
}
