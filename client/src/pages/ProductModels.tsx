import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { useSetCopilotContext } from "@/contexts/AiCopilotContext";
import DashboardLayout from "@/components/DashboardLayout";
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
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Plus, Package, Target, Upload, Trash2, Edit, Eye, MousePointer, Circle, Save, X, Move, ZoomIn, ZoomOut, MoreVertical, Copy, Image as ImageIcon, FileSpreadsheet, Download, Layers, CheckSquare, Square, FileText, Paperclip } from "lucide-react";
import { BulkImportDialog } from "@/components/BulkImportDialog";
import MeasurementPointCanvas, { type CanvasGeometry, type CanvasPointShape } from "@/components/measurement-point-canvas/MeasurementPointCanvas";
import { navItems } from "@/lib/navigation";
import { EmptyState, NoMeasurementPoints } from "@/components/EmptyState";
import { ErrorBoundary, WidgetErrorBoundary } from "@/components/ErrorBoundary";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFormValidation, ValidationPatterns } from "@/hooks/useFormValidation";
import { useFormShortcuts } from "@/hooks/useKeyboardShortcuts";
import { ValidationMessage } from "@/components/ValidationMessage";
import { DeleteConfirmDialog } from "@/components/ConfirmDialog";

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
}

type ToleranceMode = "min_only" | "max_only" | "range" | "bilateral";
type MaterialCondition = "MMC" | "LMC" | "RFS";

interface ProductModel {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
  productLine?: string | null;
  variant?: string | null;
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

export default function ProductModels() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const setCopilotContext = useSetCopilotContext();
  const [selectedProduct, setSelectedProduct] = useState<ProductModel | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditProductDialogOpen, setIsEditProductDialogOpen] = useState(false);
  const [isDeleteProductDialogOpen, setIsDeleteProductDialogOpen] = useState(false);
  const [isBulkImportDialogOpen, setIsBulkImportDialogOpen] = useState(false);
  const [isDeletePointDialogOpen, setIsDeletePointDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
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
  const [newProductLifecycle, setNewProductLifecycle] = useState<"development" | "active" | "eol" | "archived">("active");
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
  const { data: points, refetch: refetchPoints } = trpc.measurementPoint.listByProductModel.useQuery(
    { productModelId: selectedProduct?.id || 0 },
    { enabled: !!selectedProduct }
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
    },
  });

  const deleteMsaCsvPresetMutation = trpc.msaWizard.deleteCsvMappingPreset.useMutation({
    onSuccess: () => {
      toast.success("CSV mapping preset deleted");
      setMsaCsvSelectedPresetKey("__none");
      refetchMsaCsvPresets();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
    },
  });

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
      toast.error(t("common.errorWithMessage", { message: error.message }));
      setIsSavingTemplate(false);
    },
  });

  const deleteTemplateMutation = trpc.template.delete.useMutation({
    onSuccess: () => {
      toast.success(t("products.templateDeleteSuccess"));
      refetchTemplates();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: error.message }));
    },
  });

  const createPointMutation = trpc.measurementPoint.create.useMutation({
    onSuccess: () => {
      toast.success(t("products.pointCreateSuccess"));
      refetchPoints();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: error.message }));
    },
  });

  const updatePointMutation = trpc.measurementPoint.update.useMutation({
    onSuccess: () => {
      toast.success(t("products.pointUpdateSuccess"));
      refetchPoints();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: error.message }));
    },
  });

  const deletePointMutation = trpc.measurementPoint.delete.useMutation({
    onSuccess: () => {
      toast.success(t("products.pointDeleteSuccess"));
      refetchPoints();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
    },
  });

  const deleteInstrumentMutation = trpc.measurementInstrument.delete.useMutation({
    onSuccess: () => {
      toast.success("Instrument deleted");
      refetchMeasurementInstruments();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
    },
  });

  const deleteSamplingPlanMutation = trpc.samplingPlan.delete.useMutation({
    onSuccess: () => {
      toast.success("Sampling plan deleted");
      refetchSamplingPlans();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
    },
  });

  const deleteProductViewMutation = trpc.productView.delete.useMutation({
    onSuccess: () => {
      toast.success("Product view deleted");
      refetchProductViews();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
        toast.error("Cell đã có dữ liệu. Hãy đổi operator/part/trial hoặc bật overwrite để tạo lại matrix.");
        return;
      }
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
    },
  });

  const generateMsaMatrixMutation = trpc.msaWizard.generateMatrix.useMutation({
    onSuccess: (data) => {
      toast.success(`Matrix generated: ${data.created} created, ${data.skipped} skipped`);
      refetchMsaStudyData();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
      toast.error(t("products.uploadImageError", { message: error.message }));
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
      toast.error(t("common.errorWithMessage", { message: error.message }));
    },
  });

  const deleteDocumentMutation = trpc.productDocument.delete.useMutation({
    onSuccess: () => {
      toast.success(t("products.documentDeleteSuccess"));
      refetchDocuments();
    },
    onError: (error) => {
      toast.error(t("common.errorWithMessage", { message: error.message }));
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
    setNewProductLifecycle("active");
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
  const showPositionSection = pointTypeCategory === "POSITION";

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

  // Handle canvas click for adding/selecting points
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !isEditMode) return;

    const rect = canvas.getBoundingClientRect();
    const displayScale = scale * (zoomLevel / 100);
    const x = (e.clientX - rect.left) / displayScale;
    const y = (e.clientY - rect.top) / displayScale;

    if (isDrawing) {
      // Add new point
      const newPoint: MeasurementPoint = {
        code: `MP-${String(measurementPoints.length + 1).padStart(3, "0")}`,
        name: t("products.defaultPointName", { n: measurementPoints.length + 1 }),
        measurementType: "VISUAL",
        positionX: Math.round(x),
        positionY: Math.round(y),
        radius: pointRadius,
        orderIndex: measurementPoints.length,
        cropWidth: 100, // Mặc định 100px
        cropHeight: 100, // Mặc định 100px
      };
      setMeasurementPoints([...measurementPoints, newPoint]);
      setSelectedPointIndex(measurementPoints.length);
      setIsDrawing(false);

      // Pre-fill form
      setPointCode(newPoint.code);
      setPointName(newPoint.name);
    } else {
      // Check if clicked on existing point
      const clickedIndex = measurementPoints.findIndex((point) => {
        const dx = point.positionX - x;
        const dy = point.positionY - y;
        return Math.sqrt(dx * dx + dy * dy) <= point.radius;
      });

      if (clickedIndex >= 0) {
        setSelectedPointIndex(clickedIndex);
        const point = measurementPoints[clickedIndex];
        setPointCode(point.code);
        setPointName(point.name);
        setPointDescription(point.description || "");
        setPointType(point.measurementType);
        setPointUnit(point.unit || "");
        setPointLowerLimit(point.lowerLimit || "");
        setPointUpperLimit(point.upperLimit || "");
        setPointNominalValue(point.nominalValue || "");
        setPointReferenceImageUrl(point.referenceImageUrl || "");
        setPointRadius(point.radius);
        setPointCropWidth(point.cropWidth || 100);
        setPointCropHeight(point.cropHeight || 100);
        setPointWorkstationId(point.workstationId);
      } else {
        setSelectedPointIndex(null);
        resetPointForm();
      }
    }
  };

  // Handle drag to move point
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isEditMode || isDrawing) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const displayScale = scale * (zoomLevel / 100);
    const x = (e.clientX - rect.left) / displayScale;
    const y = (e.clientY - rect.top) / displayScale;

    const clickedIndex = measurementPoints.findIndex((point) => {
      const dx = point.positionX - x;
      const dy = point.positionY - y;
      return Math.sqrt(dx * dx + dy * dy) <= point.radius;
    });

    if (clickedIndex >= 0) {
      setSelectedPointIndex(clickedIndex);
      setIsDragging(true);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || selectedPointIndex === null) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const displayScale = scale * (zoomLevel / 100);
    const x = (e.clientX - rect.left) / displayScale;
    const y = (e.clientY - rect.top) / displayScale;

    const updatedPoints = [...measurementPoints];
    updatedPoints[selectedPointIndex] = {
      ...updatedPoints[selectedPointIndex],
      positionX: Math.round(x),
      positionY: Math.round(y),
    };
    setMeasurementPoints(updatedPoints);
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
  };

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

  const openEditProductDialog = () => {
    if (!selectedProduct) return;
    setEditProductCode(selectedProduct.code);
    setEditProductName(selectedProduct.name);
    setEditProductDescription(selectedProduct.description || "");
    setEditProductCategory(selectedProduct.category || "");
    setEditProductLine(selectedProduct.productLine || "");
    setEditProductVariant(selectedProduct.variant || "");
    setEditProductLifecycle(selectedProduct.lifecycleStatus);
    setEditProductTargetYield(selectedProduct.targetYieldRate || "");
    setEditProductMinYield(selectedProduct.minYieldRate || "");
    setEditProductImageUrl("");
    setEditProductDisplayMode((selectedProduct.imageDisplayMode as any) || "contain");
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
        // Update existing point
        await updatePointMutation.mutateAsync({
          id: point.id,
          ...pointData,
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

      // Update local state
      const updatedPoints = [...measurementPoints];
      updatedPoints[selectedPointIndex] = {
        ...point,
        ...pointData,
      };
      setMeasurementPoints(updatedPoints);
    } catch (error) {
      // Error already handled by mutation onError
    } finally {
      setIsSavingPoint(false);
    }
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product List */}
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg">{t("products.productList")}</CardTitle>
              <CardDescription>{t("products.selectToManage")}</CardDescription>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                  <Plus className="h-4 w-4" />
                  {t("common.add")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("products.createNew")}</DialogTitle>
                  <DialogDescription>{t("products.createNewDesc")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="productCode">{t("products.productCodeLabel")}<span className="text-destructive">*</span></Label>
                    <Input
                      id="productCode"
                      value={newProductCode}
                      onChange={(e) => setNewProductCode(e.target.value)}
                      onBlur={() => productValidation.handleBlur("code", newProductCode)}
                      placeholder={t('products.codeExample')}
                      className={productValidation.hasError("code") ? "border-destructive" : ""}
                    />
                    <ValidationMessage error={productValidation.getFieldError("code")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productName">{t("products.productNameLabel")}<span className="text-destructive">*</span></Label>
                    <Input
                      id="productName"
                      value={newProductName}
                      onChange={(e) => setNewProductName(e.target.value)}
                      onBlur={() => productValidation.handleBlur("name", newProductName)}
                      placeholder={t('products.nameExample')}
                      className={productValidation.hasError("name") ? "border-destructive" : ""}
                    />
                    <ValidationMessage error={productValidation.getFieldError("name")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productDescription">{t("products.descriptionLabel")}</Label>
                    <Textarea
                      id="productDescription"
                      value={newProductDescription}
                      onChange={(e) => setNewProductDescription(e.target.value)}
                      placeholder={t("products.descriptionPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("products.imageDisplayModeLabel")}</Label>
                    <Select value={newProductDisplayMode} onValueChange={(value: any) => setNewProductDisplayMode(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contain">{t("products.displayContain")}</SelectItem>
                        <SelectItem value="cover">{t("products.displayCover")}</SelectItem>
                        <SelectItem value="stretch">{t("products.displayStretch")}</SelectItem>
                        <SelectItem value="none">{t("products.displayNone")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productImage">{t("products.referenceImageLabel")}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="productImage"
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="flex-1"
                      />
                    </div>
                    {uploadedImageUrl && (
                      <img
                        src={uploadedImageUrl}
                        alt="Preview"
                        className="mt-2 max-h-32 rounded border"
                      />
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>{t("common.cancel")}</Button>
                  <Button onClick={handleCreateProduct} disabled={createProductMutation.isPending}>
                    {createProductMutation.isPending ? t("products.creating") : t("products.createProduct")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
            
            <ScrollArea className="h-125">
              <div className="space-y-2">
                {productModels?.map((product) => (
                  <div
                    key={product.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedProduct?.id === product.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                    onClick={() => {
                      setSelectedProduct(product);
                      setIsEditMode(false);
                      resetPointForm();
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Package className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{product.name}</p>
                        <p className="text-sm text-muted-foreground">{product.code}</p>
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
                            openEditProductDialog();
                          }}>
                            <Edit className="h-4 w-4 mr-2" />
                            {t("common.edit")}
                          </DropdownMenuItem>
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
                  </div>
                ))}
                {(!productModels || productModels.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>{t("products.noProductsYet")}</p>
                    <p className="text-sm">{t("products.clickAddToCreate")}</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Measurement Point Editor */}
        <Card className="lg:col-span-2">
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
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => setIsBulkImportDialogOpen(true)} className="gap-1">
                      <FileSpreadsheet className="h-4 w-4" />
                      {t('common.import')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setIsTemplateDialogOpen(true)} className="gap-1">
                      <Layers className="h-4 w-4" />
                      {t('products.templates')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={openMsaWizard} className="gap-1">
                      <Target className="h-4 w-4" />
                      MSA Wizard
                    </Button>
                    <Button 
                      size="sm" 
                      variant={isBatchMode ? "default" : "outline"} 
                      onClick={() => {
                        setIsBatchMode(!isBatchMode);
                        if (isBatchMode) setSelectedPointIds(new Set());
                      }} 
                      className="gap-1"
                    >
                      {isBatchMode ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      {isBatchMode ? t("products.exitMode") : t("products.selectMode")}
                    </Button>
                    <Button size="sm" onClick={() => setIsEditMode(true)} className="gap-1">
                      <Edit className="h-4 w-4" />
                      {t("common.edit")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {selectedProduct ? (
              <div className="space-y-4">
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

                {/* Search and Filter */}
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label htmlFor="pointSearch" className="text-xs">{t('common.search')}</Label>
                    <Input
                      id="pointSearch"
                      placeholder={t('products.searchPointPlaceholder')}
                      value={pointSearchQuery}
                      onChange={(e) => setPointSearchQuery(e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <div className="w-40">
                    <Label htmlFor="typeFilter" className="text-xs">{t('common.type')}</Label>
                    <Select value={pointTypeFilter} onValueChange={(val) => setPointTypeFilter(val as any)}>
                      <SelectTrigger id="typeFilter" className="h-8">
                        <SelectValue placeholder={t('common.all')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all')}</SelectItem>
                        <SelectItem value="DIMENSION">{t('products.typeDimension')}</SelectItem>
                        <SelectItem value="VISUAL">{t('products.typeVisual')}</SelectItem>
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

                <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
                  {/* Canvas Area */}
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

                  <div className="relative border rounded-lg overflow-auto bg-muted/30 max-h-125">
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

                  {/* Point List */}
                  <div className="mt-4">
                    <h4 className="text-sm font-medium mb-2">{t("products.pointList")} ({measurementPoints.length}/50)</h4>
                    <div className="flex flex-wrap gap-2">
                      {measurementPoints.length === 0 ? (
                        <NoMeasurementPoints onAdd={() => setIsDrawing(true)} />
                      ) : measurementPoints.map((point, index) => (
                        <Badge
                          key={index}
                          variant={selectedPointIndex === index ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => {
                            setSelectedPointIndex(index);
                            populatePointForm(point);
                          }}
                        >
                          <Target className="h-3 w-3 mr-1" />
                          {index + 1}. {point.code}
                        </Badge>
                       ))}
                    </div>
                  </div>
                </div>

                {/* Point Details Form */}
                <div className="xl:col-span-1">
                  {selectedPointIndex !== null ? (
                    <ScrollArea className="h-137.5">
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium">{t("products.pointDetails")} #{selectedPointIndex + 1}</h4>
                          {isEditMode && (
                            <Button size="sm" variant="ghost" onClick={handleDuplicatePoint}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="pointCode">{t("products.pointCodeLabel")} <span className="text-destructive">*</span></Label>
                          <Input
                            id="pointCode"
                            value={pointCode}
                            onChange={(e) => setPointCode(e.target.value)}
                            onBlur={() => pointValidation.handleBlur("code", pointCode)}
                            disabled={!isEditMode}
                            className={pointValidation.hasError("code") ? "border-destructive" : ""}
                          />
                          <ValidationMessage error={pointValidation.getFieldError("code")} />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointName">{t("products.pointNameLabel")} <span className="text-destructive">*</span></Label>
                          <Input
                            id="pointName"
                            value={pointName}
                            onChange={(e) => setPointName(e.target.value)}
                            onBlur={() => pointValidation.handleBlur("name", pointName)}
                            disabled={!isEditMode}
                            className={pointValidation.hasError("name") ? "border-destructive" : ""}
                          />
                          <ValidationMessage error={pointValidation.getFieldError("name")} />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointType">{t("products.pointType")}</Label>
                          <Select
                            value={pointType}
                            onValueChange={(v) => setPointType(v as MeasurementPoint["measurementType"])}
                            disabled={!isEditMode}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="VISUAL">{t("products.typeVisual")}</SelectItem>
                              <SelectItem value="DIMENSION">{t("products.typeDimension")}</SelectItem>
                              <SelectItem value="POSITION">{t("products.typePosition")}</SelectItem>
                              <SelectItem value="COLOR">{t("products.typeColor")}</SelectItem>
                              <SelectItem value="SURFACE">{t("products.typeSurface")}</SelectItem>
                              <SelectItem value="ELECTRICAL">{t("products.typeElectrical")}</SelectItem>
                              <SelectItem value="OTHER">{t("products.typeOther")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointMeasurementTypeCode">{t("measurementPointP2.measurementTypeCode")}</Label>
                          <Select
                            value={pointMeasurementTypeCode || "none"}
                            onValueChange={(v) => {
                              const nextCode = v === "none" ? "" : v;
                              setPointMeasurementTypeCode(nextCode);
                              const selected = measurementTypeCatalog?.find((item) => item.code === nextCode);
                              if (selected?.category) {
                                setPointType(mapCatalogCategoryToLegacyType(selected.category));
                              }
                            }}
                            disabled={!isEditMode}
                          >
                            <SelectTrigger id="pointMeasurementTypeCode">
                              <SelectValue placeholder={t("measurementPointP2.selectMeasurementTypeCode")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{t("common.none")}</SelectItem>
                              {measurementTypeCatalog?.map((item) => (
                                <SelectItem key={item.id} value={item.code}>
                                  {item.code} {item.nameEn ? `- ${item.nameEn}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointDescription">{t("products.descriptionLabel")}</Label>
                          <Textarea
                            id="pointDescription"
                            value={pointDescription}
                            onChange={(e) => setPointDescription(e.target.value)}
                            disabled={!isEditMode}
                            rows={2}
                          />
                        </div>

                        {showToleranceSection && (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="pointToleranceMode">{t("measurementPointP2.toleranceMode")}</Label>
                              <Select
                                value={pointToleranceMode}
                                onValueChange={(v) => setPointToleranceMode(v as ToleranceMode)}
                                disabled={!isEditMode}
                              >
                                <SelectTrigger id="pointToleranceMode">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="range">{t("measurementPointP2.toleranceModes.range")}</SelectItem>
                                  <SelectItem value="bilateral">{t("measurementPointP2.toleranceModes.bilateral")}</SelectItem>
                                  <SelectItem value="min_only">{t("measurementPointP2.toleranceModes.min_only")}</SelectItem>
                                  <SelectItem value="max_only">{t("measurementPointP2.toleranceModes.max_only")}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-2">
                                <Label htmlFor="pointLowerLimit">{t("products.lowerLimit")}</Label>
                                <Input
                                  id="pointLowerLimit"
                                  value={pointLowerLimit}
                                  onChange={(e) => setPointLowerLimit(e.target.value)}
                                  onBlur={() => pointValidation.handleBlur("lowerLimit", pointLowerLimit)}
                                  disabled={!isEditMode}
                                  className={pointValidation.hasError("lowerLimit") ? "border-destructive" : ""}
                                />
                                <ValidationMessage error={pointValidation.getFieldError("lowerLimit")} />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="pointUpperLimit">{t("products.upperLimit")}</Label>
                                <Input
                                  id="pointUpperLimit"
                                  value={pointUpperLimit}
                                  onChange={(e) => setPointUpperLimit(e.target.value)}
                                  onBlur={() => pointValidation.handleBlur("upperLimit", pointUpperLimit)}
                                  disabled={!isEditMode}
                                  className={pointValidation.hasError("upperLimit") ? "border-destructive" : ""}
                                />
                                <ValidationMessage error={pointValidation.getFieldError("upperLimit")} />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="pointNominalValue">{t("products.nominalValue")}</Label>
                              <Input
                                id="pointNominalValue"
                                value={pointNominalValue}
                                onChange={(e) => setPointNominalValue(e.target.value)}
                                disabled={!isEditMode}
                              />
                            </div>
                            {pointToleranceMode === "bilateral" && (
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-2">
                                  <Label htmlFor="pointTolPlus">{t("measurementPointP2.tolPlus")}</Label>
                                  <Input
                                    id="pointTolPlus"
                                    value={pointTolPlus}
                                    onChange={(e) => setPointTolPlus(e.target.value)}
                                    disabled={!isEditMode}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="pointTolMinus">{t("measurementPointP2.tolMinus")}</Label>
                                  <Input
                                    id="pointTolMinus"
                                    value={pointTolMinus}
                                    onChange={(e) => setPointTolMinus(e.target.value)}
                                    disabled={!isEditMode}
                                  />
                                </div>
                              </div>
                            )}
                            <div className="space-y-2">
                              <Label htmlFor="pointUnit">{t("products.unit")}</Label>
                              <Input
                                id="pointUnit"
                                value={pointUnit}
                                onChange={(e) => setPointUnit(e.target.value)}
                                disabled={!isEditMode}
                                placeholder="mm, V, A..."
                              />
                            </div>
                          </>
                        )}

                        {showGdtSection && (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="pointDatumRefs">{t("measurementPointP2.datumRefs")}</Label>
                              <Input
                                id="pointDatumRefs"
                                value={pointDatumRefsInput}
                                onChange={(e) => setPointDatumRefsInput(e.target.value)}
                                disabled={!isEditMode}
                                placeholder="A,B,C"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-2">
                                <Label htmlFor="pointMaterialCondition">{t("measurementPointP2.materialCondition")}</Label>
                                <Select
                                  value={pointMaterialCondition || "none"}
                                  onValueChange={(v) => setPointMaterialCondition(v === "none" ? "" : (v as MaterialCondition))}
                                  disabled={!isEditMode}
                                >
                                  <SelectTrigger id="pointMaterialCondition">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">{t("common.none")}</SelectItem>
                                    <SelectItem value="MMC">MMC</SelectItem>
                                    <SelectItem value="LMC">LMC</SelectItem>
                                    <SelectItem value="RFS">RFS</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="pointFitClass">{t("measurementPointP2.fitClass")}</Label>
                                <Input
                                  id="pointFitClass"
                                  value={pointFitClass}
                                  onChange={(e) => setPointFitClass(e.target.value)}
                                  disabled={!isEditMode}
                                  placeholder="H7/g6"
                                />
                              </div>
                            </div>
                          </>
                        )}

                        {(showSolderSection || showXraySection || showPositionSection) && (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-2">
                                <Label htmlFor="pointPositionZ">{t("measurementPointP2.positionZ")}</Label>
                                <Input
                                  id="pointPositionZ"
                                  value={pointPositionZ}
                                  onChange={(e) => setPointPositionZ(e.target.value)}
                                  disabled={!isEditMode}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="pointVoidPctMax">{t("measurementPointP2.voidPctMax")}</Label>
                                <Input
                                  id="pointVoidPctMax"
                                  value={pointVoidPctMax}
                                  onChange={(e) => setPointVoidPctMax(e.target.value)}
                                  disabled={!isEditMode || !showXraySection}
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div className="space-y-2">
                                <Label htmlFor="pointHeightMin">{t("measurementPointP2.heightMin")}</Label>
                                <Input id="pointHeightMin" value={pointHeightMin} onChange={(e) => setPointHeightMin(e.target.value)} disabled={!isEditMode || !showSolderSection} />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="pointHeightMax">{t("measurementPointP2.heightMax")}</Label>
                                <Input id="pointHeightMax" value={pointHeightMax} onChange={(e) => setPointHeightMax(e.target.value)} disabled={!isEditMode || !showSolderSection} />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="pointHeightUnit">{t("measurementPointP2.heightUnit")}</Label>
                                <Input id="pointHeightUnit" value={pointHeightUnit} onChange={(e) => setPointHeightUnit(e.target.value)} disabled={!isEditMode || !showSolderSection} placeholder="um" />
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div className="space-y-2">
                                <Label htmlFor="pointAreaMin">{t("measurementPointP2.areaMin")}</Label>
                                <Input id="pointAreaMin" value={pointAreaMin} onChange={(e) => setPointAreaMin(e.target.value)} disabled={!isEditMode || !showSolderSection} />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="pointAreaMax">{t("measurementPointP2.areaMax")}</Label>
                                <Input id="pointAreaMax" value={pointAreaMax} onChange={(e) => setPointAreaMax(e.target.value)} disabled={!isEditMode || !showSolderSection} />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="pointAreaUnit">{t("measurementPointP2.areaUnit")}</Label>
                                <Input id="pointAreaUnit" value={pointAreaUnit} onChange={(e) => setPointAreaUnit(e.target.value)} disabled={!isEditMode || !showSolderSection} placeholder="%" />
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                              <div className="space-y-2">
                                <Label htmlFor="pointVolumeMin">{t("measurementPointP2.volumeMin")}</Label>
                                <Input id="pointVolumeMin" value={pointVolumeMin} onChange={(e) => setPointVolumeMin(e.target.value)} disabled={!isEditMode || !showSolderSection} />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="pointVolumeMax">{t("measurementPointP2.volumeMax")}</Label>
                                <Input id="pointVolumeMax" value={pointVolumeMax} onChange={(e) => setPointVolumeMax(e.target.value)} disabled={!isEditMode || !showSolderSection} />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="pointVolumeUnit">{t("measurementPointP2.volumeUnit")}</Label>
                                <Input id="pointVolumeUnit" value={pointVolumeUnit} onChange={(e) => setPointVolumeUnit(e.target.value)} disabled={!isEditMode || !showSolderSection} placeholder="%" />
                              </div>
                            </div>
                          </>
                        )}

                        {/* Reference Image for Point */}
                        <div className="space-y-2">
                          <Label>{t("products.pointReferenceImage")}</Label>
                          {pointReferenceImageUrl && (
                            <div className="relative">
                              <img
                                src={pointReferenceImageUrl}
                                alt="Point reference"
                                className="w-full rounded border"
                              />
                              {isEditMode && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="absolute top-1 right-1 h-6 w-6 p-0"
                                  onClick={() => setPointReferenceImageUrl("")}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          )}
                          {!pointReferenceImageUrl && !isEditMode && (
                            <div className="flex items-center justify-center h-20 bg-muted/30 rounded border border-dashed text-muted-foreground text-sm">
                              <ImageIcon className="h-4 w-4 mr-1" />
                              {t("products.noReferenceImagePoint")}
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointWorkstation">{t("products.workstationOptional")}</Label>
                          <Select value={pointWorkstationId?.toString() || ""} onValueChange={(value) => setPointWorkstationId(value ? parseInt(value) : undefined)}>
                            <SelectTrigger id="pointWorkstation" disabled={!isEditMode}>
                              <SelectValue placeholder={t("products.selectWorkstation")} />
                            </SelectTrigger>
                            <SelectContent>
                              {workstations?.map((ws) => (
                                <SelectItem key={ws.id} value={ws.id.toString()}>
                                  <div className="flex items-center gap-2">
                                    <span>{ws.code} - {ws.name}</span>
                                    <Badge variant={ws.isActive ? "default" : "secondary"} className="ml-2">
                                      {ws.isActive ? t('common.active') : t('common.inactive')}
                                    </Badge>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointPreferredInstrument">Preferred Instrument (P3)</Label>
                          <Select
                            value={pointPreferredInstrumentId?.toString() || "__none"}
                            onValueChange={(value) => setPointPreferredInstrumentId(value === "__none" ? undefined : parseInt(value, 10))}
                          >
                            <SelectTrigger id="pointPreferredInstrument" disabled={!isEditMode}>
                              <SelectValue placeholder="Select preferred instrument" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">None</SelectItem>
                              {(measurementInstruments || []).map((inst: any) => (
                                <SelectItem key={inst.id} value={String(inst.id)} disabled={!inst.isActive}>
                                  {inst.code} - {inst.name}
                                  {inst.mmPerPixel && ` (cal: ${inst.mmPerPixel} mm/px)`}
                                  {!inst.isActive && " [inactive]"}
                                  {!inst.mmPerPixel && " [uncalibrated]"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {pointPreferredInstrumentId && (
                            (() => {
                              const selected = (measurementInstruments || []).find((i: any) => i.id === pointPreferredInstrumentId);
                              return (
                                <>
                                  {selected?.isActive === false && (
                                    <p className="text-xs text-amber-600">⚠️ Selected instrument is inactive and will be rejected on save.</p>
                                  )}
                                  {!selected?.mmPerPixel && (
                                    <p className="text-xs text-amber-600">⚠️ Selected instrument has no mmPerPixel calibration (will use pixel coordinates only).</p>
                                  )}
                                </>
                              );
                            })()
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointPreferredSamplingPlan">Preferred Sampling Plan (P3)</Label>
                          <Select
                            value={pointPreferredSamplingPlanId?.toString() || "__none"}
                            onValueChange={(value) => setPointPreferredSamplingPlanId(value === "__none" ? undefined : parseInt(value, 10))}
                          >
                            <SelectTrigger id="pointPreferredSamplingPlan" disabled={!isEditMode}>
                              <SelectValue placeholder="Select sampling plan" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">None</SelectItem>
                              {(samplingPlans || []).map((plan: any) => (
                                <SelectItem key={plan.id} value={String(plan.id)} disabled={!plan.isActive}>
                                  {plan.code} - {plan.strategy}
                                  {!plan.isActive && " (inactive)"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {pointPreferredSamplingPlanId && (samplingPlans || []).find((p: any) => p.id === pointPreferredSamplingPlanId)?.isActive === false && (
                            <p className="text-xs text-amber-600">⚠️ Selected sampling plan is inactive and will be rejected on save.</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointProductView">Product View / Camera (P3.4)</Label>
                          <Select
                            value={pointProductViewId?.toString() || "__none"}
                            onValueChange={(value) => setPointProductViewId(value === "__none" ? undefined : parseInt(value, 10))}
                          >
                            <SelectTrigger id="pointProductView" disabled={!isEditMode}>
                              <SelectValue placeholder="Select view / camera (optional)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none">None (all views)</SelectItem>
                              {(productViews || []).map((view: any) => (
                                <SelectItem key={view.id} value={String(view.id)} disabled={!view.isActive}>
                                  {view.viewType === "custom" ? view.name : view.viewType.toUpperCase()} ({view.code})
                                  {!view.isActive && " [inactive]"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {pointProductViewId && (productViews || []).find((v: any) => v.id === pointProductViewId)?.isActive === false && (
                            <p className="text-xs text-amber-600">⚠️ Selected view is inactive and will be rejected on save.</p>
                          )}
                        </div>

                        <div className="text-sm text-muted-foreground p-2 bg-muted/30 rounded">
                          <p>{t("products.position")}: ({measurementPoints[selectedPointIndex]?.positionX}, {measurementPoints[selectedPointIndex]?.positionY})</p>
                          <p>{t("products.radius")}: {measurementPoints[selectedPointIndex]?.radius}px</p>
                        </div>

                        {/* P3.3: Quality Readiness Indicator */}
                        {selectedPointIndex !== null && (() => {
                          const point = measurementPoints[selectedPointIndex];
                          const instrument = (measurementInstruments || []).find((i: any) => i.id === pointPreferredInstrumentId);
                          const samplingPlan = (samplingPlans || []).find((p: any) => p.id === pointPreferredSamplingPlanId);
                          const productView = (productViews || []).find((v: any) => v.id === pointProductViewId);
                          
                          // Compute readiness status
                          const hasCalibration = instrument?.mmPerPixel;
                          const hasAQL = samplingPlan?.aqlCritical || samplingPlan?.aqlMajor || samplingPlan?.aqlMinor;
                          const hasView = pointProductViewId !== undefined;
                          const readinessCount = (hasCalibration ? 1 : 0) + (hasAQL ? 1 : 0) + (hasView ? 1 : 0);
                          const readinessStatus = readinessCount === 3 ? 'ready' : readinessCount >= 2 ? 'partial' : 'incomplete';
                          const readinessColor = readinessStatus === 'ready' ? 'bg-green-50 border-green-200' : 
                                               readinessStatus === 'partial' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
                          const readinessIcon = readinessStatus === 'ready' ? '✓' : 
                                              readinessStatus === 'partial' ? '⚠️' : '❌';
                          const readinessLabel = readinessStatus === 'ready' ? 'Ready' : 
                                               readinessStatus === 'partial' ? 'Partial' : 'Incomplete';

                          return (
                            <div className={`text-xs p-3 border rounded ${readinessColor}`}>
                              <p className="font-semibold mb-2">{readinessIcon} P3 Quality Readiness: <span className="font-bold">{readinessLabel}</span></p>
                              <div className="space-y-1">
                                <p className={hasCalibration ? 'text-green-700' : 'text-gray-500'}>
                                  • Instrument: {instrument ? `${instrument.code} (cal: ${instrument.mmPerPixel ?? 'uncalibrated'} mm/px)` : 'None'}
                                </p>
                                <p className={hasAQL ? 'text-green-700' : 'text-gray-500'}>
                                  • Sampling Plan: {samplingPlan ? `${samplingPlan.code} (AQL: C=${samplingPlan.aqlCritical ?? '-'}, M=${samplingPlan.aqlMajor ?? '-'}, m=${samplingPlan.aqlMinor ?? '-'}, n=${samplingPlan.sampleSize ?? '?'})` : 'None'}
                                </p>
                                <p className={hasView ? 'text-green-700' : 'text-gray-500'}>
                                  • View: {productView ? `${productView.viewType.toUpperCase()} (${productView.code})` : 'All views'}
                                </p>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Vùng cắt ảnh mẫu */}
                        <div className="space-y-2 border-t pt-3 mt-3">
                          <Label className="text-sm font-medium">{t("products.cropAreaLabel")}</Label>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label htmlFor="cropWidth" className="text-xs text-muted-foreground">{t("products.width")} (px)</Label>
                              <Input
                                id="cropWidth"
                                type="number"
                                value={pointCropWidth}
                                onChange={(e) => setPointCropWidth(parseInt(e.target.value) || 100)}
                                disabled={!isEditMode}
                                min={20}
                                max={500}
                              />
                            </div>
                            <div>
                              <Label htmlFor="cropHeight" className="text-xs text-muted-foreground">{t("products.height")} (px)</Label>
                              <Input
                                id="cropHeight"
                                type="number"
                                value={pointCropHeight}
                                onChange={(e) => setPointCropHeight(parseInt(e.target.value) || 100)}
                                disabled={!isEditMode}
                                min={20}
                                max={500}
                              />
                            </div>
                          </div>
                          {/* Image Source Mode Selection */}
                          <div className="flex gap-2 mt-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={imageSourceMode === "auto-crop" ? "default" : "outline"}
                              onClick={() => setImageSourceMode("auto-crop")}
                              className="flex-1 text-xs"
                              disabled={!isEditMode}
                            >
                              {t("products.autoCrop")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={imageSourceMode === "upload" ? "default" : "outline"}
                              onClick={() => setImageSourceMode("upload")}
                              className="flex-1 text-xs"
                              disabled={!isEditMode}
                            >
                              {t("products.uploadImage")}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {imageSourceMode === "auto-crop" 
                              ? t("products.autoCropDesc")
                              : t("products.uploadDesc")}
                          </p>
                          {imageSourceMode === "upload" && isEditMode && (
                            <div className="mt-2">
                              <Label htmlFor="pointImageUpload" className="text-xs text-muted-foreground">{t("products.uploadPointImage")}</Label>
                              <Input
                                id="pointImageUpload"
                                type="file"
                                accept="image/*"
                                onChange={handlePointImageUpload}
                                className="text-xs"
                              />
                            </div>
                          )}
                        </div>

                        {isEditMode && (
                          <div className="flex gap-2 pt-2">
                            <Button 
                              size="sm" 
                              onClick={handleSavePoint} 
                              className="flex-1"
                              disabled={isSavingPoint}
                            >
                              {isSavingPoint ? (
                                <>
                                  <div className="h-4 w-4 mr-1 animate-spin rounded-full border-2 border-background border-t-transparent" />
                                  {t("products.saving")}
                                </>
                              ) : (
                                <>
                                  <Save className="h-4 w-4 mr-1" />
                                  {t("common.save")}
                                </>
                              )}
                            </Button>
                            <Button size="sm" variant="destructive" onClick={confirmDeletePoint} disabled={isSavingPoint}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-muted-foreground border rounded-lg bg-muted/20">
                      <div className="text-center">
                        <MousePointer className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">{t("products.selectPointToView")}</p>
                        {isEditMode && (
                          <p className="text-xs mt-1">{t("products.orClickAddPoint")}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                </div>

              {/* ─── Product Documents Section ─── */}
              <div className="border-t pt-4 mt-4">
                <div 
                  className="flex items-center justify-between cursor-pointer select-none"
                  onClick={() => setShowDocuments(!showDocuments)}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <h3 className="font-semibold text-sm">{t("products.documents")}</h3>
                    {productDocuments && (
                      <Badge variant="secondary" className="text-xs">{productDocuments.length}</Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm">
                    {showDocuments ? "▲" : "▼"}
                  </Button>
                </div>

                {showDocuments && (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => document.getElementById('doc-upload-input')?.click()}
                        disabled={uploadDocumentMutation.isPending}
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        {uploadDocumentMutation.isPending ? t("common.uploading") : t("products.attachDocument")}
                      </Button>
                      <input
                        id="doc-upload-input"
                        type="file"
                        className="hidden"
                        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                        onChange={handleDocumentUpload}
                      />
                    </div>

                    {productDocuments && productDocuments.length > 0 ? (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {productDocuments.map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between p-2 border rounded-md hover:bg-muted/50 text-sm">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <a
                                href={doc.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-blue-600 hover:underline"
                                title={doc.fileName}
                              >
                                {doc.fileName}
                              </a>
                              {doc.fileSize && (
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {(doc.fileSize / 1024).toFixed(0)} KB
                                </span>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 shrink-0"
                              onClick={() => deleteDocumentMutation.mutate({ id: doc.id })}
                              disabled={deleteDocumentMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("products.noDocuments")}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t pt-4 mt-4 space-y-4">
                <h3 className="font-semibold text-sm">{t("products.foundationSection")}</h3>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">{t("products.instruments")}</h4>
                      <Badge variant="secondary">{measurementInstruments?.length || 0}</Badge>
                    </div>
                    <div className="space-y-2">
                      <Input
                        placeholder={t("products.code")}
                        value={newInstrumentCode}
                        onChange={(e) => setNewInstrumentCode(e.target.value)}
                      />
                      <Input
                        placeholder={t("products.name")}
                        value={newInstrumentName}
                        onChange={(e) => setNewInstrumentName(e.target.value)}
                      />
                      <Input
                        placeholder={t("products.type")}
                        value={newInstrumentType}
                        onChange={(e) => setNewInstrumentType(e.target.value)}
                      />
                      <Button size="sm" className="w-full" onClick={handleCreateInstrument} disabled={createInstrumentMutation.isPending}>
                        <Plus className="h-4 w-4 mr-1" />{t("products.addInstrument")}
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {(measurementInstruments || []).slice(0, 10).map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                          <span className="truncate mr-2">{item.code} - {item.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-destructive"
                            onClick={() => deleteInstrumentMutation.mutate({ id: item.id })}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">{t("products.samplingPlans")}</h4>
                      <Badge variant="secondary">{samplingPlans?.length || 0}</Badge>
                    </div>
                    <div className="space-y-2">
                      <Input
                        placeholder={t("products.code")}
                        value={newSamplingCode}
                        onChange={(e) => setNewSamplingCode(e.target.value)}
                      />
                      <Input
                        placeholder={t("products.name")}
                        value={newSamplingName}
                        onChange={(e) => setNewSamplingName(e.target.value)}
                      />
                      <Select value={newSamplingStrategy} onValueChange={(v) => setNewSamplingStrategy(v as "fixed_n" | "aql" | "risk_based")}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("products.strategy")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed_n">{t("products.strategyFixedN")}</SelectItem>
                          <SelectItem value="aql">{t("products.strategyAql")}</SelectItem>
                          <SelectItem value="risk_based">{t("products.strategyRiskBased")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="w-full" onClick={handleCreateSamplingPlan} disabled={createSamplingPlanMutation.isPending}>
                        <Plus className="h-4 w-4 mr-1" />{t("products.addSamplingPlan")}
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {(samplingPlans || []).slice(0, 10).map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                          <span className="truncate mr-2">{item.code} - {item.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-destructive"
                            onClick={() => deleteSamplingPlanMutation.mutate({ id: item.id })}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">{t("products.productViews")}</h4>
                      <Badge variant="secondary">{productViews?.length || 0}</Badge>
                    </div>
                    <div className="space-y-2">
                      <Input
                        placeholder={t("products.code")}
                        value={newViewCode}
                        onChange={(e) => setNewViewCode(e.target.value)}
                      />
                      <Input
                        placeholder={t("products.name")}
                        value={newViewName}
                        onChange={(e) => setNewViewName(e.target.value)}
                      />
                      <Select value={newViewType} onValueChange={(v) => setNewViewType(v as "top" | "bottom" | "side" | "isometric" | "custom")}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("products.viewType")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="top">{t("products.viewTop")}</SelectItem>
                          <SelectItem value="bottom">{t("products.viewBottom")}</SelectItem>
                          <SelectItem value="side">{t("products.viewSide")}</SelectItem>
                          <SelectItem value="isometric">{t("products.viewIsometric")}</SelectItem>
                          <SelectItem value="custom">{t("products.viewCustom")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="w-full" onClick={handleCreateProductView} disabled={createProductViewMutation.isPending}>
                        <Plus className="h-4 w-4 mr-1" />{t("products.addProductView")}
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {(productViews || []).slice(0, 10).map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                          <span className="truncate mr-2">{item.code} - {item.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-destructive"
                            onClick={() => deleteProductViewMutation.mutate({ id: item.id })}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">{t("products.msaStudies")}</h4>
                      <Badge variant="secondary">{msaStudies?.length || 0}</Badge>
                    </div>
                    <div className="space-y-2">
                      <Button size="sm" className="w-full" onClick={openMsaWizard}>
                        <Plus className="h-4 w-4 mr-1" />{t("products.startMsaWizard")}
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {(msaStudies || []).slice(0, 10).map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                          <span className="truncate mr-2">{item.studyCode} - {item.status}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2"
                            onClick={() => {
                              setSelectedMsaStudyId(item.id);
                              setMsaWizardStep(item.status === "completed" ? 3 : 2);
                              setIsMsaDialogOpen(true);
                            }}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              </div>

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

      <Dialog open={isMsaDialogOpen} onOpenChange={setIsMsaDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>P3.6 MSA Wizard (Gage R&R)</DialogTitle>
            <DialogDescription>
              Step {msaWizardStep}/3 — backend scaffold first, UI wizard for study setup, observations and summary.
            </DialogDescription>
          </DialogHeader>

          {msaWizardStep === 1 && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Study Code</Label>
                  <Input value={msaStudyCode} onChange={(e) => setMsaStudyCode(e.target.value)} placeholder="MSA-2026-001" />
                </div>
                <div className="space-y-2">
                  <Label>Study Name</Label>
                  <Input value={msaStudyName} onChange={(e) => setMsaStudyName(e.target.value)} placeholder="Critical Dimension Gage R&R" />
                </div>
                <div className="space-y-2">
                  <Label>Instrument</Label>
                  <Select
                    value={msaInstrumentId?.toString() || "__none"}
                    onValueChange={(value) => setMsaInstrumentId(value === "__none" ? undefined : parseInt(value, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select instrument" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">None</SelectItem>
                      {(measurementInstruments || []).map((inst: any) => (
                        <SelectItem key={inst.id} value={String(inst.id)}>{inst.code} - {inst.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Measurement Point</Label>
                  <Select
                    value={msaMeasurementPointId?.toString() || "__none"}
                    onValueChange={(value) => setMsaMeasurementPointId(value === "__none" ? undefined : parseInt(value, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select point" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">None</SelectItem>
                      {(measurementPoints || []).map((p: any) => (
                        <SelectItem key={p.id ?? p.code} value={String(p.id)}>{p.code} - {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Operator Count</Label>
                  <Input type="number" min={1} value={msaOperatorCount} onChange={(e) => setMsaOperatorCount(Number(e.target.value) || 1)} />
                </div>
                <div className="space-y-2">
                  <Label>Part Count</Label>
                  <Input type="number" min={1} value={msaPartCount} onChange={(e) => setMsaPartCount(Number(e.target.value) || 1)} />
                </div>
                <div className="space-y-2">
                  <Label>Trial Count</Label>
                  <Input type="number" min={1} value={msaTrialCount} onChange={(e) => setMsaTrialCount(Number(e.target.value) || 1)} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsMsaDialogOpen(false)}>Close</Button>
                <Button onClick={handleStartMsaStudy} disabled={startMsaStudyMutation.isPending || !selectedProduct}>
                  {startMsaStudyMutation.isPending ? "Starting..." : "Start Study"}
                </Button>
              </div>
            </div>
          )}

          {msaWizardStep === 2 && (
            <div className="space-y-4 py-2">
              <div className="border rounded-md p-3 bg-muted/10">
                <p className="text-sm font-medium mb-2">Auto-generate matrix</p>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Presets:</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleApplyMsaPreset(10, 1)}>Fine</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleApplyMsaPreset(10, 2)}>Normal</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleApplyMsaPreset(10, 4)}>Coarse</Button>
                </div>
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Base Value</Label>
                    <Input value={msaMatrixBaseValue} onChange={(e) => setMsaMatrixBaseValue(e.target.value)} placeholder="10" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Noise %</Label>
                    <Input value={msaMatrixNoisePct} onChange={(e) => setMsaMatrixNoisePct(e.target.value)} placeholder="2" />
                  </div>
                  <Button variant="secondary" onClick={handleGenerateMsaMatrix} disabled={generateMsaMatrixMutation.isPending}>
                    {generateMsaMatrixMutation.isPending ? "Generating..." : "Generate Matrix"}
                  </Button>
                </div>
                <label className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={msaMatrixOverwriteExisting}
                    onChange={(e) => setMsaMatrixOverwriteExisting(e.target.checked)}
                  />
                  Overwrite existing matrix cells
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={msaAutoAddNext}
                      onChange={(e) => setMsaAutoAddNext(e.target.checked)}
                    />
                    Add & Next mode
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={msaSuggestBaseValue}
                      onChange={(e) => setMsaSuggestBaseValue(e.target.checked)}
                    />
                    Suggest base measured value
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-2">
                  <Label>Operator</Label>
                  <Input value={msaOperatorName} onChange={(e) => setMsaOperatorName(e.target.value)} placeholder="OP-01" />
                </div>
                <div className="space-y-2">
                  <Label>Part</Label>
                  <Input value={msaPartLabel} onChange={(e) => setMsaPartLabel(e.target.value)} placeholder="P-01" />
                </div>
                <div className="space-y-2">
                  <Label>Trial #</Label>
                  <Input type="number" min={1} value={msaTrialNo} onChange={(e) => setMsaTrialNo(Number(e.target.value) || 1)} />
                </div>
                <div className="space-y-2">
                  <Label>Measured Value</Label>
                  <Input value={msaMeasuredValue} onChange={(e) => setMsaMeasuredValue(e.target.value)} placeholder="12.345" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Matrix progress: <span className="font-medium text-foreground">{msaCellStats.filledCells}/{msaCellStats.totalCells}</span>
                </span>
                <Button type="button" variant="outline" size="sm" onClick={handleFillNextMsaCell}>
                  {msaCellStats.nextCell ? `Fill Next: ${msaCellStats.nextCell.operatorName} / ${msaCellStats.nextCell.partLabel} / T${msaCellStats.nextCell.trialNo}` : "Matrix Complete"}
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Shortcuts: Enter = Add, Ctrl+Enter = Add &amp; Next, F2 = Fill Next Cell.
              </p>

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={() => setMsaWizardStep(1)}>Back</Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleAddMsaObservation} disabled={addMsaObservationMutation.isPending}>
                    {addMsaObservationMutation.isPending ? "Adding..." : (msaAutoAddNext ? "Add & Next" : "Add Observation")}
                  </Button>
                  <Button onClick={handleCompleteMsaStudy} disabled={completeMsaStudyMutation.isPending}>
                    {completeMsaStudyMutation.isPending ? "Calculating..." : "Complete Study"}
                  </Button>
                </div>
              </div>

              <div className="border rounded-md p-3 max-h-72 overflow-y-auto">
                <p className="text-sm font-medium mb-2">Observations ({msaStudyData?.observations?.length || 0})</p>
                <div className="space-y-1">
                  {(msaStudyData?.observations || []).slice(-50).map((r: any) => (
                    <div key={r.id} className="text-xs border rounded px-2 py-1 flex items-center justify-between">
                      <span>{r.operatorName} | {r.partLabel} | T{r.trialNo}</span>
                      <span className="font-medium">{r.measuredValue}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border rounded-md p-3 bg-muted/10 space-y-2">
                <p className="text-sm font-medium">Step 9: Paste Grid Import</p>
                <p className="text-xs text-muted-foreground">
                  Paste lines with format: operator, part, trial, value[, notes]. Delimiters: comma, tab or semicolon.
                </p>
                <div className="rounded border bg-background p-2 space-y-2">
                  <p className="text-xs font-medium">Step 10: CSV Upload + Column Mapping</p>
                  <input
                    ref={msaCsvFileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={handleMsaCsvFileSelected}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => msaCsvFileInputRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5 mr-1" />Upload CSV
                    </Button>
                    <Input
                      value={msaCsvSourceKey}
                      onChange={(e) => setMsaCsvSourceKey(e.target.value)}
                      placeholder="Source machine (e.g. AOI-LINE1-CAMTOP)"
                      className="h-8 w-65"
                    />
                    <Input
                      value={msaCsvPresetName}
                      onChange={(e) => setMsaCsvPresetName(e.target.value)}
                      placeholder="Preset name"
                      className="h-8 w-45"
                    />
                    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={msaCsvHasHeader}
                        onChange={(e) => setMsaCsvHasHeader(e.target.checked)}
                      />
                      File has header row
                    </label>
                    <Button type="button" variant="secondary" size="sm" onClick={handleApplyMsaCsvMapping} disabled={msaCsvRows.length === 0}>
                      Apply Mapping
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={handleSaveMsaCsvPreset}>
                      Save Preset
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={msaCsvSelectedPresetKey} onValueChange={handleLoadMsaCsvPreset}>
                      <SelectTrigger className="h-8 w-[320px]"><SelectValue placeholder="Load preset" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">None</SelectItem>
                        {msaCsvPresetOptions.map((preset) => (
                          <SelectItem key={preset.key} value={preset.key}>
                            {preset.source} / {preset.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="sm" onClick={handleDeleteMsaCsvPreset}>
                      Delete Preset
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      Presets are shared via server database by product + source + preset name.
                    </span>
                  </div>

                  {msaCsvRows.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Operator Column</Label>
                        <Select value={String(msaCsvColumnMap.operator)} onValueChange={(v) => setMsaCsvColumnMap((prev) => ({ ...prev, operator: Number(v) }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(msaCsvHeaders.length > 0 ? msaCsvHeaders : (msaCsvRows[0] || []).map((_, i) => `Column ${i + 1}`)).map((name, idx) => (
                              <SelectItem key={`operator-${idx}`} value={String(idx)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Part Column</Label>
                        <Select value={String(msaCsvColumnMap.part)} onValueChange={(v) => setMsaCsvColumnMap((prev) => ({ ...prev, part: Number(v) }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(msaCsvHeaders.length > 0 ? msaCsvHeaders : (msaCsvRows[0] || []).map((_, i) => `Column ${i + 1}`)).map((name, idx) => (
                              <SelectItem key={`part-${idx}`} value={String(idx)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Trial Column</Label>
                        <Select value={String(msaCsvColumnMap.trial)} onValueChange={(v) => setMsaCsvColumnMap((prev) => ({ ...prev, trial: Number(v) }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(msaCsvHeaders.length > 0 ? msaCsvHeaders : (msaCsvRows[0] || []).map((_, i) => `Column ${i + 1}`)).map((name, idx) => (
                              <SelectItem key={`trial-${idx}`} value={String(idx)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Value Column</Label>
                        <Select value={String(msaCsvColumnMap.value)} onValueChange={(v) => setMsaCsvColumnMap((prev) => ({ ...prev, value: Number(v) }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(msaCsvHeaders.length > 0 ? msaCsvHeaders : (msaCsvRows[0] || []).map((_, i) => `Column ${i + 1}`)).map((name, idx) => (
                              <SelectItem key={`value-${idx}`} value={String(idx)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">Notes Column (Optional)</Label>
                        <Select value={String(msaCsvColumnMap.notes)} onValueChange={(v) => setMsaCsvColumnMap((prev) => ({ ...prev, notes: Number(v) }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="-1">None</SelectItem>
                            {(msaCsvHeaders.length > 0 ? msaCsvHeaders : (msaCsvRows[0] || []).map((_, i) => `Column ${i + 1}`)).map((name, idx) => (
                              <SelectItem key={`notes-${idx}`} value={String(idx)}>{name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>

                <Textarea
                  value={msaBatchInput}
                  onChange={(e) => setMsaBatchInput(e.target.value)}
                  placeholder={"OP-01,P-01,1,10.123\nOP-01,P-01,2,10.111\nOP-02,P-01,1,10.146,shift-B"}
                  className="min-h-30"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    Parsed: {msaBatchPreview.total} lines | Valid: {msaBatchPreview.validRows.length} | Invalid: {msaBatchPreview.invalidRows.length}
                  </span>
                  <label className="inline-flex items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={msaBatchSkipDuplicates}
                      onChange={(e) => setMsaBatchSkipDuplicates(e.target.checked)}
                    />
                    Skip duplicates
                  </label>
                </div>
                {msaBatchPreview.invalidRows.length > 0 && (
                  <div className="max-h-24 overflow-y-auto rounded border bg-background p-2 text-xs space-y-1">
                    {msaBatchPreview.invalidRows.slice(0, 20).map((item) => (
                      <p key={`${item.lineNo}-${item.reason}`} className="text-destructive">
                        Line {item.lineNo}: {item.reason}
                      </p>
                    ))}
                  </div>
                )}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleBatchImportMsaObservations}
                    disabled={batchAddMsaObservationsMutation.isPending || msaBatchPreview.validRows.length === 0}
                  >
                    {batchAddMsaObservationsMutation.isPending ? "Importing..." : "Import Valid Rows"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {msaWizardStep === 3 && (
            <div className="space-y-4 py-2">
              <div className="border rounded-md p-4 bg-muted/20">
                <p className="text-sm font-medium mb-2">MSA Summary</p>
                {(() => {
                  const summary = msaLastSummary || msaStudyData?.study?.summary;
                  if (!summary) return <p className="text-sm text-muted-foreground">No summary available yet.</p>;
                  const ev = Number(summary.repeatabilityEV ?? 0);
                  const av = Number(summary.reproducibilityAV ?? 0);
                  const grr = Number(summary.grr ?? 0);
                  const maxBar = Math.max(ev, av, grr, 1e-9);
                  const evPct = (ev / maxBar) * 100;
                  const avPct = (av / maxBar) * 100;
                  const grrPctBar = (grr / maxBar) * 100;
                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <p>Sample Size: <span className="font-medium">{summary.sampleSize ?? 0}</span></p>
                        <p>Average: <span className="font-medium">{Number(summary.avg ?? 0).toFixed(4)}</span></p>
                        <p>Std Dev: <span className="font-medium">{Number(summary.stdDev ?? 0).toFixed(4)}</span></p>
                        <p>GRR%: <span className="font-medium">{Number(summary.grrPct ?? 0).toFixed(2)}%</span></p>
                        <p>NDC: <span className="font-medium">{summary.ndc ?? "-"}</span></p>
                        <p>Verdict: <Badge variant={summary.verdict === "good" ? "default" : summary.verdict === "acceptable" ? "secondary" : "destructive"}>{summary.verdict || "unknown"}</Badge></p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-medium">EV / AV / GRR visualization</p>
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs"><span>EV</span><span>{ev.toFixed(4)}</span></div>
                            <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${Math.max(2, evPct)}%` }} /></div>
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs"><span>AV</span><span>{av.toFixed(4)}</span></div>
                            <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${Math.max(2, avPct)}%` }} /></div>
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs"><span>GRR</span><span>{grr.toFixed(4)}</span></div>
                            <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-amber-500" style={{ width: `${Math.max(2, grrPctBar)}%` }} /></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setMsaWizardStep(2)}>Back</Button>
                <Button onClick={() => setIsMsaDialogOpen(false)}>Done</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={isEditProductDialogOpen} onOpenChange={setIsEditProductDialogOpen}>
          <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("products.editTitle")}</DialogTitle>
            <DialogDescription>{t("products.editDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editProductCode">{t("products.productCodeLabel")}</Label>
              <Input
                id="editProductCode"
                value={editProductCode}
                onChange={(e) => setEditProductCode(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProductName">{t("products.productNameLabel")}</Label>
              <Input
                id="editProductName"
                value={editProductName}
                onChange={(e) => setEditProductName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProductDescription">{t("products.descriptionLabel")}</Label>
              <Textarea
                id="editProductDescription"
                value={editProductDescription}
                onChange={(e) => setEditProductDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="editProductCategory">{t("common.category")}</Label>
                <Input
                  id="editProductCategory"
                  value={editProductCategory}
                  onChange={(e) => setEditProductCategory(e.target.value)}
                  placeholder={t("products.categoryPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editProductLine">{t("products.productLine")}</Label>
                <Input
                  id="editProductLine"
                  value={editProductLine}
                  onChange={(e) => setEditProductLine(e.target.value)}
                  placeholder={t("products.linePlaceholder")}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="editProductVariant">{t("products.variant")}</Label>
                <Input
                  id="editProductVariant"
                  value={editProductVariant}
                  onChange={(e) => setEditProductVariant(e.target.value)}
                  placeholder={t('products.variantExample')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editProductLifecycle">{t("common.status")}</Label>
                <Select value={editProductLifecycle} onValueChange={(value: any) => setEditProductLifecycle(value)}>
                  <SelectTrigger id="editProductLifecycle">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="development">{t("products.development")}</SelectItem>
                    <SelectItem value="active">{t("products.activeStatus")}</SelectItem>
                    <SelectItem value="eol">{t("products.endOfLife")}</SelectItem>
                    <SelectItem value="archived">{t("products.archived")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="editProductTargetYield">{t("products.targetYieldLabel")}</Label>
                <Input
                  id="editProductTargetYield"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={editProductTargetYield}
                  onChange={(e) => setEditProductTargetYield(e.target.value)}
                  placeholder="95.5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editProductMinYield">{t("products.minYieldLabel")}</Label>
                <Input
                  id="editProductMinYield"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={editProductMinYield}
                  onChange={(e) => setEditProductMinYield(e.target.value)}
                  placeholder="85.0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("products.imageDisplayModeLabel")}</Label>
              <Select value={editProductDisplayMode} onValueChange={(value: any) => setEditProductDisplayMode(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contain">{t("products.displayContain")}</SelectItem>
                  <SelectItem value="cover">{t("products.displayCover")}</SelectItem>
                  <SelectItem value="stretch">{t("products.displayStretch")}</SelectItem>
                  <SelectItem value="none">{t("products.displayNone")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProductImage">{t("products.newReferenceImage")}</Label>
              <Input
                id="editProductImage"
                type="file"
                accept="image/*"
                onChange={handleEditImageUpload}
              />
              {editProductImageUrl && (
                <img
                  src={editProductImageUrl}
                  alt="Preview"
                  className="mt-2 max-h-32 rounded border"
                />
              )}
              {!editProductImageUrl && selectedProduct?.referenceImageUrl && (
                <div className="mt-2">
                  <p className="text-sm text-muted-foreground mb-1">{t("products.currentImage")}:</p>
                  <img
                    src={selectedProduct.referenceImageUrl}
                    alt="Current"
                    className="max-h-32 rounded border"
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditProductDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleUpdateProduct} disabled={updateProductMutation.isPending}>
              {updateProductMutation.isPending ? t("products.saving") : t("products.saveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Product Confirmation */}
      <DeleteConfirmDialog
        open={isDeleteProductDialogOpen}
        onOpenChange={setIsDeleteProductDialogOpen}
        itemType={t("products.productItemType")}
        itemName={selectedProduct?.name}
        onConfirm={handleDeleteProduct}
        isLoading={deleteProductMutation.isPending}
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

      {/* Template Dialog */}
      <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              {t("products.manageTemplates")}
            </DialogTitle>
            <DialogDescription>
              {t("products.templateDialogDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Save as Template Section */}
            <div className="space-y-4 border-b pb-4">
              <h4 className="font-medium">{t("products.saveAsNewTemplate")}</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("products.templateNameLabel")}</Label>
                  <Input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder={t('products.templateNameExample')}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("common.category")}</Label>
                  <Select value={templateCategory} onValueChange={setTemplateCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("products.selectCategory")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="electronics">{t("products.catElectronics")}</SelectItem>
                      <SelectItem value="mechanical">{t("products.catMechanical")}</SelectItem>
                      <SelectItem value="assembly">{t("products.catAssembly")}</SelectItem>
                      <SelectItem value="general">{t("products.catGeneral")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("products.descriptionLabel")}</Label>
                <Textarea
                  value={templateDescription}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                  placeholder={t("products.templateDescPlaceholder")}
                  rows={2}
                />
              </div>
              <Button
                onClick={handleSaveAsTemplate}
                disabled={isSavingTemplate || measurementPoints.length === 0}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                {t("products.savePointsAsTemplate", { count: measurementPoints.length })}
              </Button>
            </div>

            {/* Apply Template Section */}
            <div className="space-y-4">
              <h4 className="font-medium">{t("products.applyExistingTemplate")}</h4>
              <ScrollArea className="h-50 border rounded-md p-2">
                {templates && templates.length > 0 ? (
                  <div className="space-y-2">
                    {templates.map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50"
                      >
                        <div>
                          <div className="font-medium">{template.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {template.category} • {template.description || t("products.noDescription")}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleApplyTemplate(template)}
                            className="gap-1"
                          >
                            <Download className="h-3 w-3" />
                            {t("common.apply")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteTemplateMutation.mutate({ id: template.id })}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    {t("products.noTemplatesYet")}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTemplateDialogOpen(false)}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
