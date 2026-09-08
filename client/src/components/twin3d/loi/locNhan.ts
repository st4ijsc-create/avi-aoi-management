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
 *   4. Sau cùng cắt về `TRAN_NHAN_DOM` (30).
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

/** Nhãn đã được chọn để vẽ. */
export interface NhanDuocVe {
  khoa: string;
  x: number;
  y: number;
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
   * ★★★ ĐỢT 23 M1 — TỔNG số nhãn **BỊ GIẤU** (ngoài khung + chồng + vượt trần
   * + bị lọc theo chính sách). Đây là con số màn hình phải NÓI RA.
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

  // ★ Chính sách chọn ai được nhãn — chạy TRƯỚC phép sắp/khử chồng, vì nó đổi
  //   TẬP ứng viên chứ không đổi thứ tự. Nhãn đang CHỌN luôn được giữ: người
  //   dùng vừa bấm vào nó, giấu tên đúng cái họ vừa chọn là vô lý.
  const theoChinhSach = cauHinh.chiNhanBatThuong
    ? trongKhung.filter((n) => n.batThuong === true || n.dangChon === true)
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

  for (const n of daSap) {
    const hop = hopNhan(n, rongMacDinh, caoMacDinh);

    // Khử chồng lấp: nếu bbox đè lên một nhãn ĐÃ giữ (ưu tiên cao hơn) thì bỏ.
    let chongLap = false;
    for (const g of hopDaGiu) {
      if (haiHopChongNhau(g, hop)) {
        chongLap = true;
        break;
      }
    }
    if (chongLap) {
      soBiChongLap += 1;
      continue;
    }
    if (ve.length >= tranNhan) {
      soVuotTran += 1;
      continue;
    }
    ve.push({ khoa: n.khoa, x: n.x, y: n.y, diemUuTien: diemUuTienNhan(n), hop });
    hopDaGiu.push(hop);
  }

  return {
    ve,
    tongUngVien: ungVien.length,
    soNgoaiKhung,
    soBiChongLap,
    soVuotTran,
    // MỘT phép cộng, ở MỘT nơi — xem docblock `soBiGiau`.
    soBiGiau: soNgoaiKhung + soBiLocChinhSach + soBiChongLap + soVuotTran,
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
