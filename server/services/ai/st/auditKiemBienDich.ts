/**
 * ★ Đợt 9 — mẩu AUDIT / header của vòng kiểm biên dịch ST, DÙNG CHUNG cho `/v1` (openaiGateway) và đường KB coding
 * (`aiLocalKnowledgeCodingKiemST`). Tách khỏi `routes/openaiGateway.ts` để service không phải import một module route.
 * CHỈ số liệu + mã lỗi — KHÔNG mã nguồn. Định dạng ỔN ĐỊNH (tra cứu đọc theo khoá).
 */
import type { KetQuaKiemBienDichST } from "./kiemBienDichSt";

/** Giá trị header `x-st4i-bien-dich` (nhánh không stream của /v1). */
export function headerKiemBienDich(k: KetQuaKiemBienDichST): string {
  if (k.trangThai === "bo-qua") return "ok=skip";
  const loiCon = k.chanDoanCuoi.filter((d) => d.mucDo === "error").length;
  const ok = k.trangThai === "sach" || k.trangThai === "da-sua" ? "1" : k.trangThai === "khong-kiem-duoc" ? "na" : "0";
  return `ok=${ok}; trang-thai=${k.trangThai}; vong=${k.soVong}; sua=${k.soLoiDaSua}; con=${loiCon}`;
}

/**
 * Mẩu `ai_llm_audit.redactedSnippet`: `kiem-bien-dich-st ok=… trang-thai=… vong=… sua=… con=… ms=… [ly-do=…] [ma=E1,E2]`.
 * `bo-qua` ⇒ `undefined` (cột giữ NULL như mọi lượt khác).
 */
export function auditKiemBienDich(k: KetQuaKiemBienDichST): string | undefined {
  if (k.trangThai === "bo-qua") return undefined;
  const ma = [...new Set(k.chanDoanCuoi.filter((d) => d.mucDo === "error").map((d) => d.ma).filter(Boolean))].slice(0, 10);
  const lyDo = k.lyDo ? ` ly-do=${k.lyDo.replace(/\s+/g, "_").slice(0, 120)}` : "";
  return `kiem-bien-dich-st ${headerKiemBienDich(k).replace(/;/g, "")} ms=${k.msThem}${lyDo}${ma.length ? ` ma=${ma.join(",")}` : ""}`;
}
