import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
// doc 64 IA-10 S3 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Map,
  Upload,
  Filter,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Info,
  AlertTriangle,
  Square,
  Circle,
  ArrowRight,
  Pencil,
  Type,
  Factory,
  Cpu,
  TrendingUp,
  Calendar,
  Radio,
  Bell,
  Sparkles,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';

interface MachineDefect {
  machineId: number;
  machineName: string;
  positionX: number | null;
  positionY: number | null;
  defectCount: number;
  defectsByType: Record<string, number>;
  defectsByColor: Record<string, number>;
  recentDefects: Array<{
    type: string;
    color: string;
    text?: string;
    inspectionTime: string;
    productModel: string;
    measurementPoint: string;
  }>;
  intensity: number;
}

interface HeatmapPoint {
  x: number;
  y: number;
  intensity: number;
  machineId: number;
  machineName: string;
  annotationType: string;
  color: string;
}

const annotationTypeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  rectangle: Square,
  circle: Circle,
  arrow: ArrowRight,
  freehand: Pencil,
  text: Type,
};

const annotationTypeLabels: Record<string, string> = {
  rectangle: 'defects.heatmap.typeRectangle',
  circle: 'defects.heatmap.typeCircle',
  arrow: 'defects.heatmap.typeArrow',
  freehand: 'defects.heatmap.typeFreehand',
  text: 'defects.heatmap.typeText',
};

// Default factory layout dimensions
const DEFAULT_LAYOUT_WIDTH = 800;
const DEFAULT_LAYOUT_HEIGHT = 600;

// Color scale for heatmap
const getHeatmapColor = (intensity: number): string => {
  // Green -> Yellow -> Orange -> Red
  if (intensity < 0.25) return `rgba(34, 197, 94, ${0.3 + intensity * 2})`; // Green
  if (intensity < 0.5) return `rgba(234, 179, 8, ${0.4 + intensity})`; // Yellow
  if (intensity < 0.75) return `rgba(249, 115, 22, ${0.5 + intensity * 0.5})`; // Orange
  return `rgba(239, 68, 68, ${0.6 + intensity * 0.4})`; // Red
};

export function DefectHeatmap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [machineId, setMachineId] = useState<number | undefined>();
  const [productModelId, setProductModelId] = useState<number | undefined>();
  const [annotationType, setAnnotationType] = useState<string | undefined>();
  // doc 64 IA-10 S3-B — trục phạm vi seed máy (picker tại-tab vẫn đổi được sau).
  const { scope: assetScope } = useScope(["machine"]);
  useScopeWired();
  useEffect(() => {
    if (assetScope.machineId !== undefined) setMachineId(assetScope.machineId);
  }, [assetScope.machineId]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [zoom, setZoom] = useState(1);
  const [selectedMachine, setSelectedMachine] = useState<MachineDefect | null>(null);
  const [layoutImage, setLayoutImage] = useState<string | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  
  // Real-time updates state (default OFF per user preference)
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds
  const [newDefectsCount, setNewDefectsCount] = useState(0);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const previousDefectCount = useRef<number>(0);
  const { t } = useTranslation();

  // Fetch heatmap data
  const { data: heatmapData, isLoading, refetch } = trpc.annotation.heatmapData.useQuery({
    machineId,
    productModelId,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    annotationType,
  });

  // Fetch machines for filter
  const { data: machines } = trpc.machine.list.useQuery();
  
  // Fetch product models for filter
  const { data: productModels } = trpc.productModel.list.useQuery();

  // Draw heatmap on canvas
  const drawHeatmap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heatmapData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background
    if (layoutImage) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        drawDefectOverlay(ctx);
      };
      img.src = layoutImage;
    } else {
      // Draw default grid background
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw grid
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 1;
      const gridSize = 50;
      for (let x = 0; x <= canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      
      drawDefectOverlay(ctx);
    }
  }, [heatmapData, layoutImage]);

  const drawDefectOverlay = (ctx: CanvasRenderingContext2D) => {
    if (!heatmapData) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Draw heatmap points with gradient
    heatmapData.heatmapPoints.forEach((point) => {
      const gradient = ctx.createRadialGradient(
        point.x, point.y, 0,
        point.x, point.y, 30
      );
      gradient.addColorStop(0, getHeatmapColor(point.intensity));
      gradient.addColorStop(1, 'transparent');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 30, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw machine markers
    heatmapData.machines.forEach((machine) => {
      if (machine.positionX === null || machine.positionY === null) return;

      const x = machine.positionX;
      const y = machine.positionY;
      const size = 20 + machine.intensity * 20;

      // Draw machine circle
      ctx.fillStyle = getHeatmapColor(machine.intensity);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();

      // Draw border
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw machine icon
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(machine.defectCount.toString(), x, y);

      // Draw machine name
      ctx.font = '10px sans-serif';
      ctx.fillText(machine.machineName, x, y + size + 10);
    });
  };

  useEffect(() => {
    drawHeatmap();
  }, [drawHeatmap]);

  // Track defect count changes and show notifications
  useEffect(() => {
    if (heatmapData) {
      const currentCount = heatmapData.summary.totalDefects;
      if (previousDefectCount.current > 0 && currentCount > previousDefectCount.current) {
        const newCount = currentCount - previousDefectCount.current;
        setNewDefectsCount(prev => prev + newCount);
        
        // Show notification for new defects
        toast.error(t('defects.heatmap.newDefectsDetected', { count: newCount }));
      }
      previousDefectCount.current = currentCount;
      setLastRefreshTime(new Date());
    }
  }, [heatmapData]);

  // Auto-refresh interval (default OFF)
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      refetch();
    }, refreshInterval * 1000);
    
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refetch]);

  // Handle canvas click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !heatmapData) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Find clicked machine
    const clickedMachine = heatmapData.machines.find((machine) => {
      if (machine.positionX === null || machine.positionY === null) return false;
      const distance = Math.sqrt(
        Math.pow(x - machine.positionX, 2) + Math.pow(y - machine.positionY, 2)
      );
      return distance < 30;
    });

    if (clickedMachine) {
      setSelectedMachine(clickedMachine);
    }
  };

  // Handle layout image upload
  const handleLayoutUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setLayoutImage(event.target?.result as string);
        setShowUploadDialog(false);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Map className="h-5 w-5" />
            {t('defects.heatmap.title')}
          </CardTitle>
          <CardDescription>
            {t('defects.heatmap.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>{t('defects.heatmap.machine')}</Label>
              <Select
                value={machineId?.toString() || 'all'}
                onValueChange={(v) => setMachineId(v && v !== 'all' ? parseInt(v) : undefined)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('defects.heatmap.allMachines')} />
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
              <Label>{t('defects.heatmap.productModel')}</Label>
              <Select
                value={productModelId?.toString() || 'all'}
                onValueChange={(v) => setProductModelId(v && v !== 'all' ? parseInt(v) : undefined)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('defects.heatmap.allModels')} />
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
              <Label>{t('defects.heatmap.annotationType')}</Label>
              <Select
                value={annotationType || 'all'}
                onValueChange={(v) => setAnnotationType(v && v !== 'all' ? v : undefined)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('defects.heatmap.allTypes')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all')}</SelectItem>
                  {Object.entries(annotationTypeLabels).map(([type, label]) => (
                    <SelectItem key={type} value={type}>
                      {t(label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('defects.heatmap.dateFrom')}</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('defects.heatmap.dateTo')}</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 mt-4">
            <Button onClick={() => refetch()} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {t('common.refresh')}
            </Button>
            <Button onClick={() => setShowUploadDialog(true)} variant="outline" className="gap-2">
              <Upload className="h-4 w-4" />
              {t('defects.heatmap.uploadLayout')}
            </Button>
            
            {/* Auto-refresh controls */}
            <div className="flex items-center gap-2 ml-auto border rounded-lg px-3 py-2 bg-muted/50">
              <Radio className={cn("h-4 w-4", autoRefresh && "text-green-500 animate-pulse")} />
              <Label htmlFor="auto-refresh" className="text-sm cursor-pointer">
                {t('defects.heatmap.autoRefresh')}
              </Label>
              <Switch
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
              {autoRefresh && (
                <Select
                  value={refreshInterval.toString()}
                  onValueChange={(v) => setRefreshInterval(parseInt(v))}
                >
                  <SelectTrigger className="w-24 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">{t('defects.heatmap.10seconds')}</SelectItem>
                    <SelectItem value="30">{t('defects.heatmap.30seconds')}</SelectItem>
                    <SelectItem value="60">{t('defects.heatmap.1minute')}</SelectItem>
                    <SelectItem value="300">{t('defects.heatmap.5minutes')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            
            {/* New defects indicator */}
            {newDefectsCount > 0 && (
              <Badge variant="destructive" className="gap-1 animate-pulse">
                <Sparkles className="h-3 w-3" />
                +{newDefectsCount} {t('defects.heatmap.new')}
              </Badge>
            )}
            
            {/* Last refresh time */}
            {lastRefreshTime && (
              <span className="text-xs text-muted-foreground">
                {t('defects.heatmap.lastUpdate')}: {format(lastRefreshTime, 'HH:mm:ss', { locale: vi })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Heatmap and Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Heatmap Canvas */}
        <Card className="lg:col-span-3">
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{t('defects.heatmap.factoryLayout')}</CardTitle>
              <div className="flex items-center gap-2">
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
            {isLoading ? (
              <Skeleton className="w-full h-[500px]" />
            ) : (
              <div 
                ref={containerRef}
                className="relative overflow-auto bg-muted rounded-lg"
                style={{ maxHeight: '600px' }}
              >
                <canvas
                  ref={canvasRef}
                  width={DEFAULT_LAYOUT_WIDTH}
                  height={DEFAULT_LAYOUT_HEIGHT}
                  onClick={handleCanvasClick}
                  className="cursor-pointer"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: 'top left',
                  }}
                />
                
                {/* Color Legend */}
                <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm rounded-lg p-3">
                  <p className="text-xs font-medium mb-2">{t('defects.heatmap.defectDensity')}</p>
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: getHeatmapColor(0.1) }} />
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: getHeatmapColor(0.3) }} />
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: getHeatmapColor(0.5) }} />
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: getHeatmapColor(0.7) }} />
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: getHeatmapColor(0.9) }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>{t('defects.heatmap.low')}</span>
                    <span>{t('defects.heatmap.high')}</span>
                  </div>
                </div>

                {/* No layout hint */}
                {!layoutImage && (
                  <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm rounded-lg p-3 flex items-center gap-2">
                    <Info className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {t('defects.heatmap.uploadLayoutHint')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Summary Panel */}
        <div className="space-y-4">
          {/* Summary Stats */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                {t('defects.heatmap.overview')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-red-500">
                    {heatmapData?.summary.totalDefects || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('defects.heatmap.totalDefects')}</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-orange-500">
                    {heatmapData?.summary.machinesWithDefects || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('defects.heatmap.machinesWithDefects')}</p>
                </div>
              </div>

              {/* Top Defect Types */}
              {heatmapData?.summary.topDefectTypes && heatmapData.summary.topDefectTypes.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-2">{t('defects.heatmap.topDefectTypes')}</p>
                  <div className="space-y-2">
                    {heatmapData.summary.topDefectTypes.map(([type, count]) => {
                      const Icon = annotationTypeIcons[type] || Square;
                      const total = heatmapData.summary.totalDefects || 1;
                      const percentage = Math.round((count / total) * 100);
                      return (
                        <div key={type} className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-xs flex-1">{t(annotationTypeLabels[type] || type)}</span>
                          <Badge variant="secondary" className="text-xs">
                            {count} ({percentage}%)
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Machine List */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                {t('defects.heatmap.machinesCount', { count: heatmapData?.machines.length || 0 })}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[300px]">
                <div className="space-y-1 p-2">
                  {heatmapData?.machines
                    .sort((a, b) => b.defectCount - a.defectCount)
                    .map((machine) => (
                      <TooltipProvider key={machine.machineId}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant={selectedMachine?.machineId === machine.machineId ? 'secondary' : 'ghost'}
                              className="w-full justify-start text-left h-auto py-2"
                              onClick={() => setSelectedMachine(machine)}
                            >
                              <div 
                                className="w-3 h-3 rounded-full mr-2"
                                style={{ backgroundColor: getHeatmapColor(machine.intensity) }}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate text-sm">{machine.machineName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {machine.defectCount} defects
                                </p>
                              </div>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            <div className="text-xs space-y-1">
                              {Object.entries(machine.defectsByType).map(([type, count]) => (
                                <div key={type} className="flex items-center gap-2">
                                  <span>{t(annotationTypeLabels[type] || type)}:</span>
                                  <span className="font-medium">{count}</span>
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Machine Detail Dialog */}
      <Dialog open={!!selectedMachine} onOpenChange={() => setSelectedMachine(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Factory className="h-5 w-5" />
              {selectedMachine?.machineName}
            </DialogTitle>
            <DialogDescription>
              {t('defects.heatmap.machineDefectDetail')}
            </DialogDescription>
          </DialogHeader>
          
          {selectedMachine && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold" style={{ color: getHeatmapColor(selectedMachine.intensity) }}>
                    {selectedMachine.defectCount}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('defects.heatmap.totalDefects')}</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-blue-500">
                    {Object.keys(selectedMachine.defectsByType).length}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('defects.heatmap.defectTypes')}</p>
                </div>
              </div>

              {/* Defects by Type */}
              <div>
                <p className="text-sm font-medium mb-2">{t('defects.heatmap.distributionByType')}</p>
                <div className="space-y-2">
                  {Object.entries(selectedMachine.defectsByType).map(([type, count]) => {
                    const Icon = annotationTypeIcons[type] || Square;
                    const percentage = Math.round((count / selectedMachine.defectCount) * 100);
                    return (
                      <div key={type} className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm flex-1">{t(annotationTypeLabels[type] || type)}</span>
                        <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-12 text-right">
                          {count} ({percentage}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent Defects */}
              {selectedMachine.recentDefects.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">{t('defects.heatmap.recentDefects')}</p>
                  <ScrollArea className="h-[150px]">
                    <div className="space-y-2">
                      {selectedMachine.recentDefects.map((defect, idx) => {
                        const Icon = annotationTypeIcons[defect.type] || Square;
                        return (
                          <div key={idx} className="flex items-start gap-2 p-2 bg-muted rounded-lg">
                            <div 
                              className="w-3 h-3 rounded-full mt-1"
                              style={{ backgroundColor: defect.color }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <Icon className="h-3 w-3" />
                                <span className="text-xs font-medium">
                                  {t(annotationTypeLabels[defect.type] || defect.type)}
                                </span>
                              </div>
                              {defect.text && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {defect.text}
                                </p>
                              )}
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                <Calendar className="h-3 w-3" />
                                {format(new Date(defect.inspectionTime), 'dd/MM/yyyy HH:mm', { locale: vi })}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {defect.productModel} • {defect.measurementPoint}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Upload Layout Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('defects.heatmap.uploadLayout')}</DialogTitle>
            <DialogDescription>
              {t('defects.heatmap.uploadLayoutDescription')}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-4">
                {t('defects.heatmap.dragOrClick')}
              </p>
              <Input
                type="file"
                accept="image/*"
                onChange={handleLayoutUpload}
                className="max-w-xs mx-auto"
              />
            </div>
            
            <div className="text-xs text-muted-foreground">
              <p>{t('defects.heatmap.supportedFormats')}</p>
              <p>{t('defects.heatmap.recommendedSize')}</p>
            </div>

            {layoutImage && (
              <Button 
                variant="outline" 
                onClick={() => setLayoutImage(null)}
                className="w-full"
              >
                {t('defects.heatmap.removeLayout')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DefectHeatmap;
