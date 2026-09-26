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
 * ★★★ TRẦN CỦA LUẬT NÀY LÀ MỘT PHÉP CHIA — `qatd_admin` 2D KHÔNG THỂ QUÁ 2/5
 * ════════════════════════════════════════════════════════════════════════════
 * Mọi ứng viên dưới đây đều **bám vào hộp của chính thứ nó gọi tên** (cố ý: một
 * nhãn sai chỗ còn tệ hơn một nhãn vắng mặt). Hệ quả là một điều kiện CẦN thuần
 * số học: nhãn chỉ có chỗ sạch hẳn khi **bề rộng nhãn ≤ bề rộng dải ngang của
 * chính tấm nền nó mà không nằm dưới panel cao suốt khung**.
 *
 * `panel-trai` và `panel-phai` cao ĐÚNG BẰNG khung cảnh (207..696 px trên khung
 * 1280×720), nên không phép trượt DỌC nào thoát khỏi chúng — chỉ còn trục ngang,
 * và trục ngang bị chặn bởi bề rộng tấm nền. Đo @1280×720 khung mặc định
 * (`.qa-tapdoan/zz-nhan2-do1-truoc.json`, 5 cụm — vai duy nhất có 5):
 *
 *   "Nhà máy ảo (SIM)"      dải sạch  51,4 px · nhãn 141,2 px ⇒ THIẾU  89,8 px
 *   "Công ty A"             dải sạch  19,4 px · nhãn  78,2 px ⇒ THIẾU  58,8 px
 *   "Công ty B"             dải sạch  51,4 px · nhãn  76,7 px ⇒ THIẾU  25,3 px
 *   "FUYU-F (tai tong hop)" dải sạch 189,6 px · nhãn 172,1 px ⇒ còn    17,5 px ✓
 *   "Công ty C"             dải sạch 189,6 px · nhãn  77,2 px ⇒ còn   112,4 px ✓
 *
 * ⇒ **Trần là 2/5, không phải một khuyết tật của luật đặt.** Ba tên kia chỉ cứu
 *   được bằng cách đổi thứ khác: (a) dời bố cục sa bàn ra khỏi gầm panel — đã đo
 *   và BÁC BỎ ở trên vì nó bóp bề rộng biểu tượng ở MỌI vai; (b) thu nhỏ chữ
 *   xuống 25–36 % cỡ hiện tại — hết đọc được, tự mâu thuẫn với mục đích; hoặc
 *   (c) cho nhãn rời khỏi nền của nó — phá chính bất biến đang giữ nhãn khỏi
 *   gọi nhầm tên. ⇒ GIỮ "ẩn", nhưng ẩn phải ĐẾM RA **và** có đường đọc lại tên:
 *   xem `<title>` trên tấm nền/khối ở `CanhVanHanh2D.tsx`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LUẬT
 * ════════════════════════════════════════════════════════════════════════════
 * Thử một DANH SÁCH ỨNG VIÊN có thứ tự, lấy chỗ đầu tiên còn trống:
 *   ① neo ưu tiên (trên / dưới / trong — đúng chỗ mà mỗi chế độ đang đặt, nên
 *      cảnh KHÔNG bị dời một pixel nào khi chẳng có gì che);
 *   ② trượt dọc ra khỏi ĐÚNG lớp phủ đang chắn ① (giữ nguyên luật cũ của
 *      `LopSaBan`, chỉ đổi phép thử từ điểm neo sang tâm hộp chữ);
 *   ②' **mỗi neo chính** — không chỉ neo ưu tiên — tự sinh ứng viên trượt của
 *      mình, với trần đo TỪ CHÍNH NÓ (xem §TRẦN TRƯỢT trong thân hàm: đo từ neo
 *      ưu tiên làm hụt một chỗ thoát cách đích 9,0 px vì cú lật trên→dưới đã
 *      tiêu 93,1 px trần);
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

/**
 * Ứng viên tách làm HAI phần, và sự tách ấy là một phép đo chứ không phải gu code:
 * chỉ **neo chính** (`dau`) mới được sinh ứng viên TRƯỢT, vì trượt là phép "né ĐÚNG
 * lớp phủ đang chắn neo này", và trần trượt phải đo TỪ CHÍNH NEO ẤY (xem §TRƯỢT).
 */
function danhSachUngVien(
  hop: HopNhanPx,
  co: CoNhanPx,
  uuTien: UuTienNhan,
): { dau: Array<[MaChoDat, number, number]>; phu: Array<[MaChoDat, number, number]> } {
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
  return {
    dau,
    phu: [
      ["trong-duoi", giuaX, hop.duoi - KHE_NHAN_PX - nuaCao],
      ["trong-tren", giuaX, hop.tren + KHE_NHAN_PX + nuaCao],
      ["tren-phai", hop.phai - nuaRong, yTren],
      ["tren-trai", hop.trai + nuaRong, yTren],
      ["duoi-phai", hop.phai - nuaRong, yDuoi],
      ["duoi-trai", hop.trai + nuaRong, yDuoi],
    ],
  };
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
  const { dau, phu } = danhSachUngVien(hop, co, uuTien);
  const [maDau, xDau, yDau] = dau[0];
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
   * ★★★ LƯỢT ① PHẢI HỎI **CẢ HỘP CHỮ** CÓ TRONG KHUNG KHÔNG — HAZARD DO CHÍNH
   *   BẢN VÁ "TRẦN TRƯỢT" NÀY SINH RA, BẮT ĐƯỢC BẰNG PHÉP ĐO CHỨ KHÔNG BẰNG LÝ LẼ.
   *
   * Ý ĐỊNH của phép thử "trong khung" vốn đã là *"chỗ nào không nhìn thấy thì
   * không phải một chỗ đặt"* — nhưng nó chỉ hỏi TÂM. Chừng nào chưa có ứng viên
   * nào rơi ra rìa thì khe hở ấy không lộ. Bản vá trần trượt sinh thêm ứng viên
   * đúng ở rìa, và khe hở lộ ngay:
   *
   *   `qatd_admin` 2D, nhãn "FUYU-F (tai tong hop) — toa chinh" nhảy lên
   *   `truot` y = 1,4 (gốc canvas). TÂM nằm trong khung (1,4 ≥ 0) nên lượt ①
   *   NHẬN, trong khi hộp chữ cao 17 px trải từ **−7,1** đến 9,9: `<svg>` có
   *   `overflow: hidden` nên **41,8 % chiều cao chữ bị CẮT**. Đo:
   *   nền `de1dc50a` **0/38** nhãn 2D thò khỏi khung · sau vá **1/41**.
   *   Thước "% bị lớp phủ DOM che" báo 0 % — nó mù với mép khung, đúng lớp
   *   "phép đo nói ĐẠT, con mắt nói KHÔNG" mà §⑦ đã một lần trả giá.
   *
   * ⇒ Lượt ① dùng HỘP; lượt ② (dự phòng) giữ TÂM, y như cũ — vẫn đúng lý lẽ
   *   "một nhãn cụt còn hơn một nhãn vắng mặt" khi thật sự không còn chỗ nào.
   * ⚠ `co.rong/cao = 0` (chưa đo được) ⇒ phép thử hộp tự thu về phép thử tâm,
   *   nên đường G8 của jsdom không đổi một dòng.
   */
  const hopTrongKhung = (x: number, y: number) =>
    x - co.rong / 2 >= 0 &&
    x + co.rong / 2 <= khung.rong &&
    y - co.cao / 2 >= 0 &&
    y + co.cao / 2 <= khung.cao;

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
  /*
   * ★★★ TRẦN TRƯỢT ĐO TỪ **CHÍNH NEO ĐANG NÉ**, KHÔNG TỪ NEO ƯU TIÊN.
   *
   * Bản trước sinh ứng viên trượt cho DUY NHẤT `ungVien[0]` (neo ưu tiên) và đo
   * quãng trượt bằng `Math.abs(y - yDau)`. Khi lớp phủ chắn cả neo ưu tiên LẪN
   * neo đối diện, phép trượt cứu neo ĐỐI DIỆN vẫn bị đo từ `yDau` — tức cộng
   * thêm nguyên chiều cao khối + chiều cao nhãn trước khi so với trần 40 px.
   *
   * Đo được, `qatd_kythuat` 3D khung mặc định 1280×720, nhãn "Toà 2" (khối
   * `[356,3..445,1]×[182,7..245,3]`, nhãn 37,7×18,5): thẻ `bang-kpi-noi` chắn cả
   * `tren-giua` (y 167,4) lẫn `duoi-giua` (y 260,6). Chỗ thoát ĐÚNG là
   * `y = 269,6` — cách `duoi-giua` vỏn vẹn **9,0 px**. Nhưng đo từ `yDau` = 167,4
   * thì quãng thành **102,1 px** > 40 ⇒ ứng viên KHÔNG BAO GIỜ được sinh ra, và
   * nhãn rơi xuống lượt quét "chỉ-sạch-tâm" với **15,1 %** thân chữ nằm dưới thẻ.
   * Riêng cú lật `tren`→`duoi` đã tiêu 93,1 px trần trong khi chẳng né được gì.
   *
   * ⇒ Mỗi neo chính tự sinh ứng viên trượt của nó, trần đo từ nó, và chèn NGAY
   *   SAU nó để thứ tự ưu tiên không đổi. Mô phỏng trên hình học đã đo
   *   (`.qa-tapdoan/zz-nhan2-sim.mjs`, 51 nhãn, V0 tái hiện phép đo 0 lệch):
   *   che-một-phần 5 → 4, cứu thêm 2 nhãn (`qatd_kythuat` 2D "Toà 2", 3D "Toà 1"),
   *   **0 hồi quy, 0 nhãn mất**, `ve + an === tong` đúng ở cả 4 ca.
   *
   * ⚠ Neo PHỤ (`phu`) cố ý KHÔNG sinh ứng viên trượt: chúng vốn đã là phương án
   *   dự phòng theo trục ngang, thêm trượt vào đó chỉ nở tổ hợp mà không mua thêm
   *   chỗ nào — và mỗi ứng viên thừa là một chỗ nhãn có thể rơi xa thứ nó gọi tên.
   */
  const ungVien: Array<[MaChoDat, number, number]> = [];
  for (const uv of dau) {
    ungVien.push(uv);
    const [, x, y] = uv;
    const them: Array<[MaChoDat, number, number]> = [];
    const themTruot = (z: HopNhanPx | null) => {
      if (!z) return;
      for (const yy of [z.duoi + KHE_NHAN_PX + co.cao / 2, z.tren - KHE_NHAN_PX - co.cao / 2])
        if (Math.abs(yy - y) <= TRUOT_TOI_DA_PX) them.push(["truot", x, yy]);
    };
    const chanHop = giaoLopPhu(vungCam, x, y, co);
    themTruot(chanHop);
    const chanTam = chePhu(vungCam, x, y);
    if (chanTam && chanTam !== chanHop) themTruot(chanTam);
    ungVien.push(...them);
  }
  ungVien.push(...phu);

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
    if (!hopTrongKhung(x, y)) continue;
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
