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
