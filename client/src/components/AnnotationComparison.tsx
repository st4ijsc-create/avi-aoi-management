import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  GitCompare,
  Layers,
  Search,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Eye,
  EyeOff,
  Square,
  Circle,
  ArrowRight,
  Pencil,
  Type,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Image as ImageIcon,
  FileDown,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';

interface ComparisonItem {
  inspectionId: number;
  serialNumber: string;
  inspectionTime: string;
  overallResult: string;
  machineName: string;
  machineId: number;
  productModelName: string;
  productModelId: number;
  measurementResultId: number;
  imageUrl: string;
  result: string;
  value: number | null;
  measurementPointName: string;
  measurementPointId: number;
  annotationId: number | null;
  annotations: any[];
  annotationCreatedAt: string | null;
}

interface ComparisonGroup {
  measurementPointId: number | null;
  measurementPointName: string;
  inspections: ComparisonItem[];
}

const resultColors: Record<string, string> = {
  OK: 'text-success bg-success/10',
  NG: 'text-destructive bg-destructive/10',
  NTF: 'text-warning bg-warning/10',
};

const resultIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  OK: CheckCircle2,
  NG: XCircle,
  NTF: AlertTriangle,
};

const annotationTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  rectangle: Square,
  circle: Circle,
  arrow: ArrowRight,
  freehand: Pencil,
  text: Type,
};

export function AnnotationComparison() {
  const { t } = useTranslation();
  const [serialNumber, setSerialNumber] = useState('');
  const [productModelId, setProductModelId] = useState<number | undefined>();
  const [machineId, setMachineId] = useState<number | undefined>();
  const [measurementPointId, setMeasurementPointId] = useState<number | undefined>();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<ComparisonGroup | null>(null);
  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(1);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'overlay'>('side-by-side');
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);

  // Fetch comparison data
  const { data: comparisonData, isLoading, refetch } = trpc.annotation.comparison.useQuery({
    serialNumber: serialNumber || undefined,
    productModelId,
    machineId,
    measurementPointId,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: 20,
  }, {
    enabled: !!(serialNumber || productModelId || machineId),
  });

  // Fetch machines for filter
  const { data: machines } = trpc.machine.list.useQuery();
  
  // Fetch product models for filter
  const { data: productModels } = trpc.productModel.list.useQuery();

  // Fetch measurement points for filter - use listByProductModel if productModelId is set
  const { data: measurementPoints } = trpc.measurementPoint.listByProductModel.useQuery(
    { productModelId: productModelId || 0 },
    { enabled: !!productModelId }
  );

  const handleSearch = () => {
    refetch();
  };

  // Export PDF mutation
  const exportPdfMutation = trpc.annotationComparison.generatePdfReport.useMutation({
    onSuccess: (data) => {
      // Server now renders a REAL PDF (base64) via the canonical engine.
      const bytes = Uint8Array.from(atob(data.pdfBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: data.pdfMimeType || 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.pdfFileName || `comparison-report-${data.inspection1.serialNumber}-${data.inspection2.serialNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t('annotation.comparison.exportSuccess'));
    },
    onError: (error) => {
      toast.error(t('common.errorWithMessage', { message: error.message }));
    },
  });

  const handleExportPdf = () => {
    if (!leftItem || !rightItem) {
      toast.error(t('annotation.comparison.selectTwoInspections'));
      return;
    }
    exportPdfMutation.mutate({
      inspectionId1: leftItem.inspectionId,
      inspectionId2: rightItem.inspectionId,
      includeImages: true,
      includePatterns: true,
    });
  };

  const leftItem = selectedGroup?.inspections[leftIndex];
  const rightItem = selectedGroup?.inspections[rightIndex];

  // Calculate annotation differences
  const annotationDiff = useMemo(() => {
    if (!leftItem || !rightItem) return null;
    
    const leftAnnotations = leftItem.annotations || [];
    const rightAnnotations = rightItem.annotations || [];
    
    return {
      leftOnly: leftAnnotations.length,
      rightOnly: rightAnnotations.length,
      leftByType: leftAnnotations.reduce((acc: Record<string, number>, a: any) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {}),
      rightByType: rightAnnotations.reduce((acc: Record<string, number>, a: any) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {}),
    };
  }, [leftItem, rightItem]);

  const renderAnnotationOverlay = (annotations: any[]) => {
    if (!showAnnotations || !annotations?.length) return null;
    
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {annotations.map((ann: any, idx: number) => {
          if (ann.type === 'rectangle' && ann.points?.length >= 2) {
            const x = ann.points[0].x * 100;
            const y = ann.points[0].y * 100;
            const width = (ann.points[1].x - ann.points[0].x) * 100;
            const height = (ann.points[1].y - ann.points[0].y) * 100;
            return (
              <rect
                key={idx}
                x={`${x}%`}
                y={`${y}%`}
                width={`${Math.abs(width)}%`}
                height={`${Math.abs(height)}%`}
                fill="none"
                stroke={ann.color}
                strokeWidth={ann.lineWidth || 2}
              />
            );
          }
          if (ann.type === 'circle' && ann.points?.length >= 2) {
            const cx = ann.points[0].x * 100;
            const cy = ann.points[0].y * 100;
            const r = Math.abs(ann.points[1].x - ann.points[0].x) * 100;
            return (
              <circle
                key={idx}
                cx={`${cx}%`}
                cy={`${cy}%`}
                r={`${r}%`}
                fill="none"
                stroke={ann.color}
                strokeWidth={ann.lineWidth || 2}
              />
            );
          }
          if (ann.type === 'arrow' && ann.points?.length >= 2) {
            const x1 = ann.points[0].x * 100;
            const y1 = ann.points[0].y * 100;
            const x2 = ann.points[1].x * 100;
            const y2 = ann.points[1].y * 100;
            return (
              <line
                key={idx}
                x1={`${x1}%`}
                y1={`${y1}%`}
                x2={`${x2}%`}
                y2={`${y2}%`}
                stroke={ann.color}
                strokeWidth={ann.lineWidth || 2}
                markerEnd="url(#arrowhead)"
              />
            );
          }
          if (ann.type === 'text' && ann.points?.length >= 1) {
            const x = ann.points[0].x * 100;
            const y = ann.points[0].y * 100;
            return (
              <text
                key={idx}
                x={`${x}%`}
                y={`${y}%`}
                fill={ann.color}
                fontSize={ann.fontSize || 14}
                className="font-medium"
              >
                {ann.text}
              </text>
            );
          }
          if (ann.type === 'freehand' && ann.points?.length >= 2) {
            const pathData = ann.points.map((p: any, i: number) => 
              `${i === 0 ? 'M' : 'L'} ${p.x * 100}% ${p.y * 100}%`
            ).join(' ');
            return (
              <path
                key={idx}
                d={pathData}
                fill="none"
                stroke={ann.color}
                strokeWidth={ann.lineWidth || 2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          }
          return null;
        })}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
          </marker>
        </defs>
      </svg>
    );
  };

  const renderImageWithAnnotations = (item: ComparisonItem | undefined, label: string, borderColor: string) => {
    if (!item) {
      return (
        <div className="flex-1 flex items-center justify-center bg-muted rounded-lg min-h-75">
          <div className="text-center text-muted-foreground">
            <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>{t('annotation.comparison.selectInspection')}</p>
          </div>
        </div>
      );
    }

    const ResultIcon = resultIcons[item.result] || AlertTriangle;

    return (
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className={cn("p-3 rounded-t-lg border-2", borderColor)}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">{label}</span>
            <Badge variant="outline" className={resultColors[item.result] || ''}>
              <ResultIcon className="h-3 w-3 mr-1" />
              {item.result}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="flex items-center gap-2">
              <Clock className="h-3 w-3" />
              {format(new Date(item.inspectionTime), 'dd/MM/yyyy HH:mm:ss', { locale: vi })}
            </div>
            <div>Serial: {item.serialNumber}</div>
            <div>{t('annotation.comparison.machine')}: {item.machineName}</div>
            {item.value !== null && <div>{t('annotation.comparison.value')}: {item.value}</div>}
          </div>
        </div>

        {/* Image */}
        <div 
          className={cn("relative flex-1 bg-muted rounded-b-lg overflow-hidden border-2 border-t-0", borderColor)}
          style={{ minHeight: '300px' }}
        >
          <div 
            className="absolute inset-0 flex items-center justify-center"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
          >
            <img
              src={item.imageUrl}
              alt={item.measurementPointName}
              className="max-w-full max-h-full object-contain"
            />
            {renderAnnotationOverlay(item.annotations)}
          </div>
        </div>

        {/* Annotation count */}
        <div className="mt-2 text-sm text-muted-foreground flex items-center gap-4">
          <span>Annotations: {item.annotations?.length || 0}</span>
          {item.annotations?.length > 0 && (
            <div className="flex items-center gap-2">
              {Object.entries(
                item.annotations.reduce((acc: Record<string, number>, a: any) => {
                  acc[a.type] = (acc[a.type] || 0) + 1;
                  return acc;
                }, {})
              ).map(([type, count]) => {
                const Icon = annotationTypeIcons[type] || Square;
                return (
                  <span key={type} className="flex items-center gap-1">
                    <Icon className="h-3 w-3" />
                    {count as number}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Search Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" />
            {t('annotation.comparison.title')}
          </CardTitle>
          <CardDescription>
            {t('annotation.comparison.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>{t('annotation.comparison.serialNumber')}</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('annotation.comparison.serialPlaceholder')}
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('annotation.comparison.productModel')}</Label>
              <Select
                value={productModelId?.toString() || 'all'}
                onValueChange={(v) => setProductModelId(v === 'all' ? undefined : parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('annotation.comparison.selectModel')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all')}</SelectItem>
                  {productModels?.map((pm: any) => (
                    <SelectItem key={pm.id} value={pm.id.toString()}>
                      {pm.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('annotation.comparison.machineLabel')}</Label>
              <Select
                value={machineId?.toString() || 'all'}
                onValueChange={(v) => setMachineId(v === 'all' ? undefined : parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('annotation.comparison.selectMachine')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all')}</SelectItem>
                  {machines?.map((m: any) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('annotation.comparison.measurementPoint')}</Label>
              <Select
                value={measurementPointId?.toString() || 'all'}
                onValueChange={(v) => setMeasurementPointId(v === 'all' ? undefined : parseInt(v))}
                disabled={!productModelId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('annotation.comparison.selectMeasurementPoint')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all')}</SelectItem>
                  {measurementPoints?.map((mp: any) => (
                    <SelectItem key={mp.id} value={mp.id.toString()}>
                      {mp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('annotation.comparison.dateFrom')}</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('annotation.comparison.dateTo')}</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div className="flex items-end">
              <Button onClick={handleSearch} className="w-full gap-2">
                <Search className="h-4 w-4" />
                {t('common.search')}
              </Button>
            </div>

            <div className="flex items-end">
              <Button 
                variant="outline" 
                onClick={handleExportPdf} 
                className="w-full gap-2"
                disabled={!leftItem || !rightItem || exportPdfMutation.isPending}
              >
                {exportPdfMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4" />
                )}
                {t('annotation.comparison.exportReport')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <Skeleton className="h-100" />
          <Skeleton className="h-100 lg:col-span-3" />
        </div>
      ) : comparisonData?.groups && comparisonData.groups.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Measurement Points List */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">{t('annotation.comparison.measurementPointCount', { count: comparisonData.groups.length })}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-125">
                <div className="space-y-1 p-2">
                  {comparisonData.groups.map((group) => (
                    <Button
                      key={group.measurementPointId || 'unknown'}
                      variant={selectedGroup?.measurementPointId === group.measurementPointId ? 'secondary' : 'ghost'}
                      className="w-full justify-start text-left h-auto py-2"
                      onClick={() => {
                        setSelectedGroup(group);
                        setLeftIndex(0);
                        setRightIndex(Math.min(1, group.inspections.length - 1));
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{group.measurementPointName}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('annotation.comparison.inspectionCount', { count: group.inspections.length })}
                        </p>
                      </div>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Comparison View */}
          <Card className="lg:col-span-3">
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  {selectedGroup?.measurementPointName || t('annotation.comparison.selectToCompare')}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {/* View Mode Toggle */}
                  <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'side-by-side' | 'overlay')}>
                    <TabsList className="h-8">
                      <TabsTrigger value="side-by-side" className="text-xs px-2">
                        <GitCompare className="h-3 w-3 mr-1" />
                        {t('annotation.comparison.sideBySide')}
                      </TabsTrigger>
                      <TabsTrigger value="overlay" className="text-xs px-2">
                        <Layers className="h-3 w-3 mr-1" />
                        {t('annotation.comparison.overlay')}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {/* Show Annotations Toggle */}
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={showAnnotations}
                      onCheckedChange={setShowAnnotations}
                      id="show-annotations"
                    />
                    <Label htmlFor="show-annotations" className="text-xs">
                      {showAnnotations ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Label>
                  </div>

                  {/* Zoom Controls */}
                  <div className="flex items-center gap-1 border rounded-md">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                    >
                      <ZoomOut className="h-3 w-3" />
                    </Button>
                    <span className="text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setZoom(Math.min(3, zoom + 0.25))}
                    >
                      <ZoomIn className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setZoom(1)}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {selectedGroup ? (
                <>
                  {/* Timeline Selector */}
                  <div className="mb-4 flex items-center gap-4">
                    <div className="flex-1">
                      <Label className="text-xs mb-1 block">{t('annotation.comparison.leftImage')}</Label>
                      <Select
                        value={leftIndex.toString()}
                        onValueChange={(v) => setLeftIndex(parseInt(v))}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedGroup.inspections.map((item, idx) => (
                            <SelectItem key={idx} value={idx.toString()}>
                              {format(new Date(item.inspectionTime), 'dd/MM/yyyy HH:mm')} - {item.result}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          if (leftIndex > 0) setLeftIndex(leftIndex - 1);
                        }}
                        disabled={leftIndex === 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          if (rightIndex < selectedGroup.inspections.length - 1) setRightIndex(rightIndex + 1);
                        }}
                        disabled={rightIndex === selectedGroup.inspections.length - 1}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs mb-1 block">{t('annotation.comparison.rightImage')}</Label>
                      <Select
                        value={rightIndex.toString()}
                        onValueChange={(v) => setRightIndex(parseInt(v))}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedGroup.inspections.map((item, idx) => (
                            <SelectItem key={idx} value={idx.toString()}>
                              {format(new Date(item.inspectionTime), 'dd/MM/yyyy HH:mm')} - {item.result}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Comparison View */}
                  {viewMode === 'side-by-side' ? (
                    <div className="flex gap-4">
                      {renderImageWithAnnotations(leftItem, t('annotation.comparison.before'), 'border-info')}
                      {renderImageWithAnnotations(rightItem, t('annotation.comparison.after'), 'border-success')}
                    </div>
                  ) : (
                    <div className="relative min-h-100 bg-muted rounded-lg overflow-hidden">
                      {/* Base image (left) */}
                      {leftItem && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <img
                            src={leftItem.imageUrl}
                            alt="Base"
                            className="max-w-full max-h-full object-contain"
                            style={{ transform: `scale(${zoom})` }}
                          />
                          {showAnnotations && renderAnnotationOverlay(leftItem.annotations)}
                        </div>
                      )}
                      {/* Overlay image (right) */}
                      {rightItem && (
                        <div 
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ opacity: overlayOpacity }}
                        >
                          <img
                            src={rightItem.imageUrl}
                            alt="Overlay"
                            className="max-w-full max-h-full object-contain"
                            style={{ transform: `scale(${zoom})` }}
                          />
                          {showAnnotations && renderAnnotationOverlay(rightItem.annotations)}
                        </div>
                      )}
                      {/* Opacity slider */}
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-background/80 backdrop-blur-sm rounded-lg p-3 flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{t('annotation.comparison.before')}</span>
                        <Slider
                          min={0}
                          max={1}
                          step={0.1}
                          value={[overlayOpacity]}
                          onValueChange={(v) => setOverlayOpacity(v[0])}
                          className="w-32"
                        />
                        <span className="text-xs text-muted-foreground">{t('annotation.comparison.after')}</span>
                      </div>
                    </div>
                  )}

                  {/* Annotation Diff Summary */}
                  {annotationDiff && (
                    <div className="mt-4 p-3 bg-muted rounded-lg">
                      <h4 className="text-sm font-medium mb-2">{t('annotation.comparison.compareAnnotations')}</h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-info font-medium">{t('annotation.comparison.before')}:</span>
                          <span className="ml-2">{annotationDiff.leftOnly} annotations</span>
                          <div className="flex items-center gap-2 mt-1">
                            {Object.entries(annotationDiff.leftByType).map(([type, count]) => {
                              const Icon = annotationTypeIcons[type] || Square;
                              return (
                                <span key={type} className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Icon className="h-3 w-3" />
                                  {count}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <span className="text-success font-medium">{t('annotation.comparison.after')}:</span>
                          <span className="ml-2">{annotationDiff.rightOnly} annotations</span>
                          <div className="flex items-center gap-2 mt-1">
                            {Object.entries(annotationDiff.rightByType).map(([type, count]) => {
                              const Icon = annotationTypeIcons[type] || Square;
                              return (
                                <span key={type} className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Icon className="h-3 w-3" />
                                  {count}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-100 text-muted-foreground">
                  <div className="text-center">
                    <GitCompare className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>{t('annotation.comparison.selectFromList')}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="flex items-center justify-center h-50 text-muted-foreground">
            <div className="text-center">
              <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{t('annotation.comparison.enterSerialOrFilter')}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
