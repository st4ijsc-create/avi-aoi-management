/**
 * byteMau.ts — quy MỘT chuỗi màu CSS bất kỳ ra ba byte sRGB, **KHÔNG phụ thuộc three**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TÁCH KHỎI `mauThree.ts` — GIỮ `phamViCanh.ts` THUẦN
 * ════════════════════════════════════════════════════════════════════════════
 * `phamViCanh.ts` tự khai ở docblock đầu tệp: *"Module THUẦN: không three, không
 * react"* — nhờ vậy toàn bộ luật phạm vi test được ở `environment: "node"` mà
 * không cần WebGL. Nhưng `phaVeNen()` của nó lại CẦN quy `oklch()` (G29).
 *
 * Nếu nó import `mauThree.ts` thì nó kéo theo `three` và lời khai kia thành SAI
 * — một tệp tự nhận "thuần" mà thực ra không phải là đúng lớp lỗi "docblock nói
 * quá mã" (G27). Nên phần KHÔNG cần three nằm ở đây; `mauThree.ts` import lên.
 *
 * ★ Chạy được trong node: `byteMau` trả `null` khi `typeof document === "undefined"`.
 */

/** Cú pháp màu CSS mà `THREE.Color`/`tachRgb` KHÔNG đọc được — phải đi vòng canvas. */
const CU_PHAP_LA = /^\s*(oklch|oklab|lch|lab|color|hwb)\s*\(/i;

/**
 * Chuỗi màu CSS này có phải loại `THREE.Color` KHÔNG hiểu không?
 *
 * Tách thành hàm riêng (thay vì inline regex ở ba chỗ) vì đây là **danh sách
 * cú pháp**, và một danh sách nhân bản là một danh sách sẽ lệch. Xuất ra để test
 * ghim được đúng tập cú pháp, không phải ghim một regex chép tay.
 */
export function laCuPhapLa(gt: string): boolean {
  return CU_PHAP_LA.test(gt);
}

/**
 * Đọc MỘT chuỗi màu CSS bất kỳ ra ba byte **sRGB**, bằng canvas 2D.
 *
 * `null` khi không quy được (chuỗi rác, canvas bị chặn, không có DOM) — người
 * gọi tự chọn màu dự phòng; module này KHÔNG bịa một màu câm.
 *
 * ★ Vì sao có canh gác `#010203` thay vì chỉ đọc pixel: một chuỗi RÁC cũng cho
 *   pixel `(0,0,0)`, không phân biệt được với "màu đen hợp lệ". Nhưng canvas 2D
 *   BỎ QUA giá trị không hợp lệ và GIỮ NGUYÊN `fillStyle` cũ — nên đặt một giá
 *   trị canh gác rồi kiểm xem nó có đổi không là phép thử đáng tin, còn đọc
 *   pixel thì không.
 */
export function byteMau(gt: string): [number, number, number] | null {
  if (typeof document === "undefined") return null;
  try {
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const CANH_GAC = "#010203";
    ctx.fillStyle = CANH_GAC;
    ctx.fillStyle = gt;
    if (ctx.fillStyle === CANH_GAC) return null;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch {
    // Canvas bị chặn (fingerprinting guard) — người gọi dùng màu dự phòng ĐÚNG
    // SẮC, còn hơn để `THREE.Color` âm thầm trả về trắng.
    return null;
  }
}

