import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { navItems } from '@/lib/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  PageHeader,
  PageContainer,
  MetricCard,
  StatusBadge,
} from '@/components/patterns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertCircle, Zap, TrendingUp, RefreshCw, Trash2, Gauge } from 'lucide-react';
import { trpc } from '@/lib/trpc';

export default function AdminMonitoring() {
  const { t } = useTranslation();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Query monitoring APIs — real data since W4-A (drizzle client instrumented).
  // Only slow queries (≥ SLOW_QUERY_MS) are stored individually; the old
  // all-query "recent" feed no longer exists (bounded-memory monitor).
  const slowQueries = trpc.system.queryMonitoring.getSlowQueries.useQuery({ limit: 50 });
  const stats = trpc.system.queryMonitoring.getStats.useQuery();
  const patterns = trpc.system.queryMonitoring.analyzePatterns.useQuery({ limit: 20 });
  const clearHistoryMutation = trpc.system.queryMonitoring.clearHistory.useMutation();

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      slowQueries.refetch();
      stats.refetch();
      patterns.refetch();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, slowQueries, stats, patterns]);

  const confirmClearHistory = () => {
    clearHistoryMutation.mutate(undefined, {
      onSuccess: () => {
        slowQueries.refetch();
        stats.refetch();
        patterns.refetch();
      },
    });
  };

  const handleRefresh = () => {
    slowQueries.refetch();
    stats.refetch();
    patterns.refetch();
  };

  return (
    <DashboardLayout
      title={t('admin.queryPerformanceMonitoring')}
      navItems={navItems}
      currentPath="/admin-monitoring"
    >
      <PageContainer>
        <PageHeader
          icon={<Gauge className="h-6 w-6" />}
          title={t('admin.queryPerformanceMonitoring')}
          description={t('admin.monitorSlowQueries')}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={autoRefresh ? 'border-success/30 bg-success/10 text-success' : ''}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {autoRefresh ? t('admin.autoRefreshOn') : t('admin.autoRefreshOff')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                aria-label={t('common.refresh', 'Refresh')}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmClearOpen(true)}>
                <Trash2 className="w-4 h-4 mr-2" />
                {t('admin.clearHistory')}
              </Button>
            </>
          }
        />

        {/* Kill-switch banner — monitor disabled means honest "no data", not "no slow queries" */}
        {stats.data && stats.data.enabled === false && (
          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {t('admin.queryMonitorOff', 'Query monitor đang TẮT (QUERY_MONITOR_ENABLED=false) — không có số liệu nào được ghi nhận.')}
          </div>
        )}

        {/* Statistics Cards */}
        {stats.data && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard
              label={t('admin.totalQueries')}
              value={stats.data.totalQueries}
            />
            <MetricCard
              label={t('admin.slowQueries')}
              value={stats.data.slowQueries}
              tone="danger"
              delta={`${stats.data.slowQueryPercentage}% ${t('admin.ofTotal')}`}
            />
            <MetricCard
              label={t('admin.avgExecutionTime')}
              value={`${stats.data.averageExecutionTime}ms`}
            />
            <MetricCard
              label={t('admin.maxExecutionTime')}
              value={`${stats.data.maxExecutionTime}ms`}
              tone="warning"
            />
          </div>
        )}

        <Tabs defaultValue="slow-queries" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="slow-queries">{t('admin.slowQueries')}</TabsTrigger>
            <TabsTrigger value="patterns">{t('admin.queryPatterns')}</TabsTrigger>
            <TabsTrigger value="analysis">{t('admin.analysis')}</TabsTrigger>
          </TabsList>

          {/* Slow Queries Tab */}
          <TabsContent value="slow-queries" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('admin.slowQueriesThreshold')}</CardTitle>
                <CardDescription>{t('admin.slowQueriesDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                {slowQueries.isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">{t('common.loading')}</div>
                ) : slowQueries.data && (slowQueries.data.length > 0) ? (
                  <div className="space-y-3">
                    {slowQueries.data.map((query, idx) => (
                      <div key={idx} className="border border-destructive/20 rounded-lg p-3 bg-destructive/5">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-destructive" />
                            <StatusBadge
                              status={`${query.executionTime.toFixed(2)}ms`}
                              tone="error"
                              className="font-mono"
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(query.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="font-mono text-xs text-foreground break-words">{query.query}</p>
                      </div>
                    ))}
                    {slowQueries.data.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">{t('admin.noSlowQueries')}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">{t('admin.noSlowQueries')}</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Query Patterns Tab */}
          <TabsContent value="patterns" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('admin.queryPatterns')}</CardTitle>
                <CardDescription>{t('admin.queryPatternsDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                {patterns.isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">{t('common.loading')}</div>
                ) : patterns.data && patterns.data.length > 0 ? (
                  <div className="space-y-3">
                    {patterns.data.map((pattern, idx) => (
                      <div key={idx} className="border rounded-lg p-3">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-info" />
                            <span className="font-semibold text-sm">{t('admin.pattern')} #{idx + 1}</span>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold">{pattern.count} {t('admin.executions')}</div>
                            <div className="text-xs text-muted-foreground">{pattern.avgTime.toFixed(2)}ms avg</div>
                          </div>
                        </div>
                        <p className="font-mono text-xs text-foreground break-words bg-muted p-2 rounded">
                          {pattern.query}
                        </p>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">{t('admin.totalTime')}:</span>
                            <span className="font-semibold ml-1">{pattern.totalTime.toFixed(2)}ms</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">{t('admin.avgTime')}:</span>
                            <span className="font-semibold ml-1">{pattern.avgTime.toFixed(2)}ms</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">{t('admin.count')}:</span>
                            <span className="font-semibold ml-1">{pattern.count}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">{t('admin.noQueryPatterns')}</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analysis Tab */}
          <TabsContent value="analysis" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('admin.performanceAnalysis')}</CardTitle>
                <CardDescription>{t('admin.recommendationsDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {stats.data && (
                  <>
                    <div className="bg-info/10 border border-info/30 rounded-lg p-4">
                      <h3 className="font-semibold text-info mb-2">{t('admin.keyMetrics')}</h3>
                      <ul className="space-y-2 text-sm text-foreground">
                        <li>
                          • <strong>{t('admin.totalQueries')}:</strong> {stats.data.totalQueries}
                        </li>
                        <li>
                          • <strong>{t('admin.slowQueryRate')}:</strong> {stats.data.slowQueryPercentage}%
                        </li>
                        <li>
                          • <strong>{t('admin.averageResponseTime')}:</strong> {stats.data.averageExecutionTime}ms
                        </li>
                        <li>
                          • <strong>{t('admin.maxResponseTime')}:</strong> {stats.data.maxExecutionTime}ms
                        </li>
                      </ul>
                    </div>

                    {stats.data.slowQueries > 0 && (
                      <div className="bg-warning/10 border border-warning/30 rounded-lg p-4">
                        <h3 className="font-semibold text-warning mb-2 flex items-center gap-2">
                          <Zap className="w-4 h-4" />
                          {t('admin.optimizationRecommendations')}
                        </h3>
                        <ul className="space-y-2 text-sm text-foreground">
                          <li>
                            • {t('admin.recommendation1')}
                          </li>
                          <li>
                            • {t('admin.recommendation2')}
                          </li>
                          <li>
                            • {t('admin.recommendation3')}
                          </li>
                          <li>
                            • {t('admin.recommendation4')}
                          </li>
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContainer>

      {/* Clear-history confirmation (replaces native window.confirm) */}
      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.clearHistoryTitle', 'Clear query history?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.confirmClearHistory')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmClearHistory}
            >
              {t('admin.clearHistory')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
