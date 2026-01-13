import { useState, useEffect, useRef, useCallback } from "react";
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
import { Plus, Package, Target, Upload, Trash2, Edit, Eye, MousePointer, Circle, Save, X, Move, ZoomIn, ZoomOut, MoreVertical, Copy, Image as ImageIcon, FileSpreadsheet } from "lucide-react";
import { BulkImportDialog } from "@/components/BulkImportDialog";
import { navItems } from "@/lib/navigation";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
}

export default function ProductModels() {
  const { user, loading: authLoading } = useAuth();
  const [selectedProduct, setSelectedProduct] = useState<ProductModel | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditProductDialogOpen, setIsEditProductDialogOpen] = useState(false);
  const [isDeleteProductDialogOpen, setIsDeleteProductDialogOpen] = useState(false);
  const [isBulkImportDialogOpen, setIsBulkImportDialogOpen] = useState(false);
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
  const [newProductLine, setNewProductLine] = useState("");
  const [newProductVariant, setNewProductVariant] = useState("");
  const [newProductLifecycle, setNewProductLifecycle] = useState<"development" | "active" | "eol" | "archived">("active");
  const [newProductTargetYield, setNewProductTargetYield] = useState("");
  const [newProductMinYield, setNewProductMinYield] = useState("");
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");

  // Edit product form states
  const [editProductCode, setEditProductCode] = useState("");
  const [editProductName, setEditProductName] = useState("");
  const [editProductDescription, setEditProductDescription] = useState("");
  const [editProductCategory, setEditProductCategory] = useState("");
  const [editProductLine, setEditProductLine] = useState("");
  const [editProductVariant, setEditProductVariant] = useState("");
  const [editProductLifecycle, setEditProductLifecycle] = useState<"development" | "active" | "eol" | "archived">("active");
  const [editProductTargetYield, setEditProductTargetYield] = useState("");
  const [editProductMinYield, setEditProductMinYield] = useState("");
  const [editProductImageUrl, setEditProductImageUrl] = useState("");

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

  const { data: productModels, refetch: refetchProducts } = trpc.productModel.list.useQuery();
  const { data: points, refetch: refetchPoints } = trpc.measurementPoint.listByProductModel.useQuery(
    { productModelId: selectedProduct?.id || 0 },
    { enabled: !!selectedProduct }
  );

  const createProductMutation = trpc.productModel.create.useMutation({
    onSuccess: () => {
      toast.success("Tạo sản phẩm thành công");
      refetchProducts();
      setIsCreateDialogOpen(false);
      resetProductForm();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const updateProductMutation = trpc.productModel.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật sản phẩm thành công");
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
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const deleteProductMutation = trpc.productModel.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa sản phẩm thành công");
      refetchProducts();
      setIsDeleteProductDialogOpen(false);
      setSelectedProduct(null);
    },
    onError: (error: { message: string }) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const createPointMutation = trpc.measurementPoint.create.useMutation({
    onSuccess: () => {
      toast.success("Tạo điểm đo thành công");
      refetchPoints();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const updatePointMutation = trpc.measurementPoint.update.useMutation({
    onSuccess: () => {
      toast.success("Cập nhật điểm đo thành công");
      refetchPoints();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const deletePointMutation = trpc.measurementPoint.delete.useMutation({
    onSuccess: () => {
      toast.success("Xóa điểm đo thành công");
      refetchPoints();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const uploadCroppedImageMutation = trpc.measurementPoint.uploadCroppedImage.useMutation({
    onSuccess: (data) => {
      toast.success("Đã lưu ảnh mẫu vùng cắt thành công");
      setPointReferenceImageUrl(data.imageUrl);
      refetchPoints();
    },
    onError: (error) => {
      toast.error(`Lỗi upload ảnh: ${error.message}`);
    },
  });

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
    setSelectedPointIndex(null);
  };

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
        name: `Điểm đo ${measurementPoints.length + 1}`,
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
    if (!newProductCode || !newProductName) {
      toast.error("Vui lòng nhập mã và tên sản phẩm");
      return;
    }

    createProductMutation.mutate({
      code: newProductCode,
      name: newProductName,
      description: newProductDescription || undefined,
      category: newProductCategory || undefined,
      productLine: newProductLine || undefined,
      variant: newProductVariant || undefined,
      lifecycleStatus: newProductLifecycle,
      targetYieldRate: newProductTargetYield || undefined,
      minYieldRate: newProductMinYield || undefined,
      referenceImageUrl: uploadedImageUrl || undefined,
    });
  };

  const handleUpdateProduct = () => {
    if (!selectedProduct || !editProductCode || !editProductName) {
      toast.error("Vui lòng nhập mã và tên sản phẩm");
      return;
    }

    updateProductMutation.mutate({
      id: selectedProduct.id,
      code: editProductCode,
      name: editProductName,
      description: editProductDescription || undefined,
      referenceImageUrl: editProductImageUrl || undefined,
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
    setEditProductImageUrl("");
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
    };

    if (point.id) {
      // Update existing point
      updatePointMutation.mutate({
        id: point.id,
        ...pointData,
      });

      // Auto crop and upload reference image if image is loaded
      if (imageRef.current && pointCropWidth > 0 && pointCropHeight > 0) {
        const croppedBase64 = cropImageFromCanvas(point.positionX, point.positionY, pointCropWidth, pointCropHeight);
        if (croppedBase64) {
          uploadCroppedImageMutation.mutate({
            pointId: point.id,
            imageBase64: croppedBase64,
            mimeType: 'image/png',
          });
        }
      }
    } else {
      // Create new point
      createPointMutation.mutate({
        productModelId: selectedProduct.id,
        ...pointData,
      });
    }

    // Update local state
    const updatedPoints = [...measurementPoints];
    updatedPoints[selectedPointIndex] = {
      ...point,
      ...pointData,
    };
    setMeasurementPoints(updatedPoints);
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
    toast.success("Đã sao chép điểm đo");
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

  const handlePointImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setPointReferenceImageUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  if (authLoading) {
    return (
      <DashboardLayout title="Quản lý sản phẩm" navItems={navItems} currentPath="/products">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Quản lý sản phẩm" navItems={navItems} currentPath="/products">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product List */}
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg">Danh sách sản phẩm</CardTitle>
              <CardDescription>Chọn sản phẩm để quản lý điểm đo</CardDescription>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                  <Plus className="h-4 w-4" />
                  Thêm
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Tạo sản phẩm mới</DialogTitle>
                  <DialogDescription>
                    Thêm mẫu sản phẩm mới với ảnh tham chiếu
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="productCode">Mã sản phẩm</Label>
                    <Input
                      id="productCode"
                      value={newProductCode}
                      onChange={(e) => setNewProductCode(e.target.value)}
                      placeholder="VD: PCB-001"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productName">Tên sản phẩm</Label>
                    <Input
                      id="productName"
                      value={newProductName}
                      onChange={(e) => setNewProductName(e.target.value)}
                      placeholder="VD: Main Board v1.0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productDescription">Mô tả</Label>
                    <Textarea
                      id="productDescription"
                      value={newProductDescription}
                      onChange={(e) => setNewProductDescription(e.target.value)}
                      placeholder="Mô tả sản phẩm..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productImage">Ảnh tham chiếu</Label>
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
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Hủy
                  </Button>
                  <Button onClick={handleCreateProduct} disabled={createProductMutation.isPending}>
                    {createProductMutation.isPending ? "Đang tạo..." : "Tạo sản phẩm"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
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
                            Chỉnh sửa
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
                            Xóa
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
                {(!productModels || productModels.length === 0) && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Chưa có sản phẩm nào</p>
                    <p className="text-sm">Nhấn "Thêm" để tạo sản phẩm mới</p>
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
                {selectedProduct ? `Điểm đo - ${selectedProduct.name}` : "Chọn sản phẩm"}
              </CardTitle>
              <CardDescription>
                {selectedProduct
                  ? `${measurementPoints.length} điểm đo đã định nghĩa`
                  : "Chọn một sản phẩm từ danh sách bên trái"}
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
                      {isDrawing ? "Đang vẽ..." : "Thêm điểm"}
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
                      Đóng
                    </Button>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setIsBulkImportDialogOpen(true)} className="gap-1">
                      <FileSpreadsheet className="h-4 w-4" />
                      Import Excel
                    </Button>
                    <Button size="sm" onClick={() => setIsEditMode(true)} className="gap-1">
                      <Edit className="h-4 w-4" />
                      Chỉnh sửa
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {selectedProduct ? (
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
                        <span className="text-sm text-muted-foreground">Bán kính:</span>
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

                  <div className="relative border rounded-lg overflow-auto bg-muted/30 max-h-[500px]">
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
                          <p>Chưa có ảnh tham chiếu</p>
                          <p className="text-sm">Cập nhật ảnh trong phần chỉnh sửa sản phẩm</p>
                        </div>
                      </div>
                    )}
                    {isDrawing && (
                      <div className="absolute top-2 left-2 bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm">
                        Click để đặt điểm đo
                      </div>
                    )}
                    {isDragging && (
                      <div className="absolute top-2 left-2 bg-warning text-warning-foreground px-3 py-1 rounded-full text-sm">
                        <Move className="h-4 w-4 inline mr-1" />
                        Đang di chuyển điểm
                      </div>
                    )}
                  </div>

                  {/* Point List */}
                  <div className="mt-4">
                    <h4 className="text-sm font-medium mb-2">Danh sách điểm đo ({measurementPoints.length}/50)</h4>
                    <div className="flex flex-wrap gap-2">
                      {measurementPoints.map((point, index) => (
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
                    <ScrollArea className="h-[550px]">
                      <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium">Chi tiết điểm đo #{selectedPointIndex + 1}</h4>
                          {isEditMode && (
                            <Button size="sm" variant="ghost" onClick={handleDuplicatePoint}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="pointCode">Mã điểm đo</Label>
                          <Input
                            id="pointCode"
                            value={pointCode}
                            onChange={(e) => setPointCode(e.target.value)}
                            disabled={!isEditMode}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointName">Tên điểm đo</Label>
                          <Input
                            id="pointName"
                            value={pointName}
                            onChange={(e) => setPointName(e.target.value)}
                            disabled={!isEditMode}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointType">Loại đo</Label>
                          <Select
                            value={pointType}
                            onValueChange={(v) => setPointType(v as MeasurementPoint["measurementType"])}
                            disabled={!isEditMode}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="VISUAL">Kiểm tra hình ảnh</SelectItem>
                              <SelectItem value="DIMENSION">Kích thước</SelectItem>
                              <SelectItem value="POSITION">Vị trí</SelectItem>
                              <SelectItem value="COLOR">Màu sắc</SelectItem>
                              <SelectItem value="SURFACE">Bề mặt</SelectItem>
                              <SelectItem value="ELECTRICAL">Điện</SelectItem>
                              <SelectItem value="OTHER">Khác</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="pointDescription">Mô tả</Label>
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
                                <Label htmlFor="pointLowerLimit">Giới hạn dưới</Label>
                                <Input
                                  id="pointLowerLimit"
                                  value={pointLowerLimit}
                                  onChange={(e) => setPointLowerLimit(e.target.value)}
                                  disabled={!isEditMode}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="pointUpperLimit">Giới hạn trên</Label>
                                <Input
                                  id="pointUpperLimit"
                                  value={pointUpperLimit}
                                  onChange={(e) => setPointUpperLimit(e.target.value)}
                                  disabled={!isEditMode}
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="pointNominalValue">Giá trị danh nghĩa</Label>
                              <Input
                                id="pointNominalValue"
                                value={pointNominalValue}
                                onChange={(e) => setPointNominalValue(e.target.value)}
                                disabled={!isEditMode}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="pointUnit">Đơn vị</Label>
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
                          <Label>Ảnh mẫu điểm đo</Label>
                          {isEditMode && (
                            <Input
                              type="file"
                              accept="image/*"
                              onChange={handlePointImageUpload}
                              className="text-sm"
                            />
                          )}
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
                              Chưa có ảnh mẫu
                            </div>
                          )}
                        </div>

                        <div className="text-sm text-muted-foreground p-2 bg-muted/30 rounded">
                          <p>Vị trí: ({measurementPoints[selectedPointIndex]?.positionX}, {measurementPoints[selectedPointIndex]?.positionY})</p>
                          <p>Bán kính: {measurementPoints[selectedPointIndex]?.radius}px</p>
                        </div>

                        {/* Vùng cắt ảnh mẫu */}
                        <div className="space-y-2 border-t pt-3 mt-3">
                          <Label className="text-sm font-medium">Vùng cắt ảnh mẫu (tâm là điểm đo)</Label>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label htmlFor="cropWidth" className="text-xs text-muted-foreground">Rộng (px)</Label>
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
                              <Label htmlFor="cropHeight" className="text-xs text-muted-foreground">Cao (px)</Label>
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
                          <p className="text-xs text-muted-foreground">
                            Khi thêm điểm đo, hệ thống sẽ tự động cắt ảnh mẫu từ ảnh sản phẩm với tâm là vị trí điểm đo.
                          </p>
                        </div>

                        {isEditMode && (
                          <div className="flex gap-2 pt-2">
                            <Button size="sm" onClick={handleSavePoint} className="flex-1">
                              <Save className="h-4 w-4 mr-1" />
                              Lưu
                            </Button>
                            <Button size="sm" variant="destructive" onClick={handleDeletePoint}>
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
                        <p className="text-sm">Chọn một điểm đo để xem chi tiết</p>
                        {isEditMode && (
                          <p className="text-xs mt-1">Hoặc click "Thêm điểm" rồi click trên ảnh</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                <div className="text-center">
                  <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Chọn một sản phẩm để quản lý điểm đo</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Product Dialog */}
      <Dialog open={isEditProductDialogOpen} onOpenChange={setIsEditProductDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa sản phẩm</DialogTitle>
            <DialogDescription>
              Cập nhật thông tin sản phẩm
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editProductCode">Mã sản phẩm</Label>
              <Input
                id="editProductCode"
                value={editProductCode}
                onChange={(e) => setEditProductCode(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProductName">Tên sản phẩm</Label>
              <Input
                id="editProductName"
                value={editProductName}
                onChange={(e) => setEditProductName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProductDescription">Mô tả</Label>
              <Textarea
                id="editProductDescription"
                value={editProductDescription}
                onChange={(e) => setEditProductDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProductImage">Ảnh tham chiếu mới (tùy chọn)</Label>
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
                  <p className="text-sm text-muted-foreground mb-1">Ảnh hiện tại:</p>
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
            <Button variant="outline" onClick={() => setIsEditProductDialogOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleUpdateProduct} disabled={updateProductMutation.isPending}>
              {updateProductMutation.isPending ? "Đang lưu..." : "Lưu thay đổi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Product Confirmation */}
      <AlertDialog open={isDeleteProductDialogOpen} onOpenChange={setIsDeleteProductDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa sản phẩm</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc chắn muốn xóa sản phẩm "{selectedProduct?.name}"? 
              Tất cả điểm đo liên quan cũng sẽ bị xóa. Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteProduct}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteProductMutation.isPending ? "Đang xóa..." : "Xóa sản phẩm"}
            </AlertDialogAction>
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
    </DashboardLayout>
  );
}
