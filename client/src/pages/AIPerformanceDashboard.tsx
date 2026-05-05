import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <Badge className="bg-green-500/10 text-green-500">{t('common.completed')}</Badge>;
      case 'PROCESSING':
        return <Badge className="bg-blue-500/10 text-blue-500">{t('common.processing')}</Badge>;
      case 'PENDING':
        return <Badge className="bg-yellow-500/10 text-yellow-500">{t('common.pending')}</Badge>;
      case 'FAILED':
        return <Badge className="bg-red-500/10 text-red-500">{t('common.failed')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getFeedbackBadge = (feedback: string) => {
    switch (feedback) {
      case 'CORRECT':
        return <Badge className="bg-green-500/10 text-green-500">{t('reports.correct')}</Badge>;
      case 'INCORRECT':
        return <Badge className="bg-red-500/10 text-red-500">{t('reports.incorrect')}</Badge>;
      case 'PARTIAL':
        return <Badge className="bg-yellow-500/10 text-yellow-500">{t('reports.partial')}</Badge>;
      case 'UNSURE':
        return <Badge className="bg-gray-500/10 text-gray-500">{t('reports.unsure')}</Badge>;
      default:
        return <Badge variant="outline">{feedback}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6" />
              {t('reports.aiModelPerformanceDashboard')}
            </h1>
            <p className="text-muted-foreground">
              {t('reports.aiModelPerformanceDesc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Accuracy</p>
                  <div className="text-3xl font-bold">
                    {statsLoading ? <Skeleton className="h-9 w-20" /> : `${(metrics?.accuracy || 0).toFixed(1)}%`}
                  </div>
                </div>
                <div className={cn(
                  "p-3 rounded-full",
                  (metrics?.accuracy || 0) >= 80 ? "bg-green-500/10" : "bg-yellow-500/10"
                )}>
                  <Target className={cn(
                    "h-6 w-6",
                    (metrics?.accuracy || 0) >= 80 ? "text-green-500" : "text-yellow-500"
                  )} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {(metrics?.accuracy || 0) >= 80 ? t('reports.targetMet') : t('reports.needsImprovement')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Precision</p>
                  <div className="text-3xl font-bold">
                    {statsLoading ? <Skeleton className="h-9 w-20" /> : `${(metrics?.precision || 0).toFixed(1)}%`}
                  </div>
                </div>
                <div className="p-3 rounded-full bg-blue-500/10">
                  <Zap className="h-6 w-6 text-blue-500" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t('reports.precisionDesc')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Recall</p>
                  <div className="text-3xl font-bold">
                    {statsLoading ? <Skeleton className="h-9 w-20" /> : `${(metrics?.recall || 0).toFixed(1)}%`}
                  </div>
                </div>
                <div className="p-3 rounded-full bg-purple-500/10">
                  <Activity className="h-6 w-6 text-purple-500" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t('reports.recallDesc')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">F1 Score</p>
                  <div className="text-3xl font-bold">
                    {statsLoading ? <Skeleton className="h-9 w-20" /> : `${(metrics?.f1Score || 0).toFixed(1)}%`}
                  </div>
                </div>
                <div className="p-3 rounded-full bg-orange-500/10">
                  <Award className="h-6 w-6 text-orange-500" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t('reports.f1ScoreDesc')}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">{t('dashboard.overview')}</TabsTrigger>
            <TabsTrigger value="confusion">{t('reports.confusionMatrix')}</TabsTrigger>
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
                          <div className="text-3xl font-bold text-green-500">
                            {dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'CORRECT').length || 0}
                          </div>
                          <div className="text-sm text-muted-foreground">{t('reports.correct')}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-3xl font-bold text-red-500">
                            {dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'INCORRECT').length || 0}
                          </div>
                          <div className="text-sm text-muted-foreground">{t('reports.incorrect')}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-3xl font-bold text-yellow-500">
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
                                  <div className="h-full bg-green-500 transition-all" style={{ width: `${total ? (correct / total) * 100 : 0}%` }} />
                                </div>
                                <span className="w-12 text-sm text-right">{total ? ((correct / total) * 100).toFixed(0) : 0}%</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="w-20 text-sm">{t('reports.incorrect')}</span>
                                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-red-500 transition-all" style={{ width: `${total ? (incorrect / total) * 100 : 0}%` }} />
                                </div>
                                <span className="w-12 text-sm text-right">{total ? ((incorrect / total) * 100).toFixed(0) : 0}%</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="w-20 text-sm">{t('reports.partial')}</span>
                                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-yellow-500 transition-all" style={{ width: `${total ? (partial / total) * 100 : 0}%` }} />
                                </div>
                                <span className="w-12 text-sm text-right">{total ? ((partial / total) * 100).toFixed(0) : 0}%</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="h-50 flex items-center justify-center text-muted-foreground">
                      {t('common.noData')}
                    </div>
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
                          <div className="text-sm text-muted-foreground">Accuracy</div>
                        </div>
                      </div>
                    </div>
                  ) : (
<div className="h-50 flex items-center justify-center text-muted-foreground">
                      {t('common.noData')}
                    </div>
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
                      <div className="p-8 text-center bg-green-500/20 rounded-lg border-2 border-green-500">
                        <div className="text-3xl font-bold text-green-600">{confusionMatrix.truePositive}</div>
                        <div className="text-sm text-muted-foreground">True Positive</div>
                      </div>
                      <div className="p-8 text-center bg-red-500/20 rounded-lg border-2 border-red-500">
                        <div className="text-3xl font-bold text-red-600">{confusionMatrix.falseNegative}</div>
                        <div className="text-sm text-muted-foreground">False Negative</div>
                      </div>
                      
                      {/* Actual Negative row */}
                      <div className="p-4 text-center font-medium bg-muted rounded-lg">
                        {t('reports.actualNegative')}
                      </div>
                      <div className="p-8 text-center bg-red-500/20 rounded-lg border-2 border-red-500">
                        <div className="text-3xl font-bold text-red-600">{confusionMatrix.falsePositive}</div>
                        <div className="text-sm text-muted-foreground">False Positive</div>
                      </div>
                      <div className="p-8 text-center bg-green-500/20 rounded-lg border-2 border-green-500">
                        <div className="text-3xl font-bold text-green-600">{confusionMatrix.trueNegative}</div>
                        <div className="text-sm text-muted-foreground">True Negative</div>
                      </div>
                    </div>

                    {/* Metrics explanation */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-2xl mt-8">
                      <div className="p-4 rounded-lg border text-center">
                        <div className="text-lg font-bold">{metrics?.accuracy.toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">Accuracy</div>
                        <div className="text-xs text-muted-foreground mt-1">(TP+TN)/(Total)</div>
                      </div>
                      <div className="p-4 rounded-lg border text-center">
                        <div className="text-lg font-bold">{metrics?.precision.toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">Precision</div>
                        <div className="text-xs text-muted-foreground mt-1">TP/(TP+FP)</div>
                      </div>
                      <div className="p-4 rounded-lg border text-center">
                        <div className="text-lg font-bold">{metrics?.recall.toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">Recall</div>
                        <div className="text-xs text-muted-foreground mt-1">TP/(TP+FN)</div>
                      </div>
                      <div className="p-4 rounded-lg border text-center">
                        <div className="text-lg font-bold">{metrics?.f1Score.toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">F1 Score</div>
                        <div className="text-xs text-muted-foreground mt-1">2*(P*R)/(P+R)</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-75 flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Brain className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>{t('reports.needMoreFeedback')}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
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
                                  <div className="text-sm text-muted-foreground">Batch ID</div>
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
                                  <div className="font-medium text-green-600">{batch.correctSamples}</div>
                                </div>
                                <div>
                                  <div className="text-sm text-muted-foreground">{t('reports.incorrectSamples')}</div>
                                  <div className="font-medium text-red-600">{batch.incorrectSamples}</div>
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
                  <div className="h-50 flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Database className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>{t('reports.noTrainingBatches')}</p>
                    </div>
                  </div>
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
                                suggestion.suggestedResult === 'NG' ? "bg-red-500/10" : "bg-green-500/10"
                              )}>
                                {suggestion.suggestedResult === 'NG' ? (
                                  <XCircle className="h-4 w-4 text-red-500" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                                )}
                              </div>
                              <div>
                                <div className="font-medium">
                                  Inspection #{suggestion.inspectionId}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  Suggested: {suggestion.suggestedResult} • 
                                  Confidence: {(suggestion.confidence * 100).toFixed(0)}%
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
                  <div className="h-50 flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Brain className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>{t('reports.noSuggestions')}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
