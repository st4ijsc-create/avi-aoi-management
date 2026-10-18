/**
 * ★★ Đợt 3b (3.5) — KHÔI PHỤC NHẬT KÝ TERMINAL / VẤN ĐỀ khi mở lại phiên.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LƯU Ở TRÌNH DUYỆT, KHÔNG Ở PHIÊN MÁY CHỦ — và giới hạn nói thẳng
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Phiên máy chủ (`ai_coding_sessions.turns`) CHỈ mang `{role, content}` — đó là bất biến an toàn của doc 79 (phép chiếu
 * `locLuot` ở cả hai cửa). Dựng lại Terminal từ CHỮ trong `turns` là tin một khối "command-output" mà model cũng viết
 * được — đúng lỗ "model giả đầu ra lệnh xanh" đã vá ở `KhoiMaCoNhan` (nhãn tin cậy theo NGUỒN tin nhắn, không theo
 * chữ). Nên nhật ký lệnh — thứ chỉ CLIENT ghi từ kết quả `confirmAction` thật — lưu RIÊNG ở `localStorage`, khoá theo
 * (người dùng × dự án × phiên).
 *   • GIỚI HẠN: chỉ trình duyệt đã chạy lệnh mới khôi phục được; máy khác / xoá dữ liệu trình duyệt ⇒ không có (giao
 *     diện nói rõ ở chân bộ chọn phiên). Không thẻ duyệt, không vòng tự động nào được khôi phục (chỉ chữ để XEM).
 *   • Trần: 20 lượt mới nhất, đầu ra mỗi lượt 20.000 ký tự (cắt ĐẦU, giữ đuôi — lỗi thường ở cuối).
 *   • Địa điểm lỗi (Vấn đề) KHÔNG lưu — tính LẠI từ đầu ra bằng bộ đọc của trang lúc khôi phục.
 *   • Đọc: mọi mục méo bị BỎ (không "sửa cho đúng"); JSON hỏng / bộ nhớ bị chặn ⇒ danh sách rỗng, không ném.
 */
import type { LuotLenh } from "@/components/ai/BangTerminal";

export const TRAN_LUOT_LUU = 20;
export const TRAN_KY_TU_DAU_RA = 20_000;
const TIEN_TO = "repoWs.nhatKyLenh.v1";

export function khoaNhatKyLenh(userId: number | string | null | undefined, projectId: string, sessionId: string): string | null {
  if (userId === null || userId === undefined || userId === "" || !projectId || !sessionId) return null;
  return `${TIEN_TO}.${userId}.${projectId}.${sessionId}`;
}

type LuotLuu = Omit<LuotLenh, "diaDiemLoi">;

function catDau(s: string): string {
  return s.length <= TRAN_KY_TU_DAU_RA ? s : s.slice(s.length - TRAN_KY_TU_DAU_RA);
}

/** Chuỗi JSON để lưu (đã cắt trần, bỏ `diaDiemLoi`). THUẦN. */
export function dongGoiNhatKy(luot: readonly LuotLenh[]): string {
  const ra: LuotLuu[] = luot.slice(-TRAN_LUOT_LUU).map((l) => ({
    lenh: l.lenh,
    dauRa: catDau(l.dauRa),
    exitCode: l.exitCode,
    timedOut: l.timedOut,
    durationMs: l.durationMs,
    ketQua: l.ketQua,
    luc: l.luc,
    nguon: l.nguon,
  }));
  return JSON.stringify(ra);
}

function soHoacNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** Mở gói + KIỂM hình dạng từng mục; `phanTich` tính lại địa điểm lỗi. THUẦN. */
export function moGoiNhatKy(tho: string | null, phanTich: (dauRa: string) => LuotLenh["diaDiemLoi"]): LuotLenh[] {
  if (!tho) return [];
  let x: unknown;
  try {
    x = JSON.parse(tho);
  } catch {
    return [];
  }
  if (!Array.isArray(x)) return [];
  const ra: LuotLenh[] = [];
  for (const m of x.slice(-TRAN_LUOT_LUU)) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (typeof o.lenh !== "string" || typeof o.dauRa !== "string" || typeof o.luc !== "string") continue;
    if (o.nguon !== "duyet" && o.nguon !== "vong_tu_dong") continue;
    const kq = o.ketQua as Record<string, unknown> | null | undefined;
    const ketQua =
      kq && typeof kq === "object" && typeof kq.xanh === "boolean"
        ? { xanh: kq.xanh, soDo: soHoacNull(kq.soDo), soXanh: soHoacNull(kq.soXanh) }
        : null;
    const dauRa = catDau(o.dauRa);
    ra.push({
      lenh: o.lenh.slice(0, 300),
      dauRa,
      exitCode: soHoacNull(o.exitCode),
      timedOut: o.timedOut === true,
      durationMs: soHoacNull(o.durationMs),
      ketQua,
      luc: o.luc.slice(0, 40),
      nguon: o.nguon,
      diaDiemLoi: phanTich(dauRa),
    });
  }
  return ra;
}

interface KhoNho {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function luuNhatKyLenh(kho: KhoNho | null | undefined, khoa: string | null, luot: readonly LuotLenh[]): void {
  if (!kho || !khoa) return;
  try {
    if (luot.length === 0) kho.removeItem(khoa);
    else kho.setItem(khoa, dongGoiNhatKy(luot));
  } catch {
    /* đầy / bị chặn ⇒ bỏ qua — nhật ký là phần thêm */
  }
}

export function docNhatKyLenh(
  kho: KhoNho | null | undefined,
  khoa: string | null,
  phanTich: (dauRa: string) => LuotLenh["diaDiemLoi"],
): LuotLenh[] {
  if (!kho || !khoa) return [];
  try {
    return moGoiNhatKy(kho.getItem(khoa), phanTich);
  } catch {
    return [];
  }
}

export function xoaNhatKyLenh(kho: KhoNho | null | undefined, khoa: string | null): void {
  if (!kho || !khoa) return;
  try {
    kho.removeItem(khoa);
  } catch {
    /* ignore */
  }
}
