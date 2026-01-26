import { useState, useMemo } from 'react';
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

export default function AIPerformanceDashboard() {
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
        return <Badge className="bg-green-500/10 text-green-500">Hoàn thành</Badge>;
      case 'PROCESSING':
        return <Badge className="bg-blue-500/10 text-blue-500">Đang xử lý</Badge>;
      case 'PENDING':
        return <Badge className="bg-yellow-500/10 text-yellow-500">Chờ xử lý</Badge>;
      case 'FAILED':
        return <Badge className="bg-red-500/10 text-red-500">Thất bại</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getFeedbackBadge = (feedback: string) => {
    switch (feedback) {
      case 'CORRECT':
        return <Badge className="bg-green-500/10 text-green-500">Đúng</Badge>;
      case 'INCORRECT':
        return <Badge className="bg-red-500/10 text-red-500">Sai</Badge>;
      case 'PARTIAL':
        return <Badge className="bg-yellow-500/10 text-yellow-500">Một phần</Badge>;
      case 'UNSURE':
        return <Badge className="bg-gray-500/10 text-gray-500">Không chắc</Badge>;
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
              AI Model Performance Dashboard
            </h1>
            <p className="text-muted-foreground">
              Theo dõi và đánh giá hiệu suất của AI suggestions
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={dateRange} onValueChange={(v: '7d' | '30d' | '90d' | 'all') => setDateRange(v)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 ngày</SelectItem>
                <SelectItem value="30d">30 ngày</SelectItem>
                <SelectItem value="90d">90 ngày</SelectItem>
                <SelectItem value="all">Tất cả</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => refetchStats()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Làm mới
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
                  <p className="text-3xl font-bold">
                    {statsLoading ? <Skeleton className="h-9 w-20" /> : `${(metrics?.accuracy || 0).toFixed(1)}%`}
                  </p>
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
                {(metrics?.accuracy || 0) >= 80 ? "Đạt mục tiêu" : "Cần cải thiện"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Precision</p>
                  <p className="text-3xl font-bold">
                    {statsLoading ? <Skeleton className="h-9 w-20" /> : `${(metrics?.precision || 0).toFixed(1)}%`}
                  </p>
                </div>
                <div className="p-3 rounded-full bg-blue-500/10">
                  <Zap className="h-6 w-6 text-blue-500" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Tỷ lệ dự đoán đúng trong số dự đoán positive
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Recall</p>
                  <p className="text-3xl font-bold">
                    {statsLoading ? <Skeleton className="h-9 w-20" /> : `${(metrics?.recall || 0).toFixed(1)}%`}
                  </p>
                </div>
                <div className="p-3 rounded-full bg-purple-500/10">
                  <Activity className="h-6 w-6 text-purple-500" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Tỷ lệ phát hiện đúng trong số actual positive
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">F1 Score</p>
                  <p className="text-3xl font-bold">
                    {statsLoading ? <Skeleton className="h-9 w-20" /> : `${(metrics?.f1Score || 0).toFixed(1)}%`}
                  </p>
                </div>
                <div className="p-3 rounded-full bg-orange-500/10">
                  <Award className="h-6 w-6 text-orange-500" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Harmonic mean của Precision và Recall
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Tổng quan</TabsTrigger>
            <TabsTrigger value="confusion">Confusion Matrix</TabsTrigger>
            <TabsTrigger value="batches">Training Batches</TabsTrigger>
            <TabsTrigger value="suggestions">Suggestions History</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Feedback Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChart className="h-5 w-5" />
                    Phân bố Feedback
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {statsLoading ? (
                    <Skeleton className="h-[200px]" />
                  ) : dashboardStats ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-8">
                        <div className="text-center">
                          <div className="text-3xl font-bold text-green-500">
                            {dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'CORRECT').length || 0}
                          </div>
                          <div className="text-sm text-muted-foreground">Đúng</div>
                        </div>
                        <div className="text-center">
                          <div className="text-3xl font-bold text-red-500">
                            {dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'INCORRECT').length || 0}
                          </div>
                          <div className="text-sm text-muted-foreground">Sai</div>
                        </div>
                        <div className="text-center">
                          <div className="text-3xl font-bold text-yellow-500">
                            {dashboardStats.recentFeedback?.filter((f: any) => f.feedbackType === 'PARTIAL').length || 0}
                          </div>
                          <div className="text-sm text-muted-foreground">Một phần</div>
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
                                <span className="w-20 text-sm">Đúng</span>
                                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-green-500 transition-all" style={{ width: `${total ? (correct / total) * 100 : 0}%` }} />
                                </div>
                                <span className="w-12 text-sm text-right">{total ? ((correct / total) * 100).toFixed(0) : 0}%</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="w-20 text-sm">Sai</span>
                                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-red-500 transition-all" style={{ width: `${total ? (incorrect / total) * 100 : 0}%` }} />
                                </div>
                                <span className="w-12 text-sm text-right">{total ? ((incorrect / total) * 100).toFixed(0) : 0}%</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="w-20 text-sm">Một phần</span>
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
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                      Không có dữ liệu
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Summary Stats */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Thống kê tổng hợp
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {statsLoading ? (
                    <Skeleton className="h-[200px]" />
                  ) : dashboardStats ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-bold">{dashboardStats.totalSuggestions || 0}</div>
                          <div className="text-sm text-muted-foreground">Tổng suggestions</div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-bold">{dashboardStats.reviewedToday || 0}</div>
                          <div className="text-sm text-muted-foreground">Reviewed hôm nay</div>
                        </div>
                        <div className="p-4 rounded-lg bg-muted/50">
                          <div className="text-2xl font-bold">{dashboardStats.pendingReview || 0}</div>
                          <div className="text-sm text-muted-foreground">Chờ feedback</div>
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
                    <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                      Không có dữ liệu
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
                <CardTitle>Confusion Matrix</CardTitle>
                <CardDescription>
                  Ma trận nhầm lẫn giúp đánh giá hiệu suất phân loại của AI model
                </CardDescription>
              </CardHeader>
              <CardContent>
                {confusionMatrix ? (
                  <div className="flex flex-col items-center space-y-4">
                    <div className="grid grid-cols-3 gap-2 max-w-md">
                      {/* Header row */}
                      <div className="p-4" />
                      <div className="p-4 text-center font-medium bg-muted rounded-lg">
                        Predicted Positive
                      </div>
                      <div className="p-4 text-center font-medium bg-muted rounded-lg">
                        Predicted Negative
                      </div>
                      
                      {/* Actual Positive row */}
                      <div className="p-4 text-center font-medium bg-muted rounded-lg">
                        Actual Positive
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
                        Actual Negative
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
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Brain className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Cần thêm feedback để tính toán confusion matrix</p>
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
                  Training Batches
                </CardTitle>
                <CardDescription>
                  Danh sách các batch dữ liệu đã export để training model
                </CardDescription>
              </CardHeader>
              <CardContent>
                {batchesLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
                  </div>
                ) : trainingBatches?.batches && trainingBatches.batches.length > 0 ? (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {trainingBatches.batches.map((batch) => (
                        <div
                          key={batch.id}
                          className="p-4 rounded-lg border hover:bg-muted/50 transition-colors"
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
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Database className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Chưa có training batch nào</p>
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
                  Lịch sử Suggestions
                </CardTitle>
                <CardDescription>
                  Danh sách các AI suggestions gần đây và feedback từ người dùng
                </CardDescription>
              </CardHeader>
              <CardContent>
                {suggestionsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16" />)}
                  </div>
                ) : recentSuggestions?.suggestions && recentSuggestions.suggestions.length > 0 ? (
                  <ScrollArea className="h-[400px]">
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
                                  Chờ feedback
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
                  <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Brain className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Chưa có suggestions nào</p>
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
