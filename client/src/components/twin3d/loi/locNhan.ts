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
 *   3. Nhãn chồng nhau trong bán kính `banKinhVaChamPx` → giữ cái ưu tiên cao hơn.
 *   4. Sau cùng cắt về `TRAN_NHAN_DOM` (30).
 *
 * ⚠ Luật 3 chạy TRƯỚC luật 4 có chủ đích: nếu cắt 30 trước rồi mới khử chồng,
 * ta có thể còn 8 nhãn hiển thị trong khi 22 suất bị các nhãn chồng nhau ăn mất.
 */

/** Trần cứng số nhãn DOM đồng thời (§4 — bảng ngân sách hiệu năng). */
export const TRAN_NHAN_DOM = 30;

/** Bán kính va chạm mặc định, PIXEL màn hình. */
export const BAN_KINH_VA_CHAM_PX = 42;

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
}

/** Nhãn đã được chọn để vẽ. */
export interface NhanDuocVe {
  khoa: string;
  x: number;
  y: number;
  /** Điểm ưu tiên đã tính — hiện ra để gỡ lỗi và để test khẳng định thứ tự. */
  diemUuTien: number;
}

export interface KetQuaLocNhan {
  /** Danh sách nhãn được vẽ, đã sắp theo ưu tiên GIẢM DẦN. Tối đa `tranNhan`. */
  ve: NhanDuocVe[];
  /** Tổng ứng viên đưa vào (kể cả ngoài khung) — cho `window.__demNhan`. */
  tongUngVien: number;
  /** Số bị loại vì ngoài khung nhìn. */
  soNgoaiKhung: number;
  /** Số bị loại vì chồng lên một nhãn ưu tiên cao hơn. */
  soBiChongLap: number;
  /** Số bị loại vì đã chạm trần `tranNhan`. */
  soVuotTran: number;
}

export interface CauHinhLocNhan {
  /** Trần nhãn DOM. Mặc định {@link TRAN_NHAN_DOM}. */
  tranNhan?: number;
  /** Bán kính va chạm pixel. Mặc định {@link BAN_KINH_VA_CHAM_PX}. */
  banKinhVaChamPx?: number;
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
 * Lọc nhãn: cull ngoài khung → sắp ưu tiên → khử chồng lấp → cắt trần 30.
 *
 * Hàm THUẦN và TẤT ĐỊNH: cùng đầu vào (ở bất kỳ thứ tự nào) cho cùng đầu ra.
 */
export function locNhan(
  ungVien: NhanUngVien[],
  cauHinh: CauHinhLocNhan = {},
): KetQuaLocNhan {
  const tranNhan = cauHinh.tranNhan ?? TRAN_NHAN_DOM;
  const banKinh = cauHinh.banKinhVaChamPx ?? BAN_KINH_VA_CHAM_PX;
  const banKinhBinhPhuong = banKinh * banKinh;

  const trongKhung = ungVien.filter((n) => !n.ngoaiKhung);
  const soNgoaiKhung = ungVien.length - trongKhung.length;

  // Sắp theo ưu tiên trên BẢN SAO — không làm biến dạng mảng của người gọi.
  const daSap = [...trongKhung].sort(soSanh);

  const ve: NhanDuocVe[] = [];
  let soBiChongLap = 0;
  let soVuotTran = 0;

  for (const n of daSap) {
    // Khử chồng lấp: nếu đè lên một nhãn ĐÃ được giữ (ưu tiên cao hơn) thì bỏ.
    let chongLap = false;
    for (const g of ve) {
      const dx = g.x - n.x;
      const dy = g.y - n.y;
      if (dx * dx + dy * dy < banKinhBinhPhuong) {
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
    ve.push({ khoa: n.khoa, x: n.x, y: n.y, diemUuTien: diemUuTienNhan(n) });
  }

  return {
    ve,
    tongUngVien: ungVien.length,
    soNgoaiKhung,
    soBiChongLap,
    soVuotTran,
  };
}
