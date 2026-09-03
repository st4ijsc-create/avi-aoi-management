import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { useSetCopilotContext } from "@/contexts/AiCopilotContext";
import DashboardLayout from "@/components/DashboardLayout";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";
import AIThresholdSuggestButton from "@/components/AIThresholdSuggestButton";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
// Doc 43 Đợt 3 — tab-hoá cột chi tiết (Điểm đo / Thông tin SP / Phát hành / Nền tảng).
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Plus, Package, Target, Upload, Trash2, Edit, Eye, MousePointer, Circle, Save, X, Move, ZoomIn, ZoomOut, MoreVertical, MoreHorizontal, ChevronDown, Copy, Image as ImageIcon, FileSpreadsheet, Download, Layers, CheckSquare, Square, FileText, Paperclip, Rocket, Grid3X3, Sparkles, Crosshair, AlertTriangle, TreePine } from "lucide-react";
import { useSearch, useLocation } from "wouter";
// Doc 31 UX1 (WD-1) — mount the previously-orphaned fiducial CRUD tab (0 importers).
import { ProductFiducialsTab } from "@/components/product-fiducials/ProductFiducialsTab";
// W3-C (doc 27 §2 M9) — inspection-program release workflow panel (Phát hành chương trình)
import ProgramReleasePanel from "@/components/program-release/ProgramReleasePanel";
// W8-B (doc 29 §2 — M12b) — panel N-up definition editor (Panel nhiều board)
import PanelDefinitionPanel from "@/components/panel/PanelDefinitionPanel";
// Doc 31 PM5/UX8 — per-product golden-samples panel (surfacing + capture deep-link)
import ProductGoldenSamplesPanel from "@/components/products/ProductGoldenSamplesPanel";
// Doc 31 UX2/PM9/UX7 — product readiness score + checklist + cross-links.
import ProductReadinessPanel, { ProductReadinessBadge, type ReadinessData } from "@/components/products/ProductReadinessPanel";
import { BulkImportDialog } from "@/components/BulkImportDialog";
// Doc 31 MP5/PM4 (Đợt C) — generic centroid / pick-place importer.
import { CentroidImportDialog } from "@/components/products/CentroidImportDialog";
import { EditProductDialog } from "@/components/products/EditProductDialog";
import { CloneProductDialog } from "@/components/products/CloneProductDialog";
import { PointTemplateDialog } from "@/components/products/PointTemplateDialog";
// Wave 2 đường A (Task 3) — đề xuất ngưỡng hàng loạt cho N điểm đã chọn (xem trước, không duyệt hàng loạt).
import { BatchSuggestDialog } from "@/components/productModels/BatchSuggestDialog";
// Doc 31 MP6 (decision #2) — pass/fail criteria + per-point lighting recipe editors.
import { PointCriteriaEditor, type PointCriteriaItem } from "@/components/products/PointCriteriaEditor";
import { PointLightingEditor } from "@/components/products/PointLightingEditor";
// Doc 31 OP5 (decision #3) — AQL lot acceptance board + config.
import { ProductLotAcceptancePanel } from "@/components/products/ProductLotAcceptancePanel";
import { ProductPackageButtons } from "@/components/ProductPackageButtons";
import MeasurementPointCanvas, { type CanvasGeometry, type CanvasPointShape } from "@/components/measurement-point-canvas/MeasurementPointCanvas";
import { navItems } from "@/lib/navigation";
import { EmptyState, NoMeasurementPoints } from "@/components/EmptyState";
import { DataTable } from "@/components/DataTable";
// Doc 42 Đợt 4A (APPLY-B) — thanh nhập/xuất danh sách sản phẩm (Excel/CSV).
import { ImportExportBar } from "@/components/patterns";
// Task 13 — MỘT nguồn sự thật cho spec cột (trước: PRODUCT_IO_COLUMNS riêng ở
// đây + PRODUCT_IMPORT_COLUMNS/PRODUCT_EXPORT_COLUMNS riêng ở productRouters.ts,
// khớp 10/10 nhưng không cổng nào canh lệch).
import { PRODUCT_COLUMN_SPEC } from "@shared/productColumnSpec";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { ErrorBoundary, WidgetErrorBoundary } from "@/components/ErrorBoundary";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFormValidation, ValidationPatterns } from "@/hooks/useFormValidation";
import { useFormShortcuts } from "@/hooks/useKeyboardShortcuts";
import { ValidationMessage } from "@/components/ValidationMessage";
import { DeleteConfirmDialog } from "@/components/ConfirmDialog";
// Doc 42 Đợt 0.5 — bộ dịch lỗi tRPC dùng chung (FORBIDDEN/CONFLICT/zod → tiếng Việt).
import { toastTrpcError, mapTrpcError } from "@/lib/trpcErrors";
import { CreateProductDialog } from "@/components/productModels/CreateProductDialog";
import { PointDetailsForm } from "@/components/productModels/PointDetailsForm";
import { ProductInfoTab } from "@/components/productModels/ProductInfoTab";
import { ProductReleaseTab } from "@/components/productModels/ProductReleaseTab";
import { ProductFoundationTab } from "@/components/productModels/ProductFoundationTab";
import { MsaStudyDialog } from "@/components/productModels/MsaStudyDialog";
// doc 55 Item 3 / PV3-UI — product-variant master-data admin tab.
import { ProductVariantsTab } from "@/components/products/ProductVariantsTab";
// Khối C Task 10 (QĐ-4) — tab "Cây dạy": đọc cây dạy giới hạn qua appRouter.cayDay (Task 9).
import { TeachTreeTab } from "@/components/products/teach/TeachTreeTab";

interface MeasurementPoint {
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

/** Drop incomplete criteria rows and coerce numeric bounds to strings for the API. */
function sanitizeCriteria(items: PointCriteriaItem[]): PointCriteriaItem[] {
  return (items || []).filter((c) => c && c.metric && c.metric.trim().length > 0).map((c) => {
    if (c.kind === "numeric_range") {
      return {
        kind: "numeric_range" as const,
        metric: c.metric.trim(),
        min: c.min != null && String(c.min).trim() !== "" ? String(c.min).trim() : undefined,
        max: c.max != null && String(c.max).trim() !== "" ? String(c.max).trim() : undefined,
        unit: c.unit?.trim() || undefined,
      };
    }
    if (c.kind === "boolean_check") {
      return { kind: "boolean_check" as const, metric: c.metric.trim(), expected: !!c.expected };
    }
    return {
      kind: "text_match" as const,
      metric: c.metric.trim(),
      expected: String(c.expected ?? ""),
      mode: c.mode ?? "exact",
    };
  });
}

type ToleranceMode = "min_only" | "max_only" | "range" | "bilateral";
type MaterialCondition = "MMC" | "LMC" | "RFS";

/**
 * Doc 43 Đợt 5 — tóm tắt ngưỡng của 1 điểm đo cho cột bảng (không cần i18n).
 * Ưu tiên khoảng [dưới … trên], rồi danh định ± dung sai, else "—".
 */
function thresholdSummaryOf(p: MeasurementPoint): string {
  const unit = p.unit ? ` ${p.unit}` : "";
  if (p.lowerLimit || p.upperLimit) {
    return `${p.lowerLimit ?? "−∞"} … ${p.upperLimit ?? "+∞"}${unit}`;
  }
  if (p.nominalValue) {
    if (p.tolPlus || p.tolMinus) {
      return `${p.nominalValue} +${p.tolPlus ?? "0"}/−${p.tolMinus ?? "0"}${unit}`;
    }
    return `${p.nominalValue}${unit}`;
  }
  return "—";
}

interface ProductModel {
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

function mapCatalogCategoryToLegacyType(category?: string): MeasurementPoint["measurementType"] {
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

// Doc 43 Đợt 3 — 4 tab cột chi tiết + đồng bộ ?tab= URL (deep-link, reload giữ tab).
// doc 55 Item 3 / PV3-UI — thêm tab "variants" (Biến thể) quản lý biến thể sản phẩm.
// Khối C Task 10 (QĐ-4) — thêm tab "teach" (Cây dạy): đọc cây dạy giới hạn qua appRouter.cayDay.
const PRODUCT_DETAIL_TABS = ["points", "info", "release", "foundation", "variants", "teach"] as const;

export default function ProductModels() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { hasPermission } = usePermissions();
  const setCopilotContext = useSetCopilotContext();
  const [selectedProduct, setSelectedProduct] = useState<ProductModel | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditProductDialogOpen, setIsEditProductDialogOpen] = useState(false);
  // Doc 31 UX1 (WD-1) — fiducial marks editor (mounts the orphaned ProductFiducialsTab).
  const [isFiducialsOpen, setIsFiducialsOpen] = useState(false);
  const [, setLocation] = useLocation();
  const onboardingSearch = useSearch();
  const preselectAppliedRef = useRef(false);
  const [isDeleteProductDialogOpen, setIsDeleteProductDialogOpen] = useState(false);
  // Doc 31 PM1 (WC-2) — clone product dialog + form.
  const [isCloneProductDialogOpen, setIsCloneProductDialogOpen] = useState(false);
  const [cloneSourceProduct, setCloneSourceProduct] = useState<ProductModel | null>(null);
  const [cloneNewCode, setCloneNewCode] = useState("");
  const [cloneNewName, setCloneNewName] = useState("");
  const [cloneNewRevision, setCloneNewRevision] = useState("");
  const [cloneCopyMappings, setCloneCopyMappings] = useState(false);
  const [isBulkImportDialogOpen, setIsBulkImportDialogOpen] = useState(false);
  // Doc 31 MP5/PM4 (Đợt C) — centroid / pick-place import wizard.
  const [isCentroidImportOpen, setIsCentroidImportOpen] = useState(false);
  const [isDeletePointDialogOpen, setIsDeletePointDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  // Doc 43 Đợt 5 — bọc DataTable điểm đo để cuộn hàng đang chọn vào tầm nhìn khi
  // chọn điểm từ canvas (đồng bộ canvas → bảng).
  const pointTableRef = useRef<HTMLDivElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [pointRadius, setPointRadius] = useState(20);
  const [activeDrawTool, setActiveDrawTool] = useState<CanvasPointShape>("circle");

  // Form states
  const [newProductCode, setNewProductCode] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [newProductCategory, setNewProductCategory] = useState("");
  const [newProductCategoryId, setNewProductCategoryId] = useState<number | undefined>(undefined);
  const [newProductLine, setNewProductLine] = useState("");
  const [newProductVariant, setNewProductVariant] = useState("");
  const [newProductRevision, setNewProductRevision] = useState("");
  // Doc 43 Đợt 4 (C) — sản phẩm mới mặc định 'development' để không kích cổng duyệt
  // ngưỡng (403) ngay sau khi tạo; đổi sang 'active' khi đã chốt chương trình.
  const [newProductLifecycle, setNewProductLifecycle] = useState<"development" | "active" | "eol" | "archived">("development");
  const [newProductTargetYield, setNewProductTargetYield] = useState("");
  const [newProductMinYield, setNewProductMinYield] = useState("");
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const [newProductDisplayMode, setNewProductDisplayMode] = useState<"contain" | "cover" | "stretch" | "none">("contain");

  // C3a — publish the currently-selected product model to the AI copilot.
  useEffect(() => {
    setCopilotContext(
      selectedProduct
        ? { selectedProductModelId: selectedProduct.id, selectedProductCode: selectedProduct.code }
        : {},
    );
  }, [selectedProduct, setCopilotContext]);

  // Edit product form states
  const [editProductCode, setEditProductCode] = useState("");
  const [editProductName, setEditProductName] = useState("");
  const [editProductDescription, setEditProductDescription] = useState("");
  const [editProductCategory, setEditProductCategory] = useState("");
  const [editProductCategoryId, setEditProductCategoryId] = useState<number | undefined>(undefined);
  const [editProductLine, setEditProductLine] = useState("");
  const [editProductVariant, setEditProductVariant] = useState("");
  const [editProductRevision, setEditProductRevision] = useState("");
  const [editProductLifecycle, setEditProductLifecycle] = useState<"development" | "active" | "eol" | "archived">("active");
  const [editProductTargetYield, setEditProductTargetYield] = useState("");
  const [editProductMinYield, setEditProductMinYield] = useState("");
  const [editProductImageUrl, setEditProductImageUrl] = useState("");
  const [editProductIsActive, setEditProductIsActive] = useState(true);
  const [editProductDisplayMode, setEditProductDisplayMode] = useState<"contain" | "cover" | "stretch" | "none">("contain");

  // Point form states
  const [pointCode, setPointCode] = useState("");
  const [pointName, setPointName] = useState("");
  const [pointDescription, setPointDescription] = useState("");
  const [pointType, setPointType] = useState<MeasurementPoint["measurementType"]>("VISUAL");
  const [pointUnit, setPointUnit] = useState("");
  const [pointLowerLimit, setPointLowerLimit] = useState("");
  const [pointUpperLimit, setPointUpperLimit] = useState("");
  const [pointNominalValue, setPointNominalValue] = useState("");
  const [pointMeasurementTypeCode, setPointMeasurementTypeCode] = useState("");
  const [pointToleranceMode, setPointToleranceMode] = useState<ToleranceMode>("range");
  const [pointTolPlus, setPointTolPlus] = useState("");
  const [pointTolMinus, setPointTolMinus] = useState("");
  const [pointDatumRefsInput, setPointDatumRefsInput] = useState("");
  const [pointMaterialCondition, setPointMaterialCondition] = useState<MaterialCondition | "">("");
  const [pointFitClass, setPointFitClass] = useState("");
  const [pointPositionZ, setPointPositionZ] = useState("");
  const [pointHeightMin, setPointHeightMin] = useState("");
  const [pointHeightMax, setPointHeightMax] = useState("");
  const [pointHeightNominal, setPointHeightNominal] = useState("");
  const [pointHeightUnit, setPointHeightUnit] = useState("");
  const [pointAreaMin, setPointAreaMin] = useState("");
  const [pointAreaMax, setPointAreaMax] = useState("");
  const [pointAreaNominal, setPointAreaNominal] = useState("");
  const [pointAreaUnit, setPointAreaUnit] = useState("");
  const [pointVolumeMin, setPointVolumeMin] = useState("");
  const [pointVolumeMax, setPointVolumeMax] = useState("");
  const [pointVolumeNominal, setPointVolumeNominal] = useState("");
  const [pointVolumeUnit, setPointVolumeUnit] = useState("");
  const [pointCoplanarityMax, setPointCoplanarityMax] = useState("");
  const [pointWarpageMax, setPointWarpageMax] = useState("");
  const [pointVoidPctMax, setPointVoidPctMax] = useState("");
  const [pointOffsetXMax, setPointOffsetXMax] = useState("");
  const [pointOffsetYMax, setPointOffsetYMax] = useState("");
  const [pointTiltMax, setPointTiltMax] = useState("");
  const [pointThicknessMin, setPointThicknessMin] = useState("");
  const [pointThicknessMax, setPointThicknessMax] = useState("");
  // Doc 31 MP6 (decision #2) — structured pass/fail criteria (evaluated at ingest).
  const [pointCriteria, setPointCriteria] = useState<PointCriteriaItem[]>([]);
  // Doc 31 MP1/PM6 — component linkage inputs (Pareto-by-package chain).
  const [pointComponentCode, setPointComponentCode] = useState("");
  const [pointRefDesignator, setPointRefDesignator] = useState("");
  const [pointReferenceImageUrl, setPointReferenceImageUrl] = useState("");
  const [pointCropWidth, setPointCropWidth] = useState(100);
  const [pointCropHeight, setPointCropHeight] = useState(100);
  const [pointSearchQuery, setPointSearchQuery] = useState("");
  const [pointTypeFilter, setPointTypeFilter] = useState<"all" | MeasurementPoint["measurementType"]>("all");
  const [pointWorkstationId, setPointWorkstationId] = useState<number | undefined>(undefined);
  const [pointPreferredInstrumentId, setPointPreferredInstrumentId] = useState<number | undefined>(undefined);
  const [pointPreferredSamplingPlanId, setPointPreferredSamplingPlanId] = useState<number | undefined>(undefined);
  const [pointProductViewId, setPointProductViewId] = useState<number | undefined>(undefined); // P3.4: multi-camera
  const [isSavingPoint, setIsSavingPoint] = useState(false);
  // Doc 31 UX3 — optimistic-lock conflict: holds the server's CURRENT values +
  // the values we loaded, so the dialog can show "someone else changed X" and
  // offer reload / overwrite-anyway.
  const [pointConflict, setPointConflict] = useState<
    { current: Record<string, any>; loaded: MeasurementPoint; pointData: Record<string, any>; pointId: number } | null
  >(null);
  const [imageSourceMode, setImageSourceMode] = useState<"upload" | "auto-crop">("auto-crop");
  const [newInstrumentCode, setNewInstrumentCode] = useState("");
  const [newInstrumentName, setNewInstrumentName] = useState("");
  const [newInstrumentType, setNewInstrumentType] = useState("caliper");
  const [newSamplingCode, setNewSamplingCode] = useState("");
  const [newSamplingName, setNewSamplingName] = useState("");
  const [newSamplingStrategy, setNewSamplingStrategy] = useState<"fixed_n" | "aql" | "risk_based">("fixed_n");
  const [newViewCode, setNewViewCode] = useState("");
  const [newViewName, setNewViewName] = useState("");
  const [newViewType, setNewViewType] = useState<"top" | "bottom" | "side" | "isometric" | "custom">("top");
  const [isMsaDialogOpen, setIsMsaDialogOpen] = useState(false);
  // W3-C (doc 27 §2 M9) — program release workflow dialog
  const [isProgramReleaseOpen, setIsProgramReleaseOpen] = useState(false);
  // W8-B (doc 29 §2 — M12b) — panel N-up definition editor dialog
  const [isPanelDefOpen, setIsPanelDefOpen] = useState(false);
  const [msaWizardStep, setMsaWizardStep] = useState<1 | 2 | 3>(1);
  const [selectedMsaStudyId, setSelectedMsaStudyId] = useState<number | undefined>(undefined);
  const [msaStudyCode, setMsaStudyCode] = useState("");
  const [msaStudyName, setMsaStudyName] = useState("");
  const [msaInstrumentId, setMsaInstrumentId] = useState<number | undefined>(undefined);
  const [msaMeasurementPointId, setMsaMeasurementPointId] = useState<number | undefined>(undefined);
  const [msaOperatorCount, setMsaOperatorCount] = useState(3);
  const [msaPartCount, setMsaPartCount] = useState(10);
  const [msaTrialCount, setMsaTrialCount] = useState(2);
  const [msaOperatorName, setMsaOperatorName] = useState("");
  const [msaPartLabel, setMsaPartLabel] = useState("");
  const [msaTrialNo, setMsaTrialNo] = useState(1);
  const [msaMeasuredValue, setMsaMeasuredValue] = useState("");
  const [msaLastSummary, setMsaLastSummary] = useState<any>(null);
  const [msaMatrixBaseValue, setMsaMatrixBaseValue] = useState("10");
  const [msaMatrixNoisePct, setMsaMatrixNoisePct] = useState("2");
  const [msaMatrixOverwriteExisting, setMsaMatrixOverwriteExisting] = useState(false);
  const [msaAutoAddNext, setMsaAutoAddNext] = useState(true);
  const [msaSuggestBaseValue, setMsaSuggestBaseValue] = useState(true);
  const [msaBatchInput, setMsaBatchInput] = useState("");
  const [msaBatchSkipDuplicates, setMsaBatchSkipDuplicates] = useState(true);
  const msaCsvFileInputRef = useRef<HTMLInputElement | null>(null);
  const [msaCsvHasHeader, setMsaCsvHasHeader] = useState(true);
  const [msaCsvHeaders, setMsaCsvHeaders] = useState<string[]>([]);
  const [msaCsvRows, setMsaCsvRows] = useState<string[][]>([]);
  const [msaCsvPresetName, setMsaCsvPresetName] = useState("");
  const [msaCsvSourceKey, setMsaCsvSourceKey] = useState("");
  const [msaCsvSelectedPresetKey, setMsaCsvSelectedPresetKey] = useState("__none");
  const [msaCsvColumnMap, setMsaCsvColumnMap] = useState({
    operator: 0,
    part: 1,
    trial: 2,
    value: 3,
    notes: -1,
  });
  const msaSubmitForceNextRef = useRef<boolean | null>(null);

  // Product list search and filter states
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productLifecycleFilter, setProductLifecycleFilter] = useState<"all" | "development" | "active" | "eol" | "archived">("all");
  const [productSortBy, setProductSortBy] = useState<"code" | "name" | "createdAt" | "updatedAt">("createdAt");
  const [productSortOrder, setProductSortOrder] = useState<"asc" | "desc">("desc");
  
  // Product form validation
  const productValidation = useFormValidation<{
    code: string;
    name: string;
    description: string;
  }>({
    code: { required: true, minLength: 2, maxLength: 50, pattern: ValidationPatterns.code },
    name: { required: true, minLength: 2, maxLength: 255 },
  });

  // Point form validation
  const pointValidation = useFormValidation<{
    code: string;
    name: string;
    lowerLimit: string;
    upperLimit: string;
  }>({
    code: { required: true, minLength: 2, maxLength: 50, pattern: ValidationPatterns.code },
    name: { required: true, minLength: 2, maxLength: 255 },
    lowerLimit: { custom: (val) => {
      if (val && isNaN(Number(val))) return t("validation.mustBeNumber");
      return null;
    }},
    upperLimit: { custom: (val) => {
      if (val && isNaN(Number(val))) return t("validation.mustBeNumber");
      return null;
    }},
  });

  // Template states
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateCategory, setTemplateCategory] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  
  // Batch selection states
  const [selectedPointIds, setSelectedPointIds] = useState<Set<number>>(new Set());
  const [isBatchMode, setIsBatchMode] = useState(false);
  // Wave 2 đường A (Task 3) — đề xuất ngưỡng hàng loạt cho selectedPointIds.
  const [isBatchSuggestOpen, setIsBatchSuggestOpen] = useState(false);

  // Validation errors
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Keyboard shortcuts cho dialog tạo sản phẩm
  useFormShortcuts(
    () => {
      if (isCreateDialogOpen && !createProductMutation.isPending) {
        // Trigger save
        const form = document.getElementById('create-product-form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true }));
        }
      }
    },
    () => {
      if (isCreateDialogOpen) {
        setIsCreateDialogOpen(false);
      }
    },
    { enabled: isCreateDialogOpen }
  );

  const { data: workstations } = trpc.workstation.list.useQuery();
  const { data: templates, refetch: refetchTemplates } = trpc.template.list.useQuery();
  const { data: productCategories } = trpc.productCategory.list.useQuery();
  const { data: measurementTypeCatalog } = trpc.measurementTypeCatalog.list.useQuery();

  const { data: productModels, refetch: refetchProducts } = trpc.productModel.list.useQuery({
    search: productSearchQuery || undefined,
    lifecycleStatus: productLifecycleFilter !== "all" ? productLifecycleFilter : undefined,
    sortBy: productSortBy,
    sortOrder: productSortOrder,
  });

  // Doc 31 UX2/PM9 — batched readiness for the visible products (ONE query, no N+1)
  // → per-row completeness badge without each row hitting the server.
  const productIdsForReadiness = useMemo(
    () => (productModels ?? []).map((p) => p.id),
    [productModels],
  );
  const { data: readinessBatch } = trpc.productModel.getReadinessBatch.useQuery(
    { ids: productIdsForReadiness },
    { enabled: productIdsForReadiness.length > 0 },
  );
  const readinessById = useMemo(() => {
    const m = new Map<number, ReadinessData>();
    for (const r of (readinessBatch ?? []) as ReadinessData[]) m.set(r.productModelId, r);
    return m;
  }, [readinessBatch]);

  // Doc 31 UX1 (WD-1) — deep-link preselect: /products?product=<id> opens that
  // product's editor directly. Lets the onboarding wizard "go to editor" for the
  // points/thresholds steps and land on the right product.
  useEffect(() => {
    if (preselectAppliedRef.current || !productModels) return;
    const params = new URLSearchParams(onboardingSearch);
    const p = params.get("product");
    if (!p) { preselectAppliedRef.current = true; return; }
    const id = Number(p);
    const found = (productModels as any[]).find((x) => x.id === id);
    if (found) {
      setSelectedProduct(found);
      preselectAppliedRef.current = true;
    }
  }, [onboardingSearch, productModels]);

  // Doc 43 Đợt 3 — tab cột chi tiết (Điểm đo / Thông tin SP / Phát hành / Nền tảng) đồng
  // bộ ?tab= URL (deep-link + reload giữ tab), theo pattern hub doc 36/40. Mặc định "points".
  const [activeDetailTab, setActiveDetailTab] = useState<string>(() => {
    const tab = new URLSearchParams(onboardingSearch).get("tab");
    return tab && (PRODUCT_DETAIL_TABS as readonly string[]).includes(tab) ? tab : "points";
  });
  const handleDetailTabChange = useCallback(
    (v: string) => {
      setActiveDetailTab(v);
      const params = new URLSearchParams(onboardingSearch);
      params.set("tab", v);
      setLocation(`/products?${params.toString()}`, { replace: true });
    },
    [onboardingSearch, setLocation],
  );
  // React ?tab= sau mount (deep-link vào một tab khi đã ở /products).
  useEffect(() => {
    const tab = new URLSearchParams(onboardingSearch).get("tab");
    if (tab && (PRODUCT_DETAIL_TABS as readonly string[]).includes(tab) && tab !== activeDetailTab) {
      setActiveDetailTab(tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingSearch]);
  const { data: points, refetch: refetchPoints } = trpc.measurementPoint.listByProductModel.useQuery(
    { productModelId: selectedProduct?.id || 0 },
    { enabled: !!selectedProduct }
  );
  // Wave 2 đường A — số đề xuất ngưỡng AI đang chờ theo điểm đo, để gắn badge ngay
  // trên bảng điểm đo (150 đề xuất trước đây vô hình vì chỉ hiện ở /threshold-approvals,
  // một trang khác với nơi kỹ sư thực sự chỉnh điểm đo). Lỗi/rỗng ⇒ không hiện gì,
  // KHÔNG chặn màn hình chính (đây là chỉ báo phụ).
  const { data: pendingThresholdCounts } = trpc.thresholdApproval.countPendingByProduct.useQuery(
    { productModelId: selectedProduct?.id ?? 0 },
    { enabled: !!selectedProduct?.id }
  );
  const { data: measurementInstruments, refetch: refetchMeasurementInstruments } = trpc.measurementInstrument.list.useQuery(
    undefined,
    { enabled: !!selectedProduct }
  );
  const { data: samplingPlans, refetch: refetchSamplingPlans } = trpc.samplingPlan.listByProduct.useQuery(
    { productModelId: selectedProduct?.id || 0 },
    { enabled: !!selectedProduct }
  );
  const { data: productViews, refetch: refetchProductViews } = trpc.productView.listByProduct.useQuery(
    { productModelId: selectedProduct?.id || 0 },
    { enabled: !!selectedProduct }
  );
  const { data: msaStudies, refetch: refetchMsaStudies } = trpc.msaWizard.listByProduct.useQuery(
    { productModelId: selectedProduct?.id || 0 },
    { enabled: !!selectedProduct }
  );
  const { data: msaStudyData, refetch: refetchMsaStudyData } = trpc.msaWizard.getStudy.useQuery(
    { studyId: selectedMsaStudyId || 0 },
    { enabled: !!selectedMsaStudyId }
  );
  const { data: msaCsvPresets, refetch: refetchMsaCsvPresets } = trpc.msaWizard.listCsvMappingPresets.useQuery(
    {
      productModelId: selectedProduct?.id || 0,
      sourceMachine: msaCsvSourceKey.trim() || undefined,
    },
    { enabled: !!selectedProduct && isMsaDialogOpen }
  );

  const saveMsaCsvPresetMutation = trpc.msaWizard.saveCsvMappingPreset.useMutation({
    onSuccess: () => {
      toast.success("CSV mapping preset saved");
      refetchMsaCsvPresets();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const deleteMsaCsvPresetMutation = trpc.msaWizard.deleteCsvMappingPreset.useMutation({
    onSuccess: () => {
      toast.success("CSV mapping preset deleted");
      setMsaCsvSelectedPresetKey("__none");
      refetchMsaCsvPresets();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const selectedMsaInstrument = useMemo(() => {
    return (measurementInstruments || []).find((x: any) => x.id === msaInstrumentId);
  }, [measurementInstruments, msaInstrumentId]);

  const msaCsvPresetOptions = useMemo(() => {
    return (msaCsvPresets || []).map((x: any) => ({
      key: String(x.id),
      id: x.id,
      name: x.presetName,
      source: x.sourceMachine,
      instrumentId: x.instrumentId,
      hasHeader: x.hasHeader,
      columnMap: x.columnMap,
      updatedAt: x.updatedAt,
    }));
  }, [msaCsvPresets]);

  const calculateMsaCellStats = useCallback((observations: any[], study: any) => {
    const operatorCount = Math.max(1, Number(study?.operatorCount || 1));
    const partCount = Math.max(1, Number(study?.partCount || 1));
    const trialCount = Math.max(1, Number(study?.trialCount || 1));
    const totalCells = operatorCount * partCount * trialCount;

    const existing = new Set<string>();
    for (const r of observations) {
      existing.add(`${r.operatorName}__${r.partLabel}__${r.trialNo}`);
    }

    let nextCell: { operatorName: string; partLabel: string; trialNo: number } | null = null;
    for (let op = 1; op <= operatorCount && !nextCell; op++) {
      for (let part = 1; part <= partCount && !nextCell; part++) {
        for (let trial = 1; trial <= trialCount; trial++) {
          const operatorName = `OP-${String(op).padStart(2, "0")}`;
          const partLabel = `P-${String(part).padStart(2, "0")}`;
          const key = `${operatorName}__${partLabel}__${trial}`;
          if (!existing.has(key)) {
            nextCell = { operatorName, partLabel, trialNo: trial };
            break;
          }
        }
      }
    }

    return {
      filledCells: observations.length,
      totalCells,
      nextCell,
    };
  }, []);

  const fillMsaCellInput = useCallback((cell: { operatorName: string; partLabel: string; trialNo: number }, suggestValue: boolean) => {
    setMsaOperatorName(cell.operatorName);
    setMsaPartLabel(cell.partLabel);
    setMsaTrialNo(cell.trialNo);
    if (suggestValue) {
      const baseValue = Number(msaMatrixBaseValue);
      setMsaMeasuredValue(Number.isFinite(baseValue) ? String(baseValue) : "");
    }
  }, [msaMatrixBaseValue]);

  const msaCellStats = useMemo(() => {
    const study = msaStudyData?.study as any;
    const observations = (msaStudyData?.observations || []) as any[];
    return calculateMsaCellStats(observations, study);
  }, [msaStudyData, calculateMsaCellStats]);

  const createProductMutation = trpc.productModel.create.useMutation({
    onSuccess: () => {
      toast.success(t("products.createSuccess"));
      refetchProducts();
      setIsCreateDialogOpen(false);
      resetProductForm();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const updateProductMutation = trpc.productModel.update.useMutation({
    onSuccess: () => {
      toast.success(t("products.updateSuccess"));
      refetchProducts();
      setIsEditProductDialogOpen(false);
      // Update selected product
      if (selectedProduct) {
        setSelectedProduct({
          ...selectedProduct,
          code: editProductCode,
          name: editProductName,
          description: editProductDescription,
          referenceImageUrl: editProductImageUrl || selectedProduct.referenceImageUrl,
        });
      }
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const deleteProductMutation = trpc.productModel.delete.useMutation({
    onSuccess: () => {
      toast.success(t("products.deleteSuccess"));
      refetchProducts();
      setIsDeleteProductDialogOpen(false);
      setSelectedProduct(null);
    },
    onError: (error: { message: string }) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  // Doc 31 PM1 (WC-2) — clone product. On success, select the new product.
  const cloneProductMutation = trpc.productModel.clone.useMutation({
    onSuccess: async (res: { id: number; summary?: { measurementPoints?: number } }) => {
      toast.success(t("products.cloneSuccess", { count: res.summary?.measurementPoints ?? 0 }));
      setIsCloneProductDialogOpen(false);
      const refreshed = await refetchProducts();
      const created = refreshed.data?.find((p: { id: number }) => p.id === res.id);
      if (created) {
        setSelectedProduct(created as unknown as ProductModel);
        setIsEditMode(false);
        resetPointForm();
      }
    },
    onError: (error: { message: string }) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  // Doc 42 Đợt 4A (APPLY-B) — nhập/xuất danh sách sản phẩm (Excel/CSV).
  const utils = trpc.useUtils();
  const canImportProducts = hasPermission("settings_products", "canCreate");
  const importProductsMutation = trpc.productModel.importList.useMutation();

  const handleExportProducts = useCallback(
    async (format: "csv" | "xlsx") => {
      try {
        const res = await utils.productModel.exportList.fetch({
          search: productSearchQuery || undefined,
          lifecycleStatus: productLifecycleFilter !== "all" ? productLifecycleFilter : undefined,
          sortBy: productSortBy,
          sortOrder: productSortOrder,
          format,
        });
        // base64 → Blob → tải xuống (giữ tên file + branding từ server).
        const bin = atob(res.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: res.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success(t("products.ioExportSuccess", { count: res.count, defaultValue: `Đã xuất ${res.count} sản phẩm` }));
      } catch (err) {
        toast.error(t("common.errorWithMessage", { message: (err as Error).message }));
      }
    },
    [utils, productSearchQuery, productLifecycleFilter, productSortBy, productSortOrder, t],
  );

  const handleImportProducts = useCallback(
    async (rows: Array<Record<string, unknown>>) => {
      const res = await importProductsMutation.mutateAsync({ rows });
      await refetchProducts();
      // Gộp INSERT + UPDATE vào "inserted" cho tổng kết; failed/errors giữ nguyên.
      return { inserted: res.inserted + res.updated, failed: res.failed, errors: res.errors };
    },
    [importProductsMutation, refetchProducts],
  );

  // Template mutations
  const createTemplateMutation = trpc.template.create.useMutation({
    onSuccess: () => {
      toast.success(t("products.templateSaveSuccess"));
      refetchTemplates();
      setIsTemplateDialogOpen(false);
      setTemplateName("");
      setTemplateDescription("");
      setTemplateCategory("");
      setIsSavingTemplate(false);
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
      setIsSavingTemplate(false);
    },
  });

  const deleteTemplateMutation = trpc.template.delete.useMutation({
    onSuccess: () => {
      toast.success(t("products.templateDeleteSuccess"));
      refetchTemplates();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const createPointMutation = trpc.measurementPoint.create.useMutation({
    onSuccess: () => {
      toast.success(t("products.pointCreateSuccess"));
      refetchPoints();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const updatePointMutation = trpc.measurementPoint.update.useMutation({
    onSuccess: () => {
      toast.success(t("products.pointUpdateSuccess"));
      refetchPoints();
    },
    onError: (error) => {
      // Doc 31 UX3 — a CONFLICT is handled by the reload/overwrite dialog in
      // handleSavePoint; don't also fire a scary error toast for it.
      if ((error as { data?: { code?: string } })?.data?.code === "CONFLICT") return;
      // Doc 43 Đợt 4 (A) — dịch lỗi thân thiện (FORBIDDEN duyệt-ngưỡng, zod, …)
      // thay vì dump message thô của server.
      toastTrpcError(error);
    },
  });

  const deletePointMutation = trpc.measurementPoint.delete.useMutation({
    onSuccess: () => {
      toast.success(t("products.pointDeleteSuccess"));
      refetchPoints();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const createInstrumentMutation = trpc.measurementInstrument.create.useMutation({
    onSuccess: () => {
      toast.success("Instrument created");
      refetchMeasurementInstruments();
      setNewInstrumentCode("");
      setNewInstrumentName("");
      setNewInstrumentType("caliper");
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const deleteInstrumentMutation = trpc.measurementInstrument.delete.useMutation({
    onSuccess: () => {
      toast.success("Instrument deleted");
      refetchMeasurementInstruments();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const createSamplingPlanMutation = trpc.samplingPlan.create.useMutation({
    onSuccess: () => {
      toast.success("Sampling plan created");
      refetchSamplingPlans();
      setNewSamplingCode("");
      setNewSamplingName("");
      setNewSamplingStrategy("fixed_n");
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const deleteSamplingPlanMutation = trpc.samplingPlan.delete.useMutation({
    onSuccess: () => {
      toast.success("Sampling plan deleted");
      refetchSamplingPlans();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const createProductViewMutation = trpc.productView.create.useMutation({
    onSuccess: () => {
      toast.success("Product view created");
      refetchProductViews();
      setNewViewCode("");
      setNewViewName("");
      setNewViewType("top");
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const deleteProductViewMutation = trpc.productView.delete.useMutation({
    onSuccess: () => {
      toast.success("Product view deleted");
      refetchProductViews();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const startMsaStudyMutation = trpc.msaWizard.startStudy.useMutation({
    onSuccess: (data) => {
      toast.success("MSA study started");
      setSelectedMsaStudyId(data.id);
      setMsaWizardStep(2);
      refetchMsaStudies();
      refetchMsaStudyData();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const addMsaObservationMutation = trpc.msaWizard.addObservation.useMutation({
    onSuccess: (_data, variables: any) => {
      toast.success("MSA observation added");
      const study = msaStudyData?.study as any;
      const observations = [...((msaStudyData?.observations || []) as any[])];
      observations.push({
        operatorName: variables?.operatorName,
        partLabel: variables?.partLabel,
        trialNo: variables?.trialNo,
      });
      const nextStats = calculateMsaCellStats(observations, study);
      const shouldAutoAddNext = msaSubmitForceNextRef.current ?? msaAutoAddNext;
      msaSubmitForceNextRef.current = null;
      if (shouldAutoAddNext && nextStats.nextCell) {
        fillMsaCellInput(nextStats.nextCell, msaSuggestBaseValue);
      } else {
        setMsaMeasuredValue("");
      }
      refetchMsaStudyData();
    },
    onError: (error) => {
      const code = (error as any)?.data?.code;
      if (code === "CONFLICT") {
        toast.error(t("productModels.cellDaCoDuLieu", "Cell đã có dữ liệu. Hãy đổi operator/part/trial hoặc bật overwrite để tạo lại matrix."));
        return;
      }
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const completeMsaStudyMutation = trpc.msaWizard.completeStudy.useMutation({
    onSuccess: (data) => {
      toast.success("MSA study completed");
      setMsaLastSummary(data.summary);
      setMsaWizardStep(3);
      refetchMsaStudies();
      refetchMsaStudyData();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const generateMsaMatrixMutation = trpc.msaWizard.generateMatrix.useMutation({
    onSuccess: (data) => {
      toast.success(`Matrix generated: ${data.created} created, ${data.skipped} skipped`);
      refetchMsaStudyData();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const batchAddMsaObservationsMutation = trpc.msaWizard.addObservationsBatch.useMutation({
    onSuccess: (data) => {
      toast.success(`Batch import done: ${data.created} created, ${data.skipped} skipped, ${data.errorCount} errors`);
      if (data.errorCount === 0) {
        setMsaBatchInput("");
      }
      refetchMsaStudyData();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const msaBatchPreview = useMemo(() => {
    const lines = msaBatchInput
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("#"));

    const validRows: Array<{ operatorName: string; partLabel: string; trialNo: number; measuredValue: string; notes?: string }> = [];
    const invalidRows: Array<{ lineNo: number; reason: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const parts = lines[i].split(/[\t,;]+/).map((x) => x.trim());
      if (parts.length < 4) {
        invalidRows.push({ lineNo, reason: "Need at least 4 fields: operator, part, trial, value" });
        continue;
      }

      const operatorName = parts[0];
      const partLabel = parts[1];
      const trialNo = Number(parts[2]);
      const measuredValue = parts[3];
      const notes = parts[4];

      if (!operatorName || !partLabel) {
        invalidRows.push({ lineNo, reason: "Operator and Part cannot be empty" });
        continue;
      }
      if (!Number.isInteger(trialNo) || trialNo <= 0) {
        invalidRows.push({ lineNo, reason: "Trial must be a positive integer" });
        continue;
      }
      if (!Number.isFinite(Number(measuredValue))) {
        invalidRows.push({ lineNo, reason: "Measured value must be numeric" });
        continue;
      }

      validRows.push({ operatorName, partLabel, trialNo, measuredValue, notes });
    }

    return {
      total: lines.length,
      validRows,
      invalidRows,
    };
  }, [msaBatchInput]);

  const uploadCroppedImageMutation = trpc.measurementPoint.uploadCroppedImage.useMutation({
    onSuccess: (data) => {
      toast.success(t("products.croppedImageSaveSuccess"));
      setPointReferenceImageUrl(data.imageUrl);
      refetchPoints();
    },
    onError: (error) => {
      toast.error(t("products.uploadImageError", { message: mapTrpcError(error) }));
    },
  });

  // ─── Product Documents ───────────────────────────────────
  const [showDocuments, setShowDocuments] = useState(false);
  const { data: productDocuments, refetch: refetchDocuments } = trpc.productDocument.list.useQuery(
    { productModelId: selectedProduct?.id || 0 },
    { enabled: !!selectedProduct && showDocuments }
  );

  const uploadDocumentMutation = trpc.productDocument.upload.useMutation({
    onSuccess: () => {
      toast.success(t("products.documentUploadSuccess"));
      refetchDocuments();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const deleteDocumentMutation = trpc.productDocument.delete.useMutation({
    onSuccess: () => {
      toast.success(t("products.documentDeleteSuccess"));
      refetchDocuments();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: mapTrpcError(error) }));
    },
  });

  const handleDocumentUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProduct) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("products.fileTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      uploadDocumentMutation.mutate({
        productModelId: selectedProduct.id,
        fileName: file.name,
        fileBase64: base64,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [selectedProduct, uploadDocumentMutation, t]);

  const resetProductForm = () => {
    setNewProductCode("");
    setNewProductName("");
    setNewProductDescription("");
    setNewProductCategory("");
    setNewProductLine("");
    setNewProductVariant("");
    setNewProductRevision("");
    setNewProductLifecycle("development");
    setNewProductTargetYield("");
    setNewProductMinYield("");
    setUploadedImageUrl("");
  };

  const resetPointForm = () => {
    setPointCode("");
    setPointName("");
    setPointDescription("");
    setPointType("VISUAL");
    setPointUnit("");
    setPointLowerLimit("");
    setPointUpperLimit("");
    setPointNominalValue("");
    setPointMeasurementTypeCode("");
    setPointToleranceMode("range");
    setPointTolPlus("");
    setPointTolMinus("");
    setPointDatumRefsInput("");
    setPointMaterialCondition("");
    setPointFitClass("");
    setPointPositionZ("");
    setPointHeightMin("");
    setPointHeightMax("");
    setPointHeightNominal("");
    setPointHeightUnit("");
    setPointAreaMin("");
    setPointAreaMax("");
    setPointAreaNominal("");
    setPointAreaUnit("");
    setPointVolumeMin("");
    setPointVolumeMax("");
    setPointVolumeNominal("");
    setPointVolumeUnit("");
    setPointCoplanarityMax("");
    setPointWarpageMax("");
    setPointVoidPctMax("");
    setPointOffsetXMax("");
    setPointOffsetYMax("");
    setPointTiltMax("");
    setPointThicknessMin("");
    setPointThicknessMax("");
    setPointCriteria([]);
    setPointComponentCode("");
    setPointRefDesignator("");
    setPointReferenceImageUrl("");
    setPointCropWidth(100);
    setPointCropHeight(100);
    setPointWorkstationId(undefined);
    setPointPreferredInstrumentId(undefined);
    setPointPreferredSamplingPlanId(undefined);
    setPointProductViewId(undefined);
    setSelectedPointIndex(null);
  };

  // Filter measurement points based on search and type filter
  const filteredMeasurementPoints = useMemo(() => {
    return measurementPoints.filter((point) => {
      const matchesSearch = 
        point.code.toLowerCase().includes(pointSearchQuery.toLowerCase()) ||
        point.name.toLowerCase().includes(pointSearchQuery.toLowerCase());
      const matchesType = pointTypeFilter === "all" || point.measurementType === pointTypeFilter;
      return matchesSearch && matchesType;
    });
  }, [measurementPoints, pointSearchQuery, pointTypeFilter]);

  // Doc 43 Đợt 5 — point list chip → DataTable. Bản đồ tham chiếu điểm → chỉ số
  // trong measurementPoints ĐẦY ĐỦ (selectedPointIndex/canvas dùng chỉ số này, còn
  // bảng ăn filteredMeasurementPoints), để onRowClick suy ra đúng index + STT.
  const pointIndexMap = useMemo(() => {
    const m = new Map<MeasurementPoint, number>();
    measurementPoints.forEach((p, i) => m.set(p, i));
    return m;
  }, [measurementPoints]);

  // Định danh hàng ổn định: id thật khi đã lưu, else khoá tạm theo vị trí (điểm mới
  // chưa có id không tham gia batch — khớp selectAllPoints chỉ chọn p.id).
  const pointRowId = useCallback(
    (p: MeasurementPoint): string | number =>
      p.id != null ? p.id : `new-${pointIndexMap.get(p) ?? -1}`,
    [pointIndexMap]
  );

  // Nhãn loại (Việt hoá) — dùng chung với bộ lọc; 'typeVisualLabel' sửa dịch sai.
  const pointTypeLabel = useCallback(
    (type: MeasurementPoint["measurementType"]): string => {
      const map: Record<MeasurementPoint["measurementType"], string> = {
        DIMENSION: t("products.typeDimension"),
        VISUAL: t("products.typeVisualLabel", "Trực quan"),
        ELECTRICAL: t("products.typeElectrical"),
        POSITION: t("products.typePosition"),
        COLOR: t("products.typeColor"),
        SURFACE: t("products.typeSurface"),
        OTHER: t("products.typeOther"),
      };
      return map[type] ?? type;
    },
    [t]
  );

  // selectedIds của bảng: batch mode → tập điểm đã tick (theo id); ngược lại →
  // 1 hàng đang chỉnh sửa (highlight đồng bộ với canvas qua data-state="selected").
  const pointTableSelectedIds = useMemo<Array<string | number>>(() => {
    if (isBatchMode) return Array.from(selectedPointIds);
    const active =
      selectedPointIndex != null ? measurementPoints[selectedPointIndex] : undefined;
    return active ? [pointRowId(active)] : [];
  }, [isBatchMode, selectedPointIds, selectedPointIndex, measurementPoints, pointRowId]);

  // Canvas → bảng: khi điểm đang chọn đổi (kể cả bấm trên canvas), cuộn hàng tương
  // ứng (nếu đang ở trang hiện tại) vào tầm nhìn. Batch mode không auto-cuộn.
  useEffect(() => {
    if (isBatchMode || selectedPointIndex == null) return;
    const row = pointTableRef.current?.querySelector<HTMLElement>(
      'tr[data-state="selected"]'
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedPointIndex, isBatchMode]);

  // Load measurement points when product is selected
  useEffect(() => {
    if (points) {
      setMeasurementPoints(points.map((p, index) => ({
        ...(p as any),
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description || undefined,
        measurementType: p.measurementType,
        unit: p.unit || undefined,
        lowerLimit: p.lowerLimit || undefined,
        upperLimit: p.upperLimit || undefined,
        nominalValue: p.nominalValue || undefined,
        positionX: p.positionX,
        positionY: p.positionY,
        radius: p.radius,
        shape: ((p as any).shape as CanvasPointShape) || "circle",
        geometry: ((p as any).geometry as CanvasGeometry) || {
          shape: "circle",
          x: p.positionX,
          y: p.positionY,
          radius: p.radius,
        },
        orderIndex: p.orderIndex || index,
        referenceImageUrl: p.referenceImageUrl || undefined,
        cropWidth: (p as any).cropWidth || 100,
        cropHeight: (p as any).cropHeight || 100,
        workstationId: (p as any).workstationId || undefined,
        preferredInstrumentId: (p as any).preferredInstrumentId || undefined,
        preferredSamplingPlanId: (p as any).preferredSamplingPlanId || undefined,
        productViewId: (p as any).productViewId || undefined, // P3.4
        componentCode: (p as any).componentCode || undefined, // Doc 31 MP1
        refDesignator: (p as any).refDesignator || undefined, // Doc 31 MP1
      })));
    }
  }, [points]);

  const populatePointForm = useCallback((point: MeasurementPoint) => {
    setPointCode(point.code);
    setPointName(point.name);
    setPointDescription(point.description || "");
    setPointType(point.measurementType);
    setPointMeasurementTypeCode(point.measurementTypeCode || "");
    setPointUnit(point.unit || "");
    setPointLowerLimit(point.lowerLimit || "");
    setPointUpperLimit(point.upperLimit || "");
    setPointNominalValue(point.nominalValue || "");
    setPointToleranceMode((point.toleranceMode as ToleranceMode) || "range");
    setPointTolPlus(point.tolPlus || "");
    setPointTolMinus(point.tolMinus || "");
    setPointDatumRefsInput((point.datumRefs || []).join(", "));
    setPointMaterialCondition((point.materialCondition as MaterialCondition) || "");
    setPointFitClass(point.fitClass || "");
    setPointPositionZ(point.positionZ || "");
    setPointHeightMin(point.heightMin || "");
    setPointHeightMax(point.heightMax || "");
    setPointHeightNominal(point.heightNominal || "");
    setPointHeightUnit(point.heightUnit || "");
    setPointAreaMin(point.areaMin || "");
    setPointAreaMax(point.areaMax || "");
    setPointAreaNominal(point.areaNominal || "");
    setPointAreaUnit(point.areaUnit || "");
    setPointVolumeMin(point.volumeMin || "");
    setPointVolumeMax(point.volumeMax || "");
    setPointVolumeNominal(point.volumeNominal || "");
    setPointVolumeUnit(point.volumeUnit || "");
    setPointCoplanarityMax(point.coplanarityMax || "");
    setPointWarpageMax(point.warpageMax || "");
    setPointVoidPctMax(point.voidPctMax || "");
    setPointOffsetXMax(point.offsetXMax || "");
    setPointOffsetYMax(point.offsetYMax || "");
    setPointTiltMax(point.tiltMax || "");
    setPointThicknessMin(point.thicknessMin || "");
    setPointThicknessMax(point.thicknessMax || "");
    setPointCriteria(Array.isArray(point.criteria) ? (point.criteria as PointCriteriaItem[]) : []);
    setPointComponentCode(point.componentCode || "");
    setPointRefDesignator(point.refDesignator || "");
    setPointReferenceImageUrl(point.referenceImageUrl || "");
    setPointRadius(point.radius);
    setPointCropWidth(point.cropWidth || 100);
    setPointCropHeight(point.cropHeight || 100);
    setPointWorkstationId(point.workstationId);
    setPointPreferredInstrumentId(point.preferredInstrumentId);
    setPointPreferredSamplingPlanId(point.preferredSamplingPlanId);
    setPointProductViewId((point as any).productViewId);
  }, []);

  const selectedCatalogType = useMemo(() => {
    if (!pointMeasurementTypeCode || !measurementTypeCatalog) return null;
    return measurementTypeCatalog.find((item) => item.code === pointMeasurementTypeCode) || null;
  }, [pointMeasurementTypeCode, measurementTypeCatalog]);

  const pointTypeCategory = selectedCatalogType?.category?.toUpperCase();
  const showToleranceSection = pointTypeCategory === "DIMENSION" || pointTypeCategory === "GD_T" || pointType === "DIMENSION" || pointType === "ELECTRICAL";
  const showGdtSection = pointTypeCategory === "GD_T";
  const showSolderSection = pointTypeCategory === "SOLDER";
  const showXraySection = pointTypeCategory === "XRAY";
  // Doc 31 MP6 (decision #2) — expose position/coating 3D limits by BOTH the
  // fine-grained catalog category AND the coarse measurementType (so a POSITION/
  // SURFACE point without a catalog code still gets its offset/tilt/thickness
  // fields). VISUAL/COLOR/ELECTRICAL never show 3D.
  const showPositionSection = pointTypeCategory === "POSITION" || (!pointTypeCategory && pointType === "POSITION");
  const showCoatingSection = pointTypeCategory === "COATING" || pointTypeCategory === "SURFACE" || (!pointTypeCategory && pointType === "SURFACE");
  // Coplanarity/warpage are BGA/xray/solder concerns; void% is xray.
  const showCoplanaritySection = showSolderSection || showXraySection;
  const show3DSection = showSolderSection || showXraySection || showPositionSection || showCoatingSection;

  // Doc 43 Đợt 4 (A) — dirty-track các trường NGƯỠNG so với bản gốc đã load. Chỉ khi
  // các trường này THỰC SỰ đổi ta mới gửi chúng lên (xem handleSavePoint) để không
  // kích cổng duyệt (server `touchesLimits`) khi người dùng chỉ sửa tên/mô tả.
  // Điểm mới (chưa có id) đi qua đường create — không bị gate — nên luôn = false.
  const thresholdFieldsDirty = useMemo(() => {
    if (selectedPointIndex === null) return false;
    const base = measurementPoints[selectedPointIndex];
    if (!base || !base.id) return false;
    const norm = (v: unknown) => (v == null ? "" : String(v));
    return (
      norm(base.lowerLimit) !== norm(pointLowerLimit) ||
      norm(base.upperLimit) !== norm(pointUpperLimit) ||
      norm(base.nominalValue) !== norm(pointNominalValue) ||
      norm(base.toleranceMode || "range") !== norm(pointToleranceMode) ||
      norm(base.tolPlus) !== norm(pointTolPlus) ||
      norm(base.tolMinus) !== norm(pointTolMinus)
    );
  }, [selectedPointIndex, measurementPoints, pointLowerLimit, pointUpperLimit, pointNominalValue, pointToleranceMode, pointTolPlus, pointTolMinus]);

  // Sản phẩm ở vòng đời khiến sửa ngưỡng trực tiếp phải qua hàng đợi duyệt — khớp
  // thresholdGovernanceService (mọi trạng thái ≠ 'development'). Không thấy được
  // trạng thái released-program phía client nên đây chỉ là gợi ý; server vẫn là
  // nguồn sự thật cuối.
  const productGatesThresholds = !!selectedProduct && selectedProduct.lifecycleStatus !== "development";
  const saveWillRequireApproval = productGatesThresholds && thresholdFieldsDirty;

  // Draw measurement points on canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !imageLoaded) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const displayScale = scale * (zoomLevel / 100);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Draw measurement points
    measurementPoints.forEach((point, index) => {
      const x = point.positionX * displayScale;
      const y = point.positionY * displayScale;
      const r = point.radius * displayScale;

      // Draw crop area rectangle for selected point
      if (selectedPointIndex === index && point.cropWidth && point.cropHeight) {
        const cropW = point.cropWidth * displayScale;
        const cropH = point.cropHeight * displayScale;
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(x - cropW / 2, y - cropH / 2, cropW, cropH);
        ctx.setLineDash([]);
        
        // Draw corner markers
        const cornerSize = 8;
        ctx.fillStyle = "#f59e0b";
        // Top-left
        ctx.fillRect(x - cropW / 2 - cornerSize / 2, y - cropH / 2 - cornerSize / 2, cornerSize, cornerSize);
        // Top-right
        ctx.fillRect(x + cropW / 2 - cornerSize / 2, y - cropH / 2 - cornerSize / 2, cornerSize, cornerSize);
        // Bottom-left
        ctx.fillRect(x - cropW / 2 - cornerSize / 2, y + cropH / 2 - cornerSize / 2, cornerSize, cornerSize);
        // Bottom-right
        ctx.fillRect(x + cropW / 2 - cornerSize / 2, y + cropH / 2 - cornerSize / 2, cornerSize, cornerSize);
      }

      // Draw circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = selectedPointIndex === index ? "#10b981" : "#06b6d4";
      ctx.lineWidth = selectedPointIndex === index ? 3 : 2;
      ctx.stroke();

      // Draw fill with transparency
      ctx.fillStyle = selectedPointIndex === index ? "rgba(16, 185, 129, 0.3)" : "rgba(6, 182, 212, 0.15)";
      ctx.fill();

      // Draw point number with a solid badge background for high contrast
      const label = String(index + 1);
      const fontSize = Math.max(14, Math.min(r * 0.9, 22));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const textWidth = ctx.measureText(label).width;
      const padX = 6;
      const padY = 3;
      const badgeW = textWidth + padX * 2;
      const badgeH = fontSize + padY * 2;
      // Position badge at top-right of the marker so it doesn't cover the point center
      const badgeX = x + r * 0.7;
      const badgeY = y - r - badgeH / 2 - 2;

      // Badge background (rounded rect)
      const radiusBadge = badgeH / 2;
      ctx.fillStyle = selectedPointIndex === index ? "#10b981" : "#0e7490";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const bx = badgeX - badgeW / 2;
      const by = badgeY - badgeH / 2;
      ctx.moveTo(bx + radiusBadge, by);
      ctx.lineTo(bx + badgeW - radiusBadge, by);
      ctx.quadraticCurveTo(bx + badgeW, by, bx + badgeW, by + radiusBadge);
      ctx.lineTo(bx + badgeW, by + badgeH - radiusBadge);
      ctx.quadraticCurveTo(bx + badgeW, by + badgeH, bx + badgeW - radiusBadge, by + badgeH);
      ctx.lineTo(bx + radiusBadge, by + badgeH);
      ctx.quadraticCurveTo(bx, by + badgeH, bx, by + badgeH - radiusBadge);
      ctx.lineTo(bx, by + radiusBadge);
      ctx.quadraticCurveTo(bx, by, bx + radiusBadge, by);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Badge text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, badgeX, badgeY);
    });
  }, [measurementPoints, selectedPointIndex, scale, zoomLevel, imageLoaded]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Update canvas size when zoom changes
  useEffect(() => {
    if (imageRef.current && canvasRef.current && imageLoaded) {
      const displayScale = scale * (zoomLevel / 100);
      canvasRef.current.width = imageRef.current.width * displayScale;
      canvasRef.current.height = imageRef.current.height * displayScale;
      drawCanvas();
    }
  }, [zoomLevel, scale, imageLoaded, drawCanvas]);

  // Load image when product is selected
  useEffect(() => {
    if (selectedProduct?.referenceImageUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        imageRef.current = img;
        const canvas = canvasRef.current;
        if (canvas) {
          // Calculate scale to fit canvas
          const maxWidth = 800;
          const maxHeight = 600;
          const scaleX = maxWidth / img.width;
          const scaleY = maxHeight / img.height;
          const newScale = Math.min(scaleX, scaleY, 1);
          setScale(newScale);
          canvas.width = img.width * newScale;
          canvas.height = img.height * newScale;
        }
        setImageLoaded(true);
      };
      img.src = selectedProduct.referenceImageUrl;
    } else {
      setImageLoaded(false);
      imageRef.current = null;
    }
  }, [selectedProduct?.referenceImageUrl]);

  // Doc 31 MP9 — legacy raw-<canvas> handlers (handleCanvasClick/MouseDown/Move/Up)
  // removed 2026-07-05: the live editor is <MeasurementPointCanvas> (SVG). These were
  // never wired into any JSX (verified: 0 onClick/onMouseDown references) and are dead.

  const handleCreateProduct = () => {
    const isValid = productValidation.validate({
      code: newProductCode,
      name: newProductName,
      description: newProductDescription,
    });
    
    if (!isValid) {
      toast.error(t("validation.pleaseCheckInput"));
      return;
    }

    createProductMutation.mutate({
      code: newProductCode,
      name: newProductName,
      description: newProductDescription || undefined,
      category: newProductCategory || undefined,
      categoryId: newProductCategoryId,
      productLine: newProductLine || undefined,
      variant: newProductVariant || undefined,
      revision: newProductRevision || undefined,
      lifecycleStatus: newProductLifecycle,
      targetYieldRate: newProductTargetYield || undefined,
      minYieldRate: newProductMinYield || undefined,
      referenceImageUrl: uploadedImageUrl || undefined,
      imageDisplayMode: newProductDisplayMode,
    });
  };

  const handleUpdateProduct = () => {
    if (!selectedProduct || !editProductCode || !editProductName) {
      toast.error(t("validation.pleaseEnterCodeAndName"));
      return;
    }

    updateProductMutation.mutate({
      id: selectedProduct.id,
      code: editProductCode,
      name: editProductName,
      description: editProductDescription || undefined,
      category: editProductCategory || undefined,
      categoryId: editProductCategoryId,
      productLine: editProductLine || undefined,
      variant: editProductVariant || undefined,
      revision: editProductRevision || undefined,
      lifecycleStatus: editProductLifecycle,
      targetYieldRate: editProductTargetYield || undefined,
      minYieldRate: editProductMinYield || undefined,
      referenceImageUrl: editProductImageUrl || undefined,
      imageDisplayMode: editProductDisplayMode,
      isActive: editProductIsActive,
    });
  };

  const handleDeleteProduct = () => {
    if (!selectedProduct) return;
    deleteProductMutation.mutate({ id: selectedProduct.id });
  };

  // Doc 31 PM1 (WC-2) — open clone dialog, prefill a suggested code + bumped rev.
  const openCloneProductDialog = (product: ProductModel) => {
    setCloneSourceProduct(product);
    setCloneNewCode(`${product.code}-COPY`);
    setCloneNewName(product.name ? `${product.name} (copy)` : "");
    setCloneNewRevision(product.revision || "");
    setCloneCopyMappings(false);
    setIsCloneProductDialogOpen(true);
  };

  const handleCloneProduct = () => {
    if (!cloneSourceProduct || !cloneNewCode.trim()) {
      toast.error(t("products.cloneCodeRequired"));
      return;
    }
    cloneProductMutation.mutate({
      sourceId: cloneSourceProduct.id,
      newCode: cloneNewCode.trim(),
      newName: cloneNewName.trim() || undefined,
      newRevision: cloneNewRevision.trim() || undefined,
      copyMappings: cloneCopyMappings,
    });
  };

  const handleCreateInstrument = () => {
    if (!newInstrumentCode.trim() || !newInstrumentName.trim()) {
      toast.error("Please enter instrument code and name");
      return;
    }
    createInstrumentMutation.mutate({
      code: newInstrumentCode.trim(),
      name: newInstrumentName.trim(),
      instrumentType: newInstrumentType,
      isActive: true,
    });
  };

  const handleCreateSamplingPlan = () => {
    if (!selectedProduct) return;
    if (!newSamplingCode.trim() || !newSamplingName.trim()) {
      toast.error("Please enter sampling plan code and name");
      return;
    }
    createSamplingPlanMutation.mutate({
      productModelId: selectedProduct.id,
      code: newSamplingCode.trim(),
      name: newSamplingName.trim(),
      strategy: newSamplingStrategy,
      sampleSize: 10,
      acceptanceQty: 0,
      rejectionQty: 1,
      isActive: true,
    });
  };

  const handleCreateProductView = () => {
    if (!selectedProduct) return;
    if (!newViewCode.trim() || !newViewName.trim()) {
      toast.error("Please enter view code and name");
      return;
    }
    createProductViewMutation.mutate({
      productModelId: selectedProduct.id,
      code: newViewCode.trim(),
      name: newViewName.trim(),
      viewType: newViewType,
      orderIndex: (productViews?.length || 0),
      isActive: true,
    });
  };

  const handleStartMsaStudy = () => {
    if (!selectedProduct) return;
    if (!msaStudyCode.trim() || !msaStudyName.trim()) {
      toast.error("Please enter MSA study code and name");
      return;
    }
    startMsaStudyMutation.mutate({
      productModelId: selectedProduct.id,
      studyCode: msaStudyCode.trim(),
      name: msaStudyName.trim(),
      studyType: "gage_rr",
      measurementPointDefId: msaMeasurementPointId,
      instrumentId: msaInstrumentId,
      operatorCount: msaOperatorCount,
      partCount: msaPartCount,
      trialCount: msaTrialCount,
    });
  };

  const handleAddMsaObservation = () => {
    if (!selectedMsaStudyId) {
      toast.error("Please select an MSA study");
      return;
    }
    if (!msaOperatorName.trim() || !msaPartLabel.trim() || !msaMeasuredValue.trim()) {
      toast.error("Please enter operator, part and measured value");
      return;
    }
    msaSubmitForceNextRef.current = null;
    addMsaObservationMutation.mutate({
      studyId: selectedMsaStudyId,
      operatorName: msaOperatorName.trim(),
      partLabel: msaPartLabel.trim(),
      trialNo: msaTrialNo,
      measuredValue: msaMeasuredValue,
    });
  };

  const submitMsaObservationWithForceMode = (forceAddNext: boolean) => {
    if (!selectedMsaStudyId) {
      toast.error("Please select an MSA study");
      return;
    }
    if (!msaOperatorName.trim() || !msaPartLabel.trim() || !msaMeasuredValue.trim()) {
      toast.error("Please enter operator, part and measured value");
      return;
    }
    msaSubmitForceNextRef.current = forceAddNext;
    addMsaObservationMutation.mutate({
      studyId: selectedMsaStudyId,
      operatorName: msaOperatorName.trim(),
      partLabel: msaPartLabel.trim(),
      trialNo: msaTrialNo,
      measuredValue: msaMeasuredValue,
    });
  };

  const handleCompleteMsaStudy = () => {
    if (!selectedMsaStudyId) {
      toast.error("Please select an MSA study");
      return;
    }
    completeMsaStudyMutation.mutate({ studyId: selectedMsaStudyId });
  };

  const handleGenerateMsaMatrix = () => {
    if (!selectedMsaStudyId) {
      toast.error("Please select an MSA study");
      return;
    }
    const baseValue = Number(msaMatrixBaseValue);
    const noisePct = Number(msaMatrixNoisePct);
    if (!Number.isFinite(baseValue) || !Number.isFinite(noisePct)) {
      toast.error("Please enter valid matrix parameters");
      return;
    }
    generateMsaMatrixMutation.mutate({
      studyId: selectedMsaStudyId,
      baseValue,
      noisePct,
      overwriteExisting: msaMatrixOverwriteExisting,
    });
  };

  const handleApplyMsaPreset = (baseValue: number, noisePct: number) => {
    setMsaMatrixBaseValue(String(baseValue));
    setMsaMatrixNoisePct(String(noisePct));
  };

  const handleFillNextMsaCell = () => {
    const nextCell = msaCellStats.nextCell;
    if (!nextCell) {
      toast.success("All matrix cells are already filled");
      return;
    }
    fillMsaCellInput(nextCell, msaSuggestBaseValue);
  };

  const handleBatchImportMsaObservations = () => {
    if (!selectedMsaStudyId) {
      toast.error("Please select an MSA study");
      return;
    }
    if (msaBatchPreview.validRows.length === 0) {
      toast.error("No valid rows to import");
      return;
    }

    batchAddMsaObservationsMutation.mutate({
      studyId: selectedMsaStudyId,
      skipDuplicates: msaBatchSkipDuplicates,
      rows: msaBatchPreview.validRows,
    });
  };

  const detectCsvColumnIndex = (headers: string[], aliases: string[]) => {
    const normalizedHeaders = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ""));
    for (let i = 0; i < normalizedHeaders.length; i++) {
      if (aliases.some((a) => normalizedHeaders[i].includes(a))) {
        return i;
      }
    }
    return -1;
  };

  const applyMsaCsvMappingToBatchInput = (rows: string[][], map: typeof msaCsvColumnMap) => {
    const mappedLines: string[] = [];
    let skipped = 0;

    for (const row of rows) {
      const operatorName = (row[map.operator] || "").trim();
      const partLabel = (row[map.part] || "").trim();
      const trialNo = (row[map.trial] || "").trim();
      const measuredValue = (row[map.value] || "").trim();
      const notes = map.notes >= 0 ? (row[map.notes] || "").trim() : "";

      if (!operatorName || !partLabel || !trialNo || !measuredValue) {
        skipped++;
        continue;
      }

      mappedLines.push(notes ? `${operatorName},${partLabel},${trialNo},${measuredValue},${notes}` : `${operatorName},${partLabel},${trialNo},${measuredValue}`);
    }

    setMsaBatchInput(mappedLines.join("\n"));
    toast.success(`CSV mapped: ${mappedLines.length} lines${skipped > 0 ? `, ${skipped} skipped` : ""}`);
  };

  const handleMsaCsvFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const allRows = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => line.split(/[\t,;]+/).map((cell) => cell.trim()));

      if (allRows.length === 0) {
        toast.error("CSV file is empty");
        return;
      }

      const headers = msaCsvHasHeader ? allRows[0] : [];
      const dataRows = msaCsvHasHeader ? allRows.slice(1) : allRows;
      if (dataRows.length === 0) {
        toast.error("CSV has no data rows");
        return;
      }

      const operator = headers.length > 0 ? detectCsvColumnIndex(headers, ["operator", "op", "user", "inspector"]) : 0;
      const part = headers.length > 0 ? detectCsvColumnIndex(headers, ["part", "label", "piece", "sample"]) : 1;
      const trial = headers.length > 0 ? detectCsvColumnIndex(headers, ["trial", "repeat", "run"]) : 2;
      const value = headers.length > 0 ? detectCsvColumnIndex(headers, ["value", "measured", "measurement", "result"]) : 3;
      const notes = headers.length > 0 ? detectCsvColumnIndex(headers, ["note", "remark", "comment"]) : -1;

      const map = {
        operator: operator >= 0 ? operator : 0,
        part: part >= 0 ? part : 1,
        trial: trial >= 0 ? trial : 2,
        value: value >= 0 ? value : 3,
        notes,
      };

      setMsaCsvHeaders(headers);
      setMsaCsvRows(dataRows);
      setMsaCsvColumnMap(map);
      applyMsaCsvMappingToBatchInput(dataRows, map);
    };

    reader.readAsText(file);
    event.target.value = "";
  };

  const handleApplyMsaCsvMapping = () => {
    if (msaCsvRows.length === 0) {
      toast.error("No CSV data loaded");
      return;
    }
    applyMsaCsvMappingToBatchInput(msaCsvRows, msaCsvColumnMap);
  };

  const handleSaveMsaCsvPreset = () => {
    if (!selectedProduct) {
      toast.error("Please select a product");
      return;
    }
    const name = msaCsvPresetName.trim();
    const source = msaCsvSourceKey.trim();
    if (!name) {
      toast.error("Please enter preset name");
      return;
    }
    if (!source) {
      toast.error("Please enter source machine");
      return;
    }

    saveMsaCsvPresetMutation.mutate({
      productModelId: selectedProduct.id,
      sourceMachine: source,
      presetName: name,
      instrumentId: msaInstrumentId,
      hasHeader: msaCsvHasHeader,
      columnMap: { ...msaCsvColumnMap },
    }, {
      onSuccess: (data) => {
        setMsaCsvSelectedPresetKey(String(data.id));
      },
    });
  };

  const handleLoadMsaCsvPreset = (key: string) => {
    if (key === "__none") {
      setMsaCsvSelectedPresetKey("__none");
      return;
    }
    const preset = msaCsvPresetOptions.find((x) => String(x.id) === key);
    if (!preset) {
      toast.error("Preset not found");
      return;
    }
    setMsaCsvSelectedPresetKey(key);
    setMsaCsvPresetName(preset.name);
    setMsaCsvSourceKey(preset.source);
    setMsaCsvHasHeader(preset.hasHeader);
    setMsaCsvColumnMap({ ...preset.columnMap });
    if (msaCsvRows.length > 0) {
      applyMsaCsvMappingToBatchInput(msaCsvRows, preset.columnMap);
    }
    toast.success("CSV mapping preset loaded");
  };

  const handleDeleteMsaCsvPreset = () => {
    if (msaCsvSelectedPresetKey === "__none") {
      toast.error("Please select preset to delete");
      return;
    }
    deleteMsaCsvPresetMutation.mutate({ id: Number(msaCsvSelectedPresetKey) });
  };

  const openMsaWizard = () => {
    setMsaWizardStep(1);
    setMsaLastSummary(null);
    setMsaMatrixOverwriteExisting(false);
    setMsaAutoAddNext(true);
    setMsaSuggestBaseValue(true);
    setIsMsaDialogOpen(true);
  };

  useEffect(() => {
    if (!selectedMsaInstrument?.code) return;
    if (msaCsvSourceKey.trim()) return;
    setMsaCsvSourceKey(selectedMsaInstrument.code);
  }, [selectedMsaInstrument, msaCsvSourceKey]);

  useEffect(() => {
    if (!isMsaDialogOpen || msaWizardStep !== 2) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (addMsaObservationMutation.isPending || completeMsaStudyMutation.isPending) return;

      if (event.key === "Enter" && event.ctrlKey) {
        event.preventDefault();
        submitMsaObservationWithForceMode(true);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        submitMsaObservationWithForceMode(false);
        return;
      }

      if (event.key === "F2") {
        event.preventDefault();
        handleFillNextMsaCell();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    isMsaDialogOpen,
    msaWizardStep,
    addMsaObservationMutation.isPending,
    completeMsaStudyMutation.isPending,
    submitMsaObservationWithForceMode,
    handleFillNextMsaCell,
  ]);

  const openEditProductDialog = (product?: ProductModel) => {
    const target = product ?? selectedProduct;
    if (!target) return;
    setEditProductCode(target.code);
    setEditProductName(target.name);
    setEditProductDescription(target.description || "");
    setEditProductCategory(target.category || "");
    setEditProductLine(target.productLine || "");
    setEditProductVariant(target.variant || "");
    setEditProductRevision(target.revision || "");
    setEditProductLifecycle(target.lifecycleStatus);
    setEditProductTargetYield(target.targetYieldRate || "");
    setEditProductMinYield(target.minYieldRate || "");
    setEditProductImageUrl("");
    setEditProductDisplayMode((target.imageDisplayMode as any) || "contain");
    setIsEditProductDialogOpen(true);
  };

  // Crop image from canvas and convert to base64
  const cropImageFromCanvas = (posX: number, posY: number, cropW: number, cropH: number): string | null => {
    const image = imageRef.current;
    if (!image) return null;

    // Create temporary canvas for cropping
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cropW;
    tempCanvas.height = cropH;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    // Calculate crop area (centered on point position)
    const cropX = Math.max(0, posX - cropW / 2);
    const cropY = Math.max(0, posY - cropH / 2);

    // Draw cropped region
    tempCtx.drawImage(
      image,
      cropX, cropY, cropW, cropH,  // Source rectangle
      0, 0, cropW, cropH            // Destination rectangle
    );

    // Convert to base64
    return tempCanvas.toDataURL('image/png').split(',')[1];
  };

  const handleSavePoint = async () => {
    if (selectedPointIndex === null || !selectedProduct) return;

    setIsSavingPoint(true);
    
    const point = measurementPoints[selectedPointIndex];
    const pointData = {
      code: pointCode,
      name: pointName,
      description: pointDescription || undefined,
      measurementType: pointType,
      measurementTypeCode: pointMeasurementTypeCode || undefined,
      unit: pointUnit || undefined,
      lowerLimit: pointLowerLimit || undefined,
      upperLimit: pointUpperLimit || undefined,
      nominalValue: pointNominalValue || undefined,
      toleranceMode: pointToleranceMode,
      tolPlus: pointTolPlus || undefined,
      tolMinus: pointTolMinus || undefined,
      datumRefs: pointDatumRefsInput
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      materialCondition: (pointMaterialCondition || undefined) as MaterialCondition | undefined,
      fitClass: pointFitClass || undefined,
      positionZ: pointPositionZ || undefined,
      heightMin: pointHeightMin || undefined,
      heightMax: pointHeightMax || undefined,
      heightNominal: pointHeightNominal || undefined,
      heightUnit: pointHeightUnit || undefined,
      areaMin: pointAreaMin || undefined,
      areaMax: pointAreaMax || undefined,
      areaNominal: pointAreaNominal || undefined,
      areaUnit: pointAreaUnit || undefined,
      volumeMin: pointVolumeMin || undefined,
      volumeMax: pointVolumeMax || undefined,
      volumeNominal: pointVolumeNominal || undefined,
      volumeUnit: pointVolumeUnit || undefined,
      coplanarityMax: pointCoplanarityMax || undefined,
      warpageMax: pointWarpageMax || undefined,
      voidPctMax: pointVoidPctMax || undefined,
      offsetXMax: pointOffsetXMax || undefined,
      offsetYMax: pointOffsetYMax || undefined,
      tiltMax: pointTiltMax || undefined,
      thicknessMin: pointThicknessMin || undefined,
      thicknessMax: pointThicknessMax || undefined,
      // Doc 31 MP6 — send only complete criteria rows; [] clears them.
      criteria: sanitizeCriteria(pointCriteria),
      componentCode: pointComponentCode.trim() || undefined,
      refDesignator: pointRefDesignator.trim() || undefined,
      positionX: point.positionX,
      positionY: point.positionY,
      radius: point.radius,
      shape: point.shape || "circle",
      geometry: (point.geometry as any) || {
        shape: "circle",
        x: point.positionX,
        y: point.positionY,
        radius: point.radius,
      },
      orderIndex: selectedPointIndex,
      referenceImageUrl: pointReferenceImageUrl || undefined,
      cropWidth: pointCropWidth,
      cropHeight: pointCropHeight,
      workstationId: pointWorkstationId,
      preferredInstrumentId: pointPreferredInstrumentId,
      preferredSamplingPlanId: pointPreferredSamplingPlanId,
      productViewId: pointProductViewId, // P3.4
    };

    try {
      if (point.id) {
        // Doc 43 Đợt 4 (A) — dirty-track: nếu người dùng KHÔNG đổi ngưỡng thì bỏ hẳn
        // các trường ngưỡng khỏi payload update, để server `touchesLimits` không kích
        // cổng duyệt (403) trên sản phẩm active khi chỉ sửa tên/mô tả. Bản `pointData`
        // (đủ trường) vẫn dùng cho cập-nhật-local + đường create bên dưới.
        const updatePayload: Record<string, unknown> = { ...pointData };
        if (!thresholdFieldsDirty) {
          delete updatePayload.lowerLimit;
          delete updatePayload.upperLimit;
          delete updatePayload.nominalValue;
          delete updatePayload.toleranceMode;
          delete updatePayload.tolPlus;
          delete updatePayload.tolMinus;
        }
        // Update existing point — Doc 31 UX3: send the updatedAt we loaded so the
        // server can compare-and-set and reject a stale overwrite (CONFLICT).
        await updatePointMutation.mutateAsync({
          id: point.id,
          ...updatePayload,
          expectedUpdatedAt: (point as any).updatedAt ?? undefined,
        });

        // Auto crop and upload reference image if mode is auto-crop and image is loaded
        if (imageSourceMode === "auto-crop" && imageRef.current && pointCropWidth > 0 && pointCropHeight > 0) {
          const croppedBase64 = cropImageFromCanvas(point.positionX, point.positionY, pointCropWidth, pointCropHeight);
          if (croppedBase64) {
            await uploadCroppedImageMutation.mutateAsync({
              pointId: point.id,
              imageBase64: croppedBase64,
              mimeType: 'image/png',
            });
          }
        }
      } else {
        // Create new point
        const result = await createPointMutation.mutateAsync({
          productModelId: selectedProduct.id,
          ...pointData,
        });

        // Auto crop for new point if mode is auto-crop
        if (imageSourceMode === "auto-crop" && imageRef.current && pointCropWidth > 0 && pointCropHeight > 0 && result.id) {
          const croppedBase64 = cropImageFromCanvas(point.positionX, point.positionY, pointCropWidth, pointCropHeight);
          if (croppedBase64) {
            await uploadCroppedImageMutation.mutateAsync({
              pointId: result.id,
              imageBase64: croppedBase64,
              mimeType: 'image/png',
            });
          }
        }
      }

      // Update local state. Doc 31 UX3: drop the stale local updatedAt — the
      // server just bumped it and refetchPoints() (mutation onSuccess) will pull
      // the fresh value; a super-fast re-save before that lands then skips the
      // check (undefined) instead of false-conflicting on the old timestamp.
      const updatedPoints = [...measurementPoints];
      updatedPoints[selectedPointIndex] = {
        ...point,
        ...pointData,
        updatedAt: undefined,
      } as MeasurementPoint;
      setMeasurementPoints(updatedPoints);
    } catch (error) {
      // Doc 31 UX3 — stale overwrite: open the reload/overwrite dialog with the
      // server's current values. All other errors are handled by mutation onError.
      const data = (error as { data?: { code?: string; conflict?: { current?: Record<string, any> } } })?.data;
      if (data?.code === "CONFLICT" && point.id) {
        setPointConflict({
          current: data.conflict?.current ?? {},
          loaded: point,
          pointData,
          pointId: point.id,
        });
      }
    } finally {
      setIsSavingPoint(false);
    }
  };

  // Doc 31 UX3 — "Overwrite anyway": re-run the update WITHOUT expectedUpdatedAt so
  // the server skips the compare-and-set (deliberate last-write-wins after review).
  const handleOverwriteConflict = async () => {
    if (!pointConflict) return;
    setIsSavingPoint(true);
    try {
      await updatePointMutation.mutateAsync({
        id: pointConflict.pointId,
        ...(pointConflict.pointData as any),
      });
      setPointConflict(null);
      refetchPoints();
    } catch {
      // handled by mutation onError
    } finally {
      setIsSavingPoint(false);
    }
  };

  // "Reload" — discard my edits, pull the current server state back into the editor.
  const handleReloadConflict = () => {
    setPointConflict(null);
    refetchPoints();
  };

  const confirmDeletePoint = () => {
    if (selectedPointIndex === null) return;
    setIsDeletePointDialogOpen(true);
  };

  const handleDeletePoint = () => {
    if (selectedPointIndex === null) return;

    const point = measurementPoints[selectedPointIndex];
    if (point.id) {
      deletePointMutation.mutate({ id: point.id });
    }

    const updatedPoints = measurementPoints.filter((_, i) => i !== selectedPointIndex);
    setMeasurementPoints(updatedPoints);
    setSelectedPointIndex(null);
    setIsDeletePointDialogOpen(false);
    resetPointForm();
  };

  const handleDuplicatePoint = () => {
    if (selectedPointIndex === null) return;

    const point = measurementPoints[selectedPointIndex];
    const newPoint: MeasurementPoint = {
      ...point,
      id: undefined,
      code: `${point.code}-copy`,
      name: `${point.name} (copy)`,
      positionX: point.positionX + 30,
      positionY: point.positionY + 30,
      geometry: point.geometry
        ? ({
            ...point.geometry,
            ...(point.geometry.shape === "circle" ? { x: point.positionX + 30, y: point.positionY + 30 } : {}),
          } as CanvasGeometry)
        : point.geometry,
      orderIndex: measurementPoints.length,
    };
    setMeasurementPoints([...measurementPoints, newPoint]);
    toast.success(t("products.pointDuplicated"));
  };

  // Template handlers
  const handleSaveAsTemplate = async () => {
    if (!templateName.trim()) {
      toast.error(t("validation.pleaseEnterTemplateName"));
      return;
    }
    if (measurementPoints.length === 0) {
      toast.error(t("validation.noPointsToSave"));
      return;
    }

    setIsSavingTemplate(true);
    const pointsData = measurementPoints.map(p => ({
      code: p.code,
      name: p.name,
      description: p.description,
      measurementType: p.measurementType,
      unit: p.unit,
      lowerLimit: p.lowerLimit,
      upperLimit: p.upperLimit,
      nominalValue: p.nominalValue,
      positionX: p.positionX,
      positionY: p.positionY,
      radius: p.radius,
      shape: p.shape,
      geometry: p.geometry,
      orderIndex: p.orderIndex,
      cropWidth: p.cropWidth,
      cropHeight: p.cropHeight,
    }));

    createTemplateMutation.mutate({
      code: `TPL-${Date.now()}`,
      name: templateName,
      description: templateDescription,
      category: templateCategory || "general",
      points: pointsData,
    });
  };

  const handleApplyTemplate = (template: { id: number; name: string; points?: unknown }) => {
    try {
      const pointsData = (Array.isArray(template.points) 
        ? template.points 
        : []) as MeasurementPoint[];
      const newPoints = pointsData.map((p, idx) => ({
        ...p,
        id: undefined,
        orderIndex: measurementPoints.length + idx,
      }));
      setMeasurementPoints([...measurementPoints, ...newPoints]);
      toast.success(t("products.templateApplied", { name: template.name, count: newPoints.length }));
    } catch {
      toast.error(t("products.templateApplyError"));
    }
  };

  // Batch selection handlers
  const togglePointSelection = (pointId: number) => {
    const newSelected = new Set(selectedPointIds);
    if (newSelected.has(pointId)) {
      newSelected.delete(pointId);
    } else {
      newSelected.add(pointId);
    }
    setSelectedPointIds(newSelected);
  };

  const selectAllPoints = () => {
    const allIds = new Set(measurementPoints.filter(p => p.id).map(p => p.id!));
    setSelectedPointIds(allIds);
  };

  const deselectAllPoints = () => {
    setSelectedPointIds(new Set());
  };

  const handleBatchDelete = () => {
    if (selectedPointIds.size === 0) {
      toast.error(t("validation.pleaseSelectAtLeastOnePoint"));
      return;
    }
    const newPoints = measurementPoints.filter(p => !p.id || !selectedPointIds.has(p.id));
    setMeasurementPoints(newPoints);
    setSelectedPointIds(new Set());
    toast.success(t("products.batchDeleted", { count: selectedPointIds.size }));
  };

  const handleBatchExport = () => {
    if (selectedPointIds.size === 0) {
      toast.error(t("validation.pleaseSelectAtLeastOnePoint"));
      return;
    }
    const selectedPoints = measurementPoints.filter(p => p.id && selectedPointIds.has(p.id));
    const csv = [
      [t("products.csvCode"), t("products.csvName"), t("products.csvType"), t("products.csvUnit"), t("products.csvLowerLimit"), t("products.csvUpperLimit"), t("products.csvNominalValue")].join(","),
      ...selectedPoints.map(p => `${p.code},${p.name},${p.measurementType},${p.unit || ''},${p.lowerLimit || ''},${p.upperLimit || ''},${p.nominalValue || ''}`)
    ].join("\n");
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `measurement_points_${Date.now()}.csv`;
    a.click();
    toast.success(t("products.batchExported", { count: selectedPoints.length }));
  };

  // Validation function
  const validatePoint = (point: MeasurementPoint): Record<string, string> => {
    const errors: Record<string, string> = {};
    
    // Required fields
    if (!point.code.trim()) {
      errors.code = t("validation.pointCodeRequired");
    }
    if (!point.name.trim()) {
      errors.name = t("validation.pointNameRequired");
    }
    
    // Duplicate code check
    const duplicateCode = measurementPoints.find(
      (p, idx) => p.code === point.code && idx !== selectedPointIndex
    );
    if (duplicateCode) {
      errors.code = t("validation.pointCodeDuplicate");
    }
    
    // Limit validation
    if (point.lowerLimit && point.upperLimit) {
      const lower = parseFloat(point.lowerLimit);
      const upper = parseFloat(point.upperLimit);
      if (!isNaN(lower) && !isNaN(upper) && lower >= upper) {
        errors.limits = t("validation.lowerLimitLessThanUpper");
      }
    }
    
    return errors;
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setUploadedImageUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handlePointImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || selectedPointIndex === null) return;

    const point = measurementPoints[selectedPointIndex];
    if (!point.id) {
      toast.error(t("products.savePointBeforeUpload"));
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      const base64 = dataUrl.split(',')[1];
      
      try {
        await uploadCroppedImageMutation.mutateAsync({
          pointId: point.id!,
          imageBase64: base64,
          mimeType: file.type as 'image/png' | 'image/jpeg',
        });
      } catch (error) {
        // Error handled by mutation
      }
    };
    reader.readAsDataURL(file);
  };

  const handleEditImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setEditProductImageUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <>
      <DashboardLayout title={t("products.managementTitle")} navItems={navItems} currentPath="/products">
      <ErrorBoundary>
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Product List — thu gọn còn 1/4 (danh sách sản phẩm ít cần rộng) */}
        <Card className="lg:col-span-1">
          {/* doc 46 B3 — flex-wrap + min-w-0 so the action buttons wrap below the
              title instead of overflowing this narrow (lg:col-span-1) column at
              ≤1600px; previously the "Add" CTA spilled past the card edge and was
              painted over by the adjacent col-span-3 detail card (unclickable). */}
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">{t("products.productList")}</CardTitle>
                <ViewOnlyBadge module="settings_products" />
              </div>
              <CardDescription>{t("products.selectToManage")}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            {/* Doc 31 UX1 (WD-1) — start the guided product setup wizard (the route
                is itself permission-guarded, so no extra write-action gate here). */}
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setLocation("/product-onboarding")}
            >
              <Sparkles className="h-4 w-4" />
              {t("products.startGuidedSetup", "Guided setup")}
            </Button>
            <CreateProductDialog
              createProductMutation={createProductMutation} handleCreateProduct={handleCreateProduct} handleImageUpload={handleImageUpload}
              isCreateDialogOpen={isCreateDialogOpen} newProductCategory={newProductCategory} newProductCode={newProductCode}
              newProductDescription={newProductDescription} newProductDisplayMode={newProductDisplayMode} newProductLifecycle={newProductLifecycle}
              newProductLine={newProductLine} newProductMinYield={newProductMinYield} newProductName={newProductName}
              newProductRevision={newProductRevision} newProductTargetYield={newProductTargetYield} newProductVariant={newProductVariant}
              productValidation={productValidation} setIsCreateDialogOpen={setIsCreateDialogOpen} setNewProductCategory={setNewProductCategory}
              setNewProductCode={setNewProductCode} setNewProductDescription={setNewProductDescription} setNewProductDisplayMode={setNewProductDisplayMode}
              setNewProductLifecycle={setNewProductLifecycle} setNewProductLine={setNewProductLine} setNewProductMinYield={setNewProductMinYield}
              setNewProductName={setNewProductName} setNewProductRevision={setNewProductRevision} setNewProductTargetYield={setNewProductTargetYield}
              setNewProductVariant={setNewProductVariant} uploadedImageUrl={uploadedImageUrl}
            />
            </div>
          </CardHeader>
          <CardContent>
            {/* Search and Filter Controls */}
            <div className="space-y-3 mb-4">
              {/* Search Bar */}
              <div className="relative">
                <Input
                  placeholder={t("products.searchByCodeOrName")}
                  value={productSearchQuery}
                  onChange={(e) => setProductSearchQuery(e.target.value)}
                  className="pr-8"
                />
                {productSearchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                    onClick={() => setProductSearchQuery("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              
              {/* Filter and Sort Row */}
              <div className="flex gap-2">
                {/* Lifecycle Filter */}
                <Select value={productLifecycleFilter} onValueChange={(val: any) => setProductLifecycleFilter(val)}>
                  <SelectTrigger className="w-35">
                    <SelectValue placeholder={t("common.status")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.all")}</SelectItem>
                    <SelectItem value="development">{t("products.development")}</SelectItem>
                    <SelectItem value="active">{t("products.active")}</SelectItem>
                    <SelectItem value="eol">EOL</SelectItem>
                    <SelectItem value="archived">{t("products.archived")}</SelectItem>
                  </SelectContent>
                </Select>
                
                {/* Sort Dropdown */}
                <Select value={`${productSortBy}-${productSortOrder}`} onValueChange={(val) => {
                  const [sortBy, sortOrder] = val.split("-") as [typeof productSortBy, typeof productSortOrder];
                  setProductSortBy(sortBy);
                  setProductSortOrder(sortOrder);
                }}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("products.sortPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="createdAt-desc">{t("products.newestFirst")}</SelectItem>
                    <SelectItem value="createdAt-asc">{t("products.oldestFirst")}</SelectItem>
                    <SelectItem value="name-asc">{t("products.nameAZ")}</SelectItem>
                    <SelectItem value="name-desc">{t("products.nameZA")}</SelectItem>
                    <SelectItem value="code-asc">{t("products.codeAZ")}</SelectItem>
                    <SelectItem value="code-desc">{t("products.codeZA")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Active Filters Badge */}
              {(productSearchQuery || productLifecycleFilter !== "all") && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary" className="gap-1">
                    {t("common.filtered")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      setProductSearchQuery("");
                      setProductLifecycleFilter("all");
                    }}
                  >
                    {t("history.clearFilters")}
                  </Button>
                </div>
              )}
            </div>

            {/* Doc 42 Đợt 4A (APPLY-B) — nhập/xuất danh sách sản phẩm. Xuất/Tải mẫu cho
                mọi người; "Nhập" chỉ hiện khi có quyền tạo (onImport = undefined nếu không). */}
            <div className="mb-4">
              <ImportExportBar
                entityLabel={t("products.entityLabel", "sản phẩm")}
                fileBaseName="san_pham"
                columns={[...PRODUCT_COLUMN_SPEC]}
                onExport={handleExportProducts}
                onImport={canImportProducts ? handleImportProducts : undefined}
              />
            </div>

            {/* Doc 42 Đợt 2 (D2) — danh sách sản phẩm dùng DataTable: skeleton khi tải,
                phân trang, empty-state có CTA. Search/lọc/sắp xếp vẫn do controls phía
                trên điều khiển server-side (query productModel.list). */}
            <DataTable<ProductModel>
              data={(productModels ?? []) as unknown as ProductModel[]}
              getRowId={(p) => p.id}
              loading={productModels === undefined}
              paginated
              pageSize={8}
              onRowClick={(product) => {
                setSelectedProduct(product);
                setIsEditMode(false);
                resetPointForm();
                // Doc 43 Đợt 3 — ghi ?product= (giữ tab hiện tại) để reload giữ nguyên
                // sản phẩm + tab. Preselect chỉ auto-chọn 1 lần nên không gây vòng lặp.
                const params = new URLSearchParams(onboardingSearch);
                params.set("product", String(product.id));
                setLocation(`/products?${params.toString()}`, { replace: true });
              }}
              emptyState={
                productSearchQuery || productLifecycleFilter !== "all" ? (
                  <EmptyState
                    variant="no-results"
                    compact
                    title={t("products.noMatchingProducts", "Không có sản phẩm khớp")}
                    description={t("products.tryDifferentSearch", "Thử đổi từ khoá hoặc bộ lọc.")}
                  />
                ) : (
                  <EmptyState
                    variant="no-data"
                    compact
                    title={t("products.noProductsYet")}
                    description={t("products.clickAddToCreate")}
                    actionLabel={t("common.add")}
                    onAction={() => setIsCreateDialogOpen(true)}
                  />
                )
              }
              columns={[
                {
                  id: "product",
                  header: t("products.product", "Sản phẩm"),
                  cell: (product) => {
                    const isSelected = selectedProduct?.id === product.id;
                    const updatedAt = (product as { updatedAt?: string | Date | null }).updatedAt;
                    return (
                      <div
                        className={`flex items-start gap-3 -mx-1 rounded-md px-2 py-1 ${
                          isSelected ? "bg-primary/5" : ""
                        }`}
                      >
                        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                          <Package className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{product.name}</p>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm text-muted-foreground truncate">{product.code}</p>
                            {product.revision && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                                {t("products.revShort")} {product.revision}
                              </Badge>
                            )}
                          </div>
                          {/* Doc 31 UX2/PM9 — config-completeness badge (batched, no N+1) */}
                          <div className="mt-1">
                            <ProductReadinessBadge readiness={readinessById.get(product.id)} />
                          </div>
                          {updatedAt && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {t("common.updated", "Cập nhật")}: {new Date(updatedAt).toLocaleDateString("vi-VN")}
                            </p>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              setSelectedProduct(product);
                              openEditProductDialog(product as unknown as ProductModel);
                            }}>
                              <Edit className="h-4 w-4 mr-2" />
                              {t("common.edit")}
                            </DropdownMenuItem>
                            <PermissionGate module="settings_products" action="canCreate">
                              <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                openCloneProductDialog(product as unknown as ProductModel);
                              }}>
                                <Copy className="h-4 w-4 mr-2" />
                                {t("products.clone")}
                              </DropdownMenuItem>
                            </PermissionGate>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedProduct(product);
                                setIsDeleteProductDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  },
                },
              ]}
            />
          </CardContent>
        </Card>

        {/* Measurement Point Editor — mở rộng 3/4 để phần điểm đo to hơn */}
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg">
                {selectedProduct ? `${t("products.measurementPointsFor")} - ${selectedProduct.name}` : t("products.selectProduct")}
              </CardTitle>
              <CardDescription>
                {selectedProduct
                  ? t("products.pointsDefined", { count: measurementPoints.length })
                  : t("products.noProductSelectedDesc")}
              </CardDescription>
            </div>
            {selectedProduct && (
              <div className="flex items-center gap-2">
                {isEditMode ? (
                  <>
                    <Select value={activeDrawTool} onValueChange={(value) => setActiveDrawTool(value as CanvasPointShape)}>
                      <SelectTrigger className="w-36 h-8">
                        <SelectValue placeholder="Tool" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="circle">Circle</SelectItem>
                        <SelectItem value="rect">Rectangle</SelectItem>
                        <SelectItem value="polygon">Polygon</SelectItem>
                        <SelectItem value="line">Line</SelectItem>
                        <SelectItem value="ring">Ring</SelectItem>
                        <SelectItem value="mask">Mask</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant={isDrawing ? "default" : "outline"}
                      onClick={() => setIsDrawing(!isDrawing)}
                      className="gap-1"
                    >
                      <Circle className="h-4 w-4" />
                      {isDrawing ? t("products.drawing") : t("products.addPointBtn")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsEditMode(false);
                        setIsDrawing(false);
                        resetPointForm();
                      }}
                    >
                      <X className="h-4 w-4 mr-1" />
                      {t("common.close")}
                    </Button>
                  </>
                ) : (
                  /* Doc 43 Đợt 1 — gom toolbar: 10 nút flat → Nhập ▾ + ⋯ Nâng cao + ✎ Sửa.
                     KHÔNG đổi handler/state — chỉ dời vị trí (flat button → menu item). */
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Nhập điểm đo (dropdown nhỏ: Excel/CSV + centroid) */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1">
                          <FileSpreadsheet className="h-4 w-4" />
                          {t('products.importPointsBtn', 'Nhập điểm đo')}
                          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => setIsBulkImportDialogOpen(true)} className="gap-2">
                          <FileSpreadsheet className="h-4 w-4" />
                          {t('products.importExcelCsv', 'Nhập Excel/CSV')}
                        </DropdownMenuItem>
                        {/* Doc 31 MP5/PM4 (Đợt C) — centroid / pick-place import (author 200 pts fast) */}
                        <DropdownMenuItem onClick={() => setIsCentroidImportOpen(true)} className="gap-2">
                          <Package className="h-4 w-4" />
                          {t('products.centroidImport.button', 'Import centroid')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {/* ⋯ Nâng cao — gom 8 action ít dùng theo nhóm (giữ nguyên onClick/handler) */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1">
                          <MoreHorizontal className="h-4 w-4" />
                          {t('products.advancedMenu', 'Nâng cao')}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        {/* Chương trình */}
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {t('products.advGroupProgram', 'Chương trình')}
                        </DropdownMenuLabel>
                        {/* W3-C (doc 27 §2 M9) — program release workflow (Phát hành chương trình) */}
                        <DropdownMenuItem onClick={() => setIsProgramReleaseOpen(true)} className="gap-2">
                          <Rocket className="h-4 w-4" />
                          {t("programRelease.button")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsTemplateDialogOpen(true)} className="gap-2">
                          <Layers className="h-4 w-4" />
                          {t('products.templates')}
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        {/* Bố cục & tham chiếu */}
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {t('products.advGroupLayout', 'Bố cục & tham chiếu')}
                        </DropdownMenuLabel>
                        {/* W8-B (doc 29 §2 — M12b) — panel N-up definition editor */}
                        <DropdownMenuItem onClick={() => setIsPanelDefOpen(true)} className="gap-2">
                          <Grid3X3 className="h-4 w-4" />
                          {t("panelDef.button")}
                        </DropdownMenuItem>
                        {/* Doc 31 UX1 (WD-1) — fiducial marks (mounts the previously-orphaned tab) */}
                        <DropdownMenuItem onClick={() => setIsFiducialsOpen(true)} className="gap-2">
                          <Crosshair className="h-4 w-4" />
                          {t("products.fiducialsButton", "Fiducials")}
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        {/* Chất lượng */}
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {t('products.advGroupQuality', 'Chất lượng')}
                        </DropdownMenuLabel>
                        <DropdownMenuItem onClick={openMsaWizard} className="gap-2">
                          <Target className="h-4 w-4" />
                          MSA Wizard
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        {/* Trao đổi dữ liệu — Doc 31 PM3: xuất/nhập gói sản phẩm (JSON) */}
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {t('products.advGroupExchange', 'Trao đổi dữ liệu')}
                        </DropdownMenuLabel>
                        <div className="flex flex-wrap gap-1 px-1 py-1">
                          <ProductPackageButtons
                            selectedProduct={selectedProduct}
                            onImported={() => refetchProducts()}
                          />
                        </div>

                        <DropdownMenuSeparator />
                        {/* Hàng loạt */}
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {t('products.advGroupBatch', 'Hàng loạt')}
                        </DropdownMenuLabel>
                        <DropdownMenuItem
                          onClick={() => {
                            setIsBatchMode(!isBatchMode);
                            if (isBatchMode) setSelectedPointIds(new Set());
                          }}
                          className="gap-2"
                        >
                          {isBatchMode ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                          {isBatchMode ? t("products.exitMode") : t("products.selectMode")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Sửa (primary) — giữ PermissionGate settings_products.canEdit */}
                    <PermissionGate module="settings_products" action="canEdit">
                      <Button size="sm" onClick={() => setIsEditMode(true)} className="gap-1">
                        <Edit className="h-4 w-4" />
                        {t("common.edit")}
                      </Button>
                    </PermissionGate>
                  </div>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {selectedProduct ? (
              <Tabs value={activeDetailTab} onValueChange={handleDetailTabChange} className="space-y-4">
                {/* Doc 43 Đợt 3 — tab-hoá cột chi tiết: Điểm đo / Thông tin SP / Phát hành / Nền tảng.
                    ?tab= đồng bộ URL (deep-link, reload giữ tab). Toolbar Nhập/Nâng cao/Sửa vẫn ở header card. */}
                <TabsList className="flex h-9 flex-wrap">
                  <TabsTrigger value="points" className="h-7 gap-1.5 text-xs">
                    <Target className="h-4 w-4" />
                    {t("products.tabPoints", "Điểm đo")}
                  </TabsTrigger>
                  <TabsTrigger value="info" className="h-7 gap-1.5 text-xs">
                    <Package className="h-4 w-4" />
                    {t("products.tabInfo", "Thông tin sản phẩm")}
                  </TabsTrigger>
                  <TabsTrigger value="release" className="h-7 gap-1.5 text-xs">
                    <Rocket className="h-4 w-4" />
                    {t("products.tabRelease", "Phát hành & Chương trình")}
                  </TabsTrigger>
                  <TabsTrigger value="foundation" className="h-7 gap-1.5 text-xs">
                    <Layers className="h-4 w-4" />
                    {t("products.tabFoundation", "Nền tảng")}
                  </TabsTrigger>
                  {/* doc 55 Item 3 / PV3-UI — Biến thể (product variants) */}
                  <TabsTrigger value="variants" className="h-7 gap-1.5 text-xs">
                    <Layers className="h-4 w-4" />
                    {t("products.variants.tab", "Biến thể")}
                  </TabsTrigger>
                  {/* Khối C Task 10 (QĐ-4) — Cây dạy (đọc bản dạy giới hạn của máy) */}
                  <TabsTrigger value="teach" className="h-7 gap-1.5 text-xs">
                    <TreePine className="h-4 w-4" />
                    {t("teachTree.tab", "Cây dạy")}
                  </TabsTrigger>
                </TabsList>

                {/* ① Điểm đo — canvas + point list + form (màn làm việc chính) */}
                <TabsContent value="points" className="space-y-4 mt-2">
                {/* Batch Actions Bar */}
                {isBatchMode && (
                  <div className="flex items-center gap-2 p-2 bg-accent/50 rounded-lg">
                    <span className="text-sm font-medium">
                      {t("products.selectedPoints", { count: selectedPointIds.size })}
                    </span>
                    <div className="flex gap-2 ml-auto">
                      <Button size="sm" variant="outline" onClick={selectAllPoints} className="gap-1">
                        <CheckSquare className="h-3 w-3" />
                        {t("common.selectAll")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={deselectAllPoints} className="gap-1">
                        <Square className="h-3 w-3" />
                        {t("common.deselectAll")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleBatchExport}
                        disabled={selectedPointIds.size === 0}
                        className="gap-1"
                      >
                        <Download className="h-3 w-3" />
                        {t("history.exportCsv")}
                      </Button>
                      {/* Wave 2 đường A (Task 3) — ĐỀ XUẤT hàng loạt (xem trước, không duyệt
                          hàng loạt — duyệt hàng loạt đã có riêng ở /threshold-approvals). */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsBatchSuggestOpen(true)}
                        disabled={selectedPointIds.size === 0}
                        className="gap-1"
                      >
                        <Sparkles className="h-3 w-3" />
                        {t("productModels.batchSuggestButton", "AI đề xuất cho {{n}} điểm", { n: selectedPointIds.size })}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={handleBatchDelete}
                        disabled={selectedPointIds.size === 0}
                        className="gap-1"
                      >
                        <Trash2 className="h-3 w-3" />{t("common.delete")}</Button>
                    </div>
                  </div>
                )}

                {/* Bộ lọc theo loại — Doc 43 Đợt 5: ô tìm text đã chuyển vào DataTable
                    điểm đo (searchable, ngay trên bảng); giữ lọc-theo-loại làm bộ lọc thô. */}
                <div className="flex gap-2 items-end">
                  <div className="w-48">
                    <Label htmlFor="typeFilter" className="text-xs">{t('common.type')}</Label>
                    <Select value={pointTypeFilter} onValueChange={(val) => setPointTypeFilter(val as any)}>
                      <SelectTrigger id="typeFilter" className="h-8">
                        <SelectValue placeholder={t('common.all')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all')}</SelectItem>
                        <SelectItem value="DIMENSION">{t('products.typeDimension')}</SelectItem>
                        {/* Doc 43 §5 — 'products.typeVisual' trong locale dịch sai ("Loại
                            hiển thị"); dùng key mới + defaultValue "Trực quan" (i18next bỏ
                            qua defaultValue nếu key cũ tồn tại). Sửa locale = pass i18n sau. */}
                        <SelectItem value="VISUAL">{t('products.typeVisualLabel', 'Trực quan')}</SelectItem>
                        <SelectItem value="ELECTRICAL">{t('products.typeElectrical')}</SelectItem>
                        <SelectItem value="POSITION">{t('products.typePosition')}</SelectItem>
                        <SelectItem value="COLOR">{t('products.typeColor')}</SelectItem>
                        <SelectItem value="SURFACE">{t('products.typeSurface')}</SelectItem>
                        <SelectItem value="OTHER">{t('products.typeOther')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <span className="text-xs text-muted-foreground">({filteredMeasurementPoints.length})</span>
                </div>

                {/* Canvas + form điểm đo (2/3 canvas · 1/3 form) — readiness/golden dời sang tab Thông tin SP */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  {/* Canvas Area — chiếm 2/3 chiều rộng detail (ảnh điểm đo to hơn) */}
                  <div className="xl:col-span-2">
                  {/* Zoom Controls */}
                  <div className="flex items-center gap-4 mb-3 p-2 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <ZoomOut className="h-4 w-4 text-muted-foreground" />
                      <Slider
                        value={[zoomLevel]}
                        onValueChange={([value]) => setZoomLevel(value)}
                        min={50}
                        max={200}
                        step={10}
                        className="w-32"
                      />
                      <ZoomIn className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground w-12">{zoomLevel}%</span>
                    </div>
                    {isEditMode && (
                      <div className="flex items-center gap-2 ml-4">
                        <span className="text-sm text-muted-foreground">{t("products.radius")}:</span>
                        <Slider
                          value={[pointRadius]}
                          onValueChange={([value]) => setPointRadius(value)}
                          min={10}
                          max={50}
                          step={5}
                          className="w-24"
                        />
                        <span className="text-sm text-muted-foreground w-8">{pointRadius}px</span>
                      </div>
                    )}
                  </div>

                  <div className="relative border rounded-lg overflow-auto bg-muted/30 max-h-[78vh]">
                    {selectedProduct.referenceImageUrl ? (
                      <MeasurementPointCanvas
                        imageUrl={selectedProduct.referenceImageUrl}
                        points={measurementPoints}
                        selectedIndex={selectedPointIndex}
                        onSelectIndex={(index) => {
                          setSelectedPointIndex(index);
                          if (index === null) return;
                          const selectedPoint = measurementPoints[index];
                          if (selectedPoint) {
                            populatePointForm(selectedPoint);
                          }
                        }}
                        onChangePoints={(nextPoints) => {
                          const normalizedPoints = nextPoints.map((p, index) => {
                            const previous = measurementPoints[index];
                            return {
                              ...(previous || {}),
                              ...p,
                              name: (previous?.name || p.code || `Point ${index + 1}`),
                              measurementType: previous?.measurementType || "VISUAL",
                              cropWidth: previous?.cropWidth || 100,
                              cropHeight: previous?.cropHeight || 100,
                              orderIndex: index,
                            } as MeasurementPoint;
                          });
                          setMeasurementPoints(normalizedPoints);
                          if (selectedPointIndex !== null && normalizedPoints[selectedPointIndex]) {
                            setPointRadius(normalizedPoints[selectedPointIndex].radius);
                          }
                          setIsDragging(false);
                        }}
                        isEditMode={isEditMode}
                        isDrawing={isDrawing}
                        drawTool={activeDrawTool}
                        pointRadius={pointRadius}
                        zoomLevel={zoomLevel}
                        onDrawingStateChange={setIsDrawing}
                        className="w-full"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-64 text-muted-foreground">
                        <div className="text-center">
                          <Upload className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p>{t("products.noReferenceImage")}</p>
                          <p className="text-sm">{t("products.updateImageInEdit")}</p>
                          {/* Doc 43 Đợt 4 (B) — nút mở dialog sửa + tải ảnh (tái dùng luồng
                              upload ảnh sản phẩm) thay cho dòng chữ chết; không có ảnh thì
                              không đặt được điểm đo. */}
                          <PermissionGate module="settings_products" action="canEdit">
                            <Button
                              size="sm"
                              className="gap-1 mt-3"
                              onClick={() => openEditProductDialog(selectedProduct)}
                            >
                              <Upload className="h-4 w-4" />
                              {t("products.uploadReferenceImage", "Tải ảnh tham chiếu")}
                            </Button>
                          </PermissionGate>
                        </div>
                      </div>
                    )}
                    {isDrawing && (
                      <div className="absolute top-2 left-2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm">
                        {t("products.clickToPlace")}
                      </div>
                    )}
                    {isDragging && (
                      <div className="absolute top-2 left-2 bg-warning text-warning-foreground px-3 py-1 rounded-full text-sm">
                        <Move className="h-4 w-4 inline mr-1" />
                        {t("products.movingPoint")}
                      </div>
                    )}
                  </div>

                  {/* Point List — Doc 43 Đợt 5: chip badge → DataTable (cột STT/mã/tên/
                      loại/vị trí/ngưỡng + tìm + sort + phân trang) để board nhiều điểm
                      (centroid tới ~200) dùng được. Đồng bộ 2 chiều canvas ↔ bảng:
                      • click hàng → chọn điểm + populate form (canvas tự highlight qua
                        selectedPointIndex);
                      • chọn điểm trên canvas → selectedPointIndex đổi → hàng active
                        (selectedIds/data-state="selected") + cuộn vào tầm nhìn.
                      Batch/Select Mode → cột checkbox (selectable) ↔ selectedPointIds.
                      QUYẾT ĐỊNH: LUÔN dùng DataTable (bỏ chip) — bảng tự gọn khi ít hàng
                      và có sẵn tìm/sort/phân trang; đơn giản hơn toggle chip↔bảng. */}
                  <div className="mt-4" ref={pointTableRef}>
                    <h4 className="text-sm font-medium mb-2">{t("products.pointList")} ({measurementPoints.length}/50)</h4>
                    {measurementPoints.length === 0 ? (
                      <NoMeasurementPoints onAdd={() => setIsDrawing(true)} />
                    ) : (
                      <DataTable<MeasurementPoint>
                        data={filteredMeasurementPoints}
                        getRowId={pointRowId}
                        searchable
                        searchPlaceholder={t("products.searchPointPlaceholder")}
                        pageSize={25}
                        initialSort={{ columnId: "stt", dir: "asc" }}
                        selectable={isBatchMode}
                        selectedIds={pointTableSelectedIds}
                        onSelectionChange={
                          isBatchMode
                            ? (ids) =>
                                setSelectedPointIds(
                                  new Set(
                                    ids.filter((v): v is number => typeof v === "number")
                                  )
                                )
                            : undefined
                        }
                        onRowClick={(point) => {
                          const idx = measurementPoints.indexOf(point);
                          if (idx < 0) return;
                          setSelectedPointIndex(idx);
                          populatePointForm(point);
                        }}
                        emptyState={
                          <EmptyState
                            variant="no-results"
                            compact
                            title={t("products.noMatchingPoints", "Không có điểm khớp")}
                            description={t("products.tryDifferentSearch", "Thử đổi từ khoá hoặc bộ lọc.")}
                          />
                        }
                        columns={[
                          {
                            id: "stt",
                            header: t("products.pointNo", "STT"),
                            width: "56px",
                            align: "right",
                            sortValue: (p) => (pointIndexMap.get(p) ?? 0) + 1,
                            cell: (p) => {
                              const isActive = pointIndexMap.get(p) === selectedPointIndex;
                              return (
                                <span
                                  className={`tabular-nums ${isActive ? "font-semibold text-primary" : "text-muted-foreground"}`}
                                >
                                  {(pointIndexMap.get(p) ?? 0) + 1}
                                </span>
                              );
                            },
                          },
                          {
                            id: "code",
                            header: t("products.pointCodeLabel"),
                            sortValue: (p) => p.code,
                            filterValue: (p) => p.code,
                            cell: (p) => {
                              const isActive = pointIndexMap.get(p) === selectedPointIndex;
                              return (
                                <span
                                  className={`inline-flex items-center gap-1.5 ${isActive ? "font-semibold text-primary" : ""}`}
                                >
                                  <Target className={`h-3 w-3 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                                  {p.code}
                                </span>
                              );
                            },
                          },
                          {
                            id: "name",
                            header: t("products.pointNameLabel", "Tên"),
                            sortValue: (p) => p.name,
                            filterValue: (p) => p.name,
                            cell: (p) => (
                              <span className="truncate">{p.name}</span>
                            ),
                          },
                          {
                            id: "type",
                            header: t("common.type"),
                            width: "120px",
                            sortValue: (p) => pointTypeLabel(p.measurementType),
                            filterValue: (p) => `${pointTypeLabel(p.measurementType)} ${p.measurementType}`,
                            cell: (p) => (
                              <Badge variant="outline" className="font-normal">
                                {pointTypeLabel(p.measurementType)}
                              </Badge>
                            ),
                          },
                          {
                            id: "position",
                            header: t("products.position"),
                            width: "110px",
                            align: "right",
                            sortValue: (p) => p.positionX,
                            cell: (p) => (
                              <span className="tabular-nums text-muted-foreground text-xs">
                                ({p.positionX}, {p.positionY})
                              </span>
                            ),
                          },
                          {
                            id: "threshold",
                            header: t("products.thresholdSummary", "Ngưỡng"),
                            cell: (p) => {
                              // Wave 2 đường A — badge chỉ báo có đề xuất ngưỡng AI đang chờ
                              // tại điểm đo này (150 đề xuất trước đây vô hình vì chỉ hiện ở
                              // /threshold-approvals). Chỉ là chỉ báo — click hàng (đã có
                              // onRowClick ở trên) mở form chi tiết điểm đó.
                              const pendingCount = p.id != null ? (pendingThresholdCounts?.byPoint?.[p.id] ?? 0) : 0;
                              return (
                                <div className="flex items-center gap-1.5">
                                  <span className="tabular-nums text-xs text-muted-foreground">
                                    {thresholdSummaryOf(p)}
                                  </span>
                                  {pendingCount > 0 && (
                                    <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0 shrink-0">
                                      <Sparkles className="h-3 w-3" />
                                      {t("products.pendingSuggestions", "{{n}} đề xuất AI", { n: pendingCount })}
                                    </Badge>
                                  )}
                                </div>
                              );
                            },
                          },
                        ]}
                      />
                    )}
                  </div>
                </div>

                {/* Point Details Form */}
                <PointDetailsForm
                  confirmDeletePoint={confirmDeletePoint} handleDuplicatePoint={handleDuplicatePoint} handlePointImageUpload={handlePointImageUpload}
                  handleSavePoint={handleSavePoint} imageSourceMode={imageSourceMode} isEditMode={isEditMode}
                  isSavingPoint={isSavingPoint} measurementInstruments={measurementInstruments} measurementPoints={measurementPoints}
                  measurementTypeCatalog={measurementTypeCatalog} pointAreaMax={pointAreaMax} pointAreaMin={pointAreaMin}
                  pointAreaNominal={pointAreaNominal} pointAreaUnit={pointAreaUnit} pointCode={pointCode}
                  pointComponentCode={pointComponentCode} pointCoplanarityMax={pointCoplanarityMax} pointCriteria={pointCriteria}
                  pointCropHeight={pointCropHeight} pointCropWidth={pointCropWidth} pointDatumRefsInput={pointDatumRefsInput}
                  pointDescription={pointDescription} pointFitClass={pointFitClass} pointHeightMax={pointHeightMax}
                  pointHeightMin={pointHeightMin} pointHeightNominal={pointHeightNominal} pointHeightUnit={pointHeightUnit}
                  pointLowerLimit={pointLowerLimit} pointMaterialCondition={pointMaterialCondition} pointMeasurementTypeCode={pointMeasurementTypeCode}
                  pointName={pointName} pointNominalValue={pointNominalValue} pointOffsetXMax={pointOffsetXMax}
                  pointOffsetYMax={pointOffsetYMax} pointPositionZ={pointPositionZ} pointPreferredInstrumentId={pointPreferredInstrumentId}
                  pointPreferredSamplingPlanId={pointPreferredSamplingPlanId} pointProductViewId={pointProductViewId} pointRefDesignator={pointRefDesignator}
                  pointReferenceImageUrl={pointReferenceImageUrl} pointThicknessMax={pointThicknessMax} pointThicknessMin={pointThicknessMin}
                  pointTiltMax={pointTiltMax} pointTolMinus={pointTolMinus} pointTolPlus={pointTolPlus}
                  pointToleranceMode={pointToleranceMode} pointType={pointType} pointUnit={pointUnit}
                  pointUpperLimit={pointUpperLimit} pointValidation={pointValidation} pointVoidPctMax={pointVoidPctMax}
                  pointVolumeMax={pointVolumeMax} pointVolumeMin={pointVolumeMin} pointVolumeNominal={pointVolumeNominal}
                  pointVolumeUnit={pointVolumeUnit} pointWarpageMax={pointWarpageMax} pointWorkstationId={pointWorkstationId}
                  productViews={productViews} refetchPoints={refetchPoints} samplingPlans={samplingPlans}
                  saveWillRequireApproval={saveWillRequireApproval} selectedPointIndex={selectedPointIndex} setImageSourceMode={setImageSourceMode}
                  setPointAreaMax={setPointAreaMax} setPointAreaMin={setPointAreaMin} setPointAreaNominal={setPointAreaNominal}
                  setPointAreaUnit={setPointAreaUnit} setPointCode={setPointCode} setPointComponentCode={setPointComponentCode}
                  setPointCoplanarityMax={setPointCoplanarityMax} setPointCriteria={setPointCriteria} setPointCropHeight={setPointCropHeight}
                  setPointCropWidth={setPointCropWidth} setPointDatumRefsInput={setPointDatumRefsInput} setPointDescription={setPointDescription}
                  setPointFitClass={setPointFitClass} setPointHeightMax={setPointHeightMax} setPointHeightMin={setPointHeightMin}
                  setPointHeightNominal={setPointHeightNominal} setPointHeightUnit={setPointHeightUnit} setPointLowerLimit={setPointLowerLimit}
                  setPointMaterialCondition={setPointMaterialCondition} setPointMeasurementTypeCode={setPointMeasurementTypeCode} setPointName={setPointName}
                  setPointNominalValue={setPointNominalValue} setPointOffsetXMax={setPointOffsetXMax} setPointOffsetYMax={setPointOffsetYMax}
                  setPointPositionZ={setPointPositionZ} setPointPreferredInstrumentId={setPointPreferredInstrumentId} setPointPreferredSamplingPlanId={setPointPreferredSamplingPlanId}
                  setPointProductViewId={setPointProductViewId} setPointRefDesignator={setPointRefDesignator} setPointReferenceImageUrl={setPointReferenceImageUrl}
                  setPointThicknessMax={setPointThicknessMax} setPointThicknessMin={setPointThicknessMin} setPointTiltMax={setPointTiltMax}
                  setPointTolMinus={setPointTolMinus} setPointTolPlus={setPointTolPlus} setPointToleranceMode={setPointToleranceMode}
                  setPointType={setPointType} setPointUnit={setPointUnit} setPointUpperLimit={setPointUpperLimit}
                  setPointVoidPctMax={setPointVoidPctMax} setPointVolumeMax={setPointVolumeMax} setPointVolumeMin={setPointVolumeMin}
                  setPointVolumeNominal={setPointVolumeNominal} setPointVolumeUnit={setPointVolumeUnit} setPointWarpageMax={setPointWarpageMax}
                  setPointWorkstationId={setPointWorkstationId} showCoatingSection={showCoatingSection} showCoplanaritySection={showCoplanaritySection}
                  showGdtSection={showGdtSection} showPositionSection={showPositionSection} showSolderSection={showSolderSection}
                  showToleranceSection={showToleranceSection} showXraySection={showXraySection} workstations={workstations}
                />
                </div>
              </TabsContent>

              {/* ② Thông tin sản phẩm — độ hoàn thiện + golden samples + tài liệu */}
              <TabsContent value="info" className="space-y-4 mt-2">
                <ProductInfoTab
                  deleteDocumentMutation={deleteDocumentMutation} handleDocumentUpload={handleDocumentUpload} productDocuments={productDocuments}
                  selectedProduct={selectedProduct} setShowDocuments={setShowDocuments} showDocuments={showDocuments}
                  uploadDocumentMutation={uploadDocumentMutation}
                />
              </TabsContent>

              {/* ③ Phát hành & Chương trình — mở dialog nhóm gọn (tái dùng setState open; menu ⋯ vẫn giữ) */}
              <TabsContent value="release" className="mt-2">
                <ProductReleaseTab
                  refetchProducts={refetchProducts} selectedProduct={selectedProduct} setIsFiducialsOpen={setIsFiducialsOpen}
                  setIsPanelDefOpen={setIsPanelDefOpen} setIsProgramReleaseOpen={setIsProgramReleaseOpen} setIsTemplateDialogOpen={setIsTemplateDialogOpen}
                  templates={templates}
                />
              </TabsContent>

              {/* ④ Nền tảng — 5 mini-CRUD master-data dùng chung + banner cross-link */}
              <TabsContent value="foundation" className="space-y-4 mt-2">
                <ProductFoundationTab
                  createInstrumentMutation={createInstrumentMutation} createProductViewMutation={createProductViewMutation} createSamplingPlanMutation={createSamplingPlanMutation}
                  deleteInstrumentMutation={deleteInstrumentMutation} deleteProductViewMutation={deleteProductViewMutation} deleteSamplingPlanMutation={deleteSamplingPlanMutation}
                  handleCreateInstrument={handleCreateInstrument} handleCreateProductView={handleCreateProductView} handleCreateSamplingPlan={handleCreateSamplingPlan}
                  measurementInstruments={measurementInstruments} msaStudies={msaStudies} newInstrumentCode={newInstrumentCode}
                  newInstrumentName={newInstrumentName} newInstrumentType={newInstrumentType} newSamplingCode={newSamplingCode}
                  newSamplingName={newSamplingName} newSamplingStrategy={newSamplingStrategy} newViewCode={newViewCode}
                  newViewName={newViewName} newViewType={newViewType} openMsaWizard={openMsaWizard}
                  productViews={productViews} samplingPlans={samplingPlans} selectedProduct={selectedProduct}
                  setIsMsaDialogOpen={setIsMsaDialogOpen} setMsaWizardStep={setMsaWizardStep} setNewInstrumentCode={setNewInstrumentCode}
                  setNewInstrumentName={setNewInstrumentName} setNewInstrumentType={setNewInstrumentType} setNewSamplingCode={setNewSamplingCode}
                  setNewSamplingName={setNewSamplingName} setNewSamplingStrategy={setNewSamplingStrategy} setNewViewCode={setNewViewCode}
                  setNewViewName={setNewViewName} setNewViewType={setNewViewType} setSelectedMsaStudyId={setSelectedMsaStudyId}
                />
              </TabsContent>

              {/* ⑤ Biến thể — product-variant master-data (doc 55 Item 3 / PV3-UI) */}
              <TabsContent value="variants" className="space-y-4 mt-2">
                <ProductVariantsTab productModelId={selectedProduct.id} productName={selectedProduct.name} />
              </TabsContent>

              {/* ⑥ Cây dạy — Khối C Task 10 (QĐ-4): đọc bản dạy giới hạn theo máy (appRouter.cayDay) */}
              <TabsContent value="teach" className="space-y-4 mt-2">
                <TeachTreeTab productModelId={selectedProduct.id} />
              </TabsContent>
              </Tabs>

            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                <div className="text-center">
                  <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>{t("products.selectToManage")}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </ErrorBoundary>
      </DashboardLayout>

      {/* W3-C (doc 27 §2 M9) — Phát hành chương trình (inspection-program release workflow) */}
      <Dialog open={isProgramReleaseOpen} onOpenChange={setIsProgramReleaseOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("programRelease.title")}{selectedProduct ? ` — ${selectedProduct.name}` : ""}</DialogTitle>
            <DialogDescription>{t("programRelease.desc")}</DialogDescription>
          </DialogHeader>
          {selectedProduct && isProgramReleaseOpen && (
            <ProgramReleasePanel productModelId={selectedProduct.id} />
          )}
        </DialogContent>
      </Dialog>

      {/* Doc 31 UX1 (WD-1) — Fiducial marks editor (mounts the orphaned ProductFiducialsTab) */}
      <Dialog open={isFiducialsOpen} onOpenChange={setIsFiducialsOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("products.fiducialsButton", "Fiducials")}{selectedProduct ? ` — ${selectedProduct.name}` : ""}</DialogTitle>
            <DialogDescription>{t("products.fiducialsDesc", "Alignment fiducial marks used to register the board before inspection.")}</DialogDescription>
          </DialogHeader>
          {selectedProduct && isFiducialsOpen && (
            <ProductFiducialsTab productModelId={selectedProduct.id} />
          )}
        </DialogContent>
      </Dialog>

      {/* W8-B (doc 29 §2 — M12b) — Panel N-up definition editor */}
      <Dialog open={isPanelDefOpen} onOpenChange={setIsPanelDefOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("panelDef.title")}{selectedProduct ? ` — ${selectedProduct.name}` : ""}</DialogTitle>
            <DialogDescription>{t("panelDef.desc")}</DialogDescription>
          </DialogHeader>
          {selectedProduct && isPanelDefOpen && (
            <PanelDefinitionPanel productModelId={selectedProduct.id} />
          )}
        </DialogContent>
      </Dialog>

      <MsaStudyDialog
        addMsaObservationMutation={addMsaObservationMutation} batchAddMsaObservationsMutation={batchAddMsaObservationsMutation} completeMsaStudyMutation={completeMsaStudyMutation}
        generateMsaMatrixMutation={generateMsaMatrixMutation} handleAddMsaObservation={handleAddMsaObservation} handleApplyMsaCsvMapping={handleApplyMsaCsvMapping}
        handleApplyMsaPreset={handleApplyMsaPreset} handleBatchImportMsaObservations={handleBatchImportMsaObservations} handleCompleteMsaStudy={handleCompleteMsaStudy}
        handleDeleteMsaCsvPreset={handleDeleteMsaCsvPreset} handleFillNextMsaCell={handleFillNextMsaCell} handleGenerateMsaMatrix={handleGenerateMsaMatrix}
        handleLoadMsaCsvPreset={handleLoadMsaCsvPreset} handleMsaCsvFileSelected={handleMsaCsvFileSelected} handleSaveMsaCsvPreset={handleSaveMsaCsvPreset}
        handleStartMsaStudy={handleStartMsaStudy} isMsaDialogOpen={isMsaDialogOpen} measurementInstruments={measurementInstruments}
        measurementPoints={measurementPoints} msaAutoAddNext={msaAutoAddNext} msaBatchInput={msaBatchInput}
        msaBatchPreview={msaBatchPreview} msaBatchSkipDuplicates={msaBatchSkipDuplicates} msaCellStats={msaCellStats}
        msaCsvColumnMap={msaCsvColumnMap} msaCsvFileInputRef={msaCsvFileInputRef} msaCsvHasHeader={msaCsvHasHeader}
        msaCsvHeaders={msaCsvHeaders} msaCsvPresetName={msaCsvPresetName} msaCsvPresetOptions={msaCsvPresetOptions}
        msaCsvRows={msaCsvRows} msaCsvSelectedPresetKey={msaCsvSelectedPresetKey} msaCsvSourceKey={msaCsvSourceKey}
        msaInstrumentId={msaInstrumentId} msaLastSummary={msaLastSummary} msaMatrixBaseValue={msaMatrixBaseValue}
        msaMatrixNoisePct={msaMatrixNoisePct} msaMatrixOverwriteExisting={msaMatrixOverwriteExisting} msaMeasuredValue={msaMeasuredValue}
        msaMeasurementPointId={msaMeasurementPointId} msaOperatorCount={msaOperatorCount} msaOperatorName={msaOperatorName}
        msaPartCount={msaPartCount} msaPartLabel={msaPartLabel} msaStudyCode={msaStudyCode}
        msaStudyData={msaStudyData} msaStudyName={msaStudyName} msaSuggestBaseValue={msaSuggestBaseValue}
        msaTrialCount={msaTrialCount} msaTrialNo={msaTrialNo} msaWizardStep={msaWizardStep}
        selectedProduct={selectedProduct} setIsMsaDialogOpen={setIsMsaDialogOpen} setMsaAutoAddNext={setMsaAutoAddNext}
        setMsaBatchInput={setMsaBatchInput} setMsaBatchSkipDuplicates={setMsaBatchSkipDuplicates} setMsaCsvColumnMap={setMsaCsvColumnMap}
        setMsaCsvHasHeader={setMsaCsvHasHeader} setMsaCsvPresetName={setMsaCsvPresetName} setMsaCsvSourceKey={setMsaCsvSourceKey}
        setMsaInstrumentId={setMsaInstrumentId} setMsaMatrixBaseValue={setMsaMatrixBaseValue} setMsaMatrixNoisePct={setMsaMatrixNoisePct}
        setMsaMatrixOverwriteExisting={setMsaMatrixOverwriteExisting} setMsaMeasuredValue={setMsaMeasuredValue} setMsaMeasurementPointId={setMsaMeasurementPointId}
        setMsaOperatorCount={setMsaOperatorCount} setMsaOperatorName={setMsaOperatorName} setMsaPartCount={setMsaPartCount}
        setMsaPartLabel={setMsaPartLabel} setMsaStudyCode={setMsaStudyCode} setMsaStudyName={setMsaStudyName}
        setMsaSuggestBaseValue={setMsaSuggestBaseValue} setMsaTrialCount={setMsaTrialCount} setMsaTrialNo={setMsaTrialNo}
        setMsaWizardStep={setMsaWizardStep} startMsaStudyMutation={startMsaStudyMutation}
      />

      {/* Edit Product Dialog — Doc 31 UX4 (WE-3): extracted to components/products/EditProductDialog */}
      <EditProductDialog
        open={isEditProductDialogOpen}
        onOpenChange={setIsEditProductDialogOpen}
        code={editProductCode} setCode={setEditProductCode}
        name={editProductName} setName={setEditProductName}
        description={editProductDescription} setDescription={setEditProductDescription}
        category={editProductCategory} setCategory={setEditProductCategory}
        line={editProductLine} setLine={setEditProductLine}
        variant={editProductVariant} setVariant={setEditProductVariant}
        lifecycle={editProductLifecycle} setLifecycle={setEditProductLifecycle}
        revision={editProductRevision} setRevision={setEditProductRevision}
        targetYield={editProductTargetYield} setTargetYield={setEditProductTargetYield}
        minYield={editProductMinYield} setMinYield={setEditProductMinYield}
        displayMode={editProductDisplayMode} setDisplayMode={setEditProductDisplayMode}
        imageUrl={editProductImageUrl}
        currentImageUrl={selectedProduct?.referenceImageUrl}
        onImageUpload={handleEditImageUpload}
        onSave={handleUpdateProduct}
        isSaving={updateProductMutation.isPending}
      />

      {/* Delete Product Confirmation */}
      <DeleteConfirmDialog
        open={isDeleteProductDialogOpen}
        onOpenChange={setIsDeleteProductDialogOpen}
        itemType={t("products.productItemType")}
        itemName={selectedProduct?.name}
        onConfirm={handleDeleteProduct}
        isLoading={deleteProductMutation.isPending}
      />

      {/* Clone Product Dialog — Doc 31 PM1 (WC-2) · UX4 (WE-3): extracted to components/products/CloneProductDialog */}
      <CloneProductDialog
        open={isCloneProductDialogOpen}
        onOpenChange={setIsCloneProductDialogOpen}
        sourceProduct={cloneSourceProduct}
        newCode={cloneNewCode} setNewCode={setCloneNewCode}
        newName={cloneNewName} setNewName={setCloneNewName}
        newRevision={cloneNewRevision} setNewRevision={setCloneNewRevision}
        copyMappings={cloneCopyMappings} setCopyMappings={setCloneCopyMappings}
        onClone={handleCloneProduct}
        isCloning={cloneProductMutation.isPending}
      />

      {/* Delete Point Confirmation */}
      <DeleteConfirmDialog
        open={isDeletePointDialogOpen}
        onOpenChange={setIsDeletePointDialogOpen}
        itemType={t("products.pointItemType")}
        itemName={selectedPointIndex !== null ? measurementPoints[selectedPointIndex]?.name : undefined}
        onConfirm={handleDeletePoint}
        isLoading={deletePointMutation.isPending}
      />

      {/* Doc 31 UX3 — optimistic-lock conflict: reload vs overwrite-anyway */}
      <AlertDialog open={pointConflict !== null} onOpenChange={(o) => { if (!o) setPointConflict(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              {t("products.conflict.title", "Điểm đo đã bị thay đổi")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "products.conflict.body",
                "Một người khác đã thay đổi điểm đo này kể từ khi bạn mở. Tải lại để xem thay đổi của họ, hoặc ghi đè bằng thay đổi của bạn.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pointConflict && (() => {
            const fields: Array<[string, string]> = [
              ["code", t("products.pointCode", "Code")],
              ["name", t("common.name", "Name")],
              ["lowerLimit", t("products.lowerLimit", "Lower limit")],
              ["upperLimit", t("products.upperLimit", "Upper limit")],
              ["nominalValue", t("products.nominalValue", "Nominal")],
              ["componentCode", t("products.componentCode", "Component")],
              ["refDesignator", t("products.refDesignator", "RefDes")],
              ["positionX", "X"],
              ["positionY", "Y"],
              ["radius", t("products.radius", "Radius")],
            ];
            const norm = (v: any) => (v === null || v === undefined ? "" : String(v));
            const changed = fields.filter(([k]) => norm(pointConflict.current[k]) !== norm((pointConflict.loaded as any)[k]));
            if (changed.length === 0) return null;
            return (
              <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
                <p className="font-medium mb-1">{t("products.conflict.theirChanges", "Thay đổi của người khác:")}</p>
                <ul className="space-y-0.5">
                  {changed.map(([k, label]) => (
                    <li key={k} className="flex items-center gap-1">
                      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
                      <span className="line-through text-destructive/80">{norm((pointConflict.loaded as any)[k]) || "—"}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-success font-medium">{norm(pointConflict.current[k]) || "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPointConflict(null)}>
              {t("common.cancel", "Hủy")}
            </AlertDialogCancel>
            <Button variant="outline" onClick={handleReloadConflict} disabled={isSavingPoint}>
              {t("products.conflict.reload", "Tải lại")}
            </Button>
            <Button variant="destructive" onClick={handleOverwriteConflict} disabled={isSavingPoint}>
              {t("products.conflict.overwrite", "Ghi đè")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Import Dialog */}
      {selectedProduct && (
        <BulkImportDialog
          open={isBulkImportDialogOpen}
          onOpenChange={setIsBulkImportDialogOpen}
          productModelId={selectedProduct.id}
          productModelName={selectedProduct.name}
          onSuccess={() => {
            refetchPoints();
          }}
        />
      )}

      {/* Doc 31 MP5/PM4 (Đợt C) — centroid / pick-place import wizard */}
      {selectedProduct && (
        <CentroidImportDialog
          open={isCentroidImportOpen}
          onOpenChange={setIsCentroidImportOpen}
          productModelId={selectedProduct.id}
          productModelName={selectedProduct.name}
          onSuccess={() => {
            refetchPoints();
          }}
        />
      )}

      {/* Template Dialog — Doc 31 UX4 (WE-3): extracted to components/products/PointTemplateDialog */}
      <PointTemplateDialog
        open={isTemplateDialogOpen}
        onOpenChange={setIsTemplateDialogOpen}
        name={templateName} setName={setTemplateName}
        category={templateCategory} setCategory={setTemplateCategory}
        description={templateDescription} setDescription={setTemplateDescription}
        isSaving={isSavingTemplate}
        pointCount={measurementPoints.length}
        templates={templates}
        onSaveAsTemplate={handleSaveAsTemplate}
        onApplyTemplate={handleApplyTemplate}
        onDeleteTemplate={(id) => deleteTemplateMutation.mutate({ id })}
      />

      {/* Wave 2 đường A (Task 3) — đề xuất ngưỡng hàng loạt cho N điểm đã chọn.
          Vòng sửa 1 (review Task 3, Minor #3) — bỏ prop currentUserId chết (dialog
          này chỉ ĐỀ XUẤT, không DUYỆT, nên không cần biết ai đang thao tác). */}
      <BatchSuggestDialog
        open={isBatchSuggestOpen}
        pointDefIds={Array.from(selectedPointIds)}
        onClose={() => setIsBatchSuggestOpen(false)}
      />
    </>
  );
}
