/**
 * doc 48 R4 (tech-debt) — types/helpers duplicated VERBATIM from ProductModels.tsx so the
 * extracted presentational sub-components (CreateProductDialog, ProductInfoTab,
 * ProductReleaseTab, ProductFoundationTab, PointDetailsForm, MsaStudyDialog) can share the
 * same shapes without importing from the page. Kept structurally identical to the page's
 * local copies (interchangeable via structural typing, mirroring factoryConfig/entityTypes.ts).
 */
import { type PointCriteriaItem } from "@/components/products/PointCriteriaEditor";
import { type CanvasGeometry, type CanvasPointShape } from "@/components/measurement-point-canvas/MeasurementPointCanvas";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

// tRPC inferred router-output map — lets the extracted presentational components type their
// threaded query-result props exactly (ReturnType<typeof …useQuery>["data"] collapses to {}).
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export interface MeasurementPoint {
  id?: number;
  code: string;
  name: string;
  description?: string;
  measurementType: "DIMENSION" | "VISUAL" | "ELECTRICAL" | "POSITION" | "COLOR" | "SURFACE" | "OTHER";
  unit?: string;
  lowerLimit?: string;
  upperLimit?: string;
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
  heightMin?: string;
  heightMax?: string;
  heightNominal?: string;
  heightUnit?: string;
  areaMin?: string;
  areaMax?: string;
  areaNominal?: string;
  areaUnit?: string;
  volumeMin?: string;
  volumeMax?: string;
  volumeNominal?: string;
  volumeUnit?: string;
  coplanarityMax?: string;
  warpageMax?: string;
  voidPctMax?: string;
  offsetXMax?: string;
  offsetYMax?: string;
  tiltMax?: string;
  thicknessMin?: string;
  thicknessMax?: string;
  // Doc 31 MP1/PM6 — component linkage (Pareto-by-package chain).
  componentCode?: string;
  refDesignator?: string;
  // Doc 31 MP6 — structured pass/fail criteria (jsonb, evaluated at ingest).
  criteria?: PointCriteriaItem[];
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
