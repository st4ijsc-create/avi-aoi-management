/**
 * doc 48 R4 (tech-debt) — types/helpers duplicated VERBATIM from ProductModels.tsx so the
 * extracted presentational sub-components (CreateProductDialog, ProductInfoTab,
 * ProductReleaseTab, ProductFoundationTab, PointDetailsForm, MsaStudyDialog) can share the
 * same shapes without importing from the page. Kept structurally identical to the page's
 * local copies (interchangeable via structural typing, mirroring factoryConfig/entityTypes.ts).
 *
 * Khối C Task 14 (BG-107) — 18 field giới hạn của `MeasurementPoint` TRƯỚC đây chép tay
 * (khớp NGUYÊN VĂN `shared/pointLimitSpec.ts`, không cổng nào canh lệch — đúng lớp lỗi
 * `server/contracts/pointLimitSpecCensus.test.ts` §3 bắt). Giờ suy TỪ `LIMIT_FIELDS`
 * (xem `CacCotGioiHan` dưới) — 0 tên cột gõ tay lần hai. Kết quả kiểu GIỮ NGUYÊN hình
 * dạng cũ (đối chiếu bằng tay từng field khi vá — 17 field chuỗi + `criteria` mảng).
 */
import { type PointCriteriaItem } from "@/components/products/PointCriteriaEditor";
import { type CanvasGeometry, type CanvasPointShape } from "@/components/measurement-point-canvas/MeasurementPointCanvas";
import { LIMIT_FIELDS } from "@shared/pointLimitSpec";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

// tRPC inferred router-output map — lets the extracted presentational components type their
// threaded query-result props exactly (ReturnType<typeof …useQuery>["data"] collapses to {}).
export type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * Kiểu GIÁ TRỊ của một cột giới hạn — 17/18 field là chuỗi (LSL/USL/3D/GD&T đều
 * lưu dạng string ở form), riêng `criteria` là mảng tiêu chí (jsonb). Đây là
 * NGOẠI LỆ DUY NHẤT phải khai tay (kiểu khác nhau không suy được từ tên field);
 * KHÔNG phải một field bị gõ tay lại — tên field vẫn đến từ `LIMIT_FIELDS`.
 */
type GiaTriCotGioiHan<F extends string> = F extends "criteria" ? PointCriteriaItem[] : string;

/** 18 field giới hạn, TÊN suy từ `LIMIT_FIELDS` (spec) — không liệt kê tay. */
type CacCotGioiHan = {
  [F in (typeof LIMIT_FIELDS)[number]]?: GiaTriCotGioiHan<F>;
};

export interface MeasurementPoint extends CacCotGioiHan {
  id?: number;
  code: string;
  name: string;
  description?: string;
  measurementType: "DIMENSION" | "VISUAL" | "ELECTRICAL" | "POSITION" | "COLOR" | "SURFACE" | "OTHER";
  nominalValue?: string;
  positionX: number;
  positionY: number;
  radius: number;
  shape?: CanvasPointShape;
  geometry?: CanvasGeometry;
  orderIndex: number;
  referenceImageUrl?: string;
  cropWidth: number; // Chiều rộng vùng cắt ảnh mẫu
  cropHeight: number; // Chiều cao vùng cắt ảnh mẫu
  workstationId?: number;
  preferredInstrumentId?: number;
  preferredSamplingPlanId?: number;
  measurementTypeCode?: string;
  toleranceMode?: "min_only" | "max_only" | "range" | "bilateral";
  tolPlus?: string;
  tolMinus?: string;
  datumRefs?: string[];
  materialCondition?: "MMC" | "LMC" | "RFS";
  fitClass?: string;
  positionZ?: string;
  // heightMin/heightMax/areaMin/areaMax/volumeMin/volumeMax/coplanarityMax/warpageMax/
  // voidPctMax/offsetXMax/offsetYMax/tiltMax/thicknessMin/thicknessMax/unit/lowerLimit/
  // upperLimit/criteria — 18 field spec-gate, nay đến từ CacCotGioiHan ở trên.
  heightNominal?: string;
  heightUnit?: string;
  areaNominal?: string;
  areaUnit?: string;
  volumeNominal?: string;
  volumeUnit?: string;
  // Doc 31 MP1/PM6 — component linkage (Pareto-by-package chain).
  componentCode?: string;
  refDesignator?: string;
}

export type ToleranceMode = "min_only" | "max_only" | "range" | "bilateral";
export type MaterialCondition = "MMC" | "LMC" | "RFS";

export interface ProductModel {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
  productLine?: string | null;
  variant?: string | null;
  revision?: string | null;
  clonedFromId?: number | null;
  lifecycleStatus: "development" | "active" | "eol" | "archived";
  targetYieldRate?: string | null;
  minYieldRate?: string | null;
  referenceImageUrl?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageDisplayMode?: string | null;
}

export function mapCatalogCategoryToLegacyType(category?: string): MeasurementPoint["measurementType"] {
  switch ((category || "").toUpperCase()) {
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
