import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import {
  PageHeader,
  PageContainer,
  MetricCard,
  StatusBadge,
  EmptyState,
} from '@/components/patterns';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Target,
  BarChart3,
  PieChart,
  RefreshCw,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Database,
  Award,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { BatchCommentsSection } from '@/components/BatchCommentsSection';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { toastTrpcError } from '@/lib/trpcErrors';
import { Loader2 } from 'lucide-react';
import { ModelSelect } from '@/components/ai/ModelSelect';
import { ReliabilityDiagram } from '@/components/ReliabilityDiagram';
import AnalysisHubSection from '@/components/analytics/AnalysisHubSection';

export default function AIPerformanceDashboard() {
  const { t } = useTranslation();
  const [selectedModelVersion, setSelectedModelVersion] = useState<string>('all');
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  // Fetch dashboard stats
  const { data: dashboardStats, isLoading: statsLoading, refetch: refetchStats } = trpc.aiFeedback.getDashboardStats.useQuery();

  // Fetch training batches
  const { data: trainingBatches, isLoading: batchesLoading } = trpc.aiFeedback.listTrainingBatches.useQuery({
    limit: 10,
  });

  // Fetch recent suggestions with feedback
  const { data: recentSuggestions, isLoading: suggestionsLoading } = trpc.aiFeedback.getPendingSuggestions.useQuery({
    limit: 20,
  });

  // Accuracy is the only classification KPI backed by real data: the backend
  // (aiFeedback.getDashboardStats) computes it as CORRECT / total-feedback over
  // the ai_feedback table. Precision / Recall / F1 / a confusion matrix require
  // labeled per-class ground-truth outcomes (predicted vs actual class), which
  // this system does not capture — ai_feedback only records a subjective
  // CORRECT/INCORRECT/PARTIAL/UNSURE verdict per suggestion. We therefore refuse
  // to synthesize those metrics and surface an honest empty state instead.
  const hasAccuracy = !!dashboardStats && dashboardStats.accuracy > 0;
  const accuracyPct = dashboardStats?.accuracy ?? 0;

  const getStatusBadge = (status: string) => (
    <StatusBadge
      status={status}
      map={{
        COMPLETED: { tone: 'success', label: t('common.completed') },
        PROCESSING: { tone: 'info', label: t('common.processing') },
        PENDING: { tone: 'warning', label: t('common.pending') },
        FAILED: { tone: 'error', label: t('common.failed') },
      }}
    />
  );

  const getFeedbackBadge = (feedback: string) => (
    <StatusBadge
      status={feedback}
      map={{
        CORRECT: { tone: 'success', label: t('reports.correct') },
        INCORRECT: { tone: 'error', label: t('reports.incorrect') },
        PARTIAL: { tone: 'warning', label: t('reports.partial') },
        UNSURE: { tone: 'default', label: t('reports.unsure') },
      }}
    />
  );

  return (
    <DashboardLayout>
      <PageContainer fluid>
        {/* Header */}
        <PageHeader
          icon={<Brain className="h-6 w-6" />}
          title={t('reports.aiModelPerformanceDashboard')}
          description={t('reports.aiModelPerformanceDesc')}
          actions={
            <>
              <Select value={dateRange} onValueChange={(v: '7d' | '30d' | '90d' | 'all') => setDateRange(v)}>
                <SelectTrigger className="w-37.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">{t('common.sevenDays')}</SelectItem>
                  <SelectItem value="30d">{t('common.thirtyDays')}</SelectItem>
                  <SelectItem value="90d">{t('common.ninetyDays')}</SelectItem>
                  <SelectItem value="all">{t('common.all')}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => refetchStats()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
            </>
          }
        />

        {/* Key Metrics — only Accuracy is backed by real labeled feedback.
            Precision / Recall / F1 need a ground-truth confusion matrix that
            this system does not capture, so we show an honest notice instead of
            fabricated numbers. */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <MetricCard
            icon={<Target className="h-5 w-5" />}
            label={t('reports.accuracy', 'Accuracy')}
            value={statsLoading ? '…' : hasAccuracy ? `${accuracyPct.toFixed(1)}%` : t('common.notAvailable', 'N/A')}
            tone={!hasAccuracy ? 'default' : accuracyPct >= 80 ? 'success' : 'warning'}
            delta={
              !hasAccuracy
                ? t('reports.noFeedbackYet', 'No reviewed feedback yet')
                : accuracyPct >= 80
                  ? t('reports.targetMet')
                  : t('reports.needsImprovement')
            }
          />

          <Card className="md:col-span-3">
            <CardContent className="h-full p-0">
              <EmptyState
                variant="no-analytics"
                icon={Award}
                compact
                title={t('reports.classMetricsUnavailable', 'Precision / Recall / F1 unavailable')}
                description={t(
                  'reports.classMetricsUnavailableDesc',
                  'These metrics require labeled ground-truth outcomes (predicted vs actual class per sample). Feedback here records only a correct/incorrect verdict, so they cannot be computed without fabricating numbers.',
                )}
                className="h-full"
              />
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="overview">{t('dashboard.overview')}</TabsTrigger>
            <TabsTrigger value="confusion">{t('reports.confusionMatrix')}</TabsTrigger>
            <TabsTrigger value="calibration">{t('calibration.tab', 'Calibration')}</TabsTrigger>
            <TabsTrigger value="analysisHub">{t('analysisHub.tab', 'Analysis Hub')}</TabsTrigger>
            <TabsTrigger value="batches">{t('reports.trainingBatches')}</TabsTrigger>
            <TabsTrigger value="suggestions">{t('reports.suggestionsHistory')}</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Feedback Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChart className="h-5 w-5" />
                    {t('reports.feedbackDistribution')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {statsLoading ? (
                    <Skeleton className="h-50" />
                  ) : dashboardStats ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-8">
                        <div className="text-center">
                          <div className="text-3xl font-bold text-success">
                            {dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'CORRECT').length || 0}
                          </div>
                          <div className="text-sm text-muted-foreground">{t('reports.correct')}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-3xl font-bold text-destructive">
                            {dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'INCORRECT').length || 0}
                          </div>
                          <div className="text-sm text-muted-foreground">{t('reports.incorrect')}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-3xl font-bold text-warning">
                            {dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'PARTIAL').length || 0}
                          </div>
                          <div className="text-sm text-muted-foreground">{t('reports.partial')}</div>
                        </div>
                      </div>
                      
                      {/* Progress bars */}
                      <div className="space-y-2">
                        {(() => {
                          const total = dashboardStats.recentFeedback?.length || 0;
                          const correct = dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'CORRECT').length || 0;
                          const incorrect = dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'INCORRECT').length || 0;
                          const partial = dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'PARTIAL').length || 0;
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="w-20 text-sm">{t('reports.correct')}</span>
                                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-success transition-all" style={{ width: `${total ? (correct / total) * 100 : 0}%` }} />
                                </div>
                                <span className="w-12 text-sm text-right">{total ? ((correct / total) * 100).toFixed(0) : 0}%</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="w-20 text-sm">{t('reports.incorrect')}</span>
                                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-destructive transition-all" style={{ width: `${total ? (incorrect / total) * 100 : 0}%` }} />
                                </div>
                                <span className="w-12 text-sm text-right">{total ? ((incorrect / total) * 100).toFixed(0) : 0}%</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="w-20 text-sm">{t('reports.partial')}</span>
                                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-warning transition-all" style={{ width: `${total ? (partial / total) * 100 : 0}%` }} />
                                </div>
                                <span className="w-12 text-sm text-right">{total ? ((partial / total) * 100).toFixed(0) : 0}%</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    <EmptyState variant="no-data" compact className="h-50" />
                  )}
                </CardContent>
              </Card>

              {/* Summary Stats */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    {t('reports.summaryStats')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {statsLoading ? (
                    <Skeleton className="h-50" />
                  ) : dashboardStats ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-bold">{dashboardStats.totalSuggestions || 0}</div>
                          <div className="text-sm text-muted-foreground">{t('reports.totalSuggestions')}</div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-bold">{dashboardStats.reviewedToday || 0}</div>
                          <div className="text-sm text-muted-foreground">{t('reports.reviewedToday')}</div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-bold">{dashboardStats.pendingReview || 0}</div>
                          <div className="text-sm text-muted-foreground">{t('reports.pendingFeedback')}</div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-bold">
                            {dashboardStats.accuracy ? `${dashboardStats.accuracy.toFixed(0)}%` : 'N/A'}
                          </div>
                          <div className="text-sm text-muted-foreground">{t('reports.accuracy', 'Accuracy')}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState variant="no-data" compact className="h-50" />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Confusion Matrix Tab */}
          <TabsContent value="confusion">
            <Card>
              <CardHeader>
                <CardTitle>{t('reports.confusionMatrix')}</CardTitle>
                <CardDescription>
                  {t('reports.confusionMatrixDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* A confusion matrix (and the precision/recall/F1 derived from
                    it) requires labeled ground-truth outcomes — the actual class
                    of each sample compared against the model's predicted class.
                    The ai_feedback store only records a subjective
                    correct/incorrect/partial verdict per suggestion, not a
                    predicted-vs-actual class pair, so a real matrix cannot be
                    built. We show an honest empty state rather than fabricate
                    cells. */}
                <EmptyState
                  variant="no-analytics"
                  icon={Brain}
                  title={t('reports.confusionMatrixUnavailable', 'Confusion matrix not available')}
                  description={t(
                    'reports.confusionMatrixUnavailableDesc',
                    'Building a confusion matrix needs labeled ground-truth outcomes (the actual class vs the predicted class for each sample). This system captures only a correct/incorrect feedback verdict, so a true matrix and its precision/recall/F1 cannot be computed yet.',
                  )}
                  className="h-75"
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Confidence Calibration Tab (B2) */}
          <TabsContent value="calibration">
            <CalibrationSection />
          </TabsContent>

          {/* AI Analysis Hub Tab (doc 35 F1 — aiAnalysisHub.*) */}
          <TabsContent value="analysisHub">
            <AnalysisHubSection />
          </TabsContent>

          {/* Training Batches Tab */}
          <TabsContent value="batches">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  {t('reports.trainingBatches')}
                </CardTitle>
                <CardDescription>
                  {t('reports.trainingBatchesDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {batchesLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
                  </div>
                ) : trainingBatches?.batches && trainingBatches.batches.length > 0 ? (
                  <ScrollArea className="h-100">
                    <div className="space-y-2">
                      {trainingBatches.batches.map((batch) => (
                        <Dialog key={batch.id}>
                          <DialogTrigger asChild>
                            <div
                              className="p-4 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="p-2 rounded-lg bg-primary/10">
                                    <Database className="h-4 w-4 text-primary" />
                                  </div>
                                  <div>
                                    <div className="font-medium">{batch.name}</div>
                                    <div className="text-sm text-muted-foreground">
                                      {batch.feedbackCount} samples • {batch.exportFormat}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  {getStatusBadge(batch.status)}
                                  <span className="text-sm text-muted-foreground">
                                    {format(new Date(batch.createdAt), 'dd/MM/yyyy HH:mm', { locale: vi })}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <Database className="h-5 w-5" />
                                {batch.name}
                              </DialogTitle>
                              <DialogDescription className="sr-only">{batch.name}</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                              {/* Batch Info */}
                              <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-muted/50">
                                <div>
                                  <div className="text-sm text-muted-foreground">{t('reports.batchId', 'Batch ID')}</div>
                                  <div className="font-mono text-sm">{batch.batchId}</div>
                                </div>
                                <div>
                                  <div className="text-sm text-muted-foreground">{t('common.status')}</div>
                                  <div>{getStatusBadge(batch.status)}</div>
                                </div>
                                <div>
                                  <div className="text-sm text-muted-foreground">{t('reports.sampleCount')}</div>
                                  <div className="font-medium">{batch.feedbackCount}</div>
                                </div>
                                <div>
                                  <div className="text-sm text-muted-foreground">{t('reports.format')}</div>
                                  <div className="font-medium">{batch.exportFormat}</div>
                                </div>
                                <div>
                                  <div className="text-sm text-muted-foreground">{t('reports.correctSamples')}</div>
                                  <div className="font-medium text-success">{batch.correctSamples}</div>
                                </div>
                                <div>
                                  <div className="text-sm text-muted-foreground">{t('reports.incorrectSamples')}</div>
                                  <div className="font-medium text-destructive">{batch.incorrectSamples}</div>
                                </div>
                                <div className="col-span-2">
                                  <div className="text-sm text-muted-foreground">{t('reports.createdDate')}</div>
                                  <div className="font-medium">
                                    {format(new Date(batch.createdAt), 'dd/MM/yyyy HH:mm:ss', { locale: vi })}
                                  </div>
                                </div>
                                {batch.description && (
                                  <div className="col-span-2">
                                    <div className="text-sm text-muted-foreground">{t('common.description')}</div>
                                    <div className="text-sm">{batch.description}</div>
                                  </div>
                                )}
                              </div>
                              
                              {/* Comments & Tags Section */}
                              <BatchCommentsSection 
                                batchId={batch.batchId} 
                                batchName={batch.name}
                              />
                            </div>
                          </DialogContent>
                        </Dialog>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <EmptyState
                    variant="no-data"
                    icon={Database}
                    title={t('reports.noTrainingBatches')}
                    description={t('reports.noTrainingBatchesDesc', 'Export reviewed feedback into a training batch to see it here.')}
                    className="h-50"
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Suggestions History Tab */}
          <TabsContent value="suggestions">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  {t('reports.suggestionsHistory')}
                </CardTitle>
                <CardDescription>
                  {t('reports.suggestionsHistoryDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {suggestionsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16" />)}
                  </div>
                ) : recentSuggestions?.suggestions && recentSuggestions.suggestions.length > 0 ? (
                  <ScrollArea className="h-100">
                    <div className="space-y-2">
                      {recentSuggestions.suggestions.map((suggestion: any) => (
                        <div
                          key={suggestion.id}
                          className="p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "p-2 rounded-lg",
                                suggestion.suggestedResult === 'NG' ? "bg-destructive/10" : "bg-success/10"
                              )}>
                                {suggestion.suggestedResult === 'NG' ? (
                                  <XCircle className="h-4 w-4 text-destructive" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4 text-success" />
                                )}
                              </div>
                              <div>
                                <div className="font-medium">
                                  {t('reports.inspectionN', 'Inspection #{{id}}', { id: suggestion.inspectionId })}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {t('reports.suggestedLabel', 'Suggested')}: {suggestion.suggestedResult} •{' '}
                                  {t('reports.confidenceLabel', 'Confidence')}: {(suggestion.confidence * 100).toFixed(0)}%
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {suggestion.feedbackResult ? (
                                getFeedbackBadge(suggestion.feedbackResult)
                              ) : (
                                <Badge variant="outline" className="text-muted-foreground">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {t('reports.pendingFeedback')}
                                </Badge>
                              )}
                              <span className="text-sm text-muted-foreground">
                                {format(new Date(suggestion.createdAt), 'dd/MM HH:mm', { locale: vi })}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <EmptyState
                    variant="no-data"
                    icon={Brain}
                    title={t('reports.noSuggestions')}
                    description={t('reports.noSuggestionsDesc', 'AI suggestions and their feedback history will appear here.')}
                    className="h-50"
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}

// ─── B2 — Confidence Calibration (ECE + reliability diagram) ─────────
function CalibrationSection() {
  const { t } = useTranslation();
  const [modelId, setModelId] = useState('');
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));

  const mid = Number(modelId) || 0;

  const latestQuery = trpc.aiCalibration.getLatestCalibration.useQuery(
    { modelId: mid },
    { enabled: mid > 0 },
  );
  const report = latestQuery.data;

  const compute = trpc.aiCalibration.computeCalibration.useMutation({
    onSuccess: (d: any) => {
      if (!d?.report) {
        toast.warning(t('calibration.noSamples', 'Không có mẫu đã review trong khoảng/scope này'));
      } else {
        toast.success(t('calibration.computed', 'Đã tính toán calibration'));
      }
      latestQuery.refetch();
    },
    onError: (e) => toastTrpcError(e),
  });

  const pct = (n: number | string | null | undefined) =>
    n == null ? '—' : `${(Number(n) * 100).toFixed(2)}%`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('calibration.title', 'Hiệu chỉnh độ tin cậy (ECE)')}</CardTitle>
          <CardDescription>
            {t(
              'calibration.desc',
              'Ground truth lấy từ kết quả Quality Gate đã được người review. Temperature fit là xấp xỉ trên confidence top-1 (engine không lưu logits đầy đủ).',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label>{t('calibration.model', 'Mô hình')}</Label>
              <ModelSelect value={modelId} onChange={setModelId} />
            </div>
            <div className="space-y-1">
              <Label>{t('calibration.periodStart', 'Từ ngày')}</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('calibration.periodEnd', 'Đến ngày')}</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button
                disabled={mid <= 0 || compute.isPending}
                onClick={() =>
                  compute.mutate({
                    modelId: mid,
                    periodStart: new Date(periodStart),
                    periodEnd: new Date(periodEnd + 'T23:59:59'),
                    numBins: 10,
                    fitTemperature: true,
                  })
                }
              >
                {compute.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('calibration.compute', 'Tính toán')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t('calibration.ece', 'ECE')}</CardDescription>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{pct(report.ece)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t('calibration.mce', 'MCE')}</CardDescription>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{pct(report.mce)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t('calibration.brier', 'Brier Score')}</CardDescription>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">
                {report.brierScore == null ? '—' : Number(report.brierScore).toFixed(4)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t('calibration.sampleCount', 'Số mẫu')}</CardDescription>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{report.sampleCount}</CardContent>
            </Card>
          </div>

          {report.temperature != null && (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-4 pt-4 text-sm">
                <span>
                  {t('calibration.temperature', 'Nhiệt độ (T)')}:{' '}
                  <Badge variant="secondary">{Number(report.temperature).toFixed(3)}</Badge>
                </span>
                <span>
                  {t('calibration.eceAfterTemp', 'ECE sau hiệu chỉnh T')}: {pct(report.eceAfterTemp)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('calibration.tempApprox', 'Xấp xỉ — fit trên confidence top-1, không phải logits đầy đủ')}
                </span>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t('calibration.reliabilityDiagram', 'Reliability Diagram')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReliabilityDiagram bins={(report.reliabilityBins as any) ?? []} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
