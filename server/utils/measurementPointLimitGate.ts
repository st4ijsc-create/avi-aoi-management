/**
 * Task 8 Khối C — MỘT hàm dùng chung để trả lời "bản vá này có CHẠM vào một
 * trường GIỚI HẠN không" (⇒ trên sản phẩm live+enforced phải đi qua hàng đợi
 * duyệt ngưỡng, xem `assertThresholdEditAllowed`).
 *
 * Trước bản vá này có HAI bản `touchesLimits` độc lập, không cổng nào canh
 * lệch nhau (Task 7 review, F2 — `khoic-task7-report.md`):
 *   - `server/routers/productRouters.ts` (`measurementPoint.update`) — chỉ
 *     chép tay 6 field (lowerLimit/upperLimit/nominalValue/toleranceMode/
 *     tolPlus/tolMinus).
 *   - `server/utils/measurementPointImport.ts` (bulk import) — chép tay 13
 *     field, THIẾU 9/18 cột của `POINT_LIMIT_SPEC`, và `unit` được gán VÔ
 *     ĐIỀU KIỆN (không qua gate nào) ⇒ một sheet nhập chỉ mang cột `unit` (hoặc
 *     `warpageMax`/`voidPctMax`/`offsetXMax`/`offsetYMax`/`tiltMax`/
 *     `thicknessMin`/`thicknessMax`) trên sản phẩm ĐANG CHẠY (live+enforced)
 *     ghi thẳng, lách hoàn toàn hàng đợi duyệt ngưỡng — không lưới nào bắt vì
 *     mỗi nơi tự đo theo tập field CỦA RIÊNG NÓ.
 * Đúng lớp lỗi Task 7 vừa dọn cho SELECT giới hạn cấp cây / kiểu
 * `PointLimitSource` — dọn tiếp cho `touchesLimits` bằng MỘT hàm SUY từ
 * `APPROVAL_LIMIT_FIELDS` (`shared/pointLimitSpec.ts`, không chép tay danh
 * sách cột lần thứ ba), cả hai nơi gọi CHUNG một hàm này.
 */
import { z } from "zod";
import { APPROVAL_LIMIT_FIELDS } from "@shared/pointLimitSpec";
import { appError } from "../_core/appError";

/**
 * `true` nếu `fields` có ÍT NHẤT MỘT khoá thuộc `APPROVAL_LIMIT_FIELDS`
 * (18 cột giới hạn vật lý mà spec-gate chấm bằng + 4 field "giới hạn nghiệp
 * vụ" `nominalValue`/`toleranceMode`/`tolPlus`/`tolMinus`) được gán giá trị
 * (khác `undefined`). Chỉ đọc — không sửa `fields`.
 *
 * Nhận `Record<string, unknown>` bất kỳ: patch tRPC input (`rest` sau khi
 * destructure `id`/`changeReason`/…) hoặc một dòng bulk-import đã qua zod —
 * cả hai đều là object phẳng, đọc field bằng tên là đủ.
 */
export function touchesApprovalLimitFields(fields: Record<string, unknown>): boolean {
  return APPROVAL_LIMIT_FIELDS.some((f) => fields[f] !== undefined);
}

// ════════════════════════════════════════════════════════════════════════════
// ★★★ BG-113 (review Khối C lượt 9, I-2) — 0/5 đường ghi giới hạn kiểm
// `lower ≤ upper`. Đo được: `productRouters.ts` (`update`/`setLimitsBatch`),
// `product.ts` (`updateMeasurementPointLimitsBatch`), `measurementPointImport.ts`,
// `aiLocalTools/writeHandlers/measurementPoint.ts` — CẢ NĂM ghi thẳng
// lowerLimit/upperLimit/heightMin/heightMax xuống DB mà không kiểm khoảng.
// `pointResultEvaluator.ts` (`min !== null && value < min` rồi `max !== null &&
// value > max`, hai vế ĐỘC LẬP) khiến một khoảng RỖNG (`lowerLimit > upperLimit`)
// làm 100% trị đo của điểm đó TRƯỢT — không có trị nào lọt qua được cả hai vế.
//
// MỘT hàm dùng chung tại đây (KHÔNG viết lại 5 lần) — nhưng "hiện có" (giá trị
// TRƯỚC patch) khác nhau ở MỖI call site (fetch bằng id đơn, batch theo mảng,
// hoặc KHÔNG có gì — bulk import luôn tạo hàng MỚI) nên hàm này CHỈ nhận khoảng
// ĐÃ MERGE — caller tự merge (bằng `gopCapGioiHanDonGian` cho merge field-theo-
// field đơn giản, hoặc tự tính khi có derive khác như tolerance-mode) rồi gọi.
// KHÔNG tự đọc DB ở đây — giữ THUẦN, dễ test, không side-effect.
//
// Vì sao "SAU KHI MERGE" chứ không kiểm riêng `patch`: một patch CHỈ gửi
// `upperLimit` mới (thấp hơn `lowerLimit` HIỆN CÓ, không đổi trong patch này)
// vẫn phải bị chặn — kiểm mỗi `patch` một mình sẽ bỏ lọt hình dạng này (vì
// `patch.lowerLimit === undefined`, không có gì để so trong CHÍNH patch).
// ════════════════════════════════════════════════════════════════════════════

/** Bốn trường có ngữ nghĩa "cận dưới/cận trên" trong `APPROVAL_LIMIT_FIELDS` — 14 cột
 * còn lại là *Max/*Min ĐƠN (không có cận đối để so) hoặc phi-số (`criteria`/`unit`/…). */
export interface CapGioiHan {
  lowerLimit?: unknown;
  upperLimit?: unknown;
  heightMin?: unknown;
  heightMax?: unknown;
}

/** Chuỗi/number/`null`/`""`/`undefined` → number hoặc `null` (rỗng/không-số ⇒ bỏ qua so sánh). */
function soHoacNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * ★★★ Zod `.superRefine` DÙNG CHUNG (BG-113) — kiểm `lowerLimit ≤ upperLimit` và
 * `heightMin ≤ heightMax` trên một khoảng ĐÃ MERGE. Một cận rỗng (`null`/`""`/
 * vắng mặt) KHÔNG mâu thuẫn với cận kia — đúng ngữ nghĩa "chưa đặt giới hạn phía
 * đó", giữ nguyên hành vi hiện tại cho điểm chỉ có MỘT cận (min-only/max-only).
 */
export const capGioiHanSchema = z
  .object({
    lowerLimit: z.unknown().optional(),
    upperLimit: z.unknown().optional(),
    heightMin: z.unknown().optional(),
    heightMax: z.unknown().optional(),
  })
  .superRefine((gopSau, ctx) => {
    const lower = soHoacNull(gopSau.lowerLimit);
    const upper = soHoacNull(gopSau.upperLimit);
    if (lower !== null && upper !== null && lower > upper) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["upperLimit"],
        message: `lowerLimit (${lower}) phải ≤ upperLimit (${upper})`,
      });
    }
    const hMin = soHoacNull(gopSau.heightMin);
    const hMax = soHoacNull(gopSau.heightMax);
    if (hMin !== null && hMax !== null && hMin > hMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["heightMax"],
        message: `heightMin (${hMin}) phải ≤ heightMax (${hMax})`,
      });
    }
  });

/** Danh sách thông điệp lỗi (rỗng nếu hợp lệ) — dùng ở nơi KHÔNG throw (bulk import báo lỗi
 * theo dòng, AI Copilot tool trả `action_result` HITL thay vì ném). */
export function loiCapGioiHanSauMerge(gopSau: CapGioiHan): string[] {
  const ket = capGioiHanSchema.safeParse(gopSau);
  return ket.success ? [] : ket.error.issues.map((i) => i.message);
}

/**
 * Merge ĐƠN GIẢN field-theo-field: `patch[k] !== undefined` ⇒ dùng patch, vắng
 * mặt ⇒ giữ `hienCo[k]`. Đủ cho các call site KHÔNG có derive đặc biệt
 * (`setLimitsBatch`/`updateMeasurementPointLimitsBatch`/AI Copilot). Call site
 * CÓ derive (`measurementPoint.update` — tolerance-mode có thể tính lại
 * lowerLimit/upperLimit từ nominal±tol) tự tính khoảng đã merge rồi gọi thẳng
 * `loiCapGioiHanSauMerge`/`assertCapGioiHanHopLe`, KHÔNG dùng hàm này.
 */
export function gopCapGioiHanDonGian(hienCo: CapGioiHan, patch: CapGioiHan): CapGioiHan {
  const g = (k: keyof CapGioiHan): unknown => (patch[k] !== undefined ? patch[k] : hienCo[k]);
  return { lowerLimit: g("lowerLimit"), upperLimit: g("upperLimit"), heightMin: g("heightMin"), heightMax: g("heightMax") };
}

/** Ném `BAD_REQUEST`/`INVALID_VALUE` nếu khoảng ĐÃ MERGE không hợp lệ — dùng ở
 * tRPC router/hàm DB (nơi throw là hành vi ĐÚNG, khác AI tool/bulk import). */
export function assertCapGioiHanHopLe(gopSau: CapGioiHan): void {
  const loi = loiCapGioiHanSauMerge(gopSau);
  if (loi.length > 0) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "lowerLimit/upperLimit/heightMin/heightMax" },
      `Khoảng giới hạn không hợp lệ: ${loi.join("; ")}`,
    );
  }
}
