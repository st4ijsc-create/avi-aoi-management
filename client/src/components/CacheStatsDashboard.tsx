import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { 
  Database, 
  Zap, 
  Clock, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  XCircle,
  AlertTriangle,
  Activity,
  HardDrive,
  Gauge,
  Flame,
  Play
} from 'lucide-react';

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  memoryUsage: number;
  isRedisConnected: boolean;
  lastError: string | null;
  uptime: number;
}

interface CacheHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  redis: boolean;
  memory: boolean;
  latency?: number;
}

// Cache Warming Section Component
function CacheWarmingSection() {
  const { data: warmingStats, refetch } = trpc.corporateFactoryStats.warmingStats.useQuery(undefined, {
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const triggerWarmingMutation = trpc.corporateFactoryStats.triggerWarming.useMutation({
    onSuccess: () => {
      toast.success('Cache warming triggered successfully');
      refetch();
    },
    onError: (error) => {
      toast.error('Failed to trigger warming', { description: error.message });
    },
  });

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" />
          Cache Warming
        </CardTitle>
        <CardDescription>
          Pre-cache statistics phổ biến để giảm cold start latency
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Warming Status */}
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">Trạng thái</span>
              <Badge variant={warmingStats?.isWarming ? 'default' : 'secondary'}>
                {warmingStats?.isWarming ? 'Warming...' : 'Idle'}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">Enabled</span>
              <Badge variant={warmingStats?.config.enabled ? 'default' : 'outline'}>
                {warmingStats?.config.enabled ? 'Yes' : 'No'}
              </Badge>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">Interval</span>
              <span className="font-medium">{warmingStats?.config.intervalMinutes || 30} phút</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">Lần warm cuối</span>
              <span className="font-medium">
                {warmingStats?.lastWarmingTime 
                  ? new Date(warmingStats.lastWarmingTime).toLocaleString('vi-VN')
                  : 'Chưa có'
                }
              </span>
            </div>
          </div>

          {/* Warming Stats */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-green-500/10 rounded-lg">
                <p className="text-2xl font-bold text-green-600">
                  {warmingStats?.stats.successfulWarms || 0}
                </p>
                <p className="text-xs text-muted-foreground">Thành công</p>
              </div>
              <div className="text-center p-3 bg-red-500/10 rounded-lg">
                <p className="text-2xl font-bold text-red-600">
                  {warmingStats?.stats.failedWarms || 0}
                </p>
                <p className="text-xs text-muted-foreground">Thất bại</p>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">Tổng số lần warm</span>
              <span className="font-medium">{warmingStats?.stats.totalWarms || 0}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">Thời gian lần cuối</span>
              <span className="font-medium">
                {warmingStats?.stats.lastDuration 
                  ? formatDuration(warmingStats.stats.lastDuration)
                  : '--'
                }
              </span>
            </div>
            <Button 
              className="w-full mt-4"
              onClick={() => triggerWarmingMutation.mutate()}
              disabled={triggerWarmingMutation.isPending || warmingStats?.isWarming}
            >
              <Play className="h-4 w-4 mr-2" />
              {triggerWarmingMutation.isPending || warmingStats?.isWarming 
                ? 'Warming...' 
                : 'Trigger Warming'
              }
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CacheStatsDashboard() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const { data: stats, refetch: refetchStats, isLoading: statsLoading } = 
    trpc.corporateFactoryStats.cacheStats.useQuery(undefined, {
      refetchInterval: 10000, // Auto refresh every 10 seconds
    });

  const { data: health, refetch: refetchHealth, isLoading: healthLoading } = 
    trpc.corporateFactoryStats.cacheHealth.useQuery(undefined, {
      refetchInterval: 10000,
    });

  const clearCacheMutation = trpc.corporateFactoryStats.clearCache.useMutation({
    onSuccess: () => {
      toast.success('Cache đã được xóa thành công');
      refetchStats();
    },
    onError: (error) => {
      toast.error('Lỗi xóa cache', { description: error.message });
    },
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchStats(), refetchHealth()]);
    setIsRefreshing(false);
    toast.success('Đã cập nhật thông tin cache');
  };

  const handleClearCache = () => {
    if (confirm('Bạn có chắc muốn xóa toàn bộ cache thống kê? Điều này có thể làm chậm các queries tiếp theo.')) {
      clearCacheMutation.mutate();
    }
  };

  // Calculate hit rate
  const hitRate = stats 
    ? stats.hits + stats.misses > 0 
      ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1)
      : '0.0'
    : '0.0';

  // Format memory usage
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format uptime
  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'degraded':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'unhealthy':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Activity className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Healthy</Badge>;
      case 'degraded':
        return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Degraded</Badge>;
      case 'unhealthy':
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Unhealthy</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Database className="h-6 w-6 text-primary" />
            Cache Statistics
          </h2>
          <p className="text-muted-foreground">
            Giám sát hiệu suất cache của hệ thống
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={handleClearCache}
            disabled={clearCacheMutation.isPending}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Cache
          </Button>
        </div>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Health Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Trạng thái
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              {health && getStatusIcon(health.status)}
              <div>
                {health && getStatusBadge(health.status)}
                {health?.latency && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Latency: {health.latency}ms
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Redis Connection */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Database className="h-4 w-4" />
              Redis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {stats?.isRedisConnected ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="font-medium text-green-600">Connected</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-yellow-500" />
                  <span className="font-medium text-yellow-600">Fallback Mode</span>
                </>
              )}
            </div>
            {!stats?.isRedisConnected && (
              <p className="text-xs text-muted-foreground mt-1">
                Using in-memory cache
              </p>
            )}
          </CardContent>
        </Card>

        {/* Uptime */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Uptime
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {stats ? formatUptime(stats.uptime) : '--'}
            </p>
          </CardContent>
        </Card>

        {/* Cache Size */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Cache Size
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {stats?.size ?? 0} <span className="text-sm font-normal text-muted-foreground">entries</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {stats ? formatBytes(stats.memoryUsage) : '0 B'} memory
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Hit Rate */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-primary" />
              Cache Hit Rate
            </CardTitle>
            <CardDescription>
              Tỷ lệ cache hit so với tổng số requests
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-4xl font-bold text-foreground">{hitRate}%</span>
              <Badge 
                variant="outline" 
                className={
                  parseFloat(hitRate) >= 80 
                    ? 'border-green-500 text-green-500' 
                    : parseFloat(hitRate) >= 50 
                      ? 'border-yellow-500 text-yellow-500'
                      : 'border-red-500 text-red-500'
                }
              >
                {parseFloat(hitRate) >= 80 ? 'Excellent' : parseFloat(hitRate) >= 50 ? 'Good' : 'Poor'}
              </Badge>
            </div>
            <Progress 
              value={parseFloat(hitRate)} 
              className="h-3"
            />
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="text-center p-3 bg-green-500/10 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{stats?.hits ?? 0}</p>
                <p className="text-xs text-muted-foreground">Cache Hits</p>
              </div>
              <div className="text-center p-3 bg-red-500/10 rounded-lg">
                <p className="text-2xl font-bold text-red-600">{stats?.misses ?? 0}</p>
                <p className="text-xs text-muted-foreground">Cache Misses</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cache Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Cache Configuration
            </CardTitle>
            <CardDescription>
              Thông tin cấu hình cache hiện tại
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-muted-foreground">Cache Type</span>
                <Badge variant="outline">
                  {stats?.isRedisConnected ? 'Redis' : 'In-Memory'}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-muted-foreground">Default TTL</span>
                <span className="font-medium">5 minutes</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-muted-foreground">Key Prefix</span>
                <code className="text-sm bg-muted px-2 py-1 rounded">avi:</code>
              </div>
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-muted-foreground">Pub/Sub Channel</span>
                <code className="text-sm bg-muted px-2 py-1 rounded">cache:invalidate</code>
              </div>
              {stats?.lastError && (
                <div className="p-3 bg-red-500/10 rounded-lg">
                  <p className="text-sm font-medium text-red-600">Last Error</p>
                  <p className="text-xs text-red-500 mt-1">{stats.lastError}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cache Warming */}
      <CacheWarmingSection />

      {/* Cache Tips */}
      <Card>
        <CardHeader>
          <CardTitle>Cache Best Practices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-blue-500/10 rounded-lg">
              <h4 className="font-medium text-blue-600 mb-2">High Hit Rate</h4>
              <p className="text-sm text-muted-foreground">
                Hit rate trên 80% cho thấy cache đang hoạt động hiệu quả, giảm tải cho database.
              </p>
            </div>
            <div className="p-4 bg-green-500/10 rounded-lg">
              <h4 className="font-medium text-green-600 mb-2">Auto Invalidation</h4>
              <p className="text-sm text-muted-foreground">
                Cache tự động được xóa khi có inspection mới để đảm bảo dữ liệu luôn chính xác.
              </p>
            </div>
            <div className="p-4 bg-purple-500/10 rounded-lg">
              <h4 className="font-medium text-purple-600 mb-2">Redis Fallback</h4>
              <p className="text-sm text-muted-foreground">
                Khi Redis không khả dụng, hệ thống tự động chuyển sang in-memory cache.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default CacheStatsDashboard;
