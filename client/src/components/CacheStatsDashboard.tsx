import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { mapTrpcError } from '@/lib/trpcErrors';
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
  Play,
  Settings,
  Save
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

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
  const [showConfig, setShowConfig] = useState(false);
  const [configEnabled, setConfigEnabled] = useState(true);
  const [configInterval, setConfigInterval] = useState(30);
  const [configWarmOnStartup, setConfigWarmOnStartup] = useState(true);
  const { t } = useTranslation();

  const { data: warmingStats, refetch } = trpc.corporateFactoryStats.warmingStats.useQuery(undefined, {
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Sync local state with server config
  React.useEffect(() => {
    if (warmingStats?.config) {
      setConfigEnabled(warmingStats.config.enabled);
      setConfigInterval(warmingStats.config.intervalMinutes);
      setConfigWarmOnStartup(warmingStats.config.warmOnStart);
    }
  }, [warmingStats?.config]);

  const triggerWarmingMutation = trpc.corporateFactoryStats.triggerWarming.useMutation({
    onSuccess: () => {
      toast.success('Cache warming triggered successfully');
      refetch();
    },
    onError: (error) => {
      toast.error('Failed to trigger warming', { description: mapTrpcError(error) });
    },
  });

  const updateConfigMutation = trpc.corporateFactoryStats.updateWarmingConfig.useMutation({
    onSuccess: () => {
      toast.success(t('cache.warming.configSaved'));
      refetch();
      setShowConfig(false);
    },
    onError: (error) => {
      toast.error(t('cache.warming.configSaveError'), { description: mapTrpcError(error) });
    },
  });

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const handleSaveConfig = () => {
    updateConfigMutation.mutate({
      enabled: configEnabled,
      intervalMinutes: configInterval,
      warmOnStartup: configWarmOnStartup,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              Cache Warming
            </CardTitle>
            <CardDescription>
              {t('cache.warming.description')}
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setShowConfig(!showConfig)}
          >
            <Settings className="h-4 w-4 mr-2" />
            {t('cache.warming.config')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Configuration Panel */}
        {showConfig && (
          <div className="mb-6 p-4 bg-secondary/50 rounded-lg space-y-4">
            <h4 className="font-medium text-foreground">{t('cache.warming.configTitle')}</h4>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="warming-enabled" className="text-sm">
                {t('cache.warming.enableWarming')}
              </Label>
              <Switch
                id="warming-enabled"
                checked={configEnabled}
                onCheckedChange={setConfigEnabled}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="warm-on-startup" className="text-sm">
                {t('cache.warming.warmOnStartup')}
              </Label>
              <Switch
                id="warm-on-startup"
                checked={configWarmOnStartup}
                onCheckedChange={setConfigWarmOnStartup}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="interval" className="text-sm">
                {t('cache.warming.intervalLabel')}
              </Label>
              <Input
                id="interval"
                type="number"
                min={5}
                max={1440}
                value={configInterval}
                onChange={(e) => setConfigInterval(Math.max(5, Math.min(1440, parseInt(e.target.value) || 30)))}
                className="w-full"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button 
                size="sm" 
                onClick={handleSaveConfig}
                disabled={updateConfigMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                {updateConfigMutation.isPending ? t('common.saving') : t('cache.warming.saveConfig')}
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowConfig(false)}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Warming Status */}
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">{t('cache.warming.status')}</span>
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
              <span className="font-medium">{warmingStats?.config.intervalMinutes || 30} {t('cache.warming.minutes')}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">{t('cache.warming.lastWarm')}</span>
              <span className="font-medium">
                {warmingStats?.lastWarmingTime 
                  ? new Date(warmingStats.lastWarmingTime).toLocaleString('vi-VN')
                  : t('cache.warming.none')
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
                <p className="text-xs text-muted-foreground">{t('cache.warming.successful')}</p>
              </div>
              <div className="text-center p-3 bg-red-500/10 rounded-lg">
                <p className="text-2xl font-bold text-red-600">
                  {warmingStats?.stats.failedWarms || 0}
                </p>
                <p className="text-xs text-muted-foreground">{t('cache.warming.failed')}</p>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">{t('cache.warming.totalWarms')}</span>
              <span className="font-medium">{warmingStats?.stats.totalWarms || 0}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">{t('cache.warming.lastDuration')}</span>
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
  const { t } = useTranslation();
  
  const { data: stats, refetch: refetchStats, isLoading: statsLoading } = 
    trpc.corporateFactoryStats.cacheStats.useQuery(undefined, {
      refetchInterval: 10000, // Auto refresh every 10 seconds
    });

  const { data: health, refetch: refetchHealth, isLoading: healthLoading } = 
    trpc.corporateFactoryStats.cacheHealth.useQuery(undefined, {
      refetchInterval: 10000,
    });

  // Redis connection status
  const { data: redisStatus, refetch: refetchRedisStatus } = 
    trpc.corporateFactoryStats.redisConnectionStatus.useQuery(undefined, {
      refetchInterval: 15000, // Refresh every 15 seconds
    });

  const clearCacheMutation = trpc.corporateFactoryStats.clearCache.useMutation({
    onSuccess: () => {
      toast.success(t('cache.clearSuccess'));
      refetchStats();
    },
    onError: (error) => {
      toast.error(t('cache.clearError'), { description: mapTrpcError(error) });
    },
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchStats(), refetchHealth()]);
    setIsRefreshing(false);
    toast.success(t('cache.refreshSuccess'));
  };

  const handleClearCache = () => {
    if (confirm(t('cache.confirmClear'))) {
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
            {t('cache.monitorDescription')}
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
              {t('cache.warming.status')}
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
              {t('cache.hitRateDescription')}
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
              {t('cache.configDescription')}
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

      {/* Redis Connection Monitoring */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Redis Connection Monitoring
          </CardTitle>
          <CardDescription>
            {t('cache.redisMonitorDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Current Status */}
            <div className="space-y-4">
              <h4 className="font-medium text-foreground">{t('cache.currentStatus')}</h4>
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-muted-foreground">{t('cache.connection')}</span>
                <Badge variant={redisStatus?.isConnected ? 'default' : 'secondary'}>
                  {redisStatus?.isConnected ? 'Connected' : 'Disconnected'}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-muted-foreground">{t('cache.mode')}</span>
                <Badge variant={redisStatus?.mode === 'redis' ? 'default' : 'outline'}>
                  {redisStatus?.mode === 'redis' ? 'Redis' : 'In-Memory Fallback'}
                </Badge>
              </div>
              {redisStatus?.lastError && (
                <div className="p-3 bg-red-500/10 rounded-lg">
                  <p className="text-sm font-medium text-red-600">{t('cache.latestError')}</p>
                  <p className="text-xs text-red-500 mt-1">{redisStatus.lastError}</p>
                </div>
              )}
              {!redisStatus?.isConnected && !redisStatus?.lastError && (
                <div className="p-3 bg-yellow-500/10 rounded-lg">
                  <p className="text-sm font-medium text-yellow-600">
                    <AlertTriangle className="h-4 w-4 inline mr-1" />
                    {t('cache.redisNotConfigured')}
                  </p>
                  <p className="text-xs text-yellow-600 mt-1">
                    {t('cache.addRedisUrl')}
                  </p>
                </div>
              )}
            </div>

            {/* Recent Events */}
            <div className="space-y-4">
              <h4 className="font-medium text-foreground">{t('cache.recentEvents')}</h4>
              {redisStatus?.recentEvents && redisStatus.recentEvents.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {redisStatus.recentEvents.slice().reverse().map((event, idx) => (
                    <div 
                      key={idx} 
                      className={`p-2 rounded text-sm flex items-start gap-2 ${
                        event.type === 'connect' || event.type === 'reconnect' 
                          ? 'bg-green-500/10 text-green-700' 
                          : event.type === 'error' 
                            ? 'bg-red-500/10 text-red-700'
                            : 'bg-yellow-500/10 text-yellow-700'
                      }`}
                    >
                      {event.type === 'connect' || event.type === 'reconnect' ? (
                        <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      ) : event.type === 'error' ? (
                        <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      )}
                      <div>
                        <p className="font-medium capitalize">{event.type}</p>
                        <p className="text-xs opacity-80">{event.message}</p>
                        <p className="text-xs opacity-60">
                          {new Date(event.timestamp).toLocaleString('vi-VN')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {t('cache.noEvents')}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

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
                {t('cache.tipHighHitRate')}
              </p>
            </div>
            <div className="p-4 bg-green-500/10 rounded-lg">
              <h4 className="font-medium text-green-600 mb-2">Auto Invalidation</h4>
              <p className="text-sm text-muted-foreground">
                {t('cache.tipAutoInvalidation')}
              </p>
            </div>
            <div className="p-4 bg-purple-500/10 rounded-lg">
              <h4 className="font-medium text-purple-600 mb-2">Redis Fallback</h4>
              <p className="text-sm text-muted-foreground">
                {t('cache.tipRedisFallback')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default CacheStatsDashboard;
