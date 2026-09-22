/**
 * ★ F1 (2026-09-22) — logic THUẦN cho bảng "model đang nghĩ".
 *
 * Model biết nghĩ (Qwen3.6) có thể nghĩ 5–12 nghìn token (20–90 s) trước khi phát ký tự mã đầu tiên. Trước F1 màn
 * hình chỉ có một dòng "Đang xử lý…" — người dùng không phân biệt được *treo* với *đang nghĩ*, và không thấy model
 * đang đi hướng nào để ngắt sớm khi nó lạc. Bảng này hiện ĐUÔI của chuỗi nghĩ (phần mới nhất — thứ người đọc cần lúc
 * đang chờ), kèm tổng số ký tự; toàn văn không giữ trong DOM (chuỗi 40 nghìn ký tự re-render mỗi token là tự làm
 * chậm mình).
 */
export interface TomTatNghi {
  /** Tổng số ký tự suy luận đã nhận (đầy đủ, không phải phần hiện). */
  soKyTu: number;
  /** Phần hiện: đuôi `maxKyTu` ký tự gần nhất, có "…" đầu khi bị cắt. */
  duoi: string;
  biCat: boolean;
}

export const MAX_KY_TU_HIEN = 1200;

export function tomTatNghi(vanBan: string, maxKyTu: number = MAX_KY_TU_HIEN): TomTatNghi {
  const s = typeof vanBan === "string" ? vanBan : "";
  const max = Number.isFinite(maxKyTu) && maxKyTu > 0 ? Math.floor(maxKyTu) : MAX_KY_TU_HIEN;
  if (s.length <= max) return { soKyTu: s.length, duoi: s, biCat: false };
  return { soKyTu: s.length, duoi: "…" + s.slice(s.length - max), biCat: true };
}

/**
 * Bảng NÊN mở hay gấp khi người dùng chưa bấm gì: mở khi model còn đang nghĩ mà chưa có chữ (đó là lúc cần nhìn),
 * gấp ngay khi mã bắt đầu chảy (mã mới là thứ cần đọc). Người dùng bấm ⇒ ý họ thắng (`nguoiChon` khác `null`).
 */
export function nenMoBang(o: { readonly daCoChu: boolean; readonly nguoiChon: boolean | null }): boolean {
  if (o.nguoiChon !== null) return o.nguoiChon;
  return !o.daCoChu;
}
