/**
 * khungNhinBan2D.ts — **ĐẶT NỘI DUNG 2D VÀO VÙNG CANVAS CÒN DÙNG ĐƯỢC**, không vào cả khung.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT ĐƯỢC GHIM — ĐO TRÊN TRÌNH DUYỆT THẬT
 * ════════════════════════════════════════════════════════════════════════════
 * Bản 3D từ lâu đã đặt cảnh vào **vùng còn dùng được** (`vungDungCanvas` + `khungNhinVaoVung`):
 * lớp phủ DOM (panel trái/phải, thanh công cụ) che một phần canvas, nên khớp cảnh vào **cả**
 * khung là đẩy chính nội dung xuống dưới chúng. Bản 2D **không có** cơ chế ấy.
 *
 * Hậu quả đo được ở `?pv=tapdoan` bản 2D, sau khi biểu tượng toà thành **đích bấm** (lối (b),
 * chủ dự án chốt 2026-09-20):
 *   · **8/14** biểu tượng có ĐIỂM GIỮA rơi trúng lớp phủ (`ngan-xu-ly`, `nut-dieu-huong-*`,
 *     `trang-thai-ket-noi`) ⇒ **bấm không tới**;
 *   · và mỗi biểu tượng rộng **88,2 × 64,1 px** — tức **KHÔNG** phải vấn đề kích thước.
 * ⚠ Khớp theo NỘI DUNG (bản vá trước) **không cứu được**: nội dung vốn đã lấp gần trọn khung,
 *   nên thu khung lại chỉ đổi 86,2 → 88,2 px và vẫn đúng 8/14 nằm dưới panel. Hai nguyên nhân
 *   khác nhau, và chỉ nguyên nhân thứ hai còn lại.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ CÁCH LÀM — MỘT PHÉP CHIA, KHÔNG PHẢI MỘT LOẠT LỀ CHẮP VÁ
 * ════════════════════════════════════════════════════════════════════════════
 * `<svg>` mặc định `preserveAspectRatio="xMidYMid meet"`: nó khớp `viewBox` vào khung bằng
 * `min` của hai tỉ lệ rồi **căn giữa**. Nên thay vì cộng lề, ta chọn `viewBox` sao cho phép khớp
 * ấy **tự** đặt nội dung vào đúng vùng dùng được:
 *
 *   k = min(rộngVùng / rộngNộiDung, caoVùng / caoNộiDung)      ← tỉ lệ px trên mét
 *   viewBox.rộng = rộngKhung / k   ·   viewBox.sau = caoKhung / k   ← CÙNG tỉ lệ khung ⇒ `meet`
 *                                                                     không thêm lề nào nữa
 *   viewBox.x = nộiDung.xMin − tráiVùng / k   ·   viewBox.z = nộiDung.zMin − trênVùng / k
 *
 * Kết quả: điểm `(xMin, zMin)` của nội dung rơi **đúng** vào góc trên-trái của vùng dùng được,
 * và tỉ lệ vẫn đồng nhất hai trục (không bóp méo mặt bằng).
 *
 * ⚠ KHÔNG có vùng dùng được (chưa đo được lớp phủ, hoặc lớp phủ ăn hết khung) ⇒ trả `null` để
 *   người gọi giữ NGUYÊN hành vi cũ. Bịa một vùng ở đây là đặt cảnh vào một chỗ không ai thấy.
 */

/** Hộp nội dung trong hệ toạ độ CẢNH (mét). */
export interface HopNoiDung2D {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

/** Một hộp trên canvas, px, gốc ở góc trên-trái của chính canvas. */
export interface HopCanvas2D {
  trai: number;
  phai: number;
  tren: number;
  duoi: number;
}

/** `viewBox` của `<svg>`: `x z rong sau` (mét). */
export interface KhungNhin2D {
  x: number;
  z: number;
  rong: number;
  sau: number;
}

function huuHan(...xs: number[]): boolean {
  return xs.every((x) => Number.isFinite(x));
}

/**
 * `viewBox` đặt `noiDung` vào **đúng** `vungDung` của một khung `rongPx × caoPx`.
 *
 * @returns `null` khi thiếu dữ kiện hoặc dữ kiện suy biến — người gọi giữ hành vi cũ.
 */
export function khungNhinBan2D(
  noiDung: HopNoiDung2D | null | undefined,
  khungPx: { rong: number; cao: number } | null | undefined,
  vungDung: HopCanvas2D | null | undefined,
): KhungNhin2D | null {
  if (!noiDung || !khungPx || !vungDung) return null;
  const { xMin, xMax, zMin, zMax } = noiDung;
  const { rong: rongPx, cao: caoPx } = khungPx;
  const { trai, phai, tren, duoi } = vungDung;
  if (!huuHan(xMin, xMax, zMin, zMax, rongPx, caoPx, trai, phai, tren, duoi)) return null;

  const rongNoiDung = xMax - xMin;
  const sauNoiDung = zMax - zMin;
  const rongVung = phai - trai;
  const caoVung = duoi - tren;
  // ⚠ Mọi bề phải DƯƠNG THỰC SỰ: một bề 0 làm `k` thành `Infinity`/`NaN` và `viewBox` vô nghĩa.
  if (!(rongNoiDung > 0 && sauNoiDung > 0 && rongVung > 0 && caoVung > 0)) return null;
  if (!(rongPx > 0 && caoPx > 0)) return null;

  const k = Math.min(rongVung / rongNoiDung, caoVung / sauNoiDung);
  if (!(k > 0) || !Number.isFinite(k)) return null;

  return {
    x: xMin - trai / k,
    z: zMin - tren / k,
    rong: rongPx / k,
    sau: caoPx / k,
  };
}
