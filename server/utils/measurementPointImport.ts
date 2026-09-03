/**
 * Doc 31 Đợt C (MP7 / MP8, C.3) — deep bulk-import derivation helpers.
 *
 * The legacy xlsx importer only carried ~14 flat columns. This module widens the
 * server-side contract to the CURRENT measurement-point schema — tolerance v2
 * (toleranceMode / tolPlus / tolMinus), shape + geometry (circle r / rect w,h),
 * 3D / solder fields (height / area / volume / coplanarity — what an SPI/AXI board
 * needs, decision #2), and measurementTypeCode — while keeping every field
 * optional so a legacy sheet still imports unchanged.
 *
 * The heavy lifting (tolerance → legacy LSL/USL, catalog category → legacy enum)
 * mirrors productRouters.ts so a bulk-imported point is byte-identical to one
 * authored one-by-one; it lives here (not in productRouters) so the bulk path
 * does not depend on that 2.7k-line router's internals.
 */
import { z } from "zod";
import type { InsertMeasurementPointDef } from "../../drizzle/schema";
import {
  measurementGeometrySchema,
  pointShapeEnum,
  deriveLegacyAnchor,
  type MeasurementGeometry,
} from "../lib/measurementGeometry";
// Task 8 Khối C (QĐ-5, Task 7 review F2) — `touchesLimits` SUY từ
// APPROVAL_LIMIT_FIELDS, MỘT hàm dùng chung với `productRouters.ts` (trước bản
// vá: bản chép tay ở ĐÂY thiếu 9/18 cột của POINT_LIMIT_SPEC + `unit` gán vô
// điều kiện bên dưới → bulk-import trên sản phẩm live lách hàng đợi duyệt).
import { touchesApprovalLimitFields, loiCapGioiHanSauMerge, type CapGioiHan } from "./measurementPointLimitGate";
// NEW-1 (review Khối C lượt 9, vòng 2) — SUY cặp min/max từ spec thay vì liệt kê
// tay lowerLimit/upperLimit/heightMin/heightMax ở dưới (xem docblock `MIN_MAX_PAIRS`).
import { MIN_MAX_PAIRS } from "@shared/pointLimitSpec";

export const LEGACY_MEASUREMENT_TYPES = [
  "DIMENSION",
  "VISUAL",
  "ELECTRICAL",
  "POSITION",
  "COLOR",
  "SURFACE",
  "OTHER",
] as const;
export type LegacyMeasurementType = (typeof LEGACY_MEASUREMENT_TYPES)[number];

export const toleranceModeSchema = z.enum(["min_only", "max_only", "range", "bilateral"]);

/** One row of the DEEP bulk-import sheet. Everything past code/name/position is optional. */
export const deepImportPointSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  // Type: legacy enum and/or fine-grained catalog code.
  measurementType: z.enum(LEGACY_MEASUREMENT_TYPES).optional(),
  measurementTypeCode: z.string().min(1).max(100).optional(),
  unit: z.string().max(20).optional(),
  // Limits (legacy) + tolerance v2.
  lowerLimit: z.number().optional(),
  upperLimit: z.number().optional(),
  nominalValue: z.number().optional(),
  toleranceMode: toleranceModeSchema.optional(),
  tolPlus: z.number().optional(),
  tolMinus: z.number().optional(),
  // Geometry.
  positionX: z.number(),
  positionY: z.number(),
  radius: z.number().default(20),
  cropWidth: z.number().default(100),
  cropHeight: z.number().default(100),
  orderIndex: z.number().default(0),
  shape: pointShapeEnum.optional(),
  geometry: measurementGeometrySchema.optional(),
  // 3D / solder / SPI-AXI fields (decision #2 — factory uses 3D).
  heightMin: z.number().optional(),
  heightMax: z.number().optional(),
  heightNominal: z.number().optional(),
  heightUnit: z.string().max(20).optional(),
  areaMin: z.number().optional(),
  areaMax: z.number().optional(),
  volumeMin: z.number().optional(),
  volumeMax: z.number().optional(),
  volumeNominal: z.number().optional(),
  coplanarityMax: z.number().optional(),
  // Component linkage (WB-1, Pareto-by-package).
  componentCode: z.string().max(100).optional(),
  refDesignator: z.string().max(64).optional(),
});
export type DeepImportPoint = z.infer<typeof deepImportPointSchema>;

function toNum(value?: number | string | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Derive legacy lowerLimit/upperLimit strings from tolerance v2. Only `bilateral`
 * mode expands (nominal ± tol); every other mode keeps the explicit limits.
 * Mirrors productRouters.deriveLegacyLimitsFromTolerance.
 */
export function deriveLegacyLimits(input: {
  toleranceMode?: LegacyToleranceMode;
  nominalValue?: number;
  tolPlus?: number;
  tolMinus?: number;
  lowerLimit?: number;
  upperLimit?: number;
}): { lowerLimit?: number; upperLimit?: number } {
  if (input.toleranceMode !== "bilateral") {
    return { lowerLimit: input.lowerLimit, upperLimit: input.upperLimit };
  }
  const nominal = toNum(input.nominalValue);
  const plus = toNum(input.tolPlus);
  const minus = toNum(input.tolMinus);
  if (nominal === null || plus === null || minus === null) {
    return { lowerLimit: input.lowerLimit, upperLimit: input.upperLimit };
  }
  return { lowerLimit: nominal - minus, upperLimit: nominal + plus };
}
type LegacyToleranceMode = z.infer<typeof toleranceModeSchema>;

/** Catalog high-level category → legacy enum (mirror of productRouters). */
export function mapCatalogCategoryToLegacyType(category?: string | null): LegacyMeasurementType {
  switch ((category ?? "").toUpperCase()) {
    case "DIMENSION":
    case "GD_T":
      return "DIMENSION";
    case "ELECTRICAL":
      return "ELECTRICAL";
    case "POSITION":
      return "POSITION";
    case "COLOR":
      return "COLOR";
    case "SURFACE":
      return "SURFACE";
    case "OTHER":
      return "OTHER";
    default:
      return "VISUAL";
  }
}

const dec = (v?: number | null): string | undefined =>
  v === undefined || v === null ? undefined : String(v);

export interface BuildInsertResult {
  row: InsertMeasurementPointDef;
  /** True when limit-bearing fields were stripped because the product is live (gate). */
  limitsStripped: boolean;
  /**
   * BG-113 (review Khối C lượt 9, I-2) — set khi `lowerLimit > upperLimit` và/hoặc
   * `heightMin > heightMax` bị GATE strip (chỉ cặp vi phạm, không phải cả hàng —
   * mirror hành vi `limitsStripped` cho SẢN PHẨM LIVE, nhưng ở đây là vì DỮ LIỆU
   * SAI, không phải vì lifecycle). `undefined` khi khoảng hợp lệ (hoặc đã bị
   * `limitsStripped` xoá trước rồi — không có gì để kiểm).
   */
  rangeError?: string;
}

/**
 * Turn one validated import row into an InsertMeasurementPointDef.
 *
 * @param point         validated row
 * @param productModelId owning product
 * @param legacyType    already-resolved legacy enum (caller resolves via catalog)
 * @param orderIndex    final order index
 * @param dims          product image dims (for normalized coords) — null = none
 * @param gateLive      true when the product is live+enforced → strip limit fields
 */
export function buildInsertFromImportPoint(
  point: DeepImportPoint,
  productModelId: number,
  legacyType: LegacyMeasurementType,
  orderIndex: number,
  dims: { imageWidth?: number | null; imageHeight?: number | null } | null,
  gateLive: boolean,
): BuildInsertResult {
  // Derive legacy anchor from geometry when a non-circle shape is supplied.
  let positionX = Math.max(0, Math.round(point.positionX));
  let positionY = Math.max(0, Math.round(point.positionY));
  let radius = Math.max(0, Math.round(point.radius ?? 20));
  if (point.geometry) {
    const anchor = deriveLegacyAnchor(point.geometry as MeasurementGeometry);
    positionX = Math.max(0, Math.round(anchor.x));
    positionY = Math.max(0, Math.round(anchor.y));
    radius = Math.max(0, Math.round(anchor.radius));
  }

  // Normalized (0..1) coordinates when the product carries image dims.
  let normalizedX: string | undefined;
  let normalizedY: string | undefined;
  let normalizedRadius: string | undefined;
  if (dims?.imageWidth && dims?.imageHeight) {
    normalizedX = (positionX / dims.imageWidth).toFixed(8);
    normalizedY = (positionY / dims.imageHeight).toFixed(8);
    normalizedRadius = (radius / dims.imageWidth).toFixed(8);
  }

  const legacyLimits = deriveLegacyLimits({
    toleranceMode: point.toleranceMode,
    nominalValue: point.nominalValue,
    tolPlus: point.tolPlus,
    tolMinus: point.tolMinus,
    lowerLimit: point.lowerLimit,
    upperLimit: point.upperLimit,
  });

  // A live product must not receive imported limits directly (decision #4 /
  // B.6): strip every limit-bearing field so approved limits are only set via
  // the approval queue. Geometry, name, componentCode, 3D window etc. still import.
  // Task 8 Khối C — suy từ APPROVAL_LIMIT_FIELDS (shared/pointLimitSpec.ts),
  // MỘT hàm dùng chung với productRouters.ts (xem import ở đầu file). Trước bản
  // vá danh sách chép tay ở đây thiếu `unit`/`warpageMax`/`voidPctMax`/
  // `offsetXMax`/`offsetYMax`/`tiltMax`/`thicknessMin`/`thicknessMax` (8 field
  // không tồn tại trong `DeepImportPoint` nên vô hại HÔM NAY) và `unit` (field
  // CÓ tồn tại, gán vô điều kiện bên dưới — lỗ thật: một sheet chỉ đổi `unit`
  // trên sản phẩm live ghi thẳng, lách hàng đợi duyệt).
  const touchesLimits = touchesApprovalLimitFields(point as Record<string, unknown>);
  const strip = gateLive && touchesLimits;

  const row: InsertMeasurementPointDef = {
    productModelId,
    code: point.code,
    name: point.name,
    description: point.description,
    measurementType: legacyType,
    measurementTypeCode: point.measurementTypeCode,
    // `unit` là một trong APPROVAL_LIMIT_FIELDS (đơn vị của giới hạn 1D) — phải
    // qua cùng gate như lowerLimit/upperLimit, KHÔNG gán vô điều kiện (lỗ Task 7
    // review F2: trước bản vá field này ghi thẳng kể cả trên sản phẩm live).
    unit: strip ? undefined : point.unit,
    positionX,
    positionY,
    radius,
    normalizedX,
    normalizedY,
    normalizedRadius,
    cropWidth: Math.max(1, Math.round(point.cropWidth ?? 100)),
    cropHeight: Math.max(1, Math.round(point.cropHeight ?? 100)),
    orderIndex,
    shape: point.shape ?? "circle",
    geometry: point.geometry as Record<string, unknown> | undefined,
    componentCode: point.componentCode || undefined,
    refDesignator: point.refDesignator || undefined,
    // Limits + tolerance v2 (dropped wholesale when the product is live).
    lowerLimit: strip ? undefined : dec(legacyLimits.lowerLimit),
    upperLimit: strip ? undefined : dec(legacyLimits.upperLimit),
    nominalValue: strip ? undefined : dec(point.nominalValue),
    toleranceMode: strip ? undefined : point.toleranceMode,
    tolPlus: strip ? undefined : dec(point.tolPlus),
    tolMinus: strip ? undefined : dec(point.tolMinus),
    // 3D / solder windows (also limit-bearing → stripped on a live product).
    heightMin: strip ? undefined : dec(point.heightMin),
    heightMax: strip ? undefined : dec(point.heightMax),
    heightNominal: strip ? undefined : dec(point.heightNominal),
    heightUnit: point.heightUnit,
    areaMin: strip ? undefined : dec(point.areaMin),
    areaMax: strip ? undefined : dec(point.areaMax),
    volumeMin: strip ? undefined : dec(point.volumeMin),
    volumeMax: strip ? undefined : dec(point.volumeMax),
    volumeNominal: strip ? undefined : dec(point.volumeNominal),
    coplanarityMax: strip ? undefined : dec(point.coplanarityMax),
  };

  // ★★★ BG-113 (review Khối C lượt 9, I-2) — điểm ghi thứ 4: bulk-import KHÔNG
  // kiểm `lowerLimit ≤ upperLimit`/`heightMin ≤ heightMax` trước bản vá, nên một
  // sheet xuất ngược cột (USL trước LSL) ghi thẳng khoảng RỖNG ⇒ 100% trị đo của
  // điểm đó TRƯỢT (`pointResultEvaluator.ts`). Kiểm trên `row` SAU strip: nếu
  // `gateLive` đã xoá cặp field đó (`strip=true`), giá trị là `undefined` ⇒
  // `loiCapGioiHanSauMerge` tự bỏ qua so sánh — không kiểm hai lần. KHÔNG merge
  // với "hiện có": `buildInsertFromImportPoint` luôn tạo hàng MỚI
  // (`bulkCreateMeasurementPoints` là INSERT thuần, 0 upsert) nên không có giá
  // trị hiện có nào để merge — khác các call site kia.
  //
  // ★★★ NEW-1 (review lượt 9, vòng 2) — lặp qua `MIN_MAX_PAIRS` (5 cặp) thay vì
  // hard-code hai cặp: `row` mang areaMin/areaMax/volumeMin/volumeMax (xây ở
  // trên) — trước bản vá này hai cặp đó đi qua trắng. `thicknessMin`/`thicknessMax`
  // KHÔNG tồn tại trong `DeepImportPoint` (đo được, không phải bỏ sót của bản vá
  // này) nên luôn `undefined` ở đây — vòng lặp tự bỏ qua, vô hại; sẽ TỰ được kiểm
  // ngày `DeepImportPoint` có thêm hai field đó, không cần sửa lại file này.
  const rowLikeCapGioiHan = row as unknown as CapGioiHan;
  const loiKhoang = loiCapGioiHanSauMerge(
    Object.fromEntries(MIN_MAX_PAIRS.flatMap((p) => [[p.min, rowLikeCapGioiHan[p.min]], [p.max, rowLikeCapGioiHan[p.max]]])) as CapGioiHan,
  );
  let rangeError: string | undefined;
  if (loiKhoang.length > 0) {
    rangeError = `${point.code}: ${loiKhoang.join("; ")}`;
    // Xoá CHỈ (các) cặp vi phạm — không xoá toàn hàng (name/geometry/componentCode…
    // vẫn nhập được; kỹ sư sửa lại đúng cặp giới hạn qua UI/hàng đợi duyệt).
    for (const { min, max } of MIN_MAX_PAIRS) {
      const vMin = rowLikeCapGioiHan[min];
      const vMax = rowLikeCapGioiHan[max];
      if (vMin !== undefined && vMax !== undefined) {
        const lo = Number(vMin);
        const hi = Number(vMax);
        if (Number.isFinite(lo) && Number.isFinite(hi) && lo > hi) {
          rowLikeCapGioiHan[min] = undefined;
          rowLikeCapGioiHan[max] = undefined;
        }
      }
    }
  }

  return { row, limitsStripped: strip, rangeError };
}
