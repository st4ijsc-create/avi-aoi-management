import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Image as ImageIcon,
  Cpu,
  Calendar,
  Brain,
  MessageSquare,
  Loader2,
  ZoomIn,
  SplitSquareVertical,
  Target,
  Edit3,
  Save
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import { format } from "date-fns";

interface MeasurementPoint {
  id: number;
  pointDefId: number;
  result: string;
  measuredValue: string | null;
  imageUrl: string | null;
  remark: string | null;
  aiAnalysisResult: string | null;
  aiConfidence: string | null;
  referenceImageUrl?: string | null;
  pointCode?: string;
  pointName?: string;
  x?: number;
  y?: number;
}

export default function InspectionDetail() {
  const params = useParams<{ id: string }>();
  const inspectionId = parseInt(params.id || "0");
  
  const [ntfReason, setNtfReason] = useState("");
  const [ntfDialogOpen, setNtfDialogOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedMeasurement, setSelectedMeasurement] = useState<MeasurementPoint | null>(null);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [correctDialogOpen, setCorrectDialogOpen] = useState(false);
  const [correctResult, setCorrectResult] = useState<"OK" | "NG" | "NTF">("OK");
  const [correctReason, setCorrectReason] = useState("");
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  const { data, isLoading, refetch } = trpc.inspection.getById.useQuery(
    { id: inspectionId },
    { enabled: inspectionId > 0 }
  );

  const { data: productModelData } = trpc.productModel.getByCode.useQuery(
    { code: data?.inspection?.productModel || "" },
    { enabled: !!data?.inspection?.productModel }
  );

  const confirmNTFMutation = trpc.inspection.confirmNTF.useMutation({
    onSuccess: () => {
      toast.success("Đã xác nhận NTF thành công");
      setNtfDialogOpen(false);
      setNtfReason("");
      refetch();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const correctResultMutation = trpc.measurementResult.correctResult.useMutation({
    onSuccess: () => {
      toast.success("Đã cập nhật kết quả thành công");
      setCorrectDialogOpen(false);
      setCorrectReason("");
      setSelectedMeasurement(null);
      refetch();
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const analyzeWithAIMutation = trpc.measurementResult.analyzeWithAI.useMutation({
    onSuccess: () => {
      toast.success("Phân tích AI hoàn tất");
      refetch();
    },
    onError: (error) => {
      toast.error(`Lỗi phân tích: ${error.message}`);
    },
    onSettled: () => {
      setAnalyzingId(null);
    },
  });

  const handleConfirmNTF = () => {
    if (!ntfReason.trim()) {
      toast.error("Vui lòng nhập lý do xác nhận NTF");
      return;
    }
    confirmNTFMutation.mutate({ id: inspectionId, reason: ntfReason });
  };

  const handleCorrectResult = () => {
    if (!selectedMeasurement) return;
    correctResultMutation.mutate({
      id: selectedMeasurement.id,
      result: correctResult,
      reason: correctReason,
    });
  };

  const handleAnalyzeWithAI = (measurementId: number) => {
    setAnalyzingId(measurementId);
    analyzeWithAIMutation.mutate({ id: measurementId });
  };

  const getResultColor = (result: string) => {
    switch (result) {
      case "OK": return "#22c55e";
      case "NG": return "#ef4444";
      case "NTF": return "#f97316";
      default: return "#6b7280";
    }
  };

  const getResultBadge = (result: string, size: "sm" | "lg" = "sm") => {
    const baseClass = size === "lg" ? "text-base px-4 py-2" : "";
    switch (result) {
      case "OK":
        return (
          <Badge className={`status-ok gap-1 ${baseClass}`}>
            <CheckCircle2 className={size === "lg" ? "h-5 w-5" : "h-3 w-3"} />
            OK
          </Badge>
        );
      case "NG":
        return (
          <Badge className={`status-ng gap-1 ${baseClass}`}>
            <XCircle className={size === "lg" ? "h-5 w-5" : "h-3 w-3"} />
            NG
          </Badge>
        );
      case "NTF":
        return (
          <Badge className={`status-ntf gap-1 ${baseClass}`}>
            <AlertTriangle className={size === "lg" ? "h-5 w-5" : "h-3 w-3"} />
            NTF
          </Badge>
        );
      default:
        return <Badge variant="secondary">{result}</Badge>;
    }
  };

  // Merge measurement results with point definitions to get coordinates
  const measurementsWithCoords = useMemo(() => {
    if (!data?.measurements || !productModelData?.measurementPoints) {
      return data?.measurements || [];
    }
    
    return data.measurements.map((m: MeasurementPoint) => {
      const pointDef = productModelData.measurementPoints.find(
        (p: { id: number }) => p.id === m.pointDefId
      );
      return {
        ...m,
        x: pointDef?.positionX,
        y: pointDef?.positionY,
        pointCode: pointDef?.code,
        pointName: pointDef?.name,
        referenceImageUrl: pointDef?.referenceImageUrl,
      };
    });
  }, [data?.measurements, productModelData?.measurementPoints]);

  // Handle image load to get dimensions
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
  };

  if (isLoading) {
    return (
      <DashboardLayout title="AVI/AOI Management" navItems={navItems} currentPath="/history">
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout title="AVI/AOI Management" navItems={navItems} currentPath="/history">
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <p className="text-muted-foreground">Không tìm thấy kết quả kiểm tra</p>
          <Link href="/history">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Quay lại
            </Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  const { inspection, measurements, machine } = data;

  return (
    <DashboardLayout title="AVI/AOI Management" navItems={navItems} currentPath="/history">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/history">
              <Button variant="outline" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Chi tiết kiểm tra</h1>
              <p className="text-muted-foreground">SN: {inspection.serialNumber}</p>
            </div>
          </div>
          
          {inspection.overallResult === "NG" && inspection.originalResult === "NG" && (
            <Dialog open={ntfDialogOpen} onOpenChange={setNtfDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2 border-warning text-warning hover:bg-warning/10">
                  <AlertTriangle className="h-4 w-4" />
                  Xác nhận NTF
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Xác nhận Not True Fail (NTF)</DialogTitle>
                  <DialogDescription>
                    Xác nhận rằng kết quả NG này là do máy bắt sai (sản phẩm thực tế OK)
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Lý do xác nhận NTF</label>
                    <Textarea
                      placeholder="Nhập lý do xác nhận NTF..."
                      value={ntfReason}
                      onChange={(e) => setNtfReason(e.target.value)}
                      rows={4}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setNtfDialogOpen(false)}>
                    Hủy
                  </Button>
                  <Button 
                    onClick={handleConfirmNTF}
                    disabled={confirmNTFMutation.isPending}
                    className="gap-2"
                  >
                    {confirmNTFMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Xác nhận NTF
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Inspection Info */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="glass-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Thông tin kiểm tra</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Serial Number</p>
                  <p className="font-semibold text-foreground">{inspection.serialNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Kết quả</p>
                  <div className="mt-1">{getResultBadge(inspection.overallResult, "lg")}</div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Kết quả gốc</p>
                  <div className="mt-1">{getResultBadge(inspection.originalResult)}</div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Thời gian kiểm tra</p>
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {format(new Date(inspection.inspectionTime), "dd/MM/yyyy HH:mm:ss")}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Model sản phẩm</p>
                  <p className="font-medium text-foreground">{inspection.productModel || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Batch Number</p>
                  <p className="font-medium text-foreground">{inspection.batchNumber || "-"}</p>
                </div>
              </div>

              {inspection.ntfReason && (
                <div className="mt-6 p-4 rounded-lg bg-warning/10 border border-warning/30">
                  <p className="text-sm font-medium text-warning mb-2">Lý do NTF:</p>
                  <p className="text-foreground">{inspection.ntfReason}</p>
                  {inspection.ntfConfirmedAt && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Xác nhận lúc: {format(new Date(inspection.ntfConfirmedAt), "dd/MM/yyyy HH:mm:ss")}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                Thông tin máy
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Tên máy</p>
                <p className="font-semibold text-foreground">{machine?.name || "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Mã máy</p>
                <p className="font-medium text-foreground">{machine?.code || "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Loại máy</p>
                <Badge variant="secondary">{machine?.machineType || "-"}</Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Model</p>
                <p className="font-medium text-foreground">{machine?.model || "-"}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Product Image with Measurement Points Overlay */}
        {productModelData?.productModel?.referenceImageUrl && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Ảnh sản phẩm với điểm đo
              </CardTitle>
              <CardDescription>
                Click vào điểm đo để xem chi tiết và so sánh với ảnh mẫu
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div 
                ref={imageContainerRef}
                className="relative inline-block max-w-full overflow-hidden rounded-lg border border-border"
              >
                <img
                  src={productModelData.productModel.referenceImageUrl}
                  alt="Product reference"
                  className="max-w-full h-auto"
                  onLoad={handleImageLoad}
                />
                
                {/* Measurement Points Overlay */}
                {measurementsWithCoords.map((m: MeasurementPoint, index: number) => {
                  if (m.x === undefined || m.y === undefined) return null;
                  
                  const containerWidth = imageContainerRef.current?.offsetWidth || imageSize.width;
                  const scale = containerWidth / imageSize.width;
                  const x = m.x * scale;
                  const y = m.y * scale;
                  const radius = 20 * scale;
                  
                  return (
                    <div
                      key={m.id}
                      className="absolute cursor-pointer transition-all duration-200"
                      style={{
                        left: x - radius,
                        top: y - radius,
                        width: radius * 2,
                        height: radius * 2,
                      }}
                      onMouseEnter={() => setHoveredPoint(m.id)}
                      onMouseLeave={() => setHoveredPoint(null)}
                      onClick={() => {
                        setSelectedMeasurement(m);
                        setCompareMode(true);
                      }}
                    >
                      {/* Circle */}
                      <div
                        className="absolute inset-0 rounded-full border-2 flex items-center justify-center transition-all"
                        style={{
                          borderColor: getResultColor(m.result),
                          backgroundColor: `${getResultColor(m.result)}20`,
                          transform: hoveredPoint === m.id ? 'scale(1.2)' : 'scale(1)',
                        }}
                      >
                        <span 
                          className="text-xs font-bold"
                          style={{ color: getResultColor(m.result) }}
                        >
                          {index + 1}
                        </span>
                      </div>
                      
                      {/* Tooltip on hover */}
                      {hoveredPoint === m.id && (
                        <div 
                          className="absolute z-50 left-full ml-2 top-1/2 -translate-y-1/2 bg-popover border border-border rounded-lg p-3 shadow-lg min-w-[200px]"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-semibold">{m.pointCode || `Point ${index + 1}`}</span>
                            {getResultBadge(m.result)}
                          </div>
                          <p className="text-sm text-muted-foreground">{m.pointName || "Điểm đo"}</p>
                          {m.measuredValue && (
                            <p className="text-sm mt-1">Giá trị: {m.measuredValue}</p>
                          )}
                          <p className="text-xs text-primary mt-2">Click để xem chi tiết</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Legend */}
              <div className="flex items-center gap-6 mt-4">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-success/20 border-2 border-success" />
                  <span className="text-sm text-muted-foreground">OK</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-destructive/20 border-2 border-destructive" />
                  <span className="text-sm text-muted-foreground">NG</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-warning/20 border-2 border-warning" />
                  <span className="text-sm text-muted-foreground">NTF</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Measurement Results List */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Kết quả các điểm đo ({measurements.length})</CardTitle>
            <CardDescription>Chi tiết từng điểm đo với ảnh, giá trị và kết quả</CardDescription>
          </CardHeader>
          <CardContent>
            {measurements.length > 0 ? (
              <div className="space-y-4">
                {measurementsWithCoords.map((measurement: MeasurementPoint, index: number) => (
                  <div 
                    key={measurement.id}
                    className={`p-4 rounded-lg border ${
                      measurement.result === "OK" 
                        ? "border-success/30 bg-success/5" 
                        : measurement.result === "NTF"
                        ? "border-warning/30 bg-warning/5"
                        : "border-destructive/30 bg-destructive/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <span 
                            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                            style={{ 
                              backgroundColor: `${getResultColor(measurement.result)}20`,
                              color: getResultColor(measurement.result),
                              border: `2px solid ${getResultColor(measurement.result)}`
                            }}
                          >
                            {index + 1}
                          </span>
                          <span className="font-semibold text-foreground">
                            {measurement.pointCode || `Point ${measurement.pointDefId}`}
                          </span>
                          <span className="text-muted-foreground">
                            {measurement.pointName}
                          </span>
                          {getResultBadge(measurement.result)}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Giá trị đo</p>
                            <p className="font-medium text-foreground">
                              {measurement.measuredValue || "-"}
                            </p>
                          </div>
                          {measurement.remark && (
                            <div className="col-span-2">
                              <p className="text-muted-foreground flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" />
                                Ghi chú
                              </p>
                              <p className="font-medium text-foreground">{measurement.remark}</p>
                            </div>
                          )}
                        </div>

                        {/* AI Analysis Result */}
                        {measurement.aiAnalysisResult && (
                          <div className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20">
                            <p className="text-sm font-medium text-primary flex items-center gap-2 mb-2">
                              <Brain className="h-4 w-4" />
                              Kết quả phân tích AI
                              {measurement.aiConfidence && (
                                <Badge variant="secondary" className="ml-2">
                                  Độ tin cậy: {(parseFloat(measurement.aiConfidence) * 100).toFixed(1)}%
                                </Badge>
                              )}
                            </p>
                            <pre className="text-xs text-foreground whitespace-pre-wrap">
                              {measurement.aiAnalysisResult}
                            </pre>
                          </div>
                        )}
                      </div>

                      {/* Image and Actions */}
                      <div className="flex flex-col items-end gap-2">
                        {measurement.imageUrl ? (
                          <div 
                            className="relative w-24 h-24 rounded-lg overflow-hidden border border-border cursor-pointer group"
                            onClick={() => setSelectedImage(measurement.imageUrl)}
                          >
                            <img 
                              src={measurement.imageUrl} 
                              alt={`Measurement ${index + 1}`}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <ZoomIn className="h-6 w-6 text-white" />
                            </div>
                          </div>
                        ) : (
                          <div className="w-24 h-24 rounded-lg border border-dashed border-border flex items-center justify-center">
                            <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                          </div>
                        )}

                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => {
                              setSelectedMeasurement(measurement);
                              setCompareMode(true);
                            }}
                          >
                            <SplitSquareVertical className="h-3 w-3" />
                            So sánh
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => {
                              setSelectedMeasurement(measurement);
                              setCorrectResult(measurement.result as "OK" | "NG" | "NTF");
                              setCorrectDialogOpen(true);
                            }}
                          >
                            <Edit3 className="h-3 w-3" />
                            Sửa
                          </Button>
                        </div>

                        {measurement.imageUrl && !measurement.aiAnalysisResult && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => handleAnalyzeWithAI(measurement.id)}
                            disabled={analyzingId === measurement.id}
                          >
                            {analyzingId === measurement.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Brain className="h-3 w-3" />
                            )}
                            AI Phân tích
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center">
                <p className="text-muted-foreground">Không có dữ liệu điểm đo</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Image Zoom Dialog with Compare Mode */}
      <Dialog open={!!selectedImage || compareMode} onOpenChange={() => { setSelectedImage(null); setCompareMode(false); setSelectedMeasurement(null); }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {compareMode ? (
                <><SplitSquareVertical className="h-5 w-5" /> So sánh ảnh thực tế với ảnh mẫu</>
              ) : (
                <>Xem ảnh điểm đo</>
              )}
            </DialogTitle>
            <DialogDescription>
              {compareMode && selectedMeasurement && (
                <div className="flex items-center gap-2">
                  <span>{selectedMeasurement.pointCode || `Point ${selectedMeasurement.pointDefId}`}</span>
                  {getResultBadge(selectedMeasurement.result)}
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          {compareMode && selectedMeasurement ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Target className="h-4 w-4" />
                    Ảnh mẫu (Reference)
                  </div>
                  <div className="border rounded-lg p-2 bg-secondary/20">
                    {selectedMeasurement.referenceImageUrl ? (
                      <img 
                        src={selectedMeasurement.referenceImageUrl} 
                        alt="Reference"
                        className="w-full max-h-[40vh] object-contain rounded"
                      />
                    ) : (
                      <div className="h-64 flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                          <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p>Chưa có ảnh mẫu</p>
                          <p className="text-xs">Vui lòng cấu hình trong module Sản phẩm</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <ImageIcon className="h-4 w-4" />
                    Ảnh thực tế (Actual)
                  </div>
                  <div className="border rounded-lg p-2 bg-secondary/20">
                    {selectedMeasurement.imageUrl ? (
                      <img 
                        src={selectedMeasurement.imageUrl} 
                        alt="Actual"
                        className="w-full max-h-[40vh] object-contain rounded"
                      />
                    ) : (
                      <div className="h-64 flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                          <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p>Không có ảnh</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Quick Correct Actions */}
              <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-lg">
                <div>
                  <p className="text-sm font-medium">Kết quả hiện tại: {getResultBadge(selectedMeasurement.result)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Bạn có thể sửa kết quả nếu máy bắt sai</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={selectedMeasurement.result === "OK" ? "default" : "outline"}
                    className="gap-1"
                    onClick={() => {
                      setCorrectResult("OK");
                      setCorrectDialogOpen(true);
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    OK
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedMeasurement.result === "NG" ? "destructive" : "outline"}
                    className="gap-1"
                    onClick={() => {
                      setCorrectResult("NG");
                      setCorrectDialogOpen(true);
                    }}
                  >
                    <XCircle className="h-4 w-4" />
                    NG
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedMeasurement.result === "NTF" ? "secondary" : "outline"}
                    className="gap-1 border-warning text-warning"
                    onClick={() => {
                      setCorrectResult("NTF");
                      setCorrectDialogOpen(true);
                    }}
                  >
                    <AlertTriangle className="h-4 w-4" />
                    NTF
                  </Button>
                </div>
              </div>
            </div>
          ) : selectedImage && (
            <div className="flex justify-center">
              <img 
                src={selectedImage} 
                alt="Measurement detail"
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Correct Result Dialog */}
      <Dialog open={correctDialogOpen} onOpenChange={setCorrectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5" />
              Sửa kết quả điểm đo
            </DialogTitle>
            <DialogDescription>
              Điều chỉnh kết quả nếu máy kiểm tra bắt sai
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Kết quả mới</label>
              <Select value={correctResult} onValueChange={(v) => setCorrectResult(v as "OK" | "NG" | "NTF")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OK">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      OK
                    </div>
                  </SelectItem>
                  <SelectItem value="NG">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-destructive" />
                      NG
                    </div>
                  </SelectItem>
                  <SelectItem value="NTF">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      NTF (Not True Fail)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Lý do sửa đổi</label>
              <Textarea
                placeholder="Nhập lý do sửa đổi kết quả..."
                value={correctReason}
                onChange={(e) => setCorrectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectDialogOpen(false)}>
              Hủy
            </Button>
            <Button 
              onClick={handleCorrectResult}
              disabled={correctResultMutation.isPending}
              className="gap-2"
            >
              {correctResultMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" />
              Lưu thay đổi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
