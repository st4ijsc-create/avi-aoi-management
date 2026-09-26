/**
 * mucChiTiet.ts — LOD bốn bậc (§10B.3).
 *
 * | Bậc | Điều kiện                                  | Vẽ gì                     |
 * |-----|--------------------------------------------|---------------------------|
 * | L0  | <= 8 máy gần camera nhất VÀ khoảng cách < 25m | GLB thật, đầy đủ        |
 * | L1  | < 60 m                                     | Khối thủ tục 7 hình       |
 * | L2  | < 150 m                                    | Hộp đơn (12 tam giác)     |
 * | L3  | >= 150 m hoặc ngoài khung nhìn             | Không vẽ                  |
 *
 * Ngân sách CỨNG: tối đa 8 GLB nạp đồng thời. Vượt thì thay thế theo LRU.
 * Điều này giữ ngân sách §4 kể cả khi người dùng nhập 43 model nặng.
 *
 * ★ Module THUẦN: không import three.js, không import react.
 * ★ Tất định: không Math.random(), không Date.now() — "thời điểm" LRU do người
 *   gọi truyền vào dưới dạng SỐ ĐẾM LƯỢT tăng dần, không phải đồng hồ hệ thống.
 */

import { khoangCach, type DiemScene } from "./heToaDo";

/** Bốn bậc chi tiết. L3 nghĩa là KHÔNG vẽ. */
export type BacChiTiet = "L0" | "L1" | "L2" | "L3";

/** Ngưỡng khoảng cách (MÉT) và trần GLB — spec §10B.3. */
export const NGUONG_L0_MET = 25;
export const NGUONG_L1_MET = 60;
export const NGUONG_L2_MET = 150;
/** Trần cứng: tối đa 8 GLB đồng thời. */
export const TRAN_GLB_DONG_THOI = 8;

/** Máy đầu vào cho phép tính LOD. Vị trí đã ở hệ SCENE (mét). */
export interface MayChoLod {
  /** Khoá ổn định của máy — dùng làm định danh LRU, thường là `machine:42`. */
  khoa: string;
  /** Vị trí tâm máy trong scene, MÉT. */
  viTri: DiemScene;
  /**
   * Máy này có model GLB để vẽ ở L0 không. Máy không có GLB không bao giờ được
   * xếp L0 — nếu xếp thì nó chiếm một suất trong trần 8 mà chẳng vẽ gì thêm.
   */
  coModel?: boolean;
  /** Máy nằm ngoài khung nhìn (do người gọi cull) — ép xuống L3. */
  ngoaiKhungNhin?: boolean;
}

/** Kết quả cho một máy. */
export interface KetQuaLod {
  khoa: string;
  bac: BacChiTiet;
  /** Khoảng cách tới camera, MÉT — để UI hiện lý do khi cần gỡ lỗi. */
  khoangCachMet: number;
  /** Máy này có đang giữ một suất GLB không (chỉ đúng khi bac === "L0"). */
  giuSuatGlb: boolean;
}

export interface KetQuaChonMucChiTiet {
  /** Bậc từng máy, thứ tự giữ NGUYÊN thứ tự đầu vào (tất định). */
  ketQua: KetQuaLod[];
  /** Tra nhanh khoá -> bậc. */
  theoKhoa: Map<string, BacChiTiet>;
  /** Các khoá đang giữ suất GLB, tối đa {@link TRAN_GLB_DONG_THOI}. */
  khoaL0: string[];
  /** Số máy theo từng bậc — dùng cho `window.__thongKeVe` của e2e §13.2. */
  demTheoBac: Record<BacChiTiet, number>;
}

export interface CauHinhLod {
  nguongL0Met?: number;
  nguongL1Met?: number;
  nguongL2Met?: number;
  tranGlb?: number;
}

/**
 * Bậc THEO KHOẢNG CÁCH đơn thuần, chưa xét trần 8 GLB và chưa xét khung nhìn.
 * Tách riêng để test được từng luật một.
 */
export function bacTheoKhoangCach(
  khoangCachMet: number,
  cauHinh: CauHinhLod = {},
): BacChiTiet {
  const nguong0 = cauHinh.nguongL0Met ?? NGUONG_L0_MET;
  const nguong1 = cauHinh.nguongL1Met ?? NGUONG_L1_MET;
  const nguong2 = cauHinh.nguongL2Met ?? NGUONG_L2_MET;
  if (!Number.isFinite(khoangCachMet)) return "L3";
  if (khoangCachMet < nguong0) return "L0";
  if (khoangCachMet < nguong1) return "L1";
  if (khoangCachMet < nguong2) return "L2";
  return "L3";
}

/**
 * Chọn bậc chi tiết cho từng máy.
 *
 * Luật áp dụng theo thứ tự:
 *   1. Ngoài khung nhìn -> L3 ngay, không tốn suất GLB nào.
 *   2. Bậc thô theo khoảng cách (bảng §10B.3).
 *   3. L0 chỉ dành cho <= `tranGlb` máy GẦN NHẤT có model. Máy đủ gần nhưng
 *      không lọt top hoặc không có model bị HẠ xuống L1 (khối thủ tục), không
 *      bị bỏ vẽ — hạ chi tiết chứ không biến mất.
 *
 * Tất định: khi hai máy cách camera BẰNG NHAU, thứ tự ưu tiên quyết bằng `khoa`
 * (so sánh chuỗi), không bằng thứ tự đầu vào — nên đảo thứ tự danh sách đầu vào
 * không đổi tập L0.
 */
export function chonMucChiTiet(
  may: MayChoLod[],
  viTriCamera: DiemScene,
  cauHinh: CauHinhLod = {},
): KetQuaChonMucChiTiet {
  const tranGlb = cauHinh.tranGlb ?? TRAN_GLB_DONG_THOI;

  const doDuoc = may.map((m, thuTuVao) => ({
    m,
    thuTuVao,
    d: khoangCach(m.viTri, viTriCamera),
  }));

  // Ứng viên L0: trong khung nhìn, có model, đủ gần theo ngưỡng L0.
  const ungVien = doDuoc
    .filter(
      (x) =>
        !x.m.ngoaiKhungNhin &&
        x.m.coModel === true &&
        bacTheoKhoangCach(x.d, cauHinh) === "L0",
    )
    .sort((a, b) => (a.d !== b.d ? a.d - b.d : a.m.khoa < b.m.khoa ? -1 : 1));

  const duocL0 = new Set<string>(
    ungVien.slice(0, Math.max(0, tranGlb)).map((x) => x.m.khoa),
  );

  const demTheoBac: Record<BacChiTiet, number> = { L0: 0, L1: 0, L2: 0, L3: 0 };
  const theoKhoa = new Map<string, BacChiTiet>();

  const ketQua: KetQuaLod[] = doDuoc.map(({ m, d }) => {
    let bac: BacChiTiet;
    if (m.ngoaiKhungNhin) {
      bac = "L3";
    } else {
      const tho = bacTheoKhoangCach(d, cauHinh);
      // Đủ gần cho L0 nhưng không giữ được suất -> hạ về L1, KHÔNG bỏ vẽ.
      bac = tho === "L0" && !duocL0.has(m.khoa) ? "L1" : tho;
    }
    demTheoBac[bac] += 1;
    theoKhoa.set(m.khoa, bac);
    return { khoa: m.khoa, bac, khoangCachMet: d, giuSuatGlb: bac === "L0" };
  });

  return {
    ketQua,
    theoKhoa,
    khoaL0: ketQua.filter((k) => k.bac === "L0").map((k) => k.khoa),
    demTheoBac,
  };
}

// ---------------------------------------------------------------------------
// Bộ nhớ đệm GLB theo LRU — trần cứng 8
// ---------------------------------------------------------------------------

export interface KetQuaCapNhatLru {
  /** Khoá đang nằm trong bộ đệm, sắp từ CŨ nhất đến MỚI nhất được dùng. */
  dangGiu: string[];
  /** Khoá vừa bị đẩy ra ở lượt này — người gọi phải `dispose()` (RB-7). */
  daDay: string[];
  /** Khoá vừa được nạp mới ở lượt này. */
  daNap: string[];
}

/**
 * Bộ đệm GLB LRU với trần cứng.
 *
 * Vì sao TỰ VIẾT thay vì Map thuần: `dispose()` của three không tự chạy (RB-7),
 * nên người gọi PHẢI biết chính xác khoá nào bị đẩy ra ở lượt nào. Một Map cắt
 * bớt âm thầm sẽ rò VRAM — đúng lớp lỗi mà RB-7 cảnh báo.
 *
 * Tất định: "gần đây" đo bằng SỐ ĐẾM LƯỢT nội bộ tăng dần, không phải Date.now().
 */
export class BoDemGlbLru {
  private readonly tran: number;
  /** khoá -> số lượt lúc dùng gần nhất. */
  private lanDung = new Map<string, number>();
  private dem = 0;

  constructor(tran: number = TRAN_GLB_DONG_THOI) {
    this.tran = Math.max(0, Math.floor(tran));
  }

  /** Trần cứng của bộ đệm này. */
  get tranCung(): number {
    return this.tran;
  }

  /** Số khoá đang giữ. */
  get soDangGiu(): number {
    return this.lanDung.size;
  }

  /** Khoá này đang trong bộ đệm chưa? */
  dangCo(khoa: string): boolean {
    return this.lanDung.has(khoa);
  }

  /**
   * Yêu cầu bộ đệm chứa đúng tập `khoaCanDung` (thường là `khoaL0` của
   * {@link chonMucChiTiet}). Khoá đã có được đánh dấu vừa dùng; khoá mới được
   * nạp; khi vượt trần, khoá LÂU NHẤT chưa dùng bị đẩy ra.
   *
   * Khoá TRONG `khoaCanDung` không bao giờ bị đẩy ra ở cùng lượt — nếu số khoá
   * cần dùng vượt trần thì chỉ `tran` khoá đầu (theo thứ tự truyền vào) được giữ,
   * phần thừa KHÔNG được nạp và trả về trong `daDay` là rỗng.
   *
   * ★ Đây là chính sách LRU thuần: khoá KHÔNG còn cần vẫn được GIỮ nếu bộ đệm
   *   chưa chạm trần — vì camera thường quay lại chỗ cũ, và nạp lại GLB tốn hơn
   *   giữ. Muốn thả hẳn phần không dùng nữa (đổi tầng, đổi phạm vi Line, unmount
   *   canvas) thì gọi {@link thaKhongDung} hoặc {@link xoaSach} — hai hàm đó mới
   *   trả khoá ra cho `dispose()` (RB-7).
   */
  capNhat(khoaCanDung: string[]): KetQuaCapNhatLru {
    const canDung = khoaCanDung.slice(0, this.tran);
    const daNap: string[] = [];

    for (const khoa of canDung) {
      if (!this.lanDung.has(khoa)) daNap.push(khoa);
      this.dem += 1;
      this.lanDung.set(khoa, this.dem);
    }

    const giuLai = new Set(canDung);
    const daDay: string[] = [];
    while (this.lanDung.size > this.tran) {
      let cuNhat: string | null = null;
      let luotCuNhat = Infinity;
      for (const [khoa, luot] of this.lanDung) {
        if (giuLai.has(khoa)) continue;
        if (luot < luotCuNhat) {
          luotCuNhat = luot;
          cuNhat = khoa;
        }
      }
      // Không còn khoá nào đẩy được (mọi khoá đều đang cần) — dừng, không xoá bừa.
      if (cuNhat === null) break;
      this.lanDung.delete(cuNhat);
      daDay.push(cuNhat);
    }

    return { dangGiu: this.danhSachTheoLru(), daDay, daNap };
  }

  /**
   * Thả mọi khoá KHÔNG nằm trong `khoaConDung`, trả về danh sách đã thả để người
   * gọi `dispose()` (RB-7).
   *
   * Vì sao cần hàm riêng: {@link capNhat} chỉ đẩy khi VƯỢT TRẦN, nên khi mọi máy
   * rời L0 (người dùng lùi camera ra xa, đổi tầng, đổi phạm vi Line) thì 8 GLB
   * nằm lại trong bộ đệm vĩnh viễn và VRAM không bao giờ được thu hồi — three.js
   * KHÔNG tự thu hồi bộ nhớ GPU (RB-7). Đây là điểm mà bộ đệm LRU thuần không tự
   * xử lý được, phải để tầng gọi quyết định khi nào "thôi hẳn".
   */
  thaKhongDung(khoaConDung: string[]): string[] {
    const giuLai = new Set(khoaConDung);
    const daTha: string[] = [];
    for (const khoa of this.danhSachTheoLru()) {
      if (giuLai.has(khoa)) continue;
      this.lanDung.delete(khoa);
      daTha.push(khoa);
    }
    return daTha;
  }

  /** Khoá đang giữ, sắp từ CŨ nhất đến MỚI nhất được dùng. */
  danhSachTheoLru(): string[] {
    return [...this.lanDung.entries()]
      .sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1))
      .map(([khoa]) => khoa);
  }

  /** Xoá sạch bộ đệm, trả về mọi khoá để người gọi `dispose()` (RB-7). */
  xoaSach(): string[] {
    const con = [...this.lanDung.keys()];
    this.lanDung.clear();
    this.dem = 0;
    return con;
  }
}
