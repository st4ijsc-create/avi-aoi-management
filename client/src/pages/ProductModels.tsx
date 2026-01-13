import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Plus, Package, Target, Upload, Trash2, Edit, Eye, MousePointer, Circle, Save, X } from "lucide-react";
import { navItems } from "@/lib/navigation";

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
}

interface ProductModel {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  referenceImageUrl?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

export default function ProductModels() {
  const { user, loading: authLoading } = useAuth();
  const [selectedProduct, setSelectedProduct] = useState<ProductModel | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [scale, setScale] = useState(1);

  // Form states
  const [newProductCode, setNewProductCode] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");

  // Point form states
  const [pointCode, setPointCode] = useState("");
  const [pointName, setPointName] = useState("");
  const [pointDescription, setPointDescription] = useState("");
  const [pointType, setPointType] = useState<MeasurementPoint["measurementType"]>("VISUAL");
  const [pointUnit, setPointUnit] = useState("");
  const [pointLowerLimit, setPointLowerLimit] = useState("");
  const [pointUpperLimit, setPointUpperLimit] = useState("");
  const [pointNominalValue, setPointNominalValue] = useState("");

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

  const resetProductForm = () => {
    setNewProductCode("");
    setNewProductName("");
    setNewProductDescription("");
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

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Draw measurement points
    measurementPoints.forEach((point, index) => {
      const x = point.positionX * scale;
      const y = point.positionY * scale;
      const r = point.radius * scale;

      // Draw circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = selectedPointIndex === index ? "#10b981" : "#06b6d4";
      ctx.lineWidth = selectedPointIndex === index ? 3 : 2;
      ctx.stroke();

      // Draw fill with transparency
      ctx.fillStyle = selectedPointIndex === index ? "rgba(16, 185, 129, 0.2)" : "rgba(6, 182, 212, 0.1)";
      ctx.fill();

      // Draw point number
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.max(12, r * 0.8)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), x, y);
    });
  }, [measurementPoints, selectedPointIndex, scale, imageLoaded]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

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
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;

    if (isDrawing) {
      // Add new point
      const newPoint: MeasurementPoint = {
        code: `MP-${String(measurementPoints.length + 1).padStart(3, "0")}`,
        name: `Điểm đo ${measurementPoints.length + 1}`,
        measurementType: "VISUAL",
        positionX: Math.round(x),
        positionY: Math.round(y),
        radius: 20,
        orderIndex: measurementPoints.length,
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
      } else {
        setSelectedPointIndex(null);
        resetPointForm();
      }
    }
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
      referenceImageUrl: uploadedImageUrl || undefined,
    });
  };

  const handleSavePoint = () => {
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
      radius: point.radius,
      orderIndex: selectedPointIndex,
    };

    if (point.id) {
      // Update existing point
      updatePointMutation.mutate({
        id: point.id,
        ...pointData,
      });
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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // For now, create a local URL - in production this would upload to S3
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setUploadedImageUrl(dataUrl);
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
                  <Button size="sm" onClick={() => setIsEditMode(true)} className="gap-1">
                    <Edit className="h-4 w-4" />
                    Chỉnh sửa
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {selectedProduct ? (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {/* Canvas Area */}
                <div className="xl:col-span-2">
                  <div className="relative border rounded-lg overflow-hidden bg-muted/30">
                    {selectedProduct.referenceImageUrl ? (
                      <canvas
                        ref={canvasRef}
                        onClick={handleCanvasClick}
                        className={`max-w-full ${isEditMode ? "cursor-crosshair" : "cursor-default"}`}
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
                    <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                      <h4 className="font-medium">Chi tiết điểm đo #{selectedPointIndex + 1}</h4>
                      
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

                      <div className="text-sm text-muted-foreground">
                        Vị trí: ({measurementPoints[selectedPointIndex]?.positionX}, {measurementPoints[selectedPointIndex]?.positionY})
                        <br />
                        Bán kính: {measurementPoints[selectedPointIndex]?.radius}px
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
    </DashboardLayout>
  );
}
