/**
 * ★★★ Đợt 11.3-C (2026-10-31) — CỔNG DUYỆT KẾ HOẠCH (UX-D02): phần THUẦN dùng chung giữa lõi và máy chủ.
 *
 * Kế hoạch = danh sách bước của lần `todo_write` gần nhất. Người duyệt một KẾ HOẠCH CỤ THỂ, nhận diện bằng băm:
 *   • băm tính trên NỘI DUNG bước đã làm sạch (không tính trạng thái cho/đang làm/xong) ⇒ đánh dấu xong một bước không đòi duyệt lại;
 *     thêm/sửa/xoá/đổi chỗ bước thì băm đổi ⇒ phải duyệt lại trước tool ghi/lệnh kế tiếp;
 *   • MỘT hàm cho lõi và máy chủ (máy chủ tính lại để so — không tin băm do client gửi).
 * Nội dung bước là CHỮ THUẦN: ký tự ẩn/điều khiển/bidi bị bỏ, khoảng trắng gộp, NFC. Vượt trần ⇒ LỖI (không cắt âm thầm: người duyệt
 * phải thấy đúng cái model định làm).
 */
import { bamNoiDung, coKyTuAn } from "./dinhNghiaAgent";
import type { ViecKeHoach } from "./kieu";

export const TRAN_SO_BUOC_KE_HOACH = 30;
export const TRAN_KY_TU_BUOC_KE_HOACH = 200;

export type MaLoiKeHoach = "KE_HOACH_RONG" | "KE_HOACH_QUA_NHIEU_BUOC" | "KE_HOACH_BUOC_QUA_DAI" | "KE_HOACH_BUOC_RONG";

export type KetQuaChuanHoaKeHoach = { ok: true; viec: ViecKeHoach[]; bam: string } | { ok: false; ma: MaLoiKeHoach; thongDiep: string };

const TRANG_THAI_HOP_LE: ReadonlySet<string> = new Set(["cho", "dang-lam", "xong"]);

/** Một bước ⇒ chữ thuần một dòng (NFC, ký tự ẩn/điều khiển ⇒ bỏ, mọi khoảng trắng ⇒ một dấu cách). */
export function lamSachBuoc(s: unknown): string {
  const goc = typeof s === "string" ? s.normalize("NFC") : "";
  let ra = "";
  for (const ch of goc) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") ra += " ";
    else if (!coKyTuAn(ch)) ra += ch;
  }
  return ra.replace(/ +/g, " ").trim();
}

/** Băm của danh sách bước: SHA-256 hex của JSON mảng nội dung ĐÃ LÀM SẠCH (không phụ thuộc trạng thái bước). */
export function bamKeHoach(viec: readonly { noiDung: string }[]): string {
  return bamNoiDung(JSON.stringify(viec.map((v) => lamSachBuoc(v.noiDung))));
}

/** Làm sạch + kiểm trần + tính băm. Dùng ở lõi (khi `todo_write`) và máy chủ (khi lưu/đối chiếu). */
export function chuanHoaKeHoach(viec: readonly { noiDung: unknown; trangThai?: unknown }[]): KetQuaChuanHoaKeHoach {
  if (viec.length === 0) return { ok: false, ma: "KE_HOACH_RONG", thongDiep: "the plan has no steps; list the steps you will take" };
  if (viec.length > TRAN_SO_BUOC_KE_HOACH) {
    return { ok: false, ma: "KE_HOACH_QUA_NHIEU_BUOC", thongDiep: `the plan has ${viec.length} steps; the limit is ${TRAN_SO_BUOC_KE_HOACH} — merge steps` };
  }
  const sach: ViecKeHoach[] = [];
  for (let i = 0; i < viec.length; i++) {
    const nd = lamSachBuoc(viec[i].noiDung);
    if (nd === "") return { ok: false, ma: "KE_HOACH_BUOC_RONG", thongDiep: `step ${i + 1} is empty` };
    if ([...nd].length > TRAN_KY_TU_BUOC_KE_HOACH) {
      return { ok: false, ma: "KE_HOACH_BUOC_QUA_DAI", thongDiep: `step ${i + 1} is longer than ${TRAN_KY_TU_BUOC_KE_HOACH} characters — shorten it` };
    }
    const tt = typeof viec[i].trangThai === "string" && TRANG_THAI_HOP_LE.has(viec[i].trangThai as string) ? (viec[i].trangThai as ViecKeHoach["trangThai"]) : "cho";
    sach.push({ noiDung: nd, trangThai: tt });
  }
  return { ok: true, viec: sach, bam: bamKeHoach(sach) };
}

/** Kết quả host trả cho lõi sau khi hỏi người. `luc` = ISO do host (sổ) ghi lúc người bấm duyệt. */
export type KetQuaChoDuyetKeHoach = { ketQua: "duyet"; luc: string } | { ketQua: "bac" | "het-gio" };

/**
 * Móc host của cổng duyệt kế hoạch. Có móc ⇒ cổng BẬT (chế độ `sua`/`tu-dong`); vắng ⇒ hành vi như cũ từng byte.
 * Móc ném lỗi ⇒ lõi coi là BÁC (fail-closed). Lõi đua móc với huỷ; `signal` abort khi lượt bị huỷ để host dọn hàng chờ.
 */
export interface CongKeHoach {
  /**
   * `daSanSang()`: host gọi khi đã LƯU kế hoạch chờ (sổ) và người CÓ THỂ quyết ngay — lõi chỉ phát `ke-hoach-cho-duyet` lúc đó, để UI không
   * bao giờ thấy thẻ mà thủ tục duyệt chưa tìm thấy kế hoạch. Host không gọi (hoặc quyết định trả về trước) ⇒ lõi phát sự kiện ngay trước
   * sự kiện quyết định.
   */
  choDuyet(yc: { bam: string; viec: ViecKeHoach[]; signal: AbortSignal; daSanSang: () => void }): Promise<KetQuaChoDuyetKeHoach>;
}
