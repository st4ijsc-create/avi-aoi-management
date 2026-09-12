/**
 * locBadge.ts — KHỬ CHỒNG LẤN màn hình cho badge cảnh báo (§10.3 luật 3).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY TỒN TẠI — SỐ ĐO, KHÔNG PHẢI LINH CẢM
 * ════════════════════════════════════════════════════════════════════════════
 * QA Đợt 5 đo bbox DOM thật trên `/twin`: **11 cặp chồng trên 9 badge**, trong đó
 * 4 badge của cùng một máy (`SIM-L1-AOI`) đè lên nhau tới mức không đọc nổi chữ
 * nào. Cùng lúc đó `data-so-an` khai **0** — tức lớp badge đang khai "không giấu
 * cái gì cả" trong khi bốn cảnh báo bị che.
 *
 * Nguyên nhân: `LopCanhBao` chỉ `sort` (theo mức độ) rồi `slice(0, 12)`. Đó là
 * phép chọn theo ƯU TIÊN, KHÔNG phải phép khử chồng lấn theo KHÔNG GIAN. Hai máy
 * cạnh nhau trên mặt bằng chiếu ra hai điểm cách nhau vài pixel, và không có gì
 * trong đường đó biết điều ấy.
 *
 * ⇒ Nghịch lý cay đắng: lớp NHÃN máy (`locNhan.ts`) — lớp thông tin ÍT quan
 *   trọng nhất — **có** khử chồng lấn bbox từ đợt trước, còn lớp CẢNH BÁO — lớp
 *   an toàn, lớp mà §10.3 luật 3 viết riêng cho — là lớp DUY NHẤT không có. Lớp
 *   được bảo vệ kỹ nhất trên giấy lại là lớp trần trụi nhất trong mã.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI BÀI HỌC ĐƯỢC MANG THẲNG TỪ `locNhan.ts` SANG
 * ════════════════════════════════════════════════════════════════════════════
 * **G7 — HÌNH CHỮ NHẬT, KHÔNG PHẢI BÁN KÍNH TRÒN.** Bản đầu của `locNhan` so
 * khoảng cách tâm với một bán kính cố định, tức mô hình hoá nhãn thành đường
 * tròn. Nhãn thật rộng gấp ~9 lần chiều cao, nên hai nhãn "ngoài bán kính" vẫn
 * chồng ngang 66px. Không có bán kính nào đúng cho cả hai chiều: nới đủ rộng thì
 * giết oan các phần tử xếp chồng DỌC. Phải đổi HÌNH, không đổi SỐ. Badge cũng là
 * hộp chữ nhật dẹt (`padding 3px 6px`, `fontSize 11`, `whiteSpace: nowrap`), nên
 * nó thừa hưởng nguyên vẹn bài học ấy.
 *
 * **BỘ ĐẾM PHẢI ĐẾM ĐẦU RA, KHÔNG ĐẾM ĐẦU VÀO.** "Số badge BỊ LOẠI" và "số cặp
 * CÒN chồng trên màn" là hai đại lượng khác nhau, và chính chỗ lẫn hai đại lượng
 * này là gốc của lời khai `chongLap = 0` sai trước đây. Ở đây
 * {@link demCapChongLapBadge} quét toàn bộ cặp trong ĐẦU RA — nó là dụng cụ đo
 * độc lập với thuật toán, nên nó có thể BÁC BỎ thuật toán.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ MỘT KHÁC BIỆT VỚI `locNhan` KHÔNG ĐƯỢC CHÉP NHẦM: ĐIỂM NEO
 * ════════════════════════════════════════════════════════════════════════════
 * Nhãn máy dùng `translate(-50%, -100%)` ⇒ (x, y) là điểm giữa CẠNH DƯỚI.
 * Badge cảnh báo dùng `translate(-50%, -50%)` ⇒ (x, y) là TÂM hộp.
 * Dùng nhầm công thức của bên kia làm mọi hộp lệch nửa chiều cao — và lệch đúng
 * theo hướng khiến bộ đếm báo THIẾU chồng lấp, tức là hỏng một cách CÂM. Vì thế
 * module này có `hopBadge` riêng thay vì import `hopNhan`.
 *
 * ★ Thuần .ts: không three, không react ⇒ test được ở `environment: "node"`.
 */

import { haiHopChongNhau, hopTrongKhung, type HinhChuNhat, type KhungCanvasPx } from "../loi/locNhan";

/**
 * Kích thước SUY ĐOÁN của một badge chưa đo được, pixel.
 *
 * Suy từ CSS thật của `LopCanhBao.tsx`: `fontSize 11`, `lineHeight 1`,
 * `padding: "3px 6px"`, `gap: 4`, nội dung = ký tự hình dạng + nhãn ngắn.
 * ⇒ cao ≈ 11 + 3×2 = 17; rộng ≈ 6×2 + 11 (ký tự hình) + 4 (gap) + ~9 ký tự nhãn
 *   × ~6px ≈ 81. Lấy tròn 84×18.
 *
 * ⚠ Lấy trị GIỮA dải chứ không lấy cận trên — cùng lý do như `RONG_SUY_DOAN_PX`
 *   của `locNhan`: suy đoán quá rộng giết oan badge ở khung ĐẦU TIÊN, và badge
 *   đó rồi không bao giờ được render để đo thật ⇒ tự khoá mình. Ở khung sau
 *   người gọi đã có `rongPx`/`caoPx` THẬT và trị suy đoán hết vai trò.
 */
export const RONG_BADGE_SUY_DOAN_PX = 84;
export const CAO_BADGE_SUY_DOAN_PX = 18;

/** Một badge ứng viên, đã được người gọi chiếu sang toạ độ MÀN HÌNH (pixel). */
export interface BadgeUngVien {
  /** Khoá ổn định — `andon_events.id`. */
  id: number;
  /** Toạ độ màn hình của TÂM badge, pixel. */
  x: number;
  y: number;
  /**
   * Điểm ưu tiên đã tính sẵn bởi người gọi (mức độ + đã-ack). CAO hơn = giữ
   * trước. Truyền vào thay vì tính ở đây để module này không phải biết về
   * `MucCanhBao` — thứ tự ưu tiên là chính sách của `LopCanhBao`.
   */
  diemUuTien: number;
  /**
   * Badge đã bị KẸP VỀ RÌA vì alarm nằm ngoài khung (luật 3).
   *
   * ★★★ Badge ngoài khung KHÔNG BAO GIỜ bị loại vì chồng lấn. Chúng bị kẹp về
   * cùng một dải rìa hẹp nên chúng chồng nhau là chuyện đương nhiên; loại chúng
   * đi là làm ĐÚNG cái mà luật 3 cấm — để một alarm biến mất khỏi màn hình vì
   * góc camera.
   */
  ngoaiKhung?: boolean;
  /** Bề rộng thật, px — `getBoundingClientRect` của badge đã render. */
  rongPx?: number;
  /** Bề cao thật, px. */
  caoPx?: number;
  /**
   * ★★★ Đợt 47 (N1) — ƯU TIÊN TUYỆT ĐỐI (badge ĐỎ = sự cố): KHÔNG BAO GIỜ bị giấu khi
   * còn chỗ. Bị lớp phủ che / chồng hộp ⇒ dời tới ô trống GẦN NHẤT trên toàn canvas
   * (`oTrongGanNhat`), không dừng ở vài bước dời như badge thường. Người gọi cũng phải
   * cho nó `diemUuTien` cao hơn mọi badge thường — cờ này chỉ nói về "khi hết chỗ".
   */
  uuTienTuyetDoi?: boolean;
}

/** Một badge ĐÃ được chọn vẽ — toạ độ có thể đã DỜI khỏi neo (Đợt 47). */
export interface BadgeDuocVe extends BadgeUngVien {
  /** true ⇒ `x`/`y` KHÁC neo thật (`xGoc`/`yGoc`) — vẽ mũi tên chỉ về neo. */
  doiCho: boolean;
  xGoc: number;
  yGoc: number;
  /** Hộp ĐÃ DÙNG để khử chồng BADGE×BADGE và e2e đối chiếu. `null` khi ngoài khung (được MIỄN phép khử chồng). */
  hop: HinhChuNhat | null;
  /**
   * ★★★ ĐỢT 53 (QA lần 8, SAI #1) — HỘP THẬT SỰ CHIẾM PIXEL TRÊN MÀN. LUÔN có, kể cả `ngoaiKhung`.
   *
   * Vì sao phải là MỘT TRƯỜNG KHÁC `hop`, không phải "bỏ `null` đi": hai câu hỏi khác nhau đi qua
   * cùng một trường và đã trộn vào nhau suốt 6 đợt.
   *   1. *"badge này có được tính khi khử chồng badge×badge không?"* → `hop` (`null` = MIỄN, vì badge
   *      bị kẹp rìa chồng nhau là hành vi ĐÚNG theo §10.3 luật 3 — thà chồng còn hơn biến mất).
   *   2. *"badge này che mất bao nhiêu pixel của lớp KHÁC?"* → `hopManHinh`. Badge kẹp rìa **vẫn vẽ
   *      bằng DOM, vẫn z-index 30, vẫn đè lên nhãn bên dưới**. Nó được miễn câu 1, KHÔNG được miễn câu 2.
   *
   * Đo được (`.qa-dot53/probe/truoc/tong.json`, dist trên 3053, `e2e_tai_loE`): `/twin/may/18` — máy
   * ĐANG có 1 cảnh báo mở — badge `badge-canh-bao-11` có `data-ngoai-khung="1"` ⇒ `hop = null` ⇒
   * `LopCanhBao` lọc nó khỏi sổ `hopDaVe` ⇒ `LopNhan.__demNhan.soHopBadge = **0**` trong khi
   * `__demBadge.ve = **1**`. Lớp nhãn KHÔNG BIẾT badge tồn tại ⇒ không nhường ⇒ badge (z 30) đè nhãn
   * tên máy (z 20) **1 584 px² = 35 %** @1600 và **744 px² = 17 %** @1280, cả vi lẫn en (4/4 ca).
   *
   * ⚠ Đối chứng trong CÙNG phép đo, thứ bác bỏ giả thuyết "màn Máy thiếu chính sách": `/twin` cho
   *   `soHopBadge = 7` = `__demBadge.ve = 7` và Line cho `2 = 2` — chính sách CÓ ĐỦ ở cả ba màn; thứ
   *   thiếu là HỘP của badge bị kẹp rìa. Ở `/twin`/Line hôm nay không badge nào bị kẹp nên lỗi câm.
   */
  hopManHinh: HinhChuNhat;
}

/**
 * Hộp bao MÀN HÌNH của một badge — phải khớp CSS thật của `LopCanhBao.tsx`.
 *
 * ★ `transform: translate(-50%, -50%)` ⇒ (x, y) là TÂM, nên hộp trải ĐỀU hai
 *   phía trên cả hai trục. Khác `hopNhan` của `locNhan` (neo cạnh dưới).
 */
export function hopBadge(
  b: Pick<BadgeUngVien, "x" | "y" | "rongPx" | "caoPx">,
  rongMacDinh = RONG_BADGE_SUY_DOAN_PX,
  caoMacDinh = CAO_BADGE_SUY_DOAN_PX,
): HinhChuNhat {
  const rong = Number.isFinite(b.rongPx) && (b.rongPx as number) > 0 ? (b.rongPx as number) : rongMacDinh;
  const cao = Number.isFinite(b.caoPx) && (b.caoPx as number) > 0 ? (b.caoPx as number) : caoMacDinh;
  return {
    trai: b.x - rong / 2,
    phai: b.x + rong / 2,
    tren: b.y - cao / 2,
    duoi: b.y + cao / 2,
  };
}

export interface KetQuaLocBadge {
  /** Badge được vẽ, đã sắp ưu tiên GIẢM DẦN. Tối đa `tran`. */
  ve: BadgeDuocVe[];
  /**
   * Số badge KHÔNG được vẽ — vì chồng lấn HOẶC vì chạm trần.
   *
   * ⚠ Đây là con số phải đi vào `data-so-an`. Trước bản vá, `data-so-an` chỉ đếm
   *   phần vượt trần và khai `0` trong khi 4 badge bị che — nó đo một đại lượng
   *   KHÁC với đại lượng người đọc tưởng nó đo.
   */
  soAn: number;
  /** Tách riêng để gỡ lỗi: bao nhiêu bị loại vì bbox chồng. */
  soBiChongLap: number;
  /** Tách riêng để gỡ lỗi: bao nhiêu bị loại vì chạm trần. */
  soVuotTran: number;
  /**
   * ★ Đợt 47 (N1) — bị loại vì hộp đè LỚP PHỦ DOM (`vungCam`) hoặc thò khỏi canvas
   * (`khungCanvas`) mà không dời được (badge thường) — QA Đợt 46: 3/4 badge `/twin`
   * @1600 nằm dưới thẻ "Chỉ số", `▲SIM-L1-SPI` (đỏ) che TOÀN BỘ 1.425/1.428 px².
   */
  soBiChe: number;
  /** ★ Đợt 47 (N1) — số badge đã DỜI khỏi neo để tránh lớp phủ / hộp khác. */
  soDoiCho: number;
}

export interface CauHinhLocBadge {
  tran?: number;
  rongSuyDoanPx?: number;
  caoSuyDoanPx?: number;
  /** ★ Đợt 47 (N1) — kích thước canvas (px): hộp badge phải nằm TRỌN trong canvas (như nhãn). */
  khungCanvas?: KhungCanvasPx;
  /**
   * ★ Đợt 47 (N1) — VÙNG CẤM: bbox lớp phủ DOM đè lên canvas (`layVungCam` — `[data-che-nhan]`,
   * cùng nguồn với `LopNhan`). Badge giao vùng cấm = người dùng KHÔNG thấy nó ⇒ không vẽ tại chỗ.
   */
  vungCam?: readonly HinhChuNhat[];
  /**
   * ★ Đợt 47 (N1) — cho phép DỜI badge (xuống/lên/phải/trái ≤ {@link SO_BUOC_DOI_CHO} bước) thay vì
   * giấu khi chồng/bị che; badge `uuTienTuyetDoi` còn được tìm ô trống gần nhất trên cả canvas.
   * Mặc định TẮT để hợp đồng "chồng ⇒ bỏ" của người gọi cũ giữ nguyên; `LopCanhBao` bật.
   */
  doiCho?: boolean;
}

/** Khe hở giữa badge và hộp kề khi dời chỗ, px. */
export const KHE_BADGE_PX = 2;
/**
 * Số bước dời tối đa mỗi hướng cho badge THƯỜNG. Badge đỏ không bị giới hạn này.
 *
 * ★★★ ĐỢT 49 (mục D) — 3 → 6. Đo được ở `/twin`@1280 (QA lần 7, mục 4.2): `tong 7 · ve 5 ·
 * soAn 2 · biChe 2` — hai cảnh báo bị GIẤU vì chạm lớp phủ DOM và 3 bước theo bốn hướng thẳng
 * không thoát được panel. Ngân sách gấp đôi + thêm bốn hướng CHÉO (xem `ungVienDoiCho`) mở
 * thêm chỗ mà không đổi luật ưu tiên nào: badge đỏ vẫn được quét cả canvas, badge thường vẫn
 * dừng ở ngân sách (không trôi tuỳ tiện ra khỏi máy của nó).
 */
export const SO_BUOC_DOI_CHO = 6;

function dichHop(h: HinhChuNhat, dx: number, dy: number): HinhChuNhat {
  return { trai: h.trai + dx, phai: h.phai + dx, tren: h.tren + dy, duoi: h.duoi + dy };
}

/** Hộp có ĐẶT ĐƯỢC không: trọn trong canvas (nếu biết), không đè vùng cấm, không đè hộp đã giữ. */
function datDuoc(
  h: HinhChuNhat,
  khung: KhungCanvasPx | undefined,
  vungCam: readonly HinhChuNhat[],
  hopDaGiu: readonly HinhChuNhat[],
): boolean {
  if (khung && !hopTrongKhung(h, khung)) return false;
  for (const v of vungCam) if (haiHopChongNhau(v, h)) return false;
  for (const g of hopDaGiu) if (haiHopChongNhau(g, h)) return false;
  return true;
}

/**
 * Ứng viên dời chỗ theo khoảng cách TĂNG DẦN: mỗi bước thử LÊN, phải, trái, rồi mới XUỐNG.
 *
 * ★ Xuống SAU CÙNG — đo được (`.qa-dot47/run-probe-nhan47-sau4.log`): bản đầu thử xuống trước
 *   ⇒ badge dời rơi đúng vào chỗ nhãn máy xếp tầng (nhãn neo ngay DƯỚI badge cùng máy) ⇒ `/twin`
 *   1600 chỉ còn 3/6 nhãn máy bất thường, 1280 còn 1/6. Lên giữ trật tự "badge trên nhãn"; ngang
 *   giữ badge cùng hàng với badge kề (đọc thành một dải alarm); xuống là lựa chọn cuối vì nó
 *   đè lên thân máy và tranh chỗ với nhãn.
 */
function* ungVienDoiCho(hop: HinhChuNhat): Generator<HinhChuNhat> {
  const buocDoc = hop.duoi - hop.tren + KHE_BADGE_PX;
  const buocNgang = hop.phai - hop.trai + KHE_BADGE_PX;
  for (let k = 1; k <= SO_BUOC_DOI_CHO; k += 1) {
    yield dichHop(hop, 0, -k * buocDoc);
    yield dichHop(hop, k * buocNgang, 0);
    yield dichHop(hop, -k * buocNgang, 0);
    yield dichHop(hop, 0, k * buocDoc);
    // ★ Đợt 49 (mục D) — CHÉO sau bốn hướng thẳng CÙNG BƯỚC: một panel chắn cả hàng và cả cột
    //   (góc màn) thì bốn hướng thẳng không có đường nào; chéo là ô trống gần nhất còn lại mà
    //   không phải nhảy sang `oTrongGanNhat` (đặc quyền của badge đỏ).
    yield dichHop(hop, k * buocNgang, -k * buocDoc);
    yield dichHop(hop, -k * buocNgang, -k * buocDoc);
    yield dichHop(hop, k * buocNgang, k * buocDoc);
    yield dichHop(hop, -k * buocNgang, k * buocDoc);
  }
}

/**
 * Ô trống GẦN NHẤT trên toàn canvas cho badge ưu tiên tuyệt đối — quét lưới ô cỡ
 * badge, chọn ô đặt được có tâm gần neo nhất. O(số ô × số hộp): ~500 ô × ≤ 20 hộp
 * mỗi khung ĐƯỢC VẼ (`frameloop="demand"`), chỉ khi badge đỏ thật sự hết chỗ quanh neo.
 */
function oTrongGanNhat(
  hop: HinhChuNhat,
  khung: KhungCanvasPx,
  vungCam: readonly HinhChuNhat[],
  hopDaGiu: readonly HinhChuNhat[],
): HinhChuNhat | null {
  const rong = hop.phai - hop.trai;
  const cao = hop.duoi - hop.tren;
  if (!(rong > 0) || !(cao > 0)) return null;
  const cx = (hop.trai + hop.phai) / 2;
  const cy = (hop.tren + hop.duoi) / 2;
  let tot: HinhChuNhat | null = null;
  let dTot = Number.POSITIVE_INFINITY;
  for (let y = 0; y + cao <= khung.cao; y += cao + KHE_BADGE_PX) {
    for (let x = 0; x + rong <= khung.rong; x += rong + KHE_BADGE_PX) {
      const d = Math.hypot(x + rong / 2 - cx, y + cao / 2 - cy);
      if (d >= dTot) continue;
      const h = { trai: x, phai: x + rong, tren: y, duoi: y + cao };
      if (datDuoc(h, khung, vungCam, hopDaGiu)) {
        tot = h;
        dTot = d;
      }
    }
  }
  return tot;
}

/**
 * Lọc badge: sắp ưu tiên → khử chồng lấn BBOX (chỉ badge TRONG khung) → cắt trần.
 *
 * Hàm THUẦN và TẤT ĐỊNH: cùng đầu vào ở bất kỳ thứ tự nào cho cùng đầu ra.
 *
 * ★ HẬU ĐIỀU KIỆN: mọi cặp badge TRONG KHUNG trong `ve` KHÔNG chồng bbox — ghim
 *   bằng {@link demCapChongLapBadge} trong `locBadge.unit.test.ts`.
 *
 * ⚠ Vì sao khử chồng lấn chạy TRƯỚC phép cắt trần (giống `locNhan`): cắt 12
 *   trước rồi mới khử chồng có thể để lại 5 badge hiển thị trong khi 7 suất đã
 *   bị các badge chồng nhau ăn mất.
 */
export function locBadge(
  ungVien: readonly BadgeUngVien[],
  cauHinh: CauHinhLocBadge = {},
): KetQuaLocBadge {
  const tran = cauHinh.tran ?? Infinity;
  const rongMacDinh = cauHinh.rongSuyDoanPx ?? RONG_BADGE_SUY_DOAN_PX;
  const caoMacDinh = cauHinh.caoSuyDoanPx ?? CAO_BADGE_SUY_DOAN_PX;
  const khung = cauHinh.khungCanvas;
  const vungCam = cauHinh.vungCam ?? [];
  const choDoiCho = cauHinh.doiCho === true;

  // Sắp trên BẢN SAO — không làm biến dạng mảng của người gọi. Hoà điểm thì so
  // `id` tăng dần: thiếu nhánh này, hai alarm cùng mức cùng lúc sẽ đổi chỗ ngẫu
  // nhiên mỗi khung, tức badge nhấp nháy.
  const daSap = [...ungVien].sort((a, b) =>
    a.diemUuTien !== b.diemUuTien ? b.diemUuTien - a.diemUuTien : a.id - b.id,
  );

  const ve: BadgeDuocVe[] = [];
  const hopDaGiu: HinhChuNhat[] = [];
  let soBiChongLap = 0;
  let soVuotTran = 0;
  let soBiChe = 0;
  let soDoiCho = 0;

  for (const b of daSap) {
    if (ve.length >= tran) {
      soVuotTran += 1;
      continue;
    }

    // ★ Badge ngoài khung được MIỄN phép khử chồng lấn (xem `ngoaiKhung`), và
    //   cũng KHÔNG góp hộp vào `hopDaGiu` — nếu góp, một chùm badge bị kẹp ở rìa
    //   sẽ dựng một bức tường vô hình giết các badge TRONG khung đi ngang qua đó.
    if (b.ngoaiKhung) {
      // ★ Đợt 53 — `hop` vẫn `null` (miễn khử chồng badge×badge, §10.3 luật 3) NHƯNG `hopManHinh` có
      //   thật: badge kẹp rìa vẫn chiếm pixel và vẫn đè lớp nhãn. Sổ `hopDaVe` đọc `hopManHinh`.
      ve.push({
        ...b,
        doiCho: false,
        xGoc: b.x,
        yGoc: b.y,
        hop: null,
        hopManHinh: hopBadge(b, rongMacDinh, caoMacDinh),
      });
      continue;
    }

    const hop = hopBadge(b, rongMacDinh, caoMacDinh);
    let hopVe: HinhChuNhat | null = datDuoc(hop, khung, vungCam, hopDaGiu) ? hop : null;

    // ★ Đợt 47 (N1) — không đặt được tại neo ⇒ DỜI: vài bước quanh neo; badge đỏ (ưu tiên
    //   tuyệt đối) còn được tìm ô trống gần nhất trên cả canvas — nó không bao giờ bị giấu
    //   khi còn chỗ. Hộp dời cũng phải đặt được (trọn canvas, ngoài vùng cấm, không chồng).
    if (hopVe === null && choDoiCho) {
      for (const thu of ungVienDoiCho(hop)) {
        if (datDuoc(thu, khung, vungCam, hopDaGiu)) {
          hopVe = thu;
          break;
        }
      }
      if (hopVe === null && b.uuTienTuyetDoi && khung) hopVe = oTrongGanNhat(hop, khung, vungCam, hopDaGiu);
    }

    if (hopVe === null) {
      // Phân loại lý do cho cửa sổ đo: bị che/thò mép (lớp phủ, canvas) ≠ chồng badge khác.
      const biChe =
        (khung !== undefined && !hopTrongKhung(hop, khung)) || vungCam.some((v) => haiHopChongNhau(v, hop));
      if (biChe) soBiChe += 1;
      else soBiChongLap += 1;
      continue;
    }

    const doiCho = hopVe !== hop;
    ve.push({
      ...b,
      x: doiCho ? (hopVe.trai + hopVe.phai) / 2 : b.x,
      y: doiCho ? (hopVe.tren + hopVe.duoi) / 2 : b.y,
      doiCho,
      xGoc: b.x,
      yGoc: b.y,
      hop: hopVe,
      hopManHinh: hopVe,
    });
    hopDaGiu.push(hopVe);
    if (doiCho) soDoiCho += 1;
  }

  return {
    ve,
    soAn: soBiChongLap + soVuotTran + soBiChe,
    soBiChongLap,
    soVuotTran,
    soBiChe,
    soDoiCho,
  };
}

/**
 * Đếm số CẶP badge chồng bbox trong một danh sách — dụng cụ ĐO ĐỘC LẬP.
 *
 * ★★★ Tách khỏi `locBadge` có chủ đích và đây là điểm mấu chốt của cả bản vá:
 * `soBiChongLap` đếm ĐẦU VÀO bị loại, hàm này đếm ĐẦU RA còn chồng. Chỉ hàm này
 * mới trả lời được câu hỏi mà §10.3 luật 3 thật sự hỏi — *"trên màn hình lúc này
 * có badge nào che badge nào không?"* — và chỉ nó mới có thể BÁC BỎ `locBadge`.
 * Một bộ đếm sinh ra từ chính thuật toán nó đo thì không bao giờ bác bỏ được
 * thuật toán ấy; đó đúng là cách `chongLap = 0` từng nói dối.
 *
 * ⚠ Badge `ngoaiKhung` được BỎ QUA: chúng bị kẹp vào một dải rìa hẹp nên chồng
 *   nhau là hành vi ĐÚNG theo luật 3 (thà chồng còn hơn biến mất). Tính cả chúng
 *   thì phép đo sẽ báo "hỏng" trên đúng cái hành vi mà spec yêu cầu.
 */
export function demCapChongLapBadge(
  badge: readonly (Pick<BadgeUngVien, "x" | "y" | "rongPx" | "caoPx"> & { ngoaiKhung?: boolean })[],
  rongMacDinh = RONG_BADGE_SUY_DOAN_PX,
  caoMacDinh = CAO_BADGE_SUY_DOAN_PX,
): number {
  const trongKhung = badge.filter((b) => !b.ngoaiKhung);
  const hop = trongKhung.map((b) => hopBadge(b, rongMacDinh, caoMacDinh));
  let so = 0;
  for (let i = 0; i < hop.length; i++) {
    for (let j = i + 1; j < hop.length; j++) {
      if (haiHopChongNhau(hop[i], hop[j])) so += 1;
    }
  }
  return so;
}
