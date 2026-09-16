/**
 * datNhanSaBan.ts — **CHỖ ĐẶT NHÃN SA BÀN**, một bộ luật cho CẢ HAI chế độ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO CÓ TỆP NÀY — HAI SỐ ĐO, KHÔNG PHẢI MỘT Ý THÍCH
 * ════════════════════════════════════════════════════════════════════════════
 * ① Bản **2D** cấp tập đoàn không né lớp phủ nào. Đo @1280×720, khung MẶC ĐỊNH,
 *   KHÔNG thu panel (`.qa-tapdoan/n1-truoc.json`): tên công ty đọc được
 *   `qatd_giamdoc` 3/3 · `qatd_quanly` **0/1** · `qatd_kythuat` **0/2** ·
 *   `qatd_congnhan` **0/1**. Tức ở ba trong bốn vai, người dùng **không đọc được
 *   tên công ty nào** — hỏng đúng thứ sa bàn tồn tại để làm.
 *
 * ② Bản **3D** CÓ lớp né, nhưng lớp ấy kiểm che trên **ĐIỂM NEO** (đáy nhãn),
 *   còn thứ người ta đọc là **CẢ HỘP CHỮ**. Trượt xuống `che.duoi + 6` đặt ĐÁY
 *   nhãn dưới thẻ `Metrics`, nên 18,5 px chữ vẫn nằm TRÊN thẻ: đo ở
 *   `qatd_giamdoc` 3D, hai nhãn "Toà 1"/"Toà 3" bị phủ **65,4 %** và **67,6 %**
 *   trong khi `soNhan()` đếm chúng là "vẽ". Đó là lời khai sai mà §4 sinh ra để
 *   chặn.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BA HƯỚNG BỊ PHÉP ĐO BÁC BỎ TRƯỚC KHI VÀO MÃ (`.qa-tapdoan/n3-sim.mjs`)
 * ════════════════════════════════════════════════════════════════════════════
 * · *"Bê lớp né của `LopSaBan` sang 2D"* — bác bỏ bằng `qatd_kythuat`: **0/2**.
 *   Hai nhãn cụm rơi dưới `panel-trai`/`panel-phai`, mà hai panel ấy **cao suốt
 *   khung**; trượt DỌC bao nhiêu cũng không ra khỏi chúng. Chỗ đặt phải đổi theo
 *   **cả hai trục**.
 * · *"Cho khung nhìn biết vùng an toàn cũng ở 2D"* (ép sa bàn vào
 *   `vungDungCanvas`) — mua được `qatd_admin` 2/5 → 5/5, nhưng trả bằng bề rộng
 *   biểu tượng ở MỌI vai: `qatd_kythuat` 148,3 → **75,5 px**, `qatd_giamdoc`
 *   89,9 → 75,5 px, và `qatd_admin` 1,2 → **0,6 px** (vốn đã dưới trần 24 px).
 *   Nó KHÔNG cứu nổi chính vai nó nhắm tới, mà lấy mất pixel của bốn vai kia.
 * · *"Một cụm thì tên công ty lên thanh tiêu đề cảnh"* — chỉ phủ hai vai một
 *   cụm, trong khi luật dưới đây đóng cả bốn vai bằng cùng một lượng công.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LUẬT
 * ════════════════════════════════════════════════════════════════════════════
 * Thử một DANH SÁCH ỨNG VIÊN có thứ tự, lấy chỗ đầu tiên còn trống:
 *   ① neo ưu tiên (trên / dưới / trong — đúng chỗ mà mỗi chế độ đang đặt, nên
 *      cảnh KHÔNG bị dời một pixel nào khi chẳng có gì che);
 *   ② trượt dọc ra khỏi ĐÚNG lớp phủ đang chắn ① (giữ nguyên luật cũ của
 *      `LopSaBan`, chỉ đổi phép thử từ điểm neo sang tâm hộp chữ);
 *   ③ phía đối diện, rồi TRONG hộp, rồi bốn góc của chính hộp ấy.
 * Hết ứng viên ⇒ `null` ⇒ người gọi **ẩn VÀ ĐẾM RA**. Một nhãn biến mất im lặng
 * là lời khai sai; một nhãn sai chỗ còn tệ hơn một nhãn vắng mặt, nên mọi ứng
 * viên đều bám vào hộp của chính thứ nó gọi tên (nở thêm đúng một dòng chữ).
 *
 * ⚠ GIỮ luật cũ **"ẩn theo TÂM, không theo giao-nhau-chút-nào"**: một nhãn chạm
 *   mép panel vẫn đọc được nửa chữ, và ẩn nó đi là mất thông tin thật.
 * ⚠ Thiếu dữ kiện (chưa có bố cục ⇒ cỡ chữ 0, hoặc khung 0×0) ⇒ trả NGUYÊN neo
 *   ưu tiên, không ẩn ai (G8). jsdom không dựng bố cục, nên đây cũng là đường
 *   mà lưới DOM đi.
 */

/** Hộp pixel gốc trái-trên của canvas/svg — cùng quy ước `layVungCam()`. */
export interface HopNhanPx {
  trai: number;
  phai: number;
  tren: number;
  duoi: number;
}

/** Cỡ HỘP CHỮ trên màn (px) — không phải cỡ font. */
export interface CoNhanPx {
  rong: number;
  cao: number;
}

/** Neo ưu tiên: `tren` = nhãn toà, `duoi` = nhãn cụm bản 3D, `trong` = nhãn toà bản 2D. */
export type UuTienNhan = "tren" | "duoi" | "trong";

export type MaChoDat =
  | "tren-giua"
  | "duoi-giua"
  | "trong-giua"
  | "truot"
  | "trong-duoi"
  | "trong-tren"
  | "tren-phai"
  | "tren-trai"
  | "duoi-phai"
  | "duoi-trai";

/** Chỗ đặt = **TÂM hộp chữ** (px gốc canvas/svg) + tên ứng viên đã chọn. */
export interface ChoDatNhan {
  x: number;
  y: number;
  ma: MaChoDat;
}

/** Khe giữa nhãn và mép hộp nó gọi tên (px). */
export const KHE_NHAN_PX = 6;

/**
 * Trượt dọc tối đa (px). Xa hơn thì nhãn rời khỏi thứ nó gọi tên — giữ đúng con
 * số của `LopSaBan` trước bản vá để phần hành vi cũ không đổi.
 */
export const TRUOT_TOI_DA_PX = 40;

const chePhu = (vungCam: readonly HopNhanPx[], x: number, y: number): HopNhanPx | null =>
  vungCam.find((z) => x >= z.trai && x <= z.phai && y >= z.tren && y <= z.duoi) ?? null;

/** Lớp phủ ĐẦU TIÊN giao với hộp chữ (tâm `x,y`, cỡ `co`) — dù chỉ một pixel. */
function giaoLopPhu(
  vungCam: readonly HopNhanPx[],
  x: number,
  y: number,
  co: CoNhanPx,
): HopNhanPx | null {
  const trai = x - co.rong / 2;
  const phai = x + co.rong / 2;
  const tren = y - co.cao / 2;
  const duoi = y + co.cao / 2;
  return vungCam.find((z) => z.trai < phai && z.phai > trai && z.tren < duoi && z.duoi > tren) ?? null;
}

function danhSachUngVien(
  hop: HopNhanPx,
  co: CoNhanPx,
  uuTien: UuTienNhan,
): Array<[MaChoDat, number, number]> {
  const giuaX = (hop.trai + hop.phai) / 2;
  const giuaY = (hop.tren + hop.duoi) / 2;
  const nuaCao = co.cao / 2;
  const nuaRong = co.rong / 2;
  const yTren = hop.tren - KHE_NHAN_PX - nuaCao;
  const yDuoi = hop.duoi + KHE_NHAN_PX + nuaCao;
  const oTren: [MaChoDat, number, number] = ["tren-giua", giuaX, yTren];
  const oDuoi: [MaChoDat, number, number] = ["duoi-giua", giuaX, yDuoi];
  const oTrong: [MaChoDat, number, number] = ["trong-giua", giuaX, giuaY];
  const dau: Array<[MaChoDat, number, number]> =
    uuTien === "tren" ? [oTren, oDuoi] : uuTien === "duoi" ? [oDuoi, oTren] : [oTrong, oTren, oDuoi];
  return [
    ...dau,
    ["trong-duoi", giuaX, hop.duoi - KHE_NHAN_PX - nuaCao],
    ["trong-tren", giuaX, hop.tren + KHE_NHAN_PX + nuaCao],
    ["tren-phai", hop.phai - nuaRong, yTren],
    ["tren-trai", hop.trai + nuaRong, yTren],
    ["duoi-phai", hop.phai - nuaRong, yDuoi],
    ["duoi-trai", hop.trai + nuaRong, yDuoi],
  ];
}

/**
 * Chọn chỗ đặt nhãn cho một hộp (khối toà / tấm nền cụm) đã chiếu ra px.
 *
 * @param hop     bao hình MÀN HÌNH của thứ nhãn gọi tên
 * @param co      cỡ HỘP CHỮ trên màn; `0` = chưa đo được ⇒ trả neo ưu tiên
 * @param vungCam bbox THẬT của lớp phủ DOM (`layVungCam` — cùng nguồn cả hai chế độ)
 * @param khung   cỡ canvas/svg; `0` = chưa có bố cục ⇒ trả neo ưu tiên
 * @returns TÂM hộp chữ, hoặc `null` khi không chỗ nào thoát ⇒ ẩn **và đếm ra**
 */
export function datNhanSaBan(
  hop: HopNhanPx,
  co: CoNhanPx,
  vungCam: readonly HopNhanPx[],
  khung: { rong: number; cao: number },
  uuTien: UuTienNhan,
): ChoDatNhan | null {
  const ungVien = danhSachUngVien(hop, co, uuTien);
  const [maDau, xDau, yDau] = ungVien[0];
  // G8 — thiếu dữ kiện thì KHÔNG được ẩn ai, cũng không được bịa một chỗ "gần đúng".
  if (!(khung.rong > 0) || !(khung.cao > 0)) return { x: xDau, y: yDau, ma: maDau };

  /*
   * ★ Phép thử "trong khung" chạy KỂ CẢ khi không có lớp phủ nào. Trước bản vá,
   *   nhãn của một khối sát mép chỉ đơn giản được đặt ở toạ độ ÂM: nó vô hình mà
   *   vẫn được `soNhan()` đếm là "vẽ" — cùng lớp lời khai sai với chuyện nhãn nằm
   *   dưới thẻ `Metrics`. Chỗ nào không nhìn thấy thì không phải một chỗ đặt.
   */
  const trongKhung = (x: number, y: number) => x >= 0 && x <= khung.rong && y >= 0 && y <= khung.cao;

  /*
   * ② Trượt dọc khỏi ĐÚNG lớp phủ đang chắn ứng viên đầu — chèn ngay sau nó.
   *
   * ★★★ CHẶN THEO **HỘP CHỮ**, KHÔNG CHỈ THEO TÂM. Bản trước chỉ sinh ứng viên
   *   trượt khi TÂM bị che, nên một nhãn có tâm nằm ngay dưới mép thẻ mà thân chữ
   *   còn nằm trên thẻ thì **không ai đề nghị dời nó đi đâu cả**: đo được ở
   *   `qatd_kythuat` 3D, nhãn "Công ty A" bị thẻ `Metrics` ăn **22,7 %** (5 px
   *   trên cùng của hộp chữ 22 px) mà vẫn được giữ nguyên chỗ. Lượt quét ① hỏi
   *   "hộp có sạch hẳn không", nên nguồn sinh ứng viên của nó cũng phải hỏi bằng
   *   HỘP. Cả hai nguồn đều được chèn: cái nào cho chỗ tốt hơn thì lượt quét ①
   *   nhận trước.
   */
  const them: Array<[MaChoDat, number, number]> = [];
  const themTruot = (z: HopNhanPx | null) => {
    if (!z) return;
    for (const y of [z.duoi + KHE_NHAN_PX + co.cao / 2, z.tren - KHE_NHAN_PX - co.cao / 2])
      if (Math.abs(y - yDau) <= TRUOT_TOI_DA_PX) them.push(["truot", xDau, y]);
  };
  const chanHop = giaoLopPhu(vungCam, xDau, yDau, co);
  themTruot(chanHop);
  const chanTam = chePhu(vungCam, xDau, yDau);
  if (chanTam && chanTam !== chanHop) themTruot(chanTam);
  if (them.length > 0) ungVien.splice(1, 0, ...them);

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ HAI LƯỢT QUÉT — VÀ LƯỢT ĐẦU SINH RA TỪ MỘT LẦN TỰ XEM ẢNH
   * ════════════════════════════════════════════════════════════════════════
   * Bản đầu của hàm này chỉ có lượt ②: "nhận chỗ nào TÂM hộp chữ không bị che",
   * đúng luật `ẩn theo TÂM` mà `LopSaBan` đã ghi. Đo xong thì mọi ô đều xanh —
   * nhưng ảnh `anh/n1-sau/qatd_quanly-2d-toan-man.png` đọc ra **"ng ty A"**:
   * nhãn "Công ty A" bị thẻ `Metrics` ăn mất **24,3 %** bên trái, tức đúng hai
   * chữ đầu. Tâm sạch, chữ thì cụt. Phép đo nói ĐẠT, con mắt nói KHÔNG.
   *
   * ⇒ Tách hai câu hỏi mà luật cũ trộn làm một:
   *   ① ĐẶT Ở ĐÂU — ưu tiên chỗ hộp chữ **không giao một pixel nào** với lớp phủ.
   *   ② KHI NÀO ẨN — vẫn theo TÂM, y như cũ. Chỉ khi KHÔNG còn chỗ nào sạch hẳn
   *     mới nhận một chỗ chỉ-sạch-tâm; một nhãn cụt vẫn hơn một nhãn vắng mặt,
   *     và ẩn thứ chỉ chạm mép là mất thông tin thật (lý lẽ cũ giữ nguyên).
   * Lượt ① không bao giờ ẩn thêm ai so với lượt ②, nên nó chỉ có thể làm tốt lên.
   */
  for (const [ma, x, y] of ungVien) {
    if (!trongKhung(x, y)) continue;
    if (giaoLopPhu(vungCam, x, y, co)) continue;
    return { x, y, ma };
  }
  for (const [ma, x, y] of ungVien) {
    if (!trongKhung(x, y)) continue;
    if (chePhu(vungCam, x, y)) continue;
    return { x, y, ma };
  }
  return null;
}
