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
 * Kết quả: tỉ lệ đồng nhất hai trục (không bóp méo mặt bằng), và nội dung nằm trọn trong vùng.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NEO Ở ĐÂU TRONG VÙNG — BẢN ĐẦU NEO GÓC TRÊN-TRÁI, VÀ ĐÓ LÀ MỘT KHUYẾT TẬT
 * ════════════════════════════════════════════════════════════════════════════
 * Bản đầu đặt `(xMin, zMin)` vào đúng **góc trên-trái** vùng dùng được. Nghe thì vô hại, nhưng
 * `phamViCanh.ts` đã ghi rõ từ PH-46/47 — và ghi bằng số — rằng **mọi thẻ nổi của màn này neo ở
 * NỬA TRÊN canvas** (`bang-kpi-noi` trên-trái, `cum-trang-thai-du-lieu` trên-phải). Neo nội dung
 * lên trên là ném nó vào đúng chỗ đông thẻ nhất, nên bản 3D **neo ĐÁY** — còn bản 2D thì không.
 * Hai bề mặt, một màn, hai luật: đúng lớp "hai nút, hai thứ" mà Task 20 đã phải vá một lần.
 *
 * Đo được ở `?pv=tapdoan` bản 2D, 1280×720 (`.qa-v2/v6-2d-do-che.mjs`, `elementFromPoint` trên
 * lưới 2 px trong lòng từng biểu tượng):
 *
 * | biểu tượng | % diện tích còn bấm trúng chính nó | ô vuông trống lớn nhất | đạt 24×24 |
 * |---|---|---|---|
 * | 11/14 khác | 100 % | 38×38 px | ✅ |
 * | toà 97 | 69 % | 30×30 px | ✅ |
 * | **toà 93** | **21 %** | **6×6 px** | ❌ |
 * | **toà 94** | **34 %** | **8×8 px** | ❌ |
 *
 * ⚠ Và **`data-che-nhan` KHÔNG thiếu** — tôi đã báo sai điều này ở vòng 5. Cả 7 lớp phủ đều
 *   khai đủ; kẻ chặn là `cum-trang-thai-du-lieu` (`data-che-nhan=1`, 310×29, góc trên-phải).
 *   Nó bị bỏ qua vì `vungDungCanvas` **chỉ trừ lớp phủ cắt SUỐT một chiều** — một giới hạn
 *   CỐ Ý, đã ghi trong docblock của chính nó, vì trừ một thẻ góc thành cả dải là vứt mất một
 *   mảng canvas (đo ở PH-46: ô trống lớn nhất cho cảnh MỘT cụm chỉ 233 px so với 430 px).
 *
 * ⇒ Không đụng `vungDungCanvas` (bản 3D neo khung theo mốc đo sống + hai đối chứng dương
 *   PH-46/47). Đổi **CHỖ NEO** của bản 2D cho **khớp luật bản 3D**: căn giữa theo chiều ngang,
 *   **neo đáy**, chừa `leDayPx` cho nhãn treo dưới biểu tượng. Không mất một pixel tỉ lệ nào —
 *   phần bù chỉ lấy từ chỗ trống vốn đã có.
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

/**
 * Cách đặt nội dung bên trong vùng dùng được.
 *
 * ★ Chỉ có MỘT tuỳ chọn, và nó là một con số có nghĩa vật lý — không phải một cờ bật/tắt kiểu
 *   neo: luật neo (giữa-ngang + đáy) là **quyết định**, không phải sở thích của người gọi.
 */
export interface NeoBan2D {
  /**
   * Lề px chừa ở **ĐÁY** vùng dùng được cho nhãn treo dưới biểu tượng.
   *
   * Cùng vai trò với `LE_VUNG_DUNG_PX` của bản 3D, và người gọi nên truyền đúng hằng ấy:
   * nhãn cụm là DOM cao 22 px neo dưới mép, ôm sát đáy vùng ⇒ nhãn rơi ra ngoài và bị ẩn.
   */
  leDayPx?: number;
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
  neo?: NeoBan2D | null,
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

  /*
   * Lề đáy bị KẸP ở nửa bề cao vùng: một lề lớn hơn cả vùng sẽ làm `caoConLai <= 0` và ném
   * `k` thành `Infinity`. Kẹp thay vì trả `null` là cố ý — lề là chuyện trang trí, không đáng
   * để làm trắng cả cảnh; còn kẹp ở NỬA thì tệ nhất cũng chỉ thu nội dung một nửa.
   */
  const leDay = Number.isFinite(neo?.leDayPx) ? Math.max(0, Math.min(neo!.leDayPx!, caoVung / 2)) : 0;
  const caoConLai = caoVung - leDay;
  if (!(caoConLai > 0)) return null;

  const k = Math.min(rongVung / rongNoiDung, caoConLai / sauNoiDung);
  if (!(k > 0) || !Number.isFinite(k)) return null;

  /*
   * Chỗ trống còn lại sau khi khớp: chia đôi theo NGANG (căn giữa), dồn hết về TRÊN theo DỌC
   * (tức neo đáy). Đúng luật bản 3D — xem docblock đầu tệp.
   */
  const duX = rongVung - rongNoiDung * k;
  const duZ = caoConLai - sauNoiDung * k;

  return {
    x: xMin - (trai + duX / 2) / k,
    z: zMin - (tren + duZ) / k,
    rong: rongPx / k,
    sau: caoPx / k,
  };
}
