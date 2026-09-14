/**
 * tiLeAnhNen.ts — CÔNG CỤ "ĐẶT TỈ LỆ" cho ảnh nền mặt bằng (§7.4, #43).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ MODULE THUẦN — không three, không react, không DOM.
 * ════════════════════════════════════════════════════════════════════════════
 * Toàn bộ câu hỏi của #43 quy về một phép chia: người dùng click HAI điểm trên
 * ảnh, gõ khoảng cách THẬT giữa hai điểm đó, và ta suy ra "một pixel là bao
 * nhiêu milimét". Tách ra đây để phép chia đó test được mà không cần một tấm
 * ảnh, một canvas, hay một chuột.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ `daHieuChuan` LÀ MỘT LỜI KHAI VỀ XUẤT XỨ, KHÔNG PHẢI MỘT CỜ TIỆN LỢI
 * ════════════════════════════════════════════════════════════════════════════
 * `twinCanhRouter.taiAnhNen` đã ghi rõ: tải ảnh lên KHÔNG được đặt `daHieuChuan
 * = true`, vì tải ảnh chỉ cho ta pixel. Chỉ khi ai đó click hai điểm và gõ một
 * khoảng cách đo được thì `tiLeMmMoiPx` mới có xuất xứ.
 *
 * ⇒ Module này là nơi DUY NHẤT sinh ra một tỉ lệ đáng gắn cờ `daHieuChuan`, và
 *   `tinhTiLe` trả về `null` cho mọi đầu vào không đủ điều kiện thay vì trả một
 *   con số kèm cờ false. Một số kèm cờ "chưa chắc" là thứ sẽ có ngày bị đọc mà
 *   không ai nhìn cờ — đúng lớp lỗi NT-3 (có số, không có xuất xứ).
 */

/** Một điểm trên ảnh, đơn vị PIXEL của ảnh gốc (không phải pixel màn hình). */
export interface DiemPx {
  x: number;
  y: number;
}

/**
 * Khoảng cách hai điểm, PIXEL. Trả `NaN` nếu đầu vào không hữu hạn — người gọi
 * phải kiểm, và `tinhTiLe` bên dưới đã kiểm.
 */
export function khoangCachPx(a: DiemPx, b: DiemPx): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Khoảng cách tối thiểu (px) giữa hai điểm hiệu chuẩn.
 *
 * ★★★ VÌ SAO CÓ SÀN NÀY, VÀ VÌ SAO NÓ KHÔNG PHẢI `> 0`.
 *   Hai điểm cách nhau 3 px mà người dùng khai "12 m" cho ra 4.000 mm/px, và
 *   sai số một pixel của cú click (luôn có) đổi kết quả tới **33 %**. Phép chia
 *   vẫn chạy, không gì nổ, và cả nhà xưởng lệch một phần ba. Sàn 20 px giữ sai
 *   số một-pixel dưới 5 %.
 */
export const KHOANG_CACH_TOI_THIEU_PX = 20;

/** Trần hợp lý cho mm mỗi pixel — trên mức này gần như chắc chắn là gõ nhầm. */
export const TI_LE_TOI_DA_MM_MOI_PX = 10_000;

export type LoiTiLe =
  | "thieu_diem"
  | "hai_diem_qua_gan"
  | "khoang_cach_that_khong_hop_le"
  | "ti_le_vo_ly";

export interface KetQuaTiLe {
  /** Số milimét ứng với MỘT pixel ảnh. */
  mmMoiPx: number;
  /** Khoảng cách hai điểm, px — hiện lại cho người dùng đối chiếu. */
  khoangCachPx: number;
  /** Bề rộng/chiều cao ảnh quy ra mm, khi biết kích thước ảnh. */
  rongAnhMm?: number;
  caoAnhMm?: number;
}

/**
 * Suy tỉ lệ từ hai điểm + khoảng cách thật.
 *
 * `khoangCachThatMm` là số NGƯỜI GÕ (thường đọc từ cột kích thước trên bản vẽ).
 * Trả `{ loi }` thay vì ném: đây là đầu vào của người dùng, và một ô nhập sai
 * không phải một sự cố.
 */
export function tinhTiLe(
  a: DiemPx | null,
  b: DiemPx | null,
  khoangCachThatMm: number,
): { ok: true; ketQua: KetQuaTiLe } | { ok: false; loi: LoiTiLe } {
  if (!a || !b) return { ok: false, loi: "thieu_diem" };
  const d = khoangCachPx(a, b);
  if (!Number.isFinite(d) || d < KHOANG_CACH_TOI_THIEU_PX) {
    return { ok: false, loi: "hai_diem_qua_gan" };
  }
  if (!Number.isFinite(khoangCachThatMm) || khoangCachThatMm <= 0) {
    return { ok: false, loi: "khoang_cach_that_khong_hop_le" };
  }
  const mmMoiPx = khoangCachThatMm / d;
  if (!Number.isFinite(mmMoiPx) || mmMoiPx <= 0 || mmMoiPx > TI_LE_TOI_DA_MM_MOI_PX) {
    return { ok: false, loi: "ti_le_vo_ly" };
  }
  return { ok: true, ketQua: { mmMoiPx, khoangCachPx: d } };
}

/**
 * Kích thước ảnh quy ra milimét, dùng tỉ lệ đã hiệu chuẩn.
 *
 * ★ Đây là con số dùng để ĐỐI CHIẾU với kích thước sàn đã khai (`twin_toa_nha`).
 *   Nếu ảnh nền quy ra 240 m trong khi nhà xưởng khai 84 m thì một trong hai
 *   sai, và người dùng phải thấy điều đó TRƯỚC khi đặt máy lên ảnh — sau đó thì
 *   mọi vị trí đã đặt đều phải làm lại.
 */
export function kichThuocAnhMm(
  rongPx: number,
  caoPx: number,
  mmMoiPx: number,
): { rongMm: number; caoMm: number } | null {
  if (!Number.isFinite(rongPx) || !Number.isFinite(caoPx) || !Number.isFinite(mmMoiPx)) {
    return null;
  }
  if (rongPx <= 0 || caoPx <= 0 || mmMoiPx <= 0) return null;
  return { rongMm: rongPx * mmMoiPx, caoMm: caoPx * mmMoiPx };
}

/** Lệch tương đối giữa bề rộng ảnh (đã quy mm) và bề rộng sàn đã khai. */
export const NGUONG_LECH_SAN = 0.2;

export interface DoiChieuSan {
  vuotNguong: boolean;
  lech: number;
  rongAnhMm: number;
  rongSanMm: number;
}

/**
 * So bề rộng ảnh nền với bề rộng sàn đã khai.
 *
 * ⚠ MẪU SỐ LÀ SỐ SÀN ĐÃ KHAI — cùng quy ước với `soLechKichThuoc` của
 *   `kiemTraAsset.ts`. Hai module dùng hai mẫu số khác nhau sẽ cho hai phần
 *   trăm khác nhau cho cùng một cặp số, và người dùng không có cách nào biết
 *   cái nào đúng.
 */
export function doiChieuVoiSan(
  rongAnhMm: number,
  rongSanMm: number,
  nguong: number = NGUONG_LECH_SAN,
): DoiChieuSan | null {
  if (!Number.isFinite(rongAnhMm) || !Number.isFinite(rongSanMm)) return null;
  if (rongSanMm <= 0 || rongAnhMm <= 0) return null;
  const lech = Math.abs(rongAnhMm - rongSanMm) / rongSanMm;
  return { vuotNguong: lech > nguong, lech, rongAnhMm, rongSanMm };
}

/** Đuôi ảnh nền nhận được — khớp danh sách MIME mà `taiAnhNen` chấp nhận. */
export const DUOI_ANH_NEN = [".png", ".jpg", ".jpeg", ".webp"] as const;

export function laAnhNenHopLe(tenTep: string): boolean {
  const i = tenTep.lastIndexOf(".");
  if (i < 0) return false;
  return (DUOI_ANH_NEN as readonly string[]).includes(tenTep.slice(i).toLowerCase());
}
