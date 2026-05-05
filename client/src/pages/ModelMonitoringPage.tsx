import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { trpc } from '@/lib/trpc';
import { navItems } from '@/lib/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Bell,
  BellOff,
  RefreshCw,
  Shield,
  TrendingDown,
  Zap,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

type HealthStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

const HEALTH_CONFIG: Record<HealthStatus, {
  label: string;
  color: string;
  icon: React.ReactNode;
  bg: string;
}> = {
  HEALTHY:  { label: 'Healthy',  color: 'text-green-600',  icon: <CheckCircle2 className="h-5 w-5" />,  bg: 'bg-green-50 dark:bg-green-950/20' },
  WARNING:  { label: 'Warning',  color: 'text-yellow-600', icon: <AlertTriangle className="h-5 w-5" />, bg: 'bg-yellow-50 dark:bg-yellow-950/20' },
  CRITICAL: { label: 'Critical', color: 'text-red-600',    icon: <XCircle className="h-5 w-5" />,       bg: 'bg-red-50 dark:bg-red-950/20' },
  UNKNOWN:  { label: 'Unknown',  color: 'text-gray-500',   icon: <Activity className="h-5 w-5" />,      bg: 'bg-gray-50 dark:bg-gray-950/20' },
};

const SEVERITY_VARIANT: Record<AlertSeverity, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  INFO:     'secondary',
  WARNING:  'default',
  CRITICAL: 'destructive',
};

export default function ModelMonitoringPage() {
  const { t } = useTranslation();
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  // Fetch all models
  const { data: models, isLoading: modelsLoading } = trpc.aiModel.list.useQuery({ limit: 100 });

  // Fetch health for selected model
  const {
    data: health,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = trpc.aiAdvanced.monitoring.health.useQuery(
    { modelId: selectedModelId! },
    { enabled: selectedModelId !== null, refetchInterval: 30_000 },
  );

  // Fetch drift alerts (filtered to selected model)
  const {
    data: alerts,
    isLoading: alertsLoading,
    refetch: refetchAlerts,
  } = trpc.aiAdvanced.monitoring.alerts.useQuery(
    { modelId: selectedModelId ?? undefined, limit: 50 },
    { enabled: true, refetchInterval: 30_000 },
  );

  const acknowledgeAlert = trpc.aiAdvanced.monitoring.acknowledgeAlert.useMutation({
    onSuccess: () => {
      toast.success(t('modelMonitoring.alertAcknowledged'));
      refetchAlerts();
    },
    onError: (err) => toast.error(err.message),
  });

  const resolveAlert = trpc.aiAdvanced.monitoring.resolveAlert.useMutation({
    onSuccess: () => {
      toast.success(t('modelMonitoring.alertResolved'));
      refetchAlerts();
      refetchHealth();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleRefresh = () => {
    refetchHealth();
    refetchAlerts();
  };

  const healthStatus = (health?.healthStatus as HealthStatus) ?? 'UNKNOWN';
  const healthCfg = HEALTH_CONFIG[healthStatus];
  const score = health?.healthScore ?? 0;

  return (
    <DashboardLayout title={t('modelMonitoring.title')} navItems={navItems} currentPath="/ai-monitoring">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              {t('modelMonitoring.title')}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t('modelMonitoring.subtitle')}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('modelMonitoring.refresh')}
          </Button>
        </div>

        {/* Model Selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('modelMonitoring.selectModel')}</CardTitle>
          </CardHeader>
          <CardContent>
            {modelsLoading ? (
              <Skeleton className="h-10 w-64" />
            ) : (
              <Select
                value={selectedModelId?.toString() ?? ''}
                onValueChange={(v) => setSelectedModelId(Number(v))}
              >
                <SelectTrigger className="w-72">
                  <SelectValue placeholder={t('modelMonitoring.chooseModel')} />
                </SelectTrigger>
                <SelectContent>
                  {models?.map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      <span className="font-medium">{m.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">({m.code})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Health Score + KPIs */}
        {selectedModelId && (
          <>
            {healthLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-28" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Health Score */}
                <Card className={cn(healthCfg.bg)}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-muted-foreground">{t('modelMonitoring.healthScore')}</span>
                      <span className={cn("flex items-center gap-1", healthCfg.color)}>
                        {healthCfg.icon}
                        <span className="text-sm font-semibold">{healthCfg.label}</span>
                      </span>
                    </div>
                    <div className="text-3xl font-bold mb-2">{Math.round(score * 100)}%</div>
                    <Progress value={score * 100} className="h-2" />
                  </CardContent>
                </Card>

                {/* Latest Accuracy */}
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart3 className="h-4 w-4 text-blue-500" />
                      <span className="text-sm font-medium text-muted-foreground">{t('modelMonitoring.accuracyLatest')}</span>
                    </div>
                    <div className="text-3xl font-bold">
                      {health?.latestSnapshot?.accuracy != null
                        ? `${(parseFloat(String(health.latestSnapshot.accuracy)) * 100).toFixed(1)}%`
                        : '—'}
                    </div>
                    {health?.latestSnapshot?.totalInferences != null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('modelMonitoring.inferences', { count: health.latestSnapshot.totalInferences.toLocaleString() })}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Active Alerts */}
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Bell className="h-4 w-4 text-orange-500" />
                      <span className="text-sm font-medium text-muted-foreground">{t('modelMonitoring.activeAlerts')}</span>
                    </div>
                    <div className="text-3xl font-bold">{health?.activeAlerts?.length ?? 0}</div>
                    {(health?.activeAlerts?.length ?? 0) > 0 && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {t('modelMonitoring.requiresAttention')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Drift Alerts Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  {t('modelMonitoring.driftAlerts')}
                </CardTitle>
                <CardDescription>
                  {t('modelMonitoring.driftAlertsDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {alertsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : !alerts || alerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                    <CheckCircle2 className="h-10 w-10 mb-3 text-green-500 opacity-60" />
                    <p className="text-sm">{t('modelMonitoring.noAlerts')}</p>
                  </div>
                ) : (
                  <ScrollArea className="max-h-105">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('modelMonitoring.colType')}</TableHead>
                          <TableHead>{t('modelMonitoring.colSeverity')}</TableHead>
                          <TableHead>{t('modelMonitoring.colMessage')}</TableHead>
                          <TableHead>{t('modelMonitoring.colDetected')}</TableHead>
                          <TableHead>{t('modelMonitoring.colStatus')}</TableHead>
                          <TableHead className="text-right">{t('modelMonitoring.colActions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {alerts.map((alert: any) => {
                          const severity = (alert.severity as AlertSeverity) ?? 'INFO';
                          const isResolved = !!alert.resolvedAt;
                          const isAcknowledged = !!alert.acknowledgedAt;

                          return (
                            <TableRow key={alert.id} className={cn(isResolved && 'opacity-50')}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="text-sm font-mono">{alert.alertType}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={SEVERITY_VARIANT[severity]}>{severity}</Badge>
                              </TableCell>
                              <TableCell className="max-w-xs">
                                <p className="text-sm text-muted-foreground truncate">{alert.message}</p>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                {alert.detectedAt
                                  ? format(new Date(alert.detectedAt), 'dd MMM HH:mm')
                                  : '—'}
                              </TableCell>
                              <TableCell>
                                {isResolved ? (
                                  <Badge variant="outline" className="text-green-600">{t('modelMonitoring.statusResolved')}</Badge>
                                ) : isAcknowledged ? (
                                  <Badge variant="secondary">{t('modelMonitoring.statusAcknowledged')}</Badge>
                                ) : (
                                  <Badge variant="destructive" className="animate-pulse">{t('modelMonitoring.statusOpen')}</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  {!isAcknowledged && !isResolved && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={acknowledgeAlert.isPending}
                                      onClick={() => acknowledgeAlert.mutate({ alertId: alert.id })}
                                    >
                                      <BellOff className="h-3 w-3 mr-1" />
                                      {t('modelMonitoring.ack')}
                                    </Button>
                                  )}
                                  {!isResolved && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={resolveAlert.isPending}
                                      onClick={() => resolveAlert.mutate({ alertId: alert.id })}
                                    >
                                      <CheckCircle2 className="h-3 w-3 mr-1" />
                                      {t('modelMonitoring.resolve')}
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Performance Trend */}
            {health?.trend && health.trend.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    {t('modelMonitoring.performanceTrend', { count: health.trend.length })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {health.trend.slice(-10).map((snap: any, i: number) => {
                      const acc = snap.accuracy ?? 0;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-24 shrink-0">
                            {snap.periodEnd
                              ? format(new Date(snap.periodEnd), 'dd MMM HH:mm')
                              : `#${i + 1}`}
                          </span>
                          <Progress value={acc * 100} className="flex-1 h-2" />
                          <span className="text-xs font-mono w-14 text-right">
                            {(acc * 100).toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {!selectedModelId && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Activity className="h-12 w-12 mb-4 opacity-30" />
              <p>Select a model above to view its health metrics and drift alerts</p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
