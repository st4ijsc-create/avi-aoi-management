import DashboardLayout from "@/components/DashboardLayout";
import { useTranslation } from 'react-i18next';
import { PageHeader, PageContainer } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  ZoomOut,
  Maximize2,
  RotateCcw,
  SplitSquareVertical,
  Target,
  Edit3,
  Save,
  List,
  X,
  ArrowLeftRight
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import { format } from "date-fns";
import { AISuggestionsPanel } from "@/components/AISuggestionsPanel";
import { useIsReadOnly, ViewOnlyBadge } from "@/components/PermissionGate";
import { Tag } from "lucide-react";

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
  pointCode?: string | null;
  pointName?: string | null;
  productModelId?: number | null;
  productCode?: string | null;
  productName?: string | null;
  defectCatalogId?: number | null;
  defectSeverity?: string | null;
  defectCode?: string | null;
  defectName?: string | null;
  defectNameVi?: string | null;
  x?: number;
  y?: number;
}

export default function InspectionDetail() {
  const { t } = useTranslation();
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
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const readOnly = useIsReadOnly();

  // Lightbox state
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxTitle, setLightboxTitle] = useState<string>("");
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxOffset, setLightboxOffset] = useState({ x: 0, y: 0 });
  const lightboxDragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  // Track which side the lightbox is showing so we can switch
  const [lightboxSide, setLightboxSide] = useState<'reference' | 'actual' | null>(null);

  const openLightbox = (src: string, title: string, side?: 'reference' | 'actual') => {
    setLightboxSrc(src);
    setLightboxTitle(title);
    setLightboxZoom(1);
    setLightboxOffset({ x: 0, y: 0 });
    setLightboxSide(side ?? null);
  };
  const closeLightbox = () => {
    setLightboxSrc(null);
    lightboxDragRef.current = null;
  };
  const lbZoomIn  = () => setLightboxZoom(z => Math.min(z + 0.25, 5));
  const lbZoomOut = () => setLightboxZoom(z => Math.max(z - 0.25, 0.25));
  const lbReset   = () => { setLightboxZoom(1); setLightboxOffset({ x: 0, y: 0 }); };

  const handleLbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    lightboxDragRef.current = { startX: e.clientX, startY: e.clientY, ox: lightboxOffset.x, oy: lightboxOffset.y };
  };
  const handleLbMouseMove = (e: React.MouseEvent) => {
    if (!lightboxDragRef.current) return;
    const dx = e.clientX - lightboxDragRef.current.startX;
    const dy = e.clientY - lightboxDragRef.current.startY;
    setLightboxOffset({ x: lightboxDragRef.current.ox + dx, y: lightboxDragRef.current.oy + dy });
  };
  const handleLbMouseUp = () => { lightboxDragRef.current = null; };
  const handleLbWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setLightboxZoom(z => Math.min(Math.max(z - e.deltaY * 0.001, 0.25), 5));
  };

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
      toast.success(t('inspection.ntfConfirmedSuccess'));
      setNtfDialogOpen(false);
      setNtfReason("");
      refetch();
    },
    onError: (error) => {
      toast.error(t('common.error') + ': ' + error.message);
    },
  });

  const correctResultMutation = trpc.measurementResult.correctResult.useMutation({
    onSuccess: () => {
      toast.success(t('inspection.resultUpdatedSuccess'));
      setCorrectDialogOpen(false);
      setCorrectReason("");
      setSelectedMeasurement(null);
      refetch();
    },
    onError: (error) => {
      toast.error(t('common.error') + ': ' + error.message);
    },
  });

  // IPC-A-610 defect catalog for NG classification
  const { data: defectCatalog } = trpc.defectCatalog.list.useQuery({});

  const classifyDefectMutation = trpc.measurementResult.classifyDefect.useMutation({
    onSuccess: () => {
      toast.success(t('inspection.defectClassifiedSuccess', 'Defect code assigned'));
      refetch();
    },
    onError: (error) => {
      toast.error(t('common.error') + ': ' + error.message);
    },
  });

  const handleClassifyDefect = (measurementId: number, defectCatalogId: number | null) => {
    classifyDefectMutation.mutate({ id: measurementId, defectCatalogId });
  };

  const analyzeWithAIMutation = trpc.measurementResult.analyzeWithAI.useMutation({
    onSuccess: () => {
      toast.success(t('inspection.aiAnalysisComplete'));
      refetch();
    },
    onError: (error) => {
      toast.error(t('inspection.analysisError') + ': ' + error.message);
    },
    onSettled: () => {
      setAnalyzingId(null);
    },
  });

  const handleConfirmNTF = () => {
    if (!ntfReason.trim()) {
      toast.error(t('inspection.pleaseEnterNtfReason'));
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

  // Semantic theme tokens (CSS vars) so the point overlay tints follow the
  // light/dark palette instead of hard-coded hex. Consumed in inline styles.
  const getResultColor = (result: string) => {
    switch (result) {
      case "OK": return "var(--success)";
      case "NG": return "var(--destructive)";
      case "NTF": return "var(--warning)";
      default: return "var(--muted-foreground)";
    }
  };
  // Same token at a low alpha for idle circle fills (color-mix keeps it theme-aware).
  const getResultTint = (result: string, pct: number) =>
    `color-mix(in oklab, ${getResultColor(result)} ${pct}%, transparent)`;

  const getResultBadge = (result: string, size: "sm" | "lg" = "sm") => {
    const baseClass = size === "lg" ? "text-base px-4 py-2" : "";
    switch (result) {
      case "OK":
        return (
          <Badge className={`bg-success/20 text-success border-success/30 gap-1 ${baseClass}`}>
            <CheckCircle2 className={size === "lg" ? "h-5 w-5" : "h-3 w-3"} />
            OK
          </Badge>
        );
      case "NG":
        return (
          <Badge className={`bg-destructive/20 text-destructive border-destructive/30 gap-1 ${baseClass}`}>
            <XCircle className={size === "lg" ? "h-5 w-5" : "h-3 w-3"} />
            NG
          </Badge>
        );
      case "NTF":
        return (
          <Badge className={`bg-warning/20 text-warning border-warning/30 gap-1 ${baseClass}`}>
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

  // Handle point click from image or list
  const handlePointClick = (measurement: MeasurementPoint, index: number) => {
    setSelectedMeasurement(measurement);
    setActivePointIndex(index);
    setCompareMode(true);
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
          <p className="text-muted-foreground">{t('inspection.notFound')}</p>
          <Link href="/history">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t('inspection.goBack')}
            </Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  const { inspection, measurements, machine } = data;

  // Calculate statistics
  const okCount = measurementsWithCoords.filter((m: MeasurementPoint) => m.result === "OK").length;
  const ngCount = measurementsWithCoords.filter((m: MeasurementPoint) => m.result === "NG").length;
  const ntfCount = measurementsWithCoords.filter((m: MeasurementPoint) => m.result === "NTF").length;
  const total = measurementsWithCoords.length;
  const yieldRate = total > 0 ? ((okCount + ntfCount) / total * 100).toFixed(1) : "0";

  return (
    <DashboardLayout title="AVI/AOI Management" navItems={navItems} currentPath="/history">
      <PageContainer>
        {/* Back link (kept above the title; PageHeader's icon chip is decorative). */}
        <Link href="/history">
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t('inspection.goBack')}
          </Button>
        </Link>
        {/* Header */}
        <PageHeader
          title={t('inspection.inspectionDetail')}
          description={`SN: ${inspection.serialNumber}`}
          actions={
            inspection.overallResult === "NG" && inspection.originalResult === "NG" ? (
              <Dialog open={ntfDialogOpen} onOpenChange={setNtfDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2 border-warning text-warning hover:bg-warning/10">
                    <AlertTriangle className="h-4 w-4" />
                    {t('inspection.confirmNTF')}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('inspection.confirmNTFTitle')}</DialogTitle>
                    <DialogDescription>
                      {t('inspection.confirmNTFDescription')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('inspection.ntfReasonLabel')}</label>
                      <Textarea
                        placeholder={t('inspection.ntfReasonPlaceholder')}
                        value={ntfReason}
                        onChange={(e) => setNtfReason(e.target.value)}
                        rows={4}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setNtfDialogOpen(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      onClick={handleConfirmNTF}
                      disabled={confirmNTFMutation.isPending}
                      className="gap-2"
                    >
                      {confirmNTFMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      {t('inspection.confirmNTF')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : undefined
          }
        />

        {/* Row 1: Inspection Info + Machine Info */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="glass-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">{t('inspection.inspectionInfo')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Serial Number</p>
                  <p className="font-semibold text-foreground">{inspection.serialNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('inspection.result')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('inspection.originalResult')}</p>
                  <div className="mt-1">{getResultBadge(inspection.originalResult)}</div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('inspection.inspectionTime')}</p>
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {format(new Date(inspection.inspectionTime), "dd/MM/yyyy HH:mm:ss")}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('inspection.productModel')}</p>
                  <p className="font-medium text-foreground">{inspection.productModel || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Batch Number</p>
                  <p className="font-medium text-foreground">{inspection.batchNumber || "-"}</p>
                </div>
              </div>

              {inspection.ntfReason && (
                <div className="mt-6 p-4 rounded-lg bg-warning/10 border border-warning/30">
                  <p className="text-sm font-medium text-warning mb-2">{t('inspection.ntfReason')}:</p>
                  <p className="text-foreground">{inspection.ntfReason}</p>
                  {inspection.ntfConfirmedAt && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {t('inspection.confirmedAt')}: {format(new Date(inspection.ntfConfirmedAt), "dd/MM/yyyy HH:mm:ss")}
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
                                {t('inspection.machineInfo')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">{t('inspection.machineName')}</p>
                <p className="font-semibold text-foreground">{machine?.name || "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('inspection.machineCode')}</p>
                <p className="font-medium text-foreground">{machine?.code || "-"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('inspection.machineType')}</p>
                <Badge variant="secondary">{machine?.machineType || "-"}</Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Model</p>
                <p className="font-medium text-foreground">{machine?.model || "-"}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Product Image with Points (Left) + Measurement List (Right) */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Left Column: Product Image with Measurement Points */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                                {t('inspection.productImageWithPoints')}
              </CardTitle>
              <CardDescription>
                {t('inspection.clickPointToCompare')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {productModelData?.productModel?.referenceImageUrl ? (
                <>
                  <div 
                    ref={imageContainerRef}
                    className="relative inline-block w-full overflow-hidden rounded-lg border border-border bg-secondary/20"
                  >
                    <img
                      src={productModelData.productModel.referenceImageUrl}
                      alt="Product reference"
                      className="w-full h-auto"
                      onLoad={handleImageLoad}
                    />
                    
                    {/* Measurement Points Overlay */}
                    {measurementsWithCoords.map((m: MeasurementPoint, index: number) => {
                      if (m.x === undefined || m.y === undefined) return null;
                      
                      const containerWidth = imageContainerRef.current?.offsetWidth || imageSize.width;
                      // Prevent NaN when imageSize.width is 0
                      if (imageSize.width === 0 || containerWidth === 0) return null;
                      const scale = containerWidth / imageSize.width;
                      const x = m.x * scale;
                      const y = m.y * scale;
                      const radius = 18 * scale;
                      const isActive = activePointIndex === index;
                      const isHovered = hoveredPoint === m.id;
                      
                      return (
                        <div
                          key={m.id}
                          className="absolute cursor-pointer transition-all duration-200"
                          style={{
                            left: x - radius,
                            top: y - radius,
                            width: radius * 2,
                            height: radius * 2,
                            zIndex: isActive || isHovered ? 20 : 10,
                          }}
                          onMouseEnter={() => setHoveredPoint(m.id)}
                          onMouseLeave={() => setHoveredPoint(null)}
                          onClick={() => handlePointClick(m, index)}
                        >
                          {/* Circle */}
                          <div
                            className="absolute inset-0 rounded-full border-2 flex items-center justify-center transition-all shadow-lg"
                            style={{
                              borderColor: getResultColor(m.result),
                              backgroundColor: isActive || isHovered
                                ? getResultColor(m.result)
                                : getResultTint(m.result, 19),
                              transform: isActive || isHovered ? 'scale(1.3)' : 'scale(1)',
                            }}
                          >
                            <span
                              className="text-xs font-bold"
                              style={{
                                color: isActive || isHovered ? 'white' : getResultColor(m.result)
                              }}
                            >
                              {index + 1}
                            </span>
                          </div>
                          
                          {/* Tooltip on hover */}
                          {isHovered && (
                            <div 
                              className="absolute z-50 left-full ml-2 top-1/2 -translate-y-1/2 bg-popover border border-border rounded-lg p-3 shadow-xl min-w-50"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-semibold">{m.pointCode || `Point ${index + 1}`}</span>
                                {getResultBadge(m.result)}
                              </div>
                              <p className="text-sm text-muted-foreground">{m.pointName || t('inspection.measurementPoint')}</p>
                              {m.measuredValue && (
                                <p className="text-sm mt-1">{t('inspection.value')}: {m.measuredValue}</p>
                              )}
                              <p className="text-xs text-primary mt-2">{t('inspection.clickForDetails')}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  
                  {/* Legend + Stats */}
                  <div className="flex items-center justify-between mt-4 flex-wrap gap-4">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-success/20 border-2 border-success" />
                        <span className="text-sm text-muted-foreground">OK ({okCount})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-destructive/20 border-2 border-destructive" />
                        <span className="text-sm text-muted-foreground">NG ({ngCount})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-warning/20 border-2 border-warning" />
                        <span className="text-sm text-muted-foreground">NTF ({ntfCount})</span>
                      </div>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Yield Rate: </span>
                      <span className="font-semibold text-primary">{yieldRate}%</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground border border-dashed rounded-lg">
                  <div className="text-center">
                    <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>{t('inspection.noReferenceImage')}</p>
                    <p className="text-xs mt-1">{t('inspection.configureInProductModule')}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right Column: Measurement Results List */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <List className="h-5 w-5 text-primary" />
                                {t('inspection.measurementList')} ({measurements.length})
              </CardTitle>
              <CardDescription>{t('inspection.measurementListDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-125">
                <div className="p-6 space-y-3">
                  {measurementsWithCoords.length > 0 ? (
                    measurementsWithCoords.map((measurement: MeasurementPoint, index: number) => (
                      <div 
                        key={measurement.id}
                        className={`p-4 rounded-lg border cursor-pointer transition-all ${
                          activePointIndex === index 
                            ? "ring-2 ring-primary border-primary" 
                            : measurement.result === "OK" 
                              ? "border-success/30 bg-success/5 hover:border-success/50" 
                              : measurement.result === "NTF"
                              ? "border-warning/30 bg-warning/5 hover:border-warning/50"
                              : "border-destructive/30 bg-destructive/5 hover:border-destructive/50"
                        }`}
                        onClick={() => handlePointClick(measurement, index)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span
                              className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                              style={{
                                backgroundColor: getResultTint(measurement.result, 12),
                                color: getResultColor(measurement.result),
                                border: `2px solid ${getResultColor(measurement.result)}`
                              }}
                            >
                              {index + 1}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-foreground">
                                  {measurement.pointCode || `Point ${measurement.pointDefId}`}
                                </span>
                                {getResultBadge(measurement.result)}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {measurement.pointName || t('inspection.measurementPoint')}
                              </p>
                              {measurement.defectCode && (
                                <Badge variant="outline" className="mt-1 gap-1 text-[10px]">
                                  <Tag className="h-3 w-3" />
                                  {measurement.defectCode}
                                </Badge>
                              )}
                            </div>
                          </div>
                          
                          <div className="text-right">
                            <p className="text-sm text-muted-foreground">{t('inspection.measuredValue')}</p>
                          </div>
                        </div>

                        {measurement.remark && (
                          <div className="mt-3 pt-3 border-t border-border/50">
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              {measurement.remark}
                            </p>
                          </div>
                        )}

                        {measurement.aiAnalysisResult && (
                          <div className="mt-3 p-2 rounded bg-primary/10 border border-primary/20">
                            <p className="text-xs font-medium text-primary flex items-center gap-1">
                              <Brain className="h-3 w-3" />
                              AI: {measurement.aiAnalysisResult.substring(0, 100)}...
                            </p>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="py-12 text-center">
                      <p className="text-muted-foreground">{t('inspection.noMeasurementData')}</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Row 3: AI Suggestions Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AISuggestionsPanel
            inspectionId={inspectionId}
            onFeedbackSubmitted={() => refetch()}
          />
        </div>
      </PageContainer>

      {/* Image Compare Dialog */}
      <Dialog open={compareMode} onOpenChange={(open) => { 
        if (!open) {
          setCompareMode(false); 
          setSelectedMeasurement(null);
          setActivePointIndex(null);
        }
      }}>
        <DialogContent className="w-[90vw] max-w-[90vw] md:w-[75vw] md:max-w-[75vw] lg:w-[60vw] lg:max-w-[60vw] xl:w-[50vw] xl:max-w-[50vw] max-h-[90vh] p-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SplitSquareVertical className="h-5 w-5" /> 
                            {t('inspection.compareImages')}
            </DialogTitle>
            <DialogDescription asChild>
              {selectedMeasurement && (
                <span className="flex items-center gap-2">
                  <span className="font-medium">{selectedMeasurement.pointCode || `Point ${selectedMeasurement.pointDefId}`}</span>
                  <span className="text-muted-foreground">-</span>
                  <span>{selectedMeasurement.pointName}</span>
                  {getResultBadge(selectedMeasurement.result)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {selectedMeasurement && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Target className="h-4 w-4" />
                    {t('inspection.referenceImage')}
                  </div>
                  <div className="border rounded-lg p-2 bg-secondary/20 flex items-center justify-center overflow-hidden aspect-square">
                    {selectedMeasurement.referenceImageUrl ? (
                      <img
                        src={selectedMeasurement.referenceImageUrl}
                        alt="Reference"
                        className="max-w-full max-h-full object-contain rounded cursor-zoom-in hover:opacity-90 transition-opacity"
                        onClick={() => openLightbox(selectedMeasurement.referenceImageUrl!, t('inspection.referenceImage'), 'reference')}
                      />
                    ) : (
                      <div className="text-center text-muted-foreground">
                        <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>{t('inspection.noReferenceImageShort')}</p>
                        <p className="text-xs">{t('inspection.configureInProductModule')}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <ImageIcon className="h-4 w-4" />
                    {t('inspection.actualImage')}
                  </div>
                  <div className="border rounded-lg p-2 bg-secondary/20 flex items-center justify-center overflow-hidden aspect-square">
                    {selectedMeasurement.imageUrl ? (
                      <img
                        src={selectedMeasurement.imageUrl}
                        alt="Actual"
                        className="max-w-full max-h-full object-contain rounded cursor-zoom-in hover:opacity-90 transition-opacity"
                        onClick={() => openLightbox(selectedMeasurement.imageUrl!, t('inspection.actualImage'), 'actual')}
                      />
                    ) : (
                      <div className="text-center text-muted-foreground">
                        <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>{t('inspection.noImage')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Measurement Details */}
              <div className="grid grid-cols-3 gap-4 p-4 bg-secondary/30 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">{t('inspection.measuredValue')}</p>
                  <p className="font-semibold text-foreground">{selectedMeasurement.measuredValue || "-"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('inspection.result')}</p>
                  <div className="mt-1">{getResultBadge(selectedMeasurement.result, "lg")}</div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('inspection.remark')}</p>
                  <p className="font-medium text-foreground">{selectedMeasurement.remark || "-"}</p>
                </div>
              </div>

              {/* Defect Classification (IPC-A-610) — only for NG / NTF results */}
              {(selectedMeasurement.result === "NG" || selectedMeasurement.result === "NTF") && (
                <div className="p-4 rounded-lg bg-secondary/30 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Tag className="h-4 w-4 text-primary" />
                      {t('inspection.defectCode', 'Defect code (IPC-A-610)')}
                    </p>
                    <ViewOnlyBadge />
                  </div>
                  {readOnly ? (
                    <p className="text-sm text-foreground">
                      {selectedMeasurement.defectCode
                        ? `${selectedMeasurement.defectCode} — ${selectedMeasurement.defectName ?? ''}`
                        : t('inspection.noDefectCode', 'Not classified')}
                    </p>
                  ) : (
                    <Select
                      value={selectedMeasurement.defectCatalogId ? String(selectedMeasurement.defectCatalogId) : "none"}
                      onValueChange={(v) =>
                        handleClassifyDefect(selectedMeasurement.id, v === "none" ? null : parseInt(v))
                      }
                    >
                      <SelectTrigger disabled={classifyDefectMutation.isPending}>
                        <SelectValue placeholder={t('inspection.selectDefectCode', 'Select defect code')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('inspection.noDefectCode', 'Not classified')}</SelectItem>
                        {(defectCatalog ?? []).map((d: { id: number; code: string; name: string; severity: string; category: string }) => (
                          <SelectItem key={d.id} value={String(d.id)}>
                            <span className="flex items-center gap-2">
                              <span className="font-medium">{d.code}</span>
                              <span className="text-muted-foreground">— {d.name}</span>
                              <Badge variant="secondary" className="text-[10px]">{d.severity}</Badge>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* AI Analysis */}
              {selectedMeasurement.aiAnalysisResult && (
                <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <p className="text-sm font-medium text-primary flex items-center gap-2 mb-2">
                    <Brain className="h-4 w-4" />
                    {t('inspection.aiAnalysisResult')}
                    {selectedMeasurement.aiConfidence && (
                      <Badge variant="secondary">
                        {t('inspection.confidence')}: {(parseFloat(selectedMeasurement.aiConfidence) * 100).toFixed(1)}%
                      </Badge>
                    )}
                  </p>
                  <pre className="text-sm text-foreground whitespace-pre-wrap">
                    {selectedMeasurement.aiAnalysisResult}
                  </pre>
                </div>
              )}
              
              {/* Actions */}
              <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-lg">
                <div className="flex gap-2">
                  {selectedMeasurement.imageUrl && !selectedMeasurement.aiAnalysisResult && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => handleAnalyzeWithAI(selectedMeasurement.id)}
                      disabled={analyzingId === selectedMeasurement.id}
                    >
                      {analyzingId === selectedMeasurement.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Brain className="h-4 w-4" />
                      )}
                      {t('inspection.aiAnalyze')}
                    </Button>
                  )}
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
          )}
        </DialogContent>
      </Dialog>

      {/* Lightbox – fullscreen image viewer with zoom/pan */}
      <Dialog open={!!lightboxSrc} onOpenChange={(open) => { if (!open) closeLightbox(); }}>
        <DialogContent className="max-w-[85vh] w-[85vh] max-h-[85vh] h-[85vh] aspect-square p-0 overflow-hidden flex flex-col bg-black/95 border-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{lightboxTitle}</DialogTitle>
          </DialogHeader>
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 bg-black/80 shrink-0 z-10">
            <span className="text-white text-sm font-medium truncate max-w-[60%]">{lightboxTitle}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={lbZoomOut} title={t('inspectionDetail.zoomOut', 'Thu nhỏ')}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-white text-xs w-12 text-center tabular-nums">{Math.round(lightboxZoom * 100)}%</span>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={lbZoomIn} title={t('inspectionDetail.zoomIn', 'Phóng to')}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={lbReset} title={t('inspectionDetail.resetZoom', 'Đặt lại')}>
                <RotateCcw className="h-4 w-4" />
              </Button>
              {/* Switch to other image button */}
              {lightboxSide && selectedMeasurement && (() => {
                const otherSrc = lightboxSide === 'reference' ? selectedMeasurement.imageUrl : selectedMeasurement.referenceImageUrl;
                const otherTitle = lightboxSide === 'reference' ? t('inspection.actualImage') : t('inspection.referenceImage');
                const otherSide = lightboxSide === 'reference' ? 'actual' as const : 'reference' as const;
                if (!otherSrc) return null;
                return (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => openLightbox(otherSrc, otherTitle, otherSide)} title={otherTitle}>
                    <ArrowLeftRight className="h-4 w-4" />
                  </Button>
                );
              })()}
              <div className="w-px h-5 bg-white/20 mx-1" />
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={closeLightbox} title={t('common.close', 'Đóng')}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {/* Image area */}
          <div
            className="flex-1 overflow-hidden flex items-center justify-center"
            style={{ cursor: lightboxZoom > 1 ? (lightboxDragRef.current ? 'grabbing' : 'grab') : 'default' }}
            onMouseDown={handleLbMouseDown}
            onMouseMove={handleLbMouseMove}
            onMouseUp={handleLbMouseUp}
            onMouseLeave={handleLbMouseUp}
            onWheel={handleLbWheel}
          >
            {lightboxSrc && (
              <img
                src={lightboxSrc}
                alt={lightboxTitle}
                draggable={false}
                style={{
                  transform: `scale(${lightboxZoom}) translate(${lightboxOffset.x / lightboxZoom}px, ${lightboxOffset.y / lightboxZoom}px)`,
                  transformOrigin: 'center center',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  userSelect: 'none',
                  transition: lightboxDragRef.current ? 'none' : 'transform 0.15s ease',
                }}
              />
            )}
          </div>
          {/* Hint */}
          <p className="text-center text-white/40 text-xs pb-2 shrink-0">{t('inspectionDetail.lightboxHint', 'Cuộn chuột để zoom · Kéo để di chuyển')}</p>
        </DialogContent>
      </Dialog>

      {/* Image Zoom Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('inspection.viewMeasurementImage')}</DialogTitle>
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

      {/* Correct Result Dialog */}
      <Dialog open={correctDialogOpen} onOpenChange={setCorrectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5" />
                            {t('inspection.correctResult')}
            </DialogTitle>
            <DialogDescription>
              {t('inspection.correctResultDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('inspection.newResult')}</label>
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
              <label className="text-sm font-medium">{t('inspection.correctionReasonLabel')}</label>
              <Textarea
                placeholder={t('inspection.correctionReasonPlaceholder')}
                value={correctReason}
                onChange={(e) => setCorrectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button 
              onClick={handleCorrectResult}
              disabled={correctResultMutation.isPending}
              className="gap-2"
            >
              {correctResultMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" />
              {t('common.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
