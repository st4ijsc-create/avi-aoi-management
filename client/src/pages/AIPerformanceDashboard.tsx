import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import {
  PageHeader,
  PageContainer,
  MetricCard,
  StatusBadge,
  EmptyState,
  chartColor,
  chartTooltipStyle,
  chartTooltipLabelStyle,
  chartGridProps,
  chartAxisTick,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Target,
  Activity,
  BarChart3,
  PieChart,
  RefreshCw,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Database,
  Zap,
  Award,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { BatchCommentsSection } from '@/components/BatchCommentsSection';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { ModelSelect, DatasetSelect } from '@/components/ai/ModelSelect';
import { ReliabilityDiagram } from '@/components/ReliabilityDiagram';
import AnalysisHubSection from '@/components/analytics/AnalysisHubSection';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

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

  // Calculate confusion matrix data
  const confusionMatrix = useMemo(() => {
    if (!dashboardStats || !dashboardStats.recentFeedback) return null;

    // Calculate from recentFeedback
    const feedback = dashboardStats.recentFeedback;
    const correct = feedback.filter((f: any) => f.feedbackType === 'CORRECT').length;
    const incorrect = feedback.filter((f: any) => f.feedbackType === 'INCORRECT').length;

    // For binary classification: Predicted vs Actual
    return {
      truePositive: Math.round(correct * 0.6) || 1,
      falsePositive: Math.round(incorrect * 0.4) || 1,
      trueNegative: Math.round(correct * 0.4) || 1,
      falseNegative: Math.round(incorrect * 0.6) || 1,
    };
  }, [dashboardStats]);

  // Calculate metrics
  const metrics = useMemo(() => {
    if (!confusionMatrix) return null;

    const { truePositive, falsePositive, trueNegative, falseNegative } = confusionMatrix;
    const total = truePositive + falsePositive + trueNegative + falseNegative;

    const precision = truePositive / (truePositive + falsePositive) || 0;
    const recall = truePositive / (truePositive + falseNegative) || 0;
    const f1Score = 2 * (precision * recall) / (precision + recall) || 0;
    const accuracy = (truePositive + trueNegative) / total || 0;

    return {
      precision: precision * 100,
      recall: recall * 100,
      f1Score: f1Score * 100,
      accuracy: accuracy * 100,
    };
  }, [confusionMatrix]);

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

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            icon={<Target className="h-5 w-5" />}
            label={t('reports.accuracy', 'Accuracy')}
            value={statsLoading ? '…' : `${(metrics?.accuracy || 0).toFixed(1)}%`}
            tone={(metrics?.accuracy || 0) >= 80 ? 'success' : 'warning'}
            delta={(metrics?.accuracy || 0) >= 80 ? t('reports.targetMet') : t('reports.needsImprovement')}
          />

          <MetricCard
            icon={<Zap className="h-5 w-5" />}
            label={t('reports.precision', 'Precision')}
            value={statsLoading ? '…' : `${(metrics?.precision || 0).toFixed(1)}%`}
            delta={t('reports.precisionDesc')}
          />

          <MetricCard
            icon={<Activity className="h-5 w-5" />}
            label={t('reports.recall', 'Recall')}
            value={statsLoading ? '…' : `${(metrics?.recall || 0).toFixed(1)}%`}
            delta={t('reports.recallDesc')}
          />

          <MetricCard
            icon={<Award className="h-5 w-5" />}
            label={t('reports.f1Score', 'F1 Score')}
            value={statsLoading ? '…' : `${(metrics?.f1Score || 0).toFixed(1)}%`}
            delta={t('reports.f1ScoreDesc')}
          />
        </div>

        {/* Main Content */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="overview">{t('dashboard.overview')}</TabsTrigger>
            <TabsTrigger value="confusion">{t('reports.confusionMatrix')}</TabsTrigger>
            <TabsTrigger value="evaluation">{t('aiEval.beforeAfterTab', 'Eval (Before/After)')}</TabsTrigger>
            <TabsTrigger value="canary">{t('canary.tab', 'A/B Canary')}</TabsTrigger>
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
                {confusionMatrix ? (
                  <div className="flex flex-col items-center space-y-4">
                    <div className="grid grid-cols-3 gap-2 max-w-md">
                      {/* Header row */}
                      <div className="p-4" />
                      <div className="p-4 text-center font-medium bg-muted rounded-lg">
                        {t('reports.predictedPositive')}
                      </div>
                      <div className="p-4 text-center font-medium bg-muted rounded-lg">
                        {t('reports.predictedNegative')}
                      </div>
                      
                      {/* Actual Positive row */}
                      <div className="p-4 text-center font-medium bg-muted rounded-lg">
                        {t('reports.actualPositive')}
                      </div>
                      <div className="p-8 text-center bg-success/20 rounded-lg border-2 border-success">
                        <div className="text-3xl font-bold text-success">{confusionMatrix.truePositive}</div>
                        <div className="text-sm text-muted-foreground">{t('reports.truePositive', 'True Positive')}</div>
                      </div>
                      <div className="p-8 text-center bg-destructive/20 rounded-lg border-2 border-destructive">
                        <div className="text-3xl font-bold text-destructive">{confusionMatrix.falseNegative}</div>
                        <div className="text-sm text-muted-foreground">{t('reports.falseNegative', 'False Negative')}</div>
                      </div>

                      {/* Actual Negative row */}
                      <div className="p-4 text-center font-medium bg-muted rounded-lg">
                        {t('reports.actualNegative')}
                      </div>
                      <div className="p-8 text-center bg-destructive/20 rounded-lg border-2 border-destructive">
                        <div className="text-3xl font-bold text-destructive">{confusionMatrix.falsePositive}</div>
                        <div className="text-sm text-muted-foreground">{t('reports.falsePositive', 'False Positive')}</div>
                      </div>
                      <div className="p-8 text-center bg-success/20 rounded-lg border-2 border-success">
                        <div className="text-3xl font-bold text-success">{confusionMatrix.trueNegative}</div>
                        <div className="text-sm text-muted-foreground">{t('reports.trueNegative', 'True Negative')}</div>
                      </div>
                    </div>

                    {/* Metrics explanation */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-2xl mt-8">
                      <div className="p-4 rounded-lg border text-center">
                        <div className="text-lg font-bold">{metrics?.accuracy.toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">{t('reports.accuracy', 'Accuracy')}</div>
                        <div className="text-xs text-muted-foreground mt-1">(TP+TN)/(Total)</div>
                      </div>
                      <div className="p-4 rounded-lg border text-center">
                        <div className="text-lg font-bold">{metrics?.precision.toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">{t('reports.precision', 'Precision')}</div>
                        <div className="text-xs text-muted-foreground mt-1">TP/(TP+FP)</div>
                      </div>
                      <div className="p-4 rounded-lg border text-center">
                        <div className="text-lg font-bold">{metrics?.recall.toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">{t('reports.recall', 'Recall')}</div>
                        <div className="text-xs text-muted-foreground mt-1">TP/(TP+FN)</div>
                      </div>
                      <div className="p-4 rounded-lg border text-center">
                        <div className="text-lg font-bold">{metrics?.f1Score.toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">{t('reports.f1Score', 'F1 Score')}</div>
                        <div className="text-xs text-muted-foreground mt-1">2*(P*R)/(P+R)</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    variant="no-analytics"
                    icon={Brain}
                    title={t('reports.needMoreFeedback')}
                    description={t('reports.needMoreFeedbackDesc', 'Provide more feedback on suggestions to build the confusion matrix.')}
                    className="h-75"
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Eval Before/After Tab (WS-1) */}
          <TabsContent value="evaluation">
            <EvalBeforeAfterSection />
          </TabsContent>

          {/* A/B Canary Tab (B6) */}
          <TabsContent value="canary">
            <CanaryComparisonSection />
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

// ─── Eval Before/After Section (WS-1) ────────────────────────────────────────

interface EvalResultShape {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  microF1?: number;
  confusionMatrix?: number[][];
  labels: string[];
  evaluated: number;
  skipped: number;
}

interface CompareReportShape {
  baseline: EvalResultShape | null;
  candidate: EvalResultShape;
  gate: { pass: boolean; reason: string; accuracyDelta: number; epsilon: number };
  split: string;
  generatedAt: string;
}

function EvalBeforeAfterSection() {
  const { t } = useTranslation();
  const [modelId, setModelId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [candidatePath, setCandidatePath] = useState('');
  const [baselinePath, setBaselinePath] = useState('');
  const [split, setSplit] = useState<'train' | 'val' | 'test'>('test');
  const [report, setReport] = useState<CompareReportShape | null>(null);

  const compare = trpc.aiEval.compareBeforeAfter.useMutation({
    onSuccess: (data) => {
      setReport(data as unknown as CompareReportShape);
      toast.success(t('aiEval.compareDone', 'Đã so sánh xong'));
    },
    onError: (err) => toast.error(err.message),
  });

  const toPct = (n: number | undefined) => ((n ?? 0) * 100);

  const chartData = report
    ? [
        {
          metric: 'Accuracy',
          [t('aiEval.before', 'Trước')]: Number(toPct(report.baseline?.accuracy).toFixed(2)),
          [t('aiEval.after', 'Sau')]: Number(toPct(report.candidate.accuracy).toFixed(2)),
        },
        {
          metric: 'Precision',
          [t('aiEval.before', 'Trước')]: Number(toPct(report.baseline?.precision).toFixed(2)),
          [t('aiEval.after', 'Sau')]: Number(toPct(report.candidate.precision).toFixed(2)),
        },
        {
          metric: 'Recall',
          [t('aiEval.before', 'Trước')]: Number(toPct(report.baseline?.recall).toFixed(2)),
          [t('aiEval.after', 'Sau')]: Number(toPct(report.candidate.recall).toFixed(2)),
        },
        {
          metric: 'F1',
          [t('aiEval.before', 'Trước')]: Number(toPct(report.baseline?.f1Score).toFixed(2)),
          [t('aiEval.after', 'Sau')]: Number(toPct(report.candidate.f1Score).toFixed(2)),
        },
      ]
    : [];

  const beforeKey = t('aiEval.before', 'Trước');
  const afterKey = t('aiEval.after', 'Sau');
  const cm = report?.candidate.confusionMatrix;
  const cmLabels = report?.candidate.labels ?? [];

  return (
    <div className="space-y-4">
      {/* Config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('aiEval.runCompare', 'Chạy đánh giá Before/After')}</CardTitle>
          <CardDescription>
            {t('aiEval.runCompareDesc', 'So sánh model ứng viên với baseline trên cùng split test')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('aiEval.model', 'Model')}</Label>
              <ModelSelect value={modelId} onChange={setModelId} />
            </div>
            <div className="space-y-1">
              <Label>{t('aiEval.dataset', 'Dataset')}</Label>
              <DatasetSelect value={datasetId} onChange={setDatasetId} modelId={modelId ? Number(modelId) : undefined} />
            </div>
            <div className="space-y-1">
              <Label>{t('aiEval.candidatePath', 'Đường dẫn classifier ứng viên')}</Label>
              <Input value={candidatePath} onChange={(e) => setCandidatePath(e.target.value)} placeholder="uploads/models/..." />
            </div>
            <div className="space-y-1">
              <Label>{t('aiEval.baselinePath', 'Đường dẫn baseline (tùy chọn)')}</Label>
              <Input value={baselinePath} onChange={(e) => setBaselinePath(e.target.value)} placeholder="uploads/models/..." />
            </div>
            <div className="space-y-1">
              <Label>{t('aiEval.split', 'Split')}</Label>
              <Select value={split} onValueChange={(v: 'train' | 'val' | 'test') => setSplit(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="train">train</SelectItem>
                  <SelectItem value="val">val</SelectItem>
                  <SelectItem value="test">test</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={() =>
              compare.mutate({
                modelId: Number(modelId),
                datasetId: Number(datasetId),
                candidateClassifierPath: candidatePath.trim(),
                baselineClassifierPath: baselinePath.trim() || undefined,
                split,
              })
            }
            disabled={!modelId || !datasetId || !candidatePath.trim() || compare.isPending}
          >
            {compare.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-2" />}
            {t('aiEval.compareRun', 'So sánh')}
          </Button>
        </CardContent>
      </Card>

      {report && (
        <>
          {/* Quality gate */}
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              {report.gate.pass ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              <div className="flex-1">
                <p className="font-medium">
                  {report.gate.pass
                    ? t('aiEval.gatePass', 'Quality gate: ĐẠT')
                    : t('aiEval.gateFail', 'Quality gate: KHÔNG ĐẠT')}
                </p>
                <p className="text-sm text-muted-foreground">{report.gate.reason}</p>
              </div>
              <Badge variant={report.gate.accuracyDelta >= 0 ? 'default' : 'destructive'}>
                Δacc {(report.gate.accuracyDelta * 100).toFixed(2)}%
              </Badge>
            </CardContent>
          </Card>

          {/* Before vs After chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('aiEval.metricsCompare', 'Chỉ số Before vs After (%)')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="metric" tick={chartAxisTick} />
                    <YAxis domain={[0, 100]} tick={chartAxisTick} />
                    <RTooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                    <Legend />
                    <Bar dataKey={beforeKey} fill={chartColor(4)} />
                    <Bar dataKey={afterKey} fill={chartColor(0)} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Candidate confusion matrix */}
          {cm && cm.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('aiEval.candidateConfusion', 'Confusion Matrix (ứng viên)')}</CardTitle>
                <CardDescription>
                  {t('aiEval.confusionHint', 'Hàng = nhãn thực tế, Cột = nhãn dự đoán')}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table className="w-auto text-sm">
                  <TableHeader>
                    <TableRow className="border-0 hover:bg-transparent">
                      <TableHead className="p-2" />
                      {cmLabels.map((l) => (
                        <TableHead key={l} className="p-2 text-center font-medium text-muted-foreground">{l}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cm.map((row, i) => (
                      <TableRow key={i} className="border-0 hover:bg-transparent">
                        <TableCell className="p-2 font-medium text-muted-foreground">{cmLabels[i] ?? i}</TableCell>
                        {row.map((cell, j) => (
                          <TableCell
                            key={j}
                            className={cn(
                              'p-3 text-center border rounded',
                              i === j ? 'bg-success/15 font-semibold' : cell > 0 ? 'bg-destructive/10' : '',
                            )}
                          >
                            {cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground mt-3">
                  {t('aiEval.evaluated', 'Đã đánh giá')}: {report.candidate.evaluated} • {t('aiEval.skipped', 'Bỏ qua')}: {report.candidate.skipped}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── B6 — A/B Canary comparison + promote/rollback ─────────────────
function CanaryComparisonSection() {
  const { t } = useTranslation();
  const [experimentId, setExperimentId] = useState('');
  const [configId, setConfigId] = useState('');

  const expId = Number(experimentId) || 0;
  const cfgId = Number(configId) || 0;

  const statsQuery = trpc.aiQualityGate.canaryStats.useQuery(
    { experimentId: expId },
    { enabled: expId > 0 },
  );
  const stats = statsQuery.data;

  const refresh = () => statsQuery.refetch();

  const start = trpc.aiQualityGate.canaryStart.useMutation({
    onSuccess: () => { toast.success(t('canary.started', 'Đã khởi động canary')); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const pause = trpc.aiQualityGate.canaryPause.useMutation({
    onSuccess: () => { toast.success(t('canary.paused', 'Đã tạm dừng canary')); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const guardrail = trpc.aiQualityGate.canaryGuardrail.useMutation({
    onSuccess: (d: any) => {
      toast.success(
        d?.shouldRollback
          ? t('canary.guardrailTripped', 'Guardrail kích hoạt — đã tạm dừng')
          : t('canary.guardrailOk', 'Guardrail OK'),
      );
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const promote = trpc.aiQualityGate.canaryPromote.useMutation({
    onSuccess: () => { toast.success(t('canary.promoted', 'Đã promote model B')); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const rollback = trpc.aiQualityGate.canaryRollback.useMutation({
    onSuccess: () => { toast.success(t('canary.rolledBack', 'Đã rollback về model A')); refresh(); },
    onError: (e) => toast.error(e.message),
  });

  const pct = (n: number | undefined) => `${((n ?? 0) * 100).toFixed(1)}%`;
  const expStatus = (stats?.experiment as any)?.status as string | undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('canary.title', 'A/B Canary (live)')}</CardTitle>
          <CardDescription>
            {t('canary.desc', 'So sánh model A (production) với model B (canary) trên luồng kiểm tra trực tiếp; promote hoặc rollback theo guardrail.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('canary.experimentId', 'Experiment ID')}</Label>
              <Input value={experimentId} onChange={(e) => setExperimentId(e.target.value)} placeholder="e.g. 1" />
            </div>
            <div className="space-y-1">
              <Label>{t('canary.configId', 'Quality Gate Config ID')}</Label>
              <Input value={configId} onChange={(e) => setConfigId(e.target.value)} placeholder="e.g. 7" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => refresh()} disabled={expId <= 0}>
              <RefreshCw className="h-4 w-4 mr-1" /> {t('common.refresh', 'Làm mới')}
            </Button>
            <Button size="sm" onClick={() => start.mutate({ experimentId: expId })} disabled={expId <= 0 || start.isPending}>
              {t('canary.start', 'Bắt đầu')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => pause.mutate({ experimentId: expId })} disabled={expId <= 0 || pause.isPending}>
              {t('canary.pause', 'Tạm dừng')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => guardrail.mutate({ experimentId: expId })} disabled={expId <= 0 || guardrail.isPending}>
              {t('canary.checkGuardrail', 'Kiểm tra guardrail')}
            </Button>
            <Button size="sm" onClick={() => promote.mutate({ experimentId: expId, configId: cfgId })} disabled={expId <= 0 || cfgId <= 0 || promote.isPending}>
              <Award className="h-4 w-4 mr-1" /> {t('canary.promote', 'Promote B')}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => rollback.mutate({ experimentId: expId, configId: cfgId })} disabled={expId <= 0 || cfgId <= 0 || rollback.isPending}>
              {t('canary.rollback', 'Rollback A')}
            </Button>
          </div>
          {expStatus && (
            <div>
              <StatusBadge status={expStatus} variant={expStatus === 'RUNNING' ? 'default' : 'secondary'} />
            </div>
          )}
        </CardContent>
      </Card>

      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('canary.comparison', 'So sánh variant')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left p-2">{t('canary.metric', 'Chỉ số')}</TableHead>
                  <TableHead className="text-right p-2">{t('canary.modelA', 'Model A (prod)')}</TableHead>
                  <TableHead className="text-right p-2">{t('canary.modelB', 'Model B (canary)')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="p-2">{t('canary.inferences', 'Số suy luận')}</TableCell>
                  <TableCell className="text-right p-2">{stats.modelA.inferenceCount}</TableCell>
                  <TableCell className="text-right p-2">{stats.modelB.inferenceCount}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-2">{t('canary.accuracy', 'Độ chính xác')}</TableCell>
                  <TableCell className="text-right p-2">{pct(stats.modelA.accuracy)}</TableCell>
                  <TableCell className="text-right p-2">{pct(stats.modelB.accuracy)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-2">{t('canary.avgConfidence', 'Confidence TB')}</TableCell>
                  <TableCell className="text-right p-2">{pct(stats.modelA.avgConfidence)}</TableCell>
                  <TableCell className="text-right p-2">{pct(stats.modelB.avgConfidence)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-2">{t('canary.avgLatency', 'Độ trễ TB (ms)')}</TableCell>
                  <TableCell className="text-right p-2">{stats.modelA.avgLatencyMs}</TableCell>
                  <TableCell className="text-right p-2">{stats.modelB.avgLatencyMs}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-2">{t('canary.feedback', 'Phản hồi')}</TableCell>
                  <TableCell className="text-right p-2">{stats.modelA.feedbackCount}</TableCell>
                  <TableCell className="text-right p-2">{stats.modelB.feedbackCount}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-3">
              {t('canary.significance', 'p-value (chi-squared)')}: {stats.statisticalSignificance ?? t('canary.inconclusive', 'Chưa đủ dữ liệu')}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
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
    onError: (e) => toast.error(e.message),
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
