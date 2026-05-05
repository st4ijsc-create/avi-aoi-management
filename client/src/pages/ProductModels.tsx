import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
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
  orderIndex: number;
  referenceImageUrl?: string;
  cropWidth: number; // Chiều rộng vùng cắt ảnh mẫu
  cropHeight: number; // Chiều cao vùng cắt ảnh mẫu
  workstationId?: number;
}

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

export default function ProductModels() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
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
  const [pointReferenceImageUrl, setPointReferenceImageUrl] = useState("");
  const [pointCropWidth, setPointCropWidth] = useState(100);
  const [pointCropHeight, setPointCropHeight] = useState(100);
  const [pointSearchQuery, setPointSearchQuery] = useState("");
  const [pointTypeFilter, setPointTypeFilter] = useState<"all" | MeasurementPoint["measurementType"]>("all");
  const [pointWorkstationId, setPointWorkstationId] = useState<number | undefined>(undefined);
  const [isSavingPoint, setIsSavingPoint] = useState(false);
  const [imageSourceMode, setImageSourceMode] = useState<"upload" | "auto-crop">("auto-crop");
  
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
    setPointReferenceImageUrl("");
    setPointCropWidth(100);
    setPointCropHeight(100);
    setPointWorkstationId(undefined);
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
        orderIndex: p.orderIndex || index,
        referenceImageUrl: p.referenceImageUrl || undefined,
        cropWidth: (p as any).cropWidth || 100,
        cropHeight: (p as any).cropHeight || 100,
        workstationId: (p as any).workstationId || undefined,
      })));
    }
  }, [points]);

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

      // Draw point number
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.max(12, r * 0.7)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 3;
      ctx.fillText(String(index + 1), x, y);
      ctx.shadowBlur = 0;
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
      unit: pointUnit || undefined,
      lowerLimit: pointLowerLimit || undefined,
      upperLimit: pointUpperLimit || undefined,
      nominalValue: pointNominalValue || undefined,
      positionX: point.positionX,
      positionY: point.positionY,
      radius: pointRadius,
      orderIndex: selectedPointIndex,
      referenceImageUrl: pointReferenceImageUrl || undefined,
      cropWidth: pointCropWidth,
      cropHeight: pointCropHeight,
      workstationId: pointWorkstationId,
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

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
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
                      <canvas
                        ref={canvasRef}
                        onClick={handleCanvasClick}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseLeave={handleCanvasMouseUp}
                        className={`${isEditMode ? (isDrawing ? "cursor-crosshair" : "cursor-move") : "cursor-default"}`}
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
                          <Label htmlFor="pointDescription">{t("products.descriptionLabel")}</Label>
                          <Textarea
                            id="pointDescription"
                            value={pointDescription}
                            onChange={(e) => setPointDescription(e.target.value)}
                            disabled={!isEditMode}
                            rows={2}
                          />
                        </div>

                        {(pointType === "DIMENSION" || pointType === "ELECTRICAL") && (
                          <>
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

                        <div className="text-sm text-muted-foreground p-2 bg-muted/30 rounded">
                          <p>{t("products.position")}: ({measurementPoints[selectedPointIndex]?.positionX}, {measurementPoints[selectedPointIndex]?.positionY})</p>
                          <p>{t("products.radius")}: {measurementPoints[selectedPointIndex]?.radius}px</p>
                        </div>

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
