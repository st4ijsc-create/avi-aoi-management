/**
 * hieuChinhNhapModel.ts — Hiệu chỉnh khi nhập file 3D (§10A.1, §10B.2).
 *
 * File CAD KHÔNG tự khai đơn vị một cách đáng tin. Nhập sai đơn vị cho ra nhà
 * xưởng lớn gấp 1.000 lần hoặc nhỏ bằng hạt gạo, và người dùng sẽ không hiểu vì
 * sao. Module này là phần TOÁN của hộp thoại hiệu chỉnh bắt buộc:
 *
 *   • Đơn vị nguồn:  mm | cm | m | inch          -> quy về mm
 *   • Trục lên:      Z (CAD) | Y (glTF)          -> quy về Y-up của scene
 *   • Xoay quanh trục lên: độ
 *   • Điểm gốc:      góc bbox | tâm bbox | gốc file
 *
 * ★ Module THUẦN: không import three.js, không import react. Ma trận biến đổi
 *   trả về là mảng 16 số THEO CỘT (column-major) — đúng thứ tự mà
 *   `THREE.Matrix4.fromArray()` đọc, nên component .tsx nạp thẳng được mà module
 *   này vẫn test được trong environment "node".
 * ★ Tất định: không Math.random(), không Date.now().
 */

import {
  bboxCoThuc,
  bboxRong,
  kichThuocBBox,
  tamBBox,
  type BBox,
} from "./heToaDo";

/** Đơn vị nguồn nhận được từ file CAD/glTF. */
export type DonViNguon = "mm" | "cm" | "m" | "inch";

/** Trục hướng LÊN trong file nguồn. CAD thường Z-up, glTF Y-up. */
export type TrucLen = "Y" | "Z";

/** Cách chọn điểm gốc của model sau khi nhập. */
export type KieuDiemGoc = "goc_bbox" | "tam_bbox" | "goc_file";

/** Hệ số quy đổi mỗi đơn vị nguồn sang MILIMÉT — nguồn sự thật duy nhất. */
export const HE_SO_SANG_MM: Readonly<Record<DonViNguon, number>> = Object.freeze({
  mm: 1,
  cm: 10,
  m: 1000,
  inch: 25.4,
});

/** Danh sách đơn vị cho dropdown UI, thứ tự cố định. */
export const DANH_SACH_DON_VI: readonly DonViNguon[] = ["mm", "cm", "m", "inch"] as const;

/** Ngưỡng cảnh báo lệch kích thước so với khai báo (§10B.2): 30%. */
export const NGUONG_LECH = 0.3;

export interface CauHinhHieuChinh {
  donViNguon: DonViNguon;
  trucLen: TrucLen;
  /** Góc xoay quanh trục LÊN của scene (trục Y), đơn vị ĐỘ. */
  xoayQuanhTrucLenDo: number;
  kieuDiemGoc: KieuDiemGoc;
}

/** Cấu hình mặc định của hộp thoại: mm + Z-up (giả định CAD, an toàn nhất). */
export const CAU_HINH_MAC_DINH: CauHinhHieuChinh = {
  donViNguon: "mm",
  trucLen: "Z",
  xoayQuanhTrucLenDo: 0,
  kieuDiemGoc: "goc_bbox",
};

export interface KetQuaHieuChinh {
  /** BBox sau hiệu chỉnh, đơn vị MILIMÉT, trong hệ trục Y-up của scene. */
  bboxMoi: BBox;
  /**
   * Ma trận 4x4 COLUMN-MAJOR (16 số) đưa toạ độ file nguồn về hệ đã hiệu chỉnh.
   * Nạp bằng `new THREE.Matrix4().fromArray(maTranBienDoi)` ở tầng .tsx.
   */
  maTranBienDoi: number[];
  /** Kích thước bao ngoài sau hiệu chỉnh (mm) — để hiện câu xác nhận cho người dùng. */
  kichThuocMm: { rongMm: number; caoMm: number; sauMm: number };
  /** Hệ số tỉ lệ thực tế đã áp (đơn vị nguồn -> mm). */
  heSoTiLe: number;
}

// ---------------------------------------------------------------------------
// Ma trận 4x4 column-major, tự viết để không phải kéo three vào
// ---------------------------------------------------------------------------

/** Ma trận đơn vị, column-major. */
export function maTranDonVi(): number[] {
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

/**
 * Nhân hai ma trận column-major: kết quả áp `b` TRƯỚC rồi `a` (giống three:
 * `a.multiply(b)`). Viết tay 16 dòng thay vì kéo three vì đây là 4x4 duy nhất.
 */
export function nhanMaTran(a: number[], b: number[]): number[] {
  const ket = new Array<number>(16).fill(0);
  for (let cot = 0; cot < 4; cot++) {
    for (let hang = 0; hang < 4; hang++) {
      let tong = 0;
      for (let k = 0; k < 4; k++) {
        // a[hang + k*4] = phần tử (hang, k) của a; b[k + cot*4] = (k, cot) của b.
        tong += a[hang + k * 4] * b[k + cot * 4];
      }
      ket[hang + cot * 4] = tong;
    }
  }
  return ket;
}

/** Áp ma trận column-major lên một điểm (w = 1). */
export function apMaTranLenDiem(
  m: number[],
  p: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  return {
    x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  };
}

/** Ma trận co giãn đều. */
export function maTranTiLe(heSo: number): number[] {
  // prettier-ignore
  return [
    heSo, 0, 0, 0,
    0, heSo, 0, 0,
    0, 0, heSo, 0,
    0, 0, 0, 1,
  ];
}

/** Ma trận tịnh tiến. */
export function maTranTinhTien(x: number, y: number, z: number): number[] {
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

/** Ma trận xoay quanh trục Y (trục LÊN của scene), góc RADIAN. */
export function maTranXoayQuanhY(gocRad: number): number[] {
  const c = Math.cos(gocRad);
  const s = Math.sin(gocRad);
  // prettier-ignore
  return [
     c, 0, -s, 0,
     0, 1,  0, 0,
     s, 0,  c, 0,
     0, 0,  0, 1,
  ];
}

/**
 * Ma trận đổi trục lên Z-up sang Y-up: xoay -90° quanh trục X.
 * (x, y, z)_Zup  ->  (x, z, -y)_Yup. Trục cao của file (Z) thành trục cao của
 * scene (Y); Y của file (hướng "vào sâu") thành -Z của scene.
 */
export function maTranZupSangYup(): number[] {
  // prettier-ignore
  return [
    1,  0,  0, 0,
    0,  0, -1, 0,
    0,  1,  0, 0,
    0,  0,  0, 1,
  ];
}

// ---------------------------------------------------------------------------
// Quy đổi đơn vị
// ---------------------------------------------------------------------------

/** Quy đổi một giá trị từ đơn vị nguồn sang MILIMÉT. */
export function doiSangMm(giaTri: number, donVi: DonViNguon): number {
  return giaTri * HE_SO_SANG_MM[donVi];
}

/** Hệ số quy đổi giữa hai đơn vị bất kỳ (từ -> sang). */
export function heSoDoiDonVi(tu: DonViNguon, sang: DonViNguon): number {
  return HE_SO_SANG_MM[tu] / HE_SO_SANG_MM[sang];
}

// ---------------------------------------------------------------------------
// Hiệu chỉnh
// ---------------------------------------------------------------------------

/** BBox sau khi áp ma trận: biến đổi cả 8 đỉnh rồi bao lại (đúng cả khi xoay). */
export function bienDoiBBox(b: BBox, m: number[]): BBox {
  if (!bboxCoThuc(b)) return bboxRong();
  const dinh = [
    { x: b.minX, y: b.minY, z: b.minZ },
    { x: b.minX, y: b.minY, z: b.maxZ },
    { x: b.minX, y: b.maxY, z: b.minZ },
    { x: b.minX, y: b.maxY, z: b.maxZ },
    { x: b.maxX, y: b.minY, z: b.minZ },
    { x: b.maxX, y: b.minY, z: b.maxZ },
    { x: b.maxX, y: b.maxY, z: b.minZ },
    { x: b.maxX, y: b.maxY, z: b.maxZ },
  ].map((p) => apMaTranLenDiem(m, p));

  const ket = bboxRong();
  for (const d of dinh) {
    if (d.x < ket.minX) ket.minX = d.x;
    if (d.y < ket.minY) ket.minY = d.y;
    if (d.z < ket.minZ) ket.minZ = d.z;
    if (d.x > ket.maxX) ket.maxX = d.x;
    if (d.y > ket.maxY) ket.maxY = d.y;
    if (d.z > ket.maxZ) ket.maxZ = d.z;
  }
  return ket;
}

/**
 * Áp toàn bộ hiệu chỉnh lên bbox đọc được từ file.
 *
 * Thứ tự áp (quan trọng, viết ngược thì gốc lệch):
 *   1. Tỉ lệ đơn vị nguồn -> mm
 *   2. Đổi trục lên (Z-up -> Y-up) nếu cần
 *   3. Xoay quanh trục lên của scene (Y)
 *   4. Tịnh tiến đặt điểm gốc
 *
 * `bbox` đầu vào ở ĐƠN VỊ NGUỒN và HỆ TRỤC NGUỒN; `bboxMoi` trả về ở MILIMÉT và
 * hệ Y-up của scene.
 */
export function apDungHieuChinh(
  bbox: BBox,
  cauHinh: CauHinhHieuChinh,
): KetQuaHieuChinh {
  const heSoTiLe = HE_SO_SANG_MM[cauHinh.donViNguon];

  let m = maTranTiLe(heSoTiLe);
  if (cauHinh.trucLen === "Z") {
    m = nhanMaTran(maTranZupSangYup(), m);
  }
  const gocRad = (cauHinh.xoayQuanhTrucLenDo * Math.PI) / 180;
  if (gocRad !== 0) {
    m = nhanMaTran(maTranXoayQuanhY(gocRad), m);
  }

  // Bbox sau tỉ lệ + trục + xoay, TRƯỚC khi đặt gốc.
  const truocGoc = bienDoiBBox(bbox, m);

  let dich = { x: 0, y: 0, z: 0 };
  if (bboxCoThuc(truocGoc)) {
    if (cauHinh.kieuDiemGoc === "goc_bbox") {
      // Góc thấp nhất về gốc toạ độ: model đứng trên sàn tại (0,0,0).
      dich = { x: -truocGoc.minX, y: -truocGoc.minY, z: -truocGoc.minZ };
    } else if (cauHinh.kieuDiemGoc === "tam_bbox") {
      // Tâm mặt bằng về gốc, nhưng ĐÁY vẫn chạm sàn — máy lơ lửng là lỗi hiển
      // thị mà không ai báo, nên tâm ở đây chỉ áp cho hai trục ngang.
      const tam = tamBBox(truocGoc);
      dich = { x: -tam.x, y: -truocGoc.minY, z: -tam.z };
    }
    // "goc_file": giữ nguyên gốc của file, không dịch.
  }

  const maTranBienDoi =
    dich.x === 0 && dich.y === 0 && dich.z === 0
      ? m
      : nhanMaTran(maTranTinhTien(dich.x, dich.y, dich.z), m);

  const bboxMoi = bienDoiBBox(bbox, maTranBienDoi);
  const co = kichThuocBBox(bboxMoi);

  return {
    bboxMoi,
    maTranBienDoi,
    kichThuocMm: { rongMm: co.rong, caoMm: co.cao, sauMm: co.sau },
    heSoTiLe,
  };
}

// ---------------------------------------------------------------------------
// So sánh với kích thước khai báo (§10B.2)
// ---------------------------------------------------------------------------

/** Một trục bị lệch. */
export interface TrucLech {
  truc: "rong" | "cao" | "sau";
  modelMm: number;
  khaiBaoMm: number;
  /** Tỉ lệ lệch tương đối so với KHAI BÁO. 0.31 nghĩa là lệch 31%. */
  tiLeLech: number;
}

export interface KetQuaSoSanhKichThuoc {
  /** ★ Cờ chặn: có ít nhất một trục lệch quá {@link NGUONG_LECH}. */
  lechQuaNguong: boolean;
  /** Các trục vượt ngưỡng, thứ tự cố định rong -> cao -> sau. */
  trucLech: TrucLech[];
  /** Lệch lớn nhất trong ba trục (tỉ lệ tương đối). */
  lechLonNhat: number;
  /** Không so sánh được (khai báo thiếu hoặc bằng 0) — KHÁC với "không lệch". */
  khongSoSanhDuoc: boolean;
}

/**
 * So bbox model với kích thước KHAI BÁO của máy (`twin_dat_cho.rongMm/caoMm/sauMm`).
 * Lệch > 30% thì UI phải hỏi "[Theo model]" hay "[Giữ khai báo, co model]".
 *
 * ★ Khai báo bằng 0 hoặc thiếu KHÔNG được coi là "khớp" — đó là chưa đo (NT-3),
 *   trả `khongSoSanhDuoc = true` để UI hiện badge riêng thay vì im lặng cho qua.
 */
export function soSanhVoiKhaiBao(
  kichThuocModelMm: { rongMm: number; caoMm: number; sauMm: number },
  khaiBaoMm: { rongMm: number; caoMm: number; sauMm: number },
  nguong: number = NGUONG_LECH,
): KetQuaSoSanhKichThuoc {
  const truc: { truc: TrucLech["truc"]; model: number; khai: number }[] = [
    { truc: "rong", model: kichThuocModelMm.rongMm, khai: khaiBaoMm.rongMm },
    { truc: "cao", model: kichThuocModelMm.caoMm, khai: khaiBaoMm.caoMm },
    { truc: "sau", model: kichThuocModelMm.sauMm, khai: khaiBaoMm.sauMm },
  ];

  const soSanhDuoc = truc.filter(
    (t) => Number.isFinite(t.khai) && t.khai > 0 && Number.isFinite(t.model),
  );
  if (soSanhDuoc.length === 0) {
    return {
      lechQuaNguong: false,
      trucLech: [],
      lechLonNhat: 0,
      khongSoSanhDuoc: true,
    };
  }

  const trucLech: TrucLech[] = [];
  let lechLonNhat = 0;
  for (const t of soSanhDuoc) {
    const tiLeLech = Math.abs(t.model - t.khai) / t.khai;
    if (tiLeLech > lechLonNhat) lechLonNhat = tiLeLech;
    if (tiLeLech > nguong) {
      trucLech.push({
        truc: t.truc,
        modelMm: t.model,
        khaiBaoMm: t.khai,
        tiLeLech,
      });
    }
  }

  return {
    lechQuaNguong: trucLech.length > 0,
    trucLech,
    lechLonNhat,
    khongSoSanhDuoc: false,
  };
}

/**
 * Hệ số co model về đúng kích thước khai báo (nút "[Giữ khai báo, co model]").
 * Co ĐỀU theo trục chật nhất để model không bị méo và không tràn khỏi ô đã khai.
 * Kích thước model bằng 0 ở mọi trục -> trả 1 (không co), vì bbox suy biến là lỗi
 * của file, không sửa được bằng phép nhân.
 */
export function heSoCoVeKhaiBao(
  kichThuocModelMm: { rongMm: number; caoMm: number; sauMm: number },
  khaiBaoMm: { rongMm: number; caoMm: number; sauMm: number },
): number {
  const cap: [number, number][] = [
    [khaiBaoMm.rongMm, kichThuocModelMm.rongMm],
    [khaiBaoMm.caoMm, kichThuocModelMm.caoMm],
    [khaiBaoMm.sauMm, kichThuocModelMm.sauMm],
  ];
  let heSo = Infinity;
  for (const [khai, model] of cap) {
    if (!Number.isFinite(khai) || khai <= 0) continue;
    if (!Number.isFinite(model) || model <= 0) continue;
    heSo = Math.min(heSo, khai / model);
  }
  return Number.isFinite(heSo) ? heSo : 1;
}
