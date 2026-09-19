/**
 * nguongDonViVe.ts — KHI NÀO MỘT KHỐI MÁY NHỎ TỚI MỨC KHÔNG CÒN LÀ MỘT ĐÍCH BẤM ĐƯỢC.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CẦN — đo được, không phỏng đoán
 * ════════════════════════════════════════════════════════════════════════════
 * `/twin` một nhà máy vẽ **một khối = một máy**. Đo trên FUYU-F @1280×720, khung mặc định:
 * 176 khối trong khung, **cạnh trung vị 3,23 × 4,74 px** — diện tích 15,25 px², bằng **1/38**
 * ngưỡng WCAG 2.5.8 AA (24×24 px). **0/130** khối đạt ngưỡng.
 *
 * Và cuộn zoom KHÔNG giải được: quét 9 nấc, ở nấc phóng hết cỡ vẫn chỉ **8/16** khối đạt trong
 * khi đã mất **45 %** số máy khỏi khung. Ở màn Line chỉ 39 máy, đạt ngưỡng phải hy sinh **72 %**.
 * ⇒ Lời giải nằm ở **ĐƠN VỊ VẼ**, và tệp này là cái công tắc quyết định lúc nào đổi.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO CÔNG THỨC CHỨ KHÔNG ĐO HÌNH CHIẾU MỖI KHUNG
 * ════════════════════════════════════════════════════════════════════════════
 * Cỡ trên màn là đại lượng KHÔNG GIAN MÀN HÌNH. Cách hiển nhiên — đo hình chiếu mỗi khung rồi
 * `setState` — là đúng *pitfall #1* của react-three-fiber, và vòng PDCA 1 của dự án này đã trả
 * giá ở đúng chỗ ấy (`LopCanhBao`/`LopNhan` `setState` mỗi khung ⇒ 9,2 fps).
 *
 * Nên ở đây dùng **công thức đóng**, và người gọi chạy nó **khi camera đổi** (`onCameraDoi` đã
 * được nối sẵn), không phải trong `useFrame`. Hệ quả: mọi thứ trong tệp này là **hàm thuần** —
 * lưới kiểm được bằng giá trị thật, không cần dựng cảnh, không cần jsdom.
 *
 *     cỡPx = cỡThậtM / (2 · d · tan(fov/2)) · caoCanvasPx
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ `d` LÀ KHOẢNG CÁCH CAMERA → CHÍNH MÁY ĐÓ, KHÔNG PHẢI BÁN KÍNH QUỸ ĐẠO
 * ════════════════════════════════════════════════════════════════════════════
 * Chỗ này tôi suýt làm sai, và phép đo bắt được **trước khi có một dòng mã nào**. Quét 7 nấc
 * cuộn rồi kiểm bất biến `cỡPx × d` (phải gần HẰNG nếu công thức đúng), với `d` lấy từ
 * `window.__tuTheCamera` = **bán kính quỹ đạo** (camera → điểm ngắm):
 *
 *     lấy cỡPx từ TRUNG VỊ toàn tập : 1269,7 → 889,2   (trôi −30 %)
 *     lấy cỡPx từ MỘT MÁY CỐ ĐỊNH   : 1211,8 → 1034,6  (trôi −15 %)
 *
 * Hai nguyên nhân tách bạch: nửa đầu là **thành phần mẫu** (trung vị chạy trên tập đang co
 * 176 → 113 khối, nên "máy trung vị" đổi danh tính); nửa còn lại là **sai số proxy** — máy lệch
 * trục thì khoảng cách tới nó và bán kính quỹ đạo co khác nhau (đo được: cỡPx tăng 3,10× trong
 * khi bán kính giảm 3,63×). ⇒ Công thức không sai; proxy sai. Tệp này dùng khoảng cách THẬT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ VÌ SAO CHẤM TRÊN **CẠNH NHỎ**, KHÔNG TRÊN DIỆN TÍCH
 * ════════════════════════════════════════════════════════════════════════════
 * Bản thiết kế viết ngưỡng theo diện tích ("< 576 px²") — đó là một **xấp xỉ tiện tay**. WCAG
 * 2.5.8 nói *"at least 24 by 24 CSS pixels"*, tức một sàn cho **từng chiều**. Chấm theo diện
 * tích để lọt một đích 4 × 144 px: đủ 576 px² mà không ai bấm trúng. Đo được ở đây, cạnh NGANG
 * còn **nhỏ hơn** cạnh dọc (3,23 vs 4,74 px), nên chấm theo chiều dọc một mình là chấm phía
 * DỄ DÃI. ⇒ dùng `min(rộngPx, caoPx)`.
 */

/** Cỡ thật của một máy (mm) — khớp `CoMacDinh` của `hopNhatCanh`, khai lại để tệp này KHÔNG phụ thuộc nó. */
export interface CoThatMm {
  rongMm: number;
  caoMm: number;
}

/** Một điểm trong hệ CẢNH (mét). `y` là độ cao — cùng quy ước `DiemScene`. */
export interface DiemMet {
  x: number;
  y: number;
  z: number;
}

/** Máy tối thiểu để chấm cỡ — nhận đúng hình dạng mà `MayDaDung` đã có, không đòi thêm. */
export interface MayDeChamCo {
  kichThuocMm: CoThatMm;
  viTri: DiemMet;
}

/** Đơn vị vẽ đang dùng ở cấp nhà máy. */
export type DonViVe = "may" | "cum";

/**
 * Sàn WCAG 2.5.8 AA: 24 × 24 CSS px. Đây là một **tiêu chuẩn ngoài**, không phải số dự án tự
 * chọn — nên nó không được "nới cho vừa" khi một phép đo không đạt.
 */
export const NGUONG_CANH_NHO_PX = 24;

/**
 * ★★★ Hệ số TRỄ ĐÓNG/MỞ. Không phải số chọn cho đẹp — nó bị chặn dưới bởi một phép đo.
 *
 * Một ngưỡng trần trụi ở đúng 24 px sẽ **nhấp nháy**: cuộn qua lại quanh mốc là cảnh đổi đơn vị
 * vẽ giữa hai khung liền nhau. Muốn không nhấp nháy, dải trễ phải RỘNG HƠN bước nhảy của một
 * nấc cuộn.
 *
 * Đo được (`/twin` FUYU-F @1280×720, một máy cố định): cỡPx đi **3,312 → 4,044 sau 3 nấc**, tức
 * **1,0688 lần mỗi nấc**. Hệ số 1,5 tương đương **hơn 6 nấc** cuộn liên tiếp mới đi hết dải trễ
 * — đủ rộng để một nấc lẻ không lật được, và vẫn đủ hẹp để người dùng không phải cuộn vô tận
 * mới thấy cảnh đổi lại. Lưới ghim đúng bất đẳng thức ấy, không ghim con số 1,5.
 */
export const HE_SO_TRE = 1.5;

/** Tỉ lệ cỡPx mỗi NẤC CUỘN, đo được — dùng làm chặn dưới cho {@link HE_SO_TRE}. */
export const TI_LE_MOI_NAC_DO_DUOC = 1.0688;

const DO_SANG_RAD = Math.PI / 180;

/**
 * Chiếu một cỡ thật (mét) ở khoảng cách `d` (mét) ra pixel trên một canvas cao `caoCanvasPx`.
 *
 * ⚠ Trả `0` khi đối số không dùng được (d ≤ 0, fov ngoài (0,180), canvas ≤ 0, cỡ ≤ 0) thay vì
 *   `NaN`/`Infinity`: hàm này nuôi một công tắc, và một `NaN` lọt xuống sẽ làm mọi phép so sánh
 *   trả `false` — tức công tắc **im lặng kẹt ở một phía**. `0` thì rơi về phía "quá nhỏ", tức
 *   phía AN TOÀN (gộp cụm), và lộ ra ngay ở lưới.
 */
export function coTrenManPx(
  coThatM: number,
  khoangCachM: number,
  fovDo: number,
  caoCanvasPx: number,
): number {
  if (!Number.isFinite(coThatM) || coThatM <= 0) return 0;
  if (!Number.isFinite(khoangCachM) || khoangCachM <= 0) return 0;
  if (!Number.isFinite(fovDo) || fovDo <= 0 || fovDo >= 180) return 0;
  if (!Number.isFinite(caoCanvasPx) || caoCanvasPx <= 0) return 0;
  /*
   * ★★★ KHÔNG có phép canh `nuaKhung <= 0` ở đây, và đó là một QUYẾT ĐỊNH CÓ BẰNG CHỨNG, không
   *   phải sơ suất. Bốn phép canh trên đã chặn đủ: `fovDo ∈ (0,180)` ⇒ `tan(fov/2) > 0`, và
   *   `khoangCachM > 0` hữu hạn ⇒ tích luôn **dương**. Phép canh thứ năm vì thế BẤT KHẢ ĐẠT.
   *
   *   Nó từng có mặt, và đột biến đã lật tẩy: gỡ RIÊNG nó ⇒ lưới vẫn 17/17 xanh; gỡ RIÊNG phép
   *   canh khoảng cách ⇒ cũng 17/17 xanh. Hai lớp phủ nhau hoàn hảo nên **không đột biến đơn lẻ
   *   nào bắt được** — đúng cảnh báo "phòng thủ nhiều lớp che đột biến của chính nó". Giữ lại
   *   một lớp rỗng là giữ một thứ không ai chứng minh được là còn sống.
   */
  const nuaKhung = 2 * khoangCachM * Math.tan((fovDo * DO_SANG_RAD) / 2);
  return (coThatM / nuaKhung) * caoCanvasPx;
}

/** Khoảng cách Euclid camera → máy, hệ CẢNH (mét). */
export function khoangCachToiMay(camera: DiemMet, viTri: DiemMet): number {
  return Math.hypot(camera.x - viTri.x, camera.y - viTri.y, camera.z - viTri.z);
}

/**
 * PHÉP NGHỊCH của {@link coTrenManPx}: một vật ở khoảng cách `d` phải to bao nhiêu **mét** thì
 * chiếm đúng `nguongPx` pixel trên màn?
 *
 * ★ Vì sao cần: biểu tượng cụm phải ĐẠT ngưỡng bấm **theo cấu tạo**, chứ không phải nhờ may. Cỡ
 *   thế giới cố định (kiểu `BIEU_TUONG_TOI_THIEU_MM` của Task 20) chỉ đúng ở đúng một tư thế
 *   camera; camera lùi ra là nó lại nhỏ hơn ngưỡng, và ta quay về đúng bài toán vừa giải.
 *   Suy ngược từ ngưỡng thì mọi tư thế đều đạt, và tiêu chí nghiệm thu "≥ 90 % đơn vị vẽ đạt
 *   24×24" trở thành hệ quả của phép dựng chứ không phải một điều cần cầu may.
 *
 * ⚠ Cùng quy ước trả `0` khi đối số không dùng được — xem docblock {@link coTrenManPx}.
 */
export function coThatToiThieuM(
  nguongPx: number,
  khoangCachM: number,
  fovDo: number,
  caoCanvasPx: number,
): number {
  if (!Number.isFinite(nguongPx) || nguongPx <= 0) return 0;
  if (!Number.isFinite(khoangCachM) || khoangCachM <= 0) return 0;
  if (!Number.isFinite(fovDo) || fovDo <= 0 || fovDo >= 180) return 0;
  if (!Number.isFinite(caoCanvasPx) || caoCanvasPx <= 0) return 0;
  return (nguongPx * (2 * khoangCachM * Math.tan((fovDo * DO_SANG_RAD) / 2))) / caoCanvasPx;
}

/**
 * Cạnh NHỎ của hình chiếu một máy (px) — `min(rộng, cao)`.
 *
 * ⚠ Bề rộng chiếu ở đây là xấp xỉ **mặt đối diện camera**: nó bỏ qua góc xoay quanh trục đứng.
 *   Xoay chỉ làm bề rộng biểu kiến NHỎ ĐI hoặc bằng (tới `max(rộng, sâu)` ở 45°), nên xấp xỉ
 *   này nghiêng về phía **cho là to hơn thực tế** — tức phía dè dặt với việc gộp cụm. Nói ra
 *   chứ không giấu: nếu về sau cần chặt hơn, chỗ phải sửa là đây, và phải kèm một phép đo.
 */
export function canhNhoTrenManPx(
  may: MayDeChamCo,
  camera: DiemMet,
  fovDo: number,
  caoCanvasPx: number,
): number {
  const d = khoangCachToiMay(camera, may.viTri);
  const caoPx = coTrenManPx(may.kichThuocMm.caoMm / 1000, d, fovDo, caoCanvasPx);
  const rongPx = coTrenManPx(may.kichThuocMm.rongMm / 1000, d, fovDo, caoCanvasPx);
  return Math.min(caoPx, rongPx);
}

/**
 * TRUNG VỊ cạnh nhỏ trên toàn tập máy (px). Tập rỗng ⇒ `0`.
 *
 * ★ Trung vị chứ không phải trung bình — cùng lý lẽ mà `canhTapDoan` đã ghi cho cỡ biểu tượng:
 *   một máy khổng lồ (hoặc một máy sát camera) kéo trung bình đi, còn trung vị thì không. Ở đây
 *   nó còn quan trọng hơn: đại lượng này là một CÔNG TẮC, và một ngoại lai lật công tắc là một
 *   cảnh đổi đơn vị vẽ vì đúng một cái máy.
 */
export function trungViCanhNhoPx(
  may: readonly MayDeChamCo[],
  camera: DiemMet,
  fovDo: number,
  caoCanvasPx: number,
): number {
  if (may.length === 0) return 0;
  const ds = may.map((m) => canhNhoTrenManPx(m, camera, fovDo, caoCanvasPx)).sort((a, b) => a - b);
  return ds[Math.floor((ds.length - 1) / 2)];
}

/**
 * Công tắc đơn vị vẽ, CÓ TRỄ.
 *
 * - đang vẽ từng máy: chuyển sang cụm khi trung vị **<** {@link NGUONG_CANH_NHO_PX}
 * - đang vẽ cụm:      chỉ quay về từng máy khi trung vị **>** ngưỡng × {@link HE_SO_TRE}
 * - trong dải trễ:    **giữ nguyên** thứ đang vẽ
 *
 * ⚠ Hai dấu so sánh cố ý KHÔNG có dấu bằng ở cả hai đầu: đúng tại mốc thì giữ nguyên, nên một
 *   giá trị đứng im ngay trên mốc không lật đi lật lại theo sai số dấu phẩy động.
 */
export function donViVeKeTiep(trungViPx: number, dangVe: DonViVe): DonViVe {
  if (!Number.isFinite(trungViPx)) return dangVe;
  if (dangVe === "may") return trungViPx < NGUONG_CANH_NHO_PX ? "cum" : "may";
  return trungViPx > NGUONG_CANH_NHO_PX * HE_SO_TRE ? "may" : "cum";
}
