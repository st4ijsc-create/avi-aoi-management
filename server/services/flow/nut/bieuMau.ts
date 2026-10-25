/**
 * ★★ Lô nguoi.bieu-mau (2026-10-26; dieu-phoi duyệt) — người ĐIỀN BIỂU MẪU giữa luồng. Cùng cơ chế chờ bền của `nguoi.duyet` (hàng chờ `kind: "duyet"`, một người thắng, quá hạn ⇒ `het-han`,
 * mục "kiểm hết hạn" của động cơ), cùng cổng ra `dong-y` (= đã điền) / `tu-choi` (= bỏ qua, không điền) / `het-han`, cùng kiểm quyền ở `flow.duyet` (vai đủ thứ bậc + KHÁC người bật/kích hoạt).
 * Khác: payload mang `bieuMau: { truong, truongRa }` — danh sách trường người điền (≤ 20): `chuoi` (≤ 2000 ký tự) · `so` (hữu hạn) · `boolean` · `chon` (một trong `luaChon` ≤ 30). Trường `batBuoc` phải có giá trị.
 * Giá trị người điền được máy chủ KIỂM LẠI theo định nghĩa (`kiemGiaTriBieuMau`) trước khi vào luồng và ghi vào item dưới khoá `truongRa` (mặc định `bieuMau`) — là DỮ LIỆU KHÔNG TIN CẬY của người dùng
 * (node sau không được coi là chỉ dẫn). Khoá ngoài định nghĩa bị loại; trường không điền (và không bắt buộc) = null.
 */
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem } from "../dangKyNut";

export const TRAN_TRUONG_BIEU_MAU = 20;
export const TRAN_CHUOI_BIEU_MAU = 2000;
export const TRAN_LUA_CHON_BIEU_MAU = 30;
export const KIEU_TRUONG_BIEU_MAU = ["chuoi", "so", "boolean", "chon"] as const;
export type KieuTruongBieuMau = (typeof KIEU_TRUONG_BIEU_MAU)[number];
export const RE_TEN_TRUONG_BIEU_MAU = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export interface TruongBieuMau {
  ten: string;
  nhan: string;
  kieu: KieuTruongBieuMau;
  batBuoc?: boolean;
  luaChon?: string[];
}
export type GiaTriBieuMau = string | number | boolean | null;

/** Kiểm ĐỊNH NGHĨA trường (lúc lưu / lúc chạy): trả danh sách lỗi (rỗng = hợp lệ). */
export function kiemDinhNghiaBieuMau(truong: unknown): string[] {
  if (!Array.isArray(truong) || truong.length < 1) return ["cần ít nhất 1 trường"];
  if (truong.length > TRAN_TRUONG_BIEU_MAU) return [`tối đa ${TRAN_TRUONG_BIEU_MAU} trường (có ${truong.length})`];
  const loi: string[] = [];
  const da = new Set<string>();
  truong.forEach((t: Partial<TruongBieuMau> | null, i) => {
    if (!t || typeof t !== "object") return void loi.push(`trường ${i + 1}: không phải đối tượng`);
    if (typeof t.ten !== "string" || !RE_TEN_TRUONG_BIEU_MAU.test(t.ten)) loi.push(`trường ${i + 1}: ten phải khớp ${RE_TEN_TRUONG_BIEU_MAU}`);
    else if (da.has(t.ten)) loi.push(`trường ${i + 1}: ten '${t.ten}' bị trùng`);
    else da.add(t.ten);
    if (typeof t.nhan !== "string" || !t.nhan.trim() || t.nhan.length > 120) loi.push(`trường ${i + 1}: nhan là chuỗi 1–120 ký tự`);
    if (!(KIEU_TRUONG_BIEU_MAU as readonly string[]).includes(String(t.kieu))) loi.push(`trường ${i + 1}: kieu phải là ${KIEU_TRUONG_BIEU_MAU.join(" | ")}`);
    if (t.batBuoc !== undefined && typeof t.batBuoc !== "boolean") loi.push(`trường ${i + 1}: batBuoc phải là true/false`);
    if (t.kieu === "chon") {
      const lc = t.luaChon;
      if (!Array.isArray(lc) || lc.length < 1 || lc.length > TRAN_LUA_CHON_BIEU_MAU || lc.some((x) => typeof x !== "string" || !x.trim() || x.length > 120) || new Set(lc).size !== lc.length) {
        loi.push(`trường ${i + 1}: 'chon' cần luaChon 1–${TRAN_LUA_CHON_BIEU_MAU} chuỗi không rỗng, không trùng`);
      }
    } else if (t.luaChon !== undefined) loi.push(`trường ${i + 1}: luaChon chỉ dùng cho kieu 'chon'`);
  });
  return loi;
}

/**
 * Kiểm GIÁ TRỊ người điền theo định nghĩa (THUẦN). Khoá lạ bị loại (không báo lỗi); thiếu trường bắt buộc / sai kiểu / ngoài lựa chọn / quá dài ⇒ lỗi (câu tiếng Việt, không lộ dữ liệu khác).
 * Trường không bắt buộc để trống ("" / null / vắng) ⇒ null. `so` nhận số hữu hạn (chuỗi số KHÔNG được ép).
 */
export function kiemGiaTriBieuMau(truong: readonly TruongBieuMau[], giaTri: unknown): { ok: true; v: Record<string, GiaTriBieuMau> } | { ok: false; loi: string } {
  const goc = giaTri && typeof giaTri === "object" && !Array.isArray(giaTri) ? (giaTri as Record<string, unknown>) : {};
  const v: Record<string, GiaTriBieuMau> = {};
  for (const t of truong) {
    const x = Object.prototype.hasOwnProperty.call(goc, t.ten) ? goc[t.ten] : undefined;
    if (x === undefined || x === null || x === "") {
      if (t.batBuoc) return { ok: false, loi: `thiếu trường bắt buộc "${t.nhan}"` };
      v[t.ten] = null;
      continue;
    }
    if (t.kieu === "chuoi") {
      if (typeof x !== "string") return { ok: false, loi: `trường "${t.nhan}" phải là chữ` };
      if (x.length > TRAN_CHUOI_BIEU_MAU) return { ok: false, loi: `trường "${t.nhan}" quá dài (tối đa ${TRAN_CHUOI_BIEU_MAU} ký tự)` };
      v[t.ten] = x;
    } else if (t.kieu === "so") {
      if (typeof x !== "number" || !Number.isFinite(x)) return { ok: false, loi: `trường "${t.nhan}" phải là một số` };
      v[t.ten] = x;
    } else if (t.kieu === "boolean") {
      if (typeof x !== "boolean") return { ok: false, loi: `trường "${t.nhan}" phải là có/không` };
      v[t.ten] = x;
    } else {
      if (typeof x !== "string" || !(t.luaChon ?? []).includes(x)) return { ok: false, loi: `trường "${t.nhan}" phải chọn một trong các lựa chọn cho sẵn` };
      v[t.ten] = x;
    }
  }
  return { ok: true, v };
}

/** Lấy định nghĩa trường từ payload của hàng chờ (đã được node kiểm lúc tạo); không phải biểu mẫu ⇒ null. */
export function bieuMauCuaPayload(payload: unknown): { truong: TruongBieuMau[]; truongRa: string } | null {
  const b = (payload as { bieuMau?: { truong?: unknown; truongRa?: unknown } } | null)?.bieuMau;
  if (!b || !Array.isArray(b.truong)) return null;
  return { truong: b.truong as TruongBieuMau[], truongRa: typeof b.truongRa === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(b.truongRa) ? b.truongRa : "bieuMau" };
}

class LoiBieuMau extends Error {
  readonly ma = "THAM_SO_SAI";
}

dangKyNut({
  type: "nguoi.bieu-mau",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["dong-y", "tu-choi", "het-han"],
  tacDungPhu: "thuan",
  // Tạo hàng chờ là ghi NỘI BỘ có khoá (runId,nodeId) — chạy lại không tạo hàng thứ hai (ON CONFLICT DO NOTHING).
  lapLai: "idempotent",
  async chay(thamSo, ngu) {
    const vao = ngu.inputs.main ?? [];
    const t = danhGiaThamSo(thamSo, nguCanhItem(ngu, vao[0] ?? { json: {} }, vao)) as Record<string, unknown>;
    const loi = kiemDinhNghiaBieuMau(t.truong);
    if (loi.length) throw new LoiBieuMau(`nguoi.bieu-mau: ${loi.join("; ")}`);
    const gio = Number(t.hetHanGio ?? 24);
    const truongRa = typeof t.truongRa === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(t.truongRa) ? t.truongRa : "bieuMau";
    return {
      __cho: {
        kind: "duyet" as const,
        items: vao,
        hetHanMs: Number.isFinite(gio) && gio > 0 ? Math.min(gio, 24 * 30) * 3600_000 : undefined,
        payload: {
          tieuDe: String(t.tieuDe ?? "Cần điền biểu mẫu").slice(0, 200),
          noiDung: String(t.noiDung ?? "").slice(0, 4000),
          vaiTroDuyet: String(t.vaiTroDuyet ?? "supervisor").slice(0, 32),
          bieuMau: {
            truong: (t.truong as TruongBieuMau[]).map((f) => ({
              ten: f.ten,
              nhan: f.nhan.trim(),
              kieu: f.kieu,
              ...(f.batBuoc ? { batBuoc: true } : {}),
              ...(f.kieu === "chon" ? { luaChon: f.luaChon } : {}),
            })),
            truongRa,
          },
        },
      },
    };
  },
});
