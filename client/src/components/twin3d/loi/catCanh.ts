/**
 * catCanh.ts — MẶT PHẲNG CẮT (`near`/`far`) CỦA CAMERA PHỐI CẢNH, SUY TỪ BÁN KÍNH CẢNH.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PH-50b — VÌ SAO TÁCH RA MỘT TỆP RIÊNG
 * ════════════════════════════════════════════════════════════════════════════
 * Trước tệp này, `far` là một biểu thức viết tay ở BA chỗ gọi `KhungCanh`, mỗi
 * chỗ một hệ số khác nhau (`banKinh*24` ở `CanhVanHanh`, `*20` ở `CanhNhaMay`,
 * `*8` ở `CanhThietKe`) và KHÔNG chỗ nào giải thích được hệ số của mình. Cái
 * thật sự quyết định `far` không phải cỡ cảnh, mà là **camera lùi được xa tới
 * đâu** — tức `maxDistance` của OrbitControls, một con số nằm ở tệp KHÁC.
 *
 * Hai số ấy trôi khỏi nhau được mà không ai biết. Tệp này buộc chúng dùng chung
 * một hằng ({@link HE_SO_ZOOM_XA_NHAT}), và biến `far` từ một con số đẹp thành
 * một hệ quả tính được:
 *
 *     far = (lùi xa nhất  +  nửa đường chéo sàn) × đệm
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÀ VÌ SAO `near` PHẢI ĐI CÙNG — NỚI `far` KHÔNG MIỄN PHÍ
 * ════════════════════════════════════════════════════════════════════════════
 * Thiết kế §7.2 đã cảnh báo z-fighting khi `far/near` lớn. Độ phân giải của
 * z-buffer 24 bit ở khoảng cách `z` xấp xỉ
 *
 *     Δz ≈ z² × (1/near − 1/far) / (2²⁴ − 1)
 *
 * Với cảnh tập đoàn của `qatd_admin` (bán kính 1060,4 m ⇒ `far` = 12.478,5) và
 * các toà nằm quanh `z ≈ 2000 m`:
 *   · `near` = 0,1  ⇒ Δz ≈ **2,4 m**  (tỉ lệ far/near = 124.785)
 *   · `near` = 0,5  ⇒ Δz ≈ **0,48 m** (tỉ lệ far/near =  24.957)
 * Tức thả `near` đứng yên ở 0,1 là trả 5 lần độ chính xác z cho không.
 *
 * ⚠ Nhưng `near` KHÔNG được lớn tới mức cắt mất vật ở gần: `CanhVanHanh` cho
 *   người dùng zoom vào tới `khoangCachToiThieu = 1,5 m`. Nên `near` có TRẦN
 *   {@link NEAR_TOI_DA_M} = 1/3 của 1,5 m — và trần ấy là thứ giữ cho bản vá
 *   `far` không tự sinh ra một hồi quy "zoom sát thì vật bị cắt đôi".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ CẢNH NHỎ KHÔNG ĐỔI MỘT BYTE
 * ════════════════════════════════════════════════════════════════════════════
 * Với bán kính ≤ ~170 m (mọi màn Máy/Line/Tầng, Studio và phần lớn
 * `/factory-command`), công thức rơi vào sàn {@link FAR_TOI_THIEU_M} = 2000 và
 * `near` = 0,1 — ĐÚNG cặp số các màn ấy đang chạy hôm nay. Tính chất này chứng
 * minh được bằng đại số, không cần đo: `(8b + √2·b)·1,25 < 2000 ⟺ b < 169,96`.
 */

/**
 * Hệ số khoảng cách lùi xa nhất: `maxDistance = banKinh × hệ số`.
 * DÙNG CHUNG với `CanhVanHanh.DieuKhien` — đó là toàn bộ lý do hằng này tồn tại.
 */
export const HE_SO_ZOOM_XA_NHAT = 8;

/** Sàn khoảng cách lùi xa nhất (m): cảnh tí hon vẫn phải lùi ra nhìn toàn thể được. */
export const KHOANG_CACH_ZOOM_XA_NHAT_TOI_THIEU_M = 80;

/**
 * Đệm trên mức tối thiểu cần. 1,25 chứ không phải 2,55 (mức mà `banKinh*24` cũ
 * rơi vào): mỗi mét `far` thừa là một phần độ chính xác z bị trả đi.
 */
export const HE_SO_DEM_FAR = 1.25;

/** Sàn `far` (m) — giữ nguyên số của mọi màn cảnh nhỏ đang chạy. */
export const FAR_TOI_THIEU_M = 2000;

/** Trần tỉ lệ `far/near` — đúng bằng tỉ lệ các màn đang chạy hôm nay (2000 / 0,1). */
export const TRAN_TI_LE_FAR_TREN_NEAR = 20_000;

/** Sàn `near` (m) — giá trị lịch sử của kit; không hạ. */
export const NEAR_TOI_THIEU_M = 0.1;

/**
 * Trần `near` (m) = 1/3 của `khoangCachToiThieu` (1,5 m) mà OrbitControls cho
 * phép zoom vào. Đây là hàng rào chống hồi quy do chính bản vá `far` sinh ra.
 */
export const NEAR_TOI_DA_M = 0.5;

/** Khoảng cách lùi xa nhất của camera (m) — CHÍNH con số `OrbitControls.maxDistance`. */
export function khoangCachZoomXaNhat(banKinhM: number): number {
  return Math.max(KHOANG_CACH_ZOOM_XA_NHAT_TOI_THIEU_M, banKinhM * HE_SO_ZOOM_XA_NHAT);
}

/**
 * `far` đủ để KHÔNG cắt mất gì ở bất kỳ đâu người dùng lùi tới được.
 *
 * `√2 · banKinh` là nửa đường chéo mặt sàn (`rong` và `sau` đều ≤ `banKinh` theo
 * định nghĩa `banKinh = max(rong, sau, 10)`), tức khoảng cách xa nhất từ mục
 * ngắm tới một góc sàn sau khi người dùng đã kéo (pan) mục ngắm đi.
 */
export function farTheoBanKinh(banKinhM: number): number {
  const luiXaNhat = khoangCachZoomXaNhat(banKinhM);
  const nuaDuongCheoSan = banKinhM * Math.SQRT2;
  return Math.max(FAR_TOI_THIEU_M, (luiXaNhat + nuaDuongCheoSan) * HE_SO_DEM_FAR);
}

/** `near` giữ tỉ lệ `far/near` ở mức của hôm nay, trong hai trần đã giải thích ở đầu tệp. */
export function nearTheoFar(far: number): number {
  return Math.min(NEAR_TOI_DA_M, Math.max(NEAR_TOI_THIEU_M, far / TRAN_TI_LE_FAR_TREN_NEAR));
}

/** Cặp `near`/`far` cho một cảnh bán kính `banKinhM` — hai số luôn đi cùng nhau. */
export function catCanhTheoBanKinh(banKinhM: number): { near: number; far: number } {
  const far = farTheoBanKinh(banKinhM);
  return { near: nearTheoFar(far), far };
}
