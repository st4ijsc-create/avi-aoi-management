import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { AlertCircle, Zap, TrendingUp, RefreshCw, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';

export default function AdminMonitoring() {
  const { t } = useTranslation();
  const [autoRefresh, setAutoRefresh] = useState(true);

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

  const handleClearHistory = () => {
    if (confirm(t('admin.confirmClearHistory'))) {
      clearHistoryMutation.mutate(undefined, {
        onSuccess: () => {
          slowQueries.refetch();
          stats.refetch();
          patterns.refetch();
        },
      });
    }
  };

  const handleRefresh = () => {
    slowQueries.refetch();
    stats.refetch();
    patterns.refetch();
  };

  return (
    <DashboardLayout title={t('admin.queryPerformanceMonitoring')}>
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t('admin.queryPerformanceMonitoring')}</h1>
          <p className="text-gray-500">{t('admin.monitorSlowQueries')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-green-50' : ''}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {autoRefresh ? t('admin.autoRefreshOn') : t('admin.autoRefreshOff')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="destructive" size="sm" onClick={handleClearHistory}>
            <Trash2 className="w-4 h-4 mr-2" />
            {t('admin.clearHistory')}
          </Button>
        </div>
      </div>

      {/* Kill-switch banner — monitor disabled means honest "no data", not "no slow queries" */}
      {stats.data && stats.data.enabled === false && (
        <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {t('admin.queryMonitorOff', 'Query monitor đang TẮT (QUERY_MONITOR_ENABLED=false) — không có số liệu nào được ghi nhận.')}
        </div>
      )}

      {/* Statistics Cards */}
      {stats.data && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">{t('admin.totalQueries')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.data.totalQueries}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">{t('admin.slowQueries')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.data.slowQueries}</div>
              <p className="text-xs text-gray-500 mt-1">{stats.data.slowQueryPercentage}% {t('admin.ofTotal')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">{t('admin.avgExecutionTime')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.data.averageExecutionTime}ms</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">{t('admin.maxExecutionTime')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.data.maxExecutionTime}ms</div>
            </CardContent>
          </Card>
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
                <div className="text-center py-8">{t('common.loading')}</div>
              ) : slowQueries.data && (slowQueries.data.length > 0) ? (
                <div className="space-y-3">
                  {slowQueries.data.map((query, idx) => (
                    <div key={idx} className="border rounded-lg p-3 bg-red-50">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-5 h-5 text-red-600" />
                          <span className="font-mono text-sm font-semibold text-red-600">
                            {query.executionTime.toFixed(2)}ms
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(query.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-gray-700 break-words">{query.query}</p>
                    </div>
                  ))}
                  {slowQueries.data.length === 0 && (
                    <div className="text-center py-8 text-gray-500">{t('admin.noSlowQueries')}</div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">{t('admin.noSlowQueries')}</div>
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
                <div className="text-center py-8">{t('common.loading')}</div>
              ) : patterns.data && patterns.data.length > 0 ? (
                <div className="space-y-3">
                  {patterns.data.map((pattern, idx) => (
                    <div key={idx} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-5 h-5 text-blue-600" />
                          <span className="font-semibold text-sm">{t('admin.pattern')} #{idx + 1}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">{pattern.count} {t('admin.executions')}</div>
                          <div className="text-xs text-gray-500">{pattern.avgTime.toFixed(2)}ms avg</div>
                        </div>
                      </div>
                      <p className="font-mono text-xs text-gray-700 break-words bg-gray-50 p-2 rounded">
                        {pattern.query}
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-gray-600">{t('admin.totalTime')}:</span>
                          <span className="font-semibold ml-1">{pattern.totalTime.toFixed(2)}ms</span>
                        </div>
                        <div>
                          <span className="text-gray-600">{t('admin.avgTime')}:</span>
                          <span className="font-semibold ml-1">{pattern.avgTime.toFixed(2)}ms</span>
                        </div>
                        <div>
                          <span className="text-gray-600">{t('admin.count')}:</span>
                          <span className="font-semibold ml-1">{pattern.count}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">{t('admin.noQueryPatterns')}</div>
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
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-900 mb-2">{t('admin.keyMetrics')}</h3>
                    <ul className="space-y-2 text-sm text-blue-800">
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
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                      <h3 className="font-semibold text-orange-900 mb-2 flex items-center gap-2">
                        <Zap className="w-4 h-4" />
                        {t('admin.optimizationRecommendations')}
                      </h3>
                      <ul className="space-y-2 text-sm text-orange-800">
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
    </div>
    </DashboardLayout>
  );
}
