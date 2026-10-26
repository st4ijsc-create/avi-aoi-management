/**
 * ★★★ Luồng AI — NODE RẼ NHÁNH `logic.chon` (switch) và GOM `logic.gom` (lô logic-chon, 2026-10-26; dieu-phoi duyệt).
 *
 * `logic.chon` — cổng ra CỐ ĐỊNH (registry khai cổng tĩnh): `nhanh-1` … `nhanh-5` và `khac`. Mỗi item đi ĐÚNG MỘT cổng:
 *   • tham số `giaTri` (biểu thức theo item, giữ nguyên KIỂU) so với danh sách `nhanh` (≤ 5 điều kiện, THEO THỨ TỰ, điều kiện KHỚP ĐẦU TIÊN thắng);
 *   • điều kiện `{ so, dich }`: `eq` (bằng, nghiêm ngặt — KHÔNG ép kiểu: 1 ≠ "1", null ≠ undefined-chuỗi) · `in` (dich là mảng; bằng nghiêm ngặt một phần tử) ·
 *     `gt|lt|gte|lte` (CẢ HAI phải là số hữu hạn; khác kiểu ⇒ không khớp). KHÔNG regex (chống ReDoS). Đối tượng/mảng không bao giờ "bằng";
 *   • không điều kiện nào khớp, hoặc biểu thức `giaTri` lỗi ⇒ cổng `khac` — KHÔNG BAO GIỜ bỏ item (bảo toàn: Σ item ra = item vào);
 *   • trần `TRAN_ITEM_CHON` item mỗi lượt-node (vượt ⇒ lỗi rõ, không cắt âm thầm).
 * `khac` khai `congNenNoi`: item tới cổng chưa nối bị bỏ ⇒ động cơ ghi sự kiện `cong.khong-noi`, canvas cảnh báo khi lưu.
 *
 * `logic.gom` — gộp mọi item vào MỘT item `{ [truongRa]: [json…], soItem }` (truongRa mặc định `danhSach`), trần `TRAN_ITEM_GOM` (vượt ⇒ lỗi rõ).
 */
import { danhGiaThamSo } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem, type KetQuaChay } from "../dangKyNut";

export class LoiChon extends Error {
  constructor(message: string, readonly ma: string) {
    super(message);
  }
}

export const TRAN_ITEM_CHON = 1000;
export const TRAN_ITEM_GOM = 1000;
export const TRAN_NHANH_CHON = 5;
export const CONG_CHON = ["nhanh-1", "nhanh-2", "nhanh-3", "nhanh-4", "nhanh-5", "khac"] as const;
export const TOAN_TU_CHON = ["eq", "in", "gt", "lt", "gte", "lte"] as const;
export type ToanTuChon = (typeof TOAN_TU_CHON)[number];

const laSo = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const laNguyenThuy = (v: unknown): v is string | number | boolean | null => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** So sánh MỘT điều kiện — thuần, không ép kiểu. */
export function khopDieuKien(giaTri: unknown, so: unknown, dich: unknown): boolean {
  switch (so) {
    case "eq":
      return laNguyenThuy(giaTri) && laNguyenThuy(dich) && giaTri === dich;
    case "in":
      return laNguyenThuy(giaTri) && Array.isArray(dich) && dich.some((d) => laNguyenThuy(d) && d === giaTri);
    case "gt":
      return laSo(giaTri) && laSo(dich) && giaTri > dich;
    case "lt":
      return laSo(giaTri) && laSo(dich) && giaTri < dich;
    case "gte":
      return laSo(giaTri) && laSo(dich) && giaTri >= dich;
    case "lte":
      return laSo(giaTri) && laSo(dich) && giaTri <= dich;
    default:
      return false;
  }
}

/** Chọn cổng cho MỘT giá trị: điều kiện khớp ĐẦU TIÊN thắng; không khớp ⇒ `khac`. */
export function chonCong(giaTri: unknown, nhanh: readonly { so?: unknown; dich?: unknown }[]): (typeof CONG_CHON)[number] {
  for (let i = 0; i < Math.min(nhanh.length, TRAN_NHANH_CHON); i++) {
    if (khopDieuKien(giaTri, nhanh[i]?.so, nhanh[i]?.dich)) return CONG_CHON[i];
  }
  return "khac";
}

dangKyNut({
  type: "logic.chon",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: [...CONG_CHON],
  congNenNoi: ["khac"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const vao = ngu.inputs.main ?? [];
    if (vao.length > TRAN_ITEM_CHON) throw new LoiChon(`logic.chon nhận ${vao.length} item — tối đa ${TRAN_ITEM_CHON} mỗi lượt (không cắt âm thầm).`, "QUA_TRAN_ITEM");
    const nhanh = (Array.isArray(thamSo.nhanh) ? thamSo.nhanh : []) as { so?: unknown; dich?: unknown }[];
    if (nhanh.length > TRAN_NHANH_CHON) throw new LoiChon(`logic.chon có ${nhanh.length} điều kiện — tối đa ${TRAN_NHANH_CHON}.`, "QUA_NHIEU_NHANH");
    const ra: KetQuaChay = Object.fromEntries(CONG_CHON.map((c) => [c, []]));
    for (const item of vao) {
      let cong: (typeof CONG_CHON)[number] = "khac";
      try {
        const nc = nguCanhItem(ngu, item, vao);
        const gt = danhGiaThamSo(thamSo.giaTri, nc);
        // `dich` cũng có thể là biểu thức (vd so với trường khác) — đánh giá theo item
        const dsDich = nhanh.map((n) => ({ so: n?.so, dich: danhGiaThamSo(n?.dich, nc) }));
        cong = chonCong(gt, dsDich);
      } catch {
        cong = "khac"; // biểu thức lỗi ⇒ `khac`, KHÔNG làm rơi item
      }
      ra[cong].push(item);
    }
    return ra;
  },
});

dangKyNut({
  type: "logic.gom",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const vao = ngu.inputs.main ?? [];
    if (vao.length > TRAN_ITEM_GOM) throw new LoiChon(`logic.gom nhận ${vao.length} item — tối đa ${TRAN_ITEM_GOM} (không cắt âm thầm).`, "QUA_TRAN_ITEM");
    const truong = typeof thamSo.truongRa === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(thamSo.truongRa) ? thamSo.truongRa : "danhSach";
    return { main: [{ json: { [truong]: vao.map((i) => i.json), soItem: vao.length } }] };
  },
});
