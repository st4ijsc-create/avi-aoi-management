/**
 * matDoKhungHinh.ts — theo dõi fps và TỰ HẠ CHẤT LƯỢNG khi máy yếu (§4 "Chống vỡ").
 *
 * Luật spec: **fps trung bình < 25 trong 3 giây → hạ một bậc**:
 *   day_du → tat_bong_do → dpr_mot → tat_nhan → chi_hop
 *
 * Thuần .ts: KHÔNG import three/react, KHÔNG đọc `performance` hay `localStorage`
 * ngầm. Thời gian được TIÊM VÀO qua tham số `mocMs` của `ghiKhungHinh()`, nên test
 * chạy được trong node và mô phỏng được 3 giây mà không phải chờ 3 giây thật.
 *
 * ⚠ Bẫy đã tránh: nếu đo bằng "fps tức thời của một khung" thì một khung 40ms lẻ
 * (GC, tab vừa hiện lại) đã đủ hạ chất lượng vĩnh viễn. Ta đo TRUNG BÌNH TRÊN CỬA
 * SỔ TRƯỢT 3 giây, và chỉ hạ khi TOÀN cửa sổ dưới ngưỡng.
 *
 * ⚠ Bẫy thứ hai đã tránh: sau khi hạ bậc, cửa sổ đo được XOÁ. Không xoá thì các
 * khung chậm cũ vẫn nằm trong cửa sổ và kéo bậc rơi tự do 4 nấc trong 3 giây, dù
 * bậc đầu tiên đã đủ cứu fps.
 */

/** Năm bậc chất lượng, từ đầy đủ xuống thấp nhất. Thứ tự CỐ ĐỊNH. */
export type BacChatLuong =
  | "day_du"
  | "tat_bong_do"
  | "dpr_mot"
  | "tat_nhan"
  | "chi_hop";

/** Thang bậc theo thứ tự hạ dần. Index lớn hơn = chất lượng thấp hơn. */
export const THANG_BAC: readonly BacChatLuong[] = [
  "day_du",
  "tat_bong_do",
  "dpr_mot",
  "tat_nhan",
  "chi_hop",
] as const;

/** Ngưỡng fps trung bình để hạ bậc (§4). */
export const NGUONG_FPS_HA = 25;

/** Cửa sổ đo, mili-giây (§4: "trong 3 giây"). */
export const CUA_SO_MS = 3000;

/**
 * Ngưỡng fps để tự NÂNG lại bậc. Cao hơn hẳn ngưỡng hạ (25) để tạo TRỄ TRỄ
 * (hysteresis) — không có nó, một máy chạy quanh quẩn 25 fps sẽ bật/tắt bóng đổ
 * mỗi 3 giây, khó chịu hơn hẳn việc cứ ở bậc thấp.
 */
export const NGUONG_FPS_NANG = 50;

/** Đặc tính hiển thị suy ra từ một bậc — component đọc bảng này, không tự if/else. */
export interface DacTinhBac {
  bac: BacChatLuong;
  bongDo: boolean;
  /** Trần DPR. §4 bắt clamp ≤ 1,5 ở mọi bậc. */
  dprToiDa: number;
  nhan: boolean;
  /** false = vẽ đủ hộp con của khối; true = chỉ vẽ MỘT hộp bao. */
  chiHopBao: boolean;
}

const BANG_DAC_TINH: Readonly<Record<BacChatLuong, DacTinhBac>> = {
  day_du: { bac: "day_du", bongDo: true, dprToiDa: 1.5, nhan: true, chiHopBao: false },
  tat_bong_do: { bac: "tat_bong_do", bongDo: false, dprToiDa: 1.5, nhan: true, chiHopBao: false },
  dpr_mot: { bac: "dpr_mot", bongDo: false, dprToiDa: 1, nhan: true, chiHopBao: false },
  tat_nhan: { bac: "tat_nhan", bongDo: false, dprToiDa: 1, nhan: false, chiHopBao: false },
  chi_hop: { bac: "chi_hop", bongDo: false, dprToiDa: 1, nhan: false, chiHopBao: true },
};

export function dacTinhCuaBac(bac: BacChatLuong): DacTinhBac {
  return BANG_DAC_TINH[bac] ?? BANG_DAC_TINH.day_du;
}

export interface KetQuaGhiKhung {
  /** Bậc SAU khi ghi khung hình này. */
  bac: BacChatLuong;
  /** Bậc có đổi ở lần ghi này không — người gọi dùng để `invalidate()` một lần. */
  daDoi: boolean;
  /** fps trung bình trên cửa sổ hiện tại; `null` khi chưa đủ hai mốc để tính. */
  fpsTrungBinh: number | null;
  /** Số khung đang nằm trong cửa sổ trượt. */
  soKhungTrongCuaSo: number;
}

export interface CauHinhMatDo {
  nguongHa?: number;
  nguongNang?: number;
  cuaSoMs?: number;
  /** Bậc khởi đầu — dùng khi khôi phục từ localStorage. */
  bacBanDau?: BacChatLuong;
  /** Cho phép tự nâng lại khi máy khoẻ trở lại. Mặc định true. */
  choPhepNang?: boolean;
}

/**
 * Bộ theo dõi fps. Có trạng thái, nhưng mọi đầu vào thời gian đều TIÊM VÀO.
 */
export class TheoDoiMatDoKhungHinh {
  private mocs: number[] = [];
  private bacHienTai: BacChatLuong;
  private readonly nguongHa: number;
  private readonly nguongNang: number;
  private readonly cuaSoMs: number;
  private readonly choPhepNang: boolean;
  /** Bậc do người dùng ÉP — khi đặt, tự-hạ/tự-nâng ngừng hoạt động. */
  private bacEp: BacChatLuong | null = null;

  constructor(cauHinh: CauHinhMatDo = {}) {
    this.nguongHa = cauHinh.nguongHa ?? NGUONG_FPS_HA;
    this.nguongNang = cauHinh.nguongNang ?? NGUONG_FPS_NANG;
    this.cuaSoMs = cauHinh.cuaSoMs ?? CUA_SO_MS;
    this.choPhepNang = cauHinh.choPhepNang ?? true;
    this.bacHienTai = cauHinh.bacBanDau ?? "day_du";
  }

  /** Bậc đang áp dụng (bậc ép thắng bậc tự động). */
  get bac(): BacChatLuong {
    return this.bacEp ?? this.bacHienTai;
  }

  get dacTinh(): DacTinhBac {
    return dacTinhCuaBac(this.bac);
  }

  /** Đang ở chế độ hiệu năng thấp? (để hiện chip "Chế độ hiệu năng thấp"). */
  get hieuNangThap(): boolean {
    return this.bac !== "day_du";
  }

  /** Người dùng ép một bậc; `null` = trả về tự động. */
  epBac(bac: BacChatLuong | null): void {
    this.bacEp = bac;
    this.mocs = [];
  }

  get dangBiEp(): boolean {
    return this.bacEp !== null;
  }

  /**
   * Ghi một khung hình đã vẽ xong tại mốc `mocMs`.
   *
   * `mocMs` là đồng hồ đơn điệu của người gọi (`performance.now()` ở trình duyệt);
   * mốc lùi hoặc không hữu hạn bị BỎ QUA thay vì làm hỏng phép tính.
   */
  ghiKhungHinh(mocMs: number): KetQuaGhiKhung {
    if (!Number.isFinite(mocMs)) return this.ketQua(false);
    const cuoi = this.mocs[this.mocs.length - 1];
    if (cuoi !== undefined && mocMs < cuoi) return this.ketQua(false);

    this.mocs.push(mocMs);
    // Cắt cửa sổ trượt.
    const gioiHan = mocMs - this.cuaSoMs;
    while (this.mocs.length > 0 && this.mocs[0] < gioiHan) this.mocs.shift();

    // Bậc bị ép → không tự động điều chỉnh.
    if (this.bacEp !== null) return this.ketQua(false);

    const fps = this.tinhFps();
    // Chỉ quyết định khi cửa sổ ĐÃ ĐẦY (trải đủ `cuaSoMs`), tránh hạ bậc vì 2 khung
    // chậm đầu tiên lúc scene còn đang biên dịch shader.
    if (fps === null || !this.cuaSoDay(mocMs)) return this.ketQua(false);

    if (fps < this.nguongHa) {
      const i = THANG_BAC.indexOf(this.bacHienTai);
      if (i < THANG_BAC.length - 1) {
        this.bacHienTai = THANG_BAC[i + 1];
        this.mocs = []; // xoá cửa sổ: xem docblock đầu tệp.
        return this.ketQua(true);
      }
      return this.ketQua(false);
    }

    if (this.choPhepNang && fps > this.nguongNang) {
      const i = THANG_BAC.indexOf(this.bacHienTai);
      if (i > 0) {
        this.bacHienTai = THANG_BAC[i - 1];
        this.mocs = [];
        return this.ketQua(true);
      }
    }
    return this.ketQua(false);
  }

  /** fps trung bình trên cửa sổ; `null` khi chưa đủ hai mốc hoặc thời lượng 0. */
  tinhFps(): number | null {
    if (this.mocs.length < 2) return null;
    const khoang = this.mocs[this.mocs.length - 1] - this.mocs[0];
    if (khoang <= 0) return null;
    // n mốc = n-1 khoảng.
    return ((this.mocs.length - 1) * 1000) / khoang;
  }

  /** Xoá lịch sử đo (dùng khi camera vừa bay xong, đổi cảnh, tab vừa hiện lại). */
  datLai(): void {
    this.mocs = [];
  }

  /**
   * Cửa sổ đã trải đủ thời lượng đo chưa?
   *
   * ★ Dung sai MỘT KHUNG là bắt buộc, không phải nới lỏng
   * tuỳ tiện. Bước cắt giữ mọi mốc `>= mocMs - cuaSoMs`, nên nhịp chạm ĐÚNG mốc
   * biên chỉ xảy ra khi chu kỳ khung chia hết cho `cuaSoMs`: 20 fps (50 ms) chia
   * hết 3000, còn 60 fps (16,67 ms) thì KHÔNG BAO GIỜ. Nếu so `>= cuaSoMs` trần
   * trụi, bộ theo dõi chạy đúng ở 20 fps và IM LẶNG ở 60 fps — đúng loại lỗi
   * "thiết bị đo mù đúng thứ nó đo", và test 60 fps đã bắt được nó.
   */
  private cuaSoDay(mocMs: number): boolean {
    if (this.mocs.length < 2) return false;
    const trai = mocMs - this.mocs[0];
    // Dung sai = MỘT chu kỳ khung trung bình, tự suy từ dữ liệu — không hằng số
    // cứng, vì "một khung" ở 144 fps (7 ms) và ở 10 fps (100 ms) là hai đại lượng
    // rất khác nhau.
    const chuKy = trai / (this.mocs.length - 1);
    return trai >= this.cuaSoMs - chuKy;
  }

  private ketQua(daDoi: boolean): KetQuaGhiKhung {
    return {
      bac: this.bac,
      daDoi,
      fpsTrungBinh: this.tinhFps(),
      soKhungTrongCuaSo: this.mocs.length,
    };
  }
}

/** Khoá localStorage nhớ lựa chọn ép bậc của người dùng (§4). */
export const KHOA_LUU_BAC = "twin3d.bacChatLuong";

/** Đọc bậc đã lưu; trả `null` nếu không có / rác / storage không dùng được. */
export function docBacDaLuu(
  doc: (khoa: string) => string | null = (k) =>
    typeof localStorage === "undefined" ? null : localStorage.getItem(k),
): BacChatLuong | null {
  let gt: string | null = null;
  try {
    gt = doc(KHOA_LUU_BAC);
  } catch {
    return null; // Safari private mode ném khi đọc localStorage.
  }
  return gt !== null && (THANG_BAC as readonly string[]).includes(gt)
    ? (gt as BacChatLuong)
    : null;
}
