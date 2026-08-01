import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { PageHeader } from '@/components/patterns';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Database,
  ImageIcon,
  Layers,
  Play,
  Pause,
  RefreshCw,
  Upload,
  Download,
  Filter,
  Crop,
  RotateCw,
  Maximize2,
  Sliders,
  BarChart3,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Wand2,
  FlipHorizontal,
  Contrast,
  Palette,
  FolderOpen,
  FileImage,
  ListChecks,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ModelSelect, DatasetSelect } from '@/components/ai/ModelSelect';
import { Loader2, PieChart } from 'lucide-react';

type PipelineStatus = 'idle' | 'running' | 'completed' | 'error';
type AugmentationType = 'flip' | 'rotate' | 'brightness' | 'contrast' | 'noise' | 'crop' | 'resize' | 'blur';

const AUGMENTATION_OPTIONS: { type: AugmentationType; icon: React.ReactNode; label: string }[] = [
  { type: 'flip', icon: <FlipHorizontal className="h-4 w-4" />, label: 'Flip' },
  { type: 'rotate', icon: <RotateCw className="h-4 w-4" />, label: 'Rotate' },
  { type: 'brightness', icon: <Contrast className="h-4 w-4" />, label: 'Brightness' },
  { type: 'contrast', icon: <Sliders className="h-4 w-4" />, label: 'Contrast' },
  { type: 'noise', icon: <Palette className="h-4 w-4" />, label: 'Noise' },
  { type: 'crop', icon: <Crop className="h-4 w-4" />, label: 'Random Crop' },
  { type: 'resize', icon: <Maximize2 className="h-4 w-4" />, label: 'Resize' },
  { type: 'blur', icon: <Filter className="h-4 w-4" />, label: 'Blur' },
];

export default function AIDataProcessingPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('pipeline');

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <PageHeader
          icon={<Database className="h-6 w-6" />}
          title={t('aiDataProcessing.title', 'Data Processing')}
          description={t('aiDataProcessing.description', 'Process, augment, and prepare image data for AI model training')}
        />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 max-w-2xl">
            <TabsTrigger value="pipeline" className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              {t('aiDataProcessing.tabs.pipeline', 'Data Pipeline')}
            </TabsTrigger>
            <TabsTrigger value="dataset" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              {t('aiDataProcessing.tabs.dataset', 'Dataset Split')}
            </TabsTrigger>
            <TabsTrigger value="preprocessing" className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              {t('aiDataProcessing.tabs.preprocessing', 'Image Processing')}
            </TabsTrigger>
            <TabsTrigger value="augmentation" className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" />
              {t('aiDataProcessing.tabs.augmentation', 'Augmentation')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pipeline" className="space-y-4">
            <DataPipelineSection />
          </TabsContent>

          <TabsContent value="dataset" className="space-y-4">
            <DatasetSplitSection />
          </TabsContent>

          <TabsContent value="preprocessing" className="space-y-4">
            <ImagePreprocessingSection />
          </TabsContent>

          <TabsContent value="augmentation" className="space-y-4">
            <AugmentationSection />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// ─── Dataset Split Section (WS-1) ────────────────────────────────────────────

function DatasetSplitSection() {
  const { t } = useTranslation();
  const [datasetId, setDatasetId] = useState('');
  const [result, setResult] = useState<{
    datasetId: number;
    totalSamples: number;
    labelDistribution: Record<string, number>;
    split: { train: number; val: number; test: number };
    labels: string[];
  } | null>(null);

  const buildDataset = trpc.aiEval.buildDataset.useMutation({
    onSuccess: (data) => {
      setResult(data);
      toast.success(
        t('aiDataProcessing.dataset.built', 'Đã build dataset: {{count}} mẫu', {
          count: data.totalSamples,
        }),
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const splitTotal = result ? result.split.train + result.split.val + result.split.test : 0;
  const pct = (n: number) => (splitTotal > 0 ? ((n / splitTotal) * 100).toFixed(1) : '0');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('aiDataProcessing.dataset.title', 'Tạo Dataset Split')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('aiDataProcessing.dataset.description', 'Materialize dataset train/val/test từ dữ liệu đã gán nhãn')}
        </p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-64">
            <Label>{t('aiEval.dataset', 'Dataset')}</Label>
            <DatasetSelect value={datasetId} onChange={setDatasetId} />
          </div>
          <Button
            onClick={() => datasetId && buildDataset.mutate({ datasetId: Number(datasetId) })}
            disabled={!datasetId || buildDataset.isPending}
            className="flex items-center gap-2"
          >
            {buildDataset.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {t('aiDataProcessing.dataset.build', 'Build Dataset')}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <>
          {/* Summary */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{result.totalSamples.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{t('aiDataProcessing.dataset.totalSamples', 'Tổng số mẫu')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-info">{result.split.train.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Train ({pct(result.split.train)}%)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-warning">{result.split.val.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Val ({pct(result.split.val)}%)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-success">{result.split.test.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Test ({pct(result.split.test)}%)</p>
              </CardContent>
            </Card>
          </div>

          {/* Split ratio bar */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('aiDataProcessing.dataset.splitRatio', 'Tỉ lệ Train/Val/Test')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-4 w-full overflow-hidden rounded-full">
                <div className="bg-info" style={{ width: `${pct(result.split.train)}%` }} title={`Train ${pct(result.split.train)}%`} />
                <div className="bg-warning" style={{ width: `${pct(result.split.val)}%` }} title={`Val ${pct(result.split.val)}%`} />
                <div className="bg-success" style={{ width: `${pct(result.split.test)}%` }} title={`Test ${pct(result.split.test)}%`} />
              </div>
            </CardContent>
          </Card>

          {/* Label distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <PieChart className="h-4 w-4" />
                {t('aiDataProcessing.dataset.labelDistribution', 'Phân bố nhãn')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(result.labelDistribution).map(([label, count]) => {
                  const p = result.totalSamples > 0 ? (count / result.totalSamples) * 100 : 0;
                  return (
                    <div key={label} className="flex items-center gap-2">
                      <span className="w-28 text-sm truncate">{label}</span>
                      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${p}%` }} />
                      </div>
                      <span className="w-20 text-sm text-right">{count} ({p.toFixed(0)}%)</span>
                    </div>
                  );
                })}
                {Object.keys(result.labelDistribution).length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('common.noData', 'Không có dữ liệu')}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Data Pipeline Section ───────────────────────────────────────────────────

function DataPipelineSection() {
  const { t } = useTranslation();
  const { data: pipelineStats, isLoading } = trpc.aiSettings.getDataPipelineStats.useQuery();
  const runPipelineMutation = trpc.aiSettings.runDataPipeline.useMutation({
    onSuccess: () => {
      toast.success(t('aiDataProcessing.pipeline.started', 'Pipeline started'));
    },
    onError: (err) => {
      toast.error(`${t('common.error', 'Error')}: ${err.message}`);
    },
  });

  const stats = pipelineStats?.stats ?? {
    totalImages: 0,
    processedImages: 0,
    pendingImages: 0,
    failedImages: 0,
    lastRunAt: null,
    status: 'idle' as PipelineStatus,
  };

  const progress = stats.totalImages > 0 ? (stats.processedImages / stats.totalImages) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('aiDataProcessing.pipeline.title', 'Data Pipeline')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('aiDataProcessing.pipeline.description', 'Manage the data processing pipeline for training datasets')}
          </p>
        </div>
        <Button
          onClick={() => runPipelineMutation.mutate({})}
          disabled={runPipelineMutation.isPending || stats.status === 'running'}
          className="flex items-center gap-2"
        >
          {stats.status === 'running' ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {stats.status === 'running'
            ? t('aiDataProcessing.pipeline.running', 'Running...')
            : t('aiDataProcessing.pipeline.run', 'Run Pipeline')}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-info/10">
                <FileImage className="h-5 w-5 text-info" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalImages.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{t('aiDataProcessing.pipeline.total', 'Total Images')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.processedImages.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{t('aiDataProcessing.pipeline.processed', 'Processed')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <Clock className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.pendingImages.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{t('aiDataProcessing.pipeline.pending', 'Pending')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.failedImages.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{t('aiDataProcessing.pipeline.failed', 'Failed')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress */}
      {stats.totalImages > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{t('aiDataProcessing.pipeline.progress', 'Processing Progress')}</span>
              <span className="font-medium">{progress.toFixed(1)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            {stats.lastRunAt && (
              <p className="text-xs text-muted-foreground">
                {t('aiDataProcessing.pipeline.lastRun', 'Last run')}: {format(new Date(stats.lastRunAt), 'dd/MM/yyyy HH:mm')}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pipeline Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('aiDataProcessing.pipeline.config', 'Pipeline Configuration')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('aiDataProcessing.pipeline.sourceDir', 'Source Directory')}</Label>
              <div className="flex gap-2">
                <Input value="uploads/inspection-images" readOnly className="font-mono text-sm" />
                <Button variant="outline" size="icon">
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('aiDataProcessing.pipeline.outputDir', 'Output Directory')}</Label>
              <div className="flex gap-2">
                <Input value="uploads/processed" readOnly className="font-mono text-sm" />
                <Button variant="outline" size="icon">
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t('aiDataProcessing.pipeline.batchSize', 'Batch Size')}</Label>
              <Input type="number" defaultValue="32" min="1" max="256" />
            </div>
            <div className="space-y-2">
              <Label>{t('aiDataProcessing.pipeline.workers', 'Worker Threads')}</Label>
              <Input type="number" defaultValue="4" min="1" max="16" />
            </div>
            <div className="space-y-2">
              <Label>{t('aiDataProcessing.pipeline.format', 'Output Format')}</Label>
              <Select defaultValue="png">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="jpg">JPEG</SelectItem>
                  <SelectItem value="webp">WebP</SelectItem>
                  <SelectItem value="tiff">TIFF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Run History */}
      <PipelineRunHistory />
    </div>
  );
}

function PipelineRunHistory() {
  const { t } = useTranslation();
  const { data: history = [], isLoading } = trpc.aiSettings.getPipelineHistory.useQuery();

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!history || history.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ListChecks className="h-4 w-4" />
          {t('aiDataProcessing.pipeline.runHistory', 'Run History')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-56">
          <div className="space-y-2">
            {history.map((run: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm border rounded px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant={run.status === 'completed' ? 'default' : 'destructive'} className="text-xs">
                    {run.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {run.startedAt ? format(new Date(run.startedAt), 'dd/MM/yyyy HH:mm') : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="text-success">{run.processedCount ?? 0} {t('aiDataProcessing.pipeline.ok', 'ok')}</span>
                  {(run.failedCount ?? 0) > 0 && (
                    <span className="text-destructive">{run.failedCount} {t('aiDataProcessing.pipeline.failed', 'failed')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ─── Image Preprocessing Section ─────────────────────────────────────────────

function ImagePreprocessingSection() {
  const { t } = useTranslation();
  const [targetWidth, setTargetWidth] = useState('640');
  const [targetHeight, setTargetHeight] = useState('640');
  const [normalize, setNormalize] = useState(true);
  const [grayscale, setGrayscale] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [autoContrast, setAutoContrast] = useState(true);
  const [resizeMode, setResizeMode] = useState('letterbox');

  const { data: savedConfig } = trpc.aiSettings.getPreprocessingConfig.useQuery();
  const saveConfig = trpc.aiSettings.savePreprocessingConfig.useMutation({
    onSuccess: () => toast.success(t('aiDataProcessing.preprocessing.saved', 'Đã lưu cấu hình')),
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (!savedConfig) return;
    setTargetWidth(savedConfig.targetWidth ?? '640');
    setTargetHeight(savedConfig.targetHeight ?? '640');
    setNormalize(savedConfig.normalize ?? true);
    setGrayscale(savedConfig.grayscale ?? false);
    setRemoveBackground(savedConfig.removeBackground ?? false);
    setAutoContrast(savedConfig.autoContrast ?? true);
    setResizeMode(savedConfig.resizeMode ?? 'letterbox');
  }, [savedConfig]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('aiDataProcessing.preprocessing.title', 'Image Preprocessing')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('aiDataProcessing.preprocessing.description', 'Configure image preprocessing steps before model training')}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Resize Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Maximize2 className="h-4 w-4" />
              {t('aiDataProcessing.preprocessing.resize', 'Resize')}
            </CardTitle>
            <CardDescription>
              {t('aiDataProcessing.preprocessing.resizeDesc', 'Target dimensions for processed images')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('aiDataProcessing.preprocessing.width', 'Width')}</Label>
                <Input type="number" value={targetWidth} onChange={(e) => setTargetWidth(e.target.value)} min="32" max="4096" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('aiDataProcessing.preprocessing.height', 'Height')}</Label>
                <Input type="number" value={targetHeight} onChange={(e) => setTargetHeight(e.target.value)} min="32" max="4096" />
              </div>
            </div>
            <Select value={resizeMode} onValueChange={setResizeMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="letterbox">{t('aiDataProcessing.preprocessing.letterbox', 'Letterbox (preserve ratio)')}</SelectItem>
                <SelectItem value="stretch">{t('aiDataProcessing.preprocessing.stretch', 'Stretch')}</SelectItem>
                <SelectItem value="center_crop">{t('aiDataProcessing.preprocessing.centerCrop', 'Center Crop')}</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Color Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Palette className="h-4 w-4" />
              {t('aiDataProcessing.preprocessing.color', 'Color Processing')}
            </CardTitle>
            <CardDescription>
              {t('aiDataProcessing.preprocessing.colorDesc', 'Color space and normalization options')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">{t('aiDataProcessing.preprocessing.normalize', 'Normalize (0-1)')}</span>
              <Switch checked={normalize} onCheckedChange={setNormalize} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">{t('aiDataProcessing.preprocessing.grayscale', 'Convert to Grayscale')}</span>
              <Switch checked={grayscale} onCheckedChange={setGrayscale} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">{t('aiDataProcessing.preprocessing.autoContrast', 'Auto Contrast (CLAHE)')}</span>
              <Switch checked={autoContrast} onCheckedChange={setAutoContrast} />
            </div>
          </CardContent>
        </Card>

        {/* Background Removal */}
        <Card className="md:col-span-2">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium flex items-center gap-2">
                  <Wand2 className="h-4 w-4" />
                  {t('aiDataProcessing.preprocessing.bgRemoval', 'Background Removal')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('aiDataProcessing.preprocessing.bgRemovalDesc', 'Automatically remove image backgrounds for cleaner defect detection')}
                </p>
              </div>
              <Switch checked={removeBackground} onCheckedChange={setRemoveBackground} />
            </div>
          </CardContent>
        </Card>

        {/* Save Config */}
        <Card className="md:col-span-2">
          <CardContent className="p-4 flex justify-end">
            <Button
              onClick={() =>
                saveConfig.mutate({
                  targetWidth,
                  targetHeight,
                  normalize,
                  grayscale,
                  removeBackground,
                  autoContrast,
                  resizeMode,
                })
              }
              disabled={saveConfig.isPending}
            >
              {saveConfig.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              {t('aiDataProcessing.preprocessing.saveConfig', 'Lưu cấu hình')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Augmentation Section ────────────────────────────────────────────────────

function AugmentationSection() {
  const { t } = useTranslation();
  const [selectedAugmentations, setSelectedAugmentations] = useState<Set<AugmentationType>>(new Set(['flip', 'rotate', 'brightness']));
  const [multiplier, setMultiplier] = useState('3');

  const toggleAugmentation = (type: AugmentationType) => {
    setSelectedAugmentations(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const runAugmentationMutation = trpc.aiSettings.runAugmentation.useMutation({
    onSuccess: (result) => {
      toast.success(t('aiDataProcessing.augmentation.success', 'Augmentation completed'));
    },
    onError: (err) => {
      toast.error(`${t('common.error', 'Error')}: ${err.message}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('aiDataProcessing.augmentation.title', 'Data Augmentation')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('aiDataProcessing.augmentation.description', 'Generate synthetic training data from existing images to improve model robustness')}
          </p>
        </div>
        <Button
          onClick={() => runAugmentationMutation.mutate({
            augmentations: Array.from(selectedAugmentations),
            multiplier: Number(multiplier),
          })}
          disabled={runAugmentationMutation.isPending || selectedAugmentations.size === 0}
          className="flex items-center gap-2"
        >
          {runAugmentationMutation.isPending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
          {t('aiDataProcessing.augmentation.run', 'Run Augmentation')}
        </Button>
      </div>

      {/* Multiplier */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <Label className="whitespace-nowrap">{t('aiDataProcessing.augmentation.multiplier', 'Augmentation Multiplier')}</Label>
            <Input
              type="number"
              min="1"
              max="20"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">
              {t('aiDataProcessing.augmentation.multiplierDesc', 'Number of augmented copies per original image')}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Augmentation Types */}
      <div className="grid gap-3 md:grid-cols-4 sm:grid-cols-2">
        {AUGMENTATION_OPTIONS.map((aug) => {
          const isSelected = selectedAugmentations.has(aug.type);
          return (
            <Card
              key={aug.type}
              className={cn(
                'cursor-pointer transition-colors border-2',
                isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:border-muted-foreground/20'
              )}
              onClick={() => toggleAugmentation(aug.type)}
            >
              <CardContent className="p-4 flex flex-col items-center gap-2 text-center">
                <div className={cn(
                  'p-3 rounded-lg',
                  isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}>
                  {aug.icon}
                </div>
                <span className="text-sm font-medium">{aug.label}</span>
                {isSelected && (
                  <Badge variant="default" className="text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    {t('aiDataProcessing.augmentation.active', 'Active')}
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Preview / Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            {t('aiDataProcessing.augmentation.summary', 'Augmentation Summary')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('aiDataProcessing.augmentation.selectedOps', 'Selected Operations')}</span>
              <span className="font-medium">{selectedAugmentations.size}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('aiDataProcessing.augmentation.multiplierLabel', 'Multiplier')}</span>
              <span className="font-medium">{multiplier}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('aiDataProcessing.augmentation.operations', 'Operations')}</span>
              <span className="font-mono text-xs">
                {Array.from(selectedAugmentations).join(', ') || '—'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
