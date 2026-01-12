import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
  BarChart3,
  History,
  LayoutGrid,
  Settings,
  FileText
} from "lucide-react";
import { useState } from "react";
import { useParams, Link } from "wouter";
import { format } from "date-fns";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: <BarChart3 className="h-4 w-4" /> },
  { href: "/history", label: "Lịch sử", icon: <History className="h-4 w-4" /> },
  { href: "/layout", label: "Layout", icon: <LayoutGrid className="h-4 w-4" /> },
  { href: "/settings", label: "Cài đặt", icon: <Settings className="h-4 w-4" /> },
  { href: "/api-docs", label: "API Docs", icon: <FileText className="h-4 w-4" /> },
];

export default function InspectionDetail() {
  const params = useParams<{ id: string }>();
  const inspectionId = parseInt(params.id || "0");
  
  const [ntfReason, setNtfReason] = useState("");
  const [ntfDialogOpen, setNtfDialogOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.inspection.getById.useQuery(
    { id: inspectionId },
    { enabled: inspectionId > 0 }
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

  const analyzeWithAIMutation = trpc.measurementResult.analyzeWithAI.useMutation({
    onSuccess: (result) => {
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

  const handleAnalyzeWithAI = (measurementId: number) => {
    setAnalyzingId(measurementId);
    analyzeWithAIMutation.mutate({ id: measurementId });
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
                {inspection.cycleTime && (
                  <div>
                    <p className="text-sm text-muted-foreground">Cycle Time</p>
                    <p className="font-medium text-foreground">{inspection.cycleTime}s</p>
                  </div>
                )}
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

        {/* Measurement Results */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Kết quả các điểm đo ({measurements.length})</CardTitle>
            <CardDescription>Chi tiết từng điểm đo với ảnh, giá trị và kết quả</CardDescription>
          </CardHeader>
          <CardContent>
            {measurements.length > 0 ? (
              <div className="space-y-4">
                {measurements.map((measurement, index) => (
                  <div 
                    key={measurement.id}
                    className={`p-4 rounded-lg border ${
                      measurement.result === "OK" 
                        ? "border-success/30 bg-success/5" 
                        : "border-destructive/30 bg-destructive/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-sm font-medium text-muted-foreground">
                            #{index + 1}
                          </span>
                          <span className="font-semibold text-foreground">
                            Point ID: {measurement.pointDefId}
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

      {/* Image Zoom Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Xem ảnh điểm đo</DialogTitle>
          </DialogHeader>
          {selectedImage && (
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
    </DashboardLayout>
  );
}
