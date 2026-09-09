/**
 * hoatAnhDongChay.ts — KHI NÀO mũi tên dòng chảy được phép CHẠY (Đợt 35, Pareto #6 / §15.6 D-7).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐO ĐƯỢC TRƯỚC KHI VIẾT (QA Đợt 32 a3b · đo lại Đợt 35 `.qa-dot35/truoc/e7-*`)
 * ════════════════════════════════════════════════════════════════════════════
 *   /twin/line/2 đứng yên, không ai chạm:   **88–158 khung / 4 s** (1600 · 1280)
 *   /twin/may/14 đứng yên (không dòng chảy):  0–5 khung / 2 s
 *
 * `DongChayLine.useFrame` gọi `invalidate()` MỖI khung khi `nhipMs` hợp lệ ⇒
 * `frameloop="demand"` bị biến thành vòng lặp 30–40 fps vĩnh viễn — một màn
 * Line mở trên bàn trực ca 8 tiếng là 8 tiếng GPU chạy để 8 mũi tên nhích.
 * §15.6 D-7 cấm đúng cái này: *"hoạt ảnh băng tải giữ GPU chạy"*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LUẬT — HOẠT ẢNH CHỈ SAU MỘT "KÍCH", TRONG MỘT CỬA SỔ NGẮN
 * ════════════════════════════════════════════════════════════════════════════
 * "Kích" = có tương tác (camera đổi — kéo xoay, tween đổi cấp) hoặc dữ liệu
 * đổi (đường tâm, nhịp). Sau kích, mũi tên chạy `CUA_SO_HOAT_ANH_MS` rồi ĐỨNG,
 * giữ nguyên hướng (hướng dòng chảy là THÔNG TIN, và một mũi tên đứng vẫn chỉ
 * hướng). Kéo chuột liên tục ⇒ kích liên tục ⇒ chạy liên tục — đúng cảm giác
 * "sống" khi người dùng đang nhìn, và 0 khung khi không ai nhìn.
 *
 * ★ Nhịp `null`/0/quá chậm vẫn ĐỨNG YÊN vô điều kiện (cam kết cũ của
 *   `DongChayLine`: một tốc độ bịa là lời khai sai về nhịp sản xuất).
 * ★ Module THUẦN (không three/react) — test được trong node; `DongChayLine.tsx`
 *   chỉ nối số đo (đồng hồ, ma trận camera) vào đây.
 */

/** Nhịp chậm nhất còn cho mũi tên nhúc nhích (ms). Chậm hơn nữa coi như đứng. */
export const NHIP_TOI_DA_MS = 120_000;

/**
 * Cửa sổ hoạt ảnh sau một kích (ms). 1 500: đủ để thấy mũi tên "trôi" sau khi
 * thả chuột/xong tween, ngắn hơn phép đo idle 4 s của QA (≤ 2 khung / 4 s)
 * với dư địa: sau khi camera dừng ≤ 1,5 s là 0 khung.
 */
export const CUA_SO_HOAT_ANH_MS = 1500;

/** Nhịp có dùng được để chạy hoạt ảnh không. */
export function nhipHopLe(nhipMs: number | null | undefined): boolean {
  return nhipMs != null && Number.isFinite(nhipMs) && nhipMs > 0 && nhipMs <= NHIP_TOI_DA_MS;
}

/**
 * Có nên chạy thêm một bước hoạt ảnh ở thời điểm `bayGio` không?
 *   · nhịp không hợp lệ ⇒ KHÔNG (bất kể kích)
 *   · chưa từng kích (`mocKich == null`) ⇒ KHÔNG
 *   · trong cửa sổ `[mocKich, mocKich + CUA_SO)` ⇒ CÓ; ngoài ⇒ KHÔNG
 *   · đồng hồ lùi (`bayGio < mocKich`) ⇒ coi như vừa kích (không kẹt vĩnh viễn)
 */
export function nenHoatAnh(
  bayGio: number,
  mocKich: number | null,
  nhipMs: number | null | undefined,
  cuaSoMs: number = CUA_SO_HOAT_ANH_MS,
): boolean {
  if (!nhipHopLe(nhipMs)) return false;
  if (mocKich == null || !Number.isFinite(mocKich)) return false;
  const troi = bayGio - mocKich;
  if (troi < 0) return true;
  return troi < cuaSoMs;
}

/**
 * Camera có đổi so với lần trước không — so 7 số (vị trí + quaternion) với
 * epsilon; `truoc == null` (chưa có mốc) ⇒ coi là ĐỔI để lần đầu cũng kích.
 */
export function cameraDaDoi(
  truoc: readonly number[] | null,
  sau: readonly number[],
  epsilon = 1e-6,
): boolean {
  if (truoc == null || truoc.length !== sau.length) return true;
  for (let i = 0; i < sau.length; i += 1) if (Math.abs(truoc[i] - sau[i]) > epsilon) return true;
  return false;
}
