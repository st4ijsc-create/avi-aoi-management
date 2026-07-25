import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { PageHeader } from '@/components/patterns';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Boxes, Play, Loader2, PieChart } from 'lucide-react';
import { toast } from 'sonner';
import { DatasetSelect } from '@/components/ai/ModelSelect';

// doc 69 Wave E1 (T7) — extracted from AIDataProcessingPage.tsx ("dataset" tab).
// A dataset split is a durable training asset (Knowledge & Training), distinct
// from the ephemeral pipeline/preprocessing/augmentation steps that stay on
// /ai-data-processing. Moved verbatim — same tRPC procedure, same i18n keys.
export default function AIDatasetsPage() {
  const { t } = useTranslation();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <PageHeader
          icon={<Boxes className="h-6 w-6" />}
          title={t('aiDatasets.title', 'Bộ dữ liệu AI')}
          description={t('aiDatasets.description', 'Materialize dataset train/val/test từ dữ liệu đã gán nhãn')}
        />

        <DatasetSplitSection />
      </div>
    </DashboardLayout>
  );
}

// ─── Dataset Split Section (WS-1) ────────────────────────────────────────────

function DatasetSplitSection() {
  const { t } = useTranslation();
  const [datasetId, setDatasetId] = useState('');
  const [result, setResult] = useState<{
    datasetId: number;
    totalSamples: number;
    labelDistribution: Record<string, number>;
    split: { train: number; val: number; test: number };
    labels: string[];
  } | null>(null);

  const buildDataset = trpc.aiEval.buildDataset.useMutation({
    onSuccess: (data) => {
      setResult(data);
      toast.success(
        t('aiDataProcessing.dataset.built', 'Đã build dataset: {{count}} mẫu', {
          count: data.totalSamples,
        }),
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const splitTotal = result ? result.split.train + result.split.val + result.split.test : 0;
  const pct = (n: number) => (splitTotal > 0 ? ((n / splitTotal) * 100).toFixed(1) : '0');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('aiDataProcessing.dataset.title', 'Tạo Dataset Split')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('aiDataProcessing.dataset.description', 'Materialize dataset train/val/test từ dữ liệu đã gán nhãn')}
        </p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-64">
            <Label>{t('aiEval.dataset', 'Dataset')}</Label>
            <DatasetSelect value={datasetId} onChange={setDatasetId} />
          </div>
          <Button
            onClick={() => datasetId && buildDataset.mutate({ datasetId: Number(datasetId) })}
            disabled={!datasetId || buildDataset.isPending}
            className="flex items-center gap-2"
          >
            {buildDataset.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {t('aiDataProcessing.dataset.build', 'Build Dataset')}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <>
          {/* Summary */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{result.totalSamples.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{t('aiDataProcessing.dataset.totalSamples', 'Tổng số mẫu')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-info">{result.split.train.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Train ({pct(result.split.train)}%)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-warning">{result.split.val.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Val ({pct(result.split.val)}%)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold text-success">{result.split.test.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Test ({pct(result.split.test)}%)</p>
              </CardContent>
            </Card>
          </div>

          {/* Split ratio bar */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('aiDataProcessing.dataset.splitRatio', 'Tỉ lệ Train/Val/Test')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-4 w-full overflow-hidden rounded-full">
                <div className="bg-info" style={{ width: `${pct(result.split.train)}%` }} title={`Train ${pct(result.split.train)}%`} />
                <div className="bg-warning" style={{ width: `${pct(result.split.val)}%` }} title={`Val ${pct(result.split.val)}%`} />
                <div className="bg-success" style={{ width: `${pct(result.split.test)}%` }} title={`Test ${pct(result.split.test)}%`} />
              </div>
            </CardContent>
          </Card>

          {/* Label distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <PieChart className="h-4 w-4" />
                {t('aiDataProcessing.dataset.labelDistribution', 'Phân bố nhãn')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(result.labelDistribution).map(([label, count]) => {
                  const p = result.totalSamples > 0 ? (count / result.totalSamples) * 100 : 0;
                  return (
                    <div key={label} className="flex items-center gap-2">
                      <span className="w-28 text-sm truncate">{label}</span>
                      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${p}%` }} />
                      </div>
                      <span className="w-20 text-sm text-right">{count} ({p.toFixed(0)}%)</span>
                    </div>
                  );
                })}
                {Object.keys(result.labelDistribution).length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('common.noData', 'Không có dữ liệu')}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
