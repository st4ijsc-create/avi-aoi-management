import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { AlertCircle, Zap, TrendingUp, RefreshCw, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';

export default function AdminMonitoring() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Query monitoring APIs
  const slowQueries = trpc.system.queryMonitoring.getSlowQueries.useQuery({ limit: 50 });
  const stats = trpc.system.queryMonitoring.getStats.useQuery();
  const recentQueries = trpc.system.queryMonitoring.getRecentQueries.useQuery({ limit: 50 });
  const patterns = trpc.system.queryMonitoring.analyzePatterns.useQuery({ limit: 20 });
  const clearHistoryMutation = trpc.system.queryMonitoring.clearHistory.useMutation();

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      slowQueries.refetch();
      stats.refetch();
      recentQueries.refetch();
      patterns.refetch();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, slowQueries, stats, recentQueries, patterns]);

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear all query metrics history?')) {
      clearHistoryMutation.mutate(undefined, {
        onSuccess: () => {
          slowQueries.refetch();
          stats.refetch();
          recentQueries.refetch();
          patterns.refetch();
        },
      });
    }
  };

  const handleRefresh = () => {
    slowQueries.refetch();
    stats.refetch();
    recentQueries.refetch();
    patterns.refetch();
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Query Performance Monitoring</h1>
          <p className="text-gray-500">Monitor slow queries and database performance</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-green-50' : ''}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant="destructive" size="sm" onClick={handleClearHistory}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear History
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      {stats.data && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Queries</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.data.totalQueries}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Slow Queries</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.data.slowQueries}</div>
              <p className="text-xs text-gray-500 mt-1">{stats.data.slowQueryPercentage}% of total</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Avg Execution Time</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.data.averageExecutionTime}ms</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Max Execution Time</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.data.maxExecutionTime}ms</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="slow-queries" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="slow-queries">Slow Queries</TabsTrigger>
          <TabsTrigger value="recent">Recent Queries</TabsTrigger>
          <TabsTrigger value="patterns">Query Patterns</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
        </TabsList>

        {/* Slow Queries Tab */}
        <TabsContent value="slow-queries" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Slow Queries ({'>'}1000ms)</CardTitle>
              <CardDescription>Queries that took longer than 1 second to execute</CardDescription>
            </CardHeader>
            <CardContent>
              {slowQueries.isLoading ? (
                <div className="text-center py-8">Loading...</div>
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
                    <div className="text-center py-8 text-gray-500">No slow queries detected</div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">No slow queries detected</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recent Queries Tab */}
        <TabsContent value="recent" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Queries</CardTitle>
              <CardDescription>Last 50 executed queries</CardDescription>
            </CardHeader>
            <CardContent>
              {recentQueries.isLoading ? (
                <div className="text-center py-8">Loading...</div>
              ) : recentQueries.data && recentQueries.data.length > 0 ? (
                <div className="space-y-2">
                  {recentQueries.data.map((query, idx) => (
                    <div
                      key={idx}
                      className={`border rounded p-2 ${
                        query.isSlowQuery ? 'bg-red-50 border-red-200' : 'bg-gray-50'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-mono text-xs text-gray-700 flex-1 break-words">
                          {query.query}
                        </span>
                        <span
                          className={`text-xs font-semibold ml-2 whitespace-nowrap ${
                            query.isSlowQuery ? 'text-red-600' : 'text-green-600'
                          }`}
                        >
                          {query.executionTime.toFixed(2)}ms
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">No recent queries</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Query Patterns Tab */}
        <TabsContent value="patterns" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Query Patterns</CardTitle>
              <CardDescription>Most frequently executed query patterns and their performance</CardDescription>
            </CardHeader>
            <CardContent>
              {patterns.isLoading ? (
                <div className="text-center py-8">Loading...</div>
              ) : patterns.data && patterns.data.length > 0 ? (
                <div className="space-y-3">
                  {patterns.data.map((pattern, idx) => (
                    <div key={idx} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-5 h-5 text-blue-600" />
                          <span className="font-semibold text-sm">Pattern #{idx + 1}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">{pattern.count} executions</div>
                          <div className="text-xs text-gray-500">{pattern.avgTime.toFixed(2)}ms avg</div>
                        </div>
                      </div>
                      <p className="font-mono text-xs text-gray-700 break-words bg-gray-50 p-2 rounded">
                        {pattern.query}
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-gray-600">Total Time:</span>
                          <span className="font-semibold ml-1">{pattern.totalTime.toFixed(2)}ms</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Avg Time:</span>
                          <span className="font-semibold ml-1">{pattern.avgTime.toFixed(2)}ms</span>
                        </div>
                        <div>
                          <span className="text-gray-600">Count:</span>
                          <span className="font-semibold ml-1">{pattern.count}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">No query patterns detected</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analysis Tab */}
        <TabsContent value="analysis" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Performance Analysis</CardTitle>
              <CardDescription>Recommendations for query optimization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {stats.data && (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-900 mb-2">Key Metrics</h3>
                    <ul className="space-y-2 text-sm text-blue-800">
                      <li>
                        • <strong>Total Queries:</strong> {stats.data.totalQueries}
                      </li>
                      <li>
                        • <strong>Slow Query Rate:</strong> {stats.data.slowQueryPercentage}%
                      </li>
                      <li>
                        • <strong>Average Response Time:</strong> {stats.data.averageExecutionTime}ms
                      </li>
                      <li>
                        • <strong>Max Response Time:</strong> {stats.data.maxExecutionTime}ms
                      </li>
                    </ul>
                  </div>

                  {stats.data.slowQueries > 0 && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                      <h3 className="font-semibold text-orange-900 mb-2 flex items-center gap-2">
                        <Zap className="w-4 h-4" />
                        Optimization Recommendations
                      </h3>
                      <ul className="space-y-2 text-sm text-orange-800">
                        <li>
                          • Review slow queries above - consider adding database indexes for frequently filtered columns
                        </li>
                        <li>
                          • Analyze query patterns to identify opportunities for query consolidation
                        </li>
                        <li>
                          • Consider implementing query result caching for frequently accessed data
                        </li>
                        <li>
                          • Review GROUP BY and JOIN operations for potential optimization
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
  );
}
