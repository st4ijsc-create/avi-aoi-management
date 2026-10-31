/**
 * ★★★ ĐỢT 11.4 / MỤC 1 — THANH TRẠNG THÁI "Thợ Cả · model · %ngữ cảnh · tok/s": logic THUẦN (không biết `vscode`).
 *
 * Nguồn số: sự kiện `usage` của lõi agent (`vao`, `ra`, `ctxPhanTram`) — số THẬT khi máy chủ trả usage, số ƯỚC LƯỢNG (dấu «~»)
 * trước lượt gọi. tok/s = token ra / thời gian của MỘT lượt gọi model (gồm xếp hàng chờ khe nếu có) ⇒ là tốc độ HIỆU DỤNG
 * người dùng thấy, không phải tốc độ sinh thuần; chỉ tính khi ra > 0 và đủ dài (≥ 300 ms) để không ra số vô lý.
 */
export const TRAN_CANH_BAO_NGU_CANH = 85;
const SAN_MS_TOK_S = 300;

export interface TrangThaiThanh {
  /** Mã model đang dùng (đã qua `modelChoAgent`); rỗng ⇒ không hiện. */
  model: string;
  /** 0..100+ ; `undefined` ⇒ chưa có số. */
  ctxPhanTram?: number;
  uocLuong: boolean;
  tokPerS?: number;
  dangChay: boolean;
  /** (mục 2) số thẻ duyệt đang CHỜ người dùng, cộng mọi khung đang mở. */
  soChoDuyet?: number;
}

export const THANH_RONG: TrangThaiThanh = { model: "", uocLuong: false, dangChay: false };

export function tinhTokPerS(ra: number, ms: number): number | undefined {
  if (!Number.isFinite(ra) || !Number.isFinite(ms) || ra <= 0 || ms < SAN_MS_TOK_S) return undefined;
  return Math.round((ra * 1000) / ms);
}

/** `ngoai:<ncc>:<model>` → `<model>` (kèm ncc); `vai-tro:x` → `x`; mã khác giữ nguyên, cắt ở 28 ký tự. */
export function nhanModelNgan(ma: string): string {
  const m = ma.trim();
  let r = m;
  if (m.startsWith("ngoai:")) {
    const [, ncc = "", ...con] = m.split(":");
    r = `${con.join(":") || m} (${ncc})`;
  } else if (m.startsWith("vai-tro:") || m.startsWith("ho-so:")) {
    r = m.slice(m.indexOf(":") + 1);
  }
  return r.length > 28 ? `${r.slice(0, 27)}…` : r;
}

export function dinhDangThanh(t: TrangThaiThanh): { text: string; tooltip: string; canhBao: boolean } {
  const phan: string[] = ["Thợ Cả"];
  if (t.model) phan.push(nhanModelNgan(t.model));
  const coCtx = typeof t.ctxPhanTram === "number" && Number.isFinite(t.ctxPhanTram);
  if (coCtx) phan.push(`${t.uocLuong ? "~" : ""}${Math.max(0, Math.round(t.ctxPhanTram as number))}% ngữ cảnh`);
  if (t.tokPerS !== undefined) phan.push(`${t.tokPerS} tok/s`);
  const choDuyet = Number.isFinite(t.soChoDuyet) ? Math.max(0, Math.floor(t.soChoDuyet as number)) : 0;
  if (choDuyet > 0) phan.push(`${choDuyet} chờ duyệt`);
  const canhBao = (coCtx && (t.ctxPhanTram as number) >= TRAN_CANH_BAO_NGU_CANH) || choDuyet > 0;
  const dong = [
    t.model ? `Model: ${t.model}` : "Model: theo cấu hình",
    coCtx ? `Ngữ cảnh: ${t.ctxPhanTram}% ngân sách${t.uocLuong ? " (ước lượng, chưa có số thật từ máy chủ)" : ""}${canhBao ? " — sắp đầy, nên mở chat mới" : ""}` : "Ngữ cảnh: chưa có lượt nào",
    t.tokPerS !== undefined ? `Tốc độ hiệu dụng: ${t.tokPerS} token/giây (gồm thời gian chờ khe model)` : "Tốc độ: chưa đo",
    choDuyet > 0 ? `${choDuyet} thẻ duyệt đang chờ bạn — agent dừng cho tới khi bạn quyết.` : "Không có thẻ duyệt nào đang chờ.",
    t.dangChay ? "Đang chạy một lượt…" : "Bấm để mở khung chat.",
  ];
  return { text: `${t.dangChay ? "$(sync~spin) " : "$(hubot) "}${phan.join(" · ")}`, tooltip: dong.join("\n"), canhBao };
}

/** Bộ giảm: một gói cập nhật từng phần vào trạng thái. */
export function capNhatThanh(cu: TrangThaiThanh, c: Partial<TrangThaiThanh>): TrangThaiThanh {
  return { ...cu, ...c };
}

/** Huy hiệu số trên icon view: 0/hỏng ⇒ undefined (xoá huy hiệu). */
export function huyHieuDuyet(n: number): { value: number; tooltip: string } | undefined {
  if (!Number.isFinite(n) || n < 1) return undefined;
  const v = Math.floor(n);
  return { value: v, tooltip: `${v} thẻ duyệt đang chờ bạn` };
}

/** Tổng số chờ duyệt của nhiều khung (mỗi khung báo số tuyệt đối của riêng nó). */
export function tongChoDuyet(theoNguon: ReadonlyMap<unknown, number>): number {
  let t = 0;
  for (const n of theoNguon.values()) if (Number.isFinite(n) && n > 0) t += Math.floor(n);
  return t;
}
