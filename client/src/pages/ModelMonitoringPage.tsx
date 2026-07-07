import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { PageHeader, PageContainer, MetricCard, EmptyState, ThemedLineChart } from '@/components/patterns';
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

/** One point of the model-performance trend (a monitoring window snapshot). */
interface TrendSnapshot {
  accuracy?: number | string | null;
  periodEnd?: string | Date | null;
}

/** A single {time, accuracy%} row consumed by the trend chart. */
interface TrendPoint {
  time: string;
  accuracy: number;
  // index signature so the row type satisfies ThemedLineChart's Record<string, unknown>[]
  [key: string]: unknown;
}

const HEALTH_CONFIG: Record<HealthStatus, {
  label: string;
  color: string;
  icon: React.ReactNode;
  bg: string;
}> = {
  HEALTHY:  { label: 'Healthy',  color: 'text-success',          icon: <CheckCircle2 className="h-5 w-5" />, bg: 'bg-success/10' },
  WARNING:  { label: 'Warning',  color: 'text-warning',          icon: <AlertTriangle className="h-5 w-5" />, bg: 'bg-warning/10' },
  CRITICAL: { label: 'Critical', color: 'text-destructive',      icon: <XCircle className="h-5 w-5" />,       bg: 'bg-destructive/10' },
  UNKNOWN:  { label: 'Unknown',  color: 'text-muted-foreground',  icon: <Activity className="h-5 w-5" />,      bg: 'bg-muted/40' },
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
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<Activity className="h-6 w-6" />}
          title={t('modelMonitoring.title')}
          description={t('modelMonitoring.subtitle')}
          actions={
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('modelMonitoring.refresh')}
            </Button>
          }
        />

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
                <MetricCard
                  icon={<BarChart3 className="h-4 w-4" />}
                  label={t('modelMonitoring.accuracyLatest')}
                  value={
                    health?.latestSnapshot?.accuracy != null
                      ? `${(parseFloat(String(health.latestSnapshot.accuracy)) * 100).toFixed(1)}%`
                      : '—'
                  }
                  delta={
                    health?.latestSnapshot?.totalInferences != null
                      ? t('modelMonitoring.inferences', { count: health.latestSnapshot.totalInferences.toLocaleString() })
                      : undefined
                  }
                />

                {/* Active Alerts */}
                <MetricCard
                  icon={<Bell className="h-4 w-4" />}
                  label={t('modelMonitoring.activeAlerts')}
                  value={health?.activeAlerts?.length ?? 0}
                  tone={(health?.activeAlerts?.length ?? 0) > 0 ? 'warning' : 'default'}
                  delta={
                    (health?.activeAlerts?.length ?? 0) > 0 ? (
                      <span className="flex items-center gap-1 text-destructive">
                        <AlertTriangle className="h-3 w-3" />
                        {t('modelMonitoring.requiresAttention')}
                      </span>
                    ) : undefined
                  }
                />
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
                  <EmptyState
                    variant="no-data"
                    icon={CheckCircle2}
                    title={t('modelMonitoring.noAlerts')}
                    description={t('modelMonitoring.noAlertsDesc', 'This model has no open drift alerts.')}
                    compact
                  />
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
                                  <Badge variant="outline" className="text-success">{t('modelMonitoring.statusResolved')}</Badge>
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
                  <ThemedLineChart
                    data={(health.trend as TrendSnapshot[]).slice(-10).map((snap, i): TrendPoint => ({
                      time: snap.periodEnd
                        ? format(new Date(snap.periodEnd), 'dd MMM HH:mm')
                        : `#${i + 1}`,
                      accuracy: Number(snap.accuracy ?? 0) * 100,
                    }))}
                    xKey="time"
                    series={[{ key: 'accuracy', name: t('modelMonitoring.accuracyLatest') }]}
                    height={280}
                    yTickFormatter={(v) => `${v.toFixed(0)}%`}
                    aria-label={t('modelMonitoring.performanceTrend', { count: health.trend.length })}
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}

        {!selectedModelId && (
          <Card className="border-dashed">
            <EmptyState
              icon={Activity}
              title={t('modelMonitoring.selectModelTitle', 'Select a model')}
              description={t('modelMonitoring.selectModelHint', 'Select a model above to view its health metrics and drift alerts.')}
            />
          </Card>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}
