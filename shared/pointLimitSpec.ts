/**
 * MỘT nguồn sự thật cho DANH SÁCH 18 CỘT GIỚI HẠN của điểm đo
 * (`measurement_point_defs`, xem `drizzle/schema/product.ts`).
 *
 * Trước bản vá này danh sách 18 cột chép tay ở BỐN nơi, không cổng nào canh
 * lệch nhau:
 *   - SELECT giới hạn cấp cây `server/db/cayDay.ts` (`traPointDefCapComponent`)
 *   - kiểu `PointLimitSource` (`server/services/pointResultEvaluator.ts:30-56`)
 *     — kiểu spec-gate CHẤM BẰNG thật sự
 *   - zod input `measurementPoint.update` (`server/routers/productRouters.ts`)
 *   - `touchesLimits` (`server/routers/productRouters.ts`) — cửa duyệt ngưỡng
 * Chính `cayDay.ts` (dòng ngay trên SELECT cũ) đã tự cảnh báo: "thiếu một cột
 * ở đây là một chiều giới hạn KHÔNG BAO GIỜ được chấm, và không lưới nào đỏ vì
 * hàng vẫn ghi." Đúng lớp lỗi mà `shared/productColumnSpec.ts` đã vá cho cột
 * sản phẩm (đọc file đó trước khi sửa file này) — dùng lại đúng khuôn: khai
 * spec MỘT lần, các nơi kia suy từ spec, kèm lưới census đối chiếu spec ↔ cột
 * thật trong drizzle schema VÀ spec ↔ `PointLimitSource`
 * (`server/contracts/pointLimitSpecCensus.test.ts` — không sống ở đây, xem
 * cảnh báo "THUẦN" ngay dưới).
 *
 * ⚠ `shared/**` KHÔNG được import `server/**`. File này phải giữ 0 import,
 * như `shared/rollupVerdict.ts` — cả `PointLimitSource` (kiểu cần đối chiếu)
 * lẫn `measurementPointDefs` (schema cần đối chiếu) đều là mã `server/`, nên
 * việc đối chiếu chuyển hẳn sang `server/contracts/pointLimitSpecCensus.test.ts`
 * (nơi được phép import cả hai).
 *
 * ⚠⚠ VÌ SAO CÓ HAI DANH SÁCH:
 *   - `LIMIT_FIELDS` = ĐÚNG 18 cột mà spec-gate THẬT SỰ chấm bằng (khớp từng
 *     khoá của `PointLimitSource`).
 *   - `APPROVAL_LIMIT_FIELDS` RỘNG HƠN vì `nominalValue`/`toleranceMode`/
 *     `tolPlus`/`tolMinus` là "giới hạn" VỀ NGHIỆP VỤ (sửa chúng phải qua
 *     hàng đợi duyệt ngưỡng, xem `assertThresholdEditAllowed`) nhưng KHÔNG
 *     nằm trong `PointLimitSource` (spec-gate không tra chúng — chúng không
 *     có mặt trong `evaluatePointResult`).
 *   ĐỪNG gộp hai danh sách — gộp là mở lại đúng lỗ mà bản vá này đóng (hoặc
 *   spec-gate chấm nhầm field nghiệp vụ, hoặc cửa duyệt bỏ lọt field vật lý).
 */

/** Một mục trong spec giới hạn: tên cột DB + nhóm nghiệp vụ + khoá i18n nhãn hiển thị. */
export interface MucGioiHan {
  readonly field: string;
  readonly nhom: "1d" | "3d" | "gdt" | "criteria";
  readonly i18nKey: string;
}

/**
 * ĐÚNG 18 cột — khớp từng khoá của `PointLimitSource`
 * (`server/services/pointResultEvaluator.ts:30-56`, đối chiếu tay 2026-09-03,
 * canh lại bằng `server/contracts/pointLimitSpecCensus.test.ts`).
 *
 *   nhom "1d"       — giới hạn 1 chiều cổ điển: lowerLimit/upperLimit/unit.
 *   nhom "3d"        — 3D/SPI/Xray: height/area/volume/coplanarity/warpage/void/thickness.
 *   nhom "gdt"       — offset/tilt sau gắp-đặt (GD&T-style).
 *   nhom "criteria"  — mảng tiêu chí pass/fail (jsonb, discriminated union).
 */
export const POINT_LIMIT_SPEC = [
  { field: "lowerLimit", nhom: "1d", i18nKey: "pointLimits.lowerLimit" },
  { field: "upperLimit", nhom: "1d", i18nKey: "pointLimits.upperLimit" },
  { field: "unit", nhom: "1d", i18nKey: "pointLimits.unit" },
  { field: "heightMin", nhom: "3d", i18nKey: "pointLimits.heightMin" },
  { field: "heightMax", nhom: "3d", i18nKey: "pointLimits.heightMax" },
  { field: "areaMin", nhom: "3d", i18nKey: "pointLimits.areaMin" },
  { field: "areaMax", nhom: "3d", i18nKey: "pointLimits.areaMax" },
  { field: "volumeMin", nhom: "3d", i18nKey: "pointLimits.volumeMin" },
  { field: "volumeMax", nhom: "3d", i18nKey: "pointLimits.volumeMax" },
  { field: "coplanarityMax", nhom: "3d", i18nKey: "pointLimits.coplanarityMax" },
  { field: "warpageMax", nhom: "3d", i18nKey: "pointLimits.warpageMax" },
  { field: "voidPctMax", nhom: "3d", i18nKey: "pointLimits.voidPctMax" },
  { field: "offsetXMax", nhom: "gdt", i18nKey: "pointLimits.offsetXMax" },
  { field: "offsetYMax", nhom: "gdt", i18nKey: "pointLimits.offsetYMax" },
  { field: "tiltMax", nhom: "gdt", i18nKey: "pointLimits.tiltMax" },
  { field: "thicknessMin", nhom: "3d", i18nKey: "pointLimits.thicknessMin" },
  { field: "thicknessMax", nhom: "3d", i18nKey: "pointLimits.thicknessMax" },
  { field: "criteria", nhom: "criteria", i18nKey: "pointLimits.criteria" },
] as const satisfies readonly MucGioiHan[];

/** Tên field (union kiểu literal — giữ nguyên độ chính xác cho lưới compile-time ở census). */
export const LIMIT_FIELDS: readonly (typeof POINT_LIMIT_SPEC)[number]["field"][] =
  POINT_LIMIT_SPEC.map((m) => m.field);

/**
 * `LIMIT_FIELDS` + bốn field "giới hạn nghiệp vụ" không nằm trong
 * `PointLimitSource` — dùng cho `touchesLimits` (cửa duyệt ngưỡng), KHÔNG
 * dùng cho SELECT spec-gate (xem cảnh báo "HAI DANH SÁCH" ở đầu file).
 */
export const APPROVAL_LIMIT_FIELDS: readonly (
  | (typeof POINT_LIMIT_SPEC)[number]["field"]
  | "nominalValue"
  | "toleranceMode"
  | "tolPlus"
  | "tolMinus"
)[] = [...LIMIT_FIELDS, "nominalValue", "toleranceMode", "tolPlus", "tolMinus"] as const;
