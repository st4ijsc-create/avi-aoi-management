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
import { APPROVAL_LIMIT_FIELDS, MIN_MAX_PAIRS, type PointLimitField } from "@shared/pointLimitSpec";
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

/**
 * ★★★ NEW-1 (review Khối C lượt 9, vòng 2, Important) — TRƯỚC bản vá này, kiểu
 * này hard-code ĐÚNG bốn field (hai cặp: lowerLimit/upperLimit, heightMin/
 * heightMax) dù `MIN_MAX_PAIRS` (`shared/pointLimitSpec.ts`) khai NĂM cặp —
 * area/volume/thickness đi qua trắng dù `judge()`/`evaluatePointResult`
 * (`pointResultEvaluator.ts`) chấm CẢ NĂM. Nay các field SUY TỪ `MIN_MAX_PAIRS`
 * (10 field — mỗi cặp 2 vế) thay vì liệt kê tay ở ĐÂY, để một cặp mới thêm vào
 * spec tự động có mặt ở kiểu này mà không cần sửa file này.
 */
export type CapGioiHan = Partial<Record<PointLimitField, unknown>>;

/** Tập field THAM GIA một cặp min/max nào đó (10 field/5 cặp hôm nay) — suy từ
 * `MIN_MAX_PAIRS`, dùng để giới hạn phạm vi zod-shape/merge đúng NGHĨA của gate
 * này (gate KHÔNG canh field phi-cặp như `unit`/`criteria`/`coplanarityMax`). */
const CAC_TRUONG_TRONG_CAP: readonly PointLimitField[] = Array.from(
  new Set(MIN_MAX_PAIRS.flatMap((p) => [p.min, p.max] as const)),
);

/** Chuỗi/number/`null`/`""`/`undefined` → number hoặc `null` (rỗng/không-số ⇒ bỏ qua so sánh). */
function soHoacNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * ★★★ Zod `.superRefine` DÙNG CHUNG (BG-113, mở rộng NEW-1) — kiểm `min ≤ max`
 * cho MỖI cặp trong `MIN_MAX_PAIRS` (5 cặp hôm nay) trên một khoảng ĐÃ MERGE.
 * Một cận rỗng (`null`/`""`/vắng mặt) KHÔNG mâu thuẫn với cận kia — đúng ngữ
 * nghĩa "chưa đặt giới hạn phía đó", giữ nguyên hành vi hiện tại cho điểm chỉ
 * có MỘT cận (min-only/max-only). Lặp qua `MIN_MAX_PAIRS` (không hard-code
 * từng cặp) — một cặp MỚI thêm vào spec tự động được kiểm ở đây.
 */
export const capGioiHanSchema = z
  .object(Object.fromEntries(CAC_TRUONG_TRONG_CAP.map((f) => [f, z.unknown().optional()])) as Record<PointLimitField, z.ZodOptional<z.ZodUnknown>>)
  .superRefine((gopSau, ctx) => {
    for (const { min, max } of MIN_MAX_PAIRS) {
      const loGT = soHoacNull((gopSau as CapGioiHan)[min]);
      const caoGT = soHoacNull((gopSau as CapGioiHan)[max]);
      if (loGT !== null && caoGT !== null && loGT > caoGT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [max],
          message: `${min} (${loGT}) phải ≤ ${max} (${caoGT})`,
        });
      }
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
 *
 * ★★★ NEW-1 — lặp qua `CAC_TRUONG_TRONG_CAP` (10 field/5 cặp, suy từ
 * `MIN_MAX_PAIRS`) thay vì bốn field hard-code — merge nay bao CẢ area/volume/
 * thickness, không chỉ lowerLimit/upperLimit/heightMin/heightMax.
 */
export function gopCapGioiHanDonGian(hienCo: CapGioiHan, patch: CapGioiHan): CapGioiHan {
  const ket: CapGioiHan = {};
  for (const f of CAC_TRUONG_TRONG_CAP) {
    ket[f] = patch[f] !== undefined ? patch[f] : hienCo[f];
  }
  return ket;
}

/** Ném `BAD_REQUEST`/`INVALID_VALUE` nếu khoảng ĐÃ MERGE không hợp lệ — dùng ở
 * tRPC router/hàm DB (nơi throw là hành vi ĐÚNG, khác AI tool/bulk import). */
export function assertCapGioiHanHopLe(gopSau: CapGioiHan): void {
  const loi = loiCapGioiHanSauMerge(gopSau);
  if (loi.length > 0) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      // NEW-1 — `field` liệt kê ĐỦ 10 field/5 cặp (suy từ MIN_MAX_PAIRS), không
      // còn hard-code bốn field cũ (che mất area/volume/thickness trong thông báo lỗi).
      { field: CAC_TRUONG_TRONG_CAP.join("/") },
      `Khoảng giới hạn không hợp lệ: ${loi.join("; ")}`,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ★★★ BG-123 (Khối C, "nợ còn mở", 2026-09-05) — XOÁ giới hạn về NULL.
//
// `measurementPoint.update`/`setLimitsBatch` khai mọi cột giới hạn
// `z.string().optional()` ⇒ client KHÔNG có cách gửi "xoá" (chỉ có "để nguyên"
// [omit/undefined] hoặc "đặt giá trị mới" [string]). Đổi sang
// `z.string().nullable().optional()`: `undefined` = không đổi, `null` = XOÁ
// giới hạn đó (SET cột NULL). Đường ghi (`updateMeasurementPointDef`/
// `updateMeasurementPointLimitsBatch`, `server/db/product.ts`) ĐÃ đúng ngữ
// nghĩa "chỉ đưa vào SET khi `!== undefined`" từ trước (BG-108/Task 8 Khối C)
// — `null` không phải `undefined` nên đã chảy xuống SET NULL sẵn, KHÔNG cần
// sửa hàm DB. `touchesApprovalLimitFields` (`fields[f] !== undefined`) cũng
// đã coi null là "có chạm" ⇒ xoá limit vẫn qua cửa duyệt ngưỡng như sửa limit.
//
// SUY danh sách field KIỂU CHUỖI từ `APPROVAL_LIMIT_FIELDS` (không chép tay):
// loại `criteria` (mảng jsonb — "xoá" một mảng không cùng nghĩa "đặt NULL một
// số", ngoài phạm vi bản vá string-limit này) và `toleranceMode` (enum, không
// phải "giới hạn" theo nghĩa numeric/text — đặt null không có ý nghĩa nghiệp
// vụ rõ ràng ở đây).
// ════════════════════════════════════════════════════════════════════════════

const KHONG_PHAI_CHUOI_XOA_DUOC = new Set<(typeof APPROVAL_LIMIT_FIELDS)[number]>(["criteria", "toleranceMode"]);

/** 20 field giới hạn KIỂU CHUỖI (APPROVAL_LIMIT_FIELDS trừ `criteria`/`toleranceMode`)
 * — nhận `z.string().nullable().optional()` ở input router: `undefined` =
 * không đổi, `null` = XOÁ giới hạn đó. */
export const NULLABLE_LIMIT_STRING_FIELDS: readonly Exclude<
  (typeof APPROVAL_LIMIT_FIELDS)[number],
  "criteria" | "toleranceMode"
>[] = APPROVAL_LIMIT_FIELDS.filter(
  (f): f is Exclude<(typeof APPROVAL_LIMIT_FIELDS)[number], "criteria" | "toleranceMode"> =>
    !KHONG_PHAI_CHUOI_XOA_DUOC.has(f),
);

/**
 * Zod shape `{ field: z.string().nullable().optional() }` cho 20 field trên —
 * spread vào input schema của `measurementPoint.update`/`setLimitsBatch`
 * (KHÔNG chép tay 20 dòng `field: z.string().optional()` — BG-123, cùng
 * nguyên tắc "một nguồn sự thật" mà `capGioiHanSchema` ở trên đã theo).
 */
export function xayZodShapeGioiHanNullable(): Record<
  (typeof NULLABLE_LIMIT_STRING_FIELDS)[number],
  z.ZodOptional<z.ZodNullable<z.ZodString>>
> {
  return Object.fromEntries(
    NULLABLE_LIMIT_STRING_FIELDS.map((f) => [f, z.string().nullable().optional()]),
  ) as Record<(typeof NULLABLE_LIMIT_STRING_FIELDS)[number], z.ZodOptional<z.ZodNullable<z.ZodString>>>;
}

/**
 * ★★★ BG-123 — merge "input người dùng" + "hàng hiện có" GIỮ NGUYÊN `null`
 * tường minh. KHÔNG dùng `??` (coi `null` là "vắng mặt" ⇒ âm thầm phục hồi
 * giá trị CŨ, đánh bại chính ý nghĩa "null = xoá" mà bản vá này thêm vào zod
 * input — đo được ở `measurementPoint.update`: hai chỗ merge cho
 * `deriveLegacyLimitsFromTolerance` và cho `assertCapGioiHanHopLe` đều dùng
 * `rest.x ?? existingPoint.x ?? undefined` trước bản vá này).
 */
export function gopGiuNguyenNull<T>(
  input: T | null | undefined,
  existing: T | null | undefined,
): T | null | undefined {
  return input !== undefined ? input : (existing ?? undefined);
}
