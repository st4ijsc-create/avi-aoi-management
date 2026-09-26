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

/** Union kiểu literal của TÊN field — dùng cho mọi kiểu SUY từ spec (`MIN_MAX_PAIRS`, `F`…). */
export type PointLimitField = (typeof POINT_LIMIT_SPEC)[number]["field"];

// ════════════════════════════════════════════════════════════════════════════
// ★★★ NEW-2 (review Khối C lượt 9, vòng 2, Important) — BẢN ĐỒ KHOÁ→TÊN, thay
// hẳn kiểu "hằng số suy từ VỊ TRÍ mảng" mà `client/src/pages/ProductModels.tsx`
// (I-1, vòng sửa 9 lượt 1) đang dùng:
//
//   const FIELD_HEIGHT_MIN = POINT_LIMIT_SPEC[3].field;
//   const FIELD_HEIGHT_MAX = POINT_LIMIT_SPEC[4].field;
//
// — ĐÚNG hôm nay (vị trí 3/4 đúng là heightMin/heightMax), nhưng CÂM khi ai đổi
// THỨ TỰ khai trong `POINT_LIMIT_SPEC` (không đổi TẬP field — `tsc` KHÔNG báo
// lỗi, vì `POINT_LIMIT_SPEC[i].field` vẫn cho ra MỘT string literal thuộc union
// hợp lệ, chỉ SAI Ý NGHĨA): `FIELD_HEIGHT_MIN` có thể lặng lẽ trỏ sang
// `"areaMin"` — hai field bị HOÁN ĐỔI giá trị cho nhau ở form UI, không ai để ý
// vì cả hai vẫn "hợp kiểu". Đây là chính hình dạng NEW-2 mô tả.
//
// `F` neo bằng TÊN, không phải CHỈ SỐ — `F.heightMin` LUÔN bằng chuỗi
// `"heightMin"` bất kể `POINT_LIMIT_SPEC` khai field đó ở vị trí nào (suy bằng
// cách LẶP qua từng phần tử và dùng CHÍNH `field` của nó làm cả khoá lẫn giá
// trị, không đọc `[i]`). Nơi dùng đổi `POINT_LIMIT_SPEC[3].field` thành
// `F.heightMin` — cùng kiểu literal, cùng cách dùng (`[F.heightMin]: …`/
// `point[F.heightMin]`), nhưng KHÔNG còn phụ thuộc thứ tự khai.
// ════════════════════════════════════════════════════════════════════════════

/**
 * `F.lowerLimit === "lowerLimit"`, `F.heightMin === "heightMin"`, … cho cả 18
 * field — đúng NGHĨA của `satisfies Record<PointLimitField, PointLimitField>`
 * (mỗi khoá tự ánh xạ về CHÍNH NÓ), suy qua `Object.fromEntries` trên
 * `LIMIT_FIELDS` (không liệt kê tay 18 dòng `key: "key"` — cùng nguyên tắc "một
 * nguồn sự thật" mà `LIMIT_FIELDS`/`APPROVAL_LIMIT_FIELDS`/`MIN_MAX_PAIRS` đã
 * theo). Ép kiểu sang dạng mapped-type (`{ [K in PointLimitField]: K }`) để giữ
 * ĐỘ CHÍNH XÁC literal — `Object.fromEntries` tự thân chỉ suy ra
 * `Record<string, string>`, không đủ hẹp cho lưới compile-time kiểu
 * `F.x satisfies "x"`.
 */
export const F = Object.fromEntries(LIMIT_FIELDS.map((f) => [f, f])) as {
  readonly [K in PointLimitField]: K;
};

// ════════════════════════════════════════════════════════════════════════════
// ★★★ NEW-1 (review Khối C lượt 9, vòng 2, Important) — CÁC CẶP "cận dưới/cận
// trên" SUY TỪ chính spec, không liệt kê tay ở nơi dùng (`measurementPointLimitGate.ts`
// trước bản vá này chỉ hard-code ĐÚNG hai cặp: lowerLimit/upperLimit, heightMin/
// heightMax — dù `judge()`/`evaluatePointResult` (`pointResultEvaluator.ts`) chấm
// CẢ NĂM cặp min/max của `PointLimitSource`. Hệ quả đo được: một sản phẩm dạy
// `areaMin=10, areaMax=5` (khoảng RỖNG) ghi thẳng xuống DB — 0 lưới nào chặn —
// và mọi trị đo area của điểm đó TRƯỢT 100% ở thời điểm CHẤM, không phải lúc dạy.
//
// QUY TẮC SUY: một field kết thúc bằng "Max" có một field "…Min" ĐỒNG TIỀN TỐ
// CÙNG có mặt trong spec ⇒ một cặp. Bốn field *Max ĐƠN (coplanarityMax/
// warpageMax/voidPctMax/offsetXMax/offsetYMax/tiltMax) không có vế Min đối xứng
// trong spec ⇒ KHÔNG phải một cặp (không có gì để so `min ≤ max`) — GDT/coplanarity/
// warpage/void chỉ có MỘT cận nghiệp vụ (không phải "quên vế kia").
//
// NGOẠI LỆ DUY NHẤT: `lowerLimit`/`upperLimit` KHÔNG theo quy ước hậu tố Min/Max
// (đây là TÊN CỘT DB THẬT — cột 1D cổ điển nhất, đặt trước khi quy ước "*Min/*Max"
// tồn tại — không đổi tên được). Cặp này gắn TAY, không phải một khoảng suy diễn
// bỏ sót — là NGOẠI LỆ ĐẶT TÊN duy nhất của quy ước.
// ════════════════════════════════════════════════════════════════════════════

/** Một cặp "cận dưới/cận trên" cần kiểm `min ≤ max` — cả hai field PHẢI có mặt trong `POINT_LIMIT_SPEC`. */
export interface CapGioiHanPair {
  readonly min: PointLimitField;
  readonly max: PointLimitField;
}

function suyCacCapTuHauTo(): CapGioiHanPair[] {
  const boTruong = new Set<PointLimitField>(LIMIT_FIELDS);
  const cap: CapGioiHanPair[] = [];
  for (const f of LIMIT_FIELDS) {
    if (!f.endsWith("Max")) continue;
    const ungVienMin = `${f.slice(0, -3)}Min` as PointLimitField;
    if (boTruong.has(ungVienMin)) cap.push({ min: ungVienMin, max: f });
  }
  return cap;
}

/**
 * ĐÚNG NĂM cặp hôm nay: `lowerLimit`/`upperLimit` (ngoại lệ đặt tên, gắn tay) +
 * bốn cặp suy được từ hậu tố (`heightMin`/`heightMax`, `areaMin`/`areaMax`,
 * `volumeMin`/`volumeMax`, `thicknessMin`/`thicknessMax`). Thêm một cặp *Min/*Max
 * MỚI vào `POINT_LIMIT_SPEC` ở trên tự động xuất hiện ở đây — KHÔNG cần sửa
 * `measurementPointLimitGate.ts` hay bất kỳ call site nào (đúng ý đồ NEW-1: một
 * cặp thêm sau không còn là "quên thêm gate" — nó suy tự động).
 */
export const MIN_MAX_PAIRS: readonly CapGioiHanPair[] = [
  { min: "lowerLimit", max: "upperLimit" }, // ngoại lệ đặt tên — xem docblock trên
  ...suyCacCapTuHauTo(),
];

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
