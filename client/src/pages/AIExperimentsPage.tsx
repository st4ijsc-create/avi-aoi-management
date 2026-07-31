import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import {
  PageHeader,
  StatusBadge,
  chartColor,
  chartTooltipStyle,
  chartTooltipLabelStyle,
  chartGridProps,
  chartAxisTick,
} from '@/components/patterns';
import { trpc } from '@/lib/trpc';
import { toastTrpcError } from '@/lib/trpcErrors';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FlaskConical, BarChart3, CheckCircle2, XCircle, RefreshCw, Award, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ModelSelect, DatasetSelect } from '@/components/ai/ModelSelect';
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

// doc 69 Wave E1 (T7) — extracted from AIPerformanceDashboard.tsx (was an 8-tab
// page mixing live monitoring + experiments + MLOps history). The evaluation
// (before/after) and A/B canary tabs are MLOps *experiments*, distinct from the
// live-monitoring tabs that stay on /ai-performance. Tab bodies below are moved
// verbatim (not rewritten) — same tRPC procedures, same i18n keys.
export default function AIExperimentsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('evaluation');

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <PageHeader
          icon={<FlaskConical className="h-6 w-6" />}
          title={t('aiExperiments.title', 'Thử nghiệm AI')}
          description={t('aiExperiments.description', 'Đánh giá before/after và A/B canary cho mô hình AI')}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="evaluation" className="flex items-center gap-2">
              {t('aiEval.beforeAfterTab', 'Eval (Before/After)')}
            </TabsTrigger>
            <TabsTrigger value="canary" className="flex items-center gap-2">
              {t('canary.tab', 'A/B Canary')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="evaluation" className="space-y-4">
            <EvalBeforeAfterSection />
          </TabsContent>

          <TabsContent value="canary" className="space-y-4">
            <CanaryComparisonSection />
          </TabsContent>
        </Tabs>
      </div>
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
    onError: (err) => toastTrpcError(err),
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
    onError: (e) => toastTrpcError(e),
  });
  const pause = trpc.aiQualityGate.canaryPause.useMutation({
    onSuccess: () => { toast.success(t('canary.paused', 'Đã tạm dừng canary')); refresh(); },
    onError: (e) => toastTrpcError(e),
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
    onError: (e) => toastTrpcError(e),
  });
  const promote = trpc.aiQualityGate.canaryPromote.useMutation({
    onSuccess: () => { toast.success(t('canary.promoted', 'Đã promote model B')); refresh(); },
    onError: (e) => toastTrpcError(e),
  });
  const rollback = trpc.aiQualityGate.canaryRollback.useMutation({
    onSuccess: () => { toast.success(t('canary.rolledBack', 'Đã rollback về model A')); refresh(); },
    onError: (e) => toastTrpcError(e),
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
