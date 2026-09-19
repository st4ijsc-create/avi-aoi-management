/**
 * soDoLine.ts — BỐ CỤC **SƠ ĐỒ** CHO MÀN LINE: trải chuyền thành lưới rắn bò.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT ĐƯỢC GHIM — ĐO TRÊN TRÌNH DUYỆT THẬT, `/twin/line/526` (39 máy)
 * ════════════════════════════════════════════════════════════════════════════
 * |  khung     | nội dung lấp NGANG | nội dung lấp **DỌC** | cạnh nhỏ trung vị | đạt 24×24 |
 * |------------|--------------------|----------------------|-------------------|-----------|
 * | 1280×720   | 80,5 %             | **1,2 %**            | 5,87 px           | **0/39**  |
 * | 1920×1080  | 88,9 %             | **1,3 %**            | 10,76 px          | **0/39**  |
 *
 * Line là một **dải ~130 : 1**. Khung nhìn phải khớp theo chiều dài, nên **98,8 % chiều cao
 * canvas bỏ không** và mỗi máy còn ~6 px. Và **không nấc zoom nào cứu được**: phóng tới nấc 18
 * thì đích bấm to ra nhưng chỉ còn **11/39** máy trong khung — mất cái nhìn tổng thể, tức mất
 * chính thứ màn Line tồn tại để cho.
 *
 * ⚠ Đây **KHÔNG** phải lỗi khung nhìn như bản 2D (`khungNhinBan2D.dom.test.tsx`: `viewBox` khai
 *   3004 m trong khi máy chỉ chiếm 51 m). Ở đây khung đã khớp ĐÚNG. Thứ chặn là **hình dạng của
 *   chính dữ liệu**, nên không có bản vá khung nhìn nào giải được — chỉ có một **lựa chọn thiết
 *   kế**, và chủ dự án đã chốt: trải chuyền thành sơ đồ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RÀNG BUỘC TRUNG THỰC — CÙNG MỘT LUẬT VỚI SA BÀN TẬP ĐOÀN
 * ════════════════════════════════════════════════════════════════════════════
 * `canhTapDoan.saBanTapDoan` đã trả giá để học luật này: **khi vị trí trên cảnh là sơ đồ chứ
 * không phải toạ độ thật, giao diện PHẢI NÓI RA, và phải nói bằng SỐ.** Nên module này:
 *   · trả `laSoDo: true` **luôn luôn** — màn Line không có chế độ "đôi khi là toạ độ thật", vì
 *     một chế độ lật ngầm thì người xem không bao giờ biết mình đang đọc cái gì (đúng lớp lỗi
 *     *"hai nút, hai thứ"* mà Task 20 ghi);
 *   · giữ lại `thatRongM`/`thatSauM`/`thatCanhNhoM`/`thatCanhLonM` — **sự thật đã bị thay** — để
 *     banner nêu được CẢ HAI vế thay vì một câu chung chung.
 *
 * ★ Ba thứ trên cảnh vẫn là **số thật**, và câu khai không được nói quá (bài học `banner-vi-tri-
 *   tam-sinh`: bản nháp kết bằng *"chỉ chiều cao còn là số thật"* và bị phép đo bắt là khai sai):
 *     · **chiều cao** mỗi khối — giữ nguyên `caoMm`;
 *     · **cao độ sàn** `viTri.y` — giữ nguyên của chính máy đó;
 *     · **thứ tự dòng chảy** — suy từ dữ liệu thật, xem dưới.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO **RẮN BÒ** CHỨ KHÔNG PHẢI MỘT LƯỚI BẤT KỲ
 * ════════════════════════════════════════════════════════════════════════════
 * Một chuyền là một **TRÌNH TỰ**. Nếu xếp 39 máy vào lưới theo id thì đích bấm đạt ngưỡng nhưng
 * thông tin *"sau máy này là máy nào"* biến mất — đổi một khuyết tật lấy một khuyết tật khác.
 * Rắn bò (boustrophedon: hàng chẵn trái→phải, hàng lẻ phải→trái) giữ **hai máy liền kề trong
 * dòng chảy thì liền kề trên màn**, kể cả ở chỗ xuống hàng. Đó là lý do duy nhất chọn nó; nếu
 * đổi sang lưới quét-lại-từ-trái thì mỗi lần xuống hàng là một bước nhảy ngang toàn màn.
 *
 * ★ `duongTam` trả về đi theo đúng đường rắn ấy, nên mũi tên dòng chảy (`DongChayLine`) vẫn chỉ
 *   đúng chiều — thứ tự không bị bỏ, nó được **vẽ ra**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★ THỨ TỰ DÒNG CHẢY LẤY Ở ĐÂU — MỘT LUẬT, KHÔNG PHA TRỘN
 * ════════════════════════════════════════════════════════════════════════════
 * Hai nguồn có thể dùng, và chúng **không được trộn**:
 *   ① `thuTu` của TRẠM (`stations.thuTu`) — trình tự công nghệ thật;
 *   ② hình chiếu lên trục chính của bố cục thật — suy ra từ vị trí.
 *
 * Luật: dùng ① **chỉ khi MỌI máy đều tra được** một `thuTu` hữu hạn; thiếu dù một máy ⇒ rơi
 * hẳn về ②. Trộn hai thang (máy có thứ tự xếp trước, máy không có xếp sau) tạo ra một trình tự
 * *trông như* trình tự công nghệ nhưng không phải — và không lỗi nào nổ. `theoThuTuTram` khai ra
 * luật nào đã dùng, để banner và phép đo đọc được thay vì đoán.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★ CỠ Ô: **SỐ CỘT** LÀ THỨ QUYẾT ĐỊNH ĐÍCH BẤM, KHÔNG PHẢI SỐ MÉT
 * ════════════════════════════════════════════════════════════════════════════
 * Khung nhìn của màn Line khớp bbox vào canvas, nên cỡ **pixel** của một máy chỉ phụ thuộc vào
 * *bao nhiêu ô chia hết bề ngang*, chứ không phụ thuộc ô rộng mấy mét. Vì thế:
 *   · `soCotSoDo(n, tiLeKhung)` chọn số cột để **tỉ lệ lưới ≈ tỉ lệ canvas** ⇒ nội dung lấp CẢ
 *     HAI chiều (chữa đúng con số 1,2 % ở trên);
 *   · cỡ mặt bằng thì lấy **trung vị của chính tập đang xem** (cùng phép PH-50 của sa bàn) — một
 *     con số thật, dễ khai, và giữ cho khối không bé hơn máy thật của chuyền.
 *
 * ⇒ Tiêu chí *"≥ 24×24 px"* là **hệ quả của phép dựng**: với `n` máy và canvas `W×H`, cạnh ô
 *   ≈ `√(W·H/n)` px, tức 39 máy trên 1280×720 cho ~154 px/ô. Không cần cầu may.
 *
 * ⚠ `heSoNghieng` có mặt vì camera màn Line KHÔNG nhìn thẳng đứng: trục sâu bị co lại theo góc
 *   nhìn, nên lưới vuông trong không gian thế giới hiện ra **bẹt** trên màn. Nó nhân vào tỉ lệ
 *   khung TRƯỚC khi chia cột. Mặc định `1.0` = không sửa; người gọi đo được góc thật thì truyền
 *   số đo, **không** đoán.
 */

import type { BBox } from "../heToaDo";
import type { MayTrongLo } from "../loi/LoBatchMay";

/** Khe giữa hai ô = 35 % cạnh mặt bằng — đủ để mắt (và phép đo chồng lấn) đọc ra từng khối. */
export const TI_LE_KHE_O = 0.35;

/** Không sửa góc nhìn khi người gọi chưa đo được. */
export const HE_SO_NGHIENG_MAC_DINH = 1;

/** Cỡ mặt bằng tối thiểu của một ô (m) — chặn tập toàn máy tí hon co về 0. */
export const O_TOI_THIEU_M = 0.5;

export interface TuyChonSoDoLine {
  /** `rộng/cao` của canvas. ≤ 0 / không hữu hạn ⇒ dùng 16/9. */
  tiLeKhung?: number;
  /** Nhân vào `tiLeKhung` để bù trục sâu bị co theo góc nhìn. */
  heSoNghieng?: number;
  /** Ép số cột (phép đo/ablation dùng). Bỏ qua khi ≤ 0. */
  epCot?: number;
  tiLeKhe?: number;
}

export interface SoDoLine {
  /** LUÔN `true` — màn Line không có chế độ "toạ độ thật". */
  laSoDo: true;
  cot: number;
  hang: number;
  /** Mặt bằng ƯỚC LỆ dùng cho MỌI máy (m) — trung vị của tập đang xem. */
  oRongM: number;
  oSauM: number;
  /** Bước lưới = mặt bằng + khe (m). */
  buocXM: number;
  buocZM: number;
  /** `machineId` theo thứ tự dòng chảy, đầu chuyền trước. */
  thuTu: number[];
  /** Vị trí ĐÁY mới (mét, cùng hệ cảnh). Quy ước ĐÁY — xem chú thích `MayTrongLo.viTri`. */
  viTriMoi: Map<number, { x: number; y: number; z: number }>;
  /** Đường rắn bò qua tâm các ô — mũi tên dòng chảy đi theo đây. */
  duongTam: { x: number; y: number; z: number }[];
  /** Bề rộng/bề sâu của SƠ ĐỒ (m). */
  rongM: number;
  sauM: number;
  /** ★ Sự thật đã bị thay — banner nêu cả hai vế. */
  thatRongM: number;
  thatSauM: number;
  thatCanhNhoM: number;
  thatCanhLonM: number;
  /**
   * ★★★ Cao độ MẶT PHẲNG MÁY (m) — trung vị `viTri.y` của chính tập đang xem.
   *
   * Có trường này vì một khuyết tật ĐÃ ĐO, không vì cho đủ bộ: khung nhìn sơ đồ ban đầu ngắm
   * vào `bbox.minY`, và `bboxKemCotWip` **ép `minY: 0`** cho cột WIP. Ở `/twin/line/526` máy nằm
   * trên **tầng 3, y = 16,6 m**, nên camera ngắm thấp hơn mặt máy đúng 16,6 m và cả lưới trượt
   * khỏi khung (máy chiếu xuống **y ≈ 975 px** trên canvas cao 437 px). Thống kê của một bbox
   * đã trộn hai cao độ KHÔNG trả lời được câu *"mặt phẳng máy ở đâu"* — chỉ tập máy trả lời được.
   */
  yMatPhangM: number;
  /** `true` = thứ tự lấy từ `stations.thuTu`; `false` = suy từ vị trí thật. */
  theoThuTuTram: boolean;
  /** Trục chính của bố cục THẬT đã dùng để suy thứ tự khi `theoThuTuTram === false`. */
  trucThat: "X" | "Z";
}

/**
 * Số cột để tỉ lệ lưới bám tỉ lệ khung.
 *
 * `cot ≈ √(n · tỉLệ)` — nghiệm của `cot/hàng = tỉLệ` với `hàng = n/cot`. Kẹp vào `[1, n]`.
 *
 * ⚠ Tham số rác (`NaN`, `≤ 0`) ⇒ **16/9**, không ⇒ `NaN` cột. Một `NaN` ở đây biến mọi toạ độ
 *   xuống dưới thành `NaN` và cảnh trống trơn mà không lỗi nào nổ.
 */
export function soCotSoDo(n: number, tiLeKhung: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const tl = Number.isFinite(tiLeKhung) && tiLeKhung > 0 ? tiLeKhung : 16 / 9;
  const cot = Math.round(Math.sqrt(n * tl));
  return Math.min(Math.max(cot, 1), Math.trunc(n));
}

function trungVi(ds: readonly number[]): number {
  if (ds.length === 0) return 0;
  const s = [...ds].sort((a, b) => a - b);
  const g = s.length >> 1;
  return s.length % 2 ? s[g] : (s[g - 1] + s[g]) / 2;
}

/**
 * Dựng sơ đồ rắn bò cho một chuyền.
 *
 * @param may           máy ĐÃ có vị trí thật (kết quả `dungMayVe`).
 * @param thuTuTheoMay  `machineId → stations.thuTu`; thiếu/`null` ở **bất kỳ** máy nào ⇒ rơi hẳn
 *                      về thứ tự theo vị trí (xem docblock — không trộn hai thang).
 * @returns `null` khi tập rỗng — trải một sơ đồ cho 0 máy là vẽ ra một chuyền không có.
 */
export function dungSoDoLine(
  may: readonly MayTrongLo[],
  thuTuTheoMay: ReadonlyMap<number, number | null | undefined>,
  tuyChon: TuyChonSoDoLine = {},
): SoDoLine | null {
  if (may.length === 0) return null;

  /* ── Sự thật sắp bị thay: đo TRƯỚC khi dựng lưới ────────────────────── */
  const rongThat = may.map((m) => Math.max(0, m.kichThuocMm.rongMm) / 1000);
  const sauThat = may.map((m) => Math.max(0, m.kichThuocMm.sauMm) / 1000);
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  may.forEach((m, i) => {
    xMin = Math.min(xMin, m.viTri.x - rongThat[i] / 2);
    xMax = Math.max(xMax, m.viTri.x + rongThat[i] / 2);
    zMin = Math.min(zMin, m.viTri.z - sauThat[i] / 2);
    zMax = Math.max(zMax, m.viTri.z + sauThat[i] / 2);
  });
  const thatRongM = Number.isFinite(xMax - xMin) ? xMax - xMin : 0;
  const thatSauM = Number.isFinite(zMax - zMin) ? zMax - zMin : 0;
  const trucThat: "X" | "Z" = thatRongM >= thatSauM ? "X" : "Z";

  /* ── ① Thứ tự dòng chảy — MỘT luật, không pha trộn ───────────────────── */
  const thuTuTram = may.map((m) => {
    const v = thuTuTheoMay.get(m.machineId);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  });
  const theoThuTuTram = thuTuTram.every((v) => v !== null);

  const chiSo = may.map((_, i) => i);
  chiSo.sort((a, b) => {
    if (theoThuTuTram) {
      const d = (thuTuTram[a] as number) - (thuTuTram[b] as number);
      if (d !== 0) return d;
    }
    // Hình chiếu lên trục chính của bố cục THẬT — và cũng là phép phá hoà bên trong một trạm.
    const pa = trucThat === "X" ? may[a].viTri.x : may[a].viTri.z;
    const pb = trucThat === "X" ? may[b].viTri.x : may[b].viTri.z;
    if (pa !== pb) return pa - pb;
    const qa = trucThat === "X" ? may[a].viTri.z : may[a].viTri.x;
    const qb = trucThat === "X" ? may[b].viTri.z : may[b].viTri.x;
    if (qa !== qb) return qa - qb;
    // Chốt bằng id: cùng chỗ, cùng trạm ⇒ thứ tự vẫn phải ỔN ĐỊNH giữa hai lần tải.
    return may[a].machineId - may[b].machineId;
  });

  /* ── ② Lưới: số cột theo tỉ lệ khung, cỡ ô theo trung vị thật ────────── */
  const tlTho = tuyChon.tiLeKhung;
  const nghieng =
    Number.isFinite(tuyChon.heSoNghieng) && (tuyChon.heSoNghieng as number) > 0
      ? (tuyChon.heSoNghieng as number)
      : HE_SO_NGHIENG_MAC_DINH;
  const tiLe = (Number.isFinite(tlTho) && (tlTho as number) > 0 ? (tlTho as number) : 16 / 9) * nghieng;
  const epCot = tuyChon.epCot;
  const cot =
    Number.isFinite(epCot) && (epCot as number) > 0
      ? Math.min(Math.trunc(epCot as number), may.length)
      : soCotSoDo(may.length, tiLe);
  const hang = Math.ceil(may.length / cot);

  const oRongM = Math.max(O_TOI_THIEU_M, trungVi(rongThat));
  const oSauM = Math.max(O_TOI_THIEU_M, trungVi(sauThat));
  const tiLeKhe =
    Number.isFinite(tuyChon.tiLeKhe) && (tuyChon.tiLeKhe as number) >= 0
      ? (tuyChon.tiLeKhe as number)
      : TI_LE_KHE_O;
  const buocXM = oRongM * (1 + tiLeKhe);
  const buocZM = oSauM * (1 + tiLeKhe);

  /*
   * ★ Neo sơ đồ vào TÂM của bố cục thật (không vào gốc toạ độ): giữ cho cảnh không nhảy sang
   *   một góc khác của sàn, và giữ `viTri.y` (cao độ sàn) đúng ngữ cảnh của chuyền.
   */
  const tamX = Number.isFinite(xMin) ? (xMin + xMax) / 2 : 0;
  const tamZ = Number.isFinite(zMin) ? (zMin + zMax) / 2 : 0;
  const goc0X = tamX - ((cot - 1) * buocXM) / 2;
  const goc0Z = tamZ - ((hang - 1) * buocZM) / 2;

  const viTriMoi = new Map<number, { x: number; y: number; z: number }>();
  const duongTam: { x: number; y: number; z: number }[] = [];
  const thuTu: number[] = [];
  const yTrungVi = trungVi(may.map((m) => m.viTri.y));

  chiSo.forEach((idx, k) => {
    const hangK = Math.floor(k / cot);
    const trongHang = k % cot;
    // ★ RẮN BÒ: hàng lẻ chạy ngược, nên hai máy liền kề trong dòng chảy vẫn liền kề trên màn.
    const cotK = hangK % 2 === 0 ? trongHang : cot - 1 - trongHang;
    const x = goc0X + cotK * buocXM;
    const z = goc0Z + hangK * buocZM;
    const m = may[idx];
    // ⚠ `y` GIỮ NGUYÊN của chính máy đó — quy ước ĐÁY. Đặt `caoM/2` ở đây là lỗi mà `cumTram`
    //   đã mắc một lần và lưới của chính nó ghim lại (khối sẽ NỔI lên nửa thân).
    viTriMoi.set(m.machineId, { x, y: m.viTri.y, z });
    duongTam.push({ x, y: yTrungVi, z });
    thuTu.push(m.machineId);
  });

  return {
    laSoDo: true,
    cot,
    hang,
    oRongM,
    oSauM,
    buocXM,
    buocZM,
    thuTu,
    viTriMoi,
    duongTam,
    yMatPhangM: yTrungVi,
    rongM: (cot - 1) * buocXM + oRongM,
    sauM: (hang - 1) * buocZM + oSauM,
    thatRongM,
    thatSauM,
    // ⚠ `reduce`, KHÔNG `Math.min(...mảng)`: phép trải nổ `RangeError` khi mảng dài, và một
    //   chuyền lớn là đúng ca mà màn này tồn tại để phục vụ.
    thatCanhNhoM: [...rongThat, ...sauThat].reduce((a, b) => Math.min(a, b), Infinity),
    thatCanhLonM: [...rongThat, ...sauThat].reduce((a, b) => Math.max(a, b), -Infinity),
    theoThuTuTram,
    trucThat,
  };
}

/**
 * Áp sơ đồ lên danh sách máy đã dựng.
 *
 * Đổi **vị trí**, **mặt bằng** và **góc xoay**; giữ **chiều cao**, **màu**, **độ mờ**, `hien`,
 * `khoi` và `machineId`. Góc xoay về 0 vì một góc thật trong một lưới ước lệ là thông tin đã
 * mất ngữ cảnh — giữ lại nó chỉ làm người xem tưởng hướng máy còn nghĩa.
 *
 * ⚠ Máy không có trong sơ đồ ⇒ **giữ nguyên**, không bỏ. Bỏ im lặng là đúng lớp lỗi F2.
 */
export function apSoDoVaoMay(may: readonly MayTrongLo[], soDo: SoDoLine | null): MayTrongLo[] {
  if (soDo === null) return [...may];
  return may.map((m) => {
    const vt = soDo.viTriMoi.get(m.machineId);
    if (!vt) return m;
    return {
      ...m,
      viTri: vt,
      gocXoayRad: 0,
      kichThuocMm: {
        ...m.kichThuocMm,
        rongMm: soDo.oRongM * 1000,
        sauMm: soDo.oSauM * 1000,
      },
    };
  });
}

/**
 * Hộp bao của sơ đồ — **theo THÂN máy**, không theo tâm máy.
 *
 * ★★★ VÌ SAO CẦN HÀM NÀY (đo được, không suy)
 * `hinhHocLine` dựng bbox từ `ViTriDaDat` **không có `co`**, tức một đám ĐIỂM. Khung nhìn khớp
 * vào đám điểm ấy thì nửa cái máy ngoài rìa nằm ngoài khung. Ở 1280×720 lề `LE_KHOP_KHUNG_PX`
 * (px cố định) đủ che; ở **1920×1080** cùng số px ấy nhỏ đi tương đối và khuyết tật lộ ra: đo
 * được **nội dung lấp 118,6 % bề ngang**, tức hai cột rìa bị cắt.
 *
 * ⇒ Hàm này trả hộp bao tính CẢ mặt bằng ước lệ và chiều cao THẬT cao nhất của tập.
 *
 * ⚠ Không sửa `hinhHocLine` để nó mang `co`: đường DẢI đang dựa vào hành vi hiện tại của nó, và
 *   đổi một hàm dùng chung để chữa một màn là cách nhanh nhất mua một hồi quy ở màn khác.
 */
export function hopBaoSoDo(soDo: SoDoLine, may: readonly MayTrongLo[]): BBox {
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let caoMax = 0;
  for (const m of may) caoMax = Math.max(caoMax, Math.max(0, m.kichThuocMm.caoMm) / 1000);
  for (const vt of soDo.viTriMoi.values()) {
    xMin = Math.min(xMin, vt.x - soDo.oRongM / 2);
    xMax = Math.max(xMax, vt.x + soDo.oRongM / 2);
    zMin = Math.min(zMin, vt.z - soDo.oSauM / 2);
    zMax = Math.max(zMax, vt.z + soDo.oSauM / 2);
    yMin = Math.min(yMin, vt.y);
    yMax = Math.max(yMax, vt.y + caoMax);
  }
  return { minX: xMin, maxX: xMax, minY: yMin, maxY: yMax, minZ: zMin, maxZ: zMax };
}
