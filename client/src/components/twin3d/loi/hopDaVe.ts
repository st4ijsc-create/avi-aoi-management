/**
 * hopDaVe.ts — SỔ HỘP ĐÃ VẼ dùng chung giữa các lớp phủ DOM của MỘT canvas (Đợt 47, N5).
 *
 * `LopCanhBao` (badge) và `LopNhan` (nhãn) mỗi lớp tự khử chồng trong TẬP CỦA
 * MÌNH, nhưng không biết tập của lớp kia ⇒ nhãn đè badge 344–1.819 px² (QA Đợt
 * 46, N5: *"hai bộ khử chồng độc lập"*). Đây là MỘT ngân sách hình chữ nhật
 * chung: lớp ưu tiên cao (badge — alarm, §10.3) vẽ trước và GHI hộp của mình
 * vào sổ; lớp sau (nhãn) ĐỌC sổ như vùng cấm thêm. Khoá sổ là phần tử canvas —
 * mỗi `<KhungCanh>` một sổ; `WeakMap` để canvas unmount thì sổ tự đi.
 *
 * ★ THỨ TỰ TRONG KHUNG LÀ HỢP ĐỒNG: hai lớp đều `useFrame` ưu tiên 0 ⇒ chạy theo
 *   thứ tự đăng ký = thứ tự trong cây JSX. `CanhVanHanh.NoiDung` đặt
 *   `<LopCanhBao>` TRƯỚC `<LopNhan>`; đảo hai dòng đó là đảo ai-nhường-ai (nhãn
 *   sẽ đọc hộp badge của KHUNG TRƯỚC — lệch một khung khi camera đang xoay).
 *
 * Thuần: không three, không react ⇒ test ở `environment: "node"`.
 */

import type { HinhChuNhat } from "./locNhan";

/** Tên lớp badge trong sổ — `LopCanhBao` ghi, `LopNhan` đọc. Một hằng, hai chỗ dùng. */
export const LOP_BADGE = "badge";

const so = new WeakMap<object, Map<string, readonly HinhChuNhat[]>>();

/** Ghi (thay thế) tập hộp của một lớp cho canvas `khoa`. Truyền `[]` để xoá đóng góp của lớp. */
export function ghiHopDaVe(khoa: object, lop: string, hop: readonly HinhChuNhat[]): void {
  let m = so.get(khoa);
  if (!m) {
    m = new Map();
    so.set(khoa, m);
  }
  m.set(lop, hop);
}

/** Hộp của MỘT lớp. Không có ⇒ `[]` (không phải `undefined`: "chưa ai ghi" và "ghi 0 hộp" cùng nghĩa cho người đọc). */
export function docHopDaVe(khoa: object, lop: string): readonly HinhChuNhat[] {
  return so.get(khoa)?.get(lop) ?? [];
}

/** Hộp của MỌI lớp trừ `tru` — cho một lớp đọc "những gì người khác đã vẽ". */
export function docHopDaVeTru(khoa: object, tru: string): HinhChuNhat[] {
  const m = so.get(khoa);
  if (!m) return [];
  const ra: HinhChuNhat[] = [];
  for (const [lop, hop] of m) if (lop !== tru) ra.push(...hop);
  return ra;
}

/** Xoá đóng góp của một lớp (dùng ở cleanup unmount của lớp đó). */
export function xoaHopDaVe(khoa: object, lop: string): void {
  so.get(khoa)?.delete(lop);
}

/**
 * ★★★ ĐỢT 49 (mục D) — SỔ SỐ ĐẾM dùng chung, cùng khoá canvas với sổ hộp ở trên.
 *
 * Vì sao cần: `/twin`@1280 đo được `tong 7 · ve 5 · soAn 2 · biChe 2` — hai cảnh báo bị GIẤU và
 * màn KHÔNG nói ra (chip đáy canvas chỉ đếm TÊN MÁY ẩn; thuộc tính `data-so-an` chỉ DOM đọc
 * được). Chip phải nói cả "còn N cảnh báo ẩn". Nhưng con số ấy do `LopCanhBao` tính, còn chip
 * do `LopNhan` vẽ (nó đã giữ ngân sách đáy canvas `demDuoiChoChip` và đã nghiệm thu "chip trong
 * canvas, không bị che" — G122). Vẽ chip thứ hai ở lớp badge là cách chắc chắn để hai cụm chip
 * đè nhau, tức chữa một lỗi thị giác bằng một lỗi thị giác.
 *
 * ★ THỨ TỰ TRONG KHUNG LÀ HỢP ĐỒNG — y như sổ hộp: `CanhVanHanh` đặt `<LopCanhBao>` TRƯỚC
 *   `<LopNhan>`, nên số ghi ở khung này được đọc ngay ở khung này. Đảo hai dòng ⇒ chip trễ một khung.
 */
const soDem = new WeakMap<object, Map<string, number>>();

/** Ghi số của một lớp cho canvas `khoa`. */
export function ghiSoAn(khoa: object, lop: string, n: number): void {
  let m = soDem.get(khoa);
  if (!m) {
    m = new Map();
    soDem.set(khoa, m);
  }
  m.set(lop, n);
}

/** Số của một lớp. Chưa ai ghi ⇒ 0 (và "ghi 0" cùng nghĩa với người đọc). */
export function docSoAn(khoa: object, lop: string): number {
  return soDem.get(khoa)?.get(lop) ?? 0;
}

/** Xoá số của một lớp (cleanup unmount). */
export function xoaSoAn(khoa: object, lop: string): void {
  soDem.get(khoa)?.delete(lop);
}
