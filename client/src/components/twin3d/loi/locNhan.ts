/**
 * locNhan.ts — declutter nhãn không gian màn hình, CAP CỨNG 30 nhãn DOM (§4).
 *
 * Vì sao module này tồn tại: đo được rằng **300 nhãn CSS2D đã "laggy"**, và
 * `troika-three-text` tốn 1 draw call mỗi nhãn. Không thư viện nào cứu được —
 * phải CULL. Cull mới là cách sửa, không phải chọn thư viện.
 *
 * Thuần .ts: KHÔNG import three, KHÔNG import react. Người gọi (LopNhan.tsx) đã
 * chiếu 3D → toạ độ màn hình rồi mới đưa vào đây, nên hàm này test được trong
 * `environment: "node"` mà không cần WebGL.
 *
 * Bốn luật, theo thứ tự:
 *   1. Nhãn ngoài khung / sau lưng camera bị loại NGAY (không tốn suất).
 *   2. Ưu tiên: đang chọn > đang bất thường > hover > gần camera.
 *   3. Nhãn chồng HÌNH CHỮ NHẬT với một nhãn đã giữ → bỏ cái ưu tiên thấp hơn.
 *      3b (Đợt 35, opt-in `xepTang`) → trước khi bỏ, thử ĐẨY LÊN ≤ 2 tầng.
 *   4. Sau cùng cắt về `TRAN_NHAN_DOM` (30).
 *   (Đợt 35) Trước luật 3: hộp phải TRỌN trong canvas (`khungCanvas`) và không
 *   đè lớp phủ DOM (`vungCam`) — hai cửa này không tốn suất, không giữ chỗ.
 *
 * ⚠ Luật 3 chạy TRƯỚC luật 4 có chủ đích: nếu cắt 30 trước rồi mới khử chồng,
 * ta có thể còn 8 nhãn hiển thị trong khi 22 suất bị các nhãn chồng nhau ăn mất.
 *
 * ★★★ LUẬT 3 DÙNG BBOX, KHÔNG DÙNG ĐƯỜNG TRÒN — và đây là bản VÁ một lời khai sai.
 * Bản đầu so khoảng cách TÂM với bán kính cố định 42px, tức mô hình nhãn là ĐƯỜNG
 * TRÒN đường kính 84px. Nhãn thật là HÌNH CHỮ NHẬT rộng 112–198px (đo bằng
 * `getBoundingClientRect` trên màn thật), nên hai nhãn cách tâm 100px — ngoài
 * bán kính, "không chồng" theo mô hình cũ — vẫn chồng ngang tới 66px và chữ che
 * nhau không đọc được. QA đo được **5 cặp chồng thật trong khi `__demNhan.chongLap`
 * báo 0**: bộ đếm không sai về số học, mô hình của nó sai về hình.
 *
 * Vì sao đường tròn KHÔNG cứu được bằng cách nới bán kính: nhãn rộng ~180px và
 * cao ~20px, tỉ lệ gần 9:1. Một đường tròn phủ hết bề rộng thì cũng phủ 180px
 * theo CHIỀU DỌC — giết oan các nhãn xếp chồng dọc vốn đọc được hoàn toàn. Không
 * có bán kính nào đúng cho cả hai chiều; phải đổi HÌNH, không phải đổi SỐ.
 *
 * `banKinhVaChamPx` GIỮ LẠI làm bề rộng/cao SUY ĐOÁN khi người gọi chưa đo được
 * kích thước thật (khung đầu tiên, trước khi DOM tồn tại) — xem {@link hopNhan}.
 */

/** Trần cứng số nhãn DOM đồng thời (§4 — bảng ngân sách hiệu năng). */
export const TRAN_NHAN_DOM = 30;

/**
 * Bán kính va chạm mặc định, PIXEL màn hình.
 *
 * ⚠ CÒN LẠI vì tương thích: từ bản vá bbox, trị này chỉ dùng để SUY ĐOÁN kích
 * thước một nhãn chưa đo được (bề rộng `2 × 42 = 84`, bề cao `RONG_MAC_DINH...`
 * — xem {@link hopNhan}), chứ không còn là bán kính đường tròn nữa.
 */
export const BAN_KINH_VA_CHAM_PX = 42;

/**
 * Kích thước SUY ĐOÁN của một nhãn chưa đo được, pixel.
 *
 * Đo trên màn thật (`getBoundingClientRect`, 2026-09-06): nhãn thật rộng 112–198px
 * và cao ~22px. `RONG_SUY_DOAN_PX` lấy 150 — giữa dải đo được, KHÔNG lấy 198 (cận
 * trên) vì suy đoán quá rộng sẽ giết oan nhãn ở khung đầu tiên rồi nhãn đó không
 * bao giờ được render để đo thật, tự khoá mình. Ở khung thứ hai người gọi đã có
 * số đo THẬT và trị suy đoán này hết vai trò.
 */
export const RONG_SUY_DOAN_PX = 150;
export const CAO_SUY_DOAN_PX = 22;

/**
 * ★★★ ĐỢT 38 (Pareto #7 QA Đợt 37) — BỀ RỘNG ƯỚC LƯỢNG THEO CHỮ cho nhãn CHƯA ĐO ĐƯỢC.
 *
 * Gốc rễ đo được ở `/twin/line/2` 1280×720 (`.qa-dot38/sau/p7-line-2-1280x720.json`): sau khi rút tiền tố chung
 * nhãn chỉ còn 97–144 px, mà 4/12 vẫn bị giấu. `LopNhan` chỉ có số đo THẬT (`getBoundingClientRect`) của nhãn ĐÃ
 * TỪNG được vẽ; nhãn chưa từng vẽ nhận {@link RONG_SUY_DOAN_PX} = 150 — bề rộng của nhãn CŨ (chưa rút tiền tố) —
 * nên ở mọi khung nó "rộng 150" ⇒ chồng ⇒ không được vẽ ⇒ không bao giờ được đo ⇒ **tự khoá mình**. Đúng cái bẫy mà
 * docblock `RONG_SUY_DOAN_PX` đã cảnh báo, chỉ là 150 nay quá rộng so với chữ thật.
 *
 * Ước lượng từ CHỮ (font 12 px / 600, đệm 2×8): đo 11 nhãn thật ⇒ 6,4–7,1 px/ký tự. Lấy **7,2 px/ký tự + 16 px** —
 * CẬN TRÊN nhẹ (+0…13 %): thà rộng hơn thật một chút (bỏ oan hiếm) còn hơn hẹp hơn thật (hai nhãn ĐÈ nhau, vi phạm
 * hậu điều kiện "0 cặp chồng"). Khung sau đã có số đo thật, trị này hết vai trò — như `RONG_SUY_DOAN_PX`.
 */
export const PX_MOI_KY_TU_NHAN = 7.2;
export const DEM_NGANG_NHAN_PX = 16;
export function uocLuongRongNhanPx(chu: string): number {
  return Math.round(DEM_NGANG_NHAN_PX + chu.length * PX_MOI_KY_TU_NHAN);
}

/**
 * Một nhãn ứng viên, đã được người gọi chiếu sang toạ độ MÀN HÌNH (pixel).
 * Gốc toạ độ là góc trên-trái của canvas.
 */
export interface NhanUngVien {
  /** Khoá ổn định (thường `machine:42`) — dùng làm React key và để so sánh tất định. */
  khoa: string;
  /** Toạ độ màn hình, pixel. */
  x: number;
  y: number;
  /** Khoảng cách từ camera tới vật thể, MÉT. Càng nhỏ càng ưu tiên. */
  khoangCachMet: number;
  /** Vật thể này đang được chọn. */
  dangChon?: boolean;
  /** Vật thể này đang bất thường (error / andon) — NT-2: alarm không được giấu. */
  batThuong?: boolean;
  /** Con trỏ đang rê lên vật thể này. */
  hover?: boolean;
  /**
   * Nhãn nằm sau lưng camera hoặc ngoài khung nhìn — người gọi tự tính
   * (`ndc.z > 1` hoặc |ndc.x|>1). Bị loại ngay, không tốn suất.
   */
  ngoaiKhung?: boolean;
  /**
   * Bề RỘNG thật của nhãn, pixel — người gọi đo bằng `getBoundingClientRect` của
   * div nhãn đã render. Thiếu ⇒ dùng {@link RONG_SUY_DOAN_PX}.
   */
  rongPx?: number;
  /** Bề CAO thật của nhãn, pixel. Thiếu ⇒ dùng {@link CAO_SUY_DOAN_PX}. */
  caoPx?: number;
}

/** Hình chữ nhật màn hình, đơn vị pixel, gốc góc trên-trái canvas. */
export interface HinhChuNhat {
  trai: number;
  phai: number;
  tren: number;
  duoi: number;
}

/**
 * Hộp bao MÀN HÌNH của một nhãn — phải khớp CSS thật của `LopNhan.tsx`.
 *
 * ★ Neo nhãn KHÔNG phải tâm hộp: div nhãn có `left: x; top: y` cộng
 * `transform: translate(-50%, -100%)`, nghĩa là (x, y) là điểm giữa CẠNH DƯỚI.
 * Vì thế hộp trải ngang ±rộng/2 quanh x, nhưng trải dọc từ `y - cao` tới `y` —
 * hoàn toàn ở PHÍA TRÊN điểm neo. Dùng nhầm y làm tâm dọc thì mọi phép so lệch
 * nửa chiều cao, và lệch đúng theo hướng làm bộ đếm báo THIẾU chồng lấp.
 */
export function hopNhan(
  n: Pick<NhanUngVien, "x" | "y" | "rongPx" | "caoPx">,
  rongMacDinh = RONG_SUY_DOAN_PX,
  caoMacDinh = CAO_SUY_DOAN_PX,
): HinhChuNhat {
  const rong = Number.isFinite(n.rongPx) && (n.rongPx as number) > 0 ? (n.rongPx as number) : rongMacDinh;
  const cao = Number.isFinite(n.caoPx) && (n.caoPx as number) > 0 ? (n.caoPx as number) : caoMacDinh;
  return {
    trai: n.x - rong / 2,
    phai: n.x + rong / 2,
    tren: n.y - cao,
    duoi: n.y,
  };
}

/**
 * Hai hình chữ nhật có chồng nhau không (chạm mép KHÔNG tính là chồng).
 *
 * Dùng `<` chứ không `<=`: hai nhãn kề sát mép nhau đọc được bình thường, giết
 * một cái đi là mất thông tin không đổi lại được gì.
 */
export function haiHopChongNhau(a: HinhChuNhat, b: HinhChuNhat): boolean {
  return a.trai < b.phai && b.trai < a.phai && a.tren < b.duoi && b.tren < a.duoi;
}

/** Kích thước canvas, pixel — để hộp nhãn phải nằm TRỌN trong canvas. */
export interface KhungCanvasPx {
  rong: number;
  cao: number;
}

/**
 * Hộp nhãn có nằm TRỌN trong canvas không (chạm mép được tính là trong).
 *
 * ★★★ ĐỢT 35 (Pareto #5) — VÌ SAO "TRỌN", KHÔNG PHẢI "TÂM TRONG":
 *   `LopNhan` cũ cho vẽ nhãn có neo lệch tới **±10 %** ra ngoài mép canvas
 *   (`mh.x < -0.1 * size.width` mới coi là ngoài). Một nhãn neo ở x = −5 % là
 *   một cái tên bị cắt nửa — người đọc thấy "…L2-CON" và không biết đó là máy
 *   nào. Nhãn không vẽ trọn được là nhãn KHÔNG ĐỌC ĐƯỢC ⇒ không vẽ, và đếm vào
 *   "bị giấu" để chip nói ra.
 */
export function hopTrongKhung(hop: HinhChuNhat, khung: KhungCanvasPx): boolean {
  return hop.trai >= 0 && hop.tren >= 0 && hop.phai <= khung.rong && hop.duoi <= khung.cao;
}

/**
 * ★★★ ĐỢT 35 (Pareto #5) — XẾP TẦNG: số tầng tối đa một nhãn được đẩy LÊN để tránh chồng.
 *
 * Đo sau khi khớp khung 12/12 máy (`.qa-dot35/sau-B/e4-*`): camera lùi để cả chuyền
 * lọt khung ⇒ 12 nóc máy xếp gần như cùng một hàng ngang ⇒ nhãn (150–190 px) của
 * máy kề nhau CHỒNG ngang ⇒ declutter bỏ 7–8/12 — "N more names hidden" TĂNG
 * (6 → 7/8) thay vì giảm. Bỏ nhãn là cách cuối; đẩy nó lên một tầng (cao + khe)
 * vẫn giữ x = tâm máy (nhãn vẫn "ở trên máy của nó", Đợt 31 đo bbox trong khung)
 * và đọc được. 2 tầng ⇒ tối đa 3 hàng nhãn — quá nữa là thành cột chữ.
 */
export const TANG_NHAN_TOI_DA = 2;
/** Khe hở giữa hai tầng nhãn (px). */
export const KHE_TANG_PX = 2;

/** Nhãn đã được chọn để vẽ. */
export interface NhanDuocVe {
  khoa: string;
  x: number;
  /** Toạ độ vẽ — đã cộng tầng (`y = neo − tang·(cao + khe)`). */
  y: number;
  /** ★ Đợt 35 — 0 = ngay trên neo; 1..`TANG_NHAN_TOI_DA` = đẩy LÊN; ★ Đợt 38 — ÂM = đẩy XUỐNG (`xepTangXuong`). */
  tang: number;
  /** Điểm ưu tiên đã tính — hiện ra để gỡ lỗi và để test khẳng định thứ tự. */
  diemUuTien: number;
  /**
   * Hộp bao màn hình ĐÃ DÙNG để khử chồng lấp. Hiện ra để test/e2e đối chiếu
   * được với `getBoundingClientRect` thật, thay vì phải suy lại từ x/y.
   */
  hop: HinhChuNhat;
}

export interface KetQuaLocNhan {
  /** Danh sách nhãn được vẽ, đã sắp theo ưu tiên GIẢM DẦN. Tối đa `tranNhan`. */
  ve: NhanDuocVe[];
  /** Tổng ứng viên đưa vào (kể cả ngoài khung) — cho `window.__demNhan`. */
  tongUngVien: number;
  /** Số bị loại vì ngoài khung nhìn. */
  soNgoaiKhung: number;
  /**
   * Số bị loại vì bbox chồng lên một nhãn ưu tiên cao hơn.
   *
   * ⚠ Đây là số nhãn BỊ LOẠI, KHÔNG phải số cặp còn chồng nhau trên màn (số đó
   * luôn = 0 theo hậu điều kiện của `locNhan`, đo bằng {@link demCapChongLap}).
   */
  soBiChongLap: number;
  /** Số bị loại vì đã chạm trần `tranNhan`. */
  soVuotTran: number;
  /**
   * ★ Đợt 35 — số bị loại vì hộp nhãn KHÔNG nằm trọn trong canvas (neo trong,
   * hộp thò ra mép). Chỉ đếm khi người gọi truyền `khungCanvas`.
   */
  soVuotMep: number;
  /**
   * ★ Đợt 35 — số bị loại vì hộp nhãn đè lên một VÙNG CẤM (lớp phủ DOM: Metrics,
   * panel trái/phải, ngăn Mô phỏng…). Chỉ đếm khi người gọi truyền `vungCam`.
   */
  soBiChe: number;
  /**
   * ★★★ Đợt 35 — số vật thể **BẤT THƯỜNG** đang ở NGOÀI khung nhìn (sau lưng camera
   * hoặc neo ngoài canvas). QA Đợt 32 (`raised/`): andon `raised` trên máy ngoài
   * khung ⇒ **không một dấu hiệu nào** trên màn Line. Đây là con số cho chip
   * "N sự cố ngoài khung" — NT-2: alarm không được giấu bởi góc camera, kể cả
   * khi nó ở ngoài góc camera.
   * ⚠ KHÔNG tính nhãn bất thường bị lớp phủ che hay vượt mép: máy ấy VẪN trong
   *   khung, `LopCanhBao` (badge 3D) vẫn hiện nó. Chip này nói về FRUSTUM.
   */
  soBatThuongNgoaiKhung: number;
  /**
   * ★★★ ĐỢT 23 M1 — TỔNG số nhãn **BỊ GIẤU** (ngoài khung + chồng + vượt trần
   * + bị lọc theo chính sách + vượt mép + bị che). Đây là con số màn hình phải NÓI RA.
   *
   * Vì sao không để người gọi tự cộng ba ô kia: cộng tay ở nơi gọi là cách
   * chắc chắn để hai màn cộng thiếu một ô khác nhau, và ô thiếu sẽ là ô mới
   * thêm vào lần sau. Một nguồn, một phép cộng.
   *
   * ⚠ KHÔNG tính `soNgoaiKhung` vào "giấu"? — CÓ tính. Một máy sau lưng camera
   *   cũng là một cái tên người dùng không đọc được; gộp chung mới trả lời
   *   đúng câu hỏi *"bao nhiêu máy đang không có nhãn"*.
   */
  soBiGiau: number;
}

export interface CauHinhLocNhan {
  /** Trần nhãn DOM. Mặc định {@link TRAN_NHAN_DOM}. */
  tranNhan?: number;
  /**
   * CHỈ giữ nhãn của vật thể **bất thường** (error / andon).
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 23 M1 — VÌ SAO CẦN BẬC NÀY, ĐO ĐƯỢC CHỨ KHÔNG PHỎNG ĐOÁN
   * ════════════════════════════════════════════════════════════════════════
   * Đo trên `dist`, vai `e2e_tai_loE`, viewport 1280×720, tư thế camera mặc
   * định (`.qa-dot23/M1-do-nhan.json`):
   *
   *     tổng ứng viên 45 · ngoài khung 0 · **bị loại vì chồng 37** · vẽ **8**
   *     cặp CÒN chồng trong tập được vẽ: **0**
   *
   * Nghĩa là bộ lọc đang chạy ĐÚNG hợp đồng của nó, nhưng **82 % máy không có
   * nhãn nào** — và màn KHÔNG nói ra điều đó. Người vận hành thấy 8 tên và
   * không có cách nào biết 37 cái tên còn lại đã bị giấu.
   *
   * ⇒ Bậc này cho người gọi đổi **chính sách chọn ai được nhãn** thay vì chỉ
   *   đổi số lượng: khi bật, nhãn dành cho máy đang bất thường — đúng thứ
   *   người vận hành cần đọc — thay vì cho máy nào tình cờ thắng phép so bbox.
   *
   * ⚠ KHÔNG đụng NT-2: alarm vẫn thuộc `LopCanhBao` (badge), lớp riêng, trần
   *   riêng. Bậc này chỉ nói về lớp NHÃN TÊN.
   */
  chiNhanBatThuong?: boolean;
  /**
   * Bán kính va chạm pixel — TƯƠNG THÍCH NGƯỢC. Khi truyền, nó đặt bề rộng/cao
   * SUY ĐOÁN thành `2 × banKinhVaChamPx` cho nhãn chưa đo được (hộp vuông cạnh
   * bằng đường kính cũ), nên hành vi của người gọi cũ không đổi đột ngột.
   * Ưu tiên dùng `rongSuyDoanPx`/`caoSuyDoanPx` cho rõ nghĩa.
   */
  banKinhVaChamPx?: number;
  /** Bề rộng suy đoán cho nhãn thiếu `rongPx`. Mặc định {@link RONG_SUY_DOAN_PX}. */
  rongSuyDoanPx?: number;
  /** Bề cao suy đoán cho nhãn thiếu `caoPx`. Mặc định {@link CAO_SUY_DOAN_PX}. */
  caoSuyDoanPx?: number;
  /**
   * ★ Đợt 35 — kích thước canvas (px). Khi truyền, hộp nhãn phải nằm TRỌN trong
   * canvas ({@link hopTrongKhung}); không thì bỏ và đếm `soVuotMep`. Bỏ trống ⇒
   * hành vi cũ (người gọi tự cờ `ngoaiKhung`).
   */
  khungCanvas?: KhungCanvasPx;
  /**
   * ★★★ Đợt 35 (Pareto #5) — VÙNG CẤM: bbox các LỚP PHỦ DOM đè lên canvas, quy
   * về gốc canvas (px). Hộp nhãn giao một vùng cấm ⇒ KHÔNG vẽ, đếm `soBiChe`.
   *
   * Vì sao là dữ liệu vào chứ không phải hằng: Metrics rộng 208×220 ở góc trái,
   * ngăn Mô phỏng ở góc phải, panel `/twin` 224–320 px — chúng đổi theo màn, theo
   * `2xl:`, theo thu/mở. Một hằng "chừa 220 px góc trái" sẽ đúng một màn và sai
   * ba màn kia im lặng. `LopNhan` lấy bbox THẬT từ `[data-che-nhan]` mỗi khung.
   */
  vungCam?: readonly HinhChuNhat[];
  /**
   * ★★★ Đợt 35 (Pareto #5) — XẾP TẦNG: nhãn chồng một nhãn đã giữ được ĐẨY LÊN tối
   * đa {@link TANG_NHAN_TOI_DA} tầng trước khi bị bỏ (luật 3b). Mặc định TẮT để
   * luật 3 ("chồng ⇒ bỏ") của mọi người gọi cũ giữ nguyên; `LopNhan` bật.
   */
  xepTang?: boolean;
  /**
   * ★★★ Đợt 38 (Pareto #7 QA Đợt 37) — XẾP TẦNG XUỐNG khi phía trên hết đường: thử tầng −1..−`TANG_NHAN_TOI_DA`
   * (đẩy XUỐNG dưới neo, đè lên phần nóc/thân máy) trước khi bỏ. Đo `/twin/line/2` 1280×720
   * (`.qa-dot38/sau/vung-cam-1280.json`): hàng nhãn t0 ở y≈233..257 nằm NGAY DƯỚI panel Metrics (vùng cấm
   * [8..254]×[8..228]) ⇒ ba nhãn bên trái KHÔNG có tầng nào phía trên ⇒ giấu 3/12 dù chỉ cần MỘT tầng; và tầng của
   * máy kề lệch nhau vài px (nóc máy khác cao) nên t1 của máy này chạm t2 của máy bên. Khung camera là việc của chủ
   * sở hữu (D-7 (2)); bộ lọc chỉ được phép dùng chỗ CÒN TRỐNG — và chỗ trống đang ở phía dưới.
   * Chỉ có nghĩa khi `xepTang`; mặc định TẮT để hợp đồng "lên hết ⇒ bỏ" của người gọi cũ nguyên; `LopNhan` bật.
   */
  xepTangXuong?: boolean;
}

/**
 * Điểm ưu tiên của một nhãn. CAO hơn = được giữ trước.
 *
 * Ba hạng rời nhau bằng khoảng cách 1.000.000 điểm, nên **không hạng nào bù được
 * cho hạng khác bằng cách ở gần camera**: một máy lỗi ở cuối xưởng luôn thắng một
 * máy bình thường ngay trước mũi camera. Đây là NT-2 luật 1 ("góc camera không
 * bao giờ được che một alarm đang hoạt động") được cưỡng chế bằng số học, chứ
 * không bằng lời hứa của người gọi.
 *
 * Trong cùng hạng, gần camera hơn thì điểm cao hơn (cộng nghịch đảo khoảng cách,
 * chặn trên bằng 1000 để máy ở khoảng cách 0 không thành vô cực).
 */
export function diemUuTienNhan(n: NhanUngVien): number {
  let diem = 0;
  if (n.dangChon) diem += 3_000_000;
  if (n.batThuong) diem += 2_000_000;
  if (n.hover) diem += 1_000_000;
  const d = Number.isFinite(n.khoangCachMet) ? Math.max(0, n.khoangCachMet) : Infinity;
  // Nghịch đảo khoảng cách, chuẩn hoá về (0, 1000].
  diem += d === Infinity ? 0 : 1000 / (1 + d);
  return diem;
}

/**
 * So sánh tất định hai ứng viên: điểm giảm dần, hoà thì so `khoa` tăng dần.
 *
 * ⚠ Nhánh hoà KHÔNG được bỏ: hai máy cùng trạng thái, cùng khoảng cách (xảy ra
 * thường xuyên với bố cục sinh tự động xếp lưới đều) sẽ cho kết quả PHỤ THUỘC
 * thứ tự đầu vào, tức là nhãn nhấp nháy đổi chỗ mỗi lần dữ liệu về.
 */
function soSanh(a: NhanUngVien, b: NhanUngVien): number {
  const da = diemUuTienNhan(a);
  const db = diemUuTienNhan(b);
  if (da !== db) return db - da;
  return a.khoa < b.khoa ? -1 : a.khoa > b.khoa ? 1 : 0;
}

/**
 * Lọc nhãn: cull ngoài khung → sắp ưu tiên → khử chồng lấp BBOX → cắt trần 30.
 *
 * Hàm THUẦN và TẤT ĐỊNH: cùng đầu vào (ở bất kỳ thứ tự nào) cho cùng đầu ra.
 *
 * ★ HẬU ĐIỀU KIỆN mà bản đường-tròn cũ KHÔNG có: mọi cặp trong `ve` KHÔNG chồng
 * bbox. Đây chính là điều `__demNhan.chongLap = 0` ngầm khai mà không giữ được —
 * nay giữ được, và `locNhan.unit.test.ts` ghim nó bằng phép quét toàn bộ cặp.
 */
/**
 * ★★★ ĐỢT 45 (mục 4d) — ĐỆM DƯỚI cho cụm chip đáy-giữa: chỉ lớp phủ NẰM NGANG QUA TÂM canvas VÀ chạm mép dưới
 * mới đẩy chip lên (thanh tua `/twin`: 38 px). Bản 4b/4c lấy MỌI lớp phủ chạm mép dưới ⇒ panel trái (top-0 bottom-0,
 * `tren = 0`) cho đệm = CẢ chiều cao canvas ⇒ chip bay lên trên mép canvas (đo `probe-chip.json`: `demDuoi=669`,
 * chip y = mép trên − 8, bị dải hợp nhất che) — và chẩn đoán "hộp drei" của 4c là SAI (G83 tự thân). Thuần, có lưới.
 */
export function demDuoiChoChip(vungCam: readonly HinhChuNhat[], rongPx: number, caoPx: number): number {
  if (!(rongPx > 0) || !(caoPx > 0)) return 0;
  const tamX = rongPx / 2;
  let dem = 0;
  for (const v of vungCam) {
    const chamDay = v.duoi >= caoPx - 1;
    const quaTam = v.trai <= tamX && v.phai >= tamX;
    const khongPhuCaCanvas = v.tren > 0;
    if (chamDay && quaTam && khongPhuCaCanvas) dem = Math.max(dem, caoPx - v.tren);
  }
  return dem;
}

export function locNhan(
  ungVien: NhanUngVien[],
  cauHinh: CauHinhLocNhan = {},
): KetQuaLocNhan {
  const tranNhan = cauHinh.tranNhan ?? TRAN_NHAN_DOM;
  // `banKinhVaChamPx` cũ → hộp vuông cạnh bằng ĐƯỜNG KÍNH (tương thích ngược).
  const rongMacDinh =
    cauHinh.rongSuyDoanPx ??
    (cauHinh.banKinhVaChamPx != null ? cauHinh.banKinhVaChamPx * 2 : RONG_SUY_DOAN_PX);
  const caoMacDinh =
    cauHinh.caoSuyDoanPx ??
    (cauHinh.banKinhVaChamPx != null ? cauHinh.banKinhVaChamPx * 2 : CAO_SUY_DOAN_PX);

  const trongKhung = ungVien.filter((n) => !n.ngoaiKhung);
  const soNgoaiKhung = ungVien.length - trongKhung.length;
  // ★ Đợt 35 — sự cố NGOÀI khung nhìn: đếm trên TẬP BỊ CULL, trước mọi chính sách.
  const soBatThuongNgoaiKhung = ungVien.length - trongKhung.length === 0
    ? 0
    : ungVien.filter((n) => n.ngoaiKhung && n.batThuong === true).length;
  const khungCanvas = cauHinh.khungCanvas;
  const vungCam = cauHinh.vungCam ?? [];

  // ★ Chính sách chọn ai được nhãn — chạy TRƯỚC phép sắp/khử chồng, vì nó đổi
  //   TẬP ứng viên chứ không đổi thứ tự. Nhãn đang CHỌN luôn được giữ: người
  //   dùng vừa bấm vào nó, giấu tên đúng cái họ vừa chọn là vô lý.
  // ★ Đợt 45 (mục 4) — chính sách nay là MẶC ĐỊNH của `/twin`, nên máy đang RÊ CHUỘT cũng
  //   được giữ: rê vào một máy "thường" là cách duy nhất đọc tên nó mà không đổi chế độ.
  const theoChinhSach = cauHinh.chiNhanBatThuong
    ? trongKhung.filter((n) => n.batThuong === true || n.dangChon === true || n.hover === true)
    : trongKhung;
  const soBiLocChinhSach = trongKhung.length - theoChinhSach.length;

  // Sắp theo ưu tiên trên BẢN SAO — không làm biến dạng mảng của người gọi.
  const daSap = [...theoChinhSach].sort(soSanh);

  const ve: NhanDuocVe[] = [];
  // Hộp của những nhãn ĐÃ giữ — song song với `ve`, giữ để không phải dựng lại
  // hộp ở mỗi lần so (vòng lặp này là O(n × 30) chạy mỗi khung được vẽ).
  const hopDaGiu: HinhChuNhat[] = [];
  let soBiChongLap = 0;
  let soVuotTran = 0;
  let soVuotMep = 0;
  let soBiChe = 0;

  for (const n of daSap) {
    const hop = hopNhan(n, rongMacDinh, caoMacDinh);

    // ★ Đợt 35 — hai cửa CHẠY TRƯỚC khử chồng/trần: nhãn không vẽ được thì không
    //   được chiếm suất, cũng không được "giữ chỗ" để giết một nhãn khác.
    if (khungCanvas && !hopTrongKhung(hop, khungCanvas)) {
      soVuotMep += 1;
      continue;
    }
    if (vungCam.length > 0 && vungCam.some((v) => haiHopChongNhau(v, hop))) {
      soBiChe += 1;
      continue;
    }

    // Khử chồng lấp: nếu bbox đè lên một nhãn ĐÃ giữ (ưu tiên cao hơn) thì thử
    // ĐẨY LÊN tối đa `TANG_NHAN_TOI_DA` tầng (★ Đợt 35); hết tầng mới bỏ.
    // Tầng đẩy lên cũng phải nằm trọn trong canvas và ngoài vùng cấm — không thì
    // ta vừa "cứu" một nhãn bằng cách chui dưới Metrics.
    const cao = hop.duoi - hop.tren;
    const tangToiDa = cauHinh.xepTang ? TANG_NHAN_TOI_DA : 0;
    let hopVe: HinhChuNhat | null = null;
    let tang = 0;
    // ★ Đợt 38 — thứ tự thử: 0, +1..+tangToiDa (LÊN), rồi −1..−tangToiDa (XUỐNG) khi `xepTangXuong`.
    const dsTang: number[] = [];
    for (let k = 0; k <= tangToiDa; k += 1) dsTang.push(k);
    if (cauHinh.xepTangXuong) for (let k = 1; k <= tangToiDa; k += 1) dsTang.push(-k);
    for (const k of dsTang) {
      const lech = k * (cao + KHE_TANG_PX);
      const thu: HinhChuNhat = k === 0 ? hop : { ...hop, tren: hop.tren - lech, duoi: hop.duoi - lech };
      // Tầng đẩy phải nằm TRỌN trong canvas và ngoài vùng cấm. `continue` chứ không `break`: hướng kia còn có thể được.
      if (k !== 0 && khungCanvas && !hopTrongKhung(thu, khungCanvas)) continue;
      if (k !== 0 && vungCam.length > 0 && vungCam.some((v) => haiHopChongNhau(v, thu))) continue;
      let chongLap = false;
      for (const g of hopDaGiu) {
        if (haiHopChongNhau(g, thu)) {
          chongLap = true;
          break;
        }
      }
      if (!chongLap) {
        hopVe = thu;
        tang = k;
        break;
      }
    }
    if (hopVe === null) {
      soBiChongLap += 1;
      continue;
    }
    if (ve.length >= tranNhan) {
      soVuotTran += 1;
      continue;
    }
    ve.push({
      khoa: n.khoa,
      x: n.x,
      y: n.y - tang * (cao + KHE_TANG_PX),
      tang,
      diemUuTien: diemUuTienNhan(n),
      hop: hopVe,
    });
    hopDaGiu.push(hopVe);
  }

  return {
    ve,
    tongUngVien: ungVien.length,
    soNgoaiKhung,
    soBiChongLap,
    soVuotTran,
    soVuotMep,
    soBiChe,
    soBatThuongNgoaiKhung,
    // MỘT phép cộng, ở MỘT nơi — xem docblock `soBiGiau`.
    soBiGiau: soNgoaiKhung + soBiLocChinhSach + soBiChongLap + soVuotTran + soVuotMep + soBiChe,
  };
}

/**
 * Đếm số CẶP nhãn chồng bbox trong một danh sách đã vẽ — dụng cụ ĐO độc lập.
 *
 * Vì sao tách ra khỏi `locNhan` thay vì tin vào `soBiChongLap`: `soBiChongLap`
 * đếm số nhãn BỊ LOẠI (đầu vào của thuật toán), còn hàm này đếm số cặp CÒN chồng
 * (đầu ra thật). Đây là hai đại lượng khác nhau, và chính chỗ lẫn hai đại lượng
 * này là gốc của lời khai sai cũ. E2E gọi hàm này với `rongPx`/`caoPx` lấy từ
 * `getBoundingClientRect` để đối chiếu với `__demNhan`.
 */
export function demCapChongLap(
  nhan: readonly Pick<NhanUngVien, "x" | "y" | "rongPx" | "caoPx">[],
  rongMacDinh = RONG_SUY_DOAN_PX,
  caoMacDinh = CAO_SUY_DOAN_PX,
): number {
  const hop = nhan.map((n) => hopNhan(n, rongMacDinh, caoMacDinh));
  let so = 0;
  for (let i = 0; i < hop.length; i++) {
    for (let j = i + 1; j < hop.length; j++) {
      if (haiHopChongNhau(hop[i], hop[j])) so += 1;
    }
  }
  return so;
}
